/* ══════════════════════════════════════════════════════════════
   conf-tab.js — 연사 (컨퍼런스 탭)

   왜 프로그램부터인가
   ------------------
   연사에게 무엇을 받아야 하는지는 «그 사람이 무엇을 맡았는가»에서 나온다.
   좌장은 발제명·초록·발표자료를 내지 않고, 사회는 우리가 섭외하니 이력이
   없어도 된다. 그래서 세션을 만들고 사람을 배정해 역할을 정하는 일이
   먼저다 — 이것 없이 연사를 모으면 역할이 자유 텍스트가 되고 «받을 것»을
   셀 근거가 사라진다.

   화면은 두 갈래다.
     프로그램 — 일자별 세션, 세션마다 누가 무슨 역할로 들어가는지
     연사     — 사람을 주인공으로, 맡은 역할과 받을 것의 진행

   세션의 일자·시간대·트랙은 설정 › 행사 관리 › 컨퍼런스에서 정한 목록에서
   고른다. 여기서 새로 적게 하면 «10:00»과 «10시»가 섞인다.
═══════════════════════════════════════════════════════════════ */

import {
  EVENT_LIST,
  evPartState, evPartDone,
  confCfg, confDays,
  CONF_SESSIONS, SPEAKERS, SESSION_SPEAKERS,
  sessionsForEvent, speakersForEvent, assignmentsOfSession, assignmentsFor,
  getSpeakerById, rolesOfSpeaker, speakerNeedList, speakerNeed,
  contactsOfSpeaker, SPEAKER_CONTACTS, SPEAKER_LOGS,
  contacts, participations,
  isDomesticSpeaker, bankDocs, paysFee,
  leadOf, coOf, TALK_FIELDS, roleLabel,
} from '../state.js';
import { SPEAKER_ROLES, NEED_MARK, SPEAKER_NEEDS, SP_CONSENTS } from '../constants.js';
import { td, escapeHtml, escAttr, isMobile, leftPill, countryName, photoSrc } from '../utils.js';
import { progressBar, shortCell } from './exh-tab.js';
/* 화면 상태는 ../features/conference/conf-ui.js의 confUi 한곳에 둔다 — 이 탭의 구획을 다른 파일로 떼어도 같은 값을 보게 */
import { confUi } from '../features/conference/conf-ui.js';

/* 이 연사가 회사를 떠났는지 — 연사 행은 이름·소속을 «발표 당시»로 굳혀 두므로
   지금 연락이 닿는지는 마스터DB 연결(contact_id)을 타고 가야 알 수 있다.
   연사 쪽 값을 바꾸지는 않는다: 작년 프로그램북의 소속은 그대로여야 맞다. */
export const spLeftPill = (sp) => {
  const c = sp && sp.contact_id
    ? contacts.find(x => String(x.id) === String(sp.contact_id)) : null;
  return c ? leftPill(c) : '';
};


/* 표에서 바로 봐야 하는 것: 공유를 거절한 항목과 갈라디너 참석 여부 */
export const spFlagPills = (sp) => {
  const no = consentRefused(sp);
  return (no.length ? `<span class="pill p-red" style="font-size:9px"
      title="${escapeHtml(`동의하지 않음: ${no.join(', ')} — 자료집·배포에서 빼야 해요`)}">공유 ✕ ${escapeHtml(no.join('·'))}</span>` : '')
    + (sp.gala_rsvp === 'yes' ? '<span class="pill p-green" style="font-size:9px" title="갈라디너 참석">갈라 참석</span>'
      : sp.gala_rsvp === 'no' ? '<span class="pill p-gray" style="font-size:9px" title="갈라디너 불참">갈라 불참</span>' : '');
};
import {
  saveConfSession, deleteConfSession,
  saveSpeaker, deleteSpeaker,
  saveSessionSpeaker, deleteSessionSpeaker,
  saveSpeakerContact, deleteSpeakerContact, deleteSpeakerLog,
  postToSheet,
  loadSpeakerPhotos, speakerPhotosLoaded, speakerPhotoOf,
} from '../api.js';
import { trackAction, changed, removed, created } from '../core/audit-log.js';
import { IMPORT_SHEETS, IMPORT_GUIDE } from '../conf-import-spec.js';
import { trackColorOf, pickTrackColorIndex } from '../track-colors.js';
import { saveConf } from '../features/conference/conf-common.js';
import './speaker-bulkmail.js';
import { scheduleSharePublish } from './speaker-share.js';   // 프로그램·수급 현황 바깥 공유
import { nextActionLabel, flowStatus as spFlowStatus } from './speaker-flow.js';
import { confDashHtml } from './conf-dash.js';
import { reusePending } from './contact-speaker.js';
import { renderWatchView, initWatchFolders } from './exh-watch.js';

/* 10개 함수를 ../features/conference/conf-common.js로 옮겼다 — 이 파일에서도 쓰고, 옛 경로로 가져가는 곳도 있어 다시 내보낸다 */
import { consentRefused, reuseState, setConfLockEv, onConfLockFallback, confLocked, confLockNotice, guardConf, MEAL_TITLE, isHiddenSp, isBreak , speakerName, syncPartRole } from '../features/conference/conf-common.js';
export { consentRefused, reuseState, setConfLockEv, onConfLockFallback, confLocked, confLockNotice, guardConf, MEAL_TITLE, isHiddenSp, isBreak , speakerName, syncPartRole } from '../features/conference/conf-common.js';


/* ── 모듈 상태 ── */
onConfLockFallback(() => confUi.confEvent);
export const confPhotoAsked = new Set();

export const gSaveSession   = guardConf(saveConfSession);
const gDelSession    = guardConf(deleteConfSession);
export const gSaveSpeaker   = guardConf(saveSpeaker);
const gDelSpeaker    = guardConf(deleteSpeaker);
export const gSaveAssign    = guardConf(saveSessionSpeaker);
const gDelAssign     = guardConf(deleteSessionSpeaker);
const gDelSpeakerContact = guardConf(deleteSpeakerContact);
const gDelSpeakerLog     = guardConf(deleteSpeakerLog);

/* ── 행사 목록 ──
   컨퍼런스를 하는 행사만 주인공이다. 안 하는 행사도 지우지 않고 아래로
   내린다 — 없는 것과 아직 안 켠 것은 다르고, 켜는 자리를 알려 줘야 한다. */
