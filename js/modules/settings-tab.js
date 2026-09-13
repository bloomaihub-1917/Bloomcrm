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
} from '../state.js';

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
} from '../api.js';
import { trackAction } from './audit-tab.js';

import { TRACK_COLORS, trackColorOf, trackColorIndex, pickTrackColorIndex } from '../track-colors.js';
import { CL, CAT_KEYS, EVENT_PARTS, PART_STATES, partStateOf,
  SPEAKER_ROLES, SPEAKER_NEEDS, SPEAKER_NEEDS_ON_TALK,
  NEED_CYCLE, NEED_MARK, NEED_LABEL } from '../constants.js';
import { slugifySectorName, escapeHtml, escAttr, countryName, scopedSectorName, parseSectorScope, sectorRowValues, sectorKey, parseDomains, joinDomains } from '../utils.js';
import { buildCoDB, buildCoCAT, renderCoDashboard, setCoCat } from './company-tab.js';
import { renderMDB, buildMDBEvList, buildMDBTagList } from './db-tab.js';
import { populateUploadEvDropdown } from './upload-tab.js';

/* 드래그 중인 섹터 id (원본 3693행 전역 변수 → 모듈 스코프로 축소) */
let _draggedSectorId = null;

/* ══════════════════════════════════════════
   섹터 순수 헬퍼 (원본 6291~6305행)
   COMPANY_SECTORS 배열을 조회만 하는 함수들 — company-tab.js 등
   다른 모듈에서도 이 파일로부터 import해서 쓸 수 있도록 export.
══════════════════════════════════════════ */
export function sectorName(id){ return (COMPANY_SECTORS.find(s=>s.id===id)||{}).name || id; }
export function sectorId(name){ return (COMPANY_SECTORS.find(s=>sectorKey(s.name)===sectorKey(name))||{}).id || name; }
/* 이름(대소문자 무시)으로 등록된 섹터를 찾는다 — 신규 섹터 생성 시 중복 방지에 사용 */
export function findSectorByName(name){ return COMPANY_SECTORS.find(s => sectorKey(s.name) === sectorKey(name)); }
export function parseSectors(beat){
  if(!beat) return [];
  return beat.split('|').map(s=>s.trim()).filter(Boolean);
}
export function joinSectors(arr){ return arr.join('|'); }
export function mainSectors(){ return COMPANY_SECTORS.filter(s=>s.parent===null); }
export function subSectors(parentId){ return COMPANY_SECTORS.filter(s=>s.parent===parentId); }

/* sectorRowValues는 utils.js에 정의 — api.js(upsertSectorRow)와 이 파일이
   함께 쓰는데 settings-tab을 api.js가 import하면 순환 참조가 되기 때문 */

/* ── 분야(도메인) 헬퍼 (신규) ──
   분야는 섹터 계층과 직교하는 속성: 메인 섹터의 s.domain에만 저장되고
   서브 섹터는 런타임에 부모의 domain을 따라간다.
   한 섹터가 여러 분야에 동시에 속할 수 있어(예: Investor = BIO + VC),
   s.domain은 "bio|vc"처럼 파이프로 여러 id를 이어붙인 문자열이다. */
export const UNASSIGNED_DOMAIN = '__none__'; // "미분류" 가상 분야 id
export function domainName(id){
  if(id === UNASSIGNED_DOMAIN) return '미분류';
  return (DOMAINS.find(d => d.id === id)||{}).name || id;
}
/* 공통(스코프 접두어 없는) 메인 섹터인지 */
function isCommonMain(s){
  return !!s && !s.parent && !parseSectorScope(s.name).eventShort;
}

/* 섹터가 속한 분야 id 배열 (목록에 없는 잔존 id는 걸러냄). 항상 배열을
   반환하므로 호출부는 .includes()/.length로 판단해야 한다. */
export function domainOfSector(s){
  if(!s) return [];
  let main = s.parent ? COMPANY_SECTORS.find(x => x.id === s.parent) : s;
  if(!main) return [];
  // 행사 스코프 메인이 공통 섹터에 연결(canonical)돼 있으면 그 공통 섹터의 분야를 상속.
  // 방어: 연결 대상이 없거나 / 서브이거나 / 또 다른 스코프 섹터면 무시(미분류).
  // 체인은 최대 (서브 → 부모 스코프 메인 → 공통 메인) 2단계라 순환 불가.
  if(parseSectorScope(main.name).eventShort && main.canonical){
    const target = COMPANY_SECTORS.find(x => x.id === main.canonical);
    if(isCommonMain(target)) main = target;
    else return [];
  }
  // 목록에서 사라진 잔존 id는 미분류 취급 (분야 삭제 후 방어)
  return parseDomains(main && main.domain).filter(id => DOMAINS.some(d => d.id === id));
}
/* 해당 분야에 속한 모든 섹터의 "이름 키(sectorKey, 대소문자 무시)" Set
   (메인 + 그 서브들). domainId가 UNASSIGNED_DOMAIN이면 어떤 분야에도
   속하지 않은 섹터들. 반환값은 원문 이름이 아니라 sectorKey이므로
   조회 시에도 sectorKey(대상)로 비교해야 한다. */
export function sectorNamesInDomain(domainId){
  const names = new Set();
  mainSectors().forEach(m => {
    const doms = domainOfSector(m);
    const belongs = doms.length ? doms.includes(domainId) : domainId === UNASSIGNED_DOMAIN;
    if(!belongs) return;
    names.add(sectorKey(m.name));
    subSectors(m.id).forEach(s => names.add(sectorKey(s.name)));
  });
  return names;
}

/* 섹터명을 가진 기업 수(대소문자 무시 집계) — 기업DB 필터(setCoCat)와 동일한
   기준으로 세어서 숫자와 클릭 결과가 항상 일치하게 함 (원본 3695~3705행).
   키는 sectorKey(정규화된 이름) — 조회 시 sectorCountFor()를 사용할 것. */
export function computeSectorCompanyCounts(){
  const counts = {};
  CO_DB.forEach(c => {
    (c.sectors && c.sectors.length ? c.sectors : [c.sector]).forEach(name => {
      if(!name) return;
      const k = sectorKey(name);
      counts[k] = (counts[k]||0) + 1;
    });
  });
  return counts;
}
export function sectorCountFor(counts, name){ return counts[sectorKey(name)] || 0; }

/* 업로드 데이터에는 있지만 아직 섹터 체계에 등록 안 된 섹터 값 찾기 (원본 3956~3969행) */
export function collectUnregisteredSectors(){
  const known = new Set(COMPANY_SECTORS.map(s => sectorKey(typeof s==='string' ? s : s.name)));
  const counts = {};
  CO_DB.forEach(c => {
    const secs = (c.sectors && c.sectors.length) ? c.sectors : [c.sector].filter(Boolean);
    secs.forEach(name => {
      if(!name || known.has(sectorKey(name))) return;
      counts[name] = (counts[name]||0) + 1;
    });
  });
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a,b) => b.count - a.count);
}

/* ══════════════════════════════════════════
   섹터 트리 (원본 3707~3843행)
   메인 섹터 카드 안에 서브섹터를 들여쓰기로 표시, 드래그로 재배치

   ── 행사별 독립 트리(신규) ──
   섹터는 이제 "공통"(모든 행사 공유) 또는 특정 행사 전용으로 나뉜다.
   행사 전용 섹터는 name에 "행사짧은이름 · 섹터명" 접두어가 붙어 저장되고
   (utils.js의 scopedSectorName/parseSectorScope 참고 — sectors 시트
   스키마는 그대로 id/name/parent 3컬럼), 이 화면의 드롭다운으로 선택한
   범위(_sectorScope)에 해당하는 것만 트리에 걸러서 보여준다. */
let _sectorScope = ''; // '' = 공통, 그 외엔 EVENT_LIST[].short 값

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
  const cur = _sectorScope;
  sel.innerHTML = '<option value="">공통 (모든 행사 공유)</option>' +
    EVENT_LIST.map(e => `<option value="${escapeHtml(e.short)}"${e.short===cur?' selected':''}>${escapeHtml(e.short)} 전용</option>`).join('');
  // 선택된 행사가 목록에서 사라졌으면 공통으로 되돌림
  if(cur && !EVENT_LIST.some(e => e.short === cur)){ _sectorScope = ''; sel.value = ''; }
}

export function onSectorScopeChange(v){
  _sectorScope = v || '';
  const titleEl = document.getElementById('sector-tree-title');
  if(titleEl) titleEl.textContent = _sectorScope ? `섹터 트리 — ${_sectorScope} 전용` : '섹터 트리 — 공통';
  renderSectorTree();
}

// 설정 화면에서 섹터를 클릭하면 기업DB로 이동해서 그 섹터로 바로 필터링 (원본 3707~3711행)
export function filterCoBySector(name){
  window.switchApp?.('co');
  setCoCat(name);
}

/* 현재 선택된 범위(_sectorScope)에 속하는 메인 섹터만 골라낸다 */
function mainSectorsInScope(){
  return mainSectors().filter(m => (parseSectorScope(m.name).eventShort || '') === _sectorScope);
}

export function renderSectorTree(){
  const el = document.getElementById('sector-tree');
  if(!el) return;

  const mains = mainSectorsInScope();
  if(!mains.length){
    el.innerHTML = `<div style="font-size:12px;color:var(--i4)">${_sectorScope ? escapeHtml(_sectorScope)+' 전용으로 ' : ''}등록된 섹터가 없어요. 아래에서 새로 만들어보세요.</div>`;
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
      ${commonMains.map(c => `<option value="${escAttr(c.id)}"${cur===c.id?' selected':''}>= ${escapeHtml(c.name)}</option>`).join('')}
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
        ${_sectorScope ? canonicalSelect(m) : domainSelect(m)}
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
  const val = scopedSectorName(_sectorScope, raw);
  if(COMPANY_SECTORS.some(s => sectorKey(typeof s==='string'?s:s.name) === sectorKey(val))){ alert('이미 있는 섹터예요.'); return; }

  const newId = slugifySectorName(val);
  const sector = { id: newId, name: val, parent: mainId, domain: '', canonical: '' };
  COMPANY_SECTORS.push(sector);
  renderSectorList();
  try { buildCoCAT(); populateUploadEvDropdown(); } catch(e){}
  await upsertSectorRow(sector);
}

export function onSectorDragStart(e, id){
  _draggedSectorId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id); // Firefox 등에서 드래그 시작 요건 충족용
}

