/* ══════════════════════════════════════════════════════════════
   features/settings/sector-tree.js — 섹터 트리·병합·묶기·편입
   (modules/settings-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { postToSheet } from '../../api.js';
import { deleteSectorRow, upsertSectorRow } from '../../api/settings-save.js';
import { trackAction } from '../../core/audit-log.js';
import { buildCoDB } from '../../domain/co-db.js';
import { UNASSIGNED_DOMAIN, collectUnregisteredSectors, computeSectorCompanyCounts, domainName, domainOfSector, joinSectors, mainSectors, parseSectors, sectorCountFor, sectorId, sectorName, subSectors } from '../../domain/sectors.js';
import { buildCoCAT, renderCoDashboard, setCoCat } from '../../modules/company-tab.js';
import { renderMDB } from '../../modules/db-tab.js';
import { API_BASE_URL, COMPANY_SECTORS, DOMAINS, EVENT_LIST, contacts, currentUser } from '../../state.js';
import { escAttr, escapeHtml, joinDomains, parseDomains, parseSectorScope, scopedSectorName, sectorKey, sectorRowValues, slugifySectorName } from '../../utils.js';
import { populateUploadEvDropdown } from '../upload/upload-event-select.js';
import { settingsUi } from './settings-ui.js';

/* ══════════════════════════════════════════
   섹터 트리 (원본 3707~3843행)
   메인 섹터 카드 안에 서브섹터를 들여쓰기로 표시, 드래그로 재배치

   ── 행사별 독립 트리(신규) ──
   섹터는 이제 "공통"(모든 행사 공유) 또는 특정 행사 전용으로 나뉜다.
   행사 전용 섹터는 name에 "행사짧은이름 · 섹터명" 접두어가 붙어 저장되고
   (utils.js의 scopedSectorName/parseSectorScope 참고 — sectors 시트
   스키마는 그대로 id/name/parent 3컬럼), 이 화면의 드롭다운으로 선택한
   범위(_sectorScope)에 해당하는 것만 트리에 걸러서 보여준다. */

/* 접힌 메인 섹터 id 집합 — 화면 전용 상태(저장 안 함). 같은 섹터가 여러
   분야 그룹에 반복 렌더링돼도 접기 상태는 섹터 id 기준으로 공유된다. */
const _collapsedMains = new Set();
export function toggleMainSectorCollapse(id){
  if(_collapsedMains.has(id)) _collapsedMains.delete(id);
  else _collapsedMains.add(id);
  renderSectorTree();
}

export function populateSectorScopeSelect(){
  const sel = document.getElementById('sector-scope-select');
  if(!sel) return;
  const cur = settingsUi.sectorScope;
  sel.innerHTML = '<option value="">공통 (모든 행사 공유)</option>' +
    EVENT_LIST.map(e => `<option value="${escapeHtml(e.short)}"${e.short===cur?' selected':''}>${escapeHtml(e.short)} 전용</option>`).join('');
  // 선택된 행사가 목록에서 사라졌으면 공통으로 되돌림
  if(cur && !EVENT_LIST.some(e => e.short === cur)){ settingsUi.sectorScope = ''; sel.value = ''; }
}

export function onSectorScopeChange(v){
  settingsUi.sectorScope = v || '';
  const titleEl = document.getElementById('sector-tree-title');
  if(titleEl) titleEl.textContent = settingsUi.sectorScope ? `섹터 트리 — ${settingsUi.sectorScope} 전용` : '섹터 트리 — 공통';
  renderSectorTree();
}

// 설정 화면에서 섹터를 클릭하면 기업DB로 이동해서 그 섹터로 바로 필터링 (원본 3707~3711행)
export function filterCoBySector(name){
  window.switchApp?.('co');
  setCoCat(name);
}

/* 현재 선택된 범위(_sectorScope)에 속하는 메인 섹터만 골라낸다 */
function mainSectorsInScope(){
  return mainSectors().filter(m => (parseSectorScope(m.name).eventShort || '') === settingsUi.sectorScope);
}

