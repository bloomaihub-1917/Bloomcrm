/* 네임택 사람별로 고친 글자를 저장할 칸 (2026-11-13)
     nametag_people.edits  { name, company, job_title, badge, lang } — 발급 데스크에서 고친 값(줄바꿈 포함). 없는 칸은 원래 값
   다시 뽑아도, 다른 데스크에서 뽑아도 그대로 쓴다. 마스터DB 연락처는 고치지 않는다.
   정의는 schema.sql 끝과 같다. 여러 번 돌려도 안전하다.
     node db/migrations/add-nametag-edits.js */
require('dotenv').config();
const pool = require('../pool');
(async () => {
  await pool.query(`ALTER TABLE nametag_people ADD COLUMN IF NOT EXISTS edits JSONB`);
  console.log('✓ nametag_people.edits — 사람별로 고친 글자');
  await pool.end();
})();
