/* ══════════════════════════════════════════════════════════════
   import-bio-agencies.js — 바이오 유관기관 명단을 기업DB에 넣는다

   «유관기관.xlsx» 한 장에 기관과 담당자가 같이 들어 있다. 한 행이 한 기관이
   아니라 담당자 수만큼 늘어난 표다 — 국립암센터가 3행, 한국생명공학연구원이
   4행. 그래서 기관(orgs)과 담당자(contacts)로 갈라 넣는다.

   두 겹으로 분류한다.
     섹터 — 기관의 성격(공공기관·협∙단체·정부기관…). 명단에 없어서 이름으로 짚는다.
     분야 — 전부 «바이오·임상». 섹터가 속한 도메인이 곧 분야라, 성격 섹터
            (공통 도메인)만 달면 분야 필터에서 바이오로 안 잡힌다. 그래서
            화면의 분야 지정 버튼과 같은 방식으로 «바이오·임상 업종 미정»을
            함께 단다(company-tab.js assignCoDomain).

   이렇게 두면 «공공기관»으로도, «바이오·임상»으로도 같은 기관이 잡힌다 —
   메일링 대상을 고를 때 성격과 분야 중 아무 쪽으로 좁혀도 된다.

   이미 있는 기관은 이름·종류·섹터를 건드리지 않는다. 사람이 손으로 정해 둔
   값이 있을 수 있어서다 — 분야만 없으면 더하고, 담당자를 붙인다.

     node db/import-bio-agencies.js <엑셀경로> [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const FILE = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!FILE) { console.error('엑셀 경로를 주세요.'); process.exit(1); }

const KIND = '유관기관';
const DOMAIN_SECTOR = '바이오·임상 업종 미정';   // 분야를 다는 자리
const TODAY = new Date().toISOString().slice(0, 10);

/* 같은 기관이 오타로 둘이 된 것들 — 명단에 나란히 있다.
   그대로 넣으면 기관이 갈리고 담당자도 나뉜다. */
const TYPO = {
  '한국보건의료연구워': '한국보건의료연구원',
  '한국과학기정보술연구원': '한국과학기술정보연구원',
  '안정성평가연구소': '안전성평가연구소',
};

/* 한 칸에 두 사람이 들어 있는 곳 — 연락처는 하나뿐이라 앞사람에게만 준다.
   뒷사람은 이름·부서만 남긴다(연락처를 복사하면 둘 다 틀린 값이 된다). */
const splitNames = (v) => String(v || '').split(/\s*[,/]\s*/).map((s) => s.trim()).filter(Boolean);

/* 기관 성격 — 이름으로 짚는다. 앞의 규칙이 이긴다(«국립암센터»는 공공기관이지
   연구소가 아니다). 하나도 안 걸리면 넣지 않고 멈춘다 — 조용히 «기타»로
   떨어뜨리면 그 뒤로 아무도 다시 안 본다. */
function sectorOf(name) {
  const n = name.replace(/\s+/g, '');
  if (/(부|처|청)$/.test(n) || n === '질병관리본부') return '정부기관';
  if (/(학회|협회|약사회|의사회|연구조합|협동조합)/.test(n)) return '협∙단체';
  if (/재단$|재단법인|테크노밸리/.test(n)) return '재단법인';
  if (/^국립/.test(n)
    || ['건강보험심사평가원', '한국의약품안전관리원', '한국보건의료연구원', '한국보건복지인재원'].includes(n))
    return '공공기관';
  if (/(진흥원|진흥재단|테크노파크|연구원|연구소|연구회|연구센터|의학원|지원재단|개발재단)/.test(n))
    return '정부산하기관';
  return '';
}

const key = (v) => String(v || '').trim().toLowerCase()
  .replace(/㈜|\(주\)|주식회사|\(사\)|사단법인|재단법인/g, '').replace(/\s+/g, '');

const abbrOf = (nm) => String(nm || '').trim().slice(0, 2);

