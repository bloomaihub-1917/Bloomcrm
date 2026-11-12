/* ══════════════════════════════════════════
   긴 목록은 나눠 그린다 (2026-11-12)

   Master DB 1,558명·기업DB 1,763곳을 필터를 누르거나 글자를 칠 때마다 한 번에 다 그려
   화면이 버벅였다. 처음 STEP줄만 그리고, 맨 아래 줄이 보이면 다음 STEP줄을 붙인다.
   - 건수·«전체 선택»·Shift 범위 선택은 그리기와 상관없이 전체 목록 기준이다(부른 쪽이 따로 센다).
   - 같은 목록을 다시 그릴 때(체크 하나 눌러 다시 그림 등)는 이미 펼친 만큼 그대로 그린다 —
     500번째 줄을 보다가 체크했는데 200줄로 줄어 위로 튀면 안 된다. 목록이 바뀌면(거르기·검색·정렬) 처음부터.
   쓰는 법: renderChunked(container, items, item => html, { key, sentinel })
     key      — 목록이 같은지 가늠하는 값(보통 id 차례). 바뀌면 처음 STEP줄로 돌아간다.
     sentinel — 맨 아래 «더 불러오는 중» 자리 html. 표면 <tr>, 카드면 <div>.
══════════════════════════════════════════ */
export const CHUNK_STEP = 200;

/* 화면이 표를 통째로 다시 만들어도(innerHTML) 펼친 만큼을 기억하도록 칸 id로 적는다 */
const state = new Map();   // container.id → { key, shown, io }

export function renderChunked(container, items, toHtml, { key = '', sentinel, empty = '', step = CHUNK_STEP } = {}){
  if(!container) return;
  const sk = container.id || 'anon';
  const prev = state.get(sk);
  prev?.io?.disconnect();
  const shown = Math.min(items.length, prev && prev.key === key ? Math.max(prev.shown, step) : step);
  const st = { key, shown, io: null };
  state.set(sk, st);
  if(!items.length){ container.innerHTML = empty; return; }
  container.innerHTML = items.slice(0, shown).map(toHtml).join('') + (shown < items.length ? sentinel(items.length - shown) : '');
  watch(container, items, toHtml, st, step, sentinel);
}

function watch(container, items, toHtml, st, step, sentinel){
  const tail = container.querySelector('[data-chunk-more]');
  if(!tail) return;
  const more = () => {
    st.io?.disconnect();
    if(!tail.isConnected || state.get(container.id || 'anon') !== st) return;   // 그 사이 목록이 다시 그려졌다
    const from = st.shown, next = Math.min(items.length, from + step);
    tail.insertAdjacentHTML('beforebegin', items.slice(from, next).map((x, j) => toHtml(x, from + j)).join(''));
    st.shown = next;
    if(next < items.length){
      tail.outerHTML = sentinel(items.length - next);
      watch(container, items, toHtml, st, step, sentinel);
    } else tail.remove();
  };
  // 맨 아래 줄을 눌러도 더 나온다 — 스크롤 감지가 안 되는 환경(오래된 브라우저 등) 대비
  tail.style.cursor = 'pointer';
  tail.addEventListener('click', (e) => { e.stopPropagation(); more(); });
  if(typeof IntersectionObserver === 'undefined') return;
  st.io = new IntersectionObserver((ents) => { if(ents.some(e => e.isIntersecting)) more(); }, { rootMargin: '600px 0px' });
  st.io.observe(tail);
}

/* 목록이 같은지 가늠하는 값 — 건수와 앞·뒤 몇 개의 id */
export const listKey = (ids) => `${ids.length}:${ids.slice(0, 5).join(',')}:${ids.slice(-5).join(',')}`;

/* 표 안 «더 불러오는 중» 줄 */
export const moreRow = (cols) => (left) =>
  `<tr data-chunk-more><td colspan="${cols}" style="padding:14px;text-align:center;color:var(--i4);font-size:var(--fs-12)">아래로 내리면 ${left}개 더 보여요 · 눌러도 돼요</td></tr>`;
export const moreDiv = (left) =>
  `<div data-chunk-more style="padding:14px;text-align:center;color:var(--i4);font-size:var(--fs-12)">아래로 내리면 ${left}개 더 보여요 · 눌러도 돼요</div>`;

/* 검색칸 — 글자마다 목록 전체를 다시 그리면 타자가 밀린다. 멈추고 ms 뒤에 한 번 그린다 */
export function debounce(fn, ms = 200){
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
