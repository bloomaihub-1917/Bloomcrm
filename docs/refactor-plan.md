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

**전시 상세 창 두 번째** (✅): 3,385 → 498줄. 남은 것은 창 열기·닫기·하위 탭 고르기와 공통 칸 그리기뿐이다. 더 떼어 냄:
`exh-dr-booth.js`(독립부스 도면 검토·품목 고르기) / `exh-dr-progress.js`(진행 — 신청서 접수 이력·도록·현장) /
`exh-dr-billing.js`(정산 — 금액 항목·인보이스·세금계산서·입금, 디자인 의뢰) / `exh-dr-actions.js`(저장 동작 — 품목·인보이스·입금·세금계산서·정산·담당자, 상황 물어보기).
창이 부르는 함수는 `window.이름(…)`을 거친다. 101곳(참가기업 3곳의 모든 하위 탭 포함)이 master와 같다. 저장 동작은 눌러 보지 않았다.
도구: `deps.js --check`가 `window.이름(…)`으로 부르는데 어디서도 window에 걸지 않은 이름을 잡는다 — 그런 고장은 그 동작을 할 때만 드러난다.

**서버 — routes/mail.js** (✅): 1,509 → 700줄. 경로(라우트)와 처리 함수는 그 파일에 두고, 쓰는 도우미를 `backend-node/lib/mail/`로 —
`box.js`(첨부·행사 메일 계정·푸터·IMAP) / `sync-sent.js`(보낸메일함 → 발송 기록) / `sync-inbox.js`(받은메일함 → 기록·주인 없는 메일) / `screen.js`(스팸·대량 메일·경고) / `original-html.js`(원문을 안전한 HTML로).
확인: `scripts/refactor/route-table.js`가 app.js를 읽어 경로 72개와 각 처리 함수 본문의 지문을 master와 견준다(같음, DB에는 닿지 않는다).
또 master `mail.js`의 모든 줄이 새 파일들 어딘가에 그대로 있다(빠진 줄 0, 더한 줄은 머리 주석·require·exports뿐). 도구: `cjs-split.js`(CommonJS판 떼기).

**서버 — db/ 정리** (✅): 스크립트 124개를 `migrations/`(add-* 38) · `seeds/`(seed-* 10) · `oneoff/`(76)로. `pool.js`·`contact-ids.js`·스키마·`fix-unsafe-contact-ids.js`는 그대로.
`scripts/refactor/db-reorg.js`가 옮기고 require·`__dirname` 경로와 저장소 글의 «db/이름» 언급(코드 주석·문서)을 고쳤다. 상대 require 105개 모두 있는 파일을 가리킨다.
운영 DB에 닿는 스크립트라 돌려 보지는 않았다. CLAUDE.md에 폴더 규칙을 적었다.

다음: 파트 H(전시·연사의 겹치는 기능 합치기)는 동작을 바꾸는 일이라 따로 정한다.

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

### 파트 H. 전시·연사 중복 합치기 — 계획 (2026-11-03, 견주어 본 결과)

두 쪽 코드를 줄 단위로 견줬다(이름의 전시/연사 낱말만 지우고 같은 줄을 셈).

