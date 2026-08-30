/* ══════════════════════════════════════════════════════════════
   crm-tab.js — CRM 파이프라인(칸반)/전체 목록 뷰 + 우측 상세 드로어
   (원본 contact_crm.html 4612~4891행에서 정리, HTML 마크업은 1438~1556행대)

   담당 범위
   - 칸반보드(파이프라인)/전체 목록 두 가지 뷰 전환 및 렌더링
   - 우측 상세 드로어(CRM 진행 단계 / 컨택 이력 / 행사 기록 / 담당자 탭)
   - "타겟 추가" 모달(기업 검색 → 선택 → 저장)

   주의
   - 담당자 상세를 보여주는 openContactDr(원본 5617행, MDB 탭 전용)은
     이 모듈이 아니라 db-tab.js가 담당한다. 이름이 비슷한 openDr(CRM 타겟
     드로어, 원본 4703행)만 이 파일로 이동했다 — 혼동 주의.
   - #dr / .bd / #drh / #drtabs / #drbd DOM은 db-tab.js의 담당자 드로어와
     같은 요소를 재사용할 수 있으나, 이 모듈은 CRM 타겟 표시 로직만
     책임진다(코드 중복 허용 — 지금 단계에서 두 드로어를 억지로 통합하지 않음).
   - 원본에는 없던 escapeHtml() 적용을 추가했다(사용자 입력값을 innerHTML에
     삽입하는 모든 지점 — 타겟명/영문명/섹터/HQ/담당자/컨택 기록/행사 기록/
     담당자 이름 등). 필터링/정렬/단계 전환 로직 자체는 변경하지 않았다.
═══════════════════════════════════════════════════════════════ */

import {
  targets,
  crmV, setCrmV,
  crmEvF, setCrmEvF,
  crmStF, setCrmStF,
  tblSt, setTblSt,
  drID, setDrID,
  drTab, setDrTab,
  mSel, setMSel,
  EVENT_LIST,
  CO_DB,
  contacts,
} from '../state.js';
import { RP, SC, LC, EC, STGS, avB, avF } from '../constants.js';
import { ab, td, escapeHtml, escAttr } from '../utils.js';
import { trackAction } from './audit-tab.js';
import { postToSheet } from '../api.js';

/* ── 타겟 1건을 crm_targets 시트에 upsert (신규) ──
   기존에는 chgSt/chgStD/setStg/addLog가 메모리(targets)만 수정하고
   시트에 저장하지 않아, 새로고침/재동기화 시 변경이 전부 사라지는
   치명적 버그가 있었다. 모든 타겟 변경은 이 함수를 거쳐 저장한다.
   실패 시 postToSheet가 토스트로 알리고 {ok:false}를 반환하므로
   호출부에서 이전 상태로 롤백한다. */
export async function saveTargetToSheet(t) {
  return postToSheet({
    sheet: 'crm_targets',
    action: 'upsert',
    row: [t.id, t.name, t.nameEn, t.sector, t.hq,
      t.event, t.role, t.status, t.priority,
      t.assignee, t.currentStage, t.lastActivity,
      JSON.stringify(t.log || [])],
  }, 'CRM 타겟');
}

/* ── 우선순위 라벨 (원본은 renderTable2/dCRM 두 곳에 동일 객체가 중복 정의되어
   있었음 — 값 변경 없이 이 파일 안에서 한 번만 정의해서 공유) ── */
const PRI_LABEL = { high: '높음', mid: '중간', low: '낮음' };

/* ── 칸반 컬럼 정의 (원본 4613행 KCOLS).
   SC(constants.js, 상태→색상 단일 소스)에서 그대로 파생시켜 이원화를
   없앤다 — SC의 key 순서(미접촉/컨택중/협의중/확정/보류)가 원본 KCOLS와
   완전히 동일하므로 값/순서 변경 없음. ── */
const KCOLS = Object.entries(SC).map(([key, c]) => ({ key, c }));

/* escAttr — utils.js의 공용 구현을 사용 (기존 로컬 버전은 큰따옴표를
   이스케이프하지 않아 onclick="..." 속성 탈출 XSS가 가능했다) */

