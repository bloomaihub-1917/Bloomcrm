/* ══════════════════════════════════════════════════════════════
   nt-fit.js — 네임택 글자 맞추기 + 인쇄 준비

   글자 폭은 그려 봐야 안다. .nt-el은 칸(max-width)이고 .nt-fit은 그 안의 글자다.
   - data-lines="1": 한 줄만 쓴다 → 넘치면 가로로 줄인다
   - data-lines="2" 이상: 줄을 바꿔 쓴다 — 띄어쓰기에서만 나눈다(2026-11-11)
     · 한 줄로 조금만(KEEP_ONE_LINE) 줄이면 들어가면 한 줄
     · 아니면 띄어쓰기 자리 중 줄 길이가 가장 고르게 되는 곳에서 나눈다(긴 줄이 가장 짧아지게)
     · 그래도 긴 줄이 칸보다 넓으면 글자를 조금 줄이고 나머지는 가로로 줄인다(SQUEEZE) — 글자 크기를
       통째로 낮추던 예전 방식은 두 줄이 되면 글자가 너무 작아졌다
     · 띄어쓰기가 없는 한 낱말은 나누지 않고 한 줄로 가로로 줄인다
   bizmatching nametag-package의 lib/nametag-fit.ts를 옮겨 왔다. 고치기 전에 아래 주석을 읽을 것.

   인쇄 창은 window.open으로 연 다른 문서라, getComputedStyle·document.fonts를 그 문서의 것으로 쓴다.
═══════════════════════════════════════════════════════════════ */

const MIN_PT = 6;
/* 한 줄로 이만큼만 줄이면 들어가는 글자는 줄을 바꾸지 않는다 — 칸을 살짝 넘긴 한글 이름까지 두 줄이 되면 보기 나쁘다 */
const KEEP_ONE_LINE = 0.85;
/* 나눈 줄이 칸보다 넓을 때 가로로만 줄여도 되는 정도 — 이보다 더 줄여야 하면 글자 크기를 낮춘다 */
const SQUEEZE = 0.85;

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

/* 낱말들을 n줄로 — 띄어쓰기 자리만 쓴다. 가장 긴 줄이 가장 짧아지는 나눔을 고른다(낱말 수가 적어 다 재 본다) */
function bestSplit(span, words, n){
  const w = (s) => { span.textContent = s; return span.offsetWidth; };
  const memo = new Map();
  // from번째 낱말부터 k줄로 나눌 때 { max: 가장 긴 줄 폭, lines }
  const go = (from, k) => {
    const key = from + ':' + k;
    if(memo.has(key)) return memo.get(key);
    let best = null;
    if(k === 1) best = { max: w(words.slice(from).join(' ')), lines: [words.slice(from).join(' ')] };
    else for(let i = from + 1; i <= words.length - (k - 1); i++){
      const head = words.slice(from, i).join(' '), hw = w(head), rest = go(i, k - 1);
      const max = Math.max(hw, rest.max);
      if(!best || max < best.max) best = { max, lines: [head, ...rest.lines] };
    }
    memo.set(key, best);
    return best;
  };
  let best = null;
  for(let k = 2; k <= Math.min(n, words.length); k++){
    const r = go(0, k);
    if(!best || r.max < best.max - 0.5) best = r;   // 줄을 더 늘려도 별로 안 짧아지면 적은 줄로
  }
  return best;
}

function fitWrapped(el, span, lines, base){
  const text = span.dataset.text;
  span.textContent = text;
  el.style.whiteSpace = 'nowrap';
  const box = el.clientWidth, oneLine = span.offsetWidth;
  const words = text.split(/\s+/).filter(Boolean);
  /* 한 줄로 들어가거나 조금만 줄이면 되면, 또는 나눌 띄어쓰기가 없으면 한 줄 */
  if(oneLine <= box || (oneLine > 0 && box / oneLine >= KEEP_ONE_LINE) || words.length < 2){ fitOneLine(el, span); return; }
  const best = bestSplit(span, words, lines);
  /* 줄은 우리가 나눈다 — 브라우저가 낱말 가운데를 끊지 않게 pre로 둔다 */
  el.style.whiteSpace = 'pre';
  span.textContent = best.lines.join('\n');
  const widest = span.offsetWidth;
  if(widest > box){
    /* 가로로 SQUEEZE까지는 줄여 쓰고, 그래도 넘치는 만큼만 글자를 낮춘다 */
    const pt = Math.max(MIN_PT, Math.min(base, base * box / widest / SQUEEZE));
    if(pt < base) span.style.fontSize = `${pt}pt`;
    fitOneLine(el, span);
  }
}

/* 손으로 바꾼 줄(데스크에서 Enter, 2026-11-13) — 그 줄 그대로 쓰고, 가장 긴 줄이 칸보다 넓으면 fitWrapped처럼 줄인다 */
function fitBroken(el, span, base){
  el.style.whiteSpace = 'pre';
  span.textContent = span.dataset.text;
  const box = el.clientWidth, widest = span.offsetWidth;
  if(widest > box && base > 0){
    const pt = Math.max(MIN_PT, Math.min(base, base * box / widest / SQUEEZE));
    if(pt < base) span.style.fontSize = `${pt}pt`;
  }
  fitOneLine(el, span);
}

export function fitNametags(root = document){
  for(const el of Array.from(root.querySelectorAll('.nt-el'))){
    const span = el.firstElementChild;
    if(!span) continue;
    /* 처음 글자를 둔다 — 다시 맞출 때(창 크기·장 수를 바꿀 때) 나눈 줄을 되돌리려고 */
    if(span.dataset.text == null) span.dataset.text = span.textContent;
    const base = Number(el.dataset.size);
    const lines = Math.max(1, Math.round(Number(el.dataset.lines) || 1));
    span.style.transform = '';
    el.style.whiteSpace = '';
    if(base > 0) span.style.fontSize = `${base}pt`;
    if(span.dataset.text.includes('\n')) fitBroken(el, span, base);
    else if(lines > 1 && base > 0) fitWrapped(el, span, lines, base);
    else { span.textContent = span.dataset.text; fitOneLine(el, span); }
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
