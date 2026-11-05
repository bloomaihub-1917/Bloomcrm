/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-dashboard.js — 전시 대시보드
   (modules/exh-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { unent } from '../../modules/audit-describe.js';
import { exhMailSteps } from '../../modules/exh-mail.js';
import { isStale, isUnread, mailCardHtml } from '../../shared/mail/mail-mark.js';
import { auditLog, exhEvent, invoicesFor, logsFor, openInquiriesFor, taxInvoicesFor } from '../../state.js';
import { escAttr, escapeHtml, leftPill, td } from '../../utils.js';
import { CANCELLED, GRAPHIC_STAGES, TAX_STAGES, billableItems, billedAmount, billedByCategory, currencyOf, daysSince, eventDeadlines, fmtMoney, money, num, paidAmount, settleByCurrency, settleState, stageAge, stageOf, taxNeed } from './exh-calc.js';
import { exhUi } from './exh-ui.js';
import { DUE_STEPS, DUE_TAB, STEPS, applyCell, bookOnlyTip, boothAlertHtml, boothTypes, cancelledExhibitors, cellState, dueInfo, exhContacts, exhFollowOf, exhNames, gradeCls, isBookOnly, isReturning, onsiteAddCard, prevOrgKeys, progressBar, progressOf, rawCellState, renderExhSummary, setBoothTypeFil, setStepFil, shortCell, toggleStepWarn } from '../../modules/exh-tab.js';
import { openExhCfg } from './exh-settings-modal.js';

/* ══════════════════════════════════════════
   대시보드 — 기업 하나하나가 아니라 행사 전체를 본다.
   "어디까지 왔나 / 돈은 얼마나 들어왔나 / 오늘 뭘 처리해야 하나" 세 가지에 답한다.
══════════════════════════════════════════ */
/* 단계 완료 수 — 해당 없는 기업(na)은 분모에서 뺀다.
   부스 도면은 독립부스에만, 그래픽은 주문한 곳에만 해당한다. 전체를 분모로
   두면 51곳 중 18곳짜리 단계가 영영 "0/51"로 남아 늘 밀린 것처럼 보인다. */
/* 집계 알약 하나 — 지금 걸려 있는 쪽을 색과 꼬리표로 알린다 */
function stepPill(s, t){
  const on = exhUi.stepFil && exhUi.stepFil.key === s.key;
  const label = escapeHtml(s.label.replace(/<br>/g, ''));
  const cls = on ? (exhUi.stepFil.mode === 'done' ? 'p-blue' : 'p-amber')
    : t.n === t.of ? 'p-green' : 'p-gray';
  const tip = on ? (exhUi.stepFil.mode === 'done' ? '완료한 곳만 보는 중 — 한 번 더 누르면 미완료만'
    : '미완료만 보는 중 — 한 번 더 누르면 전체') : '눌러서 완료한 곳만 보기';
  return `<button class="pill ${cls}" title="${escapeHtml(tip)}"
    style="border:0;cursor:pointer;font:inherit" onclick="setStepFil('${escAttr(s.key)}')">${label} ${
    on ? (exhUi.stepFil.mode === 'done' ? `${t.n}곳` : `${t.of - t.n}곳`) : `${t.n}/${t.of}`}${
    on ? `<span style="margin-left:3px">${exhUi.stepFil.mode === 'done' ? '완료' : '미완료'} ✕</span>` : ''}</button>`;
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
      const m = cash[s.cur] || (cash[s.cur] = { billed:0, paid:0, due:0, n:0 });
      m.billed += s.billed; m.paid += s.paid; m.n++;
      // «완납 처리»한 곳은 더 받을 돈이 없다 — settleState·정산 탭과 같은 기준
      m.due += s.state === 'settled' ? 0 : s.balance;
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
    /* 못 받은 돈 중에는 세금계산서가 없어서 못 받는 것이 섞여 있다. 선발행이
       곧 청구라 «아직 안 한 일»이 아니라 이쪽이 막고 있는 일이다. 완납 뒤
       사후 발행은 여기 올리지 않는다 — 돈은 이미 들어왔고, 단계별 진행에
       숫자로 남는다. */
    const tn = taxNeed(x);
    if(tn.kind === 'pre')   attention.push({ x, why: '세금계산서 ' + tn.why + ' — 발행해야 입금됩니다' });
    if(tn.kind === 'check') attention.push({ x, why: '입금 결제 수단이 안 적혀 세금계산서 발행 여부를 못 정해요' });
  });
  overdue.sort((a, b) => daysSince(b.s.due) - daysSince(a.s.due));

  /* 마감이 걸린 단계 중 아직 못 끝낸 것. 지난 것만 "처리 필요"에 올린다 —
     아직 남은 건 재촉할 일이 아니라 단계별 진행에서 날짜로만 보여준다. */
  /* 요청해 두고 못 받은 단계 — 기다린 만큼 기다렸으면 리마인더가 우리 일이다(follow-up.js).
     요청한 단계는 마감 지남(dueMiss)으로 따로 세지 않는다 — 리마인더 하나로 본다 */
  const remind = [], asked = new Set();
  const mSteps = exhMailSteps(exhEvent);
  all.forEach(x => mSteps.forEach(s => {
    const f = exhFollowOf(x, s);
    if(!f) return;
    asked.add(`${x.id}|${s.due}`);
    if(f.state === 'nudge') remind.push({ x, s, f });
  }));
  remind.sort((a, b) => b.f.since - a.f.since);

  const dueMiss = [];
  DUE_STEPS.forEach(([key, label]) => {
    const d = dueInfo(key, exhEvent);
    if(!d || d.days >= 0) return;
    const st = STEPS.find(s => s.key === key);
    if(!st) return;
    all.forEach(x => {
      const c = rawCellState(x, st);
      if(c.state === 'done' || c.state === 'na') return;
      if(asked.has(`${x.id}|${key}`)) return;
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
  /* 처리 안 한 받은 메일 — 담당자가 보낸 메일을 아무도 안 챙기면 놓친다(규칙은 mail-mark.js) */
  const inbox = [];
  // 처리 필요에는 3일 넘게 처리 안 한 받은 메일만 — 나머지는 «메일함» 카드
  all.forEach(x => logsFor(x.id).filter(isStale).forEach(l => inbox.push({ x, l })));
  inbox.sort((a, b) => String(a.l.ts || '').localeCompare(String(b.l.ts || '')));
  const todo = remind.length + openInq.length + overdue.length + attention.length + myTurn.length + dueMiss.length + inbox.length;
  const curs = Object.keys(cash).filter(c => cash[c].n);   // 상단 KPI(미수금)가 쓰는 값
  /* 미수금은 통화마다 따로 본다 — 원화와 달러를 더한 값으로 색을 정하면
     달러가 남았는데 원화 초과 입금에 묻혀 «다 받음»으로 보일 수 있다. */
  const dueAny = curs.some(c => cash[c].due > 0);

  const card = (label, value, sub, color) => `<div class="cosi" style="flex:1 1 128px">
    <div class="cosn" style="color:${color || 'var(--i1)'}">${value}</div>
    <div class="cosl">${label}</div>
    ${sub ? `<div style="font-size:var(--fs-9_5);color:var(--i5);margin-top:2px">${sub}</div>` : ''}</div>`;

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
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:var(--fs-11);margin-bottom:2px">
        <span style="color:var(--i4)">${label}${sub ? `<span style="color:var(--i5)"> ${sub}</span>` : ''}</span>
        <span style="font-weight:700;color:${color}">${escapeHtml(fmtMoney(v, c))}</span>
      </div>
      <div class="br" style="margin:0 0 7px">
        <div class="brt"><div class="brf" style="width:${Math.round(v / base * 100)}%;background:${color}"></div></div>
      </div>`;

    const rest = m.전체 - m.입금;
    /* 위 «미수금» 카드와 차이를 만드는 기업 — 카드는 기업별 (청구−입금)을 더하고 완납 처리한 곳은 빼지만,
       여기 «남은 금액»은 전체 항목 − 전체 입금이다. 두 계산이 기업마다 얼마나 갈리는지 보인다 */
    const gaps = [];
    all.forEach(x => {
      const s = settleState(x);
      const items = billableItems(x.id).filter(i => (i.currency || 'KRW') === c).reduce((a, i) => a + num(i.amount), 0);
      const restPart = items - (s.cur === c ? s.paid : 0);
      const kpiPart = s.billed && s.cur === c ? (s.state === 'settled' ? 0 : s.balance) : 0;
      const d = Math.round((restPart - kpiPart) * 100) / 100;
      if(Math.abs(d) < 0.005) return;
      const why = s.state === 'settled' && s.cur === c ? `완납 처리 (덜 받은 ${fmtMoney(s.balance, c)})`
        : s.cur !== c ? `다른 통화(${s.cur})가 주 통화라 카드에서 빠짐`
        : s.balance < 0 ? `더 받음 ${fmtMoney(-s.balance, c)} — 카드에서 다른 미수금을 깎음`
        : items !== s.billed ? `청구액(${fmtMoney(s.billed, c)})이 항목 합과 다름` : '';
      gaps.push({ x, d, why });
    });
    gaps.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const gapHtml = gaps.length ? `<details style="margin-top:4px;font-size:var(--fs-10_5)">
        <summary style="cursor:pointer;color:var(--i4)">위 «미수금» 카드와 다른 까닭 — ${gaps.length}곳 · 차이 ${escapeHtml(fmtMoney(gaps.reduce((a, g) => a + g.d, 0), c))}</summary>
        ${gaps.map(g => `<div onclick="openExhDr('${escAttr(g.x.id)}','billing')" style="display:flex;gap:6px;padding:3px 0;cursor:pointer;border-top:1px solid var(--i7)">
          <span style="flex:0 0 40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700">${escapeHtml(exhNames(g.x).ko)}</span>
          <span style="flex:1;color:var(--i4)">${escapeHtml(g.why)}</span>
          <span style="flex:none;font-weight:700">${escapeHtml(fmtMoney(g.d, c))}</span></div>`).join('')}
      </details>` : '';
    return `<div style="margin-bottom:12px">
      <div style="font-size:var(--fs-10_5);color:var(--i4);margin-bottom:4px">${escapeHtml(c)} · ${m.n}곳</div>
      ${bar('전체 금액', m.전체, 'var(--i5)')}
      ${bar('청구한 금액', m.청구, 'var(--a)', `세금계산서 ${m.taxN}곳`)}
      ${bar('입금 완료', m.입금, 'var(--g)')}
      <div style="font-size:var(--fs-10_5);color:${rest > 0 ? 'var(--am)' : 'var(--g)'}">
        ${rest > 0 ? '남은 금액 ' + escapeHtml(fmtMoney(rest, c)) : '전액 입금'}</div>
      ${gapHtml}
    </div>`;
  };

  /* of는 그 단계에 해당하는 기업 수다. 부스 도면은 독립부스에만, 그래픽은
     주문한 곳에만 해당해서 전체(n)를 분모로 두면 영영 100%가 안 된다. */
  const stepRow = (label, done, warn, due, of = n, step = null, warnRows = []) => {
    const pct = of ? Math.round(done / of * 100) : 0;
    // 마감이 지났는데 다 못 끝냈으면 빨갛게, 남았으면 날짜만 조용히 붙인다
    const late = due && due.days < 0 && done < of;
    const open = step && exhUi.stepWarnOpen === step.key;
    /* 경고 숫자를 눌러 펼친 목록. 어느 기업인지, 왜 걸렸는지까지 적는다 —
       기업 이름만 있으면 열어 보기 전엔 무엇을 해야 할지 모른다. */
    const list = open && warnRows.length ? `<div style="margin:-2px 0 8px 83px">
      ${warnRows.map(({ x, text }) => `<div onclick="openExhDr('${escAttr(x.id)}','${
          escAttr(DUE_TAB[step.key] || 'progress')}')"
        style="display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:var(--rd-6);cursor:pointer;background:var(--i9);margin-bottom:3px">
        <span style="font-size:var(--fs-11_5);font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${
          escapeHtml(exhNames(x).ko)}</span>
        ${x.booth_no ? `<span class="pill p-gray" style="flex:0 0 auto">${escapeHtml(x.booth_no)}</span>` : ''}
        ${text ? `<span style="font-size:var(--fs-10_5);color:var(--am);flex:0 0 auto">${escapeHtml(text)}</span>` : ''}
      </div>`).join('')}
    </div>` : '';
    return `<div style="display:flex;align-items:center;gap:9px;margin-bottom:7px">
      <span style="font-size:var(--fs-11_5);color:var(--i3);flex:0 0 74px">${escapeHtml(label)}</span>
      <div style="flex:1;min-width:0">${progressBar(pct, pct === 100 ? 'var(--g)' : late ? 'var(--re)' : 'var(--a)')}</div>
      <span style="font-size:var(--fs-11);color:var(--i4);flex:0 0 48px;text-align:right">${done}/${of}</span>
      <span style="flex:0 0 66px;text-align:right;font-size:var(--fs-10);color:${late ? 'var(--re)' : 'var(--i5)'}">${
        due ? escapeHtml(due.date.slice(5)) + (late ? ` ${-due.days}일↑` : '') : ''}</span>
      ${warn ? `<span class="pill p-amber" style="flex:0 0 auto;cursor:pointer${
          open ? ';outline:2px solid var(--i5)' : ''}"
          onclick="toggleStepWarn('${escAttr(step ? step.key : '')}')"
          title="${open ? '접기' : `걸려 있는 ${warn}곳을 봅니다`}">${warn}</span>`
        : '<span style="flex:0 0 24px"></span>'}
    </div>${list}`;
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
          <div style="font-size:var(--fs-10_5);color:var(--i4);margin-bottom:3px">${f[1]}</div>
          <div style="display:flex;flex-wrap:wrap;gap:5px">
            ${ks.map(k => {
              // 타입은 눌러서 그 부스 기업 목록으로 간다 — 센 숫자를 눌렀는데
              // 아무 일이 없으면 셀 수만 있고 쓸 수는 없는 숫자가 된다
              const clickable = f[0] === 'booth_type';
              return `<span class="pill ${f[0] === 'grade' ? gradeCls(k) : clickable ? 'p-blue' : 'p-gray'}"${
                clickable ? ` onclick="setBoothTypeFil('${escAttr(k)}')" style="cursor:pointer" title="${escapeHtml(k)} 부스 기업 보기"` : ''
              }>${escapeHtml(k)}${f[0] === 'booth_floor' ? '층' : ''} ${cnt[k]}</span>`;
            }).join('')}
          </div></div>`;
      }).join('') || '<div style="font-size:var(--fs-11_5);color:var(--i5)">아직 부스 정보가 없어요</div>'}
    </div>`;

  const cardSteps = `<div class="uc">
      <div class="uc-ttl">단계별 진행
        <button class="btn" onclick="openExhCfg()" style="float:right;height:24px;font-size:var(--fs-10_5);padding:0 8px">마감일 설정</button></div>
      ${STEPS.map(st => {
        const live = all.filter(x => rawCellState(x, st).state !== 'na');
        if(!live.length) return '';
        const done = live.filter(x => rawCellState(x, st).state === 'done').length;
        const warnRows = live.map(x => ({ x, c: rawCellState(x, st) }))
          .filter(r => r.c.state === 'warn')
          .map(r => ({ x: r.x, text: r.c.text || '' }));
        return stepRow(st.label.replace(/<br>/g, ''), done, warnRows.length,
          dueInfo(st.key, exhEvent), live.length, st, warnRows);
      }).join('')}
      ${Object.keys(eventDeadlines(exhEvent)).length ? '' :
        `<div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:6px">마감일을 정해 두면 늦은 기업이 처리 필요에 모입니다</div>`}
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
        font-size:var(--fs-11_5);padding:3px 0${strong ? ';font-weight:800;border-top:1px solid var(--i7);margin-top:2px' : ''}">
        <span style="color:var(--i3)">${label}</span>
        ${cs.map(c => `<span style="text-align:right">${get(c)}</span>`).join('')}
      </div>`;

    return `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--i8)">
      <div style="display:grid;grid-template-columns:44px repeat(${cs.length}, 1fr);gap:6px;
        font-size:var(--fs-10);color:var(--i5);padding-bottom:2px">
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
      <div style="font-size:var(--fs-10_5);color:var(--i4);margin-bottom:4px">부스 타입별 부스 금액</div>
      ${ks.map(k => {
        const m = boothByType[k];
        // 통화 순서를 고정한다 — 줄마다 원화가 먼저 왔다 나중에 왔다 하면 읽기 어렵다
        const amt = ['KRW', 'USD', ...Object.keys(m.cur)]
          .filter((c, i, a) => a.indexOf(c) === i && m.cur[c])
          .map(c => escapeHtml(fmtMoney(m.cur[c], c))).join(' + ') || '-';
        // 타입이 안 정해진 곳은 눌러도 걸 필터가 없다 — 누르는 시늉만 하면 안 된다
        const on = k !== '(타입 미지정)';
        return `<div${on ? ` onclick="setBoothTypeFil('${escAttr(k)}')" title="${escapeHtml(k)} 기업만 보기" style="cursor:pointer;` : ' style="'}${
          'display:flex;justify-content:space-between;gap:6px;font-size:var(--fs-11_5);padding:2px 0"'}>
          <span style="color:var(--i3);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(k)}
            <span style="color:var(--i5);font-size:var(--fs-10)">${m.n}곳</span></span>
          <span style="flex:0 0 auto">${amt}</span>
        </div>`;
      }).join('')}
    </div>`;
  })();

  const cardCash = `<div class="uc">
      <div class="uc-ttl">정산 현황</div>
      ${(() => { const ks = Object.keys(money3).filter(c => money3[c].전체 || money3[c].입금);
        return ks.length ? ks.sort().map(cashRow).join('')
          : '<div style="font-size:var(--fs-11_5);color:var(--i5)">아직 금액 내역이 없어요</div>'; })()}
      ${catBlock}
      ${typeBlock}
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">
        ${STATE_PILLS.filter(p => byState[p[1]]).map(p => `<span class="pill ${p[2]}">${p[0]} ${byState[p[1]]}</span>`).join('')}
      </div>
    </div>`;

  const cardTodo = todo ? `<div class="uc" style="border-left:3px solid var(--am)">
      <div class="uc-ttl">처리 필요 <span class="pill p-amber">${todo}건</span></div>
      ${remind.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 6px">${[...new Set(remind.map(o => o.s.key))].map(k => {
          const r = remind.filter(o => o.s.key === k);
          return `<button class="btn" style="font-size:var(--fs-10_5)" onclick="openExhBulkMail('${escAttr(k)}')"
            title="리마인더 보낼 때가 된 기업을 골라 둔 채로 엽니다">📨 ${escapeHtml(r[0].s.label)} 리마인더 ${r.length}곳 한 번에</button>`; }).join('')}</div>` : ''}
      ${remind.slice(0, 8).map(o => `<div onclick="openExhDr('${escAttr(o.x.id)}','mail');exhAdviceAct('mail','${escAttr(o.s.key)}')"
        style="display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:var(--rd-6);cursor:pointer;background:var(--i9);margin-bottom:4px" title="리마인더 초안 열기">
        <span style="flex:0 0 128px;font-weight:700;font-size:var(--fs-11_5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(exhNames(o.x).ko)}</span>
        <span class="pill p-amber" style="flex:0 0 auto">🔔 ${escapeHtml(o.s.label)}</span>
        <span style="font-size:var(--fs-11_5);color:var(--i3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(o.f.text.replace(/^리마인더 보낼 때 · /, ''))}</span>
      </div>`).join('')}
      ${myTurn.slice(0, 5).map(o => attnRow(o.x, o.label, o.st.action, o.days, o.label === '그래픽' ? 'graphic' : 'billing')).join('')}
      ${inbox.slice(0, 5).map(o => attnRow(o.x, isUnread(o.l) ? '● 안 읽은 메일 3일+' : '받은 메일 3일+', o.l.subject || '', daysSince(o.l.ts), 'box')).join('')}
      ${openInq.slice(0, 5).map(o => attnRow(o.x, '미답변 문의', o.l.subject || o.l.body || '', daysSince(o.l.ts), 'logs')).join('')}
      ${overdue.slice(0, 5).map(o => attnRow(o.x, '입금 기한', fmtMoney(o.s.balance, o.s.cur) + ' 미납', daysSince(o.s.due), 'billing')).join('')}
      ${dueMiss.slice(0, 8).map(o => attnRow(o.x, o.label + ' 마감', `${o.date} 마감 · 아직 안 됨`, o.days, o.tab)).join('')}
      ${attention.slice(0, 5).map(o => attnRow(o.x, '정산 확인', o.why, null, 'billing')).join('')}
      ${todo > 20 ? `<div style="font-size:var(--fs-11);color:var(--i4);padding:6px 2px">외 ${todo - 20}건 — 왼쪽 필터에서 전체를 볼 수 있어요</div>` : ''}
      ${waiting.length ? `<div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:8px;padding-top:7px;border-top:1px solid var(--i8)">
        넘겨 둔 일 ${waiting.length}건 — ${waiting.slice(0, 3).map(w =>
          `${escapeHtml(exhNames(w.x).ko)} ${escapeHtml(w.label)}${w.days ? ` ${w.days}일째` : ''}`).join(' · ')}
        ${waiting.length > 3 ? ` 외 ${waiting.length - 3}건` : ''}</div>` : ''}
    </div>` : `<div class="uc" style="border-left:3px solid var(--g)">
      <div class="uc-ttl">처리 필요</div>
      <div style="font-size:var(--fs-12);color:var(--g)">지금 처리할 게 없어요</div></div>`;

  const cardRecent = (() => {
    // 누가 무엇을 고쳤는지 — 계정 기준으로 최근 변경을 보여준다
    const names = new Set(all.map(x => x.company_name).filter(Boolean));
    const recent = auditLog.filter(l => names.has(l.target))
      .sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 8);
    if(!recent.length) return `<div class="uc"><div class="uc-ttl">최근 변경</div>
      <div style="font-size:var(--fs-11_5);color:var(--i5)">아직 변경 이력이 없어요</div></div>`;
    return `<div class="uc">
      <div class="uc-ttl">최근 변경</div>
      ${recent.map(l => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--i8)">
        <span style="width:22px;height:22px;border-radius:50%;background:${escAttr(l.color || '#9C9890')};color:var(--on);font-size:var(--fs-9);font-weight:700;display:flex;align-items:center;justify-content:center;flex:0 0 auto">${escapeHtml((l.name || '?').slice(0,2))}</span>
        <span style="font-size:var(--fs-11);color:var(--i3);flex:0 0 auto">${escapeHtml(l.name || '')}</span>
        <span style="font-size:var(--fs-11_5);color:var(--i2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(unent((l.detail || '').replace(/<[^>]+>/g, '')))}</span>
        <span style="font-size:var(--fs-10);color:var(--i5);flex:0 0 auto">${escapeHtml(String(l.ts || '').slice(5,10))}</span>
      </div>`).join('')}
      <div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:7px">전체 이력은 <b>로그</b> 탭에서 볼 수 있어요</div>
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
      ${card('미수금', curs.length ? curs.map(c => fmtMoney(cash[c].due, c)).join(' · ') : '-',
        '', dueAny ? 'var(--am)' : 'var(--g)')}
      ${card('처리 필요', todo + '건',
        '문의 ' + openInq.length + ' · 기한 ' + overdue.length + ' · 정산 ' + attention.length
        + (myTurn.length ? ' · 내 차례 ' + myTurn.length : '')
        + (dueMiss.length ? ' · 마감 지남 ' + dueMiss.length : ''),
        todo ? 'var(--re)' : 'var(--g)')}
    </div>

    <div class="exh-dash-third">${cardBooth}</div>
    <div class="exh-dash-third">${cardSteps}</div>
    <div class="exh-dash-third">${cardCash}</div>
    ${(() => { const c = onsiteAddCard(all); return c ? `<div class="exh-dash-wide">${c}</div>` : ''; })()}
    <div class="exh-dash-wide">${mailCardHtml(exhEvent, 'exh')}</div>
    <div class="exh-dash-wide">${cardTodo}</div>
    <div class="exh-dash-side">${cardRecent}</div>
  </div>`;
}

