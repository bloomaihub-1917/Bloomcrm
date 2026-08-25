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
} from '../state.js';
import { RP, avB, avF } from '../constants.js';
import { escapeHtml, escAttr, levenshteinDist, parseSectorScope, sectorKey, countryName } from '../utils.js';
import { postToSheet } from '../api.js';
import { parseSectors, joinSectors, mainSectors, sectorNamesInDomain, domainName, domainOfSector, UNASSIGNED_DOMAIN } from './settings-tab.js';
import { renderMDB, buildMDBEvList } from './db-tab.js';
import { trackAction } from './audit-tab.js';
import { billedAmount, paidAmount, currencyOf, exhibitorTradeFor, fmtMoney } from './exh-tab.js';

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
export function normalizeCompanyKey(raw){
  if(!raw) return '';
  let s = String(raw).trim();
  s = s.replace(/^(주식회사|㈜|\(주\))\s*/, '').replace(/\s*(주식회사|㈜|\(주\))$/, '');
  s = s.replace(/[\s,\.]*\b(incorporated|inc|co\.?,?\s*(ltd|limited)|ltd|limited|co|llc|llp|corp(oration)?|gmbh|pte\.?\s*ltd|pty\.?\s*ltd|plc)\b\.?\s*$/i, '');
  s = s.replace(/[.,]/g, '').replace(/\s+/g, '').trim().toLowerCase();
  return s;
}

/* 기업 종류 배지 */
export const orgKindOf = (kind) => ORG_KINDS.find(k => k.key === kind) || null;

/* ══════════════════════════════════════════
   buildCoDB — 화면용 기업 뷰를 만든다

   전에는 이 함수가 기업 목록 자체를 만들어냈다(contacts의 소속 문자열을
   정규화해 묶는 방식). 그래서 연락처가 없으면 기업이 사라지고, 이름을 고치면
   다른 회사가 됐다. 이제 기업은 ORGS에 저장된 레코드이고, 이 함수는 거기에
   연락처·행사 참가·전시 거래를 붙여 화면이 쓰기 좋은 모양으로 펼치기만 한다.

   연결은 org_id로 한다. 아직 org_id가 없는 옛 연락처는 이름으로 한 번 더
   맞춰본다 — 마이그레이션 전에 들어온 업로드가 화면에서 통째로 빠지지 않도록.
══════════════════════════════════════════ */
export function buildCoDB(){
  CO_DB.splice(0, CO_DB.length);
  if(!ORGS.length) return;

  /* 연락처를 기업별로 모은다. org_id가 우선, 없으면 이름으로 폴백. */
  const byOrg = new Map();
  ORGS.forEach(o => byOrg.set(o.id, []));
  contacts.forEach(c => {
    let oid = c.org_id;
    if(!oid || !byOrg.has(oid)){
      const o = findOrgByName(c.orgKo || c.orgEn, normalizeCompanyKey);
      oid = o ? o.id : null;
    }
    if(oid && byOrg.has(oid)) byOrg.get(oid).push(c);
  });

  /* 전시 참가도 같은 방식으로 */
  const exhByOrg = new Map();
  EXHIBITORS.forEach(x => {
    let oid = x.org_id;
    if(!oid || !byOrg.has(oid)){
      const o = findOrgByName(x.company_name, normalizeCompanyKey);
      oid = o ? o.id : null;
    }
    if(!oid) return;
    if(!exhByOrg.has(oid)) exhByOrg.set(oid, []);
    exhByOrg.get(oid).push(x);
  });

  ORGS.forEach(o => {
    const coContacts = byOrg.get(o.id) || [];
    const cIds = new Set(coContacts.map(c => c.id));
    const parts = participations.filter(p => cIds.has(p.contactId));

    // ── 행사별 참가 집계 ──
    const evMap = {};
    parts.forEach(p => {
      const ev = EVENT_LIST.find(e => e.key === p.eventId)
        || { key: p.eventId, short: p.eventId, name: p.eventId, color:'#9C9890', date:'' };
      if(!evMap[p.eventId]) evMap[p.eventId] = {
        key: p.eventId,
        name: ev.name || ev.key,
        short: ev.short || ev.key,
        year: (ev.date||'').slice(0,4) || String(new Date().getFullYear()),
        date: ev.date || '', loc: '', color: ev.color || '#9C9890',
        roles: [], people: [], note: '',
      };
      const role = p.role || '참가자';
      if(!evMap[p.eventId].roles.includes(role)) evMap[p.eventId].roles.push(role);
      const c = contacts.find(x => x.id === p.contactId);
      const nm = c ? (c.nameKo || c.nameEn || '') : '';
      if(nm && !evMap[p.eventId].people.includes(nm)) evMap[p.eventId].people.push(nm);
    });

    // ── 전시 거래 — 행사별 부스·청구·입금 ──
    // 전시 탭에만 쌓여 있어 기업 화면에서 안 보이던 값들이다.
    const trade = (exhByOrg.get(o.id) || []).map(x => exhibitorTradeFor(x));
    trade.forEach(t => {
      // 전시로만 참가한 행사도 참가 이력에 나타나게 한다
      if(!evMap[t.eventId]){
        const ev = EVENT_LIST.find(e => e.key === t.eventId)
          || { key: t.eventId, short: t.eventId, name: t.eventId, color:'#9C9890', date:'' };
        evMap[t.eventId] = { key: t.eventId, name: ev.name || ev.key, short: ev.short || ev.key,
          year: (ev.date||'').slice(0,4), date: ev.date || '', loc: '', color: ev.color || '#9C9890',
          roles: ['전시참가기업'], people: [], note: '' };
      }
    });

    const sectors = o.sectors ? parseSectors(o.sectors) : [];
    const name = orgName(o);

    CO_DB.push({
      // key는 화면 곳곳이 기업을 지목할 때 쓰는 값 — 이제 안정 id다.
      // 이름을 고쳐도 선택 상태나 링크가 끊기지 않는다.
      key:      o.id,
      org:      o,
      /* 국문·영문 중 한쪽만 있는 기업이 있다. 빈 칸을 다른 언어 이름으로 채우면
         상세 화면에 같은 이름이 두 번 찍히고, 국문명을 새로 적을 자리도 사라진다.
         비어 있으면 비워 두고, 보여줄 때만 있는 쪽으로 넘어간다(displayName). */
      nameKo:   o.name_ko || '',
      nameEn:   o.name_en || '',
      // 사명이 바뀌면 옛 이름으로 만들어 둔 약어가 남아 아바타가 엉뚱한 글자를
      // 보여준다(압타머사이언스 → 츌립앤사이언스인데 약어는 '압타'). 지금 이름의
      // 앞글자와 맞지 않으면 다시 만든다 — 직접 적어 넣은 약어는 대체로 맞으므로
      // 이름과 어긋날 때만 손댄다.
      abbr:     (o.abbr && name.startsWith(o.abbr[0])) ? o.abbr : abbrOf(name),
      aliases:  String(o.aliases || '').split('\n').filter(Boolean),
      kind:     o.kind || '',
      orgStatus: o.status || '활성',
      sector:   sectors[0] || 'General / Others',
      sectors,
      hq:       o.hq || coContacts.find(c => c.country)?.country || '',
      country:  o.country || '',
      website:  o.website || '',
      bizNo:    o.biz_no || '',
      notes:    o.notes || '',
      catCode:  o.cat_code || '',
      source:   o.source || '',
      updatedAt: o.updated_at || '',
      branches: [...new Set(coContacts.map(c => (c.orgKo || c.orgEn || '').trim()).filter(Boolean))],
      mainBranch: name,
      events:   Object.values(evMap),
      contacts: coContacts.map(c => ({
        id: c.id,
        name: c.nameKo || c.nameEn || '',
        nameEn: c.nameEn || '',
        title: c.titleKo || c.titleEn || '',
        email: c.email1 || '',
        phone: c.phone1 || '',
        cats: [c.cat].filter(Boolean),
        events: participations.filter(p => p.contactId === c.id).map(p => p.eventId),
      })),
      trade,
    });
  });

  CO_DB.sort((a,b) => (a.nameKo||a.nameEn).localeCompare(b.nameKo||b.nameEn));

  try {
    const dashEl = document.getElementById('co-dash');
    if(dashEl && dashEl.style.display !== 'none' && !selCo) renderCoDashboard();
  } catch(e){}
}

