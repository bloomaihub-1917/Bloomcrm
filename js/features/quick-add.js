/* ══════════════════════════════════════════════════════════════
   quick-add.js — 제목 줄의 «추가» 단추가 여는 작은 창 두 개

   1) 행사 참가자 추가 (행사 DB·파트너링)
      마스터DB에서 사람을 찾아 고르고, 참가 유형을 정해 이 행사 참여 기록을 하나 만든다.
      저장은 연락처 상세의 «참여 행사 추가»(contact-drawer.js confirmAddEv)와 같은 줄 모양.
      마스터DB에 없는 사람은 «새 연락처 만들기»로 먼저 만든다 — 연락처 id 규칙(CLAUDE.md)을
      지키는 곳은 그 창(saveNewContact → nextContactId) 하나로 둔다.
   2) 연사 추가 (연사 탭)
      이름·소속·직함만 받아 이 행사 연사 줄을 만들고 바로 연사 창을 연다.
      마스터DB 연결·메일 주소는 연사 창에서 한다(지금 세션 배정에서 새 이름으로 만드는 것과 같은 길).
═══════════════════════════════════════════════════════════════ */
import { EVENT_LIST, contacts, participations, SPEAKERS, speakersForEvent, PART_TYPES } from '../state.js';
import { escapeHtml, escAttr, td } from '../utils.js';
import { postToSheet } from '../api.js';
import { saveSpeaker } from '../api/conf-save.js';
import { guardConf } from './conference/conf-common.js';
/* 끝난 컨퍼런스(열람만)에는 연사를 못 넣는다 — 연사 탭의 다른 저장과 같은 문지기 */
const gSaveSpeaker = guardConf(saveSpeaker);
import { trackAction } from '../core/audit-log.js';

const close = () => document.getElementById('qa-modal')?.remove();
const frame = (title, sub, body, foot) => {
  close();
  document.body.insertAdjacentHTML('beforeend', `<div id="qa-modal" onclick="if(event.target===this)closeQuickAdd()"
    style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px">
    <div style="background:var(--W);border-radius:var(--rd-12);padding:20px 22px;width:min(520px,100%);max-height:90vh;overflow:auto;box-shadow:var(--shl)">
      <div style="font-size:var(--fs-14);font-weight:700;color:var(--i1)">${title}</div>
      <div style="font-size:var(--fs-11);color:var(--i4);margin:3px 0 14px">${sub}</div>
      ${body}
      <div id="qa-msg" style="font-size:var(--fs-11);color:var(--re);min-height:16px;margin-top:8px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">${foot}</div>
    </div></div>`);
};
const val = (id) => (document.getElementById(id)?.value || '').trim();
const say = (m) => { const e = document.getElementById('qa-msg'); if(e) e.textContent = m; };
const evName = (k) => { const e = EVENT_LIST.find(x => x.key === k); return e ? (e.short || e.name || e.key) : k; };

