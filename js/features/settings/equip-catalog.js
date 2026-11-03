/* ══════════════════════════════════════════════════════════════
   features/settings/equip-catalog.js — 설정 › 비품 목록 (equip_catalog)
   (modules/settings-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { deleteEquipCatalog, saveEquipCatalog } from '../../api.js';
import { changed, removed, trackAction } from '../../core/audit-log.js';
import { EQUIP_CATALOG, EVENT_LIST, EXH_ITEMS } from '../../state.js';
import { escAttr, escapeHtml } from '../../utils.js';
import { settingsUi } from './settings-ui.js';
import { switchArchTab } from '../../modules/settings-tab.js';

/* ══════════════════════════════════════════
   비품 카탈로그 관리 (equip_catalog)

   렌탈사가 주는 품목표다. 행사가 바뀌면 품목도 단가도 바뀌는데, 전에는 전시 탭
   비품 현황에서 "추가"만 할 수 있었다. 단가를 고치거나 안 쓰는 품목을 내리려면
   개발자를 불러야 했다.

   지우는 건 조심한다. 신청 내역(exhibitor_items.catalog_id)이 품목을 가리키고
   있어서, 쓰고 있는 품목을 지우면 그 신청이 무엇이었는지 알 수 없게 된다.
   그래서 쓰는 중이면 숨김(active='no')만 하고, 아무도 안 쓴 품목만 정말 지운다.

   행사별로 나뉘므로 어느 행사의 품목표인지 먼저 고른다.
══════════════════════════════════════════ */
/* 같은 편집기를 두 자리가 나눠 쓴다 — 설정값 탭(eqcat-rows)과 행사 상세.
   행사 상세에서는 어느 행사인지가 이미 정해져 있어 행사 선택을 잠근다. */
export function mountEquipCatalog(targetId, lockEv){
  settingsUi.eqTarget = targetId || 'eqcat-rows';
  settingsUi.eqLockEv = lockEv || '';
  if(settingsUi.eqLockEv && settingsUi.eqEvent !== settingsUi.eqLockEv){ settingsUi.eqEvent = settingsUi.eqLockEv; settingsUi.eqCatFil = ''; settingsUi.eqQuery = ''; }
  renderEquipCatalog();
}
/* 행사 상세에서 비품 칸을 떠날 때 — 다음 렌더가 사라진 자리를 찾지 않도록
   설정값 탭 자리로만 돌려놓고 그리지는 않는다 */
export function mountEquipCatalogIdle(){
  if(settingsUi.eqTarget === 'eqcat-rows') return;
  settingsUi.eqTarget = 'eqcat-rows';
  settingsUi.eqLockEv = '';
}

const eqNum = (v) => String(v ?? '').replace(/[^0-9.]/g, '');
const eqMoney = (v) => { const n = Number(eqNum(v)); return n ? n.toLocaleString() : ''; };

/* 이 품목을 몇 곳이 신청했나 — 지워도 되는지 판단하는 근거 */
const eqUsedBy = (id) => EXH_ITEMS.filter(i => i.catalog_id === id).length;
/* 전체 품목을 쓰는 행사 — 지워도 되는지는 여기서 갈린다(행사 사본이 이 품목을 가리킨다) */
const eqEventsUsing = (id) => EQUIP_CATALOG.filter(c => c.base_id === id && c.event_id);

const eqRows = () => EQUIP_CATALOG
  .filter(c => (c.event_id || '') === (settingsUi.eqEvent || ''))
  .filter(c => (c.kind || 'equip') === settingsUi.eqKind)
  .filter(c => !settingsUi.eqCatFil || (c.category || '') === settingsUi.eqCatFil)
  .filter(c => {
    if(!settingsUi.eqQuery) return true;
    const q = settingsUi.eqQuery.toLowerCase();
    return [c.code, c.name_ko, c.name_en, c.spec].some(v => String(v || '').toLowerCase().includes(q));
  })
  .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
    || String(a.code || '').localeCompare(String(b.code || '')));

