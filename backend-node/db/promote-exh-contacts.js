/* ══════════════════════════════════════════════════════════════
   promote-exh-contacts.js — 전시에만 있던 담당자를 마스터DB로 올린다

   예전에는 담당자를 전시 안에서만 적을 수 있었다(exhibitor_contacts에 이름·
   이메일을 직접 넣는 방식). 그렇게 들어간 사람은 마스터DB에 없어서 다음 행사에
   다시 쓸 수 없고, 기업DB의 행사별 집계와 CRM 참여 이력에서도 빠진다.

   그냥 옮기면 안 되는 줄이 섞여 있어 성격별로 갈라 다룬다.

   ① 이름 칸에 기업명이 들어간 줄
      "메디라마 (MediRama)", "Almac Group" 같은 값이다. 그대로 올리면 마스터DB에
      기업명을 이름으로 가진 사람이 생긴다. 이름은 비우고, 이메일 앞부분이
      사람 이름꼴(hyunjung.roh)이면 그것만 영문 이름으로 삼는다. 지어낸 값이라
      source에 표시를 남겨 나중에 걸러낼 수 있게 한다.

   ② 남의 회사 도메인을 쓰는 사람
      대행사가 대신 진행하는 기업이 있다. 그 사람을 마스터DB에 이 기업 소속으로
      넣으면 소속이 틀어지므로 건드리지 않는다. 메모가 있다는 이유만으로 빼지는
      않는다 — '임상시험센터 · 인보이스 수신인'처럼 그냥 적어 둔 메모도 있어서,
      그것까지 빼면 진짜 담당자가 누락된다. 그 기업 마스터DB 연락처가 쓰는
      도메인과 다른지로만 가린다.

   ③ 이름도 이메일도 없는 빈 줄
      올릴 내용이 없다. 지우지도 않는다 — 지우는 건 따로 확인받아야 한다.

   같은 이메일이 마스터DB에 이미 있으면 새로 만들지 않고 그 연락처에 잇는다.

     node db/promote-exh-contacts.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

const cleanMail = (v) => String(v || '').replace(/[<>]/g, '').trim();
const lower = (v) => cleanMail(v).toLowerCase();

/* 이메일 앞부분이 사람 이름꼴인가 — hyunjung.roh 처럼 알파벳 두 덩이가
   점으로 갈려 있을 때만 인정한다. mice1·data.biz.rwe 같은 공용 주소는 뺀다. */
function nameFromEmail(email){
  const local = lower(email).split('@')[0] || '';
  const parts = local.split('.').filter(Boolean);
  if(parts.length !== 2) return '';
  if(parts.some((p) => p.length < 2 || !/^[a-z]+$/.test(p))) return '';
  return parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(' ');
}

/* 이름 칸이 사람이 아니라 기업을 가리키나 */
function looksLikeCompany(name, company, email){
  const squash = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const n = squash(name), c = squash(company);
  if(!n) return false;
  if(c && (n.includes(c) || c.includes(n))) return true;
  // 국문 사명과 영문 표기가 아예 달라 못 맞추는 경우가 있다(데이터포라이프 ↔
  // Data4Life). 이메일 도메인이 곧 그 회사 이름인 경우가 많아 함께 견준다.
  const dom = squash((lower(email).split('@')[1] || '').split('.')[0]);
  if(dom && dom.length > 2 && (n === dom || n.includes(dom) || dom.includes(n))) return true;
  return /(inc|corp|corporation|ltd|llc|group|technologies|유한회사|주식회사)/i.test(name);
}

/* "신기민 팀장" 처럼 직함이 붙은 이름을 가른다 */
const TITLES = ['팀장', '부장', '차장', '과장', '대리', '사원', '이사', '상무', '전무', '대표', '실장', '매니저', '주임'];
function splitTitle(name){
  const t = String(name || '').trim();
  for(const ti of TITLES){
    if(t.endsWith(' ' + ti)) return { name: t.slice(0, -ti.length).trim(), title: ti };
  }
  return { name: t, title: '' };
}

