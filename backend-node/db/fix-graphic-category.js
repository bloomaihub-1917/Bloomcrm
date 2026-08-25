/* ══════════════════════════════════════════════════════════════
   fix-graphic-category.js — 그래픽 항목을 비품에서 그래픽으로 옮긴다

   랩핑·프린트류가 분류만 '비품'으로 들어와 있었다. 그 탓에 비품 발주 합계가
   부풀고, 그래픽 현황에는 두 곳만 잡혀 실제로 그래픽을 주문한 기업이 보이지
   않았다.

   대상은 id로 못박는다 — 이름으로 훑으면 "Information Desk"가 들어간 진짜
   가구(D-030 인포메이션 데스크)까지 함께 옮겨갈 수 있다.

   전기(콘센트)와 플레이스홀더 행은 건드리지 않는다. 전기는 비품도 그래픽도
   아니지만 지금 분류 체계에 맞는 자리가 없어 그대로 둔다.

     node db/fix-graphic-category.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

/* 확인한 그래픽 항목만 명시한다(2026 KIC) */
const IDS = [
  'XI-1787565395129_12',   // ㈜심유 · 인포메이션 데스크 랩핑(PET)
  'XI-1787565401924_82',   // 알막 그룹 · Graphic - High Information Desk Wrapping (PET)
  'XI-1787565402809_92',   // 애크메드 · High Information Desk Wrapping (PET)
  'XI-1787565403602_100',  // 오리곤 랩스 · G-Scroll Rod PET Cover
  'XI-1787565403680_101',  // 오리곤 랩스 · G-Information Desk Wrapping (PET)
  'XI-1787565406469_130',  // 클라리오 · High info desk graphic print
  'XI-1787565406391_129',  // 클라리오 · Wall graphic print
  'XI-1787565408769_154',  // 포트리아 · Information Desk Side Panel Wrapping (PET)
  'XI-1787565408690_153',  // 포트리아 · Information Desk Wrapping (PET)
  'XI-1787565408610_152',  // 포트리아 · Wall Wrapping (PVC-vinyl paper) 1 Panel
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = (await client.query(
      `SELECT i.id, i.name, i.category, e.id AS exh_id, e.company_name, e.graphic_ordered_at, e.graphic_type
         FROM exhibitor_items i JOIN exhibitors e ON e.id = i.exhibitor_id
        WHERE i.id = ANY($1::text[]) ORDER BY e.company_name`, [IDS])).rows;

    const missing = IDS.filter((id) => !before.some((b) => b.id === id));
    if (missing.length) console.log('⚠ 찾지 못한 항목:', missing.join(', '));

    if (!DRY) {
      await client.query(
        `UPDATE exhibitor_items SET category = 'graphic' WHERE id = ANY($1::text[])`, [IDS]);

      /* 그래픽을 주문한 기업인데 주문일이 비어 있으면 채워 둔다 — 그래야
         그래픽 현황과 진행 체크리스트에 "주문함"으로 잡힌다. 유형(제작/출력)은
         사람이 판단할 문제라 비워 둔다. 화면에 '유형 미정'으로 떠서 채우게 된다. */
      const cos = [...new Set(before.map((b) => b.exh_id))];
      for (const exhId of cos) {
        const e = before.find((b) => b.exh_id === exhId);
        if (!String(e.graphic_ordered_at || '').trim()) {
          await client.query(
            `UPDATE exhibitors SET graphic_ordered_at = $2, updated_at = $2 WHERE id = $1`,
            [exhId, new Date().toISOString().slice(0, 10)]);
        }
      }
    }

    console.log(`\n비품 → 그래픽으로 옮긴 항목 ${before.length}건 / 기업 ${new Set(before.map((b) => b.company_name)).size}곳`);
    before.forEach((b) => console.log(`   ${b.company_name.padEnd(22)} ${b.name}`));

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
