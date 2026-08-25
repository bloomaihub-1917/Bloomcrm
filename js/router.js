/* ══════════════════════════════════════════════════════════════
   router.js — 탭 전환(switchApp) + 모바일 사이드바/스와이프 유틸
   (원본 contact_crm.html 6627~6696행에서 정리, 로직 동일)
═══════════════════════════════════════════════════════════════ */

import { setCurApp } from './state.js';
import { isMobile } from './utils.js';
import { buildEvFil, renderCrm, closeDr, switchCV } from './modules/crm-tab.js';
import { buildCoDB, showCoDashboard } from './modules/company-tab.js';
import { buildMDBEvList, renderMDB } from './modules/db-tab.js';
import { buildAuditUserList, renderAudit } from './modules/audit-tab.js';
import { switchArchTab } from './modules/settings-tab.js';
import { populateUploadEvDropdown } from './modules/upload-tab.js';
import { buildExhEvList, renderExh } from './modules/exh-tab.js';

export function switchApp(app, btn){
  setCurApp(app);
  document.querySelectorAll('.atab').forEach(b => b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  else {
    document.querySelectorAll('.atab').forEach(b => {
      const oc = b.getAttribute('onclick')||'';
      if(oc.includes("'"+app+"'")) b.classList.add('on');
    });
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  const pg = document.getElementById('page-'+app);
  if(pg) pg.classList.add('on');
  document.querySelectorAll('.sbp').forEach(p => p.classList.remove('on'));
  const sbp = document.getElementById('sbp-'+app);
  if(sbp) sbp.classList.add('on');
  if(app==='crm')    { buildEvFil(); renderCrm(); }
  if(app==='exh')    { buildExhEvList(); renderExh(); }
  if(app==='co')     { buildCoDB(); showCoDashboard(); }
  if(app==='mdb')    { buildMDBEvList(); renderMDB(); }
  if(app==='audit')  { buildAuditUserList(); renderAudit(); }
  if(app==='arch')   { switchArchTab('ev'); }
  if(app==='up')     populateUploadEvDropdown();
  if(isMobile()){
    updateMobNav(app);
    closeSb();
  }
}

/* switchCrmV — 원본 6655행, CRM 뷰 전환의 별칭(호환용) */
export function switchCrmV(v, btn){
  switchCV(v, btn);
}

/* ── 모바일 유틸 (원본 6658~6696행) ── */
export function toggleSb(){
  const sb = document.getElementById('sb') || document.querySelector('.sb');
  const bd = document.getElementById('sb-bd');
  sb.classList.toggle('sb-open');
  bd.classList.toggle('on');
}
export function closeSb(){
  const sb = document.querySelector('.sb');
  const bd = document.getElementById('sb-bd');
  sb.classList.remove('sb-open');
  bd.classList.remove('on');
}
export function updateMobNav(app){
  document.querySelectorAll('.mob-nav-btn').forEach(b=>b.classList.remove('on'));
  const el = document.getElementById('mn-'+app);
  if(el) el.classList.add('on');
  document.querySelectorAll('.mob-header').forEach(h=>h.style.display='none');
  const mh = document.getElementById('mob-h-'+app);
  if(mh) mh.style.display='flex';
}

/* 모바일 초기 진입 시 하단 네비 표시 상태 맞추기 */
export function initMobileNav(){
  if(isMobile()) updateMobNav('mdb');
}

/* 드로어를 아래로 스와이프하면 닫기 (모바일, 원본 6687~6696행) */
export function initDrawerSwipe(){
  let sy = 0;
  const dr = document.querySelector('.dr') || document.getElementById('dr');
  if(!dr) return;
  dr.addEventListener('touchstart', e=>{ sy = e.touches[0].clientY; }, {passive:true});
  dr.addEventListener('touchend', e=>{
    const dy = e.changedTouches[0].clientY - sy;
    if(dy > 60 && isMobile()) closeDr();
  }, {passive:true});
}

/* ══════════════════════════════════════════
   사이드바 리사이즈(드래그) + 접기/펼치기 (신규, 데스크톱 전용)
   너비/접힘 상태는 localStorage에 저장해 새로고침 후에도 유지된다.
══════════════════════════════════════════ */
const SB_WIDTH_KEY = 'crm_sb_width';
const SB_COLLAPSED_KEY = 'crm_sb_collapsed';
const SB_MIN_W = 160, SB_MAX_W = 480;

export function toggleSidebarCollapse(){
  const sb = document.getElementById('sb');
  const expandBtn = document.getElementById('sb-expand-btn');
  if(!sb || isMobile()) return;
  const willCollapse = !sb.classList.contains('collapsed');
  sb.classList.toggle('collapsed', willCollapse);
  if(expandBtn) expandBtn.classList.toggle('on', willCollapse);
  localStorage.setItem(SB_COLLAPSED_KEY, willCollapse ? '1' : '0');
}

export function initSidebarLayout(){
  const sb = document.getElementById('sb');
  const handle = document.getElementById('sb-resize');
  const expandBtn = document.getElementById('sb-expand-btn');
  if(!sb || isMobile()) return;

  // 저장된 너비/접힘 상태 복원
  const savedW = parseInt(localStorage.getItem(SB_WIDTH_KEY), 10);
  if(savedW && savedW >= SB_MIN_W && savedW <= SB_MAX_W) sb.style.width = savedW + 'px';
  if(localStorage.getItem(SB_COLLAPSED_KEY) === '1'){
    sb.classList.add('collapsed');
    if(expandBtn) expandBtn.classList.add('on');
  }
  if(!handle) return;

  let dragging = false;
  handle.addEventListener('mousedown', e => {
    if(sb.classList.contains('collapsed')) return;
    dragging = true;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if(!dragging) return;
    const rect = sb.getBoundingClientRect();
    const w = Math.max(SB_MIN_W, Math.min(SB_MAX_W, e.clientX - rect.left));
    sb.style.width = w + 'px';
  });
  document.addEventListener('mouseup', () => {
    if(!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    localStorage.setItem(SB_WIDTH_KEY, parseInt(sb.style.width, 10));
  });
}

/* ══════════════════════════════════════════
   드로어 너비 — 데스크톱

   468px 고정이었다. 연락처 드로어에는 충분했지만, 전시 참가기업 드로어의 정산
   탭에는 금액 항목·인보이스·입금이 각각 여러 줄로 들어가서(항목명/수량/단가/
   금액/통화) 한 줄이 접히고 버튼이 밀렸다. 관리 화면인데 읽기도 고치기도 불편했다.

   기본값을 넓히고, 사이드바와 같은 방식으로 가장자리를 끌어 조절할 수 있게 한다.
   조절한 너비는 기억한다 — 매번 다시 끌어야 하면 안 하느니만 못하다.
══════════════════════════════════════════ */
const DR_WIDTH_KEY = 'crm_dr_width';
const DR_MIN_W = 380;
/* 화면 대부분을 덮으면 뒤의 목록에서 맥락을 잃는다 — 목록이 최소 360px는 남게 한다 */
const drMaxW = () => Math.max(DR_MIN_W, window.innerWidth - 360);
/* 기본값은 넓게 잡되 좁은 노트북에서도 목록이 남도록 화면에 맞춰 줄인다 */
const drDefaultW = () => Math.min(680, drMaxW());

export function applyDrawerWidth(){
  if(isMobile()) return;   // 모바일은 전체 너비 + 바텀시트라 이 값과 무관하다
  const saved = parseInt(localStorage.getItem(DR_WIDTH_KEY), 10);
  const w = Math.max(DR_MIN_W, Math.min(drMaxW(), saved || drDefaultW()));
  document.documentElement.style.setProperty('--dr-w', w + 'px');
}

export function initDrawerResize(){
  applyDrawerWidth();
  // 창을 줄이면 드로어가 화면을 넘어설 수 있어 경계를 다시 잡는다
  window.addEventListener('resize', applyDrawerWidth);
  if(isMobile()) return;

  document.querySelectorAll('.dr').forEach(dr => {
    if(dr.querySelector('.dr-resize')) return;
    const handle = document.createElement('div');
    handle.className = 'dr-resize';
    handle.title = '드래그해서 너비 조절 (더블클릭하면 기본값)';
    dr.appendChild(handle);

    let dragging = false;
    handle.addEventListener('mousedown', e => {
      dragging = true;
      handle.classList.add('dragging');
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    // 드로어는 오른쪽에 붙어 있으므로 왼쪽 가장자리를 끌면 너비가 반대로 움직인다
    document.addEventListener('mousemove', e => {
      if(!dragging) return;
      const w = Math.max(DR_MIN_W, Math.min(drMaxW(), window.innerWidth - e.clientX));
      document.documentElement.style.setProperty('--dr-w', w + 'px');
    });
    document.addEventListener('mouseup', () => {
      if(!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.userSelect = '';
      const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--dr-w'), 10);
      if(w) localStorage.setItem(DR_WIDTH_KEY, w);
    });
    handle.addEventListener('dblclick', () => {
      localStorage.removeItem(DR_WIDTH_KEY);
      applyDrawerWidth();
    });
  });
}

window.switchApp = switchApp;
window.switchCrmV = switchCrmV;
window.toggleSb = toggleSb;
window.closeSb = closeSb;
window.updateMobNav = updateMobNav;
window.toggleSidebarCollapse = toggleSidebarCollapse;
