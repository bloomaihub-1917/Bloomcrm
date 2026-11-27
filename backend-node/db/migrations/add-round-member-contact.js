/* 컨택 명단 줄의 «받을 사람» (2026-11-27)
   round_members.contact_id — 카드에서 라디오로 고른 담당자. 한꺼번에 메일 보내기도 이 사람에게 간다.
   연락처 id를 가리키므로 fix-unsafe-contact-ids.js·routes/data.js 합치기 목록에도 넣었다. */
require('dotenv').config();
const pool = require('../pool');
(async () => {
  await pool.query(`ALTER TABLE round_members ADD COLUMN IF NOT EXISTS contact_id TEXT`);
  console.log('✓ round_members.contact_id');
  await pool.end();
})();
