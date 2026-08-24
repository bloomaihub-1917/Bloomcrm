/* ══════════════════════════════════════════════════════════════
   exh-tab.js — 전시 참가기업 진행관리 (전시 탭)

   기존 CRM 탭은 일반 영업 파이프라인(미접촉→컨택중→확정)이라 성격이 완전히
   달라 섞지 않고 분리했다. 여기서 다루는 건 전시 실무 흐름이다:
     매뉴얼 발송/회신 → 신청서 → 부스 배정 → 정산(인보이스·세금계산서·입금)
     → 그래픽 → 도록 → 현장
   여기에 더해, 단계와 무관하게 수시로 들어오는 문의사항을 받아 적고
   답변 여부를 추적한다(답변 안 한 문의가 묻히는 게 가장 큰 리스크).

   데이터는 전부 서버 컬럼명(snake_case) 그대로 다룬다 — 변환 레이어를 두지
   않아 저장할 때 필드명이 어긋날 여지를 없앴다.
═══════════════════════════════════════════════════════════════ */

import {
  EXHIBITORS, EXH_ITEMS, EXH_INVOICES, EXH_PAYMENTS, EXH_LOGS,
  exhEvent, setExhEvent,
  exhibitorsForEvent, getExhibitorById, itemsFor, invoicesFor, paymentsFor,
  logsFor, openInquiriesFor, contactsFor, primaryContactFor,
  EVENT_LIST, contacts, participations, CO_DB, currentUser, API_BASE_URL,
} from '../state.js';
import { td, escapeHtml, escAttr, isMobile } from '../utils.js';
import {
  postToSheet,
  saveExhibitor, saveExhItem, saveExhInvoice, saveExhPayment, saveExhLog,
  deleteExhItem, deleteExhInvoice, deleteExhPayment, deleteExhLog,
  batchCreateExhibitors,
} from '../api.js';
import { trackAction } from './audit-tab.js';
import { normalizeCompanyKey } from './company-tab.js';

/* 전시 참가기업으로 취급할 참가 역할 — 데이터에 표기 흔들림이 있어 함께 본다 */
const EXH_ROLES = ['전시참가기업', '전시기업', '전시참가'];

/* 참가 취소된 기업은 지우지 않고 상태로 남긴다 — 왜 빠졌는지 나중에 알 수 있어야 하고,
   그동안 주고받은 문의·정산 기록도 보존해야 하기 때문. 기본 목록과 집계에서는 빠진다. */
export const CANCELLED = '취소';
export function activeExhibitors(evKey){
  return exhibitorsForEvent(evKey).filter(x => x.status !== CANCELLED);
}
export function cancelledExhibitors(evKey){
  return exhibitorsForEvent(evKey).filter(x => x.status === CANCELLED);
}

/* 스폰서 등급별 배지색 — 'Exhibitor'(일반)는 배지를 달지 않는다 */
const GRADE_CLS = { DIA: 'p-indigo', GOLD: 'p-gold', SILVER: 'p-gray', BRONZE: 'p-amber' };

/* 체크리스트 표의 열 정의. key는 exhibitors 컬럼, 또는 파생 계산(calc). */
const STEPS = [
  { key: 'manual_sent_at',       label: '매뉴얼<br>발송' },
  { key: 'manual_replied_at',    label: '매뉴얼<br>회신' },
  { key: 'app_received_at',      label: '신청서',   flag: 'app_received',
    warn: (x) => (x.app_received_at || x.app_received === 'yes') && x.app_complete === 'no' },
  { key: 'booth_confirmed_at',   label: '부스', flag: 'booth_confirmed' },
  { key: 'calc:invoice',         label: '인보이스' },
  { key: 'tax_sent_at',          label: '세금<br>계산서' },
  { key: 'calc:payment',         label: '입금' },
  { key: 'calc:graphic',         label: '그래픽' },
  { key: 'directory_received_at',label: '도록', flag: 'directory_received' },
  { key: 'movein_at',            label: '현장' },
];

let exhFilter = 'all';       // all | incomplete | unpaid | inquiry | billing | cancelled
let exhAssignee = null;      // null = 전체
let exhView = 'dash';        // dash(대시보드) | list(체크리스트)

/* 드로어는 exh-drawer.js가 소유한다. 이 파일이 그쪽을 import하면 순환 참조가
   되므로(드로어가 여기 집계 함수를 쓴다) window 경유로만 호출한다 —
   기존 모듈들이 window.switchApp?.() 를 쓰는 것과 같은 방식. */

/* ══════════════════════════════════════════
   집계 헬퍼 — 여러 화면이 같은 정의를 쓰도록 한곳에 모은다
══════════════════════════════════════════ */
const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
export const money = (v) => num(v).toLocaleString('ko-KR');

/* ── 정산 계산 ──────────────────────────────────────────────────
   실무에서 자주 나오는 상황을 그대로 반영한다:
   - 통화 변경·금액 오류로 인보이스를 다시 발행 → 옛 건은 'void'로 두고 합계에서 뺀다
   - 금액을 아직 모르는 인보이스(발행 예정) → 합계에 넣지 않는다
   - 환불·차감 → 입금에서 뺀다
   - 해외 송금 수수료로 몇 달러 덜 들어옴 → 사유를 적고 완납으로 닫을 수 있다
   ────────────────────────────────────────────────────────────── */
const hasAmount = (r) => String(r.amount ?? '').trim() !== '';
export const liveInvoices = (exhId) =>
  invoicesFor(exhId).filter(i => i.status !== 'void' && hasAmount(i));

/* 이 기업의 청구 통화. 유효한 인보이스를 우선으로 보고, 없으면 금액 항목을 본다.
   서로 다른 통화가 섞이면 합계를 낼 수 없으므로 하나를 고르고 경고를 띄운다. */
export function currencyOf(exhId){
  const src = liveInvoices(exhId);
  const hit = (src.length ? src : itemsFor(exhId)).find(r => r.currency);
  return (hit && hit.currency) || 'KRW';
}
const sumIn = (rows, cur) => rows
  .filter(r => (r.currency || 'KRW') === cur)
  .reduce((s, r) => s + num(r.amount), 0);

/* 한 기업에 통화가 섞였는지 — 섞이면 한쪽이 합계에서 빠지므로 화면에 알린다 */
export function mixedCurrency(exhId){
  const cs = new Set([...liveInvoices(exhId), ...paymentsFor(exhId).filter(hasAmount)]
    .map(r => r.currency).filter(Boolean));
  return cs.size > 1 ? [...cs] : null;
}

/* 청구액: 유효한 인보이스 합계. 아직 한 장도 없으면 금액 항목 합계를 예상액으로 쓴다. */
export function billedAmount(exhId){
  const cur = currencyOf(exhId);
  const inv = liveInvoices(exhId);
  return inv.length ? sumIn(inv, cur) : sumIn(itemsFor(exhId), cur);
}
/* 입금액: 입금 − 환불 */
export function paidAmount(exhId){
  const cur = currencyOf(exhId);
  return paymentsFor(exhId)
    .filter(p => (p.currency || 'KRW') === cur)
    .reduce((s, p) => s + (p.kind === 'refund' ? -num(p.amount) : num(p.amount)), 0);
}

/* 이 기업의 입금 기한 — 기업별 지정이 없으면 행사 공통 기한, 그것도 없으면
   인보이스에 적힌 기한을 쓴다. */
export function payDueDate(x){
  if(x.pay_due_date) return x.pay_due_date;
  const ev = eventDeadlines(x.event_id);
  if(ev.pay) return ev.pay;
  const withDue = invoicesFor(x.id).filter(i => i.due_date && i.status !== 'void');
  return withDue.length ? withDue.map(i => i.due_date).sort()[0] : '';
}