| 후보 | 겹침 | 다른 점 | 판단 |
|---|---|---|---|
| 진행 완료 잠금 (`exh-tab` exhLocked·guardWrite / `conf-common` confLocked·guardConf) | 거의 같다 | 파트(exh/conf), 알림 문구의 «행사/컨퍼런스», 창이 없을 때 행사를 아는 방법 | **합친다** — `core/part-lock.js`의 `makePartLock()` 하나에서 둘을 만든다. 동작 그대로 |
| 일괄 메일 «다시 보내기 묶음» (roundProgress·start·close·roundBarHtml) | 4개 함수가 말(곳/명)과 대상 고르기만 다르다 | 연사 쪽은 닫을 때 컨퍼런스 화면·연사 창을 다시 그린다 | **합친다** — `shared/mail/resend-round.js`에 틀, 대상·말·다시 그리기를 넘긴다. 동작 그대로 |
| 일괄 메일 보내기 순서 (sendExhBulk / sendSpBulk) | 뼈대 같다 — 통 사이 쉬기, 실패 모으기, 기록 못 남긴 곳도 «보냄» 처리, 기록 넣기 | 전시만: 국·영문 빈 제목 막기, 기업별 사진, 참조·받는 사람 고르기. 연사만: 연락 상대별 수신·참조 | **뼈대만 합친다** — `shared/mail/bulk-send.js`가 순서를 돌리고, 한 통 만들기·확인 문구는 각자 |
| ✨ 상황 물어보기 화면 (exhAdviceHtml / adviceHtml + ask·act·save·clear) | 화면 틀 거의 같다 | 보내는 상태 값·단추 종류는 각자. 겉모양(테두리 상자 / 점선 위 칸), 기록 실패 알림 | **틀만 합친다** — `shared/advice-panel.js`. 보내는 내용·단추는 각자 |
| 내보내기 (exh-export 1,348 / speaker-export 302) | 4% | 내용이 다르다 | 합치지 않는다 |
| 상세 창 메일 칸 (exh-dr-mail / sp-dr-mail) | 15% | 받는 사람 고르는 방식이 다르다 | 합치지 않는다 — 공용은 이미 `shared/mail/`에 있다 |
| 서버 보낸 메일 분류 (classifySent / classifyExhSent) | 틀만 | 단계 이름표가 다르다 | 합치지 않는다. 다만 아래 «덤으로 본 것» |

**순서**: H1 잠금 → H2 다시 보내기 묶음 → H3 보내기 뼈대 → H4 상황 물어보기. 위험이 작고 겹침이 큰 것부터.

**확인 방법**: 지금까지의 101곳 비교에 더해, 테스트 로그인에서 일괄 메일을 실제로 «보낸다» — 테스트 모드는 메일을 내보내지 않고
기록만 화면에 남기므로, 전시·연사 각각 «보내기 → 남은 기록·실패 목록·다시 보내기 묶음 열고 닫기»를 master와 견줄 수 있다.
잠금은 진행 완료로 바꾼 행사에서 저장이 막히는지(알림 한 번, 서버로 안 감)를 두 쪽 다 본다.

**정할 것(동작이 바뀌는 것 — 기본은 지금 그대로 두고 합친다)**
1. 연사 일괄 메일에도 «국·영문 제목이 비면 막기»를 넣을까 — 전시에서는 제목 없는 메일이 실제로 나간 적이 있어 넣었다.
2. 상황 물어보기의 겉모양을 하나로 할까(전시의 테두리 상자 / 연사의 점선 칸).

**H1 진행 완료 잠금** (✅ 2026-11-03): `core/part-lock.js`의 `makePartLock({ part, label, fallback })` 하나가 판단·알림(1.5초에 한 번)·저장 가드를 만든다.
전시(`exh-tab`)·컨퍼런스(`conf-common`)는 같은 이름(exhLocked·guardWrite / confLocked·guardConf 등)을 그대로 내보낸다.
함정: 처음에 `export const guardWrite = lock.guard`로 바꿨더니, 파일 머리의 `saveExhibitor = guardWrite(…)`가 그 줄보다 먼저 돌아 «아직 없음»으로 깨질 판이었다
(전에는 함수 선언이라 미리 올라가 있었다). 그래서 내보내는 것은 함수 선언으로 두고, 잠금 틀은 처음 부를 때 만든다. `deps.js`는 이 꼴(선언 전 사용)을 못 잡는다.
확인: 테스트 로그인에서 행사를 진행 완료로(화면 안에서만) 바꾸고 — 창의 행사·탭의 행사·다른 행사로 각각 판단, 가드 결과, 알림 횟수·문구, 서버 요청 0 — 가 master와 같다. 컨퍼런스 탭 행사로 잠기는 것도 따로 봤다. 101곳 같음.

