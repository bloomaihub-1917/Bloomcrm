/* ══════════════════════════════════════════════════════════════
   연락처 넣기 한 길 — 서버 코드·스크립트가 사람을 넣을 때는 모두 이것을 쓴다
   (CLAUDE.md «연락처는 contactUpserter로 넣는다»)

   지금까지는 스크립트마다 «이미 있는 사람인가»를 따로 짰다 — 메일만 보거나, 이름+기업만
   보거나, id를 직접 만들거나, org_id를 빠뜨리거나. 그래서 같은 사고(긴 id 09-29,
   기업DB 미연결 160명 11-09·11-12, 중복 연락처 11-09)가 길마다 되풀이됐다.
   여기서 한 번에 한다:
     ① 같은 사람 찾기 → ② 있으면 빈 칸만 채우기 / 없으면 contactIdAllocator로 새 id
     ③ 소속은 orgResolver로 기업DB에 잇기 → ④ 무엇을 했는지 셈해 두기

   같은 사람 기준 (화면 엑셀 업로드 modules/upload-tab.js와 같은 규칙):
     · 메일(email1·email2)이 같고 이름도 맞음       → 같은 사람 «메일»
       (한쪽에 이름이 없으면 메일만으로 같다고 본다)
     · 메일은 같은데 이름이 다름                      → 의심(공용 주소 info@·비서실)
     · 전화 끝 8자리가 같고 이름도 맞음               → 같은 사람 «전화»
     · 이름이 같고 소속(법인격·띄어쓰기 무시)도 같음 → 같은 사람 «이름+소속»
     · 이름만 같음                                    → 의심(동명이인일 수 있다)
   의심은 기본으로 «새 사람»으로 넣고 따로 모아 보여 준다 — 남의 행사 기록이 붙는 것보다
   한 사람이 둘인 편이 고치기 쉽다(«중복 찾기»로 합친다). onSuspect:'skip'이면 넣지 않는다.

   쓰는 법 — 스크립트:
     const { runImport } = require('../contact-upsert');
     runImport({ name: 'BK2026 연사', source: '연사 명단 · BIO KOREA 2026' }, async ({ client, put }) => {
       for (const r of rows) {
         const { id } = await put({ nameKo: r.이름, orgKo: r.소속, email1: r.메일, phone1: r.전화 });
         // id로 참가 기록 등을 넣는다
       }
     });
   기본은 시험 실행(다 해 보고 되돌림)이고 --apply를 붙여야 저장한다. 끝나면 요약과
   «넣은 뒤 점검»(긴 id·기업DB 미연결·같은 메일 두 명)을 찍는다.

   서버 코드(한 트랜잭션 안):
     const put = await contactUpserter(client, { source: '...' });
     const { id, created, by, suspect } = await put(v);
══════════════════════════════════════════════════════════════ */
const { contactIdAllocator } = require('./contact-ids');
const { orgResolver, orgKey, primaryOrgName } = require('./orgs');

const s = (v) => String(v ?? '').trim();
const HANGUL = /[가-힣]/;
const mailKey = (v) => s(v).toLowerCase();
const telKey = (v) => { const d = s(v).replace(/\D/g, ''); return d.length >= 8 ? d.slice(-8) : ''; };
const koKey = (v) => s(v).replace(/\s/g, '');
/* 영문 이름은 순서·대소문자 무시 — «Hong Gildong» = «GILDONG HONG» */
const enKey = (v) => s(v).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
const nameKeys = (c) => [koKey(c.nameKo), enKey(c.nameEn)].filter(Boolean);
const orgKeys = (c) => [c.orgKo, c.orgEn].map((o) => orgKey(primaryOrgName(o))).filter(Boolean);

/* 이름이 맞나 — 한쪽에 이름이 없으면 맞다고 본다(메일·전화만으로 판단) */
function sameName(a, b){
  const ka = nameKeys(a), kb = nameKeys(b);
  if (!ka.length || !kb.length) return true;
  return ka.some((k) => kb.includes(k));
}

/* 빈 칸만 채울 수 있는 칸 — id·출처·날짜·상태는 처음 넣은 값을 지킨다 */
const FILLABLE = ['nameKo', 'nameEn', 'orgKo', 'orgEn', 'titleKo', 'titleEn', 'deptKo', 'deptEn', 'prefix',
  'country', 'email1', 'email2', 'phone1', 'phone2', 'beat', 'products', 'memo1', 'memo2', 'memo3', 'org_id'];
const INSERTABLE = ['nameKo', 'nameEn', 'orgKo', 'orgEn', 'titleKo', 'titleEn', 'deptKo', 'deptEn', 'prefix',
  'country', 'cat', 'lang', 'source', 'date', 'status', 'email1', 'email2', 'phone1', 'phone2',
  'beat', 'products', 'tags', 'org_id', 'memo1', 'memo2', 'memo3', 'origin'];

const kstDate = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

