/* 체크인 데스크 «불참» (2026-11-20)
     nametag_people.absent_at · absent_by — 오지 않는다고 확인한 시각·누가. 되돌리면 둘 다 NULL
   정의는 schema.sql 끝과 같다. 여러 번 돌려도 안전하다.
     node db/migrations/add-nametag-absent.js */
require('dotenv').config();
const pool = require('../pool');
(async () => {
  await pool.query(`ALTER TABLE nametag_people ADD COLUMN IF NOT EXISTS absent_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE nametag_people ADD COLUMN IF NOT EXISTS absent_by TEXT`);
  console.log('✓ nametag_people.absent_at·absent_by — 체크인 데스크 불참');
  await pool.end();
})();
