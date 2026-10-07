/* ══════════════════════════════════════════════════════════════
   mail-mark.js — 받은 메일의 «읽음»과 «처리»

   받은메일함에서 가져온 메일이 쌓이면, 누가 읽었는지·처리했는지를 구분하지 않고는
   놓치는 메일이 생긴다. 두 가지를 따로 센다:

     읽음     처음 펼쳐 본 때 자동으로 찍힌다(read_at·read_by). «안 읽음으로»로 되돌린다
     처리함   답장했거나 할 일을 마쳤으면 사람이 누른다(status 'done'·answered_at)

   보낸 메일은 대상이 아니다. 연사(speaker_logs)와 참가사(exhibitor_logs)가 같은
   규칙을 쓰도록 여기 한 곳에 둔다 — 화면마다 따로 두면 숫자가 갈린다.
   t는 'sp'(연사) 또는 'ex'(참가사).
══════════════════════════════════════════════════════════════ */
import { SPEAKER_LOGS, EXH_LOGS, currentUser } from '../state.js';
import { saveSpeakerLog, saveExhLog } from '../api.js';
import { nowStamp, escapeHtml, escAttr } from '../utils.js';

export const isInbound = (l) => l && l.direction === 'in';
export const isUnread  = (l) => isInbound(l) && !l.read_at;
export const isPending = (l) => isInbound(l) && l.status !== 'done';

const listOf = (t) => (t === 'sp' ? SPEAKER_LOGS : EXH_LOGS);
const save = (t, row) => (t === 'sp' ? saveSpeakerLog(row) : saveExhLog(row));
const find = (t, id) => listOf(t).find((x) => x.id === id);

/* 목록 거르기 — 창을 옮겨도 고른 필터는 유지한다 */
let mailFil = 'all';
export function filterMail(logs){
  return mailFil === 'unread' ? logs.filter(isUnread)
    : mailFil === 'pending' ? logs.filter(isPending) : logs;
}
export function mailFilBar(logs){
  const n = { all: logs.length, unread: logs.filter(isUnread).length, pending: logs.filter(isPending).length };
  const b = (k, l) => `<button class="seg-b${mailFil === k ? ' on' : ''}" onclick="setMailFil('${k}')">${l} ${n[k] || ''}</button>`;
  return `<div class="seg" style="margin:6px 0 4px">${b('all', '전체')}${b('unread', '안 읽음')}${b('pending', '처리 안 함')}</div>`;
}
export function setMailFil(k){
  mailFil = k;
  window.renderSpeakerDr?.(); window.renderExhDr?.();
}

/* 한 줄 머리에 붙는 표시 — 받은 메일만 */
export function mailStateHtml(t, l){
  if(!isInbound(l)) return '';
  const read = l.read_at
    ? `<span class="pill p-gray" style="font-size:10px" title="${escAttr(`${l.read_by || ''} ${l.read_at}`)}">읽음</span>`
    : `<span class="pill p-red" style="font-size:10px">● 안 읽음</span>`;
  const done = l.status === 'done'
    ? `<span class="pill p-green" style="font-size:10px" title="${escAttr(l.answered_at || '')}">처리함</span>`
    : `<span class="pill p-amber" style="font-size:10px">처리 안 함</span>`;
  return `<span data-mst="${escAttr(t)}|${escAttr(l.id)}" style="display:inline-flex;gap:3px">${read}${done}</span>`;
}
/* 펼친 본문 아래 단추 */
export function mailActionsHtml(t, l){
  if(!isInbound(l)) return '';
  const id = escAttr(l.id);
  return `<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
    ${l.status === 'done'
      ? `<button class="btn" style="font-size:10.5px" onclick="setMailDone('${t}','${id}',false)">처리 취소</button>`
      : `<button class="btn bp" style="font-size:10.5px" onclick="setMailDone('${t}','${id}',true)">✓ 처리 완료</button>`}
    <button class="btn" style="font-size:10.5px" onclick="markMailUnread('${t}','${id}')">안 읽음으로</button>
  </div>`;
}
/* 펼칠 때 부른다 — <details ontoggle> */
export const mailToggleAttr = (t, l) => isInbound(l)
  ? ` ontoggle="if(this.open) markMailRead('${t}','${escAttr(l.id)}')"` : '';

const me = () => (currentUser && (currentUser.email || currentUser.name)) || '';

/* 읽음은 줄 표시만 바꾼다 — 창을 다시 그리면 방금 펼친 칸이 접힌다 */
function repaint(t, l){
  document.querySelectorAll(`[data-mst="${t}|${l.id}"]`).forEach((el) => { el.outerHTML = mailStateHtml(t, l); });
}

export async function markMailRead(t, id){
  const l = find(t, id);
  if(!isUnread(l)) return;
  const row = { id, read_at: nowStamp(), read_by: me() };
  Object.assign(l, row);
  repaint(t, l);
  const r = await save(t, row);
  if(r && r.ok === false){ l.read_at = ''; l.read_by = ''; repaint(t, l); }
}
export async function markMailUnread(t, id){
  const l = find(t, id);
  if(!l) return;
  const prev = { read_at: l.read_at, read_by: l.read_by };
  Object.assign(l, { read_at: '', read_by: '' });
  const r = await save(t, { id, read_at: '', read_by: '' });
  if(r && r.ok === false){ Object.assign(l, prev); alert('저장하지 못했어요.'); }
  rerender();
}
export async function setMailDone(t, id, done){
  const l = find(t, id);
  if(!l) return;
  const prev = { status: l.status, answered_at: l.answered_at, read_at: l.read_at, read_by: l.read_by };
  const row = { id, status: done ? 'done' : 'open', answered_at: done ? nowStamp() : '' };
  // 처리했다면 읽은 것이다
  if(done && !l.read_at){ row.read_at = nowStamp(); row.read_by = me(); }
  Object.assign(l, row);
  const r = await save(t, row);
  if(r && r.ok === false){ Object.assign(l, prev); if(!r.locked) alert('저장하지 못했어요.'); }
  rerender();
}
function rerender(){
  window.renderSpeakerDr?.(); window.renderExhDr?.(); window.renderEvInbox?.();
}

window.setMailFil = setMailFil;
window.markMailRead = markMailRead;
window.markMailUnread = markMailUnread;
window.setMailDone = setMailDone;
