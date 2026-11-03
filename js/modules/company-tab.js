/* ══════════════════════════════════════════════════════════════
   company-tab.js — 기업DB(co) 탭
   (원본 contact_crm.html 3176~4610행대 COMPANY DB 섹션에서 정리)

   담당 범위
   - buildCoDB / buildCoCAT / renderCoList — api.js의 loadFromSheets(hooks)가
     데이터 로드 후 호출하는 훅 (필수 export)
   - findSimilarCompanyPairs / mergeCompanies — 유사 기업명 탐지 + 병합
     (핵심 로직 변경 없음 — 원본 3321~3413행 그대로 이동)
   - renderCoDashboard / renderCoDetail — 기업DB 화면 렌더
   - editCoSector/editCoNotes/editCoWebsite/editCoCountry/editCoAbbr/editCoSource
     — 원본은 각각 화면 중앙 모달을 띄워 별도 저장 버튼으로 저장하는 방식이었음.
     이번 재구축(Twenty CRM Record Table 벤치마킹)에서 "클릭한 자리에서 바로
     입력창으로 바뀌는" 인라인 편집 방식으로 개선함. 저장 로직(upsertCompanyRow가
     GS_URL로 POST하는 방식)은 원본 그대로 유지 — 바뀐 건 편집 UI 상호작용뿐.

   ⚠ 원본에는 "mergeCoInto"라는 이름의 함수가 없음(grep 결과 없음) — 실제 이름은
   "mergeCompanies"였음. 핵심 로직 불변 원칙에 따라 원본 이름을 그대로 쓰고,
   혹시 다른 모듈/문서가 "mergeCoInto"란 이름을 기대할 경우를 대비해 별칭도
   함께 export/window 등록함.

   ⚠ parseSectors/joinSectors/mainSectors/CATEGORY_CODES는 원본에서 설정(arch)
   탭 코드(6278~6305행대)에 섞여 있었지만, buildCoDB/saveCoSector/
   assignCategoryCode 등 기업DB 핵심 로직이 바로 이 함수들에 의존한다.
   settings-tab.js가 아직 만들어지지 않아 이 시점에는 로컬로 정의해 두었고,
   나중에 settings-tab.js(섹터트리)를 만들 때 여기 정의를 재사용/통합해야 함.
═══════════════════════════════════════════════════════════════ */

import {
  currentUser,
  CO_DB,
  contacts,
  participations,
  EVENT_LIST,
  PART_TYPES,
  COMPANY_SECTORS,
  DOMAINS,
  selCo,
  coTab,
  coCatF,
  coCodeF,
  coDomainF,
  coCountryF,
  setSelCo,
  setCoTab,
  setCoCatF,
  setCoCodeF,
  setCoDomainF,
  setCoCountryF,
  evColor,
  evShort,
  ORGS,
  API_BASE_URL,
  getOrgById,
  findOrgByName,
  orgName,
  ORG_KINDS,
  EXHIBITORS,
  exhibitorsForEvent,
  ROUND_MEMBERS,
  CONTACT_ATTEMPTS,
} from '../state.js';
import { RP, avB, avF } from '../constants.js';
import { escapeHtml, escAttr, levenshteinDist, phoneMatch, parseSectorScope, sectorKey, countryName, isMobile, td, leftPill, safeUrl, parseLinks, slugifySectorName } from '../utils.js';
import { postToSheet, batchCreateExhibitors, upsertSectorRow, saveExhibitor, aiCompanyPairs, aiOrgQueryPlan, aiOrgPdfSummary,
  saveRoundMember, deleteRoundMembers, saveAttempt } from '../api.js';
import { parseSectors, joinSectors, mainSectors, sectorNamesInDomain, domainName, domainOfSector, findSectorByName, UNASSIGNED_DOMAIN } from '../domain/sectors.js';
/* 화면 상태는 ../features/companies/co-ui.js의 coUi 한곳에 둔다 — 이 탭의 구획을 다른 파일로 떼어도 같은 값을 보게 */
import { coUi } from '../features/companies/co-ui.js';
/* 마스터DB는 window로 다시 그린다 — 기업 탭과 마스터DB 탭이 서로의 화면 파일을 끌어오지 않게 */
export const renderMDB = () => window.renderMDB?.();
export const buildMDBEvList = () => window.buildMDBEvList?.();
import { trackAction, changed, removed as removedMeta } from '../core/audit-log.js';
import { EXH_ROLES, reloadExhibitors } from '../features/exhibition/exh-calc.js';
import { billedAmount, paidAmount, currencyOf, exhibitorTradeFor, fmtMoney } from '../features/exhibition/exh-calc.js';

/* ══════════════════════════════════════════
   섹터 관련 로컬 헬퍼 (원본 6278~6305행대, 설정 탭과 공유하던 것)
   settings-tab.js가 만들어져서 parseSectors/joinSectors/mainSectors는
   그쪽에서 import — CATEGORY_CODES는 섹터 트리와 무관한 기업DB 전용
   분류 코드라 settings-tab.js에는 없으므로 그대로 로컬 유지.
══════════════════════════════════════════ */
export const CATEGORY_CODES = [
  {code:'ASS',  label:'학회 / 협회'},
  {code:'GOV',  label:'정부 / 공공기관'},
  {code:'UNI',  label:'대학 / 연구소'},
  {code:'HOS',  label:'병원 / 의료기관'},
  {code:'BIO',  label:'Biotech'},
  {code:'GBIO', label:'글로벌 제약사'},
  {code:'AI',   label:'Artificial Intelligence'},
  {code:'MICE', label:'MICE / Event'},
  {code:'VC',   label:'Venture Capital'},
  {code:'GEN',  label:'General / Others'},
];

/* ══════════════════════════════════════════
   국내 / 해외 분류 — 기업의 "국가"(수동 입력) 필드를 우선, 없으면 "본사"
   (업로드 데이터에서 자동 추출된 연락처 국가)로 대체해 판단한다.
   countryName()으로 표기를 통일한 뒤 "대한민국"인지만 확인 — 값이 아예
   없는 기업은 'unknown'(미확인)으로 분류한다. */
function companyCountryGroup(c){
  const raw = c.country || c.hq || '';
  if(!raw) return 'unknown';
  return countryName(raw) === '대한민국' ? 'domestic' : 'overseas';
}

/* ══════════════════════════════════════════
   buildCoDB — contacts + participations → CO_DB 빌드 (원본 3185~3318행)
   CO_DB 구조:
   { key, nameKo, nameEn, abbr, sector, hq,
     branches, mainBranch,
     events:[{name,year,date,loc,color,roles,people,note}],
     contacts:[{name,title,cats,events}] }
   ※ participations 항목은 api.js의 normalizeParticipationRow()가 이미
     { contactId, eventId, role, ... } 형태로 정규화해 두었으므로
     여기서는 p.cid/p.ev 대신 p.contactId/p.eventId를 사용한다.
══════════════════════════════════════════ */
/* 5개 함수를 ../domain/org-names.js로 옮겼다 — 이 파일에서도 쓰고, 옛 경로로 가져가는 곳도 있어 다시 내보낸다 */
import { stripLegalForm, normalizeCompanyKey, coSortName, orgKindOf, abbrOf } from '../domain/org-names.js';
export { stripLegalForm, normalizeCompanyKey, coSortName, orgKindOf, abbrOf } from '../domain/org-names.js';

/* 2개 함수를 ../domain/co-db.js로 옮겼다 — 이 파일에서도 쓰고, 옛 경로로 가져가는 곳도 있어 다시 내보낸다 */
import { buildCoDB, onCoDbBuilt } from '../domain/co-db.js';
export { buildCoDB, onCoDbBuilt } from '../domain/co-db.js';
onCoDbBuilt(() => {
  sortCoDb();
  try {
    const dashEl = document.getElementById('co-dash');
    if(dashEl && dashEl.style.display !== 'none' && !selCo) renderCoDashboard();
  } catch(e){}
});

