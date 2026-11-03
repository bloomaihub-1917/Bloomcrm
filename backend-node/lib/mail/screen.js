/* ══════════════════════════════════════════════════════════════
   screen.js — 받은 메일 거르기 — 기록 칸·주인 없는 메일 표, 스팸·대량 메일·경고
   (../../routes/mail.js에서 떼어 냈다. 그 파일이 이 파일을 require한다 — 이 파일은 그 파일을 부르지 않는다)
═══════════════════════════════════════════════════════════════ */
const pool = require('../../db/pool');

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

module.exports = { ensureExtra, isSpam, isBulk, domainOf, FREE_MAIL, mailWarnings };
