/* ══════════════════════════════════════════════════════════════
   cnr-subsidiaries.js — ㈜씨엔알리서치 자회사 5곳을 프로그램북 전용으로 돌린다

   부스 44-46은 ㈜씨엔알리서치 하나가 쓴다. 자회사 다섯은 프로그램북에 이름만
   오르고 매뉴얼·신청서·인보이스·입금은 주고받을 게 없다.

   그대로 두면 부스 수가 다섯 늘고, 체크리스트 열 칸이 영영 미완료로 남는다.
   안 받을 것을 못 받은 것으로 세면 "몇 곳 남았나"가 늘 틀린다.

   지우지는 않는다 — 프로그램북에는 실제로 실려야 하고, 기업DB의 참가 이력도
   남아야 한다. 집계에서만 뺀다.

     node db/cnr-subsidiaries.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EVENT = '2026 KIC';
const HOST = '㈜씨엔알리서치';
const NAMES = ['ABC Bioscience Co., Ltd.', 'C&R SMO Inc.', 'Mediplexus Co., Ltd.',
  'TI Image Pte. Ltd.', 'Trial Informatics Inc.'];

(async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      'SELECT id, company_name, company_key, booth_no, scope, host_key FROM exhibitors WHERE event_id = $1', [EVENT]);

    const host = rows.find((r) => r.company_name === HOST);
    if (!host) { console.error(`대표 기업 ${HOST}를 못 찾았습니다.`); process.exit(1); }

    const targets = NAMES.map((n) => {
      const r = rows.find((x) => x.company_name === n);
      if (!r) console.log(`   못 찾음 — ${n}`);
      return r;
    }).filter(Boolean);

    console.log(`대표 ${host.company_name} (부스 ${host.booth_no || '-'}, key ${host.company_key})\n`);
    console.log(`■ 프로그램북 전용으로 바꿀 곳 ${targets.length}곳`);
    targets.forEach((r) => console.log(
      `   ${r.company_name.padEnd(26)} 참가범위 ${JSON.stringify(r.scope || '')} → "book"`
      + ` · 대표 ${JSON.stringify(r.host_key || '')} → ${JSON.stringify(host.company_key)}`));

    if (targets.length !== NAMES.length) {
      console.log('\n다섯 곳을 다 찾지 못했습니다 — 이름을 확인해주세요.');
      if (!DRY) process.exit(1);
    }
    if (DRY) { console.log('\n--dry 라서 아무것도 바꾸지 않았습니다.'); return; }

    await client.query('BEGIN');
    let seq = 0;
    for (const r of targets) {
      await client.query(
        `UPDATE exhibitors SET scope = 'book', host_key = $2 WHERE id = $1`, [r.id, host.company_key]);
      await client.query(
        `INSERT INTO activity_log (id, ts, email, name, type, action, target, detail)
         VALUES ($1,$2,'','정리 스크립트','edit','참가 범위 변경',$3,$4)`,
        [`L-${Date.now()}-${seq++}`, new Date().toISOString(), r.company_name,
          `<b>프로그램북만</b>으로 바꿈 — ${host.company_name}의 부스(${host.booth_no || '-'})를 함께 씀`]);
    }
    await client.query('COMMIT');
    console.log(`\n반영 완료 — ${targets.length}곳`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
