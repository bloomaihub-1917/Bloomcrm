/* ══════════════════════════════════════════════════════════════
   add-item-done.js — 항목에 「작업 완료」 날짜 칸을 만든다

   기본 제공 시공이 끝났는지는 기업 칸 하나(exhibitors.base_done_at)에 적혔다.
   그런데 한 기업이 벽면 그래픽과 인포데스크 랩핑을 함께 받는 일이 흔하다 —
   벽면은 뽑았고 인포데스크는 아직인 상태를 기업 칸 하나로는 담을 수 없어서,
   둘 중 하나만 끝나도 «완료»가 되거나 둘 다 끝날 때까지 «미완»으로 남았다.

   발주와 시공은 장 단위로 움직인다. 받은 날(received_at)이 이미 항목 칸에
   있으니, 만든 날도 같은 줄에 둔다.

   기업 칸은 지우지 않는다 — 옮기기 전 값을 돌아볼 자리로 남긴다.

     node db/add-item-done.js --dry
     node db/add-item-done.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const BOOTH_ORIGIN = 'booth';

(async () => {
  if(!DRY) await pool.query(`alter table exhibitor_items add column if not exists done_at TEXT`);
  else {
    const c = await pool.query(
      `select column_name from information_schema.columns where table_name='exhibitor_items' and column_name='done_at'`);
    console.log(c.rowCount ? 'done_at 칸이 이미 있습니다' : 'done_at 칸을 만듭니다');
  }

  /* 기업 칸에 적혀 있던 완료일을 그 기업의 기본 제공 그래픽 줄로 옮긴다.
     이미 날짜가 있는 줄은 덮지 않는다 — 그쪽이 더 구체적인 기록이다. */
  const { rows } = await pool.query(`
    select i.id, i.name, i.done_at, x.company_name, x.booth_type, x.base_done_at
      from exhibitors x
      join exhibitor_items i on i.exhibitor_id = x.id
     where coalesce(x.base_done_at,'') <> ''
       and i.category = 'graphic' and i.origin = $1
       and coalesce(i.done_at,'') = ''
     order by x.company_name`, [BOOTH_ORIGIN]).catch(async (e) => {
       /* --dry로 돌려 칸이 아직 없을 때 */
       if(!/done_at/.test(e.message)) throw e;
       const r = await pool.query(`
         select i.id, i.name, x.company_name, x.booth_type, x.base_done_at
           from exhibitors x join exhibitor_items i on i.exhibitor_id = x.id
          where coalesce(x.base_done_at,'') <> '' and i.category='graphic' and i.origin=$1
          order by x.company_name`, [BOOTH_ORIGIN]);
       return r;
     });

  console.log(`옮길 줄 ${rows.length}`);
  rows.forEach(r => console.log(`  ${r.company_name} (${r.booth_type}) · ${r.name} ← ${r.base_done_at}`));

  if(DRY){ console.log('\n--dry 라 아무것도 쓰지 않았습니다.'); await pool.end(); return; }

  let n = 0;
  for(const r of rows){
    const res = await pool.query(
      `update exhibitor_items set done_at = $1 where id = $2 and coalesce(done_at,'') = ''`,
      [r.base_done_at, r.id]);
    n += res.rowCount;
  }
  console.log(`\n${n}줄에 완료 날짜를 넣었습니다.`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
