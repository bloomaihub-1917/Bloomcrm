/* ══════════════════════════════════════════════════════════════
   import-builders.js — 독립부스 시공사를 기업 DB·연락처로 올린다

   시공사는 참가기업 행(exhibitors.builder*)에 적혀만 있었다. 그러면 다음
   행사에서 «작년에 그 부스 누가 지었지?»를 찾을 길이 없고, 같은 시공사가
   여러 부스를 맡아도 한 회사로 보이지 않는다. 시공사는 벤더시공사로
   기업 DB에, 담당자는 연락처로 둔다.

   이름 대조는 법인 표기만 눌러서 «정확히 같을 때만» 잇는다 — 에이앤티디자인과
   에이앤티미디어처럼 비슷하기만 한 다른 회사가 흔하다. 못 찾으면 새로 만든다.
   «직접 설치»는 시공사가 아니라 넘긴다.

   여러 번 돌려도 된다 — 이미 있는 기업·연락처는 다시 만들지 않고 빈 칸만 채운다.

     node db/import-builders.js [--event "2026 KIC"] [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const EVENT = arg('--event') || '2026 KIC';

const clean = (v) => String(v ?? '').replace(/ /g, ' ').trim();
const norm = (v) => clean(v).toLowerCase()
  .replace(/주식회사|㈜|\(주\)/g, '')
  .replace(/\(.*?\)/g, '')              // WELLD (웰디자인) → welld
  .replace(/[^a-z0-9가-힣]/g, '');
const SELF = /^직접\s*설치$/;

/* '이용운 실장' · '조춘관실장' → 이름과 직함으로 가른다 */
const TITLES = ['디자이너', '대표', '이사', '실장', '부장', '차장', '과장', '대리', '팀장', '매니저', '주임', '사원', '실'];
function splitName(raw) {
  const s = clean(raw).replace(/\s+/g, ' ');
  for (const t of TITLES) {
    if (s.endsWith(t) && s.length > t.length) {
      const name = s.slice(0, -t.length).trim();
      if (/^[가-힣]{2,4}$/.test(name)) return { name, title: t === '실' ? '실장' : t };
    }
  }
  return { name: s, title: '' };
}
/* 휴대폰 칸에 번호가 둘 적힌 경우가 있다 — 첫째는 phone1, 둘째는 phone2로 */
const phones = (v) => clean(v).split(/\s*[\/,]\s*/).map(clean).filter(Boolean);

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE exhibitors ADD COLUMN IF NOT EXISTS builder_org_id TEXT');

    const exhs = (await client.query(
      `SELECT id, company_name, builder, builder_contact, builder_tel, builder_mobile, builder_email
         FROM exhibitors WHERE event_id = $1 AND COALESCE(builder,'') <> ''`, [EVENT])).rows;
    const orgs = (await client.query(`SELECT id, name_ko, name_en, aliases, phone, email FROM orgs`)).rows;
    const index = new Map();
    orgs.forEach((o) => [o.name_ko, o.name_en, ...String(o.aliases || '').split('\n')]
      .filter(Boolean).forEach((n) => { const k = norm(n); if (k && !index.has(k)) index.set(k, o); }));

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const stamp = now.getTime();
    let seq = 0;
    const made = [], linked = [], people = [], skipped = [];

    for (const x of exhs) {
      const bname = clean(x.builder);
      if (SELF.test(bname)) { skipped.push(x.company_name); continue; }

      let org = index.get(norm(bname));
      if (!org) {
        org = { id: `O-${stamp}_bd${++seq}`, name_ko: bname, phone: '', email: '' };
        if (!DRY) await client.query(
          `INSERT INTO orgs (id, name_ko, name_en, kind, status, sectors, source, created_at, updated_at)
           VALUES ($1, $2, '', '벤더시공사', '활성', '', $3, $4, $5)`,
          [org.id, bname, `${EVENT} 독립부스 시공사`, now.toISOString(), today]);
        index.set(norm(bname), org);
        made.push(bname);
      } else if (!linked.includes(org.name_ko) && !made.includes(org.name_ko)) linked.push(org.name_ko);

      if (!DRY) await client.query('UPDATE exhibitors SET builder_org_id = $2 WHERE id = $1', [x.id, org.id]);

      const { name, title } = splitName(x.builder_contact);
      const [m1, m2] = phones(x.builder_mobile);
      const tel = clean(x.builder_tel), email = clean(x.builder_email);

      /* 사람 이름이 없으면 연락처로 만들 수 없다 — 번호·메일은 회사 대표로 둔다 */
      if (!/^[가-힣]{2,4}$/.test(name)) {
        const patch = {};
        if (!clean(org.phone) && (tel || m1)) patch.phone = tel || m1;
        if (!clean(org.email) && email) patch.email = email;
        const cols = Object.keys(patch);
        if (cols.length && !DRY) await client.query(
          `UPDATE orgs SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ')} WHERE id = $1`,
          [org.id, ...cols.map((c) => patch[c])]);
        Object.assign(org, patch);
        continue;
      }

      const dup = (await client.query(
        `SELECT id, phone1, phone2, email1, "titleKo" FROM contacts WHERE org_id = $1 AND "nameKo" = $2`,
        [org.id, name])).rows[0];
      if (dup) {
        const patch = {};
        if (!clean(dup.phone1) && m1) patch.phone1 = m1;
        if (!clean(dup.phone2) && (m2 || tel)) patch.phone2 = m2 || tel;
        if (!clean(dup.email1) && email) patch.email1 = email;
        if (!clean(dup.titleKo) && title) patch.titleKo = title;
        const cols = Object.keys(patch);
        if (cols.length && !DRY) await client.query(
          `UPDATE contacts SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ')} WHERE id = $1`,
          [dup.id, ...cols.map((c) => patch[c])]);
        continue;
      }
      if (!DRY) await client.query(
        `INSERT INTO contacts (id, "nameKo", "orgKo", "titleKo", cat, lang, source, date, status,
                               email1, phone1, phone2, org_id)
         VALUES ($1, $2, $3, $4, '', 'ko', $5, $6, 'new', $7, $8, $9, $10)`,
        [`${stamp}${String(++seq).padStart(4, '0')}`, name, org.name_ko, title,
          `${EVENT} 독립부스 시공사`, today, email, m1 || tel, m1 ? (m2 || tel) : (m2 || ''), org.id]);
      people.push(`${name}${title ? ' ' + title : ''} (${org.name_ko})`);
    }

    console.log(`\n${EVENT} 독립부스 시공사 — 참가기업 ${exhs.length}곳`);
    console.log(`  새 기업 ${made.length}: ${made.join(', ') || '-'}`);
    console.log(`  기존 기업에 이음 ${linked.length}: ${linked.join(', ') || '-'}`);
    console.log(`  새 연락처 ${people.length}:`); people.forEach((p) => console.log('    ', p));
    if (skipped.length) console.log(`  직접 설치라 넘김 ${skipped.length}: ${skipped.join(', ')}`);

    if (DRY) { await client.query('ROLLBACK'); console.log('\n--dry 라서 되돌렸습니다.'); }
    else { await client.query('COMMIT'); console.log('\n반영 완료.'); }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end?.();
  }
})();
