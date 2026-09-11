/* ══════════════════════════════════════════════════════════════
   audit-tab.js — 활동 로그(감사 로그) 탭
   (원본 contact_crm.html 5120~5359행대 + HTML 마크업 1483~1510행에서 정리)

   담당 범위
   - trackAction        : 모든 쓰기 액션이 집결하는 공용 로깅 함수.
                           다른 탭 모듈(crm-tab.js 등)이 상태 변경/추가
                           동작 시 이 함수를 호출한다. (반드시 export)
   - getAuditFiltered   : 검색어/유형/사용자 필터가 적용된 로그 목록
   - renderAudit        : #audit-list 렌더 (api.js의 loadFromSheets 훅,
                           반드시 export)
   - buildAuditUserList : 사용자 드롭다운/사이드바 목록 생성 (api.js의
                           loadFromSheets 훅, 반드시 export)
   - filterAudit / setAuditUser / updateAuditBadges / exportAuditCSV
     — 원본 HTML의 인라인 onclick/oninput 핸들러 대상 (window 노출)

   범위 밖: chgStD/setStg/addLog/addTarget/chgSt를 감싸 trackAction을
   호출하던 원본의 "래핑" 코드(원본 5147~5202행)는 CRM 타겟 관련 로직이라
   crm-tab.js가 담당한다. crm-tab.js는 이 파일의 trackAction을 import해서
   자신의 함수 안에서 직접 호출하는 방식으로 옮겨진다.
═══════════════════════════════════════════════════════════════ */

import {
  auditLog,
  currentUser,
  curApp,
  auditFilter,
  auditUserFilter,
  setAuditFilter,
  setAuditUserFilter,
  userColor,
} from '../state.js';
import { saveAuditToSheets } from '../api.js';
import { td, escapeHtml, escAttr, userInitials } from '../utils.js';

