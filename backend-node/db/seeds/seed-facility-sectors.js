/* ══════════════════════════════════════════════════════════════
   seed-facility-sectors.js — MICE 분야에 «설비» 섹터 3개를 세운다

   «전기·설비» 갈래(docs/category-plan.md)에 들어갈 섹터 — 전기는 이미 있고,
   코엑스·킨텍스 등록업체 분류에 있는 급배수·압축공기, 가스설비, 방염을 더한다.
   이름에 `,` `/`를 넣지 않는다(orgs.sectors를 `|`로 나눌 때 섞이지 않게).

     node db/seeds/seed-facility-sectors.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('../pool');

const DRY = process.argv.includes('--dry');
const SECTORS = [
  { id: 'facility_water_air', name: '급배수·압축공기' },
  { id: 'facility_gas', name: '가스설비' },
  { id: 'facility_flame', name: '방염' },
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of SECTORS) {
      const have = await client.query(`SELECT id FROM sectors WHERE id = $1 OR name = $2`, [s.id, s.name]);
      if (have.rows.length) { console.log(`«${s.name}» 이미 있습니다 — 건너뜁니다.`); continue; }
      await client.query(
        `INSERT INTO sectors (id, name, parent, domain, canonical) VALUES ($1, $2, '', 'mice', '')`,
        [s.id, s.name]);
      console.log(`섹터 «${s.name}» 만듦 (분야: mice)`);
    }
    const n = (await client.query(`SELECT count(*) c FROM sectors WHERE domain = 'mice'`)).rows[0].c;
    console.log(`MICE 섹터 ${n}개`);
    if (DRY) { await client.query('ROLLBACK'); console.log('--dry 라서 되돌렸습니다.'); }
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
