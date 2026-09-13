/* ══════════════════════════════════════════════════════════════
   back-button.js — 휴대폰의 «뒤로»를 앱 안에서 쓴다

   이 앱은 주소가 하나다. 탭을 옮기고 드로어를 열어도 브라우저 기록에는 아무
   일도 안 일어나므로, 뒤로 가기를 누르면 그 전 «사이트»로 나가 버린다.
   드로어 하나 닫으려고 누른 건데 앱이 통째로 사라진다.

   그래서 화면이 한 겹 열릴 때마다 기록을 한 칸 쌓는다. 뒤로 가기는 그 칸을
   하나씩 걷어낸다.

     드로어·모달이 열려 있으면   → 그것부터 닫는다
     아니면 탭을 옮긴 적이 있으면 → 이전 탭으로
     그것도 없으면               → 앱을 나간다 (원래 하던 대로)

   ── 왜 각 화면을 고치지 않고 DOM을 지켜보나 ──
   여는 자리가 스무 곳이 넘는다(드로어 다섯, 모달 열 몇 개…). 한 곳이라도
   빠뜨리면 거기서만 앱이 꺼지는데, 그건 «가끔 꺼진다»로 보여서 원인을 못 찾는다.

   대신 이미 지켜지고 있는 약속을 쓴다: 열린 드로어는 «.dr.on», 열린 모달은
   «.mw.on»이다. 그게 생기고 사라지는 것을 보면 모든 자리가 한 번에 걸린다.

   ── 사람이 ✕로 닫았을 때 ──
   그때도 쌓아 둔 칸을 하나 걷어내야 한다. 안 그러면 칸이 남아서, 나중에 뒤로
   가기를 눌렀을 때 «아무 일도 안 일어나는» 한 번이 생긴다. history.back()으로
   걷어내는데 그게 또 popstate를 부르므로, 우리가 부른 것인지 사람이 누른
   것인지 세어서 가린다 — 안 그러면 한 번에 두 겹이 닫힌다.
═══════════════════════════════════════════════════════════════ */

const SEL = '.mw.on, .dr.on';
const sbOpen = () => !!document.querySelector('.sb.sb-open');
const layers = () => document.querySelectorAll(SEL).length + (sbOpen() ? 1 : 0);

let last = 0;          // 마지막으로 센 겹 수
let owed = 0;          // 우리가 history.back()을 부른 횟수 — 그만큼의 popstate는 우리 것
let syncing = false;   // popstate를 처리하는 중 — 그 안의 변화는 이미 계산에 들어가 있다
const appStack = [];   // 탭을 옮겨 온 자취

/* 맨 위 한 겹을 닫는다.

   닫는 함수는 화면마다 다르지만(closeExhDr·closeContactDr·closeMDBBulkEditModal…)
   닫는 단추는 그 안에 늘 있다. 단추를 누르는 쪽이 화면이 제 정리(임시 입력 비우기
   따위)를 하게 두는 길이라, 요소를 직접 지우는 것보다 안전하다. */
function closeTop(){
  const open = [...document.querySelectorAll(SEL)];
  const el = open[open.length - 1];
  if(!el){ if(sbOpen()) window.closeSb?.(); return; }

  const btn = el.querySelector('.drcls, [onclick*="close"], [onclick*="Close"]');
  if(btn){ btn.click(); return; }
  /* 닫는 단추를 못 찾으면 손으로 치운다 — 모달은 그때그때 만들어졌다 지워지고,
     드로어는 «.on»만 떼면 닫힌다 */
  if(el.classList.contains('mw')) el.remove();
  else el.classList.remove('on');
}

function onChange(){
  if(syncing) return;
  const now = layers();
  if(now > last){
    for(let i = 0; i < now - last; i++) history.pushState({ bloom: 'layer' }, '');
  } else if(now < last){
    /* 사람이 닫았다 — 쌓아 둔 칸을 그만큼 걷어낸다 */
    for(let i = 0; i < last - now; i++){ owed++; history.back(); }
  }
  last = now;
}

export function initBackButton(){
  if(window.__bloomBackReady) return;
  window.__bloomBackReady = true;

  history.replaceState({ bloom: 'root' }, '');
  last = layers();

  new MutationObserver(onChange).observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class'],
  });

  window.addEventListener('popstate', () => {
    if(owed > 0){ owed--; last = layers(); return; }   // 우리가 부른 back

    syncing = true;
    try {
      if(layers() > 0){ closeTop(); }
      else if(appStack.length){
        const prev = appStack.pop();
        window.switchApp?.(prev);
      }
      /* 둘 다 없으면 아무것도 안 한다 — 브라우저가 이미 한 칸 나갔으니
         다음 «뒤로»에 앱을 떠난다. 그게 맞는 동작이다. */
    } finally {
      last = layers();
      syncing = false;
    }
  });

  /* 탭 옮기기도 한 칸으로 센다. router.js가 window.switchApp을 내놓은 뒤에
     감싼다 — 여기서 import하면 router가 이 파일을 import하는 고리가 된다. */
  const orig = window.switchApp;
  if(typeof orig === 'function'){
    window.switchApp = function(app, btn){
      const from = window.curApp || null;
      const r = orig.apply(this, arguments);
      if(!syncing && from && from !== app){
        appStack.push(from);
        history.pushState({ bloom: 'app' }, '');
      }
      return r;
    };
  }
}
