/* ══════════════════════════════════════════
   마스터DB 연락처 — 주고받은 메일
   메일은 행사마다 연사 창·전시 창에서 쓰고 보낸다. 여기는 한 사람을 행사를 건너
   찾아보는 자리다(읽기만). 고치거나 답하려면 «열기»로 그 행사의 창으로 간다.

   연사   speakers.contact_id → speaker_logs   (사람 단위)
   전시   exhibitor_contacts.contact_id → 그 기업의 exhibitor_logs (기업 단위)
          기업 메일을 다 보이고, 이 사람 주소가 받는 이·보낸 이(counterpart)에 있는
          줄은 강조한다 — 공용 주소로 오간 메일도 놓치지 않게 (2026-10-23 결정)
   메모(direction 없음)는 빼고 오간 것만 본다.
   보낸 메일은 여기서 «회신 받음»과 메모(answered_at·answer)를 바로 고친다 — 그 행사 창과 같은 기록이다.
   컨택   contact_attempts.contact_id → 차수 DM·TM 기록. 메모(note)를 여기서 고친다
══════════════════════════════════════════ */
import { speakersOfContact, SPEAKER_LOGS, EXH_CONTACTS, EXHIBITORS, EXH_LOGS, CONTACT_ATTEMPTS, CONTACT_ROUNDS, evShort } from '../state.js';
import { escapeHtml, escAttr, nowStamp } from '../utils.js';
import { saveExhLog, saveSpeakerLog, saveAttempt } from '../api.js';
import { REACTIONS } from './contact-tab.js';

const isMail = (l) => l.direction === 'in' || l.direction === 'out';
const byTs = (a, b) => String(b.ts || '').localeCompare(String(a.ts || ''));

let openGroups = new Set();   // 펼친 묶음 — 연락처를 다시 그려도 유지
export function toggleContactMailGroup(key){
  openGroups.has(key) ? openGroups.delete(key) : openGroups.add(key);
  const el = document.getElementById('cmail-' + key);
  if(el) el.style.display = openGroups.has(key) ? '' : 'none';
  const ar = document.getElementById('cmail-ar-' + key);
  if(ar) ar.textContent = openGroups.has(key) ? '▴' : '▾';
}

