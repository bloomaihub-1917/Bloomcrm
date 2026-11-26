/* 컨택 차수 목표 = 전시 참가기업 등록 (2026-11-25)
   contact_rounds.goal_exh = 'yes'면 «목표 달성»이 그 행사 전시 참가기업(exhibitors) 등록과 같은 뜻이 된다.
   목표 달성을 누르면 참가기업으로 넣고, 전시에 이미 등록된 기업은 목표 달성으로 본다(js/modules/contact-tab.js). */
require('dotenv').config();
const pool = require('../pool');
(async () => {
  await pool.query(`ALTER TABLE contact_rounds ADD COLUMN IF NOT EXISTS goal_exh TEXT`);
  console.log('✓ contact_rounds.goal_exh');
  await pool.end();
})();
