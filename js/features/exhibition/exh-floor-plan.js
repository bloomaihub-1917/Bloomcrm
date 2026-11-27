/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-floor-plan.js — 배치도 — 도면에 부스를 놓고 참가기업을 배정한다

   · 도면(floor_plans)은 행사마다 여러 장(1홀·2홀…). 한 장에 부스 칸 [{no,x,y,w,h}](m)을 둔다.
   · «어느 기업이 어느 부스»는 exhibitors.booth_no가 정본이다. 배치도에서 배정하면 그 칸을
     고치고(patchExh), 부스 현황·인보이스·메일이 같은 값을 쓴다. 배치도에 따로 적지 않는다.
     10-11처럼 범위로 적힌 기업은 10번·11번 칸 모두에 보인다.
   · 나중에 도면 이미지(bg_url)를 밑그림으로 깔고 조감도를 보는 기능을 붙일 자리다 —
     좌표를 m 단위로 두는 것도 그래서다(이미지 크기와 상관없이 실제 치수로 맞춘다).

   탭(exh-tab.js)은 이 파일을 import하지 않는다 — window로만 부른다. 읽는 것은 app.js.
═══════════════════════════════════════════════════════════════ */

import { API_BASE_URL, currentUser, exhEvent } from '../../state.js';
import { escAttr, escapeHtml, td } from '../../utils.js';
import { safeFetch } from '../../api.js';
import { saveFloorPlan, deleteFloorPlan } from '../../api/exh-save.js';
import { activeExhibitors } from './exh-calc.js';
import { exhNames, exhLocked, isNoBooth, parseBooth, patchExh, boothSortKey, boothTypeText } from '../../modules/exh-tab.js';

const GRID = 0.5;            // 끌어 놓을 때 맞추는 눈금(m)
const AISLE = 3;            // 이동 동선(통로) 폭(m) — 부스 줄 사이를 이만큼 띄운다
/* 부스 상태 — 색 하나에 뜻 하나.
   · 확정·미정은 기업 쪽 값(진행현황의 «부스 배정 확정» = booth_confirmed/booth_confirmed_at)에서 읽는다.
     배치도에서 바꾸면 진행현황 체크도 같이 바뀐다 — 따로 적지 않는다.
   · 빈 부스·보류·주최측·배정불가는 칸 쪽 값(booths[].state)이다. 기업이 없을 때의 쓰임새다. */
export const BOOTH_STATES = {
  confirmed: { label: '확정',     fill: 'var(--ad)', stroke: 'var(--a)',  note: '배정 확정 — 진행현황 «부스 배정 확정»이 켜진 기업' },
  pending:   { label: '미정',     fill: 'var(--yb)', stroke: 'var(--am)', note: '기업은 넣었지만 아직 확정 전' },
  empty:     { label: '빈 부스',  fill: 'var(--W)',  stroke: 'var(--i4)', note: '아무도 없는 칸', dash: true },
  hold:      { label: '보류',     fill: 'var(--pb)', stroke: 'var(--pu)', note: '협의 중인 기업·스폰서 몫으로 잡아 둔 칸 — 메모에 누구 몫인지', dash: true },
  org:       { label: '주최측',   fill: 'var(--i7)', stroke: 'var(--i3)', note: '사무국·홍보관·라운지처럼 주최측이 쓰는 칸' },
  blocked:   { label: '배정불가', fill: 'var(--rb)', stroke: 'var(--re)', note: '기둥·소화전·비상구 앞 등 배정할 수 없는 칸' },
};
const isConfirmed = (x) => x.booth_confirmed === 'yes' || !!x.booth_confirmed_at;
function boothState(b, ex){
  if(ex.length) return ex.every(isConfirmed) ? 'confirmed' : 'pending';
  return ['hold', 'org', 'blocked'].includes(b.state) ? b.state : 'empty';
}

const fp = {
  ev: null,                  // 지금 들고 있는 도면이 어느 행사 것인지
  plans: null,               // null = 불러오는 중
  cur: null,                 // 보고 있는 도면 id
  sel: -1,                   // 고른 부스 칸 번호(booths 배열 자리)
  selZ: -1,                  // 고른 구역 번호(zones 배열 자리) — 세미나·컨퍼런스·무대
  pick: null,                // 배정하려고 고른 기업 id — 그다음 누른 부스에 넣는다
  zoom: 1,                   // 1 = 화면에 맞춤(스크롤 없이 한눈에). 키우면 그만큼 커지고 스크롤된다
  all: false,                // 모든 홀을 나란히 한눈에
  q: '',
};

/* ── 불러오기 ── */
async function loadPlans(ev){
  fp.ev = ev; fp.plans = null; fp.sel = -1; fp.pick = null;
  let rows = [];
  if(API_BASE_URL && currentUser){
    const r = await safeFetch(API_BASE_URL + '/api/data?sheet=floor_plans', 'floor_plans');
    rows = Array.isArray(r) ? r : [];
  }
  if(fp.ev !== ev) return;   // 그 사이 다른 행사로 옮겼다
  fp.plans = rows.filter(p => p.event_id === ev).map(p => ({
    ...p, booths: parseArr(p.booths), zones: parseArr(p.zones),
  })).sort((a, b) => (+a.sort_order || 0) - (+b.sort_order || 0));
  if(!fp.plans.some(p => p.id === fp.cur)) fp.cur = fp.plans[0]?.id || null;
  fp.all = fp.plans.length > 1;   // 홀이 여럿이면 처음엔 한눈에
  redraw();
}

