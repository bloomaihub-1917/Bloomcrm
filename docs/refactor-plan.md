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
| `node scripts/refactor/deps.js --check` | import한 파일·이름이 실제로 있는지, **쓰는데 선언·import가 없는 이름**(함수마다 따로 본다), 서로 import하는 쌍과 순환 덩어리, 큰 파일 |
| `smoke.mjs` | 테스트 로그인 뒤 콘솔에서 `(await import('…/scripts/refactor/smoke.mjs')).run()` — 탭 10개와 설정 하위 탭 9개를 열어 에러를 모으고, `window-baseline.json`(전역 함수 785개)과 견줘 빠진 이름을 알린다 |
| `fingerprint.mjs` | 계산 결과 지문 — 전시 참가기업마다 정산·진행 칸, 기업 뷰(CO_DB), 연사마다 받을 것 칸·다음 연락을 해시로. master 화면과 이 브랜치 화면에서 각각 돌려 같은지 본다 |
| `render-hash.mjs` | 화면 그림 지문 — 컨퍼런스 5개·전시 9개 보기와 마스터DB·기업·행사·CRM·파트너링·활동 로그 탭의 HTML을 해시로. **새로 로그인한 직후** master와 견준다(앞서 누른 거르개가 남아 있으면 다르게 나온다) |
| `flow-hash.mjs` | 창 열기 지문 — `run`: 연락처 상세·고치기·참여 행사 추가·퇴사·직접 추가, 기업 상세·참여 이력 추가, 설정 › 기업 분류·비슷한 기업(13단계). `runExh`: 전시 목록·일괄 메일·참가기업 상세 창 3곳의 모든 하위 탭·대시보드(34단계). 화면 전체를 해시하되 로그인 시각과 «마지막 동기화» 시각은 뺀다(두 화면 사이에 분이 넘어가면 달라진다). **새로 로그인한 직후 맨 먼저** 돌린다 |
| `sections.js` / `split-leaf.js` | 큰 파일의 구획끼리 무엇을 부르는지 / «뗄 수 있음» 구획을 한 방향으로 떼기 |
| `lift-state.js` | 탭의 화면 상태(let)를 공유 객체로 — 그래야 상태를 고치는 구획도 뗄 수 있다 |
| `flow-hash.mjs` `runUpload` | 엑셀을 브라우저에서 만들어 실제로 올린다(읽기 → 저장 → 처음으로, 로그·병합 하위 탭). 새 연락처 id(지금 시각 기준)와 ISO 시각은 빼고 센다 |
| `free-names.js` | 옮기기 전에 — 그 줄 범위가 바깥에서 빌려 쓰는 이름 |
| `move.js` / `rewire.js` | 줄 범위를 새 파일로 옮기고 import를 다시 잇는다 / 옛 파일에서 가져가던 이름을 새 파일로 돌린다 |

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
| 섹터 헬퍼 14개 → `domain/sectors.js` (설정 탭에서) | ✅ |
| 기업 이름 다루기(`normalizeCompanyKey`·`stripLegalForm`·`abbrOf` …) → `domain/org-names.js` | ✅ |
| 업종 추천·업로드 기업 등록·이름→id(`suggestSector`·`ensureOrgsForNames`·`orgIdForName`·`reloadOrgs`) → `domain/orgs.js` | ✅ |
| 기업 저장(`upsertCompanyRow`·`patchOrgFields`·`batchUpsertCompanies`) → `domain/org-save.js` | ✅ (파트 D 때) |
| `buildCoDB` → `domain/co-db.js`. 끝난 뒤 정렬·대시보드 다시 그리기는 기업 탭이 `onCoDbBuilt`로 건다 | ✅ (파트 D 때) |
| `createOrg` | 남음 — 저장 뒤 기업 목록을 다시 그려서 화면 쪽에 둔다 |
| 차수 조회 15개(`roundById`·`membersOf`·`coList`·`peopleOf` …) → `domain/rounds.js` | ✅ |

