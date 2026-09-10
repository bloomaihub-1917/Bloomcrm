/* ══════════════════════════════════════════════════════════════
   add-speaker-tables.js — 컨퍼런스·연사 테이블을 만든다

   schema.sql에 정의를 넣었지만 운영 DB는 이미 떠 있어서, 새 표만 골라 만든다.
   전부 CREATE TABLE IF NOT EXISTS라 여러 번 돌려도 안전하고, 기존 표는
   손대지 않는다.

   schema.sql을 통째로 다시 적용하지 않는 까닭은 그 파일에 ALTER가 섞여 있어
   무엇이 실행되는지 한눈에 보이지 않기 때문이다. 새 표만 다루는 이 파일은
   무엇을 만드는지가 이름부터 분명하다.

     node db/add-speaker-tables.js --dry
     node db/add-speaker-tables.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

const WANT = ['conf_sessions', 'speakers', 'session_speakers', 'speaker_contacts', 'speaker_logs'];

/* schema.sql에서 그 표의 CREATE 문만 떠 온다 — 정의를 두 곳에 적어 두면
   한쪽만 고쳐지는 날이 온다. */
function statementsFor(sql, name) {
  const out = [];
  const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?\\n\\);`, 'g');
  const m = sql.match(re);
  if (m) out.push(...m);
  const idx = new RegExp(`CREATE INDEX IF NOT EXISTS [^;]*ON ${name}\\([^;]*\\);`, 'g');
  const mi = sql.match(idx);
  if (mi) out.push(...mi);
  return out;
}

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  const have = new Set((await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
  )).rows.map((r) => r.table_name));

  let made = 0;
  for (const name of WANT) {
    const stmts = statementsFor(sql, name);
    if (!stmts.length) { console.error(`  ✗ ${name} — schema.sql에서 정의를 찾지 못했습니다`); process.exitCode = 1; return; }

    const exists = have.has(name);
    const cols = (stmts[0].match(/\n  \w+/g) || []).length;
    console.log(`  ${exists ? '있음' : '신규'}  ${name}  (칸 ${cols}개, 문장 ${stmts.length}개)`);
    made += exists ? 0 : 1;

    if (!DRY) for (const st of stmts) await pool.query(st);
  }

  if (!DRY) {
    const now = new Set((await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
    )).rows.map((r) => r.table_name));
    const missing = WANT.filter((n) => !now.has(n));
    if (missing.length) { console.error('\n✗ 아직 없는 표:', missing.join(', ')); process.exitCode = 1; return; }
  }

  console.log(`\n새로 만든 표 ${made}개 / 확인 ${WANT.length}개`);
  if (DRY) console.log('--dry — 실제로 만들지 않았습니다.');
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
