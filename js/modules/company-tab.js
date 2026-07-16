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
  GS_URL,
  currentUser,
  CO_DB,
  COMPANY_INFO,
  contacts,
  participations,
  EVENT_LIST,
  PART_TYPES,
  COMPANY_SECTORS,
  selCo,
  coTab,
  coCatF,
  coCodeF,
  setSelCo,
  setCoTab,
  setCoCatF,
  setCoCodeF,
  evColor,
  evShort,
} from '../state.js';
import { RP, avB, avF } from '../constants.js';
import { escapeHtml, levenshteinDist, parseSectorScope } from '../utils.js';
import { parseSectors, joinSectors, mainSectors } from './settings-tab.js';
import { renderMDB, buildMDBEvList } from './db-tab.js';
import { trackAction } from './audit-tab.js';

/* ══════════════════════════════════════════
   섹터 관련 로컬 헬퍼 (원본 6278~6305행대, 설정 탭과 공유하던 것)
   settings-tab.js가 만들어져서 parseSectors/joinSectors/mainSectors는
   그쪽에서 import — CATEGORY_CODES는 섹터 트리와 무관한 기업DB 전용
   분류 코드라 settings-tab.js에는 없으므로 그대로 로컬 유지.
══════════════════════════════════════════ */
const CATEGORY_CODES = [
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
   기업DB 리스트 — Twenty Record Table 벤치마킹: 컬럼 표시/숨김 토글
   (신규 — 원본에는 없던 기능. 로컬 변수로만 관리, 시트 저장 없음)
══════════════════════════════════════════ */
const CO_TOGGLE_COLUMNS = [
  {key:'country', label:'국가'},
  {key:'website',  label:'웹사이트'},
  {key:'notes',    label:'메모'},
];
let coVisibleCols = { country:false, website:false, notes:false };
let coColMenuOpen = false;

export function toggleCoColMenu(){
  coColMenuOpen = !coColMenuOpen;
  renderCoList();
}
export function toggleCoCol(key){
  coVisibleCols[key] = !coVisibleCols[key];
  renderCoList();
}
function renderCoColumnToggleHtml(){
  return `
    <div style="position:relative;display:flex;justify-content:flex-end;padding:2px 6px 6px">
      <button class="btn bs" style="font-size:10px;padding:2px 8px" onclick="toggleCoColMenu()">⚙ 컬럼</button>
      ${coColMenuOpen ? `
        <div style="position:absolute;top:100%;right:6px;background:var(--W);border:1px solid var(--i6);border-radius:8px;padding:8px 10px;box-shadow:0 6px 18px rgba(0,0,0,.14);z-index:50;min-width:120px">
          ${CO_TOGGLE_COLUMNS.map(col => `
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;padding:3px 0;cursor:pointer;white-space:nowrap">
              <input type="checkbox" ${coVisibleCols[col.key]?'checked':''} onchange="toggleCoCol('${col.key}')">
              ${col.label}
            </label>`).join('')}
        </div>` : ''}
    </div>`;
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
function normalizeCompanyKey(raw){
  if(!raw) return '';
  let s = String(raw).trim();
  s = s.replace(/^(주식회사|㈜|\(주\))\s*/, '').replace(/\s*(주식회사|㈜|\(주\))$/, '');
  s = s.replace(/[\s,\.]*\b(incorporated|inc|co\.?,?\s*(ltd|limited)|ltd|limited|co|llc|llp|corp(oration)?|gmbh|pte\.?\s*ltd|pty\.?\s*ltd|plc)\b\.?\s*$/i, '');
  s = s.replace(/[.,]/g, '').replace(/\s+/g, '').trim().toLowerCase();
  return s;
}

export function buildCoDB(){
  CO_DB.splice(0, CO_DB.length); // 초기화

  if(!contacts.length) return;

  // ── 기업별로 contacts 그룹핑 (표기 차이를 흡수한 정규화 키 기준) ──
  const orgMap = {};
  contacts.forEach(c => {
    const rawKey = (c.orgKo || c.orgEn || '').trim();
    if(!rawKey) return;
    const key = normalizeCompanyKey(rawKey) || rawKey.toLowerCase();
    if(!orgMap[key]) orgMap[key] = { contacts:[], nameKo:'', nameEn:'', branchCounts:{} };
    orgMap[key].contacts.push(c);
    orgMap[key].branchCounts[rawKey] = (orgMap[key].branchCounts[rawKey]||0) + 1;
    if(!orgMap[key].nameKo && c.orgKo) orgMap[key].nameKo = c.orgKo;
    if(!orgMap[key].nameEn && c.orgEn) orgMap[key].nameEn = c.orgEn;
  });

  // ── 기업별로 participations 집계 ──
  Object.entries(orgMap).forEach(([key, co]) => {
    const cIds = new Set(co.contacts.map(c => c.id));
    const parts = participations.filter(p => cIds.has(p.contactId));

    // 행사별 집계
    const evMap = {};
    parts.forEach(p => {
      const ev = EVENT_LIST.find(e => e.key === p.eventId) || { key: p.eventId, short: p.eventId, name: p.eventId, color:'#9C9890', date:'' };
      if(!evMap[p.eventId]) evMap[p.eventId] = {
        name: ev.name || ev.key,   // 풀네임 우선
        short: ev.short || ev.key,
        year: (ev.date||'').slice(0,4) || new Date().getFullYear(),
        date: ev.date || '',
        loc: '',
        color: ev.color || '#9C9890',
        roles: [],
        people: [],
        note: '',
      };
      const role = p.role || '참가자';
      if(!evMap[p.eventId].roles.includes(role)) evMap[p.eventId].roles.push(role);
      // 담당자 이름
      const c = contacts.find(x => x.id === p.contactId);
      if(c){
        const nm = c.nameKo || c.nameEn || '';
        if(nm && !evMap[p.eventId].people.includes(nm)) evMap[p.eventId].people.push(nm);
      }
    });

    // contacts 담당자 목록 — id 기준 중복 제거
    const seenIds = new Set();
    const coContacts = co.contacts
      .filter(c => {
        if(seenIds.has(c.id)) return false;
        seenIds.add(c.id);
        return true;
      })
      .map(c => ({
        id:     c.id,
        name:   c.nameKo || c.nameEn || '',
        nameEn: c.nameEn || '',
        title:  c.titleKo || c.titleEn || '',
        cats:   [c.cat].filter(Boolean),
        // 이 사람이 참여한 모든 행사 (participations 기준)
        events: participations.filter(p => p.contactId === c.id).map(p => p.eventId),
      }));

    // 가장 많이 쓰인 원문 표기 (표시용 이름/약어 기본값)
    const branches   = Object.entries(co.branchCounts).sort((a,b)=>b[1]-a[1]).map(([b])=>b);
    const mainBranch = branches[0] || key;

    // 약어 생성 (최대 2자)
    const nm = co.nameKo || co.nameEn || mainBranch;
    const abbr = nm.length <= 2 ? nm
      : /[가-힣]/.test(nm) ? nm.slice(0,2)
      : nm.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();

    // 섹터(산업 분류)는 beat 필드(실제 산업 섹터)만 사용 — 참가 역할(cat)로 대신 추측하지 않는다.
    const beatVal = co.contacts.find(c=>c.beat)?.beat || '';
    const sectors = beatVal ? parseSectors(beatVal) : [];
    const sector  = sectors[0] || 'General / Others';

    // companies 시트에 저장된 회사 단위 정보가 있으면 우선 적용 (정규화 키 우선, 옛 원문 키도 폴백 조회)
    const info = COMPANY_INFO[key] || branches.map(b=>COMPANY_INFO[b]).find(Boolean);
    const infoSectors = info && info.sector ? parseSectors(info.sector) : [];

    CO_DB.push({
      key,
      nameKo:     co.nameKo || mainBranch,   // 가장 많이 쓰인 표기를 대표 이름으로 사용
      nameEn:     co.nameEn || '',
      abbr:       (info && info.abbr) || abbr,
      sector:     infoSectors[0] || sector,     // 대표 섹터
      sectors:    infoSectors.length ? infoSectors : sectors,    // 복수 섹터 배열
      hq:         (info && info.hq) || co.contacts[0]?.country || '',
      website:    (info && info.website) || '',
      notes:      (info && info.notes) || '',
      catCode:    (info && info.catCode) || '',
      country:    (info && info.country) || '',
      source:     (info && info.source) || '',
      updatedAt:  (info && info.updatedAt) || '',
      branches,
      mainBranch,
      events:     Object.values(evMap),
      contacts:   coContacts,
    });
  });

  // 이름순 정렬
  CO_DB.sort((a,b) => (a.nameKo||a.nameEn).localeCompare(b.nameKo||b.nameEn));

  try {
    const dashEl = document.getElementById('co-dash');
    if(dashEl && dashEl.style.display !== 'none' && !selCo) renderCoDashboard();
  } catch(e){}
}

/* ══════════════════════════════════════════
   유사 기업명 찾기 (자동 정규화로 못 잡는 오타/줄임말 등 후보를 찾아 수동 병합)
   (원본 3320~3413행) — 레벤슈타인 거리는 utils.js의 levenshteinDist를 재사용
══════════════════════════════════════════ */
export function findSimilarCompanyPairs(){
  const items = CO_DB.map(c => ({ c, norm: c.key.replace(/\s+/g,'') }))
    .filter(x => x.norm.length >= 3);
  const pairs = [];
  for(let i=0; i<items.length; i++){
    for(let j=i+1; j<items.length; j++){
      const a = items[i], b = items[j];
      const maxLen = Math.max(a.norm.length, b.norm.length);
      const dist = levenshteinDist(a.norm, b.norm);
      const similarity = 1 - dist/maxLen;
      // 너무 짧은 이름은 오탐이 많아 임계치를 더 엄격하게
      const threshold = maxLen <= 5 ? 1 : (maxLen <= 8 ? 2 : 3);
      if(dist > 0 && dist <= threshold && similarity >= 0.75){
        pairs.push({ a: a.c, b: b.c, similarity });
      }
    }
  }
  return pairs.sort((x,y) => y.similarity - x.similarity).slice(0, 50);
}

export function renderSimilarCompanyList(){
  const el = document.getElementById('similar-co-list');
  if(!el) return;
  el.innerHTML = '<div style="font-size:12px;color:var(--i4)">검사 중...</div>';

  const pairs = findSimilarCompanyPairs();
  if(!pairs.length){
    el.innerHTML = '<div style="font-size:12px;color:var(--i4)">유사한 기업명 후보를 못 찾았어요.</div>';
    return;
  }

  el.innerHTML = pairs.map(({a, b, similarity}) => `
    <div style="background:var(--W);border:1px solid var(--i6);border-radius:8px;padding:10px 12px">
      <div style="font-size:11px;color:var(--i4);margin-bottom:6px">유사도 ${Math.round(similarity*100)}%</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:120px;font-size:13px;font-weight:600">${escapeHtml(a.nameKo||a.nameEn)} <span style="font-size:11px;color:var(--i4);font-weight:400">(${a.contacts.length}명)</span></div>
        <span style="color:var(--i4)">↔</span>
        <div style="flex:1;min-width:120px;font-size:13px;font-weight:600">${escapeHtml(b.nameKo||b.nameEn)} <span style="font-size:11px;color:var(--i4);font-weight:400">(${b.contacts.length}명)</span></div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn bp bs" onclick="mergeCompanies('${b.key.replace(/'/g,"\\'")}','${a.key.replace(/'/g,"\\'")}')">"${escapeHtml(a.nameKo||a.nameEn)}"로 합치기</button>
        <button class="btn bp bs" onclick="mergeCompanies('${a.key.replace(/'/g,"\\'")}','${b.key.replace(/'/g,"\\'")}')">"${escapeHtml(b.nameKo||b.nameEn)}"로 합치기</button>
        <button class="btn bs" onclick="this.closest('div[style*=\\'border-radius:8px\\']').remove()">다른 기업임</button>
      </div>
    </div>`).join('');
}

/* ══════════════════════════════════════════
   mergeCompanies — 기업 병합 (원본에는 "mergeCoInto"라는 이름이 없었고
   실제 이름은 mergeCompanies였음. 핵심 로직/저장 방식 변경 없음. 원본 3381~3413행)
══════════════════════════════════════════ */
export async function mergeCompanies(loserKey, winnerKey){
  const winner = CO_DB.find(c => c.key === winnerKey);
  const loser  = CO_DB.find(c => c.key === loserKey);
  if(!winner || !loser) return;
  if(!confirm(`"${loser.nameKo||loser.nameEn}"(${loser.contacts.length}명) 을(를) "${winner.nameKo||winner.nameEn}"로 합칠까요?\n소속 연락처들의 기업명이 변경됩니다.`)) return;

  const changed = [];
  loser.contacts.forEach(pc => {
    const c = contacts.find(x => x.id === pc.id);
    if(!c) return;
    if(c.orgKo) c.orgKo = winner.nameKo || c.orgKo;
    if(c.orgEn) c.orgEn = winner.nameEn || c.orgEn;
    if(!c.orgKo && winner.nameKo) c.orgKo = winner.nameKo;
    if(!c.orgEn && winner.nameEn) c.orgEn = winner.nameEn;
    changed.push(c);
  });

  if(GS_URL && currentUser && changed.length){
    const rows = changed.map(c => [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
      c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2, c.beat, c.products]);
    try{
      await fetch(GS_URL, {
        method: 'POST',
        body: JSON.stringify({ sheet: 'contacts', email: currentUser.email, action: 'batchUpsert', rows }),
      });
    }catch(e){ console.warn('기업 병합 저장 실패:', e); }
  }

  buildCoDB(); buildCoCAT();
  try { renderCoList(); } catch(e){}
  renderSimilarCompanyList();
  alert(`"${loser.nameKo||loser.nameEn}"를 "${winner.nameKo||winner.nameEn}"로 합쳤어요.`);
}
// 계획서에서 언급한 이름과의 호환을 위한 별칭 (핵심 로직은 mergeCompanies와 동일)
export { mergeCompanies as mergeCoInto };

/* ══════════════════════════════════════════
   buildCoCAT / setCoCat — 좌측 섹터 필터 (원본 3415~3463행)
══════════════════════════════════════════ */
// 섹터 필터 버튼 하나 (기업DB 검색 사이드바) — 행사별 그룹핑에서 공통으로 사용
function coCatButton(name, cnt, indent, title){
  const label = parseSectorScope(name).plainName;
  return `<button class="nr${coCatF===name?' on':''}" onclick="setCoCat('${name.replace(/'/g,"\\'")}') " style="${indent||''}"${title?` title="${title}"`:''}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;flex-shrink:0"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
      ${escapeHtml(label)}<span class="nbg">${cnt}</span>
    </button>`;
}

export function buildCoCAT(){
  const el = document.getElementById('co-catf');
  if(!el) return;

  // 복수 섹터 집계
  const sectorCounts = {};
  CO_DB.forEach(c => {
    (c.sectors && c.sectors.length ? c.sectors : [c.sector||'General / Others'])
      .forEach(s => { sectorCounts[s] = (sectorCounts[s]||0) + 1; });
  });

  const html = [`<button class="nr${!coCatF?' on':''}" onclick="setCoCat(null)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><circle cx="12" cy="12" r="10"/></svg>
      전체<span class="nbg">${CO_DB.length}</span>
    </button>`];

  // 등록된 섹터를 "공통" + 행사별로 그룹핑해서 보여준다(행사가 많아질수록
  // 검색하기 쉽도록) — 같은 이름이 다른 행사에 있어도 섞이지 않는다.
  const shown = new Set();
  const groupOrder = ['', ...EVENT_LIST.map(e => e.short)];
  const groupLabel = short => short || '공통';

  groupOrder.forEach(short => {
    const items = COMPANY_SECTORS.filter(s => {
      const sc = typeof s==='string' ? { eventShort:null } : parseSectorScope(s.name);
      return (sc.eventShort||'') === short && (sectorCounts[typeof s==='string'?s:s.name]||0) > 0;
    });
    if(!items.length) return;
    html.push(`<div style="font-size:10px;font-weight:700;color:var(--i4);text-transform:uppercase;letter-spacing:.04em;margin:8px 0 2px 2px">${escapeHtml(groupLabel(short))}</div>`);
    items.forEach(s => {
      const name = typeof s === 'string' ? s : s.name;
      const parent = typeof s === 'string' ? null : s.parent;
      shown.add(name);
      html.push(coCatButton(name, sectorCounts[name]||0, parent ? 'padding-left:18px;font-size:11px' : ''));
    });
  });

  // 아직 섹터 체계에 등록 안 된 값도 대시보드와 동일하게 표시 (설정 → 기업 섹터에서 그룹으로 정리 가능)
  const unregistered = Object.keys(sectorCounts).filter(name => !shown.has(name));
  if(unregistered.length){
    html.push(`<div style="font-size:10px;font-weight:700;color:var(--i4);text-transform:uppercase;letter-spacing:.04em;margin:8px 0 2px 2px">미등록</div>`);
    unregistered.forEach(name => html.push(coCatButton(name, sectorCounts[name], '', '미등록 섹터')));
  }

  el.innerHTML = html.join('');
  buildCoCodeF();
}
export function setCoCat(s){
  setCoCatF((coCatF===s)?null:s);
  buildCoCAT(); renderCoList();
  // 기업이 선택되어 상세화면을 보는 중이 아니라면, 메인 화면도 필터된 기업 리스트로 갱신
  if(!selCo) renderCoDashboard();
}
export function buildCoCodeF(){
  const el = document.getElementById('co-codef');
  if(!el) return;
  const codeCounts = {};
  CO_DB.forEach(c => { if(c.catCode){ const prefix = c.catCode.split('-')[0]; codeCounts[prefix] = (codeCounts[prefix]||0)+1; } });
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

/* ══════════════════════════════════════════
   renderCoList — 기업 리스트 (원본 3486~3512행)
   Twenty Record Table 벤치마킹: 컬럼(국가/웹사이트/메모) 표시/숨김 토글 추가
══════════════════════════════════════════ */
export function renderCoList(q2=''){
  const listEl = document.getElementById('co-ls');
  if(!listEl) return;
  const q=q2||(document.getElementById('co-si')||{}).value||'';
  let list=[...CO_DB];
  if(q)list=list.filter(c=>c.nameKo.toLowerCase().includes(q.toLowerCase())||c.nameEn.toLowerCase().includes(q.toLowerCase())||c.sector.toLowerCase().includes(q.toLowerCase()));
  if(coCatF)list=list.filter(c=>(c.sectors||[c.sector]).some(s=>s===coCatF));
  if(coCodeF)list=list.filter(c=>c.catCode && c.catCode.startsWith(coCodeF+'-'));

  const toggleHtml = renderCoColumnToggleHtml();

  if(!list.length){
    listEl.innerHTML = toggleHtml + (CO_DB.length === 0
      ? '<div style="padding:24px 14px;text-align:center;font-size:11px;color:var(--i4);line-height:1.6">등록된 기업이 없어요<br>업로드 또는 CRM 타겟 추가 시<br>자동으로 채워져요</div>'
      : '<div style="padding:24px 14px;text-align:center;font-size:11px;color:var(--i4)">검색 결과가 없어요</div>');
    return;
  }

  listEl.innerHTML = toggleHtml + list.map((c,i)=>`
    <div class="co-rw${selCo===c.key?' on':''}" onclick="selectCo('${c.key.replace(/'/g,"\\'")}')">
      <div class="co-av" style="background:${avB(i)};color:${avF(i)}">${escapeHtml(c.abbr)}</div>
      <div style="flex:1;min-width:0">
        <div class="co-rn">${escapeHtml(c.nameKo||c.nameEn)}</div>
        <div class="co-rm" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.sector||'미분류')}</span>
          ${coVisibleCols.country ? `<span style="font-size:10px;color:var(--i4)">· ${escapeHtml(c.country||'-')}</span>` : ''}
          ${coVisibleCols.website ? `<span style="font-size:10px;color:var(--i4)">· ${c.website?escapeHtml(c.website):'-'}</span>` : ''}
          ${coVisibleCols.notes ? `<span style="font-size:10px;color:var(--i4)">· ${escapeHtml(c.notes||'-')}</span>` : ''}
        </div>
      </div>
      <div class="co-ct">${c.events.length}회</div>
    </div>`).join('');
}
export function searchCo(v){renderCoList(v)}
export function searchCoM(v){renderCoList(v)}

export function selectCo(key){
  setSelCo(key); setCoTab(0); renderCoList();
  const c=CO_DB.find(x=>x.key===key);if(!c)return;
  const dashEl = document.getElementById('co-dash'); if(dashEl) dashEl.style.display='none';
  const cdtEl  = document.getElementById('cdt');      if(cdtEl)  cdtEl.style.display='flex';
  renderCoDetail(c);
}

// ── 기업DB 진입 시 기본 화면: 섹터별 대시보드 ──
export function showCoDashboard(){
  setSelCo(null); setCoCatF(null); setCoCodeF(null);
  renderCoList(); buildCoCAT(); buildCoCodeF();
  const cdtEl = document.getElementById('cdt'); if(cdtEl) cdtEl.style.display='none';
  const dashEl = document.getElementById('co-dash'); if(dashEl) dashEl.style.display='block';
  renderCoDashboard();
}

function computeSectorDashboard(){
  const mains = mainSectors();
  const groups = mains.map(m => ({ name:m.name, companies:new Set(), subs:{} }));
  const byName = {}; groups.forEach(g => byName[g.name]=g);
  const subParentName = {};
  COMPANY_SECTORS.forEach(s => {
    if(s.parent){ const p = COMPANY_SECTORS.find(x=>x.id===s.parent); if(p) subParentName[s.name]=p.name; }
  });

  CO_DB.forEach(c => {
    const secs = (c.sectors && c.sectors.length) ? c.sectors : [c.sector || 'General / Others'];
    secs.forEach(secName => {
      const parentName = subParentName[secName];
      const mName  = parentName || secName;
      const subName = parentName ? secName : null;
      let g = byName[mName];
      if(!g){ g = { name: mName, companies: new Set(), subs: {} }; byName[mName]=g; groups.push(g); }
      g.companies.add(c.key);
      if(subName){
        if(!g.subs[subName]) g.subs[subName] = new Set();
        g.subs[subName].add(c.key);
      }
    });
  });

  return groups
    .map(g => ({
      name: g.name,
      count: g.companies.size,
      subs: Object.entries(g.subs)
        .map(([name, set]) => ({ name, count: set.size }))
        .sort((a,b) => b.count - a.count),
    }))
    .filter(g => g.count > 0)
    .sort((a,b) => b.count - a.count);
}

/* ══════════════════════════════════════════
   renderCoDashboard — 섹터별 기업 대시보드 (원본 3565~3622행)
══════════════════════════════════════════ */
export function renderCoDashboard(){
  const el = document.getElementById('co-dash');
  if(!el) return;

  if(!CO_DB.length){
    el.innerHTML = `<div class="dbe" style="height:100%"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg><p>등록된 기업이 없어요</p></div>`;
    return;
  }

  // 섹터가 선택되어 있으면 메인 화면도 그 섹터의 기업 리스트로 보여줌 (카드 그리드 대신)
  if(coCatF){
    const list = CO_DB.filter(c => (c.sectors&&c.sectors.length?c.sectors:[c.sector]).some(s=>s===coCatF));
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <button onclick="setCoCat('${coCatF.replace(/'/g,"\\'")}')" style="background:none;border:none;cursor:pointer;color:var(--i3);font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;padding:0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          전체 섹터 보기
        </button>
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--i1);margin-bottom:2px">🏭 ${escapeHtml(coCatF)} <span style="font-weight:400;color:var(--i4);font-size:12px">${list.length}개 기업</span></div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:12px">
        ${list.length ? list.map((c,i) => `
          <div class="co-rw" onclick="selectCo('${c.key.replace(/'/g,"\\'")}')" style="cursor:pointer;border:1px solid var(--i6);border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:10px;background:var(--W)">
            <div class="co-av" style="background:${avB(i)};color:${avF(i)}">${escapeHtml(c.abbr)}</div>
            <div style="flex:1;min-width:0">
              <div class="co-rn">${escapeHtml(c.nameKo||c.nameEn)}</div>
              <div style="font-size:11px;color:var(--i4)">${escapeHtml((c.sectors||[c.sector]).join(', ')||'미분류')}</div>
            </div>
            <div class="co-ct">${c.events.length}회</div>
          </div>`).join('') : `<div style="font-size:12px;color:var(--i4)">해당 섹터의 기업이 없어요</div>`}
      </div>`;
    return;
  }

  const data = computeSectorDashboard();
  const totalCo = CO_DB.length;

  el.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:var(--i1);margin-bottom:2px">섹터별 기업 대시보드</div>
    <div style="font-size:11px;color:var(--i4);margin-bottom:16px">전체 ${totalCo}개 기업 · 클릭하면 해당 섹터의 기업 리스트가 보여요</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
      ${data.map(g => `
        <div class="astep" style="padding:14px 15px;cursor:pointer" onclick="setCoCat('${g.name.replace(/'/g,"\\'")}')">
          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">
            <div class="sttl" style="margin:0">${escapeHtml(g.name)}</div>
            <div style="font-size:18px;font-weight:800;color:var(--a)">${g.count}<span style="font-size:10px;font-weight:600;color:var(--i4)">개사</span></div>
          </div>
          ${g.subs.length ? `<div style="display:flex;flex-direction:column;gap:5px">
            ${g.subs.map(s => `
              <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--i3)" onclick="event.stopPropagation();setCoCat('${s.name.replace(/'/g,"\\'")}')">
                <span>↳ ${escapeHtml(s.name)}</span>
                <span style="font-weight:700;color:var(--i2)">${s.count}개사</span>
              </div>`).join('')}
          </div>` : `<div style="font-size:11px;color:var(--i4)">서브섹터 없음</div>`}
        </div>
      `).join('')}
    </div>`;
}

