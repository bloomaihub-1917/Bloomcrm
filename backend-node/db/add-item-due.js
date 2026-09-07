/* ══════════════════════════════════════════════════════════════
   add-item-due.js — 항목에 "받기로 한 날"(due_at) 칸을 만든다

   그래픽은 받은 것/못 받은 것만 세고 있었다. 개수만으로는 누구부터 재촉할지
   정할 수 없어서, 항목마다 마감을 잡아 지난 것·임박한 것을 가른다.
   그래픽 말고 다른 분류에서도 쓸 수 있게 항목 표에 둔다(received_at과 같은 이유).

     node db/add-item-due.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

(async () => {
  try {
    await pool.query(`ALTER TABLE exhibitor_items ADD COLUMN IF NOT EXISTS due_at TEXT`);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM exhibitor_items WHERE category = 'graphic'`);
    console.log(`due_at 칸 준비 완료 — 그래픽 항목 ${rows[0].n}건에 마감을 잡을 수 있습니다.`);
  } catch (e) {
    console.error('실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end?.();
  }
})();
