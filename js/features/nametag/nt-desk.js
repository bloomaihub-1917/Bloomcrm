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

   왼쪽 명단은 #evdb-rows라 검색(event-tab.js setEvDbQuery)이 목록만 갈아 끼운다.
═══════════════════════════════════════════════════════════════ */
import { escapeHtml, escAttr } from '../../utils.js';
import { contacts, participations, EVENT_LIST } from '../../state.js';
import { normalizeTemplate, LANG_OPTIONS, REISSUE_REASONS, MM_PX, parseScan } from '../../domain/nametag-layout.js';
import { loadNametag, issueNametags, voidNametag, saveNametagBars, saveWalkInContact, checkInNametag, voidCheckIn, loadNametagLive, promoteWalkIns } from '../../api/nametag.js';
import { ntPeople, walkInPeople, cardOf, SOURCE_LABEL } from './nt-people.js';
import { ntCardHtml } from './nt-card.js';
import { fitNametags } from './nt-fit.js';
import { openPrintWindow, fillPrintWindow } from './nt-print.js';

const POLL_MS = 15000;
const nt = {
  ev: '', loaded: '', loading: false, err: '',
  template: normalizeTemplate(null), prints: [],
  people: new Map(),     // person_key → nametag_people 줄 { bar, email, phone, contact_id }
  checkins: new Map(),   // person_key → 살아 있는 체크인 { id, via, checked_at, checked_by }
  since: '',             // /live에 «이 뒤로 바뀐 것»을 묻는 기준(서버 시각)
  view: 'issue',         // 'issue'(발급) | 'checkin'(체크인)
  onsite: null,          // null이면 행사 기간으로 정한다(기간 안이면 현장 출력)
  filter: 'todo',        // 발급: 'todo'(안 받음) | 'done'(받음) | 'all'  · 체크인: 'todo'(안 옴) | 'done'(옴) | 'all'
  src: '',               // '' | 'speaker' | 'exh' | 'part' | 'walk_in'
  barFil: '',            // '' | '_none'(미정) | 하단바 종류 id
  picked: new Set(), focus: '',
  edits: new Map(),      // person_key → { name, company, job_title, badge, lang }
  walkIn: null,          // 현장 신규 입력 중이면 { name, company, job_title, badge, bar, email, phone }
  imp: null,             // 하단바 엑셀 미리보기 { file, rows:[{ key, name, from, to, state }], counts }
  reason: '', busy: false, timer: 0,
};

const rerender = () => window.renderEvDb?.();
const evRow = () => EVENT_LIST.find(e => e.key === nt.ev) || {};
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const byKey = (rows, k = 'person_key') => new Map((rows || []).map(r => [r[k], r]));

function ensureLoaded(evKey){
  if(nt.ev !== evKey){
    Object.assign(nt, { ev: evKey, loaded: '', err: '', template: normalizeTemplate(null), prints: [], focus: '', walkIn: null,
      reason: '', imp: null, onsite: null, since: '', barFil: '' });
    nt.picked.clear(); nt.edits.clear(); nt.people.clear(); nt.checkins.clear();
  }
  if(nt.loaded === evKey || nt.loading) return;
  nt.loading = true;
  loadNametag(evKey).then(j => {
    if(nt.ev !== evKey) return;
    nt.template = normalizeTemplate(j.template);
    nt.prints = j.prints || [];
    nt.people = byKey(j.people);
    nt.checkins = byKey(j.checkins);
    nt.since = j.now || new Date().toISOString();
    nt.loaded = evKey;
  }).catch(e => { nt.err = e.message; nt.loaded = evKey; })
    .finally(() => { nt.loading = false; rerender(); });
}

/* ── 현장 실시간 — 다른 데스크의 체크인·발급·하단바를 15초마다 받아 숫자와 명단만 갈아 끼운다
   (통째로 다시 그리면 검색칸·입력칸이 포커스를 잃는다) */