/* 정산 상태 한 곳에서 판정 — 표·드로어·필터가 같은 기준을 쓴다 */
export function settleState(x){
  const billed = billedAmount(x.id), paid = paidAmount(x.id);
  const cur = currencyOf(x.id);
  const balance = billed - paid;
  const due = payDueDate(x);
  const overdue = !!due && daysSince(due) > 0;
  if(x.settled === 'yes')   return { state:'settled', billed, paid, balance, cur, due, overdue:false };
  if(!billed)               return { state:'none',    billed, paid, balance, cur, due, overdue:false };
  if(paid > billed)         return { state:'over',    billed, paid, balance, cur, due, overdue:false };
  if(paid >= billed)        return { state:'paid',    billed, paid, balance, cur, due, overdue:false };
  if(paid > 0)              return { state:'partial', billed, paid, balance, cur, due, overdue };
  return { state:'unpaid', billed, paid, balance, cur, due, overdue };
}

/* 금액 표시 — 통화 기호를 붙인다 */
export function fmtMoney(v, cur){
  return (cur === 'USD' ? '$' : '') + money(v) + (cur === 'USD' ? '' : '원');
}

/* 행사 공통 마감일 — settings 시트에 exh_due_<행사키>로 저장한다.
   기업별 지정이 없을 때의 기본값이며, 기업별 값이 있으면 그쪽이 이긴다. */
export function eventDeadlines(evKey){
  try {
    const row = SETTINGS_CACHE.get('exh_due_' + evKey);
    return row ? JSON.parse(row) : {};
  } catch(e){ return {}; }
}
const SETTINGS_CACHE = new Map();
export function setEventDeadlines(evKey, obj){ SETTINGS_CACHE.set('exh_due_' + evKey, JSON.stringify(obj)); }
export function loadEventDeadlines(settingsRows){
  (settingsRows || []).forEach(r => {
    if(String(r.key || '').startsWith('exh_due_')) SETTINGS_CACHE.set(r.key, r.value);
  });
}

/* 그래픽 진행 상태 — 주문 안 했으면 해당 없음, 출력/제작에 따라 완료 기준이 다르다 */
export function graphicState(x){
  if(!x.graphic_ordered_at) return { state: 'none' };
  if(x.graphic_type === 'print'){
    if(x.graphic_spec_ok === 'no') return { state: 'warn', text: '규격 확인' };
    return x.graphic_spec_ok === 'yes' ? { state: 'done', text: '출력' } : { state: 'todo', text: '규격 미확인' };
  }
  if(x.graphic_type === 'design'){
    if(x.graphic_final_at)   return { state: 'done', text: '최종안' };
    if(x.graphic_revised_at) return { state: 'todo', text: '수정안' };
    if(x.graphic_draft_at)   return { state: 'todo', text: '초안' };
    return { state: 'todo', text: '진행 전' };
  }
  return { state: 'todo', text: '유형 미정' };
}

/* 담당자 한 줄(exhibitor_contacts 레코드)을 화면용으로 푼다.
   contact_id가 있으면 마스터DB(contacts)에서 실시간으로 읽는다 — 값을 복사해두면
   마스터DB에서 이메일을 고쳐도 전시 쪽은 옛 값으로 남기 때문이다.
   마스터DB에 없는 사람은 그 줄에 직접 적은 값을 쓴다. */
export function resolveContact(row){
  if(!row) return null;
  if(row.contact_id){
    const c = contacts.find(k => String(k.id) === String(row.contact_id));
    if(c) return {
      row, linked: true, id: c.id,
      name:  c.nameKo || c.nameEn || '',
      email: cleanEmail(c.email1),
      phone: c.phone1 || '',
      title: c.titleKo || c.titleEn || '',
      role:  row.role || '', primary: row.is_primary === 'yes',
    };
  }
  return { row, linked: false, id: null, name: row.name || '', email: cleanEmail(row.email),
    phone: row.phone || '', title: '', role: row.role || '', primary: row.is_primary === 'yes' };
}

/* 이 기업의 담당자 전원 (대표가 맨 앞) */
export function exhContacts(x){
  return contactsFor(x.id).map(resolveContact).filter(Boolean);
}
/* 대표 담당자 — 목록/헤더에 한 명만 보여줄 때 */
export function exhContact(x){
  return resolveContact(primaryContactFor(x.id))
    // 아직 담당자 줄이 없는 기업은 빈 값으로 (화면이 깨지지 않게)
    || { row: null, linked: false, id: null, name: '', email: '', phone: '', title: '', role: '', primary: false };
}
/* 업로드 원본에 <a@b.com> 처럼 꺾쇠가 섞여 들어온 건이 있어 표시 전에 벗긴다 */
export const cleanEmail = (e) => String(e || '').replace(/[<>]/g, '').trim();

/* 이 기업의 마스터DB 연락처 후보 — 드로어 드롭다운에 쓴다 */
export function contactsForExhibitor(x){
  const key = x.company_key || '';
  return contacts.filter(c => {
    const k = normalizeCompanyKey(c.orgKo || c.orgEn || '');
    return k && (k === key || k === normalizeCompanyKey(x.company_name || ''));
  });
}

/* 진행률 바 — components.css 규약이 .br(행) > .brt(트랙) > .brf(채움)인데
   .brt를 빼거나 .brf에 배경을 안 주면 막대가 아예 보이지 않는다. */
export function progressBar(pct, color = 'var(--a)', width = ''){
  return `<div class="br" style="margin:0${width ? `;width:${width}` : ''}">
    <div class="brt"><div class="brf" style="width:${Math.max(0, Math.min(100, pct))}%;background:${color}"></div></div>
  </div>`;
}

/* 표에 넣을 짧은 표시값 — 날짜(YYYY-MM-DD)는 월-일만 남기고, 그 외 상태 문자열은
   그대로 쓴다. 예전에는 무조건 5글자를 잘라 '규격 미확인'이 '인'으로 보였다. */
