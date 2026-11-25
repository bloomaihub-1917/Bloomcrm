/* ══════════════════════════════════════════════════════════════
   modules/event-prep.js — 행사 준비 단계(D-n) (2026-11-25)

   마감 대신 리마인더로 — 행사마다 늘 하는 일(네임택 판 확정, 명단 마감, 사전 출력, 체크인 시험)을
   «D-n»으로 한 번 정해 두고, 행사 날짜에 맞춰 날을 붙여 띄운다. 할 일이 셋에서 온다.
   · 기본 단계 — 모든 행사 공통. settings key='prep_steps' JSON [{id,t,dn}] (없으면 DEFAULT_STEPS)
   · 회고에서 넘어온 것 — 최근 끝난 행사 회고의 «다음엔 미리 할 것»(event-retro.js). «기본 단계로»를 누르면
     기본 단계에 들어가고 회고 쪽은 promoted로 표시돼 더 넘어오지 않는다
   · 이 행사만 — 행사 준비 보기에서 더한 줄
   했음·해당 없음은 행사마다 settings key='prep_<행사키>' JSON { done:{id:{at,by,na}}, extra:[{id,t,dn,by,at}] }.
   «끝난 뒤»(dn -1)는 마지막 날 다음 날로 — 현장 신규 올리기·회고처럼 끝나고 하는 일이다.
   Master DB 칩 «📅 준비»와 하루 한 번 알림(data-health.js)이 7일 안에 할 일·지난 일을 센다.
══════════════════════════════════════════════════════════════ */
import { API_BASE_URL, EVENT_LIST, PREPS, RETROS, currentUser } from '../state.js';
import { escapeHtml, escAttr, td } from '../utils.js';
import { postToSheet, safeFetch, authHeaders } from '../api.js';
import { trackAction } from '../core/audit-log.js';

export const DN = [['60', 'D-60'], ['30', 'D-30'], ['14', 'D-14'], ['7', 'D-7'], ['3', 'D-3'], ['1', 'D-1'], ['0', '당일'], ['-1', '끝난 뒤']];
export const dnLabel = (n) => (DN.find(([k]) => k === String(n)) || [, `D-${n}`])[1];
/* 기본 단계 — GPBFair(11-19) 회고에서 나온 것. 설정에서 바꾸면 settings prep_steps가 이것을 대신한다 */
export const DEFAULT_STEPS = [
  { id: 'S01', dn: '30', t: '연사에게 받을 것(이력·사진·초록·여권·계좌)을 설정에서 정하고 초청 메일을 보낸다' },
  { id: 'S02', dn: '30', t: '네임택 판·하단바 종류·영문 성명 표기 규칙을 확정한다' },
  { id: 'S03', dn: '14', t: '주최사·파트너링·등록 명단을 받는 마감일과 담당자를 정한다 — 그 뒤 변경은 «명단 맞추기»로만' },
  { id: 'S04', dn: '14', t: '네임택 시험 출력·체크인 리허설(프린터·용지·QR·카메라)' },
  { id: 'S05', dn: '7',  t: '등록 엑셀은 몇 건만 확정해 맞는 명단인지 본 뒤 «모두 확정»' },
  { id: 'S06', dn: '3',  t: '명단을 잠그고 네임택을 사전 출력한다 — 그 뒤에는 바뀐 사람만 재출력' },
  { id: 'S07', dn: '1',  t: '현장 데스크 기기 로그인·프린터 확인, STAFF·사진·통역 명찰은 현장 신규 말고 따로 준비' },
  { id: 'S08', dn: '-1', t: '현장 신규를 마스터DB에 올리고 «🩺 점검»을 연다' },
  { id: 'S09', dn: '-1', t: '일주일 안에 행사 회고를 남긴다' },
];
let STEPS = null;   // settings prep_steps (null = 기본)
export const steps = () => STEPS || DEFAULT_STEPS;

const CARRY_DAYS = 120;   // 이만큼 안에 끝난 행사의 회고만 넘어온다
const SHOW_AFTER = 14;    // 끝난 뒤 이만큼은 «끝난 뒤» 할 일을 띄운다
const SOON = 7;           // 칩·알림 — 이 안에 할 일
const s = (v) => String(v ?? '').trim();
const evStart = (e) => s(e && (e.date_start || e.date));
const evEnd = (e) => s(e && (e.date_end || e.date_start || e.date));
const evName = (k) => { const e = EVENT_LIST.find((x) => x.key === k); return e ? (e.short || e.name || k) : k; };
/* 날짜만 더한다 — UTC로 계산해야 한국 시간에서 하루 앞당겨지지 않는다 */
const dayAdd = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const me = () => (currentUser && (currentUser.name || currentUser.email)) || '';
const prepOf = (k) => ({ done: {}, extra: [], ...(PREPS[k] || {}) });

