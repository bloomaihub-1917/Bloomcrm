/* ══════════════════════════════════════════════════════════════
   domain/rounds.js — 컨택 차수 조회 — 차수·명단·기록 찾기, 명단 줄의 기업과 담당자
   (modules/contact-tab.js에서 옮겼다 — 탭 화면 파일에 기대지 않게)
═══════════════════════════════════════════════════════════════ */

import { CONTACT_ROUNDS, ROUND_MEMBERS, CONTACT_ATTEMPTS, EVENT_LIST, CO_DB, contacts, participations, hasLeft, isWalkInOnly } from '../state.js';
import { td } from '../utils.js';

/* ══════════════════════════════════════════
   조회
══════════════════════════════════════════ */
export const roundById = (id) => CONTACT_ROUNDS.find(r => r.id === id) || null;
export const membersOf = (rid) => ROUND_MEMBERS.filter(m => m.round_id === rid);
export const attemptsOf = (mid) => CONTACT_ATTEMPTS.filter(a => a.member_id === mid)
  .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
export const evOf = (key) => EVENT_LIST.find(e => e.key === key) || null;
export const evLabel = (key) => { const e = evOf(key); return e ? (e.short || e.name || e.key) : (key || '행사 없음'); };
export const today = () => td();
export function addDays(n){
  const d = new Date(); d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const genId = (prefix, i = 0) => `${prefix}${Date.now()}_${i}`;

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
export const coName = (co) => (co ? (co.nameKo || co.nameEn || '') : '');
export const memberName = (m) => coName(coOf(m.org_id)) || m.org_name || '(이름 없음)';
/* 기업에 딸린 담당자 — 원본 연락처로 돌려준다.
   기업DB(CO_DB)의 contacts는 화면용으로 줄인 사본이라(name·email·phone, 휴대폰·부서·
   두 번째 메일 없음) 그대로 쓰면 메일이 있는 사람도 «메일 없음»으로 보였다. */
let cById = null, cByIdN = -1;
export function contactOf(id){
  if(!cById || cByIdN !== contacts.length){ cById = new Map(contacts.map(c => [String(c.id), c])); cByIdN = contacts.length; }
  return cById.get(String(id)) || null;
}
export function fullContacts(co){
  return (co ? co.contacts : []).map(p => contactOf(p.id) || p);
}
/* 사람마다 온 행사 — [{ key, label, date, roles }] 최근 행사부터.
   한 기업이라도 행사마다 온 사람이 달라서, 누구에게 연락할지 고를 때 본다(11-27) */
let pevSig = '', pevMap = null;
export function eventsOfPerson(cid){
  const sig = `${participations.length}|${EVENT_LIST.length}`;
  if(pevSig !== sig){
    pevMap = new Map();
    participations.forEach(p => {
      const k = String(p.contactId);
      if(!pevMap.has(k)) pevMap.set(k, []);
      const list = pevMap.get(k);
      let e = list.find(x => x.key === p.eventId);
      if(!e){ const ev = evOf(p.eventId); list.push(e = { key: p.eventId, label: evLabel(p.eventId), date: String(ev?.date || ''), roles: [] }); }
      if(p.role && !e.roles.includes(p.role)) e.roles.push(p.role);
    });
    pevMap.forEach(list => list.sort((a, b) => b.date.localeCompare(a.date)));
    pevSig = sig;
  }
  return pevMap.get(String(cid)) || [];
}
/* 담당자 순서 — 이 차수 행사에 왔던 사람 › 최근 행사에 온 사람 › 행사 이력 없는 사람, 같으면 번호 있는 사람 먼저 */
export function peopleOf(m){
  /* 현장 등록·연락처 없음(state.js isWalkInOnly)은 걸 곳이 없다 — 컨택 담당자에서 뺀다 */
  const evKey = roundById(m.round_id)?.event_id || '';
  const rank = (c) => { const evs = eventsOfPerson(c.id); return [evs.some(e => e.key === evKey) ? 1 : 0, evs[0]?.date || '']; };
  return fullContacts(coOf(m.org_id)).filter(c => !hasLeft(c) && !isWalkInOnly(c))
    .map(c => ({ c, k: rank(c) }))
    .sort((a, b) => b.k[0] - a.k[0] || b.k[1].localeCompare(a.k[1])
      || (!!(b.c.phone1 || b.c.phone2) - !!(a.c.phone1 || a.c.phone2)))
    .map(x => x.c);
}
