/* ══════════════════════════════════════════════════════════════
   features/mdb/contact-merge.js — 같은 사람 두 줄을 하나로 합치기 (칸마다 A·B·둘 다)

   행사에서 참가자를 넣고, 연사 화면에서 또 넣으면 같은 사람이 연락처 두 줄이 된다.
   두 줄을 고르면 칸마다 어느 값을 쓸지 고른다.
     · A 또는 B — 그 값만
     · 둘 다 — 메일·전화는 첫째·둘째 칸에 나눠 두고, 나머지는 «A / B»로 함께 적는다
   한쪽만 값이 있는 칸은 묻지 않고 그 값을 쓴다.
   «남길 기록»(id) 쪽에 다른 쪽의 행사 참가·연사·전시 담당·컨택·영업 DB·네임택 발급을 모두 옮기고
   다른 쪽을 지운다 — 서버 한 트랜잭션(backend-node/routes/data.js mergeContacts).

   부르는 곳: 마스터DB 선택 막대(mdb-bulk.js), «중복 찾기»(아래 openEvDupes — 행사 DB 참가자·파트너링, Master DB 칩).
═══════════════════════════════════════════════════════════════ */

import { postToSheet } from '../../api.js';
import { removed as removedMeta, trackAction } from '../../core/audit-log.js';
import { buildCoDB } from '../../domain/co-db.js';
import { CONTACT_ATTEMPTS, EVENT_LIST, SALES_TARGETS, EXH_CONTACTS, SPEAKERS, SPEAKER_CONTACTS, contacts, participations } from '../../state.js';
import { escAttr, escapeHtml, personName } from '../../utils.js';

const s = (v) => String(v ?? '').trim();
/* 연락처 id는 화면에선 숫자, 참가 기록·선택 목록에선 글자일 때가 있어 글자로 맞춰 찾는다 */
const getContactById = (id) => contacts.find(c => String(c.id) === String(id));

/* 고르는 칸 — [표시 이름, 칸들]. 메일·전화는 두 칸을 한 묶음으로 본다 */
const FIELDS = [
  ['국문 이름', ['nameKo']], ['영문 이름', ['nameEn']], ['경칭', ['prefix']],
  ['소속(국문)', ['orgKo']], ['소속(영문)', ['orgEn']], ['부서(국문)', ['deptKo']], ['부서(영문)', ['deptEn']],
  ['직함(국문)', ['titleKo']], ['직함(영문)', ['titleEn']],
  ['메일', ['email1', 'email2']], ['전화', ['phone1', 'phone2']],
  ['국가', ['country']], ['메모 1', ['memo1']], ['메모 2', ['memo2']], ['메모 3', ['memo3']],
];
const pairVals = (c, cols) => cols.map(k => s(c[k])).filter(Boolean);
/* 전화는 숫자만 비교한다 — «010-1234-5678»과 «01012345678»은 같은 번호 */
const cmpKey = (v) => /^[\d\s()+\-.]+$/.test(v) ? v.replace(/\D/g, '') : v.toLowerCase();
const sameVals = (a, b) => a.length === b.length && a.every((v, i) => cmpKey(v) === cmpKey(b[i]));

function refsOf(id){
  const k = String(id);
  const n = (arr) => arr.filter(r => String(r.contact_id ?? r.contactId ?? '') === k).length;
  const evs = [...new Set(participations.filter(p => String(p.contactId) === k).map(p => {
    const ev = EVENT_LIST.find(e => e.key === (p.eventId || p.event));
    return `${(ev && (ev.short || ev.key)) || p.eventId || p.event}${p.role ? ' ' + p.role : ''}`;
  }))];
  return { evs, sp: n(SPEAKERS) + n(SPEAKER_CONTACTS), exh: n(EXH_CONTACTS), att: n(CONTACT_ATTEMPTS), sales: n(SALES_TARGETS) };
}
/* 기록이 많거나 칸이 더 찬 쪽을 남길 기록으로 먼저 골라 둔다 */
const score = (c) => Object.values(c).filter(v => s(v)).length
  + participations.filter(p => String(p.contactId) === String(c.id)).length * 3;

