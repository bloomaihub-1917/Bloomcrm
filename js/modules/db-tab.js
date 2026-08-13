/* ══════════════════════════════════════════════════════════════
   db-tab.js — Master DB(MDB) 탭 (원본 contact_crm.html)
   - MDB 목록/그룹/교차표 렌더 + 필터: 1745~2206행
   - 연락처 상세 드로어(열람/편집/행사참여 추가) + 연락처 직접 추가 모달: 5614~6252행
   로직/조건문은 원본과 동일, 전역변수는 state.js import로, RP2/CL2/RP3/CL3/
   ROLE_TO_CAT 중복 정의는 constants.js 단일 소스로 통합했다.
   (conEditMode 인라인 대입은 모듈 스코프에서 동작하지 않아 startContactEdit/
   cancelContactEdit 래퍼 함수 호출로 바꿨다 — 동작은 동일)
═══════════════════════════════════════════════════════════════ */

import {
  GS_URL,
  EVENT_LIST,
  contacts,
  participations,
  currentUser,
  sheetsConnected,
  PART_TYPES,
  evColor,
  evShort,
  getContactById,
  contactEvents,
  mdbEvFilter,
  mdbView,
  mdbCat,
  mdbStat,
  mdbDomainFilter,
  setMdbEvFilter,
  setMdbView,
  setMdbCat,
  setMdbStat,
  setMdbDomainFilter,
  CO_DB,
  DOMAINS,
  TAGS,
  mdbSelected,
} from '../state.js';
import { CP, CL, RP, ROLE_TO_CAT, COUNTRIES, avB, avF } from '../constants.js';
import { ab, countryName, countryOptions, escapeHtml, escAttr, sectorKey, parseTags, joinTags } from '../utils.js';
import { postToSheet } from '../api.js';
import { buildCoDB } from './company-tab.js';
import { domainOfSector, domainName, findSectorByName, UNASSIGNED_DOMAIN } from './settings-tab.js';
import { trackAction } from './audit-tab.js';

/* BD/C-level — cat("연사/VIP/일반참가자")을 분리하지 않는 비배타적 보조 태그.
   행사·역할이 바뀌어도 남아있어야(다음 행사 메일링 리스트에 재사용) 하므로
   participations.role이나 그때그때의 직함 텍스트가 아니라, 연락처 자체의
   tags 컬럼("bd|clevel"처럼 파이프 구분)에 직접 저장한다. 다만 tags가 아직
   없는 기존 데이터를 위해, C-level은 직함 키워드로도 보조 판별한다(BD는
   참가 역할만으로 자동 추정하면 attendee 전체가 BD가 되는 사고가 났었어서
   자동 추정 없이 tags에 명시적으로 붙인 사람만 잡는다). */
const C_LEVEL_KEYWORDS = [
  'ceo','cto','cfo','coo','cio','cmo','president','chairman','vice chairman','founder','co-founder',
  '대표','대표이사','회장','부회장','사장','부사장','총괄대표','공동대표','창업자',
];
function hasTag(c, key){
  return !!c && parseTags(c.tags).includes(key);
}
function isBDContact(c){
  return hasTag(c, 'bd');
}
function isCLevelContact(c){
  if(!c) return false;
  if(hasTag(c, 'clevel')) return true;
  const t = `${c.titleKo||''} ${c.titleEn||''}`.toLowerCase();
  return C_LEVEL_KEYWORDS.some(k => t.includes(k));
}
/* mdbCat이 speaker/vip/attendee가 아니면(그리고 'all'도 아니면) 등록된
   태그(TAGS) 키를 가리키는 것으로 취급한다 — 태그는 cat과 달리 서로/다른
   카테고리와 배타적이지 않다(BD이면서 동시에 attendee일 수 있음). */
const MDB_CAT_VALUES = ['speaker','vip','attendee'];
function matchesTagFilter(c, tagKey){
  return tagKey === 'clevel' ? isCLevelContact(c) : hasTag(c, tagKey);
}
/* 선택된 연락처들의 tags에서 name을 추가/제거 */
function setContactTag(c, name, add){
  const tags = parseTags(c.tags);
  const idx = tags.indexOf(name);
  if(add && idx < 0) tags.push(name);
  if(!add && idx >= 0) tags.splice(idx, 1);
  c.tags = joinTags(tags);
}

/* 연락처 id → 그 소속 기업이 속한 분야 id 배열. CO_DB(기업 단위 섹터 배정)를
   역참조해서 만든다 — 한 기업이 여러 분야에 속할 수 있으므로(예: Investor
   = BIO+VC) 연락처도 여러 분야에 동시에 속할 수 있다. 등록 안 된 섹터명이나
   분야 미배정인 경우 빈 배열(미분류)을 반환한다. */
function buildContactDomainMap(){
  const map = new Map();
  CO_DB.forEach(co => {
    const doms = new Set();
    (co.sectors && co.sectors.length ? co.sectors : [co.sector]).forEach(name => {
      if(!name) return;
      const sec = findSectorByName(name);
      if(sec) domainOfSector(sec).forEach(d => doms.add(d));
    });
    const domArr = [...doms];
    (co.contacts||[]).forEach(cc => map.set(cc.id, domArr));
  });
  return map;
}

/* ══════════════════════════════════════════
   행사 칩 목록 (원본 1745~1764행)
══════════════════════════════════════════ */
export function buildMDBEvList(){
  const usedEvs = EVENT_LIST.filter(e => participations.some(p => p.eventId === e.key));
  const el = document.getElementById('mdb-ev-list');
  if(!el) return;
  el.innerHTML =
    `<button class="ev-chip${!mdbEvFilter?' on':''}" onclick="setMDBEv(null)">
      <span class="ev-chip-dot" style="background:var(--i4)"></span>
      <span class="ev-chip-nm">전체 행사</span>
      <span class="ev-chip-ct">${contacts.length}명</span>
    </button>` +
    usedEvs.map(e => {
      const cnt = [...new Set(participations.filter(p=>p.eventId===e.key).map(p=>p.contactId))].length;
      return `<button class="ev-chip${mdbEvFilter===e.key?' on':''}" onclick="setMDBEv('${escAttr(e.key)}')">`+
        `<span class="ev-chip-dot" style="background:${e.color}"></span>`+
        `<span class="ev-chip-nm">${escapeHtml(e.short)}</span>`+
        `<span class="ev-chip-ct">${cnt}명</span>`+
        `</button>`;
    }).join('');
}
export function setMDBEv(ev){ setMdbEvFilter(ev); buildMDBEvList(); renderMDB(); }

/* ══════════════════════════════════════════
   분야별 보기 (신규) — 행사별 보기와 같은 칩 UI 패턴.
   연락처 소속 기업의 섹터가 속한 분야(BIO/VC/... , DOMAINS)를 기준으로
   필터링한다. 행사별/카테고리/상태 필터와 함께(AND) 적용된다. */
export function buildMDBDomainList(){
  const el = document.getElementById('mdb-domain-list');
  if(!el) return;
  const domainMap = buildContactDomainMap();
  const countFor = domainId => contacts.filter(c => {
    const doms = domainMap.get(c.id) || [];
    return domainId === UNASSIGNED_DOMAIN ? doms.length === 0 : doms.includes(domainId);
  }).length;

  el.innerHTML =
    `<button class="ev-chip${!mdbDomainFilter?' on':''}" onclick="setMDBDomain(null)">
      <span class="ev-chip-dot" style="background:var(--i4)"></span>
      <span class="ev-chip-nm">전체 분야</span>
      <span class="ev-chip-ct">${contacts.length}명</span>
    </button>` +
    DOMAINS.map(d => {
      const cnt = countFor(d.id);
      return `<button class="ev-chip${mdbDomainFilter===d.id?' on':''}" onclick="setMDBDomain('${escAttr(d.id)}')">`+
        `<span class="ev-chip-dot" style="background:var(--a)"></span>`+
        `<span class="ev-chip-nm">${escapeHtml(d.name)}</span>`+
        `<span class="ev-chip-ct">${cnt}명</span>`+
        `</button>`;
    }).join('') +
    (() => {
      const cnt = countFor(UNASSIGNED_DOMAIN);
      if(!cnt) return '';
      return `<button class="ev-chip${mdbDomainFilter===UNASSIGNED_DOMAIN?' on':''}" onclick="setMDBDomain('${UNASSIGNED_DOMAIN}')">`+
        `<span class="ev-chip-dot" style="background:var(--i5)"></span>`+
        `<span class="ev-chip-nm">${escapeHtml(domainName(UNASSIGNED_DOMAIN))}</span>`+
        `<span class="ev-chip-ct">${cnt}명</span>`+
        `</button>`;
    })();
}
export function setMDBDomain(d){ setMdbDomainFilter(d); buildMDBDomainList(); renderMDB(); }

/* ══════════════════════════════════════════
   목록(flat) 뷰 컬럼 정렬 (신규) — 헤더 클릭 시 오름차순/내림차순 토글.
   화면 전용 상태(저장 안 함), 목록 뷰에서만 동작한다.
══════════════════════════════════════════ */
let _mdbSortCol = null;
let _mdbSortDir = 1; // 1 = 오름차순, -1 = 내림차순
export function sortMDBBy(col){
  if(_mdbSortCol === col) _mdbSortDir = -_mdbSortDir;
  else { _mdbSortCol = col; _mdbSortDir = 1; }
  renderMDB();
}
/* 컬럼별 정렬 비교값 추출 — 문자열은 소문자로, "행사"는 필터 상황에 따라
   (특정 행사면 그 행사에서의 참가 역할, 아니면 참여한 행사 수) 다르게 잡는다. */
const MDB_SORT_KEYS = {
  name:    ({c}) => (c.nameKo||c.nameEn||'').toLowerCase(),
  org:     ({c}) => (c.orgKo||c.orgEn||'').toLowerCase(),
  country: ({c}) => countryName(c.country||'').toLowerCase(),
  title:   ({c}) => (c.titleKo||c.titleEn||'').toLowerCase(),
  cat:     ({c,p}) => { const roleKey = p ? p.role : c.cat; return String(CL[roleKey]||roleKey||'').toLowerCase(); },
  events:  ({c,p}) => p ? String(evShort(p.eventId)||'').toLowerCase() : contactEvents(c).length,
  contact: ({c}) => (c.email1||c.phone1||'').toLowerCase(),
  date:    ({c}) => c.date||'',
  status:  ({c}) => c.status||'',
};
function applyMDBSort(pairs){
  const keyFn = MDB_SORT_KEYS[_mdbSortCol];
  if(!keyFn) return pairs;
  return [...pairs].sort((a,b) => {
    const va = keyFn(a), vb = keyFn(b);
    if(va < vb) return -_mdbSortDir;
    if(va > vb) return _mdbSortDir;
    return 0;
  });
}

