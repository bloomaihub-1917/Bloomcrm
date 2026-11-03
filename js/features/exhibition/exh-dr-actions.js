/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-dr-actions.js — 상세 창 저장 동작 — 품목·인보이스·입금·세금계산서·정산·담당자, 상황 물어보기
   (modules/exh-drawer.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { aiExhAdvice } from '../../api/ai.js';
import { changed, removed, trackAction } from '../../core/audit-log.js';
import { patchOrgFields } from '../../domain/org-save.js';
import { exhMailState } from '../../modules/exh-bulkmail.js';
import { exhIsEnglish, exhMailSteps } from '../../modules/exh-mail.js';
import { SELF_BUILD_TYPE, STEPS, cellState, isBookOnly, patchExh, refreshExhViews } from '../../modules/exh-tab.js';
import { EXH_CONTACTS, EXH_INVOICES, EXH_ITEMS, EXH_LOGS, EXH_PAYMENTS, EXH_TAX, contacts, contactsFor, currentUser, getExhibitorById, invoicesFor, logsFor, nextItemSort, openAppFor, openInquiriesFor } from '../../state.js';
import { escAttr, escapeHtml, nowStamp, td } from '../../utils.js';
import { CANCELLED, TAX_STAGES, currencyOf, fmtMoney, isBillable, settleState, stageOf, taxNeed } from './exh-calc.js';
import { exhDrUi } from './exh-drawer-ui.js';
import { closeExhDr, deleteExhContact, deleteExhInvoice, deleteExhItem, deleteExhLog, deleteExhPayment, deleteExhTax, localId, openExhDr, openOrgFromExh, orgForField, renderExhDr, saveExhContact, saveExhInvoice, saveExhItem, saveExhLog, saveExhPayment, saveExhTax, saveFailed, setBuilderOrg, switchExhDT, syncNorm } from '../../modules/exh-drawer.js';
import { addBoothDesignFeedback, assignExhContact, catalogPickMissing, closeNewContact, hideMailCand, mailCandAsBuilder, needsCatalog, openExhPerson, openNewContact, pickCatalogItem, promoteExhContact, setBoothDesignResult, submitNewContact, unassignExhContact } from './exh-dr-booth.js';
import { ackExhAlert, addExhApp, addItemHere, closeExhApp, delExhApp, drawIntroMeter, reopenExhApp, setAppField, unackExhAlert, voidExhItem } from './exh-dr-progress.js';
import { editItemRow, openTaxAnyway, pickItemCat, rememberItemCat, rememberItemCur, swapItemList, toggleItemGroup } from './exh-dr-billing.js';

/* ══════════════════════════════════════════
   ✨ 상황 물어보기 — 연사 드로어와 같은 틀(speaker-drawer.js adviceHtml)
   «인보이스 금액이 틀려서 다시 보내야 해»처럼 적으면 이 CRM에서 할 일을 순서대로 답하고
   줄마다 단추(메일 초안·탭 열기·메일 단계 편집)를 붙인다(backend-node/routes/ai.js /exh-advice).
   보내는 것은 진행 항목·정산·메일 단계의 «상태»와 기록의 날짜·방향·종류뿐 —
   회사명·담당자·금액·메일 제목·본문은 보내지 않는다.
   드로어가 통째로 다시 그려지므로 질문·답은 여기 붙들어 둔다.
══════════════════════════════════════════ */
const ADVICE_TAB = { app_received_at: 'apply', 'calc:invoice': 'billing', 'calc:tax': 'billing', 'calc:payment': 'billing',
  'calc:graphic': 'graphic', directory_received_at: 'book' };
function exhAdviceHtml(x){
  const a = exhDrUi.exhAdvice && exhDrUi.exhAdvice.id === x.id ? exhDrUi.exhAdvice : null;
  const btn = (t) => {
    const label = { mail: '✉ 메일 초안', tab: '→ 탭 열기', mailedit: '✎ 메일 단계 편집' }[t.action];
    return label ? ` <button class="btn" style="font-size:10px;padding:1px 7px" onclick="exhAdviceAct('${t.action}','${escAttr(t.arg)}')">${label}</button>` : '';
  };
  return `<div style="margin-bottom:10px;padding:7px 10px;border:1px solid var(--i6);border-radius:8px;background:var(--W)">
    <div style="display:flex;gap:6px">
      <input class="fi" id="exh-advice-q" style="flex:1;font-size:11.5px" value="${escapeHtml(a ? a.q : '')}"
        placeholder="✨ 상황 물어보기 — 예: 인보이스 금액이 틀려서 다시 보내야 해"
        onkeydown="if(event.key==='Enter')askExhAdvice()" title="질문과 이 참가사의 진행 상태만 AI에게 보냅니다. 회사명·금액·메일 내용은 보내지 않아요">
      <button class="btn" style="font-size:10.5px" onclick="askExhAdvice()" ${a && a.loading ? 'disabled' : ''}>${a && a.loading ? '생각 중…' : '물어보기'}</button>
    </div>
    ${a && a.err ? `<div style="font-size:11px;color:var(--re);margin-top:5px">${escapeHtml(a.err)}</div>` : ''}
    ${a && a.ans ? `<div style="margin-top:7px;padding:8px 10px;background:var(--ad);border-radius:7px;font-size:11.5px;line-height:1.6">
        <div style="font-weight:700;color:var(--i1)">✨ ${escapeHtml(a.ans.summary)}</div>
        <ol style="margin:4px 0 0 18px;padding:0">${a.ans.todo.map(t => `<li style="margin:2px 0">${escapeHtml(t.text)}${btn(t)}</li>`).join('')}</ol>
        ${a.ans.caution ? `<div style="color:var(--am);margin-top:4px">⚠️ ${escapeHtml(a.ans.caution)}</div>` : ''}
        <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
          ${a.saved ? '<span style="font-size:10.5px;color:var(--g)">✓ 문의·기록에 남겼어요</span>'
            : `<button class="btn" style="font-size:10px" onclick="saveExhAdvice()" title="질문과 답을 이 참가사의 문의·기록에 메모로 남깁니다">기록에 남기기</button>`}
          <button class="btn" style="font-size:10px" onclick="clearExhAdvice()">닫기</button>
        </div></div>` : ''}
  </div>`;
}
export async function askExhAdvice(){
  const x = getExhibitorById(exhDrUi.drId);
  const q = String(document.getElementById('exh-advice-q')?.value || '').trim();
  if(!x || !q) return;
  exhDrUi.exhAdvice = { id: x.id, q, loading: true };
  renderExhDr();
  const mailSteps = exhMailSteps(x.event_id);
  const mailLabel = (kind) => {
    if(kind === 'inquiry') return '문의';
    if(kind === 'note') return '메모';
    if(kind === 'reply') return '회신';
    const k = String(kind || '').replace(/^exh-/, '');
    return (mailSteps.find(s => s.key === k) || {}).label || '';
  };
  const st = settleState(x);
  const r = await aiExhAdvice({
    question: q,
    today: td(),
    lang: exhIsEnglish(x) ? '영문' : '국문',
    cancelled: x.status === CANCELLED,
    boothType: x.booth_type || '',
    selfBuild: x.booth_type === SELF_BUILD_TYPE,
    bookOnly: isBookOnly(x),
    steps: STEPS.map(s => { const c = cellState(x, s); return { key: s.key, label: s.label, state: c.state, due: c.due?.date || '', tab: ADVICE_TAB[s.key] || 'progress' }; }),
    settle: { state: st.state, due: st.due || '', overdue: !!st.overdue },
    tax: taxNeed(x).kind || '',
    inquiries: openInquiriesFor(x.id).length,
    mails: mailSteps.map(s => ({ key: s.key, label: s.label, state: exhMailState(x, s) })),
    // 기록은 날짜·방향·종류만 — 제목·본문·상대 주소는 보내지 않는다
    logs: logsFor(x.id).filter(l => l.kind !== 'view')
      .slice().sort((p, q2) => String(q2.ts || '').localeCompare(String(p.ts || ''))).slice(0, 15)
      .map(l => ({ date: String(l.ts || '').slice(0, 10), dir: l.direction === 'in' ? '받음' : l.direction === 'out' ? '보냄' : '', kind: mailLabel(l.kind) })),
  });
  if(!exhDrUi.exhAdvice || exhDrUi.exhAdvice.id !== x.id) return;
  exhDrUi.exhAdvice = r.ok ? { id: x.id, q, ans: { summary: r.summary, todo: r.todo || [], caution: r.caution || '' } }
    : { id: x.id, q, err: '답을 받지 못했어요: ' + (r.error || '') };
  renderExhDr();
}
export function exhAdviceAct(action, arg){
  const x = getExhibitorById(exhDrUi.drId);
  if(!x) return;
  if(action === 'mail'){ exhDrUi.exhMailStep = arg; exhDrUi.exhSkipDefault = new Set(); exhDrUi.exhReply = null; exhDrUi.drTab = 'mail'; renderExhDr(); }
  else if(action === 'tab') switchExhDT(arg);
  else if(action === 'mailedit') window.openExhMailEditor?.(x.event_id, arg || undefined);
}
export async function saveExhAdvice(){
  const x = getExhibitorById(exhDrUi.drId);
  const a = exhDrUi.exhAdvice;
  if(!x || !a || !a.ans || a.id !== x.id) return;
  const body = [a.ans.summary, ...a.ans.todo.map((t, i) => `${i + 1}. ${t.text}`), a.ans.caution ? `주의: ${a.ans.caution}` : '']
    .filter(Boolean).join('\n');
  const ok = await addRow(EXH_LOGS, {
    id: localId('XL-'), exhibitor_id: x.id, kind: 'note', ts: nowStamp(),
    direction: '', channel: '메모', counterpart: '', category: '✨ 상황 상담',
    subject: a.q, body, answered_at: '', answer: '', status: 'done',
    author_email: currentUser?.email || '', author_name: currentUser?.name || '',
  }, saveExhLog);
  if(!ok) return;
  exhDrUi.exhAdvice = { ...a, saved: true };
  renderExhDr();
}
export function clearExhAdvice(){ exhDrUi.exhAdvice = null; renderExhDr(); }
window.askExhAdvice = askExhAdvice;
window.exhAdviceAct = exhAdviceAct;
window.saveExhAdvice = saveExhAdvice;
window.clearExhAdvice = clearExhAdvice;

export async function addRow(arr, rec, saveFn, label){
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
/* 지운 줄을 기록에 무엇이라고 적을까. 이름 칸이 없는 줄(마스터DB에 연결된 담당자,
   문의, 신청서 접수, 입금)은 빈칸으로 남아 «담당자  지움»처럼 무엇을 지웠는지 몰랐다. */
const ROW_LABEL = (r) => {
  if(r.name || r.title) return r.name || r.title;
  if(r.contact_id){
    const c = contacts.find(x => String(x.id) === String(r.contact_id));
    if(c) return c.nameKo || c.nameEn || c.email1 || '';
  }
  if(r.email) return r.email;
  if(r.subject || r.body) return `«${String(r.subject || r.body).replace(/\s+/g, ' ').slice(0, 24)}»`;
  if(r.seq || r.received_at) return [r.seq && `${r.seq}차`, r.received_at && `${String(r.received_at).slice(0, 10)} 접수`].filter(Boolean).join(' ');
  if(r.paid_at || r.amount) return [r.paid_at && String(r.paid_at).slice(0, 10), r.amount && `${r.amount} ${r.currency || 'KRW'}`].filter(Boolean).join(' ');
  return '';
};
export async function removeRow(arr, id, deleteFn, label = '줄', table = ''){
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
    { kind: 'exhibitor', id: removed.exhibitor_id, tab: 'billing', table, row: id,
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
  exhDrUi.lastItemCat = category;   // 다음 줄도 같은 분류일 가능성이 높다
  if(catalogPickMissing(exhId)) return;
  const catalogId = needsCatalog(category)
    ? document.getElementById(`it-nm-${exhId}`)?.dataset.catalogId || '' : '';

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
export const delExhItem = (id) => removeRow(EXH_ITEMS, id, deleteExhItem, '금액 항목', 'exhibitor_items');

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
export const delExhInvoice = (id) => removeRow(EXH_INVOICES, id, deleteExhInvoice, '인보이스', 'exhibitor_invoices');

/* 화면 입력칸을 거치지 않고 인보이스 줄을 만든다 — exh-invoice.js의 '발행'이
   쓴다(신청 내역에서 곧바로 발행할 때는 사람이 금액을 두드리지 않는다).
   쓰기는 여기 모여 있어야 한다: 잠금(guardWrite)과 실패 되돌리기가 여기 있다. */
export async function createInvoiceRow(exhId, { title, amount, currency }){
  /* 발송일은 비워 둔다 — 파일 저장이 끝난 뒤 부르는 쪽(exh-invoice)이 찍는다.
     만들 때 찍으면 파일이 안 만들어져도 «발송함»으로 남는다. */
  const rec = {
    id: localId('XV-'), exhibitor_id: exhId, title: title || '인보이스', amount,
    currency: currency || currencyOf(exhId),
    created_at: td(), sent_at: '', due_date: '', note: '',
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
  const table = opts.table || '';
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
  // 금액은 그 줄의 통화로 적는다 — 달러 입금이 «1739»로만 남아 원화처럼 읽혔다
  const show = (v) => !v ? '(없음)' : field === 'amount' ? fmtMoney(v, r.currency || 'KRW') : String(v);
  trackAction('edit', label + ' 수정', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(r.name || r.title || label)} ${escapeHtml(fl)} ${escapeHtml(show(before))} → ${escapeHtml(show(value))}`,
    /* 값 자체도 담는다 — 문장만으로는 되돌릴 수 없다 */
    { kind: 'exhibitor', id: x?.id, tab: 'billing', field, table, row: id,
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
  // 묶어서 보여 준 줄은 id가 여럿 온다 — 같은 값을 묶인 항목 모두에 넣는다
  const many = String(id).split(',').filter(Boolean);
  if(many.length > 1){
    let ok = true;
    for(const one of many) ok = (await setItemField(one, field, value, opts)) && ok;
    return ok;
  }

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
  return setRowField(EXH_ITEMS, saveExhItem, '금액 항목', id, field, value,
    { table: 'exhibitor_items', ...opts });
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
      `<b>${escapeHtml(x?.company_name || '')}</b> 입금 ${fmtMoney(amount, rec.currency)} 확인`,
      /* 새로 만든 줄은 되돌리는 게 «지우기»다 — 어느 줄인지만 알면 된다 */
      { kind: 'exhibitor', id: x?.id, tab: 'billing',
        table: 'exhibitor_payments', row: rec.id, op: 'create', after: rec });
  }
}
export const delExhPayment = (id) => removeRow(EXH_PAYMENTS, id, deleteExhPayment, '입금 내역', 'exhibitor_payments');

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
export const delExhTax = (id) => removeRow(EXH_TAX, id, deleteExhTax, '세금계산서', 'exhibitor_tax_invoices');

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
  // 감사 로그(changed)에 넘길 전후 값 — 예전엔 patch가 정의되지 않아 저장 뒤 기록이 터졌다
  const patch = { stage: prev.key };
  const before = { stage: v.stage };
  v.stage = prev.key;
  refreshExhViews();
  const r = await saveExhTax({ id, ...patch });
  if(!r.ok){ v.stage = before.stage; refreshExhViews(); saveFailed(r, '저장에 실패했어요.'); return; }
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
/* 취소 기업이 낸 돈을 돌려주지 않기로 했다 — 완납 처리와 같은 칸(settled)에
   담는다. 취소 기업에게 «완납»은 뜻이 없으니 화면에서만 위약금이라 부른다. */
export async function forfeitExh(exhId){
  const note = (document.getElementById(`stl-note-${exhId}`)?.value || '').trim();
  if(!note){ alert('사유를 적어주세요. (예: 계약상 디파짓 환불 불가)'); return; }
  if(!confirm(`낸 돈을 돌려주지 않고 위약금으로 남길까요?
사유: ${note}`)) return;
  await patchExh(exhId, { settled: 'yes', settled_note: note }, '위약금으로 남김');
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
export const delExhLog = (id) => removeRow(EXH_LOGS, id, deleteExhLog, '문의·기록', 'exhibitor_logs');

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
export const delExhContact = (id) => removeRow(EXH_CONTACTS, id, deleteExhContact, '담당자', 'exhibitor_contacts');

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
  const patch = { status: off ? '준비중' : CANCELLED };
  /* 취소 중에 «위약금으로 남김»(settled=yes)을 눌렀다면, 다시 참가할 때 그 표시가
     남아 새 청구가 «완납 처리»로 닫혀 보인다. 같은 칸을 완납 처리(settleExh)도
     쓰므로 어느 쪽에서 찍혔는지 알 수 없다 — 지우기 전에 사유를 보여 주고 묻는다. */
  if(off && x.settled === 'yes' && confirm(`취소 중에 남긴 «위약금으로 남김» 표시도 지울까요?${
    x.settled_note ? `\n사유: ${x.settled_note}` : ''}\n지우지 않으면 다시 참가해도 «완납 처리»로 보여요.`)){
    patch.settled = ''; patch.settled_note = '';
  }
  await patchExh(id, patch, off ? '참가 취소 해제' : '참가 취소');
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

window.openExhDr = openExhDr;
window.closeExhDr = closeExhDr;
window.switchExhDT = switchExhDT;
window.openOrgFromExh = openOrgFromExh;
window.ackExhAlert = ackExhAlert;
window.unackExhAlert = unackExhAlert;
window.openNewContact = openNewContact;
window.closeNewContact = closeNewContact;
window.submitNewContact = submitNewContact;
window.assignExhContact = assignExhContact;
window.unassignExhContact = unassignExhContact;
window.drawIntroMeter = drawIntroMeter;
window.setBuilderOrg = setBuilderOrg;
/* 기업 DB 값을 이번 행사 원고로 옮긴다 — 기업이 그대로 쓰겠다고 확인한 뒤에만 */
window.useOrgBookValue = (id, f, orgKey, label) => {
  const x = getExhibitorById(id); const o = x && orgForField(x, f);
  if(o?.[orgKey]) window.setExhField(id, f, o[orgKey], label);
};
/* 이번 행사에 받은 값으로 기업 DB를 고친다 */
window.pushToOrg = async (id, f, orgKey) => {
  const x = getExhibitorById(id); const o = x && orgForField(x, f);
  if(!o || !syncNorm(x[f])) return;
  await patchOrgFields(o.id, { [orgKey]: String(x[f]).trim() });
  refreshExhViews();
};
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
window.addItemHere = addItemHere;
window.editItemRow = editItemRow;
window.toggleItemGroup = toggleItemGroup;
window.openTaxAnyway = openTaxAnyway;
window.swapItemList = swapItemList;
window.pickItemCat = pickItemCat;
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
window.hideMailCand = hideMailCand;
window.openExhPerson = openExhPerson;
window.mailCandAsBuilder = mailCandAsBuilder;
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
window.forfeitExh = forfeitExh;

/* «참가기업 상세 › 메일 — 담당자에게 바로 보내기»은 ../features/exhibition/exh-dr-mail.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */

/* 화면의 onclick이 부르는 것 */
window.exhAdviceHtml = exhAdviceHtml;   // 탭(exh-drawer.js)이 window로 부른다
window.addRow = addRow;   // 탭(exh-drawer.js)이 window로 부른다
window.val = val;   // 탭(exh-drawer.js)이 window로 부른다
window.calcItemAmount = calcItemAmount;   // 탭(exh-drawer.js)이 window로 부른다
window.delExhContact = delExhContact;   // 탭(exh-drawer.js)이 window로 부른다
window.addExhItem = addExhItem;   // 탭(exh-drawer.js)이 window로 부른다
window.setRowField = setRowField;   // 탭(exh-drawer.js)이 window로 부른다
window.removeRow = removeRow;   // 탭(exh-drawer.js)이 window로 부른다
window.setItemField = setItemField;   // 탭(exh-drawer.js)이 window로 부른다
