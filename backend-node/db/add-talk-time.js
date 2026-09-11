/* 배정 줄에 발표 시작·종료를 더한다.

   지금까지는 세션 시간만 있었다. 세션이 10:00–12:20인 건 알아도 그 안에서
   누가 몇 시에 올라가는지는 적을 데가 없었다 — 그런데 연사에게 보내는 안내,
   프로그램북, 현장 진행표가 모두 «그 사람의 시간»으로 돌아간다.

   발표 시간은 사람이 아니라 배정에 붙는다. 한 사람이 두 세션에서 발표하면
   시간도 둘이기 때문이다. duration_min은 이미 있지만 «몇 분»만으로는 순서가
   바뀔 때마다 다시 계산해야 해서, 실제 시각을 함께 둔다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  for (const c of ['start_at', 'end_at']) {
    await pool.query(`ALTER TABLE session_speakers ADD COLUMN IF NOT EXISTS ${c} TEXT`);
    console.log(`✓ session_speakers.${c}`);
  }
  const r = await pool.query(
    `select column_name from information_schema.columns where table_name = 'session_speakers'`);
  console.log(`\nsession_speakers 열 ${r.rows.length}개`);
  await pool.end();
})();
