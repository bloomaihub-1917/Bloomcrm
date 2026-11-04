/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-item-views.js — 금액·비품·그래픽 현황 보기
   (modules/exh-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { trackAction } from '../../core/audit-log.js';
import { exhMailSteps } from '../../modules/exh-mail.js';
import { appsFor, catalogItem, exhEvent, getExhibitorById, liveItemsFor } from '../../state.js';
import { escAttr, escapeHtml, isMobile, td } from '../../utils.js';
import { GRAPHIC_STAGES, TCELL, TPILL, activeExhibitors, billableItems, billedByCategory, daysSince, fmtMoney, isBillable, isOverdue, isOwing, isWaiting, money, num, refundDue, settleByCurrency, settleState, stageAge, stageOf } from './exh-calc.js';
import { exhUi } from './exh-ui.js';
import { DUE_SOON_DAYS, SELF_BUILD_TYPE, applyCell, baseKind, boothDesignState, boothItemsPending, boothKeyOf, boothSortKey, cancelledExhibitors, coCell, dueInfo, emptyView, exhFollowOf, exhNames, graphicState, isBoothGiven, patchExh, renderExh, setExhField, setGraphicFil, setGraphicView, setPayFil, toggleEquipRow, viewShell, visibleList } from '../../modules/exh-tab.js';
import { openNewCatalogItem, openNewGraphicOrder, renderBaseView } from './exh-book.js';

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

/* ══════════════════════════════════════════
   분류별 받아야 할 돈 · 받은 돈 · 안 받은 돈

   입금(exhibitor_payments)에는 분류가 없다. 돈은 "부스비 300만 입금"이 아니라
   "○○사 400만 입금"으로 한 번에 들어오고, 인보이스도 기업 단위다. 그래서
   부스비를 받았는지 비품비를 받았는지는 데이터로 갈라낼 수 없다.

   기업 단위로 가른다. 완납한 기업이 낸 돈은 그 기업이 신청한 모든 분류를
   덮은 것으로 보고, 미납 기업의 청구는 통째로 «안 받은 돈»에 넣는다.

   부분 입금한 기업은 인보이스를 낸 순서대로 맞춘다. 최초 신청 항목이 첫
   인보이스로 나가고, 추가 신청은 회차(exhibitor_apps) 순으로 뒤 인보이스가
   된다. 낸 돈을 그 순서로 항목에 채워, 금액을 다 덮은 항목만 «받은 돈»에 넣고
   못 덮은 항목은 통째로 «안 받은 돈»에 둔다. 비율로 쪼개면 «그래픽 84% 받음»
   같은 실제로 없는 상태가 생긴다.
   어느 항목에도 딱 맞지 않고 남는 입금(덜 낸 송금 수수료 등)은 분류에 넣지
   않고 따로 센다 — 대시보드 미수금과의 차이가 바로 이 금액이다.

   완납 판정은 통화별로 한다. 원화는 다 냈는데 달러가 남은 기업이 있어서,
   기업 하나를 한 상태로 묶으면 어느 쪽이 남았는지가 사라진다. */
/* total을 weights 비율대로 정수로 나눈다 — 합이 total과 정확히 같다(최대 나머지 방식) */
function splitInt(total, weights){
  const sum = weights.reduce((a, b) => a + b, 0);
  if(!sum || !total) return weights.map(() => 0);
  const raw = weights.map(w => total * w / sum);
  const res = raw.map(Math.floor);
  let left = total - res.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - res[i], i]).sort((x, y) => y[0] - x[0])
    .forEach(([, i]) => { if(left > 0){ res[i]++; left--; } });
  return res;
}

const moneyCat = (i) => ['booth', 'equip', 'graphic'].includes(i.category) ? i.category : 'etc';

/* 인보이스가 나간 순서 — 최초 신청(회차 없음) 항목이 먼저, 추가 신청은 회차 순 */
function issueOrderItems(exhId, cur){
  const seq = new Map(appsFor(exhId).map((a, n) => [a.id, a.kind === '최초' ? 0 : n + 1]));
  return billableItems(exhId).filter(i => (i.currency || 'KRW') === cur)
    .map((i, n) => ({ i, n, o: i.app_id ? (seq.get(i.app_id) ?? 999) : 0 }))
    .sort((a, b) => a.o - b.o || (Number(a.i.sort_order) || 0) - (Number(b.i.sort_order) || 0) || a.n - b.n)
    .map(r => r.i);
}

