/* ══════════════════════════════════════════════════════════════
   add-contact-rounds.js — 컨택(TM/DM 차수) 표 세 개를 만든다

     contact_rounds · round_members · contact_attempts
   정의는 schema.sql 끝의 «컨택 — TM/DM 차수»와 같다.

     node db/add-contact-rounds.js          (시험)
     node db/add-contact-rounds.js --apply
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');
const APPLY = process.argv.includes('--apply');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS contact_rounds');
  if (start < 0) throw new Error('schema.sql에서 contact_rounds 정의를 못 찾았어요');
  const block = sql.slice(start);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 한 문장씩 — 여러 문장을 한 번에 보내면 드라이버에 따라 첫 문장만 돈다
    for (const stmt of block.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await client.query(stmt);
    for (const t of ['contact_rounds', 'round_members', 'contact_attempts']) {
      const r = await client.query(`SELECT count(*) n FROM ${t}`);
      console.log(`${t}: 준비됨 (지금 ${r.rows[0].n}줄)`);
    }
    if (!APPLY) { await client.query('ROLLBACK'); console.log('\n시험 실행 — --apply로 만듭니다.'); return; }
    await client.query('COMMIT');
    console.log('만들었어요.');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error(e); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})();
