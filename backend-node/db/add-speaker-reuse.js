/* 지난 자료 가져오기 — 어디서(reuse_from) 언제(reused_at) 가져왔나.

   같은 사람을 다시 부르면 지난 행사의 약력·사진·CV를 새 연사 줄에 옮긴다.
   받은 날짜는 옮기지 않는다. 옮기면 «다 받음»으로 세어져 아무도 최신인지
   묻지 않는다 — 연사가 맞다고 확인할 때 그날을 찍는다. 그 사이를 «확인
   대기»로 알아보려면 가져왔다는 표시가 따로 있어야 한다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  for (const [c, label] of [['reuse_from', '가져온 행사'], ['reused_at', '가져온 날']]) {
    await pool.query(`ALTER TABLE speakers ADD COLUMN IF NOT EXISTS ${c} TEXT`);
    console.log(`✓ speakers.${c} — ${label}`);
  }
  await pool.end();
})();
