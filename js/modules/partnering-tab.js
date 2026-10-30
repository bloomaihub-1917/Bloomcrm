/* ══════════════════════════════════════════════════════════════
   partnering-tab.js — 파트너링 (셀러·바이어 참가자)

   파트너링은 셀러와 바이어로 나뉜다. 섭외(전화·메일)는 컨택 탭의 차수
   («셀러 컨택», «바이어 컨택»)에서 하고, 이 탭은 참가가 확정된 사람의 명단만
   보여준다 — 아직 확정 전인 타겟은 여기 나오지 않는다.
   확정된 곳에 다시 연락할 일(일정 안내·매칭 결과 전달)은 «컨택으로 보내기»로
   고른 기업을 차수 명단에 넣어 컨택 탭에서 한다.

   데이터는 새로 만들지 않는다. participations에서 파트너링 파트가 켜진 행사의
   확정(confirmedAt) 기록을 골라, 역할(role)로 셀러·바이어를 가른다.
   편을 가르는 기준은 constants.js의 PARTNERING_SIDES 한 곳이다.
═══════════════════════════════════════════════════════════════ */

import { EVENT_LIST, contacts, participations, evPartOn } from '../state.js';
import { PARTNERING_SIDES, PARTNERING_UNSIDED } from '../constants.js';
import { td, escapeHtml, escAttr, countryName, isMobile } from '../utils.js';
import { sanitizeForCsv } from './audit-tab.js';
import { normalizeCompanyKey } from './company-tab.js';
import { coList, openSendToRound } from './contact-tab.js';

/* ── 모듈 상태 — 다른 탭이 알 필요가 없어 state.js로 올리지 않는다 ── */
let ptnEvent = '';
let ptnSide = '';        // '' | 'seller' | 'buyer' | 'none'(구분 없음)
let ptnQuery = '';
const ptnPicked = new Set();   // 고른 줄의 key — 내보내기·컨택으로 보내기가 이것만 쓴다

const sideOf = (role) => (PARTNERING_SIDES.find(s => s.roles.includes(role)) || {}).key
  || (role === PARTNERING_UNSIDED ? 'none' : '');
const sideDef = (key) => PARTNERING_SIDES.find(s => s.key === key)
  || { key: 'none', label: '구분 없음', cls: 'p-gray' };

/* 파트너링 파트가 켜진 행사 — 최근 행사부터 */
const ptnEvents = () => EVENT_LIST.filter(e => evPartOn(e.key, 'partnering'))
  .sort((a, b) => String(b.date_start || b.date || '').localeCompare(String(a.date_start || a.date || '')));

/* ══════════════════════════════════════════
   집계 — 편마다 사람 단위로 접는다

   한 사람이 같은 편으로 두 줄 들어와도 한 명이다. 셀러이자 바이어인 사람은
   양쪽에 한 번씩 나온다(드물지만 그런 기업이 있다).
   타겟(미확정)은 명단에 넣지 않고 수만 센다 — 왜 안 보이는지 밝히려고.
══════════════════════════════════════════ */
function ptnRows(evKey){
  const byId = new Map(contacts.map(c => [c.id, c]));
  const map = new Map();
  const pending = { seller: new Set(), buyer: new Set(), none: new Set() };

  participations.filter(p => p.eventId === evKey).forEach(p => {
    const side = sideOf(p.role);
    if(!side) return;
    const who = p.contactId != null ? `c${p.contactId}` : `p${p.id}`;
    if(!p.confirmedAt){ pending[side].add(who); return; }
    const key = `${side}|${who}`;
    if(!map.has(key)){
      const c = byId.get(p.contactId) || {};
      const org = (c.orgKo || c.orgEn || '').trim();
      map.set(key, {
        key, side, cid: c.id,
        name: c.nameKo || c.nameEn || p.contact || '', nameEn: c.nameEn || '',
        org, orgEn: c.orgEn || '', orgKey: normalizeCompanyKey(org || c.orgEn),
        title: c.titleKo || c.titleEn || '', dept: c.deptKo || c.deptEn || '',
        country: c.country || '', email: c.email1 || c.email2 || '',
        phone: c.phone1 || c.phone2 || '', products: c.products || '',
        confirmedAt: p.confirmedAt,
      });
    }
  });
  /* 확정된 사람은 타겟 수에서 뺀다 — 한 줄은 확정, 한 줄은 아직인 경우 */
  map.forEach(r => pending[r.side].delete(r.cid != null ? `c${r.cid}` : ''));

  const order = ['seller', 'buyer', 'none'];
  const rows = [...map.values()].sort((a, b) => order.indexOf(a.side) - order.indexOf(b.side)
    || a.org.localeCompare(b.org) || a.name.localeCompare(b.name));
  return { rows, pending };
}