let cur = null;   // { a, b, onDone }

export function openContactMerge(idA, idB, { onDone } = {}){
  const a = getContactById(idA), b = getContactById(idB);
  if(!a || !b || String(a.id) === String(b.id)){ alert('같은 사람인 두 명을 골라 주세요.'); return; }
  closeContactMerge();
  cur = { a, b, onDone };
  const keepA = score(a) >= score(b);
  const refLine = (c) => {
    const r = refsOf(c.id);
    return [r.evs.length && r.evs.join(', '), r.sp && `연사 ${r.sp}`, r.exh && `전시 담당 ${r.exh}`,
      r.att && `컨택 ${r.att}`, r.sales && `영업 DB ${r.sales}`].filter(Boolean).join(' · ') || '연결된 기록 없음';
  };

  const rows = FIELDS.map(([label, cols], i) => {
    const va = pairVals(a, cols), vb = pairVals(b, cols);
    if(!va.length && !vb.length) return '';
    const show = (v) => v.length ? escapeHtml(v.join(', ')) : '<span style="color:var(--i5)">(없음)</span>';
    if(!va.length || !vb.length || sameVals(va, vb)){
      return `<tr style="color:var(--i4)"><td>${label}</td><td colspan="3">${show(va.length ? va : vb)}
        <span style="font-size:var(--fs-10_5);color:var(--i5)">${sameVals(va, vb) ? '— 같음' : '— 한쪽만 있어 그대로'}</span></td></tr>`;
    }
    const opt = (v, txt, on) => `<label style="display:flex;gap:6px;align-items:flex-start;cursor:pointer">
      <input type="radio" name="cm-f${i}" value="${v}" ${on ? 'checked' : ''} style="margin-top:3px"><span>${txt}</span></label>`;
    return `<tr><td style="font-weight:600">${label}</td>
      <td>${opt('a', show(va), keepA)}</td><td>${opt('b', show(vb), !keepA)}</td>
      <td>${opt('both', cols.length > 1 ? '둘 다 (첫째·둘째 칸)' : '둘 다 («A / B»)', false)}</td></tr>`;
  }).join('');

  const pop = document.createElement('div');
  pop.id = 'contact-merge-modal';
  pop.className = 'mw on';
  pop.addEventListener('click', (e) => { if(e.target === pop) closeContactMerge(); });
  pop.innerHTML = `<div class="modal" style="max-width:860px">
    <div class="mh"><div style="flex:1;min-width:0"><div class="mt2">같은 사람으로 합치기</div>
      <div style="font-size:var(--fs-11);color:var(--i4);margin-top:2px">칸마다 쓸 값을 고르세요. 두 사람의 행사 참가·연사·전시 담당·컨택·영업 DB·네임택 발급은 모두 남길 기록으로 모여요.</div></div></div>
    <div class="mb">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        ${[a, b].map((c, j) => `<label style="display:flex;gap:8px;align-items:flex-start;border:1px solid var(--i7);border-radius:var(--r);padding:8px 10px;cursor:pointer;font-size:var(--fs-11_5)">
          <input type="radio" name="cm-keep" value="${j ? 'b' : 'a'}" ${(j ? !keepA : keepA) ? 'checked' : ''} style="margin-top:3px">
          <div style="min-width:0"><div style="font-weight:600">${j ? 'B' : 'A'} · ${escapeHtml(personName(c))} <span style="font-weight:400;color:var(--i4)">${escapeHtml(c.orgKo || c.orgEn || '')}</span></div>
            <div style="color:var(--i4)">${escapeHtml(refLine(c))}</div>
            <div style="color:var(--i5);font-size:var(--fs-10_5)">출처 ${escapeHtml(c.source || '-')} · 등록 ${escapeHtml(c.date || '-')} · 이 기록을 남김</div></div></label>`).join('')}
      </div>
      <div style="max-height:52vh;overflow:auto">
      <table style="width:100%;border-collapse:collapse;font-size:var(--fs-11_5)" class="cm-tbl">
        <thead><tr style="text-align:left;color:var(--i4)"><th style="width:96px">칸</th><th>A</th><th>B</th><th style="width:150px">둘 다</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:8px">합친 뒤에는 되돌릴 수 없어요. 태그는 두 쪽을 합쳐 둬요.</div>
      <div id="cm-msg" style="font-size:var(--fs-11_5);color:var(--re);min-height:16px;margin-top:4px"></div>
    </div>
    <div class="mf2">
      <button class="btn" onclick="closeContactMerge()">취소</button>
      <button class="btn bp" id="cm-btn" onclick="confirmContactMerge()">합치기</button>
    </div></div>`;
  document.body.appendChild(pop);
  pop.querySelectorAll('.cm-tbl td, .cm-tbl th').forEach(el => { el.style.padding = '6px 8px'; el.style.borderBottom = '1px solid var(--i7)'; el.style.verticalAlign = 'top'; });
}
export function closeContactMerge(){ document.getElementById('contact-merge-modal')?.remove(); }