/* ══════════════════════════════════════════
   renderCoDetail — 기업 상세 화면 (원본 3623~3683행)
   editCoSector/editCoNotes/... 클릭 시 인라인 편집으로 전환되는 span들을 렌더링
══════════════════════════════════════════ */
export function renderCoDetail(c){
  const i=CO_DB.findIndex(x=>x.key===c.key);
  // 역할별로 어느 행사에서 쓰였는지 함께 추적 (같은 역할이 여러 행사에 걸쳐 있으면 툴팁으로 구분)
  const roleEvMap={};
  c.events.forEach(e=>e.roles.forEach(r=>{
    if(!roleEvMap[r]) roleEvMap[r]=new Set();
    roleEvMap[r].add(e.short||e.name);
  }));
  const roles=Object.keys(roleEvMap);
  const yrs=c.events.map(e=>+e.year);
  const cdhEl = document.getElementById('cdh');
  if(cdhEl) cdhEl.innerHTML=`
    <div style="margin-bottom:10px">
      <button onclick="showCoDashboard()" style="background:none;border:none;cursor:pointer;color:var(--i3);font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;padding:0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        섹터 대시보드
      </button>
    </div>
    <div class="cdt2">
      <div class="cdl" style="background:${avB(i)};color:${avF(i)}">${escapeHtml(c.abbr)}</div>
      <div style="flex:1"><div class="cdn">${escapeHtml(c.nameKo)} <span style="font-size:13px;font-weight:400;color:var(--i4)">${escapeHtml(c.nameEn)}</span></div>
        <div class="cdmt">
          <span>📍 ${escapeHtml(c.hq)}</span>
          <span style="cursor:pointer" onclick="editCoSector('${c.key.replace(/'/g,"\\'")}')" title="클릭하여 섹터 변경">
            🏭 <span id="co-sector-${c.key}">${escapeHtml(c.sector||'미분류')}</span> ✎
          </span>
          <span style="cursor:pointer" onclick="editCoWebsite('${c.key.replace(/'/g,"\\'")}')" title="클릭하여 웹사이트 편집">
            🔗 <span id="co-website-${c.key}">${c.website ? `<a href="${escapeHtml(c.website)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(c.website)}</a>` : '웹사이트 추가'}</span> ✎
          </span>
          <span style="cursor:pointer" onclick="editCoNotes('${c.key.replace(/'/g,"\\'")}')" title="클릭하여 메모 편집">
            📝 <span id="co-notes-${c.key}">${escapeHtml(c.notes||'메모 추가')}</span> ✎
          </span>
          <span style="cursor:pointer" onclick="editCoCountry('${c.key.replace(/'/g,"\\'")}')" title="클릭하여 국가 편집">
            🌍 <span id="co-country-${c.key}">${escapeHtml(c.country||'국가 추가')}</span> ✎
          </span>
          <span style="cursor:pointer" onclick="editCoAbbr('${c.key.replace(/'/g,"\\'")}')" title="클릭하여 약어 편집">
            🔤 <span id="co-abbr-${c.key}">${escapeHtml(c.abbr||'약어 추가')}</span> ✎
          </span>
          <span style="cursor:pointer" onclick="editCoSource('${c.key.replace(/'/g,"\\'")}')" title="클릭하여 출처 편집">
            📌 <span id="co-source-${c.key}">${escapeHtml(c.source||'출처 추가')}</span> ✎
          </span>
          <span id="co-catcode-${c.key}">
            ${c.catCode
              ? `<span class="btag main">${escapeHtml(c.catCode)}</span>`
              : `<button class="btn bs" style="font-size:11px;padding:2px 8px" onclick="showAssignCatCodeUI('${c.key.replace(/'/g,"\\'")}')">코드 부여</button>`}
          </span>
          <span style="color:var(--i4);font-size:11px">🕒 ${escapeHtml(c.updatedAt || '-')}</span>
        </div>
      </div>
    </div>
    <div class="cost">
      <div class="cosi"><div class="cosn">${c.events.length}</div><div class="cosl">총 참여 행사</div></div>
      <div class="cosi"><div class="cosn">${c.contacts.length}</div><div class="cosl">등록 담당자</div></div>
      <div class="cosi"><div class="cosn">${yrs.length?Math.min(...yrs):'-'}</div><div class="cosl">첫 참여</div></div>
      <div class="cosi"><div class="cosn" style="display:flex;gap:3px;flex-wrap:wrap">${roles.map(r=>`<span class="pill ${RP[r]||'p-gray'}" title="${escapeHtml([...roleEvMap[r]].join(', '))}">${escapeHtml(r)}</span>`).join('')}</div><div class="cosl">유형</div></div>
    </div>
    <div class="cobr">${c.branches.map(b=>`<span class="btag${b===c.mainBranch?' main':''}">${escapeHtml(b)}</span>`).join('')}</div>`;
  const tabs=['행사 참여 이력','담당자','요약'];
  const tabsEl = document.getElementById('cotabs');
  if(tabsEl) tabsEl.innerHTML=tabs.map((t,k)=>`<div class="cotab${coTab===k?' on':''}" onclick="switchCoT(${k})">${t}</div>`).join('');
  renderCoBody(c);
}
export function switchCoT(k){
  setCoTab(k);
  const c=CO_DB.find(x=>x.key===selCo);
  document.querySelectorAll('.cotab').forEach((t,j)=>t.classList.toggle('on',j===k));
  renderCoBody(c);
}

/* ══════════════════════════════════════════
   companies 시트 동기화 (원본 4248~4267행) — 저장 로직 원본 그대로 유지
══════════════════════════════════════════ */
export async function upsertCompanyRow(c){
  c.updatedAt = new Date().toISOString();
  COMPANY_INFO[c.key] = {
    sector: joinSectors(c.sectors||[]), hq: c.hq||'', website: c.website||'', notes: c.notes||'',
    catCode: c.catCode||'', country: c.country||'', abbr: c.abbr||'', source: c.source||'', updatedAt: c.updatedAt,
  };
  if(!GS_URL || !currentUser) return;
  try{
    await fetch(GS_URL, {
      method: 'POST',
      body: JSON.stringify({
        sheet: 'companies',
        email: currentUser.email,
        action: 'upsert',
        row: [c.key, joinSectors(c.sectors||[]), c.hq||'', c.website||'', c.notes||'',
              c.catCode||'', c.country||'', c.abbr||'', c.source||'', c.updatedAt],
      }),
    });
  } catch(e){ console.warn('companies 저장 실패:', c.key, e); }
}

/* 여러 기업을 한 번에 저장 (신규 — 원본에는 없던 기능).
   업로드 직후처럼 한 번에 수십~수백 개 회사를 저장해야 할 때, upsertCompanyRow를
   회사마다 개별 POST로 부르면 Apps Script가 수백 개 동시 요청을 감당하지 못해
   일부가 실패하고 브라우저에는 CORS 에러로 나타난다(실제 원인은 서버 과부하).
   batchUpsert 액션 하나로 묶어서 요청 횟수를 1번으로 줄인다. */
export async function batchUpsertCompanies(companies){
  if(!companies.length) return;
  const now = new Date().toISOString();
  companies.forEach(c => {
    c.updatedAt = now;
    COMPANY_INFO[c.key] = {
      sector: joinSectors(c.sectors||[]), hq: c.hq||'', website: c.website||'', notes: c.notes||'',
      catCode: c.catCode||'', country: c.country||'', abbr: c.abbr||'', source: c.source||'', updatedAt: now,
    };
  });
  if(!GS_URL || !currentUser) return;
  try{
    await fetch(GS_URL, {
      method: 'POST',
      body: JSON.stringify({
        sheet: 'companies',
        email: currentUser.email,
        action: 'batchUpsert',
        rows: companies.map(c => [c.key, joinSectors(c.sectors||[]), c.hq||'', c.website||'', c.notes||'',
              c.catCode||'', c.country||'', c.abbr||'', c.source||'', c.updatedAt]),
      }),
    });
  } catch(e){ console.warn('companies 일괄 저장 실패:', e); }
}

// ── 카테고리 코드 부여 (PREFIX-NNN, 이미 있으면 재계산하지 않음) (원본 4269~4281행) ──
function assignCategoryCode(company, prefix){
  if(company.catCode) return;
  let maxSeq = 0;
  CO_DB.forEach(co => {
    if(co.catCode && co.catCode.startsWith(prefix+'-')){
      const seq = parseInt(co.catCode.slice(prefix.length+1), 10);
      if(!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  });
  company.catCode = `${prefix}-${String(maxSeq+1).padStart(3,'0')}`;
  upsertCompanyRow(company);
}

/* ══════════════════════════════════════════
   기업 필드 인라인 편집 — Twenty Record Table 벤치마킹
   (원본은 editCoNotes/editCoWebsite/editCoCountry/editCoAbbr/editCoSource가
   각각 화면 중앙 모달을 띄우고 별도 저장 버튼(saveCoNotes 등)을 눌러야 저장되는
   방식이었음. 여기서는 클릭한 span 자리에서 바로 input/textarea로 바뀌어
   Enter 또는 포커스 아웃 시 저장, Escape로 취소하는 인라인 편집으로 개선함.
   저장 로직(upsertCompanyRow → GS_URL companies 시트 upsert)은 원본 그대로.
══════════════════════════════════════════ */
const CO_TEXT_FIELDS = {
  notes:   { placeholder: '이 기업에 대한 메모를 남겨보세요', multiline: true,  empty: '메모 추가' },
  website: { placeholder: 'https://example.com',              multiline: false, empty: '웹사이트 추가', isLink: true },
  country: { placeholder: '예: 한국',                          multiline: false, empty: '국가 추가' },
  abbr:    { placeholder: '예: SK',                            multiline: false, empty: '약어 추가' },
  source:  { placeholder: '예: 홈페이지 조사',                  multiline: false, empty: '출처 추가' },
};

function renderCoFieldDisplay(key, field){
  const c = CO_DB.find(x => x.key === key);
  const cfg = CO_TEXT_FIELDS[field];
  const span = document.getElementById(`co-${field}-${key}`);
  if(!c || !cfg || !span) return;
  const val = c[field] || '';
  if(cfg.isLink && val){
    span.innerHTML = `<a href="${escapeHtml(val)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(val)}</a>`;
  } else {
    span.textContent = val || cfg.empty;
  }
}