const orgCount = (rows) => new Set(rows.map(r => r.orgKey || `?${r.cid}`)).size;

function shownRows(rows){
  let l = ptnSide ? rows.filter(r => r.side === ptnSide) : rows;
  const q = ptnQuery.trim().toLowerCase();
  if(q) l = l.filter(r => [r.name, r.nameEn, r.org, r.orgEn, r.title, r.email, r.products, countryName(r.country)]
    .some(v => String(v || '').toLowerCase().includes(q)));
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
    const n = ptnRows(e.key).rows.length;
    return `<button class="nr${e.key === ptnEvent ? ' on' : ''}" onclick="setPtnEvent('${escAttr(e.key)}')">
      <span style="width:8px;height:8px;border-radius:50%;background:${escAttr(e.color || '#9C9890')};flex-shrink:0"></span>
      ${escapeHtml(e.short || e.name || e.key)}
      <span class="nbg">${n}</span></button>`;
  }).join('');

  const { rows } = ptnRows(ptnEvent);
  const nr = (key, label, n) => `<button class="nr${ptnSide === key ? ' on' : ''}" onclick="setPtnSide('${key}')">
    ${label}<span class="nbg">${n}</span></button>`;
  const unsided = rows.filter(r => r.side === 'none').length;
  sideEl.innerHTML = nr('', '전체', rows.length)
    + PARTNERING_SIDES.map(s => nr(s.key, s.label, rows.filter(r => r.side === s.key).length)).join('')
    + (unsided ? nr('none', '구분 없음', unsided) : '');
}