/* 처리 필요 목록의 한 줄 — 눌러서 바로 그 기업의 해당 탭으로 간다 */
function attnRow(x, kind, text, days, tab){
  return `<div onclick="openExhDr('${escAttr(x.id)}','${tab}')"
    style="display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:var(--rd-6);cursor:pointer;background:var(--i9);margin-bottom:4px">
    <span style="flex:0 0 128px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
      <span style="font-weight:700;font-size:var(--fs-11_5)">${escapeHtml(exhNames(x).ko)}</span>${
      exhNames(x).en ? `<span style="font-size:var(--fs-10);color:var(--i4);margin-left:4px">${escapeHtml(exhNames(x).en)}</span>` : ''}</span>
    <span class="pill p-gray" style="flex:0 0 auto">${escapeHtml(kind)}</span>
    <span style="font-size:var(--fs-11_5);color:var(--i3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(text)}</span>
    ${days !== null && days > 0 ? `<span class="pill ${days >= 3 ? 'p-amber' : 'p-gray'}" style="flex:0 0 auto">${days}일</span>` : ''}
  </div>`;
}

/* 모바일 — 기업당 카드 하나. 진행률과 "지금 뭐가 걸려있나"가 먼저 보이게 한다. */
function renderChecklistCards(list, all){
  const keys = prevOrgKeys();
  const backBadge = (x) => isReturning(x, keys)
    ? '<span class="pill p-teal" style="font-size:var(--fs-9)">재참가</span>' : '';
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
    return `<span style="${map};font-size:var(--fs-10);font-weight:600;padding:3px 7px;border-radius:var(--rs);white-space:nowrap">${
      mark ? mark + ' ' : ''}${escapeHtml(label)}</span>`;
  };

  return `<div style="padding:10px 12px 16px">
    ${renderExhSummary(all)}
    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
      ${STEPS.map(s => { const t = stepTally(all, s); return t.of ? stepPill(s, t) : ''; }).join('')}
    </div>
    ${list.length ? `<div style="margin-bottom:10px">
      <button class="btn bs" id="exh-list-export-btn" onclick="exportChecklist()"
        title="지금 보이는 ${list.length}곳의 진행현황을 엑셀로 받습니다">엑셀 다운로드</button>
      <button class="btn bs" onclick="openExhBulkMail()" title="지금 보이는 기업 중 골라 같은 안내를 기업마다 한 통씩 보냅니다">✉ 여러 기업에 메일</button></div>` : ''}
    ${boothAlertHtml(all)}
    ${list.map(x => {
      const p = progressOf(x);
      const openN = openInquiriesFor(x.id).length;
      const billed = billedAmount(x.id), paid = paidAmount(x.id);
      const cur = currencyOf(x.id);
      const pc = exhContacts(x)[0];
      const off = x.status === CANCELLED;
      return `<div onclick="openExhDr('${escAttr(x.id)}')"
        style="background:var(--W);border:1px solid var(--i7);border-radius:var(--rd-10);padding:12px 13px;margin-bottom:8px;cursor:pointer${off ? ';opacity:.55' : ''}">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span class="pill p-gray">${escapeHtml(x.apply_order || '-')}</span>
          <span style="font-size:var(--fs-14);font-weight:700${off ? ';text-decoration:line-through' : ''}">${escapeHtml(exhNames(x).ko)}</span>${
            isBookOnly(x) ? '<span class="pill p-teal">프로그램북만</span>' : ''}${
            exhNames(x).en ? `<span style="font-size:var(--fs-11);color:var(--i4);font-weight:400">${escapeHtml(exhNames(x).en)}</span>` : ''}
          ${off ? '<span class="pill p-gray">참가 취소</span>' : ''}
          ${backBadge(x)}
          ${x.grade && x.grade !== 'Exhibitor' ? `<span class="pill ${gradeCls(x.grade)}">${escapeHtml(x.grade)}</span>` : ''}
          ${openN ? `<span class="pill p-amber" style="margin-left:auto"
            onclick="event.stopPropagation();openExhDr('${escAttr(x.id)}','logs')">문의 ${openN}</span>` : ''}
        </div>
        <div style="font-size:var(--fs-11_5);color:var(--i4);margin-top:3px">
          ${x.booth_no ? `부스 ${escapeHtml(x.booth_no)}${x.booth_floor ? `·${escapeHtml(x.booth_floor)}층` : ''}${x.booth_type ? ` · ${escapeHtml(x.booth_type)}` : ''}` : '부스 미배정'}
          ${pc && (pc.name || pc.email) ? ` · ${escapeHtml(pc.name || pc.email)}${leftPill(pc)}` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin:9px 0 8px">
          <div style="flex:1">${progressBar(p, p === 100 ? 'var(--g)' : 'var(--a)')}</div>
          <span style="font-size:var(--fs-11);font-weight:700;color:var(--i3);min-width:32px;text-align:right">${p}%</span>
        </div>
        ${(() => {
          if(!billed) return '';
          // 통화가 둘이면 줄을 나눠 둘 다, 하나면 그대로 한 줄
          const st = settleByCurrency(x.id);
          const sc = Object.keys(st).filter(c => st[c].billed || st[c].paid).sort();
          if(sc.length < 2) return `<div style="font-size:var(--fs-11_5);margin-bottom:7px">
            입금 <b style="color:${paid >= billed ? 'var(--g)' : 'var(--am)'}">${fmtMoney(paid, cur)}</b>
            <span style="color:var(--i5)"> / ${fmtMoney(billed, cur)}</span></div>`;
          return `<div style="font-size:var(--fs-11_5);margin-bottom:7px">
            ${sc.map(c => `<div>입금 <b style="color:${st[c].balance <= 0 ? 'var(--g)' : 'var(--am)'}">${fmtMoney(st[c].paid, c)}</b>
              <span style="color:var(--i5)"> / ${fmtMoney(st[c].billed, c)}</span></div>`).join('')}
            <div style="font-size:var(--fs-10);color:var(--i5)">결제 수단이 달라 통화가 갈렸어요</div>
          </div>`;
        })()}
        <div style="display:flex;flex-wrap:wrap;gap:4px">${STEPS.map(s => stat(x, s)).join('')}</div>
      </div>`;
    }).join('')}
    ${!list.length ? '<div class="empty" style="padding:30px;text-align:center;font-size:var(--fs-12);color:var(--i4)">조건에 맞는 기업이 없어요</div>' : ''}
  </div>`;
}

