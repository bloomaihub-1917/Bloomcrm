/* AIA 메일링 리스트를 AIASK의 «타겟»으로 되돌린다.

   앞서 메일링 리스트를 따로 행사로 세웠는데, 그건 행사가 아니다. 주최측에서
   받은 «AIASK에 올 수 있는 사람» 명단이고, 1차 뉴스레터를 뿌린 대상이다.
   그 중에 실제로 등록하는 사람이 참가자가 된다.

   따로 행사로 두면 «AIA 메일링에 97명이 참여했다»가 되어, 있지도 않은 행사에
   사람이 온 것으로 센다. 행사는 AIASK 하나고, 97명은 그 행사의 타겟이다.

   그 구분은 이제 참여 기록의 확정일이 한다(db/schema.sql의 confirmed_at).
   비어 있으면 타겟, 날짜가 있으면 그날 참가가 확정됐다는 뜻이라, 역할을
   바꿔 쓸 필요가 없다. 그래서 «잠재참가자» 역할도 되돌린다 — 확정 여부가
   하는 일을 역할이 또 하면, 한 사람의 상태가 두 군데에 적히고 둘이 어긋난다.

     node db/merge-aia-mailing-into-aiask.js [--dry]                        */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const FROM = 'aia 메일링 리스트';
const TO = 'AIA';
const OLD_ROLE = '잠재참가자';
const NEW_ROLE = '참가자';

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* 옮긴 뒤 AIASK에 같은 사람·같은 역할이 둘이 되면 안 된다 — 행사별 보기는
       사람으로 접지만, 명단을 내보내면 같은 이름이 두 줄로 나온다. */
    const dup = (await client.query(
      `SELECT count(*)::int n FROM participations a
        WHERE a.event_id = $1
          AND EXISTS (SELECT 1 FROM participations b
                       WHERE b.event_id = $2 AND b.contact_id = a.contact_id
                         AND b.role = $3)`, [FROM, TO, NEW_ROLE])).rows[0].n;
    if (dup) {
      const del = await client.query(
        `DELETE FROM participations a
          WHERE a.event_id = $1
            AND EXISTS (SELECT 1 FROM participations b
                         WHERE b.event_id = $2 AND b.contact_id = a.contact_id
                           AND b.role = $3)`, [FROM, TO, NEW_ROLE]);
      console.log(`AIASK에 이미 같은 역할로 있어 지운 중복 ${del.rowCount}건`);
    }

    const moved = await client.query(
      `UPDATE participations SET event_id = $2, role = $3
        WHERE event_id = $1`, [FROM, TO, NEW_ROLE]);
    console.log(`AIASK로 옮긴 참여 기록 ${moved.rowCount}건 (역할 «${NEW_ROLE}», 확정 없음 = 타겟)`);

    const ev = await client.query(`DELETE FROM events WHERE id = $1`, [FROM]);
    if (ev.rowCount) console.log(`행사 «${FROM}» 삭제`);

    /* 쓰는 곳이 없을 때만 역할 목록에서도 뺀다 */
    const still = (await client.query(
      `SELECT count(*)::int n FROM participations WHERE role = $1`, [OLD_ROLE])).rows[0].n;
    if (!still) {
      const pt = await client.query(`DELETE FROM part_types WHERE key = $1`, [OLD_ROLE]);
      if (pt.rowCount) console.log(`참가 유형 «${OLD_ROLE}» 삭제 — 확정 여부가 그 일을 한다`);
    } else {
      console.log(`⚠ «${OLD_ROLE}»를 쓰는 기록이 ${still}건 남아 역할 목록은 그대로 뒀습니다`);
    }

    const after = await client.query(
      `SELECT e.short, p.role,
              count(*) FILTER (WHERE COALESCE(p.confirmed_at,'') <> '')::int 확정,
              count(*) FILTER (WHERE COALESCE(p.confirmed_at,'') =  '')::int 타겟
         FROM participations p JOIN events e ON e.id = p.event_id
        GROUP BY 1, 2 ORDER BY 1, 4 DESC`);
    console.log('\n--- 행사별 (확정 / 타겟) ---');
    after.rows.forEach((x) => console.log(
      `  ${String(x.short).padEnd(18)} ${String(x.role).padEnd(12)} 확정 ${String(x.확정).padStart(3)} · 타겟 ${String(x.타겟).padStart(3)}`));

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
