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
  getExhibitorById, itemsFor, invoicesFor, paymentsFor, logsFor, openInquiriesFor,
  EXH_CONTACTS, EXH_ITEMS, EXH_INVOICES, EXH_PAYMENTS, EXH_LOGS, CO_DB, currentUser,
  contactsFor, catalogFor, catalogItem, EQUIP_CATALOG, findCatalogByName,
  contacts, participations, getOrgById, codeList, codeLabel,
} from '../state.js';
import { td, escapeHtml, escAttr } from '../utils.js';
import {
  saveExhContact, saveExhItem, saveExhInvoice, saveExhPayment, saveExhLog,
  deleteExhContact, deleteExhItem, deleteExhInvoice, deleteExhPayment, deleteExhLog,
  saveEquipCatalog,
} from '../api.js';
import { trackAction } from './audit-tab.js';
import {
  billedAmount, paidAmount, graphicState, money, fmtMoney, currencyOf, mixedCurrency, daysSince, CANCELLED,
  isPendingRefund, boothTypeOptions, SELF_BUILD_TYPE, exhNames, isBillable, modalShell,
  TAX_STAGES, GRAPHIC_STAGES, stageOf, stageAge, introLen, bookMissing, introOver,
  patchExh, refreshExhViews, exhContact, exhContacts, contactsForExhibitor, cleanEmail, progressBar,
  settleState, liveInvoices, payDueDate,
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

  const tabsEl = document.getElementById('exh-drtabs');
  if(tabsEl) tabsEl.innerHTML = TABS.map((tb) =>
    `<button class="drtab${drTab === tb.key ? ' on' : ''}" onclick="switchExhDT('${tb.key}')">${tb.label}${
      tb.key === 'logs' && openN ? ` <span class="pill p-amber">${openN}</span>` : ''}${
      tb.key === 'apply' && appNeedsWork ? ' <span class="pill p-amber">확인</span>' : ''}${
      tb.key === 'book' && bookMiss.length ? ` <span class="pill p-amber">${bookMiss.length}</span>` : ''}</button>`).join('');

  const b = document.getElementById('exh-drbd');
  const VIEW = { contact: dContactTab, apply: dApply, progress: dProgress,
    billing: dBilling, graphic: dGraphic, book: dBook, logs: dLogs };
  if(b) b.innerHTML = (VIEW[drTab] || dContactTab)(x);
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

/* ── 렌탈 비품 카탈로그 ──
   비품 이름을 손으로 적으면 같은 의자가 "접이식 체어", "C-040 Folding Chair",
   "폴딩체어"로 제각각 들어와 발주 합계가 갈라지고 단가도 매번 다시 찾아야 한다.
   행사 카탈로그를 골라 넣으면 이름·규격·단가가 한 번에 채워지고, 어떤 품목인지
   id로 이어져 집계가 표기에 흔들리지 않는다.

   자유 입력도 그대로 둔다 — 카탈로그 밖의 품목(그래픽 랩핑, 전기 등)이 실제로
   들어오기 때문에 목록에 없다고 못 적게 하면 안 된다. */
function catalogDatalist(x){
  const list = catalogFor(x.event_id);
  if(!list.length) return '';
  return `<datalist id="eqcat-${escAttr(x.id)}">${list.map(c =>
    `<option value="${escAttr(`${c.code} ${c.name_ko}`)}">${escapeHtml([
      (c.kind || 'equip') === 'graphic' ? '그래픽' : '비품',
      c.name_en, c.spec, c.price_krw && money(c.price_krw) + '원'].filter(Boolean).join(' · '))}</option>`
  ).join('')}</datalist>`;
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
    `<b>${escapeHtml(code)}</b> ${escapeHtml(nm)} — 직접 입력으로 품목마스터에 추가`);
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
  const today = new Date().toISOString().slice(0, 10);
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
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(nameKo || nameEn)} 마스터DB 등록 + 전시 배정`);
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
  const r = EXH_CONTACTS.find(o => o.id === rowId);
  if(!r) return;
  if(r.contact_id){ alert('이미 마스터DB에 연결된 담당자예요.'); return; }

  const nm = String(r.name || '').trim();
  const em = cleanEmail(r.email || '');
  if(!nm && !em){ alert('이름이나 이메일 중 하나는 적어야 마스터DB에 올릴 수 있어요.'); return; }

  const x = getExhibitorById(exhId);
  const org = x?.org_id ? getOrgById(x.org_id) : null;
  const today = new Date().toISOString().slice(0, 10);
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
    alert('마스터DB 저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
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
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(nm || em)} — 전시에만 있던 담당자를 마스터DB로 옮김`);
  try { const { buildCoDB } = await import('./company-tab.js'); buildCoDB(); } catch(e){}
  refreshExhViews();
}

