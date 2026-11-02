/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-calc.js — 전시 금액·정산·단계 계산 (청구·입금·환불·세금계산서·그래픽 단계, 행사별 설정·마감)
   (modules/exh-tab.js에서 옮겼다 — 탭 화면 파일에 기대지 않게)
═══════════════════════════════════════════════════════════════ */

import { EXH_CFG, EXHIBITORS, API_BASE_URL, currentUser, exhibitorsForEvent, exhEvent, appsFor, getExhibitorById, invoicesFor, liveItemsFor, openInquiriesFor, paymentsFor, taxInvoicesFor } from '../../state.js';
import { resolveDue } from '../../shared/mail/follow-up.js';

/* ══════════════════════════════════════════
   집계 헬퍼 — 여러 화면이 같은 정의를 쓰도록 한곳에 모은다
══════════════════════════════════════════ */
/* 참가 취소된 기업은 지우지 않고 상태로 남긴다 — 왜 빠졌는지 나중에 알 수 있어야 하고,
   그동안 주고받은 문의·정산 기록도 보존해야 하기 때문. 기본 목록과 집계에서는 빠진다. */
export const CANCELLED = '취소';

/* 전시 참가기업으로 취급할 참가 역할 — 데이터에 표기 흔들림이 있어 함께 본다 */
export const EXH_ROLES = ['전시참가기업', '전시기업', '전시참가'];

export function activeExhibitors(evKey){
  return exhibitorsForEvent(evKey).filter(x => x.status !== CANCELLED);
}

/* 서버가 id를 생성하는 일괄 등록 직후에만 쓰는 재조회 — 화면 전체를 다시 그리는
   loadFromSheets 대신 exhibitors만 가볍게 다시 읽는다. */
export async function reloadExhibitors(){
  if(!API_BASE_URL || !currentUser) return;
  const { safeFetch, authHeaders } = await import('../../api.js');
  const rows = await safeFetch(API_BASE_URL + '/api/data?sheet=exhibitors', 'exhibitors', 1, await authHeaders());
  if(Array.isArray(rows)) EXHIBITORS.splice(0, EXHIBITORS.length, ...rows);
}

export const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
export const money = (v) => num(v).toLocaleString('ko-KR');

/* ── 표 안의 칸 치수 ──
   칸마다 폭과 높이를 따로 적어 두면 같은 열에서 글자칸 200px과 날짜칸 124px이
   섞이고, 줄마다 오른쪽 끝이 어긋난다. 열 폭은 표 머리(th)가 정하고 칸은 그
   폭을 채우기만 한다. 알약도 폭을 맞춰야 세로로 줄이 선다.

   드로어도 같은 값을 가져다 쓴다 — 표와 드로어가 다른 치수를 쓰면 같은 항목이
   화면을 옮길 때마다 크기가 달라 보인다. */
export const TCELL = 'width:100%;box-sizing:border-box;height:28px;padding:3px 7px;font-size:11.5px';
export const TPILL = 'min-width:74px;height:22px;justify-content:center';

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
  /* 청구하는 항목만 본다 — 부스 기본 제공(청구 안 함) 줄은 KRW로 들어가 맨 앞에
     서기 때문에, 이걸 보면 해외 기업의 통화가 원화로 잡혀 청구액이 0이 됐다 */
  const src = billableItems(exhId);
  const hit = (src.length ? src : liveInvoices(exhId)).find(r => r.currency);
  return (hit && hit.currency) || 'KRW';
}
/* 센트에서 끊는다 — USD 1,234.10 + 2,000.20이 3234.2999…가 되어 3,234.30을 받으면 «초과 입금»으로 떴다 */
const cents = (v) => Math.round(v * 100) / 100;
const sumIn = (rows, cur) => cents(rows
  .filter(r => (r.currency || 'KRW') === cur)
  .reduce((s, r) => s + num(r.amount), 0));