export function renderEquipCatalog(){
  const el = document.getElementById(settingsUi.eqTarget);
  if(!el) return;

  // 처음 열 때는 품목이 실제로 들어 있는 행사를 연다 — 빈 화면을 보여주면
  // 품목표가 없는 줄 안다(설정값 탭의 선택 목록과 같은 이유)
  const evs = [...new Set(EQUIP_CATALOG.map(c => c.event_id).filter(Boolean))];
  /* eqEvent가 비어 있으면 전체 품목표다 */
  if(settingsUi.eqLockEv) settingsUi.eqEvent = settingsUi.eqLockEv;

  const all = EQUIP_CATALOG.filter(c => (c.event_id || '') === (settingsUi.eqEvent || '') && (c.kind || 'equip') === settingsUi.eqKind);
  const masterAll = EQUIP_CATALOG.filter(c => !c.event_id && (c.kind || 'equip') === settingsUi.eqKind);
  const cats = [...new Set((settingsUi.eqEvent ? masterAll : all).map(c => c.category || '').filter(Boolean))];

  el.innerHTML = `
    <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:10px">
      ${settingsUi.eqLockEv ? '' : `<div style="min-width:200px"><div class="mlbl">보기</div>
        <select class="fi" style="width:100%" onchange="setEqEvent(this.value)">
          <option value=""${!settingsUi.eqEvent ? ' selected' : ''}>📦 전체 품목표 (${EQUIP_CATALOG.filter(c => !c.event_id).length})</option>
          ${(() => {
            /* 품목표가 아직 없는 행사도 고를 수 있어야 새로 만든다 — 품목 수를 붙여 구분한다 */
            const keys = [...new Set([...EVENT_LIST.map(e => e.key), ...evs])].filter(Boolean);
            if(settingsUi.eqEvent && !keys.includes(settingsUi.eqEvent)) keys.unshift(settingsUi.eqEvent);
            return keys.map(k => {
              const n = EQUIP_CATALOG.filter(c => c.event_id === k).length;
              return `<option value="${escapeHtml(k)}"${k === settingsUi.eqEvent ? ' selected' : ''}>행사 · ${escapeHtml(k)}${n ? ` (${n})` : ' — 아직 안 고름'}</option>`;
            }).join('');
          })()}
        </select></div>`}
      <div style="min-width:120px"><div class="mlbl">종류</div>
        <select class="fi" style="width:100%" onchange="setEqKind(this.value)">
          <option value="equip"${settingsUi.eqKind === 'equip' ? ' selected' : ''}>비품</option>
          <option value="graphic"${settingsUi.eqKind === 'graphic' ? ' selected' : ''}>그래픽</option>
        </select></div>
      <div style="min-width:130px"><div class="mlbl">분류</div>
        <select class="fi" style="width:100%" onchange="setEqCatFil(this.value)">
          <option value="">전체</option>
          ${cats.map(c => `<option value="${escapeHtml(c)}"${c === settingsUi.eqCatFil ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select></div>
      <div style="flex:1;min-width:150px"><div class="mlbl">검색</div>
        <input class="fi" style="width:100%" value="${escapeHtml(settingsUi.eqQuery)}" placeholder="코드·품명·규격"
          oninput="setEqQuery(this.value)"></div>
    </div>
    ${settingsUi.eqEvent ? `<div style="font-size:11px;color:var(--i4);margin-bottom:8px;line-height:1.6">
        전체 품목표에서 이 행사에 쓸 품목을 체크하고 이 행사 단가를 적으세요. 체크하면 기본 단가가 먼저 들어갑니다.
        품명·규격은 <a href="javascript:void(0)" onclick="setEqEvent('')" style="color:var(--a)">전체 품목표</a>에서 고칩니다.</div>` : ''}
    <div id="eqcat-count" style="font-size:11px;color:var(--i4);margin-bottom:8px">${eqCountHtml()}</div>

    <div id="eqcat-list">${eqListHtml()}</div>

    ${settingsUi.eqEvent ? '' : `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--i6)">
      <div style="font-size:11.5px;font-weight:700;color:var(--i2);margin-bottom:8px">품목 추가</div>
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
        <div style="width:90px"><div class="mlbl">코드</div>
          <input class="fi" id="eq-new-code" placeholder="비우면 자동" style="width:100%"></div>
        <div style="flex:1;min-width:120px"><div class="mlbl">품명(국문)</div>
          <input class="fi" id="eq-new-ko" style="width:100%" onkeydown="if(event.key==='Enter')addEquipItem()"></div>
        <div style="flex:1;min-width:120px"><div class="mlbl">품명(영문)</div>
          <input class="fi" id="eq-new-en" style="width:100%" onkeydown="if(event.key==='Enter')addEquipItem()"></div>
        <div style="min-width:110px"><div class="mlbl">분류</div>
          <select class="fi" id="eq-new-cat" style="width:100%">
            ${(cats.length ? cats : ['기타비품']).map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
          </select></div>
        <div style="width:100px"><div class="mlbl">KRW</div>
          <input class="fi" id="eq-new-krw" style="width:100%" placeholder="0"></div>
        <div style="width:90px"><div class="mlbl">USD</div>
          <input class="fi" id="eq-new-usd" style="width:100%" placeholder="0"></div>
        <button class="btn bp" onclick="addEquipItem()" style="min-width:60px;height:36px">추가</button>
      </div>
      <div id="eq-new-msg" style="font-size:11px;margin-top:6px"></div>
    </div>`}`;
}

function eqRowHtml(c){
  const off = c.active === 'no';
  const used = c.event_id ? eqUsedBy(c.id) : eqEventsUsing(c.id).length;
  return `<div class="clrow" style="padding:6px 0;border-bottom:1px solid var(--i7)${off ? ';opacity:.5' : ''}">
    <div style="display:flex;gap:8px;align-items:center;min-width:0;flex:0 0 auto">
      <code style="font-size:11px;color:var(--i4);min-width:64px">${escapeHtml(c.code || '')}</code>
      ${c.event_id
        ? (used ? `<span class="pill p-blue" title="이 품목을 신청한 내역">${used}건</span>`
                : `<span class="pill p-gray" title="아무도 신청하지 않았어요">미사용</span>`)
        : (used ? `<span class="pill p-blue" title="${escapeHtml(eqEventsUsing(c.id).map(x => x.event_id).join(', '))}">행사 ${used}</span>`
                : `<span class="pill p-gray" title="아직 고른 행사가 없어요">행사 0</span>`)}
    </div>
    <label class="clf clf-grow"><span class="clf-l">국문</span>
      <input class="fi" value="${escapeHtml(c.name_ko || '')}" placeholder="품명(국문)" style="min-width:110px"
        onchange="editEquipItem('${escAttr(c.id)}','name_ko',this.value)"></label>
    <label class="clf clf-grow"><span class="clf-l">영문</span>
      <input class="fi" value="${escapeHtml(c.name_en || '')}" placeholder="품명(영문)" style="min-width:110px"
        onchange="editEquipItem('${escAttr(c.id)}','name_en',this.value)"></label>
    <label class="clf"><span class="clf-l">KRW</span>
      <input class="fi" value="${escapeHtml(eqMoney(c.price_krw))}" placeholder="KRW" style="width:96px;text-align:right"
        onchange="editEquipItem('${escAttr(c.id)}','price_krw',this.value)"></label>
    <label class="clf"><span class="clf-l">USD</span>
      <input class="fi" value="${escapeHtml(eqMoney(c.price_usd))}" placeholder="USD" style="width:80px;text-align:right"
        onchange="editEquipItem('${escAttr(c.id)}','price_usd',this.value)"></label>
    <span class="clf"><span class="clf-l"></span>
      <button class="btn" onclick="removeEquipItem('${escAttr(c.id)}')"
        style="height:32px;font-size:11px">${off ? '되살리기' : used ? '숨김' : '삭제'}</button></span>
  </div>`;
}

export function setEqKind(v){ settingsUi.eqKind = v; settingsUi.eqCatFil = ''; settingsUi.eqQuery = ''; renderEquipCatalog(); }
export function setEqEvent(v){ settingsUi.eqEvent = v; settingsUi.eqCatFil = ''; renderEquipCatalog(); }
/* 행사 상세의 바로가기 — 그 행사를 고른 채로 비품 목록을 연다 */
export function openEquipFor(evKey){
  settingsUi.eqEvent = evKey; settingsUi.eqCatFil = ''; settingsUi.eqQuery = '';
  switchArchTab('equip');
}
export function setEqCatFil(v){ settingsUi.eqCatFil = v; renderEquipCatalog(); }
export function setEqQuery(v){
  settingsUi.eqQuery = v;
  // 검색은 글자를 칠 때마다 다시 그리는데, 통째로 다시 그리면 입력칸이 포커스를
  // 잃는다. 목록만 갈아 끼우고 입력칸은 그대로 둔다.
  const el = document.getElementById(settingsUi.eqTarget);
  if(!el) return;
  const box = el.querySelector('#eqcat-list');
  const cnt = el.querySelector('#eqcat-count');
  if(box){ box.innerHTML = eqListHtml(); if(cnt) cnt.innerHTML = eqCountHtml(); return; }
  renderEquipCatalog();
}
/* 개수 안내 — 검색할 때 목록만 갈아 끼우면 이 줄이 옛 숫자로 남는다 */
const eqCountHtml = () => {
  if(settingsUi.eqEvent){
    const mine = EQUIP_CATALOG.filter(c => c.event_id === settingsUi.eqEvent && (c.kind || 'equip') === settingsUi.eqKind && c.active !== 'no');
    const total = EQUIP_CATALOG.filter(c => !c.event_id && (c.kind || 'equip') === settingsUi.eqKind && c.active !== 'no').length;
    return `${escapeHtml(settingsUi.eqEvent)} — 전체 ${settingsUi.eqKind === 'graphic' ? '그래픽' : '비품'} ${total}개 중 <b>${mine.length}개</b> 사용`;
  }
  const all = EQUIP_CATALOG.filter(c => !c.event_id && (c.kind || 'equip') === settingsUi.eqKind);
  const hidden = all.filter(c => c.active === 'no').length;
  const shown = eqRows().length;
  return `전체 품목표 ${settingsUi.eqKind === 'graphic' ? '그래픽' : '비품'} ${all.length}개${hidden ? ` (숨김 ${hidden}개 포함)` : ''}`
    + (shown !== all.length ? ` · 지금 보이는 것 ${shown}개` : '');
};

const eqListHtml = () => {
  if(settingsUi.eqEvent) return eqEventListHtml();
  const rows = eqRows();
  return rows.length ? rows.map(eqRowHtml).join('')
    : '<div style="font-size:12px;color:var(--i4);padding:8px 0">해당하는 품목이 없어요.</div>'; };

/* 행사 보기 — 전체 품목 한 줄마다 «이 행사에 쓰나»와 이 행사 단가 */
function eqEventListHtml(){
  const q = settingsUi.eqQuery.toLowerCase();
  const masters = EQUIP_CATALOG
    .filter(c => !c.event_id && (c.kind || 'equip') === settingsUi.eqKind)
    .filter(c => !settingsUi.eqCatFil || (c.category || '') === settingsUi.eqCatFil)
    .filter(c => !q || [c.code, c.name_ko, c.name_en, c.spec].some(v => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
      || String(a.code || '').localeCompare(String(b.code || '')));
  const mineOf = (m) => EQUIP_CATALOG.find(c => c.event_id === settingsUi.eqEvent && c.base_id === m.id);
  const row = (m) => {
    const e = mineOf(m);
    const on = !!e && e.active !== 'no';
    if(m.active === 'no' && !on) return '';   // 전체에서 내린 품목은 이미 쓰던 행사에서만 보인다
    const used = e ? eqUsedBy(e.id) : 0;
    const diff = on && (eqNum(e.price_krw) !== eqNum(m.price_krw) || eqNum(e.price_usd) !== eqNum(m.price_usd));
    return `<div class="clrow" style="padding:6px 0;border-bottom:1px solid var(--i7)${on ? '' : ';opacity:.6'}">
      <label style="display:flex;gap:8px;align-items:center;flex:1;min-width:200px;cursor:pointer">
        <input type="checkbox" ${on ? 'checked' : ''} onchange="toggleEqUse('${escAttr(m.id)}',this.checked)">
        <code style="font-size:11px;color:var(--i4);min-width:56px">${escapeHtml(m.code || '')}</code>
        <span style="font-size:12px">${escapeHtml(m.name_ko || m.name_en || '')}</span>
        ${used ? `<span class="pill p-blue" title="이 행사에서 이 품목을 신청한 내역">${used}건</span>` : ''}
      </label>
      <span style="font-size:10.5px;color:var(--i4);white-space:nowrap">기본 ${eqMoney(m.price_krw) || '-'}원${
        m.price_usd ? ` · $${eqMoney(m.price_usd)}` : ''}</span>
      ${on ? `<label class="clf"><span class="clf-l">이 행사 KRW</span>
          <input class="fi" value="${escapeHtml(eqMoney(e.price_krw))}" style="width:96px;text-align:right${diff ? ';border-color:var(--am)' : ''}"
            onchange="editEquipItem('${escAttr(e.id)}','price_krw',this.value)"></label>
        <label class="clf"><span class="clf-l">USD</span>
          <input class="fi" value="${escapeHtml(eqMoney(e.price_usd))}" style="width:80px;text-align:right${diff ? ';border-color:var(--am)' : ''}"
            onchange="editEquipItem('${escAttr(e.id)}','price_usd',this.value)"></label>` : ''}
    </div>`;
  };
  const list = masters.map(row).join('');
  /* 전체 품목표에 없는 이 행사만의 품목 — 전시 화면에서 바로 만든 것 따위 */
  const own = EQUIP_CATALOG.filter(c => c.event_id === settingsUi.eqEvent && !c.base_id && (c.kind || 'equip') === settingsUi.eqKind);
  const ownHtml = own.length ? `
    <div style="font-size:11.5px;font-weight:700;color:var(--i2);margin:14px 0 4px">이 행사에만 있는 품목 ${own.length}개</div>
    <div style="font-size:11px;color:var(--i4);margin-bottom:6px">전체 품목표에 없는 품목입니다. 다른 행사에서도 쓸 거면 «전체에 올리기»를 누르세요.</div>
    ${own.map(c => eqRowHtml(c) + `<div style="text-align:right;margin:2px 0 6px">
      <button class="btn" style="font-size:10.5px" onclick="promoteEqItem('${escAttr(c.id)}')">전체에 올리기</button></div>`).join('')}` : '';
  return (list || '<div style="font-size:12px;color:var(--i4);padding:8px 0">전체 품목표에 해당하는 품목이 없어요.</div>') + ownHtml;
}

/* 이 행사에 쓰기 / 빼기 */
export async function toggleEqUse(masterId, on){
  const m = EQUIP_CATALOG.find(c => c.id === masterId);
  if(!m || !settingsUi.eqEvent) return;
  const e = EQUIP_CATALOG.find(c => c.event_id === settingsUi.eqEvent && c.base_id === masterId);
  const nm = `${m.code || ''} ${m.name_ko || m.name_en || ''}`.trim();
  if(on){
    if(e){   // 전에 뺐던 것 — 숨김만 푼다(이 행사 단가가 남아 있다)
      e.active = '';
      const r = await saveEquipCatalog(e);
      if(!r.ok) e.active = 'no';
    } else {
      const rec = { ...m, id: `EC-${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        event_id: settingsUi.eqEvent, base_id: m.id, active: '' };
      EQUIP_CATALOG.push(rec);
      const r = await saveEquipCatalog(rec);
      if(!r.ok){ EQUIP_CATALOG.splice(EQUIP_CATALOG.indexOf(rec), 1); renderEquipCatalog(); return; }
      if(r.id && r.id !== rec.id) rec.id = r.id;
    }
    trackAction('edit', '품목 사용', settingsUi.eqEvent, `<b>${escapeHtml(nm)}</b> — ${escapeHtml(settingsUi.eqEvent)}에서 씀`);
  } else if(e){
    /* 신청이 있으면 지우지 않고 숨긴다 — 옛 신청이 무엇을 가리키는지 남아야 한다 */
    const used = eqUsedBy(e.id);
    if(used){
      if(!confirm(`"${nm}"은(는) 이 행사에서 ${used}건 신청돼 있어요.\n빼면 새로 고를 수 없지만 기존 신청과 금액은 그대로 남습니다. 뺄까요?`)){
        renderEquipCatalog(); return;
      }
      e.active = 'no';
      const r = await saveEquipCatalog(e);
      if(!r.ok) e.active = '';
    } else {
      const i = EQUIP_CATALOG.indexOf(e);
      EQUIP_CATALOG.splice(i, 1);
      const r = await deleteEquipCatalog(e.id);
      if(!r.ok) EQUIP_CATALOG.splice(i, 0, e);
    }
    trackAction('edit', '품목 빼기', settingsUi.eqEvent, `<b>${escapeHtml(nm)}</b> — ${escapeHtml(settingsUi.eqEvent)}에서 뺌`);
  }
  renderEquipCatalog();
  window.renderExh?.();
}