**H2 다시 보내기 묶음** (✅ 2026-11-03): `shared/mail/resend-round.js`의 `makeResendRound()`가 진행 세기·열기·닫기·띠를 만든다.
참가사·연사 일괄 메일은 대상 고르기, 말(곳/명·기업들/연사들), 열고 닫은 뒤 다시 그리기, 묶음 저장(`pushRounds`, 저장 자리가 다르다)만 넘긴다. 내보내는 이름(startExhRound·closeSpRound 등)은 그대로.
확인: `scripts/refactor/round-hash.mjs` — 두 일괄 메일 창에서 단계마다 «묶음 열기 → 닫기»를 하고(prompt·confirm은 저절로 답한다) 창 HTML·알림 문구·저장된 묶음 목록 104곳이 master와 같다. 101곳 같음.
다 보내면 저절로 닫히는 길(`close(true)`)은 보내기를 해야 지나므로 H3에서 본다.

**H3 일괄 메일 보내기 순서** (✅ 2026-11-03): `shared/mail/bulk-send.js` — `runBulkSend()`가 통 사이 쉬기·멈춤·«보내는 중…»·실패 모으기·기록 못 남긴 곳 처리·활동 로그·멈춤/묶음 닫기를 돌리고,
`makePause()`가 두 파일에 똑같이 있던 쉬기를 대신한다. 한 통 만들어 보내기, 보낸 뒤 기록(참가사 첨부 이름·연사 날짜 찍기), 마지막 알림 문구는 각자 넘긴다. 보내기 전 확인 창은 각자 그대로.
확인 방법이 새로 필요했다 — 테스트 로그인에서는 sendMail이 늘 «테스트 모드» 실패라 성공 길을 못 지난다.
`scripts/refactor/mock-copy.js`가 master·이 브랜치를 따로 풀어 sendMail·eventMailFrom만 가짜로(네 통째 실패, 다섯 통째 기록 id 없음), 쉬는 시간을 0으로 바꾼 사본을 만들고,
`send-hash.mjs`가 참가사·연사 각각 «모두 보내기 → 실패만 다시 → 묶음 열고 보내기 → 실패 다시 ×2 → 보내다 멈춤»을 해 본다.
확인 창·알림 문구, 알림 줄, 새 기록, 보낸 내용, 창 HTML 28곳이 master와 같다(같은 순서를 master끼리 두 번 돌려 같은 값이 나오는 것도 봤다). 101곳 같음.

**H3 하다가 본 것(지금 동작, 바꾸지 않음)**: 다시 보내기 묶음에서 실패한 곳이 있어도 «묶음을 다 보내 닫았어요»로 닫힌다 — 참가사(8곳 중 2곳 실패)·연사(7명 중 2명 실패) 모두.
묶음 진행을 «보낸 기록이 있나»가 아니라 단계 상태로 세는 탓으로 보인다. 정할 일로 남긴다.

**H4 ✨ 상황 물어보기 칸** (✅ 2026-11-03): `shared/advice-panel.js` — `adviceHtml(o)`가 질문 칸·물어보기 단추·오류 줄·답(요약·할 일·주의·기록에 남기기·닫기)을 그린다.
겉 상자 모양(참가사 테두리 상자 / 연사 점선 칸), 칸 id, 안내 문구, 줄마다 붙는 단추 종류, 부르는 함수 이름, «남겼어요» 문구만 각자 넘긴다.
AI에 보내는 상태 값과 ask·act·save·clear 동작은 각자 파일 그대로. 겉모양 하나로 맞추기(정할 일 2)는 하지 않았다 — 화면이 바뀌므로.
`mock-copy.js`에 aiApi 가짜(window.__mockAi)를 더하고 `advice-hash.mjs`가 참가사·연사 상세 창에서 빈 칸 → 생각 중 → 답(단추 7종, 모르는 종류 포함, 꺾쇠·따옴표 섞음) → 기록에 남기기 → 닫기 → 오류를 만들어 칸 HTML·알림을 센다.
12곳이 master와 같다. 101곳(지금 105개 값) 같음.

**덤으로 본 것(합치기와 별개)**: 서버가 보낸메일함을 읽을 때 전시 메일 단계를 제목 낱말로 고정해 알아본다(`lib/mail/sync-sent.js` classifyExhSent).
그런데 전시 메일 단계는 행사마다 편집할 수 있어서, 새로 만든 단계로 보낸 메일은 «기타»로 들어갈 수 있다.

