# 백엔드(Node/Express + PostgreSQL + Firebase Auth) 배포 절차

Google Apps Script + Sheets 백엔드를 대체한 현재 운영 백엔드입니다.
전환이 끝나 Apps Script 소스(`backend/`)와 1회성 이관 스크립트는 삭제했습니다.

## 0. 준비물 (전부 무료)
- [Neon](https://neon.tech) 계정 — Postgres (서버리스 환경과 궁합이 좋은 `@neondatabase/serverless` 드라이버 사용)
- [Vercel](https://vercel.com) 계정 — 백엔드 호스팅(서버리스 함수)
- [Firebase](https://console.firebase.google.com) 프로젝트 — 로그인/계정 관리

## 1. Firebase 프로젝트 설정
1. Firebase 콘솔 → 새 프로젝트 생성 (Spark/무료 플랜 그대로 사용, Blaze 업그레이드 불필요)
2. Authentication → 로그인 방법 → "이메일/비밀번호" 활성화
3. Authentication → Users 탭에서 팀원 계정을 하나씩 추가하거나,
   `node scripts/create-user.js "이름:이메일:임시비밀번호" ...` 로 일괄 생성
4. 프로젝트 설정 → 일반 → "내 앱"에서 웹 앱 추가 → `firebaseConfig` 값을
   `js/firebase.js`의 `firebaseConfig`에 붙여넣기(공개돼도 안전한 값)
5. 프로젝트 설정 → 서비스 계정 → 새 비공개 키 생성(JSON 다운로드)
   → 이 JSON 전체를 한 줄 문자열로 만들어 `FIREBASE_SERVICE_ACCOUNT` 환경변수로 사용

## 2. Neon(Postgres) 설정
1. Neon에서 새 프로젝트 생성 → `DATABASE_URL` 복사
2. 스키마 적용: `psql "$DATABASE_URL" -f db/schema.sql`

`psql`이 없는 환경(예: 개발용 Windows)에서는 Node로 같은 파일을 적용할 수 있습니다:
```
node -e "require('dotenv').config();const fs=require('fs');const p=require('./db/pool');p.query(fs.readFileSync('db/schema.sql','utf8')).then(()=>console.log('done'))"
```

## 3. 데이터 넣기
데이터는 앱의 **업로드** 탭에서 엑셀/CSV로 넣습니다. 섹터 도메인 분류
초기값이 필요하면 `db/seed.sql`을 한 번만 같은 방식으로 적용하세요.

## 4. Vercel에 백엔드 배포
`app.js`가 실제 Express 앱이고, `api/index.js`가 이를 그대로 감싸는 서버리스
진입점이다(`vercel.json`이 모든 요청을 여기로 라우팅). 로컬 실행(`node server.js`)과
Vercel 배포가 같은 `app.js`를 공유하므로 로직은 한 곳에만 있으면 된다.

1. 이 저장소를 GitHub 등에 올린 뒤 Vercel → Add New → Project → 저장소 연결
2. Root Directory: `backend-node`
3. Framework Preset: Other (빌드 스텝 없음 — Vercel이 `api/index.js`를 자동으로 함수로 인식)
4. 환경변수 등록 (Project Settings → Environment Variables):
   - `DATABASE_URL` (Neon)
   - `FIREBASE_SERVICE_ACCOUNT` (서비스 계정 키 JSON, 한 줄)
   - `ALLOWED_DOMAIN` = `@13100m.net`
   - `ALLOWED_ORIGIN` = 프론트가 서빙되는 origin (예: `https://your-frontend.example.com`)
5. 배포 완료 후 나온 URL(`https://xxx.vercel.app`)을 `js/state.js`의 `API_BASE_URL`에 반영

## 5. 동작 확인 체크리스트
- [ ] `배포URL/health` 접근 시 `{"ok":true}` 확인
- [ ] Firebase 콘솔에 등록한 계정으로 로그인 성공
- [ ] 잘못된 비밀번호로 로그인 실패 확인
- [ ] 토큰 없이 `배포URL/api/data?sheet=contacts` 접근 시 401 확인
- [ ] MDB에서 연락처 추가/수정 → 새로고침 후 유지되는지 확인
- [ ] 여러 명이 동시에 저장해도 지연/에러 없이 처리되는지 확인(과거 LockService 병목 해소 확인)

## 참고: 기존 구조 대비 달라진 점
- 계정 추가/삭제/비밀번호 재설정: Apps Script 스크립트 속성(CRM_USERS) 직접 편집 → Firebase 콘솔/`scripts/create-user.js`
- 프론트엔드: GitHub Pages(`https://bloomaihub-1917.github.io/Bloomcrm/`)에 master 푸시로 자동 배포.
  파일이 10분간 캐시되므로 배포 직후에는 강력 새로고침(Ctrl+Shift+R)이 필요할 수 있습니다.
- 인증: 커스텀 HMAC 토큰(14일) → Firebase ID 토큰(1시간, SDK가 자동 갱신)
- 동시 쓰기: 전역 LockService 직렬화 → Postgres 트랜잭션 + `ON CONFLICT` upsert
- 에러 응답: 스택 그대로 노출 → 스택 제거, 서버 콘솔에만 로그
- 요청 제한: IP당 분당 120회(`express-rate-limit`) — 단, 서버리스 함수는 인스턴스별로 메모리가
  분리돼 있어 이 카운터가 인스턴스마다 따로 리셋된다. 완벽한 전역 제한이 필요해지면
  Upstash Redis 같은 공유 저장소 기반 rate limiter로 바꿔야 하지만, 지금 팀 규모에서는
  이 정도로도 "토큰 하나로 무제한 접근" 문제는 충분히 완화된다.
- DB 커넥션: 일반 `pg.Pool` → Neon 서버리스 드라이버(`@neondatabase/serverless`) —
  서버리스 함수가 요청마다 새로 뜨면서 일반 TCP 커넥션 풀이 금방 고갈되는 문제를 피한다.
