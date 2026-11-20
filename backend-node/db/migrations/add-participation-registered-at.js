/* 참가 등록일 (2026-11-20) — 결과보고 «일자별 등록 추이»
     participations.registered_at  TEXT 'YYYY-MM-DD HH:MM'(한국 시각) — 그 사람이 행사에 등록(신청)한 때.
   CRM 신청서로 오면 신청 시각(register_submissions.created_at)을 넣는다(routes/register.js).
   confirmed_at(참가 확정일)은 우리가 확정·들여온 날이라 등록 추이로 쓰지 않는다.
   정의는 schema.sql 끝과 같다. 여러 번 돌려도 안전하다.
     node db/migrations/add-participation-registered-at.js */
require('dotenv').config();
const pool = require('../pool');
(async () => {
  await pool.query(`ALTER TABLE participations ADD COLUMN IF NOT EXISTS registered_at TEXT`);
  console.log('✓ participations.registered_at — 등록(신청) 시각');
  await pool.end();
})();
