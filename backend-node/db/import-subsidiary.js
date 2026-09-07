/* ══════════════════════════════════════════════════════════════
   import-subsidiary.js — 엑스렌탈 Subsidiary Facilities → equip_catalog

   엑스렌탈이 주는 품목표는 가구·그래픽과 Subsidiary Facilities(전기 인입,
   콘센트, 조명)가 갈려 있다. 앞의 둘은 카탈로그에 들어와 있는데 이것만 빠져
   있었다 — 품목명이 없으니 신청서에 이 줄이 올라와도 무엇인지 이름으로 부를 수
   없고, 정산에서 항목을 고를 때 목록에 아예 나오지 않는다.

   품목명(name_ko)은 엑스렌탈 영문명을 그대로 옮기지 않고 우리가 부르는 말로
   짓는다. "220V (single-phase)"는 현장에서 "전기 인입"이라 부르지 그 영문으로
   부르지 않는다. 영문명은 name_en에 그대로 남겨 엑스렌탈 원본과 대조할 수 있게
   한다(업로드 표기 매칭도 이걸로 걸린다).

   코드 접두어는 S-(Subsidiary). E·C·D·T·O·X·G가 이미 쓰이고 있어 겹치지 않는다.

   원화는 기존 카탈로그가 전부 USD × 1000으로 들어가 있어 같은 방식을 따른다.
   실제 환율이 아니라 그 표의 약속이라, 여기만 다르게 넣으면 합계가 어긋난다.

   여러 번 돌려도 안전하다 — (행사, 코드)가 같으면 덮어쓰고, 이미 신청에 쓰인
   품목의 id는 그대로 두어 연결이 끊기지 않는다(import-equip-catalog.js와 동일).

     node db/import-subsidiary.js --event "2026 KIC" --dry
     node db/import-subsidiary.js --event "2026 KIC"
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const EVENT = arg('--event') || '2026 KIC';

const CATEGORY = '부대시설';

/* sort_order는 분류별 번호가 아니라 품목표 전체를 관통하는 일련번호다
   (의자 1~22 → 테이블 23~36 → 진열대 37~55 → 가전 56~66 → 기타 67~978).
   목록이 이 번호 하나로만 정렬되므로, 번호가 곧 분류의 묶음이 된다.

   처음에 10·20·30·40을 줬다가 의자와 테이블 사이에 흩어져 박혔다. 기존 번호가
   쓰지 않는 뒤쪽에 자리를 잡아 부대시설끼리 붙어 있게 한다. */
const SORT_BASE = 1000;

/* 엑스렌탈 Subsidiary Facilities 품목.
   usd는 엑스렌탈 상품 페이지의 금액 그대로. 원화는 아래에서 ×1000 한다.

   ⚠ 아직 상품 페이지에서 확인한 네 건만 들어 있다. 나머지가 오면 이 배열에만
     줄을 더하면 된다 — 코드는 10 단위로 비워 뒀다. */
const ITEMS = [
  { code: 'S-010', ko: '전기 인입 · 220V 단상',            en: '220V (single-phase)',                    spec: '220V 단상', usd: 99 },
  { code: 'S-020', ko: '콘센트 · 13A 220V/60Hz 단상',      en: '13AMP socket 220V/60Hz single-phase',    spec: '13A · 220V/60Hz', usd: 22 },
  { code: 'S-030', ko: 'LED 스포트라이트 8W',              en: 'LED 8W Spotlight',                       spec: '8W', usd: 22 },
  { code: 'S-040', ko: 'HQI 램프 50W',                     en: 'HQI LED 50W',                            spec: '50W', usd: 39 },
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = new Map((await client.query(
      'SELECT id, code FROM equip_catalog WHERE event_id = $1', [EVENT])).rows
      .map((r) => [String(r.code).trim(), r.id]));

    // 이미 다른 분류에 같은 이름이 들어가 있으면 알려 준다 — 중복 등록은
    // 신청 항목이 두 갈래로 갈리는 원인이 된다
    const names = new Set((await client.query(
      "SELECT LOWER(REPLACE(COALESCE(name_en,''),' ','')) k FROM equip_catalog WHERE event_id = $1 AND COALESCE(name_en,'') <> ''",
      [EVENT])).rows.map((r) => r.k));

    let added = 0, updated = 0;
    const warn = [];

    for (let i = 0; i < ITEMS.length; i++) {
      const it = ITEMS[i];
      const key = it.en.toLowerCase().replace(/ /g, '');
      if (!existing.has(it.code) && names.has(key)) warn.push(`${it.code} ${it.en} — 같은 영문명이 이미 있습니다`);

      const id = existing.get(it.code) || `EC-SUB-${it.code}-${EVENT.replace(/[^A-Za-z0-9]/g, '')}`;
      const rec = {
        id, event_id: EVENT, kind: 'equip', category: CATEGORY,
        code: it.code, name_ko: it.ko, name_en: it.en, spec: it.spec || '',
        price_krw: String(it.usd * 1000), price_usd: String(it.usd),
        note: '', active: '', sort_order: String(SORT_BASE + (i + 1) * 10),
      };
      existing.has(it.code) ? updated++ : added++;

      console.log(`  ${existing.has(it.code) ? '갱신' : '신규'}  ${it.code}  ${it.ko}`
        + `  ($${it.usd} / ₩${(it.usd * 1000).toLocaleString()})`);

      if (!DRY) {
        const cols = Object.keys(rec);
        await client.query(
          `INSERT INTO equip_catalog (${cols.map((c) => `"${c}"`).join(',')})
           VALUES (${cols.map((_, k) => `$${k + 1}`).join(',')})
           ON CONFLICT (id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}`,
          cols.map((c) => rec[c]));
      }
    }

    if (DRY) await client.query('ROLLBACK'); else await client.query('COMMIT');

    console.log(`\n${EVENT} · ${CATEGORY}: 신규 ${added} / 갱신 ${updated}`);
    if (warn.length) console.log('  ⚠ ' + warn.join('\n  ⚠ '));
    if (DRY) console.log('\n--dry — 실제로 넣지 않았습니다.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