결과(2026-11-03): 서로 import하는 쌍 9 → 7. `company-tab ↔ settings-tab`, `db-tab ↔ settings-tab` 해소.
19개 파일 순환 덩어리는 아직 그대로 — `company-tab ↔ db-tab`(`buildCoDB`·`renderMDB`)과 `company-tab ↔ exh-tab`(금액 계산)이 남아 있다.

옮기기는 `node scripts/refactor/move.js <파일> <시작줄> <끝줄> <새 파일> "<import>" "<제목>"`으로 한다 — 범위를 잘라 새 파일에 넣고, 옛 파일에 다시 내보내기를 남기고, 다른 파일의 import를 새 자리로 돌린다.

### 파트 C. 마스터DB·기업DB·행사DB·CRM·컨택
| 할 일 | 상태 |
|---|---|
| `company-tab ↔ db-tab` 고리 — 기업 탭은 마스터DB를 `window.renderMDB`로 다시 그린다 | ✅ |
| `db-tab`에서 연락처 상세 창(보기·고치기·참여 행사 추가·직접 추가·퇴사 처리, 850줄) → `features/mdb/contact-drawer.js` | ✅ |
| `company-tab`에서 비슷한 기업 찾기·병합 → `features/companies/merge.js`, 참여 이력 직접 추가 → `features/companies/add-co-event.js` | ✅ |
| 남은 구획(목록·거르개·검색·질문으로 찾기·카드 뷰 / 섹터 거르개·대시보드·상세·인라인 편집) | 남음 — 서로를 많이 불러 «한 방향» 조건이 안 된다. `state.js`에서 화면 거르개 상태를 떼는 파트 A 뒤에 다시 본다 |
| 행사DB·CRM·컨택·파트너링 폴더로 옮기기 | |

**떼어 내는 방식 — 한 방향.** 떼어 낸 파일은 탭 파일의 도우미를 import하지만, 탭 파일은 그 파일을 import하지 않는다.
떼어 낸 파일이 스스로 `window`에 걸고 `app.js`가 읽는다. 화면의 onclick으로만 불리는 구획만 이렇게 뗄 수 있다.
`node scripts/refactor/sections.js <파일>`로 «뗄 수 있음»을 보고, `node scripts/refactor/split-leaf.js <파일> <시작> <끝> <새 파일> "<제목>"`으로 뗀다
(머리 import를 저절로 만들고, 탭 쪽 비공개 이름에 export를 붙이고, window 줄을 옮기고, app.js에 잇는다. 범위가 탭의 let 상태를 고치면 멈춘다).

결과(2026-11-03): 서로 import하는 쌍 3 → 2. `db-tab` 3,220 → 2,350줄, `company-tab` 2,290 → 1,920줄.
화면 20개·계산 지문·창 열기 13단계(`flow-hash.mjs`)가 master와 같다.

`deps.js`에 하나 더: import한 이름에 값을 다시 넣는 곳(«Assignment to constant variable»)을 찾는다 — 모듈 상태(let)를 고치는 구획을 다른 파일로 떼면 생긴다.

### 파트 D. 전시 — `js/features/exhibition/`
| 할 일 | 상태 |
|---|---|
| 금액·정산·환불·세금계산서·그래픽 단계·행사별 설정·마감 45개 → `features/exhibition/exh-calc.js` | ✅ |
| `EXH_ROLES`·`activeExhibitors`·`reloadExhibitors`도 같이 — 기업 탭이 전시 탭을 안 불러도 되게 | ✅ |
| 진행 단계(`STEPS`·`cellState`·`progressOf`) 꺼내기 → `exh-bulkmail ↔ exh-tab` 해소 | 남음 — 목록 거르기 상태(`exhFilter`·`stepFil`)와 저장(`patchExh`)·다시 그리기(`renderExh`)가 섞여 있어, exh-tab을 쪼갤 때 화면 상태와 계산을 갈라서 옮긴다 |
| `exh-tab`을 사이드바 / 목록 / 품목 현황 / 금액 / 프로그램북·도록 / 대시보드 / 추가·불러오기 / 저장·충돌 / 설정 모달로 | |

