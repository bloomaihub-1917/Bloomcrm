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
  EXHIBITORS, EXH_ITEMS, EXH_INVOICES, EXH_TAX, EXH_PAYMENTS, EXH_LOGS, EXH_CFG,
  exhEvent, setExhEvent,
  exhibitorsForEvent, getExhibitorById, itemsFor, invoicesFor, taxInvoicesFor, paymentsFor,
  logsFor, openInquiriesFor, contactsFor, primaryContactFor,
  EVENT_LIST, contacts, participations, CO_DB, currentUser, API_BASE_URL, auditLog,
  catalogItem, catalogFor, findCatalogByName, EQUIP_CATALOG, getOrgById, liveItemsFor,
  appsFor, openAppFor, nextItemSort,
  codeList, codeLabel, codeCls,
  evPartOn, evPartDone, evPartState,
  findOrgByName, orgName,
} from '../state.js';
import { td, escapeHtml, escAttr, isMobile, cleanEmail, countryName } from '../utils.js';
export { cleanEmail };   // exh-drawer가 여기서 가져다 쓴다
import {
  postToSheet as _postToSheet,
  saveExhibitor as _saveExhibitor, saveExhItem as _saveExhItem, saveExhInvoice as _saveExhInvoice, saveExhPayment as _saveExhPayment, saveExhLog as _saveExhLog,
  deleteExhItem as _deleteExhItem, deleteExhInvoice as _deleteExhInvoice, deleteExhPayment as _deleteExhPayment, deleteExhLog as _deleteExhLog,
  batchCreateExhibitors as _batchCreateExhibitors, saveExhCfgToSheet as _saveExhCfgToSheet,
} from '../api.js';

/* 진행 완료된 행사에서는 저장을 아예 보내지 않는다. 감싸는 자리를 하나로
   둬야 새 저장 지점이 생겨도 가드에서 빠지지 않는다. */
const postToSheet = guardWrite(_postToSheet);
const saveExhibitor = guardWrite(_saveExhibitor);
const saveExhItem = guardWrite(_saveExhItem);
const saveExhInvoice = guardWrite(_saveExhInvoice);
const saveExhPayment = guardWrite(_saveExhPayment);
const saveExhLog = guardWrite(_saveExhLog);
const deleteExhItem = guardWrite(_deleteExhItem);
const deleteExhInvoice = guardWrite(_deleteExhInvoice);
const deleteExhPayment = guardWrite(_deleteExhPayment);
const deleteExhLog = guardWrite(_deleteExhLog);
const batchCreateExhibitors = guardWrite(_batchCreateExhibitors);
const saveExhCfgToSheet = guardWrite(_saveExhCfgToSheet);
import { trackAction } from './audit-tab.js';
import { normalizeCompanyKey, createOrg, reloadOrgs } from './company-tab.js';

/* 전시 참가기업으로 취급할 참가 역할 — 데이터에 표기 흔들림이 있어 함께 본다 */
export const EXH_ROLES = ['전시참가기업', '전시기업', '전시참가'];

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
/* 등급 색상도 행사마다 다를 수 있어 설정에서 읽는다(code_lists.grade).
   목록에 없는 등급은 회색으로 떨어진다. */
const gradeCls = (g, evKey) => codeCls('grade', evKey || exhEvent, g);

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
    /* 아직 반영하지 않은 접수가 있으면 경고다 — 받아만 두고 품목에 옮기지
       않으면 발주가 옛 내용으로 나간다. 정보 누락도 같은 자리에서 본다. */
    warn: (x) => ((x.app_received_at || x.app_received === 'yes') && x.app_complete === 'no')
      || !!openAppFor(x.id) },
  { key: 'booth_confirmed_at',   label: '부스', flag: 'booth_confirmed' },
  /* 독립부스만 해당한다 — 조립부스는 우리가 짓는 것이라 받을 도면이 없어
     'na'(·)로 비운다. 51곳 중 18곳이라 열 하나를 더 세울 값어치가 있다. */
  { key: 'calc:design',          label: '부스<br>도면' },
  { key: 'calc:invoice',         label: '인보이스' },
  { key: 'calc:tax',             label: '세금<br>계산서' },
  { key: 'calc:payment',         label: '입금' },
  { key: 'calc:graphic',         label: '그래픽' },
  /* 기본부스·블록부스만 해당한다 — 독립부스는 업체가 직접 지어 우리가 만들 게 없다 */
  { key: 'calc:base',            label: '기본<br>시공' },
  { key: 'directory_received_at',label: '도록', flag: 'directory_received' },
  { key: 'movein_at',            label: '현장' },
];

let exhFilter = 'all';       // all | incomplete | unpaid | inquiry | billing | cancelled

/* 단계별 집계 알약을 누르면 그 단계만 걸러 본다. "신청서 47/51"에서 못 채운
   네 곳이 어디인지 보려면 지금은 51줄을 눈으로 훑어야 한다.

   한 번 더 누르면 완료 → 미완료 → 전체로 돌아간다. 두 방향을 다 보고 싶은데
   알약을 셋으로 늘리면 열한 단계가 서른셋이 되어 알약 줄이 화면을 덮는다.

   해당 없는 곳(부스 도면이 없는 조립부스 같은)은 어느 쪽에도 넣지 않는다 —
   집계의 분모에서도 빠져 있어서, 여기서만 끼면 개수가 안 맞는다. */
let stepFil = null;          // { key, mode: 'done' | 'todo' }

export function setStepFil(key){
  stepFil = !stepFil || stepFil.key !== key ? { key, mode: 'done' }
    : stepFil.mode === 'done' ? { key, mode: 'todo' } : null;
  renderExh();
}
let exhView = 'dash';        // dash | list | booth | equip | graphic

/* 그래픽 현황 안의 보기와 거르개. 그래픽은 기업 한 줄로 볼 일(단계 진행)과
   파일 한 줄로 볼 일(무엇이 안 왔나)이 갈린다 — 화면 하나에 둘 다 넣으면
   어느 쪽도 제대로 안 보여서 나눠 두고 전환한다. */
let gView = 'item';          // item(받을 파일) | kind(품목별) | co(기업별 진행) | self(독립부스)
let gFil  = 'all';           // all | todo | late | none | got

export function setGraphicView(v){ gView = v; renderExh(); }
export function setGraphicFil(v){ gFil = gFil === v && v !== 'all' ? 'all' : v; renderExh(); }

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

/* 이 기업의 청구 통화. 금액 항목을 우선으로 보고, 항목이 아직 없으면 인보이스를 본다 —
   청구액(billedAmount)과 같은 순서라 통화와 합계가 서로 다른 곳을 가리키지 않는다.
   서로 다른 통화가 섞이면 합계를 낼 수 없으므로 하나를 고르고 경고를 띄운다. */