export function renderSectorTree(){
  const el = document.getElementById('sector-tree');
  if(!el) return;

  const mains = mainSectorsInScope();
  if(!mains.length){
    el.innerHTML = `<div style="font-size:var(--fs-12);color:var(--i4)">${settingsUi.sectorScope ? escapeHtml(settingsUi.sectorScope)+' 전용으로 ' : ''}등록된 섹터가 없어요. 아래에서 새로 만들어보세요.</div>`;
    return;
  }

  const counts = computeSectorCompanyCounts();
  const countBadge = cnt => `<span style="font-size:var(--fs-10);color:var(--i4);font-weight:400" title="클릭하면 기업DB에서 이 섹터로 필터링">${cnt||0}개사</span>`;

  // 분야 배정 체크박스 칩 (공통 트리의 메인 섹터 카드용) — 한 섹터가 여러
  // 분야에 동시에 속할 수 있어 단일 select 대신 다중 선택 칩으로 표시
  const domainSelect = m => {
    const cur = new Set(domainOfSector(m));
    return `<div style="display:flex;flex-wrap:wrap;gap:3px;align-items:center" title="이 섹터가 속한 분야 (여러 개 선택 가능)">
      ${DOMAINS.length ? DOMAINS.map(d => `
        <label style="display:inline-flex;align-items:center;gap:2px;font-size:var(--fs-10);cursor:pointer;border:1px solid ${cur.has(d.id)?'var(--a)':'var(--i6)'};color:${cur.has(d.id)?'var(--a)':'var(--i4)'};border-radius:var(--rd-10);padding:1px 6px 1px 4px">
          <input type="checkbox" style="width:10px;height:10px;margin:0" ${cur.has(d.id)?'checked':''}
            onchange="assignSectorDomain('${escAttr(m.id)}','${escAttr(d.id)}')">${escapeHtml(d.name)}
        </label>`).join('') : '<span style="font-size:var(--fs-10);color:var(--i4)">등록된 분야 없음</span>'}
    </div>`;
  };

  // 공통 섹터 연결 드롭다운 (행사 트리의 메인 섹터 카드용) —
  // 스코프 섹터는 분야를 직접 갖지 않고, 연결된 공통 섹터의 분야를 상속한다
  const commonMains = mainSectors().filter(s => !parseSectorScope(s.name).eventShort);
  const canonicalSelect = m => {
    const cur = m.canonical && commonMains.some(c => c.id === m.canonical) ? m.canonical : '';
    const inheritedDoms = domainOfSector(m);
    const badge = cur && inheritedDoms.length
      ? `<span style="font-size:var(--fs-10);color:var(--te);flex-shrink:0" title="연결된 공통 섹터의 분야를 상속">🗂 ${escapeHtml(inheritedDoms.map(domainName).join(', '))}</span>`
      : '';
    return `${badge}<select class="fi" style="font-size:var(--fs-10);padding:1px 4px;width:auto;max-width:150px" title="이 행사 섹터가 대응하는 공통 섹터 (분야 집계는 공통 기준으로 통합)"
      onchange="assignSectorCanonical('${escAttr(m.id)}', this.value)">
      <option value=""${!cur?' selected':''}>공통 미연결</option>
      ${commonMains.map(c => `<option value="${escapeHtml(c.id)}"${cur===c.id?' selected':''}>= ${escapeHtml(c.name)}</option>`).join('')}
    </select>`;
  };

  // 한 섹터가 여러 분야 그룹에 동시에 나타날 수 있어(예: Investor = BIO + VC),
  // "+서브 추가" 인라인 입력창의 DOM id가 그룹마다 겹치지 않도록 domTag(그룹 키)를
  // 붙여 고유화한다. 실제 부모 섹터 id(m.id)는 별도 인자로 그대로 전달.
  const mainCard = (m, domTag) => {
    const subs = subSectors(m.id);
    const uid = `${m.id}::${domTag}`;
    const collapsed = _collapsedMains.has(m.id);
    return `
    <div class="sector-tree-main" ondragover="event.preventDefault()" ondrop="onSectorDropToMain(event,'${m.id}')"
      style="border:1px solid var(--i6);border-radius:var(--r);padding:10px 12px;margin-bottom:8px;background:var(--W)">
      <div style="display:flex;align-items:center;gap:8px">
        <span onclick="toggleMainSectorCollapse('${escAttr(m.id)}')"
          style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:var(--fs-14);color:var(--i4);cursor:pointer;border-radius:var(--rd-4)"
          onmouseover="this.style.background='rgba(0,0,0,.08)'" onmouseout="this.style.background='none'" title="서브섹터 접기/펼치기">${collapsed?'▸':'▾'}</span>
        <span draggable="true" ondragstart="onSectorDragStart(event,'${m.id}')" onclick="filterCoBySector('${escAttr(m.name)}')"
          style="font-weight:700;font-size:var(--fs-13);flex:1;cursor:pointer" title="클릭하면 기업DB에서 이 섹터로 필터링">${escapeHtml(parseSectorScope(m.name).plainName)}</span>
        ${countBadge(sectorCountFor(counts, m.name))}
        ${settingsUi.sectorScope ? canonicalSelect(m) : domainSelect(m)}
        <button class="btn bs" style="font-size:var(--fs-11);padding:2px 8px" onclick="toggleSubAddInline('${escAttr(uid)}')">+ 서브</button>
        <button onclick="removeSectorById('${m.id}')"
          style="background:none;border:none;cursor:pointer;color:var(--i4);font-size:var(--fs-16);line-height:1"
          onmouseover="this.style.color='var(--re)'" onmouseout="this.style.color='var(--i4)'">×</button>
      </div>
      <div id="sub-add-inline-${escAttr(uid)}" style="display:none;margin-top:8px">
        <input class="fi" id="sub-add-input-${escAttr(uid)}" placeholder="서브 섹터명" style="width:60%;display:inline-block"
          onkeydown="if(event.key==='Enter')addSubSectorTo('${m.id}','${escAttr(uid)}')">
        <button class="btn bp" style="font-size:var(--fs-11)" onclick="addSubSectorTo('${m.id}','${escAttr(uid)}')">추가</button>
      </div>
      ${collapsed ? '' : `
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;padding-left:14px;min-height:20px">
        ${subs.length ? subs.map(s => `
          <span class="sector-chip" draggable="true" ondragstart="onSectorDragStart(event,'${s.id}')" onclick="filterCoBySector('${escAttr(s.name)}')"
            style="display:inline-flex;align-items:center;gap:5px;background:var(--i7);border:1px solid var(--i6);border-radius:var(--rd-20);padding:3px 10px;font-size:var(--fs-12);cursor:pointer" title="클릭하면 기업DB에서 이 섹터로 필터링">
            ↳ ${escapeHtml(parseSectorScope(s.name).plainName)} ${countBadge(sectorCountFor(counts, s.name))}
            <button onclick="event.stopPropagation();removeSectorById('${s.id}')"
              style="background:none;border:none;cursor:pointer;color:var(--i4);font-size:var(--fs-14);line-height:1;padding:0 0 0 2px"
              onmouseover="this.style.color='var(--re)'" onmouseout="this.style.color='var(--i4)'">×</button>
          </span>`).join('') : '<span style="font-size:var(--fs-11);color:var(--i4)">서브섹터 없음 — 드래그해서 넣을 수 있어요</span>'}
      </div>`}
    </div>`;
  };

  // 분야별 그룹핑: 분야 목록 순서대로 + 마지막에 미분류. 여러 분야에 속한
  // 섹터는 해당하는 모든 그룹에 카드가 반복해서 나타난다(다중 소속 표현).
  const groups = [];
  DOMAINS.forEach(d => {
    const ms = mains.filter(m => domainOfSector(m).includes(d.id));
    if(ms.length) groups.push({ tag: d.id, title: d.name, mains: ms });
  });
  const unassigned = mains.filter(m => !domainOfSector(m).length);
  if(unassigned.length) groups.push({ tag: UNASSIGNED_DOMAIN, title: '미분류', mains: unassigned });

  el.innerHTML = groups.map(g => `
    <div style="font-size:var(--fs-11);font-weight:700;color:var(--i3);margin:14px 0 6px;text-transform:uppercase;letter-spacing:.4px">
      🗂 ${escapeHtml(g.title)} <span style="font-weight:400;color:var(--i4)">(${g.mains.length})</span>
    </div>
    ${g.mains.map(m => mainCard(m, g.tag)).join('')}
  `).join('');
}

