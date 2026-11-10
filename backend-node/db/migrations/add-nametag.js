/* 네임택 발급 표 둘을 만든다 (2026-11-10)
   bizmatching의 네임택 발급(nametag-package)을 CRM에 옮겨 오면서 id·날짜를 이 저장소 방식(TEXT)으로 바꿨다.
     nametag_templates  행사별 네임택 판(용지 크기·글자 자리·국영문). 기본 판은 행사마다 하나
     nametag_prints     출력물 한 장 = 한 줄. 찍은 값을 그대로 남긴다(나중에 소속·직함이 바뀌어도 기록은 그대로).
                        인쇄가 안 됐으면 지우지 않고 voided_at으로 되돌린다
   정의는 schema.sql 끝과 같다. 여러 번 돌려도 안전하다.
     node db/migrations/add-nametag.js */
require('dotenv').config();
const pool = require('../pool');
(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS nametag_templates (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL,
    width_mm NUMERIC(5,1) NOT NULL, height_mm NUMERIC(5,1) NOT NULL,
    lang TEXT NOT NULL DEFAULT 'auto',
    background_data TEXT, background_print BOOLEAN NOT NULL DEFAULT false,
    layout JSONB NOT NULL, print_offset JSONB NOT NULL DEFAULT '{"x":0,"y":0,"scale":100}'::jsonb,
    is_default BOOLEAN NOT NULL DEFAULT false,
    updated_at TEXT, updated_by TEXT,
    UNIQUE (event_id, name))`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS nametag_templates_one_default ON nametag_templates (event_id) WHERE is_default`);
  await pool.query(`CREATE TABLE IF NOT EXISTS nametag_prints (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, batch_id TEXT NOT NULL, template_id TEXT,
    person_key TEXT, source TEXT NOT NULL CHECK (source IN ('part','speaker','exh','walk_in')),
    ref_id TEXT, contact_id TEXT,
    name TEXT NOT NULL, company TEXT, job_title TEXT, badge TEXT, lang TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('issue','reissue','walk_in')), reason TEXT,
    printed_by TEXT NOT NULL, printed_at TEXT NOT NULL,
    voided_at TEXT, voided_by TEXT,
    CONSTRAINT nametag_prints_reissue_reason CHECK (kind <> 'reissue' OR reason IS NOT NULL),
    CONSTRAINT nametag_prints_walk_in CHECK ((kind = 'walk_in') = (source = 'walk_in')))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS nametag_prints_event_idx ON nametag_prints (event_id, printed_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS nametag_prints_person_idx ON nametag_prints (event_id, person_key)`);
  console.log('✓ nametag_templates · nametag_prints — 네임택 발급');
  await pool.end();
})();
