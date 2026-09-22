/* ══════════════════════════════════════════════════════════════
   move-base-recv-to-items.js — 「디자인 수령」을 그래픽 항목으로 옮긴다

   출력·시공 부스(블록·라이팅)가 받는 것은 그래픽 파일이다. 그런데 그 사실을
   두 군데가 각자 적고 있었다 — 기본 시공은 기업 칸(exhibitors.base_recv_at),
   그래픽 현황은 항목 칸(exhibitor_items.received_at). 2026 KIC 스물두 곳 중
   열세 곳이 그래픽 현황에는 «받음»인데 기본 시공에는 «미수령»이었다. 기본 시공만
   보고 독촉하면 이미 파일을 보낸 곳에 독촉이 나간다.

   이제 화면은 항목 쪽만 읽는다. 그러면 기업 칸에만 적혀 있던 날짜가 화면에서
   사라지므로, 그 날짜를 항목으로 옮긴다 — 비어 있는 항목에만 넣는다. 항목에
   이미 날짜가 있으면 그게 더 구체적인 기록이라 덮지 않는다.

   기업 칸(base_recv_at)은 지우지 않는다. 간판(기본부스)이 여전히 그 칸을
   «간판명 확정»으로 쓰고, 옮기기 전 값이 필요할 때 돌아볼 자리도 남겨 둔다.

     node db/move-base-recv-to-items.js --dry
     node db/move-base-recv-to-items.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const BOOTH_ORIGIN = 'booth';   // 부스 타입에 딸려 깔린 줄 (exh-tab의 isBoothGiven)

(async () => {
  const { rows } = await pool.query(`
    select i.id, i.name, i.received_at, x.company_name, x.booth_type, x.base_recv_at
      from exhibitors x
      join exhibitor_items i on i.exhibitor_id = x.id
     where coalesce(x.base_recv_at, '') <> ''
       and i.category = 'graphic'
       and i.origin = $1
       and coalesce(i.received_at, '') = ''
     order by x.company_name`, [BOOTH_ORIGIN]);

  if(!rows.length){ console.log('옮길 줄이 없습니다.'); await pool.end(); return; }
  console.log(`${rows.length}줄을 옮깁니다 (기업 칸 → 항목 칸)`);
  rows.forEach(r => console.log(`  ${r.company_name} · ${r.booth_type} · ${r.name} ← ${r.base_recv_at}`));

  if(DRY){ console.log('\n--dry 라 아무것도 쓰지 않았습니다.'); await pool.end(); return; }

  let n = 0;
  for(const r of rows){
    const res = await pool.query(
      `update exhibitor_items set received_at = $1 where id = $2 and coalesce(received_at,'') = ''`,
      [r.base_recv_at, r.id]);
    n += res.rowCount;
  }
  console.log(`\n${n}줄에 받은 날짜를 넣었습니다.`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
