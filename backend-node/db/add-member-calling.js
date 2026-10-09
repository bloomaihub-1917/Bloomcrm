/* ══════════════════════════════════════════════════════════════
   add-member-calling.js — 컨택 명단에 «거는 중» 칸을 붙인다

     calling_by  거는 사람 이름
     calling_at  누른 시각(YYYY-MM-DD HH:mm) — 10분 지나면 없는 것으로 본다

     node db/add-member-calling.js          (시험)
     node db/add-member-calling.js --apply
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');
const APPLY = process.argv.includes('--apply');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of ['calling_by', 'calling_at']) {
      await client.query(`ALTER TABLE round_members ADD COLUMN IF NOT EXISTS ${c} TEXT`);
    }
    console.log('round_members: 거는 중 칸 붙임');
    if (!APPLY) { await client.query('ROLLBACK'); console.log('\n시험 실행 — --apply로 바꿉니다.'); return; }
    await client.query('COMMIT');
    console.log('바꿨어요.');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error(e); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})();
