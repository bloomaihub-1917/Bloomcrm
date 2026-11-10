/* 네임택 하단바·체크인 (2026-11-10, 등록 담당자 피드백)
     nametag_templates.bar_types  행사별 하단바 종류 [{ id, label, color }] — 설정 › 행사 상세 › 네임택
     nametag_people               행사 × 사람 한 줄: 하단바, 현장 신규의 이메일·전화, 마스터DB에 올린 연락처
     nametag_checkins             체크인 한 번 = 한 줄. 취소는 지우지 않고 voided_at. 살아 있는 체크인은 사람마다 하나
     nametag_prints.bar           그때 찍은 하단바 이름(찍은 값 그대로)
   현장 신규는 person_key를 w<첫 발급 id>로 받는다 — 나중에 하단바를 채우고 체크인을 붙일 수 있게.
   현장 신규를 다시 뽑으면 재발급이라 «kind = walk_in ↔ source = walk_in» 제약을 «walk_in이면 source도 walk_in»으로 푼다.
   정의는 schema.sql 끝과 같다. 여러 번 돌려도 안전하다.
     node db/migrations/add-nametag-checkin.js */
require('dotenv').config();
const pool = require('../pool');
(async () => {
  await pool.query(`ALTER TABLE nametag_templates ADD COLUMN IF NOT EXISTS bar_types JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE nametag_prints ADD COLUMN IF NOT EXISTS bar TEXT`);
  await pool.query(`ALTER TABLE nametag_prints DROP CONSTRAINT IF EXISTS nametag_prints_walk_in`);
  await pool.query(`ALTER TABLE nametag_prints ADD CONSTRAINT nametag_prints_walk_in CHECK (kind <> 'walk_in' OR source = 'walk_in')`);
  await pool.query(`CREATE TABLE IF NOT EXISTS nametag_people (
    event_id TEXT NOT NULL, person_key TEXT NOT NULL,
    bar TEXT, email TEXT, phone TEXT, contact_id TEXT,
    updated_at TEXT, updated_by TEXT,
    PRIMARY KEY (event_id, person_key))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS nametag_checkins (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, person_key TEXT NOT NULL,
    via TEXT NOT NULL CHECK (via IN ('print','desk')), print_id TEXT,
    checked_at TEXT NOT NULL, checked_by TEXT NOT NULL,
    voided_at TEXT, voided_by TEXT)`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS nametag_checkins_one_live ON nametag_checkins (event_id, person_key) WHERE voided_at IS NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS nametag_checkins_event_idx ON nametag_checkins (event_id, checked_at DESC)`);
  console.log('✓ nametag 하단바(bar_types·nametag_people·prints.bar) · 체크인(nametag_checkins)');
  await pool.end();
})();