(async () => {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(FILE);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

  /* ── 1. 엑셀을 기관 → 담당자로 접는다 ── */
  const orgs = new Map();          // 이름키 → { name, sector, people: [] }
  const unknown = [];
  for (const r of rows) {
    const raw = String(r.orgko || '').trim();
    if (!raw) continue;
    const name = TYPO[raw] || raw;
    const k = key(name);
    if (!orgs.has(k)) {
      const sector = sectorOf(name);
      if (!sector) unknown.push(name);
      orgs.set(k, { name, sector, people: [] });
    }
    const o = orgs.get(k);
    const names = splitNames(r.nameko);
    names.forEach((nm, i) => o.people.push({
      name: nm,
      dept: String(r.deptko || '').trim(),
      email: i === 0 ? String(r.email || '').trim() : '',
      phone: i === 0 ? String(r.phone || '').trim() : '',
      country: String(r.country || '').trim() || '한국',
      source: String(r.source || '').trim(),
    }));
  }

  if (unknown.length) {
    console.error(`성격을 못 짚은 기관 ${unknown.length}곳 — 규칙을 고쳐 주세요:`);
    unknown.forEach((n) => console.error('   ', n));
    process.exit(1);
  }

  const list = [...orgs.values()];
  const people = list.flatMap((o) => o.people);
  console.log(`엑셀 ${rows.length}행 → 기관 ${list.length}곳 · 담당자 ${people.length}명`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* 분야를 다는 섹터가 없으면 만든다 — 화면 분야 버튼이 쓰는 그 자리다 */
    const secHave = await client.query(`SELECT id FROM sectors WHERE name = $1`, [DOMAIN_SECTOR]);
    if (!secHave.rows.length) {
      await client.query(
        `INSERT INTO sectors (id, name, parent, domain, canonical) VALUES ($1, $2, '', 'bio', '')`,
        ['bio-미정', DOMAIN_SECTOR]);
      console.log(`섹터 «${DOMAIN_SECTOR}» 새로 만듦`);
    }

    const have = new Map((await client.query('SELECT id, name_ko, sectors, kind FROM orgs')).rows
      .map((r) => [key(r.name_ko), r]));
    const mails = new Set((await client.query(
      `SELECT lower(email1) e FROM contacts WHERE COALESCE(email1,'') <> ''`)).rows.map((r) => r.e));

    let made = 0; let domainAdded = 0; let kept = 0;
    let seq = 0;
    const stamp = Date.now();

    for (const o of list) {
      const exist = have.get(key(o.name));

      if (exist) {
        /* 있는 기관 — 이름·종류·성격 섹터는 그대로 두고 분야만 채운다 */
        const cur = String(exist.sectors || '').split('|').map((s) => s.trim()).filter(Boolean);
        if (!cur.includes(DOMAIN_SECTOR)) {
          await client.query(`UPDATE orgs SET sectors = $2, updated_at = $3 WHERE id = $1`,
            [exist.id, [...cur, DOMAIN_SECTOR].join('|'), TODAY]);
          domainAdded++;
        } else kept++;
        o.id = exist.id;
        o.wasThere = true;
        continue;
      }

      o.id = `O-${stamp}_bio${++seq}`;
      await client.query(
        `INSERT INTO orgs (id, name_ko, name_en, abbr, aliases, kind, status, sectors,
                           country, hq, website, biz_no, cat_code, notes, source,
                           created_at, updated_at, products, phone, email)
         VALUES ($1,$2,'',$3,'',$4,'활성',$5,'한국','','','','','',$6,$7,$7,'','','')`,
        [o.id, o.name, abbrOf(o.name), KIND, `${o.sector}|${DOMAIN_SECTOR}`,
          o.people[0]?.source || '바이오코리아', TODAY]);
      made++;
    }

    /* ── 2. 담당자 ── 이름이 없는 줄은 기관만 만들고 넘어간다 */
    let cMade = 0; let cSkip = 0;
    for (const o of list) {
      for (const p of o.people) {
        if (!p.name) continue;
        if (p.email && mails.has(p.email.toLowerCase())) { cSkip++; continue; }
        if (p.email) mails.add(p.email.toLowerCase());
        await client.query(
          `INSERT INTO contacts (id, "nameKo", "nameEn", "orgKo", "orgEn", "titleKo", "titleEn",
                                 "deptKo", "deptEn", country, cat, lang, source, date, status,
                                 email1, email2, phone1, phone2, beat, products, tags, org_id)
           VALUES ($1,$2,'',$3,'','','',$4,'',$5,'bd','KO',$6,$7,'new',$8,'',$9,'','','','',$10)`,
          [`${stamp}${String(++seq).padStart(4, '0')}`, p.name, o.name, p.dept,
            p.country, p.source, TODAY, p.email, p.phone, o.id]);
        cMade++;
      }
    }

    console.log(`\n기관 — 새로 ${made}곳 · 분야만 더함 ${domainAdded}곳 · 이미 갖춤 ${kept}곳`);
    console.log(`담당자 — 새로 ${cMade}명${cSkip ? ` · 이메일 중복 건너뜀 ${cSkip}명` : ''}`);

    const bySector = {};
    list.forEach((o) => { bySector[o.sector] = (bySector[o.sector] || 0) + 1; });
    Object.entries(bySector).sort((a, b) => b[1] - a[1])
      .forEach(([s, c]) => console.log(`   ${String(c).padStart(3)}  ${s}`));

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
