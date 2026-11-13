/* 네임택 사람별 글자 위치·크기를 저장할 칸 (2026-11-13)
     nametag_people.pos  { name: { dx, dy, ds }, … } — dx·dy는 판 자리에서 옮긴 mm, ds는 판 크기에서 바꾼 pt
   발급 데스크 «글자 위치·크기 · 이 사람만»에서 고친 값. 다시 뽑아도, 다른 데스크에서 뽑아도 그대로 쓴다.
   정의는 schema.sql 끝과 같다. 여러 번 돌려도 안전하다.
     node db/migrations/add-nametag-pos.js */
require('dotenv').config();
const pool = require('../pool');
(async () => {
  await pool.query(`ALTER TABLE nametag_people ADD COLUMN IF NOT EXISTS pos JSONB`);
  console.log('✓ nametag_people.pos — 사람별 글자 위치·크기');
  await pool.end();
})();