export function contactMailsHtml(c){
  const mine = [c.email1, c.email2].map(e => String(e || '').trim().toLowerCase()).filter(Boolean);
  const isMine = (l) => mine.some(e => String(l.counterpart || '').toLowerCase().includes(e));

  const groups = [];
  speakersOfContact(c.id).forEach(sp => {
    const logs = SPEAKER_LOGS.filter(l => l.speaker_id === sp.id && isMail(l)).sort(byTs);
    if(logs.length) groups.push({ key: 'sp-' + sp.id, ev: sp.event_id, part: '연사', logs, mineAll: true,
      open: `closeContactDr();openSpeakerDr('${escAttr(sp.id)}','box')` });
  });
  /* 기업 담당자에 contact_id가 안 걸린 사람도 놓치지 않게 메일 주소로도 찾는다 — 담당자 주소가 같거나,
     그 기업에 보낸·받은 메일의 상대(counterpart)에 이 사람 주소가 있으면 (여러 기업에 메일·일괄 발송 포함) */
  const exhIds = [...new Set([
    ...EXH_CONTACTS.filter(x => String(x.contact_id || '') === String(c.id)
      || (x.email && mine.includes(String(x.email).trim().toLowerCase()))).map(x => x.exhibitor_id),
    ...(mine.length ? EXH_LOGS.filter(l => isMail(l) && isMine(l)).map(l => l.exhibitor_id) : []),
  ])];
  exhIds.forEach(id => {
    const x = EXHIBITORS.find(e => e.id === id);
    if(!x) return;
    const logs = EXH_LOGS.filter(l => l.exhibitor_id === id && isMail(l)).sort(byTs);
    if(logs.length) groups.push({ key: 'ex-' + id, ev: x.event_id, part: `전시 · ${x.company_name || ''}`, logs,
      open: `closeContactDr();openExhDr('${escAttr(id)}','box')` });
  });
  // 컨택 차수 DM·TM — 사람(contact_id) 단위 기록
  const atts = CONTACT_ATTEMPTS.filter(a => String(a.contact_id || '') === String(c.id))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  if(!groups.length && !atts.length) return '';
  groups.sort((a, b) => byTs(a.logs[0], b.logs[0]));

  const row = (l, hl) => `<details style="border-top:1px solid var(--i7);padding:5px 0${hl ? ';background:var(--ad);margin:0 -6px;padding-left:6px;padding-right:6px' : ''}">
    <summary style="cursor:pointer;list-style:none;display:flex;gap:6px;align-items:baseline;font-size:11.5px">
      <span style="font-size:10px;font-weight:700;color:${l.direction === 'in' ? 'var(--g)' : 'var(--a)'};flex:none">${l.direction === 'in' ? '받음' : '보냄'}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:${hl ? 600 : 400}">${escapeHtml(l.subject || '(제목 없음)')}</span>
      <span style="font-size:10px;color:var(--i4);flex:none">${escapeHtml(String(l.ts || '').slice(0, 10))}</span>
    </summary>
    <div style="font-size:10.5px;color:var(--i4);margin-top:3px">${escapeHtml(l.counterpart || '')}</div>
    <div style="font-size:11px;color:var(--i2);white-space:pre-wrap;line-height:1.6;margin-top:4px;max-height:240px;overflow:auto">${escapeHtml(String(l.body || '').slice(0, 4000))}</div>
    ${l.direction === 'out' && !String(l.id || '').startsWith('nolog-') ? manageHtml(l) : ''}
  </details>`;

  return `<div class="sct" style="margin-top:14px">주고받은 메일 · 연락 기록</div>
    <div style="margin-bottom:14px">${groups.map(g => {
      const n = g.mineAll ? g.logs.length : g.logs.filter(isMine).length;
      const shown = openGroups.has(g.key);
      return `<div style="border:1px solid var(--i6);border-radius:8px;padding:7px 10px;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:6px;cursor:pointer" onclick="toggleContactMailGroup('${escAttr(g.key)}')">
          <span style="font-size:11.5px;font-weight:700;color:var(--i2)">${escapeHtml(evShort(g.ev))}</span>
          <span style="font-size:11px;color:var(--i3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(g.part)}</span>
          <span style="font-size:10.5px;color:var(--i4);flex:none">${g.logs.length}통${g.mineAll ? '' : ` · 이 사람 ${n}`} <span id="cmail-ar-${escAttr(g.key)}">${shown ? '▴' : '▾'}</span></span>
          <button class="btn" style="font-size:10px;padding:1px 7px;flex:none" onclick="event.stopPropagation();${g.open}">열기</button>
        </div>
        <div id="cmail-${escAttr(g.key)}" style="margin-top:6px${shown ? '' : ';display:none'}">
          ${g.mineAll ? '' : '<div style="font-size:10px;color:var(--i4);margin-bottom:3px">기업으로 오간 메일 전체 — 이 사람 주소가 들어간 줄을 강조했어요</div>'}
          ${g.logs.map(l => row(l, !g.mineAll && isMine(l))).join('')}
        </div>
      </div>`;
    }).join('')}${atts.length ? attemptsHtml(atts) : ''}</div>`;
}

