/* ══════════════════════════════════════════
   마스터DB 연락처 — 주고받은 메일
   메일은 행사마다 연사 창·전시 창에서 쓰고 보낸다. 여기는 한 사람을 행사를 건너
   찾아보는 자리다(읽기만). 고치거나 답하려면 «열기»로 그 행사의 창으로 간다.

   연사   speakers.contact_id → speaker_logs   (사람 단위)
   전시   exhibitor_contacts.contact_id → 그 기업의 exhibitor_logs (기업 단위)
          기업 메일을 다 보이고, 이 사람 주소가 받는 이·보낸 이(counterpart)에 있는
          줄은 강조한다 — 공용 주소로 오간 메일도 놓치지 않게 (2026-10-23 결정)
   메모(direction 없음)는 빼고 오간 것만 본다.
══════════════════════════════════════════ */
import { speakersOfContact, SPEAKER_LOGS, EXH_CONTACTS, EXHIBITORS, EXH_LOGS, evShort } from '../state.js';
import { escapeHtml, escAttr } from '../utils.js';

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
  if(!groups.length) return '';
  groups.sort((a, b) => byTs(a.logs[0], b.logs[0]));

  const row = (l, hl) => `<details style="border-top:1px solid var(--i7);padding:5px 0${hl ? ';background:var(--ad);margin:0 -6px;padding-left:6px;padding-right:6px' : ''}">
    <summary style="cursor:pointer;list-style:none;display:flex;gap:6px;align-items:baseline;font-size:11.5px">
      <span style="font-size:10px;font-weight:700;color:${l.direction === 'in' ? 'var(--g)' : 'var(--a)'};flex:none">${l.direction === 'in' ? '받음' : '보냄'}</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:${hl ? 600 : 400}">${escapeHtml(l.subject || '(제목 없음)')}</span>
      <span style="font-size:10px;color:var(--i4);flex:none">${escapeHtml(String(l.ts || '').slice(0, 10))}</span>
    </summary>
    <div style="font-size:10.5px;color:var(--i4);margin-top:3px">${escapeHtml(l.counterpart || '')}</div>
    <div style="font-size:11px;color:var(--i2);white-space:pre-wrap;line-height:1.6;margin-top:4px;max-height:240px;overflow:auto">${escapeHtml(String(l.body || '').slice(0, 4000))}</div>
  </details>`;

  return `<div class="sct" style="margin-top:14px">주고받은 메일</div>
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
    }).join('')}</div>`;
}

window.toggleContactMailGroup = toggleContactMailGroup;
