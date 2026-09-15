/* 연사 섭외 진행을 적을 칸을 더한다.

   지금까지는 «무엇을 받았나»만 있었다. 그런데 일의 절반은 «무엇을 보냈나»다 —
   가이드라인을 보냈는지 모르면 안 보내고 기다리거나, 보낸 걸 또 보낸다.
   받은 날짜만 보고 «왜 안 오지»를 묻는 일이 여기서 생긴다.

   보낸 것은 우리 쪽 기록이라 사람이 적는다. 메일을 이 시스템에서 보내면
   speaker_logs에도 남지만, 그건 «이 시스템으로 보낸 것»만이다 — 실제로는
   개인 메일이나 카톡으로도 나간다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COLS = [
  ['guide_sent_at',    '가이드라인 보낸 날'],
  ['form_sent_at',     '양식(프로필 서식) 보낸 날'],
  ['reminded_at',      '마지막으로 독촉한 날'],
  ['confirmed_at',     '참가 확정된 날'],
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