/* ── 이름 순 정렬 ──
   기본은 '기업명 순'이다 — 국문이 있으면 국문, 없으면 영문으로 줄 세운다.
   국문·영문 명부를 따로 만들어야 할 때가 있어(도록 색인, 해외 발송 명단)
   한쪽만으로 세우는 기준도 둔다. 그쪽 이름이 없는 회사는 뒤로 모은다 —
   빈 이름이 맨 앞에 몰리면 목록이 비어 보인다. */
export const CO_SORTS = [
  ['name', '기업명 순'],
  ['ko',   '국문명 순'],
  ['en',   '영문명 순'],
];

export function setCoSort(v){
  coUi.coSort = v;
  sortCoDb();
  renderCoList();
}

export function sortCoDb(){
  const pick = (c) => coUi.coSort === 'ko' ? (c.nameKo || '')
    : coUi.coSort === 'en' ? (c.nameEn || '')
    : (c.nameKo || c.nameEn || '');
  CO_DB.sort((a, b) => {
    const x = coSortName(pick(a)), y = coSortName(pick(b));
    if(!x !== !y) return x ? -1 : 1;      // 그 이름이 없는 회사는 뒤로
    return x.localeCompare(y, 'ko');
  });
}

/* 저장 시각은 ISO 원문으로 들어온다 — 사람이 읽는 자리엔 날짜만 보여준다 */
export const shortDate = (v) => String(v || '').slice(0, 10);


/* «비슷한 기업 찾기와 기업 병합»은 ../features/companies/merge.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */

/* ══════════════════════════════════════════
   buildCoCAT / setCoCat — 좌측 섹터 필터 (원본 3415~3463행)
══════════════════════════════════════════ */
// 섹터 필터 버튼 하나 (기업DB 검색 사이드바) — 행사별 그룹핑에서 공통으로 사용
function coCatButton(name, cnt, indent, title, arrowHtml){
  const label = parseSectorScope(name).plainName;
  return `<button class="nr${coCats().includes(name)?' on':''}" onclick="setCoCat('${escAttr(name)}') " style="${indent||''}"${title?` title="${title}"`:` title="드래그한 기업을 여기로 놓으면 이 섹터로 이동해요"`}
      ondragover="event.preventDefault();this.classList.add('co-drop-target')"
      ondragleave="this.classList.remove('co-drop-target')"
      ondrop="this.classList.remove('co-drop-target');onCoDropToSector(event,'${escAttr(name)}')">
      ${arrowHtml||''}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;flex-shrink:0"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      ${escapeHtml(label)}<span class="nbg">${cnt}</span>
    </button>`;
}

/* 메인 섹터 + 그 서브섹터들에 하나라도 태그된 고유 기업 수(중복 제거).
   사이드바 메인 행, 전체 대시보드 카드 헤더 등에서 공통으로 쓴다 — 기준이
   다르면 같은 "Pharma"인데 화면마다 다른 숫자(예: 405 vs 480)가 보이게 된다. */
function uniqueCompanyCountFor(main, subs){
  const nameKeys = new Set([sectorKey(main.name), ...subs.map(s => sectorKey(s.name))]);
  const keys = new Set();
  CO_DB.forEach(c => {
    const secs = c.sectors && c.sectors.length ? c.sectors : [c.sector||'미분류'];
    if(secs.some(s => nameKeys.has(sectorKey(s)))) keys.add(c.key);
  });
  return keys.size;
}

/* 펼쳐진 분야 아코디언 상태 (화면 전용 — 저장하지 않음) */
const _expandedDomains = new Set();

/* 기업DB 사이드바 트리에서 접힌 메인 섹터 id 집합 (화면 전용 — 저장 안 함).
   서브섹터가 있는 메인 섹터 버튼 왼쪽 화살표로 접었다 펼쳤다 할 수 있다. */
const _collapsedCoMains = new Set();
export function toggleCoMainCollapse(id){
  if(_collapsedCoMains.has(id)) _collapsedCoMains.delete(id);
  else _collapsedCoMains.add(id);
  buildCoCAT();
}

/* 어떤 분야에도 속하지 않은 섹터명 집합 (미분류): 등록 섹터 중 미배정 + 미등록 값 */
function unassignedSectorNames(sectorCounts){
  const assigned = new Set();
  DOMAINS.forEach(d => sectorNamesInDomain(d.id).forEach(n => assigned.add(n)));
  return Object.keys(sectorCounts).filter(name => !assigned.has(sectorKey(name)));
}