function parseArr(v){ try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } }
const curPlan = () => (fp.plans || []).find(p => p.id === fp.cur) || null;

let saveTimer = null;
function savePlan(p, now){
  clearTimeout(saveTimer);
  const go = () => saveFloorPlan({
    id: p.id, event_id: p.event_id, name: p.name, width: String(p.width), height: String(p.height),
    booths: JSON.stringify(p.booths), zones: JSON.stringify(p.zones || []), bg_url: p.bg_url || '', sort_order: +p.sort_order || 0,
    note: p.note || '', updated_at: td(), updated_by: currentUser?.email || '',
  });
  if(now) return go();
  saveTimer = setTimeout(go, 600);   // 끌어 옮길 때마다 보내지 않는다
}

/* ── 부스 칸 ↔ 기업 ── */
/* 이 칸 번호를 쓰는 기업들 — 같은 번호(공동 부스)거나 범위(10-11) 안에 든 기업 */
function exhOfBooth(no, all){
  const t = String(no || '').trim();
  if(!t) return [];
  const n = /^\d+$/.test(t) ? +t : null;
  return all.filter(x => {
    const b = String(x.booth_no || '').trim();
    if(!b) return false;
    if(b === t) return true;
    if(n === null) return false;
    const p = parseBooth(b);
    return p.kind === 'range' ? (n >= p.first && n <= p.last) : (p.kind === 'split' && p.first === n);
  });
}
/* 모든 도면의 칸 번호 — 배치도에 없는 번호를 가진 기업을 알리려고 */
function allBoothNos(){
  const s = new Set();
  (fp.plans || []).forEach(p => p.booths.forEach(b => s.add(String(b.no).trim())));
  return s;
}
function onPlan(x, nos){
  const b = String(x.booth_no || '').trim();
  if(!b) return false;
  if(nos.has(b)) return true;
  const p = parseBooth(b);
  if(p.kind === 'range'){ for(let i = p.first; i <= p.last; i++) if(nos.has(String(i))) return true; return false; }
  return p.kind === 'split' && nos.has(String(p.first));
}

/* ── 그리기 ── */
export function renderFloorView(){
  if(fp.ev !== exhEvent){ loadPlans(exhEvent); }
  return `<div id="fp-root">${fpBody()}</div>`;
}
function redraw(){
  const el = document.getElementById('fp-root');
  if(el) el.innerHTML = fpBody();
}

function fpBody(){
  if(fp.plans === null) return `<div class="sec" style="color:var(--i4);font-size:var(--fs-12)">배치도를 불러오는 중…</div>`;
  const ro = exhLocked();
  const tabs = fp.plans.map(p => `<button class="seg-b${p.id === fp.cur && !fp.all ? ' on' : ''}"
      onclick="fpSelPlan('${escAttr(p.id)}')">${escapeHtml(p.name || '도면')} <span style="color:var(--i4)">${p.booths.length}</span></button>`).join('');
  const bar = `<div class="sec sec-bar" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      ${fp.plans.length ? `<div class="seg">${fp.plans.length > 1 ? `<button class="seg-b${fp.all ? ' on' : ''}" onclick="fpAll()" title="모든 홀을 나란히 한눈에">전체</button>` : ''}${tabs}</div>` : ''}
      ${ro ? '' : `<button class="btn bs" onclick="fpAddPlan()">+ 도면 추가</button>`}
      ${curPlan() && !ro ? `<button class="btn bs" onclick="fpEditPlan()">도면 설정</button>
        <button class="btn bs bp" onclick="fpAddRow()">+ 부스 줄 추가</button>
        <button class="btn bs" onclick="fpAddZone()" title="세미나·컨퍼런스·무대·라운지처럼 부스가 아닌 공간">+ 구역 추가</button>` : ''}
      ${curPlan() ? `<span style="margin-left:auto;display:flex;gap:4px;align-items:center">
        <button class="btn bs" onclick="fpZoom(-1)" title="작게">−</button>
        <span style="font-size:var(--fs-11);color:var(--i4);min-width:38px;text-align:center">${fp.zoom <= 1 ? '맞춤' : Math.round(fp.zoom * 100) + '%'}</span>
        <button class="btn bs" onclick="fpZoom(1)" title="크게">＋</button></span>` : ''}
    </div>`;
  if(!fp.plans.length){
    return bar + `<div class="sec" style="text-align:center;padding:40px 0;color:var(--i4);font-size:var(--fs-12_5)">
      아직 도면이 없어요. «+ 도면 추가»로 홀 크기(가로·세로 m)를 정하고 부스를 놓으세요.<br>
      <span style="font-size:var(--fs-11)">배정한 부스 번호는 기업의 부스 번호(부스 현황)에 그대로 들어갑니다.</span></div>`;
  }
  const p = curPlan();
  const all = activeExhibitors(exhEvent).filter(x => !isNoBooth(x));
  if(fp.all) return bar + `<div class="sec">${allPlansSvg(all)}${legend(fp.plans, all)}</div>`;
  return bar + `<div class="sec" style="display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:12px;align-items:start">
      <div>${planSvg(p, all)}${legend(p, all)}</div>
      <div>${sidePanel(p, all, ro)}</div>
    </div>`;
}