/* 한 칸에 국문·영문이 섞여 들어오면 제자리로 — 화면 업로드와 같은 처리 */
function tidy(raw){
  const v = {};
  Object.entries(raw || {}).forEach(([k, x]) => { if (x != null && s(x) !== '') v[k] = s(x); });
  for (const [ko, en] of [['nameKo', 'nameEn'], ['orgKo', 'orgEn'], ['titleKo', 'titleEn']]) {
    if (v[ko] && !HANGUL.test(v[ko]) && !v[en]) { v[en] = v[ko]; delete v[ko]; }
    if (v[en] && HANGUL.test(v[en]) && !v[ko]) { v[ko] = v[en]; delete v[en]; }
  }
  ['email1', 'email2'].forEach((k) => { if (v[k]) v[k] = v[k].toLowerCase(); });
  if (v.email2 && v.email2 === v.email1) delete v.email2;
  return v;
}

async function contactUpserter(client, { source = '', onSuspect = 'new', orgKind } = {}){
  const resolveOrg = await orgResolver(client, { source: source || '연락처 소속', ...(orgKind ? { kind: orgKind } : {}) });
  const nextId = await contactIdAllocator(client);
  const byMail = new Map(), byTel = new Map(), byName = new Map();
  const add = (m, k, c) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(c); };
  const index = (c) => {
    [c.email1, c.email2].map(mailKey).forEach((k) => add(byMail, k, c));
    [c.phone1, c.phone2].map(telKey).forEach((k) => add(byTel, k, c));
    nameKeys(c).forEach((k) => add(byName, k, c));
  };
  (await client.query(`SELECT * FROM contacts WHERE COALESCE(moved_to_id,'') = ''`)).rows.forEach(index);

  const stat = { created: 0, attached: 0, by: {}, suspects: [], skipped: 0, filled: 0 };

  /* 같은 사람 찾기 — { contact, by } 또는 { suspect } 또는 {} */
  function match(v){
    const mails = [v.email1, v.email2].map(mailKey).filter(Boolean);
    let other = null;
    for (const k of mails) for (const c of byMail.get(k) || []) {
      if (sameName(v, c)) return { contact: c, by: '메일' };
      other = other || c;
    }
    for (const k of [v.phone1, v.phone2].map(telKey).filter(Boolean)) {
      const c = (byTel.get(k) || []).find((x) => sameName(v, x) && nameKeys(v).length);
      if (c) return { contact: c, by: '전화' };
    }
    const names = nameKeys(v), orgs = orgKeys(v);
    const sameNamed = [...new Set(names.flatMap((k) => byName.get(k) || []))];
    if (orgs.length) {
      const c = sameNamed.find((x) => orgKeys(x).some((k) => orgs.includes(k)));
      if (c) return { contact: c, by: '이름+소속' };
    }
    if (other) return { suspect: other, why: '메일은 같은데 이름이 달라요' };
    if (sameNamed.length) return { suspect: sameNamed[0], why: '이름만 같아요' };
    return {};
  }

  /* 한 사람 넣기 → { id, created, by, suspect } (onSuspect:'skip'에서 건너뛰면 id가 '') */
  async function put(raw){
    const v = tidy(raw);
    if (!v.nameKo && !v.nameEn && !v.email1) throw new Error('이름도 메일도 없는 줄은 넣지 않아요');
    const m = match(v);
    if (m.suspect) {
      stat.suspects.push({ name: v.nameKo || v.nameEn, org: v.orgKo || v.orgEn, email: v.email1 || '',
        withId: m.suspect.id, withName: m.suspect.nameKo || m.suspect.nameEn, withOrg: m.suspect.orgKo || m.suspect.orgEn, why: m.why });
      if (onSuspect === 'skip') { stat.skipped++; return { id: '', created: false, by: '', suspect: m.suspect }; }
    }
    const hasOrg = v.orgKo || v.orgEn;
    if (hasOrg && !v.org_id) v.org_id = await resolveOrg(v.orgKo || '', v.orgEn || '');

    if (m.contact) {
      const c = m.contact, sets = [], args = [c.id];
      FILLABLE.forEach((col) => {
        if (v[col] && !s(c[col])) { args.push(v[col]); sets.push(`"${col}" = $${args.length}`); c[col] = v[col]; }
      });
      /* 메일·전화가 새로 왔는데 첫 칸이 차 있으면 둘째 칸에 — 잃지 않는다 */
      for (const [a, b, key] of [['email1', 'email2', mailKey], ['phone1', 'phone2', telKey]]) {
        const have = [c[a], c[b]].map(key);
        if (v[a] && !have.includes(key(v[a])) && !s(c[b]) && !sets.some((x) => x.startsWith(`"${b}"`))) {
          args.push(v[a]); sets.push(`"${b}" = $${args.length}`); c[b] = v[a];
        }
      }
      if (sets.length) { await client.query(`UPDATE contacts SET ${sets.join(', ')} WHERE id = $1`, args); stat.filled++; }
      index(c);
      stat.attached++; stat.by[m.by] = (stat.by[m.by] || 0) + 1;
      return { id: String(c.id), created: false, by: m.by, suspect: null };
    }

    const rec = { source, date: kstDate(), lang: HANGUL.test(v.nameKo || '') ? 'ko' : 'en', ...v, id: nextId() };
    const cols = ['id', ...INSERTABLE.filter((c) => rec[c] != null && rec[c] !== '')];
    await client.query(`INSERT INTO contacts (${cols.map((c) => `"${c}"`).join(',')})
      VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, cols.map((c) => rec[c]));
    index(rec);
    stat.created++;
    return { id: rec.id, created: true, by: '', suspect: m.suspect || null };
  }

  put.stat = stat;
  put.orgsCreated = resolveOrg.created;
  put.match = (raw) => match(tidy(raw));
  return put;
}

/* ── 넣은 뒤 점검 — 긴 id · 기업DB 미연결 · 같은 메일 두 명 ── */
async function checkContacts(client){
  const one = async (sql) => Number((await client.query(sql)).rows[0].n);
  return {
    longIds: await one(`SELECT count(*) n FROM contacts WHERE length(id::text) > 16`),
    unlinked: await one(`SELECT count(*) n FROM contacts
      WHERE COALESCE(trim("orgKo"),'') || COALESCE(trim("orgEn"),'') <> '' AND COALESCE(org_id,'') = ''
      AND COALESCE(moved_to_id,'') = ''`),
    sameMail: await one(`SELECT count(*) n FROM (SELECT lower(trim(email1)) e FROM contacts
      WHERE COALESCE(trim(email1),'') <> '' AND COALESCE(moved_to_id,'') = '' GROUP BY 1 HAVING count(*) > 1) x`),
  };
}

function printSummary(put, title){
  const st = put.stat;
  const by = Object.entries(st.by).map(([k, n]) => `${k} ${n}`).join(' · ');
  console.log(`\n── ${title} ──`);
  console.log(`새 연락처 ${st.created}명 · 기존에 붙임 ${st.attached}명${by ? ` (${by})` : ''} · 빈 칸 채움 ${st.filled}명`);
  console.log(`기업DB에 새로 만든 기업 ${put.orgsCreated.length}곳${put.orgsCreated.length ? ': ' + put.orgsCreated.slice(0, 15).map((o) => o.name_ko || o.name_en).join(', ') + (put.orgsCreated.length > 15 ? ' …' : '') : ''}`);
  if (st.suspects.length) {
    console.log(`⚠️ 같은 사람인지 확인할 ${st.suspects.length}명 (${st.skipped ? '건너뜀' : '새 사람으로 넣음 — 같으면 화면 «중복 찾기»로 합치기'}):`);
    st.suspects.slice(0, 30).forEach((x) => console.log(`   ${x.name} (${x.org || '-'}) ≈ ${x.withName} (${x.withOrg || '-'}) #${x.withId} — ${x.why}`));
    if (st.suspects.length > 30) console.log(`   … 외 ${st.suspects.length - 30}명`);
  }
}

