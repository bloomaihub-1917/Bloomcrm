/* 연사 숨기기 — 'yes'면 컨퍼런스 목록에서 접고 받을 항목(spCell)에서 뺀다.
   지우면 배정·기록까지 사라지는데, 주최사가 직접 챙기는 사람이나 잠시 보류한 사람은
   남겨 두되 «받을 것»에서만 빼고 싶다. 프로그램·배정은 그대로다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`ALTER TABLE speakers ADD COLUMN IF NOT EXISTS hidden TEXT`);
  console.log('✓ speakers.hidden — 숨기기');
  await pool.end();
})();
