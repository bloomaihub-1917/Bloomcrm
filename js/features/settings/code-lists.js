/* ══════════════════════════════════════════════════════════════
   features/settings/code-lists.js — 선택 목록·부스 기본 제공·업로드 표기·행사별 설정 요약
   (modules/settings-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { postToSheet } from '../../api.js';
import { CAT_KEYS, CL } from '../../constants.js';
import { trackAction } from '../../core/audit-log.js';
import { CODE_LISTS, EQUIP_CATALOG, EXH_CFG, applyCodeLists } from '../../state.js';
import { escAttr, escapeHtml } from '../../utils.js';
import { settingsUi } from './settings-ui.js';
import { DUE_LABEL } from '../../modules/settings-tab.js';

/* ══════════════════════════════════════════
   선택 목록(code_lists) 관리

   부스 타입·스폰서 등급·통화처럼 드롭다운으로 고르는 짧은 목록들. 전에는 코드에
   박혀 있어서 행사가 바뀔 때마다 개발자가 고쳐야 했다.

   두 가지를 지킨다.
   ① 행사별 덮어쓰기 — 그 행사 전용 목록이 있으면 그걸 쓰고 없으면 공통을 쓴다.
      지난 행사 목록은 남아 있어서 옛 데이터가 무엇을 가리키는지 잃지 않는다.
   ② 삭제 대신 숨김 — 이미 저장된 값의 이름표를 지우면 화면에 코드가 그대로
      노출된다. active='no'로 내려 새로 고르지만 못 하게 한다.
══════════════════════════════════════════ */
/* group — 설정의 어느 탭에 보일지. 그 값을 쓰는 화면 기준으로 나눈다:
   org 기업DB, people 마스터DB·CRM, common 그 밖에 모든 행사가 같이 쓰는 것. */
const CL_DEFS = [
  { key: 'contact_cat',  label: '연락처 카테고리',    perEvent: false, group: 'people' },
  { key: 'org_kind',     label: '기업 종류',          perEvent: false, group: 'org' },
  { key: 'org_status',   label: '기업 상태',          perEvent: false, group: 'org' },
  { key: 'contact_role', label: '전시 담당자 역할',   perEvent: false, group: 'people' },
  { key: 'item_cat',     label: '금액 항목 분류',     perEvent: false, group: 'common' },
  { key: 'currency',     label: '통화',               perEvent: false, group: 'common' },
  { key: 'log_channel',  label: '문의 채널',          perEvent: false, group: 'common' },
  { key: 'log_cat',      label: '문의 분류',          perEvent: false, group: 'common' },
  { key: 'booth_type',   label: '부스 타입',          perEvent: true,  group: 'common' },
  { key: 'grade',        label: '스폰서 등급',        perEvent: true,  group: 'common' },
  { key: 'equip_cat',    label: '비품 카탈로그 분류', perEvent: true,  group: 'common' },
  /* 연사 역할 — 행사마다 다르게 부른다(발제자/좌장 대신 «발표»/«의장»을 쓰는
     학회도 있다). CL_DEFS에 넣지 않으면 설정 화면에 나오지 않는다 —
     pay_method가 그래서 고칠 수 없는 채로 있다. */
  { key: 'speaker_role', label: '연사 역할',          perEvent: true,  group: 'common' },
  { key: 'graphic_cat',  label: '그래픽 품목 분류',   perEvent: true,  group: 'common' },
];
const CL_COLORS = [['', '— 없음 —'], ['p-blue', '파랑'], ['p-green', '초록'], ['p-amber', '주황'],
  ['p-teal', '청록'], ['p-purple', '보라'], ['p-red', '빨강'], ['p-gray', '회색'],
  ['p-gold', '금색'], ['p-indigo', '남색']];

export const clDef = (k) => CL_DEFS.find(d => d.key === k)
  || (k === 'cat_alias' ? { key: k, label: '업로드 표기 매핑', perEvent: false } : CL_DEFS[0]);