/* 행사 참여 기록 — 전시 담당자로 넣은 사람은 그 행사에 오는 사람이다.

   실패해도 담당자 등록 자체는 되돌리지 않는다. 참여 이력이 빠진 건 나중에
   기업DB에서 채울 수 있지만, 방금 적은 이름·이메일을 통째로 잃는 건 되돌리기가
   어렵다. 대신 무엇이 빠졌는지 로그에 남긴다. */
async function addExhParticipation(contactId, eventId, role){
  if(!eventId) return false;
  const dup = participations.some(p =>
    String(p.contactId) === String(contactId) && p.eventId === eventId);
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
/* ── 담당자 탭 ── */
function dContactTab(x){
  return `${sct('기업 담당자', dContact(x))}`;
}

/* ── 신청항목 탭 ──
   신청서를 받았는지, 받았다면 빠진 게 없는지, 무엇을 더 신청했는지를 한 화면에서
   본다. 신청 내역을 정산의 금액 항목으로 옮기는 버튼도 여기 둔다 — 적어둔 내역과
   실제 청구가 갈라지지 않게. */
function dApply(x){
  const appIssue = x.app_received_at && x.app_complete === 'no';
  const items = itemsFor(x.id).filter(i => (i.category || '') === 'equip');
  return `
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

  ${sct('등록된 비품', items.length
    ? `<div style="display:flex;flex-direction:column;gap:1px">
        ${items.map(i => `<div class="bl-row bl-item" style="padding:6px 8px;background:var(--i9);border-radius:6px">
          <span class="pill p-gray" style="text-align:center">비품</span>
          <span style="min-width:0;font-size:12px;font-weight:600;word-break:break-all">${escapeHtml(i.name || '')}</span>
          <span class="bl-qty" style="font-size:11px;color:var(--i4)">${escapeHtml(i.qty || '')}${i.qty && i.unit_price ? ' × ' : ''}${i.unit_price ? money(i.unit_price) : ''}</span>
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
      <div class="fg"><label class="fl">게재 순서</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.book_order || '')}" placeholder="예: 1"
          onchange="setExhField('${escAttr(x.id)}','book_order',this.value,'도록 순서')"></div>
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
    flagRow(x, 'booth_confirmed', 'booth_confirmed_at', '배정 확정'))}

  ${sct('현장',
    dateRow(x, 'movein_at', '반입 / 설치') +
    builderBlock(x) +
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
══════════════════════════════════════════ */
const itemCats = () => codeList('item_cat', null,
  [['booth', '부스'], ['equip', '비품'], ['graphic', '그래픽'], ['etc', '기타']]
    .map(([c, l]) => ({ code: c, label: l })));
const catLabel = (c) => codeLabel('item_cat', null, c) || '기타';

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
  const items = itemsFor(x.id);
  const invs = invoicesFor(x.id);
  const pays = paymentsFor(x.id);
  // 입금과 환불은 성격이 달라 따로 본다 — 환불은 요청/완료 상태까지 따라간다
  const ins = pays.filter(p => p.kind !== 'refund');
  const refunds = pays.filter(p => p.kind === 'refund');
  const pendingRf = refunds.filter(isPendingRefund);
  const st = settleState(x);
  const billed = st.billed, paid = st.paid, rest = st.balance, cur = st.cur;
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
    ${rest !== 0 && billed > 0 && st.state !== 'settled' ? `
      <div style="margin-top:8px;display:flex;gap:5px;flex-wrap:wrap;align-items:center">
        <input class="fi" id="stl-note-${escAttr(x.id)}" placeholder="완납 처리 사유 (예: 송금 수수료 차감)"
          style="flex:1 1 180px;min-width:0;font-size:11px;padding:5px">
        <button class="btn bs" style="flex:0 0 auto" onclick="settleExh('${escAttr(x.id)}')">완납으로 닫기</button>
      </div>` : ''}
    ${st.state === 'settled' ? `<div style="margin-top:8px;text-align:right">
      <button class="btn bs" onclick="unsettleExh('${escAttr(x.id)}')">완납 처리 해제</button></div>` : ''}
  </div>

  ${sct('금액 항목', `
    <div style="display:flex;flex-direction:column;gap:1px;margin-bottom:8px">
      ${items.length ? itemCats().map(({ code: k, label: l }) => {
        // 분류별로 묶어서 소계를 붙인다 — 부스와 비품이 섞여 있으면 어느 쪽이
        // 얼마인지 세어보기 전엔 알 수 없다. 항목이 없는 분류는 건너뛴다.
        const g = items.filter(i => (i.category || 'etc') === k);
        if(!g.length) return '';
        return g.map(i => `
        <div class="bl-row bl-item" style="padding:6px 8px;background:var(--i9);border-radius:6px">
          <span class="pill ${isBillable(i) ? 'p-gray' : 'p-amber'}" style="text-align:center;cursor:pointer"
            onclick="toggleItemBillable('${escAttr(i.id)}')"
            title="${isBillable(i) ? '클릭하면 청구에서 제외합니다' : '청구에서 빠져 있어요 — 클릭하면 되돌립니다'}">${
            isBillable(i) ? escapeHtml(l) : '제외'}</span>
          <span style="min-width:0;font-size:12px;font-weight:600;word-break:break-all${isBillable(i) ? '' : ';color:var(--i5)'}">${escapeHtml(i.name || '')}</span>
          <span class="bl-qty" style="font-size:11px;color:var(--i4)">${escapeHtml(i.qty || '')}${i.qty && i.unit_price ? ' × ' : ''}${i.unit_price ? money(i.unit_price) : ''}</span>
          <input class="fi bl-amt-in" value="${escAttr(i.amount || '')}" placeholder="금액"
            onchange="setItemField('${escAttr(i.id)}','amount',this.value)">
          ${curSelect(i.currency, `setItemField('${escAttr(i.id)}','currency',this.value)`)}
          <button class="btn bs" onclick="delExhItem('${escAttr(i.id)}')" title="삭제">✕</button>
        </div>`).join('')
        + `<div class="bl-row bl-item bl-subtotal">
            <span></span>
            <span style="min-width:0;font-size:11px;color:var(--i4)">${escapeHtml(l)} 소계 <span style="color:var(--i5)">${g.length}건</span></span>
            <span class="bl-qty"></span>
            <span class="bl-amt" style="font-size:12px">${sumText(sumByCurrency(g))}</span>
            <span></span><span></span>
          </div>`;
      }).join('') : '<div style="font-size:11.5px;color:var(--i5);padding:8px 2px">아직 항목이 없어요</div>'}
      ${items.length ? `<div class="bl-row bl-item bl-total">
        <span></span>
        <span style="min-width:0;font-size:12px;font-weight:700">총계 <span style="font-weight:400;color:var(--i4)">${items.length}건</span></span>
        <span class="bl-qty"></span>
        <span class="bl-amt" style="font-size:13px">${sumText(sumByCurrency(items))}</span>
        <span></span><span></span>
      </div>
      ${(() => {
        const ex = excludedSum(items);
        const ks = Object.keys(ex).filter(k => ex[k]);
        return ks.length ? `<div style="font-size:10.5px;color:var(--i4);padding:4px 8px 0;text-align:right">
          청구 제외 ${ks.map(k => fmtMoney(ex[k], k)).join(' + ')}
          <span style="color:var(--i5)">— 추가 배지처럼 우리가 청구하지 않는 항목이에요</span></div>` : '';
      })()}` : ''}
    </div>
    <div class="bl-row bl-item-add">
      <select class="fi" id="it-cat-${escAttr(x.id)}" style="flex:0 0 72px;min-width:0;font-size:11.5px;padding:6px"
        onchange="rememberItemCat(this.value)">
        ${itemCats().map(({ code: k, label: l }, i) => `<option value="${escAttr(k)}"${(lastItemCat || itemCats()[0]?.code) === k ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
      <input class="fi" id="it-nm-${escAttr(x.id)}" placeholder="항목명" style="flex:1 1 120px;min-width:0;font-size:11.5px;padding:6px"
        list="eqcat-${escAttr(x.id)}" oninput="pickCatalogItem('${escAttr(x.id)}')">
      ${catalogDatalist(x)}
      <input class="fi" id="it-qty-${escAttr(x.id)}" placeholder="수량" style="flex:1 1 54px;min-width:0;font-size:11.5px;padding:6px"
        oninput="calcItemAmount('${escAttr(x.id)}')">
      <input class="fi" id="it-up-${escAttr(x.id)}" placeholder="단가" style="flex:1 1 78px;min-width:0;font-size:11.5px;padding:6px"
        oninput="calcItemAmount('${escAttr(x.id)}')">
      <input class="fi" id="it-amt-${escAttr(x.id)}" placeholder="금액" style="flex:1 1 88px;min-width:0;font-size:11.5px;padding:6px;text-align:right">
      <select class="fi bl-cur" id="it-cur-${escAttr(x.id)}" onchange="rememberItemCur(this.value)">
        ${currencies().map(c => `<option value="${c}"${(lastItemCur || currencyOf(x.id)) === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <button class="btn bp bs" style="flex:0 0 auto" onclick="addExhItem('${escAttr(x.id)}')">추가</button>
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
      금액 항목 합계가 기본값으로 들어가요. 부스+비품 따로, 그래픽 따로 나눠 발행해도 됩니다.</div>`)}

  ${sct('세금계산서',
    stageBar(x, 'tax_stage', TAX_STAGES, '재무팀') +
    dateRow(x, 'tax_sent_at', '발행 완료일') +
    `<div class="fgr bl-tax" style="margin-top:8px">
      <div class="fg"><label class="fl">금액</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.tax_amount || '')}"
          onchange="setExhField('${escAttr(x.id)}','tax_amount',this.value,'세금계산서 금액')"></div>
      <div class="fg"><label class="fl">담당자</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.tax_contact_name || '')}"
          onchange="setExhField('${escAttr(x.id)}','tax_contact_name',this.value,'세금계산서 담당자')"></div>
    </div>
    <div class="fgr bl-tax">
      <div class="fg"><label class="fl">이메일</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.tax_contact_email || '')}"
          onchange="setExhField('${escAttr(x.id)}','tax_contact_email',this.value,'세금계산서 담당자')"></div>
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
    `<b>${escapeHtml(x?.company_name || '')}</b> 그래픽 피드백(${escapeHtml(cur.label || '')}): ${escapeHtml(body.slice(0, 40))}`);
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
function graphicItemsBlock(x){
  const gi = itemsFor(x.id).filter(i => i.category === 'graphic');
  if(!gi.length){
    return `<div style="font-size:11.5px;color:var(--i5);margin-bottom:8px">등록된 그래픽 항목이 없어요</div>
      <div style="font-size:11px;color:var(--i4);margin-bottom:8px">
        정산 탭에서 <b>그래픽</b> 분류로 항목을 추가하면 여기 나옵니다.</div>
      <button class="btn bs" onclick="switchExhDT('billing')">정산 탭으로 이동</button>`;
  }

  const total = gi.reduce((s, i) => s + Number(String(i.amount || '').replace(/[^0-9.-]/g, '') || 0), 0);
  const got = gi.filter(i => i.received_at).length;

  return `<div style="font-size:11px;color:var(--i4);margin-bottom:8px">
      주문한 항목은 정산 탭의 <b>그래픽</b> 분류에서 가져옵니다. 여기서는 <b>무엇을 받았는지</b>만 표시해요.</div>

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
              i.amount ? ` · ${escapeHtml(fmtMoney(i.amount, i.currency))}` : ''}</span>
          </span>
          <input type="date" class="fi" style="width:136px;padding:4px 8px;font-size:11.5px"
            value="${escAttr(i.received_at || '')}"
            onchange="setItemField('${escAttr(i.id)}','received_at',this.value)">
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
      <span style="color:var(--i4)">${gi.length}건 · 받음 ${got}건${got < gi.length ? ` · <b style="color:var(--am)">미수령 ${gi.length - got}건</b>` : ''}</span>
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
  const ordered = !!x.graphic_ordered_at;
  const g = graphicState(x);
  const invs = invoicesFor(x.id);

  if(!ordered){
    return `<div style="text-align:center;padding:40px 20px">
      <div style="font-size:28px;margin-bottom:8px">🎨</div>
      <div style="font-size:13px;font-weight:600;margin-bottom:4px">그래픽 주문 없음</div>
      <div style="font-size:11.5px;color:var(--i4);margin-bottom:16px">추가로 그래픽을 주문하면 여기서 관리해요</div>
      <button class="btn bp" onclick="toggleExhDate('${escAttr(x.id)}','graphic_ordered_at','그래픽 주문')">그래픽 주문 등록</button>
    </div>`;
  }

  return `
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

  ${sct('그래픽 항목', graphicItemsBlock(x), (() => {
    const gi = itemsFor(x.id).filter(i => i.category === 'graphic');
    if(!gi.length) return '';
    const got = gi.filter(i => i.received_at).length;
    return `<span class="pill ${got === gi.length ? 'p-green' : got ? 'p-amber' : 'p-gray'}">받음 ${got}/${gi.length}</span>`;
  })())}
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
    alert('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    return false;
  }
  if(r.id && r.id !== rec.id) rec.id = r.id; // 서버가 만든 id로 맞춘다
  return true;
}

