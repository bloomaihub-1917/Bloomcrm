/* 셀러 명단의 대분류·카테고리를 이미 등록된 기업에 채운다.
   대분류(A) → 섹터, 카테고리(B) → 취급 품목.

   셀러 344곳이 업로드될 때 대분류 열이 섹터로 잡히지 않아, 나중에 분야별
   보기에서 통째로 끌어다 «업종은 나중에»로 넣은 상태였다. 그래서 301곳이
   «이벤트·MICE 업종 미정» 한 칸에 몰려 있었다 — 파일에는 영상·음향·대행사로
   갈라져 있는데 DB에서는 하나로 뭉쳐 있었다.

   명단을 다시 읽어 기업 이름으로 맞춘다. 표기 흔들림과 오타는 업로드 쪽과
   같은 대응표로 접는다(이벤트부스→이벤트 부스, 프리렌서→프리랜서, 동역→통역).

   이미 «업종 미정»이 아닌 섹터가 붙어 있거나 취급 품목이 적혀 있는 기업은
   건드리지 않는다 — 손으로 골라 둔 값이 명단의 원문보다 정확할 가능성이 높다.

   카테고리는 orgs.products에 넣는다. 담당자가 아직 없는 회사가 대부분이라
   연락처의 전시품목 칸에는 담을 수가 없고, 애초에 품목은 사람이 아니라 회사에
   붙는 값이다(db/add-org-products.js 참고).

   비고(J열)는 손대지 않는다 — 업로드 때 이미 기업 메모(orgs.notes)에 들어갔다.

     node db/fill-evk-seller-sectors.js <엑셀경로> [--dry]                   */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const FILE = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!FILE) { console.error('엑셀 경로를 주세요.'); process.exit(1); }

/* 업로드 쪽 SECTOR_ALIASES(js/modules/upload-tab.js)와 같은 내용 */
const ALIASES = {
  '전시부스/무대/구조물': '부스/무대/구조물',
  '베뉴(대관사)': '베뉴',
  '이벤트부스': '이벤트 부스',
  '프리렌서': '프리랜서',
  '동역': '통역',
  /* 셀러 명단의 «기타»는 야광맨·한복·전기처럼 이벤트 현장에서 쓰는 업종이지
     분야를 넘나드는 기타가 아니다. 공통의 «기타»에 넣으면 이벤트·MICE를
     눌렀을 때 그 회사들이 빠진다. */
  '기타': '이벤트·MICE 기타',
};
const norm = (v) => {
  const t = String(v || '').trim();
  return ALIASES[t] || t;
};

/* 기업 이름 맞추기 — 앞뒤 공백·대소문자·㈜ 같은 장식만 털어낸다.
   이보다 더 느슨하게 맞추면 다른 회사에 남의 값을 붙이게 된다. */
const key = (v) => String(v || '').trim().toLowerCase()
  .replace(/㈜|\(주\)|주식회사|\(유\)|유한회사/g, '')
  .replace(/\s+/g, '');

(async () => {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(FILE);
  const ws = wb.Sheets['종합_셀러'];
  if (!ws) { console.error('«종합_셀러» 시트가 없습니다.'); process.exit(1); }
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const wanted = new Map();   // 이름키 → { name, sector, products }
  for (const r of rows) {
    const name = String(r['기업명'] || '').trim();
    const sector = norm(r['대분류']);
    const products = String(r['카테고리'] || '').trim();
    if (!name || (!sector && !products)) continue;
    if (!wanted.has(key(name))) wanted.set(key(name), { name, sector, products });
  }
  console.log(`명단에서 읽은 기업 ${wanted.size}곳`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* 섹터 이름이 표준 목록에 있는지 먼저 확인한다 — 목록에 없는 값을 넣으면
       분야별 보기에서 미분류로 떨어지고, 그때부터 아무도 다시 안 본다. */
    const known = new Set((await client.query(`SELECT name FROM sectors`)).rows.map((r) => r.name));
    const unknown = [...new Set([...wanted.values()].map((v) => v.sector))]
      .filter((s) => s && !known.has(s));
    if (unknown.length) {
      throw new Error(`표준 섹터에 없는 대분류: ${unknown.join(' · ')}\n`
        + `  db/seed-evk-sectors.js를 먼저 돌리거나 대응표를 고쳐주세요.`);
    }

    const { rows: orgs } = await client.query(
      `SELECT id, name_ko, name_en, COALESCE(sectors,'') sectors,
              COALESCE(products,'') products FROM orgs`);

    const filled = []; const gotProducts = []; const kept = []; const missed = [];
    const seen = new Set();

    for (const o of orgs) {
      const hit = wanted.get(key(o.name_ko)) || wanted.get(key(o.name_en));
      if (!hit) continue;
      seen.add(key(hit.name));

      const takeSector = !!hit.sector
        && (!o.sectors || o.sectors.includes('업종 미정'))
        && o.sectors !== hit.sector;
      const takeProducts = !!hit.products && !o.products;
      if (!takeSector && !takeProducts) { kept.push({ o, hit }); continue; }

      const sets = []; const vals = [o.id];
      if (takeSector)   { vals.push(hit.sector);   sets.push(`sectors = $${vals.length}`); }
      if (takeProducts) { vals.push(hit.products); sets.push(`products = $${vals.length}`); }
      vals.push(new Date().toISOString());
      sets.push(`updated_at = $${vals.length}`);
      await client.query(`UPDATE orgs SET ${sets.join(', ')} WHERE id = $1`, vals);

      if (takeSector) filled.push({ o, hit });
      if (takeProducts) gotProducts.push({ o, hit });
    }
    for (const [k, v] of wanted) if (!seen.has(k)) missed.push(v.name);

    const by = filled.reduce((m, f) => m.set(f.hit.sector, (m.get(f.hit.sector) || 0) + 1), new Map());
    console.log(`\n섹터를 채운 기업 ${filled.length}곳`);
    [...by].sort((a, b) => b[1] - a[1]).forEach(([s, n]) => console.log(`   ${String(n).padStart(3)}  ${s}`));

    console.log(`\n취급 품목을 채운 기업 ${gotProducts.length}곳`);
    gotProducts.slice(0, 6).forEach((g) => console.log(
      `   ${g.o.name_ko || g.o.name_en} — ${g.hit.products}`));
    if (gotProducts.length > 6) console.log(`   … 외 ${gotProducts.length - 6}곳`);

    if (kept.length) console.log(`\n이미 값이 있어 그대로 둔 기업 ${kept.length}곳`);
    if (missed.length) {
      console.log(`\n명단에는 있지만 기업DB에서 못 찾은 ${missed.length}곳:`);
      console.log('   ' + missed.slice(0, 20).join(' · ') + (missed.length > 20 ? ' …' : ''));
    }

    const left = await client.query(
      `SELECT count(*)::int n FROM orgs WHERE sectors LIKE '%이벤트·MICE 업종 미정%'`);
    console.log(`\n아직 «이벤트·MICE 업종 미정»으로 남은 기업: ${left.rows[0].n}곳`);

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