export function buildCoCAT(){
  const el = document.getElementById('co-catf');
  if(!el) return;

  // 복수 섹터 집계
  const sectorCounts = {};
  CO_DB.forEach(c => {
    (c.sectors && c.sectors.length ? c.sectors : [c.sector||'미분류'])
      .forEach(s => { sectorCounts[s] = (sectorCounts[s]||0) + 1; });
  });

  const html = [`<button class="nr${!coCats().length && !coDomainF?' on':''}" onclick="setCoCat(null)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><circle cx="12" cy="12" r="10"/></svg>
      전체<span class="nbg">${CO_DB.length}</span>
    </button>`];

  // 분야 하나의 기업 수 — 하위 전 섹터에 해당하는 기업 key의 Set 크기 (중복 이중 카운트 방지)
  const domainCompanyCount = names => {
    const keys = new Set();
    CO_DB.forEach(c => {
      const secs = c.sectors && c.sectors.length ? c.sectors : [c.sector||'미분류'];
      if(secs.some(s => names.has(sectorKey(s)))) keys.add(c.key);
    });
    return keys.size;
  };

  // 분야 안의 섹터 버튼들 — 기존 방식(공통 + 행사별 그룹, 서브 들여쓰기) 유지하되
  // 그 분야 이름 집합(names)에 속한 섹터만 나열. 서브섹터가 있는 메인 섹터는
  // 왼쪽 화살표로 접었다 펼쳤다 할 수 있고, 접으면 그 서브섹터 버튼들은 숨겨진다.
  //
  // ⚠ 메인 섹터 자신의 이름으로 직접 태그된 기업이 0개여도(기업들이 전부
  // 서브섹터 이름으로만 태그된 경우), 카운트>0인 서브가 하나라도 있으면 그
  // 부모 메인은 여전히 노출해야 한다 — 예전에는 메인/서브를 이름 매칭 배열
  // 하나로 같이 필터링해서, 메인 자신의 카운트가 0이면 메인 행 자체가 통째로
  // 빠지고 서브들만 부모 없이 낱개로 나열되는 버그가 있었다. 메인→그 서브들
  // 순서로 명시적으로 묶어서 렌더링해 이 문제를 없앤다.
  const sectorButtonsIn = names => {
    const rows = [];
    const groupOrder = ['', ...EVENT_LIST.map(e => e.short)];
    groupOrder.forEach(short => {
      const inScope = s => {
        if(!names.has(sectorKey(s.name))) return false;
        const sc = parseSectorScope(s.name);
        return (sc.eventShort||'') === short;
      };
      const mainsHere = COMPANY_SECTORS.filter(s => !s.parent && inScope(s));
      const subsByParent = {};
      COMPANY_SECTORS.forEach(s => {
        if(s.parent && inScope(s)){
          if(!subsByParent[s.parent]) subsByParent[s.parent] = [];
          subsByParent[s.parent].push(s);
        }
      });
      /* 기업이 없는 섹터도 보인다 — 설정에서 막 만든 섹터는 0개사인데, 숨기면
         기업을 끌어다 놓을 자리가 없어 영영 0개사로 남는다 */
      const visibleMains = mainsHere;
      if(!visibleMains.length) return;
      if(short) rows.push(`<div style="font-size:10px;font-weight:700;color:var(--i4);text-transform:uppercase;letter-spacing:.04em;margin:6px 0 2px 14px">${escapeHtml(short)}</div>`);
      visibleMains.forEach(m => {
        const subs = subsByParent[m.id] || [];
        const hasSubs = subs.length > 0;
        const collapsed = _collapsedCoMains.has(m.id);
        const arrow = hasSubs
          ? `<span onclick="event.stopPropagation();toggleCoMainCollapse('${escAttr(m.id)}')" style="width:22px;height:22px;margin:-4px 0;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px;color:var(--i4);border-radius:4px" onmouseover="this.style.background='rgba(0,0,0,.08)'" onmouseout="this.style.background='none'" title="서브섹터 접기/펼치기">${collapsed?'▸':'▾'}</span>`
          : `<span style="width:22px;flex-shrink:0"></span>`;
        // 메인 행의 숫자는 "메인 자신에게 직접 태그된 기업"만이 아니라, 그
        // 서브섹터들까지 합친 고유 기업 수여야 한다 — 전체 대시보드 카드의
        // 헤더(예: "Pharma 480")와 같은 기준이어야 사이드바 숫자만 따로 낮게
        // (예: 405) 보이는 혼란이 없다.
        const mainCount = hasSubs ? uniqueCompanyCountFor(m, subs) : (sectorCounts[m.name]||0);
        rows.push(coCatButton(m.name, mainCount, 'padding-left:18px', null, arrow));
        if(hasSubs && !collapsed){
          subs.forEach(s => rows.push(coCatButton(s.name, sectorCounts[s.name]||0, 'padding-left:30px;font-size:11px')));
        }
      });
    });
    return rows;
  };

  // 분야 아코디언 행: 이름 클릭 = 분야 전체 필터, ▸ 클릭 = 펼치기/접기
  const domainRow = (id, label, count, expanded) => `
    <div class="nr${coDomainF===id?' on':''}" style="display:flex;align-items:center;gap:4px;cursor:pointer">
      <span onclick="event.stopPropagation();toggleCoDomain('${escAttr(id)}')"
        style="width:16px;text-align:center;flex-shrink:0;font-size:10px;color:var(--i4)" title="펼치기/접기">${expanded?'▾':'▸'}</span>
      <span onclick="setCoDomain('${escAttr(id)}')" style="flex:1;display:flex;align-items:center;gap:6px;font-weight:700" title="이 분야 전체 기업으로 필터링">
        🗂 ${escapeHtml(label)}<span class="nbg">${count}</span>
      </span>
    </div>`;

  DOMAINS.forEach(d => {
    const names = sectorNamesInDomain(d.id);
    const count = domainCompanyCount(names);
    if(!count && !_expandedDomains.has(d.id)) {
      // 기업이 없는 빈 분야도 접힌 상태로 표시 (배정 안내용)
      html.push(domainRow(d.id, d.name, 0, false));
      return;
    }
    const expanded = _expandedDomains.has(d.id);
    html.push(domainRow(d.id, d.name, count, expanded));
    if(expanded) html.push(...sectorButtonsIn(names));
  });

  // 미분류: 미배정 섹터 + 미등록 값
  const unassigned = unassignedSectorNames(sectorCounts);
  if(unassigned.length){
    const names = new Set(unassigned.map(sectorKey));
    const expanded = _expandedDomains.has(UNASSIGNED_DOMAIN);
    html.push(domainRow(UNASSIGNED_DOMAIN, '미분류', domainCompanyCount(names), expanded));
    if(expanded){
      // 등록 섹터는 그룹 규칙대로, 미등록 값은 그 뒤에
      html.push(...sectorButtonsIn(names));
      const registered = new Set(COMPANY_SECTORS.map(s => s.name));
      unassigned.filter(n => !registered.has(n)).forEach(name =>
        html.push(coCatButton(name, sectorCounts[name], 'padding-left:18px', '미등록 섹터')));
    }
  }

  el.innerHTML = html.join('');
  buildCoCodeF();
  buildCoCountryF();
}

/* 왼쪽에서 섹터·분야·국가를 누르는 것은 «이 묶음을 다시 훑어보겠다»는 뜻이다.
   그런데 기업 하나를 열어 둔 채로 누르면 본문이 그 기업 상세에 그대로 머물러,
   왼쪽 숫자만 바뀌고 화면은 꼼짝 않는 것처럼 보였다 — 열어 둔 기업을 접고
   고른 묶음의 첫 화면으로 돌아간다. */
function showCoFilteredList(){
  setSelCo(null);
  const cdtEl  = document.getElementById('cdt');     if(cdtEl)  cdtEl.style.display  = 'none';
  const dashEl = document.getElementById('co-dash'); if(dashEl) dashEl.style.display = 'block';
  renderCoDashboard();
}

/* 고른 섹터 이름들 — 비어 있으면 섹터로는 거르지 않는다 */
export function coCats(){ return Array.isArray(coCatF) ? coCatF : []; }

function coRefresh(){ buildCoCAT(); renderCoList(); showCoFilteredList(); }

/* 왼쪽 트리에서 섹터 하나를 누른 것 — 그 섹터만 남긴다. 분야는 지우지 않고,
   지금 분야 밖의 섹터면 그 섹터의 분야로 옮겨 가서 위 섹터 칩 줄이 같이 보이게 한다. */
export function setCoCat(s){
  if(s == null){ setCoCatF(null); setCoDomainF(null); return coRefresh(); }
  const cur = coCats();
  if(cur.length === 1 && cur[0] === s){ setCoCatF(null); return coRefresh(); }
  setCoCatF([s]);
  if(!coDomainF || !coDomainNameSet().has(sectorKey(s))){
    const d = domainOfSector(findSectorByName(s))[0];
    setCoDomainF(d || UNASSIGNED_DOMAIN);
  }
  coRefresh();
}

/* 본문 섹터 칩 — 켜고 끄기만 한다. 분야는 그대로 */
export function toggleCoSecChip(s){
  const cur = coCats();
  setCoCatF(cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]);
  coRefresh();
}
export function clearCoSecChips(){ setCoCatF(null); coRefresh(); }

/* 분야 필터 — 왼쪽 트리에서는 다시 누르면 풀린다 */
export function setCoDomain(id){
  setCoDomainOnly(coDomainF === id ? null : id);
}
/* 본문 분야 칩 — 고른 것으로 바꾸고, 다른 분야의 섹터 선택은 비운다 */
export function setCoDomainOnly(id){
  if(id !== coDomainF) setCoCatF(null);
  setCoDomainF(id);
  if(id) _expandedDomains.add(id); // 필터 걸면 자동 펼침
  coRefresh();
}

export function toggleCoDomain(id){
  if(_expandedDomains.has(id)) _expandedDomains.delete(id);
  else _expandedDomains.add(id);
  buildCoCAT();
}

/* 현재 분야 필터에 해당하는 섹터명 집합 (renderCoList/대시보드 공용) */
export function coDomainNameSet(){
  if(!coDomainF) return null;
  if(coDomainF === UNASSIGNED_DOMAIN){
    const sectorCounts = {};
    CO_DB.forEach(c => {
      (c.sectors && c.sectors.length ? c.sectors : [c.sector||'미분류'])
        .forEach(s => { sectorCounts[s] = 1; });
    });
    return new Set(unassignedSectorNames(sectorCounts).map(sectorKey));
  }
  return sectorNamesInDomain(coDomainF);
}
export function buildCoCodeF(){
  const el = document.getElementById('co-codef');
  if(!el) return;
  const codeCounts = {};
  CO_DB.forEach(c => { if(c.catCode){ const prefix = c.catCode.split('-')[0]; codeCounts[prefix] = (codeCounts[prefix]||0)+1; } });
  // 코드가 붙은 기업이 하나도 없으면 「전체」 하나만 남는 칸이라 접는다
  const sec = el.closest('.sbs');
  if(sec) sec.style.display = (Object.keys(codeCounts).length || coCodeF) ? '' : 'none';
  const html = [`<button class="nr${!coCodeF?' on':''}" onclick="setCoCode(null)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><circle cx="12" cy="12" r="10"/></svg>
      전체<span class="nbg">${CO_DB.length}</span>
    </button>`];
  CATEGORY_CODES.forEach(cc => {
    const cnt = codeCounts[cc.code] || 0;
    if(!cnt) return;
    html.push(`<button class="nr${coCodeF===cc.code?' on':''}" onclick="setCoCode('${cc.code}')">
      ${cc.code}<span class="nbg">${cnt}</span>
    </button>`);
  });
  el.innerHTML = html.join('');
}
export function setCoCode(s){
  setCoCodeF((coCodeF===s)?null:s);
  buildCoCodeF(); renderCoList();
}

