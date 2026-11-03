/* 연사의 갈라디너 참석 여부.

   연사 등록 신청서에 갈라디너 참석 칸이 있는데 받을 자리가 없어 메모에
   적고 있었다. 메모는 세지 못한다 — 식당에 인원을 알려 줄 때 스무 명의
   메모를 다 열어 봐야 한다. 'yes' | 'no' | '' (미확인) */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`ALTER TABLE speakers ADD COLUMN IF NOT EXISTS gala_rsvp TEXT`);
  console.log('✓ speakers.gala_rsvp — 갈라디너 참석');
  await pool.end();
})();
