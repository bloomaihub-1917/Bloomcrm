/* 네임택 판에 «출력 종이» 칸을 더한다 (2026-11-10)
     fit  네임택 크기 그대로(전용 용지·라벨지) — 한 장 = 네임택 한 장
     a4   A4 세로 종이 맨 위 가운데에 한 장씩 — 전용 용지가 없을 때 A4에 뽑아 자른다
   정의는 schema.sql 끝과 같다. 여러 번 돌려도 안전하다.
     node db/migrations/add-nametag-sheet.js */
require('dotenv').config();
const pool = require('../pool');
(async () => {
  await pool.query(`ALTER TABLE nametag_templates ADD COLUMN IF NOT EXISTS sheet TEXT NOT NULL DEFAULT 'fit'`);
  console.log('✓ nametag_templates.sheet — 출력 종이(fit | a4)');
  await pool.end();
})();
