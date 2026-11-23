/* 컨택 차수에 TM 스크립트 링크를 둔다 — 통화하면서 바로 연다(이벤트코리아 TM 스크립트 문서). */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`ALTER TABLE contact_rounds ADD COLUMN IF NOT EXISTS script_url TEXT`);
  console.log('✓ contact_rounds.script_url — 차수별 스크립트 링크');
  await pool.end();
})();
