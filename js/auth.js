/* ══════════════════════════════════════════════════════════════
   auth.js — 로그인/세션/로그아웃 (원본 contact_crm.html 4900~5118행,
   5029~5047행 manualSync 포함)
═══════════════════════════════════════════════════════════════ */

import { API_BASE_URL, setApiBaseUrl, ALLOWED_DOMAIN, currentUser, setCurrentUser, setAuthToken, userColor } from './state.js';
import { auth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from './firebase.js';
import { userInitials } from './utils.js';
import { loadFromSheets, loadSectors } from './api.js';
import { loadTestData } from './testdata.js';
import { trackAction, buildAuditUserList, renderAudit } from './modules/audit-tab.js';
import { buildMDBEvList, renderMDB } from './modules/db-tab.js';
import { renderCoList, buildCoCAT, buildCoDB } from './modules/company-tab.js';
import { buildEvFil, updBadges } from './modules/crm-tab.js';
import { populateUploadEvDropdown } from './modules/upload-tab.js';

/* api.js의 loadFromSheets(hooks)에 넘길 화면 갱신 훅 묶음 —
   원본에서 loadFromSheets() 종료 시 호출하던 함수들과 동일 */
const sheetsHooks = {
  buildMDBEvList, renderMDB,
  buildEvFil, updBadges,
  populateUploadEvDropdown,
  buildCoDB, buildCoCAT,
  buildAuditUserList, renderCoList, renderAudit,
};

export function loginEmailInput(){
  // 원본도 빈 함수 — @ 앞부분만 입력받는 표시용(suffix 고정), 실제 로직 없음
}

export function showLoginErr(msg){
  const el = document.getElementById('login-err');
  el.textContent = msg;
  el.classList.add('on');
  document.getElementById('login-btn').disabled = false;
  document.getElementById('login-btn').textContent = '로그인';
}

/* 로그인 폼의 "이름"은 Firebase 계정 정보와 무관한 자유 텍스트(표시용)다.
   signInWithEmailAndPassword가 성공하면 onAuthStateChanged 옵저버가 실제
   세션 구성과 화면 전환(initAfterLogin)을 처리하므로, 그 시점에 이름을
   반영할 수 있게 잠깐 보관해둔다. */
let pendingLoginName = '';

export function doLogin(){
  const nameEl  = document.getElementById('login-name');
  const localEl = document.getElementById('login-email-local');
  const pwEl    = document.getElementById('login-pw');
  const errEl   = document.getElementById('login-err');
  const btn     = document.getElementById('login-btn');

  const name  = nameEl.value.trim();
  const local = localEl.value.trim().toLowerCase().replace(/@.*$/,'');
  const pw    = pwEl.value;

  if(!name){ showLoginErr('이름을 입력해주세요'); nameEl.focus(); return; }
  if(!local){ showLoginErr('이메일을 입력해주세요'); localEl.focus(); return; }
  if(!pw){ showLoginErr('비밀번호를 입력해주세요'); pwEl.focus(); return; }

  /* 로컬 테스트 로그인: 이름/이메일/비밀번호를 전부 "test"로 입력하면
     Firebase/백엔드에 전혀 연결하지 않고 Data/ 폴더의 더미 엑셀로 화면을
     채운다. 실수로 운영 데이터에 쓰지 않도록 API_BASE_URL 자체를 비워서
     이후 어떤 저장 동작도 걸리지 않게 막는다. */
  if(name.toLowerCase()==='test' && local==='test' && pw==='test'){
    btn.disabled = true;
    btn.textContent = '테스트 데이터 불러오는 중…';
    startTestSession().then(() => {
      btn.disabled = false;
      btn.textContent = '로그인';
      errEl.classList.remove('on');
    });
    return;
  }

  const email = local + ALLOWED_DOMAIN;

  if(!email.endsWith(ALLOWED_DOMAIN)){
    showLoginErr('@13100m.net 계정만 사용할 수 있어요');
    return;
  }

  btn.disabled = true;
  btn.textContent = '확인 중…';
  errEl.classList.remove('on');
  pendingLoginName = name;

  /* 계정/비밀번호 검증은 전부 Firebase Auth가 처리한다 — 커스텀 토큰
     발급/검증 로직이 사라졌고, 계정 추가/삭제는 Firebase 콘솔이나
     scripts/create-user.js로 한다(더 이상 Apps Script 스크립트 속성을
     손으로 고칠 필요 없음). 로그인 성공 시 화면 전환은 onAuthStateChanged
     옵저버(initAuth)가 담당한다. */
  signInWithEmailAndPassword(auth, email, pw)
    .then(() => {
      btn.disabled = false;
      btn.textContent = '로그인';
      errEl.classList.remove('on');
    })
    .catch(err => {
      console.warn('Login failed:', err);
      pendingLoginName = '';
      btn.disabled = false;
      btn.textContent = '로그인';
      showLoginErr('이메일 또는 비밀번호가 올바르지 않아요');
    });
}

export async function manualSync(){
  const btn = document.getElementById('sync-btn');
  if(btn){ btn.disabled = true; btn.textContent = '동기화 중…'; }
  try {
    await loadFromSheets(sheetsHooks);
    try { renderMDB(); buildMDBEvList(); } catch(e){}
    try { buildCoDB(); buildCoCAT(); } catch(e){}
    try { renderCoList(); } catch(e){}
    console.log('[CRM] 수동 동기화 완료');
  } catch(e) {
    console.error('[CRM] 동기화 실패:', e);
  } finally {
    if(btn){
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>동기화';
    }
  }
}

export function doLogout(){
  if(!confirm('로그아웃할까요?')) return;
  if(currentUser){ // 세션 만료 후 클릭 시 null 접근 방지
    trackAction('login', '로그아웃', currentUser.email, `${currentUser.name}님이 로그아웃했어요`);
  }
  closeUserMenu();
  // 테스트 모드는 Firebase 세션이 없으므로 signOut 없이 바로 정리
  if(!auth.currentUser){
    localStorage.removeItem('crm_session');
    setCurrentUser(null);
    setAuthToken('');
    location.reload();
    return;
  }
  signOut(auth).finally(() => location.reload()); // onAuthStateChanged가 세션 정리를 처리
}

/* ══ 로그인 상태 옵저버 (신규 — 과거 checkSession()을 대체) ══
   Firebase Auth가 로그인 상태를 브라우저에 자체적으로 영속시키므로,
   localStorage.crm_session은 이제 "표시용 캐시"일 뿐 신뢰 주체가 아니다.
   앱 부팅 시 1회, 그리고 로그인/로그아웃이 일어날 때마다 이 콜백이 불린다. */
export function initAuth(onResolved){
  onAuthStateChanged(auth, (user) => {
    if(user){
      const cached = (() => {
        try { return JSON.parse(localStorage.getItem('crm_session') || 'null'); } catch(e){ return null; }
      })();
      const name = pendingLoginName || (cached && cached.email === user.email ? cached.name : null)
        || user.displayName || user.email.split('@')[0];
      pendingLoginName = '';
      const session = {
        email: user.email, name, local: user.email.split('@')[0],
        loginAt: (cached && cached.email === user.email) ? cached.loginAt : new Date().toISOString(),
        color: userColor(user.email),
      };
      localStorage.setItem('crm_session', JSON.stringify(session));
      setCurrentUser(session);
      onResolved(true);
    } else {
      localStorage.removeItem('crm_session');
      setCurrentUser(null);
      setAuthToken('');
      onResolved(false);
    }
  });
}

export function initAfterLogin(testMode){
  const ls = document.getElementById('login-screen');
  if(ls){
    ls.style.opacity='0';
    ls.style.transition='opacity .25s';
    setTimeout(()=>{ ls.style.display='none'; }, 260);
  }

  const chip = document.getElementById('user-chip');
  const av   = document.getElementById('user-av');
  const nm   = document.getElementById('user-name-chip');
  if(chip) chip.style.display='flex';
  if(av){  av.style.background = currentUser.color; av.textContent = userInitials(currentUser.name); }
  if(nm)   nm.textContent = currentUser.name;

  // 사이드바 계정 블록 — 모든 탭·모바일에서 닿는 유일한 경로다
  const acct = document.getElementById('sb-acct');
  if(acct) acct.style.display='flex';
  const aav = document.getElementById('sb-acct-av');
  if(aav){ aav.style.background = currentUser.color; aav.textContent = userInitials(currentUser.name); }
  const anm = document.getElementById('sb-acct-nm');
  if(anm) anm.textContent = currentUser.name;
  const aem = document.getElementById('sb-acct-em');
  if(aem) aem.textContent = currentUser.email;

  const ume = document.getElementById('um-email');
  const ums = document.getElementById('um-since');
  if(ume) ume.textContent = currentUser.email;
  if(ums) ums.textContent = '로그인: ' + new Date(currentUser.loginAt).toLocaleString('ko-KR');

  setTimeout(()=>{
    try { buildMDBEvList(); } catch(e){ console.warn('buildMDBEvList:', e); }
    try { renderMDB(); }      catch(e){ console.warn('renderMDB:', e); }
    // buildCoDB가 여기서 안 돌면 기업DB 탭을 한 번도 안 열어본 상태에서는
    // CO_DB가 비어있어서, MDB 일괄변경 모달의 기업명 자동완성(datalist)이
    // 빈 채로 뜨는 문제가 있었다 — renderCoList/buildCoCAT보다 먼저 호출해
    // 그 둘이 최신 CO_DB를 참조하게 한다.
    try { buildCoDB(); }       catch(e){ console.warn('buildCoDB:', e); }
    try { renderCoList(); }   catch(e){ console.warn('renderCoList:', e); }
    if(!testMode){ try { loadSectors(); } catch(e){ console.warn('loadSectors:', e); } }
    try { buildCoCAT(); }              catch(e){ console.warn('buildCoCAT:', e); }
    try { buildEvFil(); }              catch(e){ console.warn('buildEvFil:', e); }
    try { populateUploadEvDropdown(); } catch(e){ console.warn('populateUploadEvDropdown:', e); }
    try { updBadges(); }      catch(e){ console.warn('updBadges:', e); }
    try { buildAuditUserList(); } catch(e){ console.warn('buildAuditUserList:', e); }

    if(testMode){
      showTestModeBanner();
    } else {
      // 백엔드에서 최신 데이터 로드 (백그라운드)
      loadFromSheets(sheetsHooks);
    }
  }, 350);
}

/* ══ 로컬 테스트 로그인 (test/test/test) ══ */
async function startTestSession(){
  setApiBaseUrl(''); // 이 세션 동안 모든 백엔드 읽기/쓰기 원천 차단
  const session = {
    email: 'test@13100m.net', name: '테스트 사용자', local: 'test',
    loginAt: new Date().toISOString(), color: userColor('test'),
  };
  setCurrentUser(session);
  await loadTestData();
  initAfterLogin(true);
}

function showTestModeBanner(){
  const el = document.getElementById('test-mode-banner');
  if(el) el.style.display = 'flex';
}

export function toggleUserMenu(e){
  e.stopPropagation();
  const menu = document.getElementById('user-menu');
  if(!menu) return;
  const willOpen = !menu.classList.contains('on');
  menu.classList.toggle('on');
  if(!willOpen) return;

  /* 메뉴는 원래 툴바 오른쪽 위에 고정돼 있었다. 이제 사이드바 바닥에서도 열리므로
     누른 자리를 기준으로 놓는다 — 화면 밖으로 나가지 않게 가장자리에서 접어준다. */
  const trigger = e.currentTarget;
  if(!(trigger instanceof Element)) return;
  const r = trigger.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.right = 'auto';
  const w = menu.offsetWidth || 200, h = menu.offsetHeight || 120;
  const left = Math.min(r.left, window.innerWidth - w - 8);
  // 아래 공간이 모자라면 트리거 위로 띄운다(사이드바 바닥에서 누른 경우)
  const below = window.innerHeight - r.bottom;
  const top = below >= h + 8 ? r.bottom + 6 : Math.max(8, r.top - h - 6);
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top  = top + 'px';
}
export function closeUserMenu(){
  document.getElementById('user-menu').classList.remove('on');
}

window.doLogin = doLogin;
window.doLogout = doLogout;
window.loginEmailInput = loginEmailInput;
window.toggleUserMenu = toggleUserMenu;
window.closeUserMenu = closeUserMenu;
window.manualSync = manualSync;
window.loadFromSheets = () => loadFromSheets(sheetsHooks);