async function saveCoTextField(key, field, rawValue){
  const c = CO_DB.find(x => x.key === key);
  if(!c) return;
  c[field] = rawValue.trim();
  await upsertCompanyRow(c);
  renderCoFieldDisplay(key, field);
  if(field === 'abbr'){
    // 원본 saveCoAbbr도 저장 후 상세/리스트를 다시 그렸음(약어는 아바타 등 여러 곳에 쓰이므로)
    renderCoDetail(c);
    renderCoList();
  }
}

function startCoInlineEdit(key, field){
  const c = CO_DB.find(x => x.key === key);
  const cfg = CO_TEXT_FIELDS[field];
  if(!c || !cfg) return;
  const span = document.getElementById(`co-${field}-${key}`);
  if(!span) return;
  if(span.querySelector('input,textarea')) return; // 이미 편집 중이면 무시

  const current = c[field] || '';
  const tag = cfg.multiline ? 'textarea' : 'input';
  const sizeStyle = cfg.multiline
    ? 'width:220px;height:64px;resize:vertical;font-size:11px;padding:4px 6px;font-family:inherit'
    : 'width:160px;font-size:11px;padding:2px 6px;font-family:inherit';
  span.innerHTML = `<${tag} class="fi" id="co-inline-input-${field}-${key}" style="${sizeStyle}" placeholder="${escapeHtml(cfg.placeholder)}"></${tag}>`;
  const input = document.getElementById(`co-inline-input-${field}-${key}`);
  if(!input) return;
  input.value = current;
  input.addEventListener('click', e => e.stopPropagation());
  input.focus();
  if(input.select) input.select();

  let settled = false;
  const commit = () => {
    if(settled) return; settled = true;
    saveCoTextField(key, field, input.value);
  };
  const cancel = () => {
    if(settled) return; settled = true;
    renderCoFieldDisplay(key, field);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if(e.key === 'Enter' && !cfg.multiline){ e.preventDefault(); input.blur(); }
    if(e.key === 'Escape'){ e.preventDefault(); input.removeEventListener('blur', commit); cancel(); }
  });
}