function renderChecklistTable(list, all){
  /* 지난 행사에도 왔던 곳에만 배지를 단다. 신규에는 달지 않는다 —
     51줄 중 20줄에 배지가 붙으면 배지가 아니라 배경이 된다. */
  const keys = prevOrgKeys();
  const backBadge = (x) => isReturning(x, keys)
    ? `<span class="pill p-teal" style="font-size:var(--fs-9)" title="${escapeHtml(keys.prev)}에도 참가한 기업이에요">재참가</span>` : '';
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
      <div style="display:inline-flex;flex-direction:column;align-items:center;gap:1px;min-width:44px;padding:3px 4px;border-radius:var(--rs);background:${map.bg}">
        <span style="font-size:var(--fs-12);font-weight:800;color:${map.fg};line-height:1">${map.mark}</span>
        ${c.text ? `<span style="font-size:var(--fs-9);color:${map.fg};line-height:1.1">${escapeHtml(shortCell(c.text))}</span>` : ''}
      </div></td>`;
  };

  const stats = STEPS.map(s => ({ step: s, ...stepTally(all, s) })).filter(s => s.of);

  /* 내보내기는 exh-export.js 소관 — 순환 참조를 피해 window 경유로 부른다.
     부스 현황과 같은 자리·같은 이름으로 둔다(화면마다 다른 곳에 있으면 찾는다). */
  return `<div style="padding:0 16px 16px">
    ${renderExhSummary(all)}
    <div style="display:flex;gap:6px;margin:12px 0;align-items:center;flex-wrap:wrap">
      ${stats.map(s => stepPill(s.step, s)).join('')}
      ${list.length ? `<span style="margin-left:auto;flex:0 0 auto">
        <button class="btn bs" id="exh-list-export-btn" onclick="exportChecklist()"
          title="지금 보이는 ${list.length}곳의 진행현황을 엑셀로 받습니다">엑셀 다운로드</button>
        <button class="btn bs" onclick="openExhBulkMail()" title="지금 보이는 기업 중 골라 같은 안내를 기업마다 한 통씩 보냅니다">✉ 여러 기업에 메일</button></span>` : ''}
    </div>
    <div class="tw"><table><thead><tr>
      <th style="min-width:44px;text-align:right">신청순</th>
      <th style="min-width:150px">기업</th>
      <th style="min-width:88px">기업 담당자</th>
      <th style="min-width:70px">진행률</th>
      ${STEPS.map(s => `<th style="text-align:center;font-size:var(--fs-10);line-height:1.2">${s.label}</th>`).join('')}
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
              <span style="font-weight:700;font-size:var(--fs-12)${off ? ';text-decoration:line-through' : ''}">${escapeHtml(exhNames(x).ko)}</span>${
                exhNames(x).en ? `<span style="font-size:var(--fs-10_5);color:var(--i4);margin-left:4px">${escapeHtml(exhNames(x).en)}</span>` : ''}
              ${off ? '<span class="pill p-gray">참가 취소</span>' : ''}
              ${isBookOnly(x) ? `<span class="pill p-teal" title="${escapeHtml(bookOnlyTip(x))}">프로그램북만</span>` : ''}
              ${backBadge(x)}
              ${x.grade && x.grade !== 'Exhibitor' ? `<span class="pill ${gradeCls(x.grade)}">${escapeHtml(x.grade)}</span>` : ''}
            </div>
            ${x.booth_no ? `<div style="font-size:var(--fs-10);color:var(--i4)">부스 ${escapeHtml(x.booth_no)}${
              x.booth_floor ? ` · ${escapeHtml(x.booth_floor)}층` : ''}${
              x.booth_type ? ` · ${escapeHtml(x.booth_type)}` : ''}${
              x.booth_qty && x.booth_qty !== '1' ? ` ×${escapeHtml(x.booth_qty)}` : ''}</div>` : ''}</td>
        ${(() => {
          const all = exhContacts(x);
          const p = all[0];
          const label = p ? (p.name || p.email || '-') : '-';
          const tip = all.map(c => [c.role, c.name, c.title, c.email, c.phone].filter(Boolean).join(' · ')).join('\n');
          return `<td style="font-size:var(--fs-11);color:var(--i3);max-width:130px" title="${escapeHtml(tip)}">
            <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(label)}</div>
            ${p ? leftPill(p) : ''}
            ${all.length > 1 ? `<div style="font-size:var(--fs-9_5);color:var(--i5)">외 ${all.length - 1}명</div>` : ''}</td>`;
        })()}
        <td>${progressBar(p, p === 100 ? 'var(--g)' : 'var(--a)', '52px')}
            <span style="font-size:var(--fs-10);color:var(--i4)">${p}%</span></td>
        ${STEPS.map(s => cell(x, s)).join('')}
        <td style="text-align:center" onclick="event.stopPropagation();openExhDr('${escAttr(x.id)}','logs')">
          ${openN ? `<span class="pill p-amber">${openN}</span>` : '<span style="color:var(--i6)">·</span>'}</td>
        ${(() => {
          const s = settleState(x);
          if(!s.billed) return '<td style="text-align:right;font-size:var(--fs-11);color:var(--i6)">-</td>';
          const col = (s.state==='paid'||s.state==='settled') ? 'var(--g)'
            : (s.state==='over' ? 'var(--re)' : 'var(--i2)');
          /* 통화가 둘이면 둘 다 적는다. 하나면 통화 표시 없이 그대로 둔다 —
             대부분이 원화라, 다 붙이면 읽을 게 늘기만 한다. */
          const st = settleByCurrency(x.id);
          const sc = Object.keys(st).filter(c => st[c].billed || st[c].paid).sort();
          const two = sc.length > 1;
          return `<td style="text-align:right;font-size:var(--fs-11)">
            ${two ? sc.map(c => `<div><span style="font-size:var(--fs-9);color:var(--i5);margin-right:2px">${escapeHtml(c)}</span>
                <span style="font-weight:700;color:${st[c].balance <= 0 ? 'var(--g)' : 'var(--i2)'}">${money(st[c].paid)}</span>
                <span style="color:var(--i5)"> / ${money(st[c].billed)}</span></div>`).join('')
            : `<span style="font-weight:700;color:${col}">${s.cur==='USD'?'$':''}${money(s.paid)}</span>
            <span style="color:var(--i5)"> / ${money(s.billed)}</span>`}
            ${s.state==='over' ? `<div style="font-size:var(--fs-9_5);color:var(--re)">초과 ${fmtMoney(-s.balance, s.cur)}</div>` : ''}
            ${s.state==='settled' ? '<div style="font-size:var(--fs-9_5);color:var(--g)">완납 처리</div>' : ''}
            ${s.overdue && s.balance>0 ? `<div style="font-size:var(--fs-9_5);color:var(--am)">기한 ${daysSince(s.due)}일 지남</div>` : ''}
            ${two ? '<div title="인보이스는 원화로 받고 엑스렌탈은 해외 카드로 결제해 통화가 갈릴 수 있어요 — 정상입니다" style="font-size:var(--fs-9);color:var(--i5)">결제 수단이 달라요</div>' : ''}
          </td>`;
        })()}
      </tr>`;
    }).join('')}
    </tbody></table></div>
    ${!list.length ? '<div class="empty" style="padding:30px;text-align:center;font-size:var(--fs-12);color:var(--i4)">조건에 맞는 기업이 없어요</div>' : ''}
  </div>`;
}


/* 화면의 onclick이 부르는 것 */
window.renderDashboard = renderDashboard;   // 탭(exh-tab.js)이 window로 부른다
window.renderChecklistCards = renderChecklistCards;   // 탭(exh-tab.js)이 window로 부른다
window.renderChecklistTable = renderChecklistTable;   // 탭(exh-tab.js)이 window로 부른다
