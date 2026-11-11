/* ══════════════════════════════════════════════════════════════
   nt-print.js — 네임택 인쇄 창

   window.open으로 빈 창을 열고 이 화면이 직접 그려 넣는다. 따로 html 파일을 두면 그 창이 로그인·데이터를
   다시 받아야 하는데, 찍을 값은 이미 발급 기록으로 손에 있다.
   - 팝업 차단을 피하려면 단추를 누른 그 순간 창을 열어야 한다 → openPrintWindow()로 먼저 열고,
     발급 기록이 오면 fillPrintWindow()로 그린다
   - 창을 연다고 바로 인쇄 대화상자를 띄우지 않는다. 창 위 «인쇄»를 눌러야 연다(보정·장 수를 먼저 고르게)
   - @page 크기를 판 크기로 만들어 붙인다. 한 장 = 한 쪽
     출력 종이가 A4(sheet 'a4')면 A4 세로 한 쪽의 맨 위 가운데에 한 장씩 — 작은 종이를 그 크기로
     알려 주면 프린터가 안 받아서, A4로 알려 주고 네임택 종이를 그대로 넣어 위쪽만 찍는다.
     가로는 언제나 가운데. 예전 'a4l'(왼쪽)도 가운데로 찍는다
   - 위 여백(top): 프린터가 못 찍는 종이 앞끝(4mm쯤). 판을 통째로 그만큼 내려 찍는다(세로 보정에 더한다)
   - 한 쪽에 몇 장(판 용지와 상관없이): 1장 · 2장(위·아래) · 4장(2 × 2). 여러 장을 한 번에 뽑을 때 종이를 아낀다.
     묶음은 쪽 맨 위 가운데에 붙여 놓고, 인쇄 보정·위 여백은 묶음 전체를 옮긴다. 2장·4장은 판 용지가 «판 크기 그대로»여도
     언제나 A4 쪽으로 찍는다 — 쪽을 묶음 크기(판 두 배)로 잡으면 프린터가 못 찍는 가장자리에서 잘린다(2026-11-11).
     A4에 다 안 들어가는 배치도 고를 수는 있지만 인쇄 창 위에 «잘려요»로 알린다
   - 칼선(재단선, A4일 때): 네임택 가장자리마다 묶음 바깥에 짧은 선을 그어 A4에 찍은 것을 재단기로 자르게 한다(2026-11-11).
     선은 네임택 안으로 들어가지 않는다. 선 자리(CUT_OFF + CUT_LEN)만큼 묶음 위아래를 비워 두니 판이 그만큼 내려간다.
     여러 장이면 기본으로 켜고, 1장은 기본으로 끈다(네임택 종이를 넣어 찍을 때 자리가 바뀌지 않게). 이 PC에 기억
     고른 값과 간격은 이 브라우저에 둔다(localStorage nametag.per-page.v1)
   - 인쇄 보정(가로·세로 mm, 배율 %)은 프린터마다 종이 먹는 자리가 달라 이 브라우저에 따로 둔다
     (localStorage nametag.print-offset.v1). 없으면 판의 기본값
═══════════════════════════════════════════════════════════════ */
import { ntCardHtml } from './nt-card.js';
import { readyToPrint, fitNametags } from './nt-fit.js';
import { normalizeOffset, A4 } from '../../domain/nametag-layout.js';
import { escapeHtml } from '../../utils.js';

/* PC 보정은 종이마다 따로 둔다(«A4» · «판 크기 그대로 W×H»). 예전에는 한 값을 모든 행사가 같이 써서,
   A4 행사에서 맞춘 세로 10mm가 100×100mm «판 크기 그대로» 행사에 그대로 붙어 아래 14mm가 잘렸다(2026-11-11 KHIDI-AI).
   예전 값(v1)은 A4 종이에만 이어 쓴다 */
