/* ══════════════════════════════════════════════════════════════
   features/conference/conf-program.js — 프로그램 — 일자·세션·배정
   (modules/conf-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { SPEAKER_ROLES } from '../../constants.js';
import { trackAction } from '../../core/audit-log.js';
import { assignmentsOfSession, coOf, confCfg, confDays, getSpeakerById, leadOf, roleLabel, sessionsForEvent, speakerNeedList, speakersForEvent } from '../../state.js';
import { escAttr, escapeHtml, td } from '../../utils.js';
import { confLockNotice, confLocked, isBreak, speakerName } from './conf-common.js';
import { confUi } from './conf-ui.js';
import { addAssign, addConfSession, autoTalkTimes, dayLabel, fillEditSlot, fillSessionSlot, gSaveSpeaker, onAsgDragEnd, onAsgDragLeave, onAsgDragOver, onAsgDragStart, onAsgDrop, removeAssign, removeConfSession, renderConf, roleCls, saveSessionEdit, setAssignRole, setCoLead, setTalkTime, timeLabel, toggleAssign, toggleEditSession, toggleNewSession } from '../../modules/conf-tab.js';

/* ══════════════════════════════════════════
   프로그램 — 일자 → 세션 → 배정
══════════════════════════════════════════ */
/* 세션 종류 — 식사·휴식은 시간표에는 나가지만 연사를 배정하지 않는다.
   회색으로 그려 발표 세션과 눈으로 갈라지게 한다. */
/* 두 묶음으로만 가른다 — 세션(연사를 배정하고 집계에 넣는다)과 세션 아님.
   세션 아닌 것은 식사·휴식 말고도 기념촬영·등록·이동처럼 끝없이 생긴다. 하나하나
   종류를 만들면 매번 «이건 뭘로 고르지»가 되므로 «기타»로 받고 이름은 세션명에 적는다. */
const SESSION_KINDS = [
  { key: '',       label: '세션', pill: '세션' },
  { key: 'break',  label: '커피 브레이크', pill: '휴식', ko: '커피 브레이크', en: 'Coffee Break' },
  { key: 'lunch',  label: '런치',         pill: '식사', ko: '오찬',          en: 'Lunch' },
  { key: 'dinner', label: '갈라 디너',     pill: '식사', ko: '갈라 디너',     en: 'Gala Dinner' },
  { key: 'other',  label: '기타 (기념촬영·등록·이동 등)', pill: '세션 아님' },
];
export async function setSpeakerHidden(spId, on){
  if(confLocked()){ confLockNotice(); return; }
  const sp = getSpeakerById(spId);
  if(!sp) return;
  const backup = sp.hidden || '';
  sp.hidden = on ? 'yes' : '';
  renderConf();
  window.renderSpeakerDr?.();
  const res = await gSaveSpeaker({ id: spId, hidden: sp.hidden, updated_at: td() });
  if(!res || res.ok === false){
    sp.hidden = backup;
    renderConf();
    window.renderSpeakerDr?.();
    if(!res?.locked) alert('저장에 실패했어요.');
    return;
  }
  trackAction('edit', '연사 숨기기', confUi.confEvent, `${sp.name_snapshot || sp.name_en || spId} — ${on ? '숨김(받을 항목에서 뺌)' : '다시 보이기'}`);
}
export function toggleConfHidden(){ confUi.confShowHidden = !confUi.confShowHidden; renderConf(); }
window.setSpeakerHidden = setSpeakerHidden;
window.toggleConfHidden = toggleConfHidden;

