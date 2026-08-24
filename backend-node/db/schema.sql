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

-- ══════════════════════════════════════════
--  전시 참가기업 진행관리 (전시 탭)
--  기존 crm_targets(일반 영업 파이프라인)와 별개로, 전시 참가기업의
--  매뉴얼→신청서→부스→정산→그래픽→도록→현장 실무 흐름을 추적한다.
--  위 테이블들과 달리 컬럼명을 전부 snake_case로 통일했다 — 신규 테이블은
--  구글시트 헤더와 1:1로 맞출 이유가 없고, camelCase 큰따옴표 인용을 피할 수 있다.
-- ══════════════════════════════════════════

-- 기업 × 행사 1건. 체크리스트 본체(1:1 항목만 여기 둔다).
CREATE TABLE IF NOT EXISTS exhibitors (
  id           TEXT PRIMARY KEY,
  event_id     TEXT,
  company_key  TEXT,   -- CO_DB 정규화 키
  company_name TEXT,   -- 표시용 스냅샷
  assignee     TEXT,   -- 우리 팀 담당자
  status       TEXT,
  note         TEXT,
  updated_at   TEXT,

  -- 기업측 담당자(우리가 실제로 메일 주고받는 상대). assignee(우리 팀 담당)와는
  -- 다른 개념이라 별도 컬럼으로 둔다. 세금계산서 담당자는 또 따로 있다(아래).
  -- contact_id가 있으면 마스터DB(contacts)의 그 사람을 가리키고, 이름/이메일/
  -- 연락처는 거기서 실시간으로 읽는다(복사본을 들고 있으면 마스터DB에서 고쳐도
  -- 여기가 옛 값으로 남기 때문). 마스터DB에 없는 사람은 아래 텍스트 필드로 적는다.
  contact_id    TEXT,
  contact_name  TEXT,
  contact_email TEXT,
  contact_phone TEXT,

  -- 1. 매뉴얼
  manual_sent_at     TEXT,
  manual_replied_at  TEXT,

  -- 2. 신청서
  -- 관리대장에는 제출 여부가 O/X로만 있고 날짜가 없는 건이 많다. 날짜를 지어내지
  -- 않기 위해 "받았다"는 사실(app_received)과 "언제"(app_received_at)를 나눠 둔다.
  app_received       TEXT,  -- 'yes' | ''
  app_received_at    TEXT,
  app_complete       TEXT,  -- 'yes' | 'no' | ''
  app_missing        TEXT,  -- 누락 항목 메모
  extra_equipment    TEXT,  -- 추가 비품 신청 내역

  -- 3. 부스 배정
  booth_no           TEXT,
  booth_confirmed_at TEXT,

  -- 4. 세금계산서 (인보이스/입금은 1:N이라 별도 테이블)
  tax_sent_at        TEXT,
  tax_amount         TEXT,
  tax_contact_name   TEXT,
  tax_contact_email  TEXT,
  tax_contact_phone  TEXT,

  -- 5. 그래픽
  graphic_ordered_at TEXT,
  graphic_type       TEXT,  -- 'design'(제작) | 'print'(출력) | ''
  graphic_spec_ok    TEXT,  -- 'yes' | 'no' | ''  (출력일 때 규격 적합 여부)
  graphic_spec_note  TEXT,
  graphic_draft_at   TEXT,  -- 초안
  graphic_revised_at TEXT,  -- 수정안
  graphic_final_at   TEXT,  -- 최종안 확정

  -- 6. 도록/디렉토리 (신청서와 같은 이유로 여부/날짜를 분리)
  directory_received    TEXT,  -- 'yes' | ''
  directory_received_at TEXT,
  directory_note        TEXT,

  -- 7. 현장
  movein_at        TEXT,
  builder          TEXT,   -- 설치업체
  badge_count      TEXT,
  badge_issued_at  TEXT,
  onsite_note      TEXT
);
CREATE INDEX IF NOT EXISTS idx_exhibitors_event ON exhibitors(event_id);

-- 기업측 담당자 (여러 명). 한 기업에 실무·정산·현장 담당이 따로인 경우가 많다.
-- contact_id가 있으면 마스터DB(contacts)를 가리키고 이름/이메일/연락처는 거기서
-- 실시간으로 읽는다. 마스터DB에 없는 사람은 아래 name/email/phone에 직접 적는다.
-- is_primary='yes'인 한 명이 목록·헤더에 대표로 표시된다.
CREATE TABLE IF NOT EXISTS exhibitor_contacts (
  id           TEXT PRIMARY KEY,
  exhibitor_id TEXT,
  contact_id   TEXT,
  name         TEXT,
  email        TEXT,
  phone        TEXT,
  role         TEXT,   -- 실무 | 정산 | 현장 | 기타
  is_primary   TEXT,   -- 'yes' | ''
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_exhibitor_contacts_exh ON exhibitor_contacts(exhibitor_id);

-- 금액 항목. 전기·인터넷·카펫처럼 예상 못 한 항목이 계속 나오므로 줄 단위로 자유 추가.
CREATE TABLE IF NOT EXISTS exhibitor_items (
  id           TEXT PRIMARY KEY,
  exhibitor_id TEXT,
  category     TEXT,  -- 'booth' | 'equip' | 'graphic' | 'etc'
  name         TEXT,
  qty          TEXT,
  unit_price   TEXT,
  amount       TEXT,
  currency     TEXT,   -- 'KRW' | 'USD' (비우면 KRW)
  note         TEXT,
  sort_order   TEXT
);
CREATE INDEX IF NOT EXISTS idx_exhibitor_items_exh ON exhibitor_items(exhibitor_id);

-- 인보이스. "부스+비품 먼저, 그래픽 나중"처럼 나눠 발행하거나 한 장에 합쳐 발행하는
-- 두 방식이 다 쓰이므로 1:N으로 둔다.
CREATE TABLE IF NOT EXISTS exhibitor_invoices (
  id           TEXT PRIMARY KEY,
  exhibitor_id TEXT,
  title        TEXT,
  created_at   TEXT,
  sent_at      TEXT,
  due_date     TEXT,   -- 입금 예정일
  amount       TEXT,
  currency     TEXT,   -- 'KRW' | 'USD' (비우면 KRW)
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_exhibitor_invoices_exh ON exhibitor_invoices(exhibitor_id);

-- 입금. 분할 입금 대응 — 완납 여부는 플래그를 두지 않고 입금액 합계로 계산한다
-- (플래그와 실제 금액이 어긋나는 사고를 원천 차단).
CREATE TABLE IF NOT EXISTS exhibitor_payments (
  id           TEXT PRIMARY KEY,
  exhibitor_id TEXT,
  invoice_id   TEXT,
  paid_at      TEXT,
  amount       TEXT,
  currency     TEXT,   -- 'KRW' | 'USD' (비우면 KRW)
  method       TEXT,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_exhibitor_payments_exh ON exhibitor_payments(exhibitor_id);

-- 문의사항 + 자유 기록. 한 테이블에 두는 이유는 기록 탭에서 둘이 시간순 한 줄기로
-- 보여야 맥락이 이어지기 때문. 미답변은 kind='inquiry' AND answered_at IS NULL로 뽑는다.
CREATE TABLE IF NOT EXISTS exhibitor_logs (
  id           TEXT PRIMARY KEY,
  exhibitor_id TEXT,
  kind         TEXT,  -- 'inquiry'(문의) | 'note'(기록)
  ts           TEXT,
  direction    TEXT,  -- 'in'(수신) | 'out'(발신) | ''
  channel      TEXT,  -- 이메일 | 전화 | 카톡 | 미팅 | 현장
  counterpart  TEXT,  -- 기업측 담당자
  category     TEXT,  -- 부스 | 비품 | 그래픽 | 정산 | 현장 | 기타
  subject      TEXT,
  body         TEXT,
  answered_at  TEXT,
  answer       TEXT,
  status       TEXT,  -- 'open' | 'hold' | 'done'
  author_email TEXT,
  author_name  TEXT
);
CREATE INDEX IF NOT EXISTS idx_exhibitor_logs_exh ON exhibitor_logs(exhibitor_id);
CREATE INDEX IF NOT EXISTS idx_exhibitor_logs_open ON exhibitor_logs(kind, answered_at);