export function setPtnEvent(key){
  ptnEvent = key; ptnSide = ''; ptnQuery = '';
  ptnPicked.clear();   // 이전 행사에서 고른 줄이 다른 행사의 보내기에 섞이지 않게
  ['ptn-q', 'ptn-q-m'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  buildPtnSidebar();
  renderPtn();
}
/* 편을 바꾸면 고른 줄을 푼다 — 안 보이는 줄이 골라진 채 남으면 보내기·내보내기가 엉뚱해진다 */
export function setPtnSide(key){ ptnSide = key; ptnPicked.clear(); buildPtnSidebar(); renderPtn(); }
export function setPtnQuery(v){ ptnQuery = v; renderPtnRows(); }

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
  if(!ev){
    body.innerHTML = '<div style="font-size:12px;color:var(--i4);padding:24px 16px">파트너링을 하는 행사가 없어요.</div>';
    return;
  }

  const { rows, pending } = ptnRows(ev.key);
  const card = (s) => {
    const l = rows.filter(r => r.side === s.key);
    return `<div style="flex:1;min-width:150px;background:var(--W);border:1px solid var(--i6);border-radius:8px;padding:10px 14px">
      <div style="display:flex;align-items:center;gap:6px"><span class="pill ${escAttr(s.cls)}">${escapeHtml(s.label)}</span></div>
      <div style="font-size:20px;font-weight:700;color:var(--i1);margin-top:6px">${orgCount(l)}<span style="font-size:12px;font-weight:600;color:var(--i3)">개사</span>
        <span style="font-size:13px;font-weight:600;color:var(--i3);margin-left:4px">${l.length}명</span></div>
    </div>`;
  };
  /* 타겟은 컨택에서 진행 중이다 — 명단에 없는 이유를 한 줄로 밝힌다 */
  const pend = PARTNERING_SIDES.map(s => pending[s.key].size ? `${s.label} ${pending[s.key].size}명` : '').filter(Boolean);
  const noneN = rows.filter(r => r.side === 'none').length;

  body.innerHTML = `<div style="padding:12px 16px 0;display:flex;gap:10px;flex-wrap:wrap">
      ${PARTNERING_SIDES.map(card).join('')}
    </div>
    ${pend.length ? `<div style="padding:8px 16px 0;font-size:11px;color:var(--i4)">
      아직 확정 전인 ${pend.join('·')}은 컨택에서 진행 중이라 여기 나오지 않아요.</div>` : ''}
    ${noneN ? `<div style="padding:4px 16px 0;font-size:11px;color:var(--am)">
      «${escapeHtml(PARTNERING_UNSIDED)}»로만 적혀 셀러·바이어를 모르는 참가자가 ${noneN}명 있어요 — 역할을 셀러나 바이어로 바꿔 주세요.</div>` : ''}
    <div style="padding:12px 16px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn" style="font-size:11px" onclick="togglePtnAll()">전체 선택/해제</button>
      <span id="ptn-picked-n" style="font-size:11px;color:var(--i4)">${pickedLabel()}</span>
      <div style="flex:1"></div>
      <button class="btn bp" style="font-size:11px" onclick="sendPtnToContact()"
        title="고른 사람의 기업을 컨택 차수 명단에 넣어요. 안 고르면 지금 보이는 전부">컨택으로 보내기</button>
    </div>
    <div id="ptn-rows" style="padding:8px 16px 40px">${rowsHtml(rows)}</div>`;
}

function renderPtnRows(){
  const el = document.getElementById('ptn-rows');
  if(el) el.innerHTML = rowsHtml(ptnRows(ptnEvent).rows);
}

const pickedLabel = () => (ptnPicked.size ? `${ptnPicked.size}명 선택` : '');
/* 체크 하나에 다시 그리면 긴 목록의 스크롤이 튄다 — 숫자만 고친다 */
export function pickPtn(key, on){
  on ? ptnPicked.add(key) : ptnPicked.delete(key);
  const n = document.getElementById('ptn-picked-n');
  if(n) n.textContent = pickedLabel();
}
/* 지금 보이는 줄이 다 골라져 있으면 풀고, 아니면 다 고른다 */
export function togglePtnAll(){
  const l = shownRows(ptnRows(ptnEvent).rows);
  const all = l.length && l.every(r => ptnPicked.has(r.key));
  l.forEach(r => (all ? ptnPicked.delete(r.key) : ptnPicked.add(r.key)));
  renderPtnRows();
  const n = document.getElementById('ptn-picked-n');
  if(n) n.textContent = pickedLabel();
}
/* 내보내기·보내기 대상 — 고른 줄이 있으면 그것만, 없으면 지금 보이는 전부 */
function targetRows(){
  const l = shownRows(ptnRows(ptnEvent).rows);
  return ptnPicked.size ? l.filter(r => ptnPicked.has(r.key)) : l;
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
  if(!keys.length){ alert(`고른 참가자의 기업이 기업DB에 없어 컨택 명단에 넣을 수 없어요.
${note}`); return; }
  const sides = [...new Set(l.map(r => r.side))];
  const label = '파트너링' + (sides.length === 1 ? ' ' + sideDef(sides[0]).label : '');
  openSendToRound(keys, label, { from: '파트너링에서 고른', ev: ptnEvent, note });
}

const sideBadge = (r) => { const s = sideDef(r.side); return `<span class="pill ${escAttr(s.cls)}">${escapeHtml(s.label)}</span>`; };