/* ══════════════════════════════════════════
   태그 필터 칩 목록 (신규) — 카테고리(연사/VIP/일반참가자)와 분리된 영역.
   TAGS 레지스트리(설정 > 기업 섹터에서 추가/삭제 관리)를 그대로 버튼으로
   렌더링한다. 서로 배타적이지 않으므로 클릭한 태그 하나만 mdbCat에 반영되고
   (동시에 여러 태그로 필터링은 지원 안 함), 카테고리 버튼과 동일한
   filterCat()/segCat() 메커니즘을 그대로 재사용한다.
══════════════════════════════════════════ */
export function buildMDBTagList(){
  const el = document.getElementById('mdb-tag-list');
  if(!el) return;
  if(!TAGS.length){
    el.innerHTML = '<span style="font-size:12px;color:var(--i4)">등록된 태그가 없어요 — 설정 &gt; 기업 섹터에서 추가할 수 있어요.</span>';
    return;
  }
  el.innerHTML = TAGS.map(t => `
    <button class="nr${mdbCat===t.key?' on':''}" onclick="filterCat('${escAttr(t.key)}',this)">
      🏷 ${escapeHtml(t.label)}<span class="nbg" id="ct-tag-${escAttr(t.key)}">0</span>
    </button>`).join('');
}

/* ══════════════════════════════════════════
   행 선택(체크) + 일괄 작업 (신규) — 목록(flat) 뷰에서 이름 아바타를 클릭하면
   그 사람이 선택되고, 선택된 사람이 1명 이상이면 상단에 일괄 작업 바가 뜬다.
   기업 병합은 "기업명 일괄 변경"으로 통합 처리(선택된 연락처들의 orgKo를
   하나로 맞추면 기업DB 집계 시 자연히 한 기업으로 합쳐진다).
══════════════════════════════════════════ */
export function toggleMDBSelect(id){
  if(mdbSelected.has(id)) mdbSelected.delete(id);
  else mdbSelected.add(id);
  renderMDB();
}
export function clearMDBSelection(){
  mdbSelected.clear();
  renderMDB();
}
/* 현재 필터링돼서 보이는 목록 전체를 선택/해제 — 화면에 없는(필터에 안 걸린)
   사람은 건드리지 않는다. */
export function toggleMDBSelectAll(checked){
  const pairs = getMDBPairs();
  if(checked) pairs.forEach(({c}) => mdbSelected.add(c.id));
  else pairs.forEach(({c}) => mdbSelected.delete(c.id));
  renderMDB();
}
export function renderMDBSelectionBar(){
  const el = document.getElementById('mdb-bulkbar');
  if(!el) return;
  const n = mdbSelected.size;
  if(!n){ el.style.display = 'none'; el.innerHTML=''; return; }
  el.style.display = 'flex';
  el.innerHTML = `
    <span style="font-size:12px;font-weight:600;color:var(--i1)">${n}명 선택됨</span>
    <button class="btn bp bs" onclick="openMDBBulkEditModal()">기업명/카테고리/상태 일괄 변경</button>
    <button class="btn bs" style="color:var(--re);border-color:var(--re)" onclick="bulkDeleteMDBContacts()">선택 삭제</button>
    <button class="btn bs" style="margin-left:auto" onclick="clearMDBSelection()">선택 해제</button>
  `;
}

export function openMDBBulkEditModal(){
  if(!mdbSelected.size) return;
  closeMDBBulkEditModal();

  // 선택된 연락처들이 지금 전부 같은 기업 소속이면 "분리" 제안 버튼을 보여준다
  // (다른 기업들이 섞여 있으면 분리라는 개념 자체가 애매하므로 숨김)
  const selContacts = [...mdbSelected].map(id => getContactById(id)).filter(Boolean);
  const orgsInSel = new Set(selContacts.map(c => c.orgKo || c.orgEn || ''));
  const commonOrg = orgsInSel.size === 1 ? [...orgsInSel][0] : '';

  const pop = document.createElement('div');
  pop.id = 'mdb-bulk-modal';
  pop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.32);z-index:9999;display:flex;align-items:center;justify-content:center';
  pop.onclick = () => closeMDBBulkEditModal();
  pop.innerHTML = `
    <div style="background:var(--W);border-radius:10px;padding:20px;width:340px;box-shadow:0 12px 40px rgba(0,0,0,.2)" onclick="event.stopPropagation()">
      <div style="font-size:14px;font-weight:700;margin-bottom:12px">선택한 ${mdbSelected.size}명 일괄 변경</div>
      <div class="fg">
        <label class="fl">기업명(국문) — 비워두면 유지<br>
          <span style="font-weight:400;color:var(--i4)">목록에서 기존 기업을 고르면 그 기업으로 <b>통합</b>, 새 이름을 입력하면 <b>분리</b>돼요</span>
        </label>
        <input class="fi" id="mdb-bulk-org" list="mdb-bulk-org-list" placeholder="예: 삼성전자" oninput="updateMDBBulkOrgHint()">
        <datalist id="mdb-bulk-org-list">
          ${CO_DB.map(c => `<option value="${escAttr(c.nameKo||c.nameEn)}" label="${c.contacts.length}명 배정됨">`).join('')}
        </datalist>
        <div id="mdb-bulk-org-hint" style="font-size:11px;color:var(--i4);margin-top:4px;min-height:14px"></div>
        ${commonOrg ? `<button type="button" class="btn bs" style="margin-top:2px;font-size:11px" onclick="suggestMDBSplitName()">🔀 "${escapeHtml(commonOrg)}"에서 분리할 새 이름 제안</button>` : ''}
      </div>
      <div class="fg" style="margin-top:8px"><label class="fl">카테고리 — 유지하려면 선택 안 함</label>
        <select class="fi" id="mdb-bulk-cat"><option value="">변경 안 함</option>
          ${['speaker','vip','attendee'].map(k=>`<option value="${k}">${CL[k]}</option>`).join('')}
        </select></div>
      <div class="fg" style="margin-top:8px"><label class="fl">상태 — 유지하려면 선택 안 함</label>
        <select class="fi" id="mdb-bulk-status"><option value="">변경 안 함</option>
          <option value="verified">검증됨</option><option value="pending">확인 중</option><option value="new">신규</option>
        </select></div>
      ${TAGS.map(t => `
      <div class="fg" style="margin-top:8px"><label class="fl">${escapeHtml(t.label)} 태그 — 참가 역할·카테고리와 무관하게 계속 남는 꼬리표(다음 행사 메일링에 재사용)</label>
        <select class="fi" id="mdb-bulk-tag-${escAttr(t.key)}"><option value="">유지</option><option value="add">${escapeHtml(t.label)}로 표시</option><option value="remove">${escapeHtml(t.label)} 표시 해제</option></select></div>`).join('')}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button class="btn bs" onclick="closeMDBBulkEditModal()">취소</button>
        <button class="btn bp" onclick="applyMDBBulkEdit()">적용</button>
      </div>
    </div>`;
  document.body.appendChild(pop);
}
export function closeMDBBulkEditModal(){
  const el = document.getElementById('mdb-bulk-modal');
  if(el) el.remove();
}
/* "분리" 제안 — 지금 선택된 사람들이 다 같은 기업 소속일 때, 그 이름에
   " (분리)" 접미사를 붙여 입력창에 채워준다. 사용자가 그대로 저장하거나
   직접 다듬어서 적용하면, buildCoDB가 다음 재빌드 때 이 사람들을 원래
   기업과 다른 별도의 CO_DB 항목으로 묶는다(기업 구분은 orgKo/orgEn 텍스트
   기준으로만 이뤄지므로 별도의 저장 로직이 필요 없음). */
/* 기업명 입력창에 값이 바뀔 때마다 그 이름과 정확히 일치하는 CO_DB 기업이
   있는지 찾아 현재 배정 인원 수를 보여준다 — 통합 전에 "몇 명짜리 기업에
   합쳐지는지" 미리 알 수 있게 하기 위함(사용자 요청). 일치하는 기업이 없으면
   지금 입력 중인 이름이 새 기업(분리)이 된다는 걸 알려준다. */
export function updateMDBBulkOrgHint(){
  const hintEl = document.getElementById('mdb-bulk-org-hint');
  if(!hintEl) return;
  const val = ((document.getElementById('mdb-bulk-org')||{}).value||'').trim();
  if(!val){ hintEl.textContent = ''; return; }
  const match = CO_DB.find(c => (c.nameKo||'').trim() === val || (c.nameEn||'').trim() === val);
  if(match){
    hintEl.textContent = `→ "${match.nameKo||match.nameEn}"에 현재 ${match.contacts.length}명 배정돼있어요 — 선택한 사람들이 여기 합쳐져요`;
    hintEl.style.color = 'var(--a)';
  } else {
    hintEl.textContent = '→ 일치하는 기존 기업이 없어요 — 새 기업으로 분리돼요';
    hintEl.style.color = 'var(--i4)';
  }
}
export function suggestMDBSplitName(){
  const input = document.getElementById('mdb-bulk-org');
  if(!input) return;
  const selContacts = [...mdbSelected].map(id => getContactById(id)).filter(Boolean);
  const orgsInSel = new Set(selContacts.map(c => c.orgKo || c.orgEn || ''));
  if(orgsInSel.size !== 1) return;
  const base = [...orgsInSel][0];
  input.value = base ? `${base} (분리)` : '';
  input.focus();
  input.select();
  updateMDBBulkOrgHint();
}
export async function applyMDBBulkEdit(){
  const org    = ((document.getElementById('mdb-bulk-org')||{}).value||'').trim();
  const cat    = (document.getElementById('mdb-bulk-cat')||{}).value||'';
  const status = (document.getElementById('mdb-bulk-status')||{}).value||'';
  const tagOps = TAGS.map(t => ({ key: t.key, label: t.label, op: (document.getElementById('mdb-bulk-tag-'+t.key)||{}).value||'' }))
    .filter(x => x.op);
  if(!org && !cat && !status && !tagOps.length){ alert('변경할 값을 하나 이상 입력/선택하세요.'); return; }

  const ids = [...mdbSelected];
  const changed = [];
  const backup = []; // 저장 실패 시 롤백용
  ids.forEach(id => {
    const c = getContactById(id);
    if(!c) return;
    backup.push({ c, orgKo: c.orgKo, orgEn: c.orgEn, cat: c.cat, status: c.status, tags: c.tags });
    if(org){ c.orgKo = org; if(!c.orgEn) c.orgEn = org; }
    if(cat) c.cat = cat;
    if(status) c.status = status;
    tagOps.forEach(t => setContactTag(c, t.key, t.op === 'add'));
    changed.push(c);
  });
  closeMDBBulkEditModal();
  if(!changed.length) return;

  const r = await postToSheet({
    sheet: 'contacts', action: 'batchUpsert',
    rows: changed.map(c => [c.id,c.nameKo,c.nameEn,c.orgKo,c.orgEn,c.titleKo,c.titleEn,c.deptKo,c.deptEn,
      c.country,c.cat,c.lang,c.source,c.date,c.status,c.email1,c.email2,c.phone1,c.phone2,c.beat,c.products,c.tags||'']),
  }, '연락처 일괄 변경');
  if(!r.ok){
    // 기업 병합(mergeCompanies)과 동일한 원칙 — 저장 실패 시 로컬 변경을 되돌려서
    // 화면엔 바뀐 것처럼 보이는데 새로고침하면 원복되는 거짓 성공을 막는다.
    backup.forEach(b => { b.c.orgKo = b.orgKo; b.c.orgEn = b.orgEn; b.c.cat = b.cat; b.c.status = b.status; b.c.tags = b.tags; });
    buildCoDB();
    mdbSelected.clear();
    renderMDB();
    alert('일괄 변경 저장에 실패해서 취소했어요. 네트워크 확인 후 다시 시도해주세요.');
    return;
  }

  const parts = [org&&'기업명', cat&&'카테고리', status&&'상태', ...tagOps.map(t=>`${t.label} ${t.op==='add'?'추가':'해제'}`)].filter(Boolean).join(', ');
  trackAction('edit', '연락처 일괄 변경', `${changed.length}명`, `연락처 ${changed.length}명 일괄 변경(${parts})`);
  mdbSelected.clear();
  buildCoDB();
  renderMDB();
}

