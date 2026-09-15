/* 연사의 국적과 거주지를 따로 적는다.

   둘은 다를 수 있고, 다를 때가 문제다. 한국 국적이지만 미국에 사는 연사에게
   연사료와 항공료를 어느 쪽 기준으로 줄지는 행사마다 다르다 — 거주지 기준이면
   해외 송금과 해외 거주자 원천징수가 되고, 항공도 거주지에서 출발한다.

   한 칸에 «국가»만 두면 그 칸이 무엇을 뜻하는지가 사람마다 달라진다. 항공을
   잡는 사람은 거주지로 읽고, 정산하는 사람은 국적으로 읽는다. 그래서 두 칸을
   두고, 어느 쪽을 기준으로 지급하는지(pay_basis)를 따로 적는다 —
   우리가 규칙으로 정하지 않는다. 행사마다 다르다고 했다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COLS = [
  ['nationality',       '국적'],
  ['residence_country', '거주지'],
  ['pay_basis',         "지급 기준 — 'residence' | 'nationality' | ''"],
];

(async () => {
  for (const [c, label] of COLS) {
    await pool.query(`ALTER TABLE speakers ADD COLUMN IF NOT EXISTS ${c} TEXT`);
    console.log(`✓ speakers.${c} — ${label}`);
  }
  const r = await pool.query(
    `select column_name from information_schema.columns where table_name = 'speakers'`);
  console.log(`\nspeakers 열 ${r.rows.length}개`);
  await pool.end();
})();
