const admin = require('firebase-admin');

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT 환경변수가 설정되지 않았어요');
  }
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(raw)),
  });
}

const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || '@13100m.net';

/* Authorization: Bearer <Firebase ID token> 검증.
   비밀번호/커스텀 토큰 로직은 전부 Firebase Auth가 대신 처리하므로,
   여기서는 토큰이 유효한지 + 이메일 도메인만 확인한다. */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ ok: false, error: 'missing token' });

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (!decoded.email || !decoded.email.endsWith(ALLOWED_DOMAIN)) {
      return res.status(403).json({ ok: false, error: 'domain not allowed' });
    }
    req.user = { email: decoded.email };
    next();
  } catch (e) {
    res.status(401).json({ ok: false, error: 'invalid token' });
  }
}

module.exports = { requireAuth };
