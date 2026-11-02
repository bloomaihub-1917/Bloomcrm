# 구조 리팩토링 계획 (refactor/structure 브랜치)

화면이 하는 일은 그대로 두고, 코드가 놓인 자리만 기능별로 바로잡는다.
master는 건드리지 않고 이 브랜치에서 진행하며, master가 앞서가면 수시로 받아 맞춘다.

## 지키는 것

- 동작을 바꾸지 않는다. 커밋 하나에는 한 종류의 이동만 담는다.
- `window.함수명`과 HTML 문자열 속 `onclick="…"` 이름은 그대로 둔다(약 800개가 공개 약속이다).
- 함수를 옮기면 옛 파일에서 다시 내보내(re-export) 단계마다 화면이 돈다. 다 옮긴 뒤에 걷어 낸다.
- 확인은 테스트 로그인(test/test/test)으로만 한다. 서버 주소가 비워져 운영 데이터에 닿지 않는다.

## 안전망 (scripts/refactor/)

| 도구 | 하는 일 |
|---|---|
| `node scripts/refactor/deps.js --check` | import한 파일·이름이 실제로 있는지, 서로 import하는 쌍과 순환 덩어리, 큰 파일 |
| `smoke.mjs` | 테스트 로그인 뒤 콘솔에서 `(await import('…/scripts/refactor/smoke.mjs')).run()` — 탭 10개를 다 열어 에러를 모으고, `window-baseline.json`(전역 함수 785개)과 견줘 빠진 이름을 알린다 |

시작 때(2026-11-03): 서로 import하는 쌍 10개, 19개 파일이 얽힌 순환 덩어리 1개.

## 파트별 계획

### 파트 A. 공용 기반 — `js/core/`
| 할 일 | 상태 |
|---|---|
| 활동 기록 남기기(`trackAction`·`changed`·`removed`·`created`) → `core/audit-log.js` | ✅ |
| `state.js`를 표 데이터 / UI 필터 상태 / 파생 조회로 나누고 `state.js`는 입구로 | |
| `api.js`를 공통 통신·로드 / 기능별 저장으로 나누고 `api.js`는 입구로 | |

### 파트 B. 도메인 헬퍼 — `js/domain/`
| 할 일 | 상태 |
|---|---|
| 섹터 헬퍼(`findSectorByName`·`domainOfSector`·`mainSectors` …) — 설정 탭에서 꺼내기 | |
| 기업 조회·생성(`normalizeCompanyKey`·`orgIdForName`·`createOrg`·`buildCoDB`) — 기업 탭에서 꺼내기 | |
| 차수 조회(`roundById`·`membersOf` …) — 컨택 탭에서 꺼내기 | |

이것이 끝나면 `company-tab ↔ settings-tab/db-tab` 고리가 풀린다.

### 파트 C. 마스터DB·기업DB·행사DB·CRM·컨택
`db-tab`(3,200줄)·`company-tab`(2,700줄)을 구획 제목대로 쪼갠다.
폴더: `js/features/mdb`, `companies`, `events`, `crm`, `contacts`, `partnering`.

### 파트 D. 전시 — `js/features/exhibition/`
- `exh-tab`(5,900줄): 집계 헬퍼를 `exh-calc.js`로 먼저 꺼낸다(`exh-bulkmail ↔ exh-tab` 고리 해소).
  그 뒤 사이드바 / 목록 / 품목 현황 / 금액 / 프로그램북·도록 / 대시보드 / 추가·불러오기 / 저장·충돌 / 설정 모달로.
- `exh-drawer`(4,300줄): 진행 / 정산 / 그래픽 / 문의·기록 / AI / 메일로.

### 파트 E. 컨퍼런스·연사 — `js/features/conference/`
- `spCell`·`SP_COLS`·잠금 등 공용을 `conf-common.js`로 (`conf-tab ↔ speaker-flow/conf-dash/speaker-share` 해소).
- `conf-tab`(2,900줄)·`speaker-drawer`(2,300줄)을 구획대로 쪼갠다.

### 파트 F. 메일 공통 — `js/shared/mail/`
`mail-templates`·`mail-vars`·`mail-preview`·`mail-pane`·`mail-mark`·`mail-original`·`var-chips`·`follow-up`·`flow-editor`·`ai-mail-draft`.
`mail-templates → settings-tab` 의존을 끊는다(필요한 것은 파트 B 헬퍼로).

### 파트 G. 설정·업로드·활동 로그
`settings-tab`(3,750줄)을 섹터 / 분야·태그·참가유형 / 행사 관리 / 코드 목록 / 기본 품목 / 카탈로그 / 행사 상세 / 컨퍼런스 설정으로.

### 파트 H. 전시·연사 중복 합치기 (뒤에)
일괄 메일 엔진, 진행 완료 잠금, «✨ 상황 물어보기». 둘이 미묘하게 달라 하나씩 견주어 정한다.

### 파트 I. 서버 — `backend-node/`
- `routes/mail.js`(1,500줄) → 계정 / 발송 / 보낸 메일 / 받은 메일 / 주인 없는 메일 / 분류.
- `db/` → `lib/`(pool, contact-ids) · `migrations/`(add-*) · `oneoff/`. 옮길 때 CLAUDE.md의 스크립트 경로도 고친다.

## 순서
A(기록) → B → D·E의 공용 꺼내기 → F → 폴더 옮기기 → 큰 파일 쪼개기(C·D·E·G) → A(state·api) → H → I