export function buildCoCountryF(){
  const el = document.getElementById('co-countryf');
  if(!el) return;
  let domestic=0, overseas=0, unknown=0;
  CO_DB.forEach(c => {
    const g = companyCountryGroup(c);
    if(g==='domestic') domestic++; else if(g==='overseas') overseas++; else unknown++;
  });
  const btn = (val, label, cnt) => `<button class="nr${coCountryF===val?' on':''}" onclick="setCoCountry(${val?`'${val}'`:'null'})">
      ${label}<span class="nbg">${cnt}</span>
    </button>`;
  const html = [btn(null, '전체', CO_DB.length)];
  if(domestic) html.push(btn('domestic', '국내', domestic));
  if(overseas) html.push(btn('overseas', '해외', overseas));
  if(unknown) html.push(btn('unknown', '미확인', unknown));
  el.innerHTML = html.join('');
}
export function setCoCountry(v){
  setCoCountryF((coCountryF===v)?null:v);
  buildCoCountryF(); renderCoList();
  showCoFilteredList();
}

/* ══════════════════════════════════════════
   renderCoList — 기업 리스트 (원본 3486~3512행)
   Twenty Record Table 벤치마킹: 컬럼(국가/웹사이트/메모) 표시/숨김 토글 추가
══════════════════════════════════════════ */
/* ══════════════════════════════════════════
   질문으로 찾기 — «2026 KIC 참가사 중 미납 있는 곳»
   질문을 서버(routes/ai.js /org-query-plan)가 Claude에게 보내 «조건표»로 받아 온다.
   기업명·금액은 보내지 않는다 — 행사·역할·종류·업종·국가 이름과 질문만 간다.
   거르기는 여기서 제 데이터로 한다. 사이드바 거르개·검색어와 «그리고»로 겹친다.
══════════════════════════════════════════ */
function coAiMatches(c, plan){
  const evs = c.events || [];
  const has = (k) => evs.some(e => e.key === k);
  const anyEv = plan.events_any || [], allEv = plan.events_all || [], noEv = plan.events_none || [], roles = plan.roles || [];
  if(allEv.length && !allEv.every(has)) return false;
  const scope = [...anyEv, ...allEv];
  if(scope.length){
    const hit = evs.filter(e => scope.includes(e.key));
    if(!hit.length) return false;
    if(roles.length && !hit.some(e => (e.roles || []).some(r => roles.includes(r)))) return false;
  } else if(roles.length && !evs.some(e => (e.roles || []).some(r => roles.includes(r)))) return false;
  if(noEv.length && noEv.some(has)) return false;
  if((plan.kinds || []).length && !plan.kinds.includes(c.kind)) return false;
  if((plan.sectors || []).length){
    const want = new Set(plan.sectors.map(sectorKey));
    if(!(c.sectors && c.sectors.length ? c.sectors : [c.sector]).some(s => s && want.has(sectorKey(s)))) return false;
  }
  if((plan.countries || []).length && !plan.countries.includes(c.country || c.hq || '')) return false;
  const hay = (vals) => vals.filter(Boolean).join(' ').toLowerCase();
  const hit = (vals, words) => { const h = hay(vals); return words.some(w => h.includes(String(w).toLowerCase())); };
  if((plan.name_keywords || []).length && !hit([c.nameKo, c.nameEn, ...(c.aliases || [])], plan.name_keywords)) return false;
  if((plan.product_keywords || []).length && !hit([c.products, c.intro, c.notes], plan.product_keywords)) return false;
  if(plan.unpaid || plan.overdue){
    // 행사 조건이 있으면 그 행사의 청구만 본다 — «2026 KIC 미납»에 작년 잔금이 섞이면 안 된다
    const trades = (c.trade || []).filter(t => !t.cancelled && (!scope.length || scope.includes(t.eventId)));
    if(plan.unpaid && !trades.some(t => t.balance > 0)) return false;
    if(plan.overdue && !trades.some(t => t.balance > 0 && t.overdue)) return false;
  }
  return true;
}
export async function askCoAi(){
  const q = String(document.getElementById('co-ai-q')?.value || '').trim();
  if(!q) return;
  coUi.coAiMsg = '✨ 질문을 조건으로 바꾸는 중…';
  renderCoList();
  const roles = new Set(['전시참가기업', '시공사', ...PART_TYPES.map(t => t.key)]);
  CO_DB.forEach(c => (c.events || []).forEach(e => (e.roles || []).forEach(r => roles.add(r))));
  const sectors = new Set(), countries = new Set();
  CO_DB.forEach(c => { (c.sectors || []).forEach(s => s && sectors.add(s)); const k = c.country || c.hq; if(k) countries.add(k); });
  const r = await aiOrgQueryPlan({
    question: q,
    today: new Date().toISOString().slice(0, 10),
    events: EVENT_LIST.map(e => ({ key: e.key, short: e.short || '', date: e.date || '' })),
    roles: [...roles],
    kinds: ORG_KINDS.map(k => ({ key: k.key, label: k.label })),
    sectors: [...sectors],
    countries: [...countries],
  });
  if(!r.ok){ coUi.coAiMsg = '<span style="color:var(--re)">찾지 못했어요: ' + escapeHtml(r.error || '') + '</span>'; renderCoList(); return; }
  coUi.coAiMsg = '';
  coUi.coAi = { q, plan: r.plan };
  // 기업을 열어 둔 채 물었으면 목록으로 돌아가 결과를 보여 준다
  if(document.getElementById('cdt')?.style.display !== 'none') showCoFilteredList();
  renderCoList();
}
export function clearCoAi(){
  coUi.coAi = null; coUi.coAiMsg = '';
  const inp = document.getElementById('co-ai-q');
  if(inp) inp.value = '';
  renderCoList();
}
/* 질문 결과는 위쪽 «질문으로 찾기» 줄(#co-ai-msg)에 한 줄로 — Master DB와 같은 자리 */
function renderCoAiMsg(n){
  const el = document.getElementById('co-ai-msg');
  if(!el) return;
  if(coUi.coAiMsg){ el.innerHTML = `<span style="color:var(--i3)">${coUi.coAiMsg}</span>`; return; }
  if(!coUi.coAi){ el.innerHTML = ''; return; }
  const p = coUi.coAi.plan;
  const evs = (k) => (p[k] || []).map(e => (EVENT_LIST.find(x => x.key === e) || {}).short || e).join(', ');
  const bits = [
    p.events_any?.length ? '참가: ' + evs('events_any') : '',
    p.events_all?.length ? '모두 참가: ' + evs('events_all') : '',
    p.events_none?.length ? '불참: ' + evs('events_none') : '',
    p.roles?.length ? '역할: ' + p.roles.join(', ') : '',
    p.kinds?.length ? '종류: ' + p.kinds.join(', ') : '',
    p.sectors?.length ? '업종: ' + p.sectors.join(', ') : '',
    p.countries?.length ? '국가: ' + p.countries.join(', ') : '',
    p.name_keywords?.length ? '이름: ' + p.name_keywords.join('/') : '',
    p.product_keywords?.length ? '품목: ' + p.product_keywords.join('/') : '',
    p.unpaid ? '미납 있음' : '',
    p.overdue ? '기한 지난 미납' : '',
  ].filter(Boolean);
  el.innerHTML = `<span class="pill p-blue" style="cursor:default" title="${escapeHtml(coUi.coAi.q)}">✨ ${escapeHtml(p.explain || coUi.coAi.q)}</span>
    <b>${n}곳</b>
    <span style="color:var(--i4)">${escapeHtml(bits.join(' · '))}</span>
    ${p.unsupported ? `<span style="color:var(--am)">⚠️ 반영 못 한 조건: ${escapeHtml(p.unsupported)}</span>` : ''}
    <button class="btn bs" style="font-size:10px" onclick="clearCoAi()">✕ 질문 지우기</button>`;
}

