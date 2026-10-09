/* ══════════════════════════════════════════════════════════════
   contact-tab.js — 컨택 › 오늘 할 컨택 (TM/DM 차수)

   전시 참가 독려·주선신청 안내처럼 수백 곳에 차수를 정해 전화·메일을 돌리는
   일을 한 화면에서 한다. 엑셀에서 하던 방식을 그대로 옮겼다:
     - 차수(«2차 TM · 주선신청 안내»)마다 명단이 있고
     - 한 기업에 여러 번 연락하며, 한 번 한 번을 «누가·언제·누구에게·반응»으로 남긴다
       (엑셀은 «계인_부재중 1106»을 손으로 쳤다 — 여기선 반응 단추 하나)
     - 반응은 긍정·보류·부정·미연결(부재중·번호 오류·반송)

   기업마다 지금 무엇을 할 차례인지 보인다(전시·연사 화면의 «보낼 차례»와 같은 말투):
     걸 차례       이 차수에서 아직 한 번도 연락하지 않음
     다시 걸 차례  연락했지만 안 끝났고 다음 연락일이 됐음(비었으면 곧바로)
     기다림        다음 연락일·연락 자제일이 아직 안 됨
     끝남          목표 달성, 또는 부정·대상 아님으로 끝냄

   협의 보드(crm-tab.js의 칸반)와는 따로다 — 그쪽은 몇 번 만나 결정되는 소수의 건이다.
   데이터: contact_rounds · round_members · contact_attempts (schema.sql 참고)
══════════════════════════════════════════════════════════════ */
import {
  EVENT_LIST, CO_DB, contacts, participations, currentUser, hasLeft, crmV, curApp,
  CONTACT_ROUNDS, ROUND_MEMBERS, CONTACT_ATTEMPTS,
} from '../state.js';
import {
  saveRound, deleteRound, saveRoundMember, deleteRoundMembers, addRoundMembers,
  saveAttempt, deleteAttempt,
} from '../api.js';
import { escapeHtml, escAttr, td, nowStamp } from '../utils.js';
import { trackAction } from './audit-tab.js';
import { postToSheet, reloadContactData } from '../api.js';
import { buildCoDB } from './company-tab.js';

/* ── 반응 — 채널마다 누를 수 있는 것이 다르다. next: 다음 연락까지 며칠(0=곧바로),
   close: 이 반응이면 끝낸다. 값은 여기 한 곳에만 둔다. ── */
export const REACTIONS = {
  positive: { label: '긍정',     cls: 'p-green', next: 2 },
  hold:     { label: '보류',     cls: 'p-amber', next: 3 },
  negative: { label: '부정',     cls: 'p-red',   close: true },
  noanswer: { label: '부재중',   cls: 'p-gray',  next: 0, miss: true, retry: true },
  wrongnum: { label: '번호 오류', cls: 'p-red',   next: 0, miss: true },
  sent:     { label: '보냄',     cls: 'p-blue',  next: 3 },
  bounce:   { label: '반송',     cls: 'p-red',   next: 0, miss: true },
  reply:    { label: '회신',     cls: 'p-green', next: 2 },
};
const CH_REACTIONS = {
  TM:   ['positive', 'hold', 'negative', 'noanswer', 'wrongnum'],
  DM:   ['sent', 'reply', 'bounce', 'negative'],
  문자: ['sent', 'reply', 'negative'],
};
const CHANNELS = Object.keys(CH_REACTIONS);
const STATES = {
  todo:  { label: (v) => `${v} 차례`,     cls: 'p-blue' },
  again: { label: (v) => `다시 ${v} 차례`, cls: 'p-amber' },
  wait:  { label: () => '기다림',          cls: 'p-gray' },
  done:  { label: () => '끝남',            cls: 'p-green' },
};
const verbOf = (ch) => (ch === 'TM' ? '걸' : '보낼');
const DEFAULT_NOANSWER_LIMIT = 4;
const DEFAULT_RETRY_HOURS = 2;
/* 부재중이면 몇 시간 뒤에 다시 «다시 걸 차례» — 바로 다시 서면 방금 안 받은 곳을 맨 위에서
   또 잡게 된다(엑셀에서도 «부재중 1106, 1725»처럼 몇 시간 뒤에 다시 걸었다).
   차수마다 정한다(contact_rounds.retry_hours). 비면 2시간 */
