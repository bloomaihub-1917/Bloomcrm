/* ══════════════════════════════════════════════════════════════
   speaker-drawer.js — 연사 한 사람의 상세

   왜 이렇게 갈랐나
   ---------------
   연사에게 받아야 하는 것은 한 덩어리가 아니다. 성명·소속·직함은 사람에게
   붙고, 발제명·초록·발표자료는 «그 사람이 그 세션에서 맡은 역할»에 붙는다.
   한 사람이 두 세션에서 발표하면 발제도 둘이다. 그래서 발제 정보는 연사 줄이
   아니라 배정 줄(session_speakers)에 저장한다.

   이력은 국·영문을 따로 받는다. 해외 연사는 보통 영문만 주므로 국문이 비어
   있는 것이 정상이고, 그걸 «안 받은 것»으로 세면 안 된다 — 그래서 받았는지는
   글자 유무가 아니라 profile_received_at 한 칸으로 본다.

   글자수 한도는 행사마다 다르다. 여기서는 컨퍼런스 설정의 한도를 읽어
   지금 몇 자인지만 보여준다. 넘었다고 막지는 않는다 — 원문을 잘라 두면
   무엇을 받았는지가 사라진다.
═══════════════════════════════════════════════════════════════ */

import {
  contacts, EVENT_LIST, currentUser,
  SPEAKERS, SESSION_SPEAKERS, CONF_SESSIONS, SPEAKER_CONTACTS, SPEAKER_LOGS,
  getSpeakerById, assignmentsFor, rolesOfSpeaker,
  contactsOfSpeaker, logsOfSpeaker,
  confCfg, speakerNeed, speakerNeedList,
  isDomesticSpeaker, autoDomestic, bankDocs, paysFee,
} from '../state.js';
import { SPEAKER_ROLES, NEED_MARK, NEED_LABEL, SP_CONSENTS } from '../constants.js';
import './flow-editor.js';
import { td, nowStamp, mailDirPill, escapeHtml, escAttr, countryOptions, countryName, splitQuotedMail } from '../utils.js';
/* 보낸 기록 본문 — 이전 메일(인용)은 접어 둔다(utils.js splitQuotedMail) */
const mailBodyHtml = (body) => {
  const m = splitQuotedMail(body);
  if(!m.head && !m.quoted) return escapeHtml(m.attach || '(본문 없음)');
  return `${escapeHtml(m.head || '(새로 쓴 내용 없음)')}${m.attach ? `\n\n${escapeHtml(m.attach)}` : ''}${m.quoted
    ? `<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--i4);font-size:10.5px">▸ 이전 메일 보기 (${m.quoted.split('\n').length}줄)</summary><div style="margin-top:6px;padding-left:8px;border-left:2px solid var(--i6);color:var(--i3)">${escapeHtml(m.quoted)}</div></details>` : ''}`;
};
import {
  saveSpeaker, saveSessionSpeaker,
  saveSpeakerContact, deleteSpeakerContact,
  saveSpeakerLog, sendMail, eventMailFrom, loadMailFiles, mailFilesOf, fileToBase64,
} from '../api.js';
import { filterMail, mailFilBar, mailStateHtml, mailActionsHtml, mailToggleAttr, isPending, setMailDone } from './mail-mark.js';
import { decorate as decorateMailPane } from './mail-pane.js';
import { trackAction, changed, removed } from './audit-tab.js';
import { patchContact } from './db-tab.js';
import { confLocked, setConfLockEv, confLockNotice, renderConf, buildConfEvList, syncPartRole, spCell } from './conf-tab.js';
import { flowStatus, draftFor, missingItems, pendingItems, PART_LABEL } from './speaker-flow.js';
import { reuseCandidates, reusePending } from './contact-speaker.js';

let spId = null;
let spTab = 'basic';

const TABS = [
  { key: 'basic',  label: '기본' },
  { key: 'bio',    label: '이력' },
  { key: 'talk',   label: '발제' },
  { key: 'offer',  label: '제공사항' },
  { key: 'bank',   label: '계좌·여권' },
  { key: 'people', label: '연락 상대' },
  /* 주고받은 기록은 쓰는 칸과 따로 둔다 — 한 탭에 있으면 받은 메일을 챙기려고
     매번 쓰기 칸을 지나 내려가야 했다 */
  { key: 'box',    label: '메일함' },
  { key: 'mail',   label: '메일' },
];

const STATUSES = ['섭외중', '확정', '보류', '취소'];

/* ── 여닫기 ── */
export function openSpeakerDr(id, tab){
  /* 다른 연사로 옮기면 계좌를 다시 가린다 — 한 번 연 게 다음 사람까지
     따라오면 열람 기록과 실제로 본 것이 어긋난다. */
  if(spId !== id){
    spReply = null;
    bankRevealed = false;
    /* PC에서 고른 첨부는 그 사람 몫이다 — 다음 연사 메일로 따라가면 여권·계좌
       서류가 엉뚱한 사람에게 나간다 */
    spLocalFiles = []; spSkipDefault = new Set();
  }
  spId = id;
  setConfLockEv(getSpeakerById(id)?.event_id);
  if(tab && TABS.some(t => t.key === tab)) spTab = tab;
  document.getElementById('sp-dr')?.classList.add('on');
  document.getElementById('sp-bd')?.classList.add('on');
  renderSpeakerDr();
}
export function closeSpeakerDr(){
  spId = null;
  spReply = null;
  setConfLockEv(null);
  spLocalFiles = []; spSkipDefault = new Set();
  bankRevealed = false;
  document.getElementById('sp-dr')?.classList.remove('on');
  document.getElementById('sp-bd')?.classList.remove('on');
}
export function switchSpeakerDT(v){ spTab = v; renderSpeakerDr(); }

/* ── 저장 ──
   화면을 먼저 바꾸고 실패하면 되돌린다. 저장이 안 됐는데 화면만 바뀌면
   받은 줄 알고 다시 묻지 않게 된다. */