/* 기업 DB의 거르기는 여기 한 곳 — 본문 표와 사이드바 목록이 같은 목록을 보여야 한다.
   전에는 둘이 따로 걸러서, 카테고리 코드·종류·질문으로 찾기를 눌러도 본문 표는
   그대로였고 검색 규칙(법인격·기호 무시)도 사이드바에만 있었다.
   검색 → 분야 → 섹터 → 코드 → 국내/해외 → 종류 → 질문 순 */
function coSearchHit(c, q){
  const lq = q.trim().toLowerCase();
  if(!lq) return true;
  /* 옛 이름으로도 찾을 수 있어야 한다 — 사명이 바뀐 회사를 옛 이름으로 기억하는
     사람이 있다. 국문·영문 어느 쪽으로 쳐도 같은 기업이 나와야 하고(한쪽만 있는
     기업도 있다), 연락처에 적힌 표기(branches)로도 찾혀야 한다.

     견줄 때는 양쪽을 같은 모양으로 눌러서 본다. 앞뒤 공백만 들어가도 못 찾거나
     '(주)메디라마'를 '주메디라마'로 쳐서 못 찾는 일이 실제로 있었다.
     법인격을 떼는 규칙은 한 곳(stripLegalForm)만 둔다 — 검색과 식별이
     서로 다른 규칙을 쓰면 "목록엔 있는데 검색은 안 되는" 회사가 생긴다 */
  const squash = (v) => stripLegalForm(v).toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const sq = squash(lq);
  // 대표번호나 소속 연락처 번호로 쳐도 그 기업이 나온다
  if(phoneMatch(lq, c.phone, (c.contacts || []).map(k => k.phone))) return true;
  const fields = [c.nameKo, c.nameEn, c.sector, c.abbr, c.mainBranch,
    ...(c.aliases || []), ...(c.branches || [])];
  // 기호만 눌러 없앤 모양도 본다 — 법인격을 떼면 '(주)메디라마'가 '메디라마'가
  // 되어 '주메디라마'로 친 것과는 안 맞았다
  const bare = (v) => String(v).toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const bq = bare(lq);
  return fields.some(v => v && String(v).toLowerCase().includes(lq))
    || (sq && fields.some(v => v && squash(v).includes(sq)))
    || (bq && fields.some(v => v && bare(v).includes(bq)));
}
function coFilteredList({ skipCats = false, skipKind = false } = {}){
  let list = CO_DB.filter(c => coSearchHit(c, coUi.coDashQ));
  if(coDomainF){
    const names = coDomainNameSet();
    if(names) list = list.filter(c => coSecsOf(c).some(s => names.has(sectorKey(s))));
  }
  if(!skipCats && coCats().length){
    const want = new Set(coCats().map(sectorKey));
    list = list.filter(c => coSecsOf(c).some(s => s && want.has(sectorKey(s))));
  }
  if(coCodeF) list = list.filter(c => c.catCode && c.catCode.startsWith(coCodeF + '-'));
  if(coCountryF) list = list.filter(c => companyCountryGroup(c) === coCountryF);
  if(!skipKind && coUi.coKindF) list = list.filter(c => c.kind === coUi.coKindF);
  if(coUi.coAi) list = list.filter(c => coAiMatches(c, coUi.coAi.plan));
  return list;
}

/* 기업 DB 화면을 다시 그린다 — 거르기가 바뀌면 다 이리로 온다.
   Master DB처럼 «종류·정렬·숫자» 줄 → «질문으로 찾기» 줄 → 섹터 칩 → 표 순서.
   전에는 사이드바 아래에 본문 표와 같은 기업 목록이 한 벌 더 있었고, 종류
   필터·정렬·칼럼 켜기가 그 목록 안에 숨어 있었다. 목록은 본문 표 하나만 둔다
   (줄을 끌어 왼쪽 섹터에 놓는 것도 표에서 된다). */
export function renderCoList(){
  const list = coFilteredList();
  renderCoKindBar(list.length);
  renderCoAiMsg(list.length);
  // 기업을 열어 둔 동안은 표를 그리지 않는다 — 돌아올 때 showCoFilteredList가 그린다
  if(document.getElementById('co-dash')?.style.display !== 'none') renderCoDashboard(list);
}

/* 종류 필터 — 전시 참가기업만 볼지, 아직 영업 중인 잠재 고객사만 볼지 고른다.
   Master DB의 「전체·연사·스폰서…」 줄과 같은 자리·같은 모양이다 */
export function setCoKind(k){
  coUi.coKindF = (coUi.coKindF === k) ? '' : k;
  if(document.getElementById('cdt')?.style.display !== 'none') showCoFilteredList();
  renderCoList();
}

function renderCoKindBar(n){
  const el = document.getElementById('co-kind-bar');
  if(!el) return;
  // 숫자는 종류만 빼고 나머지 거르기를 다 거친 것 — 누르면 그만큼 나온다
  const cnt = {};
  const rest = coFilteredList({ skipKind: true });
  rest.forEach(c => { if(c.kind) cnt[c.kind] = (cnt[c.kind] || 0) + 1; });
  const used = ORG_KINDS.filter(k => cnt[k.key] || coUi.coKindF === k.key);
  el.innerHTML = `
    <div class="seg">
      <button class="seg-b${!coUi.coKindF ? ' on' : ''}" onclick="setCoKind('')">전체 ${rest.length}</button>
      ${used.map(k => `<button class="seg-b${coUi.coKindF === k.key ? ' on' : ''}"
        onclick="setCoKind('${escAttr(k.key)}')">${escapeHtml(k.label)} ${cnt[k.key] || 0}</button>`).join('')}
    </div>
    <select class="fi" style="font-size:11px;padding:3px 6px;width:auto" onchange="setCoSort(this.value)"
      title="이름 앞뒤의 (주)·주식회사는 빼고 줄 세웁니다">
      ${CO_SORTS.map(([v, l]) => `<option value="${v}"${coUi.coSort === v ? ' selected' : ''}>${l}</option>`).join('')}
    </select>
    ${coCountryF ? `<span class="pill p-gray" style="font-size:10px">${{domestic:'국내',overseas:'해외',unknown:'미확인'}[coCountryF]}</span>` : ''}
    <span class="db-ct">${n}개 기업</span>
    ${n ? `<button class="btn bs" style="font-size:11px;padding:3px 8px" onclick="coSendToRound()"
      title="지금 걸러 본 기업들을 컨택 차수의 명단에 넣습니다">컨택 명단에 넣기</button>` : ''}`;
}
/* 지금 걸러 본 목록을 컨택 명단으로 — 고르는 창은 컨택 탭(contact-tab.js)이 그린다 */
export function coSendToRound(){
  window.openSendToRound?.(coFilteredList().map(c => c.key), coListLabel() === '전체' ? '기업DB' : coListLabel());
}
window.coSendToRound = coSendToRound;

/* ── 분야·섹터 고르기 (기업 추가 모달) ──
   기업을 넣을 때 섹터를 고를 자리가 없어서, 새로 넣은 회사는 전부 미분류로
   떨어졌다. 나중에 상세를 열어 하나씩 붙여야 했는데 그 일이 밀리면 미분류가
   쌓인다 — 넣는 자리에서 같이 고르게 한다.

   분야를 먼저 고르면 섹터 목록이 그 분야 것만 남는다. 섹터가 예순 개가 넘어
   통째로 펼치면 찾는 데 시간이 걸린다. */