export function shortCell(v){
  const s = String(v || '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(5, 10) : s;
}

export function daysSince(dateStr){
  if(!dateStr) return 0;
  const d = new Date(dateStr);
  if(isNaN(d)) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

/* 셀 상태 계산 — 완료(done) / 미완(todo) / 주의(warn) */
function cellState(x, step){
  if(step.key === 'calc:invoice'){
    const inv = invoicesFor(x.id).filter(i => i.status !== 'void');
    if(!inv.length) return { state: 'todo' };
    const sent = inv.filter(i => i.sent_at);
    if(!sent.length) return { state: 'warn', text: '미발송' };
    // 금액이 안 적힌 인보이스가 있으면 청구액이 실제보다 적게 잡힌다 — 눈에 띄게 한다
    if(inv.some(i => String(i.amount ?? '').trim() === '')) return { state: 'warn', text: '금액 미입력' };
    return { state: 'done', text: sent.length > 1 ? `${sent.length}건` : sent[0].sent_at };
  }
  if(step.key === 'calc:payment'){
    const s = settleState(x);
    if(s.state === 'settled') return { state: 'done', text: '완납 처리' };
    if(s.state === 'paid')    return { state: 'done', text: '완납' };
    if(s.state === 'over')    return { state: 'warn', text: '초과 입금' };
    if(s.state === 'none')    return { state: 'todo' };
    if(s.state === 'partial') return { state: 'part', text: Math.round(s.paid / s.billed * 100) + '%' };
    return s.overdue ? { state: 'warn', text: '기한 지남' } : { state: 'todo' };
  }
  if(step.key === 'calc:graphic'){
    const g = graphicState(x);
    if(g.state === 'none') return { state: 'na' };
    return g;
  }
  const v = x[step.key];
  // 관리대장에 O/X만 있고 날짜가 없는 항목이 많다. 날짜를 지어내지 않되
  // "받았다"는 사실은 완료로 인정한다(날짜가 없으면 ✓만 표시).
  const done = v || (step.flag && x[step.flag] === 'yes');
  if(step.warn && step.warn(x)) return { state: 'warn', text: v || '' };
  return done ? { state: 'done', text: v || '' } : { state: 'todo' };
}

/* 기업별 진행률 — 해당 없음(그래픽 미주문)은 분모에서 제외 */
function progressOf(x){
  let done = 0, total = 0;
  STEPS.forEach(s => {
    const c = cellState(x, s);
    if(c.state === 'na') return;
    total++;
    if(c.state === 'done') done++;
  });
  return total ? Math.round(done / total * 100) : 0;
}

/* ══════════════════════════════════════════
   사이드바
══════════════════════════════════════════ */
/* 고를 수 있는 행사 목록.
   events 테이블(EVENT_LIST)에 등록되지 않았는데 participations에는 전시참가기업으로
   올라와 있는 행사가 실제로 존재한다(업로드 시 행사를 따로 만들지 않은 경우).
   그런 행사도 전시 관리 대상이므로 key만으로 만들어 함께 보여준다. */
export function exhEventOptions(){
  const map = new Map(EVENT_LIST.map(e => [e.key, e]));
  const addLoose = (key) => {
    if(!key || map.has(key)) return;
    map.set(key, { key, name: key, short: key, color: '#9C9890', loose: true });
  };
  participations.forEach(p => {
    if(EXH_ROLES.includes(String(p.role || '').trim())) addLoose(p.eventId);
  });
  EXHIBITORS.forEach(x => addLoose(x.event_id));
  return [...map.values()];
}

export function buildExhEvList(){
  const el = document.getElementById('exh-ev-list');
  if(!el) return;
  const opts = exhEventOptions();
  // 참가기업이 등록됐거나 전시 대상이 있는 행사를 위로, 나머지는 아래로
  const hasWork = (k) => exhibitorsForEvent(k).length || exhibitorCandidates(k).length;
  const list = opts.filter(e => hasWork(e.key));
  const rest = opts.filter(e => !hasWork(e.key));
  if((!exhEvent || !opts.some(e => e.key === exhEvent)) && list.length) setExhEvent(list[0].key);

  const row = (e, n) => `<button class="nr${exhEvent === e.key ? ' on' : ''}" onclick="setExhEvent2('${escAttr(e.key)}')">
      <span class="ev-pill-dot" style="background:${escAttr(e.color || '#9C9890')}"></span>${escapeHtml(e.short || e.name || e.key)}
      ${n ? `<span class="nbg">${n}</span>` : ''}</button>`;

  el.innerHTML = (list.map(e => row(e, activeExhibitors(e.key).length)).join('')
    + (rest.length ? `<div style="font-size:10px;color:var(--i4);margin:8px 0 4px;padding-left:2px">전시 대상 없음</div>`
        + rest.map(e => row(e, 0)).join('') : ''))
    || '<div style="font-size:11px;color:var(--i4);padding:6px 2px">등록된 행사가 없어요</div>';

  buildExhFilters();
}

function buildExhFilters(){
  const el = document.getElementById('exh-filter-list');
  if(el){
    const list = activeExhibitors(exhEvent);
    const openInq = list.reduce((s, x) => s + openInquiriesFor(x.id).length, 0);
    const incomplete = list.filter(x => progressOf(x) < 100).length;
    const unpaid = list.filter(x => ['unpaid','partial'].includes(settleState(x).state)).length;
    const cancelled = cancelledExhibitors(exhEvent).length;
    // 초과 입금·통화 혼재·금액 미입력처럼 사람이 봐야 하는 정산 건
    const attention = list.filter(x => settleState(x).state === 'over' || mixedCurrency(x.id) ||
      invoicesFor(x.id).some(i => i.status !== 'void' && String(i.amount ?? '').trim() === '')).length;
    const f = (k, label, n) => `<button class="nr${exhFilter === k ? ' on' : ''}" onclick="setExhFilter('${k}')">${label}<span class="nbg">${n}</span></button>`;
    el.innerHTML = f('all', '전체', list.length) + f('incomplete', '진행 중', incomplete)
      + f('unpaid', '입금 미완료', unpaid) + f('inquiry', '미답변 문의', openInq)
      + (attention ? f('billing', '정산 확인 필요', attention) : '')
      + (cancelled ? f('cancelled', '참가 취소', cancelled) : '');
  }
  const ael = document.getElementById('exh-assignee-list');
  if(ael){
    const list = activeExhibitors(exhEvent);
    const names = [...new Set(list.map(x => x.assignee).filter(Boolean))].sort();
    ael.innerHTML = `<button class="nr${!exhAssignee ? ' on' : ''}" onclick="setExhAssignee('')">전체<span class="nbg">${list.length}</span></button>`
      + names.map(n => {
        const mine = list.filter(x => x.assignee === n);
        const open = mine.reduce((s, x) => s + openInquiriesFor(x.id).length, 0);
        return `<button class="nr${exhAssignee === n ? ' on' : ''}" onclick="setExhAssignee('${escAttr(n)}')">${escapeHtml(n)}<span class="nbg">${mine.length}${open ? ` · 문의${open}` : ''}</span></button>`;
      }).join('');
  }
}

/* 하단 네비 배지 — 미답변 문의가 있으면 숫자를 띄운다(놓치지 않는 게 핵심 기능이라
   다른 탭에 있어도 보이게). */
function updateExhBadge(){
  const el = document.getElementById('mn-exh-badge');
  if(!el) return;
  const n = activeExhibitors(exhEvent).reduce((s, x) => s + openInquiriesFor(x.id).length, 0);
  el.textContent = n > 99 ? '99+' : String(n);
  el.style.display = n ? 'block' : 'none';
}

export function setExhView(v){ exhView = v; renderExh(); }
export function setExhEvent2(key){ setExhEvent(key); buildExhEvList(); renderExh(); }
export function setExhFilter(k){ exhFilter = k; buildExhFilters(); renderExh(); }
export function setExhAssignee(n){ exhAssignee = n || null; buildExhFilters(); renderExh(); }

/* ══════════════════════════════════════════
   메인 — 미답변 문의 패널 + 체크리스트 표
══════════════════════════════════════════ */
function visibleList(){
  const q = (document.getElementById('exh-q')?.value || '').trim().toLowerCase();
  let list = exhFilter === 'cancelled' ? cancelledExhibitors(exhEvent) : activeExhibitors(exhEvent);
  if(exhAssignee) list = list.filter(x => x.assignee === exhAssignee);
  if(exhFilter === 'incomplete') list = list.filter(x => progressOf(x) < 100);
  if(exhFilter === 'unpaid')     list = list.filter(x => ['unpaid','partial'].includes(settleState(x).state));
  if(exhFilter === 'billing')    list = list.filter(x => { const s = settleState(x);
    return s.state === 'over' || mixedCurrency(x.id) ||
      invoicesFor(x.id).some(i => i.status !== 'void' && String(i.amount ?? '').trim() === ''); });
  if(exhFilter === 'inquiry')    list = list.filter(x => openInquiriesFor(x.id).length);
  if(q) list = list.filter(x => String(x.company_name || '').toLowerCase().includes(q));
  return list.sort((a, b) => String(a.company_name || '').localeCompare(String(b.company_name || ''), 'ko'));
}

export function renderExh(){
  const el = document.getElementById('exh-body');
  if(!el) return;

  const ev = exhEventOptions().find(e => e.key === exhEvent);
  const ttl = document.getElementById('exh-ttl');
  if(ttl) ttl.innerHTML = `전시 진행관리 <span class="tb-s">${ev ? escapeHtml(ev.short || ev.name) + ' · ' : ''}참가기업 준비 현황</span>`;
  // 모바일 헤더 제목은 행사명으로 (화면이 좁아 부제를 넣을 자리가 없다)
  const mttl = document.getElementById('mob-exh-ttl');
  if(mttl) mttl.textContent = ev ? (ev.short || ev.name || '전시 진행관리') : '전시 진행관리';
  updateExhBadge();

  const list = visibleList();
  const all = activeExhibitors(exhEvent);

  if(!all.length){
    el.innerHTML = `<div class="empty" style="padding:60px 20px;text-align:center">
      <div style="font-size:30px;margin-bottom:10px">🏢</div>
      <div style="font-weight:700;margin-bottom:6px">등록된 참가기업이 없어요</div>
      <div style="font-size:12px;color:var(--i4);margin-bottom:14px">
        기업DB에 "전시참가기업"으로 기록된 기업을 불러오거나 직접 추가할 수 있어요</div>
      <button class="btn bp" onclick="openExhImport()">참가기업 불러오기</button></div>`;
    return;
  }

  const seg = `<div class="tbar" style="padding:10px 16px 0">
    <div class="seg">
      <button class="seg-b${exhView === 'dash' ? ' on' : ''}" onclick="setExhView('dash')">대시보드</button>
      <button class="seg-b${exhView === 'list' ? ' on' : ''}" onclick="setExhView('list')">체크리스트</button>
    </div></div>`;
  el.innerHTML = seg + (exhView === 'dash'
    ? renderDashboard(all)
    : renderInquiryPanel() + renderChecklist(list, all));
}

/* 미답변 문의 패널 — 프로세스와 무관하게 들어오는 문의를 놓치지 않는 게 목적이라
   화면 최상단에 두고 오래된 것부터 보여준다. */
function renderInquiryPanel(){
  // 취소 기업은 사이드바 카운트·하단 배지·필터에서 빠지므로 여기서도 빼서
  // "패널엔 보이는데 클릭하면 목록에 없는" 상태를 막는다.
  const list = activeExhibitors(exhEvent);
  const open = [];
  list.forEach(x => openInquiriesFor(x.id).forEach(l => open.push({ l, x })));
  if(!open.length) return '';
  open.sort((a, b) => String(a.l.ts || '').localeCompare(String(b.l.ts || '')));

  return `<div class="uc" style="margin:14px 16px;border-left:3px solid var(--am)">
    <div class="uc-ttl" style="display:flex;align-items:center;gap:8px">
      <span>미답변 문의</span><span class="pill p-amber">${open.length}건</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:1px;margin-top:8px">
      ${open.slice(0, 8).map(({ l, x }) => {
        const d = daysSince(l.ts);
        return `<div onclick="openExhDr('${escAttr(x.id)}',3)" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;cursor:pointer;background:var(--i9)">
          <span style="font-weight:700;font-size:12px;min-width:120px">${escapeHtml(x.company_name || '')}</span>
          <span style="font-size:12px;color:var(--i2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l.subject || l.body || '(내용 없음)')}</span>
          ${l.status === 'hold' ? '<span class="pill p-gray">확인 중</span>' : ''}
          <span class="pill ${d >= 3 ? 'p-amber' : 'p-gray'}">${d === 0 ? '오늘' : d + '일 경과'}</span>
          <span style="font-size:11px;color:var(--i4);min-width:56px;text-align:right">${escapeHtml(x.assignee || '-')}</span>
        </div>`;
      }).join('')}
      ${open.length > 8 ? `<div style="font-size:11px;color:var(--i4);padding:6px 10px">외 ${open.length - 8}건</div>` : ''}
    </div></div>`;
}

function renderChecklist(list, all){
  // 모바일에서는 표를 쓰지 않는다. layout.css가 모든 table을 마스터DB용 카드
  // 규칙(헤더 숨김 + 특정 열 강제 숨김)으로 바꿔버려 15열짜리 체크리스트는
  // 의미를 잃고 뭉개진다. 그래서 아예 전용 카드 목록으로 그린다.
  if(isMobile()) return renderChecklistCards(list, all);
  return renderChecklistTable(list, all);
}

/* ══════════════════════════════════════════
   대시보드 — 기업 하나하나가 아니라 행사 전체를 본다.
   "어디까지 왔나 / 돈은 얼마나 들어왔나 / 오늘 뭘 처리해야 하나" 세 가지에 답한다.
══════════════════════════════════════════ */
function renderDashboard(all){
  if(!all.length) return '';
  const n = all.length;

  // 정산은 통화별로 따로 집계한다 — 섞어서 더하면 안 되는 값이다
  const cash = {};
  const byState = {};
  const overdue = [], attention = [];
  all.forEach(x => {
    const s = settleState(x);
    byState[s.state] = (byState[s.state] || 0) + 1;
    if(s.billed){
      const m = cash[s.cur] || (cash[s.cur] = { billed:0, paid:0, n:0 });
      m.billed += s.billed; m.paid += s.paid; m.n++;
    }
    if(s.overdue && s.balance > 0) overdue.push({ x, s });
    const noAmt = invoicesFor(x.id).some(i => i.status !== 'void' && String(i.amount ?? '').trim() === '');
    if(s.state === 'over' || mixedCurrency(x.id) || noAmt){
      attention.push({ x, why: s.state === 'over' ? ('초과 입금 ' + fmtMoney(-s.balance, s.cur))
        : mixedCurrency(x.id) ? '통화 혼재' : '인보이스 금액 미입력' });
    }
  });
  overdue.sort((a, b) => daysSince(b.s.due) - daysSince(a.s.due));

  const openInq = [];
  all.forEach(x => openInquiriesFor(x.id).forEach(l => openInq.push({ x, l })));
  openInq.sort((a, b) => String(a.l.ts || '').localeCompare(String(b.l.ts || '')));

  const avg = Math.round(all.reduce((s, x) => s + progressOf(x), 0) / n);
  const todo = openInq.length + overdue.length + attention.length;
  const curs = Object.keys(cash).filter(c => cash[c].n);
  const dueTotal = curs.map(c => cash[c].billed - cash[c].paid).reduce((a, b) => a + b, 0);

  const card = (label, value, sub, color) => `<div class="cosi" style="flex:1 1 128px">
    <div class="cosn" style="color:${color || 'var(--i1)'}">${value}</div>
    <div class="cosl">${label}</div>
    ${sub ? `<div style="font-size:9.5px;color:var(--i5);margin-top:2px">${sub}</div>` : ''}</div>`;

  const cashRow = (c) => {
    const m = cash[c], rest = m.billed - m.paid;
    return `<div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11.5px;margin-bottom:3px">
        <span style="color:var(--i4)">${c} 청구 ${m.n}곳</span>
        <span><b>${fmtMoney(m.paid, c)}</b><span style="color:var(--i5)"> / ${fmtMoney(m.billed, c)}</span></span>
      </div>
      ${progressBar(m.billed ? m.paid / m.billed * 100 : 0, rest <= 0 ? 'var(--g)' : 'var(--a)')}
      <div style="font-size:10.5px;color:${rest > 0 ? 'var(--am)' : 'var(--g)'}">
        ${rest > 0 ? ('미수금 ' + fmtMoney(rest, c)) : '전액 입금'}</div>
    </div>`;
  };

  const stepRow = (label, done, warn) => {
    const pct = Math.round(done / n * 100);
    return `<div style="display:flex;align-items:center;gap:9px;margin-bottom:7px">
      <span style="font-size:11.5px;color:var(--i3);flex:0 0 74px">${escapeHtml(label)}</span>
      <div style="flex:1;min-width:0">${progressBar(pct, pct === 100 ? 'var(--g)' : 'var(--a)')}</div>
      <span style="font-size:11px;color:var(--i4);flex:0 0 48px;text-align:right">${done}/${n}</span>
      ${warn ? `<span class="pill p-amber" style="flex:0 0 auto">${warn}</span>` : '<span style="flex:0 0 24px"></span>'}
    </div>`;
  };

  const people = [...new Set(all.map(x => x.assignee).filter(Boolean))].sort();
  const STATE_PILLS = [['완납','paid','p-green'],['완납 처리','settled','p-green'],['부분 입금','partial','p-amber'],
    ['미납','unpaid','p-gray'],['초과 입금','over','p-red'],['청구 전','none','p-gray']];

  return `<div style="padding:12px 16px 20px;display:flex;flex-direction:column;gap:12px">

    <div class="cost" style="margin:0">
      ${card('참가기업', n + '곳', cancelledExhibitors(exhEvent).length ? ('취소 ' + cancelledExhibitors(exhEvent).length) : '')}
      ${card('평균 진행률', avg + '%')}
      ${card('미수금', curs.length ? curs.map(c => fmtMoney(cash[c].billed - cash[c].paid, c)).join(' + ') : '-',
        '', dueTotal > 0 ? 'var(--am)' : 'var(--g)')}
      ${card('처리 필요', todo + '건',
        '문의 ' + openInq.length + ' · 기한 ' + overdue.length + ' · 정산 ' + attention.length,
        todo ? 'var(--re)' : 'var(--g)')}
    </div>

    ${todo ? `<div class="uc" style="border-left:3px solid var(--am)">
      <div class="uc-ttl">처리 필요 <span class="pill p-amber">${todo}건</span></div>
      ${openInq.slice(0, 5).map(o => attnRow(o.x, '미답변 문의', o.l.subject || o.l.body || '', daysSince(o.l.ts), 3)).join('')}
      ${overdue.slice(0, 5).map(o => attnRow(o.x, '입금 기한', fmtMoney(o.s.balance, o.s.cur) + ' 미납', daysSince(o.s.due), 1)).join('')}
      ${attention.slice(0, 5).map(o => attnRow(o.x, '정산 확인', o.why, null, 1)).join('')}
      ${todo > 15 ? `<div style="font-size:11px;color:var(--i4);padding:6px 2px">외 ${todo - 15}건 — 왼쪽 필터에서 전체를 볼 수 있어요</div>` : ''}
    </div>` : `<div class="uc" style="border-left:3px solid var(--g)">
      <div class="uc-ttl">처리 필요</div>
      <div style="font-size:12px;color:var(--g)">지금 처리할 게 없어요</div></div>`}

    <div class="uc">
      <div class="uc-ttl">단계별 진행</div>
      ${STEPS.map(st => {
        const done = all.filter(x => cellState(x, st).state === 'done').length;
        const warn = all.filter(x => cellState(x, st).state === 'warn').length;
        return stepRow(st.label.replace(/<br>/g, ''), done, warn);
      }).join('')}
    </div>

    <div class="uc">
      <div class="uc-ttl">정산 현황</div>
      ${curs.length ? curs.map(cashRow).join('') : '<div style="font-size:11.5px;color:var(--i5)">아직 청구 내역이 없어요</div>'}
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">
        ${STATE_PILLS.filter(p => byState[p[1]]).map(p => `<span class="pill ${p[2]}">${p[0]} ${byState[p[1]]}</span>`).join('')}
      </div>
    </div>

    ${people.length ? `<div class="uc">
      <div class="uc-ttl">담당자별</div>
      ${people.map(p => {
        const mine = all.filter(x => x.assignee === p);
        const inq = mine.reduce((s, x) => s + openInquiriesFor(x.id).length, 0);
        const pct = Math.round(mine.reduce((s, x) => s + progressOf(x), 0) / mine.length);
        return `<div style="display:flex;align-items:center;gap:9px;margin-bottom:7px">
          <span style="font-size:11.5px;font-weight:600;flex:0 0 66px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p)}</span>
          <div style="flex:1;min-width:0">${progressBar(pct, pct === 100 ? 'var(--g)' : 'var(--a)')}</div>
          <span style="font-size:11px;color:var(--i4);flex:0 0 42px;text-align:right">${mine.length}곳</span>
          ${inq ? `<span class="pill p-amber" style="flex:0 0 auto">문의 ${inq}</span>` : '<span style="flex:0 0 24px"></span>'}
        </div>`;
      }).join('')}
    </div>` : `<div class="uc"><div class="uc-ttl">담당자별</div>
      <div style="font-size:11.5px;color:var(--i5)">아직 담당자를 지정하지 않았어요 —
        위 <b>담당자 일괄 지정</b>으로 한 번에 넣을 수 있어요</div></div>`}

    <div class="uc">
      <div class="uc-ttl">부스 현황</div>
      ${[['booth_floor','층'],['booth_type','타입'],['grade','등급']].map(f => {
        const cnt = {};
        all.forEach(x => { const v = String(x[f[0]] || '').trim(); if(v) cnt[v] = (cnt[v] || 0) + 1; });
        const ks = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
        if(!ks.length) return '';
        return `<div style="margin-bottom:8px">
          <div style="font-size:10.5px;color:var(--i4);margin-bottom:3px">${f[1]}</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px">
            ${ks.map(k => `<span class="pill ${f[0] === 'grade' ? (GRADE_CLS[k] || 'p-gray') : 'p-gray'}">${escapeHtml(k)}${f[0] === 'booth_floor' ? '층' : ''} ${cnt[k]}</span>`).join('')}
          </div></div>`;
      }).join('')}
    </div>
  </div>`;
}

/* 처리 필요 목록의 한 줄 — 눌러서 바로 그 기업의 해당 탭으로 간다 */
function attnRow(x, kind, text, days, tab){
  return `<div onclick="openExhDr('${escAttr(x.id)}',${tab})"
    style="display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:6px;cursor:pointer;background:var(--i9);margin-bottom:4px">
    <span style="font-weight:700;font-size:11.5px;flex:0 0 104px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(x.company_name || '')}</span>
    <span class="pill p-gray" style="flex:0 0 auto">${escapeHtml(kind)}</span>
    <span style="font-size:11.5px;color:var(--i3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(text)}</span>
    ${days !== null && days > 0 ? `<span class="pill ${days >= 3 ? 'p-amber' : 'p-gray'}" style="flex:0 0 auto">${days}일</span>` : ''}
  </div>`;
}

/* 모바일 — 기업당 카드 하나. 진행률과 "지금 뭐가 걸려있나"가 먼저 보이게 한다. */
function renderChecklistCards(list, all){
  const stat = (x, s) => {
    const c = cellState(x, s);
    if(c.state === 'na') return '';
    const label = s.label.replace(/<br>/g, '');
    const map = {
      done: 'background:var(--gb);color:var(--g)',
      part: 'background:var(--ab);color:var(--am)',
      warn: 'background:var(--rb);color:var(--re)',
      todo: 'background:var(--i8);color:var(--i5)',
    }[c.state];
    const mark = { done: '✓', part: '◐', warn: '!', todo: '' }[c.state];
    return `<span style="${map};font-size:10px;font-weight:600;padding:3px 7px;border-radius:5px;white-space:nowrap">${
      mark ? mark + ' ' : ''}${escapeHtml(label)}</span>`;
  };

  return `<div style="padding:10px 12px 16px">
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
      ${STEPS.map(s => {
        const n = all.filter(x => cellState(x, s).state === 'done').length;
        return `<span class="pill ${n === all.length ? 'p-green' : 'p-gray'}">${escapeHtml(s.label.replace(/<br>/g, ''))} ${n}/${all.length}</span>`;
      }).join('')}
    </div>
    ${list.map(x => {
      const p = progressOf(x);
      const openN = openInquiriesFor(x.id).length;
      const billed = billedAmount(x.id), paid = paidAmount(x.id);
      const cur = currencyOf(x.id);
      const pc = exhContacts(x)[0];
      const off = x.status === CANCELLED;
      return `<div onclick="openExhDr('${escAttr(x.id)}')"
        style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:12px 13px;margin-bottom:8px;cursor:pointer${off ? ';opacity:.55' : ''}">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:14px;font-weight:700${off ? ';text-decoration:line-through' : ''}">${escapeHtml(x.company_name || '')}</span>
          ${off ? '<span class="pill p-gray">참가 취소</span>' : ''}
          ${x.grade && x.grade !== 'Exhibitor' ? `<span class="pill ${GRADE_CLS[x.grade] || 'p-gray'}">${escapeHtml(x.grade)}</span>` : ''}
          ${openN ? `<span class="pill p-amber" style="margin-left:auto"
            onclick="event.stopPropagation();openExhDr('${escAttr(x.id)}',3)">문의 ${openN}</span>` : ''}
        </div>
        <div style="font-size:11.5px;color:var(--i4);margin-top:3px">
          ${x.booth_no ? `부스 ${escapeHtml(x.booth_no)}${x.booth_floor ? `·${escapeHtml(x.booth_floor)}층` : ''}${x.booth_type ? ` · ${escapeHtml(x.booth_type)}` : ''}` : '부스 미배정'}
          ${pc && (pc.name || pc.email) ? ` · ${escapeHtml(pc.name || pc.email)}` : ''}
          ${x.assignee ? ` · 우리 담당 ${escapeHtml(x.assignee)}` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin:9px 0 8px">
          <div style="flex:1">${progressBar(p, p === 100 ? 'var(--g)' : 'var(--a)')}</div>
          <span style="font-size:11px;font-weight:700;color:var(--i3);min-width:32px;text-align:right">${p}%</span>
        </div>
        ${billed ? `<div style="font-size:11.5px;margin-bottom:7px">
          입금 <b style="color:${paid >= billed ? 'var(--g)' : 'var(--am)'}">${fmtMoney(paid, cur)}</b>
          <span style="color:var(--i5)"> / ${fmtMoney(billed, cur)}</span></div>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:4px">${STEPS.map(s => stat(x, s)).join('')}</div>
      </div>`;
    }).join('')}
    ${!list.length ? '<div class="empty" style="padding:30px;text-align:center;font-size:12px;color:var(--i4)">조건에 맞는 기업이 없어요</div>' : ''}
  </div>`;
}

function renderChecklistTable(list, all){
  const cell = (x, s) => {
    const c = cellState(x, s);
    const map = {
      done: { bg: 'var(--gb)', fg: 'var(--g)',  mark: '✓' },
      part: { bg: 'var(--ab)', fg: 'var(--am)', mark: '◐' },
      warn: { bg: 'var(--rb)', fg: 'var(--re)', mark: '!' },
      todo: { bg: 'transparent', fg: 'var(--i5)', mark: '—' },
      na:   { bg: 'transparent', fg: 'var(--i6)', mark: '·' },
    }[c.state];
    const tip = c.text ? escAttr(String(c.text)) : '';
    return `<td style="text-align:center;padding:5px 3px" title="${tip}">
      <div style="display:inline-flex;flex-direction:column;align-items:center;gap:1px;min-width:44px;padding:3px 4px;border-radius:5px;background:${map.bg}">
        <span style="font-size:12px;font-weight:800;color:${map.fg};line-height:1">${map.mark}</span>
        ${c.text ? `<span style="font-size:9px;color:${map.fg};line-height:1.1">${escapeHtml(shortCell(c.text))}</span>` : ''}
      </div></td>`;
  };

  const stats = STEPS.map(s => ({
    label: s.label.replace(/<br>/g, ''),
    n: all.filter(x => cellState(x, s).state === 'done').length,
  }));

  return `<div style="padding:0 16px 16px">
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin:12px 0">
      ${stats.map(s => `<span class="pill ${s.n === all.length ? 'p-green' : 'p-gray'}">${escapeHtml(s.label)} ${s.n}/${all.length}</span>`).join('')}
    </div>
    <div class="tw"><table><thead><tr>
      <th style="min-width:150px">기업</th>
      <th style="min-width:88px">기업 담당자</th>
      <th style="min-width:56px">우리 담당</th>
      <th style="min-width:70px">진행률</th>
      ${STEPS.map(s => `<th style="text-align:center;font-size:10px;line-height:1.2">${s.label}</th>`).join('')}
      <th style="text-align:center;min-width:50px">문의</th>
      <th style="text-align:right;min-width:110px">입금/청구</th>
    </tr></thead><tbody>
    ${list.map(x => {
      const p = progressOf(x);
      const openN = openInquiriesFor(x.id).length;
      const billed = billedAmount(x.id), paid = paidAmount(x.id);
      const off = x.status === CANCELLED;
      return `<tr style="cursor:pointer${off ? ';opacity:.5' : ''}" onclick="openExhDr('${escAttr(x.id)}')">
        <td><div style="display:flex;align-items:center;gap:5px">
              <span style="font-weight:700;font-size:12px${off ? ';text-decoration:line-through' : ''}">${escapeHtml(x.company_name || '')}</span>
              ${off ? '<span class="pill p-gray">참가 취소</span>' : ''}
              ${x.grade && x.grade !== 'Exhibitor' ? `<span class="pill ${GRADE_CLS[x.grade] || 'p-gray'}">${escapeHtml(x.grade)}</span>` : ''}
            </div>
            ${x.booth_no ? `<div style="font-size:10px;color:var(--i4)">부스 ${escapeHtml(x.booth_no)}${
              x.booth_floor ? ` · ${escapeHtml(x.booth_floor)}층` : ''}${
              x.booth_type ? ` · ${escapeHtml(x.booth_type)}` : ''}${
              x.booth_qty && x.booth_qty !== '1' ? ` ×${escapeHtml(x.booth_qty)}` : ''}</div>` : ''}</td>
        ${(() => {
          const all = exhContacts(x);
          const p = all[0];
          const label = p ? (p.name || p.email || '-') : '-';
          const tip = all.map(c => [c.role, c.name, c.title, c.email, c.phone].filter(Boolean).join(' · ')).join('\n');
          return `<td style="font-size:11px;color:var(--i3);max-width:130px" title="${escAttr(tip)}">
            <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(label)}</div>
            ${all.length > 1 ? `<div style="font-size:9.5px;color:var(--i5)">외 ${all.length - 1}명</div>` : ''}</td>`;
        })()}
        <td style="font-size:11px;color:var(--i3)">${escapeHtml(x.assignee || '-')}</td>
        <td>${progressBar(p, p === 100 ? 'var(--g)' : 'var(--a)', '52px')}
            <span style="font-size:10px;color:var(--i4)">${p}%</span></td>
        ${STEPS.map(s => cell(x, s)).join('')}
        <td style="text-align:center" onclick="event.stopPropagation();openExhDr('${escAttr(x.id)}',3)">
          ${openN ? `<span class="pill p-amber">${openN}</span>` : '<span style="color:var(--i6)">·</span>'}</td>
        ${(() => {
          const s = settleState(x);
          if(!s.billed) return '<td style="text-align:right;font-size:11px;color:var(--i6)">-</td>';
          const col = (s.state==='paid'||s.state==='settled') ? 'var(--g)'
            : (s.state==='over' ? 'var(--re)' : 'var(--i2)');
          return `<td style="text-align:right;font-size:11px">
            <span style="font-weight:700;color:${col}">${s.cur==='USD'?'$':''}${money(s.paid)}</span>
            <span style="color:var(--i5)"> / ${money(s.billed)}</span>
            ${s.state==='over' ? `<div style="font-size:9.5px;color:var(--re)">초과 ${fmtMoney(-s.balance, s.cur)}</div>` : ''}
            ${s.state==='settled' ? '<div style="font-size:9.5px;color:var(--g)">완납 처리</div>' : ''}
            ${s.overdue && s.balance>0 ? `<div style="font-size:9.5px;color:var(--am)">기한 ${daysSince(s.due)}일 지남</div>` : ''}
            ${mixedCurrency(x.id) ? '<div title="통화가 섞여 합계가 정확하지 않아요" style="font-size:9.5px;color:var(--re)">⚠ 통화 혼재</div>' : ''}
          </td>`;
        })()}
      </tr>`;
    }).join('')}
    </tbody></table></div>
    ${!list.length ? '<div class="empty" style="padding:30px;text-align:center;font-size:12px;color:var(--i4)">조건에 맞는 기업이 없어요</div>' : ''}
  </div>`;
}

/* ══════════════════════════════════════════
   참가기업 불러오기 — 트래킹 대상 확보

   participations에서 이 행사의 "전시참가기업" 역할을 뽑아 기업 단위로 묶는다.
   (CO_DB[].events는 eventId를 안 들고 있어 행사별로 되짚을 수 없다.)
══════════════════════════════════════════ */
export function exhibitorCandidates(evKey){
  const map = new Map();
  participations
    .filter(p => p.eventId === evKey && EXH_ROLES.includes(String(p.role || '').trim()))
    .forEach(p => {
      const c = contacts.find(x => String(x.id) === String(p.contactId));
      if(!c) return;
      const raw = c.orgKo || c.orgEn || '';
      if(!raw) return;
      const key = normalizeCompanyKey(raw);
      if(!map.has(key)){
        const co = CO_DB.find(o => o.key === key);
        map.set(key, { company_key: key, company_name: (co && co.nameKo) || raw, people: [] });
      }
      const nm = c.nameKo || c.nameEn || '';
      if(nm && !map.get(key).people.includes(nm)) map.get(key).people.push(nm);
    });
  return [...map.values()].sort((a, b) => a.company_name.localeCompare(b.company_name, 'ko'));
}

/* 담당자 일괄 지정 — 51곳을 하나씩 여는 건 현실적이지 않다.
   지금 필터로 걸러진 목록에 그대로 적용하되, 체크로 뺄 수 있게 한다. */
export function openExhAssign(){
  closeExhAssign();
  const list = visibleList();
  if(!list.length){ alert('지정할 기업이 없어요.'); return; }
  const pop = document.createElement('div');
  pop.id = 'exh-assign-modal';
  pop.className = 'mw on';
  pop.onclick = (e) => { if(e.target === pop) closeExhAssign(); };
  const known = [...new Set(EXHIBITORS.map(x => x.assignee).filter(Boolean))];
  pop.innerHTML = `<div class="modal" style="max-width:520px">
    <div class="mh"><div class="mt2">담당자 일괄 지정</div>
      <div class="mc">지금 목록에 보이는 ${list.length}곳에 우리 팀 담당자를 한 번에 지정해요</div></div>
    <div class="mb">
      <div class="fg"><label class="fl">담당자</label>
        <input class="fi" id="exh-as-who" list="exh-as-known" placeholder="예: 정다혜" value="${escAttr(currentUser?.name || '')}">
        <datalist id="exh-as-known">${known.map(n => `<option value="${escAttr(n)}">`).join('')}</datalist>
        <div style="font-size:10.5px;color:var(--i5);margin-top:4px">비워두고 적용하면 담당자를 해제해요</div></div>
      <div class="fg"><label class="fl">대상 (${list.length}곳)</label>
        <div id="exh-as-list" style="max-height:280px;overflow-y:auto;border:1px solid var(--i7);border-radius:8px;padding:6px">
          ${list.map((x, i) => `<label style="display:flex;align-items:center;gap:9px;padding:5px 7px;border-radius:6px;cursor:pointer">
            <input type="checkbox" class="exh-as-cb" data-id="${escAttr(x.id)}" checked>
            <span style="font-weight:600;font-size:12px;flex:1">${escapeHtml(x.company_name || '')}</span>
            ${x.assignee ? `<span style="font-size:10.5px;color:var(--i4)">현재 ${escapeHtml(x.assignee)}</span>` : ''}
          </label>`).join('')}
        </div></div>
    </div>
    <div class="mf2">
      <button class="btn" onclick="closeExhAssign()">취소</button>
      <button class="btn bp" onclick="confirmExhAssign()" id="exh-as-btn">적용</button>
    </div></div>`;
  document.body.appendChild(pop);
}
export function closeExhAssign(){ document.getElementById('exh-assign-modal')?.remove(); }

export async function confirmExhAssign(){
  const who = (document.getElementById('exh-as-who')?.value || '').trim();
  const ids = [...document.querySelectorAll('.exh-as-cb')].filter(cb => cb.checked).map(cb => cb.dataset.id);
  if(!ids.length){ alert('대상을 선택해주세요.'); return; }
  const btn = document.getElementById('exh-as-btn');
  if(btn){ btn.disabled = true; btn.textContent = '적용 중…'; }

  const targets = ids.map(id => getExhibitorById(id)).filter(Boolean);
  const backup = targets.map(x => ({ x, was: x.assignee }));
  targets.forEach(x => { x.assignee = who; });
  refreshExhViews();

  // 전체 레코드가 아니라 바뀐 필드만 담아 보낸다(부분 upsert)
  const r = await postToSheet({ sheet: 'exhibitors', action: 'batchUpsert',
    dataRows: targets.map(x => ({ ...x, assignee: who, updated_at: td() })) }, '담당자 일괄 지정');
  if(!r.ok){
    backup.forEach(b => { b.x.assignee = b.was; });
    refreshExhViews();
    if(btn){ btn.disabled = false; btn.textContent = '적용'; }
    alert('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    return;
  }
  closeExhAssign();
  buildExhEvList();
  refreshExhViews();
  trackAction('edit', '담당자 일괄 지정', `${targets.length}개사`,
    `${targets.length}개사 담당자를 <b>${escapeHtml(who || '(해제)')}</b>로 지정했어요`);
}

export function openExhImport(){
  closeExhImport();
  const evKey = exhEvent || (EVENT_LIST[0] && EVENT_LIST[0].key) || '';
  const pop = document.createElement('div');
  pop.id = 'exh-import-modal';
  pop.className = 'mw on';
  pop.onclick = (e) => { if(e.target === pop) closeExhImport(); };
  pop.innerHTML = `<div class="modal" style="max-width:560px">
    <div class="mh"><div class="mt2">참가기업 불러오기</div>
      <div class="mc">기업DB에 "전시참가기업"으로 기록된 기업을 골라 진행관리에 등록해요</div></div>
    <div class="mb">
      <div class="fg"><label class="fl">행사</label>
        <select class="fi" id="exh-imp-ev" onchange="renderExhImportList()">
          ${exhEventOptions().map(e => `<option value="${escAttr(e.key)}"${e.key === evKey ? ' selected' : ''}>${escapeHtml(e.name || e.key)}</option>`).join('')}
        </select></div>
      <div class="fg"><label class="fl">담당자 — 고른 기업에 일괄 지정</label>
        <input class="fi" id="exh-imp-who" placeholder="예: 정다혜" value="${escAttr(currentUser?.name || '')}"></div>
      <div class="fg"><label class="fl">대상 기업</label>
        <div id="exh-imp-list" style="max-height:300px;overflow-y:auto;border:1px solid var(--i7);border-radius:8px;padding:6px"></div></div>
    </div>
    <div class="mf2">
      <button class="btn" onclick="closeExhImport()">취소</button>
      <button class="btn bp" onclick="confirmExhImport()" id="exh-imp-btn">등록</button>
    </div></div>`;
  document.body.appendChild(pop);
  renderExhImportList();
}
export function closeExhImport(){ document.getElementById('exh-import-modal')?.remove(); }

export function renderExhImportList(){
  const el = document.getElementById('exh-imp-list');
  if(!el) return;
  const evKey = document.getElementById('exh-imp-ev').value;
  const cands = exhibitorCandidates(evKey);
  const already = new Set(exhibitorsForEvent(evKey).map(x => x.company_key));

  if(!cands.length){
    el.innerHTML = `<div style="font-size:12px;color:var(--i4);padding:14px;text-align:center">
      이 행사에 "전시참가기업" 역할로 기록된 기업이 없어요.<br>
      업로드 시 참가 역할을 전시참가기업으로 지정했는지 확인해주세요.</div>`;
    return;
  }
  el.innerHTML = cands.map((c, i) => {
    const dup = already.has(c.company_key);
    return `<label style="display:flex;align-items:center;gap:9px;padding:6px 7px;border-radius:6px;cursor:${dup ? 'default' : 'pointer'};opacity:${dup ? .45 : 1}">
      <input type="checkbox" class="exh-imp-cb" data-i="${i}" ${dup ? 'disabled' : 'checked'}>
      <span style="font-weight:600;font-size:12px;flex:1">${escapeHtml(c.company_name)}</span>
      ${c.people.length ? `<span style="font-size:10px;color:var(--i4)">${escapeHtml(c.people.slice(0,2).join(', '))}${c.people.length > 2 ? ` 외 ${c.people.length - 2}` : ''}</span>` : ''}
      ${dup ? '<span class="pill p-gray">등록됨</span>' : ''}
    </label>`;
  }).join('');
  el._cands = cands;
}

export async function confirmExhImport(){
  const el = document.getElementById('exh-imp-list');
  const evKey = document.getElementById('exh-imp-ev').value;
  const who = document.getElementById('exh-imp-who').value.trim();
  const cands = el._cands || [];
  const picked = [...document.querySelectorAll('.exh-imp-cb')]
    .filter(cb => cb.checked && !cb.disabled)
    .map(cb => cands[+cb.dataset.i]).filter(Boolean);

  if(!picked.length){ alert('등록할 기업을 선택해주세요.'); return; }
  const btn = document.getElementById('exh-imp-btn');
  if(btn){ btn.disabled = true; btn.textContent = '등록 중…'; }

  const rows = picked.map(c => ({
    event_id: evKey, company_key: c.company_key, company_name: c.company_name,
    assignee: who, status: '준비중', updated_at: td(),
  }));

  const r = await batchCreateExhibitors(rows);
  if(!r.ok){
    if(btn){ btn.disabled = false; btn.textContent = '등록'; }
    alert('등록에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    return;
  }
  // 서버가 id를 만들어 주므로, 로컬 반영은 저장 직후 재조회로 맞춘다
  await reloadExhibitors();
  setExhEvent(evKey);
  closeExhImport();
  buildExhEvList();
  renderExh();
  trackAction('add', '전시 참가기업 등록', `${picked.length}개사`,
    `<b>${escapeHtml(picked.length + '개사')}</b>를 전시 진행관리에 등록했어요`);
}

/* 서버가 id를 생성하는 일괄 등록 직후에만 쓰는 재조회 — 화면 전체를 다시 그리는
   loadFromSheets 대신 exhibitors만 가볍게 다시 읽는다. */
async function reloadExhibitors(){
  if(!API_BASE_URL || !currentUser) return;
  const { safeFetch, authHeaders } = await import('../api.js');
  const rows = await safeFetch(API_BASE_URL + '/api/data?sheet=exhibitors', 'exhibitors', 1, await authHeaders());
  if(Array.isArray(rows)) EXHIBITORS.splice(0, EXHIBITORS.length, ...rows);
}

/* ══════════════════════════════════════════
   저장 — 단건 필드 수정
   서버가 "넘어온 키만" 갱신하므로 바뀐 필드만 보낸다(나머지는 보존됨).
══════════════════════════════════════════ */
export async function patchExh(id, patch, label){
  const x = getExhibitorById(id);
  if(!x) return { ok: false };
  const backup = {};
  Object.keys(patch).forEach(k => { backup[k] = x[k]; });
  Object.assign(x, patch);
  refreshExhViews();

  const r = await saveExhibitor({ id, ...patch, updated_at: td() });
  if(!r.ok){
    Object.assign(x, backup); // 저장 실패 시 되돌린다 — 화면만 바뀌는 거짓 성공 방지
    refreshExhViews();
    alert('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    return r;
  }
  x.updated_at = td();
  if(label) trackAction('edit', label, x.company_name || '', `<b>${escapeHtml(x.company_name || '')}</b> ${escapeHtml(label)}`);
  return r;
}

/* 표와 드로어가 같은 데이터를 보므로 항상 함께 다시 그린다.
   단, 드로어를 통째로 다시 그리면 작성 중이던 입력값(긴 문의 본문 등)이
   날아가므로, 지금 그 안에서 타이핑 중이면 드로어는 건드리지 않는다.
   해당 입력을 마치고 blur/저장하는 순간 어차피 다시 그려진다. */
export function refreshExhViews(){
  renderExh();
  buildExhFilters();
  if(!isTypingInDrawer()) window.renderExhDr?.();
}

function isTypingInDrawer(){
  const el = document.activeElement;
  if(!el) return false;
  const tag = el.tagName;
  if(tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
  const dr = document.getElementById('exh-dr');
  return !!(dr && dr.contains(el) && String(el.value || '').trim());
}

/* 날짜 토글 — 비어있으면 오늘 날짜로 체크, 이미 있으면 해제 */
export function toggleExhDate(id, field, label){
  const x = getExhibitorById(id);
  if(!x) return;
  patchExh(id, { [field]: x[field] ? '' : td() }, label);
}
export function setExhField(id, field, value, label){
  patchExh(id, { [field]: value }, label);
}

/* 여부 플래그 토글 — 끌 때는 날짜도 함께 지운다(체크는 꺼졌는데 날짜만 남는 상태 방지) */
export function toggleExhFlag(id, flag, dateField, label){
  const x = getExhibitorById(id);
  if(!x) return;
  const on = x[flag] === 'yes' || !!x[dateField];
  patchExh(id, on ? { [flag]: '', [dateField]: '' } : { [flag]: 'yes' }, label);
}
/* 날짜를 넣으면 여부도 함께 켠다 */
export function setExhDateWithFlag(id, dateField, flag, value, label){
  // 날짜를 지우면 체크도 함께 푼다 — 같은 화면의 dateRow와 동작을 맞춘다
  patchExh(id, value ? { [dateField]: value, [flag]: 'yes' } : { [dateField]: '', [flag]: '' }, label);
}

window.setExhEvent2 = setExhEvent2;
window.setExhFilter = setExhFilter;
window.setExhView = setExhView;
window.setExhAssignee = setExhAssignee;
window.renderExh = renderExh;
window.openExhImport = openExhImport;
window.openExhAssign = openExhAssign;
window.closeExhAssign = closeExhAssign;
window.confirmExhAssign = confirmExhAssign;
window.closeExhImport = closeExhImport;
window.renderExhImportList = renderExhImportList;
window.confirmExhImport = confirmExhImport;
window.toggleExhDate = toggleExhDate;
window.setExhField = setExhField;
window.toggleExhFlag = toggleExhFlag;
window.setExhDateWithFlag = setExhDateWithFlag;
