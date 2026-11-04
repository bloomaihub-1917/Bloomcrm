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
  getSpeakerById, assignmentsFor, rolesOfSpeaker, leadOf, coOf,
  contactsOfSpeaker, logsOfSpeaker,
  confCfg, speakerNeed, speakerNeedList,
  isDomesticSpeaker, autoDomestic, bankDocs, paysFee,
  nextContactId,
  isFlowV2,
} from '../state.js';
import { SPEAKER_ROLES, NEED_MARK, NEED_LABEL, SP_CONSENTS } from '../constants.js';
import '../shared/mail/flow-editor.js';
import { td, nowStamp, mailDirPill, escapeHtml, escAttr, countryOptions, countryName, splitQuotedMail, photoSrc } from '../utils.js';
/* 화면 상태는 ../features/conference/speaker-drawer-ui.js의 spDrUi 한곳에 둔다 — 이 탭의 구획을 다른 파일로 떼어도 같은 값을 보게 */
import { spDrUi } from '../features/conference/speaker-drawer-ui.js';
/* 보낸 기록 본문 — 이전 메일(인용)은 접어 둔다(utils.js splitQuotedMail) */
export const mailBodyHtml = (body) => {
  const m = splitQuotedMail(body);
  if(!m.head && !m.quoted) return escapeHtml(m.attach || '(본문 없음)');
  return `${escapeHtml(m.head || '(새로 쓴 내용 없음)')}${m.attach ? `\n\n${escapeHtml(m.attach)}` : ''}${m.quoted
    ? `<details style="margin-top:8px"><summary style="cursor:pointer;color:var(--i4);font-size:var(--fs-10_5)">▸ 이전 메일 보기 (${m.quoted.split('\n').length}줄)</summary><div style="margin-top:6px;padding-left:8px;border-left:2px solid var(--i6);color:var(--i3)">${escapeHtml(m.quoted)}</div></details>` : ''}`;
};
import { saveSpeaker, saveSessionSpeaker, saveSpeakerContact, deleteSpeakerContact, saveSpeakerLog } from '../api/conf-save.js';
import { sendMail, eventMailFrom, loadMailFiles, mailFilesOf, fileToBase64 } from '../api/mail-send.js';
import { loadSpeakerPhotos, speakerPhotosLoaded, speakerPhotoOf, saveSpeakerPhoto, deleteSpeakerPhoto, shrinkImage } from '../api/photos.js';
import { aiSpeakerAdvice } from '../api/ai.js';
import { adviceHtml as adviceFrame } from '../shared/advice-panel.js';
import { filterMail, mailFilBar, mailStateHtml, mailActionsHtml, mailToggleAttr, isPending, setMailDone } from '../shared/mail/mail-mark.js';
import { decorate as decorateMailPane } from '../shared/mail/mail-pane.js';
import { trackAction, changed, removed } from '../core/audit-log.js';
import { patchContact } from './db-tab.js';
import { syncPartRole } from '../features/conference/conf-common.js';
/* 컨퍼런스 탭은 window로 다시 그린다 — 연사 창이 탭 화면 파일을 끌어오지 않게(417줄과 같은 방식) */
const renderConf = () => window.renderConf?.();
const buildConfEvList = () => window.buildConfEvList?.();
import { spCell } from '../features/conference/speaker-cells.js';
import { confLocked, setConfLockEv, confLockNotice } from '../features/conference/conf-common.js';
import { followPill, snoozeFollow, addDays, resolveDue } from '../shared/mail/follow-up.js';
import { flowStatus, draftFor, missingItems, pendingItems, PART_LABEL, changeLines, stepVariants, autoVariant, fillTemplate } from './speaker-flow.js';
import { libItems, libItem } from '../shared/mail/mail-templates.js';
import { reuseCandidates, reusePending } from './contact-speaker.js';
import { varChipsHtml, registerVarResolver } from '../shared/mail/var-chips.js';
import { aiDraftHtml, registerAiDraft } from '../shared/mail/ai-mail-draft.js';

/* 메일 «값 넣기» 칩 — 드로어 메일은 글 그대로 나가므로 칸 대신 이 연사의 실제 값을 넣는다.
   마감일 따위는 지금 고른 «무슨 메일인가» 단계를 따른다 */
registerVarResolver('sp-drawer', (key) => {
  const sp = getSpeakerById(spDrUi.spId);
  if(!sp) return '';
  const kind = document.getElementById('sp-mail-kind')?.value || '';
  const step = flowStatus(sp).steps.find(s => s.key === kind) || {};
  return fillTemplate(`{${key}}`, sp, step);
});
/* «✨ AI로 초안 쓰기» — 이름·소속·메일 주소는 보내지 않고 상태만. 돌아온 틀에 이 연사의 값을 채운다 */
registerAiDraft('sp', () => {
  const sp = getSpeakerById(spDrUi.spId);
  if(!sp) return null;
  const kind = document.getElementById('sp-mail-kind')?.value || '';
  const lib = String(kind).startsWith('lib:') ? libItem(String(kind).slice(4)) : null;
  const step = lib ? { label: lib.name, subject_ko: lib.subject_ko, body_ko: lib.body_ko, subject_en: lib.subject_en, body_en: lib.body_en }
    : flowStatus(sp).steps.find(x => x.key === kind) || { label: (MAIL_KINDS.find(k => k.key === kind) || {}).label || '' };
  const en = sp.lang_pref === 'en';
  const pend = pendingItems(sp).filter(x => x.when !== 'ours');
  const state = [
    `역할: ${rolesOfSpeaker(sp.id).join(', ') || '미배정'} · ${isDomesticSpeaker(sp) ? '국내' : '해외'} 연사 · 섭외 ${sp.status || '-'}`,
    pend.length ? `아직 안 받은 자료: ${pend.map(x => `${x.label}${x.due ? `(${x.due}까지)` : ''}`).join(', ')}` : '받을 자료는 다 받음',
    sp.fee_amount && paysFee(sp) ? `연사료 ${sp.fee_paid_at ? '지급함' : '아직 미지급'}` : '',
    step.due ? `이 단계 마감일 있음({마감일})` : '',
    assignmentsFor(sp.id).length ? '발표 세션 배정됨({세션}·{발표시간} 사용 가능)' : '',
  ].filter(Boolean);
  return { part: 'conf', ev: sp.event_id, lang: en ? 'en' : 'ko', reply: !!spDrUi.spReply, step: spDrUi.spReply ? {} : step,
    stepLabel: step.label, state,
    apply(tpl){
      const s = document.getElementById('sp-mail-subject'), b = document.getElementById('sp-mail-body');
      const subj = fillTemplate(en ? tpl.subject_en : tpl.subject_ko, sp, step);
      const body = fillTemplate(en ? tpl.body_en : tpl.body_ko, sp, step);
      if(spDrUi.spReply){
        // 회신은 «Re: 원래 제목»을 그대로 두고, 처음 회신 초안(인용된 원래 메일) 위에 새 글을 얹는다.
        // 다시 눌러도 겹쳐 쌓이지 않게 늘 처음 초안에서 시작한다
        spDrUi.spReply.curBody = `${body}\n\n${String(spDrUi.spReply.body || '').replace(/^\s+/, '')}`;
        if(b) b.value = spDrUi.spReply.curBody;
        return;
      }
      if(s && subj) s.value = subj;
      if(b && body.trim()) b.value = body;
    } };
});

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

