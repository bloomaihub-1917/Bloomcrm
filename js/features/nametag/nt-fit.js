/* ══════════════════════════════════════════════════════════════
   nt-fit.js — 네임택 글자 맞추기 + 인쇄 준비

   글자 폭은 그려 봐야 안다. .nt-el은 칸(max-width)이고 .nt-fit은 그 안의 글자다.
   - data-lines="1": 한 줄만 쓴다 → 넘치면 가로로 줄인다
   - data-lines="2" 이상: 줄을 바꿔 쓴다 → 허용한 줄 수를 넘기면 글자 크기를 낮춘다
   bizmatching nametag-package의 lib/nametag-fit.ts를 그대로 옮겼다. 고치기 전에 아래 주석 두 개를 읽을 것.

   인쇄 창은 window.open으로 연 다른 문서라, getComputedStyle·document.fonts를 그 문서의 것으로 쓴다.
═══════════════════════════════════════════════════════════════ */

const MIN_PT = 6;
/* 한 줄로 이만큼만 줄이면 들어가는 글자는 줄을 바꾸지 않는다 — 칸을 살짝 넘긴 한글 이름까지 두 줄이 되면 보기 나쁘다 */
const KEEP_ONE_LINE = 0.85;

function fitOneLine(el, span){
  const box = el.clientWidth;
  // offset*은 배치 좌표라 미리보기 확대(.nt-stage의 scale)에 흔들리지 않는다
  const natural = span.offsetWidth;
  if(natural <= box || natural <= 0) return;
  /* 주의 1: 글자가 칸보다 넓으면 브라우저는 text-align을 무시하고 칸 왼쪽부터 흘려보낸다.
     그 자리에서 가운데를 축으로 줄이면 글자 중심이 오른쪽으로 밀린다(이름이 길수록 더 밀린다).
     먼저 칸 왼쪽 끝으로 끌어다 놓고(translateX), 그 끝을 축으로 줄인다(transform-origin: left) → 항상 칸을 꽉 채운다 */
  span.style.transform = `translateX(${-span.offsetLeft}px) scale(${Math.max(0.3, box / natural)})`;
}

function overflows(span, lines){
  const win = span.ownerDocument.defaultView || window;
  const lh = parseFloat(win.getComputedStyle(span).lineHeight);
  return Number.isFinite(lh) && lh > 0 ? span.offsetHeight > lh * lines + 0.5 : false;
}

function fitWrapped(el, span, lines, base){
  el.style.whiteSpace = 'nowrap';
  const box = el.clientWidth, oneLine = span.offsetWidth;
  if(oneLine <= box || (oneLine > 0 && box / oneLine >= KEEP_ONE_LINE)){ fitOneLine(el, span); return; }
  el.style.whiteSpace = '';
  if(!overflows(span, lines)) return;
  // 들어가는 가장 큰 크기를 반씩 좁혀 찾는다
  let lo = MIN_PT, hi = base;
  for(let i = 0; i < 8 && hi - lo > 0.25; i++){
    const mid = (lo + hi) / 2;
    span.style.fontSize = `${mid}pt`;
    if(overflows(span, lines)) hi = mid; else lo = mid;
  }
  span.style.fontSize = `${lo}pt`;
  // 끊을 자리가 없는 한 낱말은 줄을 바꿔도 안 줄어든다 → 마지막으로 가로로 한 번 더
  fitOneLine(el, span);
}

export function fitNametags(root = document){
  for(const el of Array.from(root.querySelectorAll('.nt-el'))){
    const span = el.firstElementChild;
    if(!span) continue;
    const base = Number(el.dataset.size);
    const lines = Math.max(1, Math.round(Number(el.dataset.lines) || 1));
    span.style.transform = '';
    el.style.whiteSpace = '';
    if(base > 0) span.style.fontSize = `${base}pt`;
    if(lines > 1 && base > 0) fitWrapped(el, span, lines, base);
    else fitOneLine(el, span);
  }
}

/* 글꼴·이미지·스타일시트가 다 와야 줄이 밀리지 않는다. 늦게 와도 인쇄가 막히지 않도록 시간 제한을 둔다 */
export async function readyToPrint(doc, timeoutMs = 4000){
  const sheets = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).map(l =>
    l.sheet ? Promise.resolve() : new Promise(done => { l.addEventListener('load', done, { once: true }); l.addEventListener('error', done, { once: true }); }));
  const images = Array.from(doc.querySelectorAll('img')).map(img =>
    img.complete ? Promise.resolve() : new Promise(done => { img.addEventListener('load', done, { once: true }); img.addEventListener('error', done, { once: true }); }));
  await Promise.race([
    Promise.all([...sheets, ...images]).then(() => doc.fonts ? doc.fonts.ready : null),
    new Promise(done => setTimeout(done, timeoutMs)),
  ]);
  fitNametags(doc);
}
