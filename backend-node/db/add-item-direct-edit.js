/* ══════════════════════════════════════════════════════════════
   add-item-direct-edit.js — 금액 항목에 «정산에서 직접 고쳤다»를 적을 칸

   품목은 원래 신청서 접수(회차)를 거쳐 들어온다. 그런데 기업이 엑스렌탈과
   직접 주고받아 바뀌는 일이 있고, 그건 신청서를 거치지 않는다. 그때는 정산에서
   바로 고치는데, 그렇게 고친 줄은 어느 회차에도 안 묶여 나중에 «이 금액이 왜
   이런가»를 되짚을 수 없었다.

   누가 언제 고쳤는지를 줄에 적어 둔다. 무엇을 얼마에서 얼마로 고쳤는지는
   활동 기록에 남는다 — 한 줄이 여러 번 바뀔 수 있어서 칸에 담아 두면 마지막
   것만 남는다.

     node db/add-item-direct-edit.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

(async () => {
  try {
    await pool.query(`ALTER TABLE exhibitor_items ADD COLUMN IF NOT EXISTS edited_at TEXT`);
    await pool.query(`ALTER TABLE exhibitor_items ADD COLUMN IF NOT EXISTS edited_by TEXT`);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM exhibitor_items`);
    console.log(`칸 준비 완료 — 기존 ${rows[0].n}건은 빈 칸으로 남습니다(정산에서 고친 적 없는 줄).`);
  } catch (e) {
    console.error('실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end?.();
  }
})();