export const kindOf = (k) => SESSION_KINDS.find(x => x.key === (k || '')) || SESSION_KINDS[0];
const kindSelect = (id, cur, titleIds) => `<select class="fi" id="${id}"
  onchange="fillSessionKind(this.value,'${titleIds[0]}','${titleIds[1]}')">
  ${(() => {
    const o = (k) => `<option value="${k.key}"${(cur || '') === k.key ? ' selected' : ''}>${escapeHtml(k.label)}</option>`;
    return `<option value=""${!cur ? ' selected' : ''}>세션 — 연사 배정·집계에 넣음</option>
      <optgroup label="세션 아님 — 회색, 배정·집계에서 뺌">${SESSION_KINDS.filter(k => k.key).map(o).join('')}</optgroup>`;
  })()}
</select>`;
/* 종류를 고르면 세션명이 비어 있을 때만 채운다 — 적어 둔 이름(«환영 오찬»)을 덮지 않는다 */
export function fillSessionKind(k, koId, enId){
  const d = kindOf(k);
  const ko = document.getElementById(koId), en = document.getElementById(enId);
  const known = (v) => !v || SESSION_KINDS.some(x => x.ko === v || x.en === v);
  if(ko && known(ko.value.trim())) ko.value = d.ko || '';
  if(en && known(en.value.trim())) en.value = d.en || '';
}

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
    <div style="font-size:var(--fs-11_5);color:var(--i5)">
      세션 <b>${sessions.length}</b>건 · 배정 <b>${totalAssigned}</b>건 · 연사 <b>${speakersForEvent(ev.key).length}</b>명
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      ${window.importBtns()}
      <button class="btn" style="font-size:var(--fs-11)" onclick="toggleNewSession()">${confUi.confNewSession ? '닫기' : '+ 세션 만들기'}</button>
    </div>
  </div>`;

  const form = confUi.confNewSession ? newSessionHtml(ev, allDays, cfg) : '';

  if(!sessions.length){
    return head + form + `<div style="padding:22px;background:var(--i8);border:1px solid var(--i6);
      border-radius:var(--rd-10);font-size:var(--fs-12);color:var(--i5);line-height:1.7">
      아직 세션이 없어요. 세션을 만들고 사람을 배정해 역할을 정하면,
      역할에 따라 <b>무엇을 받아야 하는지</b>가 «연사» 화면에서 자동으로 잡혀요.
      ${days.length ? '' : '<br>발표 일자가 없네요 — 설정 › 행사 관리 › 컨퍼런스에서 일자를 먼저 정하면 고르기 쉬워요.'}
      <br><br>엑셀로 짜 둔 프로그램이 있으면 위의 <b>양식 받기</b>로 받아 채운 뒤 <b>엑셀 올리기</b>로 한 번에 넣으세요.
    </div>`;
  }

  const dayBlock = (d, list) => `<div style="margin-bottom:18px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
      <div style="font-size:var(--fs-12);font-weight:600">${escapeHtml(dayLabel(d))}</div>
      <div style="font-size:var(--fs-10_5);color:var(--i4)">세션 ${list.length}</div>
    </div>
    ${list.length ? list.map(s => sessionCard(ev, s, allDays, cfg)).join('')
      : `<div style="font-size:var(--fs-11);color:var(--i4);padding:8px 2px">이 날은 세션이 없어요</div>`}
  </div>`;

  return head + form
    + allDays.map(d => dayBlock(d, sessions.filter(s => s.date === d))).join('')
    + (noDate.length ? dayBlock('', noDate) : '');
}

function newSessionHtml(ev, days, cfg){
  const slots = cfg.slots || [];
  const tracks = trackOptions(ev.key);
  const roomList = roomOptions(ev.key);
  return `<div style="margin-bottom:16px;padding:12px;background:var(--i8);border:1px solid var(--i6);border-radius:var(--rd-10)">
    <div style="font-size:var(--fs-11);font-weight:600;margin-bottom:8px">세션 만들기</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">
      <div><div class="fl">종류</div>${kindSelect('ns-kind', '', ['ns-ko', 'ns-en'])}</div>
      <div><div class="fl">일자</div>
        <select class="fi" id="ns-date">
          <option value="">미정</option>
          ${days.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}
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
              ${tracks.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}</select>`
          : `<input class="fi" id="ns-track" placeholder="트랙">`}</div>
      <div><div class="fl">장소</div>
        ${roomList.length
          ? `<select class="fi" id="ns-room"><option value="">없음</option>
              ${roomList.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}</select>`
          : `<input class="fi" id="ns-room" placeholder="회의실">`}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
      <div><div class="fl">세션명 (국문)</div><input class="fi" id="ns-ko" placeholder="세션명"></div>
      <div><div class="fl">세션명 (영문)</div><input class="fi" id="ns-en" placeholder="Session title"></div>
    </div>
    <div style="margin-top:9px;display:flex;gap:7px;align-items:center">
      <button class="btn bp" style="font-size:var(--fs-11)" onclick="addConfSession()">만들기</button>
      <span style="font-size:var(--fs-10_5);color:var(--i4)">시간대를 고르면 시작·종료가 채워져요</span>
    </div>
  </div>`;
}

