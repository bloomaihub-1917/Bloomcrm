/* ══════════════════════════════════════════════════════════════
   exh-drawer.js — 전시 참가기업 상세 드로어

   탭 4개: 진행 / 정산 / 그래픽 / 문의·기록
   - 진행: 매뉴얼·신청서·부스·도록·현장 (체크 + 날짜)
   - 정산: 금액 항목(자유 추가) → 인보이스(여러 장) → 세금계산서 → 입금(분할)
   - 그래픽: 주문 여부 → 출력(규격) / 제작(초안→수정안→최종안)
   - 문의·기록: 수시로 들어오는 문의를 받아 적고 답변 여부를 추적

   exh-tab.js를 import하지만 그쪽은 이 파일을 import하지 않는다(단방향).
   exh-tab이 드로어를 다시 그려야 할 때는 window.renderExhDr()로 호출한다.
═══════════════════════════════════════════════════════════════ */

import {
  getExhibitorById, itemsFor, invoicesFor, taxInvoicesFor, paymentsFor, logsFor, openInquiriesFor,
  EXH_CONTACTS, EXH_ITEMS, EXH_INVOICES, EXH_TAX, EXH_PAYMENTS, EXH_LOGS, EXHIBITORS, CO_DB, currentUser,
  contactsFor, catalogFor, catalogItem, EQUIP_CATALOG, findCatalogByName,
  contacts, participations, getOrgById, findOrgByName, ORGS, codeList, codeLabel,
  EXH_APPS, appsFor, openAppFor, isVoided, liveItemsFor, exhEvent, exhibitorsForEvent,
  nextItemSort, EVENT_LIST, nextContactId,
} from '../state.js';
import { td, nowStamp, mailDirPill, escapeHtml, escAttr, countryOptions, leftPill, splitQuotedMail } from '../utils.js';
/* 화면 상태는 ../features/exhibition/exh-drawer-ui.js의 exhDrUi 한곳에 둔다 — 이 탭의 구획을 다른 파일로 떼어도 같은 값을 보게 */
import { exhDrUi } from '../features/exhibition/exh-drawer-ui.js';
/* 보낸 기록 본문 — 이전 메일(인용)은 접어 둔다(utils.js splitQuotedMail) */
export const mailBodyHtml = (body) => {
  const m = splitQuotedMail(body);
  if(!m.head && !m.quoted) return escapeHtml(m.attach || '(본문 없음)');
  return `${escapeHtml(m.head || '(새로 쓴 내용 없음)')}${m.attach ? `\n\n${escapeHtml(m.attach)}` : ''}${m.quoted
    ? `<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--i4);font-size:10.5px">▸ 이전 메일 보기 (${m.quoted.split('\n').length}줄)</summary><div style="margin-top:6px;padding-left:8px;border-left:2px solid var(--i6);color:var(--i3)">${escapeHtml(m.quoted)}</div></details>` : ''}`;
};
import { saveExhContact as _saveExhContact, saveExhItem as _saveExhItem, saveExhInvoice as _saveExhInvoice, saveExhTax as _saveExhTax, saveExhPayment as _saveExhPayment, saveExhLog as _saveExhLog, saveExhApp as _saveExhApp, deleteExhContact as _deleteExhContact, deleteExhItem as _deleteExhItem, deleteExhInvoice as _deleteExhInvoice, deleteExhTax as _deleteExhTax, deleteExhPayment as _deleteExhPayment, deleteExhLog as _deleteExhLog, deleteExhApp as _deleteExhApp, deleteExhibitor as _deleteExhibitor } from '../api/exh-save.js';
import { sendMail, eventMailFrom, fileToBase64, loadMailFiles, mailFilesOf } from '../api/mail-send.js';
import { aiExhAdvice } from '../api/ai.js';
import { exhMailState } from './exh-bulkmail.js';
import { exhFollowOf } from './exh-tab.js';
import { followPill, snoozeFollow, addDays } from '../shared/mail/follow-up.js';

/* 진행 완료된 행사는 열람만 — exh-tab의 가드를 그대로 쓴다.
   판단 기준이 두 군데면 한쪽만 고치는 날이 온다. */
export const saveExhContact = guardWrite(_saveExhContact);
export const saveExhItem = guardWrite(_saveExhItem);
export const saveExhInvoice = guardWrite(_saveExhInvoice);
export const saveExhTax = guardWrite(_saveExhTax);
export const saveExhPayment = guardWrite(_saveExhPayment);
export const saveExhLog = guardWrite(_saveExhLog);
export const saveExhApp = guardWrite(_saveExhApp);
export const deleteExhContact = guardWrite(_deleteExhContact);
export const deleteExhItem = guardWrite(_deleteExhItem);
export const deleteExhInvoice = guardWrite(_deleteExhInvoice);
export const deleteExhTax = guardWrite(_deleteExhTax);
export const deleteExhPayment = guardWrite(_deleteExhPayment);
export const deleteExhLog = guardWrite(_deleteExhLog);
export const deleteExhApp = guardWrite(_deleteExhApp);
export const deleteExhibitor = guardWrite(_deleteExhibitor);

