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
const fp = {
  ev: null,                  // 지금 들고 있는 도면이 어느 행사 것인지
  plans: null,               // null = 불러오는 중
  cur: null,                 // 보고 있는 도면 id
  sel: -1,                   // 고른 부스 칸 번호(booths 배열 자리)
  selZ: -1,                  // 고른 구역 번호(zones 배열 자리) — 세미나·컨퍼런스·무대
  pick: null,                // 배정하려고 고른 기업 id — 그다음 누른 부스에 넣는다
  zoom: 1,
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
  const tabs = fp.plans.map(p => `<button class="seg-b${p.id === fp.cur ? ' on' : ''}"
      onclick="fpSelPlan('${escAttr(p.id)}')">${escapeHtml(p.name || '도면')} <span style="color:var(--i4)">${p.booths.length}</span></button>`).join('');
  const bar = `<div class="sec sec-bar" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      ${fp.plans.length ? `<div class="seg">${tabs}</div>` : ''}
      ${ro ? '' : `<button class="btn bs" onclick="fpAddPlan()">+ 도면 추가</button>`}
      ${curPlan() && !ro ? `<button class="btn bs" onclick="fpEditPlan()">도면 설정</button>
        <button class="btn bs bp" onclick="fpAddRow()">+ 부스 줄 추가</button>
        <button class="btn bs" onclick="fpAddZone()" title="세미나·컨퍼런스·무대·라운지처럼 부스가 아닌 공간">+ 구역 추가</button>` : ''}
      ${curPlan() ? `<span style="margin-left:auto;display:flex;gap:4px;align-items:center">
        <button class="btn bs" onclick="fpZoom(-1)" title="작게">−</button>
        <span style="font-size:var(--fs-11);color:var(--i4);min-width:38px;text-align:center">${Math.round(fp.zoom * 100)}%</span>
        <button class="btn bs" onclick="fpZoom(1)" title="크게">＋</button></span>` : ''}
    </div>`;
  if(!fp.plans.length){
    return bar + `<div class="sec" style="text-align:center;padding:40px 0;color:var(--i4);font-size:var(--fs-12_5)">
      아직 도면이 없어요. «+ 도면 추가»로 홀 크기(가로·세로 m)를 정하고 부스를 놓으세요.<br>
      <span style="font-size:var(--fs-11)">배정한 부스 번호는 기업의 부스 번호(부스 현황)에 그대로 들어갑니다.</span></div>`;
  }
  const p = curPlan();
  const all = activeExhibitors(exhEvent).filter(x => !isNoBooth(x));
  return bar + `<div class="sec" style="display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:12px;align-items:start">
      <div>${planSvg(p, all)}${legend(p, all)}</div>
      <div>${sidePanel(p, all, ro)}</div>
    </div>`;
}

function legend(p, all){
  const assigned = p.booths.filter(b => exhOfBooth(b.no, all).length).length;
  return `<div style="display:flex;gap:10px;align-items:center;font-size:var(--fs-11);color:var(--i3);margin-top:6px;flex-wrap:wrap">
    <span><i style="display:inline-block;width:10px;height:10px;background:var(--ad);border:1px solid var(--a);vertical-align:-1px"></i> 배정 ${assigned}</span>
    <span><i style="display:inline-block;width:10px;height:10px;background:var(--W);border:1px dashed var(--i4);vertical-align:-1px"></i> 빈 부스 ${p.booths.length - assigned}</span>
    <span><i style="display:inline-block;width:10px;height:10px;background:var(--rb);border:1px solid var(--re);vertical-align:-1px"></i> 번호 겹침</span>
    <span><i style="display:inline-block;width:10px;height:10px;background:var(--pb);border:1px solid var(--pu);vertical-align:-1px"></i> 구역</span>
    <span style="color:var(--i4)">부스·구역을 끌어 옮기고, 눌러서 고르세요 · 눈금 ${GRID}m · 부스 줄 추가 시 통로 ${AISLE}m</span></div>`;
}

