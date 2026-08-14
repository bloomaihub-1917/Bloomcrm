require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { requireAuth } = require('./middleware/auth');
const dataRoutes = require('./routes/data');

/* 로컬(server.js)과 Vercel 서버리스(api/index.js)가 이 app을 그대로
   공유한다 — app.listen()은 각 진입점에서 따로 한다(서버리스는 안 함). */
const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(express.json());

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
