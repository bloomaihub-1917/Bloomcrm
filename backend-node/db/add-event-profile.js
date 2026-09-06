/* ══════════════════════════════════════════════════════════════
   add-event-profile.js — events에 "어떤 행사였나"를 적을 칸을 붙인다

   events에는 이름·약칭·기간·장소·색상뿐이었다. 행사가 끝나고 몇 해 지나면
   그 행사가 무엇이었는지 아무도 기억하지 못하는데, 정작 그때 만난 사람들이
   다음 행사의 영업 대상이다. 행사를 다시 꺼내 볼 수 있게 칸을 만든다.

   기존 값은 건드리지 않는다 — 컬럼만 붙이고 전부 NULL로 둔다.

     node db/add-event-profile.js --dry
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

/* schema.sql의 events 정의와 같은 순서·같은 이름이어야 한다 */
const COLS = [
  ['host',      '주최'],
  ['organizer', '주관'],
  ['our_role',  '우리가 맡은 일'],
  ['theme',     '대주제'],
  ['scale',     '규모'],
  ['homepage',  '홈페이지'],
  ['summary',   '행사 성격'],
  ['outcome',   '성과·비고'],
];

async function main(){
  const { rows: have } = await pool.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_name = 'events'
  `);
  const known = new Set(have.map(r => r.column_name));
  const todo = COLS.filter(([c]) => !known.has(c));

  if(!todo.length){
    console.log('이미 다 붙어 있습니다 — 할 일 없음.');
    return;
  }

  console.log(`붙일 컬럼 ${todo.length}개:`);
  todo.forEach(([c, l]) => console.log(`  ${c.padEnd(10)} ${l}`));

  if(DRY){ console.log('\n--dry — 실제로 바꾸지 않았습니다.'); return; }

  // ADD COLUMN IF NOT EXISTS를 한 문장씩 — 하나가 이미 있어도 나머지는 진행된다
  for(const [c] of todo){
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS ${c} TEXT`);
    console.log(`  + ${c}`);
  }

  const { rows: cnt } = await pool.query('SELECT COUNT(*)::int AS n FROM events');
  console.log(`\n완료 — 행사 ${cnt[0].n}건, 값은 전부 비어 있습니다(화면에서 채웁니다).`);
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