/* 저장 시각은 ISO 원문으로 들어온다 — 사람이 읽는 자리엔 날짜만 보여준다 */
const shortDate = (v) => String(v || '').slice(0, 10);

/* 약어 자동 생성 (최대 2자) — 기업에 약어를 안 적었을 때 아바타에 쓴다 */
function abbrOf(nm){
  if(!nm) return '?';
  if(nm.length <= 2) return nm;
  return /[가-힣]/.test(nm) ? nm.slice(0,2)
    : nm.split(/\s+/).map(w => w[0]).join('').slice(0,2).toUpperCase();
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
        <button class="btn bp bs" onclick="mergeCompanies('${escAttr(b.key)}','${escAttr(a.key)}')">"${escapeHtml(a.nameKo||a.nameEn)}"로 합치기</button>
        <button class="btn bp bs" onclick="mergeCompanies('${escAttr(a.key)}','${escAttr(b.key)}')">"${escapeHtml(b.nameKo||b.nameEn)}"로 합치기</button>
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
  const backup = []; // 저장 실패 시 롤백용 (id → 원래 orgKo/orgEn)
  loser.contacts.forEach(pc => {
    const c = contacts.find(x => x.id === pc.id);
    if(!c) return;
    backup.push({ c, orgKo: c.orgKo, orgEn: c.orgEn });
    if(c.orgKo) c.orgKo = winner.nameKo || c.orgKo;
    if(c.orgEn) c.orgEn = winner.nameEn || c.orgEn;
    if(!c.orgKo && winner.nameKo) c.orgKo = winner.nameKo;
    if(!c.orgEn && winner.nameEn) c.orgEn = winner.nameEn;
    changed.push(c);
  });

  if(changed.length){
    const rows = changed.map(c => [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
      c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2, c.beat, c.products, c.tags||'']);
    const r = await postToSheet({ sheet: 'contacts', action: 'batchUpsert', rows }, '기업 병합');
    if(!r.ok){
      // 저장 실패 → 로컬 변경 롤백 (기존엔 실패해도 "합쳤어요"가 떠서 새로고침 시 원복되는 거짓 성공이었음)
      backup.forEach(b => { b.c.orgKo = b.orgKo; b.c.orgEn = b.orgEn; });
      buildCoDB(); buildCoCAT();
      try { renderCoList(); } catch(e){}
      alert('병합 저장에 실패해서 취소했어요. 네트워크 확인 후 다시 시도해주세요.');
      return;
    }
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
function coCatButton(name, cnt, indent, title, arrowHtml){
  const label = parseSectorScope(name).plainName;
  return `<button class="nr${coCatF===name?' on':''}" onclick="setCoCat('${escAttr(name)}') " style="${indent||''}"${title?` title="${title}"`:` title="드래그한 기업을 여기로 놓으면 이 섹터로 이동해요"`}
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
    const secs = c.sectors && c.sectors.length ? c.sectors : [c.sector||'General / Others'];
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
    (c.sectors && c.sectors.length ? c.sectors : [c.sector||'General / Others'])
      .forEach(s => { sectorCounts[s] = (sectorCounts[s]||0) + 1; });
  });

  const html = [`<button class="nr${!coCatF && !coDomainF?' on':''}" onclick="setCoCat(null)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><circle cx="12" cy="12" r="10"/></svg>
      전체<span class="nbg">${CO_DB.length}</span>
    </button>`];

  // 분야 하나의 기업 수 — 하위 전 섹터에 해당하는 기업 key의 Set 크기 (중복 이중 카운트 방지)
  const domainCompanyCount = names => {
    const keys = new Set();
    CO_DB.forEach(c => {
      const secs = c.sectors && c.sectors.length ? c.sectors : [c.sector||'General / Others'];
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
        if(s.parent && inScope(s) && (sectorCounts[s.name]||0) > 0){
          if(!subsByParent[s.parent]) subsByParent[s.parent] = [];
          subsByParent[s.parent].push(s);
        }
      });
      const visibleMains = mainsHere.filter(m => (sectorCounts[m.name]||0) > 0 || subsByParent[m.id]);
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

export function setCoCat(s){
  setCoCatF((coCatF===s)?null:s);
  setCoDomainF(null); // 분야 필터와 상호 배타
  buildCoCAT(); renderCoList();
  // 기업이 선택되어 상세화면을 보는 중이 아니라면, 메인 화면도 필터된 기업 리스트로 갱신
  if(!selCo) renderCoDashboard();
}

/* 분야 전체 필터 (신규) */
export function setCoDomain(id){
  setCoDomainF((coDomainF===id)?null:id);
  setCoCatF(null); // 섹터 필터와 상호 배타
  if(coDomainF) _expandedDomains.add(id); // 필터 걸면 자동 펼침
  buildCoCAT(); renderCoList();
  if(!selCo) renderCoDashboard();
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
      (c.sectors && c.sectors.length ? c.sectors : [c.sector||'General / Others'])
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
  if(!selCo) renderCoDashboard();
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
  // 옛 이름으로도 찾을 수 있어야 한다 — 사명이 바뀐 회사를 옛 이름으로 기억하는 사람이 있다
  if(q){
    const lq = q.toLowerCase();
    list = list.filter(c => [c.nameKo, c.nameEn, c.sector, ...(c.aliases||[])]
      .some(v => v && String(v).toLowerCase().includes(lq)));
  }
  if(coKindF) list = list.filter(c => c.kind === coKindF);
  if(coCatF)list=list.filter(c=>(c.sectors||[c.sector]).some(s=>s===coCatF));
  if(coDomainF){
    const names = coDomainNameSet();
    if(names) list = list.filter(c =>
      (c.sectors && c.sectors.length ? c.sectors : [c.sector||'General / Others']).some(s => names.has(sectorKey(s))));
  }
  if(coCodeF)list=list.filter(c=>c.catCode && c.catCode.startsWith(coCodeF+'-'));
  if(coCountryF)list=list.filter(c=>companyCountryGroup(c)===coCountryF);

  const toggleHtml = renderCoColumnToggleHtml();

  if(!list.length){
    listEl.innerHTML = toggleHtml + (CO_DB.length === 0
      ? '<div style="padding:24px 14px;text-align:center;font-size:11px;color:var(--i4);line-height:1.6">등록된 기업이 없어요<br>위 <b>+ 기업 추가</b>로 직접 등록하거나<br>업로드하면 자동으로 채워져요</div>'
      : '<div style="padding:24px 14px;text-align:center;font-size:11px;color:var(--i4)">검색 결과가 없어요</div>');
    return;
  }

  listEl.innerHTML = toggleHtml + kindFilterHtml() + list.map((c,i)=>`
    <div class="co-rw${selCo===c.key?' on':''}" onclick="selectCo('${escAttr(c.key)}')"
      draggable="true" ondragstart="this.classList.add('co-dragging');onCoDragStart(event,'${escAttr(c.key)}')" ondragend="this.classList.remove('co-dragging')" title="드래그해서 왼쪽 섹터로 이동">
      <div class="co-av" style="background:${avB(i)};color:${avF(i)}">${escapeHtml(c.abbr)}</div>
      <div style="flex:1;min-width:0">
        <div class="co-rn">${escapeHtml(c.nameKo || c.nameEn)}</div>
        ${c.nameKo && c.nameEn ? `<div style="font-size:10px;color:var(--i4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.nameEn)}</div>` : ''}
        <div class="co-rm" style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.sector||'미분류')}</span>
          ${(() => { const t = tradeTotals(c); return t.balance > 0
            // 돈 받을 게 남은 회사는 목록에서 바로 보여야 한다 — 상세로 들어가야만
            // 알 수 있으면 51개를 하나씩 열어봐야 한다
            ? `<span class="pill p-red" style="font-size:9px;padding:1px 5px" title="미수금">${escapeHtml(tradeMoney(t, 'balance'))}</span>`
            : ''; })()}
          ${coVisibleCols.country ? `<span style="font-size:10px;color:var(--i4)">· ${escapeHtml(c.country||'-')}</span>` : ''}
          ${coVisibleCols.website ? `<span style="font-size:10px;color:var(--i4)">· ${c.website?escapeHtml(c.website):'-'}</span>` : ''}
          ${coVisibleCols.notes ? `<span style="font-size:10px;color:var(--i4)">· ${escapeHtml(c.notes||'-')}</span>` : ''}
        </div>
      </div>
      <div class="co-ct">${c.events.length}회</div>
    </div>`).join('');
}
/* 종류 필터 — 전시 참가기업만 볼지, 아직 영업 중인 잠재 고객사만 볼지 고른다 */
let coKindF = '';
export function setCoKind(k){ coKindF = (coKindF === k) ? '' : k; renderCoList(); }

function kindFilterHtml(){
  const cnt = {};
  CO_DB.forEach(c => { if(c.kind) cnt[c.kind] = (cnt[c.kind] || 0) + 1; });
  const used = ORG_KINDS.filter(k => cnt[k.key]);
  if(used.length < 2) return '';   // 종류가 하나뿐이면 필터가 의미 없다
  return `<div style="display:flex;gap:4px;flex-wrap:wrap;padding:7px 12px;border-bottom:1px solid var(--i7)">
    ${used.map(k => `<button class="seg-b${coKindF === k.key ? ' on' : ''}" style="font-size:10.5px;padding:3px 9px"
      onclick="event.stopPropagation();setCoKind('${escAttr(k.key)}')">${escapeHtml(k.label)} ${cnt[k.key]}</button>`).join('')}
  </div>`;
}

/* ── 기업 직접 추가 ──
   전에는 연락처를 넣어야만 기업이 생겼다. 담당자를 아직 모르는 회사를 먼저
   적어둘 수 있어야 영업 대상이나 시공 벤더를 관리할 수 있다. */
export function openAddOrgModal(){
  if(document.getElementById('add-org-modal')) return;
  const el = document.createElement('div');
  el.id = 'add-org-modal';
  el.className = 'mw on';
  el.onclick = (e) => { if(e.target === el) closeAddOrgModal(); };   // 배경 클릭으로 닫기
  el.innerHTML = `<div class="modal" style="max-width:420px">
    <div class="mh"><div class="mt2">기업 추가</div><button class="mc" onclick="closeAddOrgModal()">✕</button></div>
    <div class="mb">
      <div style="font-size:11.5px;color:var(--i4);margin-bottom:12px;line-height:1.6">
        담당자를 아직 몰라도 기업을 먼저 등록할 수 있어요. 나중에 연락처를 넣으면 자동으로 이어집니다.</div>
      <div class="fg"><label class="fl">기업명 (국문)</label><input class="fi" id="ao-nameKo" placeholder="예: 스튜디오블룸"></div>
      <div class="fg"><label class="fl">기업명 (영문)</label><input class="fi" id="ao-nameEn" placeholder="예: Studio Bloom"></div>
      <div class="fg"><label class="fl">종류</label>
        <select class="fi" id="ao-kind">${ORG_KINDS.map(k =>
          `<option value="${escAttr(k.key)}"${k.key === '잠재고객사' ? ' selected' : ''}>${escapeHtml(k.label)}</option>`).join('')}</select></div>
      <div class="fg"><label class="fl">국가</label><input class="fi" id="ao-country" placeholder="예: 대한민국"></div>
      <div class="fg"><label class="fl">웹사이트</label><input class="fi" id="ao-website" placeholder="https://"></div>
      <div class="fg"><label class="fl">사업자등록번호</label><input class="fi" id="ao-bizNo" placeholder="000-00-00000"></div>
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

  const r = await createOrg({
    nameKo: v('ao-nameKo'), nameEn: v('ao-nameEn'), kind: v('ao-kind'),
    country: v('ao-country'), website: v('ao-website'), bizNo: v('ao-bizNo'), notes: v('ao-notes'),
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
  setSelCo(null); setCoCatF(null); setCoCodeF(null); setCoDomainF(null); setCoCountryF(null);
  renderCoList(); buildCoCAT(); buildCoCodeF(); buildCoCountryF();
  const cdtEl = document.getElementById('cdt'); if(cdtEl) cdtEl.style.display='none';
  const dashEl = document.getElementById('co-dash'); if(dashEl) dashEl.style.display='block';
  renderCoDashboard();
}

function computeSectorDashboard(list){
  const src = list || CO_DB;
  const mains = mainSectors();
  const groups = mains.map(m => ({ name:m.name, companies:new Set(), subs:{} }));
  // sectorKey(정규화된 소문자 키)로 조회해야 기업 데이터의 원본 텍스트가
  // 등록 섹터명과 대소문자만 다른 경우("Synthetic Drugs" vs "Synthetic drugs")에도
  // 같은 섹터로 인식된다 — byName/subParentName 모두 이 키로 색인.
  const byName = {}; groups.forEach(g => byName[sectorKey(g.name)]=g);
  const subParentName = {};
  COMPANY_SECTORS.forEach(s => {
    if(s.parent){ const p = COMPANY_SECTORS.find(x=>x.id===s.parent); if(p) subParentName[sectorKey(s.name)]=p.name; }
  });

  src.forEach(c => {
    const secs = (c.sectors && c.sectors.length) ? c.sectors : [c.sector || 'General / Others'];
    secs.forEach(secName => {
      const parentName = subParentName[sectorKey(secName)];
      const mName  = parentName || secName;
      const subName = parentName ? secName : null;
      const mKey = sectorKey(mName);
      let g = byName[mKey];
      if(!g){ g = { name: mName, companies: new Set(), subs: {} }; byName[mKey]=g; groups.push(g); }
      g.companies.add(c.key);
      if(subName){
        const subKey = sectorKey(subName);
        if(!g.subs[subKey]) g.subs[subKey] = { name: subName, set: new Set() };
        g.subs[subKey].set.add(c.key);
      }
    });
  });

  return groups
    .map(g => ({
      name: g.name,
      count: g.companies.size,
      subs: Object.values(g.subs)
        .map(({ name, set }) => ({ name, count: set.size }))
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

  // 국내/해외 필터가 걸려 있으면 이후 모든 집계·리스트의 기준 모집단을 좁힌다
  const baseCoDb = coCountryF ? CO_DB.filter(c => companyCountryGroup(c) === coCountryF) : CO_DB;

  // 분야가 선택되어 있으면 그 분야 하위 전체 섹터의 기업 리스트를 보여줌
  if(coDomainF){
    const names = coDomainNameSet() || new Set();
    const list = baseCoDb.filter(c =>
      (c.sectors&&c.sectors.length?c.sectors:[c.sector||'General / Others']).some(s=>names.has(sectorKey(s))));
    const label = domainName(coDomainF);
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <button onclick="setCoDomain('${escAttr(coDomainF)}')" style="background:none;border:none;cursor:pointer;color:var(--i3);font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;padding:0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          전체 섹터 보기
        </button>
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--i1);margin-bottom:2px">🗂 ${escapeHtml(label)} <span style="font-weight:400;color:var(--i4);font-size:12px">${list.length}개 기업</span></div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:12px">
        ${list.length ? list.map((c,i) => `
          <div class="co-rw" onclick="selectCo('${escAttr(c.key)}')"
            draggable="true" ondragstart="this.classList.add('co-dragging');onCoDragStart(event,'${escAttr(c.key)}')" ondragend="this.classList.remove('co-dragging')" title="드래그해서 왼쪽 섹터로 이동"
            style="cursor:pointer;border:1px solid var(--i6);border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:10px;background:var(--W)">
            <div class="co-av" style="background:${avB(i)};color:${avF(i)}">${escapeHtml(c.abbr)}</div>
            <div style="flex:1;min-width:0">
              <div class="co-rn">${escapeHtml(c.nameKo||c.nameEn)}</div>
              <div style="font-size:11px;color:var(--i4)">${escapeHtml((c.sectors||[c.sector]).join(', ')||'미분류')}</div>
            </div>
            <div class="co-ct">${c.events.length}회</div>
          </div>`).join('') : `<div style="font-size:12px;color:var(--i4)">해당 분야의 기업이 없어요</div>`}
      </div>`;
    return;
  }

  // 섹터가 선택되어 있으면 메인 화면도 그 섹터의 기업 리스트로 보여줌 (카드 그리드 대신)
  if(coCatF){
    const list = baseCoDb.filter(c => (c.sectors&&c.sectors.length?c.sectors:[c.sector]).some(s=>s===coCatF));
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <button onclick="setCoCat('${escAttr(coCatF)}')" style="background:none;border:none;cursor:pointer;color:var(--i3);font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;padding:0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          전체 섹터 보기
        </button>
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--i1);margin-bottom:2px">🏭 ${escapeHtml(coCatF)} <span style="font-weight:400;color:var(--i4);font-size:12px">${list.length}개 기업</span></div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:12px">
        ${list.length ? list.map((c,i) => `
          <div class="co-rw" onclick="selectCo('${escAttr(c.key)}')"
            draggable="true" ondragstart="this.classList.add('co-dragging');onCoDragStart(event,'${escAttr(c.key)}')" ondragend="this.classList.remove('co-dragging')" title="드래그해서 왼쪽 섹터로 이동"
            style="cursor:pointer;border:1px solid var(--i6);border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:10px;background:var(--W)">
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

  const data = computeSectorDashboard(baseCoDb);
  const totalCo = baseCoDb.length;

  const sectorCardHtml = g => `
    <div class="astep" style="padding:14px 15px;cursor:pointer" onclick="setCoCat('${escAttr(g.name)}')">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">
        <div class="sttl" style="margin:0">${escapeHtml(g.name)}</div>
        <div style="font-size:18px;font-weight:800;color:var(--a)">${g.count}<span style="font-size:10px;font-weight:600;color:var(--i4)">개사</span></div>
      </div>
      ${g.subs.length ? `<div style="display:flex;flex-direction:column;gap:5px">
        ${g.subs.map(s => `
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:var(--i3)" onclick="event.stopPropagation();setCoCat('${escAttr(s.name)}')">
            <span>↳ ${escapeHtml(s.name)}</span>
            <span style="font-weight:700;color:var(--i2)">${s.count}개사</span>
          </div>`).join('')}
      </div>` : `<div style="font-size:11px;color:var(--i4)">서브섹터 없음</div>`}
    </div>`;

  // 분야 그룹 헤더의 "N개사"는 그 그룹에 속한 메인+서브 섹터 이름들 중 하나라도
  // 태그된 "고유 기업 수"여야 한다 — 예전엔 카드별 count를 그냥 합산해서, 한
  // 기업이 같은 분야 안의 섹터 여러 개(예: Pharma + Investor 둘 다 BIO)에
  // 태그돼 있으면 두 번 카운트되어 사이드바 트리의 고유 카운트와 숫자가
  // 어긋났다. 그룹에 속한 이름 전체를 모아 기업 key 기준으로 중복 제거한다.
  const uniqueCoCountForGroup = items => {
    const nameKeys = new Set();
    items.forEach(it => {
      nameKeys.add(sectorKey(it.name));
      (it.subs||[]).forEach(s => nameKeys.add(sectorKey(s.name)));
    });
    const keys = new Set();
    baseCoDb.forEach(c => {
      const secs = c.sectors && c.sectors.length ? c.sectors : [c.sector||'General / Others'];
      if(secs.some(s => nameKeys.has(sectorKey(s)))) keys.add(c.key);
    });
    return keys.size;
  };

  // 메인 섹터명 → 섹터 객체 (분야 조회용). 미등록 섹터명(레거시 c.sector 값 등)은
  // 대응하는 객체가 없어 도메인을 알 수 없으므로 미분류로 취급한다.
  const mainByName = {};
  mainSectors().forEach(m => { mainByName[m.name] = m; });

  // 한 섹터가 여러 분야에 속할 수 있어(예: Investor = BIO + VC), 같은 섹터
  // 카드가 해당하는 모든 분야 그룹에 반복해서 나타난다.
  const domainGroups = [];
  DOMAINS.forEach(d => {
    const items = data.filter(g => {
      const m = mainByName[g.name];
      return m && domainOfSector(m).includes(d.id);
    });
    if(items.length) domainGroups.push({ title: d.name, items });
  });
  const unassigned = data.filter(g => {
    const m = mainByName[g.name];
    return !m || !domainOfSector(m).length;
  });
  if(unassigned.length) domainGroups.push({ title: '미분류', items: unassigned });

  el.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:var(--i1);margin-bottom:2px">섹터별 기업 대시보드</div>
    <div style="font-size:11px;color:var(--i4);margin-bottom:16px">${coCountryF ? {domestic:'국내',overseas:'해외',unknown:'미확인'}[coCountryF] : '전체'} ${totalCo}개 기업 · 클릭하면 해당 섹터의 기업 리스트가 보여요</div>
    ${domainGroups.map(dg => `
      <div style="font-size:11px;font-weight:700;color:var(--i3);margin:14px 0 6px;text-transform:uppercase;letter-spacing:.4px">
        🗂 ${escapeHtml(dg.title)} <span style="font-weight:400;color:var(--i4)">(${uniqueCoCountForGroup(dg.items)}개사)</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
        ${dg.items.map(sectorCardHtml).join('')}
      </div>
    `).join('')}`;
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
      <div style="flex:1"><div class="cdn">
          <span id="co-nameKo-${escapeHtml(c.key)}" style="cursor:pointer${c.nameKo ? '' : ';color:var(--i5);font-weight:400;font-size:13px'}" onclick="editCoNameKo('${escAttr(c.key)}')" title="클릭하여 회사명(국문) 편집">${escapeHtml(c.nameKo || '국문명 추가')}</span>
          <span style="font-size:${c.nameKo ? '13px' : '17px'};font-weight:${c.nameKo ? '400' : '800'};color:var(--${c.nameKo ? 'i4' : 'i0'});cursor:pointer" id="co-nameEn-${escapeHtml(c.key)}" onclick="editCoNameEn('${escAttr(c.key)}')" title="클릭하여 회사명(영문) 편집">${escapeHtml(c.nameEn || (c.nameKo ? '' : ''))}</span>
        </div>
        <div class="cdmt">
          ${(() => { const k = orgKindOf(c.kind); return k
            ? `<span class="pill ${k.cls}" style="cursor:pointer" onclick="editCoKind('${escAttr(c.key)}')" title="클릭하여 기업 종류 변경">${escapeHtml(k.label)} ✎</span>`
            : `<span class="pill p-gray" style="cursor:pointer" onclick="editCoKind('${escAttr(c.key)}')">종류 지정 ✎</span>`; })()}
          ${c.aliases.length
            // 사명이 바뀐 회사는 옛 이름으로 찾는 사람이 있다 — 여기 남겨두면 헛걸음하지 않는다
            ? `<span style="color:var(--i4);font-size:11px" title="예전 이름 — 이 이름으로도 검색됩니다">↩ ${escapeHtml(c.aliases.join(', '))}</span>`
            : ''}
          <span>📍 ${escapeHtml(c.hq)}</span>
          <span style="cursor:pointer" onclick="editCoSector('${escAttr(c.key)}')" title="클릭하여 섹터 변경">
            🏭 <span id="co-sector-${escapeHtml(c.key)}">${escapeHtml(c.sector||'미분류')}</span> ✎
          </span>
          <span style="cursor:pointer" onclick="editCoWebsite('${escAttr(c.key)}')" title="클릭하여 웹사이트 편집">
            🔗 <span id="co-website-${escapeHtml(c.key)}">${c.website ? `<a href="${escapeHtml(c.website)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(c.website)}</a>` : '웹사이트 추가'}</span> ✎
          </span>
          <span style="cursor:pointer" onclick="editCoNotes('${escAttr(c.key)}')" title="클릭하여 메모 편집">
            📝 <span id="co-notes-${escapeHtml(c.key)}">${escapeHtml(c.notes||'메모 추가')}</span> ✎
          </span>
          <span style="cursor:pointer" onclick="editCoCountry('${escAttr(c.key)}')" title="클릭하여 국가 편집">
            🌍 <span id="co-country-${escapeHtml(c.key)}">${escapeHtml(c.country||'국가 추가')}</span> ✎
          </span>
          <span style="cursor:pointer" onclick="editCoAbbr('${escAttr(c.key)}')" title="클릭하여 약어 편집">
            🔤 <span id="co-abbr-${escapeHtml(c.key)}">${escapeHtml(c.abbr||'약어 추가')}</span> ✎
          </span>
          <span style="cursor:pointer" onclick="editCoSource('${escAttr(c.key)}')" title="클릭하여 출처 편집">
            📌 <span id="co-source-${escapeHtml(c.key)}">${escapeHtml(c.source||'출처 추가')}</span> ✎
          </span>
          <span style="cursor:pointer" onclick="editCoBizNo('${escAttr(c.key)}')" title="클릭하여 사업자등록번호 편집">
            🧾 <span id="co-bizNo-${escapeHtml(c.key)}">${escapeHtml(c.bizNo||'사업자번호 추가')}</span> ✎
          </span>
          <span id="co-catcode-${escapeHtml(c.key)}">
            ${c.catCode
              ? `<span class="btag main">${escapeHtml(c.catCode)}</span>`
              : `<button class="btn bs" style="font-size:11px;padding:2px 8px" onclick="showAssignCatCodeUI('${escAttr(c.key)}')">코드 부여</button>`}
          </span>
          <span style="color:var(--i4);font-size:11px" title="${escAttr(c.updatedAt || '')}">🕒 ${escapeHtml(shortDate(c.updatedAt) || '-')}</span>
        </div>
      </div>
    </div>
    <div class="cost">
      <div class="cosi"><div class="cosn">${c.events.length}</div><div class="cosl">총 참여 행사</div></div>
      <div class="cosi"><div class="cosn">${c.contacts.length}</div><div class="cosl">등록 담당자</div></div>
      <div class="cosi"><div class="cosn">${yrs.length?Math.min(...yrs):'-'}</div><div class="cosl">첫 참여</div></div>
      ${(() => { const t = tradeTotals(c); return t.billed || t.balance
        ? `<div class="cosi"><div class="cosn" style="font-size:15px">${tradeMoney(t, 'billed')}</div><div class="cosl">누적 청구</div></div>
           <div class="cosi"><div class="cosn" style="font-size:15px;color:${t.balance > 0 ? 'var(--re)' : 'var(--ge)'}">${tradeMoney(t, 'balance')}</div><div class="cosl">미수금</div></div>`
        : ''; })()}
      <div class="cosi"><div class="cosn" style="display:flex;gap:3px;flex-wrap:wrap">${roles.map(r=>`<span class="pill ${RP[r]||'p-gray'}" title="${escapeHtml([...roleEvMap[r]].join(', '))}">${escapeHtml(r)}</span>`).join('')}</div><div class="cosl">유형</div></div>
    </div>
    <div class="cobr">${c.branches.map(b=>`<span class="btag${b===c.mainBranch?' main':''}">${escapeHtml(b)}</span>`).join('')}</div>`;
  const tabs=['행사 참여 이력','거래','담당자','요약'];
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
   기업 저장 — orgs 테이블

   전에는 companies 시트에 "정규화된 이름"을 키로 저장했다. 이름을 고치면 키가
   바뀌어 옛 키의 값이 고아가 됐다(실제로 그렇게 섹터·메모를 잃은 적이 있다).
   이제 id로 저장하므로 이름은 그냥 하나의 필드다.

   부분 저장(data)을 쓴다 — 섹터만 고칠 때 메모까지 함께 실어 보내지 않으므로,
   두 화면에서 동시에 다른 필드를 고쳐도 서로를 덮어쓰지 않는다.
══════════════════════════════════════════ */
const ORG_FIELDS = {
  nameKo:'name_ko', nameEn:'name_en', abbr:'abbr', kind:'kind', orgStatus:'status',
  country:'country', hq:'hq', website:'website', bizNo:'biz_no', catCode:'cat_code',
  notes:'notes', source:'source',
};

/* 화면용 기업 객체(c)에서 바뀐 필드만 서버 컬럼명으로 옮겨 담는다.
   fields를 주면 그 필드만, 안 주면 전부 보낸다. */
function orgPatch(c, fields){
  const patch = { id: c.key, updated_at: new Date().toISOString() };
  const keys = fields || Object.keys(ORG_FIELDS);
  keys.forEach(k => { if(ORG_FIELDS[k]) patch[ORG_FIELDS[k]] = c[k] || ''; });
  if(!fields || fields.includes('sectors')) patch.sectors = joinSectors(c.sectors || []);
  if(!fields || fields.includes('aliases')) patch.aliases = (c.aliases || []).join('\n');
  return patch;
}

/* 로컬 ORGS 레코드도 함께 맞춰둔다 — 다음 buildCoDB가 이걸 읽는다 */
function applyOrgLocal(patch){
  const o = getOrgById(patch.id);
  if(o) Object.assign(o, patch);
}

export async function upsertCompanyRow(c, fields){
  const patch = orgPatch(c, fields);
  applyOrgLocal(patch);
  c.updatedAt = patch.updated_at;
  return postToSheet({ sheet: 'orgs', action: 'upsert', data: patch }, '기업 정보 저장');
}

/* 여러 기업을 한 번에 저장 — 업로드 직후처럼 수십~수백 개를 저장할 때
   기업마다 개별 POST를 보내면 요청이 몰려 일부가 실패한다. 한 번으로 묶는다. */
export async function batchUpsertCompanies(companies){
  if(!companies.length) return;
  const rows = companies.map(c => { const p = orgPatch(c); applyOrgLocal(p); c.updatedAt = p.updated_at; return p; });
  return postToSheet({ sheet: 'orgs', action: 'batchUpsert', dataRows: rows }, '기업 일괄 저장');
}

/* ── 업로드가 데려온 새 기업을 등록한다 ──
   전에는 기업이 연락처 소속 문자열에서 파생됐기 때문에, 업로드하면 기업이
   저절로 "생겼다". 이제 기업은 저장된 레코드라 없으면 만들어 줘야 한다.
   만들지 않으면 연락처만 들어오고 기업DB에서는 통째로 빠져 보인다.

   이름(옛 이름 포함)으로 먼저 찾아보고 없는 것만 만든다 — 같은 회사가 표기만
   다르게 두 번 등록되는 걸 막는다. id는 서버가 만들어 주므로 저장 후 다시
   읽어와 이름 → id 표를 돌려준다. */
export async function ensureOrgsForNames(names, kind){
  const table = new Map();   // 정규화 이름 → org id
  const missing = new Map(); // 정규화 이름 → 원문(대표 표기)

  (names || []).forEach(raw => {
    const t = String(raw || '').trim();
    if(!t) return;
    const k = normalizeCompanyKey(t) || t.toLowerCase();
    if(table.has(k) || missing.has(k)) return;
    const found = findOrgByName(t, normalizeCompanyKey);
    if(found) table.set(k, found.id);
    else missing.set(k, t);
  });

  if(missing.size){
    const now = new Date().toISOString();
    const rows = [...missing.values()].map(nm => ({
      name_ko: /[가-힣]/.test(nm) ? nm : '', name_en: /[가-힣]/.test(nm) ? '' : nm,
      abbr: abbrOf(nm), aliases: '',
      kind: kind || '잠재고객사', status: '활성',
      sectors: '', country: '', hq: '', website: '', biz_no: '', cat_code: '',
      notes: '', source: '업로드', created_at: now, updated_at: now,
    }));
    const r = await postToSheet({ sheet: 'orgs', action: 'batchUpsert', dataRows: rows }, '신규 기업 등록');
    if(!r.ok) return { ok: false, table };
    await reloadOrgs();
    missing.forEach((nm, k) => {
      const o = findOrgByName(nm, normalizeCompanyKey);
      if(o) table.set(k, o.id);
    });
  }
  return { ok: true, table, created: missing.size };
}

/* 저장 직후 서버가 만든 id를 받아오려면 다시 읽어야 한다 */
export async function reloadOrgs(){
  if(!API_BASE_URL || !currentUser) return;
  const { safeFetch, authHeaders } = await import('../api.js');
  const rows = await safeFetch(API_BASE_URL + '/api/data?sheet=orgs', 'orgs', 1, await authHeaders());
  if(Array.isArray(rows)) ORGS.splice(0, ORGS.length, ...rows);
}

/* 연락처의 소속 이름으로 org id를 찾아준다 — 업로드/수동 추가가 함께 쓴다 */
export function orgIdForName(name){
  const o = findOrgByName(name, normalizeCompanyKey);
  return o ? o.id : '';
}

/* ── 기업 신규 등록 ──
   전에는 기업이 연락처에서 파생됐기 때문에, 담당자를 모르는 회사는 등록할 방법이
   아예 없었다. 잠재 고객사나 시공 벤더를 먼저 적어두고 나중에 사람을 붙일 수 있게
   한다. 이름이 같은 기업(옛 이름 포함)이 이미 있으면 새로 만들지 않고 알린다. */
export async function createOrg({ nameKo, nameEn, kind, sectors, country, website, bizNo, notes }){
  const name = (nameKo || nameEn || '').trim();
  if(!name) return { ok: false, error: '기업명을 입력해주세요.' };

  const dup = findOrgByName(name, normalizeCompanyKey);
  if(dup) return { ok: false, error: `이미 등록된 기업이에요 — ${orgName(dup)}`, org: dup };

  const now = new Date().toISOString();
  const rec = {
    name_ko: nameKo || '', name_en: nameEn || '', abbr: abbrOf(name), aliases: '',
    kind: kind || '잠재고객사', status: '활성',
    sectors: joinSectors(sectors || []), country: country || '', hq: country || '',
    website: website || '', biz_no: bizNo || '', cat_code: '', notes: notes || '',
    source: '수동 등록', created_at: now, updated_at: now,
  };
  const r = await postToSheet({ sheet: 'orgs', action: 'upsert', data: rec }, '기업 등록');
  if(!r.ok) return { ok: false, error: '저장에 실패했어요.' };

  ORGS.push({ id: r.id, ...rec });
  buildCoDB(); buildCoCAT(); renderCoList();
  trackAction('add', '기업 등록', name, `<b>${escapeHtml(name)}</b> 등록`);
  return { ok: true, id: r.id };
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
  nameKo:  { placeholder: '회사명(국문)',                       multiline: false, empty: '국문명 추가' },
  nameEn:  { placeholder: '회사명(영문)',                       multiline: false, empty: '영문명 추가' },
  // 세금계산서를 끊을 때 필요한데 지금까지 적어둘 곳이 없어 메모에 섞여 있었다
  bizNo:   { placeholder: '000-00-00000',                     multiline: false, empty: '사업자번호 추가' },
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
  const before = c[field] || '';
  c[field] = rawValue.trim();

  /* 사명이 바뀌면 옛 이름을 남긴다. 이름은 더 이상 식별자가 아니라 데이터가
     끊기지는 않지만, 옛 이름으로 찾는 사람과 옛 이름으로 들어오는 업로드가
     있다 — alias에 있어야 같은 회사로 이어진다. */
  const fields = [field];
  if((field === 'nameKo' || field === 'nameEn') && before && before !== c[field]){
    if(!c.aliases.includes(before)){ c.aliases = [...c.aliases, before]; fields.push('aliases'); }
  }
  await upsertCompanyRow(c, fields);
  renderCoFieldDisplay(key, field);
  if(field === 'abbr' || field === 'nameKo' || field === 'nameEn'){
    // 약어/회사명은 아바타·리스트·상세 헤더 등 여러 곳에 함께 쓰여서 저장 후 다시 그린다
    renderCoDetail(c);
    renderCoList();
  }
  if(field === 'nameKo' || field === 'nameEn'){
    // 기업 이름만 바꾸고 끝나면 마스터DB는 연락처 원본 orgKo/orgEn을 그대로
    // 보여주는 화면이라 반영이 안 된 것처럼 보인다 — mergeCompanies와 동일하게
    // 소속 연락처 전원의 org 필드도 함께 갱신한다.
    const orgField = field === 'nameKo' ? 'orgKo' : 'orgEn';
    const changed = [];
    (c.contacts||[]).forEach(cc => {
      const contact = contacts.find(x => x.id === cc.id);
      if(contact && contact[orgField] !== c[field]){
        contact[orgField] = c[field];
        changed.push(contact);
      }
    });
    if(changed.length){
      await postToSheet({
        sheet: 'contacts', action: 'batchUpsert',
        rows: changed.map(ct => [ct.id,ct.nameKo,ct.nameEn,ct.orgKo,ct.orgEn,ct.titleKo,ct.titleEn,ct.deptKo,ct.deptEn,
          ct.country,ct.cat,ct.lang,ct.source,ct.date,ct.status,ct.email1,ct.email2,ct.phone1,ct.phone2,
          ct.beat,ct.products,ct.tags||'']),
      }, '기업명 변경 - 연락처 반영');
      try { renderMDB(); } catch(e){}
    }
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
  span.innerHTML = `<${tag} class="fi" id="co-inline-input-${field}-${escapeHtml(key)}" style="${sizeStyle}" placeholder="${escapeHtml(cfg.placeholder)}"></${tag}>`;
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

export function editCoNameKo(key){ startCoInlineEdit(key, 'nameKo'); }
export function editCoNameEn(key){ startCoInlineEdit(key, 'nameEn'); }
export function editCoNotes(key){ startCoInlineEdit(key, 'notes'); }
export function editCoWebsite(key){ startCoInlineEdit(key, 'website'); }
export function editCoCountry(key){ startCoInlineEdit(key, 'country'); }
export function editCoAbbr(key){ startCoInlineEdit(key, 'abbr'); }
export function editCoSource(key){ startCoInlineEdit(key, 'source'); }
export function editCoBizNo(key){ startCoInlineEdit(key, 'bizNo'); }

/* ── 기업 종류 ──
   무엇을 관리하는 회사인지에 따라 화면에서 다르게 다룬다. 값이 셋뿐이라
   팝오버 대신 그 자리에서 순환시킨다 — 누를 때마다 다음 종류로 넘어간다. */
export async function editCoKind(key){
  const c = CO_DB.find(x => x.key === key);
  if(!c) return;
  const i = ORG_KINDS.findIndex(k => k.key === c.kind);
  const next = ORG_KINDS[(i + 1) % ORG_KINDS.length];
  const before = c.kind;
  c.kind = next.key;
  renderCoDetail(c);
  const r = await upsertCompanyRow(c, ['kind']);
  if(!r || !r.ok){
    c.kind = before;
    renderCoDetail(c);
    alert('기업 종류 저장에 실패했어요.');
    return;
  }
  trackAction('edit', '기업 종류 변경', c.nameKo || c.nameEn,
    `<b>${escapeHtml(c.nameKo || c.nameEn)}</b> 종류 ${escapeHtml(orgKindOf(before)?.label || '없음')} → ${escapeHtml(next.label)}`);
  renderCoList();
}

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
      <button class="btn bp" style="font-size:11px;padding:2px 8px" onclick="saveCoSector('${escAttr(key)}')">저장</button>
    </div>`;
  document.body.appendChild(pop);
  setTimeout(() => document.addEventListener('mousedown', handleCoSectorOutsideClick), 0);
}

/* 기업의 섹터 배열을 교체하고 연락처 beat/companies 시트에 반영 — 섹터 선택
   팝오버 저장과 드래그&드롭 이동이 이 로직을 공유한다. */
function applyCoSectors(c, newSectors){
  c.sectors = newSectors;
  c.sector  = newSectors[0] || '';
  const el = document.getElementById('co-sector-' + c.key);
  if(el) el.textContent = newSectors.join(', ') || '미분류';
  const beatVal = joinSectors(newSectors);
  // ⚠ 수정: 기존엔 소속 연락처 전원에게 개별 POST를 병렬 발사해서
  // (연락처 100명이면 100개 동시 요청) Apps Script 과부하로 일부만
  // 성공하는 불일치가 있었다 — batchUpsert 한 번으로 묶는다.
  const changedContacts = [];
  c.contacts.forEach(ct => {
    const contact = contacts.find(x => x.id === ct.id);
    if(contact){
      contact.beat = beatVal;
      changedContacts.push(contact);
    }
  });
  if(changedContacts.length){
    postToSheet({
      sheet: 'contacts',
      action: 'batchUpsert',
      rows: changedContacts.map(ct2 => [ct2.id,ct2.nameKo,ct2.nameEn,ct2.orgKo,ct2.orgEn,
        ct2.titleKo,ct2.titleEn,ct2.deptKo,ct2.deptEn,
        ct2.country,ct2.cat,ct2.lang,ct2.source,ct2.date,
        ct2.status,ct2.email1,ct2.email2,ct2.phone1,ct2.phone2,
        ct2.beat,ct2.products,ct2.tags||'']),
    }, '기업 섹터 반영');
  }
  upsertCompanyRow(c);
}

export function saveCoSector(key){
  const pop = document.getElementById('co-sector-popover');
  const checkboxes = pop ? pop.querySelectorAll('input[type=checkbox]:checked') : [];
  const newSectors = [...checkboxes].map(cb => cb.value);
  const c = CO_DB.find(x => x.key === key);
  if(c){
    applyCoSectors(c, newSectors);
    buildCoCAT();
    renderCoList();
  }
  closeCoSectorPopover();
}

/* ══════════════════════════════════════════
   기업 리스트 → 사이드바 섹터로 드래그&드롭 이동 (신규)
   드래그한 기업의 섹터를 드롭한 섹터 하나로 통째로 교체한다("이동" 의미 —
   기존에 여러 섹터가 있었어도 드롭한 섹터 하나로 대체됨).
══════════════════════════════════════════ */
let _draggedCoKey = null;
export function onCoDragStart(e, key){
  _draggedCoKey = key;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', key); // Firefox 등에서 드래그 시작 요건 충족용
}
export function onCoDropToSector(e, sectorName){
  e.preventDefault();
  const key = _draggedCoKey;
  _draggedCoKey = null;
  if(!key || !sectorName) return;
  const c = CO_DB.find(x => x.key === key);
  if(!c) return;
  applyCoSectors(c, [sectorName]);
  trackAction('edit', '기업 섹터 이동(드래그)', c.nameKo||c.nameEn,
    `"${c.nameKo||c.nameEn}" 섹터를 드래그해서 "${parseSectorScope(sectorName).plainName}"(으)로 변경`);
  buildCoCAT();
  renderCoList();
  if(selCo === key) renderCoDetail(c);
  if(!selCo) renderCoDashboard();
}

/* ── 카테고리 코드 부여 (prefix 선택 UI) — 원본에서 이미 인라인 방식이었음 (원본 4444~4459행) ── */
export function showAssignCatCodeUI(key){
  const el = document.getElementById('co-catcode-' + key);
  if(!el) return;
  const opts = CATEGORY_CODES.map(cc => `<option value="${cc.code}">${cc.code} · ${escapeHtml(cc.label)}</option>`).join('');
  el.innerHTML = `<select id="co-catcode-sel-${escapeHtml(key)}" class="fi" style="font-size:11px;padding:2px 6px" onchange="doAssignCatCode('${escAttr(key)}')">
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
          <button class="btn bp" onclick="submitAddCoEvent('${escAttr(key)}')">추가</button>
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
    id: 'P-' + Date.now() + '-' + Math.floor(Math.random()*1000),
    eventId: evId, event: evId, contactId: cid, contact: '',
    role, note, matched: '✅ 앱에서 추가',
  };
  participations.push(part);

  const r = await postToSheet({
    sheet: 'participations',
    row: [part.id, evId, '', cid, '', '', '', role, note, part.matched],
  }, '참여 이력 추가');
  if(!r.ok){ // 저장 실패 → 방금 추가한 참여 기록 롤백
    const idx = participations.findIndex(p => p.id === part.id);
    if(idx >= 0) participations.splice(idx, 1);
    return;
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
  else if(coTab===1)b.innerHTML=renderCoTrade(c);
  else if(coTab===2)b.innerHTML=renderCoCon(c);
  else b.innerHTML=renderCoSum(c);
}
/* ══════════════════════════════════════════
   거래 — 전시에 쌓인 부스·청구·입금을 기업 관점에서 본다

   같은 값이 전시 탭에도 있지만 거기서는 "이번 행사의 51개사"를 보는 화면이라,
   "이 회사와 그동안 얼마나 거래했나"는 알 수 없었다. 판정과 금액은 전부
   exhibitorTradeFor(→ settleState)에서 오므로 두 탭이 다른 숫자를 말하지 않는다.
══════════════════════════════════════════ */

/* 통화가 섞이면 합산이 거짓말이 된다 — 통화별로 따로 더하고 표시도 나눠 적는다 */
export function tradeTotals(c){
  const by = {};
  (c.trade || []).filter(t => !t.cancelled).forEach(t => {
    const k = t.cur || 'KRW';
    if(!by[k]) by[k] = { billed: 0, paid: 0, balance: 0 };
    by[k].billed  += t.billed;
    by[k].paid    += t.paid;
    by[k].balance += t.balance;
  });
  const curs = Object.keys(by);
  const sum = (f) => curs.reduce((a, k) => a + by[k][f], 0);
  return { by, curs, billed: sum('billed'), paid: sum('paid'), balance: sum('balance') };
}

/* 통화가 하나면 그대로, 섞였으면 통화별로 끊어 적는다.
   합쳐서 한 숫자로 보여주면 원화와 달러를 더한 거짓말이 된다. */
function tradeMoney(t, field){
  if(!t.curs.length) return '-';
  return t.curs.map(k => fmtMoney(t.by[k][field], k)).join(' + ');
}

const TRADE_LABEL = { settled:'완납 처리', paid:'입금 완료', partial:'부분 입금',
  unpaid:'미입금', over:'초과 입금', none:'청구 없음' };
const TRADE_CLS = { settled:'p-gray', paid:'p-green', partial:'p-amber',
  unpaid:'p-red', over:'p-blue', none:'p-gray' };

function renderCoTrade(c){
  const list = (c.trade || []).slice().sort((a, b) => String(b.eventId).localeCompare(String(a.eventId)));
  if(!list.length) return `<div class="empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
    <p>전시 참가·거래 이력 없음</p></div>`;

  const t = tradeTotals(c);
  const head = t.curs.length ? `<div class="cost" style="margin-bottom:14px">
    <div class="cosi"><div class="cosn" style="font-size:15px">${tradeMoney(t, 'billed')}</div><div class="cosl">누적 청구</div></div>
    <div class="cosi"><div class="cosn" style="font-size:15px">${tradeMoney(t, 'paid')}</div><div class="cosl">누적 입금</div></div>
    <div class="cosi"><div class="cosn" style="font-size:15px;color:${t.balance > 0 ? 'var(--re)' : 'var(--ge)'}">${tradeMoney(t, 'balance')}</div><div class="cosl">미수금</div></div>
  </div>` : '';

  const rows = list.map(x => {
    const ev = EVENT_LIST.find(e => e.key === x.eventId);
    const col = ev ? ev.color : '#9C9890';
    const pct = x.billed ? Math.min(100, Math.round(x.paid / x.billed * 100)) : 0;
    return `<div class="tlc" style="border-left:3px solid ${col};${x.cancelled ? 'opacity:.55' : ''}">
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:6px">
        <span class="tlev">${escapeHtml(ev ? (ev.short || ev.key) : x.eventId)}</span>
        ${x.cancelled ? '<span class="pill p-gray">참가 취소</span>' : ''}
        ${x.booth ? `<span class="pill p-gray">부스 ${escapeHtml(x.booth)}</span>` : ''}
        ${x.grade ? `<span class="pill p-gold">${escapeHtml(x.grade)}</span>` : ''}
        ${x.openInquiries ? `<span class="pill p-amber">미답변 문의 ${x.openInquiries}</span>` : ''}
        <button class="btn bs" style="margin-left:auto;font-size:10.5px"
          onclick="event.stopPropagation();goToExhibitor('${escAttr(x.exhibitorId)}','${escAttr(x.eventId)}')">전시에서 열기</button>
      </div>
      ${x.billed ? `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--i3)">
          <span class="pill ${TRADE_CLS[x.state] || 'p-gray'}">${escapeHtml(TRADE_LABEL[x.state] || x.state)}</span>
          <span>청구 <b style="color:var(--i1)">${fmtMoney(x.billed, x.cur)}</b></span>
          <span>입금 <b style="color:var(--i1)">${fmtMoney(x.paid, x.cur)}</b></span>
          ${x.balance > 0 ? `<span>미수 <b style="color:var(--re)">${fmtMoney(x.balance, x.cur)}</b></span>` : ''}
          ${x.overdue && x.balance > 0 ? `<span style="color:var(--re)">기한 지남 (${escapeHtml(x.due)})</span>`
            : x.due ? `<span style="color:var(--i4)">기한 ${escapeHtml(x.due)}</span>` : ''}
        </div>
        <div class="br" style="margin-top:7px"><div class="brt"><div class="brf" style="width:${pct}%;background:${
          x.state === 'unpaid' ? 'var(--re)' : x.state === 'partial' ? 'var(--am)' : 'var(--g)'}"></div></div></div>`
        : '<div style="font-size:11.5px;color:var(--i4)">청구 내역 없음</div>'}
    </div>`;
  }).join('');

  return head + rows;
}

/* 기업에서 전시 상세로 바로 넘어간다 — 두 화면을 오가며 다시 찾을 필요가 없다 */
export function goToExhibitor(exhId, evKey){
  try {
    window.switchApp('exh', null);
    window.setExhEvent?.(evKey);
    window.renderExh?.();
    setTimeout(() => window.openExhDr?.(exhId, 1), 60);   // 1 = 정산 탭
  } catch(e){ console.warn('[company-tab] 전시로 이동 실패:', e); }
}

function renderTL(c){
  const addBtn = `<div style="display:flex;justify-content:flex-end;margin-bottom:10px">
    <button class="btn bp" style="font-size:11px" onclick="openAddCoEventModal('${escAttr(c.key)}')">+ 참여 이력 추가</button>
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
window.setCoCountry = setCoCountry;
window.toggleCoMainCollapse = toggleCoMainCollapse;
window.onCoDragStart = onCoDragStart;
window.onCoDropToSector = onCoDropToSector;
window.setCoDomain = setCoDomain;
window.toggleCoDomain = toggleCoDomain;
window.searchCo = searchCo;
window.searchCoM = searchCoM;
window.switchCoT = switchCoT;
window.editCoSector = editCoSector;
window.editCoNameKo = editCoNameKo;
window.editCoNameEn = editCoNameEn;
window.editCoNotes = editCoNotes;
window.editCoWebsite = editCoWebsite;
window.editCoCountry = editCoCountry;
window.editCoAbbr = editCoAbbr;
window.editCoSource = editCoSource;
window.editCoBizNo = editCoBizNo;
window.setCoKind = setCoKind;
window.openAddOrgModal = openAddOrgModal;
window.closeAddOrgModal = closeAddOrgModal;
window.submitAddOrg = submitAddOrg;
window.editCoKind = editCoKind;
window.goToExhibitor = goToExhibitor;
window.createOrg = createOrg;
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
