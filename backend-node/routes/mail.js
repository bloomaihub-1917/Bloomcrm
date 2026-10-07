/* ══════════════════════════════════════════════════════════════
   mail.js — CRM에서 메일 보내기 (1단계)

   발송은 행사별 공용 메일(메일플러그)로만 한다 — 아래 «행사별 공용 메일» 참고.
   아래 GMAIL_* 설정은 2026-09-01에 만든 1단계의 흔적으로, 지금은 /status 확인에만
   남아 있고 발송에는 쓰지 않는다.
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

/* ── 행사별 공용 메일 (메일플러그) ──
   행사마다 참가사·연사가 아는 주소가 따로 있다. 회사 공용 Gmail 하나로 보내면
   받는 쪽은 처음 보는 주소에서 온 메일을 받고, 답장도 행사 메일함이 아닌 곳으로
   간다. 그래서 행사에 메일 계정을 붙이고, 그 행사 사람에게 보낼 때는 그 계정으로
   보낸다. 계정이 없는 행사는 보내지 않는다(Gmail로 대신 보내지 않는다).

   events 표에 두지 않고 따로 둔다 — /api/data는 events를 통째로(SELECT *)
   화면에 내려 주므로, 거기 두면 암호문이라도 모든 브라우저에 흘러간다.

   비밀번호는 MAIL_SECRET(Vercel 환경변수)로 AES-256-GCM 암호화해 넣는다.
   키가 없으면 저장을 거절한다 — 평문으로 DB에 남느니 못 쓰는 편이 낫다.
   어떤 경로로도 비밀번호를 화면에 돌려주지 않는다. */
const crypto = require('crypto');
/* 기록 날짜는 한국 날짜로 — 서버(UTC) 날짜로 적으면 오전 9시 전에 보낸 메일이 전날로 남고,
   보낸메일함과 맞출 때 같은 메일을 다른 날로 보고 두 번 남긴다 */
const kstDate = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const MailComposer = require('nodemailer/lib/mail-composer');
const { ImapFlow } = require('imapflow');
const MAILPLUG = { host: 'smtp.mailplug.co.kr', port: 465, imap: 'imap.mailplug.co.kr', imapPort: 993 };
let boxReady = null;
const ensureBox = () => boxReady || (boxReady = pool.query(`
  CREATE TABLE IF NOT EXISTS event_mailboxes (
    event_id TEXT PRIMARY KEY, provider TEXT, host TEXT, port INTEGER,
    username TEXT, pass_enc TEXT, from_addr TEXT, from_name TEXT,
    updated_at TEXT, author_email TEXT)`).catch((e) => { boxReady = null; throw e; }));

const secretKey = () => {
  const s = (process.env.MAIL_SECRET || '').trim();
  return s ? crypto.createHash('sha256').update(s).digest() : null;
};
const seal = (plain) => {
  const key = secretKey();
  if (!key) throw new Error('MAIL_SECRET 환경변수가 없어 비밀번호를 저장할 수 없어요');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
};
const unseal = (sealed) => {
  const key = secretKey();
  if (!key || !sealed) return '';
  const [iv, tag, enc] = String(sealed).split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
};

const boxOf = async (eventId) => {
  if (!eventId) return null;
  await ensureBox();
  const r = await pool.query('SELECT * FROM event_mailboxes WHERE event_id = $1', [String(eventId)]);
  return r.rows[0] || null;
};
const boxTransport = (b) => {
  const port = Number(b.port) || MAILPLUG.port;
  return nodemailer.createTransport({
    host: b.host || MAILPLUG.host, port, secure: port === 465,
    auth: { user: b.username, pass: unseal(b.pass_enc) },
  });
};
// 화면에 내려 줄 모양 — 비밀번호는 «있다/없다»만
const boxPublic = (b) => ({
  event_id: b.event_id, provider: b.provider || 'mailplug', host: b.host, port: b.port,
  username: b.username, from_addr: b.from_addr, from_name: b.from_name,
  has_password: !!b.pass_enc, updated_at: b.updated_at, author_email: b.author_email,
});