const OFFSET_KEY = 'nametag.print-offset.v1';
const offsetKey = (t) => t.sheet === 'fit' ? `nametag.print-offset.fit-${t.width_mm}x${t.height_mm}` : 'nametag.print-offset.a4';
const readOffset = (t) => {
  try {
    const v = JSON.parse(localStorage.getItem(offsetKey(t)) || (t.sheet === 'fit' ? 'null' : localStorage.getItem(OFFSET_KEY) || 'null'));
    return normalizeOffset(v || t.print_offset);
  } catch { return normalizeOffset(t.print_offset); }
};
const saveOffset = (t, o) => { try { localStorage.setItem(offsetKey(t), JSON.stringify(o)); } catch {} };

/* 한 쪽에 몇 장 — [장 수, 가로 칸, 세로 줄, 이름] */
const PER_PAGE = [[1, 1, 1, '1장'], [2, 1, 2, '2장 (위·아래)'], [4, 2, 2, '4장 (2 × 2)']];
const PER_KEY = 'nametag.per-page.v1';
const readPer = () => {
  try { const v = JSON.parse(localStorage.getItem(PER_KEY) || 'null') || {};
    return { n: PER_PAGE.some(p => p[0] === v.n) ? v.n : 1, gap: Math.min(20, Math.max(0, Number(v.gap) || 0)),
      cut1: v.cut1 === true, cutN: v.cutN !== false }; }
  catch { return { n: 1, gap: 0, cut1: false, cutN: true }; }
};
/* 칼선 — 네임택 가장자리에서 CUT_OFF 떨어져 CUT_LEN 길이. 묶음 위아래로 CUT_ROOM씩 비운다 */
const CUT_OFF = 2, CUT_LEN = 6, CUT_ROOM = CUT_OFF + CUT_LEN;
function cutMarks(t, cols, rows, gap){
  const xs = [...new Set(Array.from({ length: cols }, (_, i) => [i * (t.width_mm + gap), i * (t.width_mm + gap) + t.width_mm]).flat())];
  const ys = [...new Set(Array.from({ length: rows }, (_, i) => [i * (t.height_mm + gap), i * (t.height_mm + gap) + t.height_mm]).flat())];
  const W = cols * t.width_mm + (cols - 1) * gap, H = rows * t.height_mm + (rows - 1) * gap;
  const v = (x, y) => `<i class="nt-trim v" style="left:${x}mm;top:${y}mm;height:${CUT_LEN}mm"></i>`;
  const h = (x, y) => `<i class="nt-trim h" style="left:${x}mm;top:${y}mm;width:${CUT_LEN}mm"></i>`;
  return xs.map(x => v(x, -CUT_ROOM) + v(x, H + CUT_OFF)).join('') + ys.map(y => h(-CUT_ROOM, y) + h(W + CUT_OFF, y)).join('');
}
const savePer = (v) => { try { localStorage.setItem(PER_KEY, JSON.stringify(v)); } catch {} };
/* 이 배치가 A4 한 쪽에 들어가나 — 위 여백까지 넣어 잰다 */
const fitsA4 = (t, n, gap, top, cut) => { const [, cols, rows] = PER_PAGE.find(p => p[0] === n);
  return cols * t.width_mm + (cols - 1) * gap <= A4.width_mm && top + (cut ? 2 * CUT_ROOM : 0) + rows * t.height_mm + (rows - 1) * gap <= A4.height_mm - 1; };

/* 하단바 — 종이에는 안 찍는다. 뽑아 나온 네임택에 어느 띠를 끼울지 인쇄 창 위에 보여 준다 */
function barSummary(template, cards){
  if(!(template.bar_types || []).length) return '';
  const color = (l) => (template.bar_types.find(b => b.label === l) || {}).color || '#868e96';
  if(cards.length === 1) return cards[0].bar
    ? ` · 하단바 <b class="nt-bar big"><i style="background:${color(cards[0].bar)}"></i>${escapeHtml(cards[0].bar)}</b>` : ' · 하단바 미정';
  const m = new Map(); cards.forEach(c => m.set(c.bar || '', (m.get(c.bar || '') || 0) + 1));
  return ' · ' + [...m.entries()].map(([l, n]) => l ? `<span class="nt-bar"><i style="background:${color(l)}"></i>${escapeHtml(l)} <b>${n}</b></span>` : `<span class="nt-bar nt-bar-none">미정 ${n}</span>`).join(' ');
}

