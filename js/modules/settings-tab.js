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
} from '../api.js';
import { trackAction } from './audit-tab.js';

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
  COMPANY_SECTORS.splice(idx, 1);
  renderSectorList();
  try { buildCoCAT(); populateUploadEvDropdown(); } catch(e){}
  await deleteSectorRow(id);
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
            c.beat||'', c.products||'', c.tags||'']),
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
        c.country,c.cat,c.lang,c.source,c.date,c.status,c.email1,c.email2,c.phone1,c.phone2,c.beat,c.products,c.tags||'']),
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
    <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--W);border:1px solid var(--i6);border-radius:8px;margin-bottom:6px">
      <div style="width:12px;height:12px;border-radius:50%;background:${e.color};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--i1)">${escapeHtml(e.name||e.key)}</div>
        <div style="font-size:11px;color:var(--i4)">
          <span style="background:var(--i7);border-radius:3px;padding:1px 5px;font-family:monospace">${escapeHtml(e.key)}</span>
          · ${escapeHtml(e.short||'')}
          ${e.date_start ? '· ' + escapeHtml(e.date_start) + (e.date_end ? ' ~ ' + escapeHtml(e.date_end) : '') : (e.date ? '· ' + escapeHtml(e.date) : '')}
          ${e.location ? '· 📍' + escapeHtml(e.location) : ''}
        </div>
      </div>
      <button onclick="removeEventFromList(${i})"
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
    c.beat, c.products, c.tags||'']);
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
  ['ev','sector','sys'].forEach(t => {
    const btn  = document.getElementById('arch-tab-'+t);
    const pane = document.getElementById('arch-pane-'+t);
    if(btn)  btn.classList.toggle('on', t===tab);
    if(pane) pane.style.display = t===tab ? 'block' : 'none';
  });
  const sysnav = document.getElementById('sbp-arch-sysnav');
  if(sysnav) sysnav.style.display = tab==='sys' ? 'block' : 'none';
  if(tab==='ev')     { renderEvMgr(); }
  if(tab==='sector') { renderSectorList(); renderPartTypeList(); renderTagList(); }
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
