/* ══════════════════════════════════════════════════════════════
   split-book-order.js — 44번을 둘로 나누고 뒤를 한 칸씩 민다

   서울대학교병원(39-1)과 분당서울대학교병원(39-2)이 부스를 나눠 쓰면서 도록
   순번을 둘 다 44로 받아 왔다. 도록에는 각각 실리므로 번호를 따로 준다.

     44 서울대학교병원      (그대로)
     44 분당서울대학교병원  → 45
     45~50 여섯 곳          → 46~51

   번호가 겹치지 않게 큰 번호부터 올린다. 작은 쪽부터 올리면 45를 46으로 만드는
   순간 이미 46인 곳과 부딪친다.

     node db/split-book-order.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EVENT = '2026 KIC';
const KEEP = '서울대학교병원';        // 44를 그대로 갖는 쪽
const MOVE = '분당서울대학교병원';    // 45로 가는 쪽
const PIVOT = 44;

(async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id, company_name, booth_no, book_order, status
         FROM exhibitors WHERE event_id = $1`, [EVENT]);

    const num = (r) => Number(String(r.book_order || '').replace(/[^0-9]/g, '')) || 0;

    const keep = rows.find((r) => r.company_name === KEEP);
    const move = rows.find((r) => r.company_name === MOVE);
    if (!keep || !move) throw new Error('두 병원 중 한 곳을 못 찾았습니다.');
    if (num(keep) !== PIVOT || num(move) !== PIVOT) {
      throw new Error(`두 곳 모두 ${PIVOT}번이어야 합니다 — 지금 ${num(keep)} / ${num(move)}`);
    }

    // 45 이상은 전부 한 칸씩 뒤로. 분당은 45로 새로 들어가므로 여기서 뺀다.
    const shift = rows.filter((r) => r.id !== move.id && num(r) >= PIVOT + 1)
      .sort((a, b) => num(b) - num(a));   // 큰 번호부터

    const plan = [
      ...shift.map((r) => ({ id: r.id, name: r.company_name, from: num(r), to: num(r) + 1 })),
      { id: move.id, name: move.company_name, from: PIVOT, to: PIVOT + 1 },
    ];

    console.log(`${KEEP} ${num(keep)}번 유지\n`);
    console.log('바꿀 곳:');
    plan.slice().sort((a, b) => a.from - b.from)
      .forEach((p) => console.log(`   ${String(p.from).padStart(3)} → ${String(p.to).padStart(3)}  ${p.name}`));

    if (DRY) { console.log('\n--dry 라서 아무것도 바꾸지 않았습니다.'); return; }

    await client.query('BEGIN');
    for (const p of plan) {
      await client.query('UPDATE exhibitors SET book_order = $1 WHERE id = $2', [String(p.to), p.id]);
    }
    await client.query('COMMIT');

    const { rows: after } = await client.query(
      `SELECT company_name, booth_no, book_order FROM exhibitors
        WHERE event_id = $1 AND book_order ~ '^[0-9]+$' AND book_order::int BETWEEN 43 AND 52
        ORDER BY book_order::int, booth_no`, [EVENT]);
    console.log('\n반영 후 43~52번:');
    after.forEach((r) => console.log(`   ${String(r.book_order).padStart(3)} ${r.company_name} (${r.booth_no || '-'})`));
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
