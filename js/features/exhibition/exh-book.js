/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-book.js — 도록 순번·기본 제공·그래픽 발주
   (modules/exh-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { trackAction } from '../../core/audit-log.js';
import { API_BASE_URL, EQUIP_CATALOG, EXH_ITEMS, catalogFor, codeList, exhEvent, findCatalogByName, getExhibitorById, nextItemSort } from '../../state.js';
import { escAttr, escapeHtml, isMobile, td } from '../../utils.js';
import { TCELL, TPILL, activeExhibitors, fmtMoney, num, reloadExhibitors } from './exh-calc.js';
import { exhUi } from './exh-ui.js';
import { BASE_KINDS, BOOK_FIELDS, applyCell, baseDoneAt, baseDoneCheck, baseItems, baseKind, baseRecvAt, baseRecvItems, baseState, bookLimit, bookMissing, bookName, boothSortKey, coCell, designPill, dueInfo, emptyView, exhLockNotice, exhLocked, exhNames, fasciaName, guardWrite, hasDesignOrder, introLen, introOver, nameCell, patchExh, refreshExhViews, renderExh, saveExhItem, saveExhibitor, setBaseDoneAt, setBaseFil, setBaseRecvAt, setExhField, viewShell, visibleList } from '../../modules/exh-tab.js';

/* ══════════════════════════════════════════
   도록 순번 — 번호 하나에 자리 하나

   순번을 그냥 적게 두면 두 기업이 같은 번호를 갖거나(지금 1번이 둘이다),
   중간이 비거나(18번이 없다), 인쇄소에 넘길 때 순서가 안 정해진다. 순번은
   값이 아니라 줄 세우기라, 하나를 옮기면 나머지가 밀려야 한다.

   그래서 목록 전체를 1..N으로 다시 매긴다. 지금 보이는 줄만이 아니라 이 행사
   참가기업 전부가 대상이다 — 검색으로 걸러 둔 채 3번으로 옮겼는데 화면 밖
   3번이 그대로면, 인쇄 직전에야 겹친 걸 알게 된다.
══════════════════════════════════════════ */

/* 지금 저장된 값이 만드는 줄 세우기. 번호가 없는 곳은 뒤로 보내되 부스 순으로
   둔다 — 새로 들어온 곳이 목록 맨 앞에 끼어들면 매번 다시 세워야 한다. */
export function bookSeq(evKey){
  return [...activeExhibitors(evKey)].sort((a, b) => {
    const ao = Number(String(a.book_order || '').replace(/[^0-9]/g, '')) || 0;
    const bo = Number(String(b.book_order || '').replace(/[^0-9]/g, '')) || 0;
    if(ao !== bo) return (ao || 1e9) - (bo || 1e9);
    return boothSortKey(a) - boothSortKey(b);
  });
}

/* 한 줄을 원하는 자리로 옮기고 전부 다시 매긴다.
   실제로 번호가 달라지는 줄만 저장한다 — 56줄을 통째로 보내면 바뀌지도 않은
   줄에 수정 기록이 남아 로그에서 진짜 변경을 찾을 수 없다. */
export async function moveBookOrder(id, toPos){
  const x = getExhibitorById(id);
  if(!x) return;
  /* 옮기기 전에 서버 값을 다시 읽는다. 순번은 한 줄만 바꾸는 게 아니라 목록
     전체를 다시 매기는 일이라, 화면에 뜬 값이 낡아 있으면 그 낡은 줄 세우기가
     서버에 통째로 덮어써진다. 실제로 그렇게 52곳이 한 번에 뒤집힌 적이 있다.
     (다른 칸은 자기 칸만 보내니 이 문제가 없다 — 여기서만 다시 읽는다.) */
  await reloadExhibitors();
  const seq = bookSeq(x.event_id);
  const from = seq.findIndex(o => o.id === id);
  if(from < 0) return;

  let to = Math.round(Number(String(toPos).replace(/[^0-9]/g, '')));
  if(!to || isNaN(to)) { renderExh(); return; }          // 숫자가 아니면 되돌린다
  to = Math.min(Math.max(1, to), seq.length) - 1;
  if(to === from) { renderExh(); return; }

  seq.splice(to, 0, ...seq.splice(from, 1));
  const changes = seq
    .map((o, i) => ({ o, no: String(i + 1) }))
    .filter(c => String(c.o.book_order || '') !== c.no);
  if(!changes.length) { renderExh(); return; }

  await saveBookOrders(changes, `${exhNames(x).ko} → ${to + 1}번`);
}

/* 한꺼번에 저장한다. patchExh를 줄마다 부르면 저장할 때마다 화면을 다시 그리고
   수정 기록이 마흔 줄 남는다. 여기서는 화면을 한 번만 그리고 기록도 한 줄이다.
   하나라도 실패하면 전부 되돌린다 — 절반만 밀린 순번은 안 민 것보다 나쁘다. */
async function saveBookOrders(changes, what){
  /* 끌기·«번호 정리»도 저장이다 — 예전엔 api.js를 직접 불러 진행 완료 잠금을
     건너뛰었다. 화면을 먼저 바꾸기 전에 막아야 «바뀐 척»이 남지 않는다. */
  if(exhLocked()){ exhLockNotice(); renderExh(); return; }
  const backup = changes.map(c => ({ o: c.o, was: c.o.book_order || '' }));
  changes.forEach(c => { c.o.book_order = c.no; });
  refreshExhViews();

  // 모듈 위의 가드된 saveExhibitor — 내가 본 이전 번호(expect)를 함께 보내 남의 변경을 덮지 않는다
  const res = await Promise.all(changes.map((c, i) =>
    saveExhibitor({ id: c.o.id, book_order: c.no, updated_at: td() }, { book_order: backup[i].was })));

  if(res.some(r => !r.ok)){
    backup.forEach(b => { b.o.book_order = b.was; });
    refreshExhViews();
    if(res.some(r => r.locked)) return;   // 가드가 이미 알렸다
    alert(res.some(r => r.conflict)
      ? '그 사이 다른 사람이 도록 순서를 바꿨어요. 새로고침한 뒤 다시 옮겨 주세요.'
      : '순서 저장에 실패했어요. 원래 순서로 되돌렸습니다.');
    return;
  }
  /* 순번은 한 곳을 옮기면 수십 곳이 함께 밀린다 — 줄마다 이전 번호를 담아야
     되돌릴 수 있다. 예전에 스크립트와 화면이 서로 덮어써 43곳이 밀린 적이 있다. */
  trackAction('edit', '도록 순서 변경', what,
    `<b>${escapeHtml(what)}</b> — ${changes.length}곳의 순번이 밀렸어요`,
    { table: 'exhibitors', op: 'update-many',
      rows: backup.map((b, i) => ({ row: b.o.id, before: { book_order: b.was },
        after: { book_order: changes[i].no } })) });
}

/* 겹친 번호와 빈 번호만 없앤다. 지금 보이는 앞뒤는 그대로 두고 번호만 1..N으로
   다시 붙인다 — «순서 자동 매기기»는 부스 순으로 줄을 새로 세우지만, 이건
   사람이 잡아 둔 순서를 건드리지 않는다. */
export async function renumberBook(){
  await reloadExhibitors();          // 위와 같은 이유 — 낡은 줄 세우기로 덮어쓰지 않게
  const seq = bookSeq(exhEvent);
  const changes = seq.map((o, i) => ({ o, no: String(i + 1) }))
    .filter(c => String(c.o.book_order || '') !== c.no);
  if(!changes.length){ alert('번호가 이미 1번부터 빠짐없이 붙어 있어요.'); return; }
  if(!confirm(`${changes.length}곳의 번호가 바뀝니다. 앞뒤 순서는 그대로 두고 번호만 1~${seq.length}번으로 다시 붙일까요?`)) return;
  await saveBookOrders(changes, `번호 정리 1~${seq.length}번`);
}

/* 끌어 옮기기. 줄 전체를 draggable로 두면 기업명을 긁어 복사하려다 끌려가고,
   놓는 순간 드로어가 열린다. 손잡이를 누르고 있는 동안에만 켠다. */
export function bookDragOn(el){ const tr = el.closest('tr'); if(tr) tr.draggable = true; }
export function bookDragStart(e, id){ exhUi.bookDragId = id; e.dataTransfer.effectAllowed = 'move'; }
export function bookDragEnd(el){ const tr = el.closest('tr'); if(tr) tr.draggable = false; exhUi.bookDragId = ''; }
export function bookDragOver(e, el){
  if(!exhUi.bookDragId) return;
  e.preventDefault();
  el.style.boxShadow = 'inset 0 2px 0 var(--a)';
}
export function bookDragLeave(el){ el.style.boxShadow = ''; }
export async function bookDrop(e, id){
  e.preventDefault();
  const tr = e.currentTarget; if(tr) tr.style.boxShadow = '';
  if(!exhUi.bookDragId || exhUi.bookDragId === id) return;
  const seq = bookSeq(exhEvent);
  const target = seq.findIndex(o => o.id === id);
  const from = seq.findIndex(o => o.id === exhUi.bookDragId);
  if(target < 0 || from < 0) return;
  // 아래로 끌면 놓은 줄의 자리를 차지하고, 위로 끌면 그 앞에 선다
  await moveBookOrder(exhUi.bookDragId, target + 1);
  exhUi.bookDragId = '';
}

/* ── 기본 시공 ──
   추가 발주 화면과 나눠 둔 까닭은 성격이 달라서다. 저기는 기업이 신청한 것이라
   안 오면 안 하면 되지만, 여기는 계약에 들어 있어 기업이 조용해도 우리가 만들어
   세워야 한다. 같은 표에 섞으면 "주문 없음"과 "우리가 빠뜨림"이 같아 보인다.

   부스 순으로 세운다 — 간판을 달고 벽면을 붙이는 일이 전시장을 한 바퀴 도는
   일이라, 그 순서대로 있어야 한 번에 끝난다. */
/* ── 기본 시공 일괄 처리 ──
   간판은 기업이 이름만 주면 우리가 만든다. 그래서 스무 곳 서른 곳을 같은 날
   한꺼번에 뽑아 놓고, 표로 돌아와 날짜를 하나하나 찍게 된다. 그 반복을 없앤다.

   고른 것은 행사가 바뀌면 비운다 — 다른 행사 목록에서 남은 선택이 보이지 않는
   채로 살아 있으면, 일괄 처리가 엉뚱한 곳에 걸린다. */

const baseSelSync = () => {
  if(exhUi.baseSelEvent !== exhEvent){ exhUi.baseSel = new Set(); exhUi.baseSelEvent = exhEvent; }
};

export function toggleBaseSel(id){
  baseSelSync();
  exhUi.baseSel.has(id) ? exhUi.baseSel.delete(id) : exhUi.baseSel.add(id);
  renderExh();
}

/* 지금 화면에 보이는 것만 다룬다 — 필터를 걸어 놓고 «모두»를 누르면 걸러낸
   것까지 잡히면 안 된다. 하나라도 안 골라져 있으면 전체 선택, 다 골라져 있으면 해제. */
export function toggleBaseSelAll(){
  baseSelSync();
  const ids = visibleList().filter(x => baseKind(x)).map(x => x.id);
  const allOn = ids.length > 0 && ids.every(i => exhUi.baseSel.has(i));
  ids.forEach(i => allOn ? exhUi.baseSel.delete(i) : exhUi.baseSel.add(i));
  renderExh();
}

/* 고른 곳의 «우리 작업» 날짜를 한 번에 찍는다. 날짜를 비워 두면 오늘이다 —
   대개 만든 날 바로 표시하므로 그게 기본값이다.
   이미 찍혀 있는 곳이 몇 곳 덮이는지 먼저 알려 준다. 되돌릴 방법이 없다. */
export async function applyBaseDone(){
  baseSelSync();
  const rows = visibleList().filter(x => baseKind(x) && exhUi.baseSel.has(x.id));
  if(!rows.length){ alert('제작 완료로 표시할 곳을 먼저 고르세요.'); return; }

  const v = (document.getElementById('base-bulk-date')?.value || '').trim() || td();
  const over = rows.filter(x => baseDoneAt(x) && baseDoneAt(x) !== v);
  const noName = rows.filter(x => baseKind(x) === 'fascia' && !fasciaName(x));

  /* 간판은 우리가 도록 영문명으로 일괄 제작한다 — «간판명 확정»과 «간판 제작»이
     한 동작이라, 제작 완료를 찍는데 확정일이 비어 있으면 화면에는 계속 «미수령»로
     남는다. 지어내는 날짜가 아니라 같은 날의 같은 일이므로 함께 찍는다.
     출력·시공 쪽은 다르다 — 거기 수령일은 기업에서 파일이 실제로 온 날이라
     우리가 만든 날로 대신할 수 없다. */
  const alsoRecv = rows.filter(x => baseKind(x) === 'fascia' && !baseRecvAt(x));

  if(!confirm(`${rows.length}곳을 «제작 완료 ${v}»로 표시합니다.`
    + (alsoRecv.length ? `\n간판 ${alsoRecv.length}곳은 «간판명 확정»도 같은 날짜로 함께 찍습니다.` : '')
    + (over.length ? `\n이미 날짜가 적힌 ${over.length}곳도 이 날짜로 바뀝니다.` : '')
    + (noName.length ? `\n\n⚠ 간판에 넣을 영문명이 없는 곳이 ${noName.length}곳 있어요 — 이름 없이 완료로 표시됩니다.\n   ${noName.slice(0, 5).map(x => exhNames(x).ko).join(', ')}${noName.length > 5 ? ' 외' : ''}` : ''))) return;

  for(const x of rows){
    /* 날짜는 항목 줄에 들어간다(항목이 없는 기업만 기업 칸에) — 읽는 자리와
       쓰는 자리가 갈리면 일괄로 찍어도 화면이 안 바뀐다. */
    await setBaseDoneAt(x.id, v);
    if(alsoRecv.includes(x)) await setBaseRecvAt(x.id, v);
  }
  exhUi.baseSel.clear();
  renderExh();
}

/* 잘못 찍었을 때 되돌리는 길도 같이 둔다 — 일괄로 넣을 수 있으면 일괄로 빼는
   길도 있어야 한다. 없으면 스무 곳을 하나씩 지우게 된다. */
export async function clearBaseDone(){
  baseSelSync();
  const rows = visibleList().filter(x => baseKind(x) && exhUi.baseSel.has(x.id) && baseDoneAt(x));
  if(!rows.length){ alert('제작 완료가 적힌 곳을 골라 주세요.'); return; }
  if(!confirm(`${rows.length}곳의 «제작 완료» 날짜를 지웁니다.`)) return;
  for(const x of rows) await setBaseDoneAt(x.id, '');
  exhUi.baseSel.clear();
  renderExh();
}

export function renderBaseView(list){
  const all = list.filter(x => baseKind(x));
  if(!all.length) return emptyView('기본 시공 대상이 없어요 — 기본부스·블록부스·라이팅부스가 있어야 합니다');
  /* 받는 것도 하는 일도 종류마다 다르다. 간판명은 상호를 받아 간판을 만들고,
     출력·시공은 디자인 파일을 받아 출력한다 — 같은 날 같은 사람이 하는 일이
     아니라, 한쪽만 보고 싶을 때가 대부분이다. */
  const rows = !exhUi.baseFil ? all
    : exhUi.baseFil === 'design' ? all.filter(hasDesignOrder)
    : all.filter(x => baseKind(x) === exhUi.baseFil);

  const bk = (x) => { const k = boothSortKey(x); return k === Infinity ? 1e9 : k; };
  rows.sort((a, b) => bk(a) - bk(b));

  const due = dueInfo('calc:base', exhEvent);
  const byKind = (k) => all.filter(x => baseKind(x) === k);
  const st = (x) => baseState(x);
  const gotN  = rows.filter(x => st(x).state !== 'todo').length;
  const doneN = rows.filter(x => st(x).state === 'done').length;

  /* 알약을 눌러 그 종류만 본다. 같은 알약을 다시 누르면 전체로 — 다른 목록과
     같은 손짓이라 따로 배울 게 없다. */
  const pills = `<button class="pill ${exhUi.baseFil ? 'p-gray' : 'p-blue'}" style="border:0;cursor:pointer;font:inherit"
      onclick="setBaseFil('')" title="전부 보기">대상 ${all.length}곳</button>`
    + Object.entries(BASE_KINDS).map(([k, v]) => {
        const g = byKind(k); if(!g.length) return '';
        return `<button class="pill ${exhUi.baseFil === k ? 'p-blue' : 'p-gray'}" style="border:0;cursor:pointer;font:inherit"
          onclick="setBaseFil('${escAttr(k)}')"
          title="${escapeHtml(v.types.join(', '))} — 눌러서 이것만 보기">${v.label} ${g.length}</button>`;
      }).join('')
    + (() => {
        const d = all.filter(hasDesignOrder);
        return d.length ? `<button class="pill ${exhUi.baseFil === 'design' ? 'p-teal' : 'p-gray'}"
          style="border:0;cursor:pointer;font:inherit"
          title="${escapeHtml(d.map(x => exhNames(x).ko).join(', ') + ' — 우리가 그려서 출력·시공합니다')}"
          onclick="setBaseFil('design')">디자인 의뢰 ${d.length}</button>` : '';
      })()
    + `<span class="pill ${gotN === rows.length ? 'p-green' : 'p-amber'}">수령 ${gotN}/${rows.length}</span>`
    + `<span class="pill ${doneN === rows.length ? 'p-green' : 'p-gray'}">작업 완료 ${doneN}/${rows.length}</span>`
    + (due
      ? `<span class="pill ${due.days < 0 ? 'p-red' : due.days <= 7 ? 'p-amber' : 'p-gray'}">수령 마감 ${escapeHtml(due.date)}${
          due.days < 0 ? ` · ${-due.days}일 지남` : due.days === 0 ? ' · 오늘' : ` · D-${due.days}`}</span>`
      : `<span class="pill p-gray" title="설정 › 행사 관리에서 «기본 시공» 마감을 넣으면 남은 날이 표시됩니다">수령 마감 미설정</span>`)
    + (() => { const no = rows.filter(x => baseKind(x) === 'fascia' && !fasciaName(x));
        return no.length ? `<span class="pill p-red" title="${escapeHtml(no.map(x => exhNames(x).ko).join(', '))}">영문명 없음 ${no.length}</span>` : ''; })()
    + '<span style="font-size:10.5px;color:var(--i5);margin-left:2px">간판은 영문으로 나갑니다 · 추가 발주가 아니라 계약에 들어 있는 것들이에요 — 기업이 조용해도 우리가 만들어 세웁니다</span>';

  /* 받는 것이 무엇인지가 부스 타입마다 달라, 칸 하나에 두 가지를 담는다.
     기본부스는 간판에 넣을 상호를 적는 것 자체가 «받음»이다. */
  const recvCell = (x) => baseKind(x) === 'fascia'
    ? `<input class="fi" style="${TCELL}${x.fascia_name ? ';font-weight:600' : ''}${
        fasciaName(x) ? '' : ';border-color:var(--re)'}"
        placeholder="${escapeHtml(bookName(x).en || '게재 영문명이 없어요')}" value="${escapeHtml(x.fascia_name || '')}"
        title="${escapeHtml(x.fascia_name ? '간판만 따로 적은 이름이에요'
          : bookName(x).en ? '프로그램북 게재 영문명을 그대로 씁니다 — 간판만 다르면 여기에 적으세요'
          : '게재 영문명이 비어 있어요 — 프로그램북 탭에서 넣거나 여기에 직접 적으세요')}"
        onclick="event.stopPropagation()"
        onchange="setExhField('${escAttr(x.id)}','fascia_name',this.value,'간판명')">`
    /* 디자인을 의뢰한 곳은 받을 것이 없다 — 우리가 그린다. 같은 칸을 «우리
       디자인 완료»로 읽게 이름표를 바꿔 단다. 칸을 따로 만들지 않는 건, 뒤에
       오는 «출력 완료»와의 앞뒤 관계가 똑같기 때문이다. */
    : `<input type="date" class="fi" style="${TCELL}${
        hasDesignOrder(x) ? ';border-color:var(--tl)' : ''}"
        value="${escapeHtml(baseRecvAt(x))}" onclick="event.stopPropagation()"
        title="${escapeHtml(hasDesignOrder(x)
          ? '디자인을 의뢰한 곳이에요 — 기업에서 받는 날이 아니라 우리 디자인이 끝난 날을 적습니다'
          : baseRecvItems(x).length
            ? `그래픽 현황의 «받을 파일»과 같은 자리예요 — 여기서 고치면 그쪽도 함께 바뀝니다 (${
                baseRecvItems(x).map(i => i.name || '').filter(Boolean).join(' · ')})`
            : '기업에서 디자인 파일을 받은 날')}"
        onchange="setBaseRecvAt('${escAttr(x.id)}',this.value)">`;

  /* 확정·완료 날짜는 그래픽 항목 줄에 적힌다(항목이 아직 없는 기업만 기업 칸).
     읽는 자리와 쓰는 자리를 함께 옮겨야 고친 값이 되돌아오지 않는다. */
  const baseDate = (x, which) => `<input type="date" class="fi" style="${TCELL}"
    value="${escapeHtml(which === 'done' ? baseDoneAt(x) : baseRecvAt(x))}" onclick="event.stopPropagation()"
    title="${escapeHtml(baseItems(x).length
      ? `그래픽의 «${baseItems(x).map(i => i.name || '').filter(Boolean).join(' · ')}»와 같은 칸이에요`
      : '')}"
    onchange="${which === 'done' ? 'setBaseDoneAt' : 'setBaseRecvAt'}('${escAttr(x.id)}',this.value)">`;

  const noteCell = (x) => `<input class="fi" style="${TCELL}"
    placeholder="비고" value="${escapeHtml(x.base_note || '')}" onclick="event.stopPropagation()"
    onchange="setExhField('${escAttr(x.id)}','base_note',this.value,'기본 시공 비고')">`;

  const mark = (x) => { const s = st(x);
    const c = s.state === 'done' ? 'p-green' : s.state === 'part' ? 'p-amber' : 'p-red';
    return `<span class="pill ${c}" style="${TPILL}">${escapeHtml(s.text || '')}</span>`; };

  baseSelSync();
  const selN = rows.filter(x => exhUi.baseSel.has(x.id)).length;
  const allOn = rows.length > 0 && rows.every(x => exhUi.baseSel.has(x.id));

  const selBox = (x) => `<input type="checkbox" ${exhUi.baseSel.has(x.id) ? 'checked' : ''}
    onclick="event.stopPropagation();toggleBaseSel('${escAttr(x.id)}')"
    title="일괄 처리에 넣습니다" style="cursor:pointer">`;

  /* 날짜를 비워 두면 오늘로 찍는다 — 값을 미리 넣어 두면 «오늘»이 아니라
     «화면을 연 날»이 되어, 창을 켜 둔 채 다음 날 누르면 어제로 들어간다. */
  const actions = `<input type="date" id="base-bulk-date" class="fi"
      style="width:136px;padding:4px 7px;font-size:11.5px" title="비우면 오늘 날짜로 찍습니다">
    <button class="btn bp bs" onclick="applyBaseDone()"
      title="고른 곳의 «우리 작업» 날짜를 한 번에 찍습니다">${selN ? `${selN}곳 ` : ''}제작 완료</button>
    ${selN ? `<button class="btn bs" onclick="clearBaseDone()" title="고른 곳의 «우리 작업» 날짜를 지웁니다">완료 해제</button>` : ''}
    <button class="btn bs" onclick="toggleBaseSelAll()">${allOn ? '모두 해제' : '모두 선택'}</button>`;

  if(isMobile()) return viewShell(pills, rows.map(x => {
    const k = baseKind(x);
    return `<div style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:11px 12px;margin-bottom:7px">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:5px">
        ${selBox(x)}
        <span class="pill p-gray">${x.booth_no ? '부스 ' + escapeHtml(x.booth_no) : '미배정'}</span>
        <span onclick="openExhDr('${escAttr(x.id)}','progress')"
          style="font-size:13px;font-weight:700;flex:1;min-width:0;cursor:pointer">${escapeHtml(exhNames(x).ko)}</span>
        ${mark(x)}
      </div>
      <div style="font-size:11px;color:var(--i4);margin-bottom:4px">${escapeHtml(x.booth_type || '')} · ${escapeHtml(BASE_KINDS[k].label)}${designPill(x)}</div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <span style="font-size:11px;color:var(--i4);min-width:64px">${escapeHtml(BASE_KINDS[k].recv)}</span>${recvCell(x)}</div>
      ${k === 'fascia' ? `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <span style="font-size:11px;color:var(--i4);min-width:64px">확정</span>${baseDate(x, 'recv')}</div>` : ''}
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:11px;color:var(--i4);min-width:64px">${escapeHtml(BASE_KINDS[k].done)}</span>${baseDoneCheck(x)}</div>
    </div>`;
  }).join(''), actions);

  return viewShell(pills, `<div class="tw"><table><thead><tr>
      <th style="min-width:26px"><input type="checkbox" ${allOn ? 'checked' : ''}
        onclick="event.stopPropagation();toggleBaseSelAll()" title="지금 보이는 곳을 모두 선택/해제"
        style="cursor:pointer"></th>
      <th style="min-width:44px;text-align:right">신청순</th>
      <th style="min-width:56px">부스</th>
      <th style="min-width:150px">기업</th>
      <th style="min-width:120px">부스 타입</th>
      <th style="min-width:96px">해야 할 일</th>
      <th style="width:200px;min-width:200px">받을 것</th>
      <th style="width:132px;min-width:132px">확정</th>
      <th style="width:96px;min-width:96px;text-align:center">우리 작업</th>
      <th style="width:96px;min-width:96px;text-align:center">상태</th>
      <th style="min-width:150px">비고</th>
    </tr></thead><tbody>
    ${rows.map(x => {
      const k = baseKind(x);
      return `<tr${exhUi.baseSel.has(x.id) ? ' style="background:var(--ad)"' : ''}>
        <td style="text-align:center">${selBox(x)}</td>
        ${applyCell(x)}
        <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(x.booth_no || '—')}</td>
        ${coCell(x, 'progress')}
        <td style="font-size:11px;color:var(--i4)">${escapeHtml(x.booth_type || '')}${
          x.booth_qty && x.booth_qty !== '1' ? ` <span style="color:var(--i5)">×${escapeHtml(x.booth_qty)}</span>` : ''}</td>
        <td><span class="pill ${BASE_KINDS[k].cls}" style="${TPILL}">${escapeHtml(BASE_KINDS[k].label)}</span>${designPill(x)}</td>
        <td>${recvCell(x)}</td>
        <td>${k === 'fascia'
          ? baseDate(x, 'recv')
          : '<span style="display:inline-block;width:100%;text-align:center;font-size:11px;color:var(--i6)">·</span>'}</td>
        <td style="text-align:center">${baseDoneCheck(x, TPILL)}</td>
        <td style="text-align:center">${mark(x)}</td>
        <td>${noteCell(x)}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`, actions);
}

/* ── 웹디렉토리 주소 ──────────────────────────────────────────
   프로그램북에 실린 정보를 그대로 보여주는 공개 페이지(backend의 /d/<슬러그>).
   인쇄물에는 이 주소나 QR만 싣는다 — 지면과 달리 인쇄 뒤에도 고칠 수 있다.

   슬러그를 저장해 두지 않고 행사 이름에서 만든다(백엔드 routes/public.js가
   같은 규칙으로 되돌려 찾는다). 규칙이 두 곳에 있는 건 감수한다 — 슬러그
   칸을 만들면 행사를 새로 열 때마다 사람이 채워야 하고, 비면 주소가 죽는다. */
const dirSlug = (v) => String(v || '').toLowerCase().trim()
  .replace(/[^a-z0-9가-힣]+/g, '-')
  .replace(/^-+|-+$/g, '');

export const webDirectoryUrl = (evKey) => {
  const slug = dirSlug(evKey || exhEvent);
  return slug && API_BASE_URL ? `${API_BASE_URL}/d/${slug}` : '';
};

function openWebDirectory(){
  const url = webDirectoryUrl();
  if(!url){ alert('행사를 먼저 고르세요.'); return; }
  window.open(url, '_blank', 'noopener');
}

async function copyWebDirectoryUrl(){
  const url = webDirectoryUrl();
  if(!url){ alert('행사를 먼저 고르세요.'); return; }
  /* 클립보드 API는 https나 localhost에서만 동작한다. 막히면 주소를 띄워
     직접 복사할 수 있게 한다 — 조용히 실패하면 붙여넣기 때 빈 값이 된다. */
  try {
    await navigator.clipboard.writeText(url);
    alert(`주소를 복사했어요.\n\n${url}`);
  } catch (e) {
    prompt('아래 주소를 복사하세요 (Ctrl+C)', url);
  }
}

function renderBookView(list){
  if(!list.length) return emptyView('표시할 기업이 없어요');

  /* 순서를 적어 뒀으면 그 순서로, 없으면 부스 번호순으로 세운다 — 도록은 보통
     부스 배치 순으로 싣기 때문에 그게 기본값으로 쓸 만하다. */
  const rows = [...list].sort((a, b) => {
    const ao = Number(String(a.book_order || '').replace(/[^0-9]/g, '')) || 0;
    const bo = Number(String(b.book_order || '').replace(/[^0-9]/g, '')) || 0;
    // 순번이 같은 자리가 실제로 있다 — 한 부스를 나눠 쓰는 두 기관이 도록에는
    // 각각 실리면서 번호는 하나로 받아 온다(39-1 서울대·39-2 분당서울대).
    // 그대로 두면 둘의 앞뒤가 그때그때 달라져 교정 볼 때마다 순서가 바뀐다.
    if(ao !== bo) return (ao || 1e9) - (bo || 1e9);
    return boothSortKey(a) - boothSortKey(b);
  });

  /* 번호가 겹치는 순번 — 실수인지 일부러인지 화면에서 알 수 있어야 한다 */
  const dupOrders = (() => {
    const c = {};
    rows.forEach(x => { const o = String(x.book_order || '').trim(); if(o) c[o] = (c[o] || 0) + 1; });
    return new Set(Object.keys(c).filter(k => c[k] > 1));
  })();

  const done = rows.filter(x => !bookMissing(x).length).length;
  const noLogo = rows.filter(x => x.book_logo !== 'yes').length;
  const noIntro = rows.filter(x => !introLen(x.book_intro)).length;
  const lens = rows.map(x => introLen(x.book_intro)).filter(Boolean);
  const overRows = rows.map(x => ({ x, o: introOver(x.book_intro) })).filter(r => r.o.isOver);
  const overN = overRows.length;

  const pills = `<span class="pill p-gray">기업 ${rows.length}</span>`
    + `<span class="pill ${done === rows.length ? 'p-green' : 'p-amber'}">완성 ${done}/${rows.length}</span>`
    + (noLogo ? `<span class="pill p-red">로고 미확보 ${noLogo}</span>` : '')
    + (noIntro ? `<span class="pill p-red">회사소개 없음 ${noIntro}</span>` : '')
    + (lens.length ? `<span class="pill p-gray" title="띄어쓰기 포함">소개 ${Math.min(...lens)}~${Math.max(...lens)}자</span>` : '')
    + (overN ? `<span class="pill p-red" title="${escapeHtml(overRows.map(o => `${exhNames(o.x).ko} ${o.o.chars}자`).join(', '))}">한도 초과 ${overN}</span>` : '')
    + (dupOrders.size ? `<span class="pill p-amber" title="${escapeHtml([...dupOrders].map(o =>
        `${o}번: ${rows.filter(r => String(r.book_order || '').trim() === o).map(r => exhNames(r).ko).join(' · ')}`).join(' / '))}">겹친 순번 ${dupOrders.size}</span>` : '')
    + `<span style="font-size:10.5px;color:var(--i5);margin-left:2px">한도 ${bookLimit().chars.toLocaleString()}자 · ${bookLimit().words}단어 (띄어쓰기 포함)</span>`;

  const actions = `<button class="btn bs" onclick="fillBookOrder()" title="지금 부스 번호순으로 1번부터 다시 매깁니다">순서 자동 매기기</button>`
    + `<button class="btn bs" onclick="renumberBook()" title="겹치거나 빈 번호를 지금 순서 그대로 1번부터 다시 매깁니다">번호 정리</button>`
    + `<button class="btn bs" onclick="openWebDirectory()" title="여기 있는 정보로 만든 공개 페이지를 새 창에서 엽니다 — 로그인 없이 누구나 열립니다">웹디렉토리 열기</button>`
    + `<button class="btn bs" onclick="copyWebDirectoryUrl()" title="프로그램북에 싣거나 QR로 만들 주소를 복사합니다">주소 복사</button>`;

  const logoBtn = (x) => `<button
    onclick="event.stopPropagation();cycleBookLogo('${escAttr(x.id)}')"
    title="${x.book_logo === 'yes' ? '로고 받음' : x.book_logo === 'no' ? '로고 없음 — 요청 필요' : '아직 확인 안 함'}"
    style="border:none;background:none;padding:0;cursor:pointer;font-size:14px;line-height:1">
    ${x.book_logo === 'yes' ? '<span style="color:var(--g)">✓</span>'
      : x.book_logo === 'no' ? '<span style="color:var(--re)">✕</span>'
      : '<span style="color:var(--i6)">—</span>'}</button>`;

  const introCell = (x) => {
    const o = introOver(x.book_intro);
    if(!o.chars) return `<span class="pill p-red" style="cursor:pointer"
      onclick="event.stopPropagation();openBookIntro('${escAttr(x.id)}')">없음</span>`;
    return `<span class="pill ${o.isOver ? 'p-red' : 'p-green'}" style="cursor:pointer"
      onclick="event.stopPropagation();openBookIntro('${escAttr(x.id)}')"
      title="${o.chars}자 / ${o.words}단어 · 한도 ${o.lim.chars}자 · ${o.lim.words}단어${
        o.isOver ? ` — ${o.over.join(', ')} 초과` : ''}">${o.chars}자${
        o.isOver ? ` <b>+${o.over[0]}</b>` : ''}</span>`;
  };

  if(isMobile()) return viewShell(pills, rows.map(x => {
    const miss = bookMissing(x);
    return `<div onclick="openExhDr('${escAttr(x.id)}','book')" style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:11px 12px;margin-bottom:7px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <span class="pill ${dupOrders.has(String(x.book_order || '').trim()) ? 'p-amber' : 'p-gray'}"${
          dupOrders.has(String(x.book_order || '').trim()) ? ' title="같은 순번을 쓰는 기업이 또 있어요 — 한 부스를 나눠 쓰는 경우입니다"' : ''
        }>${escapeHtml(x.book_order || '-')}${dupOrders.has(String(x.book_order || '').trim()) ? ' ⚠' : ''}</span>
        <span style="font-size:13px;font-weight:700;flex:1;min-width:0">${escapeHtml(bookName(x).ko)}</span>
        ${x.booth_no ? `<span class="pill p-blue">부스 ${escapeHtml(x.booth_no)}</span>` : ''}
      </div>
      ${bookName(x).en ? `<div style="font-size:11px;color:var(--i4);margin-bottom:3px">${escapeHtml(bookName(x).en)}</div>` : ''}
      ${(() => { const o = introOver(x.book_intro);
        return `<div style="font-size:11px;color:${o.isOver ? 'var(--re)' : 'var(--i4)'}">회사소개 ${o.chars}자 · ${o.words}단어${
          o.isOver ? ` (${o.over.join(', ')} 초과)` : ''} · 로고 ${
          x.book_logo === 'yes' ? '있음' : x.book_logo === 'no' ? '없음' : '미확인'}</div>`; })()}
      ${miss.length
        ? `<div style="font-size:11px;color:var(--re);margin-top:3px">빠짐: ${escapeHtml(miss.join(', '))}</div>`
        : '<div style="font-size:11px;color:var(--g);margin-top:3px">모두 채워졌어요</div>'}
    </div>`;
  }).join(''), actions);

  const cell = (x, f, w) => `<td><input class="fi" style="width:${w};padding:3px 5px;font-size:11.5px"
    value="${escapeHtml(x[f] || '')}" onclick="event.stopPropagation()"
    onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr((BOOK_FIELDS.find(b => b[0] === f) || ['', f])[1])}')"></td>`;

  /* 안 적은 칸에는 CRM 이름을 흐리게 미리 보여 준다 — 빈칸이면 도록에 이름이
     안 나가는 줄 알고, 같은 이름을 56번 옮겨 적게 된다. 다른 곳만 고치면 된다. */
  const nameCell = (x, f, shown, label) => `<td><input class="fi"
    style="width:164px;padding:3px 5px;font-size:11.5px${x[f] ? ';font-weight:600' : ''}"
    value="${escapeHtml(x[f] || '')}" placeholder="${escapeHtml(shown || '')}"
    title="${escapeHtml(x[f] ? '직접 적은 이름이에요' : 'CRM 이름을 그대로 씁니다 — 다르면 여기에 적으세요')}"
    onclick="event.stopPropagation()"
    onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr(label)}')"></td>`;

  /* 걸러 놓은 채로 끌어 옮기면, 화면 밖 줄과의 앞뒤를 사람이 알 수 없다.
     번호를 적는 건 "전체에서 몇 번째"라는 뜻이라 걸러도 뜻이 분명하지만,
     끌어 옮기기는 보이는 줄끼리의 앞뒤라서 그렇지 않다. */
  const full = rows.length === activeExhibitors(exhEvent).length;

  return viewShell(pills, `<div class="tw"><table><thead><tr>
      ${full ? '<th style="width:22px" title="끌어서 순서를 바꿀 수 있어요"></th>' : ''}
      <th style="min-width:48px">순서</th>
      <th style="min-width:44px;text-align:center">로고</th>
      <th style="min-width:140px">기업 (CRM)</th>
      <th style="min-width:170px" title="도록과 간판에 실제로 나가는 이름이에요">게재 국문명</th>
      <th style="min-width:170px">게재 영문명</th>
      <th style="min-width:56px">부스</th>
      <th style="min-width:170px">주소</th>
      <th style="min-width:110px">연락처</th>
      <th style="min-width:140px">웹사이트</th>
      <th style="min-width:70px;text-align:center">회사소개</th>
      <th style="min-width:80px">빠진 항목</th>
    </tr></thead><tbody>
    ${rows.map(x => {
      const miss = bookMissing(x);
      const dup = dupOrders.has(String(x.book_order || '').trim());
      return `<tr onclick="openExhDr('${escAttr(x.id)}','book')" style="cursor:pointer"
        ${full ? `ondragstart="bookDragStart(event,'${escAttr(x.id)}')" ondragend="bookDragEnd(this)"
          ondragover="bookDragOver(event,this)" ondragleave="bookDragLeave(this)"
          ondrop="bookDrop(event,'${escAttr(x.id)}')"` : ''}>
        ${full ? `<td style="padding:0 2px;text-align:center" onclick="event.stopPropagation()">
          <span onmousedown="bookDragOn(this)" title="끌어서 옮기기"
            style="cursor:grab;color:var(--i6);font-size:13px;line-height:1;user-select:none">⠿</span></td>` : ''}
        <td><input class="fi" title="번호를 적으면 그 자리로 옮기고 나머지가 한 칸씩 밀려요"
          style="width:42px;padding:3px 5px;font-size:11.5px;text-align:center;font-weight:700${
            dup ? ';border-color:var(--am)' : ''}"
          value="${escapeHtml(x.book_order || '')}" onclick="event.stopPropagation()"
          onchange="moveBookOrder('${escAttr(x.id)}',this.value)"></td>
        <td style="text-align:center">${logoBtn(x)}</td>
        ${coCell(x, 'book')}
        ${nameCell(x, 'book_name_ko', bookName(x).ko, '게재 국문명')}
        ${nameCell(x, 'book_name_en', bookName(x).en, '게재 영문명')}
        <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(x.booth_no || '—')}</td>
        ${cell(x, 'book_address', '164px')}
        ${cell(x, 'book_phone', '104px')}
        ${cell(x, 'book_website', '134px')}
        <td style="text-align:center">${introCell(x)}</td>
        <td>${miss.length
          ? `<span class="pill p-amber" title="${escapeHtml(miss.join(', '))}">${miss.length}개</span>`
          : '<span class="pill p-green">완료</span>'}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`, actions);
}

/* 로고는 받음 / 없음 / 미확인 셋뿐이라 눌러서 돌린다 */
export async function cycleBookLogo(id){
  const x = getExhibitorById(id);
  if(!x) return;
  const next = { '': 'yes', yes: 'no', no: '' }[x.book_logo || ''];
  await patchExh(id, { book_logo: next }, null);
}

/* 지금 목록을 부스 번호순으로 1번부터 다시 매긴다 */
export async function fillBookOrder(){
  // 잠긴 행사면 «다시 매길까요?»를 묻기 전에 막는다 — 물어 놓고 줄마다 막히면 헷갈린다
  if(exhLocked()){ exhLockNotice(); return; }
  await reloadExhibitors();          // 위와 같은 이유 — 낡은 줄 세우기로 덮어쓰지 않게
  const rows = [...visibleList()].sort((a, b) => boothSortKey(a) - boothSortKey(b));
  if(!rows.length) return;
  if(!confirm(`${rows.length}개 기업의 도록 순서를 부스 번호순으로 다시 매길까요? 이미 적어둔 순서는 덮어씁니다.`)) return;
  for(let i = 0; i < rows.length; i++){
    if(String(rows[i].book_order || '') === String(i + 1)) continue;
    await patchExh(rows[i].id, { book_order: String(i + 1) }, null);
  }
  renderExh();
}

/* 회사소개는 길어서 표 칸에 안 들어간다 — 눌러서 따로 연다.
   고치는 동안 글자수가 바로 따라 움직여야 몇 자를 줄여야 하는지 보인다. */
export function openBookIntro(id){
  const x = getExhibitorById(id);
  if(!x) return;
  modalShell('book-intro-modal', `회사소개 — ${exhNames(x).ko}`, `
    <textarea class="fi" id="bi-text" rows="12" style="font-size:12.5px;line-height:1.7"
      oninput="updateIntroCount()"
      placeholder="도록에 실을 회사소개를 붙여넣으세요">${escapeHtml(x.book_intro || '')}</textarea>
    <div id="bi-meter" style="font-size:11.5px;margin:8px 0 12px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn bs" onclick="closeBookIntro()">취소</button>
      <button class="btn bp" onclick="saveBookIntro('${escAttr(id)}')">저장</button>
    </div>`);
  updateIntroCount();
  document.getElementById('bi-text')?.focus();
}

/* 고치는 동안 남은 글자수가 따라 움직여야 몇 자를 줄여야 하는지 보인다 */
export function updateIntroCount(){
  const ta = document.getElementById('bi-text');
  const el = document.getElementById('bi-meter');
  if(!ta || !el) return;
  const o = introOver(ta.value);
  const bad = o.isOver;
  el.innerHTML = `<span style="color:${bad ? 'var(--re)' : 'var(--i4)'}">
      띄어쓰기 포함 <b style="font-size:13px">${o.chars}</b>자 · <b style="font-size:13px">${o.words}</b>단어</span>
    <span style="color:var(--i5)"> / 한도 ${o.lim.chars.toLocaleString()}자 · ${o.lim.words}단어</span>
    ${bad ? `<div style="color:var(--re);font-weight:700;margin-top:3px">${o.over.join(', ')} 초과 — 줄여야 실립니다</div>`
      : `<div style="color:var(--g);margin-top:3px">지면에 들어갑니다 (${o.lim.chars - o.chars}자 여유)</div>`}`;
}

export async function saveBookIntro(id){
  const el = document.getElementById('bi-text');
  if(!el) return;
  await patchExh(id, { book_intro: el.value.trim() }, null);
  closeBookIntro();
  renderExh();
}
export const closeBookIntro = () => document.getElementById('book-intro-modal')?.remove();

export const modalShell = (id, title, body) => {
  if(document.getElementById(id)) return;
  const el = document.createElement('div');
  el.id = id;
  /* 오버레이는 .mw(position:fixed + z-index), 안쪽 패널은 .modal이다.
     전에 두 클래스를 뒤바꿔 써서 모달이 크기 0으로 깔려 화면에 보이지 않았다 —
     함수는 정상이라 프로그램으로 부르면 동작했지만 사람은 누를 수가 없었다. */
  el.className = 'mw on';
  /* 배경을 눌러 닫되, 누르기 시작한 곳이 패널 안이면 닫지 않는다.
     글자를 드래그로 선택하다 패널 밖에서 손을 떼면 click의 target이 배경이 되는데,
     그것까지 닫아 버리면 복사하려다 입력하던 내용을 통째로 잃는다. */
  let downOnBg = false;
  el.addEventListener('mousedown', (e) => { downOnBg = (e.target === el); });
  el.addEventListener('click', (e) => { if(e.target === el && downOnBg) el.remove(); });
  el.innerHTML = `<div class="modal" style="max-width:440px">
    <div class="mh"><div class="mt2">${escapeHtml(title)}</div>
      <button class="mc" onclick="document.getElementById('${id}')?.remove()">✕</button></div>
    <div class="mb">${body}</div></div>`;
  document.body.appendChild(el);
};
const mval = (id) => (document.getElementById(id) || {}).value?.trim() || '';

/* ── 품목 추가 (행사 품목마스터) ── */
/* 분류는 행사마다 다르다 — 렌탈사와 출력소가 바뀌면 품목도 분류도 따라 바뀐다.
   비품과 그래픽은 목록을 나눠 둔다. 한 목록에 담아 뒀더니 그래픽 품목을 넣을 때
   '의자·테이블'밖에 안 떠서, 사람이 목록 밖의 값을 손으로 적어 넣었다 —
   그렇게 족자봉·폼보드가 의자와 같은 칸에 섞였다. */
const eqCats = (kind) => kind === 'graphic'
  ? codeList('graphic_cat', exhEvent,
      ['벽면 랩핑', '인포데스크 랩핑', '족자봉', '기타그래픽'].map(c => ({ code: c, label: c })))
  : codeList('equip_cat', exhEvent,
      ['의자', '테이블', '진열대', '가전제품', '기타비품'].map(c => ({ code: c, label: c })));

/* kind는 부른 화면이 정한다 — 비품 현황에서 열면 비품, 그래픽 현황에서 열면
   그래픽. 전에는 어디서 열든 비품으로 저장돼서, 그래픽 품목표에 넣은 줄이
   비품 목록에 나타났다. */
export function openNewCatalogItem(kind){
  if(!exhEvent){ alert('행사를 먼저 선택해주세요.'); return; }
  const isG = kind === 'graphic';
  modalShell('new-eq-modal', isG ? '그래픽 품목 추가' : '품목 추가', `
    <div style="font-size:11.5px;color:var(--i4);margin-bottom:12px;line-height:1.6">
      <b>${escapeHtml(exhEvent)}</b> ${isG ? '그래픽' : '비품'} 품목표에 추가됩니다. 다른 행사에는 영향이 없어요.</div>
    <input type="hidden" id="neq-kind" value="${escapeHtml(isG ? 'graphic' : 'equip')}">
    <div class="fgr">
      <div class="fg"><label class="fl">분류</label>
        <select class="fi" id="neq-cat">${eqCats(kind).map(c => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.label)}</option>`).join('')}</select></div>
      <div class="fg"><label class="fl">품목코드</label>
        <input class="fi" id="neq-code" placeholder="비우면 자동 (X-001…)"></div>
    </div>
    <div class="fg"><label class="fl">품명 (국문)</label><input class="fi" id="neq-ko" placeholder="${isG ? '예: 벽면 랩핑 (PVC)' : '예: 접이식 체어'}"></div>
    <div class="fg"><label class="fl">품명 (영문)</label><input class="fi" id="neq-en" placeholder="${isG ? '예: Wall Wrapping' : '예: Folding Chair'}"></div>
    <div class="fg"><label class="fl">규격</label><input class="fi" id="neq-spec" placeholder="${isG ? '예: 970*2390mm/패널' : '예: 500*420*750mmH'}"></div>
    <div class="fgr">
      <div class="fg"><label class="fl">단가 (KRW)</label><input class="fi" id="neq-krw" placeholder="11000"></div>
      <div class="fg"><label class="fl">단가 (USD)</label><input class="fi" id="neq-usd" placeholder="11"></div>
    </div>
    <div id="neq-msg" style="font-size:11.5px;min-height:16px;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn bs" onclick="document.getElementById('new-eq-modal')?.remove()">취소</button>
      <button class="btn bp" id="neq-save" onclick="submitNewCatalogItem()">추가</button>
    </div>`);
  document.getElementById('neq-ko')?.focus();
}