/* ══════════════════════════════════════════
   목록 필터링 (원본 4614~4621행)
══════════════════════════════════════════ */
export function crmFilt() {
  let l = [...targets];
  if (crmEvF) l = l.filter(t => t.event === crmEvF);
  if (crmStF) l = l.filter(t => t.status === crmStF);
  const q = (document.getElementById('crm-q') || {}).value || '';
  if (q) l = l.filter(t => t.name.toLowerCase().includes(q.toLowerCase()) || t.nameEn.toLowerCase().includes(q.toLowerCase()));
  return l;
}

/* ══════════════════════════════════════════
   좌측 행사 필터 사이드바 (원본 4622~4635행)
══════════════════════════════════════════ */
export function buildEvFil() {
  const el = document.getElementById('ev-fil');
  if (!el) return;
  const evs = [...new Set(targets.map(t => t.event).filter(Boolean))];
  el.innerHTML = evs.length
    ? evs.map((e, i) => `
        <button class="evc${crmEvF === e ? ' on' : ''}" onclick="setEvF('${escAttr(e)}')">
          <span class="ev-d" style="background:${EC[i % EC.length]}"></span><span class="ev-n">${escapeHtml(e)}</span>
          <span style="font-size:10px;color:var(--i4)">${targets.filter(t => t.event === e).length}</span>
        </button>`).join('')
    : '<div style="padding:10px 8px;font-size:11px;color:var(--i4)">등록된 행사 없음</div>';
}
export function setEvF(ev) { setCrmEvF(crmEvF === ev ? null : ev); buildEvFil(); renderCrm(); }
export function filterSt2(s, btn) {
  setCrmStF(crmStF === s ? null : s);
  document.querySelectorAll('.s-s .nr').forEach(b => b.classList.remove('on'));
  if (crmStF) btn.classList.add('on');
  renderCrm();
}
export function updBadges() {
  const g = id => document.getElementById(id);
  ['ct-pipe', 'ct-tbl'].forEach(id => { const e = g(id); if (e) e.textContent = targets.length; });
  ['미접촉', '컨택중', '협의중', '확정'].forEach((s, i) => { const e = g('ct-s' + i); if (e) e.textContent = targets.filter(t => t.status === s).length; });
}
export function switchCV(v, btn) {
  setCrmV(v);
  document.querySelectorAll('.view').forEach(el => el.classList.remove('on'));
  document.getElementById('v-' + v).classList.add('on');
  // 모바일 헤더 타이틀 동기화
  const mh = document.getElementById('mob-crm-ttl');
  if (mh) mh.textContent = v === 'pipeline' ? '파이프라인' : '전체 목록';
  document.querySelectorAll('.s-v .nr').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  const tt = { pipeline: '파이프라인', table: '전체 목록' };
  document.getElementById('crm-ttl').innerHTML = `${tt[v]} <span class="tb-s">행사 타겟 기업 컨택 현황</span>`;
  renderCrm();
}

/* ══════════════════════════════════════════
   뷰 전환 렌더 디스패치 (원본 4653~4661행)
══════════════════════════════════════════ */
export function renderCrm() {
  try {
    if (crmV === 'pipeline') renderPipeline(); else renderTable2();
  } catch (e) {
    console.error('[CRM] renderCrm 오류:', e);
    const el = document.getElementById('kanban') || document.getElementById('crm-tbody');
    if (el) el.innerHTML = `<div style="padding:20px;color:var(--re);font-size:12px">렌더 오류: ${escapeHtml(e.message)}</div>`;
  }
}

/* ══════════════════════════════════════════
   파이프라인(칸반보드) 뷰 (원본 4662~4681행)
══════════════════════════════════════════ */
export function renderPipeline() {
  const list = crmFilt();
  const kanbanEl = document.getElementById('kanban');
  if (!kanbanEl) return;
  kanbanEl.innerHTML = KCOLS.map(col => {
    const cards = list.filter(t => t.status === col.key);
    return `<div class="kcol"><div class="kch"><div class="kstr" style="background:${col.c}"></div><div class="klb">${escapeHtml(col.key)}</div><div class="kct">${cards.length}</div></div>
    <div class="kcs">${cards.map(t => { try { return kCard(t); } catch (e) { return ''; } }).join('')}<button class="kadd" onclick="openModal()">+ 추가</button></div></div>`;
  }).join('');
}
export function kCard(t) {
  const i = targets.findIndex(x => x.id === t.id);
  const pri = (t.priority || 'mid')[0] || 'm';
  const evShortName = (t.event || '').replace('KIC Silicon Valley', 'KIC SV').replace('KIC New York', 'KIC NY');
  return `<div class="kcard" onclick="openDr(${t.id})">
    <div class="kct2"><div class="kav" style="background:${avB(i)};color:${avF(i)}">${escapeHtml(ab(t.name || '?'))}</div><div><div class="knm">${escapeHtml(t.name || '(이름없음)')}</div><div class="ksc">${escapeHtml(t.sector || '')}</div></div></div>
    <div class="kps"><span class="pill ${RP[t.role] || 'p-gray'}">${escapeHtml(t.role || '')}</span><span class="pill p-gray">${escapeHtml(evShortName)}</span></div>
    <div class="kft"><div class="pri p${pri}"></div><div class="kwh">${escapeHtml(t.assignee || '')}</div><div class="kdt">${escapeHtml(t.lastActivity || '')}</div></div>
  </div>`;
}

