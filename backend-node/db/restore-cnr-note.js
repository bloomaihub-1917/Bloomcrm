/* ══════════════════════════════════════════════════════════════
   restore-cnr-note.js — 덮어써 사라진 도면 메모를 되살린다

   2026-09-14 10:12에 두 사람이 같은 칸을 32초 차이로 고쳤다.

     10:12:13 송혜인  "• 전기 사용량(예상): 5kW
                       • 인쇄제작물 설치 계획: X배너 4개 내외"
     10:12:45 정다교  이전으로 본 값 ""  →  "전기 사용량 5KW"

   정다교 님 화면은 32초 전 저장을 못 봤다(기록의 «이전 값»이 빈칸이다).
   그래서 «X배너 4개 내외»가 사라졌고, 지금까지 그대로다.

   정다교 님이 적은 «전기 사용량 5KW»는 송혜인 님 글의 첫 줄에 이미 들어 있다.
   그래서 합칠 것이 없다 — 원문을 되돌리면 양쪽 내용이 다 산다.

     node db/restore-cnr-note.js --dry
     node db/restore-cnr-note.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');
const DRY = process.argv.includes('--dry');

const LOST = '• 전기 사용량(예상): 5kW\n• 인쇄제작물 설치 계획: X배너 4개 내외';

(async () => {
  try {
    const { rows } = await pool.query(
      `SELECT id, company_name, booth_design_note FROM exhibitors
       WHERE company_name LIKE '%씨엔알리서치%' AND event_id = '2026 KIC'`);
    if (!rows.length) { console.log('기업을 못 찾았어요.'); return; }
    const x = rows[0];
    console.log(`${x.company_name}`);
    console.log(`  지금  : ${JSON.stringify(x.booth_design_note)}`);
    console.log(`  되돌림: ${JSON.stringify(LOST)}`);
    if (x.booth_design_note === LOST) { console.log('\n이미 되돌아가 있어요.'); return; }
    if (DRY) { console.log('\n--dry 라서 아무것도 바꾸지 않았습니다.'); return; }

    await pool.query(`UPDATE exhibitors SET booth_design_note = $1, updated_at = $2 WHERE id = $3`,
      [LOST, new Date().toISOString().slice(0, 10), x.id]);
    await pool.query(
      `INSERT INTO activity_log (id,ts,email,name,type,action,target,detail,link)
       VALUES ($1,$2,'','정리 스크립트','edit','덮어쓴 메모 되살림',$3,$4,$5)`,
      ['AL-' + Date.now(), new Date().toISOString(), x.company_name,
        `<b>${x.company_name}</b> 도면 메모를 09-14 10:12 송혜인님 원문으로 되돌렸어요 — `
        + `32초 뒤 덮어써져 «X배너 4개 내외»가 사라져 있었습니다`,
        /* 되돌리기의 되돌리기도 되게 — 덮여 있던 값을 before로 남긴다 */
        JSON.stringify({ kind: 'exhibitor', id: x.id, table: 'exhibitors', row: x.id,
          field: 'booth_design_note', op: 'update',
          before: { booth_design_note: x.booth_design_note },
          after: { booth_design_note: LOST } })]);
    console.log('\n되돌렸습니다. 활동 기록에도 남겼어요(거기서 다시 되돌릴 수 있습니다).');
  } catch (e) {
    console.error('실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end?.();
  }
})();
