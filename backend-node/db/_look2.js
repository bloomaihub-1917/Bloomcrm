require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const IDS = ['SP-1789090821008_10', 'SP-1789097599495_1'];
(async () => {
  const r = await pool.query(`select * from speakers where id = any($1)`, [IDS]);
  r.rows.forEach((x) => {
    console.log(`\n══ ${x.name_snapshot} (${x.id})`);
    Object.entries(x).forEach(([k, v]) => {
      if (v !== null && v !== '' && k !== 'id') {
        console.log(`   ${k} = ${String(v).slice(0, 90)}${String(v).length > 90 ? '…' : ''}`);
      }
    });
  });
  const a = await pool.query(
    `select ss.id, ss.speaker_id, ss.role, ss.seq, ss.start_at, ss.end_at, ss.title_en,
            ss.abstract_en is not null and ss.abstract_en <> '' as has_abs,
            ss.keywords, ss.talk_format, cs.title_en as sess
       from session_speakers ss left join conf_sessions cs on cs.id = ss.session_id
      where ss.speaker_id = any($1) order by ss.seq`, [IDS]);
  console.log('\n── 배정 ──');
  a.rows.forEach((x) => console.log(`  ${x.id} | ${x.speaker_id.slice(-6)} | ${x.role} | ${x.start_at || ''}-${x.end_at || ''} | 세션: ${x.sess} | 발제: ${x.title_en || '(없음)'} | 초록:${x.has_abs}`));
  await pool.end();
})();
