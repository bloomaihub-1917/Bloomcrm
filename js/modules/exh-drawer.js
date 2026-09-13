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
  contacts, participations, getOrgById, codeList, codeLabel,
  EXH_APPS, appsFor, openAppFor, isVoided, liveItemsFor, exhEvent, exhibitorsForEvent,
  nextItemSort,
} from '../state.js';
import { td, escapeHtml, escAttr } from '../utils.js';
import {
  saveExhContact as _saveExhContact, saveExhItem as _saveExhItem, saveExhInvoice as _saveExhInvoice, saveExhTax as _saveExhTax, saveExhPayment as _saveExhPayment, saveExhLog as _saveExhLog, saveExhApp as _saveExhApp,
  deleteExhContact as _deleteExhContact, deleteExhItem as _deleteExhItem, deleteExhInvoice as _deleteExhInvoice, deleteExhTax as _deleteExhTax, deleteExhPayment as _deleteExhPayment, deleteExhLog as _deleteExhLog, deleteExhApp as _deleteExhApp,
  saveEquipCatalog as _saveEquipCatalog, deleteExhibitor as _deleteExhibitor,
} from '../api.js';

/* 진행 완료된 행사는 열람만 — exh-tab의 가드를 그대로 쓴다.
   판단 기준이 두 군데면 한쪽만 고치는 날이 온다. */
const saveExhContact = guardWrite(_saveExhContact);
const saveExhItem = guardWrite(_saveExhItem);
const saveExhInvoice = guardWrite(_saveExhInvoice);
const saveExhTax = guardWrite(_saveExhTax);
const saveExhPayment = guardWrite(_saveExhPayment);
const saveExhLog = guardWrite(_saveExhLog);
const saveExhApp = guardWrite(_saveExhApp);
const deleteExhContact = guardWrite(_deleteExhContact);
const deleteExhItem = guardWrite(_deleteExhItem);
const deleteExhInvoice = guardWrite(_deleteExhInvoice);
const deleteExhTax = guardWrite(_deleteExhTax);
const deleteExhPayment = guardWrite(_deleteExhPayment);
const deleteExhLog = guardWrite(_deleteExhLog);
const deleteExhApp = guardWrite(_deleteExhApp);
const saveEquipCatalog = guardWrite(_saveEquipCatalog);
const deleteExhibitor = guardWrite(_deleteExhibitor);

/* 저장이 안 됐을 때 왜 안 됐는지 갈라 말한다. 잠금은 고장이 아닌데
   "네트워크를 확인하세요"라고 하면 엉뚱한 데를 들여다보게 된다.
   잠금은 guardWrite가 이미 이유를 알렸으므로 여기서는 조용히 넘어간다. */
function saveFailed(res, msg){
  if(res && res.locked) return;
  alert(msg || '저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
}
import { trackAction, changed, removed } from './audit-tab.js';
import {
  billedAmount, paidAmount, graphicState, graphicDueInfo, money, fmtMoney, currencyOf, mixedCurrency, daysSince, CANCELLED,
  isPendingRefund, boothTypeOptions, boothTypes, SELF_BUILD_TYPE, exhNames, isBillable, modalShell,
  TAX_STAGES, GRAPHIC_STAGES, stageOf, stageAge, introLen, bookMissing, introOver, boothDesignState,
  isSharedBooth, isBookOnly, baseKind, BASE_KINDS, bookName, fasciaName,
  guardWrite, exhLocked, exhLockNotice,
  patchExh, refreshExhViews, exhContact, exhContacts, contactsForExhibitor, cleanEmail, progressBar, needsReissue,
  settleState, liveInvoices, payDueDate, paidBreakdown, invoiceGap,
} from './exh-tab.js';

let drId = null;
let drTab = 'contact';

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
];
/* 옛 번호로 부르는 곳이 남아 있어도 맞는 탭이 열리게 한다 */
const LEGACY_TAB = ['progress', 'billing', 'graphic', 'logs'];
const tabKey = (v) => {
  if(typeof v === 'number') return LEGACY_TAB[v] || TABS[0].key;
  return TABS.some(t => t.key === v) ? v : TABS[0].key;
};

export function openExhDr(id, tab){
  drId = id;
  if(tab !== undefined) drTab = tabKey(tab);
  document.getElementById('exh-dr')?.classList.add('on');
  document.getElementById('exh-bd')?.classList.add('on');
  renderExhDr();
}
export function closeExhDr(){
  // 다른 기업으로 옮길 때까지 통화 선택을 끌고 가지 않는다(분류는 유지해도
  // 무리가 없지만 통화는 기업마다 다르다)
  lastItemCur = null;
  drId = null;
  document.getElementById('exh-dr')?.classList.remove('on');
  document.getElementById('exh-bd')?.classList.remove('on');
}
export function switchExhDT(v){ drTab = tabKey(v); renderExhDr(); }

export function renderExhDr(){
  if(!drId) return;
  const x = getExhibitorById(drId);
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
    <button class="drcls" onclick="closeExhDr()">✕</button>`;

  // 신청서가 아직 안 왔거나 정보가 빠졌으면 탭에서 바로 보이게 한다
  const appNeedsWork = !(x.app_received === 'yes' || x.app_received_at) || x.app_complete === 'no';
  const bookMiss = bookMissing(x);   // 도록에 낼 정보 중 아직 안 받은 칸
  // 아직 안 받은 그래픽 — 탭을 열어 보기 전에 받을 게 남았는지 알려 준다
  const gLeft = graphicUnreceived(x.id);

  const tabsEl = document.getElementById('exh-drtabs');
  if(tabsEl) tabsEl.innerHTML = TABS.map((tb) =>
    `<button class="drtab${drTab === tb.key ? ' on' : ''}" onclick="switchExhDT('${tb.key}')">${tb.label}${
      tb.key === 'logs' && openN ? ` <span class="pill p-amber">${openN}</span>` : ''}${
      tb.key === 'apply' && appNeedsWork ? ' <span class="pill p-amber">확인</span>' : ''}${
      tb.key === 'book' && bookMiss.length ? ` <span class="pill p-amber">${bookMiss.length}</span>` : ''}${
      tb.key === 'graphic' && gLeft ? ` <span class="pill p-amber">${gLeft}</span>` : ''}</button>`).join('');

  const b = document.getElementById('exh-drbd');
  const VIEW = { contact: dContactTab, apply: dApply, progress: dProgress,
    billing: dBilling, graphic: dGraphic, book: dBook, logs: dLogs };
  if(b){
    // 끝난 행사는 드로어도 열람만 — 목록은 잠갔는데 드로어에서 고쳐지면 소용없다
    b.classList.toggle('ro', exhLocked());
    b.innerHTML = (VIEW[drTab] || dContactTab)(x);
  }
}

/* ── 진행 단계 막대 ──
   세금계산서와 그래픽은 우리 손을 떠났다 돌아오기를 반복한다. 어느 칸까지 왔고
   지금 누구 차례인지 한눈에 보이게 하고, 다음 칸으로 넘기는 버튼을 바로 옆에 둔다.
   되돌리기도 함께 둔다 — 잘못 눌렀을 때 고칠 방법이 없으면 누르기를 망설이게 된다. */
function stageBar(x, field, defs, who){
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
function taxStageBar(v){
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
const sct = (title, inner, extra = '') =>
  `<div class="sct" style="display:flex;align-items:center;gap:8px">${title}${extra}</div><div style="margin-bottom:18px">${inner}</div>`;

/* 체크 + 날짜 한 줄 */
function dateRow(x, field, label, hint){
  const on = !!x[field];
  return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--i8)">
    <button onclick="toggleExhDate('${escAttr(x.id)}','${field}','${escAttr(label)}')"
      style="width:20px;height:20px;border-radius:5px;border:1.5px solid ${on ? 'var(--g)' : 'var(--i6)'};background:${on ? 'var(--g)' : 'transparent'};color:#fff;font-size:12px;font-weight:800;cursor:pointer;flex-shrink:0;line-height:1">${on ? '✓' : ''}</button>
    <span style="font-size:12.5px;font-weight:${on ? 600 : 500};color:${on ? 'var(--i1)' : 'var(--i3)'};flex:1">${escapeHtml(label)}
      ${hint ? `<span style="font-size:10.5px;color:var(--i5);font-weight:400"> ${escapeHtml(hint)}</span>` : ''}</span>
    <input type="date" class="fi" style="width:140px;padding:4px 8px;font-size:11.5px" value="${escAttr(x[field] || '')}"
      onchange="setExhField('${escAttr(x.id)}','${field}',this.value,'${escAttr(label)}')">
  </div>`;
}

/* 여부(플래그) + 날짜를 함께 다루는 줄.
   관리대장에서 넘어온 건은 "받았다"는 사실만 있고 날짜가 없다. 체크는 플래그로
   켜고, 날짜를 알게 되면 그때 채우면 된다(날짜를 넣으면 플래그도 함께 켠다). */
function flagRow(x, flag, dateField, label, hint){
  const on = x[flag] === 'yes' || !!x[dateField];
  return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--i8)">
    <button onclick="toggleExhFlag('${escAttr(x.id)}','${flag}','${dateField}','${escAttr(label)}')"
      style="width:20px;height:20px;border-radius:5px;border:1.5px solid ${on ? 'var(--g)' : 'var(--i6)'};background:${on ? 'var(--g)' : 'transparent'};color:#fff;font-size:12px;font-weight:800;cursor:pointer;flex-shrink:0;line-height:1">${on ? '✓' : ''}</button>
    <span style="font-size:12.5px;font-weight:${on ? 600 : 500};color:${on ? 'var(--i1)' : 'var(--i3)'};flex:1">${escapeHtml(label)}
      ${hint ? `<span style="font-size:10.5px;color:var(--i5);font-weight:400"> ${escapeHtml(hint)}</span>` : ''}
      ${on && !x[dateField] ? '<span style="font-size:10px;color:var(--i5)"> · 날짜 미상</span>' : ''}</span>
    <input type="date" class="fi" style="width:140px;padding:4px 8px;font-size:11.5px" value="${escAttr(x[dateField] || '')}"
      onchange="setExhDateWithFlag('${escAttr(x.id)}','${dateField}','${flag}',this.value,'${escAttr(label)}')">
  </div>`;
}

function textRow(x, field, label, placeholder = '', multi = false){
  const el = multi
    ? `<textarea class="fi" rows="2" style="font-size:12px" placeholder="${escAttr(placeholder)}"
        onchange="setExhField('${escAttr(x.id)}','${field}',this.value,'${escAttr(label)}')">${escapeHtml(x[field] || '')}</textarea>`
    : `<input class="fi" style="font-size:12px" placeholder="${escAttr(placeholder)}" value="${escAttr(x[field] || '')}"
        onchange="setExhField('${escAttr(x.id)}','${field}',this.value,'${escAttr(label)}')">`;
  return `<div class="fg"><label class="fl">${escapeHtml(label)}</label>${el}</div>`;
}

/* 기업 담당자 — 마스터DB의 연락처를 가리키게 하고, 이름/이메일/연락처는
   거기서 실시간으로 읽어 보여준다(값을 복사해두면 마스터DB에서 고쳐도 여기가
   옛 값으로 남는다). 마스터DB에 없는 사람은 직접 입력으로 적는다. */
/* 담당자 역할·등급은 설정에서 고친다(code_lists). 아래는 서버 목록이 아직
   안 왔을 때만 쓰는 기본값이다. */
const cRoles = () => codeList('contact_role', null,
  ['실무', '정산', '현장', '기타'].map(c => ({ code: c, label: c })));
const grades = (evKey) => codeList('grade', evKey,
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

function builderBlock(x){
  const isSelf = (x.booth_type || '') === SELF_BUILD_TYPE;
  const hasAny = BUILDER_FIELDS.some(([f]) => String(x[f] || '').trim());
  if(!isSelf && !hasAny){
    return `<div style="font-size:11px;color:var(--i5);padding:6px 0">
      부스 타입이 <b>${escapeHtml(SELF_BUILD_TYPE)}</b>이면 시공사 정보를 적는 칸이 나와요</div>`;
  }
  const row = (f, label, ph) => `<div class="fg"><label class="fl">${escapeHtml(label)}</label>
    <input class="fi" style="font-size:12px" value="${escAttr(x[f] || '')}" placeholder="${escAttr(ph)}"
      onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr(label)}')"></div>`;
  return `<div style="padding:9px 11px;background:var(--i9);border-radius:8px;border-left:3px solid var(--a);margin-bottom:10px">
    <div style="font-size:11px;font-weight:700;color:var(--i2);margin-bottom:7px">
      시공사 정보${isSelf ? '' : ' <span style="font-weight:400;color:var(--i5)">— 부스 타입은 자체 시공이 아니에요</span>'}</div>
    ${row('builder', '시공사명', '')}
    <div class="fgr">${row('builder_contact', '시공 담당자', '')}${row('builder_tel', '유선번호', '02-000-0000')}</div>
    <div class="fgr">${row('builder_mobile', '휴대폰', '010-0000-0000')}${row('builder_email', '이메일', '')}</div>
  </div>`;
}

/* ══════════════════════════════════════════
   독립부스 도면 검토

   자체 시공은 부스를 업체가 직접 짓는다. 그래서 시공사 연락처만 있으면 될 것
   같지만, 실제로는 "무엇을 지을 것인가"도 우리가 본다 — 높이 제한, 인접 부스
   가림, 통로 침범, 소방 규정. 2026 KIC만 18곳이 자체 시공이다.

   받았는지 · 봤는지 · 뭐라고 했는지 셋을 남긴다. 오간 말은 새 표를 만들지 않고
   문의·기록에 담는다(그래픽 피드백과 같은 방식) — 도면 얘기만 따로 모아 두면
   이 기업과 무슨 얘기가 오갔나를 두 군데서 봐야 한다.
══════════════════════════════════════════ */
export const boothDesignFeedback = (exhId) =>
  logsFor(exhId).filter(l => l.category === '부스도면' && l.kind === 'note');

function boothDesignBlock(x){
  const isSelf = (x.booth_type || '') === SELF_BUILD_TYPE;
  const has = x.booth_design_received_at || x.booth_design_checked_at
    || x.booth_design_note || boothDesignFeedback(x.id).length;
  /* 조립부스는 우리가 짓는 것이라 도면을 받을 일이 없다. 다만 이미 적어둔 게
     있으면 타입을 나중에 고쳤어도 숨지 않게 그대로 보여준다. */
  if(!isSelf && !has) return '';

  const st = boothDesignState(x);
  const rows = boothDesignFeedback(x.id);
  const me = currentUser?.email || '';
  const dateCell = (f, label) => `<div class="fg"><label class="fl">${label}</label>
    <input type="date" class="fi" style="font-size:12px" value="${escAttr(x[f] || '')}"
      onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${label}')"></div>`;

  return `<div style="padding:9px 11px;background:var(--i9);border-radius:8px;border-left:3px solid ${
      st.state === 'warn' ? 'var(--re)' : st.state === 'done' ? 'var(--g)' : 'var(--a)'};margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px">
      <span style="font-size:11px;font-weight:700;color:var(--i2)">부스 도면 검토</span>
      <span class="pill ${{ none: 'p-gray', todo: 'p-amber', warn: 'p-red', done: 'p-green' }[st.state]}"
        style="font-size:9px">${escapeHtml(st.text)}</span>
      ${isSelf ? '' : '<span style="font-size:10px;color:var(--i5)">부스 타입은 자체 시공이 아니에요</span>'}
    </div>

    <div class="fgr">${dateCell('booth_design_received_at', '도면 받은 날')}${dateCell('booth_design_checked_at', '확인한 날')}</div>

    <div style="margin-top:2px">
      <label class="fl">확인 결과</label>
      <div class="stbs" style="margin:4px 0 8px">
        ${[['', '미확인'], ['ok', '적합'], ['fix', '수정 필요']].map(([v, l]) =>
          `<button class="stb${(x.booth_design_result || '') === v ? ' on' : ''}"
            onclick="setBoothDesignResult('${escAttr(x.id)}','${v}')">${l}</button>`).join('')}
      </div>
      ${textRow(x, 'booth_design_note', '확인 메모 — 무엇을 봤나요',
        '예: 높이 3.5m 초과, 통로 쪽 벽면 후퇴 필요', true)}
    </div>

    <div style="border-top:1px solid var(--i7);margin-top:8px;padding-top:8px">
      <div style="font-size:11px;color:var(--i4);margin-bottom:6px">
        오간 말은 <b>문의·기록</b> 탭에도 함께 남아요. 남기는 사람은
        <b>${escapeHtml(currentUser?.name || currentUser?.email || '(로그인 정보 없음)')}</b>으로 적힙니다.</div>
      <textarea class="fi" id="bdf-${escAttr(x.id)}" rows="2"
        placeholder="예: 시공사에 3.5m 이하로 낮춰 재도면 요청, 9/10까지 회신 약속"
        style="width:100%;resize:vertical;font-size:12px"></textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:6px">
        <button class="btn bp bs" onclick="addBoothDesignFeedback('${escAttr(x.id)}')">피드백 남기기</button>
      </div>
      ${rows.length ? rows.map(l => `
        <div style="padding:7px 0;border-top:1px solid var(--i8)">
          <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap">
            <span style="font-size:11.5px;font-weight:700">${escapeHtml(l.author_name || l.author_email || '알 수 없음')}</span>
            ${l.subject ? `<span class="pill p-gray" style="font-size:9px">${escapeHtml(l.subject)}</span>` : ''}
            <span style="font-size:10px;color:var(--i5)">${escapeHtml(l.ts || '')}</span>
            ${l.author_email && l.author_email === me
              ? `<button class="btn bs" style="margin-left:auto;font-size:10px;padding:1px 6px"
                  onclick="delGraphicFeedback('${escAttr(l.id)}')">삭제</button>` : ''}
          </div>
          <div style="font-size:12px;color:var(--i2);white-space:pre-wrap;margin-top:3px">${escapeHtml(l.body || '')}</div>
        </div>`).join('')
        : '<div style="font-size:11.5px;color:var(--i5);margin-top:8px">아직 남긴 피드백이 없어요</div>'}
    </div>
  </div>`;
}

/* 결과를 누르면 확인한 날도 함께 채운다 — 결과를 적었다는 건 본 것이다.
   날짜를 따로 누르게 하면 절반은 비어 있게 된다. */
export async function setBoothDesignResult(exhId, v){
  const x = getExhibitorById(exhId);
  if(!x) return;
  const patch = { booth_design_result: v };
  if(v && !x.booth_design_checked_at) patch.booth_design_checked_at = td();
  await patchExh(exhId, patch, '부스 도면 확인');
}

