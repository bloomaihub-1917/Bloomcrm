/* ══════════════════════════════════════════════════════════════
   settings-tab.js — 설정(arch) 탭
   (원본 contact_crm.html 1116~1410행 마크업 + 3685~4174행,
    5996~6116행, 6291~6350행대, 6353~6376행, 6421~6537행,
    6439~6450행, 3169~3174행 JS에서 정리)

   설정 탭은 3개 하위탭으로 구성됨:
   1) 행사 관리(ev)   — EVENT_LIST 추가/삭제, 국가명·기업명 데이터 정리
   2) 기업 섹터(sector) — COMPANY_SECTORS 트리(드래그앤드롭 재배치),
                          섹터 병합/그룹핑, 참가 유형(PART_TYPES) 관리
   3) 시스템 구조(sys)  — 정적 다이어그램(전체 아키텍처/구글시트/업무 플로우)
                          전환만 하는 switchAV — 다이어그램 자체는
                          index.html 정적 마크업에 그대로 남아있음

   이 모듈이 소유하지 않는 것:
   - renderSimilarCompanyList / findSimilarCompanyPairs → company-tab.js가
     window에 등록(섹터 탭 하위 "유사 기업명 찾기" 버튼에서 인라인 onclick
     으로 호출되므로 여기서 import할 필요는 없음)
   - buildCoCAT / buildCoDB / renderCoDashboard / setCoCat → company-tab.js,
     renderMDB / buildMDBEvList → db-tab.js, populateUploadEvDropdown →
     upload-tab.js. company-tab.js/db-tab.js가 이 파일의 parseSectors 등을
     역으로 import하므로 순환 참조가 생기지만, 실제 호출은 전부 이벤트
     핸들러 안(모듈 최상단 평가 이후)에서만 일어나 ES 모듈에서 안전하다.
   - switchApp → router.js. router.js가 모든 tab 모듈을 최상위에서
     import/조립하는 진입점이라 여기서 역참조하면 순환이 더 꼬이므로,
     router.js가 `window.switchApp = switchApp`로 등록해 둔 것을
     `window.switchApp?.()`로만 호출한다.
═══════════════════════════════════════════════════════════════ */

import {
  API_BASE_URL,
  currentUser,
  contacts,
  participations,
  CO_DB,
  ORGS,
  EVENT_LIST,
  COMPANY_SECTORS,
  DOMAINS,
  TAGS,
  PART_TYPES,
  CODE_LISTS,
  applyCodeLists,
  EXH_CFG,
  EQUIP_CATALOG,
  EXH_ITEMS,
  evParts,
  evPartDone,
  codeList,
  confCfg, confDays, speakerNeed,
  CONF_SESSIONS, EXHIBITORS, SPEAKERS, SPEAKER_LOGS, EXH_LOGS,
  syncPartColors,
} from '../state.js';
import { isUnread, isPending, runMailSync } from '../shared/mail/mail-mark.js';
import { dueInputHtml, readDueInput, followCfg, FOLLOW_DEFAULT } from '../shared/mail/follow-up.js';
import { exhMailSteps, exhMailFileStep } from './exh-mail.js';
import './exh-mail-editor.js';

import {
  upsertSectorRow,
  deleteSectorRow,
  upsertPartTypeRow,
  deletePartTypeRow,
  saveEventToSheet,
  deleteEventFromSheet,
  postToSheet,
  safeFetch,
  authHeaders,
  saveDomains,
  saveTags,
  saveEquipCatalog,
  deleteEquipCatalog,
  saveExhCfgToSheet,
  saveConfSession,
  loadMailFiles, mailFilesOf, uploadMailFile, deleteMailFile, fileToBase64,
  loadMailAccounts, saveMailAccount, loadMailFooter, saveMailFooter, deleteMailAccount, testMailAccount, eventMailFrom, syncSentMail, syncInboxMail, reloadSpeakerData,
} from '../api.js';
import { trackAction, changed, removed } from '../core/audit-log.js';

import { TRACK_COLORS, trackColorOf, trackColorIndex, pickTrackColorIndex } from '../track-colors.js';
import { flowSteps } from './speaker-flow.js';
import { openFlowEditor } from '../shared/mail/flow-editor.js';
import { CL, CAT_KEYS, EVENT_PARTS, PART_STATES, partStateOf,
  SPEAKER_ROLES, SPEAKER_NEEDS, SPEAKER_NEEDS_ON_TALK,
  NEED_CYCLE, NEED_MARK, NEED_LABEL } from '../constants.js';
import { slugifySectorName, escapeHtml, escAttr, countryName, scopedSectorName, parseSectorScope, sectorRowValues, sectorKey, parseDomains, joinDomains } from '../utils.js';
import { buildCoCAT, renderCoDashboard, setCoCat } from './company-tab.js';
import { buildCoDB } from '../domain/co-db.js';
import { renderMDB, buildMDBEvList, buildMDBTagList } from './db-tab.js';
import { populateUploadEvDropdown } from '../features/upload/upload-event-select.js';
import { renderAiSettings } from './ai-settings.js';
import { contactFillCount, renderContactFill, enrichCounts, saveOrgFields } from './data-clean.js';
/* 화면 상태는 settingsUi 한곳에 둔다 — 이 탭의 구획을 다른 파일로 떼어도 같은 값을 보게 */
import { settingsUi } from '../features/settings/settings-ui.js';

/* 드래그 중인 섹터 id (원본 3693행 전역 변수 → 모듈 스코프로 축소) */

