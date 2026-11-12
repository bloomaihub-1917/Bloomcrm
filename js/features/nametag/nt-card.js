/* ══════════════════════════════════════════════════════════════
   nt-card.js — 네임택 한 장 그리기

   데스크 미리보기와 인쇄 창이 같은 함수를 쓴다 → 화면에서 본 대로 나온다.
   - 좌표는 mm, 글자 크기는 pt. 브라우저가 mm·pt를 그대로 인쇄 단위로 옮긴다
   - 글자가 칸을 넘치면 nt-fit.js가 글꼴이 준비된 뒤 맞춘다. data-size는 되돌릴 원래 글자 크기다
   bizmatching nametag-package의 lib/nametag-render.tsx를 문자열 템플릿으로 옮겼다.
═══════════════════════════════════════════════════════════════ */
import { escapeHtml } from '../../utils.js';
import { qrText, TEXT_KEYS } from '../../domain/nametag-layout.js';

const ANCHOR = { left: 'translateY(-50%)', center: 'translate(-50%, -50%)', right: 'translate(-100%, -50%)' };

/* d: 이 사람만 옮긴 거리 { dx, dy }(mm) — 데스크 «글자 위치 · 이번만»(nt-desk.js). 판은 그대로다 */
function textEl(el, value, d){
  if(!el.show || !value) return '';
  const x = el.x + (+d?.dx || 0), y = el.y + (+d?.dy || 0);
  /* 줄여 맞출 때의 축은 왼쪽 끝 — 넘치는 글자는 정렬과 무관하게 칸 왼쪽부터 흘러나간다(nt-fit.js 주의 1) */
  return `<div class="nt-el" data-lines="${el.lines}" data-size="${el.size}"
    style="left:${x}mm;top:${y}mm;max-width:${el.maxWidth}mm;transform:${ANCHOR[el.align]};text-align:${el.align};line-height:${el.lh || 1.15}"><span
    class="nt-fit" style="font-size:${el.size}pt;font-weight:${el.weight};transform-origin:left center">${escapeHtml(value)}</span></div>`;
}

/* 입장 QR — 담을 사람이 없으면(편집기 견본·시험 인쇄) 화면에만 자리를 보여 주고 종이에는 안 찍는다.
   그림은 qrcode-generator(index.html에서 불러옴)로 SVG를 만들어 바로 넣는다 → 인쇄 창이 따로 불러올 것이 없다 */
function qrEl(l, card, forPrint){
  const q = l.qr;
  if(!q || !q.show) return '';
  const box = `left:${q.x - q.size / 2}mm;top:${q.y - q.size / 2}mm;width:${q.size}mm;height:${q.size}mm`;
  const txt = qrText(card);
  if(!txt || !window.qrcode) return forPrint ? '' : `<div class="nt-qr nt-qr-ghost" style="${box}">입장 QR</div>`;
  const qr = window.qrcode(0, 'M');
  qr.addData(txt); qr.make();
  return `<div class="nt-qr" style="${box}">${qr.createSvgTag({ cellSize: 1, margin: 0, scalable: true })}</div>`;
}

/* card: { name, company, job_title, badge, person_key } — 이미 국·영문을 고른 값. person_key가 있으면 입장 QR에 담는다
   배경은 가늠자다. 이미 인쇄된 네임택 용지에 얹어 찍는 게 기본이라 forPrint에서는 background_print가 켜져 있을 때만 그린다 */
export function ntCardHtml(template, card, { forPrint = false } = {}){
  const l = template.layout;
  const bg = template.background_data && (!forPrint || template.background_print);
  return `<div class="nt-card" style="width:${template.width_mm}mm;height:${template.height_mm}mm">`
    + (bg ? `<img class="nt-bg" src="${template.background_data}" alt="">` : '')
    + TEXT_KEYS.map(k => textEl(l[k], card[k] || '', card._pos?.[k])).join('')   // 병기 칸(*_alt)도 같은 규칙
    + qrEl(l, card, forPrint)
    + `</div>`;
}
