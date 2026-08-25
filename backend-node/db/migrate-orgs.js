/* ══════════════════════════════════════════════════════════════
   migrate-orgs.js — 이름으로 흩어져 있던 기업을 orgs 레코드로 모은다

   지금 기업은 세 곳에 이름 문자열로만 존재한다.
     contacts.orgKo/orgEn  — 화면의 기업 목록이 실제로 파생되는 곳
     companies             — 거기에 섹터·메모를 덧칠하던 오버레이(키 = 정규화된 이름)
     exhibitors.company_key — 전시 탭이 따로 들고 있던 목록

   셋을 정규화된 이름으로 묶어 orgs 한 줄씩 만들고, contacts.org_id와
   exhibitors.org_id를 채운다. 서로 다른 이름이 같은 회사로 밝혀지면
   (이름 변경 등) 옛 이름은 orgs.aliases에 남겨 이력이 끊기지 않게 한다.

   여러 번 돌려도 안전하다 — 이미 org_id가 붙은 행은 건드리지 않는다.
   실제 반영 없이 결과만 보려면: node db/migrate-orgs.js --dry
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

/* 프론트(company-tab.js:normalizeCompanyKey)와 반드시 같은 결과를 내야 한다 —
   기존 companies.key가 이 규칙으로 만들어져 있어, 다르면 오버레이를 못 찾는다. */
function normalizeCompanyKey(raw){
  if(!raw) return '';
  let s = String(raw).trim();
  s = s.replace(/^(주식회사|㈜|\(주\))\s*/, '').replace(/\s*(주식회사|㈜|\(주\))$/, '');
  s = s.replace(/[\s,\.]*\b(incorporated|inc|co\.?,?\s*(ltd|limited)|ltd|limited|co|llc|llp|corp(oration)?|gmbh|pte\.?\s*ltd|pty\.?\s*ltd|plc)\b\.?\s*$/i, '');
  s = s.replace(/[.,]/g, '').replace(/\s+/g, '').trim().toLowerCase();
  return s;
}

/* 이름 변경으로 키가 갈라진 건을 잇는다. 자동으로는 알아낼 수 없어서
   (문자열이 전혀 다르다) 확인된 것만 여기 적는다. */
const RENAMES = [
  // 2026 KIC 준비 중 사명이 바뀌었다. 섹터·메모를 담은 오버레이가 옛 키에 남아
  // 화면에서 사라져 있었다 — 새 회사로 합치고 옛 이름은 alias로 남긴다.
  { from: '압타머사이언스cro센터', to: '츌립앤사이언스씨알오(cro)센터' },
];

const nowIso = () => new Date().toISOString();

