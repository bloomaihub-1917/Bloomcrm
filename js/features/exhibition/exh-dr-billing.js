/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-dr-billing.js — 상세 창 정산 — 금액 항목·인보이스·세금계산서·입금, 디자인 의뢰
   (modules/exh-drawer.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { boothTypes, isBoothGiven, progressBar, refreshExhViews } from '../../modules/exh-tab.js';
import { catalogFor, catalogItem, codeLabel, codeList, exhEvent, invoicesFor, isVoided, itemsFor, openAppFor, paymentsFor, taxInvoicesFor } from '../../state.js';
import { escAttr, escapeHtml, td } from '../../utils.js';
import { CANCELLED, billedAmount, currencyOf, daysSince, eventDeadlines, fmtMoney, invoiceGap, isBillable, isPendingRefund, mixedCurrency, money, needsReissue, paidBreakdown, refundDue, settleState, taxNeed } from './exh-calc.js';
import { exhDrUi } from './exh-drawer-ui.js';
import { sct, switchExhDT, taxStageBar } from '../../modules/exh-drawer.js';
import { ackExhAlert, ackedNote, appMark, appSeqLabel, gapAckToken, reissueAckToken, voidExhItem } from './exh-dr-progress.js';

/* ══════════════════════════════════════════
   2) 정산 — 금액 항목 / 인보이스 / 세금계산서 / 입금

   ── 왜 정산이 읽기 전용인가 ──
   품목이 들어오는 자리는 신청항목이다. 신청서를 받아 회차를 열고, 그 회차에서
   무엇이 늘고 줄었는지가 기록된다. 정산에서도 바로 고칠 수 있으면 그 변경은
   어느 회차에도 안 묶여, 나중에 금액을 설명할 자리가 없어진다.

   다만 신청서를 안 거치는 변경이 실제로 있다 — 기업이 엑스렌탈과 직접 주고받는
   경우다. 그래서 막지 않고, 연필을 눌러야 열리게 한다. 한 번에 한 줄만 연다.
   여러 줄이 한꺼번에 열려 있으면 어디를 고치는 중인지 모른 채 지나간다.
══════════════════════════════════════════ */
/* 지금 열어 둔 줄 — 한 번에 하나. 드로어를 다시 그리면 닫힌다(딴 데를 보다
   돌아왔을 때 잠금이 풀린 채로 남지 않게). */
/* 외화 청구라 접어 둔 세금계산서 칸을 그래도 열어 둔 기업 — 한 곳만.
   드로어를 다시 그리면 유지되고, 다른 기업을 열면 저절로 닫힌다. */
export function openTaxAnyway(id){ exhDrUi.taxOpenFor = id; refreshExhViews(); }

export function editItemRow(id){
  exhDrUi.editingItem = exhDrUi.editingItem === id ? null : id;
  refreshExhViews();
}
export function closeItemEdit(){ exhDrUi.editingItem = null; }

/* ══════════════════════════════════════════
   같은 품목을 한 줄로 묶어 보여주기

   접수 회차마다 줄이 따로 생긴다. 인포데스크 랩핑을 2차에 한 장, 3차에 한 장
   추가하면 88짜리 줄이 두 개 남는다 — 회차를 남기려면 데이터는 그래야 맞다.
   그런데 정산에서 보고 싶은 건 «이 품목 몇 장에 얼마»이지 회차가 아니다.
   지금은 눈으로 더해야 한다.

   그래서 화면에서만 묶는다. 데이터는 그대로 두고, 이름·단가·통화·청구 여부가
   모두 같은 줄만 합쳐 «4 × 88»로 적는다. 하나라도 다르면 합치지 않는다 —
   단가가 다른 걸 합치면 그 줄의 수량과 금액이 서로 안 맞는 수가 된다.

   고칠 때는 회차별로 갈라야 하므로, 묶인 줄을 누르면 원래 줄들이 펼쳐진다.
══════════════════════════════════════════ */
export function toggleItemGroup(key){
  exhDrUi.openItemGroup = exhDrUi.openItemGroup === key ? '' : key;
  refreshExhViews();
}

/* 묶는 기준 — 하나라도 다르면 다른 품목으로 본다. 취소된 줄은 회차별로 남아야
   이력이 되므로 묶지 않는다(취소 여부까지 키에 넣는다). */
const itemGroupKey = (i) => [
  i.category || 'etc', i.name || '', String(i.unit_price || ''),
  i.currency || 'KRW', isBillable(i) ? 'y' : 'n', isVoided(i) ? 'v' : '',
].join('');

function groupSameItems(list){
  const out = [];
  const byKey = {};
  list.forEach(i => {
    const k = itemGroupKey(i);
    if(!byKey[k]){ byKey[k] = { key: k, rows: [] }; out.push(byKey[k]); }
    byKey[k].rows.push(i);
  });
  return out;
}

/* 정산에서 고쳤다는 표 — 이 줄은 신청서가 아니라 여기서 바뀌었다 */
function editMark(i){
  if(!String(i.edited_at || '').trim()) return '';
  return ` <span class="pill p-amber" style="font-size:var(--fs-9)" title="${escapeHtml(
    `정산에서 직접 고침 — ${i.edited_at}${i.edited_by ? ' · ' + i.edited_by : ''}`)}">정산수정</span>`;
}

const editHintRow = (i) => `<div style="grid-column:1/-1;font-size:var(--fs-10_5);color:var(--i4);padding:2px 8px 6px">
  고치면 <b>청구액이 바뀝니다</b> — 이미 인보이스를 보냈다면 차액만큼 한 장 더 발행해야 해요.
  ${i.edited_at ? `지난 수정 ${escapeHtml(i.edited_at)}${i.edited_by ? ' · ' + escapeHtml(i.edited_by) : ''}` : ''}</div>`;

/* ══════════════════════════════════════════ */
const itemCats = () => codeList('item_cat', null,
  [['booth', '부스'], ['equip', '비품'], ['graphic', '그래픽'], ['etc', '기타']]
    .map(([c, l]) => ({ code: c, label: l })));
const catLabel = (c) => codeLabel('item_cat', null, c) || '기타';

/* ══════════════════════════════════════════
   디자인 의뢰 — 코드는 하나, 대상은 따로

   부스 디자인 의뢰는 품목코드를 하나로 통일했다(G-130). 대상마다 코드를 나누면
   "디자인 의뢰 올해 몇 건·얼마"를 세는 단위가 흩어진다.

   대신 무엇을 디자인했는지는 항목의 note에 적는다. 이름에 붙이면 자유 텍스트라
   표기가 흔들리고("블록시스템 C" / "블록 C" / "Block System C"), 나중에 대상별로
   모아 볼 수 없다. 부스 타입과 품목표에서 골라 넣게 해 정본을 쓰게 한다.

   판별은 카탈로그의 분류로 한다 — 코드를 코드에 박아 두면 디자인 품목이 늘 때
   또 고쳐야 한다.
══════════════════════════════════════════ */
const DESIGN_CAT = '디자인';
export const isDesignItem = (i) => {
  /* 부스 기본 제공으로 깔린 줄은 빼고 본다 — 분류가 «디자인»인 품목 중에는
     계약에 들어 있는 출력분(G-131)이 섞여 있어서, 그것까지 의뢰로 보면
     블록·라이팅 부스마다 «무엇을 디자인했나» 칸이 따라붙는다. */
  if(isBoothGiven(i)) return false;
  const c = i.catalog_id ? catalogItem(i.catalog_id) : null;
  return !!c && (c.category || '') === DESIGN_CAT;
};

/* 고를 수 있는 대상 — 부스 타입과 품목표를 함께 준다.
   부스 디자인이 대부분이지만 벽면 랩핑·족자봉 디자인도 의뢰가 온다.
   디자인 품목 자체는 제 자신을 대상으로 고를 일이 없어 뺀다. */
function designTargets(evKey){
  const out = [];
  boothTypes(evKey).forEach(t => out.push(t.code));
  catalogFor(evKey).forEach(c => {
    if((c.category || '') === DESIGN_CAT) return;
    const nm = c.name_ko || c.name_en;
    if(nm) out.push(`${c.code} ${nm}`);
  });
  return [...new Set(out)];
}

const designTargetList = (x) => `<datalist id="dsgt-${escAttr(x.id)}">${
  designTargets(x.event_id).map(v => `<option value="${escapeHtml(v)}"></option>`).join('')}</datalist>`;

/* 항목 줄 아래에 한 줄 더 — 칸이 일곱으로 고정된 격자를 건드리지 않는다 */
const designTargetRow = (x, i) => !isDesignItem(i) ? '' : `
  <div style="display:flex;gap:8px;align-items:center;padding:0 8px 7px;background:var(--i9);
      border-radius:0 0 6px 6px;margin-top:-1px">
    <span style="font-size:var(--fs-10_5);color:var(--i5);flex:0 0 auto">무엇을 디자인했나</span>
    <input class="fi" list="dsgt-${escAttr(x.id)}" value="${escapeHtml(i.note || '')}"
      placeholder="부스 타입이나 품목을 고르세요 — 예: Block System C 1부스"
      style="flex:1;min-width:0;padding:4px 8px;font-size:var(--fs-11_5)"
      onchange="setItemField('${escAttr(i.id)}','note',this.value)">
  </div>`;

const currencies = () => codeList('currency', null,
  ['KRW', 'USD'].map(c => ({ code: c, label: c }))).map(c => c.code);

/* 항목을 추가하면 드로어가 다시 그려지면서 분류 선택이 첫 값(부스)으로 되돌아갔다.
   비품을 열 줄 연달아 넣을 때 매번 다시 골라야 했고, 깜빡하면 비품이 부스로
   저장돼 발주 집계에서 통째로 빠졌다(실제로 겪었다). 마지막에 고른 값을 기억해
   그대로 둔다.

   통화는 조금 다르다. 기본값(그 기업의 주 통화)이 대체로 맞아서, 사람이 직접
   바꿨을 때만 기억한다 — 안 그러면 한 번 USD를 쓴 뒤 다른 기업으로 옮겨도
   계속 USD가 따라붙는다. */
export function rememberItemCat(v){ exhDrUi.lastItemCat = v || null; }

/* 분류를 바꾸면 고를 수 있는 목록도 바뀐다. 적어 둔 이름은 지우지 않는다 —
   분류만 잘못 골랐다가 되돌리는 일이 잦고, 그때마다 다시 치게 하면 안 된다. */
export function swapItemList(exhId, cat){
  const el = document.getElementById('it-nm-' + exhId);
  if(!el) return;
  const id = `eqcat-${escAttr(exhId)}-${cat}`;
  if(document.getElementById(id)) el.setAttribute('list', id);
  else el.removeAttribute('list');       // 기타 — 카탈로그 밖이라 고를 목록이 없다
}
export function rememberItemCur(v){ exhDrUi.lastItemCur = v || null; }
/* 분류 단추 — 다시 그리지 않고 그 자리에서 바꾼다. 적어 둔 이름·수량이 날아가지 않게. */
export function markItemCat(exhId, cat){
  document.querySelectorAll(`#it-cats-${CSS.escape(exhId)} [data-cat]`)
    .forEach(b => b.classList.toggle('bp', b.dataset.cat === cat));
}
export function pickItemCat(exhId, cat){
  const input = document.getElementById(`it-cat-${exhId}`);
  if(!input) return;
  // 분류가 바뀌면 전에 고른 품목은 더는 맞지 않는다
  if(input.value !== cat){
    const nm = document.getElementById(`it-nm-${exhId}`);
    if(nm) delete nm.dataset.catalogId;
  }
  input.value = cat;
  rememberItemCat(cat);
  markItemCat(exhId, cat);
  swapItemList(exhId, cat);
  const row = document.getElementById(`it-row-${exhId}`);
  if(row) row.style.display = '';
  document.getElementById(`it-nm-${exhId}`)?.focus();
}

const itemAmount = (i) => Number(String(i.amount || '').replace(/[^0-9.-]/g, '') || 0);

/* 통화는 줄마다 다르다. 전에는 저장할 때 그 기업의 주 통화를 그대로 붙였는데,
   부스는 달러로 받고 비품은 원화로 받는 기업이 실제로 있어서 한 번 잘못 붙으면
   고칠 방법이 없었다 — 줄에서 바로 고르게 한다. */
const curSelect = (cur, onchange) =>
  `<select class="fi bl-cur" onchange="${onchange}" title="통화">
    ${currencies().map(c => `<option value="${c}"${(cur || 'KRW') === c ? ' selected' : ''}>${c}</option>`).join('')}
  </select>`;

/* 통화별로 더한다. 한 기업 안에서도 부스는 달러, 비품은 원화처럼 섞이는 일이
   실제로 있어서(포트리아 등) 한 숫자로 합치면 거짓말이 된다. */
function sumByCurrency(list){
  const by = {};
  list.filter(isBillable).forEach(i => {
    const c = i.currency || 'KRW';
    by[c] = (by[c] || 0) + itemAmount(i);
  });
  return by;
}
/* 청구에서 뺀 항목만 따로 — 얼마가 빠졌는지 보이지 않으면 합계가 틀린 것처럼 보인다 */
function excludedSum(list){
  const by = {};
  list.filter(i => !isBillable(i)).forEach(i => {
    const c = i.currency || 'KRW';
    by[c] = (by[c] || 0) + itemAmount(i);
  });
  return by;
}
/* 통화가 하나면 그대로, 섞였으면 끊어서 적는다 */
const sumText = (by) => {
  // 순서를 통화 목록에 맞춘다 — 줄마다 원화가 먼저 왔다 나중에 왔다 하면
  // 같은 자리 숫자를 비교하기 어렵다
  const ks = [...currencies(), ...Object.keys(by)].filter((k, i, a) => a.indexOf(k) === i && by[k]);
  return ks.length ? ks.map(k => fmtMoney(by[k], k)).join(' + ') : fmtMoney(0, 'KRW');
};

/* 결제 수단 — 설정에서 고친다(code_lists.pay_method).
   계좌이체와 엑스렌탈 카드 결제가 한 덩어리로 보이면 얼마가 어디로 들어왔는지
   알 수 없다. 줄마다 수단을 적고 합계도 갈라 보여준다. */
const payMethods = () => codeList('pay_method', null,
  [['계좌이체', 'p-green'], ['카드(엑스렌탈)', 'p-blue'], ['카드', 'p-blue'], ['외화송금', 'p-green']]
    .map(([c, cls]) => ({ code: c, label: c, cls })));

const payPill = (m) => {
  const t = String(m || '').trim();
  if(!t) return { label: '입금', cls: 'p-gray' };
  const hit = payMethods().find(o => o.code === t);
  return { label: hit ? hit.label : t, cls: hit ? (hit.cls || 'p-green') : 'p-gray' };
};

function dBilling(x){
  /* 목록에는 취소된 줄도 보여준다 — 왜 빠졌는지 여기서 확인해야 한다.
     합계는 살아 있는 것만 센다. */
  /* 딸림 품목은 정산에도 올리지 않는다. 청구액이 0이라 합계는 어차피 같지만,
     «기본»으로 찍힌 줄이 총계 건수를 부풀리고 제외 합계에도 앉아 있어, 무엇을
     빼 주었는지 매번 다시 확인하게 된다. 돈이 오가는 줄만 둔다. */
  const allItems = itemsFor(x.id).filter(i => !isBoothGiven(i));
  const items = allItems.filter(i => !isVoided(i));
  const invs = invoicesFor(x.id);
  const taxes = taxInvoicesFor(x.id);
  const pays = paymentsFor(x.id);
  // 입금과 환불은 성격이 달라 따로 본다 — 환불은 요청/완료 상태까지 따라간다
  const ins = pays.filter(p => p.kind !== 'refund');
  const refunds = pays.filter(p => p.kind === 'refund');
  const pendingRf = refunds.filter(isPendingRefund);
  const st = settleState(x);
  const billed = st.billed, paid = st.paid, rest = st.balance, cur = st.cur;
  const pb = paidBreakdown(x.id);       // 총 입금 / 환불 / 순입금
  const gap = invoiceGap(x.id);         // 인보이스 합계가 금액 항목과 어긋나는지
  const noAmount = invoicesFor(x.id).filter(i => i.status !== 'void' && String(i.amount ?? '').trim() === '');
  const cancelled = x.status === CANCELLED;
  const rfDue = refundDue(x);
  const evPayDue = (() => { const d = eventDeadlines(x.event_id); return d['calc:payment'] || d.pay || ''; })();

  /* 참가 취소 기업의 정산 — 청구는 받을 돈이 아니니 잔액을 재촉하지 않고,
     낸 돈이 남았으면 돌려줄지(환불) 남길지(위약금)만 묻는다. */
  const cancelCard = !cancelled ? '' : `
  <div class="uc" style="margin-bottom:16px">
    <div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:6px">참가 취소 — 청구액은 받을 돈에서 빠졌어요</div>
    <div style="display:flex;justify-content:space-between;font-size:var(--fs-12);padding:2px 0">
      <span style="color:var(--i3)">낸 돈(순입금)</span><b>${escapeHtml(fmtMoney(pb.net, pb.cur))}</b></div>
    ${pb.refunded ? `<div style="display:flex;justify-content:space-between;font-size:var(--fs-11);padding:1px 0">
      <span style="color:var(--i4)">환불 완료</span><span style="color:var(--re)">−${escapeHtml(fmtMoney(pb.refunded, pb.cur))}</span></div>` : ''}
    ${pb.requested ? `<div style="display:flex;justify-content:space-between;font-size:var(--fs-11);padding:1px 0;color:var(--am)">
      <span>보내야 할 환불</span><span>${escapeHtml(fmtMoney(pb.requested, pb.cur))}</span></div>` : ''}
    <div style="font-size:var(--fs-11);margin-top:6px;color:${rfDue ? 'var(--am)' : 'var(--i4)'}">${
      x.settled === 'yes' ? `위약금으로 남김${x.settled_note ? ` — ${escapeHtml(x.settled_note)}` : ''}`
      : rfDue ? `돌려줄지 정해야 할 돈 ${escapeHtml(fmtMoney(pb.net, pb.cur))} — 환불했으면 아래 입금 기록에 «환불»로 남기세요`
      : '낸 돈이 없어 정산할 게 없어요'}</div>
    ${rfDue ? `<div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;align-items:center">
        <input class="fi" id="stl-note-${escAttr(x.id)}" placeholder="사유 (예: 계약상 디파짓 환불 불가)"
          style="flex:1 1 180px;min-width:0;font-size:var(--fs-11);padding:5px">
        <button class="btn bs" style="flex:0 0 auto" onclick="forfeitExh('${escAttr(x.id)}')">위약금으로 남김</button>
      </div>` : ''}
    ${x.settled === 'yes' ? `<div style="margin-top:8px;text-align:right">
      <button class="btn bs" onclick="unsettleExh('${escAttr(x.id)}')">위약금 처리 해제</button></div>` : ''}
  </div>`;

  return `${cancelCard}
  <div class="uc" style="margin-bottom:16px${cancelled ? ';display:none' : ''}">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <span style="font-size:var(--fs-11);color:var(--i4)">청구 / 입금</span>
      <span><b style="font-size:var(--fs-16);color:${paid >= billed && billed > 0 ? 'var(--g)' : 'var(--i1)'}">${cur === 'USD' ? '$' : ''}${money(paid)}</b>
        <span style="color:var(--i5);font-size:var(--fs-13)"> / ${money(billed)}${cur === 'USD' ? '' : '원'}</span></span>
    </div>
    <div style="margin:8px 0 4px">${progressBar(billed ? paid / billed * 100 : 0,
      paid >= billed && billed > 0 ? 'var(--g)' : 'var(--am)')}</div>
    ${/* 순입금 한 숫자만 보면 환불이 있었다는 사실이 사라진다. 통장·카드와 맞출 때는
         들어온 돈과 돌려준 돈이 갈라져 있어야 한다. */''}
    ${pb.refunded || pb.requested ? `<div style="margin:6px 0 2px;padding:6px 8px;background:var(--i9);border-radius:var(--rd-6);font-size:var(--fs-11)">
      <div style="display:flex;justify-content:space-between;padding:1px 0">
        <span style="color:var(--i4)">총 입금</span><span style="color:var(--i2)">${escapeHtml(fmtMoney(pb.gross, cur))}</span></div>
      ${pb.refunded ? `<div style="display:flex;justify-content:space-between;padding:1px 0">
        <span style="color:var(--i4)">환불 완료</span><span style="color:var(--re)">−${escapeHtml(fmtMoney(pb.refunded, cur))}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:2px 0;border-top:1px solid var(--i8);margin-top:3px">
        <span style="color:var(--i3)"><b>순입금</b></span><span style="color:var(--i1)"><b>${escapeHtml(fmtMoney(pb.net, cur))}</b></span></div>
      ${pb.requested ? `<div style="display:flex;justify-content:space-between;padding:1px 0;color:var(--am)">
        <span>보내야 할 환불</span><span>${escapeHtml(fmtMoney(pb.requested, cur))}</span></div>` : ''}
    </div>` : ''}
    ${(() => {
      /* 입금이 어떤 수단으로 얼마씩 들어왔나. 계좌이체와 엑스렌탈 카드 결제가
         한 숫자로 합쳐져 있으면 어느 쪽이 얼마인지 알 수 없다. 수단이 하나뿐이면
         굳이 나누지 않는다 — 대부분은 계좌이체 한 줄이다. */
      const by = {};
      ins.forEach(p => {
        const k = String(p.method || '').trim() || '(수단 미기재)';
        const c = p.currency || 'KRW';
        const v = Number(String(p.amount ?? '').replace(/[^0-9.-]/g, '')) || 0;
        (by[k] = by[k] || {})[c] = (by[k][c] || 0) + v;
      });
      const ks = Object.keys(by);
      if(ks.length < 2) return '';
      return `<div style="margin:6px 0 2px;padding:6px 8px;background:var(--i9);border-radius:var(--rd-6)">
        ${ks.map(k => { const b = payPill(k === '(수단 미기재)' ? '' : k);
          return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:var(--fs-11);padding:1px 0">
            <span class="pill ${b.cls}" style="font-size:var(--fs-9)">${escapeHtml(k === '(수단 미기재)' ? '수단 미기재' : b.label)}</span>
            <span style="color:var(--i2)">${Object.keys(by[k]).map(c => escapeHtml(fmtMoney(by[k][c], c))).join(' · ')}</span>
          </div>`; }).join('')}
      </div>`;
    })()}
    ${mixedCurrency(x.id) ? `<div style="font-size:var(--fs-11);color:var(--i3);background:var(--i9);padding:6px 8px;border-radius:var(--rd-6);margin:6px 0">
      이 기업은 <b>${mixedCurrency(x.id).join(' / ')}</b>가 함께 있어요.
      인보이스는 원화로 받고 엑스렌탈은 해외 카드로 결제하는 경우가 있어 <b>정상</b>입니다.
      위 합계는 <b>${currencyOf(x.id)}</b> 건만 더한 값이니, 나머지는 아래 목록에서 통화별로 확인하세요.</div>` : ''}
    <div style="font-size:var(--fs-11);color:${
      st.state === 'over' ? 'var(--re)' : (rest > 0 ? 'var(--am)' : 'var(--i4)')}">
      ${st.state === 'settled' ? `완납 처리됨${x.settled_note ? ` — ${escapeHtml(x.settled_note)}` : ''}`
        : billed === 0 ? '금액 항목을 추가하거나 인보이스를 발행해주세요'
        : st.state === 'over' ? `초과 입금 ${fmtMoney(-rest, cur)} — 누락된 인보이스가 없는지 확인해주세요`
        : rest > 0 ? `잔액 ${fmtMoney(rest, cur)}` : '완납'}
</div>
    ${/* 입금 기한 — 비워 두면 행사 공통 기한(설정 › 일정 › 입금)을 쓴다. 행사 뒤에
         내기로 미리 합의한 기업은 여기 날짜를 행사 뒤로 적으면 «입금 예정»으로 분류된다. */''}
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:var(--fs-11);margin-top:5px;color:var(--i4)">
      <span>입금 기한</span>
      <input type="date" class="fi" style="width:132px;padding:2px 6px;font-size:var(--fs-11)" value="${escapeHtml(x.pay_due_date || '')}"
        onchange="setExhField('${escAttr(x.id)}','pay_due_date',this.value,'입금 기한')">
      <span style="color:${st.overdue && rest > 0 ? 'var(--re)' : 'var(--i5)'}">${
        !x.pay_due_date ? (st.due ? `행사 공통 기한 ${escapeHtml(st.due)} 적용 중` : '기한 없음 — 재촉 대상에서 빠져요')
        : evPayDue && x.pay_due_date > evPayDue ? `행사 공통(${escapeHtml(evPayDue)})보다 늦게 — 사후 납부 합의`
        : ''}${st.overdue && rest > 0 ? ` · ${daysSince(st.due)}일 지남` : (rest > 0 && st.due ? ' · 입금 예정' : '')}</span>
    </div>
    ${noAmount.length ? `<div style="font-size:var(--fs-11);color:var(--am);margin-top:3px">
      ⚠ 금액이 안 적힌 인보이스 ${noAmount.length}건이 있어 청구액이 실제보다 적을 수 있어요</div>` : ''}
    ${/* 인보이스와 어긋난 금액은 바로 아래 «추가 발행 필요»에서 무엇을 해야 하는지까지
         함께 말한다 — 같은 사실을 두 곳에서 말하면 한 곳만 고치게 된다. */''}
    ${rest !== 0 && billed > 0 && st.state !== 'settled' ? `
      <div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;align-items:center">
        <input class="fi" id="stl-note-${escAttr(x.id)}" placeholder="완납 처리 사유 (예: 송금 수수료 차감)"
          style="flex:1 1 180px;min-width:0;font-size:var(--fs-11);padding:5px">
        <button class="btn bs" style="flex:0 0 auto" onclick="settleExh('${escAttr(x.id)}')">완납으로 닫기</button>
      </div>` : ''}
    ${st.state === 'settled' ? `<div style="margin-top:8px;text-align:right">
      <button class="btn bs" onclick="unsettleExh('${escAttr(x.id)}')">완납 처리 해제</button></div>` : ''}
  </div>

  ${(() => {
    /* 청구액이 바뀌었는데 그만큼 인보이스가 안 나갔다.

       기업이 엑스렌탈과 직접 주고받아 품목이 바뀌면 정산에서 고치게 되는데,
       그러면 이미 보낸 인보이스와 금액이 어긋난다. 그 차액만큼 한 장 더
       보내야 하고, 보냈는지 안 보냈는지를 알 수 있어야 한다.

       «발행함» 표를 따로 두지 않는다 — 그러면 표만 손으로 지우는 일이 생겨서
       실제 금액과 어긋난다. 금액 항목 합계와 발행한 인보이스 합계를 견주면
       발행하는 순간 저절로 사라진다. */
    const sent = invoicesFor(x.id).filter(v => v.status !== 'void');
    const edited = itemsFor(x.id).filter(i => String(i.edited_at || '').trim() && !isVoided(i));
    if(!sent.length || !gap || !gap.diff) return '';
    const more = gap.diff > 0;
    // 확인한 시점의 숫자와 지금이 같으면 덮어 둔다 — 또 바뀌면 스스로 되살아난다
    if(String(x.gap_ack || '') === gapAckToken(gap)) return ackedNote(x, 'gap', '추가 발행 필요');
    return `<div class="uc" style="border-left:3px solid var(--${more ? 're' : 'am'});margin-bottom:10px">
      <div style="font-size:var(--fs-12);font-weight:700;color:var(--${more ? 're' : 'am'})">${
        more ? '추가 발행 필요' : '발행액이 청구액보다 많아요'} ${escapeHtml(fmtMoney(Math.abs(gap.diff), gap.cur))}</div>
      <div style="font-size:var(--fs-11);color:var(--i3);margin-top:4px">
        금액 항목 <b>${escapeHtml(fmtMoney(gap.billed, gap.cur))}</b> ·
        발행한 인보이스 <b>${escapeHtml(fmtMoney(gap.invoiced, gap.cur))}</b>${
        gap.refunded ? ` − 환불 <b>${escapeHtml(fmtMoney(gap.refunded, gap.cur))}</b> = <b>${
          escapeHtml(fmtMoney(gap.net, gap.cur))}</b>` : ''}${
        edited.length ? ` — 정산에서 직접 고친 항목 ${edited.length}건이 있어요` : ''}
      </div>
      ${gap.external ? `<div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:4px">
        엑스렌탈 직접 청구 <b>${escapeHtml(fmtMoney(gap.external, gap.cur))}</b>은 우리가 낼 장에서 이미 뺐어요.</div>` : ''}
      <div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:4px">${
        more ? '차액만큼 한 장 더 발행하면 이 알림은 사라져요 — 아래 인보이스에서 발행하세요.'
             : '옛 인보이스를 무효로 두거나, 금액 항목이 빠지지 않았는지 보세요.'}</div>
      <div style="margin-top:6px;text-align:right">
        <button class="btn bs" onclick="ackExhAlert('${escAttr(x.id)}','gap')"
          title="우리가 낼 장이 아니면 덮어 두세요 — 금액이 또 바뀌면 다시 알려드려요">확인함 · 이 알림 끄기</button></div>
    </div>`;
  })()}

  ${(() => {
    const r = needsReissue(x.id);
    if(r && String(x.reissue_ack || '') === reissueAckToken(r)) return ackedNote(x, 'reissue', '인보이스 발행 뒤 변경');
    return r ? `<div class="uc" style="border-left:3px solid var(--re);margin-bottom:10px">
      <div style="font-size:var(--fs-12);font-weight:700;color:var(--re)">인보이스 발행 뒤에 신청이 바뀌었어요</div>
      <div style="font-size:var(--fs-11);color:var(--i3);margin-top:4px">
        마지막 인보이스 ${escapeHtml(r.last)} 이후 접수 ${r.apps.length}건 —
        ${r.apps.map(a => escapeHtml(`${appSeqLabel(a)} ${a.received_at}${a.reason ? ' (' + a.reason + ')' : ''}`)).join(' · ')}
      </div>
      <div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:4px">청구액이 맞는지 보고, 다르면 옛 인보이스를 무효로 두고 다시 발행하세요.</div>
      <div style="margin-top:6px;text-align:right">
        <button class="btn bs" onclick="ackExhAlert('${escAttr(x.id)}','reissue')"
          title="다시 낼 장이 없으면 덮어 두세요 — 접수가 또 들어오면 다시 알려드려요">확인함 · 이 알림 끄기</button></div>
    </div>` : '';
  })()}

  ${sct('금액 항목', `
    <div style="display:flex;flex-direction:column;gap:1px;margin-bottom:8px">
      ${allItems.length ? itemCats().map(({ code: k, label: l }) => {
        // 분류별로 묶어서 소계를 붙인다 — 부스와 비품이 섞여 있으면 어느 쪽이
        // 얼마인지 세어보기 전엔 알 수 없다. 항목이 없는 분류는 건너뛴다.
        const g = allItems.filter(i => (i.category || 'etc') === k);
        if(!g.length) return '';
        const itemRow = (i) => {
          /* 정산은 보는 자리다. 품목은 신청서 접수(회차)를 거쳐 들어오고, 여기서
             바로 고칠 수 있으면 그 변경은 어느 회차에도 안 묶인다 — 나중에
             «이 금액이 왜 이런가»를 되짚을 자리가 없어진다.

             그래도 고쳐야 할 때가 있다. 기업이 엑스렌탈과 직접 주고받아 바뀌는
             경우다. 그건 신청서를 안 거치니 여기서 고치는 게 맞다. 대신 연필을
             한 번 눌러야 열리고, 고친 것은 기록에 남는다. */
          const open = exhDrUi.editingItem === i.id;
          return `
        <div class="bl-row bl-item" style="padding:6px 8px;background:var(--i9);border-radius:6px${
          open ? ';outline:2px solid var(--a);outline-offset:-2px' : ''}">
          <span class="pill ${isBillable(i) ? 'p-gray' : 'p-amber'}" style="text-align:center;cursor:${open ? 'pointer' : 'default'}"
            ${open ? `onclick="toggleItemBillable('${escAttr(i.id)}')"` : ''}
            title="${open ? (isBillable(i) ? '클릭하면 청구에서 제외합니다' : '청구에서 빠져 있어요 — 클릭하면 되돌립니다')
                          : (isBillable(i) ? '청구에 들어가는 항목이에요' : '청구에서 빠져 있어요')}">${
            isBillable(i) ? escapeHtml(l) : '제외'}</span>
          <span class="bl-nm" style="${
            isVoided(i) ? 'color:var(--i5);text-decoration:line-through' : isBillable(i) ? '' : 'color:var(--i5)'}"
            title="${escapeHtml(i.name || '')}">${escapeHtml(i.name || '')}${appMark(i)}${editMark(i)}</span>
          <span class="bl-qty">${escapeHtml(i.qty || '')}${
            i.unit_price ? `<span class="bl-up">${i.qty ? ' × ' : ''}${money(i.unit_price)}</span>` : ''}</span>
          ${open
            ? `<input class="fi bl-amt-in" value="${escapeHtml(i.amount || '')}" placeholder="금액"
                 onchange="setItemFieldDirect('${escAttr(i.id)}','amount',this.value)">`
            : `<span class="bl-amt-in" style="text-align:right;font-size:var(--fs-12);padding:5px 2px">${
                 i.amount ? escapeHtml(money(i.amount)) : '<span style="color:var(--am)">금액 미입력</span>'}</span>`}
          ${open
            ? curSelect(i.currency, `setItemFieldDirect('${escAttr(i.id)}','currency',this.value)`)
            : `<span style="font-size:var(--fs-11);color:var(--i5);text-align:center">${escapeHtml(i.currency || 'KRW')}</span>`}
          ${open ? `
            <button class="btn bs bl-mini" onclick="voidExhItem('${escAttr(i.id)}')"
              title="${isVoided(i) ? '취소를 되돌립니다' : '취소 처리 — 지우지 않고 내려서 이력이 남아요'}">${isVoided(i) ? '↩' : '⊘'}</button>
            <button class="btn bs bl-mini" onclick="delExhItem('${escAttr(i.id)}')" title="완전히 삭제 — 잘못 넣은 줄에만 쓰세요">✕</button>`
            : `<button class="btn bs bl-mini" onclick="editItemRow('${escAttr(i.id)}')"
                 title="정산에서 직접 고칩니다 — 신청서를 거치지 않은 변경이라 기록에 남아요">✎</button>
               <span></span>`}
        </div>${designTargetRow(x, i)}${open ? editHintRow(i) : ''}`;
        };

        /* 같은 품목이 회차별로 흩어져 있으면 한 줄로 묶어 적는다. 고칠 일이
           생기면 눌러서 회차별 줄을 펼친다 — 고치는 건 회차에 묶여야 한다. */
        return groupSameItems(g).map((gr, gi) => {
          if(gr.rows.length < 2) return itemRow(gr.rows[0]);
          /* 펼침을 기억할 이름 — 품목명을 그대로 쓰면 따옴표가 든 이름에서
             깨진다. 분류와 순번이면 충분하다. */
          const gkey = `${k}#${gi}`;
          const open = exhDrUi.openItemGroup === gkey || gr.rows.some(i => exhDrUi.editingItem === i.id);
          const head = gr.rows[0];
          const qty = gr.rows.reduce((a, i) => a + (Number(i.qty) || 0), 0);
          const amt = gr.rows.reduce((a, i) => a + itemAmount(i), 0);
          return `
        <div class="bl-row bl-item" style="padding:6px 8px;background:var(--i9);border-radius:var(--rd-6);cursor:pointer"
          onclick="toggleItemGroup('${escAttr(gkey)}')"
          title="${open ? '접어서 한 줄로 봅니다' : `회차별로 ${gr.rows.length}줄이에요 — 눌러서 펼치고 고칩니다`}">
          <span class="pill ${isBillable(head) ? 'p-gray' : 'p-amber'}" style="text-align:center">${
            isBillable(head) ? escapeHtml(l) : '제외'}</span>
          <span class="bl-nm" style="${isBillable(head) ? '' : 'color:var(--i5)'}"
            title="${escapeHtml(head.name || '')}">${escapeHtml(head.name || '')}
            <span class="pill p-gray" style="font-size:var(--fs-9)">${open ? '▾' : '▸'} ${gr.rows.length}줄</span></span>
          <span class="bl-qty">${qty || ''}${
            head.unit_price ? `<span class="bl-up">${qty ? ' × ' : ''}${money(head.unit_price)}</span>` : ''}</span>
          <span class="bl-amt-in" style="text-align:right;font-size:var(--fs-12);padding:5px 2px;font-weight:700">${money(amt)}</span>
          <span style="font-size:var(--fs-11);color:var(--i5);text-align:center">${escapeHtml(head.currency || 'KRW')}</span>
          <span></span><span></span>
        </div>` + (open ? gr.rows.map(itemRow).join('') : '');
        }).join('')
        + `<div class="bl-row bl-item bl-subtotal">
            <span></span>
            <span style="min-width:0;font-size:var(--fs-11);color:var(--i4)">${escapeHtml(l)} 소계 <span style="color:var(--i5)">${g.length}건</span></span>
            <span class="bl-qty"></span>
            <span class="bl-amt" style="font-size:var(--fs-12)">${sumText(sumByCurrency(g))}</span>
            <span></span><span></span><span></span>
          </div>`;
      }).join('') : '<div style="font-size:var(--fs-11_5);color:var(--i5);padding:8px 2px">아직 항목이 없어요</div>'}
      ${items.length ? `<div class="bl-row bl-item bl-total">
        <span></span>
        <span style="min-width:0;font-size:var(--fs-12);font-weight:700">총계 <span style="font-weight:400;color:var(--i4)">${items.length}건</span></span>
        <span class="bl-qty"></span>
        <span class="bl-amt" style="font-size:var(--fs-13)">${sumText(sumByCurrency(items))}</span>
        <span></span><span></span><span></span>
      </div>
      ${(() => {
        const ex = excludedSum(items);
        const ks = Object.keys(ex).filter(k => ex[k]);
        return ks.length ? `<div style="font-size:var(--fs-10_5);color:var(--i4);padding:4px 8px 0;text-align:right">
          청구 제외 ${ks.map(k => fmtMoney(ex[k], k)).join(' + ')}
          <span style="color:var(--i5)">— 추가 배지처럼 우리가 청구하지 않는 항목이에요</span></div>` : '';
      })()}` : ''}
    </div>
    <div style="font-size:var(--fs-11);color:var(--i4);padding:6px 2px 0;border-top:1px dashed var(--i7);margin-top:6px">
      항목을 넣고 빼는 건 <b>신청항목</b> 탭의 접수 회차에서 해요 — 그래야 «몇 차에 무엇이 늘었나»가 남습니다.
      ${openAppFor(x.id)
        ? `<button class="btn bs" style="margin-left:4px" onclick="switchExhDT('apply')">신청항목으로</button>`
        : `<button class="btn bs" style="margin-left:4px" onclick="switchExhDT('apply')">접수 열러 가기</button>`}
    </div>`)}

  ${sct('인보이스', `
    <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px">
      ${invs.length ? invs.map(v => `
        <div style="padding:8px 10px;background:var(--i9);border-radius:7px${v.status === 'void' ? ';opacity:.55' : ''}">
          <div class="bl-row bl-inv-hd">
            <span style="min-width:0;font-size:var(--fs-12);font-weight:700${v.status === 'void' ? ';text-decoration:line-through' : ''}">${escapeHtml(v.title || '인보이스')}</span>
            ${v.status === 'void' ? '<span class="pill p-gray">무효</span>' : '<span></span>'}
            <input class="fi bl-amt-in" value="${escapeHtml(v.amount ?? '')}" placeholder="금액 미입력"
              onchange="setInvField('${escAttr(v.id)}','amount',this.value)">
            ${curSelect(v.currency, `setInvField('${escAttr(v.id)}','currency',this.value)`)}
            <button class="btn bs" onclick="toggleVoidInvoice('${escAttr(v.id)}')" title="${v.status === 'void' ? '되살리기' : '취소·대체됨으로 표시(합계에서 제외)'}">${v.status === 'void' ? '되살리기' : '무효'}</button>
            <button class="btn bs" onclick="delExhInvoice('${escAttr(v.id)}')">✕</button>
          </div>
          ${v.status === 'void' && v.void_note ? `<div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:3px">${escapeHtml(v.void_note)}</div>` : ''}
          <div style="display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap">
            <label style="font-size:var(--fs-10_5);color:var(--i4)">발송</label>
            <input type="date" class="fi" style="flex:1 1 128px;min-width:0;padding:3px 6px;font-size:var(--fs-11)" value="${escapeHtml(v.sent_at || '')}"
              onchange="setInvField('${escAttr(v.id)}','sent_at',this.value)">
            <label style="font-size:var(--fs-10_5);color:var(--i4)">입금 예정</label>
            <input type="date" class="fi" style="flex:1 1 128px;min-width:0;padding:3px 6px;font-size:var(--fs-11)" value="${escapeHtml(v.due_date || '')}"
              onchange="setInvField('${escAttr(v.id)}','due_date',this.value)">
            ${!v.sent_at ? '<span class="pill p-amber">미발송</span>'
              : (v.due_date && daysSince(v.due_date) > 0 && paid < billed) ? `<span class="pill p-red" style="background:var(--rb);color:var(--re)">${daysSince(v.due_date)}일 지남</span>` : ''}
            ${/* 양식 내려받기는 exh-invoice.js가 소유한다 — 여기서는 window 경유로만
                 부른다(exh-export와 같은 방식). 금액 항목을 그대로 양식에 옮긴다. */''}
            <button class="btn bs" id="inv-xls-${escAttr(v.id)}" style="margin-left:auto;flex:0 0 auto"
              onclick="exportExhInvoice('${escAttr(v.id)}')"
              title="정산의 금액 항목을 인보이스 양식(국문·영문)에 채워 엑셀로 내려받습니다">양식 내려받기</button>
          </div>
        </div>`).join('') : '<div style="font-size:var(--fs-11_5);color:var(--i5);padding:8px 2px">발행한 인보이스가 없어요</div>'}
    </div>
    <div class="bl-row bl-inv-add">
      <input class="fi" id="iv-t-${escAttr(x.id)}" placeholder="제목 (예: 부스+비품)" style="flex:1 1 140px;min-width:0;font-size:var(--fs-11_5);padding:6px">
      <input class="fi" id="iv-a-${escAttr(x.id)}" placeholder="금액" style="flex:1 1 96px;min-width:0;font-size:var(--fs-11_5);padding:6px;text-align:right"
        value="${items.length && !invs.length ? billedAmount(x.id) : ''}">
      <select class="fi bl-cur" id="iv-cur-${escAttr(x.id)}">
        ${currencies().map(c => `<option value="${c}"${currencyOf(x.id) === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <button class="btn bp bs" style="flex:0 0 auto" onclick="addExhInvoice('${escAttr(x.id)}')">발행</button>
    </div>
    <div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:5px">
      금액 항목 합계가 기본값으로 들어가요. 부스+비품 따로, 그래픽 따로 나눠 발행해도 됩니다.<br>
      <b>양식 내려받기</b>는 ${window.invoiceFolderName?.(exhEvent)
        ? `저장 폴더(<b>${escapeHtml(window.invoiceFolderName(exhEvent))}</b>)의 기업 폴더에 바로 저장돼요`
        : '다운로드로 받아요 — <b>신청항목</b> 탭에서 저장 폴더를 지정하면 폴더에 바로 저장됩니다'}.</div>`)}

  ${(() => {
  /* 세금계산서는 국세청에 원화로 신고하는 서류다. 외화로 청구하고 외화로
     받은 곳은 발행할 일이 없다 — 달러 계좌이체든 해외 카드 결제든 마찬가지다.
     그런데도 빈 발행 칸과 담당자 칸이 늘 펼쳐져 있으면, 볼 때마다 «이 회사
     세금계산서 안 끊었나»를 한 번씩 확인하게 된다.

     통화가 섞인 곳은 접지 않는다. 원화로 청구한 부분이 남아 있어 발행할 일이
     실제로 있다. 한 장이라도 끊어 둔 곳도 접지 않는다 — 발행한 기록을 화면에서
     지우면 무엇을 보냈는지 확인할 데가 없어진다.
     (진행 체크리스트가 이 기업의 «세금계산서» 칸을 «외화 청구»로 비우는 것과
     같은 기준이다.)

     드물게 원화 세금계산서를 따로 끊어야 하는 일이 있어서, 접어 두되 한 번
     눌러 열 수 있게 한다. */
  const need = taxNeed(x);
  if(need.kind === 'na' && exhDrUi.taxOpenFor !== x.id) return sct('세금계산서', `
    <div style="font-size:var(--fs-11_5);color:var(--i4);padding:8px 2px;line-height:1.7">
      <b style="color:var(--i3)">해당 없음</b> — ${
        need.why === '카드 완납' ? '카드로 완납한 곳이라 카드사 매출로 잡혀요.'
        : need.why === '청구 없음' ? '청구할 금액 항목이 아직 없어요.'
        : `${escapeHtml(currencyOf(x.id))}로 청구·결제한 곳이라 발행할 세금계산서가 없어요.`}
      <br><span style="color:var(--i5)">그래도 끊어야 하면
        <span style="color:var(--a);cursor:pointer;text-decoration:underline" onclick="openTaxAnyway('${escAttr(x.id)}')">여기서 열 수 있어요</span>.</span>
    </div>`);

  return sct('세금계산서', `
    ${need.kind === 'pre' ? `<div style="font-size:var(--fs-11);color:var(--i3);background:var(--i9);border-left:3px solid var(--am);padding:6px 8px;border-radius:var(--rd-6);margin-bottom:8px">
      <b>선발행(청구용)</b> — 아직 못 받은 돈이 있어요. 세금계산서를 먼저 끊어야 입금됩니다.</div>` : ''}
    ${need.kind === 'after' ? `<div style="font-size:var(--fs-11);color:var(--i3);background:var(--i9);padding:6px 8px;border-radius:var(--rd-6);margin-bottom:8px">
      <b>사후 발행</b> — 계좌이체로 완납된 곳이에요. 받은 돈에 대해 끊어 주세요.</div>` : ''}
    ${need.kind === 'check' ? `<div style="font-size:var(--fs-11);color:var(--i3);background:var(--i9);border-left:3px solid var(--am);padding:6px 8px;border-radius:var(--rd-6);margin-bottom:8px">
      <b>결제 수단 확인</b> — 입금에 수단이 안 적혀 있어요. 카드면 발행할 것이 없고, 계좌이체면 끊어야 합니다.</div>` : ''}
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
      ${taxes.length ? taxes.map(v => `
        <div style="padding:8px 10px;background:var(--i9);border-radius:7px${v.status === 'void' ? ';opacity:.55' : ''}">
          <div class="bl-row bl-inv-hd">
            <span style="min-width:0;font-size:var(--fs-12);font-weight:700${v.status === 'void' ? ';text-decoration:line-through' : ''}">${escapeHtml(v.title || '세금계산서')}</span>
            ${v.status === 'void' ? '<span class="pill p-gray">무효</span>' : '<span></span>'}
            <input class="fi bl-amt-in" value="${escapeHtml(v.amount ?? '')}" placeholder="금액 미입력"
              onchange="setTaxField('${escAttr(v.id)}','amount',this.value)">
            ${curSelect(v.currency, `setTaxField('${escAttr(v.id)}','currency',this.value)`)}
            <button class="btn bs" onclick="toggleVoidTax('${escAttr(v.id)}')" title="${v.status === 'void' ? '되살리기' : '취소·수정 발행됨으로 표시(합계에서 제외)'}">${v.status === 'void' ? '되살리기' : '무효'}</button>
            <button class="btn bs" onclick="delExhTax('${escAttr(v.id)}')">✕</button>
          </div>
          ${v.status === 'void' && v.void_note ? `<div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:3px">${escapeHtml(v.void_note)}</div>` : ''}
          <div style="margin-top:6px">${taxStageBar(v)}</div>
        </div>`).join('') : '<div style="font-size:var(--fs-11_5);color:var(--i5);padding:8px 2px">발행한 세금계산서가 없어요</div>'}
    </div>
    <div class="bl-row bl-inv-add">
      <input class="fi" id="tx-t-${escAttr(x.id)}" placeholder="제목 (예: 부스+비품)" style="flex:1 1 140px;min-width:0;font-size:var(--fs-11_5);padding:6px">
      <input class="fi" id="tx-a-${escAttr(x.id)}" placeholder="금액" style="flex:1 1 96px;min-width:0;font-size:var(--fs-11_5);padding:6px;text-align:right">
      <select class="fi bl-cur" id="tx-cur-${escAttr(x.id)}">
        ${currencies().map(c => `<option value="${c}"${currencyOf(x.id) === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <button class="btn bp bs" style="flex:0 0 auto" onclick="addExhTax('${escAttr(x.id)}')">추가</button>
    </div>
    <div style="font-size:var(--fs-10_5);color:var(--i5);margin:5px 0 10px">
      인보이스처럼 나눠 발행하거나(부스+비품 먼저, 그래픽 나중), 통화·금액 오류로 다시 발행할 때는
      옛 건을 무효로 두고 새로 추가하세요 — 지우면 왜 두 장인지 이력이 사라져요.</div>
    <div class="fgr bl-tax">
      <div class="fg"><label class="fl">담당자</label>
        <input class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(x.tax_contact_name || '')}"
          onchange="setExhField('${escAttr(x.id)}','tax_contact_name',this.value,'세금계산서 담당자')"></div>
      <div class="fg"><label class="fl">이메일</label>
        <input class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(x.tax_contact_email || '')}"
          onchange="setExhField('${escAttr(x.id)}','tax_contact_email',this.value,'세금계산서 담당자')"></div>
    </div>
    <div class="fgr bl-tax">
      <div class="fg"><label class="fl">연락처</label>
        <input class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(x.tax_contact_phone || '')}"
          onchange="setExhField('${escAttr(x.id)}','tax_contact_phone',this.value,'세금계산서 담당자')"></div>
    </div>`);
  })()}

  ${sct('입금 내역', `
    <div style="display:flex;flex-direction:column;gap:1px;margin-bottom:8px">
      ${ins.length ? ins.map((p, i) => `
        <div class="bl-row bl-pay" style="padding:6px 8px;background:var(--i9);border-radius:var(--rd-6)">
          <select class="fi" style="font-size:var(--fs-10);padding:3px 2px;min-width:0"
            title="결제 수단" onchange="setPayField('${escAttr(p.id)}','method',this.value)">
            <option value=""${p.method ? '' : ' selected'}>미기재</option>
            ${payMethods().map(o => `<option value="${escapeHtml(o.code)}"${p.method === o.code ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
          </select>
          <input type="date" class="fi" style="font-size:var(--fs-11);padding:3px 4px;min-width:0" value="${escapeHtml(p.paid_at || '')}"
            onchange="setPayField('${escAttr(p.id)}','paid_at',this.value)">
          <input class="fi" style="font-size:var(--fs-11);padding:3px 6px;min-width:0" value="${escapeHtml(p.note || '')}"
            placeholder="${ins.length > 1 ? `${i + 1}차 · ` : ''}비고 (대납·승인번호 등)"
            onchange="setPayField('${escAttr(p.id)}','note',this.value)">
          <input class="fi bl-amt-in" value="${escapeHtml(p.amount || '')}" placeholder="금액"
            onchange="setPayField('${escAttr(p.id)}','amount',this.value)">
          ${curSelect(p.currency, `setPayField('${escAttr(p.id)}','currency',this.value)`)}
          <button class="btn bs" onclick="delExhPayment('${escAttr(p.id)}')">✕</button>
        </div>`).join('') : '<div style="font-size:var(--fs-11_5);color:var(--i5);padding:8px 2px">입금 내역이 없어요</div>'}
    </div>
    <div class="bl-row bl-pay-add">
      <select class="fi" id="py-m-${escAttr(x.id)}" style="flex:0 0 116px;font-size:var(--fs-11);padding:6px" title="결제 수단">
        ${payMethods().map(o => `<option value="${escapeHtml(o.code)}">${escapeHtml(o.label)}</option>`).join('')}
      </select>
      <input type="date" class="fi" id="py-d-${escAttr(x.id)}" style="flex:1 1 120px;min-width:0;font-size:var(--fs-11_5);padding:6px" value="${td()}">
      <input class="fi" id="py-n-${escAttr(x.id)}" placeholder="비고(승인번호 등)" style="flex:1 1 90px;min-width:0;font-size:var(--fs-11_5);padding:6px">
      <input class="fi" id="py-a-${escAttr(x.id)}" placeholder="입금액" style="flex:1 1 100px;min-width:0;font-size:var(--fs-11_5);padding:6px;text-align:right"
        value="${rest > 0 ? rest : ''}">
      <select class="fi bl-cur" id="py-cur-${escAttr(x.id)}">
        ${currencies().map(c => `<option value="${c}"${currencyOf(x.id) === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <button class="btn bp bs" style="flex:0 0 auto" onclick="addExhPayment('${escAttr(x.id)}')">추가</button>
    </div>
    <div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:5px">
      분할 입금이면 여러 번 추가하세요.</div>`)}

  ${sct('환불 내역', `
    <div style="display:flex;flex-direction:column;gap:1px;margin-bottom:8px">
      ${refunds.length ? refunds.map(p => {
        // 요청과 완료를 나눈다 — 완료된 것만 입금 합계에서 빠진다.
        // 체크를 누르면 완료로 바뀌면서 그때 비로소 잔액에 반영된다.
        const pend = isPendingRefund(p);
        return `
        <div class="bl-row bl-pay" style="padding:6px 8px;background:${pend ? 'var(--ab)' : 'var(--i9)'};border-radius:var(--rd-6)">
          <button onclick="toggleRefundDone('${escAttr(p.id)}')"
            title="${pend ? '환불 완료로 표시 (합계에서 차감됩니다)' : '환불 요청 상태로 되돌리기'}"
            style="display:flex;align-items:center;gap:5px;border:none;background:none;padding:0;font-size:var(--fs-10);font-weight:700;color:${pend ? 'var(--am)' : 'var(--re)'}">
            <span style="width:16px;height:16px;border-radius:var(--rd-4);flex-shrink:0;line-height:1;
              border:1.5px solid ${pend ? 'var(--am)' : 'var(--re)'};background:${pend ? 'transparent' : 'var(--re)'};
              color:#fff;display:flex;align-items:center;justify-content:center">${pend ? '' : '✓'}</span>
            ${pend ? '요청' : '완료'}
          </button>
          <input type="date" class="fi" style="padding:3px 6px;font-size:var(--fs-11)" value="${escapeHtml(pend ? (p.requested_at || '') : (p.paid_at || ''))}"
            title="${pend ? '요청일' : '환불일'}"
            onchange="setPayField('${escAttr(p.id)}','${pend ? 'requested_at' : 'paid_at'}',this.value)">
          <input class="fi" style="min-width:0;font-size:var(--fs-11);padding:3px 6px" placeholder="사유"
            value="${escapeHtml(p.reason || p.note || '')}"
            onchange="setPayField('${escAttr(p.id)}','reason',this.value)">
          <input class="fi bl-amt-in" value="${escapeHtml(p.amount || '')}" placeholder="금액" style="color:var(--re)"
            onchange="setPayField('${escAttr(p.id)}','amount',this.value)">
          ${curSelect(p.currency, `setPayField('${escAttr(p.id)}','currency',this.value)`)}
          <button class="btn bs" onclick="delExhPayment('${escAttr(p.id)}')">✕</button>
        </div>`;
      }).join('') : '<div style="font-size:var(--fs-11_5);color:var(--i5);padding:8px 2px">환불 내역이 없어요</div>'}
    </div>
    <div class="bl-row bl-pay-add">
      <span class="pill p-red" style="text-align:center">환불</span>
      <input type="date" class="fi" id="rf-d-${escAttr(x.id)}" style="flex:1 1 130px;min-width:0;font-size:var(--fs-11_5);padding:6px" value="${td()}">
      <input class="fi" id="rf-r-${escAttr(x.id)}" placeholder="사유 (예: 부스 축소)" style="flex:1 1 100px;min-width:0;font-size:var(--fs-11_5);padding:6px">
      <input class="fi" id="rf-a-${escAttr(x.id)}" placeholder="환불액" style="flex:1 1 100px;min-width:0;font-size:var(--fs-11_5);padding:6px;text-align:right">
      <select class="fi bl-cur" id="rf-cur-${escAttr(x.id)}">
        ${currencies().map(c => `<option value="${c}"${currencyOf(x.id) === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <button class="btn bs" style="flex:0 0 auto" onclick="addExhRefund('${escAttr(x.id)}')">요청</button>
    </div>
    <div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:5px">
      환불은 <b>요청</b> 상태로 들어가고, 실제로 보낸 뒤 왼쪽 체크를 누르면 <b>완료</b>가 되면서
      그때 입금 합계에서 빠져요 — 아직 안 보낸 돈이 나간 것처럼 보이지 않게요.
      ${pendingRf.length ? `<br><b style="color:var(--am)">보내야 할 환불 ${pendingRf.length}건</b>` : ''}</div>`)}
  `;
}


/* 화면의 onclick이 부르는 것 */
window.dBilling = dBilling;   // 탭(exh-drawer.js)이 window로 부른다
window.itemCats = itemCats;   // 탭(exh-drawer.js)이 window로 부른다
window.markItemCat = markItemCat;   // 탭(exh-drawer.js)이 window로 부른다
window.designTargetList = designTargetList;   // 탭(exh-drawer.js)이 window로 부른다
window.currencies = currencies;   // 탭(exh-drawer.js)이 window로 부른다