const confEventOptions = () => EVENT_LIST.slice()
  .sort((a, b) => String(b.date_start || '').localeCompare(String(a.date_start || '')));

export function buildConfEvList(){
  const el = document.getElementById('conf-ev-list');
  if(!el) return;
  const opts = confEventOptions();
  const stateOf = (e) => evPartState(e.key, 'conf');
  const doing = opts.filter(e => stateOf(e) === 'doing');
  const done  = opts.filter(e => stateOf(e) === 'done');
  const off   = opts.filter(e => stateOf(e) === 'none');

  // 손댈 수 있는 행사부터 고른다 — 끝난 행사가 먼저 열리면 잠긴 화면부터 본다
  if(!confUi.confEvent || !opts.some(e => e.key === confUi.confEvent)){
    const first = doing[0] || done[0] || off[0];
    if(first) confUi.confEvent = first.key;
  }

  const row = (e, n) => `<button class="nr${confUi.confEvent === e.key ? ' on' : ''}" onclick="setConfEvent('${escAttr(e.key)}')">
      <span class="ev-pill-dot" style="background:${escAttr(e.color || '#9C9890')}"></span>${escapeHtml(e.short || e.name || e.key)}
      ${n ? `<span class="nbg">${n}</span>` : ''}</button>`;
  const head = (t) => `<div style="font-size:10px;color:var(--i4);margin:10px 0 4px;padding-left:2px">${t}</div>`;
  const group = (arr, title, count) => arr.length
    ? (title ? head(title) : '') + arr.map(e => row(e, count ? speakersForEvent(e.key).length : 0)).join('')
    : '';

  /* 설정에서 컨퍼런스를 «안 함»으로 둔 행사는 목록에서 뺀다 — 몇 개가 빠졌는지와
     켜는 곳만 한 줄로 남긴다 */
  const hiddenNote = off.length
    ? `<div style="font-size:10px;color:var(--i5);margin:10px 0 0;padding-left:2px"
         title="${escapeHtml(off.map(e => e.short || e.name || e.key).join(', '))}">컨퍼런스 안 하는 행사 ${off.length}개는 숨겼어요 — 설정 › 행사 관리에서 켜요</div>`
    : '';
  el.innerHTML = ((
      group(doing, '', true)
    + group(done, '진행 완료', true)
  ) || '<div style="font-size:11px;color:var(--i4);padding:6px 2px">진행 중인 컨퍼런스가 없어요</div>') + hiddenNote;

  /* 휴대폰 머리줄 — «연사»라는 탭 이름만으로는 어느 행사를 보고 있는지 모른다.
     사이드바를 열지 않고도 바꿀 수 있게 행사 이름 자체를 고르는 칸으로 둔다. */
  const mt = document.getElementById('mob-conf-ttl');
  if(mt){
    mt.style.minWidth = '0';   // 긴 행사명이 오른쪽 단추를 밀어내지 않게
    const live = [...doing, ...done];
    const opt = (e) => `<option value="${escapeHtml(e.key)}"${confUi.confEvent === e.key ? ' selected' : ''}>${escapeHtml(e.short || e.name || e.key)}</option>`;
    mt.innerHTML = live.length ? `<select onchange="setConfEvent(this.value)" aria-label="행사 고르기"
        style="max-width:100%;font:inherit;font-weight:700;color:inherit;background:transparent;border:0;
        padding:2px 18px 2px 0;appearance:none;-webkit-appearance:none;cursor:pointer;
        background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);
        background-position:calc(100% - 9px) 55%,calc(100% - 4px) 55%;background-size:5px 5px;background-repeat:no-repeat;
        text-overflow:ellipsis;overflow:hidden;white-space:nowrap">
        ${doing.map(opt).join('')}${done.length ? `<optgroup label="진행 완료">${done.map(opt).join('')}</optgroup>` : ''}
      </select>` : '컨퍼런스';
  }
}

export function setConfEvent(key){
  confUi.confEvent = key;
  confUi.confOpenSession = '';
  confUi.confEditSession = '';
  confUi.confNewSession = false;
  confUi.confNeedFil = null;
  confUi.confSettleFil = '';
  confUi.confCardFil = '';
  confUi.confVideoFil = '';
  confUi.confRoleFil = '';
  confUi.confSessFil = '';
  window.clearConfQuery();
  buildConfEvList();
  renderConf();
  if(confUi.confView === 'watch') initWatchFolders(confUi.confEvent, 'conf');
  if(isMobile()) window.closeSb?.();
}

export function setConfView(v){
  confUi.confView = v;
  renderConf();
  if(v === 'watch') initWatchFolders(confUi.confEvent, 'conf');
}

/* ── 도움 함수 ── */
const roleDef = (role) => SPEAKER_ROLES.find(r => r.key === role);
export const roleCls = (role) => (roleDef(role) || {}).cls || 'p-gray';
const roleChip = (role) => `<span class="pill ${roleCls(role)}" style="font-size:10px">${escapeHtml(role || '역할 없음')}</span>`;

export const dayLabel = (d) => {
  if(!d) return '날짜 미정';
  const dt = new Date(d + 'T00:00:00');
  const w = ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()] || '';
  return `${d} (${w})`;
};
export const timeLabel = (s, e) => (s || e) ? `${s || ''}${e ? '–' + e : ''}` : '';

/* 국가 딱지 — 국적과 거주지가 다를 때만 둘 다 보여준다. 같으면 한 번이면
   되고, 다를 때가 연사료·항공을 어느 쪽으로 할지 정해야 하는 경우다. */
export function countryChip(sp){
  const nat = sp.nationality, res = sp.residence_country;
  if(!nat && !res) return '';
  if(!nat || !res || nat === res){
    return `<span class="pill p-gray" style="font-size:9px">${escapeHtml(countryName(nat || res))}</span>`;
  }
  const basis = sp.pay_basis === 'nationality' ? 'nationality' : 'residence';
  const mark = (which, v) => `<span class="pill ${which === basis ? 'p-teal' : 'p-gray'}" style="font-size:9px"
    title="${escapeHtml(`${which === 'residence' ? '거주지' : '국적'}${which === basis ? ' — 지급 기준' : ''}`)}">${escapeHtml(countryName(v))}</span>`;
  return `${mark('residence', res)}${mark('nationality', nat)}`;
}