function legend(p, all){
  const cnt = {};
  [].concat(...(Array.isArray(p) ? p : [p]).map(q => q.booths))
    .forEach(b => { const k = boothState(b, exhOfBooth(b.no, all)); cnt[k] = (cnt[k] || 0) + 1; });
  return `<div style="display:flex;gap:10px;align-items:center;font-size:var(--fs-11);color:var(--i3);margin-top:6px;flex-wrap:wrap">
    ${Object.entries(BOOTH_STATES).map(([k, v]) => `<span title="${escAttr(v.note)}"><i style="display:inline-block;width:10px;height:10px;background:${v.fill};border:1px ${v.dash ? 'dashed' : 'solid'} ${v.stroke};vertical-align:-1px"></i> ${v.label} ${cnt[k] || 0}</span>`).join('')}
    <span title="같은 번호가 두 칸에 있어요"><i style="display:inline-block;width:10px;height:10px;border:1.5px dotted var(--re);vertical-align:-1px"></i> 번호 겹침</span>
    <span><i style="display:inline-block;width:10px;height:10px;background:var(--pb);border:1px solid var(--pu);vertical-align:-1px"></i> 구역</span>
    <span style="color:var(--i4)">부스·구역을 끌어 옮기고, 눌러서 고르세요 · 눈금 ${GRID}m · 부스 줄 추가 시 통로 ${AISLE}m</span></div>`;
}

function planSvg(p, all){
  const W = +p.width || 60, H = +p.height || 40;
  /* 1(맞춤)이면 빈 화면 높이·폭에 맞춰 그린다 — 스크롤 없이 홀 전체가 보이게. 키우면 그때부터 스크롤 */
  const fit = fp.zoom <= 1;
  const px = 14 * fp.zoom;   // 키웠을 때 1m당 화면 픽셀
  const dupNo = new Set(); { const s = new Set(); p.booths.forEach(b => { const k = String(b.no).trim(); if(s.has(k)) dupNo.add(k); s.add(k); }); }
  const grid = [];
  for(let x = 0; x <= W; x += 1) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="var(--i7)" stroke-width="${x % 5 ? 0.03 : 0.07}"/>`);
  for(let y = 0; y <= H; y += 1) grid.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="var(--i7)" stroke-width="${y % 5 ? 0.03 : 0.07}"/>`);
  /* 여러 부스를 쓰는 기업(10-12)은 한 덩어리로 — 칸마다 이름을 찍지 않고 묶음 테두리 안에 한 번만 */
  const exOf = p.booths.map(b => exhOfBooth(b.no, all));
  const groups = new Map();   // 기업 id → 이 도면의 칸 자리들
  exOf.forEach((ex, i) => { if(ex.length === 1) { const k = ex[0].id; (groups.get(k) || groups.set(k, []).get(k)).push(i); } });
  for(const [k, idx] of [...groups]) if(idx.length < 2) groups.delete(k);
  const inGroup = (i) => exOf[i].length === 1 && groups.has(exOf[i][0].id);
  const booths = p.booths.map((b, i) => {
    const ex = exOf[i];
    const grp = inGroup(i);
    const dup = dupNo.has(String(b.no).trim());
    const sel = i === fp.sel;
    const st = BOOTH_STATES[boothState(b, ex)];
    const fill = st.fill;
    const stroke = sel ? 'var(--ak)' : dup ? 'var(--re)' : grp ? st.fill : st.stroke;
    const name = ex.map(x => exhNames(x).ko).join(' / ');
    const fs = Math.min(b.w, b.h) * 0.22;
    const maxCh = Math.max(3, Math.floor(b.w / (fs * 0.95)));
    const short = name.length > maxCh ? name.slice(0, maxCh - 1) + '…' : name;
    return `<g data-i="${i}" class="fp-booth" style="cursor:${exhLocked() ? 'pointer' : 'move'}">
      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${fill}" stroke="${stroke}"
        stroke-width="${sel ? 0.18 : dup ? 0.14 : 0.08}" ${dup ? 'stroke-dasharray="0.15 0.15"' : st.dash ? 'stroke-dasharray="0.3 0.2"' : ''}/>
      ${!ex.length && b.state === 'blocked' ? `<path d="M${b.x} ${b.y}L${b.x + b.w} ${b.y + b.h}M${b.x + b.w} ${b.y}L${b.x} ${b.y + b.h}" stroke="var(--re)" stroke-width="0.06" opacity=".6"/>` : ''}
      ${!ex.length && b.memo ? `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + fs * 0.9}" font-size="${fs * 0.8}" text-anchor="middle" fill="var(--i3)">${escapeHtml(String(b.memo).slice(0, Math.max(3, Math.floor(b.w / (fs * 0.85)))))}</text>` : ''}
      ${grp ? '' : `<text x="${b.x + 0.2}" y="${b.y + fs + 0.15}" font-size="${fs}" font-weight="700" fill="var(--i2)">${escapeHtml(b.no)}</text>`}
      ${short && !grp ? `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + fs * 0.9}" font-size="${fs * 0.9}" text-anchor="middle" fill="var(--ak)">${escapeHtml(short)}</text>` : ''}
      <title>${escapeHtml(b.no)} · ${b.w}×${b.h}m · ${st.label}${name ? ' · ' + escapeHtml(name) : ''}${b.memo ? ' · ' + escapeHtml(b.memo) : ''}</title>
    </g>`;
  }).join('');
  const size = fit ? `width="100%" style="display:block;background:var(--W);touch-action:none;max-height:calc(100vh - 290px);margin:0 auto"`
    : `width="${W * px}" height="${H * px}" style="display:block;background:var(--W);touch-action:none"`;
  return `<div style="overflow:auto;max-height:calc(100vh - 280px);border:1px solid var(--i6);border-radius:var(--r);background:var(--i9)">
    <svg id="fp-svg" viewBox="0 0 ${W} ${H}" ${size} preserveAspectRatio="xMidYMin meet"
      onpointerdown="fpDown(event)">
      ${grid.join('')}
      <rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="var(--i3)" stroke-width="0.12"/>
      ${zonesSvg(p)}
      ${booths}
      ${[...groups].map(([k, idx]) => groupSvg(p, idx, exOf[idx[0]][0])).join('')}
    </svg></div>`;
}

/* 한 기업이 쓰는 칸들을 테두리 하나로 묶고 «번호 범위 + 기업명»을 한 번 쓴다.
   칸들이 네모를 꽉 채우면 바깥 테두리 하나, 아니면(ㄱ자 등) 칸 테두리를 그대로 두고 첫 줄 가운데에 쓴다 */
function groupSvg(p, idx, x){
  const bs = idx.map(i => p.booths[i]);
  const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
  const x1 = Math.max(...bs.map(b => b.x + b.w)), y1 = Math.max(...bs.map(b => b.y + b.h));
  const area = bs.reduce((a, b) => a + b.w * b.h, 0);
  const rect = Math.abs(area - (x1 - x0) * (y1 - y0)) < 0.01;
  const row = rect ? bs : bs.filter(b => b.y === y0);
  const lx0 = Math.min(...row.map(b => b.x)), lx1 = Math.max(...row.map(b => b.x + b.w));
  const ly1 = rect ? y1 : Math.max(...row.map(b => b.y + b.h));
  const fs = Math.min(...bs.map(b => Math.min(b.w, b.h))) * 0.22;
  const name = exhNames(x).ko;
  const maxCh = Math.max(3, Math.floor((lx1 - lx0) / (fs * 1.0)));
  const short = name.length > maxCh ? name.slice(0, maxCh - 1) + '…' : name;
  const sel = idx.includes(fp.sel);
  const sc = isConfirmed(x) ? BOOTH_STATES.confirmed.stroke : BOOTH_STATES.pending.stroke;
  const outline = rect
    ? `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="${sel ? 'var(--ak)' : sc}" stroke-width="${sel ? 0.18 : 0.12}"/>`
    : bs.map(b => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="${sc}" stroke-width="0.1"/>`).join('');
  return `<g style="pointer-events:none">${outline}
    <text x="${x0 + 0.2}" y="${y0 + fs + 0.15}" font-size="${fs}" font-weight="700" fill="var(--i2)">${escapeHtml(x.booth_no)}</text>
    <text x="${(lx0 + lx1) / 2}" y="${(y0 + ly1) / 2 + fs * 0.9}" font-size="${fs * 1.05}" font-weight="700" text-anchor="middle" fill="var(--ak)">${escapeHtml(short)}</text>
  </g>`;
}

