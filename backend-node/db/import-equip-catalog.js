/* ══════════════════════════════════════════════════════════════
   import-equip-catalog.js — 렌탈 비품 카탈로그 엑셀 → equip_catalog

   운영에서 쓰는 "KIC 렌탈가구 카탈로그" 엑셀의 [품목마스터] 시트를 읽어 넣는다.
   행사별 품목표라 --event 로 어느 행사 것인지 지정한다.

   여러 번 돌려도 안전하다 — (행사, 코드)가 같으면 덮어쓰고, 이미 신청에 쓰인
   품목의 id는 그대로 두어 연결이 끊기지 않는다.

     node db/import-equip-catalog.js --event "2026 KIC" --file "…\카탈로그.xlsx"
     node db/import-equip-catalog.js --event "2026 KIC" --file "…" --dry

   엑셀 열: No | 카테고리 | 코드 | 품명(국문) | 품명(영문) | 규격(mm) | 이미지 |
            단가(KRW) | 단가(USD) | 비고
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const path = require('path');
const pool = require('./pool');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const EVENT = arg('--event');
const FILE = arg('--file');

if (!EVENT || !FILE) {
  console.error('사용법: node db/import-equip-catalog.js --event "2026 KIC" --file "경로.xlsx" [--dry]');
  process.exit(1);
}

/* 숫자 칸에 "27,500원" 같은 표기가 섞여 들어와도 숫자만 남긴다 */
const num = (v) => String(v ?? '').replace(/[^0-9.]/g, '');

(async () => {
  let XLSX;
  try { XLSX = require('xlsx'); } catch (e) {
    console.error('xlsx 모듈이 필요합니다:  npm i xlsx');
    process.exit(1);
  }

  const wb = XLSX.readFile(path.resolve(FILE));
  const sheet = wb.Sheets['품목마스터'];
  if (!sheet) { console.error('[품목마스터] 시트를 찾을 수 없습니다. 시트:', wb.SheetNames.join(', ')); process.exit(1); }

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    .filter((r) => String(r['코드'] || '').trim());

  if (!rows.length) { console.error('읽을 품목이 없습니다.'); process.exit(1); }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 이미 있는 품목은 id를 지켜야 한다 — 신청 내역이 그 id를 가리키고 있다
    const existing = new Map((await client.query(
      'SELECT id, code FROM equip_catalog WHERE event_id = $1', [EVENT])).rows
      .map((r) => [String(r.code).trim(), r.id]));

    let added = 0, updated = 0;
    const seen = new Set();
    const dupes = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const code = String(r['코드']).trim();
      if (seen.has(code)) { dupes.push(code); continue; }
      seen.add(code);

      const id = existing.get(code) || `EC-${String(i + 1).padStart(4, '0')}-${EVENT.replace(/[^A-Za-z0-9]/g, '')}`;
      const rec = {
        id, event_id: EVENT,
        category: String(r['카테고리'] || '').trim(),
        code,
        name_ko: String(r['품명(국문)'] || '').trim(),
        name_en: String(r['품명(영문)'] || '').trim(),
        spec: String(r['규격(mm)'] || '').trim(),
        price_krw: num(r['단가(KRW)']),
        price_usd: num(r['단가(USD)']),
        note: String(r['비고'] || '').trim(),
        active: '',
        sort_order: String(r['No'] || i + 1),
      };
      existing.has(code) ? updated++ : added++;

      if (!DRY) {
        const cols = Object.keys(rec);
        await client.query(
          `INSERT INTO equip_catalog (${cols.map((c) => `"${c}"`).join(',')})
           VALUES (${cols.map((_, k) => `$${k + 1}`).join(',')})
           ON CONFLICT (id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}`,
          cols.map((c) => rec[c]));
      }
    }

    const byCat = {};
    rows.forEach((r) => { const c = String(r['카테고리'] || '(없음)').trim(); byCat[c] = (byCat[c] || 0) + 1; });

    console.log(`\n${EVENT} 카탈로그: 신규 ${added} / 갱신 ${updated}`);
    console.log('  카테고리별:', JSON.stringify(byCat));
    if (dupes.length) console.log('  ⚠ 코드 중복으로 건너뜀:', dupes.join(', '));

    // 엑셀에서 빠진 품목은 지우지 않고 내린다 — 이미 신청된 건이 있을 수 있다
    if (!DRY) {
      const gone = await client.query(
        `UPDATE equip_catalog SET active = 'no'
          WHERE event_id = $1 AND code <> ALL($2::text[]) AND COALESCE(active,'') <> 'no'
        RETURNING code`, [EVENT, [...seen]]);
      if (gone.rows.length) {
        console.log(`  이번 엑셀에 없어 목록에서 내린 품목 ${gone.rows.length}개:`,
          gone.rows.map((g) => g.code).join(', '));
        console.log('  (지우지 않았습니다 — 이미 신청된 건이 무엇을 가리키는지 잃지 않도록)');
      }
    }

    if (DRY) { await client.query('ROLLBACK'); console.log('\n--dry 라서 되돌렸습니다.'); }
    else { await client.query('COMMIT'); console.log('\n반영 완료.'); }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