function retryAt(m, atts){
  const a = atts[0];
  if(!a || !REACTIONS[a.reaction]?.retry) return '';
  const r = roundById(m.round_id);
  const h = r && r.retry_hours !== '' && r.retry_hours != null && !isNaN(+r.retry_hours) ? +r.retry_hours : DEFAULT_RETRY_HOURS;
  if(!h) return '';
  const d = new Date(String(a.at).replace(' ', 'T'));
  if(isNaN(d)) return '';
  d.setMinutes(d.getMinutes() + Math.round(h * 60));
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ── 화면 상태 ── */
const LS_ROUND = 'contact_round';
let curRoundId = (() => { try { return localStorage.getItem(LS_ROUND) || null; } catch(e){ return null; } })();
let stFil = 'now';                 // now(걸 차례+다시 걸 차례) | todo | again | wait | done | all
const histOpen = new Set();        // 기록을 펼친 명단 줄
const personForm = {};             // 줄마다 열어 둔 담당자 칸 — { mid: 'new' | 연락처 id }
const editOpen = new Set();        // 주의사항 등을 고치는 중인 줄
const pickedContact = {};          // 줄마다 고른 사람 — 반응 단추를 누르면 이 사람으로 기록된다
/* 고른 사람 — 고른 적이 없으면 지난번에 연락한 사람, 그것도 없으면 맨 위 사람 */
export function pickedPersonId(m, people = peopleOf(m)){
  if(pickedContact[m.id] !== undefined) return pickedContact[m.id];
  const lastCid = attemptsOf(m.id)[0]?.contact_id;
  return people.some(p => String(p.id) === String(lastCid)) ? String(lastCid) : String(people[0]?.id ?? '');
}
const pickedChannel = {};          // 줄마다 고른 채널
let showLimit = 150;
let srcFil = '';                   // 명단 거르기 — 명단을 나눠 맡을 때
let missFil = false;               // 미연결이 정한 횟수 넘게 이어진 곳만
const memoDraft = {};              // 줄마다 치던 메모 — 화면을 다시 그려도 남게
let busy = 0;                      // 저장 중인 일 — 이 동안 받아 온 것은 덮어쓰지 않는다
let lastSync = '';

/* ── 거는 중 ── 전화번호를 누르거나 «거는 중»을 누르면 찍힌다. 10분 지나면 없는 것으로 본다 */
const CALL_MIN = 10;
const myName = () => currentUser?.name || currentUser?.email || '';
function callingOf(m){
  if(!m.calling_by || !m.calling_at) return null;
  const mins = (Date.now() - new Date(String(m.calling_at).replace(' ', 'T')).getTime()) / 60000;
  return mins >= -1 && mins < CALL_MIN ? { by: m.calling_by, mins: Math.max(0, Math.floor(mins)), me: m.calling_by === myName() } : null;
}
const othersCalling = (m) => { const c = callingOf(m); return c && !c.me ? 1 : 0; };

/* ══════════════════════════════════════════
   조회
══════════════════════════════════════════ */
export const roundById = (id) => CONTACT_ROUNDS.find(r => r.id === id) || null;
export const membersOf = (rid) => ROUND_MEMBERS.filter(m => m.round_id === rid);
export const attemptsOf = (mid) => CONTACT_ATTEMPTS.filter(a => a.member_id === mid)
  .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
const evOf = (key) => EVENT_LIST.find(e => e.key === key) || null;
export const evLabel = (key) => { const e = evOf(key); return e ? (e.short || e.name || e.key) : (key || '행사 없음'); };
const today = () => td();
function addDays(n){
  const d = new Date(); d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const genId = (prefix, i = 0) => `${prefix}${Date.now()}_${i}`;

/* 기업 목록 — 기업DB(CO_DB)가 정본이다. 비어 있으면(시험 모드) 연락처의 소속으로 묶는다. */
let fbCache = null, fbSig = '';
export function coList(){
  if(CO_DB.length) return CO_DB;
  // 카드마다 부르므로 연락처·참가 기록이 그대로면 다시 묶지 않는다
  const sig = `${contacts.length}|${participations.length}`;
  if(fbCache && fbSig === sig) return fbCache;
  const map = new Map();
  contacts.forEach(c => {
    const nm = String(c.orgKo || c.orgEn || '').trim();
    if(!nm) return;
    const key = 'name:' + nm;
    if(!map.has(key)) map.set(key, { key, nameKo: c.orgKo || '', nameEn: c.orgEn || '', contacts: [], events: [], country: c.country || '' });
    map.get(key).contacts.push(c);
  });
  // 행사 이력도 같은 모양(events[].key·roles)으로 — 명단 채우기가 이걸 본다
  const byCid = new Map(); map.forEach(co => co.contacts.forEach(c => byCid.set(c.id, co)));
  participations.forEach(p => {
    const co = byCid.get(p.contactId);
    if(!co) return;
    let e = co.events.find(x => x.key === p.eventId);
    if(!e) co.events.push(e = { key: p.eventId, roles: [] });
    if(p.role && !e.roles.includes(p.role)) e.roles.push(p.role);
  });
  fbSig = sig;
  return (fbCache = [...map.values()]);
}
export const coOf = (orgId) => coList().find(c => c.key === orgId) || null;
const coName = (co) => (co ? (co.nameKo || co.nameEn || '') : '');
export const memberName = (m) => coName(coOf(m.org_id)) || m.org_name || '(이름 없음)';
/* 기업에 딸린 담당자 — 원본 연락처로 돌려준다.
   기업DB(CO_DB)의 contacts는 화면용으로 줄인 사본이라(name·email·phone, 휴대폰·부서·
   두 번째 메일 없음) 그대로 쓰면 메일이 있는 사람도 «메일 없음»으로 보였다. */
let cById = null, cByIdN = -1;
function contactOf(id){
  if(!cById || cByIdN !== contacts.length){ cById = new Map(contacts.map(c => [String(c.id), c])); cByIdN = contacts.length; }
  return cById.get(String(id)) || null;
}
export function fullContacts(co){
  return (co ? co.contacts : []).map(p => contactOf(p.id) || p);
}
export function peopleOf(m){
  return fullContacts(coOf(m.org_id)).filter(c => !hasLeft(c))
    .sort((a, b) => (!!(b.phone1 || b.phone2) - !!(a.phone1 || a.phone2)));
}

/* 이 줄이 지금 무엇을 할 차례인가 */
export function memberState(m, atts = attemptsOf(m.id)){
  if(m.goal_at || m.closed_at) return 'done';
  const t = today();
  if(m.hold_until && m.hold_until > t) return 'wait';
  if(!atts.length) return 'todo';
  if(m.next_at && m.next_at > t) return 'wait';
  const ra = retryAt(m, atts);
  if(ra && ra > nowStamp()) return 'wait';
  return 'again';
}
/* 끊기지 않고 이어진 미연결 횟수 — 부재중이 계속되면 DM으로 넘길지 묻는다 */
function missStreak(atts){
  let n = 0;
  for(const a of atts){ if(REACTIONS[a.reaction]?.miss) n++; else break; }
  return n;
}

/* ══════════════════════════════════════════
   왼쪽 — 행사 › 차수
══════════════════════════════════════════ */
export function renderRoundNav(){
  const el = document.getElementById('round-nav');
  if(!el) return;
  if(curRoundId && !roundById(curRoundId)) curRoundId = null;
  if(!curRoundId){
    const open = CONTACT_ROUNDS.filter(r => r.status !== 'closed');
    curRoundId = (open[open.length - 1] || CONTACT_ROUNDS[CONTACT_ROUNDS.length - 1] || {}).id || null;
  }
  const byEv = new Map();
  CONTACT_ROUNDS.forEach(r => { if(!byEv.has(r.event_id)) byEv.set(r.event_id, []); byEv.get(r.event_id).push(r); });
  // 최근 행사가 위로
  const evKeys = [...byEv.keys()].sort((a, b) =>
    String(evOf(b)?.date || '').localeCompare(String(evOf(a)?.date || '')));
  el.innerHTML = evKeys.map(k => `
      <div style="font-size:10.5px;color:var(--i4);padding:6px 8px 2px;font-weight:600">${escapeHtml(evLabel(k))}</div>
      ${byEv.get(k).sort((a, b) => (a.status === 'closed') - (b.status === 'closed')).map(r => {
        const ms = membersOf(r.id);
        const n = ms.filter(m => ['todo', 'again'].includes(memberState(m))).length;
        return `<button class="nr${r.id === curRoundId ? ' on' : ''}" onclick="pickRound('${escAttr(r.id)}')"
          style="${r.status === 'closed' ? 'opacity:.55' : ''}" title="${escapeHtml(r.purpose || r.name || '')}">
          <span class="pill p-gray" style="margin-right:4px;padding:1px 5px">${escapeHtml(r.channel || 'TM')}</span>
          <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left">${escapeHtml(r.name || '(이름 없음)')}</span>
          <span class="nbg">${r.status === 'closed' ? '닫음' : n}</span></button>`;
      }).join('')}`).join('')
    + `<button class="nr" onclick="openRoundEditor()" style="color:var(--a)">+ 차수 만들기</button>`;
}
export function pickRound(id){
  curRoundId = id; stFil = 'now'; showLimit = 150;
  try { localStorage.setItem(LS_ROUND, id); } catch(e){}
  // 오늘 할 컨택·현황표 중 보고 있는 쪽을 다시 그린다(crm-tab.js의 renderCrm이 고른다)
  renderRoundNav(); (window.renderCrm || renderToday)();
}
/* 현황표(contact-grid.js)가 어느 차수를 보고 있는지 읽는다 */
export const currentRoundId = () => curRoundId;

/* ══════════════════════════════════════════
   가운데 — 오늘 할 컨택
══════════════════════════════════════════ */
function matchQ(m, q){
  if(!q) return true;
  const co = coOf(m.org_id);
  const hay = [memberName(m), co?.nameEn, m.source, m.caution,
    ...fullContacts(co).flatMap(c => [c.nameKo, c.nameEn, c.phone1, c.phone2, c.email1])]
    .filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

export function renderToday(){
  const el = document.getElementById('v-today');
  if(!el) return;
  const r = roundById(curRoundId);
  const addLbl = document.getElementById('crm-add-lbl');
  if(addLbl && crmV === 'today') addLbl.textContent = r ? '명단 채우기' : '차수 만들기';
  if(!r){
    el.innerHTML = `<div class="empty" style="height:auto;padding:60px 20px;text-align:center">
      <div style="font-size:14px;font-weight:600;color:var(--i2)">첫 차수를 만드세요</div>
      <p style="font-size:12px;max-width:360px;line-height:1.6">«1차 TM · 등록 안내», «2차 TM · 주선신청 안내»처럼
        차수마다 명단을 채우고, 전화·메일 한 번 한 번을 반응 단추로 남깁니다.</p>
      <button class="btn bp" onclick="openRoundEditor()">차수 만들기</button></div>`;
    return;
  }
  const verb = verbOf(r.channel);
  const all = membersOf(r.id).map(m => { const atts = attemptsOf(m.id); return { m, atts, st: memberState(m, atts) }; });
  const cnt = { todo: 0, again: 0, wait: 0, done: 0 };
  all.forEach(x => cnt[x.st]++);
  const goalN = all.filter(x => x.m.goal_at).length;
  const q = (document.getElementById('crm-q') || {}).value || '';
  const limit = +r.noanswer_limit || DEFAULT_NOANSWER_LIMIT;
  const sources = [...new Set(all.map(x => x.m.source || ''))].filter(Boolean).sort();
  if(srcFil && !sources.includes(srcFil)) srcFil = '';
  const missN = all.filter(x => x.st !== 'done' && missStreak(x.atts) >= limit).length;
  // 미연결 거르기를 켜면 상태(지금 할 곳·기다림)와 상관없이 안 끝난 곳을 다 본다 — 세는 숫자와 맞게
  let list = all.filter(x => missFil || stFil === 'all' ? true : stFil === 'now' ? (x.st === 'todo' || x.st === 'again') : x.st === stFil)
    .filter(x => matchQ(x.m, q))
    .filter(x => !srcFil || (x.m.source || '') === srcFil)
    .filter(x => !missFil || (x.st !== 'done' && missStreak(x.atts) >= limit));
  // 다시 걸 차례 → 걸 차례 → 기다림 → 끝남. 다시 걸 차례는 오래 전에 건 곳부터
  const ORDER = { again: 0, todo: 1, wait: 2, done: 3 };
  // 팀원이 거는 중인 곳은 그 묶음 맨 뒤로 — 같은 곳에 둘이 걸지 않게
  // 번호 오류·반송은 맨 뒤로 — 번호를 고치기 전엔 걸 수 없는데 맨 위에 남아 다음 곳을 막았다
  const needsFix = (x) => (x.st === 'again' && ['wrongnum', 'bounce'].includes(x.atts[0]?.reaction) ? 1 : 0);
  list.sort((a, b) => needsFix(a) - needsFix(b) || ORDER[a.st] - ORDER[b.st]
    || othersCalling(a.m) - othersCalling(b.m)
    || (a.st === 'again' ? String(a.atts[0]?.at || '').localeCompare(String(b.atts[0]?.at || '')) : 0)
    || (a.st === 'wait' ? String(a.m.next_at || a.m.hold_until || '').localeCompare(String(b.m.next_at || b.m.hold_until || '')) : 0)
    || memberName(a.m).localeCompare(memberName(b.m)));

  const t = today();
  const todayAtts = CONTACT_ATTEMPTS.filter(a => a.round_id === r.id && String(a.at || '').startsWith(t));
  const mine = todayAtts.filter(a => a.by_email === currentUser?.email).length;
  const tile = (k, label, n, color) => `<button onclick="setContactFil('${k}')"
      style="text-align:left;border:1px solid ${stFil === k ? 'var(--a)' : 'var(--i6)'};background:${stFil === k ? 'var(--ad)' : 'var(--W)'};border-radius:var(--r);padding:7px 10px;cursor:pointer">
      <div style="font-size:10.5px;color:var(--i4)">${label}</div>
      <div style="font-size:17px;font-weight:700;color:${color || 'var(--i1)'}">${n}</div></button>`;
  const period = [r.date_from, r.date_to].filter(Boolean).join(' – ');
  const dday = r.date_to ? Math.round((new Date(r.date_to) - new Date(t)) / 86400000) : null;

  el.innerHTML = `
    <div style="padding:12px 16px;border-bottom:1px solid var(--i7);background:var(--W)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="font-size:15px;font-weight:700">${escapeHtml(r.name)}</div>
        <span class="pill p-gray">${escapeHtml(evLabel(r.event_id))}</span>
        ${r.goal ? `<span class="pill p-green">목표 ${escapeHtml(r.goal)}</span>` : ''}
        ${period ? `<span style="font-size:11px;color:var(--i4)">${escapeHtml(period)}${dday !== null ? ` · ${dday >= 0 ? `D-${dday}` : '기간 지남'}` : ''}</span>` : ''}
        ${r.status === 'closed' ? '<span class="pill p-gray">닫은 차수</span>' : ''}
        <span style="margin-left:auto;display:flex;gap:5px">
          <button class="btn bs" onclick="openRoundEditor('${escAttr(r.id)}')">차수 고치기</button>
          <button class="btn bs" onclick="openRoundMail('${escAttr(r.id)}')" title="명단에 기업마다 한 통씩 — 보낸 것은 DM 기록으로 남아요">✉ 메일 보내기</button>
          <button class="btn bs bp" onclick="openFillRound()">명단 채우기</button>
        </span>
      </div>
      ${r.purpose ? `<div class="ct-purpose" style="font-size:11.5px;color:var(--i3);margin-top:4px">${escapeHtml(r.purpose)}</div>` : ''}
      <div class="ct-tiles" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:6px;margin-top:10px">
        ${tile('now', `지금 할 곳`, cnt.todo + cnt.again, 'var(--a)')}
        ${tile('todo', STATES.todo.label(verb), cnt.todo)}
        ${tile('again', STATES.again.label(verb), cnt.again, 'var(--am)')}
        ${tile('wait', '기다림', cnt.wait)}
        ${tile('done', '끝남', cnt.done)}
        ${tile('all', `목표 달성`, `${goalN}<span style="font-size:11px;color:var(--i4);font-weight:500"> / ${all.length}</span>`, 'var(--g)')}
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;font-size:11px;color:var(--i4)">
        ${sources.length > 1 ? `<select onchange="setContactSrc(this.value)" style="font-size:11px;padding:3px 4px;border:1px solid ${srcFil ? 'var(--a)' : 'var(--i6)'};border-radius:5px;color:${srcFil ? 'var(--a)' : 'var(--i2)'}">
          <option value="">명단 전체</option>${sources.map(x => `<option${x === srcFil ? ' selected' : ''}>${escapeHtml(x)}</option>`).join('')}</select>` : ''}
        ${missN ? `<label style="display:flex;align-items:center;gap:3px;cursor:pointer;color:${missFil ? 'var(--am)' : 'var(--i3)'}"><input type="checkbox" ${missFil ? 'checked' : ''} onchange="setContactMiss(this.checked)" style="margin:0">미연결 ${limit}번 이상 이어진 곳 ${missN}</label>` : ''}
        ${missFil && list.length ? `<button class="btn bs" onclick="openRoundMail('${escAttr(r.id)}',null,[${list.map(x => `'${escAttr(x.m.id)}'`).join(',')}])" title="전화가 안 닿는 곳 — 메일로 넘긴다">✉ 이 ${list.length}곳에 메일</button>` : ''}
        <span>오늘 기록 ${todayAtts.length}건 · 내 기록 ${mine}건</span>
        <span style="margin-left:auto" title="팀원이 남긴 기록을 30초마다 받아 와요">${lastSync ? `${escapeHtml(lastSync)} 받아 옴` : ''}
          <a href="javascript:void(0)" onclick="syncContactNow()" style="color:var(--a);margin-left:4px">지금 받기</a></span>
      </div>
    </div>
    <div style="padding:10px 16px 40px;display:flex;flex-direction:column;gap:7px">
      ${!all.length
        ? `<div class="empty" style="height:auto;padding:40px 10px"><p style="font-size:12px">이 차수에 아직 명단이 없어요</p>
             <button class="btn bp bs" onclick="openFillRound()">명단 채우기</button></div>`
        : !list.length
          ? `<div class="empty" style="height:auto;padding:30px 10px"><p style="font-size:12px">${q ? '찾는 곳이 없어요' : stFil === 'now' ? `지금 ${verb} 곳이 없어요 — 기다림·끝남을 눌러 보세요` : '해당하는 곳이 없어요'}</p></div>`
          : list.slice(0, showLimit).map(x => card(r, x)).join('')
            + (list.length > showLimit ? `<button class="btn" style="align-self:center" onclick="contactShowMore()">${list.length - showLimit}곳 더 보기</button>` : '')}
    </div>`;
}

/* 기다림이 언제 풀리나 — 연락 자제일 › 다음 연락일 › 부재중 다시 걸 시각 */
function waitUntil(m, atts){
  const t = today();
  if(m.hold_until && m.hold_until > t) return m.hold_until.slice(5);
  if(m.next_at && m.next_at > t) return m.next_at.slice(5);
  const ra = retryAt(m, atts);
  return ra ? (ra.slice(0, 10) === t ? ra.slice(11) : ra.slice(5)) : '';
}

function card(r, { m, atts, st }){
  const verb = verbOf(r.channel);
  const ch = pickedChannel[m.id] || r.channel || 'TM';
  const people = peopleOf(m);
  const pick = pickedPersonId(m, people);
  const co = coOf(m.org_id);
  const calling = callingOf(m);
  // 팀원이 30분 안에 남긴 기록 — 같은 곳에 또 걸기 전에 보이게
  const recentOther = atts[0] && atts[0].by_email && atts[0].by_email !== currentUser?.email
    && (Date.now() - new Date(String(atts[0].at).replace(' ', 'T')).getTime()) < 30 * 60000 ? atts[0] : null;
  const s = STATES[st];
  const miss = missStreak(atts);
  const limit = +r.noanswer_limit || DEFAULT_NOANSWER_LIMIT;
  const last = atts[0];
  const t = today();
  const overseas = co && co.country && !/^(한국|대한민국|korea|republic of korea|kr)$/i.test(String(co.country).trim());

  const person = (p) => {
    const id = String(p.id);
    const nums = [p.phone1, p.phone2].filter(Boolean);
    return `<label style="display:flex;align-items:center;flex-wrap:wrap;gap:2px 6px;font-size:11.5px;padding:2px 0;cursor:pointer">
      <input type="radio" name="cp-${escAttr(m.id)}" ${id === pick ? 'checked' : ''} onchange="pickContactPerson('${escAttr(m.id)}','${escAttr(id)}')" style="margin:0">
      <span style="font-weight:600;white-space:nowrap">${escapeHtml(p.nameKo || p.nameEn || '')}</span>
      <span style="color:var(--i4)">${escapeHtml([p.deptKo, p.titleKo].filter(Boolean).join(' '))}</span>
      ${ch === 'TM'
        ? nums.map(n => `<a href="tel:${escapeHtml(n.replace(/[^\d+]/g, ''))}" onclick="event.stopPropagation();return markCalling('${escAttr(m.id)}',true)" style="color:var(--a)">${escapeHtml(n)}</a>`).join(' · ') || '<span style="color:var(--re)">번호 없음</span>'
        : (p.email1 ? `<span style="color:var(--i3)">${escapeHtml(p.email1)}</span>` : '<span style="color:var(--re)">메일 없음</span>')}
      <a href="javascript:void(0)" onclick="event.preventDefault();openPersonForm('${escAttr(m.id)}','${escAttr(id)}')" title="번호·메일·직위 고치기" style="color:var(--i4);margin-left:2px">✎</a>
    </label>
    ${personForm[m.id] === id ? personFormHtml(m, p) : ''}`;
  };

  return `<div id="rm-${escAttr(m.id)}" style="border:1px solid ${calling && !calling.me ? 'var(--am)' : calling ? 'var(--a)' : 'var(--i6)'};border-radius:var(--r);background:var(--W);padding:9px 12px">
    <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
      <a href="javascript:void(0)" onclick="openContactCo('${escAttr(m.org_id)}')" style="font-size:13px;font-weight:700;color:var(--i1)">${escapeHtml(memberName(m))}</a>
      ${co?.country ? `<span style="font-size:10.5px;color:var(--i4)">${escapeHtml(co.country)}</span>` : ''}
      ${m.source ? `<span class="pill p-gray">${escapeHtml(m.source)}</span>` : ''}
      <span style="margin-left:auto;display:flex;gap:4px;align-items:center">
        ${atts.length ? `<span style="font-size:10.5px;color:var(--i4)">${atts.length}번째${miss ? ` · 미연결 ${miss}번 이어짐` : ''}</span>` : ''}
        <span class="pill ${m.goal_at ? 'p-green' : s.cls}">${m.goal_at ? `목표 달성 ${escapeHtml(m.goal_at.slice(5))}` : m.closed_at ? `끝냄${m.closed_reason ? ` · ${escapeHtml(m.closed_reason)}` : ''}` : escapeHtml(s.label(verb))}${
          st === 'wait' ? ` · ${escapeHtml(waitUntil(m, atts))}부터` : ''}</span>
      </span>
    </div>
    ${calling && !calling.me ? `<div style="font-size:11.5px;color:var(--am);background:var(--ab);border-radius:4px;padding:3px 7px;margin-top:5px;font-weight:600">📞 ${escapeHtml(calling.by)} 님이 거는 중 · ${calling.mins ? `${calling.mins}분 전부터` : '방금'}</div>` : ''}
    ${recentOther ? `<div style="font-size:11px;color:var(--a);margin-top:4px">${escapeHtml(recentOther.by_name || '')} 님이 ${escapeHtml(String(recentOther.at).slice(11, 16))}에 기록했어요</div>` : ''}
    ${m.caution ? `<div style="font-size:11px;color:var(--re);margin-top:4px">⚠ ${escapeHtml(m.caution)}</div>` : ''}
    ${m.hold_until && m.hold_until > t ? `<div style="font-size:11px;color:var(--am);margin-top:2px">${escapeHtml(m.hold_until)} 전에는 연락하지 않기</div>` : ''}
    ${m.call_hours || overseas ? `<div style="font-size:11px;color:var(--i3);margin-top:2px">통화 가능 시간 ${escapeHtml(m.call_hours || '— 적어 두면 여기 보여요')}</div>` : ''}
    ${last ? `<div style="font-size:11.5px;color:var(--i3);margin-top:5px">
        <b style="color:var(--i2)">${escapeHtml(String(last.at || '').slice(5))}</b> ${escapeHtml(last.by_name || '')}
        · ${escapeHtml(last.channel || '')} <span class="pill ${REACTIONS[last.reaction]?.cls || 'p-gray'}">${escapeHtml(REACTIONS[last.reaction]?.label || last.reaction || '')}</span>
        ${last.contact_name ? `· ${escapeHtml(last.contact_name)}` : ''} ${last.note ? `· ${escapeHtml(last.note)}` : ''}
        <a href="javascript:void(0)" onclick="toggleContactHist('${escAttr(m.id)}')" style="color:var(--a);margin-left:4px">${histOpen.has(m.id) ? '기록 접기' : `기록 ${atts.length}건`}</a>
      </div>` : ''}
    ${histOpen.has(m.id) ? hist(m, atts) : ''}
    ${last && !m.closed_at && !m.goal_at && last.reaction === 'wrongnum' ? `<div style="font-size:11px;color:var(--re);margin-top:4px">번호가 틀렸어요 — 담당자 옆 ✎로 번호를 고치거나 «+ 담당자 추가»로 새 사람을 넣으세요</div>` : ''}
    ${last && !m.closed_at && !m.goal_at && last.reaction === 'bounce' ? `<div style="font-size:11px;color:var(--re);margin-top:4px">메일이 반송됐어요 — 담당자 옆 ✎로 메일 주소를 고치세요</div>` : ''}
    ${miss >= limit && st !== 'done' ? `<div style="font-size:11px;color:var(--am);margin-top:4px">미연결이 ${miss}번 이어졌어요 — 채널을 DM으로 바꿔 보내거나, 끝내기를 고려하세요</div>` : ''}
    <div style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--i7)">
      ${people.length > 1 ? `<div style="font-size:10.5px;color:var(--i4);margin-bottom:2px">${ch === 'TM' ? '누구와 통화했나요' : '누구에게 보냈나요'} — 반응 단추를 누르면 고른 사람으로 기록돼요</div>` : ''}
      ${people.length ? people.map(person).join('')
        : `<div style="font-size:11.5px;color:var(--i4)">기업DB에 담당자가 없어요${co?.phone ? ` · 대표번호 <a href="tel:${escapeHtml(String(co.phone).replace(/[^\d+]/g, ''))}" style="color:var(--a)">${escapeHtml(co.phone)}</a>` : ''}</div>`}
      ${personForm[m.id] === 'new' ? personFormHtml(m, null)
        : String(m.org_id).startsWith('name:') ? ''
        : `<a href="javascript:void(0)" onclick="openPersonForm('${escAttr(m.id)}','new')" style="font-size:11px;color:var(--a);display:inline-block;margin-top:3px">+ 담당자 추가</a>`}
    </div>
    ${m.closed_at || m.goal_at ? '' : `<div class="ct-acts" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:6px">
      <select onchange="pickContactChannel('${escAttr(m.id)}',this.value)" style="font-size:11px;padding:3px 4px;border:1px solid var(--i6);border-radius:5px">
        ${CHANNELS.map(c => `<option${c === ch ? ' selected' : ''}>${c}</option>`).join('')}</select>
      ${CH_REACTIONS[ch].map(k => `<button class="btn bs ct-r${k === 'negative' ? ' ct-neg' : ''}" onclick="recordContact('${escAttr(m.id)}','${k}')">${REACTIONS[k].label}</button>`).join('')}
      <input type="text" id="ca-memo-${escAttr(m.id)}" value="${escapeHtml(memoDraft[m.id] || '')}" oninput="contactMemo('${escAttr(m.id)}',this.value)" placeholder="메모 — 반응 단추를 누르면 함께 남아요" style="flex:1;min-width:140px;font-size:11.5px;padding:4px 8px;border:1px solid var(--i6);border-radius:5px">
      ${ch === 'TM' ? `<button class="btn bs ct-call" onclick="markCalling('${escAttr(m.id)}')" title="다른 사람이 같은 곳에 걸지 않게 «거는 중»으로 보여 줘요 — 반응을 남기면 풀려요"
        style="${calling && calling.me ? 'background:var(--ad);border-color:var(--a);color:var(--a)' : ''}">${calling && calling.me ? '📞 거는 중 · 풀기' : '📞 거는 중'}</button>` : ''}
      ${people.some(p => String(p.email1 || '').includes('@')) ? `<button class="btn bs" onclick="openRoundMail('${escAttr(r.id)}','${escAttr(m.id)}')" title="이 기업에만 메일 한 통 — 보낸 것은 DM 기록으로 남아요">✉ 이 기업에 메일</button>` : ''}
    </div>`}
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px;font-size:11px;color:var(--i4)">
      ${m.closed_at || m.goal_at ? '' : `<span>다음 연락 <input type="date" value="${escapeHtml(m.next_at || '')}" onchange="setContactNext('${escAttr(m.id)}',this.value)" style="font-size:11px;border:1px solid var(--i6);border-radius:4px;padding:1px 3px"></span>`}
      <a href="javascript:void(0)" onclick="toggleContactGoal('${escAttr(m.id)}')" style="color:${m.goal_at ? 'var(--i4)' : 'var(--g)'}">${m.goal_at ? '목표 달성 취소' : `✓ ${escapeHtml(r.goal || '목표')} 달성`}</a>
      ${m.goal_at ? '' : m.closed_at
        ? `<a href="javascript:void(0)" onclick="reopenContactMember('${escAttr(m.id)}')" style="color:var(--a)">다시 열기</a>`
        : `<a href="javascript:void(0)" onclick="closeContactMember('${escAttr(m.id)}')" style="color:var(--i3)">끝내기</a>`}
      <a href="javascript:void(0)" onclick="toggleContactEdit('${escAttr(m.id)}')" style="color:var(--i3)">${editOpen.has(m.id) ? '닫기' : '주의사항·시간 고치기'}</a>
      ${atts.length ? '' : `<a href="javascript:void(0)" onclick="removeContactMember('${escAttr(m.id)}')" style="color:var(--i4)">명단에서 빼기</a>`}
    </div>
    ${editOpen.has(m.id) ? editForm(m) : ''}
  </div>`;
}

function hist(m, atts){
  const others = CONTACT_ATTEMPTS.filter(a => a.org_id === m.org_id && a.member_id !== m.id)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const line = (a, showRound) => {
    const rr = showRound ? roundById(a.round_id) : null;
    const mineLast = a === atts[0] && a.by_email === currentUser?.email;
    return `<div style="display:flex;gap:6px;font-size:11px;padding:3px 0;border-bottom:1px solid var(--i8)">
      <span style="color:var(--i4);white-space:nowrap">${escapeHtml(a.at || '')}</span>
      <span style="white-space:nowrap">${escapeHtml(a.by_name || '')}</span>
      <span style="white-space:nowrap">${escapeHtml(a.channel || '')}</span>
      <span class="pill ${REACTIONS[a.reaction]?.cls || 'p-gray'}">${escapeHtml(REACTIONS[a.reaction]?.label || a.reaction || '')}</span>
      <span style="flex:1;color:var(--i3)">${rr ? `<b>${escapeHtml(rr.name)}</b> · ` : ''}${escapeHtml([a.contact_name, a.note].filter(Boolean).join(' · '))}</span>
      ${mineLast ? `<a href="javascript:void(0)" onclick="undoContactAttempt('${escAttr(a.id)}')" style="color:var(--i4);white-space:nowrap">되돌리기</a>` : ''}
    </div>`;
  };
  return `<div style="margin-top:5px;padding:6px 8px;background:var(--i9);border-radius:5px">
    ${atts.map(a => line(a, false)).join('')}
    ${others.length ? `<div style="font-size:10.5px;color:var(--i4);margin-top:6px">다른 차수 기록</div>${others.slice(0, 20).map(a => line(a, true)).join('')}` : ''}
  </div>`;
}

/* ══════════════════════════════════════════
   담당자 더하기·고치기 — 통화하다 새 사람을 알게 되거나 번호·메일이 바뀌면
   그 자리에서 마스터DB에 넣는다. 기업DB·전시·연사 화면이 같은 연락처를 본다.
══════════════════════════════════════════ */
function personFormHtml(m, p){
  const k = p ? String(p.id) : 'new';
  const f = (key, label, val, ph = '', w = 120) => `<label style="display:flex;flex-direction:column;gap:2px;font-size:10.5px;color:var(--i4);flex:1;min-width:${w}px">${label}
    <input id="pf-${key}-${escAttr(m.id)}" value="${escapeHtml(val || '')}" placeholder="${escapeHtml(ph)}" style="font-size:11.5px;padding:4px 6px;border:1px solid var(--i6);border-radius:4px"></label>`;
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end;margin:4px 0 6px;padding:8px;background:var(--i9);border-radius:5px">
    ${p ? `<div style="width:100%;font-size:11px;font-weight:600">${escapeHtml(p.nameKo || p.nameEn || '')} 고치기</div>`
        : f('name', '이름', '', '홍길동 / John Kim', 110)}
    ${f('dept', '부서', p?.deptKo, '사업개발팀', 100)}${f('title', '직위', p?.titleKo, '팀장', 80)}
    ${f('phone1', '전화', p?.phone1, '010-0000-0000')}${f('phone2', '다른 번호', p?.phone2, '02-000-0000')}
    ${f('email', '메일', p?.email1, 'name@company.com', 170)}
    <button class="btn bs bp" onclick="savePersonForm('${escAttr(m.id)}','${escAttr(k)}')">${p ? '저장' : '추가'}</button>
    <button class="btn bs" onclick="openPersonForm('${escAttr(m.id)}','')">닫기</button>
  </div>`;
}
export function openPersonForm(mid, k){
  if(k && personForm[mid] !== k) personForm[mid] = k; else delete personForm[mid];
  renderToday();
}
/* 연락처 한 줄 — 앞 23칸(기업 연결까지)만 보낸다. 위치 배열은 보낸 칸까지만 덮으므로
   퇴사·메모 칸은 그대로 남는다(routes/data.js) */
const contactRow23 = (c) => [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
  c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2,
  c.beat, c.products, c.tags || '', c.org_id || ''];
/* 새 연락처 id — 16자리 이하(CLAUDE.md): ${Date.now()}${순번 3자리} */
const newContactId = () => Number(`${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`);

export async function savePersonForm(mid, k){
  const m = ROUND_MEMBERS.find(x => x.id === mid);
  if(!m) return;
  const v = (key) => (document.getElementById(`pf-${key}-${mid}`)?.value || '').trim();
  const email = v('email');
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ alert('메일 주소 모양이 아니에요.'); return; }
  const co = coOf(m.org_id);
  const org = co?.org || {};
  if(k === 'new'){
    const name = v('name');
    if(!name){ alert('이름을 적어주세요.'); return; }
    const ko = /[가-힣]/.test(name);
    const r = roundById(m.round_id);
    const c = {
      id: newContactId(), nameKo: ko ? name : '', nameEn: ko ? '' : name,
      orgKo: co?.nameKo || org.name_ko || m.org_name || '', orgEn: co?.nameEn || org.name_en || '',
      titleKo: v('title'), titleEn: '', deptKo: v('dept'), deptEn: '',
      country: co?.country || '', cat: 'attendee', lang: ko ? 'KO' : 'EN',
      source: `${evLabel(r?.event_id)} 컨택(${r?.name || ''})`, date: td(), status: 'new',
      email1: email, email2: '', phone1: v('phone1'), phone2: v('phone2'),
      beat: '', products: '', tags: '', org_id: m.org_id,
      left_at: '', moved_to_id: '', memo1: '', memo2: '', memo3: '', prefix: '',
    };
    if(!Number.isSafeInteger(c.id)){ alert('연락처 번호를 만들지 못했어요. 다시 눌러 주세요.'); return; }
    contacts.push(c);
    const res = await postToSheet({ sheet: 'contacts', row: contactRow23(c) }, '담당자 추가');
    if(!res.ok){ contacts.splice(contacts.indexOf(c), 1); return; }
    try { buildCoDB(); } catch(e){}
    pickedContact[mid] = String(c.id);      // 방금 넣은 사람과 연락 중일 테니 그 사람을 고른다
    delete personForm[mid];
    trackAction('add', '연락처 추가', name, `${escapeHtml(name)} / ${escapeHtml(c.orgKo || c.orgEn)} 추가 — 컨택 «${escapeHtml(r?.name || '')}»에서`,
      { kind: 'contact', id: c.id });
  } else {
    const c = contacts.find(x => String(x.id) === String(k));
    if(!c) return;
    const patch = { deptKo: v('dept'), titleKo: v('title'), phone1: v('phone1'), phone2: v('phone2'), email1: email };
    const before = Object.fromEntries(Object.keys(patch).map(x => [x, c[x] || '']));
    const changedKeys = Object.keys(patch).filter(x => before[x] !== patch[x]);
    if(!changedKeys.length){ delete personForm[mid]; renderToday(); return; }
    Object.assign(c, patch);
    const res = await postToSheet({ sheet: 'contacts', action: 'upsert', row: contactRow23(c) }, '담당자 고침');
    if(!res.ok){ Object.assign(c, before); renderToday(); return; }
    try { buildCoDB(); } catch(e){}
    delete personForm[mid];
    const what = changedKeys.map(x => ({ deptKo: '부서', titleKo: '직위', phone1: '전화', phone2: '다른 번호', email1: '메일' })[x]).join('·');
    trackAction('edit', '연락처 정보 수정', c.nameKo || c.nameEn,
      `${escapeHtml(c.nameKo || c.nameEn)} (${escapeHtml(c.orgKo || c.orgEn)}) ${what} 고침 — 컨택에서`, { kind: 'contact', id: c.id });
  }
  renderToday();
}

function editForm(m){
  const f = (k, label, type = 'text', ph = '') => `<label style="display:flex;flex-direction:column;gap:2px;font-size:10.5px;color:var(--i4);flex:1;min-width:140px">${label}
    <input type="${type}" id="rmf-${k}-${escAttr(m.id)}" value="${escapeHtml(m[k] || '')}" placeholder="${escapeHtml(ph)}" style="font-size:11.5px;padding:4px 6px;border:1px solid var(--i6);border-radius:4px"></label>`;
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;padding:8px;background:var(--i9);border-radius:5px;align-items:flex-end">
    ${f('caution', '주의사항', 'text', '성명 노출 원치 않음')}
    ${f('hold_until', '이날 전에는 연락 안 함', 'date')}
    ${f('call_hours', '통화 가능 시간', 'text', '오후 1시~4시')}
    ${f('source', '명단', 'text', '2022 전시 국내')}
    <button class="btn bs bp" onclick="saveContactMemberEdit('${escAttr(m.id)}')">저장</button>
  </div>`;
}

/* ══════════════════════════════════════════
   기록 남기기
══════════════════════════════════════════ */
/* 명단 한 줄을 고치고 저장한다 — 실패하면 되돌린다 */
async function patchMember(m, patch){
  const before = {};
  Object.keys(patch).forEach(k => { before[k] = m[k] ?? ''; });
  Object.assign(m, patch);
  renderToday(); renderRoundNav();
  busy++;
  const res = await saveRoundMember({ id: m.id, ...patch });
  busy--;
  if(!res.ok){ Object.assign(m, before); renderToday(); renderRoundNav(); return false; }
  return true;
}

export async function recordContact(mid, reaction){
  const m = ROUND_MEMBERS.find(x => x.id === mid);
  const r = m && roundById(m.round_id);
  const R = REACTIONS[reaction];
  if(!m || !r || !R) return;
  const ch = pickedChannel[mid] || r.channel || 'TM';
  const people = peopleOf(m);
  const pid = pickedPersonId(m, people);
  const p = people.find(x => String(x.id) === String(pid));
  const memoEl = document.getElementById('ca-memo-' + mid);
  const note = (memoEl?.value ?? memoDraft[mid] ?? '').trim();
  const a = {
    id: genId('CA-'), round_id: r.id, member_id: m.id, org_id: m.org_id,
    contact_id: p ? String(p.id) : '', contact_name: p ? (p.nameKo || p.nameEn || '') : '',
    phone: p ? (ch === 'TM' ? (p.phone1 || p.phone2 || '') : (p.email1 || '')) : '',
    channel: ch, at: nowStamp(), by_email: currentUser?.email || '', by_name: currentUser?.name || '',
    reaction, note,
  };
  CONTACT_ATTEMPTS.push(a);
  const prev = { next_at: m.next_at || '', closed_at: m.closed_at || '', closed_reason: m.closed_reason || '' };
  // 반응을 남기면 «거는 중»도 풀린다
  const patch = { calling_by: '', calling_at: '', ...(R.close
    ? { closed_at: today(), closed_reason: R.label, next_at: '' }
    : { next_at: R.next ? addDays(R.next) : '' }) };
  prev.calling_by = m.calling_by || ''; prev.calling_at = m.calling_at || '';
  delete memoDraft[mid];
  busy++;
  Object.assign(m, patch);
  renderToday(); renderRoundNav();
  const res = await saveAttempt(a);
  if(!res.ok){
    busy--;
    CONTACT_ATTEMPTS.splice(CONTACT_ATTEMPTS.indexOf(a), 1);
    Object.assign(m, prev);
    if(note) memoDraft[mid] = note;
    renderToday(); renderRoundNav();
    return;
  }
  const res2 = await saveRoundMember({ id: m.id, ...patch });
  busy--;
  if(!res2.ok){ Object.assign(m, prev); renderToday(); renderRoundNav(); }
  // 카드가 순서 뒤로 가거나 «기다림»으로 빠져 눈앞에서 사라진다 — 무엇을 남겼는지 아래에 알린다
  contactToast(`<b>${escapeHtml(memberName(m))}</b> — ${escapeHtml(ch)} ${escapeHtml(R.label)}${a.contact_name ? ` (${escapeHtml(a.contact_name)})` : ''} 기록함`,
    `undoContactAttempt('${escAttr(a.id)}',true)`);
  trackAction('log', '컨택 기록', memberName(m),
    `<b>${escapeHtml(memberName(m))}</b> · ${escapeHtml(r.name)} · ${escapeHtml(ch)} <b>${escapeHtml(R.label)}</b>${
      a.contact_name ? ` (${escapeHtml(a.contact_name)})` : ''}${note ? ` — ${escapeHtml(note)}` : ''}`,
    { kind: 'round_member', id: m.id });
}

export async function undoContactAttempt(aid, quiet){
  const a = CONTACT_ATTEMPTS.find(x => x.id === aid);
  if(!a || (!quiet && !confirm('방금 남긴 기록을 지울까요?'))) return;
  document.getElementById('contact-toast')?.remove();
  const m = ROUND_MEMBERS.find(x => x.id === a.member_id);
  const i = CONTACT_ATTEMPTS.indexOf(a);
  CONTACT_ATTEMPTS.splice(i, 1);
  renderToday(); renderRoundNav();
  const res = await deleteAttempt(aid);
  if(!res.ok){ CONTACT_ATTEMPTS.push(a); renderToday(); renderRoundNav(); return; }
  // 그 기록이 끝낸 줄이었다면 다시 연다
  if(m && m.closed_at && REACTIONS[a.reaction]?.close) await patchMember(m, { closed_at: '', closed_reason: '' });
}

export function setContactNext(mid, v){
  const m = ROUND_MEMBERS.find(x => x.id === mid);
  if(m) patchMember(m, { next_at: v || '' });
}
export async function toggleContactGoal(mid){
  const m = ROUND_MEMBERS.find(x => x.id === mid);
  if(!m) return;
  const on = !m.goal_at;
  if(await patchMember(m, { goal_at: on ? today() : '' })){
    const r = roundById(m.round_id);
    trackAction('status', on ? '컨택 목표 달성' : '컨택 목표 달성 취소', memberName(m),
      `<b>${escapeHtml(memberName(m))}</b> · ${escapeHtml(r?.name || '')} — ${escapeHtml(r?.goal || '목표')} ${on ? '달성' : '달성 취소'}`,
      { kind: 'round_member', id: m.id });
  }
}
export async function closeContactMember(mid){
  const m = ROUND_MEMBERS.find(x => x.id === mid);
  if(!m) return;
  const why = prompt('왜 끝내나요? (예: 대상 아님 · 참가 안 함 · 담당자 없음)', '');
  if(why === null) return;
  await patchMember(m, { closed_at: today(), closed_reason: why.trim() });
}
export function reopenContactMember(mid){
  const m = ROUND_MEMBERS.find(x => x.id === mid);
  if(m) patchMember(m, { closed_at: '', closed_reason: '' });
}
export async function saveContactMemberEdit(mid){
  const m = ROUND_MEMBERS.find(x => x.id === mid);
  if(!m) return;
  const v = (k) => (document.getElementById(`rmf-${k}-${mid}`)?.value || '').trim();
  const patch = { caution: v('caution'), hold_until: v('hold_until'), call_hours: v('call_hours'), source: v('source') };
  editOpen.delete(mid);
  await patchMember(m, patch);
}
export async function removeContactMember(mid){
  const m = ROUND_MEMBERS.find(x => x.id === mid);
  if(!m || attemptsOf(mid).length) return;
  if(!confirm(`«${memberName(m)}»을(를) 이 차수 명단에서 뺄까요?`)) return;
  const i = ROUND_MEMBERS.indexOf(m);
  ROUND_MEMBERS.splice(i, 1);
  renderToday(); renderRoundNav();
  const res = await deleteRoundMembers([mid]);
  if(!res.ok){ ROUND_MEMBERS.splice(i, 0, m); renderToday(); renderRoundNav(); }
}

export function setContactFil(k){ stFil = k; showLimit = 150; renderToday(); }
export function setContactSrc(v){ srcFil = v; showLimit = 150; renderToday(); }
export function setContactMiss(on){ missFil = !!on; showLimit = 150; renderToday(); }
/* 치던 메모는 담아만 둔다 — 다시 그리지 않는다 */
export function contactMemo(mid, v){ memoDraft[mid] = v; }

/* «거는 중» — 전화번호를 누르면(fromTel) 찍고, 단추는 찍고 풀기를 오간다.
   팀원이 거는 중이면 한 번 묻는다. 전화번호 링크에서 false를 돌려주면 전화가 걸리지 않는다 */
export function markCalling(mid, fromTel){
  const m = ROUND_MEMBERS.find(x => x.id === mid);
  if(!m) return true;
  const c = callingOf(m);
  if(c && !c.me && !confirm(`${c.by} 님이 ${c.mins ? `${c.mins}분 전부터` : '방금'} 이곳에 거는 중이에요. 그래도 걸까요?`)) return false;
  if(c && c.me && !fromTel){ patchMember(m, { calling_by: '', calling_at: '' }); return true; }
  if(!(c && c.me)) patchMember(m, { calling_by: myName(), calling_at: nowStamp() });
  return true;
}

/* 아래 알림 — 6초 뒤 사라진다. 되돌리기를 누르면 방금 기록을 지운다 */
function contactToast(html, undo){
  document.getElementById('contact-toast')?.remove();
  const el = document.createElement('div');
  el.id = 'contact-toast';
  el.style.cssText = 'position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:1100;background:var(--i1);color:#fff;border-radius:8px;padding:9px 14px;font-size:12px;display:flex;gap:12px;align-items:center;box-shadow:var(--shl);max-width:calc(100vw - 32px)';
  el.innerHTML = `<span>${html}</span>${undo ? `<a href="javascript:void(0)" onclick="${undo}" style="color:#9DB4FF;font-weight:700;white-space:nowrap">되돌리기</a>` : ''}`;
  document.body.appendChild(el);
  setTimeout(() => { if(el.isConnected) el.remove(); }, 6000);
}

/* ══════════════════════════════════════════
   팀원 기록 받아 오기 — 여럿이 같은 명단을 동시에 돌린다.
   컨택 화면을 보고 있을 때만 30초마다, 그리고 창으로 돌아올 때 받는다.
   치던 칸이 있거나(입력에 손이 가 있거나 고치는 칸이 열려 있으면) 그 차례는 건너뛴다 —
   다시 그리면 치던 글자가 날아간다. 저장 중일 때도 건너뛴다(방금 넣은 줄이 잠깐 사라진다).
══════════════════════════════════════════ */
const SYNC_MS = 30000;
const sig = (o) => `${o.rounds.length}|${o.members.length}|${o.attempts.length}|${JSON.stringify(o.members.map(m => [m.id, m.next_at, m.goal_at, m.closed_at, m.calling_by, m.calling_at, m.caution, m.hold_until]))}|${o.attempts.map(a => a.id).join(',').length}`;
const contactViewOn = () => curApp === 'crm' && ['today', 'grid', 'report'].includes(crmV);
function typing(){
  const a = document.activeElement;
  const inView = a && a.closest && a.closest('#v-today') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  return inView || Object.keys(personForm).length || editOpen.size
    || document.getElementById('round-ed') || document.getElementById('round-fill') || document.getElementById('round-import');
}
export async function syncContactNow(force){
  if(busy) return;
  const data = await reloadContactData();
  if(!data || busy) return;
  const before = sig({ rounds: CONTACT_ROUNDS, members: ROUND_MEMBERS, attempts: CONTACT_ATTEMPTS });
  const p = (n) => String(n).padStart(2, '0');
  const d = new Date();
  lastSync = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if(sig(data) === before && !force){ const s2 = document.querySelector('#v-today [title^="팀원이 남긴"]'); if(s2) s2.firstChild.textContent = `${lastSync} 받아 옴`; return; }
  if(!force && typing()) return;
  CONTACT_ROUNDS.splice(0, CONTACT_ROUNDS.length, ...data.rounds);
  ROUND_MEMBERS.splice(0, ROUND_MEMBERS.length, ...data.members);
  CONTACT_ATTEMPTS.splice(0, CONTACT_ATTEMPTS.length, ...data.attempts);
  renderRoundNav();
  window.renderCrm?.();
}
setInterval(() => { if(document.visibilityState === 'visible' && contactViewOn()) syncContactNow(); }, SYNC_MS);
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'visible' && contactViewOn()) syncContactNow(); });
export function contactShowMore(){ showLimit += 150; renderToday(); }
export function toggleContactHist(mid){ histOpen.has(mid) ? histOpen.delete(mid) : histOpen.add(mid); renderToday(); }
export function toggleContactEdit(mid){ editOpen.has(mid) ? editOpen.delete(mid) : editOpen.add(mid); renderToday(); }
/* 고르기만 바꿀 때는 다시 그리지 않는다 — 치던 메모가 날아간다 */
export function pickContactPerson(mid, cid){ pickedContact[mid] = cid; }
export function pickContactChannel(mid, ch){
  const memo = document.getElementById('ca-memo-' + mid)?.value || '';
  pickedChannel[mid] = ch; renderToday();
  const el = document.getElementById('ca-memo-' + mid);
  if(el) el.value = memo;
}
export function openContactCo(orgId){
  if(!orgId || String(orgId).startsWith('name:')) return;
  window.switchApp?.('co'); window.selectCo?.(orgId);
}
/* 활동 로그에서 «바뀐 곳으로 가기» */
export function openRoundMember(mid){
  const m = ROUND_MEMBERS.find(x => x.id === mid);
  if(!m) return;
  window.switchCV?.('today');
  curRoundId = m.round_id; stFil = 'all';
  const q = document.getElementById('crm-q'); if(q) q.value = '';
  histOpen.add(mid);
  renderRoundNav(); (window.renderCrm || renderToday)();
  const el = document.getElementById('rm-' + mid);
  if(el){ el.scrollIntoView({ block: 'center' }); el.style.outline = '2px solid var(--a)'; setTimeout(() => { el.style.outline = ''; }, 1800); }
}

/* ══════════════════════════════════════════
   창 — 차수 만들기·고치기 / 명단 채우기
══════════════════════════════════════════ */
function overlay(id, html){
  let ov = document.getElementById(id);
  if(!ov){
    ov = document.createElement('div');
    ov.id = id;
    ov.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto';
    ov.addEventListener('mousedown', e => { if(e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div style="background:var(--W);border-radius:var(--rl);width:100%;max-width:560px;padding:18px 20px;box-shadow:var(--shl)">${html}</div>`;
  return ov;
}
const fld = (id, label, val = '', { type = 'text', ph = '' } = {}) =>
  `<label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--i3);margin-bottom:9px">${label}
    <input type="${type}" id="${id}" value="${escapeHtml(val)}" placeholder="${escapeHtml(ph)}" style="font-size:12.5px;padding:6px 8px;border:1px solid var(--i6);border-radius:var(--rs)"></label>`;

export function openRoundEditor(id){
  const r = id ? roundById(id) : null;
  const evs = [...EVENT_LIST].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const evSel = r?.event_id || roundById(curRoundId)?.event_id || evs[0]?.key || '';
  const nAtt = r ? CONTACT_ATTEMPTS.filter(a => a.round_id === r.id).length : 0;
  overlay('round-ed', `
    <div style="display:flex;align-items:center;margin-bottom:12px">
      <div style="font-size:15px;font-weight:700">${r ? '차수 고치기' : '차수 만들기'}</div>
      <button class="btn bs" style="margin-left:auto" onclick="document.getElementById('round-ed').remove()">닫기</button>
    </div>
    <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--i3);margin-bottom:9px">행사
      <select id="re-ev" style="font-size:12.5px;padding:6px 8px;border:1px solid var(--i6);border-radius:var(--rs)">
        ${evs.map(e => `<option value="${escapeHtml(e.key)}"${e.key === evSel ? ' selected' : ''}>${escapeHtml(e.short || e.name || e.key)}${e.date ? ` (${escapeHtml(e.date)})` : ''}</option>`).join('')}
      </select></label>
    ${fld('re-name', '차수 이름', r?.name || '', { ph: '2차 TM · 주선신청 안내' })}
    <label style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--i3);margin-bottom:9px">기본 채널 — 기록마다 바꿀 수 있어요
      <div class="seg" id="re-ch" style="align-self:flex-start">${CHANNELS.map(c =>
        `<button type="button" class="seg-b${(r?.channel || 'TM') === c ? ' on' : ''}" data-ch="${c}" onclick="this.parentNode.querySelectorAll('.seg-b').forEach(b=>b.classList.remove('on'));this.classList.add('on')">${c === 'TM' ? 'TM (전화)' : c === 'DM' ? 'DM (메일)' : '문자'}</button>`).join('')}</div></label>
    ${fld('re-purpose', '무엇을 안내하나', r?.purpose || '', { ph: '주선신청 방법 안내, 바이어 리스트 전달' })}
    ${fld('re-goal', '목표 — 이걸 하면 그 기업은 끝나요', r?.goal || '', { ph: '주선신청' })}
    <div style="display:flex;gap:8px">${fld('re-from', '시작', r?.date_from || today(), { type: 'date' })}${fld('re-to', '마감', r?.date_to || '', { type: 'date' })}</div>
    <div style="display:flex;gap:8px">${fld('re-retry', '부재중이면 몇 시간 뒤 다시 걸까요', r?.retry_hours ?? String(DEFAULT_RETRY_HOURS), { type: 'number' })}${fld('re-limit', '부재중·반송이 몇 번 이어지면 알려 줄까요', r?.noanswer_limit || String(DEFAULT_NOANSWER_LIMIT), { type: 'number' })}</div>
    ${fld('re-note', '메모', r?.note || '')}
    <div style="display:flex;gap:6px;align-items:center;margin-top:6px">
      ${r ? (nAtt
        ? `<button class="btn bs" onclick="toggleRoundClosed('${escAttr(r.id)}')">${r.status === 'closed' ? '차수 다시 열기' : '차수 닫기'}</button>
           <span style="font-size:10.5px;color:var(--i4)">기록 ${nAtt}건이 있어 지울 수 없어요</span>`
        : `<button class="btn bs" style="color:var(--re)" onclick="removeRound('${escAttr(r.id)}')">차수 지우기</button>`) : ''}
      <button class="btn bp" style="margin-left:auto" onclick="saveRoundEditor(${r ? `'${escAttr(r.id)}'` : ''})">${r ? '저장' : '만들기'}</button>
    </div>`);
  document.getElementById('re-name')?.focus();
}

export async function saveRoundEditor(id){
  const v = (k) => (document.getElementById(k)?.value || '').trim();
  const name = v('re-name');
  if(!name){ alert('차수 이름을 적어주세요.'); return; }
  if(!v('re-ev')){ alert('행사를 골라주세요.'); return; }
  const ch = document.querySelector('#re-ch .seg-b.on')?.dataset.ch || 'TM';
  const data = { event_id: v('re-ev'), name, channel: ch, purpose: v('re-purpose'), goal: v('re-goal'),
    date_from: v('re-from'), date_to: v('re-to'), noanswer_limit: v('re-limit'), retry_hours: v('re-retry'), note: v('re-note') };
  const old = id ? roundById(id) : null;
  if(old){
    const before = { ...old };
    Object.assign(old, data);
    const res = await saveRound({ id, ...data });
    if(!res.ok){ Object.assign(old, before); return; }
    trackAction('edit', '컨택 차수 고침', name, `${escapeHtml(evLabel(data.event_id))} — 차수 «${escapeHtml(name)}» 고침`);
  } else {
    const r = { id: genId('CR-'), ...data, status: 'open', created_at: nowStamp(), created_by: currentUser?.email || '' };
    CONTACT_ROUNDS.push(r);
    const res = await saveRound(r);
    if(!res.ok){ CONTACT_ROUNDS.splice(CONTACT_ROUNDS.indexOf(r), 1); return; }
    curRoundId = r.id;
    try { localStorage.setItem(LS_ROUND, r.id); } catch(e){}
    trackAction('add', '컨택 차수 만듦', name, `${escapeHtml(evLabel(data.event_id))} — 차수 «${escapeHtml(name)}» 만듦 (${escapeHtml(ch)})`);
  }
  document.getElementById('round-ed')?.remove();
  renderRoundNav(); (window.renderCrm || renderToday)();
  if(!old && !membersOf(curRoundId).length) openFillRound();
}
export async function toggleRoundClosed(id){
  const r = roundById(id);
  if(!r) return;
  const prev = r.status;
  r.status = r.status === 'closed' ? 'open' : 'closed';
  const res = await saveRound({ id, status: r.status });
  if(!res.ok){ r.status = prev; return; }
  document.getElementById('round-ed')?.remove();
  renderRoundNav(); (window.renderCrm || renderToday)();
}
export async function removeRound(id){
  const r = roundById(id);
  if(!r || CONTACT_ATTEMPTS.some(a => a.round_id === id)) return;
  const ms = membersOf(id);
  if(!confirm(`차수 «${r.name}»을(를) 지울까요?${ms.length ? `\n명단 ${ms.length}곳도 함께 빠집니다.` : ''}`)) return;
  if(ms.length){
    const res = await deleteRoundMembers(ms.map(m => m.id));
    if(!res.ok) return;
    ms.forEach(m => ROUND_MEMBERS.splice(ROUND_MEMBERS.indexOf(m), 1));
  }
  const res = await deleteRound(id);
  if(!res.ok){ renderRoundNav(); renderToday(); return; }
  CONTACT_ROUNDS.splice(CONTACT_ROUNDS.indexOf(r), 1);
  if(curRoundId === id) curRoundId = null;
  trackAction('edit', '컨택 차수 지움', r.name, `${escapeHtml(evLabel(r.event_id))} — 차수 «${escapeHtml(r.name)}» 지움`);
  document.getElementById('round-ed')?.remove();
  renderRoundNav(); (window.renderCrm || renderToday)();
}

/* ── 명단 채우기 — 행사 참가 기록(기업DB의 행사 이력)에서 고르거나, 한 곳씩 찾아 넣는다 ── */
let fill = null;   // { ev, roles:Set, picked:Set, source }
function evRoles(evKey){
  const s = new Set();
  coList().forEach(c => (c.events || []).forEach(e => { if(e.key === evKey) (e.roles || []).forEach(r => s.add(r)); }));
  return [...s];
}
function fillCandidates(){
  if(!fill?.ev) return [];
  return coList().filter(c => (c.events || []).some(e => e.key === fill.ev
    && (!fill.roles.size || (e.roles || []).some(r => fill.roles.has(r)))));
}
export function openFillRound(){
  const r = roundById(curRoundId);
  if(!r) return;
  const ev = r.event_id;
  fill = { ev, roles: new Set(), picked: null, source: '' };
  renderFill();
}
function renderFill(){
  const r = roundById(curRoundId);
  if(!r || !fill) return;
  const have = new Set(membersOf(r.id).map(m => m.org_id));
  const evs = [...EVENT_LIST].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const roles = evRoles(fill.ev);
  const cands = fillCandidates();
  const fresh = cands.filter(c => !have.has(c.key));
  if(!fill.picked) fill.picked = new Set(fresh.map(c => c.key));
  const defSource = `${evLabel(fill.ev)}${fill.roles.size ? ' ' + [...fill.roles].join('·') : ''}`;
  const memoSrc = document.getElementById('rf-src')?.value;
  overlay('round-fill', `
    <div style="display:flex;align-items:center;margin-bottom:4px">
      <div style="font-size:15px;font-weight:700">명단 채우기</div>
      <button class="btn bs" style="margin-left:auto" onclick="document.getElementById('round-fill').remove()">닫기</button>
    </div>
    <div style="font-size:11.5px;color:var(--i4);margin-bottom:12px">${escapeHtml(r.name)} · 지금 ${have.size}곳</div>
    <div style="font-size:12px;font-weight:600;margin-bottom:6px">행사 참가 기록에서</div>
    <select onchange="fillPickEv(this.value)" style="width:100%;font-size:12.5px;padding:6px 8px;border:1px solid var(--i6);border-radius:var(--rs);margin-bottom:6px">
      ${evs.map(e => `<option value="${escapeHtml(e.key)}"${e.key === fill.ev ? ' selected' : ''}>${escapeHtml(e.short || e.name || e.key)}${e.date ? ` (${escapeHtml(e.date)})` : ''}</option>`).join('')}
    </select>
    <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">
      ${roles.length ? roles.map(ro => `<button class="btn bs" onclick="fillToggleRole('${escAttr(ro)}')"
        style="${fill.roles.has(ro) ? 'background:var(--ad);border-color:var(--a);color:var(--a)' : ''}">${escapeHtml(ro)}</button>`).join('')
        : '<span style="font-size:11px;color:var(--i4)">이 행사에 참가 기록이 있는 기업이 없어요</span>'}
      ${roles.length ? `<span style="font-size:10.5px;color:var(--i4);align-self:center">${fill.roles.size ? '고른 유형만' : '유형을 안 고르면 전부'}</span>` : ''}
    </div>
    ${cands.length ? `
      <div style="font-size:11px;color:var(--i3);margin-bottom:4px">${cands.length}곳 · 이미 명단에 ${cands.length - fresh.length}곳 · 넣을 곳 <span id="rf-n">${fill.picked.size}</span>곳
        <a href="javascript:void(0)" onclick="fillAll(true)" style="color:var(--a);margin-left:6px">모두</a>
        <a href="javascript:void(0)" onclick="fillAll(false)" style="color:var(--a);margin-left:4px">모두 해제</a></div>
      <div style="max-height:240px;overflow:auto;border:1px solid var(--i7);border-radius:var(--rs);padding:4px 8px;margin-bottom:8px">
        ${cands.map(c => {
          const inR = have.has(c.key);
          return `<label style="display:flex;gap:6px;align-items:center;font-size:12px;padding:2px 0;${inR ? 'color:var(--i4)' : ''}">
            <input type="checkbox" ${inR ? 'disabled' : fill.picked.has(c.key) ? 'checked' : ''} onchange="fillToggle('${escAttr(c.key)}',this.checked)">
            ${escapeHtml(coName(c))} <span style="font-size:10.5px;color:var(--i4)">${inR ? '이미 명단에' : `담당자 ${c.contacts.filter(p => !hasLeft(p)).length}명`}</span></label>`;
        }).join('')}
      </div>
      ${fld('rf-src', '명단 이름 — 보고를 이 이름별로 나눠요', memoSrc ?? defSource)}
      <button class="btn bp" id="rf-go" onclick="fillCommit()">${fill.picked.size}곳 넣기</button>` : ''}
    <div style="font-size:12px;font-weight:600;margin:16px 0 6px;padding-top:12px;border-top:1px solid var(--i7)">옛 엑셀 TM 기록에서</div>
    <div style="font-size:11.5px;color:var(--i3);margin-bottom:6px">«TM일자/TM내용» 칸이나 «TM_1차~4차·긍정/보류/부정» 칸이 있는 엑셀 — 명단과 기록을 함께 넣어요.</div>
    <button class="btn bs" onclick="document.getElementById('round-fill').remove();openRoundImport('${escAttr(r.id)}')">엑셀 기록 가져오기</button>
    <div style="font-size:12px;font-weight:600;margin:16px 0 6px;padding-top:12px;border-top:1px solid var(--i7)">한 곳씩 찾아 넣기</div>
    <input type="text" id="rf-q" placeholder="기업명 검색" oninput="fillSearch(this.value)" style="width:100%;font-size:12.5px;padding:6px 8px;border:1px solid var(--i6);border-radius:var(--rs)">
    <div id="rf-res" style="margin-top:4px"></div>`);
}
export function fillPickEv(ev){ fill.ev = ev; fill.roles = new Set(); fill.picked = null; const s = document.getElementById('rf-src'); if(s) s.remove(); renderFill(); }
export function fillToggleRole(ro){
  fill.roles.has(ro) ? fill.roles.delete(ro) : fill.roles.add(ro);
  fill.picked = null; document.getElementById('rf-src')?.remove(); renderFill();
}
/* 체크 하나에 창을 다시 그리면 긴 목록의 스크롤이 맨 위로 튄다 — 숫자만 고친다 */
export function fillToggle(key, on){
  on ? fill.picked.add(key) : fill.picked.delete(key);
  const n = document.getElementById('rf-n'); if(n) n.textContent = fill.picked.size;
  const b = document.getElementById('rf-go'); if(b) b.textContent = `${fill.picked.size}곳 넣기`;
}
export function fillAll(on){
  const have = new Set(membersOf(curRoundId).map(m => m.org_id));
  fill.picked = new Set(on ? fillCandidates().filter(c => !have.has(c.key)).map(c => c.key) : []);
  renderFill();
}
async function addMembers(cos, source){
  const r = roundById(curRoundId);
  if(!r || !cos.length) return false;
  const now = nowStamp();
  const rows = cos.map((c, i) => ({ id: genId('RM-', i), round_id: r.id, org_id: c.key, org_name: coName(c),
    source, caution: '', hold_until: '', call_hours: '', next_at: '', goal_at: '', closed_at: '', closed_reason: '', created_at: now }));
  ROUND_MEMBERS.push(...rows);
  (window.renderCrm || renderToday)(); renderRoundNav();
  const res = await addRoundMembers(rows);
  if(!res.ok){
    rows.forEach(x => ROUND_MEMBERS.splice(ROUND_MEMBERS.indexOf(x), 1));
    renderToday(); renderRoundNav();
    return false;
  }
  trackAction('add', '컨택 명단 채움', r.name, `${escapeHtml(r.name)} — «${escapeHtml(source)}» ${rows.length}곳 넣음`);
  return true;
}
export async function fillCommit(){
  const have = new Set(membersOf(curRoundId).map(m => m.org_id));
  const cos = fillCandidates().filter(c => fill.picked.has(c.key) && !have.has(c.key));
  if(!cos.length){ alert('넣을 곳을 골라주세요.'); return; }
  const source = (document.getElementById('rf-src')?.value || '').trim();
  if(await addMembers(cos, source)){ fill.picked = null; renderFill(); }
}
export function fillSearch(v){
  const el = document.getElementById('rf-res');
  if(!el) return;
  const q = v.trim().toLowerCase();
  if(!q){ el.innerHTML = ''; return; }
  const have = new Set(membersOf(curRoundId).map(m => m.org_id));
  const res = coList().filter(c => [c.nameKo, c.nameEn, ...(c.aliases || [])].some(n => String(n || '').toLowerCase().includes(q))).slice(0, 20);
  el.innerHTML = res.length ? res.map(c => `<div style="display:flex;align-items:center;gap:6px;font-size:12px;padding:4px 2px;border-bottom:1px solid var(--i8)">
      <span style="flex:1">${escapeHtml(coName(c))} <span style="font-size:10.5px;color:var(--i4)">${escapeHtml(c.country || '')}</span></span>
      ${have.has(c.key) ? '<span style="font-size:10.5px;color:var(--i4)">이미 명단에</span>'
        : `<button class="btn bs" onclick="fillAddOne('${escAttr(c.key)}')">넣기</button>`}</div>`).join('')
    : '<div style="font-size:11px;color:var(--i4);padding:4px 2px">기업DB에서 못 찾았어요</div>';
}
export async function fillAddOne(key){
  const c = coOf(key);
  if(c && await addMembers([c], '직접 추가')) fillSearch(document.getElementById('rf-q')?.value || '');
}

/* ══════════════════════════════════════════
   전역 노출 — 인라인 onclick에서 부른다
══════════════════════════════════════════ */
Object.assign(window, {
  pickRound, renderToday, setContactFil, contactShowMore, toggleContactHist, toggleContactEdit,
  pickContactPerson, pickContactChannel, recordContact, undoContactAttempt, setContactNext,
  toggleContactGoal, closeContactMember, reopenContactMember, saveContactMemberEdit, removeContactMember,
  openContactCo, openRoundMember, openPersonForm, savePersonForm,
  setContactSrc, setContactMiss, contactMemo, markCalling, syncContactNow, openRoundEditor, saveRoundEditor, toggleRoundClosed, removeRound,
  openFillRound, fillPickEv, fillToggleRole, fillToggle, fillAll, fillCommit, fillSearch, fillAddOne,
});
