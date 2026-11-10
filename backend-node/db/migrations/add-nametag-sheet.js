/* 네임택 판에 «출력 종이» 칸을 더한다 (2026-11-10)
     a4   A4 쪽 맨 위 가운데에 한 장씩(기본) — 100 × 120mm 종이를 그 크기로 알려 주면 프린터가 안 받아서,
          A4로 알려 주고 네임택 종이를 그대로 넣어 위쪽만 찍는다
     fit  네임택 크기 그대로 — 프린터가 그 크기를 받을 때
   정의는 schema.sql 끝과 같다. 여러 번 돌려도 안전하다.
     node db/migrations/add-nametag-sheet.js */
require('dotenv').config();
const pool = require('../pool');
(async () => {
  await pool.query(`ALTER TABLE nametag_templates ADD COLUMN IF NOT EXISTS sheet TEXT NOT NULL DEFAULT 'a4'`);
  await pool.query(`ALTER TABLE nametag_templates ALTER COLUMN sheet SET DEFAULT 'a4'`);
  console.log('✓ nametag_templates.sheet — 출력 종이(a4 | fit), 기본 a4');
  await pool.end();
})();