/* 고른 값을 칸별로 만든다 */
function chosenValues(a, b){
  const set = {};
  FIELDS.forEach(([, cols], i) => {
    const va = pairVals(a, cols), vb = pairVals(b, cols);
    let pick;
    if(!va.length && !vb.length) return;
    if(!va.length || !vb.length || sameVals(va, vb)) pick = va.length ? va : vb;
    else {
      const how = document.querySelector(`input[name="cm-f${i}"]:checked`)?.value || 'a';
      if(how === 'a') pick = va;
      else if(how === 'b') pick = vb;
      else if(cols.length > 1) pick = [...new Map([...va, ...vb].map(v => [v.toLowerCase(), v])).values()];
      else pick = [`${va[0]} / ${vb[0]}`];
    }
    if(cols.length > 1){
      /* 메일·전화는 두 칸뿐 — 셋째부터는 메모 3 끝에 남겨 잃지 않는다 */
      cols.forEach((k, j) => { set[k] = pick[j] || ''; });
      if(pick.length > 2) set._extra = (set._extra || []).concat(pick.slice(2));
    } else set[cols[0]] = pick[0] || '';
  });
  if(set._extra){
    set.memo3 = [set.memo3 ?? s(a.memo3), `다른 연락처: ${set._extra.join(', ')}`].filter(Boolean).join(' · ');
    delete set._extra;
  }
  return set;
}

export async function confirmContactMerge(){
  if(!cur) return;
  const { a, b, onDone } = cur;
  const keepIsA = (document.querySelector('input[name="cm-keep"]:checked')?.value || 'a') === 'a';
  const keep = keepIsA ? a : b, drop = keepIsA ? b : a;
  const set = chosenValues(a, b);
  const keepId = String(keep.id), dropId = String(drop.id);
  const btn = document.getElementById('cm-btn');
  if(btn){ btn.disabled = true; btn.textContent = '합치는 중…'; }
  const r = await postToSheet({ sheet:'contacts', action:'merge', data:{ keep: keepId, drop: dropId, set } }, '연락처 합치기');
  if(!r || r.ok === false){
    const m = document.getElementById('cm-msg');
    if(m) m.textContent = (r && r.error) || '합치지 못했어요';
    if(btn){ btn.disabled = false; btn.textContent = '합치기'; }
    return;
  }
  applyMergeLocally(keep, drop, r);
  trackAction('edit', '연락처 합치기', personName(keep),
    `${personName(drop)}(${dropId})을 ${personName(keep)}(${keepId})에 합침`,
    removedMeta('contacts', dropId, [r.dropped || drop]));
  closeContactMerge();
  cur = null;
  buildCoDB();
  window.invalidateEvRows?.();
  onDone?.(keep);
}

