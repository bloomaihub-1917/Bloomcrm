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
  contactsFor,
} from '../state.js';
import { td, escapeHtml, escAttr } from '../utils.js';
import {
  saveExhContact, saveExhItem, saveExhInvoice, saveExhPayment, saveExhLog,
  deleteExhContact, deleteExhItem, deleteExhInvoice, deleteExhPayment, deleteExhLog,
} from '../api.js';
import { trackAction } from './audit-tab.js';
import {
  billedAmount, paidAmount, graphicState, money, fmtMoney, currencyOf, mixedCurrency, daysSince, CANCELLED,
  patchExh, refreshExhViews, exhContact, exhContacts, contactsForExhibitor, cleanEmail, progressBar,
  settleState, liveInvoices, payDueDate,
} from './exh-tab.js';

let drId = null;
let drTab = 0;

const TABS = ['진행', '정산', '그래픽', '문의·기록'];

export function openExhDr(id, tab){
  drId = id;
  if(tab !== undefined) drTab = tab;
  document.getElementById('exh-dr')?.classList.add('on');
  document.getElementById('exh-bd')?.classList.add('on');
  renderExhDr();
}
export function closeExhDr(){
  drId = null;
  document.getElementById('exh-dr')?.classList.remove('on');
  document.getElementById('exh-bd')?.classList.remove('on');
}
export function switchExhDT(i){ drTab = i; renderExhDr(); }