export async function bulkDeleteMDBContacts(){
  const ids = [...mdbSelected];
  if(!ids.length) return;
  if(!confirm(`선택한 ${ids.length}명의 연락처를 삭제할까요?\n관련 행사 참여 기록도 함께 삭제되며, 되돌릴 수 없습니다.`)) return;

  const idSet = new Set(ids);
  const removedParts = participations.filter(p => idSet.has(p.contactId));

  // 로컬 먼저 반영(화면 즉시 갱신), 시트 삭제는 그 뒤 순차 처리
  for(let i = contacts.length-1; i >= 0; i--) if(idSet.has(contacts[i].id)) contacts.splice(i,1);
  for(let i = participations.length-1; i >= 0; i--) if(idSet.has(participations[i].contactId)) participations.splice(i,1);

  mdbSelected.clear();
  buildCoDB();
  renderMDB();

  // Apps Script 과부하 방지를 위해 동시 요청이 아니라 순차로 삭제
  for(const id of ids){
    await postToSheet({ sheet:'contacts', action:'delete', row:[id] }, '연락처 삭제');
  }
  for(const p of removedParts){
    await postToSheet({ sheet:'participations', action:'delete', row:[p.id] }, '행사 참여 삭제');
  }
  trackAction('edit', '연락처 일괄 삭제', `${ids.length}명`, `연락처 ${ids.length}명 삭제`);
}

/* ── View toggle (원본 1767~1772행) ── */
export function setDBView(v,btn){
  setMdbView(v);
  document.querySelectorAll('.dvt-btn').forEach(b=>b.classList.remove('on'));
  (btn||document.getElementById('dvt-'+v)).classList.add('on');
  renderMDB();
}

/* ── Core filter: returns array of {c, p|null} pairs (원본 1781~1826행) ── */
export function getMDBPairs(){
  const q = (document.getElementById('mdb-q')||{}).value||'';
  let pairs = [];

  if(mdbEvFilter){
    // 특정 행사 — participations 기준
    let evParts = participations.filter(p => p.eventId === mdbEvFilter);
    if(mdbCat !== 'all' && !MDB_CAT_VALUES.includes(mdbCat)){
      // 태그(BD/C-level/커스텀) — cat이 아니라 연락처의 영구 태그로 직접 검사(다른 카테고리와 비배타적)
      evParts = evParts.filter(p => matchesTagFilter(getContactById(p.contactId), mdbCat));
    } else if(mdbCat !== 'all'){
      // "전체"와 동일하게: 연락처 자체의 cat 또는 참가 역할 둘 중 하나라도 맞으면 포함
      evParts = evParts.filter(p => {
        const c = getContactById(p.contactId);
        if(c && c.cat === mdbCat) return true;
        return ROLE_TO_CAT[p.role] === mdbCat;
      });
    }
    // 한 행사당 한 사람은 1번만 (카테고리 필터 이후에 중복 제거해야 다중 트랙 참가자가 안 빠짐)
    const seenCids = new Set();
    pairs = evParts
      .filter(p => { if(seenCids.has(p.contactId)) return false; seenCids.add(p.contactId); return true; })
      .map(p => ({ c: getContactById(p.contactId), p }))
      .filter(x => x.c);
  } else {
    // 전체 — contacts 기준, id 중복 제거
    const seenIds = new Set();
    pairs = contacts
      .filter(c => { if(seenIds.has(c.id)) return false; seenIds.add(c.id); return true; })
      .map(c => ({ c, p: null }));
    if(mdbCat !== 'all' && !MDB_CAT_VALUES.includes(mdbCat)){
      // 태그(BD/C-level/커스텀) — cat이 아니라 연락처의 영구 태그로 직접 검사(다른 카테고리와 비배타적)
      pairs = pairs.filter(({c}) => matchesTagFilter(c, mdbCat));
    } else if(mdbCat !== 'all'){
      pairs = pairs.filter(({c}) => {
        if(c.cat === mdbCat) return true;
        return participations.some(p => p.contactId === c.id && ROLE_TO_CAT[p.role] === mdbCat);
      });
    }
  }

  // stat filter
  if(mdbStat) pairs = pairs.filter(({c}) => c.status === mdbStat);
  // domain filter (분야별 보기) — 연락처 소속 기업이 속한 분야 기준
  if(mdbDomainFilter){
    const domainMap = buildContactDomainMap();
    pairs = pairs.filter(({c}) => {
      const doms = domainMap.get(c.id) || [];
      return mdbDomainFilter === UNASSIGNED_DOMAIN ? doms.length === 0 : doms.includes(mdbDomainFilter);
    });
  }
  // text search
  if(q){
    const lq = q.toLowerCase();
    pairs = pairs.filter(({c}) =>
      [c.nameKo,c.nameEn,c.orgKo,c.orgEn,c.titleKo,c.titleEn].some(v => v && v.toLowerCase().includes(lq))
    );
  }
  return pairs;
}

/* ── Main render dispatcher (원본 1829~1842행) ── */
export function renderMDB(){
  const pairs = getMDBPairs();
  buildMDBDomainList();
  buildMDBTagList();
  renderMDBSelectionBar();

  const ctEl = document.getElementById('db-ct');
  if(ctEl) ctEl.textContent = mdbEvFilter
    ? `${pairs.length}명 (${evShort(mdbEvFilter)})`
    : `${pairs.length}명`;

  if(mdbView==='group')  renderMDBGrouped(pairs);
  else if(mdbView==='matrix') renderMDBMatrix();
  else renderMDBFlat(pairs);

  updateMDBBadges(pairs);
}

/* 원본 1844~1876행 */
export function updateMDBBadges(pairs){
  // Cat counts
  const basePairs = (() => {
    let bp = mdbEvFilter
      ? participations.filter(p=>p.eventId===mdbEvFilter).map(p=>({c:getContactById(p.contactId),p})).filter(x=>x.c)
      : contacts.map(c=>({c,p:null}));
    if(mdbStat) bp=bp.filter(({c})=>c.status===mdbStat);
    const q=(document.getElementById('mdb-q')||{}).value||'';
    if(q){ const lq=q.toLowerCase(); bp=bp.filter(({c})=>[c.nameKo,c.nameEn,c.orgKo,c.titleKo,c.titleEn].some(v=>v&&v.toLowerCase().includes(lq))); }
    return bp;
  })();

  const cats=['all','speaker','vip','attendee'];
  const ids =['ct-all','ct-sp','ct-vip','ct-at'];
  cats.forEach((cat,i)=>{
    const el=document.getElementById(ids[i]);if(!el)return;
    if(cat==='all'){ el.textContent=[...new Set(basePairs.map(({c})=>c.id))].length; return; }
    if(mdbEvFilter){
      el.textContent=basePairs.filter(({c,p})=>(c&&c.cat===cat)||(p&&ROLE_TO_CAT[p.role]===cat)).length;
    } else {
      el.textContent=basePairs.filter(({c})=>{
        if(c.cat===cat) return true;
        return participations.some(pp=>pp.contactId===c.id&&ROLE_TO_CAT[pp.role]===cat);
      }).length;
    }
  });
  // 태그(BD/C-level/커스텀)는 cat이 아니라 연락처의 영구 태그만 별도로 세는
  // 비배타적 보조 배지 — attendee 등과 겹쳐도 되므로 위 cats 루프와 분리해서 처리한다.
  TAGS.forEach(t => {
    const el = document.getElementById('ct-tag-'+t.key);
    if(!el) return;
    el.textContent = [...new Set(basePairs.map(({c})=>c.id))].filter(id => matchesTagFilter(getContactById(id), t.key)).length;
  });
  ['verified','pending','new'].forEach((s,i)=>{
    const el=document.getElementById(['ct-vf','ct-pe','ct-nw'][i]);
    if(el) el.textContent=[...new Set(basePairs.map(({c})=>c.id))].filter(id=>{
      const c=getContactById(id);return c&&c.status===s;
    }).length;
  });
}

