/* ══════════════════════════════════════════════════════════════
   add-fascia-item.js — 간판을 품목표에 세우고 기본부스 제공사항에 넣는다

   간판(기본부스에 딸려 나가는 상호 사인)은 품목표에 없었다. 그래서 부스 타입
   제공사항에 적을 줄이 없었고, 부스 타입을 골라도 아무것도 깔리지 않았다.
   결국 간판만 「기본 시공」이라는 제 화면을 따로 갖게 됐고, 같은 성격의 일(우리가
   만들어 세우는 것)이 두 군데로 갈렸다.

   간판도 다른 기본 제공 품목과 같은 길을 타게 한다 —
   품목표에 한 줄 → 부스 타입 제공사항에 한 줄 → 부스 타입을 고르면 깔린다.

   ── 코드를 900번대로 ──
   G-010~G-131은 렌탈사 품목표에서 그대로 가져온 번호다. 그 사이에 우리 제작물을
   끼우면 렌탈사 카탈로그가 개정될 때 번호가 부딪친다. 우리가 만드는 것은
   900번대부터 쓴다 — 번호만 보고도 «이건 렌탈이 아니라 우리 제작»임을 안다.

   ── 단가는 비운다 ──
   계약가에 들어 있어 따로 청구하지 않는다. 단가를 넣으면 대장·정산에 없는
   청구액이 붙는다(기본 제공은 수량만 세고 금액은 빼는 구조다).

   ── G-131의 분류도 함께 바로잡는다 ──
   「G-131 벽면 그래픽 출력(디자인 비용 별도)」이 분류 «디자인»에 들어 있었다.
   화면은 분류를 보고 «디자인 의뢰»를 가리는데, 이 품목은 계약에 깔려 나가는
   출력분이라 블록·라이팅 21곳이 전부 디자인 의뢰로 표시됐다. 같은 분류에
   성격이 다른 둘을 담아 둔 탓이다. 출력은 출력끼리 둔다.

     node db/add-fascia-item.js --dry
     node db/add-fascia-item.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const EVENT = arg('--event') || '2026 KIC';

/* 우리가 만드는 것 — 900번대. 지금은 간판 하나지만, 같은 성격(우리 제작·계약 포함)의
   품목이 생기면 901·902로 이어 붙인다. */
const FASCIA = {
  code: 'G-900',
  name_ko: '부스 간판 제작',
  name_en: 'Booth Fascia Sign',
  category: '간판',
  kind: 'graphic',
  sort_order: '900',
  note: '기본부스 계약 포함 — 도록 게재 영문명으로 우리가 제작합니다. 별도 청구하지 않습니다.',
};

/* 간판이 딸려 나가는 부스 타입 */
const FASCIA_TYPES = ['Octanium (Standard)', 'Octanium (Black)'];

/* 분류를 바로잡을 품목 — 출력분을 «디자인»에서 꺼낸다 */
const RECAT = [{ code: 'G-131', from: '디자인', to: '벽면 랩핑' }];

(async () => {
  const say = [];

  /* ── 1. 품목표 ── */
  const had = await pool.query(
    `select id, category, name_ko from equip_catalog where event_id = $1 and code = $2`,
    [EVENT, FASCIA.code]);
  const id = had.rows[0]?.id || `EC-FSC-${FASCIA.code}-${EVENT.replace(/\s/g, '')}`;
  if(had.rows.length) say.push(`품목표: ${FASCIA.code} 이미 있음 — 이름·분류만 맞춥니다`);
  else say.push(`품목표: ${FASCIA.code} ${FASCIA.name_ko} 새로 넣습니다 (단가 없음)`);

  /* ── 2. 분류 바로잡기 ── */
  const recat = [];
  for(const r of RECAT){
    const hit = await pool.query(
      `select id, category, name_ko from equip_catalog where event_id = $1 and code = $2`,
      [EVENT, r.code]);
    const cur = hit.rows[0];
    if(!cur){ say.push(`분류: ${r.code} 가 없어 건너뜁니다`); continue; }
    if(cur.category !== r.from){ say.push(`분류: ${r.code} 는 이미 «${cur.category}» — 그대로 둡니다`); continue; }
    recat.push({ id: cur.id, ...r, name: cur.name_ko });
    say.push(`분류: ${r.code} ${cur.name_ko} — «${r.from}» → «${r.to}»`);
  }

  /* ── 3. 부스 타입 제공사항 ── */
  const types = await pool.query(
    `select id, code, included from code_lists where list_key = 'booth_type' and event_id = $1 and code = any($2)`,
    [EVENT, FASCIA_TYPES]);
  const typePlan = [];
  types.rows.forEach(t => {
    let inc = [];
    try { inc = JSON.parse(t.included || '[]'); } catch(e){ inc = []; }
    if(!Array.isArray(inc)) inc = [];
    if(inc.some(o => String(o.code || '').toUpperCase() === FASCIA.code)){
      say.push(`제공사항: ${t.code} 에 이미 있음`);
      return;
    }
    /* 간판을 맨 앞에 둔다 — 그 부스에서 제일 먼저 확인하는 물건이다 */
    const next = [{ cat: 'graphic', code: FASCIA.code, name: FASCIA.name_ko, qty: '1' }, ...inc];
    typePlan.push({ id: t.id, code: t.code, json: JSON.stringify(next) });
    say.push(`제공사항: ${t.code} 에 ${FASCIA.code} 한 줄 추가 (${inc.length} → ${next.length}줄)`);
  });

  say.forEach(s => console.log('  ' + s));
  if(DRY){ console.log('\n--dry 라 아무것도 쓰지 않았습니다.'); await pool.end(); return; }

  await pool.query(`
    insert into equip_catalog (id, event_id, category, code, name_ko, name_en, spec,
                               price_krw, price_usd, note, active, sort_order, kind)
    values ($1,$2,$3,$4,$5,$6,'', '', '', $7, '', $8, $9)
    on conflict (id) do update set category = excluded.category, name_ko = excluded.name_ko,
      name_en = excluded.name_en, note = excluded.note, sort_order = excluded.sort_order,
      kind = excluded.kind`,
    [id, EVENT, FASCIA.category, FASCIA.code, FASCIA.name_ko, FASCIA.name_en,
      FASCIA.note, FASCIA.sort_order, FASCIA.kind]);

  for(const r of recat) await pool.query(`update equip_catalog set category = $1 where id = $2`, [r.to, r.id]);
  for(const t of typePlan) await pool.query(`update code_lists set included = $1 where id = $2`, [t.json, t.id]);

  console.log('\n반영했습니다. 이미 배정된 기업에 깔려면 db/apply-booth-item-diff.js 를 돌리세요.');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
