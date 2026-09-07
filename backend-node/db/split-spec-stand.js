/* ══════════════════════════════════════════════════════════════
   split-spec-stand.js — 이름이 같은 스펙 스탠드 두 품목을 갈라 적는다

   엑스렌탈 품목표에 "Spec Stand"가 두 줄 있다. 코드와 규격은 다른데 이름이
   같아서, 품목표에서 고를 때 어느 쪽인지 알 수 없었다. 단가도 두 배 차이가 난다.

     O-030  200*200*800mmH      $33   폴 하나에 원형 받침, 상단에 표지판
     O-060  500*400~700mmH      $17   삼각대(이젤)

   같은 물건이 아니므로 합치지 않는다 — 합치면 한쪽 단가가 사라진다. 대신
   무엇이 다른지가 이름에 드러나게 한다. "스펙 스탠드" 가족 이름은 남겨서
   아크릴 스펙 스탠드(A3/A4)와 함께 검색에 걸리게 하고, 형태만 덧붙인다.

   영문명은 엑스렌탈 원본 그대로 둔다. 업로드 표기 매칭이 이 이름으로 걸리고,
   원본과 대조할 때 우리가 고친 이름이 끼면 맞춰 볼 수 없다. 코드가 이름에
   들어 있으면 findCatalogByName이 코드를 먼저 보므로 실제 매칭도 갈린다.

     node db/split-spec-stand.js --dry
     node db/split-spec-stand.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const EVENT = arg('--event') || '2026 KIC';

const RENAME = [
  { code: 'O-030', from: '스펙 스탠드', to: '스펙 스탠드 · 폴형' },
  { code: 'O-060', from: '스펙 스탠드', to: '스펙 스탠드 · 삼각대형' },
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let done = 0;
    for (const r of RENAME) {
      const { rows } = await client.query(
        'SELECT id, name_ko, spec, price_usd FROM equip_catalog WHERE event_id=$1 AND code=$2',
        [EVENT, r.code]);
      if (!rows.length) { console.log(`  건너뜀  ${r.code} — 품목표에 없습니다`); continue; }
      const c = rows[0];

      // 이미 갈라 놓았거나 사람이 다르게 고쳐 뒀으면 덮어쓰지 않는다
      if (c.name_ko !== r.from) {
        console.log(`  건너뜀  ${r.code} — 이름이 이미 «${c.name_ko}»입니다`);
        continue;
      }

      // 이 품목을 쓰고 있는 정산 항목의 이름도 함께 옮긴다.
      // 품목표만 고치면 목록과 신청 내역이 다른 이름으로 갈린다.
      const used = (await client.query(
        "SELECT id, name FROM exhibitor_items WHERE catalog_id=$1 AND coalesce(voided_at,'')=''",
        [c.id])).rows;

      console.log(`  ${r.code}  «${c.name_ko}» → «${r.to}»   ${c.spec} · $${c.price_usd}`
        + (used.length ? `  (쓰는 중 ${used.length}건 함께 정리)` : '  (미사용)'));
      done++;

      if (!DRY) {
        await client.query('UPDATE equip_catalog SET name_ko=$1 WHERE id=$2', [r.to, c.id]);
        for (const it of used) {
          // 항목명에 옛 이름이 들어 있을 때만 바꾼다 — 손으로 달리 적어 둔 줄은 둔다
          if (!String(it.name || '').includes(r.from)) continue;
          await client.query('UPDATE exhibitor_items SET name=$1 WHERE id=$2',
            [String(it.name).replace(r.from, r.to), it.id]);
        }
      }
    }

    if (DRY) await client.query('ROLLBACK'); else await client.query('COMMIT');

    console.log(`\n${EVENT}: ${done}건 정리`);
    if (DRY) console.log('--dry — 실제로 바꾸지 않았습니다.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
