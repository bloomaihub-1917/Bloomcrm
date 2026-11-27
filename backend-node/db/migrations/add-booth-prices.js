/* ══════════════════════════════════════════════════════════════
   add-booth-prices.js — 부스 타입에 단가(조기·사전·일반 × KRW·USD)를 매단다

   부스 타입은 code_lists에 행사별로 들어 있으니(기본 제공 품목과 같은 이유로) 그 행에 붙인다.
     code_lists.prices    — JSON {early:{krw,usd}, pre:{krw,usd}, regular:{krw,usd}} (빈 칸은 미정)
     exhibitors.price_tier — 이 기업의 단가 구간 'early'|'pre'|'regular' (비우면 신청일과 행사 마감일로 자동)
   조기·사전 마감일은 행사 설정(exh_cfg_<행사>.tiers)에 둔다 — 행사마다 하나라서.

     node db/migrations/add-booth-prices.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('../pool');

(async () => {
  try {
    await pool.query(`ALTER TABLE code_lists ADD COLUMN IF NOT EXISTS prices TEXT`);
    await pool.query(`ALTER TABLE exhibitors ADD COLUMN IF NOT EXISTS price_tier TEXT`);
    console.log('준비 완료 — 행사 › 부스에서 부스 타입마다 조기·사전·일반 단가(KRW·USD)를 적을 수 있습니다.');
  } catch (e) {
    console.error('실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end?.();
  }
})();
