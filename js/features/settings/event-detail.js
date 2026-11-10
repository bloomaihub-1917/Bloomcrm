/* ══════════════════════════════════════════════════════════════
   features/settings/event-detail.js — 설정 › 행사 관리 › 행사 상세
   (modules/settings-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { saveEventToSheet } from '../../api.js';
import { saveExhCfgToSheet } from '../../api/settings-save.js';
import { deleteMailAccount, eventMailFrom, loadMailAccounts, loadMailFiles, loadMailFooter, mailFilesOf, saveMailAccount, saveMailFooter, testMailAccount } from '../../api/mail-send.js';
import { EVENT_PARTS, PART_STATES, partStateOf } from '../../constants.js';
import { changed, trackAction } from '../../core/audit-log.js';
import { exhMailFileStep, exhMailSteps } from '../../modules/exh-mail.js';
import { FOLLOW_DEFAULT, dueInputHtml, followCfg, readDueInput } from '../../shared/mail/follow-up.js';
import { isPending, isUnread, runMailSync } from '../../shared/mail/mail-mark.js';
import { CODE_LISTS, EQUIP_CATALOG, EVENT_LIST, EXHIBITORS, EXH_CFG, EXH_LOGS, SPEAKERS, SPEAKER_LOGS, applyCodeLists, evPartDone, evParts } from '../../state.js';
import { escAttr, escapeHtml } from '../../utils.js';
import { settingsUi } from './settings-ui.js';
import { DUE_LABEL } from '../../modules/settings-tab.js';
import { refreshAfterEventChange } from './taxonomy.js';
import { renderEvMgr } from './event-admin.js';
import { applyBoothItemsToEvent, clDef, clRowsHtml, clRowsOf, clSlug, renderEvCfgList, saveCodeRow } from './code-lists.js';
import { mountEquipCatalogIdle, openEquipFor } from './equip-catalog.js';
import { mountNametagEditor } from '../nametag/nt-editor.js';

/* ══════════════════════════════════════════
   행사 상세 설정 — 설정 › 행사 관리에서 행사 하나를 고르면 열린다

   전에는 행사 하나를 두고 정할 것이 세 군데에 흩어져 있었다. 행사 자체는 이 탭,
   부스 타입·스폰서 등급은 설정값 탭의 선택 목록, 비품 품목표는 그 아래, 마감일은
   전시 탭. "이 행사 설정 어디서 하죠"에 답을 하나로 만들려고 한자리에 모은다.

   목록과 상세는 같은 자리(arch-pane-ev)를 나눠 쓴다. 모달로 띄우지 않은 이유는
   안에 표가 들어가기 때문이다 — 470px 카드에 품목표를 넣으면 못 읽는다.

   저장 위치는 settings 시트의 exh_cfg_<행사키> 한 줄이다. 행사당 한 줄인 구조를
   그대로 두는 편이, 파트를 넣자고 events 테이블에 열을 늘리는 것보다 되돌리기 쉽다.
══════════════════════════════════════════ */

const EV_SEGS = [['basic','기본 정보'], ['parts','진행 파트'],
  ['booth','부스'], ['equip','비품'], ['due','일정'], ['conf','컨퍼런스'], ['mail','메일'], ['nametag','네임택']];

/* 전시를 안 하는 행사에서는 부스·비품·일정이 뜻이 없다. 감추지 않고 잠그는 건
   "왜 없지"로 끝나지 않게 하려는 것이다 — 켜는 자리를 같은 화면에서 알려준다. */
const EV_SEG_NEEDS_EXH = ['booth', 'equip', 'due'];
/* 세그먼트마다 어느 파트가 켜져 있어야 하는지 — 부스·비품·일정은 전시,
   컨퍼런스는 컨퍼런스. 감추지 않고 잠그는 건 «왜 없지»로 끝나지 않게 하려는 것이다. */
const EV_SEG_PART = { booth: 'exh', equip: 'exh', due: 'exh', conf: 'conf' };
const evSegLocked = (seg, parts) => {
  const need = EV_SEG_PART[seg];
  return !!need && parts[need] === 'none';
};
/* 잠금 안내에서 어느 파트를 켜라고 할지 */
const evSegPartLabel = (seg) => {
  const k = EV_SEG_PART[seg];
  return (EVENT_PARTS.find(p => p.key === k) || {}).label || '';
};

export function openEvDetail(key){
  settingsUi.evDetailKey = key;
  settingsUi.evDetailSeg = 'basic';
  const list = document.getElementById('ev-mgr-list-view');
  const det  = document.getElementById('ev-mgr-detail-view');
  if(list) list.style.display = 'none';
  if(det)  det.style.display  = 'block';
  renderEvDetail();
}

export function closeEvDetail(){
  settingsUi.evDetailKey = '';
  // 비품 편집기를 설정값 탭 자리로 돌려놓는다 — 안 그러면 그쪽에서 열었을 때
  // 사라진 자리에 그리려 하고 화면이 빈 채로 남는다
  mountEquipCatalogIdle();
  const list = document.getElementById('ev-mgr-list-view');
  const det  = document.getElementById('ev-mgr-detail-view');
  if(det){  det.style.display  = 'none'; det.innerHTML = ''; }
  if(list) list.style.display = 'block';
  renderEvMgr();
}

export function setEvDetailSeg(seg){ settingsUi.evDetailSeg = seg; renderEvDetail(); }

