/* ══════════════════════════════════════════════════════════════
   fix-misplaced-contacts.js — 잘못 들어간 담당자 정리

   ① 셀타스퀘어 사람 셋이 시믹코리아 담당자로 들어가 있다.
      2026-08-25 03:06~03:07, 시믹코리아 화면을 열어 둔 채 셀타스퀘어 담당자를
      적은 것으로 감사로그에 남아 있다.

      - hylee@seltasquare.com(이하연)은 셀타스퀘어에 이미 마스터DB와 연결된
        줄이 있다. 옮기면 같은 사람이 두 줄이 되므로 지운다.
      - 신민경·신기민은 셀타스퀘어로 옮긴다.
      - 옮겨 갈 때 만들어졌다가 비어 있는 셀타스퀘어 줄도 지운다.

   ② 애크메드 담당자의 이메일이 acccmed.ai로 잘못 적혀 있다(c가 하나 많다).
      이 줄은 마스터DB에 연결돼 있어 화면에는 마스터DB 값이 나온다 — 즉 이
      값은 아무도 안 보는 죽은 값이다. 그래도 지워 둬야 나중에 훑어볼 때
      또 걸리지 않는다. 마스터DB 쪽은 값은 맞지만 <>로 감싸여 있어 벗긴다.

   무엇을 바꿨는지 activity_log에도 남긴다 — 사람이 고친 것과 구분되게
   이름을 '정리 스크립트'로 적는다.

     node db/fix-misplaced-contacts.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const SELTA = 'X-1787561569303_20';   // 셀타스퀘어
const CMIC  = 'X-1787561569303_23';   // 시믹코리아

const MOVE   = ['XC-1787627201859_139', 'XC-1787627213305_602'];        // 신민경 · 신기민
const DROP   = ['XC-1787627175580_305', 'XC-1787627269893_605'];        // 이하연 중복 · 빈 줄
const ACCMED_ROW = 'XC-mig-X-1787561569303_27';
const ACCMED_CONTACT = '1787556966989000';

const now = () => new Date().toISOString();
let seq = 0;
async function log(client, action, target, detail){
  if (DRY) return;
  await client.query(
    `INSERT INTO activity_log (id, ts, email, name, type, action, target, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [`L-${Date.now()}-${seq++}`, now(), '', '정리 스크립트', 'edit', action, target, detail]);
}

(async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT c.id, c.exhibitor_id, c.contact_id, c.name, c.email, c.is_primary, e.company_name
         FROM exhibitor_contacts c JOIN exhibitors e ON e.id = c.exhibitor_id
        WHERE c.id = ANY($1)`, [[...MOVE, ...DROP, ACCMED_ROW]]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    // 지우려는 줄이 정말 비었거나 중복인지 눈으로 확인할 수 있게 먼저 찍는다
    console.log('■ 옮길 줄 (시믹코리아 → 셀타스퀘어)');
    MOVE.forEach((id) => { const r = byId[id];
      console.log(`   ${r ? `${r.name || '(이름없음)'} ${r.email || ''} — 지금 ${r.company_name}` : `${id} 없음`}`); });

    console.log('\n■ 지울 줄');
    DROP.forEach((id) => { const r = byId[id];
      console.log(`   ${r ? `${r.name || '(이름없음)'} ${r.email || '(이메일없음)'} — ${r.company_name}` : `${id} 없음`}`); });

    const acc = byId[ACCMED_ROW];
    console.log(`\n■ 애크메드 죽은 이메일 지우기: ${acc ? acc.email || '(이미 비어 있음)' : '행 없음'}`);
    const { rows: mc } = await client.query('SELECT email1 FROM contacts WHERE id = $1', [ACCMED_CONTACT]);
    console.log(`■ 애크메드 마스터DB 이메일: ${mc[0] ? mc[0].email1 : '없음'}`);

    if (DRY) { console.log('\n--dry 라서 아무것도 바꾸지 않았습니다.'); return; }

    await client.query('BEGIN');

    for (const id of MOVE) {
      const r = byId[id];
      if (!r || r.exhibitor_id !== CMIC) { console.log(`   건너뜀(이미 옮겨졌거나 없음): ${id}`); continue; }
      // 옮겨 간 곳에 메인이 이미 있으므로 메인 표시는 떼고 넣는다
      await client.query(
        `UPDATE exhibitor_contacts SET exhibitor_id = $1, is_primary = '' WHERE id = $2`, [SELTA, id]);
      await log(client, '담당자 기업 이동', '셀타스퀘어',
        `<b>${r.name || r.email}</b> 시믹코리아 → 셀타스퀘어 (잘못 입력된 것을 옮김)`);
    }

    for (const id of DROP) {
      const r = byId[id];
      if (!r) { console.log(`   건너뜀(없음): ${id}`); continue; }
      await client.query('DELETE FROM exhibitor_contacts WHERE id = $1', [id]);
      await log(client, '담당자 삭제', r.company_name,
        `<b>${r.name || r.email || '(빈 줄)'}</b> 삭제 — ${id === DROP[0] ? '셀타스퀘어에 같은 사람이 이미 있음' : '이름·이메일이 없는 빈 줄'}`);
    }

    if (acc && acc.email) {
      await client.query(`UPDATE exhibitor_contacts SET email = '' WHERE id = $1`, [ACCMED_ROW]);
      await log(client, '담당자 이메일 정리', '애크메드',
        `잘못 적힌 <b>${acc.email}</b> 지움 — 화면에는 마스터DB 값이 쓰이던 죽은 값`);
    }
    if (mc[0] && /[<>]/.test(mc[0].email1 || '')) {
      const clean = String(mc[0].email1).replace(/[<>]/g, '').trim();
      await client.query('UPDATE contacts SET email1 = $1 WHERE id = $2', [clean, ACCMED_CONTACT]);
      await log(client, '연락처 이메일 정리', '애크메드', `${mc[0].email1} → ${clean}`);
    }

    await client.query('COMMIT');

    const { rows: after } = await client.query(
      `SELECT e.company_name, c.name, c.email, c.is_primary, c.contact_id
         FROM exhibitor_contacts c JOIN exhibitors e ON e.id = c.exhibitor_id
        WHERE e.id IN ($1, $2) ORDER BY e.company_name, c.is_primary DESC, c.id`, [SELTA, CMIC]);
    console.log('\n반영 후:');
    after.forEach((r) => console.log(`   ${r.company_name} | ${r.name || '(이름없음)'} | ${r.email || ''}`
      + `${r.is_primary === 'yes' ? ' | 메인' : ''}${r.contact_id ? ' | 마스터DB 연결' : ' | 미연결'}`));
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
