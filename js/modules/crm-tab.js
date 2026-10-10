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
  speakersOfContact,
  currentUser,
} from '../state.js';
import { flowStatus, nextActionLabel } from './speaker-flow.js';
import { RP, SC, LC, EC, STGS, avB, avF } from '../constants.js';
import { ab, td, escapeHtml, escAttr, isMobile } from '../utils.js';
import { trackAction, changed } from './audit-tab.js';
import { postToSheet, sendMail, eventMailFrom, loadUnassigned, linkUnassignedCrm } from '../api.js';
import './mail-original.js';   // window.openMailOriginal — 받은 메일 원문 보기
import { renderToday, renderRoundNav, openFillRound, openRoundEditor } from './contact-tab.js';
import { renderGrid, exportContactGrid } from './contact-grid.js';
import { renderReport, copyDailyReport } from './contact-report.js';
import './contact-mail.js';     // 차수 «메일 보내기» 창 (window.openRoundMail)
import './contact-import.js';   // 옛 엑셀 기록 가져오기 (window.openRoundImport)

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
  /* 행사 여러 개를 함께 볼 수 있다 — 바이오 행사 둘을 같은 철에 하면
     두 파이프라인을 나란히 놓고 봐야 «어디에 먼저 전화할까»가 보인다.
     타겟은 행사마다 따로다. 컨택도 제안서도 행사마다 따로 가기 때문이다 —
     한 줄로 합치면 KIC은 미팅까지 갔는데 BIO는 아직 미접촉인 상태를
     적을 데가 없어진다. 여기서 합치는 건 «보는 것»뿐이다. */
  if (crmEvSel().length) l = l.filter(t => crmEvSel().includes(t.event));
  if (crmStF) l = l.filter(t => t.status === crmStF);
  const q = (document.getElementById('crm-q') || {}).value || '';
  if (q) l = l.filter(t => t.name.toLowerCase().includes(q.toLowerCase()) || t.nameEn.toLowerCase().includes(q.toLowerCase()));
  return l;
}

/* ══════════════════════════════════════════
   좌측 행사 필터 사이드바 (원본 4622~4635행)
══════════════════════════════════════════ */
/* 지금 고른 행사들 — 하나만 고르던 시절의 값(문자열)도 그대로 읽는다 */
export function crmEvSel(){
  if(!crmEvF) return [];
  return Array.isArray(crmEvF) ? crmEvF : [crmEvF];
}

export function buildEvFil() {
  renderRoundNav();
  const el = document.getElementById('ev-fil');
  if (!el) return;
  const evs = [...new Set(targets.map(t => t.event).filter(Boolean))];
  const sel = crmEvSel();
  el.innerHTML = evs.length
    ? (sel.length > 1
        ? `<div style="font-size:10.5px;color:var(--i4);padding:2px 8px 6px">${sel.length}개 행사를 함께 보는 중 ·
             <a href="javascript:void(0)" onclick="clearEvF()" style="color:var(--a)">모두 해제</a></div>` : '')
      + evs.map((e, i) => `
        <button class="evc${sel.includes(e) ? ' on' : ''}" onclick="setEvF('${escAttr(e)}')"
          title="여러 행사를 함께 보려면 차례로 누르세요">
          <span class="ev-d" style="background:${EC[i % EC.length]}"></span><span class="ev-n">${escapeHtml(e)}</span>
          <span style="font-size:10px;color:var(--i4)">${targets.filter(t => t.event === e).length}</span>
        </button>`).join('')
    : '<div style="padding:10px 8px;font-size:11px;color:var(--i4)">등록된 행사 없음</div>';
}

/* 누를 때마다 더하고 뺀다 — 하나만 고르던 때와 손놀림이 같고(한 번 누르면
   그 행사만), 두 번째를 누르면 함께 보인다. */
export function setEvF(ev) {
  const cur = crmEvSel();
  const next = cur.includes(ev) ? cur.filter(v => v !== ev) : [...cur, ev];
  setCrmEvF(next.length ? next : null);
  buildEvFil(); renderCrm();
}
export function clearEvF(){ setCrmEvF(null); buildEvFil(); renderCrm(); }
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
/* 컨택 탭의 보기 셋 — 오늘 할 컨택(TM/DM 차수, contact-tab.js)과 협의 보드·목록.
   협의는 스폰서·기관처럼 몇 번 만나 결정되는 소수의 건이라 따로 둔다. */
