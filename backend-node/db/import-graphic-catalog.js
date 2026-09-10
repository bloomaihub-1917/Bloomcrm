/* ══════════════════════════════════════════════════════════════
   import-graphic-catalog.js — 그래픽(사인물) 품목표를 넣는다

   비품과 같은 표(equip_catalog)에 kind='graphic'으로 담는다. 표를 새로 만들면
   고르는 화면도, 이름으로 찾는 규칙도, 설정 편집기도 전부 두 벌이 된다.

   ── 왜 표를 그대로 적어 두는가 ──
   전에는 엑스렌탈 원본의 "구분 / 세부 항목"에서 품명을 조립하고, 코드는 줄
   순서 × 10으로 만들어냈다. 그게 두 가지를 깨뜨렸다.

   하나. 코드가 위치에서 나오니 줄을 하나 끼우면 그 아래 코드가 전부 밀린다.
   id도 코드에서 만들기 때문에 신청 항목이 가리키던 품목이 다른 물건이 된다.

   둘. 조립한 품명은 화면에서 다듬은 이름을 덮었다. 실제로 DB에는
   '벽면 랩핑 (PVC 켈지) 1패널'이 들어 있는데 스크립트는
   '벽면 랩핑 · 패널당 랩핑'을 만들어, 다시 돌리는 순간 되돌아갔다. 영문명도
   구분의 괄호에서만 뽑아 대부분 빈 값이 됐다.

   그래서 조립을 버리고 최종값을 그대로 적는다. 코드는 손으로 정한다 —
   같은 물건의 정면·사이드가 붙어 있어야 목록에서 한 짝으로 보인다
   (G-020/G-021 인포데스크, G-030/G-031 하이 인포데스크).
   순서(sort_order)는 코드의 숫자를 쓴다. 둘이 갈리면 목록 순서와 코드가 어긋난다.

   여러 번 돌려도 안전하다 — (행사, 코드)가 같으면 덮어쓰고, 이미 신청에 쓰인
   품목의 id는 코드에서 나오므로 그대로 유지된다.

     node db/import-graphic-catalog.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EVENT = '2026 KIC';

/* 엑스렌탈 그래픽 품목표. 코드 순서가 곧 화면 순서다.
   note의 앞부분(패널당·개당·1면당)은 수량 산정의 근거라 지우지 않는다. */
const ROWS = [
  { code: 'G-010', category: '벽면 랩핑',
    nameKo: '벽면 랩핑 (PVC 켈지) 1패널',
    nameEn: 'Wall Wrapping (PVC-vinyl paper) 1 Panel',
    spec: 'PVC 켈지 · 970 x 2390', krw: '154000', usd: '154',
    note: '패널당 · 시공·설치 포함. 벽 1면=3패널 기준으로 수량 산정' },
  { code: 'G-020', category: '인포데스크 랩핑',
    nameKo: '인포데스크 랩핑 · 정면',
    nameEn: 'Information Desk Wrapping (PET)',
    spec: 'PET · 1000 x 750', krw: '88000', usd: '88',
    note: '개당 · 정면만 해당(좌우 미포함), 데스크 수량만큼 산정' },
  { code: 'G-021', category: '인포데스크 랩핑',
    nameKo: '인포데스크 랩핑 · 사이드',
    nameEn: 'Information Desk Side Panel Wrapping (PET)',
    spec: 'PET · 485 x 748', krw: '88000', usd: '88',
    note: '개당' },
  { code: 'G-030', category: '하이 인포데스크 랩핑',
    nameKo: '하이 인포데스크 랩핑 · 정면',
    nameEn: 'High Information Desk Wrapping (PET)',
    spec: 'PET · 1000 x 1000', krw: '88000', usd: '88',
    note: '개당 · 정면만 해당(좌우 미포함)' },
  { code: 'G-031', category: '하이 인포데스크 랩핑',
    nameKo: '하이 인포데스크 랩핑 · 사이드',
    nameEn: 'High Information Desk Side Panel Wrapping (PET)',
    spec: 'PET · 485 x 898', krw: '88000', usd: '88',
    note: '개당' },
  { code: 'G-060', category: '족자봉',
    nameKo: '족자봉 · 1/2 패널 커버',
    nameEn: 'Scroll Rods Cover ½ Panel (PET)',
    spec: 'PET · 950 x 1200', krw: '88000', usd: '88',
    note: '패널당 · 알루미늄봉+S고리 포함, 시공·설치 포함' },
  { code: 'G-070', category: '족자봉',
    nameKo: '족자봉 · 1 패널 커버 (PET)',
    nameEn: 'Scroll Rods Cover 1 Panel (PET)',
    spec: 'PET · 950 x 2320', krw: '154000', usd: '154',
    note: '패널당 · 알루미늄봉+S고리 포함' },
  { code: 'G-080', category: '족자봉',
    nameKo: '족자봉 · 1면 커버 (3패널) (PET)',
    nameEn: 'Scroll Rods Cover 1 side - 3 Panel (PET)',
    spec: 'PET · 2920 x 2320', krw: '495000', usd: '495',
    note: '1면당 · 알루미늄봉+S고리 포함' },
  { code: 'G-090', category: '족자봉',
    nameKo: '족자봉 · 1 패널 커버 (현수막)',
    nameEn: 'Scroll Rods Cover 1 Panel (Banner)',
    spec: '현수막 · 950 x 2320', krw: '110000', usd: '110',
    note: '패널당' },
  { code: 'G-100', category: '족자봉',
    nameKo: '족자봉 · 1면 커버 (3패널) (현수막)',
    nameEn: 'Scroll Rods Cover 1 side - 3 Panel (Banner)',
    spec: '현수막 · 2920 x 2320', krw: '363000', usd: '363',
    note: '패널당' },
  { code: 'G-110', category: '폼보드',
    nameKo: '폼보드 · 1면 커버 (3패널)',
    nameEn: 'Form Board + PVC-vinyl paper Cover 1 side (3 Panel)',
    spec: '폼보드+PVC켈지 · 2950 x 2400', krw: '880000', usd: '880',
    note: '패널당 · 출력 후 폼보드 부착, 시공·설치 포함' },
  { code: 'G-120', category: 'X-배너',
    nameKo: 'X-배너 · 1개',
    nameEn: 'X-Banner (PET)',
    spec: 'PET · 600 x 1800', krw: '', usd: '66',
    note: '개당 · 설치·철거 포함' },
  /* 디자인 의뢰는 대상·범위마다 값이 달라 단가를 비워 둔다. 품목표 단가를
     넣어 두면 항목을 넣을 때 자동으로 채워져 실제 청구액을 덮는다.
     무엇을 디자인했는지는 항목의 note에 적는다(db/add-design-item.js). */
  { code: 'G-130', category: '디자인',
    nameKo: '부스 디자인 의뢰',
    nameEn: 'Booth Design',
    spec: '', krw: '', usd: '',
    note: '단가는 대상·범위마다 달라 항목에서 직접 적습니다' },
];

