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
  EVENT_LIST, contacts, participations, CO_DB, currentUser, API_BASE_URL, auditLog,
  catalogItem, catalogFor, findCatalogByName, EQUIP_CATALOG, getOrgById,
} from '../state.js';
import { td, escapeHtml, escAttr, isMobile, cleanEmail } from '../utils.js';
export { cleanEmail };   // exh-drawer가 여기서 가져다 쓴다
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

/* ── 기업 이름 ──
   exhibitors.company_name은 등록할 때 찍힌 국문 스냅샷이라 영문이 없다. 해외
   기업은 메일도 인보이스도 영문명으로 오가서, 화면에 국문만 있으면 "Labcorp가
   어느 줄이지"를 눈으로 못 찾는다. 연결된 기업 레코드에서 영문명을 끌어와 함께
   보여준다(연결이 없으면 스냅샷 그대로).

   국문명이 아예 없는 기업은 영문을 제목 자리로 올린다 — 빈칸 아래 영문이
   따라붙는 모양이 되지 않게. */
export function exhNames(x){
  const o = x && x.org_id ? getOrgById(x.org_id) : null;
  const ko = (o && o.name_ko) || x?.company_name || '';
  const en = (o && o.name_en) || '';
  return { ko: ko || en, en: ko ? en : '' };
}

/* 한 줄에 국문 + 영문을 나란히 (표 칸처럼 세로 공간이 좁을 때) */
function nameCell(x, opts = {}){
  const { ko, en } = exhNames(x);
  const off = opts.off ? ';text-decoration:line-through;opacity:.6' : '';
  return `<span style="font-size:${opts.size || 12.5}px;font-weight:700${off}">${escapeHtml(ko)}</span>${
    en ? `<span style="font-size:${(opts.size || 12.5) - 2}px;font-weight:400;color:var(--i4);margin-left:5px">${escapeHtml(en)}</span>` : ''}`;
}

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
let exhView = 'dash';        // dash | list | booth | equip | graphic

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
/* 추가 배지처럼 우리가 청구하지 않는 항목은 합계에서 뺀다. 신청 내역에는 남는다 —
   몇 장을 신청했는지는 현장에서 필요한 정보라 지울 수 없다. */
export const isBillable = (i) => i.billable !== 'no';
export function billableItems(exhId){ return itemsFor(exhId).filter(isBillable); }

export function billedAmount(exhId){
  const cur = currencyOf(exhId);
  const inv = liveInvoices(exhId);
  return inv.length ? sumIn(inv, cur) : sumIn(billableItems(exhId), cur);
}
/* 입금액: 입금 − 환불 */
/* 환불은 요청받은 시점과 실제로 보낸 시점이 다르다. 요청만 들어온 건을 바로
   빼버리면 아직 나가지 않은 돈이 이미 나간 것처럼 보여서, 잔액을 보고 판단하는
   사람이 틀린 결정을 하게 된다 — 완료된 환불만 차감한다. */
export const isDoneRefund = (p) => p.kind === 'refund' && p.status !== 'requested';
export const isPendingRefund = (p) => p.kind === 'refund' && p.status === 'requested';

export function paidAmount(exhId){
  const cur = currencyOf(exhId);
  return paymentsFor(exhId)
    .filter(p => (p.currency || 'KRW') === cur)
    .filter(p => p.kind !== 'refund' || isDoneRefund(p))
    .reduce((s, p) => s + (p.kind === 'refund' ? -num(p.amount) : num(p.amount)), 0);
}

