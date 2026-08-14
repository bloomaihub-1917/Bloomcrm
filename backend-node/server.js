// 로컬 개발 전용 진입점. Vercel 배포는 api/index.js가 대신 처리한다
// (Vercel은 서버리스 함수라 app.listen()을 직접 부르지 않는다).
const app = require('./app');

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`[bloom-crm-backend] listening on ${port}`));