async function removeRow(arr, id, deleteFn){
  const i = arr.findIndex(r => r.id === id);
  if(i < 0) return;
  const [removed] = arr.splice(i, 1);
  refreshExhViews();
  const r = await deleteFn(id);
  if(!r.ok){
    arr.splice(i, 0, removed);
    refreshExhViews();
    alert('삭제에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
  }
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

  await addRow(EXH_ITEMS, {
    id: localId('XI-'), exhibitor_id: exhId, category,
    catalog_id: catalogId,
    name, qty: val(`it-qty-${exhId}`), unit_price: val(`it-up-${exhId}`), amount,
    currency, note: '',
    sort_order: String(itemsFor(exhId).length + 1),
  }, saveExhItem);
  clear(`it-nm-${exhId}`, `it-qty-${exhId}`, `it-up-${exhId}`, `it-amt-${exhId}`);
  // 지난 선택이 남아 있으면 다음에 손으로 적은 항목에 엉뚱한 품목이 붙는다
  const nmEl = document.getElementById(`it-nm-${exhId}`);
  if(nmEl) delete nmEl.dataset.catalogId;
}
export const delExhItem = (id) => removeRow(EXH_ITEMS, id, deleteExhItem);

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
export const delExhInvoice = (id) => removeRow(EXH_INVOICES, id, deleteExhInvoice);

/* 금액·통화를 줄에서 바로 고친다. 기록에도 무엇이 어떻게 바뀌었는지 남긴다 —
   금액은 나중에 "왜 이 숫자가 됐지"를 되짚어야 할 일이 가장 많은 값이다. */
async function setRowField(list, saver, label, id, field, value){
  const r = list.find(o => o.id === id);
  if(!r) return;
  const before = r[field];
  r[field] = value;
  refreshExhViews();
  const res = await saver({ id, [field]: value });
  if(!res.ok){ r[field] = before; refreshExhViews(); alert('저장에 실패했어요.'); return; }
  const x = getExhibitorById(r.exhibitor_id);
  const fl = { amount: '금액', currency: '통화',
    received_at: '받은 날', received_note: '받은 것',
    method: '결제 수단', note: '비고', paid_at: '입금일' }[field] || field;
  trackAction('edit', label + ' 수정', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(r.name || r.title || label)} ${escapeHtml(fl)} ${escapeHtml(String(before || '(없음)'))} → ${escapeHtml(String(value || '(없음)'))}`);
}

export const setItemField = (id, field, value) =>
  setRowField(EXH_ITEMS, saveExhItem, '금액 항목', id, field, value);
export const setPayField = (id, field, value) =>
  setRowField(EXH_PAYMENTS, saveExhPayment, '입금', id, field, value);

/* 환불은 요청으로 먼저 들어간다 — 이 시점에는 합계를 건드리지 않는다 */
export async function addExhRefund(exhId){
  const amount = val(`rf-a-${exhId}`);
  if(!amount){ alert('환불액을 입력해주세요.'); return; }
  const reason = val(`rf-r-${exhId}`);
  const ok = await addRow(EXH_PAYMENTS, {
    id: localId('XP-'), exhibitor_id: exhId, invoice_id: '',
    paid_at: '', requested_at: val(`rf-d-${exhId}`) || td(),
    amount, currency: val(`rf-cur-${exhId}`) || currencyOf(exhId),
    kind: 'refund', status: 'requested', reason, method: '', note: '',
  }, saveExhPayment);
  if(ok){
    clear(`rf-a-${exhId}`); clear(`rf-r-${exhId}`);
    const x = getExhibitorById(exhId);
    trackAction('status', '환불 요청', x?.company_name || '',
      `<b>${escapeHtml(x?.company_name || '')}</b> 환불 요청 ${escapeHtml(String(amount))}${reason ? ` — ${escapeHtml(reason)}` : ''}`);
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
    alert('저장에 실패했어요.'); return;
  }
  const x = getExhibitorById(p.exhibitor_id);
  trackAction('status', wasPending ? '환불 완료' : '환불 요청으로 되돌림', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> 환불 ${escapeHtml(String(p.amount || ''))} ${wasPending ? '지급 완료' : '요청 상태로 되돌림'}`);
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
  if(!res.ok){ r.billable = before; refreshExhViews(); alert('저장에 실패했어요.'); return; }
  const x = getExhibitorById(r.exhibitor_id);
  trackAction('edit', '청구 포함 여부 변경', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(r.name || '')} ${r.billable === 'no' ? '청구 제외' : '청구 포함'}`);
}

export async function setInvField(id, field, value){
  const v = EXH_INVOICES.find(i => i.id === id);
  if(!v) return;
  const before = v[field];
  v[field] = value;
  refreshExhViews();
  const r = await saveExhInvoice({ id, [field]: value });
  if(!r.ok){ v[field] = before; refreshExhViews(); alert('저장에 실패했어요.'); }
}

export async function addExhPayment(exhId){
  const amount = val(`py-a-${exhId}`);
  if(!amount){ alert('입금액을 입력해주세요.'); return; }
  const invs = invoicesFor(exhId);
  const ok = await addRow(EXH_PAYMENTS, {
    id: localId('XP-'), exhibitor_id: exhId, invoice_id: invs[0]?.id || '',
    paid_at: val(`py-d-${exhId}`) || td(), amount, currency: val(`py-cur-${exhId}`) || currencyOf(exhId),
    kind: 'in',
    method: val(`py-m-${exhId}`), note: val(`py-n-${exhId}`),
  }, saveExhPayment);
  if(ok){
    clear(`py-n-${exhId}`);
    const x = getExhibitorById(exhId);
    trackAction('status', '입금 확인', x?.company_name || '',
      `<b>${escapeHtml(x?.company_name || '')}</b> 입금 ${money(amount)}원 확인`);
  }
}
export const delExhPayment = (id) => removeRow(EXH_PAYMENTS, id, deleteExhPayment);

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
  if(!r.ok){ Object.assign(v, before); refreshExhViews(); alert('저장에 실패했어요.'); return; }
  const x = getExhibitorById(v.exhibitor_id);
  trackAction('edit', wasVoid ? '인보이스 무효 해제' : '인보이스 무효 처리', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(v.title || '')} ${wasVoid ? '되살림' : '무효 처리'}${note ? ` — ${escapeHtml(note)}` : ''}`);
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
      `<b>${escapeHtml(x?.company_name || '')}</b> ${kind === 'inquiry' ? '문의 접수' : '기록 추가'}: ${escapeHtml(subject || body.slice(0, 30))}`);
  }
}
export const delExhLog = (id) => removeRow(EXH_LOGS, id, deleteExhLog);

