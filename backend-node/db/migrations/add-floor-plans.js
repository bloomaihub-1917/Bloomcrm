/* ══════════════════════════════════════════════════════════════
   add-floor-plans.js — 전시장 배치도(도면) 표를 만든다

   행사 하나에 도면이 여러 장일 수 있다(1홀·2홀, 1층·3층). 도면 한 장이 한 줄.
     floor_plans.booths  — 부스 칸 JSON 배열 [{no, x, y, w, h}] (단위 m)
     floor_plans.zones   — 부스가 아닌 구역 JSON [{label, x, y, w, h}] — 세미나·컨퍼런스·무대·라운지
     floor_plans.bg_url  — 나중에 넣을 도면 이미지·조감도 자리 (지금은 비어 있다)

   «어느 기업이 어느 부스»는 여기 두지 않는다 — exhibitors.booth_no가 정본이다.
   배치도에서 배정하면 booth_no를 고치고, 부스 현황·인보이스가 그 값을 그대로 쓴다.
   따로 두면 배치도와 부스 현황의 번호가 어긋난다.

     node db/migrations/add-floor-plans.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('../pool');

(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS floor_plans (
      id TEXT PRIMARY KEY, event_id TEXT, name TEXT,
      width TEXT, height TEXT, booths TEXT, bg_url TEXT,
      sort_order INTEGER, note TEXT, updated_at TEXT, updated_by TEXT)`);
    await pool.query(`ALTER TABLE floor_plans ADD COLUMN IF NOT EXISTS zones TEXT`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_floor_plans_event ON floor_plans(event_id)`);
    console.log('floor_plans 준비 완료 — 전시 탭 «배치도»에서 도면을 만드세요.');
  } catch (e) {
    console.error('실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end?.();
  }
})();
