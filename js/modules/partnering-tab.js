/* ══════════════════════════════════════════════════════════════
   partnering-tab.js — 파트너링 (셀러·바이어 참가자)

   파트너링은 셀러와 바이어로 나뉜다. 섭외(전화·메일)는 컨택 탭의 차수
   («셀러 컨택», «바이어 컨택»)에서 하고, 이 탭의 첫 화면은 참가가 확정된
   사람의 명단이다.

   명단을 채우는 일도 이 화면 안에서 끝낸다 — 전에는 셀러·바이어를 넣으려면
   마스터DB(역할 붙이기) → 행사 탭(확정)으로 화면을 오가야 했다.
     참가자 명단       확정된 셀러·바이어
     확정 대기         셀러·바이어로는 있지만 아직 확정 전 → «참가 확정»
     셀러·바이어 지정   이 행사에 다른 역할(참가자·BD 등)로만 있는 사람 → «셀러로»/«바이어로»
     DB에서 찾아 넣기   마스터DB 전체에서 찾아 → «셀러로»/«바이어로»

   데이터는 participations 한 표다. 셀러·바이어는 그 행사 참가 기록의 역할(role),
   확정은 confirmed_at. 편을 가르는 기준은 constants.js의 PARTNERING_SIDES 한 곳이다.
   확정된 곳에 다시 연락할 일은 «컨택으로 보내기»로 차수 명단에 넣어 컨택 탭에서 한다.
═══════════════════════════════════════════════════════════════ */

import { EVENT_LIST, contacts, participations, evPartOn, hasLeft, PART_TYPES, syncPartColors, API_BASE_URL } from '../state.js';
import { PARTNERING_SIDES, PARTNERING_UNSIDED } from '../constants.js';
import { td, escapeHtml, escAttr, countryName, isMobile } from '../utils.js';
import { postToSheet, upsertPartTypeRow } from '../api.js';
import { sanitizeForCsv, trackAction } from './audit-tab.js';
import { normalizeCompanyKey, buildCoDB } from './company-tab.js';
import { coList, openSendToRound } from './contact-tab.js';

/* ── 모듈 상태 — 다른 탭이 알 필요가 없어 state.js로 올리지 않는다 ── */
let ptnEvent = '';
let ptnView = 'list';    // list | wait | assign | add
let ptnSide = '';        // '' | 'seller' | 'buyer' | 'none'(구분 없음) — 명단·확정 대기에서만
let ptnQuery = '';
let ptnConfirm = true;   // 지정·추가할 때 바로 참가 확정으로
const ptnPicked = new Set();   // 고른 줄의 key
const ADD_LIMIT = 100;   // DB에서 찾아 넣기 — 한 번에 보여 줄 사람 수

const VIEWS = [
  ['list',   '참가자 명단'],
  ['wait',   '확정 대기'],
  ['assign', '셀러·바이어 지정'],
  ['add',    'DB에서 찾아 넣기'],
];

const sideOf = (role) => (PARTNERING_SIDES.find(s => s.roles.includes(role)) || {}).key
  || (role === PARTNERING_UNSIDED ? 'none' : '');
const sideDef = (key) => PARTNERING_SIDES.find(s => s.key === key)
  || { key: 'none', label: '구분 없음', cls: 'p-gray', roles: [PARTNERING_UNSIDED] };

/* 파트너링 파트가 켜진 행사 — 최근 행사부터 */
const ptnEvents = () => EVENT_LIST.filter(e => evPartOn(e.key, 'partnering'))
  .sort((a, b) => String(b.date_start || b.date || '').localeCompare(String(a.date_start || a.date || '')));

/* ══════════════════════════════════════════
   집계 — 그 행사의 참가 기록을 사람별로 묶는다

   한 사람의 기록은 편(셀러·바이어·구분 없음)마다, 그리고 다른 역할(참가자·전시참가기업…)로
   나뉜다. 화면 넷이 이 하나를 나눠 쓴다. 연락처가 없는 옛 기록은 누구인지 몰라
   고를 수도 없어 뺀다.
══════════════════════════════════════════ */
function evIndex(evKey){
  const byId = new Map(contacts.map(c => [c.id, c]));
  const people = new Map();
  participations.forEach(p => {
    if(p.eventId !== evKey || p.contactId == null) return;
    const c = byId.get(p.contactId);
    if(!c) return;
    if(!people.has(c.id)) people.set(c.id, { c, sides: {}, others: new Set() });
    const m = people.get(c.id);
    const side = sideOf(p.role);
    if(!side){ if(p.role) m.others.add(p.role); return; }
    const s = m.sides[side] || (m.sides[side] = { parts: [], confirmedAt: '' });
    s.parts.push(p);
    // 한 줄이라도 확정이면 그 편으로는 온 것이다
    if(p.confirmedAt && !s.confirmedAt) s.confirmedAt = p.confirmedAt;
  });
  return people;
}