export function currencyOf(exhId){
  const src = liveItemsFor(exhId);
  const hit = (src.length ? src : liveInvoices(exhId)).find(r => r.currency);
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

/* 청구액: 금액 항목 합계.

   인보이스 합계를 쓰지 않는다. 인보이스는 발행한 시점에 멈춰 있는 문서고, 신청은
   그 뒤로도 계속 바뀐다 — 취소한 품목은 지워지고 추가 결제는 엑스렌탈 카드로 먼저
   빠져나간다. 인보이스를 기준으로 삼으면 뒤늦은 변경이 반영되지 않아 받을 돈과
   화면의 숫자가 갈린 채로 행사가 끝난다.

   실제로 그렇게 됐다: 포트리아는 인보이스 3장 합계가 4,368인데 그 뒤 엑스렌탈로
   385·55가 더 결제되고 528·66이 환불돼, 실제 받을 돈은 금액 항목 합계인 4,214였다.
   인보이스 줄이 없는 결제가 있으니 인보이스 합계는 어느 쪽으로도 맞지 않는다.

   금액 항목은 변경이 있을 때마다 갱신되니 언제 봐도 지금 사실이다. 인보이스 합계가
   여기서 어긋나면 재발행이 필요하다는 뜻이므로 invoiceGap()으로 따로 알린다. */
/* 추가 배지처럼 우리가 청구하지 않는 항목은 합계에서 뺀다. 신청 내역에는 남는다 —
   몇 장을 신청했는지는 현장에서 필요한 정보라 지울 수 없다. */
export const isBillable = (i) => i.billable !== 'no';
export function billableItems(exhId){ return liveItemsFor(exhId).filter(isBillable); }

/* ── 인보이스 발행 뒤에 온 변경 ──
   신청이 바뀌면 청구액도 바뀌는데, 인보이스는 이미 나가 있다. 이걸 놓치면
   받을 돈과 청구한 돈이 갈린 채로 행사가 끝난다. 마지막 유효 인보이스보다
   늦게 반영된 접수가 있으면 알린다. */
export function needsReissue(exhId){
  const inv = liveInvoices(exhId).map(i => i.sent_at || i.created_at || '').filter(Boolean).sort();
  if(!inv.length) return null;
  const last = inv[inv.length - 1];
  const after = appsFor(exhId).filter(a => a.kind !== '최초'
    && String(a.received_at || '') > last);
  return after.length ? { last, apps: after } : null;
}

export function billedAmount(exhId){
  const cur = currencyOf(exhId);
  const items = billableItems(exhId);
  /* 금액 항목이 아직 하나도 없는 초기 상태에서는 발행한 인보이스를 예상액으로 쓴다 —
     안 그러면 청구액 0으로 보여 '금액 항목을 추가해주세요'만 뜬다. */
  return items.length ? sumIn(items, cur) : sumIn(liveInvoices(exhId), cur);
}

/* 인보이스 합계와 금액 항목 합계의 격차 — 있으면 재발행이나 누락된 인보이스가 있다.
   청구액 판정에는 쓰지 않고 화면에 알리기만 한다. */
export function invoiceGap(exhId){
  const inv = liveInvoices(exhId);
  const items = billableItems(exhId);
  if(!inv.length || !items.length) return null;
  const cur = currencyOf(exhId);
  const invoiced = sumIn(inv, cur), billed = sumIn(items, cur);
  return invoiced === billed ? null : { invoiced, billed, diff: billed - invoiced, cur };
}
/* ── 분류별 청구액 (부스 / 비품 / 그래픽 / 기타) ──

   총액만 보면 "이번 행사 그래픽이 얼마나 나갔나"를 알 수 없다. 발주도 정산 근거도
   분류 단위로 움직인다 — 부스는 시공사, 비품은 렌탈사, 그래픽은 출력소로 간다.

   인보이스가 아니라 금액 항목을 센다. 인보이스는 여러 분류를 한 장에 합쳐 발행해
   분류별로 가를 수가 없다. billedAmount도 같은 금액 항목을 세니 분류 합계를 다 더하면
   청구 총액과 맞는다.

   통화를 섞지 않는다. 기업마다 원화·달러가 갈려서 더하면 뜻 없는 숫자가 된다.
   { KRW: {booth: n, equip: n, ...}, USD: {...} } 꼴로 돌려준다. */
export function billedByCategory(list){
  const out = {};
  (list || []).forEach(x => {
    billableItems(x.id).forEach(i => {
      const cur = i.currency || 'KRW';
      const cat = ['booth', 'equip', 'graphic'].includes(i.category) ? i.category : 'etc';
      if(!out[cur]) out[cur] = { booth: 0, equip: 0, graphic: 0, etc: 0, 합계: 0 };
      const v = num(i.amount);
      out[cur][cat] += v;
      out[cur].합계 += v;
    });
  });
  return out;
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

/* 순입금 한 숫자만 보면 4,214가 처음부터 4,214 들어온 것처럼 보인다. 실제로는
   4,808이 들어오고 594가 환불된 결과다 — 대사할 때는 갈라진 숫자가 필요하다. */
export function paidBreakdown(exhId){
  const cur = currencyOf(exhId);
  const rows = paymentsFor(exhId).filter(p => (p.currency || 'KRW') === cur);
  const gross = rows.filter(p => p.kind !== 'refund').reduce((s, p) => s + num(p.amount), 0);
  const refunded = rows.filter(isDoneRefund).reduce((s, p) => s + num(p.amount), 0);
  const requested = rows.filter(isPendingRefund).reduce((s, p) => s + num(p.amount), 0);
  return { gross, refunded, requested, net: gross - refunded, cur };
}

/* 아직 안 보낸 환불 — 처리 필요 목록에 올리기 위해 따로 센다 */
export function pendingRefunds(exhId){
  return paymentsFor(exhId).filter(isPendingRefund);
}

/* ── 통화별 청구·입금 ──

   settleState는 통화를 하나만 골라 그 통화 건만 더한다. 합계를 하나로 내야 하는
   자리(정산 상태·미수금 판정)에서는 그게 맞지만, 표에 적을 때는 나머지 통화가
   통째로 사라진다.

   인보이스는 원화로 받고 엑스렌탈은 해외 카드로 결제하는 경우가 있어 한 기업에
   원화와 달러가 함께 남는다. 그럴 때 둘 다 보여야 한다.

   청구액은 금액 항목을 쓴다 — settleState와 같은 기준이라 두 숫자가 어긋나지 않는다. */
/* 결제 수단을 두 갈래로 묶는다. 통장에 찍히는 돈(계좌이체·외화송금)과 카드로
   나간 돈(카드·엑스렌탈 카드)은 대사하는 곳이 달라서, 한 숫자로 합쳐 두면
   통장과 맞출 때 매번 다시 갈라야 한다. 수단이 안 적힌 옛 건은 따로 둔다 —
   둘 중 하나로 밀어 넣으면 어느 쪽 합계가 틀렸는지 알 수 없다. */
export function payGroup(method){
  const t = String(method || '').trim();
  if(!t) return 'etc';
  return t.includes('카드') ? 'card' : 'bank';
}

export function settleByCurrency(exhId){
  const items = billableItems(exhId);
  const src = items.length ? items : liveInvoices(exhId);   // billedAmount와 같은 기준
  const pays = paymentsFor(exhId).filter(hasAmount)
    .filter(p => p.kind !== 'refund' || isDoneRefund(p));

  const out = {};
  const put = (cur, key, v) => {
    if(!out[cur]) out[cur] = { billed: 0, paid: 0, bank: 0, card: 0, etc: 0, balance: 0 };
    out[cur][key] += v;
  };
  src.forEach(r => put(r.currency || 'KRW', 'billed', num(r.amount)));
  pays.forEach(p => {
    const cur = p.currency || 'KRW';
    const v = p.kind === 'refund' ? -num(p.amount) : num(p.amount);
    put(cur, 'paid', v);
    put(cur, payGroup(p.method), v);   // 계좌이체와 카드 결제를 갈라서도 담아 둔다
  });
  Object.keys(out).forEach(c => { out[c].balance = out[c].billed - out[c].paid; });
  return out;
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
/* exhibitor_tax_invoices의 한 줄(v)을 대상으로 한다 — 세금계산서가 1:N으로
   바뀌면서 exhibitors.tax_stage 같은 단일 칼럼이 아니라 그 줄의 requested_at/
   to_finance_at/sent_at을 가리킨다(exh-drawer.js의 taxStageBar 참고). */
export const TAX_STAGES = [
  { key: '',           label: '요청 전',     who: '',      at: null,             next: 'requested',  action: '기업이 요청함' },
  { key: 'requested',  label: '기업 요청',   who: 'us',    at: 'requested_at',   next: 'to_finance', action: '재무팀에 요청' },
  { key: 'to_finance', label: '재무팀 요청', who: 'team',  at: 'to_finance_at',  next: 'done',       action: '발행 완료' },
  { key: 'done',       label: '발행 완료',   who: '',      at: 'sent_at',        next: null,         action: '' },
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

/* ══════════════════════════════════════════
   행사별 설정 — settings 시트에 exh_cfg_<행사키> 한 줄(JSON)로 담는다

     { due: { manual_replied_at: '2026-01-15', ... },   // 단계별 마감일
       book: { chars: 1300, words: 200 } }              // 프로그램북 글자수 한도

   행사가 바뀌면 마감일도 도록 판형도 같이 바뀐다. 설정을 단계마다 따로 저장하면
   행사 하나 추가할 때 settings에 열 몇 개가 생기므로, 행사당 한 줄로 묶는다.
══════════════════════════════════════════ */
export function exhCfg(evKey){ return EXH_CFG[evKey || exhEvent] || {}; }
export function setExhCfg(evKey, cfg){ EXH_CFG[evKey] = cfg || {}; }

/* ── 프로그램북 글자수 한도 ──
   지면 기준이 행사마다 다르다(2026 KIC은 1,354자·189단어라 여유를 둬 1,300/200).
   설정이 없으면 이 기본값을 쓴다. */
export const BOOK_LIMIT_DEFAULT = { chars: 1300, words: 200 };
export function bookLimit(evKey){
  const b = exhCfg(evKey).book || {};
  return {
    chars: Number(b.chars) > 0 ? Number(b.chars) : BOOK_LIMIT_DEFAULT.chars,
    words: Number(b.words) > 0 ? Number(b.words) : BOOK_LIMIT_DEFAULT.words,
  };
}

/* ── 단계별 마감일 ──
   마감을 걸 만한 단계만 고른다. "매뉴얼 발송"처럼 우리가 언제든 할 수 있는 일이
   아니라, 기업에서 받아내야 해서 늦으면 행사 준비가 밀리는 것들이다.
   키는 STEPS의 키와 같아야 체크리스트 칸에 그대로 붙는다. */
export const DUE_STEPS = [
  ['manual_replied_at',     '매뉴얼 회신'],
  ['app_received_at',       '신청서 접수'],
  ['booth_confirmed_at',    '부스 확정'],
  ['calc:design',           '부스 도면 (독립부스)'],
  ['calc:payment',          '입금'],
  ['calc:graphic',          '그래픽 확정'],
  ['calc:base',             '기본 시공 (간판명·디자인)'],
  ['directory_received_at', '도록 정보'],
  ['movein_at',             '반입·설치'],
];

/* ══════════════════════════════════════════
   진행 완료 잠금

   끝난 행사는 열어 볼 수는 있어야 하고, 고쳐지면 안 된다. 화면에서 입력칸을
   비활성하는 것만으로는 부족하다 — 남은 인라인 핸들러나 콘솔로 값이 들어가면
   끝난 행사의 기록이 조용히 바뀐다. 실제로 데이터를 지키는 건 저장 가드다.

   가드는 exh-drawer도 함께 쓴다(같은 행사를 다루므로 판단 기준이 하나여야 한다).
══════════════════════════════════════════ */
export const exhLocked = () => !!exhEvent && evPartDone(exhEvent, 'exh');

let _lockToastAt = 0;
/* 막혔다는 걸 알린다. 연달아 누르면 알림이 쌓이므로 잠깐 사이엔 한 번만. */
export function exhLockNotice(){
  const now = Date.now();
  if(now - _lockToastAt < 1500) return;
  _lockToastAt = now;
  alert('진행 완료된 행사예요 — 열람만 됩니다.\n고치려면 설정 › 행사 관리 › 진행 파트에서 "진행 중"으로 되돌리세요.');
}

/* 저장 함수를 감싸 잠긴 행사면 아예 보내지 않는다. api.js 쓰기 함수를 이
   모듈과 드로어가 나눠 쓰므로, 감싸는 자리를 하나로 둬야 빠지는 길이 없다. */
export function guardWrite(fn){
  return async (...args) => {
    if(exhLocked()){ exhLockNotice(); return { ok: false, locked: true }; }
    return fn(...args);
  };
}

/* 마감을 놓친 줄을 눌렀을 때 열 드로어 탭 — 바로 처리할 수 있는 자리로 보낸다 */
const DUE_TAB = {
  'manual_replied_at': 'progress', 'app_received_at': 'apply',
  'booth_confirmed_at': 'progress', 'calc:design': 'progress', 'calc:payment': 'billing',
  'calc:graphic': 'graphic', 'calc:base': 'progress',
  'directory_received_at': 'book', 'movein_at': 'progress',
};

export const eventDeadlines = (evKey) => exhCfg(evKey).due || {};

/* 오늘 기준 남은 날 — 마감이 없으면 null.
   days > 0 남음, 0 오늘, 음수면 지났다. */
export function dueInfo(stepKey, evKey){
  const date = String(eventDeadlines(evKey)[stepKey] || '').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(date + 'T00:00:00');
  return { date, days: Math.round((d - today) / 86400000) };
}

/* 그래픽 진행 상태 — 주문 안 했으면 해당 없음, 출력/제작에 따라 완료 기준이 다르다 */
/* ── 독립부스 도면이 어디까지 왔나 ──
   자체 시공은 부스를 업체가 직접 짓지만 무엇을 지을지는 우리가 본다(높이 제한,
   통로 침범, 인접 부스 가림). 부스 현황·드로어가 같은 정의를 쓰게 한곳에 둔다. */
export function boothDesignState(x){
  if(!x.booth_design_received_at) return { state: 'none', text: '미수령' };
  if(!x.booth_design_checked_at)  return { state: 'todo', text: '확인 대기' };
  if(x.booth_design_result === 'fix') return { state: 'warn', text: '수정 요청' };
  if(x.booth_design_result === 'ok')  return { state: 'done', text: '적합' };
  return { state: 'todo', text: '결과 미기재' };
}

/* ══════════════════════════════════════════
   기본 제공 시공 — 추가 발주와 다른 것

   추가 발주는 기업이 신청하고 돈을 더 내는 것이라 안 하면 그만이다. 여기 것은
   계약에 이미 들어 있어서, 기업이 아무 말을 안 해도 우리가 만들어 세워야 한다.
   빠뜨리면 개막날 부스에 상호가 없다.

   무엇을 해야 하는지는 부스 타입이 정한다 — 따로 적게 하면 타입을 고칠 때마다
   두 군데를 맞춰야 하고, 어긋난 쪽이 조용히 틀린 값이 된다.

     기본부스(Octanium)  간판명을 받아 → 우리가 간판을 만든다
     블록·라이팅 부스     디자인을 받아 → 우리가 출력·시공한다
     독립부스            해당 없음 (업체가 직접 짓는다)
══════════════════════════════════════════ */
export const BASE_KINDS = {
  fascia: { label: '간판명', recv: '간판명 확정', done: '간판 제작', types: ['Octanium (Standard)', 'Octanium (Black)'] },
  print:  { label: '출력·시공', recv: '디자인 수령', done: '출력 완료',
            types: ['Block System A', 'Block System B', 'Block System C', 'Lighting Booth'] },
};

export function baseKind(x){
  if(isBookOnly(x)) return '';
  const t = String(x.booth_type || '').trim();
  if(!t) return '';
  return Object.keys(BASE_KINDS).find(k => BASE_KINDS[k].types.includes(t)) || '';
}

/* 어디까지 왔나. 받는 것과 만드는 것이 따로라 두 단계로 본다 —
   "디자인은 왔는데 아직 안 뽑았다"가 제일 흔한 상태이고, 그걸 완료로 묶으면
   출력소에 넘길 목록을 다시 손으로 세게 된다. */
export function baseState(x){
  const k = baseKind(x);
  if(!k) return { state: 'na' };
  /* 간판명은 도록 이름에서 자동으로 채워지니 «적혀 있다»가 «받았다»는 뜻이
     못 된다. 사람이 확정한 날(base_recv_at)로만 판단한다. */
  // 간판은 영문명이 있어야 만든다. 확정 도장을 찍었어도 이름이 없으면 못 만든다.
  if(k === 'fascia' && !fasciaName(x)) return { state: 'warn', text: '영문명 없음' };
  const got = x.base_recv_at;
  if(!got)            return { state: 'todo', text: '미수령' };
  if(!x.base_done_at) return { state: 'part', text: '수령 · 작업 전' };
  return { state: 'done', text: BASE_KINDS[k].done };
}

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
/* 아직 못 끝낸 단계에 마감일이 걸려 있으면 그 사실을 칸에 얹는다.
   지난 건 눈에 띄게 경고로 올리고, 임박한 건 색을 바꾸지 않고 남은 날만 붙인다 —
   아직 늦지 않은 걸 빨갛게 칠하면 진짜 늦은 것과 구분이 안 된다. */
const DUE_SOON_DAYS = 7;
function withDue(c, x, step){
  if(c.state === 'done' || c.state === 'na') return c;
  const d = dueInfo(step.key, x.event_id);
  if(!d) return c;
  if(d.days < 0) return { ...c, state: 'warn', due: d, text: c.text || `${-d.days}일 지남` };
  if(d.days <= DUE_SOON_DAYS) return { ...c, due: d, text: c.text || (d.days === 0 ? '오늘 마감' : `D-${d.days}`) };
  return { ...c, due: d };
}

function cellState(x, step){ return withDue(rawCellState(x, step), x, step); }

function rawCellState(x, step){
  // 프로그램북만 참가하는 곳은 도록 외에는 받을 것이 없다
  if(isBookOnly(x) && step.key !== 'directory_received_at') return { state: 'na' };
  if(step.key === 'calc:invoice'){
    const inv = invoicesFor(x.id).filter(i => i.status !== 'void');
    if(!inv.length) return { state: 'todo' };
    const sent = inv.filter(i => i.sent_at);
    if(!sent.length) return { state: 'warn', text: '미발송' };
    // 금액이 안 적힌 인보이스가 있으면 청구액이 실제보다 적게 잡힌다 — 눈에 띄게 한다
    if(inv.some(i => String(i.amount ?? '').trim() === '')) return { state: 'warn', text: '금액 미입력' };
    return { state: 'done', text: sent.length > 1 ? `${sent.length}건` : sent[0].sent_at };
  }
  if(step.key === 'calc:tax'){
    // 발행 완료의 기준은 (예전부터 그랬듯) 발행일이 적혀 있느냐다 — 단계값(stage)은
    // 재촉 대상을 가리는 용도일 뿐이라, 단계를 안 넘기고 날짜만 적어도 완료로 본다.
    // 여기서 stage만 보게 바꿨다가 날짜는 있는데 단계가 안 넘어간 건들이 전부
    // "완료"에서 빠지는 회귀가 있었다.
    const tx = taxInvoicesFor(x.id).filter(t => t.status !== 'void');
    if(!tx.length) return { state: 'todo' };
    const sent = tx.filter(t => t.sent_at);
    if(!sent.length) return { state: 'warn', text: stageOf(TAX_STAGES, tx[0].stage).label };
    if(tx.some(t => String(t.amount ?? '').trim() === '')) return { state: 'warn', text: '금액 미입력' };
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
  if(step.key === 'calc:base') return baseState(x);
  if(step.key === 'calc:design'){
    if((x.booth_type || '') !== SELF_BUILD_TYPE) return { state: 'na' };
    const d = boothDesignState(x);
    return d.state === 'none' ? { state: 'todo' } : d;
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

  /* 지금 챙길 것만 위에 둔다. 끝난 행사도 열어 봐야 할 때가 있으니 지우지 않고
     아래로 내린다 — 목록이 길어지면 정작 오늘 볼 행사를 눈으로 찾아야 한다.

     EVENT_LIST에 없는 느슨한 행사(참여 기록에만 있는 것)는 설정이 없어
     기본값인 진행 중으로 잡힌다. */
  const hasWork = (k) => exhibitorsForEvent(k).length || exhibitorCandidates(k).length;
  const stateOf = (e) => evPartState(e.key, 'exh');

  const doing = opts.filter(e => stateOf(e) === 'doing' && hasWork(e.key));
  const done  = opts.filter(e => stateOf(e) === 'done');
  const off   = opts.filter(e => stateOf(e) === 'none');
  const empty = opts.filter(e => stateOf(e) === 'doing' && !hasWork(e.key));

  // 처음 열 때는 진행 중인 행사를 고른다 — 끝난 행사가 먼저 열리면 손댈 수 없는
  // 화면부터 보게 된다
  if(!exhEvent || !opts.some(e => e.key === exhEvent)){
    const first = doing[0] || done[0] || empty[0] || off[0];
    if(first) setExhEvent(first.key);
  }

  const row = (e, n) => `<button class="nr${exhEvent === e.key ? ' on' : ''}" onclick="setExhEvent2('${escAttr(e.key)}')">
      <span class="ev-pill-dot" style="background:${escAttr(e.color || '#9C9890')}"></span>${escapeHtml(e.short || e.name || e.key)}
      ${n ? `<span class="nbg">${n}</span>` : ''}</button>`;

  const head = (t) => `<div style="font-size:10px;color:var(--i4);margin:10px 0 4px;padding-left:2px">${t}</div>`;
  const group = (arr, title, withCount) => arr.length
    ? (title ? head(title) : '') + arr.map(e => row(e, withCount ? activeExhibitors(e.key).length : 0)).join('')
    : '';

  el.innerHTML = (
      group(doing, '', true)
    + group(done,  '진행 완료', true)
    + group(off,   '전시 안 함', false)
    + group(empty, '전시 대상 없음', false)
  ) || '<div style="font-size:11px;color:var(--i4);padding:6px 2px">등록된 행사가 없어요</div>';

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
    const attention = list.filter(x => settleState(x).state === 'over' ||
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

export function setExhView(v){
  // 부스 타입으로 걸러 둔 채 다른 보기로 갔다가 돌아오면, 왜 목록이 짧은지
  // 알 수 없다. 보기를 옮기거나 행사를 바꾸면 푼다.
  if(v !== 'booth') boothTypeFil = '';
  if(v !== 'list') stepFil = null;
  exhView = v; renderExh();
}
export function setExhEvent2(key){
  boothTypeFil = '';
  setExhEvent(key);
  buildExhEvList();
  renderExh();
  /* 인보이스 저장 폴더는 행사마다 다르다 — 어느 폴더에 저장되는지 화면에 적으려면
     행사를 바꿀 때 다시 읽어야 한다(exh-invoice.js가 소유, window 경유). */
  window.initInvoiceFolder?.(key);
}
export function setExhFilter(k){ exhFilter = k; stepFil = null; buildExhFilters(); renderExh(); }

/* ══════════════════════════════════════════
   메인 — 미답변 문의 패널 + 기업리스트 표
══════════════════════════════════════════ */
/* ── 참가기업 이름 검색 ──
   전에는 company_name(국문) 하나만 봤다. 국문명이 아예 없고 영문만 있는 기업이
   있어서(화면에는 영문이 뜬다) 보이는 이름 그대로 쳐도 안 걸렸다.

   기업DB 검색과 같은 규칙을 쓴다 — 친 그대로 먼저 견주고(부분어·띄어쓰기 포함
   검색을 살린다), 안 걸리면 양쪽에서 법인격 표기와 기호·공백을 눌러 없앤 뒤
   다시 견준다. 옛 사명(별칭)으로도 찾을 수 있어야 한다. */
function matchExhName(x, q){
  const lq = String(q || '').trim().toLowerCase();
  if(!lq) return true;
  const squash = (v) => String(v || '').toLowerCase()
    .replace(/\(주\)|\(유\)|주식회사|㈜|유한회사|inc\.?|corp\.?|co\.?|ltd\.?|llc\.?/g, '')
    .replace(/[^a-z0-9가-힣]/g, '');
  const sq = squash(lq);

  const o = x.org_id ? getOrgById(x.org_id) : null;
  const fields = [x.company_name, o?.name_ko, o?.name_en, o?.abbr,
    ...String(o?.aliases || '').split('\n')].filter(Boolean);

  return fields.some(v => String(v).toLowerCase().includes(lq))
    || (!!sq && fields.some(v => squash(v).includes(sq)));
}

/* 모바일 검색칸 — 데스크톱 칸과 값을 맞춰 두고 다시 그린다. 둘이 서로 다른
   값을 들고 있으면 어느 쪽이 지금 걸린 조건인지 알 수 없다. */
export function searchExhM(v){
  const d = document.getElementById('exh-q');
  if(d) d.value = v;
  renderExh();
}

function visibleList(){
  // 데스크톱 칸이 숨어 있는 모바일에서는 모바일 칸을 본다
  const q = ((document.getElementById('exh-q')?.value
    || document.getElementById('exh-q-m')?.value || '')).trim().toLowerCase();
  let list = exhFilter === 'cancelled' ? cancelledExhibitors(exhEvent) : activeExhibitors(exhEvent);
  if(exhFilter === 'incomplete') list = list.filter(x => progressOf(x) < 100);
  if(exhFilter === 'unpaid')     list = list.filter(x => ['unpaid','partial'].includes(settleState(x).state));
  if(exhFilter === 'billing')    list = list.filter(x => { const s = settleState(x);
    return s.state === 'over' ||
      invoicesFor(x.id).some(i => i.status !== 'void' && String(i.amount ?? '').trim() === ''); });
  if(exhFilter === 'inquiry')    list = list.filter(x => openInquiriesFor(x.id).length);
  if(stepFil){
    const step = STEPS.find(s => s.key === stepFil.key);
    if(step) list = list.filter(x => {
      const st = cellState(x, step).state;
      if(st === 'na') return false;                 // 해당 없는 곳은 양쪽 다 아니다
      return stepFil.mode === 'done' ? st === 'done' : st !== 'done';
    });
  }
  if(q) list = list.filter(x => matchExhName(x, q));
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

  // 이 행사가 전시를 안 하기로 돼 있으면 목록을 열지 않는다 — 참가기업이
  // 남아 있어도 지금 다룰 일이 아니고, 여기서 손대면 설정과 화면이 어긋난다
  if(exhEvent && !evPartOn(exhEvent, 'exh')){
    el.innerHTML = `<div class="empty" style="padding:60px 20px;text-align:center">
      <div style="font-size:30px;margin-bottom:10px">🚧</div>
      <div style="font-weight:700;margin-bottom:6px">이 행사는 전시를 진행하지 않아요</div>
      <div style="font-size:12px;color:var(--i4)">설정 › 행사 관리에서 이 행사를 고른 뒤
        <b>진행 파트</b>에서 전시를 켜면 다시 열립니다.</div></div>`;
    return;
  }

  /* 끝난 행사임을 화면 맨 위에 못박아 둔다 — 입력이 안 먹는 이유를 모른 채
     헤매게 두면 안 된다. 참가기업이 하나도 없을 때도 보여야 해서 빈 화면보다
     앞에 둔다. */
  const banner = exhLocked() ? `<div style="display:flex;align-items:center;gap:9px;margin:10px 16px 0;
      background:var(--i8);border:1px solid var(--i6);border-left:3px solid var(--g);border-radius:8px;padding:9px 13px">
    <span class="pill p-green">진행 완료</span>
    <span style="font-size:11.5px;color:var(--i3)">끝난 행사라 열람만 됩니다. 고치려면 설정 › 행사 관리 › 진행 파트에서 <b>진행 중</b>으로 되돌리세요.</span>
  </div>` : '';

  const list = visibleList();
  const all = activeExhibitors(exhEvent);

  if(!all.length){
    el.innerHTML = banner + `<div class="empty" style="padding:60px 20px;text-align:center">
      <div style="font-size:30px;margin-bottom:10px">🏢</div>
      <div style="font-weight:700;margin-bottom:6px">등록된 참가기업이 없어요</div>
      ${exhLocked()
        ? '<div style="font-size:12px;color:var(--i4)">진행 완료된 행사예요 — 참가기업 없이 끝났거나, 기록이 다른 행사에 들어가 있을 수 있어요.</div>'
        : `<div style="font-size:12px;color:var(--i4);margin-bottom:14px">
             기업DB에 "전시참가기업"으로 기록된 기업을 불러오거나 직접 추가할 수 있어요</div>
           <button class="btn" onclick="openExhAdd()">참가기업 추가</button>
           <button class="btn bp" onclick="openExhImport()">참가기업 불러오기</button>`}
    </div>`;
    return;
  }

  /* 보기 전환 — 진행 전체를 보는 두 가지(대시보드·기업리스트) 다음에,
     실무를 품목 단위로 처리하는 세 가지를 둔다. 부스·비품·그래픽은 각각
     담당이 갈리고 마감도 달라서, 기업별 드로어를 51번 열지 않고 한 화면에서
     끝낼 수 있어야 한다. */
  const VIEWS = [['dash','대시보드'], ['list','기업리스트'],
    ['booth','부스 현황'], ['equip','비품 현황'], ['graphic','그래픽 현황'],
    ['base','기본 시공'],
    ['money','금액 현황'], ['book','프로그램북']];
  const seg = `<div class="tbar" style="padding:10px 16px 0">
    <div class="seg" style="flex-wrap:wrap">
      ${VIEWS.map(([k, l]) => `<button class="seg-b${exhView === k ? ' on' : ''}" onclick="setExhView('${k}')">${l}</button>`).join('')}
    </div></div>`;

  const bodyHtml =
      exhView === 'dash'    ? renderDashboard(all)
    : exhView === 'booth'   ? renderBoothView(list)
    : exhView === 'equip'   ? renderEquipView(list)
    : exhView === 'graphic' ? renderGraphicView(list)
    : exhView === 'base'    ? renderBaseView(list)
    : exhView === 'money'   ? renderMoneyView(list)
    : exhView === 'book'    ? renderBookView(list)
    : renderInquiryPanel() + renderChecklist(list, all);
  el.innerHTML = seg + banner
    + (exhLocked() ? `<div class="ro">${bodyHtml}</div>` : bodyHtml);
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

/* ── 지난 행사와 견주기 (신규 · 재참가 · 이탈) ──
   "이 회사가 작년에도 왔나"는 플래그로 적어 두면 왜 그런 판정인지 되짚을 수 없고
   해마다 다시 적어야 한다. 지난 행사의 참가기업을 같은 모양(exhibitors)으로
   넣어 두고 계산한다 — 근거가 데이터에 남고, "작년엔 왔는데 올해 안 온 곳"까지
   덤으로 나온다(내년 영업 타겟이다).

   어느 행사가 "지난 행사"인가는 설정(exh_cfg.prev)으로 정한다. 날짜로 자동
   추정하면 날짜를 안 채운 행사에서 조용히 엉뚱한 곳을 가리킨다. */
export function prevEventKey(evKey){
  const ev = evKey || exhEvent;
  const set = exhCfg(ev).prev;
  if(set) return set;
  /* 설정이 없으면 날짜가 이 행사보다 앞선 행사 중 가장 최근 것.
     날짜가 없는 행사는 견줄 수 없으니 뺀다. */
  const here = EVENT_LIST.find(e => e.key === ev);
  const mine = here && here.date;
  if(!mine) return null;
  return EVENT_LIST
    .filter(e => e.key !== ev && e.date && e.date < mine && exhibitorsForEvent(e.key).length)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.key || null;
}

/* 지난 행사에 참가했던 기업(org_id) 집합. 기업 레코드를 키로 쓴다 —
   이름으로 맞추면 사명이 바뀐 곳이 새 기업으로 보인다(압타머사이언스 →
   츌립앤사이언스). 아직 기업에 연결되지 않은 옛 줄은 이름으로 한 번 더 본다. */
export function prevOrgKeys(evKey){
  const prev = prevEventKey(evKey);
  if(!prev) return null;
  const ids = new Set(), names = new Set();
  exhibitorsForEvent(prev).forEach(x => {
    if(x.org_id) ids.add(x.org_id);
    const n = exhNames(x);
    [n.ko, n.en, x.company_name].forEach(v => { const k = normalizeCompanyKey(v || ''); if(k) names.add(k); });
  });
  return { prev, ids, names };
}

/* 이 기업이 지난 행사에도 왔나. 지난 행사 자료가 없으면 null(모름) — 안 왔다와
   구별해야 한다. 모르는 걸 "신규"로 세면 첫 행사가 전부 신규가 된다. */
export function isReturning(x, keys){
  if(!keys) return null;
  if(x.org_id && keys.ids.has(x.org_id)) return true;
  const n = exhNames(x);
  return [n.ko, n.en, x.company_name]
    .some(v => { const k = normalizeCompanyKey(v || ''); return k && keys.names.has(k); });
}

/* 지난 행사에는 있었는데 이번에 없는 기업 — 이탈. 취소한 곳도 이탈로 본다
   (신청했다가 취소한 것은 따로 표시한다). */
export function droppedFromPrev(evKey){
  const prev = prevEventKey(evKey);
  if(!prev) return [];
  const here = exhibitorsForEvent(evKey || exhEvent);
  const alive = here.filter(x => x.status !== CANCELLED);
  const ids = new Set(alive.map(x => x.org_id).filter(Boolean));
  const names = new Set();
  alive.forEach(x => { const n = exhNames(x);
    [n.ko, n.en, x.company_name].forEach(v => { const k = normalizeCompanyKey(v || ''); if(k) names.add(k); }); });
  const cancelled = new Map();
  here.filter(x => x.status === CANCELLED).forEach(x => {
    if(x.org_id) cancelled.set(x.org_id, x);
  });
  return exhibitorsForEvent(prev).filter(x => {
    if(x.org_id && ids.has(x.org_id)) return false;
    const n = exhNames(x);
    return ![n.ko, n.en, x.company_name]
      .some(v => { const k = normalizeCompanyKey(v || ''); return k && names.has(k); });
  }).map(x => ({ x, cancelled: x.org_id ? cancelled.get(x.org_id) : null }));
}

/* ── 참가기업 구성 요약 ──
   기업리스트는 "이 기업이 어디까지 왔나"를 한 줄씩 보는 화면이라, 51줄을 눈으로
   더하기 전에는 "몇 개국 몇 개사인지", "해외가 몇 부스인지"를 알 수 없었다.
   주최사 보고와 홍보 문구("12개국 51개사 60부스")에 매번 쓰는 숫자인데 그때마다
   엑셀로 옮겨 세고 있었다.

   기업 수와 부스 수를 따로 센다 — 한 기업이 두세 부스를 쓰는 곳이 있어서
   둘이 같지 않다(2026 KIC은 51개사 60부스). 발주·도면·안내는 부스 수로 움직이고
   초청·등록은 기업 수로 움직여서, 둘 중 하나만 있으면 늘 다시 세게 된다. */
const isDomestic = (c) => countryName(c) === '대한민국';
/* countBy와 같은데 1씩이 아니라 weight만큼 더한다(기업 수가 아니라 부스 수) */
const sumBy = (list, key, weight) => {
  const c = {};
  list.forEach(x => { const k = key(x); if(k) c[k] = (c[k] || 0) + weight(x); });
  return c;
};
/* ── 부스 수 ──
   안 적힌 곳은 1부스로 본다(대부분 1부스라 비워 두고 넘어간다).

   공동 부스로 표시된 기업은 0으로 센다. 한 부스를 두 기관이 나눠 쓰면 기업은
   둘이지만 부스는 하나다 — 둘 다 1로 세면 주최사 보고 숫자가 한 칸 늘고
   조립부스 발주도 한 벌 더 잡힌다. 기업 수에서는 빼지 않는다. */
export const isSharedBooth = (x) => x.booth_shared === 'yes';

/* 프로그램북에만 이름을 올리는 참가. 모기업 부스에 얹힌 자회사처럼 주고받을
   게 도록뿐인 곳이다.

   일반 참가와 같은 체크리스트에 세우면 매뉴얼·신청서·인보이스·입금이 영영
   미완료로 남는다. 안 받을 것을 못 받은 것으로 세면 "몇 곳 남았나"가 늘 틀리고,
   틀린 숫자는 며칠 지나면 아무도 안 본다. 그래서 도록 말고는 해당 없음으로
   비운다 — 지우는 게 아니라 분모에서 빼는 것이라, 유형을 되돌리면 그대로 살아난다.

   부스도 세지 않는다. 부스는 모기업 것 하나뿐이다. */
export const isBookOnly = (x) => x.scope === 'book';

const boothQty = (x) => (isSharedBooth(x) || isBookOnly(x) ? 0 : Math.max(1, num(x.booth_qty) || 1));

/* 누구의 부스에 얹혔는지까지 알려 준다 — "프로그램북만"이라는 말만으로는
   왜 이 회사가 부스도 없이 목록에 있는지 설명이 안 된다. */
function bookOnlyTip(x){
  const host = String(x.host_key || '').trim()
    ? exhibitorsForEvent(x.event_id).find(o => o.company_key === x.host_key) : null;
  return host
    ? `프로그램북에만 오르는 참가예요 — ${exhNames(host).ko}의 부스를 함께 씁니다. 부스 수와 체크리스트에서는 빠집니다.`
    : '프로그램북에만 오르는 참가예요 — 부스 수와 체크리스트에서 빠집니다.';
}

function exhSummary(all){
  const of = (x) => {
    const o = x.org_id ? getOrgById(x.org_id) : null;
    return (o && o.country) || '';
  };
  const g = { home: [], away: [], unknown: [] };
  all.forEach(x => {
    const c = of(x);
    (!c ? g.unknown : isDomestic(c) ? g.home : g.away).push(x);
  });
  const boothsOf = (arr) => arr.reduce((a, x) => a + boothQty(x), 0);
  const countries = new Set(all.map(of).filter(Boolean).map(countryName));

  return {
    all, countries,
    co:    { home: g.home.length, away: g.away.length, unknown: g.unknown.length },
    booth: { home: boothsOf(g.home), away: boothsOf(g.away), unknown: boothsOf(g.unknown),
             total: boothsOf(all) },
    /* 층과 부스 타입은 부스 수로 센다 — 도면·안내·조립부스 발주가 전부 부스
       단위로 움직인다. 한 기업이 두 부스를 쓰면 조립도 두 벌이다.
       등급은 스폰서 계약이라 기업 수로 센다. */
    floor: sumBy(all, x => (x.booth_floor ? x.booth_floor + '층' : ''), boothQty),
    type:  sumBy(all, x => x.booth_type || '', boothQty),
    grade: countBy(all.filter(x => x.grade && x.grade !== 'Exhibitor'), x => x.grade),
    noBooth: all.filter(x => !isBookOnly(x) && !String(x.booth_no || '').trim()).length,
    shared: all.filter(isSharedBooth).length,
    bookOnly: all.filter(isBookOnly).length,
    prev: (() => {
      const keys = prevOrgKeys();
      if(!keys) return null;
      const back = all.filter(x => isReturning(x, keys));
      return { key: keys.prev, back: back.length, fresh: all.length - back.length,
               dropped: droppedFromPrev().length };
    })(),
  };
}

/* 요약 카드. 숫자 하나를 크게 놓고 그 아래에 무엇을 나눈 값인지 적는다 —
   "23"만 있으면 기업 수인지 부스 수인지 알 수 없다. */
function renderExhSummary(all){
  if(!all.length) return '';
  const s = exhSummary(all);
  const n = (v) => `<b style="font-size:17px;font-weight:800">${v}</b>`;
  const sub = (t) => `<div style="font-size:10.5px;color:var(--i4);margin-top:2px">${t}</div>`;

  let nth = 0;
  const block = (title, body, grow = 1) => `<div style="flex:${grow};min-width:${grow > 1 ? 210 : 140}px;padding:0 12px${
    nth++ ? ';border-left:1px solid var(--i7)' : ''}">
    <div style="font-size:10px;color:var(--i5);font-weight:600;letter-spacing:.02em">${title}</div>
    <div style="margin-top:3px">${body}</div></div>`;

  const cnt = (obj, cls) => Object.entries(obj).sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `<span class="pill ${cls}" style="font-size:9.5px">${escapeHtml(k)} ${v}</span>`).join('');

  return `<div class="uc" style="margin:12px 0 10px;padding:11px 4px">
    <div style="display:flex;flex-wrap:wrap;gap:10px 0;align-items:flex-start">
      ${block('참가기업', `${n(s.all.length)}<span style="font-size:11px;color:var(--i4)"> 개사</span>
        <span style="color:var(--i6);margin:0 5px">·</span>${n(s.countries.size)}<span style="font-size:11px;color:var(--i4)"> 개국</span>
        ${sub(`국내 ${s.co.home} · 해외 ${s.co.away}${s.co.unknown ? ` · 국가 미확인 ${s.co.unknown}` : ''}`)}`)}

      ${block('부스', `${n(s.booth.total)}<span style="font-size:11px;color:var(--i4)"> 부스</span>
        ${sub(`국내 ${s.booth.home} · 해외 ${s.booth.away}${s.booth.unknown ? ` · 미확인 ${s.booth.unknown}` : ''}`)}
        ${s.shared ? sub(`<span title="한 부스를 나눠 쓰는 기업이에요 — 기업 수에는 있고 부스 수에는 없습니다">공동 부스 ${s.shared}곳 제외</span>`) : ''}
        ${s.bookOnly ? sub(`<span title="프로그램북에만 오르는 참가예요 — 부스도 체크리스트도 세지 않습니다">프로그램북만 ${s.bookOnly}곳 제외</span>`) : ''}`)}

      ${block('층', `<div style="display:flex;flex-wrap:wrap;gap:3px">${cnt(s.floor, 'p-gray')}</div>
        ${sub(s.noBooth ? `<span style="color:var(--am)">부스 미배정 ${s.noBooth}곳</span>` : '부스 수 기준')}`)}

      ${block('부스 타입', `<div style="display:flex;flex-wrap:wrap;gap:3px">${cnt(s.type, 'p-blue')}</div>
        ${sub('부스 수 기준')}`, 2)}

      ${s.prev ? block('지난 행사 대비', `<div>${n(s.prev.back)}<span style="font-size:11px;color:var(--i4)"> 재참가</span>
        <span style="color:var(--i6);margin:0 5px">·</span>${n(s.prev.fresh)}<span style="font-size:11px;color:var(--i4)"> 신규</span></div>
        ${sub(`${escapeHtml(s.prev.key)} 대비${s.prev.dropped ? ` · <span style="color:var(--am)">이탈 ${s.prev.dropped}곳</span>` : ''}`)}`) : ''}

      ${Object.keys(s.grade).length
        ? block('스폰서 등급', `<div style="display:flex;flex-wrap:wrap;gap:3px">${
            Object.entries(s.grade).sort((a, b) => b[1] - a[1])
              .map(([k, v]) => `<span class="pill ${gradeCls(k)}" style="font-size:9.5px">${escapeHtml(k)} ${v}</span>`).join('')
          }</div>${sub(`일반 ${s.all.length - Object.values(s.grade).reduce((a, b) => a + b, 0)}곳`)}`)
        : ''}
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

/* 받침에 따라 '와/과'를 고른다 — 기업명이 값이라 문장에 그대로 이어 붙는다 */
function wa(name){
  const ch = String(name || '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if(code >= 0xAC00 && code <= 0xD7A3) return (code - 0xAC00) % 28 ? '과' : '와';
  return '와';   // 영문·숫자로 끝나면 읽는 대로 갈리므로 기본값
}

/* 신청순 칸 — 참가 신청을 받은 순서. 프로그램북 순번과 다른 값이라 따로 둔다.

   한 번호를 두 곳이 함께 쓰는 자리가 있다. 부스를 나눠 쓰는 서울대학교병원과
   분당서울대학교병원이 한 건으로 신청했기 때문인데, 행은 따로 두고 번호만 같다.
   실수로 보이지 않게 그 줄에 표시를 남긴다 — 없으면 다음 사람이 고치려 든다. */
const applyCell = (x) => {
  if(!x.apply_order) return '<td style="min-width:44px;text-align:right;font-size:11.5px;color:var(--i6)">-</td>';
  const same = activeExhibitors(x.event_id)
    .filter(o => o.id !== x.id && String(o.apply_order || '') === String(x.apply_order))
    .map(o => exhNames(o).ko);
  return `<td style="min-width:44px;text-align:right;font-size:11.5px;color:var(--i4)"${
    same.length ? ` title="${escAttr(same.join(', '))}${wa(same[same.length - 1])} 같은 신청 건이에요 — 부스를 나눠 써서 번호를 함께 씁니다"` : ''
  }>${escapeHtml(x.apply_order)}${same.length ? '<span style="color:var(--a);font-size:9px">*</span>' : ''}</td>`;
};

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

/* 부스 타입은 행사마다 다르다 — 설정에서 고친다(code_lists.booth_type).
   아래 값은 서버 목록이 아직 안 왔을 때만 쓰는 기본값이다. */
const BOOTH_TYPE_FALLBACK = [SELF_BUILD_TYPE, 'Block System A', 'Block System B',
  'Block System C', 'Lighting Booth', 'Octanium (Standard)'].map(c => ({ code: c, label: c }));
export const boothTypes = (evKey) => codeList('booth_type', evKey || exhEvent, BOOTH_TYPE_FALLBACK);

/* 목록에 없는 값이 이미 들어 있으면(옛 데이터·행사마다 다른 타입) 그 값도 함께
   보여준다 — 고정 목록으로 바꿨다는 이유로 저장돼 있던 값이 조용히 사라지면 안 된다. */
export function boothTypeOptions(current, evKey){
  const cur = String(current || '').trim();
  const list = boothTypes(evKey).map(t => [t.code, t.label]);
  // 목록에 없는 값이 이미 저장돼 있으면 그 값도 보기에 넣는다 — 목록을 고쳤다는
  // 이유로 저장돼 있던 값이 조용히 사라지면 안 된다
  if(cur && !list.some(([c]) => c === cur)) list.push([cur, cur + ' (목록에 없음)']);
  return `<option value=""${cur ? '' : ' selected'}>— 미지정 —</option>`
    + list.map(([c, l]) => `<option value="${escAttr(c)}"${cur === c ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
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

/* ── 부스 타입 골라 보기 ──
   "Block System A가 몇 곳이지"까지는 배지로 보이는데, 그게 어느 기업인지 알려면
   51줄을 눈으로 훑어야 했다. 배지를 눌러 그 타입만 남긴다. 대시보드 부스 카드의
   타입 배지도 같은 곳으로 보낸다 — 세어 둔 숫자를 눌렀는데 아무 일이 없으면
   셀 수만 있고 쓸 수는 없는 숫자가 된다. */
let boothTypeFil = '';
export function setBoothTypeFil(t){
  boothTypeFil = (boothTypeFil === t) ? '' : t;   // 같은 걸 또 누르면 해제
  exhView = 'booth';                              // 대시보드에서 눌러도 부스 현황으로 간다
  renderExh();
}

function renderBoothView(list){
  if(!list.length) return emptyView('표시할 기업이 없어요');
  const all0 = [...list].sort((a, b) => boothSortKey(a) - boothSortKey(b));
  // 걸러도 배지의 숫자는 전체 기준을 유지한다 — 누를 때마다 숫자가 1로 바뀌면
  // 다른 타입이 몇 곳인지 알 수 없어 옮겨 다닐 수가 없다
  const rows = boothTypeFil ? all0.filter(x => (x.booth_type || '') === boothTypeFil) : all0;
  const noBooth = all0.filter(x => !String(x.booth_no || '').trim()).length;
  const selfN = all0.filter(x => x.booth_type === SELF_BUILD_TYPE).length;
  const unconfirmed = all0.filter(x => x.booth_confirmed !== 'yes' && !x.booth_confirmed_at).length;

  /* 번호에서 읽은 부스 수와 적어둔 수량이 다르면 알린다 — 10-11이면 2부스인데
     수량이 1로 적혀 있으면 청구액이 절반으로 잡힌다. */
  const qtyOdd = all0.filter(x => {
    if(isSharedBooth(x)) return false;   // 나눠 쓰는 부스는 번호와 수량이 안 맞는 게 정상
    const b = parseBooth(x.booth_no);
    const q = Number(String(x.booth_qty || '').replace(/[^0-9]/g, ''));
    return b.kind === 'range' && q && q !== b.count;
  });
  /* 공동 부스는 번호가 같은 두 줄로 들어와 있어 번호로 세면 두 번 잡힌다 */
  const totalBooths = rows.reduce((a, x) => a + (isSharedBooth(x) ? 0 : parseBooth(x.booth_no).count), 0);
  const sharedN = all0.filter(isSharedBooth).length;
  /* 「공동」 토글은 번호가 겹치는 줄에만 붙인다. 모든 줄에 달면 1부스짜리
     50줄에도 눌 일 없는 버튼이 생겨 표가 어수선해진다. 이미 켜 둔 줄은
     번호를 나중에 고쳤어도 계속 보여준다(끌 수 있어야 한다). */
  const dupBooth = new Set();
  {
    const seen = new Set();
    all0.forEach(x => {
      const k = String(x.booth_no || '').trim();
      if(!k) return;
      if(seen.has(k)) dupBooth.add(k); else seen.add(k);
    });
  }
  const typeCnt = countBy(all0, x => x.booth_type);

  const typePill = (t, n) => `<span class="pill ${boothTypeFil === t ? 'p-blue' : 'p-gray'}"
    onclick="setBoothTypeFil('${escAttr(t)}')" style="cursor:pointer"
    title="${boothTypeFil === t ? '다시 눌러 전체 보기' : escAttr(t) + ' 기업만 보기'}">${escapeHtml(t)} ${n}${
      boothTypeFil === t ? ' ✕' : ''}</span>`;

  const pills = `<span class="pill p-gray">기업 ${boothTypeFil ? `${rows.length}/${all0.length}` : all0.length}</span>`
    + `<span class="pill p-gray">부스 ${totalBooths}칸</span>`
    + (noBooth ? `<span class="pill p-red">번호 미배정 ${noBooth}</span>` : '')
    + (sharedN ? `<span class="pill p-blue" title="한 부스를 나눠 쓰는 기업이에요 — 부스 수에서 빠집니다">공동 부스 ${sharedN}</span>` : '')
    + (unconfirmed ? `<span class="pill p-amber">배정 미확정 ${unconfirmed}</span>` : '')
    + (qtyOdd.length ? `<span class="pill p-red" title="${escAttr(qtyOdd.map(x => `${x.company_name} ${x.booth_no}(${parseBooth(x.booth_no).count}칸) ↔ 수량 ${x.booth_qty}`).join(', '))}">수량 불일치 ${qtyOdd.length}</span>` : '')
    + `<span class="pill p-blue">독립부스 ${selfN}</span>`
    + (() => {
      const self = all0.filter(x => x.booth_type === SELF_BUILD_TYPE);
      const wait = self.filter(x => ['none', 'todo'].includes(boothDesignState(x).state)).length;
      const fix  = self.filter(x => boothDesignState(x).state === 'warn').length;
      return (wait ? `<span class="pill p-amber" title="도면을 못 받았거나 아직 확인하지 않은 독립부스예요">도면 확인 필요 ${wait}</span>` : '')
        + (fix ? `<span class="pill p-red" title="수정 요청한 뒤 아직 정리되지 않은 도면이에요">도면 수정 요청 ${fix}</span>` : '');
    })()
    + Object.entries(typeCnt).sort((a, b) => b[1] - a[1]).map(([t, n]) => typePill(t, n)).join('')
    + (boothTypeFil
      ? `<span style="font-size:10.5px;color:var(--a);margin-left:2px;cursor:pointer" onclick="setBoothTypeFil('')">전체 보기로 돌아가기</span>`
      : '<span style="font-size:10.5px;color:var(--i5);margin-left:2px">타입 배지를 누르면 그 부스 기업만 봐요 · 번호·층·수량은 행을 눌러 상세에서 고쳐요</span>');

  if(!rows.length) return viewShell(pills,
    emptyView(`"${boothTypeFil}" 부스를 쓰는 기업이 없어요`));

  if(isMobile()) return viewShell(pills, rows.map(x => `
    <div onclick="openExhDr('${escAttr(x.id)}','progress')" style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:11px 12px;margin-bottom:7px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <span class="pill ${x.booth_no ? 'p-blue' : 'p-red'}">${x.booth_no ? '부스 ' + escapeHtml(x.booth_no) : '미배정'}${
          (() => { const b = parseBooth(x.booth_no);
            return b.kind === 'range' ? ` (${b.count}칸)` : b.kind === 'split' ? ' 공동' : ''; })()}</span>
        <span style="font-size:13px;font-weight:700;flex:1;min-width:0">${escapeHtml(exhNames(x).ko)}</span>
        ${x.booth_confirmed === 'yes' || x.booth_confirmed_at ? '<span class="pill p-green">확정</span>' : '<span class="pill p-amber">미확정</span>'}
        ${isSharedBooth(x) ? '<span class="pill p-blue" title="부스 수에서 빠져요">공동 부스</span>' : ''}
      </div>
      ${exhNames(x).en ? `<div style="font-size:11px;color:var(--i4);margin:-2px 0 3px">${escapeHtml(exhNames(x).en)}</div>` : ''}
      <div style="font-size:11px;color:var(--i4)">${[x.booth_floor && x.booth_floor + '층', x.booth_type, x.booth_qty && x.booth_qty + '부스', x.grade].filter(Boolean).map(escapeHtml).join(' · ') || '정보 없음'}</div>
      ${x.builder ? `<div style="font-size:11px;color:var(--i3);margin-top:3px">🔧 ${escapeHtml(x.builder)}${x.builder_mobile ? ' · ' + escapeHtml(x.builder_mobile) : ''}</div>` : ''}
      ${x.booth_type === SELF_BUILD_TYPE ? (() => {
        const d = boothDesignState(x);
        const cls = { none: 'p-gray', todo: 'p-amber', warn: 'p-red', done: 'p-green' }[d.state];
        return `<div style="margin-top:4px"><span class="pill ${cls}" style="font-size:9.5px">도면 ${escapeHtml(d.text)}</span></div>`;
      })() : ''}
    </div>`).join(''));

  return viewShell(pills, `<div class="tw"><table><thead><tr>
      <th style="min-width:44px;text-align:right">신청순</th>
      <th style="min-width:64px">부스</th>
      <th style="min-width:150px">기업</th>
      <th style="min-width:46px">층</th>
      <th style="min-width:130px">타입</th>
      <th style="min-width:50px">수량</th>
      <th style="min-width:70px">등급</th>
      <th style="min-width:60px;text-align:center">확정</th>
      <th style="min-width:180px">시공사 (독립부스)</th>
      <th style="min-width:110px">부스 도면</th>
    </tr></thead><tbody>
    ${rows.map(x => {
      const self = x.booth_type === SELF_BUILD_TYPE;
      const done = x.booth_confirmed === 'yes' || !!x.booth_confirmed_at;
      return `<tr onclick="openExhDr('${escAttr(x.id)}','progress')" style="cursor:pointer"
        title="부스 번호·층·수량은 여기서 열리는 상세에서 고칩니다">
        ${applyCell(x)}
        <td style="font-size:12px;font-weight:700${x.booth_no ? '' : ';color:var(--i6)'}">${escapeHtml(x.booth_no || '—')}
          ${(() => { const b = parseBooth(x.booth_no);
            return b.kind === 'range' ? `<div style="font-size:9.5px;color:var(--i4);font-weight:400;margin-top:1px">${b.count}칸</div>` : ''; })()}
          ${dupBooth.has(String(x.booth_no || '').trim()) || isSharedBooth(x)
            ? `<div style="margin-top:2px"><span onclick="event.stopPropagation();toggleSharedBooth('${escAttr(x.id)}')"
            title="${isSharedBooth(x) ? '부스 수에서 빠져 있어요 — 눌러서 되돌립니다' : '한 부스를 나눠 쓴다면 눌러서 부스 수에서 뺍니다'}"
            style="cursor:pointer;font-size:9px;font-weight:400;padding:1px 5px;border-radius:4px;
              border:1px solid ${isSharedBooth(x) ? 'var(--a)' : 'var(--i7)'};
              background:${isSharedBooth(x) ? 'var(--ad)' : 'transparent'};
              color:${isSharedBooth(x) ? 'var(--a)' : 'var(--i5)'}">공동${isSharedBooth(x) ? ' ✓' : ''}</span></div>`
            : ''}</td>
        ${coCell(x, 'progress')}
        <td style="font-size:11.5px;color:var(--i3)">${x.booth_floor ? escapeHtml(x.booth_floor) + '층' : '<span style="color:var(--i6)">—</span>'}</td>
        <td><select class="fi" style="width:126px;padding:3px 4px;font-size:11px" onclick="event.stopPropagation()"
          onchange="setExhField('${escAttr(x.id)}','booth_type',this.value,'부스 타입')">${boothTypeOptions(x.booth_type)}</select></td>
        <td style="font-size:11.5px;color:var(--i3);text-align:center">${x.booth_qty ? escapeHtml(x.booth_qty) : '<span style="color:var(--i6)">—</span>'}</td>
        <td>${x.grade ? `<span class="pill ${gradeCls(x.grade)}">${escapeHtml(x.grade)}</span>` : '<span style="color:var(--i6)">—</span>'}</td>
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
        <td>${self ? (() => {
          /* 자체 시공은 무엇을 지을지도 우리가 본다 — 도면을 받았는지, 봤는지,
             고쳐 달라고 했는지가 시공사 연락처만큼 중요하다. */
          const d = boothDesignState(x);
          const cls = { none: 'p-gray', todo: 'p-amber', warn: 'p-red', done: 'p-green' }[d.state];
          return `<span class="pill ${cls}">${escapeHtml(d.text)}</span>${
            x.booth_design_received_at ? `<div style="font-size:9.5px;color:var(--i4);margin-top:2px">받음 ${escapeHtml(x.booth_design_received_at)}</div>` : ''}`;
        })() : '<span style="color:var(--i6);font-size:11px">—</span>'}</td>
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

/* ══════════════════════════════════════════
   금액 현황 — 기업별로 부스·비품·그래픽을 나눠 보고, 아래에서 합친다

   대시보드는 행사 전체 합계만 보여준다. 그런데 실무에서 묻는 건 두 가지다.
   "이번 행사 그래픽이 얼마인가"(합계)와 "이 회사는 부스가 얼마인가"(기업별).
   앞엣것만 있으면 뒤엣것을 알려고 51개 기업을 하나씩 열어야 한다.

   통화를 섞지 않는다. 기업마다 원화·달러가 갈려서 한 표에 더하면 뜻 없는 숫자가
   된다. 통화별로 표를 따로 그리고, 각 표 맨 아래에 그 통화의 합계를 둔다.

   여기 숫자는 금액 항목 기준이라 '무엇을 얼마어치 신청했나'다. 인보이스는 여러
   분류를 한 장에 합쳐 발행해 분류별로 가를 수 없어서, 청구액과는 다를 수 있다.
   그래서 청구·입금·잔액을 오른쪽에 함께 두어 어긋나면 눈에 띄게 한다.
══════════════════════════════════════════ */
const MONEY_CATS = [['booth', '부스'], ['equip', '비품'], ['graphic', '그래픽'], ['etc', '기타']];

/* 기업 하나의 분류별 금액 — 통화별로 갈라 담는다 */
function moneyRowsFor(x){
  const by = {};
  billableItems(x.id).forEach(i => {
    const cur = i.currency || 'KRW';
    const cat = ['booth', 'equip', 'graphic'].includes(i.category) ? i.category : 'etc';
    if(!by[cur]) by[cur] = { booth: 0, equip: 0, graphic: 0, etc: 0, 합계: 0 };
    const v = num(i.amount);
    by[cur][cat] += v;
    by[cur].합계 += v;
  });
  return by;
}

function renderMoneyView(list){
  const rows = list.map(x => ({ x, by: moneyRowsFor(x) })).filter(r => Object.keys(r.by).length);
  if(!rows.length) return emptyView('아직 등록된 금액 항목이 없어요');

  const curs = [...new Set(rows.flatMap(r => Object.keys(r.by)))].sort();
  const total = billedByCategory(list);

  /* 금액 하나 — 통화를 왼쪽에 붙인다. 원·$ 기호만으로는 표를 훑을 때 눈에 안 띈다. */
  const amt = (cur, v) => v
    ? `<span style="font-size:9.5px;color:var(--i5);margin-right:3px">${escapeHtml(cur)}</span>${money(v)}`
    : '<span style="color:var(--i6)">-</span>';

  /* 한 칸에 두 통화가 같이 있을 수 있다(원화로 신청한 뒤 달러 항목이 하나 끼는 식).
     한쪽을 숨기면 합이 안 맞으므로 줄을 나눠 둘 다 적는다. */
  const cell = (m, k) => {
    const has = curs.filter(c => m[c] && m[c][k]);
    if(!has.length) return '<span style="color:var(--i6)">-</span>';
    return has.map(c => amt(c, m[c][k])).join('<br>');
  };

  const pills = `<span class="pill p-gray">기업 ${rows.length}</span>`
    + curs.map(c => `<span class="pill p-blue">${escapeHtml(c)} ${money(total[c]?.합계 || 0)}</span>`).join('')
    + '<span style="font-size:10.5px;color:var(--i5);margin-left:2px">금액 항목 기준(신청 금액)이라 청구액과 다를 수 있어요 — 오른쪽에 함께 뒀어요</span>'
    + (curs.length > 1
      ? '<div style="font-size:10.5px;color:var(--i4);margin-top:4px">한 칸에 두 통화가 함께 적힌 곳은 결제 수단이 갈린 경우예요 — 인보이스는 원화로 받고 엑스렌탈은 해외 카드로 결제하면 이렇게 나옵니다. 더할 수 없으니 그대로 병기합니다.</div>'
      : '');

  // 아무도 안 쓴 분류는 열을 만들지 않는다
  const used = MONEY_CATS.filter(([k]) => curs.some(c => total[c] && total[c][k]));

  /* 청구·입금·잔액도 통화별로 다 더해 둔다. 신청 금액만 합계가 있으면
     "그래서 얼마 받았고 얼마 남았나"를 표 밖에서 다시 세게 된다. */
  const settleTotal = {};
  rows.forEach(({ x }) => {
    const st = settleByCurrency(x.id);
    Object.keys(st).forEach(c => {
      if(!settleTotal[c]) settleTotal[c] = { billed: 0, paid: 0, bank: 0, card: 0, etc: 0, balance: 0 };
      ['billed', 'paid', 'bank', 'card', 'etc', 'balance'].forEach(k => { settleTotal[c][k] += st[c][k]; });
    });
  });

  /* 입금을 통장에 찍히는 돈과 카드로 나간 돈으로 갈라 보여준다. 수단이 안 적힌
     옛 건은 세 번째 칸으로 뺀다 — 둘 중 하나에 얹으면 통장과 맞출 때 어느 쪽
     합계가 틀렸는지 알 수 없고, 아예 빼면 두 칸의 합이 잔액과 안 맞는다.
     미확인이 하나도 없으면 그 칸은 만들지 않는다. */
  const payCols = [['bank', '입금·계좌이체'], ['card', '입금·카드']]
    .concat(Object.values(settleTotal).some(s => s.etc) ? [['etc', '입금·미확인']] : []);

  if(isMobile()) return viewShell(pills, rows.map(({ x, by }) => {
    const st = settleByCurrency(x.id);
    const sc = Object.keys(st).sort();
    const line = (key) => sc.filter(c => st[c][key]).map(c => amt(c, st[c][key])).join(' · ') || '-';
    const owing = sc.some(c => st[c].balance > 0);
    return `<div onclick="openExhDr('${escAttr(x.id)}','billing')"
      style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:11px 12px;margin-bottom:7px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <span class="pill p-gray">${escapeHtml(x.apply_order || '-')}</span>
        <span style="font-size:13px;font-weight:700;flex:1;min-width:0">${escapeHtml(exhNames(x).ko)}</span>
        <span class="pill ${x.booth_no ? 'p-blue' : 'p-gray'}">${escapeHtml(x.booth_no || '미배정')}</span>
      </div>
      ${used.map(([k, l]) => {
        const has = curs.filter(c => by[c] && by[c][k]);
        if(!has.length) return '';
        return `<div style="display:flex;justify-content:space-between;font-size:11.5px;padding:2px 0">
          <span style="color:var(--i4)">${l}</span><span>${has.map(c => amt(c, by[c][k])).join(' · ')}</span>
        </div>`;
      }).join('')}
      <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;padding:4px 0 0;border-top:1px solid var(--i8);margin-top:4px">
        <span>신청 합계</span>
        <span>${curs.filter(c => by[c]?.합계).map(c => amt(c, by[c].합계)).join(' · ')}</span>
      </div>
      <div style="font-size:11px;margin-top:3px;color:var(--i4)">청구 ${line('billed')}</div>
      <div style="display:flex;justify-content:space-between;font-size:11px">
        <span style="color:var(--i4)">입금 ${line('paid')}${
          sc.some(c => st[c].bank || st[c].card || st[c].etc)
            ? `<span style="color:var(--i5);font-size:10px"> (${
                [['bank', '계좌'], ['card', '카드'], ['etc', '미확인']]
                  .filter(([k]) => sc.some(c => st[c][k]))
                  .map(([k, l]) => `${l} ${sc.filter(c => st[c][k]).map(c => amt(c, st[c][k])).join(' · ')}`)
                  .join(' / ')})</span>`
            : ''}</span>
        <span style="color:${owing ? 'var(--am)' : 'var(--g)'}">${owing ? '잔액 ' + line('balance') : '완납'}</span>
      </div>
    </div>`;
  }).join(''));

  return viewShell(pills, `<div class="tw"><table><thead><tr>
      <th style="min-width:44px;text-align:right">신청순</th>
      <th style="min-width:150px">기업</th>
      <th style="min-width:56px">부스번호</th>
      ${used.map(([, l]) => `<th style="min-width:104px;text-align:right">${l}</th>`).join('')}
      <th style="min-width:110px;text-align:right">신청 합계</th>
      <th style="min-width:110px;text-align:right">청구액</th>
      ${payCols.map(([, l]) => `<th style="min-width:104px;text-align:right">${l}</th>`).join('')}
      <th style="min-width:104px;text-align:right">잔액</th>
    </tr></thead><tbody>
      ${rows.map(({ x, by }) => {
        // 청구·입금도 통화별로 갈라 적는다 — 한 통화만 더하면 나머지가 사라진다
        const st = settleByCurrency(x.id);
        const sc = Object.keys(st).sort();
        const col = (key) => sc.filter(c => st[c][key]).map(c => amt(c, st[c][key])).join('<br>') || '-';
        const owing = sc.some(c => st[c].balance > 0);
        return `<tr>
          ${applyCell(x)}
          ${coCell(x, 'billing')}
          <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(x.booth_no || '—')}</td>
          ${used.map(([k]) => `<td style="text-align:right">${cell(by, k)}</td>`).join('')}
          <td style="text-align:right;font-weight:700">${
            curs.filter(c => by[c]?.합계).map(c => amt(c, by[c].합계)).join('<br>') || '-'}</td>
          <td style="text-align:right">${col('billed')}</td>
          ${payCols.map(([k]) => `<td style="text-align:right">${col(k)}</td>`).join('')}
          <td style="text-align:right;color:${owing ? 'var(--am)' : 'var(--i3)'}">${col('balance')}</td>
        </tr>`;
      }).join('')}
    </tbody>
    <tfoot>
      ${curs.map(c => {
        const m = total[c];
        if(!m || !m.합계) return '';
        return `<tr style="border-top:2px solid var(--i5);font-weight:800">
          <td colspan="3" style="font-size:12px">${escapeHtml(c)} 합계
            <span style="font-weight:400;color:var(--i4);font-size:10.5px">${
              rows.filter(r => r.by[c]?.합계).length}곳</span></td>
          ${used.map(([k]) => `<td style="text-align:right">${amt(c, m[k])}</td>`).join('')}
          <td style="text-align:right">${amt(c, m.합계)}</td>
          ${(() => { const s = settleTotal[c] || { billed: 0, paid: 0, balance: 0 };
            return `<td style="text-align:right">${amt(c, s.billed)}</td>
              ${payCols.map(([k]) => `<td style="text-align:right;color:var(--g)">${amt(c, s[k])}</td>`).join('')}
              <td style="text-align:right;color:${s.balance > 0 ? 'var(--am)' : 'var(--g)'}">${
                s.balance ? amt(c, s.balance) : '<span style="font-weight:400">완납</span>'}</td>`; })()}
        </tr>
        <tr style="font-weight:400">
          <td colspan="3" style="font-size:10.5px;color:var(--i4)">${escapeHtml(c)} 비중</td>
          ${used.map(([k]) => `<td style="text-align:right;font-size:10.5px;color:var(--i4)">${
            m.합계 ? Math.round(m[k] / m.합계 * 100) + '%' : '-'}</td>`).join('')}
          <td colspan="${3 + payCols.length}"></td>
        </tr>`;
      }).join('')}
    </tfoot>
    </table></div>`);
}


function renderEquipView(list){
  const rows = list.map(x => ({ x, items: liveItemsFor(x.id).filter(i => (i.category || '') === 'equip') }))
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
          ${open ? `<tr data-detail><td colspan="8" style="padding:8px 12px 12px;background:var(--i9)">
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

  /* 내보내기는 exh-export.js가 소유한다 — 이 파일이 그쪽을 import하면 순환
     참조가 되므로(내보내기가 여기 집계 함수를 쓴다) window 경유로 부른다.
     드로어를 다루는 방식과 같다. */
  const actions = `<button class="btn bs" id="exh-export-btn" onclick="exportEquipLedger()"
      title="쓰던 「비품 신청 종합관리대장」 형식(품목표 + 기업×코드 교차표)으로 받습니다">엑셀 내보내기</button>`
    + `<button class="btn bp bs" onclick="openNewCatalogItem()">+ 품목 추가</button>`;
  return viewShell(pills, summary + `<div class="sct">기업별 신청 내역</div>` + detail, actions);
}

/* ── 그래픽 현황 ──
   제작(디자인)은 초안 → 수정안 → 최종안으로 왔다 갔다 하고, 출력은 규격이
   맞는지만 보면 된다. 두 흐름이 섞여 있어 한 표에서 지금 누가 어느 단계에
   걸려 있는지 봐야 다음 연락처를 정할 수 있다. */
function renderGraphicView(list){
  const rows = list.filter(x => x.graphic_ordered_at || x.graphic_type
    || liveItemsFor(x.id).some(i => (i.category || '') === 'graphic'));
  /* 독립부스는 우리에게 그래픽을 «주문»하지 않는다 — 자기들이 만들어 와서
     우리는 받아 보기만 한다. 그래서 주문 목록(rows)이 아니라 부스 타입으로 잡는다.
     주문이 하나도 없어도 이 보기는 열려야 한다. */
  const selfRows = list.filter(x => (x.booth_type || '') === SELF_BUILD_TYPE);
  if(!rows.length && !selfRows.length) return emptyView('그래픽을 주문한 기업이 없어요');

  /* 보기 전환 — 기업별은 "이 회사가 어느 단계인가", 항목별은 "무엇이 아직 안 왔나".
     그래픽은 한 기업이 백월·행잉배너·데스크 랩핑을 함께 주문하므로 기업 한 줄로는
     무엇을 받았는지 체크할 자리가 없다. 그래서 받을 파일 목록을 기본으로 둔다. */
  const seg = `<div style="padding:12px 16px 0"><div class="seg">
    ${[['item', '받을 파일'], ['kind', '품목별'], ['co', '기업별 진행'],
       ['self', `독립부스${selfRows.length ? ` ${selfRows.length}` : ''}`]].map(([k, l]) =>
      `<button class="seg-b${gView === k ? ' on' : ''}" onclick="setGraphicView('${k}')">${l}</button>`).join('')}
  </div></div>`;

  if(gView === 'self') return seg + renderSelfBoothView(selfRows);
  if(!rows.length) return seg + emptyView('그래픽을 주문한 기업이 없어요');
  return seg + (gView === 'co' ? renderGraphicCoView(rows)
    : gView === 'kind' ? renderGraphicKindView(rows)
    : renderGraphicItemView(rows));
}

/* ── 독립부스 ──
   자체 시공은 부스를 업체가 직접 짓는다. 우리가 만들 것은 없지만 그냥 두면
   안 된다 — 높이 제한을 넘기거나 통로를 침범하거나 옆 부스를 가리는 도면이
   개막 직전에 발견되면 그때는 고칠 시간이 없다.

   그래서 세 가지를 받는다. 누가 짓는지(시공사), 무엇을 짓는지(도면·그래픽),
   그리고 우리가 봤는지(확인). 셋이 한 줄에 있어야 "받았는데 아직 안 봤다"가
   보인다 — 받은 것만 세면 그게 완료로 착각된다. */
function renderSelfBoothView(rows){
  if(!rows.length) return emptyView('독립부스(Self-Construction)로 신청한 기업이 없어요');

  const bk = (x) => { const k = boothSortKey(x); return k === Infinity ? 1e9 : k; };
  const list = [...rows].sort((a, b) => bk(a) - bk(b));

  const hasBuilder = (x) => !!String(x.builder || '').trim();
  const got  = (x) => !!x.booth_design_received_at;
  const seen = (x) => !!x.booth_design_checked_at;
  const nB = list.filter(hasBuilder).length;
  const nG = list.filter(got).length;
  const nS = list.filter(seen).length;
  const nOk  = list.filter(x => x.booth_design_result === 'ok').length;
  const nFix = list.filter(x => x.booth_design_result === 'fix').length;
  const due = dueInfo('calc:design', exhEvent);

  /* 숫자만 보면 12/18이 얼마나 남은 건지 안 들어온다 */
  const bar = (v, of, color) => `<div style="display:flex;align-items:center;gap:6px;min-width:120px">
    <div style="flex:1;height:5px;border-radius:3px;background:var(--i7);overflow:hidden">
      <div style="width:${of ? Math.round(v / of * 100) : 0}%;height:100%;background:${v === of ? 'var(--g)' : color}"></div></div>
    <span style="font-size:11px;font-weight:700;color:${v === of ? 'var(--g)' : 'var(--i3)'}">${v}/${of}</span></div>`;

  const pills = `<span class="pill p-gray">독립부스 ${list.length}곳</span>`
    + `<span class="pill ${nB === list.length ? 'p-green' : 'p-amber'}">시공사 ${nB}/${list.length}</span>`
    + `<span class="pill ${nG === list.length ? 'p-green' : 'p-amber'}">도면 수령 ${nG}/${list.length}</span>`
    + `<span class="pill ${nS === list.length ? 'p-green' : 'p-amber'}">확인 ${nS}/${list.length}</span>`
    + (nFix ? `<span class="pill p-red" title="${escAttr(list.filter(x => x.booth_design_result === 'fix').map(x => exhNames(x).ko).join(', '))}">수정 요청 ${nFix}</span>` : '')
    + (nOk ? `<span class="pill p-green">적합 ${nOk}</span>` : '')
    + (due
      ? `<span class="pill ${due.days < 0 ? 'p-red' : due.days <= 7 ? 'p-amber' : 'p-gray'}">수령 마감 ${escapeHtml(due.date)}${
          due.days < 0 ? ` · ${-due.days}일 지남` : due.days === 0 ? ' · 오늘' : ` · D-${due.days}`}</span>`
      : '');

  const board = `<div class="uc" style="margin:12px 0 10px;padding:11px 14px">
    <div style="display:flex;flex-wrap:wrap;gap:14px 26px">
      ${[['시공사 정보', nB, 'var(--a)'], ['도면·그래픽 수령', nG, 'var(--am)'],
         ['우리 확인', nS, 'var(--am)'], ['적합 판정', nOk, 'var(--g)']].map(([l, v, c]) =>
        `<div style="min-width:150px">
          <div style="font-size:10px;color:var(--i5);font-weight:600">${l}</div>
          <div style="margin-top:4px">${bar(v, list.length, c)}</div></div>`).join('')}
    </div>
    ${nG > nS ? `<div style="font-size:11px;color:var(--am);margin-top:8px">받아 놓고 아직 안 본 도면이 <b>${nG - nS}건</b> 있어요 — 확인해야 적합·수정을 판정할 수 있습니다</div>` : ''}
  </div>`;

  const txt = (x, f, ph, label, w) => `<input class="fi" style="width:${w};padding:3px 6px;font-size:11.5px"
    placeholder="${escAttr(ph)}" value="${escAttr(x[f] || '')}" onclick="event.stopPropagation()"
    onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr(label)}')">`;
  const dt = (x, f, label) => `<input type="date" class="fi" style="width:124px;padding:3px 6px;font-size:11.5px"
    value="${escAttr(x[f] || '')}" onclick="event.stopPropagation()"
    onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr(label)}')">`;

  /* 확인 결과는 받아 보기 전에는 고를 수 없게 둔다 — 안 본 도면에 «적합»이
     찍히면 그 부스는 아무도 다시 안 본다. */
  const resultCell = (x) => !got(x)
    ? '<span style="font-size:11px;color:var(--i6)">도면 수령 후</span>'
    : `<select class="fi" style="width:104px;padding:3px 5px;font-size:11.5px" onclick="event.stopPropagation()"
        onchange="setExhField('${escAttr(x.id)}','booth_design_result',this.value,'도면 확인 결과')">
        ${[['', '미판정'], ['ok', '적합'], ['fix', '수정 요청']].map(([v, l]) =>
          `<option value="${v}"${(x.booth_design_result || '') === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>`;

  const stateCell = (x) => { const s = boothDesignState(x);
    const c = s.state === 'done' ? 'p-green' : s.state === 'warn' ? 'p-red'
      : s.state === 'none' ? 'p-gray' : 'p-amber';
    return `<span class="pill ${c}">${escapeHtml(s.text)}</span>`; };

  /* 연락처는 칸을 다 벌리면 표가 안 읽힌다 — 있는지만 보이고 자세한 건 툴팁에 */
  const contactOf = (x) => [x.builder_contact, x.builder_tel, x.builder_mobile, x.builder_email]
    .map(v => String(v || '').trim()).filter(Boolean);

  if(isMobile()) return viewShell(pills, board + list.map(x => `
    <div style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:11px 12px;margin-bottom:7px">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:5px">
        <span class="pill p-gray">${x.booth_no ? '부스 ' + escapeHtml(x.booth_no) : '미배정'}</span>
        <span onclick="openExhDr('${escAttr(x.id)}','progress')"
          style="font-size:13px;font-weight:700;flex:1;min-width:0;cursor:pointer">${escapeHtml(exhNames(x).ko)}</span>
        ${stateCell(x)}
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <span style="font-size:11px;color:var(--i4);min-width:56px">시공사</span>${txt(x, 'builder', '업체명', '시공업체', '100%')}</div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <span style="font-size:11px;color:var(--i4);min-width:56px">수령</span>${dt(x, 'booth_design_received_at', '도면 수령')}</div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <span style="font-size:11px;color:var(--i4);min-width:56px">확인</span>${dt(x, 'booth_design_checked_at', '도면 확인')}</div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:11px;color:var(--i4);min-width:56px">결과</span>${resultCell(x)}</div>
    </div>`).join(''));

  return viewShell(pills, board + `<div class="tw"><table><thead><tr>
      <th style="min-width:44px;text-align:right">신청순</th>
      <th style="min-width:56px">부스</th>
      <th style="min-width:150px">기업</th>
      <th style="min-width:150px">시공사</th>
      <th style="min-width:70px;text-align:center">연락처</th>
      <th style="min-width:130px">도면·그래픽 수령</th>
      <th style="min-width:130px">우리 확인</th>
      <th style="min-width:110px">결과</th>
      <th style="min-width:90px;text-align:center">상태</th>
      <th style="min-width:150px">비고</th>
    </tr></thead><tbody>
    ${list.map(x => {
      const c = contactOf(x);
      return `<tr>
        ${applyCell(x)}
        <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(x.booth_no || '—')}</td>
        ${coCell(x, 'progress')}
        <td>${txt(x, 'builder', '업체명', '시공업체', '142px')}</td>
        <td style="text-align:center">${c.length
          ? `<span class="pill p-green" title="${escAttr(c.join(' · '))}">있음</span>`
          : '<span class="pill p-gray" title="기업 상세 › 현장에서 담당자·연락처를 넣을 수 있어요">없음</span>'}</td>
        <td>${dt(x, 'booth_design_received_at', '도면 수령')}</td>
        <td>${dt(x, 'booth_design_checked_at', '도면 확인')}</td>
        <td>${resultCell(x)}</td>
        <td style="text-align:center">${stateCell(x)}</td>
        <td>${txt(x, 'booth_design_note', '수정 요청 내용 등', '도면 비고', '100%')}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`);
}

/* ── 받을 파일 계획 ──
   기업 단위 단계(graphic_stage)는 "기업 전달"까지밖에 못 담는다 — 셋 중 둘만 온
   경우가 그 칸에 안 들어간다. 받아야 할 파일 하나를 한 줄로 놓고, 언제까지 받기로
   했는지(due_at)를 함께 잡는다. 마감이 없으면 미수령 목록은 길어지기만 하고
   누구부터 재촉할지 정할 근거가 없다. */
export function graphicItemsOf(exhId){
  return liveItemsFor(exhId).filter(i => (i.category || '') === 'graphic');
}

/* 마감 읽기. 받은 항목은 마감이 지났어도 늦은 게 아니다 — 이미 끝난 일이다.
   rank는 정렬용이다(급한 것이 위로). */
export function graphicDueInfo(i){
  if(i.received_at) return { cls: 'p-green', text: '받음', rank: 4 };
  const d = String(i.due_at || '').trim();
  if(!d) return { cls: 'p-gray', text: '마감 미정', rank: 3 };
  const over = daysSince(d);
  if(over > 0)   return { cls: 'p-red', text: `${over}일 지남`, rank: 0, late: true };
  if(over === 0) return { cls: 'p-red', text: '오늘 마감',      rank: 0, late: true };
  return -over <= DUE_SOON_DAYS
    ? { cls: 'p-amber', text: `D-${-over}`, rank: 1, soon: true }
    : { cls: 'p-gray',  text: `D-${-over}`, rank: 2 };
}

function graphicPlanRows(list){
  const out = [];
  list.forEach(x => graphicItemsOf(x.id).forEach(i => out.push({ x, i, d: graphicDueInfo(i) })));
  /* 급한 것부터. 같은 급함 안에서는 마감이 빠른 순, 그다음 기업 이름 순 —
     한 기업 파일이 흩어지지 않아야 연락 한 번에 함께 물어볼 수 있다. */
  out.sort((a, b) => a.d.rank - b.d.rank
    || String(a.i.due_at || '9999').localeCompare(String(b.i.due_at || '9999'))
    || exhNames(a.x).ko.localeCompare(exhNames(b.x).ko, 'ko'));
  return out;
}

function renderGraphicItemView(list){
  const all = graphicPlanRows(list);
  if(!all.length) return emptyView('정산 탭에서 그래픽 분류로 항목을 넣으면 여기에 받을 파일로 잡혀요');

  const got  = all.filter(r => r.i.received_at);
  const todo = all.filter(r => !r.i.received_at);
  const late = todo.filter(r => r.d.late);
  const soon = todo.filter(r => r.d.soon);
  const none = todo.filter(r => !String(r.i.due_at || '').trim());

  const shown = gFil === 'todo' ? todo
    : gFil === 'late' ? todo.filter(r => r.d.late || r.d.soon)
    : gFil === 'none' ? none
    : gFil === 'got'  ? got : all;

  const fpill = (k, l, n, cls) => `<button class="pill ${gFil === k ? cls : 'p-gray'}"
    style="border:0;cursor:pointer${gFil === k ? ';outline:2px solid var(--i5)' : ''}"
    onclick="setGraphicFil('${k}')">${l} ${n}</button>`;
  const pills = fpill('all', '전체', all.length, 'p-blue')
    + fpill('todo', '미수령', todo.length, 'p-amber')
    + fpill('late', '지남·임박', late.length + soon.length, 'p-red')
    + fpill('none', '마감 미정', none.length, 'p-amber')
    + fpill('got', '받음', got.length, 'p-green');

  /* 마감 일괄 잡기 — 계획은 보통 "이 기업들 다 며칟날까지"로 세운다. 지금 걸러 놓은
     미수령 항목에만 넣는다(이미 받은 것은 건드리지 않는다). */
  const actions = `<input type="date" id="g-bulk-due" class="fi" style="width:140px;padding:4px 7px;font-size:11.5px">
    <button class="btn bs" onclick="applyGraphicDue()"
      title="지금 보고 있는 미수령 항목의 마감일을 한꺼번에 정합니다">마감 일괄 지정</button>
    <button class="btn bp bs" onclick="openNewGraphicOrder()">+ 그래픽 주문 추가</button>`;

  const chk = (r) => `<button onclick="event.stopPropagation();toggleItemReceived('${escAttr(r.i.id)}')"
    title="${r.i.received_at ? '받음 표시를 지웁니다' : '오늘 받은 것으로 표시합니다'}"
    style="width:20px;height:20px;border-radius:5px;line-height:1;flex-shrink:0;cursor:pointer;font-size:12px;font-weight:800;color:#fff;border:1.5px solid ${
      r.i.received_at ? 'var(--g)' : 'var(--i6)'};background:${r.i.received_at ? 'var(--g)' : 'transparent'}">${r.i.received_at ? '✓' : ''}</button>`;

  if(isMobile()) return viewShell(pills, shown.map(r => `
    <div style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:11px 12px;margin-bottom:7px">
      <div style="display:flex;align-items:center;gap:8px">
        ${chk(r)}
        <span style="flex:1;min-width:0" onclick="openExhDr('${escAttr(r.x.id)}','graphic')">
          <div style="font-size:12.5px;font-weight:600">${escapeHtml(r.i.name || '(이름 없음)')}</div>
          <div style="font-size:11px;color:var(--i4)">${escapeHtml(exhNames(r.x).ko)}${
            r.x.booth_no ? ` · 부스 ${escapeHtml(r.x.booth_no)}` : ''}</div>
        </span>
        <span class="pill ${r.d.cls}">${escapeHtml(r.d.text)}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-top:7px">
        <span style="font-size:10.5px;color:var(--i5)">마감</span>
        <input type="date" class="fi" style="width:130px;padding:4px 7px;font-size:11.5px" value="${escAttr(r.i.due_at || '')}"
          onchange="setItemField('${escAttr(r.i.id)}','due_at',this.value)">
      </div>
      <input class="fi" style="width:100%;margin-top:5px;padding:4px 8px;font-size:11.5px"
        value="${escAttr(r.i.received_note || '')}" placeholder="받은 것 — 예: 백월_최종.ai"
        onchange="setItemField('${escAttr(r.i.id)}','received_note',this.value)">
    </div>`).join('') || emptyView('해당하는 항목이 없어요'), actions);

  return viewShell(pills, `<div class="tw"><table><thead><tr>
      <th style="min-width:30px"></th>
      <th style="min-width:150px">기업</th>
      <th style="min-width:56px">부스</th>
      <th style="min-width:180px">받을 파일</th>
      <th style="min-width:44px;text-align:right">수량</th>
      <th style="min-width:118px">마감</th>
      <th style="min-width:88px">상태</th>
      <th style="min-width:100px">받은 날</th>
      <th style="min-width:190px">받은 것</th>
      <th style="min-width:96px;text-align:right">금액</th>
    </tr></thead><tbody>
    ${shown.map(r => `<tr${r.i.received_at ? ' style="opacity:.72"' : ''}>
      <td>${chk(r)}</td>
      ${coCell(r.x, 'graphic')}
      <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(r.x.booth_no || '—')}</td>
      <td style="font-size:12px">${escapeHtml(r.i.name || '(이름 없음)')}</td>
      <td style="text-align:right;font-size:11.5px">${escapeHtml(String(r.i.qty || ''))}</td>
      <td><input type="date" class="fi" style="width:110px;padding:3px 5px;font-size:11px" value="${escAttr(r.i.due_at || '')}"
        onchange="setItemField('${escAttr(r.i.id)}','due_at',this.value)"></td>
      <td><span class="pill ${r.d.cls}">${escapeHtml(r.d.text)}</span></td>
      <td><input type="date" class="fi" style="width:106px;padding:3px 5px;font-size:11px" value="${escAttr(r.i.received_at || '')}"
        onchange="setItemField('${escAttr(r.i.id)}','received_at',this.value)"></td>
      <td><input class="fi" style="width:180px;padding:3px 6px;font-size:11px" value="${escAttr(r.i.received_note || '')}"
        placeholder="예: 백월_최종.ai · CMYK" onchange="setItemField('${escAttr(r.i.id)}','received_note',this.value)"></td>
      <td style="text-align:right;font-size:11.5px">${r.i.amount ? escapeHtml(fmtMoney(r.i.amount, r.i.currency || 'KRW')) : '-'}</td>
    </tr>`).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--i4);padding:24px">해당하는 항목이 없어요</td></tr>'}
    </tbody></table></div>`, actions);
}

/* 지금 걸러 놓은 미수령 항목에 마감을 한 번에 넣는다. 이미 받은 항목은 빼고,
   이미 마감이 잡힌 항목이 몇 건 덮이는지 먼저 알려 준다 — 계획을 다시 잡는 일도
   있지만, 실수로 남의 마감을 밀어 버리면 되돌릴 방법이 없다. */
export async function applyGraphicDue(){
  const v = (document.getElementById('g-bulk-due')?.value || '').trim();
  if(!v){ alert('마감일을 먼저 고르세요.'); return; }
  const base = graphicPlanRows(visibleList()).filter(r => !r.i.received_at);
  const target = gFil === 'none' ? base.filter(r => !String(r.i.due_at || '').trim())
    : gFil === 'late' ? base.filter(r => r.d.late || r.d.soon)
    : gFil === 'got'  ? [] : base;
  if(!target.length){ alert('마감을 넣을 미수령 항목이 없어요.'); return; }
  const over = target.filter(r => String(r.i.due_at || '').trim() && r.i.due_at !== v).length;
  if(!confirm(`미수령 ${target.length}건의 마감을 ${v}로 정합니다.`
    + (over ? `\n이미 마감이 잡힌 ${over}건도 이 날짜로 바뀝니다.` : ''))) return;
  for(const r of target) await window.setItemField?.(r.i.id, 'due_at', v);
}

/* ── 품목별 ──
   비품은 "의자 몇 개"를 알아야 발주서를 쓴다. 그래픽도 같다 — 출력소에 넘길 때는
   기업이 아니라 "백월 12장, 데스크 랩핑 9장"으로 넘어간다. 여기에 하나가 더 붙는데,
   그래픽은 물량이 아니라 파일이 걸림돌이라 품목마다 몇 장이 아직 안 왔는지를 함께
   본다 — 백월만 다 모이면 그것부터 먼저 걸 수 있다.

   묶는 규칙은 비품과 같다: 카탈로그에 이어진 항목은 그 id로, 나머지는 이름으로.
   기업마다 "Wall graphic print", "백월 출력"처럼 다르게 적어 보내도 한 줄이 된다. */
function graphicKindGroups(list){
  const by = new Map();
  list.forEach(x => graphicItemsOf(x.id).forEach(i => {
    const cat = i.catalog_id ? catalogItem(i.catalog_id) : null;
    const k = cat ? cat.id : String(i.name || '(이름 없음)').trim();
    if(!by.has(k)) by.set(k, {
      key: k,
      code:   cat ? cat.code : '',
      nameKo: cat ? (cat.name_ko || cat.name_en) : String(i.name || '(이름 없음)').trim(),
      nameEn: cat ? (cat.name_ko ? cat.name_en : '') : '',
      spec:   cat ? cat.spec : '',
      offCatalog: !cat,
      qty: 0, cos: [], krw: 0, usd: 0, got: 0, late: 0,
    });
    const g = by.get(k);
    const q = Number(String(i.qty || '').replace(/[^0-9.-]/g, '')) || 0;
    const amt = Number(String(i.amount || '').replace(/[^0-9.-]/g, '')) || 0;
    const d = graphicDueInfo(i);
    g.qty += q || 1;                       // 수량을 안 적었으면 1장으로 센다
    if(i.received_at) g.got++;
    if(d.late) g.late++;
    g.cos.push({ x, i, d, qty: q || 1, amt, cur: i.currency || 'KRW' });
    if(isBillable(i)){ if((i.currency || 'KRW') === 'USD') g.usd += amt; else g.krw += amt; }
    else g.excluded = true;
  }));
  /* 안 온 파일이 많은 품목이 위로. 발주를 막고 있는 게 무엇인지가 먼저다 —
     같으면 물량이 큰 순서(그래야 발주서 순서와 얼추 맞는다). */
  return [...by.values()].sort((a, b) =>
    (b.cos.length - b.got) - (a.cos.length - a.got) || b.qty - a.qty);
}

function renderGraphicKindView(list){
  const groups = graphicKindGroups(list);
  if(!groups.length) return emptyView('정산 탭에서 그래픽 분류로 항목을 넣으면 여기에 품목으로 잡혀요');

  const totQty  = groups.reduce((a, g) => a + g.qty, 0);
  const totN    = groups.reduce((a, g) => a + g.cos.length, 0);
  const totGot  = groups.reduce((a, g) => a + g.got, 0);
  const totLate = groups.reduce((a, g) => a + g.late, 0);
  const totKrw  = groups.reduce((a, g) => a + g.krw, 0);
  const totUsd  = groups.reduce((a, g) => a + g.usd, 0);

  const pills = `<span class="pill p-blue">품목 ${groups.length}종</span>`
    + `<span class="pill p-gray">총 ${totQty}장</span>`
    + `<span class="pill ${totGot === totN ? 'p-green' : 'p-amber'}" title="주문한 그래픽 항목 중 파일을 받은 것">파일 받음 ${totGot}/${totN}</span>`
    + (totLate ? `<span class="pill p-red">마감 지남 ${totLate}</span>` : '')
    + (totKrw ? `<span class="pill p-gray">${fmtMoney(totKrw, 'KRW')}</span>` : '')
    + (totUsd ? `<span class="pill p-gray">${fmtMoney(totUsd, 'USD')}</span>` : '');

  /* 한 품목씩 펼쳐 보는 것과, 전부 펼쳐 놓고 훑는 것은 쓰임이 다르다 —
     발주 전에 "누가 무엇을 몇 장" 한 번에 확인할 때는 접힌 표가 오히려 불편하다. */
  const allOpen = groups.every(g => equipOpen.has(g.key));
  const actions = `<button class="btn bs" onclick="toggleGraphicKindAll()">${allOpen ? '모두 접기' : '모두 펼치기'}</button>`
    + `<button class="btn bs" onclick="openNewCatalogItem('graphic')"
        title="출력소 품목표에 새 그래픽 품목을 추가합니다">+ 품목 추가</button>`
    + `<button class="btn bp bs" onclick="openNewGraphicOrder()">+ 그래픽 주문 추가</button>`;

  /* 펼치면 그 품목을 주문한 기업이 나온다. 여기서도 바로 체크하고 마감을 넣는다 —
     "백월 다 모였나"를 보다가 한 곳만 안 왔으면 그 자리에서 처리해야지,
     받을 파일 보기로 되돌아가 다시 찾게 하면 안 된다. */
  /* 부스 번호순으로 세운다. 이 목록을 들고 하는 일이 현장을 도는 것이라
     — 53번 벽면, 50번 인포데스크 — 부스 순서대로 있어야 한 바퀴에 끝난다.
     마감이 급한 순으로 세우면 같은 품목을 붙이러 전시장을 왔다 갔다 하게 된다.
     boothSortKey는 번호가 없으면 Infinity라, 빼면 NaN이 되어 정렬이 무너진다. */
  const boothOf = (x) => { const k = boothSortKey(x); return k === Infinity ? 1e9 : k; };
  const coList = (g) => g.cos.slice()
    .sort((a, b) => boothOf(a.x) - boothOf(b.x)
      || String(exhNames(a.x).ko).localeCompare(String(exhNames(b.x).ko), 'ko'))
    .map(c => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:11.5px">
      <button onclick="event.stopPropagation();toggleItemReceived('${escAttr(c.i.id)}')"
        title="${c.i.received_at ? '받음 표시를 지웁니다' : '오늘 받은 것으로 표시합니다'}"
        style="width:18px;height:18px;border-radius:5px;line-height:1;flex-shrink:0;cursor:pointer;font-size:11px;font-weight:800;color:#fff;border:1.5px solid ${
          c.i.received_at ? 'var(--g)' : 'var(--i6)'};background:${c.i.received_at ? 'var(--g)' : 'transparent'}">${c.i.received_at ? '✓' : ''}</button>
      <span class="pill p-gray" style="min-width:52px;text-align:center">${c.x.booth_no ? '부스 ' + escapeHtml(c.x.booth_no) : '미배정'}</span>
      <span onclick="event.stopPropagation();openExhDr('${escAttr(c.x.id)}','graphic')"
        style="flex:1;min-width:0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(exhNames(c.x).ko)}</span>
      <span style="color:var(--i4)">${c.qty}장</span>
      <input type="date" class="fi" style="width:124px;padding:3px 6px;font-size:11px" value="${escAttr(c.i.due_at || '')}"
        onclick="event.stopPropagation()" onchange="setItemField('${escAttr(c.i.id)}','due_at',this.value)">
      <span class="pill ${c.d.cls}" style="min-width:64px;text-align:center">${escapeHtml(c.d.text)}</span>
      <span style="min-width:88px;text-align:right;font-weight:600">${c.amt ? escapeHtml(fmtMoney(c.amt, c.cur)) : '-'}</span>
    </div>`).join('');

  /* 받음 진행 막대 — 숫자만 보면 8/12가 얼마나 남은 건지 한눈에 안 들어온다 */
  const bar = (g) => {
    const pct = g.cos.length ? Math.round(g.got / g.cos.length * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:6px">
      <div style="flex:1;min-width:44px;height:5px;border-radius:3px;background:var(--i7);overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${g.got === g.cos.length ? 'var(--g)' : 'var(--am)'}"></div></div>
      <span style="font-size:11px;font-weight:700;color:${g.got === g.cos.length ? 'var(--g)' : 'var(--i3)'}">${g.got}/${g.cos.length}</span>
    </div>`;
  };

  if(isMobile()) return viewShell(pills, groups.map(g => {
    const open = equipOpen.has(g.key);
    return `<div style="padding:8px 0;border-bottom:1px solid var(--i8)">
      <div onclick="toggleEquipRow('${escAttr(g.key)}')" style="cursor:pointer">
        <div style="display:flex;align-items:baseline;gap:7px">
          ${g.code ? `<span class="pill p-blue" style="font-size:9px">${escapeHtml(g.code)}</span>` : ''}
          <span style="font-size:12.5px;font-weight:600;flex:1;min-width:0">${escapeHtml(g.nameKo)}</span>
          <span style="font-size:15px;font-weight:800">${g.qty}<span style="font-size:10px;font-weight:400;color:var(--i4)">장</span></span>
        </div>
        <div style="margin-top:5px">${bar(g)}</div>
        <div style="font-size:10.5px;color:var(--i4);margin-top:3px">
          ${g.cos.length}개사${g.late ? ` · <b style="color:var(--re)">마감 지남 ${g.late}</b>` : ''}
          ${g.krw ? ' · ' + escapeHtml(fmtMoney(g.krw, 'KRW')) : ''}${g.usd ? ' · ' + escapeHtml(fmtMoney(g.usd, 'USD')) : ''}
          <span style="color:var(--a)"> ${open ? '▲ 접기' : '▼ 주문 기업'}</span>
        </div>
      </div>
      ${open ? `<div style="margin-top:5px;padding-left:6px;border-left:2px solid var(--i6)">${coList(g)}</div>` : ''}
    </div>`;
  }).join('') + `<div class="sct">기업별 주문 내역</div>` + graphicCoDetail(list), actions);

  return viewShell(pills, `<div class="uc"><div class="uc-ttl">품목별 합계
      <span style="font-weight:400;color:var(--i4);font-size:10px">— 출력소에 넘기는 숫자예요. 품목을 클릭하면 주문 기업이 보이고, 거기서 바로 체크할 수 있습니다</span></div>
    <div class="tw" style="overflow:visible"><table><thead><tr>
      <th style="min-width:66px">품목코드</th>
      <th style="min-width:170px">품명(국문)</th>
      <th style="min-width:150px">품명(영문)</th>
      <th style="min-width:110px">규격</th>
      <th style="min-width:56px;text-align:right">수량</th>
      <th style="min-width:62px;text-align:right">기업</th>
      <th style="min-width:130px">파일 받음</th>
      <th style="min-width:78px;text-align:right">마감 지남</th>
      <th style="min-width:104px;text-align:right">KRW</th>
      <th style="min-width:88px;text-align:right">USD</th>
    </tr></thead><tbody>
      ${groups.map(g => {
        const open = equipOpen.has(g.key);
        return `<tr onclick="toggleEquipRow('${escAttr(g.key)}')" style="cursor:pointer${open ? ';background:var(--ad)' : ''}"
          title="클릭하면 주문한 기업을 볼 수 있어요">
          <td style="font-size:11.5px;font-weight:700;color:var(--i2)">
            <span style="color:var(--a)">${open ? '▾' : '▸'}</span> ${escapeHtml(g.code || '—')}</td>
          <td style="font-size:12.5px;font-weight:600">${escapeHtml(g.nameKo)}
            ${g.excluded ? '<span class="pill p-amber" style="font-size:9px;margin-left:4px" title="우리가 청구하지 않는 항목이라 금액 합계에서 빠져 있어요">청구 제외</span>' : ''}
            ${g.offCatalog ? '<span class="pill p-amber" style="font-size:9px;margin-left:4px" title="품목표에 없는 항목 — 이름으로 묶었어요">품목표 외</span>' : ''}</td>
          <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(g.nameEn || '-')}</td>
          <td style="font-size:11px;color:var(--i4)">${escapeHtml(g.spec || '-')}</td>
          <td style="text-align:right;font-weight:700">${g.qty}</td>
          <td style="text-align:right;color:var(--i4)">${g.cos.length}곳</td>
          <td>${bar(g)}</td>
          <td style="text-align:right">${g.late ? `<span class="pill p-red">${g.late}</span>` : '<span style="color:var(--i6)">-</span>'}</td>
          <td style="text-align:right">${g.krw ? escapeHtml(fmtMoney(g.krw, 'KRW')) : '<span style="color:var(--i6)">-</span>'}</td>
          <td style="text-align:right">${g.usd ? escapeHtml(fmtMoney(g.usd, 'USD')) : '<span style="color:var(--i6)">-</span>'}</td>
        </tr>
        ${open ? `<tr data-detail><td colspan="10" style="padding:8px 12px 12px;background:var(--i9)">
          <div style="font-size:10.5px;color:var(--i4);margin-bottom:4px">주문 기업 ${g.cos.length}곳 — 왼쪽 칸을 누르면 파일 받음으로 표시됩니다</div>
          ${coList(g)}</td></tr>` : ''}`;
      }).join('')}
    </tbody>
    <tfoot><tr style="border-top:2px solid var(--i5);font-weight:800">
      <td colspan="4" style="font-size:12px">합계 ${groups.length}종</td>
      <td style="text-align:right">${totQty}</td>
      <td style="text-align:right;font-weight:400;color:var(--i4)">${totN}건</td>
      <td style="font-size:12px">${totGot}/${totN}</td>
      <td style="text-align:right">${totLate || '-'}</td>
      <td style="text-align:right">${totKrw ? escapeHtml(fmtMoney(totKrw, 'KRW')) : '-'}</td>
      <td style="text-align:right">${totUsd ? escapeHtml(fmtMoney(totUsd, 'USD')) : '-'}</td>
    </tr></tfoot></table></div></div>`
    + `<div class="sct">기업별 주문 내역</div>` + graphicCoDetail(list), actions);
}

/* 품목별 합계가 "무엇을 몇 장"이라면, 이건 "이 회사에 무엇을 받아야 하나"다.
   비품 현황도 합계 아래 같은 자리에 기업별 신청 내역을 둔다 — 발주서를 쓰다가
   한 기업 것만 확인하고 싶을 때 표를 접었다 폈다 하지 않게. 여기서는 받은 것에
   ✓를 붙여, 펼치지 않고도 어느 회사가 무엇을 아직 안 보냈는지 알아볼 수 있다. */
function graphicCoDetail(list){
  const rows = list.map(x => ({ x, items: graphicItemsOf(x.id) })).filter(r => r.items.length);
  if(!rows.length) return '';
  return rows.map(({ x, items }) => {
    const got = items.filter(i => i.received_at).length;
    const late = items.filter(i => !i.received_at && graphicDueInfo(i).late).length;
    return `<div style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:11px 12px;margin-bottom:7px">
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:5px">
        ${x.booth_no ? `<span class="pill p-blue">부스 ${escapeHtml(x.booth_no)}</span>` : ''}
        <span onclick="openExhDr('${escAttr(x.id)}','graphic')" style="cursor:pointer;flex:1;min-width:0">
          <span style="font-size:13px;font-weight:700">${escapeHtml(exhNames(x).ko)}</span>${
          exhNames(x).en ? `<span style="font-size:11px;color:var(--i4);margin-left:5px">${escapeHtml(exhNames(x).en)}</span>` : ''}</span>
        <span class="pill ${got === items.length ? 'p-green' : got ? 'p-amber' : 'p-gray'}">받음 ${got}/${items.length}</span>
        ${late ? `<span class="pill p-red">마감 지남 ${late}</span>` : ''}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${items.map(i => { const d = graphicDueInfo(i);
          return `<span class="pill ${i.received_at ? 'p-green' : d.cls}"
            title="${escAttr(`${fmtMoney(i.amount, i.currency || 'KRW')}${i.due_at ? ` · 마감 ${i.due_at}` : ''}${
              i.received_at ? ` · ${i.received_at} 받음` : ''}${i.received_note ? ` · ${i.received_note}` : ''}`)}"
            >${i.received_at ? '✓ ' : ''}${escapeHtml(i.name || '(이름 없음)')}${i.qty ? ' ×' + escapeHtml(String(i.qty)) : ''}${
              !i.received_at && i.due_at ? ` · ${escapeHtml(d.text)}` : ''}</span>`; }).join('')}
      </div>
    </div>`;
  }).join('');
}

/* 모두 펼치기 / 모두 접기. 지금 화면에 있는 품목만 다룬다 — 다른 행사에서 펼쳐 둔
   줄까지 건드리면 행사를 옮겼을 때 왜 펼쳐져 있는지 알 수 없다. */
export function toggleGraphicKindAll(){
  const keys = graphicKindGroups(visibleList()).map(g => g.key);
  const allOpen = keys.every(k => equipOpen.has(k));
  keys.forEach(k => allOpen ? equipOpen.delete(k) : equipOpen.add(k));
  renderExh();
}

/* ── 기업별 진행 ──
   제작(디자인)은 초안 → 수정안 → 최종안으로 왔다 갔다 하고, 출력은 규격이
   맞는지만 보면 된다. 두 흐름이 섞여 있어 한 표에서 지금 누가 어느 단계에
   걸려 있는지 봐야 다음 연락처를 정할 수 있다. */
function renderGraphicCoView(rows){
  const design = rows.filter(x => x.graphic_type === 'design');
  const print  = rows.filter(x => x.graphic_type === 'print');
  const doneN  = rows.filter(x => graphicState(x).state === 'done').length;
  const warnN  = rows.filter(x => graphicState(x).state === 'warn').length;

  /* 무엇을 받았나 — 항목마다 따로 온다. 기업 단위 단계(graphic_stage)만으로는
     세 개 중 둘만 온 경우를 담지 못해, 항목 기준으로 따로 센다. */
  const gGot = (x) => {
    const gi = graphicItemsOf(x.id);
    return { n: gi.length, got: gi.filter(i => i.received_at).length,
      late: gi.filter(i => !i.received_at && graphicDueInfo(i).late).length };
  };

  const pills = `<span class="pill p-gray">주문 ${rows.length}</span>`
    + `<span class="pill p-blue">제작 ${design.length}</span>`
    + `<span class="pill p-gray">출력 ${print.length}</span>`
    + `<span class="pill p-green">완료 ${doneN}</span>`
    + (warnN ? `<span class="pill p-red">규격 확인 ${warnN}</span>` : '')
    + (() => {
      const t = rows.reduce((a, x) => { const g = gGot(x); a.n += g.n; a.got += g.got; a.late += g.late; return a; },
        { n: 0, got: 0, late: 0 });
      if(!t.n) return '';
      return `<span class="pill ${t.got === t.n ? 'p-green' : 'p-amber'}" title="주문한 그래픽 항목 중 파일을 받은 것">파일 받음 ${t.got}/${t.n}</span>`
        + (t.late ? `<span class="pill p-red" title="받기로 한 날이 지난 파일">마감 지남 ${t.late}</span>` : '');
    })();

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
    graphicItemsOf(x.id).forEach(i => {
      const c = i.currency || 'KRW';
      by[c] = (by[c] || 0) + (Number(String(i.amount || '').replace(/[^0-9.-]/g, '')) || 0);
    });
    const ks = Object.keys(by).filter(k => by[k]);
    return ks.length ? ks.map(k => fmtMoney(by[k], k)).join(' + ') : '-';
  };

  /* 받은 파일 칸 — 개수만이 아니라 무엇이 안 왔고 마감이 언제인지 함께 띄운다.
     기업 한 줄이라 여기서 체크는 못 한다. 체크는 받을 파일 보기에서 한다. */
  const gotCell = (x) => {
    const gi = graphicItemsOf(x.id);
    if(!gi.length) return '<span style="color:var(--i6)">-</span>';
    const g = gGot(x);
    return `<span class="pill ${g.got === g.n ? 'p-green' : g.got ? 'p-amber' : 'p-gray'}"
      title="${escAttr(gi.map(i => `${i.received_at ? '✓' : '·'} ${i.name || ''}${
        !i.received_at && i.due_at ? ` (마감 ${i.due_at})` : ''}${i.received_note ? ` (${i.received_note})` : ''}`).join(' / '))}"
      >${g.got}/${g.n}</span>${g.late ? ` <span class="pill p-red" title="받기로 한 날이 지났어요">지남 ${g.late}</span>` : ''}`;
  };

  const gActions = `<button class="btn bp bs" onclick="openNewGraphicOrder()">+ 그래픽 주문 추가</button>`;

  if(isMobile()) return viewShell(pills, rows.map(x => {
    const g = graphicState(x);
    return `<div onclick="openExhDr('${escAttr(x.id)}','graphic')" style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:11px 12px;margin-bottom:7px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <span class="pill p-gray">${escapeHtml(x.apply_order || '-')}</span>
        <span style="flex:1;min-width:0">
          <span style="font-size:13px;font-weight:700">${escapeHtml(exhNames(x).ko)}</span>${
          exhNames(x).en ? `<span style="font-size:11px;color:var(--i4);margin-left:5px">${escapeHtml(exhNames(x).en)}</span>` : ''}</span>
        <span class="pill ${x.graphic_type === 'design' ? 'p-blue' : 'p-gray'}">${x.graphic_type === 'design' ? '제작' : x.graphic_type === 'print' ? '출력' : '유형 미정'}</span>
        <span class="pill ${g.state === 'done' ? 'p-green' : g.state === 'warn' ? 'p-red' : 'p-amber'}">${escapeHtml(stageLabel(x))}</span>
      </div>
      <div style="font-size:11px;color:var(--i4)">주문 ${escapeHtml(x.graphic_ordered_at || '-')} · 금액 ${escapeHtml(gAmt(x))}</div>
      ${(() => { const gt = gGot(x); if(!gt.n) return '';
        return `<div style="font-size:11px;margin-top:3px;color:${gt.got === gt.n ? 'var(--g)' : 'var(--am)'}">
          파일 ${gt.got}/${gt.n} 받음${gt.got < gt.n ? ` · 미수령 ${gt.n - gt.got}건` : ''}${
            gt.late ? ` · 마감 지남 ${gt.late}건` : ''}</div>`; })()}
    </div>`;
  }).join(''), gActions);

  return viewShell(pills, `<div class="tw"><table><thead><tr>
      <th style="min-width:44px;text-align:right">신청순</th>
      <th style="min-width:150px">기업</th>
      <th style="min-width:56px">부스</th>
      <th style="min-width:80px">유형</th>
      <th style="min-width:96px">시안</th>
      <th style="min-width:150px">확인 진행</th>
      <th style="min-width:110px">받은 파일</th>
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
        ${applyCell(x)}
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
        <td>${gotCell(x)}</td>
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

/* 세금계산서는 1:N 전환 후 exh-drawer.js의 advanceTaxStage/rewindTaxStage가
   따로 다룬다(exhibitors 한 행이 아니라 exhibitor_tax_invoices의 줄 단위라
   이 아래의 범용 advanceStage/rewindStage — exhibitors 전용 — 틀에 맞지 않는다). */
const STAGE_DEFS = { graphic_stage: GRAPHIC_STAGES };
const STAGE_NAME = { graphic_stage: '그래픽' };

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
/* 넘쳤나 — 넘긴 쪽과 얼마나 넘겼는지, 그때 쓴 한도까지 함께 돌려준다.
   한도가 행사별 설정이라 부르는 쪽이 따로 다시 찾지 않아도 되게 같이 준다. */
export function introOver(v, evKey){
  const lim = bookLimit(evKey);
  const c = introLen(v), w = introWords(v);
  const over = [];
  if(c > lim.chars) over.push(`${c - lim.chars}자`);
  if(w > lim.words) over.push(`${w - lim.words}단어`);
  return { chars: c, words: w, over, isOver: over.length > 0, lim };
}

const BOOK_FIELDS = [
  ['book_address', '주소'],
  ['book_phone',   '연락처'],
  ['book_website', '웹사이트'],
];

/* 도록에 실을 이름. 안 적었으면 CRM 이름을 쓴다 — 대부분 같아서, 56줄을
   다 채우게 하면 옮겨 적는 일만 늘고 오타가 는다. 다른 곳만 적으면 된다. */
export const bookName = (x) => ({
  ko: String(x.book_name_ko || '').trim() || exhNames(x).ko,
  en: String(x.book_name_en || '').trim() || exhNames(x).en,
  custom: !!(String(x.book_name_ko || '').trim() || String(x.book_name_en || '').trim()),
});

/* 간판에 넣을 상호 — 영문이다. 따로 안 적으면 도록 영문명을 그대로 쓴다.
   같은 이름을 두 번 적게 하면 한쪽만 고쳐지고, 개막날 간판과 도록의 상호가
   다르게 된다.

   국문으로 되돌리지 않는다. 영문명이 없으면 빈 값을 내보내 화면이 «영문명 없음»
   으로 잡게 한다 — 국문을 대신 넣으면 그 부스만 한글 간판이 걸리는데, 그건
   붙이고 나서야 보인다. */
export const fasciaName = (x) => String(x.fascia_name || '').trim() || bookName(x).en;

/* 도록에 낼 정보를 다 채웠나 — 빠진 칸을 모아 알려준다 */
export function bookMissing(x){
  const miss = [];
  if(x.book_logo !== 'yes') miss.push('로고');
  BOOK_FIELDS.forEach(([f, l]) => { if(!String(x[f] || '').trim()) miss.push(l); });
  if(!introLen(x.book_intro)) miss.push('회사소개');
  return miss;
}

/* ══════════════════════════════════════════
   도록 순번 — 번호 하나에 자리 하나

   순번을 그냥 적게 두면 두 기업이 같은 번호를 갖거나(지금 1번이 둘이다),
   중간이 비거나(18번이 없다), 인쇄소에 넘길 때 순서가 안 정해진다. 순번은
   값이 아니라 줄 세우기라, 하나를 옮기면 나머지가 밀려야 한다.

   그래서 목록 전체를 1..N으로 다시 매긴다. 지금 보이는 줄만이 아니라 이 행사
   참가기업 전부가 대상이다 — 검색으로 걸러 둔 채 3번으로 옮겼는데 화면 밖
   3번이 그대로면, 인쇄 직전에야 겹친 걸 알게 된다.
══════════════════════════════════════════ */

/* 지금 저장된 값이 만드는 줄 세우기. 번호가 없는 곳은 뒤로 보내되 부스 순으로
   둔다 — 새로 들어온 곳이 목록 맨 앞에 끼어들면 매번 다시 세워야 한다. */
export function bookSeq(evKey){
  return [...activeExhibitors(evKey)].sort((a, b) => {
    const ao = Number(String(a.book_order || '').replace(/[^0-9]/g, '')) || 0;
    const bo = Number(String(b.book_order || '').replace(/[^0-9]/g, '')) || 0;
    if(ao !== bo) return (ao || 1e9) - (bo || 1e9);
    return boothSortKey(a) - boothSortKey(b);
  });
}

/* 한 줄을 원하는 자리로 옮기고 전부 다시 매긴다.
   실제로 번호가 달라지는 줄만 저장한다 — 56줄을 통째로 보내면 바뀌지도 않은
   줄에 수정 기록이 남아 로그에서 진짜 변경을 찾을 수 없다. */
export async function moveBookOrder(id, toPos){
  const x = getExhibitorById(id);
  if(!x) return;
  /* 옮기기 전에 서버 값을 다시 읽는다. 순번은 한 줄만 바꾸는 게 아니라 목록
     전체를 다시 매기는 일이라, 화면에 뜬 값이 낡아 있으면 그 낡은 줄 세우기가
     서버에 통째로 덮어써진다. 실제로 그렇게 52곳이 한 번에 뒤집힌 적이 있다.
     (다른 칸은 자기 칸만 보내니 이 문제가 없다 — 여기서만 다시 읽는다.) */
  await reloadExhibitors();
  const seq = bookSeq(x.event_id);
  const from = seq.findIndex(o => o.id === id);
  if(from < 0) return;

  let to = Math.round(Number(String(toPos).replace(/[^0-9]/g, '')));
  if(!to || isNaN(to)) { renderExh(); return; }          // 숫자가 아니면 되돌린다
  to = Math.min(Math.max(1, to), seq.length) - 1;
  if(to === from) { renderExh(); return; }

  seq.splice(to, 0, ...seq.splice(from, 1));
  const changes = seq
    .map((o, i) => ({ o, no: String(i + 1) }))
    .filter(c => String(c.o.book_order || '') !== c.no);
  if(!changes.length) { renderExh(); return; }

  await saveBookOrders(changes, `${exhNames(x).ko} → ${to + 1}번`);
}

/* 한꺼번에 저장한다. patchExh를 줄마다 부르면 저장할 때마다 화면을 다시 그리고
   수정 기록이 마흔 줄 남는다. 여기서는 화면을 한 번만 그리고 기록도 한 줄이다.
   하나라도 실패하면 전부 되돌린다 — 절반만 밀린 순번은 안 민 것보다 나쁘다. */
async function saveBookOrders(changes, what){
  const backup = changes.map(c => ({ o: c.o, was: c.o.book_order || '' }));
  changes.forEach(c => { c.o.book_order = c.no; });
  refreshExhViews();

  const { saveExhibitor } = await import('../api.js');
  const res = await Promise.all(changes.map(c =>
    saveExhibitor({ id: c.o.id, book_order: c.no, updated_at: td() })));

  if(res.some(r => !r.ok)){
    backup.forEach(b => { b.o.book_order = b.was; });
    refreshExhViews();
    alert('순서 저장에 실패했어요. 원래 순서로 되돌렸습니다.');
    return;
  }
  trackAction('edit', '도록 순서 변경', what,
    `<b>${escapeHtml(what)}</b> — ${changes.length}곳의 순번이 밀렸어요`);
}

/* 겹친 번호와 빈 번호만 없앤다. 지금 보이는 앞뒤는 그대로 두고 번호만 1..N으로
   다시 붙인다 — «순서 자동 매기기»는 부스 순으로 줄을 새로 세우지만, 이건
   사람이 잡아 둔 순서를 건드리지 않는다. */
export async function renumberBook(){
  await reloadExhibitors();          // 위와 같은 이유 — 낡은 줄 세우기로 덮어쓰지 않게
  const seq = bookSeq(exhEvent);
  const changes = seq.map((o, i) => ({ o, no: String(i + 1) }))
    .filter(c => String(c.o.book_order || '') !== c.no);
  if(!changes.length){ alert('번호가 이미 1번부터 빠짐없이 붙어 있어요.'); return; }
  if(!confirm(`${changes.length}곳의 번호가 바뀝니다. 앞뒤 순서는 그대로 두고 번호만 1~${seq.length}번으로 다시 붙일까요?`)) return;
  await saveBookOrders(changes, `번호 정리 1~${seq.length}번`);
}

/* 끌어 옮기기. 줄 전체를 draggable로 두면 기업명을 긁어 복사하려다 끌려가고,
   놓는 순간 드로어가 열린다. 손잡이를 누르고 있는 동안에만 켠다. */
let bookDragId = '';
export function bookDragOn(el){ const tr = el.closest('tr'); if(tr) tr.draggable = true; }
export function bookDragStart(e, id){ bookDragId = id; e.dataTransfer.effectAllowed = 'move'; }
export function bookDragEnd(el){ const tr = el.closest('tr'); if(tr) tr.draggable = false; bookDragId = ''; }
export function bookDragOver(e, el){
  if(!bookDragId) return;
  e.preventDefault();
  el.style.boxShadow = 'inset 0 2px 0 var(--a)';
}
export function bookDragLeave(el){ el.style.boxShadow = ''; }
export async function bookDrop(e, id){
  e.preventDefault();
  const tr = e.currentTarget; if(tr) tr.style.boxShadow = '';
  if(!bookDragId || bookDragId === id) return;
  const seq = bookSeq(exhEvent);
  const target = seq.findIndex(o => o.id === id);
  const from = seq.findIndex(o => o.id === bookDragId);
  if(target < 0 || from < 0) return;
  // 아래로 끌면 놓은 줄의 자리를 차지하고, 위로 끌면 그 앞에 선다
  await moveBookOrder(bookDragId, target + 1);
  bookDragId = '';
}

/* ── 기본 시공 ──
   추가 발주 화면과 나눠 둔 까닭은 성격이 달라서다. 저기는 기업이 신청한 것이라
   안 오면 안 하면 되지만, 여기는 계약에 들어 있어 기업이 조용해도 우리가 만들어
   세워야 한다. 같은 표에 섞으면 "주문 없음"과 "우리가 빠뜨림"이 같아 보인다.

   부스 순으로 세운다 — 간판을 달고 벽면을 붙이는 일이 전시장을 한 바퀴 도는
   일이라, 그 순서대로 있어야 한 번에 끝난다. */
function renderBaseView(list){
  const rows = list.filter(x => baseKind(x));
  if(!rows.length) return emptyView('기본 시공 대상이 없어요 — 기본부스·블록부스·라이팅부스가 있어야 합니다');

  const bk = (x) => { const k = boothSortKey(x); return k === Infinity ? 1e9 : k; };
  rows.sort((a, b) => bk(a) - bk(b));

  const due = dueInfo('calc:base', exhEvent);
  const byKind = (k) => rows.filter(x => baseKind(x) === k);
  const st = (x) => baseState(x);
  const gotN  = rows.filter(x => st(x).state !== 'todo').length;
  const doneN = rows.filter(x => st(x).state === 'done').length;

  const pills = `<span class="pill p-gray">대상 ${rows.length}곳</span>`
    + Object.entries(BASE_KINDS).map(([k, v]) => {
        const g = byKind(k); if(!g.length) return '';
        return `<span class="pill p-blue" title="${escAttr(v.types.join(', '))}">${v.label} ${g.length}</span>`;
      }).join('')
    + `<span class="pill ${gotN === rows.length ? 'p-green' : 'p-amber'}">수령 ${gotN}/${rows.length}</span>`
    + `<span class="pill ${doneN === rows.length ? 'p-green' : 'p-gray'}">작업 완료 ${doneN}/${rows.length}</span>`
    + (due
      ? `<span class="pill ${due.days < 0 ? 'p-red' : due.days <= 7 ? 'p-amber' : 'p-gray'}">수령 마감 ${escapeHtml(due.date)}${
          due.days < 0 ? ` · ${-due.days}일 지남` : due.days === 0 ? ' · 오늘' : ` · D-${due.days}`}</span>`
      : `<span class="pill p-gray" title="설정 › 행사 관리에서 «기본 시공» 마감을 넣으면 남은 날이 표시됩니다">수령 마감 미설정</span>`)
    + (() => { const no = rows.filter(x => baseKind(x) === 'fascia' && !fasciaName(x));
        return no.length ? `<span class="pill p-red" title="${escAttr(no.map(x => exhNames(x).ko).join(', '))}">영문명 없음 ${no.length}</span>` : ''; })()
    + '<span style="font-size:10.5px;color:var(--i5);margin-left:2px">간판은 영문으로 나갑니다 · 추가 발주가 아니라 계약에 들어 있는 것들이에요 — 기업이 조용해도 우리가 만들어 세웁니다</span>';

  /* 받는 것이 무엇인지가 부스 타입마다 달라, 칸 하나에 두 가지를 담는다.
     기본부스는 간판에 넣을 상호를 적는 것 자체가 «받음»이다. */
  const recvCell = (x) => baseKind(x) === 'fascia'
    ? `<input class="fi" style="width:200px;padding:3px 6px;font-size:11.5px${x.fascia_name ? ';font-weight:600' : ''}${
        fasciaName(x) ? '' : ';border-color:var(--re)'}"
        placeholder="${escAttr(bookName(x).en || '게재 영문명이 없어요')}" value="${escAttr(x.fascia_name || '')}"
        title="${escAttr(x.fascia_name ? '간판만 따로 적은 이름이에요'
          : bookName(x).en ? '프로그램북 게재 영문명을 그대로 씁니다 — 간판만 다르면 여기에 적으세요'
          : '게재 영문명이 비어 있어요 — 프로그램북 탭에서 넣거나 여기에 직접 적으세요')}"
        onclick="event.stopPropagation()"
        onchange="setExhField('${escAttr(x.id)}','fascia_name',this.value,'간판명')">`
    : `<input type="date" class="fi" style="width:124px;padding:3px 6px;font-size:11.5px"
        value="${escAttr(x.base_recv_at || '')}" onclick="event.stopPropagation()"
        onchange="setExhField('${escAttr(x.id)}','base_recv_at',this.value,'디자인 수령')">`;

  const dateCell = (x, f, label) => `<input type="date" class="fi" style="width:124px;padding:3px 6px;font-size:11.5px"
    value="${escAttr(x[f] || '')}" onclick="event.stopPropagation()"
    onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr(label)}')">`;

  const noteCell = (x) => `<input class="fi" style="width:100%;min-width:120px;padding:3px 6px;font-size:11.5px"
    placeholder="비고" value="${escAttr(x.base_note || '')}" onclick="event.stopPropagation()"
    onchange="setExhField('${escAttr(x.id)}','base_note',this.value,'기본 시공 비고')">`;

  const mark = (x) => { const s = st(x);
    const c = s.state === 'done' ? 'p-green' : s.state === 'part' ? 'p-amber' : 'p-red';
    return `<span class="pill ${c}">${escapeHtml(s.text || '')}</span>`; };

  if(isMobile()) return viewShell(pills, rows.map(x => {
    const k = baseKind(x);
    return `<div style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:11px 12px;margin-bottom:7px">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:5px">
        <span class="pill p-gray">${x.booth_no ? '부스 ' + escapeHtml(x.booth_no) : '미배정'}</span>
        <span onclick="openExhDr('${escAttr(x.id)}','progress')"
          style="font-size:13px;font-weight:700;flex:1;min-width:0;cursor:pointer">${escapeHtml(exhNames(x).ko)}</span>
        ${mark(x)}
      </div>
      <div style="font-size:11px;color:var(--i4);margin-bottom:4px">${escapeHtml(x.booth_type || '')} · ${escapeHtml(BASE_KINDS[k].label)}</div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <span style="font-size:11px;color:var(--i4);min-width:64px">${escapeHtml(BASE_KINDS[k].recv)}</span>${recvCell(x)}</div>
      ${k === 'fascia' ? `<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <span style="font-size:11px;color:var(--i4);min-width:64px">확정</span>${dateCell(x, 'base_recv_at', '간판명 확정')}</div>` : ''}
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:11px;color:var(--i4);min-width:64px">${escapeHtml(BASE_KINDS[k].done)}</span>${dateCell(x, 'base_done_at', BASE_KINDS[k].done)}</div>
    </div>`;
  }).join(''));

  return viewShell(pills, `<div class="tw"><table><thead><tr>
      <th style="min-width:44px;text-align:right">신청순</th>
      <th style="min-width:56px">부스</th>
      <th style="min-width:150px">기업</th>
      <th style="min-width:120px">부스 타입</th>
      <th style="min-width:78px">해야 할 일</th>
      <th style="min-width:186px">받을 것</th>
      <th style="min-width:130px">확정</th>
      <th style="min-width:130px">우리 작업</th>
      <th style="min-width:88px;text-align:center">상태</th>
      <th style="min-width:140px">비고</th>
    </tr></thead><tbody>
    ${rows.map(x => {
      const k = baseKind(x);
      return `<tr>
        ${applyCell(x)}
        <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(x.booth_no || '—')}</td>
        ${coCell(x, 'progress')}
        <td style="font-size:11px;color:var(--i4)">${escapeHtml(x.booth_type || '')}${
          x.booth_qty && x.booth_qty !== '1' ? ` <span style="color:var(--i5)">×${escapeHtml(x.booth_qty)}</span>` : ''}</td>
        <td><span class="pill p-blue">${escapeHtml(BASE_KINDS[k].label)}</span></td>
        <td>${recvCell(x)}</td>
        <td>${k === 'fascia'
          ? dateCell(x, 'base_recv_at', '간판명 확정')
          : '<span style="font-size:11px;color:var(--i6)">·</span>'}</td>
        <td>${dateCell(x, 'base_done_at', BASE_KINDS[k].done)}</td>
        <td style="text-align:center">${mark(x)}</td>
        <td>${noteCell(x)}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`);
}

/* ── 웹디렉토리 주소 ──────────────────────────────────────────
   프로그램북에 실린 정보를 그대로 보여주는 공개 페이지(backend의 /d/<슬러그>).
   인쇄물에는 이 주소나 QR만 싣는다 — 지면과 달리 인쇄 뒤에도 고칠 수 있다.

   슬러그를 저장해 두지 않고 행사 이름에서 만든다(백엔드 routes/public.js가
   같은 규칙으로 되돌려 찾는다). 규칙이 두 곳에 있는 건 감수한다 — 슬러그
   칸을 만들면 행사를 새로 열 때마다 사람이 채워야 하고, 비면 주소가 죽는다. */
const dirSlug = (v) => String(v || '').toLowerCase().trim()
  .replace(/[^a-z0-9가-힣]+/g, '-')
  .replace(/^-+|-+$/g, '');

export const webDirectoryUrl = (evKey) => {
  const slug = dirSlug(evKey || exhEvent);
  return slug && API_BASE_URL ? `${API_BASE_URL}/d/${slug}` : '';
};

function openWebDirectory(){
  const url = webDirectoryUrl();
  if(!url){ alert('행사를 먼저 고르세요.'); return; }
  window.open(url, '_blank', 'noopener');
}

async function copyWebDirectoryUrl(){
  const url = webDirectoryUrl();
  if(!url){ alert('행사를 먼저 고르세요.'); return; }
  /* 클립보드 API는 https나 localhost에서만 동작한다. 막히면 주소를 띄워
     직접 복사할 수 있게 한다 — 조용히 실패하면 붙여넣기 때 빈 값이 된다. */
  try {
    await navigator.clipboard.writeText(url);
    alert(`주소를 복사했어요.\n\n${url}`);
  } catch (e) {
    prompt('아래 주소를 복사하세요 (Ctrl+C)', url);
  }
}

function renderBookView(list){
  if(!list.length) return emptyView('표시할 기업이 없어요');

  /* 순서를 적어 뒀으면 그 순서로, 없으면 부스 번호순으로 세운다 — 도록은 보통
     부스 배치 순으로 싣기 때문에 그게 기본값으로 쓸 만하다. */
  const rows = [...list].sort((a, b) => {
    const ao = Number(String(a.book_order || '').replace(/[^0-9]/g, '')) || 0;
    const bo = Number(String(b.book_order || '').replace(/[^0-9]/g, '')) || 0;
    // 순번이 같은 자리가 실제로 있다 — 한 부스를 나눠 쓰는 두 기관이 도록에는
    // 각각 실리면서 번호는 하나로 받아 온다(39-1 서울대·39-2 분당서울대).
    // 그대로 두면 둘의 앞뒤가 그때그때 달라져 교정 볼 때마다 순서가 바뀐다.
    if(ao !== bo) return (ao || 1e9) - (bo || 1e9);
    return boothSortKey(a) - boothSortKey(b);
  });

  /* 번호가 겹치는 순번 — 실수인지 일부러인지 화면에서 알 수 있어야 한다 */
  const dupOrders = (() => {
    const c = {};
    rows.forEach(x => { const o = String(x.book_order || '').trim(); if(o) c[o] = (c[o] || 0) + 1; });
    return new Set(Object.keys(c).filter(k => c[k] > 1));
  })();

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
    + (dupOrders.size ? `<span class="pill p-amber" title="${escAttr([...dupOrders].map(o =>
        `${o}번: ${rows.filter(r => String(r.book_order || '').trim() === o).map(r => exhNames(r).ko).join(' · ')}`).join(' / '))}">겹친 순번 ${dupOrders.size}</span>` : '')
    + `<span style="font-size:10.5px;color:var(--i5);margin-left:2px">한도 ${bookLimit().chars.toLocaleString()}자 · ${bookLimit().words}단어 (띄어쓰기 포함)</span>`;

  const actions = `<button class="btn bs" onclick="fillBookOrder()" title="지금 부스 번호순으로 1번부터 다시 매깁니다">순서 자동 매기기</button>`
    + `<button class="btn bs" onclick="renumberBook()" title="겹치거나 빈 번호를 지금 순서 그대로 1번부터 다시 매깁니다">번호 정리</button>`
    + `<button class="btn bs" onclick="openWebDirectory()" title="여기 있는 정보로 만든 공개 페이지를 새 창에서 엽니다 — 로그인 없이 누구나 열립니다">웹디렉토리 열기</button>`
    + `<button class="btn bs" onclick="copyWebDirectoryUrl()" title="프로그램북에 싣거나 QR로 만들 주소를 복사합니다">주소 복사</button>`;

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
      title="${o.chars}자 / ${o.words}단어 · 한도 ${o.lim.chars}자 · ${o.lim.words}단어${
        o.isOver ? ` — ${o.over.join(', ')} 초과` : ''}">${o.chars}자${
        o.isOver ? ` <b>+${o.over[0]}</b>` : ''}</span>`;
  };

  if(isMobile()) return viewShell(pills, rows.map(x => {
    const miss = bookMissing(x);
    return `<div onclick="openExhDr('${escAttr(x.id)}','book')" style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:11px 12px;margin-bottom:7px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <span class="pill ${dupOrders.has(String(x.book_order || '').trim()) ? 'p-amber' : 'p-gray'}"${
          dupOrders.has(String(x.book_order || '').trim()) ? ' title="같은 순번을 쓰는 기업이 또 있어요 — 한 부스를 나눠 쓰는 경우입니다"' : ''
        }>${escapeHtml(x.book_order || '-')}${dupOrders.has(String(x.book_order || '').trim()) ? ' ⚠' : ''}</span>
        <span style="font-size:13px;font-weight:700;flex:1;min-width:0">${escapeHtml(bookName(x).ko)}</span>
        ${x.booth_no ? `<span class="pill p-blue">부스 ${escapeHtml(x.booth_no)}</span>` : ''}
      </div>
      ${bookName(x).en ? `<div style="font-size:11px;color:var(--i4);margin-bottom:3px">${escapeHtml(bookName(x).en)}</div>` : ''}
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

  /* 안 적은 칸에는 CRM 이름을 흐리게 미리 보여 준다 — 빈칸이면 도록에 이름이
     안 나가는 줄 알고, 같은 이름을 56번 옮겨 적게 된다. 다른 곳만 고치면 된다. */
  const nameCell = (x, f, shown, label) => `<td><input class="fi"
    style="width:164px;padding:3px 5px;font-size:11.5px${x[f] ? ';font-weight:600' : ''}"
    value="${escAttr(x[f] || '')}" placeholder="${escAttr(shown || '')}"
    title="${escAttr(x[f] ? '직접 적은 이름이에요' : 'CRM 이름을 그대로 씁니다 — 다르면 여기에 적으세요')}"
    onclick="event.stopPropagation()"
    onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr(label)}')"></td>`;

  /* 걸러 놓은 채로 끌어 옮기면, 화면 밖 줄과의 앞뒤를 사람이 알 수 없다.
     번호를 적는 건 "전체에서 몇 번째"라는 뜻이라 걸러도 뜻이 분명하지만,
     끌어 옮기기는 보이는 줄끼리의 앞뒤라서 그렇지 않다. */
  const full = rows.length === activeExhibitors(exhEvent).length;

  return viewShell(pills, `<div class="tw"><table><thead><tr>
      ${full ? '<th style="width:22px" title="끌어서 순서를 바꿀 수 있어요"></th>' : ''}
      <th style="min-width:48px">순서</th>
      <th style="min-width:44px;text-align:center">로고</th>
      <th style="min-width:140px">기업 (CRM)</th>
      <th style="min-width:170px" title="도록과 간판에 실제로 나가는 이름이에요">게재 국문명</th>
      <th style="min-width:170px">게재 영문명</th>
      <th style="min-width:56px">부스</th>
      <th style="min-width:170px">주소</th>
      <th style="min-width:110px">연락처</th>
      <th style="min-width:140px">웹사이트</th>
      <th style="min-width:70px;text-align:center">회사소개</th>
      <th style="min-width:80px">빠진 항목</th>
    </tr></thead><tbody>
    ${rows.map(x => {
      const miss = bookMissing(x);
      const dup = dupOrders.has(String(x.book_order || '').trim());
      return `<tr onclick="openExhDr('${escAttr(x.id)}','book')" style="cursor:pointer"
        ${full ? `ondragstart="bookDragStart(event,'${escAttr(x.id)}')" ondragend="bookDragEnd(this)"
          ondragover="bookDragOver(event,this)" ondragleave="bookDragLeave(this)"
          ondrop="bookDrop(event,'${escAttr(x.id)}')"` : ''}>
        ${full ? `<td style="padding:0 2px;text-align:center" onclick="event.stopPropagation()">
          <span onmousedown="bookDragOn(this)" title="끌어서 옮기기"
            style="cursor:grab;color:var(--i6);font-size:13px;line-height:1;user-select:none">⠿</span></td>` : ''}
        <td><input class="fi" title="번호를 적으면 그 자리로 옮기고 나머지가 한 칸씩 밀려요"
          style="width:42px;padding:3px 5px;font-size:11.5px;text-align:center;font-weight:700${
            dup ? ';border-color:var(--am)' : ''}"
          value="${escAttr(x.book_order || '')}" onclick="event.stopPropagation()"
          onchange="moveBookOrder('${escAttr(x.id)}',this.value)"></td>
        <td style="text-align:center">${logoBtn(x)}</td>
        ${coCell(x, 'book')}
        ${nameCell(x, 'book_name_ko', bookName(x).ko, '게재 국문명')}
        ${nameCell(x, 'book_name_en', bookName(x).en, '게재 영문명')}
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
  await reloadExhibitors();          // 위와 같은 이유 — 낡은 줄 세우기로 덮어쓰지 않게
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
    <span style="color:var(--i5)"> / 한도 ${o.lim.chars.toLocaleString()}자 · ${o.lim.words}단어</span>
    ${bad ? `<div style="color:var(--re);font-weight:700;margin-top:3px">${o.over.join(', ')} 초과 — 줄여야 실립니다</div>`
      : `<div style="color:var(--g);margin-top:3px">지면에 들어갑니다 (${o.lim.chars - o.chars}자 여유)</div>`}`;
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
/* 분류는 행사마다 다르다 — 렌탈사와 출력소가 바뀌면 품목도 분류도 따라 바뀐다.
   비품과 그래픽은 목록을 나눠 둔다. 한 목록에 담아 뒀더니 그래픽 품목을 넣을 때
   '의자·테이블'밖에 안 떠서, 사람이 목록 밖의 값을 손으로 적어 넣었다 —
   그렇게 족자봉·폼보드가 의자와 같은 칸에 섞였다. */
const eqCats = (kind) => kind === 'graphic'
  ? codeList('graphic_cat', exhEvent,
      ['벽면 랩핑', '인포데스크 랩핑', '족자봉', '기타그래픽'].map(c => ({ code: c, label: c })))
  : codeList('equip_cat', exhEvent,
      ['의자', '테이블', '진열대', '가전제품', '기타비품'].map(c => ({ code: c, label: c })));

/* kind는 부른 화면이 정한다 — 비품 현황에서 열면 비품, 그래픽 현황에서 열면
   그래픽. 전에는 어디서 열든 비품으로 저장돼서, 그래픽 품목표에 넣은 줄이
   비품 목록에 나타났다. */
export function openNewCatalogItem(kind){
  if(!exhEvent){ alert('행사를 먼저 선택해주세요.'); return; }
  const isG = kind === 'graphic';
  modalShell('new-eq-modal', isG ? '그래픽 품목 추가' : '품목 추가', `
    <div style="font-size:11.5px;color:var(--i4);margin-bottom:12px;line-height:1.6">
      <b>${escapeHtml(exhEvent)}</b> ${isG ? '그래픽' : '비품'} 품목표에 추가됩니다. 다른 행사에는 영향이 없어요.</div>
    <input type="hidden" id="neq-kind" value="${escAttr(isG ? 'graphic' : 'equip')}">
    <div class="fgr">
      <div class="fg"><label class="fl">분류</label>
        <select class="fi" id="neq-cat">${eqCats(kind).map(c => `<option value="${escAttr(c.code)}">${escapeHtml(c.label)}</option>`).join('')}</select></div>
      <div class="fg"><label class="fl">품목코드</label>
        <input class="fi" id="neq-code" placeholder="비우면 자동 (X-001…)"></div>
    </div>
    <div class="fg"><label class="fl">품명 (국문)</label><input class="fi" id="neq-ko" placeholder="${isG ? '예: 벽면 랩핑 (PVC)' : '예: 접이식 체어'}"></div>
    <div class="fg"><label class="fl">품명 (영문)</label><input class="fi" id="neq-en" placeholder="${isG ? '예: Wall Wrapping' : '예: Folding Chair'}"></div>
    <div class="fg"><label class="fl">규격</label><input class="fi" id="neq-spec" placeholder="${isG ? '예: 970*2390mm/패널' : '예: 500*420*750mmH'}"></div>
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

  const kind = mval('neq-kind') === 'graphic' ? 'graphic' : 'equip';
  let code = mval('neq-code').toUpperCase();
  const used = new Set(catalogFor(exhEvent).map(c => String(c.code || '').toUpperCase()));
  if(code && used.has(code)) return fail(`이미 쓰고 있는 코드예요 — ${code}`);
  if(!code){
    let n = 1;
    const pre = kind === 'graphic' ? 'XG' : 'X';   // 설정 › 품목표와 같은 규칙
    while(used.has(`${pre}-${String(n).padStart(3, '0')}`)) n++;
    code = `${pre}-${String(n).padStart(3, '0')}`;
  }

  const num = (v) => String(v || '').replace(/[^0-9.]/g, '');
  const rec = {
    id: `EC-${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    event_id: exhEvent, kind,
    category: mval('neq-cat') || (kind === 'graphic' ? '기타그래픽' : '기타비품'), code,
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
    note: '', sort_order: nextItemSort(x.id), catalog_id: '',
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
/* 단계 완료 수 — 해당 없는 기업(na)은 분모에서 뺀다.
   부스 도면은 독립부스에만, 그래픽은 주문한 곳에만 해당한다. 전체를 분모로
   두면 51곳 중 18곳짜리 단계가 영영 "0/51"로 남아 늘 밀린 것처럼 보인다. */
/* 집계 알약 하나 — 지금 걸려 있는 쪽을 색과 꼬리표로 알린다 */
function stepPill(s, t){
  const on = stepFil && stepFil.key === s.key;
  const label = escapeHtml(s.label.replace(/<br>/g, ''));
  const cls = on ? (stepFil.mode === 'done' ? 'p-blue' : 'p-amber')
    : t.n === t.of ? 'p-green' : 'p-gray';
  const tip = on ? (stepFil.mode === 'done' ? '완료한 곳만 보는 중 — 한 번 더 누르면 미완료만'
    : '미완료만 보는 중 — 한 번 더 누르면 전체') : '눌러서 완료한 곳만 보기';
  return `<button class="pill ${cls}" title="${escAttr(tip)}"
    style="border:0;cursor:pointer;font:inherit" onclick="setStepFil('${escAttr(s.key)}')">${label} ${
    on ? (stepFil.mode === 'done' ? `${t.n}곳` : `${t.of - t.n}곳`) : `${t.n}/${t.of}`}${
    on ? `<span style="margin-left:3px">${stepFil.mode === 'done' ? '완료' : '미완료'} ✕</span>` : ''}</button>`;
}

export function stepTally(all, step){
  const live = all.filter(x => cellState(x, step).state !== 'na');
  return { n: live.filter(x => cellState(x, step).state === 'done').length, of: live.length };
}

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
    /* 통화가 섞인 건 처리 필요에 넣지 않는다. 인보이스는 원화로 받고 엑스렌탈은
       해외 카드로 결제하는 경우가 있어 정상이다 — 매번 처리하라고 띄우면 정작
       할 일이 묻힌다. 섞여 있다는 사실은 정산 탭과 체크리스트에 그대로 보인다. */
    if(s.state === 'over' || noAmt){
      attention.push({ x, why: s.state === 'over' ? ('초과 입금 ' + fmtMoney(-s.balance, s.cur))
        : '인보이스 금액 미입력' });
    }
  });
  overdue.sort((a, b) => daysSince(b.s.due) - daysSince(a.s.due));

  /* 마감이 걸린 단계 중 아직 못 끝낸 것. 지난 것만 "처리 필요"에 올린다 —
     아직 남은 건 재촉할 일이 아니라 단계별 진행에서 날짜로만 보여준다. */
  const dueMiss = [];
  DUE_STEPS.forEach(([key, label]) => {
    const d = dueInfo(key, exhEvent);
    if(!d || d.days >= 0) return;
    const st = STEPS.find(s => s.key === key);
    if(!st) return;
    all.forEach(x => {
      const c = rawCellState(x, st);
      if(c.state === 'done' || c.state === 'na') return;
      dueMiss.push({ x, label, days: -d.days, date: d.date, tab: DUE_TAB[key] || 'progress' });
    });
  });
  dueMiss.sort((a, b) => b.days - a.days);

  const openInq = [];
  all.forEach(x => openInquiriesFor(x.id).forEach(l => openInq.push({ x, l })));
  openInq.sort((a, b) => String(a.l.ts || '').localeCompare(String(b.l.ts || '')));

  /* 세금계산서·그래픽에서 지금 우리가 움직여야 하는 건. 남에게 넘겨 둔 건
     (재무팀·그래픽팀 확인 중)은 여기 넣지 않는다 — 재촉은 해도 처리는
     우리 손을 떠나 있어서, 섞어 두면 정작 내가 할 일이 묻힌다. */
  const myTurn = [];
  all.forEach(x => {
    [['graphic_stage', GRAPHIC_STAGES, '그래픽']]
      .forEach(([f, defs, label]) => {
        const st = stageOf(defs, x[f]);
        if(st.who !== 'us') return;
        myTurn.push({ x, label, st, days: stageAge(x, defs, f) });
      });
    // 세금계산서는 여러 장일 수 있어 exhibitor_tax_invoices 각 줄을 본다
    taxInvoicesFor(x.id).filter(t => t.status !== 'void').forEach(t => {
      const st = stageOf(TAX_STAGES, t.stage);
      if(st.who !== 'us') return;
      myTurn.push({ x, label: '세금계산서', st, days: st.at && t[st.at] ? daysSince(t[st.at]) : null });
    });
  });
  myTurn.sort((a, b) => (b.days || 0) - (a.days || 0));

  /* 남에게 넘겨 둔 건 — 오래 머물면 재촉해야 하니 따로 센다 */
  const waiting = [];
  all.forEach(x => {
    [['graphic_stage', GRAPHIC_STAGES, '그래픽']]
      .forEach(([f, defs, label]) => {
        const st = stageOf(defs, x[f]);
        if(st.who !== 'team') return;
        waiting.push({ x, label, st, days: stageAge(x, defs, f) });
      });
    taxInvoicesFor(x.id).filter(t => t.status !== 'void').forEach(t => {
      const st = stageOf(TAX_STAGES, t.stage);
      if(st.who !== 'team') return;
      waiting.push({ x, label: '세금계산서', st, days: st.at && t[st.at] ? daysSince(t[st.at]) : null });
    });
  });
  waiting.sort((a, b) => (b.days || 0) - (a.days || 0));

  const avg = Math.round(all.reduce((s, x) => s + progressOf(x), 0) / n);
  const todo = openInq.length + overdue.length + attention.length + myTurn.length + dueMiss.length;
  const curs = Object.keys(cash).filter(c => cash[c].n);   // 상단 KPI(미수금)가 쓰는 값
  const dueTotal = curs.map(c => cash[c].billed - cash[c].paid).reduce((a, b) => a + b, 0);

  const card = (label, value, sub, color) => `<div class="cosi" style="flex:1 1 128px">
    <div class="cosn" style="color:${color || 'var(--i1)'}">${value}</div>
    <div class="cosl">${label}</div>
    ${sub ? `<div style="font-size:9.5px;color:var(--i5);margin-top:2px">${sub}</div>` : ''}</div>`;

  /* ── 돈이 어디까지 왔나 — 전체 → 청구 → 입금 ──

     전체는 신청된 금액 항목을 다 더한 것이고, 청구는 세금계산서를 발행한 금액,
     입금은 실제로 들어온 돈(환불 차감)이다. 세 숫자를 같은 자에 얹어 놓으면
     어디서 막혀 있는지가 길이로 보인다.

     세금계산서를 아직 몇 곳만 발행해서 청구가 입금보다 작을 수 있다. 그건 오류가
     아니라 사실이라 숨기지 않는다 — 대신 몇 곳 발행했는지를 옆에 적어, 작은
     숫자를 보고 계산이 틀렸다고 오해하지 않게 한다. */
  const money3 = (() => {
    const out = {};
    const put = (cur, key, v) => {
      if(!out[cur]) out[cur] = { 전체: 0, 청구: 0, 입금: 0, n: 0, taxN: 0 };
      out[cur][key] += v;
    };
    all.forEach(x => {
      billableItems(x.id).forEach(i => put(i.currency || 'KRW', '전체', num(i.amount)));
      const s = settleState(x);
      // 세금계산서는 이제 줄마다 통화를 갖는다(1:N 전환) — 각 줄 통화를 그대로 쓴다
      let taxTotal = 0;
      taxInvoicesFor(x.id).filter(t => t.status !== 'void').forEach(t => {
        const amt = num(t.amount);
        if(!amt) return;
        put(t.currency || 'KRW', '청구', amt);
        out[t.currency || 'KRW'].taxN++;
        taxTotal += amt;
      });
      if(s.paid) put(s.cur || 'KRW', '입금', s.paid);
      if(s.billed || taxTotal) out[s.cur || 'KRW'].n++;
    });
    return out;
  })();

  const cashRow = (c) => {
    const m = money3[c];
    if(!m || !m.전체 && !m.청구 && !m.입금) return '';
    const base = Math.max(m.전체, m.청구, m.입금) || 1;   // 가장 긴 것을 100%로 삼는다
    const bar = (label, v, color, sub) => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;margin-bottom:2px">
        <span style="color:var(--i4)">${label}${sub ? `<span style="color:var(--i5)"> ${sub}</span>` : ''}</span>
        <span style="font-weight:700;color:${color}">${escapeHtml(fmtMoney(v, c))}</span>
      </div>
      <div class="br" style="margin:0 0 7px">
        <div class="brt"><div class="brf" style="width:${Math.round(v / base * 100)}%;background:${color}"></div></div>
      </div>`;

    const rest = m.전체 - m.입금;
    return `<div style="margin-bottom:12px">
      <div style="font-size:10.5px;color:var(--i4);margin-bottom:4px">${escapeHtml(c)} · ${m.n}곳</div>
      ${bar('전체 금액', m.전체, 'var(--i5)')}
      ${bar('청구한 금액', m.청구, 'var(--a)', `세금계산서 ${m.taxN}곳`)}
      ${bar('입금 완료', m.입금, 'var(--g)')}
      <div style="font-size:10.5px;color:${rest > 0 ? 'var(--am)' : 'var(--g)'}">
        ${rest > 0 ? '남은 금액 ' + escapeHtml(fmtMoney(rest, c)) : '전액 입금'}</div>
    </div>`;
  };

  /* of는 그 단계에 해당하는 기업 수다. 부스 도면은 독립부스에만, 그래픽은
     주문한 곳에만 해당해서 전체(n)를 분모로 두면 영영 100%가 안 된다. */
  const stepRow = (label, done, warn, due, of = n) => {
    const pct = of ? Math.round(done / of * 100) : 0;
    // 마감이 지났는데 다 못 끝냈으면 빨갛게, 남았으면 날짜만 조용히 붙인다
    const late = due && due.days < 0 && done < of;
    return `<div style="display:flex;align-items:center;gap:9px;margin-bottom:7px">
      <span style="font-size:11.5px;color:var(--i3);flex:0 0 74px">${escapeHtml(label)}</span>
      <div style="flex:1;min-width:0">${progressBar(pct, pct === 100 ? 'var(--g)' : late ? 'var(--re)' : 'var(--a)')}</div>
      <span style="font-size:11px;color:var(--i4);flex:0 0 48px;text-align:right">${done}/${of}</span>
      <span style="flex:0 0 66px;text-align:right;font-size:10px;color:${late ? 'var(--re)' : 'var(--i5)'}">${
        due ? escapeHtml(due.date.slice(5)) + (late ? ` ${-due.days}일↑` : '') : ''}</span>
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
            ${ks.map(k => {
              // 타입은 눌러서 그 부스 기업 목록으로 간다 — 센 숫자를 눌렀는데
              // 아무 일이 없으면 셀 수만 있고 쓸 수는 없는 숫자가 된다
              const clickable = f[0] === 'booth_type';
              return `<span class="pill ${f[0] === 'grade' ? gradeCls(k) : clickable ? 'p-blue' : 'p-gray'}"${
                clickable ? ` onclick="setBoothTypeFil('${escAttr(k)}')" style="cursor:pointer" title="${escAttr(k)} 부스 기업 보기"` : ''
              }>${escapeHtml(k)}${f[0] === 'booth_floor' ? '층' : ''} ${cnt[k]}</span>`;
            }).join('')}
          </div></div>`;
      }).join('') || '<div style="font-size:11.5px;color:var(--i5)">아직 부스 정보가 없어요</div>'}
    </div>`;

  const cardSteps = `<div class="uc">
      <div class="uc-ttl">단계별 진행
        <button class="btn" onclick="openExhCfg()" style="float:right;height:24px;font-size:10.5px;padding:0 8px">마감일 설정</button></div>
      ${STEPS.map(st => {
        const live = all.filter(x => rawCellState(x, st).state !== 'na');
        if(!live.length) return '';
        const done = live.filter(x => rawCellState(x, st).state === 'done').length;
        const warn = live.filter(x => rawCellState(x, st).state === 'warn').length;
        return stepRow(st.label.replace(/<br>/g, ''), done, warn, dueInfo(st.key, exhEvent), live.length);
      }).join('')}
      ${Object.keys(eventDeadlines(exhEvent)).length ? '' :
        `<div style="font-size:10.5px;color:var(--i5);margin-top:6px">마감일을 정해 두면 늦은 기업이 처리 필요에 모입니다</div>`}
    </div>`;

  /* 분류별로 얼마어치 신청됐나 — 발주가 분류 단위로 갈린다 */
  const byCat = billedByCategory(all);
  const CAT_ROWS = [['booth', '부스'], ['equip', '비품'], ['graphic', '그래픽'], ['etc', '기타']];
  /* 분류를 세로로, 통화를 가로로 놓는다. 통화별로 표를 따로 그리면 "부스가
     원화로 얼마, 달러로 얼마"를 두 군데서 찾아 맞춰야 한다. 한 줄에서 읽힌다. */
  const catBlock = (() => {
    // 통화 순서를 고정한다 — 원화가 먼저 왔다 나중에 왔다 하면 열이 흔들린다
    const cs = ['KRW', 'USD', ...Object.keys(byCat)]
      .filter((c, i, a) => a.indexOf(c) === i && byCat[c] && byCat[c].합계);
    if(!cs.length) return '';
    const rows = CAT_ROWS.filter(([k]) => cs.some(c => byCat[c][k]));
    const cell = (v, c) => v
      ? escapeHtml(fmtMoney(v, c))
      : '<span style="color:var(--i6)">-</span>';
    const line = (label, get, strong) => `
      <div style="display:grid;grid-template-columns:44px repeat(${cs.length}, 1fr);gap:6px;
        font-size:11.5px;padding:3px 0${strong ? ';font-weight:800;border-top:1px solid var(--i7);margin-top:2px' : ''}">
        <span style="color:var(--i3)">${label}</span>
        ${cs.map(c => `<span style="text-align:right">${get(c)}</span>`).join('')}
      </div>`;

    return `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--i8)">
      <div style="display:grid;grid-template-columns:44px repeat(${cs.length}, 1fr);gap:6px;
        font-size:10px;color:var(--i5);padding-bottom:2px">
        <span>내역</span>${cs.map(c => `<span style="text-align:right">${escapeHtml(c)}</span>`).join('')}
      </div>
      ${rows.map(([k, l]) => line(l, (c) => cell(byCat[c][k], c))).join('')}
      ${line('합계', (c) => cell(byCat[c].합계, c), true)}
    </div>`;
  })();

  /* 부스 타입별 부스 금액 — 시공은 타입 단위로 발주한다. "Block System A가
     몇 곳"까지는 부스 현황에서 보이는데 그게 얼마인지는 어디에도 없었다.
     부스 분류 항목만 센다. 비품·그래픽까지 더하면 타입과 무관한 돈이 섞인다. */
  const boothByType = (() => {
    const t = {};
    all.forEach(x => {
      const k = String(x.booth_type || '').trim() || '(타입 미지정)';
      billableItems(x.id).filter(i => i.category === 'booth').forEach(i => {
        const cur = i.currency || 'KRW';
        if(!t[k]) t[k] = { n: 0, cur: {} };
        t[k].cur[cur] = (t[k].cur[cur] || 0) + num(i.amount);
      });
      if(t[k]) t[k].n = (t[k].n || 0);
    });
    // 기업 수는 금액이 있든 없든 그 타입을 쓰는 곳 전부로 센다
    all.forEach(x => {
      const k = String(x.booth_type || '').trim() || '(타입 미지정)';
      if(t[k]) t[k].n++;
    });
    return t;
  })();

  const typeBlock = (() => {
    /* 금액 큰 순이 아니라 부스 타입 순으로 늘어놓는다. 순서는 설정값의 부스 타입
       목록을 따른다 — 화면마다 순서가 다르면 같은 표를 다시 읽게 되고, 순서를
       바꾸고 싶을 때 코드를 고치지 않아도 된다.
       목록에 없는 타입(옛 데이터)은 뒤에 이름순으로 붙인다. */
    const order = boothTypes(exhEvent).map(t => t.code);
    const rank = (k) => { const i = order.indexOf(k); return i < 0 ? 999 : i; };
    const ks = Object.keys(boothByType).sort((a, b) =>
      rank(a) - rank(b) || a.localeCompare(b, 'ko'));
    if(!ks.length) return '';
    return `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--i8)">
      <div style="font-size:10.5px;color:var(--i4);margin-bottom:4px">부스 타입별 부스 금액</div>
      ${ks.map(k => {
        const m = boothByType[k];
        // 통화 순서를 고정한다 — 줄마다 원화가 먼저 왔다 나중에 왔다 하면 읽기 어렵다
        const amt = ['KRW', 'USD', ...Object.keys(m.cur)]
          .filter((c, i, a) => a.indexOf(c) === i && m.cur[c])
          .map(c => escapeHtml(fmtMoney(m.cur[c], c))).join(' + ') || '-';
        // 타입이 안 정해진 곳은 눌러도 걸 필터가 없다 — 누르는 시늉만 하면 안 된다
        const on = k !== '(타입 미지정)';
        return `<div${on ? ` onclick="setBoothTypeFil('${escAttr(k)}')" title="${escAttr(k)} 기업만 보기" style="cursor:pointer;` : ' style="'}${
          'display:flex;justify-content:space-between;gap:6px;font-size:11.5px;padding:2px 0"'}>
          <span style="color:var(--i3);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(k)}
            <span style="color:var(--i5);font-size:10px">${m.n}곳</span></span>
          <span style="flex:0 0 auto">${amt}</span>
        </div>`;
      }).join('')}
    </div>`;
  })();

  const cardCash = `<div class="uc">
      <div class="uc-ttl">정산 현황</div>
      ${(() => { const ks = Object.keys(money3).filter(c => money3[c].전체 || money3[c].입금);
        return ks.length ? ks.sort().map(cashRow).join('')
          : '<div style="font-size:11.5px;color:var(--i5)">아직 금액 내역이 없어요</div>'; })()}
      ${catBlock}
      ${typeBlock}
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">
        ${STATE_PILLS.filter(p => byState[p[1]]).map(p => `<span class="pill ${p[2]}">${p[0]} ${byState[p[1]]}</span>`).join('')}
      </div>
    </div>`;

  const cardTodo = todo ? `<div class="uc" style="border-left:3px solid var(--am)">
      <div class="uc-ttl">처리 필요 <span class="pill p-amber">${todo}건</span></div>
      ${myTurn.slice(0, 5).map(o => attnRow(o.x, o.label, o.st.action, o.days, o.label === '그래픽' ? 'graphic' : 'billing')).join('')}
      ${openInq.slice(0, 5).map(o => attnRow(o.x, '미답변 문의', o.l.subject || o.l.body || '', daysSince(o.l.ts), 'logs')).join('')}
      ${overdue.slice(0, 5).map(o => attnRow(o.x, '입금 기한', fmtMoney(o.s.balance, o.s.cur) + ' 미납', daysSince(o.s.due), 'billing')).join('')}
      ${dueMiss.slice(0, 8).map(o => attnRow(o.x, o.label + ' 마감', `${o.date} 마감 · 아직 안 됨`, o.days, o.tab)).join('')}
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
    const recent = auditLog.filter(l => names.has(l.target))
      .sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 8);
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
        + (myTurn.length ? ' · 내 차례 ' + myTurn.length : '')
        + (dueMiss.length ? ' · 마감 지남 ' + dueMiss.length : ''),
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
  const keys = prevOrgKeys();
  const backBadge = (x) => isReturning(x, keys)
    ? '<span class="pill p-teal" style="font-size:9px">재참가</span>' : '';
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
    ${renderExhSummary(all)}
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
      ${STEPS.map(s => { const t = stepTally(all, s); return t.of ? stepPill(s, t) : ''; }).join('')}
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
          <span class="pill p-gray">${escapeHtml(x.apply_order || '-')}</span>
          <span style="font-size:14px;font-weight:700${off ? ';text-decoration:line-through' : ''}">${escapeHtml(exhNames(x).ko)}</span>${
            isBookOnly(x) ? '<span class="pill p-teal">프로그램북만</span>' : ''}${
            exhNames(x).en ? `<span style="font-size:11px;color:var(--i4);font-weight:400">${escapeHtml(exhNames(x).en)}</span>` : ''}
          ${off ? '<span class="pill p-gray">참가 취소</span>' : ''}
          ${backBadge(x)}
          ${x.grade && x.grade !== 'Exhibitor' ? `<span class="pill ${gradeCls(x.grade)}">${escapeHtml(x.grade)}</span>` : ''}
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
        ${(() => {
          if(!billed) return '';
          // 통화가 둘이면 줄을 나눠 둘 다, 하나면 그대로 한 줄
          const st = settleByCurrency(x.id);
          const sc = Object.keys(st).filter(c => st[c].billed || st[c].paid).sort();
          if(sc.length < 2) return `<div style="font-size:11.5px;margin-bottom:7px">
            입금 <b style="color:${paid >= billed ? 'var(--g)' : 'var(--am)'}">${fmtMoney(paid, cur)}</b>
            <span style="color:var(--i5)"> / ${fmtMoney(billed, cur)}</span></div>`;
          return `<div style="font-size:11.5px;margin-bottom:7px">
            ${sc.map(c => `<div>입금 <b style="color:${st[c].balance <= 0 ? 'var(--g)' : 'var(--am)'}">${fmtMoney(st[c].paid, c)}</b>
              <span style="color:var(--i5)"> / ${fmtMoney(st[c].billed, c)}</span></div>`).join('')}
            <div style="font-size:10px;color:var(--i5)">결제 수단이 달라 통화가 갈렸어요</div>
          </div>`;
        })()}
        <div style="display:flex;flex-wrap:wrap;gap:4px">${STEPS.map(s => stat(x, s)).join('')}</div>
      </div>`;
    }).join('')}
    ${!list.length ? '<div class="empty" style="padding:30px;text-align:center;font-size:12px;color:var(--i4)">조건에 맞는 기업이 없어요</div>' : ''}
  </div>`;
}

function renderChecklistTable(list, all){
  /* 지난 행사에도 왔던 곳에만 배지를 단다. 신규에는 달지 않는다 —
     51줄 중 20줄에 배지가 붙으면 배지가 아니라 배경이 된다. */
  const keys = prevOrgKeys();
  const backBadge = (x) => isReturning(x, keys)
    ? `<span class="pill p-teal" style="font-size:9px" title="${escAttr(keys.prev)}에도 참가한 기업이에요">재참가</span>` : '';
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

  const stats = STEPS.map(s => ({ step: s, ...stepTally(all, s) })).filter(s => s.of);

  return `<div style="padding:0 16px 16px">
    ${renderExhSummary(all)}
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin:12px 0">
      ${stats.map(s => stepPill(s.step, s)).join('')}
    </div>
    <div class="tw"><table><thead><tr>
      <th style="min-width:44px;text-align:right">신청순</th>
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
        ${applyCell(x)}
        <td><div style="display:flex;align-items:center;gap:5px">
              <span style="font-weight:700;font-size:12px${off ? ';text-decoration:line-through' : ''}">${escapeHtml(exhNames(x).ko)}</span>${
                exhNames(x).en ? `<span style="font-size:10.5px;color:var(--i4);margin-left:4px">${escapeHtml(exhNames(x).en)}</span>` : ''}
              ${off ? '<span class="pill p-gray">참가 취소</span>' : ''}
              ${isBookOnly(x) ? `<span class="pill p-teal" title="${escAttr(bookOnlyTip(x))}">프로그램북만</span>` : ''}
              ${backBadge(x)}
              ${x.grade && x.grade !== 'Exhibitor' ? `<span class="pill ${gradeCls(x.grade)}">${escapeHtml(x.grade)}</span>` : ''}
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
          /* 통화가 둘이면 둘 다 적는다. 하나면 통화 표시 없이 그대로 둔다 —
             대부분이 원화라, 다 붙이면 읽을 게 늘기만 한다. */
          const st = settleByCurrency(x.id);
          const sc = Object.keys(st).filter(c => st[c].billed || st[c].paid).sort();
          const two = sc.length > 1;
          return `<td style="text-align:right;font-size:11px">
            ${two ? sc.map(c => `<div><span style="font-size:9px;color:var(--i5);margin-right:2px">${escapeHtml(c)}</span>
                <span style="font-weight:700;color:${st[c].balance <= 0 ? 'var(--g)' : 'var(--i2)'}">${money(st[c].paid)}</span>
                <span style="color:var(--i5)"> / ${money(st[c].billed)}</span></div>`).join('')
            : `<span style="font-weight:700;color:${col}">${s.cur==='USD'?'$':''}${money(s.paid)}</span>
            <span style="color:var(--i5)"> / ${money(s.billed)}</span>`}
            ${s.state==='over' ? `<div style="font-size:9.5px;color:var(--re)">초과 ${fmtMoney(-s.balance, s.cur)}</div>` : ''}
            ${s.state==='settled' ? '<div style="font-size:9.5px;color:var(--g)">완납 처리</div>' : ''}
            ${s.overdue && s.balance>0 ? `<div style="font-size:9.5px;color:var(--am)">기한 ${daysSince(s.due)}일 지남</div>` : ''}
            ${two ? '<div title="인보이스는 원화로 받고 엑스렌탈은 해외 카드로 결제해 통화가 갈릴 수 있어요 — 정상입니다" style="font-size:9px;color:var(--i5)">결제 수단이 달라요</div>' : ''}
          </td>`;
        })()}
      </tr>`;
    }).join('')}
    </tbody></table></div>
    ${!list.length ? '<div class="empty" style="padding:30px;text-align:center;font-size:12px;color:var(--i4)">조건에 맞는 기업이 없어요</div>' : ''}
  </div>`;
}