export function coSectorOptionsHtml(domainId, selected){
  const inDomain = (m) => {
    if(!domainId) return true;
    const doms = domainOfSector(m);
    return doms.length ? doms.includes(domainId) : domainId === UNASSIGNED_DOMAIN;
  };
  const opt = (value, label) =>
    `<option value="${escapeHtml(value)}"${sectorKey(value) === sectorKey(selected||'') ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const rows = [];
  mainSectors().filter(inDomain).forEach(m => {
    rows.push(opt(m.name, parseSectorScope(m.name).plainName));
    COMPANY_SECTORS.filter(s => s.parent === m.id)
      .forEach(s => rows.push(opt(s.name, '↳ ' + parseSectorScope(s.name).plainName)));
  });
  return `<option value="">섹터 없음</option>` + rows.join('');
}

export function coDomainOptionsHtml(selected){
  const opt = (v, l) => `<option value="${escapeHtml(v)}"${v === (selected||'') ? ' selected' : ''}>${escapeHtml(l)}</option>`;
  return opt('', '전체 분야') + DOMAINS.map(d => opt(d.id, d.name)).join('') + opt(UNASSIGNED_DOMAIN, '미분류');
}

/* 보고 있던 섹터·분야를 그대로 기본값으로 — 섹터를 열어 둔 채 «기업 추가»를
   눌렀다면 그 섹터에 넣으려는 것이다. 매번 같은 값을 다시 고르게 할 이유가 없다. */
export function currentCoSectorPick(){
  const sector = coCats().length === 1 ? coCats()[0] : '';
  const domain = sector ? (domainOfSector(findSectorByName(sector))[0] || '') : (coDomainF || '');
  return { sector, domain };
}

/* 분야를 바꾸면 섹터 목록을 다시 채운다. 고르고 있던 섹터가 새 분야에도
   있으면 그대로 둔다 — 분야만 좁혔는데 섹터가 풀리면 다시 골라야 한다. */
export function onAddOrgDomainChange(){
  const d = document.getElementById('ao-domain');
  const s = document.getElementById('ao-sector');
  if(!d || !s) return;
  const keep = s.value;
  s.innerHTML = coSectorOptionsHtml(d.value, keep);
  if(sectorKey(s.value || '') !== sectorKey(keep || '')) s.value = '';
}

/* ── 기업 직접 추가 ──
   전에는 연락처를 넣어야만 기업이 생겼다. 담당자를 아직 모르는 회사를 먼저
   적어둘 수 있어야 영업 대상이나 시공 벤더를 관리할 수 있다. */
export function openAddOrgModal(){
  if(document.getElementById('add-org-modal')) return;
  const el = document.createElement('div');
  el.id = 'add-org-modal';
  el.className = 'mw on';
  /* 배경을 눌러 닫되, 누르기 시작한 곳이 패널 안이면 닫지 않는다.
     글자를 드래그로 선택하다 패널 밖에서 손을 떼면 click의 target이 배경이 되는데,
     그것까지 닫아 버리면 복사하려다 입력하던 내용을 통째로 잃는다. */
  const pick = currentCoSectorPick();
  let downOnBg = false;
  el.addEventListener('mousedown', (e) => { downOnBg = (e.target === el); });
  el.addEventListener('click', (e) => { if(e.target === el && downOnBg) closeAddOrgModal(); });
  el.innerHTML = `<div class="modal" style="max-width:420px">
    <div class="mh"><div class="mt2">기업 추가</div><button class="mc" onclick="closeAddOrgModal()">✕</button></div>
    <div class="mb">
      <div style="font-size:11.5px;color:var(--i4);margin-bottom:12px;line-height:1.6">
        담당자를 아직 몰라도 기업을 먼저 등록할 수 있어요. 나중에 연락처를 넣으면 자동으로 이어집니다.</div>
      <div class="fg"><label class="fl">기업명 (국문)</label><input class="fi" id="ao-nameKo" placeholder="예: 스튜디오블룸"></div>
      <div class="fg"><label class="fl">기업명 (영문)</label><input class="fi" id="ao-nameEn" placeholder="예: Studio Bloom"></div>
      <div class="fg"><label class="fl">종류</label>
        <select class="fi" id="ao-kind">${ORG_KINDS.map(k =>
          `<option value="${escapeHtml(k.key)}"${k.key === '잠재고객사' ? ' selected' : ''}>${escapeHtml(k.label)}</option>`).join('')}</select></div>
      <div class="fg"><label class="fl">분야</label>
        <select class="fi" id="ao-domain" onchange="onAddOrgDomainChange()">${coDomainOptionsHtml(pick.domain)}</select></div>
      <div class="fg"><label class="fl">섹터</label>
        <select class="fi" id="ao-sector">${coSectorOptionsHtml(pick.domain, pick.sector)}</select></div>
      <div class="fg"><label class="fl">국가</label><input class="fi" id="ao-country" placeholder="예: 대한민국"></div>
      <div class="fg"><label class="fl">웹사이트</label><input class="fi" id="ao-website" placeholder="https://"></div>
      <div class="fg"><label class="fl">사업자등록번호</label><input class="fi" id="ao-bizNo" placeholder="000-00-00000"></div>
      <div class="fg"><label class="fl">대표 전화</label><input class="fi" id="ao-phone" placeholder="02-000-0000"></div>
      <div class="fg"><label class="fl">대표 메일</label><input class="fi" id="ao-email" placeholder="info@example.com"></div>
      <div class="fg"><label class="fl">취급 품목</label><input class="fi" id="ao-products" placeholder="예: LED, 렌탈,포토"></div>
      <div class="fg"><label class="fl">메모</label><textarea class="fi" id="ao-notes" rows="2"></textarea></div>
      <div id="ao-msg" style="font-size:11.5px;min-height:16px;margin-bottom:8px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn bs" onclick="closeAddOrgModal()">취소</button>
        <button class="btn bp" id="ao-save" onclick="submitAddOrg()">등록</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(el);
  document.getElementById('ao-nameKo')?.focus();
}
export function closeAddOrgModal(){ document.getElementById('add-org-modal')?.remove(); }

export async function submitAddOrg(){
  const v = (id) => (document.getElementById(id) || {}).value?.trim() || '';
  const msg = document.getElementById('ao-msg');
  const btn = document.getElementById('ao-save');
  if(btn){ btn.disabled = true; btn.textContent = '등록 중…'; }

  const sector = v('ao-sector');
  const r = await window.createOrg({
    nameKo: v('ao-nameKo'), nameEn: v('ao-nameEn'), kind: v('ao-kind'),
    sectors: sector ? [sector] : [],
    country: v('ao-country'), website: v('ao-website'), bizNo: v('ao-bizNo'),
    products: v('ao-products'), phone: v('ao-phone'), email: v('ao-email'),
    notes: v('ao-notes'),
  });
  if(!r.ok){
    if(btn){ btn.disabled = false; btn.textContent = '등록'; }
    if(msg){ msg.style.color = 'var(--re)'; msg.textContent = r.error; }
    // 이미 있는 회사면 새로 만드는 대신 그 회사를 열어준다
    if(r.org){ setTimeout(() => { closeAddOrgModal(); selectCo(r.org.id); }, 900); }
    return;
  }
  closeAddOrgModal();
  selectCo(r.id);
}

export function searchCoM(v){ setCoDashQ(v); }

/* 기업 검색칸은 위쪽 바(#co-q)와 모바일 줄(#co-q-m) — 사이드바 검색칸은 없앴다.
   모바일에서는 .tb가 숨으니 모바일 칸에 포커스를 준다. */
export function openCoSearch(){
  const si = document.getElementById(isMobile() ? 'co-q-m' : 'co-q');
  si?.focus(); si?.select();
}

/* 기업을 열었다가 돌아오면 보던 줄에 다시 서 있어야 한다 */