결과(2026-11-03): 서로 import하는 쌍 7 → 6, `company-tab ↔ exh-tab` 해소. 19개 파일 순환 덩어리가 13개(전시·연사·메일·설정)와 2개(`company-tab ↔ db-tab`)로 갈라졌다.
master와 이 브랜치의 계산 지문이 같다(참가기업 12곳·기업 16곳, `f54e38c4cc0eac84`).

배운 것: 옮긴 덩어리의 **비공개** 도우미(`num`)를 옛 파일이 계속 쓰고 있었는데, 옛 파일의 다른 함수 안에 같은 이름 지역 변수가 있어 낱말 검사에 가려졌다. 브라우저 대시보드에서 «num is not defined»로 드러났고, 그 뒤 `deps.js` 검사를 함수 단위로 바꿨다.
- `exh-drawer`(4,300줄): 진행 / 정산 / 그래픽 / 문의·기록 / AI / 메일로.

### 파트 E. 컨퍼런스·연사 — `js/features/conference/`
| 할 일 | 상태 |
|---|---|
| 진행 완료 잠금·동의 거절·숨긴 연사·식사/휴식 세션·가져온 이력 확인 대기·참가 역할 맞추기(`syncPartRole`) → `conf-common.js`. 잠금이 탭에서 고른 행사를 보던 것은 탭이 `onConfLockFallback`으로 알려 준다 | ✅ |
| 연사 표의 칸(`SP_COLS`·`spCell`·`SP_SENT`·`nextActionTd`) → `speaker-cells.js` | ✅ |
| 연사 창이 컨퍼런스 탭을 다시 그릴 때 `window.renderConf`로 — 창이 탭 화면 파일을 끌어오지 않게 | ✅ |
| `conf-tab`(2,600줄)·`speaker-drawer`(2,300줄)을 구획대로 쪼갠다 | |

남은 고리 하나: `speaker-cells ↔ speaker-flow`. 연락 칸은 다음 연락 단계를 보여 주고, 연락 단계는 칸으로 남은 자료를 센다 — 정말로 서로를 쓰는 한 덩어리다. 둘 다 함수가 불릴 때만 서로를 찾아서 읽는 순서 문제는 없다. `speaker-flow`를 `features/conference/`로 옮길 때 한 파일로 합칠지 정한다.

결과(2026-11-03): 서로 import하는 쌍 6 → 4. 13개 파일 순환 덩어리가 풀려 가장 큰 고리가 4개 파일(메일 양식·설정)이 됐다.
계산 지문(참가기업 12·기업 16·연사 10) `f2e06054438b53ee`, 화면 20개 HTML이 master와 같다.

이번에 찾은 누락 넷 — `SP_SENT`(브라우저 연사 목록에서 터짐), `escAttr`(같은 곳), `nextActionTd`, 그리고 파트 D 때 옮긴 `applyOrgLocal`(기업 병합이 실패할 때만 지나는 길이라 브라우저로는 못 본다). 뒤의 둘은 `deps.js`를 넓혀서 찾았다:
옮겨 받은 파일(core·domain·features)의 비공개 최상위 이름도 보고, 따옴표 안의 `${…}`는 지우지 않는다.

### 파트 F. 메일 공통 — `js/shared/mail/`
| 할 일 | 상태 |
|---|---|
| 컨퍼런스 설정 저장(`saveConf`)을 설정 탭에서 `conf-common.js`로 — 메일 양식·연락 단계 편집이 설정 탭 화면 파일을 끌어오던 것. 저장 실패 때 행사 상세 다시 그리기는 `window.renderEvDetail`로 | ✅ |
| 메일 파일 10개를 `js/shared/mail/`로: `mail-templates`·`mail-vars`·`mail-preview`·`mail-pane`·`mail-mark`·`mail-original`·`var-chips`·`follow-up`·`flow-editor`·`ai-mail-draft` (`git mv`라 이력이 이어진다) | ✅ |

결과(2026-11-03): 4개 파일 고리(메일 양식·설정) 해소. 서로 import하는 쌍 4 → 3, **가장 큰 고리가 2개 파일**.
계산 지문 `f2e06054438b53ee`·화면 20개 HTML이 master와 같다. 메일 창(양식 보관함 3파트·일괄 메일 둘·전시 메일 양식·연락 단계 편집·두 상세 창의 메일 칸)이 에러 없이 열린다.