/* 이 행사에만 있던 품목을 전체 품목표로 올린다 — 행사 사본은 그대로 두고 잇기만 한다 */
export async function promoteEqItem(id){
  const c = EQUIP_CATALOG.find(x => x.id === id);
  if(!c) return;
  const m = { ...c, id: `EC-${Date.now()}_${Math.floor(Math.random() * 1000)}`, event_id: '', base_id: '', active: '' };
  EQUIP_CATALOG.push(m);
  const r = await saveEquipCatalog(m);
  if(!r.ok){ EQUIP_CATALOG.splice(EQUIP_CATALOG.indexOf(m), 1); return; }
  if(r.id && r.id !== m.id) m.id = r.id;
  c.base_id = m.id;
  const r2 = await saveEquipCatalog(c);
  if(!r2.ok) c.base_id = '';
  trackAction('add', '품목 등록', '',
    `<b>${escapeHtml(c.code || '')}</b> ${escapeHtml(c.name_ko || c.name_en || '')} — ${escapeHtml(settingsUi.eqEvent)}에서 전체 품목표로 올림`);
  renderEquipCatalog();
}

/* 값 하나 고치기 — 금액은 쉼표를 떼고 숫자만 남긴다 */
export async function editEquipItem(id, field, value){
  const c = EQUIP_CATALOG.find(x => x.id === id);
  if(!c) return;
  const v = (field === 'price_krw' || field === 'price_usd') ? eqNum(value) : String(value ?? '').trim();
  const prev = c[field] || '';
  if(v === prev) return;

  if(!v && field === 'name_ko' && !c.name_en){ alert('국문·영문 중 하나는 있어야 해요.'); renderEquipCatalog(); return; }
  if(!v && field === 'name_en' && !c.name_ko){ alert('국문·영문 중 하나는 있어야 해요.'); renderEquipCatalog(); return; }

  c[field] = v;
  const r = await saveEquipCatalog(c);
  if(!r.ok){ c[field] = prev; renderEquipCatalog(); return; }   // 실패하면 되돌린다

  const LBL = { name_ko: '국문 품명', name_en: '영문 품명', price_krw: 'KRW 단가', price_usd: 'USD 단가' };
  trackAction('edit', '품목 수정', settingsUi.eqEvent,
    `<b>${escapeHtml(c.code || '')}</b> ${escapeHtml(c.name_ko || c.name_en || '')} — ${LBL[field] || field}: ${
      escapeHtml(prev || '(빈값)')} → ${escapeHtml(v || '(빈값)')}`,
    changed('equip_catalog', c.id, { [field]: prev ?? '' }, { [field]: v ?? '' }));
  renderEquipCatalog();
  window.renderExh?.();   // 전시 탭이 열려 있으면 단가가 바로 반영되게
}

