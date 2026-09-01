/* ══════════════════════════════════════════════════════════════
   mail.js — CRM에서 메일 보내기 (1단계)

   회사 메일은 메일플러그인데 Gmail 계정 하나를 CRM 메일함으로 쓴다.
   Gmail은 앱 비밀번호 + SMTP로 붙는다 — OAuth를 쓰면 Gmail 발송 권한이
   구글의 제한 스코프라 보안 심사를 받아야 하고, 심사 전에는 로그인이 7일마다
   풀린다. 메일함이 하나뿐이니 앱 비밀번호가 훨씬 간단하고 안전하다.

   비밀번호는 저장소에 두지 않는다. Vercel 환경변수로만 넣는다.

     GMAIL_USER        보내는 Gmail 주소 (로그인 계정)
     GMAIL_APP_PASSWORD 앱 비밀번호 16자리 (공백 있어도 됨)
     GMAIL_FROM        받는 사람에게 보일 주소. 비우면 GMAIL_USER.
                       Gmail에 '다른 주소로 보내기'로 인증해 둔 주소여야 한다 —
                       기업에 나가는 메일이 @gmail.com이면 곤란하다.
     GMAIL_FROM_NAME   보낼 때 표시할 이름 (예: 스튜디오 블룸)

   보낸 메일은 exhibitor_logs에 남긴다. 여기가 빠지면 "누구에게 몇 번 독촉했나"를
   다시 알 수 없게 된다 — 이걸 남기려고 붙이는 기능이다.
══════════════════════════════════════════════════════════════ */
const express = require('express');
const nodemailer = require('nodemailer');
const pool = require('../db/pool');

const router = express.Router();

const cfg = () => ({
  user: (process.env.GMAIL_USER || '').trim(),
  pass: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),  // 구글이 4자씩 띄어 보여준다
  from: (process.env.GMAIL_FROM || process.env.GMAIL_USER || '').trim(),
  fromName: (process.env.GMAIL_FROM_NAME || '').trim(),
});

const transport = () => {
  const c = cfg();
  if (!c.user || !c.pass) return null;
  // 465(SSL)를 쓴다. Vercel에서 25번은 막혀 있고 587도 막히는 경우가 있다.
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: c.user, pass: c.pass },
  });
};

/* 설정이 됐는지 · 로그인이 되는지 — 메일을 보내지 않고 확인만 한다.
   비밀번호는 어떤 형태로도 돌려주지 않는다. */
router.get('/status', async (req, res) => {
  const c = cfg();
  const out = {
    ok: true,
    설정: {
      계정: c.user ? c.user.replace(/^(.{2}).*(@.*)$/, '$1***$2') : '(없음)',
      앱비밀번호: c.pass ? `${c.pass.length}자리 설정됨` : '(없음)',
      보내는주소: c.from || '(없음)',
      표시이름: c.fromName || '(없음)',
    },
  };
  const t = transport();
  if (!t) { out.연결 = '환경변수가 아직 안 채워졌어요'; return res.json(out); }
  try {
    await t.verify();
    out.연결 = '로그인 성공 — 보낼 수 있어요';
  } catch (e) {
    out.연결 = `로그인 실패: ${e.message}`;
    out.도움말 = '2단계 인증을 켜고 앱 비밀번호를 새로 발급했는지 확인해주세요.';
  }
  res.json(out);
});

/* 메일 보내기
   body: { to, subject, text, html?, cc?, exhibitor_id?, category?, kind? } */
router.post('/send', async (req, res) => {
  const t = transport();
  if (!t) return res.status(400).json({ ok: false, error: '메일 계정이 설정되지 않았어요' });

  const { to, subject, text, html, cc, exhibitor_id, category, kind } = req.body || {};
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;]/))
    .map((s) => String(s).trim()).filter(Boolean);

  const toList = list(to);
  if (!toList.length) return res.status(400).json({ ok: false, error: '받는 사람이 없어요' });
  if (!String(subject || '').trim() && !String(text || '').trim()) {
    return res.status(400).json({ ok: false, error: '제목이나 내용 중 하나는 있어야 해요' });
  }

  const c = cfg();
  try {
    const info = await t.sendMail({
      from: c.fromName ? `"${c.fromName}" <${c.from}>` : c.from,
      to: toList.join(', '),
      cc: list(cc).join(', ') || undefined,
      // 답장은 보낸 사람(로그인 계정)이 아니라 우리 회사 주소로 오게 한다
      replyTo: c.from,
      subject: String(subject || '').trim(),
      text: String(text || ''),
      html: html || undefined,
    });

    /* 보낸 사실을 기록에 남긴다. 이게 실패해도 메일은 이미 나갔으므로 성공으로
       돌려주되, 기록이 빠졌다는 걸 알려준다 — 조용히 넘어가면 독촉 이력이
       비어 있는 이유를 알 수 없다. */
    let logged = false, logError = null;
    if (exhibitor_id) {
      try {
        await pool.query(
          `INSERT INTO exhibitor_logs
             (id, exhibitor_id, kind, ts, direction, channel, counterpart, category,
              subject, body, answered_at, answer, status, author_email, author_name)
           VALUES ($1,$2,$3,$4,'out','이메일',$5,$6,$7,$8,'','','done',$9,$10)`,
          [`XL-${Date.now()}-${Math.floor(Math.random() * 1000)}`, exhibitor_id,
            kind || 'note', new Date().toISOString().slice(0, 10),
            toList.join(', '), category || '기타',
            String(subject || '').trim(), String(text || ''),
            req.user?.email || '', req.user?.name || '']);
        logged = true;
      } catch (e) { logError = e.message; }
    }

    res.json({ ok: true, messageId: info.messageId, accepted: info.accepted, logged, logError });
  } catch (e) {
    console.error('[mail] 발송 실패:', e.message);
    res.status(502).json({ ok: false, error: `발송 실패: ${e.message}` });
  }
});

module.exports = router;