async function patchSpeaker(patch, label, id = spId){
  if(confLocked()){ confLockNotice(); return { ok: false, locked: true }; }
  const sp = getSpeakerById(id);
  if(!sp) return { ok: false };
  const backup = {};
  Object.keys(patch).forEach(k => { backup[k] = sp[k]; });
  Object.assign(sp, patch);
  renderSpeakerDr();

  const r = await saveSpeaker({ id: sp.id, ...patch, updated_at: td() });
  if(!r || r.ok === false){
    Object.assign(sp, backup);
    renderSpeakerDr();
    if(!r?.locked) alert('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    return r || { ok: false };
  }
  sp.updated_at = td();
  if(label) trackAction('edit', '연사', sp.event_id, `${sp.name_snapshot || sp.name_en || sp.id} — ${label}`,
    changed('speakers', sp.id, backup, patch, { kind: 'speaker', id: sp.id }));
  renderConf();
  buildConfEvList();
  return r;
}

/* 발제는 배정 줄에 저장한다 — 한 사람이 두 세션에서 발표하면 발제도 둘이다 */
async function patchAssign(aid, patch, label){
  if(confLocked()){ confLockNotice(); return { ok: false, locked: true }; }
  const a = SESSION_SPEAKERS.find(x => x.id === aid);
  if(!a) return { ok: false };
  const backup = {};
  Object.keys(patch).forEach(k => { backup[k] = a[k]; });
  Object.assign(a, patch);
  renderSpeakerDr();

  const r = await saveSessionSpeaker({ id: aid, ...patch });
  if(!r || r.ok === false){
    Object.assign(a, backup);
    renderSpeakerDr();
    if(!r?.locked) alert('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    return r || { ok: false };
  }
  if(label) trackAction('edit', '세션 배정', a.event_id, `${speakerLabel()} — ${label}`,
    changed('session_speakers', aid, backup, patch, { kind: 'speaker', id: a.speaker_id }));
  renderConf();
  return r;
}

/* 은/는을 받침으로 가른다 — 역할 이름이 문장에 들어가므로 «좌장는»이 되면
   우리가 적은 글이 아니라 기계가 뱉은 글처럼 읽힌다. */
function eunNeun(word){
  const ch = String(word || '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if(!(code >= 0xAC00 && code <= 0xD7A3)) return '는';   // 한글이 아니면 «는»
  return (code - 0xAC00) % 28 === 0 ? '는' : '은';
}

const speakerLabel = () => {
  const sp = getSpeakerById(spId);
  return sp ? (sp.name_snapshot || sp.name_en || sp.id) : '';
};

/* 인라인 핸들러가 부르는 얇은 껍데기 — 값이 그대로면 저장하지 않는다
   (포커스가 빠질 때마다 같은 값을 보내면 기록이 변경 이력으로 더러워진다) */
export function spField(field, value, label){
  const sp = getSpeakerById(spId);
  if(!sp || String(sp[field] ?? '') === String(value ?? '')) return;
  patchSpeaker({ [field]: value }, label || field);
}
export function asField(aid, field, value, label){
  const a = SESSION_SPEAKERS.find(x => x.id === aid);
  if(!a || String(a[field] ?? '') === String(value ?? '')) return;
  patchAssign(aid, { [field]: value }, label || field);
}

/* 받았다고 체크하면 오늘 날짜를 찍는다 — 전시 쪽과 같은 규칙이다.
   날짜를 손으로 고칠 수 있어야 하니 칸도 함께 보여준다. */
export function spStamp(field, label){
  const sp = getSpeakerById(spId);
  if(!sp) return;
  patchSpeaker({ [field]: sp[field] ? '' : td() }, label);
}
export function asStamp(aid, field, label){
  const a = SESSION_SPEAKERS.find(x => x.id === aid);
  if(!a) return;
  patchAssign(aid, { [field]: a[field] ? '' : td() }, label);
}

/* ══════════════════════════════════════════
   렌더
══════════════════════════════════════════ */
export function renderSpeakerDr(){
  if(!spId) return;
  const sp = getSpeakerById(spId);
  if(!sp){ closeSpeakerDr(); return; }
  const evKey = sp.event_id;
  const roles = rolesOfSpeaker(sp.id);
  const con = sp.contact_id ? contacts.find(c => String(c.id) === String(sp.contact_id)) : null;

  const h = document.getElementById('sp-drh');
  if(h) h.innerHTML = `
    <div style="flex:1;min-width:0">
      <div class="drnm">${escapeHtml(sp.name_snapshot || sp.name_en || '(이름 없음)')}${
        sp.name_snapshot && sp.name_en
          ? `<span style="font-size:12px;font-weight:400;color:var(--i4);margin-left:6px">${escapeHtml(sp.name_en)}</span>` : ''}
        ${roles.map(r => `<span class="pill ${(SPEAKER_ROLES.find(x => x.key === r) || {}).cls || 'p-gray'}"
          style="vertical-align:middle;font-size:10px">${escapeHtml(r)}</span>`).join(' ')}</div>
      <div class="drmt">${escapeHtml(sp.status || '섭외중')}${
        payCountry(sp) ? ` · ${escapeHtml(countryName(payCountry(sp)))}${
          (sp.nationality && sp.residence_country && sp.nationality !== sp.residence_country)
            ? ` <span style="color:var(--am)">(국적 ${escapeHtml(countryName(sp.nationality))})</span>` : ''}` : ''}${
        (sp.org_ko || sp.org_en || sp.title_ko || sp.title_en)
          ? ` · ${escapeHtml([sp.org_ko || sp.org_en, sp.title_ko || sp.title_en].filter(Boolean).join(' '))}`
          : ' · 소속·직함 없음'}${
        con ? '' : ' · 연락처 연결 안 됨'}${
        assignmentsFor(sp.id).length ? ` · 세션 ${assignmentsFor(sp.id).length}` : ''}</div>
    </div>
    <button class="btn" style="font-size:10.5px;color:var(--re);align-self:center"
      onclick="removeSpeakerFromDr()" title="이 연사를 지웁니다 — 배정·연락 상대·기록도 함께">지우기</button>
    <button class="drcls" onclick="closeSpeakerDr()">✕</button>`;

  /* 탭 배지는 «남은 일»(pendingItems) 하나로 — 주황 숫자는 지금 받을 필수만,
     나중 일·우리가 할 일은 회색 점, 있으면 좋음은 표시하지 않는다 */
  const pend = pendingItems(sp);
  const nowN = (tab) => pend.filter(x => x.tab === tab && x.when === 'now').length;
  const dotOf = (tab) => pend.some(x => x.tab === tab && (x.when === 'later' || x.when === 'ours'));
  const left = {
    basic: nowN('basic'),
    bio: nowN('bio'),
    talk: nowN('talk'),
    /* 수신이 없으면 메일을 못 보낸다 — 메일 탭을 열어 보고 알기보다
       탭에서 먼저 보이는 게 낫다 */
    people: mailTargets(sp.id).to.length ? 0 : 1,
    box: logsOfSpeaker(sp.id).filter(isPending).length,    // 처리 안 한 받은 메일
    mail: 0,
    offer: nowN('offer'),
    bank: nowN('bank'),
  };
  const tabsEl = document.getElementById('sp-drtabs');
  if(tabsEl) tabsEl.innerHTML = TABS.map(t =>
    `<button class="drtab${spTab === t.key ? ' on' : ''}" onclick="switchSpeakerDT('${t.key}')">${t.label}${
      left[t.key] ? ` <span class="pill p-amber">${left[t.key]}</span>`
      : dotOf(t.key) ? ` <span title="나중 일·우리가 할 일이 있어요" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--i5);vertical-align:middle"></span>` : ''}</button>`).join('');

  const b = document.getElementById('sp-drbd');
  if(b){
    b.classList.toggle('ro', confLocked());
    b.innerHTML = flowBoxHtml(sp) + reuseBoxHtml(sp) + (spTab === 'bio' ? bioHtml(sp, evKey)
      : spTab === 'talk' ? talkHtml(sp, evKey)
      : spTab === 'offer' ? offerHtml(sp, evKey)
      : spTab === 'bank' ? bankHtml(sp, evKey)
      : spTab === 'people' ? peopleTabHtml(sp)
      : spTab === 'box' ? boxTabHtml(sp)
      : spTab === 'mail' ? mailTabHtml(sp, evKey)
      : basicHtml(sp, con, evKey));
    /* 초안 만들기로 넘어왔으면 메일 칸을 채운다 — 칸은 위에서 막 그려졌다 */
    if(spTab === 'mail' && spReply){ fillSpeakerReply(); }
    else if(spTab === 'mail' && pendingDraft){ fillSpeakerMail(pendingDraft); pendingDraft = ''; }
    else if(spTab === 'mail'){
      const k = document.getElementById('sp-mail-kind')?.value;
      if(k && !document.getElementById('sp-mail-body')?.value) fillSpeakerMail(k);
    }
    /* 기본 첨부 목록은 서버에서 받아야 해서 늦게 온다 — 오면 첨부 칸만 다시 그린다 */
    if(spTab === 'mail') loadMailFiles(evKey).then(() => renderSpMailFiles());
    if(spTab === 'mail') eventMailFrom(evKey).then(f => {
      const el = document.getElementById('sp-mail-from');
      if(el) el.innerHTML = f.ok ? `발신 <b>${escapeHtml(f.text)}</b>` : `<b style="color:var(--re)">발신 ${escapeHtml(f.text)}</b>`;
    });
  }
  // 메일함 나란히·고정 띠(mail-pane.js)
  decorateMailPane('sp');
}
// mail-pane.js가 왼쪽 칸에 이 연사 메일함을 그릴 때 쓴다
window.__spDrId = () => spId;
window.__spBoxHtml = (id) => { const s = getSpeakerById(id); return s ? boxTabHtml(s) : ''; };

/* ── 연락 단계 ──
   연사 화면 맨 위. 지금 어느 단계인지, 다음에 무엇을 하면 되는지, 그 메일 초안.
   단계와 끝난 기준은 speaker-flow.js, 행사별 문구는 설정 › 행사 › 컨퍼런스. */
let pendingDraft = '';
/* ── 지난 자료 ──
   같은 사람을 지난 행사에서도 불렀으면 그때 받은 약력·사진·CV를 가져온다.
   가져온 뒤에는 «확인 대기» — 연사가 맞다고 하면 «확인됨»으로 받은 날을 찍는다.
   규칙은 contact-speaker.js에 있다. */
function reuseBoxHtml(sp){
  const pend = reusePending(sp);
  if(pend.length){
    return `<div style="padding:8px 11px;border:1px solid var(--am);border-radius:8px;margin-bottom:12px;background:var(--ab)">
      <div style="font-size:11.5px;font-weight:700;color:var(--am)">지난 자료 확인 대기 · ${escapeHtml(pend.map(g => g.label).join(' · '))}</div>
      <div style="font-size:10.5px;color:var(--i3);margin-top:2px;line-height:1.6">${escapeHtml(sp.reuse_from || '')}에서 ${escapeHtml(sp.reused_at)}에 가져왔어요.
        자료 받기 메일이 «확인 요청»으로 나갑니다. 연사가 맞다고 하면 확인됨을 누르세요 — 고친 자료가 오면 칸을 고친 뒤 누릅니다.</div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn bp" style="font-size:10.5px" onclick="confirmSpReuse()">확인됨 — 받은 날 찍기</button>
      </div></div>`;
  }
  const c = reuseCandidates(sp);
  if(!c) return '';
  return `<div style="padding:8px 11px;border:1px dashed var(--a);border-radius:8px;margin-bottom:12px">
    <div style="font-size:11.5px;font-weight:700;color:var(--i2)">지난 행사에서 받은 자료가 있어요 · ${escapeHtml(c.groups.map(g => g.label).join(' · '))}</div>
    <div style="font-size:10.5px;color:var(--i4);margin-top:2px;line-height:1.6">${escapeHtml(c.from.join(', '))}에서 가장 최근 것을 비어 있는 칸에만 넣습니다.
      새로 작성을 부탁하는 대신 «맞는지 확인» 메일을 보내게 돼요.</div>
    <div style="display:flex;gap:6px;margin-top:6px">
      <button class="btn bp" style="font-size:10.5px" onclick="applySpReuse()">지난 자료 가져오기</button>
    </div></div>`;
}
export async function applySpReuse(){
  const sp = getSpeakerById(spId);
  const c = reuseCandidates(sp);
  if(!c) return;
  await patchSpeaker({ ...c.patch, reuse_from: c.from.join(','), reused_at: td() },
    `지난 자료 가져오기 (${c.from.join(', ')} · ${c.groups.map(g => g.label).join('·')})`);
}
export async function confirmSpReuse(){
  const sp = getSpeakerById(spId);
  const pend = reusePending(sp);
  if(!pend.length) return;
  const patch = {};
  pend.forEach(g => { patch[g.at] = td(); });
  await patchSpeaker(patch, `지난 자료 확인됨 (${pend.map(g => g.label).join('·')})`);
}

/* 남은 일 — 순서대로 묶고, 항목마다 그 파트 탭으로 바로 간다 */
function pendingHtml(sp){
  const pend = pendingItems(sp);
  if(!pend.length) return '';
  const G = [['now', '지금 받을 것', 'var(--re)'], ['later', '다음에 받을 것', 'var(--am)'],
    ['ours', '우리가 할 일', 'var(--a)'], ['nice', '있으면 좋음', 'var(--i4)']];
  const item = (x) => `<a href="#" onclick="switchSpeakerDT('${x.tab}');return false"
      style="display:inline-flex;gap:3px;align-items:center;margin:1px 8px 1px 0;color:var(--i2);text-decoration:none;font-size:11px">
      ${escapeHtml(x.label)}${x.more ? `<span style="color:var(--i4)">(${escapeHtml(x.more)})</span>` : ''}
      <span style="font-size:9.5px;color:var(--i5)">[${PART_LABEL[x.tab] || ''}]</span></a>`;
  return `<div style="margin-top:6px;display:grid;grid-template-columns:auto 1fr;gap:3px 8px;align-items:baseline">
    ${G.map(([k, l, c]) => { const xs = pend.filter(x => x.when === k); if(!xs.length) return '';
      const due = xs.find(x => x.due)?.due || '';
      return `<span style="font-size:10.5px;font-weight:700;color:${c};white-space:nowrap">${l}</span>
        <div>${xs.map(item).join('')}${due && k !== 'nice' ? `<span style="font-size:10px;color:var(--i4)">— 마감 ${escapeHtml(due)}</span>` : ''}</div>`; }).join('')}
  </div>`;
}

function flowBoxHtml(sp){
  const f = flowStatus(sp);
  if(f.skip) return `<div style="padding:8px 11px;border:1px solid var(--i6);border-radius:8px;margin-bottom:12px;
    background:var(--i8);font-size:11px;color:var(--i4)">${f.cancelled
      ? '연락 단계 없음 — 취소한 연사라 더 연락하지 않아요. 섭외 상태를 바꾸면 다시 나타납니다.'
      : '연락 단계 없음 — VIP는 주최사에서 정보를 받아 전달받으므로 메일로 연락하지 않아요.'}</div>`;
  const chip = (s) => {
    const cur = f.current && f.current.key === s.key;
    const st = !s.applies ? { m: '–', c: 'var(--i5)', bg: 'transparent', t: '이 연사에게는 해당 없음' }
      : s.isDone ? { m: '✓', c: 'var(--g)', bg: 'var(--gb)', t: '끝남' }
      : cur ? { m: '●', c: 'var(--a)', bg: 'var(--ad)', t: '지금 할 일' }
      : { m: '○', c: 'var(--i4)', bg: 'var(--i8)', t: '아직' };
    /* 날짜를 찍어 끝나는 단계만 되돌릴 수 있다 — 자료 받기처럼 받은 자료로 끝나는
       단계는 자료 칸을 고쳐야 바뀐다 */
    const undo = s.applies && s.isDone && s.done.startsWith('field:');
    return `<span title="${escAttr(`${s.label} — ${st.t}${undo ? ' · 눌러서 되돌리기' : ''}`)}"${
      undo ? ` onclick="undoSpStep('${escAttr(s.key)}')"` : ''} style="${undo ? 'cursor:pointer;' : ''}display:inline-flex;align-items:center;gap:3px;
      font-size:10px;padding:2px 7px;border-radius:10px;background:${st.bg};color:${st.c};
      ${cur ? 'font-weight:700;' : ''}${s.applies ? '' : 'text-decoration:line-through;'}white-space:nowrap">${st.m} ${escapeHtml(s.label)}</span>`;
  };
  const cur = f.current;
  const left = cur && cur.key === 'collect' ? missingItems(sp) : [];
  /* 바로 앞에서 끝난, 날짜로 끝나는 단계 — 잘못 넘어갔을 때 한 번에 돌아간다 */
  const curIdx = cur ? f.steps.indexOf(cur) : f.steps.length;
  const prevUndo = f.steps.slice(0, curIdx).reverse()
    .find(x => x.applies && x.isDone && x.done.startsWith('field:')) || null;
  /* 사람이 받아서 적는 단계 — 메일을 보낸다고 끝나지 않는다 */
  const markBtn = cur && cur.done.startsWith('field:') && cur.key !== 'invite'
    ? `<button class="btn" style="font-size:10.5px" onclick="spStamp('${cur.done.slice(6)}','${escAttr(cur.label)}')">${
        cur.key === 'reply' ? '회신 받음 표시' : cur.key === 'confirm' ? '참가 확정 표시' : '끝남 표시'}</button>` : '';
  return `<div style="padding:9px 11px;border:1px solid var(--a);border-radius:8px;margin-bottom:12px;background:var(--W)">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <span style="font-size:11px;font-weight:700;color:var(--i2)">연락 단계</span>
      <span style="font-size:10.5px;color:var(--i4)">${f.nDone}/${f.nAll}</span>
      <button class="btn" style="font-size:10px;padding:1px 7px;margin-left:auto" title="이 행사의 연락 단계를 더하고, 고치고, 끄거나 지웁니다"
        onclick="openFlowEditor('${escAttr(sp.event_id)}')">✎ 단계 편집</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">${f.steps.map(chip).join('')}</div>
    ${cur ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--i7)">
        <div style="font-size:12px;font-weight:700;color:var(--a)">지금 할 일 · ${escapeHtml(f.remind ? '자료 독촉' : cur.label)}${
          cur.due ? ` <span style="font-weight:400;color:${cur.due < td() ? 'var(--re)' : 'var(--i4)'};font-size:10.5px">마감 ${escapeHtml(cur.due)}</span>` : ''}</div>
        <div style="font-size:10.5px;color:var(--i4);margin-top:2px;line-height:1.6">${escapeHtml(cur.desc || '')}</div>
        ${pendingHtml(sp)}
        <div style="display:flex;gap:6px;margin-top:7px;flex-wrap:wrap">
          <button class="btn bp" style="font-size:10.5px" onclick="openFlowDraft('${cur.key}')">✉ 메일 초안 만들기</button>
          <button class="btn" style="font-size:10.5px" title="이 단계가 보낼 차례인 연사들에게 한 번에 보냅니다"
            onclick="openSpeakerBulkMail('${escAttr(sp.event_id)}','${cur.key}')">📨 여러 연사에게</button>
          ${markBtn}
          ${prevUndo ? `<button class="btn" style="font-size:10.5px" onclick="undoSpStep('${escAttr(prevUndo.key)}')"
            title="«${escAttr(prevUndo.label)}»을 안 한 것으로 되돌립니다">↶ 이전 단계로</button>` : ''}
        </div></div>`
      : `<div style="font-size:11px;color:var(--g);margin-top:7px">이 행사의 연락 단계를 모두 마쳤어요.${
          prevUndo ? ` <button class="btn" style="font-size:10.5px;margin-left:6px" onclick="undoSpStep('${escAttr(prevUndo.key)}')">↶ 이전 단계로</button>` : ''}</div>`}
  </div>`;
}
/* 단계 되돌리기 — 찍힌 날짜를 지운다. 보낸 메일 기록은 그대로 둔다
   (이미 나간 메일은 되돌릴 수 없고, 무엇을 보냈는지는 남아야 한다). */
export async function undoSpStep(stepKey){
  if(confLocked()){ confLockNotice(); return; }
  const sp = getSpeakerById(spId);
  if(!sp) return;
  const step = flowStatus(sp).steps.find(x => x.key === stepKey);
  if(!step || !step.done.startsWith('field:')) return;
  const field = step.done.slice(6);
  if(!confirm(`«${step.label}»을 안 한 것으로 되돌릴까요?\n\n찍힌 날짜 ${sp[field] || ''}를 지웁니다. 보낸 메일 기록은 그대로 남아요.`)) return;
  await patchSpeaker({ [field]: '' }, `${step.label} 되돌림`);
}
window.undoSpStep = undoSpStep;

export function openFlowDraft(stepKey){
  pendingDraft = stepKey;
  spTab = 'mail';
  renderSpeakerDr();
}

/* ── «받아야 함»인데 아직 없는 것 ──
   역할이 요구하지 않는 항목은 세지 않는다. 좌장에게 초록이 없는 건
   빠진 게 아니라 애초에 묻지 않은 것이다. */
const needState = (evKey, roles, key) => {
  let best = '';
  roles.forEach(r => {
    const s = speakerNeed(evKey, r, key);
    if(s === 'req') best = 'req';
    else if(s === 'opt' && best !== 'req') best = 'opt';
  });
  return best;
};
const isReq = (evKey, roles, key) => needState(evKey, roles, key) === 'req';

function missingBasic(sp, con, evKey){
  const roles = rolesOfSpeaker(sp.id);
  const out = [];
  /* 연락처가 아니라 스냅숏을 본다 — 프로그램북에 나가는 건 이쪽이고,
     연락처를 연결하지 않은 연사도 소속을 적을 수 있어야 한다. */
  if(isReq(evKey, roles, 'profile') && !(sp.org_ko || sp.org_en)) out.push('소속');
  if(isReq(evKey, roles, 'photo') && !sp.photo_received_at) out.push('사진');
  if(isReq(evKey, roles, 'consent') && !sp.consent_at) out.push('개인정보 제공 동의');
  return out;
}
function missingBio(sp, evKey){
  const roles = rolesOfSpeaker(sp.id);
  const out = [];
  /* 판단은 연사 표 칸과 같은 곳(spCell)에서 — 둘이 다르게 세면 표는 끝났다는데 여기는 남았다고 한다 */
  [['bio_pro', '이력'], ['cv', 'CV']].forEach(([k, label]) => {
    const c = spCell(sp, evKey, k);
    if(c.state === 'todo' || c.state === 'part') out.push(c.state === 'part' && c.text ? `${label} (${c.text})` : label);
  });
  return out;
}
/* 제공사항은 «우리가 챙길 것»이다. 연사료를 적어 놓고 안 준 것,
   숙박·항공을 챙겨야 하는데 예약이 안 된 것만 센다. */
function missingOffer(sp, evKey){
  const roles = rolesOfSpeaker(sp.id);
  const out = [];
  if(sp.fee_amount && !sp.fee_paid_at) out.push('연사료 지급');
  if(needState(evKey, roles, 'travel')){
    if(sp.stay_hotel && sp.stay_booked !== 'yes') out.push('숙박 예약');
    if(sp.air_route && !sp.air_ticketed_at) out.push('항공 발권');
  }
  return out;
}
function missingBank(sp, evKey){
  const roles = rolesOfSpeaker(sp.id);
  const out = [];
  /* 연사료를 주기로 했으면 계좌가 있어야 한다. 금액이 없으면 무보수라
     계좌를 묻지 않는다 — 안 줄 사람에게 계좌를 요구할 이유가 없다. */
  if(isReq(evKey, roles, 'bank') && sp.fee_amount)
    bankDocs(sp).filter(d => !d.got).forEach(d => out.push(d.label));
  if(isDomestic(sp)) return out;   // 국내 연사는 여권을 묻지 않는다
  if(isReq(evKey, roles, 'passport') && !sp.passport_received_at) out.push('여권');
  return out;
}

function missingTalk(sp, evKey){
  const out = [];
  assignmentsFor(sp.id).forEach(a => {
    const need = (k) => speakerNeed(evKey, a.role, k) === 'req';
    if(need('title') && !(a.title_ko || a.title_en)) out.push('발제명');
    if(need('abstract') && !a.abstract_received_at) out.push('초록');
    if(need('slides') && !a.slides_received_at) out.push('발표자료');
  });
  return out;
}

/* ── 작은 조각들 ── */
/* 라벨을 이스케이프하지 않는다 — 글자수 표시처럼 이미 만들어 둔 조각이 들어온다.
   호출하는 자리의 라벨은 모두 이 파일의 고정 문구이고, 사람이 적은 값은
   섞지 않는다(섞을 일이 생기면 그 자리에서 escapeHtml을 씌운다). */
const fg = (label, inner, hint) => `<div class="fg"><label class="fl">${label}</label>${inner}${
  hint ? `<div style="font-size:10px;color:var(--i4);margin-top:3px">${hint}</div>` : ''}</div>`;

const txt = (val, handler, ph) => `<input class="fi" type="text" value="${escAttr(val || '')}"
  placeholder="${escAttr(ph || '')}" onchange="${handler}">`;

const area = (val, handler, ph, rows) => `<textarea class="fi" rows="${rows || 4}"
  placeholder="${escAttr(ph || '')}" style="resize:vertical" onchange="${handler}">${escapeHtml(val || '')}</textarea>`;

const dateIn = (val, handler) => `<input class="fi" type="date" value="${escAttr(val || '')}" onchange="${handler}">`;

/* 받았는지 — 체크는 오늘 날짜를 찍고, 날짜 칸은 손으로 고칠 수 있다 */
const gotRow = (label, date, toggleH, dateH, need) => `<div style="display:flex;align-items:center;gap:9px;
    padding:7px 0;border-bottom:1px solid var(--i7)">
    <input type="checkbox" ${date ? 'checked' : ''} onchange="${toggleH}">
    <div style="flex:1;min-width:0">
      <div style="font-size:12px">${escapeHtml(label)}
        ${need ? `<span style="color:var(--i4);font-size:10px" title="${escAttr(NEED_LABEL[need] || '')}">${NEED_MARK[need] || ''}</span>` : ''}</div>
    </div>
    <input class="fi" type="date" style="width:132px" value="${escAttr(date || '')}" onchange="${dateH}">
  </div>`;

/* 글자수 — 한도는 행사마다 다르고, 넘어도 막지 않는다.
   해외 연사는 국문이 비는 게 정상이라 빈 칸을 «넘침»처럼 보이게 하지 않는다. */
const countHint = (val, limit) => {
  const n = String(val || '').length;
  if(!limit) return n ? `${n}자` : '';
  const over = n > Number(limit);
  return `<span style="color:${over ? 'var(--am)' : 'var(--i4)'}">${n} / ${limit}자${over ? ' — 넘었어요' : ''}</span>`;
};

/* ══════════════════════════════════════════
   기본
══════════════════════════════════════════ */
function basicHtml(sp, con, evKey){
  const roles = rolesOfSpeaker(sp.id);
  // 연락 상대의 «연사 본인» 줄 — 마스터DB 연결이 없을 때 메일·전화가 여기 있다
  const selfRow = contactsOfSpeaker(sp.id).find(r => r.kind === '연사 본인') || null;
  const nOf = (k) => needState(evKey, roles, k);

  /* 연락처는 «지금 어디 있는 사람인가»를 보여줄 뿐 여기서 고치지 않는다.
     프로그램북에 나가는 값은 아래 스냅숏이다. 둘이 다르면 그 사실을 알려
     끌어올지 사람이 정하게 한다 — 조용히 덮으면 손으로 고쳐 둔 직함이 날아간다. */
  const diff = con && [
    ['소속', con.orgKo || '', sp.org_ko || ''],
    ['직함', con.titleKo || '', sp.title_ko || ''],
  ].filter(([, a, b]) => a && a !== b).map(([k]) => k);

  const conBox = con
    ? `<div style="padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px">
        <div style="font-size:12px;font-weight:600">${escapeHtml(con.nameKo || con.nameEn || con.id)}
          ${con.nameKo && con.nameEn ? `<span style="font-weight:400;color:var(--i4);font-size:11px">${escapeHtml(con.nameEn)}</span>` : ''}</div>
        <div style="font-size:11px;color:var(--i3);margin-top:2px">
          ${escapeHtml([con.orgKo, con.titleKo].filter(Boolean).join(' · ') || '(소속·직함 없음)')}</div>
        ${con.orgEn || con.titleEn ? `<div style="font-size:10.5px;color:var(--i4)">${escapeHtml([con.orgEn, con.titleEn].filter(Boolean).join(' · '))}</div>` : ''}
        ${(() => {
          /* 메일·전화는 마스터DB 연락처에만 둔다 — 연사 쪽에 따로 적으면 번호가
             바뀌었을 때 어느 쪽이 맞는지 모르게 된다. 여기서 고치면 마스터DB가 고쳐진다. */
          /* 여기는 마스터DB에 «등록돼 있는 것»만 보여 준다. 고치는 칸은 위 «연락처»에 있다 —
             빈 칸에 예시 글자가 흐리게 들어가 있으면 값이 있는 줄 안다. */
          const have = [['email1', '메일'], ['email2', '메일 2'], ['phone1', '휴대폰'], ['phone2', '전화']]
            .filter(([k]) => String(con[k] || '').trim());
          return have.length ? `<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin-top:6px;font-size:11px">
            ${have.map(([k, l]) => `<span style="color:var(--i4)">${l}</span><span style="color:var(--i2)">${escapeHtml(con[k])}</span>`).join('')}
          </div>` : `<div style="font-size:10.5px;color:var(--i4);margin-top:6px">마스터DB에 등록된 메일·전화가 없어요</div>`;
        })()}
        ${diff.length ? `<div style="font-size:10.5px;color:var(--am);margin-top:5px;line-height:1.6">
          마스터DB의 ${escapeHtml(diff.join('·'))}이 아래와 달라요.
          <br>연사 자료를 새로 받아 고친 것이면 <b>마스터DB로 보내기</b>,
          그 사람이 이직해 발표 당시 소속만 남겨야 하면 그대로 두세요.</div>` : ''}
        <div style="display:flex;gap:6px;margin-top:7px;flex-wrap:wrap">
          <button class="btn" style="font-size:10.5px" onclick="pushSpeakerProfile()"
            title="여기서 고친 소속·직함을 마스터DB 연락처에 반영합니다 — 기업DB도 새 소속으로 묶여요">마스터DB로 보내기</button>
          <button class="btn" style="font-size:10.5px" onclick="pullSpeakerProfile()">연락처에서 끌어오기</button>
          <button class="btn" style="font-size:10.5px" onclick="unlinkSpeakerContact()">연결 끊기</button>
        </div>
      </div>`
    : `<div style="padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px">
        <div style="font-size:11.5px;color:var(--i3);line-height:1.6">
          연락처를 연결하면 소속·직함을 한 번에 끌어오고, 메일·전화도 여기 보입니다. 연결하지 않아도
          아래에 직접 적을 수 있어요.</div>
        <input class="fi" style="margin-top:7px" placeholder="이름·기업·메일로 검색…"
          oninput="searchSpeakerContact(this.value)">
        <div id="sp-con-hits" style="margin-top:5px"></div>
        <div style="display:flex;align-items:center;gap:7px;margin-top:7px;flex-wrap:wrap">
          <button class="btn" style="font-size:10.5px" onclick="createSpeakerContact()"
            title="아래 성명·소속·직함·국적으로 마스터DB에 연락처를 만들고 바로 연결합니다">마스터DB에 새로 등록</button>
          <span style="font-size:10px;color:var(--i4)">검색해도 없을 때 — 아래 적은 값으로 만들고 연결해요</span>
        </div>
      </div>`;

  return `
    <div class="fgr">
      ${fg('성명 국문', txt(sp.name_snapshot, `spField('name_snapshot',this.value,'성명 국문')`, '홍길동'))}
      ${fg('성명 영문', txt(sp.name_en, `spField('name_en',this.value,'성명 영문')`, 'Gil-dong Hong'))}
    </div>
    <div style="font-size:10px;color:var(--i4);margin:-4px 0 12px">
      프로그램에 나갈 이름입니다 — 연락처를 지워도 프로그램에서 사라지지 않도록 따로 굳혀 둡니다.
      해외 연사는 영문만 있어도 됩니다.</div>
    ${con ? `<div class="fgr">
      ${fg('메일', `<input class="fi" type="email" value="${escAttr(con.email1 || '')}" onchange="spContactField('email1',this.value)">`)}
      ${fg('메일 2', `<input class="fi" type="email" value="${escAttr(con.email2 || '')}" onchange="spContactField('email2',this.value)">`)}
    </div>
    <div class="fgr">
      ${fg('휴대폰', `<input class="fi" type="tel" value="${escAttr(con.phone1 || '')}" onchange="spContactField('phone1',this.value)">`)}
      ${fg('전화', `<input class="fi" type="tel" value="${escAttr(con.phone2 || '')}" onchange="spContactField('phone2',this.value)">`)}
    </div>
    <div style="font-size:10px;color:var(--i4);margin:-4px 0 12px">
      메일·전화는 마스터DB 연락처에 저장돼요.${!con.email1 && selfRow && selfRow.email
        ? ` <span style="color:var(--am)">마스터DB엔 메일이 없고, «연락 상대»의 연사 본인 줄에 ${escapeHtml(selfRow.email)}이 있어 메일은 그 주소로 나갑니다.</span>` : ''}</div>`
    : selfRow ? `<div class="fgr">
      ${fg('메일', `<input class="fi" type="email" value="${escAttr(selfRow.email || '')}" onchange="scField('${escAttr(selfRow.id)}','email',this.value,'연사 본인 메일')">`)}
      ${fg('전화', `<input class="fi" type="tel" value="${escAttr(selfRow.phone || '')}" onchange="scField('${escAttr(selfRow.id)}','phone',this.value,'연사 본인 전화')">`)}
    </div>
    <div style="font-size:10px;color:var(--i4);margin:-4px 0 12px">
      마스터DB 연락처가 연결되지 않아 «연락 상대»의 연사 본인 줄에 저장돼요. 아래에서 연결하면 마스터DB로 옮겨 적어 주세요.</div>`
    : `<div style="font-size:10.5px;color:var(--i4);margin:-4px 0 12px">
      메일·전화는 아래 «연락처 연결»에서 마스터DB 연락처를 연결하면 적을 수 있어요.</div>`}
    <div class="fgr">
      ${fg('소속 국문', txt(sp.org_ko, `spField('org_ko',this.value,'소속 국문')`, '○○대학교'))}
      ${fg('소속 영문', txt(sp.org_en, `spField('org_en',this.value,'소속 영문')`, 'XX University'))}
    </div>
    <div class="fgr">
      ${fg('직함 국문', txt(sp.title_ko, `spField('title_ko',this.value,'직함 국문')`, '교수'))}
      ${fg('직함 영문', txt(sp.title_en, `spField('title_en',this.value,'직함 영문')`, 'Professor'))}
    </div>
    <div style="font-size:10px;color:var(--i4);margin:-4px 0 12px">
      프로그램북에 나가는 값입니다 — 발표 당시의 소속이라, 나중에 이직해도 그대로 둡니다.</div>
    <div class="fgr">
      ${fg('국적', `<select class="fi" onchange="spField('nationality',this.value,'국적')">
        <option value="">미정</option>${countryOptions(sp.nationality)}</select>`)}
      ${fg('거주지', `<select class="fi" onchange="spField('residence_country',this.value,'거주지')">
        <option value="">미정</option>${countryOptions(sp.residence_country)}</select>`)}
    </div>
    ${countryGapNote(sp)}
    ${fg('연락처 연결' + (nOf('profile') ? ` ${NEED_MARK[nOf('profile')]}` : ''), conBox)}
    <div class="fgr">
      ${fg('섭외 상태', `<select class="fi" onchange="spField('status',this.value,'섭외 상태')">
        ${STATUSES.map(s => `<option value="${escAttr(s)}"${(sp.status || '섭외중') === s ? ' selected' : ''}>${s}</option>`).join('')}</select>`)}
      ${fg('언어', `<select class="fi" onchange="spField('lang_pref',this.value,'언어')">
        <option value=""${!sp.lang_pref ? ' selected' : ''}>미정</option>
        <option value="both"${sp.lang_pref === 'both' ? ' selected' : ''}>국·영문 모두</option>
        <option value="en"${sp.lang_pref === 'en' ? ' selected' : ''}>영문만 (해외 연사)</option>
      </select>`, '국가로 짐작하지 않고 물어서 적습니다')}
    </div>
    <div style="font-size:11px;font-weight:700;color:var(--i3);margin:16px 0 4px">보낸 것</div>
    <div style="font-size:10px;color:var(--i4);margin-bottom:6px;line-height:1.6">
      받은 것만 적어 두면 «왜 안 오지»를 묻게 됩니다 — 안 보냈을 수도 있어요.</div>
    ${gotRow('초청 · 가이드라인 · 양식', sp.guide_sent_at, `spStamp('guide_sent_at','초청·가이드라인 보냄')`,
      `spField('guide_sent_at',this.value,'초청·가이드라인 발송')`)}
    ${gotRow('마지막 독촉', sp.reminded_at, `spStamp('reminded_at','독촉')`,
      `spField('reminded_at',this.value,'마지막 독촉')`)}
    <div class="fgr" style="margin-top:10px">
      ${fg('초청 회신', dateIn(sp.invite_replied_at, `spField('invite_replied_at',this.value,'초청 회신')`))}
      ${fg('참가 확정', dateIn(sp.confirmed_at, `spField('confirmed_at',this.value,'참가 확정')`))}
    </div>
    ${fg('갈라디너', `<select class="fi" onchange="spField('gala_rsvp',this.value,'갈라디너')">
      <option value=""${!sp.gala_rsvp ? ' selected' : ''}>미확인</option>
      <option value="yes"${sp.gala_rsvp === 'yes' ? ' selected' : ''}>참석</option>
      <option value="no"${sp.gala_rsvp === 'no' ? ' selected' : ''}>불참</option>
    </select>`, '신청서의 갈라디너 참석 여부')}

    <div style="font-size:11px;font-weight:700;color:var(--i3);margin:16px 0 4px">받은 것</div>
    ${nOf('photo') ? gotRow('연사 사진', sp.photo_received_at,
      `spStamp('photo_received_at','사진 받음')`,
      `spField('photo_received_at',this.value,'사진 받은 날')`, nOf('photo')) : ''}
    ${nOf('photo') ? fg('사진 파일명', txt(sp.photo_file, `spField('photo_file',this.value,'사진 파일')`, '원드라이브 파일명'),
      '파일은 원드라이브에 올리고 여기엔 파일명만 적습니다') : ''}
    ${nOf('consent') ? gotRow('개인정보 제공 동의서', sp.consent_at,
      `spStamp('consent_at','동의서 받음')`,
      `spField('consent_at',this.value,'동의서 받은 날')`, nOf('consent')) : ''}
    ${nOf('consent') ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px;margin:6px 0 4px">
      ${SP_CONSENTS.map(c => `<label style="font-size:10.5px;color:${sp[c.key] === 'no' ? 'var(--re)' : 'var(--i3)'}">${c.label}
        <select class="fi" style="font-size:11px;padding:3px 5px${sp[c.key] === 'no' ? ';border-color:var(--re);color:var(--re)' : ''}"
          onchange="spField('${c.key}',this.value,'동의 — ${c.label}')">
          <option value=""${!sp[c.key] ? ' selected' : ''}>미확인</option>
          <option value="yes"${sp[c.key] === 'yes' ? ' selected' : ''}>동의</option>
          <option value="no"${sp[c.key] === 'no' ? ' selected' : ''}>동의 안 함</option>
        </select></label>`).join('')}
    </div>
    ${fg('동의서 파일명', txt(sp.consent_file, `spField('consent_file',this.value,'동의서 파일')`, '원드라이브 파일명'))}
    ${fg('동의 메모', txt(sp.consent_note, `spField('consent_note',this.value,'동의 메모')`, '예: 영상 촬영은 발표 앞부분만'))}` : ''}

    ${fg('메모', area(sp.note, `spField('note',this.value,'메모')`, '섭외 경위, 주의할 점 등', 3))}`;
}

/* 국적과 거주지가 다르면 알려 준다. 다를 때가 문제이기 때문이다 —
   한국 국적이지만 해외에 사는 연사는 연사료를 해외 거주자로 원천징수하고
   항공도 거주지에서 띄운다. 어느 쪽 기준인지는 우리가 정하지 않는다. */
function countryGapNote(sp){
  const nat = sp.nationality, res = sp.residence_country;
  if(!nat || !res || nat === res) return '';
  return `<div style="font-size:10.5px;color:var(--am);margin:-6px 0 12px;line-height:1.6">
    국적(${escapeHtml(countryName(nat))})과 거주지(${escapeHtml(countryName(res))})가 달라요 —
    연사료·항공을 어느 쪽 기준으로 할지는 «제공사항»에서 정하세요.</div>`;
}

/* 이 연사에게 적용할 기준 국가 — 정하지 않았으면 거주지를 먼저 본다.
   돈을 보내고 비행기를 띄우는 일은 그 사람이 지금 있는 곳에서 일어난다. */
export function payCountry(sp){
  if(sp.pay_basis === 'nationality') return sp.nationality || sp.residence_country || '';
  return sp.residence_country || sp.nationality || '';
}

/* 드로어에서 지우면 드로어부터 닫는다 — 지워진 사람을 그리려다 빈 화면이
   남는다. 실제로 지우는 일은 연사 탭 한 곳에서만 한다(묻는 말이 두 벌이 되면
   한쪽이 빠뜨린다). */
export function removeSpeakerFromDr(){
  const id = spId;
  if(!id) return;
  closeSpeakerDr();
  window.removeConfSpeaker?.(id);
}

/* 연락처 검색 — 이미 있는 사람을 다시 적지 않게 한다 */
export function searchSpeakerContact(q){
  const box = document.getElementById('sp-con-hits');
  if(!box) return;
  const t = String(q || '').trim().toLowerCase();
  if(t.length < 2){ box.innerHTML = ''; return; }
  const hits = contacts.filter(c =>
    [c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.email1].some(v => String(v || '').toLowerCase().includes(t))
  ).slice(0, 8);
  box.innerHTML = hits.length
    ? hits.map(c => `<div class="drw" onclick="linkSpeakerContact('${escAttr(c.id)}')">
        <div><div class="drn">${escapeHtml(c.nameKo || c.nameEn || c.id)}</div>
        <div class="drm">${escapeHtml([c.orgKo || c.orgEn, c.titleKo || c.titleEn, c.email1].filter(Boolean).join(' · '))}</div></div>
      </div>`).join('')
    : `<div style="font-size:11px;color:var(--i4);padding:5px 2px">찾는 사람이 없어요 — 아래 «마스터DB에 새로 등록»으로 만들 수 있어요</div>`;
}

/* 마스터DB에 없는 연사를 여기서 바로 만든다. 전에는 «마스터DB에 먼저
   등록하라»고만 했는데, 그러려면 드로어를 닫고 다른 탭에서 같은 이름·소속을
   다시 적어야 했다 — 그래서 연결 안 된 연사가 쌓였다. 연사에 이미 적은
   값으로 만들고 곧바로 잇는다. */
export async function createSpeakerContact(){
  if(confLocked()){ confLockNotice(); return; }
  const sp = getSpeakerById(spId);
  if(!sp) return;
  const nameKo = String(sp.name_snapshot || '').trim(), nameEn = String(sp.name_en || '').trim();
  if(!nameKo && !nameEn){ alert('성명을 먼저 적어주세요.'); return; }

  /* 같은 이름이 이미 있으면 한 번 묻는다 — 검색을 건너뛰고 누르는 일이 있다 */
  const same = contacts.filter(c => (nameKo && c.nameKo === nameKo) || (nameEn && c.nameEn === nameEn));
  if(same.length && !confirm(`마스터DB에 같은 이름이 ${same.length}명 있어요:

${
      same.slice(0, 5).map(c => `· ${c.nameKo || c.nameEn} — ${c.orgKo || c.orgEn || '소속 없음'}`).join('\n')
    }

그래도 새로 만들까요? (같은 사람이면 취소하고 위에서 검색해 연결하세요)`)) return;

  const c = {
    // 13자리 + 4자리 난수 합 — 16자리 안이라 화면이 숫자로 바꿔도 안전하다(CLAUDE.md)
    id: Date.now() + Math.floor(Math.random() * 10000),
    nameKo, nameEn,
    orgKo: sp.org_ko || '', orgEn: sp.org_en || '',
    titleKo: sp.title_ko || '', titleEn: sp.title_en || '',
    deptKo: '', deptEn: '',
    country: sp.nationality || sp.residence_country || '', cat: 'speaker', lang: nameKo ? 'KO' : 'EN',
    source: `${sp.event_id || ''} 연사`, date: td(), status: 'new',
    email1: '', email2: '', phone1: '', phone2: '',
    beat: '', products: '', tags: '', org_id: '',
  };
  contacts.push(c);
  const { postToSheet } = await import('../api.js');
  const r = await postToSheet({
    sheet: 'contacts',
    row: [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
      c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2,
      c.beat, c.products, c.tags, c.org_id],
  }, '연사 마스터DB 등록', { silent: true });
  if(!r || !r.ok){
    const i = contacts.indexOf(c);
    if(i >= 0) contacts.splice(i, 1);
    alert('마스터DB 저장에 실패했어요. 잠시 뒤 다시 해주세요.');
    return;
  }
  trackAction('add', '연사 마스터DB 등록', sp.event_id || '', `${nameKo || nameEn} 마스터DB 등록 + 연사 연결`,
    { kind: 'contact', id: String(c.id) });
  await linkSpeakerContact(String(c.id));
}

/* 기본 탭의 메일·전화 칸 — 연결된 마스터DB 연락처를 고친다 */
export async function spContactField(k, v){
  const sp = getSpeakerById(spId);
  const c = sp && sp.contact_id ? contacts.find(x => String(x.id) === String(sp.contact_id)) : null;
  if(!c) return;
  const val = String(v || '').trim();
  if(String(c[k] || '') === val) return;
  const res = await patchContact(c, { [k]: val }, '연사 화면에서 연락처 수정');
  if(!res || res.ok === false){ alert('마스터DB에 저장하지 못했어요. 잠시 뒤 다시 해주세요.'); return; }
  trackAction('edit', '연락처', sp.event_id || '', `${c.nameKo || c.nameEn} — ${k} 고침 (연사 화면)`,
    { kind: 'contact', id: String(c.id) });
  // 아래 마스터 카드·연락 상대·메일 수신이 새 값을 읽게 다시 그린다
  renderSpeakerDr();
}

export async function linkSpeakerContact(cid){
  const c = contacts.find(x => String(x.id) === String(cid));
  const sp = getSpeakerById(spId);
  if(!c || !sp) return;
  /* 이름 스냅숏이 비어 있으면 연락처 이름으로 채운다. 이미 적혀 있으면
     건드리지 않는다 — 프로그램에 나갈 이름을 손으로 고쳐 뒀을 수 있다. */
  const patch = { contact_id: String(c.id) };
  const fill = (field, v) => { if(!sp[field] && v) patch[field] = v; };
  fill('name_snapshot', c.nameKo || c.nameEn);
  fill('name_en', c.nameEn);
  fill('org_ko', c.orgKo); fill('org_en', c.orgEn);
  fill('title_ko', c.titleKo); fill('title_en', c.titleEn);
  await patchSpeaker(patch, `연락처 연결 (${c.nameKo || c.nameEn || c.id})`);
  await syncPartRole(sp.id);   // 마스터DB 참가 역할(VIP·연사)을 맞추거나 만든다
}
/* 연락처의 값으로 스냅숏을 덮는다. 자동으로 하지 않는 이유는, 손으로 고쳐
   둔 직함(«대표» → «Founder & CEO» 같은)이 조용히 날아가기 때문이다. */
export async function pullSpeakerProfile(){
  const sp = getSpeakerById(spId);
  const c = sp && sp.contact_id ? contacts.find(x => String(x.id) === String(sp.contact_id)) : null;
  if(!c) return;
  const patch = {};
  const set = (field, v) => { if((v || '') !== (sp[field] || '')) patch[field] = v || ''; };
  set('name_en', c.nameEn);
  set('org_ko', c.orgKo); set('org_en', c.orgEn);
  set('title_ko', c.titleKo); set('title_en', c.titleEn);
  if(!Object.keys(patch).length){ alert('연락처와 이미 같아요.'); return; }
  const LABEL = { name_en: '성명 영문', org_ko: '소속 국문', org_en: '소속 영문',
    title_ko: '직함 국문', title_en: '직함 영문' };
  const lines = Object.entries(patch)
    .map(([k, v]) => `${LABEL[k] || k}: ${sp[k] || '(비어 있음)'} → ${v || '(비움)'}`)
    .join('\n');
  if(!confirm(`연락처의 값으로 덮을까요?\n\n${lines}`)) return;
  await patchSpeaker(patch, '연락처에서 소속·직함 끌어옴');
}

/* 여기서 고친 소속·직함을 마스터DB로 보낸다.

   스냅숏은 «발표 당시»를 굳히려고 둔 것이지만, 연사 자료를 받아 고치는
   시점에는 그게 곧 «지금»이다. 그때 마스터DB가 옛 값으로 남으면 마스터DB가
   틀린 값을 들고 있게 되고, 기업DB에는 그 회사가 아예 안 생긴다.

   자동으로 흘려보내지 않는다 — 프로그램북 표기를 일부러 다르게 둔 경우가
   있어서다(영문 표기 정리, 구 사명 유지). 무엇이 어떻게 바뀌는지 보여주고
   사람이 누른다. */
export async function pushSpeakerProfile(){
  const sp = getSpeakerById(spId);
  const c = sp && sp.contact_id ? contacts.find(x => String(x.id) === String(sp.contact_id)) : null;
  if(!sp) return;
  if(!c){
    alert('연락처가 연결되지 않아 보낼 곳이 없어요.\n위에서 연락처를 찾아 연결해주세요.');
    return;
  }
  const MAP = [
    ['nameKo',  'name_snapshot', '성명 국문'],
    ['nameEn',  'name_en',       '성명 영문'],
    ['orgKo',   'org_ko',   '소속 국문'],
    ['orgEn',   'org_en',   '소속 영문'],
    ['titleKo', 'title_ko', '직함 국문'],
    ['titleEn', 'title_en', '직함 영문'],
  ];
  const patch = {};
  const lines = [];
  MAP.forEach(([cf, sf, label]) => {
    const v = String(sp[sf] ?? '').trim();
    /* 연사 쪽이 빈 칸이면 보내지 않는다 — 안 받은 값으로 마스터DB를 지우면
       원래 있던 정보가 사라진다. */
    if(!v || String(c[cf] ?? '').trim() === v) return;
    patch[cf] = v;
    lines.push(`${label}: ${c[cf] || '(비어 있음)'} → ${v}`);
  });
  if(!lines.length){ alert('마스터DB와 이미 같아요.'); return; }

  const orgChanging = 'orgKo' in patch || 'orgEn' in patch;
  if(!confirm(`마스터DB의 «${c.nameKo || c.nameEn || c.id}»을 이렇게 고칠까요?\n\n${lines.join('\n')}`
    + (orgChanging ? '\n\n기업DB도 새 소속으로 묶입니다. 그 기업이 없으면 만들어요.' : '')
    + '\n\n연사 쪽 값은 그대로 남습니다(발표 당시 소속).')) return;

  const res = await patchContact(c, patch, '연사 자료로 연락처 수정');
  if(!res || res.ok === false){ alert('마스터DB에 반영하지 못했어요.'); return; }
  trackAction('edit', '연락처(연사 자료 반영)', sp.event_id,
    `${c.nameKo || c.nameEn || c.id} — ${lines.join(' · ')}`);
  renderSpeakerDr();
  alert('마스터DB에 반영했어요.');
}

export async function unlinkSpeakerContact(){
  await patchSpeaker({ contact_id: '' }, '연락처 연결 끊기');
}

/* ══════════════════════════════════════════
   이력 — 국·영문 따로. 해외 연사는 영문만 오는 게 정상이다.
══════════════════════════════════════════ */
/* 이력으로 받는 것들. 순서는 프로필에 실리는 순서를 따랐다 —
   한 문단 소개 → 경력 → 학력 → 수상. 받은 글을 그대로 옮겨 붙일 수 있어야
   프로그램북을 만들 때 다시 자르지 않는다. */
const BIO_PARTS = [
  { need: 'bio_profile', label: 'Professional Profile', ko: 'bio_profile_ko', en: 'bio_profile_en',
    lim: 'bio_profile', hint: '한 문단짜리 소개 — 현장 소개 멘트로도 씁니다' },
  { need: 'bio_pro',  label: 'Professional experience', ko: 'bio_pro_ko',  en: 'bio_pro_en',  lim: 'bio_pro' },
  { need: 'bio_work', label: 'Working experience',      ko: 'bio_work_ko', en: 'bio_work_en', lim: 'bio_work' },
  { need: 'bio_edu',  label: 'Education',               ko: 'bio_edu_ko',  en: 'bio_edu_en',  lim: 'bio_edu' },
  { need: 'bio_awards', label: 'Selected Awards & Recognitions', ko: 'bio_awards_ko', en: 'bio_awards_en',
    lim: 'bio_awards', hint: '국제 수상·선정 이력' },
  { need: 'bio_credentials', label: 'Licenses & Credentials', ko: 'bio_credentials_ko', en: 'bio_credentials_en',
    lim: 'bio_credentials', rows: 2, hint: '이름 옆에 붙는 자격 — 예: AIA · LEED AP' },
  { need: 'bio_teaching', label: 'Academic & Teaching', ko: 'bio_teaching_ko', en: 'bio_teaching_en',
    lim: 'bio_teaching' },
  { need: 'bio_affil', label: 'Affiliations & Public Service', ko: 'bio_affil_ko', en: 'bio_affil_en',
    lim: 'bio_affil' },
  { need: 'bio_pubs', label: 'Press · Publications · Exhibitions', ko: 'bio_pubs_ko', en: 'bio_pubs_en',
    lim: 'bio_pubs' },
];

function bioHtml(sp, evKey){
  const roles = rolesOfSpeaker(sp.id);
  const lim = confCfg(evKey).limits || {};
  const enOnly = sp.lang_pref === 'en';
  const parts = BIO_PARTS.map(p => ({ ...p, state: needState(evKey, roles, p.need) }))
    .filter(p => p.state);

  if(!parts.length){
    return `<div style="padding:16px;background:var(--i8);border:1px solid var(--i6);border-radius:8px;
      font-size:12px;color:var(--i5);line-height:1.7">
      이 연사의 역할(${escapeHtml(roles.join(' · ') || '배정 없음')})은 이력을 받지 않아요.
      받아야 한다면 설정 › 행사 관리 › 컨퍼런스에서 역할별 항목을 고치세요.</div>`;
  }

  const pair = (p) => {
    const koVal = sp[p.ko], enVal = sp[p.en];
    const limit = lim[p.lim];
    return `<div style="margin-bottom:16px">
      <div style="display:flex;align-items:baseline;gap:7px;margin-bottom:5px">
        <div style="font-size:11.5px;font-weight:700">${escapeHtml(p.label)}</div>
        <div style="font-size:10px;color:var(--i4)" title="${escAttr(NEED_LABEL[p.state] || '')}">${NEED_MARK[p.state] || ''}</div>
        ${p.hint ? `<div style="font-size:10px;color:var(--i4)">${escapeHtml(p.hint)}</div>` : ''}
      </div>
      ${enOnly ? '' : fg(`국문 · ${countHint(koVal, limit)}`,
        area(koVal, `spField('${p.ko}',this.value,'${escAttr(p.label)} 국문')`, '', p.rows || 5))}
      ${fg(`영문 · ${countHint(enVal, limit)}`,
        area(enVal, `spField('${p.en}',this.value,'${escAttr(p.label)} 영문')`, '', p.rows || 5))}
    </div>`;
  };

  return `
    ${enOnly ? `<div style="padding:8px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;
      font-size:11px;color:var(--i3);margin-bottom:12px">
      해외 연사(영문만)로 적혀 있어 국문 칸을 숨겼어요. 기본 탭의 «언어»를 바꾸면 다시 보여요.</div>` : ''}
    ${needState(evKey, roles, 'cv') ? `
      ${gotRow('CV 원본 받음', sp.cv_received_at, `spStamp('cv_received_at','CV 받음')`,
        `spField('cv_received_at',this.value,'CV 받은 날')`, needState(evKey, roles, 'cv'))}
      ${fg('CV 파일명', txt(sp.cv_file, `spField('cv_file',this.value,'CV 파일')`, '원드라이브 파일명'),
        'CV는 4쪽이 넘기도 해요 — 아래 칸에는 프로그램북에 나갈 것만 옮기고 원본은 폴더에 둡니다')}` : ''}
    ${needState(evKey, roles, 'languages') ? fg(
      `구사 언어 ${NEED_MARK[needState(evKey, roles, 'languages')] || ''}`,
      txt(sp.languages, `spField('languages',this.value,'구사 언어')`, '영어(업무 가능) · 중국어(모국어) · 일본어'),
      '통역을 붙일지 정할 때 봅니다 — 위 «언어»는 우리가 자료를 어느 언어로 받는지예요') : ''}
    ${gotRow('이력 받음', sp.profile_received_at,
      `spStamp('profile_received_at','이력 받음')`,
      `spField('profile_received_at',this.value,'이력 받은 날')`,
      parts.some(p => p.state === 'req') ? 'req' : 'opt')}
    <div style="font-size:10.5px;color:var(--i4);margin:5px 0 14px">
      받았는지는 이 체크로 봅니다 — 해외 연사는 국문이 비는 게 정상이라 글자 유무로 세지 않아요.</div>
    ${parts.map(pair).join('')}`;
}

/* ══════════════════════════════════════════
   발제 — 배정마다 하나. 역할이 묻지 않는 항목은 아예 보이지 않는다.
══════════════════════════════════════════ */
function talkHtml(sp, evKey){
  const asg = assignmentsFor(sp.id);
  if(!asg.length){
    return `<div style="padding:16px;background:var(--i8);border:1px solid var(--i6);border-radius:8px;
      font-size:12px;color:var(--i5);line-height:1.7">
      아직 세션에 배정되지 않았어요. «프로그램»에서 세션에 넣고 역할을 정하면
      그 역할이 요구하는 발제 정보가 여기 나타납니다.</div>`;
  }
  const lim = confCfg(evKey).limits || {};

  const block = (a) => {
    const s = CONF_SESSIONS.find(x => x.id === a.session_id);
    const need = (k) => speakerNeed(evKey, a.role, k);
    const nTitle = need('title'), nAbs = need('abstract'), nSlides = need('slides');
    const head = `<div style="display:flex;align-items:baseline;gap:7px;margin-bottom:7px">
      <span class="pill ${(SPEAKER_ROLES.find(r => r.key === a.role) || {}).cls || 'p-gray'}" style="font-size:10px">${escapeHtml(a.role || '역할 없음')}</span>
      <div style="font-size:12px;font-weight:600;min-width:0">${escapeHtml(s ? (s.title_ko || s.title_en || s.id) : '(삭제된 세션)')}</div>
      <div style="font-size:10.5px;color:var(--i4)">${escapeHtml(
        [s?.date, a.start_at ? `${a.start_at}${a.end_at ? '–' + a.end_at : ''}` : s?.start_at].filter(Boolean).join(' '))}</div>
    </div>`;

    if(!nTitle && !nAbs && !nSlides){
      return `<div style="border:1px solid var(--i6);border-radius:9px;padding:11px 12px;margin-bottom:11px">
        ${head}
        <div style="font-size:11.5px;color:var(--i5);line-height:1.6">
          ${escapeHtml(a.role)}${eunNeun(a.role)} 이 행사에서 발제 정보를 받지 않아요.</div></div>`;
    }

    return `<div style="border:1px solid var(--i6);border-radius:9px;padding:11px 12px;margin-bottom:11px">
      ${head}
      ${nTitle ? `<div class="fgr">
        ${fg(`발제명 국문 ${NEED_MARK[nTitle]}`, txt(a.title_ko, `asField('${escAttr(a.id)}','title_ko',this.value,'발제명 국문')`))}
        ${fg(`발제명 영문 ${NEED_MARK[nTitle]}`, txt(a.title_en, `asField('${escAttr(a.id)}','title_en',this.value,'발제명 영문')`))}
      </div>` : ''}
      <div class="fgr">
        ${fg('발표 시작', `<input class="fi" type="time" value="${escAttr(a.start_at || '')}"
          onchange="asField('${escAttr(a.id)}','start_at',this.value,'발표 시작')">`)}
        ${fg('발표 종료', `<input class="fi" type="time" value="${escAttr(a.end_at || '')}"
          onchange="asField('${escAttr(a.id)}','end_at',this.value,'발표 종료')">`)}
      </div>
      <div style="font-size:10px;color:var(--i4);margin:-6px 0 10px">
        세션 시간이 아니라 이 사람이 올라가는 시각입니다 — 연사 안내와 프로그램북에 이 값이 나갑니다.</div>
      <div class="fgr">
        ${fg('발표 언어', `<select class="fi" onchange="asField('${escAttr(a.id)}','lang',this.value,'발표 언어')">
          <option value=""${!a.lang ? ' selected' : ''}>미정</option>
          <option value="ko"${a.lang === 'ko' ? ' selected' : ''}>국문</option>
          <option value="en"${a.lang === 'en' ? ' selected' : ''}>영문</option></select>`)}
        ${fg('길이(분)', txt(a.duration_min, `asField('${escAttr(a.id)}','duration_min',this.value,'발표 길이')`, '20'))}
      </div>

      ${nAbs ? `<div style="margin-top:6px">
        ${gotRow('초록 받음', a.abstract_received_at,
          `asStamp('${escAttr(a.id)}','abstract_received_at','초록 받음')`,
          `asField('${escAttr(a.id)}','abstract_received_at',this.value,'초록 받은 날')`, nAbs)}
        ${fg(`초록 국문 · ${countHint(a.abstract_ko, lim.abstract)}`,
          area(a.abstract_ko, `asField('${escAttr(a.id)}','abstract_ko',this.value,'초록 국문')`, '', 5))}
        ${fg(`초록 영문 · ${countHint(a.abstract_en, lim.abstract)}`,
          area(a.abstract_en, `asField('${escAttr(a.id)}','abstract_en',this.value,'초록 영문')`, '', 5))}
      </div>` : ''}

      ${nSlides ? `<div style="margin-top:6px">
        ${gotRow('발표자료 받음', a.slides_received_at,
          `asStamp('${escAttr(a.id)}','slides_received_at','발표자료 받음')`,
          `asField('${escAttr(a.id)}','slides_received_at',this.value,'발표자료 받은 날')`, nSlides)}
        <div class="fgr">
          ${fg('파일명', txt(a.slides_file, `asField('${escAttr(a.id)}','slides_file',this.value,'발표자료 파일')`, '원드라이브 파일명'))}
          ${fg('판', txt(a.slides_version, `asField('${escAttr(a.id)}','slides_version',this.value,'발표자료 판')`, 'v2'))}
        </div>
        <div style="font-size:10px;color:var(--i4);margin-top:-4px">
          발표자료는 현장에서 바뀝니다 — 어느 판을 받았는지 적어 두면 무엇을 틀지 헷갈리지 않아요.</div>
      </div>` : ''}

      ${nTitle ? `
        ${fg('키워드', txt(a.keywords, `asField('${escAttr(a.id)}','keywords',this.value,'발제 키워드')`,
          '예: 적응형 재생 · 산업유산 · 저탄소'),
          '프로그램북 색인과 트랙 배정에 씁니다 — 연사가 해시태그로 보내오기도 해요')}
        ${fg('발표 형식', txt(a.talk_format, `asField('${escAttr(a.id)}','talk_format',this.value,'발표 형식')`,
          '예: 15분 발표 + 라운드테이블'),
          '연사가 제안서에 적어 보내는 값입니다 — 세션 시간을 짤 때 이걸 봅니다')}
        ${fg('라운드테이블 논의 주제', area(a.discussion,
          `asField('${escAttr(a.id)}','discussion',this.value,'라운드테이블 주제')`, '', 3),
          '좌장이 진행할 때 쓰는 질문들 — 연사가 함께 보내오면 여기 옮겨 둡니다')}` : ''}
      ${fg('메모', area(a.note, `asField('${escAttr(a.id)}','note',this.value,'발제 메모')`, '', 2))}
    </div>`;
  };

  return asg.map(block).join('');
}

/* ══════════════════════════════════════════════════════════════
   연락 상대 · 메일 · 기록

   연사와 직접 주고받는 일도 있지만, 조교수·조수 같은 실무진과 하는 일이
   더 많다. 그때 메일은 실무진이 수신이고 연사는 참조다 — 연사를 수신에
   두면 실무진이 답을 못 하고, 실무진만 두면 연사가 진행 상황을 모른다.
   그래서 상대마다 수신/참조를 정해 두고, 메일 칸을 그 값으로 채운다.

   보낸 메일은 speaker_logs에 남는다. 이게 빠지면 «이 연사에게 초록을 몇 번
   물었나»를 다시 셀 수 없고, 그러면 또 묻거나 아예 안 묻게 된다.
══════════════════════════════════════════════════════════════ */

const CONTACT_KINDS = ['연사 본인', '실무진', '비서', '기관 담당', '기타'];
const SEND_LABEL = { to: '수신', cc: '참조', '': '안 보냄' };

/* 이 연사에게 메일 보낼 때의 수신·참조 — 상대 목록에서 만든다 */
/* 연사 본인의 메일·전화는 기본 정보(마스터DB 연락처)가 정본이다. 연락 상대에
   또 적게 하면 두 곳이 갈라진다 — «연사 본인» 줄은 칸이 비어 있으면 기본 정보를
   그대로 읽고, 연락 상대가 하나도 없으면 연사 본인을 수신으로 본다. */
const selfCon = (sp) => sp && sp.contact_id ? contacts.find(c => String(c.id) === String(sp.contact_id)) : null;
const selfEmail = (sp) => String(selfCon(sp)?.email1 || '').trim();
const selfPhone = (sp) => String(selfCon(sp)?.phone1 || selfCon(sp)?.phone2 || '').trim();
const isSelf = (r) => r.kind === '연사 본인';
const norm = (v) => String(v || '').trim().toLowerCase();
/* 연사 본인은 마스터DB 메일이 정본 — 있으면 그걸 쓰고, 줄에 적힌 메일은 마스터에
   메일이 없을 때만 쓴다. 반대로 하면 기본 탭에서 메일을 고쳐도 옛 주소로 나갔다. */
export const rowEmail = (sp, r) => isSelf(r)
  ? (selfEmail(sp) || String(r.email || '').trim())
  : String(r.email || '').trim();

export function mailTargets(speakerId){
  const sp = getSpeakerById(speakerId);
  const rows = contactsOfSpeaker(speakerId);
  if(!rows.length){
    const em = selfEmail(sp);
    return { to: em ? [em] : [], cc: [] };
  }
  const pick = (s) => rows.filter(r => r.send === s).map(r => rowEmail(sp, r)).filter(Boolean);
  return { to: pick('to'), cc: pick('cc') };
}

function peopleTabHtml(sp){
  const rows = contactsOfSpeaker(sp.id);
  const t = mailTargets(sp.id);

  const row = (r) => `<div style="border:1px solid var(--i6);border-radius:8px;padding:9px 11px;margin-bottom:7px">
    <div class="fgr">
      ${fg('이름', txt(r.name, `scField('${escAttr(r.id)}','name',this.value,'연락 상대 이름')`, '홍길동'))}
      ${fg('관계', `<select class="fi" onchange="scField('${escAttr(r.id)}','kind',this.value,'연락 상대 관계')">
        ${CONTACT_KINDS.map(k => `<option value="${escAttr(k)}"${(r.kind || '') === k ? ' selected' : ''}>${k}</option>`).join('')}
      </select>`)}
    </div>
    <div class="fgr">
      ${fg('메일', txt(r.email, `scField('${escAttr(r.id)}','email',this.value,'연락 상대 메일')`,
        isSelf(r) && selfEmail(sp) ? selfEmail(sp) : 'name@org.kr'))}
      ${fg('전화', txt(r.phone, `scField('${escAttr(r.id)}','phone',this.value,'연락 상대 전화')`,
        isSelf(r) && selfPhone(sp) ? selfPhone(sp) : ''))}
    </div>
    ${isSelf(r) ? `<div style="font-size:10px;color:var(--i4);margin:-2px 0 5px">${
      selfEmail(sp) && r.email && norm(r.email) !== norm(selfEmail(sp))
        ? `<span style="color:var(--am)">기본 정보(마스터DB)의 ${escapeHtml(selfEmail(sp))}로 나갑니다</span> — 여기 적힌 주소는 쓰지 않아요. 바꾸려면 기본 탭에서 고치세요`
        : selfEmail(sp) ? '기본 정보(마스터DB)의 메일로 나갑니다 — 고치려면 기본 탭에서'
        : r.email ? '마스터DB에 메일이 없어 여기 적힌 주소로 나갑니다'
        : '<span style="color:var(--re)">메일이 없어요</span> — 기본 탭에서 넣어주세요'}</div>` : ''}
    <div style="display:flex;align-items:center;gap:9px;margin-top:2px">
      <div class="seg">
        ${['to', 'cc', ''].map(s => `<button class="seg-b${(r.send || '') === s ? ' on' : ''}"
          onclick="scField('${escAttr(r.id)}','send','${s}','${SEND_LABEL[s]}')">${SEND_LABEL[s]}</button>`).join('')}
      </div>
      <button class="btn" style="font-size:10.5px;margin-left:auto" onclick="removeSpeakerContact('${escAttr(r.id)}')">삭제</button>
    </div>
  </div>`;

  const summary = `<div style="padding:9px 11px;background:var(--i8);border:1px solid var(--i6);
      border-radius:7px;font-size:11.5px;color:var(--i3);line-height:1.7;margin-bottom:11px">
      ${t.to.length ? `수신 <b>${escapeHtml(t.to.join(', '))}</b>` : '<b>수신이 비어 있어요</b> — 상대 하나를 수신으로 정해주세요'}
      ${t.cc.length ? `<br>참조 ${escapeHtml(t.cc.join(', '))}` : ''}
    </div>`;

  return summary
    + (rows.length ? rows.map(row).join('')
      : `<div style="font-size:11.5px;color:var(--i5);line-height:1.7;margin-bottom:9px">
        따로 정한 연락 상대가 없어 <b>연사 본인</b>(기본 정보의 메일)에게 보냅니다.
        실무진을 거쳐야 하면 추가해서 실무진을 수신, 연사를 참조로 두세요.</div>`)
    + `<button class="btn" style="font-size:11px" onclick="addSpeakerContact()">+ 연락 상대 추가</button>`;
}

export async function addSpeakerContact(){
  if(confLocked()){ confLockNotice(); return; }
  const sp = getSpeakerById(spId);
  if(!sp) return;
  /* 첫 상대는 연사 본인으로 두고 수신으로 잡는다 — 실무진이 붙으면 그때
     수신을 옮기면 된다. 처음부터 비워 두면 수신 없는 채로 메일 칸을 연다. */
  const first = !contactsOfSpeaker(sp.id).length;
  /* 연사 본인 줄은 메일·전화를 비워 둔다 — 기본 정보를 읽는다(rowEmail) */
  const row = {
    speaker_id: sp.id, contact_id: '',
    name: first ? (sp.name_snapshot || sp.name_en || '') : '', email: '', phone: '',
    kind: first ? '연사 본인' : '실무진', send: first ? 'to' : 'cc', note: '',
  };
  const res = await saveSpeakerContact(row);
  if(!res || res.ok === false){ if(!res?.locked) alert('연락 상대를 추가하지 못했어요.'); return; }
  SPEAKER_CONTACTS.push({ ...row, id: res.id || `SC-tmp-${Date.now()}` });
  renderSpeakerDr();
}

export async function scField(id, field, value, label){
  if(confLocked()){ confLockNotice(); return; }
  const r = SPEAKER_CONTACTS.find(x => x.id === id);
  if(!r || String(r[field] ?? '') === String(value ?? '')) return;
  const backup = r[field];
  r[field] = value;
  renderSpeakerDr();
  const res = await saveSpeakerContact({ id, [field]: value });
  if(!res || res.ok === false){
    r[field] = backup; renderSpeakerDr();
    if(!res?.locked) alert('저장에 실패했어요.');
    return;
  }
  trackAction('edit', '연사 연락 상대', getSpeakerById(spId)?.event_id, `${speakerLabel()} — ${label || field}`,
    changed('speaker_contacts', id, { [field]: backup }, { [field]: value ?? '' },
      { kind: 'speaker', id: spId, field }));
}

export async function removeSpeakerContact(id){
  if(confLocked()){ confLockNotice(); return; }
  const r = SPEAKER_CONTACTS.find(x => x.id === id);
  if(!r) return;
  if(!confirm(`«${r.name || r.email || id}»을 연락 상대에서 지울까요?`)) return;
  const res = await deleteSpeakerContact(id);
  if(res && res.ok === false){ if(!res.locked) alert('지우지 못했어요.'); return; }
  const i = SPEAKER_CONTACTS.findIndex(x => x.id === id);
  if(i >= 0) SPEAKER_CONTACTS.splice(i, 1);
  trackAction('delete', '연사 연락 상대', getSpeakerById(spId)?.event_id,
    `${speakerLabel()} — ${r.name || r.email || r.kind || '이름 없는'} 연락 상대 지움`,
    removed('speaker_contacts', id, r, { kind: 'speaker', id: spId }));
  renderSpeakerDr();
}

/* ── 메일 ──
   무엇을 물을지가 정해져 있으니 제목·본문의 뼈대는 우리가 만든다. 사람이
   고쳐 보내는 걸 전제로 하고, 자동으로 나가는 일은 없다. */
const MAIL_KINDS = [
  { key: 'invite',   label: '초청' },
  { key: 'bulkreq',  label: '안 받은 자료 한 번에 요청' },
  { key: 'profile',  label: '이력·사진 요청' },
  { key: 'abstract', label: '발제명·초록 요청' },
  { key: 'slides',   label: '발표자료 요청' },
  { key: 'travel',   label: '숙박·항공 안내' },
  { key: 'note',     label: '기타' },
];

/* 줄을 누르면 보낸 본문을 펼친다 — «뭐라고 보냈지»를 메일함까지 가서 찾지 않게 */
const spLogRow = (l) => `<details style="border-top:1px solid var(--i7);padding:7px 0"${mailToggleAttr('sp', l)}>
  <summary style="cursor:pointer;list-style:none">
  <div style="display:flex;gap:7px;align-items:baseline">
    ${mailDirPill(l)}${mailStateHtml('sp', l)}<span class="pill p-gray" style="font-size:10px">${escapeHtml(l.category || '기타')}</span>
    <div style="font-size:11.5px;font-weight:${l.direction === 'in' && !l.read_at ? 800 : 600};flex:1;min-width:0">${escapeHtml(l.subject || '(제목 없음)')}</div>
    <div style="font-size:10.5px;color:var(--i4)">${escapeHtml(l.ts || '')} ▾</div>
  </div>
  <div style="font-size:10.5px;color:var(--i4);margin-top:2px">${escapeHtml(l.counterpart || '')}</div>
  </summary>
  <div style="margin-top:6px;padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;
    font-size:11.5px;color:var(--i2);white-space:pre-wrap;line-height:1.6">${mailBodyHtml(l.body)}</div>
  ${mailActionsHtml('sp', l)}
</details>`;

/* ── 회신 중 ── 받은 메일의 «↩ 회신»에서 들어온다(mail-mark.js replyMail) */
let spReply = null;
export function startSpeakerReply(d){ spReply = { ...d, filled: false, pick: new Set() }; spTab = 'mail'; renderSpeakerDr(); }
/* 회신에 붙일 행사 파일 — 단계 기본 첨부와 달리 처음엔 아무것도 안 고른 채로 */
export function toggleSpReplyFile(id, on){ if(!spReply) return; on ? spReply.pick.add(id) : spReply.pick.delete(id); }
window.toggleSpReplyFile = toggleSpReplyFile;
export function cancelSpeakerReply(){ spReply = null; renderSpeakerDr(); }
function fillSpeakerReply(){
  const s = document.getElementById('sp-mail-subject'), b = document.getElementById('sp-mail-body');
  if(!s || !b || !spReply) return;
  // 한 번 채운 뒤에는 고친 글을 지키려고 다시 덮지 않는다(창을 다시 그리면 마지막 글로)
  if(!spReply.filled){ spReply.filled = true; spReply.curSubject = spReply.subject; spReply.curBody = spReply.body; }
  s.value = spReply.curSubject; b.value = spReply.curBody;
  s.oninput = () => { spReply && (spReply.curSubject = s.value); };
  b.oninput = () => { spReply && (spReply.curBody = b.value); };
  b.focus(); b.setSelectionRange(0, 0);
}
window.startSpeakerReply = startSpeakerReply;
window.cancelSpeakerReply = cancelSpeakerReply;

function mailTabHtml(sp, evKey){
  const t = spReply ? { to: spReply.to, cc: [] } : mailTargets(sp.id);
  const ev = EVENT_LIST.find(e => e.key === evKey);
  // 영문 연사에게는 영문 행사명(설정 › 행사 › 기본 정보)
  const evName = ev ? ((sp.lang_pref === 'en' && ev.name_en) || ev.name || ev.short || ev.key) : evKey;
  /* 계좌 열람(kind 'view') 같은 내부 기록은 «보낸 기록»이 아니다 */
  const logs = logsOfSpeaker(sp.id).filter(l => l.kind !== 'view')
    .slice()
    .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));


  return `
    <div style="padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;
      font-size:11.5px;color:var(--i3);line-height:1.7;margin-bottom:11px">
      ${spReply ? `<div style="color:var(--a);font-weight:700">↩ 회신 중 — 이 메일을 보낸 사람에게 답합니다
        <a href="#" onclick="cancelSpeakerReply();return false" style="font-weight:400;margin-left:6px">회신 취소</a></div>` : ''}
      <span id="sp-mail-from">발신 확인 중…</span><br>
      ${t.to.length ? `수신 <b>${escapeHtml(t.to.join(', '))}</b>` : '<b style="color:var(--re)">수신이 없어요</b> — «연락 상대»에서 먼저 정해주세요'}
      ${t.cc.length ? `<br>참조 ${escapeHtml(t.cc.join(', '))}` : ''}
    </div>
    ${(() => {
      /* 연락 단계가 먼저 — 지금 할 일이 골라진 채로 열린다. 개별 요청은 아래에 */
      const f = flowStatus(sp);
      const stepOpts = f.steps.filter(x => x.applies).map(x =>
        `<option value="${x.key}"${f.current && f.current.key === x.key ? ' selected' : ''}>${
          x.isDone ? '✓ ' : f.current && f.current.key === x.key ? '● ' : ''}${escapeHtml(
          x.key === 'collect' && f.remind ? '자료 독촉' : x.label)}</option>`).join('');
      const extra = MAIL_KINDS.filter(k => !['invite', 'travel', 'slides'].includes(k.key));
      return fg('무슨 메일인가', `<select class="fi" id="sp-mail-kind" onchange="fillSpeakerMail(this.value)">
        <optgroup label="연락 단계">${stepOpts}</optgroup>
        <optgroup label="개별 요청">${extra.map(k => `<option value="${k.key}">${k.label}</option>`).join('')}</optgroup>
      </select>
        <button class="btn" style="font-size:10.5px;margin-top:5px" title="이 행사의 연락 순서 설정을 열어 고른 단계의 기본 제목·본문·첨부를 고칩니다"
          onclick="openFlowEditor('${escAttr(evKey)}',document.getElementById('sp-mail-kind').value)">✎ 이 단계 기본 문구 고치기</button>
        <button class="btn" style="font-size:10.5px;margin-top:5px" onclick="openFlowEditor('${escAttr(evKey)}')">+ 단계 추가</button>`,
        '고르면 그 단계의 기본 문구로 제목·본문이 채워집니다. 기본 문구·단계는 위 단추로 바로 고칩니다');
    })()}
    <div id="sp-bulk-pick"></div>
    ${fg('제목', `<input class="fi" id="sp-mail-subject" value="${escAttr(`[${evName}] 연사 안내`)}">`)}
    ${fg('내용', `<textarea class="fi" id="sp-mail-body" rows="10" style="resize:vertical"></textarea>`)}
    ${fg('첨부', `<div id="sp-mail-files" style="font-size:11px"></div>
      <label class="btn" style="font-size:10.5px;margin-top:5px;display:inline-block;cursor:pointer">+ PC에서 파일 추가
        <input type="file" multiple style="display:none" onchange="addSpMailFiles(this)"></label>`,
      '단계의 기본 첨부는 «단계 편집»에서 올려 둡니다. PC에서 고른 파일은 합쳐서 3MB까지')}
    <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
      <button class="btn bp" style="font-size:11px" onclick="sendSpeakerMail()">보내기</button>
      <span id="sp-mail-msg" style="font-size:10.5px;color:var(--i4)"></span>
    </div>

    ${logs.length ? `<div style="font-size:11px;color:var(--i4);margin-top:16px;cursor:pointer" onclick="switchSpeakerDT('box')">
      주고받은 기록 ${logs.length}건은 «메일함» 탭에 있어요 ›</div>` : ''}`;
}

/* ── 메일함 — 이 연사와 주고받은 기록 ──
   보낸 메일·받은 메일을 최신순으로. 받은 메일은 읽음·처리를 체크한다(mail-mark.js) */
function boxTabHtml(sp){
  const logs = logsOfSpeaker(sp.id).filter(l => l.kind !== 'view')
    .slice().sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  const list = filterMail(logs);
  return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
      <div style="font-size:12px;font-weight:700;color:var(--i2)">주고받은 기록 ${logs.length || ''}</div>
      <button class="btn" style="font-size:10.5px;margin-left:auto" onclick="switchSpeakerDT('mail')">✉ 메일 쓰기</button>
    </div>
    ${logs.some(l => l.direction === 'in') ? mailFilBar(logs) : ''}
    ${list.length ? list.map(spLogRow).join('')
      : `<div style="font-size:11px;color:var(--i4);padding:6px 0">${logs.length ? '이 조건에 맞는 메일이 없어요'
        : '아직 주고받은 메일이 없어요 — 설정 › 행사 › 메일에서 메일함 기록을 가져올 수 있어요'}</div>`}`;
}

/* ── 메일 첨부 ──
   기본 첨부(그 단계에 올려 둔 가이드·양식)는 체크된 채로 나오고, PC에서 고른
   파일은 보내기 전까지 이 화면에만 들고 있는다. */
let spLocalFiles = [];
let spSkipDefault = new Set();
function renderSpMailFiles(kind, reset){
  const sp = getSpeakerById(spId);
  const el = document.getElementById('sp-mail-files');
  if(!sp || !el) return;
  if(reset){ spSkipDefault = new Set(); }
  const k = kind || document.getElementById('sp-mail-kind')?.value || '';
  // 회신 중이면 이 행사에 올려 둔 파일 전부를 고를 수 있게(처음엔 꺼 둔다)
  const defs = spReply ? mailFilesOf(sp.event_id) : mailFilesOf(sp.event_id).filter(f => f.step === k);
  const kb = (n) => n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
  const localTotal = spLocalFiles.reduce((n, f) => n + f.size, 0);
  el.innerHTML = (defs.map(f => `<label style="display:flex;gap:6px;align-items:center;padding:2px 0">
      ${spReply
        ? `<input type="checkbox" ${spReply.pick.has(f.id) ? 'checked' : ''} onchange="toggleSpReplyFile('${escAttr(f.id)}',this.checked)">`
        : `<input type="checkbox" ${spSkipDefault.has(f.id) ? '' : 'checked'} onchange="toggleSpDefaultFile('${escAttr(f.id)}',this.checked)">`}
      📎 ${escapeHtml(f.filename)} <span style="color:var(--i4)">${kb(Number(f.size) || 0)} · ${spReply ? '행사 파일' : '기본 첨부'}</span></label>`).join('')
    + spLocalFiles.map((f, i) => `<div style="display:flex;gap:6px;align-items:center;padding:2px 0">
      📎 ${escapeHtml(f.name)} <span style="color:var(--i4)">${kb(f.size)}</span>
      <button class="btn" style="font-size:10px;padding:1px 6px" onclick="removeSpMailFile(${i})">빼기</button></div>`).join(''))
    || '<span style="color:var(--i4)">첨부 없음</span>';
  if(localTotal > 3 * 1024 * 1024) el.innerHTML += `<div style="color:var(--re);margin-top:3px">PC 파일이 합쳐서 3MB를 넘어요 (${kb(localTotal)}) — 큰 파일은 링크로 보내주세요</div>`;
}
export function addSpMailFiles(input){
  spLocalFiles.push(...[...(input.files || [])]);
  input.value = '';
  renderSpMailFiles();
}
export function removeSpMailFile(i){ spLocalFiles.splice(i, 1); renderSpMailFiles(); }
export function toggleSpDefaultFile(id, on){ if(on) spSkipDefault.delete(id); else spSkipDefault.add(id); }

/* 뼈대 채우기 — 무엇을 받아야 하는지는 역할에서 이미 알고 있다.
   해외 연사(영문만)에게는 영문으로 만든다. */
/* 안 받은 자료를 한 통에 — 필수(지금·다음)와 있으면 좋음을 나눠 적는다.
   목록은 «남은 일»(pendingItems)과 같다. 연사가 영문(EN)이면 영문으로 */
/* 무엇을 이번에 요청할지 — 일부만 먼저 받는 일이 많아서 고를 수 있게 한다.
   기본은 필수(지금·다음)만 켜 둔다. 연사가 바뀌면 다시 기본으로 */
let bulkPick = null, bulkPickFor = '';
function bulkDefault(sp){ return new Set(pendingItems(sp).filter(x => x.when === 'now' || x.when === 'later').map(x => x.key)); }
export function toggleBulkItem(key, on){
  const sp = getSpeakerById(spId);
  if(!sp) return;
  if(!bulkPick || bulkPickFor !== sp.id){ bulkPick = bulkDefault(sp); bulkPickFor = sp.id; }
  on ? bulkPick.add(key) : bulkPick.delete(key);
  fillBulkRequest(sp);
}
window.toggleBulkItem = toggleBulkItem;
function renderBulkPick(sp){
  const el = document.getElementById('sp-bulk-pick');
  if(!el) return;
  const pend = pendingItems(sp).filter(x => x.when !== 'ours');
  const G = { now: '지금', later: '다음', nice: '있으면 좋음' };
  el.innerHTML = pend.length ? `<div class="mlbl">이번에 요청할 것 <span style="font-size:9px;color:var(--i4)">이미 받은 건 빠져 있어요 — 일부만 받은 건 빠진 부분을 적어요</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:4px 12px;margin:2px 0 8px">${pend.map(x => `<label style="display:flex;gap:4px;align-items:center;font-size:11.5px;cursor:pointer">
      <input type="checkbox" ${bulkPick.has(x.key) ? 'checked' : ''} onchange="toggleBulkItem('${escAttr(x.key)}',this.checked)">
      ${escapeHtml(x.label)}${x.more ? `<span style="color:var(--i4)">(${escapeHtml(x.more)})</span>` : ''}
      <span style="font-size:9.5px;color:var(--i5)">${G[x.when]}</span></label>`).join('')}</div>` : '';
}

function fillBulkRequest(sp){
  if(!bulkPick || bulkPickFor !== sp.id){ bulkPick = bulkDefault(sp); bulkPickFor = sp.id; }
  renderBulkPick(sp);
  const en = sp.lang_pref === 'en';
  const ev = EVENT_LIST.find(e => e.key === sp.event_id);
  const evName = ev ? ((en && ev.name_en) || ev.name || ev.short || ev.key) : sp.event_id;
  const pend = pendingItems(sp).filter(x => x.when !== 'ours' && bulkPick.has(x.key));
  const titleKo = String(sp.title_ko || '').split(/[\/·,]/)[0].trim();
  const name = en ? (sp.name_en || sp.name_snapshot || '') : (sp.name_snapshot || sp.name_en || '');
  const honor = en ? name : (titleKo ? `${name} ${titleKo}님` : `${name} 님`);
  const line = (x) => `- ${x.label}${x.more ? ` (${x.more})` : ''}${x.due ? (en ? ` — by ${x.due}` : ` — ${x.due}까지`) : ''}`;
  const req = pend.filter(x => x.when === 'now' || x.when === 'later');
  const nice = pend.filter(x => x.when === 'nice');
  const me = currentUser?.name || '';
  const body = en
    ? `Dear ${honor},\n\nTo prepare for ${evName}, may we kindly ask you to send us the following.\n\n${
        req.length ? `Required:\n${req.map(line).join('\n')}\n\n` : ''}${
        nice.length ? `If available:\n${nice.map(line).join('\n')}\n\n` : ''}Thank you very much for your help.\n\nBest regards,\n${/[가-힣]/.test(me) ? '' : me}\n${evName} Secretariat`
    : `${honor}께\n\n안녕하십니까. ${evName} 사무국 ${me}입니다.\n행사 준비를 위해 아래 자료를 한꺼번에 요청드립니다.\n\n${
        req.length ? `■ 꼭 필요한 자료\n${req.map(line).join('\n')}\n\n` : ''}${
        nice.length ? `■ 있으시면 함께 보내주실 자료\n${nice.map(line).join('\n')}\n\n` : ''}바쁘신 중에 번거로우시겠지만 부탁드립니다.\n\n감사합니다.\n${evName} 사무국 ${me} 드림`;
  const s = document.getElementById('sp-mail-subject'), b = document.getElementById('sp-mail-body');
  if(s) s.value = en ? `[${evName}] Request for Outstanding Materials` : `[${evName}] 미제출 자료 요청 — ${honor}`;
  if(b) b.value = pend.length ? body : (en ? 'Nothing outstanding.' : '안 받은 자료가 없어요.');
}

export function fillSpeakerMail(kind){
  const sp = getSpeakerById(spId);
  if(!sp) return;
  const sel = document.getElementById('sp-mail-kind');
  if(sel && sel.value !== kind) sel.value = kind;
  renderSpMailFiles(kind, true);
  if(kind === 'bulkreq'){ fillBulkRequest(sp); return; }
  const bp = document.getElementById('sp-bulk-pick'); if(bp) bp.innerHTML = '';
  const d = draftFor(sp, kind);
  if(d){
    const s = document.getElementById('sp-mail-subject');
    const b = document.getElementById('sp-mail-body');
    if(s) s.value = d.subject;
    if(b) b.value = d.body;
    return;
  }
  const evKey = sp.event_id;
  const ev = EVENT_LIST.find(e => e.key === evKey);
  const evName = ev ? ((sp.lang_pref === 'en' && ev.name_en) || ev.name || ev.short || ev.key) : evKey;
  const cfg = confCfg(evKey);
  const lim = cfg.limits || {};
  const asg = assignmentsFor(sp.id);
  const en = sp.lang_pref === 'en';
  const name = sp.name_snapshot || sp.name_en || '';

  const due = (k) => (cfg.due || {})[k] || '';
  const dueLine = (k, ko) => due(k) ? `\n- ${ko} 마감: ${due(k)}` : '';

  const sessions = asg.map(a => {
    const s = CONF_SESSIONS.find(x => x.id === a.session_id);
    /* 연사에게는 세션 시간이 아니라 «본인 발표 시각»을 알려야 한다 */
    const when = a.start_at ? `${a.start_at}${a.end_at ? '–' + a.end_at : ''}` : (s?.start_at || '');
    return `  · ${s ? (s.title_ko || s.title_en || s.id) : ''}${s?.date ? ` (${s.date}${when ? ' ' + when : ''})` : ''} — ${a.role}`;
  }).join('\n');

  const bodies = {
    invite: en
      ? `Dear ${name},\n\nWe are pleased to invite you to ${evName}.\n\n${sessions ? `Your session(s):\n${sessions}\n\n` : ''}We would be grateful if you could confirm your participation.\n\nBest regards,`
      : `${name} 님, 안녕하세요.\n\n${evName}에 연사로 모시고자 연락드립니다.\n\n${sessions ? `배정 세션\n${sessions}\n\n` : ''}참석 가능 여부를 회신해 주시면 감사하겠습니다.\n\n감사합니다.`,
    /* 무엇을 달라고 할지는 역할이 요구하는 것에서 나온다 — 좌장에게 발제를
       묻지 않듯, 이 행사가 학력을 안 받으면 메일에도 안 적는다. */
    profile: (() => {
      const roles = rolesOfSpeaker(sp.id);
      const want = BIO_PARTS.filter(p => needState(evKey, roles, p.need));
      const line = (p) => {
        const l = lim[p.lim];
        return en ? `- ${p.label}${l ? ` (within ${l} characters)` : ''}`
          : `- ${p.label}${l ? ` (${l}자 이내)` : ''}`;
      };
      return en
        ? `Dear ${name},\n\nCould you please send us the following for the programme book?\n${
            want.map(line).join('\n')}\n- A portrait photo (high resolution)\n\nBest regards,`
        : `${name} 님, 안녕하세요.\n\n프로그램북 제작을 위해 아래 자료를 부탁드립니다.\n${
            want.map(line).join('\n')}\n- 사진 (고해상도)${dueLine('profile', '자료')}\n\n감사합니다.`;
    })(),
    abstract: en
      ? `Dear ${name},\n\nCould you please send us your presentation title and abstract?${lim.abstract ? `\nAbstract: within ${lim.abstract} characters.` : ''}\n\nBest regards,`
      : `${name} 님, 안녕하세요.\n\n발제명과 초록을 부탁드립니다.${lim.abstract ? `\n초록은 ${lim.abstract}자 이내로 부탁드립니다.` : ''}${dueLine('abstract', '초록')}\n\n감사합니다.`,
    slides: en
      ? `Dear ${name},\n\nCould you please send us your presentation file?\nIf you revise it later, please let us know which version is final.\n\nBest regards,`
      : `${name} 님, 안녕하세요.\n\n발표자료를 부탁드립니다.\n현장에서 수정하실 경우 어느 판이 최종인지 알려주시면 그대로 준비하겠습니다.${dueLine('slides', '발표자료')}\n\n감사합니다.`,
    travel: en
      ? `Dear ${name},\n\nWe will arrange your accommodation and flights.\nCould you please confirm your preferred dates and send a scan of your passport?\n\nBest regards,`
      : `${name} 님, 안녕하세요.\n\n숙박과 항공을 준비하겠습니다.\n희망 일정과 여권 스캔본을 보내주시면 예약 후 안내드리겠습니다.\n\n감사합니다.`,
    note: en ? `Dear ${name},\n\n\nBest regards,` : `${name} 님, 안녕하세요.\n\n\n감사합니다.`,
  };
  const subjects = {
    invite:   en ? `[${evName}] Invitation to speak` : `[${evName}] 연사 초청`,
    profile:  en ? `[${evName}] Speaker profile request` : `[${evName}] 이력·사진 요청`,
    abstract: en ? `[${evName}] Title & abstract request` : `[${evName}] 발제명·초록 요청`,
    slides:   en ? `[${evName}] Presentation file request` : `[${evName}] 발표자료 요청`,
    travel:   en ? `[${evName}] Accommodation & flight` : `[${evName}] 숙박·항공 안내`,
    note:     en ? `[${evName}]` : `[${evName}] 안내`,
  };
  const s = document.getElementById('sp-mail-subject');
  const b = document.getElementById('sp-mail-body');
  if(s) s.value = subjects[kind] || subjects.note;
  if(b) b.value = bodies[kind] || bodies.note;
  /* 이미 받은 항목을 알아서 빼 주고 싶지만 그러지 않는다 — 무엇을 뺐는지
     사람이 모르면 빠뜨린 요청을 눈치챌 수 없다. 뼈대만 주고 지우는 건 사람이 한다. */
}

export async function sendSpeakerMail(){
  if(confLocked()){ confLockNotice(); return; }
  const sp = getSpeakerById(spId);
  if(!sp) return;
  const msg = document.getElementById('sp-mail-msg');
  const say = (t, ok) => { if(msg){ msg.style.color = ok ? 'var(--g)' : 'var(--re)'; msg.textContent = t; } };

  const reply = spReply;
  const t = reply ? { to: reply.to, cc: [] } : mailTargets(sp.id);
  if(!t.to.length){ say('수신이 없어요 — «연락 상대»에서 먼저 정해주세요.', false); return; }
  const subject = (document.getElementById('sp-mail-subject')?.value || '').trim();
  const text = (document.getElementById('sp-mail-body')?.value || '').trim();
  if(!subject && !text){ say('제목이나 내용 중 하나는 있어야 해요.', false); return; }
  // 회신은 연락 단계 메일이 아니다 — 단계 기록·기본 첨부·날짜 찍기를 하지 않는다
  const pick = document.getElementById('sp-mail-kind')?.value || 'note';
  // 일괄 요청은 «자료 받기» 메일로 남긴다 — 그래야 다음 메일이 «독촉»으로 바뀐다
  const kind = reply ? 'reply' : pick === 'bulkreq' ? 'collect' : pick;
  const flowD = reply ? null : draftFor(sp, kind);
  const category = reply ? '회신' : pick === 'bulkreq' ? '자료 일괄 요청'
    : flowD ? flowD.category : ((MAIL_KINDS.find(k => k.key === kind) || {}).label || '기타');

  /* 밖으로 나가는 일은 한 번 묻는다 — 받는 사람을 눈으로 확인하지 않으면
     엉뚱한 사람에게 간 걸 나중에 알게 된다. */
  const from = await eventMailFrom(sp.event_id);
  if(!from.ok){ say(from.text, false); return; }
  if(!confirm(`이 내용으로 보낼까요?\n\n발신 ${from.text}\n수신 ${t.to.join(', ')}${t.cc.length ? `\n참조 ${t.cc.join(', ')}` : ''}\n제목 ${subject}`)) return;

  const fileIds = reply ? [...reply.pick]
    : mailFilesOf(sp.event_id).filter(f => f.step === kind && !spSkipDefault.has(f.id)).map(f => f.id);
  if(spLocalFiles.reduce((n, f) => n + f.size, 0) > 3 * 1024 * 1024){ say('PC에서 고른 첨부가 3MB를 넘어요.', false); return; }

  say('보내는 중…', true);
  const attachments = [];
  for(const f of spLocalFiles) attachments.push({ filename: f.name, content_type: f.type, data: await fileToBase64(f) });
  const res = await sendMail({ to: t.to, cc: t.cc, subject, text, speaker_id: sp.id, category, kind,
    attachments, file_ids: fileIds });
  if(!res.ok){
    say(res.offline ? '테스트 모드에서는 보내지 않아요.' : (res.error || '보내지 못했어요.'), false);
    return;
  }
  /* 서버가 기록을 남긴다. 화면에도 같은 줄을 바로 끼운다 — 새로 고쳐야
     보이면 방금 보낸 게 안 남은 줄 알고 또 보낸다. */
  /* 서버가 남긴 기록 id를 쓴다 — 임시 id로 두면 연사를 지울 때 이 기록이 안 지워졌다.
     기록 저장에 실패했으면 화면에도 끼우지 않는다(없는 기록을 보여 주면 안 된다) */
  if(res.logId) SPEAKER_LOGS.push({
    id: res.logId, speaker_id: sp.id, kind, ts: nowStamp(),
    direction: 'out', channel: '이메일',
    counterpart: [t.to.join(', '), t.cc.length ? `(cc) ${t.cc.join(', ')}` : ''].filter(Boolean).join(' '),
    category, subject, answered_at: '', answer: '', status: 'done',
    body: text + ((attachments.length || fileIds.length)
      ? `\n\n[첨부] ${[...mailFilesOf(sp.event_id).filter(f => fileIds.includes(f.id)).map(f => f.filename), ...spLocalFiles.map(f => f.name)].join(', ')}` : ''),
    author_email: '', author_name: '',
  });
  trackAction('add', '연사 메일', sp.event_id, `${sp.name_snapshot || sp.name_en || sp.id} — ${category}`,
    { kind: 'speaker', id: sp.id });
  say((res.logged === false ? '보냈어요 — 다만 기록 저장에 실패했어요.' : '보냈어요.')
    + (res.sentError ? ` (보낸메일함에는 못 남겼어요: ${res.sentError})` : ''), true);
  spLocalFiles = []; spSkipDefault = new Set();
  // 회신이었으면 그 받은 메일을 처리함으로 닫는다
  if(reply){ spReply = null; await setMailDone('sp', reply.logId, true); renderSpeakerDr(); return; }
  /* 자료 독촉을 보냈으면 «마지막 독촉» 날짜를 찍는다 — 표의 독촉 칸·엑셀이 이걸 읽는다 */
  if(category === '자료 독촉'){ await patchSpeaker({ reminded_at: td() }, '자료 독촉 보냄', sp.id); }
  /* 초청을 보냈으면 «보냄» 날짜를 찍는다 — 그래야 다음 단계로 넘어간다.
     sp.id를 넘긴다 — 보내는 몇 초 사이 다른 연사를 열면 그 사람에게 찍혔다 */
  if(kind === 'invite' && !sp.guide_sent_at){ await patchSpeaker({ guide_sent_at: td() }, '초청·가이드 보냄', sp.id); return; }
  renderSpeakerDr();
}

/* ══════════════════════════════════════════════════════════════
   제공사항 — 연사료 · 숙박 · 항공

   우리가 주는 것들이다. 받는 것(이력·초록)과 성격이 달라 탭을 나눴다 —
   숙박을 확인하려고 열 때마다 초록 칸을 지나칠 이유가 없다.

   원천징수는 칸만 두고 계산하지 않는다. 국내·해외, 사업소득·기타소득에
   따라 세율이 갈리고 조세조약까지 걸리는데, 어설프게 계산해 두면 그 숫자를
   믿고 지급해 버린다. 지금은 «어느 쪽인지»만 적어 둔다.

   항공은 오는 편과 가는 편이 따로다. 한 줄로 적으면 어느 편이 언제인지
   현장에서 다시 물어야 한다.
══════════════════════════════════════════════════════════════ */

const CURRENCIES = ['KRW', 'USD', 'EUR', 'JPY'];
const TAX_TYPES = ['국내 사업소득', '국내 기타소득', '해외 거주자', '지급 없음'];
const AIR_CLASSES = ['이코노미', '프리미엄 이코노미', '비즈니스'];

/* 금액은 자릿수를 끊어 보여준다 — 0이 하나 더 붙은 걸 눈으로 잡으려면 필요하다 */
const money = (v, cur) => {
  const n = Number(String(v || '').replace(/[^\d.-]/g, ''));
  if(!Number.isFinite(n) || !n) return '';
  return `${n.toLocaleString('ko-KR')} ${cur || 'KRW'}`;
};

function offerHtml(sp, evKey){
  const roles = rolesOfSpeaker(sp.id);
  const nTravel = needState(evKey, roles, 'travel');
  const feeNeed = needState(evKey, roles, 'bank');

  const sel = (val, opts, handler, blank) => `<select class="fi" onchange="${handler}">
    ${blank ? `<option value=""${!val ? ' selected' : ''}>${blank}</option>` : ''}
    ${opts.map(o => `<option value="${escAttr(o)}"${val === o ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}
  </select>`;

  const fee = `<div style="border:1px solid var(--i6);border-radius:9px;padding:11px 12px;margin-bottom:11px">
    <div style="display:flex;align-items:baseline;gap:7px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700">연사료</div>
      ${sp.fee_amount ? `<div style="font-size:11px;color:var(--i3)">${escapeHtml(money(sp.fee_amount, sp.fee_currency))}</div>` : ''}
      ${sp.fee_paid_at ? `<span class="pill p-green" style="font-size:10px">지급 ${escapeHtml(sp.fee_paid_at)}</span>`
        : sp.fee_amount ? `<span class="pill p-amber" style="font-size:10px">미지급</span>` : ''}
    </div>
    ${(sp.nationality && sp.residence_country && sp.nationality !== sp.residence_country) ? `
      <div class="fg"><label class="fl">지급 기준</label>
        <div class="seg" style="flex-wrap:wrap">
          ${[['residence', `거주지 (${escapeHtml(countryName(sp.residence_country))})`],
             ['nationality', `국적 (${escapeHtml(countryName(sp.nationality))})`]].map(([k, l]) =>
            `<button class="seg-b${(sp.pay_basis || 'residence') === k ? ' on' : ''}"
              onclick="spField('pay_basis','${k}','지급 기준')">${l}</button>`).join('')}
        </div>
        <div style="font-size:10px;color:var(--i4);margin-top:3px">
          연사료 원천징수와 항공 출발지가 이 기준을 따릅니다 — 행사마다 다르니 여기서 정합니다.</div>
      </div>` : ''}
    <div class="fgr">
      ${fg('금액', txt(sp.fee_amount, `spField('fee_amount',this.value,'연사료 금액')`, '500000'))}
      ${fg('통화', sel(sp.fee_currency || 'KRW', CURRENCIES, `spField('fee_currency',this.value,'연사료 통화')`))}
    </div>
    <div class="fgr">
      ${fg('원천징수 구분', sel(sp.fee_tax_type, TAX_TYPES, `spField('fee_tax_type',this.value,'원천징수 구분')`, '미정'),
        (() => {
          /* 기준 국가가 해외인데 국내 소득으로 잡혀 있으면 짚어 준다. 고치지는
             않는다 — 조세조약이나 국내 지급 대리인처럼 우리가 모르는 사정이 있다. */
          const pc = payCountry(sp);
          const overseas = pc && countryName(pc) !== '대한민국';
          if(overseas && /^국내/.test(sp.fee_tax_type || '')){
            return `<span style="color:var(--am)">기준이 ${escapeHtml(countryName(pc))}인데 국내 소득으로 잡혀 있어요 — 맞는지 확인해주세요</span>`;
          }
          return '세액은 계산하지 않습니다 — 어느 쪽인지만 적어 두세요';
        })())}
      ${fg('지급일', dateIn(sp.fee_paid_at, `spField('fee_paid_at',this.value,'연사료 지급일')`))}
    </div>
    ${feeNeed ? `<div style="font-size:10.5px;color:${sp.bank_account ? 'var(--i4)' : 'var(--am)'};margin:-2px 0 8px">
      ${sp.bank_account ? '계좌는 «계좌·여권» 탭에 있어요' : '계좌를 아직 안 받았어요 — «계좌·여권» 탭에서 넣습니다'}</div>` : ''}
    ${fg('메모', area(sp.fee_note, `spField('fee_note',this.value,'연사료 메모')`, '지급 조건, 정산 담당 등', 2))}
  </div>`;

  const stay = `<div style="border:1px solid var(--i6);border-radius:9px;padding:11px 12px;margin-bottom:11px">
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700">숙박</div>
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--i3);margin-left:auto">
        <input type="checkbox" ${sp.stay_booked === 'yes' ? 'checked' : ''}
          onchange="spField('stay_booked',this.checked?'yes':'','숙박 예약 완료')"> 예약 완료
      </label>
    </div>
    <div class="fgr">
      ${fg('호텔', txt(sp.stay_hotel, `spField('stay_hotel',this.value,'호텔')`, '호텔명'))}
      ${fg('객실', txt(sp.stay_room_type, `spField('stay_room_type',this.value,'객실')`, '싱글 / 더블'))}
    </div>
    <div class="fgr">
      ${fg('체크인', dateIn(sp.stay_in, `spField('stay_in',this.value,'체크인')`))}
      ${fg('체크아웃', dateIn(sp.stay_out, `spField('stay_out',this.value,'체크아웃')`))}
    </div>
    ${sp.stay_in && sp.stay_out && sp.stay_out <= sp.stay_in
      ? `<div style="font-size:10.5px;color:var(--re);margin:-4px 0 8px">체크아웃이 체크인보다 빠르거나 같아요</div>` : ''}
    ${fg('메모', area(sp.stay_note, `spField('stay_note',this.value,'숙박 메모')`, '조식 포함 여부, 연박 등', 2))}
  </div>`;

  const air = `<div style="border:1px solid var(--i6);border-radius:9px;padding:11px 12px;margin-bottom:11px">
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700">항공</div>
      ${sp.air_ticketed_at ? `<span class="pill p-green" style="font-size:10px">발권 ${escapeHtml(sp.air_ticketed_at)}</span>` : ''}
    </div>
    <div class="fgr">
      ${fg('구간', txt(sp.air_route, `spField('air_route',this.value,'항공 구간')`, 'ICN–NRT'))}
      ${fg('좌석', sel(sp.air_class, AIR_CLASSES, `spField('air_class',this.value,'좌석 등급')`, '미정'))}
    </div>
    <div style="font-size:10.5px;font-weight:700;color:var(--i3);margin:6px 0 3px">오는 편</div>
    <div class="fgr">
      ${fg('편명', txt(sp.air_in_flight, `spField('air_in_flight',this.value,'오는 편명')`, 'KE001'))}
      ${fg('일시', txt(sp.air_in_at, `spField('air_in_at',this.value,'오는 편 일시')`, '2026-06-01 14:30'))}
    </div>
    <div style="font-size:10.5px;font-weight:700;color:var(--i3);margin:6px 0 3px">가는 편</div>
    <div class="fgr">
      ${fg('편명', txt(sp.air_out_flight, `spField('air_out_flight',this.value,'가는 편명')`, 'KE002'))}
      ${fg('일시', txt(sp.air_out_at, `spField('air_out_at',this.value,'가는 편 일시')`, '2026-06-03 09:10'))}
    </div>
    ${fg('발권일', dateIn(sp.air_ticketed_at, `spField('air_ticketed_at',this.value,'발권일')`))}
    ${fg('메모', area(sp.air_note, `spField('air_note',this.value,'항공 메모')`, '경유, 마일리지, 좌석 요청 등', 2))}
  </div>`;

  const hint = !nTravel ? `<div style="padding:9px 11px;background:var(--i8);border:1px solid var(--i6);
    border-radius:7px;font-size:11.5px;color:var(--i3);line-height:1.6;margin-bottom:11px">
    이 연사의 역할(${escapeHtml(roles.join(' · ') || '배정 없음')})은 숙박·항공을 챙기는 대상이 아니에요.
    그래도 필요하면 아래에 적어 두세요.</div>` : '';

  return hint + fee + stay + air;
}

/* ══════════════════════════════════════════
   계좌 · 여권

   연사료를 주려면 계좌가 있어야 하고, 해외 연사는 항공권을 끊으려면 여권이
   필요하다. 둘 다 다른 정보와 성격이 다르다 — 숙박을 확인하러 열 때마다
   계좌번호가 같이 보일 이유가 없다.

   그래서 기본은 가려 두고, 「보기」를 눌러야 열리며 누가 언제 봤는지 남긴다.
   가리는 것 자체가 보호는 아니다(값은 이미 브라우저에 와 있다). 보호하는 건
   기록이다 — 누가 봤는지 남으면 함부로 열지 않는다.
══════════════════════════════════════════ */
let bankRevealed = false;   // 드로어를 닫거나 다른 연사로 옮기면 다시 가린다

/* 뒷자리만 남긴다. 계좌를 «확인»하는 데는 뒷자리로 충분하고,
   전체가 필요한 건 실제로 이체할 때뿐이다. */
const mask = (v, keep) => {
  const s = String(v || '').trim();
  if(!s) return '';
  const k = keep || 4;
  if(s.length <= k) return '•'.repeat(s.length);
  return '•'.repeat(Math.min(s.length - k, 12)) + s.slice(-k);
};

/* 국내·해외 판정은 state.js(isDomesticSpeaker)에 있다 — 연사 표와 같은 기준을 쓴다. */
const isDomestic = isDomesticSpeaker;

/* 국내·해외 양식을 고르는 줄. «자동»은 국적·거주지로 정한다. */
function bankModeRow(sp){
  const auto = autoDomestic(sp) ? '국내' : '해외';
  const opt = (v, l) => `<option value="${v}"${(sp.bank_mode || '') === v ? ' selected' : ''}>${l}</option>`;
  return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:11px">
    <span style="color:var(--i3)">받는 양식</span>
    <select class="fi" style="width:auto;padding:3px 6px;font-size:11px"
      onchange="spField('bank_mode',this.value,'계좌 양식')">
      ${opt('', `자동 (${auto})`)}${opt('domestic', '국내 — 신분증·통장사본')}${opt('overseas', '해외 — KIC 양식·여권')}
    </select>
    ${sp.bank_mode ? '<span style="color:var(--am)">직접 정함</span>' : ''}
  </div>`;
}