function startPolling(){
  if(nt.timer) return;
  nt.timer = setInterval(async () => {
    if(!document.getElementById('nt-desk')){ clearInterval(nt.timer); nt.timer = 0; return; }
    if(document.hidden || !nt.loaded || nt.err || nt.busy) return;
    const ev = nt.ev;
    try {
      const j = await loadNametagLive(ev, nt.since);
      if(nt.ev !== ev) return;
      mergeLive(j);
      refreshLists();
    } catch(e){ console.warn('네임택 실시간', e.message); }
  }, POLL_MS);
}
function mergeLive(j){
  nt.checkins = byKey(j.checkins);
  if(j.prints?.length){
    const m = new Map(nt.prints.map(p => [p.id, p]));
    j.prints.forEach(p => m.set(p.id, p));
    nt.prints = [...m.values()].sort((a, b) => String(b.printed_at).localeCompare(String(a.printed_at)));
  }
  (j.people || []).forEach(p => nt.people.set(p.person_key, p));
  if(j.now) nt.since = j.now;
}
function refreshLists(){
  const st = document.getElementById('nt-stats');
  if(st) st.outerHTML = statsHtml();
  const rows = document.getElementById('evdb-rows');
  if(rows) rows.innerHTML = ntRowsHtml(nt.ev, document.getElementById('evdb-q')?.value || '');
  const rc = document.getElementById('nt-recent');
  if(rc) rc.outerHTML = recentHtml();
}

/* ── 모으기 ── */
const deskPeople = (evKey) => [...ntPeople(evKey), ...walkInPeople(nt.prints, nt.people)];

/* 받은 기록 — 무효 아닌 것만 센다 */
function printedMap(){
  const m = new Map();
  nt.prints.forEach(p => {
    if(p.voided_at || !p.person_key) return;
    const v = m.get(p.person_key) || { n: 0, last: '' };
    v.n++; if(p.printed_at > v.last) v.last = p.printed_at;
    m.set(p.person_key, v);
  });
  return m;
}