/* 행사 스코프 메인 섹터를 공통 섹터에 연결/해제 (행사 트리 카드의 드롭다운 onchange) */
export async function assignSectorCanonical(sectorId, canonicalId){
  const s = COMPANY_SECTORS.find(x => x.id === sectorId);
  if(!s) return;
  const prev = s.canonical || '';
  s.canonical = canonicalId || '';
  const r = await upsertSectorRow(s);
  if(!r.ok){ s.canonical = prev; window.renderSectorList(); return; } // 실패 시 롤백
  const targetName = canonicalId ? sectorName(canonicalId) : '미연결';
  trackAction('edit', '섹터 공통 연결', s.name,
    `행사 섹터 "${parseSectorScope(s.name).plainName}" 공통 연결: ${prev?sectorName(prev):'미연결'} → ${targetName}`);
  window.renderSectorList();
  try { buildCoCAT(); } catch(e){}
}

/* 메인 섹터의 분야 배정을 토글 (트리 카드의 체크박스 onchange) — 이미 속한
   분야면 해제, 아니면 추가. 한 섹터가 여러 분야에 동시에 속할 수 있다. */
export async function assignSectorDomain(sectorId, domainId){
  const s = COMPANY_SECTORS.find(x => x.id === sectorId);
  if(!s || !domainId) return;
  const prev = s.domain || '';
  const doms = parseDomains(prev);
  const idx = doms.indexOf(domainId);
  const added = idx < 0;
  if(added) doms.push(domainId); else doms.splice(idx, 1);
  s.domain = joinDomains(doms);
  const r = await upsertSectorRow(s);
  if(!r.ok){ s.domain = prev; window.renderSectorList(); return; } // 실패 시 롤백
  trackAction('edit', '섹터 분야 배정', s.name,
    `섹터 "${parseSectorScope(s.name).plainName}" 분야 ${added?'추가':'해제'}: ${domainName(domainId)}`);
  window.renderSectorList();
  try { buildCoCAT(); } catch(e){}
}