/* 저장이 안 됐을 때 왜 안 됐는지 갈라 말한다. 잠금은 고장이 아닌데
   "네트워크를 확인하세요"라고 하면 엉뚱한 데를 들여다보게 된다.
   잠금은 guardWrite가 이미 이유를 알렸으므로 여기서는 조용히 넘어간다. */
export function saveFailed(res, msg){
  if(res && res.locked) return;
  alert(msg || '저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
}
import { filterMail, mailFilBar, mailStateHtml, mailActionsHtml, mailToggleAttr, isPending, setMailDone } from '../shared/mail/mail-mark.js';
import { decorate as decorateMailPane } from '../shared/mail/mail-pane.js';
import { EXH_MAIL_STEPS, exhMailSteps, exhIsEnglish, fillExhTemplate, exhMailFileStep, exhStepVariants } from './exh-mail.js';
import { libItems, libItem } from '../shared/mail/mail-templates.js';
import { varChipsHtml, registerVarResolver } from '../shared/mail/var-chips.js';
import { aiDraftHtml, registerAiDraft } from '../shared/mail/ai-mail-draft.js';
import './exh-mail-editor.js';
import { trackAction, changed, removed } from '../core/audit-log.js';
import { ieyo } from '../country-signal.js';
import { createOrg } from '../features/companies/co-detail.js';
import { patchOrgFields } from '../domain/org-save.js';
import { normalizeCompanyKey } from '../domain/org-names.js';
import { graphicState, boothTypeOptions, boothTypes, SELF_BUILD_TYPE, exhNames, introLen, bookMissing, introOver, boothDesignState, isSharedBooth, isBookOnly, hostOptions, baseKind, BASE_KINDS, bookName, fasciaName, BOOTH_ORIGIN, BOOTH_EXC, isBoothExc, itemCode, baseRecvAt, baseDoneAt, baseDoneCheck, baseItems, baseRecvItems, guardWrite, exhLocked, setExhLockEv, exhLockNotice, isBoothGiven, boothIncluded, applyBoothItems, boothItemsPending, patchExh, refreshExhViews, exhContact, exhContacts, exhMailCtx, contactsForExhibitor, cleanEmail, progressBar, STEPS, cellState } from './exh-tab.js';
import { modalShell } from '../features/exhibition/exh-book.js';
import { graphicDueInfo } from '../features/exhibition/exh-item-views.js';
import { billedAmount, paidAmount, money, fmtMoney, currencyOf, mixedCurrency, taxNeed, daysSince, CANCELLED, isPendingRefund, isBillable, TAX_STAGES, GRAPHIC_STAGES, stageOf, stageAge, TCELL, TPILL, needsReissue, settleState, liveInvoices, payDueDate, paidBreakdown, invoiceGap, refundDue, eventDeadlines } from '../features/exhibition/exh-calc.js';


/* ── 드로어 탭 ──
   전에는 진행 탭 하나에 담당자·매뉴얼·신청서·부스·도록·현장이 다 들어 있어
   한참 스크롤해야 필요한 칸에 닿았다. 성격이 다른 두 덩어리를 떼어낸다.
     담당자    누구와 연락하나 — 들어올 때 가장 먼저 보는 것
     신청항목  무엇을 신청했나 — 신청서 회수와 누락 확인
     진행      매뉴얼·부스·도록·현장

   탭을 번호로 지목하던 걸 이름으로 바꿨다. 탭을 하나 끼워 넣을 때마다 여기저기
   흩어진 openExhDr(id,'graphic') 같은 호출이 조용히 다른 탭을 열게 된다. */
const TABS = [
  { key: 'contact',  label: '담당자' },
  { key: 'apply',    label: '신청항목' },
  { key: 'progress', label: '진행' },
  { key: 'billing',  label: '정산' },
  { key: 'graphic',  label: '그래픽' },
  { key: 'book',     label: '프로그램북' },
  { key: 'logs',     label: '문의·기록' },
  { key: 'box',      label: '메일함' },
  { key: 'mail',     label: '메일' },
];
/* 옛 번호로 부르는 곳이 남아 있어도 맞는 탭이 열리게 한다 */
const LEGACY_TAB = ['progress', 'billing', 'graphic', 'logs'];
const tabKey = (v) => {
  if(typeof v === 'number') return LEGACY_TAB[v] || TABS[0].key;
  return TABS.some(t => t.key === v) ? v : TABS[0].key;
};

export function openExhDr(id, tab){
  // 다른 기업으로 옮기면 PC에서 고른 메일 첨부를 비운다 — 다음 기업으로 나가지 않게
  if(exhDrUi.drId !== id){ exhDrUi.exhMailFiles = []; exhDrUi.exhSkipDefault = new Set(); exhDrUi.exhReply = null; }
  exhDrUi.drId = id;
  setExhLockEv(getExhibitorById(id)?.event_id);
  if(tab !== undefined) exhDrUi.drTab = tabKey(tab);
  document.getElementById('exh-dr')?.classList.add('on');
  document.getElementById('exh-bd')?.classList.add('on');
  renderExhDr();
}
export function closeExhDr(){
  // 다른 기업으로 옮길 때까지 통화 선택을 끌고 가지 않는다(분류는 유지해도
  // 무리가 없지만 통화는 기업마다 다르다)
  exhDrUi.lastItemCur = null;
  exhDrUi.drId = null;
  exhDrUi.exhReply = null;
  setExhLockEv(null);
  exhDrUi.exhMailFiles = [];
  document.getElementById('exh-dr')?.classList.remove('on');
  document.getElementById('exh-bd')?.classList.remove('on');
}
export function switchExhDT(v){ exhDrUi.drTab = tabKey(v); renderExhDr(); }

/* ── 기업 정보 수정 — 기업DB로 넘긴다 ──

   드로어에서 고칠 수 있는 건 이 행사에서의 진행 상황뿐이다. 사명·국가·업종
   같은 기업 자체의 정보는 기업DB에 있고, 여기서 따로 고치게 만들면 같은 회사가
   화면마다 다른 이름으로 남는다. 그래서 고치는 자리는 하나로 두고 넘겨보낸다.

   org_id가 아직 없는 옛 행은 이름으로 한 번 더 맞춰본다. */
export function openOrgFromExh(exhId){
  const x = getExhibitorById(exhId);
  if(!x) return;
  const org = (x.org_id && getOrgById(x.org_id))
    || findOrgByName(exhNames(x).ko, normalizeCompanyKey)
    || findOrgByName(exhNames(x).en, normalizeCompanyKey);
  if(!org){
    alert('이 참가기업은 아직 기업DB에 연결돼 있지 않아요.\n기업DB에서 먼저 등록한 뒤 다시 열어주세요.');
    return;
  }
  try {
    closeExhDr();
    window.switchApp?.('co');                       // 여기서 기업DB를 다시 만든다
    setTimeout(() => window.selectCo?.(org.id), 60);
  } catch(e){ console.warn('[exh-drawer] 기업DB 이동 실패:', e); }
}

/* 기다리는 요청 — 이 기업에 요청해 두고 아직 못 받은 단계. 공은 기업에 있지만 날이 차면
   리마인더가 우리 일이다(follow-up.js). 어느 탭에 있든 맨 위 한 줄로 본다 */
function exhFollowHtml(x){
  if(x.status === CANCELLED) return '';
  const rows = exhMailSteps(x.event_id).map(s => ({ s, f: exhFollowOf(x, s) })).filter(r => r.f);
  if(!rows.length) return '';
  rows.sort((a, b) => (b.f.state === 'nudge') - (a.f.state === 'nudge'));
  return `<div style="padding:7px 10px;border:1px solid ${rows.some(r => r.f.state === 'nudge') ? 'var(--am)' : 'var(--i6)'};border-radius:8px;margin-bottom:10px;background:var(--W)">
    <div style="font-size:11px;font-weight:700;color:var(--i2);margin-bottom:4px">기다리는 요청</div>
    ${rows.map(({ s, f }) => `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:3px 0">
      <span style="font-size:11.5px;font-weight:600;min-width:96px">${escapeHtml(s.label)}</span>
      ${followPill(f)}
      <span style="margin-left:auto;display:inline-flex;gap:4px">
        ${f.state === 'nudge' ? `<button class="btn bp" style="font-size:10px;padding:1px 8px" onclick="exhAdviceAct('mail','${escAttr(s.key)}')">✉ 리마인더 초안</button>` : ''}
        <button class="btn" style="font-size:10px;padding:1px 6px" title="리마인더를 3일 뒤로" onclick="exhSnooze('${escAttr(s.key)}',3)">+3일</button>
        <button class="btn" style="font-size:10px;padding:1px 6px" title="리마인더를 1주 뒤로" onclick="exhSnooze('${escAttr(s.key)}',7)">+1주</button>
      </span></div>`).join('')}
  </div>`;
}
export async function exhSnooze(stepKey, days){
  const x = getExhibitorById(exhDrUi.drId);
  if(!x) return;
  const until = addDays(td().slice(0, 10), days);
  const why = prompt(`리마인더를 ${until}까지 미룹니다. 이유를 적어 두면 기록에 남아요 (비워도 돼요).`, '');
  if(why === null) return;
  if(!await snoozeFollow('ex', x.id, stepKey, until, why)){ alert('기록에 남기지 못했어요. 잠시 뒤 다시 해주세요.'); return; }
  renderExhDr(); window.renderExh?.();
}
window.exhSnooze = exhSnooze;

export function renderExhDr(){
  if(!exhDrUi.drId) return;
  const x = getExhibitorById(exhDrUi.drId);
  if(!x){ closeExhDr(); return; }

  const openN = openInquiriesFor(x.id).length;
  const billed = billedAmount(x.id), paid = paidAmount(x.id);

  const h = document.getElementById('exh-drh');
  if(h) h.innerHTML = `
    <div style="flex:1;min-width:0">
      <div class="drnm" style="${x.status === CANCELLED ? 'text-decoration:line-through;opacity:.65' : ''}">${escapeHtml(exhNames(x).ko)}${
        exhNames(x).en ? `<span style="font-size:12px;font-weight:400;color:var(--i4);margin-left:6px">${escapeHtml(exhNames(x).en)}</span>` : ''}${
        x.status === CANCELLED ? ' <span class="pill p-gray" style="vertical-align:middle">참가 취소</span>' : ''}</div>
      <div class="drmt">${x.booth_no ? `부스 ${escapeHtml(x.booth_no)}${x.booth_floor ? `(${escapeHtml(x.booth_floor)}층)` : ''}` : ''}${
        (() => { const p = exhContact(x); return (p.name || p.email) ? ` · 담당자 ${escapeHtml(p.name || p.email)}` : ''; })()
        }${billed ? ` · 입금 ${money(paid)}/${money(billed)}` : ''}</div>
    </div>
    <button class="btn bs" style="flex:0 0 auto;margin-right:6px" onclick="openOrgFromExh('${escAttr(x.id)}')"
      title="기업DB에서 이 기업의 정보를 고칩니다">기업 정보 수정</button>
    <button class="drcls" onclick="closeExhDr()">✕</button>`;

  // 신청서가 아직 안 왔거나 정보가 빠졌으면 탭에서 바로 보이게 한다
  const appNeedsWork = !(x.app_received === 'yes' || x.app_received_at) || x.app_complete === 'no';
  const bookMiss = bookMissing(x);   // 도록에 낼 정보 중 아직 안 받은 칸
  // 아직 안 받은 그래픽 — 탭을 열어 보기 전에 받을 게 남았는지 알려 준다
  const gLeft = window.graphicUnreceived(x.id);
  // 처리 안 한 받은 메일 — 메일 탭을 열기 전에 보이게
  const mailLeft = logsFor(x.id).filter(isPending).length;

  const tabsEl = document.getElementById('exh-drtabs');
  if(tabsEl) tabsEl.innerHTML = TABS.map((tb) =>
    `<button class="drtab${exhDrUi.drTab === tb.key ? ' on' : ''}" onclick="switchExhDT('${tb.key}')">${tb.label}${
      tb.key === 'logs' && openN ? ` <span class="pill p-amber">${openN}</span>` : ''}${
      tb.key === 'apply' && appNeedsWork ? ' <span class="pill p-amber">확인</span>' : ''}${
      tb.key === 'book' && bookMiss.length ? ` <span class="pill p-amber">${bookMiss.length}</span>` : ''}${
      tb.key === 'graphic' && gLeft ? ` <span class="pill p-amber">${gLeft}</span>` : ''}${
      tb.key === 'box' && mailLeft ? ` <span class="pill p-amber" title="처리 안 한 받은 메일">${mailLeft}</span>` : ''}</button>`).join('');

  const b = document.getElementById('exh-drbd');
  /* 하위 탭마다 그리는 함수 — 몇은 다른 파일(features/exhibition/exh-dr-*.js)에 있어 부를 때 찾는다 */
  const VIEW = { contact: (x) => window.dContactTab(x), apply: (x) => window.dApply(x), progress: (x) => window.dProgress(x),
    billing: (x) => window.dBilling(x), graphic: (x) => window.dGraphic(x), book: (x) => window.dBook(x), logs: (x) => window.dLogs(x),
    box: (x) => window.dMailBox(x), mail: (x) => window.dMail(x) };
  if(b){
    // 끝난 행사는 드로어도 열람만 — 목록은 잠갔는데 드로어에서 고쳐지면 소용없다
    b.classList.toggle('ro', exhLocked());
    b.innerHTML = exhFollowHtml(x) + window.exhAdviceHtml(x) + (VIEW[exhDrUi.drTab] || VIEW.contact)(x);
    if(exhDrUi.drTab === 'mail'){ window.fillExhMailFrom(x); if(exhDrUi.exhReply) window.fillExhReply(x); else window.fillExhMail(x.id, true); }
  }
  // 메일함 나란히·고정 띠(mail-pane.js)
  decorateMailPane('ex');
}
window.__exhDrId = () => exhDrUi.drId;
window.__exhBoxHtml = (id) => { const x = getExhibitorById(id); return x ? window.dMailBox(x) : ''; };

/* ── 진행 단계 막대 ──
   세금계산서와 그래픽은 우리 손을 떠났다 돌아오기를 반복한다. 어느 칸까지 왔고
   지금 누구 차례인지 한눈에 보이게 하고, 다음 칸으로 넘기는 버튼을 바로 옆에 둔다.
   되돌리기도 함께 둔다 — 잘못 눌렀을 때 고칠 방법이 없으면 누르기를 망설이게 된다. */
export function stageBar(x, field, defs, who){
  const cur = stageOf(defs, x[field]);
  const i = defs.findIndex(d => d.key === cur.key);
  const days = stageAge(x, defs, field);

  return `<div style="margin-bottom:10px">
    <div style="display:flex;gap:3px;margin-bottom:8px">
      ${defs.slice(1).map((d, k) => {
        const done = k + 1 <= i;
        const now = k + 1 === i;
        return `<div style="flex:1;text-align:center;padding:5px 3px;border-radius:5px;font-size:10px;line-height:1.3;
          background:${now ? (d.who === 'us' ? 'var(--rb)' : d.who === 'team' ? 'var(--ab)' : 'var(--gb)') : done ? 'var(--gb)' : 'var(--i9)'};
          color:${now ? (d.who === 'us' ? 'var(--re)' : d.who === 'team' ? 'var(--am)' : 'var(--g)') : done ? 'var(--g)' : 'var(--i5)'};
          font-weight:${now || done ? 700 : 400}">
          ${done && !now ? '✓ ' : ''}${escapeHtml(d.label)}
          ${d.at && x[d.at] ? `<div style="font-size:9px;font-weight:400;opacity:.75">${escapeHtml(String(x[d.at]).slice(5))}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
      <span style="font-size:11.5px;color:${cur.who === 'us' ? 'var(--re)' : cur.who === 'team' ? 'var(--am)' : 'var(--i4)'};font-weight:${cur.who ? 700 : 400}">
        ${cur.who === 'us' ? '내 차례' : cur.who === 'team' ? `${escapeHtml(who)} 확인 중` : cur.key ? '완료' : '아직 시작 전'}
        ${days ? ` · ${days}일째` : ''}</span>
      ${cur.next ? `<button class="btn bp bs" style="margin-left:auto"
        onclick="advanceStage('${escAttr(x.id)}','${field}')">${escapeHtml(cur.action)} →</button>` : ''}
      ${cur.key ? `<button class="btn bs" style="${cur.next ? '' : 'margin-left:auto;'}font-size:10.5px"
        onclick="rewindStage('${escAttr(x.id)}','${field}')">↩ 되돌리기</button>` : ''}
    </div>
  </div>`;
}

/* 세금계산서 전용 단계 막대 — stageBar와 같은 모양이지만, exhibitors 한 행이
   아니라 exhibitor_tax_invoices의 한 줄(v)을 대상으로 한다(여러 장 발행 가능해져
   field가 항상 'stage' 하나뿐이라 advanceTaxStage/rewindTaxStage는 id만 받는다). */
export function taxStageBar(v){
  const cur = stageOf(TAX_STAGES, v.stage);
  const i = TAX_STAGES.findIndex(d => d.key === cur.key);
  const days = cur.at && v[cur.at] ? daysSince(v[cur.at]) : null;

  return `<div>
    <div style="display:flex;gap:3px;margin-bottom:6px">
      ${TAX_STAGES.slice(1).map((d, k) => {
        const done = k + 1 <= i;
        const now = k + 1 === i;
        return `<div style="flex:1;text-align:center;padding:4px 3px;border-radius:5px;font-size:9.5px;line-height:1.3;
          background:${now ? (d.who === 'us' ? 'var(--rb)' : d.who === 'team' ? 'var(--ab)' : 'var(--gb)') : done ? 'var(--gb)' : 'var(--i8)'};
          color:${now ? (d.who === 'us' ? 'var(--re)' : d.who === 'team' ? 'var(--am)' : 'var(--g)') : done ? 'var(--g)' : 'var(--i5)'};
          font-weight:${now || done ? 700 : 400}">
          ${done && !now ? '✓ ' : ''}${escapeHtml(d.label)}
          ${d.at && v[d.at] ? `<div style="font-size:8.5px;font-weight:400;opacity:.75">${escapeHtml(String(v[d.at]).slice(5))}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span style="font-size:10.5px;color:${cur.who === 'us' ? 'var(--re)' : cur.who === 'team' ? 'var(--am)' : 'var(--i4)'};font-weight:${cur.who ? 700 : 400}">
        ${cur.who === 'us' ? '내 차례' : cur.who === 'team' ? '재무팀 확인 중' : cur.key ? '완료' : '아직 시작 전'}
        ${days ? ` · ${days}일째` : ''}</span>
      ${cur.next ? `<button class="btn bp bs" style="margin-left:auto;font-size:10px;padding:2px 7px"
        onclick="advanceTaxStage('${escAttr(v.id)}')">${escapeHtml(cur.action)} →</button>` : ''}
      ${cur.key ? `<button class="btn bs" style="${cur.next ? '' : 'margin-left:auto;'}font-size:9.5px;padding:2px 6px"
        onclick="rewindTaxStage('${escAttr(v.id)}')">↩</button>` : ''}
    </div>
  </div>`;
}

/* ── 공통 조각 ── */
export const sct = (title, inner, extra = '') =>
  `<div class="sct" style="display:flex;align-items:center;gap:8px">${title}${extra}</div><div style="margin-bottom:18px">${inner}</div>`;

/* 체크 + 날짜 한 줄 */
export function dateRow(x, field, label, hint){
  const on = !!x[field];
  return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--i8)">
    <button onclick="toggleExhDate('${escAttr(x.id)}','${field}','${escAttr(label)}')"
      style="width:20px;height:20px;border-radius:5px;border:1.5px solid ${on ? 'var(--g)' : 'var(--i6)'};background:${on ? 'var(--g)' : 'transparent'};color:#fff;font-size:12px;font-weight:800;cursor:pointer;flex-shrink:0;line-height:1">${on ? '✓' : ''}</button>
    <span style="font-size:12.5px;font-weight:${on ? 600 : 500};color:${on ? 'var(--i1)' : 'var(--i3)'};flex:1">${escapeHtml(label)}
      ${hint ? `<span style="font-size:10.5px;color:var(--i5);font-weight:400"> ${escapeHtml(hint)}</span>` : ''}</span>
    <input type="date" class="fi" style="width:140px;padding:4px 8px;font-size:11.5px" value="${escapeHtml(x[field] || '')}"
      onchange="setExhField('${escAttr(x.id)}','${field}',this.value,'${escAttr(label)}')">
  </div>`;
}

/* 여부(플래그) + 날짜를 함께 다루는 줄.
   관리대장에서 넘어온 건은 "받았다"는 사실만 있고 날짜가 없다. 체크는 플래그로
   켜고, 날짜를 알게 되면 그때 채우면 된다(날짜를 넣으면 플래그도 함께 켠다). */
export function flagRow(x, flag, dateField, label, hint){
  const on = x[flag] === 'yes' || !!x[dateField];
  return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--i8)">
    <button onclick="toggleExhFlag('${escAttr(x.id)}','${flag}','${dateField}','${escAttr(label)}')"
      style="width:20px;height:20px;border-radius:5px;border:1.5px solid ${on ? 'var(--g)' : 'var(--i6)'};background:${on ? 'var(--g)' : 'transparent'};color:#fff;font-size:12px;font-weight:800;cursor:pointer;flex-shrink:0;line-height:1">${on ? '✓' : ''}</button>
    <span style="font-size:12.5px;font-weight:${on ? 600 : 500};color:${on ? 'var(--i1)' : 'var(--i3)'};flex:1">${escapeHtml(label)}
      ${hint ? `<span style="font-size:10.5px;color:var(--i5);font-weight:400"> ${escapeHtml(hint)}</span>` : ''}
      ${on && !x[dateField] ? '<span style="font-size:10px;color:var(--i5)"> · 날짜 미상</span>' : ''}</span>
    <input type="date" class="fi" style="width:140px;padding:4px 8px;font-size:11.5px" value="${escapeHtml(x[dateField] || '')}"
      onchange="setExhDateWithFlag('${escAttr(x.id)}','${dateField}','${flag}',this.value,'${escAttr(label)}')">
  </div>`;
}

export function textRow(x, field, label, placeholder = '', multi = false){
  const el = multi
    ? `<textarea class="fi" rows="2" style="font-size:12px" placeholder="${escapeHtml(placeholder)}"
        onchange="setExhField('${escAttr(x.id)}','${field}',this.value,'${escAttr(label)}')">${escapeHtml(x[field] || '')}</textarea>`
    : `<input class="fi" style="font-size:12px" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(x[field] || '')}"
        onchange="setExhField('${escAttr(x.id)}','${field}',this.value,'${escAttr(label)}')">`;
  return `<div class="fg"><label class="fl">${escapeHtml(label)}</label>${el}</div>`;
}

/* 기업 담당자 — 마스터DB의 연락처를 가리키게 하고, 이름/이메일/연락처는
   거기서 실시간으로 읽어 보여준다(값을 복사해두면 마스터DB에서 고쳐도 여기가
   옛 값으로 남는다). 마스터DB에 없는 사람은 직접 입력으로 적는다. */
/* 담당자 역할·등급은 설정에서 고친다(code_lists). 아래는 서버 목록이 아직
   안 왔을 때만 쓰는 기본값이다. */
export const cRoles = () => codeList('contact_role', null,
  ['실무', '정산', '현장', '기타'].map(c => ({ code: c, label: c })));
export const grades = (evKey) => codeList('grade', evKey,
  ['DIA', 'GOLD', 'SILVER', 'BRONZE', 'Exhibitor'].map(c => ({ code: c, label: c })));

/* ── 독립부스 시공사 ──
   자체 시공 업체는 부스를 직접 짓기 때문에, 반입 당일 현장에서 우리가 연락할
   상대가 참가기업 담당자가 아니라 시공사다. 업체명 한 칸만 있어서 그때마다
   연락처를 메일에서 다시 찾아야 했다.

   자체 시공일 때만 펼친다 — 조립부스 업체에게는 채울 일이 없는 칸이라
   모든 기업에 다 보이면 빈칸만 늘어난다. 이미 적어둔 값이 있으면 부스 타입과
   무관하게 보여준다(타입을 나중에 고쳤어도 적어둔 정보가 숨지 않게). */
const BUILDER_FIELDS = [
  ['builder',         '시공사명',   ''],
  ['builder_contact', '시공 담당자', ''],
  ['builder_tel',     '유선번호',   '02-000-0000'],
  ['builder_mobile',  '휴대폰',     '010-0000-0000'],
  ['builder_email',   '이메일',     ''],
];

/* 시공사명은 기업 DB의 벤더시공사에서 고른다 — 목록에 없으면 적은 이름으로
   새로 등록한다. 적힌 글자만 있으면 다음 행사에서 같은 시공사를 찾을 수 없다.
   «직접 설치»는 시공사가 아니라 잇지 않는다. */
const SELF_INSTALL = /^직접\s*설치$/;

/* ── 기입한 값과 기업 DB 값의 관계를 색으로 ──
   초록  두 값이 같다
   노랑  이번 행사에 적은 값이 더 최신이다 → 기업 DB를 갱신할 수 있다
   파랑  기업 DB 값이 더 최신이다(또는 아직 안 받았다) → 확인받고 옮겨 쓸 수 있다
   빨강  기업 DB에 값이 없다(또는 기업 DB와 연결되지 않았다)

   칸마다 고친 시각을 따로 두지 않아서, «더 최신»은 참가기업 행과 기업 행의
   마지막 수정일로 가른다. 같은 날이면 이번에 적은 쪽을 최신으로 본다. */
const SYNC_TONE = {
  same:  { c: 'var(--g)',  b: 'var(--gb)', t: '기업 DB와 같음' },
  mine:  { c: 'var(--am)', b: 'var(--ab)', t: '이번 값이 더 최신' },
  db:    { c: 'var(--a)',  b: 'var(--ad)', t: '기업 DB 값이 더 최신' },
  none:  { c: 'var(--re)', b: 'var(--rb)', t: '기업 DB에 없음' },
};
export const syncNorm = (v) => String(v || '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
function syncState(x, f, org, orgKey){
  if(!org) return 'none';
  const mine = syncNorm(x[f]), db = syncNorm(org[orgKey]);
  if(!db) return 'none';
  if(mine === db) return 'same';
  if(!mine) return 'db';
  return String(x.updated_at || '').slice(0, 10) >= String(org.updated_at || '').slice(0, 10) ? 'mine' : 'db';
}
export function syncTag(x, f, org, orgKey, label){
  const st = syncState(x, f, org, orgKey);
  if(st === 'none' && !syncNorm(x[f]) && org) return '';   // 양쪽 다 비었으면 알릴 게 없다
  const t = SYNC_TONE[st];
  const db = syncNorm(org?.[orgKey]);
  const btn = (txt, on, tip) => `<button class="btn bs" style="font-size:10px;padding:1px 6px;flex:none"
    title="${escapeHtml(tip)}" onclick="${on}">${txt}</button>`;
  const a = `'${escAttr(x.id)}','${f}','${orgKey}','${escAttr(label)}'`;
  const action =
      st === 'db'   ? btn('확인받음 · 쓰기', `useOrgBookValue(${a})`, '기업이 이 값 그대로 쓰겠다고 확인해 줬을 때 누르세요')
    : st === 'mine' ? btn('기업 DB 갱신', `pushToOrg(${a})`, '이번에 받은 값으로 기업 DB를 고칩니다')
    : st === 'none' && org && syncNorm(x[f]) ? btn('기업 DB에 넣기', `pushToOrg(${a})`, '이 값을 기업 DB에 적어 둡니다')
    : '';
  return `<div style="font-size:10.5px;margin-top:3px;padding:3px 6px;border-radius:4px;display:flex;gap:6px;align-items:baseline;
      background:${t.b};border-left:3px solid ${t.c}">
    <span style="flex:none;color:${t.c};font-weight:700">● ${t.t}</span>
    ${db && st !== 'same' ? `<span style="flex:1;min-width:0;color:var(--i4);white-space:pre-line;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical"
      title="${escapeHtml(db)}">${escapeHtml(db)}</span>` : '<span style="flex:1"></span>'}
    ${action}</div>`;
}
/* 참가기업 서랍에서 어느 기업 행을 보는지 — 시공사 칸은 시공사, 나머지는 참가기업 */
export const orgForField = (x, f) => getOrgById(f.startsWith('builder') ? x.builder_org_id : x.org_id);
function builderNameRow(x){
  const org = getOrgById(x.builder_org_id);
  const vendors = ORGS.filter(o => o.kind === '벤더시공사' && (o.name_ko || o.name_en));
  const t = org ? SYNC_TONE.same : SYNC_TONE.none;
  const note = org
    ? `<span style="color:${t.c};font-weight:700">● 기업 DB 연결됨</span>`
    : (String(x.builder || '').trim() && !SELF_INSTALL.test(String(x.builder).trim())
      ? `<span style="color:${t.c};font-weight:700">● 기업 DB에 연결되지 않음</span> <span style="color:var(--i5)">— 다시 입력하면 연결됩니다</span>` : '');
  return `<div class="fg"><label class="fl">시공사명</label>
    <input class="fi" style="font-size:12px" list="builder-orgs" value="${escapeHtml(x.builder || '')}"
      placeholder="기업 DB의 시공사에서 고르거나 새 이름을 적으세요"
      onchange="setBuilderOrg('${escAttr(x.id)}',this.value)">
    <datalist id="builder-orgs">${vendors.map(o => `<option value="${escapeHtml(o.name_ko || o.name_en)}">`).join('')}</datalist>
    ${note ? `<div style="font-size:10.5px;margin-top:3px">${note}</div>` : ''}</div>`;
}
export async function setBuilderOrg(id, value){
  const x = getExhibitorById(id);
  if(!x) return;
  const name = String(value || '').trim();
  if(!name || SELF_INSTALL.test(name)){
    window.setExhField(id, 'builder', name, '시공사명');
    if(x.builder_org_id) window.setExhField(id, 'builder_org_id', '', '시공사 연결');
    return;
  }
  let org = findOrgByName(name, normalizeCompanyKey);
  if(!org){
    const r = await createOrg({ nameKo: name, kind: '벤더시공사' });
    org = r.ok ? getOrgById(r.id) : r.org;
  }
  const patch = { builder: org ? (org.name_ko || org.name_en || name) : name, builder_org_id: org?.id || '' };
  /* 이미 아는 시공사면 대표 번호·메일을 빈 칸에 깔아 준다 */
  if(org?.phone && !String(x.builder_tel || '').trim()) patch.builder_tel = org.phone;
  if(org?.email && !String(x.builder_email || '').trim()) patch.builder_email = org.email;
  await patchExh(id, patch, '시공사명');
}

export function builderBlock(x){
  const isSelf = (x.booth_type || '') === SELF_BUILD_TYPE;
  const hasAny = BUILDER_FIELDS.some(([f]) => String(x[f] || '').trim());
  if(!isSelf && !hasAny){
    return `<div style="font-size:11px;color:var(--i5);padding:6px 0">
      부스 타입이 <b>${escapeHtml(SELF_BUILD_TYPE)}</b>이면 시공사 정보를 적는 칸이 나와요</div>`;
  }
  const bOrg = getOrgById(x.builder_org_id);
  const B_ORG = { builder_tel: 'phone', builder_email: 'email' };
  const row = (f, label, ph) => `<div class="fg"><label class="fl">${escapeHtml(label)}</label>
    <input class="fi" style="font-size:12px" value="${escapeHtml(x[f] || '')}" placeholder="${escapeHtml(ph)}"
      onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr(label)}')">
    ${bOrg && B_ORG[f] ? syncTag(x, f, bOrg, B_ORG[f], label) : ''}</div>`;
  return `<div style="padding:9px 11px;background:var(--i9);border-radius:8px;border-left:3px solid var(--a);margin-bottom:10px">
    <div style="font-size:11px;font-weight:700;color:var(--i2);margin-bottom:7px">
      시공사 정보${isSelf ? '' : ' <span style="font-weight:400;color:var(--i5)">— 부스 타입은 자체 시공이 아니에요</span>'}</div>
    ${builderNameRow(x)}
    <div class="fgr">${row('builder_contact', '시공 담당자', '')}${row('builder_tel', '유선번호', '02-000-0000')}</div>
    <div class="fgr">${row('builder_mobile', '휴대폰', '010-0000-0000')}${row('builder_email', '이메일', '')}</div>
  </div>`;
}

/* «상세 창 독립부스 도면 검토·품목 고르기»은 ../features/exhibition/exh-dr-booth.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* «상세 창 진행 — 신청서 접수 이력·도록·현장»은 ../features/exhibition/exh-dr-progress.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* «상세 창 정산 — 금액 항목·인보이스·세금계산서·입금, 디자인 의뢰»은 ../features/exhibition/exh-dr-billing.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* ══════════════════════════════════════════
   3) 그래픽 — 출력 / 제작 분기
══════════════════════════════════════════ */
/* «참가기업 상세 › 그래픽 피드백·그래픽 항목·부스 기본 제공 예외»은 ../features/exhibition/exh-dr-graphic.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* ══════════════════════════════════════════
   저장 액션 — 낙관적 반영 후 실패 시 롤백
══════════════════════════════════════════ */
export const localId = (p) => `${p}${Date.now()}_${Math.floor(Math.random() * 1000)}`;

/* «상세 창 저장 동작 — 품목·인보이스·입금·세금계산서·정산·담당자, 상황 물어보기»은 ../features/exhibition/exh-dr-actions.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */