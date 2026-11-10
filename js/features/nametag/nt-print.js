/* ══════════════════════════════════════════════════════════════
   nt-print.js — 네임택 인쇄 창

   window.open으로 빈 창을 열고 이 화면이 직접 그려 넣는다. 따로 html 파일을 두면 그 창이 로그인·데이터를
   다시 받아야 하는데, 찍을 값은 이미 발급 기록으로 손에 있다.
   - 팝업 차단을 피하려면 단추를 누른 그 순간 창을 열어야 한다 → openPrintWindow()로 먼저 열고,
     발급 기록이 오면 fillPrintWindow()로 그린다
   - @page 크기를 판 크기로 만들어 붙인다. 한 장 = 한 쪽
     출력 종이가 A4(sheet 'a4')면 A4 세로 한 쪽의 맨 위 가운데에 한 장씩 — 작은 종이를 그 크기로
     알려 주면 프린터가 안 받아서, A4로 알려 주고 네임택 종이를 그대로 넣어 위쪽만 찍는다.
     가로는 언제나 가운데. 예전 'a4l'(왼쪽)도 가운데로 찍는다
   - 위 여백(top): 프린터가 못 찍는 종이 앞끝(4mm쯤). 판을 통째로 그만큼 내려 찍는다(세로 보정에 더한다)
   - 한 쪽에 몇 장(A4일 때만): 1장 · 2장(위·아래) · 4장(2 × 2). 여러 장을 한 번에 뽑을 때 종이를 아낀다.
     묶음은 쪽 맨 위 가운데에 붙여 놓고, 인쇄 보정·위 여백은 묶음 전체를 옮긴다. A4에 안 들어가는 배치는 못 고른다.
     고른 값과 간격은 이 브라우저에 둔다(localStorage nametag.per-page.v1)
   - 인쇄 보정(가로·세로 mm, 배율 %)은 프린터마다 종이 먹는 자리가 달라 이 브라우저에 따로 둔다
     (localStorage nametag.print-offset.v1). 없으면 판의 기본값
═══════════════════════════════════════════════════════════════ */
import { ntCardHtml } from './nt-card.js';
import { readyToPrint, fitNametags } from './nt-fit.js';
import { normalizeOffset, A4 } from '../../domain/nametag-layout.js';
import { escapeHtml } from '../../utils.js';

const OFFSET_KEY = 'nametag.print-offset.v1';
const readOffset = (fallback) => {
  try { const v = JSON.parse(localStorage.getItem(OFFSET_KEY) || 'null'); return v ? normalizeOffset(v) : normalizeOffset(fallback); }
  catch { return normalizeOffset(fallback); }
};
const saveOffset = (o) => { try { localStorage.setItem(OFFSET_KEY, JSON.stringify(o)); } catch {} };

/* 한 쪽에 몇 장 — [장 수, 가로 칸, 세로 줄, 이름] */
const PER_PAGE = [[1, 1, 1, '1장'], [2, 1, 2, '2장 (위·아래)'], [4, 2, 2, '4장 (2 × 2)']];
const PER_KEY = 'nametag.per-page.v1';
const readPer = () => {
  try { const v = JSON.parse(localStorage.getItem(PER_KEY) || 'null') || {};
    return { n: PER_PAGE.some(p => p[0] === v.n) ? v.n : 1, gap: Math.min(20, Math.max(0, Number(v.gap) || 0)) }; }
  catch { return { n: 1, gap: 0 }; }
};
const savePer = (v) => { try { localStorage.setItem(PER_KEY, JSON.stringify(v)); } catch {} };
/* 이 배치가 A4 한 쪽에 들어가나 — 위 여백까지 넣어 잰다 */
const fitsA4 = (t, [, cols, rows], gap, top) =>
  cols * t.width_mm + (cols - 1) * gap <= A4.width_mm && top + rows * t.height_mm + (rows - 1) * gap <= A4.height_mm - 1;

/* 하단바 — 종이에는 안 찍는다. 뽑아 나온 네임택에 어느 띠를 끼울지 인쇄 창 위에 보여 준다 */
function barSummary(template, cards){
  if(!(template.bar_types || []).length) return '';
  const color = (l) => (template.bar_types.find(b => b.label === l) || {}).color || '#868e96';
  if(cards.length === 1) return cards[0].bar
    ? ` · 하단바 <b class="nt-bar big"><i style="background:${color(cards[0].bar)}"></i>${escapeHtml(cards[0].bar)}</b>` : ' · 하단바 미정';
  const m = new Map(); cards.forEach(c => m.set(c.bar || '', (m.get(c.bar || '') || 0) + 1));
  return ' · ' + [...m.entries()].map(([l, n]) => l ? `<span class="nt-bar"><i style="background:${color(l)}"></i>${escapeHtml(l)} <b>${n}</b></span>` : `<span class="nt-bar nt-bar-none">미정 ${n}</span>`).join(' ');
}

function pagesHtml(template, cards, a4, n, gap){
  const [, cols] = PER_PAGE.find(p => p[0] === n);
  const pages = [];
  for(let i = 0; i < cards.length; i += n) pages.push(cards.slice(i, i + n));
  return pages.map(group => `<div class="nt-page${a4 ? ' nt-a4' : ''}"${a4 ? '' : ` style="height:${template.height_mm}mm"`}><div class="nt-shift"><div class="nt-grid"
    style="grid-template-columns:repeat(${cols},${template.width_mm}mm);gap:${gap}mm">${group.map(c =>
    `<div class="nt-frame">${ntCardHtml(template, c, { forPrint: true })}</div>`).join('')}</div></div></div>`).join('');
}

