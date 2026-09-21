/* ══════════════════════════════════════════════════════════════
   seed-bio-agency-sector.js — «바이오 헬스 유관기관» 섹터를 세우고 붙인다

   유관기관 92곳에는 성격 섹터(공공기관·협∙단체…)만 달려 있다. 그 섹터들은
   공통 도메인이라 분야를 «바이오·임상»으로 좁히면 한 곳도 안 잡힌다 —
   같은 «공공기관»을 건설·관광 기관도 쓰기 때문에 성격 섹터를 바이오로
   옮길 수는 없다.

   그래서 분야를 지는 섹터를 따로 하나 세워 함께 단다. 전에는 화면의 분야
   버튼이 만드는 «바이오·임상 업종 미정»을 썼는데, 부처나 학회에는 애초에
   «업종»이 없어 목록에서 미완성으로 보였다. 이름만 제대로 지으면 같은 일을
   한다.

   기관은 섹터를 둘 달게 된다 — 성격 하나, 분야 하나.
     국립암센터   공공기관 | 바이오 헬스 유관기관
     대한암학회   협∙단체  | 바이오 헬스 유관기관

   이러면 «공공기관»으로도, 분야 «바이오·임상»으로도 같은 기관이 잡힌다.

     node db/seed-bio-agency-sector.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const SECTOR = { id: 'bioagency', name: '바이오 헬스 유관기관', domain: 'bio' };
const TODAY = new Date().toISOString().slice(0, 10);

/* 대상 — 이번에 넣은 기관(id에 _bio)과, 전부터 있어서 분야만 더해 준 3곳 */
const ALSO = ['식품의약품안전처', '오송첨단의료산업진흥재단', '한국생명공학연구원'];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const have = await client.query(`SELECT id, name, domain FROM sectors WHERE id = $1 OR name = $2`,
      [SECTOR.id, SECTOR.name]);
    if (have.rows.length) {
      console.log(`섹터 «${have.rows[0].name}» 이미 있습니다 — 그대로 씁니다.`);
    } else {
      await client.query(
        `INSERT INTO sectors (id, name, parent, domain, canonical) VALUES ($1, $2, '', $3, '')`,
        [SECTOR.id, SECTOR.name, SECTOR.domain]);
      console.log(`섹터 «${SECTOR.name}» 만듦 (분야: 바이오·임상)`);
    }

    const targets = (await client.query(
      `SELECT id, name_ko, sectors FROM orgs
        WHERE id LIKE '%\\_bio%' OR name_ko = ANY($1)`, [ALSO])).rows;

    let added = 0; let skip = 0;
    for (const o of targets) {
      const cur = String(o.sectors || '').split('|').map((s) => s.trim()).filter(Boolean);
      if (cur.includes(SECTOR.name)) { skip++; continue; }
      await client.query(`UPDATE orgs SET sectors = $2, updated_at = $3 WHERE id = $1`,
        [o.id, [...cur, SECTOR.name].join('|'), TODAY]);
      added++;
    }

    console.log(`붙임 ${added}곳${skip ? ` · 이미 있어 건너뜀 ${skip}곳` : ''}`);

    const cnt = (await client.query(
      `SELECT count(*) c FROM orgs WHERE sectors LIKE '%' || $1 || '%'`, [SECTOR.name])).rows[0].c;
    console.log(`\n«${SECTOR.name}» 달린 기관 ${cnt}곳`);

    const mix = (await client.query(
      `SELECT sectors, count(*) c FROM orgs WHERE sectors LIKE '%' || $1 || '%'
        GROUP BY sectors ORDER BY c DESC`, [SECTOR.name])).rows;
    mix.forEach((r) => console.log(`   ${String(r.c).padStart(3)}  ${r.sectors}`));

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
