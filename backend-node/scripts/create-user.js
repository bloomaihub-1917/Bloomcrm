/* 팀원 계정을 Firebase Auth에 일괄 생성한다.
   지금처럼 Apps Script 스크립트 속성(CRM_USERS)을 손으로 고치던 방식을 대체한다.

   사용법:
     FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}' \
       node scripts/create-user.js "이름:이메일:임시비밀번호" ["이름2:이메일2:임시비밀번호2" ...]

   예:
     node scripts/create-user.js "정다혜:cdakyo@13100m.net:임시비번1234"
*/
require('dotenv').config();
const admin = require('firebase-admin');

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT 환경변수가 필요해요');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });

const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || '@13100m.net';

async function main() {
  const entries = process.argv.slice(2);
  if (!entries.length) {
    console.error('사용법: node scripts/create-user.js "이름:이메일:임시비밀번호" ...');
    process.exit(1);
  }

  for (const entry of entries) {
    const [name, email, password] = entry.split(':');
    if (!name || !email || !password) {
      console.warn(`형식이 잘못돼서 건너뜀: ${entry}`);
      continue;
    }
    if (!email.endsWith(ALLOWED_DOMAIN)) {
      console.warn(`허용 도메인이 아니라 건너뜀: ${email}`);
      continue;
    }
    try {
      const user = await admin.auth().createUser({ email, password, displayName: name });
      console.log(`생성 완료: ${email} (uid: ${user.uid})`);
    } catch (e) {
      console.error(`생성 실패(${email}):`, e.message);
    }
  }
}

main();
