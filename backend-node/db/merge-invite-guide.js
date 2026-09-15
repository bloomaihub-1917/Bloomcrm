/* 초청과 가이드라인을 한 칸으로 합친다.

   초청은 사전에 이미 컨택이 끝난 상태로 오고, 가이드라인은 그 초청 메일에
   같이 실어 보낸다. 실제로 한 번에 일어나는 일을 두 칸으로 나눠 두면
   둘 다 찍거나 둘 다 안 찍게 되고, 그러면 칸이 하나 늘었을 뿐이다.

   남기는 칸은 guide_sent_at이다. invite_sent_at은 지우지 않는다 — 열을
   지우는 건 되돌릴 수 없고, 화면에서 빼는 것만으로 충분하다.
   가이드가 비었는데 초청만 찍힌 줄은 그 날짜를 가이드로 옮긴다.

   초청 «회신»(invite_replied_at)은 그대로 둔다. 보낸 것과 받은 것은 다르다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const dry = process.argv.includes('--dry');

(async () => {
  const r = await pool.query(
    `select id, name_snapshot, invite_sent_at from speakers
      where coalesce(invite_sent_at,'') <> '' and coalesce(guide_sent_at,'') = ''`);
  console.log(`가이드가 비고 초청만 찍힌 줄: ${r.rows.length}`);
  r.rows.forEach((x) => console.log(`  ${dry ? '· (dry)' : '✓'} ${x.name_snapshot || x.id} → ${x.invite_sent_at}`));
  if (!dry && r.rows.length) {
    await pool.query(
      `update speakers set guide_sent_at = invite_sent_at
        where coalesce(invite_sent_at,'') <> '' and coalesce(guide_sent_at,'') = ''`);
  }
  const after = await pool.query(
    `select count(*) filter (where coalesce(guide_sent_at,'') <> '') as n from speakers`);
  console.log(`\n가이드 찍힌 연사: ${after.rows[0].n}명`);
  await pool.end();
})();
