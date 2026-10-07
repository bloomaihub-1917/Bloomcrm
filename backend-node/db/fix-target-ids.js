/* ══════════════════════════════════════════════════════════════
   fix-target-ids.js — 숫자가 아닌 CRM 타겟 id를 숫자로 다시 매긴다

   행사DB › CRM 타겟으로 잡기가 id를 'T-<시각>-<순번>'으로 만들었다(2026-09-29~).
   화면은 타겟 id를 숫자로 읽어(+r.id) NaN이 되고, 카드가 열리지 않으며 저장할
   때마다 서버가 새 줄을 만든다. 숫자(Date.now()*1000 + 순번, 16자리 이하)로 바꾼다.
   타겟 id를 가리키는 다른 표는 없다(activity_log에도 없음 — 확인함).

     node db/fix-target-ids.js            (시험 — 바꾸지 않는다)
     node db/fix-target-ids.js --apply
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');
const APPLY = process.argv.includes('--apply');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const bad = (await client.query(`SELECT id, name, event FROM crm_targets WHERE id !~ '^[0-9]+$' ORDER BY id`)).rows;
    const have = new Set((await client.query('SELECT id FROM crm_targets')).rows.map((r) => r.id));
    let next = Date.now() * 1000;
    const plan = bad.map((r) => {
      while (have.has(String(next))) next++;
      const id = String(next++);
      have.add(id);
      return { from: r.id, to: id, name: r.name, event: r.event };
    });
    plan.forEach((p) => { if (!Number.isSafeInteger(Number(p.to))) throw new Error(`안전하지 않은 id ${p.to}`); });
    console.log(`다시 매길 타겟 ${plan.length}건`);
    plan.slice(0, 5).forEach((p) => console.log(`  ${p.from} → ${p.to}  ${p.event} · ${p.name}`));
    if (!APPLY) { await client.query('ROLLBACK'); console.log('\n시험 실행 — --apply로 바꿉니다.'); return; }
    for (const p of plan) await client.query('UPDATE crm_targets SET id = $1 WHERE id = $2', [p.to, p.from]);
    await client.query('COMMIT');
    console.log('바꿨어요.');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error(e); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})();
