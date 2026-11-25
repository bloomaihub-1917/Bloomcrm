/* ══════════════════════════════════════════════════════════════
   modules/event-retro.js — 행사 DB «회고» 보기 (2026-11-23)

   행사가 끝나면 «무엇이 막혔나»를 매번 로그와 스크립트를 뒤져 다시 알아냈다.
   GPBFair(11-19)만 해도 네임택 재출력 349장, 등록 71명 되돌리기, 현장 신규 68명이
   지나고 나서야 보였다. 여기서는 두 가지를 한 화면에 둔다.
   1) 기록으로 본 이 행사 — 참가 기록·활동 기록·네임택에서 숫자를 뽑는다(손으로 적지 않는다)
   2) 잘된 것 · 막힌 것 · 다음엔 미리 할 것 — 사람이 적는다. «다음엔 미리 할 것»은 D-n을 달아 두면
      다음 행사의 «준비» 보기(event-prep.js)에 날짜를 붙여 넘어가고, «기본 단계로» 올리면 모든 행사 공통이 된다.
   저장은 settings 표 key='retro_<행사키>' JSON 하나. 여럿이 함께 적으므로 적을 때마다 서버 값을 다시 읽어
   그 위에 한 줄만 더하거나 뺀다(남이 방금 적은 줄을 덮지 않게).
══════════════════════════════════════════════════════════════ */
import { API_BASE_URL, EVENT_LIST, RETROS, participations, auditLog, currentUser } from '../state.js';
import { escapeHtml, escAttr, td } from '../utils.js';
import { postToSheet, safeFetch, authHeaders } from '../api.js';
import { ensureLogs, logsLoaded } from '../api/lazy-logs.js';
import { loadNametag } from '../api/nametag.js';
import { trackAction } from '../core/audit-log.js';

const SECS = [
  ['good', '👍 잘된 것', '다음에도 그대로 할 것'],
  ['bad',  '🧱 막힌 것', '시간이 많이 들었거나 되돌린 일'],
  ['next', '📌 다음엔 미리 할 것', 'D-n을 달면 다음 행사의 «준비» 보기에 날짜와 함께 넘어가요'],
];
export const DN = [['30', 'D-30'], ['14', 'D-14'], ['7', 'D-7'], ['3', 'D-3'], ['1', 'D-1'], ['0', '당일'], ['-1', '끝난 뒤']];
const dnLabel = (n) => (DN.find(([k]) => k === String(n)) || [, ''])[1];
const empty = () => ({ good: [], bad: [], next: [] });
const evOf = (k) => EVENT_LIST.find((e) => e.key === k);
const evName = (k) => { const e = evOf(k); return e ? (e.short || e.name || k) : k; };
const evStart = (e) => String((e && (e.date_start || e.date)) || '');
const evEnd = (e) => String((e && (e.date_end || e.date_start || e.date)) || '');
/* 날짜만 더한다 — UTC로 계산해야 한국 시간에서 하루 앞당겨지지 않는다 */
const dayAdd = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const me = () => (currentUser && (currentUser.name || currentUser.email)) || '';
export const retroOf = (k) => ({ ...empty(), ...(RETROS[k] || {}) });