export function selectCo(key){
  const d0 = document.getElementById('co-dash');
  if(d0 && d0.style.display !== 'none') coUi.coDashScroll = d0.scrollTop;
  setSelCo(key); setCoTab(0);
  // 모바일에서는 목록이 서랍 안이라, 고르고 나면 닫아야 상세가 보인다
  if(isMobile()) window.closeSb?.();
  const c=CO_DB.find(x=>x.key===key);if(!c)return;
  const dashEl = document.getElementById('co-dash'); if(dashEl) dashEl.style.display='none';
  const cdtEl  = document.getElementById('cdt');      if(cdtEl)  cdtEl.style.display='flex';
  window.renderCoDetail(c);
}

/* 상세의 뒤로가기 — 필터는 그대로 둔 채 목록으로 */
export function backToCoList(){ showCoFilteredList(); }
export function coListLabel(){
  const parts = [];
  if(coDomainF) parts.push(domainName(coDomainF));
  const cats = coCats().map(n => parseSectorScope(n).plainName);
  if(cats.length) parts.push(cats.length > 2 ? `${cats[0]} 외 ${cats.length - 1}` : cats.join('·'));
  return parts.length ? parts.join(' · ') : '전체';
}

// ── 기업DB 진입 시 기본 화면: 섹터별 대시보드 ──
export function showCoDashboard(){
  setSelCo(null); setCoCatF(null); setCoCodeF(null); setCoDomainF(null); setCoCountryF(null); coUi.coDashQ = '';
  ['co-q','co-q-m'].forEach(id => { const e = document.getElementById(id); if(e) e.value = ''; });
  renderCoList(); buildCoCAT(); buildCoCodeF(); buildCoCountryF();
  const cdtEl = document.getElementById('cdt'); if(cdtEl) cdtEl.style.display='none';
  const dashEl = document.getElementById('co-dash'); if(dashEl) dashEl.style.display='block';
  renderCoDashboard();
}

/* ══════════════════════════════════════════
   renderCoDashboard — 기업 DB 본문 (분야·섹터 칩 + 표)
══════════════════════════════════════════ */
/* 「기업 추가」는 사이드바 검색칸 아래에 있었다. 왼쪽은 무엇을 «고르는» 자리라
   거기 있는 버튼은 필터로 보였고, 정작 기업을 넣으려 할 때는 눈이 본문 위쪽을
   먼저 훑는다 — 전시 탭에서 품목·주문을 더하는 버튼이 그 자리에 있는 것과
   같게, 보고 있는 목록 바로 위에 둔다. 섹터를 열어 둔 채 누르면 그 섹터가
   미리 골라진 채로 창이 열린다. */
const CO_ADD_BTN = `<button class="btn bp bs" style="flex-shrink:0" onclick="openAddOrgModal()">+ 기업 추가</button>`;

/* ── 기업 목록 표 ──
   전에는 한 기업이 한 줄짜리 카드였고 그 안에 이름과 섹터만 있었다. 백예순
   곳을 훑어도 «전화가 있는 곳이 어디인지», «홈페이지를 아직 안 적은 곳이
   어디인지»를 알 수 없었다 — 그건 하나씩 열어봐야 아는 정보였다.

   칸을 나눠 세우면 빈칸이 빈칸으로 보인다. 무엇이 없는지가 한눈에 드러나는
   것이 이 표의 목적이라, 값이 없을 때 줄을 지우지 않고 «—»를 남긴다.
   마스터DB 표와 같은 CSS(thead th / tbody td / .tdco)를 쓴다 — 두 화면이
   다르게 생기면 같은 일을 두 번 익혀야 한다. */
const dash = '<span style="color:var(--i5)">—</span>';

/* 좁은 화면에서는 아홉 칸이 다 들어가지 않는다. 국가·대표메일·홈페이지는
   휴대폰에서 바로 쓸 일이 드문 칸이라 그 셋을 접는다 — 남는 여섯 칸이
   찌그러지지 않고 제 폭을 갖는다. 기업을 열면 전부 보인다. */
const CO_TABLE_COLS = [
  { key: 'name',    label: '기업' },
  { key: 'sector',  label: '섹터' },
  { key: 'kind',    label: '종류' },
  { key: 'country', label: '국가',      mobile: false },
  { key: 'phone',   label: '대표 전화' },
  { key: 'email',   label: '대표 메일', mobile: false },
  { key: 'website', label: '홈페이지',  mobile: false },
  { key: 'people',  label: '담당자',    align: 'right' },
  { key: 'events',  label: '참여',      align: 'right' },
];
const coTableCols = () => CO_TABLE_COLS.filter(c => !(isMobile() && c.mobile === false));

function coKindPill(kind){
  const k = ORG_KINDS.find(x => x.key === kind);
  if(!k) return dash;
  return `<span class="pill ${escAttr(k.cls)}" style="font-size:10px">${escapeHtml(k.label)}</span>`;
}

