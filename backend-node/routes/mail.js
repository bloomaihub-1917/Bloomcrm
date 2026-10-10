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
const { suggestOwners } = require('./mail-suggest');
const { isOurs, domainOf: domOf, domainList, parseForward, forwardOf, forwardCandidates, fmtAddr } = require('./mail-forward');

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
/* 메일 서비스별 서버 — 행사마다 메일플러그나 Gmail을 고른다.
   saveSent: 보낸 뒤 보낸메일함에 사본을 우리가 넣어야 하는지. Gmail은 SMTP로 보내면
   보낸편지함에 저절로 남아서, 넣으면 두 통이 된다 */
const PROVIDERS = {
  mailplug: { host: 'smtp.mailplug.co.kr', port: 465, imap: 'imap.mailplug.co.kr', imapPort: 993, saveSent: true },
  gmail:    { host: 'smtp.gmail.com',      port: 465, imap: 'imap.gmail.com',      imapPort: 993, saveSent: false },
};
const prov = (b) => PROVIDERS[(b && b.provider) || 'mailplug'] || PROVIDERS.mailplug;
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
  const port = Number(b.port) || prov(b).port;
  return nodemailer.createTransport({
    host: b.host || prov(b).host, port, secure: port === 465,
    auth: { user: b.username, pass: unseal(b.pass_enc) },
  });
};
// 화면에 내려 줄 모양 — 비밀번호는 «있다/없다»만
const boxPublic = (b) => ({
  event_id: b.event_id, provider: b.provider || 'mailplug', host: b.host, port: b.port,
  username: b.username, from_addr: b.from_addr, from_name: b.from_name,
  has_password: !!b.pass_enc, updated_at: b.updated_at, author_email: b.author_email,
  last_sync_at: b.last_sync_at || '', last_sync_by: b.last_sync_by || '',
  host_domains: b.host_domains || '',
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
  host: prov(b).imap, port: prov(b).imapPort, secure: true,
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
  const provider = PROVIDERS[req.body && req.body.provider] ? req.body.provider : 'mailplug';
  const P = PROVIDERS[provider];
  // 다른 서비스의 기본 서버가 남아 있으면 고른 서비스 것으로 바꾼다(서비스를 바꿀 때)
  const otherHosts = Object.values(PROVIDERS).map((x) => x.host);
  const smtpHost = (!String(host || '').trim() || (otherHosts.includes(String(host).trim()) && String(host).trim() !== P.host))
    ? P.host : String(host).trim();
  const user = String(username || '').trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(user)) return res.status(400).json({ ok: false, error: '로그인 메일 주소를 확인해주세요' });
  try {
    const prev = await boxOf(eventId);
    let passEnc = prev ? prev.pass_enc : null;
    if (String(password || '').trim()) passEnc = seal(String(password).trim());
    if (!passEnc) return res.status(400).json({ ok: false, error: '비밀번호가 필요해요' });
    const row = [eventId, provider, smtpHost, Number(port) || P.port,
      user, passEnc, String(from_addr || '').trim() || user, String(from_name || '').trim(),
      new Date().toISOString(), req.user?.email || ''];
    if (req.body && req.body.host_domains !== undefined) {
      await ensureExtra();
      await pool.query('UPDATE event_mailboxes SET host_domains = $1 WHERE event_id = $2', [domainList(req.body.host_domains).join(','), eventId]);
    }
    await pool.query(`
      INSERT INTO event_mailboxes (event_id, provider, host, port, username, pass_enc, from_addr, from_name, updated_at, author_email)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (event_id) DO UPDATE SET provider=$2, host=$3, port=$4, username=$5, pass_enc=$6,
        from_addr=$7, from_name=$8, updated_at=$9, author_email=$10`, row);
    // 처음 만드는 계정이면 위 UPDATE가 아무 줄도 못 바꿨다 — 한 번 더
    if (req.body && req.body.host_domains !== undefined) {
      await pool.query('UPDATE event_mailboxes SET host_domains = $1 WHERE event_id = $2', [domainList(req.body.host_domains).join(','), eventId]);
    }
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
  let b = null;
  try {
    b = await boxOf(req.params.eventId);
    if (!b) return res.status(404).json({ ok: false, error: '이 행사에 메일 계정이 없어요' });
    await boxTransport(b).verify();
    res.json({ ok: true, 연결: '로그인 성공 — 보낼 수 있어요' });
  } catch (e) {
    res.json({ ok: false, error: `로그인 실패: ${e.message}`,
      도움말: b && b.provider === 'gmail'
        ? 'Gmail 2단계 인증을 켜고 앱 비밀번호를 넣었는지, Gmail 설정에서 IMAP이 켜져 있는지 확인해주세요.'
        : '메일플러그 관리자 화면에서 이 계정의 IMAP/SMTP 사용이 켜져 있는지, 메일 비밀번호가 아니라 앱 비밀번호를 넣었는지 확인해주세요.' });
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
    attachments: localFiles, file_ids,
    // 컨택 DM — 차수 명단 한 줄(round_members)과 받는 사람
    round_member_id, contact_id, contact_name,
    // CRM 협의 — crm_targets 한 줄. 기록은 그 줄의 log(JSON)에 붙는다
    crm_target_id, memo } = req.body || {};

  /* 어느 행사 사람인지는 서버가 상대 기록에서 찾는다 — 화면이 보낸 event_id만
     믿으면 다른 행사 주소로 나가는 실수를 막을 수 없다 */
  let eventId = (req.body && req.body.event_id) || '';
  try {
    if (exhibitor_id) eventId = (await pool.query('SELECT event_id FROM exhibitors WHERE id = $1', [exhibitor_id])).rows[0]?.event_id || eventId;
    else if (speaker_id) eventId = (await pool.query('SELECT event_id FROM speakers WHERE id = $1', [speaker_id])).rows[0]?.event_id || eventId;
    else if (round_member_id) eventId = (await pool.query(
      `SELECT r.event_id FROM round_members m JOIN contact_rounds r ON r.id = m.round_id WHERE m.id = $1`, [round_member_id])).rows[0]?.event_id || eventId;
    else if (crm_target_id) eventId = (await pool.query('SELECT event FROM crm_targets WHERE id = $1', [String(crm_target_id)])).rows[0]?.event || eventId;
  } catch (e) { /* 행사를 못 찾으면 아래에서 막힌다 */ }
  /* 진행 완료된 행사(그 파트)는 열람만 — 화면 잠금을 피해 들어와도 여기서 막는다.
     컨택 DM은 전시·컨퍼런스 어느 파트도 아니라 묻지 않는다(행사 전 모객이다) */
  const part = exhibitor_id ? 'exh' : speaker_id ? 'conf' : null;
  if (eventId && part && await partDone(eventId, part)) {
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
    if (sender.box && prov(sender.box).saveSent) {
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
    /* 컨택 DM — 차수 기록(contact_attempts)에 «DM 보냄» 한 줄. 본문은 남기지 않는다
       (제목과 첨부 이름만) — 기록은 «언제 누구에게 무엇을»이면 충분하다 */
    if (!target && round_member_id) {
      try {
        const m = (await pool.query('SELECT round_id, org_id FROM round_members WHERE id = $1', [round_member_id])).rows[0];
        if (m) {
          logId = `CA-${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          await pool.query(
            `INSERT INTO contact_attempts (id, round_id, member_id, org_id, contact_id, contact_name, phone,
               channel, at, by_email, by_name, reaction, note)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'DM',$8,$9,$10,'sent',$11)`,
            [logId, m.round_id, round_member_id, m.org_id, contact_id ? String(contact_id) : '', contact_name || '',
              toList.join(', '), kstStamp(Date.now()), req.user?.email || '', req.user?.name || '',
              String(subject || '').trim() + (attachments.length ? ` [첨부] ${attachments.map((a) => a.filename).join(', ')}` : '')]);
          logged = true;
        }
      } catch (e) { logError = e.message; logId = null; }
    }
    /* CRM 협의 — 타겟의 컨택 이력(log JSON) 맨 앞에 «메일 보냄» 한 줄. 제목·받는 사람·첨부 이름·
       본문(«무슨 메일을 보냈나»를 다시 보려고, 길면 앞부분만)과 사람이 적은 짧은 메모를 둔다.
       한 문장으로 붙여서 같은 때 화면이 저장한 기록을 덮지 않는다 */
    let crmEntry = null;
    if (!target && !round_member_id && crm_target_id) {
      const at = kstStamp(Date.now());
      crmEntry = { type: '메일 보냄', text: String(subject || '').trim() || '(제목 없음)', to: toList.join(', '),
        attach: attachments.map((a) => a.filename).join(', '), memo: String(memo || '').trim(),
        body: String(text || '').slice(0, 6000), cc: list(cc).join(', '),
        date: at.slice(0, 10), at, by: req.user?.name || req.user?.email || '', color: '#6D28D9' };
      try {
        const u = await pool.query(
          `UPDATE crm_targets SET "lastActivity" = $3,
             log = (jsonb_build_array($2::jsonb) || CASE WHEN left(btrim(COALESCE(log, '')), 1) = '[' THEN log::jsonb ELSE '[]'::jsonb END)::text
           WHERE id = $1`, [String(crm_target_id), JSON.stringify(crmEntry), crmEntry.date]);
        logged = u.rowCount > 0;
        if (!logged) { logError = 'CRM 타겟을 찾지 못했어요'; crmEntry = null; }
      } catch (e) { logError = e.message; crmEntry = null; }
    }
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
    res.json({ ok: true, messageId: info.messageId, accepted: info.accepted, via: sender.via, logged, logError, logId, crmEntry, sentSaved, sentError });
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
/* 이미지 자리 — 글자로 바꾸면 이미지가 사라져 «아래 사진 참고»를 놓친다.
   자리에 [🖼 이미지: 이름]을 남긴다(1×1 추적 픽셀은 뺀다). 이미지는 «원문 보기»로 본다 */
function markImages(html, mail) {
  return String(html || '').replace(/<img\b[^>]*>/gi, (tag) => {
    if (/\b(width|height)\s*=\s*["']?1["'\s>]/i.test(tag)) return '';
    const attr = (k) => ((tag.match(new RegExp(k + '\\s*=\\s*["\']([^"\']*)["\']', 'i')) || [])[1] || '');
    const src = attr('src');
    let name = attr('alt');
    if (!name && /^cid:/i.test(src)) {
      const a = (mail.attachments || []).find((x) => String(x.cid || '').replace(/[<>]/g, '') === src.slice(4));
      name = (a && a.filename) || '';
    }
    if (!name) name = (src.split('/').pop() || '').split('?')[0];
    if (/^data:/i.test(name)) name = '';
    return ` [🖼 이미지${name ? ': ' + name.slice(0, 60) : ''}] `;
  });
}
const mailText = (mail) => {
  // 본문에 이미지가 있으면 HTML 쪽을 글자로 바꾼다 — 글자 본문에는 이미지 자리가 없다
  const direct = (mail.html && /<img\b/i.test(mail.html) ? htmlToText(markImages(mail.html, mail), H2T).trim() : '')
    || String(mail.text || '').trim()
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
/* 자동 답장·반송 — 헤더(Auto-Submitted, X-Autoreply 등)나 제목으로 알아본다 */
const AUTO_SUBJ = /(^|\W)(automatic reply|auto[- ]?reply|autoreply|out of (the )?office|자동 ?회신|자동 ?응답|부재중|undeliverable|delivery status notification|mail delivery failed)/i;
function isAutoReply(mail) {
  const h = mail.headers || new Map();
  const as = String(h.get('auto-submitted') || '').toLowerCase();
  if (as && as !== 'no') return true;
  if (h.get('x-autoreply') || h.get('x-autorespond') || h.get('x-auto-response-suppress') === 'All') return true;
  if (/^(auto_reply|bulk|junk)$/i.test(String(h.get('precedence') || ''))) return true;
  return AUTO_SUBJ.test(String(mail.subject || ''));
}
const prevDay = (d) => new Date(new Date(`${d}T00:00:00Z`).getTime() - 864e5).toISOString().slice(0, 10);

const syncSentHandler = async (req, res) => {
  const apply = !!(req.body && req.body.apply);
  await ensureExtra().catch(() => {});
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
        const n = (client.mailbox && client.mailbox.exists) || 0;
        const since = Date.now() - 120 * 864e5;
        /* 1) 머리만 훑는다 — 받는 사람·제목·날짜. 본문은 새로 남길 메일만 2)에서 받는다.
           300통 본문을 다 받아 읽으면 Gmail처럼 큰 메일함은 60초(Vercel)를 넘겼다.
           날짜 검색(SEARCH SINCE)은 메일플러그가 거절해 번호로 마지막 300통을 본다 */
        stage = `«${sent.path}» 메일 머리 읽기`;
        const heads = [];
        for await (const m of (n ? client.fetch(`${Math.max(1, n - 299)}:*`, { envelope: true, internalDate: true, uid: true }) : [])) {
          if (m.internalDate && new Date(m.internalDate).getTime() < since) continue;
          total++;
          const env = m.envelope || {};
          const to = (env.to || []).map((a) => a.address).filter(Boolean);
          const cc = (env.cc || []).map((a) => a.address).filter(Boolean);
          const ids = [...new Set([...to, ...cc].map((a) => byMail.get(norm(a))).filter(Boolean))];
          const exIds = [...new Set([...to, ...cc].map((a) => exByMail.get(norm(a))).filter(Boolean))];
          if (!ids.length && !exIds.length) continue;
          const dt = env.date || m.internalDate || Date.now();
          const date = kstDate(dt), at = kstStamp(dt), subject = String(env.subject || '').trim();
          const dupIn = (set, id) => set.has(`${id}|${date}|${norm(subject)}`) || set.has(`${id}|${prevDay(date)}|${norm(subject)}`);
          heads.push({ uid: String(m.uid || ''), to, cc, ids, exIds, date, at, subject,
            dupEx: new Map(exIds.map((id) => [id, dupIn(exSeen, id)])), dupSp: new Map(ids.map((id) => [id, dupIn(seen, id)])) });
          exIds.forEach((id) => exSeen.add(`${id}|${date}|${norm(subject)}`));
          ids.forEach((id) => seen.add(`${id}|${date}|${norm(subject)}`));
        }
        /* 2) 새로 남길 메일만 본문을 받는다 */
        let needUids = heads.filter((h) => [...h.dupEx.values(), ...h.dupSp.values()].some((d) => !d)).map((h) => h.uid);
        // 한 번에 60통까지(최신부터) — 나머지는 다음 차례에. 본문 없이 남기지 않게 이번 목록에서도 뺀다
        if (needUids.length > 60) {
          const keep = new Set(needUids.slice(-60));
          for (let i = heads.length - 1; i >= 0; i--) {
            const h = heads[i];
            if ([...h.dupEx.values(), ...h.dupSp.values()].some((d) => !d) && !keep.has(h.uid)) heads.splice(i, 1);
          }
          needUids = [...keep];
        }
        const bodyOf = new Map();
        stage = `«${sent.path}» 메일 본문 읽기`;
        if (needUids.length) {
          for await (const m of client.fetch(needUids.join(','), { source: true }, { uid: true })) {
            const mail = await simpleParser(m.source);
            // 본문으로 쓴 조각은 첨부 목록에서 뺀다
            const asBody = new Set(String(mail.text || '').trim() || mail.html ? [] : bodyParts(mail));
            const files = (mail.attachments || []).filter((a) => !asBody.has(a)).map((a) => a.filename).filter(Boolean);
            bodyOf.set(String(m.uid), mailText(mail) + (files.length ? `\n\n[첨부] ${files.join(', ')}` : ''));
          }
        }
        for (const h of heads) {
          const body = bodyOf.get(h.uid) || '';
          for (const id of h.exIds) {
            const cls = classifyExhSent(h.subject);
            found.push({
              t: 'ex', exhibitor_id: id, name: exName.get(id) || id, date: h.date, at: h.at, subject: h.subject, box: sentPath, uid: h.uid,
              to: h.to.join(', '), cc: h.cc.join(', '), kind: cls.kind, category: cls.category, dup: h.dupEx.get(id), body,
            });
          }
          for (const id of h.ids) {
            const s0 = spById.get(id);
            const cls = classifySent(h.subject);
            const invite = cls.kind === 'invite';
            found.push({
              speaker_id: id, name: s0.name_snapshot || s0.name_en || id, date: h.date, at: h.at, subject: h.subject, box: sentPath, uid: h.uid,
              to: h.to.join(', '), cc: h.cc.join(', '), invite, kind: cls.kind, category: cls.category, dup: h.dupSp.get(id),
              stamp: invite && !s0.guide_sent_at, body,
            });
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
      /* 이미 가져온 기록에 원문 위치(메일함·번호)를 채운다 — «원문 보기»가 쓴다 */
      for (const f of found.filter((x) => x.dup && x.uid)) {
        const ex0 = f.t === 'ex';
        await pool.query(`UPDATE ${ex0 ? 'exhibitor_logs' : 'speaker_logs'} SET mail_box = $1, mail_uid = $2
           WHERE ${ex0 ? 'exhibitor_id' : 'speaker_id'} = $3 AND left(ts, 10) IN ($4, $5) AND lower(btrim(subject)) = $6
             AND direction = 'out' AND COALESCE(mail_uid, '') = ''`,
        [f.box, f.uid, ex0 ? f.exhibitor_id : f.speaker_id, f.date, prevDay(f.date), norm(f.subject)]);
      }
      for (const f of found.filter((x) => !x.dup && x.t === 'ex')) {
        await pool.query(`
          INSERT INTO exhibitor_logs (id, exhibitor_id, kind, ts, direction, channel, counterpart, category,
            subject, body, answered_at, answer, status, author_email, author_name, mail_box, mail_uid)
          VALUES ($1,$2,$3,$4,'out','이메일',$5,$6,$7,$8,'','','done',$9,$10,$11,$12)`,
        [`XL-${Date.now()}-${Math.floor(Math.random() * 100000)}`, f.exhibitor_id, f.kind, f.at,
          [f.to, f.cc ? `(cc) ${f.cc}` : ''].filter(Boolean).join(' '), f.category,
          f.subject, f.body, req.user?.email || '', `${req.user?.name || req.user?.email || ''} (보낸메일함에서 가져옴)`, f.box, f.uid]);
        added++;
      }
      for (const f of found.filter((x) => !x.dup && x.t !== 'ex')) {
        await pool.query(`
          INSERT INTO speaker_logs (id, speaker_id, kind, ts, direction, channel, counterpart, category,
            subject, body, answered_at, answer, status, author_email, author_name, mail_box, mail_uid)
          VALUES ($1,$2,$3,$4,'out','이메일',$5,$6,$7,$8,'','','done',$9,$10,$11,$12)`,
        [`SL-${Date.now()}-${Math.floor(Math.random() * 100000)}`, f.speaker_id, f.kind, f.at,
          [f.to, f.cc ? `(cc) ${f.cc}` : ''].filter(Boolean).join(' '), f.category,
          f.subject, f.body, req.user?.email || '', `${req.user?.name || req.user?.email || ''} (보낸메일함에서 가져옴)`, f.box, f.uid]);
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
  await ensureExtra().catch(() => {});
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
    // 행사 메일 설정의 «늘 무시» 도메인
    const ignored = new Set(String(b.ignore_domains || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
    const hostDomains = domainList(b.host_domains);
    const unknown = [];
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
        const n = (client.mailbox && client.mailbox.exists) || 0;
        const since = Date.now() - 120 * 864e5;
        // 주인 없는 메일로 이미 본 것(걸러진 것 포함)은 다시 받지 않는다
        const knownUn = new Set((await pool.query(
          `SELECT mail_uid FROM mail_unassigned WHERE event_id = $1 AND mail_box = 'INBOX'`, [eventId])).rows.map((r) => String(r.mail_uid)));
        /* 1) 머리만 훑는다(보낸 사람·제목·날짜). 본문은 새로 남길 메일만 2)에서 받는다 —
           300통 본문을 다 받아 읽으면 큰 메일함은 60초를 넘겼다 */
        stage = '받은메일함 머리 읽기';
        const heads = [];
        for await (const m of (n ? client.fetch(`${Math.max(1, n - 299)}:*`, { envelope: true, internalDate: true, uid: true }) : [])) {
          if (m.internalDate && new Date(m.internalDate).getTime() < since) continue;
          total++;
          const env = m.envelope || {};
          const f0 = (env.from || [])[0] || {};
          const from = f0.address || '';
          if (!from || self.has(norm(from))) continue;
          if (ignored.has(domainOf(from))) continue;
          // 부재중·자동 답장·반송은 제목만 보고도 거른다 — 사람 메일이 아니다
          if (AUTO_SUBJ.test(String(env.subject || ''))) continue;
          const who = byMail.get(norm(from));
          const dt = env.date || m.internalDate || Date.now();
          const date = kstDate(dt), subject = String(env.subject || '').trim(), uid = String(m.uid || '');
          const base = { uid, from, fromName: f0.name || '', date, at: kstStamp(dt), subject };
          if (who) {
            const key = (d) => `${who.t}|${who.id}|${d}|${norm(subject)}`;
            const dup = seen.has(key(date)) || seen.has(key(prevDay(date)));
            seen.add(key(date));
            heads.push({ ...base, who, dup });
          } else if (!knownUn.has(uid)) {
            heads.push({ ...base, who: null });
          }
        }
        /* 2) 새로 남길 메일만 본문 */
        /* 한 번에 본문을 받는 수를 묶는다 — 처음 도는 큰 메일함은 모르는 메일이 수백 통이라 60초를 넘겼고,
           넘기면 저장도 못 해 매번 처음부터였다. 아는 사람 메일 먼저, 모르는 메일은 최신부터 40통씩 —
           돌 때마다 쌓여 몇 번 안에 따라잡는다 */
        const knownNew = heads.filter((h) => h.who && !h.dup);
        const strangers = heads.filter((h) => !h.who).slice(-40);
        const keep = new Set([...knownNew.slice(-60), ...strangers].map((h) => h.uid));
        for (let i = heads.length - 1; i >= 0; i--) if ((!heads[i].who || !heads[i].dup) && !keep.has(heads[i].uid)) heads.splice(i, 1);
        const need = [...keep];
        const parsed = new Map();
        stage = '받은메일함 본문 읽기';
        if (need.length) {
          for await (const m of client.fetch(need.join(','), { source: true }, { uid: true })) parsed.set(String(m.uid), await simpleParser(m.source));
        }
        const bodyText = (mail) => {
          const asBody = new Set(String(mail.text || '').trim() || mail.html ? [] : bodyParts(mail));
          const files = (mail.attachments || []).filter((a) => !asBody.has(a)).map((a) => a.filename).filter(Boolean);
          return { text: mailText(mail) + (files.length ? `\n\n[첨부] ${files.join(', ')}` : ''), files: files.length };
        };
        for (const h of heads) {
          const mail = parsed.get(h.uid);
          if (mail && isAutoReply(mail)) continue;
          if (!h.who && mail && isOurs(h.from) && !isSpam(mail)) {
            /* 우리 직원이 전달한 메일 — 원래 메일의 보낸 사람·받는 사람·참조로 주인을 찾는다.
               분류는 «받은 메일» 그대로, 전달한 사람은 작성자 칸에만. 시각은 원래 보낸 시각 */
            const fw = parseForward(mailText(mail));
            const hit = forwardCandidates(fw, hostDomains).map((a) => ({ a, who: byMail.get(norm(a.addr)) })).find((x) => x.who);
            if (hit) {
              const who = hit.who;
              const at = fw.sent || h.at, date = at.slice(0, 10);
              const subject = fw.subject || h.subject.replace(/^\s*((fw|fwd|전달)\s*[:\]]\s*|\[(fw|fwd)\]\s*)+/i, '').trim();
              const key = (d) => `${who.t}|${who.id}|${d}|${norm(subject)}`;
              const dup = seen.has(key(date)) || seen.has(key(prevDay(date)));
              seen.add(key(date));
              const bt = bodyText(mail);
              found.push({
                t: who.t, id: who.id, name: who.t === 'sp' ? spName.get(who.id) : exName.get(who.id), uid: h.uid,
                category: '받은 메일', date, at, subject, dup, files: bt.files, body: bt.text,
                from: [fmtAddr(fw.from), [...fw.to, ...fw.cc].length ? `→ ${[...fw.to, ...fw.cc].map((x) => x.addr).join(', ')}` : ''].filter(Boolean).join(' '),
                fwdBy: h.fromName || h.from,
                // 원래 보낸 사람이 그 연사 본인일 때만 «회신 받음»으로 센다 — 주최사가 연사에게 보낸 메일은 회신이 아니다
                fromOwner: hit.a === fw.from,
              });
              continue;
            }
          }
          if (!h.who) {
            /* 모르는 사람 — 스팸·대량 발송은 «걸러짐»으로만 기억하고(다음에 다시 안 받게),
               나머지는 «주인 없는 메일»로 모은다. 사람이 연결하기 전까지 어디에도 붙지 않는다 */
            if (!mail) continue;
            const filtered = isSpam(mail) || isBulk(mail);
            const bt = filtered ? { text: '' } : bodyText(mail);
            unknown.push({ uid: h.uid, at: h.at, from: h.from, fromName: h.fromName, subject: h.subject,
              body: bt.text, warnings: filtered ? [] : mailWarnings(mail), status: filtered ? 'filtered' : 'new' });
            continue;
          }
          const spam = mail ? isSpam(mail) : /^\s*\[(spam|스팸)\]/i.test(h.subject);
          const warns = mail ? mailWarnings(mail) : [];
          const bt = mail ? bodyText(mail) : { text: '', files: 0 };
          found.push({
            t: h.who.t, id: h.who.id, name: h.who.t === 'sp' ? spName.get(h.who.id) : exName.get(h.who.id), uid: h.uid,
            // 아는 사람이어도 스팸 표시·경고가 있으면 분류에 남긴다(버리지 않는다 — 실제 회신이 잘못 걸리기도 한다)
            category: spam ? '받은 메일 · ⚠ 스팸 의심' : warns.length ? '받은 메일 · ⚠ 확인' : '받은 메일',
            date: h.date, at: h.at, subject: h.subject, from: h.fromName ? `${h.fromName} <${h.from}>` : h.from, dup: h.dup,
            files: bt.files, body: bt.text,
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
      if (f.fwdBy && !f.fromOwner) return;
      if (f.date < String(r.guide_sent_at).slice(0, 10)) return;
      if (!firstReply[f.id] || f.date < firstReply[f.id]) firstReply[f.id] = f.date;
    });
    const replyNames = Object.keys(firstReply).map((id) => spName.get(id));

    let added = 0, replied = 0, unassigned = 0;
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
            channel, counterpart, category, subject, body, answered_at, answer, status, author_email, author_name, mail_box, mail_uid)
          VALUES ($1,$2,'note',$3,'in','이메일',$4,$5,$6,$7,'','','open',$8,$9,'INBOX',$10)`,
        [`${sp0 ? 'SL' : 'XL'}-${Date.now()}-${Math.floor(Math.random() * 100000)}`, f.id, f.at, f.from, f.category,
          f.subject, f.body, req.user?.email || '',
          f.fwdBy ? `${f.fwdBy} 전달 (받은메일함에서 가져옴)` : `${req.user?.name || req.user?.email || ''} (받은메일함에서 가져옴)`, f.uid]);
        added++;
      }
      // 이미 가져온 받은 기록에 원문 위치를 채운다
      for (const f of found.filter((x) => x.dup && x.uid)) {
        const sp0 = f.t === 'sp';
        await pool.query(`UPDATE ${sp0 ? 'speaker_logs' : 'exhibitor_logs'} SET mail_box = 'INBOX', mail_uid = $1
           WHERE ${sp0 ? 'speaker_id' : 'exhibitor_id'} = $2 AND left(ts, 10) IN ($3, $4) AND lower(btrim(subject)) = $5
             AND direction = 'in' AND COALESCE(mail_uid, '') = ''`, [f.uid, f.id, f.date, prevDay(f.date), norm(f.subject)]);
      }
      // 주인 없는 메일 — 같은 메일(메일함·번호)은 한 번만
      for (const u of unknown) {
        const r = await pool.query(`INSERT INTO mail_unassigned (id, event_id, mail_box, mail_uid, ts, from_addr, from_name, subject, body,
            warnings, status, created_at) VALUES ($1,$2,'INBOX',$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (event_id, mail_box, mail_uid) DO NOTHING`,
        [`MU-${Date.now()}-${Math.floor(Math.random() * 100000)}`, eventId, u.uid, u.at, u.from, u.fromName, u.subject, u.body,
          JSON.stringify(u.warnings), u.status || 'new', kstStamp(Date.now())]);
        if (u.status !== 'filtered') unassigned += r.rowCount || 0;
      }
    }
    if (apply) await markSynced(eventId, req.user?.name || req.user?.email || '');
    res.json({
      ok: true, applied: apply, scanned: total, added, replied, replyNames, unassigned, unknown: unknown.filter((u) => u.status !== 'filtered').length,
      items: found.map(({ body, ...r }) => r),
      skipped: [confDone ? '컨퍼런스(진행 완료)' : '', exhDone ? '전시(진행 완료)' : ''].filter(Boolean),
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
};


/* ══════════════════════════════════════════════════════════════
   원문 보기 · 주인 없는 메일
══════════════════════════════════════════════════════════════ */

/* 기록이 메일함의 어느 메일인지 — 원문을 다시 가져오려고 남긴다(mail_box·mail_uid).
   주인 없는 메일은 따로 모은다. 연결하기 전까지 어느 사람 기록에도 붙지 않는다. */
let extraReady = null;
const ensureExtra = () => extraReady || (extraReady = (async () => {
  for (const t of ['speaker_logs', 'exhibitor_logs']) {
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS mail_box TEXT`);
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS mail_uid TEXT`);
  }
  await pool.query('ALTER TABLE event_mailboxes ADD COLUMN IF NOT EXISTS ignore_domains TEXT');
  // 주최사 메일 도메인 — 주최사 주소는 연락처로 넣지 않고, 전달 메일의 주인을 찾을 때 뺀다
  await pool.query('ALTER TABLE event_mailboxes ADD COLUMN IF NOT EXISTS host_domains TEXT');
  await pool.query(`CREATE TABLE IF NOT EXISTS mail_unassigned (
    id TEXT PRIMARY KEY, event_id TEXT, mail_box TEXT, mail_uid TEXT, ts TEXT,
    from_addr TEXT, from_name TEXT, subject TEXT, body TEXT, warnings TEXT,
    status TEXT, linked_t TEXT, linked_id TEXT, created_at TEXT, handled_by TEXT)`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS mail_unassigned_uniq ON mail_unassigned (event_id, mail_box, mail_uid)');
})().catch((e) => { extraReady = null; throw e; }));

/* 스팸 — 메일 서버가 붙인 표시. 받은편지함에 남겨 둔 «의심» 메일이다 */
function isSpam(mail) {
  const h = mail.headers || new Map();
  if (/^\s*\[(spam|스팸)\]/i.test(String(mail.subject || ''))) return true;
  if (/^yes/i.test(String(h.get('x-spam-flag') || '')) || /^yes/i.test(String(h.get('x-spam-status') || ''))) return true;
  return false;
}
/* 대량 발송(뉴스레터·광고) — 사람이 한 사람에게 보낸 메일이 아니다 */
function isBulk(mail) {
  const h = mail.headers || new Map();
  return !!(h.get('list-unsubscribe') || h.get('list-id')) || /^(bulk|list)$/i.test(String(h.get('precedence') || ''));
}
const domainOf = (a) => String(a || '').toLowerCase().split('@')[1] || '';
const FREE_MAIL = new Set(['gmail.com', 'naver.com', 'daum.net', 'hanmail.net', 'kakao.com', 'nate.com', 'hotmail.com',
  'outlook.com', 'yahoo.com', 'icloud.com', 'live.com', 'me.com', 'qq.com', '163.com']);
/* 경고 — 사람이 속지 않게. 자동으로 막지는 않고 보이게만 한다 */
function mailWarnings(mail) {
  const w = [];
  const from = (mail.from && mail.from.value[0]) || {};
  const rt = (mail.replyTo && mail.replyTo.value[0] && mail.replyTo.value[0].address) || '';
  if (rt && domainOf(rt) !== domainOf(from.address)) w.push(`회신 주소가 보낸 주소와 달라요(${rt})`);
  const risky = (mail.attachments || []).map((a) => a.filename || '')
    .filter((n) => /\.(exe|scr|js|jse|vbs|bat|cmd|ps1|msi|jar|iso|img|zip|rar|7z|html?|lnk|hta)$/i.test(n));
  if (risky.length) w.push(`위험할 수 있는 첨부: ${risky.join(', ')}`);
  const text = `${mail.subject || ''}\n${String(mail.text || '').slice(0, 4000)}`;
  if (/계좌\s*(변경|바뀌)|입금\s*계좌|bank (details|account).{0,20}(change|update|new)|new (bank|account) details|wire transfer|긴급\s*송금/i.test(text))
    w.push('결제 정보 변경 요청 — 전화로 꼭 확인하세요');
  if (from.name && from.address && /@/.test(from.name) && domainOf(from.name.match(/[^\s<>"]+@[^\s<>"]+/)?.[0]) !== domainOf(from.address))
    w.push('보낸 사람 이름에 다른 주소가 적혀 있어요');
  return w;
}

/* 원문을 안전한 HTML로 — 스크립트·폼·외부 불러오기를 걷어 내고, 본문에 붙은 이미지만
   data:로 넣는다. 외부 이미지는 기본으로 막는다(열람 추적). 화면은 이 결과를 스크립트가
   돌지 않는 iframe(sandbox, CSP)에 띄운다 */
function safeOriginalHtml(mail, { remote = false, noLinks = false } = {}) {
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let h = mail.html || (bodyParts(mail).find((a) => /html/i.test(a.contentType))?.content.toString('utf8'))
    || `<pre style="white-space:pre-wrap;font-family:inherit">${esc(mail.text || '')}</pre>`;
  h = h.replace(/<(script|iframe|frame|object|embed|applet|form|meta|link|base|svg)\b[\s\S]*?(<\/\1\s*>|\/?>)/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|action)\s*=\s*(["'])\s*(javascript|vbscript|data:text)[^"']*\2/gi, '$1=""');
  const cid = new Map((mail.attachments || [])
    .filter((a) => a.cid && /^image\//i.test(a.contentType || '') && a.size < 3 * 1024 * 1024)
    .map((a) => [String(a.cid).replace(/[<>]/g, ''), `data:${a.contentType};base64,${a.content.toString('base64')}`]));
  h = h.replace(/src\s*=\s*(["'])cid:([^"']+)\1/gi, (m, q, c) => `src="${cid.get(c) || ''}"`);
  if (!remote) {
    h = h.replace(/(<img\b[^>]*?)\ssrc\s*=\s*(["'])(https?:|\/\/)[^"']*\2/gi, '$1 src="" data-blocked="1"')
      .replace(/url\(\s*(["']?)(https?:|\/\/)[^)]*\)/gi, 'url()');
  }
  if (noLinks) h = h.replace(/\shref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return h;
}

/* 원문 보기 — 기록에 남긴 메일함·번호로 그때 가져온다(저장하지 않는다) */
router.get('/original/:t/:id', async (req, res) => {
  const t = req.params.t === 'ex' ? 'ex' : req.params.t === 'un' ? 'un' : 'sp';
  try {
    await ensureExtra();
    let row;
    if (t === 'un') {
      // 주인 없는 메일 — 연결하기 전에 원문을 보고 판단한다
      row = (await pool.query(`SELECT mail_box, mail_uid, '' category, event_id FROM mail_unassigned WHERE id = $1`, [req.params.id])).rows[0];
    } else {
      const tbl = t === 'sp' ? 'speaker_logs' : 'exhibitor_logs';
      const own = t === 'sp' ? 'speakers' : 'exhibitors';
      const col = t === 'sp' ? 'speaker_id' : 'exhibitor_id';
      const r = await pool.query(`SELECT l.mail_box, l.mail_uid, l.category, o.event_id FROM ${tbl} l
        JOIN ${own} o ON o.id = l.${col} WHERE l.id = $1`, [req.params.id]);
      row = r.rows[0];
    }
    if (!row || !row.mail_uid) return res.status(404).json({ ok: false, error: '원문 위치가 없어요 — «지금 가져오기»를 한 번 누르면 채워져요' });
    const b = await boxOf(row.event_id);
    if (!b) return res.status(404).json({ ok: false, error: '이 행사에 공용 메일이 없어요' });
    const client = imapClient(b);
    await client.connect();
    let mail;
    try {
      const lock = await client.getMailboxLock(row.mail_box || 'INBOX');
      try {
        const m = await client.fetchOne(String(row.mail_uid), { source: true }, { uid: true });
        if (!m || !m.source) return res.status(404).json({ ok: false, error: '메일함에서 이 메일을 찾지 못했어요(지워졌을 수 있어요)' });
        mail = await simpleParser(m.source);
      } finally { lock.release(); }
    } finally { await client.logout().catch(() => {}); }
    const spam = isSpam(mail) || /스팸/.test(row.category || '');
    res.json({
      ok: true, subject: mail.subject || '', date: mail.date ? kstStamp(mail.date) : '',
      from: mail.from ? mail.from.text : '', to: mail.to ? [].concat(mail.to).map((x) => x.text).join(', ') : '',
      html: safeOriginalHtml(mail, { remote: req.query.remote === '1', noLinks: spam }),
      blocked: /data-blocked="1"/.test(safeOriginalHtml(mail, { remote: false })) && req.query.remote !== '1',
      spam, warnings: mailWarnings(mail),
      attachments: (mail.attachments || []).filter((a) => !a.cid || !/^image\//i.test(a.contentType || ''))
        .map((a) => ({ filename: a.filename || '(이름 없음)', size: a.size || 0 })),
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ── 주인 없는 메일 ── */
router.get('/unassigned/:eventId', async (req, res) => {
  const eventId = String(req.params.eventId);
  try {
    await ensureExtra();
    const rows = (await pool.query(`SELECT * FROM mail_unassigned WHERE event_id = $1 AND status = 'new' ORDER BY ts DESC`, [eventId])).rows;
    /* 추천 — 이름·주소·도메인·답장 제목·본문의 소속을 견줘 점수를 매긴다(mail-suggest.js). 바깥으로는 보내지 않는다 */
    const owners = new Map();
    const own = (t, id, label) => {
      const k = `${t}:${id}`;
      if (!owners.has(k)) owners.set(k, { t, id, label, names: [], orgs: [], emails: [], sentSubjects: [] });
      return owners.get(k);
    };
    const push = (arr, ...v) => v.forEach((x) => { x = String(x || '').trim(); if (x && !arr.includes(x)) arr.push(x); });
    (await pool.query(`SELECT s.id, COALESCE(NULLIF(s.name_snapshot,''), s.name_en) nm, s.name_snapshot, s.name_en, s.org_ko, s.org_en,
        c.email1, c.email2 FROM speakers s LEFT JOIN contacts c ON c.id = s.contact_id WHERE s.event_id = $1`, [eventId])).rows
      .forEach((r) => { const o = own('sp', r.id, r.nm); push(o.names, r.name_snapshot, r.name_en); push(o.orgs, r.org_ko, r.org_en); push(o.emails, r.email1, r.email2); });
    (await pool.query(`SELECT sc.speaker_id, sc.name, sc.email FROM speaker_contacts sc JOIN speakers s ON s.id = sc.speaker_id
       WHERE s.event_id = $1`, [eventId])).rows
      .forEach((r) => { const o = owners.get(`sp:${r.speaker_id}`); if (o) { push(o.names, r.name); push(o.emails, r.email); } });
    (await pool.query(`SELECT x.id, x.company_name, xc.name, xc.email, c.email1, c.email2 FROM exhibitors x
       LEFT JOIN exhibitor_contacts xc ON xc.exhibitor_id = x.id LEFT JOIN contacts c ON c.id = xc.contact_id
      WHERE x.event_id = $1`, [eventId])).rows
      .forEach((r) => { const o = own('ex', r.id, r.company_name); push(o.names, r.name); push(o.orgs, r.company_name); push(o.emails, r.email, r.email1, r.email2); });
    (await pool.query(`SELECT l.speaker_id oid, l.subject FROM speaker_logs l JOIN speakers s ON s.id = l.speaker_id
       WHERE s.event_id = $1 AND l.direction = 'out' AND l.subject <> ''`, [eventId])).rows
      .forEach((r) => { const o = owners.get(`sp:${r.oid}`); if (o) push(o.sentSubjects, r.subject); });
    (await pool.query(`SELECT l.exhibitor_id oid, l.subject FROM exhibitor_logs l JOIN exhibitors x ON x.id = l.exhibitor_id
       WHERE x.event_id = $1 AND l.direction = 'out' AND l.subject <> ''`, [eventId])).rows
      .forEach((r) => { const o = owners.get(`ex:${r.oid}`); if (o) push(o.sentSubjects, r.subject); });
    const linkedBefore = new Map();
    (await pool.query(`SELECT lower(from_addr) a, linked_t, linked_id FROM mail_unassigned
       WHERE event_id = $1 AND status = 'linked' ORDER BY ts`, [eventId])).rows
      .forEach((r) => linkedBefore.set(r.a, { t: r.linked_t, id: r.linked_id }));
    const list = [...owners.values()];
    const hostDomains = domainList((await boxOf(eventId).catch(() => null))?.host_domains);
    const out = rows.map((r) => {
      const f = forwardOf(r);
      const fw = f && f.fw;
      /* 전달 메일이면 원래 보낸 사람으로 추천을 견주고, 원래 받는 사람·참조에 아는 주소가 있으면 그 사람을 맨 앞에 */
      let sug = suggestOwners(fw ? { ...r, from_addr: fw.from.addr, from_name: fw.from.name, subject: fw.subject || r.subject } : r, list, linkedBefore);
      if (fw) {
        const exact = forwardCandidates(fw, hostDomains).map((a) => list.find((o) => o.emails.some((e) => norm(e) === a.addr)))
          .filter(Boolean).filter((o, i, arr) => arr.indexOf(o) === i);
        sug = [...exact.map((o) => ({ t: o.t, id: o.id, name: o.label, score: 99, why: '원래 메일의 주소' })),
          ...sug.filter((s) => !exact.some((o) => o.t === s.t && o.id === s.id))].slice(0, 3);
      }
      const addr = fw ? fw.from.addr : r.from_addr;
      return { ...r, warnings: r.warnings ? JSON.parse(r.warnings) : [], suggestions: sug,
        fwd: f ? { by: f.by, from: fw ? fmtAddr(fw.from) : '', to: fw ? [...fw.to, ...fw.cc].map((x) => x.addr).join(', ') : '', sent: fw ? fw.sent : '',
          addrs: fw ? [fw.from, ...fw.to, ...fw.cc].map((x) => x.addr) : [] } : null,
        // 연락처로 넣을 주소 — 우리 직원·주최사 주소면 넣지 않는다
        contact_addr: !addr || isOurs(addr) || hostDomains.includes(domOf(addr)) ? '' : addr };
    });
    res.json({ ok: true, items: out });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/unassigned/:id/link', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 바꿀 수 없어요' });
  const { t, ownerId, addContact } = req.body || {};
  const sp = t === 'sp';
  try {
    await ensureExtra();
    const u = (await pool.query(`SELECT * FROM mail_unassigned WHERE id = $1`, [req.params.id])).rows[0];
    if (!u || u.status !== 'new') return res.status(404).json({ ok: false, error: '이미 처리한 메일이에요' });
    const own = (await pool.query(`SELECT id, event_id FROM ${sp ? 'speakers' : 'exhibitors'} WHERE id = $1`, [ownerId])).rows[0];
    if (!own || own.event_id !== u.event_id) return res.status(400).json({ ok: false, error: '이 행사의 연사·참가사를 골라주세요' });
    if (await partDone(u.event_id, sp ? 'conf' : 'exh')) return res.status(423).json({ ok: false, error: '진행 완료된 행사예요' });
    const logId = `${sp ? 'SL' : 'XL'}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const warn = u.warnings ? JSON.parse(u.warnings) : [];
    const hostDomains = domainList((await boxOf(u.event_id).catch(() => null))?.host_domains);
    const f = forwardOf(u), fw = f && f.fw;
    const counterpart = fw ? [fmtAddr(fw.from), [...fw.to, ...fw.cc].length ? `→ ${[...fw.to, ...fw.cc].map((x) => x.addr).join(', ')}` : ''].filter(Boolean).join(' ')
      : (u.from_name ? `${u.from_name} <${u.from_addr}>` : u.from_addr);
    const contactAddr = fw ? fw.from.addr : u.from_addr;
    const contactName = fw ? fw.from.name : u.from_name;
    const canAdd = contactAddr && !isOurs(contactAddr) && !hostDomains.includes(domOf(contactAddr));
    await pool.query(`
      INSERT INTO ${sp ? 'speaker_logs' : 'exhibitor_logs'} (id, ${sp ? 'speaker_id' : 'exhibitor_id'}, kind, ts, direction,
        channel, counterpart, category, subject, body, answered_at, answer, status, author_email, author_name, mail_box, mail_uid)
      VALUES ($1,$2,'note',$3,'in','이메일',$4,$5,$6,$7,'','','open',$8,$9,$10,$11)`,
    [logId, ownerId, (fw && fw.sent) || u.ts, counterpart,
      warn.length ? '받은 메일 · ⚠ 확인' : '받은 메일', (fw && fw.subject) || u.subject, u.body, req.user?.email || '',
      `${f ? `${f.by} 전달 · ` : ''}${req.user?.name || req.user?.email || ''} (주인 없는 메일에서 연결)`, u.mail_box, u.mail_uid]);
    let contactAdded = false;
    if (addContact && canAdd) {
      const em = String(contactAddr || '').trim();
      if (sp) {
        const has = (await pool.query(`SELECT 1 FROM speaker_contacts WHERE speaker_id = $1 AND lower(email) = lower($2)`, [ownerId, em])).rowCount;
        if (!has) {
          // 받는 사람이 갑자기 늘지 않게 «안 보냄»으로 넣는다 — 연락 상대 탭에서 수신·참조로 바꾼다
          await pool.query(`INSERT INTO speaker_contacts (id, speaker_id, contact_id, name, email, phone, kind, send, note)
            VALUES ($1,$2,'',$3,$4,'','실무진','','메일에서 연결')`, [`SC-${Date.now()}-${Math.floor(Math.random() * 1000)}`, ownerId, contactName || '', em]);
          contactAdded = true;
        }
      } else {
        const has = (await pool.query(`SELECT 1 FROM exhibitor_contacts WHERE exhibitor_id = $1 AND lower(email) = lower($2)`, [ownerId, em])).rowCount;
        if (!has) {
          await pool.query(`INSERT INTO exhibitor_contacts (id, exhibitor_id, contact_id, name, email, phone, role, is_primary, note)
            VALUES ($1,$2,'',$3,$4,'','기타','','메일에서 연결')`, [`XC-${Date.now()}-${Math.floor(Math.random() * 1000)}`, ownerId, contactName || '', em]);
          contactAdded = true;
        }
      }
    }
    await pool.query(`UPDATE mail_unassigned SET status = 'linked', linked_t = $1, linked_id = $2, handled_by = $3 WHERE id = $4`,
      [sp ? 'sp' : 'ex', ownerId, req.user?.email || '', u.id]);
    res.json({ ok: true, logId, contactAdded });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* CRM 협의에 붙이기 — 받은 메일을 타겟 컨택 이력(log JSON)에 «메일 받음»으로 남긴다.
   본문은 옮기지 않는다(원문은 «원문 보기»로 메일함에서 그때 가져온다). 사람이 적은 메모만 둔다 */
router.post('/unassigned/:id/link-crm', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 바꿀 수 없어요' });
  const { targetId, memo } = req.body || {};
  try {
    await ensureExtra();
    const u = (await pool.query(`SELECT * FROM mail_unassigned WHERE id = $1`, [req.params.id])).rows[0];
    if (!u || u.status !== 'new') return res.status(404).json({ ok: false, error: '이미 처리한 메일이에요' });
    const t = (await pool.query(`SELECT id, event FROM crm_targets WHERE id = $1`, [String(targetId || '')])).rows[0];
    if (!t) return res.status(404).json({ ok: false, error: 'CRM 타겟을 찾지 못했어요' });
    if (t.event !== u.event_id) return res.status(400).json({ ok: false, error: '다른 행사 메일함의 메일이에요' });
    const f = forwardOf(u), fw = f && f.fw;
    const at = (fw && fw.sent) || u.ts || '';
    const entry = { type: '메일 받음', text: String((fw && fw.subject) || u.subject || '').trim() || '(제목 없음)',
      from: fw ? fmtAddr(fw.from) : (u.from_name ? `${u.from_name} <${u.from_addr}>` : u.from_addr), mu: u.id, memo: String(memo || '').trim(),
      ...(f ? { fwdBy: f.by } : {}),
      date: at.slice(0, 10), at, by: req.user?.name || req.user?.email || '', color: '#0F766E' };
    await pool.query(
      `UPDATE crm_targets SET "lastActivity" = GREATEST(COALESCE("lastActivity", ''), $3),
         log = (jsonb_build_array($2::jsonb) || CASE WHEN left(btrim(COALESCE(log, '')), 1) = '[' THEN log::jsonb ELSE '[]'::jsonb END)::text
       WHERE id = $1`, [t.id, JSON.stringify(entry), entry.date]);
    await pool.query(`UPDATE mail_unassigned SET status = 'linked', linked_t = 'crm', linked_id = $1, handled_by = $2 WHERE id = $3`,
      [t.id, req.user?.email || '', u.id]);
    res.json({ ok: true, entry });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/unassigned/:id/ignore', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 바꿀 수 없어요' });
  try {
    await ensureExtra();
    const u = (await pool.query(`SELECT * FROM mail_unassigned WHERE id = $1`, [req.params.id])).rows[0];
    if (!u) return res.status(404).json({ ok: false, error: '없는 메일이에요' });
    let n = 0;
    if (req.body && req.body.domain) {
      // 이 도메인은 늘 무시 — 행사 메일 설정에 적어 두고, 쌓여 있던 같은 도메인 메일도 함께 숨긴다
      const d = domainOf(u.from_addr);
      if (!d || FREE_MAIL.has(d)) return res.status(400).json({ ok: false, error: '무료 메일 도메인은 통째로 무시할 수 없어요' });
      const b = await boxOf(u.event_id);
      const list = new Set(String((b && b.ignore_domains) || '').split(',').map((x) => x.trim()).filter(Boolean));
      list.add(d);
      await pool.query('UPDATE event_mailboxes SET ignore_domains = $1 WHERE event_id = $2', [[...list].join(','), u.event_id]);
      n = (await pool.query(`UPDATE mail_unassigned SET status = 'ignored', handled_by = $1
        WHERE event_id = $2 AND status = 'new' AND lower(split_part(from_addr, '@', 2)) = $3`, [req.user?.email || '', u.event_id, d])).rowCount;
    } else {
      n = (await pool.query(`UPDATE mail_unassigned SET status = 'ignored', handled_by = $1 WHERE id = $2`, [req.user?.email || '', u.id])).rowCount;
    }
    res.json({ ok: true, ignored: n });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

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
  // part=sent|inbox면 하나만 — 큰 메일함은 둘을 한 번(60초)에 못 끝낸다
  const part = String(req.query.part || '');
  const skip = { ok: true, added: 0, stamped: 0, replied: 0 };
  const sent = part === 'inbox' ? skip : await runHandler(syncSentHandler, eventId);
  const inbox = part === 'sent' ? skip : await runHandler(syncInboxHandler, eventId);
  res.json({
    ok: !!(sent.ok && inbox.ok),
    sent: sent.ok ? { added: sent.added, stamped: sent.stamped } : { error: sent.error },
    inbox: inbox.ok ? { added: inbox.added, replied: inbox.replied } : { error: inbox.error },
  });
});

module.exports = router;
module.exports.cron = cron;