/* 보낸메일함에 사본 넣기
   SMTP는 메일을 내보내기만 하고 보낸메일함에 남기지 않는다. 메일 프로그램(Outlook 등)이
   보낸 뒤 IMAP으로 사본을 따로 넣는 것과 같은 일을 여기서 한다 — 안 하면 팀원이
   메일플러그에서 «이 사람에게 뭘 보냈지»를 볼 수 없다.
   보낸메일함 이름은 서버가 붙인 표시(\Sent)로 찾고, 없으면 흔한 이름으로 찾는다.
   실패해도 메일은 이미 나갔으므로 발송은 성공으로 두고 화면에 알려 준다. */
/* 메일플러그 IMAP 접속. 서버는 AUTH=PLAIN을 지원한다고 알리면서 실제로
   AUTHENTICATE PLAIN을 보내면 «invalid command»로 거절한다(2026-10-07 확인) —
   기본 LOGIN 명령만 쓰고, 압축·ENABLE 같은 확장 명령도 끈다. */
const imapClient = (b) => new ImapFlow({
  host: MAILPLUG.imap, port: MAILPLUG.imapPort, secure: true,
  auth: { user: b.username, pass: unseal(b.pass_enc), loginMethod: 'LOGIN' },
  disableCompression: true, disableAutoEnable: true, logger: false,
});
const SENT_NAMES = /^(sent|sent messages|sent items|보낸\s*메일함|보낸\s*편지함)$/i;
async function saveToSent(b, raw) {
  const client = imapClient(b);
  await client.connect();
  try {
    const boxes = await client.list();
    const sent = boxes.find((x) => x.specialUse === '\\Sent')
      || boxes.find((x) => SENT_NAMES.test(x.name || '') || SENT_NAMES.test(x.path || ''));
    if (!sent) throw new Error(`보낸메일함을 찾지 못했어요 (${boxes.map((x) => x.path).join(', ')})`);
    await client.append(sent.path, raw, ['\\Seen']);
    return sent.path;
  } finally {
    await client.logout().catch(() => {});
  }
}

/* 행사 파트가 진행 완료인지 — 설정 exh_cfg_<행사>.parts[part] === 'done' */
async function partDone(eventId, part) {
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [`exh_cfg_${eventId}`]);
    const v = JSON.parse((r.rows[0] && r.rows[0].value) || '{}');
    return ((v.parts || {})[part]) === 'done';
  } catch (e) { return false; }
}

/* 보낼 계정 고르기 — 행사 공용 메일(메일플러그)만 쓴다 */
const senderFor = async (eventId) => {
  const b = await boxOf(eventId).catch(() => null);
  if (b && b.username && b.pass_enc) {
    const from = b.from_addr || b.username;
    return { t: boxTransport(b), box: b, from, fromName: b.from_name || '', via: `행사 메일 ${from}` };
  }
  // Gmail로 대신 보내지 않는다 — 행사 사람에게 처음 보는 주소로 나가면 안 된다
  return null;
};