export function catSettleByCurrency(list){
  const out = {};
  const partial = new Set();

  (list || []).forEach(x => {
    const st = settleByCurrency(x.id);
    const by = moneyRowsFor(x);

    Object.keys(by).forEach(cur => {
      if(!out[cur]) out[cur] = {};
      // 그 통화로 청구한 게 없으면 판단할 근거가 없다 — 미납으로 본다
      const bal = st[cur] ? st[cur].balance : 0;
      const paidUp = st[cur] ? bal <= 0 : false;
      if(st[cur] && st[cur].paid > 0 && bal > 0) partial.add(x.id);

      /* 받은 돈을 계좌이체와 카드로 갈라 둔다. 입금에 분류가 없듯 분류별
         결제 수단도 없어서, 그 기업이 실제로 낸 수단 비율대로 나눈다 —
         한 기업이 한 수단으로만 내는 경우가 대부분이라 그럴 때는 그대로 맞고,
         섞어 낸 곳만 비율로 갈린다. 수단이 안 적힌 옛 건은 미확인으로 남긴다. */
      const tot = st[cur] && st[cur].paid > 0 ? st[cur].paid : 0;
      const mix = tot
        ? { bank: st[cur].bank / tot, card: st[cur].card / tot, unknown: st[cur].etc / tot }
        : { bank: 0, card: 0, unknown: 0 };

      const cats = MONEY_CATS.map(([k]) => k).filter(k => by[cur][k]);
      const gotBy = {};
      if(paidUp) cats.forEach(k => { gotBy[k] = by[cur][k]; });
      else {
        let left = Math.max(0, tot);
        issueOrderItems(x.id, cur).forEach(i => {
          const v = num(i.amount), k = moneyCat(i);
          if(v > 0 && left >= v){ gotBy[k] = (gotBy[k] || 0) + v; left -= v; }
        });
        if(left > 0) out[cur].__left = (out[cur].__left || 0) + left;
      }
      const gots = cats.map(k => gotBy[k] || 0);
      const gotTotal = gots.reduce((a, b) => a + b, 0);
      // 결제 수단은 항목에 안 달려 있어 기업이 낸 수단 비율대로 정수로 나눈다
      const bankT = Math.round(gotTotal * mix.bank), unkT = Math.round(gotTotal * mix.unknown);
      const banks = splitInt(bankT, gots);
      const unks = splitInt(unkT, gots.map((g, i) => g - banks[i]));   // 카드 몫이 음수가 되지 않게

      cats.forEach((k, i) => {
        const v = by[cur][k];
        if(!out[cur][k]) out[cur][k] = { billed: 0, paid: 0, unpaid: 0, bank: 0, card: 0, unknown: 0 };
        out[cur][k].billed += v;
        out[cur][k].paid += gots[i];
        out[cur][k].unpaid += v - gots[i];
        out[cur][k].bank += banks[i];
        out[cur][k].unknown += unks[i];
        out[cur][k].card += gots[i] - banks[i] - unks[i];
      });
    });
  });
  return { out, partial: [...partial] };
}

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
    ? `<span style="font-size:var(--fs-9_5);color:var(--i5);margin-right:3px">${escapeHtml(cur)}</span>${money(v)}`
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
    + '<span style="font-size:var(--fs-10_5);color:var(--i5);margin-left:2px">금액 항목 기준(신청 금액)이라 청구액과 다를 수 있어요 — 오른쪽에 함께 뒀어요</span>'
    + (curs.length > 1
      ? '<div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:4px">한 칸에 두 통화가 함께 적힌 곳은 결제 수단이 갈린 경우예요 — 인보이스는 원화로 받고 엑스렌탈은 해외 카드로 결제하면 이렇게 나옵니다. 더할 수 없으니 그대로 병기합니다.</div>'
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

  /* ── 분류별 대시보드 ──
     표는 기업이 주인공이라 "부스비 얼마 남았나"를 한눈에 볼 수 없다. 그걸 위에
     따로 올린다. 표는 그 아래 그대로 두고 세부를 본다. */
  const { out: catS, partial } = catSettleByCurrency(list);
  const catCards = Object.keys(catS).sort().map(cur => {
    const cats = MONEY_CATS.filter(([k]) => catS[cur][k]);
    if(!cats.length) return '';
    const sum = cats.reduce((a, [k]) => {
      const c = catS[cur][k];
      a.billed += c.billed; a.paid += c.paid; a.unpaid += c.unpaid;
      a.bank += c.bank; a.card += c.card; a.unknown += c.unknown; return a;
    }, { billed: 0, paid: 0, unpaid: 0, bank: 0, card: 0, unknown: 0 });

    /* 받은 돈 아래에 수단을 적는다 — 통장과 맞출 때 계좌와 카드는 보는 곳이 달라서
       한 숫자로 합쳐 두면 매번 다시 갈라야 한다. 0인 수단은 적지 않는다. */
    const payMix = (c) => {
      const on = [['bank', '계좌'], ['card', '카드'], ['unknown', '미확인']]
        .filter(([k]) => Math.round(c[k]) > 0);
      if(!on.length) return '';
      // 수단이 하나뿐이면 금액은 위에 적힌 것과 같다 — 이름만 적는다
      const txt = on.length === 1 ? `전액 ${on[0][1]}`
        : on.map(([k, l]) => `${l} ${money(Math.round(c[k]))}`).join(' · ');
      return `<span style="display:block;font-size:var(--fs-9_5);color:var(--i5);margin-top:1px">${txt}</span>`;
    };

    const bar = (c) => {
      const pct = c.billed ? Math.round(c.paid / c.billed * 100) : 0;
      return `<div style="height:5px;background:var(--i7);border-radius:var(--rd-3);overflow:hidden;margin-top:6px">
        <div style="height:100%;width:${pct}%;background:${pct >= 100 ? 'var(--g)' : 'var(--a)'}"></div></div>`;
    };
    const line = (label, c, strong) => `<div style="padding:9px 12px;border-top:1px solid var(--i8)${
        strong ? ';background:var(--i9)' : ''}">
      <div style="display:flex;align-items:baseline;gap:8px">
        <span style="font-size:var(--fs-11_5);font-weight:${strong ? 700 : 600};color:var(--i2);flex:1">${escapeHtml(label)}</span>
        <span style="font-size:var(--fs-10);color:var(--i5)">${c.billed ? Math.round(c.paid / c.billed * 100) : 0}%</span>
      </div>
      <div style="display:flex;gap:10px;margin-top:3px;font-variant-numeric:tabular-nums">
        <span style="flex:1;min-width:0"><span style="font-size:var(--fs-9_5);color:var(--i5);display:block">받아야 할 돈</span>
          <b style="font-size:var(--fs-12_5)">${money(c.billed)}</b></span>
        <span style="flex:1;min-width:0"><span style="font-size:var(--fs-9_5);color:var(--i5);display:block">받은 돈</span>
          <b style="font-size:var(--fs-12_5);color:var(--g)">${money(c.paid)}</b>
          ${payMix(c)}</span>
        <span style="flex:1;min-width:0"><span style="font-size:var(--fs-9_5);color:var(--i5);display:block">안 받은 돈</span>
          <b style="font-size:var(--fs-12_5);color:${c.unpaid ? 'var(--re)' : 'var(--i5)'}">${money(c.unpaid)}</b></span>
      </div>
      ${bar(c)}
    </div>`;

    /* 통화마다 쓰는 분류 수가 달라(원화는 셋, 달러는 넷) 합계 줄이 서로 다른
       높이에 앉는다. 카드를 세로 플렉스로 두고 합계를 아래로 밀어 두면, 카드가
       같은 높이로 늘어나면서 합계끼리 같은 줄에서 맞는다 — 두 통화의 합계를
       나란히 읽는 게 이 카드를 보는 이유다. */
    return `<div style="flex:1 1 320px;min-width:0;background:var(--W);border:1px solid var(--i6);border-radius:var(--rd-10);overflow:hidden;display:flex;flex-direction:column">
      <div style="padding:9px 12px;font-family:inherit">
        <span class="pill p-blue">${escapeHtml(cur)}</span>
        <span style="font-size:var(--fs-10_5);color:var(--i5);margin-left:5px">분류별 수금 현황</span>
      </div>
      ${cats.map(([k, l]) => line(l, catS[cur][k], false)).join('')}
      <div style="margin-top:auto">${line('합계', sum, true)}
        ${catS[cur].__left ? `<div style="padding:0 12px 9px;font-size:var(--fs-10);color:var(--am);background:var(--i9)">
          항목에 딱 맞지 않은 입금 ${escapeHtml(fmtMoney(catS[cur].__left, cur))} — 받은 돈에 넣지 않았어요</div>` : ''}</div>
    </div>`;
  }).join('');

  const catDash = catCards ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">${catCards}</div>
    <div style="font-size:var(--fs-10_5);color:var(--i4);margin:-4px 0 14px;line-height:1.6">
      입금에는 분류가 없어요 — 돈은 기업 단위로 한 번에 들어옵니다. 그래서
      <b>완납한 기업</b>의 청구를 «받은 돈»으로, <b>남은 기업</b>의 잔액을 «안 받은 돈»으로 갈랐어요.
      ${partial.length ? `<br><b style="color:var(--am)">일부만 낸 ${partial.length}곳</b>은 인보이스 낸 순서(최초 신청 → 추가 신청)대로 낸 돈을 맞춰, 금액이 다 맞은 항목만 «받은 돈»에 넣었어요.` : ''}
    </div>` : '';

  /* ── 완납·미납 고르기 ──
     위 카드는 전체 그림이라 "누가 안 냈나"는 안 보인다. 아래 표를 그 기준으로
     걸러 준다. 카드는 그대로 두는 게 맞다 — 걸러 놓고 보면 미납만 모은 카드의
     «받은 돈»은 늘 0이라 볼 이유가 없고, 비교할 전체 숫자가 사라진다.

     완납 판정은 통화별로 한다. 원화는 다 냈는데 달러가 남은 기업을 완납으로
     묶으면 남은 돈이 화면에서 사라진다. 금액 자체는 통화를 넘어 더하지 않고
     "낸 게 있나"만 본다. */
  const payStateOf = (x) => {
    const st = settleByCurrency(x.id);
    const cs = Object.keys(st);
    if(!cs.some(c => st[c].billed)) return 'none';
    if(cs.every(c => st[c].balance <= 0)) return 'paid';
    return cs.some(c => st[c].paid > 0) ? 'partial' : 'unpaid';
  };
  const marked = rows.map(r => ({ ...r, st: payStateOf(r.x) }));
  const cnt = (k) => marked.filter(r => r.st === k).length;
  /* 미납·일부만 냄을 기한으로 한 번 더 가른다 — 행사 후 납부로 합의한 곳은
     안 낸 게 맞다. 기업별 입금 기한(없으면 행사 공통 기한)을 본다. */
  const lateN = marked.filter(r => isOverdue(settleState(r.x))).length;
  const waitN = marked.filter(r => isWaiting(settleState(r.x))).length;

  const fpill = (k, l, n, cls) => n || k === 'all'
    ? `<button class="pill ${exhUi.payFil === k ? cls : 'p-gray'}"
        style="border:0;cursor:pointer${exhUi.payFil === k ? ';outline:2px solid var(--i5)' : ''}"
        title="${exhUi.payFil === k && k !== 'all' ? '다시 눌러 전체 보기' : ''}"
        onclick="setPayFil('${k}')">${l} ${n}</button>`
    : '';
  const payFilBar = `<div style="display:flex;gap:5px;flex-wrap:wrap;margin:0 0 8px">
    ${fpill('all', '전체', marked.length, 'p-blue')}
    ${fpill('paid', '완납', cnt('paid'), 'p-green')}
    ${fpill('partial', '일부만 냄', cnt('partial'), 'p-amber')}
    ${fpill('unpaid', '미납', cnt('unpaid'), 'p-red')}
    ${fpill('none', '청구 없음', cnt('none'), 'p-gray')}
    ${lateN || waitN ? '<span style="width:1px;background:var(--i6);margin:0 3px"></span>' : ''}
    ${fpill('late', '기한 지남', lateN, 'p-red')}
    ${fpill('wait', '입금 예정', waitN, 'p-blue')}
  </div>`;

  const vrows = exhUi.payFil === 'all' ? marked
    : exhUi.payFil === 'late' ? marked.filter(r => isOverdue(settleState(r.x)))
    : exhUi.payFil === 'wait' ? marked.filter(r => isWaiting(settleState(r.x)))
    : marked.filter(r => r.st === exhUi.payFil);

  /* 표 아래 합계는 지금 걸러 놓은 기업만 더한다 — 위 카드가 전체를 보여주니
     여기까지 전체를 더하면 «미납만 보고 있는데 받은 돈이 찍히는» 꼴이 된다. */
  const vlist = vrows.map(r => r.x);
  const vtotal = billedByCategory(vlist);
  const vsettle = {};
  vlist.forEach(x => {
    const st = settleByCurrency(x.id);
    Object.keys(st).forEach(c => {
      if(!vsettle[c]) vsettle[c] = { billed: 0, paid: 0, bank: 0, card: 0, etc: 0, balance: 0 };
      ['billed', 'paid', 'bank', 'card', 'etc', 'balance'].forEach(k => { vsettle[c][k] += st[c][k]; });
    });
  });

  const noneMsg = emptyView('해당하는 기업이 없어요');

  // 잔액 아래 한 줄 — 챙길 곳인지 기다릴 곳인지
  const dueTag = (x) => {
    const s = settleState(x);
    if(!isOwing(s)) return '';
    return isOverdue(s)
      ? `<div style="font-size:var(--fs-9_5);color:var(--re)">기한 ${daysSince(s.due)}일 지남</div>`
      : `<div style="font-size:var(--fs-9_5);color:var(--i4)">${s.due ? `입금 예정 ~${escapeHtml(s.due.slice(5).replace('-', '/'))}` : '기한 없음'}</div>`;
  };

  /* 참가 취소했는데 낸 돈이 남은 곳. 위 카드와 표는 취소 기업을 빼고 세므로
     여기 따로 적지 않으면 돌려줄 돈이 화면에서 사라진다. */
  const refunds = cancelledExhibitors(exhEvent).map(x => ({ x, pb: refundDue(x) })).filter(r => r.pb);
  const refundBox = refunds.length ? `<div style="background:var(--W);border:1px solid var(--i6);border-left:3px solid var(--am);
      border-radius:var(--r);padding:9px 12px;margin:-2px 0 14px">
      <div style="font-size:var(--fs-11_5);font-weight:700;color:var(--i2);margin-bottom:4px">환불 확인 필요 ${refunds.length}곳
        <span style="font-weight:400;color:var(--i4);font-size:var(--fs-10_5)">— 참가 취소했지만 낸 돈이 남아 있어요. 위 집계에는 들어 있지 않습니다.</span></div>
      ${refunds.map(({ x, pb }) => `<div onclick="openExhDr('${escAttr(x.id)}','billing')"
          style="display:flex;gap:8px;font-size:var(--fs-11_5);padding:3px 0;cursor:pointer">
        <span style="flex:1;min-width:0">${escapeHtml(exhNames(x).ko)}</span>
        ${pb.requested ? `<span style="color:var(--i4);font-size:var(--fs-10_5)">환불 요청 ${escapeHtml(fmtMoney(pb.requested, pb.cur))}</span>` : ''}
        <b style="color:var(--am)">${escapeHtml(fmtMoney(pb.net, pb.cur))}</b></div>`).join('')}
      <div style="font-size:var(--fs-10);color:var(--i5);margin-top:3px">환불을 입금 기록에 «환불 완료»로 남기면 여기서 빠져요. 돌려주지 않기로 했다면 기업 정산에서 «위약금으로 남김»을 누르세요.</div>
    </div>` : '';

  if(isMobile()) return viewShell(pills, catDash + refundBox + payFilBar + (vrows.length ? '' : noneMsg) + vrows.map(({ x, by }) => {
    const st = settleByCurrency(x.id);
    const sc = Object.keys(st).sort();
    const line = (key) => sc.filter(c => st[c][key]).map(c => amt(c, st[c][key])).join(' · ') || '-';
    const owing = sc.some(c => st[c].balance > 0);
    return `<div onclick="openExhDr('${escAttr(x.id)}','billing')"
      style="background:var(--W);border:1px solid var(--i7);border-radius:var(--rd-10);padding:11px 12px;margin-bottom:7px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <span class="pill p-gray">${escapeHtml(x.apply_order || '-')}</span>
        <span style="font-size:var(--fs-13);font-weight:700;flex:1;min-width:0">${escapeHtml(exhNames(x).ko)}</span>
        <span class="pill ${x.booth_no ? 'p-blue' : 'p-gray'}">${escapeHtml(x.booth_no || '미배정')}</span>
      </div>
      ${used.map(([k, l]) => {
        const has = curs.filter(c => by[c] && by[c][k]);
        if(!has.length) return '';
        return `<div style="display:flex;justify-content:space-between;font-size:var(--fs-11_5);padding:2px 0">
          <span style="color:var(--i4)">${l}</span><span>${has.map(c => amt(c, by[c][k])).join(' · ')}</span>
        </div>`;
      }).join('')}
      <div style="display:flex;justify-content:space-between;font-size:var(--fs-12);font-weight:700;padding:4px 0 0;border-top:1px solid var(--i8);margin-top:4px">
        <span>신청 합계</span>
        <span>${curs.filter(c => by[c]?.합계).map(c => amt(c, by[c].합계)).join(' · ')}</span>
      </div>
      <div style="font-size:var(--fs-11);margin-top:3px;color:var(--i4)">청구 ${line('billed')}</div>
      <div style="display:flex;justify-content:space-between;font-size:var(--fs-11)">
        <span style="color:var(--i4)">입금 ${line('paid')}${
          sc.some(c => st[c].bank || st[c].card || st[c].etc)
            ? `<span style="color:var(--i5);font-size:var(--fs-10)"> (${
                [['bank', '계좌'], ['card', '카드'], ['etc', '미확인']]
                  .filter(([k]) => sc.some(c => st[c][k]))
                  .map(([k, l]) => `${l} ${sc.filter(c => st[c][k]).map(c => amt(c, st[c][k])).join(' · ')}`)
                  .join(' / ')})</span>`
            : ''}</span>
        <span style="color:${owing ? 'var(--am)' : 'var(--g)'}">${owing ? '잔액 ' + line('balance') : '완납'}</span>
      </div>
    </div>`;
  }).join(''));

  if(!vrows.length) return viewShell(pills, catDash + refundBox + `<div class="sct">기업별 세부</div>` + payFilBar + noneMsg);

  return viewShell(pills, catDash + refundBox + `<div class="sct">기업별 세부</div>` + payFilBar + `<div class="tw"><table><thead><tr>
      <th style="min-width:44px;text-align:right">신청순</th>
      <th style="min-width:150px">기업</th>
      <th style="min-width:56px">부스번호</th>
      ${used.map(([, l]) => `<th style="min-width:104px;text-align:right">${l}</th>`).join('')}
      <th style="min-width:110px;text-align:right">신청 합계</th>
      <th style="min-width:110px;text-align:right">청구액</th>
      ${payCols.map(([, l]) => `<th style="min-width:104px;text-align:right">${l}</th>`).join('')}
      <th style="min-width:104px;text-align:right">잔액</th>
    </tr></thead><tbody>
      ${vrows.map(({ x, by }) => {
        // 청구·입금도 통화별로 갈라 적는다 — 한 통화만 더하면 나머지가 사라진다
        const st = settleByCurrency(x.id);
        const sc = Object.keys(st).sort();
        const col = (key) => sc.filter(c => st[c][key]).map(c => amt(c, st[c][key])).join('<br>') || '-';
        const owing = sc.some(c => st[c].balance > 0);
        return `<tr>
          ${applyCell(x)}
          ${coCell(x, 'billing')}
          <td style="font-size:var(--fs-11_5);color:var(--i3)">${escapeHtml(x.booth_no || '—')}</td>
          ${used.map(([k]) => `<td style="text-align:right">${cell(by, k)}</td>`).join('')}
          <td style="text-align:right;font-weight:700">${
            curs.filter(c => by[c]?.합계).map(c => amt(c, by[c].합계)).join('<br>') || '-'}</td>
          <td style="text-align:right">${col('billed')}</td>
          ${payCols.map(([k]) => `<td style="text-align:right">${col(k)}</td>`).join('')}
          <td style="text-align:right;color:${owing ? 'var(--am)' : 'var(--i3)'}">${col('balance')}${dueTag(x)}</td>
        </tr>`;
      }).join('')}
    </tbody>
    <tfoot>
      ${curs.map(c => {
        const m = vtotal[c];
        if(!m || !m.합계) return '';
        return `<tr style="border-top:2px solid var(--i5);font-weight:800">
          <td colspan="3" style="font-size:var(--fs-12)">${escapeHtml(c)} 합계
            <span style="font-weight:400;color:var(--i4);font-size:var(--fs-10_5)">${
              vrows.filter(r => r.by[c]?.합계).length}곳</span></td>
          ${used.map(([k]) => `<td style="text-align:right">${amt(c, m[k])}</td>`).join('')}
          <td style="text-align:right">${amt(c, m.합계)}</td>
          ${(() => { const s = vsettle[c] || { billed: 0, paid: 0, balance: 0 };
            return `<td style="text-align:right">${amt(c, s.billed)}</td>
              ${payCols.map(([k]) => `<td style="text-align:right;color:var(--g)">${amt(c, s[k])}</td>`).join('')}
              <td style="text-align:right;color:${s.balance > 0 ? 'var(--am)' : 'var(--g)'}">${
                s.balance ? amt(c, s.balance) : '<span style="font-weight:400">완납</span>'}</td>`; })()}
        </tr>
        <tr style="font-weight:400">
          <td colspan="3" style="font-size:var(--fs-10_5);color:var(--i4)">${escapeHtml(c)} 비중</td>
          ${used.map(([k]) => `<td style="text-align:right;font-size:var(--fs-10_5);color:var(--i4)">${
            m.합계 ? Math.round(m[k] / m.합계 * 100) + '%' : '-'}</td>`).join('')}
          <td colspan="${3 + payCols.length}"></td>
        </tr>`;
      }).join('')}
    </tfoot>
    </table></div>`);
}


/* 비품 현황 하위 탭 — 전체 / 기본 / 추가

   발주는 전체를 보고 하고, 청구 확인은 추가만 보면 되고, 부스에 딸려 가는
   것이 제대로 깔렸는지는 기본만 보면 된다. 한 표에 셋을 겹쳐 두면 볼 때마다
   눈으로 걸러야 해서, 아예 갈라 둔다. */
const EQUIP_SCOPES = [['all', '전체'], ['base', '기본'], ['extra', '추가']];
export function setEquipScope(v){ exhUi.equipScope = v; renderExh(); }

function renderEquipView(list){
  const inScope = (i) => exhUi.equipScope === 'all' ? true
    : exhUi.equipScope === 'base' ? isBoothGiven(i) : !isBoothGiven(i);
  const scopeSeg = `<div class="subbar sec"><div class="seg">${EQUIP_SCOPES.map(([v, l]) =>
    `<button class="seg-b${exhUi.equipScope === v ? ' on' : ''}" onclick="setEquipScope('${v}')"
      title="${v === 'all' ? '기본 + 추가 — 발주할 수량이에요'
            : v === 'base' ? '부스 타입에 딸려 오는 기본 제공 — 청구하지 않아요'
            : '기업이 따로 신청한 추가 비품 — 청구 대상이에요'}">${l}</button>`).join('')}</div></div>`;

  const rows = list.map(x => ({ x, items: liveItemsFor(x.id)
      .filter(i => (i.category || '') === 'equip').filter(inScope) }))
    .filter(r => r.items.length);
  if(!rows.length) return scopeSeg + emptyView(
    exhUi.equipScope === 'base' ? '부스 기본 제공으로 들어간 비품이 없어요'
    : exhUi.equipScope === 'extra' ? '기업이 따로 신청한 비품이 없어요' : '신청된 비품이 없어요');

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
      /* 분류(의자·테이블·가전제품…)는 카탈로그가 들고 있다. 발주서를 쓸 때
         의자 몇 개, 테이블 몇 개를 묶어 보게 되므로 화면에서도 갈라 준다.
         카탈로그 밖 품목은 갈 데가 없어 따로 모은다 — 기타비품에 섞으면
         진짜 기타비품과 구분이 안 돼 단가 확인을 빠뜨린다. */
      cat:    cat ? (String(cat.category || '').trim() || '기타비품') : '카탈로그 외',
      catOrd: cat ? (Number(cat.sort_order) || 9999) : 1e6,
      offCatalog: !cat,
      // 신청하다 직접 적어 올린 품목 — 정식 카탈로그와 구분해 두면 나중에
      // 렌탈사 카탈로그를 다시 받을 때 무엇을 확인해야 할지 알 수 있다
      direct: !!(cat && cat.note === '직접 추가'),
      /* 부스에 딸려 오는 것과 기업이 따로 신청한 것을 갈라 센다 — 발주는 둘을
         합쳐서 하지만, 청구와 확인은 «추가»만 보면 된다. 한 숫자만 있으면
         그때마다 기업별로 다시 헤아리게 된다. */
      qty: 0, qtyBase: 0, qtyExtra: 0, cos: [], krw: 0, usd: 0,
    });
    const g = byName.get(k);
    const q = Number(String(i.qty || '').replace(/[^0-9.-]/g, '')) || 0;
    const amt = Number(String(i.amount || '').replace(/[^0-9.-]/g, '')) || 0;
    /* 공동 부스에서 비용만 나눠 낸 줄은 수량을 세지 않는다. 실물은 상대 기업이
       주문하므로 여기서 또 세면 없는 의자를 발주하게 된다. 금액은 센다. */
    const shareOnly = !!String(i.shared_ref || '').trim();
    if(!shareOnly){
      const n = q || 1;               // 수량을 안 적었으면 1개로 센다
      g.qty += n;
      if(isBoothGiven(i)) g.qtyBase += n; else g.qtyExtra += n;
    }
    else g.shared = true;
    g.cos.push({ id: x.id, name: x.company_name, booth: x.booth_no, qty: shareOnly ? 0 : (q || 1),
      amt, cur: i.currency || 'KRW', raw: i.name, shareOnly, base: isBoothGiven(i) });
    // 통화별로 나눠 담는다 — 합치면 원화와 달러를 더한 숫자가 된다.
    // 청구에서 뺀 항목은 수량은 세되 금액은 더하지 않는다 — 발주는 해야 하지만
    // 우리 청구액은 아니다.
    if(isBillable(i)){ if((i.currency || 'KRW') === 'USD') g.usd += amt; else g.krw += amt; }
    else g.excluded = true;
  }));
  /* 분류의 앞뒤도, 분류 안의 앞뒤도 카탈로그가 정한 순서를 따른다. 화면이 따로
     순서를 정해 두면 설정에서 카탈로그를 다시 세워도 여기만 옛 순서로 남는다.

     수량 많은 순이 아니라 품목 순이다 — 발주서와 렌탈사 카탈로그가 코드 순으로
     적혀 있어서, 화면이 다른 순서면 한 줄씩 눈으로 찾아 맞춰야 한다. */
  const catOrder = new Map();
  [...byName.values()].forEach(g => {
    const cur = catOrder.get(g.cat);
    if(cur === undefined || g.catOrd < cur) catOrder.set(g.cat, g.catOrd);
  });
  // 한 기업이 기본·추가로 두 줄을 가질 수 있다 — 줄이 아니라 기업을 센다
  byName.forEach(g => { g.coN = new Set(g.cos.map(c => c.id)).size; });

  const groups = [...byName.values()].sort((a, b) =>
    (catOrder.get(a.cat) - catOrder.get(b.cat))
    || (a.catOrd - b.catOrd)
    || String(a.code || '힣').localeCompare(String(b.code || '힣'), 'ko', { numeric: true })
    || String(a.nameKo || '').localeCompare(String(b.nameKo || ''), 'ko'));

  /* 분류별 소계 — 발주서에 «의자 소계 60개»처럼 들어간다 */
  const catBlocks = [...new Set(groups.map(g => g.cat))].map(c => {
    const gs = groups.filter(g => g.cat === c);
    return { cat: c, gs, kinds: gs.length,
      qty: gs.reduce((a, g) => a + g.qty, 0),
      qtyBase: gs.reduce((a, g) => a + g.qtyBase, 0),
      qtyExtra: gs.reduce((a, g) => a + g.qtyExtra, 0),
      krw: gs.reduce((a, g) => a + g.krw, 0),
      usd: gs.reduce((a, g) => a + g.usd, 0) };
  });

  // 갈라 본 탭에서는 기본·추가 열이 되풀이라 뺀다 — 수량 한 칸이면 충분하다
  const split = exhUi.equipScope === 'all';
  const offN = groups.filter(g => g.offCatalog).length;
  const totKrw = groups.reduce((a, g) => a + g.krw, 0);
  const totUsd = groups.reduce((a, g) => a + g.usd, 0);
  const totQty   = groups.reduce((a, g) => a + g.qty, 0);
  const totBase  = groups.reduce((a, g) => a + g.qtyBase, 0);
  const totExtra = groups.reduce((a, g) => a + g.qtyExtra, 0);
  const pills = `<span class="pill p-gray">신청 기업 ${rows.length}</span>`
    + `<span class="pill p-blue">품목 ${groups.length}종</span>`
    + (exhUi.equipScope === 'all'
        ? `<span class="pill p-gray" title="기본 제공과 추가 신청을 합친 발주 수량이에요">전체 ${totQty}개</span>`
          + `<span class="pill p-teal" title="부스 타입에 딸려 오는 기본 제공 품목 — 우리가 청구하지 않아요">기본 ${totBase}개 · 청구 안함</span>`
          + `<span class="pill p-blue" title="기업이 따로 신청한 비품 — 청구 대상이에요">추가비품 ${totExtra}개 · 별도 신청</span>`
        : exhUi.equipScope === 'base'
          ? `<span class="pill p-teal">기본 ${totQty}개 · 청구 안함</span>`
          : `<span class="pill p-blue">추가비품 ${totQty}개 · 별도 신청</span>`)
    + (totKrw ? `<span class="pill p-gray">${fmtMoney(totKrw, 'KRW')}</span>` : '')
    + (totUsd ? `<span class="pill p-gray">${fmtMoney(totUsd, 'USD')}</span>` : '')
    + (offN ? `<span class="pill p-amber" title="카탈로그에 없는 품목 — 그래픽·전기처럼 다른 분류일 수 있어요">카탈로그 외 ${offN}종</span>` : '')
    + catBlocks.map(b => `<span class="pill p-gray" style="font-size:var(--fs-9_5)"
        title="${escapeHtml(b.gs.map(g => `${g.nameKo} ${g.qty}개`).join(', '))}">${escapeHtml(b.cat)} ${b.qty}개</span>`).join('');

  /* 어느 기업이 신청했는지 — 품목을 클릭하면 펼친다.
     발주하다 "이 의자 25개가 어디로 가는 거지"를 확인해야 할 때, 표 밖으로
     나가지 않고 그 자리에서 본다. */
  /* 부스 번호 순으로 세운다. 수량 많은 순이었는데, 이 목록을 여는 이유는
     «이 의자를 어느 부스로 몇 개 보내나»이고 현장에서 도는 순서가 부스 순서다.
     4개·3개·3개·3개…로 늘어놓으면 같은 수량끼리 순서가 뒤죽박죽이라 방금 본
     부스를 다시 찾게 된다. 그래픽 현황도 같은 순서를 쓴다.

     부스가 아직 없는 곳은 맨 뒤로 — 번호가 없다고 앞에 세우면 매번 걸린다. */
  /* 한 기업이 같은 품목을 기본과 추가로 나눠 가지면 줄이 둘로 갈렸다 —
     «시믹코리아 2개 / 시믹코리아 기본 2개»가 나란히 서서, 실제로 몇 개가
     그 부스로 가는지 눈으로 더해야 했다. 여기서 알고 싶은 건 «이 부스에 몇 개»
     하나뿐이니 기업으로 묶어 한 줄로 낸다. 기본이 섞였으면 몇 개가 기본인지만
     작게 덧붙인다 — 금액이 수량에 비해 적은 이유가 그것이다. */
  const coMerged = (g) => {
    const by = new Map();
    g.cos.forEach(c => {
      const m = by.get(c.id) || { ...c, qty: 0, amt: 0, base: 0, shareOnly: false };
      m.qty += c.qty; m.amt += c.amt;
      if(c.base) m.base += c.qty;
      if(c.shareOnly) m.shareOnly = true;
      by.set(c.id, m);
    });
    return [...by.values()];
  };

  const coList = (g) => coMerged(g)
    .sort((a, b) => boothKeyOf(a.booth) - boothKeyOf(b.booth)
      || String(a.name || '').localeCompare(String(b.name || ''), 'ko'))
    .map(c => `
    <div onclick="event.stopPropagation();openExhDr('${escAttr(c.id)}','billing')"
      style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:var(--fs-11_5)">
      <span class="pill p-gray" style="min-width:52px;text-align:center">${c.booth ? '부스 ' + escapeHtml(c.booth) : '미배정'}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${
        isMobile() ? ';font-size:var(--fs-12_5);font-weight:600' : ''}">${escapeHtml(c.name)}</span>
      ${c.base ? `<span style="font-size:var(--fs-10);color:var(--i4)" title="부스에 딸려 오는 기본 제공분이에요">기본 ${c.base}</span>` : ''}
      <span style="color:var(--i3)">${c.shareOnly ? '<span class="pill p-blue" style="font-size:var(--fs-9)">비용 분담</span>' : c.qty + '개'}</span>
      ${isMobile() ? ''   /* 좁은 화면에서는 금액이 기업명 자리를 먹는다 — 합계는 위 품목 줄에 있다 */
        : `<span style="min-width:88px;text-align:right;font-weight:600">${c.amt ? fmtMoney(c.amt, c.cur) : '-'}</span>`}
    </div>`).join('');

  const summaryBody = isMobile()
    /* 좁은 화면에서는 표를 쓰지 않는다 — 헤더가 숨겨지면서 25 / 7곳 / 187,000원이
       각각 무슨 숫자인지 알 수 없게 된다. 값마다 이름을 붙여 카드로 그린다. */
    ? catBlocks.map(b => `
      <div style="display:flex;align-items:baseline;gap:6px;padding:10px 0 4px;border-bottom:2px solid var(--i7);margin-top:6px">
        <span style="font-size:var(--fs-12);font-weight:800;color:var(--i2)">${escapeHtml(b.cat)}</span>
        <span style="font-size:var(--fs-10_5);color:var(--i4)">${b.kinds}종 · ${b.qty}개${
          split && (b.qtyBase || b.qtyExtra) ? ` (기본 ${b.qtyBase} · 추가 ${b.qtyExtra})` : ''}${
          b.krw ? ' · ' + escapeHtml(fmtMoney(b.krw, 'KRW')) : ''}${
          b.usd ? ' · ' + escapeHtml(fmtMoney(b.usd, 'USD')) : ''}</span>
      </div>` + b.gs.map(g => {
      const open = exhUi.equipOpen.has(g.key);
      return `<div style="padding:8px 0;border-bottom:1px solid var(--i8)">
        <div onclick="toggleEquipRow('${escAttr(g.key)}')" style="cursor:pointer">
          <div style="display:flex;align-items:baseline;gap:7px">
            ${g.code ? `<span class="pill ${g.direct ? 'p-teal' : 'p-blue'}" style="font-size:var(--fs-9)">${escapeHtml(g.code)}</span>` : ''}
            <span style="font-size:var(--fs-12_5);font-weight:600;flex:1;min-width:0">${escapeHtml(g.nameKo)}</span>
            <span style="font-size:var(--fs-15);font-weight:800">${g.qty}<span style="font-size:var(--fs-10);font-weight:400;color:var(--i4)">개</span></span>
          </div>
          ${g.nameEn ? `<div style="font-size:var(--fs-10_5);color:var(--i4)">${escapeHtml(g.nameEn)}</div>` : ''}
          <div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:2px">
            ${split && g.qtyBase ? `기본 ${g.qtyBase} · ` : ''}${split && g.qtyExtra ? `추가 ${g.qtyExtra} · ` : ''}${
            g.spec ? escapeHtml(g.spec) + ' · ' : ''}${g.coN}개사 신청
            ${g.krw ? ' · ' + escapeHtml(fmtMoney(g.krw, 'KRW')) : ''}${g.usd ? ' · ' + escapeHtml(fmtMoney(g.usd, 'USD')) : ''}
            <span style="color:var(--a)"> ${open ? '▲ 접기' : '▼ 신청 기업'}</span>
          </div>
        </div>
        ${open ? `<div style="margin-top:5px;padding-left:6px;border-left:2px solid var(--i6)">${coList(g)}</div>` : ''}
      </div>`;
    }).join('')).join('')

    : `<div class="tw" style="overflow:visible"><table><thead><tr>
        <th style="min-width:74px">분류</th>
        <th style="min-width:66px">품목코드</th>
        <th style="min-width:150px">품명(국문)</th>
        <th style="min-width:150px">품명(영문)</th>
        <th style="min-width:110px">규격</th>
        <th style="min-width:56px;text-align:right" title="${split ? '기본 + 추가 — 발주 수량이에요' : '이 탭에 해당하는 수량이에요'}">${split ? '전체' : '수량'}</th>
        ${split ? `<th style="min-width:52px;text-align:right" title="부스 타입에 딸려 오는 기본 제공 — 청구하지 않아요">기본</th>
        <th style="min-width:52px;text-align:right" title="기업이 따로 신청한 추가 비품 — 청구 대상이에요">추가</th>` : ''}
        <th style="min-width:62px;text-align:right">기업</th>
        <th style="min-width:104px;text-align:right">KRW</th>
        <th style="min-width:88px;text-align:right">USD</th>
      </tr></thead><tbody>
        ${groups.map((g, gi) => {
          const open = exhUi.equipOpen.has(g.key);
          /* 같은 분류가 이어지면 이름을 한 번만 쓴다 — 스물네 줄에 «의자»가 여덟 번
             찍히면 글자가 많아 오히려 덩어리가 안 보인다. 머리글 줄을 따로 세우지
             않은 건, 그러면 표 머리를 눌러 정렬하는 길이 막히기 때문이다. */
          const first = groups.findIndex(z => z.cat === g.cat) === gi;
          return `<tr onclick="toggleEquipRow('${escAttr(g.key)}')" style="cursor:pointer${open ? ';background:var(--ad)' : ''}${
            first && gi ? ';border-top:2px solid var(--i6)' : ''}"
            title="클릭하면 신청한 기업을 볼 수 있어요">
            <td style="font-size:var(--fs-11);font-weight:${first ? '800' : '400'};color:var(${first ? '--i2' : '--i6'})">${
              escapeHtml(g.cat)}</td>
            <td style="font-size:var(--fs-11_5);font-weight:700;color:var(--i2)">
              <span style="color:var(--a)">${open ? '▾' : '▸'}</span> ${escapeHtml(g.code || '—')}</td>
            <td style="font-size:var(--fs-12_5);font-weight:600">${escapeHtml(g.nameKo)}
              ${g.excluded ? '<span class="pill p-amber" style="font-size:var(--fs-9);margin-left:4px" title="우리가 청구하지 않는 항목이라 금액 합계에서 빠져 있어요">청구 제외</span>' : ''}
              ${g.offCatalog ? '<span class="pill p-amber" style="font-size:var(--fs-9);margin-left:4px" title="카탈로그에 없는 품목 — 직접 입력됐어요">카탈로그 외</span>' : ''}
              ${g.direct ? '<span class="pill p-teal" style="font-size:var(--fs-9);margin-left:4px" title="신청하면서 직접 적어 품목마스터에 올린 품목이에요 — 단가·규격을 확인해주세요">직접 추가</span>' : ''}</td>
            <td style="font-size:var(--fs-11_5);color:var(--i3)">${escapeHtml(g.nameEn || '-')}</td>
            <td style="font-size:var(--fs-11);color:var(--i4)">${escapeHtml(g.spec || '-')}</td>
            <td style="text-align:right;font-weight:700">${g.qty}</td>
            ${split ? `<td style="text-align:right;color:var(--i4)">${g.qtyBase || '<span style="color:var(--i6)">-</span>'}</td>
            <td style="text-align:right;font-weight:600">${g.qtyExtra || '<span style="color:var(--i6)">-</span>'}</td>` : ''}
            <td style="text-align:right;color:var(--i4)">${g.coN}곳</td>
            <td style="text-align:right">${g.krw ? escapeHtml(fmtMoney(g.krw, 'KRW')) : '<span style="color:var(--i6)">-</span>'}</td>
            <td style="text-align:right">${g.usd ? escapeHtml(fmtMoney(g.usd, 'USD')) : '<span style="color:var(--i6)">-</span>'}</td>
          </tr>
          ${open ? `<tr data-detail><td colspan="${split ? 11 : 9}" style="padding:8px 12px 12px;background:var(--i9)">
            <div style="font-size:var(--fs-10_5);color:var(--i4);margin-bottom:4px">신청 기업 ${g.coN}곳 — 클릭하면 그 기업 정산 탭으로 갑니다</div>
            ${coList(g)}</td></tr>` : ''}`;
        }).join('')}
      </tbody>
      <tfoot>
      ${catBlocks.length > 1 ? catBlocks.map(b => `<tr style="font-weight:600;color:var(--i3);background:var(--i9)">
        <td colspan="5" style="font-size:var(--fs-11)">${escapeHtml(b.cat)} 소계 <span style="font-weight:400;color:var(--i4)">${b.kinds}종</span></td>
        <td style="text-align:right">${b.qty}</td>
        ${split ? `<td style="text-align:right;font-weight:400;color:var(--i4)">${b.qtyBase || '-'}</td>
        <td style="text-align:right">${b.qtyExtra || '-'}</td>` : ''}
        <td></td>
        <td style="text-align:right">${b.krw ? escapeHtml(fmtMoney(b.krw, 'KRW')) : '-'}</td>
        <td style="text-align:right">${b.usd ? escapeHtml(fmtMoney(b.usd, 'USD')) : '-'}</td>
      </tr>`).join('') : ''}
      <tr style="border-top:2px solid var(--i5);font-weight:800">
        <td colspan="5" style="font-size:var(--fs-12)">합계 ${groups.length}종</td>
        <td style="text-align:right">${totQty}</td>
        ${split ? `<td style="text-align:right;font-weight:600;color:var(--i3)">${totBase || '-'}</td>
        <td style="text-align:right">${totExtra || '-'}</td>` : ''}
        <td></td>
        <td style="text-align:right">${totKrw ? escapeHtml(fmtMoney(totKrw, 'KRW')) : '-'}</td>
        <td style="text-align:right">${totUsd ? escapeHtml(fmtMoney(totUsd, 'USD')) : '-'}</td>
      </tr></tfoot></table></div>`;

  const summary = `<div class="uc" style="margin-bottom:14px">
    <div class="uc-ttl">품목별 합계 <span style="font-weight:400;color:var(--i4);font-size:var(--fs-10)">— 발주서에 쓰는 숫자예요. 품목을 클릭하면 신청 기업이 보입니다</span></div>
    ${summaryBody}</div>`;

  const detail = rows.map(({ x, items }) => `
    <div style="background:var(--W);border:1px solid var(--i7);border-radius:var(--rd-10);padding:11px 12px;margin-bottom:7px">
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:5px">
        ${x.booth_no ? `<span class="pill p-blue">부스 ${escapeHtml(x.booth_no)}</span>` : ''}
        <span onclick="openExhDr('${escAttr(x.id)}','billing')" style="cursor:pointer;flex:1;min-width:0">
          <span style="font-size:var(--fs-13);font-weight:700">${escapeHtml(exhNames(x).ko)}</span>${
          exhNames(x).en ? `<span style="font-size:var(--fs-11);color:var(--i4);margin-left:5px">${escapeHtml(exhNames(x).en)}</span>` : ''}</span>
        <span style="font-size:var(--fs-11);color:var(--i4)">${items.length}종</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${items.map(i => `<span class="pill p-gray" title="${escapeHtml(fmtMoney(i.amount, i.currency || 'KRW'))}">${escapeHtml(i.name || '')}${i.qty ? ' ×' + escapeHtml(i.qty) : ''}</span>`).join('')}
      </div>
      ${x.extra_equipment ? `<div style="font-size:var(--fs-11);color:var(--i4);margin-top:5px">메모: ${escapeHtml(x.extra_equipment)}</div>` : ''}
    </div>`).join('');

  /* 내보내기는 exh-export.js가 소유한다 — 이 파일이 그쪽을 import하면 순환
     참조가 되므로(내보내기가 여기 집계 함수를 쓴다) window 경유로 부른다.
     드로어를 다루는 방식과 같다. */
  const actions = `<button class="btn bs" id="exh-export-btn" onclick="exportEquipLedger()"
      title="쓰던 「비품 신청 종합관리대장」 형식(품목표 + 기업×코드 교차표)으로 받습니다">엑셀 내보내기</button>`
    + `<button class="btn bs" id="exh-rental-export-btn" onclick="exportRentalOrder()"
      title="금액 없이, 신청이 들어온 부스만 부스 번호순으로 받습니다 — 렌탈 업체에 보내는 용도">렌탈업체용 다운로드</button>`
    + `<button class="btn bs" onclick="printBoothEquipSheets()"
      title="기업마다 A4 한 장, 영문으로 신청 비품(X배너 포함)·금액을 뽑습니다 — 현장에서 각 부스에 넣어 두는 용도. 미납액이 남은 기업은 합계에 * 표시">부스 비치용 출력</button>`
    + `<button class="btn bp bs" onclick="openNewCatalogItem()">+ 품목 추가</button>`;

  /* 부스 기본 품목이 아직 안 깔린 기업 — 발주 수량이 그만큼 모자란 채로 보인다.
     여기가 그 숫자를 보는 자리라, 모자란 걸 여기서 바로 채울 수 있어야 한다. */
  const pend = activeExhibitors(exhEvent).filter(x => boothItemsPending(x.id));
  const pendNote = pend.length ? `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;
      background:var(--ad);border:1px solid var(--a);border-radius:var(--r);padding:8px 11px;margin-bottom:12px">
    <span style="font-size:var(--fs-11_5);color:var(--i2);flex:1;min-width:180px">
      부스 기본 제공 품목이 아직 안 들어간 기업이 <b>${pend.length}곳</b> 있어요 — 그만큼 발주 수량이 모자랍니다.</span>
    <button class="btn bp bs" style="flex:0 0 auto" onclick="applyBoothItemsToEvent('${escAttr(exhEvent || '')}')">${pend.length}곳에 한 번에 넣기</button>
  </div>` : '';

  return scopeSeg + viewShell(pills, pendNote + summary + `<div class="sct">기업별 신청 내역</div>` + detail, actions);
}

/* «그래픽 현황 — 독립부스·받을 파일 계획·품목별·기업별 진행»은 exh-graphic-views.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
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
    ${st.next ? `<button class="btn bs" style="font-size:var(--fs-10);padding:2px 7px"
      onclick="event.stopPropagation();advanceStage('${escAttr(x.id)}','${field}')"
      title="다음 단계로 넘깁니다">${escapeHtml(st.action)} →</button>` : ''}
    ${st.key ? `<button class="btn bs" style="font-size:var(--fs-10);padding:2px 5px;color:var(--i4)"
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
  // 저장이 안 됐으면(잠금·충돌·실패) 넘긴 적 없는 단계를 기록에 남기지 않는다
  if(!(await patchExh(id, patch, null))?.ok) return;
  trackAction('status', `${STAGE_NAME[field]} 단계`, x.company_name || '',
    `<b>${escapeHtml(x.company_name || '')}</b> ${escapeHtml(STAGE_NAME[field])} ${escapeHtml(st.label)} → ${escapeHtml(nx.label)}`,
    { kind: 'exhibitor', id: x.id, tab: 'progress', field });
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
  if(!(await patchExh(id, { [field]: prev.key }, null))?.ok) return;
  trackAction('status', `${STAGE_NAME[field]} 단계`, x.company_name || '',
    `<b>${escapeHtml(x.company_name || '')}</b> ${escapeHtml(STAGE_NAME[field])} ${escapeHtml(cur.label)} → ${escapeHtml(prev.label)} (되돌림)`,
    { kind: 'exhibitor', id: x.id, tab: 'progress', field });
}


/* 화면의 onclick이 부르는 것 */
window.advanceStage = advanceStage;
window.rewindStage = rewindStage;
window.setEquipScope = setEquipScope;
window.renderEquipView = renderEquipView;   // 탭(exh-tab.js)이 window로 부른다
window.renderMoneyView = renderMoneyView;   // 탭(exh-tab.js)이 window로 부른다
