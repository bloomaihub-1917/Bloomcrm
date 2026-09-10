/* 연사에 소속·직함 스냅숏을 더한다.

   왜 스냅숏인가 — 프로그램북에 나가는 소속·직함은 «발표 당시»의 것이다.
   사람이 이듬해 이직하면 마스터DB의 소속은 바뀌어야 맞지만, 작년 프로그램북의
   소속은 그대로여야 한다. 그래서 두 값은 원래 다른 값이고, 같은 칸에 담으면
   둘 중 하나가 반드시 틀린다.

   연락처를 연결하면 그때 값을 끌어와 채우고, 그 뒤로는 여기를 고친다.
   마스터DB는 «지금 어디 있는 사람인가»로 계속 살아 있는다.
   전시의 간판명·도록명과 같은 구조다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COLS = ['org_ko', 'org_en', 'title_ko', 'title_en'];

(async () => {
  for (const c of COLS) {
    await pool.query(`ALTER TABLE speakers ADD COLUMN IF NOT EXISTS ${c} TEXT`);
    console.log(`✓ speakers.${c}`);
  }
  const r = await pool.query(
    `select column_name from information_schema.columns where table_name = 'speakers'`);
  console.log(`\nspeakers 열 ${r.rows.length}개`);
  await pool.end();
})();
