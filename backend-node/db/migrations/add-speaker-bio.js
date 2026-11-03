/* 이력으로 받는 것을 늘린다.

   지금은 Professional experience와 Working experience 둘뿐인데, 실제 연사
   프로필은 그보다 많다 — 한 문단짜리 소개(Professional Profile), 학력,
   그리고 수상·선정 이력. 프로그램북과 현장 소개 멘트가 이 넷을 나눠 쓴다.

   한 칸에 몰아 받으면 프로그램북을 만들 때 다시 사람이 잘라야 하고, 자르는
   기준이 매번 달라진다. 받을 때 나눠 받아야 쓸 때 안 자른다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COLS = [
  ['bio_profile_ko', 'Professional Profile 국문'],
  ['bio_profile_en', 'Professional Profile 영문'],
  ['bio_edu_ko',     'Education 국문'],
  ['bio_edu_en',     'Education 영문'],
  ['bio_awards_ko',  'Awards & Recognitions 국문'],
  ['bio_awards_en',  'Awards & Recognitions 영문'],
];

(async () => {
  for (const [c, label] of COLS) {
    await pool.query(`ALTER TABLE speakers ADD COLUMN IF NOT EXISTS ${c} TEXT`);
    console.log(`✓ speakers.${c} — ${label}`);
  }
  const r = await pool.query(
    `select column_name from information_schema.columns where table_name = 'speakers'`);
  console.log(`\nspeakers 열 ${r.rows.length}개`);
  await pool.end();
})();