/* O-00001 형태의 안정 id. 이름이 바뀌어도 이 값은 그대로다. */
const orgId = (n) => 'O-' + String(n).padStart(5, '0');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const [companies, contacts, exhibitors] = await Promise.all([
      client.query('SELECT * FROM companies'),
      client.query('SELECT id, "orgKo", "orgEn", country, beat, source, org_id FROM contacts'),
      client.query('SELECT id, company_key, company_name, org_id FROM exhibitors'),
    ]).then((r) => r.map((x) => x.rows));

    // 이름 변경 매핑 — 옛 키를 새 키로 읽는다
    const renameTo = new Map(RENAMES.map((r) => [r.from, r.to]));
    const canon = (k) => renameTo.get(k) || k;
    const oldKeys = new Set(RENAMES.map((r) => r.from));
    const isOldName = (n) => oldKeys.has(normalizeCompanyKey(n));

    /* ── 1) 세 소스를 정규화 키로 모은다 ── */
    const bucket = new Map();   // 정규화 키 → 모아둔 재료
    const take = (rawName) => {
      const raw = String(rawName || '').trim();
      if(!raw) return null;
      const key = canon(normalizeCompanyKey(raw) || raw.toLowerCase());
      if(!bucket.has(key)) bucket.set(key, { key, names: new Map(), company: null, contacts: [], exhibitors: [] });
      const b = bucket.get(key);
      b.names.set(raw, (b.names.get(raw) || 0) + 1);   // 가장 많이 쓰인 표기를 대표 이름으로
      return b;
    };

    companies.forEach((c) => {
      const b = take(c.nameKo || c.nameEn || c.key);
      if(b) b.company = c;
      else {
        // 이름 필드가 비어 키만 있는 오버레이도 버리지 않는다
        const key = canon(c.key);
        if(!bucket.has(key)) bucket.set(key, { key, names: new Map(), company: null, contacts: [], exhibitors: [] });
        bucket.get(key).company = c;
      }
    });
    contacts.forEach((c) => { const b = take(c.orgKo || c.orgEn); if(b) b.contacts.push(c); });
    exhibitors.forEach((x) => { const b = take(x.company_name || x.company_key); if(b) b.exhibitors.push(x); });

    /* ── 2) orgs 레코드로 만든다 ── */
    const existing = (await client.query('SELECT id, aliases FROM orgs')).rows;
    let seq = existing.length;
    const rows = [];
    const linkContacts = [];
    const linkExhibitors = [];

    for(const b of bucket.values()){
      const co = b.company;
      /* 대표 이름은 "현재 이름"이어야 한다. 이름이 바뀐 회사는 옛 이름도 같은
         바구니에 들어와 있고, 옛 오버레이(companies)가 옛 이름을 들고 있어서
         그냥 쓰면 바꾸기 전 이름으로 되돌아간다. 걸러야 할 건 "옛 이름"이지
         "다른 언어의 이름"이 아니다 — 국문 키로 묶인 회사의 영문명은 당연히
         키와 다르게 정규화되므로, 키와 대조하는 방식으로 거르면 영문명이 통째로
         날아간다(실제로 51개 전부 그렇게 잃었다). RENAMES에 적힌 옛 이름만 뺀다. */
      const pick = (vals) => vals.find((v) => v && !isOldName(v)) || '';
      const ko = pick([co?.nameKo, ...b.contacts.map((c) => c.orgKo)])
        || [...b.names.entries()].filter(([n]) => !isOldName(n)).sort((a, c) => c[1] - a[1])[0]?.[0]
        || b.key;
      const en = pick([co?.nameEn, ...b.contacts.map((c) => c.orgEn)]);
      const topName = ko;

      // 옛 이름 + 표기 흔들림을 alias로 모은다(대표 이름 자체는 제외)
      const aliases = new Set();
      b.names.forEach((_, n) => { if(n !== ko && n !== en) aliases.add(n); });
      RENAMES.filter((r) => r.to === b.key).forEach((r) => {
        const old = companies.find((c) => c.key === r.from);
        if(old && (old.nameKo || old.nameEn)) aliases.add(old.nameKo || old.nameEn);
      });

      // 전시에 등록돼 있으면 참가기업, 아니면 아직 영업 대상으로 본다.
      // 벤더·시공사는 사람이 판단할 문제라 자동으로 붙이지 않는다.
      const kind = b.exhibitors.length ? '전시참가기업' : '잠재고객사';

      const id = orgId(++seq);
      rows.push({
        id,
        name_ko: ko, name_en: en,
        abbr: co?.abbr || '',
        aliases: [...aliases].join('\n'),
        kind, status: '활성',
        sectors: co?.sector || b.contacts.find((c) => c.beat)?.beat || '',
        country: co?.country || b.contacts.find((c) => c.country)?.country || '',
        hq: co?.hq || '',
        website: co?.website || '',
        biz_no: '',
        cat_code: co?.catCode || '',
        notes: co?.notes || '',
        source: co?.source || b.contacts.find((c) => c.source)?.source || '',
        created_at: nowIso(),
        updated_at: co?.updatedAt || nowIso(),
      });
      b.contacts.forEach((c) => { if(!c.org_id) linkContacts.push([c.id, id]); });
      b.exhibitors.forEach((x) => { if(!x.org_id) linkExhibitors.push([x.id, id]); });
    }

    console.log(`기업 ${rows.length}개로 정리`);
    console.log(`  연락처 연결 ${linkContacts.length}건 / 전시 연결 ${linkExhibitors.length}건`);
    const merged = rows.filter((r) => r.aliases);
    if(merged.length){
      console.log('  옛 이름을 함께 묶은 기업:');
      merged.forEach((r) => console.log(`    ${r.name_ko}  ←  ${r.aliases.split('\n').join(', ')}`));
    }
    const byKind = {};
    rows.forEach((r) => { byKind[r.kind] = (byKind[r.kind] || 0) + 1; });
    console.log('  종류별:', JSON.stringify(byKind));

    if(DRY){
      await client.query('ROLLBACK');
      console.log('\n--dry 라서 되돌렸습니다. 실제 반영하려면 옵션 없이 다시 실행하세요.');
      return;
    }

    const COLS = ['id','name_ko','name_en','abbr','aliases','kind','status','sectors','country','hq',
      'website','biz_no','cat_code','notes','source','created_at','updated_at'];
    for(const r of rows){
      await client.query(
        `INSERT INTO orgs (${COLS.map((c) => `"${c}"`).join(',')})
         VALUES (${COLS.map((_, i) => `$${i + 1}`).join(',')})
         ON CONFLICT (id) DO NOTHING`,
        COLS.map((c) => r[c]));
    }
    for(const [cid, oid] of linkContacts)   await client.query('UPDATE contacts SET org_id=$2 WHERE id=$1', [cid, oid]);
    for(const [xid, oid] of linkExhibitors) await client.query('UPDATE exhibitors SET org_id=$2 WHERE id=$1', [xid, oid]);

    await client.query('COMMIT');
    console.log('\n반영 완료.');
  } catch(e){
    await client.query('ROLLBACK');
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