/* 아직 안 보낸 환불 — 처리 필요 목록에 올리기 위해 따로 센다 */
export function pendingRefunds(exhId){
  return paymentsFor(exhId).filter(isPendingRefund);
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

/* ══════════════════════════════════════════
   진행 단계 — 세금계산서 · 그래픽

   둘 다 우리 손을 떠났다 돌아오기를 반복하는 일이다. 날짜 한 칸만 있으면
   "했나 안 했나"는 알아도 지금 공이 누구에게 있는지 — 기업 회신을 기다리는지,
   재무팀에 넘겨 둔 건지, 우리가 회신할 차례인지 — 를 알 수 없다.

   who는 지금 움직여야 할 쪽이다. 'us'인 것만 모으면 오늘 할 일이 된다.
══════════════════════════════════════════ */
export const TAX_STAGES = [
  { key: '',           label: '요청 전',     who: '',      at: null,                 next: 'requested',  action: '기업이 요청함' },
  { key: 'requested',  label: '기업 요청',   who: 'us',    at: 'tax_requested_at',   next: 'to_finance', action: '재무팀에 요청' },
  { key: 'to_finance', label: '재무팀 요청', who: 'team',  at: 'tax_to_finance_at',  next: 'done',       action: '발행 완료' },
  { key: 'done',       label: '발행 완료',   who: '',      at: 'tax_sent_at',        next: null,         action: '' },
];

export const GRAPHIC_STAGES = [
  { key: '',          label: '전달 전',       who: '',     at: null,                  next: 'received', action: '기업이 파일 전달함' },
  { key: 'received',  label: '기업 전달',     who: 'us',   at: 'graphic_received_at', next: 'to_team',  action: '그래픽팀에 확인 요청' },
  { key: 'to_team',   label: '그래픽팀 확인', who: 'team', at: 'graphic_to_team_at',  next: 'team_ok',  action: '그래픽팀 확인 완료' },
  { key: 'team_ok',   label: '확인 완료',     who: 'us',   at: 'graphic_team_ok_at',  next: 'replied',  action: '기업에 회신' },
  { key: 'replied',   label: '기업 회신',     who: '',     at: 'graphic_replied_at',  next: null,       action: '' },
];

export const stageOf = (list, v) => list.find((s) => s.key === (v || '')) || list[0];

/* 지금 단계에 며칠 머물러 있나 — 막힌 건을 찾는 데 쓴다 */
export function stageAge(x, list, field){
  const st = stageOf(list, x[field]);
  return st.at && x[st.at] ? daysSince(x[st.at]) : null;
}

/* 이 참가 건의 거래 요약 — 기업DB가 "이 회사와 얼마나 거래했나"를 보여줄 때 쓴다.
   부스·청구·입금·미답변 문의가 전부 전시 탭에만 쌓여 있어 기업 화면에서는
   하나도 안 보였다. 판정 기준을 새로 만들지 않고 settleState를 그대로 쓴다 —
   전시 탭과 기업 탭이 서로 다른 금액을 말하면 안 된다. */
export function exhibitorTradeFor(x){
  const st = settleState(x);
  return {
    exhibitorId: x.id,
    eventId:     x.event_id,
    company:     x.company_name || '',
    booth:       x.booth_no || '',
    boothType:   x.booth_type || '',
    grade:       x.grade || '',
    billed:      st.billed,
    paid:        st.paid,
    balance:     st.balance,
    cur:         st.cur,
    state:       st.state,
    due:         st.due,
    overdue:     st.overdue,
    cancelled:   x.status === CANCELLED,
    openInquiries: openInquiriesFor(x.id).length,
    updatedAt:   x.updated_at || '',
  };
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

/* 이 기업의 담당자 전원 (메인이 맨 앞) */
export function exhContacts(x){
  return contactsFor(x.id).map(resolveContact).filter(Boolean);
}
/* 메인 담당자 — 목록/헤더에 한 명만 보여줄 때 */
export function exhContact(x){
  return resolveContact(primaryContactFor(x.id))
    // 아직 담당자 줄이 없는 기업은 빈 값으로 (화면이 깨지지 않게)
    || { row: null, linked: false, id: null, name: '', email: '', phone: '', title: '', role: '', primary: false };
}

/* 이 기업의 마스터DB 연락처 후보 — 드로어 드롭다운에 쓴다 */
/* 이 기업의 마스터DB 연락처 — 기업 연결(org_id)이 있으면 그걸 쓴다.
   이름 문자열로 맞추면 표기가 조금만 달라도 사람이 통째로 빠진다. 아직 연결이
   없는 옛 연락처를 위해 이름 대조도 남겨 둔다. */
export function contactsForExhibitor(x){
  if(!x) return [];
  const key = x.company_key || '';
  const nameKey = normalizeCompanyKey(x.company_name || '');
  return contacts.filter(c => {
    if(x.org_id && c.org_id) return c.org_id === x.org_id;
    const k = normalizeCompanyKey(c.orgKo || c.orgEn || '');
    return k && (k === key || k === nameKey);
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

/* ══════════════════════════════════════════
   메인 — 미답변 문의 패널 + 체크리스트 표
══════════════════════════════════════════ */
function visibleList(){
  const q = (document.getElementById('exh-q')?.value || '').trim().toLowerCase();
  let list = exhFilter === 'cancelled' ? cancelledExhibitors(exhEvent) : activeExhibitors(exhEvent);
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

  /* 보기 전환 — 진행 전체를 보는 두 가지(대시보드·체크리스트) 다음에,
     실무를 품목 단위로 처리하는 세 가지를 둔다. 부스·비품·그래픽은 각각
     담당이 갈리고 마감도 달라서, 기업별 드로어를 51번 열지 않고 한 화면에서
     끝낼 수 있어야 한다. */
  const VIEWS = [['dash','대시보드'], ['list','체크리스트'],
    ['booth','부스 현황'], ['equip','비품 현황'], ['graphic','그래픽 현황'], ['book','프로그램북']];
  const seg = `<div class="tbar" style="padding:10px 16px 0">
    <div class="seg" style="flex-wrap:wrap">
      ${VIEWS.map(([k, l]) => `<button class="seg-b${exhView === k ? ' on' : ''}" onclick="setExhView('${k}')">${l}</button>`).join('')}
    </div></div>`;

  const bodyHtml =
      exhView === 'dash'    ? renderDashboard(all)
    : exhView === 'booth'   ? renderBoothView(list)
    : exhView === 'equip'   ? renderEquipView(list)
    : exhView === 'graphic' ? renderGraphicView(list)
    : exhView === 'book'    ? renderBookView(list)
    : renderInquiryPanel() + renderChecklist(list, all);
  el.innerHTML = seg + bodyHtml;
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
        return `<div onclick="openExhDr('${escAttr(x.id)}','logs')" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;cursor:pointer;background:var(--i9)">
          <span style="font-weight:700;font-size:12px;min-width:120px">${escapeHtml(exhNames(x).ko)}${
            exhNames(x).en ? `<span style="font-weight:400;color:var(--i4);font-size:10.5px;margin-left:4px">${escapeHtml(exhNames(x).en)}</span>` : ''}</span>
          <span style="font-size:12px;color:var(--i2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l.subject || l.body || '(내용 없음)')}</span>
          ${l.status === 'hold' ? '<span class="pill p-gray">확인 중</span>' : ''}
          <span class="pill ${d >= 3 ? 'p-amber' : 'p-gray'}">${d === 0 ? '오늘' : d + '일 경과'}</span>
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
   품목별 현황 보기 — 부스 / 비품 / 그래픽

   체크리스트는 "이 기업이 어디까지 왔나"를 본다. 그런데 실무는 품목으로 갈린다 —
   부스 배치는 현장 담당이, 비품은 발주 담당이, 그래픽은 디자인이 맡고 마감도
   서로 다르다. 그때마다 기업 드로어를 51번 열어 필요한 칸만 찾아보는 건
   현실적이지 않아서, 품목별로 한 화면에 모아 거기서 바로 고칠 수 있게 한다.

   좁은 화면에서는 표 대신 카드로 그린다(마스터DB·체크리스트와 같은 이유).
══════════════════════════════════════════ */

/* 표/카드 공통 껍데기 — 요약 배지 + 본문 */
const viewShell = (pills, inner, actions = '') => `<div style="padding:0 16px 16px">
  <div style="display:flex;flex-wrap:wrap;gap:6px;margin:12px 0;align-items:center">
    ${pills}${actions ? `<span style="margin-left:auto;display:flex;gap:6px">${actions}</span>` : ''}
  </div>
  ${inner}</div>`;

const countBy = (list, fn) => {
  const c = {};
  list.forEach(x => { const v = fn(x); if(v) c[v] = (c[v] || 0) + 1; });
  return c;
};
const pillsOf = (cnt, cls = 'p-gray') => Object.entries(cnt)
  .sort((a, b) => b[1] - a[1])
  .map(([k, n]) => `<span class="pill ${cls}">${escapeHtml(k)} ${n}</span>`).join('');

const emptyView = (msg) => `<div class="empty" style="padding:40px 20px;text-align:center;color:var(--i4);font-size:13px">${escapeHtml(msg)}</div>`;

/* 기업 이름 칸 — 어느 보기에서든 클릭하면 그 기업 드로어로 간다 */
const coCell = (x, tab) => `<td style="min-width:150px">
  <span onclick="openExhDr('${escAttr(x.id)}','${tab}')" style="cursor:pointer;font-size:12.5px;font-weight:600${
    x.status === CANCELLED ? ';text-decoration:line-through;opacity:.6' : ''}">${escapeHtml(exhNames(x).ko)}</span>${
    exhNames(x).en ? `<div style="font-size:10.5px;color:var(--i4);font-weight:400">${escapeHtml(exhNames(x).en)}</div>` : ''}</td>`;

/* ── 부스 현황 ──
   부스 번호로 정렬해 배치도를 훑듯 볼 수 있게 한다. 독립부스는 시공사가 따로
   있어 현장에서 연락할 상대가 다르므로 그 열을 함께 보여준다. */
/* 부스 타입은 주최 측이 정한 몇 가지 중 하나다. 자유 입력이었더니 같은 타입을
   조금씩 다르게 적을 수 있어 집계가 갈라진다 — 골라 쓰게 한다.
   드로어와 부스 현황 두 곳이 같은 목록을 써야 해서 여기(단방향 상류)에 둔다. */
export const SELF_BUILD_TYPE = 'Self-Construction';
export const BOOTH_TYPES = [SELF_BUILD_TYPE, 'Block System A', 'Block System B', 'Block System C',
  'Lighting Booth', 'Octanium (Standard)'];

/* 목록에 없는 값이 이미 들어 있으면(옛 데이터·행사마다 다른 타입) 그 값도 함께
   보여준다 — 고정 목록으로 바꿨다는 이유로 저장돼 있던 값이 조용히 사라지면 안 된다. */
export function boothTypeOptions(current){
  const cur = String(current || '').trim();
  const list = BOOTH_TYPES.includes(cur) || !cur ? BOOTH_TYPES : [...BOOTH_TYPES, cur];
  return `<option value=""${cur ? '' : ' selected'}>— 미지정 —</option>`
    + list.map(t => `<option value="${escAttr(t)}"${cur === t ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('');
}
/* ── 부스 번호 읽기 ──
   번호에 하이픈이 두 가지 뜻으로 쓰인다.
     10-11, 44-46  연속된 부스를 여러 개 쓴다 (2개, 3개)
     39-1, 39-2    부스 하나를 두 기업이 나눠 쓴다
   뒤 숫자가 앞보다 크면 범위, 작으면 분할 번호다. 실제 데이터가 그렇게 되어
   있고 달리 구분할 방법이 없다.

   전에는 숫자만 뽑아 이어 붙여서 "10-11"을 1011로 읽었다. 그래서 1 다음에
   10-11이 오고 2가 그 뒤에 오는 식으로 순서가 뒤죽박죽이었다. */
export function parseBooth(no){
  const t = String(no || '').trim();
  const m = t.match(/^(\d+)\s*[-~]\s*(\d+)$/);
  if(m){
    const a = +m[1], b = +m[2];
    return b > a
      ? { first: a, last: b, sub: 0, count: b - a + 1, kind: 'range' }
      : { first: a, last: a, sub: b, count: 1, kind: 'split' };
  }
  const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n)
    ? { first: n, last: n, sub: 0, count: 1, kind: 'single' }
    : { first: Infinity, last: Infinity, sub: 0, count: 0, kind: 'none' };
}

/* 앞 번호가 우선, 같으면 분할 번호 순. 번호 없는 기업은 맨 뒤로. */
const boothSortKey = (x) => {
  const b = parseBooth(x.booth_no);
  return b.first === Infinity ? Infinity : b.first * 100 + b.sub;
};

function renderBoothView(list){
  if(!list.length) return emptyView('표시할 기업이 없어요');
  const rows = [...list].sort((a, b) => boothSortKey(a) - boothSortKey(b));
  const noBooth = rows.filter(x => !String(x.booth_no || '').trim()).length;
  const selfN = rows.filter(x => x.booth_type === SELF_BUILD_TYPE).length;
  const unconfirmed = rows.filter(x => x.booth_confirmed !== 'yes' && !x.booth_confirmed_at).length;

  /* 번호에서 읽은 부스 수와 적어둔 수량이 다르면 알린다 — 10-11이면 2부스인데
     수량이 1로 적혀 있으면 청구액이 절반으로 잡힌다. */
  const qtyOdd = rows.filter(x => {
    const b = parseBooth(x.booth_no);
    const q = Number(String(x.booth_qty || '').replace(/[^0-9]/g, ''));
    return b.kind === 'range' && q && q !== b.count;
  });
  const totalBooths = rows.reduce((a, x) => a + parseBooth(x.booth_no).count, 0);

  const pills = `<span class="pill p-gray">기업 ${rows.length}</span>`
    + `<span class="pill p-gray">부스 ${totalBooths}칸</span>`
    + (noBooth ? `<span class="pill p-red">번호 미배정 ${noBooth}</span>` : '')
    + (unconfirmed ? `<span class="pill p-amber">배정 미확정 ${unconfirmed}</span>` : '')
    + (qtyOdd.length ? `<span class="pill p-red" title="${escAttr(qtyOdd.map(x => `${x.company_name} ${x.booth_no}(${parseBooth(x.booth_no).count}칸) ↔ 수량 ${x.booth_qty}`).join(', '))}">수량 불일치 ${qtyOdd.length}</span>` : '')
    + `<span class="pill p-blue">독립부스 ${selfN}</span>`
    + pillsOf(countBy(rows, x => x.booth_type))
    + '<span style="font-size:10.5px;color:var(--i5);margin-left:2px">부스 번호·층·수량은 행을 눌러 상세에서 고쳐요</span>';

  if(isMobile()) return viewShell(pills, rows.map(x => `
    <div onclick="openExhDr('${escAttr(x.id)}','progress')" style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:11px 12px;margin-bottom:7px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <span class="pill ${x.booth_no ? 'p-blue' : 'p-red'}">${x.booth_no ? '부스 ' + escapeHtml(x.booth_no) : '미배정'}${
          (() => { const b = parseBooth(x.booth_no);
            return b.kind === 'range' ? ` (${b.count}칸)` : b.kind === 'split' ? ' 공동' : ''; })()}</span>
        <span style="font-size:13px;font-weight:700;flex:1;min-width:0">${escapeHtml(exhNames(x).ko)}</span>
        ${x.booth_confirmed === 'yes' || x.booth_confirmed_at ? '<span class="pill p-green">확정</span>' : '<span class="pill p-amber">미확정</span>'}
      </div>
      ${exhNames(x).en ? `<div style="font-size:11px;color:var(--i4);margin:-2px 0 3px">${escapeHtml(exhNames(x).en)}</div>` : ''}
      <div style="font-size:11px;color:var(--i4)">${[x.booth_floor && x.booth_floor + '층', x.booth_type, x.booth_qty && x.booth_qty + '부스', x.grade].filter(Boolean).map(escapeHtml).join(' · ') || '정보 없음'}</div>
      ${x.builder ? `<div style="font-size:11px;color:var(--i3);margin-top:3px">🔧 ${escapeHtml(x.builder)}${x.builder_mobile ? ' · ' + escapeHtml(x.builder_mobile) : ''}</div>` : ''}
    </div>`).join(''));

  return viewShell(pills, `<div class="tw"><table><thead><tr>
      <th style="min-width:64px">부스</th>
      <th style="min-width:150px">기업</th>
      <th style="min-width:46px">층</th>
      <th style="min-width:130px">타입</th>
      <th style="min-width:50px">수량</th>
      <th style="min-width:70px">등급</th>
      <th style="min-width:60px;text-align:center">확정</th>
      <th style="min-width:180px">시공사 (독립부스)</th>
    </tr></thead><tbody>
    ${rows.map(x => {
      const self = x.booth_type === SELF_BUILD_TYPE;
      const done = x.booth_confirmed === 'yes' || !!x.booth_confirmed_at;
      return `<tr onclick="openExhDr('${escAttr(x.id)}','progress')" style="cursor:pointer"
        title="부스 번호·층·수량은 여기서 열리는 상세에서 고칩니다">
        <td style="font-size:12px;font-weight:700${x.booth_no ? '' : ';color:var(--i6)'}">${escapeHtml(x.booth_no || '—')}
          ${(() => { const b = parseBooth(x.booth_no);
            return b.kind === 'range' ? `<div style="font-size:9.5px;color:var(--i4);font-weight:400;margin-top:1px">${b.count}칸</div>`
              : b.kind === 'split' ? `<div style="font-size:9.5px;color:var(--a);font-weight:400;margin-top:1px">공동</div>` : ''; })()}</td>
        ${coCell(x, 'progress')}
        <td style="font-size:11.5px;color:var(--i3)">${x.booth_floor ? escapeHtml(x.booth_floor) + '층' : '<span style="color:var(--i6)">—</span>'}</td>
        <td><select class="fi" style="width:126px;padding:3px 4px;font-size:11px" onclick="event.stopPropagation()"
          onchange="setExhField('${escAttr(x.id)}','booth_type',this.value,'부스 타입')">${boothTypeOptions(x.booth_type)}</select></td>
        <td style="font-size:11.5px;color:var(--i3);text-align:center">${x.booth_qty ? escapeHtml(x.booth_qty) : '<span style="color:var(--i6)">—</span>'}</td>
        <td>${x.grade ? `<span class="pill ${GRADE_CLS[x.grade] || 'p-gray'}">${escapeHtml(x.grade)}</span>` : '<span style="color:var(--i6)">—</span>'}</td>
        <td style="text-align:center">
          <button onclick="event.stopPropagation();toggleExhFlag('${escAttr(x.id)}','booth_confirmed','booth_confirmed_at','배정 확정')"
            title="${done ? '확정 해제' : '배정 확정으로 표시'}"
            style="width:20px;height:20px;border-radius:5px;line-height:1;cursor:pointer;
              border:1.5px solid ${done ? 'var(--g)' : 'var(--i6)'};background:${done ? 'var(--g)' : 'transparent'};
              color:#fff;font-size:11px;font-weight:800">${done ? '✓' : ''}</button></td>
        <td>${self
          ? (x.builder || x.builder_contact || x.builder_mobile
            ? `<div style="font-size:11.5px;font-weight:600">${escapeHtml(x.builder || '업체명 미입력')}</div>
               <div style="font-size:10.5px;color:var(--i4)">${[x.builder_contact, x.builder_mobile || x.builder_tel].filter(Boolean).map(escapeHtml).join(' · ')}</div>`
            : `<button class="btn bs" style="font-size:10.5px" onclick="openExhDr('${escAttr(x.id)}','progress')">시공사 입력</button>`)
          : '<span style="color:var(--i6);font-size:11px">—</span>'}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`);
}

/* ── 비품 현황 ──
   발주는 기업별이 아니라 품목별로 한다 — "테이블 몇 개, 의자 몇 개"를 알아야
   주문서를 쓸 수 있는데, 지금은 51개 기업을 하나씩 열어 더해야 했다.
   품목별 합계를 먼저 보여주고, 아래에 어느 기업이 무엇을 신청했는지 붙인다. */
/* 품목별 합계에서 펼쳐 둔 줄 — 클릭한 품목의 신청 기업 목록을 그 아래 보여준다 */
let equipOpen = new Set();
export function toggleEquipRow(key){
  equipOpen.has(key) ? equipOpen.delete(key) : equipOpen.add(key);
  renderExh();
}

function renderEquipView(list){
  const rows = list.map(x => ({ x, items: itemsFor(x.id).filter(i => (i.category || '') === 'equip') }))
    .filter(r => r.items.length);
  if(!rows.length) return emptyView('신청된 비품이 없어요');

  /* 카탈로그에 이어진 품목은 그 id로 묶는다 — 기업마다 "접이식 체어",
     "C-040 Folding Chair"처럼 다르게 적어 보내도 한 줄로 합쳐진다.
     카탈로그 밖의 항목(그래픽 랩핑·전기 등)만 이름으로 묶는다. */
  const byName = new Map();
  rows.forEach(({ x, items }) => items.forEach(i => {
    const cat = i.catalog_id ? catalogItem(i.catalog_id) : null;
    const k = cat ? cat.id : String(i.name || '(이름 없음)').trim();
    if(!byName.has(k)) byName.set(k, {
      key: k,
      code:   cat ? cat.code : '',
      nameKo: cat ? (cat.name_ko || cat.name_en) : String(i.name || '(이름 없음)').trim(),
      nameEn: cat ? (cat.name_ko ? cat.name_en : '') : '',
      spec:   cat ? cat.spec : '',
      offCatalog: !cat,
      // 신청하다 직접 적어 올린 품목 — 정식 카탈로그와 구분해 두면 나중에
      // 렌탈사 카탈로그를 다시 받을 때 무엇을 확인해야 할지 알 수 있다
      direct: !!(cat && cat.note === '직접 추가'),
      qty: 0, cos: [], krw: 0, usd: 0,
    });
    const g = byName.get(k);
    const q = Number(String(i.qty || '').replace(/[^0-9.-]/g, '')) || 0;
    const amt = Number(String(i.amount || '').replace(/[^0-9.-]/g, '')) || 0;
    /* 공동 부스에서 비용만 나눠 낸 줄은 수량을 세지 않는다. 실물은 상대 기업이
       주문하므로 여기서 또 세면 없는 의자를 발주하게 된다. 금액은 센다. */
    const shareOnly = !!String(i.shared_ref || '').trim();
    if(!shareOnly) g.qty += q || 1;   // 수량을 안 적었으면 1개로 센다
    else g.shared = true;
    g.cos.push({ id: x.id, name: x.company_name, booth: x.booth_no, qty: shareOnly ? 0 : (q || 1),
      amt, cur: i.currency || 'KRW', raw: i.name, shareOnly });
    // 통화별로 나눠 담는다 — 합치면 원화와 달러를 더한 숫자가 된다.
    // 청구에서 뺀 항목은 수량은 세되 금액은 더하지 않는다 — 발주는 해야 하지만
    // 우리 청구액은 아니다.
    if(isBillable(i)){ if((i.currency || 'KRW') === 'USD') g.usd += amt; else g.krw += amt; }
    else g.excluded = true;
  }));
  const groups = [...byName.values()].sort((a, b) => b.qty - a.qty);

  const offN = groups.filter(g => g.offCatalog).length;
  const totKrw = groups.reduce((a, g) => a + g.krw, 0);
  const totUsd = groups.reduce((a, g) => a + g.usd, 0);
  const pills = `<span class="pill p-gray">신청 기업 ${rows.length}</span>`
    + `<span class="pill p-blue">품목 ${groups.length}종</span>`
    + `<span class="pill p-gray">총 ${groups.reduce((a, g) => a + g.qty, 0)}개</span>`
    + (totKrw ? `<span class="pill p-gray">${fmtMoney(totKrw, 'KRW')}</span>` : '')
    + (totUsd ? `<span class="pill p-gray">${fmtMoney(totUsd, 'USD')}</span>` : '')
    + (offN ? `<span class="pill p-amber" title="카탈로그에 없는 품목 — 그래픽·전기처럼 다른 분류일 수 있어요">카탈로그 외 ${offN}종</span>` : '');

  /* 어느 기업이 신청했는지 — 품목을 클릭하면 펼친다.
     발주하다 "이 의자 25개가 어디로 가는 거지"를 확인해야 할 때, 표 밖으로
     나가지 않고 그 자리에서 본다. */
  const coList = (g) => g.cos.slice().sort((a, b) => b.qty - a.qty).map(c => `
    <div onclick="event.stopPropagation();openExhDr('${escAttr(c.id)}','billing')"
      style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:11.5px">
      <span class="pill p-gray" style="min-width:52px;text-align:center">${c.booth ? '부스 ' + escapeHtml(c.booth) : '미배정'}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.name)}</span>
      <span style="color:var(--i3)">${c.shareOnly ? '<span class="pill p-blue" style="font-size:9px">비용 분담</span>' : c.qty + '개'}</span>
      <span style="min-width:88px;text-align:right;font-weight:600">${c.amt ? fmtMoney(c.amt, c.cur) : '-'}</span>
    </div>`).join('');

  const summaryBody = isMobile()
    /* 좁은 화면에서는 표를 쓰지 않는다 — 헤더가 숨겨지면서 25 / 7곳 / 187,000원이
       각각 무슨 숫자인지 알 수 없게 된다. 값마다 이름을 붙여 카드로 그린다. */
    ? groups.map(g => {
      const open = equipOpen.has(g.key);
      return `<div style="padding:8px 0;border-bottom:1px solid var(--i8)">
        <div onclick="toggleEquipRow('${escAttr(g.key)}')" style="cursor:pointer">
          <div style="display:flex;align-items:baseline;gap:7px">
            ${g.code ? `<span class="pill ${g.direct ? 'p-teal' : 'p-blue'}" style="font-size:9px">${escapeHtml(g.code)}</span>` : ''}
            <span style="font-size:12.5px;font-weight:600;flex:1;min-width:0">${escapeHtml(g.nameKo)}</span>
            <span style="font-size:15px;font-weight:800">${g.qty}<span style="font-size:10px;font-weight:400;color:var(--i4)">개</span></span>
          </div>
          ${g.nameEn ? `<div style="font-size:10.5px;color:var(--i4)">${escapeHtml(g.nameEn)}</div>` : ''}
          <div style="font-size:10.5px;color:var(--i4);margin-top:2px">
            ${g.spec ? escapeHtml(g.spec) + ' · ' : ''}${g.cos.length}개사 신청
            ${g.krw ? ' · ' + escapeHtml(fmtMoney(g.krw, 'KRW')) : ''}${g.usd ? ' · ' + escapeHtml(fmtMoney(g.usd, 'USD')) : ''}
            <span style="color:var(--a)"> ${open ? '▲ 접기' : '▼ 신청 기업'}</span>
          </div>
        </div>
        ${open ? `<div style="margin-top:5px;padding-left:6px;border-left:2px solid var(--i6)">${coList(g)}</div>` : ''}
      </div>`;
    }).join('')

    : `<div class="tw" style="overflow:visible"><table><thead><tr>
        <th style="min-width:66px">품목코드</th>
        <th style="min-width:150px">품명(국문)</th>
        <th style="min-width:150px">품명(영문)</th>
        <th style="min-width:110px">규격</th>
        <th style="min-width:56px;text-align:right">수량</th>
        <th style="min-width:62px;text-align:right">기업</th>
        <th style="min-width:104px;text-align:right">KRW</th>
        <th style="min-width:88px;text-align:right">USD</th>
      </tr></thead><tbody>
        ${groups.map(g => {
          const open = equipOpen.has(g.key);
          return `<tr onclick="toggleEquipRow('${escAttr(g.key)}')" style="cursor:pointer${open ? ';background:var(--ad)' : ''}"
            title="클릭하면 신청한 기업을 볼 수 있어요">
            <td style="font-size:11.5px;font-weight:700;color:var(--i2)">
              <span style="color:var(--a)">${open ? '▾' : '▸'}</span> ${escapeHtml(g.code || '—')}</td>
            <td style="font-size:12.5px;font-weight:600">${escapeHtml(g.nameKo)}
              ${g.excluded ? '<span class="pill p-amber" style="font-size:9px;margin-left:4px" title="우리가 청구하지 않는 항목이라 금액 합계에서 빠져 있어요">청구 제외</span>' : ''}
              ${g.offCatalog ? '<span class="pill p-amber" style="font-size:9px;margin-left:4px" title="카탈로그에 없는 품목 — 직접 입력됐어요">카탈로그 외</span>' : ''}
              ${g.direct ? '<span class="pill p-teal" style="font-size:9px;margin-left:4px" title="신청하면서 직접 적어 품목마스터에 올린 품목이에요 — 단가·규격을 확인해주세요">직접 추가</span>' : ''}</td>
            <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(g.nameEn || '-')}</td>
            <td style="font-size:11px;color:var(--i4)">${escapeHtml(g.spec || '-')}</td>
            <td style="text-align:right;font-weight:700">${g.qty}</td>
            <td style="text-align:right;color:var(--i4)">${g.cos.length}곳</td>
            <td style="text-align:right">${g.krw ? escapeHtml(fmtMoney(g.krw, 'KRW')) : '<span style="color:var(--i6)">-</span>'}</td>
            <td style="text-align:right">${g.usd ? escapeHtml(fmtMoney(g.usd, 'USD')) : '<span style="color:var(--i6)">-</span>'}</td>
          </tr>
          ${open ? `<tr><td colspan="8" style="padding:8px 12px 12px;background:var(--i9)">
            <div style="font-size:10.5px;color:var(--i4);margin-bottom:4px">신청 기업 ${g.cos.length}곳 — 클릭하면 그 기업 정산 탭으로 갑니다</div>
            ${coList(g)}</td></tr>` : ''}`;
        }).join('')}
      </tbody>
      <tfoot><tr style="border-top:2px solid var(--i5);font-weight:800">
        <td colspan="4" style="font-size:12px">합계 ${groups.length}종</td>
        <td style="text-align:right">${groups.reduce((a, g) => a + g.qty, 0)}</td>
        <td></td>
        <td style="text-align:right">${totKrw ? escapeHtml(fmtMoney(totKrw, 'KRW')) : '-'}</td>
        <td style="text-align:right">${totUsd ? escapeHtml(fmtMoney(totUsd, 'USD')) : '-'}</td>
      </tr></tfoot></table></div>`;

  const summary = `<div class="uc" style="margin-bottom:14px">
    <div class="uc-ttl">품목별 합계 <span style="font-weight:400;color:var(--i4);font-size:10px">— 발주서에 쓰는 숫자예요. 품목을 클릭하면 신청 기업이 보입니다</span></div>
    ${summaryBody}</div>`;

  const detail = rows.map(({ x, items }) => `
    <div style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:11px 12px;margin-bottom:7px">
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:5px">
        ${x.booth_no ? `<span class="pill p-blue">부스 ${escapeHtml(x.booth_no)}</span>` : ''}
        <span onclick="openExhDr('${escAttr(x.id)}','billing')" style="cursor:pointer;flex:1;min-width:0">
          <span style="font-size:13px;font-weight:700">${escapeHtml(exhNames(x).ko)}</span>${
          exhNames(x).en ? `<span style="font-size:11px;color:var(--i4);margin-left:5px">${escapeHtml(exhNames(x).en)}</span>` : ''}</span>
        <span style="font-size:11px;color:var(--i4)">${items.length}종</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${items.map(i => `<span class="pill p-gray" title="${escAttr(fmtMoney(i.amount, i.currency || 'KRW'))}">${escapeHtml(i.name || '')}${i.qty ? ' ×' + escapeHtml(i.qty) : ''}</span>`).join('')}
      </div>
      ${x.extra_equipment ? `<div style="font-size:11px;color:var(--i4);margin-top:5px">메모: ${escapeHtml(x.extra_equipment)}</div>` : ''}
    </div>`).join('');

  const actions = `<button class="btn bp bs" onclick="openNewCatalogItem()">+ 품목 추가</button>`;
  return viewShell(pills, summary + `<div class="sct">기업별 신청 내역</div>` + detail, actions);
}

/* ── 그래픽 현황 ──
   제작(디자인)은 초안 → 수정안 → 최종안으로 왔다 갔다 하고, 출력은 규격이
   맞는지만 보면 된다. 두 흐름이 섞여 있어 한 표에서 지금 누가 어느 단계에
   걸려 있는지 봐야 다음 연락처를 정할 수 있다. */
function renderGraphicView(list){
  const rows = list.filter(x => x.graphic_ordered_at || x.graphic_type
    || itemsFor(x.id).some(i => (i.category || '') === 'graphic'));
  if(!rows.length) return emptyView('그래픽을 주문한 기업이 없어요');

  const design = rows.filter(x => x.graphic_type === 'design');
  const print  = rows.filter(x => x.graphic_type === 'print');
  const doneN  = rows.filter(x => graphicState(x).state === 'done').length;
  const warnN  = rows.filter(x => graphicState(x).state === 'warn').length;

  const pills = `<span class="pill p-gray">주문 ${rows.length}</span>`
    + `<span class="pill p-blue">제작 ${design.length}</span>`
    + `<span class="pill p-gray">출력 ${print.length}</span>`
    + `<span class="pill p-green">완료 ${doneN}</span>`
    + (warnN ? `<span class="pill p-red">규격 확인 ${warnN}</span>` : '');

  const stageLabel = (x) => {
    if(x.graphic_type === 'print') return x.graphic_spec_ok === 'yes' ? '규격 확인됨'
      : x.graphic_spec_ok === 'no' ? '규격 불일치' : '규격 미확인';
    if(x.graphic_final_at) return '최종안 확정';
    if(x.graphic_revised_at) return '수정안';
    if(x.graphic_draft_at) return '초안';
    return '진행 전';
  };
  const gAmt = (x) => {
    const by = {};
    itemsFor(x.id).filter(i => (i.category || '') === 'graphic').forEach(i => {
      const c = i.currency || 'KRW';
      by[c] = (by[c] || 0) + (Number(String(i.amount || '').replace(/[^0-9.-]/g, '')) || 0);
    });
    const ks = Object.keys(by).filter(k => by[k]);
    return ks.length ? ks.map(k => fmtMoney(by[k], k)).join(' + ') : '-';
  };

  const gActions = `<button class="btn bp bs" onclick="openNewGraphicOrder()">+ 그래픽 주문 추가</button>`;

  if(isMobile()) return viewShell(pills, rows.map(x => {
    const g = graphicState(x);
    return `<div onclick="openExhDr('${escAttr(x.id)}','graphic')" style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:11px 12px;margin-bottom:7px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <span style="flex:1;min-width:0">
          <span style="font-size:13px;font-weight:700">${escapeHtml(exhNames(x).ko)}</span>${
          exhNames(x).en ? `<span style="font-size:11px;color:var(--i4);margin-left:5px">${escapeHtml(exhNames(x).en)}</span>` : ''}</span>
        <span class="pill ${x.graphic_type === 'design' ? 'p-blue' : 'p-gray'}">${x.graphic_type === 'design' ? '제작' : x.graphic_type === 'print' ? '출력' : '유형 미정'}</span>
        <span class="pill ${g.state === 'done' ? 'p-green' : g.state === 'warn' ? 'p-red' : 'p-amber'}">${escapeHtml(stageLabel(x))}</span>
      </div>
      <div style="font-size:11px;color:var(--i4)">주문 ${escapeHtml(x.graphic_ordered_at || '-')} · 금액 ${escapeHtml(gAmt(x))}</div>
    </div>`;
  }).join(''), gActions);

  return viewShell(pills, `<div class="tw"><table><thead><tr>
      <th style="min-width:150px">기업</th>
      <th style="min-width:56px">부스</th>
      <th style="min-width:80px">유형</th>
      <th style="min-width:96px">시안</th>
      <th style="min-width:150px">확인 진행</th>
      <th style="min-width:104px">초안</th>
      <th style="min-width:104px">수정안</th>
      <th style="min-width:104px">최종안</th>
      <th style="min-width:100px;text-align:right">금액</th>
    </tr></thead><tbody>
    ${rows.map(x => {
      const g = graphicState(x);
      const isPrint = x.graphic_type === 'print';
      const dateCell = (f) => isPrint ? '<td style="color:var(--i6);text-align:center">·</td>'
        : `<td><input type="date" class="fi" style="width:100px;padding:3px 5px;font-size:11px" value="${escAttr(x[f] || '')}"
            onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr({graphic_draft_at:'초안',graphic_revised_at:'수정안',graphic_final_at:'최종안'}[f])}')"></td>`;
      return `<tr>
        ${coCell(x, 'graphic')}
        <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(x.booth_no || '—')}</td>
        <td><select class="fi" style="width:74px;padding:3px 4px;font-size:11px"
          onchange="setExhField('${escAttr(x.id)}','graphic_type',this.value,'그래픽 유형')">
          <option value=""${!x.graphic_type ? ' selected' : ''}>미정</option>
          <option value="design"${x.graphic_type === 'design' ? ' selected' : ''}>제작</option>
          <option value="print"${x.graphic_type === 'print' ? ' selected' : ''}>출력</option>
        </select></td>
        <td><span class="pill ${g.state === 'done' ? 'p-green' : g.state === 'warn' ? 'p-red' : 'p-amber'}">${escapeHtml(stageLabel(x))}</span></td>
        <td>${stageCell(x, 'graphic_stage', GRAPHIC_STAGES)}</td>
        ${dateCell('graphic_draft_at')}
        ${dateCell('graphic_revised_at')}
        ${dateCell('graphic_final_at')}
        <td style="text-align:right;font-size:11.5px;font-weight:600">${escapeHtml(gAmt(x))}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`, gActions);
}

/* ══════════════════════════════════════════
   그 페이지에서 바로 새로 만들기

   품목이나 그래픽 주문을 넣으려고 기업 드로어를 찾아 열고 정산 탭까지 들어가야
   했다. 품목표를 손보는 일과 주문을 받아 적는 일은 그 화면을 보고 있을 때 생기니,
   그 자리에서 끝낼 수 있어야 한다.
══════════════════════════════════════════ */
/* 표 안에서 단계를 한 칸씩 넘긴다. 어느 쪽 차례인지 색으로 구분한다 —
   우리 차례는 눈에 띄어야 하고, 남에게 넘겨 둔 건은 조용해야 한다. */
export function stageCell(x, field, defs){
  const st = stageOf(defs, x[field]);
  const days = stageAge(x, defs, field);
  const cls = st.who === 'us' ? 'p-red' : st.who === 'team' ? 'p-amber' : st.key ? 'p-green' : 'p-gray';
  return `<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
    <span class="pill ${cls}">${escapeHtml(st.label)}${days ? ` ${days}일` : ''}</span>
    ${st.next ? `<button class="btn bs" style="font-size:10px;padding:2px 7px"
      onclick="event.stopPropagation();advanceStage('${escAttr(x.id)}','${field}')"
      title="다음 단계로 넘깁니다">${escapeHtml(st.action)} →</button>` : ''}
    ${st.key ? `<button class="btn bs" style="font-size:10px;padding:2px 5px;color:var(--i4)"
      onclick="event.stopPropagation();rewindStage('${escAttr(x.id)}','${field}')" title="이전 단계로 되돌립니다">↩</button>` : ''}
  </div>`;
}

const STAGE_DEFS = { tax_stage: TAX_STAGES, graphic_stage: GRAPHIC_STAGES };
const STAGE_NAME = { tax_stage: '세금계산서', graphic_stage: '그래픽' };

/* 다음 단계로. 넘어간 날짜를 함께 찍어 두면 어디서 며칠 묶여 있었는지 남는다. */
export async function advanceStage(id, field){
  const x = getExhibitorById(id);
  const defs = STAGE_DEFS[field];
  if(!x || !defs) return;
  const st = stageOf(defs, x[field]);
  if(!st.next) return;
  const nx = stageOf(defs, st.next);
  const patch = { [field]: nx.key };
  if(nx.at && !String(x[nx.at] || '').trim()) patch[nx.at] = td();
  await patchExh(id, patch, null);
  trackAction('status', `${STAGE_NAME[field]} 단계`, x.company_name || '',
    `<b>${escapeHtml(x.company_name || '')}</b> ${escapeHtml(STAGE_NAME[field])} ${escapeHtml(st.label)} → ${escapeHtml(nx.label)}`);
}

/* 잘못 넘겼을 때 되돌린다.
   날짜는 지우지 않는다. 처음엔 지웠는데, 그러면 실수로 한 번 누른 것만으로
   실제로 있었던 발행일이 사라지고 되돌릴 방법이 없었다 — 그렇게 한 건을 잃었다.
   날짜는 그 일이 있었다는 기록이므로 남기고, 틀렸으면 날짜 칸에서 직접 고친다. */
export async function rewindStage(id, field){
  const x = getExhibitorById(id);
  const defs = STAGE_DEFS[field];
  if(!x || !defs) return;
  const i = defs.findIndex(s => s.key === (x[field] || ''));
  if(i <= 0) return;
  const cur = defs[i], prev = defs[i - 1];
  await patchExh(id, { [field]: prev.key }, null);
  trackAction('status', `${STAGE_NAME[field]} 단계`, x.company_name || '',
    `<b>${escapeHtml(x.company_name || '')}</b> ${escapeHtml(STAGE_NAME[field])} ${escapeHtml(cur.label)} → ${escapeHtml(prev.label)} (되돌림)`);
}

/* ══════════════════════════════════════════
   프로그램북 현황

   도록에 실을 정보를 기업마다 받아 정리한다. 자료를 받았는지만 체크하던 것으로는
   무엇이 왔고 무엇이 비었는지 알 수 없어 매번 메일을 다시 열어야 했다.

   회사소개는 지면이 정해져 있어 글자수가 곧 편집 가능 여부다. 저장은 원문 그대로
   하고 글자수는 화면에서 센다 — 세어 둔 숫자를 저장하면 본문을 고쳤을 때 어긋난다.
   띄어쓰기와 줄바꿈은 그대로 세되, 앞뒤 공백만 덜어낸다(편집에서 의미가 없다).
══════════════════════════════════════════ */
export const introLen = (v) => String(v ?? '').trim().length;

/* 단어수 — 영문 소개가 대부분이라 공백으로 끊어 센다.
   지면 기준이 1,354자(189단어)로 잡혀 있어 여유를 두고 1,300자 / 200단어를
   한도로 쓴다. 둘 중 하나만 넘어도 지면을 넘길 수 있으므로 각각 본다. */
export const introWords = (v) => {
  const t = String(v ?? '').trim();
  return t ? t.split(/\s+/).length : 0;
};
export const BOOK_LIMIT = { chars: 1300, words: 200 };

/* 넘쳤나 — 넘긴 쪽과 얼마나 넘겼는지 함께 돌려준다 */
export function introOver(v){
  const c = introLen(v), w = introWords(v);
  const over = [];
  if(c > BOOK_LIMIT.chars) over.push(`${c - BOOK_LIMIT.chars}자`);
  if(w > BOOK_LIMIT.words) over.push(`${w - BOOK_LIMIT.words}단어`);
  return { chars: c, words: w, over, isOver: over.length > 0 };
}

const BOOK_FIELDS = [
  ['book_address', '주소'],
  ['book_phone',   '연락처'],
  ['book_website', '웹사이트'],
];

/* 도록에 낼 정보를 다 채웠나 — 빠진 칸을 모아 알려준다 */
export function bookMissing(x){
  const miss = [];
  if(x.book_logo !== 'yes') miss.push('로고');
  BOOK_FIELDS.forEach(([f, l]) => { if(!String(x[f] || '').trim()) miss.push(l); });
  if(!introLen(x.book_intro)) miss.push('회사소개');
  return miss;
}

function renderBookView(list){
  if(!list.length) return emptyView('표시할 기업이 없어요');

  /* 순서를 적어 뒀으면 그 순서로, 없으면 부스 번호순으로 세운다 — 도록은 보통
     부스 배치 순으로 싣기 때문에 그게 기본값으로 쓸 만하다. */
  const rows = [...list].sort((a, b) => {
    const ao = Number(String(a.book_order || '').replace(/[^0-9]/g, '')) || 0;
    const bo = Number(String(b.book_order || '').replace(/[^0-9]/g, '')) || 0;
    if(ao || bo) return (ao || 1e9) - (bo || 1e9);
    return boothSortKey(a) - boothSortKey(b);
  });

  const done = rows.filter(x => !bookMissing(x).length).length;
  const noLogo = rows.filter(x => x.book_logo !== 'yes').length;
  const noIntro = rows.filter(x => !introLen(x.book_intro)).length;
  const lens = rows.map(x => introLen(x.book_intro)).filter(Boolean);
  const overRows = rows.map(x => ({ x, o: introOver(x.book_intro) })).filter(r => r.o.isOver);
  const overN = overRows.length;

  const pills = `<span class="pill p-gray">기업 ${rows.length}</span>`
    + `<span class="pill ${done === rows.length ? 'p-green' : 'p-amber'}">완성 ${done}/${rows.length}</span>`
    + (noLogo ? `<span class="pill p-red">로고 미확보 ${noLogo}</span>` : '')
    + (noIntro ? `<span class="pill p-red">회사소개 없음 ${noIntro}</span>` : '')
    + (lens.length ? `<span class="pill p-gray" title="띄어쓰기 포함">소개 ${Math.min(...lens)}~${Math.max(...lens)}자</span>` : '')
    + (overN ? `<span class="pill p-red" title="${escAttr(overRows.map(o => `${exhNames(o.x).ko} ${o.o.chars}자`).join(', '))}">한도 초과 ${overN}</span>` : '')
    + `<span style="font-size:10.5px;color:var(--i5);margin-left:2px">한도 ${BOOK_LIMIT.chars.toLocaleString()}자 · ${BOOK_LIMIT.words}단어 (띄어쓰기 포함)</span>`;

  const actions = `<button class="btn bs" onclick="fillBookOrder()" title="지금 부스 번호순으로 1번부터 다시 매깁니다">순서 자동 매기기</button>`;

  const logoBtn = (x) => `<button
    onclick="event.stopPropagation();cycleBookLogo('${escAttr(x.id)}')"
    title="${x.book_logo === 'yes' ? '로고 받음' : x.book_logo === 'no' ? '로고 없음 — 요청 필요' : '아직 확인 안 함'}"
    style="border:none;background:none;padding:0;cursor:pointer;font-size:14px;line-height:1">
    ${x.book_logo === 'yes' ? '<span style="color:var(--g)">✓</span>'
      : x.book_logo === 'no' ? '<span style="color:var(--re)">✕</span>'
      : '<span style="color:var(--i6)">—</span>'}</button>`;

  const introCell = (x) => {
    const o = introOver(x.book_intro);
    if(!o.chars) return `<span class="pill p-red" style="cursor:pointer"
      onclick="event.stopPropagation();openBookIntro('${escAttr(x.id)}')">없음</span>`;
    return `<span class="pill ${o.isOver ? 'p-red' : 'p-green'}" style="cursor:pointer"
      onclick="event.stopPropagation();openBookIntro('${escAttr(x.id)}')"
      title="${o.chars}자 / ${o.words}단어 · 한도 ${BOOK_LIMIT.chars}자 · ${BOOK_LIMIT.words}단어${
        o.isOver ? ` — ${o.over.join(', ')} 초과` : ''}">${o.chars}자${
        o.isOver ? ` <b>+${o.over[0]}</b>` : ''}</span>`;
  };

  if(isMobile()) return viewShell(pills, rows.map(x => {
    const miss = bookMissing(x);
    return `<div onclick="openExhDr('${escAttr(x.id)}','book')" style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:11px 12px;margin-bottom:7px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <span class="pill p-gray">${escapeHtml(x.book_order || '-')}</span>
        <span style="font-size:13px;font-weight:700;flex:1;min-width:0">${escapeHtml(exhNames(x).ko)}</span>
        ${x.booth_no ? `<span class="pill p-blue">부스 ${escapeHtml(x.booth_no)}</span>` : ''}
      </div>
      ${(() => { const o = introOver(x.book_intro);
        return `<div style="font-size:11px;color:${o.isOver ? 'var(--re)' : 'var(--i4)'}">회사소개 ${o.chars}자 · ${o.words}단어${
          o.isOver ? ` (${o.over.join(', ')} 초과)` : ''} · 로고 ${
          x.book_logo === 'yes' ? '있음' : x.book_logo === 'no' ? '없음' : '미확인'}</div>`; })()}
      ${miss.length
        ? `<div style="font-size:11px;color:var(--re);margin-top:3px">빠짐: ${escapeHtml(miss.join(', '))}</div>`
        : '<div style="font-size:11px;color:var(--g);margin-top:3px">모두 채워졌어요</div>'}
    </div>`;
  }).join(''), actions);

  const cell = (x, f, w) => `<td><input class="fi" style="width:${w};padding:3px 5px;font-size:11.5px"
    value="${escAttr(x[f] || '')}" onclick="event.stopPropagation()"
    onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr((BOOK_FIELDS.find(b => b[0] === f) || ['', f])[1])}')"></td>`;

  return viewShell(pills, `<div class="tw"><table><thead><tr>
      <th style="min-width:48px">순서</th>
      <th style="min-width:44px;text-align:center">로고</th>
      <th style="min-width:150px">기업명</th>
      <th style="min-width:56px">부스</th>
      <th style="min-width:170px">주소</th>
      <th style="min-width:110px">연락처</th>
      <th style="min-width:140px">웹사이트</th>
      <th style="min-width:70px;text-align:center">회사소개</th>
      <th style="min-width:80px">빠진 항목</th>
    </tr></thead><tbody>
    ${rows.map(x => {
      const miss = bookMissing(x);
      return `<tr onclick="openExhDr('${escAttr(x.id)}','book')" style="cursor:pointer">
        <td><input class="fi" style="width:42px;padding:3px 5px;font-size:11.5px;text-align:center;font-weight:700"
          value="${escAttr(x.book_order || '')}" onclick="event.stopPropagation()"
          onchange="setExhField('${escAttr(x.id)}','book_order',this.value,'도록 순서')"></td>
        <td style="text-align:center">${logoBtn(x)}</td>
        ${coCell(x, 'book')}
        <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(x.booth_no || '—')}</td>
        ${cell(x, 'book_address', '164px')}
        ${cell(x, 'book_phone', '104px')}
        ${cell(x, 'book_website', '134px')}
        <td style="text-align:center">${introCell(x)}</td>
        <td>${miss.length
          ? `<span class="pill p-amber" title="${escAttr(miss.join(', '))}">${miss.length}개</span>`
          : '<span class="pill p-green">완료</span>'}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`, actions);
}

/* 로고는 받음 / 없음 / 미확인 셋뿐이라 눌러서 돌린다 */
export async function cycleBookLogo(id){
  const x = getExhibitorById(id);
  if(!x) return;
  const next = { '': 'yes', yes: 'no', no: '' }[x.book_logo || ''];
  await patchExh(id, { book_logo: next }, null);
}

/* 지금 목록을 부스 번호순으로 1번부터 다시 매긴다 */
export async function fillBookOrder(){
  const rows = [...visibleList()].sort((a, b) => boothSortKey(a) - boothSortKey(b));
  if(!rows.length) return;
  if(!confirm(`${rows.length}개 기업의 도록 순서를 부스 번호순으로 다시 매길까요? 이미 적어둔 순서는 덮어씁니다.`)) return;
  for(let i = 0; i < rows.length; i++){
    if(String(rows[i].book_order || '') === String(i + 1)) continue;
    await patchExh(rows[i].id, { book_order: String(i + 1) }, null);
  }
  renderExh();
}

/* 회사소개는 길어서 표 칸에 안 들어간다 — 눌러서 따로 연다.
   고치는 동안 글자수가 바로 따라 움직여야 몇 자를 줄여야 하는지 보인다. */
export function openBookIntro(id){
  const x = getExhibitorById(id);
  if(!x) return;
  modalShell('book-intro-modal', `회사소개 — ${exhNames(x).ko}`, `
    <textarea class="fi" id="bi-text" rows="12" style="font-size:12.5px;line-height:1.7"
      oninput="updateIntroCount()"
      placeholder="도록에 실을 회사소개를 붙여넣으세요">${escapeHtml(x.book_intro || '')}</textarea>
    <div id="bi-meter" style="font-size:11.5px;margin:8px 0 12px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn bs" onclick="closeBookIntro()">취소</button>
      <button class="btn bp" onclick="saveBookIntro('${escAttr(id)}')">저장</button>
    </div>`);
  updateIntroCount();
  document.getElementById('bi-text')?.focus();
}

/* 고치는 동안 남은 글자수가 따라 움직여야 몇 자를 줄여야 하는지 보인다 */
export function updateIntroCount(){
  const ta = document.getElementById('bi-text');
  const el = document.getElementById('bi-meter');
  if(!ta || !el) return;
  const o = introOver(ta.value);
  const bad = o.isOver;
  el.innerHTML = `<span style="color:${bad ? 'var(--re)' : 'var(--i4)'}">
      띄어쓰기 포함 <b style="font-size:13px">${o.chars}</b>자 · <b style="font-size:13px">${o.words}</b>단어</span>
    <span style="color:var(--i5)"> / 한도 ${BOOK_LIMIT.chars.toLocaleString()}자 · ${BOOK_LIMIT.words}단어</span>
    ${bad ? `<div style="color:var(--re);font-weight:700;margin-top:3px">${o.over.join(', ')} 초과 — 줄여야 실립니다</div>`
      : `<div style="color:var(--g);margin-top:3px">지면에 들어갑니다 (${BOOK_LIMIT.chars - o.chars}자 여유)</div>`}`;
}

export async function saveBookIntro(id){
  const el = document.getElementById('bi-text');
  if(!el) return;
  await patchExh(id, { book_intro: el.value.trim() }, null);
  closeBookIntro();
  renderExh();
}
export const closeBookIntro = () => document.getElementById('book-intro-modal')?.remove();

export const modalShell = (id, title, body) => {
  if(document.getElementById(id)) return;
  const el = document.createElement('div');
  el.id = id;
  /* 오버레이는 .mw(position:fixed + z-index), 안쪽 패널은 .modal이다.
     전에 두 클래스를 뒤바꿔 써서 모달이 크기 0으로 깔려 화면에 보이지 않았다 —
     함수는 정상이라 프로그램으로 부르면 동작했지만 사람은 누를 수가 없었다. */
  el.className = 'mw on';
  /* 배경을 눌러 닫되, 누르기 시작한 곳이 패널 안이면 닫지 않는다.
     글자를 드래그로 선택하다 패널 밖에서 손을 떼면 click의 target이 배경이 되는데,
     그것까지 닫아 버리면 복사하려다 입력하던 내용을 통째로 잃는다. */
  let downOnBg = false;
  el.addEventListener('mousedown', (e) => { downOnBg = (e.target === el); });
  el.addEventListener('click', (e) => { if(e.target === el && downOnBg) el.remove(); });
  el.innerHTML = `<div class="modal" style="max-width:440px">
    <div class="mh"><div class="mt2">${escapeHtml(title)}</div>
      <button class="mc" onclick="document.getElementById('${id}')?.remove()">✕</button></div>
    <div class="mb">${body}</div></div>`;
  document.body.appendChild(el);
};
const mval = (id) => (document.getElementById(id) || {}).value?.trim() || '';

/* ── 품목 추가 (행사 품목마스터) ── */
const EQ_CATS = ['의자', '테이블', '진열대', '가전제품', '기타비품'];

export function openNewCatalogItem(){
  if(!exhEvent){ alert('행사를 먼저 선택해주세요.'); return; }
  modalShell('new-eq-modal', '품목 추가', `
    <div style="font-size:11.5px;color:var(--i4);margin-bottom:12px;line-height:1.6">
      <b>${escapeHtml(exhEvent)}</b> 품목표에 추가됩니다. 다른 행사에는 영향이 없어요.</div>
    <div class="fgr">
      <div class="fg"><label class="fl">분류</label>
        <select class="fi" id="neq-cat">${EQ_CATS.map(c => `<option value="${escAttr(c)}">${escapeHtml(c)}</option>`).join('')}</select></div>
      <div class="fg"><label class="fl">품목코드</label>
        <input class="fi" id="neq-code" placeholder="비우면 자동 (X-001…)"></div>
    </div>
    <div class="fg"><label class="fl">품명 (국문)</label><input class="fi" id="neq-ko" placeholder="예: 접이식 체어"></div>
    <div class="fg"><label class="fl">품명 (영문)</label><input class="fi" id="neq-en" placeholder="예: Folding Chair"></div>
    <div class="fg"><label class="fl">규격</label><input class="fi" id="neq-spec" placeholder="예: 500*420*750mmH"></div>
    <div class="fgr">
      <div class="fg"><label class="fl">단가 (KRW)</label><input class="fi" id="neq-krw" placeholder="11000"></div>
      <div class="fg"><label class="fl">단가 (USD)</label><input class="fi" id="neq-usd" placeholder="11"></div>
    </div>
    <div id="neq-msg" style="font-size:11.5px;min-height:16px;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn bs" onclick="document.getElementById('new-eq-modal')?.remove()">취소</button>
      <button class="btn bp" id="neq-save" onclick="submitNewCatalogItem()">추가</button>
    </div>`);
  document.getElementById('neq-ko')?.focus();
}

export async function submitNewCatalogItem(){
  const msg = document.getElementById('neq-msg');
  const btn = document.getElementById('neq-save');
  const ko = mval('neq-ko'), en = mval('neq-en');
  const fail = (t) => { if(msg){ msg.style.color = 'var(--re)'; msg.textContent = t; }
    if(btn){ btn.disabled = false; btn.textContent = '추가'; } };

  if(!ko && !en) return fail('품명을 국문이나 영문 중 하나는 입력해주세요.');
  if(btn){ btn.disabled = true; btn.textContent = '추가 중…'; }

  // 같은 이름이 이미 있으면 새로 만들지 않는다 — 카탈로그를 둔 이유가 없어진다
  const dup = findCatalogByName(exhEvent, ko || en);
  if(dup) return fail(`이미 있는 품목이에요 — ${dup.code} ${dup.name_ko || dup.name_en}`);

  let code = mval('neq-code').toUpperCase();
  const used = new Set(catalogFor(exhEvent).map(c => String(c.code || '').toUpperCase()));
  if(code && used.has(code)) return fail(`이미 쓰고 있는 코드예요 — ${code}`);
  if(!code){
    let n = 1;
    while(used.has(`X-${String(n).padStart(3, '0')}`)) n++;
    code = `X-${String(n).padStart(3, '0')}`;
  }

  const num = (v) => String(v || '').replace(/[^0-9.]/g, '');
  const rec = {
    id: `EC-${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    event_id: exhEvent, category: mval('neq-cat') || '기타비품', code,
    name_ko: ko, name_en: en, spec: mval('neq-spec'),
    price_krw: num(mval('neq-krw')), price_usd: num(mval('neq-usd')),
    note: '', active: '', sort_order: String(900 + catalogFor(exhEvent).length),
  };

  EQUIP_CATALOG.push(rec);
  const { saveEquipCatalog } = await import('../api.js');
  const r = await saveEquipCatalog(rec);
  if(!r.ok){
    const i = EQUIP_CATALOG.indexOf(rec);
    if(i >= 0) EQUIP_CATALOG.splice(i, 1);
    return fail('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
  }
  if(r.id && r.id !== rec.id) rec.id = r.id;

  trackAction('add', '품목 등록', exhEvent,
    `<b>${escapeHtml(code)}</b> ${escapeHtml(ko || en)} — ${escapeHtml(exhEvent)} 품목표에 추가`);
  document.getElementById('new-eq-modal')?.remove();
  renderExh();
}

/* ── 그래픽 주문 추가 ── */
export function openNewGraphicOrder(){
  if(!exhEvent){ alert('행사를 먼저 선택해주세요.'); return; }
  const cos = activeExhibitors(exhEvent)
    .slice().sort((a, b) => String(a.company_name).localeCompare(String(b.company_name), 'ko'));
  if(!cos.length){ alert('등록된 참가기업이 없어요.'); return; }

  modalShell('new-gr-modal', '그래픽 주문 추가', `
    <div class="fg"><label class="fl">기업</label>
      <select class="fi" id="ngr-co">${cos.map(x =>
        `<option value="${escAttr(x.id)}">${escapeHtml(exhNames(x).ko)}${
          exhNames(x).en ? ` (${escapeHtml(exhNames(x).en)})` : ''}${x.booth_no ? ` · 부스 ${escapeHtml(x.booth_no)}` : ''}</option>`).join('')}</select></div>
    <div class="fgr">
      <div class="fg"><label class="fl">유형</label>
        <select class="fi" id="ngr-type">
          <option value="">미정</option>
          <option value="design">제작 (초안→수정안→최종안)</option>
          <option value="print">출력 (규격 확인만)</option>
        </select></div>
      <div class="fg"><label class="fl">주문일</label>
        <input type="date" class="fi" id="ngr-date" value="${td()}"></div>
    </div>
    <div class="fg"><label class="fl">항목명</label>
      <input class="fi" id="ngr-name" placeholder="예: 인포메이션 데스크 랩핑 (PET)"></div>
    <div class="fgr">
      <div class="fg"><label class="fl">금액</label><input class="fi" id="ngr-amt" placeholder="비우면 나중에"></div>
      <div class="fg"><label class="fl">통화</label>
        <select class="fi" id="ngr-cur"><option value="KRW">KRW</option><option value="USD">USD</option></select></div>
    </div>
    <div id="ngr-msg" style="font-size:11.5px;min-height:16px;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn bs" onclick="document.getElementById('new-gr-modal')?.remove()">취소</button>
      <button class="btn bp" id="ngr-save" onclick="submitNewGraphicOrder()">추가</button>
    </div>`);
  document.getElementById('ngr-name')?.focus();
}

export async function submitNewGraphicOrder(){
  const msg = document.getElementById('ngr-msg');
  const btn = document.getElementById('ngr-save');
  const fail = (t) => { if(msg){ msg.style.color = 'var(--re)'; msg.textContent = t; }
    if(btn){ btn.disabled = false; btn.textContent = '추가'; } };

  const x = getExhibitorById(mval('ngr-co'));
  if(!x) return fail('기업을 골라주세요.');
  const name = mval('ngr-name');
  if(!name) return fail('항목명을 입력해주세요.');
  if(btn){ btn.disabled = true; btn.textContent = '추가 중…'; }

  const amount = mval('ngr-amt').replace(/[^0-9.]/g, '');
  const rec = {
    id: `XI-${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    exhibitor_id: x.id, category: 'graphic', name,
    qty: '', unit_price: '', amount, currency: mval('ngr-cur') || 'KRW',
    note: '', sort_order: String(itemsFor(x.id).length + 1), catalog_id: '',
  };

  EXH_ITEMS.push(rec);
  const { saveExhItem } = await import('../api.js');
  const r = await saveExhItem(rec);
  if(!r.ok){
    const i = EXH_ITEMS.indexOf(rec);
    if(i >= 0) EXH_ITEMS.splice(i, 1);
    return fail('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
  }
  if(r.id && r.id !== rec.id) rec.id = r.id;

  /* 주문일·유형은 참가기업 쪽에 있다. 여기서 함께 넣어 두지 않으면 항목만 생기고
     그래픽 현황에는 '주문 안 함'으로 남아 화면과 데이터가 어긋난다.
     이미 적혀 있으면 덮지 않는다 — 나중 주문이 처음 주문일을 지우면 안 된다. */
  const patch = {};
  if(!String(x.graphic_ordered_at || '').trim()) patch.graphic_ordered_at = mval('ngr-date') || td();
  const type = mval('ngr-type');
  if(type && !String(x.graphic_type || '').trim()) patch.graphic_type = type;
  if(Object.keys(patch).length) await patchExh(x.id, patch, null);

  trackAction('add', '그래픽 주문 추가', x.company_name || '',
    `<b>${escapeHtml(x.company_name || '')}</b> ${escapeHtml(name)}${amount ? ` ${escapeHtml(fmtMoney(amount, rec.currency))}` : ''}`);
  document.getElementById('new-gr-modal')?.remove();
  renderExh();
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

  /* 세금계산서·그래픽에서 지금 우리가 움직여야 하는 건. 남에게 넘겨 둔 건
     (재무팀·그래픽팀 확인 중)은 여기 넣지 않는다 — 재촉은 해도 처리는
     우리 손을 떠나 있어서, 섞어 두면 정작 내가 할 일이 묻힌다. */
  const myTurn = [];
  all.forEach(x => {
    [['tax_stage', TAX_STAGES, '세금계산서'], ['graphic_stage', GRAPHIC_STAGES, '그래픽']]
      .forEach(([f, defs, label]) => {
        const st = stageOf(defs, x[f]);
        if(st.who !== 'us') return;
        myTurn.push({ x, label, st, days: stageAge(x, defs, f) });
      });
  });
  myTurn.sort((a, b) => (b.days || 0) - (a.days || 0));

  /* 남에게 넘겨 둔 건 — 오래 머물면 재촉해야 하니 따로 센다 */
  const waiting = [];
  all.forEach(x => {
    [['tax_stage', TAX_STAGES, '세금계산서'], ['graphic_stage', GRAPHIC_STAGES, '그래픽']]
      .forEach(([f, defs, label]) => {
        const st = stageOf(defs, x[f]);
        if(st.who !== 'team') return;
        waiting.push({ x, label, st, days: stageAge(x, defs, f) });
      });
  });
  waiting.sort((a, b) => (b.days || 0) - (a.days || 0));

  const avg = Math.round(all.reduce((s, x) => s + progressOf(x), 0) / n);
  const todo = openInq.length + overdue.length + attention.length + myTurn.length;
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

  const STATE_PILLS = [['완납','paid','p-green'],['완납 처리','settled','p-green'],['부분 입금','partial','p-amber'],
    ['미납','unpaid','p-gray'],['초과 입금','over','p-red'],['청구 전','none','p-gray']];

  /* ── 카드 조각 ──
     아래 격자에 순서대로 놓기 위해 각 카드를 먼저 만들어 둔다. 순서는
     한눈에 보는 것(요약 → 부스 → 단계 → 정산) 다음에 해야 할 일(처리 필요)과
     방금 무슨 일이 있었나(최근 변경)로 간다. */

  const cardBooth = `<div class="uc">
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
      }).join('') || '<div style="font-size:11.5px;color:var(--i5)">아직 부스 정보가 없어요</div>'}
    </div>`;

  const cardSteps = `<div class="uc">
      <div class="uc-ttl">단계별 진행</div>
      ${STEPS.map(st => {
        const done = all.filter(x => cellState(x, st).state === 'done').length;
        const warn = all.filter(x => cellState(x, st).state === 'warn').length;
        return stepRow(st.label.replace(/<br>/g, ''), done, warn);
      }).join('')}
    </div>`;

  const cardCash = `<div class="uc">
      <div class="uc-ttl">정산 현황</div>
      ${curs.length ? curs.map(cashRow).join('') : '<div style="font-size:11.5px;color:var(--i5)">아직 청구 내역이 없어요</div>'}
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">
        ${STATE_PILLS.filter(p => byState[p[1]]).map(p => `<span class="pill ${p[2]}">${p[0]} ${byState[p[1]]}</span>`).join('')}
      </div>
    </div>`;

  const cardTodo = todo ? `<div class="uc" style="border-left:3px solid var(--am)">
      <div class="uc-ttl">처리 필요 <span class="pill p-amber">${todo}건</span></div>
      ${myTurn.slice(0, 5).map(o => attnRow(o.x, o.label, o.st.action, o.days, o.label === '그래픽' ? 'graphic' : 'billing')).join('')}
      ${openInq.slice(0, 5).map(o => attnRow(o.x, '미답변 문의', o.l.subject || o.l.body || '', daysSince(o.l.ts), 'logs')).join('')}
      ${overdue.slice(0, 5).map(o => attnRow(o.x, '입금 기한', fmtMoney(o.s.balance, o.s.cur) + ' 미납', daysSince(o.s.due), 'billing')).join('')}
      ${attention.slice(0, 5).map(o => attnRow(o.x, '정산 확인', o.why, null, 'billing')).join('')}
      ${todo > 20 ? `<div style="font-size:11px;color:var(--i4);padding:6px 2px">외 ${todo - 20}건 — 왼쪽 필터에서 전체를 볼 수 있어요</div>` : ''}
      ${waiting.length ? `<div style="font-size:10.5px;color:var(--i4);margin-top:8px;padding-top:7px;border-top:1px solid var(--i8)">
        넘겨 둔 일 ${waiting.length}건 — ${waiting.slice(0, 3).map(w =>
          `${escapeHtml(exhNames(w.x).ko)} ${escapeHtml(w.label)}${w.days ? ` ${w.days}일째` : ''}`).join(' · ')}
        ${waiting.length > 3 ? ` 외 ${waiting.length - 3}건` : ''}</div>` : ''}
    </div>` : `<div class="uc" style="border-left:3px solid var(--g)">
      <div class="uc-ttl">처리 필요</div>
      <div style="font-size:12px;color:var(--g)">지금 처리할 게 없어요</div></div>`;

  const cardRecent = (() => {
    // 누가 무엇을 고쳤는지 — 계정 기준으로 최근 변경을 보여준다
    const names = new Set(all.map(x => x.company_name).filter(Boolean));
    const recent = auditLog.filter(l => names.has(l.target)).slice(0, 8);
    if(!recent.length) return `<div class="uc"><div class="uc-ttl">최근 변경</div>
      <div style="font-size:11.5px;color:var(--i5)">아직 변경 이력이 없어요</div></div>`;
    return `<div class="uc">
      <div class="uc-ttl">최근 변경</div>
      ${recent.map(l => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--i8)">
        <span style="width:22px;height:22px;border-radius:50%;background:${escAttr(l.color || '#9C9890')};color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 auto">${escapeHtml((l.name || '?').slice(0,2))}</span>
        <span style="font-size:11px;color:var(--i3);flex:0 0 auto">${escapeHtml(l.name || '')}</span>
        <span style="font-size:11.5px;color:var(--i2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(l.detail || '').replace(/<[^>]+>/g, '')}</span>
        <span style="font-size:10px;color:var(--i5);flex:0 0 auto">${escapeHtml(String(l.ts || '').slice(5,10))}</span>
      </div>`).join('')}
      <div style="font-size:10.5px;color:var(--i5);margin-top:7px">전체 이력은 <b>로그</b> 탭에서 볼 수 있어요</div>
    </div>`;
  })();

  /* ── 배치 ──
     세로로만 쌓으면 넓은 화면에서 오른쪽이 통째로 비고, 부스·단계·정산처럼
     짧은 요약 카드를 보려고 스크롤을 계속 내려야 한다. 12칸 격자에 올려
     중요도와 내용 길이에 따라 폭을 다르게 준다(exh-dash-* 클래스는
     components.css에서 폭에 따라 3분할 → 2분할 → 1단으로 접힌다).

     화면 폭이 아니라 이 영역 자신의 폭을 봐야 한다 — 사이드바를 접거나
     너비를 조절하면 화면 크기는 그대로인데 이 안쪽만 넓어지기 때문이다. */
  return `<div class="exh-dash">

    <div class="cost exh-dash-kpi" style="margin:0">
      ${card('참가기업', n + '곳', cancelledExhibitors(exhEvent).length ? ('취소 ' + cancelledExhibitors(exhEvent).length) : '')}
      ${card('평균 진행률', avg + '%')}
      ${card('미수금', curs.length ? curs.map(c => fmtMoney(cash[c].billed - cash[c].paid, c)).join(' + ') : '-',
        '', dueTotal > 0 ? 'var(--am)' : 'var(--g)')}
      ${card('처리 필요', todo + '건',
        '문의 ' + openInq.length + ' · 기한 ' + overdue.length + ' · 정산 ' + attention.length
        + (myTurn.length ? ' · 내 차례 ' + myTurn.length : ''),
        todo ? 'var(--re)' : 'var(--g)')}
    </div>

    <div class="exh-dash-third">${cardBooth}</div>
    <div class="exh-dash-third">${cardSteps}</div>
    <div class="exh-dash-third">${cardCash}</div>
    <div class="exh-dash-wide">${cardTodo}</div>
    <div class="exh-dash-side">${cardRecent}</div>
  </div>`;
}

/* 처리 필요 목록의 한 줄 — 눌러서 바로 그 기업의 해당 탭으로 간다 */
function attnRow(x, kind, text, days, tab){
  return `<div onclick="openExhDr('${escAttr(x.id)}','${tab}')"
    style="display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:6px;cursor:pointer;background:var(--i9);margin-bottom:4px">
    <span style="flex:0 0 128px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
      <span style="font-weight:700;font-size:11.5px">${escapeHtml(exhNames(x).ko)}</span>${
      exhNames(x).en ? `<span style="font-size:10px;color:var(--i4);margin-left:4px">${escapeHtml(exhNames(x).en)}</span>` : ''}</span>
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
          <span style="font-size:14px;font-weight:700${off ? ';text-decoration:line-through' : ''}">${escapeHtml(exhNames(x).ko)}</span>${
            exhNames(x).en ? `<span style="font-size:11px;color:var(--i4);font-weight:400">${escapeHtml(exhNames(x).en)}</span>` : ''}
          ${off ? '<span class="pill p-gray">참가 취소</span>' : ''}
          ${x.grade && x.grade !== 'Exhibitor' ? `<span class="pill ${GRADE_CLS[x.grade] || 'p-gray'}">${escapeHtml(x.grade)}</span>` : ''}
          ${openN ? `<span class="pill p-amber" style="margin-left:auto"
            onclick="event.stopPropagation();openExhDr('${escAttr(x.id)}','logs')">문의 ${openN}</span>` : ''}
        </div>
        <div style="font-size:11.5px;color:var(--i4);margin-top:3px">
          ${x.booth_no ? `부스 ${escapeHtml(x.booth_no)}${x.booth_floor ? `·${escapeHtml(x.booth_floor)}층` : ''}${x.booth_type ? ` · ${escapeHtml(x.booth_type)}` : ''}` : '부스 미배정'}
          ${pc && (pc.name || pc.email) ? ` · ${escapeHtml(pc.name || pc.email)}` : ''}
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
              <span style="font-weight:700;font-size:12px${off ? ';text-decoration:line-through' : ''}">${escapeHtml(exhNames(x).ko)}</span>${
                exhNames(x).en ? `<span style="font-size:10.5px;color:var(--i4);margin-left:4px">${escapeHtml(exhNames(x).en)}</span>` : ''}
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
        <td>${progressBar(p, p === 100 ? 'var(--g)' : 'var(--a)', '52px')}
            <span style="font-size:10px;color:var(--i4)">${p}%</span></td>
        ${STEPS.map(s => cell(x, s)).join('')}
        <td style="text-align:center" onclick="event.stopPropagation();openExhDr('${escAttr(x.id)}','logs')">
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

export function openExhImport(){
  closeExhImport();
  const evKey = exhEvent || (EVENT_LIST[0] && EVENT_LIST[0].key) || '';
  const pop = document.createElement('div');
  pop.id = 'exh-import-modal';
  pop.className = 'mw on';
  /* 위 modalShell과 같은 이유 — 드래그 선택이 배경에서 끝나도 닫지 않는다 */
  let popDownOnBg = false;
  pop.addEventListener('mousedown', (e) => { popDownOnBg = (e.target === pop); });
  pop.addEventListener('click', (e) => { if(e.target === pop && popDownOnBg) closeExhImport(); });
  pop.innerHTML = `<div class="modal" style="max-width:560px">
    <div class="mh"><div class="mt2">참가기업 불러오기</div>
      <div class="mc">기업DB에 "전시참가기업"으로 기록된 기업을 골라 진행관리에 등록해요</div></div>
    <div class="mb">
      <div class="fg"><label class="fl">행사</label>
        <select class="fi" id="exh-imp-ev" onchange="renderExhImportList()">
          ${exhEventOptions().map(e => `<option value="${escAttr(e.key)}"${e.key === evKey ? ' selected' : ''}>${escapeHtml(e.name || e.key)}</option>`).join('')}
        </select></div>
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
  const cands = el._cands || [];
  const picked = [...document.querySelectorAll('.exh-imp-cb')]
    .filter(cb => cb.checked && !cb.disabled)
    .map(cb => cands[+cb.dataset.i]).filter(Boolean);

  if(!picked.length){ alert('등록할 기업을 선택해주세요.'); return; }
  const btn = document.getElementById('exh-imp-btn');
  if(btn){ btn.disabled = true; btn.textContent = '등록 중…'; }

  const rows = picked.map(c => ({
    event_id: evKey, company_key: c.company_key, company_name: c.company_name,
    status: '준비중', updated_at: td(),
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
/* 어떤 계정이 무엇을 바꿨는지 남긴다. 값 자체를 before → after로 적어
   나중에 "언제 왜 바뀌었나"를 되짚을 수 있게 한다. */
const FIELD_LABEL = {
  manual_sent_at:'매뉴얼 발송', manual_replied_at:'매뉴얼 회신',
  app_received:'신청서 수신', app_received_at:'신청서 수신일', app_complete:'신청서 완비',
  app_missing:'누락 항목', extra_equipment:'추가 비품',
  booth_no:'부스 번호', booth_floor:'부스 층', booth_type:'부스 타입', booth_qty:'부스 수량',
  builder:'시공사명', builder_contact:'시공 담당자', builder_tel:'시공사 유선', builder_mobile:'시공사 휴대폰', builder_email:'시공사 이메일',
  grade:'등급', booth_confirmed:'부스 확정', booth_confirmed_at:'부스 확정일',
  settled:'완납 처리', settled_note:'완납 사유', pay_due_date:'입금 기한',
  tax_sent_at:'세금계산서 발송', tax_amount:'세금계산서 금액',
  tax_contact_name:'세금계산서 담당자', tax_contact_email:'세금계산서 이메일', tax_contact_phone:'세금계산서 연락처',
  graphic_ordered_at:'그래픽 주문', graphic_type:'그래픽 유형', graphic_spec_ok:'그래픽 규격',
  graphic_spec_note:'규격 메모', graphic_draft_at:'초안', graphic_revised_at:'수정안', graphic_final_at:'최종안',
  directory_received:'도록 자료', directory_received_at:'도록 수신일', directory_note:'도록 메모',
  movein_at:'반입·설치', builder:'설치업체', badge_count:'출입증 매수', badge_issued_at:'출입증 발급',
  onsite_note:'현장 메모', status:'상태', note:'메모',
};
const shortVal = (v) => { const t = String(v ?? '').trim();
  return !t ? '(없음)' : (t.length > 24 ? t.slice(0, 24) + '…' : t); };

export function logExhEdit(x, patch, backup){
  const parts = [];
  Object.keys(patch).forEach(k => {
    if(k === 'updated_at' || k === 'id') return;
    const b = String(backup[k] ?? '').trim(), a = String(patch[k] ?? '').trim();
    if(b === a) return;
    const lbl = FIELD_LABEL[k] || k;
    /* 지울 때 이전 값을 함께 남긴다. 전에는 "세금계산서 발송 지움"이라고만 적혀서,
       잘못 지웠을 때 무엇이 있었는지 알 방법이 없었다 — 그렇게 한 건을 잃었다. */
    parts.push(b && a ? `${lbl} ${shortVal(b)} → ${shortVal(a)}`
      : a ? `${lbl} ${shortVal(a)}` : `${lbl} ${shortVal(b)} 지움`);
  });
  if(!parts.length) return;
  trackAction('edit', '전시 정보 수정', x.company_name || '',
    `<b>${escapeHtml(x.company_name || '')}</b> ${escapeHtml(parts.join(' / '))}`);
}

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
  logExhEdit(x, patch, backup);   // 어떤 계정이 무엇을 바꿨는지 항상 남긴다
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
window.toggleEquipRow = toggleEquipRow;
window.advanceStage = advanceStage;
window.cycleBookLogo = cycleBookLogo;
window.fillBookOrder = fillBookOrder;
window.openBookIntro = openBookIntro;
window.saveBookIntro = saveBookIntro;
window.updateIntroCount = updateIntroCount;
window.closeBookIntro = closeBookIntro;
window.rewindStage = rewindStage;
window.openNewCatalogItem = openNewCatalogItem;
// 뒤로가기로 닫을 수 있게 닫기 함수도 이름으로 내어 둔다(overlay-nav.js 참고)
window.closeNewCatalogItem = () => document.getElementById('new-eq-modal')?.remove();
window.closeNewGraphicOrder = () => document.getElementById('new-gr-modal')?.remove();
window.submitNewCatalogItem = submitNewCatalogItem;
window.openNewGraphicOrder = openNewGraphicOrder;
window.submitNewGraphicOrder = submitNewGraphicOrder;
window.renderExh = renderExh;
window.openExhImport = openExhImport;
window.closeExhImport = closeExhImport;
window.renderExhImportList = renderExhImportList;
window.confirmExhImport = confirmExhImport;
window.toggleExhDate = toggleExhDate;
window.setExhField = setExhField;
window.toggleExhFlag = toggleExhFlag;
window.setExhDateWithFlag = setExhDateWithFlag;
