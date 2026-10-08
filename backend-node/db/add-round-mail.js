/* ══════════════════════════════════════════════════════════════
   add-round-mail.js — 컨택 차수에 DM 양식 칸을 붙인다

     mail_subject_ko · mail_body_ko · mail_subject_en · mail_body_en
   차수마다 보낼 메일 문구다. «메일 보내기» 창에서 고쳐 저장한다.

     node db/add-round-mail.js          (시험)
     node db/add-round-mail.js --apply
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');
const APPLY = process.argv.includes('--apply');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of ['mail_subject_ko', 'mail_body_ko', 'mail_subject_en', 'mail_body_en']) {
      await client.query(`ALTER TABLE contact_rounds ADD COLUMN IF NOT EXISTS ${c} TEXT`);
    }
    console.log('contact_rounds: DM 양식 칸 붙임');
    if (!APPLY) { await client.query('ROLLBACK'); console.log('\n시험 실행 — --apply로 바꿉니다.'); return; }
    await client.query('COMMIT');
    console.log('바꿨어요.');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error(e); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})();