const barTypes = () => nt.template.bar_types || [];
const barOf = (key) => nt.people.get(key)?.bar || '';
const barType = (id) => barTypes().find(b => b.id === id);
const barChip = (id, big) => {
  if(!id) return big ? '<span class="nt-bar nt-bar-none">하단바 미정</span>' : '';
  const b = barType(id);
  return b ? `<span class="nt-bar${big ? ' big' : ''}"><i style="background:${b.color}"></i>${escapeHtml(b.label)}</span>`
    : `<span class="nt-bar nt-bar-none" title="설정에서 지운 종류예요">지운 종류</span>`;
};
const barSelect = (cur, on, extra = '') => `<select class="fi nt-bar-sel" ${extra} onchange="${on}">
  <option value="">${cur ? '— 빼기' : '— 미정'}</option>
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
  const base = cardOf(p, e.lang || nt.template.lang);
  return { ...base, person_key: p.key, ...Object.fromEntries(Object.entries(e).filter(([k, v]) => k !== 'lang' && v != null)) };
}

function visible(evKey, query){
  const done = nt.view === 'checkin' ? nt.checkins : printedMap();
  const q = String(query || '').trim().toLowerCase();
  return deskPeople(evKey).filter(p =>
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
      <div class="stat-card"><div class="n">${inn.length}<span class="nt-of"> / ${all.length}</span></div><div class="l">체크인</div><div class="s">현장 출력 ${viaPrint} · 체크인 데스크 ${inn.length - viaPrint} · ${kst(new Date().toISOString())} 기준</div></div>
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
  const t = nt.template;
  const seg = (cur, list, fn) => `<div class="seg">${list.map(([k, l]) =>
    `<button class="seg-b${cur === k ? ' on' : ''}" onclick="${fn}('${k}')">${l}</button>`).join('')}</div>`;
  const ci = nt.view === 'checkin';
  const wiTodo = walkInPeople(nt.prints, nt.people).length;
  setTimeout(fitPreview, 0);
  return `<div id="nt-desk">
    <div class="sec sec-bar">
      ${seg(nt.view, [['issue', '🖨 발급'], ['checkin', '✓ 체크인']], 'ntSetView')}
      ${ci ? '' : `${seg(isOnsite() ? 'on' : 'pre', [['pre', '사전 출력'], ['on', '현장 출력']], 'ntSetOnsite')}
        <span class="nt-note">${isOnsite() ? '뽑으면 바로 체크인으로 남아요' : '뽑아도 체크인은 따로 해요'}</span>`}
      <div style="flex:1"></div>
      <button class="btn bs" onclick="ntExport()" title="현장 신규까지 한 줄씩 — 하단바·체크인 포함. 하단바 엑셀 올리기 양식도 이것">⬇ 명단 엑셀</button>
      ${ci ? '' : `<label class="btn bs" title="«명단 엑셀»에 하단바를 채워 올려요. 등록번호로 맞추고, 없으면 이메일·이름+소속으로">⬆ 하단바 엑셀
        <input type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="ntImportBars(this.files[0]);this.value=''"></label>`}
      ${wiTodo ? `<button class="btn bs" onclick="ntPromote()" title="현장 신규를 연락처·이 행사 참가 확정으로 — 같은 이메일이면 그 사람에 붙여요">현장 신규 ${wiTodo}명 마스터DB에</button>` : ''}
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
      <div style="flex:1"></div>
      ${ci ? '' : `<span class="nt-note" title="용지·글자 자리·기본 말·하단바 종류는 설정 › 행사 상세 › 네임택에서 정해요">판 ${t.width_mm} × ${t.height_mm}mm · ${escapeHtml((LANG_OPTIONS.find(o => o[0] === t.lang) || LANG_OPTIONS[0])[1].replace(/ \(.*\)/, ''))}${t.sheet === 'fit' ? '' : ' · A4 맨 위 가운데'}${t.id ? '' : ' (기본값)'}</span>
      <button class="btn bs" onclick="ntOpenEditor()" title="설정 › 행사 상세 › 네임택 — 용지 크기·글자 자리·배경·하단바 종류">판 고치기</button>
      <button class="btn bs" onclick="ntWalkIn(true)" title="명단에 없는 사람 — 뽑으면 체크인으로 남고, 나중에 마스터DB에 올려요">＋ 현장 신규</button>`}
    </div>
    <div class="sec-rows nt-layout">
      <div id="evdb-rows">${ntRowsHtml(ev.key, query)}</div>
      <div id="nt-side" class="nt-side">${ci ? checkinSideHtml() : sideHtml(ev.key)}</div>
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
  const who = (p) => `<td><span style="font-weight:600">${escapeHtml(p.nameKo || p.nameEn)}</span>${p.nameKo && p.nameEn && p.nameKo !== p.nameEn ? `<div style="font-size:var(--fs-10_5);color:var(--i4)">${escapeHtml(p.nameEn)}</div>` : ''}</td>
      <td>${escapeHtml(p.orgKo || p.orgEn)}</td>`;
  const got = (p) => { const d = done.get(p.key); return d ? `<span style="color:var(--g);font-weight:700">✓</span> ${kst(d.last)}${d.n > 1 ? ` · ${d.n}장` : ''}` : '<span style="color:var(--i5)">—</span>'; };
  const ckCell = (p) => { const c = nt.checkins.get(p.key);
    return c ? `<span style="color:var(--g);font-weight:700">✓</span> ${kst(c.checked_at)} <span class="nt-note">${c.via === 'print' ? '현장 출력' : '데스크'}</span>` : '<span style="color:var(--i5)">—</span>'; };
  const barCell = (p) => barTypes().length
    ? `<td onclick="event.stopPropagation()">${barSelect(barOf(p.key), `ntSetBar('${escAttr(p.key)}',this.value)`, `style="--c:${barType(barOf(p.key))?.color || 'transparent'}"`)}</td>`
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
    <div class="nt-fields">${f('name', '이름 *', true)}${f('company', '소속', true)}${f('job_title', '직함')}${f('badge', '구분')}
      ${barTypes().length ? `<label class="wide"><div class="mlbl">하단바 <span class="nt-note">· 비워 두고 나중에 채워도 돼요</span></div>${barSelect(w.bar, `ntWalkEdit('bar',this.value)`)}</label>` : ''}
      ${f('email', '이메일', false, 'email')}${f('phone', '전화')}</div>
    <div class="nt-note">명단에 없는 사람이에요. 뽑으면 체크인으로 남고, 행사가 끝난 뒤 «마스터DB에»로 연락처·참가 확정을 만들어요.</div>
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
    <span style="display:flex;gap:6px;align-items:center"><span class="when" title="${escAttr(p.printed_by || '')}">${kst(p.printed_at)}</span>
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