export async function addBoothDesignFeedback(exhId){
  const ta = document.getElementById(`bdf-${exhId}`);
  const body = ta?.value.trim() || '';
  if(!body){ ta?.focus(); return; }
  const x = getExhibitorById(exhId);
  const st = boothDesignState(x || {});

  const ok = await addRow(EXH_LOGS, {
    id: localId('XL-'), exhibitor_id: exhId, kind: 'note', ts: td(),
    direction: '', channel: '', counterpart: '', category: '부스도면',
    subject: st.text || '', body, answered_at: '', answer: '', status: 'done',
    author_email: currentUser?.email || '', author_name: currentUser?.name || '',
  }, saveExhLog);

  const el = document.getElementById(`bdf-${exhId}`);
  if(!ok){ if(el){ el.value = body; el.focus(); } return; }
  if(el) el.value = '';
  trackAction('log', '부스 도면 피드백', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> 부스 도면(${escapeHtml(st.text)}): ${escapeHtml(body.slice(0, 40))}`,
    { kind: 'exhibitor', id: x?.id, tab: 'progress' });
}

/* ── 렌탈 비품 카탈로그 ──
   비품 이름을 손으로 적으면 같은 의자가 "접이식 체어", "C-040 Folding Chair",
   "폴딩체어"로 제각각 들어와 발주 합계가 갈라지고 단가도 매번 다시 찾아야 한다.
   행사 카탈로그를 골라 넣으면 이름·규격·단가가 한 번에 채워지고, 어떤 품목인지
   id로 이어져 집계가 표기에 흔들리지 않는다.

   자유 입력도 그대로 둔다 — 카탈로그 밖의 품목(그래픽 랩핑, 전기 등)이 실제로
   들어오기 때문에 목록에 없다고 못 적게 하면 안 된다. */
/* 고른 분류에 맞는 것만 보여준다. 예전에는 비품과 그래픽을 한 목록에 담아
   놓고 분류와 상관없이 늘 같은 걸 띄웠다 — «부스»를 골라 놓고 의자 목록을
   훑게 되고, 거기서 잘못 고르면 분류와 품목이 어긋난 줄이 저장된다.

   차림은 품목코드 순이다. 발주서와 렌탈사 카탈로그가 코드 순이라, 다른
   순서로 두면 눈으로 짚어 가며 맞춰야 한다.

   부스는 카탈로그가 아니라 부스 타입 목록에서 온다(그게 실제로 청구하는
   단위다). 기타는 목록을 주지 않는다 — 카탈로그 밖이라는 뜻이라서, 목록이
   있으면 그게 곧 «여기 있는 걸 골라라»라는 말이 된다. */
const byCode = (a, b) =>
  String(a.code || '힣').localeCompare(String(b.code || '힣'), 'ko', { numeric: true });

function itemCatalogFor(evKey, cat){
  if(cat === 'booth') return boothTypes(evKey)
    .map(t => ({ value: t.code, desc: t.label && t.label !== t.code ? t.label : '', code: t.code }));
  if(cat === 'etc') return [];
  return catalogFor(evKey, cat === 'graphic' ? 'graphic' : 'equip')
    .slice().sort(byCode)
    .map(c => ({
      value: `${c.code} ${c.name_ko}`,
      code: c.code,
      desc: [c.name_en, c.spec, c.price_krw && money(c.price_krw) + '원'].filter(Boolean).join(' · '),
    }));
}

const itemListId = (x, cat) => `eqcat-${escAttr(x.id)}-${cat}`;

function catalogDatalist(x){
  return itemCats().map(({ code: cat }) => {
    const list = itemCatalogFor(x.event_id, cat);
    if(!list.length) return '';
    return `<datalist id="${itemListId(x, cat)}">${list.map(o =>
      `<option value="${escAttr(o.value)}">${escapeHtml(o.desc)}</option>`).join('')}</datalist>`;
  }).join('');
}

/* ── 직접 입력한 비품을 품목마스터에 올린다 ──
   카탈로그에 없는 품목이 실제로 계속 들어온다(행사마다 새 품목, 렌탈사 추가
   품목). 그때마다 이름만 적고 넘어가면 다음 기업이 같은 걸 신청할 때 또 손으로
   적게 되고, 표기가 갈라져 발주 합계가 다시 흩어진다.

   그래서 처음 적을 때 그 행사 품목마스터에 함께 올려 둔다. 다음부터는 목록에서
   골라 쓸 수 있고, 단가도 따라온다. 사람이 확인한 정식 품목과 구분되도록
   note에 '직접 추가'를 남긴다.

   이미 있는 이름이면 새로 만들지 않고 그 품목에 잇는다 — 같은 의자가 두 줄로
   생기면 애초에 카탈로그를 둔 이유가 없어진다. */
async function registerDirectItem(x, name, unitPrice, currency, itemCat){
  const nm = String(name || '').trim();
  if(!nm) return '';

  const dup = findCatalogByName(x.event_id, nm);
  if(dup) return dup.id;   // 표기만 다른 같은 품목

  // 그래픽으로 적은 항목은 그래픽 품목표에 올린다 — 비품 목록에 섞이면
  // 발주할 때 렌탈사에 그래픽을 주문하게 된다
  const kind = itemCat === 'graphic' ? 'graphic' : 'equip';
  const pre = kind === 'graphic' ? 'XG' : 'X';

  // 이름에 코드가 들어 있으면 그대로 쓰고, 없으면 직접 추가용 코드를 만든다
  const m = nm.toUpperCase().match(/\b([A-Z]{1,2}-\d{2,4})\b/);
  const used = new Set(catalogFor(x.event_id).map(c => String(c.code || '').toUpperCase()));
  let code = m ? m[1] : '';
  if(!code || used.has(code)){
    let n = 1;
    while(used.has(`${pre}-${String(n).padStart(3, '0')}`)) n++;
    code = `${pre}-${String(n).padStart(3, '0')}`;
  }

  const isUsd = currency === 'USD';
  const rec = {
    id: localId('EC-'), event_id: x.event_id, kind,
    category: kind === 'graphic' ? '기타그래픽' : '기타비품', code,
    name_ko: /[가-힣]/.test(nm) ? nm : '',
    name_en: /[가-힣]/.test(nm) ? '' : nm,
    spec: '',
    price_krw: isUsd ? '' : String(unitPrice || ''),
    price_usd: isUsd ? String(unitPrice || '') : '',
    note: '직접 추가', active: '',
    sort_order: String(900 + catalogFor(x.event_id).length),
  };

  EQUIP_CATALOG.push(rec);
  const r = await saveEquipCatalog(rec);
  if(!r.ok){
    const i = EQUIP_CATALOG.indexOf(rec);
    if(i >= 0) EQUIP_CATALOG.splice(i, 1);
    return '';   // 품목마스터 등록만 실패 — 신청 항목 자체는 그대로 저장된다
  }
  if(r.id && r.id !== rec.id) rec.id = r.id;
  trackAction('add', '품목 등록', x.company_name || '',
    `<b>${escapeHtml(code)}</b> ${escapeHtml(nm)} — 직접 입력으로 품목마스터에 추가`,
    { kind: 'exhibitor', id: x?.id, tab: 'apply' });
  return rec.id;
}

/* 카탈로그에서 고른 값이면 단가·분류를 대신 채운다. 손으로 적던 값은 건드리지 않는다. */
export function pickCatalogItem(exhId){
  const x = getExhibitorById(exhId);
  if(!x) return;
  const nameEl = document.getElementById(`it-nm-${exhId}`);
  if(!nameEl) return;
  const typed = nameEl.value.trim();
  const hit = catalogFor(x.event_id).find(c => `${c.code} ${c.name_ko}` === typed);
  if(!hit) return;

  const up = document.getElementById(`it-up-${exhId}`);
  const cur = document.getElementById(`it-cur-${exhId}`);
  const cat = document.getElementById(`it-cat-${exhId}`);
  // 품목표에 비품과 그래픽이 함께 있다 — 고른 품목의 종류대로 분류를 맞춰 둔다
  const kind = (hit.kind || 'equip') === 'graphic' ? 'graphic' : 'equip';
  if(cat){ cat.value = kind; lastItemCat = kind; }
  if(up && !up.value.trim()){
    up.value = (cur && cur.value === 'USD') ? (hit.price_usd || '') : (hit.price_krw || '');
  }
  calcItemAmount(exhId);
  nameEl.dataset.catalogId = hit.id;
}

/* ── 남의 회사 사람이 들어왔는지 본다 ──

   실제로 셀타스퀘어 담당자 세 명이 시믹코리아 담당자로 들어간 적이 있다.
   드로어 머리에 기업명이 떠 있어도, 메일에서 이름·주소를 옮겨 적다 보면
   지금 누구 화면인지 놓친다. 사람이 알아채기를 기다리는 대신 화면이 먼저 묻는다.

   판단 근거는 이 기업의 마스터DB 연락처가 쓰는 도메인이다. 근거가 없으면
   (마스터DB에 이메일이 하나도 없으면) 아무 말도 하지 않는다 — 모르면서
   경고하면 다들 무시하게 된다. 회사 메일이 아닌 곳(gmail 등)도 넘어간다. */
const FREE_MAIL = ['gmail.com', 'naver.com', 'daum.net', 'hanmail.net', 'kakao.com',
  'outlook.com', 'hotmail.com', 'icloud.com', 'yahoo.com'];
const mailDomain = (v) => {
  const m = String(v || '').match(/@([^\s>,;]+)/);
  return m ? m[1].toLowerCase().replace(/[^a-z0-9.-]/g, '') : '';
};

function foreignDomain(email, cands){
  const d = mailDomain(email);
  if(!d || FREE_MAIL.includes(d)) return '';
  const own = new Set(cands.map(c => mailDomain(c.email1)).filter(x => x && !FREE_MAIL.includes(x)));
  if(!own.size) return '';           // 견줄 근거가 없으면 말하지 않는다
  return own.has(d) ? '' : [...own].join(', ');
}

function dContact(x){
  const list = exhContacts(x);
  const cands = contactsForExhibitor(x);
  const usedIds = new Set(list.map(c => c.row.contact_id).filter(Boolean).map(String));
  // 아직 연결 안 된 마스터DB 연락처만 추가 후보로 보여준다
  const free = cands.filter(c => !usedIds.has(String(c.id)));

  const card = (p) => {
    const r = p.row;
    return `<div style="padding:9px 11px;background:var(--i9);border-radius:8px;border-left:3px solid ${p.primary ? 'var(--a)' : 'var(--i6)'};margin-bottom:6px">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <span style="font-size:13px;font-weight:700">${escapeHtml(p.name || p.email || '이름 없음')}</span>
        ${p.title ? `<span class="pill p-gray">${escapeHtml(p.title)}</span>` : ''}
        ${p.primary ? '<span class="pill p-blue">메인</span>' : ''}
        <select class="fi" style="width:74px;padding:2px 5px;font-size:10.5px;margin-left:auto"
          onchange="setExhContactField('${escAttr(r.id)}','role',this.value)">
          ${cRoles().map(v => `<option value="${escAttr(v.code)}"${(r.role || '기타') === v.code ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}
        </select>
      </div>
      <div style="font-size:11.5px;color:var(--i3);display:flex;flex-direction:column;gap:2px">
        ${p.email ? `<div>✉ <a href="mailto:${escAttr(p.email)}" style="color:var(--a)">${escapeHtml(p.email)}</a>${
          (() => {
            // 사유를 적어 둔 줄은 더 묻지 않는다 — 대행사가 대신 진행하는 기업처럼
            // 도메인이 다른 게 맞는 경우가 있고, 계속 경고하면 다들 무시하게 된다
            const memo = String(r.note || '').trim();
            if(memo) return `<span class="pill p-gray" style="margin-left:5px;cursor:help"
              title="${escAttr(memo)}">${escapeHtml(memo.length > 14 ? memo.slice(0, 14) + '…' : memo)}</span>`;
            const own = foreignDomain(p.email, cands);
            return own ? `<span class="pill p-amber" style="margin-left:5px;cursor:pointer"
              onclick="noteExhContact('${escAttr(r.id)}')"
              title="이 기업의 마스터DB 연락처는 ${escAttr(own)} 도메인을 씁니다. 다른 회사 사람을 잘못 넣은 건 아닌지 확인해주세요. 맞다면 눌러서 이유를 적어 두세요.">다른 도메인</span>` : '';
          })()
        }</div>` : ''}
        ${p.phone ? `<div>☎ ${escapeHtml(p.phone)}</div>` : ''}
        ${!p.linked ? `
          <div class="fgr" style="margin-top:5px">
            <input class="fi" style="font-size:11.5px;padding:5px" placeholder="이름" value="${escAttr(r.name || '')}"
              onchange="setExhContactField('${escAttr(r.id)}','name',this.value)">
            <input class="fi" style="font-size:11.5px;padding:5px" placeholder="이메일" value="${escAttr(r.email || '')}"
              onchange="setExhContactField('${escAttr(r.id)}','email',this.value)">
          </div>
          <input class="fi" style="font-size:11.5px;padding:5px;margin-top:4px" placeholder="연락처" value="${escAttr(r.phone || '')}"
            onchange="setExhContactField('${escAttr(r.id)}','phone',this.value)">` : ''}
      </div>
      <div style="display:flex;gap:5px;margin-top:7px;align-items:center;flex-wrap:wrap">
        <span style="font-size:10px;color:${p.linked ? 'var(--a)' : 'var(--am)'}"
          title="${p.linked ? '' : '이 사람은 이 전시에만 적혀 있어요 — 마스터DB에 없어서 다음 행사에 다시 쓸 수 없고, 행사 참여 이력에도 안 잡힙니다'}"
          >${p.linked ? '마스터DB 연결됨' : '마스터DB에 없음'}</span>
        ${!p.linked ? `<button class="btn bp bs" style="font-size:10px"
          onclick="promoteExhContact('${escAttr(x.id)}','${escAttr(r.id)}')"
          title="이 사람을 마스터DB 연락처로 등록하고 이 행사 참여로도 남깁니다">마스터DB로 올리기</button>` : ''}
        ${!p.primary ? `<button class="btn bs" style="margin-left:auto;font-size:10px" onclick="setPrimaryExhContact('${escAttr(r.id)}')">메인으로</button>` : '<span style="margin-left:auto"></span>'}
        <button class="btn bs" style="font-size:10px;opacity:.6" onclick="delExhContact('${escAttr(r.id)}')">삭제</button>
      </div>
    </div>`;
  };

  return `
  <div style="font-size:11px;color:var(--i5);margin-bottom:8px">
    이 전시에서 우리가 연락하는 사람들이에요. 실무·정산·현장이 다르면 여러 명 배정할 수 있어요.</div>

  ${list.length ? list.map(card).join('')
    : '<div style="font-size:11.5px;color:var(--i5);padding:6px 2px;margin-bottom:6px">아직 배정된 담당자가 없어요 — 아래에서 고르세요</div>'}

  <div style="display:flex;align-items:center;gap:8px;margin:16px 0 7px;padding-top:12px;border-top:1px solid var(--i7)">
    <span style="font-size:11px;font-weight:700;color:var(--i3)">이 기업의 마스터DB 연락처</span>
    <span style="font-size:10.5px;color:var(--i5)">${cands.length}명</span>
    <button class="btn bp bs" style="margin-left:auto;font-size:11px" onclick="openNewContact('${escAttr(x.id)}')">+ 직접 입력</button>
  </div>

  ${cands.length ? cands.map(c => {
    const on = usedIds.has(String(c.id));
    const sub = [c.titleKo || c.titleEn, c.deptKo || c.deptEn, cleanEmail(c.email1)].filter(Boolean).join(' · ');
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:7px;margin-bottom:4px;
      background:${on ? 'var(--ad)' : 'var(--W)'};border:1px solid ${on ? 'var(--a)' : 'var(--i7)'}">
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:600">${escapeHtml(c.nameKo || c.nameEn || '이름 없음')}${
          c.nameKo && c.nameEn ? `<span style="font-weight:400;color:var(--i4);margin-left:5px">${escapeHtml(c.nameEn)}</span>` : ''}</div>
        ${sub ? `<div style="font-size:10.5px;color:var(--i4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(sub)}</div>` : ''}
      </div>
      <button class="btn ${on ? 'bs' : 'bp bs'}" style="flex:0 0 auto;font-size:10.5px"
        onclick="${on ? `unassignExhContact('${escAttr(x.id)}','${escAttr(String(c.id))}')`
                      : `assignExhContact('${escAttr(x.id)}','${escAttr(String(c.id))}')`}"
        title="${on ? '이 전시 담당자에서 뺍니다 (마스터DB에는 그대로 남아요)' : '이 전시 담당자로 넣습니다'}">${
        on ? '배정 해제' : '배정'}</button>
    </div>`;
  }).join('')
  : `<div style="font-size:11.5px;color:var(--am);padding:8px 2px">
      이 기업 연락처가 마스터DB에 없어요 — <b>직접 입력</b>으로 추가하면 마스터DB에도 함께 등록됩니다</div>`}`;
}

/* ── 담당자 직접 입력 ──
   여기서 적은 사람은 마스터DB(연락처)에도 함께 등록한다. 전시에만 적어 두면
   다음 행사에서 같은 사람을 또 손으로 적게 되고, 기업DB에서도 안 보인다.

   성명·직함·부서를 국문·영문으로 나눠 받는다 — 해외 기업은 영문만, 국내는
   국문만 오는 일이 많아 한 칸에 몰아넣으면 나중에 갈라내야 한다. */
export function openNewContact(exhId){
  const x = getExhibitorById(exhId);
  if(!x) return;
  const pair = (a, b, la, lb, pa, pb) => `<div class="fgr">
    <div class="fg"><label class="fl">${la}</label><input class="fi" id="nc-${a}" placeholder="${pa}"></div>
    <div class="fg"><label class="fl">${lb}</label><input class="fi" id="nc-${b}" placeholder="${pb}"></div>
  </div>`;
  modalShell('new-contact-modal', `담당자 추가 — ${exhNames(x).ko}`, `
    <div style="font-size:11.5px;color:var(--i4);margin-bottom:12px;line-height:1.6">
      마스터DB에도 함께 등록되고, 이 전시 담당자로 바로 배정됩니다.</div>
    ${pair('nameKo', 'nameEn', '성명 (국문)', '성명 (영문)', '예: 이호진', '예: Hojin Lee')}
    ${pair('titleKo', 'titleEn', '직함 (국문)', '직함 (영문)', '예: 팀장', '예: Manager')}
    ${pair('deptKo', 'deptEn', '부서 (국문)', '부서 (영문)', '예: 마케팅팀', '예: Marketing')}
    ${pair('email', 'phone', '이메일', '연락처', 'name@company.com', '010-0000-0000')}
    <div class="fg"><label class="fl">이 전시에서의 역할</label>
      <select class="fi" id="nc-role">${cRoles().map(v => `<option value="${escAttr(v.code)}"${v.code === '실무' ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}</select></div>
    <div id="nc-msg" style="font-size:11.5px;min-height:16px;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn bs" onclick="closeNewContact()">취소</button>
      <button class="btn bp" id="nc-save" onclick="submitNewContact('${escAttr(exhId)}')">추가</button>
    </div>`);
  document.getElementById('nc-nameKo')?.focus();
}
export const closeNewContact = () => document.getElementById('new-contact-modal')?.remove();

export async function submitNewContact(exhId){
  if(exhLocked()){ exhLockNotice(); return; }
  const v = (id) => (document.getElementById('nc-' + id) || {}).value?.trim() || '';
  const msg = document.getElementById('nc-msg');
  const btn = document.getElementById('nc-save');
  const fail = (t) => { if(msg){ msg.style.color = 'var(--re)'; msg.textContent = t; }
    if(btn){ btn.disabled = false; btn.textContent = '추가'; } };

  const nameKo = v('nameKo'), nameEn = v('nameEn');
  if(!nameKo && !nameEn) return fail('성명을 국문이나 영문 중 하나는 입력해주세요.');
  if(btn){ btn.disabled = true; btn.textContent = '추가 중…'; }

  const x = getExhibitorById(exhId);
  const org = x?.org_id ? getOrgById(x.org_id) : null;
  const today = td();
  const c = {
    id: Date.now() + Math.floor(Math.random() * 10000),
    nameKo, nameEn,
    orgKo: org?.name_ko || x?.company_name || '', orgEn: org?.name_en || '',
    titleKo: v('titleKo'), titleEn: v('titleEn'),
    deptKo: v('deptKo'), deptEn: v('deptEn'),
    country: org?.country || '', cat: 'exhibitor', lang: nameKo ? 'KO' : 'EN',
    source: `${x?.event_id || ''} 전시 담당자`, date: today, status: 'new',
    email1: v('email'), email2: '', phone1: v('phone'), phone2: '',
    beat: '', products: '', tags: '', org_id: x?.org_id || '',
  };

  /* 마스터DB에 먼저 넣는다 — 저장이 실패하면 전시 쪽도 만들지 않는다.
     반쪽만 생기면 어느 쪽이 맞는지 알 수 없게 된다. */
  contacts.push(c);
  const { postToSheet } = await import('../api.js');
  const r = await postToSheet({
    sheet: 'contacts',
    row: [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
      c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2,
      c.beat, c.products, c.tags, c.org_id],
  }, '담당자 추가', { silent: true });
  if(!r.ok){
    const i = contacts.indexOf(c);
    if(i >= 0) contacts.splice(i, 1);
    return fail('마스터DB 저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
  }

  const ok = await assignExhContact(exhId, String(c.id), v('role'));
  if(!ok) return fail('마스터DB에는 등록됐지만 전시 배정에 실패했어요 — 아래 목록에서 다시 배정해주세요.');

  /* 이 행사에 참여하는 것으로도 남긴다.
     여기서 만든 사람은 "그 행사 전시 담당자"라서 행사 참여가 곧 사실인데,
     전에는 마스터DB에만 들어가 참여 이력이 비어 있었다. 그러면 기업DB의
     행사별 집계와 CRM의 참여 이력에서 이 사람이 통째로 빠진다. */
  await addExhParticipation(c.id, x?.event_id, v('role'));

  trackAction('add', '담당자 추가', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(nameKo || nameEn)} 마스터DB 등록 + 전시 배정`,
    { kind: 'exhibitor', id: x?.id, tab: 'contact' });
  closeNewContact();
  try { const { buildCoDB } = await import('./company-tab.js'); buildCoDB(); } catch(e){}
  refreshExhViews();
}

/* ── 예전에 이 전시에만 적어 둔 담당자를 마스터DB로 올린다 ──

   전에는 담당자를 이 전시 안에서만 적을 수 있었다(exhibitor_contacts에 이름·
   이메일을 직접 넣는 방식). 그렇게 넣은 사람은 마스터DB에 없어서 다음 행사에
   다시 쓸 수 없고, 기업DB의 행사별 집계와 CRM 참여 이력에서도 통째로 빠진다.
   지금 '직접 입력'은 마스터DB에 넣고 연결하는 방식으로 바뀌었지만, 예전 방식으로
   들어간 줄이 남아 있어서 그 줄을 올릴 길을 둔다.

   이름도 이메일도 없는 줄은 올릴 게 없다 — 먼저 채우게 한다. */
export async function promoteExhContact(exhId, rowId){
  if(exhLocked()){ exhLockNotice(); return; }
  const r = EXH_CONTACTS.find(o => o.id === rowId);
  if(!r) return;
  if(r.contact_id){ alert('이미 마스터DB에 연결된 담당자예요.'); return; }

  const nm = String(r.name || '').trim();
  const em = cleanEmail(r.email || '');
  if(!nm && !em){ alert('이름이나 이메일 중 하나는 적어야 마스터DB에 올릴 수 있어요.'); return; }

  const x = getExhibitorById(exhId);
  const org = x?.org_id ? getOrgById(x.org_id) : null;
  const today = td();
  // 이름 칸에 "메디라마 (MediRama)"처럼 기업명이 들어간 줄이 있다. 그대로 두면
  // 사람 이름이 기업명이 되므로, 한글이 있으면 국문 이름으로만 넣는다.
  const c = {
    id: Date.now() + Math.floor(Math.random() * 10000),
    nameKo: /[가-힣]/.test(nm) ? nm : '', nameEn: /[가-힣]/.test(nm) ? '' : nm,
    orgKo: org?.name_ko || x?.company_name || '', orgEn: org?.name_en || '',
    titleKo: '', titleEn: '', deptKo: '', deptEn: '',
    country: org?.country || '', cat: 'exhibitor', lang: /[가-힣]/.test(nm) ? 'KO' : 'EN',
    source: `${x?.event_id || ''} 전시 담당자(옮김)`, date: today, status: 'new',
    email1: em, email2: '', phone1: String(r.phone || '').trim(), phone2: '',
    beat: '', products: '', tags: '', org_id: x?.org_id || '',
  };

  contacts.push(c);
  const { postToSheet } = await import('../api.js');
  const res = await postToSheet({
    sheet: 'contacts',
    row: [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
      c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2,
      c.beat, c.products, c.tags, c.org_id],
  }, '담당자 마스터DB 등록', { silent: true });
  if(!res.ok){
    const i = contacts.indexOf(c);
    if(i >= 0) contacts.splice(i, 1);
    saveFailed(res, '마스터DB 저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    return;
  }

  // 이 줄을 그 연락처에 연결한다 — 새 줄을 만들지 않아야 역할·메인 표시가 남는다
  const before = { contact_id: r.contact_id, name: r.name, email: r.email, phone: r.phone };
  r.contact_id = String(c.id);
  refreshExhViews();
  const r2 = await saveExhContact({ id: r.id, contact_id: r.contact_id });
  if(!r2.ok){ Object.assign(r, before); refreshExhViews(); alert('연결에 실패했어요.'); return; }

  await addExhParticipation(c.id, x?.event_id, r.role);

  trackAction('add', '담당자 마스터DB 등록', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(nm || em)} — 전시에만 있던 담당자를 마스터DB로 옮김`,
    { kind: 'exhibitor', id: x?.id, tab: 'contact' });
  try { const { buildCoDB } = await import('./company-tab.js'); buildCoDB(); } catch(e){}
  refreshExhViews();
}

/* 행사 참여 기록 — 전시 담당자로 넣은 사람은 그 행사에 오는 사람이다.

   실패해도 담당자 등록 자체는 되돌리지 않는다. 참여 이력이 빠진 건 나중에
   기업DB에서 채울 수 있지만, 방금 적은 이름·이메일을 통째로 잃는 건 되돌리기가
   어렵다. 대신 무엇이 빠졌는지 로그에 남긴다. */
async function addExhParticipation(contactId, eventId, role){
  if(exhLocked()){ exhLockNotice(); return; }
  if(!eventId) return false;
  /* 역할까지 봐야 한다. 사람+행사만 보면 이미 다른 역할로 등록된 사람에게
     이 역할 줄이 만들어지지 않는다 — 참가기업 임원이 세션에서 발표하는 경우
     그 사람이 행사 DB에서 «연사»로 잡히지 않는다.
     company-tab·db-tab·upload-tab의 같은 검사는 처음부터 역할을 보고 있었다. */
  const dup = participations.some(p =>
    String(p.contactId) === String(contactId) && p.eventId === eventId
    && p.role === '전시참가기업');
  if(dup) return true;

  const part = {
    id: 'P-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    eventId, event: eventId, contactId: String(contactId), contact: '',
    role: '전시참가기업', note: role ? `전시 ${role}` : '',
    matched: '✅ 전시 담당자 등록',
  };
  participations.push(part);

  const { postToSheet } = await import('../api.js');
  const r = await postToSheet({
    sheet: 'participations',
    row: [part.id, part.eventId, '', part.contactId, '', '', '', part.role, part.note, part.matched],
  }, '행사 참여 추가', { silent: true });

  if(!r.ok){
    const i = participations.indexOf(part);
    if(i >= 0) participations.splice(i, 1);
    trackAction('add', '행사 참여 저장 실패', eventId,
      `담당자를 등록했지만 <b>${escapeHtml(eventId)}</b> 참여 기록은 저장되지 않았어요 — 기업DB에서 직접 추가해주세요`);
    return false;
  }
  return true;
}

/* 마스터DB 연락처를 이 전시 담당자로 넣는다 */
export async function assignExhContact(exhId, contactId, role){
  const already = contactsFor(exhId).some(c => String(c.contact_id) === String(contactId));
  if(already) return true;
  const first = contactsFor(exhId).length === 0;
  return addRow(EXH_CONTACTS, {
    id: localId('XC-'), exhibitor_id: exhId, contact_id: String(contactId),
    name: '', email: '', phone: '', role: role || '실무',
    is_primary: first ? 'yes' : '',   // 첫 담당자는 자동으로 메인
    note: '',
  }, saveExhContact);
}

/* 이 전시 담당자에서만 뺀다 — 마스터DB 연락처는 건드리지 않는다.
   행사가 끝나도 그 사람은 그 기업 연락처로 남아야 다음에 다시 쓸 수 있다. */
export async function unassignExhContact(exhId, contactId){
  const row = contactsFor(exhId).find(c => String(c.contact_id) === String(contactId));
  if(!row) return;
  await delExhContact(row.id);
}

/* ══════════════════════════════════════════
   1) 진행 — 매뉴얼 / 신청서 / 부스 / 도록 / 현장
══════════════════════════════════════════ */
/* ══════════════════════════════════════════
   참가기업 지우기 — 딸린 것까지 함께

   전시 참가기업 한 줄에는 일곱 갈래가 매달려 있다: 담당자·금액 항목·인보이스·
   세금계산서·입금·문의 기록·신청서 접수. 기업 줄만 지우면 이것들이 없는 기업을
   가리킨 채 DB에 남는다 — 화면에서는 안 보이니 아무도 모르고, 발행한 인보이스와
   받은 돈까지 주인 없이 떠돈다. 연사에서 똑같은 일이 이미 한 번 났다.

   ── 돈이 오간 곳은 지우지 않는다 ──
   입금이나 환불이 한 줄이라도 있으면 막는다. 그건 회계에 이미 잡힌 숫자라,
   지우면 우리 장부에서만 사라지고 통장에는 남는다. 참가를 접은 것뿐이라면
   지울 일이 아니라 «취소» 상태로 두는 일이다 — 그래야 «왜 이 부스가 비었나»에
   답할 수 있다.

   ── 무엇이 함께 사라지는지 세어서 보여준다 ──
   «정말 지울까요?»만 묻는 물음은 아무것도 알려주지 않는다. 인보이스 두 장과
   입금 세 건이 딸려 있다는 걸 알고 누르는 것과 모르고 누르는 것은 다르다.
══════════════════════════════════════════ */
const EXH_CHILDREN = [
  ['담당자',       EXH_CONTACTS, deleteExhContact,  'exhibitor_contacts'],
  ['금액 항목',    EXH_ITEMS,    deleteExhItem,     'exhibitor_items'],
  ['인보이스',     EXH_INVOICES, deleteExhInvoice,  'exhibitor_invoices'],
  ['세금계산서',   EXH_TAX,      deleteExhTax,      'exhibitor_tax_invoices'],
  ['입금·환불',    EXH_PAYMENTS, deleteExhPayment,  'exhibitor_payments'],
  ['문의·기록',    EXH_LOGS,     deleteExhLog,      'exhibitor_logs'],
  ['신청서 접수',  EXH_APPS,     deleteExhApp,      'exhibitor_apps'],
];

export async function removeExhibitor(id){
  const x = getExhibitorById(id);
  if(!x) return;

  const kids = EXH_CHILDREN.map(([label, arr, del, table]) => ({
    label, arr, del, table,
    rows: arr.filter(r => r.exhibitor_id === id).map(r => ({ ...r })),
  }));

  /* 돈이 오간 흔적 — 금액이 적힌 입금·환불 줄이 있으면 지우지 않는다 */
  const money = paymentsFor(id).filter(p => String(p.amount ?? '').trim() !== '');
  if(money.length){
    alert(`«${x.company_name}»은(는) 입금·환불 기록이 ${money.length}건 있어 지울 수 없어요.\n\n`
      + `이미 회계에 잡힌 숫자라, 지우면 우리 장부에서만 사라집니다.\n`
      + `참가를 접은 거라면 진행 탭에서 상태를 «취소»로 두세요 — 부스 번호와 기록이 남아`
      + ` 나중에 «왜 이 자리가 비었나»에 답할 수 있어요.`);
    return;
  }

  const lines = kids.filter(k => k.rows.length).map(k => `   · ${k.label} ${k.rows.length}건`);
  if(!confirm(`«${x.company_name}» 참가기업을 지울까요?\n\n`
    + (lines.length ? `함께 지워집니다:\n${lines.join('\n')}\n\n` : '딸린 기록은 없어요.\n\n')
    + `되돌릴 수 없습니다. 참가를 접은 것뿐이라면 상태를 «취소»로 두세요.`)) return;

  /* 딸린 것부터 지운다. 기업 줄을 먼저 지웠다가 중간에 실패하면, 남은 자식들이
     가리킬 데 없는 채로 떠돈다 — 지금 고치고 있는 바로 그 상태가 된다. */
  for(const k of kids){
    for(const r of k.rows){
      const res = await k.del(r.id);
      if(res && res.ok === false){
        alert(`${k.label}을(를) 지우다 멈췄어요. 네트워크 확인 후 다시 시도해주세요.\n`
          + `여기까지 지운 것은 되돌아가지 않습니다 — 다시 누르면 남은 것부터 이어서 지웁니다.`);
        refreshExhViews();
        return;
      }
      const i = k.arr.findIndex(o => o.id === r.id);
      if(i >= 0) k.arr.splice(i, 1);
    }
  }

  const res = await deleteExhibitor(id);
  if(res && res.ok === false){ alert('참가기업을 지우지 못했어요.'); refreshExhViews(); return; }
  const i = EXHIBITORS.findIndex(o => o.id === id);
  if(i >= 0) EXHIBITORS.splice(i, 1);

  closeExhDr?.();
  trackAction('delete', '참가기업 삭제', x.company_name || '',
    `<b>${escapeHtml(x.company_name || '')}</b> 삭제`
    + (lines.length ? ` — ${kids.filter(k => k.rows.length).map(k => `${k.label} ${k.rows.length}건`).join(' · ')} 함께` : ''),
    removed('exhibitors', id, x,
      { also: kids.flatMap(k => k.rows.map(r => ({ table: k.table, row: r.id, before: r }))) }));
  refreshExhViews();
}

/* 지우는 자리는 눈에 잘 띄면 안 된다 — 담당자 탭 맨 아래, 접힌 채로 둔다 */
function dangerZone(x){
  return `<details style="margin-top:18px">
    <summary style="font-size:11px;color:var(--i5);cursor:pointer">이 참가기업 지우기</summary>
    <div style="margin-top:8px;padding:10px 12px;border:1px solid var(--re);border-radius:8px">
      <div style="font-size:11.5px;color:var(--i3);line-height:1.6">
        담당자·금액 항목·인보이스·세금계산서·입금·문의·접수가 <b>함께 지워집니다</b>.<br>
        참가를 접은 것뿐이라면 진행 탭에서 상태를 <b>취소</b>로 두세요 —
        부스 번호와 기록이 남아 나중에 «왜 이 자리가 비었나»에 답할 수 있어요.
      </div>
      <button class="btn bs" style="margin-top:8px;border-color:var(--re);color:var(--re)"
        onclick="removeExhibitor('${escAttr(x.id)}')">참가기업 삭제</button>
    </div></details>`;
}

/* ── 담당자 탭 ── */
function dContactTab(x){
  return `${sct('기업 담당자', dContact(x))}${dangerZone(x)}`;
}

/* ══════════════════════════════════════════
   신청서 접수 이력

   기업은 신청서를 한 번만 보내지 않는다. 프로그램북 소개글을 고쳐 다시 보내고,
   전시패스를 더 달라고 메일 본문으로 알려 오고, 의자를 빼달라고 전화한다.
   접수일 칸이 하나였을 때는 덮어쓰면 최초 접수일이 사라지고, 안 고치면 변경이
   안 남았다 — 실제로 변경이 품목 비고에 손으로 적혀 있었다.

   ── 추가인지 변경인지 사람이 고르지 않는다 ──
   접수 건을 "반영 중"으로 열어 두면, 그동안 고친 품목이 자동으로 그 건에
   달린다. 매번 사람이 판단해 고르게 하면 안 적히거나 틀리게 적힌다.
   무엇이 달라졌는지는 데이터가 이미 알고 있다.
══════════════════════════════════════════ */

/* 버튼 문구는 받침에 따라 조사가 달라 함께 적어 둔다 — "유선로"가 된다 */
const APP_CHANNELS = [['신청서', '신청서로 접수'], ['메일', '메일로 접수'],
  ['유선', '유선으로 접수'], ['현장', '현장에서 접수']];
const APP_KINDS    = ['최초', '변경', '취소'];

/* 접수를 한 줄 연다. 첫 줄이면 최초, 아니면 변경으로 시작한다. */
export async function addExhApp(exhId, preset = {}){
  const prev = appsFor(exhId);
  const open = openAppFor(exhId);
  if(open && !preset.force){
    alert('아직 반영 중인 접수가 있어요. 그 건을 먼저 닫아주세요.');
    return;
  }
  const rec = {
    id: localId('XA-'), exhibitor_id: exhId,
    seq: String(prev.length + 1),
    received_at: preset.received_at || td(),
    channel: preset.channel || '신청서',
    kind: preset.kind || (prev.length ? '변경' : '최초'),
    reason: preset.reason || '', file_name: preset.file_name || '',
    complete: '', missing: '', handled_at: '', handler: '', summary: '', note: '',
  };
  if(!await addRow(EXH_APPS, rec, saveExhApp)) return;
  /* 최초 접수는 체크리스트가 보는 칸도 함께 채운다 — 두 곳이 갈라지지 않게. */
  const x = getExhibitorById(exhId);
  if(x && rec.kind === '최초' && !x.app_received_at){
    await patchExh(exhId, { app_received: 'yes', app_received_at: rec.received_at }, '신청서 수신');
  }
  trackAction('add', '신청서 접수', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(rec.seq)}차 접수 (${escapeHtml(rec.kind)} · ${escapeHtml(rec.channel)})`,
    { kind: 'exhibitor', id: x?.id, tab: 'progress' });
  refreshExhViews();
}

/* 품목 한 줄을 넣는다. 열린 회차가 없으면 하나 열고 거기에 넣는다 —
   두 걸음을 한 걸음으로.

   접수를 열면 화면이 다시 그려지면서 적어 둔 칸이 새 칸으로 바뀐다. 그래서
   값을 먼저 손에 쥐고, 새 칸에 도로 채워 넣은 뒤에 넣는다 — 안 그러면 회차만
   열리고 품목은 «항목명을 입력해주세요»로 끝난다.

   접수를 여는 데 실패하면 넣지 않는다: 회차 없이 들어간 품목은 나중에 어디서
   왔는지 알 수 없다. */
const ITEM_FIELDS = ['cat', 'nm', 'qty', 'up', 'amt', 'cur'];
export async function addItemHere(exhId){
  if(!openAppFor(exhId)){
    const keep = {};
    ITEM_FIELDS.forEach(k => { keep[k] = val(`it-${k}-${exhId}`); });
    const catalogId = document.getElementById(`it-nm-${exhId}`)?.dataset.catalogId || '';
    if(!keep.nm){ alert('항목명을 입력해주세요.'); return; }

    await addExhApp(exhId, { channel: '신청서' });
    if(!openAppFor(exhId)) return;

    ITEM_FIELDS.forEach(k => {
      const el = document.getElementById(`it-${k}-${exhId}`);
      if(el && keep[k]) el.value = keep[k];
    });
    const nm = document.getElementById(`it-nm-${exhId}`);
    if(nm && catalogId) nm.dataset.catalogId = catalogId;
  }
  return addExhItem(exhId);
}

export const setAppField = (id, field, value) =>
  setRowField(EXH_APPS, saveExhApp, '신청서 접수', id, field, value);
export const delExhApp = (id) => removeRow(EXH_APPS, id, deleteExhApp, '신청서 접수');

/* 이 접수 건에 달린 품목 변경을 사람이 읽는 한 줄로 만든다.
   닫을 때 한 번 만들어 summary에 넣는다 — 나중에 품목을 또 고쳐도 그때
   무엇이 달라졌었는지는 그대로 남아야 한다. */
export function appDiffLines(appId, exhId){
  return itemsFor(exhId).filter(i => i.app_id === appId).map(i => {
    const q = i.qty || '1';
    if(i.change_kind === '취소') return `− ${i.name} ${q}개 취소`;
    if(i.change_kind === '변경') return `~ ${i.name} ${i.prev_qty || '?'} → ${q}`;
    return `+ ${i.name} ${q}개 추가`;
  });
}

/* 반영 완료 — 무엇이 달라졌는지 적어 두고 닫는다. */
export async function closeExhApp(exhId, appId){
  const a = EXH_APPS.find(r => r.id === appId);
  if(!a) return;
  const lines = appDiffLines(appId, exhId);
  const who = currentUser?.name || '';
  await setRowField(EXH_APPS, saveExhApp, '신청서 접수', appId, 'summary',
    lines.length ? lines.join(' · ') : '품목 변경 없음');
  await setRowField(EXH_APPS, saveExhApp, '신청서 접수', appId, 'handler', who);
  await setRowField(EXH_APPS, saveExhApp, '신청서 접수', appId, 'handled_at', td());
  refreshExhViews();
}
export const reopenExhApp = (appId) =>
  setRowField(EXH_APPS, saveExhApp, '신청서 접수', appId, 'handled_at', '');

/* 품목을 취소한다. 지우지 않고 내린다 — 이미 나간 인보이스가 왜 그 금액이었는지
   설명할 수 있어야 한다. 발주·정산·대장에서는 빠진다. */
export async function voidExhItem(id){
  const i = EXH_ITEMS.find(r => r.id === id);
  if(!i) return;
  if(isVoided(i)){ await setItemField(id, 'voided_at', ''); return; }
  if(!confirm(`"${i.name}"을(를) 취소 처리할까요?\n지우지 않고 내려서 이력은 남습니다.`)) return;
  const open = openAppFor(i.exhibitor_id);
  if(open){ await setItemField(id, 'app_id', open.id); await setItemField(id, 'change_kind', '취소'); }
  await setItemField(id, 'voided_at', td());
}

/* 품목이 몇 차 접수에서 어떻게 됐는지 — 이름 옆 배지 */
function appMark(i){
  if(!i.app_id) return '';
  const a = EXH_APPS.find(r => r.id === i.app_id);
  if(!a) return '';
  const cls = i.change_kind === '취소' ? 'p-red' : i.change_kind === '변경' ? 'p-amber' : 'p-teal';
  return ` <span class="pill ${cls}" style="font-size:9px" title="${escAttr(
    (a.received_at || '') + (a.reason ? ' · ' + a.reason : ''))}">${escapeHtml(a.seq)}차 ${escapeHtml(i.change_kind || '추가')}</span>`;
}

/* 접수 이력 화면 */
function appsSection(x){
  const list = appsFor(x.id);
  const open = openAppFor(x.id);
  const add = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
    ${APP_CHANNELS.map(([c, l]) => `<button class="btn bs" onclick="addExhApp('${escAttr(x.id)}',{channel:'${c}'})">+ ${l}</button>`).join('')}
  </div>`;


  const rows = list.map(a => {
    const live = !String(a.handled_at || '').trim();
    const diff = live ? appDiffLines(a.id, x.id) : [];
    return `<div style="border:1px solid ${live ? 'var(--a)' : 'var(--i7)'};border-radius:8px;padding:9px 10px;margin-bottom:6px;background:${live ? 'var(--ad)' : 'var(--W)'}">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="pill ${a.kind === '최초' ? 'p-blue' : a.kind === '취소' ? 'p-red' : 'p-amber'}">${escapeHtml(a.seq)}차 · ${escapeHtml(a.kind || '')}</span>
        <span class="pill p-gray">${escapeHtml(a.channel || '')}</span>
        <input type="date" class="fi" style="width:132px;font-size:11px" value="${escAttr(a.received_at || '')}"
          onchange="setAppField('${escAttr(a.id)}','received_at',this.value)">
        ${live ? '<span class="pill p-amber">반영 중</span>'
               : `<span style="font-size:10.5px;color:var(--i4)">반영 ${escapeHtml(a.handled_at)}${a.handler ? ' · ' + escapeHtml(a.handler) : ''}</span>`}
        <span style="margin-left:auto;display:flex;gap:4px">
          ${live ? `<button class="btn bs" onclick="closeExhApp('${escAttr(x.id)}','${escAttr(a.id)}')">반영 완료</button>`
                 : `<button class="btn bs" onclick="reopenExhApp('${escAttr(a.id)}')">다시 열기</button>`}
          <button class="btn bs" onclick="delExhApp('${escAttr(a.id)}')">삭제</button>
        </span>
      </div>
      <input class="fi" style="margin-top:6px;font-size:11.5px" placeholder="왜 다시 받았나요 — 예: 프북 수정, 전시패스 추가"
        value="${escAttr(a.reason || '')}" onchange="setAppField('${escAttr(a.id)}','reason',this.value)">
      ${a.file_name ? `<div style="font-size:10.5px;color:var(--i4);margin-top:4px">📄 ${escapeHtml(a.file_name)}</div>` : ''}
      ${live && diff.length ? `<div style="font-size:11px;color:var(--i2);margin-top:6px;padding:6px 8px;background:var(--W);border-radius:6px">
          ${diff.map(d => escapeHtml(d)).join('<br>')}</div>` : ''}

      ${!live && a.summary ? `<div style="font-size:11px;color:var(--i3);margin-top:5px">${escapeHtml(a.summary)}</div>` : ''}
    </div>`;
  }).join('');

  /* 품목 넣는 줄은 카드 밖, 섹션 전체 너비에 둔다.

     카드 안에 넣었더니 테두리와 안쪽 여백만큼 좁아져 항목명 칸이 113px까지
     쪼그라들었다 — «C-011 디자인 체어 (화이트)»가 두 글자만 보인다. 칸 너비는
     정산에 있을 때와 같아야 한다. 어느 회차에 들어가는지는 바로 위 글줄이
     말해 주므로, 카드 안에 있지 않아도 헷갈리지 않는다. */
  /* 추가 줄은 늘 보인다.

     처음에는 회차를 먼저 열어야 줄이 나타나게 했는데, 하나 넣자고 접수 단추를
     고르고 → 줄이 생기길 기다리고 → 적는 세 걸음이 됐다. 품목 하나 넣는 일은
     하루에도 여러 번이라 그 한 걸음이 그대로 짐이 된다.

     줄은 늘 두고, 회차가 없으면 단추가 «접수 열고 추가»가 된다 — 누르면 오늘
     날짜로 접수를 하나 열고 거기에 넣는다. 모든 품목이 회차에 묶인다는 규칙은
     그대로면서 누르는 횟수만 줄었다. 어느 회차에 들어갔는지는 바로 위 카드에
     그대로 보인다. */
  const hint = `<div style="font-size:11px;color:${open ? 'var(--a)' : 'var(--i4)'};margin:6px 0 4px">${
    open ? `${escapeHtml(open.seq)}차 접수를 반영하는 중이에요 — 여기서 넣는 품목이 이 접수 건에 기록됩니다.`
         : `품목을 넣으면 ${list.length + 1}차 접수가 열리면서 거기에 기록돼요 — 경로를 정해 열려면 아래 접수 단추를 쓰세요.`}</div>
    <div class="bl-row bl-item-add">
      <select class="fi" id="it-cat-${escAttr(x.id)}" style="flex:0 0 72px;min-width:0;font-size:11.5px;padding:6px"
        onchange="rememberItemCat(this.value); swapItemList('${escAttr(x.id)}', this.value)">
        ${itemCats().map(({ code: k, label: l }, i) => `<option value="${escAttr(k)}"${(lastItemCat || itemCats()[0]?.code) === k ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
      <input class="fi" id="it-nm-${escAttr(x.id)}" placeholder="항목명" style="flex:1 1 120px;min-width:0;font-size:11.5px;padding:6px"
        list="${itemListId(x, lastItemCat || itemCats()[0]?.code || 'equip')}" oninput="pickCatalogItem('${escAttr(x.id)}')">
      ${catalogDatalist(x)}${designTargetList(x)}
      <input class="fi" id="it-qty-${escAttr(x.id)}" placeholder="수량" style="flex:1 1 54px;min-width:0;font-size:11.5px;padding:6px"
        oninput="calcItemAmount('${escAttr(x.id)}')">
      <input class="fi" id="it-up-${escAttr(x.id)}" placeholder="단가" style="flex:1 1 78px;min-width:0;font-size:11.5px;padding:6px"
        oninput="calcItemAmount('${escAttr(x.id)}')">
      <input class="fi" id="it-amt-${escAttr(x.id)}" placeholder="금액" style="flex:1 1 88px;min-width:0;font-size:11.5px;padding:6px;text-align:right">
      <select class="fi bl-cur" id="it-cur-${escAttr(x.id)}" onchange="rememberItemCur(this.value)">
        ${currencies().map(c => `<option value="${c}"${(lastItemCur || currencyOf(x.id)) === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <button class="btn bp bs" style="flex:0 0 auto" onclick="addItemHere('${escAttr(x.id)}')"
        title="${escAttr(open ? `${open.seq}차 접수에 넣습니다` : '접수를 하나 열고 거기에 넣습니다')}">${
        open ? '추가' : '접수 열고 추가'}</button>
    </div>`;
  /* 접수 기록이 아직 없어도 품목 줄은 보여준다 — 첫 품목을 넣는 순간 1차
     접수가 열린다. 여기서 줄을 숨기면 «어디서 넣지»부터 막힌다. */
  if(!list.length) return sct('신청서 접수 이력',
    `<div style="font-size:11.5px;color:var(--i4)">아직 접수 기록이 없어요. 신청서를 받은 날짜부터 남겨두면 변경이 몇 번 있었는지 그대로 따라옵니다.</div>`
    + hint + add);

  return sct('신청서 접수 이력', rows + hint + add,
    list.length > 1 ? `<span class="pill p-amber">변경 ${list.length - 1}회</span>` : '');
}

/* ── 인보이스 발행 ──
   신청 내역이 금액 항목으로 옮겨져 있으면 인보이스에 담길 내용은 이미 정해져
   있다. 그런데 지금까지는 정산 탭으로 건너가 줄을 만들고(금액을 손으로 옮겨
   적고), 그 줄에서 양식을 뽑고, 떨어진 파일을 폴더로 옮기는 세 걸음이었다.
   신청 내역을 보고 있는 자리에서 한 번에 끝낸다.

   실제 만드는 일은 exh-invoice.js가 한다 — 여기서는 window 경유로만 부른다
   (그쪽이 이 파일을 import하므로 반대로 부르면 순환 참조가 된다). */
function invoiceIssueSection(x){
  const items = liveItemsFor(x.id).filter(i => i.billable !== 'no');
  const invs = invoicesFor(x.id).filter(v => v.status !== 'void');
  const by = {};
  items.forEach(i => {
    const c = i.currency || 'KRW';
    by[c] = (by[c] || 0) + (Number(String(i.amount ?? '').replace(/[^0-9.-]/g, '')) || 0);
  });
  const curs = Object.keys(by);
  const folder = window.invoiceFolderName?.(exhEvent) || null;
  const canFolder = window.folderSupported?.() ?? false;

  if(!items.length) return sct('인보이스 발행',
    `<div style="font-size:11.5px;color:var(--i5);padding:8px 2px">
      청구할 금액 항목이 아직 없어요 — 위에서 신청 내역을 금액 항목으로 옮기거나
      <b>정산</b> 탭에서 항목을 넣으면 여기서 바로 발행할 수 있어요.</div>`);

  return sct('인보이스 발행', `
    <div style="padding:8px 10px;background:var(--i9);border-radius:7px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <span style="font-size:11px;color:var(--i4)">담길 내용</span>
        <b style="font-size:13px">${curs.map(c => escapeHtml(fmtMoney(by[c], c))).join(' + ')}</b>
      </div>
      <div style="font-size:10.5px;color:var(--i5);margin-top:3px">
        청구 항목 ${items.length}건${curs.length > 1
          ? ` · 통화가 <b>${curs.join(' / ')}</b>로 갈려 있어 ${curs.length}장으로 나눠 발행해요` : ''}</div>
    </div>
    ${invs.length ? `<div style="font-size:11px;color:var(--am);margin-bottom:8px">
      이미 발행한 인보이스가 ${invs.length}장 있어요 — 누르면 <b>새 번호로 한 장 더</b> 만듭니다.
      금액만 고쳐 다시 보내는 거라면 옛 건을 <b>정산</b> 탭에서 무효로 두세요.</div>` : ''}
    <button class="btn bp" id="inv-issue-${escAttr(x.id)}" onclick="issueExhInvoice('${escAttr(x.id)}')"
      title="인보이스 줄을 만들고 양식을 채워 저장합니다">인보이스 발행${curs.length > 1 ? ` (${curs.length}장)` : ''}</button>
    <div style="font-size:10.5px;color:var(--i5);margin-top:7px">
      ${!canFolder
        ? '이 브라우저는 폴더 저장을 지원하지 않아 다운로드로 받아요 (Chrome·Edge 데스크톱에서 폴더 저장 가능)'
        : folder
          ? `저장 위치 <b>${escapeHtml(folder)}</b> 안의 기업 폴더
             <button class="btn bs bl-mini" onclick="pickInvoiceFolder('${escAttr(exhEvent || '')}')">바꾸기</button>
             <button class="btn bs bl-mini" onclick="forgetInvoiceFolder('${escAttr(exhEvent || '')}')">해제</button>`
          : `지금은 다운로드로 받아요.
             <button class="btn bs bl-mini" onclick="pickInvoiceFolder('${escAttr(exhEvent || '')}')">저장 폴더 지정</button>
             — 이 행사의 <b>Invoice</b> 폴더를 고르면 그 뒤로는 바로 저장됩니다`}
    </div>`,
    invs.length ? `<span class="pill p-gray">발행 ${invs.length}장</span>` : '');
}

/* 기본 제공 시공 — 부스 타입이 정하는 일이라, 해당 없는 부스에서는 아예 안 보인다.
   빈 칸을 늘어놓으면 독립부스에서도 뭔가 채워야 하나 싶어진다. */
function baseWorkBlock(x){
  const k = baseKind(x);
  if(!k) return '';
  const v = BASE_KINDS[k];
  return sct(`기본 시공 — ${v.label}`,
    (k === 'fascia'
      ? `<div class="fg"><label class="fl">간판명 (영문)</label>
          <input class="fi" style="font-size:12px" value="${escAttr(x.fascia_name || '')}"
            placeholder="${escAttr(bookName(x).en || '게재 영문명이 없어요')}"
            title="비우면 프로그램북 게재 영문명을 그대로 씁니다 — 간판만 다르면 여기에 적으세요"
            onchange="setExhField('${escAttr(x.id)}','fascia_name',this.value,'간판명')">
          ${fasciaName(x)
            ? `<div style="font-size:10.5px;color:var(--i5);margin-top:3px">간판에 나갈 이름 — <b>${escapeHtml(fasciaName(x))}</b>${
                x.fascia_name ? ' (간판만 따로 적음)' : ' (프로그램북 게재 영문명)'}</div>`
            : '<div style="font-size:10.5px;color:var(--re);margin-top:3px">게재 영문명이 비어 있어 간판을 만들 수 없어요 — 프로그램북 탭에서 넣거나 여기에 직접 적으세요.</div>'}</div>
        <div class="fg"><label class="fl">간판명 확정</label>
          <input type="date" class="fi" style="font-size:12px" value="${escAttr(x.base_recv_at || '')}"
            onchange="setExhField('${escAttr(x.id)}','base_recv_at',this.value,'간판명 확정')"></div>`
      : `<div class="fg"><label class="fl">디자인 수령일</label>
          <input type="date" class="fi" style="font-size:12px" value="${escAttr(x.base_recv_at || '')}"
            onchange="setExhField('${escAttr(x.id)}','base_recv_at',this.value,'디자인 수령')"></div>`)
    + `<div class="fg"><label class="fl">${escapeHtml(v.done)}</label>
        <input type="date" class="fi" style="font-size:12px" value="${escAttr(x.base_done_at || '')}"
          onchange="setExhField('${escAttr(x.id)}','base_done_at',this.value,'${escAttr(v.done)}')"></div>
      <div class="fg"><label class="fl">비고</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.base_note || '')}"
          placeholder="색상·재질·시공 메모" onchange="setExhField('${escAttr(x.id)}','base_note',this.value,'기본 시공 비고')"></div>
      <div style="font-size:10.5px;color:var(--i5)">추가 발주가 아니라 계약에 들어 있는 항목이에요 — 기업이 조용해도 우리가 만들어 세웁니다.</div>`);
}

/* 참가 범위 — 체크리스트 맨 앞에 둔다. 아래 칸이 전부 비어 있는 까닭이
   여기 적혀 있어야, 다음 사람이 "빠뜨렸나" 하고 채우려 들지 않는다.

   대표 기업은 같은 행사의 참가기업 중에서 고른다. 이름을 손으로 적게 하면
   표기가 갈려서 나중에 누구 부스인지 되짚을 수 없다. */
function scopeBlock(x){
  const book = isBookOnly(x);
  const peers = exhibitorsForEvent(x.event_id)
    .filter(o => o.id !== x.id && !isBookOnly(o))
    .sort((a, b) => String(a.company_name || '').localeCompare(String(b.company_name || ''), 'ko'));
  return sct('참가 범위', `
    <div class="fg"><label class="fl">유형</label>
      <select class="fi" style="font-size:12px"
        onchange="setExhField('${escAttr(x.id)}','scope',this.value,'참가 범위')">
        <option value=""${book ? '' : ' selected'}>전체 진행 — 매뉴얼부터 현장까지</option>
        <option value="book"${book ? ' selected' : ''}>프로그램북만 — 받을 것이 도록뿐</option>
      </select>
      <div style="font-size:10.5px;color:var(--i5);margin-top:3px">
        «프로그램북만»으로 두면 도록 외 단계는 <b>해당 없음</b>이 되고 부스 수에서도 빠집니다.
        지우는 게 아니라 집계에서 빼는 것이라, 유형을 되돌리면 적어 둔 값이 그대로 살아납니다.</div></div>
    ${book ? `<div class="fg"><label class="fl">부스를 함께 쓰는 대표 기업</label>
      <select class="fi" style="font-size:12px"
        onchange="setExhField('${escAttr(x.id)}','host_key',this.value,'대표 기업')">
        <option value=""${x.host_key ? '' : ' selected'}>— 지정 안 함 —</option>
        ${peers.map(o => `<option value="${escAttr(o.company_key)}"${
          (x.host_key || '') === o.company_key ? ' selected' : ''}>${escapeHtml(exhNames(o).ko)}${
          o.booth_no ? ` (부스 ${escapeHtml(o.booth_no)})` : ''}</option>`).join('')}
      </select></div>` : ''}`);
}

/* ── 신청항목 탭 ──
   신청서를 받았는지, 받았다면 빠진 게 없는지, 무엇을 더 신청했는지를 한 화면에서
   본다. 신청 내역을 정산의 금액 항목으로 옮기는 버튼도 여기 둔다 — 적어둔 내역과
   실제 청구가 갈라지지 않게. */
function dApply(x){
  const appIssue = x.app_received_at && x.app_complete === 'no';
  const items = itemsFor(x.id).filter(i => (i.category || '') === 'equip');
  return `
  ${scopeBlock(x)}
  ${appsSection(x)}

  ${sct('신청서',
    flagRow(x, 'app_received', 'app_received_at', '신청서 수신') +
    `<div style="padding:10px 0 2px">
      <label class="fl">필수정보 완비 여부</label>
      <div class="stbs" style="margin:4px 0 8px">
        ${[['', '미확인'], ['yes', '완비'], ['no', '누락 있음']].map(([v, l]) =>
          `<button class="stb${(x.app_complete || '') === v ? ' on' : ''}" onclick="setExhField('${escAttr(x.id)}','app_complete','${v}','신청서 정보 확인')">${l}</button>`).join('')}
      </div>
      ${x.app_complete === 'no' ? textRow(x, 'app_missing', '누락 항목 — 무엇이 비었나요', '예: 사업자등록증, 로고 파일') : ''}
    </div>`,
    appIssue ? '<span class="pill p-amber">정보 누락</span>' : '')}

  ${sct('추가 비품 신청',
    textRow(x, 'extra_equipment', '신청 내역 (받은 그대로)', '예: 추가 테이블 2, 전기 3kW', true) +
    `<button class="btn bs" onclick="addItemFromEquip('${escAttr(x.id)}')" style="margin-top:2px">이 내역을 비품 금액 항목으로 추가</button>`)}

  ${invoiceIssueSection(x)}

  ${sct('등록된 비품', items.length
    ? `<div style="display:flex;flex-direction:column;gap:1px">
        ${items.map(i => `<div class="bl-row bl-item" style="padding:6px 8px;background:var(--i9);border-radius:6px">
          <span class="pill p-gray" style="text-align:center">비품</span>
          <span style="min-width:0;font-size:12px;font-weight:600;word-break:break-all">${escapeHtml(i.name || '')}</span>
          <span class="bl-qty">${escapeHtml(i.qty || '')}${
            i.unit_price ? `<span class="bl-up">${i.qty ? ' × ' : ''}${money(i.unit_price)}</span>` : ''}</span>
          <span class="bl-amt">${fmtMoney(i.amount, i.currency || 'KRW')}</span>
          <span></span><span></span>
        </div>`).join('')}
      </div>
      <div style="font-size:10.5px;color:var(--i5);margin-top:7px">금액을 고치거나 항목을 더하려면 <b>정산</b> 탭에서 하세요</div>`
    : '<div style="font-size:11.5px;color:var(--i5);padding:8px 2px">아직 등록된 비품이 없어요</div>',
    items.length ? `<span class="pill p-gray">${items.length}종</span>` : '')}
  `;
}

/* ── 프로그램북 탭 ──
   도록에 실을 정보는 기업마다 따로 받아야 하고, 편집 마감에 맞춰 빠진 칸을
   재촉해야 한다. 무엇이 왔고 무엇이 비었는지 한 화면에서 보이게 한다.

   회사소개 글자수는 저장하지 않고 늘 다시 센다 — 지면이 정해져 있어 이 숫자로
   편집 가능 여부를 판단하는데, 세어 둔 값은 본문을 고치는 순간 어긋난다. */
/* 글자수·단어수와 한도를 한 줄로 — 넘치면 얼마나 줄여야 하는지까지 적는다 */
function introMeter(v, evKey){
  const o = introOver(v, evKey);
  return `<span style="color:${o.isOver ? 'var(--re)' : 'var(--i4)'}">
      띄어쓰기 포함 <b style="font-size:13px">${o.chars}</b>자 · <b style="font-size:13px">${o.words}</b>단어</span>
    <span style="color:var(--i5)"> / 한도 ${o.lim.chars.toLocaleString()}자 · ${o.lim.words}단어</span>
    ${o.isOver ? `<div style="color:var(--re);font-weight:700;margin-top:3px">${o.over.join(', ')} 초과 — 기업에 줄여 달라고 요청하세요</div>`
      : o.chars ? `<div style="color:var(--g);margin-top:3px">지면에 들어갑니다 (${o.lim.chars - o.chars}자 여유)</div>` : ''}`;
}
export function drawIntroMeter(id){
  const ta = document.getElementById(`bk-intro-${id}`);
  const el = document.getElementById(`bk-meter-${id}`);
  if(ta && el) el.innerHTML = introMeter(ta.value, getExhibitorById(id)?.event_id);
}

function dBook(x){
  const miss = bookMissing(x);
  const o = introOver(x.book_intro, x.event_id);
  const row = (f, label, ph) => `<div class="fg"><label class="fl">${escapeHtml(label)}</label>
    <input class="fi" style="font-size:12px" value="${escAttr(x[f] || '')}" placeholder="${escAttr(ph)}"
      onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr(label)}')"></div>`;

  return `
  ${sct('게재 정보', `
    ${miss.length
      ? `<div style="font-size:11.5px;color:var(--am);background:var(--ab);padding:7px 9px;border-radius:6px;margin-bottom:10px">
          아직 못 받은 항목 ${miss.length}개 — <b>${escapeHtml(miss.join(', '))}</b></div>`
      : `<div style="font-size:11.5px;color:var(--g);background:var(--gb);padding:7px 9px;border-radius:6px;margin-bottom:10px">
          도록에 낼 정보가 모두 채워졌어요</div>`}
    <div class="fgr">
      <div class="fg"><label class="fl">게재 국문명</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.book_name_ko || '')}"
          placeholder="${escAttr(bookName(x).ko)}"
          title="비우면 CRM 이름을 그대로 씁니다 — 신청서 표기가 다르면 여기에 적으세요"
          onchange="setExhField('${escAttr(x.id)}','book_name_ko',this.value,'게재 국문명')"></div>
      <div class="fg"><label class="fl">게재 영문명</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.book_name_en || '')}"
          placeholder="${escAttr(bookName(x).en)}"
          onchange="setExhField('${escAttr(x.id)}','book_name_en',this.value,'게재 영문명')"></div>
    </div>
    <div style="font-size:10.5px;color:var(--i5);margin:-4px 0 8px">
      도록과 <b>기본부스 간판</b>에 실제로 나가는 이름이에요. 비우면 CRM 이름을 씁니다.</div>
    <div class="fgr">
      <div class="fg"><label class="fl">게재 순서</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.book_order || '')}" placeholder="예: 1"
          title="번호를 적으면 그 자리로 옮기고 나머지가 한 칸씩 밀려요"
          onchange="moveBookOrder('${escAttr(x.id)}',this.value)"></div>
      <div class="fg"><label class="fl">로고</label>
        <div class="stbs" style="margin-top:4px">
          ${[['', '미확인'], ['yes', '받음'], ['no', '없음']].map(([v, l]) =>
            `<button class="stb${(x.book_logo || '') === v ? ' on' : ''}"
              onclick="setExhField('${escAttr(x.id)}','book_logo','${v}','로고')">${l}</button>`).join('')}
        </div></div>
    </div>
    ${row('book_address', '주소', '예: 서울시 강남구 …')}
    <div class="fgr">
      ${row('book_phone', '연락처', '예: 02-000-0000')}
      ${row('book_website', '웹사이트', 'https://')}
    </div>`,
    miss.length ? `<span class="pill p-amber">${miss.length}개 미수령</span>` : '<span class="pill p-green">완료</span>')}

  ${sct('회사소개', `
    <textarea class="fi" id="bk-intro-${escAttr(x.id)}" rows="8" style="font-size:12.5px;line-height:1.7"
      placeholder="도록에 실을 회사소개를 붙여넣으세요"
      oninput="drawIntroMeter('${escAttr(x.id)}')"
      onchange="setExhField('${escAttr(x.id)}','book_intro',this.value,'회사소개')">${escapeHtml(x.book_intro || '')}</textarea>
    <div id="bk-meter-${escAttr(x.id)}" style="font-size:11.5px;margin-top:6px">${introMeter(x.book_intro, x.event_id)}</div>`,
    o.chars ? `<span class="pill ${o.isOver ? 'p-red' : 'p-green'}">${o.chars}자${o.isOver ? ' 초과' : ''}</span>`
      : '<span class="pill p-red">없음</span>')}

  ${sct('자료 수신',
    flagRow(x, 'directory_received', 'directory_received_at', '자료 수신', '회사소개·로고·제품정보') +
    textRow(x, 'directory_note', '메모', '받은 자료나 누락 항목', true))}
  `;
}

