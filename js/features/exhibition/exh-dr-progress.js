/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-dr-progress.js — 상세 창 진행 — 신청서 접수 이력·도록·현장
   (modules/exh-drawer.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { trackAction } from '../../core/audit-log.js';
import { BASE_KINDS, applyBoothItems, baseDoneCheck, baseKind, baseRecvAt, baseRecvItems, bookMissing, bookName, boothItemsPending, boothTypeOptions, fasciaName, hostOptions, introOver, isBookOnly, isBoothExc, isBoothGiven, isSharedBooth, patchExh, refreshExhViews } from '../../modules/exh-tab.js';
import { EXH_APPS, EXH_ITEMS, appsFor, currentUser, exhEvent, getExhibitorById, getOrgById, invoicesFor, isVoided, itemsFor, liveItemsFor, openAppFor } from '../../state.js';
import { escAttr, escapeHtml, td } from '../../utils.js';
import { CANCELLED, currencyOf, fmtMoney, invoiceGap, isBillable, money, needsReissue } from './exh-calc.js';
import { exhDrUi } from './exh-drawer-ui.js';
import { builderBlock, dateRow, deleteExhApp, flagRow, grades, localId, saveExhApp, sct, syncTag, textRow } from '../../modules/exh-drawer.js';
import { boothDesignBlock, catalogDatalist, catalogPickMissing, itemListId, pickCatalogItem } from './exh-dr-booth.js';

/* ══════════════════════════════════════════
   1) 진행 — 매뉴얼 / 신청서 / 부스 / 도록 / 현장
══════════════════════════════════════════ */
/* «참가기업 지우기 — 딸린 것까지 함께»은 ../features/exhibition/exh-remove.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
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
/* ── 정산 경고 덮어 두기 ──

   «추가 발행 필요»와 «인보이스 발행 뒤 변경»은 대개 맞는 말이지만, 우리가 낼
   장이 아닌 경우가 실제로 있다. 그때마다 빨간 줄이 남으면 진짜 미발행 건이 묻힌다.

   지우지 않고 «그 숫자를 보고 넘어갔다»를 적어 둔다. 확인한 시점의 숫자를 함께
   담아, 그 뒤 금액이나 접수가 또 바뀌면 값이 달라져 경고가 스스로 되살아난다 —
   한 번 끄면 영영 안 보이는 표시는 실제와 어긋나도 알 길이 없다. */
export const gapAckToken = (g) => `${g.mine}|${g.net}|${g.cur}`;
export const reissueAckToken = (r) => `${r.last}|${r.apps.map(a => a.id).sort().join(',')}`;

export const ackedNote = (x, which, label) => `<div style="display:flex;align-items:center;gap:7px;margin-bottom:10px;
    background:var(--i9);border:1px solid var(--i7);border-radius:var(--r);padding:7px 11px">
  <span class="pill p-gray">확인함</span>
  <span style="font-size:var(--fs-11);color:var(--i4)">${escapeHtml(label)} — 보고 넘어간 건이에요. 금액이나 접수가 또 바뀌면 다시 알려드려요.</span>
  <button class="btn bs" style="margin-left:auto;font-size:var(--fs-11)"
    onclick="unackExhAlert('${escAttr(x.id)}','${which}')">되돌리기</button></div>`;

export function ackExhAlert(exhId, which){
  const x = getExhibitorById(exhId);
  if(!x) return;
  const token = which === 'gap'
    ? (() => { const g = invoiceGap(exhId); return g ? gapAckToken(g) : ''; })()
    : (() => { const r = needsReissue(exhId); return r ? reissueAckToken(r) : ''; })();
  if(!token) return;
  patchExh(exhId, { [which === 'gap' ? 'gap_ack' : 'reissue_ack']: token },
    which === 'gap' ? '추가 발행 알림 확인' : '재발행 알림 확인');
}
export function unackExhAlert(exhId, which){
  patchExh(exhId, { [which === 'gap' ? 'gap_ack' : 'reissue_ack']: '' }, '알림 되돌리기');
}

/* 접수 경로 — 엑스렌탈은 성격이 다르다. 나머지는 «우리한테 이렇게 들어왔다»인데
   엑스렌탈은 «우리를 거치지 않고 거기서 직접 받아 결제까지 끝났다»는 뜻이다.
   돈은 우리 입금으로 잡되(카드 결제와 같다), 인보이스는 엑스렌탈이 발행하므로
   우리가 한 장 더 낼 이유가 없다 — 정산 경고가 그걸 알아야 한다. */
export const EXRENTAL_CHANNEL = '엑스렌탈';
const APP_CHANNELS = [['신청서', '신청서로 접수'], ['메일', '메일로 접수'],
  ['유선', '유선으로 접수'], ['현장', '현장에서 접수'],
  [EXRENTAL_CHANNEL, '엑스렌탈로 접수']];
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
  if(!await window.addRow(EXH_APPS, rec, saveExhApp)) return;
  exhDrUi.lastItemCat = null;   // 새 접수 건은 분류부터 다시 고른다 — 지난 분류가 남아 엉뚱한 칸에 들어가지 않게
  /* 최초 접수는 체크리스트가 보는 칸도 함께 채운다 — 두 곳이 갈라지지 않게. */
  const x = getExhibitorById(exhId);
  await syncAppReceived(exhId, true);
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
    ITEM_FIELDS.forEach(k => { keep[k] = window.val(`it-${k}-${exhId}`); });
    const catalogId = document.getElementById(`it-nm-${exhId}`)?.dataset.catalogId || '';
    if(!keep.nm){ alert('항목명을 입력해주세요.'); return; }
    if(catalogPickMissing(exhId)) return;   // 빈 접수만 열리고 끝나지 않게 먼저 본다

    await addExhApp(exhId, { channel: '신청서' });
    if(!openAppFor(exhId)) return;

    ITEM_FIELDS.forEach(k => {
      const el = document.getElementById(`it-${k}-${exhId}`);
      if(el && keep[k]) el.value = keep[k];
    });
    const nm = document.getElementById(`it-nm-${exhId}`);
    if(nm && catalogId) nm.dataset.catalogId = catalogId;
  }
  return window.addExhItem(exhId);
}

