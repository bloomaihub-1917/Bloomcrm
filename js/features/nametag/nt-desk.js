/* ══════════════════════════════════════════════════════════════
   nt-desk.js — 행사 DB › 네임택 탭 (발급 데스크 · 체크인)

   현장 데스크에서: 사람 찾기 → 미리보기(소속·직함은 여기서 고쳐 찍는다) → 인쇄 → 기록.
   bizmatching nametag-package의 NametagDesk를 옮겼다. 다른 점:
   - 명단은 서버에 묻지 않는다. 연사·부스 인원·참가자를 화면이 가진 데이터에서 모은다(nt-people.js)
   - 고쳐 찍은 값은 발급 기록에만 남는다. 마스터DB 연락처는 그대로다
   - 국·영문을 판 기본값(자동·국문·영문)으로 고르고, 한 사람씩 바꿀 수 있다

   2026-11-10 등록 담당자 피드백으로 더한 것
   - 하단바: 사람마다 어느 띠를 줄지 명단·미리보기·인쇄 창에 보인다. 종류는 행사마다(설정 › 행사 상세 › 네임택).
     한 명·고른 여러 명·엑셀(등록번호로 맞춘다)로 정한다. 현장 신규는 비워 두고 나중에 채워도 된다
   - 체크인: «현장 출력»으로 뽑으면 인쇄와 함께 체크인. 사전 출력한 사람은 «체크인» 보기에서 따로 누른다.
     데스크 여러 대가 같은 숫자를 보게 15초마다 서버에 묻는다(/live)
   - 최종 등록자 명단: «명단 엑셀»이 현장 신규까지 한 줄씩 내려 준다(하단바 엑셀 올리기 양식도 이것).
     현장 신규는 «마스터DB에 올리기»로 연락처·참가 확정을 만든다

   끊김 대비(2026-11-10): 발급·체크인·되돌리기·하단바는 누르는 그 순간 이 기기에 남기고(nt-outbox.js) 화면과 인쇄를
   바로 진행한다. 서버에는 뒤에서 차례로 보낸다 — 인터넷이 끊겨도 데스크는 멈추지 않고, 연결되면 한꺼번에 들어간다.
   위 막대의 연결 표시를 누르면 이 기기에 남긴 기록(보냄·기다림·못 보냄)을 보고 엑셀로 내려받는다.
   서버에서 받은 것 위에 «아직 안 보낸 기기 기록»을 늘 다시 얹는다(applyPending) — 새로 받아도 안 보낸 것이 사라지지 않게.

   왼쪽 명단은 #evdb-rows라 검색(event-tab.js setEvDbQuery)이 목록만 갈아 끼운다.
═══════════════════════════════════════════════════════════════ */
import { escapeHtml, escAttr, isMobile } from '../../utils.js';
import { contacts, participations, EVENT_LIST, currentUser } from '../../state.js';
import { normalizeTemplate, LANG_OPTIONS, REISSUE_REASONS, MM_PX, parseScan, TEXT_KEYS, EL_LABEL, layoutFor } from '../../domain/nametag-layout.js';
import { loadNametag, loadNametagLive, promoteWalkIns } from '../../api/nametag.js';
import { enqueue, newId, waiting, failed, deviceLog, netState, markNet, onOutbox, kick, retryFailed, dismissFailed } from './nt-outbox.js';
import { ntPeople, walkInPeople, cardOf, SOURCE_LABEL } from './nt-people.js';
import { ntCardHtml } from './nt-card.js';
import { fitNametags } from './nt-fit.js';
import { openPrintWindow, fillPrintWindow } from './nt-print.js';
import { openCamera, closeCamera, cameraOn, preloadQrReader } from './nt-camera.js';

const POLL_MS = 15000;
const nt = {
  ev: '', loaded: '', loading: false, err: '',
  template: normalizeTemplate(null), prints: [],
  people: new Map(),     // person_key → nametag_people 줄 { bar, email, phone, contact_id }
  checkins: new Map(),   // person_key → 살아 있는 체크인 { id, via, checked_at, checked_by }
  since: '',             // /live에 «이 뒤로 바뀐 것»을 묻는 기준(서버 시각)
  syncedAt: '',          // 서버에서 마지막으로 받은 시각(이 기기 시각) — 끊기면 숫자가 언제 것인지 보여 준다
  netView: false,        // 오른쪽에 «이 기기 기록»을 띄웠는지
  view: 'issue',         // 'issue'(발급) | 'checkin'(체크인)
  onsite: null,          // null이면 행사 기간으로 정한다(기간 안이면 현장 출력)
  filter: 'todo',        // 발급: 'todo'(안 받음) | 'done'(받음) | 'all'  · 체크인: 'todo'(안 옴) | 'done'(옴) | 'all'
  src: '',               // '' | 'speaker' | 'exh' | 'part' | 'walk_in'
  barFil: '',            // '' | '_none'(미정) | 하단바 종류 id
  sort: readSort(),      // 'org'(소속 → 이름) | 'kind'(구분 → 이름) | 'bar'(하단바 → 이름) | 'name'(이름) — 이 기기에 기억(nametag.sort.v1)
  alias: new Map(),      // 옛 키(s<연사>·x<담당자>) → 지금 키(c<연락처>) — foldAliases
  defBar: new Map(),     // 사람 키 → 참가 역할로 정해지는 하단바 id(사람마다 정한 띠가 없을 때) — foldAliases
  picked: new Set(), focus: '',
  edits: new Map(),      // person_key → { name, company, job_title, badge, lang }
  walkIn: null,          // 현장 신규 입력 중이면 { name, company, job_title, badge, bar, email, phone }
  imp: null,             // 하단바 엑셀 미리보기 { file, rows:[{ key, name, from, to, state }], counts }
  reason: '', busy: false, timer: 0,
};

function readSort(){ try { const v = localStorage.getItem('nametag.sort.v1'); return ['org', 'kind', 'bar', 'name'].includes(v) ? v : 'org'; } catch { return 'org'; } }
const rerender = () => window.renderEvDb?.();
const evRow = () => EVENT_LIST.find(e => e.key === nt.ev) || {};
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const byKey = (rows, k = 'person_key') => new Map((rows || []).map(r => [r[k], r]));

function ensureLoaded(evKey){
  if(nt.ev !== evKey){
    Object.assign(nt, { ev: evKey, loaded: '', err: '', template: normalizeTemplate(null), prints: [], focus: '', walkIn: null,
      reason: '', imp: null, onsite: null, since: '', barFil: '', syncedAt: '', netView: false });
    nt.picked.clear(); nt.edits.clear(); nt.people.clear(); nt.checkins.clear(); nt.alias.clear(); nt.defBar.clear();
  }
  if(nt.loaded === evKey || nt.loading) return;
  nt.loading = true;
  loadNametag(evKey).then(j => {
    if(nt.ev !== evKey) return;
    takeFull(j);
    nt.loaded = evKey;
  }).catch(e => {
    nt.err = e.message; nt.loaded = evKey;
    /* 연결 문제면 10초마다 다시 묻는다 — 연결되면 저절로 열린다 */
    if(!e.status){ markNet(false, e.message); setTimeout(() => { if(nt.ev === evKey && nt.err) ntReload(); }, 10000); }
  }).finally(() => { nt.loading = false; rerender(); });
}
/* 서버에서 통째로 받은 것 + 아직 안 보낸 기기 기록 */
function takeFull(j){
  nt.template = normalizeTemplate(j.template);
  nt.prints = j.prints || [];
  nt.people = byKey(j.people);
  nt.checkins = byKey(j.checkins);
  nt.since = j.now || new Date().toISOString();
  /* 기기에 둔 마지막 답이면(끊김) 받은 시각은 그 답의 시각 */
  nt.syncedAt = j._cached ? j.now || '' : new Date().toISOString();
  applyPending();
  foldAliases();
  markNet(!j._cached, j._cached ? '인터넷에 연결되지 않았어요 — 기기에 둔 명단으로 열었어요' : '');
}
/* 옛 키로 남은 기록을 지금 키로 — 연사·부스 담당자가 마스터DB 연락처에 이어지면 키가 s<연사 id>·x<담당자 id>에서
   c<연락처 id>로 바뀐다. 그 전에 정한 하단바·체크인·발급이 «미정·안 받음»으로 보였다(2026-11-11 KHIDI-AI 연사 18명).
   서버 기록은 그대로 두고 화면에서 이어 붙인다. 지금 키에 이미 기록이 있으면 그것이 먼저(더 새것) */
function foldAliases(){
  if(!nt.ev) return;
  const roster = ntPeople(nt.ev);
  nt.alias = new Map(roster.filter(p => p.alt).map(p => [p.alt, p.key]));
  /* 하단바 기본값 — 판의 하단바 종류마다 고른 참가 역할(설정 › 행사 상세 › 네임택). 위에 있는 종류가 먼저 */
  const types = (nt.template.bar_types || []).filter(b => b.roles?.length);
  nt.defBar = new Map(types.length ? roster.map(p => [p.key, types.find(b => b.roles.some(r => p.roles?.includes(r)))?.id || '']).filter(x => x[1]) : []);
  nt.alias.forEach((key, alt) => {
    const pe = nt.people.get(alt);
    if(pe){ if(!nt.people.has(key)) nt.people.set(key, { ...pe, person_key: key, _alt: alt }); nt.people.delete(alt); }
    const ck = nt.checkins.get(alt);
    if(ck){ if(!nt.checkins.has(key)) nt.checkins.set(key, { ...ck, person_key: key }); nt.checkins.delete(alt); }
  });
}
/* 조용히 다시 받기 — 서버가 기기 기록 하나를 받지 않았을 때 등. 화면을 «불러오는 중»으로 바꾸지 않는다 */
async function resync(){
  const ev = nt.ev;
  if(!ev || nt.loaded !== ev || nt.err) return;
  try {
    const j = await loadNametag(ev);
    if(nt.ev !== ev) return;
    takeFull(j);
    refreshLists();
  } catch(e){ markNet(false, e.message); }
}