/* 모든 홀을 한 장에 나란히 — 실제 크기 비율 그대로, 화면 폭에 맞춰. 부스를 누르면 그 홀로 들어간다 */
function allPlansSvg(all){
  const GAP = 6;
  let ox = 0; const parts = []; let H = 0;
  fp.plans.forEach(p => {
    const W = +p.width || 60, h = +p.height || 40;
    const keep = { sel: fp.sel, selZ: fp.selZ }; fp.sel = -1; fp.selZ = -1;
    const inner = planSvg(p, all).match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1];
    Object.assign(fp, keep);
    parts.push(`<g transform="translate(${ox} 4)" onclick="fpSelPlan('${escAttr(p.id)}')" style="cursor:pointer">
      <text x="0" y="-1.2" font-size="2.2" font-weight="700" fill="var(--i1)">${escapeHtml(p.name)}</text>${inner}</g>`);
    ox += W + GAP; H = Math.max(H, h);
  });
  return `<div style="border:1px solid var(--i6);border-radius:var(--r);background:var(--W)">
    <svg viewBox="-1 0 ${ox - GAP + 2} ${H + 5}" width="100%" style="display:block;max-height:calc(100vh - 260px)" preserveAspectRatio="xMidYMin meet">
      ${parts.join('')}</svg></div>
    <div style="font-size:var(--fs-11);color:var(--i4);margin-top:4px">홀을 누르면 그 홀에서 배정·편집합니다</div>`;
}
function fpAll(){ fp.all = !fp.all; fp.sel = -1; fp.selZ = -1; fp.pick = null; redraw(); }

function zonesSvg(p){
  return (p.zones || []).map((z, i) => {
    const sel = i === fp.selZ;
    const fs = Math.max(0.8, Math.min(z.w / Math.max(2, z.label.length) * 0.9, z.h * 0.25, 2.2));
    return `<g data-z="${i}" class="fp-zone" style="cursor:${exhLocked() ? 'pointer' : 'move'}">
      <rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" fill="var(--pb)" stroke="var(--pu)"
        stroke-width="${sel ? 0.2 : 0.08}" ${sel ? '' : 'stroke-dasharray="0.5 0.3"'}/>
      <text x="${z.x + z.w / 2}" y="${z.y + z.h / 2 + fs * 0.35}" font-size="${fs}" text-anchor="middle" font-weight="700" fill="var(--pu)">${escapeHtml(z.label)}</text>
      <title>${escapeHtml(z.label)} · ${z.w}×${z.h}m</title></g>`;
  }).join('');
}

