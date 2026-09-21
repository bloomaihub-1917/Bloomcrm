/* ══════════════════════════════════════════════════════════════
   seed-org-kind-agency.js — 기업 종류에 «유관기관»을 세운다

   지금 종류는 전시참가기업·잠재고객사·벤더시공사 셋뿐이다. 셋 다 돈이 오가는
   상대를 가리킨다 — 부스를 사는 쪽, 발주하는 쪽, 우리가 사서 쓰는 쪽.
   그런데 바이오 유관기관 91곳(식약처·학회·진흥원)은 그중 어디도 아니다.
   «잠재고객사»로 넣으면 영업 파이프라인을 열 때마다 학회 47곳을 지나쳐야 하고,
   빼 두면 메일링 대상을 찾을 때 안 잡힌다.

   그래서 종류를 하나 세운다. 분야(바이오·임상)와 섹터(공공기관·협∙단체)는
   따로 달리므로, 이 종류는 «거래 상대가 아니라 관계를 맺어 두는 곳»만 뜻한다.

   목록 자체는 설정 › 선택 목록 › 기업 종류에서 고칠 수 있다. 여기서 심는 건
   이름·색·순서를 한 번에 맞춰 두기 위해서다.

     node db/seed-org-kind-agency.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

/* 순서는 40 — 기존 셋(10·20·30) 다음에 붙는다.
   색은 p-indigo. 남색 계열은 아직 기업 종류에 안 쓰여서 목록에서 바로 갈린다. */
const ROW = {
  id: 'CD-org_kind-유관기관',
  list_key: 'org_kind',
  event_id: '',
  code: '유관기관',
  label: '유관기관',
  cls: 'p-indigo',
  note: '거래 상대가 아니라 관계를 맺어 두는 곳 — 부처·학회·협회·진흥원',
  active: '',
  sort_order: '40',
  included: '',
};

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const have = await client.query(
      `SELECT id, label FROM code_lists WHERE list_key = 'org_kind' AND code = $1`, [ROW.code]);

    if (have.rows.length) {
      console.log(`이미 있습니다 — «${have.rows[0].label}». 건드리지 않습니다.`);
    } else {
      const cols = Object.keys(ROW);
      await client.query(
        `INSERT INTO code_lists (${cols.join(', ')})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
        cols.map((c) => ROW[c]));
      console.log(`추가 — ${ROW.label} (${ROW.cls}, 순서 ${ROW.sort_order})`);
    }

    const after = (await client.query(
      `SELECT code, label FROM code_lists
        WHERE list_key = 'org_kind' AND COALESCE(active,'') <> 'no'
        ORDER BY sort_order`)).rows;
    console.log(`\n기업 종류 ${after.length}종: ${after.map((r) => r.label).join(' · ')}`);

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