export function editCoNotes(key){ startCoInlineEdit(key, 'notes'); }
export function editCoWebsite(key){ startCoInlineEdit(key, 'website'); }
export function editCoCountry(key){ startCoInlineEdit(key, 'country'); }
export function editCoAbbr(key){ startCoInlineEdit(key, 'abbr'); }
export function editCoSource(key){ startCoInlineEdit(key, 'source'); }

/* ── 기업 섹터 편집(복수 선택) — 클릭한 필드 바로 아래 앵커된 팝오버로 인라인 편집 ──
   원본은 화면 중앙 고정 모달이었음. Twenty의 select 셀 편집(클릭한 셀 위치에
   드롭다운이 뜨는 방식)을 벤치마킹해 앵커 팝오버 + 바깥 클릭 시 닫힘으로 개선.
   저장 로직(saveCoSector 내부의 upsertCompanyRow/contacts upsert)은 원본 그대로. */
function handleCoSectorOutsideClick(e){
  const pop = document.getElementById('co-sector-popover');
  if(pop && !pop.contains(e.target)) closeCoSectorPopover();
}
export function closeCoSectorPopover(){
  const pop = document.getElementById('co-sector-popover');
  if(pop) pop.remove();
  document.removeEventListener('mousedown', handleCoSectorOutsideClick);
}
export function editCoSector(key){
  const c = CO_DB.find(x => x.key === key);
  if(!c) return;
  closeCoSectorPopover();

  const anchorSpan = document.getElementById('co-sector-' + key);
  const anchor = anchorSpan ? anchorSpan.parentElement : null;
  const rect = anchor ? anchor.getBoundingClientRect() : { bottom: 80, left: 20 };

  const currentSectors = c.sectors && c.sectors.length ? c.sectors : (c.sector ? [c.sector] : []);

  const checkboxRow = (s) => {
    const name   = typeof s==='string' ? s : s.name;
    const parent = typeof s==='string' ? null : s.parent;
    const checked = currentSectors.includes(name) ? 'checked' : '';
    const indent  = parent ? 'margin-left:16px' : '';
    const prefix  = parent ? '↳ ' : '';
    const label   = parseSectorScope(name).plainName;
    return `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;${indent}">
      <input type="checkbox" value="${escapeHtml(name)}" ${checked} style="width:13px;height:13px;cursor:pointer">
      <span style="font-size:12px">${prefix}${escapeHtml(label)}</span>
    </label>`;
  };

  // 이 기업이 실제로 참가한 행사(및 공통)별로 섹터를 묶어서 보여준다 —
  // 참가하지도 않은 다른 행사의 섹터 트리까지 뒤섞여 나오지 않게 함
  const companyEventShorts = [...new Set((c.events||[]).map(e => e.short))];
  const groups = [{ label: '공통', shorts: [null] }, ...companyEventShorts.map(short => ({ label: short, shorts: [short] }))];

  const groupsHtml = groups.map(g => {
    const items = COMPANY_SECTORS.filter(s => {
      const scope = parseSectorScope(typeof s==='string'?s:s.name).eventShort;
      return g.shorts.includes(scope);
    });
    if(!items.length) return '';
    return `<div style="margin-bottom:8px">
      <div style="font-size:10px;font-weight:700;color:var(--i4);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">${escapeHtml(g.label)}</div>
      ${items.map(checkboxRow).join('')}
    </div>`;
  }).join('');

  const pop = document.createElement('div');
  pop.id = 'co-sector-popover';
  pop.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${rect.left}px;background:var(--W);border:1px solid var(--i6);border-radius:8px;padding:10px 12px;width:260px;max-height:320px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.16);z-index:9999`;
  pop.onclick = e => e.stopPropagation();
  pop.innerHTML = `
    <div style="font-size:11px;color:var(--i4);margin-bottom:8px">섹터 선택 (복수 가능) — 이 기업이 참가한 행사별로 묶여 있어요</div>
    ${groupsHtml || '<div style="font-size:12px;color:var(--i4)">등록된 섹터 없음</div>'}
    <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:10px">
      <button class="btn bs" style="font-size:11px;padding:2px 8px" onclick="closeCoSectorPopover()">취소</button>
      <button class="btn bp" style="font-size:11px;padding:2px 8px" onclick="saveCoSector('${key.replace(/'/g,"\\'")}')">저장</button>
    </div>`;
  document.body.appendChild(pop);
  setTimeout(() => document.addEventListener('mousedown', handleCoSectorOutsideClick), 0);
}

export function saveCoSector(key){
  const pop = document.getElementById('co-sector-popover');
  const checkboxes = pop ? pop.querySelectorAll('input[type=checkbox]:checked') : [];
  const newSectors = [...checkboxes].map(cb => cb.value);
  const c = CO_DB.find(x => x.key === key);
  if(c){
    c.sectors = newSectors;
    c.sector  = newSectors[0] || '';
    const el = document.getElementById('co-sector-' + key);
    if(el) el.textContent = newSectors.join(', ') || '미분류';
    const beatVal = joinSectors(newSectors);
    c.contacts.forEach(ct => {
      const contact = contacts.find(x => x.id === ct.id);
      if(contact){
        contact.beat = beatVal;
        if(GS_URL && currentUser){
          fetch(GS_URL, {
            method:'POST',
            body: JSON.stringify({
              sheet:'contacts', email:currentUser.email, action:'upsert',
              row:[contact.id,contact.nameKo,contact.nameEn,contact.orgKo,contact.orgEn,
                   contact.titleKo,contact.titleEn,contact.deptKo,contact.deptEn,
                   contact.country,contact.cat,contact.lang,contact.source,contact.date,
                   contact.status,contact.email1,contact.email2,contact.phone1,contact.phone2,
                   contact.beat,contact.products]
            })
          }).catch(e=>console.warn('sector 저장 실패:',e));
        }
      }
    });
    upsertCompanyRow(c);
    buildCoCAT();
    renderCoList();
  }
  closeCoSectorPopover();
}

/* ── 카테고리 코드 부여 (prefix 선택 UI) — 원본에서 이미 인라인 방식이었음 (원본 4444~4459행) ── */
export function showAssignCatCodeUI(key){
  const el = document.getElementById('co-catcode-' + key);
  if(!el) return;
  const opts = CATEGORY_CODES.map(cc => `<option value="${cc.code}">${cc.code} · ${escapeHtml(cc.label)}</option>`).join('');
  el.innerHTML = `<select id="co-catcode-sel-${key}" class="fi" style="font-size:11px;padding:2px 6px" onchange="doAssignCatCode('${key.replace(/'/g,"\\'")}')">
    <option value="">prefix 선택</option>${opts}
  </select>`;
}
export function doAssignCatCode(key){
  const c = CO_DB.find(x => x.key === key);
  const sel = document.getElementById('co-catcode-sel-' + key);
  if(!c || !sel || !sel.value) return;
  assignCategoryCode(c, sel.value);
  renderCoDetail(c);
  renderCoList();
}

/* ══════════════════════════════════════════
   기업DB에서 행사 참여 이력 직접 추가 (원본 4461~4552행)
   participations 필드명은 api.js의 normalizeParticipationRow와 동일한
   { eventId, event, contactId, contact, role, note, matched } 형태로 push한다.
══════════════════════════════════════════ */
export function openAddCoEventModal(key){
  const c = CO_DB.find(x => x.key === key);
  if(!c) return;

  const evOpts = EVENT_LIST.length
    ? EVENT_LIST.map(e => `<option value="${e.key}">${escapeHtml(e.short||e.name)} (${e.date||''})</option>`).join('')
    : '<option value="">등록된 행사 없음</option>';
  const contactOpts = c.contacts.length
    ? c.contacts.map(p => `<option value="${p.id}">${escapeHtml(p.name||p.nameEn||'이름없음')}${p.title?(' · '+escapeHtml(p.title)):''}</option>`).join('')
    : '<option value="">담당자 없음</option>';
  const roleOpts = PART_TYPES.map(t => `<option value="${t.key}">${escapeHtml(t.label)}</option>`).join('');

  const html = `
    <div id="co-event-modal" onclick="if(event.target===this)document.getElementById('co-event-modal').remove()"
      style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center">
      <div style="background:var(--W);border-radius:12px;padding:22px;width:360px;box-shadow:0 8px 32px rgba(0,0,0,.18)">
        <div style="font-size:14px;font-weight:700;margin-bottom:4px">📅 행사 참여 이력 추가</div>
        <div style="font-size:11px;color:var(--i4);margin-bottom:14px">${escapeHtml(c.nameKo||c.nameEn)}</div>

        <div class="mlbl">담당자</div>
        <select class="fi" id="co-ev-add-contact" style="width:100%;margin-bottom:10px">${contactOpts}</select>

        <div class="mlbl">행사</div>
        <select class="fi" id="co-ev-add-event" style="width:100%;margin-bottom:10px">${evOpts}</select>

        <div class="mlbl">참가 유형</div>
        <select class="fi" id="co-ev-add-role" style="width:100%;margin-bottom:10px">${roleOpts}</select>

        <div class="mlbl">메모 (선택)</div>
        <input class="fi" id="co-ev-add-note" style="width:100%;margin-bottom:14px" placeholder="예: 부스 A12">

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn bs" onclick="document.getElementById('co-event-modal').remove()">취소</button>
          <button class="btn bp" onclick="submitAddCoEvent('${key.replace(/'/g,"\\'")}')">추가</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