파일 옮기기는 `node scripts/refactor/mvfile.js <새 폴더> <파일> …` — 정적·동적 `import()` 경로를 모두 고치고, 다 고친 뒤 모든 상대 경로가 실제 파일을 가리키는지 확인한다.

`deps.js`를 손봤다: 템플릿 속 템플릿(`${url ? `<a target="_blank">` : ''}`)을 한 글자씩 훑어 푸는 스캐너로 바꾸고, 정규식 글자·기본값 매개변수를 이름으로 오인하지 않게 했다.
이제 깨끗한 코드에서 경고 0, 지금까지 놓쳤던 셋(`num`·`SP_SENT`·`escAttr`)을 일부러 빼면 셋 다 잡는다.

### 지금 남은 고리 (2026-11-03)
`exh-bulkmail ↔ exh-tab`은 풀었다 — 전시 탭이 일괄 메일 파일에서 가져가던 것은 `exhFollowOf`(보낸 단계의 리마인더 차례) 하나였고,
그것은 진행 단계(`STEPS`·`cellState`)로 정해지는 값이라 전시 탭으로 옮겼다. 이제 일괄 메일 → 전시 탭 한 방향.

| 고리 | 풀 곳 |
|---|---|
| `speaker-cells ↔ speaker-flow` | 파트 E 끝(합칠지 정하기) |

### 큰 파일 쪼개기 — 막히는 곳과 푸는 법 (2026-11-03)
`sections.js`로 보니 `exh-tab`·`conf-tab`·`speaker-drawer`에는 «뗄 수 있음» 구획이 하나도 없고, 다른 파일도 거의 그렇다.
구획끼리 탭 파일 안의 **화면 상태(let)**를 함께 고치기 때문이다 — import한 변수에는 값을 다시 넣을 수 없어서 그런 구획은 다른 파일로 갈 수 없다.

푸는 법: 탭의 화면 상태를 공유 객체 하나로 옮긴다(`let _evDirectMode` → `uploadUi.evDirectMode`). 객체 속성은 어디서 고쳐도 모두가 같은 값을 본다.
`node scripts/refactor/lift-state.js <탭> <새 상태 파일> <객체 이름> <변수…>` — 선언을 옮기고, 코드에서만(문자열·주석 빼고, 템플릿 `${}` 안은 포함) 이름을 바꾸고, 같은 이름을 다시 선언하는 곳이 있으면 멈춘다.

**업로드 탭에서 시험** (✅):
| 할 일 | 결과 |
|---|---|
| 화면 상태 10개 → `features/upload/upload-ui.js`의 `uploadUi` | |
| STEP 1 파일 읽기 → `features/upload/upload-read.js` | |
| STEP 4 검증·저장 → `features/upload/upload-save.js` (488줄) | |
| 수집 로그·기업 병합 하위 탭 → `upload-logs.js`, 연결 행사 고르기 → `upload-event-select.js` | |
| `upload-tab` 1,775 → 1,016줄 | 브라우저에서 엑셀을 만들어 실제로 올린 결과(만들어진 연락처 3명, 화면 8단계)가 master와 같다 |

**설정 탭** (✅): 화면 상태 18개 → `features/settings/settings-ui.js`의 `settingsUi`. 떼어 냄:
`event-detail.js`(행사 상세, 757줄) · `conf-settings.js`(컨퍼런스 설정, 493줄) · `equip-catalog.js`(비품 목록, 434줄) · `sector-import.js`(엑셀로 섹터 추가) · `sector-add-main.js`.
`settings-tab` 3,650 → 1,830줄. 탭에 남은 코드가 떼어 낸 함수를 부르는 몇 곳은 `window.이름(…)`으로 바꿨다(`split-leaf.js --via-window`).
설정 하위 탭 8개·행사 상세(두 행사 × 세그먼트 7개)·비품 목록 26단계를 포함해 101곳이 master와 같다.

