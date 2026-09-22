/* ══════════════════════════════════════════════════════════════
   apply-booth-item-diff.js — 제공사항을 고친 뒤, 이미 배정된 기업에 맞춘다

   부스 타입별 기본 제공 품목은 «부스 타입을 고르는 순간»에만 깔린다. 그래서
   제공사항을 나중에 고치면, 이미 부스가 정해져 있던 기업에는 옛 목록이 그대로
   남는다 — 설정 화면과 기업 화면이 다른 말을 하게 된다.

   여기서는 차이만 맞춘다. 빠진 줄은 넣고, 설정에서 빠진 줄은 걷어낸다.
   **양쪽에 다 있는 줄은 손대지 않는다** — 그 줄에는 파일을 받은 날짜가 붙어
   있어서, 지웠다 다시 깔면 받은 기록이 함께 사라진다(그러면 이미 파일을 보낸
   기업에 독촉이 나간다).

   공동 부스에서 비용만 나눠 내는 쪽에는 깔지 않는다 — 실물은 부스 하나에
   하나씩이다(화면과 같은 규칙).

     node db/apply-booth-item-diff.js --dry
     node db/apply-booth-item-diff.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const EVENT = arg('--event') || '2026 KIC';
const BOOTH_ORIGIN = 'booth';

/* 같은 줄인가 — 분류·이름·수량이 모두 같으면 같다(화면의 sameBoothSet과 같은 키) */
const keyOf = (cat, name, qty) => `${cat}|${String(name || '').trim()}|${String(qty ?? '').trim()}`;

(async () => {
  const types = new Map();
  const tr = await pool.query(
    `select code, included from code_lists where list_key = 'booth_type' and event_id = $1`, [EVENT]);
  tr.rows.forEach(t => {
    let inc = [];
    try { inc = JSON.parse(t.included || '[]'); } catch(e){ inc = []; }
    types.set(t.code, Array.isArray(inc) ? inc.filter(o => o && (o.name || o.code)) : []);
  });

  const xs = await pool.query(
    `select id, company_name, booth_type, booth_shared from exhibitors where event_id = $1`, [EVENT]);

  const add = [], del = [];
  for(const x of xs.rows){
    const shared = String(x.booth_shared || '').trim() === 'yes';
    const want = shared ? [] : (types.get(x.booth_type) || []);
    const had = (await pool.query(
      `select id, category, name, qty, received_at from exhibitor_items
        where exhibitor_id = $1 and origin = $2`, [x.id, BOOTH_ORIGIN])).rows;

    const left = new Map();     // 아직 짝을 못 찾은 기존 줄
    had.forEach(i => {
      const k = keyOf(i.category || 'equip', i.name, i.qty);
      if(!left.has(k)) left.set(k, []);
      left.get(k).push(i);
    });

    want.forEach(o => {
      const cat = o.cat || 'equip';
      const name = [o.code, o.name].filter(Boolean).join(' ');
      const k = keyOf(cat, name, o.qty);
      const hit = left.get(k);
      if(hit && hit.length){ hit.shift(); return; }        // 그대로 두는 줄
      add.push({ x, cat, name, qty: String(o.qty ?? '') });
    });
    [...left.values()].flat().forEach(i => del.push({ x, i }));
  }

  console.log(`넣을 줄 ${add.length} · 걷을 줄 ${del.length}`);
  add.forEach(a => console.log(`  + ${a.x.company_name} (${a.x.booth_type}) : [${a.cat}] ${a.name} ×${a.qty}`));
  del.forEach(d => console.log(`  − ${d.x.company_name} (${d.x.booth_type}) : [${d.i.category}] ${d.i.name}${
    d.i.received_at ? ` ⚠ 받은 날짜 ${d.i.received_at} 가 함께 사라집니다` : ''}`));

  if(DRY){ console.log('\n--dry 라 아무것도 쓰지 않았습니다.'); await pool.end(); return; }

  for(const [n, a] of add.entries()){
    /* 한 바퀴가 1밀리초 안에 여러 번 돌아 시각만으로는 id가 겹친다 — 차례를 붙인다 */
    const id = `XI-${Date.now()}_${n}${Math.floor(Math.random() * 1000)}`;
    const cat = await pool.query(
      `select id from equip_catalog where event_id = $1 and $2 ilike code || ' %'`, [EVENT, a.name]);
    await pool.query(`
      insert into exhibitor_items (id, exhibitor_id, category, catalog_id, name, qty,
                                   unit_price, amount, currency, note, billable, origin, sort_order)
      values ($1,$2,$3,$4,$5,$6,'','','KRW','','no',$7,'900')`,
      [id, a.x.id, a.cat, cat.rows[0]?.id || '', a.name, a.qty, BOOTH_ORIGIN]);
  }
  for(const d of del) await pool.query(`delete from exhibitor_items where id = $1`, [d.i.id]);

  console.log(`\n넣음 ${add.length} · 걷음 ${del.length}`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
