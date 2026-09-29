/* ══════════════════════════════════════════════════════════════
   fix-unsafe-contact-ids.js — 브라우저가 못 담는 긴 연락처 id를 다시 매긴다

   몇몇 가져오기 스크립트가 id를 `${Date.now()}${순번 4자리}`로 만들어 17자리가
   됐다. 화면은 id를 숫자로 다루는데(+r.id) 자바스크립트 숫자는 2^53(16자리)을
   넘으면 끝자리가 반올림된다. 그래서 …043·…044·…045가 한 사람으로 뭉개져
   다른 사람의 행사 기록이 붙고, 그 번호로 저장하다가 같은 사람이 한 번 더
   생겼다(같은 기업에 같은 이름 두 줄).

   1) 같은 기업·같은 이름으로 겹친 연락처를 한 명으로 합친다 — 채워진 칸이 많은
      쪽을 남기고, 남는 쪽 빈 칸은 지우는 쪽 값으로 채운다. 참가 기록 등은 남기는
      쪽으로 옮긴다.
   2) 16자리를 넘는 id를 안전한 번호로 바꾸고, 그 id를 가리키는 곳을 다 고친다.

   기본은 시험 실행이다. 실제로 바꾸려면 --apply.

     node db/fix-unsafe-contact-ids.js [--apply]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const APPLY = process.argv.includes('--apply');
const REFS = [['participations', 'contact_id'], ['exhibitor_contacts', 'contact_id'],
  ['speakers', 'contact_id'], ['speaker_contacts', 'contact_id']];
const unsafe = (id) => !Number.isSafeInteger(Number(id));
const filled = (v) => v != null && String(v).trim() !== '';

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rows = (await client.query(`SELECT * FROM contacts`)).rows;
    const cols = Object.keys(rows[0] || {}).filter((c) => c !== 'id');
    const refCount = {};
    for (const [t, c] of REFS) {
      (await client.query(`SELECT "${c}" id, count(*) n FROM "${t}" GROUP BY 1`)).rows
        .forEach((r) => { refCount[r.id] = (refCount[r.id] || 0) + +r.n; });
    }

    /* 1) 겹친 사람 */
    const groups = new Map();
    rows.forEach((r) => {
      if (!filled(r.org_id) || !filled(r.nameKo)) return;
      const k = `${r.org_id}|${r.nameKo.trim()}`;
      (groups.get(k) || groups.set(k, []).get(k)).push(r);
    });
    const merges = [];
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const score = (r) => cols.filter((c) => filled(r[c])).length + (refCount[r.id] || 0) * 2;
      list.sort((a, b) => score(b) - score(a) || (unsafe(a.id) - unsafe(b.id)));
      const [keep, ...drop] = list;
      const patch = {};
      drop.forEach((d) => cols.forEach((c) => {
        if (!filled(keep[c]) && !filled(patch[c]) && filled(d[c])) patch[c] = d[c];
      }));
      /* 서로 다른 값이 있으면 보여 준다 — 같은 사람이 아닐 수도 있다 */
      const conflicts = [];
      drop.forEach((d) => ['phone1', 'phone2', 'email1', 'titleKo'].forEach((c) => {
        if (filled(keep[c]) && filled(d[c]) && String(keep[c]).trim() !== String(d[c]).trim())
          conflicts.push(`${c}: ${keep[c]} ≠ ${d[c]}`);
      }));
      merges.push({ keep, drop, patch, conflicts });
    }

    console.log(`\n① 겹친 연락처 합치기 — ${merges.length}쌍`);
    merges.forEach(({ keep, drop, patch, conflicts }) => {
      console.log(`  • ${keep.nameKo} (${keep.orgKo || keep.org_id})`);
      console.log(`      남김 ${keep.id} [${keep.phone1 || '-'} / ${keep.email1 || '-'}] 참가 ${refCount[keep.id] || 0}`);
      drop.forEach((d) => console.log(`      지움 ${d.id} [${d.phone1 || '-'} / ${d.email1 || '-'}] 참가 ${refCount[d.id] || 0}`));
      if (Object.keys(patch).length) console.log(`      채움: ${Object.keys(patch).join(', ')}`);
      if (conflicts.length) console.log(`      ⚠ 값이 다름: ${conflicts.join(' · ')}`);
    });

    for (const { keep, drop, patch } of merges) {
      const pc = Object.keys(patch);
      if (pc.length) await client.query(
        `UPDATE contacts SET ${pc.map((c, i) => `"${c}" = $${i + 2}`).join(', ')} WHERE id = $1`,
        [keep.id, ...pc.map((c) => patch[c])]);
      for (const d of drop) {
        /* 같은 행사·같은 역할이 이미 있으면 옮기지 않고 지운다 */
        await client.query(
          `DELETE FROM participations p USING participations k
            WHERE p.contact_id = $1 AND k.contact_id = $2 AND k.event_id = p.event_id AND k.role = p.role`,
          [d.id, keep.id]);
        for (const [t, c] of REFS) await client.query(`UPDATE "${t}" SET "${c}" = $2 WHERE "${c}" = $1`, [d.id, keep.id]);
        await client.query(`DELETE FROM contacts WHERE id = $1`, [d.id]);
      }
    }

    /* 2) 긴 id 다시 매기기 */
    const dropped = new Set(merges.flatMap((m) => m.drop.map((d) => d.id)));
    const left = rows.filter((r) => !dropped.has(r.id));
    let next = Math.max(0, ...left.filter((r) => !unsafe(r.id)).map((r) => Number(r.id))) + 1;
    const renum = left.filter((r) => unsafe(r.id)).sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((r) => ({ from: r.id, to: String(next++), name: r.nameKo || r.nameEn || '' }));

    console.log(`\n② 긴 id 다시 매기기 — ${renum.length}명 (${renum[0]?.to || '-'} ~ ${renum.at(-1)?.to || '-'})`);
    renum.slice(0, 5).forEach((x) => console.log(`    ${x.from} → ${x.to}  ${x.name}`));
    if (renum.length > 5) console.log(`    … 외 ${renum.length - 5}명`);

    const touched = {};
    for (const { from, to } of renum) {
      await client.query(`UPDATE contacts SET id = $2 WHERE id = $1`, [from, to]);
      for (const [t, c] of REFS) {
        const r = await client.query(`UPDATE "${t}" SET "${c}" = $2 WHERE "${c}" = $1`, [from, to]);
        if (r.rowCount) touched[t] = (touched[t] || 0) + r.rowCount;
      }
      /* 변경 이력의 링크 — 누르면 그 사람이 열리도록 */
      const r = await client.query(
        `UPDATE activity_log SET link = replace(link, $1, $2) WHERE link LIKE '%' || $1 || '%'`, [`"${from}"`, `"${to}"`]);
      if (r.rowCount) touched.activity_log = (touched.activity_log || 0) + r.rowCount;
    }
    console.log(`    함께 고친 참조: ${Object.entries(touched).map(([t, n]) => `${t} ${n}`).join(', ') || '-'}`);

    const still = (await client.query(`SELECT id FROM contacts`)).rows.filter((r) => unsafe(r.id)).length;
    console.log(`\n남은 긴 id: ${still}`);

    if (!APPLY) { await client.query('ROLLBACK'); console.log('시험 실행이라 되돌렸습니다. 반영하려면 --apply'); }
    else { await client.query('COMMIT'); console.log('반영 완료.'); }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end?.();
  }
})();