**큰 파일 마저 떼기** (✅ 2026-11-04): `exh-item-views` 1,538 → 820줄 — 그래픽 현황(독립부스·받을 파일 계획·품목별·기업별)을 `exh-graphic-views.js`(736줄)로.
`exh-tab` 2,118 → 1,864줄 — 부스 현황 보기를 `exh-booth-view.js`, 행사 설정 모달을 `exh-settings-modal.js`로. 남은 1,500줄 넘는 파일은 `exh-tab` 하나 — 나머지 구획(사이드바·메인 목록·부스 디자인 의뢰·저장·부딪힘)은 서로 많이 불러 한 방향으로 뗄 수 없다.
master에 동작 수정 세 커밋이 따로 들어가 있어서, 견주기는 이 브랜치 바로 앞 커밋(f8b91d1, master와 같다고 확인한 것)을 풀어 놓고 했다. 105개 값 같음.
그래픽 하위 보기 5개(base·item·kind·co·self)와 행사 설정 창은 따로 열어 에러 없음을 봤다.
도구 메모: split-leaf는 `window.X = X;   // 주석`처럼 뒤에 주석이 붙은 줄을 window 줄로 못 알아본다 — 잠깐 주석을 떼고 돌렸다.

**master 동작 수정 세 개 옮겨 넣기** (✅ 2026-11-04): master의 53eb105(다시 보내기 묶음이 연 그 분의 기존 기록을 «다시 보냄»으로 세던 것)·3337691(연사 일괄 메일 빈 제목 막기)·186c16c(연사 상황 물어보기 칸을 테두리 상자로)를
이 브랜치 자리에 넣었다 — 묶음은 `shared/mail/resend-round.js`가 열 때 `o.before(ids, key, since)`로 그 분의 기록 id를 받아 적고 `o.resent(…, before)`로 넘긴다. 상자 모양은 `advice-panel` wrapStyle.
master 사본과 견줌: 보내기 28·상황 물어보기 24·기존 105개 값 모두 같음. 그 뒤 master를 `-s ours`로 합친 기록을 남겼다(내용은 이미 들어 있어 이 브랜치 파일을 그대로 둔다 — 나중에 master로 합칠 때 다시 부딪히지 않게).

### 파트 I. 서버 — `backend-node/`
- `routes/mail.js`(1,500줄) → 계정 / 발송 / 보낸 메일 / 받은 메일 / 주인 없는 메일 / 분류.
- `db/` → `lib/`(pool, contact-ids) · `migrations/`(add-*) · `oneoff/`. 옮길 때 CLAUDE.md의 스크립트 경로도 고친다.

## 순서
A(기록) → B → D·E의 공용 꺼내기 → F → 폴더 옮기기 → 큰 파일 쪼개기(C·D·E·G) → A(state·api) → H → I

## 토큰 정리 (2026-11-04)
- 디자인을 다시 잡기 전에, js·CSS에 숫자로 적힌 글자 크기·둥근 모서리 2,419곳을 `styles/tokens.css` 변수로 바꿨다(값은 그대로).
  - 글자 크기 `--fs-8` ~ `--fs-20`(10.5px는 `--fs-10_5`), 모서리 `--rd-2` ~ `--rd-20`·`--rd-pill`, 5px·8px은 기존 `--rs`·`--r`.
  - 단계를 줄일 때는 tokens.css 값만 바꾼다(예: `--fs-10_5:var(--fs-11)`).
- 바꾸지 않은 곳(받는 쪽에 tokens.css가 없다): 인쇄·공유·보고서·메일 원문·등록 링크 파일, 메일 본문(`bodyHtml`)·메일 꼬리말 미리보기 줄.
  PGA 표 복사는 담을 때 변수를 지금 px 값으로 바꾼다.
- 다시 돌리기: `node scripts/refactor/tokenize.js`(시험) → `--apply`. 확인: `scripts/refactor/style-hash.mjs`를 master와 견준다
  (화면 21곳의 HTML·실제 글자 크기·모서리가 같음, PGA 복사 HTML 같음).
- index.html의 CSS 캐시 번호를 올렸다 — 예전 tokens.css가 캐시에 남으면 변수가 없어 글자가 기본 크기로 보인다.

