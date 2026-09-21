/* ══════════════════════════════════════════════════════════════
   strip-bio-domain-sector.js — 유관기관에 붙인 «바이오·임상 업종 미정»을 뗀다

   분야를 달려고 이 섹터를 함께 붙였다(화면의 분야 지정 버튼이 쓰는 방식).
   그런데 기관 목록에 «업종 미정»이라는 말이 그대로 보인다 — 기업이라면
   업종을 아직 안 정했다는 뜻이 되지만, 부처나 학회에는 애초에 «업종»이
   없으므로 읽는 사람에게는 미완성으로만 보인다.

   그래서 이번 임포트가 붙인 것만 뗀다. 전부터 이 섹터를 쓰던 기관
   (스마트임상시험신기술개발연구사업단)은 다른 경로로 들어온 것이라 둔다.

   떼면 성격 섹터(공공기관·협∙단체…)만 남는다. 그 섹터들은 공통 도메인이라
   분야 필터에서 «바이오·임상»으로는 더 이상 안 잡힌다 — 분야를 다시 달려면
   이름이 제대로 된 바이오 섹터를 세워 붙여야 한다.

     node db/strip-bio-domain-sector.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const SECTOR = '바이오·임상 업종 미정';
const TODAY = new Date().toISOString().slice(0, 10);

/* 이번 임포트가 만든 기관은 id로 가려낸다(O-<stamp>_bio<n>).
   기존에 있어서 분야만 더해 준 3곳은 이름으로 짚는다. */
const ALSO = ['식품의약품안전처', '오송첨단의료산업진흥재단', '한국생명공학연구원'];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const targets = (await client.query(
      `SELECT id, name_ko, sectors FROM orgs
        WHERE sectors LIKE '%' || $1 || '%'
          AND (id LIKE '%\\_bio%' OR name_ko = ANY($2))`, [SECTOR, ALSO])).rows;

    let done = 0; let emptied = 0;
    for (const o of targets) {
      const left = String(o.sectors || '').split('|')
        .map((s) => s.trim()).filter((s) => s && s !== SECTOR);
      if (!left.length) emptied++;
      await client.query(`UPDATE orgs SET sectors = $2, updated_at = $3 WHERE id = $1`,
        [o.id, left.join('|'), TODAY]);
      done++;
    }

    console.log(`«${SECTOR}» 제거 — ${done}곳`);
    if (emptied) console.log(`   그중 ${emptied}곳은 섹터가 비었습니다`);

    const rest = (await client.query(
      `SELECT name_ko FROM orgs WHERE sectors LIKE '%' || $1 || '%'`, [SECTOR])).rows;
    console.log(`남아서 이 섹터를 쓰는 기관 ${rest.length}곳${
      rest.length ? `: ${rest.map((r) => r.name_ko).join(', ')}` : ''}`);

    const kinds = (await client.query(
      `SELECT sectors, count(*) c FROM orgs WHERE kind = '유관기관'
        GROUP BY sectors ORDER BY c DESC`)).rows;
    console.log('\n유관기관 섹터 분포:');
    kinds.forEach((r) => console.log(`   ${String(r.c).padStart(3)}  ${r.sectors || '(없음)'}`));

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
