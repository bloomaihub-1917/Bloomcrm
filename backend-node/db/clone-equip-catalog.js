/* ══════════════════════════════════════════════════════════════
   clone-equip-catalog.js — 카탈로그를 새 행사로 복제

   행사마다 렌탈사와 단가가 바뀐다. 지난 행사 카탈로그를 그대로 두고 새 행사용을
   따로 만들어야 옛 주문이 가리키던 단가가 보존된다 — 값을 덮으면 지난 행사의
   정산 근거가 조용히 바뀌어 버린다.

   복제 후에는 새 행사의 카탈로그만 손보면 된다. 단가 일괄 인상도 여기서
   할 수 있다(--rate 1.05 → 5% 인상, 원 단위 반올림).

     node db/clone-equip-catalog.js --from "2026 KIC" --to "2027 KIC"
     node db/clone-equip-catalog.js --from "2026 KIC" --to "2027 KIC" --rate 1.05 --dry
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const FROM = arg('--from');
const TO = arg('--to');
const RATE = Number(arg('--rate') || 1);

if (!FROM || !TO) {
  console.error('사용법: node db/clone-equip-catalog.js --from "2026 KIC" --to "2027 KIC" [--rate 1.05] [--dry]');
  process.exit(1);
}

const bump = (v) => {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || !n) return String(v ?? '');
  return String(Math.round(n * RATE));
};

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const src = (await client.query(
      'SELECT * FROM equip_catalog WHERE event_id = $1 ORDER BY sort_order', [FROM])).rows;
    if (!src.length) { console.error(`${FROM} 카탈로그가 비어 있습니다.`); process.exit(1); }

    // 이미 복제해 둔 게 있으면 덮지 않는다 — 새 행사에서 손본 단가를 되돌리게 된다
    const have = new Set((await client.query(
      'SELECT code FROM equip_catalog WHERE event_id = $1', [TO])).rows.map((r) => String(r.code)));

    const slug = TO.replace(/[^A-Za-z0-9]/g, '');
    let added = 0, skipped = 0;

    for (const r of src) {
      if (have.has(String(r.code))) { skipped++; continue; }
      const rec = { ...r, id: `EC-${String(r.sort_order || added + 1).padStart(4, '0')}-${slug}`, event_id: TO,
        price_krw: bump(r.price_krw), price_usd: bump(r.price_usd) };
      if (!DRY) {
        const cols = Object.keys(rec);
        await client.query(
          `INSERT INTO equip_catalog (${cols.map((c) => `"${c}"`).join(',')})
           VALUES (${cols.map((_, k) => `$${k + 1}`).join(',')}) ON CONFLICT (id) DO NOTHING`,
          cols.map((c) => rec[c]));
      }
      added++;
    }

    console.log(`\n${FROM} → ${TO}`);
    console.log(`  복제 ${added}개${skipped ? ` / 이미 있어 건너뜀 ${skipped}개` : ''}`);
    if (RATE !== 1) console.log(`  단가 ${RATE}배 적용 (예: ${src[0].price_krw} → ${bump(src[0].price_krw)})`);

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