/* 한 기업에 통화가 섞였는지 — 섞이면 한쪽이 합계에서 빠지므로 화면에 알린다 */
export function mixedCurrency(exhId){
  const cs = new Set([...billableItems(exhId).filter(hasAmount), ...liveInvoices(exhId), ...paymentsFor(exhId).filter(hasAmount)]
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
export const EXRENTAL_CHANNEL = '엑스렌탈';
export const isExrentalApp = (a) => String(a?.channel || '') === EXRENTAL_CHANNEL;

/* 엑스렌탈로 접수된 회차에 달린 금액 — 거기서 직접 청구·수금한 몫이다.
   돈은 우리 입금으로 잡지만(카드 결제와 같다) 인보이스는 엑스렌탈이 낸다.
   그래서 «우리가 발행해야 할 금액»에서만 뺀다 — 청구액에서 빼면 입금과
   어긋나 이번엔 «초과 입금»이 뜬다. */
export function exrentalBilled(exhId){
  const ids = new Set(appsFor(exhId).filter(isExrentalApp).map(a => a.id));
  if(!ids.size) return 0;
  const cur = currencyOf(exhId);
  return sumIn(billableItems(exhId).filter(i => ids.has(String(i.app_id || ''))), cur);
}

/* 우리가 인보이스를 내야 할 항목 — 엑스렌탈 회차 몫은 엑스렌탈이 이미 청구·수금했다.
   발행 금액·양식 줄은 이것만 쓴다(안 빼면 카드로 낸 비품을 기업에 또 청구한다). */
export function ourBillableItems(exhId){
  const ids = new Set(appsFor(exhId).filter(isExrentalApp).map(a => a.id));
  return billableItems(exhId).filter(i => !ids.has(String(i.app_id || '')));
}

export function needsReissue(exhId){
  const inv = liveInvoices(exhId).map(i => i.sent_at || i.created_at || '').filter(Boolean).sort();
  if(!inv.length) return null;
  const last = inv[inv.length - 1];
  // 엑스렌탈 회차는 우리가 다시 낼 인보이스가 없다 — 재발행 사유가 아니다
  const after = appsFor(exhId).filter(a => a.kind !== '최초' && !isExrentalApp(a)
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

  /* 환불한 만큼은 발행을 되돌린 것으로 본다. 인보이스를 보낸 뒤 품목이 취소되면
     그 장을 무효로 돌리지 않고 돈을 돌려준다 — 세금계산서가 이미 나갔거나
     엑스렌탈 카드 결제를 부분 취소한 경우가 그렇다. 발행액에서 환불을 빼지
     않으면 그런 기업은 정산이 다 맞아떨어진 뒤에도 «발행액이 청구액보다 많다»가
     영영 사라지지 않는다(포트리아가 그랬다). 요청만 해 둔 환불은 아직 돌려준
     돈이 아니라서 세지 않는다. */
  const refunded = sumIn(paymentsFor(exhId).filter(hasAmount).filter(isDoneRefund), cur);
  const net = cents(invoiced - refunded);
  /* 엑스렌탈이 직접 발행한 몫은 우리가 낼 장에서 뺀다 — 안 빼면 그 기업은
     정산이 다 맞은 뒤에도 «추가 발행 필요»가 영영 남는다. */
  const external = exrentalBilled(exhId);
  const mine = cents(billed - external);
  return Math.abs(net - mine) < 0.005 ? null
    : { invoiced, refunded, net, billed, external, mine, diff: mine - net, cur };
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
  return cents(paymentsFor(exhId)
    .filter(p => (p.currency || 'KRW') === cur)
    .filter(p => p.kind !== 'refund' || isDoneRefund(p))
    .reduce((s, p) => s + (p.kind === 'refund' ? -num(p.amount) : num(p.amount)), 0));
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

/* 이 기업이 낸 돈의 결제 수단 — 환불은 뺀다(돌려준 돈의 수단은 의미가 없다).
   청구 통화와 같은 통화의 입금만 본다. */
function paidMethodsOf(exhId){
  const cur = currencyOf(exhId);
  return new Set(paymentsFor(exhId).filter(hasAmount)
    .filter(p => p.kind !== 'refund' && (p.currency || 'KRW') === cur)
    .map(p => payGroup(p.method)));
}

/* ══════════════════════════════════════════
   세금계산서가 필요한 곳인가

   세금계산서는 계좌이체로 받는 돈에만 붙는다. 카드로 결제하면 카드사 매출로
   잡혀 우리가 끊을 것이 없다. 그래서 «카드로 완납한 곳»은 아예 대상이 아니다 —
   대상으로 세어 두면 채워지지 않는 숫자가 분모에 영원히 남는다(2026 KIC에서
   7곳이 그랬다).

   반대로 아직 못 받은 곳은 세금계산서가 있어야 돈이 들어온다. 선발행이 곧
   청구 수단이라 «안 한 일»이 아니라 «막고 있는 일»이다. 계좌이체로 이미 받은
   곳은 사후 발행이 남는다.

   아직 안 낸 기업이 나중에 카드로 낼지 계좌로 낼지는 지금 알 수 없다. 필요한
   쪽으로 두고, 카드로 완납되면 그때 저절로 «해당 없음»이 된다.

   kind — issued: 이미 발행함 / na: 대상 아님 / after: 완납, 사후 발행
          pre: 미납, 선발행 / check: 완납인데 결제 수단이 안 적혀 판단 불가
══════════════════════════════════════════ */
export function taxNeed(x){
  const tx = taxInvoicesFor(x.id).filter(t => t.status !== 'void');
  // 한 장이라도 끊었으면 통화·수단과 무관하게 그것부터 보여준다
  if(tx.length) return { kind: 'issued', tx };

  if(currencyOf(x.id) !== 'KRW' && !mixedCurrency(x.id)) return { kind: 'na', why: '외화 청구' };

  const s = settleState(x);
  if(!s.billed) return { kind: 'na', why: '청구 없음' };

  if(s.balance <= 0){
    const ms = paidMethodsOf(x.id);
    /* 수단이 안 적힌 입금으로 완납된 곳은 가르지 않는다. 카드로 밀어 넣으면
       발행해야 할 곳이 조용히 사라지고, 계좌로 밀어 넣으면 없는 일이 생긴다. */
    if(!ms.size || ms.has('etc')) return { kind: 'check', why: '결제 수단 확인' };
    if(!ms.has('bank')) return { kind: 'na', why: '카드 완납' };
    return { kind: 'after', why: '완납 · 사후 발행' };
  }
  return { kind: 'pre', why: s.paid > 0 ? '부분 입금 · 선발행' : '선발행(청구용)' };
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
  /* «완납 처리»(settled=yes)한 기업은 남은 돈을 더 받지 않기로 닫은 것이다 —
     settleState가 'settled'로 보는 것과 맞춰 잔액을 0으로 둔다. 안 그러면
     같은 기업이 한 화면에선 완납, 통화별 표·미수금에선 미납으로 갈린다. */
  const settled = getExhibitorById(exhId)?.settled === 'yes';
  Object.keys(out).forEach(c => { out[c].balance = settled ? 0 : out[c].billed - out[c].paid; });
  return out;
}

/* 이 기업의 입금 기한 — 기업별 지정이 없으면 행사 공통 기한, 그것도 없으면
   인보이스에 적힌 기한을 쓴다. */
export function payDueDate(x){
  if(x.pay_due_date) return x.pay_due_date;
  /* 설정 › 일정의 «입금» 마감은 calc:payment 키로 담긴다. 예전엔 여기서 ev.pay만
     읽어서 행사 공통 기한이 한 번도 걸리지 않았다. */
  const ev = eventDeadlines(x.event_id);
  if(ev['calc:payment'] || ev.pay) return ev['calc:payment'] || ev.pay;
  const withDue = invoicesFor(x.id).filter(i => i.due_date && i.status !== 'void');
  return withDue.length ? withDue.map(i => i.due_date).sort()[0] : '';
}

/* 정산 상태 한 곳에서 판정 — 표·드로어·필터가 같은 기준을 쓴다 */
export function settleState(x){
  const billed = billedAmount(x.id), paid = paidAmount(x.id);
  const cur = currencyOf(x.id);
  const balance = cents(billed - paid);
  const due = payDueDate(x);
  /* 기한이 지났어도 발행한 인보이스만큼 받았다면 밀린 게 아니다 — 남은 돈은
     인보이스를 낸 뒤 늘어난 항목(현장 추가 등)이라 아직 청구하지 않은 것이다.
     그걸 첫 인보이스 기한으로 세어 «59일 지남»이 떴다(서타라, 카달로그 홀더 추가분).
     그쪽은 «추가 발행 필요»가 따로 알린다. */
  const invoiced = sumIn(liveInvoices(x.id), cur);
  const overdue = !!due && daysSince(due) > 0 && (!invoiced || paid < invoiced);
  if(x.settled === 'yes')   return { state:'settled', billed, paid, balance, cur, due, overdue:false };
  if(!billed)               return { state:'none',    billed, paid, balance, cur, due, overdue:false };
  if(paid > billed)         return { state:'over',    billed, paid, balance, cur, due, overdue:false };
  if(paid >= billed)        return { state:'paid',    billed, paid, balance, cur, due, overdue:false };
  if(paid > 0)              return { state:'partial', billed, paid, balance, cur, due, overdue };
  return { state:'unpaid', billed, paid, balance, cur, due, overdue };
}

/* 입금이 남은 기업을 둘로 가른다. 기한이 지난 곳만 챙기면 되고, 행사 뒤 납부로
   미리 합의한 곳(기업별 입금 기한을 행사 뒤로 적어 둔 곳)은 기다리면 된다.
   둘을 «미납» 하나로 묶으면 챙길 곳이 합의된 곳들 사이에 묻힌다.
   기한이 아예 없는 곳은 재촉할 근거가 없으니 «입금 예정»에 둔다. */
export const isOwing = (s) => s.state === 'unpaid' || s.state === 'partial';
export const isOverdue = (s) => isOwing(s) && s.overdue;
export const isWaiting = (s) => isOwing(s) && !s.overdue;

/* 참가 취소 기업 중 돌려줄 돈이 남은 곳. 취소 기업의 청구는 받을 돈이 아니라
   집계에서 빠지지만, 이미 낸 디파짓까지 같이 사라지면 환불할 돈이 화면에서
   없어진다. 환불을 마치면(완료된 환불이 입금을 상쇄) 저절로 빠지고, 돌려주지
   않기로 한 돈은 «위약금으로 남김»(settled=yes)으로 닫는다. */
export function refundDue(x){
  if(x.status !== CANCELLED || x.settled === 'yes') return null;
  const pb = paidBreakdown(x.id);
  return pb.net > 0 ? pb : null;
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

export function daysSince(dateStr){
  if(!dateStr) return 0;
  // 기록 칸은 «날짜 시각»일 수 있다 — 날짜만 본다
  const d = new Date(String(dateStr).slice(0, 10));
  if(isNaN(d)) return 0;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

/* 행사 공통 마감 — 날짜 또는 «D-7»(행사 7일 전). 읽는 쪽은 늘 날짜로 받는다 */
export const eventDeadlines = (evKey) => {
  const raw = exhCfg(evKey).due || {}, out = {};
  Object.keys(raw).forEach(k => { const d = resolveDue(evKey, raw[k]); if(d) out[k] = d; });
  return out;
};
/* ── 덩어리 끝 ── */
