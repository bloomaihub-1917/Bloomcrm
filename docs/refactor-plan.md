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
| `flow-hash.mjs` | 창 열기 지문 — 연락처 상세·고치기·참여 행사 추가·퇴사·직접 추가, 기업 상세·참여 이력 추가, 설정 › 기업 분류·비슷한 기업을 같은 순서로 열며 화면 전체(로그인 시각 뺌)를 해시로. **새로 로그인한 직후 맨 먼저** 돌린다 |
| `sections.js` / `split-leaf.js` | 큰 파일의 구획끼리 무엇을 부르는지 / «뗄 수 있음» 구획을 한 방향으로 떼기 |
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

### 지금 남은 고리 (2026-11-03, 파트 C 뒤)
| 고리 | 풀 곳 |
|---|---|
| `exh-bulkmail ↔ exh-tab` | 파트 D 남은 것(진행 단계 꺼내기) |
| `speaker-cells ↔ speaker-flow` | 파트 E 끝(합칠지 정하기) |

### 파트 G. 설정·업로드·활동 로그
`settings-tab`(3,750줄)을 섹터 / 분야·태그·참가유형 / 행사 관리 / 코드 목록 / 기본 품목 / 카탈로그 / 행사 상세 / 컨퍼런스 설정으로.

### 파트 H. 전시·연사 중복 합치기 (뒤에)
일괄 메일 엔진, 진행 완료 잠금, «✨ 상황 물어보기». 둘이 미묘하게 달라 하나씩 견주어 정한다.

### 파트 I. 서버 — `backend-node/`
- `routes/mail.js`(1,500줄) → 계정 / 발송 / 보낸 메일 / 받은 메일 / 주인 없는 메일 / 분류.
- `db/` → `lib/`(pool, contact-ids) · `migrations/`(add-*) · `oneoff/`. 옮길 때 CLAUDE.md의 스크립트 경로도 고친다.

## 순서
A(기록) → B → D·E의 공용 꺼내기 → F → 폴더 옮기기 → 큰 파일 쪼개기(C·D·E·G) → A(state·api) → H → I
