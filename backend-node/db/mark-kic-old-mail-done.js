/* ══════════════════════════════════════════════════════════════
   mark-kic-old-mail-done.js — KIC 전시 2026-10-15 이전 메일을 «처리 완료·읽음»으로

   받은메일함을 붙이기 전에 이미 주고받은 메일이 «처리 안 함·안 읽음»으로 쌓여
   남은 일 목록을 가렸다. 그날 이전 것은 다 처리된 것으로 본다.

     node db/mark-kic-old-mail-done.js          (시험)
     node db/mark-kic-old-mail-done.js --apply
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');
const APPLY = process.argv.includes('--apply');
const BEFORE = '2026-10-15';

(async () => {
  const client = await pool.connect();
  try {
    const ev = await client.query(`SELECT id, name, short, date_start FROM events WHERE id ILIKE '%kic%' OR name ILIKE '%kic%' OR short ILIKE '%kic%'`);
    console.log('행사 후보:', ev.rows);
    await client.query('BEGIN');
    const r = await client.query(`
      UPDATE exhibitor_logs l
         SET status = 'done',
             read_at = COALESCE(NULLIF(l.read_at, ''), to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')),
             read_by = COALESCE(NULLIF(l.read_by, ''), '일괄 처리')
        FROM exhibitors x
       WHERE x.id = l.exhibitor_id
         AND x.event_id = ANY($1)
         AND l.channel IN ('이메일', 'email')
         AND l.ts < $2
         AND (l.status IS DISTINCT FROM 'done' OR COALESCE(l.read_at, '') = '')
      RETURNING l.id, l.ts, l.direction, l.status`, [process.argv.slice(2).filter(a => !a.startsWith('--')).length ? process.argv.slice(2).filter(a => !a.startsWith('--')) : ev.rows.map(e => e.id), BEFORE]);
    console.log(`바뀔 메일 ${r.rowCount}건 (받은 ${r.rows.filter(x => x.direction === 'in').length}, 보낸 ${r.rows.filter(x => x.direction === 'out').length})`);
    console.log('가장 늦은 ts:', r.rows.map(x => x.ts).sort().pop());
    await client.query(APPLY ? 'COMMIT' : 'ROLLBACK');
    console.log(APPLY ? '적용했습니다.' : '시험 실행 — 바꾸지 않았습니다. --apply로 적용');
  } catch (e) { await client.query('ROLLBACK'); console.error(e.message); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})();