/* ══════════════════════════════════════════
   전체 목록(테이블) 뷰 (원본 4682~4700행)
══════════════════════════════════════════ */
export function tblF(s, btn) {
  setTblSt(s);
  document.querySelectorAll('.seg-b').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  renderTable2();
}
export function renderTable2() {
  let list = crmFilt();
  if (tblSt !== '전체') list = list.filter(t => t.status === tblSt);
  document.getElementById('tct').textContent = `${list.length}개 기업`;
  document.getElementById('crm-tbody').innerHTML = list.map(t => {
    const i = targets.findIndex(x => x.id === t.id);
    return `<tr onclick="openDr(${t.id})">
      <td><div class="tdco"><div class="tdav" style="background:${avB(i)};color:${avF(i)}">${escapeHtml(ab(t.name))}</div><div><div class="tdnm">${escapeHtml(t.name)}</div><div class="tdsb">${escapeHtml(t.nameEn)}</div></div></div></td>
      <td style="color:var(--i3);font-size:12px">${escapeHtml(t.event)}</td>
      <td><span class="pill ${RP[t.role] || 'p-gray'}">${escapeHtml(t.role)}</span></td>
      <td style="color:var(--i3)">${escapeHtml(t.assignee)}</td>
      <td onclick="event.stopPropagation()"><select class="stsel" onchange="chgSt(${t.id},this.value)">${['미접촉', '컨택중', '협의중', '확정', '보류'].map(s => `<option${s === t.status ? ' selected' : ''}>${s}</option>`).join('')}</select></td>
      <td><span style="display:flex;align-items:center;gap:5px"><span class="pri p${t.priority[0]}"></span>${PRI_LABEL[t.priority]}</span></td>
      <td style="color:var(--i4);font-size:11px">${escapeHtml(t.lastActivity)}</td>
      <td onclick="event.stopPropagation()"><button class="tact" onclick="openDr(${t.id})">상세</button></td>
    </tr>`;
  }).join('');
}
export async function chgSt(id, val) {
  const i = targets.findIndex(x => x.id === id);
  if (i < 0) return;
  const prev = { status: targets[i].status, lastActivity: targets[i].lastActivity };
  targets[i].status = val;
  targets[i].lastActivity = td();
  renderCrm();
  updBadges();
  const r = await saveTargetToSheet(targets[i]);
  if (!r.ok) { // 저장 실패 → 롤백
    Object.assign(targets[i], prev);
    renderCrm();
    updBadges();
    return;
  }
  trackAction('status', '상태 변경', targets[i].name,
    `<b>${escapeHtml(targets[i].name)}</b>의 컨택 상태를 <b>${escapeHtml(prev.status)} → ${escapeHtml(val)}</b>로 변경`);
}

