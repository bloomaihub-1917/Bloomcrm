/* ══════════════════════════════════════════════════════════════
   features/companies/co-trade.js — 기업 상세 하위 탭 — 참여 이력·담당자·요약·거래
   (modules/company-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { RP } from '../../constants.js';
import { EVENT_LIST, coTab, evColor, evShort } from '../../state.js';
import { escAttr, escapeHtml, leftPill } from '../../utils.js';
import { fmtMoney } from '../exhibition/exh-calc.js';

/* ══════════════════════════════════════════
   기업 상세 탭 바디 — 행사 참여 이력 / 담당자 / 요약 (원본 4554~4610행)
══════════════════════════════════════════ */
function renderCoBody(c){
  const b=document.getElementById('cotb');
  if(!b || !c) return;
  if(coTab===0)b.innerHTML=renderTL(c);
  else if(coTab===1)b.innerHTML=renderCoTrade(c);
  else if(coTab===2)b.innerHTML=renderCoCon(c);
  else b.innerHTML=renderCoSum(c);
}
/* ══════════════════════════════════════════
   거래 — 전시에 쌓인 부스·청구·입금을 기업 관점에서 본다

   같은 값이 전시 탭에도 있지만 거기서는 "이번 행사의 51개사"를 보는 화면이라,
   "이 회사와 그동안 얼마나 거래했나"는 알 수 없었다. 판정과 금액은 전부
   exhibitorTradeFor(→ settleState)에서 오므로 두 탭이 다른 숫자를 말하지 않는다.
══════════════════════════════════════════ */

/* 통화가 섞이면 합산이 거짓말이 된다 — 통화별로 따로 더하고 표시도 나눠 적는다 */
export function tradeTotals(c){
  const by = {};
  (c.trade || []).filter(t => !t.cancelled).forEach(t => {
    const k = t.cur || 'KRW';
    if(!by[k]) by[k] = { billed: 0, paid: 0, balance: 0 };
    by[k].billed  += t.billed;
    by[k].paid    += t.paid;
    by[k].balance += t.balance;
  });
  const curs = Object.keys(by);
  const sum = (f) => curs.reduce((a, k) => a + by[k][f], 0);
  return { by, curs, billed: sum('billed'), paid: sum('paid'), balance: sum('balance') };
}

/* 통화가 하나면 그대로, 섞였으면 통화별로 끊어 적는다.
   합쳐서 한 숫자로 보여주면 원화와 달러를 더한 거짓말이 된다. */
function tradeMoney(t, field){
  if(!t.curs.length) return '-';
  return t.curs.map(k => fmtMoney(t.by[k][field], k)).join(' + ');
}

const TRADE_LABEL = { settled:'완납 처리', paid:'입금 완료', partial:'부분 입금',
  unpaid:'미입금', over:'초과 입금', none:'청구 없음' };
const TRADE_CLS = { settled:'p-gray', paid:'p-green', partial:'p-amber',
  unpaid:'p-red', over:'p-blue', none:'p-gray' };

