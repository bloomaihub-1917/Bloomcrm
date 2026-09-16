/* 전시기업을 행사 참여 기록에 잇는다.

   «행사에 들어오면 참가자나 전시기업이 된다»가 이 CRM의 줄기인데, 전시기업
   쪽 가지가 줄기에서 떨어져 있었다. 전시 탭의 exhibitors는 제 표에만 쌓이고
   participations를 만들지 않아서 이런 일이 벌어졌다.

     2025 KIC  전시기업 48곳 · 참여 기록 0건    ← 행사에 사람이 아무도 없다
     2026 KIC  전시기업 58곳 · 참여 기록 87명   ← 6명이 빠져 있다

   그래서 행사 페이지 «참여자»에 전시 담당자가 안 보이고, 참가 확정과도
   무관하고, 분야별 보기에서 그 사람들이 그 행사에 왔다는 사실이 안 잡혔다.

   전시기업으로 등록됐다는 건 부스를 잡았다는 뜻이라 참가가 정해진 것으로
   본다 — 확정일까지 함께 적는다. «초청했지만 아직 등록 안 한» AIASK 96명과
   갈리는 지점이 여기다. 취소된 곳은 뺀다.

   역할이 이미 붙어 있는 사람(연사로도 온 사람)은 역할을 건드리지 않고
   확정만 채운다 — 무엇으로 왔는지는 사람이 적어 둔 것이 맞다.

     node db/link-exhibitors-to-participations.js [--dry]                   */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const ROLE = '전시참가기업';

/* 확정일 — 언제 정해졌는지가 나중에 꼭 문제가 된다. 전시기업 줄에 적힌
   갱신일을 먼저 쓰고, 없으면 행사 시작일, 그것도 없으면 오늘. */
const dayOf = (v) => {
  const t = String(v || '').trim();
  const m = t.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
};

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const today = new Date().toISOString().slice(0, 10);
    const { rows: evs } = await client.query(`SELECT id, short, date_start FROM events`);
    const evMap = new Map(evs.map((e) => [e.id, e]));

    /* 취소된 곳은 참가가 정해진 것이 아니다 */
    const { rows: xs } = await client.query(
      `SELECT id, event_id, org_id, company_name, COALESCE(status,'') status, updated_at
         FROM exhibitors
        WHERE COALESCE(org_id,'') <> '' AND COALESCE(status,'') <> '취소'`);

    /* 이미 걸려 있는 (사람, 행사) — 역할까지 같이 본다 */
    const { rows: parts } = await client.query(
      `SELECT id, event_id, contact_id, role, COALESCE(confirmed_at,'') confirmed_at FROM participations`);
    const byPair = new Map();
    parts.forEach((p) => {
      const k = `${p.event_id}|${p.contact_id}`;
      if (!byPair.has(k)) byPair.set(k, []);
      byPair.get(k).push(p);
    });

    const { rows: cs } = await client.query(
      `SELECT id, org_id, "nameKo", "nameEn" FROM contacts WHERE COALESCE(org_id,'') <> ''`);
    const byOrg = new Map();
    cs.forEach((c) => {
      if (!byOrg.has(c.org_id)) byOrg.set(c.org_id, []);
      byOrg.get(c.org_id).push(c);
    });

    const made = []; const confirmed = []; const noPeople = [];
    let seq = 0;
    const stamp = Date.now();

    for (const x of xs) {
      const people = byOrg.get(x.org_id) || [];
      if (!people.length) { noPeople.push({ ev: x.event_id, name: x.company_name }); continue; }
      const when = dayOf(x.updated_at) || dayOf((evMap.get(x.event_id) || {}).date_start) || today;

      for (const c of people) {
        const had = byPair.get(`${x.event_id}|${c.id}`) || [];
        if (!had.length) {
          const pid = `P-${stamp}-x${seq++}`;
          await client.query(
            `INSERT INTO participations (id, event_id, contact_id, role, note, matched, confirmed_at)
             VALUES ($1, $2, $3, $4, '', $5, $6)`,
            [pid, x.event_id, c.id, ROLE, '✅ 전시 참가기업에서', when]);
          byPair.set(`${x.event_id}|${c.id}`, [{ id: pid, role: ROLE, confirmed_at: when }]);
          made.push({ ev: x.event_id, name: c.nameKo || c.nameEn });
          continue;
        }
        /* 이미 있으면 역할은 두고 확정만 채운다 */
        for (const p of had) {
          if (p.confirmed_at) continue;
          await client.query(`UPDATE participations SET confirmed_at = $2 WHERE id = $1`, [p.id, when]);
          p.confirmed_at = when;
          confirmed.push({ ev: x.event_id, name: c.nameKo || c.nameEn });
        }
      }
    }

    const tally = (arr) => [...arr.reduce((m, v) =>
      m.set(v.ev, (m.get(v.ev) || 0) + 1), new Map())];

    console.log(`새로 만든 참여 기록 ${made.length}건`);
    tally(made).forEach(([e, n]) => console.log(`   ${String((evMap.get(e) || {}).short || e).padEnd(18)} ${n}명`));
    console.log(`\n이미 있던 기록에 확정을 채운 것 ${confirmed.length}건`);
    tally(confirmed).forEach(([e, n]) => console.log(`   ${String((evMap.get(e) || {}).short || e).padEnd(18)} ${n}명`));
    if (noPeople.length) {
      console.log(`\n기업에 묶인 연락처가 없어 건너뛴 전시기업 ${noPeople.length}곳:`);
      console.log('   ' + noPeople.slice(0, 10).map((v) => v.name).join(' · ') + (noPeople.length > 10 ? ' …' : ''));
    }

    const after = await client.query(
      `SELECT e.short,
              count(*) FILTER (WHERE COALESCE(p.confirmed_at,'') <> '')::int 확정,
              count(*) FILTER (WHERE COALESCE(p.confirmed_at,'') =  '')::int 타겟
         FROM participations p JOIN events e ON e.id = p.event_id
        GROUP BY 1 ORDER BY 1`);
    console.log('\n--- 행사별 (확정 / 타겟) ---');
    after.rows.forEach((x) => console.log(
      `  ${String(x.short).padEnd(18)} 확정 ${String(x.확정).padStart(3)} · 타겟 ${String(x.타겟).padStart(3)}`));

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