/* uid = "섹터id::그룹태그" — 다중 분야 소속 시 같은 섹터 카드가 여러 그룹에
   반복 렌더링돼도 인라인 입력창 DOM id가 겹치지 않도록 그룹별로 고유화한 값 */
export function toggleSubAddInline(uid){
  const target = document.getElementById('sub-add-inline-'+uid);
  if(!target) return;
  const willShow = target.style.display === 'none';
  document.querySelectorAll('[id^="sub-add-inline-"]').forEach(d => d.style.display = 'none');
  target.style.display = willShow ? 'block' : 'none';
  if(willShow){
    const inp = document.getElementById('sub-add-input-'+uid);
    if(inp) inp.focus();
  }
}

export async function addSubSectorTo(mainId, uid){
  const inp = document.getElementById('sub-add-input-'+(uid||mainId));
  const raw = inp ? inp.value.trim() : '';
  if(!raw){ inp && inp.focus(); return; }
  // 서브섹터도 부모와 같은 행사 범위 접두어를 붙여야 기업 배정 시 다른 행사의
  // 동명 섹터와 구분된다(예: "BK2025 전시 · Biotech" vs "KIC2025 · Biotech")
  const val = scopedSectorName(settingsUi.sectorScope, raw);
  if(COMPANY_SECTORS.some(s => sectorKey(typeof s==='string'?s:s.name) === sectorKey(val))){ alert('이미 있는 섹터예요.'); return; }

  const newId = slugifySectorName(val);
  const sector = { id: newId, name: val, parent: mainId, domain: '', canonical: '' };
  COMPANY_SECTORS.push(sector);
  window.renderSectorList();
  try { buildCoCAT(); populateUploadEvDropdown(); } catch(e){}
  await upsertSectorRow(sector);
}

export function onSectorDragStart(e, id){
  settingsUi.draggedSectorId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id); // Firefox 등에서 드래그 시작 요건 충족용
}

export async function onSectorDropToMain(e, mainId){
  e.preventDefault();
  const id = settingsUi.draggedSectorId;
  settingsUi.draggedSectorId = null;
  if(!id || id === mainId) return;
  const dragged = COMPANY_SECTORS.find(s => s.id === id);
  if(!dragged) return;
  if(!dragged.parent){
    alert('메인 섹터는 다른 메인 섹터의 하위로 옮길 수 없어요. 하위 섹터만 드래그할 수 있습니다.');
    return;
  }
  if(dragged.parent === mainId) return;
  dragged.parent = mainId;
  window.renderSectorList();
  try { buildCoCAT(); populateUploadEvDropdown(); } catch(e){}
  await upsertSectorRow(dragged);
}

export async function onSectorDropToRoot(e){
  e.preventDefault();
  const id = settingsUi.draggedSectorId;
  settingsUi.draggedSectorId = null;
  if(!id) return;
  const dragged = COMPANY_SECTORS.find(s => s.id === id);
  if(!dragged || !dragged.parent) return; // 이미 메인 섹터
  dragged.parent = null;
  window.renderSectorList();
  try { buildCoCAT(); populateUploadEvDropdown(); } catch(e){}
  await upsertSectorRow(dragged);
}