export function openPrintWindow(){
  const w = window.open('', 'nametag-print', 'width=960,height=900');
  if(!w) return null;
  w.document.open();
  w.document.write('<!doctype html><meta charset="utf-8"><title>네임택 인쇄</title><p style="font-family:sans-serif;padding:24px">네임택을 준비하는 중…</p>');
  w.document.close();
  return w;
}

export async function fillPrintWindow(w, template, cards){
  if(!w || w.closed) return;
  const css = (p) => new URL(p, location.href).href;
  const off = readOffset(template.print_offset);
  const a4 = template.sheet !== 'fit';
  const paper = a4 ? A4 : template;
  const per = readPer();
  const canUse = (p) => a4 && fitsA4(template, p, per.gap, off.top + off.y);
  if(!canUse(PER_PAGE.find(p => p[0] === per.n))) per.n = 1;
  w.document.open();
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>네임택 인쇄 · ${cards.length}장</title>
<link rel="stylesheet" href="${css('styles/tokens.css')}"><link rel="stylesheet" href="${css('styles/nametag.css')}">
<style>@page{size:${paper.width_mm}mm ${paper.height_mm}mm;margin:0}</style></head>
<body class="nt-print-page">
<div class="nt-print-bar no-print">
  <span><b>${cards.length}장</b><span id="pg"></span>${barSummary(template, cards)} · ${template.width_mm} × ${template.height_mm}mm${a4 ? ' · A4 맨 위 가운데 — 인쇄 대화상자에서 용지 A4' : ''}${cards.length <= 3 ? ' · ' + escapeHtml(cards.map(c => c.name).join(', ')) : ''}</span>
  <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    ${a4 ? `<label title="A4 한 쪽에 몇 장씩 — 이 PC에 기억해요">한 쪽에 <select id="pp">${PER_PAGE.map(p =>
      `<option value="${p[0]}"${p[0] === per.n ? ' selected' : ''}${canUse(p) || p[0] === 1 ? '' : ' disabled'}>${p[3]}${canUse(p) || p[0] === 1 ? '' : ' — A4에 안 들어가요'}</option>`).join('')}</select></label>
    <label title="여러 장일 때 네임택 사이 간격">간격 <input id="gp" type="number" min="0" max="20" step="0.5" value="${per.gap}">mm</label>` : ''}
    <span style="color:#888">인쇄 보정(이 PC)</span>
    <label>가로 <input id="dx" type="number" step="0.5" value="${off.x}">mm</label>
    <label title="프린터가 못 찍는 위 여백 — 판을 이만큼 내려 찍는다">위 여백 <input id="dt" type="number" min="0" max="15" step="0.5" value="${off.top}">mm</label>
    <label>세로 <input id="dy" type="number" step="0.5" value="${off.y}">mm</label>
    <label>배율 <input id="sc" type="number" step="1" value="${off.scale}">%</label>
    <button id="go" class="bp">인쇄</button><button id="cl">닫기</button>
  </span>
</div>
<div class="nt-sheet" id="sheet"></div>
<p class="no-print" style="font-size:12px;color:#888;text-align:center">인쇄 대화상자에서 ${a4 ? '용지 크기 A4, ' : ''}«여백 없음», 배율 100%로 찍어 주세요. 안 나온 장은 데스크의 최근 발급에서 «안 됨»으로 되돌려요.</p>
</body></html>`);
  w.document.close();

  const d = w.document;
  const apply = () => {
    const o = normalizeOffset({ x: d.getElementById('dx').value, y: d.getElementById('dy').value, scale: d.getElementById('sc').value, top: d.getElementById('dt').value });
    d.body.style.setProperty('--nt-dx', `${o.x}mm`);
    d.body.style.setProperty('--nt-dy', `${o.y + o.top}mm`);
    d.body.style.setProperty('--nt-scale', String(o.scale / 100));
    return o;
  };
  /* 한 쪽에 몇 장 — 바꾸면 쪽을 다시 짠다 */
  const layout = () => {
    const pp = d.getElementById('pp'), gp = d.getElementById('gp');
    if(pp){
      per.gap = Math.min(20, Math.max(0, Number(gp.value) || 0));
      const o = normalizeOffset({ top: d.getElementById('dt').value, y: d.getElementById('dy').value });
      [...pp.options].forEach(op => { const p = PER_PAGE.find(x => x[0] === +op.value); op.disabled = p[0] !== 1 && !fitsA4(template, p, per.gap, o.top + o.y); });
      per.n = pp.selectedOptions[0]?.disabled ? 1 : +pp.value;
      pp.value = String(per.n);
      savePer(per);
    }
    d.getElementById('sheet').innerHTML = pagesHtml(template, cards, a4, per.n, per.gap);
    const pages = Math.ceil(cards.length / per.n);
    d.getElementById('pg').textContent = per.n > 1 ? ` · A4 ${pages}쪽` : '';
    fitNametags(d.getElementById('sheet'));
  };
  layout();
  apply();
  ['dx', 'dy', 'sc', 'dt'].forEach(id => d.getElementById(id).addEventListener('change', () => { saveOffset(apply()); if(id !== 'dx' && id !== 'sc') layout(); }));
  ['pp', 'gp'].forEach(id => d.getElementById(id)?.addEventListener('change', layout));
  d.getElementById('go').addEventListener('click', () => w.print());
  d.getElementById('cl').addEventListener('click', () => w.close());

  await readyToPrint(d);
  w.focus();
  w.print();
}