/* ── 이 기기에 남긴 기록을 상태에 얹기 — 서버에서 새로 받은 뒤마다 «아직 안 보낸 것»을 다시 얹는다 ── */
function applyPending(){ waiting(nt.ev).forEach(applyOp); }
function applyOp(op){
  const d = op.data;
  if(op.kind === 'issue'){
    const have = new Set(nt.prints.map(p => p.id));
    const add = d.rows.filter(r => !have.has(r.id));
    if(add.length) nt.prints = [...add, ...nt.prints].sort((a, b) => String(b.printed_at).localeCompare(String(a.printed_at)));
    d.rows.forEach(r => {
      if(r.kind === 'walk_in' && !nt.people.has(r.person_key))
        nt.people.set(r.person_key, { person_key: r.person_key, bar: r._bar_id || null, email: r._email || '', phone: r._phone || '' });
      if(r._checkin_id && !nt.checkins.has(r.person_key))
        nt.checkins.set(r.person_key, { id: r._checkin_id, person_key: r.person_key, via: 'print', print_id: r.id, checked_at: r.printed_at, checked_by: r.printed_by, _wait: true });
    });
  } else if(op.kind === 'checkin'){
    if(!nt.checkins.has(d.row.person_key)) nt.checkins.set(d.row.person_key, d.row);
  } else if(op.kind === 'uncheck'){
    if(nt.checkins.get(d.key)?.id === d.id) nt.checkins.delete(d.key);
  } else if(op.kind === 'void'){
    const p = nt.prints.find(x => x.id === d.id);
    if(p && !p.voided_at) Object.assign(p, { voided_at: op.at, voided_by: d.by, _wait: true });
  } else if(op.kind === 'bars'){
    d.items.forEach(i => nt.people.set(i.person_key, { ...(nt.people.get(i.person_key) || { person_key: i.person_key }), bar: i.bar || null }));
  } else if(op.kind === 'contact'){
    nt.people.set(d.key, { ...(nt.people.get(d.key) || { person_key: d.key }), email: d.email, phone: d.phone });
  }
}
/* 서버가 받았다 — 기기에서 만든 줄을 서버 줄로 바꾼다 */
function reconcile(op, res){
  const d = op.data;
  if(op.kind === 'issue'){
    const m = new Map((res.prints || []).map(p => [p.id, p]));
    nt.prints = nt.prints.map(p => m.get(p.id) || p);
    (res.people || []).forEach(p => nt.people.set(p.person_key, p));
    const got = new Set((res.checkins || []).map(c => c.id));
    (res.checkins || []).forEach(c => { const cur = nt.checkins.get(c.person_key); if(!cur || cur._wait) nt.checkins.set(c.person_key, c); });
    /* 기기에서 체크인으로 쳤는데 서버엔 이미 다른 체크인이 있었다 → 그 줄을 받아 온다 */
    if(d.rows.some(r => r._checkin_id && !got.has(r._checkin_id) && nt.checkins.get(r.person_key)?.id === r._checkin_id)) resync();
  } else if(op.kind === 'checkin'){
    const c = res.checkin, cur = nt.checkins.get(d.row.person_key);
    if(c && (!cur || cur.id === d.row.id || cur._wait)){
      if(c.voided_at) nt.checkins.delete(d.row.person_key); else nt.checkins.set(c.person_key, c);
    }
  } else if(op.kind === 'void'){
    if(res.print) nt.prints = nt.prints.map(p => p.id === res.print.id ? res.print : p);
  } else if(op.kind === 'bars'){
    (res.people || []).forEach(p => nt.people.set(p.person_key, p));
  } else if(op.kind === 'contact'){
    if(res.person) nt.people.set(res.person.person_key, res.person);
  }
}
onOutbox((type, op, res) => {
  const here = op && op.ev === nt.ev && nt.loaded === nt.ev && !nt.err;
  if(type === 'sent' && here){ reconcile(op, res); refreshLists(); }
  if(type === 'fail' && here) resync();   // 기기에서 미리 바꾼 것을 서버 값으로 되돌린다(«이 기기 기록»에 못 보냄으로 남는다)
  refreshNet();
});

/* ── 현장 실시간 — 다른 데스크의 체크인·발급·하단바를 15초마다 받아 숫자와 명단만 갈아 끼운다
   (통째로 다시 그리면 검색칸·입력칸이 포커스를 잃는다) */
function startPolling(){
  if(nt.timer) return;
  preloadQrReader();   // 카메라 QR 읽기 도구를 연결돼 있을 때 미리 받아 둔다
  nt.timer = setInterval(pollLive, POLL_MS);
}
/* 창을 내려 두면(document.hidden) 묻지 않는다 — 다시 보이면 15초를 기다리지 않고 바로 묻는다 */
document.addEventListener('visibilitychange', () => { if(!document.hidden && nt.timer) pollLive(); });
async function pollLive(){
  {
    if(!document.getElementById('nt-desk')){ clearInterval(nt.timer); nt.timer = 0; return; }
    if(document.hidden || !nt.loaded || nt.err || nt.busy) return;
    const ev = nt.ev;
    try {
      const j = await loadNametagLive(ev, nt.since);
      if(nt.ev !== ev) return;
      mergeLive(j);
      nt.syncedAt = new Date().toISOString();
      markNet(true);
      refreshLists();
    } catch(e){ console.warn('네임택 실시간', e.message); if(!e.status) markNet(false, e.message); refreshNet(); }
  }
}
function mergeLive(j){
  if(j.delta){
    /* 바뀐 것만 온다 — 취소된 줄은 지우고, 키가 바뀐 줄(현장 신규 → 마스터DB)은 옛 키에서 뗀다 */
    const keyOf = new Map([...nt.checkins.values()].map(c => [c.id, c.person_key]));
    const rows = [...(j.checkins || [])].sort((a, b) => (a.voided_at ? 0 : 1) - (b.voided_at ? 0 : 1));
    rows.forEach(c => {
      const old = keyOf.get(c.id);
      if(old && nt.checkins.get(old)?.id === c.id && (c.voided_at || old !== c.person_key)) nt.checkins.delete(old);
      if(c.voided_at){ if(nt.checkins.get(c.person_key)?.id === c.id) nt.checkins.delete(c.person_key); return; }
      nt.checkins.set(c.person_key, c);
    });
  } else nt.checkins = byKey(j.checkins);
  if(j.prints?.length){
    const m = new Map(nt.prints.map(p => [p.id, p]));
    j.prints.forEach(p => m.set(p.id, p));
    nt.prints = [...m.values()].sort((a, b) => String(b.printed_at).localeCompare(String(a.printed_at)));
  }
  (j.people || []).forEach(p => nt.people.set(p.person_key, p));
  if(j.now) nt.since = j.now;
  applyPending();
  foldAliases();
}
function refreshLists(){
  const st = document.getElementById('nt-stats');
  if(st) st.outerHTML = statsHtml();
  const rows = document.getElementById('evdb-rows');
  if(rows) rows.innerHTML = ntRowsHtml(nt.ev, document.getElementById('evdb-q')?.value || '');
  const rc = document.getElementById('nt-recent');
  if(rc) rc.outerHTML = recentHtml();
  const side = document.getElementById('nt-side');
  if(side && nt.view === 'checkin' && !nt.netView) side.innerHTML = checkinSideHtml();
  refreshNet();
}
function refreshNet(){
  const el = document.getElementById('nt-net');
  if(el) el.outerHTML = netHtml();
  const nv = document.getElementById('nt-netlog');
  if(nv) nv.outerHTML = netLogHtml();
}

/* ── 연결 표시 — 위 막대. 누르면 오른쪽에 이 기기 기록 ── */
function netHtml(){
  const s = netState(), w = waiting(nt.ev).length, f = failed(nt.ev).length;
  const [cls, txt] = f ? ['bad', `⚠ 서버가 받지 않은 기록 ${f}건`]
    : s.ok === false ? ['off', `● 연결 끊김 · 이 기기에 ${w}건 — 연결되면 자동으로 보내요`]
    : w ? ['wait', `● 보내는 중 ${w}건`]
    : ['ok', `● 연결됨${nt.syncedAt ? ` · ${kst(nt.syncedAt)} 받음` : ''}`];
  return `<button type="button" id="nt-net" class="nt-net ${cls}" onclick="ntNetView()" title="이 기기에 남긴 발급·체크인 기록과 보내기 상태">${txt}</button>`;
}
const OP_LABEL = { issue: '발급', checkin: '체크인', uncheck: '체크인 취소', void: '인쇄 안 됨', bars: '하단바', contact: '현장 신규 연락처' };
function opText(op, names){
  const d = op.data, nm = (k) => names.get(k) || k;
  if(op.kind === 'issue') return `${d.rows.length}장 — ${d.rows.slice(0, 3).map(r => r.name).join(', ')}${d.rows.length > 3 ? ' 외' : ''}${d.onsite ? ' · 현장 출력' : ''}`;
  if(op.kind === 'checkin') return nm(d.row.person_key);
  if(op.kind === 'uncheck') return nm(d.key);
  if(op.kind === 'void') return d.name || d.id;
  if(op.kind === 'bars') return `${d.items.length}명${d.via === 'excel' ? ' (엑셀)' : ''}`;
  if(op.kind === 'contact') return `${nm(d.key)} · ${d.email || ''} ${d.phone || ''}`;
  return '';
}
function netLogHtml(){
  const s = netState(), all = deviceLog(nt.ev).slice().reverse();
  const w = all.filter(o => o.state === 'wait').length, f = all.filter(o => o.state === 'fail').length;
  const names = new Map(deskPeople(nt.ev).map(p => [p.key, p.nameKo || p.nameEn]));
  const ST = { wait: ['기다림', 'p-amber'], sent: ['보냄', 'p-green'], fail: ['못 보냄', 'p-red'] };
  return `<div id="nt-netlog"><h4>이 기기 기록 <span class="nt-note">${escapeHtml(evRow().short || evRow().name || nt.ev)}</span></h4>
    <div class="nt-note">누르는 그 순간 이 기기(${/Mobi|Android|iPad|iPhone/.test(navigator.userAgent) ? '휴대폰·태블릿' : '이 PC'})에 먼저 남기고 서버로 보내요.
      인터넷이 끊겨도 발급·체크인은 그대로 하면 되고, 연결되면 남은 것을 차례로 보내요. 이 화면을 닫거나 새로 고쳐도 기록은 남아요.
      ${s.ok === false ? `<br><b>지금 연결이 끊겼어요</b>${s.err ? ` — ${escapeHtml(s.err)}` : ''}. 다른 데스크의 숫자는 ${nt.syncedAt ? kst(nt.syncedAt) : '—'} 것이에요.` : ''}</div>
    <div class="nt-actions">
      ${w ? `<button class="btn bp" onclick="ntSendNow()">지금 보내기 (${w}건)</button>` : ''}
      ${f ? `<button class="btn bs" onclick="ntRetryFailed()">못 보낸 ${f}건 다시</button><button class="btn bs" onclick="ntDismissFailed()" title="확인했으면 — 기록은 남아요">확인함</button>` : ''}
      <button class="btn bs" onclick="ntExportDeviceLog()">⬇ 기기 기록 엑셀</button>
      <button class="btn bs" onclick="ntNetView(false)">닫기</button></div>
    ${all.length ? `<ul class="nt-recent">${all.slice(0, 200).map(o => `<li>
      <span class="who"><b>${OP_LABEL[o.kind] || o.kind}</b> ${escapeHtml(opText(o, names))}
        <span class="pill ${ST[o.state][1]}">${ST[o.state][0]}</span>${o.err && o.state !== 'sent' ? `<div class="nt-note">${escapeHtml(o.err)}${o.tries ? ` · ${o.tries}번 시도` : ''}</div>` : ''}</span>
      <span class="when">${kst(o.at)}${o.sent_at ? ` → ${kst(o.sent_at)}` : ''}</span></li>`).join('')}</ul>` : '<div class="nt-note">아직 이 기기에서 한 기록이 없어요.</div>'}</div>`;
}