export async function removeSectorById(id){
  const idx = COMPANY_SECTORS.findIndex(s => s.id === id);
  if(idx < 0) return;
  const target = COMPANY_SECTORS[idx];
  const name = typeof target === 'string' ? target : target.name;
  const children = COMPANY_SECTORS.filter(s => s.parent === id);

  const msg = children.length
    ? `"${name}"에는 하위 섹터가 ${children.length}개 있어요. 삭제하면 하위 섹터들은 메인 섹터로 승격됩니다. 계속할까요?`
    : `"${name}" 섹터를 삭제할까요?`;
  if(!confirm(msg)) return;

  for(const child of children){
    child.parent = null;
    await upsertSectorRow(child);
  }
  // 이 섹터를 공통 연결(canonical)로 참조하던 스코프 섹터의 연결 해제 (유령 참조 방지)
  const linked = COMPANY_SECTORS.filter(s => s.canonical === id);
  if(linked.length){
    linked.forEach(s => { s.canonical = ''; });
    await postToSheet({
      sheet: 'sectors', action: 'batchUpsert',
      rows: linked.map(sectorRowValues),
    }, '섹터 연결 해제');
  }
  const gone = COMPANY_SECTORS[idx];
  COMPANY_SECTORS.splice(idx, 1);
  window.renderSectorList();
  try { buildCoCAT(); populateUploadEvDropdown(); } catch(e){}
  await deleteSectorRow(id);
  /* 지운 업종을 기록에 남긴다 — 여기서 아무것도 안 적고 있었다. 업종은 기업·
     연락처가 가리키는 값이라, 지우고 나면 무엇이 있었는지 알 길이 없다. */
  trackAction('delete', '업종 삭제', gone?.name || id,
    `업종 <b>${escapeHtml(gone?.name || id)}</b> 삭제`,
    { table: 'sectors', op: 'delete', row: id, before: gone || { id } });
}