router.get('/accounts', async (req, res) => {
  try {
    await ensureBox();
    const r = await pool.query('SELECT * FROM event_mailboxes ORDER BY event_id');
    res.json({ ok: true, keyReady: !!secretKey(), accounts: r.rows.map(boxPublic) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* 저장 — 비밀번호 칸을 비워 두면 예전 비밀번호를 그대로 쓴다
   (화면은 비밀번호를 모르므로 다른 칸만 고칠 때 매번 다시 치게 할 수 없다) */
router.put('/accounts/:eventId', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 고칠 수 없어요' });
  const eventId = String(req.params.eventId);
  const { username, password, from_addr, from_name, host, port } = req.body || {};
  const user = String(username || '').trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(user)) return res.status(400).json({ ok: false, error: '로그인 메일 주소를 확인해주세요' });
  try {
    const prev = await boxOf(eventId);
    let passEnc = prev ? prev.pass_enc : null;
    if (String(password || '').trim()) passEnc = seal(String(password).trim());
    if (!passEnc) return res.status(400).json({ ok: false, error: '비밀번호가 필요해요' });
    const row = [eventId, 'mailplug', String(host || '').trim() || MAILPLUG.host, Number(port) || MAILPLUG.port,
      user, passEnc, String(from_addr || '').trim() || user, String(from_name || '').trim(),
      new Date().toISOString(), req.user?.email || ''];
    await pool.query(`
      INSERT INTO event_mailboxes (event_id, provider, host, port, username, pass_enc, from_addr, from_name, updated_at, author_email)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (event_id) DO UPDATE SET provider=$2, host=$3, port=$4, username=$5, pass_enc=$6,
        from_addr=$7, from_name=$8, updated_at=$9, author_email=$10`, row);
    res.json({ ok: true, account: boxPublic(await boxOf(eventId)) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete('/accounts/:eventId', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 지울 수 없어요' });
  try {
    await ensureBox();
    await pool.query('DELETE FROM event_mailboxes WHERE event_id = $1', [String(req.params.eventId)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* 로그인만 해 본다 — 메일은 보내지 않는다 */
router.post('/accounts/:eventId/test', async (req, res) => {
  try {
    const b = await boxOf(req.params.eventId);
    if (!b) return res.status(404).json({ ok: false, error: '이 행사에 메일 계정이 없어요' });
    await boxTransport(b).verify();
    res.json({ ok: true, 연결: '로그인 성공 — 보낼 수 있어요' });
  } catch (e) {
    res.json({ ok: false, error: `로그인 실패: ${e.message}`,
      도움말: '메일플러그 관리자 화면에서 이 계정의 IMAP/SMTP 사용이 켜져 있는지, 메일 비밀번호가 아니라 앱 비밀번호를 넣었는지 확인해주세요.' });
  }
});

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
  const { to, subject, text, html, cc, exhibitor_id, speaker_id, category, kind,
    attachments: localFiles, file_ids } = req.body || {};

  /* 어느 행사 사람인지는 서버가 상대 기록에서 찾는다 — 화면이 보낸 event_id만
     믿으면 다른 행사 주소로 나가는 실수를 막을 수 없다 */
  let eventId = (req.body && req.body.event_id) || '';
  try {
    if (exhibitor_id) eventId = (await pool.query('SELECT event_id FROM exhibitors WHERE id = $1', [exhibitor_id])).rows[0]?.event_id || eventId;
    else if (speaker_id) eventId = (await pool.query('SELECT event_id FROM speakers WHERE id = $1', [speaker_id])).rows[0]?.event_id || eventId;
  } catch (e) { /* 행사를 못 찾으면 아래에서 막힌다 */ }
  /* 진행 완료된 행사(그 파트)는 열람만 — 화면 잠금을 피해 들어와도 여기서 막는다 */
  if (eventId && await partDone(eventId, exhibitor_id ? 'exh' : 'conf')) {
    return res.status(423).json({ ok: false, error: '진행 완료된 행사라 메일을 보낼 수 없어요' });
  }
  let sender;
  try { sender = await senderFor(eventId); }
  catch (e) { return res.status(500).json({ ok: false, error: `메일 계정을 읽지 못했어요 — 설정 › 행사 › 메일에서 앱 비밀번호를 다시 넣어주세요 (${e.message})` }); }
  if (!sender) return res.status(400).json({ ok: false, error: '이 행사에 공용 메일이 없어요 — 설정 › 행사 관리 › 메일에서 넣어주세요' });
  const t = sender.t;
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

  try {
    /* 한 번 만든 메일을 보내고 그대로 보낸메일함에도 넣는다 — 따로 만들면
       보낸 것과 남은 것이 달라질 수 있다 */
    const mail = {
      from: sender.fromName ? `"${sender.fromName}" <${sender.from}>` : sender.from,
      to: toList.join(', '),
      cc: list(cc).join(', ') || undefined,
      // 답장은 로그인 계정이 아니라 보이는 주소(행사 메일함)로 오게 한다
      replyTo: sender.from,
      subject: String(subject || '').trim(),
      text: String(text || ''),
      html: html || undefined,
      attachments: attachments.length ? attachments : undefined,
    };
    const raw = await new MailComposer(mail).compile().build();
    const info = await t.sendMail({
      envelope: { from: sender.from, to: [...toList, ...list(cc)] },
      raw,
    });
    let sentSaved = null, sentError = null;
    if (sender.box) {
      try { sentSaved = await saveToSent(sender.box, raw); }
      catch (e) { sentError = e.message; console.error('[mail] 보낸메일함 저장 실패:', e.message); }
    }

    /* 보낸 사실을 기록에 남긴다. 이게 실패해도 메일은 이미 나갔으므로 성공으로
       돌려주되, 기록이 빠졌다는 걸 알려준다 — 조용히 넘어가면 독촉 이력이
       비어 있는 이유를 알 수 없다. */
    let logged = false, logError = null, logId = null;
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
          [(logId = `${target.prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`), target.id,
            kind || 'note', kstDate(Date.now()),
            counterpart, category || '기타',
            String(subject || '').trim(),
            // 무엇을 붙여 보냈는지도 기록에 남긴다 — «양식 보냈나»를 나중에 다시 묻게 된다
            String(text || '') + (attachments.length ? `

[첨부] ${attachments.map((a) => a.filename).join(', ')}` : ''),
            req.user?.email || '', req.user?.name || '']);
        logged = true;
      } catch (e) { logError = e.message; logId = null; }
    }

    // logId를 돌려준다 — 화면이 임시 id로 들고 있으면 나중에 그 기록을 지울 수 없다
    res.json({ ok: true, messageId: info.messageId, accepted: info.accepted, via: sender.via, logged, logError, logId, sentSaved, sentError });
  } catch (e) {
    console.error('[mail] 발송 실패:', e.message);
    res.status(502).json({ ok: false, error: `발송 실패: ${e.message}` });
  }
});

/* ── 보낸메일함 → 연사 발송 기록 ──
   CRM이 생기기 전(또는 메일플러그 웹메일에서 직접) 보낸 메일은 기록에 없다. 행사
   메일함의 보낸메일함을 읽어, 받는 사람이 이 행사 연사(기본 정보 메일·연락 상대)인
   메일을 그 연사의 «보낸 기록»으로 옮긴다. 제목에 «초청»이 들어가면 초청·가이드를
   보낸 것으로 보고 «보냄» 날짜(guide_sent_at)가 비어 있을 때만 찍는다.

   apply가 없으면 무엇을 할지만 돌려준다 — 화면에서 확인한 뒤 apply로 다시 부른다.
   같은 날·같은 제목의 보낸 기록이 이미 있으면 건너뛴다(CRM에서 보낸 것, 두 번 누른 것). */
const { simpleParser } = require('mailparser');
const { convert: htmlToText } = require('html-to-text');
/* 본문 글자 — 메일플러그 웹메일은 본문을 HTML로만 보낸다(text 없음). text가 비면
   HTML을 글자로 바꾼다. 안 그러면 기록에 첨부 이름만 남았다. 이미지·링크 주소는 뺀다 */
const mailText = (mail) => String(mail.text || '').trim()
  || (mail.html ? htmlToText(mail.html, { wordwrap: false,
    selectors: [{ selector: 'img', format: 'skip' }, { selector: 'a', options: { ignoreHref: true } }] }).trim() : '');
const norm = (v) => String(v || '').trim().toLowerCase();
const prevDay = (d) => new Date(new Date(`${d}T00:00:00Z`).getTime() - 864e5).toISOString().slice(0, 10);

router.post('/accounts/:eventId/sync-sent', async (req, res) => {
  const apply = !!(req.body && req.body.apply);
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 바꿀 수 없어요' });
  const eventId = String(req.params.eventId);
  try {
    const b = await boxOf(eventId);
    if (!b) return res.status(404).json({ ok: false, error: '이 행사에 공용 메일이 없어요' });
    if (apply && await partDone(eventId, 'conf')) return res.status(423).json({ ok: false, error: '컨퍼런스가 진행 완료라 기록을 바꿀 수 없어요' });

    /* 이 행사 연사의 메일 주소 → 연사 */
    const sp = (await pool.query(`
      SELECT s.id, s.name_snapshot, s.name_en, s.guide_sent_at, c.email1, c.email2
        FROM speakers s LEFT JOIN contacts c ON c.id = s.contact_id
       WHERE s.event_id = $1`, [eventId])).rows;
    const extra = (await pool.query(`
      SELECT sc.speaker_id, sc.email FROM speaker_contacts sc
        JOIN speakers s ON s.id = sc.speaker_id WHERE s.event_id = $1`, [eventId])).rows;
    const byMail = new Map();
    const add = (em, id) => { const k = norm(em); if (k && !byMail.has(k)) byMail.set(k, id); };
    sp.forEach((r) => { add(r.email1, r.id); add(r.email2, r.id); });
    extra.forEach((r) => add(r.email, r.speaker_id));
    const spById = new Map(sp.map((r) => [r.id, r]));

    const logs = (await pool.query(`
      SELECT speaker_id, ts, subject FROM speaker_logs
       WHERE direction = 'out' AND speaker_id = ANY($1)`, [sp.map((r) => r.id)])).rows;
    const seen = new Set(logs.map((l) => `${l.speaker_id}|${l.ts}|${norm(l.subject)}`));

    /* 보낸메일함 읽기 */
    const client = imapClient(b);
    /* 어느 단계에서 막혔는지 알려 준다 — IMAP 서버는 «Command failed»만 돌려줘서
       무엇이 안 됐는지 알 수 없었다 */
    let stage = '메일함 로그인';
    try { await client.connect(); }
    catch (e) { throw new Error(`${stage} 실패: ${e.responseText || e.message} — 메일플러그 IMAP 사용이 켜져 있는지, 앱 비밀번호가 맞는지 확인해주세요`); }
    const found = [];
    let sentPath = '', total = 0;
    try {
      stage = '메일함 목록 읽기';
      const boxes = await client.list();
      const sent = boxes.find((x) => x.specialUse === '\\Sent')
        || boxes.find((x) => SENT_NAMES.test(x.name || '') || SENT_NAMES.test(x.path || ''));
      if (!sent) throw new Error(`보낸메일함을 찾지 못했어요 (${boxes.map((x) => x.path).join(', ')})`);
      sentPath = sent.path;
      stage = `«${sent.path}» 열기`;
      const lock = await client.getMailboxLock(sent.path);
      try {
        /* 날짜 검색(SEARCH SINCE)은 메일플러그가 거절했다(«Command failed»). 검색 없이
           마지막 300통을 번호로 읽고, 120일 지난 것은 여기서 거른다 — Vercel 한 번 부르는
           시간 안에 끝내려고 개수를 묶는다 */
        const n = (client.mailbox && client.mailbox.exists) || 0;
        const since = Date.now() - 120 * 864e5;
        stage = `«${sent.path}» 메일 읽기`;
        for await (const m of (n ? client.fetch(`${Math.max(1, n - 299)}:*`, { source: true, internalDate: true }) : [])) {
          if (m.internalDate && new Date(m.internalDate).getTime() < since) continue;
          total++;
          const mail = await simpleParser(m.source);
          const to = (mail.to ? [].concat(mail.to).flatMap((a) => a.value) : []).map((a) => a.address);
          const cc = (mail.cc ? [].concat(mail.cc).flatMap((a) => a.value) : []).map((a) => a.address);
          const ids = new Set([...to, ...cc].map((a) => byMail.get(norm(a))).filter(Boolean));
          if (!ids.size) continue;
          const date = kstDate(mail.date || Date.now());
          const subject = String(mail.subject || '').trim();
          const files = (mail.attachments || []).map((a) => a.filename).filter(Boolean);
          for (const id of ids) {
            const s0 = spById.get(id);
            const dup = seen.has(`${id}|${date}|${norm(subject)}`) || seen.has(`${id}|${prevDay(date)}|${norm(subject)}`);
            /* «초청·가이드 발송» 단계 메일 — 사무국은 «연사 가이드라인 송부»처럼 보내기도 한다.
               회신·전달(RE:/FW:)은 그 단계 메일이 아니다 */
            const reply = /^\s*(\[?(re|fw|fwd|답장|전달)\]?\s*:?\s*)+/i.test(subject) && /^\s*\[?(re|fw|fwd|답장|전달)\b/i.test(subject);
            const invite = !reply && /초청|가이드|invitation|guideline/i.test(subject);
            found.push({
              speaker_id: id, name: s0.name_snapshot || s0.name_en || id, date, subject,
              to: to.join(', '), cc: cc.join(', '), invite, dup,
              stamp: invite && !s0.guide_sent_at,
              body: mailText(mail) + (files.length ? `\n\n[첨부] ${files.join(', ')}` : ''),
            });
            seen.add(`${id}|${date}|${norm(subject)}`);
          }
        }
      } finally { lock.release(); }
    } catch (e) {
      // 메일함 쪽 실패는 단계와 서버가 준 사유를 붙여 돌려준다
      e.message = `${stage} 실패: ${e.responseText || e.message}${e.serverResponseCode ? ` (${e.serverResponseCode})` : ''}`;
      throw e;
    } finally { await client.logout().catch(() => {}); }

    /* 초청 날짜는 가장 이른 초청 메일 날짜로 */
    const firstInvite = {};
    found.filter((f) => f.stamp).forEach((f) => {
      if (!firstInvite[f.speaker_id] || f.date < firstInvite[f.speaker_id]) firstInvite[f.speaker_id] = f.date;
    });

    let added = 0, stamped = 0, filled = 0;
    if (apply) {
      /* 이미 들어간 기록 중 본문이 비어 있던 것(첨부 이름만 있던 것)은 본문을 채운다 —
         HTML 본문을 못 읽던 때 가져온 기록이다 */
      for (const f of found.filter((x) => x.dup)) {
        const u = await pool.query(`
          UPDATE speaker_logs SET body = $1
           WHERE speaker_id = $2 AND ts IN ($3, $4) AND lower(btrim(subject)) = $5 AND direction = 'out'
             AND btrim(split_part(COALESCE(body, ''), '[첨부]', 1)) = '' AND btrim($6) <> ''`,
        [f.body, f.speaker_id, f.date, prevDay(f.date), norm(f.subject), f.body.split('[첨부]')[0]]);
        filled += u.rowCount || 0;
      }
      for (const f of found.filter((x) => !x.dup)) {
        await pool.query(`
          INSERT INTO speaker_logs (id, speaker_id, kind, ts, direction, channel, counterpart, category,
            subject, body, answered_at, answer, status, author_email, author_name)
          VALUES ($1,$2,$3,$4,'out','이메일',$5,$6,$7,$8,'','','done',$9,$10)`,
        [`SL-${Date.now()}-${Math.floor(Math.random() * 100000)}`, f.speaker_id, f.invite ? 'invite' : 'note', f.date,
          [f.to, f.cc ? `(cc) ${f.cc}` : ''].filter(Boolean).join(' '), f.invite ? '초청·가이드 발송' : '기타',
          f.subject, f.body, req.user?.email || '', `${req.user?.name || req.user?.email || ''} (보낸메일함에서 가져옴)`]);
        added++;
      }
      for (const [id, d] of Object.entries(firstInvite)) {
        const u = await pool.query(`UPDATE speakers SET guide_sent_at = $1 WHERE id = $2 AND COALESCE(guide_sent_at,'') = ''`, [d, id]);
        stamped += u.rowCount || 0;
      }
    }
    res.json({
      ok: true, applied: apply, sentPath, scanned: total, added, stamped, filled,
      items: found.map(({ body, ...r }) => r),
      unmatchedSpeakers: sp.filter((r) => !found.some((f) => f.speaker_id === r.id))
        .map((r) => ({ id: r.id, name: r.name_snapshot || r.name_en, email: r.email1 || '' })),
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