export function ntSetView(v){ nt.view = v === 'checkin' ? 'checkin' : 'issue'; nt.filter = 'todo'; nt.imp = null; rerender();
  if(nt.view === 'checkin') setTimeout(() => document.getElementById('evdb-q')?.focus(), 0); }
export function ntSetOnsite(v){ nt.onsite = v === 'on'; rerender(); }
export function ntSetFilter(v){ nt.filter = v; rerender(); }
export function ntSetSrc(v){ nt.src = v; rerender(); }
export function ntSetBarFil(v){ nt.barFil = v; rerender(); }
export function ntFocus(key){ nt.focus = key; nt.walkIn = null; nt.imp = null; rerender(); }
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
}
export function ntOpenEditor(){
  if(!nt.ev) return;
  window.switchArchTab?.('ev');
  window.openEvDetail?.(nt.ev);
  window.setEvDetailSeg?.('nametag');
}

/* 하단바 — 한 명 / 고른 사람 모두 */
async function saveBars(items, via){
  if(!items.length) return;
  nt.busy = true;
  try {
    const j = await saveNametagBars(nt.ev, items, via);
    (j.people || []).forEach(p => nt.people.set(p.person_key, p));
    return j;
  } catch(e){ alert('하단바를 저장하지 못했어요 — ' + e.message); }
  finally { nt.busy = false; }
}
export async function ntSetBar(key, bar){ await saveBars([{ person_key: key, bar }]); rerender(); }
export async function ntSetBarPicked(bar){
  const keys = nt.picked.size ? [...nt.picked] : nt.focus ? [nt.focus] : [];
  await saveBars(keys.map(k => ({ person_key: k, bar })));
  rerender();
}
export async function ntWalkContact(key, field, value){
  const p = nt.people.get(key) || {};
  try {
    const j = await saveWalkInContact(nt.ev, key, { email: field === 'email' ? value : p.email || '', phone: field === 'phone' ? value : p.phone || '' });
    nt.people.set(key, j.person);
  } catch(e){ alert('저장하지 못했어요 — ' + e.message); }
}

export async function ntPrint(){
  if(nt.busy) return;
  let cards;
  if(nt.walkIn){
    const w = nt.walkIn;
    if(!String(w.name || '').trim()) return alert('이름을 적어 주세요.');
    cards = [{ source: 'walk_in', name: w.name, company: w.company, job_title: w.job_title, badge: w.badge, bar: w.bar,
      email: w.email, phone: w.phone, lang: /[가-힣]/.test(w.name) ? 'ko' : 'en' }];
  } else {
    const list = targets(nt.ev);
    if(!list.length) return alert('뽑을 사람을 골라 주세요.');
    const done = printedMap();
    if(list.some(p => done.has(p.key)) && !nt.reason) return alert('이미 받은 사람이 있어요. 재발급 사유를 골라 주세요.');
    cards = list.map(p => ({ person_key: p.key, source: p.source, ref_id: p.ref_id, contact_id: p.contact_id, ...cardFor(p) }));
    if(cards.some(c => !String(c.name || '').trim())) return alert('이름이 빈 네임택이 있어요.');
  }
  /* 팝업 차단을 피하려면 누른 그 순간 창을 연다. 기록이 오면 그린다 */
  const w = openPrintWindow();
  if(!w) return alert('인쇄 창이 막혔어요. 브라우저 주소창 오른쪽에서 이 사이트의 팝업을 허용해 주세요.');
  nt.busy = true; rerender();
  try {
    const j = await issueNametags(nt.ev, cards, nt.reason || undefined, isOnsite());
    nt.prints = [...j.prints, ...nt.prints];
    (j.people || []).forEach(p => nt.people.set(p.person_key, p));
    (j.checkins || []).forEach(c => nt.checkins.set(c.person_key, c));
    await fillPrintWindow(w, nt.template, j.prints);
    nt.picked.clear(); nt.edits.clear(); nt.reason = ''; nt.walkIn = null;
  } catch(e){
    w.close();
    alert('발급하지 못했어요 — ' + e.message);
  } finally { nt.busy = false; rerender(); }
}