function zonePanel(z, ro){
  return `<div class="uc" style="padding:10px 12px;margin-bottom:10px">
    <div style="font-weight:700;font-size:var(--fs-13);margin-bottom:6px;color:var(--pu)">구역 · ${escapeHtml(z.label)}</div>
    ${ro ? `<div style="font-size:var(--fs-11_5)">${z.w}×${z.h}m</div>` : `<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center;font-size:var(--fs-11_5)">
      <span>이름</span><input class="fi" value="${escAttr(z.label)}" onchange="fpSetZone('label', this.value)">
      <span>가로 m</span><input class="fi" type="number" step="0.5" min="1" value="${z.w}" onchange="fpSetZone('w', this.value)">
      <span>세로 m</span><input class="fi" type="number" step="0.5" min="1" value="${z.h}" onchange="fpSetZone('h', this.value)">
    </div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn bs" style="color:var(--re)" onclick="fpDelZone()">구역 지우기</button></div>`}
  </div>`;
}

function sidePanel(p, all, ro){
  const b = p.booths[fp.sel];
  const z = (p.zones || [])[fp.selZ];
  let top = z ? zonePanel(z, ro) : '';
  if(b){
    const ex = exhOfBooth(b.no, all);
    top = `<div class="uc" style="padding:10px 12px;margin-bottom:10px">
      <div style="font-weight:700;font-size:var(--fs-13);margin-bottom:6px">부스 ${escapeHtml(b.no)}</div>
      ${ro ? '' : `<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 8px;align-items:center;font-size:var(--fs-11_5)">
        <span>번호</span><input class="fi" value="${escAttr(b.no)}" onchange="fpSetBooth('no', this.value)">
        <span>가로 m</span><input class="fi" type="number" step="0.5" min="1" value="${b.w}" onchange="fpSetBooth('w', this.value)">
        <span>세로 m</span><input class="fi" type="number" step="0.5" min="1" value="${b.h}" onchange="fpSetBooth('h', this.value)">
      </div>`}
      <div style="margin-top:8px;font-size:var(--fs-11_5)">
        ${ex.length ? ex.map(x => `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="flex:1;cursor:pointer;color:var(--ak)" onclick="openExhDr('${escAttr(x.id)}','progress')"
              title="${escAttr(boothTypeText(x.booth_type))}">${escapeHtml(exhNames(x).ko)}
              <span style="color:var(--i4)">${escapeHtml(x.booth_no)}</span></span>
            ${ro ? `<span class="pill ${isConfirmed(x) ? 'p-blue' : 'p-amber'}">${isConfirmed(x) ? '확정' : '미정'}</span>`
              : `<div class="seg" title="진행현황의 «부스 배정 확정»과 같은 값이에요">
                  <button class="seg-b${isConfirmed(x) ? '' : ' on'}" onclick="fpConfirm('${escAttr(x.id)}', false)">미정</button>
                  <button class="seg-b${isConfirmed(x) ? ' on' : ''}" onclick="fpConfirm('${escAttr(x.id)}', true)">확정</button></div>
                <button class="btn bs" onclick="fpPick('${escAttr(x.id)}')" title="이 기업을 고른 채로 옆 칸을 누르면 «시작-끝»으로 늘어납니다">＋칸</button>
                <button class="btn bs" onclick="fpUnassign('${escAttr(x.id)}')" title="이 기업의 부스 번호를 비웁니다">빼기</button>`}
          </div>`).join('')
          : `<div style="color:var(--i4);margin-bottom:6px">${b.state === 'blocked' ? '배정할 수 없는 칸이에요.' : '아래 목록에서 기업을 고르면 여기 배정돼요.'}</div>
            ${ro ? `<span class="pill">${BOOTH_STATES[boothState(b, ex)].label}</span>` : `<div class="seg" style="flex-wrap:wrap">
              ${['empty', 'hold', 'org', 'blocked'].map(k => `<button class="seg-b${boothState(b, ex) === k ? ' on' : ''}" title="${escAttr(BOOTH_STATES[k].note)}"
                onclick="fpSetBooth('state', '${k}')">${BOOTH_STATES[k].label}</button>`).join('')}</div>
            <input class="fi" style="width:100%;margin-top:6px" placeholder="메모 (예: A사 협의 중, 기둥)" value="${escAttr(b.memo || '')}" onchange="fpSetBooth('memo', this.value)">`}`}
      </div>
      ${ro ? '' : `<div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn bs" onclick="fpDupBooth()">복제</button>
        <button class="btn bs" style="color:var(--re)" onclick="fpDelBooth()">부스 지우기</button></div>`}
    </div>`;
  }
  /* 배치도에 아직 자리가 없는 기업 — 번호가 없거나, 있어도 어느 도면에도 그 칸이 없다 */
  const nos = allBoothNos();
  const q = fp.q.trim().toLowerCase();
  const waiting = all.filter(x => !onPlan(x, nos))
    .filter(x => !q || (exhNames(x).ko + ' ' + exhNames(x).en + ' ' + (x.booth_no || '')).toLowerCase().includes(q))
    .sort((a, b) => boothSortKey(a) - boothSortKey(b) || exhNames(a).ko.localeCompare(exhNames(b).ko));
  const list = waiting.map(x => {
    const on = fp.pick === x.id;
    return `<div onclick="${ro ? '' : `fpPick('${escAttr(x.id)}')`}" style="padding:5px 8px;border-radius:var(--rs);cursor:pointer;
        font-size:var(--fs-11_5);display:flex;gap:6px;${on ? 'background:var(--a);color:var(--on)' : ''}">
      <span style="flex:1">${escapeHtml(exhNames(x).ko)}</span>
      <span style="opacity:.7">${x.booth_no ? escapeHtml(x.booth_no) : '번호 없음'}</span></div>`;
  }).join('');
  return top + `<div class="uc" style="padding:10px 12px">
    <div style="font-weight:700;font-size:var(--fs-12_5);margin-bottom:4px">배치 안 된 기업 ${waiting.length}</div>
    <div style="font-size:var(--fs-10_5);color:var(--i4);margin-bottom:6px">${
      fp.pick ? '<b style="color:var(--a)">이제 도면에서 부스를 누르세요</b> — 그 번호로 배정되고, 붙은 칸이면 «시작-끝»으로 늘어납니다' : '기업을 고른 뒤 부스를 누르면 배정돼요'}</div>
    <input class="fi" placeholder="기업 찾기" value="${escAttr(fp.q)}" oninput="fpSearch(this.value)" style="width:100%;margin-bottom:6px">
    <div style="max-height:46vh;overflow:auto">${list || '<div style="color:var(--i4);font-size:var(--fs-11_5)">모두 배치됐어요</div>'}</div>
  </div>`;
}

/* ── 끌어 옮기기 / 누르기 ── */
let drag = null;
function svgPoint(e){
  const svg = document.getElementById('fp-svg');
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
const snap = (v) => Math.round(v / GRID) * GRID;

function fpDown(e){
  const g = e.target.closest('.fp-booth');
  const p = curPlan();
  const gz = !g && e.target.closest('.fp-zone');
  if(gz){
    const zi = +gz.dataset.z, z = p.zones[zi];
    fp.sel = -1;
    if(exhLocked()){ fp.selZ = zi; redraw(); return; }
    const s = svgPoint(e);
    drag = { z: true, i: zi, dx: s.x - z.x, dy: s.y - z.y, moved: false, x0: z.x, y0: z.y };
    e.preventDefault();
    window.addEventListener('pointermove', fpMove);
    window.addEventListener('pointerup', fpUp, { once: true });
    return;
  }
  if(!g){ if(fp.sel !== -1 || fp.selZ !== -1){ fp.sel = -1; fp.selZ = -1; redraw(); } return; }
  fp.selZ = -1;
  const i = +g.dataset.i;
  const b = p.booths[i];
  /* 기업을 고른 채로 부스를 누르면 배정 — 끌기보다 먼저 */
  if(fp.pick){
    if(b.state === 'blocked' && !exhOfBooth(b.no, activeExhibitors(exhEvent)).length){
      alert(`부스 ${b.no}은(는) 배정불가 칸이에요${b.memo ? ` (${b.memo})` : ''}. 칸을 눌러 상태를 바꾼 뒤 배정하세요.`);
      fp.pick = null; fp.sel = i; return redraw();
    }
    if(b.state === 'hold' && !confirm(`부스 ${b.no}은(는) 보류 칸이에요${b.memo ? ` (${b.memo})` : ''}. 그래도 배정할까요?`)){ fp.pick = null; return redraw(); }
    assign(fp.pick, b.no); return;
  }
  if(exhLocked()){ fp.sel = i; redraw(); return; }
  const s = svgPoint(e);
  drag = { i, dx: s.x - b.x, dy: s.y - b.y, moved: false, x0: b.x, y0: b.y };
  e.preventDefault();
  window.addEventListener('pointermove', fpMove);
  window.addEventListener('pointerup', fpUp, { once: true });
}
function fpMove(e){
  if(!drag) return;
  const p = curPlan(); const b = drag.z ? p.zones[drag.i] : p.booths[drag.i];
  const s = svgPoint(e);
  const nx = Math.max(0, Math.min((+p.width) - b.w, snap(s.x - drag.dx)));
  const ny = Math.max(0, Math.min((+p.height) - b.h, snap(s.y - drag.dy)));
  if(nx === b.x && ny === b.y) return;
  b.x = nx; b.y = ny; drag.moved = true;
  const g = document.querySelector(drag.z ? `#fp-svg .fp-zone[data-z="${drag.i}"]` : `#fp-svg .fp-booth[data-i="${drag.i}"]`);
  if(g) g.setAttribute('transform', `translate(${nx - drag.x0} ${ny - drag.y0})`);
}
function fpUp(){
  window.removeEventListener('pointermove', fpMove);
  const d = drag; drag = null;
  if(!d) return;
  if(d.z) fp.selZ = d.i; else fp.sel = d.i;
  if(d.moved) savePlan(curPlan());
  redraw();
}

