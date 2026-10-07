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
/* 기록에는 시각까지 남긴다(«2026-10-07 14:30», 한국 시각). 같은 메일인지 견줄 때는
   앞 10자리 날짜만 본다 — 예전 기록은 날짜만 있다 */
const kstStamp = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const MailComposer = require('nodemailer/lib/mail-composer');
const { ImapFlow } = require('imapflow');
const MAILPLUG = { host: 'smtp.mailplug.co.kr', port: 465, imap: 'imap.mailplug.co.kr', imapPort: 993 };
let boxReady = null;
const ensureBox = () => boxReady || (boxReady = pool.query(`
  CREATE TABLE IF NOT EXISTS event_mailboxes (
    event_id TEXT PRIMARY KEY, provider TEXT, host TEXT, port INTEGER,
    username TEXT, pass_enc TEXT, from_addr TEXT, from_name TEXT,
    updated_at TEXT, author_email TEXT)`)
  // 마지막으로 메일함을 가져온 시각·누가(자동이면 «자동») — 대시보드 숫자가 언제 기준인지 보이게
  .then(() => pool.query('ALTER TABLE event_mailboxes ADD COLUMN IF NOT EXISTS last_sync_at TEXT'))
  .then(() => pool.query('ALTER TABLE event_mailboxes ADD COLUMN IF NOT EXISTS last_sync_by TEXT'))
  .catch((e) => { boxReady = null; throw e; }));
const markSynced = (eventId, who) => pool.query(
  'UPDATE event_mailboxes SET last_sync_at = $1, last_sync_by = $2 WHERE event_id = $3',
  [kstStamp(Date.now()), who || '', eventId]).catch(() => {});

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
  last_sync_at: b.last_sync_at || '', last_sync_by: b.last_sync_by || '',
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
            kind || 'note', kstStamp(Date.now()),
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
const H2T = { wordwrap: false,
  selectors: [{ selector: 'img', format: 'skip' }, { selector: 'a', options: { ignoreHref: true } }] };
/* 본문으로 쓸 첨부 — 어떤 메일은 본문(text/html)을 이름 붙은 조각으로 넣어 첨부로 잡힌다
   («def3907333c4» 같은 이름). 글자·HTML 본문이 둘 다 비면 이걸 본문으로 쓴다 */
const bodyParts = (mail) => (mail.attachments || [])
  .filter((a) => /^text\/(html|plain)/i.test(a.contentType || '') && a.content && a.size < 512 * 1024);
const mailText = (mail) => {
  const direct = String(mail.text || '').trim()
    || (mail.html ? htmlToText(mail.html, H2T).trim() : '');
  if (direct) return direct;
  return bodyParts(mail).map((a) => {
    const t = a.content.toString('utf8');
    return /html/i.test(a.contentType) ? htmlToText(t, H2T).trim() : t.trim();
  }).filter(Boolean).join('\n\n');
};
const norm = (v) => String(v || '').trim().toLowerCase();
/* 보낸 메일이 연락 단계 중 무엇인지 — 행사마다 제목을 다르게 쓴다
   (KPBMA «연사 가이드라인 송부», AIA «연사 확정 안내 및 자료 제출 요청»,
   «Speaker Confirmation & Submission Request», «Reminder — Speaker Materials»).
   단어 하나로 맞추면 다른 행사는 전부 «기타»가 됐다. 회신·전달(RE/FW)은 단계 메일이 아니다.
   kind는 speaker-flow.js의 단계 키 — invite면 «보냄» 날짜를 찍고, collect가 있으면
   다음 메일은 독촉으로 바뀐다. */
