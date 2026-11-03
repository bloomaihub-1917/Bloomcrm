/* ══════════════════════════════════════════════════════════════
   app.js — 부트스트랩 (원본 6698~6709행 INIT 섹션)

   각 tab 모듈을 import하는 것 자체가 그 모듈 파일 하단의
   `window.함수명 = 함수명` 등록을 실행시키는 부수효과를 낸다 —
   그래서 HTML의 인라인 onclick="..."들이 이 스크립트 로드 이후
   정상적으로 동작한다. <script type="module">은 DOM 파싱이 끝난
   뒤 실행되므로 DOMContentLoaded로 감싸지 않아도 안전하다.
═══════════════════════════════════════════════════════════════ */

import './modules/db-tab.js';
import './features/mdb/mdb-bulk.js';   // 마스터DB 선택 → 초청·일괄 고치기·지우기 — 스스로 window에 건다
import './features/mdb/mdb-views.js';   // 마스터DB 목록·카드·묶음·표 보기 — 스스로 window에 건다
import './features/mdb/mdb-drag.js';   // 소속 기업·섹터·드래그로 분류 — 스스로 window에 건다
import './features/mdb/contact-drawer.js';   // 연락처 상세 창 — 스스로 window에 건다
import './modules/upload-tab.js';
import './features/upload/upload-read.js';   // 업로드 STEP 1 — 파일 읽기와 파일명으로 카테고리 짐작 — 스스로 window에 건다
import './features/upload/upload-save.js';   // 업로드 STEP 4 — 의심 케이스 확인과 마스터DB 반영 — 스스로 window에 건다
import './features/upload/upload-logs.js';   // 업로드 › 수집 로그·기업 병합 관리 하위 탭 — 스스로 window에 건다
import './modules/settings-tab.js';
import './features/settings/sector-tree.js';   // 섹터 트리·병합·묶기·편입 — 스스로 window에 건다
import './features/settings/taxonomy.js';   // 분야·연락처 태그·참가 유형 관리 — 스스로 window에 건다
import './features/settings/event-admin.js';   // 행사 관리 — 스스로 window에 건다
import './features/settings/code-lists.js';   // 선택 목록·부스 기본 제공·업로드 표기·행사별 설정 요약 — 스스로 window에 건다
import './features/settings/sector-add-main.js';   // 설정 › 새 메인 섹터 추가 — 스스로 window에 건다
import './features/settings/sector-import.js';   // 설정 › 엑셀로 섹터 일괄 추가 — 스스로 window에 건다
import './features/settings/equip-catalog.js';   // 설정 › 비품 목록 (equip_catalog) — 스스로 window에 건다
import './features/settings/event-detail.js';   // 설정 › 행사 관리 › 행사 상세 — 스스로 window에 건다
import './features/settings/conf-settings.js';   // 설정 › 행사 상세 › 컨퍼런스 설정 — 스스로 window에 건다
import './modules/data-clean.js';
import './modules/company-tab.js';
import './features/companies/co-detail.js';   // 기업 상세 화면 — 스스로 window에 건다
import './features/companies/co-edit.js';   // 기업 필드 고치기·분야와 섹터·드래그 — 스스로 window에 건다
import './features/companies/co-trade.js';   // 기업 상세 하위 탭 — 참여 이력·담당자·요약·거래 — 스스로 window에 건다
import './features/companies/merge.js';   // 비슷한 기업 찾기와 기업 병합 — 스스로 window에 건다
import './features/companies/add-co-event.js';   // 기업 화면에서 행사 참여 이력 직접 추가 — 스스로 window에 건다
import './modules/crm-tab.js';
import './modules/audit-tab.js';
import './modules/exh-tab.js';
import './features/exhibition/exh-book.js';   // 도록 순번·기본 제공·그래픽 발주 — 스스로 window에 건다
import './features/exhibition/exh-item-views.js';   // 금액·비품·그래픽 현황 보기 — 스스로 window에 건다
import './features/exhibition/exh-dashboard.js';   // 전시 대시보드 — 스스로 window에 건다
import './features/exhibition/exh-add.js';   // 참가기업 직접 추가·불러오기 — 스스로 window에 건다
import './modules/exh-drawer.js';
import './features/exhibition/exh-remove.js';   // 참가기업 지우기 — 딸린 것까지 함께 — 스스로 window에 건다
import './features/exhibition/exh-dr-graphic.js';   // 참가기업 상세 › 그래픽 피드백·그래픽 항목·부스 기본 제공 예외 — 스스로 window에 건다
import './features/exhibition/exh-dr-logs.js';   // 참가기업 상세 › 문의·기록 — 스스로 window에 건다
import './features/exhibition/exh-dr-mail.js';   // 참가기업 상세 › 메일 — 담당자에게 바로 보내기 — 스스로 window에 건다
import './modules/exh-export.js';
import './modules/speaker-export.js';
import './modules/exh-invoice.js';
import './modules/event-tab.js';
import './modules/register-links.js';
import './modules/conf-tab.js';
import './features/conference/conf-program.js';   // 프로그램 — 일자·세션·배정 — 스스로 window에 건다
import './features/conference/conf-pga.js';   // 프로그램표(PROGRAM AT A GLANCE) — 스스로 window에 건다
import './features/conference/conf-people.js';   // 연사 보기 — 준비·정산·카드 — 스스로 window에 건다
import './features/conference/conf-upload.js';   // 연사·세션 엑셀로 올리기 — 스스로 window에 건다
import './modules/speaker-drawer.js';
import './features/conference/sp-dr-basic.js';   // 연사 기본·이력·발제 — 스스로 window에 건다
import './features/conference/sp-dr-mail.js';   // 연사 연락 상대·메일·기록 — 스스로 window에 건다
import './features/conference/sp-dr-bank.js';   // 연사 계좌·여권 — 스스로 window에 건다

import { initMobileNav, initDrawerSwipe, initSidebarLayout, initDrawerResize } from './router.js';
import { initBackButton } from './back-button.js';
import { initOverlayNav } from './overlay-nav.js';
import { initTableSort } from './table-sort.js';
import { initAuth, initAfterLogin, closeUserMenu } from './auth.js';
import { isMobile } from './utils.js';
import { buildCoCAT } from './modules/company-tab.js';
import { buildCoDB } from './domain/co-db.js';
import { buildEvFil } from './modules/crm-tab.js';
import { populateUploadEvDropdown } from './features/upload/upload-event-select.js';

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
initTableSort();   // 표 머리 클릭 정렬 — 문서에 한 번만 건다
initMobileNav();
initDrawerSwipe();
initSidebarLayout();
initDrawerResize();
/* router.js가 window.switchApp을 내놓은 뒤에 부른다 — 그걸 감싸야
   탭 옮기기도 «뒤로»가 되돌릴 한 칸이 된다 */
initBackButton();

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
    try { window.renderPtn?.();  } catch(e){ console.warn('[resize] 파트너링 재렌더 실패', e); }
  }, 150);
});
