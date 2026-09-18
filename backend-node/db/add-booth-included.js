/* ══════════════════════════════════════════════════════════════
   add-booth-included.js — 부스 타입에 "기본 제공 품목"을 매단다

   부스 타입마다 따라오는 품목이 정해져 있다(인포데스크, 의자, 콘센트…).
   지금까지는 매뉴얼에만 적혀 있어서, 기업마다 손으로 다시 적었다. 적다 보면
   빠지고, 빠지면 현장에서 «우리 건 왜 없냐»가 된다.

   부스 타입은 code_lists에 행사별로 들어 있으니 그 행에 붙인다. 표를 따로
   만들면 부스 타입을 지우거나 이름을 바꿀 때 짝이 어긋난다.
     code_lists.included      — 기본 제공 품목 (JSON 배열)
     exhibitor_items.origin   — '' 사람이 넣은 것 | 'booth' 부스 타입이 깔아 준 것

   origin을 따로 두는 건, 부스 타입이 바뀌면 깔아 준 것만 갈아끼우고 기업이
   자체로 신청한 추가 비품은 건드리지 않기 위해서다. 그 구분이 없으면 부스를
   한 번 바꿀 때마다 기업이 신청한 내역이 같이 날아간다.

     node db/add-booth-included.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

(async () => {
  try {
    await pool.query(`ALTER TABLE code_lists ADD COLUMN IF NOT EXISTS included TEXT`);
    await pool.query(`ALTER TABLE exhibitor_items ADD COLUMN IF NOT EXISTS origin TEXT`);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM code_lists WHERE list_key = 'booth_type'`);
    console.log(`준비 완료 — 부스 타입 ${rows[0].n}종에 기본 제공 품목을 적어 둘 수 있습니다.`);
  } catch (e) {
    console.error('실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end?.();
  }
})();