/* 이 행사의 할 일 — 기본 + 회고에서 넘어온 것 + 이 행사만, 날짜 붙여 */
export function prepItems(ev){
  const start = evStart(ev), end = evEnd(ev) || start;
  if(!start) return [];
  const today = td();
  const ended = end < today;
  const due = (dn) => dn === '-1' ? dayAdd(end, 1) : dayAdd(start, -Number(dn || 0));
  const list = [];
  steps().forEach((x) => list.push({ ...x, src: 'base' }));
  Object.entries(RETROS).forEach(([k, r]) => {
    if(k === ev.key) return;
    const e = EVENT_LIST.find((x) => x.key === k);
    if(!e || evEnd(e) >= start || evEnd(e) < dayAdd(start, -CARRY_DAYS)) return;   // 이 행사 전에 끝난 행사의 회고만
    (r.next || []).forEach((x) => { if(!x.promoted && x.dn != null && x.dn !== '') list.push({ id: x.id, t: x.t, dn: String(x.dn), src: 'retro', from: k }); });
  });
  prepOf(ev.key).extra.forEach((x) => list.push({ ...x, src: 'extra' }));
  const p = prepOf(ev.key);
  return list.filter((x) => !ended || x.dn === '-1')
    .map((x) => ({ ...x, due: due(String(x.dn)), done: p.done[x.id] || null }))
    .sort((a, b) => a.due.localeCompare(b.due) || a.src.localeCompare(b.src));
}

/* 지금 챙길 행사 — 아직 안 끝났거나 끝난 지 SHOW_AFTER일 안 */
const liveEvents = () => EVENT_LIST.filter((e) => evStart(e) && evEnd(e) >= dayAdd(td(), -SHOW_AFTER));
/* 칩·알림용 — 안 한 일 중 지난 것과 SOON일 안 */
export function prepDue(){
  const today = td(), soon = dayAdd(today, SOON);
  const out = [];
  liveEvents().forEach((e) => prepItems(e).forEach((x) => { if(!x.done && x.due <= soon) out.push({ ...x, ev: e.key, late: x.due < today }); }));
  return out.sort((a, b) => a.due.localeCompare(b.due));
}
export function prepNext(){
  const today = td();
  const all = [];
  liveEvents().forEach((e) => prepItems(e).forEach((x) => { if(!x.done && x.due >= today) all.push({ ...x, ev: e.key }); }));
  return all.sort((a, b) => a.due.localeCompare(b.due))[0] || null;
}