/* 14개 함수를 ../domain/sectors.js로 옮겼다 — 이 파일에서도 쓰고, 옛 경로로 가져가는 곳도 있어 다시 내보낸다 */
import { sectorName, sectorId, findSectorByName, parseSectors, joinSectors, mainSectors, subSectors, UNASSIGNED_DOMAIN, domainName, domainOfSector, sectorNamesInDomain, computeSectorCompanyCounts, sectorCountFor, collectUnregisteredSectors } from '../domain/sectors.js';
export { sectorName, sectorId, findSectorByName, parseSectors, joinSectors, mainSectors, subSectors, UNASSIGNED_DOMAIN, domainName, domainOfSector, sectorNamesInDomain, computeSectorCompanyCounts, sectorCountFor, collectUnregisteredSectors } from '../domain/sectors.js';

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
    el.innerHTML = `<div style="font-size:12px;color:var(--i4)">${settingsUi.sectorScope ? escapeHtml(settingsUi.sectorScope)+' 전용으로 ' : ''}등록된 섹터가 없어요. 아래에서 새로 만들어보세요.</div>`;
    return;
  }

  const counts = computeSectorCompanyCounts();
  const countBadge = cnt => `<span style="font-size:10px;color:var(--i4);font-weight:400" title="클릭하면 기업DB에서 이 섹터로 필터링">${cnt||0}개사</span>`;

  // 분야 배정 체크박스 칩 (공통 트리의 메인 섹터 카드용) — 한 섹터가 여러
  // 분야에 동시에 속할 수 있어 단일 select 대신 다중 선택 칩으로 표시
  const domainSelect = m => {
    const cur = new Set(domainOfSector(m));
    return `<div style="display:flex;flex-wrap:wrap;gap:3px;align-items:center" title="이 섹터가 속한 분야 (여러 개 선택 가능)">
      ${DOMAINS.length ? DOMAINS.map(d => `
        <label style="display:inline-flex;align-items:center;gap:2px;font-size:10px;cursor:pointer;border:1px solid ${cur.has(d.id)?'var(--a)':'var(--i6)'};color:${cur.has(d.id)?'var(--a)':'var(--i4)'};border-radius:10px;padding:1px 6px 1px 4px">
          <input type="checkbox" style="width:10px;height:10px;margin:0" ${cur.has(d.id)?'checked':''}
            onchange="assignSectorDomain('${escAttr(m.id)}','${escAttr(d.id)}')">${escapeHtml(d.name)}
        </label>`).join('') : '<span style="font-size:10px;color:var(--i4)">등록된 분야 없음</span>'}
    </div>`;
  };

  // 공통 섹터 연결 드롭다운 (행사 트리의 메인 섹터 카드용) —
  // 스코프 섹터는 분야를 직접 갖지 않고, 연결된 공통 섹터의 분야를 상속한다
  const commonMains = mainSectors().filter(s => !parseSectorScope(s.name).eventShort);
  const canonicalSelect = m => {
    const cur = m.canonical && commonMains.some(c => c.id === m.canonical) ? m.canonical : '';
    const inheritedDoms = domainOfSector(m);
    const badge = cur && inheritedDoms.length
      ? `<span style="font-size:10px;color:var(--te);flex-shrink:0" title="연결된 공통 섹터의 분야를 상속">🗂 ${escapeHtml(inheritedDoms.map(domainName).join(', '))}</span>`
      : '';
    return `${badge}<select class="fi" style="font-size:10px;padding:1px 4px;width:auto;max-width:150px" title="이 행사 섹터가 대응하는 공통 섹터 (분야 집계는 공통 기준으로 통합)"
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
      style="border:1px solid var(--i6);border-radius:8px;padding:10px 12px;margin-bottom:8px;background:var(--W)">
      <div style="display:flex;align-items:center;gap:8px">
        <span onclick="toggleMainSectorCollapse('${escAttr(m.id)}')"
          style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;color:var(--i4);cursor:pointer;border-radius:4px"
          onmouseover="this.style.background='rgba(0,0,0,.08)'" onmouseout="this.style.background='none'" title="서브섹터 접기/펼치기">${collapsed?'▸':'▾'}</span>
        <span draggable="true" ondragstart="onSectorDragStart(event,'${m.id}')" onclick="filterCoBySector('${escAttr(m.name)}')"
          style="font-weight:700;font-size:13px;flex:1;cursor:pointer" title="클릭하면 기업DB에서 이 섹터로 필터링">${escapeHtml(parseSectorScope(m.name).plainName)}</span>
        ${countBadge(sectorCountFor(counts, m.name))}
        ${settingsUi.sectorScope ? canonicalSelect(m) : domainSelect(m)}
        <button class="btn bs" style="font-size:11px;padding:2px 8px" onclick="toggleSubAddInline('${escAttr(uid)}')">+ 서브</button>
        <button onclick="removeSectorById('${m.id}')"
          style="background:none;border:none;cursor:pointer;color:var(--i4);font-size:16px;line-height:1"
          onmouseover="this.style.color='var(--re)'" onmouseout="this.style.color='var(--i4)'">×</button>
      </div>
      <div id="sub-add-inline-${escAttr(uid)}" style="display:none;margin-top:8px">
        <input class="fi" id="sub-add-input-${escAttr(uid)}" placeholder="서브 섹터명" style="width:60%;display:inline-block"
          onkeydown="if(event.key==='Enter')addSubSectorTo('${m.id}','${escAttr(uid)}')">
        <button class="btn bp" style="font-size:11px" onclick="addSubSectorTo('${m.id}','${escAttr(uid)}')">추가</button>
      </div>
      ${collapsed ? '' : `
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;padding-left:14px;min-height:20px">
        ${subs.length ? subs.map(s => `
          <span class="sector-chip" draggable="true" ondragstart="onSectorDragStart(event,'${s.id}')" onclick="filterCoBySector('${escAttr(s.name)}')"
            style="display:inline-flex;align-items:center;gap:5px;background:var(--i7);border:1px solid var(--i6);border-radius:20px;padding:3px 10px;font-size:12px;cursor:pointer" title="클릭하면 기업DB에서 이 섹터로 필터링">
            ↳ ${escapeHtml(parseSectorScope(s.name).plainName)} ${countBadge(sectorCountFor(counts, s.name))}
            <button onclick="event.stopPropagation();removeSectorById('${s.id}')"
              style="background:none;border:none;cursor:pointer;color:var(--i4);font-size:14px;line-height:1;padding:0 0 0 2px"
              onmouseover="this.style.color='var(--re)'" onmouseout="this.style.color='var(--i4)'">×</button>
          </span>`).join('') : '<span style="font-size:11px;color:var(--i4)">서브섹터 없음 — 드래그해서 넣을 수 있어요</span>'}
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
    <div style="font-size:11px;font-weight:700;color:var(--i3);margin:14px 0 6px;text-transform:uppercase;letter-spacing:.4px">
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
  if(!r.ok){ s.canonical = prev; renderSectorList(); return; } // 실패 시 롤백
  const targetName = canonicalId ? sectorName(canonicalId) : '미연결';
  trackAction('edit', '섹터 공통 연결', s.name,
    `행사 섹터 "${parseSectorScope(s.name).plainName}" 공통 연결: ${prev?sectorName(prev):'미연결'} → ${targetName}`);
  renderSectorList();
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
  if(!r.ok){ s.domain = prev; renderSectorList(); return; } // 실패 시 롤백
  trackAction('edit', '섹터 분야 배정', s.name,
    `섹터 "${parseSectorScope(s.name).plainName}" 분야 ${added?'추가':'해제'}: ${domainName(domainId)}`);
  renderSectorList();
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
  renderSectorList();
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
  renderSectorList();
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
  renderSectorList();
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
  renderSectorList();
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
    renderSectorList();
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
        return `<label style="display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0;cursor:pointer${isSub?';padding-left:16px':''}">
          <input type="checkbox" class="sector-merge-chk" value="${s.id}">
          ${isSub?`<span style="color:var(--i4);font-size:11px">${escapeHtml(parentName)}</span>`:''}${escapeHtml(s.name)}
        </label>`;
      }).join('')
    : '<div style="font-size:12px;color:var(--i4)">등록된 섹터 없음</div>';

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

  renderSectorList();
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
        <label style="display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0;cursor:pointer">
          <input type="checkbox" class="sector-unreg-chk" value="${escapeHtml(u.name)}">
          ${escapeHtml(u.name)}<span style="color:var(--i4);font-size:11px">(${u.count}개사)</span>
        </label>`).join('')
    : '<div style="font-size:12px;color:var(--i4)">미등록 섹터 없음 — 업로드 데이터의 섹터 값이 모두 등록돼 있어요</div>';

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

  renderSectorList();
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
        return `<label style="display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0;cursor:pointer">
          <input type="checkbox" class="mainconv-chk" value="${m.id}">
          ${escapeHtml(m.name)}${childCount ? `<span style="color:var(--i4);font-size:11px">(서브 ${childCount}개 포함)</span>` : ''}
        </label>`;
      }).join('')
    : '<div style="font-size:12px;color:var(--i4)">등록된 메인 섹터 없음</div>';

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

  renderSectorList();
  try {
    buildCoCAT(); populateUploadEvDropdown();
    if(document.getElementById('co-dash')) renderCoDashboard();
  } catch(e){}
  alert(`${targets.length}개 섹터를 "${groupName}" 하위로 편입했어요.`);
}

/* «설정 › 새 메인 섹터 추가»은 ../features/settings/sector-add-main.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* ══════════════════════════════════════════
   분야(도메인) 관리 (신규) — PART_TYPES 관리 UI 패턴
══════════════════════════════════════════ */
export function renderDomainList(){
  const el = document.getElementById('domain-list');
  if(!el) return;
  if(!DOMAINS.length){
    el.innerHTML = '<span style="font-size:12px;color:var(--i4)">등록된 분야가 없어요 — 모든 섹터가 미분류로 표시됩니다.</span>';
    return;
  }
  const mainCount = id => mainSectors().filter(m => domainOfSector(m).includes(id)).length;
  el.innerHTML = DOMAINS.map(d => `
    <span style="display:inline-flex;align-items:center;gap:6px;background:var(--W);border:1px solid var(--i6);border-radius:20px;padding:4px 6px 4px 12px;font-size:12px">
      <b>${escapeHtml(d.name)}</b>
      <span style="font-size:10px;color:var(--i4)">${mainCount(d.id)}개 섹터</span>
      <button onclick="renameDomain('${escAttr(d.id)}')" title="이름 변경"
        style="background:none;border:none;cursor:pointer;color:var(--i4);font-size:12px;padding:0">✎</button>
      <button onclick="removeDomain('${escAttr(d.id)}')" title="삭제"
        style="background:none;border:none;cursor:pointer;color:var(--i4);font-size:14px;line-height:1;padding:0"
        onmouseover="this.style.color='var(--re)'" onmouseout="this.style.color='var(--i4)'">×</button>
    </span>`).join('');
}

export async function addDomain(){
  const inp = document.getElementById('domain-add-input');
  const raw = inp ? inp.value.trim() : '';
  if(!raw){ inp && inp.focus(); return; }
  if(DOMAINS.some(d => d.name === raw)){ alert('이미 있는 분야예요.'); return; }
  let id = raw.toLowerCase().replace(/[^a-z0-9가-힣]+/g,'_').replace(/^_+|_+$/g,'').slice(0,20) || 'domain';
  let n = 2; const base = id;
  while(DOMAINS.some(d => d.id === id)) id = `${base}_${n++}`;
  DOMAINS.push({ id, name: raw });
  if(inp) inp.value = '';
  const r = await saveDomains();
  if(!r.ok){ DOMAINS.pop(); renderDomainList(); return; } // 실패 시 롤백
  trackAction('edit', '분야 추가', raw, `분야 "${raw}" 추가`);
  renderDomainList();
  renderSectorTree();
  try { buildCoCAT(); } catch(e){}
}

export async function renameDomain(id){
  const d = DOMAINS.find(x => x.id === id);
  if(!d) return;
  const name = prompt('분야의 새 이름을 입력하세요.', d.name);
  if(!name || !name.trim() || name.trim() === d.name) return;
  const prev = d.name;
  d.name = name.trim();
  const r = await saveDomains();
  if(!r.ok){ d.name = prev; renderDomainList(); return; }
  trackAction('edit', '분야 이름 변경', d.name, `분야 이름: ${prev} → ${d.name}`,
    changed('domains', d.id, { name: prev }, { name: d.name }));
  renderDomainList();
  renderSectorTree();
  try { buildCoCAT(); } catch(e){}
}

export async function removeDomain(id){
  const d = DOMAINS.find(x => x.id === id);
  if(!d) return;
  const affected = mainSectors().filter(m => parseDomains(m.domain).includes(id));
  if(!confirm(`분야 "${d.name}"을(를) 삭제할까요?`
    + (affected.length ? `\n소속 메인 섹터 ${affected.length}개에서 이 분야만 제거됩니다(다른 분야에 속해 있으면 유지).` : ''))) return;

  // 소속 섹터에서 이 분야 id만 제거하고 일괄 저장 (batchUpsert 1회) — 다중 분야
  // 소속인 경우 나머지 분야는 그대로 유지된다.
  const prevValues = affected.map(s => s.domain || '');
  if(affected.length){
    affected.forEach(s => { s.domain = joinDomains(parseDomains(s.domain).filter(x => x !== id)); });
    const r = await postToSheet({
      sheet: 'sectors', action: 'batchUpsert',
      rows: affected.map(sectorRowValues),
    }, '분야 해제');
    if(!r.ok){ affected.forEach((s,i) => { s.domain = prevValues[i]; }); return; } // 실패 시 롤백
  }
  const idx = DOMAINS.findIndex(x => x.id === id);
  if(idx >= 0) DOMAINS.splice(idx, 1);
  const r2 = await saveDomains();
  if(!r2.ok){ DOMAINS.splice(idx, 0, d); renderDomainList(); return; }
  /* 분야 줄과, 이 분야를 가리키던 섹터들의 이전값을 함께 담는다 — 분야만
     되살리면 섹터는 미분류로 남는다 */
  trackAction('edit', '분야 삭제', d.name, `분야 "${d.name}" 삭제 (섹터 ${affected.length}개 미분류로 이동)`,
    removed('domains', id, d, { also: affected.map((s, i) => ({ row: s.id, domain: prevValues[i] })) }));
  renderDomainList();
  renderSectorTree();
  try { buildCoCAT(); } catch(e){}
}

/* ══════════════════════════════════════════
   연락처 태그 관리 (신규) — 분야(도메인) 관리와 동일한 UI 패턴.
   BD/C-level처럼 참가 역할·직함과 무관하게 연락처에 직접 붙는 영구 꼬리표
   (contacts.tags 컬럼)의 "정의"를 추가/이름변경/삭제한다 — 개별 연락처에
   태그를 붙이고 떼는 건 마스터DB 일괄 변경 모달에서 한다.
══════════════════════════════════════════ */
export function renderTagList(){
  const el = document.getElementById('tag-list');
  if(!el) return;
  if(!TAGS.length){
    el.innerHTML = '<span style="font-size:12px;color:var(--i4)">등록된 태그가 없어요.</span>';
    return;
  }
  el.innerHTML = TAGS.map(t => `
    <span style="display:inline-flex;align-items:center;gap:6px;background:var(--W);border:1px solid var(--i6);border-radius:20px;padding:4px 6px 4px 12px;font-size:12px">
      <b>${escapeHtml(t.label)}</b>
      <span style="font-size:10px;color:var(--i4)">${escapeHtml(t.key)}</span>
      <button onclick="renameTag('${escAttr(t.key)}')" title="이름 변경"
        style="background:none;border:none;cursor:pointer;color:var(--i4);font-size:12px;padding:0">✎</button>
      <button onclick="removeTag('${escAttr(t.key)}')" title="삭제"
        style="background:none;border:none;cursor:pointer;color:var(--i4);font-size:14px;line-height:1;padding:0"
        onmouseover="this.style.color='var(--re)'" onmouseout="this.style.color='var(--i4)'">×</button>
    </span>`).join('');
}

export async function addTag(){
  const inp = document.getElementById('tag-add-input');
  const raw = inp ? inp.value.trim() : '';
  if(!raw){ inp && inp.focus(); return; }
  if(TAGS.some(t => t.label === raw)){ alert('이미 있는 태그예요.'); return; }
  let key = raw.toLowerCase().replace(/[^a-z0-9가-힣]+/g,'_').replace(/^_+|_+$/g,'').slice(0,20) || 'tag';
  let n = 2; const base = key;
  while(TAGS.some(t => t.key === key)) key = `${base}_${n++}`;
  TAGS.push({ key, label: raw });
  if(inp) inp.value = '';
  const r = await saveTags();
  if(!r.ok){ TAGS.pop(); renderTagList(); return; } // 실패 시 롤백
  trackAction('edit', '태그 추가', raw, `태그 "${raw}" 추가`);
  renderTagList();
  try { buildMDBTagList(); renderMDB(); } catch(e){}
}

export async function renameTag(key){
  const t = TAGS.find(x => x.key === key);
  if(!t) return;
  const label = prompt('태그의 새 이름을 입력하세요.', t.label);
  if(!label || !label.trim() || label.trim() === t.label) return;
  const prev = t.label;
  t.label = label.trim();
  const r = await saveTags();
  if(!r.ok){ t.label = prev; renderTagList(); return; }
  trackAction('edit', '태그 이름 변경', t.label, `태그 이름: ${prev} → ${t.label}`,
    changed('tags', t.key, { label: prev }, { label: t.label }));
  renderTagList();
  try { buildMDBTagList(); renderMDB(); } catch(e){}
}

export async function removeTag(key){
  const t = TAGS.find(x => x.key === key);
  if(!t) return;
  if(!confirm(`태그 "${t.label}"을(를) 삭제할까요?\n이 태그가 붙어있던 연락처에서는 태그만 제거되고, 연락처 자체는 그대로 남습니다.`)) return;

  // 이 태그가 붙어있던 연락처에서 태그 제거 (batchUpsert 1회)
  const affected = contacts.filter(c => (c.tags||'').split('|').map(s=>s.trim()).includes(key));
  const prevValues = affected.map(c => c.tags || '');
  if(affected.length){
    affected.forEach(c => {
      c.tags = (c.tags||'').split('|').map(s=>s.trim()).filter(s => s && s !== key).join('|');
    });
    const r = await postToSheet({
      sheet: 'contacts', action: 'batchUpsert',
      rows: affected.map(c => [c.id,c.nameKo,c.nameEn,c.orgKo,c.orgEn,c.titleKo,c.titleEn,c.deptKo,c.deptEn,
        c.country,c.cat,c.lang,c.source,c.date,c.status,c.email1,c.email2,c.phone1,c.phone2,c.beat,c.products,c.tags||'',c.org_id||'']),
    }, '태그 삭제 - 연락처 반영');
    if(!r.ok){ affected.forEach((c,i) => { c.tags = prevValues[i]; }); return; } // 실패 시 롤백
  }
  const idx = TAGS.findIndex(x => x.key === key);
  if(idx >= 0) TAGS.splice(idx, 1);
  const r2 = await saveTags();
  if(!r2.ok){ TAGS.splice(idx, 0, t); renderTagList(); return; }
  trackAction('edit', '태그 삭제', t.label, `태그 "${t.label}" 삭제 (연락처 ${affected.length}건에서 제거)`,
    removed('tags', key, t, { also: affected.map((c, i) => ({ row: c.id, tags: prevValues[i] })) }));
  renderTagList();
  try { buildMDBTagList(); renderMDB(); } catch(e){}
}

/* 섹터 탭 하위 4개 영역을 한 번에 새로고침 (원본 3685~3691행) */
export function renderSectorList(){
  renderDomainList();
  populateSectorScopeSelect();
  renderSectorTree();
  renderUnregisteredSectors();
  renderMainConvertList();
  renderSectorMergeList();
}

/* ══════════════════════════════════════════
   참가 유형(PART_TYPES) 관리 (원본 6348~6350행, 6378~6420행)
══════════════════════════════════════════ */
export function partTypeClass(type){ return (PART_TYPES.find(t=>t.key===type)||{cls:'p-gray'}).cls; }
export function partTypeLabel(type){ return (PART_TYPES.find(t=>t.key===type)||{label:type||''}).label; }

export const PART_TYPE_COLOR_CHOICES = ['p-blue','p-green','p-amber','p-teal','p-purple','p-red','p-gray','p-gold','p-indigo'];

export function renderPartTypeList(){
  const el = document.getElementById('parttype-list');
  if(!el) return;
  el.innerHTML = PART_TYPES.length
    ? PART_TYPES.map((t,i) => `
        <span style="display:inline-flex;align-items:center;gap:4px;background:var(--i7);border:1px solid var(--i6);border-radius:20px;padding:3px 10px;font-size:12px">
          <span class="pill ${t.cls}" style="margin:0">${escapeHtml(t.label)}</span>
          <button onclick="removePartType(${i})"
            style="background:none;border:none;cursor:pointer;color:var(--i4);font-size:14px;line-height:1;padding:0 0 0 2px"
            onmouseover="this.style.color='var(--re)'" onmouseout="this.style.color='var(--i4)'">×</button>
        </span>`).join('')
    : '<div style="font-size:12px;color:var(--i4)">등록된 참가 유형 없음</div>';

  // 참가 유형을 쓰는 드롭다운들도 함께 갱신
  document.querySelectorAll('.parttype-select').forEach(sel => {
    const cur = sel.value;
    sel.innerHTML = PART_TYPES.map(t => `<option value="${t.key}"${t.key===cur?' selected':''}>${escapeHtml(t.label)}</option>`).join('');
  });
}

/* 행사를 더하고·고치고·지운 뒤 — 마스터DB 행사 목록·업로드 드롭다운뿐 아니라 기업DB도 다시 만든다.
   기업DB(CO_DB)는 행사 약칭·이름을 복사해 들고 있어서, 안 그러면 새로고침 전까지 옛 이름이 보였다 */
export function refreshAfterEventChange(){
  try { buildMDBEvList(); populateUploadEvDropdown(); } catch(e){}
  try { buildCoDB(); if(document.getElementById('co-dash')) renderCoDashboard(); } catch(e){}
}

export async function addPartType(){
  const inp = document.getElementById('parttype-add-input');
  const colorSel = document.getElementById('parttype-add-color');
  const val = inp ? inp.value.trim() : '';
  if(!val){ inp && inp.focus(); return; }
  if(PART_TYPES.some(t => t.key === val)){ alert('이미 있는 참가 유형이에요.'); return; }

  const t = { key: val, label: val, cls: (colorSel && colorSel.value) || 'p-gray' };
  PART_TYPES.push(t);
  syncPartColors();
  if(inp) inp.value = '';
  renderPartTypeList();
  await upsertPartTypeRow(t);
}

export async function removePartType(idx){
  const t = PART_TYPES[idx];
  if(!t) return;
  if(!confirm(`"${t.label}" 참가 유형을 삭제할까요? (기존에 이 유형으로 저장된 참가 기록은 남아있어요)`)) return;
  PART_TYPES.splice(idx, 1);
  renderPartTypeList();
  await deletePartTypeRow(t.key);
  trackAction('delete', '참가 유형 삭제', t.label || t.key,
    `참가 유형 <b>${escapeHtml(t.label || t.key)}</b> 삭제 — 이 유형으로 저장된 참가 기록은 남아 있어요`,
    { table: 'part_types', op: 'delete', row: t.key, before: t });
}

/* ══════════════════════════════════════════
   행사 관리 (원본 6421~6537행)
══════════════════════════════════════════ */
export const EV_COLORS = [
  '#3B5BDB','#C97B0A','#16A34A','#6D28D9','#0F766E',
  '#DC2626','#D97706','#0891B2','#BE185D','#9C9890',
];

// 행사명 입력 시 ev_id 자동 제안 (원본 6426~6437행)
export function autoFillEvId(name){
  const idEl = document.getElementById('ev-add-id');
  if(!idEl || idEl.value) return; // 이미 입력된 경우 건드리지 않음
  // "KIC Silicon Valley 2026" → "KIC-SV-2026"
  const suggested = name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-가-힣]/g, '')
    .slice(0, 30);
  idEl.value = suggested;
}

export function renderEvMgr(){
  const el = document.getElementById('ev-mgr-list');
  if(!el) return;

  if(!EVENT_LIST.length){
    el.innerHTML = '<div style="font-size:12px;color:var(--i4);padding:12px 0">등록된 행사 없음</div>';
    return;
  }

  el.innerHTML = EVENT_LIST.map((e, i) => `
    <div onclick="openEvDetail('${escAttr(e.key)}')" title="이 행사의 설정 열기"
      style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--W);border:1px solid var(--i6);border-radius:8px;margin-bottom:6px;cursor:pointer">
      <div style="width:12px;height:12px;border-radius:50%;background:${e.color};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--i1)">${escapeHtml(e.name||e.key)}</div>
        <div style="font-size:11px;color:var(--i4)">
          <span style="background:var(--i7);border-radius:3px;padding:1px 5px;font-family:monospace">${escapeHtml(e.key)}</span>
          · ${escapeHtml(e.short||'')}
          ${e.date_start ? '· ' + escapeHtml(e.date_start) + (e.date_end ? ' ~ ' + escapeHtml(e.date_end) : '') : (e.date ? '· ' + escapeHtml(e.date) : '')}
          ${e.location ? '· 📍' + escapeHtml(e.location) : ''}
        </div>
        <div style="margin-top:4px">${EVENT_PARTS.filter(p => evParts(e.key)[p.key] !== 'none')
          .map(p => { const st = partStateOf(evParts(e.key)[p.key]);
            return `<span class="pill ${escAttr(st.cls)}" style="margin-right:3px"
              title="${escapeHtml(st.label)}">${escapeHtml(p.label)}${st.key === 'done' ? ' ✓' : ''}</span>`; }).join('')
          || '<span style="font-size:10.5px;color:var(--i5)">진행 파트 없음</span>'}</div>
        ${(() => {
          /* 마감일·한도는 상세를 열어야 보였다(설정값 탭에 따로 모아 둔 요약은 없앴다) —
             목록에서 «이 행사는 정해 뒀나»만 한눈에 보이게 한 줄로 적는다 */
          const cfg = EXH_CFG[e.key] || {};
          const due = Object.entries(cfg.due || {}).filter(([, v]) => v);
          const b = cfg.book || {};
          if(!due.length && !b.chars) return '';
          return `<div style="font-size:10.5px;color:var(--i4);margin-top:4px">${
            due.map(([k, v]) => `${escapeHtml(DUE_LABEL[k] || k)} ${escapeHtml(v)}`).join(' · ')}${
            b.chars ? `${due.length ? ' · ' : ''}프로그램북 ${Number(b.chars).toLocaleString()}자` : ''}</div>`;
        })()}
      </div>
      <button onclick="event.stopPropagation();removeEventFromList(${i})"
        style="background:none;border:1px solid var(--i6);border-radius:5px;padding:3px 8px;
               font-size:11px;color:var(--i3);cursor:pointer"
        onmouseover="this.style.borderColor='var(--re)';this.style.color='var(--re)'"
        onmouseout="this.style.borderColor='var(--i6)';this.style.color='var(--i3)'">삭제</button>
    </div>`
  ).join('');
}

export function addEventToList(){
  const evId      = (document.getElementById('ev-add-id')        ||{}).value.trim();
  const name      = (document.getElementById('ev-add-name')       ||{}).value.trim();
  const short     = (document.getElementById('ev-add-short')      ||{}).value.trim();
  const dateStart = (document.getElementById('ev-add-date-start') ||{}).value.trim();
  const dateEnd   = (document.getElementById('ev-add-date-end')   ||{}).value.trim();
  const loc       = (document.getElementById('ev-add-loc')        ||{}).value.trim();
  const color     = (document.getElementById('ev-add-color')      ||{}).value || '#3B5BDB';
  const msg   = document.getElementById('ev-add-msg');

  if(!evId){ if(msg){msg.style.color='var(--re)';msg.textContent='행사 ID를 입력해주세요.';} return; }
  if(!name){ if(msg){msg.style.color='var(--re)';msg.textContent='행사명을 입력해주세요.';} return; }
  if(EVENT_LIST.find(e => e.key === evId)){
    if(msg){msg.style.color='var(--re)';msg.textContent='이미 등록된 ID예요.';} return;
  }

  EVENT_LIST.push({
    key:        evId,               // ev_id — participations 연결 키
    name:       name,               // 풀네임
    short:      short || name,      // 약칭
    color:      color,
    date:       dateStart || '',    // 하위 호환용 (시작일)
    date_start: dateStart || '',
    date_end:   dateEnd   || '',
    location:   loc       || '',
  });

  // 입력 초기화
  ['ev-add-id','ev-add-name','ev-add-short','ev-add-date-start','ev-add-date-end','ev-add-loc'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
  if(msg){msg.style.color='var(--g)';msg.textContent='추가됐어요!';setTimeout(()=>{msg.textContent='';},2000);}

  // UI 갱신
  renderEvMgr();
  refreshAfterEventChange();

  // 구글시트 저장 + 감사 로그
  const newEv = EVENT_LIST[EVENT_LIST.length - 1];
  saveEventToSheet(newEv);
  trackAction('edit', '행사 추가', newEv.key, `행사 "${newEv.name||newEv.key}" 추가`);
}

export function removeEventFromList(idx){
  const ev = EVENT_LIST[idx];
  if(!ev) return;
  // 삭제 전 참조 데이터 규모를 알려줘서 판단할 수 있게 한다
  const partCount = participationsCountForEvent(ev.key);
  if(!confirm(`"${ev.key}" 행사를 삭제할까요?\n`
    + (partCount ? `⚠️ 이 행사에 연결된 참여 기록 ${partCount}건은 시트에 남지만 화면에서 연결이 끊깁니다.\n` : '')
    + `(기존 participations 데이터는 유지됩니다)`)) return;

  const key = ev.key;
  EVENT_LIST.splice(idx, 1);
  renderEvMgr();
  refreshAfterEventChange();
  deleteEventFromSheet(key);
  trackAction('edit', '행사 삭제', key, `행사 "${ev.name||key}" 삭제`
    + (partCount ? ` (참여 기록 ${partCount}건 잔존)` : ''),
    removed('events', key, ev));
}

function participationsCountForEvent(evKey){
  return participations.filter(p => p.eventId === evKey).length;
}

/* ── 연락처 데이터 정리 도구 (원본 5996~6115행) ──
   arch-pane-ev(행사 관리 탭) 하단에 함께 배치돼 있던 일괄 정리 버튼들.
   contacts 시트 자체를 직접 정리하는 기능이라 db-tab.js와도 관련이 있지만,
   UI가 설정 탭에만 있고 다른 모듈이 소유를 명시하지 않아 이 파일에 둔다. */
export async function normalizeAllCountries(){
  const msgEl = document.getElementById('country-fix-msg');
  if(!API_BASE_URL || !currentUser){
    if(msgEl) msgEl.textContent = '서버 연동 정보가 없어요.';
    return;
  }

  if(msgEl) msgEl.textContent = '원본 데이터 확인 중...';
  const raw = await safeFetch(API_BASE_URL + '/api/data?sheet=contacts', 'contacts(정리)', 1, await authHeaders());
  if(!Array.isArray(raw)){
    if(msgEl) msgEl.textContent = '시트 조회에 실패했어요. 네트워크를 확인해주세요.';
    return;
  }

  const targets = raw.filter(r => r.country && r.country !== countryName(r.country));
  const orgN = orgCountryTargets().length;
  if(!targets.length && !orgN){
    if(msgEl) msgEl.textContent = '이미 모두 한글 국가명으로 정리돼 있어요.';
    return;
  }
  if(!confirm(`국가명을 한글로 통일할까요?\n연락처 ${targets.length}건 · 기업 ${orgN}곳`)) return;
  if(orgN){
    if(msgEl) msgEl.textContent = `기업 저장 중... (${orgN}곳)`;
    if(await normalizeOrgCountries(msgEl) < 0) return;
    renderCleanCounts();
  }
  if(!targets.length){
    if(msgEl) msgEl.textContent = `완료: 기업 ${orgN}곳 정리했어요.`;
    return;
  }

  if(msgEl) msgEl.textContent = `저장 중... (${targets.length}건)`;
  const rows = targets.map(r => {
    const newCountry = countryName(r.country);
    const c = contacts.find(x => String(x.id) === String(r.id));
    if(c) c.country = newCountry;
    return [r.id, r.nameKo, r.nameEn, r.orgKo, r.orgEn, r.titleKo, r.titleEn, r.deptKo, r.deptEn,
      newCountry, r.cat, r.lang, r.source, r.date, r.status, r.email1, r.email2, r.phone1, r.phone2,
      r.beat, r.products, r.tags||''];
  });
  const r = await postToSheet({ sheet: 'contacts', action: 'batchUpsert', rows }, '국가명 정리');
  if(msgEl) msgEl.textContent = r.ok
    ? `완료: ${targets.length}건 정리했어요.`
    : '저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.';
  if(r.ok) trackAction('edit', '국가명 정리', 'contacts', `국가명 한글 통일 ${targets.length}건`);
  try { renderMDB(); buildCoDB(); } catch(e){}
}

/* 기업의 국가·본사 칸 — 전에는 연락처만 정리해서 기업에 «한국»이 94곳 남아 있었다 */
function orgCountryTargets(){
  const fix = (v) => { const t = String(v || '').trim(); return t && t !== '-' && t !== countryName(t) ? countryName(t) : null; };
  return ORGS.map(o => {
    const p = { id: o.id };
    const c = fix(o.country), h = fix(o.hq);
    if(c) p.country = c;
    if(h) p.hq = h;
    return (c || h) ? p : null;
  }).filter(Boolean);
}
async function normalizeOrgCountries(msgEl){
  const patches = orgCountryTargets();
  if(!patches.length) return 0;
  const r = await saveOrgFields(patches, '기업 국가명 정리');
  if(!r.ok){ if(msgEl) msgEl.textContent = '기업 국가명 저장에 실패했어요. 다시 시도해주세요.'; return -1; }
  trackAction('edit', '국가명 정리', 'orgs', `기업 국가명 한글 통일 ${r.saved}건`);
  return r.saved;
}

// ── 기업명 국문/영문 분리: "한국보건산업진흥원 Korea Health Industry Development Institute" 처럼
// 공백으로만 붙어있는 국/영문 기업명을 orgKo/orgEn으로 분리. "SK 바이오사이언스"처럼 짧은 접두/접미
// 영문 약어까지 잘못 쪼개지 않도록, 영문 쪽이 2단어 이상일 때만 분리한다. (원본 6043~6064행)
export function splitMixedOrgName(raw){
  const tokens = (raw||'').trim().split(/\s+/).filter(Boolean);
  if(tokens.length < 2) return null;
  const isKo = t => /[가-힣]/.test(t);
  const flags = tokens.map(isKo);
  let i = 0;
  while(i < flags.length && flags[i] === flags[0]) i++;
  if(i === 0 || i === flags.length) return null;          // 언어가 안 섞여있음
  if(!flags.slice(i).every(f => f === flags[i])) return null; // 중간에 뒤섞여 있으면 손대지 않음

  const firstPart  = tokens.slice(0, i);
  const secondPart = tokens.slice(i);
  const firstIsKo  = flags[0];
  const enPart = firstIsKo ? secondPart : firstPart;
  const koPart = firstIsKo ? firstPart  : secondPart;
  if(enPart.length < 2 || koPart.length < 1) return null;  // 영문이 1단어(약어)면 그대로 둠

  return { ko: koPart.join(' '), en: enPart.join(' ') };
}

// 기업/직책/부서 세 필드 모두에 같은 분리 규칙 적용 (원본 6067~6071행)
const BILINGUAL_FIELD_PAIRS = [
  { ko: 'orgKo',   en: 'orgEn',   label: '기업' },
  { ko: 'titleKo', en: 'titleEn', label: '직책' },
  { ko: 'deptKo',  en: 'deptEn',  label: '부서' },
];

export async function splitMixedOrgNames(){
  const msgEl = document.getElementById('orgsplit-fix-msg');
  const targets = [];
  let firstExample = null;

  contacts.forEach(c => {
    let changed = false;
    BILINGUAL_FIELD_PAIRS.forEach(({ko, en, label}) => {
      if(!c[ko] || c[en]) return; // 영문 필드가 이미 채워져 있으면 손대지 않음
      const split = splitMixedOrgName(c[ko]);
      if(!split) return;
      if(!firstExample) firstExample = { label, before: c[ko], ...split };
      c[ko] = split.ko; c[en] = split.en;
      changed = true;
    });
    if(changed) targets.push(c);
  });

  if(!targets.length){
    if(msgEl) msgEl.textContent = '분리할 항목이 없어요.';
    return;
  }
  if(!confirm(`${targets.length}건의 기업/직책/부서를 국문·영문으로 분리해서 저장할까요?\n예(${firstExample.label}): "${firstExample.before}" → "${firstExample.ko}" / "${firstExample.en}"`)) return;

  if(!API_BASE_URL || !currentUser){
    if(msgEl) msgEl.textContent = `완료: ${targets.length}건 정리했어요 (로컬만 반영, 서버 미연동).`;
    try { renderMDB(); buildCoDB(); } catch(e){}
    return;
  }

  if(msgEl) msgEl.textContent = `저장 중... (${targets.length}건)`;
  const rows = targets.map(c => [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
    c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2,
    c.beat, c.products, c.tags||'', c.org_id||'']);
  const r = await postToSheet({ sheet: 'contacts', action: 'batchUpsert', rows }, '기업/직책/부서 분리');
  if(msgEl) msgEl.textContent = r.ok
    ? `완료: ${targets.length}건 분리했어요.`
    : '저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.';
  if(r.ok) trackAction('edit', '국영문 분리', 'contacts', `기업/직책/부서 국영문 분리 ${targets.length}건`);
  try { renderMDB(); buildCoDB(); } catch(e){}
}

/* ══════════════════════════════════════════
   설정 탭 하위탭 전환 (원본 6439~6450행) / 시스템 구조 문서 하위탭 (원본 3168~3174행)
   행사·기업 분류·사람 분류·공통 목록·데이터 정리·시스템 구조 패널을 전환한다.
   arch-pane-sys 내부의 정적 SVG 다이어그램(전체 아키텍처/구글시트 연동/
   업무 플로우) 자체는 index.html 정적 마크업에 그대로 남아있고,
   switchAV는 그 3개 다이어그램 중 무엇을 보여줄지 display 토글만 한다
   (JS 로직은 사실상 이 전환 함수 하나뿐).
══════════════════════════════════════════ */
export function switchArchTab(tab){
  /* 옛 이름으로 불러도 연다 — 다른 화면이 switchArchTab('sector')처럼 부를 수 있다 */
  tab = ({ sector: 'org', val: 'common' })[tab] || tab;
  /* 업로드 화면에서도 설정 사이드바가 보이므로, 거기서 누르면 설정으로 먼저 돌아온다 */
  if(window.curApp && window.curApp !== 'arch') window.switchApp?.('arch', null);
  ['ev','org','people','common','equip','clean','ai','sys'].forEach(t => {
    const btn  = document.getElementById('arch-tab-'+t);
    const pane = document.getElementById('arch-pane-'+t);
    // 모바일 본문 전환줄 — 사이드바 버튼과 같은 상태를 유지해야 지금 어느 탭인지 보인다
    const mbtn = document.getElementById('arch-mtab-'+t);
    if(btn)  btn.classList.toggle('on', t===tab);
    if(mbtn) mbtn.classList.toggle('on', t===tab);
    if(pane) pane.style.display = t===tab ? 'block' : 'none';
  });
  const sysnav = document.getElementById('sbp-arch-sysnav');
  if(sysnav) sysnav.style.display = tab==='sys' ? 'block' : 'none';
  if(tab==='ev')     { window.closeEvDetail(); }   // 목록부터 — 상세는 카드를 눌러서 연다
  if(tab==='org')    { renderSectorList(); mountCodeList('org'); }
  if(tab==='people') { renderPartTypeList(); renderTagList(); renderAliasList(); mountCodeList('people'); }
  if(tab==='common') { mountCodeList('common'); }
  if(tab==='equip')  { window.mountEquipCatalog('eqcat-rows', ''); }
  if(tab==='clean')  { renderSectorList(); renderCleanCounts(); }
  if(tab==='ai')     { renderAiSettings(); }
  if(tab==='sys')    { renderSysInfo(); }
}

/* 정리 도구마다 «지금 손볼 것이 몇 건인지»를 먼저 보여준다. 0건인 도구를
   눌러 «분리할 항목이 없어요»를 받는 일이 없게. 국가명은 화면에 올라온
   연락처로 센다 — 실제 정리는 서버 원본을 다시 읽어서 한다. */
function renderCleanCounts(){
  const set = (k, n) => {
    const el = document.getElementById('clean-cnt-' + k);
    if(!el) return;
    el.textContent = n ? `${n.toLocaleString()}건` : '할 일 없음';
    el.className = 'pill ' + (n ? 'p-amber' : 'p-gray');
  };
  /* 연락처는 불러올 때 이미 국가명을 바꿔 보여 줘서(api.js) 여기서는 늘 0이었다 —
     «한국»이 서버에 남아 있어도 «할 일 없음». 기업은 바꾸지 않고 불러오므로 기업으로 센다 */
  set('country', orgCountryTargets().length);
  set('ctryfill', contactFillCount());
  const ec = enrichCounts();
  set('orgenrich', ec.total);
  const ecEl = document.getElementById('org-enrich-sub');
  if(ecEl) ecEl.textContent = ec.total ? `국가 빈 곳 ${ec.country} · 업종 미정·빈칸 ${ec.sector}` : '';
  renderContactFill();
  set('orgsplit', contacts.filter(c => BILINGUAL_FIELD_PAIRS.some(({ ko, en }) =>
    c[ko] && !c[en] && splitMixedOrgName(c[ko]))).length);
  try { set('unreg', collectUnregisteredSectors().length); } catch(e){ set('unreg', 0); }
}

/* 시스템 정보 — 배포 버전·서버 상태·데이터 건수 */
async function renderSysInfo(){
  const el = document.getElementById('sys-info');
  if(!el) return;
  const box = (t, rows) => `<div style="background:var(--i8);border:1px solid var(--i6);border-radius:10px;padding:14px;margin-bottom:14px">
    <div style="font-size:12px;font-weight:700;color:var(--i2);margin-bottom:8px">${t}</div>
    ${rows.map(([k, v]) => `<div style="display:flex;gap:10px;font-size:12px;padding:4px 0;border-top:1px solid var(--i7)">
      <span style="width:120px;color:var(--i4);flex:0 0 auto">${k}</span><span style="color:var(--i1)">${v}</span></div>`).join('')}
  </div>`;
  const n = (a) => (a?.length || 0).toLocaleString();
  const data = box('데이터 건수', [
    ['연락처', n(contacts)], ['기업', n(CO_DB)], ['행사', n(EVENT_LIST)],
    ['행사 참여 기록', n(participations)], ['전시 참가기업', n(EXHIBITORS)],
    ['컨퍼런스 세션', n(CONF_SESSIONS)], ['연사', n(SPEAKERS)],
  ]);
  const who = box('접속', [
    ['로그인', escapeHtml(currentUser?.email || '-')],
    ['모드', API_BASE_URL ? '실제 서버' : '<b style="color:var(--am)">테스트 모드 (저장 안 됨)</b>'],
  ]);
  el.innerHTML = box('서버', [['상태', '확인 중…']]) + data + who;

  let server;
  if(!API_BASE_URL) server = [['상태', '테스트 모드라 서버에 묻지 않아요']];
  else {
    try {
      const t0 = performance.now();
      const r = await fetch(API_BASE_URL + '/health', { cache: 'no-store' });
      const j = await r.json();
      server = [
        ['상태', j.ok ? '<b style="color:var(--g)">정상</b>' : '<b style="color:var(--re)">응답 이상</b>'],
        ['배포 버전', `<code>${escapeHtml(j.commit || '-')}</code>`],
        ['응답 시간', `${Math.round(performance.now() - t0)}ms`],
        ['주소', `<code style="font-size:11px">${escapeHtml(API_BASE_URL)}</code>`],
      ];
    } catch(e){
      server = [['상태', '<b style="color:var(--re)">연결 안 됨</b> — 네트워크나 서버를 확인하세요']];
    }
  }
  if(document.getElementById('sys-info') === el) el.innerHTML = box('서버', server) + data + who;
}

// archV는 이 탭에서만 쓰는 로컬 UI 상태라 state.js로 옮기지 않고 모듈 스코프에 둠
export function switchAV(v, btn){
  settingsUi.archV = v;
  ['arch','sheet','flow'].forEach(id => {
    const el = document.getElementById('av-'+id);
    if(el) el.style.display = id===v ? 'block' : 'none';
  });
  document.querySelectorAll('#sbp-arch .nr').forEach(b => b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  const tt = {arch:'시스템 아키텍처', sheet:'구글시트 연동 구조', flow:'업무 플로우'};
  const ttlEl = document.getElementById('arch-ttl');
  if(ttlEl) ttlEl.innerHTML = `${tt[v]} <span class="tb-s">Bloom CRM 데이터 흐름</span>`;
}

/* 설정(arch) 탭이 활성화될 때 router.js가 호출하는 초기화 훅
   (원본 6647행 switchApp의 `if(app==='arch') switchArchTab('ev');`) */
export function initArchTab(){
  switchArchTab('ev');
}

/* ══════════════════════════════════════════
   window 노출 — 생성된 HTML의 인라인 onclick/ondragstart/ondrop/
   onkeydown/oninput 핸들러가 문자열로 이 함수들을 호출하므로,
   ES 모듈 스코프 밖(전역)에서도 찾을 수 있도록 명시적으로 등록한다.
══════════════════════════════════════════ */
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
window.addPartType           = addPartType;
window.removePartType        = removePartType;
window.autoFillEvId          = autoFillEvId;
window.addEventToList        = addEventToList;
window.removeEventFromList   = removeEventFromList;
window.normalizeAllCountries = normalizeAllCountries;
window.renderCleanCounts = renderCleanCounts;
window.splitMixedOrgNames    = splitMixedOrgNames;
window.switchArchTab         = switchArchTab;
window.switchAV              = switchAV;
window.onSectorScopeChange   = onSectorScopeChange;
window.assignSectorDomain     = assignSectorDomain;
window.assignSectorCanonical  = assignSectorCanonical;
window.addDomain              = addDomain;
window.renameDomain           = renameDomain;
window.removeDomain           = removeDomain;
window.addTag                 = addTag;
window.renameTag              = renameTag;
window.removeTag              = removeTag;

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
  const evNote = def.perEvent ? `<div style="font-size:11px;color:var(--i4);margin-bottom:8px">행사 전용 목록이 없는 행사가 이 목록을 씁니다. 한 행사만 다르게 하려면 <b>행사 › 그 행사 › ${
    def.key === 'speaker_role' ? '컨퍼런스' : '부스'}</b>에서 고치세요.</div>` : '';

  el.innerHTML = evNote + (inherited
    ? `<div style="font-size:11px;color:var(--i4);margin-bottom:8px">이 행사 전용 목록이 없어 <b>공통 목록</b>을 씁니다. 아래에서 항목을 추가하면 이 행사 전용 목록이 새로 만들어지고, 그때부터 공통 대신 이 목록만 쓰입니다.</div>
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
  if(!rows.length) return '<div style="font-size:12px;color:var(--i4)">아직 항목이 없어요.</div>';
  return rows.map(c => {
    const off = c.active === 'no';
    return `<div class="clrow" style="padding:6px 0;border-bottom:1px solid var(--i7)${off ? ';opacity:.5' : ''}">
      <div style="display:flex;gap:8px;align-items:center;min-width:0">
        <span class="pill ${escAttr(c.cls || 'p-gray')}" style="min-width:80px;text-align:center">${escapeHtml(c.label || c.code)}</span>
        <code style="font-size:11px;color:var(--i4);min-width:110px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.code)}</code>
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
          style="height:32px;font-size:11px">기본 제공 ${boothInclCount(c)}건</button></span>` : ''}
      <span class="clf"><span class="clf-l"></span>
        <button class="btn" onclick="toggleCodeListRow('${escAttr(c.id)}')"
          style="height:32px;font-size:11px">${off ? '되살리기' : '숨김'}</button></span>`}
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
          <select class="fi" style="flex:0 0 78px;font-size:11.5px;padding:6px"
            onchange="editBoothInclLine(${n},'cat',this.value)">${cats.map(([v, l]) =>
              `<option value="${v}"${(o.cat || 'equip') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <input class="fi" style="flex:0 0 96px;font-size:11.5px;padding:6px" list="bincl-cat"
            value="${escapeHtml(o.code || '')}" placeholder="품목코드"
            onchange="editBoothInclLine(${n},'code',this.value)">
          <input class="fi" style="flex:1 1 160px;min-width:0;font-size:11.5px;padding:6px"
            value="${escapeHtml(o.name || '')}" placeholder="품명"
            onchange="editBoothInclLine(${n},'name',this.value)">
          <input class="fi" style="flex:0 0 62px;font-size:11.5px;padding:6px"
            value="${escapeHtml(o.qty ?? '')}" placeholder="수량" inputmode="numeric"
            onchange="editBoothInclLine(${n},'qty',this.value)">
          <button class="btn" style="flex:0 0 auto;padding:4px 9px;font-size:11px"
            onclick="delBoothInclLine(${n})">삭제</button>
        </div>`).join('')
        : '<div style="font-size:11.5px;color:var(--i4)">아직 없어요. 아래에서 한 줄씩 넣으세요.</div>'}
    </div>
    <button class="btn" style="margin-top:10px;font-size:11.5px" onclick="addBoothInclLine()">+ 한 줄 추가</button>
    <div style="font-size:11px;color:var(--i4);margin-top:8px">
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
  const { exhibitorsForEvent } = await import('../state.js');
  const { applyBoothItems, boothIncluded, isSharedBooth } = await import('./exh-tab.js');
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
          style="height:32px;font-size:11px">${off ? '되살리기' : '숨김'}</button></span>
    </div>`;
  }).join('') : '<div style="font-size:12px;color:var(--i4)">아직 덮어쓴 표기가 없어요 — 전부 기본 표대로 처리됩니다.</div>')
    + `<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--i6)">
      <div style="flex:1;min-width:150px"><div class="mlbl">업로드에 적힌 표기</div>
        <input class="fi" id="alias-new-code" placeholder="예: Exhibitor Pass" style="width:100%"
          onkeydown="if(event.key==='Enter')addAliasRow()"></div>
      <div style="min-width:150px"><div class="mlbl">이 카테고리로</div>
        <select class="fi" id="alias-new-cat" style="width:100%">${catOpts('attendee')}</select></div>
      <button class="btn bp" onclick="addAliasRow()" style="min-width:60px;height:36px">추가</button>
    </div>
    <div style="font-size:10.5px;color:var(--i5);margin-top:8px">대소문자와 띄어쓰기는 무시하고 견줍니다. 바꾼 값은 <b>다음 업로드부터</b> 적용되고, 이미 저장된 연락처는 그대로입니다.</div>`;
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
    el.innerHTML = `<div style="font-size:12px;color:var(--i4)">아직 정해 둔 행사가 없어요 —
      <b>전시</b> 탭 › 대시보드 › 단계별 진행 카드의 <b>마감일 설정</b>에서 정합니다.</div>`;
    return;
  }
  el.innerHTML = keys.map(k => {
    const cfg = EXH_CFG[k] || {};
    const due = Object.entries(cfg.due || {});
    const b = cfg.book || {};
    return `<div style="padding:8px 0;border-bottom:1px solid var(--i7)">
      <div style="font-size:12px;font-weight:700;color:var(--i2);margin-bottom:4px">${escapeHtml(k)}</div>
      <div style="font-size:11px;color:var(--i3)">
        ${due.length ? due.map(([sk, v]) =>
          `<span class="pill p-gray" style="margin:2px 3px 2px 0">${escapeHtml(DUE_LABEL[sk] || sk)} ${escapeHtml(v)}</span>`).join('')
          : '<span style="color:var(--i5)">마감일 없음</span>'}
      </div>
      <div style="font-size:11px;color:var(--i4);margin-top:3px">프로그램북 한도 ${
        b.chars ? `${Number(b.chars).toLocaleString()}자 · ${b.words}단어` : '기본값(1,300자 · 200단어)'}</div>
    </div>`;
  }).join('')
    + `<div style="font-size:10.5px;color:var(--i5);margin-top:8px">고치려면 <b>전시</b> 탭에서 그 행사를 고른 뒤 <b>마감일 설정</b>을 누르세요.</div>`;
}

/* 전시 탭의 DUE_STEPS와 같은 이름표 — 그쪽을 import하면 순환 참조가 된다 */
/* exh-tab.js의 DUE_STEPS와 같은 키·같은 순서여야 한다 — 여기 빠진 키는 설정에서
   저장할 때 지워졌다(부스 도면·기본 시공). 서로 import하면 순환이 생겨 따로 둔다. */
export const DUE_LABEL = {
  'manual_replied_at': '매뉴얼 회신', 'app_received_at': '신청서', 'booth_confirmed_at': '부스',
  'calc:design': '부스 도면', 'calc:payment': '입금', 'calc:graphic': '그래픽', 'calc:base': '기본 시공',
  'directory_received_at': '도록', 'movein_at': '반입',
};

window.renderAliasList = renderAliasList;
window.addAliasRow     = addAliasRow;
window.renderEvCfgList = renderEvCfgList;

/* «설정 › 비품 목록 (equip_catalog)»은 ../features/settings/equip-catalog.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */