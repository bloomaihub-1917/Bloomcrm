/* ══════════════════════════════════════════════════════════════
   add-alert-ack.js — 정산 경고를 «확인함»으로 덮어 둘 자리

   «추가 발행 필요»와 «인보이스 발행 뒤 변경»은 대개 맞는 말이지만, 우리가 낼
   장이 아닌 경우가 실제로 있다(엑스렌탈 직접 결제, 상대가 자기 양식으로 받아
   간 경우 등). 그때마다 빨간 줄이 남아 있으면 진짜 미발행 건이 묻힌다.

   지우는 게 아니라 «그 숫자를 보고 넘어갔다»를 적어 둔다. 확인한 시점의 숫자를
   함께 저장해, 그 뒤 금액이나 접수가 또 바뀌면 경고가 스스로 되살아난다 —
   한 번 끄면 영영 안 보이는 표시는 실제와 어긋나도 알 길이 없다.

     node db/add-alert-ack.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

(async () => {
  try {
    await pool.query(`ALTER TABLE exhibitors ADD COLUMN IF NOT EXISTS gap_ack TEXT`);
    await pool.query(`ALTER TABLE exhibitors ADD COLUMN IF NOT EXISTS reissue_ack TEXT`);
    console.log('준비 완료 — 정산 경고를 확인함으로 덮어 둘 수 있습니다.');
  } catch (e) {
    console.error('실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end?.();
  }
})();
