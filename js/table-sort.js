/* ══════════════════════════════════════════════════════════════
   table-sort.js — 표 머리를 누르면 그 열로 정렬한다

   표가 여러 화면에 흩어져 있고(체크리스트·부스·비품·그래픽·프로그램북·금액·
   마스터DB·기업DB) 저마다 다른 함수가 그린다. 표마다 정렬을 넣으면 같은 코드를
   여덟 번 쓰게 되고, 새 표를 만들 때마다 또 빠뜨린다.

   그래서 그리는 쪽은 건드리지 않고 화면 전체에 한 번만 건다. 문서에 클릭을
   위임해 두면 표를 다시 그려도 계속 걸린다 — 다시 그릴 때마다 핸들러를 새로
   붙일 필요가 없다.

   정렬은 화면에 보이는 글자로 한다. 원본 데이터를 모르기 때문인데, 오히려 이
   편이 낫다 — 사람이 보고 있는 순서대로 정렬된다.

   숫자처럼 보이면 숫자로 센다. "3,000,000원"과 "$2,388"은 값으로, "10-11"은
   앞 번호로 읽는다. 부스 번호가 글자 순으로 정렬되면 10이 9보다 앞에 온다.

   빈 칸은 방향과 상관없이 늘 아래로 보낸다. 값이 없는 줄이 위에 몰리면
   정렬한 이유가 사라진다.
══════════════════════════════════════════════════════════════ */

/* 딸린 줄 — 품목 줄 아래에 colspan으로 붙는 '신청 기업' 목록 같은 것.
   앞 줄에 매달려 있어서, 따로 떼면 엉뚱한 품목 밑으로 간다. 그리는 쪽이
   data-detail로 표시해 두면 여기서 대표 줄과 함께 옮긴다. */
const isDetail = (r) => r.hasAttribute('data-detail');

/* 표를 줄이 아니라 «묶음»으로 본다 — 대표 줄 하나에 딸린 줄 여럿.
   딸린 줄이 없는 보통 표는 묶음마다 대표 줄 하나뿐이라 결과가 같다. */
function unitsOf(body){
  const units = [];
  [...body.rows].forEach((r) => {
    if(isDetail(r) && units.length) units[units.length - 1].kids.push(r);
    else units.push({ head: r, kids: [] });
  });
  return units;
}

/* 정렬하면 뜻이 깨지는 표 — 표시가 없는데 colspan으로 여러 칸을 먹는 줄이
   섞여 있으면 그 줄이 무엇에 딸린 것인지 알 수 없어 손대지 않는다. */
function sortable(table){
  if(!table || !table.tBodies.length) return false;
  const units = unitsOf(table.tBodies[0]);
  if(units.length < 2) return false;
  return !units.some(u => [...u.head.cells].some(c => c.colSpan > 1));
}

/* 보이는 글자에서 정렬용 값을 뽑는다 */
function keyOf(cell){
  const t = (cell?.innerText || '').trim();
  if(!t || t === '-' || t === '—' || t === '·') return { empty: true };

  // 한 칸에 두 줄이 들어가는 경우가 있다(원화·달러를 함께 적은 금액). 첫 줄을 대표로 삼는다.
  const first = t.split('\n')[0].trim();

  // 부스 번호 10-11 · 44-46 → 앞 번호로
  const range = first.match(/^(\d+)\s*-\s*\d+$/);
  if(range) return { n: Number(range[1]) };

  // 날짜는 글자 그대로가 곧 순서다 (YYYY-MM-DD)
  if(/^\d{4}-\d{2}-\d{2}$/.test(first)) return { s: first };

  /* 통화가 앞에 붙은 금액 — "KRW 3,000,000", "USD 88".
     글자로 비교하면 470,000이 3,000,000보다 크게 잡힌다(쉼표에서 숫자가 끊긴다).
     통화가 다르면 더해도 뜻이 없으므로 통화로 먼저 묶고 값으로 센다. */
  const cm = first.match(/^([A-Z]{3})\s*([\d,.]+)$/);
  if(cm) return { cur: cm[1], n: Number(cm[2].replace(/,/g, '')) };

  // 숫자가 섞인 값 — 3,000,000원 · $2,388 · 12곳 · 45%
  const num = first.replace(/[^\d.-]/g, '');
  if(num && /\d/.test(num) && /^[^A-Za-z가-힣]*[\d,.\s원$₩%곳개건-]+[^A-Za-z가-힣]*$/.test(first)){
    const v = Number(num.replace(/(?!^)-/g, ''));
    if(!isNaN(v)) return { n: v };
  }
  return { s: t.toLowerCase() };
}