/* ── «신청서 수신»은 접수 이력이 정한다 ──
   한 번이라도 접수가 있으면 받은 것이고, 날짜는 가장 이른 접수일이다. 예전에는
   체크 칸을 따로 눌러야 해서 이력은 있는데 체크가 빠지거나, 이력을 지웠는데
   체크가 남았다. 체크리스트·진행표가 app_received(_at)를 보므로 칸 자체는 두고
   이력에 맞춰 채운다. 이력이 하나도 없는 옛 기업은 손대지 않는다 — 접수 이력이
   생기기 전에 체크만 해 둔 기록이 날아가면 안 된다. */
async function syncAppReceived(exhId, hadApps){
  const x = getExhibitorById(exhId);
  if(!x) return;
  const dates = appsFor(exhId).map(a => String(a.received_at || '').trim()).filter(Boolean).sort();
  const any = appsFor(exhId).length > 0;
  if(!any && !hadApps) return;
  const want = any ? { app_received: 'yes', app_received_at: dates[0] || x.app_received_at || td() }
                   : { app_received: '', app_received_at: '' };
  if((x.app_received || '') === want.app_received && (x.app_received_at || '') === want.app_received_at) return;
  await patchExh(exhId, want, '신청서 수신');
}
const appExhId = (id) => EXH_APPS.find(a => a.id === id)?.exhibitor_id;

export async function setAppField(id, field, value){
  await window.setRowField(EXH_APPS, saveExhApp, '신청서 접수', id, field, value);
  if(field === 'received_at'){ const e = appExhId(id); if(e) await syncAppReceived(e, true); }
}
export async function delExhApp(id){
  const e = appExhId(id);
  await window.removeRow(EXH_APPS, id, deleteExhApp, '신청서 접수', 'exhibitor_apps');
  if(e) await syncAppReceived(e, true);
}

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
  await window.setRowField(EXH_APPS, saveExhApp, '신청서 접수', appId, 'summary',
    lines.length ? lines.join(' · ') : '품목 변경 없음');
  await window.setRowField(EXH_APPS, saveExhApp, '신청서 접수', appId, 'handler', who);
  await window.setRowField(EXH_APPS, saveExhApp, '신청서 접수', appId, 'handled_at', td());
  refreshExhViews();
}
export const reopenExhApp = (appId) =>
  window.setRowField(EXH_APPS, saveExhApp, '신청서 접수', appId, 'handled_at', '');

/* 품목을 취소한다. 지우지 않고 내린다 — 이미 나간 인보이스가 왜 그 금액이었는지
   설명할 수 있어야 한다. 발주·정산·대장에서는 빠진다. */
/* 취소하면서 덮어쓴 회차·변경 종류. 되살릴 때 «N차 취소» 배지가 남으면 살아 있는
   품목이 취소된 것처럼 보인다 — 이 창에서 취소한 것이면 원래 값으로 돌린다.
   (칸을 새로 두지 않아 새로고침 뒤엔 남지 않는다 — 그땐 아래 대체 규칙을 쓴다) */
const voidMemo = {};
export async function voidExhItem(id){
  const i = EXH_ITEMS.find(r => r.id === id);
  if(!i) return;
  if(isVoided(i)){
    if(!await window.setItemField(id, 'voided_at', '')) return;   // 못 되살렸으면(잠금·실패) 배지도 그대로
    if(i.change_kind === '취소'){
      const m = voidMemo[id];
      if(m){
        if((i.app_id || '') !== m.app_id) await window.setItemField(id, 'app_id', m.app_id);
        await window.setItemField(id, 'change_kind', m.change_kind);
      } else {
        // 원래 값을 모르면 «취소»만 걷는다 — 수량·금액을 고친 흔적이 있으면 «변경»
        await window.setItemField(id, 'change_kind', (i.prev_qty || i.prev_amount) ? '변경' : '');
      }
    }
    delete voidMemo[id];
    return;
  }
  if(!confirm(`"${i.name}"을(를) 취소 처리할까요?\n지우지 않고 내려서 이력은 남습니다.`)) return;
  const open = openAppFor(i.exhibitor_id);
  if(open){
    voidMemo[id] = { app_id: i.app_id || '', change_kind: i.change_kind || '' };
    await window.setItemField(id, 'app_id', open.id); await window.setItemField(id, 'change_kind', '취소');
  }
  await window.setItemField(id, 'voided_at', td());
}

/* 접수 이름 — 현장에서 받은 건 차수 대신 «현장» */
export function appSeqLabel(a){ return a.channel === '현장' ? '현장' : `${a.seq}차`; }

