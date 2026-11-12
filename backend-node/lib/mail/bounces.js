/* ══════════════════════════════════════════════════════════════
   bounces.js — 반송 메일(주소를 찾을 수 없음)을 읽어 보낸 곳에 «반송»을 남긴다

   단체 메일을 돌리면 없는 주소는 메일 서버(mailer-daemon·postmaster)가 돌려보낸다.
   받은메일함 가져오기(sync-inbox.js)가 이 메일을 찾아 여기로 넘긴다.

   - 반송된 주소: X-Failed-Recipients 머리 → 전달 보고서(Final-Recipient) → 본문에서 우리 주소가 아닌 첫 주소
   - 컨택 DM: 이 행사 차수에서 그 주소로 보낸 가장 최근 «DM 보냄»을 찾아 같은 기업에 «반송» 한 줄
   - 참가사·연사: 그 주소의 주인이면 기록(exhibitor_logs·speaker_logs)에 «반송» 한 줄
   - 처리한 반송 메일은 mail_unassigned에 status 'bounce'로 남겨 다시 읽지 않는다
     (주인 없는 메일 창에는 'new'만 나온다)
═══════════════════════════════════════════════════════════════ */
const pool = require('../../db/pool');

const DAEMON = /^(mailer-daemon|postmaster|mail-daemon|mailerdaemon)@/i;
const isDaemon = (from) => DAEMON.test(String(from || '').trim());
const MAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const low = (s) => String(s || '').trim().toLowerCase();

/* 반송된 주소들 — skip(addr)이 참이면 우리 주소라 뺀다 */
function failedAddrs(mail, skip) {
  const h = mail.headers || new Map();
  const out = new Set();
  const add = (s) => String(s || '').replace(/^rfc822;\s*/i, '').match(MAIL_RE)?.forEach((a) => { const k = low(a); if (!skip(k) && !isDaemon(k)) out.add(k); });
  const xf = h.get('x-failed-recipients');
  (Array.isArray(xf) ? xf : [xf]).forEach(add);
  if (out.size) return [...out];
  // 전달 보고서(message/delivery-status) — 첨부로 들어온다
  for (const a of mail.attachments || []) {
    if (/delivery-status/i.test(a.contentType || '')) {
      const t = a.content ? a.content.toString('utf8') : '';
      (t.match(/^(final|original)-recipient:.*$/gim) || []).forEach(add);
    }
  }
  if (out.size) return [...out];
  // 본문 — «gift@kgimall.com 주소를 찾을 수 없거나…», «wasn't delivered to x@y»
  const text = String(mail.text || '').slice(0, 4000);
  const hit = text.match(MAIL_RE)?.map(low).find((k) => !skip(k) && !isDaemon(k));
  return hit ? [hit] : [];
}

/* 반송 메일 한 통 처리. 무엇에 남겼는지 돌려준다 */
async function recordBounce({ eventId, uid, at, mail, skip, byMail, names, user }) {
  const addrs = failedAddrs(mail, skip);
  const done = [];
  for (const addr of addrs) {
    const note = `반송 — ${addr} 주소를 찾을 수 없음`;
    // 1) 컨택 DM — 그 주소로 보낸 가장 최근 «보냄»
    const ca = (await pool.query(`
      SELECT a.* FROM contact_attempts a JOIN contact_rounds r ON r.id = a.round_id
       WHERE r.event_id = $1 AND a.channel = 'DM' AND a.reaction = 'sent' AND lower(a.phone) LIKE $2
       ORDER BY a.at DESC LIMIT 1`, [eventId, `%${addr}%`])).rows[0];
    if (ca) {
      const r = await pool.query(`INSERT INTO contact_attempts (id, round_id, member_id, org_id, contact_id, contact_name, phone,
          channel, at, by_email, by_name, reaction, note)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'DM',$8,$9,$10,'bounce',$11) ON CONFLICT (id) DO NOTHING`,
      [`CA-BNC-${eventId}-${uid}-${addr}`.slice(0, 120), ca.round_id, ca.member_id, ca.org_id, ca.contact_id || '', ca.contact_name || '',
        addr, at, user?.email || '', '반송 자동 확인', `${note} (보낸 메일: ${ca.note || ''})`]);
      if (r.rowCount) done.push({ t: 'contact', addr, member_id: ca.member_id });
    }
    // 2) 참가사·연사 담당자 주소
    const who = byMail.get(addr);
    if (who) {
      const sp = who.t === 'sp';
      await pool.query(`
        INSERT INTO ${sp ? 'speaker_logs' : 'exhibitor_logs'} (id, ${sp ? 'speaker_id' : 'exhibitor_id'}, kind, ts, direction,
          channel, counterpart, category, subject, body, answered_at, answer, status, author_email, author_name, mail_box, mail_uid)
        VALUES ($1,$2,'note',$3,'in','이메일',$4,'반송',$5,$6,'','','done',$7,'반송 자동 확인','INBOX',$8)`,
      [`${sp ? 'SL' : 'XL'}-${Date.now()}-${Math.floor(Math.random() * 100000)}`, who.id, at, addr,
        `반송: ${String(mail.subject || '').trim()}`, note, user?.email || '', uid]);
      done.push({ t: who.t, addr, id: who.id, name: names(who) });
    }
    if (!ca && !who) done.push({ t: 'none', addr });
  }
  // 다시 읽지 않게 표시 — 주인 없는 메일 창에는 안 나온다
  await pool.query(`INSERT INTO mail_unassigned (id, event_id, mail_box, mail_uid, ts, from_addr, from_name, subject, body,
      warnings, status, created_at) VALUES ($1,$2,'INBOX',$3,$4,$5,'',$6,$7,'[]','bounce',$4)
    ON CONFLICT (event_id, mail_box, mail_uid) DO NOTHING`,
  [`MU-${Date.now()}-${Math.floor(Math.random() * 100000)}`, eventId, uid, at, String(mail.from?.text || ''),
    String(mail.subject || ''), addrs.length ? `반송 주소: ${addrs.join(', ')}` : '반송 주소를 읽지 못함']);
  return { addrs, done };
}

module.exports = { isDaemon, failedAddrs, recordBounce };