## 색 값 정리 (2026-11-04)
- js·CSS 스타일 값에 직접 적힌 색 64곳을 tokens.css 변수로 바꿨다(값 그대로).
  - 기존 변수와 같은 값은 그 변수로(#9C9890 → `--i4`, #DC2626 → `--re` …).
  - 색 바탕 위 흰 글씨는 `--on`, 흰 바탕은 `--W`.
  - 나머지 값에는 새 이름: 연한 테두리 `--al/--gl/--pl/--aml/--tel/--rel`, 남보라 `--in*`, 금색 알약 `--yb/--yk`, 짙은 주황 단추 `--amb2/--amd/--amk`, 고른 줄 `--selb`, 기록 창 글씨 `--code`, 사이드바 초록 칸 `--gs`.
- 그대로 둔 색: 따옴표 안의 데이터 색(행사 색·기록 색·사용자 색·캔버스), 메일 본문·메일처럼 보이는 흰 종이 미리보기, 업로드 알림의 아이콘 색 몇 개, 정의 없는 변수의 대체값.
- 다시 돌리기: `node scripts/refactor/tokenize-colors.js`(시험) → `--apply`. style-hash.mjs는 이제 실제 색(글씨·바탕·테두리)도 견준다 — master와 21개 화면 같음.

## 상단 틀 맞춤 (2026-11-04) — 화면이 바뀌는 변경
- 왼쪽 선 하나: 새 변수 `--pad-x`(16px)를 제목 줄 `.tb`(20→16), 필터 줄 `.db-bar`(18→16), `.tbar`, 활동 로그 필터(18→16)가 같이 쓴다. 본문(16px)과 같은 선.
- 보기 탭 줄 `.db-bar.vtabs`: 연사·전시·행사 DB가 Company DB의 종류 줄(.db-bar, 높이 49px·위아래 9px)과 같은 줄을 쓴다. 연사는 본문 안에 있던 탭을 제목 줄 바로 아래 흰 줄로 옮겼다.
- 제목 줄 순서: 제목 · 검색 · 보조 단추 · 주 단추. 전시의 «참가기업 추가»를 검색 뒤로. 단추는 모두 작은 크기(`.bs`) — Master DB·Company DB의 주 단추도.
- 연사 제목 부제를 다른 탭처럼 «행사 · 연사와 프로그램»으로.
- 컨택·파트너링에도 보기 탭 줄(`.db-bar.vtabs`): 컨택은 사이드바 «뷰»와 같은 다섯 보기(오늘 할 컨택·현황표·보고·협의 보드·협의 목록) — `switchCV`가 두 곳을 같이 켠다.
  파트너링은 본문 안에 있던 탭(참가자 명단·확정 대기·셀러·바이어 지정)을 줄로 올리고, «+ DB에서 찾아 넣기»는 줄 오른쪽 단추(열려 있으면 파란 주 단추).

## 행사 DB 파트별 탭 (2026-11-04) — 기능 추가
- 탭: 개요 · 참가자 · 전시기업 · 연사 · 파트너링 · 협의 대상. 파트 탭은 위에 숫자 카드, 아래에 명단, 검색.
  - 참가자: 사람 전체(예전 «참여자») + «사람별/기업별»(예전 «기업» 화면) 전환. 이름을 누르면 연락처 창.
  - 전시기업: exhibitorsForEvent — 신청서·부스 확정·정산, 담당자. 줄을 누르면 전시 참가기업 창.
  - 연사: speakersForEvent(숨긴 연사 제외) — 상태·프로필·사진·동의. 줄을 누르면 연사 창.
  - 파트너링: 역할이 셀러·바이어·비즈니스파트너링인 사람. 줄을 누르면 연락처 창.
- 참가기업의 company_key는 영문명에서 만든 것이 많아(greencellbio) 사람의 국문 orgKey와 안 맞는다 — 전시기업 탭은 국문·영문 키를 모두 견준다.
  (evOrgs의 기업별 묶음은 아직 company_key만 써서, 같은 기업이 두 줄로 보일 수 있다 — 따로 볼 일)