export async function onSectorDropToMain(e, mainId){
  e.preventDefault();
  const id = _draggedSectorId;
  _draggedSectorId = null;
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
  const id = _draggedSectorId;
  _draggedSectorId = null;
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

/* ══════════════════════════════════════════
   새 메인 섹터 추가 (원본 4119~4135행)
══════════════════════════════════════════ */
export async function addMainSector(){
  const inp = document.getElementById('sector-main-add-input');
  const raw = inp ? inp.value.trim() : '';
  if(!raw){ inp && inp.focus(); return; }

  // 선택된 행사 범위(_sectorScope)가 있으면 그 행사 전용 섹터로 접두어를 붙인다
  const val = scopedSectorName(_sectorScope, raw);
  const exists = COMPANY_SECTORS.some(s => sectorKey(typeof s==='string'?s:s.name) === sectorKey(val));
  if(exists){ alert('이미 있는 섹터예요.'); return; }

  const newId = slugifySectorName(val);
  const sector = { id: newId, name: val, parent: null, domain: '', canonical: '' };

  COMPANY_SECTORS.push(sector);
  if(inp) inp.value = '';
  renderSectorList();
  try { buildCoCAT(); populateUploadEvDropdown(); } catch(e){}
  await upsertSectorRow(sector);
}

/* ══════════════════════════════════════════
   엑셀로 섹터 일괄 추가 (신규 — 원본에는 없던 기능)
   "메인섹터"/"서브섹터" 2컬럼 엑셀을 업로드하면, 지금 선택된 범위(_sectorScope)에
   메인·서브 섹터를 한 번에 만든다. 미리보기 → 확정 2단계로 진행해서
   실수로 잘못된 파일을 그대로 반영하지 않게 한다.
══════════════════════════════════════════ */
const SECTOR_COL_ALIASES = {
  main: ['메인섹터','메인 섹터','대분류','메인','main','mainsector','main sector','maincategory','main category'],
  sub:  ['서브섹터','서브 섹터','소분류','서브','sub','subsector','sub sector','subcategory','sub category'],
};

function guessSectorColumn(headers, aliases){
  const norm = h => String(h).toLowerCase().replace(/[\s_\-\/().·,]/g,'');
  for(const h of headers){
    if(aliases.some(a => norm(h) === norm(a))) return h;
  }
  for(const h of headers){
    if(aliases.some(a => norm(a).length >= 3 && norm(h).includes(norm(a)))) return h;
  }
  return null;
}

let _pendingSectorImport = null; // { groups: [{ main, subs:[...] }] }

export function handleSectorFileSelect(e){
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  const nameEl = document.getElementById('sector-file-name');
  if(nameEl) nameEl.textContent = file.name;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const wb = XLSX.read(ev.target.result, { type:'array', cellText:true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval:'', raw:false });
      if(!rows.length){ renderSectorImportPreview(null, '빈 파일이거나 데이터를 읽을 수 없어요.'); return; }

      const headers = Object.keys(rows[0]);
      const mainCol = guessSectorColumn(headers, SECTOR_COL_ALIASES.main);
      const subCol  = guessSectorColumn(headers, SECTOR_COL_ALIASES.sub);
      if(!mainCol){
        renderSectorImportPreview(null, `"메인섹터" 컬럼을 찾지 못했어요. 파일 헤더: ${headers.join(', ')}`);
        return;
      }

      const groupsMap = new Map();
      rows.forEach(r => {
        const main = String(r[mainCol]||'').trim();
        const sub  = subCol ? String(r[subCol]||'').trim() : '';
        if(!main) return;
        if(!groupsMap.has(main)) groupsMap.set(main, new Set());
        if(sub) groupsMap.get(main).add(sub);
      });
      const groups = [...groupsMap.entries()].map(([main, subsSet]) => ({ main, subs: [...subsSet] }));
      if(!groups.length){
        renderSectorImportPreview(null, '유효한 메인섹터 값을 찾지 못했어요.');
        return;
      }

      _pendingSectorImport = { groups };
      renderSectorImportPreview(groups);
    } catch(err){
      console.warn('[settings-tab] 섹터 파일 파싱 실패:', err);
      renderSectorImportPreview(null, '파일을 읽는 중 오류가 발생했어요: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderSectorImportPreview(groups, errorMsg){
  const el = document.getElementById('sector-import-preview');
  if(!el) return;
  if(errorMsg){
    el.innerHTML = `<div style="font-size:12px;color:var(--re)">${escapeHtml(errorMsg)}</div>`;
    return;
  }
  if(!groups){ el.innerHTML = ''; return; }

  const totalSubs = groups.reduce((n,g) => n + g.subs.length, 0);
  const scopeLabel = _sectorScope ? `"${_sectorScope}" 전용` : '"공통"';
  el.innerHTML = `
    <div style="font-size:12px;color:var(--i2);margin-bottom:8px">
      메인 섹터 <b>${groups.length}개</b>, 서브 섹터 <b>${totalSubs}개</b>를 ${escapeHtml(scopeLabel)} 범위에 추가합니다.
    </div>
    <div style="max-height:180px;overflow-y:auto;border:1px solid var(--i6);border-radius:6px;padding:8px 10px;background:var(--W);margin-bottom:10px">
      ${groups.map(g => `
        <div style="margin-bottom:6px">
          <div style="font-size:12px;font-weight:700;color:var(--i1)">${escapeHtml(g.main)}</div>
          ${g.subs.length ? `<div style="font-size:11px;color:var(--i4);padding-left:12px">${g.subs.map(escapeHtml).join(', ')}</div>` : ''}
        </div>`).join('')}
    </div>
    <div style="display:flex;gap:6px">
      <button class="btn bp" style="font-size:11px" onclick="confirmSectorImport()">이대로 추가</button>
      <button class="btn bs" style="font-size:11px" onclick="cancelSectorImport()">취소</button>
    </div>`;
}

export function cancelSectorImport(){
  _pendingSectorImport = null;
  const el = document.getElementById('sector-import-preview');
  if(el) el.innerHTML = '';
  const inp = document.getElementById('sector-file-input');
  if(inp) inp.value = '';
  const nameEl = document.getElementById('sector-file-name');
  if(nameEl) nameEl.textContent = '';
}

export async function confirmSectorImport(){
  if(!_pendingSectorImport) return;
  const { groups } = _pendingSectorImport;

  let addedMain = 0, addedSub = 0, skippedMain = 0, skippedSub = 0;

  for(const g of groups){
    const mainName = scopedSectorName(_sectorScope, g.main);
    let mainSector = COMPANY_SECTORS.find(s => sectorKey(s.name) === sectorKey(mainName) && !s.parent);
    if(!mainSector){
      mainSector = { id: slugifySectorName(mainName), name: mainName, parent: null, domain: '', canonical: '' };
      COMPANY_SECTORS.push(mainSector);
      addedMain++;
      await upsertSectorRow(mainSector);
    } else {
      skippedMain++;
    }

    for(const subRaw of g.subs){
      // 여러 메인 섹터에 같은 서브섹터명(예: "Others")이 반복될 수 있어서,
      // 이미 다른 메인 아래 같은 이름이 있으면 메인명을 붙여 구분한다.
      const collidesElsewhere = COMPANY_SECTORS.some(s =>
        s.parent && s.parent !== mainSector.id && sectorKey(parseSectorScope(s.name).plainName) === sectorKey(subRaw)
      );
      const subPlain = collidesElsewhere ? `${subRaw} (${g.main})` : subRaw;
      const subName = scopedSectorName(_sectorScope, subPlain);

      const exists = COMPANY_SECTORS.some(s => s.parent === mainSector.id && sectorKey(s.name) === sectorKey(subName));
      if(exists){ skippedSub++; continue; }

      const subSector = { id: slugifySectorName(subName), name: subName, parent: mainSector.id, domain: '', canonical: '' };
      COMPANY_SECTORS.push(subSector);
      addedSub++;
      await upsertSectorRow(subSector);
    }
  }

  cancelSectorImport();
  renderSectorList();
  try { buildCoCAT(); populateUploadEvDropdown(); } catch(e){}

  alert(`섹터 추가 완료 — 메인 ${addedMain}개(중복 ${skippedMain}개 건너뜀), 서브 ${addedSub}개(중복 ${skippedSub}개 건너뜀)`);
}

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
  trackAction('edit', '분야 이름 변경', d.name, `분야 이름: ${prev} → ${d.name}`);
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
  trackAction('edit', '분야 삭제', d.name, `분야 "${d.name}" 삭제 (섹터 ${affected.length}개 미분류로 이동)`);
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
  trackAction('edit', '태그 이름 변경', t.label, `태그 이름: ${prev} → ${t.label}`);
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
  trackAction('edit', '태그 삭제', t.label, `태그 "${t.label}" 삭제 (연락처 ${affected.length}건에서 제거)`);
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

export async function addPartType(){
  const inp = document.getElementById('parttype-add-input');
  const colorSel = document.getElementById('parttype-add-color');
  const val = inp ? inp.value.trim() : '';
  if(!val){ inp && inp.focus(); return; }
  if(PART_TYPES.some(t => t.key === val)){ alert('이미 있는 참가 유형이에요.'); return; }

  const t = { key: val, label: val, cls: (colorSel && colorSel.value) || 'p-gray' };
  PART_TYPES.push(t);
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
              title="${escAttr(st.label)}">${escapeHtml(p.label)}${st.key === 'done' ? ' ✓' : ''}</span>`; }).join('')
          || '<span style="font-size:10.5px;color:var(--i5)">진행 파트 없음</span>'}</div>
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
  try { buildMDBEvList(); populateUploadEvDropdown(); } catch(e){}

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
  try { buildMDBEvList(); populateUploadEvDropdown(); } catch(e){}
  deleteEventFromSheet(key);
  trackAction('edit', '행사 삭제', key, `행사 "${ev.name||key}" 삭제`
    + (partCount ? ` (참여 기록 ${partCount}건 잔존)` : ''));
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
  if(!targets.length){
    if(msgEl) msgEl.textContent = '이미 모두 한글 국가명으로 정리돼 있어요.';
    return;
  }
  if(!confirm(`${targets.length}건의 국가명을 한글로 통일해서 구글시트에 저장할까요?`)) return;

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
   arch-pane-ev / arch-pane-sector / arch-pane-sys 3개 패널을 전환한다.
   arch-pane-sys 내부의 정적 SVG 다이어그램(전체 아키텍처/구글시트 연동/
   업무 플로우) 자체는 index.html 정적 마크업에 그대로 남아있고,
   switchAV는 그 3개 다이어그램 중 무엇을 보여줄지 display 토글만 한다
   (JS 로직은 사실상 이 전환 함수 하나뿐).
══════════════════════════════════════════ */
export function switchArchTab(tab){
  ['ev','sector','val','sys'].forEach(t => {
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
  if(tab==='ev')     { closeEvDetail(); }   // 목록부터 — 상세는 카드를 눌러서 연다
  if(tab==='sector') { renderSectorList(); renderPartTypeList(); renderTagList(); }
  if(tab==='val')    { renderCodeListPicker(); renderAliasList(); mountEquipCatalog('eqcat-rows', ''); renderEvCfgList(); }
}

// archV는 이 탭에서만 쓰는 로컬 UI 상태라 state.js로 옮기지 않고 모듈 스코프에 둠
let archV = 'arch';
export function switchAV(v, btn){
  archV = v;
  ['arch','sheet','flow'].forEach(id => {
    const el = document.getElementById('av-'+id);
    if(el) el.style.display = id===v ? 'block' : 'none';
  });
  document.querySelectorAll('#sbp-arch .nr').forEach(b => b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  const tt = {arch:'시스템 아키텍처', sheet:'구글시트 연동 구조', flow:'업무 플로우'};
  const ttlEl = document.getElementById('arch-ttl');
  if(ttlEl) ttlEl.innerHTML = `${tt[v]} <span class="tb-s">Contact CRM 데이터 흐름</span>`;
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
window.addMainSector         = addMainSector;
window.addPartType           = addPartType;
window.removePartType        = removePartType;
window.autoFillEvId          = autoFillEvId;
window.addEventToList        = addEventToList;
window.removeEventFromList   = removeEventFromList;
window.normalizeAllCountries = normalizeAllCountries;
window.splitMixedOrgNames    = splitMixedOrgNames;
window.switchArchTab         = switchArchTab;
window.switchAV              = switchAV;
window.onSectorScopeChange   = onSectorScopeChange;
window.handleSectorFileSelect = handleSectorFileSelect;
window.confirmSectorImport    = confirmSectorImport;
window.cancelSectorImport     = cancelSectorImport;
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
const CL_DEFS = [
  { key: 'contact_cat',  label: '연락처 카테고리',    perEvent: false },
  { key: 'org_kind',     label: '기업 종류',          perEvent: false },
  { key: 'org_status',   label: '기업 상태',          perEvent: false },
  { key: 'contact_role', label: '전시 담당자 역할',   perEvent: false },
  { key: 'item_cat',     label: '금액 항목 분류',     perEvent: false },
  { key: 'currency',     label: '통화',               perEvent: false },
  { key: 'log_channel',  label: '문의 채널',          perEvent: false },
  { key: 'log_cat',      label: '문의 분류',          perEvent: false },
  { key: 'booth_type',   label: '부스 타입',          perEvent: true  },
  { key: 'grade',        label: '스폰서 등급',        perEvent: true  },
  { key: 'equip_cat',    label: '비품 카탈로그 분류', perEvent: true  },
  /* 연사 역할 — 행사마다 다르게 부른다(발제자/좌장 대신 «발표»/«의장»을 쓰는
     학회도 있다). CL_DEFS에 넣지 않으면 설정 화면에 나오지 않는다 —
     pay_method가 그래서 고칠 수 없는 채로 있다. */
  { key: 'speaker_role', label: '연사 역할',          perEvent: true  },
  { key: 'graphic_cat',  label: '그래픽 품목 분류',   perEvent: true  },
];
const CL_COLORS = [['', '— 없음 —'], ['p-blue', '파랑'], ['p-green', '초록'], ['p-amber', '주황'],
  ['p-teal', '청록'], ['p-purple', '보라'], ['p-red', '빨강'], ['p-gray', '회색'],
  ['p-gold', '금색'], ['p-indigo', '남색']];

const clDef = (k) => CL_DEFS.find(d => d.key === k)
  || (k === 'cat_alias' ? { key: k, label: '업로드 표기 매핑', perEvent: false } : CL_DEFS[0]);
const clKey = () => document.getElementById('cl-key')?.value || CL_DEFS[0].key;
const clScope = () => document.getElementById('cl-scope')?.value || '';
const clSlug = (v) => String(v).replace(/[^A-Za-z0-9가-힣]/g, '').slice(0, 24);

/* 지금 고른 목록·범위의 행 — 숨긴 것도 포함해 순서대로 */
function clRowsOf(key, scope){
  return CODE_LISTS.filter(c => c.list_key === key && (c.event_id || '') === scope)
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
}

export function renderCodeListPicker(){
  const kel = document.getElementById('cl-key');
  if(!kel) return;
  const cur = kel.value || CL_DEFS[0].key;
  kel.innerHTML = CL_DEFS.map(d =>
    `<option value="${escAttr(d.key)}"${cur === d.key ? ' selected' : ''}>${escapeHtml(d.label)}</option>`).join('');
  renderCodeList();
}

export function renderCodeList(){
  const key = clKey(), def = clDef(key);
  const sel = document.getElementById('cl-scope');
  const el = document.getElementById('cl-rows');
  if(!sel || !el) return;

  // 행사별로 나뉘지 않는 목록은 범위 선택을 잠근다 — 고를 수 있게 두면 값이
  // 어디에 저장됐는지 헷갈린다
  const prev = sel.value;
  sel.disabled = !def.perEvent;
  sel.innerHTML = '<option value="">공통 (모든 행사)</option>'
    + (def.perEvent ? EVENT_LIST.map(e => {
        const k = e.key || e.name || e;
        return `<option value="${escAttr(k)}"${prev === k ? ' selected' : ''}>${escapeHtml(k)} 전용</option>`;
      }).join('') : '');
  if(!def.perEvent) sel.value = '';
  // 고른 범위에 아무것도 없고 다른 범위에 들어 있으면 그쪽을 연다 — 실제로는
  // 행사 전용으로 들어 있는 목록을 "공통"으로 열어 텅 빈 화면을 보여주면
  // 목록이 없는 줄 안다
  if(def.perEvent && !clRowsOf(key, sel.value).length){
    const has = CODE_LISTS.find(c => c.list_key === key && c.event_id);
    if(has && [...sel.options].some(o => o.value === has.event_id)) sel.value = has.event_id;
  }

  const scope = clScope();
  const rows = clRowsOf(key, scope);
  const inherited = def.perEvent && scope && !rows.length;

  el.innerHTML = (inherited
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

function clRowsHtml(rows, readonly){
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
        <input class="fi" value="${escAttr(c.label || '')}" placeholder="이름" style="min-width:120px"
          onchange="editCodeListRow('${escAttr(c.id)}','label',this.value)"></label>
      <label class="clf"><span class="clf-l">색상</span>
        <select class="fi" style="min-width:100px" onchange="editCodeListRow('${escAttr(c.id)}','cls',this.value)">
          ${CL_COLORS.map(([v, l]) => `<option value="${v}"${(c.cls || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="clf"><span class="clf-l">순서</span>
        <input class="fi" type="number" value="${escAttr(c.sort_order || '')}" title="순서" style="width:70px"
          onchange="editCodeListRow('${escAttr(c.id)}','sort_order',this.value)"></label>
      <span class="clf"><span class="clf-l"></span>
        <button class="btn" onclick="toggleCodeListRow('${escAttr(c.id)}')"
          style="height:32px;font-size:11px">${off ? '되살리기' : '숨김'}</button></span>`}
    </div>`;
  }).join('');
}

/* 한 행만 고치므로 객체형(upsertPartial) 경로를 쓴다 — 위치 배열로 보내면
   컬럼이 늘었을 때 안 보낸 칸이 비워진다 */
const saveCodeRow = (row, label) =>
  postToSheet({ sheet: 'code_lists', action: 'upsertPartial', data: row }, label);

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
  if(evDetailKey) renderEvDetail();
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
    `<option value="${escAttr(k)}"${sel === k ? ' selected' : ''}>${escapeHtml(CL[k] || k)}</option>`).join('');

  el.innerHTML = (rows.length ? rows.map(c => {
    const off = c.active === 'no';
    return `<div class="clrow" style="padding:6px 0;border-bottom:1px solid var(--i7)${off ? ';opacity:.5' : ''}">
      <label class="clf clf-grow"><span class="clf-l">표기</span>
        <input class="fi" value="${escAttr(c.code)}" placeholder="업로드에 적힌 표기" style="min-width:150px"
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
const DUE_LABEL = {
  'manual_replied_at': '매뉴얼 회신', 'app_received_at': '신청서', 'booth_confirmed_at': '부스',
  'calc:payment': '입금', 'calc:graphic': '그래픽', 'directory_received_at': '도록', 'movein_at': '반입',
};

window.renderAliasList = renderAliasList;
window.addAliasRow     = addAliasRow;
window.renderEvCfgList = renderEvCfgList;

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
let eqKind = 'equip';    // 비품 / 그래픽 — 한 표에 함께 담겨 있다
let eqEvent = '';        // 보고 있는 행사
let eqCatFil = '';       // 분류 필터
let eqQuery = '';        // 검색어
/* 같은 편집기를 두 자리가 나눠 쓴다 — 설정값 탭(eqcat-rows)과 행사 상세.
   행사 상세에서는 어느 행사인지가 이미 정해져 있어 행사 선택을 잠근다. */
let eqTarget = 'eqcat-rows';
let eqLockEv = '';
export function mountEquipCatalog(targetId, lockEv){
  eqTarget = targetId || 'eqcat-rows';
  eqLockEv = lockEv || '';
  if(eqLockEv && eqEvent !== eqLockEv){ eqEvent = eqLockEv; eqCatFil = ''; eqQuery = ''; }
  renderEquipCatalog();
}
/* 행사 상세에서 비품 칸을 떠날 때 — 다음 렌더가 사라진 자리를 찾지 않도록
   설정값 탭 자리로만 돌려놓고 그리지는 않는다 */
function mountEquipCatalogIdle(){
  if(eqTarget === 'eqcat-rows') return;
  eqTarget = 'eqcat-rows';
  eqLockEv = '';
}

const eqNum = (v) => String(v ?? '').replace(/[^0-9.]/g, '');
const eqMoney = (v) => { const n = Number(eqNum(v)); return n ? n.toLocaleString() : ''; };

/* 이 품목을 몇 곳이 신청했나 — 지워도 되는지 판단하는 근거 */
const eqUsedBy = (id) => EXH_ITEMS.filter(i => i.catalog_id === id).length;

const eqRows = () => EQUIP_CATALOG
  .filter(c => c.event_id === eqEvent)
  .filter(c => (c.kind || 'equip') === eqKind)
  .filter(c => !eqCatFil || (c.category || '') === eqCatFil)
  .filter(c => {
    if(!eqQuery) return true;
    const q = eqQuery.toLowerCase();
    return [c.code, c.name_ko, c.name_en, c.spec].some(v => String(v || '').toLowerCase().includes(q));
  })
  .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
    || String(a.code || '').localeCompare(String(b.code || '')));

export function renderEquipCatalog(){
  const el = document.getElementById(eqTarget);
  if(!el) return;

  // 처음 열 때는 품목이 실제로 들어 있는 행사를 연다 — 빈 화면을 보여주면
  // 품목표가 없는 줄 안다(설정값 탭의 선택 목록과 같은 이유)
  const evs = [...new Set(EQUIP_CATALOG.map(c => c.event_id).filter(Boolean))];
  if(eqLockEv) eqEvent = eqLockEv;
  else if(!eqEvent) eqEvent = evs[0] || (EVENT_LIST[0]?.key || '');

  const all = EQUIP_CATALOG.filter(c => c.event_id === eqEvent && (c.kind || 'equip') === eqKind);
  const cats = [...new Set(all.map(c => c.category || '').filter(Boolean))];

  el.innerHTML = `
    <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:10px">
      ${eqLockEv ? '' : `<div style="min-width:170px"><div class="mlbl">행사</div>
        <select class="fi" style="width:100%" onchange="setEqEvent(this.value)">
          ${(evs.length ? evs : EVENT_LIST.map(e => e.key)).map(k =>
            `<option value="${escAttr(k)}"${k === eqEvent ? ' selected' : ''}>${escapeHtml(k)}</option>`).join('')}
        </select></div>`}
      <div style="min-width:120px"><div class="mlbl">종류</div>
        <select class="fi" style="width:100%" onchange="setEqKind(this.value)">
          <option value="equip"${eqKind === 'equip' ? ' selected' : ''}>비품</option>
          <option value="graphic"${eqKind === 'graphic' ? ' selected' : ''}>그래픽</option>
        </select></div>
      <div style="min-width:130px"><div class="mlbl">분류</div>
        <select class="fi" style="width:100%" onchange="setEqCatFil(this.value)">
          <option value="">전체</option>
          ${cats.map(c => `<option value="${escAttr(c)}"${c === eqCatFil ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select></div>
      <div style="flex:1;min-width:150px"><div class="mlbl">검색</div>
        <input class="fi" style="width:100%" value="${escAttr(eqQuery)}" placeholder="코드·품명·규격"
          oninput="setEqQuery(this.value)"></div>
    </div>
    <div id="eqcat-count" style="font-size:11px;color:var(--i4);margin-bottom:8px">${eqCountHtml()}</div>

    <div id="eqcat-list">${eqListHtml()}</div>

    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--i6)">
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
            ${(cats.length ? cats : ['기타비품']).map(c => `<option value="${escAttr(c)}">${escapeHtml(c)}</option>`).join('')}
          </select></div>
        <div style="width:100px"><div class="mlbl">KRW</div>
          <input class="fi" id="eq-new-krw" style="width:100%" placeholder="0"></div>
        <div style="width:90px"><div class="mlbl">USD</div>
          <input class="fi" id="eq-new-usd" style="width:100%" placeholder="0"></div>
        <button class="btn bp" onclick="addEquipItem()" style="min-width:60px;height:36px">추가</button>
      </div>
      <div id="eq-new-msg" style="font-size:11px;margin-top:6px"></div>
    </div>`;
}

function eqRowHtml(c){
  const off = c.active === 'no';
  const used = eqUsedBy(c.id);
  return `<div class="clrow" style="padding:6px 0;border-bottom:1px solid var(--i7)${off ? ';opacity:.5' : ''}">
    <div style="display:flex;gap:8px;align-items:center;min-width:0;flex:0 0 auto">
      <code style="font-size:11px;color:var(--i4);min-width:64px">${escapeHtml(c.code || '')}</code>
      ${used ? `<span class="pill p-blue" title="이 품목을 신청한 내역">${used}건</span>`
             : `<span class="pill p-gray" title="아무도 신청하지 않았어요">미사용</span>`}
    </div>
    <label class="clf clf-grow"><span class="clf-l">국문</span>
      <input class="fi" value="${escAttr(c.name_ko || '')}" placeholder="품명(국문)" style="min-width:110px"
        onchange="editEquipItem('${escAttr(c.id)}','name_ko',this.value)"></label>
    <label class="clf clf-grow"><span class="clf-l">영문</span>
      <input class="fi" value="${escAttr(c.name_en || '')}" placeholder="품명(영문)" style="min-width:110px"
        onchange="editEquipItem('${escAttr(c.id)}','name_en',this.value)"></label>
    <label class="clf"><span class="clf-l">KRW</span>
      <input class="fi" value="${escAttr(eqMoney(c.price_krw))}" placeholder="KRW" style="width:96px;text-align:right"
        onchange="editEquipItem('${escAttr(c.id)}','price_krw',this.value)"></label>
    <label class="clf"><span class="clf-l">USD</span>
      <input class="fi" value="${escAttr(eqMoney(c.price_usd))}" placeholder="USD" style="width:80px;text-align:right"
        onchange="editEquipItem('${escAttr(c.id)}','price_usd',this.value)"></label>
    <span class="clf"><span class="clf-l"></span>
      <button class="btn" onclick="removeEquipItem('${escAttr(c.id)}')"
        style="height:32px;font-size:11px">${off ? '되살리기' : used ? '숨김' : '삭제'}</button></span>
  </div>`;
}

export function setEqKind(v){ eqKind = v; eqCatFil = ''; eqQuery = ''; renderEquipCatalog(); }
export function setEqEvent(v){ eqEvent = v; eqCatFil = ''; renderEquipCatalog(); }
export function setEqCatFil(v){ eqCatFil = v; renderEquipCatalog(); }
export function setEqQuery(v){
  eqQuery = v;
  // 검색은 글자를 칠 때마다 다시 그리는데, 통째로 다시 그리면 입력칸이 포커스를
  // 잃는다. 목록만 갈아 끼우고 입력칸은 그대로 둔다.
  const el = document.getElementById(eqTarget);
  if(!el) return;
  const box = el.querySelector('#eqcat-list');
  const cnt = el.querySelector('#eqcat-count');
  if(box){ box.innerHTML = eqListHtml(); if(cnt) cnt.innerHTML = eqCountHtml(); return; }
  renderEquipCatalog();
}
/* 개수 안내 — 검색할 때 목록만 갈아 끼우면 이 줄이 옛 숫자로 남는다 */
const eqCountHtml = () => {
  const all = EQUIP_CATALOG.filter(c => c.event_id === eqEvent && (c.kind || 'equip') === eqKind);
  const hidden = all.filter(c => c.active === 'no').length;
  const shown = eqRows().length;
  return `${escapeHtml(eqEvent)} ${eqKind === 'graphic' ? '그래픽' : '비품'} ${all.length}개${hidden ? ` (숨김 ${hidden}개 포함)` : ''}`
    + (shown !== all.length ? ` · 지금 보이는 것 ${shown}개` : '');
};

const eqListHtml = () => { const rows = eqRows();
  return rows.length ? rows.map(eqRowHtml).join('')
    : '<div style="font-size:12px;color:var(--i4);padding:8px 0">해당하는 품목이 없어요.</div>'; };

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
  trackAction('edit', '품목 수정', eqEvent,
    `<b>${escapeHtml(c.code || '')}</b> ${escapeHtml(c.name_ko || c.name_en || '')} — ${LBL[field] || field}: ${
      escapeHtml(prev || '(빈값)')} → ${escapeHtml(v || '(빈값)')}`);
  renderEquipCatalog();
  window.renderExh?.();   // 전시 탭이 열려 있으면 단가가 바로 반영되게
}

/* 내리기 — 쓰는 중이면 숨기고, 아무도 안 쓴 품목만 정말 지운다 */
export async function removeEquipItem(id){
  const c = EQUIP_CATALOG.find(x => x.id === id);
  if(!c) return;
  const nm = `${c.code || ''} ${c.name_ko || c.name_en || ''}`.trim();
  const used = eqUsedBy(c.id);

  // 되살리기
  if(c.active === 'no'){
    c.active = '';
    const r = await saveEquipCatalog(c);
    if(!r.ok){ c.active = 'no'; renderEquipCatalog(); return; }
    trackAction('edit', '품목 되살리기', eqEvent, `<b>${escapeHtml(nm)}</b> 다시 고를 수 있게 함`);
    renderEquipCatalog(); return;
  }

  if(used){
    if(!confirm(`"${nm}"을(를) 숨길까요?\n${used}곳이 이미 신청해 둔 품목이라 지우지 않고 숨깁니다.\n앞으로 새로 고를 수 없지만, 기존 신청 내역과 금액은 그대로 남습니다.`)) return;
    c.active = 'no';
    const r = await saveEquipCatalog(c);
    if(!r.ok){ c.active = ''; renderEquipCatalog(); return; }
    trackAction('edit', '품목 숨김', eqEvent, `<b>${escapeHtml(nm)}</b> 숨김 (신청 ${used}건은 유지)`);
    renderEquipCatalog(); return;
  }

  if(!confirm(`"${nm}"을(를) 품목표에서 완전히 지울까요?\n아무도 신청하지 않은 품목이라 지워도 남는 기록이 없습니다.`)) return;
  const i = EQUIP_CATALOG.indexOf(c);
  EQUIP_CATALOG.splice(i, 1);
  const r = await deleteEquipCatalog(c.id);
  if(!r.ok){ EQUIP_CATALOG.splice(i, 0, c); renderEquipCatalog(); return; }
  trackAction('delete', '품목 삭제', eqEvent, `<b>${escapeHtml(nm)}</b> 품목표에서 삭제 (신청 내역 없음)`);
  renderEquipCatalog();
  window.renderExh?.();
}

export async function addEquipItem(){
  const msg = document.getElementById('eq-new-msg');
  const say = (t, ok) => { if(msg){ msg.style.color = ok ? 'var(--g)' : 'var(--re)'; msg.textContent = t; } };
  const g = (id) => (document.getElementById(id)?.value || '').trim();
  const ko = g('eq-new-ko'), en = g('eq-new-en');
  if(!ko && !en){ say('품명을 국문이나 영문 중 하나는 입력해주세요.'); return; }

  const mine = EQUIP_CATALOG.filter(c => c.event_id === eqEvent && (c.kind || 'equip') === eqKind);
  // 같은 이름이 이미 있으면 새로 만들지 않는다 — 품목표를 둔 이유가 없어진다
  const key = (v) => String(v || '').toLowerCase().replace(/\s+/g, '');
  const dup = mine.find(c => (ko && key(c.name_ko) === key(ko)) || (en && key(c.name_en) === key(en)));
  if(dup){ say(`이미 있는 품목이에요 — ${dup.code} ${dup.name_ko || dup.name_en}`); return; }

  let code = g('eq-new-code').toUpperCase();
  const used = new Set(mine.map(c => String(c.code || '').toUpperCase()));
  if(code && used.has(code)){ say(`이미 쓰고 있는 코드예요 — ${code}`); return; }
  if(!code){
    let n = 1;
    const pre = eqKind === 'graphic' ? 'XG' : 'X';
    while(used.has(`${pre}-${String(n).padStart(3, '0')}`)) n++;
    code = `${pre}-${String(n).padStart(3, '0')}`;
  }

  const rec = {
    id: `EC-${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    event_id: eqEvent, kind: eqKind,
    category: g('eq-new-cat') || (eqKind === 'graphic' ? '기타그래픽' : '기타비품'), code,
    name_ko: ko, name_en: en, spec: '',
    price_krw: eqNum(g('eq-new-krw')), price_usd: eqNum(g('eq-new-usd')),
    note: '', active: '', sort_order: String(900 + mine.length),
  };
  EQUIP_CATALOG.push(rec);
  const r = await saveEquipCatalog(rec);
  if(!r.ok){ EQUIP_CATALOG.pop(); say('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.'); return; }
  if(r.id && r.id !== rec.id) rec.id = r.id;

  trackAction('add', '품목 등록', eqEvent,
    `<b>${escapeHtml(code)}</b> ${escapeHtml(ko || en)} — ${escapeHtml(eqEvent)} 품목표에 추가`);
  ['eq-new-code', 'eq-new-ko', 'eq-new-en', 'eq-new-krw', 'eq-new-usd']
    .forEach(id => { const e = document.getElementById(id); if(e) e.value = ''; });
  renderEquipCatalog();
  say(`${code} ${ko || en} 추가했어요.`, true);
  window.renderExh?.();
}

window.renderEquipCatalog = renderEquipCatalog;
window.setEqKind    = setEqKind;
window.setEqEvent   = setEqEvent;
window.setEqCatFil  = setEqCatFil;
window.setEqQuery   = setEqQuery;
window.editEquipItem = editEquipItem;
window.removeEquipItem = removeEquipItem;
window.addEquipItem = addEquipItem;


/* ══════════════════════════════════════════
   행사 상세 설정 — 설정 › 행사 관리에서 행사 하나를 고르면 열린다

   전에는 행사 하나를 두고 정할 것이 세 군데에 흩어져 있었다. 행사 자체는 이 탭,
   부스 타입·스폰서 등급은 설정값 탭의 선택 목록, 비품 품목표는 그 아래, 마감일은
   전시 탭. "이 행사 설정 어디서 하죠"에 답을 하나로 만들려고 한자리에 모은다.

   목록과 상세는 같은 자리(arch-pane-ev)를 나눠 쓴다. 모달로 띄우지 않은 이유는
   안에 표가 들어가기 때문이다 — 470px 카드에 품목표를 넣으면 못 읽는다.

   저장 위치는 settings 시트의 exh_cfg_<행사키> 한 줄이다. 행사당 한 줄인 구조를
   그대로 두는 편이, 파트를 넣자고 events 테이블에 열을 늘리는 것보다 되돌리기 쉽다.
══════════════════════════════════════════ */
let evDetailKey = '';        // 보고 있는 행사 (빈 문자열 = 목록 뷰)
let evDetailSeg = 'basic';

const EV_SEGS = [['basic','기본 정보'], ['parts','진행 파트'],
  ['booth','부스'], ['equip','비품'], ['due','일정'], ['conf','컨퍼런스']];

/* 전시를 안 하는 행사에서는 부스·비품·일정이 뜻이 없다. 감추지 않고 잠그는 건
   "왜 없지"로 끝나지 않게 하려는 것이다 — 켜는 자리를 같은 화면에서 알려준다. */
const EV_SEG_NEEDS_EXH = ['booth', 'equip', 'due'];
/* 세그먼트마다 어느 파트가 켜져 있어야 하는지 — 부스·비품·일정은 전시,
   컨퍼런스는 컨퍼런스. 감추지 않고 잠그는 건 «왜 없지»로 끝나지 않게 하려는 것이다. */
const EV_SEG_PART = { booth: 'exh', equip: 'exh', due: 'exh', conf: 'conf' };
const evSegLocked = (seg, parts) => {
  const need = EV_SEG_PART[seg];
  return !!need && parts[need] === 'none';
};
/* 잠금 안내에서 어느 파트를 켜라고 할지 */
const evSegPartLabel = (seg) => {
  const k = EV_SEG_PART[seg];
  return (EVENT_PARTS.find(p => p.key === k) || {}).label || '';
};

export function openEvDetail(key){
  evDetailKey = key;
  evDetailSeg = 'basic';
  const list = document.getElementById('ev-mgr-list-view');
  const det  = document.getElementById('ev-mgr-detail-view');
  if(list) list.style.display = 'none';
  if(det)  det.style.display  = 'block';
  renderEvDetail();
}

export function closeEvDetail(){
  evDetailKey = '';
  // 비품 편집기를 설정값 탭 자리로 돌려놓는다 — 안 그러면 그쪽에서 열었을 때
  // 사라진 자리에 그리려 하고 화면이 빈 채로 남는다
  mountEquipCatalogIdle();
  const list = document.getElementById('ev-mgr-list-view');
  const det  = document.getElementById('ev-mgr-detail-view');
  if(det){  det.style.display  = 'none'; det.innerHTML = ''; }
  if(list) list.style.display = 'block';
  renderEvMgr();
}

export function setEvDetailSeg(seg){ evDetailSeg = seg; renderEvDetail(); }

export function renderEvDetail(){
  const el = document.getElementById('ev-mgr-detail-view');
  if(!el || !evDetailKey) return;
  const ev = EVENT_LIST.find(e => e.key === evDetailKey);
  if(!ev){ closeEvDetail(); return; }        // 다른 곳에서 지워졌다

  const parts = evParts(ev.key);
  const locked = evSegLocked(evDetailSeg, parts);
  /* 진행 완료된 전시는 설정도 손대지 않는다 — 끝난 행사의 부스 타입이나 단가가
     바뀌면 그때 무엇으로 청구했는지가 지금 값으로 덮인다. */
  /* 진행 완료된 파트는 설정도 손대지 않는다 — 끝난 행사의 값이 바뀌면 그때
     무엇으로 했는지가 지금 값으로 덮인다. 세그먼트가 보는 파트를 따라간다. */
  const readonly = evPartDone(ev.key, EV_SEG_PART[evDetailSeg] || 'exh');

  const seg = EV_SEGS.map(([k, l]) => {
    const off = evSegLocked(k, parts);
    return `<button class="seg-b${evDetailSeg === k ? ' on' : ''}" onclick="setEvDetailSeg('${k}')"
      style="${off ? 'opacity:.45' : ''}" ${off ? 'title="전시 파트를 켜면 쓸 수 있어요"' : ''}>${l}${off ? ' 🔒' : ''}</button>`;
  }).join('');

  const body = locked
    ? `<div style="font-size:12px;color:var(--i4);padding:24px 0">
         이 행사는 <b>${escapeHtml(evSegPartLabel(evDetailSeg))}</b> 파트가 꺼져 있어 ${escapeHtml(EV_SEGS.find(x => x[0] === evDetailSeg)[1])} 설정을 쓰지 않아요.
         <button class="btn" style="margin-left:8px;font-size:11px" onclick="setEvDetailSeg('parts')">진행 파트에서 켜기</button>
       </div>`
    : evDetailSeg === 'parts' ? evPartsHtml(ev, parts)
    : evDetailSeg === 'booth' ? evBoothHtml(ev)
    : evDetailSeg === 'equip' ? '<div id="ev-eqcat-rows"></div>'
    : evDetailSeg === 'due'   ? evDueHtml(ev)
    : evDetailSeg === 'conf'  ? evConfHtml(ev)
    : evBasicHtml(ev);

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <button class="btn" style="font-size:11px;height:28px" onclick="closeEvDetail()">← 행사 목록</button>
      <div style="width:12px;height:12px;border-radius:50%;background:${escAttr(ev.color || '#3B5BDB')};flex-shrink:0"></div>
      <div style="font-size:14px;font-weight:700;color:var(--i1)">${escapeHtml(ev.name || ev.key)}</div>
      <span style="font-size:11px;color:var(--i4);background:var(--i7);border-radius:3px;padding:1px 5px;font-family:monospace">${escapeHtml(ev.key)}</span>
    </div>
    <div class="seg" style="flex-wrap:wrap;margin-bottom:14px">${seg}</div>
    ${readonly && EV_SEG_PART[evDetailSeg] ? `<div style="display:flex;align-items:center;gap:8px;
        background:var(--i8);border:1px solid var(--i6);border-left:3px solid var(--g);border-radius:8px;
        padding:9px 12px;margin-bottom:10px">
      <span class="pill p-green">진행 완료</span>
      <span style="font-size:11.5px;color:var(--i3)">끝난 파트라 열람만 됩니다. 고치려면 <b>진행 파트</b>에서 진행 중으로 되돌리세요.</span>
    </div>` : ''}
    <div class="${readonly && EV_SEG_PART[evDetailSeg] ? 'ro' : ''}"
      style="background:var(--i8);border:1px solid var(--i6);border-radius:10px;padding:16px">${body}</div>`;

  // 비품 편집기는 문자열이 아니라 자기 함수가 그린다 — 자리를 만든 뒤 붙인다
  if(evDetailSeg === 'equip' && !locked) mountEquipCatalog('ev-eqcat-rows', ev.key);
  else mountEquipCatalogIdle();
}

/* ── 기본 정보 ──
   행사는 지금까지 추가·삭제만 됐다. 오타 하나 고치려고 지웠다 다시 만들면
   participations 연결이 끊기므로, 여기서 처음으로 고칠 수 있게 한다.
   행사 ID(key)는 못 고친다 — 연결 키라서 바꾸면 참여 기록이 전부 떨어진다. */
function evBasicHtml(ev){
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
      <div><div class="mlbl">행사명 (풀네임)</div>
        <input class="fi" id="evd-name" value="${escAttr(ev.name || ev.key)}" style="width:100%"></div>
      <div><div class="mlbl">약칭</div>
        <input class="fi" id="evd-short" value="${escAttr(ev.short || '')}" style="width:100%"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">
      <div><div class="mlbl">시작일</div>
        <input class="fi" id="evd-date-start" type="date" value="${escAttr(ev.date_start || '')}" style="width:100%"></div>
      <div><div class="mlbl">종료일</div>
        <input class="fi" id="evd-date-end" type="date" value="${escAttr(ev.date_end || '')}" style="width:100%"></div>
      <div><div class="mlbl">색상</div>
        <input type="color" id="evd-color" value="${escAttr(ev.color || '#3B5BDB')}"
          style="width:100%;height:36px;border:1px solid var(--i6);border-radius:6px;cursor:pointer;padding:2px"></div>
    </div>
    <div style="margin-bottom:12px"><div class="mlbl">장소</div>
      <input class="fi" id="evd-loc" value="${escAttr(ev.location || '')}" style="width:100%"></div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn bp" onclick="saveEvBasic()" style="min-width:80px">저장</button>
      <span id="evd-basic-msg" style="font-size:11px;color:var(--g)"></span>
    </div>
    <div style="font-size:10.5px;color:var(--i5);margin-top:10px">
      행사 ID <code>${escapeHtml(ev.key)}</code>는 참여 기록·참가기업이 가리키는 키라 바꿀 수 없어요.
    </div>`;
}

export async function saveEvBasic(){
  const ev = EVENT_LIST.find(e => e.key === evDetailKey);
  if(!ev) return;
  const msg = document.getElementById('evd-basic-msg');
  const say = (t, ok) => { if(msg){ msg.style.color = ok ? 'var(--g)' : 'var(--re)'; msg.textContent = t; } };
  const g = (id) => (document.getElementById(id)?.value || '').trim();

  const name = g('evd-name');
  if(!name){ say('행사명은 비울 수 없어요.'); return; }

  const prev = { ...ev };
  const start = g('evd-date-start');
  Object.assign(ev, {
    name, short: g('evd-short') || name,
    date_start: start, date: start,       // date는 하위 호환용 시작일
    date_end: g('evd-date-end'), location: g('evd-loc'),
    color: document.getElementById('evd-color')?.value || ev.color,
  });

  const r = await saveEventToSheet(ev);
  if(r && r.ok === false){ Object.assign(ev, prev); say('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.'); renderEvDetail(); return; }

  const changed = ['name','short','date_start','date_end','location','color']
    .filter(f => (prev[f] || '') !== (ev[f] || ''))
    .map(f => `${f} ${prev[f] || '없음'} → ${ev[f] || '없음'}`);
  if(changed.length) trackAction('edit', '행사 정보 수정', ev.key, changed.join(' / '));

  try { buildMDBEvList(); populateUploadEvDropdown(); } catch(e){}
  say('저장했어요.', true);
  renderEvDetail();
  setTimeout(() => { const m = document.getElementById('evd-basic-msg'); if(m) m.textContent = ''; }, 2000);
}

/* ── 진행 파트 ──
   행사마다 무엇을 하는지가 다르다. 켜 둔 파트만 화면에 나오게 하는 게 목적이고,
   지금은 전시만 실제로 잠금이 붙는다 — 나머지는 운영 화면이 아직 없다. */
function evPartsHtml(ev, parts){
  const exhSummary = () => {
    const bt = clRowsOf('booth_type', ev.key).length || clRowsOf('booth_type', '').length;
    const eq = EQUIP_CATALOG.filter(c => c.event_id === ev.key).length;
    return `부스 타입 ${bt}종 · 비품 품목 ${eq}건`;
  };
  return EVENT_PARTS.map(p => {
    const st = parts[p.key];
    const sub = (st !== 'none' && p.key === 'exh') ? exhSummary() : '';
    return `<div style="display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--i7);flex-wrap:wrap">
      <div style="flex:1;min-width:150px">
        <div style="font-size:13px;font-weight:600;color:var(--i1)">${escapeHtml(p.label)}</div>
        <div style="font-size:11px;color:var(--i4);margin-top:2px">
          ${sub ? escapeHtml(sub) : p.partTypes.map(t => `<span class="pill p-gray" style="margin-right:3px">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>
      <div class="seg" style="flex-wrap:wrap">
        ${PART_STATES.map(x => `<button class="seg-b${st === x.key ? ' on' : ''}"
          onclick="setEvPart('${escAttr(p.key)}','${escAttr(x.key)}')">${escapeHtml(x.label)}</button>`).join('')}
      </div>
    </div>`;
  }).join('')
  + `<div style="font-size:10.5px;color:var(--i5);margin-top:12px;line-height:1.7">
      <b>안 함</b> — 그 파트를 열지 않는 행사예요. 전시를 안 함으로 두면 전시 탭에서 이 행사가 열리지 않습니다.<br>
      <b>진행 중</b> — 지금 챙기는 중. 고칠 수 있어요.<br>
      <b>진행 완료</b> — 끝난 일이라 <b>열람만</b> 됩니다. 데이터는 그대로 두고 고치는 것만 막아요.
      정산 입금이 늦게 들어오는 것처럼 손봐야 할 일이 생기면 다시 <b>진행 중</b>으로 되돌리면 됩니다.<br>
      지금 화면에 반영되는 건 <b>전시</b>뿐이에요 — 컨퍼런스·파트너링·후원은 여기 적어 두면 운영 화면이 생길 때 그대로 이어집니다.
    </div>`;
}

export async function setEvPart(part, state){
  const ev = EVENT_LIST.find(e => e.key === evDetailKey);
  if(!ev) return;
  const now = evParts(ev.key);
  const def = EVENT_PARTS.find(p => p.key === part);
  if(!def || now[part] === state) return;

  /* 무엇이 잠기는지 누르기 전에 말해 준다. 전시만 화면이 걸려 있어 전시만 묻는다.
     되돌릴 수 있는 설정이지만, 눌러 보고 알게 하면 늦다. */
  const ask = part !== 'exh' ? ''
    : state === 'none' ? `${ev.name || ev.key}의 전시를 "안 함"으로 둘까요?\n전시 탭에서 이 행사가 열리지 않고, 부스·비품·일정 설정도 잠깁니다.\n(등록된 참가기업·품목 데이터는 그대로 남습니다)`
    : state === 'done' ? `${ev.name || ev.key}의 전시를 "진행 완료"로 둘까요?\n전시 탭을 볼 수는 있지만 고칠 수 없게 됩니다.\n(다시 "진행 중"으로 되돌리면 언제든 고칠 수 있어요)`
    : '';
  if(ask && !confirm(ask)) return;

  const ok = await saveEvParts(ev.key, { ...now, [part]: state });
  if(!ok) return;
  trackAction('edit', '진행 파트 변경', ev.key,
    `${ev.name || ev.key} — ${def.label} ${partStateOf(now[part]).label} → ${partStateOf(state).label}`);
  renderEvDetail();
  renderEvMgr();
  window.renderExh?.();
  window.renderEvDb?.();
}

/* parts만 갈아 끼우고 나머지(due·book)는 그대로 둔다 — settings의 한 줄을
   통째로 덮어쓰는 저장이라, 읽어 온 것을 펼쳐서 다시 넣지 않으면 마감일이 날아간다 */
async function saveEvParts(evKey, parts){
  const prev = EXH_CFG[evKey] ? JSON.parse(JSON.stringify(EXH_CFG[evKey])) : undefined;
  const cfg = { ...(prev || {}), parts };
  EXH_CFG[evKey] = cfg;
  const r = await saveExhCfgToSheet(evKey, cfg);
  if(r && r.ok === false){
    if(prev) EXH_CFG[evKey] = prev; else delete EXH_CFG[evKey];
    alert('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    renderEvDetail();
    return false;
  }
  return true;
}

/* ── 부스 ──
   부스 타입과 스폰서 등급은 code_lists에 들어 있고, 행사 전용 목록이 있으면
   그걸 쓰고 없으면 공통을 쓴다(state.js codeList). 그 규칙이 화면에서 안 보이면
   "고쳤는데 안 바뀐다"가 되므로, 지금 보고 있는 게 공통인지 이 행사 것인지를
   머리말에 배지로 붙인다. */
const EV_BOOTH_LISTS = [['booth_type','부스 타입'], ['grade','스폰서 등급']];

function evBoothHtml(ev){
  return EV_BOOTH_LISTS.map(([key, label]) => {
    const mine = clRowsOf(key, ev.key);
    const common = clRowsOf(key, '');
    const inherited = !mine.length;
    return `<div style="margin-bottom:22px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="font-size:12px;font-weight:700;color:var(--i2)">${escapeHtml(label)}</div>
        <span class="pill ${inherited ? 'p-gray' : 'p-blue'}">${inherited ? '공통' : '이 행사'}</span>
      </div>
      ${!inherited ? clRowsHtml(mine, false)
        : common.length
          ? `<div style="font-size:11px;color:var(--i4);margin-bottom:8px">이 행사 전용 목록이 없어 <b>공통 목록</b>을 씁니다. 아래에 항목을 추가하거나 공통을 복제하면, 그때부터 이 행사는 자기 목록만 씁니다.</div>
             <div style="opacity:.55;pointer-events:none">${clRowsHtml(common, true)}</div>
             <button class="btn" style="font-size:11px;margin-top:8px" onclick="cloneCommonCodeList('${escAttr(key)}')">공통 ${common.length}개를 이 행사로 복제</button>`
          : `<div style="font-size:11px;color:var(--i4)">공통 목록에도 이 행사 전용으로도 아직 항목이 없어요. 아래에서 추가하면 이 행사 전용 목록이 만들어집니다.</div>`}
      <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px solid var(--i6)">
        <div style="flex:1;min-width:140px"><div class="mlbl">저장값</div>
          <input class="fi" id="evcl-code-${escAttr(key)}" placeholder="예: Block System D" style="width:100%"
            onkeydown="if(event.key==='Enter')addEvCodeRow('${escAttr(key)}')"></div>
        <div style="flex:1;min-width:140px"><div class="mlbl">화면에 보일 이름</div>
          <input class="fi" id="evcl-label-${escAttr(key)}" placeholder="비우면 저장값 그대로" style="width:100%"
            onkeydown="if(event.key==='Enter')addEvCodeRow('${escAttr(key)}')"></div>
        <button class="btn bp" onclick="addEvCodeRow('${escAttr(key)}')" style="min-width:60px;height:36px">추가</button>
      </div>
    </div>`;
  }).join('');
}

export async function addEvCodeRow(listKey){
  const ev = EVENT_LIST.find(e => e.key === evDetailKey);
  if(!ev) return;
  const code = (document.getElementById(`evcl-code-${listKey}`)?.value || '').trim();
  if(!code){ document.getElementById(`evcl-code-${listKey}`)?.focus(); return; }
  if(clRowsOf(listKey, ev.key).some(c => c.code === code)){ alert('이미 있는 값이에요.'); return; }

  const rows = clRowsOf(listKey, ev.key);
  const row = {
    id: `CD-${listKey}-${clSlug(ev.key)}-${clSlug(code)}-${Math.random().toString(36).slice(2, 6)}`,
    list_key: listKey, event_id: ev.key, code,
    label: (document.getElementById(`evcl-label-${listKey}`)?.value || '').trim() || code,
    cls: '', note: '', active: '',
    sort_order: String((Number(rows[rows.length - 1]?.sort_order) || rows.length * 10) + 10),
  };
  CODE_LISTS.push(row);
  const r = await saveCodeRow(row, '선택 목록 추가');
  if(!r.ok){ CODE_LISTS.pop(); renderEvDetail(); return; }
  applyCodeLists();
  trackAction('edit', '선택 목록 추가', row.label, `${clDef(listKey).label}(${ev.key})에 "${row.label}" 추가`);
  renderEvDetail();
}

/* 공통을 통째로 이 행사 것으로 옮겨 적는다. 한 줄만 고치고 싶어도 행사 전용
   목록이 생기는 순간 공통은 안 쓰이므로, 나머지도 같이 넘겨야 목록이 줄지 않는다. */
export async function cloneCommonCodeList(listKey){
  const ev = EVENT_LIST.find(e => e.key === evDetailKey);
  if(!ev) return;
  const common = clRowsOf(listKey, '');
  if(!common.length) return;
  if(clRowsOf(listKey, ev.key).length){ renderEvDetail(); return; }
  if(!confirm(`공통 ${clDef(listKey).label} ${common.length}개를 ${ev.key} 전용으로 복제할까요?\n복제한 뒤에는 이 행사만 따로 고칠 수 있고, 공통을 고쳐도 이 행사에는 반영되지 않습니다.`)) return;

  const made = [];
  for(const c of common){
    const row = { ...c, event_id: ev.key,
      id: `CD-${listKey}-${clSlug(ev.key)}-${clSlug(c.code)}-${Math.random().toString(36).slice(2, 6)}` };
    CODE_LISTS.push(row);
    const r = await saveCodeRow(row, '선택 목록 복제');
    if(!r.ok){
      // 중간에 끊기면 반쪽짜리 목록이 남는다 — 넣은 것만 되돌리고 멈춘다
      [...made, row].forEach(x => { const i = CODE_LISTS.indexOf(x); if(i >= 0) CODE_LISTS.splice(i, 1); });
      alert('복제 도중 저장에 실패했어요. 아무것도 바뀌지 않았습니다.');
      applyCodeLists(); renderEvDetail(); return;
    }
    made.push(row);
  }
  applyCodeLists();
  trackAction('edit', '선택 목록 복제', ev.key, `${clDef(listKey).label} 공통 ${made.length}개를 ${ev.key} 전용으로 복제`);
  renderEvDetail();
}

/* ── 일정 ──
   전에는 전시 탭 대시보드의 "마감일 설정"에서만 고칠 수 있었다. 설정을 찾으러
   여기 온 사람을 전시 탭으로 돌려보내지 않으려고 같은 값을 여기서도 고친다.
   담기는 자리(EXH_CFG.due / .book)는 그대로라 전시 탭과 늘 같은 값을 본다. */
const EV_DUE_STEPS = Object.entries(DUE_LABEL);
const EV_BOOK_DEFAULT = { chars: 1300, words: 200 };

function evDueHtml(ev){
  const cfg = EXH_CFG[ev.key] || {};
  const due = cfg.due || {}, book = cfg.book || {};
  return `
    <div style="font-size:12px;font-weight:700;color:var(--i2);margin-bottom:4px">단계별 마감일</div>
    <div style="font-size:11px;color:var(--i4);margin-bottom:10px">기업에서 받아내야 해서 늦으면 준비가 밀리는 단계들이에요. 비워 두면 마감 없음입니다.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-bottom:18px">
      ${EV_DUE_STEPS.map(([k, l]) => `<div><div class="mlbl">${escapeHtml(l)}</div>
        <input class="fi" type="date" id="evd-due-${escAttr(k)}" value="${escAttr(due[k] || '')}" style="width:100%"></div>`).join('')}
    </div>
    <div style="font-size:12px;font-weight:700;color:var(--i2);margin-bottom:4px">프로그램북 한도</div>
    <div style="font-size:11px;color:var(--i4);margin-bottom:10px">지면 기준이 행사마다 달라요. 비워 두면 기본값(${EV_BOOK_DEFAULT.chars.toLocaleString()}자 · ${EV_BOOK_DEFAULT.words}단어)을 씁니다.</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;max-width:320px;margin-bottom:14px">
      <div><div class="mlbl">글자수</div>
        <input class="fi" type="number" id="evd-book-chars" value="${escAttr(book.chars || EV_BOOK_DEFAULT.chars)}" style="width:100%"></div>
      <div><div class="mlbl">단어수</div>
        <input class="fi" type="number" id="evd-book-words" value="${escAttr(book.words || EV_BOOK_DEFAULT.words)}" style="width:100%"></div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn bp" onclick="saveEvDue()" style="min-width:80px">저장</button>
      <span id="evd-due-msg" style="font-size:11px;color:var(--g)"></span>
    </div>`;
}

export async function saveEvDue(){
  const ev = EVENT_LIST.find(e => e.key === evDetailKey);
  if(!ev) return;
  const msg = document.getElementById('evd-due-msg');
  const say = (t, ok) => { if(msg){ msg.style.color = ok ? 'var(--g)' : 'var(--re)'; msg.textContent = t; } };

  const chars = Number(document.getElementById('evd-book-chars')?.value);
  const words = Number(document.getElementById('evd-book-words')?.value);
  if(!(chars > 0) || !(words > 0)){ say('글자수·단어수 한도는 1 이상이어야 해요.'); return; }

  const due = {};
  EV_DUE_STEPS.forEach(([k]) => {
    const v = (document.getElementById(`evd-due-${k}`)?.value || '').trim();
    if(v) due[k] = v;   // 빈 칸은 안 담는다 — 마감 없음과 빈 문자열을 구분할 필요가 없다
  });

  const prev = EXH_CFG[ev.key] ? JSON.parse(JSON.stringify(EXH_CFG[ev.key])) : undefined;
  const cfg = { ...(prev || {}), due, book: { chars, words } };
  EXH_CFG[ev.key] = cfg;
  const r = await saveExhCfgToSheet(ev.key, cfg);
  if(r && r.ok === false){
    if(prev) EXH_CFG[ev.key] = prev; else delete EXH_CFG[ev.key];
    say('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.'); renderEvDetail(); return;
  }

  const changed = [];
  EV_DUE_STEPS.forEach(([k, l]) => {
    const a = ((prev || {}).due || {})[k] || '', b = due[k] || '';
    if(a !== b) changed.push(`${l} ${a || '없음'} → ${b || '없음'}`);
  });
  const pb = (prev || {}).book || {};
  if(pb.chars !== chars || pb.words !== words){
    changed.push(`프로그램북 한도 ${pb.chars || EV_BOOK_DEFAULT.chars}자·${pb.words || EV_BOOK_DEFAULT.words}단어 → ${chars}자·${words}단어`);
  }
  if(changed.length) trackAction('edit', '행사 설정 변경', ev.key, changed.join(' / '));

  say('저장했어요.', true);
  renderEvCfgList();
  window.renderExh?.();
  setTimeout(() => { const m = document.getElementById('evd-due-msg'); if(m) m.textContent = ''; }, 2000);
}

window.openEvDetail        = openEvDetail;
window.closeEvDetail       = closeEvDetail;
window.setEvDetailSeg      = setEvDetailSeg;
window.renderEvDetail      = renderEvDetail;
window.saveEvBasic         = saveEvBasic;
window.setEvPart           = setEvPart;
window.addEvCodeRow        = addEvCodeRow;
window.cloneCommonCodeList = cloneCommonCodeList;
window.saveEvDue           = saveEvDue;

/* ══════════════════════════════════════════
   컨퍼런스 설정 — 행사 상세의 «컨퍼런스» 세그먼트

   연사를 넣기 전에 정해 둬야 하는 것들이다. 역할 목록과 역할별 요구 항목이
   없으면 그 뒤 화면이 «무엇을 받아야 하나»를 계산할 근거가 없다.

   담는 곳은 exh_cfg_<행사키> JSON의 conf 한 자리다 — parts·due·book이 이미
   그 줄에 얹혀 있고, 쓰는 곳들이 {...prev}로 저장하므로 서로 지우지 않는다.
══════════════════════════════════════════ */

/* conf만 갈아 끼우고 나머지(parts·due·book)는 그대로 둔다 */
/* 컨퍼런스 설정 저장. 엑셀 업로드가 트랙·장소를 등록할 때도 이 길을 쓴다 —
   설정을 쓰는 자리가 둘이면 한쪽이 다른 키를 날린다. */
export async function saveConf(evKey, conf){
  const prev = EXH_CFG[evKey] ? JSON.parse(JSON.stringify(EXH_CFG[evKey])) : undefined;
  const cfg = { ...(prev || {}), conf };
  EXH_CFG[evKey] = cfg;
  const r = await saveExhCfgToSheet(evKey, cfg);
  if(r && r.ok === false){
    if(prev) EXH_CFG[evKey] = prev; else delete EXH_CFG[evKey];
    alert('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    renderEvDetail();
    return false;
  }
  return true;
}

function evConfHtml(ev){
  const cfg = confCfg(ev.key);
  const days = confDays(ev.key);
  const slots = cfg.slots || [];
  const tracks = cfg.tracks || [];
  const rooms = cfg.rooms || [];
  const limits = cfg.limits || {};
  const docs = cfg.docs || {};
  const roles = codeList('speaker_role', ev.key, SPEAKER_ROLES.map(r => ({ code: r.key, label: r.label, cls: r.cls })));

  /* ── 역할 × 받을 항목 격자 ──
     설계 문서의 그 표를 그대로 화면에 둔다. 셀을 누르면 ● → ○ → — 로 돈다.
     기본값은 코드(SPEAKER_ROLES)에 있고, 여기서 바꾼 것만 conf.roleNeeds에 담긴다.
     그래서 코드의 기본값을 나중에 고치면 손대지 않은 행사에는 그것이 따라온다. */
  const grid = `<div style="overflow-x:auto">
    <table style="min-width:520px;font-size:12px">
      <thead><tr>
        <th style="text-align:left;min-width:160px">받을 것</th>
        ${roles.map(r => `<th style="text-align:center;min-width:62px">${escapeHtml(r.label || r.code)}</th>`).join('')}
      </tr></thead>
      <tbody>
        ${SPEAKER_NEEDS.map(n => `<tr>
          <td style="font-size:11.5px">
            ${escapeHtml(n.label)}
            <div style="font-family:monospace;font-size:9.5px;color:var(--i5)">${escapeHtml(n.where)}${
              SPEAKER_NEEDS_ON_TALK.includes(n.key) ? ' · 발제' : ''}</div>
          </td>
          ${roles.map(r => { const st = speakerNeed(ev.key, r.code, n.key);
            const over = ((cfg.roleNeeds || {})[r.code] || {});
            const changed = (n.key in over);
            return `<td style="text-align:center;padding:4px">
              <button onclick="cycleSpeakerNeed('${escAttr(r.code)}','${escAttr(n.key)}')"
                title="${escAttr(`${r.label || r.code} · ${n.label} — ${NEED_LABEL[st]}${changed ? ' (이 행사만 바꿈)' : ''}`)}"
                style="width:30px;height:26px;border-radius:6px;cursor:pointer;font-size:13px;line-height:1;
                  border:1px solid ${changed ? 'var(--a)' : 'var(--i6)'};
                  background:${st === 'req' ? 'var(--gb)' : st === 'opt' ? 'var(--ab)' : 'var(--W)'};
                  color:${st === 'req' ? 'var(--g)' : st === 'opt' ? 'var(--am)' : 'var(--i5)'};
                  font-weight:700">${NEED_MARK[st]}</button></td>`; }).join('')}
        </tr>`).join('')}
      </tbody></table></div>
    <div style="font-size:10.5px;color:var(--i5);margin-top:8px;line-height:1.7">
      <b>●</b> 받아야 함 — 안 오면 «받을 것 현황»과 독촉 목록에 뜹니다 ·
      <b>○</b> 있으면 좋음 — 받으면 표시만 하고 독촉하지 않습니다 ·
      <b>—</b> 묻지 않음 — 그 칸이 화면에서 사라집니다<br>
      테두리가 파란 칸은 이 행사만 기본값과 다르게 정한 것이에요.
      ${(cfg.roleNeeds && Object.keys(cfg.roleNeeds).length)
        ? `<button class="btn" style="font-size:10.5px;margin-top:6px" onclick="resetSpeakerNeeds()">기본값으로 되돌리기</button>` : ''}
    </div>`;

  const row = (label, hint, inner) => `<div style="padding:11px 0;border-bottom:1px solid var(--i7)">
    <div class="mlbl">${escapeHtml(label)}${hint ? `<span style="color:var(--i5);font-weight:400"> ${escapeHtml(hint)}</span>` : ''}</div>
    ${inner}</div>`;

  const numIn = (id, v, ph) => `<input class="fi" type="number" id="${id}" value="${escAttr(v || '')}"
    placeholder="${escAttr(ph)}" style="width:110px">`;
  const txtIn = (id, v, ph) => `<input class="fi" id="${id}" value="${escAttr(v || '')}"
    placeholder="${escAttr(ph)}" style="width:100%">`;

  return `
    <div style="font-size:12px;font-weight:700;color:var(--i2);margin-bottom:4px">역할별로 무엇을 받나</div>
    <div style="font-size:11px;color:var(--i4);margin-bottom:10px">
      이 격자가 «받을 것 현황»의 계산식이에요. 좌장에게 초록을 독촉하지 않는 것도 여기서 정해집니다.
      역할 이름 자체는 <b>설정값 › 선택 목록 › 연사 역할</b>에서 고칩니다.
    </div>
    ${grid}

    <div style="font-size:12px;font-weight:700;color:var(--i2);margin:22px 0 4px">발표 일자·시간</div>
    ${row('발표 일자', `행사 기간에서 자동으로 만들어요 (${days.length}일)`, `
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px">
        ${days.length ? days.map(d => {
          const extra = (cfg.days || []).includes(d);
          return `<span class="pill ${extra ? 'p-blue' : 'p-gray'}" title="${extra ? '설정에서 더한 날' : '행사 기간'}">${escapeHtml(d)}${
            extra ? ` <span onclick="removeConfDay('${escAttr(d)}')" style="cursor:pointer">✕</span>` : ''}</span>`;
        }).join('') : '<span style="font-size:11.5px;color:var(--i5)">행사 기간이 비어 있어요 — 기본 정보에서 넣어주세요</span>'}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="date" class="fi" id="conf-day-add" style="width:150px">
        <button class="btn" style="font-size:11px" onclick="addConfDay()">+ 날짜 더하기</button>
        <span style="font-size:10.5px;color:var(--i5)">사전행사처럼 기간 밖의 날만 더하면 돼요</span>
      </div>`)}

    ${row('시간대', '세션을 짤 때 고르는 칸이에요', `
      <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:6px">
        ${slots.length ? slots.map((sl, i) => `<div style="display:flex;gap:6px;align-items:center;font-size:11.5px">
          <span class="pill p-gray" style="min-width:104px;text-align:center">${escapeHtml(sl.start || '')}–${escapeHtml(sl.end || '')}</span>
          <span style="flex:1;min-width:0;color:var(--i3)">${escapeHtml(sl.label || '')}</span>
          <button class="btn" style="font-size:10.5px" onclick="removeConfSlot(${i})">삭제</button>
        </div>`).join('') : '<div style="font-size:11.5px;color:var(--i5)">아직 없어요 — 세션 시간을 직접 적어도 되지만, 자주 쓰는 시간대를 넣어 두면 고르기만 하면 됩니다</div>'}
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input type="time" class="fi" id="conf-slot-s" style="width:104px">
        <span style="color:var(--i5)">–</span>
        <input type="time" class="fi" id="conf-slot-e" style="width:104px">
        <input class="fi" id="conf-slot-l" placeholder="이름 (예: 오전 세션)" style="flex:1;min-width:120px">
        <button class="btn" style="font-size:11px" onclick="addConfSlot()">추가</button>
      </div>`)}

    ${row('장소', '적은 순서가 표의 열 순서', `
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px">
        ${rooms.length ? rooms.map((t, i) => `<span class="pill p-teal">${escapeHtml(t)}
          ${i > 0 ? `<span onclick="moveConfRoom(${i},-1)" style="cursor:pointer" title="왼쪽으로">◀</span>` : ''}
          ${i < rooms.length - 1 ? `<span onclick="moveConfRoom(${i},1)" style="cursor:pointer" title="오른쪽으로">▶</span>` : ''}
          <span onclick="removeConfRoom(${i})" style="cursor:pointer">✕</span></span>`).join('')
          : '<span style="font-size:11.5px;color:var(--i5)">비워 두면 세션에 적힌 장소를 이름순으로 세웁니다</span>'}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input class="fi" id="conf-room-add" placeholder="예: HALL C" style="width:180px"
          onkeydown="if(event.key==='Enter')addConfRoom()">
        <button class="btn" style="font-size:11px" onclick="addConfRoom()">추가</button>
      </div>
      <div style="font-size:10.5px;color:var(--i4);margin-top:5px;line-height:1.6">
        메인 공간을 먼저 적으세요 — 프로그램표는 적은 순서대로 왼쪽부터 세웁니다.
        이름순으로는 «어디가 메인인지»를 알 길이 없어요.</div>`)}

    ${row('트랙', '동시에 여는 방', `
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px">
        ${tracks.length ? tracks.map((t, i) => {
          const c = trackColorOf(cfg, t);
          return `<span class="pill" style="background:${c.bg};color:var(--i1);border:1px solid ${c.bd}">
            <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c.bd};margin-right:4px"></span>${escapeHtml(t)}
            <span onclick="cycleTrackColor('${escAttr(t)}')" style="cursor:pointer;margin-left:3px" title="색 바꾸기">🎨</span>
            <span onclick="removeConfTrack(${i})" style="cursor:pointer">✕</span></span>`;
        }).join('')
          : '<span style="font-size:11.5px;color:var(--i5)">트랙이 하나면 비워 두세요</span>'}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input class="fi" id="conf-track-add" placeholder="예: Track A" style="width:180px"
          onkeydown="if(event.key==='Enter')addConfTrack()">
        <button class="btn" style="font-size:11px" onclick="addConfTrack()">추가</button>
      </div>`)}

    <div style="font-size:12px;font-weight:700;color:var(--i2);margin:22px 0 4px">글자수 한도</div>
    <div style="font-size:11px;color:var(--i4);margin-bottom:8px">
      행사마다 달라요. 넘치면 화면이 얼마나 줄여야 하는지까지 알려줍니다 — 비우면 한도를 걸지 않아요.
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;padding-bottom:11px;border-bottom:1px solid var(--i7)">
      <div><div class="mlbl">Professional experience</div>${numIn('conf-lim-pro', limits.bio_pro, '자')}</div>
      <div><div class="mlbl">Working experience</div>${numIn('conf-lim-work', limits.bio_work, '자')}</div>
      <div><div class="mlbl">초록</div>${numIn('conf-lim-abs', limits.abstract, '자')}</div>
    </div>

    <div style="font-size:12px;font-weight:700;color:var(--i2);margin:22px 0 4px">양식·가이드라인</div>
    <div style="font-size:11px;color:var(--i4);margin-bottom:8px">
      매번 바뀌니 행사별로 둡니다. 연사의 언어 설정에 따라 국문본·영문본 중 무엇을 보낼지가 갈려요.
      OneDrive 링크나 파일명을 적으세요.
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-bottom:11px;border-bottom:1px solid var(--i7)">
      <div><div class="mlbl">가이드라인 (국문)</div>${txtIn('conf-guide-ko', docs.guide_ko, '링크 또는 파일명')}</div>
      <div><div class="mlbl">가이드라인 (영문)</div>${txtIn('conf-guide-en', docs.guide_en, '링크 또는 파일명')}</div>
      <div><div class="mlbl">제출 양식 (국문)</div>${txtIn('conf-form-ko', docs.form_ko, '링크 또는 파일명')}</div>
      <div><div class="mlbl">제출 양식 (영문)</div>${txtIn('conf-form-en', docs.form_en, '링크 또는 파일명')}</div>
    </div>

    ${row('OneDrive 폴더', '사진·발표자료·동의서가 쌓이는 곳', txtIn('conf-folder', cfg.folder,
      '예: C:/Users/…/OneDrive - STUDIO BLOOM/4.행사/2026년/…/연사'))}

    <div style="display:flex;gap:8px;align-items:center;margin-top:14px">
      <button class="btn bp" onclick="saveEvConf()" style="min-width:80px">저장</button>
      <span id="conf-msg" style="font-size:11px;color:var(--g)"></span>
      <span style="font-size:10.5px;color:var(--i5);margin-left:auto">
        일자·시간대·트랙·역할 격자는 누르는 즉시 저장돼요</span>
    </div>`;
}

/* ── 격자 셀 한 번 누르기 — ● → ○ → — ──
   바꾼 값만 conf.roleNeeds에 담는다. 기본값과 같아지면 그 칸을 지워, 나중에
   코드의 기본값을 고치면 손대지 않은 행사에는 그것이 따라온다. */
export async function cycleSpeakerNeed(role, needKey){
  const ev = EVENT_LIST.find(e => e.key === evDetailKey);
  if(!ev) return;
  const cfg = JSON.parse(JSON.stringify(confCfg(ev.key)));
  const cur = speakerNeed(ev.key, role, needKey);
  const next = NEED_CYCLE[(NEED_CYCLE.indexOf(cur) + 1) % NEED_CYCLE.length];

  const def = SPEAKER_ROLES.find(r => r.key === role);
  const dflt = def ? (def.needs[needKey] ?? '') : '';

  cfg.roleNeeds = cfg.roleNeeds || {};
  cfg.roleNeeds[role] = { ...(cfg.roleNeeds[role] || {}) };
  if(next === dflt) delete cfg.roleNeeds[role][needKey];
  else cfg.roleNeeds[role][needKey] = next;
  if(!Object.keys(cfg.roleNeeds[role]).length) delete cfg.roleNeeds[role];
  if(!Object.keys(cfg.roleNeeds).length) delete cfg.roleNeeds;

  if(!await saveConf(ev.key, cfg)) return;
  trackAction('edit', '연사 요구 항목 변경', ev.key,
    `${ev.name || ev.key} — ${role} · ${SPEAKER_NEEDS.find(n => n.key === needKey)?.label || needKey}: ${NEED_LABEL[cur]} → ${NEED_LABEL[next]}`);
  renderEvDetail();
}

export async function resetSpeakerNeeds(){
  const ev = EVENT_LIST.find(e => e.key === evDetailKey);
  if(!ev) return;
  if(!confirm('역할별 받을 항목을 기본값으로 되돌릴까요?\n이 행사만 바꿔 둔 칸이 모두 사라집니다.')) return;
  const cfg = JSON.parse(JSON.stringify(confCfg(ev.key)));
  delete cfg.roleNeeds;
  if(!await saveConf(ev.key, cfg)) return;
  trackAction('edit', '연사 요구 항목 초기화', ev.key, `${ev.name || ev.key} — 기본값으로 되돌림`);
  renderEvDetail();
}

/* ── 일자·시간대·트랙 — 누르는 즉시 저장 ──
   목록에 한 줄 더하는 일은 «저장»을 따로 누르게 하면 잊는다. 아래 글자 칸들은
   타이핑 중이라 즉시 저장하지 않고 저장 버튼으로 모아 보낸다. */
async function pushConf(fn, label){
  const ev = EVENT_LIST.find(e => e.key === evDetailKey);
  if(!ev) return;
  const cfg = JSON.parse(JSON.stringify(confCfg(ev.key)));
  if(fn(cfg) === false) return;
  if(!await saveConf(ev.key, cfg)) return;
  trackAction('edit', '컨퍼런스 설정', ev.key, `${ev.name || ev.key} — ${label}`);
  renderEvDetail();
}

export const addConfDay = () => {
  const v = (document.getElementById('conf-day-add')?.value || '').trim();
  if(!v){ alert('날짜를 고르세요.'); return; }
  return pushConf(c => {
    c.days = c.days || [];
    if(c.days.includes(v)) return false;
    c.days.push(v); c.days.sort();
  }, `발표 일자 ${v} 더함`);
};
export const removeConfDay = (d) => pushConf(c => {
  c.days = (c.days || []).filter(x => x !== d);
}, `발표 일자 ${d} 뺌`);

export const addConfSlot = () => {
  const s = (document.getElementById('conf-slot-s')?.value || '').trim();
  const e = (document.getElementById('conf-slot-e')?.value || '').trim();
  const l = (document.getElementById('conf-slot-l')?.value || '').trim();
  if(!s || !e){ alert('시작·종료 시각을 넣어주세요.'); return; }
  if(e <= s){ alert('종료가 시작보다 빠르거나 같아요.'); return; }
  return pushConf(c => {
    c.slots = c.slots || [];
    c.slots.push({ start: s, end: e, label: l });
    c.slots.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  }, `시간대 ${s}–${e} 추가`);
};
export const removeConfSlot = (i) => pushConf(c => {
  c.slots = (c.slots || []).filter((_, k) => k !== i);
}, '시간대 삭제');

export const addConfRoom = () => {
  const v = (document.getElementById('conf-room-add')?.value || '').trim();
  if(!v) return;
  return pushConf(c => {
    c.rooms = c.rooms || [];
    if(c.rooms.includes(v)) return false;
    c.rooms.push(v);
  }, `장소 «${v}» 추가`);
};
export const removeConfRoom = (i) => pushConf(c => {
  c.rooms = (c.rooms || []).filter((_, k) => k !== i);
}, '장소 삭제');
/* 순서가 곧 표의 열 순서라, 지웠다 다시 넣게 하면 순서를 바꿀 때마다
   세션의 장소 이름과 어긋날 수 있다 — 자리만 맞바꾼다. */
export const moveConfRoom = (i, dir) => pushConf(c => {
  const list = c.rooms || [];
  const j = i + dir;
  if(j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  c.rooms = list;
}, '장소 순서 변경');

/* 트랙 색을 바꾼다 — 다음 색으로 한 칸 옮긴다. 색을 고르는 창을 띄우는
   것보다, 눌러서 원하는 색이 나올 때까지 돌리는 게 빠르다. */
export const cycleTrackColor = (track) => pushConf(c => {
  const map = { ...(c.trackColors || {}) };
  const cur = Number.isInteger(map[track]) ? map[track] : trackColorIndex(c, track);
  map[track] = (cur + 1) % TRACK_COLORS.length;
  c.trackColors = map;
}, `트랙 «${track}» 색 변경`);

export const addConfTrack = () => {
  const v = (document.getElementById('conf-track-add')?.value || '').trim();
  if(!v) return;
  return pushConf(c => {
    c.tracks = c.tracks || [];
    if(c.tracks.includes(v)) return false;
    c.tracks.push(v);
    /* 색을 지금 정해 둔다. 목록 순서로 색을 정하면 트랙을 하나 더할 때마다
       다른 트랙들의 색이 밀린다 — 트랙 하나에 색 하나를 붙여 둬야 한다. */
    c.trackColors = { ...(c.trackColors || {}), [v]: pickTrackColorIndex(c) };
  }, `트랙 «${v}» 추가`);
};
export const removeConfTrack = (i) => pushConf(c => {
  c.tracks = (c.tracks || []).filter((_, k) => k !== i);
}, '트랙 삭제');

/* ── 글자 칸 모아 저장 ── */
export async function saveEvConf(){
  const ev = EVENT_LIST.find(e => e.key === evDetailKey);
  if(!ev) return;
  const msg = document.getElementById('conf-msg');
  const say = (t, ok) => { if(msg){ msg.style.color = ok ? 'var(--g)' : 'var(--re)'; msg.textContent = t; } };
  const g = (id) => (document.getElementById(id)?.value || '').trim();
  const num = (id) => { const n = Number(g(id)); return n > 0 ? String(n) : ''; };

  const cfg = JSON.parse(JSON.stringify(confCfg(ev.key)));
  const limits = { bio_pro: num('conf-lim-pro'), bio_work: num('conf-lim-work'), abstract: num('conf-lim-abs') };
  Object.keys(limits).forEach(k => { if(!limits[k]) delete limits[k]; });
  if(Object.keys(limits).length) cfg.limits = limits; else delete cfg.limits;

  const docs = { guide_ko: g('conf-guide-ko'), guide_en: g('conf-guide-en'),
    form_ko: g('conf-form-ko'), form_en: g('conf-form-en') };
  Object.keys(docs).forEach(k => { if(!docs[k]) delete docs[k]; });
  if(Object.keys(docs).length) cfg.docs = docs; else delete cfg.docs;

  const folder = g('conf-folder');
  if(folder) cfg.folder = folder; else delete cfg.folder;

  if(!await saveConf(ev.key, cfg)) return;
  trackAction('edit', '컨퍼런스 설정', ev.key, `${ev.name || ev.key} — 글자수 한도·양식·폴더 저장`);
  say('저장했어요.', true);
  setTimeout(() => { const m = document.getElementById('conf-msg'); if(m) m.textContent = ''; }, 2000);
}

window.cycleSpeakerNeed  = cycleSpeakerNeed;
window.resetSpeakerNeeds = resetSpeakerNeeds;
window.addConfDay        = addConfDay;
window.removeConfDay     = removeConfDay;
window.addConfSlot       = addConfSlot;
window.removeConfSlot    = removeConfSlot;
window.addConfRoom       = addConfRoom;
window.removeConfRoom    = removeConfRoom;
window.moveConfRoom      = moveConfRoom;
window.cycleTrackColor   = cycleTrackColor;
window.addConfTrack      = addConfTrack;
window.removeConfTrack   = removeConfTrack;
window.saveEvConf        = saveEvConf;