/* ── 배정 ── */
async function assign(exhId, no){
  const x = activeExhibitors(exhEvent).find(e => e.id === exhId);
  fp.pick = null;
  if(!x) return redraw();
  const old = String(x.booth_no || '').trim();
  const nos = new Set(curPlan().booths.map(b => String(b.no).trim()));
  const n = /^\d+$/.test(no) ? +no : null;
  const op = parseBooth(old);
  let newNo = no, qty = 1;
  /* 여러 부스는 «시작-끝»으로 적는다 — 붙은 칸을 누르면 늘리고, 부스 수가 정해진 기업은 처음부터 그만큼 */
  if(n !== null && old && ['single', 'range'].includes(op.kind) && (n === op.last + 1 || n === op.first - 1)
     && confirm(`${exhNames(x).ko}의 부스를 ${old} → ${Math.min(n, op.first)}-${Math.max(n, op.last)}(으)로 늘릴까요?
(취소하면 ${no} 한 칸으로 바꿀지 묻습니다)`)){
    const a = Math.min(n, op.first), b = Math.max(n, op.last);
    newNo = `${a}-${b}`; qty = b - a + 1;
  } else {
    const want = Math.max(1, parseInt(String(x.booth_qty || '').replace(/[^0-9]/g, ''), 10) || 1);
    const run = n !== null && want > 1 && Array.from({ length: want }, (_, k) => String(n + k)).every(v => nos.has(v));
    if(run && confirm(`${exhNames(x).ko}은(는) ${want}부스예요. ${n}-${n + want - 1}(으)로 배정할까요?
(취소하면 ${no} 한 칸만)`)){
      newNo = `${n}-${n + want - 1}`; qty = want;
    }
    if(old && old !== newNo && !confirm(`${exhNames(x).ko}의 부스 번호를 ${old} → ${newNo}(으)로 바꿀까요?`)) return redraw();
  }
  const taken = exhOfBooth(no, activeExhibitors(exhEvent)).filter(e => e.id !== exhId);
  if(taken.length && !confirm(`부스 ${no}에는 이미 ${taken.map(e => exhNames(e).ko).join(', ')}이(가) 있어요. 같이 쓰는 부스로 넣을까요?`)) return redraw();
  fp.sel = curPlan().booths.findIndex(b => b.no === no);
  const patch = { booth_no: newNo };
  if(qty > 1 || /-/.test(old)) patch.booth_qty = String(qty);   // 번호와 부스 수가 어긋나면 청구액이 틀어진다
  await patchExh(exhId, patch, '배치도 배정');
}
/* 진행현황 «부스 배정 확정»과 같은 칸을 켜고 끈다 — 켤 때 오늘 날짜를 함께 찍는다(toggleExhFlag와 같은 규칙) */
function fpConfirm(exhId, on){
  const x = activeExhibitors(exhEvent).find(e => e.id === exhId);
  if(!x || isConfirmed(x) === on) return;
  patchExh(exhId, on ? { booth_confirmed: 'yes', booth_confirmed_at: td() } : { booth_confirmed: '', booth_confirmed_at: '' },
    on ? '부스 배정 확정' : '부스 배정 미정');
}
function fpUnassign(exhId){
  const x = activeExhibitors(exhEvent).find(e => e.id === exhId);
  if(!x || !confirm(`${exhNames(x).ko}의 부스 번호(${x.booth_no})를 비울까요?`)) return;
  patchExh(exhId, { booth_no: '' }, '배치도 배정 해제');
}

