/* ══════════════════════════════════════════════════════════════
   overlay-nav.js — 뒤로가기로 오버레이(드로어/모달/사이드바)를 닫는다

   전에는 드로어가 열린 채 뒤로가기를 누르면 앱을 통째로 벗어나서, 보던 화면과
   로그인 상태까지 날아갔다. 모바일에서는 뒤로가기가 "닫기"로 쓰이는 게
   자연스러우므로, 오버레이가 하나라도 떠 있으면 뒤로가기가 그것만 닫게 한다.

   방식(트랩 패턴):
   - 오버레이가 열리면 히스토리에 항목을 하나 밀어 넣는다.
   - 뒤로가기(popstate)가 오면 "실제로 열려 있는" 오버레이 중 가장 나중에 열린
     것을 닫는다. 아직 남은 게 있으면 항목을 다시 밀어 넣어 다음 뒤로가기도
     받는다.
   - 열린 게 하나도 없으면 아무것도 안 하고 그대로 뒤로 이동시킨다.

   열림 여부를 DOM으로 직접 확인하기 때문에, 닫기 버튼·배경 클릭·ESC 등
   우리가 가로채지 못한 경로로 닫혀도 상태가 어긋나지 않는다.
═══════════════════════════════════════════════════════════════ */

/* 각 오버레이: 열렸는지 판별 + 닫는 방법. isOpen은 DOM만 보고 판단한다. */
const byId = (id) => () => !!document.getElementById(id);
const hasOn = (id) => () => !!document.getElementById(id)?.classList.contains('on');

const OVERLAYS = [
  // 드로어
  { open: 'openExhDr',            close: 'closeExhDr',            isOpen: hasOn('exh-dr') },
  { open: 'openDr',               close: 'closeDr',               isOpen: hasOn('dr') },
  { open: 'openContactDr',        close: 'closeContactDr',        isOpen: hasOn('con-dr') },
  // 모달
  { open: 'openModal',            close: 'closeModal',            isOpen: hasOn('mw') },
  { open: 'openExhImport',        close: 'closeExhImport',        isOpen: byId('exh-import-modal') },
  { open: 'openMDBBulkEditModal', close: 'closeMDBBulkEditModal',  isOpen: byId('mdb-bulk-modal') },
  { open: 'openAddContactModal',  close: 'closeAddContactModal',   isOpen: byId('add-contact-modal') },
  { open: 'openAddEvModal',       close: 'closeAddEvModal',        isOpen: byId('add-ev-modal') },
  { open: 'openAddCoEventModal',  close: 'closeAddEvModal',        isOpen: byId('add-ev-modal') },
  { open: null,                   close: 'closeCoSectorPopover',   isOpen: byId('co-sector-popover') },
  // 모바일 사이드바 (toggleSb로 열리므로 open 래핑 대신 아래에서 따로 처리)
  { open: null,                   close: 'closeSb',                isOpen: () => !!document.querySelector('.sb.sb-open') },
];

let seq = 0;                 // 열린 순서 — 가장 나중에 열린 것부터 닫는다
const order = new Map();     // close 함수 이름 → 열린 순번
let trapped = false;         // 히스토리에 우리 항목이 들어가 있나

function openOnes(){
  return OVERLAYS.filter(o => { try { return o.isOpen(); } catch(e){ return false; } })
    .sort((a, b) => (order.get(a.close) || 0) - (order.get(b.close) || 0));
}

/* 오버레이가 열렸을 때 — 히스토리 항목을 하나만 유지한다(중첩돼도 하나면 충분,
   닫을 때마다 다시 밀어 넣기 때문). */
function arm(closeName){
  order.set(closeName, ++seq);
  if(!trapped){
    history.pushState({ overlay: true }, '');
    trapped = true;
  }
}

export function initOverlayNav(){
  // 열기 함수: 호출된 뒤 실제로 열렸으면 히스토리를 건다
  OVERLAYS.forEach(o => {
    if(!o.open) return;
    const orig = window[o.open];
    if(typeof orig !== 'function') return;
    window[o.open] = function(...args){
      const r = orig.apply(this, args);
      // 렌더가 끝난 뒤 판단 (모달은 DOM에 붙는 시점이 함수 끝)
      if(o.isOpen()) arm(o.close);
      return r;
    };
  });

  // 사이드바는 toggle이라 호출 후 상태를 보고 판단한다
  const ts = window.toggleSb;
  if(typeof ts === 'function'){
    window.toggleSb = function(...args){
      const r = ts.apply(this, args);
      if(document.querySelector('.sb.sb-open')) arm('closeSb');
      return r;
    };
  }

  window.addEventListener('popstate', () => {
    const open = openOnes();
    if(!open.length){
      // 열린 오버레이가 없다 — 평범한 뒤로가기로 두고 트랩만 해제
      trapped = false;
      return;
    }
    const top = open[open.length - 1];
    const close = window[top.close];
    if(typeof close === 'function'){
      try { close(); } catch(e){ console.warn('[overlay-nav] 닫기 실패:', top.close, e); }
    }
    order.delete(top.close);

    // 아직 남은 오버레이가 있으면 다음 뒤로가기도 받도록 다시 건다
    if(openOnes().length){
      history.pushState({ overlay: true }, '');
      trapped = true;
    } else {
      trapped = false;
    }
  });
}
