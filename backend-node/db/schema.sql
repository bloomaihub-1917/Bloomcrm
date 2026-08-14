-- Bloom CRM Postgres 스키마
-- 마이그레이션 프레임워크 없이 단일 스크립트로 관리한다.
-- 실행: psql "$DATABASE_URL" -f db/schema.sql
--
-- 컬럼명은 기존 Google Sheets 헤더(SHEET_HEADERS, backend/code.gs)와 최대한 1:1로
-- 맞췄다 — 프론트(js/api.js)가 보내는 row 배열의 위치가 헤더 순서와 그대로 대응되므로
-- 변환 코드를 최소화하기 위함이다. camelCase 컬럼은 대소문자 보존을 위해 큰따옴표로
-- 정의한다(따옴표 없이 쓰면 Postgres가 전부 소문자로 접어버린다).

CREATE TABLE IF NOT EXISTS sectors (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  parent    TEXT REFERENCES sectors(id),
  domain    TEXT,
  canonical TEXT REFERENCES sectors(id)
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
  sector       TEXT REFERENCES sectors(id),
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
  event_id   TEXT REFERENCES events(id),
  contact_id TEXT REFERENCES contacts(id),
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
  sector         TEXT REFERENCES sectors(id),
  hq             TEXT,
  event          TEXT REFERENCES events(id),
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