function mkRow(c, extra){
  const org = (c.orgKo || c.orgEn || '').trim();
  return {
    cid: c.id,
    name: c.nameKo || c.nameEn || '', nameEn: c.nameEn || '',
    org, orgEn: c.orgEn || '', orgKey: normalizeCompanyKey(org || c.orgEn),
    title: c.titleKo || c.titleEn || '', dept: c.deptKo || c.deptEn || '',
    country: c.country || '', email: c.email1 || c.email2 || '',
    phone: c.phone1 || c.phone2 || '', products: c.products || '',
    ...extra,
  };
}

const ORDER = ['seller', 'buyer', 'none'];
const bySideOrg = (a, b) => ORDER.indexOf(a.side) - ORDER.indexOf(b.side)
  || a.org.localeCompare(b.org) || a.name.localeCompare(b.name);

/* 화면마다의 줄 — key는 고르기에 쓴다(편이 다르면 같은 사람도 다른 줄) */
function rowsFor(view, evKey = ptnEvent){
  const idx = evIndex(evKey);
  const out = [];
  if(view === 'list' || view === 'wait'){
    idx.forEach(m => Object.entries(m.sides).forEach(([side, s]) => {
      if((view === 'list') !== !!s.confirmedAt) return;
      // 편을 모르는 확정 전 기록은 확정할 게 아니라 편부터 정할 일이다 — «셀러·바이어 지정»에
      if(view === 'wait' && side === 'none') return;
      out.push(mkRow(m.c, { key: `${side}|${m.c.id}`, side, confirmedAt: s.confirmedAt, roles: [...m.others] }));
    }));
    return out.sort(bySideOrg);
  }
  if(view === 'assign'){
    // 이 행사에 있지만 셀러·바이어 어느 쪽도 아닌 사람(«구분 없음»도 여기서 정한다)
    idx.forEach(m => {
      if(m.sides.seller || m.sides.buyer) return;
      const roles = [...m.others, ...(m.sides.none ? [PARTNERING_UNSIDED] : [])];
      if(hasLeft(m.c)) return;
      out.push(mkRow(m.c, { key: `a|${m.c.id}`, side: '', roles }));
    });
    return out.sort((a, b) => a.org.localeCompare(b.org) || a.name.localeCompare(b.name));
  }
  // add — 마스터DB 전체. 이미 셀러이자 바이어인 사람, 퇴사자는 뺀다. 검색해야 보인다
  const q = ptnQuery.trim().toLowerCase();
  if(!q) return [];
  contacts.forEach(c => {
    if(hasLeft(c)) return;
    const m = idx.get(c.id);
    if(m && m.sides.seller && m.sides.buyer) return;
    const r = mkRow(c, { key: `n|${c.id}`, side: '',
      roles: m ? [...m.others, ...Object.keys(m.sides).map(k => sideDef(k).label)] : [] });
    if(matchQ(r, q)) out.push(r);
  });
  return out.sort((a, b) => a.org.localeCompare(b.org) || a.name.localeCompare(b.name));
}

const matchQ = (r, q) => [r.name, r.nameEn, r.org, r.orgEn, r.title, r.email, r.products, countryName(r.country)]
  .some(v => String(v || '').toLowerCase().includes(q));

const orgCount = (rows) => new Set(rows.map(r => r.orgKey || `?${r.cid}`)).size;

function shownRows(view = ptnView){
  let l = rowsFor(view);
  if((view === 'list' || view === 'wait') && ptnSide) l = l.filter(r => r.side === ptnSide);
  const q = ptnQuery.trim().toLowerCase();
  if(q && view !== 'add') l = l.filter(r => matchQ(r, q));
  return l;
}

