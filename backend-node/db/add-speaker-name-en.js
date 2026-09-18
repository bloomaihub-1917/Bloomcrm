/* 연사에 영문 성명을 더한다.

   성명이 한 칸뿐이었다. 그런데 프로그램북·명찰·현장 안내가 국·영문을 나눠
   쓰고, 해외 연사는 영문만 오고 국내 연사는 둘 다 온다. 한 칸에 몰아 넣으면
   «이원석 Wonsuk Lee»처럼 붙어 들어가 영문판을 뽑을 때 다시 갈라야 한다.

   마스터DB의 연락처는 처음부터 nameKo·nameEn 두 칸이었는데 연사만 하나였다.
   연락처에서 끌어올 때도 영문이 갈 곳이 없어 버려지고 있었다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`ALTER TABLE speakers ADD COLUMN IF NOT EXISTS name_en TEXT`);
  console.log('✓ speakers.name_en — 영문 성명');
  const r = await pool.query(
    `select count(*) n from information_schema.columns where table_name='speakers'`);
  console.log(`speakers ${r.rows[0].n}열`);
  await pool.end();
})();