/* ══════════════════════════════════════════
   CSV 인젝션 방지 헬퍼 (신규 — 원본에는 없던 보안 개선)
   값이 =, +, -, @ 로 시작하면 스프레드시트 프로그램(Excel 등)이
   수식으로 실행할 수 있어, 앞에 작은따옴표를 붙여 문자열로 강제한다.
   (Twenty CRM의 utils/csv-security/sanitizeValueForCSVExport.ts 벤치마킹)
══════════════════════════════════════════ */
export function sanitizeForCsv(value){
  const s = (value == null) ? '' : String(value);
  if(/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

/* ══ ACTION TRACKING ══
   모든 쓰기 액션이 여기로 집결.
   Apps Script 연동 시 이 함수만 수정하면 됨.
   (원본 5120~5145행)
*/
/* extra는 "이 기록이 가리키는 곳"이다 — { kind, id, ev, tab, field }.
   kind/id가 있으면 로그 줄을 눌러 그 창을 열 수 있고, field가 있으면 창을
   연 뒤 그 칸을 잠깐 물들인다. 대상이 없는 기록(로그인, 일괄 작업처럼 창
   하나로 좁혀지지 않는 것)은 extra를 비워 둔다 — 눌러도 갈 곳이 없는 줄을
   누를 수 있게 해 두면 매번 헛손질을 하게 된다. */
export function trackAction(type, action, target, detail, extra){
  if(!currentUser) return;
  const entry = {
    id: Date.now(),
    ts: new Date().toISOString(),
    email: currentUser.email,
    name: currentUser.name,
    color: currentUser.color,
    type,      // 'status'|'log'|'add'|'stage'|'login'
    action,    // 사람이 읽는 액션명
    target,    // 기업명 or 이메일
    detail,    // 상세 설명
    extra: extra||null,
  };
  auditLog.unshift(entry);

  // 배지 업데이트
  updateAuditBadges();

  // Apps Script 저장
  saveAuditToSheets(entry);
}

/* ══ AUDIT RENDER ══ (원본 5204~5213행) */
const TAG_MAP = {
  status: '<span class="audit-tag at-status">상태 변경</span>',
  log:    '<span class="audit-tag at-log">컨택 기록</span>',
  add:    '<span class="audit-tag at-add">추가</span>',
  stage:  '<span class="audit-tag at-stage">단계 변경</span>',
  login:  '<span class="audit-tag at-login">로그인</span>',
  upload: '<span class="audit-tag at-upload">파일 업로드</span>',
  edit:   '<span class="audit-tag at-status">정보 수정</span>',
};

/* (원본 5214~5229행) */
export function getAuditFiltered(){
  const q = (document.getElementById('audit-q')||{}).value||'';
  const usel = (document.getElementById('audit-user-sel')||{}).value||'';
  let list = [...auditLog];
  if(auditFilter !== 'all') list = list.filter(e=>e.type===auditFilter);
  if(usel) list = list.filter(e=>e.email===usel);
  if(q){
    const lq = q.toLowerCase();
    list = list.filter(e=>
      (e.name||'').toLowerCase().includes(lq) ||
      (e.target||'').toLowerCase().includes(lq) ||
      (e.detail||'').toLowerCase().includes(lq)
    );
  }
  list.sort((a,b)=> new Date(b.ts) - new Date(a.ts));
  return list;
}

/* (원본 5231~5266행) */
export function renderAudit(){
  const list = getAuditFiltered();
  const ct = document.getElementById('audit-ct');
  if(ct) ct.textContent = `${list.length}건`;

  const el = document.getElementById('audit-list');
  if(!el) return;

  if(!list.length){
    el.innerHTML = `<div class="audit-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      <p>${auditFilter==='all'?'아직 활동 기록이 없어요':'해당 유형의 활동이 없어요'}</p>
    </div>`;
    return;
  }

  el.innerHTML = list.map(e=>{
    const ts = new Date(e.ts);
    const timeStr = ts.toLocaleDateString('ko-KR',{month:'short',day:'numeric'}) + ' ' +
                    ts.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
    const go = e.extra && e.extra.kind && e.extra.id;
    return `<div class="audit-item${go ? ' audit-go' : ''}"${
      go ? ` onclick="openAuditTarget('${escAttr(String(e.id))}')" title="눌러서 바뀐 곳으로 갑니다"` : ''}>
      <div class="audit-av" style="background:${e.color}">${escapeHtml(userInitials(e.name))}</div>
      <div class="audit-main">
        <div class="audit-who">${escapeHtml(e.name)}<span class="audit-email">${escapeHtml(e.email)}</span></div>
        <div class="audit-what">${escapeHtml(String(e.detail||'').replace(/<[^>]+>/g,''))}</div>
        <div class="audit-meta">
          ${TAG_MAP[e.type]||''}
          <span class="audit-time">${timeStr}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ══════════════════════════════════════════
   로그에서 바뀐 곳으로 가기

   기록만 읽어서는 "그래서 지금 어떻게 돼 있나"를 알 수 없어 매번 탭을 옮겨
   대상을 다시 찾아야 했다. extra에 적어 둔 대상을 열어 주고, 어느 칸이
   바뀐 것인지까지 짚어 준다.

   창을 여는 함수들은 각 탭 모듈이 가지고 있다. 여기서 import하면 audit이
   모든 탭을 끌어오게 되고 router.js가 audit을 import하므로 고리가 생긴다.
   그래서 이미 window에 나와 있는 것을 쓴다(다른 탭들이 서로를 부를 때와 같은 방식).
══════════════════════════════════════════ */
const AUDIT_GO = {
  exhibitor: (x) => { window.switchApp?.('exh');  window.openExhDr?.(x.id, x.tab); },
  contact:   (x) => { window.switchApp?.('mdb');  window.openContactDr?.(x.id); },
  target:    (x) => { window.switchApp?.('crm');  window.openDr?.(x.id); },
  company:   (x) => { window.switchApp?.('co');   window.selectCo?.(x.id); },
  speaker:   (x) => { window.switchApp?.('conf'); window.openSpeakerDr?.(x.id, x.tab); },
  session:   (x) => { window.switchApp?.('conf'); window.openAuditSession?.(x.id, x.ev); },
};

export function openAuditTarget(entryId){
  const e = auditLog.find(a => String(a.id) === String(entryId));
  const x = e && e.extra;
  if(!x || !AUDIT_GO[x.kind]) return;
  AUDIT_GO[x.kind](x);
  if(x.field) flashAuditField(x.field);
}

/* 바뀐 칸을 찾아 물들인다.

   칸마다 표식을 새로 달지 않고, 이미 화면에 적혀 있는 것으로 찾는다 — 입력칸은
   대부분 onchange="setX('booth_no', …)"처럼 자기가 어느 필드인지 말하고 있다.
   그걸로도 못 찾으면 아무것도 하지 않는다. 엉뚱한 칸을 물들이는 것보다 낫다.

   창은 눌린 직후에 그려지므로 몇 프레임 기다렸다 찾는다. */
export function flashAuditField(field){
  const f = String(field || '').replace(/[^A-Za-z0-9_]/g, '');
  if(!f) return;
  const sel = [`[data-af="${f}"]`, `[onchange*="'${f}'"]`, `[oninput*="'${f}'"]`,
    `[onclick*="'${f}'"]`, `[onblur*="'${f}'"]`, `[name="${f}"]`, `[id$="-${f}"]`].join(',');

  let tries = 0;
  const hunt = () => {
    // 열려 있는 창 안에서 먼저 찾는다 — 뒤에 깔린 목록에도 같은 이름이 있다
    const scope = document.querySelector('.dr.on, #con-dr.on') || document;
    const el = scope.querySelector(sel) || document.querySelector(sel);
    if(!el){
      if(++tries < 20) return requestAnimationFrame(hunt);
      return;
    }
    const box = el.closest('.fld, .dr-row, tr, li') || el;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.classList.remove('af-flash');
    void box.offsetWidth;              // 같은 칸을 두 번 누를 때 다시 칠해지게
    box.classList.add('af-flash');
    setTimeout(() => box.classList.remove('af-flash'), 2200);
  };
  requestAnimationFrame(hunt);
}

/* (원본 5268~5278행) */
export function filterAudit(type, btn){
  setAuditFilter(type);
  // Sync toolbar seg-b buttons
  document.querySelectorAll('#page-audit .seg-b').forEach(b=>b.classList.remove('on'));
  const tb = document.getElementById('af-'+type);
  if(tb) tb.classList.add('on');
  // Sync sidebar buttons
  document.querySelectorAll('#sbp-audit .nr').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  renderAudit();
}

/* (원본 5280~5305행) */
export function buildAuditUserList(){
  // Collect unique users from auditLog + current session
  const users = {};
  auditLog.forEach(e=>{ if(e.email) users[e.email]=e.name; });
  if(currentUser) users[currentUser.email]=currentUser.name;

  // Sidebar list
  const sbEl = document.getElementById('audit-user-list');
  if(sbEl) sbEl.innerHTML = Object.entries(users).map(([email,name])=>`
    <button class="evc${auditUserFilter===email?' on':''}" onclick="setAuditUser('${escAttr(email)}')">
      <div style="width:22px;height:22px;border-radius:50%;background:${userColor(email)};color:#fff;
        display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;flex-shrink:0">
        ${escapeHtml(userInitials(name))}
      </div>
      <span class="ev-n">${escapeHtml(name)}</span>
    </button>`).join('');

  // Select dropdown
  const selEl = document.getElementById('audit-user-sel');
  if(selEl){
    const cur = selEl.value;
    selEl.innerHTML = '<option value="">전체 팀원</option>' +
      Object.entries(users).map(([email,name])=>
        `<option value="${escapeHtml(email)}"${cur===email?' selected':''}>${escapeHtml(name)}</option>`).join('');
  }
}

/* (원본 5307~5313행) */
export function setAuditUser(email){
  setAuditUserFilter((auditUserFilter===email)?'':email);
  const selEl = document.getElementById('audit-user-sel');
  if(selEl) selEl.value = auditUserFilter;
  buildAuditUserList();
  renderAudit();
}

/* (원본 5315~5325행) */
export function updateAuditBadges(){
  const types = ['all','status','log','add','stage','login','edit','upload'];
  types.forEach(t=>{
    const el = document.getElementById('act-'+t);
    if(!el) return;
    el.textContent = t==='all' ? auditLog.length : auditLog.filter(e=>e.type===t).length;
  });
  buildAuditUserList();
  // If audit page is active, re-render
  if(curApp==='audit') renderAudit();
}

/* (원본 5327~5340행) — CSV 셀 값에 sanitizeForCsv 적용(신규 보안 개선) */
export function exportAuditCSV(){
  const list = getAuditFiltered();
  const h = ['시각','이름','이메일','액션 유형','대상','내용'];
  const rows = list.map(e=>[
    new Date(e.ts).toLocaleString('ko-KR'),
    e.name, e.email, e.action, e.target,
    e.detail.replace(/<[^>]+>/g,'')
  ]);
  const csv = [h,...rows].map(r=>r.map(v=>`"${sanitizeForCsv(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,﻿'+encodeURIComponent(csv);
  a.download = `activity_log_${td()}.csv`;
  a.click();
}

/* ══════════════════════════════════════════
   window 노출 — 원본 HTML의 인라인 onclick/oninput/onchange 핸들러가
   문자열로 호출하는 함수들 (index.html 마크업 1483~1555행 참고):
     onclick="exportAuditCSV()"
     onclick="filterAudit('all',this)" 등 (af-all/status/log/add/stage/login)
     oninput="renderAudit()" (audit-q 검색창)
     onchange="renderAudit()" (audit-user-sel 드롭다운)
     onclick="setAuditUser('${email}')" (buildAuditUserList가 생성하는 버튼)
══════════════════════════════════════════ */
window.exportAuditCSV = exportAuditCSV;
window.filterAudit    = filterAudit;
window.renderAudit    = renderAudit;
window.setAuditUser   = setAuditUser;
window.openAuditTarget = openAuditTarget;
window.flashAuditField = flashAuditField;
