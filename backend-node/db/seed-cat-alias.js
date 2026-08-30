/* ══════════════════════════════════════════════════════════════
   seed-cat-alias.js — 업로드 표기 → 카테고리 매핑 초기값

   utils.js의 CAT_NORMALIZE_MAP은 업로드로 들어오는 자유 문구를 굵게 묶어 둔
   기본값이다. 거기서 전시 관련 표기가 전부 '일반참가자'로 떨어지고 있었다 —
   '전시참가기업' 카테고리가 따로 있는데도.

   기본값 90여 개를 전부 DB로 옮기지는 않는다. 대부분 언어 정규화라 바뀔 일이
   없고, 옮기면 편집 화면이 90줄짜리가 되어 정작 고쳐야 할 줄이 묻힌다.
   설정에는 "기본값을 덮어쓰는 줄"만 둔다.

   뜻이 분명한 표기만 넣는다. '전시'·'부스'·'booth'는 참관객일 수도 있어
   손대지 않는다 — 필요하면 화면에서 추가하면 된다.

     node db/seed-cat-alias.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

/* [표기, 카테고리 키, 설명] */
const ROWS = [
  ['전시참가기업', 'exhibitor', ''],
  ['전시기업',     'exhibitor', ''],
  ['전시참가',     'exhibitor', ''],
  ['exhibitor',    'exhibitor', ''],
];

const slug = (v) => String(v).replace(/[^A-Za-z0-9가-힣]/g, '').slice(0, 24);

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < ROWS.length; i++) {
      const [code, cat, note] = ROWS[i];
      const rec = {
        id: `CD-cat_alias-${slug(code)}`,
        list_key: 'cat_alias', event_id: '',
        code, label: cat, cls: '', note: note || '', active: '',
        sort_order: String((i + 1) * 10),
      };
      if (!DRY) {
        const cols = Object.keys(rec);
        await client.query(
          `INSERT INTO code_lists (${cols.map((c) => `"${c}"`).join(',')})
           VALUES (${cols.map((_, k) => `$${k + 1}`).join(',')})
           ON CONFLICT (id) DO UPDATE SET ${cols.filter((c) => c !== 'id')
             .map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}`,
          cols.map((c) => rec[c]));
      }
      console.log(`  ${code.padEnd(14)} -> ${cat}`);
    }
    if (DRY) { await client.query('ROLLBACK'); console.log('\n--dry 라서 되돌렸습니다.'); }
    else { await client.query('COMMIT'); console.log('\n반영 완료.'); }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally { client.release(); }
})();
