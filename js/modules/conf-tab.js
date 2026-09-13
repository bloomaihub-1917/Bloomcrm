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
} from '../state.js';
import { SPEAKER_ROLES, NEED_MARK, SPEAKER_NEEDS } from '../constants.js';
import { escapeHtml, escAttr, isMobile } from '../utils.js';
import { progressBar, shortCell } from './exh-tab.js';
import {
  saveConfSession, deleteConfSession,
  saveSpeaker, deleteSpeaker,
  saveSessionSpeaker, deleteSessionSpeaker,
  saveSpeakerContact, deleteSpeakerContact, deleteSpeakerLog,
} from '../api.js';
import { trackAction, changed, removed, created } from './audit-tab.js';
import { IMPORT_SHEETS, IMPORT_GUIDE } from '../conf-import-spec.js';
import { trackColorOf, pickTrackColorIndex } from '../track-colors.js';
import { saveConf } from './settings-tab.js';

/* ── 모듈 상태 ── */
let confEvent = '';
let confView = 'pga';          // 'pga' | 'program' | 'people'
let confOpenSession = '';      // 배정 칸이 열려 있는 세션
let confEditSession = '';      // 수정 칸이 열려 있는 세션
let confNewSession = false;    // 세션 추가 칸이 열려 있나
let confNeedFil = null;        // {key, mode:'done'|'todo'} — 받을 것 칩으로 거르기
let confRoleFil = '';          // 역할로 거르기
let confSessFil = '';          // 세션으로 거르기

/* ══════════════════════════════════════════
   진행 완료 잠금

   전시의 exhLocked와 같은 이유다 — 끝난 행사의 프로그램이 조용히 바뀌면
   그때 무엇을 했는지가 지금 값으로 덮인다. 화면을 비활성하는 것만으로는
   인라인 핸들러나 콘솔로 값이 들어가므로, 저장 함수를 감싸는 자리를 둔다.
══════════════════════════════════════════ */
export const confLocked = () => !!confEvent && evPartDone(confEvent, 'conf');

let _lockToastAt = 0;
export function confLockNotice(){
  const now = Date.now();
  if(now - _lockToastAt < 1500) return;
  _lockToastAt = now;
  alert('진행 완료된 컨퍼런스예요 — 열람만 됩니다.\n고치려면 설정 › 행사 관리 › 진행 파트에서 "진행 중"으로 되돌리세요.');
}

/* 쓰기 함수를 감싼다. 이 탭과 앞으로 붙일 연사 드로어가 같은 행사를 다루므로
   판단 기준이 한 군데여야 빠지는 길이 없다. */
export function guardConf(fn){
  return async (...args) => {
    if(confLocked()){ confLockNotice(); return { ok: false, locked: true }; }
    return fn(...args);
  };
}
const gSaveSession   = guardConf(saveConfSession);
const gDelSession    = guardConf(deleteConfSession);
const gSaveSpeaker   = guardConf(saveSpeaker);
const gDelSpeaker    = guardConf(deleteSpeaker);
const gSaveAssign    = guardConf(saveSessionSpeaker);
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
  if(!confEvent || !opts.some(e => e.key === confEvent)){
    const first = doing[0] || done[0] || off[0];
    if(first) confEvent = first.key;
  }

  const row = (e, n) => `<button class="nr${confEvent === e.key ? ' on' : ''}" onclick="setConfEvent('${escAttr(e.key)}')">
      <span class="ev-pill-dot" style="background:${escAttr(e.color || '#9C9890')}"></span>${escapeHtml(e.short || e.name || e.key)}
      ${n ? `<span class="nbg">${n}</span>` : ''}</button>`;
  const head = (t) => `<div style="font-size:10px;color:var(--i4);margin:10px 0 4px;padding-left:2px">${t}</div>`;
  const group = (arr, title, count) => arr.length
    ? (title ? head(title) : '') + arr.map(e => row(e, count ? speakersForEvent(e.key).length : 0)).join('')
    : '';

  el.innerHTML = (
      group(doing, '', true)
    + group(done, '진행 완료', true)
    + group(off,  '컨퍼런스 안 함', false)
  ) || '<div style="font-size:11px;color:var(--i4);padding:6px 2px">등록된 행사가 없어요</div>';
}

export function setConfEvent(key){
  confEvent = key;
  confOpenSession = '';
  confEditSession = '';
  confNewSession = false;
  confNeedFil = null;
  confRoleFil = '';
  confSessFil = '';
  buildConfEvList();
  renderConf();
  if(isMobile()) window.closeSb?.();
}

export function setConfView(v){
  confView = v;
  renderConf();
}

/* ── 도움 함수 ── */
const roleDef = (role) => SPEAKER_ROLES.find(r => r.key === role);
const roleCls = (role) => (roleDef(role) || {}).cls || 'p-gray';
const roleChip = (role) => `<span class="pill ${roleCls(role)}" style="font-size:10px">${escapeHtml(role || '역할 없음')}</span>`;

const dayLabel = (d) => {
  if(!d) return '날짜 미정';
  const dt = new Date(d + 'T00:00:00');
  const w = ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()] || '';
  return `${d} (${w})`;
};
const timeLabel = (s, e) => (s || e) ? `${s || ''}${e ? '–' + e : ''}` : '';

/* 연사 이름 — 스냅숏을 쓴다. 연락처가 지워져도 프로그램에서 이름이 사라지면
   안 되고, 연사명은 발표 당시 소속·직함과 함께 굳는 값이다. */
const speakerName = (id) => {
  const sp = getSpeakerById(id);
  return sp ? (sp.name_snapshot || '(이름 없음)') : '(삭제된 연사)';
};

/* ══════════════════════════════════════════
   렌더
══════════════════════════════════════════ */
export function renderConf(){
  const body = document.getElementById('conf-body');
  const ttl = document.getElementById('conf-ttl');
  if(!body) return;

  const ev = EVENT_LIST.find(e => e.key === confEvent);
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

  const segs = [['pga', 'Program at a Glance'], ['program', 'Program'], ['people', 'Speakers']];
  const seg = `<div class="seg" style="margin:0 0 12px">
    ${segs.map(([k, l]) => `<button class="seg-b${confView === k ? ' on' : ''}" onclick="setConfView('${k}')">${l}</button>`).join('')}
  </div>`;

  const banner = confLocked() ? `<div style="display:flex;align-items:center;gap:9px;margin:0 0 12px;
      padding:9px 12px;background:var(--i8);border:1px solid var(--i6);border-radius:8px;font-size:11.5px;color:var(--i5)">
      🔒 끝난 컨퍼런스라 열람만 됩니다. 고치려면 <b>설정 › 행사 관리 › 진행 파트</b>에서 진행 중으로 되돌리세요.
    </div>` : '';

  const inner = confView === 'people' ? peopleHtml(ev)
    : confView === 'pga' ? pgaHtml(ev)
    : programHtml(ev);
  body.innerHTML = `<div style="padding:14px 16px 40px">${seg}${banner}`
    + (confLocked() ? `<div class="ro">${inner}</div>` : inner) + `</div>`;
}

const emptyBox = (msg) => `<div style="padding:40px 16px">
  <div style="max-width:560px;margin:0 auto;padding:20px;background:var(--i8);
    border:1px solid var(--i6);border-radius:10px;font-size:12.5px;color:var(--i5);line-height:1.7">${msg}</div></div>`;

