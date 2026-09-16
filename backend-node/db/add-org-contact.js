/* 기업의 대표 전화·메일을 적어 둘 칸을 만든다.

   명단에는 담당자 이름 없이 대표번호와 대표메일만 적힌 줄이 106개 있다
   (셀러 41 · 바이어 65). 아직 누구를 찾아야 할지 모르는 회사들이다.

   연락처로 만들 수는 없다 — 이름이 없으면 목록에서 찾을 수도, 메일 첫머리에
   부를 수도 없어서 업로드도 그런 줄은 사람으로 만들지 않는다. 그렇다고 버리면
   전화 한 통이면 담당자를 알아낼 수 있는 곳 106군데를 통째로 잃는다.

   그래서 회사에 붙인다. 대표번호는 원래 사람이 아니라 회사의 것이다.

     node db/add-org-contact.js                                             */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  for (const col of ['phone', 'email']) {
    await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS ${col} TEXT`);
    console.log(`✓ orgs.${col}`);
  }
  const r = await pool.query(
    `SELECT count(*) FILTER (WHERE COALESCE(phone,'') <> '')::int p,
            count(*) FILTER (WHERE COALESCE(email,'') <> '')::int e FROM orgs`);
  console.log(`대표 전화 ${r.rows[0].p}곳 · 대표 메일 ${r.rows[0].e}곳`);
  await pool.end();
})();