export const STATUSES = ['섭외중', '확정', '보류', '취소'];

/* ── 여닫기 ── */
export function openSpeakerDr(id, tab){
  /* 다른 연사로 옮기면 계좌를 다시 가린다 — 한 번 연 게 다음 사람까지
     따라오면 열람 기록과 실제로 본 것이 어긋난다. */
  if(spDrUi.spId !== id){
    spDrUi.spReply = null;
    spDrUi.spTravelForce = false;
    spDrUi.bankRevealed = false;
    /* PC에서 고른 첨부는 그 사람 몫이다 — 다음 연사 메일로 따라가면 여권·계좌
       서류가 엉뚱한 사람에게 나간다 */
    spDrUi.spLocalFiles = []; spDrUi.spSkipDefault = new Set();
    spDrUi.spWithCo = true;
  }
  spDrUi.spId = id;
  setConfLockEv(getSpeakerById(id)?.event_id);
  if(tab && TABS.some(t => t.key === tab)) spDrUi.spTab = tab;
  document.getElementById('sp-dr')?.classList.add('on');
  document.getElementById('sp-bd')?.classList.add('on');
  renderSpeakerDr();
}
export function closeSpeakerDr(){
  spDrUi.spId = null;
  spDrUi.spReply = null;
  setConfLockEv(null);
  spDrUi.spLocalFiles = []; spDrUi.spSkipDefault = new Set();
  spDrUi.bankRevealed = false;
  document.getElementById('sp-dr')?.classList.remove('on');
  document.getElementById('sp-bd')?.classList.remove('on');
}
export function switchSpeakerDT(v){ spDrUi.spTab = v; renderSpeakerDr(); }

/* ── 저장 ──
   화면을 먼저 바꾸고 실패하면 되돌린다. 저장이 안 됐는데 화면만 바뀌면
   받은 줄 알고 다시 묻지 않게 된다. */