function dProgress(x){
  return `
  ${sct('매뉴얼', dateRow(x, 'manual_sent_at', '매뉴얼 발송') + dateRow(x, 'manual_replied_at', '매뉴얼 회신'))}

  ${sct('부스 배정',
    `<div class="fgr">
      <div class="fg"><label class="fl">부스 번호</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.booth_no || '')}"
          onchange="setExhField('${escAttr(x.id)}','booth_no',this.value,'부스 번호')"></div>
      <div class="fg"><label class="fl">층</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.booth_floor || '')}"
          onchange="setExhField('${escAttr(x.id)}','booth_floor',this.value,'부스 층')"></div>
    </div>
    <div class="fgr">
      <div class="fg"><label class="fl">부스 타입</label>
        <select class="fi" style="font-size:12px" onchange="setExhField('${escAttr(x.id)}','booth_type',this.value,'부스 타입')">
          ${boothTypeOptions(x.booth_type)}
        </select></div>
      <div class="fg"><label class="fl">수량</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.booth_qty || '')}"
          onchange="setExhField('${escAttr(x.id)}','booth_qty',this.value,'부스 수량')"></div>
    </div>
    <div class="fg"><label class="fl">스폰서 등급</label>
      <select class="fi" style="font-size:12px" onchange="setExhField('${escAttr(x.id)}','grade',this.value,'등급')">
        <option value=""${x.grade ? '' : ' selected'}>— 없음 —</option>${grades(x.event_id).map(g => `<option value="${escAttr(g.code)}"${(x.grade || '') === g.code ? ' selected' : ''}>${escapeHtml(g.label)}</option>`).join('')}
      </select></div>` +
    `<div style="padding:8px 0 2px">
      <label style="display:flex;align-items:flex-start;gap:7px;cursor:pointer">
        <input type="checkbox" ${isSharedBooth(x) ? 'checked' : ''}
          onchange="toggleSharedBooth('${escAttr(x.id)}')" style="margin-top:2px">
        <span>
          <span style="font-size:12px;font-weight:600">공동 부스 — 부스 수에서 뺀다</span>
          <span style="display:block;font-size:10.5px;color:var(--i5);margin-top:2px">
            한 부스를 두 기관이 나눠 쓸 때 한쪽만 켜세요. 기업 수·정산은 그대로 두고
            부스 수와 조립부스 발주에서만 빠집니다.</span>
        </span>
      </label>
    </div>` +
    flagRow(x, 'booth_confirmed', 'booth_confirmed_at', '배정 확정'))}

  ${baseWorkBlock(x)}

  ${sct('현장',
    dateRow(x, 'movein_at', '반입 / 설치') +
    builderBlock(x) +
    boothDesignBlock(x) +
    `<div class="fgr">
      <div class="fg"><label class="fl">출입증 매수</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.badge_count || '')}"
          onchange="setExhField('${escAttr(x.id)}','badge_count',this.value,'출입증')"></div>
      <div class="fg"><label class="fl">출입증 발급일</label>
        <input type="date" class="fi" style="font-size:12px" value="${escAttr(x.badge_issued_at || '')}"
          onchange="setExhField('${escAttr(x.id)}','badge_issued_at',this.value,'출입증 발급')"></div>
    </div>` +
    textRow(x, 'onsite_note', '현장 메모', '', true))}

  ${sct('기타', textRow(x, 'note', '메모', '', true) +
    `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--i8);display:flex;align-items:center;gap:9px">
      <span style="font-size:11.5px;color:var(--i4);flex:1">${x.status === CANCELLED
        ? '참가 취소된 기업이에요. 기록은 그대로 남아있어요.'
        : '참가가 취소되면 목록에서 빼되 기록은 남겨둬요.'}</span>
      <button class="btn bs" onclick="toggleExhCancel('${escAttr(x.id)}')">${x.status === CANCELLED ? '취소 해제' : '참가 취소 처리'}</button>
    </div>`)}
  `;
}

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
let editingItem = null;
export function editItemRow(id){
  editingItem = editingItem === id ? null : id;
  refreshExhViews();
}
export function closeItemEdit(){ editingItem = null; }

