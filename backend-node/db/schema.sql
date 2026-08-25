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
  status       TEXT,   -- 준비중 | 취소
  note         TEXT,
  updated_at   TEXT,

  -- 기업측 담당자는 여러 명일 수 있어 exhibitor_contacts 테이블로 분리했다.
  -- 세금계산서 담당자(tax_contact_*)는 성격이 달라 아래에 그대로 둔다.

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
  -- 확정 참가기업 리스트에 부스가 배정돼 있으면 확정으로 본다(날짜는 기록이 없어
  -- booth_confirmed 플래그만 켜고, 알게 되면 booth_confirmed_at을 채운다).
  booth_no           TEXT,
  booth_floor        TEXT,   -- 층
  booth_type         TEXT,   -- Self-Construction | Block System A/B/C | Lighting Booth | Octanium ...
  booth_qty          TEXT,
  grade              TEXT,   -- DIA | GOLD | SILVER | BRONZE | Exhibitor (스폰서 등급)
  booth_confirmed    TEXT,   -- 'yes' | ''
  booth_confirmed_at TEXT,

  -- 4-0. 정산 마무리
  -- 해외 송금 수수료가 빠져 몇 달러 덜 들어오는 일이 흔한데, 그대로 두면 영원히
  -- 미납으로 남아 계속 독촉하게 된다. 사유를 적고 완납으로 닫을 수 있게 한다.
  settled       TEXT,  -- 'yes' | ''
  settled_note  TEXT,  -- 완납 처리 사유 (예: 송금 수수료 8 USD 차감)
  pay_due_date  TEXT,  -- 이 기업만의 입금 기한 (행사 공통 기한을 덮어씀)

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
-- is_primary='yes'인 한 명이 목록·헤더에 메인으로 표시된다.
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
  -- 통화 변경·금액 오류로 다시 발행하는 일이 잦다. 지우지 않고 무효로 표시해
  -- 이력은 남기되 청구액 합계에서는 뺀다(둘 다 살아있으면 합계가 2배가 된다).
  status       TEXT,   -- '' (유효) | 'void' (취소·대체됨)
  void_note    TEXT,   -- 무효 사유 (예: EX-55-01 USD → KRW로 대체)
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
  kind         TEXT,   -- '' | 'in'(입금) | 'refund'(환불 — 합계에서 차감)
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

/* ══════════════════════════════════════════════════════════════
   orgs — 기업 마스터

   전에는 기업이라는 레코드가 따로 없었다. 화면에 보이던 기업 목록은 매번
   contacts의 소속 문자열을 정규화해 묶어 만든 파생물이었고, companies 테이블은
   거기에 섹터·메모를 덧칠하는 오버레이였다. 이 구조에는 두 가지 문제가 있었다.

   - 식별자가 이름 그 자체라, 이름을 고치면 키가 바뀌어 다른 회사가 된다.
     실제로 '압타머사이언스 CRO 센터'를 '츌립앤사이언스'로 바꿨을 때 섹터와
     메모를 담고 있던 오버레이가 옛 키에 남아 화면에서 사라졌다.
   - 연락처가 없으면 기업이 존재할 수 없다. 아직 담당자를 모르는 잠재 고객사나
     시공 벤더를 미리 등록해 둘 방법이 없었다.

   그래서 기업을 이름과 무관한 안정 id를 가진 1급 레코드로 올리고, contacts와
   exhibitors가 문자열이 아니라 이 id를 가리키게 한다. 이름 스냅샷(company_name
   등)은 그대로 두되 표시는 orgs에서 읽는다 — 한 곳만 고치면 전부 따라온다.
══════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS orgs (
  id          TEXT PRIMARY KEY,   -- O-xxxxx. 이름과 무관하게 고정된다
  name_ko     TEXT,
  name_en     TEXT,
  abbr        TEXT,
  -- 예전 이름·표기 흔들림을 줄바꿈으로 모아둔다. 이름이 바뀌어도 옛 이름으로
  -- 검색되고, 옛 이름으로 들어온 업로드를 같은 회사로 붙일 수 있다.
  aliases     TEXT,
  kind        TEXT,   -- 전시참가기업 | 잠재고객사 | 벤더시공사
  status      TEXT,   -- 활성 | 휴면 | 거래종료
  sectors     TEXT,   -- 복수 섹터를 구분자로 이어 붙인 값(기존 companies.sector와 동일 형식)
  country     TEXT,
  hq          TEXT,
  website     TEXT,
  biz_no      TEXT,   -- 사업자등록번호 — 세금계산서에 필요한데 지금은 적어둘 곳이 없다
  cat_code    TEXT,
  notes       TEXT,
  source      TEXT,
  created_at  TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_orgs_kind ON orgs(kind);

-- 기존 두 테이블이 orgs를 가리키게 한다(FK는 다른 참조와 같은 이유로 걸지 않는다)
ALTER TABLE contacts   ADD COLUMN IF NOT EXISTS org_id TEXT;
ALTER TABLE exhibitors ADD COLUMN IF NOT EXISTS org_id TEXT;
CREATE INDEX IF NOT EXISTS idx_contacts_org   ON contacts(org_id);
CREATE INDEX IF NOT EXISTS idx_exhibitors_org ON exhibitors(org_id);

/* ── 환불 요청 추적 ──
   환불은 "요청받았다"와 "실제로 보냈다" 사이에 시간이 뜬다. 그동안에도 합계에서
   빼버리면 아직 나가지 않은 돈이 이미 나간 것처럼 보인다 — 상태를 나눠 두고
   완료된 것만 입금액에서 차감한다. */