/* ── 모으기 ── */
const deskPeople = (evKey) => [...ntPeople(evKey), ...walkInPeople(nt.prints, nt.people)];

/* 받은 기록 — 무효 아닌 것만 센다 */
function printedMap(){
  const m = new Map();
  nt.prints.forEach(p => {
    if(p.voided_at || !p.person_key) return;
    const k = nt.alias?.get(p.person_key) || p.person_key;   // 옛 키로 뽑은 것도(foldAliases)
    const v = m.get(k) || { n: 0, last: '' };
    v.n++; if(p.printed_at > v.last) v.last = p.printed_at;
    m.set(k, v);
  });
  return m;
}

const barTypes = () => nt.template.bar_types || [];
/* 사람마다 정한 띠 → 없으면 참가 역할로 정해지는 띠(nt.defBar) */
const barOf = (key) => nt.people.get(key)?.bar || nt.defBar.get(key) || '';
const barIsDefault = (key) => !nt.people.get(key)?.bar && !!nt.defBar.get(key);
const barType = (id) => barTypes().find(b => b.id === id);
const barChip = (id, big) => {
  if(!id) return big ? '<span class="nt-bar nt-bar-none">하단바 미정</span>' : '';
  const b = barType(id);
  return b ? `<span class="nt-bar${big ? ' big' : ''}"><i style="background:${b.color}"></i>${escapeHtml(b.label)}</span>`
    : `<span class="nt-bar nt-bar-none" title="설정에서 지운 종류예요">지운 종류</span>`;
};
const barSelect = (cur, on, extra = '', byRole = false) => `<select class="fi nt-bar-sel" ${extra} onchange="${on}"${byRole ? ' title="참가 역할로 정해진 띠예요 — 바꾸면 이 사람만 따로 정해져요"' : ''}>
  <option value="">${byRole ? '— 역할대로' : cur ? '— 빼기' : '— 미정'}</option>
  ${barTypes().map(b => `<option value="${escAttr(b.id)}"${b.id === cur ? ' selected' : ''}>${escapeHtml(b.label)}</option>`).join('')}
  ${cur && !barType(cur) ? '<option selected value="">지운 종류</option>' : ''}</select>`;

/* 현장 출력 — 고르지 않았으면 행사 기간(한국 시각)으로 정한다 */
function isOnsite(){
  if(nt.onsite != null) return nt.onsite;
  const ev = evRow(), s = ev.date_start || ev.date || '', e = ev.date_end || s, d = today();
  return !!s && s <= d && d <= e;
}

const kst = (iso) => {
  if(!iso) return '';
  const d = new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString();
  return d.slice(0, 10) === today() ? d.slice(11, 16) : `${d.slice(5, 10).replace('-', '/')} ${d.slice(11, 16)}`;
};

/* 이 사람에게 찍을 값 — 데스크에서 고친 값이 있으면 그것 */
function cardFor(p){
  const e = nt.edits.get(p.key) || {};
  /* 하단바가 말을 정했으면 그대로 — 국문만이면 국문으로 찍고 병기를 끄고, 병기면 병기 칸을 켠다.
     데스크에서 «말»을 바꿨으면 그쪽이 먼저(병기 켬·끔은 띠를 따른다) */
  const text = barType(barOf(p.key))?.text || '';
  const base = cardOf(p, e.lang || (text === 'ko' ? 'ko' : nt.template.lang));
  return { ...base, person_key: p.key, _bar: barOf(p.key), _alt: text === 'ko' ? false : text === 'both' ? true : undefined,
    ...Object.fromEntries(Object.entries(e).filter(([k, v]) => k !== 'lang' && v != null)) };
}

/* 정렬 — 구분은 연사 · 부스 · 참가자 · 현장 신규 차례, 그 안에서 참가 구분(역할) → 이름 */
const SORTS = [['org', '소속 → 이름'], ['kind', '구분 → 이름'], ['bar', '하단바 → 이름'], ['name', '이름']];
const SRC_ORDER = Object.keys(SOURCE_LABEL);
const ko = (a, b) => String(a || '').localeCompare(String(b || ''), 'ko');
const nameOf = (p) => p.nameKo || p.nameEn, orgOf = (p) => p.orgKo || p.orgEn;
function sortPeople(l){
  const byName = (a, b) => ko(nameOf(a), nameOf(b)) || ko(orgOf(a), orgOf(b));
  /* 하단바 — 판에 적은 종류 차례(설정 › 행사 상세 › 네임택), 미정·지운 종류는 맨 뒤 */
  const barRank = (p) => { const i = barTypes().findIndex(b => b.id === barOf(p.key)); return i < 0 ? 999 : i; };
  const cmp = nt.sort === 'name' ? byName
    : nt.sort === 'bar' ? (a, b) => (barRank(a) - barRank(b)) || byName(a, b)
    : nt.sort === 'kind' ? (a, b) => (SRC_ORDER.indexOf(a.source) - SRC_ORDER.indexOf(b.source))
        || (!a.badgeKo - !b.badgeKo) || ko(a.badgeKo, b.badgeKo) || byName(a, b)
    : (a, b) => ko(orgOf(a), orgOf(b)) || byName(a, b);
  return [...l].sort(cmp);
}

function visible(evKey, query){
  const done = nt.view === 'checkin' ? nt.checkins : printedMap();
  const q = String(query || '').trim().toLowerCase();
  return sortPeople(deskPeople(evKey)).filter(p =>
    (!nt.src || p.source === nt.src)
    && (nt.filter === 'all' || (nt.filter === 'done') === done.has(p.key))
    && (!nt.barFil || (nt.barFil === '_none' ? !barOf(p.key) : barOf(p.key) === nt.barFil))
    && (!q || [p.nameKo, p.nameEn, p.orgKo, p.orgEn, p.titleKo, p.badgeKo, p.email, p.key].some(v => String(v || '').toLowerCase().includes(q))));
}

/* ── 요약 숫자 — 발급·체크인 두 보기가 같이 쓴다. 실시간으로 이것만 갈아 끼운다 ── */
function statsHtml(){
  const all = deskPeople(nt.ev);
  const done = printedMap();
  const got = all.filter(p => done.has(p.key)).length;
  const wi = all.filter(p => p.walkIn).length;
  const inn = all.filter(p => nt.checkins.has(p.key));
  const viaPrint = inn.filter(p => nt.checkins.get(p.key).via === 'print').length;
  const live = nt.prints.filter(p => !p.voided_at);
  const types = barTypes();
  const barLine = types.length ? types.map(b => {
    const ppl = all.filter(p => barOf(p.key) === b.id);
    return `<span class="nt-bar"><i style="background:${b.color}"></i>${escapeHtml(b.label)} <b>${ppl.filter(p => nt.checkins.has(p.key)).length}</b>/${ppl.length}</span>`;
  }).join(' ') + (all.some(p => !barOf(p.key)) ? ` <span class="nt-bar nt-bar-none">미정 ${all.filter(p => !barOf(p.key)).length}</span>` : '')
    : '<span class="nt-note">하단바 종류가 없어요 — «판 고치기»에서 만들어요</span>';
  return `<div class="sec stat-grid" id="nt-stats">
      <div class="stat-card"><div class="n">${all.length}</div><div class="l">등록자</div><div class="s">명단 ${all.length - wi} · 현장 신규 ${wi}</div></div>
      <div class="stat-card"><div class="n">${inn.length}<span class="nt-of"> / ${all.length}</span></div><div class="l">체크인</div><div class="s">현장 출력 ${viaPrint} · 체크인 데스크 ${inn.length - viaPrint} · ${netState().ok === false ? `<b style="color:var(--re)">연결 끊김 — 다른 데스크 것은 ${kst(nt.syncedAt)}까지</b>` : `${kst(nt.syncedAt)} 기준`}</div></div>
      <div class="stat-card"><div class="n">${got}</div><div class="l">네임택 받음</div><div class="s">${all.length - got}명 남음 · 뽑은 장 ${live.length}</div></div>
      <div class="stat-card"><div class="l">하단바별 체크인</div><div class="s nt-bars">${barLine}</div></div>
    </div>`;
}

