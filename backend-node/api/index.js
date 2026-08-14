// Vercel 서버리스 함수 진입점. app.js의 Express 앱을 그대로 핸들러로 내보낸다
// (Vercel의 Node 런타임은 Express 앱 인스턴스를 (req,res) 핸들러처럼 그대로 받는다).
// vercel.json의 rewrite가 모든 요청을 이 함수로 보낸다.
module.exports = require('../app');