/* 보낸 메일 한 통 관리 — «회신 받음»(answered_at)과 메모(answer). 행사 창과 같은 기록을 고친다 */
function manageHtml(l){
  const id = escAttr(l.id);
  return `<div style="display:flex;gap:6px;align-items:center;margin-top:6px;font-size:11px;flex-wrap:wrap">
    <label style="display:flex;gap:4px;align-items:center;cursor:pointer;flex:none">
      <input type="checkbox" ${l.answered_at ? 'checked' : ''} onchange="contactMailReply('${id}',this.checked)"> 회신 받음</label>
    <span id="cm-ans-${id}" style="font-size:10px;color:var(--g);flex:none">${l.answered_at ? escapeHtml(String(l.answered_at).slice(0, 10)) : ''}</span>
    <input class="fi" style="flex:1;min-width:160px;font-size:11px;padding:3px 6px" value="${escapeHtml(l.answer || '')}" placeholder="메모 (회신 내용·다음 할 일)"
      onchange="contactMailMemo('${id}',this.value)">
    <span id="cm-msg-${id}" style="font-size:10px;color:var(--i4);flex:none"></span>
  </div>`;
}
const logById = (id) => {
  const ex = EXH_LOGS.find(l => l.id === id);
  if(ex) return { l: ex, save: saveExhLog };
  const sp = SPEAKER_LOGS.find(l => l.id === id);
  return sp ? { l: sp, save: saveSpeakerLog } : null;
};
async function patchLog(id, patch){
  const f = logById(id);
  if(!f) return false;
  const prev = { ...f.l };
  Object.assign(f.l, patch);
  const m = document.getElementById('cm-msg-' + id);
  if(m){ m.style.color = 'var(--i4)'; m.textContent = '저장 중…'; }
  const r = await f.save({ id, ...patch });
  if(r && r.ok === false){ Object.assign(f.l, prev); if(m){ m.style.color = 'var(--re)'; m.textContent = '저장 못 함'; } return false; }
  if(m){ m.style.color = 'var(--g)'; m.textContent = '저장됨'; }
  return true;
}
window.contactMailReply = async (id, on) => {
  const at = on ? nowStamp() : '';
  if(await patchLog(id, { answered_at: at })){ const e = document.getElementById('cm-ans-' + id); if(e) e.textContent = at.slice(0, 10); }
};
window.contactMailMemo = (id, v) => patchLog(id, { answer: String(v || '').trim() });

/* 컨택 차수 DM·TM 기록 — 언제·어느 차수·채널·반응. 메모(note)는 여기서 고친다 */
function attemptsHtml(atts){
  const key = 'ct';
  const shown = openGroups.has(key);
  const roundOf = (id) => CONTACT_ROUNDS.find(r => r.id === id) || {};
  return `<div style="border:1px solid var(--i6);border-radius:8px;padding:7px 10px;margin-bottom:6px">
    <div style="display:flex;align-items:center;gap:6px;cursor:pointer" onclick="toggleContactMailGroup('${key}')">
      <span style="font-size:11.5px;font-weight:700;color:var(--i2)">컨택 DM·TM</span>
      <span style="font-size:11px;color:var(--i3);flex:1">차수 연락 기록</span>
      <span style="font-size:10.5px;color:var(--i4);flex:none">${atts.length}건 <span id="cmail-ar-${key}">${shown ? '▴' : '▾'}</span></span>
    </div>
    <div id="cmail-${key}" style="margin-top:6px${shown ? '' : ';display:none'}">
      ${atts.map(a => { const R = REACTIONS[a.reaction] || {}; const id = escAttr(a.id); const r = roundOf(a.round_id);
        return `<div style="border-top:1px solid var(--i7);padding:5px 0;font-size:11.5px">
          <div style="display:flex;gap:6px;align-items:center">
            <span style="font-size:10px;font-weight:700;color:var(--a);flex:none">${escapeHtml(a.channel || '')}</span>
            <span class="pill ${R.cls || 'p-gray'}" style="font-size:9.5px;flex:none">${escapeHtml(R.label || a.reaction || '')}</span>
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml([r.event_id ? evShort(r.event_id) : '', r.name || ''].filter(Boolean).join(' · '))}</span>
            <span style="font-size:10px;color:var(--i4);flex:none">${escapeHtml(String(a.at || '').slice(0, 10))}${a.by_name ? ' · ' + escapeHtml(a.by_name) : ''}</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
            <input class="fi" style="flex:1;font-size:11px;padding:3px 6px" value="${escapeHtml(a.note || '')}" placeholder="메모" onchange="contactAttemptMemo('${id}',this.value)">
            <span id="cm-msg-${id}" style="font-size:10px;color:var(--i4);flex:none"></span></div>
        </div>`; }).join('')}
    </div>
  </div>`;
}
window.contactAttemptMemo = async (id, v) => {
  const a = CONTACT_ATTEMPTS.find(x => x.id === id);
  if(!a) return;
  const prev = a.note, m = document.getElementById('cm-msg-' + id);
  a.note = String(v || '').trim();
  const r = await saveAttempt({ id, note: a.note });
  if(r && r.ok === false){ a.note = prev; if(m){ m.style.color = 'var(--re)'; m.textContent = '저장 못 함'; } return; }
  if(m){ m.style.color = 'var(--g)'; m.textContent = '저장됨'; }
};

window.toggleContactMailGroup = toggleContactMailGroup;