export function renderEvDetail(){
  const el = document.getElementById('ev-mgr-detail-view');
  if(!el || !settingsUi.evDetailKey) return;
  const ev = EVENT_LIST.find(e => e.key === settingsUi.evDetailKey);
  if(!ev){ closeEvDetail(); return; }        // 다른 곳에서 지워졌다

  const parts = evParts(ev.key);
  const locked = evSegLocked(settingsUi.evDetailSeg, parts);
  /* 진행 완료된 전시는 설정도 손대지 않는다 — 끝난 행사의 부스 타입이나 단가가
     바뀌면 그때 무엇으로 청구했는지가 지금 값으로 덮인다. */
  /* 진행 완료된 파트는 설정도 손대지 않는다 — 끝난 행사의 값이 바뀌면 그때
     무엇으로 했는지가 지금 값으로 덮인다. 세그먼트가 보는 파트를 따라간다. */
  const readonly = evPartDone(ev.key, EV_SEG_PART[settingsUi.evDetailSeg] || 'exh');

  const seg = EV_SEGS.map(([k, l]) => {
    const off = evSegLocked(k, parts);
    return `<button class="seg-b${settingsUi.evDetailSeg === k ? ' on' : ''}" onclick="setEvDetailSeg('${k}')"
      style="${off ? 'opacity:.45' : ''}" ${off ? 'title="전시 파트를 켜면 쓸 수 있어요"' : ''}>${l}${off ? ' 🔒' : ''}</button>`;
  }).join('');

  const body = locked
    ? `<div style="font-size:var(--fs-12);color:var(--i4);padding:24px 0">
         이 행사는 <b>${escapeHtml(evSegPartLabel(settingsUi.evDetailSeg))}</b> 파트가 꺼져 있어 ${escapeHtml(EV_SEGS.find(x => x[0] === settingsUi.evDetailSeg)[1])} 설정을 쓰지 않아요.
         <button class="btn" style="margin-left:8px;font-size:var(--fs-11)" onclick="setEvDetailSeg('parts')">진행 파트에서 켜기</button>
       </div>`
    : settingsUi.evDetailSeg === 'parts' ? evPartsHtml(ev, parts)
    : settingsUi.evDetailSeg === 'booth' ? evBoothHtml(ev)
    /* 품목표는 설정 › 비품 목록 한 곳에서 고친다 — 여기서는 몇 품목인지와 바로가기만 */
    : settingsUi.evDetailSeg === 'equip' ? (() => {
        const n = EQUIP_CATALOG.filter(c => c.event_id === ev.key && c.active !== 'no').length;
        return `<div style="font-size:var(--fs-12);color:var(--i3);padding:12px 0;line-height:1.7">
          이 행사의 품목표: <b>${n ? `${n}품목` : '아직 없음'}</b><br>
          <button class="btn bp" style="margin-top:8px;font-size:var(--fs-11)"
            onclick="openEquipFor('${escAttr(ev.key)}')">🪑 비품 목록에서 열기</button></div>`;
      })()
    : settingsUi.evDetailSeg === 'due'   ? evDueHtml(ev)
    : settingsUi.evDetailSeg === 'conf'  ? window.evConfHtml(ev)
    : settingsUi.evDetailSeg === 'mail'  ? '<div id="evd-mailbox"></div>'
    /* 네임택 판 — 용지·글자 자리·배경. 발급은 행사 DB › 네임택(features/nametag/nt-editor.js) */
    : settingsUi.evDetailSeg === 'nametag' ? '<div id="nt-ed"></div>'
    : evBasicHtml(ev);

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <button class="btn" style="font-size:var(--fs-11);height:28px" onclick="closeEvDetail()">← 행사 목록</button>
      <div style="width:12px;height:12px;border-radius:50%;background:${escAttr(ev.color || '#3B5BDB')};flex-shrink:0"></div>
      <div style="font-size:var(--fs-14);font-weight:700;color:var(--i1)">${escapeHtml(ev.name || ev.key)}</div>
      <span style="font-size:var(--fs-11);color:var(--i4);background:var(--i7);border-radius:var(--rd-3);padding:1px 5px;font-family:monospace">${escapeHtml(ev.key)}</span>
    </div>
    <div class="seg" style="flex-wrap:wrap;margin-bottom:14px">${seg}</div>
    ${readonly && EV_SEG_PART[settingsUi.evDetailSeg] ? `<div style="display:flex;align-items:center;gap:8px;
        background:var(--i8);border:1px solid var(--i6);border-left:3px solid var(--g);border-radius:var(--r);
        padding:9px 12px;margin-bottom:10px">
      <span class="pill p-green">진행 완료</span>
      <span style="font-size:var(--fs-11_5);color:var(--i3)">끝난 파트라 열람만 됩니다. 고치려면 <b>진행 파트</b>에서 진행 중으로 되돌리세요.</span>
    </div>` : ''}
    <div class="${readonly && EV_SEG_PART[settingsUi.evDetailSeg] ? 'ro' : ''}"
      style="background:var(--i8);border:1px solid var(--i6);border-radius:var(--rd-10);padding:16px">${body}</div>`;

  // 비품 편집기는 이제 비품 목록 탭에만 붙는다 — 다른 자리를 가리키고 있으면 돌려놓는다
  mountEquipCatalogIdle();
  if(settingsUi.evDetailSeg === 'conf' && !locked) window.fillFlowFiles(ev.key);
  if(settingsUi.evDetailSeg === 'mail') renderEvMailbox(ev.key);
  if(settingsUi.evDetailSeg === 'nametag') mountNametagEditor(ev.key);
}

/* ── 행사 공용 메일 ── (설정 › 행사 관리 › 메일)
   정본은 여기 한 곳이다. 연사·참가사 «메일 보내기»는 이 값을 서버가 읽어 쓴다.
   이 행사 사람(연사·참가사)에게 «메일 보내기»를 누르면 여기 적은 주소로 나간다.
   비워 두면 보내지 않는다. 비밀번호는 서버만 알고, 화면에는
   «저장됨»만 보인다 — 다른 칸만 고칠 때는 비밀번호 칸을 비워 둔다. */
async function renderEvMailbox(evKey){
  const el = document.getElementById('evd-mailbox');
  if(!el) return;
  if(!settingsUi.mailAccounts){
    el.innerHTML = '<div style="font-size:var(--fs-11);color:var(--i4)">메일 계정 불러오는 중…</div>';
    settingsUi.mailAccounts = await loadMailAccounts();
    if(document.getElementById('evd-mailbox') !== el) return;
  }
  const r = settingsUi.mailAccounts;
  if(r.ok === false) settingsUi.mailAccounts = null;   // 다음에 열 때 다시 불러온다
  const box = (r.accounts || []).find(a => a.event_id === evKey) || {};
  const inp = (id, label, val, ph, type = 'text') => `<div><div class="mlbl">${label}</div>
    <input class="fi" id="evmb-${id}" type="${type}" value="${escapeHtml(val || '')}" placeholder="${escapeHtml(ph)}" autocomplete="off"></div>`;
  el.innerHTML = `<div>
    <div style="font-size:var(--fs-12);font-weight:700;color:var(--i2);margin-bottom:4px">행사 공용 메일
      ${box.username ? '<span class="pill p-green" style="font-size:var(--fs-10);margin-left:6px">연결됨</span>' : '<span class="pill p-gray" style="font-size:var(--fs-10);margin-left:6px">없음 — 메일을 보낼 수 없음</span>'}</div>
    <div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:12px">
      이 행사의 연사·참가사에게 «메일 보내기»를 누르면 이 주소로 나가고, 답장도 이 메일함으로 옵니다.
      <span id="evmb-help">${mailProv(box.provider).help}</span>
      ${r.offline ? '<br><b style="color:var(--re)">테스트 모드에서는 설정할 수 없어요.</b>' : ''}
      ${r.ok && !r.keyReady ? '<br><b style="color:var(--re)">서버에 MAIL_SECRET이 없어 비밀번호를 저장할 수 없어요 — Vercel 환경변수를 먼저 넣어주세요.</b>' : ''}
      ${r.ok === false && !r.offline ? `<br><b style="color:var(--re)">${escapeHtml(r.error || '불러오지 못했어요')}</b>` : ''}
    </div>
    <div style="margin-bottom:10px"><div class="mlbl">메일 서비스</div>
      <select class="fi" id="evmb-provider" style="width:220px" onchange="evmbProvider(this.value)">
        <option value="mailplug"${(box.provider || 'mailplug') === 'mailplug' ? ' selected' : ''}>메일플러그 (회사 메일)</option>
        <option value="gmail"${box.provider === 'gmail' ? ' selected' : ''}>Gmail</option>
        <option value="naverworks"${box.provider === 'naverworks' ? ' selected' : ''}>네이버 웍스</option>
      </select></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      ${inp('user', '로그인 주소', box.username, mailProv(box.provider).user)}
      ${inp('pass', box.has_password ? '앱 비밀번호 — 저장됨, 바꿀 때만 입력' : '앱 비밀번호 (메일 비밀번호 아님)', '', box.has_password ? '••••••••' : '발급한 앱 비밀번호 (메일 비밀번호 아님)', 'password')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      ${inp('from', '받는 사람에게 보일 주소', box.from_addr, '비우면 로그인 주소')}
      ${inp('name', '보내는 이름', box.from_name, '예: KIC 2026 사무국')}
    </div>
    <div style="margin-bottom:10px">${inp('hostdom', '주최사 메일 도메인 (쉼표로 여러 개)', box.host_domains, '예: kpbma.or.kr')}
      <div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:3px;line-height:1.5">주최사 주소는 연락처로 넣지 않아요. 직원이 전달(FW)한 주최사 메일은 원래 받는 사람(연사·참가사) 기록에 붙어요.</div></div>
    <details style="margin-bottom:10px"><summary style="font-size:var(--fs-11);color:var(--i4);cursor:pointer">서버 (보통 고칠 일 없음)</summary>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:8px;margin-top:8px">
        ${inp('host', 'SMTP 서버', box.host, mailProv(box.provider).host)}
        ${inp('port', '포트', box.port, '465')}
      </div></details>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn bp" onclick="saveEvMailbox('${escAttr(evKey)}')" style="min-width:80px">저장</button>
      ${box.username ? `<button class="btn" onclick="testEvMailbox('${escAttr(evKey)}')">연결 확인</button>
        <button class="btn" onclick="removeEvMailbox('${escAttr(evKey)}')">연결 끊기</button>
        <button class="btn" onclick="syncEvSentMail('${escAttr(evKey)}')"
          title="행사 메일 보낸메일함·받은메일함을 읽어, 이 행사 연사·참가사와 주고받은 메일을 그 사람 기록에 남기고 초청 메일은 «보냄»으로 체크합니다">메일함에서 주고받은 기록 가져오기</button>` : ''}
      <span id="evmb-msg" style="font-size:var(--fs-11);color:var(--g)"></span>
    </div>
    ${box.username ? `<div id="evmb-footer" style="margin-top:16px"></div>` : ''}
    <div id="evd-inbox" style="margin-top:16px"></div>
    ${evParts(evKey).exh !== 'none' ? exhMailEditorHtml(evKey) : ''}
  </div>`;
  renderEvInbox(evKey);
  if(box.username) renderEvMailFooter(evKey);
  if(evParts(evKey).exh !== 'none') fillExhMailFiles(evKey);
}

/* ── 메일 푸터 — 이 행사 메일함으로 나가는 모든 메일(전시·연사·컨택·CRM) 맨 끝에 서버가 붙인다.
   글은 **굵게** *기울임*, www. 주소는 링크. 이미지는 글 아래. 저장은 비밀번호와 따로 ── */
async function renderEvMailFooter(evKey){
  const el = document.getElementById('evmb-footer');
  if(!el) return;
  if(!settingsUi.evFooter || settingsUi.evFooter.evKey !== evKey){
    el.innerHTML = '<div style="font-size:var(--fs-11);color:var(--i4)">메일 푸터 불러오는 중…</div>';
    const r = await loadMailFooter(evKey);
    if(document.getElementById('evmb-footer') !== el) return;
    // 예전 «여러 기업에 메일»에만 저장했던 푸터가 있으면 처음 한 번 채워 둔다(저장을 눌러야 옮겨진다)
    const old = String((EXH_CFG[evKey] || {}).mailFooter || '');
    settingsUi.evFooter = { evKey, text: (r && r.footer_text) || '', img: (r && r.footer_img) || '', fromOld: !(r && r.footer_text) && !!old };
    if(settingsUi.evFooter.fromOld) settingsUi.evFooter.text = old;
  }
  const f = settingsUi.evFooter;
  el.innerHTML = `<div style="font-size:var(--fs-12);font-weight:700;color:var(--i2);margin-bottom:4px">메일 푸터
      ${f.text || f.img ? '<span class="pill p-green" style="font-size:var(--fs-10);margin-left:6px">모든 메일에 붙음</span>' : '<span class="pill p-gray" style="font-size:var(--fs-10);margin-left:6px">없음</span>'}</div>
    <div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:8px">이 행사 메일로 나가는 모든 메일(전시·연사·컨택·CRM) 맨 끝, 본문·사진 아래에 붙어요.
      **굵게** *기울임* · www. 주소는 링크. 양식 문구에 서명을 따로 넣었다면 겹치니 빼주세요.
      ${f.fromOld ? '<br><b style="color:var(--am)">«여러 기업에 메일»에 저장해 두었던 푸터를 불러왔어요 — 저장을 눌러야 여기로 옮겨져요.</b>' : ''}</div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px">
      <div>
        <textarea class="fi" id="evmb-ftext" rows="9" style="width:100%;font-size:var(--fs-11_5)" oninput="evFooterInput(this.value)"
          placeholder="***행사 사무국***&#10;주소&#10;**E-mail:** ...">${escapeHtml(f.text)}</textarea>
        <div style="display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap;font-size:var(--fs-11)">
          <label class="btn" style="font-size:var(--fs-10_5);cursor:pointer">🖼 ${f.img ? '푸터 이미지 바꾸기' : '푸터 이미지 넣기'}
            <input type="file" accept="image/png,image/jpeg,image/gif" style="display:none" onchange="evFooterImg(this)"></label>
          ${f.img ? '<button class="btn" style="font-size:var(--fs-10_5)" onclick="evFooterImg(null)">이미지 빼기</button>' : ''}
          <span style="color:var(--i4)">가로 1240px로 맞춰요 · 1MB 이하</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
          <button class="btn bp" onclick="saveEvFooter('${escAttr(evKey)}')">푸터 저장</button>
          <span id="evmb-fmsg" style="font-size:var(--fs-11);color:var(--g)"></span></div>
      </div>
      <div><div class="mlbl">미리보기</div>
        <div id="evmb-fprev" style="background:#fff;border:1px solid var(--i6);border-radius:var(--rd-6);padding:10px;max-height:320px;overflow:auto">${evFooterPrev()}</div></div>
    </div>`;
}
function evFooterPrev(){
  const f = settingsUi.evFooter;
  if(!f || (!f.text.trim() && !f.img)) return '<span style="font-size:var(--fs-11);color:var(--i4)">푸터가 없어요.</span>';
  const line = (l) => escapeHtml(l)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/\b((?:https?:\/\/|www\.)[^\s<]+)/g, (u) => `<a href="${u.startsWith('www.') ? 'https://' + u : u}" target="_blank" style="color:#1a0dab">${u}</a>`);
  return `<div style="font-family:Arial,sans-serif;font-size:12px;line-height:1.45;color:#222">${f.text.trim().split('\n').map(line).join('<br>')}${
    f.img ? `<img src="${f.img}" style="display:block;max-width:100%;margin-top:10px">` : ''}</div>`;
}
window.evFooterInput = (v) => { if(!settingsUi.evFooter) return; settingsUi.evFooter.text = v; const p = document.getElementById('evmb-fprev'); if(p) p.innerHTML = evFooterPrev(); };
window.evFooterImg = (input) => {
  if(!settingsUi.evFooter) return;
  if(!input){ settingsUi.evFooter.img = ''; settingsUi.evFooter.imgNew = null; renderEvMailFooter(settingsUi.evFooter.evKey); return; }
  const file = input.files && input.files[0];
  input.value = '';
  if(!file) return;
  const url = URL.createObjectURL(file), im = new Image();
  im.onload = () => {
    // 가로 1240px로 맞춘다(작으면 그대로). PNG는 투명 배경일 수 있어 PNG로 두되 1MB를 넘으면 JPEG로
    const w = Math.min(1240, im.naturalWidth), h = Math.round(im.naturalHeight * w / im.naturalWidth);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const png = file.type === 'image/png';
    if(!png){ g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
    g.drawImage(im, 0, 0, w, h);
    URL.revokeObjectURL(url);
    let data = c.toDataURL(png ? 'image/png' : 'image/jpeg', .88);
    if(png && data.length * .75 > 1024 * 1024){ g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); data = c.toDataURL('image/jpeg', .88); }
    if(data.length * .75 > 1024 * 1024){ alert('이미지가 1MB를 넘어요. 더 작은 이미지를 골라주세요.'); return; }
    settingsUi.evFooter.img = data; settingsUi.evFooter.imgNew = data; settingsUi.evFooter.imgType = data.slice(5, data.indexOf(';'));
    renderEvMailFooter(settingsUi.evFooter.evKey);
  };
  im.onerror = () => { URL.revokeObjectURL(url); alert('이미지를 읽지 못했어요.'); };
  im.src = url;
};
window.saveEvFooter = async (evKey) => {
  if(!settingsUi.evFooter || settingsUi.evFooter.evKey !== evKey) return;
  const msg = document.getElementById('evmb-fmsg');
  if(msg){ msg.style.color = 'var(--i4)'; msg.textContent = '저장 중…'; }
  const rec = { footer_text: settingsUi.evFooter.text.trim() };
  if(settingsUi.evFooter.imgNew === null) rec.footer_img = null;
  else if(settingsUi.evFooter.imgNew){ rec.footer_img = settingsUi.evFooter.imgNew; rec.footer_img_type = settingsUi.evFooter.imgType; }
  const r = await saveMailFooter(evKey, rec);
  if(!r || r.ok === false){ if(msg){ msg.style.color = 'var(--re)'; msg.textContent = (r && r.error) || '저장하지 못했어요.'; } return; }
  settingsUi.evFooter.imgNew = undefined; settingsUi.evFooter.fromOld = false;
  renderEvMailFooter(evKey);
  const m2 = document.getElementById('evmb-fmsg');
  if(m2){ m2.style.color = 'var(--g)'; m2.textContent = '저장했어요 — 이제 이 행사 메일 끝에 붙어요.'; }
};

/* ── 전시 메일 양식 ──
   고치는 곳은 편집 창 하나(exh-mail-editor.js) — 참가사 메일 탭·«여러 기업에 메일»에서도
   같은 창이 열린다. 여기서는 지금 단계만 보여 주고 창을 연다. */
function exhMailEditorHtml(evKey){
  const steps = exhMailSteps(evKey, { withOff: true });
  return `<div style="margin-top:22px;padding-top:14px;border-top:1px solid var(--i6)">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <span style="font-size:var(--fs-12);font-weight:700;color:var(--i2)">전시 메일 양식</span>
      <button class="btn" style="font-size:var(--fs-10_5);margin-left:auto" onclick="openExhMailEditor('${escAttr(evKey)}')">✎ 단계 편집</button>
    </div>
    <div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:6px;line-height:1.6">
      단계 추가·고치기·끄기와 메일 문구·기본 첨부는 «단계 편집»에서 합니다. 참가사 메일 탭에서도 같은 창이 열리고, 고치면 바로 저장돼요.</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">${steps.map((st, i) => `<span class="pill ${st.off ? 'p-gray' : st.custom ? 'p-amber' : 'p-blue'}"
      style="font-size:var(--fs-10_5);cursor:pointer;${st.off ? 'text-decoration:line-through' : ''}" onclick="openExhMailEditor('${escAttr(evKey)}','${escAttr(st.key)}')"
      >${i + 1}. ${escapeHtml(st.label)}</span>`).join('')}</div>
  </div>`;
}
export async function fillExhMailFiles(evKey){
  await loadMailFiles(evKey);
  exhMailSteps(evKey, { withOff: true }).forEach(st => {
    const el = document.getElementById(`exmfiles-${st.key}`);
    if(!el) return;
    const files = mailFilesOf(evKey).filter(f => f.step === exhMailFileStep(st.key));
    el.innerHTML = files.length ? files.map(f => `<div style="display:flex;gap:6px;align-items:center;padding:2px 0">
        📎 <span style="color:var(--i2)">${escapeHtml(f.filename)}</span>
        <span>${(Number(f.size || 0) / 1024).toFixed(0)}KB</span>
        <button class="btn" style="font-size:var(--fs-10);padding:1px 6px;margin-left:auto"
          onclick="removeFlowFile('${escAttr(evKey)}','${escAttr(f.id)}')">삭제</button></div>`).join('') : '없음';
  });
}

/* 메일 서비스별 안내·기본 서버 — 서버 쪽 PROVIDERS(routes/mail.js)와 맞춘다 */
const MAIL_PROVIDERS = {
  mailplug: { host: 'smtp.mailplug.co.kr', user: '예: kic@13100m.net',
    help: '메일플러그 › 환경설정 › IMAP/SMTP 사용에서 앱 비밀번호를 발급해 넣어주세요.' },
  gmail: { host: 'smtp.gmail.com', user: '예: kic.secretariat@gmail.com',
    help: 'Gmail: 2단계 인증을 켠 뒤 Google 계정 › 보안 › 앱 비밀번호에서 발급해 넣어주세요. 회사 주소로 보내려면 Gmail 설정 › 계정 › «다른 주소에서 메일 보내기»에 그 주소를 먼저 등록하세요.' },
  naverworks: { host: 'smtp.worksmobile.com', user: '예: kic@회사도메인',
    help: '네이버 웍스: 관리자 화면 › 보안 › 서비스 권한 › 메일에서 IMAP/SMTP가 «사용»인지 확인한 뒤 웍스 로그인 비밀번호를 넣어주세요(2단계 인증을 쓰면 앱 비밀번호).' },
};
const mailProv = (v) => MAIL_PROVIDERS[v || 'mailplug'] || MAIL_PROVIDERS.mailplug;

/* 서비스를 바꾸면 서버 칸·안내를 그 서비스 것으로 — 서버 칸은 비워 두면 서버가 기본값을 쓴다 */
export function evmbProvider(v){
  const host = document.getElementById('evmb-host');
  const defaults = Object.values(MAIL_PROVIDERS).map(p => p.host);
  if(host && (!host.value || defaults.includes(host.value.trim()))){
    host.value = ''; host.placeholder = mailProv(v).host;
  }
  const user = document.getElementById('evmb-user');
  if(user) user.placeholder = mailProv(v).user;
  const help = document.getElementById('evmb-help');
  if(help) help.textContent = mailProv(v).help;
}
window.evmbProvider = evmbProvider;

/* 이 행사의 처리 안 한 받은 메일 — 사람마다 창을 열어 봐야 알면 놓친다.
   한곳에 모아 두고, 누르면 그 사람 메일 탭이 열린다. 읽음·처리 규칙은 mail-mark.js */
export function renderEvInbox(evKey = settingsUi.inboxEv){
  settingsUi.inboxEv = evKey;
  const el = document.getElementById('evd-inbox');
  if(!el) return;
  const spIds = new Map(SPEAKERS.filter(x => x.event_id === evKey).map(x => [x.id, x.name_snapshot || x.name_en || x.id]));
  const exIds = new Map(EXHIBITORS.filter(x => x.event_id === evKey).map(x => [x.id, x.company_name || x.id]));
  const rows = [
    ...SPEAKER_LOGS.filter(l => spIds.has(l.speaker_id) && isPending(l)).map(l => ({ l, t: 'sp', id: l.speaker_id, who: spIds.get(l.speaker_id) })),
    ...EXH_LOGS.filter(l => exIds.has(l.exhibitor_id) && isPending(l)).map(l => ({ l, t: 'ex', id: l.exhibitor_id, who: exIds.get(l.exhibitor_id) })),
  ].sort((a, b) => String(b.l.ts || '').localeCompare(String(a.l.ts || '')));
  const unread = rows.filter(r => isUnread(r.l)).length;
  // 주인 없는 메일 단추는 늦게 채운다(서버에서 센다)
  setTimeout(async () => {
    const m = await import('../../shared/mail/mail-original.js');
    const n = await m.unassignedCount(evKey);
    const b = document.getElementById('evd-un-btn');
    if(b) b.innerHTML = n ? `<button class="btn" style="font-size:var(--fs-10_5);color:var(--am);font-weight:700;margin-left:6px" onclick="openUnassigned('${escAttr(evKey)}')">주인 없는 메일 ${n}</button>` : '';
    const oc = await import('../../shared/mail/org-candidates.js');
    const k = await oc.orgCandidateCount(evKey);
    if(b && k) b.innerHTML += `<button class="btn" style="font-size:var(--fs-10_5);color:var(--te);font-weight:700;margin-left:6px" onclick="openOrgCandidates('${escAttr(evKey)}')">기업 후보 ${k}</button>`;
  }, 0);
  el.innerHTML = `<span id="evd-un-btn" style="float:right"></span><div style="font-size:var(--fs-12);font-weight:700;color:var(--i2);margin-bottom:6px">처리 안 한 받은 메일 ${rows.length
      ? `<span class="pill p-amber" style="font-size:var(--fs-10)">${rows.length}</span>${unread ? ` <span class="pill p-red" style="font-size:var(--fs-10)">안 읽음 ${unread}</span>` : ''}` : ''}</div>
    ${rows.length ? rows.slice(0, 50).map(({ l, t, id, who }) => `<div style="display:flex;gap:7px;align-items:baseline;padding:6px 0;border-top:1px solid var(--i7);cursor:pointer"
        onclick="${t === 'sp' ? `openSpeakerDr('${escAttr(id)}','box')` : `openExhDr('${escAttr(id)}','box')`}">
        <span style="font-size:var(--fs-10_5);color:var(--i4);white-space:nowrap">${escapeHtml(l.ts || '')}</span>
        <span class="pill p-gray" style="font-size:var(--fs-10)">${t === 'sp' ? '연사' : '참가사'}</span>
        <span style="font-size:var(--fs-11_5);font-weight:${isUnread(l) ? 800 : 500}">${isUnread(l) ? '● ' : ''}${escapeHtml(who)}</span>
        <span style="font-size:var(--fs-11_5);color:var(--i3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l.subject || '(제목 없음)')}</span>
      </div>`).join('')
      : '<div style="font-size:var(--fs-11);color:var(--i4)">처리 안 한 받은 메일이 없어요. «메일함에서 주고받은 기록 가져오기»로 새 메일을 가져옵니다.</div>'}`;
}
window.renderEvInbox = renderEvInbox;
const evmbSay = (t, ok) => { const m = document.getElementById('evmb-msg'); if(m){ m.style.color = ok ? 'var(--g)' : 'var(--re)'; m.textContent = t; } };

export async function saveEvMailbox(evKey){
  const g = (id) => (document.getElementById('evmb-' + id)?.value || '').trim();
  const rec = { provider: g('provider') || 'mailplug', username: g('user'), password: g('pass'), from_addr: g('from'), from_name: g('name'), host: g('host'), port: g('port'), host_domains: g('hostdom') };
  if(!rec.username){ evmbSay('로그인 주소를 적어주세요.'); return; }
  evmbSay('저장 중…', true);
  const r = await saveMailAccount(evKey, rec);
  if(!r.ok){ evmbSay(r.error || '저장하지 못했어요.'); return; }
  settingsUi.mailAccounts = settingsUi.mailAccounts || { ok: true, accounts: [] };
  settingsUi.mailAccounts.accounts = [...(settingsUi.mailAccounts.accounts || []).filter(a => a.event_id !== evKey), r.account];
  eventMailFrom(evKey, true);
  trackAction('edit', '행사 메일 설정', evKey, `${rec.username}${rec.password ? ' (비밀번호 변경)' : ''}`);
  await renderEvMailbox(evKey);
  // 저장만 하고 끝내면 비밀번호가 틀린 걸 첫 발송 때 알게 된다 — 바로 확인한다
  await testEvMailbox(evKey);
}
export async function testEvMailbox(evKey){
  evmbSay('로그인 확인 중…', true);
  const r = await testMailAccount(evKey);
  evmbSay(r.ok ? r['연결'] : `${r.error || '실패'}${r['도움말'] ? ' — ' + r['도움말'] : ''}`, r.ok);
}
/* 메일함 → 기록 — 규칙과 순서는 mail-mark.js runMailSync(대시보드도 같은 걸 쓴다) */
export const syncEvSentMail = (evKey) => runMailSync(evKey, evmbSay);

export async function removeEvMailbox(evKey){
  if(!confirm('이 행사의 메일 계정 연결을 끊을까요?\n끊으면 이 행사 사람들에게 메일을 보낼 수 없어요.')) return;
  const r = await deleteMailAccount(evKey);
  if(!r.ok){ evmbSay(r.error || '끊지 못했어요.'); return; }
  settingsUi.mailAccounts = settingsUi.mailAccounts || { ok: true, accounts: [] };
  settingsUi.mailAccounts.accounts = (settingsUi.mailAccounts.accounts || []).filter(a => a.event_id !== evKey);
  eventMailFrom(evKey, true);
  trackAction('delete', '행사 메일 설정', evKey, '연결 끊음');
  renderEvMailbox(evKey);
}

/* ── 기본 정보 ──
   행사는 지금까지 추가·삭제만 됐다. 오타 하나 고치려고 지웠다 다시 만들면
   participations 연결이 끊기므로, 여기서 처음으로 고칠 수 있게 한다.
   행사 ID(key)는 못 고친다 — 연결 키라서 바꾸면 참여 기록이 전부 떨어진다. */
function evBasicHtml(ev){
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
      <div><div class="mlbl">행사명 (풀네임)</div>
        <input class="fi" id="evd-name" value="${escapeHtml(ev.name || ev.key)}" style="width:100%"></div>
      <div><div class="mlbl">약칭</div>
        <input class="fi" id="evd-short" value="${escapeHtml(ev.short || '')}" style="width:100%"></div>
    </div>
    <div style="margin-bottom:8px"><div class="mlbl">영문 행사명 <span style="font-size:var(--fs-9_5);color:var(--i4)">영문 메일·엑셀의 {행사}에 들어갑니다 — 비우면 행사명</span></div>
      <input class="fi" id="evd-name-en" value="${escapeHtml(ev.name_en || '')}" placeholder="예: 2026 AIA East Asia Symposium" style="width:100%"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
      <div><div class="mlbl">시작일</div>
        <input class="fi" id="evd-date-start" type="date" value="${escapeHtml(ev.date_start || '')}" style="width:100%"></div>
      <div><div class="mlbl">종료일</div>
        <input class="fi" id="evd-date-end" type="date" value="${escapeHtml(ev.date_end || '')}" style="width:100%"></div>
      <div><div class="mlbl">색상</div>
        <input type="color" id="evd-color" value="${escapeHtml(ev.color || '#3B5BDB')}"
          style="width:100%;height:36px;border:1px solid var(--i6);border-radius:var(--rd-6);cursor:pointer;padding:2px"></div>
    </div>
    <div style="margin-bottom:12px"><div class="mlbl">장소</div>
      <input class="fi" id="evd-loc" value="${escapeHtml(ev.location || '')}" style="width:100%"></div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn bp" onclick="saveEvBasic()" style="min-width:80px">저장</button>
      <span id="evd-basic-msg" style="font-size:var(--fs-11);color:var(--g)"></span>
    </div>
    <div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:10px">
      행사 ID <code>${escapeHtml(ev.key)}</code>는 참여 기록·참가기업이 가리키는 키라 바꿀 수 없어요.
    </div>`;
}

export async function saveEvBasic(){
  const ev = EVENT_LIST.find(e => e.key === settingsUi.evDetailKey);
  if(!ev) return;
  const msg = document.getElementById('evd-basic-msg');
  const say = (t, ok) => { if(msg){ msg.style.color = ok ? 'var(--g)' : 'var(--re)'; msg.textContent = t; } };
  const g = (id) => (document.getElementById(id)?.value || '').trim();

  const name = g('evd-name');
  if(!name){ say('행사명은 비울 수 없어요.'); return; }

  const prev = { ...ev };
  const start = g('evd-date-start');
  Object.assign(ev, {
    name, short: g('evd-short') || name, name_en: g('evd-name-en'),
    date_start: start, date: start,       // date는 하위 호환용 시작일
    date_end: g('evd-date-end'), location: g('evd-loc'),
    color: document.getElementById('evd-color')?.value || ev.color,
  });

  const r = await saveEventToSheet(ev);
  if(r && r.ok === false){ Object.assign(ev, prev); say('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.'); renderEvDetail(); return; }

  const changed = ['name','short','name_en','date_start','date_end','location','color']
    .filter(f => (prev[f] || '') !== (ev[f] || ''))
    .map(f => `${f} ${prev[f] || '없음'} → ${ev[f] || '없음'}`);
  if(changed.length) trackAction('edit', '행사 정보 수정', ev.key, changed.join(' / '));

  refreshAfterEventChange();
  say('저장했어요.', true);
  renderEvDetail();
  setTimeout(() => { const m = document.getElementById('evd-basic-msg'); if(m) m.textContent = ''; }, 2000);
}

/* ── 진행 파트 ──
   행사마다 무엇을 하는지가 다르다. 켜 둔 파트만 화면에 나오게 하는 게 목적이고,
   지금은 전시만 실제로 잠금이 붙는다 — 나머지는 운영 화면이 아직 없다. */
function evPartsHtml(ev, parts){
  const exhSummary = () => {
    const bt = clRowsOf('booth_type', ev.key).length || clRowsOf('booth_type', '').length;
    const eq = EQUIP_CATALOG.filter(c => c.event_id === ev.key).length;
    return `부스 타입 ${bt}종 · 비품 품목 ${eq}건`;
  };
  return EVENT_PARTS.map(p => {
    const st = parts[p.key];
    const sub = (st !== 'none' && p.key === 'exh') ? exhSummary() : '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--i7);flex-wrap:wrap">
      <div style="flex:1;min-width:150px">
        <div style="font-size:var(--fs-13);font-weight:600;color:var(--i1)">${escapeHtml(p.label)}</div>
        <div style="font-size:var(--fs-11);color:var(--i4);margin-top:2px">
          ${sub ? escapeHtml(sub) : p.partTypes.map(t => `<span class="pill p-gray" style="margin-right:3px">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>
      <div class="seg" style="flex-wrap:wrap">
        ${PART_STATES.map(x => `<button class="seg-b${st === x.key ? ' on' : ''}"
          onclick="setEvPart('${escAttr(p.key)}','${escAttr(x.key)}')">${escapeHtml(x.label)}</button>`).join('')}
      </div>
    </div>`;
  }).join('')
  + `<div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:12px;line-height:1.7">
      <b>안 함</b> — 그 파트를 열지 않는 행사예요. 전시를 안 함으로 두면 전시 탭에서 이 행사가 열리지 않습니다.<br>
      <b>진행 중</b> — 지금 챙기는 중. 고칠 수 있어요.<br>
      <b>진행 완료</b> — 끝난 일이라 <b>열람만</b> 됩니다. 데이터는 그대로 두고 고치는 것만 막아요.
      정산 입금이 늦게 들어오는 것처럼 손봐야 할 일이 생기면 다시 <b>진행 중</b>으로 되돌리면 됩니다.<br>
      지금 화면에 반영되는 건 <b>전시</b>뿐이에요 — 컨퍼런스·파트너링·후원은 여기 적어 두면 운영 화면이 생길 때 그대로 이어집니다.
    </div>`;
}

export async function setEvPart(part, state){
  const ev = EVENT_LIST.find(e => e.key === settingsUi.evDetailKey);
  if(!ev) return;
  const now = evParts(ev.key);
  const def = EVENT_PARTS.find(p => p.key === part);
  if(!def || now[part] === state) return;

  /* 무엇이 잠기는지 누르기 전에 말해 준다. 전시만 화면이 걸려 있어 전시만 묻는다.
     되돌릴 수 있는 설정이지만, 눌러 보고 알게 하면 늦다. */
  const ask = part !== 'exh' ? ''
    : state === 'none' ? `${ev.name || ev.key}의 전시를 "안 함"으로 둘까요?\n전시 탭에서 이 행사가 열리지 않고, 부스·비품·일정 설정도 잠깁니다.\n(등록된 참가기업·품목 데이터는 그대로 남습니다)`
    : state === 'done' ? `${ev.name || ev.key}의 전시를 "진행 완료"로 둘까요?\n전시 탭을 볼 수는 있지만 고칠 수 없게 됩니다.\n(다시 "진행 중"으로 되돌리면 언제든 고칠 수 있어요)`
    : '';
  if(ask && !confirm(ask)) return;

  const ok = await saveEvParts(ev.key, { ...now, [part]: state });
  if(!ok) return;
  trackAction('edit', '진행 파트 변경', ev.key,
    `${ev.name || ev.key} — ${def.label} ${partStateOf(now[part]).label} → ${partStateOf(state).label}`);
  renderEvDetail();
  renderEvMgr();
  window.renderExh?.();
  window.renderEvDb?.();
}

/* parts만 갈아 끼우고 나머지(due·book)는 그대로 둔다 — settings의 한 줄을
   통째로 덮어쓰는 저장이라, 읽어 온 것을 펼쳐서 다시 넣지 않으면 마감일이 날아간다 */
async function saveEvParts(evKey, parts){
  const prev = EXH_CFG[evKey] ? JSON.parse(JSON.stringify(EXH_CFG[evKey])) : undefined;
  const cfg = { ...(prev || {}), parts };
  EXH_CFG[evKey] = cfg;
  const r = await saveExhCfgToSheet(evKey, cfg);
  if(r && r.ok === false){
    if(prev) EXH_CFG[evKey] = prev; else delete EXH_CFG[evKey];
    alert('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    renderEvDetail();
    return false;
  }
  return true;
}

/* ── 부스 ──
   부스 타입과 스폰서 등급은 code_lists에 들어 있고, 행사 전용 목록이 있으면
   그걸 쓰고 없으면 공통을 쓴다(state.js codeList). 그 규칙이 화면에서 안 보이면
   "고쳤는데 안 바뀐다"가 되므로, 지금 보고 있는 게 공통인지 이 행사 것인지를
   머리말에 배지로 붙인다. */
/* 비품·그래픽 분류도 행사마다 다르다. 전에는 설정값 탭에서 «○○ 전용»을 골라야
   고칠 수 있었다 — 한 행사의 값은 그 행사 상세에서 고친다. */
const EV_BOOTH_LISTS = [['booth_type','부스 타입'], ['grade','스폰서 등급'],
  ['equip_cat','비품 카탈로그 분류'], ['graphic_cat','그래픽 품목 분류']];

function evBoothHtml(ev){
  return EV_BOOTH_LISTS.map(([key, label]) => {
    const mine = clRowsOf(key, ev.key);
    const common = clRowsOf(key, '');
    const inherited = !mine.length;
    return `<div style="margin-bottom:22px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="font-size:var(--fs-12);font-weight:700;color:var(--i2)">${escapeHtml(label)}</div>
        <span class="pill ${inherited ? 'p-gray' : 'p-blue'}">${inherited ? '공통' : '이 행사'}</span>
      </div>
      ${!inherited ? clRowsHtml(mine, false)
        : common.length
          ? `<div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:8px">이 행사 전용 목록이 없어 <b>공통 목록</b>을 씁니다. 아래에 항목을 추가하거나 공통을 복제하면, 그때부터 이 행사는 자기 목록만 씁니다.</div>
             <div style="opacity:.55;pointer-events:none">${clRowsHtml(common, true)}</div>
             <button class="btn" style="font-size:var(--fs-11);margin-top:8px" onclick="cloneCommonCodeList('${escAttr(key)}')">공통 ${common.length}개를 이 행사로 복제</button>`
          : `<div style="font-size:var(--fs-11);color:var(--i4)">공통 목록에도 이 행사 전용으로도 아직 항목이 없어요. 아래에서 추가하면 이 행사 전용 목록이 만들어집니다.</div>`}
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--i6)">
        <div style="flex:1;min-width:140px"><div class="mlbl">저장값</div>
          <input class="fi" id="evcl-code-${escAttr(key)}" placeholder="예: Block System D" style="width:100%"
            onkeydown="if(event.key==='Enter')addEvCodeRow('${escAttr(key)}')"></div>
        <div style="flex:1;min-width:140px"><div class="mlbl">화면에 보일 이름</div>
          <input class="fi" id="evcl-label-${escAttr(key)}" placeholder="비우면 저장값 그대로" style="width:100%"
            onkeydown="if(event.key==='Enter')addEvCodeRow('${escAttr(key)}')"></div>
        <button class="btn bp" onclick="addEvCodeRow('${escAttr(key)}')" style="min-width:60px;height:36px">추가</button>
      </div>
      ${key === 'booth_type' ? `<div style="margin-top:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:var(--fs-11);color:var(--i4);flex:1;min-width:160px">기본 제공 품목은 부스 타입을 <b>고칠 때</b> 들어갑니다 — 이미 부스가 정해진 기업에는 여기서 한 번에 넣으세요.</span>
        <button class="btn bs" onclick="applyBoothItemsToEvent('${escAttr(ev.key)}')">참가기업 전체에 지금 반영</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

export async function addEvCodeRow(listKey){
  const ev = EVENT_LIST.find(e => e.key === settingsUi.evDetailKey);
  if(!ev) return;
  const code = (document.getElementById(`evcl-code-${listKey}`)?.value || '').trim();
  if(!code){ document.getElementById(`evcl-code-${listKey}`)?.focus(); return; }
  if(clRowsOf(listKey, ev.key).some(c => c.code === code)){ alert('이미 있는 값이에요.'); return; }

  const rows = clRowsOf(listKey, ev.key);
  const row = {
    id: `CD-${listKey}-${clSlug(ev.key)}-${clSlug(code)}-${Math.random().toString(36).slice(2, 6)}`,
    list_key: listKey, event_id: ev.key, code,
    label: (document.getElementById(`evcl-label-${listKey}`)?.value || '').trim() || code,
    cls: '', note: '', active: '',
    sort_order: String((Number(rows[rows.length - 1]?.sort_order) || rows.length * 10) + 10),
  };
  CODE_LISTS.push(row);
  const r = await saveCodeRow(row, '선택 목록 추가');
  if(!r.ok){ CODE_LISTS.pop(); renderEvDetail(); return; }
  applyCodeLists();
  trackAction('edit', '선택 목록 추가', row.label, `${clDef(listKey).label}(${ev.key})에 "${row.label}" 추가`);
  renderEvDetail();
}

/* 공통을 통째로 이 행사 것으로 옮겨 적는다. 한 줄만 고치고 싶어도 행사 전용
   목록이 생기는 순간 공통은 안 쓰이므로, 나머지도 같이 넘겨야 목록이 줄지 않는다. */
export async function cloneCommonCodeList(listKey){
  const ev = EVENT_LIST.find(e => e.key === settingsUi.evDetailKey);
  if(!ev) return;
  const common = clRowsOf(listKey, '');
  if(!common.length) return;
  if(clRowsOf(listKey, ev.key).length){ renderEvDetail(); return; }
  if(!confirm(`공통 ${clDef(listKey).label} ${common.length}개를 ${ev.key} 전용으로 복제할까요?\n복제한 뒤에는 이 행사만 따로 고칠 수 있고, 공통을 고쳐도 이 행사에는 반영되지 않습니다.`)) return;

  const made = [];
  for(const c of common){
    const row = { ...c, event_id: ev.key,
      id: `CD-${listKey}-${clSlug(ev.key)}-${clSlug(c.code)}-${Math.random().toString(36).slice(2, 6)}` };
    CODE_LISTS.push(row);
    const r = await saveCodeRow(row, '선택 목록 복제');
    if(!r.ok){
      // 중간에 끊기면 반쪽짜리 목록이 남는다 — 넣은 것만 되돌리고 멈춘다
      [...made, row].forEach(x => { const i = CODE_LISTS.indexOf(x); if(i >= 0) CODE_LISTS.splice(i, 1); });
      alert('복제 도중 저장에 실패했어요. 아무것도 바뀌지 않았습니다.');
      applyCodeLists(); renderEvDetail(); return;
    }
    made.push(row);
  }
  applyCodeLists();
  trackAction('edit', '선택 목록 복제', ev.key, `${clDef(listKey).label} 공통 ${made.length}개를 ${ev.key} 전용으로 복제`);
  renderEvDetail();
}

/* ── 일정 ──
   전에는 전시 탭 대시보드의 "마감일 설정"에서만 고칠 수 있었다. 설정을 찾으러
   여기 온 사람을 전시 탭으로 돌려보내지 않으려고 같은 값을 여기서도 고친다.
   담기는 자리(EXH_CFG.due / .book)는 그대로라 전시 탭과 늘 같은 값을 본다. */
const EV_DUE_STEPS = Object.entries(DUE_LABEL);
const EV_BOOK_DEFAULT = { chars: 1300, words: 200 };

function evDueHtml(ev){
  const cfg = EXH_CFG[ev.key] || {};
  const due = cfg.due || {}, book = cfg.book || {};
  const fl = followCfg(ev.key);
  return `
    <div style="font-size:var(--fs-12);font-weight:700;color:var(--i2);margin-bottom:4px">리마인더 기준</div>
    <div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:8px;line-height:1.6">요청 메일을 보내면 공은 연사·기업에 있어요. 그래도 자료가 안 오면
      아래 날수가 지난 뒤 연사·전시 «처리 필요»에 «🔔 리마인더 보낼 때»로 올라옵니다. 사정이 있는 곳은 화면에서 «+3일 / +1주»로 미룹니다.</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-bottom:18px;font-size:var(--fs-11_5);color:var(--i3)">
      <span>첫 요청 뒤 <input class="fi" type="number" min="1" max="60" id="evd-follow-first" value="${escapeHtml(fl.first)}" style="width:60px;padding:3px 6px">일</span>
      <span>리마인더 뒤 <input class="fi" type="number" min="1" max="60" id="evd-follow-again" value="${escapeHtml(fl.again)}" style="width:60px;padding:3px 6px">일마다</span>
    </div>
    <div style="font-size:var(--fs-12);font-weight:700;color:var(--i2);margin-bottom:4px">꼭 지켜야 하는 마감 <span style="font-weight:400;color:var(--i4)">(전시)</span></div>
    <div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:10px;line-height:1.6">대부분은 비워 두세요 — 비우면 ASAP이고 위 리마인더 기준으로 챙깁니다.
      도록 인쇄·반입처럼 넘기면 안 되는 것만 «행사 N일 전»으로 적으면 행사 날짜가 바뀌어도 따라갑니다. 연사 단계 마감은 «연락 단계 편집»에서 같은 방식으로 적습니다.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px 14px;margin-bottom:18px">
      ${EV_DUE_STEPS.map(([k, l]) => `<div><div class="mlbl">${escapeHtml(l)}</div>${dueInputHtml(`evd-due-${k}`, due[k] || '', ev.key)}</div>`).join('')}
    </div>
    <div style="font-size:var(--fs-12);font-weight:700;color:var(--i2);margin-bottom:4px">프로그램북 한도</div>
    <div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:10px">지면 기준이 행사마다 달라요. 비워 두면 기본값(${EV_BOOK_DEFAULT.chars.toLocaleString()}자 · ${EV_BOOK_DEFAULT.words}단어)을 씁니다.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;max-width:320px;margin-bottom:14px">
      <div><div class="mlbl">글자수</div>
        <input class="fi" type="number" id="evd-book-chars" value="${escapeHtml(book.chars || EV_BOOK_DEFAULT.chars)}" style="width:100%"></div>
      <div><div class="mlbl">단어수</div>
        <input class="fi" type="number" id="evd-book-words" value="${escapeHtml(book.words || EV_BOOK_DEFAULT.words)}" style="width:100%"></div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn bp" onclick="saveEvDue()" style="min-width:80px">저장</button>
      <span id="evd-due-msg" style="font-size:var(--fs-11);color:var(--g)"></span>
    </div>`;
}

export async function saveEvDue(){
  const ev = EVENT_LIST.find(e => e.key === settingsUi.evDetailKey);
  if(!ev) return;
  const msg = document.getElementById('evd-due-msg');
  const say = (t, ok) => { if(msg){ msg.style.color = ok ? 'var(--g)' : 'var(--re)'; msg.textContent = t; } };

  const chars = Number(document.getElementById('evd-book-chars')?.value);
  const words = Number(document.getElementById('evd-book-words')?.value);
  if(!(chars > 0) || !(words > 0)){ say('글자수·단어수 한도는 1 이상이어야 해요.'); return; }

  /* 이 화면에 없는 마감(다른 화면에서 정한 것)은 그대로 둔다 */
  const due = { ...((EXH_CFG[ev.key] || {}).due || {}) };
  EV_DUE_STEPS.forEach(([k]) => { delete due[k]; });
  EV_DUE_STEPS.forEach(([k]) => {
    const v = readDueInput(`evd-due-${k}`);
    if(v) due[k] = v;   // 빈 칸은 안 담는다 — 마감 없음과 빈 문자열을 구분할 필요가 없다
  });

  const prev = EXH_CFG[ev.key] ? JSON.parse(JSON.stringify(EXH_CFG[ev.key])) : undefined;
  const ff = Number(document.getElementById('evd-follow-first')?.value), fa = Number(document.getElementById('evd-follow-again')?.value);
  if(!(ff >= 1) || !(fa >= 1)){ say('리마인더 날수는 1 이상이어야 해요.'); return; }
  const follow = { first: ff, again: fa };
  const cfg = { ...(prev || {}), due, book: { chars, words }, follow };
  EXH_CFG[ev.key] = cfg;
  const r = await saveExhCfgToSheet(ev.key, cfg);
  if(r && r.ok === false){
    if(prev) EXH_CFG[ev.key] = prev; else delete EXH_CFG[ev.key];
    say('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.'); renderEvDetail(); return;
  }

  const changed = [];
  EV_DUE_STEPS.forEach(([k, l]) => {
    const a = ((prev || {}).due || {})[k] || '', b = due[k] || '';
    if(a !== b) changed.push(`${l} ${a || '없음'} → ${b || '없음'}`);
  });
  const pf = (prev || {}).follow || FOLLOW_DEFAULT;
  if(Number(pf.first) !== ff || Number(pf.again) !== fa) changed.push(`리마인더 기준 ${pf.first}일·${pf.again}일 → ${ff}일·${fa}일`);
  const pb = (prev || {}).book || {};
  if(pb.chars !== chars || pb.words !== words){
    changed.push(`프로그램북 한도 ${pb.chars || EV_BOOK_DEFAULT.chars}자·${pb.words || EV_BOOK_DEFAULT.words}단어 → ${chars}자·${words}단어`);
  }
  if(changed.length) trackAction('edit', '행사 설정 변경', ev.key, changed.join(' / '));

  say('저장했어요.', true);
  renderEvCfgList();
  window.renderExh?.();
  setTimeout(() => { const m = document.getElementById('evd-due-msg'); if(m) m.textContent = ''; }, 2000);
}

window.openEvDetail        = openEvDetail;
window.closeEvDetail       = closeEvDetail;
window.setEvDetailSeg      = setEvDetailSeg;
window.renderEvDetail      = renderEvDetail;
window.saveEvBasic         = saveEvBasic;
window.setEvPart           = setEvPart;
window.addEvCodeRow        = addEvCodeRow;
window.cloneCommonCodeList = cloneCommonCodeList;
window.saveEvDue           = saveEvDue;

/* «설정 › 행사 상세 › 컨퍼런스 설정»은 ../features/settings/conf-settings.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */

/* 화면의 onclick이 부르는 것 */
window.closeEvDetail = closeEvDetail;   // 탭(settings-tab.js)이 window로 부른다
window.renderEvDetail = renderEvDetail;   // 탭(settings-tab.js)이 window로 부른다
