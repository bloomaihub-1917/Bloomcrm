/* ══════════════════════════════════════════════════════════════
   import-graphic-catalog.js — 그래픽(사인물) 품목표를 넣는다

   비품과 같은 표(equip_catalog)에 kind='graphic'으로 담는다. 표를 새로 만들면
   고르는 화면도, 이름으로 찾는 규칙도, 설정 편집기도 전부 두 벌이 된다.

   원본은 "구분 / 세부 항목 / 재질 / 사이즈 / 단가(KRW) / 단가(USD) / 비고"다.
   구분이 분류, 구분+세부 항목이 품명이 된다 — 같은 '족자봉'이라도 1패널·1면,
   PET·현수막이 단가가 다 달라서 세부 항목까지 붙여야 한 품목으로 갈린다.
   재질과 사이즈는 규격 한 칸에 합친다.

   단가는 "154,000원/패널", "$154/Panel"처럼 단위가 붙어 있다. 숫자만 남기되
   단위는 비고로 옮긴다 — 패널당인지 개당인지가 수량 산정의 근거다.

     node db/import-graphic-catalog.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EVENT = '2026 KIC';

/* [구분, 세부 항목, 재질, 사이즈, 단가(KRW), 단가(USD), 비고] */
const ROWS = [
  ['벽면 랩핑 (Wall Wrapping)', '패널당 랩핑', 'PVC 켈지', '970 x 2390', '154,000원/패널', '$154/Panel', '시공·설치 포함. 벽 1면=3패널 기준으로 수량 산정'],
  ['인포데스크 랩핑', '정면 (Standard)', 'PET', '1000 x 750', '88,000원/개', '$88/Panel', '정면만 해당(좌우 미포함), 데스크 수량만큼 산정'],
  ['인포데스크 랩핑', '정면 (Premium)', 'PET', '1000 x 1000', '88,000원/개', '$88/Panel', '정면만 해당(좌우 미포함)'],
  ['인포데스크 사이드패널 랩핑', 'Premium', 'PET', '485 x 898', '88,000원/개', '$88/Panel', ''],
  ['인포데스크 사이드패널 랩핑', 'Standard', 'PET', '485 x 748', '88,000원/개', '$88/Panel', ''],
  ['족자봉 (Scroll Rods)', '1/2 패널 커버', 'PET', '950 x 1200', '88,000원/패널', '$88/Panel', '알루미늄봉+S고리 포함, 시공·설치 포함'],
  ['족자봉 (Scroll Rods)', '1 패널 커버', 'PET', '950 x 2320', '154,000원/패널', '$154/Panel', '알루미늄봉+S고리 포함'],
  ['족자봉 (Scroll Rods)', '1면 커버 (3패널)', 'PET', '2920 x 2320', '495,000원', '$495/Side', '알루미늄봉+S고리 포함'],
  ['족자봉 (Scroll Rods)', '1 패널 커버', '현수막', '950 x 2320', '110,000원/패널', '$110/Panel', ''],
  ['족자봉 (Scroll Rods)', '1면 커버 (3패널)', '현수막', '2920 x 2320', '363,000원', '$363/Panel', ''],
  ['폼보드 (Foam Board)', '1면 커버 (3패널)', '폼보드+PVC켈지', '2950 x 2400', '880,000원/패널', '$880/Panel', '출력 후 폼보드 부착, 시공·설치 포함'],
  ['X-배너 (X-Banner)', '1개', 'PET', '600 x 1800', '-', '$66/unit', '설치·철거 포함'],
];