/* ══════════════════════════════════════════
   우측 상세 드로어 — CRM 타겟 (원본 4703~4769행)
   ※ 담당자용 openContactDr(원본 5617행)과는 별개 함수. db-tab.js 참고.
══════════════════════════════════════════ */
export function openDr(id) {
  setDrID(id);
  setDrTab(0);
  renderDr();
  document.getElementById('dr').classList.add('on');
  document.getElementById('bd').classList.add('on');
}
export function closeDr() {
  document.getElementById('dr').classList.remove('on');
  document.getElementById('bd').classList.remove('on');
}
export function renderDr() {
  const t = targets.find(x => x.id === drID);
  if (!t) return;
  const i = targets.findIndex(x => x.id === drID);
  document.getElementById('drh').innerHTML = `
    <div class="drav" style="background:${avB(i)};color:${avF(i)}">${escapeHtml(ab(t.name))}</div>
    <div style="flex:1"><div class="drnm">${escapeHtml(t.name)}</div><div class="drmt"><span>📍 ${escapeHtml(t.hq)}</span><span>🏭 ${escapeHtml(t.sector)}</span><span style="color:${SC[t.status] || 'var(--i3)'}">● ${escapeHtml(t.status)}</span></div></div>
    <button class="drcls" onclick="closeDr()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`;
  const tabs = ['CRM', '컨택 이력', '행사 기록', '담당자'];
  document.getElementById('drtabs').innerHTML = tabs.map((tb, k) => `<div class="drtab${drTab === k ? ' on' : ''}" onclick="switchDT(${k})">${tb}</div>`).join('');
  renderDrBd(t);
}
export function switchDT(k) {
  setDrTab(k);
  document.querySelectorAll('.drtab').forEach((t, j) => t.classList.toggle('on', j === k));
  renderDrBd(targets.find(x => x.id === drID));
}
export function renderDrBd(t) {
  const b = document.getElementById('drbd');
  if (drTab === 0) b.innerHTML = dCRM(t);
  else if (drTab === 1) b.innerHTML = dLog(t);
  else if (drTab === 2) b.innerHTML = dEv(t);
  else b.innerHTML = dCon(t);
}
export function dCRM(t) {
  const cur = t.currentStage;
  return `<div class="sct" style="margin-bottom:7px">진행 단계</div>
    <div class="sgbar">${STGS.map((s, k) => { const n = k + 1; const cls = n < cur ? 'done' : n === cur ? 'now' : ''; return `<div class="sgc ${cls}" onclick="setStg(${t.id},${n})">${n < cur ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:9px;height:9px"><polyline points="20,6 9,17 4,12"/></svg>' : ''}${s}</div>`; }).join('')}</div>
    <div class="sct">기본 정보</div>
    <div class="ig">
      <div class="ic"><div class="il">타겟 행사</div><div class="iv" style="font-size:11px">${escapeHtml(t.event)}</div></div>
      <div class="ic"><div class="il">참여 유형</div><div class="iv"><span class="pill ${RP[t.role] || 'p-gray'}">${escapeHtml(t.role)}</span></div></div>
      <div class="ic"><div class="il">담당자</div><div class="iv">${escapeHtml(t.assignee)}</div></div>
      <div class="ic"><div class="il">우선순위</div><div class="iv"><span style="display:flex;align-items:center;gap:5px"><span class="pri p${t.priority[0]}"></span>${PRI_LABEL[t.priority]}</span></div></div>
    </div>
    <div class="sct" style="margin-top:13px">통합 기업명</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:13px">${t.branches.map(b => `<span class="btag${b === t.mainBranch ? ' main' : ''}">${escapeHtml(b)}</span>`).join('')}</div>
    <div class="sct">컨택 상태</div>
    <div class="stbs">${['미접촉', '컨택중', '협의중', '확정', '보류'].map(s => `<button class="stb${t.status === s ? ' on' : ''}" onclick="chgStD(${t.id},'${s}')">${s}</button>`).join('')}</div>`;
}
export function dLog(t) {
  return `<div class="sct" style="margin-bottom:7px">활동 기록 추가</div>
    <div class="li"><select id="lt-${t.id}"><option>이메일</option><option>전화</option><option>미팅</option><option>메모</option><option>계약</option></select><input type="text" id="lx-${t.id}" placeholder="활동 내용 입력…"><button class="lsub" onclick="addLog(${t.id})">기록</button></div>
    <div class="sct">활동 이력</div>
    <div class="lls">${t.log.map((l, k) => `
      <div class="lit"><div class="ltr"><div class="ld" style="background:${l.color}"></div>${k < t.log.length - 1 ? '<div class="lln"></div>' : ''}</div>
      <div class="lb2"><div class="lty" style="color:${l.color}">${escapeHtml(l.type)}</div><div class="ltx">${escapeHtml(l.text)}</div><div class="lda">${escapeHtml(l.date)}</div></div></div>`).join('')}</div>`;
}
/* ══════════════════════════════════════════
   타겟 ↔ 기업DB 잇기

   담당자·행사 이력을 타겟에 복사해 두지 않는다. 같은 사실을 두 군데 적으면
   기업DB에서 연락처를 고쳐도 CRM 쪽은 옛날 값을 계속 보여준다. 볼 때마다
   기업DB에서 가져온다 — 이미 CO_DB가 필요한 모양 그대로 들고 있다.

   잇는 기준은 이름이다. crm_targets에는 기업 id가 없고(예전에 이름으로만
   만들었다), 통합 기업명(branches)에 옛 사명·영문명이 함께 들어 있어서
   그중 하나만 맞아도 찾아낸다. */
const nameKey = (v) => String(v || '').toLowerCase()
  .replace(/\(주\)|주식회사|㈜|inc\.?|corp\.?|co\.?|ltd\.?/gi, '')
  .replace(/[^a-z0-9가-힣]/g, '');

function coOf(t){
  if(!t) return null;
  const keys = new Set([t.name, t.nameEn, t.mainBranch, ...(t.branches || [])]
    .map(nameKey).filter(Boolean));
  if(!keys.size) return null;
  return CO_DB.find(c => [c.nameKo, c.nameEn, c.mainBranch, ...(c.aliases || []), ...(c.branches || [])]
    .some(n => keys.has(nameKey(n)))) || null;
}

/* 화면에 쓸 담당자·행사 이력 — 기업DB에 없으면 빈 배열 */
const conOf = (t) => coOf(t)?.contacts || [];
const evOf  = (t) => {
  const evs = coOf(t)?.events || [];
  // 최근 행사부터 — 이력은 최근 것이 먼저 보여야 쓸모가 있다
  return [...evs].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
};

export function dEv(t) {
  const evs = evOf(t);
  if (!evs.length) return `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><p>행사 참여 이력 없음</p>${
    coOf(t) ? '' : '<p style="font-size:11px;color:var(--i5)">기업DB에서 같은 이름의 기업을 못 찾았어요</p>'}</div>`;
  return evs.map(e => `<div class="evc2"><div class="evc2tp"><div class="evnm">${escapeHtml(e.name)}</div><div class="evdt">${escapeHtml(e.date)}</div></div>
    <div style="font-size:10px;color:var(--i4);margin-bottom:5px">📍 ${escapeHtml(e.loc)}</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:5px">${e.roles.map(r => `<span class="pill ${RP[r] || 'p-gray'}">${escapeHtml(r)}</span>`).join('')}</div>
    ${e.people.map(p => `<div style="font-size:11px;color:var(--i3);padding:2px 0">👤 ${escapeHtml(p)}</div>`).join('')}
    ${e.note ? `<div class="evno">${escapeHtml(e.note)}</div>` : ''}</div>`).join('');
}
export function dCon(t) {
  const cons = conOf(t);
  if (!cons.length) return `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><p>담당자 없음</p>${
    coOf(t) ? '<p style="font-size:11px;color:var(--i5)">기업DB에 이 기업의 연락처가 아직 없어요</p>'
            : '<p style="font-size:11px;color:var(--i5)">기업DB에서 같은 이름의 기업을 못 찾았어요</p>'}</div>`;
  return cons.map(p => `<div class="conc"><div class="conav">${escapeHtml(p.name.slice(0, 2))}</div><div style="flex:1"><div class="connm">${escapeHtml(p.name)}</div><div class="conti">${escapeHtml(p.title)}</div><div class="conps">${p.events.map(e => `<span class="pill p-gray">${escapeHtml(e)}</span>`).join('')}</div></div><div style="display:flex;flex-direction:column;gap:3px">${p.cats.map(c => `<span class="pill ${RP[c] || 'p-gray'}">${escapeHtml(c)}</span>`).join('')}</div></div>`).join('');
}
/* setStg/chgStD/addLog — 원본은 이 세 함수를 정의한 뒤 auth/audit 섹션에서
   window.setStg = function(...){ 원본함수(...); trackAction(...); } 식으로
   감싸 감사로그를 남겼다(원본 5147~5202행). 이 모듈에서는 trackAction을
   바로 import해서 쓸 수 있으므로 감싸지 않고 함수 안에 직접 반영했다
   (동작은 동일 — 상태/단계 변경 *후* 이전 값과 함께 기록). */
const STGS_KR = ['타겟 등록','초기 컨택','제안서 발송','미팅','협의 중','계약 완료'];
export async function setStg(id, stage) {
  const i = targets.findIndex(x => x.id === id);
  if (i < 0) return;
  const prev = {
    currentStage: targets[i].currentStage,
    status: targets[i].status,
    lastActivity: targets[i].lastActivity,
  };
  const prevLabel = STGS_KR[(targets[i].currentStage||1)-1];
  targets[i].currentStage = stage;
  targets[i].lastActivity = td();
  const m = { 1: '미접촉', 2: '컨택중', 3: '컨택중', 4: '협의중', 5: '협의중', 6: '확정' };
  targets[i].status = m[stage] || '미접촉';
  renderDr();
  renderCrm();
  updBadges();
  const r = await saveTargetToSheet(targets[i]);
  if (!r.ok) { // 저장 실패 → 롤백
    Object.assign(targets[i], prev);
    renderDr();
    renderCrm();
    updBadges();
    return;
  }
  trackAction('stage', '단계 변경', targets[i].name,
    `<b>${escapeHtml(targets[i].name)}</b>의 진행 단계를 <b>${escapeHtml(prevLabel)} → ${escapeHtml(STGS_KR[stage-1])}</b>로 변경`);
}
export async function chgStD(id, val) {
  const i = targets.findIndex(x => x.id === id);
  if (i < 0) return;
  const prev = { status: targets[i].status, lastActivity: targets[i].lastActivity };
  targets[i].status = val;
  targets[i].lastActivity = td();
  renderDr();
  renderCrm();
  updBadges();
  const r = await saveTargetToSheet(targets[i]);
  if (!r.ok) { // 저장 실패 → 롤백
    Object.assign(targets[i], prev);
    renderDr();
    renderCrm();
    updBadges();
    return;
  }
  trackAction('status', '상태 변경', targets[i].name,
    `<b>${escapeHtml(targets[i].name)}</b>의 컨택 상태를 <b>${escapeHtml(prev.status)} → ${escapeHtml(val)}</b>로 변경`);
}
export async function addLog(id) {
  const i = targets.findIndex(x => x.id === id);
  if (i < 0) return;
  const type = document.getElementById('lt-' + id).value;
  const text = document.getElementById('lx-' + id).value.trim();
  if (!text) return;
  const prevLastActivity = targets[i].lastActivity;
  targets[i].log.unshift({ type, text, date: td(), color: LC[type] || '#9C9890' });
  targets[i].lastActivity = td();
  renderDr();
  const r = await saveTargetToSheet(targets[i]);
  if (!r.ok) { // 저장 실패 → 롤백 (방금 넣은 기록 제거)
    targets[i].log.shift();
    targets[i].lastActivity = prevLastActivity;
    renderDr();
    return;
  }
  trackAction('log', '컨택 기록 추가', targets[i].name,
    `<b>${escapeHtml(targets[i].name)}</b>에 <b>${escapeHtml(type)}</b> 기록 추가: "${escapeHtml(text)}"`);
}

/* ══════════════════════════════════════════
   "타겟 추가" 모달 (원본 4772~4891행)
══════════════════════════════════════════ */
export function openModal() {
  // 행사 드롭다운 채우기
  const mev = document.getElementById('m-ev');
  mev.innerHTML = EVENT_LIST.map(e => `<option value="${escapeHtml(e.key)}">${escapeHtml(e.short)} (${escapeHtml(e.date)})</option>`).join('');
  // 참여 유형(.parttype-select)은 PART_TYPES가 로드된 뒤 채워진다. 모달을 열 때
  // 한 번 더 갱신해 설정에서 방금 추가한 유형도 바로 뜨게 한다(window 경유 —
  // upload-tab을 직접 import하면 순환 참조가 된다).
  window.populateUploadEvDropdown?.();
  document.getElementById('mw').classList.add('on');
  setMSel(null);
  document.getElementById('m-si').value = '';
  // 기업 목록 바로 표시 (빈 검색 = 전체)
  mSrch('');
}
export function closeModal() { document.getElementById('mw').classList.remove('on'); }

/* ── contacts 기반 기업 검색 (원본 4785~4804행) ── */
export function getCoList() {
  // CO_DB 우선, 없으면 contacts에서 직접 추출
  if (CO_DB.length) return CO_DB.map(c => ({
    name: c.nameKo || c.nameEn,
    nameEn: c.nameEn || '',
    sector: c.sector || '',
    hq: c.hq || '',
    count: c.contacts.length,
  }));
  // CO_DB 없으면 contacts에서 기업명 그룹핑
  const map = {};
  contacts.forEach(c => {
    const k = (c.orgKo || c.orgEn || '').trim();
    if (!k) return;
    if (!map[k]) map[k] = { name: k, nameEn: c.orgEn || '', sector: '', hq: c.country || '', count: 0 };
    map[k].count++;
  });
  return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
}

export function mSrch(v) {
  const el = document.getElementById('m-dl');
  const q = v.toLowerCase().trim();

  // 빈 검색어면 전체 목록 표시
  const src = getCoList();
  const res = q
    ? src.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.nameEn || '').toLowerCase().includes(q) ||
        (c.sector || '').toLowerCase().includes(q))
    : src.slice(0, 30); // 최대 30개

  if (!res.length) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.innerHTML = res.map(c => {
    const nm = c.name || c.nameEn || '';
    const isPicked = mSel && mSel.name === nm;
    return `<div class="drw${isPicked ? ' pk' : ''}" onclick="pickCo(this,'${escAttr(nm)}','${escAttr(c.nameEn)}','${escAttr(c.sector)}','${escAttr(c.hq)}')">
      <div style="display:flex;align-items:center;gap:8px">
        <div>
          <div class="drn">${escapeHtml(nm)}</div>
          <div class="drm">${escapeHtml([c.nameEn, c.sector, c.hq].filter(Boolean).join(' · '))}${c.count ? ` · ${c.count}명` : ''}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

export function pickCo(el, name, nameEn, sector, hq) {
  setMSel({ name, nameEn, sector, hq });
  document.querySelectorAll('.drw').forEach(r => r.classList.remove('pk'));
  el.classList.add('pk');
  document.getElementById('m-si').value = name;
  document.getElementById('m-dl').style.display = 'none';
}

export async function addTarget() {
  if (!mSel) { alert('기업을 선택해주세요.'); return; }
  const t = {
    id: Date.now(),
    name: mSel.name,
    nameEn: mSel.nameEn || '',
    sector: mSel.sector || '',
    hq: mSel.hq || '',
    event: document.getElementById('m-ev').value,
    role: document.getElementById('m-role').value,
    status: '미접촉',
    priority: document.getElementById('m-pri').value,
    assignee: document.getElementById('m-who').value,
    lastActivity: td(),
    branches: [mSel.name, mSel.nameEn].filter(Boolean),
    mainBranch: mSel.name,
    log: [document.getElementById('m-note').value
      ? { type: '메모', text: document.getElementById('m-note').value, date: td(), color: '#9C9890' }
      : null].filter(Boolean),
    currentStage: 1,
  };
  targets.unshift(t);
  closeModal();
  buildEvFil();
  renderCrm();
  updBadges();

  // 구글시트 저장 — 실패 시 방금 추가한 타겟을 목록에서 제거(롤백)
  const r = await saveTargetToSheet(t);
  if (!r.ok) {
    const idx = targets.findIndex(x => x.id === t.id);
    if (idx >= 0) targets.splice(idx, 1);
    buildEvFil();
    renderCrm();
    updBadges();
    return;
  }
  trackAction('add', '타겟 추가', t.name, `CRM 타겟 추가: ${t.name} / ${t.event}`);
}

/* ══════════════════════════════════════════
   탭 진입 초기화 (신규 — router.js가 'crm' 탭으로 전환할 때 호출.
   원본 switchApp의 `if(app==='crm'){ buildEvFil(); renderCrm(); }`
   분기(6643행)를 그대로 옮긴 것) ── */
export function initCrmTab() {
  buildEvFil();
  renderCrm();
}

/* ══════════════════════════════════════════
   전역 노출 — 생성된 HTML의 인라인 onclick/onchange/oninput에서
   문자열로 호출되므로 반드시 window에 등록해야 동작한다.
══════════════════════════════════════════ */
window.setEvF = setEvF;
window.filterSt2 = filterSt2;
window.switchCV = switchCV;
window.renderCrm = renderCrm;
window.tblF = tblF;
window.chgSt = chgSt;
window.openDr = openDr;
window.closeDr = closeDr;
window.switchDT = switchDT;
window.setStg = setStg;
window.chgStD = chgStD;
window.addLog = addLog;
window.openModal = openModal;
window.closeModal = closeModal;
window.mSrch = mSrch;
window.pickCo = pickCo;
window.addTarget = addTarget;