export async function answerExhLog(id){
  const l = EXH_LOGS.find(r => r.id === id);
  if(!l) return;
  const answer = document.getElementById(`ans-${id}`)?.value.trim() || '';
  if(!answer){ alert('답변 내용을 입력해주세요.'); return; }
  const before = { answered_at: l.answered_at, answer: l.answer, status: l.status };
  Object.assign(l, { answered_at: td(), answer, status: 'done' });
  refreshExhViews();
  const r = await saveExhLog({ id, answered_at: l.answered_at, answer, status: 'done' });
  if(!r.ok){ Object.assign(l, before); refreshExhViews(); alert('저장에 실패했어요.'); return; }
  const x = getExhibitorById(l.exhibitor_id);
  trackAction('log', '문의 답변', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> 문의에 답변했어요: ${escapeHtml(l.subject || '')}`);
}

/* ── 기업 담당자 (여러 명) ── */
export const delExhContact = (id) => removeRow(EXH_CONTACTS, id, deleteExhContact);

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
  if(!res.ok){ r[field] = before; refreshExhViews(); alert('저장에 실패했어요.'); return; }
  const x = getExhibitorById(r.exhibitor_id);
  const lbl = { name:'이름', email:'이메일', phone:'연락처', role:'역할', note:'메모' }[field] || field;
  trackAction('edit', '기업 담당자 수정', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> 담당자 ${escapeHtml(lbl)} ${escapeHtml(String(before||'(없음)'))} → ${escapeHtml(String(value||'(없음)'))}`);
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
  if(!r.ok){ l.status = before; refreshExhViews(); alert('저장에 실패했어요.'); }
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
window.setPayField = setPayField;
window.toggleItemBillable = toggleItemBillable;
window.pickCatalogItem = pickCatalogItem;
window.rememberItemCat = rememberItemCat;
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
window.settleExh = settleExh;
window.unsettleExh = unsettleExh;