**전시 상세 창** (✅): 화면 상태 14개 → `features/exhibition/exh-drawer-ui.js`의 `exhDrUi`. 떼어 냄:
`exh-dr-mail.js`(메일 — 담당자에게 바로 보내기) · `exh-dr-logs.js`(문의·기록) · `exh-dr-graphic.js`(그래픽 피드백·그래픽 항목·부스 기본 제공 예외) · `exh-remove.js`(참가기업 지우기).
하위 탭을 그리는 함수 표(`VIEW = { contact: dContactTab, … }`)는 값으로 쥐고 있어 window로 바꿀 수 없었다 — `(x) => dContactTab(x)`로 감싸 «부르기»로 바꿨다(동작 같음).
`exh-drawer` 4,283 → 3,380줄. 참가기업 3곳의 상세 창 모든 하위 탭을 포함해 101곳이 master와 같다. «참가기업 지우기»는 실제로 눌러 보지 않았다.

**전시 탭** (✅): 화면 상태 18개(목록 거르개·보기·잠금·선택 등) → `features/exhibition/exh-ui.js`의 `exhUi`. 떼어 냄:
`exh-item-views.js`(금액·비품·그래픽 현황, 1,536줄) / `exh-book.js`(도록 순번·기본 제공·그래픽 발주) / `exh-dashboard.js`(대시보드) / `exh-add.js`(직접 추가·불러오기).
모두 탭이 부르는 함수라 `--via-window`로 옮겼다. `exh-tab` 5,495 → 2,129줄. 101곳이 master와 같다.
활동 로그 보기만 업로드 줄의 «오후 01:13» 분이 달라 어긋났다 — `render-hash.mjs`가 «오전/오후 시:분»도 빼고 세게 했다.

**컨퍼런스 탭** (✅): 화면 상태 16개 → `features/conference/conf-ui.js`의 `confUi`. 떼어 냄:
`conf-program.js`(일자·세션·배정) / `conf-pga.js`(프로그램표) / `conf-people.js`(연사 보기 — 준비·정산·카드) / `conf-upload.js`(엑셀 올리기).
«쓰기» 구획(세션·배정 저장)은 여러 보기가 부르는 바탕이라 탭에 남겼다. `conf-tab` 2,629 → 836줄.
101곳 + 컨퍼런스 보기 바꾸기 16단계(준비·정산, 표·카드, 거르개, 숨김, 연사료 없음)가 master와 같다.
도구 고침: `split-leaf.js`가 범위 안의 다시 내보내기 줄(`export { SP_COLS … } from`)까지 새 파일로 옮겨,
옛 경로로 가져가던 `fingerprint.mjs`가 깨졌다. 이제 그런 줄은 탭 파일에 남긴다.

**연사 상세 창** (✅): 화면 상태 13개 → `features/conference/speaker-drawer-ui.js`의 `spDrUi`(`let bulkPick, bulkPickFor` 한 줄 선언은 먼저 두 줄로). 떼어 냄:
`sp-dr-basic.js`(기본·이력·발제) / `sp-dr-mail.js`(연락 상대·메일·기록) / `sp-dr-bank.js`(계좌·여권). 제공사항은 작아 남겼다.
`MAIL_KINDS`는 머리 구획(보낸 단계 이름)이 값으로 쓰므로 상세 창 파일에 남기고 메일 파일이 가져간다. `speaker-drawer` 2,278 → 878줄.
101곳 + 연사 6명 × 하위 탭 8개(48곳)가 master와 같다. 메일 보내기·저장은 눌러 보지 않았다.

**연락처 탭(마스터DB)** (✅): 화면 상태 11개 → `features/mdb/mdb-ui.js`의 `mdbUi`(`let lpTimer, lpSwallowClick` 한 줄 선언은 먼저 두 줄로). 떼어 냄:
`mdb-bulk.js`(선택 → 초청·일괄 고치기·지우기, 보기 바꾸기) / `mdb-views.js`(목록·묶음·표·모바일 카드) / `mdb-drag.js`(소속 기업·드래그로 분류).
`renderMDB`가 보기 함수를 값으로 고르던 `(mob ? a : b)(pairs)`는 같은 뜻의 if 호출로 바꿔 window를 거치게 했다. `db-tab` 2,348 → 992줄.
101곳 + 연락처 탭 25단계(보기 3종, 정렬, 지역, 나라·퇴사 거르개, 고르기, 초청·일괄 고치기 창, 모바일 카드)가 master와 같다.
일괄 지우기·저장은 눌러 보지 않았다. 화면 전체를 비교할 때는 로그인 시각(`#um-since`)과 동기화 시각(`#last-sync-time`)을 뺀다.