/* 스크립트 틀 — 한 트랜잭션, 기본 시험 실행, --apply면 저장, 끝에 점검 */
async function runImport({ name = '가져오기', source = '', onSuspect, orgKind, apply = process.argv.includes('--apply') } = {}, body){
  require('dotenv').config();
  const pool = require('./pool');
  const client = await pool.connect();
  let ok = false;
  try {
    await client.query('BEGIN');
    const put = await contactUpserter(client, { source, onSuspect, orgKind });
    const out = await body({ client, put });
    printSummary(put, `${name}${apply ? '' : ' (시험 실행 — 저장 안 함, 저장하려면 --apply)'}`);
    const chk = await checkContacts(client);
    console.log(`점검: 긴 id ${chk.longIds} · 기업DB 미연결 ${chk.unlinked}명 · 같은 메일 두 명 이상 ${chk.sameMail}건`);
    if (chk.longIds) throw new Error('16자리를 넘는 id가 생겼어요 — 되돌립니다');
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    ok = true;
    if (apply) console.log('✅ 저장했어요');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ 아무것도 바뀌지 않았어요 —', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
    if (!ok) process.exitCode = 1;
  }
}

/* node db/contact-upsert.js — 점검만 한다(아무것도 바꾸지 않음) */
if (require.main === module) (async () => {
  require('dotenv').config();
  const pool = require('./pool');
  const c = await checkContacts(pool);
  console.log(`긴 id ${c.longIds} · 기업DB 미연결 ${c.unlinked}명 · 같은 메일 두 명 이상 ${c.sameMail}건`);
  if (c.longIds) console.log('→ node db/fix-unsafe-contact-ids.js (시험) → --apply');
  if (c.unlinked) console.log('→ 화면 Master DB «기업DB 미연결» 칩 → «기업DB에 연결»');
  if (c.sameMail) console.log('→ 화면 행사 DB «중복 찾기» 또는 Master DB에서 두 명 골라 합치기');
  await pool.end();
})();

module.exports = { contactUpserter, checkContacts, runImport, printSummary, telKey, enKey };
