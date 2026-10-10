/* ─────────────────────────────────────────────
   mail-forward.js — 우리 직원이 행사 메일함으로 전달(FW)한 메일 풀어 읽기

   주최사가 연사에게 직접 보낸 메일을 직원이 받아 행사 메일함으로 넘기는 일이 있다.
   보낸 사람이 직원(@13100m.net)이라 주소로는 주인을 못 찾는다. 본문의 원래 메일 머리
   (----- Original Message ----- / From : / 보낸 사람: / Forwarded message …)를 읽어
   원래 보낸 사람·받는 사람·참조·보낸 시각을 꺼낸다 — 주인은 이 주소들로 찾는다.

   분류는 늘리지 않는다(«받은 메일» 그대로). 전달한 사람은 작성자 칸에만 남긴다.
   ───────────────────────────────────────────── */

/* 우리 회사 도메인 — 모든 행사에 같은 값이라 행사 설정이 아니라 여기(환경변수로 바꿀 수 있게) */
const OUR_DOMAINS = String(process.env.MAIL_OUR_DOMAINS || '13100m.net')
  .split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const domainOf = (a) => String(a || '').toLowerCase().split('@')[1] || '';
const isOurs = (a) => OUR_DOMAINS.includes(domainOf(a));
/* 행사 설정의 «주최사 메일 도메인»(쉼표로 여러 개) */
const domainList = (v) => String(v || '').split(/[,\s]+/).map((x) => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);

/* 원래 메일 머리 시작 줄 */
const MARK = /^\s*-{2,}\s*(original message|forwarded message|원본 메일|원본 메시지|전달된 메시지|전달 메시지|전달된 메일)\s*-{2,}\s*$/i;
/* 머리 칸 — «From :», «보낸 사람:», «보낸사람 :» … */
const KEYS = [
  ['from', /^(from|보낸\s*사람|발신자?)$/i],
  ['to', /^(to|받는\s*사람|수신자?)$/i],
  ['cc', /^(cc|참조)$/i],
  ['sent', /^(sent|date|보낸\s*날짜|날짜|보낸\s*시간|일시)$/i],
  ['subject', /^(subject|제목)$/i],
];
const keyOf = (k) => (KEYS.find(([, re]) => re.test(String(k || '').trim())) || [])[0] || null;

/* «박윤선 <pys@kpbma.or.kr>, Jin-Young Kim <jin@x.com>» → [{ name, addr }] */
function addrs(v) {
  const out = [];
  const s = String(v || '');
  const re = /(?:"?([^"<>,;]*?)"?\s*)?<\s*([^<>\s@]+@[^<>\s]+?)\s*>|([^\s<>,;:"']+@[^\s<>,;:"']+)/g;
  let m;
  while ((m = re.exec(s))) {
    const addr = (m[2] || m[3] || '').replace(/[.)\]]+$/, '').toLowerCase();
    if (addr) out.push({ name: String(m[1] || '').replace(/^[\s,;]+/, '').trim(), addr });
  }
  return out;
}