/* 정산에서 고쳤다는 표 — 이 줄은 신청서가 아니라 여기서 바뀌었다 */
function editMark(i){
  if(!String(i.edited_at || '').trim()) return '';
  return ` <span class="pill p-amber" style="font-size:9px" title="${escAttr(
    `정산에서 직접 고침 — ${i.edited_at}${i.edited_by ? ' · ' + i.edited_by : ''}`)}">정산수정</span>`;
}

const editHintRow = (i) => `<div style="grid-column:1/-1;font-size:10.5px;color:var(--i4);padding:2px 8px 6px">
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
const isDesignItem = (i) => {
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
  designTargets(x.event_id).map(v => `<option value="${escAttr(v)}"></option>`).join('')}</datalist>`;

/* 항목 줄 아래에 한 줄 더 — 칸이 일곱으로 고정된 격자를 건드리지 않는다 */
const designTargetRow = (x, i) => !isDesignItem(i) ? '' : `
  <div style="display:flex;gap:8px;align-items:center;padding:0 8px 7px;background:var(--i9);
      border-radius:0 0 6px 6px;margin-top:-1px">
    <span style="font-size:10.5px;color:var(--i5);flex:0 0 auto">무엇을 디자인했나</span>
    <input class="fi" list="dsgt-${escAttr(x.id)}" value="${escAttr(i.note || '')}"
      placeholder="부스 타입이나 품목을 고르세요 — 예: Block System C 1부스"
      style="flex:1;min-width:0;padding:4px 8px;font-size:11.5px"
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
let lastItemCat = null;
let lastItemCur = null;
export function rememberItemCat(v){ lastItemCat = v || null; }

/* 분류를 바꾸면 고를 수 있는 목록도 바뀐다. 적어 둔 이름은 지우지 않는다 —
   분류만 잘못 골랐다가 되돌리는 일이 잦고, 그때마다 다시 치게 하면 안 된다. */
export function swapItemList(exhId, cat){
  const el = document.getElementById('it-nm-' + exhId);
  if(!el) return;
  const id = `eqcat-${exhId}-${cat}`;
  if(document.getElementById(id)) el.setAttribute('list', id);
  else el.removeAttribute('list');       // 기타 — 카탈로그 밖이라 고를 목록이 없다
}
export function rememberItemCur(v){ lastItemCur = v || null; }
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
  const allItems = itemsFor(x.id);
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

  return `
  <div class="uc" style="margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <span style="font-size:11px;color:var(--i4)">청구 / 입금</span>
      <span><b style="font-size:16px;color:${paid >= billed && billed > 0 ? 'var(--g)' : 'var(--i1)'}">${cur === 'USD' ? '$' : ''}${money(paid)}</b>
        <span style="color:var(--i5);font-size:13px"> / ${money(billed)}${cur === 'USD' ? '' : '원'}</span></span>
    </div>
    <div style="margin:8px 0 4px">${progressBar(billed ? paid / billed * 100 : 0,
      paid >= billed && billed > 0 ? 'var(--g)' : 'var(--am)')}</div>
    ${/* 순입금 한 숫자만 보면 환불이 있었다는 사실이 사라진다. 통장·카드와 맞출 때는
         들어온 돈과 돌려준 돈이 갈라져 있어야 한다. */''}
    ${pb.refunded || pb.requested ? `<div style="margin:6px 0 2px;padding:6px 8px;background:var(--i9);border-radius:6px;font-size:11px">
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
      return `<div style="margin:6px 0 2px;padding:6px 8px;background:var(--i9);border-radius:6px">
        ${ks.map(k => { const b = payPill(k === '(수단 미기재)' ? '' : k);
          return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;padding:1px 0">
            <span class="pill ${b.cls}" style="font-size:9px">${escapeHtml(k === '(수단 미기재)' ? '수단 미기재' : b.label)}</span>
            <span style="color:var(--i2)">${Object.keys(by[k]).map(c => escapeHtml(fmtMoney(by[k][c], c))).join(' · ')}</span>
          </div>`; }).join('')}
      </div>`;
    })()}
    ${mixedCurrency(x.id) ? `<div style="font-size:11px;color:var(--i3);background:var(--i9);padding:6px 8px;border-radius:6px;margin:6px 0">
      이 기업은 <b>${mixedCurrency(x.id).join(' / ')}</b>가 함께 있어요.
      인보이스는 원화로 받고 엑스렌탈은 해외 카드로 결제하는 경우가 있어 <b>정상</b>입니다.
      위 합계는 <b>${currencyOf(x.id)}</b> 건만 더한 값이니, 나머지는 아래 목록에서 통화별로 확인하세요.</div>` : ''}
    <div style="font-size:11px;color:${
      st.state === 'over' ? 'var(--re)' : (rest > 0 ? 'var(--am)' : 'var(--i4)')}">
      ${st.state === 'settled' ? `완납 처리됨${x.settled_note ? ` — ${escapeHtml(x.settled_note)}` : ''}`
        : billed === 0 ? '금액 항목을 추가하거나 인보이스를 발행해주세요'
        : st.state === 'over' ? `초과 입금 ${fmtMoney(-rest, cur)} — 누락된 인보이스가 없는지 확인해주세요`
        : rest > 0 ? `잔액 ${fmtMoney(rest, cur)}` : '완납'}