function sessionCard(ev, s, days, cfg){
  /* 순서는 seq 하나로 정한다(assignmentsOfSession이 seq로 세운다).
     전에는 시간이 있으면 시간 순으로 세웠는데, 그러면 사람이 끌어다 옮겨도
     시간이 도로 끌고 가 버린다 — 순서를 정하는 주인이 둘일 수는 없다.
     시간이 순서와 어긋나면 아래에서 경고로 알린다. */
  const asg = assignmentsOfSession(s.id);
  const open = confUi.confOpenSession === s.id;
  const editing = confUi.confEditSession === s.id;
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

  /* 공동 발표 고르기 — 같은 세션에서 발제를 받는 다른 줄 중 하나를 주 발표자로 */
  const talkRows = asg.filter(x => speakerNeedList(ev.key, x.role).some(n => n.key === 'title'));
  const coPick = (a) => {
    if(talkRows.length < 2 || !talkRows.includes(a)) return '';
    const mine = coOf(a);
    if(mine.length) return `<span class="pill p-blue" style="font-size:var(--fs-9_5)" title="이 발표를 함께 하는 사람">공동 ${mine.length + 1}명</span>`;
    const opts = talkRows.filter(x => x !== a && leadOf(x) === x);
    if(!opts.length) return '';
    return `<select class="fi" style="width:118px;font-size:var(--fs-10_5);padding:3px 5px"
      title="발표 시간 하나·자료 하나를 나눠 맡을 때 — 상대의 시간·발제·자료를 같이 씁니다"
      onchange="setCoLead('${escAttr(a.id)}',this.value)">
      <option value=""${!a.lead_id ? ' selected' : ''}>단독 발표</option>
      ${opts.map(x => `<option value="${escapeHtml(x.id)}"${a.lead_id === x.id ? ' selected' : ''}>${escapeHtml(speakerName(x.speaker_id))}와 공동</option>`).join('')}
    </select>`;
  };

  const asgRow = (a, idx) => {
    const needsTalk = speakerNeedList(ev.key, a.role).some(n => n.key === 'title');
    /* 공동 연사 줄은 시간·발제를 주 발표자 줄에서 읽는다 — 따로 적지 않는다 */
    const lead = leadOf(a);
    const isCo = lead !== a;
    const warn = isCo ? '' : outOfSession(a);
    /* 앞 사람이 끝나기 전에 시작하면 겹친다 — 같은 무대에 둘이 설 수는 없다.
       공동 연사 줄은 앞사람과 같은 시간이므로 견주지 않고, 견줄 때도 건너뛴다 */
    const prev = isCo ? null : asg.slice(0, idx).reverse().find(x => leadOf(x) === x) || null;
    const overlap = prev && prev.end_at && a.start_at && a.start_at < prev.end_at;
    /* 순서는 끌어서 정하고 시간은 따로 적으니 둘이 어긋날 수 있다.
       어느 쪽이 맞는지는 우리가 모른다 — 어긋났다는 사실만 알린다. */
    const outOfOrder = !overlap && prev && prev.start_at && a.start_at && a.start_at < prev.start_at;
    return `<div class="asg-row" style="padding:6px 0;border-top:1px solid var(--i6)"
      draggable="true" ondragstart="onAsgDragStart(event,'${escAttr(a.id)}')" ondragend="onAsgDragEnd()"
      ondragover="onAsgDragOver(event,this)" ondragleave="onAsgDragLeave(this)"
      ondrop="onAsgDrop(event,'${escAttr(a.id)}',this)">
      <div style="display:flex;align-items:center;gap:8px">
      <span style="cursor:grab;color:var(--i5);font-size:var(--fs-12);line-height:1;user-select:none"
        title="끌어서 순서를 바꿉니다">⠿</span>
      <span class="pill ${roleCls(a.role)}" style="font-size:var(--fs-10)">${escapeHtml(roleLabel(a) || '역할 없음')}</span>
      <div style="flex:1;min-width:0">
        <div><span onclick="openSpeakerDr('${escAttr(a.speaker_id)}')" style="font-size:var(--fs-12);cursor:pointer;color:var(--a)">${escapeHtml(speakerName(a.speaker_id))}</span>
          ${!isCo && a.start_at ? `<span style="font-size:var(--fs-10_5);color:var(--i3);margin-left:6px">${
            escapeHtml(timeLabel(a.start_at, a.end_at))}</span>` : ''}</div>
        ${isCo
          ? `<div style="font-size:var(--fs-10_5);color:var(--i4)">↳ ${escapeHtml(speakerName(lead.speaker_id))}와 같은 발표</div>`
          : needsTalk
          ? `<div style="font-size:var(--fs-10_5);color:${a.title_ko || a.title_en ? 'var(--i5)' : 'var(--i4)'}">
              ${escapeHtml(a.title_ko || a.title_en || '발제명 아직 없음')}</div>`
          : ''}
      </div>
      ${coPick(a)}
      <select class="fi" style="width:82px;font-size:var(--fs-10_5);padding:3px 5px"
        onchange="setAssignRole('${escAttr(a.id)}',this.value)">
        ${SPEAKER_ROLES.map(r => `<option value="${escapeHtml(r.key)}"${a.role === r.key ? ' selected' : ''}>${escapeHtml(r.label)}</option>`).join('')}
      </select>
      <button class="btn" style="font-size:var(--fs-10_5)" onclick="removeAssign('${escAttr(a.id)}')">해제</button>
      </div>
      ${isCo ? '' : `<div style="display:flex;align-items:center;gap:6px;margin-top:4px;padding-left:2px;flex-wrap:wrap">
        <span style="font-size:var(--fs-10);color:var(--i4);flex:0 0 auto">발표</span>
        <input class="fi" type="time" style="width:96px;font-size:var(--fs-10_5);padding:2px 5px"
          value="${escapeHtml(a.start_at || '')}" onchange="setTalkTime('${escAttr(a.id)}','start_at',this.value)">
        <span style="font-size:var(--fs-10);color:var(--i4)">–</span>
        <input class="fi" type="time" style="width:96px;font-size:var(--fs-10_5);padding:2px 5px"
          value="${escapeHtml(a.end_at || '')}" onchange="setTalkTime('${escAttr(a.id)}','end_at',this.value)">
        <input class="fi" type="text" style="width:58px;font-size:var(--fs-10_5);padding:2px 5px"
          placeholder="분" value="${escapeHtml(a.duration_min || '')}"
          onchange="setTalkTime('${escAttr(a.id)}','duration_min',this.value)"
          title="분만 적어 두면 «시간 자동 배분»이 이 길이로 이어 붙입니다">
        ${warn ? `<span style="font-size:var(--fs-10);color:var(--am)">⚠ ${escapeHtml(warn)}</span>` : ''}
        ${overlap ? `<span style="font-size:var(--fs-10);color:var(--re)">⚠ 앞 발표와 겹쳐요</span>` : ''}
        ${outOfOrder ? `<span style="font-size:var(--fs-10);color:var(--am)">⚠ 앞 사람보다 이른 시각이에요 — 순서나 시간 중 하나를 고쳐주세요</span>` : ''}
      </div>`}
    </div>`;
  };

  const brk = isBreak(s);
  return `<div style="border:1px solid var(--i6);border-radius:var(--rd-9);padding:10px 12px;margin-bottom:8px;
    background:${brk ? 'var(--i8)' : 'var(--W)'}">
    <div style="display:flex;align-items:flex-start;gap:9px">
      <div style="flex:1;min-width:0">
        <div style="font-size:var(--fs-12_5);font-weight:600${brk ? ';color:var(--i4)' : ''}">${
          brk ? `<span class="pill p-gray" style="font-size:var(--fs-9);margin-right:5px">${escapeHtml(s.kind ? (kindOf(s.kind).pill || '세션 아님') : '세션 아님')}</span>` : ''}${
          escapeHtml(s.title_ko || s.title_en || '(세션명 없음)')}</div>
        ${s.title_ko && s.title_en ? `<div style="font-size:var(--fs-10_5);color:var(--i4)">${escapeHtml(s.title_en)}</div>` : ''}
        ${meta ? `<div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:2px">${escapeHtml(meta)}</div>` : ''}
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        ${!brk && asg.length && s.start_at ? `<button class="btn" style="font-size:var(--fs-10_5)"
          onclick="autoTalkTimes('${escAttr(s.id)}')" title="세션 시작부터 각 발표의 «분»만큼 이어 붙입니다">시간 배분</button>` : ''}
        <button class="btn" style="font-size:var(--fs-10_5)" onclick="toggleEditSession('${escAttr(s.id)}')">${editing ? '닫기' : '수정'}</button>
        ${brk && !asg.length ? '' : `<button class="btn" style="font-size:var(--fs-10_5)" onclick="toggleAssign('${escAttr(s.id)}')">${open ? '닫기' : `배정 ${asg.length}`}</button>`}
        <button class="btn" style="font-size:var(--fs-10_5)" onclick="removeConfSession('${escAttr(s.id)}')">삭제</button>
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
  const trackList = trackOptions(confUi.confEvent, s.track);
  const roomList = roomOptions(confUi.confEvent, s.room);
  const dayList = s.date && !days.includes(s.date) ? [...days, s.date].sort() : days;

  return `<div style="margin-top:9px;padding:10px;background:var(--i8);border-radius:var(--r)">
    <div style="font-size:var(--fs-11);font-weight:600;margin-bottom:7px">세션 고치기</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:7px">
      <div><div class="fl">종류</div>${kindSelect(i('kind'), s.kind, [i('ko'), i('en')])}</div>
      <div><div class="fl">일자</div>
        <select class="fi" id="${i('date')}">
          <option value=""${!s.date ? ' selected' : ''}>미정</option>
          ${dayList.map(d => `<option value="${escapeHtml(d)}"${s.date === d ? ' selected' : ''}>${escapeHtml(d)}</option>`).join('')}
        </select></div>
      <div><div class="fl">시간대</div>
        <select class="fi" id="${i('slot')}" onchange="fillEditSlot('${escAttr(s.id)}',this.value)">
          <option value="">직접 입력</option>
          ${slots.map((sl, k) => `<option value="${k}">${escapeHtml(`${sl.start}–${sl.end}${sl.label ? ' ' + sl.label : ''}`)}</option>`).join('')}
        </select></div>
      <div><div class="fl">시작</div><input class="fi" id="${i('start')}" type="time" value="${escapeHtml(s.start_at || '')}"></div>
      <div><div class="fl">종료</div><input class="fi" id="${i('end')}" type="time" value="${escapeHtml(s.end_at || '')}"></div>
      <div><div class="fl">트랙</div>
        ${trackList.length
          ? `<select class="fi" id="${i('track')}"><option value=""${!s.track ? ' selected' : ''}>없음</option>
              ${trackList.map(t => `<option value="${escapeHtml(t)}"${s.track === t ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select>`
          : `<input class="fi" id="${i('track')}" value="${escapeHtml(s.track || '')}" placeholder="트랙">`}</div>
      <div><div class="fl">장소</div>
        ${roomList.length
          ? `<select class="fi" id="${i('room')}"><option value=""${!s.room ? ' selected' : ''}>없음</option>
              ${roomList.map(r => `<option value="${escapeHtml(r)}"${s.room === r ? ' selected' : ''}>${escapeHtml(r)}</option>`).join('')}</select>`
          : `<input class="fi" id="${i('room')}" value="${escapeHtml(s.room || '')}" placeholder="회의실">`}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px">
      <div><div class="fl">세션명 (국문)</div><input class="fi" id="${i('ko')}" value="${escapeHtml(s.title_ko || '')}"></div>
      <div><div class="fl">세션명 (영문)</div><input class="fi" id="${i('en')}" value="${escapeHtml(s.title_en || '')}"></div>
    </div>
    <div style="margin-top:7px"><div class="fl">메모</div>
      <textarea class="fi" id="${i('note')}" rows="2" style="resize:vertical">${escapeHtml(s.note || '')}</textarea></div>
    <div style="margin-top:8px;display:flex;gap:7px;align-items:center">
      <button class="btn bp" style="font-size:var(--fs-11)" onclick="saveSessionEdit('${escAttr(s.id)}')">저장</button>
      <button class="btn" style="font-size:var(--fs-11)" onclick="toggleEditSession('${escAttr(s.id)}')">취소</button>
      <span id="es-msg-${escAttr(s.id)}" style="font-size:var(--fs-10_5);color:var(--i4)"></span>
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
    .sort((a, b) => String(a.sp.name_snapshot || a.sp.name_en || '').localeCompare(String(b.sp.name_snapshot || b.sp.name_en || ''), 'ko'));
  return `<div style="margin-top:9px;padding:10px;background:var(--i8);border-radius:var(--r)">
    <div style="font-size:var(--fs-11);font-weight:600;margin-bottom:7px">사람 배정</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:7px">
      <div><div class="fl">이 행사의 연사</div>
        <select class="fi" id="as-pick">
          <option value="">새로 적기</option>
          ${pool.map(({ sp, roles }) => `<option value="${escapeHtml(sp.id)}">${escapeHtml(sp.name_snapshot || sp.name_en || sp.id)}${roles.length ? ` (이 세션 ${roles.join('·')})` : ''}</option>`).join('')}
        </select></div>
      <div><div class="fl">이름 (새로 적을 때)</div><input class="fi" id="as-name" placeholder="성명"></div>
      <div><div class="fl">역할</div>
        <select class="fi" id="as-role">
          ${SPEAKER_ROLES.map(r => `<option value="${escapeHtml(r.key)}">${escapeHtml(r.label)}</option>`).join('')}
        </select></div>
      <div><div class="fl">자리</div>
        <select class="fi" id="as-at">
          <option value="">맨 뒤</option>
          ${here.map((x, k) => `<option value="${k}">${k + 1}번째 — ${escapeHtml(speakerName(x.speaker_id))} 앞</option>`).join('')}
        </select></div>
    </div>
    <div style="margin-top:8px;display:flex;gap:7px;align-items:center">
      <button class="btn bp" style="font-size:var(--fs-11)" onclick="addAssign('${escAttr(s.id)}')">배정</button>
      <span style="font-size:var(--fs-10_5);color:var(--i4)">역할을 정하면 받을 것이 정해져요</span>
    </div>
  </div>`;
}



/* 화면의 onclick이 부르는 것 */
window.fillSessionKind   = fillSessionKind;
window.programHtml = programHtml;   // 탭(conf-tab.js)이 window로 부른다
