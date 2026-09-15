/* 프로필 양식도 가이드라인과 함께 나간다 — 보내는 칸을 하나로 합친다.

   보낼 때는 초청·가이드라인·양식이 한 메일에 실린다. 실제로 한 번에
   일어나는 일을 세 칸으로 나누면 세 번 찍거나 한 번도 안 찍게 된다.

   받는 쪽은 합치지 않는다. 이력만 먼저 오고 사진이 며칠 뒤에 오는 일이
   흔하고, 그때 «무엇이 아직 안 왔나»가 이 화면이 답해야 하는 질문이다.

   form_sent_at은 지우지 않고 화면에서만 뺀다. 가이드가 비었는데 양식만
   찍힌 줄은 그 날짜를 가이드로 옮긴다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const dry = process.argv.includes('--dry');

(async () => {
  const r = await pool.query(
    `select id, name_snapshot, form_sent_at from speakers
      where coalesce(form_sent_at,'') <> '' and coalesce(guide_sent_at,'') = ''`);
  console.log(`가이드가 비고 양식만 찍힌 줄: ${r.rows.length}`);
  r.rows.forEach((x) => console.log(`  ${dry ? '· (dry)' : '✓'} ${x.name_snapshot || x.id} → ${x.form_sent_at}`));
  if (!dry && r.rows.length) {
    await pool.query(
      `update speakers set guide_sent_at = form_sent_at
        where coalesce(form_sent_at,'') <> '' and coalesce(guide_sent_at,'') = ''`);
  }
  const a = await pool.query(
    `select count(*) filter (where coalesce(guide_sent_at,'') <> '') as n from speakers`);
  console.log(`\n보냄이 찍힌 연사: ${a.rows[0].n}명`);
  await pool.end();
})();