export async function submitAddCoEvent(key){
  const c = CO_DB.find(x => x.key === key);
  if(!c) return;

  const cidEl  = document.getElementById('co-ev-add-contact');
  const evEl   = document.getElementById('co-ev-add-event');
  const roleEl = document.getElementById('co-ev-add-role');
  const noteEl = document.getElementById('co-ev-add-note');

  const cid  = cidEl && cidEl.value ? +cidEl.value : null;
  const evId = evEl ? evEl.value : '';
  const role = roleEl ? roleEl.value : '참가자';
  const note = noteEl ? noteEl.value.trim() : '';

  if(!evId){ alert('행사를 선택하세요. 등록된 행사가 없으면 설정 → 행사 관리에서 먼저 추가해주세요.'); return; }
  if(!cid){ alert('담당자를 선택하세요.'); return; }
  if(participations.some(p => p.contactId === cid && p.eventId === evId && p.role === role)){
    alert('이미 이 담당자는 해당 행사에 같은 참가 유형으로 등록되어 있어요.');
    return;
  }

  const part = {
    id: 'P-' + (Date.now() + Math.floor(Math.random()*100000)),
    eventId: evId, event: evId, contactId: cid, contact: '',
    role, note, matched: '✅ 앱에서 추가',
  };
  participations.push(part);

  if(GS_URL && currentUser){
    try{
      await fetch(GS_URL, {
        method: 'POST',
        body: JSON.stringify({
          sheet: 'participations',
          email: currentUser.email,
          row: [part.id, evId, '', cid, '', '', '', role, note, part.matched],
        }),
      });
    }catch(e){ console.warn('참여 이력 추가 저장 실패:', e); }
  }

  document.getElementById('co-event-modal')?.remove();
  buildCoDB(); buildCoCAT();
  const updated = CO_DB.find(x => x.key === key);
  if(updated){ setSelCo(key); renderCoDetail(updated); }
  try { renderMDB(); buildMDBEvList(); } catch(e){}
  trackAction('status', '행사 참여 추가', c.nameKo||c.nameEn, `<b>${escapeHtml(c.nameKo||c.nameEn)}</b>에 행사 참여 이력을 추가했어요`);
}