/* ══════════════════════════════════════════
   프로그램 — 일자 → 세션 → 배정
══════════════════════════════════════════ */
function programHtml(ev){
  const cfg = confCfg(ev.key);
  const days = confDays(ev.key);
  const sessions = sessionsForEvent(ev.key);

  /* 설정에 없는 날짜에 세션이 있으면 그 날도 보여준다 — 설정을 고친 뒤에도
     이미 만든 세션이 화면에서 사라지지 않게. */
  const extra = [...new Set(sessions.map(s => s.date).filter(d => d && !days.includes(d)))];
  const allDays = [...days, ...extra].sort();
  const noDate = sessions.filter(s => !s.date);

  const totalAssigned = sessions.reduce((n, s) => n + assignmentsOfSession(s.id).length, 0);

  const head = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
    <div style="font-size:11.5px;color:var(--i5)">
      세션 <b>${sessions.length}</b>건 · 배정 <b>${totalAssigned}</b>건 · 연사 <b>${speakersForEvent(ev.key).length}</b>명
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      ${importBtns()}
      <button class="btn" style="font-size:11px" onclick="toggleNewSession()">${confNewSession ? '닫기' : '+ 세션 만들기'}</button>
    </div>
  </div>`;

  const form = confNewSession ? newSessionHtml(ev, allDays, cfg) : '';

  if(!sessions.length){
    return head + form + `<div style="padding:22px;background:var(--i8);border:1px solid var(--i6);
      border-radius:10px;font-size:12px;color:var(--i5);line-height:1.7">
      아직 세션이 없어요. 세션을 만들고 사람을 배정해 역할을 정하면,
      역할에 따라 <b>무엇을 받아야 하는지</b>가 «연사» 화면에서 자동으로 잡혀요.
      ${days.length ? '' : '<br>발표 일자가 없네요 — 설정 › 행사 관리 › 컨퍼런스에서 일자를 먼저 정하면 고르기 쉬워요.'}
      <br><br>엑셀로 짜 둔 프로그램이 있으면 위의 <b>양식 받기</b>로 받아 채운 뒤 <b>엑셀 올리기</b>로 한 번에 넣으세요.
    </div>`;
  }

  const dayBlock = (d, list) => `<div style="margin-bottom:18px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
      <div style="font-size:12px;font-weight:600">${escapeHtml(dayLabel(d))}</div>
      <div style="font-size:10.5px;color:var(--i4)">세션 ${list.length}</div>
    </div>
    ${list.length ? list.map(s => sessionCard(ev, s, allDays, cfg)).join('')
      : `<div style="font-size:11px;color:var(--i4);padding:8px 2px">이 날은 세션이 없어요</div>`}
  </div>`;

  return head + form
    + allDays.map(d => dayBlock(d, sessions.filter(s => s.date === d))).join('')
    + (noDate.length ? dayBlock('', noDate) : '');
}

function newSessionHtml(ev, days, cfg){
  const slots = cfg.slots || [];
  const tracks = trackOptions(ev.key);
  const roomList = roomOptions(ev.key);
  return `<div style="margin-bottom:16px;padding:12px;background:var(--i8);border:1px solid var(--i6);border-radius:10px">
    <div style="font-size:11px;font-weight:600;margin-bottom:8px">세션 만들기</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">
      <div><div class="fl">일자</div>
        <select class="fi" id="ns-date">
          <option value="">미정</option>
          ${days.map(d => `<option value="${escAttr(d)}">${escapeHtml(d)}</option>`).join('')}
        </select></div>
      <div><div class="fl">시간대</div>
        <select class="fi" id="ns-slot" onchange="fillSessionSlot(this.value)">
          <option value="">직접 입력</option>
          ${slots.map((s, i) => `<option value="${i}">${escapeHtml(`${s.start}–${s.end}${s.label ? ' ' + s.label : ''}`)}</option>`).join('')}
        </select></div>
      <div><div class="fl">시작</div><input class="fi" id="ns-start" type="time"></div>
      <div><div class="fl">종료</div><input class="fi" id="ns-end" type="time"></div>
      <div><div class="fl">트랙</div>
        ${tracks.length
          ? `<select class="fi" id="ns-track"><option value="">없음</option>
              ${tracks.map(t => `<option value="${escAttr(t)}">${escapeHtml(t)}</option>`).join('')}</select>`
          : `<input class="fi" id="ns-track" placeholder="트랙">`}</div>
      <div><div class="fl">장소</div>
        ${roomList.length
          ? `<select class="fi" id="ns-room"><option value="">없음</option>
              ${roomList.map(r => `<option value="${escAttr(r)}">${escapeHtml(r)}</option>`).join('')}</select>`
          : `<input class="fi" id="ns-room" placeholder="회의실">`}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
      <div><div class="fl">세션명 (국문)</div><input class="fi" id="ns-ko" placeholder="세션명"></div>
      <div><div class="fl">세션명 (영문)</div><input class="fi" id="ns-en" placeholder="Session title"></div>
    </div>
    <div style="margin-top:9px;display:flex;gap:7px;align-items:center">
      <button class="btn bp" style="font-size:11px" onclick="addConfSession()">만들기</button>
      <span style="font-size:10.5px;color:var(--i4)">시간대를 고르면 시작·종료가 채워져요</span>
    </div>
  </div>`;
}

function sessionCard(ev, s, days, cfg){
  /* 순서는 seq 하나로 정한다(assignmentsOfSession이 seq로 세운다).
     전에는 시간이 있으면 시간 순으로 세웠는데, 그러면 사람이 끌어다 옮겨도
     시간이 도로 끌고 가 버린다 — 순서를 정하는 주인이 둘일 수는 없다.
     시간이 순서와 어긋나면 아래에서 경고로 알린다. */
  const asg = assignmentsOfSession(s.id);
  const open = confOpenSession === s.id;
  const editing = confEditSession === s.id;
  const meta = [timeLabel(s.start_at, s.end_at), s.track, s.room].filter(Boolean).join(' · ');

  /* 발표 시간이 세션 밖으로 나가면 알려 준다. 막지는 않는다 — 세션 시간을
     아직 안 고쳤을 수도 있고, 막으면 둘 중 무엇을 먼저 고쳐야 하는지
     사람이 판단할 수가 없다. */
  const outOfSession = (a) => {
    if(!a.start_at || !s.start_at || !s.end_at) return '';
    if(a.start_at < s.start_at) return '세션 시작보다 이릅니다';
    if((a.end_at || a.start_at) > s.end_at) return '세션 종료보다 늦습니다';
    return '';
  };

  const asgRow = (a, idx) => {
    const needsTalk = speakerNeedList(ev.key, a.role).some(n => n.key === 'title');
    const warn = outOfSession(a);
    /* 앞 사람이 끝나기 전에 시작하면 겹친다 — 같은 무대에 둘이 설 수는 없다 */
    const prev = idx > 0 ? asg[idx - 1] : null;
    const overlap = prev && prev.end_at && a.start_at && a.start_at < prev.end_at;
    /* 순서는 끌어서 정하고 시간은 따로 적으니 둘이 어긋날 수 있다.
       어느 쪽이 맞는지는 우리가 모른다 — 어긋났다는 사실만 알린다. */
    const outOfOrder = !overlap && prev && prev.start_at && a.start_at && a.start_at < prev.start_at;
    return `<div class="asg-row" style="padding:6px 0;border-top:1px solid var(--i6)"
      draggable="true" ondragstart="onAsgDragStart(event,'${escAttr(a.id)}')" ondragend="onAsgDragEnd()"
      ondragover="onAsgDragOver(event,this)" ondragleave="onAsgDragLeave(this)"
      ondrop="onAsgDrop(event,'${escAttr(a.id)}',this)">
      <div style="display:flex;align-items:center;gap:8px">
      <span style="cursor:grab;color:var(--i5);font-size:12px;line-height:1;user-select:none"
        title="끌어서 순서를 바꿉니다">⠿</span>
      ${roleChip(a.role)}
      <div style="flex:1;min-width:0">
        <div><span onclick="openSpeakerDr('${escAttr(a.speaker_id)}')" style="font-size:12px;cursor:pointer;color:var(--a)">${escapeHtml(speakerName(a.speaker_id))}</span>
          ${a.start_at ? `<span style="font-size:10.5px;color:var(--i3);margin-left:6px">${
            escapeHtml(timeLabel(a.start_at, a.end_at))}</span>` : ''}</div>
        ${needsTalk
          ? `<div style="font-size:10.5px;color:${a.title_ko || a.title_en ? 'var(--i5)' : 'var(--i4)'}">
              ${escapeHtml(a.title_ko || a.title_en || '발제명 아직 없음')}</div>`
          : ''}
      </div>
      <select class="fi" style="width:82px;font-size:10.5px;padding:3px 5px"
        onchange="setAssignRole('${escAttr(a.id)}',this.value)">
        ${SPEAKER_ROLES.map(r => `<option value="${escAttr(r.key)}"${a.role === r.key ? ' selected' : ''}>${escapeHtml(r.label)}</option>`).join('')}
      </select>
      <button class="btn" style="font-size:10.5px" onclick="removeAssign('${escAttr(a.id)}')">해제</button>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:4px;padding-left:2px;flex-wrap:wrap">
        <span style="font-size:10px;color:var(--i4);flex:0 0 auto">발표</span>
        <input class="fi" type="time" style="width:96px;font-size:10.5px;padding:2px 5px"
          value="${escAttr(a.start_at || '')}" onchange="setTalkTime('${escAttr(a.id)}','start_at',this.value)">
        <span style="font-size:10px;color:var(--i4)">–</span>
        <input class="fi" type="time" style="width:96px;font-size:10.5px;padding:2px 5px"
          value="${escAttr(a.end_at || '')}" onchange="setTalkTime('${escAttr(a.id)}','end_at',this.value)">
        <input class="fi" type="text" style="width:58px;font-size:10.5px;padding:2px 5px"
          placeholder="분" value="${escAttr(a.duration_min || '')}"
          onchange="setTalkTime('${escAttr(a.id)}','duration_min',this.value)"
          title="분만 적어 두면 «시간 자동 배분»이 이 길이로 이어 붙입니다">
        ${warn ? `<span style="font-size:10px;color:var(--am)">⚠ ${escapeHtml(warn)}</span>` : ''}
        ${overlap ? `<span style="font-size:10px;color:var(--re)">⚠ 앞 발표와 겹쳐요</span>` : ''}
        ${outOfOrder ? `<span style="font-size:10px;color:var(--am)">⚠ 앞 사람보다 이른 시각이에요 — 순서나 시간 중 하나를 고쳐주세요</span>` : ''}
      </div>
    </div>`;
  };

  return `<div style="border:1px solid var(--i6);border-radius:9px;padding:10px 12px;margin-bottom:8px;background:var(--W)">
    <div style="display:flex;align-items:flex-start;gap:9px">
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:600">${escapeHtml(s.title_ko || s.title_en || '(세션명 없음)')}</div>
        ${s.title_ko && s.title_en ? `<div style="font-size:10.5px;color:var(--i4)">${escapeHtml(s.title_en)}</div>` : ''}
        ${meta ? `<div style="font-size:10.5px;color:var(--i5);margin-top:2px">${escapeHtml(meta)}</div>` : ''}
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        ${asg.length && s.start_at ? `<button class="btn" style="font-size:10.5px"
          onclick="autoTalkTimes('${escAttr(s.id)}')" title="세션 시작부터 각 발표의 «분»만큼 이어 붙입니다">시간 배분</button>` : ''}
        <button class="btn" style="font-size:10.5px" onclick="toggleEditSession('${escAttr(s.id)}')">${editing ? '닫기' : '수정'}</button>
        <button class="btn" style="font-size:10.5px" onclick="toggleAssign('${escAttr(s.id)}')">${open ? '닫기' : `배정 ${asg.length}`}</button>
        <button class="btn" style="font-size:10.5px" onclick="removeConfSession('${escAttr(s.id)}')">삭제</button>
      </div>
    </div>
    ${editing ? editSessionHtml(s, days, cfg) : ''}
    ${asg.length ? `<div style="margin-top:6px">${asg.map((a, i) => asgRow(a, i)).join('')}</div>` : ''}
    ${open ? assignFormHtml(ev, s) : ''}
  </div>`;
}

/* 세션 수정 칸 — 만들 때와 같은 칸을 같은 순서로 둔다. 같은 값을 두 가지
   모양으로 적게 하면 어디를 고쳐야 하는지 매번 다시 찾게 된다.
   칸 id에 세션 id를 붙인다 — 한 화면에 여러 세션의 칸이 동시에 열릴 수 있다. */
/* 트랙·장소 후보 — 설정에 적은 것과 세션들이 실제로 쓰는 것을 합친다.

   전에는 설정만 봤다. 그런데 엑셀로 올린 프로그램은 트랙이 세션에만 있고
   설정에는 없어서, 고르는 목록이 비고 칸이 자유 입력으로 바뀌었다. 그러면
   «임상개발 6»을 한 글자도 틀리지 않게 타이핑해야 하고, 틀리면 새 트랙이
   되어 색이 따로 잡힌다 — 색이 안 붙는 세션이 생긴 경로가 이것이다. */
function trackOptions(evKey, own){
  const set = new Set(confCfg(evKey).tracks || []);
  sessionsForEvent(evKey).forEach(x => { if(x.track) set.add(x.track); });
  if(own) set.add(own);
  return [...set];
}
function roomOptions(evKey, own){
  const set = new Set(confCfg(evKey).rooms || []);
  sessionsForEvent(evKey).forEach(x => { if(x.room) set.add(x.room); });
  if(own) set.add(own);
  return [...set];
}

function editSessionHtml(s, days, cfg){
  const slots = cfg.slots || [];
  const i = (k) => `es-${s.id}-${k}`;
  /* 설정에서 지운 트랙·일자가 이 세션에는 남아 있을 수 있다 — 목록에 없다고
     조용히 «없음»으로 바뀌면 저장하는 순간 값이 날아간다. */
  const trackList = trackOptions(confEvent, s.track);
  const roomList = roomOptions(confEvent, s.room);
  const dayList = s.date && !days.includes(s.date) ? [...days, s.date].sort() : days;

  return `<div style="margin-top:9px;padding:10px;background:var(--i8);border-radius:8px">
    <div style="font-size:11px;font-weight:600;margin-bottom:7px">세션 고치기</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:7px">
      <div><div class="fl">일자</div>
        <select class="fi" id="${i('date')}">
          <option value=""${!s.date ? ' selected' : ''}>미정</option>
          ${dayList.map(d => `<option value="${escAttr(d)}"${s.date === d ? ' selected' : ''}>${escapeHtml(d)}</option>`).join('')}
        </select></div>
      <div><div class="fl">시간대</div>
        <select class="fi" id="${i('slot')}" onchange="fillEditSlot('${escAttr(s.id)}',this.value)">
          <option value="">직접 입력</option>
          ${slots.map((sl, k) => `<option value="${k}">${escapeHtml(`${sl.start}–${sl.end}${sl.label ? ' ' + sl.label : ''}`)}</option>`).join('')}
        </select></div>
      <div><div class="fl">시작</div><input class="fi" id="${i('start')}" type="time" value="${escAttr(s.start_at || '')}"></div>
      <div><div class="fl">종료</div><input class="fi" id="${i('end')}" type="time" value="${escAttr(s.end_at || '')}"></div>
      <div><div class="fl">트랙</div>
        ${trackList.length
          ? `<select class="fi" id="${i('track')}"><option value=""${!s.track ? ' selected' : ''}>없음</option>
              ${trackList.map(t => `<option value="${escAttr(t)}"${s.track === t ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select>`
          : `<input class="fi" id="${i('track')}" value="${escAttr(s.track || '')}" placeholder="트랙">`}</div>
      <div><div class="fl">장소</div>
        ${roomList.length
          ? `<select class="fi" id="${i('room')}"><option value=""${!s.room ? ' selected' : ''}>없음</option>
              ${roomList.map(r => `<option value="${escAttr(r)}"${s.room === r ? ' selected' : ''}>${escapeHtml(r)}</option>`).join('')}</select>`
          : `<input class="fi" id="${i('room')}" value="${escAttr(s.room || '')}" placeholder="회의실">`}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px">
      <div><div class="fl">세션명 (국문)</div><input class="fi" id="${i('ko')}" value="${escAttr(s.title_ko || '')}"></div>
      <div><div class="fl">세션명 (영문)</div><input class="fi" id="${i('en')}" value="${escAttr(s.title_en || '')}"></div>
    </div>
    <div style="margin-top:7px"><div class="fl">메모</div>
      <textarea class="fi" id="${i('note')}" rows="2" style="resize:vertical">${escapeHtml(s.note || '')}</textarea></div>
    <div style="margin-top:8px;display:flex;gap:7px;align-items:center">
      <button class="btn bp" style="font-size:11px" onclick="saveSessionEdit('${escAttr(s.id)}')">저장</button>
      <button class="btn" style="font-size:11px" onclick="toggleEditSession('${escAttr(s.id)}')">취소</button>
      <span id="es-msg-${escAttr(s.id)}" style="font-size:10.5px;color:var(--i4)"></span>
    </div>
  </div>`;
}

/* 배정 칸 — 이미 있는 연사에서 고르거나, 이름을 적어 새로 만든다.
   전시 참가기업 임원이 발표하는 일이 흔하니 이름 적기를 막지 않는다. */
function assignFormHtml(ev, s){
  /* 이미 이 세션에 들어간 사람도 후보에 남긴다 — 한 사람이 좌장이면서
     발표도 하는 일이 있고, 그때 역할이 둘이어야 «받을 것»이 합쳐진다.
     막아야 하는 건 같은 역할의 중복뿐이고 그건 배정할 때 걸러진다. */
  const here = assignmentsOfSession(s.id);
  const pool = speakersForEvent(ev.key)
    .map(sp => ({ sp, roles: here.filter(a => a.speaker_id === sp.id).map(a => a.role) }))
    .sort((a, b) => String(a.sp.name_snapshot || '').localeCompare(String(b.sp.name_snapshot || ''), 'ko'));
  return `<div style="margin-top:9px;padding:10px;background:var(--i8);border-radius:8px">
    <div style="font-size:11px;font-weight:600;margin-bottom:7px">사람 배정</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:7px">
      <div><div class="fl">이 행사의 연사</div>
        <select class="fi" id="as-pick">
          <option value="">새로 적기</option>
          ${pool.map(({ sp, roles }) => `<option value="${escAttr(sp.id)}">${escapeHtml(sp.name_snapshot || sp.id)}${roles.length ? ` (이 세션 ${roles.join('·')})` : ''}</option>`).join('')}
        </select></div>
      <div><div class="fl">이름 (새로 적을 때)</div><input class="fi" id="as-name" placeholder="성명"></div>
      <div><div class="fl">역할</div>
        <select class="fi" id="as-role">
          ${SPEAKER_ROLES.map(r => `<option value="${escAttr(r.key)}">${escapeHtml(r.label)}</option>`).join('')}
        </select></div>
      <div><div class="fl">자리</div>
        <select class="fi" id="as-at">
          <option value="">맨 뒤</option>
          ${here.map((x, k) => `<option value="${k}">${k + 1}번째 — ${escapeHtml(speakerName(x.speaker_id))} 앞</option>`).join('')}
        </select></div>
    </div>
    <div style="margin-top:8px;display:flex;gap:7px;align-items:center">
      <button class="btn bp" style="font-size:11px" onclick="addAssign('${escAttr(s.id)}')">배정</button>
      <span style="font-size:10.5px;color:var(--i4)">역할을 정하면 받을 것이 정해져요</span>
    </div>
  </div>`;
}


/* ══════════════════════════════════════════
   PROGRAM AT A GLANCE — 프로그램표

   프로그램북 앞에 늘 들어가는 한 장이다. 가로는 장소, 세로는 일자와 시간,
   칸은 트랙 색으로 묶인 세션. 참가자는 이 한 장으로 «내가 갈 세션이 언제
   어디서 열리는지»를 정한다.

   우리가 따로 적어 넣는 게 아니라 세션 데이터에서 그대로 만든다 — 프로그램을
   고치고 나서 이 표를 다시 그리는 일을 사람이 하면, 둘은 반드시 어긋난다.
   실제로 프로그램북의 표와 현장 안내가 다른 사고는 거기서 난다.

   장소가 없는 세션(개막식·기조연설처럼 전체가 모이는 것)은 한 줄을 통째로
   쓴다. 첨부한 프로그램북도 개막식을 그렇게 뽑았다.
══════════════════════════════════════════ */

/* 트랙 색은 track-colors.js가 정한다 — 설정 화면과 프로그램표가 같은 값을
   봐야 «설정에서 본 색»과 «표의 색»이 같다. */
const trackColor = (evKey, track) => trackColorOf(confCfg(evKey), track);

/* 올리기 단추 — 표 화면과 프로그램 화면이 같이 쓴다.
   처음 열리는 화면에 없으면 탭을 옮겨야 보이고, 그러면 «어디서 올리지»가
   된다. 실제로 그 말을 들었다. */
function importBtns(){
  return `<span id="conf-import-msg" style="font-size:10.5px;color:var(--i4)"></span>
    <button class="btn" style="font-size:11px" onclick="downloadConfTemplate()"
      title="세션·연사·배정 세 시트로 된 빈 양식을 받습니다">양식 받기</button>
    <button class="btn" style="font-size:11px" onclick="pickConfFile()"
      title="채운 양식을 올립니다 — 기존 것을 지우지 않고 더하거나 고칩니다">엑셀 올리기</button>
    <input type="file" id="conf-xlsx-input" accept=".xlsx,.xls" style="display:none"
      onchange="handleConfFile(event)">`;
}

function pgaHtml(ev){
  const sessions = sessionsForEvent(ev.key);
  if(!sessions.length){
    /* 올리기 단추를 함께 그린다 — 세션이 하나도 없을 때가 곧 엑셀로 한꺼번에
       올리는 때다. 안내에 «위의 양식 받기»라고 적어 놓고 단추가 없으면
       그게 제일 나쁘다. */
    return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <div style="font-size:12.5px;font-weight:700">Program at a Glance</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-left:auto">${importBtns()}</div>
      </div>
      <div style="padding:22px;background:var(--i8);border:1px solid var(--i6);border-radius:10px;
      font-size:12px;color:var(--i5);line-height:1.7">
      세션이 없어요. 위의 <b>양식 받기</b>로 엑셀 양식을 받아 채운 뒤 <b>엑셀 올리기</b>로
      한 번에 넣거나, <b>Program</b> 탭에서 하나씩 만드세요.<br>
      표는 세션의 <b>일자 · 시각 · 장소 · 트랙</b>으로 그려져요 — 장소를 안 적은 세션은
      개막식처럼 한 줄을 통째로 씁니다.</div>`;
  }

  /* 가로축은 장소. 세션에 실제로 적힌 장소만 세운다 — 설정에 있는 방까지
     세우면 쓰지도 않는 빈 칸이 표의 절반을 차지한다. */
  /* 장소 순서는 설정에 적은 순서를 그대로 쓴다 — 어디가 메인 공간인지는
     이름에서 나오지 않는다(코사이어티는 HALL C가 메인이고 B가 서브다).
     설정에 없는 장소는 뒤에 붙이되 이름순으로 세운다. 숫자를 숫자로 읽어야
     «10호»가 «9호» 뒤에 온다. */
  const used = [...new Set(sessions.map(x => x.room).filter(Boolean))];
  const order = confCfg(ev.key).rooms || [];
  const rooms = [
    ...order.filter(r => used.includes(r)),
    ...used.filter(r => !order.includes(r))
      .sort((a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true })),
  ];
  const days = [...new Set(sessions.map(x => x.date || ''))].sort();
  const noRoomOnly = !rooms.length;

  const cell = (ss) => {
    const c = trackColor(ev.key, ss.track);
    return `<div onclick="openPgaSession('${escAttr(ss.id)}')" title="${escAttr(
        [ss.title_ko, ss.title_en, timeLabel(ss.start_at, ss.end_at), ss.room].filter(Boolean).join(' · '))}"
      style="cursor:pointer;border:1px solid ${c.bd}33;border-radius:4px;overflow:hidden;margin-bottom:5px">
      ${ss.track ? `<div style="background:${c.bg};border-left:3px solid ${c.bd};padding:3px 6px;
        font-size:10.5px;font-weight:700;color:var(--i1)">${escapeHtml(ss.track)}</div>` : ''}
      <div style="padding:6px 7px 8px;background:var(--W);overflow-wrap:anywhere">
        <div style="font-size:11px;line-height:1.45;color:var(--i1)">${escapeHtml(ss.title_ko || ss.title_en || '(세션명 없음)')}</div>
        ${ss.title_ko && ss.title_en ? `<div style="font-size:9.5px;color:var(--i4);line-height:1.4;margin-top:2px">${escapeHtml(ss.title_en)}</div>` : ''}
        ${(() => {
          const asg = assignmentsOfSession(ss.id);
          /* 한 사람이 좌장이면서 발표도 하면 배정이 둘이다 — 이름은 한 번만 */
          const names = [...new Set(asg.map(a => speakerName(a.speaker_id)))];
          return names.length ? `<div style="font-size:9.5px;color:var(--i4);margin-top:4px">${
            escapeHtml(names.slice(0, 3).join(', '))}${
            names.length > 3 ? ` 외 ${names.length - 3}` : ''}</div>` : '';
        })()}
      </div>
    </div>`;
  };

  /* 한 줄을 통째로 쓰는 세션 — 장소를 안 적은 것. 개막식·오찬처럼 전체가
     한자리에 모이는 일들이다. */
  const wideCell = (ss) => {
    const c = trackColor(ev.key, ss.track);
    return `<div onclick="openPgaSession('${escAttr(ss.id)}')" title="${escAttr(ss.title_en || '')}"
      style="cursor:pointer;background:${ss.track ? c.bg : 'var(--i8)'};border:1px solid ${ss.track ? c.bd + '55' : 'var(--i6)'};
      border-radius:4px;padding:9px;text-align:center;margin-bottom:5px">
      <div style="font-size:11.5px;font-weight:600">${escapeHtml(ss.title_ko || ss.title_en || '(세션명 없음)')}</div>
      ${ss.title_en && ss.title_ko ? `<div style="font-size:9.5px;color:var(--i4);margin-top:2px">${escapeHtml(ss.title_en)}</div>` : ''}
    </div>`;
  };

  const dayBlock = (d) => {
    const mine = sessions.filter(x => (x.date || '') === d);
    /* 세로는 시간대. 같은 시각에 시작하는 것이 한 줄이 된다 —
       시각을 안 적은 세션은 맨 아래에 «시간 미정» 줄로 모은다. */
    const slots = [...new Set(mine.map(x => x.start_at || ''))]
      .sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b));

    const rowFor = (slot) => {
      const here = mine.filter(x => (x.start_at || '') === slot);
      const wide = here.filter(x => !x.room);
      const placed = here.filter(x => x.room);
      const timeCol = `<td style="vertical-align:top;padding:7px 8px;font-size:10.5px;color:var(--i3);
        white-space:nowrap;border-top:1px solid var(--i6)">${slot ? escapeHtml(timeLabel(slot,
          // 그 시간대에서 가장 늦게 끝나는 것으로 폭을 적는다
          here.map(x => x.end_at).filter(Boolean).sort().slice(-1)[0] || ''))
          : '<span style="color:var(--i4)">시간 미정</span>'}</td>`;
      const wideRow = wide.length
        ? `<tr>${timeCol}<td colspan="${Math.max(1, rooms.length)}" style="padding:7px 8px;border-top:1px solid var(--i6)">
            ${wide.map(wideCell).join('')}</td></tr>`
        : '';
      const placedRow = placed.length || !wide.length
        ? `<tr>${wide.length ? `<td style="border-top:1px solid var(--i6)"></td>` : timeCol}
            ${(rooms.length ? rooms : ['']).map(rm => `<td style="vertical-align:top;padding:7px 8px;
              border-top:1px solid var(--i6);border-left:1px solid var(--i7)">
              ${placed.filter(x => (x.room || '') === rm).map(cell).join('') || ''}</td>`).join('')}
          </tr>`
        : '';
      return wideRow + placedRow;
    };

    return `<tr><td colspan="${rooms.length + 1}" style="padding:9px 8px 3px;background:var(--i8);
        border-top:1px solid var(--i6);font-size:11.5px;font-weight:700">
        ${escapeHtml(d ? dayLabel(d) : '날짜 미정')}
        <span style="font-weight:400;color:var(--i4);margin-left:6px">세션 ${mine.length}</span></td></tr>`
      + slots.map(rowFor).join('');
  };

  /* ── 모바일 ──
     가로가 장소인 표는 좁은 화면에 들어가지 않는다. 옆으로 밀면 시간 열이
     사라져 «몇 시 것인지»를 잃는다. 그래서 시간 순 목록으로 바꾼다 —
     장소는 각 줄에 적어 둔다. 표가 하려던 일(언제·어디서·무엇을)은 남는다. */
  if(isMobile()){
    const line = (ss) => {
      const c = trackColor(ev.key, ss.track);
      const asg = assignmentsOfSession(ss.id);
      return `<div onclick="openPgaSession('${escAttr(ss.id)}')"
        style="cursor:pointer;background:var(--W);border:1px solid var(--i6);border-left:3px solid ${
          ss.track ? c.bd : 'var(--i5)'};border-radius:8px;padding:9px 11px;margin-bottom:7px">
        <div style="display:flex;gap:7px;align-items:baseline;flex-wrap:wrap">
          <span style="font-size:11px;color:var(--i3);white-space:nowrap">${escapeHtml(timeLabel(ss.start_at, ss.end_at) || '시간 미정')}</span>
          ${ss.room ? `<span class="pill p-gray" style="font-size:9px">${escapeHtml(ss.room)}</span>` : ''}
          ${ss.track ? `<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:${c.bg}">${escapeHtml(ss.track)}</span>` : ''}
        </div>
        <div style="font-size:12.5px;font-weight:600;margin-top:4px;line-height:1.45">${escapeHtml(ss.title_ko || ss.title_en || '(세션명 없음)')}</div>
        ${ss.title_ko && ss.title_en ? `<div style="font-size:10px;color:var(--i4);line-height:1.4">${escapeHtml(ss.title_en)}</div>` : ''}
        ${(() => {
          const names = [...new Set(asg.map(a => speakerName(a.speaker_id)))];
          return names.length ? `<div style="font-size:10.5px;color:var(--i4);margin-top:4px">${
            escapeHtml(names.slice(0, 3).join(', '))}${
            names.length > 3 ? ` 외 ${names.length - 3}` : ''}</div>` : '';
        })()}
      </div>`;
    };
    const byDay = (d) => {
      const mine = sessions.filter(x => (x.date || '') === d)
        .slice()
        .sort((a, b) => String(a.start_at || '').localeCompare(String(b.start_at || ''))
          || String(a.room || '').localeCompare(String(b.room || ''), 'ko', { numeric: true }));
      return `<div style="font-size:12px;font-weight:700;margin:12px 0 6px">${escapeHtml(d ? dayLabel(d) : '날짜 미정')}
          <span style="font-weight:400;color:var(--i4)">세션 ${mine.length}</span></div>
        ${mine.map(line).join('')}`;
    };
    return `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <div style="font-size:12.5px;font-weight:700">Program at a Glance</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-left:auto">${importBtns()}</div>
      </div>
      <div style="font-size:10px;color:var(--i4);margin-bottom:2px">좁은 화면에서는 시간 순 목록으로 보여드려요</div>
      ${days.map(byDay).join('')}`;
  }

  /* 트랙 범례 — 색만 보고는 무슨 트랙인지 모른다 */
  const usedTracks = [...new Set(sessions.map(x => x.track).filter(Boolean))];
  /* 트랙이 빈 세션은 색이 안 붙는다. 개막식처럼 장소가 없는 것은 원래
     그렇지만, 장소가 있는데 트랙만 빈 세션은 대개 빠뜨린 것이다 —
     색을 찾기 전에 왜 없는지를 알 수 있게 세어 둔다. */
  const noTrack = sessions.filter(x => x.room && !x.track);
  const legend = usedTracks.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
    ${usedTracks.map(t => {
      const c = trackColor(ev.key, t);
      return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:10.5px;color:var(--i3)">
        <span style="width:11px;height:11px;border-radius:3px;background:${c.bg};border-left:3px solid ${c.bd}"></span>
        ${escapeHtml(t)}</span>`;
    }).join('')}
    ${noTrack.length ? `<span style="font-size:10.5px;color:var(--am)"
      title="${escAttr(noTrack.map(x => x.title_ko || x.title_en || x.id).join('\n'))}">
      트랙 없는 세션 ${noTrack.length}개 — 색이 안 붙어요</span>` : ''}
  </div>` : '';

  const hint = noRoomOnly ? `<div style="font-size:10.5px;color:var(--i4);margin-bottom:8px;line-height:1.6">
    장소를 적은 세션이 없어 한 칸으로 그렸어요 — 세션에 «장소»를 넣으면 방별로 나뉩니다.</div>` : '';

  return `<div style="display:flex;align-items:center;gap:9px;margin-bottom:8px;flex-wrap:wrap">
      <div style="font-size:12.5px;font-weight:700">Program at a Glance</div>
      <div style="font-size:10.5px;color:var(--i4)">세션 ${sessions.length} · ${days.length}일${
        rooms.length ? ` · ${rooms.length}개 장소` : ''}</div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-left:auto">
        ${importBtns()}
        <button class="btn" style="font-size:11px" onclick="copyPga()"
          title="표를 그대로 복사해 프로그램북·메일에 붙여 넣습니다">표 복사</button>
      </div>
    </div>
    ${legend}${hint}
    <div class="tw" id="pga-table"><table style="width:100%;border-collapse:collapse;table-layout:fixed">
      <colgroup>
        <col style="width:82px">
        ${(rooms.length ? rooms : ['전체']).map(() =>
          `<col style="width:${(100 / Math.max(1, rooms.length || 1)).toFixed(4)}%">`).join('')}
      </colgroup>
      <thead><tr>
        <th style="text-align:left;font-size:10px">시간</th>
        ${(rooms.length ? rooms : ['전체']).map(rm => `<th style="text-align:center;font-size:10.5px;
          border-left:1px solid var(--i7)">${escapeHtml(rm)}</th>`).join('')}
      </tr></thead>
      <tbody>${days.map(dayBlock).join('')}</tbody>
    </table></div>
    <div style="font-size:10px;color:var(--i4);margin-top:7px;line-height:1.6">
      칸을 누르면 그 세션의 수정 칸이 열려요. 장소를 안 적은 세션은 개막식처럼 한 줄을 통째로 씁니다.
    </div>`;
}

/* 표에서 세션을 누르면 프로그램으로 건너가 그 세션을 연다 —
   여기서 바로 고치게 하면 같은 수정 칸이 두 군데 생긴다. */
export function openPgaSession(sid){
  confView = 'program';
  confEditSession = sid;
  renderConf();
  setTimeout(() => {
    document.getElementById(`es-${sid}-ko`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 60);
}

/* 활동 로그에서 건너올 때 — 다른 행사의 세션일 수 있으니 행사부터 맞춘다.
   setConfEvent이 열린 수정 칸을 닫으므로 반드시 먼저 부른다. */
export function openAuditSession(sid, ev){
  if(ev && ev !== confEvent) setConfEvent(ev);
  openPgaSession(sid);
}

/* 표를 그대로 복사한다 — 프로그램북 원고와 메일이 이 표를 그대로 쓴다.
   서식 있는 복사(text/html)와 글자 복사를 함께 담아, 붙여 넣는 곳이
   무엇이든 형태가 남게 한다. */
export async function copyPga(){
  const el = document.getElementById('pga-table');
  if(!el) return;
  const html = el.innerHTML;
  const text = [...el.querySelectorAll('tr')]
    .map(tr => [...tr.children].map(td => td.innerText.replace(/\s*\n\s*/g, ' ').trim()).join('\t'))
    .join('\n');
  try {
    if(navigator.clipboard && window.ClipboardItem){
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    alert('표를 복사했어요. 문서나 메일에 붙여 넣으세요.');
  } catch(e){
    alert(`복사하지 못했어요 (${e.message}).\n표를 끌어서 직접 선택해 복사해주세요.`);
  }
}

/* ══════════════════════════════════════════
   연사 — 전시 진행관리와 같은 방식으로 본다

   전시에서 51개 기업의 준비 상황을 한 표로 보는 이유가 여기도 그대로다.
   연사가 스무 명이면 «누구에게 무엇이 안 왔나»를 사람마다 열어 볼 수 없다.
   한 줄에 한 사람, 한 칸에 한 항목을 놓고, 칸의 색과 기호로 상태를 읽는다.

   전시와 다른 점이 하나 있다. 전시는 모든 기업이 같은 단계를 밟지만 연사는
   역할마다 받을 것이 다르다 — 좌장에게 초록은 «안 온 것»이 아니라 «묻지 않은
   것»이다. 그래서 묻지 않는 칸은 빈칸(·)으로 두고 분모에서도 뺀다.
   그러지 않으면 좌장은 영원히 진행률 70%에 머문다.
══════════════════════════════════════════ */

/* 표에 세울 항목 — 받을 것 중에서 «칸으로 볼 수 있는 것»만 고른다.
   순서는 실제로 받는 순서를 따랐다(사람 정보 → 발제 → 서류). */
const SP_COLS = [
  { key: 'profile',  label: '소속·직함' },
  { key: 'bio_pro',  label: '이력' },
  { key: 'photo',    label: '사진' },
  { key: 'title',    label: '발제명' },
  { key: 'abstract', label: '초록' },
  { key: 'slides',   label: '발표자료' },
  { key: 'consent',  label: '동의서' },
  { key: 'bank',     label: '계좌' },
  { key: 'passport', label: '여권' },
  { key: 'travel',   label: '숙박·항공' },
];

/* 이 사람의 이 항목이 어떤 상태인가.
   'na'  — 역할이 묻지 않는다(분모에서 뺀다)
   'done'— 받았다      'part' — 일부만    'todo' — 아직
   text는 칸 아래 작게 붙는 값(받은 날짜 등) */
function spCell(sp, evKey, key){
  const roles = rolesOfSpeaker(sp.id);
  const asg = assignmentsFor(sp.id);
  /* 역할이 여럿이면 센 쪽을 따른다 — 좌장이자 발표자면 발제도 받아야 한다 */
  let need = '';
  roles.forEach(r => {
    const v = speakerNeed(evKey, r, key);
    if(v === 'req') need = 'req';
    else if(v === 'opt' && need !== 'req') need = 'opt';
  });
  if(!need) return { state: 'na' };

  const done = (v, text) => ({ state: v ? 'done' : 'todo', text: v ? (text || v) : '', need });

  switch(key){
    case 'profile': {
      const has = sp.org_ko || sp.org_en;
      return { state: has ? 'done' : 'todo', text: has ? (sp.org_ko || sp.org_en) : '', need };
    }
    case 'bio_pro':  return done(sp.profile_received_at);
    case 'photo':    return done(sp.photo_received_at);
    case 'consent':  return done(sp.consent_at);
    case 'bank':
      /* 줄 돈이 없으면 계좌를 묻지 않는다 — 무보수 연사에게 계좌를 요구할
         이유가 없고, 요구한 적 없는 걸 «안 받았다»고 세면 안 된다. */
      if(!sp.fee_amount) return { state: 'na' };
      return done(sp.bank_account, sp.bank_account ? '받음' : '');
    case 'passport': return done(sp.passport_received_at);
    case 'travel': {
      /* 챙기기로 한 것만 센다. 숙박·항공 중 적어 둔 게 없으면 아직 정해지지
         않은 것이라 «안 한 일»로 몰지 않는다. */
      const items = [];
      if(sp.stay_hotel) items.push(sp.stay_booked === 'yes');
      if(sp.air_route) items.push(!!sp.air_ticketed_at);
      if(!items.length) return { state: 'todo', text: '', need };
      const n = items.filter(Boolean).length;
      return { state: n === items.length ? 'done' : n ? 'part' : 'todo',
        text: `${n}/${items.length}`, need };
    }
    /* 발제 셋은 배정 줄마다 따로 있다 — 두 세션에서 발표하면 초록도 둘이다.
       그 역할이 묻는 배정만 센다(좌장 배정은 빼고 연사 배정만). */
    case 'title': case 'abstract': case 'slides': {
      const live = asg.filter(a => speakerNeed(evKey, a.role, key));
      if(!live.length) return { state: 'na' };
      const got = live.filter(a =>
        key === 'title' ? (a.title_ko || a.title_en)
        : key === 'abstract' ? a.abstract_received_at
        : a.slides_received_at);
      return { state: got.length === live.length ? 'done' : got.length ? 'part' : 'todo',
        text: live.length > 1 ? `${got.length}/${live.length}` : '', need };
    }
  }
  return { state: 'na' };
}

/* 진행률 — 묻는 것만 분모에 넣는다 */
function spProgress(sp, evKey){
  const cells = SP_COLS.map(c => spCell(sp, evKey, c.key)).filter(c => c.state !== 'na');
  if(!cells.length) return { pct: 0, n: 0, of: 0 };
  const n = cells.filter(c => c.state === 'done').length;
  return { pct: Math.round(n / cells.length * 100), n, of: cells.length };
}

/* 칸 하나 — 전시 표와 같은 기호를 쓴다. 두 화면을 오가며 보는 사람이
   기호를 두 번 배우지 않게. */
function spCellHtml(c, colLabel, name){
  const map = {
    done: { bg: 'var(--gb)', fg: 'var(--g)',  mark: '✓' },
    part: { bg: 'var(--ab)', fg: 'var(--am)', mark: '◐' },
    todo: { bg: 'transparent', fg: 'var(--i5)', mark: '—' },
    na:   { bg: 'transparent', fg: 'var(--i6)', mark: '·' },
  }[c.state];
  const tip = c.state === 'na'
    ? `${name}의 역할은 ${colLabel}을(를) 받지 않아요`
    : c.state === 'done' ? `${colLabel} 받음${c.text ? ` (${c.text})` : ''}`
    : c.state === 'part' ? `${colLabel} 일부만 (${c.text})`
    : `${colLabel} 아직${c.need === 'opt' ? ' — 있으면 좋음' : ''}`;
  return `<td style="text-align:center;padding:5px 3px" title="${escAttr(tip)}">
    <div style="display:inline-flex;flex-direction:column;align-items:center;gap:1px;min-width:40px;
      padding:3px 4px;border-radius:5px;background:${map.bg}">
      <span style="font-size:12px;font-weight:800;color:${map.fg};line-height:1">${map.mark}</span>
      ${c.text ? `<span style="font-size:9px;color:${map.fg};line-height:1.1">${escapeHtml(shortCell(c.text))}</span>` : ''}
    </div></td>`;
}

/* 항목별 집계 — «묻는 사람» 중 몇 명이 냈나 */
function spTally(list, evKey, key){
  const live = list.map(sp => spCell(sp, evKey, key)).filter(c => c.state !== 'na');
  return { n: live.filter(c => c.state === 'done').length, of: live.length };
}

export function setConfNeedFil(key){
  /* 전시의 단계 칩과 같은 순환 — 완료만 → 미완료만 → 전체 */
  if(!confNeedFil || confNeedFil.key !== key) confNeedFil = { key, mode: 'done' };
  else if(confNeedFil.mode === 'done') confNeedFil = { key, mode: 'todo' };
  else confNeedFil = null;
  renderConf();
}
export function setConfSessFil(id){
  confSessFil = confSessFil === id ? '' : id;
  renderConf();
}
export function setConfRoleFil(role){
  confRoleFil = confRoleFil === role ? '' : role;
  renderConf();
}

function peopleHtml(ev){
  const all = speakersForEvent(ev.key);
  if(!all.length){
    return `<div style="padding:22px;background:var(--i8);border:1px solid var(--i6);border-radius:10px;
      font-size:12px;color:var(--i5);line-height:1.7">
      아직 연사가 없어요. «프로그램»에서 세션을 만들고 사람을 배정하면 여기 쌓여요.</div>`;
  }

  let list = all.slice().sort((a, b) =>
    String(a.name_snapshot || '').localeCompare(String(b.name_snapshot || ''), 'ko'));
  if(confRoleFil) list = list.filter(sp => rolesOfSpeaker(sp.id).includes(confRoleFil));
  /* '__none__'은 «배정 없음» — 세션에 안 들어간 사람이 남아 있는지 보려는
     것이라 세션 하나를 고른 것과 성격이 같다. */
  if(confSessFil === '__none__') list = list.filter(sp => !assignmentsFor(sp.id).length);
  else if(confSessFil.startsWith('t:')){
    /* 트랙 칩 — 그 트랙의 세션 아무 곳에나 들어가 있으면 남는다 */
    const t = confSessFil.slice(2);
    const ids = new Set(sessionsForEvent(ev.key).filter(x => (x.track || '') === t).map(x => x.id));
    list = list.filter(sp => assignmentsFor(sp.id).some(a => ids.has(a.session_id)));
  }
  else if(confSessFil) list = list.filter(sp =>
    assignmentsFor(sp.id).some(a => a.session_id === confSessFil));
  if(confNeedFil){
    list = list.filter(sp => {
      const c = spCell(sp, ev.key, confNeedFil.key);
      if(c.state === 'na') return false;
      return confNeedFil.mode === 'done' ? c.state === 'done' : c.state !== 'done';
    });
  }

  /* ── 위쪽 요약 — 전시의 카드 줄과 같은 자리 ── */
  const byStatus = (v) => all.filter(sp => (sp.status || '섭외중') === v).length;
  const noSession = all.filter(sp => !assignmentsFor(sp.id).length).length;
  const avg = all.length
    ? Math.round(all.reduce((n, sp) => n + spProgress(sp, ev.key).pct, 0) / all.length) : 0;
  const feeLeft = all.filter(sp => sp.fee_amount && !sp.fee_paid_at).length;

  const card = (label, value, sub) => `<div style="min-width:96px">
    <div style="font-size:10px;color:var(--i4);margin-bottom:2px">${escapeHtml(label)}</div>
    <div style="font-size:18px;font-weight:800;line-height:1.1">${value}</div>
    ${sub ? `<div style="font-size:10px;color:var(--i4);margin-top:2px">${sub}</div>` : ''}
  </div>`;

  const summary = `<div style="display:flex;flex-wrap:wrap;gap:${isMobile() ? '14px 22px' : '20px'};padding:12px 14px;margin-bottom:10px;
      background:var(--i8);border:1px solid var(--i6);border-radius:10px">
    ${card('연사', `${all.length}<span style="font-size:11px;font-weight:600;color:var(--i4)">명</span>`,
      `확정 ${byStatus('확정')} · 섭외중 ${byStatus('섭외중')}`)}
    ${card('평균 진행률', `${avg}<span style="font-size:11px;font-weight:600;color:var(--i4)">%</span>`,
      '역할이 묻는 항목만 셈')}
    ${card('세션', `${sessionsForEvent(ev.key).length}<span style="font-size:11px;font-weight:600;color:var(--i4)">개</span>`,
      noSession ? `<span style="color:var(--am)">배정 없는 연사 ${noSession}</span>` : '모두 배정됨')}
    ${feeLeft ? card('연사료', `${feeLeft}<span style="font-size:11px;font-weight:600;color:var(--i4)">명</span>`, '아직 미지급') : ''}
  </div>`;

  /* ── 세션 칩 ──
     세션명은 길다. 여덟 개가 늘어서면 칩 줄이 그대로 목록이 되어, 고르는
     자리가 아니라 읽는 자리가 된다 — 좁은 화면에서는 화면 절반을 먹는다.

     그래서 트랙이 있으면 트랙으로 묶는다. «이 트랙 사람들»이 실제로 챙기는
     단위이기도 하고, 색도 프로그램 표와 같은 색을 써서 두 화면이 이어진다.
     트랙이 없는 세션만 제 이름으로 남는다 — 묶을 데가 없으니 숨기면 아예
     고를 수 없게 된다. 세션 하나하나는 툴팁에 일자·시각과 함께 적어 둔다. */
  const sessions = sessionsForEvent(ev.key);
  const noSess = all.filter(sp => !assignmentsFor(sp.id).length).length;
  const headN = (ids) => all.filter(sp => assignmentsFor(sp.id).some(a => ids.has(a.session_id))).length;
  const chipTracks = [...new Set(sessions.map(s => s.track).filter(Boolean))];
  const looseSess = sessions.filter(s => !s.track);
  const sessChips = (sessions.length || noSess) ? `<div class="seg" style="flex-wrap:wrap;margin-bottom:8px">
    <button class="seg-b${!confSessFil ? ' on' : ''}" onclick="setConfSessFil('')">전체 세션</button>
    ${chipTracks.map(t => {
      const ss = sessions.filter(x => x.track === t);
      const key = 't:' + t;
      const c = trackColor(ev.key, t);
      const on = confSessFil === key;
      return `<button class="seg-b${on ? ' on' : ''}"
        onclick="setConfSessFil('${escAttr(key)}')"
        style="max-width:min(100%,260px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap${
          on ? '' : `;background:${c.bg};border-color:${c.bd}55`}"
        title="${escAttr(ss.map(x => [x.date ? x.date.slice(5) : '', x.start_at,
          x.title_ko || x.title_en || x.id].filter(Boolean).join(' ')).join('\n'))}">${
        escapeHtml(t)} <span style="opacity:.6">${ss.length}세션</span> ${
        headN(new Set(ss.map(x => x.id)))}명</button>`;
    }).join('')}
    ${looseSess.map(ss => {
      const n = all.filter(sp => assignmentsFor(sp.id).some(a => a.session_id === ss.id)).length;
      const when = [ss.date ? ss.date.slice(5) : '', ss.start_at].filter(Boolean).join(' ');
      return `<button class="seg-b${confSessFil === ss.id ? ' on' : ''}"
        onclick="setConfSessFil('${escAttr(ss.id)}')"
        style="max-width:min(100%,260px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
        title="${escAttr([ss.title_ko, ss.title_en, ss.room].filter(Boolean).join(' · '))}">${
        escapeHtml(ss.title_ko || ss.title_en || ss.id)}${
        when ? ` <span style="opacity:.6">${escapeHtml(when)}</span>` : ''} ${n}명</button>`;
    }).join('')}
    ${noSess ? `<button class="seg-b${confSessFil === '__none__' ? ' on' : ''}"
      onclick="setConfSessFil('__none__')" title="아직 어느 세션에도 안 들어간 연사예요">배정 없음 ${noSess}명</button>` : ''}
  </div>` : '';

  /* ── 역할 칩 ── */
  const roleChips = `<div class="seg" style="flex-wrap:wrap;margin-bottom:8px">
    <button class="seg-b${!confRoleFil ? ' on' : ''}" onclick="setConfRoleFil('')">전체 ${all.length}명</button>
    ${SPEAKER_ROLES.map(r => {
      const n = all.filter(sp => rolesOfSpeaker(sp.id).includes(r.key)).length;
      return n ? `<button class="seg-b${confRoleFil === r.key ? ' on' : ''}"
        onclick="setConfRoleFil('${escAttr(r.key)}')">${escapeHtml(r.label)} ${n}명</button>` : '';
    }).join('')}
  </div>`;

  /* ── 받을 것 칩 — 전시의 단계 칩과 같은 방식으로 누르면 걸러진다 ── */
  const stats = SP_COLS.map(c => ({ col: c, ...spTally(all, ev.key, c.key) })).filter(x => x.of);
  const needChips = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
    ${stats.map(({ col, n, of }) => {
      const on = confNeedFil && confNeedFil.key === col.key;
      const cls = on ? (confNeedFil.mode === 'done' ? 'p-blue' : 'p-amber')
        : n === of ? 'p-green' : 'p-gray';
      const tip = on ? (confNeedFil.mode === 'done' ? '받은 사람만 보는 중 — 한 번 더 누르면 안 받은 사람만'
        : '안 받은 사람만 보는 중 — 한 번 더 누르면 전체') : '눌러서 받은 사람만 보기';
      return `<button class="pill ${cls}" title="${escAttr(tip)}" style="border:0;cursor:pointer;font:inherit"
        onclick="setConfNeedFil('${escAttr(col.key)}')">${escapeHtml(col.label)} ${
        on ? (confNeedFil.mode === 'done' ? `${n}명` : `${of - n}명`) : `${n}/${of}`}${
        on ? `<span style="margin-left:3px">${confNeedFil.mode === 'done' ? '받음' : '안 받음'} ✕</span>` : ''}</button>`;
    }).join('')}
  </div>`;

  if(!list.length){
    return summary + sessChips + roleChips + needChips
      + `<div style="padding:20px;background:var(--i8);border:1px solid var(--i6);border-radius:10px;
        font-size:12px;color:var(--i5)">이 조건에 맞는 연사가 없어요.</div>`;
  }

  /* ── 모바일 ──
     칸을 열로 늘어놓는 표는 좁은 화면에서 성립하지 않는다. 열 열두 개를
     담으려다 글자가 한 자씩 끊기고, 옆으로 밀려 나간 칸은 아예 못 본다.
     그래서 사람마다 카드 하나로 바꾸고, «아직 안 받은 것»만 딱지로 보여준다 —
     받은 것을 다 보여줄 자리는 없고, 실제로 찾는 것은 남은 쪽이다. */
  if(isMobile()){
    const card = (sp) => {
      const pr = spProgress(sp, ev.key);
      const roles = rolesOfSpeaker(sp.id);
      const left = SP_COLS
        .map(c => ({ c, st: spCell(sp, ev.key, c.key) }))
        .filter(x => x.st.state !== 'na' && x.st.state !== 'done');
      const sess = assignmentsFor(sp.id).map(a => {
        const ss = CONF_SESSIONS.find(x => x.id === a.session_id);
        return ss ? (ss.title_ko || ss.title_en || '') : '';
      }).filter(Boolean);
      return `<div onclick="openSpeakerDr('${escAttr(sp.id)}')"
        style="background:var(--W);border:1px solid var(--i6);border-radius:10px;padding:11px 12px;
        margin-bottom:8px;cursor:pointer">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:700">${escapeHtml(sp.name_snapshot || sp.id)}</span>
          ${roles.map(r => `<span class="pill ${(SPEAKER_ROLES.find(x => x.key === r) || {}).cls || 'p-gray'}"
            style="font-size:9px">${escapeHtml(r)}</span>`).join('')}
          ${sp.lang_pref === 'en' ? '<span class="pill p-gray" style="font-size:9px">EN</span>' : ''}
          ${sp.status && sp.status !== '확정' ? `<span class="pill p-amber" style="font-size:9px">${escapeHtml(sp.status)}</span>` : ''}
        </div>
        ${sp.org_ko || sp.org_en ? `<div style="font-size:11px;color:var(--i4);margin-top:2px">${escapeHtml(
          [sp.org_ko || sp.org_en, sp.title_ko || sp.title_en].filter(Boolean).join(' · '))}</div>` : ''}
        ${sess.length ? `<div style="font-size:11px;color:var(--i3);margin-top:4px;overflow:hidden;
          text-overflow:ellipsis;white-space:nowrap">${escapeHtml(sess[0])}${
          sess.length > 1 ? ` 외 ${sess.length - 1}` : ''}</div>`
          : '<div style="font-size:11px;color:var(--am);margin-top:4px">배정 없음</div>'}
        <div style="display:flex;align-items:center;gap:7px;margin-top:7px">
          <div style="flex:1">${progressBar(pr.pct, pr.pct === 100 ? 'var(--g)' : 'var(--a)')}</div>
          <span style="font-size:10.5px;color:var(--i4);white-space:nowrap">${pr.n}/${pr.of}</span>
        </div>
        ${left.length
          ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:7px">
              ${left.map(({ c, st }) => `<span style="font-size:10px;font-weight:600;padding:3px 7px;
                border-radius:5px;white-space:nowrap;background:${st.state === 'part' ? 'var(--ab)' : 'var(--i8)'};
                color:${st.state === 'part' ? 'var(--am)' : 'var(--i5)'}">${
                st.state === 'part' ? '◐ ' : ''}${escapeHtml(c.label)}${st.text ? ` ${escapeHtml(st.text)}` : ''}</span>`).join('')}
            </div>`
          : `<div style="font-size:10.5px;color:var(--g);margin-top:7px">받을 것을 다 받았어요</div>`}
        ${sp.fee_amount ? `<div style="font-size:10.5px;margin-top:6px;color:${sp.fee_paid_at ? 'var(--g)' : 'var(--am)'}">
          연사료 ${escapeHtml(Number(String(sp.fee_amount).replace(/[^\d.-]/g, '') || 0).toLocaleString('ko-KR'))}
          · ${sp.fee_paid_at ? '지급' : '미지급'}</div>` : ''}
      </div>`;
    };
    return summary + sessChips + roleChips + needChips
      + `<div style="font-size:10px;color:var(--i4);margin-bottom:7px">딱지는 아직 안 받은 것이에요 — 카드를 누르면 그 연사가 열립니다</div>`
      + list.map(card).join('');
  }

  const row = (sp) => {
    const name = sp.name_snapshot || sp.id;
    const roles = rolesOfSpeaker(sp.id);
    const pr = spProgress(sp, ev.key);
    const asg = assignmentsFor(sp.id);
    const sess = asg.map(a => {
      const ss = CONF_SESSIONS.find(x => x.id === a.session_id);
      return ss ? (ss.title_ko || ss.title_en || '') : '';
    }).filter(Boolean);
    const to = contactsOfSpeaker(sp.id).filter(x => x.send === 'to' && x.email);

    return `<tr style="cursor:pointer" onclick="openSpeakerDr('${escAttr(sp.id)}')">
      <td><div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <span style="font-weight:700;font-size:12px">${escapeHtml(name)}</span>
          ${roles.map(r => `<span class="pill ${(SPEAKER_ROLES.find(x => x.key === r) || {}).cls || 'p-gray'}"
            style="font-size:9px">${escapeHtml(r)}</span>`).join('')}
          ${sp.lang_pref === 'en' ? '<span class="pill p-gray" style="font-size:9px" title="영문만 받는 해외 연사예요">EN</span>' : ''}
          ${sp.status && sp.status !== '확정' ? `<span class="pill ${sp.status === '취소' ? 'p-gray' : 'p-amber'}" style="font-size:9px">${escapeHtml(sp.status)}</span>` : ''}
        </div>
        ${sp.org_ko || sp.org_en ? `<div style="font-size:10px;color:var(--i4)">${escapeHtml(
          [sp.org_ko || sp.org_en, sp.title_ko || sp.title_en].filter(Boolean).join(' · '))}</div>` : ''}</td>
      <td style="max-width:170px">
        ${sess.length ? `<div style="font-size:10.5px;color:var(--i3);white-space:nowrap;overflow:hidden;
            text-overflow:ellipsis" title="${escAttr(sess.join(' / '))}">${escapeHtml(sess[0])}${
            sess.length > 1 ? ` 외 ${sess.length - 1}` : ''}</div>`
          : '<span style="font-size:10.5px;color:var(--am)">배정 없음</span>'}</td>
      <td style="min-width:70px">
        ${progressBar(pr.pct, pr.pct === 100 ? 'var(--g)' : 'var(--a)')}
        <div style="font-size:9.5px;color:var(--i4);margin-top:2px">${pr.n}/${pr.of}</div></td>
      ${SP_COLS.map(c => spCellHtml(spCell(sp, ev.key, c.key), c.label, name)).join('')}
      <td style="text-align:center;font-size:10.5px;color:${to.length ? 'var(--i4)' : 'var(--am)'}"
        title="${escAttr(to.length ? to.map(x => x.email).join(', ') : '메일 수신자가 정해지지 않았어요')}">
        ${to.length ? '✓' : '—'}</td>
      <td style="text-align:right;font-size:11px;white-space:nowrap">
        ${sp.fee_amount
          ? `<span style="color:${sp.fee_paid_at ? 'var(--g)' : 'var(--i2)'}">${
              escapeHtml(Number(String(sp.fee_amount).replace(/[^\d.-]/g, '') || 0).toLocaleString('ko-KR'))}</span>
             <div style="font-size:9.5px;color:${sp.fee_paid_at ? 'var(--g)' : 'var(--am)'}">${
              sp.fee_paid_at ? '지급' : '미지급'}</div>`
          : '<span style="color:var(--i6)">—</span>'}</td>
    </tr>`;
  };

  return summary + sessChips + roleChips + needChips
    + `<div class="tw"><table><thead><tr>
        <th style="min-width:140px">연사</th>
        <th style="min-width:120px">세션</th>
        <th style="min-width:70px">진행률</th>
        ${SP_COLS.map(c => `<th style="text-align:center;font-size:10px;line-height:1.2">${escapeHtml(c.label)}</th>`).join('')}
        <th style="text-align:center;min-width:44px;font-size:10px">수신</th>
        <th style="text-align:right;min-width:70px;font-size:10px">연사료</th>
      </tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>
      <div style="font-size:10px;color:var(--i4);margin-top:7px;line-height:1.6">
        ✓ 받음 · ◐ 일부 · — 아직 · <span style="color:var(--i6)">·</span> 그 역할은 묻지 않음(진행률에서 뺌)
      </div>`;
}

/* ══════════════════════════════════════════════════════════════
   엑셀로 한 번에 올리기

   프로그램은 보통 엑셀로 먼저 돈다 — 학술위원회가 세션을 짜고, 사무국이
   연사를 채우고, 그 파일이 메일로 오간다. 그걸 화면에서 한 줄씩 다시
   치게 하면 옮겨 적는 동안 오타가 생기고, 원본과 어긋난 순간부터 어느
   쪽이 맞는지 아무도 모르게 된다.

   지우지 않는다. 올려도 기존 세션·연사를 지우지 않고 더하거나 고칠 뿐이다 —
   잘못 올렸을 때 되돌릴 것이 남아야 한다.
══════════════════════════════════════════════════════════════ */

/* 양식 내려받기 — 정의는 conf-import-spec.js 하나만 본다 */
export function downloadConfTemplate(){
  if(typeof XLSX === 'undefined'){ alert('엑셀 라이브러리를 불러오지 못했어요. 새로고침 후 다시 해주세요.'); return; }
  const wb = XLSX.utils.book_new();
  const guide = XLSX.utils.aoa_to_sheet(IMPORT_GUIDE);
  guide['!cols'] = [{ wch: 14 }, { wch: 92 }];
  XLSX.utils.book_append_sheet(wb, guide, '안내');
  IMPORT_SHEETS.forEach(sh => {
    const rows = [
      sh.cols.map(c => c.label),
      sh.cols.map(c => (c.hint ? `↳ ${c.hint}` : '')),
      ...sh.sample,
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = sh.cols.map(c => ({ wch: Math.max(12, Math.min(34, c.label.length * 2 + 8)) }));
    XLSX.utils.book_append_sheet(wb, ws, sh.name);
  });
  const ev = EVENT_LIST.find(e => e.key === confEvent);
  XLSX.writeFile(wb, `${(ev?.short || ev?.key || '컨퍼런스')}_업로드_양식.xlsx`);
}

/* 머리글로 칸을 찾는다 — 열 순서가 바뀌어도 읽히게. 사람이 열을 옮기는 건
   흔한 일이고, 그걸로 못 읽으면 «양식대로 넣었는데»가 된다. */
function readSheet(wb, sh){
  const ws = wb.Sheets[sh.name];
  if(!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  if(!rows.length) return [];
  const head = rows[0].map(v => String(v || '').trim());
  const idx = {};
  sh.cols.forEach(c => { idx[c.key] = head.indexOf(c.label); });
  return rows.slice(1)
    /* 2행은 우리가 넣은 설명 줄이다. «↳»로 시작하면 건너뛴다 —
       지우고 쓰는 사람도 있고 남겨 두는 사람도 있다. */
    .filter(r => !String(r[0] || '').trim().startsWith('↳'))
    .map(r => {
      const o = {};
      sh.cols.forEach(c => { o[c.key] = idx[c.key] >= 0 ? String(r[idx[c.key]] ?? '').trim() : ''; });
      return o;
    })
    .filter(o => Object.values(o).some(v => v));
}

/* 엑셀이 시각을 0.4687500…으로 바꿔 놓는 일이 잦다. 되돌려 준다 —
   여기서 안 받아 주면 «시간이 다 비어서 들어왔다»가 된다. */
function normTime(v){
  const s = String(v || '').trim();
  if(!s) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if(m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  const n = Number(s);
  if(Number.isFinite(n) && n > 0 && n < 1){
    const mins = Math.round(n * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  return s;
}
function normDate(v){
  const s = String(v || '').trim();
  if(!s) return '';
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s);
  if(m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  /* 엑셀 일련번호(1900 기준) */
  const n = Number(s);
  if(Number.isFinite(n) && n > 20000 && n < 80000){
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return s;
}

export function pickConfFile(){
  if(confLocked()){ confLockNotice(); return; }
  document.getElementById('conf-xlsx-input')?.click();
}

export async function handleConfFile(e){
  const file = e.target?.files?.[0];
  if(e.target) e.target.value = '';   // 같은 파일을 다시 골라도 열리게
  if(!file) return;
  if(confLocked()){ confLockNotice(); return; }
  const ev = EVENT_LIST.find(x => x.key === confEvent);
  if(!ev) return;

  let wb;
  try {
    const buf = await file.arrayBuffer();
    wb = XLSX.read(buf, { type: 'array', cellText: true, cellDates: false });
  } catch(err){ alert(`엑셀을 읽지 못했어요 (${err.message}).`); return; }

  const spec = Object.fromEntries(IMPORT_SHEETS.map(sh => [sh.key, sh]));
  const missing = IMPORT_SHEETS.filter(sh => !wb.Sheets[sh.name]).map(sh => sh.name);
  if(missing.length === IMPORT_SHEETS.length){
    alert(`«${IMPORT_SHEETS.map(s => s.name).join('», «')}» 시트를 찾지 못했어요.\n«양식 받기»로 받은 파일에 채워 올려주세요.`);
    return;
  }

  const rowsS = readSheet(wb, spec.sessions);
  const rowsP = readSheet(wb, spec.speakers);
  const rowsA = readSheet(wb, spec.assignments);
  if(!rowsS.length && !rowsP.length && !rowsA.length){ alert('채워진 줄이 없어요.'); return; }

  /* 무엇이 새로 만들어지고 무엇이 이미 있는지 먼저 보여준다 — 올리고 나서
     알려 주면 되돌릴 수 없다. */
  const sessKey = (t) => String(t || '').trim().toLowerCase();
  const haveSess = new Map();
  sessionsForEvent(ev.key).forEach(x => {
    if(x.title_ko) haveSess.set(sessKey(x.title_ko), x);
    if(x.title_en) haveSess.set(sessKey(x.title_en), x);
  });
  const haveSp = new Map(speakersForEvent(ev.key).map(x => [sessKey(x.name_snapshot), x]));

  const newSess = rowsS.filter(r => !haveSess.has(sessKey(r.title_ko)) && !haveSess.has(sessKey(r.title_en)));
  const newSp = rowsP.filter(r => !haveSp.has(sessKey(r.name_snapshot)));
  /* 배정이 가리키는 세션·연사가 이 파일이나 화면에 있는지 미리 본다 */
  const willSess = new Set([...haveSess.keys(), ...rowsS.flatMap(r => [sessKey(r.title_ko), sessKey(r.title_en)]).filter(Boolean)]);
  const willSp = new Set([...haveSp.keys(), ...rowsP.map(r => sessKey(r.name_snapshot)).filter(Boolean)]);
  const orphan = rowsA.filter(r => !willSess.has(sessKey(r._session)) || !willSp.has(sessKey(r._speaker)));

  const msg = `«${ev.short || ev.key}»에 올립니다.\n\n`
    + `세션 ${rowsS.length}줄 — 새로 ${newSess.length}, 이미 있는 것 ${rowsS.length - newSess.length}\n`
    + `연사 ${rowsP.length}줄 — 새로 ${newSp.length}, 이미 있는 것 ${rowsP.length - newSp.length}\n`
    + `배정 ${rowsA.length}줄${orphan.length ? ` — 이 중 ${orphan.length}줄은 세션이나 연사를 못 찾아 건너뜁니다` : ''}\n\n`
    + `이미 있는 것은 비어 있지 않은 칸만 덮어씁니다. 지우지 않습니다.`;
  if(!confirm(msg)) return;

  const msgEl = document.getElementById('conf-import-msg');
  const say = (t, ok) => { if(msgEl){ msgEl.style.color = ok === false ? 'var(--re)' : 'var(--i4)'; msgEl.textContent = t; } };
  const fail = (what) => { say(`${what}에서 멈췄어요 — 여기까지는 저장됐습니다.`, false); };

  let nS = 0, nP = 0, nA = 0;
  say('올리는 중…');

  /* ── 세션 ── */
  for(const r of rowsS){
    const exist = haveSess.get(sessKey(r.title_ko)) || haveSess.get(sessKey(r.title_en));
    const patch = {
      date: normDate(r.date), start_at: normTime(r.start_at), end_at: normTime(r.end_at),
      room: r.room, track: r.track, title_ko: r.title_ko, title_en: r.title_en, note: r.note,
    };
    /* 빈 칸은 덮지 않는다 — 엑셀에서 한 열만 채워 올리는 일이 흔한데,
       그때 나머지가 지워지면 화면에서 채워 둔 값이 통째로 날아간다. */
    Object.keys(patch).forEach(k => { if(!patch[k]) delete patch[k]; });
    if(exist){
      const diff = Object.keys(patch).filter(k => String(exist[k] ?? '') !== patch[k]);
      if(!diff.length) continue;
      const res = await gSaveSession({ id: exist.id, ...patch });
      if(!res || res.ok === false){ fail('세션'); return; }
      Object.assign(exist, patch); nS++;
    } else {
      const row = { event_id: ev.key, seq: String(sessionsForEvent(ev.key).length + 1),
        title_ko: '', title_en: '', date: '', start_at: '', end_at: '', room: '', track: '', note: '', ...patch };
      const res = await gSaveSession(row);
      if(!res || res.ok === false){ fail('세션'); return; }
      const made = { ...row, id: res.id || `CS-tmp-${Date.now()}-${nS}` };
      CONF_SESSIONS.push(made);
      if(made.title_ko) haveSess.set(sessKey(made.title_ko), made);
      if(made.title_en) haveSess.set(sessKey(made.title_en), made);
      nS++;
    }
  }

  /* ── 연사 ── */
  for(const r of rowsP){
    if(!r.name_snapshot) continue;
    const exist = haveSp.get(sessKey(r.name_snapshot));
    const patch = {
      name_snapshot: r.name_snapshot, org_ko: r.org_ko, org_en: r.org_en,
      title_ko: r.title_ko, title_en: r.title_en, lang_pref: r.lang_pref,
      status: r.status, fee_amount: r.fee_amount, fee_currency: r.fee_currency, note: r.note,
    };
    Object.keys(patch).forEach(k => { if(!patch[k]) delete patch[k]; });
    let sp = exist;
    if(sp){
      const diff = Object.keys(patch).filter(k => String(sp[k] ?? '') !== patch[k]);
      if(diff.length){
        const res = await gSaveSpeaker({ id: sp.id, ...patch });
        if(!res || res.ok === false){ fail('연사'); return; }
        Object.assign(sp, patch); nP++;
      }
    } else {
      const row = { event_id: ev.key, contact_id: '', status: '섭외중', lang_pref: '', note: '', ...patch };
      const res = await gSaveSpeaker(row);
      if(!res || res.ok === false){ fail('연사'); return; }
      sp = { ...row, id: res.id || `SP-tmp-${Date.now()}-${nP}` };
      SPEAKERS.push(sp);
      haveSp.set(sessKey(sp.name_snapshot), sp);
      nP++;
    }
    /* 메일을 적었으면 연락 상대(수신)로 만들어 둔다 — 연사에게 무엇을
       보내려면 수신이 있어야 하고, 없으면 메일 칸이 열리지 않는다. */
    if(r.email && !contactsOfSpeaker(sp.id).some(x => x.email === r.email)){
      const c = { speaker_id: sp.id, contact_id: '', name: sp.name_snapshot,
        email: r.email, phone: r.phone || '', kind: '연사 본인',
        send: contactsOfSpeaker(sp.id).some(x => x.send === 'to') ? 'cc' : 'to', note: '' };
      const res = await saveSpeakerContact(c);
      if(res && res.ok !== false) SPEAKER_CONTACTS.push({ ...c, id: res.id || `SC-tmp-${Date.now()}` });
    }
  }

  /* ── 배정 ── */
  const seqBySession = {};
  for(const r of rowsA){
    const ss = haveSess.get(sessKey(r._session));
    const sp = haveSp.get(sessKey(r._speaker));
    if(!ss || !sp) continue;
    const role = r.role || SPEAKER_ROLES[0].key;
    const dup = assignmentsOfSession(ss.id).find(a => a.speaker_id === sp.id && a.role === role);
    const patch = {
      role, seq: r.seq || '', lang: r.lang,
      start_at: normTime(r.start_at), end_at: normTime(r.end_at), duration_min: r.duration_min,
      title_ko: r.title_ko, title_en: r.title_en, note: r.note,
    };
    Object.keys(patch).forEach(k => { if(!patch[k]) delete patch[k]; });
    if(!patch.seq){
      seqBySession[ss.id] = (seqBySession[ss.id] || assignmentsOfSession(ss.id).length) + 1;
      patch.seq = String(seqBySession[ss.id]);
    }
    if(dup){
      const diff = Object.keys(patch).filter(k => String(dup[k] ?? '') !== patch[k]);
      if(!diff.length) continue;
      const res = await gSaveAssign({ id: dup.id, ...patch });
      if(!res || res.ok === false){ fail('배정'); return; }
      Object.assign(dup, patch); nA++;
    } else {
      const row = { event_id: ev.key, session_id: ss.id, speaker_id: sp.id,
        lang: '', duration_min: '', start_at: '', end_at: '',
        title_ko: '', title_en: '', abstract_ko: '', abstract_en: '', abstract_received_at: '',
        slides_file: '', slides_received_at: '', slides_version: '', note: '', ...patch };
      const res = await gSaveAssign(row);
      if(!res || res.ok === false){ fail('배정'); return; }
      SESSION_SPEAKERS.push({ ...row, id: res.id || `SS-tmp-${Date.now()}-${nA}` });
      nA++;
    }
  }

  /* 엑셀에 있던 트랙·장소를 설정에 등록한다. 세션에만 있고 설정에 없으면
     고를 목록이 비어 다음부터 손으로 타이핑하게 되고, 색도 트랙마다 정해
     두지 못한다 — 올린 사람이 나중에 설정을 다시 채울 일은 없다. */
  const cfg = JSON.parse(JSON.stringify(confCfg(ev.key)));
  const before = JSON.stringify([cfg.tracks || [], cfg.rooms || [], cfg.trackColors || {}]);
  cfg.tracks = cfg.tracks || []; cfg.rooms = cfg.rooms || [];
  cfg.trackColors = { ...(cfg.trackColors || {}) };
  sessionsForEvent(ev.key).forEach(x => {
    if(x.track && !cfg.tracks.includes(x.track)) cfg.tracks.push(x.track);
    /* 장소는 순서가 곧 표의 열 순서다. 어디가 메인인지는 우리가 모르니
       뒤에 붙이고, 순서는 설정에서 사람이 정한다. */
    if(x.room && !cfg.rooms.includes(x.room)) cfg.rooms.push(x.room);
  });
  cfg.tracks.forEach(t => {
    if(!Number.isInteger(cfg.trackColors[t])) cfg.trackColors[t] = pickTrackColorIndex(cfg);
  });
  if(JSON.stringify([cfg.tracks, cfg.rooms, cfg.trackColors]) !== before){
    await saveConf(ev.key, cfg);
  }

  trackAction('add', '컨퍼런스 업로드', ev.key,
    `${ev.name || ev.key} — 세션 ${nS} · 연사 ${nP} · 배정 ${nA}`);
  say(`올렸어요 — 세션 ${nS} · 연사 ${nP} · 배정 ${nA}${orphan.length ? ` (건너뛴 배정 ${orphan.length})` : ''}`);
  buildConfEvList();
  renderConf();
}

/* ══════════════════════════════════════════
   쓰기
══════════════════════════════════════════ */
/* 시간대를 고르면 시작·종료 칸을 채운다 — 안내에 그렇게 적었으니 실제로
   채워져야 하고, 고른 뒤 한쪽만 손으로 고치는 일도 가능해야 한다. */
export function fillSessionSlot(idx){
  const ev = EVENT_LIST.find(e => e.key === confEvent);
  const slot = (confCfg(ev?.key || '').slots || [])[Number(idx)];
  const s = document.getElementById('ns-start'), e = document.getElementById('ns-end');
  if(!slot || !s || !e) return;
  s.value = slot.start || '';
  e.value = slot.end || '';
}

export function toggleNewSession(){ confNewSession = !confNewSession; renderConf(); }
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
  trackAction('edit', '발표 시간', confEvent,
    `${speakerName(a.speaker_id)} — ${patch.start_at || a.start_at || ''}${patch.end_at ? `–${patch.end_at}` : ''}`,
    changed('session_speakers', aid, backup, patch, { kind: 'session', id: a.session_id, ev: confEvent }));
}

/* 세션 시작부터 각 발표의 «분»만큼 이어 붙인다.
   «분»이 없는 줄은 건너뛴다 — 0분으로 잡아 버리면 뒤 순서가 전부 밀린다. */
export async function autoTalkTimes(sid){
  if(confLocked()){ confLockNotice(); return; }
  const sess = CONF_SESSIONS.find(x => x.id === sid);
  if(!sess || !sess.start_at) return;
  const asg = assignmentsOfSession(sid);
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
  trackAction('edit', '발표 시간 배분', confEvent,
    `${sess.title_ko || sess.title_en || sid} — ${plan.length}명`,
    { kind: 'session', id: sid, ev: confEvent });
  renderConf();
}

/* ── 순서 바꾸기 ──
   좌장을 나중에 넣으면 맨 뒤에 붙는다. 프로그램은 순서대로 읽는 물건이라
   좌장이 맨 아래 있으면 그대로는 못 쓴다. 지워서 다시 넣게 하면 발제 정보가
   함께 날아가므로, 끌어서 옮긴다. */
let _dragAsgId = null;

export function onAsgDragStart(e, aid){
  _dragAsgId = aid;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', aid);
  e.stopPropagation();
}
export function onAsgDragEnd(){
  _dragAsgId = null;
  document.querySelectorAll('.asg-row.drop-on').forEach(el => el.classList.remove('drop-on'));
}
export function onAsgDragOver(e, el){
  if(!_dragAsgId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if(el) el.classList.add('drop-on');
}
export function onAsgDragLeave(el){ if(el) el.classList.remove('drop-on'); }

export async function onAsgDrop(e, overId, el){
  e.preventDefault();
  e.stopPropagation();
  if(el) el.classList.remove('drop-on');
  const from = _dragAsgId;
  onAsgDragEnd();
  if(!from || from === overId) return;

  const moving = SESSION_SPEAKERS.find(x => x.id === from);
  const target = SESSION_SPEAKERS.find(x => x.id === overId);
  /* 다른 세션의 줄로는 옮기지 않는다 — 세션을 옮기는 건 순서 바꾸기가 아니라
     배정을 다시 하는 일이고, 그때는 발제 정보를 어떻게 할지 정해야 한다. */
  if(!moving || !target || moving.session_id !== target.session_id) return;

  const list = assignmentsOfSession(moving.session_id).slice();
  const fromIdx = list.findIndex(x => x.id === from);
  const toIdx = list.findIndex(x => x.id === overId);
  if(fromIdx < 0 || toIdx < 0) return;
  list.splice(toIdx, 0, list.splice(fromIdx, 1)[0]);
  await applyAsgOrder(list, `${speakerName(moving.speaker_id)} 순서 옮김`);
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
  trackAction('edit', '세션 배정 순서', confEvent, label);
}

export function toggleEditSession(sid){
  confEditSession = confEditSession === sid ? '' : sid;
  renderConf();
}

/* 수정 칸에서도 시간대를 고르면 시작·종료가 채워진다 */
export function fillEditSlot(sid, idx){
  const slot = (confCfg(confEvent).slots || [])[Number(idx)];
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
  const slots = confCfg(confEvent).slots || [];
  const slot = si !== '' ? slots[Number(si)] : null;
  const start = slot ? slot.start : g('start');
  const end = slot ? slot.end : g('end');
  const titleKo = g('ko'), titleEn = g('en');
  if(!titleKo && !titleEn){ say('세션명을 넣어주세요 — 국문이나 영문 하나는 있어야 해요.', false); return; }
  if(start && end && end <= start){ say('종료가 시작보다 빠르거나 같아요.', false); return; }

  const patch = {
    title_ko: titleKo, title_en: titleEn,
    date: g('date'), start_at: start, end_at: end,
    track: g('track'), room: g('room'), note: g('note'),
  };
  /* 바뀐 것이 없으면 보내지 않는다 — 저장할 때마다 같은 값을 밀어 넣으면
     기록이 «고침»으로 채워져 정작 무엇이 바뀌었는지 안 보인다. */
  const diff = Object.keys(patch).filter(k => String(s[k] ?? '') !== String(patch[k] ?? ''));
  if(!diff.length){ confEditSession = ''; renderConf(); return; }

  const backup = {};
  diff.forEach(k => { backup[k] = s[k]; });
  Object.assign(s, patch);
  say('저장 중…', true);

  const res = await gSaveSession({ id: sid, ...patch });
  if(!res || res.ok === false){
    Object.assign(s, backup);
    renderConf();
    if(!res?.locked) alert('세션을 고치지 못했어요. 잠시 뒤 다시 해주세요.');
    return;
  }
  trackAction('edit', '컨퍼런스 세션', confEvent, `${titleKo || titleEn} — ${diff.join(', ')} 고침`,
    changed('conf_sessions', sid, backup, diff.reduce((o, k) => (o[k] = patch[k] ?? '', o), {}),
      { kind: 'session', id: sid, ev: confEvent }));
  confEditSession = '';
  renderConf();
}

export function toggleAssign(sid){ confOpenSession = confOpenSession === sid ? '' : sid; renderConf(); }

const gv = (id) => (document.getElementById(id)?.value || '').trim();

export async function addConfSession(){
  if(confLocked()){ confLockNotice(); return; }
  const ev = EVENT_LIST.find(e => e.key === confEvent);
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
    track: gv('ns-track'), room: gv('ns-room'), note: '',
  };
  const res = await gSaveSession(row);
  if(!res || res.ok === false){ if(!res?.locked) alert('세션을 만들지 못했어요. 잠시 뒤 다시 해주세요.'); return; }

  CONF_SESSIONS.push({ ...row, id: res.id || row.id || `CS-tmp-${Date.now()}` });
  trackAction('add', '컨퍼런스 세션', ev.key, `${ev.name || ev.key} — ${titleKo || titleEn}`,
    { kind: 'session', id: res.id || row.id, ev: ev.key });
  confNewSession = false;
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
    if(r && r.ok === false) return;
    const i = SESSION_SPEAKERS.findIndex(x => x.id === a.id);
    if(i >= 0) SESSION_SPEAKERS.splice(i, 1);
  }
  const res = await gDelSession(sid);
  if(res && res.ok === false){ if(!res.locked) alert('세션을 지우지 못했어요.'); renderConf(); return; }
  const i = CONF_SESSIONS.findIndex(x => x.id === sid);
  if(i >= 0) CONF_SESSIONS.splice(i, 1);
  if(confEditSession === sid) confEditSession = '';
  /* 세션을 지우면 배정도 함께 없어진다 — 둘 다 담아야 되살릴 수 있다 */
  trackAction('delete', '컨퍼런스 세션', confEvent, s.title_ko || s.title_en || sid,
    removed('conf_sessions', sid, s, { kind: 'session', id: sid, also: goneAssigns }));
  renderConf();
}

export async function addAssign(sid){
  if(confLocked()){ confLockNotice(); return; }
  const ev = EVENT_LIST.find(e => e.key === confEvent);
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
  trackAction('edit', '세션 배정', confEvent, `${speakerName(a.speaker_id)} — ${was} → ${role}`,
    changed('session_speakers', aid, { role: was }, { role },
      { kind: 'session', id: a.session_id, ev: confEvent }));
  renderConf();
}

export async function removeAssign(aid){
  if(confLocked()){ confLockNotice(); return; }
  const a = SESSION_SPEAKERS.find(x => x.id === aid);
  if(!a) return;
  const res = await gDelAssign(aid);
  if(res && res.ok === false){ if(!res.locked) alert('배정을 해제하지 못했어요.'); return; }
  const i = SESSION_SPEAKERS.findIndex(x => x.id === aid);
  if(i >= 0) SESSION_SPEAKERS.splice(i, 1);
  trackAction('delete', '세션 배정', confEvent, `${speakerName(a.speaker_id)} — ${a.role}`,
    removed('session_speakers', aid, a, { kind: 'speaker', id: a.speaker_id }));
  renderConf();
}

export async function removeConfSpeaker(spId){
  if(confLocked()){ confLockNotice(); return; }
  const sp = getSpeakerById(spId);
  if(!sp) return;
  const asg = assignmentsFor(spId);
  if(asg.length){
    alert(`이 연사는 세션 ${asg.length}건에 배정돼 있어요.\n먼저 «프로그램»에서 배정을 해제해주세요 — 배정을 남기고 사람을 지우면 프로그램에 이름 없는 줄이 남아요.`);
    return;
  }
  /* 연사 줄에 딸린 것들 — 연락 상대와 주고받은 기록. 연사 줄만 지워서 이것들이
     없는 사람을 가리킨 채 DB에 남아 있었다(실제로 네 줄이 그랬다). 화면에서는
     안 보이니 아무도 모르고, 계좌·여권을 열어 본 기록까지 주인 없이 떠돈다.
     «이력·제공사항이 함께 지워집니다»라고 물어 놓고 안 지우면 그 말이 거짓이 된다. */
  const goneCons = SPEAKER_CONTACTS.filter(c => c.speaker_id === spId).map(c => ({ ...c }));
  const goneLogs = SPEAKER_LOGS.filter(l => l.speaker_id === spId).map(l => ({ ...l }));
  if(!confirm(`«${sp.name_snapshot || spId}» 연사를 지울까요?\n이력·제공사항·계좌 정보가 함께 지워집니다.`
    + (goneCons.length || goneLogs.length
      ? `\n연락 상대 ${goneCons.length}명, 주고받은 기록 ${goneLogs.length}건도 함께 지워져요.` : ''))) return;

  for(const c of goneCons) await gDelSpeakerContact(c.id);
  for(const l of goneLogs) await gDelSpeakerLog(l.id);
  [[SPEAKER_CONTACTS, goneCons], [SPEAKER_LOGS, goneLogs]].forEach(([arr, gone]) => {
    gone.forEach(g => { const k = arr.findIndex(x => x.id === g.id); if(k >= 0) arr.splice(k, 1); });
  });

  const res = await gDelSpeaker(spId);
  if(res && res.ok === false){ if(!res.locked) alert('연사를 지우지 못했어요.'); return; }
  const i = SPEAKERS.findIndex(x => x.id === spId);
  if(i >= 0) SPEAKERS.splice(i, 1);
  trackAction('delete', '연사', confEvent, sp.name_snapshot || spId,
    removed('speakers', spId, sp, { also: [...goneCons, ...goneLogs] }));
  renderConf();
  buildConfEvList();
}

/* ── 인라인 핸들러용 노출 ── */
window.setConfEvent      = setConfEvent;
window.setConfView       = setConfView;
window.setConfNeedFil    = setConfNeedFil;
window.setConfRoleFil    = setConfRoleFil;
window.setConfSessFil    = setConfSessFil;
window.openPgaSession    = openPgaSession;
window.openAuditSession  = openAuditSession;
window.copyPga           = copyPga;
window.downloadConfTemplate = downloadConfTemplate;
window.pickConfFile         = pickConfFile;
window.handleConfFile       = handleConfFile;
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
window.removeConfSpeaker = removeConfSpeaker;
