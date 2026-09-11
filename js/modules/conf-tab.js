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
  contactsOfSpeaker,
} from '../state.js';
import { SPEAKER_ROLES, NEED_MARK, SPEAKER_NEEDS } from '../constants.js';
import { escapeHtml, escAttr, isMobile } from '../utils.js';
import { progressBar, shortCell } from './exh-tab.js';
import {
  saveConfSession, deleteConfSession,
  saveSpeaker, deleteSpeaker,
  saveSessionSpeaker, deleteSessionSpeaker,
} from '../api.js';
import { trackAction } from './audit-tab.js';

/* ── 모듈 상태 ── */
let confEvent = '';
let confView = 'program';      // 'program' | 'people'
let confOpenSession = '';      // 배정 칸이 열려 있는 세션
let confEditSession = '';      // 수정 칸이 열려 있는 세션
let confNewSession = false;    // 세션 추가 칸이 열려 있나
let confNeedFil = null;        // {key, mode:'done'|'todo'} — 받을 것 칩으로 거르기
let confRoleFil = '';          // 역할로 거르기

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

  const segs = [['program', '프로그램'], ['people', '연사']];
  const seg = `<div class="seg" style="margin:0 0 12px">
    ${segs.map(([k, l]) => `<button class="seg-b${confView === k ? ' on' : ''}" onclick="setConfView('${k}')">${l}</button>`).join('')}
  </div>`;

  const banner = confLocked() ? `<div style="display:flex;align-items:center;gap:9px;margin:0 0 12px;
      padding:9px 12px;background:var(--i8);border:1px solid var(--i6);border-radius:8px;font-size:11.5px;color:var(--i5)">
      🔒 끝난 컨퍼런스라 열람만 됩니다. 고치려면 <b>설정 › 행사 관리 › 진행 파트</b>에서 진행 중으로 되돌리세요.
    </div>` : '';

  const inner = confView === 'people' ? peopleHtml(ev) : programHtml(ev);
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
    <button class="btn" style="font-size:11px" onclick="toggleNewSession()">${confNewSession ? '닫기' : '+ 세션 만들기'}</button>
  </div>`;

  const form = confNewSession ? newSessionHtml(ev, allDays, cfg) : '';

  if(!sessions.length){
    return head + form + `<div style="padding:22px;background:var(--i8);border:1px solid var(--i6);
      border-radius:10px;font-size:12px;color:var(--i5);line-height:1.7">
      아직 세션이 없어요. 세션을 만들고 사람을 배정해 역할을 정하면,
      역할에 따라 <b>무엇을 받아야 하는지</b>가 «연사» 화면에서 자동으로 잡혀요.
      ${days.length ? '' : '<br>발표 일자가 없네요 — 설정 › 행사 관리 › 컨퍼런스에서 일자를 먼저 정하면 고르기 쉬워요.'}
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
  const tracks = cfg.tracks || [];
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
      <div><div class="fl">장소</div><input class="fi" id="ns-room" placeholder="회의실"></div>
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
        <span style="font-size:10px;color:var(--i4)">발표</span>
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
function editSessionHtml(s, days, cfg){
  const slots = cfg.slots || [];
  const tracks = cfg.tracks || [];
  const i = (k) => `es-${s.id}-${k}`;
  /* 설정에서 지운 트랙·일자가 이 세션에는 남아 있을 수 있다 — 목록에 없다고
     조용히 «없음»으로 바뀌면 저장하는 순간 값이 날아간다. */
  const trackList = s.track && !tracks.includes(s.track) ? [...tracks, s.track] : tracks;
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
      <div><div class="fl">장소</div><input class="fi" id="${i('room')}" value="${escAttr(s.room || '')}" placeholder="회의실"></div>
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

  const summary = `<div style="display:flex;flex-wrap:wrap;gap:20px;padding:12px 14px;margin-bottom:10px;
      background:var(--i8);border:1px solid var(--i6);border-radius:10px">
    ${card('연사', `${all.length}<span style="font-size:11px;font-weight:600;color:var(--i4)">명</span>`,
      `확정 ${byStatus('확정')} · 섭외중 ${byStatus('섭외중')}`)}
    ${card('평균 진행률', `${avg}<span style="font-size:11px;font-weight:600;color:var(--i4)">%</span>`,
      '역할이 묻는 항목만 셈')}
    ${card('세션', `${sessionsForEvent(ev.key).length}<span style="font-size:11px;font-weight:600;color:var(--i4)">개</span>`,
      noSession ? `<span style="color:var(--am)">배정 없는 연사 ${noSession}</span>` : '모두 배정됨')}
    ${feeLeft ? card('연사료', `${feeLeft}<span style="font-size:11px;font-weight:600;color:var(--i4)">명</span>`, '아직 미지급') : ''}
  </div>`;

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
    return summary + roleChips + needChips
      + `<div style="padding:20px;background:var(--i8);border:1px solid var(--i6);border-radius:10px;
        font-size:12px;color:var(--i5)">이 조건에 맞는 연사가 없어요.</div>`;
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

  return summary + roleChips + needChips
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
    `${speakerName(a.speaker_id)} — ${patch.start_at || a.start_at || ''}${patch.end_at ? `–${patch.end_at}` : ''}`);
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
    `${sess.title_ko || sess.title_en || sid} — ${plan.length}명`);
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
  trackAction('edit', '컨퍼런스 세션', confEvent, `${titleKo || titleEn} — ${diff.join(', ')} 고침`);
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
  trackAction('add', '컨퍼런스 세션', ev.key, `${ev.name || ev.key} — ${titleKo || titleEn}`);
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
  trackAction('delete', '컨퍼런스 세션', confEvent, s.title_ko || s.title_en || sid);
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
  trackAction('add', '세션 배정', ev.key, `${speakerName(spId)} — ${role}`);

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
  trackAction('edit', '세션 배정', confEvent, `${speakerName(a.speaker_id)} — ${was} → ${role}`);
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
  trackAction('delete', '세션 배정', confEvent, `${speakerName(a.speaker_id)} — ${a.role}`);
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
  if(!confirm(`«${sp.name_snapshot || spId}» 연사를 지울까요?\n이력·제공사항·계좌 정보가 함께 지워집니다.`)) return;
  const res = await gDelSpeaker(spId);
  if(res && res.ok === false){ if(!res.locked) alert('연사를 지우지 못했어요.'); return; }
  const i = SPEAKERS.findIndex(x => x.id === spId);
  if(i >= 0) SPEAKERS.splice(i, 1);
  trackAction('delete', '연사', confEvent, sp.name_snapshot || spId);
  renderConf();
  buildConfEvList();
}

/* ── 인라인 핸들러용 노출 ── */
window.setConfEvent      = setConfEvent;
window.setConfView       = setConfView;
window.setConfNeedFil    = setConfNeedFil;
window.setConfRoleFil    = setConfRoleFil;
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