export async function submitNewCatalogItem(){
  const msg = document.getElementById('neq-msg');
  const btn = document.getElementById('neq-save');
  const ko = mval('neq-ko'), en = mval('neq-en');
  const fail = (t) => { if(msg){ msg.style.color = 'var(--re)'; msg.textContent = t; }
    if(btn){ btn.disabled = false; btn.textContent = '추가'; } };

  if(!ko && !en) return fail('품명을 국문이나 영문 중 하나는 입력해주세요.');
  if(btn){ btn.disabled = true; btn.textContent = '추가 중…'; }

  // 같은 이름이 이미 있으면 새로 만들지 않는다 — 카탈로그를 둔 이유가 없어진다
  const dup = findCatalogByName(exhEvent, ko || en);
  if(dup) return fail(`이미 있는 품목이에요 — ${dup.code} ${dup.name_ko || dup.name_en}`);

  const kind = mval('neq-kind') === 'graphic' ? 'graphic' : 'equip';
  let code = mval('neq-code').toUpperCase();
  const used = new Set(catalogFor(exhEvent).map(c => String(c.code || '').toUpperCase()));
  if(code && used.has(code)) return fail(`이미 쓰고 있는 코드예요 — ${code}`);
  if(!code){
    let n = 1;
    const pre = kind === 'graphic' ? 'XG' : 'X';   // 설정 › 품목표와 같은 규칙
    while(used.has(`${pre}-${String(n).padStart(3, '0')}`)) n++;
    code = `${pre}-${String(n).padStart(3, '0')}`;
  }

  const num = (v) => String(v || '').replace(/[^0-9.]/g, '');
  const rec = {
    id: `EC-${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    event_id: exhEvent, kind,
    category: mval('neq-cat') || (kind === 'graphic' ? '기타그래픽' : '기타비품'), code,
    name_ko: ko, name_en: en, spec: mval('neq-spec'),
    price_krw: num(mval('neq-krw')), price_usd: num(mval('neq-usd')),
    note: '', active: '', sort_order: String(900 + catalogFor(exhEvent).length),
  };

  EQUIP_CATALOG.push(rec);
  // 품목표도 이 행사의 기록이다 — api.js를 직접 부르면 진행 완료 잠금을 건너뛴다
  const saveEquipCatalog = guardWrite((await import('../../api.js')).saveEquipCatalog);
  const r = await saveEquipCatalog(rec);
  if(!r.ok){
    const i = EQUIP_CATALOG.indexOf(rec);
    if(i >= 0) EQUIP_CATALOG.splice(i, 1);
    return fail(r.locked ? '진행 완료된 행사라 추가할 수 없어요.' : '저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
  }
  if(r.id && r.id !== rec.id) rec.id = r.id;

  trackAction('add', '품목 등록', exhEvent,
    `<b>${escapeHtml(code)}</b> ${escapeHtml(ko || en)} — ${escapeHtml(exhEvent)} 품목표에 추가`);
  document.getElementById('new-eq-modal')?.remove();
  renderExh();
}

/* ── 그래픽 주문 추가 ── */
export function openNewGraphicOrder(){
  if(!exhEvent){ alert('행사를 먼저 선택해주세요.'); return; }
  const cos = activeExhibitors(exhEvent)
    .slice().sort((a, b) => String(a.company_name).localeCompare(String(b.company_name), 'ko'));
  if(!cos.length){ alert('등록된 참가기업이 없어요.'); return; }

  modalShell('new-gr-modal', '그래픽 주문 추가', `
    <div class="fg"><label class="fl">기업</label>
      <select class="fi" id="ngr-co">${cos.map(x =>
        `<option value="${escapeHtml(x.id)}">${escapeHtml(exhNames(x).ko)}${
          exhNames(x).en ? ` (${escapeHtml(exhNames(x).en)})` : ''}${x.booth_no ? ` · 부스 ${escapeHtml(x.booth_no)}` : ''}</option>`).join('')}</select></div>
    <div class="fgr">
      <div class="fg"><label class="fl">유형</label>
        <select class="fi" id="ngr-type">
          <option value="">미정</option>
          <option value="design">제작 (초안→수정안→최종안)</option>
          <option value="print">출력 (규격 확인만)</option>
        </select></div>
      <div class="fg"><label class="fl">주문일</label>
        <input type="date" class="fi" id="ngr-date" value="${td()}"></div>
    </div>
    <div class="fg"><label class="fl">항목명</label>
      <input class="fi" id="ngr-name" placeholder="예: 인포메이션 데스크 랩핑 (PET)"></div>
    <div class="fgr">
      <div class="fg"><label class="fl">금액</label><input class="fi" id="ngr-amt" placeholder="비우면 나중에"></div>
      <div class="fg"><label class="fl">통화</label>
        <select class="fi" id="ngr-cur"><option value="KRW">KRW</option><option value="USD">USD</option></select></div>
    </div>
    <div id="ngr-msg" style="font-size:11.5px;min-height:16px;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn bs" onclick="document.getElementById('new-gr-modal')?.remove()">취소</button>
      <button class="btn bp" id="ngr-save" onclick="submitNewGraphicOrder()">추가</button>
    </div>`);
  document.getElementById('ngr-name')?.focus();
}

export async function submitNewGraphicOrder(){
  const msg = document.getElementById('ngr-msg');
  const btn = document.getElementById('ngr-save');
  const fail = (t) => { if(msg){ msg.style.color = 'var(--re)'; msg.textContent = t; }
    if(btn){ btn.disabled = false; btn.textContent = '추가'; } };

  const x = getExhibitorById(mval('ngr-co'));
  if(!x) return fail('기업을 골라주세요.');
  const name = mval('ngr-name');
  if(!name) return fail('항목명을 입력해주세요.');
  if(btn){ btn.disabled = true; btn.textContent = '추가 중…'; }

  const amount = mval('ngr-amt').replace(/[^0-9.]/g, '');
  const rec = {
    id: `XI-${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    exhibitor_id: x.id, category: 'graphic', name,
    qty: '', unit_price: '', amount, currency: mval('ngr-cur') || 'KRW',
    note: '', sort_order: nextItemSort(x.id), catalog_id: '',
  };

  EXH_ITEMS.push(rec);
  // 모듈 위의 가드된 saveExhItem을 쓴다 — 예전엔 api.js를 직접 불러 잠금을 건너뛰었다
  const r = await saveExhItem(rec);
  if(!r.ok){
    const i = EXH_ITEMS.indexOf(rec);
    if(i >= 0) EXH_ITEMS.splice(i, 1);
    return fail(r.locked ? '진행 완료된 행사라 추가할 수 없어요.' : '저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
  }
  if(r.id && r.id !== rec.id) rec.id = r.id;

  /* 주문일·유형은 참가기업 쪽에 있다. 여기서 함께 넣어 두지 않으면 항목만 생기고
     그래픽 현황에는 '주문 안 함'으로 남아 화면과 데이터가 어긋난다.
     이미 적혀 있으면 덮지 않는다 — 나중 주문이 처음 주문일을 지우면 안 된다. */
  const patch = {};
  if(!String(x.graphic_ordered_at || '').trim()) patch.graphic_ordered_at = mval('ngr-date') || td();
  const type = mval('ngr-type');
  if(type && !String(x.graphic_type || '').trim()) patch.graphic_type = type;
  if(Object.keys(patch).length) await patchExh(x.id, patch, null);

  trackAction('add', '그래픽 주문 추가', x.company_name || '',
    `<b>${escapeHtml(x.company_name || '')}</b> ${escapeHtml(name)}${amount ? ` ${escapeHtml(fmtMoney(amount, rec.currency))}` : ''}`,
    { kind: 'exhibitor', id: x.id, tab: 'graphic' });
  document.getElementById('new-gr-modal')?.remove();
  renderExh();
}

/* «전시 대시보드»은 ../features/exhibition/exh-dashboard.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* «참가기업 직접 추가·불러오기»은 ../features/exhibition/exh-add.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */


/* 화면의 onclick이 부르는 것 */
window.moveBookOrder = moveBookOrder;
window.renumberBook = renumberBook;
window.bookDragOn = bookDragOn;
window.bookDragStart = bookDragStart;
window.bookDragEnd = bookDragEnd;
window.bookDragOver = bookDragOver;
window.bookDragLeave = bookDragLeave;
window.bookDrop = bookDrop;
window.cycleBookLogo = cycleBookLogo;
window.fillBookOrder = fillBookOrder;
window.openWebDirectory = openWebDirectory;
window.copyWebDirectoryUrl = copyWebDirectoryUrl;
window.openBookIntro = openBookIntro;
window.saveBookIntro = saveBookIntro;
window.updateIntroCount = updateIntroCount;
window.closeBookIntro = closeBookIntro;
window.openNewCatalogItem = openNewCatalogItem;
window.submitNewCatalogItem = submitNewCatalogItem;
window.openNewGraphicOrder = openNewGraphicOrder;
window.submitNewGraphicOrder = submitNewGraphicOrder;
window.toggleBaseSel    = toggleBaseSel;
window.toggleBaseSelAll = toggleBaseSelAll;
window.applyBaseDone    = applyBaseDone;
window.clearBaseDone    = clearBaseDone;
window.renderBookView = renderBookView;   // 탭(exh-tab.js)이 window로 부른다
window.modalShell = modalShell;   // 탭(exh-tab.js)이 window로 부른다