/* ══════════════════════════════════════════
   렌더
══════════════════════════════════════════ */
/* 일정 바뀐 연사 — 세션 시간·룸을 고치면 «알린 일정»과 달라진 연사가 생긴다.
   사람이 «누구에게 정정 메일을 보내야 하지»를 기억하지 않게 목록 위에 띄운다 */
export function schedAlertHtml(evKey, all){
  const ch = all.filter(sp => (spFlowStatus(sp).steps.find(s => s.key === 'schedule') || {}).applies);
  if(!ch.length) return '';
  const names = ch.slice(0, 4).map(sp => sp.name_snapshot || sp.name_en || sp.id).join(', ') + (ch.length > 4 ? ` 외 ${ch.length - 4}명` : '');
  return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:9px 12px;margin:-4px 0 10px;
      border:1px solid var(--am);border-radius:10px;background:var(--W);font-size:11.5px">
    <b style="color:var(--am)">일정 바뀐 연사 ${ch.length}명</b>
    <span style="color:var(--i3)">${escapeHtml(names)} — 알린 일정과 지금 일정이 달라요</span>
    <button class="btn bp bs" style="margin-left:auto" onclick="openSpeakerBulkMail('${escAttr(evKey)}','schedule')">✉ 일정 변경 안내 보내기</button>
  </div>`;
}

export function renderConf(){
  const body = document.getElementById('conf-body');
  const ttl = document.getElementById('conf-ttl');
  if(!body) return;

  const ev = EVENT_LIST.find(e => e.key === confUi.confEvent);
  if(ttl){
    ttl.innerHTML = `연사 <span class="tb-s">${ev ? escapeHtml(ev.short || ev.name || ev.key) : '행사를 고르세요'}</span>`;
  }

  if(!ev){
    body.innerHTML = emptyBox('행사를 고르면 프로그램과 연사가 보여요.');
    return;
  }
  if(evPartState(ev.key, 'conf') === 'none'){
    body.innerHTML = emptyBox(
      `이 행사는 <b>컨퍼런스</b> 파트가 꺼져 있어요.<br>`
      + `설정 › 행사 관리 › ${escapeHtml(ev.short || ev.key)} › 진행 파트에서 컨퍼런스를 «진행 중»으로 켜면 여기서 프로그램을 짤 수 있어요.`);
    return;
  }
  // 바깥 공유를 켜 둔 행사면 바뀐 것을 잠시 뒤 다시 올린다(speaker-share.js)
  scheduleSharePublish(ev.key);

  const segs = [['dash', '대시보드'], ['pga', 'Program at a Glance'], ['program', 'Program'], ['people', 'Speakers'], ['watch', '파일 감시']];
  const seg = `<div class="seg" style="margin:0 0 12px">
    ${segs.map(([k, l]) => `<button class="seg-b${confUi.confView === k ? ' on' : ''}" onclick="setConfView('${k}')">${l}</button>`).join('')}
  </div>`;

  const banner = confLocked() ? `<div style="display:flex;align-items:center;gap:9px;margin:0 0 12px;
      padding:9px 12px;background:var(--i8);border:1px solid var(--i6);border-radius:8px;font-size:11.5px;color:var(--i5)">
      🔒 끝난 컨퍼런스라 열람만 됩니다. 고치려면 <b>설정 › 행사 관리 › 진행 파트</b>에서 진행 중으로 되돌리세요.
    </div>` : '';

  /* 검색은 사람을 거르는 일인데, 프로그램표와 한눈에 보기에는 거를 사람 목록이
     없다. 그 두 화면에서는 무엇을 쳐도 화면이 그대로여서 «검색이 안 된다»로
     보인다 — 검색어가 들어오면 연사 목록을 대신 보여준다. 보기 설정은 건드리지
     않아서, 검색어를 지우면 보던 화면으로 그대로 돌아온다(전시 탭과 같은 방식). */
  const inner = (confUi.confView === 'people' || window.confQuery()) ? window.peopleHtml(ev)
    : confUi.confView === 'dash' ? confDashHtml(ev)
    : confUi.confView === 'pga' ? window.pgaHtml(ev)
    : confUi.confView === 'watch' ? renderWatchView(ev.key, 'conf')
    : window.programHtml(ev);
  body.innerHTML = `<div style="padding:14px 16px 40px">${seg}${banner}`
    + (confLocked() ? `<div class="ro">${inner}</div>` : inner) + `</div>`;
}

const emptyBox = (msg) => `<div style="padding:40px 16px">
  <div style="max-width:560px;margin:0 auto;padding:20px;background:var(--i8);
    border:1px solid var(--i6);border-radius:10px;font-size:12.5px;color:var(--i5);line-height:1.7">${msg}</div></div>`;

/* «프로그램 — 일자·세션·배정»은 ../features/conference/conf-program.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* «프로그램표(PROGRAM AT A GLANCE)»은 ../features/conference/conf-pga.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* «연사 보기 — 준비·정산·카드»은 ../features/conference/conf-people.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* 2개 함수를 ../features/conference/speaker-cells.js로 옮겼다 — 옛 경로(이 파일)로 가져가는 곳이 있어 다시 내보낸다 */
export { SP_COLS, spCell, SP_SENT } from '../features/conference/speaker-cells.js';
/* «연사·세션 엑셀로 올리기»은 ../features/conference/conf-upload.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* ══════════════════════════════════════════
   쓰기
══════════════════════════════════════════ */
/* 시간대를 고르면 시작·종료 칸을 채운다 — 안내에 그렇게 적었으니 실제로
   채워져야 하고, 고른 뒤 한쪽만 손으로 고치는 일도 가능해야 한다. */
export function fillSessionSlot(idx){
  const ev = EVENT_LIST.find(e => e.key === confUi.confEvent);
  const slot = (confCfg(ev?.key || '').slots || [])[Number(idx)];
  const s = document.getElementById('ns-start'), e = document.getElementById('ns-end');
  if(!slot || !s || !e) return;
  s.value = slot.start || '';
  e.value = slot.end || '';
}

export function toggleNewSession(){ confUi.confNewSession = !confUi.confNewSession; renderConf(); }
/* ── 발표 시간 ──
   세션 시간만으로는 연사에게 «몇 시에 올라가시면 됩니다»를 못 적는다.
   시간은 사람이 아니라 배정에 붙는다 — 한 사람이 두 세션에서 발표하면
   시간도 둘이다. */
const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const toHHMM = (n) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

export async function setTalkTime(aid, field, value){
  if(confLocked()){ confLockNotice(); return; }
  const a = SESSION_SPEAKERS.find(x => x.id === aid);
  if(!a) return;
  const v = String(value || '').trim();
  if(String(a[field] ?? '') === v) return;

  const patch = { [field]: v };
  /* 시작과 «분»이 다 있으면 종료를 채워 준다. 손으로 적어 둔 종료는 덮지
     않는다 — 쉬는 시간을 끼워 일부러 다르게 둔 경우가 있다. */
  if(field === 'start_at' || field === 'duration_min'){
    const start = field === 'start_at' ? v : a.start_at;
    const mins = Number(field === 'duration_min' ? v : a.duration_min);
    const sm = toMin(start);
    if(sm !== null && mins > 0 && !a.end_at) patch.end_at = toHHMM(sm + mins);
  }
  /* 종료를 직접 고치면 «분»도 따라간다 — 둘이 어긋난 채로 남으면 배분할 때
     엉뚱한 길이로 이어 붙는다. */
  if(field === 'end_at' && v){
    const sm = toMin(a.start_at), em = toMin(v);
    if(sm !== null && em !== null && em > sm) patch.duration_min = String(em - sm);
  }

  const backup = {};
  Object.keys(patch).forEach(k => { backup[k] = a[k]; });
  Object.assign(a, patch);
  renderConf();

  const res = await gSaveAssign({ id: aid, ...patch });
  if(!res || res.ok === false){
    Object.assign(a, backup);
    renderConf();
    if(!res?.locked) alert('발표 시간을 저장하지 못했어요.');
    return;
  }
  trackAction('edit', '발표 시간', confUi.confEvent,
    /* 시각만이 아니라 분만 고칠 때도 있다 — 그때 «감은희 —»로 끝나 무엇을 고쳤는지 몰랐다 */
    `${speakerName(a.speaker_id)} — ${[
      (patch.start_at !== undefined || patch.end_at !== undefined) && `${a.start_at || '시각 없음'}${a.end_at ? `–${a.end_at}` : ''}`,
      patch.duration_min !== undefined && (patch.duration_min ? `${patch.duration_min}분` : '분 지움'),
    ].filter(Boolean).join(' · ') || '발표 시간'}`,
    changed('session_speakers', aid, backup, patch, { kind: 'session', id: a.session_id, ev: confUi.confEvent }));
}

/* 세션 시작부터 각 발표의 «분»만큼 이어 붙인다.
   «분»이 없는 줄은 건너뛴다 — 0분으로 잡아 버리면 뒤 순서가 전부 밀린다. */
export async function autoTalkTimes(sid){
  if(confLocked()){ confLockNotice(); return; }
  const sess = CONF_SESSIONS.find(x => x.id === sid);
  if(!sess || !sess.start_at) return;
  /* 공동 연사 줄은 주 발표자와 같은 시간이다 — 따로 이어 붙이지 않는다 */
  const asg = assignmentsOfSession(sid).filter(a => leadOf(a) === a);
  const usable = asg.filter(a => Number(a.duration_min) > 0);
  if(!usable.length){
    alert('각 발표의 «분»을 먼저 적어주세요. 그 길이대로 세션 시작부터 이어 붙입니다.');
    return;
  }
  const skipped = asg.length - usable.length;
  let cur = toMin(sess.start_at);
  const plan = usable.map(a => {
    const st = toHHMM(cur);
    cur += Number(a.duration_min);
    return { a, start_at: st, end_at: toHHMM(cur) };
  });
  const endM = toMin(sess.end_at);
  const over = endM !== null && cur > endM;

  if(!confirm(`${sess.start_at}부터 이어 붙입니다.\n\n`
    + plan.map(p => `${p.start_at}–${p.end_at}  ${speakerName(p.a.speaker_id)}`).join('\n')
    + (skipped ? `\n\n«분»이 없는 ${skipped}명은 건너뜁니다.` : '')
    + (over ? `\n\n⚠ 세션 종료(${sess.end_at})를 ${cur - endM}분 넘깁니다.` : ''))) return;

  for(const p of plan){
    const backup = { start_at: p.a.start_at, end_at: p.a.end_at };
    p.a.start_at = p.start_at; p.a.end_at = p.end_at;
    const res = await gSaveAssign({ id: p.a.id, start_at: p.start_at, end_at: p.end_at });
    if(!res || res.ok === false){
      Object.assign(p.a, backup);
      renderConf();
      if(!res?.locked) alert('시간 배분을 저장하지 못했어요.');
      return;
    }
  }
  trackAction('edit', '발표 시간 배분', confUi.confEvent,
    `${sess.title_ko || sess.title_en || sid} — ${plan.length}명`,
    { kind: 'session', id: sid, ev: confUi.confEvent });
  renderConf();
}

/* ── 순서 바꾸기 ──
   좌장을 나중에 넣으면 맨 뒤에 붙는다. 프로그램은 순서대로 읽는 물건이라
   좌장이 맨 아래 있으면 그대로는 못 쓴다. 지워서 다시 넣게 하면 발제 정보가
   함께 날아가므로, 끌어서 옮긴다. */

export function onAsgDragStart(e, aid){
  confUi.dragAsgId = aid;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', aid);
  e.stopPropagation();
}
export function onAsgDragEnd(){
  confUi.dragAsgId = null;
  document.querySelectorAll('.asg-row.drop-on').forEach(el => el.classList.remove('drop-on'));
}
export function onAsgDragOver(e, el){
  if(!confUi.dragAsgId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if(el) el.classList.add('drop-on');
}
export function onAsgDragLeave(el){ if(el) el.classList.remove('drop-on'); }

export async function onAsgDrop(e, overId, el){
  e.preventDefault();
  e.stopPropagation();
  if(el) el.classList.remove('drop-on');
  const from = confUi.dragAsgId;
  onAsgDragEnd();
  if(!from || from === overId) return;

  const moving = SESSION_SPEAKERS.find(x => x.id === from);
  const target = SESSION_SPEAKERS.find(x => x.id === overId);
  /* 다른 세션의 줄로는 옮기지 않는다 — 세션을 옮기는 건 순서 바꾸기가 아니라
     배정을 다시 하는 일이고, 그때는 발제 정보를 어떻게 할지 정해야 한다. */
  if(!moving || !target || moving.session_id !== target.session_id) return;

  /* 공동 발표는 한 덩어리로 옮긴다 — 주 발표자를 끌면 공동연사가 따라오고,
     공동연사를 끌면 주 발표자째 옮긴다. 떨어지면 따로 발표하는 것처럼 보인다. */
  const all = assignmentsOfSession(moving.session_id).slice();
  const head = leadOf(moving), over = leadOf(target);
  if(head === over) return;
  const group = (l) => [l, ...all.filter(x => x !== l && leadOf(x) === l)];
  const block = group(head);
  const rest = all.filter(x => !block.includes(x));
  const fromIdx = all.indexOf(head);
  const overIdx = all.indexOf(over);
  /* 아래로 끌면 놓은 덩어리 뒤에, 위로 끌면 앞에 */
  let at = rest.indexOf(over);
  if(overIdx > fromIdx) at += group(over).length;
  const list = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  const sess = CONF_SESSIONS.find(s => s.id === moving.session_id);
  const label = `${sess ? (sess.title_ko || sess.title_en || '세션') + ' — ' : ''}${speakerName(head.speaker_id)} ${list.indexOf(head) + 1}번째로 옮김`;
  await applyAsgOrder(list, label);
  await reflowTalkTimes(list, label);
}

/* 순서를 바꾸면 시간도 따라간다. 시간이 적힌 발표만 새 순서대로, 맨 처음 시각부터
   각자의 길이(«분», 없으면 시작–종료)만큼 이어 붙인다. 시간이 없는 줄(좌장 등)과
   공동연사 줄은 건드리지 않는다 — 공동연사는 주 발표자 시간을 읽는다. */
async function reflowTalkTimes(list, label){
  const timed = list.filter(a => leadOf(a) === a && a.start_at);
  if(timed.length < 2) return;
  const lenOf = (a) => Number(a.duration_min) || ((toMin(a.end_at) ?? null) !== null && toMin(a.start_at) !== null
    ? toMin(a.end_at) - toMin(a.start_at) : 0);
  if(timed.some(a => !(lenOf(a) > 0))) return;   // 길이를 모르는 발표가 있으면 손대지 않는다
  let cur = Math.min(...timed.map(a => toMin(a.start_at)));
  const plan = timed.map(a => { const st = toHHMM(cur); cur += lenOf(a); return { a, start_at: st, end_at: toHHMM(cur) }; })
    .filter(p => p.a.start_at !== p.start_at || p.a.end_at !== p.end_at);
  if(!plan.length) return;
  for(const p of plan){
    const backup = { start_at: p.a.start_at, end_at: p.a.end_at };
    p.a.start_at = p.start_at; p.a.end_at = p.end_at;
    const res = await gSaveAssign({ id: p.a.id, start_at: p.start_at, end_at: p.end_at });
    if(!res || res.ok === false){
      Object.assign(p.a, backup);
      renderConf();
      if(!res?.locked) alert('순서는 바꿨지만 시간을 옮기지 못했어요. «시간 배분»으로 다시 맞춰 주세요.');
      return;
    }
  }
  trackAction('edit', '발표 시간 배분', confUi.confEvent, `${label} — 시간 따라 옮김`);
  renderConf();
}

/* seq를 1부터 다시 매긴다. 바뀐 줄만 보낸다 — 다섯 줄 중 둘만 움직였는데
   다섯 번 저장하면 기록이 «고침»으로 채워진다. */
async function applyAsgOrder(list, label){
  const changed = [];
  list.forEach((a, i) => {
    const next = String(i + 1);
    if(String(a.seq ?? '') !== next) changed.push({ a, prev: a.seq, next });
  });
  if(!changed.length) return;
  changed.forEach(c => { c.a.seq = c.next; });
  renderConf();

  for(const c of changed){
    const res = await gSaveAssign({ id: c.a.id, seq: c.next });
    if(!res || res.ok === false){
      changed.forEach(x => { x.a.seq = x.prev; });
      renderConf();
      if(!res?.locked) alert('순서를 저장하지 못했어요.');
      return;
    }
  }
  trackAction('edit', '세션 배정 순서', confUi.confEvent, label);
}

export function toggleEditSession(sid){
  confUi.confEditSession = confUi.confEditSession === sid ? '' : sid;
  renderConf();
}

/* 수정 칸에서도 시간대를 고르면 시작·종료가 채워진다 */
export function fillEditSlot(sid, idx){
  const slot = (confCfg(confUi.confEvent).slots || [])[Number(idx)];
  const st = document.getElementById(`es-${sid}-start`);
  const en = document.getElementById(`es-${sid}-end`);
  if(!slot || !st || !en) return;
  st.value = slot.start || '';
  en.value = slot.end || '';
}

export async function saveSessionEdit(sid){
  if(confLocked()){ confLockNotice(); return; }
  const s = CONF_SESSIONS.find(x => x.id === sid);
  if(!s) return;
  const g = (k) => (document.getElementById(`es-${sid}-${k}`)?.value || '').trim();
  const msg = document.getElementById(`es-msg-${sid}`);
  const say = (t, ok) => { if(msg){ msg.style.color = ok ? 'var(--g)' : 'var(--re)'; msg.textContent = t; } };

  const si = g('slot');
  const slots = confCfg(confUi.confEvent).slots || [];
  const slot = si !== '' ? slots[Number(si)] : null;
  const start = slot ? slot.start : g('start');
  const end = slot ? slot.end : g('end');
  const titleKo = g('ko'), titleEn = g('en');
  if(!titleKo && !titleEn){ say('세션명을 넣어주세요 — 국문이나 영문 하나는 있어야 해요.', false); return; }
  if(start && end && end <= start){ say('종료가 시작보다 빠르거나 같아요.', false); return; }

  const patch = {
    title_ko: titleKo, title_en: titleEn,
    date: g('date'), start_at: start, end_at: end,
    track: g('track'), room: g('room'), note: g('note'), kind: g('kind'),
  };
  /* 바뀐 것이 없으면 보내지 않는다 — 저장할 때마다 같은 값을 밀어 넣으면
     기록이 «고침»으로 채워져 정작 무엇이 바뀌었는지 안 보인다. */
  const diff = Object.keys(patch).filter(k => String(s[k] ?? '') !== String(patch[k] ?? ''));
  if(!diff.length){ confUi.confEditSession = ''; renderConf(); return; }

  const backup = {};
  diff.forEach(k => { backup[k] = s[k]; });
  Object.assign(s, patch);
  say('저장 중…', true);

  /* 바뀐 칸만 보낸다. 전에는 칸을 전부 보냈는데, 다른 창(또는 트랙 이름을
     바꾸기 전에 열어 둔 화면)에서 시간만 고쳐도 옛 트랙명이 같이 실려 가
     설정에서 바꾼 트랙을 되돌려 놓았다 — 2026-10-01 AIA 세션 셋이 그렇게 됐다. */
  const res = await gSaveSession({ id: sid, ...diff.reduce((o, k) => (o[k] = patch[k], o), {}) });
  if(!res || res.ok === false){
    Object.assign(s, backup);
    renderConf();
    if(!res?.locked) alert('세션을 고치지 못했어요. 잠시 뒤 다시 해주세요.');
    return;
  }
  trackAction('edit', '컨퍼런스 세션', confUi.confEvent, `${titleKo || titleEn} — ${diff.join(', ')} 고침`,
    changed('conf_sessions', sid, backup, diff.reduce((o, k) => (o[k] = patch[k] ?? '', o), {}),
      { kind: 'session', id: sid, ev: confUi.confEvent }));
  confUi.confEditSession = '';
  renderConf();
}

export function toggleAssign(sid){ confUi.confOpenSession = confUi.confOpenSession === sid ? '' : sid; renderConf(); }

const gv = (id) => (document.getElementById(id)?.value || '').trim();

export async function addConfSession(){
  if(confLocked()){ confLockNotice(); return; }
  const ev = EVENT_LIST.find(e => e.key === confUi.confEvent);
  if(!ev) return;

  /* 시간대를 골랐으면 그 값을 쓴다 — 직접 적은 칸보다 설정 목록이 우선이다.
     같은 시간대가 «10:00»과 «10시»로 갈리는 걸 막으려고 목록을 둔 것이다. */
  const si = gv('ns-slot');
  const slots = confCfg(ev.key).slots || [];
  const slot = si !== '' ? slots[Number(si)] : null;
  const start = slot ? slot.start : gv('ns-start');
  const end = slot ? slot.end : gv('ns-end');
  const titleKo = gv('ns-ko'), titleEn = gv('ns-en');
  if(!titleKo && !titleEn){ alert('세션명을 넣어주세요 — 국문이나 영문 하나는 있어야 목록에서 찾을 수 있어요.'); return; }
  if(start && end && end <= start){ alert('종료가 시작보다 빠르거나 같아요.'); return; }

  const row = {
    event_id: ev.key,
    seq: String(sessionsForEvent(ev.key).length + 1),
    title_ko: titleKo, title_en: titleEn,
    date: gv('ns-date'), start_at: start, end_at: end,
    track: gv('ns-track'), room: gv('ns-room'), note: '', kind: gv('ns-kind'),
  };
  const res = await gSaveSession(row);
  if(!res || res.ok === false){ if(!res?.locked) alert('세션을 만들지 못했어요. 잠시 뒤 다시 해주세요.'); return; }

  CONF_SESSIONS.push({ ...row, id: res.id || row.id || `CS-tmp-${Date.now()}` });
  trackAction('add', '컨퍼런스 세션', ev.key, `${ev.name || ev.key} — ${titleKo || titleEn}`,
    { kind: 'session', id: res.id || row.id, ev: ev.key });
  confUi.confNewSession = false;
  renderConf();
}

export async function removeConfSession(sid){
  if(confLocked()){ confLockNotice(); return; }
  const s = CONF_SESSIONS.find(x => x.id === sid);
  if(!s) return;
  const asg = assignmentsOfSession(sid);
  /* 배정이 걸린 세션을 지우면 그 사람이 무엇을 맡았는지가 사라진다.
     연사 줄은 남으니 «배정 없음»으로 떠 알아볼 수는 있게 된다. */
  if(!confirm(`«${s.title_ko || s.title_en || sid}» 세션을 지울까요?`
    + (asg.length ? `\n배정된 ${asg.length}명의 이 세션 역할도 함께 지워집니다 (연사 자체는 남아요).` : ''))) return;

  const goneAssigns = asg.map(a => ({ ...a }));
  for(const a of asg){
    const r = await gDelAssign(a.id);
    if(r && r.ok === false){
      if(!r.locked) alert('배정을 푸는 중에 멈췄어요 — 세션은 지우지 않았습니다.');
      renderConf();
      return;
    }
    const i = SESSION_SPEAKERS.findIndex(x => x.id === a.id);
    if(i >= 0) SESSION_SPEAKERS.splice(i, 1);
  }
  const res = await gDelSession(sid);
  if(res && res.ok === false){ if(!res.locked) alert('세션을 지우지 못했어요.'); renderConf(); return; }
  const i = CONF_SESSIONS.findIndex(x => x.id === sid);
  if(i >= 0) CONF_SESSIONS.splice(i, 1);
  if(confUi.confEditSession === sid) confUi.confEditSession = '';
  /* 세션을 지우면 배정도 함께 없어진다 — 둘 다 담아야 되살릴 수 있다 */
  trackAction('delete', '컨퍼런스 세션', confUi.confEvent, s.title_ko || s.title_en || sid,
    removed('conf_sessions', sid, s, { kind: 'session', id: sid, also: goneAssigns }));
  for(const spId of new Set(goneAssigns.map(a => a.speaker_id))) await syncPartRole(spId);
  renderConf();
}

export async function addAssign(sid){
  if(confLocked()){ confLockNotice(); return; }
  const ev = EVENT_LIST.find(e => e.key === confUi.confEvent);
  if(!ev) return;
  const role = gv('as-role') || SPEAKER_ROLES[0].key;
  let spId = gv('as-pick');

  if(!spId){
    const name = gv('as-name');
    if(!name){ alert('이 행사의 연사에서 고르거나, 새 이름을 적어주세요.'); return; }
    /* 같은 이름이 이 행사에 이미 있으면 그 사람을 쓴다 — 같은 사람이 두 줄로
       갈리면 «받을 것»도 두 벌이 되고 어느 쪽에 받았는지 알 수 없다. */
    const same = speakersForEvent(ev.key).find(sp => (sp.name_snapshot || '').trim() === name);
    if(same){ spId = same.id; }
    else {
      const sp = { event_id: ev.key, contact_id: '', name_snapshot: name, status: '섭외중', lang_pref: '', note: '' };
      const res = await gSaveSpeaker(sp);
      if(!res || res.ok === false){ if(!res?.locked) alert('연사를 만들지 못했어요.'); return; }
      spId = res.id || `SP-tmp-${Date.now()}`;
      SPEAKERS.push({ ...sp, id: spId });
    }
  }

  if(assignmentsOfSession(sid).some(a => a.speaker_id === spId && a.role === role)){
    alert('이미 같은 역할로 배정돼 있어요.'); return;
  }
  const row = {
    event_id: ev.key, session_id: sid, speaker_id: spId,
    seq: String(assignmentsOfSession(sid).length + 1), role,
    lang: '', duration_min: '', title_ko: '', title_en: '',
    abstract_ko: '', abstract_en: '', abstract_received_at: '',
    slides_file: '', slides_received_at: '', slides_version: '', note: '',
  };
  const res = await gSaveAssign(row);
  if(!res || res.ok === false){ if(!res?.locked) alert('배정하지 못했어요.'); return; }
  const made = { ...row, id: res.id || `SS-tmp-${Date.now()}` };
  SESSION_SPEAKERS.push(made);
  trackAction('add', '세션 배정', ev.key, `${speakerName(spId)} — ${role}`,
    { kind: 'session', id: sid, ev: ev.key });
  await syncPartRole(spId);

  /* 고른 자리에 끼워 넣는다. 좌장은 대개 맨 앞이라, 넣고 나서 매번 끌어
     올리게 하면 그게 일이 된다. */
  const at = (document.getElementById('as-at')?.value || '').trim();
  if(at !== ''){
    const list = assignmentsOfSession(sid).filter(x => x.id !== made.id);
    list.splice(Number(at), 0, made);
    await applyAsgOrder(list, `${speakerName(spId)} — ${Number(at) + 1}번째로 배정`);
  }
  renderConf();
}

export async function setAssignRole(aid, role){
  if(confLocked()){ confLockNotice(); return; }
  const a = SESSION_SPEAKERS.find(x => x.id === aid);
  if(!a || a.role === role) return;
  const was = a.role;
  const res = await gSaveAssign({ id: aid, role });
  if(!res || res.ok === false){ if(!res?.locked) alert('역할을 바꾸지 못했어요.'); renderConf(); return; }
  a.role = role;
  trackAction('edit', '세션 배정', confUi.confEvent, `${speakerName(a.speaker_id)} — ${was} → ${role}`,
    changed('session_speakers', aid, { role: was }, { role },
      { kind: 'session', id: a.session_id, ev: confUi.confEvent }));
  await syncPartRole(a.speaker_id);
  renderConf();
}


/* 공동 발표로 묶거나 푼다. 묶으면 공동 연사 줄을 주 발표자 바로 뒤로 옮긴다 —
   프로그램표에서 한 칸으로 읽혀야 하고, 떨어져 있으면 따로 발표하는 것처럼 보인다.
   공동 연사 줄에 적혀 있던 시간·발제는 지우지 않는다(풀면 그대로 돌아온다). */
export async function setCoLead(aid, leadId){
  if(confLocked()){ confLockNotice(); return; }
  const a = SESSION_SPEAKERS.find(x => x.id === aid);
  if(!a || (a.lead_id || '') === (leadId || '')) return;
  const lead = leadId ? SESSION_SPEAKERS.find(x => x.id === leadId) : null;
  if(leadId && (!lead || lead.session_id !== a.session_id || leadOf(lead) !== lead)){ renderConf(); return; }
  const was = a.lead_id || '';
  const res = await gSaveAssign({ id: aid, lead_id: leadId || '' });
  if(!res || res.ok === false){ if(!res?.locked) alert('공동 발표를 저장하지 못했어요.'); renderConf(); return; }
  a.lead_id = leadId || '';
  trackAction('edit', '공동 발표', confUi.confEvent,
    lead ? `${speakerName(a.speaker_id)} — ${speakerName(lead.speaker_id)}와 공동 발표` : `${speakerName(a.speaker_id)} — 단독 발표로`,
    changed('session_speakers', aid, { lead_id: was }, { lead_id: a.lead_id }, { kind: 'session', id: a.session_id, ev: confUi.confEvent }));
  if(lead){
    const list = assignmentsOfSession(a.session_id).filter(x => x.id !== aid);
    const at = list.findIndex(x => x.id === lead.id) + 1 + coOf(lead).filter(x => x.id !== aid).length;
    list.splice(at, 0, a);
    await applyAsgOrder(list, `${speakerName(a.speaker_id)} — ${speakerName(lead.speaker_id)} 뒤로`);
  }
  renderConf();
}

export async function removeAssign(aid){
  if(confLocked()){ confLockNotice(); return; }
  const a = SESSION_SPEAKERS.find(x => x.id === aid);
  if(!a) return;
  /* 주 발표자를 빼면 공동 연사가 시간·발제·자료를 잃는다 — 먼저 각자 줄로 옮겨 단독으로 돌린다 */
  const cos = coOf(a);
  if(cos.length && !confirm(`${speakerName(a.speaker_id)}와 공동 발표하던 ${cos.map(x => speakerName(x.speaker_id)).join(', ')}은(는) `
    + '단독 발표로 바뀌고, 시간·발제·자료를 그대로 넘겨받아요. 해제할까요?')) return;
  for(const c of cos){
    const patch = { lead_id: '' };
    TALK_FIELDS.forEach(k => { patch[k] = a[k] ?? ''; });
    const r = await gSaveAssign({ id: c.id, ...patch });
    if(!r || r.ok === false){ if(!r?.locked) alert('공동 연사를 옮기지 못해 해제를 멈췄어요.'); renderConf(); return; }
    Object.assign(c, patch);
  }
  const res = await gDelAssign(aid);
  if(res && res.ok === false){ if(!res.locked) alert('배정을 해제하지 못했어요.'); return; }
  const i = SESSION_SPEAKERS.findIndex(x => x.id === aid);
  if(i >= 0) SESSION_SPEAKERS.splice(i, 1);
  trackAction('delete', '세션 배정', confUi.confEvent, `${speakerName(a.speaker_id)} — ${a.role}`,
    removed('session_speakers', aid, a, { kind: 'speaker', id: a.speaker_id }));
  // 발표 배정을 빼서 VIP만 남으면 마스터DB 참가 역할도 VIP로 — 따로 두면 «연사»로 남는다
  await syncPartRole(a.speaker_id);
  renderConf();
}

export async function removeConfSpeaker(spId){
  if(confLocked()){ confLockNotice(); return; }
  const sp = getSpeakerById(spId);
  if(!sp) return;
  /* 배정이 있으면 예전에는 거부하고 «먼저 해제하세요»라고 했다. 그러면 세
   군데를 돌아다녀야 지워지고, 결국 안 지운 채로 둔다 — 잘못 올린 연사가
   프로그램에 남는 쪽이 더 나쁘다. 지금은 무엇이 함께 지워지는지 세션 이름까지
   보여주고 한 번에 지운다. */
  const asg = assignmentsFor(spId);
  const asgLines = asg.map(a => {
    const ss = CONF_SESSIONS.find(x => x.id === a.session_id);
    return `${ss ? (ss.title_ko || ss.title_en || ss.id) : '(삭제된 세션)'} — ${a.role}`;
  });
  /* 연사 줄에 딸린 것들 — 연락 상대와 주고받은 기록. 연사 줄만 지워서 이것들이
     없는 사람을 가리킨 채 DB에 남아 있었다(실제로 네 줄이 그랬다). 화면에서는
     안 보이니 아무도 모르고, 계좌·여권을 열어 본 기록까지 주인 없이 떠돈다.
     «이력·제공사항이 함께 지워집니다»라고 물어 놓고 안 지우면 그 말이 거짓이 된다. */
  const goneCons = SPEAKER_CONTACTS.filter(c => c.speaker_id === spId).map(c => ({ ...c }));
  const goneLogs = SPEAKER_LOGS.filter(l => l.speaker_id === spId).map(l => ({ ...l }));
  if(!confirm(`«${sp.name_snapshot || spId}» 연사를 지울까요?\n이력·제공사항·계좌 정보가 함께 지워집니다.`
    + (asgLines.length ? `\n\n세션 배정 ${asgLines.length}건도 함께 풀립니다:\n· ${asgLines.join('\n· ')}` : '')
    + (goneCons.length || goneLogs.length
      ? `\n\n연락 상대 ${goneCons.length}명, 주고받은 기록 ${goneLogs.length}건도 함께 지워져요.` : '')
    + `\n\n되돌릴 수 없어요.`)) return;

  /* 배정을 먼저 푼다 — 사람을 먼저 지우면 중간에 실패했을 때 이름 없는
     배정 줄이 프로그램에 남는다. */
  for(const a of asg.slice()){
    const r = await gDelAssign(a.id);
    if(r && r.ok === false){
      if(!r.locked) alert('배정을 푸는 중에 멈췄어요 — 연사는 지우지 않았습니다.');
      renderConf();
      return;
    }
    const k = SESSION_SPEAKERS.findIndex(x => x.id === a.id);
    if(k >= 0) SESSION_SPEAKERS.splice(k, 1);
  }

  for(const [del, list, what] of [[gDelSpeakerContact, goneCons, '연락 상대'], [gDelSpeakerLog, goneLogs, '주고받은 기록']]){
    for(const g of list){
      const r = await del(g.id);
      if(r && r.ok === false){
        if(!r.locked) alert(`${what}을 지우는 중에 멈췄어요 — 연사는 지우지 않았습니다. 잠시 뒤 다시 해주세요.`);
        renderConf();
        return;
      }
    }
  }
  [[SPEAKER_CONTACTS, goneCons], [SPEAKER_LOGS, goneLogs]].forEach(([arr, gone]) => {
    gone.forEach(g => { const k = arr.findIndex(x => x.id === g.id); if(k >= 0) arr.splice(k, 1); });
  });

  const res = await gDelSpeaker(spId);
  if(res && res.ok === false){ if(!res.locked) alert('연사를 지우지 못했어요.'); return; }
  const i = SPEAKERS.findIndex(x => x.id === spId);
  if(i >= 0) SPEAKERS.splice(i, 1);
  trackAction('delete', '연사', confUi.confEvent, sp.name_snapshot || spId,
    removed('speakers', spId, sp, { also: [...goneCons, ...goneLogs] }));
  renderConf();
  buildConfEvList();
}

/* ── 인라인 핸들러용 노출 ── */
window.setConfEvent      = setConfEvent;
window.setConfView       = setConfView;
window.buildConfEvList   = buildConfEvList;
window.renderConf        = renderConf;
window.fillSessionSlot   = fillSessionSlot;
window.toggleNewSession  = toggleNewSession;
window.toggleAssign      = toggleAssign;
window.toggleEditSession = toggleEditSession;
window.fillEditSlot      = fillEditSlot;
window.saveSessionEdit   = saveSessionEdit;
window.setTalkTime       = setTalkTime;
window.autoTalkTimes     = autoTalkTimes;
window.onAsgDragStart    = onAsgDragStart;
window.onAsgDragEnd      = onAsgDragEnd;
window.onAsgDragOver     = onAsgDragOver;
window.onAsgDragLeave    = onAsgDragLeave;
window.onAsgDrop         = onAsgDrop;
window.addConfSession    = addConfSession;
window.removeConfSession = removeConfSession;
window.addAssign         = addAssign;
window.setAssignRole     = setAssignRole;
window.removeAssign      = removeAssign;
window.setCoLead         = setCoLead;
window.removeConfSpeaker = removeConfSpeaker;