/* 내리기 — 쓰는 중이면 숨기고, 아무도 안 쓴 품목만 정말 지운다 */
export async function removeEquipItem(id){
  const c = EQUIP_CATALOG.find(x => x.id === id);
  if(!c) return;
  const nm = `${c.code || ''} ${c.name_ko || c.name_en || ''}`.trim();
  /* 전체 품목은 «쓰는 행사가 있나»로, 행사 품목은 «신청이 있나»로 지울지 정한다 */
  const used = c.event_id ? eqUsedBy(c.id) : eqEventsUsing(c.id).length;

  // 되살리기
  if(c.active === 'no'){
    c.active = '';
    const r = await saveEquipCatalog(c);
    if(!r.ok){ c.active = 'no'; renderEquipCatalog(); return; }
    trackAction('edit', '품목 되살리기', settingsUi.eqEvent, `<b>${escapeHtml(nm)}</b> 다시 고를 수 있게 함`);
    renderEquipCatalog(); return;
  }

  if(used){
    if(!confirm(c.event_id
      ? `"${nm}"을(를) 숨길까요?\n${used}곳이 이미 신청해 둔 품목이라 지우지 않고 숨깁니다.\n앞으로 새로 고를 수 없지만, 기존 신청 내역과 금액은 그대로 남습니다.`
      : `"${nm}"을(를) 전체 품목표에서 숨길까요?\n${used}개 행사가 쓰고 있어 지우지 않고 숨깁니다.\n그 행사들의 품목표는 그대로이고, 다른 행사에서 새로 고를 수만 없게 됩니다.`)) return;
    c.active = 'no';
    const r = await saveEquipCatalog(c);
    if(!r.ok){ c.active = ''; renderEquipCatalog(); return; }
    trackAction('edit', '품목 숨김', settingsUi.eqEvent, `<b>${escapeHtml(nm)}</b> 숨김 (신청 ${used}건은 유지)`,
      changed('equip_catalog', c.id, { active: '' }, { active: 'no' }));
    renderEquipCatalog(); return;
  }

  if(!confirm(`"${nm}"을(를) 품목표에서 완전히 지울까요?\n아무도 신청하지 않은 품목이라 지워도 남는 기록이 없습니다.`)) return;
  const i = EQUIP_CATALOG.indexOf(c);
  EQUIP_CATALOG.splice(i, 1);
  const r = await deleteEquipCatalog(c.id);
  if(!r.ok){ EQUIP_CATALOG.splice(i, 0, c); renderEquipCatalog(); return; }
  trackAction('delete', '품목 삭제', settingsUi.eqEvent, `<b>${escapeHtml(nm)}</b> 품목표에서 삭제 (신청 내역 없음)`,
    removed('equip_catalog', c.id, c));
  renderEquipCatalog();
  window.renderExh?.();
}