const CV_TITLE = {
  today:    ['오늘 할 컨택', 'TM/DM 차수별로 걸 곳과 다시 걸 곳'],
  grid:     ['현황표', '한 줄에 한 기업 · 차수마다 최근 반응 — 엑셀 보고 양식으로 내려받기'],
  report:   ['보고', '명단별·담당자별 숫자와 일일보고 문장'],
  pipeline: ['협의 보드', '몇 번 만나 결정되는 곳 — 스폰서·기관 협의'],
  table:    ['협의 목록', '몇 번 만나 결정되는 곳 — 스폰서·기관 협의'],
};
export function switchCV(v, btn) {
  setCrmV(v);
  document.querySelectorAll('#page-crm .view').forEach(el => el.classList.remove('on'));
  document.getElementById('v-' + v).classList.add('on');
  const [ttl, sub] = CV_TITLE[v] || CV_TITLE.today;
  // 모바일 헤더 타이틀 동기화
  const mh = document.getElementById('mob-crm-ttl');
  if (mh) mh.textContent = ttl;
  document.querySelectorAll('.s-v .nr').forEach(b => b.classList.toggle('on', b.dataset.cv === v));
  if (btn) btn.classList.add('on');
  document.getElementById('crm-ttl').innerHTML = `${ttl} <span class="tb-s">${sub}</span>`;
  // 사이드바 — 차수는 오늘 할 컨택에서만, 행사별·협의 현황은 협의 보기에서만
  const contact = v === 'today' || v === 'grid' || v === 'report';
  const show = (id, on) => { const e = document.getElementById(id); if (e) e.style.display = on ? '' : 'none'; };
  show('crm-sb-rounds', contact); show('crm-sb-ev', !contact); show('crm-sb-st', !contact);
  const lbl = document.getElementById('crm-add-lbl');
  if (lbl) lbl.textContent = v === 'today' ? '명단 채우기' : v === 'grid' ? '엑셀로 내려받기' : v === 'report' ? '일일보고 복사' : '협의 추가';
  renderCrm();
}
/* 위쪽 + 단추 — 보고 있는 보기에 맞는 것을 더한다 */
export function crmAdd() {
  if (crmV === 'grid') return exportContactGrid();
  if (crmV === 'report') return copyDailyReport();
  if (crmV !== 'today') return openModal();
  if (!document.querySelector('#round-nav .nr.on')) return openRoundEditor();
  openFillRound();
}

/* ══════════════════════════════════════════
   뷰 전환 렌더 디스패치 (원본 4653~4661행)
══════════════════════════════════════════ */
/* 모바일 검색칸 — 상단바(.tb)가 모바일에서 통째로 숨겨져 검색창을 쓸 수 없다.
   값은 데스크톱 칸 하나로 모아 둔다. */
export function searchCrmM(v){
  const d = document.getElementById('crm-q');
  if(d) d.value = v;
  renderCrm();
}

export function renderCrm() {
  try {
    if (crmV === 'today') renderToday();
    else if (crmV === 'grid') renderGrid();
    else if (crmV === 'report') renderReport();
    else if (crmV === 'pipeline') renderPipeline(); else renderTable2();
  } catch (e) {
    console.error('[CRM] renderCrm 오류:', e);
    const el = document.getElementById('kanban') || document.getElementById('crm-tbody');
    if (el) el.innerHTML = `<div style="padding:20px;color:var(--re);font-size:12px">렌더 오류: ${escapeHtml(e.message)}</div>`;
  }
}

/* ══════════════════════════════════════════
   파이프라인(칸반보드) 뷰 (원본 4662~4681행)
══════════════════════════════════════════ */
/* ══════════════════════════════════════════
   모바일 — 길게 눌러 고르고, 눌러서 옮긴다

   칸반은 원래 카드를 끌어다 옮기는 화면인데, 손가락으로는 끌리지 않는다(HTML5
   드래그는 터치에서 아예 시작되지 않는다). 그래서 휴대폰에서는 카드를 열어
   드로어 안에서 상태 단추를 눌러야 했다 — 다섯 곳을 옮기려면 열고 누르고 닫기를
   다섯 번 한다.

   길게 눌러 고르고, 위에 뜨는 단추로 한꺼번에 옮긴다. 마스터DB와 같은 손짓이라
   따로 배울 게 없다.

   이미 그 상태인 카드는 건드리지 않는다. 안 바뀐 줄까지 저장하면 «상태 변경»
   기록이 쌓여, 나중에 무엇이 실제로 움직였는지 찾을 수 없다.
══════════════════════════════════════════ */
export const crmSelected = new Set();

const CRM_LP_MS = 450;
let kLpTimer = null, kLpSwallow = false;
const kCardOf = (t) => (t && t.closest ? t.closest('.kcard[data-tid]') : null);
const tidOf = (v) => (/^-?\d+$/.test(v) ? Number(v) : v);
const cancelKLp = () => { if(kLpTimer){ clearTimeout(kLpTimer); kLpTimer = null; } };

function toggleCrmSelect(id){
  if(crmSelected.has(id)) crmSelected.delete(id); else crmSelected.add(id);
  renderPipeline();
}
export function clearCrmSelection(){ crmSelected.clear(); renderPipeline(); }