export function renderExhDr(){
  if(!drId) return;
  const x = getExhibitorById(drId);
  if(!x){ closeExhDr(); return; }

  const openN = openInquiriesFor(x.id).length;
  const billed = billedAmount(x.id), paid = paidAmount(x.id);

  const h = document.getElementById('exh-drh');
  if(h) h.innerHTML = `
    <div style="flex:1;min-width:0">
      <div class="drnm" style="${x.status === CANCELLED ? 'text-decoration:line-through;opacity:.65' : ''}">${escapeHtml(x.company_name || '')}${
        x.status === CANCELLED ? ' <span class="pill p-gray" style="vertical-align:middle">참가 취소</span>' : ''}</div>
      <div class="drmt">${x.booth_no ? `부스 ${escapeHtml(x.booth_no)}${x.booth_floor ? `(${escapeHtml(x.booth_floor)}층)` : ''}` : ''}${
        (() => { const p = exhContact(x); return (p.name || p.email) ? ` · 담당자 ${escapeHtml(p.name || p.email)}` : ''; })()
        }${billed ? ` · 입금 ${money(paid)}/${money(billed)}` : ''}</div>
    </div>
    <button class="drcls" onclick="closeExhDr()">✕</button>`;

  const t = document.getElementById('exh-drtabs');
  if(t) t.innerHTML = TABS.map((label, i) =>
    `<button class="drtab${drTab === i ? ' on' : ''}" onclick="switchExhDT(${i})">${label}${i === 3 && openN ? ` <span class="pill p-amber">${openN}</span>` : ''}</button>`).join('');

  const b = document.getElementById('exh-drbd');
  if(b) b.innerHTML = [dProgress, dBilling, dGraphic, dLogs][drTab](x);
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
const C_ROLES = ['실무', '정산', '현장', '기타'];
const BOOTH_TYPES = ['Self-Construction', 'Block System A', 'Block System B', 'Block System C',
  'Lighting Booth', 'Octanium (Standard)'];
const GRADES = ['', 'DIA', 'GOLD', 'SILVER', 'BRONZE', 'Exhibitor'];

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
        ${p.primary ? '<span class="pill p-blue">대표</span>' : ''}
        <select class="fi" style="width:74px;padding:2px 5px;font-size:10.5px;margin-left:auto"
          onchange="setExhContactField('${escAttr(r.id)}','role',this.value)">
          ${C_ROLES.map(v => `<option${(r.role || '기타') === v ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
      </div>
      <div style="font-size:11.5px;color:var(--i3);display:flex;flex-direction:column;gap:2px">
        ${p.email ? `<div>✉ <a href="mailto:${escAttr(p.email)}" style="color:var(--a)">${escapeHtml(p.email)}</a></div>` : ''}
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
      <div style="display:flex;gap:5px;margin-top:7px;align-items:center">
        <span style="font-size:10px;color:${p.linked ? 'var(--a)' : 'var(--i5)'}">${p.linked ? '마스터DB 연결됨' : '직접 입력'}</span>
        ${!p.primary ? `<button class="btn bs" style="margin-left:auto;font-size:10px" onclick="setPrimaryExhContact('${escAttr(r.id)}')">대표로</button>` : '<span style="margin-left:auto"></span>'}
        <button class="btn bs" style="font-size:10px;opacity:.6" onclick="delExhContact('${escAttr(r.id)}')">삭제</button>
      </div>
    </div>`;
  };

  return `
  <div style="font-size:11px;color:var(--i5);margin-bottom:8px">
    우리가 실제로 연락하는 기업측 담당자예요. 실무·정산·현장이 다르면 여러 명 등록할 수 있어요.</div>

  ${list.length ? list.map(card).join('') : '<div style="font-size:11.5px;color:var(--i5);padding:6px 2px;margin-bottom:6px">등록된 담당자가 없어요</div>'}

  <div style="display:flex;gap:5px;align-items:center;margin-top:8px">
    <select class="fi" id="exc-pick-${escAttr(x.id)}" style="flex:1;font-size:11.5px;padding:6px">
      <option value="">— 마스터DB에서 고르기 —</option>
      ${free.map(c => `<option value="${escAttr(String(c.id))}">${escapeHtml((c.nameKo || c.nameEn || '이름 없음')
        + (c.titleKo ? ` · ${c.titleKo}` : '') + (c.email1 ? ` · ${cleanEmail(c.email1)}` : ''))}</option>`).join('')}
    </select>
    <button class="btn bp bs" onclick="addExhContact('${escAttr(x.id)}')">추가</button>
    <button class="btn bs" onclick="addExhContact('${escAttr(x.id)}',true)" title="마스터DB에 없는 사람">직접 입력</button>
  </div>
  ${!free.length && cands.length ? '<div style="font-size:10.5px;color:var(--i5);margin-top:4px">이 기업의 마스터DB 연락처는 모두 등록했어요</div>' : ''}
  ${!cands.length ? '<div style="font-size:10.5px;color:var(--am);margin-top:4px">이 기업 연락처가 마스터DB에 없어요 — "직접 입력"으로 추가하세요</div>' : ''}`;
}

/* ══════════════════════════════════════════
   1) 진행 — 매뉴얼 / 신청서 / 부스 / 도록 / 현장
══════════════════════════════════════════ */
function dProgress(x){
  const appIssue = x.app_received_at && x.app_complete === 'no';
  return `
  ${sct('기업 담당자', dContact(x))}

  ${sct('매뉴얼', dateRow(x, 'manual_sent_at', '매뉴얼 발송') + dateRow(x, 'manual_replied_at', '매뉴얼 회신'))}

  ${sct('신청서',
    flagRow(x, 'app_received', 'app_received_at', '신청서 수신') +
    `<div style="padding:10px 0 2px">
      <label class="fl">필수정보 완비 여부</label>
      <div class="stbs" style="margin:4px 0 8px">
        ${[['', '미확인'], ['yes', '완비'], ['no', '누락 있음']].map(([v, l]) =>
          `<button class="stb${(x.app_complete || '') === v ? ' on' : ''}" onclick="setExhField('${escAttr(x.id)}','app_complete','${v}','신청서 정보 확인')">${l}</button>`).join('')}
      </div>
      ${x.app_complete === 'no' ? textRow(x, 'app_missing', '누락 항목 — 무엇이 비었나요', '예: 사업자등록증, 로고 파일') : ''}
      ${textRow(x, 'extra_equipment', '추가 비품 신청 내역', '예: 추가 테이블 2, 전기 3kW', true)}
      <button class="btn bs" onclick="addItemFromEquip('${escAttr(x.id)}')" style="margin-top:2px">이 내역을 비품 금액 항목으로 추가</button>
    </div>`,
    appIssue ? '<span class="pill p-amber">정보 누락</span>' : '')}

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
        <input class="fi" style="font-size:12px" list="booth-types" value="${escAttr(x.booth_type || '')}"
          onchange="setExhField('${escAttr(x.id)}','booth_type',this.value,'부스 타입')">
        <datalist id="booth-types">${BOOTH_TYPES.map(t => `<option value="${escAttr(t)}">`).join('')}</datalist></div>
      <div class="fg"><label class="fl">수량</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.booth_qty || '')}"
          onchange="setExhField('${escAttr(x.id)}','booth_qty',this.value,'부스 수량')"></div>
    </div>
    <div class="fg"><label class="fl">스폰서 등급</label>
      <select class="fi" style="font-size:12px" onchange="setExhField('${escAttr(x.id)}','grade',this.value,'등급')">
        ${GRADES.map(g => `<option value="${escAttr(g)}"${(x.grade || '') === g ? ' selected' : ''}>${g || '— 없음 —'}</option>`).join('')}
      </select></div>` +
    flagRow(x, 'booth_confirmed', 'booth_confirmed_at', '배정 확정'))}

  ${sct('도록 / 디렉토리',
    flagRow(x, 'directory_received', 'directory_received_at', '자료 수신', '회사소개·로고·제품정보') +
    textRow(x, 'directory_note', '메모', '받은 자료나 누락 항목', true))}

  ${sct('현장',
    dateRow(x, 'movein_at', '반입 / 설치') +
    textRow(x, 'builder', '설치업체', '') +
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
const CATS = [['booth', '부스'], ['equip', '비품'], ['graphic', '그래픽'], ['etc', '기타']];
const catLabel = (c) => (CATS.find(([k]) => k === c) || [null, '기타'])[1];

function dBilling(x){
  const items = itemsFor(x.id);
  const invs = invoicesFor(x.id);
  const pays = paymentsFor(x.id);
  const st = settleState(x);
  const billed = st.billed, paid = st.paid, rest = st.balance, cur = st.cur;
  const noAmount = invoicesFor(x.id).filter(i => i.status !== 'void' && String(i.amount ?? '').trim() === '');

  const subtotals = CATS.map(([k, l]) => ({ l, n: items.filter(i => i.category === k).reduce((s, i) => s + Number(String(i.amount || '').replace(/[^0-9.-]/g, '') || 0), 0) })).filter(s => s.n);

  return `
  <div class="uc" style="margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <span style="font-size:11px;color:var(--i4)">청구 / 입금</span>
      <span><b style="font-size:16px;color:${paid >= billed && billed > 0 ? 'var(--g)' : 'var(--i1)'}">${cur === 'USD' ? '$' : ''}${money(paid)}</b>
        <span style="color:var(--i5);font-size:13px"> / ${money(billed)}${cur === 'USD' ? '' : '원'}</span></span>
    </div>
    <div style="margin:8px 0 4px">${progressBar(billed ? paid / billed * 100 : 0,
      paid >= billed && billed > 0 ? 'var(--g)' : 'var(--am)')}</div>
    ${mixedCurrency(x.id) ? `<div style="font-size:11px;color:var(--re);background:var(--rb);padding:6px 8px;border-radius:6px;margin:6px 0">
      ⚠ 인보이스·입금에 <b>${mixedCurrency(x.id).join(' / ')}</b>가 섞여 있어요.
      위 합계는 <b>${currencyOf(x.id)}</b> 건만 더한 값이라 정확하지 않습니다 —
      아래 목록에서 통화를 하나로 맞춰주세요.</div>` : ''}
    <div style="font-size:11px;color:${
      st.state === 'over' ? 'var(--re)' : (rest > 0 ? 'var(--am)' : 'var(--i4)')}">
      ${st.state === 'settled' ? `완납 처리됨${x.settled_note ? ` — ${escapeHtml(x.settled_note)}` : ''}`
        : billed === 0 ? '금액 항목을 추가하거나 인보이스를 발행해주세요'
        : st.state === 'over' ? `초과 입금 ${fmtMoney(-rest, cur)} — 누락된 인보이스가 없는지 확인해주세요`
        : rest > 0 ? `잔액 ${fmtMoney(rest, cur)}` : '완납'}
      ${subtotals.length ? ` · ${subtotals.map(s => `${s.l} ${money(s.n)}`).join(' / ')}` : ''}</div>
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
      ${items.length ? items.map(i => `
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:7px;padding:6px 8px;background:var(--i9);border-radius:6px">
          <span class="pill p-gray" style="min-width:44px;text-align:center">${escapeHtml(catLabel(i.category))}</span>
          <span style="flex:1 1 100px;min-width:0;font-size:12px;font-weight:600;word-break:break-all">${escapeHtml(i.name || '')}</span>
          <span style="font-size:11px;color:var(--i4)">${escapeHtml(i.qty || '')}${i.qty && i.unit_price ? ' × ' : ''}${i.unit_price ? money(i.unit_price) : ''}</span>
          <span style="font-size:12px;font-weight:700;min-width:88px;text-align:right">${fmtMoney(i.amount, i.currency || 'KRW')}</span>
          <button class="btn bs" onclick="delExhItem('${escAttr(i.id)}')" title="삭제">✕</button>
        </div>`).join('') : '<div style="font-size:11.5px;color:var(--i5);padding:8px 2px">아직 항목이 없어요</div>'}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px;align-items:center">
      <select class="fi" id="it-cat-${escAttr(x.id)}" style="flex:0 0 72px;min-width:0;font-size:11.5px;padding:6px">
        ${CATS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <input class="fi" id="it-nm-${escAttr(x.id)}" placeholder="항목명" style="flex:1 1 120px;min-width:0;font-size:11.5px;padding:6px">
      <input class="fi" id="it-qty-${escAttr(x.id)}" placeholder="수량" style="flex:1 1 54px;min-width:0;font-size:11.5px;padding:6px"
        oninput="calcItemAmount('${escAttr(x.id)}')">
      <input class="fi" id="it-up-${escAttr(x.id)}" placeholder="단가" style="flex:1 1 78px;min-width:0;font-size:11.5px;padding:6px"
        oninput="calcItemAmount('${escAttr(x.id)}')">
      <input class="fi" id="it-amt-${escAttr(x.id)}" placeholder="금액" style="flex:1 1 88px;min-width:0;font-size:11.5px;padding:6px">
      <button class="btn bp bs" style="flex:0 0 auto" onclick="addExhItem('${escAttr(x.id)}')">추가</button>
    </div>`)}

  ${sct('인보이스', `
    <div style="display:flex;flex-direction:column;gap:5px;margin-bottom:8px">
      ${invs.length ? invs.map(v => `
        <div style="padding:8px 10px;background:var(--i9);border-radius:7px${v.status === 'void' ? ';opacity:.55' : ''}">
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
            <span style="flex:1 1 120px;min-width:0;font-size:12px;font-weight:700${v.status === 'void' ? ';text-decoration:line-through' : ''}">${escapeHtml(v.title || '인보이스')}</span>
            ${v.status === 'void' ? '<span class="pill p-gray">무효</span>' : ''}
            <span style="font-size:12px;font-weight:700">${String(v.amount ?? '').trim() ? fmtMoney(v.amount, v.currency || 'KRW') : '<span style="color:var(--am);font-size:11px">금액 미입력</span>'}</span>
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
    <div style="display:flex;flex-wrap:wrap;gap:5px">
      <input class="fi" id="iv-t-${escAttr(x.id)}" placeholder="제목 (예: 부스+비품)" style="flex:1 1 140px;min-width:0;font-size:11.5px;padding:6px">
      <input class="fi" id="iv-a-${escAttr(x.id)}" placeholder="금액" style="flex:1 1 96px;min-width:0;font-size:11.5px;padding:6px"
        value="${items.length && !invs.length ? billedAmount(x.id) : ''}">
      <button class="btn bp bs" style="flex:0 0 auto" onclick="addExhInvoice('${escAttr(x.id)}')">발행</button>
    </div>
    <div style="font-size:10.5px;color:var(--i5);margin-top:5px">
      금액 항목 합계가 기본값으로 들어가요. 부스+비품 따로, 그래픽 따로 나눠 발행해도 됩니다.</div>`)}

  ${sct('세금계산서',
    dateRow(x, 'tax_sent_at', '세금계산서 발송') +
    `<div class="fgr" style="margin-top:8px">
      <div class="fg"><label class="fl">금액</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.tax_amount || '')}"
          onchange="setExhField('${escAttr(x.id)}','tax_amount',this.value,'세금계산서 금액')"></div>
      <div class="fg"><label class="fl">담당자</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.tax_contact_name || '')}"
          onchange="setExhField('${escAttr(x.id)}','tax_contact_name',this.value,'세금계산서 담당자')"></div>
    </div>
    <div class="fgr">
      <div class="fg"><label class="fl">이메일</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.tax_contact_email || '')}"
          onchange="setExhField('${escAttr(x.id)}','tax_contact_email',this.value,'세금계산서 담당자')"></div>
      <div class="fg"><label class="fl">연락처</label>
        <input class="fi" style="font-size:12px" value="${escAttr(x.tax_contact_phone || '')}"
          onchange="setExhField('${escAttr(x.id)}','tax_contact_phone',this.value,'세금계산서 담당자')"></div>
    </div>`)}

  ${sct('입금 내역', `
    <div style="display:flex;flex-direction:column;gap:1px;margin-bottom:8px">
      ${pays.length ? pays.map((p, i) => `
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 8px;background:var(--i9);border-radius:6px">
          <span class="pill ${p.kind === 'refund' ? 'p-red' : 'p-green'}">${p.kind === 'refund' ? '환불' : (pays.filter(q=>q.kind!=='refund').length > 1 ? `${i + 1}차` : '입금')}</span>
          <span style="font-size:11.5px;color:var(--i3)">${escapeHtml(p.paid_at || '')}</span>
          <span style="flex:1;font-size:11px;color:var(--i4)">${escapeHtml(p.method || '')}${p.note ? ' · ' + escapeHtml(p.note) : ''}</span>
          <span style="font-size:12px;font-weight:700;color:${p.kind === 'refund' ? 'var(--re)' : 'inherit'}">${p.kind === 'refund' ? '−' : ''}${fmtMoney(p.amount, p.currency || 'KRW')}</span>
          <button class="btn bs" onclick="delExhPayment('${escAttr(p.id)}')">✕</button>
        </div>`).join('') : '<div style="font-size:11.5px;color:var(--i5);padding:8px 2px">입금 내역이 없어요</div>'}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:5px">
      <select class="fi" id="py-k-${escAttr(x.id)}" style="flex:0 0 72px;min-width:0;font-size:11.5px;padding:6px">
        <option value="in">입금</option><option value="refund">환불</option></select>
      <input type="date" class="fi" id="py-d-${escAttr(x.id)}" style="flex:1 1 130px;min-width:0;font-size:11.5px;padding:6px" value="${td()}">
      <input class="fi" id="py-a-${escAttr(x.id)}" placeholder="입금액" style="flex:1 1 100px;min-width:0;font-size:11.5px;padding:6px"
        value="${rest > 0 ? rest : ''}">
      <input class="fi" id="py-m-${escAttr(x.id)}" placeholder="비고" style="flex:1 1 80px;min-width:0;font-size:11.5px;padding:6px">
      <button class="btn bp bs" style="flex:0 0 auto" onclick="addExhPayment('${escAttr(x.id)}')">추가</button>
    </div>
    <div style="font-size:10.5px;color:var(--i5);margin-top:5px">
      분할 입금이면 여러 번 추가하세요. 환불·차감은 종류를 "환불"로 고르면 합계에서 빠져요.</div>`)}
  `;
}