/* ── 본문 ── */
export function ntPartHtml(ev, query){
  ensureLoaded(ev.key);
  if(!nt.loaded) return `<div class="sec nt-note">네임택 기록을 불러오는 중…</div>`;
  if(nt.err) return `<div class="sec"><div class="nt-warn">네임택 기록을 못 불러왔어요 — ${escapeHtml(nt.err)}
    <button class="btn bs" onclick="ntReload()">다시</button></div></div>`;
  startPolling();
  foldAliases();   // 그사이 연락처에 이어진 사람이 있으면
  const t = nt.template;
  const seg = (cur, list, fn) => `<div class="seg">${list.map(([k, l]) =>
    `<button class="seg-b${cur === k ? ' on' : ''}" onclick="${fn}('${k}')">${l}</button>`).join('')}</div>`;
  const ci = nt.view === 'checkin';
  const wiTodo = walkInPeople(nt.prints, nt.people).filter(p => p.nameKo || p.nameEn).length;   // 이름 없는 현장 신규는 올리지 않는다
  setTimeout(fitPreview, 0);
  return `<div id="nt-desk">
    <div class="sec sec-bar">
      ${seg(nt.view, [['issue', '🖨 발급'], ['checkin', '✓ 체크인']], 'ntSetView')}
      ${ci ? `<button class="btn bp" onclick="ntCamera()" title="노트북 웹캠·휴대폰 카메라로 네임택 QR을 읽어요. 켜 두면 비추는 대로 바로 체크인돼요">📷 카메라 체크인</button>` : ''}
      ${ci ? '' : `${seg(isOnsite() ? 'on' : 'pre', [['pre', '사전 출력'], ['on', '현장 출력']], 'ntSetOnsite')}
        <span class="nt-note m-hide">${isOnsite() ? '뽑으면 바로 체크인으로 남아요' : '뽑아도 체크인은 따로 해요'}</span>`}
      <div style="flex:1"></div>
      ${netHtml()}
      <button class="btn bs m-more" onclick="this.parentElement.classList.toggle('m-open')">⋯ 더보기</button>
      <button class="btn bs m-hide" onclick="ntExport()" title="현장 신규까지 한 줄씩 — 하단바·체크인 포함. 하단바 엑셀 올리기 양식도 이것">⬇ 명단 엑셀</button>
      ${ci ? '' : `<label class="btn bs m-hide" title="«명단 엑셀»에 하단바를 채워 올려요. 등록번호로 맞추고, 없으면 이메일·이름+소속으로">⬆ 하단바 엑셀
        <input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="ntImportBars(this.files[0]);this.value=''"></label>`}
      ${wiTodo ? `<button class="btn bs m-hide" onclick="ntPromote()" title="현장 신규를 연락처·이 행사 참가 확정으로 — 같은 이메일이면 그 사람에 붙여요">현장 신규 ${wiTodo}명 마스터DB에</button>` : ''}
    </div>
    ${statsHtml()}
    <div class="sec sec-bar">
      <div class="srch" style="width:100%;max-width:300px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="text" id="evdb-q" placeholder="이름·소속·이메일 검색…" value="${escAttr(query || '')}" style="width:100%" oninput="setEvDbQuery(this.value)" onkeydown="ntScanKey(event)"${ci ? ' autofocus' : ''}></div>
      ${seg(nt.filter, ci ? [['todo', '안 옴'], ['done', '옴'], ['all', '전체']] : [['todo', '안 받음'], ['done', '받음'], ['all', '전체']], 'ntSetFilter')}
      ${seg(nt.src, [['', '모두'], ['speaker', '연사'], ['exh', '부스'], ['part', '참가자'], ['walk_in', '현장 신규']], 'ntSetSrc')}
      ${barTypes().length ? `<select class="fi" style="width:auto" onchange="ntSetBarFil(this.value)" title="하단바로 걸러 보기">
        <option value="">하단바 전체</option><option value="_none"${nt.barFil === '_none' ? ' selected' : ''}>하단바 미정</option>
        ${barTypes().map(b => `<option value="${escAttr(b.id)}"${nt.barFil === b.id ? ' selected' : ''}>${escapeHtml(b.label)}</option>`).join('')}</select>` : ''}
      <select class="fi" style="width:auto" onchange="ntSetSort(this.value)" title="명단 차례 — 이 기기에 기억해요">
        ${SORTS.map(([k, l]) => `<option value="${k}"${nt.sort === k ? ' selected' : ''}>정렬: ${l}</option>`).join('')}</select>
      <div style="flex:1"></div>
      ${ci ? '' : `<button class="btn bs m-more" onclick="this.parentElement.classList.toggle('m-open')">⋯ 더보기</button><span class="nt-note m-hide" title="용지·글자 자리·기본 말·하단바 종류는 설정 › 행사 상세 › 네임택에서 정해요">판 ${t.width_mm} × ${t.height_mm}mm · ${escapeHtml((LANG_OPTIONS.find(o => o[0] === t.lang) || LANG_OPTIONS[0])[1].replace(/ \(.*\)/, ''))}${t.sheet === 'fit' ? '' : ' · A4 맨 위 가운데'}${t.id ? '' : ' (기본값)'}</span>
      <button class="btn bs m-hide" onclick="ntOpenEditor()" title="설정 › 행사 상세 › 네임택 — 용지 크기·글자 자리·배경·하단바 종류">판 고치기</button>
      <button class="btn bs" onclick="ntWalkIn(true)" title="명단에 없는 사람 — 현장 출력으로 뽑으면 체크인으로도 남고, 나중에 마스터DB에 올려요">＋ 현장 신규</button>
      <button class="btn bs m-hide" onclick="ntPrintBlank()" title="이름 없이 배경만 — A4 한 장에 4매. 손으로 쓸 여분 네임택. 기록은 남기지 않아요">빈 네임택 4매</button>`}
    </div>
    <div class="sec-rows nt-layout">
      <div id="evdb-rows">${ntRowsHtml(ev.key, query)}</div>
      ${mobileBarHtml(ev.key)}
      <div id="nt-side" class="nt-side">${nt.netView ? netLogHtml() : ci ? checkinSideHtml() : sideHtml(ev.key)}</div>
    </div></div>`;
}

export function ntRowsHtml(evKey, query){
  const l = visible(evKey, query);
  const ci = nt.view === 'checkin';
  if(!l.length) return `<div class="nt-note" style="padding:24px 0">${nt.filter === 'todo' ? (ci ? '아직 안 온 사람이 없어요.' : '아직 안 받은 사람이 없어요.') : '해당하는 사람이 없어요.'}</div>`;
  const done = printedMap();
  const shown = l.slice(0, 600);
  const more = l.length > shown.length ? `<div class="nt-note" style="padding:8px 0">${l.length - shown.length}명 더 있어요 — 검색으로 좁혀 주세요.</div>` : '';
  const srcPill = (p) => `<span class="pill ${p.source === 'speaker' ? 'p-green' : p.source === 'walk_in' ? 'p-amber' : 'p-gray'}">${SOURCE_LABEL[p.source]}</span>${p.badgeKo && p.source === 'part' ? ` <span style="font-size:var(--fs-11);color:var(--i3)">${escapeHtml(p.badgeKo)}</span>` : ''}`;
  const who = (p) => `<td><span style="font-weight:600">${p.nameKo || p.nameEn ? escapeHtml(p.nameKo || p.nameEn) : '<span style="color:var(--i4);font-weight:400">(이름 없음)</span>'}</span>${p.nameKo && p.nameEn && p.nameKo !== p.nameEn ? `<div style="font-size:var(--fs-10_5);color:var(--i4)">${escapeHtml(p.nameEn)}</div>` : ''}</td>
      <td>${escapeHtml(p.orgKo || p.orgEn)}</td>`;
  const got = (p) => { const d = done.get(p.key); return d ? `<span style="color:var(--g);font-weight:700">✓</span> ${kst(d.last)}${d.n > 1 ? ` · ${d.n}장` : ''}` : '<span style="color:var(--i5)">—</span>'; };
  const ckCell = (p) => { const c = nt.checkins.get(p.key);
    return c ? `<span style="color:var(--g);font-weight:700">✓</span> ${kst(c.checked_at)} <span class="nt-note">${c.via === 'print' ? '현장 출력' : '데스크'}${c._wait ? ' · ⏳ 기기에만' : ''}</span>` : '<span style="color:var(--i5)">—</span>'; };
  if(isMobile()) return mobileRowsHtml(shown, ci, done, srcPill, got, ckCell) + more;
  const barCell = (p) => barTypes().length
    ? `<td onclick="event.stopPropagation()">${barSelect(barOf(p.key), `ntSetBar('${escAttr(p.key)}',this.value)`, `style="--c:${barType(barOf(p.key))?.color || 'transparent'}"`, barIsDefault(p.key))}</td>`
    : `<td>${barChip(barOf(p.key))}</td>`;

  if(ci) return `<div style="overflow-x:auto"><table class="nt-rows" style="width:100%">
    <thead><tr><th>성명</th><th>소속</th><th>구분</th><th>하단바</th><th>네임택</th><th>체크인</th></tr></thead><tbody>
    ${shown.map(p => { const c = nt.checkins.get(p.key);
      return `<tr class="${c ? 'in' : ''}">${who(p)}<td>${srcPill(p)}</td><td>${barChip(barOf(p.key))}</td>
      <td style="font-size:var(--fs-11);white-space:nowrap">${got(p)}</td>
      <td style="white-space:nowrap">${c ? `${ckCell(p)} <button class="btn bs" onclick="ntUncheck('${escAttr(p.key)}')" title="잘못 눌렀으면 — 기록은 남아요">취소</button>`
        : `<button class="btn bp" onclick="ntCheckIn('${escAttr(p.key)}')"${nt.busy ? ' disabled' : ''}>체크인</button>`}</td></tr>`; }).join('')}
    </tbody></table></div>${more}`;

  const allOn = shown.every(p => nt.picked.has(p.key));
  return `<div style="overflow-x:auto"><table class="nt-rows" style="width:100%">
    <thead><tr><th class="ck"><input type="checkbox"${allOn ? ' checked' : ''} onchange="ntPickAll(this.checked)" title="보이는 사람 모두 고르기"></th>
      <th>성명</th><th>소속</th><th>직함</th><th>구분</th><th>하단바</th><th>받음</th><th>체크인</th></tr></thead><tbody>
    ${shown.map(p => `<tr class="${nt.focus === p.key ? 'on' : ''}" style="cursor:pointer" onclick="ntFocus('${escAttr(p.key)}')">
      <td class="ck" onclick="event.stopPropagation()"><input type="checkbox"${nt.picked.has(p.key) ? ' checked' : ''} onchange="ntPick('${escAttr(p.key)}',this.checked)"></td>
      ${who(p)}
      <td style="font-size:var(--fs-11_5);color:var(--i3)">${escapeHtml(p.titleKo || p.titleEn)}</td>
      <td>${srcPill(p)}</td>${barCell(p)}
      <td style="font-size:var(--fs-11);white-space:nowrap">${got(p)}</td>
      <td style="font-size:var(--fs-11);white-space:nowrap">${ckCell(p)}</td></tr>`).join('')}
    </tbody></table></div>${more}`;
}

/* ── 휴대폰 — 명단은 표 대신 카드(표가 838px라 옆으로 밀어야 했다), 발급은 아래에 «미리보기 · 인쇄» 막대 ── */
function mobileRowsHtml(shown, ci, done, srcPill, got, ckCell){
  return shown.map(p => {
    const c = nt.checkins.get(p.key), name = p.nameKo || p.nameEn;
    const act = ci
      ? (c ? `<button class="btn bs" onclick="event.stopPropagation();ntUncheck('${escAttr(p.key)}')">취소</button>`
           : `<button class="btn bp" onclick="event.stopPropagation();ntCheckIn('${escAttr(p.key)}')"${nt.busy ? ' disabled' : ''}>체크인</button>`)
      : `<input type="checkbox"${nt.picked.has(p.key) ? ' checked' : ''} onclick="event.stopPropagation()" onchange="ntPick('${escAttr(p.key)}',this.checked)" style="width:20px;height:20px">`;
    return `<div class="nt-mrow${(ci ? c : nt.focus === p.key) ? ' on' : ''}"${ci ? '' : ` onclick="ntFocus('${escAttr(p.key)}')"`}>
      <div class="nt-mrow-main">
        <div><b>${name ? escapeHtml(name) : '<span style="color:var(--i4);font-weight:400">(이름 없음)</span>'}</b> ${srcPill(p)} ${barChip(barOf(p.key))}</div>
        <div class="nt-note">${escapeHtml(p.orgKo || p.orgEn)}${p.titleKo || p.titleEn ? ' · ' + escapeHtml(p.titleKo || p.titleEn) : ''}</div>
        <div class="nt-note">${ci ? ckCell(p) : `받음 ${got(p)}${c ? ` · 체크인 ${kst(c.checked_at)}` : ''}`}</div>
      </div>${act}</div>`;
  }).join('');
}
function mobileBarHtml(evKey){
  if(!isMobile() || nt.view === 'checkin' || nt.netView) return '';
  const n = nt.picked.size || (nt.focus ? 1 : 0);
  if(!n && !nt.walkIn) return '';
  return `<div class="nt-mbar"><span>${nt.walkIn ? '현장 신규' : `${n}명`}</span><div style="flex:1"></div>
    <button class="btn bs" onclick="document.getElementById('nt-side')?.scrollIntoView({behavior:'smooth'})">미리보기 ↓</button>
    <button class="btn bp" onclick="ntPrint()"${nt.busy ? ' disabled' : ''}>🖨 인쇄</button></div>`;
}

/* ── 오른쪽: 미리보기 · 고쳐 찍기 · 인쇄 · 최근 발급 ── */
function targets(evKey){
  const m = new Map(deskPeople(evKey).map(p => [p.key, p]));
  const keys = nt.picked.size ? [...nt.picked] : nt.focus ? [nt.focus] : [];
  return keys.map(k => m.get(k)).filter(Boolean);
}

function previewHtml(card){
  const t = nt.template;
  const z = Math.min(1, 330 / (t.width_mm * MM_PX), 380 / (t.height_mm * MM_PX));
  return `<div class="nt-stage-wrap"><div style="width:${t.width_mm * MM_PX * z + 2}px;height:${t.height_mm * MM_PX * z + 2}px">
    <div class="nt-stage" style="transform:scale(${z})"><div class="nt-frame">${ntCardHtml(t, card)}</div></div></div></div>`;
}

function sideHtml(evKey){
  if(nt.imp) return importHtml();
  if(nt.walkIn) return walkInHtml();
  const list = targets(evKey);
  const focus = list.find(p => p.key === nt.focus) || list[0];
  if(!focus) return `<h4>미리보기</h4><div class="nt-note">왼쪽에서 사람을 누르면 네임택이 여기 보여요. 여러 명은 체크해서 한 번에 뽑아요.</div>${recentHtml()}`;

  const card = cardFor(focus);
  const done = printedMap();
  const again = list.filter(p => done.has(p.key));
  const f = (k, label, wide) => `<label class="${wide ? 'wide' : ''}"><div class="mlbl">${label}</div>
    <input class="fi" value="${escAttr(card[k] || '')}" oninput="ntEdit('${escAttr(focus.key)}','${k}',this.value)"></label>`;
  /* 여러 명이면 하단바별 장 수 — 인쇄해 나온 종이에 어느 띠를 끼울지 */
  const barCnt = list.length > 1 && barTypes().length ? (() => {
    const c = new Map(); list.forEach(p => c.set(barOf(p.key), (c.get(barOf(p.key)) || 0) + 1));
    return `<div class="nt-bars">${[...c.entries()].map(([id, n]) => `${barChip(id, false) || '<span class="nt-bar nt-bar-none">미정</span>'} <b>${n}</b>`).join(' · ')}</div>`;
  })() : '';
  return `<h4>${list.length > 1 ? `고른 ${list.length}명 · ` : ''}${escapeHtml(card.name)} 미리보기</h4>
    ${barTypes().length ? `<div class="nt-bar-row">${barChip(barOf(focus.key), true)}
      ${barSelect(barOf(focus.key), list.length > 1 ? `ntSetBarPicked(this.value)` : `ntSetBar('${escAttr(focus.key)}',this.value)`)}
      ${list.length > 1 ? '<span class="nt-note">고른 사람 모두에</span>' : ''}</div>${barCnt}` : ''}
    <div id="nt-preview">${previewHtml(card)}</div>
    <div class="nt-fields">
      ${f('name', '이름', true)}${f('company', '소속', true)}${f('job_title', '직함')}${f('badge', '구분')}
      <label class="wide"><div class="mlbl">말</div><select class="fi" onchange="ntEdit('${escAttr(focus.key)}','lang',this.value)">
        <option value="ko"${card.lang === 'ko' ? ' selected' : ''}>국문</option><option value="en"${card.lang === 'en' ? ' selected' : ''}>영문</option></select></label>
    </div>
    <div class="nt-note">여기서 고친 값은 이번 네임택과 발급 기록에만 남아요. 마스터DB는 그대로예요.</div>
    <details class="nt-pos"${card._pos ? ' open' : ''}><summary>글자 위치 · 이번만</summary>
      <div id="nt-pos">${posHtml(focus.key, card)}</div></details>
    ${focus.walkIn ? walkInContactHtml(focus) : ''}
    ${again.length ? `<div class="nt-warn">${again.length === 1 ? escapeHtml(cardFor(again[0]).name) + ' 님은' : `${again.length}명은`} 이미 받았어요 — 재발급 사유
      <select class="fi" style="width:auto;margin-left:4px" onchange="ntSetReason(this.value)"><option value="">고르세요</option>
        ${REISSUE_REASONS.map(r => `<option${nt.reason === r ? ' selected' : ''}>${r}</option>`).join('')}</select></div>` : ''}
    <div class="nt-actions">
      <button class="btn bp" onclick="ntPrint()"${nt.busy ? ' disabled' : ''}>🖨 ${list.length > 1 ? `${list.length}장 인쇄` : '인쇄'}</button>
      <span class="nt-note">${isOnsite() ? '현장 출력 — 체크인도 함께' : '사전 출력 — 체크인은 따로'}</span>
      ${nt.picked.size ? `<button class="btn bs" onclick="ntPickAll(false)">고른 것 풀기</button>` : ''}
    </div>${recentHtml()}`;
}

/* 현장 신규의 이메일·전화 — 마스터DB에 올릴 때 같은 사람을 이메일로 찾는다 */
function walkInContactHtml(p){
  return `<div class="nt-fields">
    <label><div class="mlbl">이메일</div><input class="fi" type="email" value="${escAttr(p.email)}" onchange="ntWalkContact('${escAttr(p.key)}','email',this.value)"></label>
    <label><div class="mlbl">전화</div><input class="fi" value="${escAttr(p.phone)}" onchange="ntWalkContact('${escAttr(p.key)}','phone',this.value)"></label></div>
    <div class="nt-note">현장 신규예요. 마스터DB에 올릴 때 이 이메일로 같은 사람을 찾아 붙여요.</div>`;
}

function walkInHtml(){
  const w = nt.walkIn;
  const f = (k, label, wide, type = 'text') => `<label class="${wide ? 'wide' : ''}"><div class="mlbl">${label}</div>
    <input class="fi" type="${type}" value="${escAttr(w[k] || '')}" oninput="ntWalkEdit('${k}',this.value)"></label>`;
  return `<h4>현장 신규</h4>
    <div id="nt-preview">${previewHtml(w)}</div>
    <div class="nt-fields">${f('name', '이름', true)}${f('company', '소속', true)}${f('job_title', '직함')}${f('badge', '구분')}
      ${barTypes().length ? `<label class="wide"><div class="mlbl">하단바 <span class="nt-note">· 비워 두고 나중에 채워도 돼요</span></div>${barSelect(w.bar, `ntWalkEdit('bar',this.value)`)}</label>` : ''}
      ${f('email', '이메일', false, 'email')}${f('phone', '전화')}</div>
    <div class="nt-note">명단에 없는 사람이에요. 현장 출력으로 뽑으면 체크인으로도 남아요(사전 출력이면 체크인은 따로). 행사가 끝난 뒤 «마스터DB에»로 연락처·참가 확정을 만들어요.</div>
    <div class="nt-actions"><button class="btn bp" onclick="ntPrint()"${nt.busy ? ' disabled' : ''}>🖨 인쇄</button>
      <button class="btn bs" onclick="ntWalkIn(false)">취소</button></div>${recentHtml()}`;
}

function recentHtml(){
  const l = nt.prints.slice(0, 30);
  if(!l.length) return '<div id="nt-recent"></div>';
  const KIND = { issue: '', reissue: '재발급', walk_in: '현장' };
  return `<div id="nt-recent"><h4 style="margin-top:4px">최근 발급</h4><ul class="nt-recent">${l.map(p => `<li class="${p.voided_at ? 'voided' : ''}">
    <span class="who"><b>${escapeHtml(p.name)}</b> <span style="color:var(--i4)">${escapeHtml(p.company || '')}</span>
      ${KIND[p.kind] ? `<span class="pill p-gray">${KIND[p.kind]}${p.reason ? ' · ' + escapeHtml(p.reason) : ''}</span>` : ''}
      ${p.bar ? `<span class="nt-bar"><i style="background:${barTypes().find(b => b.label === p.bar)?.color || '#868e96'}"></i>${escapeHtml(p.bar)}</span>` : ''}</span>
    <span style="display:flex;gap:6px;align-items:center"><span class="when" title="${escAttr(p.printed_by || '')}">${p._wait ? '<span title="이 기기에만 있어요 — 연결되면 보내요">⏳</span> ' : ''}${kst(p.printed_at)}</span>
      ${p.voided_at ? '<span class="when">안 됨</span>' : `<button class="btn bs" onclick="ntVoid('${escAttr(p.id)}')" title="인쇄가 안 나왔으면 되돌려요 — 기록은 남고 받은 수에서 빠져요">안 됨</button>`}</span></li>`).join('')}</ul></div>`;
}

/* 체크인 보기의 오른쪽 — 최근 체크인 */
function checkinSideHtml(){
  const m = new Map(deskPeople(nt.ev).map(p => [p.key, p]));
  const l = [...nt.checkins.values()].sort((a, b) => String(b.checked_at).localeCompare(String(a.checked_at))).slice(0, 40);
  return `<h4>체크인 데스크</h4>
    <div class="nt-note">사전 출력한 네임택을 받으러 온 사람을 찾아 «체크인»을 눌러요. 현장 출력으로 뽑은 사람은 이미 체크인돼 있어요.
      숫자는 다른 데스크 것까지 15초마다 새로 받아요.</div>
    <h4 style="margin-top:4px">최근 체크인</h4>
    ${l.length ? `<ul class="nt-recent">${l.map(c => { const p = m.get(c.person_key);
      return `<li><span class="who"><b>${escapeHtml(p ? p.nameKo || p.nameEn : c.person_key)}</b> <span style="color:var(--i4)">${escapeHtml(p ? p.orgKo || p.orgEn : '')}</span>
        ${barChip(barOf(c.person_key))}</span>
        <span class="when" title="${escAttr(c.checked_by || '')}">${kst(c.checked_at)} · ${c.via === 'print' ? '현장 출력' : '데스크'}</span></li>`; }).join('')}</ul>`
      : '<div class="nt-note">아직 체크인한 사람이 없어요.</div>'}`;
}

/* 하단바 엑셀 미리보기 */
function importHtml(){
  const im = nt.imp, c = im.counts;
  const ST = { change: ['바뀜', 'p-blue'], same: ['그대로', 'p-gray'], clear: ['뺌', 'p-gray'], miss: ['못 찾음', 'p-red'], many: ['여러 명', 'p-amber'], badbar: ['없는 종류', 'p-red'] };
  const shown = im.rows.filter(r => r.state !== 'same').slice(0, 200);
  return `<h4>하단바 엑셀 · ${escapeHtml(im.file)}</h4>
    <div class="nt-bars">${Object.entries(ST).filter(([k]) => c[k]).map(([k, [l, cls]]) => `<span class="pill ${cls}">${l} ${c[k]}</span>`).join(' ')}</div>
    <div class="nt-note">등록번호로 먼저 맞추고, 없으면 이메일, 그래도 없으면 이름+소속으로 맞춰요. 하단바 칸이 비어 있으면 그대로 두고, «없음»이면 빼요.
      «못 찾음»·«여러 명»·«없는 종류»는 넣지 않아요.</div>
    <ul class="nt-recent">${shown.map(r => `<li><span class="who"><b>${escapeHtml(r.name)}</b> <span style="color:var(--i4)">${escapeHtml(r.org || '')}</span>
      <span class="pill ${ST[r.state][1]}">${ST[r.state][0]}</span></span>
      <span class="when">${['badbar', 'miss', 'many'].includes(r.state) ? `하단바 ${escapeHtml(r.raw)}` : `${barChip(r.from) || '미정'} → ${barChip(r.to) || '미정'}`}</span></li>`).join('')}</ul>
    <div class="nt-actions"><button class="btn bp" onclick="ntImportApply()"${nt.busy || !(c.change + c.clear) ? ' disabled' : ''}>${c.change + c.clear}명 하단바 넣기</button>
      <button class="btn bs" onclick="ntImportCancel()">취소</button></div>`;
}

/* 글자 위치 · 이번만(2026-11-12) — 이 사람 네임택에서 글자 칸을 1mm씩 옮긴다. 판은 그대로, 인쇄하면 사라진다.
   이름이 길어 배경 그림에 걸리는 사람 하나만 살짝 내리는 식. 고른 사람이 여럿이면 미리보기 중인 사람만 */
const POS_STEP = 1;
function posHtml(key, card){
  const l = layoutFor(nt.template, card._bar), pos = card._pos || {};
  const keys = TEXT_KEYS.filter(k => l[k]?.show && card[k]);
  if(!keys.length) return '<div class="nt-note">찍힐 글자가 없어요.</div>';
  const v = (n) => n ? (n > 0 ? '+' : '') + n : '0';
  return keys.map(k => { const d = pos[k] || {};
    return `<div class="nt-pos-row"><span class="nt-pos-lbl">${EL_LABEL[k]}</span>
      ${[['↑', 0, -1, '위로'], ['↓', 0, 1, '아래로'], ['←', -1, 0, '왼쪽으로'], ['→', 1, 0, '오른쪽으로']].map(([a, x, y, t]) =>
        `<button class="btn bs" title="${t} ${POS_STEP}mm" onclick="ntNudge('${escAttr(key)}','${k}',${x},${y})">${a}</button>`).join('')}
      <span class="nt-note">가로 ${v(d.dx)} · 세로 ${v(d.dy)} mm</span></div>`; }).join('')
    + `<div class="nt-note">이 사람의 이번 인쇄에만 써요. 판(설정 › 행사 상세 › 네임택)은 그대로예요.
      ${card._pos ? `<button class="btn bs" onclick="ntNudgeReset('${escAttr(key)}')">처음 자리로</button>` : ''}</div>`;
}
function refreshPos(key){
  const p = evPerson(key), el = document.getElementById('nt-pos');
  if(!p) return;
  const card = cardFor(p);
  if(el) el.innerHTML = posHtml(key, card);
  refreshPreview(card);
}
export function ntNudge(key, k, x, y){
  const e = nt.edits.get(key) || {};
  const pos = { ...(e._pos || {}) }, d = { dx: 0, dy: 0, ...(pos[k] || {}) };
  const r = (n) => Math.round(n * 10) / 10;
  d.dx = r(d.dx + x * POS_STEP); d.dy = r(d.dy + y * POS_STEP);
  if(d.dx || d.dy) pos[k] = d; else delete pos[k];
  e._pos = Object.keys(pos).length ? pos : undefined;
  nt.edits.set(key, e);
  refreshPos(key);
}
export function ntNudgeReset(key){
  const e = nt.edits.get(key);
  if(e) e._pos = undefined;
  refreshPos(key);
}

function fitPreview(){
  const el = document.getElementById('nt-preview');
  if(!el) return;
  fitNametags(el);
  document.fonts?.ready.then(() => fitNametags(el));
}
/* 입력 중에는 통째로 다시 그리지 않는다(입력칸이 포커스를 잃는다) — 미리보기만 갈아 끼운다 */
function refreshPreview(card){
  const el = document.getElementById('nt-preview');
  if(!el) return;
  el.innerHTML = previewHtml(card);
  fitPreview();
}

/* ── 동작 ── */
const evPerson = (key) => deskPeople(nt.ev).find(p => p.key === key);

export function ntSetView(v){ nt.view = v === 'checkin' ? 'checkin' : 'issue'; nt.filter = 'todo'; nt.imp = null; nt.netView = false;
  if(nt.view !== 'checkin' && cameraOn()) closeCamera();
  rerender();
  if(nt.view === 'checkin') setTimeout(() => document.getElementById('evdb-q')?.focus(), 0); }
export function ntSetOnsite(v){ nt.onsite = v === 'on'; rerender(); }
export function ntSetFilter(v){ nt.filter = v; rerender(); }
export function ntSetSrc(v){ nt.src = v; rerender(); }
export function ntSetBarFil(v){ nt.barFil = v; rerender(); }
export function ntSetSort(v){ nt.sort = SORTS.some(s => s[0] === v) ? v : 'org'; try { localStorage.setItem('nametag.sort.v1', nt.sort); } catch {} rerender(); }
export function ntFocus(key){ nt.focus = key; nt.walkIn = null; nt.imp = null; nt.netView = false; rerender(); }
export function ntPick(key, on){ if(on) nt.picked.add(key); else nt.picked.delete(key); if(on && !nt.focus) nt.focus = key; nt.walkIn = null; rerender(); }
export function ntPickAll(on){
  if(!on){ nt.picked.clear(); rerender(); return; }
  visible(nt.ev, document.getElementById('evdb-q')?.value || '').slice(0, 600).forEach(p => nt.picked.add(p.key));
  rerender();
}
export function ntEdit(key, field, value){
  const e = nt.edits.get(key) || {};
  e[field] = value;
  nt.edits.set(key, e);
  const p = evPerson(key);
  if(!p) return;
  if(field === 'lang'){
    /* 말을 바꾸면 그 말의 값으로 다시 채운다 — 앞서 고친 글자는 버린다 */
    nt.edits.set(key, { lang: value });
    rerender();
    return;
  }
  refreshPreview(cardFor(p));
}
export function ntWalkIn(on){ nt.walkIn = on ? { name: '', company: '', job_title: '', badge: '', bar: '', email: '', phone: '' } : null; nt.imp = null; rerender(); }
export function ntWalkEdit(field, value){ if(!nt.walkIn) return; nt.walkIn[field] = value; if(field !== 'bar' && field !== 'email' && field !== 'phone') refreshPreview(nt.walkIn); }
export function ntSetReason(v){ nt.reason = v; }
export function ntReload(){ nt.loaded = ''; nt.err = ''; ensureLoaded(nt.ev); rerender(); }

/* 판은 설정 › 행사 상세 › 네임택(nt-editor.js)에서 고친다. 저장하면 여기로 알려 준다 */
export function ntTemplateSaved(evKey, t){
  if(nt.ev !== evKey) return;
  nt.template = t;
  nt.edits.forEach((e, k) => { if(e.lang) nt.edits.delete(k); });
  foldAliases();   // 하단바 종류의 역할이 바뀌었을 수 있다
}
export function ntOpenEditor(){
  if(!nt.ev) return;
  window.switchArchTab?.('ev');
  window.openEvDetail?.(nt.ev);
  window.setEvDetailSeg?.('nametag');
}

/* 하단바 — 한 명 / 고른 사람 모두 */
function saveBars(items, via){
  if(!items.length) return;
  const op = { kind: 'bars', data: { items, via } };
  applyOp(op);
  enqueue(nt.ev, 'bars', op.data);
  return { ok: true };
}
export async function ntSetBar(key, bar){ await saveBars([{ person_key: key, bar }]); rerender(); }
export async function ntSetBarPicked(bar){
  const keys = nt.picked.size ? [...nt.picked] : nt.focus ? [nt.focus] : [];
  await saveBars(keys.map(k => ({ person_key: k, bar })));
  rerender();
}
export function ntWalkContact(key, field, value){
  const p = nt.people.get(key) || {};
  const data = { key, email: field === 'email' ? value : p.email || '', phone: field === 'phone' ? value : p.phone || '' };
  applyOp({ kind: 'contact', data });
  enqueue(nt.ev, 'contact', data);
}

export async function ntPrint(){
  if(nt.busy) return;
  let cards;
  if(nt.walkIn){
    const w = nt.walkIn;
    cards = [{ source: 'walk_in', name: w.name, company: w.company, job_title: w.job_title, badge: w.badge, bar: w.bar,
      email: w.email, phone: w.phone, lang: /[가-힣]/.test(w.name) ? 'ko' : 'en' }];
  } else {
    const list = targets(nt.ev);
    if(!list.length) return alert('뽑을 사람을 골라 주세요.');
    const done = printedMap();
    if(list.some(p => done.has(p.key)) && !nt.reason) return alert('이미 받은 사람이 있어요. 재발급 사유를 골라 주세요.');
    cards = list.map(p => ({ person_key: p.key, source: p.source, ref_id: p.ref_id, contact_id: p.contact_id, ...cardFor(p) }));
    // 이름이 비어도 뽑는다 — 소속만 찍거나 손으로 쓸 빈 네임택(2026-11-11)
  }
  /* QR을 켠 판인데 그릴 도구가 없으면(외부 CDN을 못 받음) QR 없는 네임택이 나간다 → 막는다 */
  if(nt.template.layout?.qr?.show && !window.qrcode)
    return alert('입장 QR을 그리는 도구를 못 불러왔어요. 인터넷이 될 때 화면을 새로 고친 뒤 뽑아 주세요.\nQR 없이 뽑으려면 «판 고치기»에서 QR을 꺼 주세요.');
  /* 팝업 차단을 피하려면 누른 그 순간 창을 연다 */
  const w = openPrintWindow();
  if(!w) return alert('인쇄 창이 막혔어요. 브라우저 주소창 오른쪽에서 이 사이트의 팝업을 허용해 주세요.');
  /* 기록은 이 기기가 만든다(id·시각) → 기기에 남기고 바로 인쇄, 서버로는 뒤에서 보낸다(nt-outbox.js) */
  const onsite = isOnsite(), at = new Date().toISOString(), by = currentUser?.email || '', batch = newId('NB-');
  const done = printedMap();
  const rows = cards.map(c => {
    const id = newId('NP-'), fresh = c.source === 'walk_in' && !c.person_key, key = fresh ? 'w' + id : c.person_key;
    const kind = fresh ? 'walk_in' : done.has(key) ? 'reissue' : 'issue';
    const barId = fresh ? c.bar || '' : barOf(key);
    return { id, event_id: nt.ev, batch_id: batch, person_key: key, source: c.source, ref_id: c.ref_id || null,
      contact_id: c.contact_id != null && c.contact_id !== '' ? String(c.contact_id) : null,
      name: String(c.name || '').trim(), company: c.company || '', job_title: c.job_title || null, badge: c.badge || null,
      name_alt: c.name_alt || '', company_alt: c.company_alt || '', job_title_alt: c.job_title_alt || '',   // 병기 — 인쇄 창만 쓴다(기록에는 안 남김)
      _pos: c._pos || null,   // 글자 위치 · 이번만 — 인쇄 창만 쓴다(서버로 안 보냄)
      _alt: typeof c._alt === 'boolean' ? c._alt : undefined,   // 하단바가 정한 병기 켬·끔 — 인쇄 창만 쓴다
      bar: barType(barId)?.label || null, lang: c.lang === 'en' ? 'en' : 'ko', kind, reason: kind === 'reissue' ? nt.reason : null,
      printed_by: by, printed_at: at, voided_at: null, _wait: true,
      _checkin_id: onsite && !nt.checkins.has(key) ? newId('NC-') : '', _bar_id: barId || '',   // 현장 신규도 사전 출력이면 체크인 안 함
      _email: fresh ? c.email || '' : '', _phone: fresh ? c.phone || '' : '' };
  });
  const data = { rows, reason: nt.reason || '', onsite };
  applyOp({ kind: 'issue', data });
  enqueue(nt.ev, 'issue', data);
  nt.picked.clear(); nt.edits.clear(); nt.reason = ''; nt.walkIn = null;
  rerender();
  const ev = nt.ev;
  await fillPrintWindow(w, nt.template, rows, { onUnprinted: () => unprinted(ev, rows, onsite) });
}
/* 빈 네임택 — 이름·소속 없이 판 배경만, A4 한 장에 4매(2026-11-11). 손으로 쓸 여분이라 발급 기록은 남기지 않는다.
   배경을 «가늠자»로만 둔 판(인쇄에 배경 안 찍음)이어도 이때는 배경을 찍는다. 더 필요하면 인쇄 대화상자의 매수로 */
export function ntPrintBlank(){
  if(!nt.template.background_data) return alert('이 판에 배경이 없어요. 설정 › 행사 상세 › 네임택에서 배경을 넣어 주세요.');
  const w = openPrintWindow();
  if(!w) return alert('인쇄 창이 막혔어요. 브라우저 주소창 오른쪽에서 이 사이트의 팝업을 허용해 주세요.');
  fillPrintWindow(w, { ...nt.template, background_print: true }, Array.from({ length: 4 }, () => ({ name: '' })), { perPage: 4 });
}
/* 인쇄 창에서 «인쇄»를 한 번도 안 누르고 닫았다 — 방금 남긴 발급(과 현장 출력 체크인)을 되돌릴지 묻는다 */
function unprinted(ev, rows, onsite){
  if(nt.ev !== ev) return;
  const live = rows.filter(r => !nt.prints.find(p => p.id === r.id)?.voided_at);
  if(!live.length) return;
  const ck = live.filter(r => r._checkin_id && nt.checkins.get(r.person_key)?.id === r._checkin_id);
  if(!confirm(`인쇄하지 않고 인쇄 창을 닫았어요.\n방금 발급한 ${live.length}장(${live.slice(0, 3).map(r => r.name || '이름 없음').join(', ')}${live.length > 3 ? ' 외' : ''})을 «안 됨»으로 되돌릴까요?`
    + (ck.length ? `\n함께 남긴 체크인 ${ck.length}건도 취소해요.` : '') + '\n\n실제로 뽑았으면 «취소»를 눌러 주세요.')) return;
  const by = currentUser?.email || '';
  live.forEach(r => {
    const op = { kind: 'void', at: new Date().toISOString(), data: { id: r.id, name: r.name, by } };
    applyOp(op); enqueue(ev, 'void', op.data);
  });
  ck.forEach(r => { nt.checkins.delete(r.person_key); enqueue(ev, 'uncheck', { id: r._checkin_id, key: r.person_key }); });
  rerender();
}

export async function ntVoid(id){
  const p = nt.prints.find(x => x.id === id);
  if(!p || !confirm(`${p.name} 님 네임택이 안 나왔다고 되돌릴까요?\n기록은 남고, 받은 수에서 빠져요. 체크인은 그대로예요.`)) return;
  const op = { kind: 'void', at: new Date().toISOString(), data: { id, name: p.name, by: currentUser?.email || '' } };
  applyOp(op);
  enqueue(nt.ev, 'void', op.data);
  rerender();
}

/* ── 입장 QR 스캔 — 스캐너는 검색칸에 «nt:<등록번호>»를 쳐 넣고 Enter를 누른다.
   체크인 보기면 바로 체크인, 발급 보기면 그 사람을 골라 미리보기에 띄운다 ── */
export function ntScanKey(e){
  if(e.key !== 'Enter') return;
  const raw = e.target.value, k = parseScan(raw);
  if(!k) return;
  e.preventDefault();
  const p = deskPeople(nt.ev).find(x => x.key.toLowerCase() === k);
  e.target.value = '';
  window.setEvDbQuery?.('');
  if(!p){ alert('이 행사 명단에 없는 QR이에요.'); return; }
  if(nt.view === 'checkin'){
    if(nt.checkins.has(p.key)) return alert(`${p.nameKo || p.nameEn} 님은 이미 ${kst(nt.checkins.get(p.key).checked_at)}에 체크인했어요.`);
    ntCheckIn(p.key);
  } else ntFocus(p.key);
}

/* ── 카메라 체크인 — 켜 두면 QR이 비치는 대로 바로 체크인(nt-camera.js). 체크인 화면을 떠나면 꺼진다 ── */
export function ntCamera(){
  const ev = nt.ev;
  openCamera(async (k) => {
    const p = deskPeople(ev).find(x => x.key.toLowerCase() === k);
    if(!p) return { state: 'unknown' };
    const b = barType(barOf(p.key));
    const person = { name: p.nameKo || p.nameEn, org: p.orgKo || p.orgEn, bar: b ? b.label : '' };
    const had = nt.checkins.get(p.key);
    if(had) return { state: 'already', person, at: kst(had.checked_at) };
    checkInLocal(p.key);   // 기기에 남기고 바로 초록 — 서버로는 뒤에서
    refreshLists();
    return { state: 'ok', person };
  }, () => nt.ev === ev && nt.view === 'checkin' && !!document.getElementById('nt-desk'), (text) => matchName(deskPeople(ev), text));
}

/* 이름 읽기(nt-camera.js) — 읽은 글자에서 명단의 이름을 찾는다(2026-11-13).
   글자 읽기는 틀리기 쉽다(한 글자 바뀜·띄어쓰기·소속이 섞임) → 띄어쓰기를 빼고, 읽은 글자 안에서 이름과 가장 비슷한 토막을 잰다.
   이름이 통째로 들어 있고 그런 사람이 한 명뿐이면 바로 체크인, 아니면 비슷한 사람을 4명까지 후보로 */
const lev = (a, b) => {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for(let i = 1; i <= a.length; i++){
    let prev = d[0]; d[0] = i;
    for(let j = 1; j <= b.length; j++){ const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
};
/* text 안에서 name과 가장 비슷한 토막의 닮음(0~1) */
function nearIn(text, name){
  if(!name || name.length < 2 || !text) return 0;
  if(text.includes(name)) return 1;
  let best = 0;
  for(let n = Math.max(1, name.length - 1); n <= name.length + 1; n++)
    for(let i = 0; i + n <= text.length; i++) best = Math.max(best, 1 - lev(text.slice(i, i + n), name) / name.length);
  return best;
}
function matchName(people, raw){
  const ko = String(raw || '').replace(/[^가-힣]/g, '');
  const en = String(raw || '').toLowerCase().replace(/[^a-z]/g, '');
  const read = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if(!ko && !en) return { exact: '', list: [], read };
  const scored = people.map(p => {
    const k = String(p.nameKo || '').replace(/[^가-힣]/g, ''), e = String(p.nameEn || '').toLowerCase().replace(/[^a-z]/g, '');
    return { p, s: Math.max(nearIn(ko, k), nearIn(en, e)) };
  }).filter(x => x.s >= 0.6).sort((a, b) => b.s - a.s);
  const full = scored.filter(x => x.s === 1);
  const exact = full.length === 1 && (scored.length < 2 || scored[1].s < 1) ? full[0].p.key : '';
  return { exact, read, list: scored.slice(0, 4).map(({ p }) => ({ key: p.key, name: p.nameKo || p.nameEn, org: p.orgKo || p.orgEn })) };
}

/* ── 체크인 ── */
function checkInLocal(key){
  if(nt.checkins.has(key)) return;
  const row = { id: newId('NC-'), person_key: key, via: 'desk', print_id: null, checked_at: new Date().toISOString(), checked_by: currentUser?.email || '', _wait: true };
  nt.checkins.set(key, row);
  enqueue(nt.ev, 'checkin', { row });
}
export function ntCheckIn(key){
  checkInLocal(key);
  refreshLists();
  const q = document.getElementById('evdb-q');
  if(q && nt.view === 'checkin'){ q.select(); q.focus(); }   // 다음 사람을 바로 찾게
}
export function ntUncheck(key){
  const c = nt.checkins.get(key), p = evPerson(key);
  if(!c || !confirm(`${p ? p.nameKo || p.nameEn : key} 님 체크인을 취소할까요? 기록은 남아요.`)) return;
  nt.checkins.delete(key);
  enqueue(nt.ev, 'uncheck', { id: c.id, key });
  rerender();
}

/* ── 이 기기 기록 ── */
export function ntNetView(on = true){ nt.netView = !!on; rerender(); }
export function ntSendNow(){ kick(0); }
export function ntRetryFailed(){ retryFailed(nt.ev); }
export function ntDismissFailed(){ dismissFailed(nt.ev); }
export function ntExportDeviceLog(){
  if(!window.XLSX) return alert('엑셀 도구를 못 불러왔어요. 인터넷이 될 때 화면을 새로 고쳐 주세요.');
  const names = new Map(deskPeople(nt.ev).map(p => [p.key, p.nameKo || p.nameEn]));
  const kstFull = (iso) => iso ? new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 19).replace('T', ' ') : '';
  const ST = { wait: '기다림', sent: '보냄', fail: '못 보냄' };
  const rows = deviceLog(nt.ev).map(o => [kstFull(o.at), OP_LABEL[o.kind] || o.kind, opText(o, names), ST[o.state], kstFull(o.sent_at), o.err || '', o.id]);
  const ws = window.XLSX.utils.aoa_to_sheet([['기록 시각', '종류', '내용', '상태', '보낸 시각', '오류', '기기 기록 번호'], ...rows]);
  ws['!cols'] = [20, 12, 40, 8, 20, 30, 24].map(w => ({ wch: w }));
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, '기기 기록');
  const ev = evRow();
  window.XLSX.writeFile(wb, `${(ev.short || ev.name || nt.ev).replace(/[\\/:*?"<>|]/g, '')}_네임택_기기기록_${today()}.xlsx`);
}

/* ── 최종 등록자 명단 엑셀 — 하단바 엑셀 올리기 양식도 이것(등록번호 칸으로 맞춘다) ── */
const XCOLS = ['등록번호', '출처', '이름(국문)', '이름(영문)', '소속', '직함', '이메일', '구분', '하단바', '네임택', '마지막 발급', '체크인', '체크인 시각', '체크인 방법'];
export function ntExport(){
  if(!window.XLSX) return alert('엑셀 도구를 아직 못 불러왔어요. 잠시 뒤 다시 눌러 주세요.');
  const done = printedMap();
  const kstFull = (iso) => iso ? new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '';
  const rows = sortPeople(deskPeople(nt.ev)).map(p => {
    const d = done.get(p.key), c = nt.checkins.get(p.key), b = barType(barOf(p.key));
    return [p.key, SOURCE_LABEL[p.source], p.nameKo, p.nameEn, p.orgKo || p.orgEn, p.titleKo || p.titleEn, p.email || '',
      p.badgeKo || '', b ? b.label : '', d ? d.n : 0, d ? kstFull(d.last) : '', c ? 'Y' : '', c ? kstFull(c.checked_at) : '',
      c ? (c.via === 'print' ? '현장 출력' : '체크인 데스크') : ''];
  });
  const ws = window.XLSX.utils.aoa_to_sheet([XCOLS, ...rows]);
  ws['!cols'] = [16, 8, 12, 18, 24, 16, 24, 10, 10, 6, 16, 6, 16, 12].map(w => ({ wch: w }));
  const guide = window.XLSX.utils.aoa_to_sheet([
    ['네임택 명단 — 최종 등록자'],
    ['등록번호', '이 명단의 사람을 가리키는 번호예요. 하단바 엑셀을 올릴 때 이 번호로 맞추니 지우거나 고치지 마세요.'],
    ['하단바', `이 행사 종류: ${barTypes().map(b => b.label).join(', ') || '(아직 없음)'}. 비워 두면 그대로, «없음»이면 빼요.`],
    ['새 줄', '등록번호 없이 줄을 더하면 이메일, 그다음 이름(국문 또는 영문)+소속으로 맞춰요. 못 찾은 줄은 넣지 않아요.'],
  ]);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, '명단');
  window.XLSX.utils.book_append_sheet(wb, guide, '안내');
  const ev = evRow();
  window.XLSX.writeFile(wb, `${(ev.short || ev.name || nt.ev).replace(/[\\/:*?"<>|]/g, '')}_네임택명단_${today()}.xlsx`);
}

/* ── 하단바 엑셀 올리기 — 미리보기 후 넣는다 ── */
const norm = (v) => String(v ?? '').replace(/\s+/g, '').toLowerCase();
export async function ntImportBars(file){
  if(!file) return;
  if(!window.XLSX) return alert('엑셀 도구를 아직 못 불러왔어요.');
  if(!barTypes().length) return alert('하단바 종류가 없어요. «판 고치기»에서 먼저 만들어 주세요.');
  let aoa;
  try {
    const wb = window.XLSX.read(await file.arrayBuffer());
    aoa = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
  } catch(e){ return alert('엑셀을 읽지 못했어요 — ' + e.message); }
  const hi = aoa.findIndex(r => r.some(v => norm(v) === '하단바'));
  if(hi < 0) return alert('«하단바» 칸을 찾지 못했어요. «명단 엑셀»로 받은 파일에 채워 올려 주세요.');
  const head = aoa[hi].map(norm);
  const col = (...names) => head.findIndex(h => names.some(n => h === norm(n)));
  const cKey = col('등록번호'), cBar = col('하단바'), cMail = col('이메일', 'email'), cOrg = col('소속', '회사', 'organization');
  const cKo = col('이름(국문)', '이름', '성명', 'name'), cEn = col('이름(영문)', '영문이름');
  const people = deskPeople(nt.ev);
  const keyMap = new Map(people.map(p => [p.key, p]));
  const group = (f) => { const m = new Map(); people.forEach(p => f(p).filter(Boolean).forEach(k => m.set(k, [...(m.get(k) || []), p]))); return m; };
  const byMail = group(p => [norm(p.email)]);
  const byNameOrg = group(p => [norm(p.nameKo) && norm(p.nameKo) + '|' + norm(p.orgKo || p.orgEn), norm(p.nameEn) && norm(p.nameEn) + '|' + norm(p.orgEn || p.orgKo)]);
  const labelMap = new Map(barTypes().map(b => [norm(b.label), b.id]));
  const rows = [], counts = { change: 0, same: 0, clear: 0, miss: 0, many: 0, badbar: 0 };
  const seen = new Set();
  aoa.slice(hi + 1).forEach(r => {
    const raw = String(r[cBar] ?? '').trim();
    if(!raw) return;
    const name = String(r[cKo] || r[cEn] || '').trim(), org = cOrg >= 0 ? String(r[cOrg] || '').trim() : '';
    let hit = null, state = '';
    const k = cKey >= 0 ? String(r[cKey] || '').trim() : '';
    if(k && keyMap.has(k)) hit = keyMap.get(k);
    else {
      const m = cMail >= 0 && norm(r[cMail]) ? byMail.get(norm(r[cMail])) : null;
      const n = !m && name ? byNameOrg.get(norm(name) + '|' + norm(org)) : null;
      const found = m || n;
      if(found?.length === 1) hit = found[0];
      else state = found?.length > 1 ? 'many' : 'miss';
    }
    const to = ['없음', '-', '미정'].includes(raw) ? '' : labelMap.get(norm(raw));
    if(!state && to === undefined) state = 'badbar';
    if(!state){
      if(seen.has(hit.key)) return;   // 같은 사람이 두 줄이면 앞의 것
      seen.add(hit.key);
      const from = barOf(hit.key);
      state = from === to ? 'same' : to ? 'change' : 'clear';
    }
    counts[state]++;
    rows.push({ key: hit?.key, name: hit ? hit.nameKo || hit.nameEn : name || '(이름 없음)', org: hit ? hit.orgKo || hit.orgEn : org,
      from: hit ? barOf(hit.key) : '', to: to || '', raw, state });
  });
  if(!rows.length) return alert('하단바가 채워진 줄이 없어요.');
  nt.imp = { file: file.name, rows, counts };
  nt.walkIn = null;
  rerender();
}
export async function ntImportApply(){
  const im = nt.imp;
  if(!im) return;
  const items = im.rows.filter(r => r.state === 'change' || r.state === 'clear').map(r => ({ person_key: r.key, bar: r.to }));
  const j = await saveBars(items, 'excel');
  if(j){ nt.imp = null; alert(`${items.length}명 하단바를 넣었어요.`); }
  rerender();
}
export function ntImportCancel(){ nt.imp = null; rerender(); }

/* ── 현장 신규 → 마스터DB — 연락처(같은 이메일이면 그 사람)와 이 행사 참가 확정을 만들고, 기록 키를 c<연락처 id>로 옮긴다 ── */
export async function ntPromote(){
  const wi = walkInPeople(nt.prints, nt.people).filter(p => p.nameKo || p.nameEn);   // 이름 없이 뽑은 사람은 누군지 몰라 올리지 않는다
  if(!wi.length) return;
  const w = waiting(nt.ev).length;
  if(w) return alert(`이 기기에 아직 서버로 보내지 않은 기록이 ${w}건 있어요. 연결돼 다 보내진 뒤 다시 눌러 주세요.`);
  const noMail = wi.filter(p => !p.email).length;
  if(!confirm(`현장 신규 ${wi.length}명을 마스터DB에 올릴까요?\n연락처를 만들고 이 행사 «참가자»로 확정해요. 같은 이메일이 있으면 그 사람에 붙여요.${noMail ? `\n이메일이 없는 ${noMail}명은 새 연락처로 만들어요.` : ''}`)) return;
  nt.busy = true; rerender();
  let made = 0, n = 0;
  try {
    /* 50명씩 — 한 요청이 서버 시간 한도(60초)에 걸리지 않게. 중간에 끊기면 올라간 만큼은 화면에도 남는다 */
    for(let i = 0; i < wi.length; i += 50){
    const j = await promoteWalkIns(nt.ev, wi.slice(i, i + 50).map(p => p.key));
    (j.promoted || []).forEach(r => {
      n++;
      const c = r.contact, cid = +c.id;
      if(r.created) made++;
      if(!contacts.some(x => x.id === cid)) contacts.push({ id: cid, nameKo: c.nameKo || '', nameEn: c.nameEn || '', orgKo: c.orgKo || '', orgEn: c.orgEn || '',
        titleKo: c.titleKo || '', titleEn: c.titleEn || '', deptKo: c.deptKo || '', deptEn: c.deptEn || '', country: c.country || '', cat: c.cat || 'attendee',
        lang: c.lang || 'ko', source: c.source || '', date: c.date || '', status: c.status || 'new', email1: c.email1 || '', email2: c.email2 || '',
        phone1: c.phone1 || '', phone2: c.phone2 || '', beat: c.beat || '', products: c.products || '', tags: c.tags || '' });
      const pt = r.participation, old = participations.find(p => p.id === pt.id);
      if(old) old.confirmedAt = pt.confirmed_at || old.confirmedAt;
      else participations.push({ id: pt.id, eventId: nt.ev, event: nt.ev, contactId: cid, contact: '', role: pt.role, note: pt.note || '', matched: pt.matched || '', confirmedAt: pt.confirmed_at });
      nt.prints.forEach(p => { if(p.person_key === r.from){ p.person_key = r.to; p.contact_id = String(cid); } });
      const ck = nt.checkins.get(r.from);
      nt.checkins.delete(r.from);
      if(ck && !nt.checkins.has(r.to)) nt.checkins.set(r.to, { ...ck, person_key: r.to });
      nt.people.delete(r.from);
      if(r.person) nt.people.set(r.to, r.person);
    });
    }
    alert(`${n}명을 올렸어요 — 새 연락처 ${made} · 기존 연락처에 붙임 ${n - made}`);
  } catch(e){
    alert(`${n ? `${n}명까지 올리고 ` : ''}멈췄어요 — ${e.message}\n다시 누르면 남은 사람만 올려요.`);
    resync();
  }
  nt.busy = false; rerender();
}

Object.assign(window, { ntNudge, ntNudgeReset, ntPrintBlank, ntSetView, ntSetOnsite, ntSetFilter, ntSetSrc, ntSetBarFil, ntSetSort, ntFocus, ntPick, ntPickAll, ntEdit, ntWalkIn, ntWalkEdit,
  ntSetReason, ntReload, ntOpenEditor, ntPrint, ntVoid, ntSetBar, ntSetBarPicked, ntWalkContact, ntCheckIn, ntUncheck,
  ntScanKey, ntCamera, ntExport, ntImportBars, ntImportApply, ntImportCancel, ntPromote,
  ntNetView, ntSendNow, ntRetryFailed, ntDismissFailed, ntExportDeviceLog });