const REPLY_RE = /^\s*(제목\s*:\s*)?\[?\s*(re|fw|fwd|답장|전달)\s*\]?\s*[:\]]?/i;
function classifySent(subject) {
  const t = String(subject || '');
  if (REPLY_RE.test(t)) return { kind: 'note', category: '회신' };
  if (/reminder|재요청|독촉|다시 요청/i.test(t)) return { kind: 'collect', category: '자료 독촉' };
  if (/초청|가이드|확정 안내|invitation|guideline|confirmation/i.test(t)) return { kind: 'invite', category: '초청·가이드 발송' };
  if (/자료\s*(제출|요청)|submission|materials|이력|초록|abstract|profile/i.test(t)) return { kind: 'collect', category: '자료 받기' };
  if (/숙박|항공|accommodation|flight/i.test(t)) return { kind: 'travel', category: '숙박·항공 안내' };
  if (/발표\s*자료|presentation|slides/i.test(t)) return { kind: 'slides', category: '발표자료 받기' };
  if (/감사|thank/i.test(t)) return { kind: 'thanks', category: '감사 메일' };
  return { kind: 'note', category: '기타' };
}
/* 참가사에게 보낸 메일이 어느 단계인지 — js/modules/exh-mail.js EXH_MAIL_STEPS와 같은 키 */
const EXH_LABEL = { manual: '참가 매뉴얼 안내', app: '신청서 제출 요청', booth: '부스 배정 안내',
  payment: '인보이스·입금 안내', graphic: '그래픽 자료 요청', directory: '도록 정보 요청', movein: '반입·설치 안내' };
function classifyExhSent(subject) {
  const t = String(subject || '');
  if (REPLY_RE.test(t)) return { kind: 'note', category: '회신' };
  const k = /매뉴얼|manual/i.test(t) ? 'manual'
    : /신청서|application/i.test(t) ? 'app'
    : /인보이스|입금|invoice|payment/i.test(t) ? 'payment'
    : /그래픽|graphic|디자인 파일/i.test(t) ? 'graphic'
    : /도록|디렉토리|directory|프로그램북/i.test(t) ? 'directory'
    : /반입|설치|move-?in|installation/i.test(t) ? 'movein'
    : /부스\s*(배정|위치|도면)|booth/i.test(t) ? 'booth' : '';
  return k ? { kind: `exh-${k}`, category: EXH_LABEL[k] } : { kind: 'note', category: '기타' };
}
const prevDay = (d) => new Date(new Date(`${d}T00:00:00Z`).getTime() - 864e5).toISOString().slice(0, 10);

