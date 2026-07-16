/* ══════════════════════════════════════════════════════════════
   auth.js — 로그인/세션/로그아웃 (원본 contact_crm.html 4900~5118행,
   5029~5047행 manualSync 포함)
═══════════════════════════════════════════════════════════════ */

import { GS_URL, setGsUrl, ALLOWED_DOMAIN, currentUser, setCurrentUser, userColor } from './state.js';
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
     구글시트(운영 데이터)에 전혀 연결하지 않고 Data/ 폴더의 더미
     엑셀로 화면을 채운다. 실수로 운영 시트에 쓰지 않도록 GS_URL 자체를
     비워서 이후 어떤 저장 동작도 걸리지 않게 막는다. */
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

  function loginLocal(reason){
    const session = {
      email, name, local,
      loginAt: new Date().toISOString(),
      color: userColor(email),
    };
    localStorage.setItem('crm_session', JSON.stringify(session));
    setCurrentUser(session);
    trackAction('login', '로그인', email, '<b>'+name+'</b>님이 로그인했어요'+(reason?(' ('+reason+')'):''));
    btn.disabled = false;
    btn.textContent = '로그인';
    errEl.classList.remove('on');
    initAfterLogin();
  }

  if(!GS_URL){
    loginLocal('오프라인');
    return;
  }

  const fetchWithTimeout = (url, ms=8000) => Promise.race([
    fetch(url, { redirect: 'follow' }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);

  fetchWithTimeout(GS_URL + '?sheet=login&email=' + encodeURIComponent(email) + '&token=' + encodeURIComponent(pw))
    .then(r => {
      if(!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(data => {
      if(data && data.error === 'Unauthorized'){
        showLoginErr('이메일 또는 비밀번호가 올바르지 않아요');
        return;
      }
      if(!data || data.ok !== true){
        showLoginErr('이메일 또는 비밀번호가 올바르지 않아요');
        return;
      }
      const session = {
        email, name, local,
        loginAt: new Date().toISOString(),
        color: userColor(email),
      };
      localStorage.setItem('crm_session', JSON.stringify(session));
      setCurrentUser(session);
      trackAction('login', '로그인', email, '<b>'+name+'</b>님이 로그인했어요');
      btn.disabled = false;
      btn.textContent = '로그인';
      errEl.classList.remove('on');
      initAfterLogin();
    })
    .catch(err => {
      console.warn('Login fetch failed, falling back to local login:', err);
      loginLocal('오프라인');
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
  trackAction('login', '로그아웃', currentUser.email, `${currentUser.name}님이 로그아웃했어요`);
  localStorage.removeItem('crm_session');
  setCurrentUser(null);
  closeUserMenu();
  location.reload();
}

export function checkSession(){
  const s = localStorage.getItem('crm_session');
  if(!s) return false;
  try{
    const session = JSON.parse(s);
    if(!session.email || !session.email.endsWith(ALLOWED_DOMAIN)) return false;
    setCurrentUser(session);
    return true;
  }catch(e){ return false; }
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

  const ume = document.getElementById('um-email');
  const ums = document.getElementById('um-since');
  if(ume) ume.textContent = currentUser.email;
  if(ums) ums.textContent = '로그인: ' + new Date(currentUser.loginAt).toLocaleString('ko-KR');

  setTimeout(()=>{
    try { buildMDBEvList(); } catch(e){ console.warn('buildMDBEvList:', e); }
    try { renderMDB(); }      catch(e){ console.warn('renderMDB:', e); }
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
      // 구글시트에서 최신 데이터 로드 (백그라운드)
      loadFromSheets(sheetsHooks);
    }
  }, 350);
}

/* ══ 로컬 테스트 로그인 (test/test/test) ══ */
async function startTestSession(){
  setGsUrl(''); // 이 세션 동안 모든 구글시트 읽기/쓰기 원천 차단
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
  document.getElementById('user-menu').classList.toggle('on');
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