export function renderCrmSelBar(){
  const el = document.getElementById('crm-selbar');
  if(!el) return;
  const n = crmSelected.size;
  if(!n){ el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = 'flex';
  // 고른 것들이 이미 한 상태에 모여 있으면 그 단추는 눌러도 할 일이 없다
  const picked = targets.filter(t => crmSelected.has(t.id));
  el.innerHTML = `<span style="font-size:12px;font-weight:700">${n}개 선택됨</span>
    <span style="font-size:10.5px;color:var(--i5)">옮길 곳을 누르세요</span>
    <span style="display:flex;gap:4px;flex-wrap:wrap;margin-left:2px">
      ${KCOLS.map(col => {
        const same = picked.every(t => t.status === col.key);
        return `<button class="btn bs" ${same ? 'disabled' : ''}
          style="border-color:${col.c};color:${same ? 'var(--i5)' : col.c}${same ? ';opacity:.45' : ''}"
          onclick="moveCrmSelected('${escAttr(col.key)}')">${escapeHtml(col.key)}</button>`;
      }).join('')}
    </span>
    <button class="btn bs" style="margin-left:auto" onclick="clearCrmSelection()">선택 해제</button>`;
}

/* 고른 것을 한 상태로 옮긴다. 줄마다 저장하고 실패한 줄만 되돌린다 —
   절반만 옮겨 놓고 성공이라고 하면, 다시 눌러 옮기다 기록이 두 번 남는다. */
export async function moveCrmSelected(status){
  const picked = targets.filter(t => crmSelected.has(t.id) && t.status !== status);
  if(!picked.length){ crmSelected.clear(); renderPipeline(); return; }

  const before = picked.map(t => ({ t, status: t.status, lastActivity: t.lastActivity }));
  picked.forEach(t => { t.status = status; t.lastActivity = td(); });
  crmSelected.clear();
  renderCrm(); updBadges();

  const res = await Promise.all(picked.map(t => saveTargetToSheet(t)));
  const bad = before.filter((_, i) => !res[i].ok);
  if(bad.length){
    bad.forEach(b => Object.assign(b.t, { status: b.status, lastActivity: b.lastActivity }));
    renderCrm(); updBadges();
    alert(`${bad.length}건은 저장에 실패해 되돌렸어요. 네트워크 확인 후 다시 시도해주세요.`);
  }
  const ok = before.filter((_, i) => res[i].ok);
  if(ok.length) trackAction('status', '상태 변경', `${ok.length}개사`,
    `<b>${escapeHtml(String(ok.length))}개사</b>를 <b>${escapeHtml(status)}</b>로 옮김 — ${
      ok.map(b => escapeHtml(b.t.name)).join(', ')}`);
}

function initCrmLongPress(){
  document.addEventListener('touchstart', (e) => {
    if(!isMobile()) return;
    const card = kCardOf(e.target);
    if(!card) return;
    cancelKLp();
    kLpTimer = setTimeout(() => {
      kLpTimer = null;
      kLpSwallow = true;              // 손을 뗄 때 따라오는 click은 삼킨다
      navigator.vibrate?.(15);
      toggleCrmSelect(tidOf(card.dataset.tid));
    }, CRM_LP_MS);
  }, { passive: true });

  ['touchmove', 'touchend', 'touchcancel'].forEach(ev =>
    document.addEventListener(ev, cancelKLp, { passive: true }));

  document.addEventListener('click', (e) => {
    if(kLpSwallow){ kLpSwallow = false; e.stopPropagation(); e.preventDefault(); return; }
    if(!isMobile() || !crmSelected.size) return;
    const card = kCardOf(e.target);
    if(!card) return;
    // 고르는 중에는 탭이 곧 고르기다 — 드로어는 다 푼 뒤에 연다
    e.stopPropagation(); e.preventDefault();
    toggleCrmSelect(tidOf(card.dataset.tid));
  }, true);

  document.addEventListener('contextmenu', (e) => {
    if(isMobile() && kCardOf(e.target)) e.preventDefault();
  });
}
initCrmLongPress();

export function renderPipeline() {
  const list = crmFilt();
  const kanbanEl = document.getElementById('kanban');
  if (!kanbanEl) return;
  // 화면에서 사라진 타겟이 골라진 채로 남으면, 옮기기 단추가 없는 것을 옮기려 든다
  const alive = new Set(list.map(t => String(t.id)));
  [...crmSelected].forEach(id => { if(!alive.has(String(id))) crmSelected.delete(id); });
  renderCrmSelBar();
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
  const sel = crmSelected.has(t.id);
  return `<div class="kcard${sel ? ' sel' : ''}" data-tid="${escAttr(String(t.id))}" onclick="openDr(${t.id})"${
    sel ? ' style="outline:2px solid var(--a);outline-offset:-2px;background:var(--ad)"' : ''}>
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
    `<b>${escapeHtml(targets[i].name)}</b>의 컨택 상태를 <b>${escapeHtml(prev.status)} → ${escapeHtml(val)}</b>로 변경`,
    changed('crm_targets', targets[i].id, prev, { status: val }, { kind: 'target', id: targets[i].id }));
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
  /* 이 기업 사람이 연사로 들어가 있으면 연락 단계 탭을 붙인다 */
  const nSp = spkOf(t).length;
  const tabs = ['CRM', '컨택 이력', '행사 기록', '담당자', ...(nSp ? [`연사 연락 ${nSp}`] : [])];
  if(drTab >= tabs.length) setDrTab(0);
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
  else if (drTab === 4) b.innerHTML = dSpk(t);
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
/* ── 컨택 이력 ──
   메일은 행사 공용 메일로 여기서 바로 보낸다(서버가 이 타겟 log에 «메일 보냄»을 남긴다).
   받은 메일은 그 행사 메일함의 «주인 없는 메일» 중 이 기업 담당자 주소·도메인에서 온 것을
   골라 «메일 받음»으로 붙인다. 받은 메일 본문은 옮기지 않는다 — «원문»으로 그때 연다.
   보낸 메일은 본문까지 남겨 «본문 보기»로 무슨 메일을 보냈는지 다시 본다.
   기록마다 짧은 메모를 달아 «무엇을 약속했나·다음에 뭘 하나»를 따라간다. */
const LOG_TYPES = ['메일 보냄', '메일 받음', '전화', '미팅', '메모', '계약'];
const logUi = { compose: null, inbox: null, memoEdit: null };   // compose·inbox: 타겟 id, memoEdit: 'id:k'
const inboxCache = {};   // 타겟 id → { loading, error, items }
const fromCache = {};    // 행사 key → { ok, text } — 다시 그려도 «확인 중»으로 돌아가지 않게

const ICO_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>';
const ICO_IN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>';

/* 이 기업 담당자 중 메일 주소가 있는(퇴사 안 한) 사람 */
const mailConOf = (t) => conOf(t).filter(p => /@/.test(p.email || '') && !p.left_at);

export function dLog(t) {
  const compose = logUi.compose === t.id;
  const inbox = logUi.inbox === t.id;
  const on = 'border-color:var(--a);color:var(--a);background:var(--ad)';
  return `<div style="display:flex;gap:6px;margin-bottom:12px">
      <button class="btn" style="flex:1;justify-content:center;padding:8px 6px;${compose ? on : ''}" onclick="crmMailToggle(${t.id})">${ICO_MAIL} 메일 보내기</button>
      <button class="btn" style="flex:1;justify-content:center;padding:8px 6px;${inbox ? on : ''}" onclick="crmInboxToggle(${t.id})">${ICO_IN} 받은 메일 가져오기</button>
    </div>
    ${compose ? composeHtml(t) : ''}
    ${inbox ? inboxHtml(t) : ''}
    <div class="sct" style="margin-bottom:7px">활동 기록 추가</div>
    <div class="li" style="margin-bottom:6px"><select id="lt-${t.id}">${LOG_TYPES.map(x => `<option>${x}</option>`).join('')}</select><input type="text" id="lx-${t.id}" placeholder="활동 내용 (예: 견적서 요청 메일 받음)" onkeydown="if(event.key==='Enter')addLog(${t.id})"></div>
    <div class="li"><input type="text" id="lm-${t.id}" placeholder="메모 (선택) — 약속·다음 할 일 (예: 10/15까지 회신)" onkeydown="if(event.key==='Enter')addLog(${t.id})"><button class="lsub" onclick="addLog(${t.id})">기록</button></div>
    <div class="sct">활동 이력 <span style="font-weight:400;color:var(--i4)">${t.log.length ? t.log.length + '건' : ''}</span></div>
    ${t.log.length ? '' : '<div style="font-size:11.5px;color:var(--i4);padding:6px 0 12px">아직 기록이 없어요 — 메일을 보내거나 위에서 한 줄 남겨 보세요</div>'}
    <div class="lls">${t.log.map((l, k) => logItemHtml(t, l, k)).join('')}</div>`;
}

function logItemHtml(t, l, k) {
  const color = l.color || LC[l.type] || '#9C9890';
  const who = l.to ? `→ ${l.to}` : l.from ? `← ${l.from}` : '';
  const editing = logUi.memoEdit === `${t.id}:${k}`;
  const small = 'font-size:10.5px;padding:2px 8px';
  const memo = editing
    ? `<div style="display:flex;gap:5px;margin-top:5px"><input class="fi" id="lme-${t.id}-${k}" value="${escAttr(l.memo || '')}" placeholder="짧게 — 약속·다음 할 일" style="flex:1;min-width:0;font-size:12px;padding:5px 8px"
         onkeydown="if(event.key==='Enter')saveLogMemo(${t.id},${k});if(event.key==='Escape')editLogMemo(${t.id},-1)">
       <button class="lsub" style="width:auto" onclick="saveLogMemo(${t.id},${k})">저장</button></div>`
    : l.memo
      ? `<div onclick="editLogMemo(${t.id},${k})" title="눌러서 메모 고치기" style="cursor:pointer;margin-top:4px;padding:4px 8px;border-radius:5px;background:var(--ab);font-size:11.5px;color:var(--i2);line-height:1.45">📝 ${escapeHtml(l.memo)}</div>`
      : '';
  return `<div class="lit"><div class="ltr"><div class="ld" style="background:${color}"></div>${k < t.log.length - 1 ? '<div class="lln"></div>' : ''}</div>
    <div class="lb2" style="min-width:0">
      <div style="display:flex;align-items:center;gap:5px"><div class="lty" style="color:${color};flex:1">${escapeHtml(l.type)}</div>
        ${l.mu ? `<button class="btn" style="${small}" onclick="openMailOriginal('un','${escAttr(l.mu)}')">원문</button>` : ''}
        ${editing || l.memo ? '' : `<button class="btn" style="${small}" onclick="editLogMemo(${t.id},${k})">+ 메모</button>`}</div>
      <div class="ltx">${escapeHtml(l.text)}</div>
      ${who ? `<div style="font-size:10.5px;color:var(--i4);overflow-wrap:anywhere">${escapeHtml(who)}</div>` : ''}
      ${l.fwdBy ? `<div style="font-size:10.5px;color:var(--i4)">↪ ${escapeHtml(l.fwdBy)} 전달</div>` : ''}
      ${l.attach ? `<div style="font-size:10.5px;color:var(--i4);overflow-wrap:anywhere">📎 ${escapeHtml(l.attach)}</div>` : ''}
      ${l.cc ? `<div style="font-size:10.5px;color:var(--i4);overflow-wrap:anywhere">참조 ${escapeHtml(l.cc)}</div>` : ''}
      ${l.body ? `<details style="margin-top:4px"><summary style="cursor:pointer;font-size:11px;color:var(--a);font-weight:600">본문 보기</summary>
        <div style="margin-top:4px;padding:8px 9px;border:1px solid var(--i7);border-radius:6px;background:var(--i8);font-size:11.5px;color:var(--i2);line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto">${escapeHtml(l.body)}</div></details>` : ''}
      ${memo}
      <div class="lda">${escapeHtml(l.at || l.date)}${l.by ? ` · ${escapeHtml(l.by)}` : ''}</div></div></div>`;
}

function composeHtml(t) {
  const cons = mailConOf(t);
  const ev = EVENT_LIST.find(e => e.key === t.event);
  return `<div style="border:1px solid var(--i6);border-radius:8px;padding:10px;margin-bottom:14px;background:var(--W)">
    <div style="font-size:11px;color:var(--i4);margin-bottom:8px;overflow-wrap:anywhere">보내는 주소 · <span id="cm-from-${t.id}" style="color:${fromCache[t.event] ? (fromCache[t.event].ok ? 'var(--i2)' : 'var(--re)') : 'inherit'}">${escapeHtml(fromCache[t.event]?.text || `${ev ? (ev.short || ev.name || ev.key) : (t.event || '행사 없음')} 공용 메일 확인 중…`)}</span></div>
    <div class="mlbl">받는 사람</div>
    ${cons.length ? `<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:6px">${cons.map((p, k) => `
      <label style="display:flex;align-items:center;gap:7px;font-size:12px;cursor:pointer;min-width:0"><input type="checkbox" class="cm-to-${t.id}" value="${escAttr(p.email)}"${k === 0 ? ' checked' : ''}>
        <span style="font-weight:600;flex-shrink:0">${escapeHtml(p.name)}</span><span style="color:var(--i4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.title ? p.title + ' · ' : '')}${escapeHtml(p.email)}</span></label>`).join('')}</div>`
      : '<div style="font-size:11px;color:var(--i4);margin-bottom:6px">기업DB에 메일 주소가 있는 담당자가 없어요 — 아래에 직접 적어 주세요</div>'}
    <input class="fi" id="cm-tox-${t.id}" type="email" placeholder="다른 주소 (쉼표로 여러 개)" style="margin-bottom:6px">
    <input class="fi" id="cm-cc-${t.id}" type="email" placeholder="참조 (선택)" style="margin-bottom:8px">
    <div class="mlbl">제목</div>
    <input class="fi" id="cm-sub-${t.id}" style="margin-bottom:8px">
    <div class="mlbl">내용</div>
    <textarea class="fi" id="cm-txt-${t.id}" rows="7" style="resize:vertical;margin-bottom:8px;font-family:inherit"></textarea>
    <div class="mlbl">기록 메모 (선택)</div>
    <input class="fi" id="cm-memo-${t.id}" placeholder="이력에 남길 한 줄 (예: 견적 회신 요청 — 10/15까지)" style="margin-bottom:10px">
    <div style="display:flex;gap:6px"><button class="btn" style="flex:1;justify-content:center" onclick="crmMailToggle(${t.id})">닫기</button>
      <button class="lsub" id="cm-send-${t.id}" style="flex:2" onclick="crmMailSend(${t.id})">보내기</button></div>
  </div>`;
}

/* 받은 메일 후보 — 이 기업 담당자 주소와 같거나, 그 도메인(흔한 메일 서비스 제외)에서 온 것 */
const FREE_MAIL = /^(gmail|naver|daum|hanmail|kakao|nate|hotmail|outlook|yahoo|icloud|live|me)\./i;
function inboxMatch(t, items) {
  const emails = new Set(mailConOf(t).map(p => p.email.trim().toLowerCase()));
  const doms = new Set([...emails].map(e => e.split('@')[1]).filter(d => d && !FREE_MAIL.test(d)));
  /* 직원이 전달한 메일은 원래 메일의 보낸 사람·받는 사람·참조로 견준다 */
  return items.filter(u => (u.fwd ? u.fwd.addrs || [] : [u.from_addr]).some(x => {
    const a = String(x || '').trim().toLowerCase();
    return emails.has(a) || doms.has(a.split('@')[1]);
  }));
}
function inboxHtml(t) {
  const c = inboxCache[t.id] || { loading: true };
  const head = '<div class="sct" style="margin-bottom:7px">받은 메일 — 이 기업 주소에서 온 것</div>';
  if (c.loading) return `<div style="margin-bottom:14px">${head}<div style="font-size:11.5px;color:var(--i4)">행사 메일함에서 찾는 중…</div></div>`;
  if (c.error) return `<div style="margin-bottom:14px">${head}<div style="font-size:11.5px;color:var(--re)">${escapeHtml(c.error)}</div></div>`;
  const rows = c.items || [];
  return `<div style="margin-bottom:14px">${head}
    ${rows.length ? rows.map(u => `<div style="border:1px solid var(--i7);border-radius:7px;padding:8px 9px;margin-bottom:6px">
      <div style="font-size:12px;font-weight:600;color:var(--i1)">${escapeHtml(u.subject || '(제목 없음)')}</div>
      <div style="font-size:10.5px;color:var(--i4);margin:2px 0 6px;overflow-wrap:anywhere">${u.fwd && u.fwd.from
        ? `${escapeHtml(u.fwd.from)}${u.fwd.to ? ` → ${escapeHtml(u.fwd.to)}` : ''} · ${escapeHtml(u.fwd.sent || u.ts || '')} · ↪ ${escapeHtml(u.fwd.by)} 전달`
        : `${escapeHtml(u.from_name ? `${u.from_name} <${u.from_addr}>` : u.from_addr)} · ${escapeHtml(u.ts || '')}`}</div>
      <input class="fi" id="ib-memo-${escAttr(u.id)}" placeholder="메모 (선택) — 무슨 내용인지 한 줄" style="font-size:12px;padding:5px 8px;margin-bottom:6px">
      <div style="display:flex;gap:6px"><button class="btn" style="font-size:11px" onclick="openMailOriginal('un','${escAttr(u.id)}')">원문 보기</button>
        <button class="lsub" style="flex:1" onclick="crmLinkMail(${t.id},'${escAttr(u.id)}')">이력에 넣기</button></div></div>`).join('')
      : `<div style="font-size:11.5px;color:var(--i4);line-height:1.5">새로 온 메일이 없어요.<br>행사 메일함은 15분마다 읽어요. 연사·참가사로 등록된 주소에서 온 메일은 그쪽 기록에 붙어 여기 나오지 않아요.<br>전화로 들은 것처럼 직접 남기려면 아래에서 «메일 받음»으로 기록하세요.</div>`}
  </div>`;
}

export function crmMailToggle(id) {
  logUi.compose = logUi.compose === id ? null : id;
  const t = targets.find(x => x.id === id);
  if (!t) return;
  renderDrBd(t);
  if (logUi.compose !== id) return;
  document.getElementById('cm-sub-' + id)?.focus();
  eventMailFrom(t.event).then(r => {
    fromCache[t.event] = r;
    const el = document.getElementById('cm-from-' + id);
    if (!el) return;
    el.textContent = r.text;
    el.style.color = r.ok ? 'var(--i2)' : 'var(--re)';
  });
}

export async function crmMailSend(id) {
  const t = targets.find(x => x.id === id);
  if (!t) return;
  const v = (k) => (document.getElementById(`cm-${k}-${id}`)?.value || '').trim();
  const to = [...document.querySelectorAll('.cm-to-' + id)].filter(x => x.checked).map(x => x.value)
    .concat(v('tox').split(/[,;\s]+/).filter(Boolean));
  if (!to.length) { alert('받는 사람을 골라 주세요.'); return; }
  const bad = to.concat(v('cc').split(/[,;\s]+/).filter(Boolean)).find(a => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a));
  if (bad) { alert(`메일 주소가 이상해요: ${bad}`); return; }
  if (!v('sub')) { alert('제목을 적어 주세요.'); return; }
  if (!v('txt')) { alert('내용을 적어 주세요.'); return; }
  if (!confirm(`${to.join(', ')}\n에게 «${v('sub')}» 메일을 보낼까요?`)) return;
  const btn = document.getElementById('cm-send-' + id);
  if (btn) { btn.disabled = true; btn.textContent = '보내는 중…'; }
  const subject = v('sub');
  const r = await sendMail({ to, cc: v('cc'), subject, text: v('txt'), crm_target_id: String(t.id), memo: v('memo') });
  if (!r.ok) {
    if (btn) { btn.disabled = false; btn.textContent = '보내기'; }
    alert(r.error || '보내지 못했어요');
    return;
  }
  if (r.crmEntry) { t.log.unshift(r.crmEntry); t.lastActivity = r.crmEntry.date; }
  logUi.compose = null;
  renderDrBd(t);
  renderCrm();
  if (!r.logged) alert(`메일은 보냈지만 이력에 남기지 못했어요${r.logError ? ` (${r.logError})` : ''} — 아래에서 «메일 보냄»으로 한 줄 남겨 주세요.`);
  else if (r.sentError) alert(`메일은 보냈어요. 보낸메일함 사본은 넣지 못했어요 (${r.sentError})`);
  trackAction('log', '메일 발송', t.name,
    `<b>${escapeHtml(t.name)}</b>에 메일 «${escapeHtml(subject)}» 발송 → ${escapeHtml(to.join(', '))}`,
    { kind: 'target', id: t.id });
}

export async function crmInboxToggle(id) {
  logUi.inbox = logUi.inbox === id ? null : id;
  const t = targets.find(x => x.id === id);
  if (!t) return;
  if (logUi.inbox !== id) { renderDrBd(t); return; }
  inboxCache[id] = { loading: true };
  renderDrBd(t);
  const r = t.event ? await loadUnassigned(t.event) : { ok: false, error: '이 타겟에 행사가 없어요' };
  inboxCache[id] = r.ok ? { items: inboxMatch(t, r.items || []) }
    : { error: r.offline ? '테스트 모드에서는 메일함을 읽지 않아요' : (r.error || '메일함을 읽지 못했어요') };
  if (logUi.inbox === id && drID === id && drTab === 1) renderDrBd(t);
}

export async function crmLinkMail(id, muId) {
  const t = targets.find(x => x.id === id);
  if (!t) return;
  const memo = (document.getElementById('ib-memo-' + muId)?.value || '').trim();
  const r = await linkUnassignedCrm(muId, { targetId: String(id), memo });
  if (!r.ok) { alert(r.error || '넣지 못했어요'); return; }
  t.log.unshift(r.entry);
  /* 날짜순으로 — 예전에 온 메일을 지금 붙이면 맨 위가 아니라 제자리에 */
  t.log.sort((a, b) => String(b.at || b.date || '').localeCompare(String(a.at || a.date || '')));
  if (String(r.entry.date) > String(t.lastActivity || '')) t.lastActivity = r.entry.date;
  const c = inboxCache[id];
  if (c && c.items) c.items = c.items.filter(u => u.id !== muId);
  renderDrBd(t);
  renderCrm();
  trackAction('log', '받은 메일 연결', t.name,
    `<b>${escapeHtml(t.name)}</b> 컨택 이력에 받은 메일 «${escapeHtml(r.entry.text)}» 연결`, { kind: 'target', id: t.id });
}

export function editLogMemo(id, k) {
  logUi.memoEdit = k < 0 ? null : `${id}:${k}`;
  const t = targets.find(x => x.id === id);
  if (!t) return;
  renderDrBd(t);
  if (k >= 0) { const el = document.getElementById(`lme-${id}-${k}`); if (el) { el.focus(); el.select(); } }
}

export async function saveLogMemo(id, k) {
  const t = targets.find(x => x.id === id);
  if (!t || !t.log[k]) return;
  const val = (document.getElementById(`lme-${id}-${k}`)?.value || '').trim();
  const prev = t.log[k].memo || '';
  logUi.memoEdit = null;
  if (val === prev) { renderDrBd(t); return; }
  t.log[k].memo = val;
  renderDrBd(t);
  const r = await saveTargetToSheet(t);
  if (!r.ok) { t.log[k].memo = prev; renderDrBd(t); return; }
  trackAction('log', '컨택 메모', t.name,
    `<b>${escapeHtml(t.name)}</b> 컨택 이력 «${escapeHtml(t.log[k].text)}» 메모: "${escapeHtml(val)}"`, { kind: 'target', id: t.id });
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
  /* 법인 표기는 따로 떨어진 낱말일 때만 뗀다 — 경계 없이 떼면 «Coway»가 «way»,
     «Incheon»이 «heon»이 되어 엉뚱한 회사와 같은 키가 됐다. */
  .replace(/\(주\)|주식회사|㈜|\b(?:inc|corp|co|ltd)\b\.?/gi, '')
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
/* 이 기업 담당자 중 연사로 들어간 사람 — 행사마다 한 줄 */
const spkOf = (t) => conOf(t).flatMap(p => speakersOfContact(p.id).map(sp => ({ p, sp })))
  .filter(({ sp }) => !flowStatus(sp).skip);   // VIP(주최사 전달)는 우리가 연락하지 않는다

/* 연사 연락 — 컨퍼런스의 연락 단계를 CRM에서도 본다. 고치는 곳은 연사 화면이다. */
export function dSpk(t) {
  const rows = spkOf(t);
  if (!rows.length) return '<div class="empty"><p>이 기업 사람 중 연사로 들어간 사람이 없어요</p></div>';
  return rows.map(({ p, sp }) => {
    const f = flowStatus(sp);
    const na = nextActionLabel(sp);
    const ev = EVENT_LIST.find(e => e.key === sp.event_id);
    return `<div class="evc2">
      <div class="evc2tp"><div class="evnm">${escapeHtml(sp.name_snapshot || sp.name_en || p.name)}</div>
        <div class="evdt">${escapeHtml(ev ? (ev.short || ev.name || ev.key) : sp.event_id)}</div></div>
      <div style="display:flex;flex-wrap:wrap;gap:3px;margin:5px 0">${f.steps.filter(s => s.applies).map(s => {
        const cur = f.current && f.current.key === s.key;
        return `<span style="font-size:10px;padding:1px 6px;border-radius:9px;background:${s.isDone ? 'var(--gb)' : cur ? 'var(--ad)' : 'var(--i8)'};color:${
          s.isDone ? 'var(--g)' : cur ? 'var(--a)' : 'var(--i4)'}${cur ? ';font-weight:700' : ''}">${s.isDone ? '✓' : cur ? '●' : '○'} ${escapeHtml(s.label)}</span>`;
      }).join('')}</div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="font-size:11.5px;font-weight:600;color:${na.done ? 'var(--g)' : 'var(--a)'};flex:1">${na.done ? '✓ 연락 완료' : `지금 할 일 · ${escapeHtml(na.text)}`}${
          na.due ? ` <span style="font-weight:400;color:${na.due < td() ? 'var(--re)' : 'var(--i4)'};font-size:10.5px">마감 ${escapeHtml(na.due)}</span>` : ''}</div>
        <button class="btn" style="font-size:10.5px" onclick="closeDr();openSpeakerDr('${escAttr(sp.id)}'${na.done ? '' : `);openFlowDraft('${escAttr(na.step)}'`})">${na.done ? '연사 열기' : '✉ 메일 초안'}</button>
      </div></div>`;
  }).join('');
}
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
    `<b>${escapeHtml(targets[i].name)}</b>의 진행 단계를 <b>${escapeHtml(prevLabel)} → ${escapeHtml(STGS_KR[stage-1])}</b>로 변경`,
    changed('crm_targets', targets[i].id, prev, { currentStage: stage }, { kind: 'target', id: targets[i].id }));
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
    `<b>${escapeHtml(targets[i].name)}</b>의 컨택 상태를 <b>${escapeHtml(prev.status)} → ${escapeHtml(val)}</b>로 변경`,
    changed('crm_targets', targets[i].id, prev, { status: val }, { kind: 'target', id: targets[i].id }));
}
export async function addLog(id) {
  const i = targets.findIndex(x => x.id === id);
  if (i < 0) return;
  const type = document.getElementById('lt-' + id).value;
  const text = document.getElementById('lx-' + id).value.trim();
  const memo = (document.getElementById('lm-' + id)?.value || '').trim();
  if (!text && !memo) return;
  const prevLastActivity = targets[i].lastActivity;
  targets[i].log.unshift({ type, text: text || memo, ...(text && memo ? { memo } : {}), date: td(),
    by: currentUser?.name || currentUser?.email || '', color: LC[type] || '#9C9890' });
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
    `<b>${escapeHtml(targets[i].name)}</b>에 <b>${escapeHtml(type)}</b> 기록 추가: "${escapeHtml(text)}"`,
    { kind: 'target', id: targets[i].id });
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
  /* 같은 행사에 같은 기업이 두 줄이면 진행 단계가 갈려 어느 쪽이 최신인지 알 수
     없다. 표기가 흔들려도(«(주)코웨이» / «코웨이») 같은 곳으로 보도록 nameKey로 맞춘다.
     지사·부서별로 따로 쫓는 경우가 있어 막지는 않고 묻는다. */
  const evSel = document.getElementById('m-ev').value;
  const k = nameKey(mSel.name);
  const dup = k && targets.find(x => x.event === evSel
    && [x.name, x.nameEn, ...(x.branches || [])].some(n => nameKey(n) === k));
  if (dup && !confirm(`«${dup.name}»은(는) 이미 ${evSel || '이 행사'} 타겟에 있어요(${dup.status || '미접촉'}).\n그래도 한 줄 더 추가할까요?`)) return;
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
  trackAction('add', '타겟 추가', t.name, `CRM 타겟 추가: ${t.name} / ${t.event}`,
    { kind: 'target', id: t.id });
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
window.clearEvF = clearEvF;
window.filterSt2 = filterSt2;
window.switchCV = switchCV;
window.crmAdd = crmAdd;
window.renderCrm = renderCrm;
window.searchCrmM = searchCrmM;
window.tblF = tblF;
window.chgSt = chgSt;
window.clearCrmSelection = clearCrmSelection;
window.moveCrmSelected = moveCrmSelected;
window.openDr = openDr;
window.closeDr = closeDr;
window.switchDT = switchDT;
window.setStg = setStg;
window.chgStD = chgStD;
window.addLog = addLog;
window.crmMailToggle = crmMailToggle;
window.crmMailSend = crmMailSend;
window.crmInboxToggle = crmInboxToggle;
window.crmLinkMail = crmLinkMail;
window.editLogMemo = editLogMemo;
window.saveLogMemo = saveLogMemo;
window.openModal = openModal;
window.closeModal = closeModal;
window.mSrch = mSrch;
window.pickCo = pickCo;
window.addTarget = addTarget;