/* ── 행사 DB «준비» 보기 ── */
let editSteps = false;
export function prepHtml(ev){
  if(!evStart(ev)) return `<div class="sec" style="color:var(--i4);font-size:var(--fs-12)">행사 날짜가 없어 D-n을 붙일 수 없어요 — 설정 › 행사 관리에서 날짜를 넣어 주세요.</div>`;
  const items = prepItems(ev), today = td();
  const ended = evEnd(ev) < today;
  const doneN = items.filter((x) => x.done).length;
  const srcTag = (x) => x.src === 'retro' ? `<span class="pill p-amber" title="${escapeHtml(evName(x.from))} 회고의 «다음엔 미리 할 것»">${escapeHtml(evName(x.from))} 회고</span>`
    : x.src === 'extra' ? '<span class="pill p-gray">이 행사만</span>' : '';
  const row = (x) => {
    const late = !x.done && x.due < today;
    return `<div style="display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--i7);font-size:var(--fs-12)">
      <input type="checkbox" ${x.done && !x.done.na ? 'checked' : ''} ${x.done && x.done.na ? 'disabled' : ''} style="margin-top:3px;cursor:pointer"
        onchange="prepMark('${escAttr(ev.key)}','${escAttr(x.id)}',this.checked?'done':'')">
      <span class="pill ${x.done ? 'p-gray' : late ? 'p-red' : x.due <= dayAdd(today, SOON) ? 'p-amber' : 'p-blue'}" style="flex:0 0 auto;min-width:92px;text-align:center">${escapeHtml(dnLabel(x.dn))} · ${escapeHtml(x.due.slice(5))}</span>
      <span style="flex:1;line-height:1.5;${x.done ? 'color:var(--i4);text-decoration:line-through' : 'color:var(--i1)'}">${escapeHtml(x.t)} ${srcTag(x)}</span>
      <span style="color:var(--i5);font-size:var(--fs-10_5);white-space:nowrap">${x.done ? `${x.done.na ? '해당 없음 · ' : ''}${escapeHtml(x.done.by || '')} ${escapeHtml(String(x.done.at || '').slice(5, 10))}` : ''}</span>
      ${x.done ? (x.done.na ? `<button class="btn bs" style="font-size:var(--fs-10_5)" onclick="prepMark('${escAttr(ev.key)}','${escAttr(x.id)}','')">되살리기</button>` : '')
        : `<button class="btn bs" style="font-size:var(--fs-10_5)" title="이 행사에는 해당하지 않는 일 — 세지 않아요" onclick="prepMark('${escAttr(ev.key)}','${escAttr(x.id)}','na')">해당 없음</button>`}
      ${x.src === 'retro' ? `<button class="btn bs" style="font-size:var(--fs-10_5)" title="모든 행사 공통 기본 단계에 넣어요 — 그 뒤로는 회고에서 따로 넘어오지 않아요" onclick="prepPromote('${escAttr(x.from)}','${escAttr(x.id)}')">기본 단계로</button>` : ''}
      ${x.src === 'extra' ? `<button class="btn bs" style="font-size:var(--fs-10_5);padding:0 6px" title="지우기" onclick="prepDelExtra('${escAttr(ev.key)}','${escAttr(x.id)}')">✕</button>` : ''}
    </div>`;
  };
  const dnSel = (id) => `<select class="fi" id="${id}" style="width:92px">${DN.map(([k, l]) => `<option value="${k}"${k === '14' ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const stepsEditor = editSteps ? `<div style="border:1px dashed var(--i5);border-radius:10px;padding:12px 14px;margin-top:12px">
      <div style="font-size:var(--fs-12);font-weight:700;color:var(--i1);margin-bottom:6px">기본 단계 — 모든 행사 공통${STEPS ? '' : ' <span style="font-weight:400;color:var(--i4)">(처음 값)</span>'}</div>
      ${steps().map((x) => `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;font-size:var(--fs-12)">
        <span class="pill p-blue" style="min-width:56px;text-align:center">${escapeHtml(dnLabel(x.dn))}</span><span style="flex:1">${escapeHtml(x.t)}</span>
        <button class="btn bs" style="font-size:var(--fs-10_5);padding:0 6px" onclick="prepDelStep('${escAttr(x.id)}')">✕</button></div>`).join('')}
      <div style="display:flex;gap:6px;margin-top:8px">${dnSel('prep-step-dn')}
        <input class="fi" id="prep-step-in" style="flex:1" placeholder="모든 행사에 넣을 단계" onkeydown="if(event.key==='Enter')prepAddStep()">
        <button class="btn bp bs" onclick="prepAddStep()">기본 단계 더하기</button></div></div>` : '';
  return `<div class="sec"><div style="border:1px solid var(--i6);border-radius:10px;padding:12px 14px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
        <b style="font-size:var(--fs-12);color:var(--i1)">📅 행사 준비</b><span class="pill p-blue">${doneN}/${items.length}</span>
        <span style="font-size:var(--fs-11);color:var(--i4)">${escapeHtml(evStart(ev))} 기준으로 날을 붙였어요${ended ? ' · 끝난 행사라 «끝난 뒤» 할 일만 보여요' : ''}</span>
        <button class="btn bs" style="margin-left:auto;font-size:var(--fs-11)" onclick="prepToggleSteps()">${editSteps ? '기본 단계 닫기' : '기본 단계 고치기'}</button></div>
      ${items.length ? items.map(row).join('') : '<div style="padding:10px 0;color:var(--i4);font-size:var(--fs-12)">할 일이 없어요.</div>'}
      <div style="display:flex;gap:6px;margin-top:10px">${dnSel('prep-extra-dn')}
        <input class="fi" id="prep-extra-in" style="flex:1" placeholder="이 행사에만 할 일" onkeydown="if(event.key==='Enter')prepAddExtra('${escAttr(ev.key)}')">
        <button class="btn bp bs" onclick="prepAddExtra('${escAttr(ev.key)}')">더하기</button></div>
      ${stepsEditor}
    </div></div>`;
}

/* ── 저장 — 서버의 지금 값을 다시 읽어 그 위에 고친다(여럿이 함께 체크해도 덮지 않게) ── */
async function latest(key, fallback){
  if(!API_BASE_URL) return fallback();
  const rows = await safeFetch(API_BASE_URL + '/api/data?sheet=settings', 'settings(행사 준비)', 1, await authHeaders());
  if(!Array.isArray(rows)) throw new Error('서버 값을 읽지 못했어요');
  const row = rows.find((x) => x.key === key);
  if(!row) return fallback();
  try { return JSON.parse(row.value); } catch(e){ return fallback(); }
}
async function save(key, v, label){
  const w = await postToSheet({ sheet: 'settings', action: 'upsert', row: [key, JSON.stringify(v)] }, label);
  if(!w.ok) alert('저장하지 못했어요. 새로고침 후 다시 시도해 주세요.');
  return w.ok;
}
async function changePrep(evKey, fn, label){
  let p;
  try { p = { done: {}, extra: [], ...(await latest('prep_' + evKey, () => prepOf(evKey))) }; } catch(e){ alert(e.message); return false; }
  fn(p);
  if(!(await save('prep_' + evKey, p, label))) return false;
  PREPS[evKey] = p;
  afterChange();
  return true;
}
async function changeSteps(fn, label){
  let st;
  try { st = await latest('prep_steps', () => steps().map((x) => ({ ...x }))); } catch(e){ alert(e.message); return false; }
  if(!Array.isArray(st)) st = steps().map((x) => ({ ...x }));
  fn(st);
  if(!(await save('prep_steps', st, label))) return false;
  STEPS = st;
  afterChange();
  return true;
}
function afterChange(){ window.renderEvDb?.(); renderPrepChip(); }

export async function prepMark(evKey, id, how){
  const x = prepItems(EVENT_LIST.find((e) => e.key === evKey) || {}).find((i) => i.id === id);
  await changePrep(evKey, (p) => {
    p.done = { ...(p.done || {}) };
    if(how) p.done[id] = { at: new Date().toISOString(), by: me(), ...(how === 'na' ? { na: true } : {}) };
    else delete p.done[id];
  }, '행사 준비');
  if(how) trackAction('edit', '행사 준비', evKey, `${how === 'na' ? '해당 없음' : '했음'} — ${x ? x.t.slice(0, 80) : id}`);
}
export async function prepAddExtra(evKey){
  const t = s(document.getElementById('prep-extra-in')?.value);
  if(!t) return;
  const dn = document.getElementById('prep-extra-dn')?.value || '14';
  const item = { id: `E${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, t, dn, by: me(), at: new Date().toISOString() };
  if(await changePrep(evKey, (p) => { p.extra = [...(p.extra || []), item]; }, '행사 준비 더함')) trackAction('add', '행사 준비', evKey, `${dnLabel(dn)} — ${t.slice(0, 80)}`);
}
export async function prepDelExtra(evKey, id){
  const x = prepOf(evKey).extra.find((i) => i.id === id);
  if(!x || !confirm(`이 할 일을 지울까요?\n${x.t}`)) return;
  await changePrep(evKey, (p) => { p.extra = (p.extra || []).filter((i) => i.id !== id); }, '행사 준비 지움');
}
export function prepToggleSteps(){ editSteps = !editSteps; window.renderEvDb?.(); }
export async function prepAddStep(){
  const t = s(document.getElementById('prep-step-in')?.value);
  if(!t) return;
  const dn = document.getElementById('prep-step-dn')?.value || '14';
  if(await changeSteps((st) => st.push({ id: `S${Date.now().toString(36)}`, dn, t }), '기본 단계 더함')) trackAction('add', '행사 준비 기본 단계', '', `${dnLabel(dn)} — ${t.slice(0, 80)}`);
}
export async function prepDelStep(id){
  const x = steps().find((i) => i.id === id);
  if(!x || !confirm(`기본 단계에서 뺄까요? 모든 행사의 준비 목록에서 빠져요.\n${x.t}`)) return;
  if(await changeSteps((st) => { const k = st.findIndex((i) => i.id === id); if(k >= 0) st.splice(k, 1); }, '기본 단계 뺌')) trackAction('delete', '행사 준비 기본 단계', '', x.t.slice(0, 80));
}
/* 회고의 «다음엔 미리 할 것» → 기본 단계. 회고 줄에는 promoted를 남겨 더 넘어오지 않게 */
export async function prepPromote(fromEv, id){
  const x = ((RETROS[fromEv] || {}).next || []).find((i) => i.id === id);
  if(!x || !confirm(`모든 행사의 기본 단계로 넣을까요?\n${dnLabel(x.dn)} — ${x.t}`)) return;
  if(!(await changeSteps((st) => { if(!st.some((i) => i.id === id)) st.push({ id, dn: String(x.dn), t: x.t }); }, '기본 단계로'))) return;
  let r;
  try { r = await latest('retro_' + fromEv, () => RETROS[fromEv] || {}); } catch(e){ return; }
  r.next = (r.next || []).map((i) => i.id === id ? { ...i, promoted: true } : i);
  if(await save('retro_' + fromEv, r, '회고 → 기본 단계')) RETROS[fromEv] = r;
  trackAction('edit', '행사 준비 기본 단계', fromEv, `회고에서 올림 — ${x.t.slice(0, 80)}`);
  afterChange();
}

/* ── Master DB 칩 «📅 준비» + 목록 창 ── */
export function renderPrepChip(){
  const chip = document.getElementById('mdb-prep-chip');
  if(!chip) return;
  const due = prepDue(), nx = prepNext();
  if(!due.length && !nx){ chip.style.display = 'none'; chip.innerHTML = ''; return; }
  const late = due.some((x) => x.late);
  chip.style.display = '';
  chip.innerHTML = `<button class="pill ${late ? 'p-red' : due.length ? 'p-amber' : 'p-gray'}" style="border:0;cursor:pointer;font:inherit"
    title="행사 준비 — 지난 일·${SOON}일 안에 할 일" onclick="openPrepDue()">📅 준비 ${due.length ? `${due.length}건` : `다음 ${escapeHtml(nx.due.slice(5))}`}</button>`;
}
export function openPrepDue(){
  document.getElementById('prep-due-modal')?.remove();
  const due = prepDue(), nx = prepNext();
  const pop = document.createElement('div');
  pop.id = 'prep-due-modal'; pop.className = 'mw on';
  pop.addEventListener('click', (e) => { if(e.target === pop) pop.remove(); });
  const byEv = [...new Set(due.map((x) => x.ev))];
  pop.innerHTML = `<div class="modal" style="max-width:640px">
    <div class="mh"><div style="flex:1"><div class="mt2">📅 행사 준비 — 지난 일·${SOON}일 안에 할 일</div>
      <div style="font-size:var(--fs-11);color:var(--i4);margin-top:2px">행사를 누르면 그 행사의 «준비» 보기가 열려요.${!due.length && nx ? ` 다음 할 일은 ${escapeHtml(nx.due)} ${escapeHtml(evName(nx.ev))} «${escapeHtml(nx.t.slice(0, 40))}»예요.` : ''}</div></div></div>
    <div class="mb" style="max-height:60vh;overflow:auto">${byEv.length ? byEv.map((k) => `
      <div style="border:1px solid var(--i6);border-radius:10px;padding:10px 12px;margin-bottom:8px">
        <a href="javascript:void(0)" style="font-weight:700;color:var(--a)" onclick="prepGoEvent('${escAttr(k)}')">${escapeHtml(evName(k))} ›</a>
        ${due.filter((x) => x.ev === k).map((x) => `<div style="display:flex;gap:8px;padding:5px 0;font-size:var(--fs-12)">
          <span class="pill ${x.late ? 'p-red' : 'p-amber'}" style="flex:0 0 auto">${escapeHtml(dnLabel(x.dn))} · ${escapeHtml(x.due.slice(5))}</span><span>${escapeHtml(x.t)}</span></div>`).join('')}
      </div>`).join('') : '<div style="padding:20px;text-align:center;color:var(--i4)">지난 일도, 일주일 안에 할 일도 없어요.</div>'}</div>
    <div class="mf2"><button class="btn" onclick="document.getElementById('prep-due-modal')?.remove()">닫기</button></div></div>`;
  document.body.appendChild(pop);
}
export function prepGoEvent(k){
  document.getElementById('prep-due-modal')?.remove();
  window.switchApp?.('evdb');
  window.setEvDbEvent?.(k);
  window.setEvDbView?.('prep');
}

/* settings 줄 → PREPS·STEPS (load.js) */
export function loadPreps(settingsRows){
  Object.keys(PREPS).forEach((k) => delete PREPS[k]);
  STEPS = null;
  (settingsRows || []).forEach((row) => {
    const key = String(row.key || '');
    try {
      if(key === 'prep_steps'){ const v = JSON.parse(row.value); if(Array.isArray(v)) STEPS = v; }
      else if(key.startsWith('prep_')){ const v = JSON.parse(row.value); if(v && typeof v === 'object') PREPS[key.slice(5)] = v; }
    } catch(e){ console.warn('[CRM] 행사 준비 파싱 실패:', key, e); }
  });
}

Object.assign(window, { prepMark, prepAddExtra, prepDelExtra, prepToggleSteps, prepAddStep, prepDelStep, prepPromote, openPrepDue, prepGoEvent, renderPrepChip });
