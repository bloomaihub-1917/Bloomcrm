require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { requireAuth } = require('./middleware/auth');
const dataRoutes = require('./routes/data');

/* 로컬(server.js)과 Vercel 서버리스(api/index.js)가 이 app을 그대로
   공유한다 — app.listen()은 각 진입점에서 따로 한다(서버리스는 안 함). */
const app = express();

// Vercel(과 대부분의 서버리스 호스팅)은 프록시 뒤에서 실행되어 X-Forwarded-For
// 헤더로 실제 클라이언트 IP를 넘긴다. 이 설정이 없으면 express-rate-limit이
// 그 헤더를 신뢰할 수 없다며 요청 자체를 에러로 처리한다(저장이 전부 실패하던 원인).
app.set('trust proxy', 1);

const allowedOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(express.json());

// CORS 헤더는 요청 Origin에 따라 매번 달라지므로, CDN/브라우저 등 어떤 계층도
// 이 응답을 캐시해 다른 origin에 잘못된 Access-Control-Allow-Origin을
// 돌려주는 일이 없도록 명시적으로 캐시를 금지한다.
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// 토큰 하나로 무제한 접근 가능하던 기존 문제 보완 — IP당 분당 요청 수 제한
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 120 }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/data', requireAuth, dataRoutes);

// 에러 스택을 클라이언트에 노출하지 않는다 (기존 code.gs:349,398 문제 보완)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: 'internal error' });
});

module.exports = app;
