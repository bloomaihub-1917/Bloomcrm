const admin = require('firebase-admin');

const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || '@13100m.net';

/* Firebase Admin 초기화를 지연시킨다 — 모듈 로드 시점에 바로 던지면
   FIREBASE_SERVICE_ACCOUNT를 넣기 전까지 /health조차 확인할 수 없다
   (서버리스 함수는 이 파일이 다른 모든 라우트와 한 번에 로드되므로 영향이 더 크다). */
function ensureInitialized() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT 환경변수가 설정되지 않았어요');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

/* Authorization: Bearer <Firebase ID token> 검증.
   비밀번호/커스텀 토큰 로직은 전부 Firebase Auth가 대신 처리하므로,
   여기서는 토큰이 유효한지 + 이메일 도메인만 확인한다. */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ ok: false, error: 'missing token' });

  try {
    ensureInitialized();
  } catch (e) {
    console.error('[auth]', e.message);
    return res.status(500).json({ ok: false, error: 'server auth not configured' });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (!decoded.email || !decoded.email.endsWith(ALLOWED_DOMAIN)) {
      return res.status(403).json({ ok: false, error: 'domain not allowed' });
    }
    // 보낸 메일 기록에 누가 보냈는지 적으려면 이름도 필요하다
    req.user = { email: decoded.email, name: decoded.name || '' };
    next();
  } catch (e) {
    res.status(401).json({ ok: false, error: 'invalid token' });
  }
}

module.exports = { requireAuth };
