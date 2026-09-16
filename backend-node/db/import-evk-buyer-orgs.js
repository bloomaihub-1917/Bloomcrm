/* 바이어 명단의 기관을 기업DB에 등록한다.

   셀러는 업로드를 거쳐 기업DB에 들어와 있었지만 바이어 192곳은 한 곳도 없다.
   그래서 «채운다»가 아니라 «만든다» — 대분류(A)를 섹터로, 비고(J)를 기업
   메모로 함께 넣는다. 담당자는 여기서 만들지 않는다(연락처는 업로드 화면이
   이름·이메일·중복까지 보고 판단한다). 나중에 명단을 업로드하면 이름으로
   이 기업들을 찾아 붙으므로 같은 회사가 둘이 되지는 않는다.

   이미 같은 이름의 기업이 있으면 건드리지 않는다 — 셀러와 겹치는 곳이 있고,
   그쪽은 이미 제 섹터를 갖고 있다.

     node db/import-evk-buyer-orgs.js <엑셀경로> [--dry]                     */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const FILE = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!FILE) { console.error('엑셀 경로를 주세요.'); process.exit(1); }

/* 업로드 쪽 SECTOR_ALIASES(js/modules/upload-tab.js)의 바이어 부분과 같은 내용 */
const ALIASES = {
  '지자체': '지방자치단체',
  '협∙단체': '협∙단체', '협·단체': '협∙단체', '협.단체': '협∙단체',
  '협회': '협∙단체', '학회': '협∙단체', '체육단체': '협∙단체',
  '대학': '대학교', '학교(대학)': '대학교',
  '민간기업': '기업', '기업(단독행사주최기업)': '기업',
};
const norm = (v) => {
  const t = String(v || '').trim();
  return ALIASES[t] || t;
};

const key = (v) => String(v || '').trim().toLowerCase()
  .replace(/㈜|\(주\)|주식회사|\(유\)|유한회사/g, '')
  .replace(/\s+/g, '');

const isKo = (v) => /[가-힣]/.test(String(v || ''));

/* 약어 — 기업DB 목록의 아바타에 쓰인다(두 글자) */
const abbrOf = (nm) => String(nm || '').trim().slice(0, 2);

(async () => {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(FILE);
  const ws = wb.Sheets['종합_바이어'];
  if (!ws) { console.error('«종합_바이어» 시트가 없습니다.'); process.exit(1); }
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const wanted = new Map();   // 이름키 → { name, sector, notes }
  for (const r of rows) {
    const name = String(r['기관/기업/단체명'] || '').trim();
    if (!name) continue;
    const sector = norm(r['대분류']);
    const notes = String(r['비고'] || '').trim();
    const cur = wanted.get(key(name));
    if (!cur) { wanted.set(key(name), { name, sector, notes }); continue; }
    // 같은 기관이 여러 줄로 오면(부서가 다른 경우) 비어 있는 칸만 채운다
    if (!cur.sector && sector) cur.sector = sector;
    if (!cur.notes && notes) cur.notes = notes;
  }
  console.log(`명단에서 읽은 기관 ${wanted.size}곳`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const known = new Set((await client.query(`SELECT name FROM sectors`)).rows.map((r) => r.name));
    const unknown = [...new Set([...wanted.values()].map((v) => v.sector))]
      .filter((s) => s && !known.has(s));
    if (unknown.length) {
      throw new Error(`표준 섹터에 없는 대분류: ${unknown.join(' · ')}\n`
        + `  db/seed-evk-sectors.js를 먼저 돌려주세요.`);
    }

    const { rows: orgs } = await client.query(`SELECT id, name_ko, name_en FROM orgs`);
    const have = new Set();
    orgs.forEach((o) => { have.add(key(o.name_ko)); have.add(key(o.name_en)); });

    const made = []; const skipped = [];
    const now = new Date().toISOString();
    let seq = 0;

    for (const [k, v] of wanted) {
      if (have.has(k)) { skipped.push(v.name); continue; }
      const id = `O-${Date.now()}_b${seq++}`;
      await client.query(
        `INSERT INTO orgs (id, name_ko, name_en, abbr, aliases, kind, status, sectors,
                           country, hq, website, biz_no, cat_code, notes, products,
                           source, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'','잠재고객사','활성',$5,'','','','','',$6,'', '바이어 명단',$7,$7)`,
        [id, isKo(v.name) ? v.name : '', isKo(v.name) ? '' : v.name,
         abbrOf(v.name), v.sector || '', v.notes || '', now]);
      made.push(v);
    }

    const by = made.reduce((m, v) => m.set(v.sector || '(대분류 없음)',
      (m.get(v.sector || '(대분류 없음)') || 0) + 1), new Map());
    console.log(`\n새로 등록한 기관 ${made.length}곳`);
    [...by].sort((a, b) => b[1] - a[1]).forEach(([s, n]) => console.log(`   ${String(n).padStart(3)}  ${s}`));
    console.log(`   (비고를 기업 메모로 옮긴 곳 ${made.filter((v) => v.notes).length}곳)`);
    if (skipped.length) {
      console.log(`\n이미 기업DB에 있어 건너뛴 ${skipped.length}곳: `
        + skipped.slice(0, 10).join(' · ') + (skipped.length > 10 ? ' …' : ''));
    }

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
