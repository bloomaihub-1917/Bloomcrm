/* ══════════════════════════════════════════════════════════════
   add-mail-read.js — 받은 메일에 «읽음» 칸을 붙인다

   받은메일함에서 가져온 메일이 쌓이기 시작했는데, 누가 읽었는지·처리했는지를
   구분하지 않으면 사람마다 같은 메일을 다시 열거나 아무도 안 본 채 지나간다.
   처리 여부는 이미 있는 status('open'/'done')를 쓰고, 읽음만 새로 붙인다.

     read_at   처음 펼쳐 본 시각(«YYYY-MM-DD HH:mm»). 비면 안 읽음
     read_by   그 사람 메일 주소

   그리고 이미 가져온 받은 메일은 «처리 안 함·안 읽음»으로 둔다 — 가져올 때 'done'으로
   넣었던 것을 'open'으로. 사람이 처리한 기록이 아니라 가져오기가 붙인 값이었다.

     node db/add-mail-read.js          (시험)
     node db/add-mail-read.js --apply
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');
const APPLY = process.argv.includes('--apply');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of ['speaker_logs', 'exhibitor_logs']) {
      await client.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS read_at TEXT`);
      await client.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS read_by TEXT`);
      const r = await client.query(`
        UPDATE ${t} SET status = 'open'
         WHERE direction = 'in' AND author_name LIKE '%받은메일함에서 가져옴%'
           AND status = 'done' AND COALESCE(read_at, '') = ''`);
      console.log(`${t}: 칸 붙임 · 받은 메일 ${r.rowCount}건을 «처리 안 함»으로`);
    }
    if (!APPLY) { await client.query('ROLLBACK'); console.log('\n시험 실행 — --apply로 바꿉니다.'); return; }
    await client.query('COMMIT');
    console.log('바꿨어요.');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error(e); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})();
