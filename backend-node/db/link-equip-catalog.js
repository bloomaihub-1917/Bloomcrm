/* ══════════════════════════════════════════════════════════════
   link-equip-catalog.js — 이미 들어온 비품 신청을 카탈로그 품목에 잇는다

   신청 항목은 이름만 손으로 적혀 들어와서 같은 의자가 "C-040 Folding Chair",
   "C-040 - 접이식 체어", "폴딩체어"로 제각각이다. 이름 앞에 붙은 코드(C-040 등)를
   뽑아 카탈로그와 이어 두면, 발주 합계가 표기에 흔들리지 않고 단가도 카탈로그에서
   바로 읽을 수 있다.

   이름을 고치지는 않는다 — 기업이 실제로 적어 보낸 문구라 그대로 남겨야
   나중에 "무엇을 요청했었나"를 되짚을 수 있다. 연결(catalog_id)만 채운다.

     node db/link-equip-catalog.js --event "2026 KIC" [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const EVENT = arg('--event');

if (!EVENT) {
  console.error('사용법: node db/link-equip-catalog.js --event "2026 KIC" [--dry]');
  process.exit(1);
}

/* 품목 코드를 이름 어디서든 찾는다. 대부분 맨 앞에 붙지만
   "테이블 (T-043 - Rectangular Table 1200)"처럼 괄호 안에 들어오거나
   "참관객 바코드 리더기(E-099)"처럼 끝에 붙는 경우도 있다. */
const codeOf = (name) => {
  const m = String(name || '').toUpperCase().match(/\b([A-Z]{1,2}-\d{2,4})\b/);
  return m ? m[1] : '';
};

/* 코드가 없으면 이름으로 맞춰본다(공백·대소문자·괄호 무시) */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cat = (await client.query(
      'SELECT id, code, name_ko, name_en, price_krw FROM equip_catalog WHERE event_id = $1', [EVENT])).rows;
    if (!cat.length) { console.error(`${EVENT} 카탈로그가 비어 있습니다 — 먼저 import-equip-catalog.js를 돌려주세요.`); process.exit(1); }

    const byCode = new Map(cat.map((c) => [String(c.code).toUpperCase(), c]));
    const byName = new Map();
    cat.forEach((c) => { [c.name_ko, c.name_en].filter(Boolean).forEach((n) => { const k = norm(n); if (k && !byName.has(k)) byName.set(k, c); }); });

    const items = (await client.query(
      `SELECT i.id, i.name, i.catalog_id, e.company_name
         FROM exhibitor_items i JOIN exhibitors e ON e.id = i.exhibitor_id
        WHERE e.event_id = $1 AND i.category = 'equip'`, [EVENT])).rows;

    let linked = 0, already = 0;
    const unmatched = [];

    for (const it of items) {
      if (String(it.catalog_id || '').trim()) { already++; continue; }

      const code = codeOf(it.name);
      let hit = code ? byCode.get(code) : null;
      if (!hit) {
        // 코드가 없으면 이름으로 — 코드 부분을 떼고 남은 문구로 맞춘다
        const bare = String(it.name || '').replace(/[A-Za-z]{1,2}-\d{2,4}\s*[-–]?\s*/, '');
        hit = byName.get(norm(bare)) || byName.get(norm(it.name));
      }
      if (!hit) { unmatched.push(`${it.company_name} · ${it.name}`); continue; }

      if (!DRY) await client.query('UPDATE exhibitor_items SET catalog_id = $2 WHERE id = $1', [it.id, hit.id]);
      linked++;
    }

    console.log(`\n${EVENT} 비품 신청 ${items.length}건`);
    console.log(`  새로 연결 ${linked} / 이미 연결됨 ${already} / 못 맞춘 ${unmatched.length}`);
    if (unmatched.length) {
      console.log('\n  카탈로그에 없는 항목 — 직접 입력했거나 카탈로그 밖의 품목일 수 있어요:');
      [...new Set(unmatched)].forEach((u) => console.log('   ', u));
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