/* ══════════════════════════════════════════
   3) 그래픽 — 출력 / 제작 분기
══════════════════════════════════════════ */
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

  ${sct('그래픽 정산', `
    <div style="font-size:11.5px;color:var(--i4);margin-bottom:8px">
      그래픽 금액은 정산 탭에서 <b>그래픽</b> 분류로 항목을 추가하고,
      필요하면 그래픽만 따로 인보이스를 발행하세요.
    </div>
    ${(() => {
      const gi = itemsFor(x.id).filter(i => i.category === 'graphic');
      const total = gi.reduce((s, i) => s + Number(String(i.amount || '').replace(/[^0-9.-]/g, '') || 0), 0);
      return gi.length
        ? `<div style="padding:8px 10px;background:var(--i9);border-radius:7px;font-size:12px">
            그래픽 항목 ${gi.length}건 · 합계 <b>${money(total)}</b>원</div>`
        : '<div style="font-size:11.5px;color:var(--i5)">등록된 그래픽 금액 항목이 없어요</div>';
    })()}
    <button class="btn bs" onclick="switchExhDT(1)" style="margin-top:8px">정산 탭으로 이동</button>`)}
  `;
}

/* ══════════════════════════════════════════
   4) 문의·기록
══════════════════════════════════════════ */
const CHANNELS = ['이메일', '전화', '카톡', '미팅', '현장'];
const LOG_CATS = ['부스', '비품', '그래픽', '정산', '현장', '기타'];

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
        ${CHANNELS.map(c => `<option>${c}</option>`).join('')}</select>
      <select class="fi" id="lg-cat-${escAttr(x.id)}" style="width:82px;font-size:11.5px;padding:6px">
        ${LOG_CATS.map(c => `<option>${c}</option>`).join('')}</select>
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
  await addRow(EXH_ITEMS, {
    id: localId('XI-'), exhibitor_id: exhId, category: val(`it-cat-${exhId}`) || 'etc',
    name, qty: val(`it-qty-${exhId}`), unit_price: val(`it-up-${exhId}`), amount,
    currency: currencyOf(exhId), note: '',
    sort_order: String(itemsFor(exhId).length + 1),
  }, saveExhItem);
  clear(`it-nm-${exhId}`, `it-qty-${exhId}`, `it-up-${exhId}`, `it-amt-${exhId}`);
}
export const delExhItem = (id) => removeRow(EXH_ITEMS, id, deleteExhItem);

/* 신청서에 적은 추가 비품 내역을 금액 항목으로 옮겨 담는다 —
   적어둔 걸 다시 타이핑하지 않게 하려는 연결고리. */
export function addItemFromEquip(exhId){
  const x = getExhibitorById(exhId);
  const text = (x?.extra_equipment || '').trim();
  if(!text){ alert('신청서 탭의 "추가 비품 신청 내역"을 먼저 적어주세요.'); return; }
  switchExhDT(1);
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
    id: localId('XV-'), exhibitor_id: exhId, title, amount, currency: currencyOf(exhId),
    created_at: td(), sent_at: '', due_date: '', note: '',
  }, saveExhInvoice);
  clear(`iv-t-${exhId}`, `iv-a-${exhId}`);
}
export const delExhInvoice = (id) => removeRow(EXH_INVOICES, id, deleteExhInvoice);

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
    paid_at: val(`py-d-${exhId}`) || td(), amount, currency: currencyOf(exhId),
    kind: val(`py-k-${exhId}`) || 'in',
    method: val(`py-m-${exhId}`), note: '',
  }, saveExhPayment);
  if(ok){
    clear(`py-m-${exhId}`);
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
export async function addExhContact(exhId, manual){
  const sel = document.getElementById(`exc-pick-${exhId}`);
  const contactId = manual ? '' : (sel?.value || '');
  if(!manual && !contactId){ alert('추가할 연락처를 고르거나 "직접 입력"을 눌러주세요.'); return; }

  const first = contactsFor(exhId).length === 0;
  const ok = await addRow(EXH_CONTACTS, {
    id: localId('XC-'), exhibitor_id: exhId, contact_id: contactId,
    name: '', email: '', phone: '', role: '실무',
    is_primary: first ? 'yes' : '',   // 첫 담당자는 자동으로 대표
    note: '',
  }, saveExhContact);
  if(ok && sel) sel.value = '';
}
export const delExhContact = (id) => removeRow(EXH_CONTACTS, id, deleteExhContact);

export async function setExhContactField(id, field, value){
  const r = EXH_CONTACTS.find(c => c.id === id);
  if(!r) return;
  const before = r[field];
  r[field] = value;
  refreshExhViews();
  const res = await saveExhContact({ id, [field]: value });
  if(!res.ok){ r[field] = before; refreshExhViews(); alert('저장에 실패했어요.'); return; }
  const x = getExhibitorById(r.exhibitor_id);
  const lbl = { name:'이름', email:'이메일', phone:'연락처', role:'역할' }[field] || field;
  trackAction('edit', '기업 담당자 수정', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> 담당자 ${escapeHtml(lbl)} ${escapeHtml(String(before||'(없음)'))} → ${escapeHtml(String(value||'(없음)'))}`);
}

/* 대표는 기업당 한 명이라, 새로 지정하면 나머지는 내려준다 */
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
    alert('대표 담당자 변경에 실패했어요.');
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

window.openExhDr = openExhDr;
window.closeExhDr = closeExhDr;
window.switchExhDT = switchExhDT;
window.renderExhDr = renderExhDr;
window.addExhItem = addExhItem;
window.delExhItem = delExhItem;
window.calcItemAmount = calcItemAmount;
window.addItemFromEquip = addItemFromEquip;
window.addExhInvoice = addExhInvoice;
window.delExhInvoice = delExhInvoice;
window.setInvField = setInvField;
window.addExhPayment = addExhPayment;
window.delExhPayment = delExhPayment;
window.addExhLog = addExhLog;
window.delExhLog = delExhLog;
window.answerExhLog = answerExhLog;
window.holdExhLog = holdExhLog;
window.addExhContact = addExhContact;
window.delExhContact = delExhContact;
window.setExhContactField = setExhContactField;
window.setPrimaryExhContact = setPrimaryExhContact;
window.toggleExhCancel = toggleExhCancel;
window.toggleVoidInvoice = toggleVoidInvoice;
window.settleExh = settleExh;
window.unsettleExh = unsettleExh;