/* ── 1) 기록으로 본 이 행사 ── */
const ntStats = new Map();   // 행사 → { loading, err, prints, checkins }
function loadNt(evKey){
  if(ntStats.has(evKey)) return;
  ntStats.set(evKey, { loading: true });
  loadNametag(evKey).then((j) => {
    ntStats.set(evKey, j && j.ok ? { prints: j.prints || [], checkins: j.checkins || [] } : { err: (j && j.error) || '못 불러왔어요' });
    window.renderEvDb?.();
  }).catch((e) => { ntStats.set(evKey, { err: e.message }); window.renderEvDb?.(); });
}
const countBy = (list, f) => { const m = new Map(); list.forEach((x) => { const k = f(x); if(k) m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
const line = (label, val) => `<div style="display:flex;gap:10px;padding:4px 0;border-top:1px solid var(--i7);font-size:var(--fs-11_5)">
  <span style="width:110px;flex:0 0 auto;color:var(--i4)">${label}</span><span style="color:var(--i1);line-height:1.6">${val}</span></div>`;

function factsHtml(ev){
  const k = ev.key, rows = [];
  /* 참가 기록 — 역할별 (확정/전체) */
  const roles = countBy(participations.filter((p) => (p.eventId || p.event) === k), (p) => p.role || '역할 없음');
  const conf = (r) => participations.filter((p) => (p.eventId || p.event) === k && (p.role || '역할 없음') === r && p.confirmedAt).length;
  rows.push(line('참가 기록', roles.length ? roles.map(([r, n]) => `${escapeHtml(r)} ${conf(r)}/${n}`).join(' · ') : '없음'));

  /* 활동 기록 — 처음 열 때 받아 온다 */
  if(!logsLoaded('audit')){
    ensureLogs('audit').then(() => window.renderEvDb?.());
    rows.push(line('활동 기록', '불러오는 중…'));
  } else {
    const logs = auditLog.filter((l) => l.target === k);
    const days = countBy(logs, (l) => String(l.ts).slice(0, 10)).slice(0, 4).map(([d, n]) => `${d.slice(5)} ${n}건`);
    const acts = countBy(logs, (l) => l.action).slice(0, 8).map(([a, n]) => `${escapeHtml(a)} ${n}`);
    const back = logs.filter((l) => l.type === 'delete' || /취소|삭제|되돌|롤백/.test(l.action || ''));
    rows.push(line('활동 기록', logs.length ? `${logs.length}건 · 바빴던 날 ${days.join(', ')}` : '이 행사로 남은 기록이 없어요'));
    if(acts.length) rows.push(line('많이 한 일', acts.join(' · ')));
    if(back.length) rows.push(line('되돌림·삭제', `${back.length}건 — ${countBy(back, (l) => l.action).slice(0, 5).map(([a, n]) => `${escapeHtml(a)} ${n}`).join(' · ')}`));
  }

  /* 네임택 — 발급·재출력·현장 신규·체크인 */
  loadNt(k);
  const nt = ntStats.get(k) || {};
  if(nt.loading) rows.push(line('네임택', '불러오는 중…'));
  else if(nt.err) rows.push(line('네임택', `<span style="color:var(--i4)">${escapeHtml(nt.err)}</span>`));
  else if(nt.prints && nt.prints.length){
    const kinds = Object.fromEntries(countBy(nt.prints, (p) => p.kind));
    const reasons = countBy(nt.prints.filter((p) => p.kind === 'reissue'), (p) => p.reason || '기타').map(([r, n]) => `${escapeHtml(r)} ${n}`).join(' · ');
    const reDays = countBy(nt.prints.filter((p) => p.kind === 'reissue'), (p) => String(p.printed_at).slice(0, 10)).slice(0, 3).map(([d, n]) => `${d.slice(5)} ${n}`).join(', ');
    rows.push(line('네임택 발급', `처음 ${kinds.issue || 0}장 · 재출력 ${kinds.reissue || 0}장${reasons ? ` (${reasons}${reDays ? ` · 몰린 날 ${reDays}` : ''})` : ''} · 현장 신규 ${kinds.walk_in || 0}명`));
    const ck = countBy(nt.checkins || [], (c) => String(c.checked_at).slice(0, 10)).sort((a, b) => a[0].localeCompare(b[0]));
    if(ck.length) rows.push(line('체크인', ck.map(([d, n]) => `${d.slice(5)} ${n}명`).join(' · ')));
  } else rows.push(line('네임택', '발급 기록이 없어요'));

  return `<div class="sec"><div style="background:var(--i8);border:1px solid var(--i6);border-radius:10px;padding:12px 14px">
    <div style="font-size:var(--fs-12);font-weight:700;color:var(--i2);margin-bottom:4px">📊 기록으로 본 이 행사
      <span style="font-weight:400;color:var(--i4);font-size:var(--fs-11)">— 참가 기록·활동 기록·네임택에서 센 숫자예요. 아래 칸을 적을 때 보세요</span></div>
    ${rows.join('')}</div></div>`;
}

/* ── 2) 세 칸 ── */
function secHtml(ev, r, [sec, title, hint]){
  const items = r[sec] || [];
  return `<div style="border:1px solid var(--i6);border-radius:10px;padding:12px 14px;margin-bottom:12px">
    <div style="font-size:var(--fs-12);font-weight:700;color:var(--i1)">${title} <span class="pill p-gray">${items.length}</span>
      <span style="font-weight:400;color:var(--i4);font-size:var(--fs-11)">${hint}</span></div>
    ${items.map((x) => `<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--i7);font-size:var(--fs-12)">
      ${sec === 'next' ? `<span class="pill ${x.dn === '-1' ? 'p-gray' : 'p-blue'}" style="flex:0 0 auto">${escapeHtml(dnLabel(x.dn) || '때 미정')}</span>` : ''}
      ${x.promoted ? '<span class="pill p-green" style="flex:0 0 auto" title="모든 행사 공통 기본 단계에 들어갔어요(행사 준비)">기본 단계</span>' : ''}
      <span style="flex:1;color:var(--i1);white-space:pre-wrap;line-height:1.5">${escapeHtml(x.t)}</span>
      <span style="color:var(--i5);font-size:var(--fs-10_5);white-space:nowrap">${escapeHtml(x.by || '')} ${escapeHtml(String(x.at || '').slice(5, 10))}</span>
      <button class="btn bs" style="font-size:var(--fs-10_5);padding:0 6px" title="지우기" onclick="retroDel('${escAttr(ev.key)}','${sec}','${escAttr(x.id)}')">✕</button></div>`).join('')}
    <div style="display:flex;gap:6px;margin-top:8px;align-items:flex-start">
      ${sec === 'next' ? `<select class="fi" id="retro-dn-${sec}" style="width:86px">${DN.map(([k, l]) => `<option value="${k}"${k === '14' ? ' selected' : ''}>${l}</option>`).join('')}</select>` : ''}
      <textarea class="fi" id="retro-in-${sec}" rows="1" style="flex:1;resize:vertical;min-height:32px" placeholder="한 줄 적고 «더하기» (Ctrl+Enter)"
        onkeydown="if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();retroAdd('${escAttr(ev.key)}','${sec}')}"></textarea>
      <button class="btn bp bs" onclick="retroAdd('${escAttr(ev.key)}','${sec}')">더하기</button></div>
  </div>`;
}

export function retroHtml(ev){
  const r = retroOf(ev.key);
  const ended = evEnd(ev) && evEnd(ev) < td();
  return (ended || (r.good.length + r.bad.length + r.next.length) ? factsHtml(ev) : '')
    + `<div class="sec">${ended ? '' : `<div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:8px">행사가 끝나면 여기 회고를 남겨요. 지금 적어 두어도 돼요.</div>`}
      ${SECS.map((s) => secHtml(ev, r, s)).join('')}</div>`;
}

/* ── 저장 — 서버의 지금 값을 다시 읽어 그 위에 고친다 ── */
async function latest(evKey){
  if(!API_BASE_URL) return retroOf(evKey);
  const rows = await safeFetch(API_BASE_URL + '/api/data?sheet=settings', 'settings(회고)', 1, await authHeaders());
  const row = Array.isArray(rows) ? rows.find((x) => x.key === 'retro_' + evKey) : null;
  if(!Array.isArray(rows)) throw new Error('서버 값을 읽지 못했어요');
  try { return { ...empty(), ...(row ? JSON.parse(row.value) : {}) }; } catch(e){ return empty(); }
}
async function change(evKey, fn, label){
  let r;
  try { r = await latest(evKey); } catch(e){ alert(e.message + ' — 잠시 뒤 다시 해 주세요.'); return false; }
  fn(r);
  r.updated_at = new Date().toISOString(); r.updated_by = me();
  const w = await postToSheet({ sheet: 'settings', action: 'upsert', row: ['retro_' + evKey, JSON.stringify(r)] }, label);
  if(!w.ok){ alert('저장하지 못했어요. 새로고침 후 다시 시도해 주세요.'); return false; }
  RETROS[evKey] = r;
  window.renderEvDb?.();
  return true;
}
export async function retroAdd(evKey, sec){
  const el = document.getElementById('retro-in-' + sec);
  const t = String(el?.value || '').trim();
  if(!t) return;
  const dn = sec === 'next' ? (document.getElementById('retro-dn-next')?.value ?? '') : undefined;
  const item = { id: `R${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, t, by: me(), at: new Date().toISOString(), ...(dn !== undefined ? { dn } : {}) };
  if(await change(evKey, (r) => { r[sec] = [...(r[sec] || []), item]; }, '행사 회고')){
    trackAction('add', '행사 회고', evKey, `${SECS.find((s) => s[0] === sec)[1]} — ${t.slice(0, 80)}`);
  }
}
export async function retroDel(evKey, sec, id){
  const x = (retroOf(evKey)[sec] || []).find((i) => i.id === id);
  if(!x || !confirm(`이 줄을 지울까요?\n${x.t.slice(0, 120)}`)) return;
  if(await change(evKey, (r) => { r[sec] = (r[sec] || []).filter((i) => i.id !== id); }, '행사 회고 지움')){
    trackAction('delete', '행사 회고', evKey, `${SECS.find((s) => s[0] === sec)[1]} — ${x.t.slice(0, 80)}`);
  }
}
/* settings 줄 → RETROS (load.js) */
export function loadRetros(settingsRows){
  Object.keys(RETROS).forEach((k) => delete RETROS[k]);
  (settingsRows || []).forEach((row) => {
    if(!String(row.key || '').startsWith('retro_')) return;
    try { const v = JSON.parse(row.value); if(v && typeof v === 'object') RETROS[String(row.key).slice(6)] = v; }
    catch(e){ console.warn('[CRM] 회고 파싱 실패:', row.key, e); }
  });
}

Object.assign(window, { retroAdd, retroDel });
