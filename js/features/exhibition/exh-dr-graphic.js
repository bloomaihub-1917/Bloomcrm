/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-dr-graphic.js — 참가기업 상세 › 그래픽 피드백·그래픽 항목·부스 기본 제공 예외
   (modules/exh-drawer.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { trackAction } from '../../core/audit-log.js';
import { BOOTH_EXC, BOOTH_ORIGIN, boothIncluded, graphicState, isBoothExc, isBoothGiven, itemCode, refreshExhViews } from '../../modules/exh-tab.js';
import { graphicDueInfo } from './exh-graphic-views.js';
import { EXH_ITEMS, EXH_LOGS, currentUser, getExhibitorById, invoicesFor, isVoided, itemsFor, liveItemsFor, logsFor } from '../../state.js';
import { escAttr, escapeHtml, td } from '../../utils.js';
import { GRAPHIC_STAGES, TCELL, TPILL, fmtMoney, money, stageOf } from './exh-calc.js';
import { dateRow, deleteExhLog, localId, saveExhLog, sct, stageBar, switchExhDT, textRow } from '../../modules/exh-drawer.js';
import { isDesignItem } from './exh-dr-billing.js';
import { addRow, removeRow, setItemField } from './exh-dr-actions.js';

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

  return `<div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:7px">
      지금 단계는 <b>${escapeHtml(cur.label)}</b>이고, 남기는 사람은
      <b>${escapeHtml(currentUser?.name || currentUser?.email || '(로그인 정보 없음)')}</b>으로 적힙니다.
      여기 적은 내용은 <b>문의·기록</b> 탭에도 함께 남아요.</div>

    <textarea class="fi" id="gfb-${escAttr(x.id)}" rows="2" placeholder="예: 로고 해상도가 낮아 재전달 요청했습니다"
      style="width:100%;resize:vertical;font-size:var(--fs-12)"></textarea>
    <div style="display:flex;justify-content:flex-end;margin-top:6px">
      <button class="btn bp bs" onclick="addGraphicFeedback('${escAttr(x.id)}')">피드백 남기기</button>
    </div>

    ${rows.length ? `<div style="margin-top:10px">${rows.map(l => `
      <div style="padding:8px 0;border-top:1px solid var(--i8)">
        <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap">
          <span style="font-size:var(--fs-11_5);font-weight:700">${escapeHtml(l.author_name || l.author_email || '알 수 없음')}</span>
          ${l.subject ? `<span class="pill p-gray" style="font-size:var(--fs-9)">${escapeHtml(l.subject)}</span>` : ''}
          <span style="font-size:var(--fs-10);color:var(--i5)">${escapeHtml(l.ts || '')}</span>
          ${l.author_email && l.author_email === me
            ? `<button class="btn bs" style="margin-left:auto;font-size:var(--fs-10);padding:1px 6px"
                onclick="delGraphicFeedback('${escAttr(l.id)}')">삭제</button>` : ''}
        </div>
        <div style="font-size:var(--fs-12);color:var(--i2);white-space:pre-wrap;margin-top:3px">${escapeHtml(l.body || '')}</div>
      </div>`).join('')}</div>`
      : '<div style="font-size:var(--fs-11_5);color:var(--i5);margin-top:10px">아직 남긴 피드백이 없어요</div>'}`;
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

/* ── 우리가 하는 일은 «됐다/안 됐다»만 체크한다 ──

   받는 것은 상대가 준 날이 근거로 남아야 한다(언제 왔길래 독촉을 했나, 마감을
   지켰나). 그런데 우리가 만드는 것은 날짜를 적어 봐야 쓰는 데가 없고, 스무 줄을
   날짜로 채우자니 손이 너무 간다. 체크만 남기고 날짜는 누른 날로 조용히 적어
   둔다 — 나중에 «언제 만들었더라»가 필요하면 기록에 남아 있다. */
const doneCheck = (i) => `<button onclick="toggleItemDone('${escAttr(i.id)}')"
  class="pill ${i.done_at ? 'p-green' : i.received_at ? 'p-amber' : 'p-gray'}"
  style="border:0;cursor:pointer;font:inherit;padding:0 10px;${TPILL}"
  title="${i.done_at ? `${escAttr(i.done_at)}에 했어요 — 누르면 되돌립니다` : '누르면 «했음»으로 표시합니다'}">${
  i.done_at ? '✓ 했음' : '안 했음'}</button>`;

/* 한 항목 줄. 기본 제공 줄에는 «우리 작업» 체크가 하나 더 붙는다 — 그 줄이 곧
   기본 시공이라, 받은 뒤에 우리가 만들어 세우는 단계까지 여기서 끝난다. */
function graphicItemRow(i, opts = {}){
  const on = !!i.received_at;
  return `<div style="padding:9px 0;border-bottom:1px solid var(--i8)">
    <div style="display:flex;align-items:center;gap:9px">
      <button onclick="toggleItemReceived('${escAttr(i.id)}')"
        title="${on ? '받음 표시를 지웁니다' : '오늘 받은 것으로 표시합니다'}"
        style="width:20px;height:20px;border-radius:var(--rs);border:1.5px solid ${on ? 'var(--g)' : 'var(--i6)'};background:${on ? 'var(--g)' : 'transparent'};color:#fff;font-size:var(--fs-12);font-weight:800;cursor:pointer;flex-shrink:0;line-height:1">${on ? '✓' : ''}</button>
      <span style="flex:1;min-width:0">
        <span style="font-size:var(--fs-12_5);font-weight:${on ? 600 : 500};color:${on ? 'var(--i1)' : 'var(--i3)'}">${escapeHtml(i.name || '(이름 없음)')}</span>
        <span style="font-size:var(--fs-10_5);color:var(--i4)">${i.qty ? ` · ${escapeHtml(String(i.qty))}개` : ''}${
          i.amount ? ` · ${escapeHtml(fmtMoney(i.amount, i.currency))}` : ''}</span>${
          isDesignItem(i) && i.note ? `<div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:2px">디자인 대상 — <b>${escapeHtml(i.note)}</b></div>` : ''}
      </span>
      <input type="date" class="fi" style="${TCELL};width:136px;flex:0 0 auto"
        value="${escapeHtml(i.received_at || '')}"
        onchange="setItemField('${escAttr(i.id)}','received_at',this.value)">
    </div>
    ${opts.done ? boothExcRow(i, { pad: 'margin-top:6px;padding-left:29px' }) : ''}
    ${opts.done ? `<div style="display:flex;gap:9px;align-items:center;margin-top:5px;padding-left:29px">
      <span style="font-size:var(--fs-10_5);color:var(--i5);flex:0 0 52px">우리 작업</span>
      ${doneCheck(i)}
    </div>` : ''}
    <div style="display:flex;gap:9px;align-items:center;margin-top:5px;padding-left:29px">
      <span style="font-size:var(--fs-10_5);color:var(--i5);flex:0 0 52px">마감</span>
      <input type="date" class="fi" style="${TCELL};width:136px;flex:0 0 auto"
        value="${escapeHtml(i.due_at || '')}"
        onchange="setItemField('${escAttr(i.id)}','due_at',this.value)">
      ${(() => { const d = graphicDueInfo(i);
        return on ? '' : `<span class="pill ${d.cls}" style="${TPILL}">${escapeHtml(d.text)}</span>`; })()}
    </div>
    ${opts.done ? '' : `<div style="display:flex;gap:9px;align-items:center;margin-top:5px;padding-left:29px">
      <span style="font-size:var(--fs-10_5);color:var(--i5);flex:0 0 52px">받은 것</span>
      <input class="fi" style="${TCELL};flex:1;min-width:0"
        value="${escapeHtml(i.received_note || '')}" placeholder="예: 백월_최종.ai · CMYK · 재단선 포함"
        onchange="setItemField('${escAttr(i.id)}','received_note',this.value)">
    </div>`}
  </div>`;
}

/* 받을 그래픽 — 계약에 딸려 오는 것과 기업이 따로 주문한 것을 갈라 둔다.

   둘은 성격이 다르다. 기본 제공은 부스 타입이 정하는 것이라 기업이 아무 말을
   안 해도 우리가 만들어 세워야 하고(빠뜨리면 개막날 부스에 상호가 없다),
   추가 주문은 기업이 신청하고 돈을 더 내는 것이라 안 하면 그만이다. 한 줄에
   섞여 있으면 «이 부스에 원래 들어가는 것»이 무엇인지 알 수 없다. */
function graphicItemsBlock(x){
  /* 뺀 줄(내려 둔 기본 제공)도 함께 본다 — 목록에서 사라지면 «원래 있었는데
     뺐다»는 사실까지 사라져, 다음 사람이 빠뜨린 줄로 알고 다시 넣는다. */
  const gi = [...graphicItems(x.id),
    ...itemsFor(x.id).filter(i => (i.category || '') === 'graphic' && isVoided(i) && isBoothExc(i))];
  if(!gi.length){
    return `<div style="font-size:var(--fs-11_5);color:var(--i5);margin-bottom:8px">등록된 그래픽 항목이 없어요</div>
      <div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:8px">
        부스 타입을 정하면 그 타입의 기본 제공 그래픽이 여기 깔리고,
        정산 탭에서 <b>그래픽</b> 분류로 넣은 추가 주문도 여기 나옵니다.</div>
      <button class="btn bs" onclick="switchExhDT('billing')">정산 탭으로 이동</button>`;
  }

  const base = gi.filter(isBoothGiven);
  const extra = gi.filter(i => !isBoothGiven(i));
  const total = gi.reduce((s, i) => s + Number(String(i.amount || '').replace(/[^0-9.-]/g, '') || 0), 0);
  const got = gi.filter(i => i.received_at).length;
  const late = gi.filter(i => !i.received_at && graphicDueInfo(i).late).length;

  const group = (label, list, hint, opts) => !list.length ? '' : `
    <div style="margin:${label === '기본 제공' ? '0' : '14px'} 0 2px;display:flex;align-items:baseline;gap:7px">
      <span style="font-size:var(--fs-11_5);font-weight:700;color:var(--i2)">${escapeHtml(label)}</span>
      <span style="font-size:var(--fs-10_5);color:var(--i5)">${escapeHtml(hint)}</span>
    </div>
    ${list.map(i => graphicItemRow(i, opts)).join('')}`;

  return `<div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:8px">
      기업에서 파일을 받으면 왼쪽 칸에 체크하고, 받은 파일이 무엇이었는지 적어 두세요.
      <b>마감</b>은 이 파일을 언제까지 받기로 했나입니다 — 지난 것은 그래픽 현황에서 붉게 잡힙니다.</div>

    ${group('기본 제공', base, `${x.booth_type || '부스 타입'}에 딸려 나갑니다 — 청구하지 않아요`, { done: true })}
    ${group('추가 주문', extra, '기업이 따로 신청한 것 — 청구 대상이에요', {})}

    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:9px 2px 0;font-size:var(--fs-12)">
      <span style="color:var(--i4)">${gi.length}건 · 받음 ${got}건${got < gi.length ? ` · <b style="color:var(--am)">미수령 ${gi.length - got}건</b>` : ''}${
        late ? ` · <b style="color:var(--re)">마감 지남 ${late}건</b>` : ''}</span>
      <span>합계 <b>${money(total)}</b>원</span>
    </div>
    <button class="btn bs" onclick="switchExhDT('billing')" style="margin-top:8px">정산 탭에서 항목 추가·수정</button>`;
}

/* ══════════════════════════════════════════
   부스 기본 제공 — 이 기업만의 예외

   설정(부스 타입 › 기본 제공 품목)은 좀처럼 바뀌지 않는다. 대신 현장에서
   예외가 계속 나온다 — 인포데스크를 안 쓰겠다는 기업, 바스툴을 하나 더 받기로
   한 기업, 벽면 그래픽을 자체로 만들어 오는 기업.

   그 줄을 그냥 지우거나 고치면 다음에 부스 타입을 다시 고르는 순간 설정대로
   덮인다. 그래서 손댄 줄은 «예외»로 표시해 두고(origin=booth-exc), 자동 반영이
   건드리지 않게 한다. 왜 그랬는지는 줄마다 적는다 — 현장에서 «이 부스만 왜
   데스크가 없지»를 되묻지 않도록.

   안 쓰겠다는 것은 지우지 않고 내린다. 지우면 발주 수량에서는 빠지지만 «원래
   있었는데 뺐다»는 사실도 함께 사라져서, 다음 사람이 빠뜨린 줄로 알고 다시
   넣는다. 내려 두면 발주·대장에서는 빠지고 화면에는 취소선으로 남는다.
══════════════════════════════════════════ */

/* 설정에 적힌 그 품목의 수량 — 되돌릴 때 쓴다 */
function boothWantOf(x, i){
  const code = itemCode(i.name);
  return boothIncluded(x.event_id, x.booth_type)
    .find(o => String(o.code || itemCode(o.name)) === code) || null;
}

async function markExc(i){
  if(isBoothExc(i)) return;
  await setItemField(i.id, 'origin', BOOTH_EXC);
}

export async function setBoothItemQty(id, v){
  const i = EXH_ITEMS.find(r => r.id === id);
  if(!i || String(i.qty ?? '') === String(v ?? '')) return;
  await markExc(i);
  await setItemField(id, 'qty', v);
  refreshExhViews();
}

/* 안 쓰겠다 — 내려 둔다(지우지 않는다) */
export async function excludeBoothItem(id){
  const i = EXH_ITEMS.find(r => r.id === id);
  if(!i) return;
  const why = prompt('이 기업만 빼는 이유를 적어 주세요 — 현장에서 «왜 없지»를 되묻지 않도록.\n예: 자체 데스크를 가져옴 / 기업 요청으로 미사용', i.note || '');
  if(why === null) return;
  await markExc(i);
  if(String(why).trim() !== String(i.note || '')) await setItemField(id, 'note', why);
  await setItemField(id, 'voided_at', td());
  trackAction('edit', '기본 제공 예외', getExhibitorById(i.exhibitor_id)?.company_name || '',
    `<b>${escapeHtml(i.name || '')}</b>를 이 기업에서 뺐어요 — ${escapeHtml(String(why).trim() || '사유 없음')}`,
    { kind: 'exhibitor', id: i.exhibitor_id, tab: 'apply' });
  refreshExhViews();
}

/* 설정대로 되돌리기 — 내린 것은 올리고, 고친 수량은 설정 값으로 */
export async function restoreBoothItem(id){
  const i = EXH_ITEMS.find(r => r.id === id);
  if(!i) return;
  const x = getExhibitorById(i.exhibitor_id);
  const want = x ? boothWantOf(x, i) : null;
  if(!confirm(`«${i.name || ''}»를 설정대로 되돌릴까요?`
    + (want && String(want.qty ?? '') !== String(i.qty ?? '') ? `\n수량 ${i.qty || '-'} → ${want.qty ?? '-'}` : '')
    + (isVoided(i) ? '\n뺐던 줄을 다시 살립니다.' : ''))) return;
  if(isVoided(i)) await setItemField(id, 'voided_at', '');
  if(want && String(want.qty ?? '') !== String(i.qty ?? '')) await setItemField(id, 'qty', String(want.qty ?? ''));
  await setItemField(id, 'origin', BOOTH_ORIGIN);
  refreshExhViews();
}

/* 예외 줄 하나. 그래픽 탭과 신청항목 탭이 같은 줄을 쓴다 — 두 군데가 다르게
   보이면 어느 쪽이 맞는지 다시 확인하게 된다. */
function boothExcRow(i, opts = {}){
  const off = isVoided(i);
  const exc = isBoothExc(i);
  return `<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;${opts.pad || ''}">
    ${exc ? `<span class="pill ${off ? 'p-red' : 'p-amber'}" style="${TPILL};min-width:48px" title="설정과 다르게 이 기업만 따로 둔 줄이에요 — 부스 타입을 다시 골라도 그대로 둡니다">${off ? '뺌' : '예외'}</span>` : ''}
    <span style="font-size:var(--fs-10_5);color:var(--i5);flex:0 0 52px">수량</span>
    <input class="fi" style="${TCELL};width:56px;flex:0 0 auto" value="${escapeHtml(i.qty ?? '')}"
      inputmode="numeric" ${off ? 'disabled' : ''}
      title="설정과 다르게 적으면 이 줄은 예외가 됩니다"
      onchange="setBoothItemQty('${escAttr(i.id)}',this.value)">
    ${off
      ? `<button class="btn bs" onclick="restoreBoothItem('${escAttr(i.id)}')" title="다시 제공하는 것으로 되돌립니다">되살리기</button>`
      : `<button class="btn bs" onclick="excludeBoothItem('${escAttr(i.id)}')" title="이 기업에는 안 나갑니다 — 발주 수량에서 빠지고, 뺐다는 사실은 남습니다">이 기업은 뺌</button>`}
    ${exc && !off ? `<button class="btn bs" onclick="restoreBoothItem('${escAttr(i.id)}')" title="설정에 적힌 수량으로 되돌립니다">설정대로</button>` : ''}
    ${exc ? `<input class="fi" style="${TCELL};flex:1;min-width:120px"
        placeholder="예외 사유 — 예: 자체 데스크를 가져옴" value="${escapeHtml(i.note || '')}"
        onchange="setItemField('${escAttr(i.id)}','note',this.value)">` : ''}
  </div>`;
}

/* 신청항목 탭의 «부스 기본 제공» 구획 — 비품·그래픽을 한자리에서 본다.
   내린 줄도 보여 준다. 무엇이 빠졌는지가 안 보이면 다음 사람이 다시 넣는다. */
function boothGivenBlock(x){
  const rows = itemsFor(x.id).filter(isBoothGiven);
  if(!rows.length){
    return `<div style="font-size:var(--fs-11_5);color:var(--i5);padding:6px 2px">
      이 부스 타입에 적어 둔 기본 제공 품목이 없어요 — 설정 › 행사 관리 › 부스에서 부스 타입에 적습니다.</div>`;
  }
  return `<div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:8px">
      부스 타입(<b>${escapeHtml(x.booth_type || '미정')}</b>)에 딸려 나가는 것들이에요 — 청구하지 않습니다.
      이 기업만 다르게 가야 하면 여기서 고치세요. 고친 줄은 <b>예외</b>로 표시되어, 부스 타입을 다시 골라도 그대로 둡니다.</div>
    ${rows.map(i => {
      const off = isVoided(i);
      return `<div style="padding:8px 0;border-bottom:1px solid var(--i8)">
        <div style="display:flex;align-items:baseline;gap:7px">
          <span class="pill ${(i.category || '') === 'graphic' ? 'p-teal' : 'p-gray'}">${
            (i.category || '') === 'graphic' ? '그래픽' : '비품'}</span>
          <span style="font-size:var(--fs-12_5);font-weight:600;${off ? 'color:var(--i5);text-decoration:line-through' : ''}">${escapeHtml(i.name || '')}</span>
        </div>
        ${boothExcRow(i, { pad: 'margin-top:6px' })}
      </div>`;
    }).join('')}`;
}

/* 우리 작업 체크 — 누르면 오늘 날짜가 들어가고, 다시 누르면 지운다.
   화면에는 날짜를 보이지 않지만 값은 날짜로 남긴다 — «됐다»만 남기면 언제
   했는지가 사라지고, 현장에서 «이거 어제 건 맞나»를 되짚을 수 없다. */
export async function toggleItemDone(id){
  const ids = String(id).split(',').filter(Boolean);
  const i = EXH_ITEMS.find(r => r.id === ids[0]);
  if(!i) return;
  const v = i.done_at ? '' : td();
  for(const one of ids) await setItemField(one, 'done_at', v);
  refreshExhViews();
}

/* 받음 체크 — 누르면 오늘 날짜가 들어가고, 다시 누르면 지운다.
   지울 때는 원래 날짜를 기록에 남긴다(잘못 눌러 지운 값을 되찾을 수 있게). */
export async function toggleItemReceived(id){
  /* 그래픽 화면은 같은 파일을 한 줄로 묶어 보여 준다. 그 줄을 누르면 묶인
     항목이 다 같이 움직여야 한다 — 한 장만 받음으로 바뀌면 줄에 적힌 수량과
     상태가 서로 어긋난다. 첫 줄의 상태를 기준으로 전부 같은 값으로 맞춘다. */
  const ids = String(id).split(',').filter(Boolean);
  const i = EXH_ITEMS.find(r => r.id === ids[0]);
  if(!i) return;
  const v = i.received_at ? '' : td();
  for(const one of ids) await setItemField(one, 'received_at', v);
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
      <div style="font-size:var(--fs-13);font-weight:600;margin-bottom:4px">그래픽 주문 없음</div>
      <div style="font-size:var(--fs-11_5);color:var(--i4);margin-bottom:16px">
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

  ${!x.graphic_type ? '<div style="font-size:var(--fs-11_5);color:var(--am);padding:4px 2px">유형을 먼저 선택해주세요</div>' : ''}

  ${sct('피드백', graphicFeedbackBlock(x),
    (() => { const n = graphicFeedback(x.id).length; return n ? `<span class="pill p-gray">${n}</span>` : ''; })())}

  `;
}

/* «참가기업 상세 › 문의·기록»은 ../features/exhibition/exh-dr-logs.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */

/* 화면의 onclick이 부르는 것 */
window.toggleItemDone       = toggleItemDone;
window.setBoothItemQty      = setBoothItemQty;
window.excludeBoothItem     = excludeBoothItem;
window.restoreBoothItem     = restoreBoothItem;
window.toggleItemReceived = toggleItemReceived;
window.addGraphicFeedback = addGraphicFeedback;
window.delGraphicFeedback = delGraphicFeedback;
window.graphicUnreceived = graphicUnreceived;   // 탭(exh-drawer.js)이 window로 부른다
window.dGraphic = dGraphic;   // 탭(exh-drawer.js)이 window로 부른다
window.boothGivenBlock = boothGivenBlock;   // 탭(exh-drawer.js)이 window로 부른다