/* ══════════════════════════════════════════
   사이드바 — 행사 목록 + 셀러/바이어
══════════════════════════════════════════ */
export function buildPtnSidebar(){
  const evEl = document.getElementById('ptn-ev-list');
  const sideEl = document.getElementById('ptn-side-list');
  if(!evEl || !sideEl) return;

  const evs = ptnEvents();
  if(!evs.length){
    ptnEvent = '';
    evEl.innerHTML = `<div style="font-size:11px;color:var(--i4);padding:8px 4px;line-height:1.5">
      파트너링을 하는 행사가 없어요.<br>설정 › 행사 관리에서 파트너링 파트를 켜 주세요.</div>`;
    sideEl.innerHTML = '';
    return;
  }
  if(!evs.some(e => e.key === ptnEvent)) ptnEvent = evs[0].key;

  evEl.innerHTML = evs.map(e => {
    const n = rowsFor('list', e.key).length;
    return `<button class="nr${e.key === ptnEvent ? ' on' : ''}" onclick="setPtnEvent('${escAttr(e.key)}')">
      <span style="width:8px;height:8px;border-radius:50%;background:${escAttr(e.color || '#9C9890')};flex-shrink:0"></span>
      ${escapeHtml(e.short || e.name || e.key)}
      <span class="nbg">${n}</span></button>`;
  }).join('');

  const rows = rowsFor('list');
  const nr = (key, label, n) => `<button class="nr${ptnSide === key ? ' on' : ''}" onclick="setPtnSide('${key}')">
    ${label}<span class="nbg">${n}</span></button>`;
  const unsided = rows.filter(r => r.side === 'none').length;
  sideEl.innerHTML = nr('', '전체', rows.length)
    + PARTNERING_SIDES.map(s => nr(s.key, s.label, rows.filter(r => r.side === s.key).length)).join('')
    + (unsided ? nr('none', '구분 없음', unsided) : '');
}

export function setPtnEvent(key){
  ptnEvent = key; ptnSide = ''; ptnQuery = ''; ptnView = 'list';
  ptnPicked.clear();   // 이전 행사에서 고른 줄이 다른 행사의 일에 섞이지 않게
  clearSearchBoxes();
  buildPtnSidebar();
  renderPtn();
}
/* 편을 바꾸면 고른 줄을 푼다 — 안 보이는 줄이 골라진 채 남으면 보내기·내보내기가 엉뚱해진다.
   사이드바의 편은 명단을 거르는 것이라 명단 화면으로 돌아간다 */
