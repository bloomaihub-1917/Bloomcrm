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
      return `<span style="display:block;font-size:9.5px;color:var(--i5);margin-top:1px">${txt}</span>`;
    };

    const bar = (c) => {
      const pct = c.billed ? Math.round(c.paid / c.billed * 100) : 0;
      return `<div style="height:5px;background:var(--i7);border-radius:3px;overflow:hidden;margin-top:6px">
        <div style="height:100%;width:${pct}%;background:${pct >= 100 ? 'var(--g)' : 'var(--a)'}"></div></div>`;
    };
    const line = (label, c, strong) => `<div style="padding:9px 12px;border-top:1px solid var(--i8)${
        strong ? ';background:var(--i9)' : ''}">
      <div style="display:flex;align-items:baseline;gap:8px">
        <span style="font-size:11.5px;font-weight:${strong ? 700 : 600};color:var(--i2);flex:1">${escapeHtml(label)}</span>
        <span style="font-size:10px;color:var(--i5)">${c.billed ? Math.round(c.paid / c.billed * 100) : 0}%</span>
      </div>
      <div style="display:flex;gap:10px;margin-top:3px;font-variant-numeric:tabular-nums">
        <span style="flex:1;min-width:0"><span style="font-size:9.5px;color:var(--i5);display:block">받아야 할 돈</span>
          <b style="font-size:12.5px">${money(c.billed)}</b></span>
        <span style="flex:1;min-width:0"><span style="font-size:9.5px;color:var(--i5);display:block">받은 돈</span>
          <b style="font-size:12.5px;color:var(--g)">${money(c.paid)}</b>
          ${payMix(c)}</span>
        <span style="flex:1;min-width:0"><span style="font-size:9.5px;color:var(--i5);display:block">안 받은 돈</span>
          <b style="font-size:12.5px;color:${c.unpaid ? 'var(--re)' : 'var(--i5)'}">${money(c.unpaid)}</b></span>
      </div>
      ${bar(c)}
    </div>`;

    /* 통화마다 쓰는 분류 수가 달라(원화는 셋, 달러는 넷) 합계 줄이 서로 다른
       높이에 앉는다. 카드를 세로 플렉스로 두고 합계를 아래로 밀어 두면, 카드가
       같은 높이로 늘어나면서 합계끼리 같은 줄에서 맞는다 — 두 통화의 합계를
       나란히 읽는 게 이 카드를 보는 이유다. */
    return `<div style="flex:1 1 320px;min-width:0;background:var(--W);border:1px solid var(--i6);border-radius:10px;overflow:hidden;display:flex;flex-direction:column">
      <div style="padding:9px 12px;font-family:inherit">
        <span class="pill p-blue">${escapeHtml(cur)}</span>
        <span style="font-size:10.5px;color:var(--i5);margin-left:5px">분류별 수금 현황</span>
      </div>
      ${cats.map(([k, l]) => line(l, catS[cur][k], false)).join('')}
      <div style="margin-top:auto">${line('합계', sum, true)}
        ${catS[cur].__left ? `<div style="padding:0 12px 9px;font-size:10px;color:var(--am);background:var(--i9)">
          항목에 딱 맞지 않은 입금 ${escapeHtml(fmtMoney(catS[cur].__left, cur))} — 받은 돈에 넣지 않았어요</div>` : ''}</div>
    </div>`;
  }).join('');

  const catDash = catCards ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">${catCards}</div>
    <div style="font-size:10.5px;color:var(--i4);margin:-4px 0 14px;line-height:1.6">
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
      ? `<div style="font-size:9.5px;color:var(--re)">기한 ${daysSince(s.due)}일 지남</div>`
      : `<div style="font-size:9.5px;color:var(--i4)">${s.due ? `입금 예정 ~${escapeHtml(s.due.slice(5).replace('-', '/'))}` : '기한 없음'}</div>`;
  };

  /* 참가 취소했는데 낸 돈이 남은 곳. 위 카드와 표는 취소 기업을 빼고 세므로
     여기 따로 적지 않으면 돌려줄 돈이 화면에서 사라진다. */
  const refunds = cancelledExhibitors(exhEvent).map(x => ({ x, pb: refundDue(x) })).filter(r => r.pb);
  const refundBox = refunds.length ? `<div style="background:var(--W);border:1px solid var(--i6);border-left:3px solid var(--am);
      border-radius:8px;padding:9px 12px;margin:-2px 0 14px">
      <div style="font-size:11.5px;font-weight:700;color:var(--i2);margin-bottom:4px">환불 확인 필요 ${refunds.length}곳
        <span style="font-weight:400;color:var(--i4);font-size:10.5px">— 참가 취소했지만 낸 돈이 남아 있어요. 위 집계에는 들어 있지 않습니다.</span></div>
      ${refunds.map(({ x, pb }) => `<div onclick="openExhDr('${escAttr(x.id)}','billing')"
          style="display:flex;gap:8px;font-size:11.5px;padding:3px 0;cursor:pointer">
        <span style="flex:1;min-width:0">${escapeHtml(exhNames(x).ko)}</span>
        ${pb.requested ? `<span style="color:var(--i4);font-size:10.5px">환불 요청 ${escapeHtml(fmtMoney(pb.requested, pb.cur))}</span>` : ''}
        <b style="color:var(--am)">${escapeHtml(fmtMoney(pb.net, pb.cur))}</b></div>`).join('')}
      <div style="font-size:10px;color:var(--i5);margin-top:3px">환불을 입금 기록에 «환불 완료»로 남기면 여기서 빠져요. 돌려주지 않기로 했다면 기업 정산에서 «위약금으로 남김»을 누르세요.</div>
    </div>` : '';

  if(isMobile()) return viewShell(pills, catDash + refundBox + payFilBar + (vrows.length ? '' : noneMsg) + vrows.map(({ x, by }) => {
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
          <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(x.booth_no || '—')}</td>
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
          <td colspan="3" style="font-size:12px">${escapeHtml(c)} 합계
            <span style="font-weight:400;color:var(--i4);font-size:10.5px">${
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
          <td colspan="3" style="font-size:10.5px;color:var(--i4)">${escapeHtml(c)} 비중</td>
          ${used.map(([k]) => `<td style="text-align:right;font-size:10.5px;color:var(--i4)">${
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
  const scopeSeg = `<div class="subbar" style="padding:10px 16px 0"><div class="seg">${EQUIP_SCOPES.map(([v, l]) =>
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
    + catBlocks.map(b => `<span class="pill p-gray" style="font-size:9.5px"
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
      style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:11.5px">
      <span class="pill p-gray" style="min-width:52px;text-align:center">${c.booth ? '부스 ' + escapeHtml(c.booth) : '미배정'}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${
        isMobile() ? ';font-size:12.5px;font-weight:600' : ''}">${escapeHtml(c.name)}</span>
      ${c.base ? `<span style="font-size:10px;color:var(--i4)" title="부스에 딸려 오는 기본 제공분이에요">기본 ${c.base}</span>` : ''}
      <span style="color:var(--i3)">${c.shareOnly ? '<span class="pill p-blue" style="font-size:9px">비용 분담</span>' : c.qty + '개'}</span>
      ${isMobile() ? ''   /* 좁은 화면에서는 금액이 기업명 자리를 먹는다 — 합계는 위 품목 줄에 있다 */
        : `<span style="min-width:88px;text-align:right;font-weight:600">${c.amt ? fmtMoney(c.amt, c.cur) : '-'}</span>`}
    </div>`).join('');

  const summaryBody = isMobile()
    /* 좁은 화면에서는 표를 쓰지 않는다 — 헤더가 숨겨지면서 25 / 7곳 / 187,000원이
       각각 무슨 숫자인지 알 수 없게 된다. 값마다 이름을 붙여 카드로 그린다. */
    ? catBlocks.map(b => `
      <div style="display:flex;align-items:baseline;gap:6px;padding:10px 0 4px;border-bottom:2px solid var(--i7);margin-top:6px">
        <span style="font-size:12px;font-weight:800;color:var(--i2)">${escapeHtml(b.cat)}</span>
        <span style="font-size:10.5px;color:var(--i4)">${b.kinds}종 · ${b.qty}개${
          split && (b.qtyBase || b.qtyExtra) ? ` (기본 ${b.qtyBase} · 추가 ${b.qtyExtra})` : ''}${
          b.krw ? ' · ' + escapeHtml(fmtMoney(b.krw, 'KRW')) : ''}${
          b.usd ? ' · ' + escapeHtml(fmtMoney(b.usd, 'USD')) : ''}</span>
      </div>` + b.gs.map(g => {
      const open = exhUi.equipOpen.has(g.key);
      return `<div style="padding:8px 0;border-bottom:1px solid var(--i8)">
        <div onclick="toggleEquipRow('${escAttr(g.key)}')" style="cursor:pointer">
          <div style="display:flex;align-items:baseline;gap:7px">
            ${g.code ? `<span class="pill ${g.direct ? 'p-teal' : 'p-blue'}" style="font-size:9px">${escapeHtml(g.code)}</span>` : ''}
            <span style="font-size:12.5px;font-weight:600;flex:1;min-width:0">${escapeHtml(g.nameKo)}</span>
            <span style="font-size:15px;font-weight:800">${g.qty}<span style="font-size:10px;font-weight:400;color:var(--i4)">개</span></span>
          </div>
          ${g.nameEn ? `<div style="font-size:10.5px;color:var(--i4)">${escapeHtml(g.nameEn)}</div>` : ''}
          <div style="font-size:10.5px;color:var(--i4);margin-top:2px">
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
            <td style="font-size:11px;font-weight:${first ? '800' : '400'};color:var(${first ? '--i2' : '--i6'})">${
              escapeHtml(g.cat)}</td>
            <td style="font-size:11.5px;font-weight:700;color:var(--i2)">
              <span style="color:var(--a)">${open ? '▾' : '▸'}</span> ${escapeHtml(g.code || '—')}</td>
            <td style="font-size:12.5px;font-weight:600">${escapeHtml(g.nameKo)}
              ${g.excluded ? '<span class="pill p-amber" style="font-size:9px;margin-left:4px" title="우리가 청구하지 않는 항목이라 금액 합계에서 빠져 있어요">청구 제외</span>' : ''}
              ${g.offCatalog ? '<span class="pill p-amber" style="font-size:9px;margin-left:4px" title="카탈로그에 없는 품목 — 직접 입력됐어요">카탈로그 외</span>' : ''}
              ${g.direct ? '<span class="pill p-teal" style="font-size:9px;margin-left:4px" title="신청하면서 직접 적어 품목마스터에 올린 품목이에요 — 단가·규격을 확인해주세요">직접 추가</span>' : ''}</td>
            <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(g.nameEn || '-')}</td>
            <td style="font-size:11px;color:var(--i4)">${escapeHtml(g.spec || '-')}</td>
            <td style="text-align:right;font-weight:700">${g.qty}</td>
            ${split ? `<td style="text-align:right;color:var(--i4)">${g.qtyBase || '<span style="color:var(--i6)">-</span>'}</td>
            <td style="text-align:right;font-weight:600">${g.qtyExtra || '<span style="color:var(--i6)">-</span>'}</td>` : ''}
            <td style="text-align:right;color:var(--i4)">${g.coN}곳</td>
            <td style="text-align:right">${g.krw ? escapeHtml(fmtMoney(g.krw, 'KRW')) : '<span style="color:var(--i6)">-</span>'}</td>
            <td style="text-align:right">${g.usd ? escapeHtml(fmtMoney(g.usd, 'USD')) : '<span style="color:var(--i6)">-</span>'}</td>
          </tr>
          ${open ? `<tr data-detail><td colspan="${split ? 11 : 9}" style="padding:8px 12px 12px;background:var(--i9)">
            <div style="font-size:10.5px;color:var(--i4);margin-bottom:4px">신청 기업 ${g.coN}곳 — 클릭하면 그 기업 정산 탭으로 갑니다</div>
            ${coList(g)}</td></tr>` : ''}`;
        }).join('')}
      </tbody>
      <tfoot>
      ${catBlocks.length > 1 ? catBlocks.map(b => `<tr style="font-weight:600;color:var(--i3);background:var(--i9)">
        <td colspan="5" style="font-size:11px">${escapeHtml(b.cat)} 소계 <span style="font-weight:400;color:var(--i4)">${b.kinds}종</span></td>
        <td style="text-align:right">${b.qty}</td>
        ${split ? `<td style="text-align:right;font-weight:400;color:var(--i4)">${b.qtyBase || '-'}</td>
        <td style="text-align:right">${b.qtyExtra || '-'}</td>` : ''}
        <td></td>
        <td style="text-align:right">${b.krw ? escapeHtml(fmtMoney(b.krw, 'KRW')) : '-'}</td>
        <td style="text-align:right">${b.usd ? escapeHtml(fmtMoney(b.usd, 'USD')) : '-'}</td>
      </tr>`).join('') : ''}
      <tr style="border-top:2px solid var(--i5);font-weight:800">
        <td colspan="5" style="font-size:12px">합계 ${groups.length}종</td>
        <td style="text-align:right">${totQty}</td>
        ${split ? `<td style="text-align:right;font-weight:600;color:var(--i3)">${totBase || '-'}</td>
        <td style="text-align:right">${totExtra || '-'}</td>` : ''}
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
        ${items.map(i => `<span class="pill p-gray" title="${escapeHtml(fmtMoney(i.amount, i.currency || 'KRW'))}">${escapeHtml(i.name || '')}${i.qty ? ' ×' + escapeHtml(i.qty) : ''}</span>`).join('')}
      </div>
      ${x.extra_equipment ? `<div style="font-size:11px;color:var(--i4);margin-top:5px">메모: ${escapeHtml(x.extra_equipment)}</div>` : ''}
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
      background:var(--ad);border:1px solid var(--a);border-radius:8px;padding:8px 11px;margin-bottom:12px">
    <span style="font-size:11.5px;color:var(--i2);flex:1;min-width:180px">
      부스 기본 제공 품목이 아직 안 들어간 기업이 <b>${pend.length}곳</b> 있어요 — 그만큼 발주 수량이 모자랍니다.</span>
    <button class="btn bp bs" style="flex:0 0 auto" onclick="applyBoothItemsToEvent('${escAttr(exhEvent || '')}')">${pend.length}곳에 한 번에 넣기</button>
  </div>` : '';

  return scopeSeg + viewShell(pills, pendNote + summary + `<div class="sct">기업별 신청 내역</div>` + detail, actions);
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
  const baseAny = list.some(x => baseKind(x));
  if(!rows.length && !selfRows.length && !baseAny) return emptyView('그래픽을 주문한 기업이 없어요');

  /* 보기 전환 — 기업별은 "이 회사가 어느 단계인가", 항목별은 "무엇이 아직 안 왔나".
     그래픽은 한 기업이 백월·행잉배너·데스크 랩핑을 함께 주문하므로 기업 한 줄로는
     무엇을 받았는지 체크할 자리가 없다. 그래서 받을 파일 목록을 기본으로 둔다. */
  /* «기본 제공»이 맨 앞이다 — 계약에 들어 있어 기업이 조용해도 우리가 만들어
     세워야 하는 것이라, 안 하면 그만인 추가 주문보다 먼저 본다. 전에는 「기본
     시공」이라는 제 탭을 갖고 있었는데, 거기서 하던 일이 결국 그래픽 파일을
     받아 만드는 일이라 같은 화면으로 들어왔다. */
  const baseN = list.filter(x => baseKind(x)).length;
  const seg = `<div class="subbar" style="padding:10px 16px 0"><div class="seg">
    ${[['base', `기본 제공${baseN ? ` ${baseN}` : ''}`], ['item', '받을 파일'], ['kind', '품목별'], ['co', '기업별 진행'],
       ['self', `독립부스${selfRows.length ? ` ${selfRows.length}` : ''}`]].map(([k, l]) =>
      `<button class="seg-b${exhUi.gView === k ? ' on' : ''}" onclick="setGraphicView('${k}')">${l}</button>`).join('')}
  </div></div>`;

  if(exhUi.gView === 'base') return seg + renderBaseView(list);
  if(exhUi.gView === 'self') return seg + renderSelfBoothView(selfRows);
  if(!rows.length) return seg + emptyView('그래픽을 주문한 기업이 없어요');
  return seg + (exhUi.gView === 'co' ? renderGraphicCoView(rows)
    : exhUi.gView === 'kind' ? renderGraphicKindView(rows)
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
  const nW = list.filter(x => x.work_report_at).length;   // 시공사가 호텔에 낸 작업신고서
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
    + `<span class="pill ${nW === list.length ? 'p-green' : 'p-amber'}" title="${escapeHtml(list.filter(x => !x.work_report_at).map(x => exhNames(x).ko).join(', ') || '모두 제출')}">작업신고서 ${nW}/${list.length}</span>`
    + (nFix ? `<span class="pill p-red" title="${escapeHtml(list.filter(x => x.booth_design_result === 'fix').map(x => exhNames(x).ko).join(', '))}">수정 요청 ${nFix}</span>` : '')
    + (nOk ? `<span class="pill p-green">적합 ${nOk}</span>` : '')
    + (due
      ? `<span class="pill ${due.days < 0 ? 'p-red' : due.days <= 7 ? 'p-amber' : 'p-gray'}">수령 마감 ${escapeHtml(due.date)}${
          due.days < 0 ? ` · ${-due.days}일 지남` : due.days === 0 ? ' · 오늘' : ` · D-${due.days}`}</span>`
      : '');

  const board = `<div class="uc" style="margin:12px 0 10px;padding:11px 14px">
    <div style="display:flex;flex-wrap:wrap;gap:14px 26px">
      ${[['시공사 정보', nB, 'var(--a)'], ['도면·그래픽 수령', nG, 'var(--am)'],
         ['우리 확인', nS, 'var(--am)'], ['적합 판정', nOk, 'var(--g)'], ['호텔 작업신고서', nW, 'var(--a)']].map(([l, v, c]) =>
        `<div style="min-width:150px">
          <div style="font-size:10px;color:var(--i5);font-weight:600">${l}</div>
          <div style="margin-top:4px">${bar(v, list.length, c)}</div></div>`).join('')}
    </div>
    ${nG > nS ? `<div style="font-size:11px;color:var(--am);margin-top:8px">받아 놓고 아직 안 본 도면이 <b>${nG - nS}건</b> 있어요 — 확인해야 적합·수정을 판정할 수 있습니다</div>` : ''}
  </div>`;

  const txt = (x, f, ph, label, w) => `<input class="fi" style="width:${w};padding:3px 6px;font-size:11.5px"
    placeholder="${escapeHtml(ph)}" value="${escapeHtml(x[f] || '')}" onclick="event.stopPropagation()"
    onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr(label)}')">`;
  /* 작업신고서는 냈는지만 본다 — 체크하면 오늘 날짜가 들어가고(언제 체크했는지는
     남는다), 풀면 비운다 */
  const wr = (x) => `<label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:11.5px"
    onclick="event.stopPropagation()"><input type="checkbox"${x.work_report_at ? ' checked' : ''}
    onchange="setExhField('${escAttr(x.id)}','work_report_at',this.checked ? '${td()}' : '','작업신고서 제출')">
    ${x.work_report_at ? '<span style="color:var(--g)">받음</span>' : '<span style="color:var(--i5)">미제출</span>'}</label>`;
  const dt = (x, f, label) => `<input type="date" class="fi" style="width:124px;padding:3px 6px;font-size:11.5px"
    value="${escapeHtml(x[f] || '')}" onclick="event.stopPropagation()"
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
      <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
        <span style="font-size:11px;color:var(--i4);min-width:56px">작업신고</span>${wr(x)}</div>
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
      <th style="min-width:90px" title="시공사가 호텔에 작업신고서를 냈는지">작업신고서</th>
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
          ? `<span class="pill p-green" title="${escapeHtml(c.join(' · '))}">있음</span>`
          : '<span class="pill p-gray" title="기업 상세 › 현장에서 담당자·연락처를 넣을 수 있어요">없음</span>'}</td>
        <td>${dt(x, 'booth_design_received_at', '도면 수령')}</td>
        <td>${dt(x, 'booth_design_checked_at', '도면 확인')}</td>
        <td>${resultCell(x)}</td>
        <td>${wr(x)}</td>
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
  /* 마감을 파일마다 넣지 않는다(대부분 ASAP) — 그래픽 자료를 요청한 지 며칠인지로 본다(follow-up.js) */
  if(!d){
    const x = getExhibitorById(i.exhibitor_id);
    const st = x && exhMailSteps(x.event_id).find(s => s.key === 'graphic');
    const f = st && exhFollowOf(x, st);
    if(f && f.state === 'nudge') return { cls: 'p-amber', text: `리마인더 · 요청 ${f.since}일째`, rank: 1, soon: true };
    if(f) return { cls: 'p-blue', text: `요청 ${f.since}일째`, rank: 2 };
    return { cls: 'p-gray', text: '요청 전', rank: 3 };
  }
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

/* ── 같은 파일은 한 줄로 ──
   신청은 회차별로 갈라 받아야 «몇 차에 무엇이 늘었나»가 남는다. 그런데 파일을
   받을 때 필요한 건 «이 기업에서 이 파일 몇 장»이지 회차가 아니다. 회차가 갈린
   탓에 같은 파일이 두 줄로 앉아 있으면 받았는지 세다가 한 장을 빠뜨린다.

   그래서 화면에서만 묶는다. 기업·품목·마감·받은 날·받은 것 메모가 모두 같을
   때만 합친다 — 하나라도 다르면 그 줄에 무엇을 적어야 할지 알 수 없으니 따로
   둔다. 합친 줄에 마감이나 받은 날을 적으면 묶인 항목 모두에 같이 들어간다. */
function mergeSamePlanRows(rows){
  const out = [];
  const by = new Map();
  rows.forEach(r => {
    const i = r.i;
    const k = [r.x.id, i.catalog_id || `n:${String(i.name || '').trim()}`,
      i.due_at || '', i.received_at || '', i.received_note || '',
      i.currency || 'KRW', String(i.unit_price || '')].join('');
    const q = Number(String(i.qty || '').replace(/[^0-9.-]/g, '')) || 0;
    const a = Number(String(i.amount || '').replace(/[^0-9.-]/g, '')) || 0;
    if(!by.has(k)){
      const m = { ...r, ids: [i.id], qty: q, amt: a, n: 1 };
      by.set(k, m); out.push(m);
      return;
    }
    const m = by.get(k);
    m.ids.push(i.id); m.qty += q; m.amt += a; m.n++;
  });
  return out;
}

function renderGraphicItemView(list){
  const all = mergeSamePlanRows(graphicPlanRows(list));
  if(!all.length) return emptyView('정산 탭에서 그래픽 분류로 항목을 넣으면 여기에 받을 파일로 잡혀요');

  const got  = all.filter(r => r.i.received_at);
  const todo = all.filter(r => !r.i.received_at);
  const late = todo.filter(r => r.d.late);
  const soon = todo.filter(r => r.d.soon);
  const none = todo.filter(r => !String(r.i.due_at || '').trim());

  const shown = exhUi.gFil === 'todo' ? todo
    : exhUi.gFil === 'late' ? todo.filter(r => r.d.late || r.d.soon)
    : exhUi.gFil === 'none' ? none
    : exhUi.gFil === 'got'  ? got : all;

  const fpill = (k, l, n, cls) => `<button class="pill ${exhUi.gFil === k ? cls : 'p-gray'}"
    style="border:0;cursor:pointer${exhUi.gFil === k ? ';outline:2px solid var(--i5)' : ''}"
    onclick="setGraphicFil('${k}')">${l} ${n}</button>`;
  const pills = fpill('all', '전체', all.length, 'p-blue')
    + fpill('todo', '미수령', todo.length, 'p-amber')
    + fpill('late', '지남·리마인더', late.length + soon.length, 'p-red')
    + fpill('none', '마감 없음', none.length, 'p-gray')
    + fpill('got', '받음', got.length, 'p-green');

  /* 마감 일괄 잡기 — 계획은 보통 "이 기업들 다 며칟날까지"로 세운다. 지금 걸러 놓은
     미수령 항목에만 넣는다(이미 받은 것은 건드리지 않는다). */
  const actions = `<input type="date" id="g-bulk-due" class="fi" style="width:140px;padding:4px 7px;font-size:11.5px">
    <button class="btn bs" onclick="applyGraphicDue()"
      title="지금 보고 있는 미수령 항목의 마감일을 한꺼번에 정합니다">마감 일괄 지정</button>
    <button class="btn bp bs" onclick="openNewGraphicOrder()">+ 그래픽 주문 추가</button>`;

  const chk = (r) => `<button onclick="event.stopPropagation();toggleItemReceived('${escAttr(r.ids.join(','))}')"
    title="${r.i.received_at ? '받음 표시를 지웁니다' : '오늘 받은 것으로 표시합니다'}${
      r.n > 1 ? ` — 묶인 ${r.n}줄 모두` : ''}"
    style="width:20px;height:20px;border-radius:5px;line-height:1;flex-shrink:0;cursor:pointer;font-size:12px;font-weight:800;color:#fff;border:1.5px solid ${
      r.i.received_at ? 'var(--g)' : 'var(--i6)'};background:${r.i.received_at ? 'var(--g)' : 'transparent'}">${r.i.received_at ? '✓' : ''}</button>`;

  if(isMobile()) return viewShell(pills, shown.map(r => `
    <div style="background:var(--W);border:1px solid var(--i7);border-radius:10px;padding:11px 12px;margin-bottom:7px">
      <div style="display:flex;align-items:center;gap:8px">
        ${chk(r)}
        <span style="flex:1;min-width:0" onclick="openExhDr('${escAttr(r.x.id)}','graphic')">
          <div style="font-size:12.5px;font-weight:600">${escapeHtml(r.i.name || '(이름 없음)')}${
            r.qty > 1 ? `<span style="font-weight:400;color:var(--i4)"> · ${r.qty}장</span>` : ''}</div>
          <div style="font-size:11px;color:var(--i4)">${escapeHtml(exhNames(r.x).ko)}${
            r.x.booth_no ? ` · 부스 ${escapeHtml(r.x.booth_no)}` : ''}</div>
        </span>
        <span class="pill ${r.d.cls}">${escapeHtml(r.d.text)}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-top:7px">
        <span style="font-size:10.5px;color:var(--i5)">마감</span>
        <input type="date" class="fi" style="${TCELL};width:130px" value="${escapeHtml(r.i.due_at || '')}"
          onchange="setItemField('${escAttr(r.ids.join(','))}','due_at',this.value)">
      </div>
      <input class="fi" style="width:100%;margin-top:5px;padding:4px 8px;font-size:11.5px"
        value="${escapeHtml(r.i.received_note || '')}" placeholder="받은 것 — 예: 백월_최종.ai"
        onchange="setItemField('${escAttr(r.ids.join(','))}','received_note',this.value)">
    </div>`).join('') || emptyView('해당하는 항목이 없어요'), actions);

  return viewShell(pills, `<div class="tw"><table><thead><tr>
      <th style="min-width:30px"></th>
      <th style="min-width:150px">기업</th>
      <th style="min-width:56px">부스</th>
      <th style="min-width:180px">받을 파일</th>
      <th style="min-width:44px;text-align:right">수량</th>
      <th style="width:126px;min-width:126px">마감</th>
      <th style="width:96px;min-width:96px;text-align:center">상태</th>
      <th style="width:126px;min-width:126px">받은 날</th>
      <th style="min-width:200px">받은 것</th>
      <th style="min-width:96px;text-align:right">금액</th>
    </tr></thead><tbody>
    ${shown.map(r => `<tr${r.i.received_at ? ' style="opacity:.72"' : ''}>
      <td>${chk(r)}</td>
      ${coCell(r.x, 'graphic')}
      <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(r.x.booth_no || '—')}</td>
      <td style="font-size:12px">${escapeHtml(r.i.name || '(이름 없음)')}${
        r.n > 1 ? `<span class="pill p-gray" style="font-size:9px;margin-left:4px"
          title="접수 회차가 갈려 ${r.n}줄로 들어왔어요 — 받는 입장에서는 한 장의 파일이라 묶었습니다">${r.n}줄</span>` : ''}</td>
      <td style="text-align:right;font-size:11.5px">${r.qty || ''}</td>
      <td><input type="date" class="fi" style="${TCELL}" value="${escapeHtml(r.i.due_at || '')}"
        onchange="setItemField('${escAttr(r.ids.join(','))}','due_at',this.value)"></td>
      <td style="text-align:center"><span class="pill ${r.d.cls}" style="${TPILL}">${escapeHtml(r.d.text)}</span></td>
      <td><input type="date" class="fi" style="${TCELL}" value="${escapeHtml(r.i.received_at || '')}"
        onchange="setItemField('${escAttr(r.ids.join(','))}','received_at',this.value)"></td>
      <td><input class="fi" style="${TCELL}" value="${escapeHtml(r.i.received_note || '')}"
        placeholder="예: 백월_최종.ai · CMYK" onchange="setItemField('${escAttr(r.ids.join(','))}','received_note',this.value)"></td>
      <td style="text-align:right;font-size:11.5px">${r.amt ? escapeHtml(fmtMoney(r.amt, r.i.currency || 'KRW')) : '-'}</td>
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
  const target = exhUi.gFil === 'none' ? base.filter(r => !String(r.i.due_at || '').trim())
    : exhUi.gFil === 'late' ? base.filter(r => r.d.late || r.d.soon)
    : exhUi.gFil === 'got'  ? [] : base;
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
  const allOpen = groups.every(g => exhUi.equipOpen.has(g.key));
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
  /* 받음 표시 단추 — 좁은 화면에서는 손가락이 닿아야 해서 조금 키운다 */
  const gotBtn = (c, sz) => `<button onclick="event.stopPropagation();toggleItemReceived('${escAttr(c.i.id)}')"
    title="${c.i.received_at ? '받음 표시를 지웁니다' : '오늘 받은 것으로 표시합니다'}"
    style="width:${sz}px;height:${sz}px;border-radius:5px;line-height:1;flex-shrink:0;cursor:pointer;font-size:11px;font-weight:800;color:#fff;border:1.5px solid ${
      c.i.received_at ? 'var(--g)' : 'var(--i6)'};background:${c.i.received_at ? 'var(--g)' : 'transparent'}">${c.i.received_at ? '✓' : ''}</button>`;
  const dueIn = (c, w) => `<input type="date" class="fi" style="width:${w};padding:3px 6px;font-size:11px" value="${escapeHtml(c.i.due_at || '')}"
    onclick="event.stopPropagation()" onchange="setItemField('${escAttr(c.i.id)}','due_at',this.value)">`;

  const coSorted = (g) => g.cos.slice()
    .sort((a, b) => boothOf(a.x) - boothOf(b.x)
      || String(exhNames(a.x).ko).localeCompare(String(exhNames(b.x).ko), 'ko'));

  /* 좁은 화면에서는 한 줄에 다 못 넣는다. 다 넣으려 하면 폭이 고정된 칸들
     (날짜·마감·금액)이 자리를 차지하고, 하나뿐인 늘어나는 칸인 기업명이 0으로
     찌그러져 아예 사라진다 — 정작 «부스 9가 어느 회사인지»가 이 목록을 보는
     이유인데 그것만 없어진다.

     그래서 두 줄로 나눈다. 첫 줄에 누가·몇 장인지, 둘째 줄에 언제까지인지.
     금액은 뺀다 — 좁은 화면에서 이 목록을 볼 때 돈을 보지는 않는다(합계는
     위 품목 줄에 이미 있다). */
  const coList = (g) => coSorted(g).map(c => isMobile() ? `
    <div style="padding:6px 0;border-bottom:1px solid var(--i8)">
      <div style="display:flex;align-items:center;gap:8px">
        ${gotBtn(c, 22)}
        <span class="pill p-gray" style="flex-shrink:0">${c.x.booth_no ? '부스 ' + escapeHtml(c.x.booth_no) : '미배정'}</span>
        <span onclick="event.stopPropagation();openExhDr('${escAttr(c.x.id)}','graphic')"
          style="flex:1;min-width:0;font-size:12.5px;font-weight:600;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(exhNames(c.x).ko)}</span>
        <span style="color:var(--i4);font-size:11.5px;flex-shrink:0">${c.qty}장</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin:5px 0 0 30px">
        ${dueIn(c, '128px')}
        <span class="pill ${c.d.cls}">${escapeHtml(c.d.text)}</span>
      </div>
    </div>` : `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:11.5px">
      ${gotBtn(c, 18)}
      <span class="pill p-gray" style="min-width:52px;text-align:center">${c.x.booth_no ? '부스 ' + escapeHtml(c.x.booth_no) : '미배정'}</span>
      <span onclick="event.stopPropagation();openExhDr('${escAttr(c.x.id)}','graphic')"
        style="flex:1;min-width:0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(exhNames(c.x).ko)}</span>
      <span style="color:var(--i4)">${c.qty}장</span>
      ${dueIn(c, '124px')}
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
    const open = exhUi.equipOpen.has(g.key);
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
        const open = exhUi.equipOpen.has(g.key);
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
            title="${escapeHtml(`${fmtMoney(i.amount, i.currency || 'KRW')}${i.due_at ? ` · 마감 ${i.due_at}` : ''}${
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
  const allOpen = keys.every(k => exhUi.equipOpen.has(k));
  keys.forEach(k => allOpen ? exhUi.equipOpen.delete(k) : exhUi.equipOpen.add(k));
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
      title="${escapeHtml(gi.map(i => `${i.received_at ? '✓' : '·'} ${i.name || ''}${
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
        : `<td><input type="date" class="fi" style="width:100px;padding:3px 5px;font-size:11px" value="${escapeHtml(x[f] || '')}"
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
window.toggleGraphicKindAll = toggleGraphicKindAll;
window.applyGraphicDue = applyGraphicDue;
window.advanceStage = advanceStage;
window.rewindStage = rewindStage;
window.setEquipScope = setEquipScope;
window.renderEquipView = renderEquipView;   // 탭(exh-tab.js)이 window로 부른다
window.renderGraphicView = renderGraphicView;   // 탭(exh-tab.js)이 window로 부른다
window.renderMoneyView = renderMoneyView;   // 탭(exh-tab.js)이 window로 부른다
