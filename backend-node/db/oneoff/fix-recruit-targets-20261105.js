/* 11-05에 올린 모객 대상 기업의 분류·이름을 바로잡는다.

   업로드 때 엑셀의 대분류가 기존 이름으로 흩어져 들어왔다(그래픽·인쇄,
   부스시공·전시장치|무대·음향·조명). 표준 섹터 이름으로 맞추고, 영문 칸에 들어간
   옥타놈 담당자 이름을 국문·영문 칸으로 나눈다. 기업 구분(잠재고객사)은 그대로.

     node db/oneoff/fix-recruit-targets-20261105.js [--dry]                        */
require('dotenv').config();
const pool = require('../pool');
const DRY = process.argv.includes('--dry');

const SECTORS = {
  'O-1793865306458_1': '인쇄/출력',
  'O-1793865306458_2': '부스/무대/구조물',
  'O-1793865306458_3': '부스/무대/구조물',
};
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [id, sec] of Object.entries(SECTORS)) {
      const o = await client.query('UPDATE orgs SET sectors=$1, updated_at=$2 WHERE id=$3', [sec, new Date().toISOString(), id]);
      const c = await client.query('UPDATE contacts SET beat=$1 WHERE org_id=$2', [sec, id]);
      console.log(id, '→', sec, `(기업 ${o.rowCount}, 연락처 ${c.rowCount})`);
    }
    const n = await client.query(
      `UPDATE contacts SET "nameKo"='魏丹', "nameEn"='Anna Wei' WHERE id='1793865277865001' AND "nameKo"='' RETURNING id`);
    console.log('옥타놈 담당자 이름', n.rowCount, '건');
    await client.query(DRY ? 'ROLLBACK' : 'COMMIT');
    console.log(DRY ? '--dry 라서 되돌렸습니다.' : '반영했습니다.');
  } catch (e) { await client.query('ROLLBACK'); console.error(e.message); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})();