export function setPtnSide(key){
  ptnSide = key; ptnPicked.clear();
  if(ptnView !== 'list' && ptnView !== 'wait') ptnView = 'list';
  buildPtnSidebar(); renderPtn();
}
export function setPtnView(v){
  if(ptnView === v) return;
  ptnView = v; ptnPicked.clear();
  // 찾아 넣기는 검색어로 사람을 찾는 화면이다 — 다른 화면의 거르는 말을 끌고 가지 않는다
  ptnQuery = ''; clearSearchBoxes();
  renderPtn();
  if(v === 'add') document.getElementById(isMobile() ? 'ptn-q-m' : 'ptn-q')?.focus();
}
export function setPtnQuery(v){ ptnQuery = v; renderPtnRows(); }
export function setPtnConfirm(on){ ptnConfirm = !!on; }
function clearSearchBoxes(){
  ['ptn-q', 'ptn-q-m'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
}

/* ══════════════════════════════════════════
   본문
══════════════════════════════════════════ */
export function renderPtn(){
  const body = document.getElementById('ptn-body');
  if(!body) return;
  const ev = EVENT_LIST.find(e => e.key === ptnEvent);
  const ttl = document.getElementById('ptn-ttl');
  const evName = ev ? (ev.short || ev.name || ev.key) : '';
  if(ttl) ttl.innerHTML = `파트너링 <span class="tb-s">${evName ? escapeHtml(evName) + ' · ' : ''}셀러·바이어 참가자</span>`;
  const q = document.getElementById('ptn-q');
  if(q) q.placeholder = ptnView === 'add' ? '마스터DB에서 이름·기업·국가·이메일로 찾기…' : '기업·이름·국가·이메일 검색…';
  if(!ev){
    body.innerHTML = '<div style="font-size:12px;color:var(--i4);padding:24px 16px">파트너링을 하는 행사가 없어요.</div>';
    return;
  }

  const list = rowsFor('list');
  const card = (s) => {
    const l = list.filter(r => r.side === s.key);
    return `<div style="flex:1;min-width:150px;background:var(--W);border:1px solid var(--i6);border-radius:8px;padding:10px 14px">
      <div style="display:flex;align-items:center;gap:6px"><span class="pill ${escAttr(s.cls)}">${escapeHtml(s.label)}</span></div>
      <div style="font-size:20px;font-weight:700;color:var(--i1);margin-top:6px">${orgCount(l)}<span style="font-size:12px;font-weight:600;color:var(--i3)">개사</span>
        <span style="font-size:13px;font-weight:600;color:var(--i3);margin-left:4px">${l.length}명</span></div>
    </div>`;
  };
  const counts = { list: list.length, wait: rowsFor('wait').length, assign: rowsFor('assign').length };
  const noneN = list.filter(r => r.side === 'none').length;

  body.innerHTML = `${partTypeNoticeHtml()}
    <div style="padding:12px 16px 0;display:flex;gap:10px;flex-wrap:wrap">
      ${PARTNERING_SIDES.map(card).join('')}
    </div>
    <div style="padding:12px 16px 0"><div class="seg" style="flex-wrap:wrap">
      ${VIEWS.map(([k, label]) => `<button class="seg-b${ptnView === k ? ' on' : ''}" onclick="setPtnView('${k}')">${
        k === 'add' ? '+ ' : ''}${label}${k in counts ? ` ${counts[k]}` : ''}</button>`).join('')}
    </div></div>
    ${noneN && ptnView === 'list' ? `<div style="padding:8px 16px 0;font-size:11px;color:var(--am)">
      «${escapeHtml(PARTNERING_UNSIDED)}»로만 적혀 셀러·바이어를 모르는 참가자가 ${noneN}명 있어요 —
      «셀러·바이어 지정»에서 정해 주세요.</div>` : ''}
    <div style="padding:10px 16px 0;font-size:11px;color:var(--i4)">${viewHint(counts)}</div>
    <div style="padding:10px 16px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">${actionsHtml()}</div>
    <div id="ptn-rows" style="padding:8px 16px 40px">${rowsHtml()}</div>`;
}

/* 화면마다 한 줄 설명 — 무엇을 하는 곳인지 */
function viewHint(counts){
  if(ptnView === 'list') return counts.wait
    ? `참가가 확정된 셀러·바이어예요. 확정 전인 ${counts.wait}명은 «확정 대기»에 있어요.`
    : '참가가 확정된 셀러·바이어예요.';
  if(ptnView === 'wait') return '셀러·바이어로 넣었지만 아직 확정 전인 사람이에요. 참가가 정해지면 골라서 «참가 확정»을 누르세요.';
  if(ptnView === 'assign') return '이 행사에 다른 역할(참가자·BD 등)로만 들어 있는 사람이에요. 골라서 셀러나 바이어로 정하세요.';
  return '마스터DB 전체에서 찾아요. 위 검색창에 이름·기업·국가를 넣고, 골라서 셀러나 바이어로 넣으세요.';
}

function actionsHtml(){
  const sel = `<button class="btn" style="font-size:11px" onclick="togglePtnAll()">전체 선택/해제</button>
    <span id="ptn-picked-n" style="font-size:11px;color:var(--i4)">${pickedLabel()}</span>
    <div style="flex:1"></div>`;
  if(ptnView === 'list') return sel + `<button class="btn bp" style="font-size:11px" onclick="sendPtnToContact()"
    title="고른 사람의 기업을 컨택 차수 명단에 넣어요. 안 고르면 지금 보이는 전부">컨택으로 보내기</button>`;
  if(ptnView === 'wait') return sel + `<button class="btn" style="font-size:11px" onclick="sendPtnToContact()"
    title="고른 사람의 기업을 컨택 차수 명단에 넣어요">컨택으로 보내기</button>
    <button class="btn bp" style="font-size:11px" onclick="confirmPtnPicked()">참가 확정</button>`;
  return sel + `<label style="display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--i2);cursor:pointer">
      <input type="checkbox" ${ptnConfirm ? 'checked' : ''} onchange="setPtnConfirm(this.checked)">참가 확정으로</label>
    ${PARTNERING_SIDES.map(s => `<button class="btn bp" style="font-size:11px" onclick="assignPtnPicked('${s.key}')">${escapeHtml(s.label)}로 넣기</button>`).join('')}`;
}

function renderPtnRows(){
  const el = document.getElementById('ptn-rows');
  if(el) el.innerHTML = rowsHtml();
}

const pickedLabel = () => (ptnPicked.size ? `${ptnPicked.size}명 선택` : '');
const setPickedLabel = () => { const n = document.getElementById('ptn-picked-n'); if(n) n.textContent = pickedLabel(); };
/* 체크 하나에 다시 그리면 긴 목록의 스크롤이 튄다 — 숫자만 고친다 */
export function pickPtn(key, on){
  on ? ptnPicked.add(key) : ptnPicked.delete(key);
  setPickedLabel();
}
/* 지금 보이는 줄이 다 골라져 있으면 풀고, 아니면 다 고른다 */
export function togglePtnAll(){
  const l = shownRows().slice(0, ptnView === 'add' ? ADD_LIMIT : undefined);
  const all = l.length && l.every(r => ptnPicked.has(r.key));
  l.forEach(r => (all ? ptnPicked.delete(r.key) : ptnPicked.add(r.key)));
  renderPtnRows();
  setPickedLabel();
}
/* 내보내기·보내기 대상 — 고른 줄이 있으면 그것만, 없으면 지금 보이는 전부 */
function targetRows(){
  const l = shownRows();
  return ptnPicked.size ? l.filter(r => ptnPicked.has(r.key)) : l;
}

const sideBadge = (r) => { const s = sideDef(r.side); return `<span class="pill ${escAttr(s.cls)}">${escapeHtml(s.label)}</span>`; };
const roleBadges = (r) => (r.roles || []).map(v => `<span class="pill p-gray" style="margin-right:3px">${escapeHtml(v)}</span>`).join('')
  || '<span style="font-size:10.5px;color:var(--i5)">이 행사 기록 없음</span>';
const pickBox = (r) => `<input type="checkbox" ${ptnPicked.has(r.key) ? 'checked' : ''} onchange="pickPtn('${escAttr(r.key)}',this.checked)">`;

function emptyHtml(){
  const msg = {
    list: '아직 참가가 확정된 셀러·바이어가 없어요.',
    wait: '확정을 기다리는 셀러·바이어가 없어요.',
    assign: '이 행사에 다른 역할로만 들어 있는 사람이 없어요.',
    add: ptnQuery.trim() ? '찾는 사람이 없어요.' : '위 검색창에 이름·기업·국가를 넣으면 마스터DB에서 찾아 드려요.',
  }[ptnView];
  /* 명단이 비었으면 어디서 채우는지 바로 잇는다 */
  const go = ptnView === 'list' && !ptnQuery.trim() && !ptnSide
    ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        ${rowsFor('wait').length ? `<button class="btn" onclick="setPtnView('wait')">확정 대기 ${rowsFor('wait').length}명 보기</button>` : ''}
        ${rowsFor('assign').length ? `<button class="btn" onclick="setPtnView('assign')">이 행사 참여자 ${rowsFor('assign').length}명 중에서 고르기</button>` : ''}
        <button class="btn bp" onclick="setPtnView('add')">+ DB에서 찾아 넣기</button></div>`
    : '';
  return `<div style="font-size:12px;color:var(--i4);padding:20px 0">${msg}${go}</div>`;
}

function rowsHtml(){
  let l = shownRows();
  if(!l.length) return emptyHtml();
  const more = ptnView === 'add' && l.length > ADD_LIMIT ? l.length - ADD_LIMIT : 0;
  if(more) l = l.slice(0, ADD_LIMIT);
  const tail = more ? `<div style="font-size:11px;color:var(--i4);padding:8px 0">${more}명 더 있어요 — 검색어를 좁혀 주세요.</div>` : '';
  const isList = ptnView === 'list' || ptnView === 'wait';
  const lead = (r) => (isList ? sideBadge(r) : roleBadges(r));

  // 좁은 화면에서는 표가 옆으로 넘쳐 읽을 수 없다 — 카드로 바꿔 준다
  if(isMobile()) return l.map(r => `<label style="display:block;background:var(--W);border:1px solid var(--i6);border-radius:8px;padding:10px 12px;margin-bottom:6px">
    <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">${pickBox(r)}${lead(r)}
      <span style="font-size:13px;font-weight:600;color:var(--i1)">${escapeHtml(r.org || '소속 없음')}</span></div>
    <div style="font-size:11.5px;color:var(--i2);margin-top:4px">${escapeHtml(r.name)}${r.title ? ' · ' + escapeHtml(r.title) : ''}</div>
    <div style="font-size:10.5px;color:var(--i4);margin-top:2px">${escapeHtml(countryName(r.country) || '')}${r.email ? ' · ' + escapeHtml(r.email) : ''}</div>
  </label>`).join('') + tail;

  return `<div style="overflow-x:auto"><table style="width:100%">
    <thead><tr>
      <th style="width:26px"></th><th style="width:${isList ? 70 : 150}px">${isList ? '구분' : '이 행사 역할'}</th>
      <th>기업·기관</th><th>국가</th><th>성명</th><th>직함</th><th>이메일</th>
      ${ptnView === 'list' ? '<th>연락처</th><th style="width:90px">확정일</th>' : ''}
    </tr></thead><tbody>
    ${l.map(r => `<tr>
      <td style="text-align:center">${pickBox(r)}</td>
      <td>${lead(r)}</td>
      <td><span style="font-weight:600">${escapeHtml(r.org)}</span>${r.orgEn && r.orgEn !== r.org ? `<div style="font-size:10.5px;color:var(--i4)">${escapeHtml(r.orgEn)}</div>` : ''}</td>
      <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(countryName(r.country) || '')}</td>
      <td>${escapeHtml(r.name)}${r.nameEn && r.nameEn !== r.name ? `<div style="font-size:10.5px;color:var(--i4)">${escapeHtml(r.nameEn)}</div>` : ''}</td>
      <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(r.title)}</td>
      <td style="font-size:11px;color:var(--i4)">${escapeHtml(r.email)}</td>
      ${ptnView === 'list' ? `<td style="font-size:11px;color:var(--i4)">${escapeHtml(r.phone)}</td>
      <td style="font-size:11px;color:var(--i4)">${escapeHtml(String(r.confirmedAt).slice(0, 10))}</td>` : ''}
    </tr>`).join('')}
    </tbody></table></div>` + tail;
}

/* ══════════════════════════════════════════
   저장 — 참가 기록을 한 번에 올린다

   새 줄과 고친 줄을 batchUpsert 한 번으로 보낸다(위치 배열 — 시트 순서 그대로,
   맨 뒤가 확정 날짜). 실패하면 화면에서 바꾼 것을 모두 되돌린다.
══════════════════════════════════════════ */
async function saveParts(changes, what){
  if(!changes.length) return true;
  const res = await postToSheet({
    sheet: 'participations', action: 'batchUpsert',
    rows: changes.map(({ p }) => [p.id, p.eventId, '', p.contactId, '', '', '',
      p.role || '', p.note || '', p.matched || '', p.confirmedAt || '']),
  }, what);
  if(!res.ok){
    changes.forEach(({ p, before }) => {
      if(before) Object.assign(p, before);
      else { const k = participations.indexOf(p); if(k >= 0) participations.splice(k, 1); }
    });
    afterSave();
    alert('저장에 실패해서 되돌렸어요. 네트워크를 확인하고 다시 해주세요.');
    return false;
  }
  return true;
}
/* 참가 기록을 보는 다른 화면(행사 참여자·기업 행사 이력)도 다시 세게 한다 */
function afterSave(){
  window.invalidateEvRows?.();
  try { buildCoDB(); } catch(e){}
  buildPtnSidebar();
  renderPtn();
}

/* 확정 대기 → 참가 확정. 그 편의 기록이 여러 줄이면 다 확정한다 */
export async function confirmPtnPicked(){
  const l = shownRows().filter(r => ptnPicked.has(r.key));
  if(!l.length){ alert('확정할 사람을 골라주세요.'); return; }
  const idx = evIndex(ptnEvent);
  const when = td();
  const changes = [];
  l.forEach(r => (idx.get(r.cid)?.sides[r.side]?.parts || []).forEach(p => {
    changes.push({ p, before: { confirmedAt: p.confirmedAt || '' } });
    p.confirmedAt = when;
  }));
  ptnPicked.clear();
  afterSave();
  if(!await saveParts(changes, '참가 확정')) return;
  trackAction('edit', '참가 확정', l.length + '명',
    `${escapeHtml(ptnEvent)} 파트너링 ${l.length}명 참가 확정`,
    { table: 'participations', op: 'update-many',
      rows: changes.map(({ p, before }) => ({ row: p.id, before: { confirmed_at: before.confirmedAt }, after: { confirmed_at: when } })) });
}

/* 셀러로/바이어로 넣기 — 지정·찾아 넣기 공통.
   그 행사에 «비즈니스파트너링»(편 모름) 기록이 있으면 그 줄의 역할을 바꾸고,
   없으면 새 줄을 더한다. 다른 역할(참가자·전시참가기업…)은 그대로 둔다 —
   전시 참가사가 파트너링에는 셀러로 오는 일이 흔하다(행사 화면은 사람 단위로
   접으므로 참가자 수는 부풀지 않는다). */
export async function assignPtnPicked(side){
  const l = shownRows().filter(r => ptnPicked.has(r.key));
  if(!l.length){ alert('넣을 사람을 골라주세요.'); return; }
  const s = sideDef(side);
  const role = s.roles[0];
  const when = ptnConfirm ? td() : '';
  const idx = evIndex(ptnEvent);
  const changes = [];
  let skipped = 0;
  l.forEach((r, i) => {
    const m = idx.get(r.cid);
    if(m && m.sides[side]){ skipped++; return; }   // 이미 그 편이다
    const unsided = m && m.sides.none && m.sides.none.parts[0];
    if(unsided){
      changes.push({ p: unsided, before: { role: unsided.role, confirmedAt: unsided.confirmedAt || '' } });
      unsided.role = role;
      if(when) unsided.confirmedAt = when;
      return;
    }
    const p = { id: `P-${Date.now()}-${i}`, eventId: ptnEvent, event: ptnEvent, contactId: r.cid, contact: '',
      role, note: '', matched: '✅ 파트너링에서 추가', confirmedAt: when };
    participations.push(p);
    changes.push({ p, before: null });
  });
  if(!changes.length){ alert(`고른 사람은 이미 ${s.label}예요.`); return; }
  ptnPicked.clear();
  afterSave();
  if(!await saveParts(changes, `파트너링 ${s.label} 추가`)) return;
  trackAction('add', `파트너링 ${s.label} 추가`, changes.length + '명',
    `${escapeHtml(ptnEvent)}에 ${changes.length}명을 ${escapeHtml(s.label)}(으)로${when ? ' 참가 확정해' : ''} 넣음${skipped ? ` · 이미 ${escapeHtml(s.label)}인 ${skipped}명은 건너뜀` : ''}`,
    { table: 'participations', op: 'update-many',
      rows: changes.map(({ p, before }) => ({ row: p.id, before: before || null, after: { role: p.role, confirmed_at: p.confirmedAt || '' } })) });
}

/* ══════════════════════════════════════════
   참가 유형에 «셀러»가 없을 때 — 운영은 서버의 목록을 읽어서, 코드 기본값에
   셀러를 더해도 다른 화면(업로드·연락처 행사 추가)의 선택지에는 안 나온다.
   설정까지 가지 않게 여기서 한 번에 더한다.
══════════════════════════════════════════ */
function partTypeNoticeHtml(){
  const miss = PARTNERING_SIDES.flatMap(s => s.roles).filter(k => !PART_TYPES.some(t => t.key === k));
  if(!miss.length) return '';
  return `<div style="margin:12px 16px 0;padding:9px 12px;background:var(--ab);border:1px solid #FDE68A;border-radius:8px;
      display:flex;align-items:center;gap:9px;font-size:11.5px;color:var(--am);flex-wrap:wrap">
    <span style="flex:1;min-width:200px">참가 유형에 «${miss.map(escapeHtml).join('»·«')}»가 없어요 — 업로드·연락처 화면에서 고를 수 없어요.</span>
    <button class="btn bs" onclick="addPtnPartTypes()">지금 추가</button></div>`;
}
export async function addPtnPartTypes(){
  const add = PARTNERING_SIDES.filter(s => !PART_TYPES.some(t => t.key === s.roles[0]))
    .map(s => ({ key: s.roles[0], label: s.roles[0], cls: s.cls }));
  if(!add.length) return;
  add.forEach(t => PART_TYPES.push(t));
  syncPartColors();
  renderPtn();
  if(!API_BASE_URL) return;   // 테스트 모드 — 보낼 서버가 없다
  for(const t of add){
    const r = await upsertPartTypeRow(t);
    if(!r || !r.ok){
      add.forEach(x => { const k = PART_TYPES.indexOf(x); if(k >= 0) PART_TYPES.splice(k, 1); });
      renderPtn();
      return;
    }
  }
  trackAction('add', '참가 유형 추가', add.map(t => t.key).join(', '),
    `파트너링 화면에서 참가 유형 <b>${add.map(t => escapeHtml(t.key)).join(', ')}</b> 추가`,
    { table: 'part_types', op: 'create', rows: add.map(t => ({ row: t.key, after: t })) });
}

/* ── 컨택으로 보내기 ──
   컨택 차수의 명단은 기업 단위다(기업DB의 기업 id). 사람에서 그 사람이 속한 기업을
   찾아 넘기고, 창은 기업DB의 «컨택 명단에 넣기»를 같이 쓴다 — 차수 고르기·이미 든 곳
   빼기·명단 이름이 한 곳에서 정해진다. 기업DB에 없는 기업은 넣을 수 없어 이름을 밝힌다. */
export function sendPtnToContact(){
  const l = targetRows();
  if(!l.length){ alert('보낼 참가자가 없어요.'); return; }
  const coOfCid = new Map();
  coList().forEach(co => (co.contacts || []).forEach(p => coOfCid.set(String(p.id), co.key)));
  const keys = [], missing = new Set();
  l.forEach(r => {
    const k = r.cid != null ? coOfCid.get(String(r.cid)) : null;
    k ? keys.push(k) : missing.add(r.org || r.name || '(이름 없음)');
  });
  const miss = [...missing];
  const note = miss.length ? `기업DB에 없는 ${miss.length}곳은 빠져요 — ${miss.slice(0, 3).join(', ')}${miss.length > 3 ? ' 외' : ''}` : '';
  if(!keys.length){ alert(`고른 참가자의 기업이 기업DB에 없어 컨택 명단에 넣을 수 없어요.\n${note}`); return; }
  const sides = [...new Set(l.map(r => r.side))];
  const label = '파트너링' + (sides.length === 1 ? ' ' + sideDef(sides[0]).label : '');
  openSendToRound(keys, label, { from: '파트너링에서 고른', ev: ptnEvent, note });
}

/* ── 명단 내보내기 — 참가자 명단·확정 대기에서 고른 줄, 없으면 지금 보이는 것 ── */
export function exportPtn(){
  if(ptnView !== 'list' && ptnView !== 'wait'){ setPtnView('list'); }
  const l = targetRows();
  if(!l.length){ alert('내보낼 명단이 없어요.'); return; }
  const ev = EVENT_LIST.find(e => e.key === ptnEvent);
  const head = ['구분', '참가', '기업·기관', '기업 영문', '국가', '성명', '영문명', '부서', '직함', '이메일', '연락처', '확정일'];
  const body = l.map(r => [sideDef(r.side).label, r.confirmedAt ? '확정' : '대기', r.org, r.orgEn, countryName(r.country) || '',
    r.name, r.nameEn, r.dept, r.title, r.email, r.phone, r.confirmedAt]);
  const csv = [head, ...body]
    .map(row => row.map(v => '"' + sanitizeForCsv(v).replace(/"/g, '""') + '"').join(','))
    .join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv);
  const side = ptnSide ? '_' + sideDef(ptnSide).label : '';
  a.download = ((ev && (ev.short || ev.name)) || ptnEvent) + '_파트너링' + side + '_' + td() + '.csv';
  a.click();
}

export function initPtnTab(){
  buildPtnSidebar();
  renderPtn();
}

Object.assign(window, {
  setPtnEvent, setPtnSide, setPtnView, setPtnQuery, setPtnConfirm, exportPtn,
  pickPtn, togglePtnAll, sendPtnToContact, confirmPtnPicked, assignPtnPicked, addPtnPartTypes,
  renderPtn,   // 모바일/데스크톱 경계를 넘으면 app.js가 다시 그린다
});