/* ── 1) 행사 참가자 추가 ── */
let qa = null;   // { evKey, roles, picked, done }
export function openEvPersonAdd(evKey, { roles, done } = {}){
  if(!evKey){ alert('행사를 먼저 골라주세요.'); return; }
  const opts = roles && roles.length ? roles : PART_TYPES.map(t => t.key);
  qa = { evKey, picked: null, done };
  frame('참가자 추가', `${escapeHtml(evName(evKey))} — 마스터DB에서 사람을 찾아 이 행사 참가자로 넣어요`,
    `<div class="mlbl">사람 찾기</div>
     <input class="fi" id="qa-q" style="width:100%" placeholder="이름·기업·이메일" oninput="quickAddSearch(this.value)" autocomplete="off">
     <div id="qa-list" style="margin-top:6px;border:1px solid var(--i6);border-radius:var(--r);max-height:260px;overflow:auto"></div>
     <div style="font-size:var(--fs-11);color:var(--i4);margin-top:6px">마스터DB에 없나요?
       <a href="javascript:void(0)" style="color:var(--a)" onclick="closeQuickAdd();openAddContactModal()">새 연락처 만들기</a> — 만든 뒤 다시 와서 찾아 넣어요.</div>
     <div class="mlbl" style="margin-top:12px">참가 유형</div>
     <select class="fi" id="qa-role" style="width:100%">${opts.map(r => {
       const t = PART_TYPES.find(x => x.key === r);
       return `<option value="${escapeHtml(r)}"${r === '참가자' ? ' selected' : ''}>${escapeHtml(t ? t.label : r)}</option>`; }).join('')}</select>`,
    `<button class="btn bs" onclick="closeQuickAdd()">취소</button>
     <button class="btn bp bs" onclick="confirmQuickAdd()">추가</button>`);
  quickAddSearch('');
  setTimeout(() => document.getElementById('qa-q')?.focus(), 30);
}
export function quickAddSearch(q){
  const box = document.getElementById('qa-list');
  if(!box || !qa) return;
  q = String(q || '').trim().toLowerCase();
  const inEv = new Set(participations.filter(p => p.eventId === qa.evKey).map(p => String(p.contactId)));
  const hit = !q ? [] : contacts.filter(c => [c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.email1, c.email2]
    .some(v => String(v || '').toLowerCase().includes(q))).slice(0, 30);
  box.innerHTML = !q ? '<div style="padding:12px;font-size:var(--fs-11_5);color:var(--i4)">이름이나 기업을 적으면 찾아요.</div>'
    : !hit.length ? '<div style="padding:12px;font-size:var(--fs-11_5);color:var(--i4)">찾는 사람이 없어요.</div>'
    : hit.map(c => `<label style="display:flex;gap:8px;align-items:center;padding:7px 10px;border-bottom:1px solid var(--i8);cursor:pointer;font-size:var(--fs-12)">
        <input type="radio" name="qa-pick" ${String(qa.picked) === String(c.id) ? 'checked' : ''} onchange="quickAddPick(${escAttr(JSON.stringify(c.id))})">
        <span style="font-weight:600">${escapeHtml(c.nameKo || c.nameEn || '')}</span>
        <span style="color:var(--i3)">${escapeHtml(c.orgKo || c.orgEn || '')}</span>
        <span style="color:var(--i4);font-size:var(--fs-11)">${escapeHtml(c.email1 || '')}</span>
        ${inEv.has(String(c.id)) ? '<span class="pill p-gray" style="margin-left:auto">이미 이 행사</span>' : ''}</label>`).join('');
}
export function quickAddPick(cid){ if(qa) qa.picked = cid; say(''); }
export async function confirmQuickAdd(){
  if(!qa) return;
  const cid = qa.picked, role = val('qa-role');
  if(cid == null){ say('추가할 사람을 골라주세요.'); return; }
  const c = contacts.find(x => String(x.id) === String(cid));
  if(participations.some(p => String(p.contactId) === String(cid) && p.eventId === qa.evKey && p.role === role)){
    say('이미 같은 참가 유형으로 이 행사에 있어요.'); return;
  }
  const part = { id: 'P-' + Date.now() + '-' + Math.floor(Math.random() * 1000), eventId: qa.evKey, event: qa.evKey,
    contactId: c ? c.id : cid, contact: '', role, note: '', matched: '✅ 앱에서 추가' };
  participations.push(part);
  const r = await postToSheet({ sheet: 'participations',
    row: [part.id, part.eventId, '', part.contactId, '', '', '', part.role, part.note, part.matched] }, '행사 참여 추가');
  if(!r.ok){
    const i = participations.findIndex(p => p.id === part.id);
    if(i >= 0) participations.splice(i, 1);
    say('저장하지 못했어요. 잠시 뒤 다시 해 주세요.');
    return;
  }
  trackAction('status', '행사 참여 추가', c ? (c.nameKo || c.nameEn) : String(cid), `${evName(qa.evKey)} · ${role}`);
  const done = qa.done; close(); qa = null;
  window.invalidateEvRows?.();
  done?.();
}

/* ── 2) 연사 추가 ── */
let qs = null;
export function openSpeakerAdd(evKey, { done } = {}){
  if(!evKey){ alert('행사를 먼저 골라주세요.'); return; }
  qs = { evKey, done };
  const f = (id, label, ph) => `<div><div class="mlbl">${label}</div><input class="fi" id="${id}" style="width:100%" placeholder="${ph}"></div>`;
  frame('연사 추가', `${escapeHtml(evName(evKey))} — 이름만 있어도 돼요. 마스터DB 연결·메일은 연사 창에서 해요`,
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      ${f('qs-name', '이름 *', '홍길동')}${f('qs-name-en', '영문 이름', 'Gildong Hong')}
      ${f('qs-org', '소속', '기관·기업')}${f('qs-title', '직함', '교수 · 대표')}</div>`,
    `<button class="btn bs" onclick="closeQuickAdd()">취소</button>
     <button class="btn bp bs" onclick="confirmSpeakerAdd()">추가하고 열기</button>`);
  setTimeout(() => document.getElementById('qs-name')?.focus(), 30);
}
export async function confirmSpeakerAdd(){
  if(!qs) return;
  const name = val('qs-name'), nameEn = val('qs-name-en');
  if(!name && !nameEn){ say('이름을 적어주세요.'); return; }
  /* 같은 이름이 이 행사에 이미 있으면 새로 만들지 않는다 — 두 줄로 갈리면 받을 것도 두 벌이 된다 */
  const same = speakersForEvent(qs.evKey).find(sp => (sp.name_snapshot || '').trim() === (name || nameEn));
  if(same){ say(`«${name || nameEn}»은 이미 이 행사 연사예요.`); return; }
  const sp = { event_id: qs.evKey, contact_id: '', name_snapshot: name || nameEn, name_en: nameEn,
    org_ko: val('qs-org'), title_ko: val('qs-title'), status: '섭외중', lang_pref: '', note: '', updated_at: td() };
  const res = await gSaveSpeaker(sp);
  if(!res || res.ok === false){ if(res?.locked) close(); else say('연사를 만들지 못했어요.'); return; }
  const id = res.id || `SP-tmp-${Date.now()}`;
  SPEAKERS.push({ ...sp, id });
  trackAction('status', '연사 추가', sp.name_snapshot, evName(qs.evKey));
  const done = qs.done; close(); qs = null;
  done?.();
  window.openSpeakerDr?.(id);
}

window.closeQuickAdd = close;
window.openEvPersonAdd = openEvPersonAdd;
window.quickAddSearch = quickAddSearch;
window.quickAddPick = quickAddPick;
window.confirmQuickAdd = confirmQuickAdd;
window.openSpeakerAdd = openSpeakerAdd;
window.confirmSpeakerAdd = confirmSpeakerAdd;