/* ── FLAT VIEW (원본 1879~1958행) ── */
export function renderMDBFlat(pairs){
  pairs = applyMDBSort(pairs);
  // matrix/행사별 뷰에서 테이블이 교체됐을 경우(또는 체크박스 헤더가 없는
  // 다른 뷰의 헤더가 남아있는 경우) 목록 뷰용 헤더로 복원
  const tw = document.getElementById('mdb-tw');
  if(tw && !tw.querySelector('#mdb-select-all')){
    tw.innerHTML = '<table><thead><tr>'
      + '<th style="width:26px"><input type="checkbox" id="mdb-select-all" onclick="event.stopPropagation();toggleMDBSelectAll(this.checked)" title="현재 목록 전체 선택/해제"></th>'
      + '<th onclick="sortMDBBy(\'name\')" style="cursor:pointer">이름<span class="mdb-sort-ind" data-sort="name"></span></th>'
      + '<th onclick="sortMDBBy(\'org\')" style="cursor:pointer">기업<span class="mdb-sort-ind" data-sort="org"></span></th>'
      + '<th onclick="sortMDBBy(\'country\')" style="cursor:pointer">국가<span class="mdb-sort-ind" data-sort="country"></span></th>'
      + '<th onclick="sortMDBBy(\'title\')" style="cursor:pointer">직함/부서<span class="mdb-sort-ind" data-sort="title"></span></th>'
      + '<th id="mdb-th-role" onclick="sortMDBBy(\'cat\')" style="cursor:pointer"><span class="mdb-th-label">카테고리</span><span class="mdb-sort-ind" data-sort="cat"></span></th>'
      + '<th onclick="sortMDBBy(\'events\')" style="cursor:pointer">행사<span class="mdb-sort-ind" data-sort="events"></span></th>'
      + '<th onclick="sortMDBBy(\'contact\')" style="cursor:pointer">연락처<span class="mdb-sort-ind" data-sort="contact"></span></th>'
      + '<th onclick="sortMDBBy(\'date\')" style="cursor:pointer">수집일<span class="mdb-sort-ind" data-sort="date"></span></th>'
      + '<th onclick="sortMDBBy(\'status\')" style="cursor:pointer">상태<span class="mdb-sort-ind" data-sort="status"></span></th>'
      + '</tr></thead><tbody id="mdb-body"></tbody></table>';
  }
  // 이 컬럼은 상황에 따라 서로 다른 값을 보여준다 — 특정 행사로 필터링하지 않았을 때는
  // 연락처의 카테고리(연사/VIP/일반참가자), 특정 행사로 필터링했을 때는 그 행사에서의
  // 참가 역할(연사/BD/바이어 등 세부 유지)이다. 헤더 제목도 그에 맞게 매번 갱신해서
  // "카테고리"라는 이름이 서로 다른 데이터를 가리키며 혼동되지 않게 한다.
  const roleTh = document.getElementById('mdb-th-role');
  const roleThLabel = roleTh ? roleTh.querySelector('.mdb-th-label') : null;
  if(roleThLabel) roleThLabel.textContent = mdbEvFilter ? '참가 역할' : '카테고리';
  else if(roleTh) roleTh.textContent = mdbEvFilter ? '참가 역할' : '카테고리';

  const sm={verified:'stv',pending:'stp',new:'stn'};
  const sl={verified:'검증됨',pending:'확인 중',new:'신규'};

  const body = document.getElementById('mdb-body');
  if(!body) return;

  body.innerHTML = pairs.map(({c,p})=>{
    const gi = contacts.indexOf(c);
    const roleKey = p ? p.role : c.cat;

    const nameKo = escapeHtml(c.nameKo), nameEn = escapeHtml(c.nameEn);
    const orgKo  = escapeHtml(c.orgKo),  orgEn  = escapeHtml(c.orgEn);
    const orgTitle = escapeHtml(c.orgKo||c.orgEn||'');
    const orgEnTitle = escapeHtml(c.orgKo?(c.orgEn||''):'');

    // Events column
    let evCell = '';
    if(p){
      evCell = `<span class="ev-pill" style="background:${evColor(p.eventId)}18;color:${evColor(p.eventId)}">
        <span class="ev-pill-dot" style="background:${evColor(p.eventId)}"></span>${escapeHtml(evShort(p.eventId))}
      </span>${p.note?`<div style="font-size:10px;color:var(--i3);margin-top:3px">${escapeHtml(p.note)}</div>`:''}`;
    } else {
      const evs = contactEvents(c);
      const shown = evs.slice(0,2).map(ev=>
        `<span class="ev-pill" style="background:${evColor(ev)}18;color:${evColor(ev)};margin-bottom:2px">
          <span class="ev-pill-dot" style="background:${evColor(ev)}"></span>${escapeHtml(evShort(ev))}
        </span>`).join('');
      const more = evs.length>2?`<span class="pill p-gray">+${evs.length-2}</span>`:'';
      evCell = `<div style="display:flex;gap:3px;flex-wrap:wrap;align-items:center">${shown}${more}</div>`;
    }

    const contactCell = [c.email1, c.phone1].filter(Boolean).map(v=>`<div style="font-size:10px;color:var(--i3);white-space:nowrap">${escapeHtml(v)}</div>`).join('') || '<span style="color:var(--i6)">—</span>';

    const isSel = mdbSelected.has(c.id);
    return `<tr onclick="openContactDr(${c.id})" style="cursor:pointer" class="${isSel?'row-sel':''}">
      <td onclick="event.stopPropagation()" style="text-align:center"><input type="checkbox" ${isSel?'checked':''} onchange="toggleMDBSelect(${c.id})"></td>
      <td><div class="tdco">
        <div class="tdav${isSel?' sel':''}" onclick="event.stopPropagation();toggleMDBSelect(${c.id})" title="클릭해서 선택/해제">${isSel?'✓':ab(c.nameKo||c.nameEn||"")}</div>
        <div><div class="tdnm">${c.nameKo?nameKo:nameEn}${isBDContact(c)?' <span class="pill p-teal" style="font-size:9px;padding:1px 5px">BD</span>':''}${isCLevelContact(c)?' <span class="pill p-gold" style="font-size:9px;padding:1px 5px">C-level</span>':''}</div><div class="tdsb">${nameEn}</div></div>
      </div></td>
      <td style="max-width:200px"><div class="tdnm" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${orgTitle}">${c.orgKo?orgKo:orgEn}</div><div class="tdsb" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${orgEnTitle}">${c.orgKo?orgEn:''}</div></td>
      <td style="color:var(--i2);font-size:12px;white-space:nowrap">${escapeHtml(countryName(c.country))}</td>
      <td style="color:var(--i3);font-size:12px;max-width:170px;white-space:normal;line-height:1.4">
        <div>${escapeHtml(c.titleKo||'')}${c.titleKo&&c.titleEn?' · ':''}${escapeHtml(c.titleEn||'')}</div>
        <div style="font-size:10px;color:var(--i4);margin-top:1px">${escapeHtml(c.deptKo||'')}${c.deptKo&&c.deptEn?' · ':''}${escapeHtml(c.deptEn||'')}</div>
        ${c.beat?`<div style="font-size:10px;color:var(--te);margin-top:2px">🏭 ${escapeHtml(c.beat)}</div>`:''}
        ${c.products?`<div style="font-size:10px;color:var(--pu);margin-top:2px">📦 ${escapeHtml(c.products)}</div>`:''}
      </td>
      <td><span class="pill ${CP[roleKey]||'p-gray'}">${escapeHtml(CL[roleKey]||roleKey)}</span></td>
      <td style="max-width:200px">${evCell}</td>
      <td>${contactCell}</td>
      <td style="color:var(--i4);font-size:11px">${escapeHtml(c.date)}</td>
      <td><span style="display:flex;align-items:center;gap:5px">
        <span class="std ${sm[c.status]||'stn'}"></span>${escapeHtml(sl[c.status]||c.status)}
      </span></td>
    </tr>`;
  }).join('') || emptyStateRow();

  // 헤더 체크박스는 지금 보이는 목록이 전부 선택돼 있을 때만 체크 표시
  const selectAllEl = document.getElementById('mdb-select-all');
  if(selectAllEl){
    selectAllEl.checked = pairs.length > 0 && pairs.every(({c}) => mdbSelected.has(c.id));
  }

  // 정렬 화살표 표시 — 현재 정렬 중인 컬럼에만 방향 표시
  document.querySelectorAll('.mdb-sort-ind').forEach(el => {
    el.textContent = el.dataset.sort === _mdbSortCol ? (_mdbSortDir === 1 ? ' ▲' : ' ▼') : '';
  });
}

/* ── 빈 상태 안내 (원본 1944~1958행) ── */
export function emptyStateRow(){
  if(contacts.length === 0){
    if(!sheetsConnected){
      return '<tr><td colspan="10" style="padding:40px 20px;text-align:center">'
        + '<div style="font-size:13px;color:var(--i3);margin-bottom:6px">📋 아직 등록된 연락처가 없어요</div>'
        + '<div style="font-size:11px;color:var(--i4)">상단 \'업로드\' 메뉴에서 파일을 추가하거나, 구글시트 연동을 확인해주세요</div>'
        + '</td></tr>';
    }
    return '<tr><td colspan="10" style="padding:40px 20px;text-align:center">'
      + '<div style="font-size:13px;color:var(--i3);margin-bottom:6px">📋 아직 등록된 연락처가 없어요</div>'
      + '<div style="font-size:11px;color:var(--i4)">상단 \'업로드\' 메뉴에서 파일을 추가해주세요</div>'
      + '</td></tr>';
  }
  return '<tr><td colspan="10" style="padding:32px;text-align:center;color:var(--i4);font-size:13px">검색 조건에 맞는 연락처가 없어요</td></tr>';
}

/* ── GROUP VIEW: 행사별 → 기업별 소그룹 (원본 1961~2132행) ── */
export function renderMDBGrouped(pairs){
  // matrix 뷰에서 테이블이 교체됐거나, 목록 뷰의 체크박스 헤더가 남아있으면
  // (컬럼 수가 안 맞아 행이 밀림) 행사별 그룹 보기용 헤더로 복원
  const tw = document.getElementById('mdb-tw');
  if(tw && (!tw.querySelector('#mdb-body') || tw.querySelector('#mdb-select-all'))){
    tw.innerHTML = '<table><thead><tr>'
      + '<th>이름</th><th>기업</th><th>국가</th><th>직함/부서</th>'
      + '<th id="mdb-th-role">참가 역할</th><th>행사</th><th>연락처</th><th>수집일</th><th>상태</th>'
      + '</tr></thead><tbody id="mdb-body"></tbody></table>';
  }
  // 행사별 그룹 보기는 모든 행이 특정 행사 참가 이력을 기준으로 묶이므로,
  // 이 컬럼은 항상 "참가 역할"이다(연락처 자체의 카테고리와는 다른 값 — 위 renderMDBFlat 참고)
  const roleTh = document.getElementById('mdb-th-role');
  if(roleTh) roleTh.textContent = '참가 역할';

  const sm={verified:'stv',pending:'stp',new:'stn'};
  const sl={verified:'검증됨',pending:'확인 중',new:'신규'};

  const body = document.getElementById('mdb-body');
  if(!body) return;

  let rows = '';

  if(mdbEvFilter){
    // Group by org within this event
    const byOrg = {};
    pairs.forEach(({c,p}) => { const k=c.orgKo||c.orgEn||''; (byOrg[k]||(byOrg[k]=[])).push({c,p}); });
    const col = evColor(mdbEvFilter);

    Object.entries(byOrg).sort((a,b)=>a[0].localeCompare(b[0],'ko')).forEach(([org,members])=>{
      rows += `<tr style="pointer-events:none"><td colspan="9" style="padding:0">
        <div class="grp-hd" style="background:${col}0A;border-left:3px solid ${col}">
          <svg viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2" style="width:12px;height:12px;flex-shrink:0"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>
          <div class="grp-hd-nm">${escapeHtml(org)}</div>
          <div class="grp-hd-ct">${members.length}명</div>
        </div>
      </td></tr>`;
      members.forEach(({c,p})=>{
        const gi=contacts.indexOf(c);
        rows += `<tr>
          <td><div class="tdco">
            <div class="tdav" style="background:${avB(gi)};color:${avF(gi)}">${ab(c.nameKo||c.nameEn||"")}</div>
            <div><div class="tdnm">${escapeHtml(c.nameKo||c.nameEn)}</div><div class="tdsb">${escapeHtml(c.nameEn)}</div></div>
          </div></td>
          <td style="color:var(--i3);font-size:12px">${escapeHtml(c.titleKo||c.titleEn||'-')}</td>
          <td><span class="pill ${CP[p.role]||'p-gray'}">${escapeHtml(CL[p.role]||p.role)}</span></td>
          <td colspan="2" style="color:var(--i3);font-size:11px;font-style:italic">${escapeHtml(p.note||'')}</td>
          <td><span class="lt">${escapeHtml(c.lang)}</span></td>
          <td style="color:var(--i3);font-size:11px">${escapeHtml(c.source)}</td>
          <td style="color:var(--i4);font-size:11px">${escapeHtml(c.date)}</td>
          <td><span style="display:flex;align-items:center;gap:5px">
            <span class="std ${sm[c.status]||'stn'}"></span>${escapeHtml(sl[c.status]||c.status)}
          </span></td>
        </tr>`;
      });
    });
  } else {
    // Group by event, sub-group by org
    const usedEvs = EVENT_LIST.filter(e=>participations.some(p=>p.eventId===e.key));
    usedEvs.forEach(evObj=>{
      // Filter participations matching current cat/stat/search
      let evParts = participations.filter(p=>p.eventId===evObj.key);
      if(mdbCat!=='all'){
        evParts=evParts.filter(p=>{
          const c=getContactById(p.contactId);
          if(c&&c.cat===mdbCat) return true;
          return ROLE_TO_CAT[p.role]===mdbCat;
        });
      }
      let members = evParts.map(p=>({c:getContactById(p.contactId),p})).filter(x=>x.c);
      if(mdbStat) members=members.filter(({c})=>c.status===mdbStat);
      const q=(document.getElementById('mdb-q')||{}).value||'';
      if(q){ const lq=q.toLowerCase(); members=members.filter(({c})=>[c.nameKo,c.nameEn,c.orgKo,c.orgEn,c.titleKo,c.titleEn].some(v=>v&&v.toLowerCase().includes(lq))); }
      if(!members.length) return;

      // Event header
      rows += `<tr style="pointer-events:none"><td colspan="9" style="padding:0">
        <div class="grp-hd" style="border-left:3px solid ${evObj.color}">
          <div class="grp-hd-dot" style="background:${evObj.color}"></div>
          <div class="grp-hd-nm">${escapeHtml(evObj.key)}</div>
          <div class="grp-hd-ct">${members.length}명</div>
          <div class="grp-hd-date">${escapeHtml(evObj.date)}</div>
        </div>
      </td></tr>`;

      // Sub-group by org
      const byOrg={};
      members.forEach(m=>{ const k=m.c.orgKo||m.c.orgEn||''; (byOrg[k]||(byOrg[k]=[])).push(m); });
      Object.entries(byOrg).forEach(([org,ms])=>{
        if(ms.length>1){
          rows += `<tr style="pointer-events:none"><td colspan="9" style="padding:0">
            <div style="display:flex;align-items:center;gap:7px;padding:4px 20px 2px;background:${evObj.color}06">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px;color:var(--i4);flex-shrink:0"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
              <span style="font-size:11px;font-weight:600;color:var(--i3)">${escapeHtml(org)}</span>
              <span style="font-size:10px;color:var(--i4)">${ms.length}명</span>
            </div>
          </td></tr>`;
        }
        ms.forEach(({c,p})=>{
          const gi=contacts.indexOf(c);
          rows+=`<tr onclick="openContactDr(${c.id})" style="cursor:pointer">
            <td><div class="tdco" style="padding-left:${ms.length>1?'8px':'0'}">
              <div class="tdav" style="background:${avB(gi)};color:${avF(gi)}">${ab(c.nameKo||c.nameEn||"")}</div>
              <div><div class="tdnm">${escapeHtml(c.nameKo||c.nameEn)}</div><div class="tdsb">${escapeHtml(c.nameEn)}</div></div>
            </div></td>
            <td style="color:var(--i2);font-size:12px;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(c.orgKo||c.orgEn||'')}">${ms.length>1?'':escapeHtml(c.orgKo||c.orgEn||'')}</td>
            <td style="color:var(--i2);font-size:11px;white-space:nowrap">${escapeHtml(countryName(c.country))}</td>
            <td style="color:var(--i3);font-size:12px;max-width:140px;white-space:normal;line-height:1.4">${escapeHtml(c.titleKo||'')}${c.deptKo?(' · '+escapeHtml(c.deptKo)):''}</td>
            <td><span class="pill ${CP[p.role]||'p-gray'}">${escapeHtml(CL[p.role]||p.role)}</span></td>
            <td style="color:var(--i3);font-size:11px;font-style:italic;max-width:160px;white-space:normal">${escapeHtml(p.note||'')}</td>
            <td style="font-size:10px;color:var(--i3)">${escapeHtml(c.email1||c.phone1||'—')}</td>
            <td style="color:var(--i4);font-size:11px">${escapeHtml(c.date)}</td>
            <td><span style="display:flex;align-items:center;gap:5px">
              <span class="std ${sm[c.status]||'stn'}"></span>${escapeHtml(sl[c.status]||c.status)}
            </span></td>
          </tr>`;
        });
      });
    });

    // 미배정: 참가 이력(participations)이 전혀 없는 연락처
    const assignedIds = new Set(participations.map(p=>p.contactId));
    let unassigned = contacts.filter(c => !assignedIds.has(c.id));
    if(mdbCat!=='all') unassigned = unassigned.filter(c=>c.cat===mdbCat);
    if(mdbStat) unassigned = unassigned.filter(c=>c.status===mdbStat);
    const qU=(document.getElementById('mdb-q')||{}).value||'';
    if(qU){ const lqU=qU.toLowerCase(); unassigned = unassigned.filter(c=>[c.nameKo,c.nameEn,c.orgKo,c.orgEn,c.titleKo,c.titleEn].some(v=>v&&v.toLowerCase().includes(lqU))); }

    if(unassigned.length){
      rows += `<tr style="pointer-events:none"><td colspan="9" style="padding:0">
        <div class="grp-hd" style="border-left:3px solid var(--i5)">
          <div class="grp-hd-dot" style="background:var(--i5)"></div>
          <div class="grp-hd-nm">미배정</div>
          <div class="grp-hd-ct">${unassigned.length}명</div>
        </div>
      </td></tr>`;

      const byOrgU = {};
      unassigned.forEach(c=>{ const k=c.orgKo||c.orgEn||''; (byOrgU[k]||(byOrgU[k]=[])).push(c); });
      Object.entries(byOrgU).forEach(([org,cs])=>{
        if(cs.length>1){
          rows += `<tr style="pointer-events:none"><td colspan="9" style="padding:0">
            <div style="display:flex;align-items:center;gap:7px;padding:4px 20px 2px;background:var(--i8)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px;color:var(--i4);flex-shrink:0"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
              <span style="font-size:11px;font-weight:600;color:var(--i3)">${escapeHtml(org)}</span>
              <span style="font-size:10px;color:var(--i4)">${cs.length}명</span>
            </div>
          </td></tr>`;
        }
        cs.forEach(c=>{
          const gi=contacts.indexOf(c);
          rows+=`<tr onclick="openContactDr(${c.id})" style="cursor:pointer">
            <td><div class="tdco" style="padding-left:${cs.length>1?'8px':'0'}">
              <div class="tdav" style="background:${avB(gi)};color:${avF(gi)}">${ab(c.nameKo||c.nameEn||"")}</div>
              <div><div class="tdnm">${escapeHtml(c.nameKo||c.nameEn)}</div><div class="tdsb">${escapeHtml(c.nameEn)}</div></div>
            </div></td>
            <td style="color:var(--i2);font-size:12px;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(c.orgKo||c.orgEn||'')}">${cs.length>1?'':escapeHtml(c.orgKo||c.orgEn||'')}</td>
            <td style="color:var(--i2);font-size:11px;white-space:nowrap">${escapeHtml(countryName(c.country))}</td>
            <td style="color:var(--i3);font-size:12px;max-width:140px;white-space:normal;line-height:1.4">${escapeHtml(c.titleKo||'')}${c.deptKo?(' · '+escapeHtml(c.deptKo)):''}</td>
            <td><span class="pill p-gray">미배정</span></td>
            <td style="color:var(--i3);font-size:11px;font-style:italic;max-width:160px;white-space:normal"></td>
            <td style="font-size:10px;color:var(--i3)">${escapeHtml(c.email1||c.phone1||'—')}</td>
            <td style="color:var(--i4);font-size:11px">${escapeHtml(c.date)}</td>
            <td><span style="display:flex;align-items:center;gap:5px">
              <span class="std ${sm[c.status]||'stn'}"></span>${escapeHtml(sl[c.status]||c.status)}
            </span></td>
          </tr>`;
        });
      });
    }

    if(!rows) rows='<tr><td colspan="9" style="padding:32px;text-align:center;color:var(--i4);font-size:13px">일치하는 연락처가 없어요</td></tr>';
  }
  body.innerHTML=rows;
}