</div>
    ${st.due ? `<div style="font-size:11px;margin-top:3px;color:${st.overdue && rest > 0 ? 'var(--re)' : 'var(--i4)'}">
      입금 기한 ${escapeHtml(st.due)}${st.overdue && rest > 0 ? ` · ${daysSince(st.due)}일 지남` : ''}</div>` : ''}
    ${noAmount.length ? `<div style="font-size:11px;color:var(--am);margin-top:3px">
      ⚠ 금액이 안 적힌 인보이스 ${noAmount.length}건이 있어 청구액이 실제보다 적을 수 있어요</div>` : ''}
    ${/* 인보이스와 어긋난 금액은 바로 아래 «추가 발행 필요»에서 무엇을 해야 하는지까지
         함께 말한다 — 같은 사실을 두 곳에서 말하면 한 곳만 고치게 된다. */''}
    ${rest !== 0 && billed > 0 && st.state !== 'settled' ? `
      <div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;align-items:center">
        <input class="fi" id="stl-note-${escAttr(x.id)}" placeholder="완납 처리 사유 (예: 송금 수수료 차감)"
          style="flex:1 1 180px;min-width:0;font-size:11px;padding:5px">
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
    return `<div class="uc" style="border-left:3px solid var(--${more ? 're' : 'am'});margin-bottom:10px">
      <div style="font-size:12px;font-weight:700;color:var(--${more ? 're' : 'am'})">${
        more ? '추가 발행 필요' : '발행액이 청구액보다 많아요'} ${escapeHtml(fmtMoney(Math.abs(gap.diff), gap.cur))}</div>
      <div style="font-size:11px;color:var(--i3);margin-top:4px">
        금액 항목 <b>${escapeHtml(fmtMoney(gap.billed, gap.cur))}</b> ·
        발행한 인보이스 <b>${escapeHtml(fmtMoney(gap.invoiced, gap.cur))}</b>${
        edited.length ? ` — 정산에서 직접 고친 항목 ${edited.length}건이 있어요` : ''}
      </div>
      <div style="font-size:10.5px;color:var(--i4);margin-top:4px">${
        more ? '차액만큼 한 장 더 발행하면 이 알림은 사라져요 — 아래 인보이스에서 발행하세요.'
             : '옛 인보이스를 무효로 두거나, 금액 항목이 빠지지 않았는지 보세요.'}</div>
    </div>`;
  })()}

  ${(() => {
    const r = needsReissue(x.id);
    return r ? `<div class="uc" style="border-left:3px solid var(--re);margin-bottom:10px">
      <div style="font-size:12px;font-weight:700;color:var(--re)">인보이스 발행 뒤에 신청이 바뀌었어요</div>
      <div style="font-size:11px;color:var(--i3);margin-top:4px">
        마지막 인보이스 ${escapeHtml(r.last)} 이후 접수 ${r.apps.length}건 —
        ${r.apps.map(a => escapeHtml(`${a.seq}차 ${a.received_at}${a.reason ? ' (' + a.reason + ')' : ''}`)).join(' · ')}
      </div>
      <div style="font-size:10.5px;color:var(--i4);margin-top:4px">청구액이 맞는지 보고, 다르면 옛 인보이스를 무효로 두고 다시 발행하세요.</div>
    </div>` : '';
  })()}

  ${sct('금액 항목', `
    <div style="display:flex;flex-direction:column;gap:1px;margin-bottom:8px">
      ${allItems.length ? itemCats().map(({ code: k, label: l }) => {
        // 분류별로 묶어서 소계를 붙인다 — 부스와 비품이 섞여 있으면 어느 쪽이
        // 얼마인지 세어보기 전엔 알 수 없다. 항목이 없는 분류는 건너뛴다.
        const g = allItems.filter(i => (i.category || 'etc') === k);
        if(!g.length) return '';
        return g.map(i => {
          /* 정산은 보는 자리다. 품목은 신청서 접수(회차)를 거쳐 들어오고, 여기서
             바로 고칠 수 있으면 그 변경은 어느 회차에도 안 묶인다 — 나중에
             «이 금액이 왜 이런가»를 되짚을 자리가 없어진다.

             그래도 고쳐야 할 때가 있다. 기업이 엑스렌탈과 직접 주고받아 바뀌는
             경우다. 그건 신청서를 안 거치니 여기서 고치는 게 맞다. 대신 연필을
             한 번 눌러야 열리고, 고친 것은 기록에 남는다. */
          const open = editingItem === i.id;
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
            title="${escAttr(i.name || '')}">${escapeHtml(i.name || '')}${appMark(i)}${editMark(i)}</span>
          <span class="bl-qty">${escapeHtml(i.qty || '')}${
            i.unit_price ? `<span class="bl-up">${i.qty ? ' × ' : ''}${money(i.unit_price)}</span>` : ''}</span>
          ${open
            ? `<input class="fi bl-amt-in" value="${escAttr(i.amount || '')}" placeholder="금액"
                 onchange="setItemFieldDirect('${escAttr(i.id)}','amount',this.value)">`
            : `<span class="bl-amt-in" style="text-align:right;font-size:12px;padding:5px 2px">${
                 i.amount ? escapeHtml(money(i.amount)) : '<span style="color:var(--am)">금액 미입력</span>'}</span>`}
          ${open
            ? curSelect(i.currency, `setItemFieldDirect('${escAttr(i.id)}','currency',this.value)`)
            : `<span style="font-size:11px;color:var(--i5);text-align:center">${escapeHtml(i.currency || 'KRW')}</span>`}
          ${open ? `
            <button class="btn bs bl-mini" onclick="voidExhItem('${escAttr(i.id)}')"
              title="${isVoided(i) ? '취소를 되돌립니다' : '취소 처리 — 지우지 않고 내려서 이력이 남아요'}">${isVoided(i) ? '↩' : '⊘'}</button>
            <button class="btn bs bl-mini" onclick="delExhItem('${escAttr(i.id)}')" title="완전히 삭제 — 잘못 넣은 줄에만 쓰세요">✕</button>`
            : `<button class="btn bs bl-mini" onclick="editItemRow('${escAttr(i.id)}')"
                 title="정산에서 직접 고칩니다 — 신청서를 거치지 않은 변경이라 기록에 남아요">✎</button>
               <span></span>`}
        </div>${designTargetRow(x, i)}${open ? editHintRow(i) : ''}`;
        }).join('')
        + `<div class="bl-row bl-item bl-subtotal">
            <span></span>
            <span style="min-width:0;font-size:11px;color:var(--i4)">${escapeHtml(l)} 소계 <span style="color:var(--i5)">${g.length}건</span></span>
            <span class="bl-qty"></span>
            <span class="bl-amt" style="font-size:12px">${sumText(sumByCurrency(g))}</span>
            <span></span><span></span><span></span>
          </div>`;
      }).join('') : '<div style="font-size:11.5px;color:var(--i5);padding:8px 2px">아직 항목이 없어요</div>'}
      ${items.length ? `<div class="bl-row bl-item bl-total">
        <span></span>
        <span style="min-width:0;font-size:12px;font-weight:700">총계 <span style="font-weight:400;color:var(--i4)">${items.length}건</span></span>
        <span class="bl-qty"></span>
        <span class="bl-amt" style="font-size:13px">${sumText(sumByCurrency(items))}</span>
        <span></span><span></span><span></span>
      </div>
      ${(() => {
        const ex = excludedSum(items);
        const ks = Object.keys(ex).filter(k => ex[k]);
        return ks.length ? `<div style="font-size:10.5px;color:var(--i4);padding:4px 8px 0;text-align:right">
          청구 제외 ${ks.map(k => fmtMoney(ex[k], k)).join(' + ')}
          <span style="color:var(--i5)">— 추가 배지처럼 우리가 청구하지 않는 항목이에요</span></div>` : '';
      })()}` : ''}
    </div>
    <div style="font-size:11px;color:var(--i4);padding:6px 2px 0;border-top:1px dashed var(--i7);margin-top:6px">
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
            <span style="min-width:0;font-size:12px;font-weight:700${v.status === 'void' ? ';text-decoration:line-through' : ''}">${escapeHtml(v.title || '인보이스')}</span>
            ${v.status === 'void' ? '<span class="pill p-gray">무효</span>' : '<span></span>'}
            <input class="fi bl-amt-in" value="${escAttr(v.amount ?? '')}" placeholder="금액 미입력"
              onchange="setInvField('${escAttr(v.id)}','amount',this.value)">
            ${curSelect(v.currency, `setInvField('${escAttr(v.id)}','currency',this.value)`)}
            <button class="btn bs" onclick="toggleVoidInvoice('${escAttr(v.id)}')" title="${v.status === 'void' ? '되살리기' : '취소·대체됨으로 표시(합계에서 제외)'}">${v.status === 'void' ? '되살리기' : '무효'}</button>
            <button class="btn bs" onclick="delExhInvoice('${escAttr(v.id)}')">✕</button>
          </div>
          ${v.status === 'void' && v.void_note ? `<div style="font-size:10.5px;color:var(--i5);margin-top:3px">${escapeHtml(v.void_note)}</div>` : ''}
          <div style="display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap">
            <label style="font-size:10.5px;color:var(--i4)">발송</label>
            <input type="date" class="fi" style="flex:1 1 128px;min-width:0;padding:3px 6px;font-size:11px" value="${escAttr(v.sent_at || '')}"
              onchange="setInvField('${escAttr(v.id)}','sent_at',this.value)">
            <label style="font-size:10.5px;color:var(--i4)">입금 예정</label>
            <input type="date" class="fi" style="flex:1 1 128px;min-width:0;padding:3px 6px;font-size:11px" value="${escAttr(v.due_date || '')}"
              onchange="setInvField('${escAttr(v.id)}','due_date',this.value)">
            ${!v.sent_at ? '<span class="pill p-amber">미발송</span>'
              : (v.due_date && daysSince(v.due_date) > 0 && paid < billed) ? `<span class="pill p-red" style="background:var(--rb);color:var(--re)">${daysSince(v.due_date)}일 지남</span>` : ''}
            ${/* 양식 내려받기는 exh-invoice.js가 소유한다 — 여기서는 window 경유로만
                 부른다(exh-export와 같은 방식). 금액 항목을 그대로 양식에 옮긴다. */''}
            <button class="btn bs" id="inv-xls-${escAttr(v.id)}" style="margin-left:auto;flex:0 0 auto"
              onclick="exportExhInvoice('${escAttr(v.id)}')"
              title="정산의 금액 항목을 인보이스 양식(국문·영문)에 채워 엑셀로 내려받습니다">양식 내려받기</button>
          </div>
        </div>`).join('') : '<div style="font-size:11.5px;color:var(--i5);padding:8px 2px">발행한 인보이스가 없어요</div>'}
    </div>
    <div class="bl-row bl-inv-add">
      <input class="fi" id="iv-t-${escAttr(x.id)}" placeholder="제목 (예: 부스+비품)" style="flex:1 1 140px;min-width:0;font-size:11.5px;padding:6px">
      <input class="fi" id="iv-a-${escAttr(x.id)}" placeholder="금액" style="flex:1 1 96px;min-width:0;font-size:11.5px;padding:6px;text-align:right"
        value="${items.length && !invs.length ? billedAmount(x.id) : ''}">
      <select class="fi bl-cur" id="iv-cur-${escAttr(x.id)}">
        ${currencies().map(c => `<option value="${c}"${currencyOf(x.id) === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <button class="btn bp bs" style="flex:0 0 auto" onclick="addExhInvoice('${escAttr(x.id)}')">발행</button>
    </div>
    <div style="font-size:10.5px;color:var(--i5);margin-top:5px">
      금액 항목 합계가 기본값으로 들어가요. 부스+비품 따로, 그래픽 따로 나눠 발행해도 됩니다.<br>
      <b>양식 내려받기</b>는 ${window.invoiceFolderName?.(exhEvent)
        ? `저장 폴더(<b>${escapeHtml(window.invoiceFolderName(exhEvent))}</b>)의 기업 폴더에 바로 저장돼요`
        : '다운로드로 받아요 — <b>신청항목</b> 탭에서 저장 폴더를 지정하면 폴더에 바로 저장됩니다'}.</div>`)}

  ${sct('세금계산서', `
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
      ${taxes.length ? taxes.map(v => `
        <div style="padding:8px 10px;background:var(--i9);border-radius:7px${v.status === 'void' ? ';opacity:.55' : ''}">
          <div class="bl-row bl-inv-hd">
            <span style="min-width:0;font-size:12px;font-weight:700${v.status === 'void' ? ';text-decoration:line-through' : ''}">${escapeHtml(v.title || '세금계산서')}</span>
            ${v.status === 'void' ? '<span class="pill p-gray">무효</span>' : '<span></span>'}
            <input class="fi bl-amt-in" value="${escAttr(v.amount ?? '')}" placeholder="금액 미입력"
              onchange="setTaxField('${escAttr(v.id)}','amount',this.value)">
            ${curSelect(v.currency, `setTaxField('${escAttr(v.id)}','currency',this.value)`)}
            <button class="btn bs" onclick="toggleVoidTax('${escAttr(v.id)}')" title="${v.status === 'void' ? '되살리기' : '취소·수정 발행됨으로 표시(합계에서 제외)'}">${v.status === 'void' ? '되살리기' : '무효'}</button>
            <button class="btn bs" onclick="delExhTax('${escAttr(v.id)}')">✕</button>
          </div>
          ${v.status === 'void' && v.void_note ? `<div style="font-size:10.5px;color:var(--i5);margin-top:3px">${escapeHtml(v.void_note)}</div>` : ''}
          <div style="margin-top:6px">${taxStageBar(v)}</div>
        </div>`).join('') : '<div style="font-size:11.5px;color:var(--i5);padding:8px 2px">발행한 세금계산서가 없어요</div>'}
    </div>
    <div class="bl-row bl-inv-add">
      <input class="fi" id="tx-t-${escAttr(x.id)}" placeholder="제목 (예: 부스+비품)" style="flex:1 1 140px;min-width:0;font-size:11.5px;padding:6px">
      <input class="fi" id="tx-a-${escAttr(x.id)}" placeholder="금액" style="flex:1 1 96px;min-width:0;font-size:11.5px;padding:6px;text-align:right">
      <select class="fi bl-cur" id="tx-cur-${escAttr(x.id)}">
        ${currencies().map(c => `<option value="${c}"${currencyOf(x.id) === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <button class="btn bp bs" style="flex:0 0 auto" onclick="addExhTax('${escAttr(x.id)}')">추가</button>
    </div>
    <div style="font-size:10.5px;color:var(--i5);margin:5px 0 10px">
      인보이스처럼 나눠 발행하거나(부스+비품 먼저, 그래픽 나중), 통화·금액 오류로 다시 발행할 때는
      옛 건을 무효로 두고 새로 추가하세요 — 지우면 왜 두 장인지 이력이 사라져요.</div>
    <div class="fgr bl-tax">
      <div class="fg"><label class="fl">담당자</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.tax_contact_name || '')}"
          onchange="setExhField('${escAttr(x.id)}','tax_contact_name',this.value,'세금계산서 담당자')"></div>
      <div class="fg"><label class="fl">이메일</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.tax_contact_email || '')}"
          onchange="setExhField('${escAttr(x.id)}','tax_contact_email',this.value,'세금계산서 담당자')"></div>
    </div>
    <div class="fgr bl-tax">
      <div class="fg"><label class="fl">연락처</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.tax_contact_phone || '')}"
          onchange="setExhField('${escAttr(x.id)}','tax_contact_phone',this.value,'세금계산서 담당자')"></div>
    </div>`)}

  ${sct('입금 내역', `
    <div style="display:flex;flex-direction:column;gap:1px;margin-bottom:8px">
      ${ins.length ? ins.map((p, i) => `
        <div class="bl-row bl-pay" style="padding:6px 8px;background:var(--i9);border-radius:6px">
          <select class="fi" style="font-size:10px;padding:3px 2px;min-width:0"
            title="결제 수단" onchange="setPayField('${escAttr(p.id)}','method',this.value)">
            <option value=""${p.method ? '' : ' selected'}>미기재</option>
            ${payMethods().map(o => `<option value="${escAttr(o.code)}"${p.method === o.code ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
          </select>
          <input type="date" class="fi" style="font-size:11px;padding:3px 4px;min-width:0" value="${escAttr(p.paid_at || '')}"
            onchange="setPayField('${escAttr(p.id)}','paid_at',this.value)">
          <input class="fi" style="font-size:11px;padding:3px 6px;min-width:0" value="${escAttr(p.note || '')}"
            placeholder="${ins.length > 1 ? `${i + 1}차 · ` : ''}비고 (대납·승인번호 등)"
            onchange="setPayField('${escAttr(p.id)}','note',this.value)">
          <input class="fi bl-amt-in" value="${escAttr(p.amount || '')}" placeholder="금액"
            onchange="setPayField('${escAttr(p.id)}','amount',this.value)">
          ${curSelect(p.currency, `setPayField('${escAttr(p.id)}','currency',this.value)`)}
          <button class="btn bs" onclick="delExhPayment('${escAttr(p.id)}')">✕</button>
        </div>`).join('') : '<div style="font-size:11.5px;color:var(--i5);padding:8px 2px">입금 내역이 없어요</div>'}
    </div>
    <div class="bl-row bl-pay-add">
      <select class="fi" id="py-m-${escAttr(x.id)}" style="flex:0 0 116px;font-size:11px;padding:6px" title="결제 수단">
        ${payMethods().map(o => `<option value="${escAttr(o.code)}">${escapeHtml(o.label)}</option>`).join('')}
      </select>
      <input type="date" class="fi" id="py-d-${escAttr(x.id)}" style="flex:1 1 120px;min-width:0;font-size:11.5px;padding:6px" value="${td()}">
      <input class="fi" id="py-n-${escAttr(x.id)}" placeholder="비고(승인번호 등)" style="flex:1 1 90px;min-width:0;font-size:11.5px;padding:6px">
      <input class="fi" id="py-a-${escAttr(x.id)}" placeholder="입금액" style="flex:1 1 100px;min-width:0;font-size:11.5px;padding:6px;text-align:right"
        value="${rest > 0 ? rest : ''}">
      <select class="fi bl-cur" id="py-cur-${escAttr(x.id)}">
        ${currencies().map(c => `<option value="${c}"${currencyOf(x.id) === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <button class="btn bp bs" style="flex:0 0 auto" onclick="addExhPayment('${escAttr(x.id)}')">추가</button>
    </div>
    <div style="font-size:10.5px;color:var(--i5);margin-top:5px">
      분할 입금이면 여러 번 추가하세요.</div>`)}

  ${sct('환불 내역', `
    <div style="display:flex;flex-direction:column;gap:1px;margin-bottom:8px">
      ${refunds.length ? refunds.map(p => {
        // 요청과 완료를 나눈다 — 완료된 것만 입금 합계에서 빠진다.
        // 체크를 누르면 완료로 바뀌면서 그때 비로소 잔액에 반영된다.
        const pend = isPendingRefund(p);
        return `
        <div class="bl-row bl-pay" style="padding:6px 8px;background:${pend ? 'var(--ab)' : 'var(--i9)'};border-radius:6px">
          <button onclick="toggleRefundDone('${escAttr(p.id)}')"
            title="${pend ? '환불 완료로 표시 (합계에서 차감됩니다)' : '환불 요청 상태로 되돌리기'}"
            style="display:flex;align-items:center;gap:5px;border:none;background:none;padding:0;font-size:10px;font-weight:700;color:${pend ? 'var(--am)' : 'var(--re)'}">
            <span style="width:16px;height:16px;border-radius:4px;flex-shrink:0;line-height:1;
              border:1.5px solid ${pend ? 'var(--am)' : 'var(--re)'};background:${pend ? 'transparent' : 'var(--re)'};
              color:#fff;display:flex;align-items:center;justify-content:center">${pend ? '' : '✓'}</span>
            ${pend ? '요청' : '완료'}
          </button>
          <input type="date" class="fi" style="padding:3px 6px;font-size:11px" value="${escAttr(pend ? (p.requested_at || '') : (p.paid_at || ''))}"
            title="${pend ? '요청일' : '환불일'}"
            onchange="setPayField('${escAttr(p.id)}','${pend ? 'requested_at' : 'paid_at'}',this.value)">
          <input class="fi" style="min-width:0;font-size:11px;padding:3px 6px" placeholder="사유"
            value="${escAttr(p.reason || p.note || '')}"
            onchange="setPayField('${escAttr(p.id)}','reason',this.value)">
          <input class="fi bl-amt-in" value="${escAttr(p.amount || '')}" placeholder="금액" style="color:var(--re)"
            onchange="setPayField('${escAttr(p.id)}','amount',this.value)">
          ${curSelect(p.currency, `setPayField('${escAttr(p.id)}','currency',this.value)`)}
          <button class="btn bs" onclick="delExhPayment('${escAttr(p.id)}')">✕</button>
        </div>`;
      }).join('') : '<div style="font-size:11.5px;color:var(--i5);padding:8px 2px">환불 내역이 없어요</div>'}
    </div>
    <div class="bl-row bl-pay-add">
      <span class="pill p-red" style="text-align:center">환불</span>
      <input type="date" class="fi" id="rf-d-${escAttr(x.id)}" style="flex:1 1 130px;min-width:0;font-size:11.5px;padding:6px" value="${td()}">
      <input class="fi" id="rf-r-${escAttr(x.id)}" placeholder="사유 (예: 부스 축소)" style="flex:1 1 100px;min-width:0;font-size:11.5px;padding:6px">
      <input class="fi" id="rf-a-${escAttr(x.id)}" placeholder="환불액" style="flex:1 1 100px;min-width:0;font-size:11.5px;padding:6px;text-align:right">
      <select class="fi bl-cur" id="rf-cur-${escAttr(x.id)}">
        ${currencies().map(c => `<option value="${c}"${currencyOf(x.id) === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <button class="btn bs" style="flex:0 0 auto" onclick="addExhRefund('${escAttr(x.id)}')">요청</button>
    </div>
    <div style="font-size:10.5px;color:var(--i5);margin-top:5px">
      환불은 <b>요청</b> 상태로 들어가고, 실제로 보낸 뒤 왼쪽 체크를 누르면 <b>완료</b>가 되면서
      그때 입금 합계에서 빠져요 — 아직 안 보낸 돈이 나간 것처럼 보이지 않게요.
      ${pendingRf.length ? `<br><b style="color:var(--am)">보내야 할 환불 ${pendingRf.length}건</b>` : ''}</div>`)}
  `;
}

/* ══════════════════════════════════════════
   3) 그래픽 — 출력 / 제작 분기
══════════════════════════════════════════ */
/* ══════════════════════════════════════════
   그래픽 피드백

   그래픽은 네 단계를 오가며 사람이 세 번 바뀐다(기업 → 담당자 → 그래픽팀 →
   담당자). "해상도가 부족하다", "재단선을 다시 받아야 한다" 같은 말이 그때마다
   오가는데, 적어 둘 자리가 없어 메신저와 메일로 흩어졌다.

   기록을 새 표에 담지 않고 기존 문의·기록(exhibitor_logs)을 쓴다. 작성자와
   시각이 이미 붙고, 문의·기록 탭에서 다른 연락과 한 줄기로 보인다 — 그래픽
   피드백만 따로 모아 두면 "이 기업과 무슨 얘기가 오갔나"를 두 군데서 봐야 한다.

   어느 단계에서 남긴 말인지 subject에 적어 둔다. 나중에 읽을 때 "그래픽팀
   확인 중에 나온 말"과 "회신 뒤에 나온 말"은 뜻이 다르다.
══════════════════════════════════════════ */
export const graphicFeedback = (exhId) =>
  logsFor(exhId).filter(l => l.category === '그래픽' && l.kind === 'note');

function graphicFeedbackBlock(x){
  const rows = graphicFeedback(x.id);
  const cur = stageOf(GRAPHIC_STAGES, x.graphic_stage);
  const me = currentUser?.email || '';

  return `<div style="font-size:11px;color:var(--i4);margin-bottom:7px">
      지금 단계는 <b>${escapeHtml(cur.label)}</b>이고, 남기는 사람은
      <b>${escapeHtml(currentUser?.name || currentUser?.email || '(로그인 정보 없음)')}</b>으로 적힙니다.
      여기 적은 내용은 <b>문의·기록</b> 탭에도 함께 남아요.</div>

    <textarea class="fi" id="gfb-${escAttr(x.id)}" rows="2" placeholder="예: 로고 해상도가 낮아 재전달 요청했습니다"
      style="width:100%;resize:vertical;font-size:12px"></textarea>
    <div style="display:flex;justify-content:flex-end;margin-top:6px">
      <button class="btn bp bs" onclick="addGraphicFeedback('${escAttr(x.id)}')">피드백 남기기</button>
    </div>

    ${rows.length ? `<div style="margin-top:10px">${rows.map(l => `
      <div style="padding:8px 0;border-top:1px solid var(--i8)">
        <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap">
          <span style="font-size:11.5px;font-weight:700">${escapeHtml(l.author_name || l.author_email || '알 수 없음')}</span>
          ${l.subject ? `<span class="pill p-gray" style="font-size:9px">${escapeHtml(l.subject)}</span>` : ''}
          <span style="font-size:10px;color:var(--i5)">${escapeHtml(l.ts || '')}</span>
          ${l.author_email && l.author_email === me
            ? `<button class="btn bs" style="margin-left:auto;font-size:10px;padding:1px 6px"
                onclick="delGraphicFeedback('${escAttr(l.id)}')">삭제</button>` : ''}
        </div>
        <div style="font-size:12px;color:var(--i2);white-space:pre-wrap;margin-top:3px">${escapeHtml(l.body || '')}</div>
      </div>`).join('')}</div>`
      : '<div style="font-size:11.5px;color:var(--i5);margin-top:10px">아직 남긴 피드백이 없어요</div>'}`;
}

export async function addGraphicFeedback(exhId){
  const ta = document.getElementById(`gfb-${exhId}`);
  const body = ta?.value.trim() || '';
  if(!body){ ta?.focus(); return; }
  const x = getExhibitorById(exhId);
  const cur = stageOf(GRAPHIC_STAGES, x?.graphic_stage);

  const ok = await addRow(EXH_LOGS, {
    id: localId('XL-'), exhibitor_id: exhId, kind: 'note', ts: td(),
    direction: '', channel: '', counterpart: '', category: '그래픽',
    // 어느 단계에서 남긴 말인지 — 나중에 읽을 때 뜻이 달라진다
    subject: cur.label || '', body, answered_at: '', answer: '', status: 'done',
    author_email: currentUser?.email || '', author_name: currentUser?.name || '',
  }, saveExhLog);

  // 저장에 실패하면 화면을 다시 그리면서 입력칸이 새로 만들어져 적은 글이
  // 사라진다. 실패했을 때야말로 다시 눌러야 하므로 적은 내용을 돌려놓는다.
  const el = document.getElementById(`gfb-${exhId}`);
  if(!ok){ if(el){ el.value = body; el.focus(); } return; }

  if(el) el.value = '';
  trackAction('log', '그래픽 피드백', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> 그래픽 피드백(${escapeHtml(cur.label || '')}): ${escapeHtml(body.slice(0, 40))}`,
    { kind: 'exhibitor', id: x?.id, tab: 'graphic' });
}

/* 남의 글은 지우지 못한다 — 버튼 자체를 내 글에만 붙이지만, 눌리는 경로가
   생기더라도 여기서 한 번 더 막는다 */
export async function delGraphicFeedback(id){
  const l = EXH_LOGS.find(r => r.id === id);
  if(!l) return;
  if(l.author_email && currentUser?.email && l.author_email !== currentUser.email){
    alert('내가 남긴 피드백만 지울 수 있어요.'); return;
  }
  if(!confirm('이 피드백을 지울까요? 문의·기록 탭에서도 함께 사라집니다.')) return;
  await removeRow(EXH_LOGS, id, deleteExhLog);
}

/* ══════════════════════════════════════════
   그래픽 항목 — 무엇을 주문했고, 무엇을 받았나

   둘은 따로 논다. 백월·행잉배너·부스 그래픽을 한 번에 주문해도 파일은 따로,
   며칠 간격으로 온다. 전에는 "그래픽 항목 3건 · 합계 120만원" 한 줄뿐이라
   무엇이 아직 안 왔는지 알 수 없었다 — 단계(graphic_stage)는 기업 단위라
   "기업 전달"로 넘겨도 세 개 중 둘만 온 경우를 담지 못한다.

   항목마다 받은 날과 받은 것 설명을 따로 남긴다. 금액 항목과 같은 줄을 쓰므로
   정산 탭에서 추가한 그래픽이 그대로 여기 나온다 — 두 군데에 또 적지 않는다.
══════════════════════════════════════════ */
/* 정산에 들어간 그래픽 항목 — 취소(voided)된 줄은 받을 것이 아니다.
   드로어 탭 배지와 그래픽 탭이 같은 목록을 봐야 숫자가 어긋나지 않는다. */
function graphicItems(exhId){
  return liveItemsFor(exhId).filter(i => (i.category || '') === 'graphic');
}
export function graphicUnreceived(exhId){
  return graphicItems(exhId).filter(i => !i.received_at).length;
}

function graphicItemsBlock(x){
  const gi = graphicItems(x.id);
  if(!gi.length){
    return `<div style="font-size:11.5px;color:var(--i5);margin-bottom:8px">등록된 그래픽 항목이 없어요</div>
      <div style="font-size:11px;color:var(--i4);margin-bottom:8px">
        정산 탭에서 <b>그래픽</b> 분류로 항목을 추가하면 여기 나옵니다.</div>
      <button class="btn bs" onclick="switchExhDT('billing')">정산 탭으로 이동</button>`;
  }

  const total = gi.reduce((s, i) => s + Number(String(i.amount || '').replace(/[^0-9.-]/g, '') || 0), 0);
  const got = gi.filter(i => i.received_at).length;
  const late = gi.filter(i => !i.received_at && graphicDueInfo(i).late).length;

  return `<div style="font-size:11px;color:var(--i4);margin-bottom:8px">
      정산 탭의 <b>그래픽</b> 분류에서 그대로 가져옵니다 — 여기서 항목을 늘리거나 지우지는 않아요.
      기업에서 파일을 받으면 왼쪽 칸에 체크하고, 받은 파일이 무엇이었는지 적어 두세요.
      <b>마감</b>은 이 파일을 언제까지 받기로 했나입니다 — 지난 것은 그래픽 현황에서 붉게 잡힙니다.</div>

    ${gi.map(i => {
      const on = !!i.received_at;
      return `<div style="padding:9px 0;border-bottom:1px solid var(--i8)">
        <div style="display:flex;align-items:center;gap:9px">
          <button onclick="toggleItemReceived('${escAttr(i.id)}')"
            title="${on ? '받음 표시를 지웁니다' : '오늘 받은 것으로 표시합니다'}"
            style="width:20px;height:20px;border-radius:5px;border:1.5px solid ${on ? 'var(--g)' : 'var(--i6)'};background:${on ? 'var(--g)' : 'transparent'};color:#fff;font-size:12px;font-weight:800;cursor:pointer;flex-shrink:0;line-height:1">${on ? '✓' : ''}</button>
          <span style="flex:1;min-width:0">
            <span style="font-size:12.5px;font-weight:${on ? 600 : 500};color:${on ? 'var(--i1)' : 'var(--i3)'}">${escapeHtml(i.name || '(이름 없음)')}</span>
            <span style="font-size:10.5px;color:var(--i4)">${i.qty ? ` · ${escapeHtml(String(i.qty))}개` : ''}${
              i.amount ? ` · ${escapeHtml(fmtMoney(i.amount, i.currency))}` : ''}</span>${
              isDesignItem(i) && i.note ? `<div style="font-size:10.5px;color:var(--i4);margin-top:2px">디자인 대상 — <b>${escapeHtml(i.note)}</b></div>` : ''}
          </span>
          <input type="date" class="fi" style="width:136px;padding:4px 8px;font-size:11.5px"
            value="${escAttr(i.received_at || '')}"
            onchange="setItemField('${escAttr(i.id)}','received_at',this.value)">
        </div>
        <div style="display:flex;gap:9px;align-items:center;margin-top:5px;padding-left:29px">
          <span style="font-size:10.5px;color:var(--i5);flex:0 0 auto">마감</span>
          <input type="date" class="fi" style="width:136px;padding:4px 8px;font-size:11.5px"
            value="${escAttr(i.due_at || '')}"
            onchange="setItemField('${escAttr(i.id)}','due_at',this.value)">
          ${(() => { const d = graphicDueInfo(i);
            return on ? '' : `<span class="pill ${d.cls}">${escapeHtml(d.text)}</span>`; })()}
        </div>
        <div style="display:flex;gap:9px;align-items:center;margin-top:5px;padding-left:29px">
          <span style="font-size:10.5px;color:var(--i5);flex:0 0 auto">받은 것</span>
          <input class="fi" style="flex:1;min-width:0;padding:4px 8px;font-size:11.5px"
            value="${escAttr(i.received_note || '')}" placeholder="예: 백월_최종.ai · CMYK · 재단선 포함"
            onchange="setItemField('${escAttr(i.id)}','received_note',this.value)">
        </div>
      </div>`;
    }).join('')}

    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:9px 2px 0;font-size:12px">
      <span style="color:var(--i4)">${gi.length}건 · 받음 ${got}건${got < gi.length ? ` · <b style="color:var(--am)">미수령 ${gi.length - got}건</b>` : ''}${
        late ? ` · <b style="color:var(--re)">마감 지남 ${late}건</b>` : ''}</span>
      <span>합계 <b>${money(total)}</b>원</span>
    </div>
    <button class="btn bs" onclick="switchExhDT('billing')" style="margin-top:8px">정산 탭에서 항목 추가·수정</button>`;
}

/* 받음 체크 — 누르면 오늘 날짜가 들어가고, 다시 누르면 지운다.
   지울 때는 원래 날짜를 기록에 남긴다(잘못 눌러 지운 값을 되찾을 수 있게). */
export async function toggleItemReceived(id){
  const i = EXH_ITEMS.find(r => r.id === id);
  if(!i) return;
  await setItemField(id, 'received_at', i.received_at ? '' : td());
}

function dGraphic(x){
  /* 정산에 그래픽 항목이 들어갔다는 건 이미 주문을 받았다는 뜻이다. 전에는
     graphic_ordered_at을 따로 눌러 줘야 이 탭이 열려서, 정산에 항목을 넣어 놓고도
     "그래픽 주문 없음"을 보게 됐다 — 받아야 할 파일이 있는데 그 목록이 잠겨 있었다.
     항목이 있으면 주문일 없이도 연다(주문일은 언제 받았나를 적는 칸으로 남는다). */
  const gItems = graphicItems(x.id);
  const ordered = !!x.graphic_ordered_at || gItems.length > 0;
  const g = graphicState(x);
  const invs = invoicesFor(x.id);

  if(!ordered){
    return `<div style="text-align:center;padding:40px 20px">
      <div style="font-size:28px;margin-bottom:8px">🎨</div>
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">그래픽 주문 없음</div>
      <div style="font-size:11.5px;color:var(--i4);margin-bottom:16px">
        정산 탭에서 <b>그래픽</b> 분류로 항목을 넣으면 여기가 자동으로 열려요.<br>
        항목 없이 먼저 잡아 두려면 아래에서 주문일만 등록할 수도 있어요.</div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        <button class="btn bp" onclick="switchExhDT('billing')">정산 탭에서 항목 넣기</button>
        <button class="btn" onclick="toggleExhDate('${escAttr(x.id)}','graphic_ordered_at','그래픽 주문')">주문일만 등록</button>
      </div>
    </div>`;
  }

  return `
  ${sct('받을 그래픽', graphicItemsBlock(x), (() => {
    if(!gItems.length) return '';
    const got = gItems.filter(i => i.received_at).length;
    return `<span class="pill ${got === gItems.length ? 'p-green' : got ? 'p-amber' : 'p-amber'}">받음 ${got}/${gItems.length}</span>`;
  })())}

  ${sct('주문', dateRow(x, 'graphic_ordered_at', '그래픽 주문일') +
    `<div style="padding:10px 0 0"><label class="fl">유형</label>
      <div class="stbs" style="margin-top:4px">
        ${[['print', '출력만'], ['design', '제작(디자인)']].map(([v, l]) =>
          `<button class="stb${x.graphic_type === v ? ' on' : ''}" onclick="setExhField('${escAttr(x.id)}','graphic_type','${v}','그래픽 유형')">${l}</button>`).join('')}
      </div></div>`,
    g.state === 'done' ? '<span class="pill p-green">완료</span>' : g.state === 'warn' ? '<span class="pill p-amber">확인 필요</span>' : '')}

  ${sct('확인 진행', stageBar(x, 'graphic_stage', GRAPHIC_STAGES, '그래픽팀'))}

  ${x.graphic_type === 'print' ? sct('출력 — 규격 확인', `
    <div class="stbs" style="margin-bottom:8px">
      ${[['', '미확인'], ['yes', '규격 맞음'], ['no', '규격 안 맞음']].map(([v, l]) =>
        `<button class="stb${(x.graphic_spec_ok || '') === v ? ' on' : ''}" onclick="setExhField('${escAttr(x.id)}','graphic_spec_ok','${v}','그래픽 규격 확인')">${l}</button>`).join('')}
    </div>
    ${x.graphic_spec_ok === 'no' ? textRow(x, 'graphic_spec_note', '어떤 점이 안 맞나요', '예: 해상도 부족, 재단선 없음', true) : ''}`)
  : ''}

  ${x.graphic_type === 'design' ? sct('제작 — 시안 확정', `
    <div class="sgbar" style="margin-bottom:10px">
      ${[['graphic_draft_at', '초안'], ['graphic_revised_at', '수정안'], ['graphic_final_at', '최종안']].map(([f, l]) =>
        `<div class="sgc${x[f] ? ' done' : ''}">${l}</div>`).join('')}
    </div>
    ${dateRow(x, 'graphic_draft_at', '초안 전달')}
    ${dateRow(x, 'graphic_revised_at', '수정안 전달')}
    ${dateRow(x, 'graphic_final_at', '최종안 확정')}`)
  : ''}

  ${!x.graphic_type ? '<div style="font-size:11.5px;color:var(--am);padding:4px 2px">유형을 먼저 선택해주세요</div>' : ''}

  ${sct('피드백', graphicFeedbackBlock(x),
    (() => { const n = graphicFeedback(x.id).length; return n ? `<span class="pill p-gray">${n}</span>` : ''; })())}

  `;
}

/* ══════════════════════════════════════════
   4) 문의·기록
══════════════════════════════════════════ */
/* 문의 채널·분류도 설정에서 고친다(code_lists) */
const channels = () => codeList('log_channel', null,
  ['이메일', '전화', '카톡', '미팅', '현장'].map(c => ({ code: c, label: c })));
const logCats = () => codeList('log_cat', null,
  ['부스', '비품', '그래픽', '정산', '현장', '기타'].map(c => ({ code: c, label: c })));

function dLogs(x){
  const logs = logsFor(x.id);
  const open = logs.filter(l => l.kind === 'inquiry' && !l.answered_at);
  const rest = logs.filter(l => !(l.kind === 'inquiry' && !l.answered_at));
  const cos = CO_DB.find(c => c.key === x.company_key);
  const people = (cos?.contacts || []).map(c => c.name).filter(Boolean);

  const item = (l) => {
    const isInq = l.kind === 'inquiry';
    const unanswered = isInq && !l.answered_at;
    const d = daysSince(l.ts);
    return `<div style="padding:10px 11px;border-radius:8px;margin-bottom:6px;background:${unanswered ? 'var(--ab)' : 'var(--i9)'};border-left:3px solid ${unanswered ? 'var(--am)' : isInq ? 'var(--g)' : 'var(--i6)'}">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <span class="pill ${isInq ? (unanswered ? 'p-amber' : 'p-green') : 'p-gray'}">${isInq ? (unanswered ? (l.status === 'hold' ? '확인 중' : '답변 대기') : '답변 완료') : '기록'}</span>
        ${l.category ? `<span class="pill p-gray">${escapeHtml(l.category)}</span>` : ''}
        ${l.channel ? `<span style="font-size:10.5px;color:var(--i4)">${escapeHtml(l.channel)}</span>` : ''}
        ${l.counterpart ? `<span style="font-size:10.5px;color:var(--i4)">· ${escapeHtml(l.counterpart)}</span>` : ''}
        <span style="font-size:10.5px;color:var(--i5);margin-left:auto">${escapeHtml(l.ts || '')}${unanswered && d > 0 ? ` · ${d}일 경과` : ''}</span>
      </div>
      ${l.subject ? `<div style="font-size:12.5px;font-weight:700;margin-bottom:3px">${escapeHtml(l.subject)}</div>` : ''}
      ${l.body ? `<div style="font-size:12px;color:var(--i2);white-space:pre-wrap;line-height:1.5">${escapeHtml(l.body)}</div>` : ''}
      ${l.answered_at ? `<div style="margin-top:7px;padding:7px 9px;background:var(--W);border-radius:6px">
          <div style="font-size:10.5px;color:var(--g);font-weight:700;margin-bottom:2px">답변 · ${escapeHtml(l.answered_at)}</div>
          <div style="font-size:12px;color:var(--i2);white-space:pre-wrap">${escapeHtml(l.answer || '')}</div></div>` : ''}
      ${unanswered ? `<div style="margin-top:8px;display:flex;gap:5px;align-items:flex-start">
          <textarea class="fi" id="ans-${escAttr(l.id)}" rows="2" placeholder="답변 내용을 적고 완료 처리하세요" style="flex:1;font-size:11.5px"></textarea>
          <div style="display:flex;flex-direction:column;gap:4px">
            <button class="btn bp bs" onclick="answerExhLog('${escAttr(l.id)}')">답변 완료</button>
            <button class="btn bs" onclick="holdExhLog('${escAttr(l.id)}')">${l.status === 'hold' ? '대기로' : '확인 중'}</button>
          </div></div>` : ''}
      <div style="margin-top:5px;text-align:right">
        <button class="btn bs" onclick="delExhLog('${escAttr(l.id)}')" style="font-size:10px;opacity:.6">삭제</button></div>
    </div>`;
  };

  return `
  <div class="uc" style="margin-bottom:14px">
    <div class="uc-ttl">새 문의 / 기록</div>
    <div style="display:flex;gap:5px;margin:8px 0 6px;flex-wrap:wrap">
      <select class="fi" id="lg-kind-${escAttr(x.id)}" style="width:84px;font-size:11.5px;padding:6px">
        <option value="inquiry">문의</option><option value="note">기록</option></select>
      <select class="fi" id="lg-ch-${escAttr(x.id)}" style="width:82px;font-size:11.5px;padding:6px">
        ${channels().map(c => `<option value="${escAttr(c.code)}">${escapeHtml(c.label)}</option>`).join('')}</select>
      <select class="fi" id="lg-cat-${escAttr(x.id)}" style="width:82px;font-size:11.5px;padding:6px">
        ${logCats().map(c => `<option value="${escAttr(c.code)}">${escapeHtml(c.label)}</option>`).join('')}</select>
      <input class="fi" id="lg-who-${escAttr(x.id)}" placeholder="문의한 사람" list="lg-people-${escAttr(x.id)}" style="flex:1;min-width:100px;font-size:11.5px;padding:6px">
      <datalist id="lg-people-${escAttr(x.id)}">${people.map(p => `<option value="${escAttr(p)}">`).join('')}</datalist>
    </div>
    <input class="fi" id="lg-sub-${escAttr(x.id)}" placeholder="제목 / 한 줄 요약" style="font-size:12px;margin-bottom:5px">
    <textarea class="fi" id="lg-body-${escAttr(x.id)}" rows="3" placeholder="받은 메일 내용을 그대로 붙여넣어도 돼요" style="font-size:12px"></textarea>
    <div style="text-align:right;margin-top:6px">
      <button class="btn bp bs" onclick="addExhLog('${escAttr(x.id)}')">등록</button></div>
  </div>

  ${open.length ? `<div class="sct">답변 대기 <span class="pill p-amber">${open.length}</span></div>
    <div style="margin-bottom:14px">${open.map(item).join('')}</div>` : ''}

  <div class="sct">전체 이력</div>
  ${rest.length ? rest.map(item).join('')
    : '<div style="font-size:11.5px;color:var(--i5);padding:10px 2px">아직 기록이 없어요</div>'}
  `;
}

/* ══════════════════════════════════════════
   저장 액션 — 낙관적 반영 후 실패 시 롤백
══════════════════════════════════════════ */
const localId = (p) => `${p}${Date.now()}_${Math.floor(Math.random() * 1000)}`;

async function addRow(arr, rec, saveFn, label){
  arr.push(rec);
  refreshExhViews();
  const r = await saveFn(rec);
  if(!r.ok){
    const i = arr.indexOf(rec);
    if(i >= 0) arr.splice(i, 1);
    refreshExhViews();
    saveFailed(r);
    return false;
  }
  if(r.id && r.id !== rec.id) rec.id = r.id; // 서버가 만든 id로 맞춘다
  return true;
}

/* 지운 줄은 기록에 남긴다.

   ㈜브레디스헬스케어의 부스 금액 165,000원이 사라진 적이 있는데, 활동 기록
   어디에도 없었다 — 여기서 아무것도 안 적었기 때문이다. 무엇이 얼마였는지는
   지우는 순간 세상에서 없어지고, 인보이스 금액을 거꾸로 짚어서야 되짚을 수
   있었다.

   지워진 값을 통째로 적어 둔다. 이름만 적으면 «무엇을 지웠다»는 알아도
   되살릴 수는 없다 — 되살리는 데 필요한 건 금액·수량·통화다. */
const ROW_LABEL = (r) => r.name || r.title || '';
async function removeRow(arr, id, deleteFn, label = '줄'){
  const i = arr.findIndex(r => r.id === id);
  if(i < 0) return;
  const [removed] = arr.splice(i, 1);
  refreshExhViews();
  const r = await deleteFn(id);
  if(!r.ok){
    arr.splice(i, 0, removed);
    refreshExhViews();
    alert('삭제에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    return;
  }
  const x = getExhibitorById(removed.exhibitor_id);
  const what = [removed.qty && `수량 ${removed.qty}`,
    removed.amount !== undefined && removed.amount !== '' && `${removed.amount} ${removed.currency || 'KRW'}`,
    removed.unit_price && `단가 ${removed.unit_price}`].filter(Boolean).join(' · ');
  /* 지워진 줄은 통째로 담는다. 고친 것과 달리 «어느 칸이 무엇이었나»가 아니라
     줄 전체가 없어진 거라, 되살리려면 모든 칸이 있어야 한다. */
  trackAction('delete', label + ' 삭제', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> — ${escapeHtml(label)} <b>${escapeHtml(ROW_LABEL(removed))}</b> 지움`
    + (what ? ` <span style="color:#9C9890">(${escapeHtml(what)})</span>` : ''),
    { kind: 'exhibitor', id: removed.exhibitor_id, tab: 'billing', row: id,
      op: 'delete', before: removed });
}

const val = (id) => (document.getElementById(id)?.value || '').trim();
const clear = (...ids) => ids.forEach(i => { const el = document.getElementById(i); if(el) el.value = ''; });

export function calcItemAmount(exhId){
  const q = Number(val(`it-qty-${exhId}`).replace(/[^0-9.-]/g, ''));
  const u = Number(val(`it-up-${exhId}`).replace(/[^0-9.-]/g, ''));
  const el = document.getElementById(`it-amt-${exhId}`);
  if(el && q && u) el.value = q * u;
}

export async function addExhItem(exhId){
  const name = val(`it-nm-${exhId}`);
  // 금액칸이 비어 있으면 수량×단가로 계산한다. 예전에는 단가를 그대로 써서
  // 수량 3 × 단가 1,000이 1,000원으로 저장되며 청구액이 조용히 적게 잡혔다.
  const n = (v) => Number(String(v || '').replace(/[^0-9.-]/g, '')) || 0;
  const qty = n(val(`it-qty-${exhId}`)), unit = n(val(`it-up-${exhId}`));
  const amount = val(`it-amt-${exhId}`) || String(qty && unit ? qty * unit : unit || '');
  if(!name){ alert('항목명을 입력해주세요.'); return; }

  const category = val(`it-cat-${exhId}`) || 'etc';
  const currency = val(`it-cur-${exhId}`) || currencyOf(exhId);
  lastItemCat = category;   // 다음 줄도 같은 분류일 가능성이 높다
  let catalogId = document.getElementById(`it-nm-${exhId}`)?.dataset.catalogId || '';
  // 비품인데 카탈로그에서 고르지 않았다면 품목마스터에 함께 올린다
  if(!catalogId && category === 'equip'){
    const x = getExhibitorById(exhId);
    if(x) catalogId = await registerDirectItem(x, name, val(`it-up-${exhId}`), currency, val(`it-cat-${exhId}`));
  }

  /* 반영 중인 접수 건이 있으면 이 품목이 그 건으로 들어온 것으로 적는다 —
     사람이 "추가인가 변경인가"를 따로 고르지 않아도 남는다. */
  const openApp = openAppFor(exhId);
  await addRow(EXH_ITEMS, {
    id: localId('XI-'), exhibitor_id: exhId, category,
    catalog_id: catalogId,
    name, qty: val(`it-qty-${exhId}`), unit_price: val(`it-up-${exhId}`), amount,
    currency, note: '',
    app_id: openApp ? openApp.id : '', change_kind: openApp ? '추가' : '',
    sort_order: nextItemSort(exhId),
  }, saveExhItem);
  clear(`it-nm-${exhId}`, `it-qty-${exhId}`, `it-up-${exhId}`, `it-amt-${exhId}`);
  // 지난 선택이 남아 있으면 다음에 손으로 적은 항목에 엉뚱한 품목이 붙는다
  const nmEl = document.getElementById(`it-nm-${exhId}`);
  if(nmEl) delete nmEl.dataset.catalogId;
}
export const delExhItem = (id) => removeRow(EXH_ITEMS, id, deleteExhItem, '금액 항목');

/* 신청서에 적은 추가 비품 내역을 금액 항목으로 옮겨 담는다 —
   적어둔 걸 다시 타이핑하지 않게 하려는 연결고리. */
export function addItemFromEquip(exhId){
  const x = getExhibitorById(exhId);
  const text = (x?.extra_equipment || '').trim();
  if(!text){ alert('신청서 탭의 "추가 비품 신청 내역"을 먼저 적어주세요.'); return; }
  switchExhDT('billing');
  setTimeout(() => {
    const el = document.getElementById(`it-nm-${exhId}`);
    const cat = document.getElementById(`it-cat-${exhId}`);
    if(cat) cat.value = 'equip';
    if(el){ el.value = text.split('\n')[0]; el.focus(); }
  }, 30);
}

export async function addExhInvoice(exhId){
  const title = val(`iv-t-${exhId}`) || '인보이스';
  const amount = val(`iv-a-${exhId}`);
  if(!amount){ alert('금액을 입력해주세요.'); return; }
  await addRow(EXH_INVOICES, {
    id: localId('XV-'), exhibitor_id: exhId, title, amount, currency: val(`iv-cur-${exhId}`) || currencyOf(exhId),
    created_at: td(), sent_at: '', due_date: '', note: '',
  }, saveExhInvoice);
  clear(`iv-t-${exhId}`, `iv-a-${exhId}`);
}
export const delExhInvoice = (id) => removeRow(EXH_INVOICES, id, deleteExhInvoice, '인보이스');

/* 화면 입력칸을 거치지 않고 인보이스 줄을 만든다 — exh-invoice.js의 '발행'이
   쓴다(신청 내역에서 곧바로 발행할 때는 사람이 금액을 두드리지 않는다).
   쓰기는 여기 모여 있어야 한다: 잠금(guardWrite)과 실패 되돌리기가 여기 있다. */
export async function createInvoiceRow(exhId, { title, amount, currency }){
  const rec = {
    id: localId('XV-'), exhibitor_id: exhId, title: title || '인보이스', amount,
    currency: currency || currencyOf(exhId),
    created_at: td(), sent_at: td(), due_date: '', note: '',
  };
  return (await addRow(EXH_INVOICES, rec, saveExhInvoice)) ? rec : null;
}

/* 금액·통화를 줄에서 바로 고친다. 기록에도 무엇이 어떻게 바뀌었는지 남긴다 —
   금액은 나중에 "왜 이 숫자가 됐지"를 되짚어야 할 일이 가장 많은 값이다. */
/* 저장됐는지를 돌려준다 — 실패하면 값을 되돌리는데, 부르는 쪽이 그걸 모르면
   되돌려진 변경을 «고쳤어요»라고 기록에 남긴다.

   silent는 부르는 쪽이 제 말로 기록을 남길 때 쓴다. 두 줄이 쌓이면 하나는
   맥락이 없고(그냥 «금액 수정»), 나중에 세어 볼 때 두 번 센다. */
async function setRowField(list, saver, label, id, field, value, opts = {}){
  const r = list.find(o => o.id === id);
  if(!r) return false;
  const before = r[field];
  r[field] = value;
  refreshExhViews();
  const res = await saver({ id, [field]: value });
  if(!res.ok){ r[field] = before; refreshExhViews(); saveFailed(res, '저장에 실패했어요.'); return false; }
  if(opts.silent) return true;
  const x = getExhibitorById(r.exhibitor_id);
  const fl = { amount: '금액', currency: '통화',
    received_at: '받은 날', received_note: '받은 것',
    method: '결제 수단', note: '비고', paid_at: '입금일' }[field] || field;
  trackAction('edit', label + ' 수정', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(r.name || r.title || label)} ${escapeHtml(fl)} ${escapeHtml(String(before || '(없음)'))} → ${escapeHtml(String(value || '(없음)'))}`,
    /* 값 자체도 담는다 — 문장만으로는 되돌릴 수 없다 */
    { kind: 'exhibitor', id: x?.id, tab: 'billing', field, row: id,
      op: 'update', before: { [field]: before ?? '' }, after: { [field]: value ?? '' } });
  return true;
}

/* 수량·금액을 고치면 그것도 접수 건의 "변경"이다. 바뀌기 전 값을 한 번만
   붙잡아 둔다 — 같은 접수 건 안에서 두 번 고쳐도 처음 값이 기준이어야
   "1 → 3"이 나온다. */
const TRACKED = ['qty', 'amount', 'unit_price'];
/* 정산에서 직접 고친다 — 신청서 회차를 거치지 않은 변경.

   누가 언제 고쳤는지는 줄에 적고(줄 옆 «정산수정» 표), 무엇을 얼마에서 얼마로
   고쳤는지는 활동 기록에 남긴다. 한 줄이 여러 번 바뀌므로 칸에 담아 두면
   마지막 것만 남는다.

   고치면 청구액이 바뀐다. 이미 인보이스를 보냈다면 그만큼 차액이 생기고,
   그건 위쪽 «추가 발행 필요»가 스스로 알아챈다(금액 항목 합계와 발행한
   인보이스 합계를 견준다) — 따로 «발행함» 표를 두면 그 표만 손으로 지우는
   일이 생긴다. */
export async function setItemFieldDirect(id, field, value){
  const i = EXH_ITEMS.find(r => r.id === id);
  if(!i) return;
  const was = String(i[field] ?? '');
  if(was === String(value ?? '')) return;
  const x = getExhibitorById(i.exhibitor_id);
  const lbl = { amount: '금액', currency: '통화', qty: '수량', unit_price: '단가' }[field] || field;

  /* 저장이 안 되면 값은 되돌아간다 — 그때는 기록도 남기지 않는다.
     되돌려진 변경이 기록에 남으면, 금액이 왜 다른지 되짚을 때 없는 변경을
     쫓게 된다. */
  if(!await setItemField(id, field, value, { silent: true })) return;
  await setRowField(EXH_ITEMS, saveExhItem, '금액 항목', id, 'edited_at', td(), { silent: true });
  await setRowField(EXH_ITEMS, saveExhItem, '금액 항목', id, 'edited_by', currentUser?.name || '', { silent: true });

  trackAction('update', '정산 직접 수정', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> — ${escapeHtml(i.name || '')}의 ${escapeHtml(lbl)}을(를) `
    + `<b>${escapeHtml(was || '(빈값)')}</b> → <b>${escapeHtml(String(value ?? '') || '(빈값)')}</b>로 고쳤어요 `
    + `<span style="color:#9C9890">(신청서를 거치지 않은 변경)</span>`,
    changed('exhibitor_items', id, { [field]: was }, { [field]: value ?? '' },
      { kind: 'exhibitor', id: i.exhibitor_id, tab: 'billing', field }));
  refreshExhViews();
}

export async function setItemField(id, field, value, opts = {}){
  const i = EXH_ITEMS.find(r => r.id === id);
  const open = i ? openAppFor(i.exhibitor_id) : null;
  if(i && open && TRACKED.includes(field) && String(i[field] ?? '') !== String(value ?? '')){
    if(i.app_id !== open.id){
      await setRowField(EXH_ITEMS, saveExhItem, '금액 항목', id, 'prev_qty', i.qty || '');
      await setRowField(EXH_ITEMS, saveExhItem, '금액 항목', id, 'prev_amount', i.amount || '');
      await setRowField(EXH_ITEMS, saveExhItem, '금액 항목', id, 'app_id', open.id);
      await setRowField(EXH_ITEMS, saveExhItem, '금액 항목', id, 'change_kind', '변경');
    }
  }
  return setRowField(EXH_ITEMS, saveExhItem, '금액 항목', id, field, value, opts);
}
export const setPayField = (id, field, value) =>
  setRowField(EXH_PAYMENTS, saveExhPayment, '입금', id, field, value);

/* 환불은 요청으로 먼저 들어간다 — 이 시점에는 합계를 건드리지 않는다 */
export async function addExhRefund(exhId){
  const amount = val(`rf-a-${exhId}`);
  if(!amount){ alert('환불액을 입력해주세요.'); return; }
  const reason = val(`rf-r-${exhId}`);
  const rfRec = {
    id: localId('XP-'), exhibitor_id: exhId, invoice_id: '',
    paid_at: '', requested_at: val(`rf-d-${exhId}`) || td(),
    amount, currency: val(`rf-cur-${exhId}`) || currencyOf(exhId),
    kind: 'refund', status: 'requested', reason, method: '', note: '',
  };
  const ok = await addRow(EXH_PAYMENTS, rfRec, saveExhPayment);
  if(ok){
    clear(`rf-a-${exhId}`); clear(`rf-r-${exhId}`);
    const x = getExhibitorById(exhId);
    trackAction('status', '환불 요청', x?.company_name || '',
      `<b>${escapeHtml(x?.company_name || '')}</b> 환불 요청 ${escapeHtml(String(amount))}${reason ? ` — ${escapeHtml(reason)}` : ''}`,
      { kind: 'exhibitor', id: x?.id, tab: 'billing',
        table: 'exhibitor_payments', row: rfRec.id, op: 'create', after: rfRec });
  }
}

/* 실제로 보냈으면 완료로 바꾼다. 이때부터 입금 합계에서 빠진다. */
export async function toggleRefundDone(id){
  const p = EXH_PAYMENTS.find(o => o.id === id);
  if(!p) return;
  const wasPending = p.status === 'requested';
  const before = { status: p.status, paid_at: p.paid_at };
  p.status = wasPending ? 'done' : 'requested';
  if(wasPending && !p.paid_at) p.paid_at = td();
  refreshExhViews();
  const res = await saveExhPayment({ id, status: p.status, paid_at: p.paid_at });
  if(!res.ok){
    Object.assign(p, before); refreshExhViews();
    saveFailed(res, '저장에 실패했어요.'); return;
  }
  const x = getExhibitorById(p.exhibitor_id);
  trackAction('status', wasPending ? '환불 완료' : '환불 요청으로 되돌림', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> 환불 ${escapeHtml(String(p.amount || ''))} ${wasPending ? '지급 완료' : '요청 상태로 되돌림'}`,
    { kind: 'exhibitor', id: x?.id, tab: 'billing' });
}

/* 청구에 넣을지 말지 — 추가 배지처럼 주최 측에 따로 내는 항목을 빼둔다.
   지우지 않는 이유는 몇 장을 신청했는지가 현장에서 필요한 정보라서다. */
export async function toggleItemBillable(id){
  const r = EXH_ITEMS.find(o => o.id === id);
  if(!r) return;
  const before = r.billable;
  r.billable = isBillable(r) ? 'no' : '';
  refreshExhViews();
  const res = await saveExhItem({ id, billable: r.billable });
  if(!res.ok){ r.billable = before; refreshExhViews(); saveFailed(res, '저장에 실패했어요.'); return; }
  const x = getExhibitorById(r.exhibitor_id);
  trackAction('edit', '청구 포함 여부 변경', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(r.name || '')} ${r.billable === 'no' ? '청구 제외' : '청구 포함'}`,
    changed('exhibitor_items', id, { billable: before ?? '' }, { billable: r.billable },
      { kind: 'exhibitor', id: x?.id, tab: 'billing', field: 'billable' }));
}

export async function setInvField(id, field, value){
  const v = EXH_INVOICES.find(i => i.id === id);
  if(!v) return;
  const before = v[field];
  v[field] = value;
  refreshExhViews();
  const r = await saveExhInvoice({ id, [field]: value });
  if(!r.ok){ v[field] = before; refreshExhViews(); saveFailed(r, '저장에 실패했어요.'); }
}

export async function addExhPayment(exhId){
  const amount = val(`py-a-${exhId}`);
  if(!amount){ alert('입금액을 입력해주세요.'); return; }
  const invs = invoicesFor(exhId);
  /* 만든 줄을 손에 쥐고 있어야 기록에 «어느 줄을 만들었나»를 적을 수 있다 */
  const rec = {
    id: localId('XP-'), exhibitor_id: exhId, invoice_id: invs[0]?.id || '',
    paid_at: val(`py-d-${exhId}`) || td(), amount, currency: val(`py-cur-${exhId}`) || currencyOf(exhId),
    kind: 'in',
    method: val(`py-m-${exhId}`), note: val(`py-n-${exhId}`),
  };
  const ok = await addRow(EXH_PAYMENTS, rec, saveExhPayment);
  if(ok){
    clear(`py-n-${exhId}`);
    const x = getExhibitorById(exhId);
    trackAction('status', '입금 확인', x?.company_name || '',
      `<b>${escapeHtml(x?.company_name || '')}</b> 입금 ${money(amount)}원 확인`,
      /* 새로 만든 줄은 되돌리는 게 «지우기»다 — 어느 줄인지만 알면 된다 */
      { kind: 'exhibitor', id: x?.id, tab: 'billing',
        table: 'exhibitor_payments', row: rec.id, op: 'create', after: rec });
  }
}
export const delExhPayment = (id) => removeRow(EXH_PAYMENTS, id, deleteExhPayment, '입금 내역');

/* 인보이스 무효 처리 — 통화 변경·금액 오류로 다시 발행할 때 옛 건을 지우지 않고
   합계에서만 뺀다(이력을 남겨야 나중에 왜 두 장인지 설명할 수 있다). */
export async function toggleVoidInvoice(id){
  const v = EXH_INVOICES.find(i => i.id === id);
  if(!v) return;
  const wasVoid = v.status === 'void';
  let note = v.void_note || '';
  if(!wasVoid){
    note = prompt('무효 사유를 적어주세요 (예: EX-55-01 USD → KRW로 대체 발행)', note) ?? null;
    if(note === null) return;   // 취소
  }
  const before = { status: v.status, void_note: v.void_note };
  v.status = wasVoid ? '' : 'void';
  v.void_note = wasVoid ? '' : note;
  refreshExhViews();
  const r = await saveExhInvoice({ id, status: v.status, void_note: v.void_note });
  if(!r.ok){ Object.assign(v, before); refreshExhViews(); saveFailed(r, '저장에 실패했어요.'); return; }
  const x = getExhibitorById(v.exhibitor_id);
  trackAction('edit', wasVoid ? '인보이스 무효 해제' : '인보이스 무효 처리', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(v.title || '')} ${wasVoid ? '되살림' : '무효 처리'}${note ? ` — ${escapeHtml(note)}` : ''}`,
    { kind: 'exhibitor', id: x?.id, tab: 'billing' });
}

/* 세금계산서 — 인보이스와 같은 1:N 패턴(추가/삭제/필드수정/무효처리)에
   더해, 발행 진행 단계(요청→재무팀→완료)가 있어 advance/rewind가 따로 있다. */
export async function addExhTax(exhId){
  const title = val(`tx-t-${exhId}`) || '세금계산서';
  const amount = val(`tx-a-${exhId}`);
  await addRow(EXH_TAX, {
    id: localId('XT-'), exhibitor_id: exhId, title, amount,
    currency: val(`tx-cur-${exhId}`) || currencyOf(exhId),
    stage: '', requested_at: '', to_finance_at: '', sent_at: '', status: '', void_note: '', note: '',
  }, saveExhTax);
  clear(`tx-t-${exhId}`, `tx-a-${exhId}`);
}
export const delExhTax = (id) => removeRow(EXH_TAX, id, deleteExhTax, '세금계산서');

export async function setTaxField(id, field, value){
  const v = EXH_TAX.find(i => i.id === id);
  if(!v) return;
  const before = v[field];
  v[field] = value;
  refreshExhViews();
  const r = await saveExhTax({ id, [field]: value });
  if(!r.ok){ v[field] = before; refreshExhViews(); saveFailed(r, '저장에 실패했어요.'); }
}

export async function toggleVoidTax(id){
  const v = EXH_TAX.find(i => i.id === id);
  if(!v) return;
  const wasVoid = v.status === 'void';
  let note = v.void_note || '';
  if(!wasVoid){
    note = prompt('무효 사유를 적어주세요 (예: 통화 오류로 재발행)', note) ?? null;
    if(note === null) return;   // 취소
  }
  const before = { status: v.status, void_note: v.void_note };
  v.status = wasVoid ? '' : 'void';
  v.void_note = wasVoid ? '' : note;
  refreshExhViews();
  const r = await saveExhTax({ id, status: v.status, void_note: v.void_note });
  if(!r.ok){ Object.assign(v, before); refreshExhViews(); saveFailed(r, '저장에 실패했어요.'); return; }
  const x = getExhibitorById(v.exhibitor_id);
  trackAction('edit', wasVoid ? '세금계산서 무효 해제' : '세금계산서 무효 처리', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(v.title || '')} ${wasVoid ? '되살림' : '무효 처리'}${note ? ` — ${escapeHtml(note)}` : ''}`,
    { kind: 'exhibitor', id: x?.id, tab: 'progress' });
}

/* 다음 단계로. 넘어간 날짜를 함께 찍어 둔다(exh-tab.js의 advanceStage와 같은
   이유) — 어느 단계에 며칠 머물렀는지가 나중에 막힌 곳을 찾는 단서가 된다. */
export async function advanceTaxStage(id){
  const v = EXH_TAX.find(i => i.id === id);
  if(!v) return;
  const st = stageOf(TAX_STAGES, v.stage);
  if(!st.next) return;
  const nx = stageOf(TAX_STAGES, st.next);
  const atField = nx.at;
  const patch = { stage: nx.key };
  if(atField && !String(v[atField] || '').trim()) patch[atField] = td();
  const before = { ...v };
  Object.assign(v, patch);
  refreshExhViews();
  const r = await saveExhTax({ id, ...patch });
  if(!r.ok){ Object.assign(v, before); refreshExhViews(); saveFailed(r, '저장에 실패했어요.'); return; }
  const x = getExhibitorById(v.exhibitor_id);
  trackAction('status', '세금계산서 단계', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(v.title || '세금계산서')} ${escapeHtml(st.label)} → ${escapeHtml(nx.label)}`,
    changed('exhibitor_tax_invoices', id, before, patch, { kind: 'exhibitor', id: x?.id, tab: 'progress' }));
}

/* 잘못 넘겼을 때 되돌린다 — 날짜는 지우지 않는다(exh-tab.js의 rewindStage와 같은 이유,
   실수로 한 번 누른 것만으로 실제 발행일 기록이 사라지면 안 된다). */
export async function rewindTaxStage(id){
  const v = EXH_TAX.find(i => i.id === id);
  if(!v) return;
  const i = TAX_STAGES.findIndex(s => s.key === (v.stage || ''));
  if(i <= 0) return;
  const cur = TAX_STAGES[i], prev = TAX_STAGES[i - 1];
  const before = v.stage;
  v.stage = prev.key;
  refreshExhViews();
  const r = await saveExhTax({ id, stage: prev.key });
  if(!r.ok){ v.stage = before; refreshExhViews(); saveFailed(r, '저장에 실패했어요.'); return; }
  const x = getExhibitorById(v.exhibitor_id);
  trackAction('status', '세금계산서 단계', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(v.title || '세금계산서')} ${escapeHtml(cur.label)} → ${escapeHtml(prev.label)} (되돌림)`,
    changed('exhibitor_tax_invoices', id, before, patch, { kind: 'exhibitor', id: x?.id, tab: 'progress' }));
}

/* 완납 처리 — 송금 수수료 차액처럼 실무상 더 받을 수 없는 잔액을 사유와 함께 닫는다.
   금액을 조작하지 않고 "닫았다"는 사실만 남겨 나중에 근거를 볼 수 있다. */
export async function settleExh(exhId){
  const note = (document.getElementById(`stl-note-${exhId}`)?.value || '').trim();
  if(!note){ alert('완납 처리 사유를 적어주세요. (예: 송금 수수료 8 USD 차감)'); return; }
  const st = settleState(getExhibitorById(exhId));
  if(!confirm(`잔액 ${fmtMoney(st.balance, st.cur)}을(를) 남긴 채 완납으로 닫을까요?
사유: ${note}`)) return;
  await patchExh(exhId, { settled: 'yes', settled_note: note }, '완납 처리');
}
export async function unsettleExh(exhId){
  await patchExh(exhId, { settled: '', settled_note: '' }, '완납 처리 해제');
}

export async function addExhLog(exhId){
  const kind = val(`lg-kind-${exhId}`) || 'inquiry';
  const subject = val(`lg-sub-${exhId}`);
  const body = document.getElementById(`lg-body-${exhId}`)?.value.trim() || '';
  if(!subject && !body){ alert('내용을 입력해주세요.'); return; }
  const ok = await addRow(EXH_LOGS, {
    id: localId('XL-'), exhibitor_id: exhId, kind, ts: td(),
    direction: kind === 'inquiry' ? 'in' : '', channel: val(`lg-ch-${exhId}`),
    counterpart: val(`lg-who-${exhId}`), category: val(`lg-cat-${exhId}`),
    subject, body, answered_at: '', answer: '',
    status: kind === 'inquiry' ? 'open' : 'done',
    author_email: currentUser?.email || '', author_name: currentUser?.name || '',
  }, saveExhLog);
  if(ok){
    clear(`lg-sub-${exhId}`, `lg-who-${exhId}`);
    const el = document.getElementById(`lg-body-${exhId}`);
    if(el) el.value = '';
    const x = getExhibitorById(exhId);
    trackAction('log', kind === 'inquiry' ? '문의 접수' : '기록 추가', x?.company_name || '',
      `<b>${escapeHtml(x?.company_name || '')}</b> ${kind === 'inquiry' ? '문의 접수' : '기록 추가'}: ${escapeHtml(subject || body.slice(0, 30))}`,
      { kind: 'exhibitor', id: x?.id, tab: 'logs' });
  }
}
export const delExhLog = (id) => removeRow(EXH_LOGS, id, deleteExhLog, '문의·기록');

export async function answerExhLog(id){
  const l = EXH_LOGS.find(r => r.id === id);
  if(!l) return;
  const answer = document.getElementById(`ans-${id}`)?.value.trim() || '';
  if(!answer){ alert('답변 내용을 입력해주세요.'); return; }
  const before = { answered_at: l.answered_at, answer: l.answer, status: l.status };
  Object.assign(l, { answered_at: td(), answer, status: 'done' });
  refreshExhViews();
  const r = await saveExhLog({ id, answered_at: l.answered_at, answer, status: 'done' });
  if(!r.ok){ Object.assign(l, before); refreshExhViews(); saveFailed(r, '저장에 실패했어요.'); return; }
  const x = getExhibitorById(l.exhibitor_id);
  trackAction('log', '문의 답변', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> 문의에 답변했어요: ${escapeHtml(l.subject || '')}`,
    { kind: 'exhibitor', id: x?.id, tab: 'logs' });
}

/* ── 기업 담당자 (여러 명) ── */
export const delExhContact = (id) => removeRow(EXH_CONTACTS, id, deleteExhContact, '담당자');

/* 도메인이 다른 이유를 적어 둔다 — 적어 두면 다음부터 안 묻는다 */
export async function noteExhContact(id){
  const r = EXH_CONTACTS.find(c => c.id === id);
  if(!r) return;
  const v = prompt('이 사람이 왜 다른 도메인을 쓰는지 적어 주세요. 예: 대행사 컴비뉴', r.note || '');
  if(v === null) return;
  await setExhContactField(id, 'note', v.trim());
}

export async function setExhContactField(id, field, value){
  const r = EXH_CONTACTS.find(c => c.id === id);
  if(!r) return;
  const before = r[field];
  r[field] = value;
  refreshExhViews();
  const res = await saveExhContact({ id, [field]: value });
  if(!res.ok){ r[field] = before; refreshExhViews(); saveFailed(res, '저장에 실패했어요.'); return; }
  const x = getExhibitorById(r.exhibitor_id);
  const lbl = { name:'이름', email:'이메일', phone:'연락처', role:'역할', note:'메모' }[field] || field;
  trackAction('edit', '기업 담당자 수정', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> 담당자 ${escapeHtml(lbl)} ${escapeHtml(String(before||'(없음)'))} → ${escapeHtml(String(value||'(없음)'))}`,
    changed('exhibitor_contacts', id, { [field]: before ?? '' }, { [field]: value ?? '' },
      { kind: 'exhibitor', id: x?.id, tab: 'contact', field }));
}

/* 메인은 기업당 한 명이라, 새로 지정하면 나머지는 내려준다 */
export async function setPrimaryExhContact(id){
  const target = EXH_CONTACTS.find(c => c.id === id);
  if(!target) return;
  const siblings = contactsFor(target.exhibitor_id);
  const before = siblings.map(c => ({ c, was: c.is_primary }));
  siblings.forEach(c => { c.is_primary = c.id === id ? 'yes' : ''; });
  refreshExhViews();
  const results = await Promise.all(siblings.map(c => saveExhContact({ id: c.id, is_primary: c.is_primary })));
  if(results.some(r => !r.ok)){
    before.forEach(b => { b.c.is_primary = b.was; });
    refreshExhViews();
    alert('메인 담당자 변경에 실패했어요.');
  }
}

/* 참가 취소 토글 — 레코드를 지우지 않고 상태만 바꾼다(문의·정산 기록 보존) */
export async function toggleExhCancel(id){
  const x = getExhibitorById(id);
  if(!x) return;
  const off = x.status === CANCELLED;
  if(!off && !confirm('참가 취소로 처리할까요?\n목록과 집계에서 빠지지만 기록은 그대로 남아요.')) return;
  await patchExh(id, { status: off ? '준비중' : CANCELLED }, off ? '참가 취소 해제' : '참가 취소');
}

export async function holdExhLog(id){
  const l = EXH_LOGS.find(r => r.id === id);
  if(!l) return;
  const next = l.status === 'hold' ? 'open' : 'hold';
  const before = l.status;
  l.status = next;
  refreshExhViews();
  const r = await saveExhLog({ id, status: next });
  if(!r.ok){ l.status = before; refreshExhViews(); saveFailed(r, '저장에 실패했어요.'); }
}

window.toggleItemReceived = toggleItemReceived;
window.addGraphicFeedback = addGraphicFeedback;
window.delGraphicFeedback = delGraphicFeedback;
window.openExhDr = openExhDr;
window.closeExhDr = closeExhDr;
window.switchExhDT = switchExhDT;
window.openNewContact = openNewContact;
window.closeNewContact = closeNewContact;
window.submitNewContact = submitNewContact;
window.assignExhContact = assignExhContact;
window.unassignExhContact = unassignExhContact;
window.drawIntroMeter = drawIntroMeter;
window.renderExhDr = renderExhDr;
window.addExhItem = addExhItem;
window.delExhItem = delExhItem;
window.calcItemAmount = calcItemAmount;
window.addItemFromEquip = addItemFromEquip;
window.addExhInvoice = addExhInvoice;
window.delExhInvoice = delExhInvoice;
window.setInvField = setInvField;
window.setItemField = setItemField;
window.addExhApp = addExhApp;
window.setAppField = setAppField;
window.delExhApp = delExhApp;
window.closeExhApp = closeExhApp;
window.reopenExhApp = reopenExhApp;
window.voidExhItem = voidExhItem;
window.setBoothDesignResult = setBoothDesignResult;
window.addBoothDesignFeedback = addBoothDesignFeedback;
window.setPayField = setPayField;
window.toggleItemBillable = toggleItemBillable;
window.pickCatalogItem = pickCatalogItem;
window.rememberItemCat = rememberItemCat;
window.setItemFieldDirect = setItemFieldDirect;
window.removeExhibitor = removeExhibitor;
window.addItemHere = addItemHere;
window.editItemRow = editItemRow;
window.swapItemList = swapItemList;
window.rememberItemCur = rememberItemCur;
window.addExhRefund = addExhRefund;
window.toggleRefundDone = toggleRefundDone;
window.addExhPayment = addExhPayment;
window.delExhPayment = delExhPayment;
window.addExhLog = addExhLog;
window.delExhLog = delExhLog;
window.answerExhLog = answerExhLog;
window.holdExhLog = holdExhLog;
window.promoteExhContact = promoteExhContact;
window.noteExhContact = noteExhContact;
window.delExhContact = delExhContact;
window.setExhContactField = setExhContactField;
window.setPrimaryExhContact = setPrimaryExhContact;
window.toggleExhCancel = toggleExhCancel;
window.toggleVoidInvoice = toggleVoidInvoice;
window.addExhTax = addExhTax;
window.delExhTax = delExhTax;
window.setTaxField = setTaxField;
window.toggleVoidTax = toggleVoidTax;
window.advanceTaxStage = advanceTaxStage;
window.rewindTaxStage = rewindTaxStage;
window.settleExh = settleExh;
window.unsettleExh = unsettleExh;
