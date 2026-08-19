-- Bloom CRM Postgres 스키마
-- 마이그레이션 프레임워크 없이 단일 스크립트로 관리한다.
-- 실행: psql "$DATABASE_URL" -f db/schema.sql
--
-- 컬럼명은 기존 Google Sheets 헤더(SHEET_HEADERS, backend/code.gs)와 최대한 1:1로
-- 맞췄다 — 프론트(js/api.js)가 보내는 row 배열의 위치가 헤더 순서와 그대로 대응되므로
-- 변환 코드를 최소화하기 위함이다. camelCase 컬럼은 대소문자 보존을 위해 큰따옴표로
-- 정의한다(따옴표 없이 쓰면 Postgres가 전부 소문자로 접어버린다).
--
-- 참조 컬럼(event_id/contact_id/sector/parent/canonical 등)에는 의도적으로
-- FOREIGN KEY 제약을 걸지 않는다 — 원본 Google Sheets는 이런 참조 무결성을
-- 전혀 강제하지 않았고(그래서 업로드가 아직 등록 안 된 섹터 값을 자유롭게 써도
-- 됐다), 업로드/일괄 저장 순서가 뒤바뀌면(예: 아직 sectors에 없는 카테고리명을
-- companies.sector로 먼저 저장) 엄격한 FK가 정상적인 업로드까지 막아버린다.
-- 대신 자주 JOIN하는 컬럼에는 인덱스만 걸어 조회 성능을 챙긴다.

CREATE TABLE IF NOT EXISTS sectors (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  parent    TEXT,
  domain    TEXT,
  canonical TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  short      TEXT,
  date_start TEXT,
  date_end   TEXT,
  location   TEXT,
  color      TEXT
);

CREATE TABLE IF NOT EXISTS part_types (
  key   TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  cls   TEXT
);

CREATE TABLE IF NOT EXISTS companies (
  key          TEXT PRIMARY KEY,
  sector       TEXT,
  hq           TEXT,
  website      TEXT,
  notes        TEXT,
  "catCode"    TEXT,
  country      TEXT,
  abbr         TEXT,
  source       TEXT,
  "updatedAt"  TEXT,
  "nameKo"     TEXT,
  "nameEn"     TEXT
);

CREATE TABLE IF NOT EXISTS contacts (
  id        TEXT PRIMARY KEY,
  "nameKo"  TEXT,
  "nameEn"  TEXT,
  "orgKo"   TEXT,
  "orgEn"   TEXT,
  "titleKo" TEXT,
  "titleEn" TEXT,
  "deptKo"  TEXT,
  "deptEn"  TEXT,
  country   TEXT,
  cat       TEXT,
  lang      TEXT,
  source    TEXT,
  date      TEXT,
  status    TEXT,
  email1    TEXT,
  email2    TEXT,
  phone1    TEXT,
  phone2    TEXT,
  beat      TEXT,
  products  TEXT,
  tags      TEXT
);

-- participations: 원본 시트의 '행사명'/'소속'/'성명'/'직함'은 ev_id/cid로부터
-- 파생되는 비정규화 캐시 컬럼이라 저장하지 않는다. 읽을 때 events/contacts와
-- JOIN해서 그 자리에서 계산해 응답하면 프론트는 차이를 못 느낀다.
CREATE TABLE IF NOT EXISTS participations (
  id         TEXT PRIMARY KEY,
  event_id   TEXT,
  contact_id TEXT,
  role       TEXT,
  note       TEXT,
  matched    TEXT
);
CREATE INDEX IF NOT EXISTS idx_participations_event   ON participations(event_id);
CREATE INDEX IF NOT EXISTS idx_participations_contact ON participations(contact_id);

CREATE TABLE IF NOT EXISTS crm_targets (
  id             TEXT PRIMARY KEY,
  name           TEXT,
  "nameEn"       TEXT,
  sector         TEXT,
  hq             TEXT,
  event          TEXT,
  role           TEXT,
  status         TEXT,
  priority       TEXT,
  assignee       TEXT,
  "currentStage" TEXT,
  "lastActivity" TEXT,
  log            TEXT
);

CREATE TABLE IF NOT EXISTS activity_log (
  id     TEXT PRIMARY KEY,
  ts     TEXT,
  email  TEXT,
  name   TEXT,
  type   TEXT,
  action TEXT,
  target TEXT,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
