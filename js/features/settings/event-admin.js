/* ══════════════════════════════════════════════════════════════
   features/settings/event-admin.js — 행사 관리
   (modules/settings-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { saveEventToSheet } from '../../api.js';
import { deleteEventFromSheet } from '../../api/settings-save.js';
import { EVENT_PARTS, partStateOf } from '../../constants.js';
import { removed, trackAction } from '../../core/audit-log.js';
import { EVENT_LIST, EXH_CFG, evParts, participations } from '../../state.js';
import { escAttr, escapeHtml } from '../../utils.js';
import { DUE_LABEL } from '../../modules/settings-tab.js';
import { refreshAfterEventChange } from './taxonomy.js';

/* ══════════════════════════════════════════
   행사 관리 (원본 6421~6537행)
══════════════════════════════════════════ */
export const EV_COLORS = [
  '#3B5BDB','#C97B0A','#16A34A','#6D28D9','#0F766E',
  '#DC2626','#D97706','#0891B2','#BE185D','#9C9890',
];

// 행사명 입력 시 ev_id 자동 제안 (원본 6426~6437행)
export function autoFillEvId(name){
  const idEl = document.getElementById('ev-add-id');
  if(!idEl || idEl.value) return; // 이미 입력된 경우 건드리지 않음
  // "KIC Silicon Valley 2026" → "KIC-SV-2026"
  const suggested = name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-가-힣]/g, '')
    .slice(0, 30);
  idEl.value = suggested;
}

export function renderEvMgr(){
  const el = document.getElementById('ev-mgr-list');
  if(!el) return;

  if(!EVENT_LIST.length){
    el.innerHTML = '<div style="font-size:var(--fs-12);color:var(--i4);padding:12px 0">등록된 행사 없음</div>';
    return;
  }

  el.innerHTML = EVENT_LIST.map((e, i) => `
    <div onclick="openEvDetail('${escAttr(e.key)}')" title="이 행사의 설정 열기"
      style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--W);border:1px solid var(--i6);border-radius:var(--r);margin-bottom:6px;cursor:pointer">
      <div style="width:12px;height:12px;border-radius:50%;background:${e.color};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:var(--fs-13);font-weight:600;color:var(--i1)">${escapeHtml(e.name||e.key)}</div>
        <div style="font-size:var(--fs-11);color:var(--i4)">
          <span style="background:var(--i7);border-radius:var(--rd-3);padding:1px 5px;font-family:monospace">${escapeHtml(e.key)}</span>
          · ${escapeHtml(e.short||'')}
          ${e.date_start ? '· ' + escapeHtml(e.date_start) + (e.date_end ? ' ~ ' + escapeHtml(e.date_end) : '') : (e.date ? '· ' + escapeHtml(e.date) : '')}
          ${e.location ? '· 📍' + escapeHtml(e.location) : ''}
        </div>
        <div style="margin-top:4px">${EVENT_PARTS.filter(p => evParts(e.key)[p.key] !== 'none')
          .map(p => { const st = partStateOf(evParts(e.key)[p.key]);
            return `<span class="pill ${escAttr(st.cls)}" style="margin-right:3px"
              title="${escapeHtml(st.label)}">${escapeHtml(p.label)}${st.key === 'done' ? ' ✓' : ''}</span>`; }).join('')
          || '<span style="font-size:var(--fs-10_5);color:var(--i5)">진행 파트 없음</span>'}</div>
        ${(() => {
          /* 마감일·한도는 상세를 열어야 보였다(설정값 탭에 따로 모아 둔 요약은 없앴다) —
             목록에서 «이 행사는 정해 뒀나»만 한눈에 보이게 한 줄로 적는다 */
          const cfg = EXH_CFG[e.key] || {};
          const due = Object.entries(cfg.due || {}).filter(([, v]) => v);
          const b = cfg.book || {};
          if(!due.length && !b.chars) return '';
          return `<div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:4px">${
            due.map(([k, v]) => `${escapeHtml(DUE_LABEL[k] || k)} ${escapeHtml(v)}`).join(' · ')}${
            b.chars ? `${due.length ? ' · ' : ''}프로그램북 ${Number(b.chars).toLocaleString()}자` : ''}</div>`;
        })()}
      </div>
      <button onclick="event.stopPropagation();removeEventFromList(${i})"
        style="background:none;border:1px solid var(--i6);border-radius:var(--rs);padding:3px 8px;
               font-size:var(--fs-11);color:var(--i3);cursor:pointer"
        onmouseover="this.style.borderColor='var(--re)';this.style.color='var(--re)'"
        onmouseout="this.style.borderColor='var(--i6)';this.style.color='var(--i3)'">삭제</button>
    </div>`
  ).join('');
}