function planSvg(p, all){
  const W = +p.width || 60, H = +p.height || 40;
  const px = 14 * fp.zoom;   // 1m당 화면 픽셀
  const dupNo = new Set(); { const s = new Set(); p.booths.forEach(b => { const k = String(b.no).trim(); if(s.has(k)) dupNo.add(k); s.add(k); }); }
  const grid = [];
  for(let x = 0; x <= W; x += 1) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="var(--i7)" stroke-width="${x % 5 ? 0.03 : 0.07}"/>`);
  for(let y = 0; y <= H; y += 1) grid.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="var(--i7)" stroke-width="${y % 5 ? 0.03 : 0.07}"/>`);
  const booths = p.booths.map((b, i) => {
    const ex = exhOfBooth(b.no, all);
    const dup = dupNo.has(String(b.no).trim());
    const sel = i === fp.sel;
    const fill = dup ? 'var(--rb)' : ex.length ? 'var(--ad)' : 'var(--W)';
    const stroke = sel ? 'var(--ak)' : dup ? 'var(--re)' : ex.length ? 'var(--a)' : 'var(--i4)';
    const name = ex.map(x => exhNames(x).ko).join(' / ');
    const fs = Math.min(b.w, b.h) * 0.22;
    const maxCh = Math.max(3, Math.floor(b.w / (fs * 0.95)));
    const short = name.length > maxCh ? name.slice(0, maxCh - 1) + '…' : name;
    return `<g data-i="${i}" class="fp-booth" style="cursor:${exhLocked() ? 'pointer' : 'move'}">
      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${fill}" stroke="${stroke}"
        stroke-width="${sel ? 0.18 : 0.08}" ${ex.length || dup ? '' : 'stroke-dasharray="0.3 0.2"'}/>
      <text x="${b.x + 0.2}" y="${b.y + fs + 0.15}" font-size="${fs}" font-weight="700" fill="var(--i2)">${escapeHtml(b.no)}</text>
      ${short ? `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + fs * 0.9}" font-size="${fs * 0.9}" text-anchor="middle" fill="var(--ak)">${escapeHtml(short)}</text>` : ''}
      <title>${escapeHtml(b.no)} · ${b.w}×${b.h}m${name ? ' · ' + escapeHtml(name) : ' · 빈 부스'}</title>
    </g>`;
  }).join('');
  return `<div style="overflow:auto;max-height:70vh;border:1px solid var(--i6);border-radius:var(--r);background:var(--i9)">
    <svg id="fp-svg" viewBox="0 0 ${W} ${H}" width="${W * px}" height="${H * px}" style="display:block;background:var(--W);touch-action:none"
      onpointerdown="fpDown(event)">
      ${grid.join('')}
      <rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="var(--i3)" stroke-width="0.12"/>
      ${zonesSvg(p)}
      ${booths}
    </svg></div>`;
}

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
            ${ro ? '' : `<button class="btn bs" onclick="fpUnassign('${escAttr(x.id)}')" title="이 기업의 부스 번호를 비웁니다">빼기</button>`}
          </div>`).join('')
          : `<div style="color:var(--i4)">빈 부스예요 — 아래 목록에서 기업을 고르면 여기 배정돼요.</div>`}
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
      fp.pick ? '<b style="color:var(--a)">이제 도면에서 부스를 누르세요</b> — 그 번호로 배정됩니다' : '기업을 고른 뒤 부스를 누르면 배정돼요'}</div>
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
  if(fp.pick){ assign(fp.pick, b.no); return; }
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
  if(old && old !== no && !confirm(`${exhNames(x).ko}의 부스 번호를 ${old} → ${no}(으)로 바꿀까요?`)) return redraw();
  const taken = exhOfBooth(no, activeExhibitors(exhEvent)).filter(e => e.id !== exhId);
  if(taken.length && !confirm(`부스 ${no}에는 이미 ${taken.map(e => exhNames(e).ko).join(', ')}이(가) 있어요. 같이 쓰는 부스로 넣을까요?`)) return redraw();
  fp.sel = curPlan().booths.findIndex(b => b.no === no);
  await patchExh(exhId, { booth_no: no }, '배치도 배정');
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
function fpSelPlan(id){ fp.cur = id; fp.sel = -1; fp.selZ = -1; fp.pick = null; redraw(); }
function fpPick(id){ fp.pick = fp.pick === id ? null : id; redraw(); }
function fpZoom(d){ fp.zoom = Math.max(0.4, Math.min(3, +(fp.zoom + d * 0.2).toFixed(1))); redraw(); }
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
  fpDelBooth, fpAddZone, fpSetZone, fpDelZone, fpSelPlan, fpPick, fpZoom, fpSearch, fpUnassign });