export async function patchSpeaker(patch, label, id = spDrUi.spId){
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
export function eunNeun(word){
  const ch = String(word || '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if(!(code >= 0xAC00 && code <= 0xD7A3)) return '는';   // 한글이 아니면 «는»
  return (code - 0xAC00) % 28 === 0 ? '는' : '은';
}

export const speakerLabel = () => {
  const sp = getSpeakerById(spDrUi.spId);
  return sp ? (sp.name_snapshot || sp.name_en || sp.id) : '';
};

/* 인라인 핸들러가 부르는 얇은 껍데기 — 값이 그대로면 저장하지 않는다
   (포커스가 빠질 때마다 같은 값을 보내면 기록이 변경 이력으로 더러워진다) */
export function spField(field, value, label){
  const sp = getSpeakerById(spDrUi.spId);
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
  const sp = getSpeakerById(spDrUi.spId);
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
  if(!spDrUi.spId) return;
  const sp = getSpeakerById(spDrUi.spId);
  if(!sp){ closeSpeakerDr(); return; }
  const evKey = sp.event_id;
  const roles = rolesOfSpeaker(sp.id);
  const con = sp.contact_id ? contacts.find(c => String(c.id) === String(sp.contact_id)) : null;

  /* 사진은 행사 단위로 처음 한 번 받아 온다 — 받으면 다시 그린다 */
  if(!speakerPhotosLoaded(evKey)) loadSpeakerPhotos(evKey).then(() => { if(spDrUi.spId === sp.id) renderSpeakerDr(); });
  const photo = speakerPhotoOf(evKey, sp.id);

  const h = document.getElementById('sp-drh');
  if(h) h.innerHTML = `${photo ? `<img src="${photoSrc(photo)}" alt="" onclick="switchSpeakerDT('basic')"
      title="연사 사진 — 기본 탭에서 바꿉니다"
      style="width:44px;height:44px;border-radius:50%;object-fit:cover;object-position:50% 25%;flex:none;margin-right:10px;align-self:center;cursor:pointer;border:1px solid var(--i6)">` : ''}
    <div style="flex:1;min-width:0">
      <div class="drnm">${escapeHtml(sp.name_snapshot || sp.name_en || '(이름 없음)')}${
        sp.name_snapshot && sp.name_en
          ? `<span style="font-size:var(--fs-12);font-weight:400;color:var(--i4);margin-left:6px">${escapeHtml(sp.name_en)}</span>` : ''}
        ${roles.map(r => `<span class="pill ${(SPEAKER_ROLES.find(x => x.key === r) || {}).cls || 'p-gray'}"
          style="vertical-align:middle;font-size:var(--fs-10)">${escapeHtml(r)}</span>`).join(' ')}</div>
      <div class="drmt">${escapeHtml(sp.status || '섭외중')}${
        window.payCountry(sp) ? ` · ${escapeHtml(countryName(window.payCountry(sp)))}${
          (sp.nationality && sp.residence_country && sp.nationality !== sp.residence_country)
            ? ` <span style="color:var(--am)">(국적 ${escapeHtml(countryName(sp.nationality))})</span>` : ''}` : ''}${
        (sp.org_ko || sp.org_en || sp.title_ko || sp.title_en)
          ? ` · ${escapeHtml([sp.org_ko || sp.org_en, sp.title_ko || sp.title_en].filter(Boolean).join(' '))}`
          : ' · 소속·직함 없음'}${
        con ? '' : ' · 연락처 연결 안 됨'}${
        assignmentsFor(sp.id).length ? ` · 세션 ${assignmentsFor(sp.id).length}` : ''}</div>
    </div>
    <button class="btn" style="font-size:var(--fs-10_5);color:var(--i3);align-self:center"
      onclick="setSpeakerHidden('${escAttr(sp.id)}',${sp.hidden !== 'yes'})"
      title="${sp.hidden === 'yes' ? '다시 목록에 보이고 받을 항목도 셉니다' : '목록에서 접고 받을 항목에서 뺍니다 — 지우지는 않아요'}">${sp.hidden === 'yes' ? '다시 보이기' : '숨기기'}</button>
    <button class="btn" style="font-size:var(--fs-10_5);color:var(--re);align-self:center"
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
    people: window.mailTargets(sp.id).to.length ? 0 : 1,
    box: logsOfSpeaker(sp.id).filter(isPending).length,    // 처리 안 한 받은 메일
    mail: 0,
    offer: nowN('offer'),
    bank: nowN('bank'),
  };
  /* 설정에서 받지 않기로 한 것만 있는 탭은 접는다 — 적어 둔 값이 있으면 보인다 */
  const shownTabs = TABS.filter(t => tabShown(sp, evKey, t.key));
  if(!shownTabs.some(t => t.key === spDrUi.spTab)) spDrUi.spTab = 'basic';
  const tabsEl = document.getElementById('sp-drtabs');
  if(tabsEl) tabsEl.innerHTML = shownTabs.map(t =>
    `<button class="drtab${spDrUi.spTab === t.key ? ' on' : ''}" onclick="switchSpeakerDT('${t.key}')">${t.label}${
      left[t.key] ? ` <span class="pill p-amber">${left[t.key]}</span>`
      : dotOf(t.key) ? ` <span title="나중 일·우리가 할 일이 있어요" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--i5);vertical-align:middle"></span>` : ''}</button>`).join('');

  const b = document.getElementById('sp-drbd');
  if(b){
    b.classList.toggle('ro', confLocked());
    b.innerHTML = flowBoxHtml(sp) + reuseBoxHtml(sp) + (spDrUi.spTab === 'bio' ? window.bioHtml(sp, evKey)
      : spDrUi.spTab === 'talk' ? window.talkHtml(sp, evKey)
      : spDrUi.spTab === 'offer' ? offerHtml(sp, evKey)
      : spDrUi.spTab === 'bank' ? window.bankHtml(sp, evKey)
      : spDrUi.spTab === 'people' ? window.peopleTabHtml(sp)
      : spDrUi.spTab === 'box' ? window.boxTabHtml(sp)
      : spDrUi.spTab === 'mail' ? window.mailTabHtml(sp, evKey)
      : window.basicHtml(sp, con, evKey));
    /* 초안 만들기로 넘어왔으면 메일 칸을 채운다 — 칸은 위에서 막 그려졌다 */
    if(spDrUi.spTab === 'mail' && spDrUi.spReply){ window.fillSpeakerReply(); }
    else if(spDrUi.spTab === 'mail' && spDrUi.pendingDraft){ window.fillSpeakerMail(spDrUi.pendingDraft); spDrUi.pendingDraft = ''; }
    else if(spDrUi.spTab === 'mail'){
      const k = document.getElementById('sp-mail-kind')?.value;
      if(k && !document.getElementById('sp-mail-body')?.value) window.fillSpeakerMail(k);
    }
    /* 기본 첨부 목록은 서버에서 받아야 해서 늦게 온다 — 오면 첨부 칸만 다시 그린다 */
    if(spDrUi.spTab === 'mail') loadMailFiles(evKey).then(() => window.renderSpMailFiles());
    if(spDrUi.spTab === 'mail') eventMailFrom(evKey).then(f => {
      const el = document.getElementById('sp-mail-from');
      if(el) el.innerHTML = f.ok ? `발신 <b>${escapeHtml(f.text)}</b>` : `<b style="color:var(--re)">발신 ${escapeHtml(f.text)}</b>`;
    });
  }
  // 메일함 나란히·고정 띠(mail-pane.js)
  decorateMailPane('sp');
}
// mail-pane.js가 왼쪽 칸에 이 연사 메일함을 그릴 때 쓴다
window.__spDrId = () => spDrUi.spId;
window.__spBoxHtml = (id) => { const s = getSpeakerById(id); return s ? window.boxTabHtml(s) : ''; };

/* ── 연락 단계 ──
   연사 화면 맨 위. 지금 어느 단계인지, 다음에 무엇을 하면 되는지, 그 메일 초안.
   단계와 끝난 기준은 speaker-flow.js, 행사별 문구는 설정 › 행사 › 컨퍼런스. */
/* ── 지난 자료 ──
   같은 사람을 지난 행사에서도 불렀으면 그때 받은 약력·사진·CV를 가져온다.
   가져온 뒤에는 «확인 대기» — 연사가 맞다고 하면 «확인됨»으로 받은 날을 찍는다.
   규칙은 contact-speaker.js에 있다. */
function reuseBoxHtml(sp){
  const pend = reusePending(sp);
  if(pend.length){
    return `<div style="padding:8px 11px;border:1px solid var(--am);border-radius:var(--r);margin-bottom:12px;background:var(--ab)">
      <div style="font-size:var(--fs-11_5);font-weight:700;color:var(--am)">지난 자료 확인 대기 · ${escapeHtml(pend.map(g => g.label).join(' · '))}</div>
      <div style="font-size:var(--fs-10_5);color:var(--i3);margin-top:2px;line-height:1.6">${escapeHtml(sp.reuse_from || '')}에서 ${escapeHtml(sp.reused_at)}에 가져왔어요.
        자료 받기 메일이 «확인 요청»으로 나갑니다. 연사가 맞다고 하면 확인됨을 누르세요 — 고친 자료가 오면 칸을 고친 뒤 누릅니다.</div>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn bp" style="font-size:var(--fs-10_5)" onclick="confirmSpReuse()">확인됨 — 받은 날 찍기</button>
      </div></div>`;
  }
  const c = reuseCandidates(sp);
  if(!c) return '';
  return `<div style="padding:8px 11px;border:1px dashed var(--a);border-radius:var(--r);margin-bottom:12px">
    <div style="font-size:var(--fs-11_5);font-weight:700;color:var(--i2)">지난 행사에서 받은 자료가 있어요 · ${escapeHtml(c.groups.map(g => g.label).join(' · '))}</div>
    <div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:2px;line-height:1.6">${escapeHtml(c.from.join(', '))}에서 가장 최근 것을 비어 있는 칸에만 넣습니다.
      새로 작성을 부탁하는 대신 «맞는지 확인» 메일을 보내게 돼요.</div>
    <div style="display:flex;gap:6px;margin-top:6px">
      <button class="btn bp" style="font-size:var(--fs-10_5)" onclick="applySpReuse()">지난 자료 가져오기</button>
    </div></div>`;
}
export async function applySpReuse(){
  const sp = getSpeakerById(spDrUi.spId);
  const c = reuseCandidates(sp);
  if(!c) return;
  await patchSpeaker({ ...c.patch, reuse_from: c.from.join(','), reused_at: td() },
    `지난 자료 가져오기 (${c.from.join(', ')} · ${c.groups.map(g => g.label).join('·')})`);
}
export async function confirmSpReuse(){
  const sp = getSpeakerById(spDrUi.spId);
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
      style="display:inline-flex;gap:3px;align-items:center;margin:1px 8px 1px 0;color:var(--i2);text-decoration:none;font-size:var(--fs-11)">
      ${escapeHtml(x.label)}${x.more ? `<span style="color:var(--i4)">(${escapeHtml(x.more)})</span>` : ''}
      <span style="font-size:var(--fs-9_5);color:var(--i5)">[${PART_LABEL[x.tab] || ''}]</span></a>`;
  return `<div style="margin-top:6px;display:grid;grid-template-columns:auto 1fr;gap:3px 8px;align-items:baseline">
    ${G.map(([k, l, c]) => { const xs = pend.filter(x => x.when === k); if(!xs.length) return '';
      const due = xs.find(x => x.due)?.due || '';
      return `<span style="font-size:var(--fs-10_5);font-weight:700;color:${c};white-space:nowrap">${l}</span>
        <div>${xs.map(item).join('')}${due && k !== 'nice' ? `<span style="font-size:var(--fs-10);color:var(--i4)">— 마감 ${escapeHtml(due)}</span>` : ''}</div>`; }).join('')}
  </div>`;
}

/* 연락 단계 상자는 탭마다 맨 위에 붙는다 — 다 펼쳐 두면 설명·남은 일·질문 칸이
   자료 칸을 밀어내 정작 데이터가 보이는 자리가 좁아진다. 평소엔 «지금 할 일» 한 줄만,
   «자세히»를 누르면 단계 칩·설명·남은 일·상황 물어보기를 편다(드로어를 닫아도 기억한다) */
export async function spSnooze(days){
  const sp = getSpeakerById(spDrUi.spId);
  const f = sp && flowStatus(sp);
  if(!f || !f.current) return;
  const until = addDays(td().slice(0, 10), days);
  const why = prompt(`리마인더를 ${until}까지 미룹니다. 이유를 적어 두면 기록에 남아요 (비워도 돼요).`, '');
  if(why === null) return;
  if(!await snoozeFollow('sp', sp.id, f.current.key, until, why)){ alert('기록에 남기지 못했어요. 잠시 뒤 다시 해주세요.'); return; }
  renderSpeakerDr(); window.renderConf?.();
}
export function toggleSpFlow(){ spDrUi.spFlowOpen = !spDrUi.spFlowOpen; renderSpeakerDr(); }
function flowBoxHtml(sp){
  const f = flowStatus(sp);
  if(f.skip) return `<div style="padding:8px 11px;border:1px solid var(--i6);border-radius:var(--r);margin-bottom:12px;
    background:var(--i8);font-size:var(--fs-11);color:var(--i4)">${f.cancelled
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
    const undo = s.applies && s.isDone && !s.resend && s.done.startsWith('field:');
    return `<span title="${escapeHtml(`${s.label} — ${st.t}${undo ? ' · 눌러서 되돌리기' : ''}`)}"${
      undo ? ` onclick="undoSpStep('${escAttr(s.key)}')"` : ''} style="${undo ? 'cursor:pointer;' : ''}display:inline-flex;align-items:center;gap:3px;
      font-size:var(--fs-10);padding:2px 7px;border-radius:var(--rd-10);background:${st.bg};color:${st.c};
      ${cur ? 'font-weight:700;' : ''}${s.applies ? '' : 'text-decoration:line-through;'}white-space:nowrap">${st.m} ${escapeHtml(s.label)}</span>`;
  };
  const cur = f.current;
  const left = cur && cur.key === 'collect' ? missingItems(sp) : [];
  /* 바로 앞에서 끝난, 날짜로 끝나는 단계 — 잘못 넘어갔을 때 한 번에 돌아간다 */
  const curIdx = cur ? f.steps.indexOf(cur) : f.steps.length;
  const prevUndo = f.steps.slice(0, curIdx).reverse()
    .find(x => x.applies && x.isDone && !x.resend && x.done.startsWith('field:')) || null;
  /* 사람이 받아서 적는 단계 — 메일을 보낸다고 끝나지 않는다 */
  const markBtn = cur && !cur.resend && cur.done.startsWith('field:') && cur.key !== 'invite'
    ? `<button class="btn" style="font-size:var(--fs-10_5)" onclick="spStamp('${cur.done.slice(6)}','${escAttr(cur.label)}')">${
        cur.key === 'reply' ? '회신 받음 표시' : cur.key === 'confirm' ? '참가 확정 표시' : '끝남 표시'}</button>` : '';
  /* 요청하고 기다리는 중이면 공은 연사에게 있다 — 날이 차면 리마인더가 우리 일로 돌아온다(follow-up.js).
     사정을 들었으면 «+3일 / +1주»로 미룬다 — 미룬 이유는 이 연사 기록에 남는다 */
  const waiting = !!f.follow && f.follow.state !== 'nudge';
  const stepTitle = !cur ? '' : waiting ? `${cur.label} 기다림` : f.remind ? (cur.key === 'collect' ? '자료 독촉' : `${cur.label} 리마인더`) : cur.label;
  const snoozeBtns = f.follow ? ` <button class="btn" style="font-size:var(--fs-10);padding:1px 6px" title="리마인더를 3일 뒤로 미룹니다" onclick="spSnooze(3)">+3일</button><button class="btn" style="font-size:var(--fs-10);padding:1px 6px" title="리마인더를 1주 뒤로 미룹니다" onclick="spSnooze(7)">+1주</button>` : '';
  const toggle = `<button class="btn" style="font-size:var(--fs-10);padding:1px 7px;margin-left:auto" onclick="toggleSpFlow()"
    title="${spDrUi.spFlowOpen ? '단계 칩·설명·남은 일을 접고 한 줄로' : '단계 칩·설명·남은 일·상황 물어보기 펼치기'}">${spDrUi.spFlowOpen ? '접기 ▴' : '자세히 ▾'}</button>`;
  if(!spDrUi.spFlowOpen){
    const nowLeft = pendingItems(sp).filter(x => x.when === 'now').length;
    return `<div style="padding:6px 11px;border:1px solid var(--a);border-radius:var(--r);margin-bottom:10px;background:var(--W);
      display:flex;align-items:center;gap:7px;flex-wrap:wrap">
      <span style="font-size:var(--fs-11);font-weight:700;color:var(--i2)">연락 단계</span>
      <span style="font-size:var(--fs-10_5);color:var(--i4)">${f.nDone}/${f.nAll}</span>
      ${cur ? `<span style="font-size:var(--fs-11_5);font-weight:700;color:${waiting ? 'var(--i4)' : f.remind ? 'var(--am)' : 'var(--a)'};min-width:0">${
          waiting ? '⏳' : f.remind ? '🔔' : '●'} ${escapeHtml(stepTitle)}${
          cur.due && !f.follow ? ` <span style="font-weight:400;color:${cur.due < td() ? 'var(--re)' : 'var(--i4)'};font-size:var(--fs-10_5)">마감 ${escapeHtml(cur.due)}</span>` : ''}</span>
        ${followPill(f.follow)}${snoozeBtns}
        ${nowLeft ? `<span class="pill p-amber" style="font-size:var(--fs-10)" title="지금 받을 필수 자료">받을 것 ${nowLeft}</span>` : ''}
        ${waiting ? '' : `<button class="btn bp" style="font-size:var(--fs-10);padding:1px 8px" onclick="openFlowDraft('${cur.key}')">✉ ${f.remind ? '리마인더 초안' : '초안'}</button>`}`
      : `<span style="font-size:var(--fs-11);color:var(--g)">모두 마쳤어요</span>`}
      ${toggle}
    </div>`;
  }
  return `<div style="padding:9px 11px;border:1px solid var(--a);border-radius:var(--r);margin-bottom:12px;background:var(--W)">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <span style="font-size:var(--fs-11);font-weight:700;color:var(--i2)">연락 단계</span>
      <span style="font-size:var(--fs-10_5);color:var(--i4)">${f.nDone}/${f.nAll}</span>
      ${toggle}
      <button class="btn" style="font-size:var(--fs-10);padding:1px 7px" title="이 행사의 연락 단계를 더하고, 고치고, 끄거나 지웁니다"
        onclick="openFlowEditor('${escAttr(sp.event_id)}')">✎ 단계 편집</button>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">${f.steps.filter(s => s.applies || (s.done !== 'sched' && !isFlowV2(sp.event_id))).map(chip).join('')}</div>
    ${cur ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--i7)">
        <div style="font-size:var(--fs-12);font-weight:700;color:${waiting ? 'var(--i4)' : 'var(--a)'}">${waiting ? '기다리는 중' : '지금 할 일'} · ${escapeHtml(cur.resend ? `${cur.label} (다시 보내기 · ${cur.round.label || ''})` : stepTitle)}${
          f.follow ? ` ${followPill(f.follow)}${snoozeBtns}` : ''}${
          cur.due ? ` <span style="font-weight:400;color:${cur.due < td() ? 'var(--re)' : 'var(--i4)'};font-size:var(--fs-10_5)">마감 ${escapeHtml(cur.due)}</span>` : ''}</div>
        <div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:2px;line-height:1.6">${escapeHtml(cur.desc || '')}</div>
        ${cur.done === 'sched' ? `<div style="margin-top:5px;padding:6px 9px;background:var(--i8);border-radius:var(--rd-6);font-size:var(--fs-11);color:var(--i2);white-space:pre-wrap;line-height:1.6">${
          escapeHtml(changeLines(sp, false).join('\n'))}</div>` : ''}
        ${pendingHtml(sp)}
        <div style="display:flex;gap:6px;margin-top:7px;flex-wrap:wrap">
          <button class="btn bp" style="font-size:var(--fs-10_5)" onclick="openFlowDraft('${cur.key}')">✉ 메일 초안 만들기</button>
          <button class="btn" style="font-size:var(--fs-10_5)" title="이 단계가 보낼 차례인 연사들에게 한 번에 보냅니다"
            onclick="openSpeakerBulkMail('${escAttr(sp.event_id)}','${cur.key}')">📨 여러 연사에게</button>
          ${markBtn}
          ${prevUndo ? `<button class="btn" style="font-size:var(--fs-10_5)" onclick="undoSpStep('${escAttr(prevUndo.key)}')"
            title="«${escAttr(prevUndo.label)}»을 안 한 것으로 되돌립니다">↶ 이전 단계로</button>` : ''}
        </div></div>`
      : `<div style="font-size:var(--fs-11);color:var(--g);margin-top:7px">이 행사의 연락 단계를 모두 마쳤어요.${
          prevUndo ? ` <button class="btn" style="font-size:var(--fs-10_5);margin-left:6px" onclick="undoSpStep('${escAttr(prevUndo.key)}')">↶ 이전 단계로</button>` : ''}</div>`}
    ${adviceHtml(sp)}
  </div>`;
}

/* ── ✨ 상황 물어보기 ──
   «발표자료 파일이 깨져서 다시 받아야 해»처럼 적으면 이 CRM에서 무엇을 어떤 순서로
   하면 되는지 답한다(backend-node/routes/ai.js /speaker-advice). 답의 줄마다 그 일을
   하는 단추(메일 초안·이전 단계로·탭 이동·단계 편집)를 붙인다.
   보내는 것은 질문과 이 연사의 «상태»뿐이다 — 단계·남은 일 이름, 기록의 날짜·방향·단계.
   이름·메일 주소·메일 제목·본문은 보내지 않는다(제목에 이름이 들어간다).
   드로어는 칸 하나만 바뀌어도 통째로 다시 그려지므로 질문·답은 여기 붙들어 둔다. */
function adviceHtml(sp){
  return adviceFrame({   // 틀은 shared/advice-panel.js
    a: spDrUi.spAdvice && spDrUi.spAdvice.spId === sp.id ? spDrUi.spAdvice : null,
    wrapStyle: 'margin-top:8px;padding:7px 10px;border:1px solid var(--i6);border-radius:var(--r);background:var(--W)',   // 참가사 상세 창과 같은 테두리 상자
    inputId: 'sp-advice-q',
    placeholder: '✨ 상황 물어보기 — 예: 발표자료 파일이 깨져서 다시 받아야 해',
    inputTitle: '질문과 이 연사의 진행 상태만 AI에게 보냅니다. 이름·메일 내용은 보내지 않아요',
    ask: 'askSpAdvice', act: 'spAdviceAct', save: 'saveSpAdvice', clear: 'clearSpAdvice',
    labels: { mail: '✉ 메일 초안', bulk: '📨 여러 연사에게', undo: '↶ 되돌리기', tab: '→ 탭 열기', editflow: '✎ 단계 편집' },
    savedText: '✓ 연사 기록에 남겼어요',
    saveTitle: '질문과 답을 이 연사의 메일함 기록에 메모로 남겨 다른 담당자도 보게 합니다',
  });
}
export async function askSpAdvice(){
  const sp = getSpeakerById(spDrUi.spId);
  const q = String(document.getElementById('sp-advice-q')?.value || '').trim();
  if(!sp || !q) return;
  spDrUi.spAdvice = { spId: sp.id, q, loading: true };
  renderSpeakerDr();
  const f = flowStatus(sp);
  const label = (k) => (f.steps.find(s => s.key === k) || {}).label || '';
  const r = await aiSpeakerAdvice({
    question: q,
    today: td(),
    lang: sp.lang_pref || '',
    roles: rolesOfSpeaker(sp.id),
    status: sp.status || '',
    steps: f.steps.map(s => ({ key: s.key, label: s.label, applies: s.applies, done: s.isDone,
      current: !!(f.current && f.current.key === s.key), resend: !!s.resend, since: s.since || '', due: s.due || '',
      undoable: s.applies && s.isDone && !s.resend && String(s.done || '').startsWith('field:') })),
    remind: !!f.remind,
    pending: pendingItems(sp).map(x => ({ label: x.label, when: x.when, due: x.due || '' })),
    // 기록은 날짜·방향·단계만 — 제목·본문·상대 주소는 보내지 않는다
    logs: logsOfSpeaker(sp.id).filter(l => l.kind !== 'view')
      .slice().sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || ''))).slice(0, 15)
      .map(l => ({ date: String(l.ts || '').slice(0, 10), dir: l.direction === 'in' ? '받음' : l.direction === 'out' ? '보냄' : '',
        step: label(l.kind), channel: l.channel || '' })),
  });
  if(!spDrUi.spAdvice || spDrUi.spAdvice.spId !== sp.id) return;
  spDrUi.spAdvice = r.ok ? { spId: sp.id, q, ans: { summary: r.summary, todo: r.todo || [], caution: r.caution || '' } }
    : { spId: sp.id, q, err: '답을 받지 못했어요: ' + (r.error || '') };
  renderSpeakerDr();
}
export function spAdviceAct(action, arg){
  const sp = getSpeakerById(spDrUi.spId);
  if(!sp) return;
  if(action === 'mail') openFlowDraft(arg);
  else if(action === 'bulk') window.openSpeakerBulkMail?.(sp.event_id, arg);
  else if(action === 'undo') undoSpStep(arg);
  else if(action === 'tab') switchSpeakerDT(arg);
  else if(action === 'editflow') window.openFlowEditor?.(sp.event_id);
}
export async function saveSpAdvice(){
  const sp = getSpeakerById(spDrUi.spId);
  const a = spDrUi.spAdvice;
  if(!sp || !a || !a.ans || a.spId !== sp.id) return;
  const body = [a.ans.summary, ...a.ans.todo.map((t, i) => `${i + 1}. ${t.text}`), a.ans.caution ? `주의: ${a.ans.caution}` : '']
    .filter(Boolean).join('\n');
  const row = {
    speaker_id: sp.id, kind: 'note', ts: nowStamp(), direction: '', channel: '메모', counterpart: '',
    category: '✨ 상황 상담', subject: a.q, body, answered_at: '', answer: '', status: 'done',
    author_email: currentUser?.email || '', author_name: currentUser?.name || '',
  };
  const res = await saveSpeakerLog(row);
  if(!res || (res.ok === false && !res.offline)){ alert('기록에 남기지 못했어요. 잠시 뒤 다시 해주세요.'); return; }
  SPEAKER_LOGS.push({ ...row, id: res.id || `SL-tmp-${Date.now()}` });
  spDrUi.spAdvice = { ...a, saved: true };
  renderSpeakerDr();
}
export function clearSpAdvice(){ spDrUi.spAdvice = null; renderSpeakerDr(); }
window.askSpAdvice = askSpAdvice;
window.spAdviceAct = spAdviceAct;
window.saveSpAdvice = saveSpAdvice;
window.clearSpAdvice = clearSpAdvice;
/* 단계 되돌리기 — 찍힌 날짜를 지운다. 보낸 메일 기록은 그대로 둔다
   (이미 나간 메일은 되돌릴 수 없고, 무엇을 보냈는지는 남아야 한다). */
export async function undoSpStep(stepKey){
  if(confLocked()){ confLockNotice(); return; }
  const sp = getSpeakerById(spDrUi.spId);
  if(!sp) return;
  const step = flowStatus(sp).steps.find(x => x.key === stepKey);
  if(!step || !step.done.startsWith('field:')) return;
  const field = step.done.slice(6);
  if(!confirm(`«${step.label}»을 안 한 것으로 되돌릴까요?\n\n찍힌 날짜 ${sp[field] || ''}를 지웁니다. 보낸 메일 기록은 그대로 남아요.`)) return;
  await patchSpeaker({ [field]: '' }, `${step.label} 되돌림`);
}
window.undoSpStep = undoSpStep;

export function openFlowDraft(stepKey){
  spDrUi.pendingDraft = stepKey;
  spDrUi.spTab = 'mail';
  renderSpeakerDr();
}

/* ── «받아야 함»인데 아직 없는 것 ──
   역할이 요구하지 않는 항목은 세지 않는다. 좌장에게 초록이 없는 건
   빠진 게 아니라 애초에 묻지 않은 것이다. */
export const needState = (evKey, roles, key) => {
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
const hasTravel = (sp) => !!(sp.stay_hotel || sp.stay_in || sp.stay_booked || sp.air_route || sp.air_ticketed_at
  || sp.air_in_flight || sp.air_out_flight);
const hasBankPass = (sp) => !!(sp.bank_account || sp.bank_holder || sp.bank_name || sp.bank_code || sp.bank_form_received_at
  || sp.id_card_received_at || sp.bankbook_received_at || sp.passport_received_at || sp.passport_file);
function tabShown(sp, evKey, key){
  const roles = rolesOfSpeaker(sp.id);
  if(key === 'bank') return !!(needState(evKey, roles, 'bank') || needState(evKey, roles, 'passport') || sp.fee_amount || hasBankPass(sp));
  return true;
}
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
  if(window.isDomestic(sp)) return out;   // 국내 연사는 여권을 묻지 않는다
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
export const fg = (label, inner, hint) => `<div class="fg"><label class="fl">${label}</label>${inner}${
  hint ? `<div style="font-size:var(--fs-10);color:var(--i4);margin-top:3px">${hint}</div>` : ''}</div>`;

export const txt = (val, handler, ph) => `<input class="fi" type="text" value="${escapeHtml(val || '')}"
  placeholder="${escapeHtml(ph || '')}" onchange="${handler}">`;

export const area = (val, handler, ph, rows) => `<textarea class="fi" rows="${rows || 4}"
  placeholder="${escapeHtml(ph || '')}" style="resize:vertical" onchange="${handler}">${escapeHtml(val || '')}</textarea>`;

export const dateIn = (val, handler) => `<input class="fi" type="date" value="${escapeHtml(val || '')}" onchange="${handler}">`;

/* 받았는지 — 체크는 오늘 날짜를 찍고, 날짜 칸은 손으로 고칠 수 있다 */
export const gotRow = (label, date, toggleH, dateH, need) => `<div style="display:flex;align-items:center;gap:9px;
    padding:7px 0;border-bottom:1px solid var(--i7)">
    <input type="checkbox" ${date ? 'checked' : ''} onchange="${toggleH}">
    <div style="flex:1;min-width:0">
      <div style="font-size:var(--fs-12)">${escapeHtml(label)}
        ${need ? `<span style="color:var(--i4);font-size:var(--fs-10)" title="${escapeHtml(NEED_LABEL[need] || '')}">${NEED_MARK[need] || ''}</span>` : ''}</div>
    </div>
    <input class="fi" type="date" style="width:132px" value="${escapeHtml(date || '')}" onchange="${dateH}">
  </div>`;

/* 글자수 — 한도는 행사마다 다르고, 넘어도 막지 않는다.
   해외 연사는 국문이 비는 게 정상이라 빈 칸을 «넘침»처럼 보이게 하지 않는다. */
export const countHint = (val, limit) => {
  const n = String(val || '').length;
  if(!limit) return n ? `${n}자` : '';
  const over = n > Number(limit);
  return `<span style="color:${over ? 'var(--am)' : 'var(--i4)'}">${n} / ${limit}자${over ? ' — 넘었어요' : ''}</span>`;
};

/* «연사 기본·이력·발제»은 ../features/conference/sp-dr-basic.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* 메일 종류 — 머리 구획(보낸 단계 이름)도 쓰므로 이 파일에 둔다. 메일 칸은 ../features/conference/sp-dr-mail.js */
export const MAIL_KINDS = [
  { key: 'invite',   label: '초청' },
  { key: 'bulkreq',  label: '안 받은 자료 한 번에 요청' },
  { key: 'profile',  label: '이력·사진 요청' },
  { key: 'abstract', label: '발제명·초록 요청' },
  { key: 'slides',   label: '발표자료 요청' },
  { key: 'travel',   label: '숙박·항공 안내' },
  { key: 'note',     label: '기타' },
];

/* «연사 연락 상대·메일·기록»은 ../features/conference/sp-dr-mail.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
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

export function spTravelShow(){ spDrUi.spTravelForce = true; renderSpeakerDr(); }
function offerHtml(sp, evKey){
  const roles = rolesOfSpeaker(sp.id);
  const nTravel = needState(evKey, roles, 'travel');
  const feeNeed = needState(evKey, roles, 'bank');

  const sel = (val, opts, handler, blank) => `<select class="fi" onchange="${handler}">
    ${blank ? `<option value=""${!val ? ' selected' : ''}>${blank}</option>` : ''}
    ${opts.map(o => `<option value="${escapeHtml(o)}"${val === o ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}
  </select>`;

  const fee = `<div style="border:1px solid var(--i6);border-radius:var(--rd-9);padding:11px 12px;margin-bottom:11px">
    <div style="display:flex;align-items:baseline;gap:7px;margin-bottom:8px">
      <div style="font-size:var(--fs-12);font-weight:700">연사료</div>
      ${sp.fee_amount ? `<div style="font-size:var(--fs-11);color:var(--i3)">${escapeHtml(money(sp.fee_amount, sp.fee_currency))}</div>` : ''}
      ${sp.fee_paid_at ? `<span class="pill p-green" style="font-size:var(--fs-10)">지급 ${escapeHtml(sp.fee_paid_at)}</span>`
        : sp.fee_amount ? `<span class="pill p-amber" style="font-size:var(--fs-10)">미지급</span>` : ''}
    </div>
    ${(sp.nationality && sp.residence_country && sp.nationality !== sp.residence_country) ? `
      <div class="fg"><label class="fl">지급 기준</label>
        <div class="seg" style="flex-wrap:wrap">
          ${[['residence', `거주지 (${escapeHtml(countryName(sp.residence_country))})`],
             ['nationality', `국적 (${escapeHtml(countryName(sp.nationality))})`]].map(([k, l]) =>
            `<button class="seg-b${(sp.pay_basis || 'residence') === k ? ' on' : ''}"
              onclick="spField('pay_basis','${k}','지급 기준')">${l}</button>`).join('')}
        </div>
        <div style="font-size:var(--fs-10);color:var(--i4);margin-top:3px">
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
          const pc = window.payCountry(sp);
          const overseas = pc && countryName(pc) !== '대한민국';
          if(overseas && /^국내/.test(sp.fee_tax_type || '')){
            return `<span style="color:var(--am)">기준이 ${escapeHtml(countryName(pc))}인데 국내 소득으로 잡혀 있어요 — 맞는지 확인해주세요</span>`;
          }
          return '세액은 계산하지 않습니다 — 어느 쪽인지만 적어 두세요';
        })())}
      ${fg('지급일', dateIn(sp.fee_paid_at, `spField('fee_paid_at',this.value,'연사료 지급일')`))}
    </div>
    ${feeNeed ? `<div style="font-size:var(--fs-10_5);color:${sp.bank_account ? 'var(--i4)' : 'var(--am)'};margin:-2px 0 8px">
      ${sp.bank_account ? '계좌는 «계좌·여권» 탭에 있어요' : '계좌를 아직 안 받았어요 — «계좌·여권» 탭에서 넣습니다'}</div>` : ''}
    ${fg('메모', area(sp.fee_note, `spField('fee_note',this.value,'연사료 메모')`, '지급 조건, 정산 담당 등', 2))}
  </div>`;

  const stay = `<div style="border:1px solid var(--i6);border-radius:var(--rd-9);padding:11px 12px;margin-bottom:11px">
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px">
      <div style="font-size:var(--fs-12);font-weight:700">숙박</div>
      <label style="display:flex;align-items:center;gap:5px;font-size:var(--fs-11);color:var(--i3);margin-left:auto">
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
      ? `<div style="font-size:var(--fs-10_5);color:var(--re);margin:-4px 0 8px">체크아웃이 체크인보다 빠르거나 같아요</div>` : ''}
    ${fg('메모', area(sp.stay_note, `spField('stay_note',this.value,'숙박 메모')`, '조식 포함 여부, 연박 등', 2))}
  </div>`;

  const air = `<div style="border:1px solid var(--i6);border-radius:var(--rd-9);padding:11px 12px;margin-bottom:11px">
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:8px">
      <div style="font-size:var(--fs-12);font-weight:700">항공</div>
      ${sp.air_ticketed_at ? `<span class="pill p-green" style="font-size:var(--fs-10)">발권 ${escapeHtml(sp.air_ticketed_at)}</span>` : ''}
    </div>
    <div class="fgr">
      ${fg('구간', txt(sp.air_route, `spField('air_route',this.value,'항공 구간')`, 'ICN–NRT'))}
      ${fg('좌석', sel(sp.air_class, AIR_CLASSES, `spField('air_class',this.value,'좌석 등급')`, '미정'))}
    </div>
    <div style="font-size:var(--fs-10_5);font-weight:700;color:var(--i3);margin:6px 0 3px">오는 편</div>
    <div class="fgr">
      ${fg('편명', txt(sp.air_in_flight, `spField('air_in_flight',this.value,'오는 편명')`, 'KE001'))}
      ${fg('일시', txt(sp.air_in_at, `spField('air_in_at',this.value,'오는 편 일시')`, '2026-06-01 14:30'))}
    </div>
    <div style="font-size:var(--fs-10_5);font-weight:700;color:var(--i3);margin:6px 0 3px">가는 편</div>
    <div class="fgr">
      ${fg('편명', txt(sp.air_out_flight, `spField('air_out_flight',this.value,'가는 편명')`, 'KE002'))}
      ${fg('일시', txt(sp.air_out_at, `spField('air_out_at',this.value,'가는 편 일시')`, '2026-06-03 09:10'))}
    </div>
    ${fg('발권일', dateIn(sp.air_ticketed_at, `spField('air_ticketed_at',this.value,'발권일')`))}
    ${fg('메모', area(sp.air_note, `spField('air_note',this.value,'항공 메모')`, '경유, 마일리지, 좌석 요청 등', 2))}
  </div>`;

  /* 설정에서 숙박·항공을 «제공 안 함»으로 정한 역할은 빈 입력 칸을 늘어놓지 않는다 —
     적어 둔 값이 있거나 «그래도 적기»를 누르면 편다 */
  if(!nTravel && !hasTravel(sp) && !spDrUi.spTravelForce) return fee + `<div style="padding:8px 11px;background:var(--i8);
    border:1px solid var(--i6);border-radius:var(--rd-7);font-size:var(--fs-11);color:var(--i4);display:flex;align-items:center;gap:8px">
    숙박·항공 제공 안 함 — 설정 › 행사 › 컨퍼런스에서 이 역할(${escapeHtml(roles.join(' · ') || '배정 없음')})은 챙기지 않기로 했어요.
    <button class="btn" style="font-size:var(--fs-10);padding:1px 7px;margin-left:auto;white-space:nowrap" onclick="spTravelShow()">그래도 적기</button></div>`;
  const hint = !nTravel ? `<div style="padding:9px 11px;background:var(--i8);border:1px solid var(--i6);
    border-radius:var(--rd-7);font-size:var(--fs-11_5);color:var(--i3);line-height:1.6;margin-bottom:11px">
    이 연사의 역할(${escapeHtml(roles.join(' · ') || '배정 없음')})은 숙박·항공을 챙기는 대상이 아니에요.
    적어 둔 값은 남겨 두지만 할 일·독촉에는 세지 않아요.</div>` : '';

  return hint + fee + stay + air;
}

/* «연사 계좌·여권»은 ../features/conference/sp-dr-bank.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */