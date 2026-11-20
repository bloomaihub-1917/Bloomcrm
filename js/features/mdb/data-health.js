/* ══════════════════════════════════════════════════════════════
   features/mdb/data-health.js — 데이터 점검(«🩺 점검»)

   사고는 늘 며칠 뒤에 드러났다 — 17자리 id로 남의 행사 기록이 붙은 것(09-29),
   기업DB에 안 이어진 160명(11-09·11-12), 메일 없이 행사 당일을 맞은 참가자.
   그때마다 스크립트로 찾아 고쳤다. 여기서는 그 검사를 화면에 모아 생긴 날 보이게 한다.

   · 틀린 데이터(빨강) — 긴 연락처 id, 연락처 없는 참가 기록, 같은 행사·역할 두 줄
   · 빠진 값(노랑) — 기업DB 미연결, 중복 의심, 지금 챙기는 행사 참가자 메일 없음,
     연사 여권(행사 전)·연사료 서류(행사 뒤)
   항목마다 «고치러 가기»가 그 화면을 연다. 화면이 가진 데이터로만 센다(서버를 따로 부르지 않는다).
   Master DB 칩 줄의 «🩺 점검»으로 열고, 하루 처음 열 때 손볼 것이 있으면 한 번 알려 준다.
══════════════════════════════════════════════════════════════ */
import { contacts, participations, EVENT_LIST, SPEAKERS, currentUser } from '../../state.js';
import { escapeHtml, escAttr, td } from '../../utils.js';
import { postToSheet } from '../../api.js';
import { trackAction } from '../../core/audit-log.js';
import { spCell } from '../conference/speaker-cells.js';
import { settleMissing } from '../conference/conf-people.js';
import { isHiddenSp } from '../conference/conf-common.js';
import { confUi } from '../conference/conf-ui.js';
import { mdbUi } from './mdb-ui.js';
import { isUnlinkedContact } from '../../modules/db-tab.js';

