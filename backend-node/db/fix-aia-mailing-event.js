/* «aia 메일링 리스트»를 정식 행사로 세우고, 역할을 «잠재참가자»로 바꾼다.

   참여 기록 97건이 «aia 메일링 리스트»를 가리키는데 행사 표에는 그런 행사가
   없었다. 업로드할 때 «행사명 직접 입력»으로 넣으면 참여 기록만 생기고 행사
   자체는 안 만들어진다 — 그래서 마스터DB의 행사 칩에도 안 잡히고, 연락처
   줄에는 색도 짧은 이름도 없는 원문 글자가 그대로 찍혔다.

   메일링 리스트는 «앞으로 올 수도 있는 사람»이고 AIASK는 «실제로 온 사람»이라
   둘은 갈라 둬야 한다. 그런데 역할이 둘 다 «참가자»라 이름만으로는 구분이
   안 된다. 그래서 참가 유형에 «잠재참가자»를 더하고 메일링 쪽을 그리로 옮긴다.

   AIASK에 걸린 96건은 건드리지 않는다 — 그건 이 스크립트가 판단할 일이
   아니다(정말 왔는지는 사람만 안다).

     node db/fix-aia-mailing-event.js [--dry]                               */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EV = 'aia 메일링 리스트';
const ROLE = '잠재참가자';

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* 1) 행사 등록 — id는 참여 기록이 가리키는 문자열 그대로여야 이어진다 */
    const had = (await client.query(`SELECT id FROM events WHERE id = $1`, [EV])).rows[0];
    if (!had) {
      await client.query(
        `INSERT INTO events (id, name, short, date_start, date_end, location, color,
                             host, organizer, our_role, theme, scale, homepage, summary, outcome)
         VALUES ($1, 'AIA 메일링 리스트', 'AIA 메일링', '', '', '', '#94A3B8',
                 '', '', '', '', '', '', '행사가 아니라 명단이다 — AIASK로 부를 후보를 모아 둔 곳.', '')`,
        [EV]);
      console.log(`행사 «AIA 메일링 리스트» 등록`);
    } else {
      console.log('행사가 이미 있어 그대로 둡니다.');
    }

    /* 2) 참가 유형에 «잠재참가자»를 더한다 — 목록에 없으면 드롭다운에 안 뜬다 */
    const hasRole = (await client.query(`SELECT key FROM part_types WHERE key = $1`, [ROLE])).rows[0];
    if (!hasRole) {
      await client.query(`INSERT INTO part_types (key, label, cls) VALUES ($1, $1, 'p-gray')`, [ROLE]);
      console.log(`참가 유형 «${ROLE}» 추가`);
    }

    /* 3) 메일링 쪽 역할을 바꾼다 */
    const r = await client.query(
      `UPDATE participations SET role = $2 WHERE event_id = $1 AND role <> $2`, [EV, ROLE]);
    console.log(`«${EV}» 참여 기록 ${r.rowCount}건의 역할을 «${ROLE}»로`);

    const after = await client.query(
      `SELECT e.short, p.role, count(*)::int n
         FROM participations p JOIN events e ON e.id = p.event_id
        GROUP BY 1, 2 ORDER BY 1, n DESC`);
    console.log('\n--- 행사별 참여 기록 ---');
    after.rows.forEach((x) => console.log(`  ${String(x.short).padEnd(18)} ${String(x.role).padEnd(12)} ${x.n}`));

    const orphan = await client.query(
      `SELECT count(*)::int n FROM participations p
        WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = p.event_id)`);
    console.log(`\n행사 표에 없는 행사를 가리키는 참여 기록: ${orphan.rows[0].n}건`);

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
