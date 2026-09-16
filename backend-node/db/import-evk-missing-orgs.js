/* 명단에는 있는데 기업DB에 없는 회사를 만든다.

   셀러 명단 344곳 중 44곳이 기업DB에 없다. 처음 업로드 때 들어오지 않은
   곳들이라 섹터도 품목도 대표번호도 붙일 데가 없었다 — 명단에는 멀쩡히
   적혀 있는데 CRM에서는 존재하지 않는 회사다.

   시트가 알려주는 것을 한 번에 다 넣는다. 대분류→섹터, 카테고리→취급 품목,
   비고→기업 메모, 그리고 담당자 이름이 없는 줄이면 번호와 메일을 기업의
   대표 연락처로.

   이미 있는 이름은 건드리지 않는다. 기업 유형은 시트로 나눈다 —
   셀러는 우리가 사서 쓰는 쪽(벤더시공사), 바이어는 발주하는 쪽(잠재고객사).

     node db/import-evk-missing-orgs.js <엑셀경로> [--dry]                   */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const FILE = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!FILE) { console.error('엑셀 경로를 주세요.'); process.exit(1); }

/* 업로드 쪽 SECTOR_ALIASES(js/modules/upload-tab.js)와 같은 내용 */
const ALIASES = {
  '전시부스/무대/구조물': '부스/무대/구조물', '베뉴(대관사)': '베뉴',
  '이벤트부스': '이벤트 부스', '프리렌서': '프리랜서', '동역': '통역',
  '기타': '이벤트·MICE 기타',
  '지자체': '지방자치단체',
  '협·단체': '협∙단체', '협.단체': '협∙단체',
  '협회': '협∙단체', '학회': '협∙단체', '체육단체': '협∙단체',
  '대학': '대학교', '학교(대학)': '대학교',
  '민간기업': '기업', '기업(단독행사주최기업)': '기업',
};
const clean = (v) => String(v == null ? '' : v).trim();
const real = (v) => {
  const t = clean(v);
  return (!t || t === '*' || t === '-' || t === 'N/A') ? '' : t;
};
const key = (v) => clean(v).toLowerCase()
  .replace(/㈜|\(주\)|주식회사|\(유\)|유한회사/g, '').replace(/\s+/g, '');
const isKo = (v) => /[가-힣]/.test(String(v || ''));

const SHEETS = [
  { name: '종합_셀러',  org: '기업명',           kind: '벤더시공사',
    phone: '핸드폰 번호', products: '카테고리', source: '셀러 명단' },
  /* 바이어의 기타는 기관 유형의 기타라 공통 쪽을 쓴다 — 셀러의 기타(야광맨·
     한복처럼 이벤트 현장 업종)와는 다른 말이다. */
  { name: '종합_바이어', org: '기관/기업/단체명', kind: '잠재고객사',
    phone: '일반번호',    products: null,       source: '바이어 명단', plainEtc: true },
];

(async () => {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(FILE);

  const wanted = new Map();
  for (const sh of SHEETS) {
    const ws = wb.Sheets[sh.name];
    if (!ws) { console.error(`«${sh.name}» 시트가 없습니다.`); continue; }
    for (const r of XLSX.utils.sheet_to_json(ws, { defval: '' })) {
      const name = clean(r[sh.org]);
      if (!name) continue;
      const raw = clean(r['대분류']);
      const sector = (sh.plainEtc && raw === '기타') ? '기타' : (ALIASES[raw] || raw);
      const named = !!clean(r['성함']);
      const row = {
        name, kind: sh.kind, source: sh.source, sector,
        products: sh.products ? clean(r[sh.products]) : '',
        notes: clean(r['비고']),
        // 이름이 있는 줄의 번호는 그 사람의 것이다 — 기업에 올리지 않는다
        phone: named ? '' : real(r[sh.phone]),
        email: named ? '' : real(r['메일']),
      };
      const cur = wanted.get(key(name));
      if (!cur) { wanted.set(key(name), row); continue; }
      for (const f of ['sector', 'products', 'notes', 'phone', 'email']) {
        if (!cur[f] && row[f]) cur[f] = row[f];
      }
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const known = new Set((await client.query(`SELECT name FROM sectors`)).rows.map((r) => r.name));
    const unknown = [...new Set([...wanted.values()].map((v) => v.sector))]
      .filter((s) => s && !known.has(s));
    if (unknown.length) throw new Error(`표준 섹터에 없는 대분류: ${unknown.join(' · ')}`);

    const have = new Set();
    (await client.query(`SELECT name_ko, name_en FROM orgs`)).rows.forEach((o) => {
      have.add(key(o.name_ko)); have.add(key(o.name_en));
    });

    const made = [];
    const now = new Date().toISOString();
    let seq = 0;
    for (const [k, v] of wanted) {
      if (have.has(k)) continue;
      await client.query(
        `INSERT INTO orgs (id, name_ko, name_en, abbr, aliases, kind, status, sectors,
                           country, hq, website, biz_no, cat_code, notes, products,
                           phone, email, source, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'',$5,'활성',$6,'','','','','',$7,$8,$9,$10,$11,$12,$12)`,
        [`O-${Date.now()}_m${seq++}`,
         isKo(v.name) ? v.name : '', isKo(v.name) ? '' : v.name, v.name.slice(0, 2),
         v.kind, v.sector || '', v.notes, v.products, v.phone, v.email, v.source, now]);
      made.push(v);
    }

    const by = made.reduce((m, v) => m.set(v.source, (m.get(v.source) || 0) + 1), new Map());
    console.log(`새로 만든 기업 ${made.length}곳`);
    [...by].forEach(([s, n]) => console.log(`   ${String(n).padStart(3)}  ${s}`));
    console.log(`   섹터 ${made.filter((v) => v.sector).length} · 품목 ${made.filter((v) => v.products).length}`
      + ` · 메모 ${made.filter((v) => v.notes).length} · 대표전화 ${made.filter((v) => v.phone).length}`
      + ` · 대표메일 ${made.filter((v) => v.email).length}`);
    made.slice(0, 6).forEach((v) => console.log(`   + ${v.name} (${v.sector || '섹터 없음'})`));
    if (made.length > 6) console.log(`   … 외 ${made.length - 6}곳`);

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