function pagesHtml(template, cards, a4, n, gap, cut){
  const [, cols, rows] = PER_PAGE.find(p => p[0] === n);
  const pages = [];
  for(let i = 0; i < cards.length; i += n) pages.push(cards.slice(i, i + n));
  /* 칼선은 꽉 찬 쪽 기준으로 긋는다 — 마지막 쪽에 덜 찼어도 자를 자리는 같다 */
  const marks = cut ? cutMarks(template, cols, rows, gap) : '';
  return pages.map(group => `<div class="nt-page${a4 ? ' nt-a4' : ''}"${a4 ? '' : ` style="height:${template.height_mm}mm"`}><div class="nt-shift"><div class="nt-grid"
    style="grid-template-columns:repeat(${cols},${template.width_mm}mm);gap:${gap}mm${cut ? `;margin:${CUT_ROOM}mm 0` : ''}">${group.map(c =>
    `<div class="nt-frame">${ntCardHtml(template, c, { forPrint: true })}</div>`).join('')}${marks}</div></div></div>`).join('');
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
  const off = readOffset(template);
  const a4 = template.sheet !== 'fit';
  const per = readPer();
  /* 스타일은 글자로 넣는다 — 인쇄 창은 따로 받지 않아도 되게(끊겨도 기기에 둔 것으로, sw.js).
     화면이 실제로 읽은 주소(배포 때 붙는 ?v=…까지)로 받는다. 못 받으면 예전처럼 링크로 */
  const sheet = async (p) => {
    const href = document.querySelector(`link[rel="stylesheet"][href*="${p}"]`)?.href || css(p);
    try { const r = await fetch(href); if(r.ok) return `<style>${(await r.text()).replace(/<\/style/gi, '')}</style>`; } catch {}
    return `<link rel="stylesheet" href="${href}">`;
  };
  const styles = (await Promise.all(['styles/tokens.css', 'styles/nametag.css'].map(sheet))).join('');
  if(w.closed) return;
  w.document.open();
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>네임택 인쇄 · ${cards.length}장</title>
${styles}
<style id="pgsz"></style></head>
<body class="nt-print-page">
<div class="nt-print-bar no-print">
  <span><b>${cards.length}장</b><span id="pg"></span>${barSummary(template, cards)} · ${template.width_mm} × ${template.height_mm}mm<span id="psz"></span>${cards.length <= 3 ? ' · ' + escapeHtml(cards.map(c => c.name).join(', ')) : ''}</span>
  <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <label title="한 쪽에 몇 장씩 — 이 PC에 기억해요. 쪽 크기는 왼쪽에 보여요">한 쪽에 <select id="pp">${PER_PAGE.map(p =>
      `<option value="${p[0]}"${p[0] === per.n ? ' selected' : ''}>${p[3]}</option>`).join('')}</select></label>
    <label title="여러 장일 때 네임택 사이 간격">간격 <input id="gp" type="number" min="0" max="20" step="0.5" value="${per.gap}">mm</label>
    <label id="ctw" title="네임택 가장자리마다 바깥에 짧은 재단선 — A4에 찍어 자를 때. 켜면 판이 ${CUT_ROOM}mm 내려가요"><input id="ct" type="checkbox" style="width:auto"> 칼선</label>
    <span style="color:#888">인쇄 보정(이 PC)</span>
    <label>가로 <input id="dx" type="number" step="0.5" value="${off.x}">mm</label>
    <label title="프린터가 못 찍는 위 여백 — 판을 이만큼 내려 찍는다">위 여백 <input id="dt" type="number" min="0" max="15" step="0.5" value="${off.top}">mm</label>
    <label>세로 <input id="dy" type="number" step="0.5" value="${off.y}">mm</label>
    <label>배율 <input id="sc" type="number" step="1" value="${off.scale}">%</label>
    <button id="go" class="bp">인쇄</button><button id="cl">닫기</button>
  </span>
</div>
<div class="nt-sheet" id="sheet"></div>
<p class="no-print" style="font-size:12px;color:#888;text-align:center">인쇄 대화상자에서 용지 크기를 위에 적힌 대로(2장·4장은 A4), «여백 없음», 배율 100%로 찍어 주세요. 안 나온 장은 데스크의 최근 발급에서 «안 됨»으로 되돌려요.</p>
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
  const layout = (ev) => {
    const pp = d.getElementById('pp'), gp = d.getElementById('gp');
    per.gap = Math.min(20, Math.max(0, Number(gp.value) || 0));
    per.n = PER_PAGE.some(p => p[0] === +pp.value) ? +pp.value : 1;
    savePer(per);
    const o = normalizeOffset({ top: d.getElementById('dt').value, y: d.getElementById('dy').value });
    const onA4 = a4 || per.n > 1;   // 여러 장은 언제나 A4
    const paper = onA4 ? A4 : template;
    /* 칼선 — A4일 때만(판 크기 그대로면 자를 자리가 없다). 1장 · 여러 장을 따로 기억 */
    const ct = d.getElementById('ct');
    if(ev?.target === ct) per[per.n > 1 ? 'cutN' : 'cut1'] = ct.checked;
    const marks = onA4 && (per.n > 1 ? per.cutN : per.cut1);
    ct.checked = marks;
    d.getElementById('ctw').style.display = onA4 ? '' : 'none';
    savePer(per);
    d.getElementById('pgsz').textContent = `@page{size:${paper.width_mm}mm ${paper.height_mm}mm;margin:0}`;
    d.getElementById('sheet').innerHTML = pagesHtml(template, cards, onA4, per.n, per.gap, marks);
    const pages = Math.ceil(cards.length / per.n);
    d.getElementById('pg').textContent = per.n > 1 ? ` · A4 ${pages}쪽` : '';
    const cut = onA4 && !fitsA4(template, per.n, per.gap, o.top + o.y, marks);
    const psz = d.getElementById('psz');
    /* 판 크기 그대로 — 종이가 곧 판이라 아래로 내린 만큼(세로 + 위 여백, 배율로 커진 만큼) 아래가 잘린다 */
    const sc = normalizeOffset({ scale: d.getElementById('sc').value }).scale / 100;
    const fitCut = onA4 ? 0 : Math.round((o.y + o.top + template.height_mm * (sc - 1)) * 10) / 10;
    psz.innerHTML = onA4 ? ` · A4 맨 위 가운데${cut ? ' <b style="color:#e03131">— A4에 다 안 들어가 잘려요. 간격·위 여백을 줄이거나, 칼선을 끄거나, 장 수를 줄여 주세요</b>' : ''}`
      : ` · 쪽 ${template.width_mm} × ${template.height_mm}mm${fitCut > 0 ? ` <b style="color:#e03131">— 판을 ${fitCut}mm 내려 찍어 아래 ${fitCut}mm가 잘려요. 세로·위 여백을 0에 가깝게 줄여 주세요</b>` : ''}`;
    fitNametags(d.getElementById('sheet'));
  };
  layout();
  apply();
  ['dx', 'dy', 'sc', 'dt'].forEach(id => d.getElementById(id).addEventListener('change', () => { saveOffset(template, apply()); if(id !== 'dx') layout(); }));
  ['pp', 'gp', 'ct'].forEach(id => d.getElementById(id)?.addEventListener('change', layout));
  /* 인쇄 대화상자는 «인쇄»를 눌렀을 때만 연다 — 창이 열리자마자 띄우면 대화상자가 두 개(이 창 · 프린터)로 보여 헷갈렸다(2026-11-11).
     누르면 글꼴·그림(QR)이 다 그려질 때까지 기다렸다가 연다 */
  const go = d.getElementById('go');
  go.addEventListener('click', async () => {
    go.disabled = true; go.textContent = '준비 중…';
    try { await readyToPrint(d); w.focus(); w.print(); }
    finally { go.disabled = false; go.textContent = '인쇄'; }
  });
  d.getElementById('cl').addEventListener('click', () => w.close());

  await readyToPrint(d);
  w.focus();
  go.focus();   // Enter로 바로 찍게
}