export async function ntVoid(id){
  const p = nt.prints.find(x => x.id === id);
  if(!p || !confirm(`${p.name} 님 네임택이 안 나왔다고 되돌릴까요?\n기록은 남고, 받은 수에서 빠져요. 체크인은 그대로예요.`)) return;
  try {
    const j = await voidNametag(id);
    nt.prints = nt.prints.map(x => x.id === id ? j.print : x);
  } catch(e){ alert('되돌리지 못했어요 — ' + e.message); }
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

/* ── 체크인 ── */
export async function ntCheckIn(key){
  if(nt.busy) return;
  nt.busy = true;
  try {
    const j = await checkInNametag(nt.ev, key);
    nt.checkins.set(key, j.checkin);
  } catch(e){ alert('체크인하지 못했어요 — ' + e.message); }
  nt.busy = false;
  refreshLists();
  const q = document.getElementById('evdb-q');
  if(q && nt.view === 'checkin'){ q.select(); q.focus(); }   // 다음 사람을 바로 찾게
  const side = document.getElementById('nt-side');
  if(side && nt.view === 'checkin') side.innerHTML = checkinSideHtml();
}
export async function ntUncheck(key){
  const c = nt.checkins.get(key), p = evPerson(key);
  if(!c || !confirm(`${p ? p.nameKo || p.nameEn : key} 님 체크인을 취소할까요? 기록은 남아요.`)) return;
  try { await voidCheckIn(c.id); nt.checkins.delete(key); }
  catch(e){ alert('취소하지 못했어요 — ' + e.message); }
  rerender();
}

/* ── 최종 등록자 명단 엑셀 — 하단바 엑셀 올리기 양식도 이것(등록번호 칸으로 맞춘다) ── */
const XCOLS = ['등록번호', '출처', '이름(국문)', '이름(영문)', '소속', '직함', '이메일', '구분', '하단바', '네임택', '마지막 발급', '체크인', '체크인 시각', '체크인 방법'];
export function ntExport(){
  if(!window.XLSX) return alert('엑셀 도구를 아직 못 불러왔어요. 잠시 뒤 다시 눌러 주세요.');
  const done = printedMap();
  const kstFull = (iso) => iso ? new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '';
  const rows = deskPeople(nt.ev).map(p => {
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
  const wi = walkInPeople(nt.prints, nt.people);
  if(!wi.length) return;
  const noMail = wi.filter(p => !p.email).length;
  if(!confirm(`현장 신규 ${wi.length}명을 마스터DB에 올릴까요?\n연락처를 만들고 이 행사 «참가자»로 확정해요. 같은 이메일이 있으면 그 사람에 붙여요.${noMail ? `\n이메일이 없는 ${noMail}명은 새 연락처로 만들어요.` : ''}`)) return;
  nt.busy = true; rerender();
  try {
    const j = await promoteWalkIns(nt.ev, wi.map(p => p.key));
    let made = 0;
    (j.promoted || []).forEach(r => {
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
    alert(`${(j.promoted || []).length}명을 올렸어요 — 새 연락처 ${made} · 기존 연락처에 붙임 ${(j.promoted || []).length - made}`);
  } catch(e){ alert('올리지 못했어요 — ' + e.message); }
  nt.busy = false; rerender();
}

Object.assign(window, { ntSetView, ntSetOnsite, ntSetFilter, ntSetSrc, ntSetBarFil, ntFocus, ntPick, ntPickAll, ntEdit, ntWalkIn, ntWalkEdit,
  ntSetReason, ntReload, ntOpenEditor, ntPrint, ntVoid, ntSetBar, ntSetBarPicked, ntWalkContact, ntCheckIn, ntUncheck,
  ntScanKey, ntExport, ntImportBars, ntImportApply, ntImportCancel, ntPromote });
