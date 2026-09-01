/* ══════════════════════════════════════════════════════════════
   app.js — 부트스트랩 (원본 6698~6709행 INIT 섹션)

   각 tab 모듈을 import하는 것 자체가 그 모듈 파일 하단의
   `window.함수명 = 함수명` 등록을 실행시키는 부수효과를 낸다 —
   그래서 HTML의 인라인 onclick="..."들이 이 스크립트 로드 이후
   정상적으로 동작한다. <script type="module">은 DOM 파싱이 끝난
   뒤 실행되므로 DOMContentLoaded로 감싸지 않아도 안전하다.
═══════════════════════════════════════════════════════════════ */

import './modules/db-tab.js';
import './modules/upload-tab.js';
import './modules/settings-tab.js';
import './modules/company-tab.js';
import './modules/crm-tab.js';
import './modules/audit-tab.js';
import './modules/exh-tab.js';
import './modules/exh-drawer.js';
import './modules/exh-export.js';

import { initMobileNav, initDrawerSwipe, initSidebarLayout, initDrawerResize } from './router.js';
import { initOverlayNav } from './overlay-nav.js';
import { initAuth, initAfterLogin, closeUserMenu } from './auth.js';
import { isMobile } from './utils.js';
import { buildCoDB, buildCoCAT } from './modules/company-tab.js';
import { buildEvFil } from './modules/crm-tab.js';
import { populateUploadEvDropdown } from './modules/upload-tab.js';

/* INIT — Firebase Auth의 onAuthStateChanged는 비동기라, 과거 동기
   checkSession() 분기 대신 콜백으로 로그인 여부에 따라 화면을 정한다
   (auth.js:initAuth 참고). */
initAuth((loggedIn) => {
  if(loggedIn){
    initAfterLogin();
  } else {
    const ls = document.getElementById('login-screen');
    if(ls) ls.style.display = 'flex';
  }
});
// 로그인 여부와 무관하게 항상 초기화되는 부분(원본 6708행)
buildCoDB(); buildCoCAT(); buildEvFil(); populateUploadEvDropdown();

// 모바일 하단 네비 초기 상태 + 드로어 스와이프-닫기 (원본 6683~6696행)
initMobileNav();
initDrawerSwipe();
initSidebarLayout();
initDrawerResize();

// 뒤로가기로 드로어·모달·사이드바를 닫는다 (앱을 벗어나지 않게).
// 각 탭 모듈이 window에 함수를 등록한 뒤에 감싸야 하므로 import 이후에 호출한다.
initOverlayNav();

// 화면 아무 곳이나 클릭하면 사용자 메뉴 닫기 (원본 5118행)
document.addEventListener('click', () => closeUserMenu());

/* 모바일/데스크톱 경계(768px)를 넘나들 때 다시 그린다.
   마스터DB와 전시 탭은 폭에 따라 표와 카드로 다르게 그리는데, 렌더는 화면이
   그려질 때 한 번만 판단한다. 그래서 폰을 가로로 눕히거나 창을 넓히면 좁은
   화면용 카드가 넓은 화면에 그대로 남아 있었다. 경계를 실제로 넘었을 때만
   다시 그려서, 스크롤 중 주소창이 접히며 생기는 잦은 resize는 무시한다. */
let wasMobile = isMobile();
let resizeTimer = null;
window.addEventListener('resize', () => {
  const now = isMobile();
  if(now === wasMobile) return;
  wasMobile = now;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    try { window.renderMDB?.(); } catch(e){ console.warn('[resize] MDB 재렌더 실패', e); }
    try { window.renderExh?.();  } catch(e){ console.warn('[resize] 전시 재렌더 실패', e); }
  }, 150);
});