/* 괄호 안 영문은 영문 품명으로 따로 뽑는다 — 화면이 국문·영문을 나눠 보여준다 */
function splitName(v){
  const m = String(v || '').match(/^(.*?)\s*\(([^)]*[A-Za-z][^)]*)\)\s*$/);
  return m ? { ko: m[1].trim(), en: m[2].trim() } : { ko: String(v || '').trim(), en: '' };
}
const num = (v) => {
  const m = String(v || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : '';
};
/* "154,000원/패널" → "패널당" 처럼 단위만 남긴다 */
function unitOf(krw, usd){
  const m = String(krw || '').match(/\/\s*(\S+)$/) || String(usd || '').match(/\/\s*(\S+)$/);
  if(!m) return '';
  const u = m[1].toLowerCase();
  return { '패널': '패널당', 'panel': '패널당', '개': '개당', 'unit': '개당', 'side': '1면당' }[u] || m[1];
}

(async () => {
  const client = await pool.connect();
  try {
    const { rows: exist } = await client.query(
      `SELECT id, code, name_ko FROM equip_catalog WHERE event_id = $1 AND kind = 'graphic'`, [EVENT]);
    const byCode = new Map(exist.map((r) => [r.code, r]));

    /* 세부 항목의 괄호는 벗기지 않는다. '정면 (Standard)'와 '정면 (Premium)'은
       괄호가 유일한 차이라서, 영문 표기인 줄 알고 떼면 두 품목이 같은 이름이 된다.
       괄호를 벗기는 건 구분(벽면 랩핑 (Wall Wrapping))에서만 한다. */
    const base = ROWS.map(([gubun, detail]) => {
      const g = splitName(gubun);
      return `${g.ko} · ${String(detail || '').trim()}`.trim();
    });
    const dupName = new Set(base.filter((v, i) => base.indexOf(v) !== i));

    const plan = ROWS.map(([gubun, detail, mat, size, krw, usd, note], i) => {
      const g = splitName(gubun);
      const unit = unitOf(krw, usd);
      const code = `G-${String((i + 1) * 10).padStart(3, '0')}`;
      // 이름이 겹치면 재질로 가른다 — 족자봉 1패널은 PET와 현수막의 단가가 다르다
      const nameKo = base[i] + (dupName.has(base[i]) && mat ? ` (${mat})` : '');
      return {
        id: `EC-graphic-${EVENT.replace(/[^A-Za-z0-9가-힣]/g, '')}-${code}`,
        event_id: EVENT, kind: 'graphic',
        category: g.ko,                                   // 구분이 분류
        code,
        name_ko: nameKo,
        name_en: g.en,
        spec: [mat, size].filter((v) => v && v !== '-').join(' · '),
        price_krw: krw === '-' ? '' : num(krw),
        price_usd: num(usd),
        note: [unit, note].filter(Boolean).join(' · '),
        active: '', sort_order: String((i + 1) * 10),
      };
    });

    console.log(`그래픽 품목 ${plan.length}건 (이미 있는 것 ${exist.length}건)\n`);
    plan.forEach((p) => console.log(
      `   ${p.code} ${p.name_ko}\n        규격 ${p.spec || '-'}`
      + ` | KRW ${p.price_krw ? Number(p.price_krw).toLocaleString() : '-'}`
      + ` | USD ${p.price_usd || '-'}${p.note ? `\n        ${p.note}` : ''}`
      + `${byCode.has(p.code) ? '   ← 덮어씀' : ''}`));

    if (DRY) { console.log('\n--dry 라서 아무것도 바꾸지 않았습니다.'); return; }

    await client.query('BEGIN');
    const cols = ['id', 'event_id', 'category', 'code', 'name_ko', 'name_en', 'spec',
      'price_krw', 'price_usd', 'note', 'active', 'sort_order', 'kind'];
    for (const p of plan) {
      await client.query(
        `INSERT INTO equip_catalog (${cols.map((c) => `"${c}"`).join(',')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})
         ON CONFLICT (id) DO UPDATE SET ${cols.filter((c) => c !== 'id')
           .map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}`,
        cols.map((c) => p[c]));
    }
    await client.query('COMMIT');
    console.log(`\n반영 완료 — ${plan.length}건`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
