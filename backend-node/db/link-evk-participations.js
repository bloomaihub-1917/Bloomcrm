/* 셀러·바이어 명단의 사람을 EVENTKOREA 2027에 건다.

   지금까지 540명은 행사 없이 떠 있었다. 분야로는 이 사람들을 추릴 수가
   없다 — 바이어의 섹터(지자체·협회·대학)는 바이오에서도 건축에서도 쓰는
   조직 형태라 공통에 있기 때문이다. EVENTKOREA 사람만 보는 축은 행사다.

   역할은 명단이 곧 답이다.
     셀러  → 전시참가기업   우리가 부스를 팔 상대
     바이어 → 바이어        우리가 행사를 수주할 상대
   둘을 나눠 두면 마스터DB에서 «행사 EVENTKOREA + 유형 바이어»로 141명만
   바로 추려진다.

   아직 «참가 확정»이 아니라 «이 행사로 만날 상대»라는 뜻이다. 확정되면
   그 자리에서 역할을 고치면 된다 — 명단에 있었다는 사실은 남는다.

   이미 같은 행사·같은 역할로 걸린 사람은 건너뛴다.

     node db/link-evk-participations.js [--dry]                             */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EVENT = 'EVK';
const MATCHED = '✅ 명단 일괄 등록';

/* 연락처의 출처 → 참가 역할. 출처는 명단을 올릴 때 우리가 적어 둔 값이다. */
const ROLE_BY_SOURCE = [
  { like: '셀러 명단%',  role: '전시참가기업' },
  { like: '바이어 명단%', role: '바이어' },
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ev = (await client.query(`SELECT id, short FROM events WHERE id = $1`, [EVENT])).rows[0];
    if (!ev) throw new Error(`«${EVENT}» 행사가 없습니다.`);

    /* 이미 이 행사에 걸린 사람 — 같은 사람을 또 걸면 명단 인원이 부풀어
       보인다(행사별 보기는 참여 기록을 센다). */
    const already = new Set((await client.query(
      `SELECT contact_id, role FROM participations WHERE event_id = $1`, [EVENT]))
      .rows.map((r) => `${r.contact_id}|${r.role}`));

    const made = []; const skipped = [];
    let seq = 0;
    const stamp = Date.now();

    for (const { like, role } of ROLE_BY_SOURCE) {
      const { rows } = await client.query(
        `SELECT id, "nameKo", "nameEn" FROM contacts WHERE source LIKE $1 ORDER BY id`, [like]);
      for (const c of rows) {
        if (already.has(`${c.id}|${role}`)) { skipped.push(c.id); continue; }
        await client.query(
          `INSERT INTO participations (id, event_id, contact_id, role, note, matched)
           VALUES ($1, $2, $3, $4, '', $5)`,
          [`P-${stamp}-e${seq++}`, EVENT, c.id, role, MATCHED]);
        already.add(`${c.id}|${role}`);
        made.push({ id: c.id, name: c.nameKo || c.nameEn, role });
      }
    }

    const by = made.reduce((m, v) => m.set(v.role, (m.get(v.role) || 0) + 1), new Map());
    console.log(`«${ev.short}»에 건 사람 ${made.length}명`);
    [...by].forEach(([r, n]) => console.log(`   ${String(n).padStart(3)}  ${r}`));
    if (skipped.length) console.log(`이미 걸려 있어 건너뛴 ${skipped.length}명`);

    const tot = await client.query(
      `SELECT count(DISTINCT contact_id)::int n FROM participations WHERE event_id = $1`, [EVENT]);
    console.log(`\n«${ev.short}» 참여 인원 ${tot.rows[0].n}명`);

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
