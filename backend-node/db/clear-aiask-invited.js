/* AIASK에 «초청»으로 걸려 있던 참가자 기록을 뺀다.

   행사는 아직 열리지 않았다. 그런데 마스터DB에서 메일링 리스트 96명을 한 번에
   골라 AIASK로 초청한 기록이 «참가자»로 남아 있어, 행사별 보기에서는 이미
   109명이 온 것처럼 보였다. 참가자 명단은 금요일에 1차로 취합한다.

   초청했다는 사실 자체는 «AIA 메일링»에 잠재참가자로 남는다 — 그쪽이 원래
   그 사람들의 자리다. 그래서 여기서 빼도 아무도 잃지 않는다.

   지우기 전에 한 명씩 확인한다. 메일링 쪽에 없는 사람이 하나라도 있으면
   그 사람은 이 기록을 지우는 순간 어느 행사에도 없게 되므로, 통째로 멈춘다.

     node db/clear-aiask-invited.js [--dry]                                 */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EVENT = 'AIA';
const POOL_EVENT = 'aia 메일링 리스트';
const ROLE = '참가자';

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: targets } = await client.query(
      `SELECT p.id, p.contact_id, c."nameKo", c."nameEn"
         FROM participations p LEFT JOIN contacts c ON c.id = p.contact_id
        WHERE p.event_id = $1 AND p.role = $2`, [EVENT, ROLE]);

    const { rows: inPool } = await client.query(
      `SELECT contact_id FROM participations WHERE event_id = $1`, [POOL_EVENT]);
    const pooled = new Set(inPool.map((r) => r.contact_id));

    const orphaned = targets.filter((t) => !pooled.has(t.contact_id));
    if (orphaned.length) {
      throw new Error(`빼면 어느 행사에도 안 남는 사람 ${orphaned.length}명: `
        + orphaned.map((t) => t.nameKo || t.nameEn || t.contact_id).join(', ')
        + `\n  이 사람들을 «${POOL_EVENT}»에 먼저 넣은 뒤 다시 돌려주세요.`);
    }

    const r = await client.query(
      `DELETE FROM participations WHERE event_id = $1 AND role = $2`, [EVENT, ROLE]);
    console.log(`AIASK에서 뺀 «${ROLE}» 기록 ${r.rowCount}건`);
    console.log(`   (${targets.length}명 모두 «AIA 메일링»에 잠재참가자로 남아 있습니다)`);

    const after = await client.query(
      `SELECT e.short, p.role, count(*)::int n
         FROM participations p JOIN events e ON e.id = p.event_id
        GROUP BY 1, 2 ORDER BY 1, n DESC`);
    console.log('\n--- 행사별 참여 기록 ---');
    after.rows.forEach((x) => console.log(`  ${String(x.short).padEnd(18)} ${String(x.role).padEnd(12)} ${x.n}`));

    if (DRY) { await client.query('ROLLBACK'); console.log('\n--dry 라서 되돌렸습니다.'); }
    else { await client.query('COMMIT'); console.log('\n반영 완료.'); }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end?.();
  }
})();
