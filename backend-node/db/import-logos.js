/* ══════════════════════════════════════════════════════════════
   import-logos.js — 로고 폴더를 훑어 "로고 받음"을 채운다

   OneDrive의 Logo 폴더에 기업별 하위 폴더가 있고, 폴더명이
   "<프로그램북 순번>_[등급_]<기업명>" 꼴이다. 그 순번이 exhibitors.book_order와
   그대로 맞아떨어져서, 번호로 짝을 짓는다.

   번호만 믿지 않는다. 순번이 겹치는 자리가 실제로 있다(44번에 서울대학교병원과
   분당서울대학교병원 둘이 부스를 나눠 쓴다). 그래서 번호로 후보를 좁힌 뒤
   폴더명에 남은 기업명으로 한 번 더 가린다.

   파일이 하나도 없는 폴더는 건너뛴다 — 자리만 만들어 둔 것과 실제로 받은 것은
   다르다.

     node db/import-logos.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EVENT = '2026 KIC';
const LOGO_DIR = 'C:/Users/cdaky/OneDrive - STUDIO BLOOM/4.행사/2026년/'
  + '1013-1015 KoNECT International Conference/300. 전시/Logo';

/* 이름을 눌러서 견준다 — 폴더명은 영문 약칭, DB는 국문 정식명인 경우가 많아
   글자 그대로는 거의 안 맞는다. 번호가 이미 좁혀 주므로 여기서는 확인용이다. */
const squash = (v) => String(v || '').toLowerCase()
  .replace(/\(주\)|\(유\)|주식회사|㈜|유한회사|inc\.?|corp\.?|co\.?|ltd\.?|llc\.?/g, '')
  .replace(/[^a-z0-9가-힣]/g, '');

(async () => {
  const client = await pool.connect();
  try {
    const dirs = fs.readdirSync(LOGO_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    const { rows } = await client.query(
      'SELECT id, company_name, book_order, book_logo, status FROM exhibitors WHERE event_id = $1',
      [EVENT]);

    const hits = [], misses = [], empties = [], already = [];

    for (const d of dirs) {
      const m = d.name.match(/^(\d+)_(.*)$/);
      if (!m) { misses.push([d.name, '번호로 시작하지 않음']); continue; }
      const [, numStr, rest] = m;

      // 자리만 만들어 둔 폴더는 받은 게 아니다
      const files = fs.readdirSync(path.join(LOGO_DIR, d.name));
      if (!files.length) { empties.push(d.name); continue; }

      // 등급 접두(DIA/GOLD/SILVER)는 이름이 아니다
      const nameOnly = rest.replace(/^(DIA|GOLD|SILVER|BRONZE)_/i, '');

      const cands = rows.filter((r) => String(r.book_order || '') === numStr);
      if (!cands.length) { misses.push([d.name, `순번 ${numStr}에 해당하는 기업 없음`]); continue; }

      let target = cands[0];
      if (cands.length > 1) {
        // 순번이 겹치면 폴더명의 기업명으로 가린다
        const s = squash(nameOnly);
        // 정확히 같은 이름을 먼저 본다. 한쪽이 다른 쪽에 통째로 들어가는 이름이
        // 있어서(서울대학교병원 ⊂ 분당서울대학교병원) 포함만으로는 둘 다 걸린다.
        let byName = cands.filter((r) => s && squash(r.company_name) === s);
        if (byName.length !== 1) {
          // 그다음은 폴더명에 들어 있는 이름 중 가장 긴 것 — 더 자세히 적힌 쪽이 맞다
          const inFolder = cands.filter((r) => s && s.includes(squash(r.company_name)));
          if (inFolder.length) {
            const max = Math.max(...inFolder.map((r) => squash(r.company_name).length));
            byName = inFolder.filter((r) => squash(r.company_name).length === max);
          } else {
            byName = cands.filter((r) => s && squash(r.company_name).includes(s));
          }
        }
        if (byName.length !== 1) {
          misses.push([d.name, `순번 ${numStr}에 ${cands.length}곳 — 이름으로도 못 가림 (${cands.map((c) => c.company_name).join(', ')})`]);
          continue;
        }
        target = byName[0];
      }

      if (target.book_logo === 'yes') { already.push([d.name, target.company_name]); continue; }
      hits.push({ id: target.id, folder: d.name, name: target.company_name, num: numStr, files: files.length });
    }

    console.log(`폴더 ${dirs.length}개 · 참가기업 ${rows.length}곳\n`);

    console.log(`■ 새로 "로고 받음"으로 바꿀 곳 ${hits.length}곳`);
    hits.forEach((h) => console.log(`   ${h.num.padStart(3)} ${h.name}  ← ${h.folder} (파일 ${h.files})`));

    console.log(`\n■ 이미 받음으로 되어 있던 곳 ${already.length}곳`);
    already.forEach(([f, n]) => console.log(`   ${n}  ← ${f}`));

    if (empties.length) {
      console.log(`\n■ 폴더는 있으나 파일이 없어 건너뜀 ${empties.length}곳`);
      empties.forEach((f) => console.log(`   ${f}`));
    }
    if (misses.length) {
      console.log(`\n■ 짝을 못 지은 폴더 ${misses.length}곳 — 확인 필요`);
      misses.forEach(([f, why]) => console.log(`   ${f}  → ${why}`));
    }

    // 폴더가 없는 기업 — 아직 로고를 못 받은 곳
    const matched = new Set([...hits.map((h) => h.id), ...already.map(() => null)]);
    already.forEach(([f, n]) => { const r = rows.find((x) => x.company_name === n); if (r) matched.add(r.id); });
    const noFolder = rows.filter((r) => !matched.has(r.id) && r.status !== '취소');
    console.log(`\n■ 로고 폴더가 없는 곳 ${noFolder.length}곳 — 아직 못 받음(이번에 건드리지 않음)`);
    noFolder.sort((a, b) => (Number(a.book_order) || 999) - (Number(b.book_order) || 999))
      .forEach((r) => console.log(`   ${String(r.book_order || '-').padStart(3)} ${r.company_name}`));

    if (DRY) { console.log('\n--dry 라서 아무것도 바꾸지 않았습니다.'); return; }

    await client.query('BEGIN');
    for (const h of hits) {
      await client.query('UPDATE exhibitors SET book_logo = $1 WHERE id = $2', ['yes', h.id]);
    }
    await client.query('COMMIT');
    console.log(`\n반영 완료 — ${hits.length}곳을 "로고 받음"으로 바꿨습니다.`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
