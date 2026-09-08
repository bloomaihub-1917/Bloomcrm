/* ══════════════════════════════════════════════════════════════
   seed-item-cats.js — 품목 분류를 비품과 그래픽으로 가른다

   품목표(equip_catalog) 한 표에 비품과 그래픽이 함께 산다(kind로 구분). 그런데
   분류 목록은 하나뿐이라, 고르는 자리에 '의자·테이블·진열대'만 떴다. 그래서
   그래픽 품목은 목록 밖의 값을 손으로 적어 넣었고 — 족자봉·폼보드·X-배너 —
   같은 칸에 성격이 다른 두 축이 섞여 버렸다.

   목록을 kind별로 나눈다. 지금 실제로 쓰이고 있는 값을 그대로 목록으로 올려
   화면과 데이터가 어긋나지 않게 한다('부대시설'은 4건이 쓰는데 목록에 없었다).

   행사별로 둔다 — 렌탈사와 출력소가 행사마다 달라 분류도 따라 바뀐다.

     node db/seed-item-cats.js [--dry] [--event "2026 KIC"]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const evArg = process.argv.indexOf('--event');
const EVENT = evArg > -1 ? process.argv[evArg + 1] : '2026 KIC';

const LISTS = {
  equip_cat:   ['의자', '테이블', '진열대', '가전제품', '부대시설', '기타비품'],
  graphic_cat: ['벽면 랩핑', '인포데스크 랩핑', '인포데스크 사이드패널 랩핑',
                '족자봉', '폼보드', 'X-배너', '기타그래픽'],
};

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [listKey, codes] of Object.entries(LISTS)) {
      const have = new Set((await client.query(
        `SELECT code FROM code_lists WHERE list_key = $1 AND event_id = $2`,
        [listKey, EVENT])).rows.map((r) => r.code));

      let added = 0;
      for (let i = 0; i < codes.length; i++) {
        if (have.has(codes[i])) continue;
        await client.query(
          `INSERT INTO code_lists (id, list_key, event_id, code, label, cls, note, active, sort_order)
           VALUES ($1, $2, $3, $4, $4, '', '', '', $5)`,
          [`CLI-${listKey}-${EVENT}-${i}`.replace(/\s+/g, '_'), listKey, EVENT, codes[i], String((i + 1) * 10)]);
        added++;
      }
      console.log(`${listKey.padEnd(12)} ${added}개 추가 · 이미 있음 ${codes.length - added}개  [${EVENT}]`);
    }

    /* 품목표에 이미 들어 있는데 목록에 없는 분류가 남아 있으면 알려 준다 —
       화면에서 고를 수 없는 값이 데이터에만 있는 상태가 가장 헷갈린다. */
    const orphan = (await client.query(
      `SELECT DISTINCT coalesce(nullif(kind,''),'equip') kind, category
         FROM equip_catalog WHERE event_id = $1 AND coalesce(category,'') <> ''`, [EVENT])).rows
      .filter((r) => !(LISTS[r.kind === 'graphic' ? 'graphic_cat' : 'equip_cat'] || []).includes(r.category));
    if (orphan.length) {
      console.log('\n목록에 없는 분류가 품목표에 남아 있어요 — 설정에서 추가하거나 품목을 옮겨 주세요:');
      orphan.forEach((r) => console.log(`   [${r.kind}] ${r.category}`));
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