**기업 탭** (✅): 화면 상태 8개 → `features/companies/co-ui.js`의 `coUi`. 떼어 냄:
`co-detail.js`(기업 상세 화면) / `co-edit.js`(필드 고치기·분야와 섹터·드래그) / `co-trade.js`(상세 하위 탭 — 참여 이력·담당자·요약·거래). `company-tab` 1,923 → 1,044줄.
101곳 + 기업 탭 76단계(정렬 4종, 기업 8곳의 상세·하위 탭 5개·섹터 고치기 창)가 master와 같다.
첫 76단계 비교에서는 섹터 창 8곳이 달랐으나, 같은 순서를 세 번 다시 돌렸을 때 모두 같았다(다시 나오지 않음). 저장은 눌러 보지 않았다.

**설정 탭** (✅): 화면 상태가 없어(앞서 `settingsUi`로 옮김) 바로 떼어 냈다 —
`sector-tree.js`(섹터 트리·병합·묶기·편입) / `taxonomy.js`(분야·연락처 태그·참가 유형) / `event-admin.js`(행사 관리) / `code-lists.js`(선택 목록·부스 기본 제공·업로드 표기·행사별 설정 요약).
`DUE_LABEL`(행사 관리가 값으로 씀)과 연락처 데이터 정리 도구(`BILINGUAL_FIELD_PAIRS`)는 탭에 남겼다. `settings-tab` 1,832 → 387줄. 101곳이 master와 같다.

**이번에 찾은 숨은 고장 — 그때그때 읽는 `import('…')` 경로** (고침):
`split-leaf.js`가 옮긴 구획 안의 `await import('../api.js')` 같은 경로를 새 폴더에 맞추지 않았다. 화면을 그릴 때는 안 불리고
저장·메일 원문 보기 같은 동작에서만 불려, 브라우저 비교로는 못 잡았다. 깨져 있던 곳 6군데:
`sp-dr-basic.js`(api), `exh-book.js`(비품 목록 저장), `mdb-bulk.js` 2곳(CRM 보내기), `code-lists.js` 2곳(부스 기본 제공 적용),
`event-detail.js`(메일 원문 — 앞선 설정 탭 작업 때부터). master에는 없는, 이 브랜치에서 생긴 고장이다.
도구 고침: `split-leaf.js`가 `import('…')` 경로도 새 자리에 맞춘다. `deps.js --check`가 `import('…')`의 파일과
`const { a } = await import(…)`로 꺼내는 이름, 그리고 모든 파일의 문법(`node --check`)을 본다 — 손으로 줄을 옮기다 `};`를 두고 와
설정 탭이 통째로 안 읽힌 것을 브라우저에서야 알았기 때문이다.

**api.js** (✅): 1,285 → 274줄. 남은 것은 모두가 쓰는 바탕(주소·인증 머리·`safeFetch`·`postToSheet`·참가 기록 이름 맞추기)뿐이고,
나머지는 `js/api/` 아래 8개 — `load.js`(로그인 때 불러오기) / `conf-save.js` / `exh-save.js` / `settings-save.js` / `mail-send.js` / `share-register.js` / `photos.js` / `ai.js`.
다시 내보내기 없이 쓰는 곳(약 110개 import)을 새 파일로 돌렸다. 불러오기가 고치던 `settingsReady`는 `setSettingsReady`로.
«메일 보내기» 구획 안에 공유·등록 링크·사진·AI가 섞여 있어 한 번 더 나눴다. 101곳이 master와 같다.
도중에: 범위가 한 줄 어긋나 함수의 닫는 `}`가 남은 것을 `deps.js` 문법 검사가 바로 잡았다.
`(await import('../../api.js')).saveEquipCatalog` 꼴은 못 보던 것이라 `deps.js`에 더했다 — 비품 목록 저장이 깨질 뻔했다.