const syncSentHandler = async (req, res) => {
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

    /* 참가사 담당자 주소 → 기업. 같은 주소가 연사면 연사로 본다(위에서 먼저 잡힌다).
       전시가 진행 완료면 참가사 기록은 건드리지 않는다 */
    const exhDone = await partDone(eventId, 'exh');
    const exByMail = new Map();
    const exName = new Map();
    if (!exhDone) {
      (await pool.query(`SELECT id, company_name FROM exhibitors WHERE event_id = $1`, [eventId])).rows
        .forEach((r) => exName.set(r.id, r.company_name || r.id));
      (await pool.query(`
        SELECT xc.exhibitor_id, xc.email, c.email1, c.email2 FROM exhibitor_contacts xc
          JOIN exhibitors x ON x.id = xc.exhibitor_id LEFT JOIN contacts c ON c.id = xc.contact_id
         WHERE x.event_id = $1`, [eventId])).rows
        .forEach((r) => [r.email, r.email1, r.email2].forEach((em) => {
          const k = norm(em); if (k && !byMail.has(k) && !exByMail.has(k)) exByMail.set(k, r.exhibitor_id);
        }));
    }
    const exSeen = new Set((await pool.query(
      `SELECT exhibitor_id id, ts, subject FROM exhibitor_logs WHERE direction = 'out' AND exhibitor_id = ANY($1)`,
      [[...exName.keys()]])).rows.map((l) => `${l.id}|${String(l.ts || '').slice(0, 10)}|${norm(l.subject)}`));

    const logs = (await pool.query(`
      SELECT speaker_id, ts, subject FROM speaker_logs
       WHERE direction = 'out' AND speaker_id = ANY($1)`, [sp.map((r) => r.id)])).rows;
    const seen = new Set(logs.map((l) => `${l.speaker_id}|${String(l.ts || '').slice(0, 10)}|${norm(l.subject)}`));

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
          const exIds = new Set([...to, ...cc].map((a) => exByMail.get(norm(a))).filter(Boolean));
          if (!ids.size && !exIds.size) continue;
          const date = kstDate(mail.date || Date.now());
          const at = kstStamp(mail.date || m.internalDate || Date.now());
          const subject = String(mail.subject || '').trim();
          // 본문으로 쓴 조각은 첨부 목록에서 뺀다
          const asBody = new Set(String(mail.text || '').trim() || mail.html ? [] : bodyParts(mail));
          const files = (mail.attachments || []).filter((a) => !asBody.has(a)).map((a) => a.filename).filter(Boolean);
          for (const id of exIds) {
            const d = exSeen.has(`${id}|${date}|${norm(subject)}`) || exSeen.has(`${id}|${prevDay(date)}|${norm(subject)}`);
            const cls = classifyExhSent(subject);
            found.push({
              t: 'ex', exhibitor_id: id, name: exName.get(id) || id, date, at, subject,
              to: to.join(', '), cc: cc.join(', '), kind: cls.kind, category: cls.category, dup: d,
              body: mailText(mail) + (files.length ? `\n\n[첨부] ${files.join(', ')}` : ''),
            });
            exSeen.add(`${id}|${date}|${norm(subject)}`);
          }
          for (const id of ids) {
            const s0 = spById.get(id);
            const dup = seen.has(`${id}|${date}|${norm(subject)}`) || seen.has(`${id}|${prevDay(date)}|${norm(subject)}`);
            const cls = classifySent(subject);
            const invite = cls.kind === 'invite';
            found.push({
              speaker_id: id, name: s0.name_snapshot || s0.name_en || id, date, at, subject,
              to: to.join(', '), cc: cc.join(', '), invite, kind: cls.kind, category: cls.category, dup,
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

    let added = 0, stamped = 0, filled = 0, sorted = 0;
    if (apply) {
      /* 이미 들어간 기록 중 본문이 비어 있던 것(첨부 이름만 있던 것)은 본문을 채운다 —
         HTML 본문을 못 읽던 때 가져온 기록이다 */
      /* 비었는지는 공백·줄바꿈을 다 지우고 본다 — btrim은 줄바꿈을 안 지워서
         «줄바꿈 두 개 + [첨부]…»로 들어간 빈 본문을 못 알아봤다 */
      for (const f of found.filter((x) => x.dup && x.t !== 'ex')) {
        const u = await pool.query(`
          UPDATE speaker_logs SET body = $1
           WHERE speaker_id = $2 AND left(ts, 10) IN ($3, $4) AND lower(btrim(subject)) = $5 AND direction = 'out'
             AND regexp_replace(split_part(COALESCE(body, ''), '[첨부]', 1), '\\s', '', 'g') = ''
             AND regexp_replace($6, '\\s', '', 'g') <> ''`,
        [f.body, f.speaker_id, f.date, prevDay(f.date), norm(f.subject), f.body.split('[첨부]')[0]]);
        filled += u.rowCount || 0;
        await pool.query(`
          UPDATE speaker_logs SET ts = $1
           WHERE speaker_id = $2 AND ts IN ($3, $4) AND lower(btrim(subject)) = $5 AND direction = 'out'
             AND author_name LIKE '%메일함에서 가져옴%'`, [f.at, f.speaker_id, f.date, prevDay(f.date), norm(f.subject)]);
        if (f.kind !== 'note' || f.category !== '기타') {
          const k = await pool.query(`
            UPDATE speaker_logs SET kind = $1, category = $2
             WHERE speaker_id = $3 AND left(ts, 10) IN ($4, $5) AND lower(btrim(subject)) = $6 AND direction = 'out'
               AND kind = 'note' AND COALESCE(category, '기타') = '기타' AND author_name LIKE '%보낸메일함에서 가져옴%'`,
          [f.kind, f.category, f.speaker_id, f.date, prevDay(f.date), norm(f.subject)]);
          sorted += k.rowCount || 0;
        }
      }
      for (const f of found.filter((x) => !x.dup && x.t === 'ex')) {
        await pool.query(`
          INSERT INTO exhibitor_logs (id, exhibitor_id, kind, ts, direction, channel, counterpart, category,
            subject, body, answered_at, answer, status, author_email, author_name)
          VALUES ($1,$2,$3,$4,'out','이메일',$5,$6,$7,$8,'','','done',$9,$10)`,
        [`XL-${Date.now()}-${Math.floor(Math.random() * 100000)}`, f.exhibitor_id, f.kind, f.at,
          [f.to, f.cc ? `(cc) ${f.cc}` : ''].filter(Boolean).join(' '), f.category,
          f.subject, f.body, req.user?.email || '', `${req.user?.name || req.user?.email || ''} (보낸메일함에서 가져옴)`]);
        added++;
      }
      for (const f of found.filter((x) => !x.dup && x.t !== 'ex')) {
        await pool.query(`
          INSERT INTO speaker_logs (id, speaker_id, kind, ts, direction, channel, counterpart, category,
            subject, body, answered_at, answer, status, author_email, author_name)
          VALUES ($1,$2,$3,$4,'out','이메일',$5,$6,$7,$8,'','','done',$9,$10)`,
        [`SL-${Date.now()}-${Math.floor(Math.random() * 100000)}`, f.speaker_id, f.kind, f.at,
          [f.to, f.cc ? `(cc) ${f.cc}` : ''].filter(Boolean).join(' '), f.category,
          f.subject, f.body, req.user?.email || '', `${req.user?.name || req.user?.email || ''} (보낸메일함에서 가져옴)`]);
        added++;
      }
      for (const [id, d] of Object.entries(firstInvite)) {
        const u = await pool.query(`UPDATE speakers SET guide_sent_at = $1 WHERE id = $2 AND COALESCE(guide_sent_at,'') = ''`, [d, id]);
        stamped += u.rowCount || 0;
      }
    }
    if (apply) await markSynced(eventId, req.user?.name || req.user?.email || '');
    res.json({
      ok: true, applied: apply, sentPath, scanned: total, added, stamped, filled, sorted,
      items: found.map(({ body, ...r }) => r),
      unmatchedSpeakers: sp.filter((r) => !found.some((f) => f.speaker_id === r.id))
        .map((r) => ({ id: r.id, name: r.name_snapshot || r.name_en, email: r.email1 || '' })),
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
};

/* ── 받은메일함 → 연사·참가사 기록 ──
   상대가 보낸 메일도 그 사람 기록에 쌓는다. 보낸 사람 주소가 이 행사 연사(마스터DB
   메일·연락 상대)면 speaker_logs, 참가사 담당자(담당자 줄 메일·마스터DB 메일)면
   exhibitor_logs에 direction 'in'으로 남긴다. 둘 다 아니면 남기지 않는다 —
   광고·알림까지 쌓이면 정작 사람 메일이 묻힌다.

   «답변 대기» 문의로 만들지는 않는다(kind 'note'). 회신·자료 송부까지 전부 답할 일로
   잡히면 대기 목록이 쓸모없어진다. 문의로 돌릴 메일은 사람이 고른다.
   같은 날(또는 하루 전)·같은 제목·같은 사람의 받은 기록이 있으면 건너뛴다. */
const syncInboxHandler = async (req, res) => {
  const apply = !!(req.body && req.body.apply);
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 바꿀 수 없어요' });
  const eventId = String(req.params.eventId);
  try {
    const b = await boxOf(eventId);
    if (!b) return res.status(404).json({ ok: false, error: '이 행사에 공용 메일이 없어요' });
    // 진행 완료된 파트는 건드리지 않는다
    const confDone = await partDone(eventId, 'conf');
    const exhDone = await partDone(eventId, 'exh');

    /* 주소 → 사람. 같은 주소가 연사와 담당자 둘 다면 연사로 본다 */
    const byMail = new Map();
    const add = (em, who) => { const k = norm(em); if (k && !byMail.has(k)) byMail.set(k, who); };
    const sp = (await pool.query(`
      SELECT s.id, s.name_snapshot, s.name_en, s.guide_sent_at, s.invite_replied_at, c.email1, c.email2
        FROM speakers s LEFT JOIN contacts c ON c.id = s.contact_id WHERE s.event_id = $1`, [eventId])).rows;
    const spName = new Map(sp.map((r) => [r.id, r.name_snapshot || r.name_en || r.id]));
    if (!confDone) {
      sp.forEach((r) => { add(r.email1, { t: 'sp', id: r.id }); add(r.email2, { t: 'sp', id: r.id }); });
      (await pool.query(`SELECT sc.speaker_id, sc.email FROM speaker_contacts sc
         JOIN speakers s ON s.id = sc.speaker_id WHERE s.event_id = $1`, [eventId])).rows
        .forEach((r) => add(r.email, { t: 'sp', id: r.speaker_id }));
    }
    const ex = (await pool.query(`SELECT id, company_name FROM exhibitors WHERE event_id = $1`, [eventId])).rows;
    const exName = new Map(ex.map((r) => [r.id, r.company_name || r.id]));
    if (!exhDone) {
      (await pool.query(`
        SELECT xc.exhibitor_id, xc.email, c.email1, c.email2 FROM exhibitor_contacts xc
          JOIN exhibitors x ON x.id = xc.exhibitor_id
          LEFT JOIN contacts c ON c.id = xc.contact_id
         WHERE x.event_id = $1`, [eventId])).rows
        .forEach((r) => [r.email, r.email1, r.email2].forEach((em) => add(em, { t: 'ex', id: r.exhibitor_id })));
    }

    const seen = new Set();
    (await pool.query(`SELECT speaker_id id, ts, subject FROM speaker_logs WHERE direction = 'in' AND speaker_id = ANY($1)`,
      [sp.map((r) => r.id)])).rows.forEach((l) => seen.add(`sp|${l.id}|${String(l.ts || '').slice(0, 10)}|${norm(l.subject)}`));
    (await pool.query(`SELECT exhibitor_id id, ts, subject FROM exhibitor_logs WHERE direction = 'in' AND exhibitor_id = ANY($1)`,
      [ex.map((r) => r.id)])).rows.forEach((l) => seen.add(`ex|${l.id}|${String(l.ts || '').slice(0, 10)}|${norm(l.subject)}`));

    const self = new Set([norm(b.username), norm(b.from_addr)]);
    const client = imapClient(b);
    let stage = '메일함 로그인';
    try { await client.connect(); }
    catch (e) { throw new Error(`${stage} 실패: ${e.responseText || e.message} — 메일플러그 IMAP 사용이 켜져 있는지, 앱 비밀번호가 맞는지 확인해주세요`); }
    const found = [];
    let total = 0;
    try {
      stage = '받은메일함 열기';
      const lock = await client.getMailboxLock('INBOX');
      try {
        // 보낸메일함과 같은 이유로 날짜 검색 없이 마지막 300통 — 120일 지난 것은 거른다
        const n = (client.mailbox && client.mailbox.exists) || 0;
        const since = Date.now() - 120 * 864e5;
        stage = '받은메일함 메일 읽기';
        for await (const m of (n ? client.fetch(`${Math.max(1, n - 299)}:*`, { source: true, internalDate: true }) : [])) {
          if (m.internalDate && new Date(m.internalDate).getTime() < since) continue;
          total++;
          const mail = await simpleParser(m.source);
          const from = (mail.from ? mail.from.value : []).map((a) => a.address)[0] || '';
          if (!from || self.has(norm(from))) continue;
          const who = byMail.get(norm(from));
          if (!who) continue;
          const date = kstDate(mail.date || m.internalDate || Date.now());
          const subject = String(mail.subject || '').trim();
          const key = (d) => `${who.t}|${who.id}|${d}|${norm(subject)}`;
          const dup = seen.has(key(date)) || seen.has(key(prevDay(date)));
          seen.add(key(date));
          const asBody = new Set(String(mail.text || '').trim() || mail.html ? [] : bodyParts(mail));
          const files = (mail.attachments || []).filter((a) => !asBody.has(a)).map((a) => a.filename).filter(Boolean);
          const fromName = (mail.from && mail.from.value[0] && mail.from.value[0].name) || '';
          found.push({
            t: who.t, id: who.id, name: who.t === 'sp' ? spName.get(who.id) : exName.get(who.id),
            date, at: kstStamp(mail.date || m.internalDate || Date.now()), subject, from: fromName ? `${fromName} <${from}>` : from, dup,
            files: files.length,
            body: mailText(mail) + (files.length ? `\n\n[첨부] ${files.join(', ')}` : ''),
          });
        }
      } finally { lock.release(); }
    } catch (e) {
      e.message = `${stage} 실패: ${e.responseText || e.message}${e.serverResponseCode ? ` (${e.serverResponseCode})` : ''}`;
      throw e;
    } finally { await client.logout().catch(() => {}); }

    /* 참석 회신 — 초청·가이드를 보낸 연사에게서 그날 이후 메일이 오면 «회신 받음»을 찍는다.
       날짜는 그 조건의 가장 이른 메일. 이미 찍혀 있으면 두고, 보내기 전에 온 메일은
       회신이 아니다(섭외 전 문의일 수 있다). 이미 가져온 메일(dup)도 센다 */
    const spRow = new Map(sp.map((r) => [r.id, r]));
    const firstReply = {};
    found.filter((f) => f.t === 'sp').forEach((f) => {
      const r = spRow.get(f.id);
      if (!r || !r.guide_sent_at || r.invite_replied_at) return;
      if (f.date < String(r.guide_sent_at).slice(0, 10)) return;
      if (!firstReply[f.id] || f.date < firstReply[f.id]) firstReply[f.id] = f.date;
    });
    const replyNames = Object.keys(firstReply).map((id) => spName.get(id));

    let added = 0, replied = 0;
    if (apply) {
      for (const [id, d] of Object.entries(firstReply)) {
        const u = await pool.query(`UPDATE speakers SET invite_replied_at = $1, reply_auto = 'yes'
          WHERE id = $2 AND COALESCE(invite_replied_at, '') = ''`, [d, id]);
        replied += u.rowCount || 0;
      }
      for (const f of found.filter((x) => !x.dup)) {
        const sp0 = f.t === 'sp';
        await pool.query(`
          INSERT INTO ${sp0 ? 'speaker_logs' : 'exhibitor_logs'} (id, ${sp0 ? 'speaker_id' : 'exhibitor_id'}, kind, ts, direction,
            channel, counterpart, category, subject, body, answered_at, answer, status, author_email, author_name)
          VALUES ($1,$2,'note',$3,'in','이메일',$4,'받은 메일',$5,$6,'','','open',$7,$8)`,
        [`${sp0 ? 'SL' : 'XL'}-${Date.now()}-${Math.floor(Math.random() * 100000)}`, f.id, f.at, f.from,
          f.subject, f.body, req.user?.email || '', `${req.user?.name || req.user?.email || ''} (받은메일함에서 가져옴)`]);
        added++;
      }
    }
    if (apply) await markSynced(eventId, req.user?.name || req.user?.email || '');
    res.json({
      ok: true, applied: apply, scanned: total, added, replied, replyNames,
      items: found.map(({ body, ...r }) => r),
      skipped: [confDone ? '컨퍼런스(진행 완료)' : '', exhDone ? '전시(진행 완료)' : ''].filter(Boolean),
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
};

router.post('/accounts/:eventId/sync-sent', syncSentHandler);
router.post('/accounts/:eventId/sync-inbox', syncInboxHandler);

/* ── 자동 가져오기 ──
   GitHub 예약 작업이 15분마다 부른다(.github/workflows/mail-sync.yml). 로그인한 사람이
   아니라 비밀 키(CRON_SECRET, Vercel·GitHub 둘 다에 같은 값)로 들어온다.
   한 번에 행사 하나 — Vercel 함수 한 번(60초) 안에 끝나게. 행사 목록은 따로 받는다.
   처리 결과 숫자만 돌려준다(이름·제목은 GitHub 기록에 남기지 않는다). */
const cron = express.Router();
cron.use((req, res, next) => {
  const want = (process.env.CRON_SECRET || '').trim();
  if (!want) return res.status(503).json({ ok: false, error: 'CRON_SECRET이 설정되지 않았어요' });
  const got = String(req.headers['x-cron-secret'] || '');
  const a = Buffer.from(got), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ ok: false });
  next();
});
cron.get('/mail-events', async (req, res) => {
  try {
    await ensureBox();
    const r = await pool.query("SELECT event_id FROM event_mailboxes WHERE COALESCE(pass_enc, '') <> '' ORDER BY event_id");
    res.json({ ok: true, events: r.rows.map((x) => x.event_id) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// 처리기를 그대로 부른다 — 사람이 누를 때와 같은 규칙(중복 건너뛰기·진행 완료 제외·회신 체크)
const runHandler = (handler, eventId) => new Promise((resolve) => {
  const req = { params: { eventId }, body: { apply: true }, user: { email: 'auto@cron', name: '자동' } };
  const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, ...o }); } };
  handler(req, res).catch((e) => resolve({ code: 500, ok: false, error: e.message }));
});
cron.post('/mail-sync', async (req, res) => {
  const eventId = String(req.query.event || '');
  if (!eventId) return res.status(400).json({ ok: false, error: 'event가 필요해요' });
  const sent = await runHandler(syncSentHandler, eventId);
  const inbox = await runHandler(syncInboxHandler, eventId);
  res.json({
    ok: !!(sent.ok && inbox.ok),
    sent: sent.ok ? { added: sent.added, stamped: sent.stamped } : { error: sent.error },
    inbox: inbox.ok ? { added: inbox.added, replied: inbox.replied } : { error: inbox.error },
  });
});

module.exports = router;
module.exports.cron = cron;
