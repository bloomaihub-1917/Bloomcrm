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
import { SPEAKER_LOGS, EXH_LOGS, SPEAKERS, EXHIBITORS, currentUser } from '../state.js';
import { saveSpeakerLog, saveExhLog, saveSpeaker, syncSentMail, syncInboxMail, reloadSpeakerData, mailAccountOf } from '../api.js';
import { nowStamp, td, escapeHtml, escAttr } from '../utils.js';
import { trackAction } from './audit-tab.js';
import { unassignedCount } from './mail-original.js';

export const isInbound = (l) => l && l.direction === 'in';
// 처리까지 끝난 메일은 안 읽음으로 세지 않는다 — 다 처리했는데 «안 읽음 1»이 남았다
export const isUnread  = (l) => isInbound(l) && !l.read_at && l.status !== 'done';
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
  // 숫자와 같은 규칙(isUnread) — 처리한 메일은 읽은 시각이 없어도 «안 읽음»을 붙이지 않는다
  const read = !isUnread(l)
    ? `<span class="pill p-gray" style="font-size:10px" title="${escAttr(l.read_at ? `${l.read_by || ''} ${l.read_at}` : '처리함')}">읽음</span>`
    : `<span class="pill p-red" style="font-size:10px">● 안 읽음</span>`;
  const done = l.status === 'done'
    ? `<span class="pill p-green" style="font-size:10px" title="${escAttr(l.answered_at || '')}">처리함</span>`
    : `<span class="pill p-amber" style="font-size:10px">처리 안 함</span>`;
  return `<span data-mst="${escAttr(t)}|${escAttr(l.id)}" style="display:inline-flex;gap:3px">${read}${done}</span>`;
}
/* 펼친 본문 아래 단추 */
export function mailActionsHtml(t, l){
  const id = escAttr(l.id);
  // 원문 보기 — 이미지·표를 봐야 할 때 메일함에서 원본을 가져와 안전한 칸에 띄운다(mail-original.js)
  const orig = l.mail_uid ? `<button class="btn" style="font-size:10.5px" onclick="openMailOriginal('${t}','${id}')">원문 보기</button>` : '';
  if(!isInbound(l)) return orig ? `<div style="display:flex;gap:6px;margin-top:6px">${orig}</div>` : '';
  return `<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
    ${orig}
    <button class="btn bp" style="font-size:10.5px" onclick="replyMail('${t}','${id}')">↩ 회신</button>
    <button class="btn" style="font-size:10.5px" onclick="pinMail('${t}','${id}')" title="이 메일을 모든 탭 위에 붙여 두고 내용을 칸에 넣습니다">📌 고정</button>
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
  // 창은 다시 그리지 않고(펼친 칸이 접힌다) 대시보드·설정 목록만 다시 그린다
  window.renderEvInbox?.(); window.renderConf?.(); window.renderExh?.();
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
/* 처리·읽음을 바꾸면 그 메일이 보이는 곳을 모두 다시 그린다 — 대시보드를 빠뜨려
   «처리 완료»를 눌러도 대시보드에 그대로 남아 있었다 */
function rerender(){
  window.renderSpeakerDr?.(); window.renderExhDr?.(); window.renderEvInbox?.();
  window.renderConf?.(); window.renderExh?.();
}

/* 메일함 → 기록. 보낸메일함(연사)과 받은메일함(연사·참가사)을 한 번에 읽어
   무엇을 남길지 먼저 보여 주고, 확인하면 남긴다. 새로 남길 게 없어도 예전에 본문
   없이 들어간 기록의 본문·분류·시각은 묻지 않고 채운다(그 칸만 바꾼다). */
export async function runMailSync(evKey, say = () => {}){
  say('보낸메일함·받은메일함 읽는 중… (메일이 많으면 1분쯤 걸려요)', true);
  const [r, q] = await Promise.all([syncSentMail(evKey, false), syncInboxMail(evKey, false)]);
  if(!r.ok && !q.ok){ say(r.error || q.error || '읽지 못했어요.'); return; }
  const sTodo = r.ok ? (r.items || []).filter(x => !x.dup) : [];
  const iTodo = q.ok ? (q.items || []).filter(x => !x.dup) : [];
  const stamp = r.ok ? [...new Set((r.items || []).filter(x => x.stamp).map(x => x.name))] : [];
  const list = (arr, fmt) => arr.slice(0, 15).map(fmt).join('\n') + (arr.length > 15 ? `\n… 외 ${arr.length - 15}통` : '');
  const miss = r.ok ? (r.unmatchedSpeakers || []).map(x => `${x.name}${x.email ? ` (${x.email})` : ' (메일 없음)'}`) : [];
  const msg = (r.ok ? `보낸메일함 «${r.sentPath}» ${r.scanned}통 → 연사·참가사에게 보낸 메일 ${(r.items || []).length}통 (이미 있는 ${(r.items || []).length - sTodo.length}통 건너뜀)\n`
      : `보낸메일함을 읽지 못했어요: ${r.error}\n`)
    + (q.ok ? `받은메일함 ${q.scanned}통 → 연사·참가사가 보낸 메일 ${(q.items || []).length}통 (이미 있는 ${(q.items || []).length - iTodo.length}통 건너뜀)${q.skipped && q.skipped.length ? ` · 진행 완료라 뺀 것: ${q.skipped.join(', ')}` : ''}\n\n`
      : `받은메일함을 읽지 못했어요: ${q.error}\n\n`)
    + (sTodo.length ? `[보낸 메일 남길 것]\n${list(sTodo, x => `· ${x.at || x.date} ${x.t === 'ex' ? '(참가사) ' : ''}${x.name} — ${x.subject} [${x.category || '기타'}]`)}\n\n` : '')
    + (iTodo.length ? `[받은 메일 남길 것]\n${list(iTodo, x => `· ${x.at || x.date} ${x.t === 'ex' ? '(참가사) ' : ''}${x.name} — ${x.subject}`)}\n\n` : '')
    + (stamp.length ? `초청 «보냄»으로 체크: ${stamp.join(', ')}\n\n` : '')
    + (q.ok && (q.replyNames || []).length ? `«참석 회신 받음»으로 체크: ${q.replyNames.join(', ')}\n\n` : '')
    + (miss.length ? `보낸 메일을 못 찾은 연사: ${miss.join(', ')}\n\n` : '');

  let a = { added: 0, stamped: 0, filled: 0, sorted: 0 }, b = { added: 0 };
  const replyN = q.ok ? (q.replyNames || []).length : 0;
  if(!sTodo.length && !stamp.length && !iTodo.length && !replyN){
    // 새로 남길 건 없어도 예전 기록의 빈 본문·분류·시각은 채운다
    if(r.ok && (r.items || []).length){
      const f = await syncSentMail(evKey, true);
      if(f.ok && (f.filled || f.sorted || f.stamped)){
        await reloadSpeakerData(); afterSync(evKey);
        say(`새로 남길 건 없고, ${[f.filled ? `빈 본문 ${f.filled}건 채움` : '', f.sorted ? `단계 분류 ${f.sorted}건 고침` : '',
          f.stamped ? `초청 체크 ${f.stamped}명` : ''].filter(Boolean).join(' · ')} — 연사 화면에 바로 보입니다.`, true);
        return;
      }
    }
    say('새로 남길 게 없어요.', true); alert(msg + '새로 남길 게 없어요.'); return;
  }
  if(!confirm(msg + '이대로 남길까요?')){ say('', true); return; }
  say('남기는 중…', true);
  if(r.ok){ a = await syncSentMail(evKey, true); if(!a.ok){ say(a.error || '보낸 메일을 남기지 못했어요.'); return; } }
  /* 받은메일함은 늘 한 번 더 부른다 — 바로 위에서 «초청 보냄»이 새로 찍힌 연사는 미리보기 땐
     회신 대상이 아니었다가 지금은 맞을 수 있다(서버가 다시 계산한다) */
  if(q.ok){ b = await syncInboxMail(evKey, true); if(!b.ok){ say(b.error || '받은 메일을 남기지 못했어요.'); return; } }
  trackAction('edit', '메일함 가져오기', evKey, `보낸 ${a.added}건 · 받은 ${b.added}건 · 초청 체크 ${a.stamped}명 · 회신 체크 ${b.replied || 0}명`);
  // 서버가 바꾼 기록을 바로 다시 읽는다 — 새로고침해야 보이면 안 남은 줄 안다
  const fresh = await reloadSpeakerData();
  afterSync(evKey);   // 설정 목록·대시보드를 바로 다시 그린다
  say(`보낸 ${a.added}건 · 받은 ${b.added}건 · 초청 체크 ${a.stamped}명${b.replied ? ` · 참석 회신 체크 ${b.replied}명` : ''}${a.filled ? ` · 빈 본문 ${a.filled}건 채움` : ''}${a.sorted ? ` · 단계 분류 ${a.sorted}건 고침` : ''} 남겼어요${fresh ? ' — 연사·참가사 화면에 바로 보입니다.' : ' — 새로고침하면 보입니다.'}`, true);
}


/* 가져온 뒤 다시 그릴 곳 — 설정 목록·컨퍼런스·전시 대시보드 */
function afterSync(evKey){
  window.renderEvInbox?.(evKey); window.renderConf?.(); window.renderExh?.();
}

/* ══════════════════════════════════════════
   대시보드 «메일함» 카드

   숫자 셋(안 읽음 · 처리 안 함 · 3일 넘게 처리 안 함) + 마지막 가져온 시각과 «지금
   가져오기». 메일은 15분마다 자동으로 가져오지만, 숫자가 언제 기준인지 보여야 믿는다.
   컨퍼런스는 «새 회신»(자동 체크된 회신 — 참석/불참을 사람이 확인),
   전시는 «새 문의 후보»(담당자 메일을 문의로 올릴지 고른다).
   part: 'conf' | 'exh'
══════════════════════════════════════════ */
const STALE_DAYS = 3;
const ageDays = (ts) => {
  const d = new Date(String(ts || '').slice(0, 10));
  return isNaN(d) ? 0 : Math.floor((new Date(td()) - d) / 864e5);
};
export const isStale = (l) => isPending(l) && ageDays(l.ts) >= STALE_DAYS;
const dashFil = { conf: 'pending', exh: 'pending' };

function inboxRows(evKey, part){
  if(part === 'conf'){
    const sp = new Map(SPEAKERS.filter(x => x.event_id === evKey && x.status !== '취소')
      .map(x => [x.id, x.name_snapshot || x.name_en || x.id]));
    return SPEAKER_LOGS.filter(l => sp.has(l.speaker_id) && isInbound(l))
      .map(l => ({ l, t: 'sp', id: l.speaker_id, who: sp.get(l.speaker_id) }));
  }
  const ex = new Map(EXHIBITORS.filter(x => x.event_id === evKey).map(x => [x.id, x.company_name || x.id]));
  return EXH_LOGS.filter(l => ex.has(l.exhibitor_id) && isInbound(l))
    .map(l => ({ l, t: 'ex', id: l.exhibitor_id, who: ex.get(l.exhibitor_id) }));
}

export function mailCardHtml(evKey, part){
  const rows = inboxRows(evKey, part).sort((a, b) => String(b.l.ts || '').localeCompare(String(a.l.ts || '')));
  const n = { unread: rows.filter(r => isUnread(r.l)).length, pending: rows.filter(r => isPending(r.l)).length,
    stale: rows.filter(r => isStale(r.l)).length };
  const f = dashFil[part];
  const shown = rows.filter(r => f === 'unread' ? isUnread(r.l) : f === 'stale' ? isStale(r.l) : isPending(r.l));
  const open = (r) => r.t === 'sp' ? `openSpeakerDr('${escAttr(r.id)}','box')` : `openExhDr('${escAttr(r.id)}','box')`;
  const num = (k, label, color) => `<button class="seg-b${f === k ? ' on' : ''}" onclick="setDashMailFil('${part}','${k}')"
      style="${n[k] && color ? `color:${color};font-weight:700` : ''}">${label} ${n[k]}</button>`;
  const row = (r) => `<div onclick="${open(r)}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;background:var(--i9);margin-bottom:4px">
      <span style="font-size:10.5px;color:var(--i4);flex:0 0 auto">${escapeHtml(String(r.l.ts || '').slice(5, 16))}</span>
      <span style="flex:0 0 110px;font-weight:${isUnread(r.l) ? 800 : 600};font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${isUnread(r.l) ? '● ' : ''}${escapeHtml(r.who)}</span>
      <span style="font-size:11.5px;color:var(--i3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.l.subject || '(제목 없음)')}</span>
      ${ageDays(r.l.ts) > 0 ? `<span class="pill ${ageDays(r.l.ts) >= STALE_DAYS ? 'p-amber' : 'p-gray'}" style="flex:0 0 auto">${ageDays(r.l.ts)}일</span>` : ''}
    </div>`;

  /* 새 회신 — 자동으로 «회신 받음»이 찍힌 연사. «참석이 어렵다»도 회신이라 사람이 본다 */
  const replies = part === 'conf' ? SPEAKERS.filter(x => x.event_id === evKey && x.reply_auto === 'yes' && x.status !== '취소') : [];
  const lastIn = (spId) => SPEAKER_LOGS.filter(l => l.speaker_id === spId && isInbound(l))
    .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))[0];
  /* 새 문의 후보 — 참가사 받은 메일 중 아직 처리 안 한 것 */
  const cands = part === 'exh' ? rows.filter(r => isPending(r.l) && r.l.kind !== 'inquiry').slice(0, 5) : [];

  setTimeout(() => fillMailCard(evKey, part), 0);
  return `<div class="uc">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <div class="uc-ttl" style="margin:0">메일함</div>
      <span style="font-size:10.5px;color:var(--i4)" id="mcard-last-${part}">마지막 가져옴 확인 중…</span>
      <span id="mcard-un-${part}"></span>
      <button class="btn" style="font-size:10.5px;margin-left:auto" onclick="dashMailSync('${escAttr(evKey)}','${part}')">↻ 지금 가져오기</button>
    </div>
    <div id="mcard-msg-${part}" style="font-size:10.5px;color:var(--i4);min-height:0"></div>
    <div class="seg" style="margin:8px 0 6px">${num('unread', '● 안 읽음', 'var(--re)')}${num('pending', '처리 안 함', 'var(--am)')}${num('stale', `${STALE_DAYS}일 넘게 처리 안 함`, 'var(--re)')}</div>
    ${shown.slice(0, 8).map(row).join('') || '<div style="font-size:11px;color:var(--i5);padding:4px 2px">해당하는 메일이 없어요</div>'}
    ${shown.length > 8 ? `<div style="font-size:10.5px;color:var(--i4);padding:2px">외 ${shown.length - 8}건 — 설정 › 행사 › 메일에서 모두 볼 수 있어요</div>` : ''}
    ${replies.length ? `<div style="font-size:11px;font-weight:700;color:var(--i2);margin:12px 0 4px">새 회신 <span style="font-weight:400;color:var(--i4)">— 자동으로 «회신 받음» 체크됨, 내용을 보고 참석 여부를 골라주세요</span></div>
      ${replies.map(sp => { const l = lastIn(sp.id); return `<div style="display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:6px;background:var(--i9);margin-bottom:4px">
        <span style="font-size:10.5px;color:var(--i4)">${escapeHtml(sp.invite_replied_at || '')}</span>
        <span style="font-weight:700;font-size:11.5px;flex:0 0 auto">${escapeHtml(sp.name_snapshot || sp.name_en || '')}</span>
        <span style="font-size:11px;color:var(--i3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l ? l.subject || '' : '')}</span>
        <button class="btn bp" style="font-size:10px" onclick="confirmReply('${escAttr(sp.id)}',true)">참석</button>
        <button class="btn" style="font-size:10px;color:var(--re)" onclick="confirmReply('${escAttr(sp.id)}',false)">불참</button>
        <button class="btn" style="font-size:10px" onclick="openSpeakerDr('${escAttr(sp.id)}','box')">보기</button></div>`; }).join('')}` : ''}
    ${cands.length ? `<div style="font-size:11px;font-weight:700;color:var(--i2);margin:12px 0 4px">새 문의 후보 <span style="font-weight:400;color:var(--i4)">— 답할 일이면 문의로 올리세요(«미답변 문의»로 셉니다)</span></div>
      ${cands.map(r => `<div style="display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:6px;background:var(--i9);margin-bottom:4px">
        <span style="font-weight:700;font-size:11.5px;flex:0 0 110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.who)}</span>
        <span style="font-size:11px;color:var(--i3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.l.subject || '')}</span>
        <button class="btn bp" style="font-size:10px" onclick="mailToInquiry('${escAttr(r.l.id)}')">문의로 등록</button>
        <button class="btn" style="font-size:10px" onclick="setMailDone('ex','${escAttr(r.l.id)}',true)">처리 완료</button>
        <button class="btn" style="font-size:10px" onclick="${open(r)}">보기</button></div>`).join('')}` : ''}
  </div>`;
}
/* 카드가 그려진 뒤 마지막 가져온 시각을 채운다(계정 목록은 한 번 읽어 둔다) */
export async function fillMailCard(evKey, part){
  const acc = await mailAccountOf(evKey);
  const el = document.getElementById(`mcard-last-${part}`);
  if(!el) return;
  el.textContent = !acc ? '이 행사엔 공용 메일이 없어요 — 설정 › 행사 › 메일'
    : acc.last_sync_at ? `마지막 가져옴 ${acc.last_sync_at}${acc.last_sync_by === '자동' ? ' (자동)' : acc.last_sync_by ? ` (${acc.last_sync_by})` : ''}`
    : '아직 가져온 적 없어요';
  /* 주인 없는 메일 — 아는 사람과 주소가 안 맞은 받은 메일. 있으면 단추로 띄운다 */
  if(acc){
    const n = await unassignedCount(evKey);
    const u = document.getElementById(`mcard-un-${part}`);
    if(u) u.innerHTML = n ? `<button class="btn" style="font-size:10.5px;color:var(--am);font-weight:700" onclick="openUnassigned('${escAttr(evKey)}')"
      title="아는 사람과 주소가 안 맞은 받은 메일 — 연사·참가사에 연결하거나 무시합니다">주인 없는 메일 ${n}</button>` : '';
  }
}
export function setDashMailFil(part, k){ dashFil[part] = k; afterSync(); }
export async function dashMailSync(evKey, part){
  const el = document.getElementById(`mcard-msg-${part}`);
  const say = (t, ok) => { const m = document.getElementById(`mcard-msg-${part}`) || el; if(m){ m.style.color = ok ? 'var(--g)' : 'var(--re)'; m.textContent = t; } };
  await runMailSync(evKey, say);
  await mailAccountOf(evKey, true);
  fillMailCard(evKey, part);
}

/* 새 회신 확인 — 참석이면 표시만 지우고, 불참이면 섭외 상태를 «취소»로(연락 단계·엑셀에서 빠진다) */
export async function confirmReply(spId, attend){
  const sp = SPEAKERS.find(x => x.id === spId);
  if(!sp) return;
  if(!attend && !confirm(`«${sp.name_snapshot || sp.name_en}» 불참으로 처리할까요?\n섭외 상태가 «취소»로 바뀌고 연락 단계·엑셀에서 빠집니다.`)) return;
  const patch = attend ? { reply_auto: '' } : { reply_auto: '', status: '취소' };
  const prev = { reply_auto: sp.reply_auto, status: sp.status };
  Object.assign(sp, patch);
  const r = await saveSpeaker({ id: sp.id, ...patch, updated_at: td() });
  if(r && r.ok === false){ Object.assign(sp, prev); alert('저장하지 못했어요.'); }
  else trackAction('edit', attend ? '회신 확인 — 참석' : '회신 확인 — 불참', sp.event_id, sp.name_snapshot || sp.name_en || sp.id,
    { kind: 'speaker', id: sp.id });
  afterSync();
}
/* 받은 메일을 문의로 — «미답변 문의»로 세고, 문의·기록 탭에서 답변을 적는다 */
export async function mailToInquiry(logId){
  const l = EXH_LOGS.find(x => x.id === logId);
  if(!l) return;
  const prev = { kind: l.kind, status: l.status, read_at: l.read_at, read_by: l.read_by };
  const row = { id: l.id, kind: 'inquiry', status: 'open', read_at: l.read_at || nowStamp(), read_by: l.read_by || me() };
  Object.assign(l, row);
  const r = await saveExhLog(row);
  if(r && r.ok === false){ Object.assign(l, prev); alert('저장하지 못했어요.'); }
  afterSync();
}

/* ── 회신 ──
   받은 메일에서 바로 답장한다. 받는 사람은 그 메일을 보낸 사람, 제목은 «RE: …»,
   본문 아래에 원문을 인용한다. 보내면 그 받은 메일을 «처리함»으로 닫는다(창 쪽에서). */
const addrOf = (s) => {
  const m = String(s || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(s || '').split(/[\s,;]+/)[0] || '').trim();
};
export function replyDraft(l){
  const to = addrOf(l.counterpart);
  const subject = /^\s*re\s*:/i.test(l.subject || '') ? (l.subject || '') : `RE: ${l.subject || ''}`;
  const orig = String(l.body || '').replace(/\n*\[첨부\][^\n]*\s*$/, '').trim();
  const body = `\n\n\n----- Original Message -----\nFrom: ${l.counterpart || to}\nDate: ${l.ts || ''}\nSubject: ${l.subject || ''}\n\n${orig}`;
  return { logId: l.id, to: to ? [to] : [], subject, body };
}
export function replyMail(t, id){
  const l = find(t, id);
  if(!l || !isInbound(l)) return;
  const d = replyDraft(l);
  if(!d.to.length){ alert('보낸 사람 주소를 알 수 없어요.'); return; }
  if(t === 'sp') window.startSpeakerReply?.(d); else window.startExhReply?.(d);
}

window.replyMail = replyMail;
window.setMailFil = setMailFil;
window.setDashMailFil = setDashMailFil;
window.dashMailSync = dashMailSync;
window.confirmReply = confirmReply;
window.mailToInquiry = mailToInquiry;
window.markMailRead = markMailRead;
window.markMailUnread = markMailUnread;
window.setMailDone = setMailDone;
