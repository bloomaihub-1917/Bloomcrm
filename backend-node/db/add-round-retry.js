/* ══════════════════════════════════════════════════════════════
   add-round-retry.js — 컨택 차수에 «부재중이면 몇 시간 뒤 다시» 칸을 붙인다

     retry_hours  부재중이면 이 시간 뒤에 다시 걸 차례. 비면 2시간, 0이면 바로

     node db/add-round-retry.js          (시험)
     node db/add-round-retry.js --apply
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');
const APPLY = process.argv.includes('--apply');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE contact_rounds ADD COLUMN IF NOT EXISTS retry_hours TEXT');
    console.log('contact_rounds: retry_hours 칸 붙임');
    if (!APPLY) { await client.query('ROLLBACK'); console.log('\n시험 실행 — --apply로 바꿉니다.'); return; }
    await client.query('COMMIT');
    console.log('바꿨어요.');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error(e); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})();
