/* 행사별 영업 DB 표(sales_targets)를 만든다 (2026-11-06)
   한 줄 = 이 사람을 이 행사의 영업 DB로 쓴다. 정의는 schema.sql 끝과 같다.
     node db/migrations/add-sales-targets.js */
require('dotenv').config();
const pool = require('../pool');
(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS sales_targets (
    id TEXT PRIMARY KEY, event_id TEXT, contact_id TEXT, created_at TEXT, created_by TEXT, note TEXT)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_targets ON sales_targets(event_id, contact_id)`);
  console.log('✓ sales_targets — 행사별 영업 DB');
  await pool.end();
})();