/* 보낸 시각 → «YYYY-MM-DD HH:mm»(한국 시각). 못 읽으면 '' */
const p2 = (n) => String(n).padStart(2, '0');
function sentStamp(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  // 2026-10-02 11:24:41 · 2026.10.02 11:24 — 머리에 적힌 그대로가 한국 시각이다
  let m = s.match(/(20\d\d)[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?(?:\s*\([^)]*\))?\s*(?:(오전|오후|AM|PM)\s*)?(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (m) {
    let h = +m[5];
    const ap = (m[4] || m[7] || '').toLowerCase();
    if ((ap === '오후' || ap === 'pm') && h < 12) h += 12;
    if ((ap === '오전' || ap === 'am') && h === 12) h = 0;
    return `${m[1]}-${p2(m[2])}-${p2(m[3])} ${p2(h)}:${m[6]}`;
  }
  // 2026년 10월 2일 (목) 오전 11:24
  m = s.match(/(20\d\d)\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일[^0-9]*?(오전|오후)?\s*(\d{1,2}):(\d{2})/);
  if (m) {
    let h = +m[5];
    if (m[4] === '오후' && h < 12) h += 12;
    if (m[4] === '오전' && h === 12) h = 0;
    return `${m[1]}-${p2(m[2])}-${p2(m[3])} ${p2(h)}:${m[6]}`;
  }
  // Thu, Oct 2, 2026 at 11:24 AM · Thursday, October 2, 2026 11:24 AM — 시간대가 없으면 한국 시각으로 본다
  const t = Date.parse(s.replace(/\bat\b/i, ' ').replace(/\s+/g, ' '));
  if (!Number.isNaN(t)) {
    const tz = /([+-]\d{4}|GMT|UTC|\bZ\b)/i.test(s);
    const d = new Date(tz ? t + 9 * 3600e3 : t - new Date(t).getTimezoneOffset() * 60e3);
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
  }
  return '';
}

/* 본문에서 첫 번째(가장 최근에 전달된) 원래 메일 머리를 읽는다.
   { from:{name,addr}, to:[…], cc:[…], sent:'YYYY-MM-DD HH:mm'|'', subject } 또는 null */
function parseForward(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const limit = Math.min(lines.length, 400);
  for (let i = 0; i < limit; i++) {
    const marked = MARK.test(lines[i]);
    const kv0 = lines[i].match(/^\s*>?\s*([^:：]{1,12}?)\s*[:：]\s*(.*)$/);
    // 표시 줄이 없어도 «From:/보낸 사람:»으로 시작하는 머리 묶음이면 읽는다
    if (!marked && !(kv0 && keyOf(kv0[1]) === 'from')) continue;
    const head = {};
    let last = null;
    for (let j = marked ? i + 1 : i; j < Math.min(lines.length, i + 16); j++) {
      const ln = lines[j].replace(/^\s*>\s?/, '');
      if (!ln.trim()) { if (Object.keys(head).length) break; continue; }
      const kv = ln.match(/^\s*([^:：]{1,12}?)\s*[:：]\s*(.*)$/);
      const k = kv && keyOf(kv[1]);
      if (k) { head[k] = kv[2].trim(); last = k; continue; }
      // 받는 사람·참조가 다음 줄로 넘어간 경우
      if ((last === 'to' || last === 'cc') && /@/.test(ln)) { head[last] += ` ${ln.trim()}`; continue; }
      break;
    }
    const from = addrs(head.from)[0];
    if (!from || !(head.subject || head.sent || head.to)) continue;
    return { from, to: addrs(head.to), cc: addrs(head.cc), sent: sentStamp(head.sent), subject: String(head.subject || '').trim() };
  }
  return null;
}

/* 우리 직원이 보낸 메일이면 전달 정보를 붙여 돌려준다. 머리를 못 읽어도 { by, fw:null } —
   «직원 주소를 연락처로 넣지 말 것»은 그대로 알아야 한다 */
function forwardOf(row) {
  if (!isOurs(row.from_addr)) return null;
  return { by: row.from_name || row.from_addr, byAddr: row.from_addr, fw: parseForward(row.body) };
}

/* 원래 메일 주소 중 주인을 찾을 차례 — 원래 보낸 사람 먼저, 그다음 받는 사람·참조.
   우리 주소·주최사 주소는 빼고 */
function forwardCandidates(fw, hostDomains = []) {
  if (!fw) return [];
  const host = new Set(hostDomains);
  return [fw.from, ...fw.to, ...fw.cc].filter((a) => a && !isOurs(a.addr) && !host.has(domainOf(a.addr)));
}

const fmtAddr = (a) => (a ? (a.name ? `${a.name} <${a.addr}>` : a.addr) : '');

module.exports = { OUR_DOMAINS, isOurs, domainOf, domainList, parseForward, forwardOf, forwardCandidates, fmtAddr, sentStamp };
