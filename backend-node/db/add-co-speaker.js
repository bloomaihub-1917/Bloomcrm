/* 배정 줄에 lead_id를 더한다 — 공동 발표.

   두 사람이 발표 시간 하나와 자료 하나를 나눠 맡는 일이 생겼다(2026 AIA).
   배정을 둘 두고 각자 시간·발제를 적으면 같은 발표가 프로그램에 두 번 뜨고,
   초록·자료를 한쪽에만 받았을 때 다른 쪽이 «미수령»으로 독촉을 받는다.

   그래서 한 사람(주 발표자)의 배정 줄에만 시간·발제·초록·자료를 적고,
   공동 연사의 배정 줄은 lead_id로 그 줄을 가리킨다. 사람에 붙는 것(이력·사진·
   계좌·동의서)은 지금처럼 각자 받는다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query('ALTER TABLE session_speakers ADD COLUMN IF NOT EXISTS lead_id TEXT');
  console.log('✓ session_speakers.lead_id — 공동 발표');
  await pool.end();
})();
