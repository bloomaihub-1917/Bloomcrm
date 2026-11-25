/* ══════════════════════════════════════════════════════════════
   quick-add.js — 제목 줄의 «추가» 단추가 여는 작은 창 두 개

   둘 다 «사람 고르기» 창(features/mdb/person-picker.js)을 연다 — 찾기 → 고르기, 없으면 새로 만들기.
   새로 만드는 것은 서버 한 길(api/contacts.js → contactUpserter): 같은 사람 찾기·16자리 id·기업DB 연결.
   1) 행사 참가자 추가 (행사 DB·파트너링) — 참가 유형을 덧붙여 이 행사 참여 기록을 하나 만든다.
      저장은 연락처 상세의 «참여 행사 추가»(contact-drawer.js confirmAddEv)와 같은 줄 모양.
   2) 연사 추가 (연사 탭) — 고른 사람으로 마스터DB에 이어진 연사 줄을 만들고 바로 연사 창을 연다.
═══════════════════════════════════════════════════════════════ */
import { EVENT_LIST, contacts, participations, SPEAKERS, speakersForEvent, PART_TYPES } from '../state.js';
import { escapeHtml, escAttr, td } from '../utils.js';
import { postToSheet } from '../api.js';
import { saveSpeaker } from '../api/conf-save.js';
import { guardConf, syncPartRole } from './conference/conf-common.js';
/* 끝난 컨퍼런스(열람만)에는 연사를 못 넣는다 — 연사 탭의 다른 저장과 같은 문지기 */
const gSaveSpeaker = guardConf(saveSpeaker);
import { trackAction } from '../core/audit-log.js';
import { openPersonPicker } from './mdb/person-picker.js';   // «사람 고르기» 창 하나 — 찾기 → 고르기 / 새로 만들기

const val = (id) => (document.getElementById(id)?.value || '').trim();
const evName = (k) => { const e = EVENT_LIST.find(x => x.key === k); return e ? (e.short || e.name || e.key) : k; };

/* ── 1) 행사 참가자 추가 — «사람 고르기» 창(features/mdb/person-picker.js)에 참가 유형만 덧붙인다.
   마스터DB에 없으면 그 창에서 바로 만든다(서버 한 길 — 같은 사람 찾기·기업DB 연결). ── */
export function openEvPersonAdd(evKey, { roles, done } = {}){
  if(!evKey){ alert('행사를 먼저 골라주세요.'); return; }
  const opts = roles && roles.length ? roles : PART_TYPES.map(t => t.key);
  const inEv = new Map();
  participations.filter(p => p.eventId === evKey).forEach(p => {
    const k = String(p.contactId); inEv.set(k, [...(inEv.get(k) || []), p.role || '참가자']); });
  openPersonPicker({
    title: '참가자 추가',
    sub: `${escapeHtml(evName(evKey))} — 찾아서 고르고, 없으면 새로 만들어 이 행사 참가자로 넣어요`,
    extraHtml: `<div class="mlbl">참가 유형</div>
      <select class="fi" id="qa-role" style="width:100%">${opts.map(r => {
        const t = PART_TYPES.find(x => x.key === r);
        return `<option value="${escapeHtml(r)}"${r === '참가자' ? ' selected' : ''}>${escapeHtml(t ? t.label : r)}</option>`; }).join('')}</select>`,
    tag: (c) => inEv.has(String(c.id)) ? `이미 이 행사 · ${inEv.get(String(c.id)).join('·')}` : '',
    source: `${evName(evKey)} 참가자`, newDefaults: { cat: 'attendee' }, pickLabel: '넣기',
    onPick: (c) => addParticipant(evKey, c, val('qa-role') || '참가자', done),
  });
}
async function addParticipant(evKey, c, role, done){
  if(participations.some(p => String(p.contactId) === String(c.id) && p.eventId === evKey && p.role === role))
    return `${c.nameKo || c.nameEn}은(는) 이미 «${role}»(으)로 이 행사에 있어요.`;
  const part = { id: 'P-' + Date.now() + '-' + Math.floor(Math.random() * 1000), eventId: evKey, event: evKey,
    contactId: c.id, contact: '', role, note: '', matched: '✅ 앱에서 추가' };
  participations.push(part);
  const r = await postToSheet({ sheet: 'participations',
    row: [part.id, part.eventId, '', part.contactId, '', '', '', part.role, part.note, part.matched] }, '행사 참여 추가');
  if(!r.ok){
    const i = participations.findIndex(p => p.id === part.id);
    if(i >= 0) participations.splice(i, 1);
    return '저장하지 못했어요. 잠시 뒤 다시 해 주세요.';
  }
  trackAction('status', '행사 참여 추가', c.nameKo || c.nameEn || String(c.id), `${evName(evKey)} · ${role}`);
  window.invalidateEvRows?.();
  done?.();
  return true;
}

/* ── 2) 연사 추가 — 같은 «사람 고르기» 창. 고른 사람으로 연사 줄을 만들고(마스터DB에 이어진 채로) 연사 창을 연다.
   예전에는 이름만으로 연사 줄을 만들고 자동 연결이 나중에 이름+소속으로 이었다 — 동명이인이면 못 이었다. ── */
export function openSpeakerAdd(evKey, { done } = {}){
  if(!evKey){ alert('행사를 먼저 골라주세요.'); return; }
  const spIds = new Set(speakersForEvent(evKey).map(sp => String(sp.contact_id || '')).filter(Boolean));
  openPersonPicker({
    title: '연사 추가',
    sub: `${escapeHtml(evName(evKey))} — 마스터DB에서 찾아 고르고, 없으면 새로 만들어요. 고르면 연사 창이 열려요`,
    mark: (c) => spIds.has(String(c.id)) ? '이미 이 행사 연사' : '',
    source: `${evName(evKey)} 연사`, newDefaults: { cat: 'speaker' }, pickLabel: '연사로',
    onPick: (c) => addSpeaker(evKey, c, done),
  });
}
async function addSpeaker(evKey, c, done){
  const sp = { event_id: evKey, contact_id: String(c.id), name_snapshot: c.nameKo || c.nameEn || '', name_en: c.nameEn || '',
    org_ko: c.orgKo || '', org_en: c.orgEn || '', title_ko: c.titleKo || '', title_en: c.titleEn || '',
    status: '섭외중', lang_pref: '', note: '', updated_at: td() };
  const res = await gSaveSpeaker(sp);
  if(!res || res.ok === false) return res?.locked ? true : '연사를 만들지 못했어요.';
  const id = res.id || `SP-tmp-${Date.now()}`;
  SPEAKERS.push({ ...sp, id });
  trackAction('status', '연사 추가', sp.name_snapshot, evName(evKey));
  try { await syncPartRole(id); } catch(e){ console.warn('[연사 추가] 참가 역할', e); }
  done?.();
  setTimeout(() => window.openSpeakerDr?.(id), 0);
  return true;
}

window.openEvPersonAdd = openEvPersonAdd;
window.openSpeakerAdd = openSpeakerAdd;

