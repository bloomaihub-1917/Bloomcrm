/* 컨택 명단 한 줄에 담당(맡은 사람)과 표시(특별관 후보·소개서 등급)를 더한다.
   이벤트코리아 TM처럼 수백 곳을 분야별로 나눠 맡을 때 «내 몫»만 보고, 담당별로 센다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`ALTER TABLE round_members ADD COLUMN IF NOT EXISTS assignee TEXT`);
  await pool.query(`ALTER TABLE round_members ADD COLUMN IF NOT EXISTS tags TEXT`);
  console.log('✓ round_members.assignee · tags — 컨택 담당 배정·표시');
  await pool.end();
})();