/* 품목이 몇 차 접수에서 어떻게 됐는지 — 이름 옆 배지 */
export function appMark(i){
  if(!i.app_id) return '';
  const a = EXH_APPS.find(r => r.id === i.app_id);
  if(!a) return '';
  const cls = i.change_kind === '취소' ? 'p-red' : i.change_kind === '변경' ? 'p-amber' : 'p-teal';
  return ` <span class="pill ${cls}" style="font-size:var(--fs-9)" title="${escapeHtml(
    `${a.seq}차 · ` + (a.received_at || '') + (a.reason ? ' · ' + a.reason : ''))}">${escapeHtml(appSeqLabel(a))} ${escapeHtml(i.change_kind || '추가')}</span>`;
}

/* ── 이 회차에서 무엇이 달라졌나 ──

   전에는 열린 회차에만 «+ G-020 랩핑 1개 추가» 같은 글줄이 떴고, 반영을 끝내면
   요약 한 줄로 굳었다. 그래서 «2차에서 뭘 넣었더라»를 보려면 정산 탭으로 건너가
   배지를 눈으로 훑어야 했고, 잘못 넣은 줄은 거기서 고쳐야 했다.

   회차 안에 그 줄들을 그대로 펴 둔다. 열려 있으면 수량·금액을 그 자리에서 고치고
   취소까지 할 수 있고, 닫힌 회차는 읽기만 된다 — 반영을 끝낸 기록이 조용히
   바뀌면 «몇 차에 무엇이 늘었나»가 사실과 어긋난다. */
function appItemRows(a, x, live){
  const rows = itemsFor(x.id).filter(i => i.app_id === a.id);
  if(!rows.length) return live
    ? '<div style="font-size:var(--fs-11);color:var(--i4);margin-top:6px">아직 넣은 품목이 없어요 — 아래 줄에서 넣으면 여기에 쌓입니다.</div>'
    : '';

  const mark = (i) => i.change_kind === '취소' ? ['−', 'p-red', '취소']
    : i.change_kind === '변경' ? ['~', 'p-amber', '변경'] : ['+', 'p-teal', '추가'];

  return `<div style="margin-top:6px;padding:6px 8px;background:var(--W);border-radius:var(--rd-6);display:flex;flex-direction:column;gap:3px">
    <div style="font-size:var(--fs-10_5);color:var(--i4)">이 회차 ${rows.length}건${
      live ? '' : ' — 고치려면 <b>다시 열기</b>를 누르세요'}</div>
    ${rows.map(i => { const [sg, cls, lbl] = mark(i); const dead = isVoided(i);
      return `<div style="display:flex;align-items:center;gap:6px;font-size:var(--fs-11_5)${
        dead ? ';opacity:.55' : ''}">
        <span class="pill ${cls}" style="font-size:var(--fs-9);min-width:34px;text-align:center">${lbl}</span>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${
          dead ? ';text-decoration:line-through' : ''}" title="${escapeHtml(i.name || '')}">${sg} ${escapeHtml(i.name || '')}</span>
        ${live ? `<input class="fi" style="width:52px;font-size:var(--fs-11);padding:3px 5px" value="${escapeHtml(i.qty || '')}"
            placeholder="수량" onchange="setItemFieldDirect('${escAttr(i.id)}','qty',this.value)">
          <input class="fi" style="width:86px;font-size:var(--fs-11);padding:3px 5px;text-align:right" value="${escapeHtml(i.amount || '')}"
            placeholder="금액" onchange="setItemFieldDirect('${escAttr(i.id)}','amount',this.value)">
          <button class="btn bs" style="font-size:var(--fs-10_5);padding:2px 7px" onclick="voidExhItem('${escAttr(i.id)}')"
            title="${dead ? '취소를 되돌립니다' : '지우지 않고 내립니다 — 이력은 남아요'}">${dead ? '되돌리기' : '취소'}</button>`
        : `<span style="color:var(--i4)">${escapeHtml(i.qty || '')}${i.qty && i.amount ? ' · ' : ''}${
            i.amount ? escapeHtml(money(i.amount)) : ''}</span>`}
      </div>`; }).join('')}
  </div>`;
}

/* ── 지금 살아 있는 내역 ──

   회차별로 더한 것과 뺀 것을 눈으로 합산해야 «그래서 최종이 뭔데»가 나왔다.
   취소된 줄을 걷어낸 지금 상태를 한자리에 둔다. 열린 회차가 있으면 여기서
   바로 내릴 수 있다 — 2차를 열어 두고 1차에 넣었던 것을 빼는 게 실제 흐름이다. */