/* ── MATRIX VIEW (원본 2135~2186행) ── */
export function renderMDBMatrix(){
  const usedEvs = EVENT_LIST.filter(e=>participations.some(p=>p.eventId===e.key));

  // Collect all orgs that have any participation
  const orgMap={};
  participations.forEach(p=>{
    const c=getContactById(p.contactId);if(!c)return;
    if(mdbCat!=='all'&&c.cat!==mdbCat&&ROLE_TO_CAT[p.role]!==mdbCat) return;
    const k=c.orgKo||c.orgEn||'';
    if(!orgMap[k]) orgMap[k]={};
    if(!orgMap[k][p.eventId]) orgMap[k][p.eventId]=[];
    orgMap[k][p.eventId].push({c,p});
  });
  const orgs=Object.keys(orgMap).sort((a,b)=>a.localeCompare(b,'ko'));

  const tw=document.getElementById('mdb-tw');
  if(!tw) return;

  tw.innerHTML=`<div style="overflow:auto;height:100%;position:relative">
    <table style="border-collapse:collapse;font-size:12px;min-width:max-content">
      <thead><tr>
        <th style="position:sticky;left:0;top:0;z-index:4;background:var(--i8);padding:9px 16px;text-align:left;font-size:10px;font-weight:700;color:var(--i3);border-bottom:2px solid var(--i6);border-right:2px solid var(--i6);min-width:140px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap">기업</th>
        ${usedEvs.map(e=>`
          <th style="position:sticky;top:0;z-index:3;padding:9px 12px;text-align:center;font-size:10px;font-weight:700;color:${e.color};border-bottom:2px solid var(--i6);border-right:1px solid var(--i7);min-width:130px;white-space:nowrap;background:${e.color}12;letter-spacing:.02em">
            <div>${escapeHtml(e.short)}</div>
            <div style="font-size:9px;color:var(--i4);font-weight:400;margin-top:1px">${escapeHtml(e.date)}</div>
          </th>`).join('')}
      </tr></thead>
      <tbody>
        ${orgs.map((org,oi)=>`
          <tr>
            <td style="position:sticky;left:0;z-index:2;background:var(--W);padding:10px 16px;border-bottom:1px solid var(--i7);border-right:2px solid var(--i6);font-weight:600;color:var(--i1);font-size:12px;white-space:nowrap;vertical-align:top">
              ${escapeHtml(org)}
            </td>
            ${usedEvs.map(e=>{
              const cell=orgMap[org]&&orgMap[org][e.key]||[];
              if(!cell.length) return `<td style="padding:10px 12px;border-bottom:1px solid var(--i7);border-right:1px solid var(--i7);text-align:center;color:var(--i6);font-size:16px">—</td>`;
              return `<td style="padding:8px 10px;border-bottom:1px solid var(--i7);border-right:1px solid var(--i7);background:${e.color}07;vertical-align:top">
                ${cell.map(({c,p})=>`
                  <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;white-space:nowrap">
                    <span class="pill ${CP[p.role]||'p-gray'}" style="font-size:9px;padding:1px 5px">${escapeHtml(CL[p.role]||p.role)}</span>
                    <span style="font-size:11px;color:var(--i1);font-weight:500">${escapeHtml(c.nameKo||c.nameEn)}</span>
                  </div>`).join('')}
              </td>`;
            }).join('')}
          </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

/* ── 카테고리/상태 필터 버튼 + CSV 내보내기 (원본 2188~2205행) ── */
export function filterCat(cat,btn){setMdbCat(cat);document.querySelectorAll('#sbp-mdb .s-q .nr').forEach(b=>b.classList.remove('on'));if(btn)btn.classList.add('on');segCat(cat,null);}
export function filterStat(s,btn){setMdbStat(mdbStat===s?null:s);document.querySelectorAll('#sbp-mdb .s-s .nr').forEach(b=>b.classList.remove('on'));if(mdbStat)btn.classList.add('on');renderMDB()}
export function segCat(cat,btn){setMdbCat(cat);document.querySelectorAll('.mdb-seg-b').forEach(b=>b.classList.remove('on'));if(btn)btn.classList.add('on');renderMDB();}
export function exportCSV(){
  const h=['이름','영문명','기업','영문기업','국가','직함(국)','직함(영)','부서(국)','부서(영)','카테고리','분야','전시품목','언어','이메일1','이메일2','연락처1','연락처2','출처','날짜','상태','태그'];
  const rows=contacts.map(c=>[
    c.nameKo,c.nameEn,c.orgKo,c.orgEn,countryName(c.country),
    c.titleKo,c.titleEn,c.deptKo,c.deptEn,
    CL[c.cat]||c.cat,
    c.beat||'',
    c.products||'',
    c.lang,
    c.email1,c.email2,c.phone1,c.phone2,
    c.source,c.date,c.status,
    c.tags||''
  ]);
  const csv=[h,...rows].map(r=>r.map(v=>`"${(v||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,﻿'+encodeURIComponent(csv);a.download='master_db_export.csv';a.click();
}

/* ══════════════════════════════════════════
   연락처 상세 드로어 (원본 5614~6252행)
══════════════════════════════════════════ */
let conDrId = null;
let conEditMode = false;

export function openContactDr(id){
  conDrId = id;
  conEditMode = false;
  renderContactDr();
  document.getElementById('con-dr').classList.add('on');
  document.getElementById('con-bd').classList.add('on');
}
export function closeContactDr(){
  document.getElementById('con-dr').classList.remove('on');
  document.getElementById('con-bd').classList.remove('on');
  conDrId = null;
  conEditMode = false;
}

export function renderContactDr(){
  const c = contacts.find(x => x.id === conDrId);
  if(!c) return;
  const gi = contacts.indexOf(c);

  document.getElementById('con-dr-av').style.background = avB(gi);
  document.getElementById('con-dr-av').style.color = avF(gi);
  document.getElementById('con-dr-av').textContent = ab(c.nameKo||c.nameEn||'');
  document.getElementById('con-dr-name').textContent = c.nameKo + (c.nameEn ? ' · ' + c.nameEn : '');
  document.getElementById('con-dr-meta').innerHTML =
    '<span>🏢 ' + escapeHtml(c.orgKo||c.orgEn||'-') + '</span>' +
    '<span>🌐 ' + escapeHtml(countryName(c.country)) + '</span>' +
    '<span class="pill ' + (CP[c.cat]||'p-gray') + '">' + (CL[c.cat]||c.cat) + '</span>';

  document.getElementById('con-dr-body').innerHTML = conEditMode ? contactEditForm(c) : contactViewPanel(c);
}

/* conEditMode는 모듈 스코프 변수라 onclick="conEditMode=true"처럼 인라인 대입으로는
   바뀌지 않는다 — 대신 아래 두 래퍼 함수를 window에 등록해서 호출한다(동작 동일). */
export function startContactEdit(){ conEditMode = true; renderContactDr(); }
export function cancelContactEdit(){ conEditMode = false; renderContactDr(); }

/* ══════════════════════════════════════════
   참여 행사 추가 모달 (원본 5654~5753행)
══════════════════════════════════════════ */
export function openAddEvModal(cid){
  // 같은 행사라도 다른 참가 유형(트랙)으로 추가할 수 있으므로 행사 목록에서 제외하지 않음
  const available = EVENT_LIST;

  const html = `
    <div id="add-ev-modal" onclick="if(event.target===this)closeAddEvModal()"
      style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center">
      <div style="background:var(--W);border-radius:12px;padding:22px;width:340px;box-shadow:0 8px 32px rgba(0,0,0,.18)">
        <div style="font-size:14px;font-weight:700;color:var(--i1);margin-bottom:16px">참여 행사 추가</div>

        <div style="margin-bottom:12px">
          <div class="mlbl">행사 선택</div>
          <select class="fi" id="aem-ev" style="width:100%">
            ${available.length
              ? available.map(e=>`<option value="${escapeHtml(e.key)}">${escapeHtml(e.short)} (${escapeHtml(e.date)})</option>`).join('')
              : '<option value="">추가 가능한 행사 없음</option>'}
            <option value="__direct__">✏️ 직접 입력…</option>
          </select>
          <input class="fi" id="aem-ev-text" placeholder="행사명 직접 입력"
            style="width:100%;margin-top:6px;display:none">
        </div>

        <div style="margin-bottom:16px">
          <div class="mlbl">참가 유형</div>
          <select class="fi parttype-select" id="aem-role" style="width:100%">
            ${PART_TYPES.map(t=>`<option value="${escapeHtml(t.key)}">${escapeHtml(t.label)}</option>`).join('')}
          </select>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn bs" onclick="closeAddEvModal()">취소</button>
          <button class="btn bp" onclick="confirmAddEv(${cid})">추가</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  // 직접입력 전환
  document.getElementById('aem-ev').onchange = function(){
    const inp = document.getElementById('aem-ev-text');
    if(this.value === '__direct__'){
      inp.style.display = 'block'; inp.focus();
    } else {
      inp.style.display = 'none';
    }
  };
}

export function closeAddEvModal(){
  const el = document.getElementById('add-ev-modal');
  if(el) el.remove();
}

export async function confirmAddEv(cid){
  const sel = document.getElementById('aem-ev');
  const inp = document.getElementById('aem-ev-text');
  const ev  = (sel.value === '__direct__' && inp && inp.value.trim())
    ? inp.value.trim()
    : (sel.value !== '__direct__' ? sel.value : '');
  const role = document.getElementById('aem-role').value;

  if(!ev){ alert('행사를 선택하거나 입력해주세요.'); return; }

  // 같은 행사+같은 참가 유형으로 이미 있으면 스킵 (같은 행사라도 다른 유형은 허용)
  if(participations.some(p => p.contactId === cid && p.eventId === ev && p.role === role)){
    alert('이미 같은 참가 유형으로 등록된 행사입니다.'); return;
  }

  // id에 랜덤 성분 추가 — 같은 ms 내 이중 클릭 시 id 충돌로 다른 행이
  // 삭제될 수 있던 문제 방지
  const partId = 'P-' + Date.now() + '-' + Math.floor(Math.random()*1000);
  const part = {
    id:        partId,
    eventId:   ev,
    event:     ev,
    contactId: cid,
    contact:   '',
    role:      role,
    note:      '',
    matched:   '✅ 앱에서 추가',
  };
  participations.push(part);
  closeAddEvModal();
  renderContactDr();
  buildCoDB();
  renderMDB();

  // 구글시트 저장 — 실패 시 방금 추가한 참여 기록 롤백
  const r = await postToSheet({
    sheet: 'participations',
    row: [part.id, part.eventId, '', part.contactId, '', '', '', part.role, part.note, part.matched],
  }, '행사 참여 추가');
  if(!r.ok){
    const idx = participations.findIndex(p => p.id === partId);
    if(idx >= 0) participations.splice(idx, 1);
    renderContactDr(); buildCoDB(); renderMDB();
    return;
  }
  trackAction('edit', '행사 추가', ev, `${contacts.find(x=>x.id===cid)?.nameKo||cid} → ${ev} (${role})`);
}

export async function removeParticipation(cid, partId, ev){
  if(!confirm(`"${evShort(ev)}" 참여를 삭제할까요?`)) return;

  // 로컬 제거 (실패 시 복원할 수 있도록 백업)
  const idx = participations.findIndex(p => String(p.id) === String(partId));
  const removed = idx >= 0 ? participations.splice(idx, 1)[0] : null;

  renderContactDr();
  buildCoDB();
  renderMDB();

  // 구글시트 삭제 — 실패 시 로컬 복원
  if(partId){
    const r = await postToSheet({
      sheet: 'participations',
      action: 'delete',
      row: [partId],
    }, '행사 참여 삭제');
    if(!r.ok){
      if(removed) participations.splice(Math.min(idx, participations.length), 0, removed);
      renderContactDr(); buildCoDB(); renderMDB();
      return;
    }
    trackAction('edit', '행사 삭제', ev, `${contacts.find(x=>x.id===cid)?.nameKo||cid} ← ${ev} 제거`);
  }
}

/* 원본 5783~5865행 */
export function contactViewPanel(c){
  const evs = contactEvents(c);
  return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      <button class="btn bp bs" onclick="startContactEdit()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        편집
      </button>
    </div>

    <div class="sct">기본 정보</div>
    <div class="ig">
      <div class="ic"><div class="il">기업</div><div class="iv">${escapeHtml(c.orgKo)||'-'}</div></div>
      <div class="ic"><div class="il">영문 기업</div><div class="iv">${escapeHtml(c.orgEn)||'-'}</div></div>
      <div class="ic"><div class="il">국가</div><div class="iv">${escapeHtml(countryName(c.country))}</div></div>
      <div class="ic"><div class="il">카테고리</div><div class="iv"><span class="pill ${CP[c.cat]||'p-gray'}">${CL[c.cat]||c.cat}</span></div></div>
      <div class="ic"><div class="il">태그</div><div class="iv">
        ${isBDContact(c)?'<span class="pill p-teal" style="margin-right:4px">BD</span>':''}${isCLevelContact(c)?'<span class="pill p-gold">C-level</span>':''}${(!isBDContact(c)&&!isCLevelContact(c))?'<span style="color:var(--i4)">-</span>':''}
      </div></div>
    </div>

    <div class="sct" style="margin-top:14px">직함 / 부서</div>
    <div class="ig">
      <div class="ic"><div class="il">직함 (국문)</div><div class="iv">${escapeHtml(c.titleKo)||'-'}</div></div>
      <div class="ic"><div class="il">직함 (영문)</div><div class="iv">${escapeHtml(c.titleEn)||'-'}</div></div>
      <div class="ic"><div class="il">부서 (국문)</div><div class="iv">${escapeHtml(c.deptKo)||'-'}</div></div>
      <div class="ic"><div class="il">부서 (영문)</div><div class="iv">${escapeHtml(c.deptEn)||'-'}</div></div>
    </div>

    ${c.beat ? `
    <div class="sct" style="margin-top:14px">분야</div>
    <div class="ig">
      <div class="ic"><div class="il">분야</div><div class="iv"><span class="pill p-teal">${escapeHtml(c.beat)}</span></div></div>
    </div>` : ''}

    ${c.products ? `
    <div class="sct" style="margin-top:14px">전시 품목</div>
    <div class="ig">
      <div class="ic" style="grid-column:span 2"><div class="il">제품/품목</div><div class="iv">${escapeHtml(c.products)||'-'}</div></div>
    </div>` : ''}

    <div class="sct" style="margin-top:14px">연락처</div>
    <div class="ig">
      <div class="ic"><div class="il">이메일 1</div><div class="iv">${c.email1?`<a href="mailto:${escapeHtml(c.email1)}" style="color:var(--a);text-decoration:none">${escapeHtml(c.email1)}</a>`:'-'}</div></div>
      <div class="ic"><div class="il">이메일 2</div><div class="iv">${c.email2?`<a href="mailto:${escapeHtml(c.email2)}" style="color:var(--a);text-decoration:none">${escapeHtml(c.email2)}</a>`:'-'}</div></div>
      <div class="ic"><div class="il">연락처 1</div><div class="iv">${escapeHtml(c.phone1)||'-'}</div></div>
      <div class="ic"><div class="il">연락처 2</div><div class="iv">${escapeHtml(c.phone2)||'-'}</div></div>
    </div>

    <div class="sct" style="margin-top:14px;display:flex;align-items:center;justify-content:space-between">
      <span>참여 행사</span>
      <button class="btn bs" style="font-size:11px;padding:3px 8px" onclick="openAddEvModal(${c.id})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> 추가
      </button>
    </div>
    <div id="con-ev-list-${c.id}" style="margin-bottom:14px">
      ${evs.length ? evs.map(ev => {
        const part = participations.find(p =>
          String(p.contactId) === String(c.id) && p.eventId === ev
        );
        const partId  = part ? part.id : '';
        const role    = part ? (part.role||'') : '';
        const roleClass = CP[role] || RP[role] || 'p-gray';
        const roleLabel = CL[role] || role;
        return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <span class="ev-pill" style="background:${evColor(ev)}18;color:${evColor(ev)};flex:1;min-width:0">
            <span class="ev-pill-dot" style="background:${evColor(ev)}"></span>
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(evShort(ev))}</span>
            ${role ? `<span class="pill ${roleClass}" style="font-size:10px;padding:1px 6px;flex-shrink:0">${escapeHtml(roleLabel)}</span>` : ''}
          </span>
          <button onclick="removeParticipation(${c.id},'${escAttr(partId)}','${escAttr(ev)}')"
            style="background:none;border:none;cursor:pointer;color:var(--i4);padding:2px 5px;font-size:16px;line-height:1;flex-shrink:0"
            title="삭제">×</button>
        </div>`;
      }).join('') : '<div style="font-size:12px;color:var(--i4)">참여 행사 없음</div>'}
    </div>

    <div class="sct">수집 정보</div>
    <div class="ig">
      <div class="ic"><div class="il">수집 출처</div><div class="iv" style="font-size:12px">${escapeHtml(c.source)||'-'}</div></div>
      <div class="ic"><div class="il">수집일</div><div class="iv">${escapeHtml(c.date)||'-'}</div></div>
      <div class="ic"><div class="il">언어</div><div class="iv"><span class="lt">${escapeHtml(c.lang)||'-'}</span></div></div>
      <div class="ic"><div class="il">상태</div><div class="iv">${({verified:'검증됨',pending:'확인 중',new:'신규'})[c.status]||escapeHtml(c.status)}</div></div>
    </div>
  `;
}

/* 원본 5867~5929행 */
export function contactEditForm(c){
  return `
    <div class="fg-row" style="margin-bottom:12px">
      <div class="fg"><label class="fl">이름 (국문)</label><input class="fi" id="ce-name" value="${escapeHtml(c.nameKo||'')}"></div>
      <div class="fg"><label class="fl">이름 (영문)</label><input class="fi" id="ce-nameEn" value="${escapeHtml(c.nameEn||'')}"></div>
    </div>
    <div class="fg-row" style="margin-bottom:12px">
      <div class="fg"><label class="fl">기업 (국문)</label><input class="fi" id="ce-org" value="${escapeHtml(c.orgKo||'')}"></div>
      <div class="fg"><label class="fl">기업 (영문)</label><input class="fi" id="ce-orgEn" value="${escapeHtml(c.orgEn||'')}"></div>
    </div>
    <div class="fg-row" style="margin-bottom:12px">
      <div class="fg"><label class="fl">국가</label>
        <select class="fi" id="ce-country">${countryOptions(c.country)}</select>
      </div>
      <div class="fg"><label class="fl">카테고리</label>
        <select class="fi" id="ce-cat">
          ${['speaker','vip','attendee'].map(k=>`<option value="${k}"${c.cat===k?' selected':''}>${CL[k]}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="sec-t" style="margin:16px 0 8px">직함 / 부서</div>
    <div class="fg-row" style="margin-bottom:12px">
      <div class="fg"><label class="fl">직함 (국문)</label><input class="fi" id="ce-titleKo" value="${escapeHtml(c.titleKo||'')}"></div>
      <div class="fg"><label class="fl">직함 (영문)</label><input class="fi" id="ce-titleEn" value="${escapeHtml(c.titleEn||'')}"></div>
    </div>
    <div class="fg-row" style="margin-bottom:12px">
      <div class="fg"><label class="fl">부서 (국문)</label><input class="fi" id="ce-deptKo" value="${escapeHtml(c.deptKo||'')}"></div>
      <div class="fg"><label class="fl">부서 (영문)</label><input class="fi" id="ce-deptEn" value="${escapeHtml(c.deptEn||'')}"></div>
    </div>

    <div id="ce-beat-field">
      <div class="sec-t" style="margin:16px 0 8px">분야</div>
      <div class="fg" style="margin-bottom:12px">
        <label class="fl">분야 (산업/업종)</label>
        <input class="fi" id="ce-beat" value="${escapeHtml(c.beat||'')}" placeholder="예: Pharma, Biotech, Digital Health 등">
      </div>
    </div>

    <div id="ce-products-field">
      <div class="sec-t" style="margin:16px 0 8px">전시 품목</div>
      <div class="fg" style="margin-bottom:12px">
        <label class="fl">제품/품목</label>
        <input class="fi" id="ce-products" value="${escapeHtml(c.products||'')}" placeholder="예: AI 카메라, 스마트 센서 등">
      </div>
    </div>

    <div class="sec-t" style="margin:16px 0 8px">연락처</div>
    <div class="fg-row" style="margin-bottom:8px">
      <div class="fg"><label class="fl">이메일 1</label><input class="fi" id="ce-email1" value="${escapeHtml(c.email1||'')}" placeholder="email@example.com"></div>
      <div class="fg"><label class="fl">이메일 2</label><input class="fi" id="ce-email2" value="${escapeHtml(c.email2||'')}" placeholder="선택사항"></div>
    </div>
    <div class="fg-row" style="margin-bottom:12px">
      <div class="fg"><label class="fl">연락처 1</label><input class="fi" id="ce-phone1" value="${escapeHtml(c.phone1||'')}" placeholder="+82-10-0000-0000"></div>
      <div class="fg"><label class="fl">연락처 2</label><input class="fi" id="ce-phone2" value="${escapeHtml(c.phone2||'')}" placeholder="선택사항"></div>
    </div>

    <div style="display:flex;gap:8px;margin-top:18px">
      <button class="btn bs" onclick="cancelContactEdit()" style="flex:1;justify-content:center">취소</button>
      <button class="btn bp bs" onclick="saveContactEdit()" style="flex:1;justify-content:center">저장</button>
    </div>
  `;
}

/* 원본 5938~5991행 */
export async function saveContactEdit(){
  const c = contacts.find(x => x.id === conDrId);
  if(!c) return;

  // 이름이 전부 비면 저장 거부 (기존엔 빈 이름도 저장됐음)
  const _nameKo = document.getElementById('ce-name').value.trim();
  const _nameEn = document.getElementById('ce-nameEn').value.trim();
  if(!_nameKo && !_nameEn){ alert('이름(한글 또는 영문)을 입력해주세요.'); return; }

  const prev = { ...c }; // 저장 실패 시 롤백용 스냅샷

  c.nameKo  = document.getElementById('ce-name').value.trim();
  c.nameEn  = document.getElementById('ce-nameEn').value.trim();
  c.orgKo   = document.getElementById('ce-org').value.trim();
  c.orgEn   = document.getElementById('ce-orgEn').value.trim();
  c.country = document.getElementById('ce-country').value;
  c.cat     = document.getElementById('ce-cat').value;
  c.titleKo = document.getElementById('ce-titleKo').value.trim();
  c.titleEn = document.getElementById('ce-titleEn').value.trim();
  c.deptKo  = document.getElementById('ce-deptKo').value.trim();
  c.deptEn  = document.getElementById('ce-deptEn').value.trim();
  c.email1  = document.getElementById('ce-email1').value.trim();
  c.email2  = document.getElementById('ce-email2').value.trim();
  c.phone1  = document.getElementById('ce-phone1').value.trim();
  c.phone2  = document.getElementById('ce-phone2').value.trim();

  // 카테고리별 전용 필드
  const beatEl = document.getElementById('ce-beat');
  const productsEl = document.getElementById('ce-products');
  c.beat     = beatEl ? beatEl.value : (c.beat||'');
  c.products = productsEl ? productsEl.value.trim() : (c.products||'');

  conEditMode = false;
  renderContactDr();
  try { renderMDB(); } catch(e){}

  // 구글시트 동기화 — upsert (id 일치 행 덮어쓰기). 실패 시 편집 전 상태로 롤백
  const r = await postToSheet({
    sheet:  'contacts',
    action: 'upsert',
    row: [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
          c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2,
          c.beat, c.products, c.tags||''],
  }, '연락처 수정');
  if(!r.ok){
    Object.assign(c, prev);
    renderContactDr();
    try { renderMDB(); } catch(e){}
    return;
  }
  trackAction('status', '연락처 정보 수정', c.nameKo, '<b>'+c.nameKo+'</b>의 정보를 수정했어요');
}

/* ══════════════════════════════════════════
   연락처 직접 추가 모달 (원본 6121~6252행)
══════════════════════════════════════════ */
export function openAddContactModal(){
  const catOpts = ['speaker','vip','attendee'].map(k =>
    `<option value="${k}">${CL[k]}</option>`).join('');
  const countryOpts = COUNTRIES.map(c =>
    `<option value="${c.nameKo}">${c.nameKo}</option>`).join('');

  const html = `
    <div id="add-contact-modal" onclick="if(event.target===this)closeAddContactModal()"
      style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px">
      <div style="background:var(--W);border-radius:14px;padding:24px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.2)">
        <div style="font-size:15px;font-weight:700;color:var(--i1);margin-bottom:18px">연락처 추가</div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div><div class="mlbl">이름 (한글)</div>
            <input class="fi" id="ac-nameKo" placeholder="홍길동" style="width:100%"></div>
          <div><div class="mlbl">이름 (영문)</div>
            <input class="fi" id="ac-nameEn" placeholder="Gildong Hong" style="width:100%"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div><div class="mlbl">소속 (한글)</div>
            <input class="fi" id="ac-orgKo" placeholder="한국바이오협회" style="width:100%"></div>
          <div><div class="mlbl">소속 (영문)</div>
            <input class="fi" id="ac-orgEn" placeholder="Korea Bio Association" style="width:100%"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div><div class="mlbl">직함 (한글)</div>
            <input class="fi" id="ac-titleKo" placeholder="팀장" style="width:100%"></div>
          <div><div class="mlbl">직함 (영문)</div>
            <input class="fi" id="ac-titleEn" placeholder="Team Leader" style="width:100%"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
          <div><div class="mlbl">이메일</div>
            <input class="fi" id="ac-email1" placeholder="name@company.com" style="width:100%"></div>
          <div><div class="mlbl">전화번호</div>
            <input class="fi" id="ac-phone1" placeholder="010-0000-0000" style="width:100%"></div>
          <div><div class="mlbl">국가</div>
            <select class="fi" id="ac-country" style="width:100%">
              <option value="대한민국">대한민국</option>
              ${countryOpts}
            </select></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
          <div><div class="mlbl">카테고리</div>
            <select class="fi" id="ac-cat" style="width:100%">
              ${catOpts}
            </select></div>
          <div><div class="mlbl">출처</div>
            <input class="fi" id="ac-source" placeholder="예: 명함, 행사 등록" value="직접 입력" style="width:100%"></div>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn bs" onclick="closeAddContactModal()">취소</button>
          <button class="btn bp" id="ac-save-btn" onclick="saveNewContact()">저장</button>
        </div>
        <div id="ac-msg" style="font-size:11px;text-align:right;margin-top:8px;height:14px"></div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

export function closeAddContactModal(){
  document.getElementById('add-contact-modal')?.remove();
}

export async function saveNewContact(){
  const get = id => (document.getElementById(id)||{}).value?.trim()||'';
  const nameKo = get('ac-nameKo');
  const nameEn = get('ac-nameEn');
  const msg    = document.getElementById('ac-msg');

  if(!nameKo && !nameEn){
    if(msg){msg.style.color='var(--re)';msg.textContent='이름을 입력해주세요.';}
    return;
  }

  const btn = document.getElementById('ac-save-btn');
  if(btn){ btn.disabled=true; btn.textContent='저장 중…'; }

  const newId = Date.now() + Math.floor(Math.random()*10000);
  const today = new Date().toISOString().slice(0,10);

  const c = {
    id:      newId,
    nameKo:  nameKo,
    nameEn:  nameEn,
    orgKo:   get('ac-orgKo'),
    orgEn:   get('ac-orgEn'),
    titleKo: get('ac-titleKo'),
    titleEn: get('ac-titleEn'),
    deptKo:  '', deptEn: '',
    country: get('ac-country') || '대한민국',
    cat:     get('ac-cat')     || 'attendee',
    lang:    nameKo ? 'KO' : 'EN',
    source:  get('ac-source')  || '직접 입력',
    date:    today,
    status:  'new',
    email1:  get('ac-email1'),
    email2:  '',
    phone1:  get('ac-phone1'),
    phone2:  '',
    beat:    '',
    products:'',
  };

  // 로컬 추가
  contacts.push(c);
  try { buildCoDB(); renderMDB(); buildMDBEvList(); } catch(e){}

  // 구글시트 저장 — 실패 시 로컬 추가도 롤백 (기존엔 로컬에 남아 새로고침 시 증발)
  const r = await postToSheet({
    sheet: 'contacts',
    row: [c.id,c.nameKo,c.nameEn,c.orgKo,c.orgEn,c.titleKo,c.titleEn,c.deptKo,c.deptEn,
          c.country,c.cat,c.lang,c.source,c.date,c.status,c.email1,c.email2,c.phone1,c.phone2,
          c.beat,c.products,c.tags||''],
  }, '연락처 추가', { silent: true });
  if(!r.ok){
    const idx = contacts.findIndex(x => x.id === c.id);
    if(idx >= 0) contacts.splice(idx, 1);
    try { buildCoDB(); renderMDB(); buildMDBEvList(); } catch(e){}
    if(btn){ btn.disabled=false; btn.textContent='저장'; }
    if(msg){msg.style.color='var(--re)';msg.textContent='저장 실패: '+(r.error||'네트워크 오류')+' — 다시 시도해주세요';}
    return;
  }
  trackAction('add','연락처 추가', c.nameKo||c.nameEn,
    `${c.nameKo||c.nameEn} / ${c.orgKo||c.orgEn} 추가`);
  closeAddContactModal();
}

/* ══════════════════════════════════════════
   전역 노출 — 원본 HTML의 onclick/onchange="함수명(...)" 인라인 핸들러가
   찾을 수 있도록 window에 등록
══════════════════════════════════════════ */
window.buildMDBEvList = buildMDBEvList;
window.setMDBEv = setMDBEv;
window.buildMDBDomainList = buildMDBDomainList;
window.setMDBDomain = setMDBDomain;
window.toggleMDBSelect = toggleMDBSelect;
window.clearMDBSelection = clearMDBSelection;
window.toggleMDBSelectAll = toggleMDBSelectAll;
window.sortMDBBy = sortMDBBy;
window.openMDBBulkEditModal = openMDBBulkEditModal;
window.closeMDBBulkEditModal = closeMDBBulkEditModal;
window.suggestMDBSplitName = suggestMDBSplitName;
window.updateMDBBulkOrgHint = updateMDBBulkOrgHint;
window.applyMDBBulkEdit = applyMDBBulkEdit;
window.bulkDeleteMDBContacts = bulkDeleteMDBContacts;
window.setDBView = setDBView;
window.getMDBPairs = getMDBPairs;
window.renderMDB = renderMDB;
window.updateMDBBadges = updateMDBBadges;
window.renderMDBFlat = renderMDBFlat;
window.emptyStateRow = emptyStateRow;
window.renderMDBGrouped = renderMDBGrouped;
window.renderMDBMatrix = renderMDBMatrix;
window.filterCat = filterCat;
window.filterStat = filterStat;
window.segCat = segCat;
window.exportCSV = exportCSV;
window.openContactDr = openContactDr;
window.closeContactDr = closeContactDr;
window.renderContactDr = renderContactDr;
window.startContactEdit = startContactEdit;
window.cancelContactEdit = cancelContactEdit;
window.openAddEvModal = openAddEvModal;
window.closeAddEvModal = closeAddEvModal;
window.confirmAddEv = confirmAddEv;
window.removeParticipation = removeParticipation;
window.contactViewPanel = contactViewPanel;
window.contactEditForm = contactEditForm;
window.saveContactEdit = saveContactEdit;
window.openAddContactModal = openAddContactModal;
window.closeAddContactModal = closeAddContactModal;
window.saveNewContact = saveNewContact;