function renderCoTrade(c){
  const list = (c.trade || []).slice().sort((a, b) => String(b.eventId).localeCompare(String(a.eventId)));
  if(!list.length) return `<div class="empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
    <p>전시 참가·거래 이력 없음</p></div>`;

  const t = tradeTotals(c);
  const head = t.curs.length ? `<div class="cost" style="margin-bottom:14px">
    <div class="cosi"><div class="cosn" style="font-size:var(--fs-15)">${tradeMoney(t, 'billed')}</div><div class="cosl">누적 청구</div></div>
    <div class="cosi"><div class="cosn" style="font-size:var(--fs-15)">${tradeMoney(t, 'paid')}</div><div class="cosl">누적 입금</div></div>
    <div class="cosi"><div class="cosn" style="font-size:var(--fs-15);color:${t.balance > 0 ? 'var(--re)' : 'var(--ge)'}">${tradeMoney(t, 'balance')}</div><div class="cosl">미수금</div></div>
  </div>` : '';

  const rows = list.map(x => {
    const ev = EVENT_LIST.find(e => e.key === x.eventId);
    const col = ev ? ev.color : '#9C9890';
    const pct = x.billed ? Math.min(100, Math.round(x.paid / x.billed * 100)) : 0;
    return `<div class="tlc" style="border-left:3px solid ${col};${x.cancelled ? 'opacity:.55' : ''}">
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:6px">
        <span class="tlev">${escapeHtml(ev ? (ev.short || ev.key) : x.eventId)}</span>
        ${x.cancelled ? '<span class="pill p-gray">참가 취소</span>' : ''}
        ${x.booth ? `<span class="pill p-gray">부스 ${escapeHtml(x.booth)}</span>` : ''}
        ${x.grade ? `<span class="pill p-gold">${escapeHtml(x.grade)}</span>` : ''}
        ${x.openInquiries ? `<span class="pill p-amber">미답변 문의 ${x.openInquiries}</span>` : ''}
        <button class="btn bs" style="margin-left:auto;font-size:var(--fs-10_5)"
          onclick="event.stopPropagation();goToExhibitor('${escAttr(x.exhibitorId)}','${escAttr(x.eventId)}')">전시에서 열기</button>
      </div>
      ${x.billed ? `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:var(--fs-11_5);color:var(--i3)">
          <span class="pill ${TRADE_CLS[x.state] || 'p-gray'}">${escapeHtml(TRADE_LABEL[x.state] || x.state)}</span>
          <span>청구 <b style="color:var(--i1)">${fmtMoney(x.billed, x.cur)}</b></span>
          <span>입금 <b style="color:var(--i1)">${fmtMoney(x.paid, x.cur)}</b></span>
          ${x.balance > 0 ? `<span>미수 <b style="color:var(--re)">${fmtMoney(x.balance, x.cur)}</b></span>` : ''}
          ${x.overdue && x.balance > 0 ? `<span style="color:var(--re)">기한 지남 (${escapeHtml(x.due)})</span>`
            : x.due ? `<span style="color:var(--i4)">기한 ${escapeHtml(x.due)}</span>` : ''}
        </div>
        <div class="br" style="margin-top:7px"><div class="brt"><div class="brf" style="width:${pct}%;background:${
          x.state === 'unpaid' ? 'var(--re)' : x.state === 'partial' ? 'var(--am)' : 'var(--g)'}"></div></div></div>`
        : '<div style="font-size:var(--fs-11_5);color:var(--i4)">청구 내역 없음</div>'}
    </div>`;
  }).join('');

  return head + rows;
}

/* 기업에서 전시 상세로 바로 넘어간다 — 두 화면을 오가며 다시 찾을 필요가 없다 */
export function goToExhibitor(exhId, evKey){
  try {
    window.switchApp('exh', null);
    window.setExhEvent?.(evKey);
    window.renderExh?.();
    setTimeout(() => window.openExhDr?.(exhId, 'billing'), 60);   // 정산 탭으로
  } catch(e){ console.warn('[company-tab] 전시로 이동 실패:', e); }
}

function renderTL(c){
  const addBtn = `<div style="display:flex;justify-content:flex-end;margin-bottom:10px">
    <button class="btn bp" style="font-size:var(--fs-11)" onclick="openAddCoEventModal('${escAttr(c.key)}')">+ 참여 이력 추가</button>
  </div>`;
  if(!c.events.length)return addBtn + `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><p>행사 참여 이력 없음</p></div>`;
  const byY={};c.events.forEach(e=>{if(!byY[e.year])byY[e.year]=[];byY[e.year].push(e)});
  return addBtn + `<div class="tl">${Object.entries(byY).sort((a,b)=>b[0]-a[0]).map(([yr,evs])=>`
    <div class="tlyr">${yr}</div>${evs.map(e=>`
      <div class="tlit"><div class="tldt" style="background:${e.color}"></div>
        <div class="tlc">
          <div class="tltp"><div class="tlev">${escapeHtml(e.name)}</div><div class="tldt2">${escapeHtml(e.date)}</div></div>
          <div class="tlloc">📍 ${escapeHtml(e.loc)}</div>
          <div class="tlpl">${e.roles.map(r=>`<span class="pill ${RP[r]||'p-gray'}">${escapeHtml(r)}</span>`).join('')}</div>
          ${e.people.map(p=>`<div class="tlpe"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>${escapeHtml(p)}</div>`).join('')}
          ${e.note?`<div class="tlno">${escapeHtml(e.note)}</div>`:''}
        </div>
      </div>`).join('')}`).join('')}</div>`;
}
function renderCoCon(c){
  if(!c.contacts.length) return `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><p>담당자 없음</p></div>`;
  return c.contacts.map(p => {
    const nm = p.name || p.nameEn || '?';
    const av = nm.slice(0,2);
    const evTags = p.events.map(ev => {
      const color = evColor(ev);
      const short = evShort(ev);
      return `<span class="pill" style="background:${color}18;color:${color};border:1px solid ${color}40;font-size:var(--fs-10)">${escapeHtml(short)}</span>`;
    }).join('');
    const catTag = p.cats.map(ct => `<span class="pill ${RP[ct]||'p-gray'}">${escapeHtml(ct)}</span>`).join('');
    // openContactDr은 crm-tab.js(드로어)가 window에 등록하는 함수 — 이 모듈의 책임 범위 밖
    return `<div class="conc" onclick="openContactDr(${p.id})" style="cursor:pointer">
      <div class="conav">${escapeHtml(av)}</div>
      <div style="flex:1;min-width:0">
        <div class="connm">${escapeHtml(nm)}${p.nameEn && p.name ? `<span style="font-size:var(--fs-11);color:var(--i4);font-weight:400;margin-left:6px">${escapeHtml(p.nameEn)}</span>` : ''}${leftPill(p)}</div>
        <div class="conti">${escapeHtml(p.title||'')}</div>
        <div class="conps" style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px">${evTags}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0">${catTag}</div>
    </div>`;
  }).join('');
}
function renderCoSum(c){
  const rc={};c.events.forEach(e=>e.roles.forEach(r=>{rc[r]=(rc[r]||0)+1}));
  const mx=Math.max(1,...Object.values(rc));
  const bc={'스폰서':'#16A34A','전시기업':'#6D28D9','연사':'#3B5BDB','BD':'#0F766E','참가자':'#9C9890','투자자':'#C97B0A'};
  const yrs=c.events.map(e=>+e.year);
  return`<div class="sg">
    <div class="sc2"><div class="slbl">참여 유형 분포</div>${Object.entries(rc).map(([r,n])=>`<div class="br"><div class="brl">${escapeHtml(r)}</div><div class="brt"><div class="brf" style="width:${Math.round(n/mx*100)}%;background:${bc[r]||'#9C9890'}"></div></div><div class="brv">${n}회</div></div>`).join('')}</div>
    <div class="sc2"><div class="slbl">관계 요약</div><div style="font-size:var(--fs-12);color:var(--i2);line-height:2.1"><div>🗓 첫 참여 <strong>${yrs.length?Math.min(...yrs):'-'}년</strong></div><div>📅 최근 <strong>${yrs.length?Math.max(...yrs):'-'}년</strong></div><div>🎪 총 <strong>${c.events.length}회</strong></div><div>👤 담당자 <strong>${c.contacts.length}명</strong></div></div></div>
  </div>
  <div class="sc2"><div class="slbl" style="margin-bottom:7px">통합 기업명</div><div style="display:flex;gap:4px;flex-wrap:wrap">${c.branches.map(b=>`<span class="btag${b===c.mainBranch?' main':''}">${escapeHtml(b)}</span>`).join('')}</div></div>`;
}


/* 화면의 onclick이 부르는 것 */
window.goToExhibitor = goToExhibitor;
window.tradeTotals = tradeTotals;   // 탭(company-tab.js)이 window로 부른다
window.tradeMoney = tradeMoney;   // 탭(company-tab.js)이 window로 부른다
window.renderCoBody = renderCoBody;   // 탭(company-tab.js)이 window로 부른다