function appFinalRows(x){
  /* 부스에 딸려 오는 것은 여기 세지 않는다 — 기업이 신청한 게 아니라 부스를
     고르면 당연히 따라오는 것이라, 신청 내역에 섞이면 «이것도 신청했나»를
     신청서와 맞춰 보게 된다. 무엇이 딸려 오는지는 비품 현황의 «기본» 탭이
     말해 준다. */
  const live = liveItemsFor(x.id).filter(i => !isBoothGiven(i));
  const open = openAppFor(x.id);
  if(!live.length) return '';
  const cur = currencyOf(x.id);
  const sum = live.filter(isBillable).reduce((t, i) =>
    t + (Number(String(i.amount || '').replace(/[^0-9.-]/g, '')) || 0), 0);

  return `<div style="margin-top:10px;border:1px solid var(--i7);border-radius:var(--r);padding:8px 10px">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
      <span style="font-size:var(--fs-11_5);font-weight:700">지금 내역 ${live.length}건</span>
      <span style="font-size:var(--fs-11);color:var(--i4)">취소한 건 빼고 남은 것이에요</span>
      <span style="margin-left:auto;font-size:var(--fs-12);font-weight:700">${escapeHtml(fmtMoney(sum, cur))}</span>
    </div>
    ${live.map(i => `<div style="display:flex;align-items:center;gap:6px;font-size:var(--fs-11_5);padding:2px 0">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
        title="${escapeHtml(i.name || '')}">${escapeHtml(i.name || '')}${appMark(i)}</span>
      <span style="color:var(--i4)">${escapeHtml(i.qty || '')}</span>
      <span style="min-width:76px;text-align:right">${i.amount ? escapeHtml(money(i.amount)) : '-'}</span>
      ${open ? `<button class="btn bs" style="font-size:var(--fs-10_5);padding:2px 7px" onclick="voidExhItem('${escAttr(i.id)}')"
        title="${escapeHtml(open.seq + '차 접수에 취소로 기록됩니다')}">취소</button>` : ''}
    </div>`).join('')}
    ${!open ? `<div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:4px">빼려면 접수를 하나 열어야 해요 — 몇 차에서 뺐는지가 남아야 하니까요.</div>` : ''}
  </div>`;
}

/* 접수 이력 화면 */
function appsSection(x){
  const list = appsFor(x.id);
  const open = openAppFor(x.id);
  const add = `<div style="display:flex;gap:6px;flex-wrap:wrap">
    ${APP_CHANNELS.map(([c, l]) => `<button class="btn bs" onclick="addExhApp('${escAttr(x.id)}',{channel:'${c}'})">+ ${l}</button>`).join('')}
  </div>`;


  /* 품목 넣는 줄은 열린 회차 카드 안에 둔다 — 넣은 품목이 쌓이는 곳이 그 카드라,
     밖에 두면 «어느 회차에 들어가나»를 윗줄 글로 따로 읽어야 했다.

     전에는 카드 안에서 항목명 칸이 113px까지 쪼그라들어 밖으로 뺐는데, 그건
     입력 줄이 목록 줄의 분류 배지 칸(72px)에 항목명을 넣던 탓이었다
     (components.css .bl-item-add). 그걸 고친 뒤로는 카드 안에서도 이름 칸이 넓다. */
  /* 추가 줄은 늘 보인다.

     처음에는 회차를 먼저 열어야 줄이 나타나게 했는데, 하나 넣자고 접수 단추를
     고르고 → 줄이 생기길 기다리고 → 적는 세 걸음이 됐다. 품목 하나 넣는 일은
     하루에도 여러 번이라 그 한 걸음이 그대로 짐이 된다.

     줄은 늘 두고, 회차가 없으면 단추가 «접수 열고 추가»가 된다 — 누르면 오늘
     날짜로 접수를 하나 열고 거기에 넣는다. 모든 품목이 회차에 묶인다는 규칙은
     그대로면서 누르는 횟수만 줄었다. 어느 회차에 들어갔는지는 바로 위 카드에
     그대로 보인다. */
  /* 접수 경로 단추가 맨 위 — 무엇으로 받았는지부터 고른다. 누르면 그 아래에
     분류(부스/비품/그래픽/기타)가 나오고, 분류를 고르면 그 분류의 품목 줄이 열린다.
     품목은 늘 열린 접수 건에 들어가므로, 열린 건이 없으면 분류도 보이지 않는다. */
  const xid = escAttr(x.id);
  const cur = open ? (exhDrUi.lastItemCat || '') : '';
  const picker = !open ? '' : `
    <div style="font-size:var(--fs-11);color:var(--a);margin:10px 0 6px">이 접수에 넣을 품목 — 분류를 고르세요</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap" id="it-cats-${xid}">
      ${window.itemCats().map(({ code: k, label: l }) => `<button class="btn bs${cur === k ? ' bp' : ''}" data-cat="${escapeHtml(k)}"
        onclick="pickItemCat('${xid}','${escAttr(k)}')">${escapeHtml(l)}</button>`).join('')}
    </div>
    <input type="hidden" id="it-cat-${xid}" value="${escapeHtml(cur)}">
    <div class="bl-row bl-item-add" id="it-row-${xid}" style="margin-top:6px;${cur ? '' : 'display:none'}">
      <input class="fi" id="it-nm-${xid}" placeholder="항목명" style="flex:1 1 120px;min-width:0;font-size:var(--fs-11_5);padding:6px"
        ${cur ? `list="${itemListId(x, cur)}"` : ''} oninput="pickCatalogItem('${xid}')">
      ${catalogDatalist(x)}${window.designTargetList(x)}
      <input class="fi" id="it-qty-${xid}" placeholder="수량" style="flex:1 1 54px;min-width:0;font-size:var(--fs-11_5);padding:6px"
        oninput="calcItemAmount('${xid}')">
      <input class="fi" id="it-up-${xid}" placeholder="단가" style="flex:1 1 78px;min-width:0;font-size:var(--fs-11_5);padding:6px"
        oninput="calcItemAmount('${xid}')">
      <input class="fi" id="it-amt-${xid}" placeholder="금액" style="flex:1 1 88px;min-width:0;font-size:var(--fs-11_5);padding:6px;text-align:right">
      <select class="fi bl-cur" id="it-cur-${xid}" onchange="rememberItemCur(this.value)">
        ${window.currencies().map(c => `<option value="${c}"${(exhDrUi.lastItemCur || currencyOf(x.id)) === c ? ' selected' : ''}>${c}</option>`).join('')}</select>
      <button class="btn bp bs" style="flex:0 0 auto" onclick="addItemHere('${xid}')">추가</button>
    </div>`;
  const rows = list.map(a => {
    const live = !String(a.handled_at || '').trim();
    const diff = live ? appDiffLines(a.id, x.id) : [];
    return `<div style="border:1px solid ${live ? 'var(--a)' : 'var(--i7)'};border-radius:var(--r);padding:9px 10px;margin-bottom:6px;background:${live ? 'var(--ad)' : 'var(--W)'}">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="pill ${a.kind === '최초' ? 'p-blue' : a.kind === '취소' ? 'p-red' : 'p-amber'}">${escapeHtml(appSeqLabel(a))} · ${escapeHtml(a.kind || '')}</span>
        <select class="fi" style="width:auto;font-size:var(--fs-11);padding:3px 6px"
          title="접수 경로 — 엑스렌탈은 거기서 직접 청구·수금한 건이에요"
          onchange="setAppField('${escAttr(a.id)}','channel',this.value)">${
          APP_CHANNELS.map(([c]) => `<option value="${escapeHtml(c)}"${(a.channel || '') === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}${
          APP_CHANNELS.some(([c]) => c === (a.channel || '')) ? '' : `<option value="${escapeHtml(a.channel || '')}" selected>${escapeHtml(a.channel || '')}</option>`}</select>
        <input type="date" class="fi" style="width:132px;font-size:var(--fs-11)" value="${escapeHtml(a.received_at || '')}"
          onchange="setAppField('${escAttr(a.id)}','received_at',this.value)">
        ${live ? '<span class="pill p-amber">반영 중</span>'
               : `<span style="font-size:var(--fs-10_5);color:var(--i4)">반영 ${escapeHtml(a.handled_at)}${a.handler ? ' · ' + escapeHtml(a.handler) : ''}</span>`}
        <span style="margin-left:auto;display:flex;gap:4px">
          ${live ? `<button class="btn bs" onclick="closeExhApp('${escAttr(x.id)}','${escAttr(a.id)}')">반영 완료</button>`
                 : `<button class="btn bs" onclick="reopenExhApp('${escAttr(a.id)}')">다시 열기</button>`}
          <button class="btn bs" onclick="delExhApp('${escAttr(a.id)}')">삭제</button>
        </span>
      </div>
      <input class="fi" style="margin-top:6px;font-size:var(--fs-11_5)" placeholder="왜 다시 받았나요 — 예: 프북 수정, 전시패스 추가"
        value="${escapeHtml(a.reason || '')}" onchange="setAppField('${escAttr(a.id)}','reason',this.value)">
      ${a.file_name ? `<div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:4px">📄 ${escapeHtml(a.file_name)}</div>` : ''}
      ${appItemRows(a, x, live)}
      ${live && open && a.id === open.id ? picker : ''}

      ${!live && a.summary ? `<div style="font-size:var(--fs-11);color:var(--i3);margin-top:5px">${escapeHtml(a.summary)}</div>` : ''}
    </div>`;
  }).join('');

  const top = add;
  if(!list.length) return sct('신청서 접수 이력',
    top + `<div style="font-size:var(--fs-11_5);color:var(--i4);margin-top:8px">아직 접수 기록이 없어요. 받은 경로를 누르면 접수가 열리고 품목을 넣을 수 있어요.</div>`);

  return sct('신청서 접수 이력', top + `<div style="margin-top:10px">${rows}</div>` + appFinalRows(x),
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
    `<div style="font-size:var(--fs-11_5);color:var(--i5);padding:8px 2px">
      청구할 금액 항목이 아직 없어요 — 위에서 신청 내역을 금액 항목으로 옮기거나
      <b>정산</b> 탭에서 항목을 넣으면 여기서 바로 발행할 수 있어요.</div>`);

  return sct('인보이스 발행', `
    <div style="padding:8px 10px;background:var(--i9);border-radius:var(--rd-7);margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <span style="font-size:var(--fs-11);color:var(--i4)">담길 내용</span>
        <b style="font-size:var(--fs-13)">${curs.map(c => escapeHtml(fmtMoney(by[c], c))).join(' + ')}</b>
      </div>
      <div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:3px">
        청구 항목 ${items.length}건${curs.length > 1
          ? ` · 통화가 <b>${curs.join(' / ')}</b>로 갈려 있어 ${curs.length}장으로 나눠 발행해요` : ''}</div>
    </div>
    ${invs.length ? `<div style="font-size:var(--fs-11);color:var(--am);margin-bottom:8px">
      이미 발행한 인보이스가 ${invs.length}장 있어요 — 누르면 <b>새 번호로 한 장 더</b> 만듭니다.
      금액만 고쳐 다시 보내는 거라면 옛 건을 <b>정산</b> 탭에서 무효로 두세요.</div>` : ''}
    <button class="btn bp" id="inv-issue-${escAttr(x.id)}" onclick="issueExhInvoice('${escAttr(x.id)}')"
      title="인보이스 줄을 만들고 양식을 채워 저장합니다">인보이스 발행${curs.length > 1 ? ` (${curs.length}장)` : ''}</button>
    <div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:7px">
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
          <input class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(x.fascia_name || '')}"
            placeholder="${escapeHtml(bookName(x).en || '게재 영문명이 없어요')}"
            title="비우면 프로그램북 게재 영문명을 그대로 씁니다 — 간판만 다르면 여기에 적으세요"
            onchange="setExhField('${escAttr(x.id)}','fascia_name',this.value,'간판명')">
          ${fasciaName(x)
            ? `<div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:3px">간판에 나갈 이름 — <b>${escapeHtml(fasciaName(x))}</b>${
                x.fascia_name ? ' (간판만 따로 적음)' : ' (프로그램북 게재 영문명)'}</div>`
            : '<div style="font-size:var(--fs-10_5);color:var(--re);margin-top:3px">게재 영문명이 비어 있어 간판을 만들 수 없어요 — 프로그램북 탭에서 넣거나 여기에 직접 적으세요.</div>'}</div>
        <div class="fg"><label class="fl">간판명 확정</label>
          <input type="date" class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(baseRecvAt(x))}"
            onchange="setBaseRecvAt('${escAttr(x.id)}',this.value)"></div>`
      /* 이 날짜는 그래픽 현황의 «받을 파일»과 같은 자리다 — 기본 제공 그래픽
         항목의 받은 날을 읽고 쓴다. 두 화면이 각자 적던 시절에는 한쪽이 받음,
         다른 쪽이 미수령이었다. */
      : `<div class="fg"><label class="fl">디자인 수령일</label>
          <input type="date" class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(baseRecvAt(x))}"
            onchange="setBaseRecvAt('${escAttr(x.id)}',this.value)">
          ${baseRecvItems(x).length
            ? `<div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:3px">그래픽 탭의 «${
                escapeHtml(baseRecvItems(x).map(i => i.name || '').filter(Boolean).join(' · '))}»와 같은 칸이에요</div>`
            : ''}</div>`)
    + `<div class="fg"><label class="fl">${escapeHtml(v.done)}</label>
        <div style="padding:3px 0">${baseDoneCheck(x)}</div></div>
      <div class="fg"><label class="fl">비고</label>
        <input class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(x.base_note || '')}"
          placeholder="색상·재질·시공 메모" onchange="setExhField('${escAttr(x.id)}','base_note',this.value,'기본 시공 비고')"></div>
      <div style="font-size:var(--fs-10_5);color:var(--i5)">추가 발주가 아니라 계약에 들어 있는 항목이에요 — 기업이 조용해도 우리가 만들어 세웁니다.</div>`);
}

/* 참가 범위 — 체크리스트 맨 앞에 둔다. 아래 칸이 전부 비어 있는 까닭이
   여기 적혀 있어야, 다음 사람이 "빠뜨렸나" 하고 채우려 들지 않는다.

   대표 기업은 같은 행사의 참가기업 중에서 고른다. 이름을 손으로 적게 하면
   표기가 갈려서 나중에 누구 부스인지 되짚을 수 없다. */
function scopeBlock(x){
  const book = isBookOnly(x);
  /* 모기업은 진행 탭(과 부스 현황)에서만 고른다 — 신청서에 무엇을 받았는지와는
     상관없는 묶음 정보라, 신청항목 탭에 같은 칸이 또 있으면 어디가 정본인지 헷갈린다. */
  return sct('참가 범위', `
    <div class="fg"><label class="fl">유형</label>
      <select class="fi" style="font-size:var(--fs-12)"
        onchange="setExhField('${escAttr(x.id)}','scope',this.value,'참가 범위')">
        <option value=""${book ? '' : ' selected'}>전체 진행 — 매뉴얼부터 현장까지</option>
        <option value="book"${book ? ' selected' : ''}>프로그램북만 — 받을 것이 도록뿐</option>
      </select>
      <div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:3px">
        «프로그램북만»으로 두면 도록 외 단계는 <b>해당 없음</b>이 되고 부스 수에서도 빠집니다.
        지우는 게 아니라 집계에서 빼는 것이라, 유형을 되돌리면 적어 둔 값이 그대로 살아납니다.</div></div>`);
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
  ${(() => {
    /* 부스에 딸려 오는 품목이 아직 안 들어간 기업 — 부스 타입이 바뀔 때만 깔다
       보니, 이미 부스가 정해져 있던 기업은 통째로 비어 있다. 여기서 넣게 한다. */
    const p = boothItemsPending(x.id);
    return p ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;
        background:var(--ad);border:1px solid var(--a);border-radius:var(--r);padding:8px 11px">
      <span style="font-size:var(--fs-11_5);color:var(--i2);flex:1;min-width:0">
        <b>${escapeHtml(p.type)}</b>에 기본으로 딸려 오는 품목 ${p.want.length}건이 아직 안 들어갔어요 —
        ${escapeHtml(p.want.map(o => [o.code, o.name].filter(Boolean).join(' ')).join(', '))}</span>
      <button class="btn bp bs" style="flex:0 0 auto"
        onclick="applyBoothItems('${escAttr(x.id)}','${escAttr(x.booth_type || '')}')">지금 넣기</button>
    </div>` : '';
  })()}
  ${appsSection(x)}

  ${sct('신청서',
    /* 수신 여부는 위 접수 이력이 정한다 — 따로 누르는 칸을 두지 않는다 */
    `<div style="font-size:var(--fs-11_5);color:var(--i4);padding:2px 0">${x.app_received_at
      ? `신청서 수신 ${escapeHtml(x.app_received_at)} — 첫 접수일 기준으로 자동 표시돼요`
      : '아직 받은 신청서가 없어요 — 위에서 접수를 열면 자동으로 수신 처리돼요'}</div>` +
    `<div style="padding:10px 0 2px">
      <label class="fl">필수정보 완비 여부</label>
      <div class="stbs" style="margin:4px 0 8px">
        ${[['', '미확인'], ['yes', '완비'], ['no', '누락 있음']].map(([v, l]) =>
          `<button class="stb${(x.app_complete || '') === v ? ' on' : ''}" onclick="setExhField('${escAttr(x.id)}','app_complete','${v}','신청서 정보 확인')">${l}</button>`).join('')}
      </div>
      ${x.app_complete === 'no' ? textRow(x, 'app_missing', '누락 항목 — 무엇이 비었나요', '예: 사업자등록증, 로고 파일') : ''}
    </div>`,
    appIssue ? '<span class="pill p-amber">정보 누락</span>' : '')}

  ${sct('부스 기본 제공', window.boothGivenBlock(x), (() => {
    const rows = itemsFor(x.id).filter(isBoothGiven);
    const ex = rows.filter(isBoothExc).length;
    return rows.length
      ? `<span class="pill p-gray">${rows.filter(i => !isVoided(i)).length}종</span>${
          ex ? `<span class="pill p-amber">예외 ${ex}</span>` : ''}`
      : '';
  })())}

  ${sct('추가 비품 신청',
    textRow(x, 'extra_equipment', '신청 내역 (받은 그대로)', '예: 추가 테이블 2, 전기 3kW', true) +
    `<button class="btn bs" onclick="addItemFromEquip('${escAttr(x.id)}')" style="margin-top:2px">이 내역을 비품 금액 항목으로 추가</button>`)}

  ${invoiceIssueSection(x)}

  ${sct('등록된 비품', items.length
    ? `<div style="display:flex;flex-direction:column;gap:1px">
        ${items.map(i => `<div class="bl-row bl-item" style="padding:6px 8px;background:var(--i9);border-radius:var(--rd-6)">
          <span class="pill p-gray" style="text-align:center">비품</span>
          <span style="min-width:0;font-size:var(--fs-12);font-weight:600;word-break:break-all">${escapeHtml(i.name || '')}</span>
          <span class="bl-qty">${escapeHtml(i.qty || '')}${
            i.unit_price ? `<span class="bl-up">${i.qty ? ' × ' : ''}${money(i.unit_price)}</span>` : ''}</span>
          <span class="bl-amt">${fmtMoney(i.amount, i.currency || 'KRW')}</span>
          <span></span><span></span>
        </div>`).join('')}
      </div>
      <div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:7px">금액을 고치거나 항목을 더하려면 <b>정산</b> 탭에서 하세요</div>`
    : '<div style="font-size:var(--fs-11_5);color:var(--i5);padding:8px 2px">아직 등록된 비품이 없어요</div>',
    (items.length ? `<span class="pill p-gray">${items.length}종</span>` : '')
    /* 이 기업 한 장만 — 현장에서 다시 뽑거나 신청이 바뀐 곳만 갈아 끼울 때.
       출력은 exh-export.js가 한다(window 경유 — 인보이스 발행과 같은 이유) */
    + `<button class="btn bs bl-mini" style="margin-left:auto" onclick="printBoothEquipSheets('${escAttr(x.id)}')"
        title="이 기업의 비품(X배너 포함)·금액을 영문 A4 한 장으로 뽑습니다 — 부스에 넣어 두는 용도. 미납액이 남았으면 합계에 *">부스 비치용 출력</button>`)}
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
      띄어쓰기 포함 <b style="font-size:var(--fs-13)">${o.chars}</b>자 · <b style="font-size:var(--fs-13)">${o.words}</b>단어</span>
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
  /* 행사마다 새로 받는 값이라 기업 DB 값을 미리 채우지 않는다 — 대신 칸마다
     기업 DB와 맞는지 색으로 보여 준다(syncTag). */
  const known = (f, orgKey, label) => syncTag(x, f, getOrgById(x.org_id), orgKey, label);
  const ORG_OF = { book_address: 'address', book_website: 'website' };
  const row = (f, label, ph) => `<div class="fg"><label class="fl">${escapeHtml(label)}</label>
    <input class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(x[f] || '')}" placeholder="${escapeHtml(ph)}"
      onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr(label)}')">
    ${ORG_OF[f] ? known(f, ORG_OF[f], label) : ''}</div>`;

  return `
  ${sct('게재 정보', `
    ${miss.length
      ? `<div style="font-size:var(--fs-11_5);color:var(--am);background:var(--ab);padding:7px 9px;border-radius:var(--rd-6);margin-bottom:10px">
          아직 못 받은 항목 ${miss.length}개 — <b>${escapeHtml(miss.join(', '))}</b></div>`
      : `<div style="font-size:var(--fs-11_5);color:var(--g);background:var(--gb);padding:7px 9px;border-radius:var(--rd-6);margin-bottom:10px">
          도록에 낼 정보가 모두 채워졌어요</div>`}
    <div class="fgr">
      <div class="fg"><label class="fl">게재 국문명</label>
        <input class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(x.book_name_ko || '')}"
          placeholder="${escapeHtml(bookName(x).ko)}"
          title="비우면 CRM 이름을 그대로 씁니다 — 신청서 표기가 다르면 여기에 적으세요"
          onchange="setExhField('${escAttr(x.id)}','book_name_ko',this.value,'게재 국문명')"></div>
      <div class="fg"><label class="fl">게재 영문명</label>
        <input class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(x.book_name_en || '')}"
          placeholder="${escapeHtml(bookName(x).en)}"
          onchange="setExhField('${escAttr(x.id)}','book_name_en',this.value,'게재 영문명')"></div>
    </div>
    <div style="font-size:var(--fs-10_5);color:var(--i5);margin:-4px 0 8px">
      도록과 <b>기본부스 간판</b>에 실제로 나가는 이름이에요. 비우면 CRM 이름을 씁니다.</div>
    <div class="fgr">
      <div class="fg"><label class="fl">게재 순서</label>
        <input class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(x.book_order || '')}" placeholder="예: 1"
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
    <textarea class="fi" id="bk-intro-${escAttr(x.id)}" rows="8" style="font-size:var(--fs-12_5);line-height:1.7"
      placeholder="도록에 실을 회사소개를 붙여넣으세요"
      oninput="drawIntroMeter('${escAttr(x.id)}')"
      onchange="setExhField('${escAttr(x.id)}','book_intro',this.value,'회사소개')">${escapeHtml(x.book_intro || '')}</textarea>
    <div id="bk-meter-${escAttr(x.id)}" style="font-size:var(--fs-11_5);margin-top:6px">${introMeter(x.book_intro, x.event_id)}</div>
    ${known('book_intro', 'intro', '회사소개')}`,
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
        <input class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(x.booth_no || '')}"
          onchange="setExhField('${escAttr(x.id)}','booth_no',this.value,'부스 번호')"></div>
      <div class="fg"><label class="fl">층</label>
        <input class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(x.booth_floor || '')}"
          onchange="setExhField('${escAttr(x.id)}','booth_floor',this.value,'부스 층')"></div>
    </div>
    <div class="fgr">
      <div class="fg"><label class="fl">부스 타입</label>
        <select class="fi" style="font-size:var(--fs-12)" onchange="setExhField('${escAttr(x.id)}','booth_type',this.value,'부스 타입')">
          ${boothTypeOptions(x.booth_type)}
        </select></div>
      <div class="fg"><label class="fl">수량</label>
        <input class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(x.booth_qty || '')}"
          onchange="setExhField('${escAttr(x.id)}','booth_qty',this.value,'부스 수량')"></div>
    </div>
    <div class="fg"><label class="fl">스폰서 등급</label>
      <select class="fi" style="font-size:var(--fs-12)" onchange="setExhField('${escAttr(x.id)}','grade',this.value,'등급')">
        <option value=""${x.grade ? '' : ' selected'}>— 없음 —</option>${grades(x.event_id).map(g => `<option value="${escapeHtml(g.code)}"${(x.grade || '') === g.code ? ' selected' : ''}>${escapeHtml(g.label)}</option>`).join('')}
      </select></div>
    <div class="fg"><label class="fl">모기업</label>
      <select class="fi" style="font-size:var(--fs-12)"
        onchange="setExhField('${escAttr(x.id)}','host_key',this.value,'모기업')">${hostOptions(x)}</select>
      <div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:3px">예하 기업이면 모기업을 고르세요 — 부스 현황에서 모기업 바로 아래 줄로 붙습니다.</div></div>` +
    `<div style="padding:8px 0 2px">
      <label style="display:flex;align-items:flex-start;gap:7px;cursor:pointer">
        <input type="checkbox" ${isSharedBooth(x) ? 'checked' : ''}
          onchange="toggleSharedBooth('${escAttr(x.id)}')" style="margin-top:2px">
        <span>
          <span style="font-size:var(--fs-12);font-weight:600">공동 부스 — 부스 수에서 뺀다</span>
          <span style="display:block;font-size:var(--fs-10_5);color:var(--i5);margin-top:2px">
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
        <input class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(x.badge_count || '')}"
          onchange="setExhField('${escAttr(x.id)}','badge_count',this.value,'출입증')"></div>
      <div class="fg"><label class="fl">출입증 발급일</label>
        <input type="date" class="fi" style="font-size:var(--fs-12)" value="${escapeHtml(x.badge_issued_at || '')}"
          onchange="setExhField('${escAttr(x.id)}','badge_issued_at',this.value,'출입증 발급')"></div>
    </div>` +
    textRow(x, 'onsite_note', '현장 메모', '', true))}

  ${sct('기타', textRow(x, 'note', '메모', '', true) +
    `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--i8);display:flex;align-items:center;gap:9px">
      <span style="font-size:var(--fs-11_5);color:var(--i4);flex:1">${x.status === CANCELLED
        ? '참가 취소된 기업이에요. 기록은 그대로 남아있어요.'
        : '참가가 취소되면 목록에서 빼되 기록은 남겨둬요.'}</span>
      <button class="btn bs" onclick="toggleExhCancel('${escAttr(x.id)}')">${x.status === CANCELLED ? '취소 해제' : '참가 취소 처리'}</button>
    </div>`)}
  `;
}


/* 화면의 onclick이 부르는 것 */
window.dApply = dApply;   // 탭(exh-drawer.js)이 window로 부른다
window.dProgress = dProgress;   // 탭(exh-drawer.js)이 window로 부른다
window.dBook = dBook;   // 탭(exh-drawer.js)이 window로 부른다
