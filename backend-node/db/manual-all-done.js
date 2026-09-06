/* ══════════════════════════════════════════════════════════════
   manual-all-done.js — 매뉴얼 발송·회신을 일괄로 채운다

   2026 KIC는 매뉴얼을 이미 전부 돌렸고 회신도 다 받았는데, 체크리스트에는
   한 곳도 안 찍혀 있었다. 52곳을 손으로 두 번씩 누르는 대신 한 번에 채운다.

   이미 날짜가 적힌 곳은 건드리지 않는다 — 실제로 주고받은 날이 적혀 있을 수
   있고, 오늘 날짜로 덮으면 그 기록이 사라진다.

   취소한 기업은 빼놓는다. 매뉴얼을 주고받은 상대가 아닌데 완료로 찍으면
   "몇 곳 남았나"를 셀 때 분모가 틀어진다.

     node db/manual-all-done.js [--date 2026-09-06] [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const EVENT = arg('--event') || '2026 KIC';
const DATE = arg('--date') || new Date().toISOString().slice(0, 10);

if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error(`날짜 형식이 아닙니다: ${DATE}`); process.exit(1);
}

const blank = (v) => !String(v || '').trim();

(async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, company_name, status, manual_sent_at, manual_replied_at
         FROM exhibitors WHERE event_id = $1 ORDER BY company_name`, [EVENT]);

    const skip = rows.filter((r) => String(r.status || '').trim() === '취소');
    const live = rows.filter((r) => !skip.includes(r));

    const plan = live
      .map((r) => ({ r, sent: blank(r.manual_sent_at), rep: blank(r.manual_replied_at) }))
      .filter((p) => p.sent || p.rep);

    console.log(`${EVENT} 참가기업 ${rows.length}곳 — 채울 곳 ${plan.length}곳 · 날짜 ${DATE}\n`);
    plan.forEach(({ r, sent, rep }) => console.log(
      `   ${r.company_name.padEnd(24)} ${sent ? '발송' : '  ·  '} ${rep ? '회신' : '  ·  '}`));

    const kept = live.filter((r) => !blank(r.manual_sent_at) || !blank(r.manual_replied_at));
    if (kept.length) {
      console.log(`\n■ 이미 적힌 날짜가 있어 그대로 두는 곳 ${kept.length}곳`);
      kept.forEach((r) => console.log(
        `   ${r.company_name.padEnd(24)} 발송 ${r.manual_sent_at || '-'} · 회신 ${r.manual_replied_at || '-'}`));
    }
    if (skip.length) {
      console.log(`\n■ 취소라서 건드리지 않음 ${skip.length}곳`);
      skip.forEach((r) => console.log(`   ${r.company_name}`));
    }

    if (DRY) { console.log('\n--dry 라서 아무것도 바꾸지 않았습니다.'); return; }

    await client.query('BEGIN');
    let seq = 0;
    for (const { r, sent, rep } of plan) {
      const set = [], val = [r.id];
      if (sent) { val.push(DATE); set.push(`manual_sent_at = $${val.length}`); }
      if (rep)  { val.push(DATE); set.push(`manual_replied_at = $${val.length}`); }
      await client.query(`UPDATE exhibitors SET ${set.join(', ')} WHERE id = $1`, val);
    }
    await client.query(
      `INSERT INTO activity_log (id, ts, email, name, type, action, target, detail)
       VALUES ($1,$2,'','정리 스크립트','edit','매뉴얼 일괄 체크',$3,$4)`,
      [`L-${Date.now()}-${seq++}`, new Date().toISOString(), EVENT,
        `매뉴얼 발송·회신을 <b>${plan.length}곳</b>에 ${DATE}로 채움 (이미 적힌 날짜와 취소 기업은 제외)`]);
    await client.query('COMMIT');
    console.log(`\n반영 완료 — ${plan.length}곳`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
