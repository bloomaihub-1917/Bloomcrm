/* ══════════════════════════════════════════════════════════════
   add-audit-link.js — 활동 로그에 "가리키는 곳"(link) 칸을 만든다

   로그에는 대상 이름만 글자로 남아 있어서, 무엇이 바뀌었는지 읽고 나면 그
   기업·연사·세션을 탭을 옮겨 다시 찾아야 했다. 어디를 가리키는지를 함께
   적어 두면 로그 줄을 눌러 바로 그 창을 열고, 바뀐 칸까지 짚어 줄 수 있다.

   칸을 kind/id/tab/field로 쪼개지 않고 JSON 한 덩어리로 둔다 — 가리킬 대상이
   늘 때마다 칸을 또 만들지 않으려고.

     node db/add-audit-link.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

(async () => {
  try {
    await pool.query(`ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS link TEXT`);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM activity_log`);
    console.log(`link 칸 준비 완료 — 기존 ${rows[0].n}건은 빈 칸으로 남고(누를 수 없음), `
      + `앞으로 남는 기록부터 눌러서 바뀐 곳으로 갈 수 있습니다.`);
  } catch (e) {
    console.error('실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end?.();
  }
})();