function rowsHtml(all){
  const l = shownRows(all);
  if(!l.length) return `<div style="font-size:12px;color:var(--i4);padding:20px 0">${all.length
    ? '해당하는 참가자가 없어요.' : '아직 참가가 확정된 셀러·바이어가 없어요.'}</div>`;

  // 좁은 화면에서는 표가 옆으로 넘쳐 읽을 수 없다 — 카드로 바꿔 준다
  if(isMobile()) return l.map(r => `<div style="background:var(--W);border:1px solid var(--i6);border-radius:8px;padding:10px 12px;margin-bottom:6px">
    <div style="display:flex;align-items:center;gap:7px">
      <input type="checkbox" ${ptnPicked.has(r.key) ? 'checked' : ''} onchange="pickPtn('${escAttr(r.key)}',this.checked)">
      ${sideBadge(r)}
      <span style="font-size:13px;font-weight:600;color:var(--i1)">${escapeHtml(r.org || '소속 없음')}</span></div>
    <div style="font-size:11.5px;color:var(--i2);margin-top:4px">${escapeHtml(r.name)}${r.title ? ' · ' + escapeHtml(r.title) : ''}</div>
    <div style="font-size:10.5px;color:var(--i4);margin-top:2px">${escapeHtml(countryName(r.country) || '')}${r.email ? ' · ' + escapeHtml(r.email) : ''}</div>
  </div>`).join('');

  return `<div style="overflow-x:auto"><table style="width:100%">
    <thead><tr>
      <th style="width:26px"></th><th style="width:70px">구분</th><th>기업·기관</th><th>국가</th><th>성명</th><th>직함</th>
      <th>이메일</th><th>연락처</th><th style="width:90px">확정일</th>
    </tr></thead><tbody>
    ${l.map(r => `<tr>
      <td style="text-align:center"><input type="checkbox" ${ptnPicked.has(r.key) ? 'checked' : ''}
        onchange="pickPtn('${escAttr(r.key)}',this.checked)"></td>
      <td>${sideBadge(r)}</td>
      <td><span style="font-weight:600">${escapeHtml(r.org)}</span>${r.orgEn && r.orgEn !== r.org ? `<div style="font-size:10.5px;color:var(--i4)">${escapeHtml(r.orgEn)}</div>` : ''}</td>
      <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(countryName(r.country) || '')}</td>
      <td>${escapeHtml(r.name)}${r.nameEn && r.nameEn !== r.name ? `<div style="font-size:10.5px;color:var(--i4)">${escapeHtml(r.nameEn)}</div>` : ''}</td>
      <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(r.title)}</td>
      <td style="font-size:11px;color:var(--i4)">${escapeHtml(r.email)}</td>
      <td style="font-size:11px;color:var(--i4)">${escapeHtml(r.phone)}</td>
      <td style="font-size:11px;color:var(--i4)">${escapeHtml(String(r.confirmedAt).slice(0, 10))}</td>
    </tr>`).join('')}
    </tbody></table></div>`;
}

/* ── 명단 내보내기 — 고른 줄, 없으면 지금 보이는 것(편·검색) ── */
export function exportPtn(){
  const l = targetRows();
  if(!l.length){ alert('내보낼 명단이 없어요.'); return; }
  const ev = EVENT_LIST.find(e => e.key === ptnEvent);
  const head = ['구분', '기업·기관', '기업 영문', '국가', '성명', '영문명', '부서', '직함', '이메일', '연락처', '확정일'];
  const body = l.map(r => [sideDef(r.side).label, r.org, r.orgEn, countryName(r.country) || '',
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

window.setPtnEvent = setPtnEvent;
window.setPtnSide  = setPtnSide;
window.setPtnQuery = setPtnQuery;
window.exportPtn   = exportPtn;
window.pickPtn     = pickPtn;
window.togglePtnAll = togglePtnAll;
window.sendPtnToContact = sendPtnToContact;
window.renderPtn   = renderPtn;   // 모바일/데스크톱 경계를 넘으면 app.js가 다시 그린다
