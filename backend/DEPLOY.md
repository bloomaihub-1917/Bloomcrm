# 백엔드(Apps Script) 배포 절차

이번 보안/버그 수정으로 `code.gs`가 크게 바뀌었습니다. **아래 절차를 완료하기
전까지는 앱이 시트에 연결되지 않습니다** (구버전 배포는 새 로그인 방식과 호환되지 않음).

## 1. 코드 반영
1. 스프레드시트 → 확장 프로그램 → Apps Script 열기
2. `code.gs` 내용을 이 폴더의 `backend/code.gs`로 전체 교체
3. 저장

## 2. 스크립트 속성 설정 (필수 — 안 하면 로그인 불가)
1. Apps Script 편집기 → 좌측 톱니(프로젝트 설정) → 스크립트 속성
2. 속성 추가:
   - 키: `CRM_USERS`
   - 값: `{"cdakyo@13100m.net":"새비밀번호"}`
   - ⚠️ 기존 비밀번호(`Studio00!!`)는 코드에 평문으로 있었으므로 **반드시 새 비밀번호로 교체**
3. `CRM_SECRET`은 첫 로그인 시 자동 생성되므로 직접 넣지 않아도 됨

## 3. 1회 수동 실행 함수
Apps Script 편집기에서 함수 선택 → 실행:
- `addCrmLogColumn` — 기존 crm_targets 시트에 `log` 컬럼 추가 (CRM 컨택 기록 저장용)
- `addSectorCanonicalColumn` — sectors 시트에 `canonical` 컬럼 추가
  (행사 스코프 섹터 → 공통 섹터 연결용. 연결 자체는 앱 설정 탭에서 수동)
- `migrateSectorDomains` — 섹터 "분야(도메인)" 도입:
  sectors 시트에 `domain` 컬럼 추가 + 분야 6종(BIO/IT/VC/AI/기자/MICE) 등록 +
  bio/mice 분야 초기 배정. 실행 후 로그(보기 → 로그)에서 "배정 N건 / 스킵 M건" 확인.
  ⚠️ 이 함수 실행 전에 앱의 "시트 보기 좋게 정렬" 버튼을 누르면 안 됨
  (구버전 프론트가 3컬럼으로 재작성하며 domain 값이 지워짐 — 프론트도 함께 갱신할 것)
- `addCompanyNameColumns` — companies 시트에 `nameKo`/`nameEn` 컬럼 추가
  (기업DB에서 회사명을 직접 수정할 수 있게 하는 override 컬럼. 비어있으면
  기존처럼 연락처 소속명에서 자동 추출한 이름을 그대로 씀)
- `addContactTagsColumn` — contacts 시트에 `tags` 컬럼 추가
  (BD/C-level처럼 참가 역할·직함과 무관하게 그 사람에게 직접 붙이는 영구
  꼬리표. 마스터DB 일괄 변경에서 태그를 추가/제거할 수 있음)

## 4. 새 버전으로 재배포
1. 배포 → 배포 관리 → 연필(수정) → 버전: "새 버전" → 배포
2. 배포 URL이 바뀌었다면 `js/state.js`의 `GS_URL` 갱신

## 5. 동작 확인 체크리스트
- [ ] 로그인 성공 (새 비밀번호)
- [ ] 잘못된 비밀번호로 로그인 실패 확인
- [ ] 브라우저 시크릿 창에서 `배포URL?sheet=contacts&email=aaa@13100m.net` 접근 시
      `{"error":"Unauthorized"}` 반환 확인 (토큰 없이 열람 불가)
- [ ] CRM 탭에서 상태 변경 → 새로고침 → 변경이 유지되는지 확인
- [ ] 활동 로그 탭에서 새 기록이 올바른 유형으로 표시되는지 확인

## 참고: 이번에 바뀐 인증 구조
- 로그인: `POST { sheet:'login', email, password }` → 서버가 HMAC 서명 토큰(14일) 발급
- 이후 모든 읽기(`?auth=`)/쓰기(`body.auth`)에 토큰 필수
- 쓰기는 LockService로 직렬화되어 동시 편집 시 데이터가 밀리지 않음
- 토큰 만료 시(14일) 재로그인 필요 — 화면에 연결 실패 배너가 뜨면 로그아웃 후 재로그인
