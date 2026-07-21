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

window.switchApp = switchApp;
window.switchCrmV = switchCrmV;
window.toggleSb = toggleSb;
window.closeSb = closeSb;
window.updateMobNav = updateMobNav;
window.toggleSidebarCollapse = toggleSidebarCollapse;
