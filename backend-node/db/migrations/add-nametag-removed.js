/* 네임택 현장 신규 «삭제» (2026-11-20)
     nametag_people.removed_at · removed_by — 지운 현장 신규(시험·STAFF 등). 명단·결과보고·마스터DB 올리기에서 빠진다.
   발급·체크인 기록은 지우지 않고 남긴다. 되살리면 둘 다 NULL.
   정의는 schema.sql 끝과 같다. 여러 번 돌려도 안전하다.
     node db/migrations/add-nametag-removed.js */
require('dotenv').config();
const pool = require('../pool');
(async () => {
  await pool.query(`ALTER TABLE nametag_people ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE nametag_people ADD COLUMN IF NOT EXISTS removed_by TEXT`);
  console.log('✓ nametag_people.removed_at·removed_by — 현장 신규 삭제');
  await pool.end();
})();
