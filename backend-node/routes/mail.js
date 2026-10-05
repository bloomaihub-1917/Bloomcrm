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

/* ── 첨부파일 ──
   Vercel 함수는 요청 하나가 4.5MB를 넘으면 받지 않는다. 브라우저에서 고른 파일은
   base64로 오며 1.33배로 불어나므로, 한 번에 보낼 수 있는 PC 파일은 합쳐서
   3MB로 막는다. 단계별 기본 첨부(가이드·양식)는 미리 DB에 올려 두고 id만 받으므로
   그 한도와 무관하다 — Gmail 한도(25MB) 안에서 합쳐 20MB까지. */
const LOCAL_MAX = 3 * 1024 * 1024;
const TOTAL_MAX = 20 * 1024 * 1024;
const FILE_MAX = 3 * 1024 * 1024;
let filesReady = null;
const ensureFiles = () => filesReady || (filesReady = pool.query(`
  CREATE TABLE IF NOT EXISTS mail_files (
    id TEXT PRIMARY KEY, event_id TEXT, step TEXT, filename TEXT, content_type TEXT,
    size INTEGER, data TEXT, created_at TEXT, author_email TEXT)`).catch((e) => { filesReady = null; throw e; }));
const b64size = (b) => Math.floor(String(b || '').replace(/=+$/, '').length * 3 / 4);

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

/* 단계별 기본 첨부 — 목록은 내용 없이 이름·크기만 */
router.get('/files', async (req, res) => {
  try {
    await ensureFiles();
    const r = await pool.query(
      `SELECT id, event_id, step, filename, content_type, size, created_at, author_email
         FROM mail_files WHERE ($1 = '' OR event_id = $1) ORDER BY created_at`, [String(req.query.event_id || '')]);
    res.json({ ok: true, files: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/files', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 올릴 수 없어요' });
  const { event_id, step, filename, content_type, data } = req.body || {};
  if (!event_id || !step || !filename || !data) return res.status(400).json({ ok: false, error: '행사·단계·파일이 필요해요' });
  const size = b64size(data);
  if (size > FILE_MAX) return res.status(413).json({ ok: false, error: `파일이 너무 커요 (${(size / 1048576).toFixed(1)}MB, 최대 3MB)` });
  try {
    await ensureFiles();
    const id = `MF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const created_at = new Date().toISOString();
    await pool.query(
      `INSERT INTO mail_files (id, event_id, step, filename, content_type, size, data, created_at, author_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, event_id, step, String(filename).slice(0, 200), content_type || 'application/octet-stream', size, data,
        created_at, req.user?.email || '']);
    res.json({ ok: true, file: { id, event_id, step, filename, content_type, size, created_at } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete('/files/:id', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 지울 수 없어요' });
  try {
    await ensureFiles();
    await pool.query('DELETE FROM mail_files WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* 메일 보내기
   body: { to, subject, text, html?, cc?, exhibitor_id?, speaker_id?, category?, kind? }

   연사에게 보낼 때는 실무진이 수신, 연사가 참조인 경우가 흔하다. 누구를
   수신으로 두는지는 화면에서 정하고, 여기서는 to·cc를 그대로 받아 보낸다.
   기록은 상대에 따라 다른 표로 간다 — 전시는 exhibitor_logs, 연사는
   speaker_logs. 한쪽에 몰아 두면 «이 연사에게 몇 번 독촉했나»를 다시 셀 수
   없다. */
router.post('/send', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 메일을 보낼 수 없어요' });
  const t = transport();
  if (!t) return res.status(400).json({ ok: false, error: '메일 계정이 설정되지 않았어요' });

  const { to, subject, text, html, cc, exhibitor_id, speaker_id, category, kind,
    attachments: localFiles, file_ids } = req.body || {};
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;]/))
    .map((s) => String(s).trim()).filter(Boolean);

  const toList = list(to);
  if (!toList.length) return res.status(400).json({ ok: false, error: '받는 사람이 없어요' });
  if (!String(subject || '').trim() && !String(text || '').trim()) {
    return res.status(400).json({ ok: false, error: '제목이나 내용 중 하나는 있어야 해요' });
  }

  /* 첨부 — PC에서 고른 것(base64)과 미리 올려 둔 기본 첨부(id) */
  const attachments = [];
  let localTotal = 0;
  for (const f of (Array.isArray(localFiles) ? localFiles : [])) {
    if (!f || !f.data || !f.filename) continue;
    localTotal += b64size(f.data);
    attachments.push({ filename: String(f.filename), content: f.data, encoding: 'base64', contentType: f.content_type || undefined });
  }
  if (localTotal > LOCAL_MAX) return res.status(413).json({ ok: false, error: 'PC에서 고른 첨부가 합쳐서 3MB를 넘어요' });
  const ids = (Array.isArray(file_ids) ? file_ids : []).filter(Boolean);
  if (ids.length) {
    try {
      await ensureFiles();
      const r = await pool.query('SELECT filename, content_type, data, size FROM mail_files WHERE id = ANY($1)', [ids]);
      r.rows.forEach((f) => attachments.push({ filename: f.filename, content: f.data, encoding: 'base64', contentType: f.content_type || undefined }));
      const total = localTotal + r.rows.reduce((n, f) => n + (Number(f.size) || 0), 0);
      if (total > TOTAL_MAX) return res.status(413).json({ ok: false, error: '첨부가 합쳐서 20MB를 넘어요' });
    } catch (e) { return res.status(500).json({ ok: false, error: `기본 첨부를 읽지 못했어요: ${e.message}` }); }
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
      attachments: attachments.length ? attachments : undefined,
    });

    /* 보낸 사실을 기록에 남긴다. 이게 실패해도 메일은 이미 나갔으므로 성공으로
       돌려주되, 기록이 빠졌다는 걸 알려준다 — 조용히 넘어가면 독촉 이력이
       비어 있는 이유를 알 수 없다. */
    let logged = false, logError = null;
    /* 참조까지 상대로 남긴다 — 연사 메일은 실무진이 수신, 연사가 참조인 경우가
       많아 수신만 적으면 정작 연사에게 보낸 기록이 비어 보인다. */
    const counterpart = [toList.join(', '), list(cc).length ? `(cc) ${list(cc).join(', ')}` : '']
      .filter(Boolean).join(' ');
    const target = exhibitor_id
      ? { table: 'exhibitor_logs', col: 'exhibitor_id', id: exhibitor_id, prefix: 'XL' }
      : speaker_id
        ? { table: 'speaker_logs', col: 'speaker_id', id: speaker_id, prefix: 'SL' }
        : null;
    if (target) {
      try {
        await pool.query(
          `INSERT INTO ${target.table}
             (id, ${target.col}, kind, ts, direction, channel, counterpart, category,
              subject, body, answered_at, answer, status, author_email, author_name)
           VALUES ($1,$2,$3,$4,'out','이메일',$5,$6,$7,$8,'','','done',$9,$10)`,
          [`${target.prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`, target.id,
            kind || 'note', new Date().toISOString().slice(0, 10),
            counterpart, category || '기타',
            String(subject || '').trim(),
            // 무엇을 붙여 보냈는지도 기록에 남긴다 — «양식 보냈나»를 나중에 다시 묻게 된다
            String(text || '') + (attachments.length ? `

[첨부] ${attachments.map((a) => a.filename).join(', ')}` : ''),
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