function sortTable(table, idx, dir){
  const body = table.tBodies[0];
  const rows = unitsOf(body);

  // 처음 정렬할 때 원래 순서를 적어 둔다 — 되돌릴 수 있어야 한다
  rows.forEach((u, i) => { if(u.head.dataset.origIdx === undefined) u.head.dataset.origIdx = i; });

  if(dir === 0){
    rows.sort((a, b) => Number(a.head.dataset.origIdx) - Number(b.head.dataset.origIdx));
  } else {
    /* 키를 미리 한 번만 뽑는다. 비교 함수 안에서 innerText를 읽으면 51줄짜리
       표에서 수백 번 레이아웃을 다시 재게 되고, 이제 다시 그릴 때마다
       정렬을 되걸기 때문에 그 값이 그대로 체감된다. */
    const keys = new Map(rows.map(u => [u, keyOf(u.head.cells[idx])]));
    rows.sort((a, b) => {
      const x = keys.get(a), y = keys.get(b);
      if(x.empty && y.empty) return 0;
      if(x.empty) return 1;            // 빈 칸은 방향과 무관하게 아래로
      if(y.empty) return -1;
      let c;
      // 통화가 다르면 통화로 먼저 가른다 — 원화와 달러를 한 줄에 세워 비교할 수 없다
      if(x.cur && y.cur && x.cur !== y.cur) c = x.cur.localeCompare(y.cur);
      else if('n' in x && 'n' in y) c = x.n - y.n;
      else c = String(x.s ?? x.n).localeCompare(String(y.s ?? y.n), 'ko', { numeric: true });
      return dir * c;
    });
  }
  // 대표 줄 바로 뒤에 딸린 줄을 다시 붙인다 — 떼어 두면 펼친 목록이 남의 밑으로 간다
  rows.forEach((u) => { body.appendChild(u.head); u.kids.forEach(k => body.appendChild(k)); });
}

function mark(head, th, dir){
  [...head.querySelectorAll('th')].forEach(h => {
    const t = h.querySelector('.ts-mark');
    if(t) t.remove();
    h.style.cursor = 'pointer';
    if(!h.title) h.title = '눌러서 이 열로 정렬';
  });
  if(dir !== 0){
    const s = document.createElement('span');
    s.className = 'ts-mark';
    s.textContent = dir > 0 ? ' ▲' : ' ▼';
    s.style.cssText = 'font-size:9px;color:var(--a)';
    th.appendChild(s);
  }
}

/* ── 다시 그려도 정렬을 유지한다 ──
   정렬 상태를 표 자신의 data 속성에만 담고 있었다. 그런데 화면을 다시 그리면
   innerHTML이 통째로 바뀌면서 그 표가 사라진다 — 기업 하나를 고치면 뒤에 있던
   목록이 원래 순서로 돌아가 버렸다.

   표에는 id가 없고 그리는 쪽을 건드리지 않는 게 이 모듈의 전제라, 표가 놓인
   자리(가장 가까운 id)와 머리글 글자를 이어 붙여 이름을 만든다. 화면마다
   머리글이 다르므로 같은 자리에 있는 다른 표(부스 현황 ↔ 기업리스트)도 갈린다. */
const sortState = new Map();
/* 머리글을 이어 붙일 때 쓰는 구분자 — 머리글 글자에 나올 일이 없어야 한다 */
const SEP = '|~|';

function tableKey(table){
  const head = table.tHead?.rows?.[0];
  if(!head) return '';
  const sig = [...head.children].map(th => {
    /* 정렬 화살표(▲▼)는 우리가 넣은 것이라 이름에서 빼야 한다 —
       넣는 순간 이름이 바뀌어 다음에 못 찾는다. */
    const c = th.cloneNode(true);
    c.querySelectorAll('.ts-mark').forEach(n => n.remove());
    return (c.textContent || '').replace(/\s+/g, ' ').trim();
  }).join(SEP);
  return (table.closest('[id]')?.id || '') + '|' + sig;
}

/* 새로 그려진 표에 기억해 둔 정렬을 되건다 */
function reapply(table){
  const st = sortState.get(tableKey(table));
  if(!st || !sortable(table)) return;
  const head = table.tHead?.rows?.[0];
  const th = head?.children[st.idx];
  if(!th) return;
  table.dataset.sortCol = String(st.idx);
  table.dataset.sortDir = String(st.dir);
  sortTable(table, st.idx, st.dir);
  mark(head, th, st.dir);
}

export function initTableSort(){
  /* 화면을 다시 그리면 표가 새로 생긴다. 그때 정렬을 되걸어 준다 —
      그리는 쪽 여덟 곳을 고치지 않고 여기 한 곳에서 받는다. */
  new MutationObserver(muts => {
    const seen = new Set();
    for(const m of muts) for(const n of m.addedNodes){
      if(n.nodeType !== 1) continue;
      if(n.tagName === 'TABLE') seen.add(n);
      n.querySelectorAll?.('table').forEach(t => seen.add(t));
    }
    seen.forEach(reapply);
  }).observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', (e) => {
    const th = e.target.closest?.('thead th');
    if(!th) return;
    const table = th.closest('table');
    if(!sortable(table)) return;
    // 헤더 안의 버튼·입력칸을 누른 것이면 정렬이 아니다
    if(e.target.closest('button, input, select, a')) return;

    const head = th.parentElement;
    const idx = [...head.children].indexOf(th);
    if(idx < 0) return;

    // 같은 열을 다시 누르면 오름 → 내림 → 원래 순서로 돈다
    const was = table.dataset.sortCol === String(idx) ? Number(table.dataset.sortDir || 0) : 0;
    const dir = was === 1 ? -1 : was === -1 ? 0 : 1;
    table.dataset.sortCol = String(idx);
    table.dataset.sortDir = String(dir);

    /* 원래 순서로 돌아가면 기억을 지운다 — 다시 그렸을 때 되걸 게 없다 */
    const key = tableKey(table);
    if(dir === 0) sortState.delete(key);
    else sortState.set(key, { idx, dir });

    sortTable(table, idx, dir);
    mark(head, th, dir);
  });
}