/* 서버가 한 일을 화면 사본에도 그대로 — 새로고침 없이 바로 맞게 */
function applyMergeLocally(keep, drop, r){
  const keepId = String(keep.id), dropId = String(drop.id);
  const sv = r.contact || {};
  Object.keys(keep).forEach(k => { if(k !== 'id' && k in sv) keep[k] = sv[k] ?? ''; });
  const goneP = new Set((r.goneParts || []).map(String));
  for(let i = participations.length - 1; i >= 0; i--){
    const p = participations[i];
    if(goneP.has(String(p.id))) participations.splice(i, 1);
    else if(String(p.contactId) === dropId) p.contactId = keep.id;
  }
  const goneS = new Set((r.goneSales || []).map(String));
  for(let i = SALES_TARGETS.length - 1; i >= 0; i--){
    const t = SALES_TARGETS[i];
    if(goneS.has(String(t.id))) SALES_TARGETS.splice(i, 1);
    else if(String(t.contact_id) === dropId) t.contact_id = typeof t.contact_id === 'number' ? keep.id : keepId;
  }
  [SPEAKERS, SPEAKER_CONTACTS, EXH_CONTACTS, CONTACT_ATTEMPTS].forEach(arr => arr.forEach(x => {
    if(String(x.contact_id ?? '') === dropId) x.contact_id = typeof x.contact_id === 'number' ? keep.id : keepId;
  }));
  contacts.forEach(c => { if(String(c.moved_to_id || '') === dropId) c.moved_to_id = keepId; });
  const di = contacts.indexOf(drop);
  if(di >= 0) contacts.splice(di, 1);
}

/* ══════════════════════════════════════════
   중복 찾기 — 행사 DB 참가자·파트너링(그 행사 사람끼리) · Master DB(연락처 전체)

   같은 사람일 수 있는 묶음을 보여 준다. 행사 안에서만 찾으면 행사를 넘나드는 중복
   (다른 행사로 들어온 같은 사람 — 점검의 «같은 메일 두 명»)이 안 잡혀 Master DB에서도 연다.
   전체에서는 이름만 같은 묶음(동명이인)이 많아 기본은 접어 두고 «이름만 같음도 보기»로 연다.
   묶는 기준: 같은 메일 · 같은 전화(숫자 끝 8자리) · 같은 국문 이름 · 같은 영문 이름(순서·대소문자 무시).
   이름만 같으면 동명이인일 수 있어 «이름만 같음»으로 따로 표시한다. 두 사람을 골라 합친다.
══════════════════════════════════════════ */
const enKey = (v) => s(v).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
const telKey = (v) => { const d = s(v).replace(/\D/g, ''); return d.length >= 8 ? d.slice(-8) : ''; };