export async function addEquipItem(){
  const msg = document.getElementById('eq-new-msg');
  const say = (t, ok) => { if(msg){ msg.style.color = ok ? 'var(--g)' : 'var(--re)'; msg.textContent = t; } };
  const g = (id) => (document.getElementById(id)?.value || '').trim();
  const ko = g('eq-new-ko'), en = g('eq-new-en');
  if(!ko && !en){ say('품명을 국문이나 영문 중 하나는 입력해주세요.'); return; }

  const mine = EQUIP_CATALOG.filter(c => (c.event_id || '') === (settingsUi.eqEvent || '') && (c.kind || 'equip') === settingsUi.eqKind);
  // 같은 이름이 이미 있으면 새로 만들지 않는다 — 품목표를 둔 이유가 없어진다
  const key = (v) => String(v || '').toLowerCase().replace(/\s+/g, '');
  const dup = mine.find(c => (ko && key(c.name_ko) === key(ko)) || (en && key(c.name_en) === key(en)));
  if(dup){ say(`이미 있는 품목이에요 — ${dup.code} ${dup.name_ko || dup.name_en}`); return; }

  let code = g('eq-new-code').toUpperCase();
  const used = new Set(mine.map(c => String(c.code || '').toUpperCase()));
  if(code && used.has(code)){ say(`이미 쓰고 있는 코드예요 — ${code}`); return; }
  if(!code){
    let n = 1;
    const pre = settingsUi.eqKind === 'graphic' ? 'XG' : 'X';
    while(used.has(`${pre}-${String(n).padStart(3, '0')}`)) n++;
    code = `${pre}-${String(n).padStart(3, '0')}`;
  }

  const rec = {
    id: `EC-${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    event_id: settingsUi.eqEvent || '', base_id: '', kind: settingsUi.eqKind,
    category: g('eq-new-cat') || (settingsUi.eqKind === 'graphic' ? '기타그래픽' : '기타비품'), code,
    name_ko: ko, name_en: en, spec: '',
    price_krw: eqNum(g('eq-new-krw')), price_usd: eqNum(g('eq-new-usd')),
    note: '', active: '', sort_order: String(900 + mine.length),
  };
  EQUIP_CATALOG.push(rec);
  const r = await saveEquipCatalog(rec);
  if(!r.ok){ EQUIP_CATALOG.pop(); say('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.'); return; }
  if(r.id && r.id !== rec.id) rec.id = r.id;

  trackAction('add', '품목 등록', settingsUi.eqEvent,
    `<b>${escapeHtml(code)}</b> ${escapeHtml(ko || en)} — ${escapeHtml(settingsUi.eqEvent || '전체')} 품목표에 추가`);
  ['eq-new-code', 'eq-new-ko', 'eq-new-en', 'eq-new-krw', 'eq-new-usd']
    .forEach(id => { const e = document.getElementById(id); if(e) e.value = ''; });
  renderEquipCatalog();
  say(`${code} ${ko || en} 추가했어요.`, true);
  window.renderExh?.();
}

window.renderEquipCatalog = renderEquipCatalog;
window.setEqKind    = setEqKind;
window.openEquipFor = openEquipFor;
window.toggleEqUse = toggleEqUse;
window.promoteEqItem = promoteEqItem;
window.setEqEvent   = setEqEvent;
window.setEqCatFil  = setEqCatFil;
window.setEqQuery   = setEqQuery;
window.editEquipItem = editEquipItem;
window.removeEquipItem = removeEquipItem;
window.addEquipItem = addEquipItem;


/* «설정 › 행사 관리 › 행사 상세»은 ../features/settings/event-detail.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */

/* 화면의 onclick이 부르는 것 */
window.mountEquipCatalog = mountEquipCatalog;   // 탭(settings-tab.js)이 window로 부른다
