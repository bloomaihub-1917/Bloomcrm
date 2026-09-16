/* 기업이 무엇을 취급하는지 적어 둘 칸을 만든다.

   지금까지 «전시품목»은 연락처에만 있었다. 그런데 그건 사람이 아니라 회사에
   붙는 값이다 — 같은 회사 사람 둘이 서로 다른 품목을 취급하지는 않는다.
   그래서 담당자를 아직 못 찾은 회사는 품목을 적어 둘 데가 없었고, 셀러 명단의
   카테고리 열(LED·음향·렌탈,포토 …)이 갈 곳이 없어 통째로 버려졌다.

   섹터와는 쓰임이 다르다. 섹터는 고르는 값이라 열일곱 개로 묶여 있고, 품목은
   적는 값이라 «렌탈,포토»처럼 회사가 실제로 하는 일을 그대로 담는다. 셀러를
   찾을 때 «음향 업체»로 한 번 좁히고 «통역시스템»으로 다시 찾는 두 단계가
   그래서 가능해진다.

     node db/add-org-products.js                                             */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS products TEXT`);
  console.log('✓ orgs.products');
  const r = await pool.query(`SELECT count(*)::int n FROM orgs WHERE COALESCE(products,'') <> ''`);
  console.log(`취급 품목이 적힌 기업 ${r.rows[0].n}곳`);
  await pool.end();
})();
