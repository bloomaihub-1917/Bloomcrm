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

/* 이 표는 정렬하면 안 된다 — 줄이 짝을 이루고 있어 흩으면 뜻이 깨진다.
   (비품 현황은 품목 줄 아래에 '신청 기업' 줄이 colspan으로 붙어 있다) */
function sortable(table){
  if(!table || !table.tBodies.length) return false;
  const rows = [...table.tBodies[0].rows];
  if(rows.length < 2) return false;
  return !rows.some(r => [...r.cells].some(c => c.colSpan > 1));
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
  const rows = [...body.rows];

  // 처음 정렬할 때 원래 순서를 적어 둔다 — 되돌릴 수 있어야 한다
  rows.forEach((r, i) => { if(r.dataset.origIdx === undefined) r.dataset.origIdx = i; });

  if(dir === 0){
    rows.sort((a, b) => Number(a.dataset.origIdx) - Number(b.dataset.origIdx));
  } else {
    rows.sort((a, b) => {
      const x = keyOf(a.cells[idx]), y = keyOf(b.cells[idx]);
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
  rows.forEach(r => body.appendChild(r));
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

export function initTableSort(){
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

    sortTable(table, idx, dir);
    mark(head, th, dir);
  });
}