function dupGroups(evKey){
  const people = evKey
    ? [...new Set(participations.filter(p => (p.eventId || p.event) === evKey && p.contactId != null).map(p => String(p.contactId)))]
      .map(id => getContactById(id)).filter(Boolean)
    : contacts.filter(c => !s(c.moved_to_id));
  const parent = new Map(people.map(c => [String(c.id), String(c.id)]));
  const find = (x) => { while(parent.get(x) !== x){ parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const why = new Map();   // root 쌍 이유
  const link = (x, y, reason) => {
    const rx = find(x), ry = find(y);
    if(rx !== ry) parent.set(rx, ry);
    const k = [x, y].sort().join('|');
    why.set(k, [...new Set([...(why.get(k) || []), reason])]);
  };
  const by = (keyOf, reason) => {
    const m = new Map();
    people.forEach(c => keyOf(c).filter(Boolean).forEach(k => { if(!m.has(k)) m.set(k, []); m.get(k).push(String(c.id)); }));
    m.forEach(list => { const u = [...new Set(list)]; for(let i = 1; i < u.length; i++) link(u[0], u[i], reason); });
  };
  by(c => [c.email1, c.email2].map(v => s(v).toLowerCase()), '메일');
  by(c => [c.phone1, c.phone2].map(telKey), '전화');
  by(c => [s(c.nameKo).replace(/\s/g, '')], '국문 이름');
  by(c => [enKey(c.nameEn)], '영문 이름');

  const groups = new Map();
  people.forEach(c => { const r = find(String(c.id)); if(!groups.has(r)) groups.set(r, []); groups.get(r).push(c); });
  return [...groups.values()].filter(g => g.length > 1).map(g => {
    const reasons = new Set();
    for(let i = 0; i < g.length; i++) for(let j = i + 1; j < g.length; j++)
      (why.get([String(g[i].id), String(g[j].id)].sort().join('|')) || []).forEach(x => reasons.add(x));
    const nameOnly = [...reasons].every(x => x.includes('이름'));
    return { people: g, reasons: [...reasons], nameOnly };
  }).sort((x, y) => (x.nameOnly - y.nameOnly) || personName(x.people[0]).localeCompare(personName(y.people[0]), 'ko'));
}

let dupEv = '', dupPicked = [], dupNameOnly = false;
/* evKey가 비면 Master DB 전체 */
export function openEvDupes(evKey){
  dupEv = evKey || ''; dupPicked = []; dupNameOnly = !!dupEv;
  closeEvDupes();
  const pop = document.createElement('div');
  pop.id = 'ev-dupes-modal';
  pop.className = 'mw on';
  pop.addEventListener('click', (e) => { if(e.target === pop) closeEvDupes(); });
  document.body.appendChild(pop);
  renderEvDupes();
}
export function closeEvDupes(){ document.getElementById('ev-dupes-modal')?.remove(); }

function renderEvDupes(){
  const pop = document.getElementById('ev-dupes-modal');
  if(!pop) return;
  const allGroups = dupGroups(dupEv);
  const nameOnlyN = allGroups.filter(g => g.nameOnly).length;
  const groups = dupNameOnly ? allGroups : allGroups.filter(g => !g.nameOnly);
  /* 전체에서는 묶음이 수백 개일 수 있다 — 앞의 200개만 그린다 */
  const shownGroups = groups.slice(0, 200);
  const evNames = (c) => dupEv ? '' : [...new Set(participations.filter(p => String(p.contactId) === String(c.id)).map(p => p.eventId || p.event).filter(Boolean))].join(', ');
  const roleOf = (c) => [...new Set(participations.filter(p => (p.eventId || p.event) === dupEv && String(p.contactId) === String(c.id)).map(p => p.role).filter(Boolean))].join(', ');
  const person = (c) => {
    const id = String(c.id), on = dupPicked.includes(id);
    return `<label style="display:grid;grid-template-columns:20px 1.2fr 1.4fr 1.4fr 1fr;gap:8px;align-items:start;padding:6px 8px;cursor:pointer;border-radius:var(--r);${on ? 'background:var(--ad)' : ''}">
      <input type="checkbox" ${on ? 'checked' : ''} onchange="toggleEvDupe('${escAttr(id)}')" style="margin-top:3px">
      <div><b>${escapeHtml(s(c.nameKo) || s(c.nameEn) || '(이름 없음)')}</b>${s(c.nameKo) && s(c.nameEn) ? `<div style="color:var(--i4);font-size:var(--fs-10_5)">${escapeHtml(c.nameEn)}</div>` : ''}</div>
      <div>${escapeHtml(s(c.orgKo) || s(c.orgEn))}<div style="color:var(--i4);font-size:var(--fs-10_5)">${escapeHtml(s(c.titleKo) || s(c.titleEn))}</div></div>
      <div style="font-size:var(--fs-11);color:var(--i3)">${escapeHtml([c.email1, c.email2].filter(v => s(v)).join(', '))}<div>${escapeHtml([c.phone1, c.phone2].filter(v => s(v)).join(', '))}</div></div>
      <div style="font-size:var(--fs-11);color:var(--i4)">${escapeHtml(dupEv ? roleOf(c) : evNames(c))}<div style="font-size:var(--fs-10_5)">${escapeHtml(c.source || '')}</div></div>
    </label>`;
  };
  const list = groups.length ? shownGroups.map(g => `<div style="border:1px solid var(--i7);border-radius:var(--r);margin-bottom:8px;padding:4px">
      <div style="font-size:var(--fs-10_5);color:${g.nameOnly ? 'var(--i5)' : 'var(--ac, var(--i2))'};padding:4px 8px">
        같은 ${escapeHtml(g.reasons.join(' · '))}${g.nameOnly ? ' — 이름만 같아요. 동명이인일 수 있어요' : ''}</div>
      ${g.people.map(person).join('')}</div>`).join('')
      + (groups.length > shownGroups.length ? `<div style="padding:8px;text-align:center;color:var(--i4);font-size:var(--fs-11)">앞의 ${shownGroups.length}묶음만 보여요 — 합치고 나면 다음 묶음이 올라와요</div>` : '')
    : '<div style="padding:24px;text-align:center;color:var(--i4)">겹쳐 보이는 사람이 없어요.</div>';
  const strong = allGroups.length - nameOnlyN;
  pop.innerHTML = `<div class="modal" style="max-width:920px">
    <div class="mh"><div style="flex:1;min-width:0"><div class="mt2">중복 찾기 — ${escapeHtml(dupEv || 'Master DB 전체')}</div>
      <div style="font-size:var(--fs-11);color:var(--i4);margin-top:2px">겹쳐 보이는 묶음 ${allGroups.length}개(메일·전화가 같은 것 ${strong}개). 같은 사람인 두 명을 골라 «합치기»를 누르세요.</div>
      ${nameOnlyN ? `<label style="font-size:var(--fs-11);color:var(--i3);display:inline-flex;gap:4px;align-items:center;margin-top:4px;cursor:pointer">
        <input type="checkbox" ${dupNameOnly ? 'checked' : ''} onchange="toggleDupNameOnly(this.checked)"> 이름만 같은 묶음 ${nameOnlyN}개도 보기 (동명이인일 수 있어요)</label>` : ''}</div></div>
    <div class="mb" style="max-height:62vh;overflow:auto">${list}</div>
    <div class="mf2">
      <span style="margin-right:auto;font-size:var(--fs-11_5);color:var(--i4)">${dupPicked.length}/2명 선택</span>
      <button class="btn" onclick="closeEvDupes()">닫기</button>
      <button class="btn bp" ${dupPicked.length === 2 ? '' : 'disabled'} onclick="mergeEvDupes()">합치기</button>
    </div></div>`;
}
export function toggleDupNameOnly(on){ dupNameOnly = on; dupPicked = []; renderEvDupes(); }
/* Master DB 칩 — 메일·전화가 같은 묶음 수 */
export function strongDupCount(){ return dupGroups('').filter(g => !g.nameOnly).length; }
export function toggleEvDupe(id){
  const i = dupPicked.indexOf(id);
  if(i >= 0) dupPicked.splice(i, 1);
  else { dupPicked.push(id); if(dupPicked.length > 2) dupPicked.shift(); }
  renderEvDupes();
}
export function mergeEvDupes(){
  if(dupPicked.length !== 2) return;
  const [x, y] = dupPicked;
  openContactMerge(x, y, { onDone: () => {
    dupPicked = [];
    window.renderEvDb?.();
    if(!dupEv) window.renderMDB?.();
    renderEvDupes();   // 목록은 열어 둔 채 다시 센다
  } });
}

window.openContactMerge = openContactMerge;
window.closeContactMerge = closeContactMerge;
window.confirmContactMerge = confirmContactMerge;
window.openEvDupes = openEvDupes;
window.closeEvDupes = closeEvDupes;
window.toggleEvDupe = toggleEvDupe;
window.mergeEvDupes = mergeEvDupes;
window.toggleDupNameOnly = toggleDupNameOnly;
window.strongDupCount = strongDupCount;
