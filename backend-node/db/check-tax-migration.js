/* 사용자가 수동으로 tax-invoices-migrate.js의 SQL을 반영했다고 해서,
   실제로 반영됐는지 확인만 하는 조회 전용 스크립트.
     node db/check-tax-migration.js
*/
require('dotenv').config();
const pool = require('./pool');

(async () => {
  const cols = (await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='exhibitors' AND column_name LIKE 'tax_%'`
  )).rows;
  console.log('exhibitors에 남은 tax_ 컬럼:', cols.map(r => r.column_name));

  const t = (await pool.query(`SELECT to_regclass('exhibitor_tax_invoices') AS t`)).rows[0].t;
  console.log('exhibitor_tax_invoices 테이블:', t || '(없음)');
  if(!t){ await pool.end(); return; }

  const cnt = (await pool.query('SELECT COUNT(*)::int AS n FROM exhibitor_tax_invoices')).rows[0].n;
  console.log('행 수:', cnt);

  const rows = (await pool.query(`
    SELECT t.*, e.company_name FROM exhibitor_tax_invoices t
    JOIN exhibitors e ON e.id = t.exhibitor_id
    ORDER BY e.company_name`)).rows;
  rows.forEach(r => console.log(
    `  ${String(r.company_name).padEnd(24)} stage=${r.stage || '(없음)'} 금액=${r.amount || '(없음)'}${r.currency || ''} 발행일=${r.sent_at || '(없음)'} status=${r.status || ''}`));

  await pool.end();
})().catch(e => { console.error(e); process.exitCode = 1; });
