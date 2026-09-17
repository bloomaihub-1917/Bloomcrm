require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
(async () => {
  const ev = await pool.query(`select id, name, date_start, date_end from events order by date_start desc nulls last`);
  console.log('── 행사 ──');
  ev.rows.forEach(r => console.log(`  ${r.id} | ${r.name} | ${r.date_start}~${r.date_end}`));
  const cs = await pool.query(
    `select event_id, count(*) n, min(date) d1, max(date) d2 from conf_sessions group by event_id`);
  console.log('\n── 세션이 있는 행사 ──');
  cs.rows.forEach(r => console.log(`  ${r.event_id} | 세션 ${r.n} | ${r.d1}~${r.d2}`));
  const sp = await pool.query(`select event_id, count(*) n from speakers group by event_id`);
  console.log('\n── 연사 ──');
  sp.rows.forEach(r => console.log(`  ${r.event_id} | ${r.n}명`));
  const hit = await pool.query(
    `select id, event_id, name_snapshot, org_en, cv_file from speakers
      where name_snapshot ilike '%chen%' or name_snapshot ilike '%chang%' or name_snapshot ilike '%彥%'`);
  console.log('\n── 이름이 비슷한 연사 ──');
  hit.rows.forEach(r => console.log(`  ${r.id} | ${r.event_id} | ${r.name_snapshot} | ${r.org_en || ''}`));
  if (!hit.rows.length) console.log('  (없음)');
  await pool.end();
})();
