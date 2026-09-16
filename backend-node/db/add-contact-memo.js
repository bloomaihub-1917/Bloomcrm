/* 기본 항목에 없는 값을 적어 둘 칸 세 개를 연락처에 만든다.

   업로드 파일에는 우리 DB의 기본 항목으로 떨어지지 않는 열이 자주 섞여 온다
   (AIA Number, Board Member, Membership Type …). 지금까지는 이런 열을
   "매핑 안 함"으로 두면 그대로 버려졌고, 억지로 «메모»에 넣으면 그건 연락처가
   아니라 소속 기업의 메모로 흘러가서 같은 회사 사람 여럿이 서로의 값을 덮었다.

   memo1/2/3  연락처 자신에게 붙는 자유 칸. 업로드 매핑에서 골라 쓴다.
   prefix     Mr./Dr./Prof. 같은 경칭. 메모로 흘리지 않고 제 칸에 둔다 —
              영문 메일의 호칭에 그대로 쓰이는 값이라 검색·치환이 되어야 한다.

   실행: node db/add-contact-memo.js (여러 번 실행해도 안전) */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  for (const col of ['memo1', 'memo2', 'memo3', 'prefix']) {
    await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ${col} TEXT`);
    console.log(`✓ contacts.${col}`);
  }
  await pool.end();
})();