/* 순서는 코드에서 뽑는다 — G-021이면 21. 따로 적으면 둘이 갈린다. */
const sortOf = (code) => String(Number(String(code).replace(/[^0-9]/g, '')) || 0);
const idOf = (code) => `EC-graphic-${EVENT.replace(/[^A-Za-z0-9가-힣]/g, '')}-${code}`;

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const exist = new Map((await client.query(
      "SELECT id, code, name_ko FROM equip_catalog WHERE event_id=$1 AND kind='graphic'", [EVENT]
    )).rows.map((r) => [r.code, r]));

    // 코드가 겹치면 뒤 줄이 앞 줄을 덮어 조용히 사라진다 — 먼저 막는다
    const dupe = ROWS.map((r) => r.code).filter((c, i, a) => a.indexOf(c) !== i);
    if (dupe.length) { console.error('코드가 겹칩니다:', [...new Set(dupe)].join(', ')); process.exit(1); }

    let added = 0, updated = 0;
    for (const r of ROWS) {
      const rec = {
        id: idOf(r.code), event_id: EVENT, kind: 'graphic',
        category: r.category, code: r.code,
        name_ko: r.nameKo, name_en: r.nameEn, spec: r.spec,
        price_krw: r.krw, price_usd: r.usd, note: r.note,
        active: '', sort_order: sortOf(r.code),
      };
      const was = exist.get(r.code);
      was ? updated++ : added++;
      console.log(`  ${was ? '갱신' : '신규'}  ${r.code}  ${r.nameKo}`
        + (was && was.name_ko !== r.nameKo ? `   (전: ${was.name_ko})` : ''));

      if (!DRY) {
        const cols = Object.keys(rec);
        await client.query(
          `INSERT INTO equip_catalog (${cols.map((c) => `"${c}"`).join(',')})
           VALUES (${cols.map((_, k) => `$${k + 1}`).join(',')})
           ON CONFLICT (id) DO UPDATE SET ${cols.filter((c) => c !== 'id')
            .map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}`,
          cols.map((c) => rec[c]));
      }
    }

    /* 표에서 빠진 코드는 지우지 않고 알린다 — 이미 신청에 쓰였을 수 있고,
       지우면 그 신청이 무엇이었는지 설명할 수 없다. */
    const known = new Set(ROWS.map((r) => r.code));
    const orphan = [...exist.keys()].filter((c) => !known.has(c));

    if (DRY) await client.query('ROLLBACK'); else await client.query('COMMIT');

    console.log(`\n${EVENT} 그래픽 품목표: 신규 ${added} / 갱신 ${updated}`);
    if (orphan.length) console.log(`  ⚠ 이 표에 없는 코드가 품목표에 남아 있어요(지우지 않았습니다): ${orphan.join(', ')}`);
    if (DRY) console.log('--dry — 실제로 넣지 않았습니다.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