**state.js는 나누지 않는다**: 768줄이고 이미 구획마다 한 가지(행사·연락처·기업·코드 목록·전시·연사…)라 읽기에 어렵지 않다.
나누면 거의 모든 파일의 import를 바꾸게 되는데 얻는 것이 작다.

다음: 전시 상세 창(3,385줄) 한 번 더, 서버(`backend-node`) 정리.

**공용 낱말 훑기 `scripts/refactor/js-scan.js`** — `codeOnly(src)`가 원본과 길이가 같은 «코드만 남긴 사본»을 만든다
(문자열·주석·정규식 글자·템플릿 글자를 지우고 `${식}`은 남긴다). `lift-state`·`split-leaf --via-window`·`deps.js`가 이것을 쓴다.
만든 까닭: 전시 상세 창 상태를 옮기다가 정규식 글자 `/["']/g`의 따옴표를 문자열 시작으로 읽어, 832줄 뒤 3천 줄에서 이름을 못 바꿨다(`deps.js`가 잡아 되돌렸다).
도구마다 따로 훑으며 같은 함정(템플릿 속 템플릿, 펼침, 정규식 속 따옴표)에 차례로 빠졌으므로 한곳으로 모았다. 앞서 옮긴 업로드·설정 탭은 이 사본으로 다시 확인했다 — 문자열 속으로 잘못 바뀐 곳도, 안 바뀐 곳도 없다.

이번에 도구에서 고친 셋:
- **펼침(`...EVENT_LIST`)을 속성으로 오인** — 점으로 시작해서 다섯 도구 모두 이름으로 세지 않았다. 그래서 `split-leaf`가 `EVENT_LIST`·`SPEAKER_LOGS`·`EXH_LOGS` import를 빠뜨렸고 `deps.js`도 못 잡았다(비품 목록이 브라우저에서 터져 알았다). 이제 `...이름`도 센다. 앞서 떼어 낸 파일들에는 같은 누락이 없음을 확인했다.
- **`lift-state`가 import를 «파일 안 마지막 import» 뒤에 넣음** — 설정 탭에서는 그것이 컨퍼런스 설정 구획 안의 다시 내보내기 줄이라, 그 구획을 뗄 때 import가 함께 끌려 나갔다. 이제 머리 import 묶음 끝에 넣는다.
- **`split-leaf`가 범위 안 import 줄을 그대로 옮김** — 경로가 틀리고, 머리 import와 겹치면 SyntaxError가 난다. 이제 범위 안 import는 빼고(머리 import가 대신), `export … from`은 경로를 고친다. `deps.js`는 같은 이름을 두 번 import하는 것도 잡는다.

이번에 `sections.js`가 머리 구획(파일 첫 구획)이 부르는 것을 빼고 셌던 탓에, 실제로는 불리는 «문의·기록» 구획을 «뗄 수 있음»으로 잘못 알렸다. `deps.js`가 바로 잡아냈고(dLogs 없음) 되돌린 뒤 고쳤다.

### 파트 G. 설정·업로드·활동 로그
`settings-tab`(3,750줄)을 섹터 / 분야·태그·참가유형 / 행사 관리 / 코드 목록 / 기본 품목 / 카탈로그 / 행사 상세 / 컨퍼런스 설정으로.

### 파트 H. 전시·연사 중복 합치기 (뒤에)
일괄 메일 엔진, 진행 완료 잠금, «✨ 상황 물어보기». 둘이 미묘하게 달라 하나씩 견주어 정한다.

### 파트 I. 서버 — `backend-node/`
- `routes/mail.js`(1,500줄) → 계정 / 발송 / 보낸 메일 / 받은 메일 / 주인 없는 메일 / 분류.
- `db/` → `lib/`(pool, contact-ids) · `migrations/`(add-*) · `oneoff/`. 옮길 때 CLAUDE.md의 스크립트 경로도 고친다.

## 순서
A(기록) → B → D·E의 공용 꺼내기 → F → 폴더 옮기기 → 큰 파일 쪼개기(C·D·E·G) → A(state·api) → H → I
