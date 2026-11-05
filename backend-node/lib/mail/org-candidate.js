/* ══════════════════════════════════════════════════════════════
   org-candidate.js — 받은 홍보메일에서 «기업 후보»를 뽑는다

   AI를 쓰지 않는다. 메일 본문은 Claude API로 보내지 않기로 했다(2026-10-08).
   보낸 사람 이름·주소·제목과 서명(전화·홈페이지)을 규칙으로만 읽는다.
   맞지 않을 수 있어서 사람이 고쳐 적고 «추가»를 눌러야 등록된다.
═══════════════════════════════════════════════════════════════ */
const { FREE_MAIL } = require('./screen');

/* 홍보메일 표시 — 제목의 «(광고)»·«[협업제안]»류, 본문의 수신거부 안내 */
const PROMO_SUBJ = /^\s*[\[(（]\s*(광고|제안|협업\s*제안|제휴|홍보)\s*[\])）]|제휴\s*제안|협업\s*제안|견적|소개서|제작\s*제안/;
const PROMO_BODY = /수신\s*거부|수신거부|광고성\s*정보|unsubscribe|opt[- ]?out|회사\s*소개서\s*(를\s*)?첨부/i;
const isPromo = (row) => row.status === 'promo' || PROMO_SUBJ.test(row.subject || '') || PROMO_BODY.test(String(row.body || '').slice(0, 6000));

const RE_PHONE = /(?:\+?\d{1,3}[-.\s]?)?(?:0\d{1,2}|\d{2,3})[-.\s]\d{3,4}[-.\s]\d{4}\b/g;
const RE_SITE = /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:co\.kr|com|kr|net|org|io|cn|cloud|biz|ai))\b(?:\/[^\s<>"')]*)?/i;
const TITLES = /(대표이사|대표|이사|팀장|실장|본부장|부장|차장|과장|대리|매니저|MD|디렉터|Director|Manager|CEO|Sales|담당)/;
const COMPANY_MARK = /(주식회사|\(주\)|㈜|Co\.,? ?Ltd|Inc\.?|Corp\.?|Studio|스튜디오|랩|Lab)/i;

/* 서명 줄에서 «○○ 대표»·«○○ | 에덴 마케팅 대표»를 찾는다 */
function parseCandidate(row) {
  const body = String(row.body || '');
  const from = String(row.from_addr || '').toLowerCase();
  const dom = from.split('@')[1] || '';
  const free = FREE_MAIL.has(dom);
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let org = '', name = '', title = '';
  const sig = lines.slice(-30);
  // «정지한 | 에덴 마케팅 대표» · «남하준 | 플라츠랩» 형태
  for (const l of sig) {
    const m = l.match(/^([가-힣]{2,5}|[A-Za-z][A-Za-z .]{1,28})\s*\|\s*([^|]{2,30})$/);
    if (m) { name = m[1].trim(); const rest = m[2].trim(); const t = rest.match(TITLES); org = rest.replace(TITLES, '').trim() || rest; if (t) title = t[1]; break; }
  }
  if (!org) {
    const intro = body.match(/(?:저희는|저는)?\s*([가-힣A-Za-z0-9 ()·&]{2,25})(?:입니다|이에요)/) ||
      body.match(/^\s*안녕하세요[.,]?\s*([가-힣A-Za-z0-9 ()·&]{2,25})(?:입니다|이에요)/m);
    if (intro && COMPANY_MARK.test(intro[1])) org = intro[1].trim();
  }
  if (!org) {
    const markLine = sig.find((l) => COMPANY_MARK.test(l) && l.length <= 30);
    if (markLine) org = markLine;
  }
  if (!org && !free && dom) org = dom.split('.')[0];
  if (!name) name = String(row.from_name || '').replace(/[<>"]/g, '').trim();
  if (!title) { const t = body.slice(-600).match(TITLES); if (t) title = t[1]; }

  const phones = [...new Set((body.slice(-1500).match(RE_PHONE) || []).map((p) => p.trim()))];
  const sm = body.match(RE_SITE);
  const site = (!free && dom) ? dom : (sm ? sm[1] : '');
  const norm = (s) => String(s || '').toLowerCase().replace(/㈜|\(주\)|주식회사|\s+/g, '');
  return { org: org.slice(0, 60), name: name.slice(0, 40), title, email: from, phone: phones[0] || '', phone2: phones[1] || '',
    website: site, free, orgKey: norm(org), promo: isPromo(row) };
}

/* 이미 있는 기업·연락처인지 — 이메일·도메인·이름 순 */
async function findDuplicate(pool, c) {
  if (c.email) {
    const r = (await pool.query(
      `SELECT c.id, c."nameKo", c."orgKo", c.org_id FROM contacts c WHERE lower(c.email1) = $1 OR lower(c.email2) = $1 LIMIT 1`, [c.email])).rows[0];
    if (r) return { by: '이메일', contactId: r.id, orgId: r.org_id, label: `${r.nameKo || ''} · ${r.orgKo || ''}` };
  }
  if (c.website && !c.free) {
    const d = String(c.website).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    const r = (await pool.query(`SELECT id, name_ko FROM orgs WHERE lower(website) LIKE $1 LIMIT 1`, [`%${d}%`])).rows[0];
    if (r) return { by: '홈페이지', orgId: r.id, label: r.name_ko };
  }
  if (c.orgKey && c.orgKey.length >= 2) {
    const r = (await pool.query(
      `SELECT id, name_ko FROM orgs WHERE regexp_replace(lower(COALESCE(name_ko,'')), '㈜|\\(주\\)|주식회사|\\s+', '', 'g') = $1 LIMIT 1`, [c.orgKey])).rows[0];
    if (r) return { by: '기업명', orgId: r.id, label: r.name_ko };
  }
  return null;
}

module.exports = { parseCandidate, findDuplicate, isPromo };