ALTER TABLE exhibitor_payments ADD COLUMN IF NOT EXISTS status       TEXT;  -- 'requested'(요청) | 'done'(완료)
ALTER TABLE exhibitor_payments ADD COLUMN IF NOT EXISTS requested_at TEXT;
ALTER TABLE exhibitor_payments ADD COLUMN IF NOT EXISTS reason       TEXT;  -- 환불 사유

/* ── 독립부스 시공사 ──
   자체 시공(Self-Construction) 업체는 부스를 직접 짓기 때문에 현장에서 우리가
   연락할 상대가 참가기업 담당자가 아니라 시공사다. 지금은 업체명(builder) 한 칸뿐이라
   반입 당일 연락처를 메일에서 다시 찾아야 했다. */
ALTER TABLE exhibitors ADD COLUMN IF NOT EXISTS builder_contact TEXT;   -- 시공 담당자
ALTER TABLE exhibitors ADD COLUMN IF NOT EXISTS builder_tel     TEXT;   -- 유선번호
ALTER TABLE exhibitors ADD COLUMN IF NOT EXISTS builder_mobile  TEXT;   -- 휴대폰
ALTER TABLE exhibitors ADD COLUMN IF NOT EXISTS builder_email   TEXT;

/* ══════════════════════════════════════════════════════════════
   equip_catalog — 렌탈 비품 카탈로그

   참가기업이 신청하는 비품(의자·테이블·진열대·가전)의 품목표다. 지금까지는
   exhibitor_items에 이름을 손으로 적어 넣어서, 같은 의자가 "접이식 체어",
   "C-040 Folding Chair", "폴딩체어"로 제각각 들어왔다. 그러면 발주할 때
   품목별 합계가 갈라지고 단가도 매번 다시 찾아야 한다.

   행사별로 나눠 둔다(event_id). 행사마다 렌탈사가 다르고 단가도 바뀌기 때문에,
   지난 행사의 카탈로그를 그대로 두고 새 행사용을 따로 만들어야 옛 주문의 단가가
   보존된다. 새 행사를 열 때는 이전 카탈로그를 복제해 단가만 손보면 된다
   (db/clone-catalog.js).

   code는 행사 안에서만 유일하다 — 같은 C-011이 행사마다 다른 가격일 수 있다.
══════════════════════════════════════════════════════════════ */
CREATE TABLE IF NOT EXISTS equip_catalog (
  id         TEXT PRIMARY KEY,   -- EC-xxxxx
  event_id   TEXT,               -- 어느 행사의 품목표인가
  category   TEXT,               -- 의자 | 테이블 | 진열대 | 가전제품 | 기타비품
  code       TEXT,               -- C-011, T-030 …  (행사 안에서 유일)
  name_ko    TEXT,
  name_en    TEXT,
  spec       TEXT,               -- 규격(mm)
  price_krw  TEXT,
  price_usd  TEXT,
  note       TEXT,
  -- 단종된 품목은 지우지 않고 내린다. 지우면 이미 그 품목을 신청한 기업의
  -- 주문이 무엇을 가리키는지 알 수 없게 된다.
  active     TEXT,               -- '' | 'no'(목록에서 숨김)
  sort_order TEXT
);
CREATE INDEX IF NOT EXISTS idx_equip_catalog_event ON equip_catalog(event_id);
CREATE INDEX IF NOT EXISTS idx_equip_catalog_code  ON equip_catalog(event_id, code);

/* 신청 내역이 카탈로그의 어느 품목인지 가리킨다. 이름만 적혀 있으면 표기가
   흔들려 집계가 갈라지므로, 고른 품목의 id를 남긴다(직접 입력한 항목은 빈 값). */
ALTER TABLE exhibitor_items ADD COLUMN IF NOT EXISTS catalog_id TEXT;
