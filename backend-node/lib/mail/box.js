/* ══════════════════════════════════════════════════════════════
   box.js — 첨부파일·행사 공용 메일 계정·푸터·IMAP
   (../../routes/mail.js에서 떼어 냈다. 그 파일이 이 파일을 require한다 — 이 파일은 그 파일을 부르지 않는다)
═══════════════════════════════════════════════════════════════ */
const nodemailer = require('nodemailer');
const pool = require('../../db/pool');
const crypto = require('crypto');
const MailComposer = require('nodemailer/lib/mail-composer');
const { ImapFlow } = require('imapflow');

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
/* 기록 날짜는 한국 날짜로 — 서버(UTC) 날짜로 적으면 오전 9시 전에 보낸 메일이 전날로 남고,
   보낸메일함과 맞출 때 같은 메일을 다른 날로 보고 두 번 남긴다 */
const kstDate = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
/* 기록에는 시각까지 남긴다(«2026-10-07 14:30», 한국 시각). 같은 메일인지 견줄 때는
   앞 10자리 날짜만 본다 — 예전 기록은 날짜만 있다 */
const kstStamp = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const MAILPLUG = { host: 'smtp.mailplug.co.kr', port: 465, imap: 'imap.mailplug.co.kr', imapPort: 993 };
/* 메일 서비스별 서버 — 행사마다 메일플러그·Gmail·네이버 웍스 중에서 고른다.
   saveSent: 보낸 뒤 보낸메일함에 사본을 우리가 넣어야 하는지. Gmail은 SMTP로 보내면
   보낸편지함에 저절로 남아서, 넣으면 두 통이 된다 */
const PROVIDERS = {
  mailplug: { host: 'smtp.mailplug.co.kr', port: 465, imap: 'imap.mailplug.co.kr', imapPort: 993, saveSent: true },
  gmail:    { host: 'smtp.gmail.com',      port: 465, imap: 'imap.gmail.com',      imapPort: 993, saveSent: false },
  naverworks: { host: 'smtp.worksmobile.com', port: 465, imap: 'imap.worksmobile.com', imapPort: 993, saveSent: true },
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
  // 행사 메일 푸터 — 이 메일함으로 나가는 모든 메일 맨 끝에 붙는 글·이미지(sendFooter)
  .then(() => pool.query('ALTER TABLE event_mailboxes ADD COLUMN IF NOT EXISTS footer_text TEXT'))
  .then(() => pool.query('ALTER TABLE event_mailboxes ADD COLUMN IF NOT EXISTS footer_img TEXT'))
  .then(() => pool.query('ALTER TABLE event_mailboxes ADD COLUMN IF NOT EXISTS footer_img_type TEXT'))
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

/* 메일함 한 줄 — 푸터 이미지(최대 1MB)는 보낼 때·푸터 화면에서만 읽는다(img: true).
   자동 가져오기가 15분마다 행사마다 읽는데, 매번 이미지를 실어 오면 Neon 전송량이 한 달 수 GB가 된다 */
const BOX_SELECT = `SELECT (to_jsonb(m) - 'footer_img') || jsonb_build_object('has_footer_img', COALESCE(m.footer_img, '') <> '') AS b
  FROM event_mailboxes m`;
const boxOf = async (eventId, { img = false } = {}) => {
  if (!eventId) return null;
  await ensureBox();
  const r = await pool.query(img ? 'SELECT * FROM event_mailboxes WHERE event_id = $1' : `${BOX_SELECT} WHERE m.event_id = $1`, [String(eventId)]);
  const row = r.rows[0];
  return row ? (img ? { ...row, has_footer_img: !!row.footer_img } : row.b) : null;
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
  footer_text: b.footer_text || '', has_footer_img: !!b.has_footer_img,
});

/* ── 행사 메일 푸터 ──
   설정 › 행사 관리 › 메일에 한 번 적어 두면 이 메일함으로 나가는 모든 메일(전시·연사·컨택·CRM)
   맨 끝에 붙는다. 글은 **굵게** · *기울임* · www.·http 주소는 링크. 이미지는 글 아래에 인라인(cid)으로.
   화면마다 푸터를 따로 두면 메일마다 모양이 달라져 여기 한 곳에서 붙인다. */
const FOOTER_IMG_MAX = 1024 * 1024;
const escH = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const footerPlain = (t) => String(t || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').trim();
function footerHtml(t, cid) {
  const line = (l) => escH(l)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/\b((?:https?:\/\/|www\.)[^\s<]+)/g, (u) => `<a href="${u.startsWith('www.') ? 'https://' + u : u}" style="color:#1a0dab">${u}</a>`);
  const txt = String(t || '').trim();
  return `<div style="margin-top:24px;font-family:Arial,sans-serif;font-size:12px;line-height:1.45;color:#222">${
    txt ? txt.split('\n').map(line).join('<br>') : ''}${
    cid ? `<img src="cid:${cid}" alt="" style="display:block;max-width:100%;width:640px;height:auto;margin-top:${txt ? 10 : 0}px">` : ''}</div>`;
}
/* 메일(text·html·attachments)에 푸터를 붙인다. html이 없으면 글을 html로 바꿔 함께 보낸다 */
function withFooter(box, mail) {
  const t = String((box && box.footer_text) || '').trim();
  const img = box && box.footer_img;
  if (!t && !img) return mail;
  const cid = img ? `footer.${Date.now().toString(36)}@bloom` : null;
  const text = mail.text + (t ? `\n\n${footerPlain(t)}` : '');
  const base = mail.html || `<div style="font-family:'Malgun Gothic',Arial,sans-serif;font-size:14px;line-height:1.6;color:#222">${escH(mail.text).replace(/\n/g, '<br>')}</div>`;
  const html = base + footerHtml(t, cid);
  const attachments = [...(mail.attachments || []),
    ...(img ? [{ filename: 'footer.' + (/png/.test(box.footer_img_type || '') ? 'png' : 'jpg'), content: img, encoding: 'base64',
      contentType: box.footer_img_type || 'image/jpeg', cid, contentDisposition: 'inline' }] : [])];
  return { ...mail, text, html, attachments: attachments.length ? attachments : undefined };
}

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
  // 기본 90초를 기다리면 Vercel 함수(60초)가 먼저 끊긴다
  connectionTimeout: 15000, greetingTimeout: 10000,
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
  const b = await boxOf(eventId, { img: true }).catch(() => null);   // 푸터 이미지를 붙여야 한다
  if (b && b.username && b.pass_enc) {
    const from = b.from_addr || b.username;
    return { t: boxTransport(b), box: b, from, fromName: b.from_name || '', via: `행사 메일 ${from}` };
  }
  // Gmail로 대신 보내지 않는다 — 행사 사람에게 처음 보는 주소로 나가면 안 된다
  return null;
};


module.exports = { LOCAL_MAX, TOTAL_MAX, FILE_MAX, ensureFiles, b64size, cfg, transport, kstDate, kstStamp, PROVIDERS, prov, ensureBox, markSynced, secretKey, seal, BOX_SELECT, boxOf, boxTransport, boxPublic, FOOTER_IMG_MAX, withFooter, imapClient, SENT_NAMES, saveToSent, partDone, senderFor };
