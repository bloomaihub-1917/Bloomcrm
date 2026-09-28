/* ══════════════════════════════════════════════════════════════
   add-org-profile.js — 기업에 주소·회사소개 칸을 만들고 프로그램북 값으로 채운다

   주소·웹사이트·회사소개는 행사가 아니라 회사에 붙는 값인데, 지금까지는
   프로그램북 원고(exhibitors.book_*)에만 있었다. 그러면 행사가 바뀔 때마다
   같은 소개를 다시 받아야 하고, 전시에 안 나온 회사는 적어 둘 데가 없다.

   orgs에 빈 칸이 있을 때만 채운다 — 기업 DB에 이미 적어 둔 값이 정본이다.
   같은 회사가 여러 행사에 있으면 가장 최근에 고친 원고를 쓴다.

     node db/add-org-profile.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const MAP = [['book_address', 'address'], ['book_website', 'website'], ['book_intro', 'intro']];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE orgs ADD COLUMN IF NOT EXISTS address TEXT');
    await client.query('ALTER TABLE orgs ADD COLUMN IF NOT EXISTS intro TEXT');

    const rows = (await client.query(
      `SELECT o.id, o.name_ko, o.name_en, o.address, o.website, o.intro,
              e.book_address, e.book_website, e.book_intro, e.event_id
         FROM exhibitors e JOIN orgs o ON o.id = e.org_id
        WHERE COALESCE(e.book_address,'') <> '' OR COALESCE(e.book_website,'') <> ''
           OR COALESCE(e.book_intro,'') <> ''
        ORDER BY e.updated_at DESC NULLS LAST`)).rows;

    const today = new Date().toISOString().slice(0, 10);
    const done = new Map();          // org id → 이미 채운 칸
    const count = { address: 0, website: 0, intro: 0 };

    for (const r of rows) {
      const taken = done.get(r.id) || new Set();
      const patch = {};
      for (const [from, to] of MAP) {
        const v = String(r[from] || '').trim();
        if (v && !String(r[to] || '').trim() && !taken.has(to)) { patch[to] = v; taken.add(to); }
      }
      done.set(r.id, taken);
      const cols = Object.keys(patch);
      if (!cols.length) continue;
      cols.forEach((c) => count[c]++);
      await client.query(
        `UPDATE orgs SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ')},
           updated_at = $${cols.length + 2} WHERE id = $1`,
        [r.id, ...cols.map((c) => patch[c]), today]);
    }

    console.log(`기업 DB에 채움 — 주소 ${count.address} · 웹사이트 ${count.website} · 회사소개 ${count.intro}`);
    if (DRY) { await client.query('ROLLBACK'); console.log('--dry 라서 되돌렸습니다.'); }
    else { await client.query('COMMIT'); console.log('반영 완료.'); }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end?.();
  }
})();