/* ══════════════════════════════════════════
   기업 상세 탭 바디 — 행사 참여 이력 / 담당자 / 요약 (원본 4554~4610행)
══════════════════════════════════════════ */
function renderCoBody(c){
  const b=document.getElementById('cotb');
  if(!b || !c) return;
  if(coTab===0)b.innerHTML=renderTL(c);
  else if(coTab===1)b.innerHTML=renderCoCon(c);
  else b.innerHTML=renderCoSum(c);
}
function renderTL(c){
  const addBtn = `<div style="display:flex;justify-content:flex-end;margin-bottom:10px">
    <button class="btn bp" style="font-size:11px" onclick="openAddCoEventModal('${c.key.replace(/'/g,"\\'")}')">+ 참여 이력 추가</button>
  </div>`;
  if(!c.events.length)return addBtn + `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg><p>행사 참여 이력 없음</p></div>`;
  const byY={};c.events.forEach(e=>{if(!byY[e.year])byY[e.year]=[];byY[e.year].push(e)});
  return addBtn + `<div class="tl">${Object.entries(byY).sort((a,b)=>b[0]-a[0]).map(([yr,evs])=>`
    <div class="tlyr">${yr}</div>${evs.map(e=>`
      <div class="tlit"><div class="tldt" style="background:${e.color}"></div>
        <div class="tlc">
          <div class="tltp"><div class="tlev">${escapeHtml(e.name)}</div><div class="tldt2">${escapeHtml(e.date)}</div></div>
          <div class="tlloc">📍 ${escapeHtml(e.loc)}</div>
          <div class="tlpl">${e.roles.map(r=>`<span class="pill ${RP[r]||'p-gray'}">${escapeHtml(r)}</span>`).join('')}</div>
          ${e.people.map(p=>`<div class="tlpe"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>${escapeHtml(p)}</div>`).join('')}
          ${e.note?`<div class="tlno">${escapeHtml(e.note)}</div>`:''}
        </div>
      </div>`).join('')}`).join('')}</div>`;
}
function renderCoCon(c){
  if(!c.contacts.length) return `<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><p>담당자 없음</p></div>`;
  return c.contacts.map(p => {
    const nm = p.name || p.nameEn || '?';
    const av = nm.slice(0,2);
    const evTags = p.events.map(ev => {
      const color = evColor(ev);
      const short = evShort(ev);
      return `<span class="pill" style="background:${color}18;color:${color};border:1px solid ${color}40;font-size:10px">${escapeHtml(short)}</span>`;
    }).join('');
    const catTag = p.cats.map(ct => `<span class="pill ${RP[ct]||'p-gray'}">${escapeHtml(ct)}</span>`).join('');
    // openContactDr은 crm-tab.js(드로어)가 window에 등록하는 함수 — 이 모듈의 책임 범위 밖
    return `<div class="conc" onclick="openContactDr(${p.id})" style="cursor:pointer">
      <div class="conav">${escapeHtml(av)}</div>
      <div style="flex:1;min-width:0">
        <div class="connm">${escapeHtml(nm)}${p.nameEn && p.name ? `<span style="font-size:11px;color:var(--i4);font-weight:400;margin-left:6px">${escapeHtml(p.nameEn)}</span>` : ''}</div>
        <div class="conti">${escapeHtml(p.title||'')}</div>
        <div class="conps" style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px">${evTags}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0">${catTag}</div>
    </div>`;
  }).join('');
}
function renderCoSum(c){
  const rc={};c.events.forEach(e=>e.roles.forEach(r=>{rc[r]=(rc[r]||0)+1}));
  const mx=Math.max(1,...Object.values(rc));
  const bc={'스폰서':'#16A34A','전시기업':'#6D28D9','연사':'#3B5BDB','BD':'#0F766E','참가자':'#9C9890','투자자':'#C97B0A'};
  const yrs=c.events.map(e=>+e.year);
  return`<div class="sg">
    <div class="sc2"><div class="slbl">참여 유형 분포</div>${Object.entries(rc).map(([r,n])=>`<div class="br"><div class="brl">${escapeHtml(r)}</div><div class="brt"><div class="brf" style="width:${Math.round(n/mx*100)}%;background:${bc[r]||'#9C9890'}"></div></div><div class="brv">${n}회</div></div>`).join('')}</div>
    <div class="sc2"><div class="slbl">관계 요약</div><div style="font-size:12px;color:var(--i2);line-height:2.1"><div>🗓 첫 참여 <strong>${yrs.length?Math.min(...yrs):'-'}년</strong></div><div>📅 최근 <strong>${yrs.length?Math.max(...yrs):'-'}년</strong></div><div>🎪 총 <strong>${c.events.length}회</strong></div><div>👤 담당자 <strong>${c.contacts.length}명</strong></div></div></div>
  </div>
  <div class="sc2"><div class="slbl" style="margin-bottom:7px">통합 기업명</div><div style="display:flex;gap:4px;flex-wrap:wrap">${c.branches.map(b=>`<span class="btag${b===c.mainBranch?' main':''}">${escapeHtml(b)}</span>`).join('')}</div></div>`;
}

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
window.setCoCode = setCoCode;
window.searchCo = searchCo;
window.searchCoM = searchCoM;
window.switchCoT = switchCoT;
window.editCoSector = editCoSector;
window.editCoNotes = editCoNotes;
window.editCoWebsite = editCoWebsite;
window.editCoCountry = editCoCountry;
window.editCoAbbr = editCoAbbr;
window.editCoSource = editCoSource;
window.saveCoSector = saveCoSector;
window.closeCoSectorPopover = closeCoSectorPopover;
window.showAssignCatCodeUI = showAssignCatCodeUI;
window.doAssignCatCode = doAssignCatCode;
window.openAddCoEventModal = openAddCoEventModal;
window.submitAddCoEvent = submitAddCoEvent;
window.mergeCompanies = mergeCompanies;
window.mergeCoInto = mergeCompanies;
window.toggleCoColMenu = toggleCoColMenu;
window.toggleCoCol = toggleCoCol;
window.renderSimilarCompanyList = renderSimilarCompanyList;