export function addEventToList(){
  const evId      = (document.getElementById('ev-add-id')        ||{}).value.trim();
  const name      = (document.getElementById('ev-add-name')       ||{}).value.trim();
  const short     = (document.getElementById('ev-add-short')      ||{}).value.trim();
  const dateStart = (document.getElementById('ev-add-date-start') ||{}).value.trim();
  const dateEnd   = (document.getElementById('ev-add-date-end')   ||{}).value.trim();
  const loc       = (document.getElementById('ev-add-loc')        ||{}).value.trim();
  const color     = (document.getElementById('ev-add-color')      ||{}).value || '#3B5BDB';
  const msg   = document.getElementById('ev-add-msg');

  if(!evId){ if(msg){msg.style.color='var(--re)';msg.textContent='행사 ID를 입력해주세요.';} return; }
  if(!name){ if(msg){msg.style.color='var(--re)';msg.textContent='행사명을 입력해주세요.';} return; }
  if(EVENT_LIST.find(e => e.key === evId)){
    if(msg){msg.style.color='var(--re)';msg.textContent='이미 등록된 ID예요.';} return;
  }

  EVENT_LIST.push({
    key:        evId,               // ev_id — participations 연결 키
    name:       name,               // 풀네임
    short:      short || name,      // 약칭
    color:      color,
    date:       dateStart || '',    // 하위 호환용 (시작일)
    date_start: dateStart || '',
    date_end:   dateEnd   || '',
    location:   loc       || '',
  });

  // 입력 초기화
  ['ev-add-id','ev-add-name','ev-add-short','ev-add-date-start','ev-add-date-end','ev-add-loc'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  if(msg){msg.style.color='var(--g)';msg.textContent='추가됐어요!';setTimeout(()=>{msg.textContent='';},2000);}

  // UI 갱신
  renderEvMgr();
  refreshAfterEventChange();

  // 구글시트 저장 + 감사 로그
  const newEv = EVENT_LIST[EVENT_LIST.length - 1];
  saveEventToSheet(newEv);
  trackAction('edit', '행사 추가', newEv.key, `행사 "${newEv.name||newEv.key}" 추가`);
}

export function removeEventFromList(idx){
  const ev = EVENT_LIST[idx];
  if(!ev) return;
  // 삭제 전 참조 데이터 규모를 알려줘서 판단할 수 있게 한다
  const partCount = participationsCountForEvent(ev.key);
  if(!confirm(`"${ev.key}" 행사를 삭제할까요?\n`
    + (partCount ? `⚠️ 이 행사에 연결된 참여 기록 ${partCount}건은 시트에 남지만 화면에서 연결이 끊깁니다.\n` : '')
    + `(기존 participations 데이터는 유지됩니다)`)) return;

  const key = ev.key;
  EVENT_LIST.splice(idx, 1);
  renderEvMgr();
  refreshAfterEventChange();
  deleteEventFromSheet(key);
  trackAction('edit', '행사 삭제', key, `행사 "${ev.name||key}" 삭제`
    + (partCount ? ` (참여 기록 ${partCount}건 잔존)` : ''),
    removed('events', key, ev));
}

function participationsCountForEvent(evKey){
  return participations.filter(p => p.eventId === evKey).length;
}


/* 화면의 onclick이 부르는 것 */
window.autoFillEvId          = autoFillEvId;
window.addEventToList        = addEventToList;
window.removeEventFromList   = removeEventFromList;