const clKey = () => document.getElementById('cl-key')?.value || CL_DEFS[0].key;
const clScope = () => document.getElementById('cl-scope')?.value || '';
export const clSlug = (v) => String(v).replace(/[^A-Za-z0-9가-힣]/g, '').slice(0, 24);

/* 지금 고른 목록·범위의 행 — 숨긴 것도 포함해 순서대로 */
export function clRowsOf(key, scope){
  return CODE_LISTS.filter(c => c.list_key === key && (c.event_id || '') === scope)
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
}

/* 선택 목록 칸은 하나다(cl-key·cl-scope·cl-rows). 탭마다 따로 그리면 id가
   겹치므로, 그 하나를 지금 탭의 자리(cl-slot-<탭>)로 옮겨 붙이고 그 탭의
   목록만 고르게 한다. */
function mountCodeList(group){
  settingsUi.clGroup = group;
  const box = document.getElementById('cl-box'), slot = document.getElementById('cl-slot-' + group);
  if(box && slot && box.parentElement !== slot) slot.appendChild(box);
  renderCodeListPicker();
}

export function renderCodeListPicker(){
  const kel = document.getElementById('cl-key');
  if(!kel) return;
  const defs = CL_DEFS.filter(d => d.group === settingsUi.clGroup);
  const cur = defs.some(d => d.key === kel.value) ? kel.value : defs[0]?.key;
  kel.innerHTML = defs.map(d =>
    `<option value="${escapeHtml(d.key)}"${cur === d.key ? ' selected' : ''}>${escapeHtml(d.label)}</option>`).join('');
  renderCodeList();
}

export function renderCodeList(){
  const key = clKey(), def = clDef(key);
  const sel = document.getElementById('cl-scope');
  const el = document.getElementById('cl-rows');
  if(!sel || !el) return;

  // 행사별로 나뉘지 않는 목록은 범위 선택을 잠근다 — 고를 수 있게 두면 값이
  // 어디에 저장됐는지 헷갈린다
  /* 설정 탭에서는 공통만 고친다. 행사 전용 목록은 행사 › 상세(부스·컨퍼런스)에서 —
     같은 값을 두 곳에서 고치게 두면 어느 쪽이 맞는지 헷갈린다. */
  sel.disabled = true;
  sel.innerHTML = `<option value="">${def.perEvent ? '공통 — 새 행사 기본값' : '공통 (모든 행사)'}</option>`;
  sel.value = '';

  const scope = clScope();
  const rows = clRowsOf(key, scope);
  const inherited = def.perEvent && scope && !rows.length;
  const evNote = def.perEvent ? `<div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:8px">행사 전용 목록이 없는 행사가 이 목록을 씁니다. 한 행사만 다르게 하려면 <b>행사 › 그 행사 › ${
    def.key === 'speaker_role' ? '컨퍼런스' : '부스'}</b>에서 고치세요.</div>` : '';

  el.innerHTML = evNote + (inherited
    ? `<div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:8px">이 행사 전용 목록이 없어 <b>공통 목록</b>을 씁니다. 아래에서 항목을 추가하면 이 행사 전용 목록이 새로 만들어지고, 그때부터 공통 대신 이 목록만 쓰입니다.</div>
       <div style="opacity:.55;pointer-events:none">${clRowsHtml(clRowsOf(key, ''), true)}</div>`
    : clRowsHtml(rows, false))
    + `<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--i6)">
      <div style="flex:1;min-width:140px"><div class="mlbl">저장값</div>
        <input class="fi" id="cl-new-code" placeholder="예: Block System D" style="width:100%"
          onkeydown="if(event.key==='Enter')addCodeListRow()"></div>
      <div style="flex:1;min-width:140px"><div class="mlbl">화면에 보일 이름</div>
        <input class="fi" id="cl-new-label" placeholder="비우면 저장값 그대로" style="width:100%"
          onkeydown="if(event.key==='Enter')addCodeListRow()"></div>
      <div style="min-width:120px"><div class="mlbl">색상</div>
        <select class="fi" id="cl-new-cls" style="width:100%">${CL_COLORS.map(([v, l]) =>
          `<option value="${v}">${l}</option>`).join('')}</select></div>
      <button class="btn bp" onclick="addCodeListRow()" style="min-width:60px;height:36px">추가</button>
    </div>`;
}

