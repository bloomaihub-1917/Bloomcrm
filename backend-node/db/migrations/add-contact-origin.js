/* 연락처 «DB 갈래» 칸 (2026-11-05) — 사람이 처음 어떤 길로 들어왔나
     ours  = 우리가 수주한 행사를 진행하며 수집 (연사·전시 담당자·참가자)
     other = 타 행사의 참가자 데이터
     sales = 우리 행사로 끌어오려고 발로 뛰어 모은 DB (셀러·바이어 명단, 홍보메일)
   이후 이력은 행사 참여 기록이 보여 준다. 채우기는 db/oneoff/fill-contact-origin.js */
require('dotenv').config();
const pool = require('../pool');
(async () => {
  await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS origin TEXT`);
  console.log('✓ contacts.origin — DB 갈래(ours/other/sales)');
  await pool.end();
})();