/* ── 도면·부스 고치기 ── */
function askNum(msg, def){
  const v = prompt(msg, def);
  if(v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : NaN;
}
function fpAddPlan(){
  if(!fp.plans) return;
  const name = prompt('도면 이름 (예: 1홀, 3층 그랜드볼룸)', `${(fp.plans.length + 1)}홀`);
  if(!name) return;
  const w = askNum('홀 가로 길이(m)', '60'); if(!w) return;
  const h = askNum('홀 세로 길이(m)', '40'); if(!h) return;
  const p = { id: 'FP-' + Date.now(), event_id: exhEvent, name: name.trim(), width: w, height: h,
    booths: [], zones: [], bg_url: '', sort_order: fp.plans.length, note: '' };
  fp.plans.push(p); fp.cur = p.id; fp.sel = -1;
  savePlan(p, true); redraw();
}
function fpEditPlan(){
  const p = curPlan(); if(!p) return;
  const name = prompt('도면 이름 — 비우면 이 도면을 지웁니다', p.name);
  if(name === null) return;
  if(!name.trim()){
    if(!confirm(`«${p.name}» 도면과 부스 칸 ${p.booths.length}개를 지울까요?\n기업의 부스 번호는 그대로 남습니다.`)) return;
    fp.plans = fp.plans.filter(q => q.id !== p.id); fp.cur = fp.plans[0]?.id || null; fp.sel = -1;
    deleteFloorPlan(p.id); redraw(); return;
  }
  const w = askNum('홀 가로 길이(m)', p.width); if(!w) return;
  const h = askNum('홀 세로 길이(m)', p.height); if(!h) return;
  Object.assign(p, { name: name.trim(), width: w, height: h });
  savePlan(p, true); redraw();
}
/* 부스 한 줄을 한 번에 — 번호를 이어 매기고 빈 자리 맨 아래(통로 2m 띄워)에 놓는다 */
function fpAddRow(){
  const p = curPlan(); if(!p) return;
  const nums = p.booths.map(b => parseInt(b.no, 10)).filter(Number.isFinite);
  const start = prompt('첫 부스 번호', String(nums.length ? Math.max(...nums) + 1 : 1));
  if(!start) return;
  const n = askNum('몇 칸?', '10'); if(!n) return;
  const w = askNum('부스 가로(m)', '3'); if(!w) return;
  const h = askNum('부스 세로(m)', '3'); if(!h) return;
  const bottom = p.booths.reduce((a, b) => Math.max(a, b.y + b.h), 0);
  let y = p.booths.length ? bottom + AISLE : AISLE;
  if(y + h > +p.height) y = Math.max(0, +p.height - h);
  const prefix = start.replace(/\d+$/, ''), s0 = parseInt(start.match(/\d+$/)?.[0] || '1', 10);
  for(let k = 0; k < n; k++){
    const x = Math.min(AISLE + k * w, Math.max(0, +p.width - w));
    p.booths.push({ no: prefix + (s0 + k), x, y, w, h });
  }
  fp.sel = -1; savePlan(p, true); redraw();
}
function fpSetBooth(k, v){
  const p = curPlan(); const b = p?.booths[fp.sel]; if(!b) return;
  if(k === 'state'){ b.state = v === 'empty' ? '' : v; savePlan(p, true); return redraw(); }
  if(k === 'memo'){ b.memo = String(v).trim(); savePlan(p); return redraw(); }
  if(k === 'no'){
    const nv = String(v).trim(); if(!nv) return redraw();
    const users = exhOfBooth(b.no, activeExhibitors(exhEvent)).filter(x => String(x.booth_no).trim() === String(b.no).trim());
    b.no = nv;
    /* 칸 번호를 바꾸면 그 번호로 배정된 기업도 따라간다 — 안 그러면 기업이 배치 밖으로 떨어진다 */
    if(users.length && confirm(`이 부스에 배정된 ${users.map(x => exhNames(x).ko).join(', ')}의 부스 번호도 ${nv}(으)로 바꿀까요?`)){
      users.forEach(x => patchExh(x.id, { booth_no: nv }, '배치도 번호 변경'));
    }
  } else {
    const n = Number(v); if(!(n > 0)) return redraw();
    b[k] = n;
  }
  savePlan(p); redraw();
}
function fpDupBooth(){
  const p = curPlan(); const b = p?.booths[fp.sel]; if(!b) return;
  const m = String(b.no).match(/^(.*?)(\d+)$/);
  const no = m ? m[1] + (+m[2] + 1) : b.no + "'";
  p.booths.push({ ...b, no, x: Math.min(b.x + b.w, +p.width - b.w) });
  fp.sel = p.booths.length - 1; savePlan(p); redraw();
}
function fpDelBooth(){
  const p = curPlan(); const b = p?.booths[fp.sel]; if(!b) return;
  if(!confirm(`부스 칸 ${b.no}을(를) 도면에서 지울까요? 기업의 부스 번호는 그대로 남습니다.`)) return;
  p.booths.splice(fp.sel, 1); fp.sel = -1; savePlan(p); redraw();
}
/* 구역 — 세미나·컨퍼런스·무대·라운지. 부스 번호가 없고 기업을 배정하지 않는다 */
function fpAddZone(){
  const p = curPlan(); if(!p) return;
  const label = prompt('구역 이름 (예: 세미나, 컨퍼런스룸, 무대, 라운지)', '세미나');
  if(!label || !label.trim()) return;
  const w = askNum('가로(m)', '12'); if(!w) return;
  const h = askNum('세로(m)', '9'); if(!h) return;
  p.zones = p.zones || [];
  p.zones.push({ label: label.trim(), x: Math.max(0, Math.min(AISLE, +p.width - w)), y: Math.max(0, Math.min(AISLE, +p.height - h)), w, h });
  fp.sel = -1; fp.selZ = p.zones.length - 1; savePlan(p, true); redraw();
}
function fpSetZone(k, v){
  const p = curPlan(); const z = p?.zones?.[fp.selZ]; if(!z) return;
  if(k === 'label'){ if(!String(v).trim()) return redraw(); z.label = String(v).trim(); }
  else { const n = Number(v); if(!(n > 0)) return redraw(); z[k] = n; }
  savePlan(p); redraw();
}
function fpDelZone(){
  const p = curPlan(); const z = p?.zones?.[fp.selZ]; if(!z) return;
  if(!confirm(`구역 «${z.label}»을(를) 지울까요?`)) return;
  p.zones.splice(fp.selZ, 1); fp.selZ = -1; savePlan(p); redraw();
}
function fpSelPlan(id){ fp.all = false; fp.cur = id; fp.sel = -1; fp.selZ = -1; fp.pick = null; redraw(); }
function fpPick(id){ fp.pick = fp.pick === id ? null : id; redraw(); }
function fpZoom(d){ fp.zoom = Math.max(1, Math.min(4, +(fp.zoom + d * 0.5).toFixed(1))); redraw(); }
let qTimer = null;
function fpSearch(v){
  fp.q = v; clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    redraw();
    const el = document.querySelector('#fp-root input[placeholder="기업 찾기"]');
    if(el){ el.focus(); el.setSelectionRange(v.length, v.length); }
  }, 200);
}

Object.assign(window, { renderFloorView, fpDown, fpAddPlan, fpEditPlan, fpAddRow, fpSetBooth, fpDupBooth,
  fpDelBooth, fpAddZone, fpSetZone, fpDelZone, fpSelPlan, fpConfirm, fpAll, fpPick, fpZoom, fpSearch, fpUnassign });
