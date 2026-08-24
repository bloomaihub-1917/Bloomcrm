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

import { initMobileNav, initDrawerSwipe, initSidebarLayout } from './router.js';
import { initAuth, initAfterLogin, closeUserMenu } from './auth.js';
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

// 화면 아무 곳이나 클릭하면 사용자 메뉴 닫기 (원본 5118행)
document.addEventListener('click', () => closeUserMenu());
