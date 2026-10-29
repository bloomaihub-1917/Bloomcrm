// Vercel 서버리스 환경에서는 매 요청마다 커넥션이 새로 뜰 수 있어
// 일반 pg.Pool 대신 Neon 전용 드라이버를 쓴다. API는 pg.Pool과 거의 동일해서
// routes/data.js, scripts/*.js를 고칠 필요가 없다.
const { Pool } = require('@neondatabase/serverless');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// Neon이 쉬면서 놀던 연결을 끊으면 풀이 'error'를 낸다 — 받는 곳이 없으면 프로세스가 죽는다
pool.on('error', (e) => console.error('[pool] 놀던 연결 오류:', e.message));

module.exports = pool;