/* ══════════════════════════════════════════
   참가기업 직접 추가

   불러오기는 기업DB에 이미 있는 기업만 데려온다. 행사 도중 새로 신청하는
   기업은 기업DB에도 없어서, 지금까지는 기업DB에서 먼저 만들고 연락처에
   전시참가기업 역할을 붙인 뒤 돌아와 불러와야 했다. 세 화면을 거치는 동안
   기업명 표기가 갈리기도 했다.

   그래서 한 자리에서 둘 다 만든다. 기업DB에 같은 이름이 이미 있으면 새로
   만들지 않고 그 기업에 잇는다 — 여기서 또 만들면 기업DB에 같은 회사가
   두 줄 생기고, 지난 행사 이력이 갈린다.
══════════════════════════════════════════ */
export function openExhAdd(){
  closeExhAdd();
  if(exhLocked()){
    alert('진행 완료된 행사예요.\n설정 › 행사 관리 › 진행 파트에서 "진행 중"으로 되돌리세요.');
    return;
  }
  const pop = document.createElement('div');
  pop.id = 'exh-add-modal';
  pop.className = 'mw on';
  let downOnBg = false;
  pop.addEventListener('mousedown', (e) => { downOnBg = (e.target === pop); });
  pop.addEventListener('click', (e) => { if(e.target === pop && downOnBg) closeExhAdd(); });

  // 신청순은 다음 번호를 미리 넣어 둔다 — 새로 신청한 곳이니 대개 맨 뒤다.
  // 고칠 수 있게 열어 두는 건, 늦게 입력했지만 신청은 먼저 받은 경우가 있어서다.
  const next = Math.max(0, ...activeExhibitors(exhEvent)
    .map(x => Number(x.apply_order) || 0)) + 1;

  pop.innerHTML = `<div class="modal" style="max-width:480px">
    <div class="mh"><div class="mt2">참가기업 추가</div>
      <div class="mc">기업DB에 없는 기업도 여기서 바로 등록해요 — 기업DB에도 함께 만들어집니다</div></div>
    <div class="mb">
      <div class="fg"><label class="fl">기업명 (국문) *</label>
        <input class="fi" id="exh-add-ko" placeholder="예) 주식회사 블룸" autocomplete="off"></div>
      <div class="fg"><label class="fl">기업명 (영문)</label>
        <input class="fi" id="exh-add-en" placeholder="예) Bloom Co., Ltd." autocomplete="off"></div>
      <div class="fg"><label class="fl">국가</label>
        <input class="fi" id="exh-add-country" placeholder="비우면 국내로 봅니다" autocomplete="off"></div>
      <div class="fg"><label class="fl">신청순</label>
        <input class="fi" id="exh-add-order" value="${next}" inputmode="numeric"></div>
      <div id="exh-add-msg" style="font-size:11.5px;color:var(--i4);min-height:16px"></div>
    </div>
    <div class="mf2">
      <button class="btn" onclick="closeExhAdd()">취소</button>
      <button class="btn bp" onclick="confirmExhAdd()" id="exh-add-btn">추가</button>
    </div></div>`;
  document.body.appendChild(pop);
  document.getElementById('exh-add-ko')?.focus();
}
export function closeExhAdd(){ document.getElementById('exh-add-modal')?.remove(); }