(async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT c.id, c.exhibitor_id, c.name, c.email, c.phone, c.role, c.note,
             e.company_name, e.org_id, e.event_id
        FROM exhibitor_contacts c JOIN exhibitors e ON e.id = c.exhibitor_id
       WHERE COALESCE(c.contact_id, '') = ''
       ORDER BY e.company_name`);

    const { rows: mc } = await client.query(
      `SELECT id, "nameKo", "nameEn", "orgKo", email1, org_id FROM contacts`);
    const byMail = new Map();
    mc.forEach((m) => { const k = lower(m.email1); if(k) byMail.set(k, m); });

    const { rows: parts } = await client.query('SELECT contact_id, event_id FROM participations');
    const hasPart = new Set(parts.map((p) => `${p.contact_id}|${p.event_id}`));

    /* 기업마다 마스터DB 연락처가 쓰는 도메인 — 남의 회사 사람인지 가리는 근거 */
    const FREE = ['gmail.com', 'naver.com', 'daum.net', 'hanmail.net', 'kakao.com',
      'outlook.com', 'hotmail.com', 'icloud.com', 'yahoo.com'];
    const domainOf = (v) => (lower(v).split('@')[1] || '').replace(/[^a-z0-9.-]/g, '');
    const orgDomains = new Map();
    mc.forEach((m) => {
      const d = domainOf(m.email1);
      if(!d || FREE.includes(d)) return;
      if(!orgDomains.has(m.orgKo)) orgDomains.set(m.orgKo, new Set());
      orgDomains.get(m.orgKo).add(d);
    });
    const isForeign = (r) => {
      const d = domainOf(r.email);
      if(!d || FREE.includes(d)) return false;      // 이메일이 없거나 개인 메일이면 판단하지 않는다
      const own = orgDomains.get(r.company_name);
      return !!(own && own.size && !own.has(d));
    };

    const plan = [], skipAgency = [], skipEmpty = [], linkOnly = [];

    for (const r of rows) {
      // ② 남의 회사 도메인인 사람 — 그 기업 소속으로 마스터DB에 넣으면 소속이 틀어진다.
      //    메모가 있다는 이유만으로 빼면 안 된다. '임상시험센터 · 인보이스 수신인'처럼
      //    그냥 적어 둔 메모도 있어서, 그것까지 빼면 진짜 담당자가 누락된다.
      if (isForeign(r)) { skipAgency.push(r); continue; }

      const email = cleanMail(r.email);
      const rawName = String(r.name || '').trim();
      if (!email && !rawName) { skipEmpty.push(r); continue; }             // ③ 빈 줄

      // 이미 마스터DB에 같은 이메일이 있으면 새로 만들지 않고 잇는다
      const hit = email && byMail.get(lower(email));
      if (hit) { linkOnly.push({ r, contact: hit }); continue; }

      let nameKo = '', nameEn = '', titleKo = '', derived = false;
      if (rawName && !looksLikeCompany(rawName, r.company_name, email)) {         // 사람 이름이 맞다
        const s = splitTitle(rawName);
        if (/[가-힣]/.test(s.name)) { nameKo = s.name; titleKo = s.title; }
        else nameEn = s.name;
      } else {                                                            // ① 기업명이 들어간 줄
        nameEn = nameFromEmail(email);
        derived = !!nameEn;
      }

      plan.push({ r, email, nameKo, nameEn, titleKo, derived });
    }

    const show = (t) => `${t.r.company_name} | ${t.nameKo || t.nameEn || '(이름 없음)'}`
      + `${t.titleKo ? ' ' + t.titleKo : ''} | ${t.email || '(이메일 없음)'}`
      + `${t.derived ? '   ← 이메일에서 이름을 뽑음' : ''}`
      + `${!t.nameKo && !t.nameEn ? '   ← 이름 비움(원래 값이 기업명)' : ''}`;

    console.log(`미연결 ${rows.length}건\n`);
    console.log(`■ 마스터DB에 새로 만들 곳 ${plan.length}건`);
    plan.forEach((t) => console.log('   ' + show(t)));

    console.log(`\n■ 이미 있는 연락처에 잇기만 할 곳 ${linkOnly.length}건`);
    linkOnly.forEach(({ r, contact }) => console.log(
      `   ${r.company_name} | ${r.email} → 기존 ${contact.nameKo || contact.nameEn} (${contact.orgKo})`));

    console.log(`\n■ 건드리지 않음 — 대행사 등 사유 적힌 줄 ${skipAgency.length}건`);
    skipAgency.forEach((r) => console.log(`   ${r.company_name} | ${r.email || ''} | ${r.note}`));

    console.log(`\n■ 건드리지 않음 — 이름도 이메일도 없는 빈 줄 ${skipEmpty.length}건`);
    skipEmpty.forEach((r) => console.log(`   ${r.company_name}`));

    if (DRY) { console.log('\n--dry 라서 아무것도 바꾸지 않았습니다.'); return; }

    await client.query('BEGIN');
    let made = 0, linked = 0, partN = 0, seq = 0;
    const today = new Date().toISOString().slice(0, 10);
    const stamp = () => `L-${Date.now()}-${seq++}`;
    const audit = (action, target, detail) => client.query(
      `INSERT INTO activity_log (id, ts, email, name, type, action, target, detail)
       VALUES ($1,$2,'','정리 스크립트','add',$3,$4,$5)`,
      [stamp(), new Date().toISOString(), action, target, detail]);

    const addPart = async (contactId, eventId, role) => {
      if (!eventId || hasPart.has(`${contactId}|${eventId}`)) return;
      await client.query(
        `INSERT INTO participations (id, event_id, contact_id, role, note, matched)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [`P-${Date.now()}-${seq++}`, eventId, String(contactId), '전시참가기업',
          role ? `전시 ${role}` : '', '✅ 전시 담당자 등록(일괄)']);
      hasPart.add(`${contactId}|${eventId}`);
      partN++;
    };

    for (const t of plan) {
      const id = String(Date.now()) + String(seq++).padStart(4, '0');
      await client.query(
        `INSERT INTO contacts (id,"nameKo","nameEn","orgKo","orgEn","titleKo","titleEn","deptKo","deptEn",
           country,cat,lang,source,date,status,email1,email2,phone1,phone2,beat,products,tags,org_id)
         VALUES ($1,$2,$3,$4,'',$5,'','','','',$6,$7,$8,$9,'new',$10,'',$11,'','','','',$12)`,
        [id, t.nameKo, t.nameEn, t.r.company_name, t.titleKo, 'exhibitor',
          t.nameKo ? 'KO' : 'EN',
          `${t.r.event_id || ''} 전시 담당자(일괄 이관)${t.derived ? ' · 이름은 이메일에서 추정' : ''}`,
          today, t.email, t.r.phone || '', t.r.org_id || '']);
      await client.query('UPDATE exhibitor_contacts SET contact_id = $1 WHERE id = $2', [id, t.r.id]);
      await addPart(id, t.r.event_id, t.r.role);
      await audit('담당자 마스터DB 등록', t.r.company_name,
        `<b>${t.nameKo || t.nameEn || t.email}</b> 전시에만 있던 담당자를 마스터DB로 옮김`
        + (t.derived ? ' (이름은 이메일에서 추정 — 확인 필요)' : ''));
      made++;
    }

    for (const { r, contact } of linkOnly) {
      await client.query('UPDATE exhibitor_contacts SET contact_id = $1 WHERE id = $2', [contact.id, r.id]);
      await addPart(contact.id, r.event_id, r.role);
      await audit('담당자 마스터DB 연결', r.company_name,
        `<b>${contact.nameKo || contact.nameEn || r.email}</b> 이미 있던 연락처에 이음`);
      linked++;
    }

    await client.query('COMMIT');
    console.log(`\n반영 완료 — 새로 만듦 ${made}건, 기존에 이음 ${linked}건, 행사 참여 ${partN}건 추가`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
