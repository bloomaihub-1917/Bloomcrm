/* 모객 대상으로 올린 기업이 EVK 전시참가기업으로 잡힌 것을 풀어 준다.

   2026-11-05에 홍보메일·회사소개서로 모은 기업(더페이퍼·옥타놈 차이나·플라츠랩·
   더사랑·에덴 마케팅)은 EVK에 나오는 곳이 아니라 우리가 불러야 할 대상이다.
   업로드 때 연결 행사를 EVK로 둬서 참여 기록이 «전시참가기업»으로 생겼다.

   참여 기록 5건만 지운다(연락처·기업은 그대로). 같은 조건(EVK·전시참가기업·
   앱에서 추가)의 다른 6건은 진짜 참가기업이라 건드리지 않으므로 연락처 id로 좁힌다.
   지우기 전에 줄을 JSON 파일로 남긴다.

     node db/oneoff/unlink-evk-recruit-targets.js [--dry]                          */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../pool');

const DRY = process.argv.includes('--dry');
const CONTACT_IDS = ['1793865277865000', '1793865277865001', '1793865277865002', '1793865277865004', '1793865277865005'];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM participations WHERE event_id = 'EVK' AND role = '전시참가기업' AND contact_id = ANY($1)`,
      [CONTACT_IDS]);
    console.log(`지울 참여 기록 ${rows.length}건 (기대 5건)`);
    if (rows.length !== CONTACT_IDS.length) throw new Error('건수가 달라 중단합니다.');
    if (DRY) { await client.query('ROLLBACK'); console.log('--dry 라서 되돌렸습니다.'); return; }
    const file = path.join(__dirname, `unlink-evk-recruit-targets-backup-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(rows, null, 2));
    await client.query('DELETE FROM participations WHERE id = ANY($1)', [rows.map((r) => r.id)]);
    await client.query('COMMIT');
    console.log('지웠습니다. 백업:', file);
  } catch (e) { await client.query('ROLLBACK'); console.error(e.message); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})();
