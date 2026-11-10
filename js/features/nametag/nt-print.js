/* ══════════════════════════════════════════════════════════════
   nt-print.js — 네임택 인쇄 창

   window.open으로 빈 창을 열고 이 화면이 직접 그려 넣는다. 따로 html 파일을 두면 그 창이 로그인·데이터를
   다시 받아야 하는데, 찍을 값은 이미 발급 기록으로 손에 있다.
   - 팝업 차단을 피하려면 단추를 누른 그 순간 창을 열어야 한다 → openPrintWindow()로 먼저 열고,
     발급 기록이 오면 fillPrintWindow()로 그린다
   - @page 크기를 판 크기로 만들어 붙인다. 한 장 = 한 쪽
     출력 종이가 A4(sheet 'a4')면 A4 세로 한 쪽의 맨 위 가운데에 한 장씩 — 전용 용지 없이 A4에 뽑아 자를 때
   - 인쇄 보정(가로·세로 mm, 배율 %)은 프린터마다 종이 먹는 자리가 달라 이 브라우저에 따로 둔다
     (localStorage nametag.print-offset.v1). 없으면 판의 기본값
═══════════════════════════════════════════════════════════════ */
import { ntCardHtml } from './nt-card.js';
import { readyToPrint } from './nt-fit.js';
import { normalizeOffset, A4 } from '../../domain/nametag-layout.js';
import { escapeHtml } from '../../utils.js';

const OFFSET_KEY = 'nametag.print-offset.v1';
const readOffset = (fallback) => {
  try { const v = JSON.parse(localStorage.getItem(OFFSET_KEY) || 'null'); return v ? normalizeOffset(v) : normalizeOffset(fallback); }
  catch { return normalizeOffset(fallback); }
};
const saveOffset = (o) => { try { localStorage.setItem(OFFSET_KEY, JSON.stringify(o)); } catch {} };

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
  const a4 = template.sheet === 'a4';
  const paper = a4 ? A4 : template;
  const pages = cards.map(c => `<div class="nt-page${a4 ? ' nt-a4' : ''}"><div class="nt-frame"><div class="nt-shift">${ntCardHtml(template, c, { forPrint: true })}</div></div></div>`).join('');
  w.document.open();
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>네임택 인쇄 · ${cards.length}장</title>
<link rel="stylesheet" href="${css('styles/tokens.css')}"><link rel="stylesheet" href="${css('styles/nametag.css')}">
<style>@page{size:${paper.width_mm}mm ${paper.height_mm}mm;margin:0}</style></head>
<body class="nt-print-page">
<div class="nt-print-bar no-print">
  <span><b>${cards.length}장</b> · ${template.width_mm} × ${template.height_mm}mm${a4 ? ' · A4 세로 맨 위' : ''}${cards.length <= 3 ? ' · ' + escapeHtml(cards.map(c => c.name).join(', ')) : ''}</span>
  <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <span style="color:#888">인쇄 보정(이 PC)</span>
    <label>가로 <input id="dx" type="number" step="0.5" value="${off.x}">mm</label>
    <label>세로 <input id="dy" type="number" step="0.5" value="${off.y}">mm</label>
    <label>배율 <input id="sc" type="number" step="1" value="${off.scale}">%</label>
    <button id="go" class="bp">인쇄</button><button id="cl">닫기</button>
  </span>
</div>
<div class="nt-sheet">${pages}</div>
<p class="no-print" style="font-size:12px;color:#888;text-align:center">인쇄 대화상자에서 «여백 없음», 배율 100%로 찍어 주세요. 안 나온 장은 데스크의 최근 발급에서 «안 됨»으로 되돌려요.</p>
</body></html>`);
  w.document.close();

  const d = w.document;
  const apply = () => {
    const o = normalizeOffset({ x: d.getElementById('dx').value, y: d.getElementById('dy').value, scale: d.getElementById('sc').value });
    d.body.style.setProperty('--nt-dx', `${o.x}mm`);
    d.body.style.setProperty('--nt-dy', `${o.y}mm`);
    d.body.style.setProperty('--nt-scale', String(o.scale / 100));
    return o;
  };
  apply();
  ['dx', 'dy', 'sc'].forEach(id => d.getElementById(id).addEventListener('change', () => saveOffset(apply())));
  d.getElementById('go').addEventListener('click', () => w.print());
  d.getElementById('cl').addEventListener('click', () => w.close());

  await readyToPrint(d);
  w.focus();
  w.print();
}