// ── 구글시트 sectors 탭 행 순서를 "메인 → 그 서브섹터들" 순으로 재배열 (가독성 정리용, 원본 3844~3875행) ──
export async function reorganizeSectorsSheet(){
  if(!COMPANY_SECTORS.length){ alert('정렬할 섹터가 없어요.'); return; }
  if(!API_BASE_URL || !currentUser){ alert('서버 연동 정보가 없어요.'); return; }

  const collator = (a,b) => String(a).localeCompare(String(b), 'ko');
  const mains = mainSectors().slice().sort((a,b) => collator(a.name, b.name));

  const ordered = [];
  mains.forEach(m => {
    ordered.push(m);
    subSectors(m.id).slice().sort((a,b) => collator(a.name, b.name)).forEach(s => ordered.push(s));
  });
  // 부모가 삭제되는 등으로 어디에도 안 걸린 고아 섹터는 맨 뒤에 붙여서 누락 없이 보존
  COMPANY_SECTORS.forEach(s => { if(!ordered.includes(s)) ordered.push(s); });

  if(!confirm(`섹터 ${ordered.length}개를 메인 → 서브 순서로 구글시트에 재정렬할까요?`)) return;

  // ⚠ replaceAll은 rows 폭만큼만 재작성하므로 반드시 domain까지 4컬럼으로 보낸다
  const rows = ordered.map(sectorRowValues);
  const r = await postToSheet({ sheet: 'sectors', action: 'replaceAll', rows }, '섹터 정렬');
  if(r.ok){
    COMPANY_SECTORS.splice(0, COMPANY_SECTORS.length, ...ordered);
    window.renderSectorList();
    alert('정렬 완료했어요. 구글시트에서 확인해 보세요.');
  } else {
    alert('정렬 저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
  }
}

/* ══════════════════════════════════════════
   섹터 병합 (원본 3877~3953행)
══════════════════════════════════════════ */
export function renderSectorMergeList(){
  const listEl = document.getElementById('sector-merge-list');
  const keepSel = document.getElementById('sector-merge-keep');
  if(!listEl || !keepSel) return;

  listEl.innerHTML = COMPANY_SECTORS.length
    ? COMPANY_SECTORS.map(s => {
        const isSub = !!s.parent;
        const parentName = isSub ? (sectorName(s.parent) + ' › ') : '';
        return `<label style="display:flex;align-items:center;gap:8px;font-size:var(--fs-12);padding:3px 0;cursor:pointer${isSub?';padding-left:16px':''}">
          <input type="checkbox" class="sector-merge-chk" value="${s.id}">
          ${isSub?`<span style="color:var(--i4);font-size:var(--fs-11)">${escapeHtml(parentName)}</span>`:''}${escapeHtml(s.name)}
        </label>`;
      }).join('')
    : '<div style="font-size:var(--fs-12);color:var(--i4)">등록된 섹터 없음</div>';

  const cur = keepSel.value;
  keepSel.innerHTML = COMPANY_SECTORS.map(s =>
      `<option value="${s.id}"${s.id===cur?' selected':''}>${escapeHtml(s.name)}</option>`
    ).join('');
}

export async function mergeSectors(){
  const checked = Array.from(document.querySelectorAll('.sector-merge-chk:checked')).map(el => el.value);
  if(checked.length < 2){ alert('합칠 섹터를 2개 이상 선택하세요.'); return; }

  const keepSel = document.getElementById('sector-merge-keep');
  const keepId = keepSel ? keepSel.value : '';
  if(!checked.includes(keepId)){ alert('"남길 섹터"도 체크리스트에서 선택되어 있어야 해요.'); return; }

  const keepSector = COMPANY_SECTORS.find(s => s.id === keepId);
  if(!keepSector) return;
  const removeIds   = checked.filter(id => id !== keepId);
  const removeNames = removeIds.map(id => (COMPANY_SECTORS.find(s => s.id === id)||{}).name).filter(Boolean);

  if(!confirm(`"${removeNames.join(', ')}" 을(를) "${keepSector.name}"(으)로 합칠까요?\n연결된 기업의 섹터 값도 함께 정리되고, 병합되는 섹터는 삭제됩니다.`)) return;

  // 1) 연락처(beat)에 들어있는 옛 섹터명을 keepSector 이름으로 교체
  //    ⚠ 수정: 기존엔 연락처마다 개별 upsert를 순차 전송해 대상이 많으면
  //    부분 실패로 시트/화면 불일치가 생겼다 — batchUpsert 1회로 묶는다.
  let updatedContacts = 0;
  const changedContacts = [];
  for(const c of contacts){
    if(!c.beat) continue;
    const arr = parseSectors(c.beat);
    if(!arr.some(s => removeNames.includes(s))) continue;
    const newArr = [];
    arr.forEach(s => {
      const mapped = removeNames.includes(s) ? keepSector.name : s;
      if(!newArr.includes(mapped)) newArr.push(mapped);
    });
    c.beat = joinSectors(newArr);
    updatedContacts++;
    changedContacts.push(c);
  }
  if(changedContacts.length){
    const r = await postToSheet({
      sheet: 'contacts', action: 'batchUpsert',
      rows: changedContacts.map(c => [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
            c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2,
            c.beat||'', c.products||'', c.tags||'', c.org_id||'']),
    }, '섹터 병합 - 연락처 반영');
    if(!r.ok){
      alert('연락처 반영 저장에 실패해서 병합을 중단했어요. 새로고침 후 다시 시도해주세요.');
      return;
    }
  }

  // 2) 병합 대상 섹터의 자식(서브섹터)을 남는 섹터 아래로 재부모화
  //    (기존엔 자식들이 삭제된 부모 id를 가리킨 채 트리에서 사라지는 유령 데이터가 됐음)
  for(const s of COMPANY_SECTORS){
    if(s.parent && removeIds.includes(s.parent) && !removeIds.includes(s.id)){
      s.parent = keepId;
      await upsertSectorRow(s);
    }
  }

  // 2.5) 병합 대상을 공통 연결(canonical)로 참조하던 스코프 섹터는 남는 섹터로 재연결
  for(const s of COMPANY_SECTORS){
    if(s.canonical && removeIds.includes(s.canonical) && !removeIds.includes(s.id)){
      s.canonical = keepId;
      await upsertSectorRow(s);
    }
  }

  // 3) 병합된(삭제 대상) 섹터 제거
  for(const id of removeIds){
    const idx = COMPANY_SECTORS.findIndex(s => s.id === id);
    if(idx >= 0) COMPANY_SECTORS.splice(idx, 1);
    await deleteSectorRow(id);
  }

  trackAction('edit', '섹터 병합', keepSector.name,
    `섹터 병합: ${removeNames.join(', ')} → ${keepSector.name} (연락처 ${updatedContacts}건)`);

  window.renderSectorList();
  try {
    buildCoDB(); buildCoCAT(); renderMDB();
    if(document.getElementById('co-dash')) renderCoDashboard();
  } catch(e){}
  alert(`"${removeNames.join(', ')}" → "${keepSector.name}" 로 병합했어요. (연락처 ${updatedContacts}건 업데이트)`);
}

/* ══════════════════════════════════════════
   미등록 섹터 그룹으로 묶기 (원본 3971~4036행)
══════════════════════════════════════════ */
export function renderUnregisteredSectors(){
  const listEl = document.getElementById('sector-unreg-list');
  const groupSel = document.getElementById('sector-unreg-group');
  if(!listEl || !groupSel) return;

  const unreg = collectUnregisteredSectors();
  listEl.innerHTML = unreg.length
    ? unreg.map(u => `
        <label style="display:flex;align-items:center;gap:8px;font-size:var(--fs-12);padding:3px 0;cursor:pointer">
          <input type="checkbox" class="sector-unreg-chk" value="${escapeHtml(u.name)}">
          ${escapeHtml(u.name)}<span style="color:var(--i4);font-size:var(--fs-11)">(${u.count}개사)</span>
        </label>`).join('')
    : '<div style="font-size:var(--fs-12);color:var(--i4)">미등록 섹터 없음 — 업로드 데이터의 섹터 값이 모두 등록돼 있어요</div>';

  const cur = groupSel.value;
  groupSel.innerHTML = mainSectors().map(s =>
      `<option value="${s.id}"${s.id===cur?' selected':''}>${escapeHtml(s.name)}</option>`
    ).join('') + '<option value="__new__">+ 새 그룹 만들기…</option>';
}

export async function applySectorGrouping(){
  const checked = Array.from(document.querySelectorAll('.sector-unreg-chk:checked')).map(el => el.value);
  if(!checked.length){ alert('그룹으로 묶을 섹터를 선택하세요.'); return; }

  const groupSel = document.getElementById('sector-unreg-group');
  let groupId = groupSel ? groupSel.value : '';

  if(groupId === '__new__'){
    const name = prompt('새 그룹(메인 섹터) 이름을 입력하세요. 예: BIO');
    if(!name || !name.trim()) return;
    const trimmed = name.trim();
    if(COMPANY_SECTORS.some(s => sectorKey(typeof s==='string'?s:s.name) === sectorKey(trimmed))){ alert('이미 있는 섹터명이에요.'); return; }
    groupId = slugifySectorName(trimmed);
    const groupSector = { id: groupId, name: trimmed, parent: null, domain: '', canonical: '' };
    COMPANY_SECTORS.push(groupSector);
    await upsertSectorRow(groupSector);
  }

  if(!groupId){ alert('그룹을 선택하거나 새로 만들어주세요.'); return; }

  for(let i = 0; i < checked.length; i++){
    const name = checked[i];
    if(COMPANY_SECTORS.some(s => sectorKey(typeof s==='string'?s:s.name) === sectorKey(name))) continue;
    const newId = slugifySectorName(name);
    const sector = { id: newId, name, parent: groupId, domain: '', canonical: '' };
    COMPANY_SECTORS.push(sector);
    await upsertSectorRow(sector);
  }

  window.renderSectorList();
  try {
    buildCoCAT(); populateUploadEvDropdown();
    if(document.getElementById('co-dash')) renderCoDashboard();
  } catch(e){}
  alert(checked.length + '개 섹터를 그룹에 포함했어요.');
}

/* ══════════════════════════════════════════
   이미 등록된 메인 섹터를 다른 그룹(메인)의 서브로 편입 (원본 4038~4117행)
══════════════════════════════════════════ */
export function renderMainConvertList(){
  const listEl = document.getElementById('mainconv-list');
  const groupSel = document.getElementById('mainconv-group');
  if(!listEl || !groupSel) return;

  const mains = mainSectors();
  listEl.innerHTML = mains.length
    ? mains.map(m => {
        const childCount = subSectors(m.id).length;
        return `<label style="display:flex;align-items:center;gap:8px;font-size:var(--fs-12);padding:3px 0;cursor:pointer">
          <input type="checkbox" class="mainconv-chk" value="${m.id}">
          ${escapeHtml(m.name)}${childCount ? `<span style="color:var(--i4);font-size:var(--fs-11)">(서브 ${childCount}개 포함)</span>` : ''}
        </label>`;
      }).join('')
    : '<div style="font-size:var(--fs-12);color:var(--i4)">등록된 메인 섹터 없음</div>';

  const cur = groupSel.value;
  groupSel.innerHTML = mains.map(m =>
      `<option value="${m.id}"${m.id===cur?' selected':''}>${escapeHtml(m.name)}</option>`
    ).join('') + '<option value="__new__">+ 새 그룹 만들기…</option>';

  const allChk = document.getElementById('mainconv-all');
  if(allChk) allChk.checked = false;
}

export function toggleAllMainConv(chk){
  document.querySelectorAll('.mainconv-chk').forEach(el => { el.checked = chk.checked; });
}

export async function convertMainsToGroup(){
  const groupSel = document.getElementById('mainconv-group');
  let groupId = groupSel ? groupSel.value : '';

  // "전체 선택"으로 그룹 대상 자신이 함께 체크됐으면 조용히 제외 (자기 자신을 자기 하위로 넣을 수 없음)
  const checked = Array.from(document.querySelectorAll('.mainconv-chk:checked'))
    .map(el => el.value)
    .filter(id => id !== groupId);
  if(!checked.length){ alert('그룹으로 편입할 메인 섹터를 선택하세요.'); return; }

  if(groupId === '__new__'){
    const name = prompt('새 그룹(메인 섹터) 이름을 입력하세요. 예: BIO');
    if(!name || !name.trim()) return;
    const trimmed = name.trim();
    if(COMPANY_SECTORS.some(s => sectorKey(typeof s==='string'?s:s.name) === sectorKey(trimmed))){ alert('이미 있는 섹터명이에요.'); return; }
    groupId = slugifySectorName(trimmed);
    const groupSector = { id: groupId, name: trimmed, parent: null, domain: '', canonical: '' };
    COMPANY_SECTORS.push(groupSector);
    await upsertSectorRow(groupSector);
  }
  if(!groupId){ alert('그룹을 선택하거나 새로 만들어주세요.'); return; }

  // 선택된 메인 섹터에 이미 서브섹터가 있으면, 3단계 계층이 생기지 않도록 그 서브섹터들도 함께 그룹 하위로 평탄화
  const toReparent = new Set(checked);
  checked.forEach(id => {
    COMPANY_SECTORS.filter(s => s.parent === id).forEach(child => toReparent.add(child.id));
  });
  toReparent.delete(groupId);

  const groupName = (COMPANY_SECTORS.find(s => s.id === groupId) || {}).name || groupId;
  const targets = [...toReparent].map(id => COMPANY_SECTORS.find(s => s.id === id)).filter(Boolean);
  if(!confirm(`${targets.length}개 섹터를 "${groupName}" 그룹 하위로 편입할까요?`)) return;

  // 서브가 되는 섹터는 분야 배정을 비운다 (분야는 메인 섹터에만 저장 — 부모를 따라가게 됨)
  targets.forEach(s => { s.parent = groupId; s.domain = ''; });

  // 개별 요청 대신 한 번의 batchUpsert로 전부 저장 (요청 수를 크게 줄여 안정성 확보)
  if(targets.length){
    const rows = targets.map(sectorRowValues);
    await postToSheet({ sheet: 'sectors', action: 'batchUpsert', rows }, '섹터 그룹 편입');
  }

  window.renderSectorList();
  try {
    buildCoCAT(); populateUploadEvDropdown();
    if(document.getElementById('co-dash')) renderCoDashboard();
  } catch(e){}
  alert(`${targets.length}개 섹터를 "${groupName}" 하위로 편입했어요.`);
}

/* «설정 › 새 메인 섹터 추가»은 ../features/settings/sector-add-main.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */

/* 화면의 onclick이 부르는 것 */
window.filterCoBySector      = filterCoBySector;
window.onSectorDragStart     = onSectorDragStart;
window.onSectorDropToMain    = onSectorDropToMain;
window.onSectorDropToRoot    = onSectorDropToRoot;
window.toggleSubAddInline    = toggleSubAddInline;
window.toggleMainSectorCollapse = toggleMainSectorCollapse;
window.addSubSectorTo        = addSubSectorTo;
window.removeSectorById      = removeSectorById;
window.reorganizeSectorsSheet= reorganizeSectorsSheet;
window.mergeSectors          = mergeSectors;
window.applySectorGrouping   = applySectorGrouping;
window.toggleAllMainConv     = toggleAllMainConv;
window.convertMainsToGroup   = convertMainsToGroup;
window.onSectorScopeChange   = onSectorScopeChange;
window.assignSectorDomain     = assignSectorDomain;
window.assignSectorCanonical  = assignSectorCanonical;
