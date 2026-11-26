/* 연락처에 두 번째 소속 칸을 만든다.

   대학 교수이면서 설계사무소 대표처럼 소속이 둘인 사람이 종종 있다. 지금까지는
   «Soongsil University / Do See Rock Architecture»처럼 한 칸에 이어 적어서
   기업DB 연결·검색이 첫 소속에만 맞거나 둘 다 틀렸다.

   org2Ko / org2En  두 번째 소속 이름
   org2_id          두 번째 소속의 기업DB id (첫 소속의 org_id와 같은 방식으로 잇는다)

   실행: node db/migrations/add-contact-org2.js (여러 번 실행해도 안전) */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  for (const col of ['"org2Ko"', '"org2En"', 'org2_id']) {
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ${col} TEXT`);
    console.log(`✓ contacts.${col}`);
  }
  await pool.end();
})();