const s = (v) => String(v ?? '').trim();
const evOf = (p) => p.eventId || p.event || '';
const evName = (k) => { const e = EVENT_LIST.find((x) => x.key === k); return e ? (e.short || e.name || k) : k; };
const personName = (c) => s(c && c.nameKo) || s(c && c.nameEn) || '(이름 없음)';
const dayAdd = (d, n) => { const t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
const evEnd = (e) => s(e.date_end || e.date_start || e.date);

/* 지금 챙기는 행사 — 끝나지 않았거나 끝난 지 2주 안(결과보고·감사 메일을 보낸다) */
const RECENT_DAYS = 14;
/* 정산은 끝난 뒤 석 달까지 본다 — 그 뒤는 이미 닫았거나 따로 챙긴다 */
const SETTLE_DAYS = 90;

/* 같은 데이터로 여러 번 그리지 않게 — 연락처·참가·연사 수가 바뀔 때만 다시 센다 */
let cache = { key: '', items: [] };
/* 기업DB 연결은 사람 수가 그대로여도 바뀐다 — 미연결 수도 열쇠에 넣는다(싸게 센다) */
const unlinkedN = () => contacts.filter(isUnlinkedContact).length;
const dataKey = () => `${contacts.length}|${participations.length}|${SPEAKERS.length}|${EVENT_LIST.length}|${unlinkedN()}`;
export function invalidateHealth(){ cache.key = ''; }

export function healthItems(){
  const key = dataKey();
  if(cache.key === key) return cache.items;
  const today = td();
  const byId = new Map(contacts.map((c) => [String(c.id), c]));
  const items = [];

  /* ① 긴 연락처 id — 16자리를 넘으면 화면이 숫자로 바꾸며 끝자리가 반올림돼 옆 사람과 뭉개진다(CLAUDE.md) */
  const longC = contacts.filter((c) => !Number.isSafeInteger(Number(c.id)));
  const longP = participations.filter((p) => s(p.contactId) && !Number.isSafeInteger(Number(p.contactId)));
  items.push({ key: 'longid', tone: 'red', label: '긴 연락처 id', n: longC.length + longP.length,
    why: '16자리를 넘는 id는 끝자리가 반올림돼 옆 번호 사람과 한 사람으로 뭉개져요(9-29 사고). 화면에서는 못 고쳐요.',
    fix: '관리자: backend-node에서 node db/fix-unsafe-contact-ids.js(시험) → --apply',
    rows: longC.slice(0, 20).map((c) => ({ text: `${personName(c)} · ${s(c.orgKo) || s(c.orgEn)}`, sub: String(c.id) })) });

  /* ② 연락처 없는 참가 기록 — 가리키는 사람이 지워졌다. 행사 인원에 잡히는데 이름이 안 나온다 */
  const orphan = participations.filter((p) => s(p.contactId) && !byId.has(String(p.contactId)));
  items.push({ key: 'orphan', tone: 'red', label: '연락처 없는 참가 기록', n: orphan.length,
    why: '가리키는 연락처가 없는 참가 기록이에요. 행사 인원에 섞여 숫자가 어긋나요.',
    act: orphan.length ? { label: '이 기록 지우기', fn: 'healthDropOrphans()' } : null,
    rows: orphan.slice(0, 20).map((p) => ({ text: `${evName(evOf(p))} · ${p.role || '역할 없음'}`, sub: `${s(p.note).slice(0, 40)} (연락처 ${p.contactId})` })) });

  /* ③ 같은 행사·같은 역할 두 줄 — 명단이 두 번 들어가 인원이 부풀었다 */
  const g = new Map();
  participations.forEach((p) => {
    const k = `${evOf(p)}|${p.contactId}|${p.role || ''}`;
    if(!g.has(k)) g.set(k, []);
    g.get(k).push(p);
  });
  const dupP = [...g.values()].filter((l) => l.length > 1);
  items.push({ key: 'duppart', tone: 'red', label: '같은 행사·역할 참가 기록 두 줄', n: dupP.length,
    why: '한 사람이 같은 행사·같은 역할로 두 번 들어가 인원이 부풀어요. 확정된 줄 하나만 남겨요.',
    act: dupP.length ? { label: '한 줄만 남기기', fn: 'healthDedupParts()' } : null,
    rows: dupP.slice(0, 20).map((l) => ({ text: `${personName(byId.get(String(l[0].contactId)))} · ${evName(evOf(l[0]))}`, sub: `${l[0].role || '역할 없음'} ${l.length}줄` })) });

  /* ④ 기업DB 미연결 — db-tab.js isUnlinkedContact와 같은 기준 */
  const unlinked = unlinkedN();
  items.push({ key: 'unlinked', tone: 'amber', label: '기업DB 미연결', n: unlinked,
    why: '소속은 적혀 있는데 기업DB에 안 이어진 사람 — 그 기업이 기업DB에서 통째로 빠져 보여요.',
    act: unlinked ? { label: 'Master DB에서 보기', fn: 'healthGoUnlinked()' } : null });

  /* ⑤ 중복 의심 — 메일·전화(끝 8자리)가 같은 묶음 */
  const dupe = window.strongDupCount ? window.strongDupCount() : 0;
  items.push({ key: 'dupe', tone: 'amber', label: '중복 의심 연락처', n: dupe,
    why: '메일이나 전화가 같은 연락처 묶음이에요. 같은 사람이면 하나로 합쳐야 행사 기록이 한 사람에게 모여요.',
    act: dupe ? { label: '중복 찾기 열기', fn: "healthCloseThen(()=>openEvDupes(''))" } : null });

  /* ⑥ 지금 챙기는 행사 참가자 중 메일 없음 — 안내·결과 메일에서 말없이 빠진다 */
  const live = EVENT_LIST.filter((e) => evEnd(e) && evEnd(e) >= dayAdd(today, -RECENT_DAYS));
  const noMail = [];
  live.forEach((e) => {
    const seen = new Set();
    participations.filter((p) => evOf(p) === e.key).forEach((p) => {
      const c = byId.get(String(p.contactId));
      if(!c || seen.has(c.id) || s(c.email1) || s(c.email2)) return;
      seen.add(c.id);
      noMail.push({ ev: e.key, c });
    });
  });
  const mailByEv = [...new Set(noMail.map((x) => x.ev))].map((k) => `${evName(k)} ${noMail.filter((x) => x.ev === k).length}`).join(' · ');
  items.push({ key: 'nomail', tone: 'amber', label: '지금 챙기는 행사 참가자 메일 없음', n: noMail.length,
    why: `안내·결과 메일에서 말없이 빠지는 사람이에요(끝나지 않았거나 끝난 지 ${RECENT_DAYS}일 안의 행사).${mailByEv ? ` ${mailByEv}` : ''}`,
    rows: noMail.slice(0, 40).map((x) => ({ text: `${personName(x.c)} · ${s(x.c.orgKo) || s(x.c.orgEn)}`, sub: evName(x.ev), open: x.c.id })),
    more: Math.max(0, noMail.length - 40) });

  /* ⑦ 연사 서류 — 행사 전에는 해외 연사 여권(항공·숙박), 끝난 뒤에는 연사료 서류(신분증·통장·계좌·여권) */
  const spRows = [];
  EVENT_LIST.forEach((e) => {
    const end = evEnd(e);
    if(!end) return;
    const sps = SPEAKERS.filter((sp) => sp.event_id === e.key && !isHiddenSp(sp));
    if(!sps.length) return;
    if(end >= today){
      const n = sps.filter((sp) => { const c = spCell(sp, e.key, 'passport'); return c.state === 'todo' || c.state === 'part'; }).length;
      if(n) spRows.push({ ev: e.key, phase: 'prep', n, text: `${evName(e.key)} · 여권 안 받음 ${n}명`, sub: '행사 전' });
    } else if(end >= dayAdd(today, -SETTLE_DAYS)){
      const n = sps.filter((sp) => !sp.fee_paid_at && settleMissing(sp).length).length;
      if(n) spRows.push({ ev: e.key, phase: 'settle', n, text: `${evName(e.key)} · 연사료 서류 남음 ${n}명`, sub: '정산' });
    }
  });
  items.push({ key: 'speaker', tone: 'amber', label: '연사 여권·연사료 서류', n: spRows.reduce((a, r) => a + r.n, 0),
    why: `행사 전에는 해외 연사 여권, 끝난 뒤 ${SETTLE_DAYS}일 안에는 연사료 서류가 남은 연사예요. 행사를 누르면 그 연사만 걸러 열어요.`,
    rows: spRows.map((r) => ({ text: r.text, sub: r.sub, go: `healthGoSpeakers('${escAttr(r.ev)}','${r.phase}')` })) });

  cache = { key, items };
  return items;
}

/* ── Master DB 칩 ── */
export function renderHealthChip(){
  const chip = document.getElementById('mdb-health-chip');
  if(!chip) return;
  if(!contacts.length){ chip.style.display = 'none'; return; }
  const bad = healthItems().filter((x) => x.n);
  const red = bad.some((x) => x.tone === 'red');
  chip.style.display = '';
  chip.innerHTML = `<button class="pill ${bad.length ? (red ? 'p-red' : 'p-amber') : 'p-gray'}" style="border:0;cursor:pointer;font:inherit"
    title="데이터 점검 — 긴 id·연락처 없는 참가 기록·기업DB 미연결·중복·메일 없음·연사 서류" onclick="openDataHealth()">🩺 점검 ${bad.length ? `${bad.length}가지` : '✓'}</button>`;
  dailyNotice(bad);
}

/* ── 하루 한 번 알림 — 그날 처음 Master DB를 그릴 때 손볼 것이 있으면 ── */
const dayKey = () => `bloom.health.day.${(currentUser && (currentUser.email || currentUser.name)) || ''}`;
function dailyNotice(bad){
  if(!bad.length) return;
  let seen = '';
  try { seen = localStorage.getItem(dayKey()) || ''; } catch(e){ return; }
  if(seen === td()) return;
  try { localStorage.setItem(dayKey(), td()); } catch(e){ /* 못 적으면 다음에 또 알린다 */ }
  document.getElementById('health-toast')?.remove();
  const t = document.createElement('div');
  t.id = 'health-toast';
  t.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:900;background:var(--bg,#fff);border:1px solid var(--i6);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.14);padding:14px 16px;max-width:340px;font-size:var(--fs-12)';
  t.innerHTML = `<div style="font-weight:700;color:var(--i1);margin-bottom:4px">🩺 오늘 데이터 점검 — 손볼 것 ${bad.length}가지</div>
    <div style="color:var(--i3);line-height:1.6">${bad.map((x) => `${x.tone === 'red' ? '🔴' : '🟡'} ${escapeHtml(x.label)} ${x.n.toLocaleString()}`).join('<br>')}</div>
    <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:10px">
      <button class="btn bs" onclick="document.getElementById('health-toast')?.remove()">나중에</button>
      <button class="btn bp bs" onclick="document.getElementById('health-toast')?.remove();openDataHealth()">보기</button></div>`;
  document.body.appendChild(t);
}

/* ── 점검 창 ── */
const open = new Set();   // 펼친 항목
export function openDataHealth(){
  closeDataHealth();
  invalidateHealth();
  const pop = document.createElement('div');
  pop.id = 'data-health-modal';
  pop.className = 'mw on';
  pop.addEventListener('click', (e) => { if(e.target === pop) closeDataHealth(); });
  document.body.appendChild(pop);
  renderDataHealth();
}
export function closeDataHealth(){ document.getElementById('data-health-modal')?.remove(); }
export function toggleHealthRow(k){ open.has(k) ? open.delete(k) : open.add(k); renderDataHealth(); }

function renderDataHealth(){
  const pop = document.getElementById('data-health-modal');
  if(!pop) return;
  const items = healthItems();
  const bad = items.filter((x) => x.n), ok = items.filter((x) => !x.n);
  const row = (x) => {
    const on = open.has(x.key);
    const list = x.rows && x.rows.length ? `<a href="javascript:void(0)" style="font-size:var(--fs-11);color:var(--a)" onclick="toggleHealthRow('${x.key}')">${on ? '▾ 접기' : `▸ 목록 ${x.rows.length}${x.more ? '+' : ''}`}</a>` : '';
    return `<div style="border:1px solid ${x.tone === 'red' ? 'var(--re)' : 'var(--i6)'};border-radius:10px;padding:10px 12px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span>${x.tone === 'red' ? '🔴' : '🟡'}</span><b style="color:var(--i1)">${escapeHtml(x.label)}</b>
        <span class="pill ${x.tone === 'red' ? 'p-red' : 'p-amber'}">${x.n.toLocaleString()}</span>
        <span style="margin-left:auto;display:flex;gap:8px;align-items:center">${list}${x.act ? `<button class="btn bs" onclick="${x.act.fn}">${escapeHtml(x.act.label)}</button>` : ''}</span></div>
      <div style="font-size:var(--fs-11);color:var(--i4);margin-top:4px;line-height:1.5">${escapeHtml(x.why)}</div>
      ${x.fix ? `<div style="font-size:var(--fs-11);color:var(--i2);margin-top:4px"><code>${escapeHtml(x.fix)}</code></div>` : ''}
      ${on && x.rows ? `<div style="margin-top:8px;max-height:220px;overflow:auto;border-top:1px solid var(--i7)">${x.rows.map((r) => {
        const click = r.open ? `healthCloseThen(()=>openContactDr(${JSON.stringify(r.open)},{edit:true}))` : r.go || '';
        return `<div style="display:flex;gap:8px;padding:5px 2px;font-size:var(--fs-11_5);border-bottom:1px solid var(--i7);${click ? 'cursor:pointer' : ''}" ${click ? `onclick="${escAttr(click)}"` : ''}>
          <span style="color:var(--i1)">${escapeHtml(r.text)}</span><span style="margin-left:auto;color:var(--i4)">${escapeHtml(r.sub || '')}</span></div>`; }).join('')}
        ${x.more ? `<div style="padding:6px 2px;font-size:var(--fs-11);color:var(--i4)">외 ${x.more}명</div>` : ''}</div>` : ''}
    </div>`;
  };
  pop.innerHTML = `<div class="modal" style="max-width:720px">
    <div class="mh"><div style="flex:1;min-width:0"><div class="mt2">🩺 데이터 점검</div>
      <div style="font-size:var(--fs-11);color:var(--i4);margin-top:2px">${bad.length ? `손볼 것 ${bad.length}가지 — 빨강은 틀린 데이터, 노랑은 빠진 값이에요.` : '손볼 것이 없어요.'} 지금 화면에 불러온 데이터로 셉니다.</div></div></div>
    <div class="mb" style="max-height:64vh;overflow:auto">
      ${bad.map(row).join('')}
      ${ok.length ? `<div style="font-size:var(--fs-11);color:var(--g);margin-top:6px">✓ 이상 없음 — ${ok.map((x) => escapeHtml(x.label)).join(' · ')}</div>` : ''}
    </div>
    <div class="mf2"><button class="btn" onclick="closeDataHealth()">닫기</button></div></div>`;
}

/* ── 고치러 가기 ── */
export function healthCloseThen(fn){ closeDataHealth(); try { fn(); } catch(e){ console.warn('[점검]', e); } }
export function healthGoUnlinked(){
  closeDataHealth();
  window.switchApp?.('mdb');
  mdbUi.mdbUnlinked = true;
  window.renderMDB?.();
}
export function healthGoSpeakers(evKey, phase){
  closeDataHealth();
  window.switchApp?.('conf');
  window.setConfEvent?.(evKey);   // 행사를 바꾸면 거르기가 풀린다 — 그 뒤에 건다
  confUi.confView = 'people';
  confUi.confPhase = '';   // 단계는 행사 날짜로 저절로 — 끝났으면 정산, 아니면 준비
  if(phase === 'settle') confUi.confSettleFil = 'docs';
  else confUi.confNeedFil = { key: 'passport', mode: 'todo' };
  window.renderConf?.();
}

/* 연락처 없는 참가 기록 지우기 — 가리킬 사람이 없으니 되살릴 것도 없다 */
export async function healthDropOrphans(){
  const byId = new Set(contacts.map((c) => String(c.id)));
  const list = participations.filter((p) => s(p.contactId) && !byId.has(String(p.contactId)));
  if(!list.length) return;
  if(!confirm(`연락처가 없는 참가 기록 ${list.length}줄을 지울까요?\n${list.slice(0, 8).map((p) => `· ${evName(evOf(p))} ${p.role || ''} (연락처 ${p.contactId})`).join('\n')}${list.length > 8 ? '\n…' : ''}`)) return;
  const ids = list.map((p) => p.id);
  for(let i = 0; i < ids.length; i += 100){
    const r = await postToSheet({ sheet: 'participations', action: 'delete', row: ids.slice(i, i + 100) }, '점검 · 연락처 없는 참가 기록');
    if(!r.ok){ alert('일부를 지우지 못했어요. 새로고침 후 다시 시도해 주세요.'); break; }
    ids.slice(i, i + 100).forEach((id) => { const k = participations.findIndex((p) => p.id === id); if(k >= 0) participations.splice(k, 1); });
  }
  trackAction('delete', '점검 · 연락처 없는 참가 기록', '', `${list.length}줄 지움`);
  afterFix();
}

/* 같은 행사·역할 두 줄 — 확정된 줄(없으면 메모가 긴 줄)을 남기고 나머지를 지운다 */
export async function healthDedupParts(){
  const g = new Map();
  participations.forEach((p) => { const k = `${evOf(p)}|${p.contactId}|${p.role || ''}`; if(!g.has(k)) g.set(k, []); g.get(k).push(p); });
  const drop = [];
  [...g.values()].filter((l) => l.length > 1).forEach((l) => {
    const keep = [...l].sort((a, b) => (!!b.confirmedAt - !!a.confirmedAt) || (s(b.note).length - s(a.note).length))[0];
    l.forEach((p) => { if(p !== keep) drop.push(p); });
  });
  if(!drop.length) return;
  const lost = drop.filter((p) => s(p.note));
  if(!confirm(`겹친 참가 기록 ${drop.length}줄을 지우고 한 사람·한 역할에 한 줄만 남길까요?\n확정된 줄을 남기고, 없으면 메모가 긴 줄을 남겨요.${lost.length ? `\n지우는 줄의 메모 ${lost.length}개는 사라져요.` : ''}`)) return;
  const ids = drop.map((p) => p.id);
  for(let i = 0; i < ids.length; i += 100){
    const r = await postToSheet({ sheet: 'participations', action: 'delete', row: ids.slice(i, i + 100) }, '점검 · 겹친 참가 기록');
    if(!r.ok){ alert('일부를 지우지 못했어요. 새로고침 후 다시 시도해 주세요.'); break; }
    ids.slice(i, i + 100).forEach((id) => { const k = participations.findIndex((p) => p.id === id); if(k >= 0) participations.splice(k, 1); });
  }
  trackAction('delete', '점검 · 겹친 참가 기록', '', `${drop.length}줄 지움`);
  afterFix();
}
function afterFix(){
  invalidateHealth();
  window.invalidateEvRows?.();
  renderDataHealth();
  window.renderMDB?.();
}

window.openDataHealth = openDataHealth;
window.closeDataHealth = closeDataHealth;
window.toggleHealthRow = toggleHealthRow;
window.healthCloseThen = healthCloseThen;
window.healthGoUnlinked = healthGoUnlinked;
window.healthGoSpeakers = healthGoSpeakers;
window.healthDropOrphans = healthDropOrphans;
window.healthDedupParts = healthDedupParts;
window.renderHealthChip = renderHealthChip;