function domesticBankHtml(sp, nBank){
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <div style="font-size:11px;color:var(--am)">열람 중 — 기록에 남았습니다</div>
      <button class="btn" style="font-size:10.5px;margin-left:auto" onclick="hideBank()">가리기</button>
    </div>
    ${bankModeRow(sp)}
    <div style="border:1px solid var(--i6);border-radius:9px;padding:11px 12px">
      <div style="font-size:12px;font-weight:700;margin-bottom:4px">국내 계좌 ${nBank ? NEED_MARK[nBank] : ''}</div>
      <div style="font-size:10.5px;color:var(--i4);margin-bottom:8px;line-height:1.6">
        신분증과 통장사본만 받습니다.</div>
      ${gotRow('신분증 받음', sp.id_card_received_at,
        `spStamp('id_card_received_at','신분증 받음')`,
        `spField('id_card_received_at',this.value,'신분증 받은 날')`, nBank || 'opt')}
      ${fg('신분증 파일명', txt(sp.id_card_file, `spField('id_card_file',this.value,'신분증 파일')`, '원드라이브 파일명'))}
      ${gotRow('통장사본 받음', sp.bankbook_received_at,
        `spStamp('bankbook_received_at','통장사본 받음')`,
        `spField('bankbook_received_at',this.value,'통장사본 받은 날')`, nBank || 'opt')}
      ${fg('통장사본 파일명', txt(sp.bankbook_file, `spField('bankbook_file',this.value,'통장사본 파일')`, '원드라이브 파일명'))}
      <div class="fgr">
        ${fg('은행', txt(sp.bank_name, `spField('bank_name',this.value,'은행')`, '예: 국민은행'))}
        ${fg('예금주', txt(sp.bank_holder, `spField('bank_holder',this.value,'예금주')`, '통장사본에 적힌 그대로'))}
      </div>
      ${fg('계좌번호', txt(sp.bank_account, `spField('bank_account',this.value,'계좌번호')`))}
      <div style="font-size:10.5px;color:var(--i4);margin-top:-4px">
        스캔본은 원드라이브에 두고 여기엔 파일명만 적습니다.</div>
    </div>`;
}

function bankHtml(sp, evKey){
  const roles = rolesOfSpeaker(sp.id);
  const nBank = needState(evKey, roles, 'bank');
  const nPass = needState(evKey, roles, 'passport');
  const has = sp.bank_account || sp.bank_holder || sp.bank_name;

  if(!bankRevealed){
    return `<div style="padding:14px;background:var(--i8);border:1px solid var(--i6);border-radius:9px">
      <div style="font-size:12px;font-weight:700;margin-bottom:6px">계좌 · 여권</div>
      <div style="font-size:11.5px;color:var(--i3);line-height:1.7">
        ${has
          ? `예금주 <b>${escapeHtml(sp.bank_holder || '(없음)')}</b> · ${escapeHtml(sp.bank_name || '은행 미상')}
             <br>계좌 ${escapeHtml(mask(sp.bank_account))}`
          : '아직 계좌를 받지 않았어요.'}
        ${sp.passport_file ? `<br>여권 스캔 ${escapeHtml(sp.passport_received_at || '')} 받음` : ''}
      </div>
      <div style="font-size:10.5px;color:var(--i4);margin-top:8px;line-height:1.6">
        전체를 보려면 아래를 누르세요. 누가 언제 열었는지 기록에 남습니다.</div>
      <button class="btn" style="font-size:11px;margin-top:8px" onclick="revealBank()">전체 보기</button>
    </div>`;
  }

  if(isDomestic(sp)) return domesticBankHtml(sp, nBank);

  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <div style="font-size:11px;color:var(--am)">열람 중 — 기록에 남았습니다</div>
      <button class="btn" style="font-size:10.5px;margin-left:auto" onclick="hideBank()">가리기</button>
    </div>
    ${bankModeRow(sp)}
    <div style="border:1px solid var(--i6);border-radius:9px;padding:11px 12px;margin-bottom:11px">
      <div style="font-size:12px;font-weight:700;margin-bottom:8px">계좌 ${nBank ? NEED_MARK[nBank] : ''}</div>
      <div style="font-size:10.5px;color:var(--i4);margin:-2px 0 10px;line-height:1.6">
        KIC 연사 양식(Appendix 4 Bank Information Form) 순서대로 적습니다.
        해외 송금은 하나라도 빠지면 은행에서 되돌아옵니다.</div>
      ${gotRow('계좌 양식(Word) 받음', sp.bank_form_received_at,
        `spStamp('bank_form_received_at','계좌 양식 받음')`,
        `spField('bank_form_received_at',this.value,'계좌 양식 받은 날')`, nBank || 'opt')}
      ${fg('양식 파일명', txt(sp.bank_form_file, `spField('bank_form_file',this.value,'계좌 양식 파일')`, '원드라이브 파일명'))}
      <div style="font-size:11px;font-weight:700;color:var(--i3);margin:4px 0 6px">연사 (Personal Information)</div>
      <div class="fgr">
        ${fg('이름 (First Name)', txt(sp.bank_first_name, `spField('bank_first_name',this.value,'First Name')`, '여권 표기 그대로'))}
        ${fg('성 (Last Name)', txt(sp.bank_last_name, `spField('bank_last_name',this.value,'Last Name')`, '여권 표기 그대로'))}
      </div>
      <div class="fgr">
        ${fg('국적 (Nationality)', `<select class="fi" onchange="spField('nationality',this.value,'국적')">
          <option value="">미정</option>${countryOptions(sp.nationality)}</select>`, '기본 정보의 국적과 같은 칸입니다')}
        ${fg('소속 (Institution)', txt(sp.org_en, `spField('org_en',this.value,'소속 영문')`), '기본 정보의 소속 영문과 같은 칸입니다')}
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--i3);margin:4px 0 6px">받는 사람 (Account Holder)</div>
      ${fg('예금주 (Name)', txt(sp.bank_holder, `spField('bank_holder',this.value,'예금주')`, '통장에 찍힌 영문 이름 그대로'))}
      <div class="fgr">
        ${fg('주소 (Address)', txt(sp.bank_holder_address, `spField('bank_holder_address',this.value,'예금주 주소')`))}
        ${fg('우편번호 (Postal Code)', txt(sp.bank_holder_postal, `spField('bank_holder_postal',this.value,'예금주 우편번호')`))}
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--i3);margin:4px 0 6px">은행 (Bank Info)</div>
      <div class="fgr">
        ${fg('은행 (Bank Name)', txt(sp.bank_name, `spField('bank_name',this.value,'은행')`))}
        ${fg('지점 (Branch Name)', txt(sp.bank_branch, `spField('bank_branch',this.value,'지점')`))}
      </div>
      <div class="fgr">
        ${fg('은행 주소 (Bank Address)', txt(sp.bank_address, `spField('bank_address',this.value,'은행 주소')`), '도시와 국가는 꼭 들어가야 합니다')}
        ${fg('은행 국가', txt(sp.bank_country, `spField('bank_country',this.value,'은행 국가')`))}
      </div>
      <div class="fgr">
        ${fg('SWIFT / BIC', txt(sp.bank_swift, `spField('bank_swift',this.value,'SWIFT')`, '8~11자'),
          sp.bank_swift && !/^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$/.test(sp.bank_swift.trim())
            ? '<span style="color:var(--am)">8자나 11자가 아니에요 — 다시 확인해 주세요</span>' : '')}
        ${fg('계좌번호 (Account No.)', txt(sp.bank_account, `spField('bank_account',this.value,'계좌번호')`))}
      </div>
      <div class="fgr">
        ${fg('ABA / IBAN 구분', `<select class="fi" onchange="spField('bank_iban_kind',this.value,'ABA·IBAN 구분')">
          ${[['', '(없음)'], ['ABA', 'ABA (미국)'], ['IBAN', 'IBAN']].map(([v, l]) =>
            `<option value="${v}"${(sp.bank_iban_kind || '') === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>`)}
        ${fg('ABA / IBAN 번호', txt(sp.bank_iban, `spField('bank_iban',this.value,'ABA·IBAN')`))}
      </div>
      ${fg('은행 코드 (Bank Codes)', txt(sp.bank_code, `spField('bank_code',this.value,'은행 코드')`, '예: Sort Code 123456'),
        '영국 Sort Code(6자리) · 호주 BSB(6자리) · 캐나다 CC(0+기관번호+지점번호)는 꼭 받습니다')}
      ${fg('비고 (Other Remarks)', area(sp.bank_note, `spField('bank_note',this.value,'계좌 비고')`, '', 2))}
      <div style="font-size:10.5px;color:var(--i4);margin-top:-4px">
        연사료는 USD로 보냅니다 — USD를 받을 수 있는 계좌인지 확인하세요.</div>
    </div>
    <div style="border:1px solid var(--i6);border-radius:9px;padding:11px 12px">
      <div style="font-size:12px;font-weight:700;margin-bottom:8px">여권 ${nPass ? NEED_MARK[nPass] : ''}</div>
      ${gotRow('여권 스캔 받음', sp.passport_received_at,
        `spStamp('passport_received_at','여권 받음')`,
        `spField('passport_received_at',this.value,'여권 받은 날')`, nPass || 'opt')}
      ${fg('파일명', txt(sp.passport_file, `spField('passport_file',this.value,'여권 파일')`, '원드라이브 파일명'))}
      <div style="font-size:10.5px;color:var(--i4);margin-top:-4px">
        스캔본은 원드라이브에 두고 여기엔 파일명만 적습니다 — 이미지가 이 화면에 뜨면
        누가 옆에서 봐도 그대로 보입니다.</div>
    </div>`;
}

/* 열람을 기록에 남긴다. 저장이 실패하면 열지 않는다 — 기록 없이 보는 길이
   생기면 기록이 있다는 사실 자체가 의미를 잃는다. */
export async function revealBank(){
  const sp = getSpeakerById(spId);
  if(!sp) return;
  const row = {
    speaker_id: sp.id, kind: 'view', ts: td(),
    direction: '', channel: '', counterpart: '', category: '계좌·여권 열람',
    subject: '계좌·여권 전체 보기', body: '', answered_at: '', answer: '', status: 'done',
    author_email: currentUser?.email || '', author_name: currentUser?.name || '',
  };
  const res = await saveSpeakerLog(row);
  if(!res || res.ok === false){
    if(res?.offline){
      /* 테스트 모드는 서버가 없어 기록이 남지 않는다. 더미 데이터라 가릴
         것도 없으니 열어 준다 — 대신 기록이 안 남는다고 알린다. */
      bankRevealed = true;
      SPEAKER_LOGS.push({ ...row, id: `SL-tmp-${Date.now()}` });
      renderSpeakerDr();
      return;
    }
    alert('열람 기록을 남기지 못해 열지 않았어요. 잠시 뒤 다시 해주세요.');
    return;
  }
  SPEAKER_LOGS.push({ ...row, id: res.id || `SL-tmp-${Date.now()}` });
  trackAction('view', '연사 계좌·여권', sp.event_id, sp.name_snapshot || sp.name_en || sp.id);
  bankRevealed = true;
  renderSpeakerDr();
}
export function hideBank(){ bankRevealed = false; renderSpeakerDr(); }

/* ── 노출 ── */
window.openSpeakerDr        = openSpeakerDr;
window.closeSpeakerDr       = closeSpeakerDr;
window.removeSpeakerFromDr  = removeSpeakerFromDr;
window.switchSpeakerDT      = switchSpeakerDT;
window.spField              = spField;
window.asField              = asField;
window.spStamp              = spStamp;
window.applySpReuse         = applySpReuse;
window.confirmSpReuse       = confirmSpReuse;
window.asStamp              = asStamp;
window.searchSpeakerContact = searchSpeakerContact;
window.linkSpeakerContact   = linkSpeakerContact;
window.openFlowDraft = openFlowDraft;
window.addSpMailFiles = addSpMailFiles;
window.removeSpMailFile = removeSpMailFile;
window.toggleSpDefaultFile = toggleSpDefaultFile;
window.spContactField     = spContactField;
window.createSpeakerContact = createSpeakerContact;
window.unlinkSpeakerContact = unlinkSpeakerContact;
window.pullSpeakerProfile   = pullSpeakerProfile;
window.pushSpeakerProfile   = pushSpeakerProfile;
window.renderSpeakerDr      = renderSpeakerDr;
window.addSpeakerContact    = addSpeakerContact;
window.scField              = scField;
window.removeSpeakerContact = removeSpeakerContact;
window.fillSpeakerMail      = fillSpeakerMail;
window.sendSpeakerMail      = sendSpeakerMail;
window.revealBank           = revealBank;
window.hideBank             = hideBank;