export function clRowsHtml(rows, readonly){
  if(!rows.length) return '<div style="font-size:var(--fs-12);color:var(--i4)">아직 항목이 없어요.</div>';
  return rows.map(c => {
    const off = c.active === 'no';
    return `<div class="clrow" style="padding:6px 0;border-bottom:1px solid var(--i7)${off ? ';opacity:.5' : ''}">
      <div style="display:flex;gap:8px;align-items:center;min-width:0">
        <span class="pill ${escAttr(c.cls || 'p-gray')}" style="min-width:80px;text-align:center">${escapeHtml(c.label || c.code)}</span>
        <code style="font-size:var(--fs-11);color:var(--i4);min-width:110px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.code)}</code>
      </div>
      ${readonly ? '' : `
      <label class="clf clf-grow"><span class="clf-l">이름</span>
        <input class="fi" value="${escapeHtml(c.label || '')}" placeholder="이름" style="min-width:120px"
          onchange="editCodeListRow('${escAttr(c.id)}','label',this.value)"></label>
      <label class="clf"><span class="clf-l">색상</span>
        <select class="fi" style="min-width:100px" onchange="editCodeListRow('${escAttr(c.id)}','cls',this.value)">
          ${CL_COLORS.map(([v, l]) => `<option value="${v}"${(c.cls || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="clf"><span class="clf-l">순서</span>
        <input class="fi" type="number" value="${escapeHtml(c.sort_order || '')}" title="순서" style="width:70px"
          onchange="editCodeListRow('${escAttr(c.id)}','sort_order',this.value)"></label>
      ${c.list_key === 'booth_type' ? `<span class="clf"><span class="clf-l"></span>
        <button class="btn" onclick="openBoothIncluded('${escAttr(c.id)}')"
          title="이 부스에 기본으로 딸려 오는 품목이에요 — 부스 타입을 고르면 신청항목에 자동으로 들어갑니다"
          style="height:32px;font-size:var(--fs-11)">기본 제공 ${boothInclCount(c)}건</button></span>` : ''}
      <span class="clf"><span class="clf-l"></span>
        <button class="btn" onclick="toggleCodeListRow('${escAttr(c.id)}')"
          style="height:32px;font-size:var(--fs-11)">${off ? '되살리기' : '숨김'}</button></span>`}
    </div>`;
  }).join('');
}

/* 한 행만 고치므로 객체형(upsertPartial) 경로를 쓴다 — 위치 배열로 보내면
   컬럼이 늘었을 때 안 보낸 칸이 비워진다 */
export const saveCodeRow = (row, label) =>
  postToSheet({ sheet: 'code_lists', action: 'upsertPartial', data: row }, label);

/* ══════════════════════════════════════════
   부스 타입별 기본 제공 품목

   부스에 딸려 오는 품목(인포데스크·의자·콘센트…)은 매뉴얼에만 있었고, 기업마다
   손으로 다시 적었다. 여기 적어 두면 부스 타입을 고르는 순간 신청항목에 들어간다.

   code_lists 행의 included 칸에 JSON 배열로 담는다 — [{cat, code, name, qty}].
   표를 따로 만들면 부스 타입을 지우거나 이름을 바꿀 때 짝이 어긋난다.
══════════════════════════════════════════ */
export function parseIncluded(raw){
  if(!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }
  catch(e){ return []; }
}
export const boothInclCount = (c) => parseIncluded(c.included).length;


export function openBoothIncluded(rowId){
  const c = CODE_LISTS.find(x => x.id === rowId);
  if(!c) return;
  settingsUi.bInclRow = c;
  settingsUi.bInclLines = parseIncluded(c.included);

  closeBoothIncluded();
  const pop = document.createElement('div');
  pop.id = 'bincl-modal';
  pop.className = 'mw on';
  let downOnBg = false;
  pop.addEventListener('mousedown', (e) => { downOnBg = (e.target === pop); });
  pop.addEventListener('click', (e) => { if(e.target === pop && downOnBg) closeBoothIncluded(); });
  pop.innerHTML = `<div class="modal" style="max-width:620px">
    <div class="mh"><div class="mt2">${escapeHtml(c.label || c.code)} — 기본 제공 품목</div>
      <div class="mc">이 부스 타입을 고르면 신청항목에 자동으로 들어갑니다. 청구에는 잡히지 않아요.</div></div>
    <div class="mb"><div id="bincl-body"></div></div>
    <div class="mf2">
      <button class="btn" onclick="closeBoothIncluded()">취소</button>
      <button class="btn bp" onclick="saveBoothIncluded()" id="bincl-save">저장</button>
    </div></div>`;
  document.body.appendChild(pop);
  renderBoothInclLines();
}
export function closeBoothIncluded(){ document.getElementById('bincl-modal')?.remove(); }

/* 품목코드를 치면 품명이 따라오게 목록을 붙여 둔다 — 부스 타입은 행사별이라
   그 행사의 품목표만 본다(공통 목록이면 붙일 품목표가 없다). */
function binclDatalist(){
  const ev = settingsUi.bInclRow?.event_id || '';
  if(!ev) return '';
  const list = EQUIP_CATALOG
    .filter(c => String(c.event_id || '') === String(ev) && c.active !== 'no')
    .sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'ko', { numeric: true }));
  if(!list.length) return '';
  return `<datalist id="bincl-cat">${list.map(c =>
    `<option value="${escapeHtml(c.code)}">${escapeHtml(`${c.name_ko || c.name_en || ''}`)}</option>`).join('')}</datalist>`;
}

export function renderBoothInclLines(){
  const el = document.getElementById('bincl-body');
  if(!el) return;
  const cats = [['equip', '비품'], ['graphic', '그래픽'], ['etc', '기타']];
  el.innerHTML = binclDatalist() + `
    <div style="display:flex;flex-direction:column;gap:6px">
      ${settingsUi.bInclLines.length ? settingsUi.bInclLines.map((o, n) => `
        <div style="display:flex;gap:6px;align-items:center">
          <select class="fi" style="flex:0 0 78px;font-size:var(--fs-11_5);padding:6px"
            onchange="editBoothInclLine(${n},'cat',this.value)">${cats.map(([v, l]) =>
              `<option value="${v}"${(o.cat || 'equip') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <input class="fi" style="flex:0 0 96px;font-size:var(--fs-11_5);padding:6px" list="bincl-cat"
            value="${escapeHtml(o.code || '')}" placeholder="품목코드"
            onchange="editBoothInclLine(${n},'code',this.value)">
          <input class="fi" style="flex:1 1 160px;min-width:0;font-size:var(--fs-11_5);padding:6px"
            value="${escapeHtml(o.name || '')}" placeholder="품명"
            onchange="editBoothInclLine(${n},'name',this.value)">
          <input class="fi" style="flex:0 0 62px;font-size:var(--fs-11_5);padding:6px"
            value="${escapeHtml(o.qty ?? '')}" placeholder="수량" inputmode="numeric"
            onchange="editBoothInclLine(${n},'qty',this.value)">
          <button class="btn" style="flex:0 0 auto;padding:4px 9px;font-size:var(--fs-11)"
            onclick="delBoothInclLine(${n})">삭제</button>
        </div>`).join('')
        : '<div style="font-size:var(--fs-11_5);color:var(--i4)">아직 없어요. 아래에서 한 줄씩 넣으세요.</div>'}
    </div>
    <button class="btn" style="margin-top:10px;font-size:var(--fs-11_5)" onclick="addBoothInclLine()">+ 한 줄 추가</button>
    <div style="font-size:var(--fs-11);color:var(--i4);margin-top:8px">
      품목코드를 적으면 품목표의 그 품목에 이어 붙습니다 — 발주서에서 같은 줄로 묶여요.
      코드가 없는 것(전기 별도 시공 등)은 비워 두고 품명만 적으면 됩니다.</div>`;
}

export function addBoothInclLine(){ settingsUi.bInclLines.push({ cat: 'equip', code: '', name: '', qty: '1' }); renderBoothInclLines(); }
export function delBoothInclLine(n){ settingsUi.bInclLines.splice(n, 1); renderBoothInclLines(); }
export function editBoothInclLine(n, field, v){
  if(!settingsUi.bInclLines[n]) return;
  settingsUi.bInclLines[n][field] = String(v || '').trim();
  // 코드만 치고 품명을 비워 뒀으면 품목표에서 이름을 가져다 채운다
  if(field === 'code' && !settingsUi.bInclLines[n].name){
    const hit = EQUIP_CATALOG.find(c => String(c.event_id || '') === String(settingsUi.bInclRow?.event_id || '')
      && String(c.code || '').toUpperCase() === String(v || '').trim().toUpperCase());
    if(hit) settingsUi.bInclLines[n].name = hit.name_ko || hit.name_en || '';
    renderBoothInclLines();
  }
}

/* 이 행사 참가기업 전체에 한 번에 넣는다 — 부스 타입이 바뀔 때만 깔리니,
   품목표를 나중에 적어 넣은 행사는 아무 기업에도 안 들어가 있다. */
export async function applyBoothItemsToEvent(evKey){
  const { exhibitorsForEvent } = await import('../../state.js');
  const { applyBoothItems, boothIncluded, isSharedBooth } = await import('../../modules/exh-tab.js');
  // 한 부스를 나눠 쓰는 쪽은 뺀다 — 부스에 딸려 오는 건 부스 하나에 하나씩이다
  const list = exhibitorsForEvent(evKey)
    .filter(x => !isSharedBooth(x) && boothIncluded(evKey, x.booth_type).length);
  if(!list.length){ alert('부스 타입이 정해진 참가기업이 없거나, 그 타입에 적어 둔 기본 제공 품목이 없어요.'); return; }
  if(!confirm(`참가기업 ${list.length}곳에 부스 타입별 기본 제공 품목을 넣을까요?
`
    + '이미 들어가 있는 곳은 그대로 두고, 기업이 따로 신청한 비품도 건드리지 않아요.')) return;
  for(const x of list) await applyBoothItems(x.id, x.booth_type);
  alert(`참가기업 ${list.length}곳에 반영했어요.`);
}

export async function saveBoothIncluded(){
  if(!settingsUi.bInclRow) return;
  const clean = settingsUi.bInclLines
    .map(o => ({ cat: o.cat || 'equip', code: String(o.code || '').trim(),
                 name: String(o.name || '').trim(), qty: String(o.qty ?? '').trim() }))
    .filter(o => o.code || o.name);

  const btn = document.getElementById('bincl-save');
  if(btn){ btn.disabled = true; btn.textContent = '저장 중…'; }

  const before = settingsUi.bInclRow.included || '';
  settingsUi.bInclRow.included = JSON.stringify(clean);
  const r = await saveCodeRow({ id: settingsUi.bInclRow.id, included: settingsUi.bInclRow.included }, '기본 제공 품목');
  if(!r.ok){
    settingsUi.bInclRow.included = before;                 // 저장 실패는 화면에도 남기지 않는다
    if(btn){ btn.disabled = false; btn.textContent = '저장'; }
    alert('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    return;
  }
  trackAction('edit', '기본 제공 품목', settingsUi.bInclRow.label || settingsUi.bInclRow.code,
    `<b>${escapeHtml(settingsUi.bInclRow.label || settingsUi.bInclRow.code)}</b>의 기본 제공 품목을 ${clean.length}건으로 정했어요`);
  closeBoothIncluded();
  reRenderFor('booth_type');
}

export async function addCodeListRow(){
  const key = clKey(), scope = clScope();
  const code = (document.getElementById('cl-new-code')?.value || '').trim();
  if(!code){ document.getElementById('cl-new-code')?.focus(); return; }
  if(clRowsOf(key, scope).some(c => c.code === code)){ alert('이미 있는 값이에요.'); return; }

  const rows = clRowsOf(key, scope);
  const row = {
    id: `CD-${key}-${scope ? clSlug(scope) + '-' : ''}${clSlug(code)}-${Math.random().toString(36).slice(2, 6)}`,
    list_key: key, event_id: scope, code,
    label: (document.getElementById('cl-new-label')?.value || '').trim() || code,
    cls: document.getElementById('cl-new-cls')?.value || '', note: '', active: '',
    sort_order: String((Number(rows[rows.length - 1]?.sort_order) || rows.length * 10) + 10),
  };
  CODE_LISTS.push(row);
  const r = await saveCodeRow(row, '선택 목록 추가');
  if(!r.ok){ CODE_LISTS.pop(); renderCodeList(); return; }   // 실패하면 되돌린다
  applyCodeLists();
  trackAction('edit', '선택 목록 추가', row.label,
    `${clDef(key).label}${scope ? `(${scope})` : ''}에 "${row.label}" 추가`);
  renderCodeList();
}

/* 고친 줄이 속한 편집기를 다시 그린다 — 두 편집기가 같은 표를 나눠 쓴다.
   전에는 늘 renderCodeList()만 불러, 표기 매핑을 고치면 화면이 그대로였다. */
function reRenderFor(listKey){
  if(listKey === 'cat_alias') renderAliasList(); else renderCodeList();
  // 행사 상세의 부스 칸도 같은 표를 본다 — 열려 있으면 함께 다시 그린다
  if(settingsUi.evDetailKey) window.renderEvDetail();
}

export async function editCodeListRow(id, field, value){
  const c = CODE_LISTS.find(x => x.id === id);
  if(!c) return;
  const prev = c[field] || '';
  const v = String(value ?? '').trim();
  if(v === prev) return;
  c[field] = v;
  const r = await saveCodeRow({ id, [field]: v }, '선택 목록 수정');
  if(!r.ok){ c[field] = prev; reRenderFor(c.list_key); return; }
  applyCodeLists();
  trackAction('edit', '선택 목록 수정', c.label || c.code,
    `${clDef(c.list_key).label} "${c.code}" ${field}: ${prev || '(빈값)'} → ${v || '(빈값)'}`);
  reRenderFor(c.list_key);
}

export async function toggleCodeListRow(id){
  const c = CODE_LISTS.find(x => x.id === id);
  if(!c) return;
  const off = c.active === 'no';
  // 표기 매핑은 저장된 값이 아니라 규칙이라, 끄면 벌어지는 일이 다르다
  const msg = c.list_key === 'cat_alias'
    ? `"${c.code}" 표기 매핑을 끌까요?
다음 업로드부터 기본 표대로 처리되고, 이미 저장된 연락처는 그대로입니다.`
    : `"${c.label || c.code}"을(를) 숨길까요?
앞으로 새로 고를 수 없지만, 이미 이 값으로 저장된 데이터는 그대로 남고 이름도 계속 보입니다.`;
  if(!off && !confirm(msg)) return;
  const prev = c.active || '';
  c.active = off ? '' : 'no';
  const r = await saveCodeRow({ id, active: c.active }, off ? '선택 목록 되살리기' : '선택 목록 숨김');
  if(!r.ok){ c.active = prev; reRenderFor(c.list_key); return; }
  applyCodeLists();
  trackAction('edit', off ? '선택 목록 되살리기' : '선택 목록 숨김', c.label || c.code,
    `${clDef(c.list_key).label} "${c.label || c.code}" ${off ? '되살림' : '숨김'}`);
  reRenderFor(c.list_key);
}

window.renderCodeListPicker = renderCodeListPicker;
window.renderCodeList       = renderCodeList;
window.addCodeListRow       = addCodeListRow;
window.editCodeListRow      = editCodeListRow;
window.toggleCodeListRow    = toggleCodeListRow;
window.openBoothIncluded    = openBoothIncluded;
window.closeBoothIncluded   = closeBoothIncluded;
window.addBoothInclLine     = addBoothInclLine;
window.delBoothInclLine     = delBoothInclLine;
window.editBoothInclLine    = editBoothInclLine;
window.saveBoothIncluded    = saveBoothIncluded;
window.applyBoothItemsToEvent = applyBoothItemsToEvent;

/* ══════════════════════════════════════════
   업로드 표기 → 카테고리 매핑 (code_lists.cat_alias)

   업로드한 명단의 역할 칸에는 행사마다 다른 자유 문구가 온다("Exhibitor Pass",
   "세션좌장", "일반참가자(사전등록)"…). utils.js에 90여 가지를 묶어 둔 기본 표가
   있지만, 새 표기가 나오거나 같은 표기를 다르게 분류하고 싶을 때가 있다.

   기본 표를 통째로 DB에 옮기지는 않는다 — 편집 화면이 90줄이 되면 정작 고쳐야
   할 줄이 묻힌다. 여기에는 기본값을 덮어쓰는 줄만 둔다.

   code에 표기, label에 카테고리 키를 담는다(utils.js normalizeCat이 그렇게 읽는다).
══════════════════════════════════════════ */
const aliasRows = () => CODE_LISTS
  .filter(c => c.list_key === 'cat_alias')
  .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));

export function renderAliasList(){
  const el = document.getElementById('alias-rows');
  if(!el) return;
  const rows = aliasRows();
  const catOpts = (sel) => CAT_KEYS.map(k =>
    `<option value="${escapeHtml(k)}"${sel === k ? ' selected' : ''}>${escapeHtml(CL[k] || k)}</option>`).join('');

  el.innerHTML = (rows.length ? rows.map(c => {
    const off = c.active === 'no';
    return `<div class="clrow" style="padding:6px 0;border-bottom:1px solid var(--i7)${off ? ';opacity:.5' : ''}">
      <label class="clf clf-grow"><span class="clf-l">표기</span>
        <input class="fi" value="${escapeHtml(c.code)}" placeholder="업로드에 적힌 표기" style="min-width:150px"
          onchange="editCodeListRow('${escAttr(c.id)}','code',this.value)"></label>
      <label class="clf"><span class="clf-l">→ 분류</span>
        <select class="fi" style="min-width:130px" onchange="editCodeListRow('${escAttr(c.id)}','label',this.value)">
          ${catOpts(c.label)}</select></label>
      <span class="clf"><span class="clf-l"></span>
        <button class="btn" onclick="toggleCodeListRow('${escAttr(c.id)}')"
          style="height:32px;font-size:var(--fs-11)">${off ? '되살리기' : '숨김'}</button></span>
    </div>`;
  }).join('') : '<div style="font-size:var(--fs-12);color:var(--i4)">아직 덮어쓴 표기가 없어요 — 전부 기본 표대로 처리됩니다.</div>')
    + `<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--i6)">
      <div style="flex:1;min-width:150px"><div class="mlbl">업로드에 적힌 표기</div>
        <input class="fi" id="alias-new-code" placeholder="예: Exhibitor Pass" style="width:100%"
          onkeydown="if(event.key==='Enter')addAliasRow()"></div>
      <div style="min-width:150px"><div class="mlbl">이 카테고리로</div>
        <select class="fi" id="alias-new-cat" style="width:100%">${catOpts('attendee')}</select></div>
      <button class="btn bp" onclick="addAliasRow()" style="min-width:60px;height:36px">추가</button>
    </div>
    <div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:8px">대소문자와 띄어쓰기는 무시하고 견줍니다. 바꾼 값은 <b>다음 업로드부터</b> 적용되고, 이미 저장된 연락처는 그대로입니다.</div>`;
}

export async function addAliasRow(){
  const code = (document.getElementById('alias-new-code')?.value || '').trim();
  if(!code){ document.getElementById('alias-new-code')?.focus(); return; }
  const norm = (v) => String(v).toLowerCase().replace(/\s+/g, '');
  if(aliasRows().some(c => norm(c.code) === norm(code))){ alert('이미 있는 표기예요.'); return; }

  const rows = aliasRows();
  const row = {
    id: `CD-cat_alias-${code.replace(/[^A-Za-z0-9가-힣]/g, '').slice(0, 24)}-${Math.random().toString(36).slice(2, 6)}`,
    list_key: 'cat_alias', event_id: '', code,
    label: document.getElementById('alias-new-cat')?.value || 'attendee',
    cls: '', note: '', active: '',
    sort_order: String((Number(rows[rows.length - 1]?.sort_order) || rows.length * 10) + 10),
  };
  CODE_LISTS.push(row);
  const r = await postToSheet({ sheet: 'code_lists', action: 'upsertPartial', data: row }, '표기 매핑 추가');
  if(!r.ok){ CODE_LISTS.pop(); renderAliasList(); return; }   // 실패하면 되돌린다
  trackAction('edit', '업로드 표기 매핑 추가', code, `"${code}" → ${CL[row.label] || row.label}`);
  const inp = document.getElementById('alias-new-code'); if(inp) inp.value = '';
  renderAliasList();
}

/* ══════════════════════════════════════════
   행사별 설정 요약 — 마감일·프로그램북 한도

   고치는 건 전시 탭에서 한다(그 행사를 고른 상태여야 어느 행사를 손대는지가
   분명하다). 여기서는 어느 행사에 무엇이 정해져 있는지 한눈에 보여준다 —
   설정값을 찾으러 여기 왔을 때 "여긴 없다"로 끝나면 안 된다.
══════════════════════════════════════════ */
export function renderEvCfgList(){
  const el = document.getElementById('evcfg-rows');
  if(!el) return;
  const keys = Object.keys(EXH_CFG);
  if(!keys.length){
    el.innerHTML = `<div style="font-size:var(--fs-12);color:var(--i4)">아직 정해 둔 행사가 없어요 —
      <b>전시</b> 탭 › 대시보드 › 단계별 진행 카드의 <b>마감일 설정</b>에서 정합니다.</div>`;
    return;
  }
  el.innerHTML = keys.map(k => {
    const cfg = EXH_CFG[k] || {};
    const due = Object.entries(cfg.due || {});
    const b = cfg.book || {};
    return `<div style="padding:8px 0;border-bottom:1px solid var(--i7)">
      <div style="font-size:var(--fs-12);font-weight:700;color:var(--i2);margin-bottom:4px">${escapeHtml(k)}</div>
      <div style="font-size:var(--fs-11);color:var(--i3)">
        ${due.length ? due.map(([sk, v]) =>
          `<span class="pill p-gray" style="margin:2px 3px 2px 0">${escapeHtml(DUE_LABEL[sk] || sk)} ${escapeHtml(v)}</span>`).join('')
          : '<span style="color:var(--i5)">마감일 없음</span>'}
      </div>
      <div style="font-size:var(--fs-11);color:var(--i4);margin-top:3px">프로그램북 한도 ${
        b.chars ? `${Number(b.chars).toLocaleString()}자 · ${b.words}단어` : '기본값(1,300자 · 200단어)'}</div>
    </div>`;
  }).join('')
    + `<div style="font-size:var(--fs-10_5);color:var(--i5);margin-top:8px">고치려면 <b>전시</b> 탭에서 그 행사를 고른 뒤 <b>마감일 설정</b>을 누르세요.</div>`;
}

window.renderAliasList = renderAliasList;
window.addAliasRow     = addAliasRow;
window.renderEvCfgList = renderEvCfgList;

/* «설정 › 비품 목록 (equip_catalog)»은 ../features/settings/equip-catalog.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */

/* 화면의 onclick이 부르는 것 */
window.mountCodeList = mountCodeList;   // 탭(settings-tab.js)이 window로 부른다
window.renderAliasList = renderAliasList;   // 탭(settings-tab.js)이 window로 부른다