function coTableCell(key, c, i){
  const num = (n, unit) => n ? n + unit : dash;
  switch(key){
    case 'name': {
      return `<div class="tdco">
        <div class="tdav" style="background:${avB(i)};color:${avF(i)}">${escapeHtml(c.abbr)}</div>
        <div style="min-width:0">
          <div class="tdnm">${escapeHtml(c.nameKo || c.nameEn)}</div>
          ${c.nameKo && c.nameEn ? `<div class="tdsb">${escapeHtml(c.nameEn)}</div>` : ''}
        </div></div>`;
    }
    case 'sector': {
      const secs = (c.sectors && c.sectors.length ? c.sectors : [c.sector]).filter(Boolean);
      return secs.length ? secs.map(s => escapeHtml(parseSectorScope(s).plainName)).join(', ') : dash;
    }
    case 'kind':    return coKindPill(c.kind);
    case 'country': return (c.country || c.hq) ? escapeHtml(countryName(c.country || c.hq)) : dash;
    case 'phone':   return c.phone ? escapeHtml(c.phone) : dash;
    case 'email':   return c.email ? escapeHtml(c.email) : dash;
    case 'website': {
      const site = c.website ? parseLinks(c.website)[0] : null;
      const href = site ? safeUrl(site.url) : '';
      return href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(site.url)}</a>`
        : (c.website ? escapeHtml(c.website) : dash);
    }
    case 'people':  return num((c.contacts || []).filter(p => !p.left_at).length, '명');
    case 'events':  return num(c.events.length, '회');
    default: return dash;
  }
}

function coTableRow(cols, c, i){
  return `<tr onclick="selectCo('${escAttr(c.key)}')"
      draggable="true" ondragstart="onCoDragStart(event,'${escAttr(c.key)}')"
      title="드래그해서 왼쪽 섹터로 옮길 수 있어요">
    ${cols.map(col => `<td style="font-size:11px${col.align === 'right' ? ';text-align:right' : ''}">${coTableCell(col.key, c, i)}</td>`).join('')}
  </tr>`;
}

/* 칸이 화면보다 넓어지면 찌그러뜨리는 대신 옆으로 밀리게 둔다 — 글자가
   겹쳐서 못 읽는 것보다 낫다. */
export function coCompanyTableHtml(list, emptyText){
  if(!list.length) return `<div style="font-size:12px;color:var(--i4);padding:14px 2px">${escapeHtml(emptyText || '해당하는 기업이 없어요')}</div>`;
  const cols = coTableCols();
  return `<div style="overflow-x:auto;border:1px solid var(--i6);border-radius:8px;margin-top:12px;background:var(--W)">
    <table>
      <thead><tr>${cols.map(col =>
        `<th${col.align === 'right' ? ' style="text-align:right"' : ''}>${col.label}</th>`).join('')}</tr></thead>
      <tbody>${list.map((c, i) => coTableRow(cols, c, i)).join('')}</tbody>
    </table></div>`;
}

/* ══════════════════════════════════════════
   기업 DB 본문 — 분야 칩 · 섹터 칩 · 표, 한 화면

   전에는 분야 카드 → 분야 목록 → 섹터 목록으로 화면을 넘겨 다녔고, 섹터를
   고르는 순간 분야가 지워져서 옆 섹터를 보려면 처음으로 돌아가 분야를 다시
   눌러야 했다. 첫 화면의 분야 카드와 섹터 카드도 결국 «몇 개사»만 알려 주고
   목록으로 넘어가는 같은 길이었다.

   이제 숫자는 칩이 들고, 본문은 처음부터 표다. 분야는 하나, 섹터는 그 분야
   안에서 여러 개를 켤 수 있다(OR). 섹터를 바꿔도 분야는 그대로 남는다.
══════════════════════════════════════════ */
const coSecsOf = c => (c.sectors && c.sectors.length ? c.sectors : [c.sector || '미분류']);

/* 분야 하나에 속한 섹터 키 — 미분류 분야는 어느 분야에도 안 걸린 섹터 전부 */
function coDomainKeys(id){
  if(id !== UNASSIGNED_DOMAIN) return sectorNamesInDomain(id);
  const seen = {};
  CO_DB.forEach(c => coSecsOf(c).forEach(s => { seen[s] = 1; }));
  return new Set(unassignedSectorNames(seen).map(sectorKey));
}

/* 칩 순서는 설정의 섹터 순서를 따른다 — 개수순이면 기업 하나 옮길 때마다
   칩 자리가 바뀌어 눈이 매번 다시 찾아야 한다 */
function coSectorOrder(){
  const order = {};
  let i = 0;
  mainSectors().forEach(m => {
    order[sectorKey(m.name)] = i++;
    COMPANY_SECTORS.filter(s => s.parent === m.id).forEach(s => { order[sectorKey(s.name)] = i++; });
  });
  return order;
}

/* 검색칸은 Master DB처럼 위쪽 바 하나 — 기업을 열어 둔 채 치면 목록으로 돌아간다 */
export function setCoDashQ(v){
  coUi.coDashQ = v;
  // 데스크톱·모바일 칸이 서로 다른 값을 들고 있지 않게 맞춘다
  ['co-q','co-q-m'].forEach(id => { const e = document.getElementById(id); if(e && e.value !== v) e.value = v; });
  if(document.getElementById('cdt')?.style.display !== 'none') showCoFilteredList();
  renderCoList();   // 본문 표도 함께 다시 그린다
}

function coChip(on, label, n, onclick, title){
  return `<button class="btn bs${on ? ' bp' : ''}" style="font-size:11px;padding:3px 10px;gap:5px" onclick="${onclick}"${title ? ` title="${escapeHtml(title)}"` : ''}>
    ${escapeHtml(label)}<span style="${on ? '' : 'color:var(--i4);'}font-weight:700">${n}</span></button>`;
}

function coSectorChipsHtml(base){
  if(!coDomainF) return '';
  const keys = coDomainKeys(coDomainF);
  const inDomain = base.filter(c => coSecsOf(c).some(s => keys.has(sectorKey(s))));
  const count = {}, label = {};
  inDomain.forEach(c => coSecsOf(c).forEach(s => {
    const k = sectorKey(s);
    if(!keys.has(k)) return;
    count[k] = (count[k] || 0) + 1;
    if(!label[k]) label[k] = s;
  }));
  /* 설정에 등록된 섹터는 0개사여도 칩을 둔다 — 막 만든 섹터가 안 보이면
     추가가 안 된 줄 안다 */
  COMPANY_SECTORS.forEach(sc => {
    const k = sectorKey(sc.name);
    if(keys.has(k) && !(k in count)){ count[k] = 0; label[k] = sc.name; }
  });
  const order = coSectorOrder();
  const want = new Set(coCats().map(sectorKey));
  const items = Object.keys(count).sort((a, b) =>
    (order[a] ?? 1e9) - (order[b] ?? 1e9) || count[b] - count[a]);
  return coChip(!want.size, '전체', inDomain.length, 'clearCoSecChips()')
    + items.map(k => coChip(want.has(k), parseSectorScope(label[k]).plainName, count[k],
        `toggleCoSecChip('${escAttr(label[k])}')`, '여러 개를 함께 켤 수 있어요')).join('');
}

export function renderCoDashboard(list = coFilteredList()){
  const el = document.getElementById('co-dash');
  if(!el) return;

  if(!CO_DB.length){
    el.innerHTML = `<div class="dbe" style="height:100%"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg><p>등록된 기업이 없어요</p>
      <div style="margin-top:12px">${CO_ADD_BTN}</div></div>`;
    return;
  }

  const rowLbl = t => `<div style="flex:0 0 34px;font-size:11px;font-weight:700;color:var(--i4);padding-top:5px">${t}</div>`;
  // 섹터 칩 숫자는 섹터만 빼고 나머지 거르기(검색·코드·국내외·종류·질문)를 다 거친 것
  const secChips = coSectorChipsHtml(coFilteredList({ skipCats: true }));
  /* 제목·검색·「기업 추가」는 위쪽 바(.tb), 종류·정렬·숫자는 그 아래 줄
     (#co-kind-bar) — 본문은 섹터 칩과 표만. 분야는 왼쪽 트리에서 고른다 */
  el.innerHTML = `
    ${secChips ? `<div style="display:flex;gap:8px">${rowLbl('섹터')}
      <div style="display:flex;flex-wrap:wrap;gap:6px;flex:1;min-width:0">${secChips}</div></div>` : ''}
    ${coCompanyTableHtml(list, coUi.coDashQ || coUi.coAi ? '찾는 조건에 맞는 기업이 없어요' : '해당하는 기업이 없어요')}`;
  if(coUi.coDashScroll != null){ el.scrollTop = coUi.coDashScroll; coUi.coDashScroll = null; }
}

/* «기업 상세 화면»은 ../features/companies/co-detail.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
export { upsertCompanyRow, patchOrgFields, batchUpsertCompanies } from '../domain/org-save.js';
export { suggestSector, ensureOrgsForNames, reloadOrgs, orgIdForName } from '../domain/orgs.js';
/* «기업 필드 고치기·분야와 섹터·드래그»은 ../features/companies/co-edit.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* «기업 상세 하위 탭 — 참여 이력·담당자·요약·거래»은 ../features/companies/co-trade.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* ══════════════════════════════════════════
   initCompanyTab — router.js가 기업DB 탭으로 전환할 때 호출할 진입점
   (원본에는 별도 init 함수가 없었음 — 탭 모듈화에 맞춰 신규로 추가)
══════════════════════════════════════════ */
export function initCompanyTab(){
  showCoDashboard();
}

/* ══════════════════════════════════════════
   window 노출 — 이 파일이 생성하는 HTML의 인라인 onclick/onchange 문자열에서
   호출되는 함수는 ES 모듈 스코프에 갇혀 있어 반드시 window에 등록해야 동작한다.
══════════════════════════════════════════ */
window.selectCo = selectCo;
window.showCoDashboard = showCoDashboard;
window.setCoCat = setCoCat;
window.toggleCoSecChip = toggleCoSecChip;
window.clearCoSecChips = clearCoSecChips;
window.setCoDomainOnly = setCoDomainOnly;
window.setCoDashQ = setCoDashQ;
window.backToCoList = backToCoList;
window.setCoCode = setCoCode;
window.setCoCountry = setCoCountry;
window.toggleCoMainCollapse = toggleCoMainCollapse;
window.setCoDomain = setCoDomain;
window.toggleCoDomain = toggleCoDomain;
window.askCoAi = askCoAi;
window.clearCoAi = clearCoAi;
window.searchCoM = searchCoM;
window.openCoSearch = openCoSearch;
window.setCoSort = setCoSort;
window.setCoKind = setCoKind;
window.openAddOrgModal = openAddOrgModal;
window.onAddOrgDomainChange = onAddOrgDomainChange;
window.closeAddOrgModal = closeAddOrgModal;
window.submitAddOrg = submitAddOrg;