export async function confirmExhAdd(){
  const v = (id) => String(document.getElementById(id)?.value || '').trim();
  const msg = document.getElementById('exh-add-msg');
  const say = (t, bad) => { if(msg){ msg.textContent = t; msg.style.color = bad ? 'var(--re)' : 'var(--i4)'; } };

  const nameKo = v('exh-add-ko'), nameEn = v('exh-add-en');
  const name = nameKo || nameEn;
  if(!name) return say('기업명을 입력해주세요.', true);

  const key = normalizeCompanyKey(name);
  const dupExh = exhibitorsForEvent(exhEvent).find(x => x.company_key === key);
  if(dupExh) return say(`이미 이 행사에 등록된 기업이에요 — ${exhNames(dupExh).ko}`, true);

  const btn = document.getElementById('exh-add-btn');
  if(btn){ btn.disabled = true; btn.textContent = '추가 중…'; }
  const fail = (t) => { if(btn){ btn.disabled = false; btn.textContent = '추가'; } say(t, true); };

  /* ① 기업DB — 같은 이름이 있으면 그 기업을 쓴다.
     createOrg는 중복이면 ok:false와 함께 그 기업(org)을 돌려준다. */
  let orgId = '';
  const existing = findOrgByName(name, normalizeCompanyKey);
  if(existing){
    orgId = existing.id;
    say(`기업DB에 이미 있는 «${orgName(existing)}»에 이어 붙였어요.`);
  } else {
    const r = await createOrg({
      nameKo, nameEn, kind: '전시참가기업',
      country: v('exh-add-country'),
      notes: `${exhEvent} 전시 참가기업으로 등록`,
    });
    if(!r.ok && !r.org) return fail(r.error || '기업DB 등록에 실패했어요.');
    orgId = r.ok ? r.id : r.org.id;
  }

  /* ② 전시 참가기업 — 이름은 기업DB에 넣은 그대로 쓴다. 여기서 다르게 적으면
     같은 회사가 화면마다 다른 이름으로 보인다. */
  const rec = {
    event_id: exhEvent, org_id: String(orgId || ''),
    company_key: key, company_name: nameKo || nameEn,
    status: '준비중', apply_order: v('exh-add-order'), updated_at: td(),
  };
  const res = await batchCreateExhibitors([rec]);
  if(!res.ok) return fail('전시 등록에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');

  await reloadExhibitors();
  await reloadOrgs();
  closeExhAdd();
  buildExhEvList();
  renderExh();
  trackAction('add', '전시 참가기업 추가', name,
    `<b>${escapeHtml(name)}</b>를 ${escapeHtml(exhEvent)} 참가기업으로 추가${
      existing ? ' (기업DB의 기존 기업에 연결)' : ' — 기업DB에도 새로 등록'}`);
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
  // 여기서는 고른 행사가 지금 보고 있는 행사와 다를 수 있어 따로 본다
  if(evPartDone(evKey, 'exh')){
    alert('진행 완료된 행사에는 참가기업을 넣을 수 없어요.\n설정 › 행사 관리 › 진행 파트에서 "진행 중"으로 되돌리세요.');
    return;
  }
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
export async function reloadExhibitors(){
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
  scope:'참가 범위', host_key:'대표 기업',
  book_name_ko:'게재 국문명', book_name_en:'게재 영문명',
  fascia_name:'간판명', base_recv_at:'간판명 확정·디자인 수령',
  base_done_at:'간판 제작·출력 완료', base_note:'기본 시공 비고',
  builder:'시공사명', builder_contact:'시공 담당자', builder_tel:'시공사 유선', builder_mobile:'시공사 휴대폰', builder_email:'시공사 이메일',
  grade:'등급', booth_confirmed:'부스 확정', booth_confirmed_at:'부스 확정일',
  settled:'완납 처리', settled_note:'완납 사유', pay_due_date:'입금 기한',
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
    // 잠금으로 막힌 건 고장이 아니다 — 네트워크를 확인하라고 하면 엉뚱한 데를 본다
    // (가드가 이미 이유를 알렸으므로 여기서 또 띄우지 않는다)
    if(!r.locked) alert('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
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
/* 공동 부스 켜고 끄기 — 어느 쪽을 뺄지는 사람이 정한다. 부스를 대표해 신청한
   쪽이 남고 나머지가 빠지는데, 그건 데이터로 알 수 없다. */
export async function toggleSharedBooth(id){
  const x = getExhibitorById(id);
  if(!x) return;
  const on = !isSharedBooth(x);
  await patchExh(x, { booth_shared: on ? 'yes' : '' },
    on ? '공동 부스 — 부스 수 제외' : '공동 부스 해제');
}

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
window.setGraphicView = setGraphicView;
window.setGraphicFil = setGraphicFil;
window.toggleGraphicKindAll = toggleGraphicKindAll;
window.applyGraphicDue = applyGraphicDue;
window.searchExhM = searchExhM;
window.setBoothTypeFil = setBoothTypeFil;
window.setStepFil = setStepFil;
window.moveBookOrder = moveBookOrder;
window.renumberBook = renumberBook;
window.bookDragOn = bookDragOn;
window.bookDragStart = bookDragStart;
window.bookDragEnd = bookDragEnd;
window.bookDragOver = bookDragOver;
window.bookDragLeave = bookDragLeave;
window.bookDrop = bookDrop;
window.openExhAdd = openExhAdd;
window.closeExhAdd = closeExhAdd;
window.confirmExhAdd = confirmExhAdd;
window.toggleEquipRow = toggleEquipRow;
window.advanceStage = advanceStage;
window.cycleBookLogo = cycleBookLogo;
window.fillBookOrder = fillBookOrder;
window.openWebDirectory = openWebDirectory;
window.copyWebDirectoryUrl = copyWebDirectoryUrl;
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
window.toggleSharedBooth = toggleSharedBooth;
window.setExhDateWithFlag = setExhDateWithFlag;

/* ══════════════════════════════════════════
   행사 설정 모달 — 단계별 마감일 + 프로그램북 글자수 한도

   행사가 바뀌면 마감일도 도록 판형도 바뀐다. 두 가지가 성격은 다르지만 둘 다
   "이 행사는 이렇게 간다"는 약속이라 한 자리에서 정하게 둔다.

   마감일은 행사 공통값이다. 기업마다 따로 봐주는 건 지금 필요가 없고, 있으면
   어느 날짜가 진짜인지 두 군데를 봐야 한다.
══════════════════════════════════════════ */
export function openExhCfg(){
  const cfg = exhCfg(exhEvent);
  const due = cfg.due || {};
  const lim = bookLimit(exhEvent);
  const ev = exhEventOptions().find(e => e.key === exhEvent);

  modalShell('exh-cfg-modal', `${ev ? (ev.short || ev.name) : exhEvent} 설정`, `
    <div style="font-size:11.5px;color:var(--i4);margin-bottom:10px">
      마감일을 지나도록 못 끝낸 기업은 <b>처리 필요</b>에 모이고, 기업리스트 칸이 빨갛게 바뀝니다.
      비워 두면 그 단계는 마감을 보지 않습니다.</div>

    ${DUE_STEPS.map(([key, label]) => `
      <div class="fg" style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <label class="fl" style="flex:1;margin:0">${escapeHtml(label)}</label>
        <input class="fi" type="date" id="cfg-due-${escAttr(key)}" style="width:160px"
          value="${escAttr(due[key] || '')}">
      </div>`).join('')}

    <div style="font-size:12px;font-weight:700;color:var(--i2);margin:18px 0 4px">프로그램북 글자수 한도</div>
    <div style="font-size:11.5px;color:var(--i4);margin-bottom:8px">
      도록 지면에 맞춘 회사소개 한도입니다. 둘 중 하나만 넘어도 넘친 것으로 봅니다.
      판형이 바뀌면 여기서 고치면 되고, 이미 받아 둔 소개글은 새 한도로 다시 셉니다.</div>
    <div style="display:flex;gap:10px">
      <div class="fg" style="flex:1"><label class="fl">글자수 (띄어쓰기 포함)</label>
        <input class="fi" type="number" id="cfg-book-chars" value="${escAttr(lim.chars)}" min="1"></div>
      <div class="fg" style="flex:1"><label class="fl">단어수</label>
        <input class="fi" type="number" id="cfg-book-words" value="${escAttr(lim.words)}" min="1"></div>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn" onclick="closeExhCfg()">취소</button>
      <button class="btn bp" onclick="saveExhCfg()">저장</button>
    </div>`);
}

export async function saveExhCfg(){
  const prev = JSON.parse(JSON.stringify(exhCfg(exhEvent)));

  const due = {};
  DUE_STEPS.forEach(([key]) => {
    const v = (document.getElementById(`cfg-due-${key}`)?.value || '').trim();
    if(v) due[key] = v;   // 빈 칸은 아예 안 담는다 — 마감 없음과 빈 문자열을 구분할 필요가 없다
  });

  const chars = Number(document.getElementById('cfg-book-chars')?.value);
  const words = Number(document.getElementById('cfg-book-words')?.value);
  if(!(chars > 0) || !(words > 0)){ alert('글자수·단어수 한도는 1 이상이어야 해요.'); return; }

  const cfg = { ...prev, due, book: { chars, words } };
  setExhCfg(exhEvent, cfg);
  const r = await saveExhCfgToSheet(exhEvent, cfg);
  if(!r.ok){ setExhCfg(exhEvent, prev); return; }   // 실패하면 되돌린다

  // 무엇이 어떻게 바뀌었는지 남긴다 — 마감일은 나중에 "언제부터 이 날짜였나"를
  // 따지게 되는 값이라 결과만 적어 두면 소용이 없다
  const changed = [];
  DUE_STEPS.forEach(([key, label]) => {
    const a = (prev.due || {})[key] || '', b = due[key] || '';
    if(a !== b) changed.push(`${label} ${a || '없음'} → ${b || '없음'}`);
  });
  const pl = prev.book || {};
  if(pl.chars !== chars || pl.words !== words){
    changed.push(`프로그램북 한도 ${pl.chars || BOOK_LIMIT_DEFAULT.chars}자·${pl.words || BOOK_LIMIT_DEFAULT.words}단어 → ${chars}자·${words}단어`);
  }
  if(changed.length) trackAction('edit', '행사 설정 변경', exhEvent, changed.join(' / '));

  closeExhCfg();
  renderExh();
}

export const closeExhCfg = () => document.getElementById('exh-cfg-modal')?.remove();

window.openExhCfg  = openExhCfg;
window.saveExhCfg  = saveExhCfg;
window.closeExhCfg = closeExhCfg;
