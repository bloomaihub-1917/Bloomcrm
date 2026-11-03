/* ══════════════════════════════════════════════════════════════
   db-tab.js — Master DB(MDB) 탭 (원본 contact_crm.html)
   - MDB 목록/그룹/교차표 렌더 + 필터: 1745~2206행
   - 연락처 상세 드로어(열람/편집/행사참여 추가) + 연락처 직접 추가 모달: 5614~6252행
   로직/조건문은 원본과 동일, 전역변수는 state.js import로, RP2/CL2/RP3/CL3/
   ROLE_TO_CAT 중복 정의는 constants.js 단일 소스로 통합했다.
   (conEditMode 인라인 대입은 모듈 스코프에서 동작하지 않아 startContactEdit/
   cancelContactEdit 래퍼 함수 호출로 바꿨다 — 동작은 동일)
═══════════════════════════════════════════════════════════════ */

import { speakerMaterialsHtml } from './contact-speaker.js';
import { contactMailsHtml } from './contact-mails.js';
import {
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
  isConfirmedFor,
  mdbEvFilter,
  mdbView,
  mdbCat,
  mdbStat,
  mdbDomainFilter,
  mdbTypeFilter,
  setMdbEvFilter,
  setMdbTypeFilter,
  setMdbView,
  setMdbCat,
  setMdbStat,
  setMdbDomainFilter,
  CO_DB,
  COMPANY_SECTORS,
  DOMAINS,
  TAGS,
  mdbSelected,
  targets,
  getOrgById,
  hasLeft,
  movedTo,
  EXH_CONTACTS,
  EXHIBITORS,
  SPEAKERS,
  SPEAKER_CONTACTS,
  getSpeakerById,
  speakersOfContact,
  nextContactId,
  CONTACT_ATTEMPTS,
} from '../state.js';
import { CP, CL, RP, CAT_KEYS, ROLE_TO_CAT, COUNTRIES, avB, avF } from '../constants.js';
import { td, ab, phoneMatch, countryName, countryOptions, escapeHtml, escAttr, sectorKey, parseSectorScope, parseTags, joinTags, isMobile, cleanEmail, personName, personFullName, leftPill, slugifySectorName } from '../utils.js';
import { postToSheet } from '../api.js';
import { upsertSectorRow } from '../api/settings-save.js';
import { aiQueryPlan } from '../api/ai.js';
import { coDomainOptionsHtml, coSectorOptionsHtml, currentCoSectorPick } from './company-tab.js';
import { applyCoSectors } from '../features/companies/co-edit.js';
import { buildCoDB } from '../domain/co-db.js';
import { ensureOrgsForNames, orgIdForName } from '../domain/orgs.js';
import { domainOfSector, domainName, findSectorByName, mainSectors, UNASSIGNED_DOMAIN } from '../domain/sectors.js';
/* removed는 removeParticipation 안의 지역 변수와 이름이 겹친다 — 별칭으로 들여온다 */
import { trackAction, changed, removed as removedMeta } from '../core/audit-log.js';
import { sanitizeForCsv } from './audit-tab.js';
import { countryCheck, countryCheckText, continentOf, CONTINENT_ORDER } from '../country-signal.js';
/* 화면 상태는 ../features/mdb/mdb-ui.js의 mdbUi 한곳에 둔다 — 이 탭의 구획을 다른 파일로 떼어도 같은 값을 보게 */
import { mdbUi } from '../features/mdb/mdb-ui.js';

/* 이 사람의 국가가 자료와 어긋나는지 — 소속 기업 국가도 함께 넘겨야
   «기업에서 따라온 값 같아요»까지 말해 줄 수 있다 */
export function ctryCheck(c){
  const org = c && c.org_id ? getOrgById(c.org_id) : null;
  return countryCheck(c, org && (org.country || org.hq));
}
/* 연사의 국가는 «국적(거주지)»로 적는다.

   연사는 국적과 거주지가 다를 수 있고, 다를 때가 실제로 일이 갈리는
   지점이다 — 한국 국적이지만 미국에 사는 연사에게는 연사료를 해외 송금하고
   항공도 미국에서 띄운다. 마스터DB의 국가 칸 하나로는 그 사실이 안 보인다.

   연락처 자체의 country는 그대로 둔다. 여기서 바꾸는 건 표기뿐이고,
   값은 연사 줄(speakers.nationality / residence_country)에서 온다. */
export function contactCountryText(c){
  const sp = speakersOfContact(c.id).find(x => x.nationality || x.residence_country);
  if(!sp) return countryName(c.country);
  const nat = sp.nationality || c.country;
  const res = sp.residence_country;
  if(!res || countryName(res) === countryName(nat)) return countryName(nat || res);
  return `${countryName(nat)}(${countryName(res)})`;
}

/* 연락처 한 줄을 고쳐 저장한다 — 다른 탭도 쓴다.

   연락처는 칸이 스물세 개인데, 저장하는 자리마다 그 배열을 각자 조립하고
   있었다. 위치 배열은 안 보낸 칸을 비우므로 한 칸만 빠뜨려도 값이 지워진다 —
   실제로 org_id가 일곱 군데에서 지워지고 있었다. 그래서 여기 하나로 모은다.

   소속을 고치면 기업 연결(org_id)도 새 소속을 따라가야 한다. 안 그러면
   화면에는 새 회사 이름이 뜨는데 기업DB에서는 옛 회사에 매달려 있게 되고,
   기업DB에는 그 회사가 아예 안 생긴다. */
export async function patchContact(c, patch, label){
  if(!c) return { ok: false };
  const backup = {};
  Object.keys(patch).forEach(k => { backup[k] = c[k]; });
  const prevOrgId = c.org_id;
  Object.assign(c, patch);

  /* 새 소속 이름이 기업DB에 없으면 만들고 묶는다 */
  if(patch.orgKo || patch.orgEn){
    const nm = (patch.orgKo || patch.orgEn || '').trim();
    if(nm){
      try {
        await ensureOrgsForNames([nm]);
        const oid = orgIdForName(nm);
        if(oid) c.org_id = oid;
      } catch(e){ console.warn('[db-tab] 기업 재연결 실패:', e); }
    }
  }

  /* 바꾼 칸만 보낸다 — 전에는 23칸을 통째로 올려, 그 사이 남이 고친 메일·퇴사 표시를
     내 화면의 옛 값으로 되돌렸다 */
  const data = { id: c.id };
  Object.keys(patch).forEach(k => { if(CONTACT_COLS.has(k)) data[k] = c[k] ?? ''; });
  if(c.org_id !== prevOrgId) data.org_id = c.org_id || '';
  const r = await postToSheet({ sheet: 'contacts', action: 'upsert', data }, label || '연락처 수정');
  if(!r.ok){
    Object.assign(c, backup);
    c.org_id = prevOrgId;
    return r;
  }
  try { buildCoDB(); } catch(e){}
  try { renderMDB(); } catch(e){}
  return r;
}

export const ctryPill = (c) => {
  const r = ctryCheck(c);
  if(!r) return '';
  return ` <span class="pill p-amber" style="font-size:9px;cursor:help"
    title="${escapeHtml(countryCheckText(r))}">국가 확인</span>`;
};

/* 바뀐 칸만 골라낸다 — 연락처는 칸이 스물세 개라, 통째로 담으면 이름만 고쳐도
   기록 한 줄이 스물세 칸짜리가 된다. */
/* 연락처 표의 칸(서버 data.js contacts.columns) — 바꾼 칸만 골라 보낼 때 쓴다 */
const CONTACT_COLS = new Set(['nameKo', 'nameEn', 'orgKo', 'orgEn', 'titleKo', 'titleEn', 'deptKo', 'deptEn',
  'country', 'cat', 'lang', 'source', 'date', 'status', 'email1', 'email2', 'phone1', 'phone2',
  'beat', 'products', 'tags', 'org_id', 'left_at', 'moved_to_id', 'memo1', 'memo2', 'memo3', 'prefix']);
export const contactPatch = (c, before) => {
  const data = { id: c.id };
  // before에 담긴 칸만 견준다 — 스냅샷이 일부(퇴사 칸 둘)면 나머지는 안 보낸다
  Object.keys(before).forEach(k => { if(CONTACT_COLS.has(k) && String(before[k] ?? '') !== String(c[k] ?? '')) data[k] = c[k] ?? ''; });
  return data;
};
export const pickChanged = (before, after) => Object.keys(after).reduce((o, k) => {
  if(typeof after[k] !== 'object' && String(before[k] ?? '') !== String(after[k] ?? '')) o[k] = after[k] ?? '';
  return o;
}, {});

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
export function isBDContact(c){
  return hasTag(c, 'bd');
}
export function isCLevelContact(c){
  if(!c) return false;
  if(hasTag(c, 'clevel')) return true;
  const t = `${c.titleKo||''} ${c.titleEn||''}`.toLowerCase();
  return C_LEVEL_KEYWORDS.some(k => t.includes(k));
}
/* mdbCat이 카테고리 키가 아니면(그리고 'all'도 아니면) 등록된 태그(TAGS) 키를
   가리키는 것으로 취급한다 — 태그는 cat과 달리 다른 카테고리와 배타적이지 않다
   (BD이면서 동시에 attendee일 수 있음).

   전에는 이 목록이 speaker·vip·attendee 셋뿐이라, 사이드바에서 스폰서·투자자·
   바이어로 거르면 카테고리가 아니라 태그로 오인돼 아무것도 안 나왔다. */
export const MDB_CAT_VALUES = CAT_KEYS;
export function matchesTagFilter(c, tagKey){
  return tagKey === 'clevel' ? isCLevelContact(c) : hasTag(c, tagKey);
}
/* 선택된 연락처들의 tags에서 name을 추가/제거 */
export function setContactTag(c, name, add){
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
/* 그 사람이 다녀온 행사의 분야 — 소속 기업의 섹터와는 다른 근거다.
   대학 교수는 건축 행사에도 바이오 행사에도 온다. 기업 섹터만 보면
   그 사람은 늘 «대학·연구소»지, 어느 자리에서 만났는지는 안 보인다.

   마스터DB는 한 행사의 명단이 아니라 여러 행사에 걸쳐 쓰는 창고라,
   다음 행사에 부를 사람을 고를 때 이쪽이 더 정확할 때가 많다. */
function eventDomainsOf(cid){
  const out = new Set();
  participations.filter(p => String(p.contactId) === String(cid)).forEach(p => {
    const ev = EVENT_LIST.find(e => e.key === p.eventId);
    String(ev && ev.domain || '').split('|').map(v => v.trim()).filter(Boolean)
      .forEach(d => out.add(d));
  });
  return [...out];
}

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
  /* 기업이 없는 사람도 행사 이력으로는 분야를 안다 — 기업에 안 묶였다고
     «미분류»로 떨어뜨리면, 명단에 멀쩡히 있는 사람을 다음에 못 찾는다. */
  contacts.forEach(c => {
    const evd = eventDomainsOf(c.id);
    if(!evd.length) return;
    const cur = map.get(c.id) || [];
    map.set(c.id, [...new Set([...cur, ...evd])]);
  });
  return map;
}

/* ══════════════════════════════════════════
   행사 칩 목록 (원본 1745~1764행)
══════════════════════════════════════════ */
export function buildMDBEvList(){
  const el = document.getElementById('mdb-ev-list');
  if(!el) return;
  /* 분야를 골라 뒀으면 그 안의 사람만 센다 — 아래 칩들은 모두 같은 범위다 */
  const scoped = new Set(domainScope(contacts).map(c => String(c.id)));
  const inScope = (p) => scoped.has(String(p.contactId));
  const usedEvs = EVENT_LIST.filter(e => participations.some(p => p.eventId === e.key && inScope(p)));
  el.innerHTML =
    `<button class="ev-chip${!mdbEvFilter?' on':''}" onclick="setMDBEv(null)">
      <span class="ev-chip-dot" style="background:var(--i4)"></span>
      <span class="ev-chip-nm">전체 행사</span>
      <span class="ev-chip-ct">${scoped.size}명</span>
    </button>` +
    usedEvs.map(e => {
      const cnt = [...new Set(participations.filter(p=>p.eventId===e.key && inScope(p)).map(p=>p.contactId))].length;
      return `<button class="ev-chip${mdbEvFilter===e.key?' on':''}" onclick="setMDBEv('${escAttr(e.key)}')">`+
        `<span class="ev-chip-dot" style="background:${e.color}"></span>`+
        `<span class="ev-chip-nm">${escapeHtml(e.short)}</span>`+
        `<span class="ev-chip-ct">${cnt}명</span>`+
        `</button>`;
    }).join('');
}
export function setMDBEv(ev){
  setMdbEvFilter(ev);
  /* 행사를 바꾸면 그 행사에 없는 유형이 걸린 채로 남아 «0명»이 된다 —
     칩은 켜져 있는데 목록만 비어서, 왜 아무것도 없는지 알 길이 없다. */
  if(mdbTypeFilter && ev && !participations.some(p => p.eventId === ev && (p.role||'') === mdbTypeFilter)){
    setMdbTypeFilter(null);
  }
  buildMDBEvList(); renderMDB();
}
export function setMDBType(t){ setMdbTypeFilter(t || null); renderMDB(); }

/* ══════════════════════════════════════════
   목록 위의 가로 거르개 — 행사와 참가 유형

   행사 칩은 사이드바에도 있지만, 사이드바를 접어 두고 쓰는 일이 많아
   목록만 보고 있으면 지금 무엇으로 걸러져 있는지가 안 보인다. 그리고
   참가 유형은 어디에도 거르개가 없었다 — 표의 «행사» 칸에 적혀 있는데
   그걸로 좁힐 수가 없으니, 바이어만 추리려면 눈으로 훑어야 했다.

   유형 칩은 지금 걸린 행사 안에서 실제로 쓰인 것만 띄운다. 쓰지도 않는
   유형이 0명으로 늘어서 있으면 고를 것을 찾는 데 방해만 된다.
══════════════════════════════════════════ */
export function buildMDBFilterBar(){
  const el = document.getElementById('mdb-filterbar');
  if(!el) return;

  const usedEvs = EVENT_LIST.filter(e => participations.some(p => p.eventId === e.key));
  const scope = mdbEvFilter ? participations.filter(p => p.eventId === mdbEvFilter) : participations;

  // 유형별 «사람 수» — 한 사람이 한 행사에 두 역할로 들어가도 두 번 세지 않는다
  const byType = new Map();
  scope.forEach(p => {
    const k = p.role || '참가자';
    if(!byType.has(k)) byType.set(k, new Set());
    byType.get(k).add(p.contactId);
  });
  // PART_TYPES 순서를 따르고, 목록에 없는 값이 들어와 있으면 뒤에 붙인다
  const typeKeys = [
    ...PART_TYPES.map(t => t.key).filter(k => byType.has(k)),
    ...[...byType.keys()].filter(k => !PART_TYPES.some(t => t.key === k)),
  ];

  const evTotal = mdbEvFilter
    ? new Set(scope.map(p => p.contactId)).size
    : contacts.length;

  const chip = (on, onclick, dot, label, count) =>
    `<button class="seg-b${on ? ' on' : ''}" onclick="${onclick}" style="display:inline-flex;align-items:center;gap:5px">`
    + (dot ? `<span style="width:6px;height:6px;border-radius:50%;background:${dot};flex:none"></span>` : '')
    + `${escapeHtml(label)}<span style="color:var(--i4);font-size:10px">${count}</span></button>`;

  const evChips = chip(!mdbEvFilter, 'setMDBEv(null)', '', '전체 행사', contacts.length)
    + usedEvs.map(e => chip(mdbEvFilter === e.key, `setMDBEv('${escAttr(e.key)}')`, e.color, e.short,
        new Set(participations.filter(p => p.eventId === e.key).map(p => p.contactId)).size)).join('');

  const typeChips = chip(!mdbTypeFilter, 'setMDBType(null)', '', '전체 유형', evTotal)
    + typeKeys.map(k => {
        const t = PART_TYPES.find(x => x.key === k);
        return chip(mdbTypeFilter === k, `setMDBType('${escAttr(k)}')`, '', t ? t.label : k,
          byType.get(k).size);
      }).join('');

  el.innerHTML =
    `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
       <span style="font-size:10px;color:var(--i4);flex:none">행사</span>
       <div class="seg" style="flex-wrap:wrap">${evChips}</div>
     </div>
     <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
       <span style="font-size:10px;color:var(--i4);flex:none">유형</span>
       <div class="seg" style="flex-wrap:wrap">${typeChips}</div>
     </div>`;
}

/* ══════════════════════════════════════════
   분야별 보기 (신규) — 행사별 보기와 같은 칩 UI 패턴.
   연락처 소속 기업의 섹터가 속한 분야(BIO/VC/... , DOMAINS)를 기준으로
   필터링한다. 행사별/카테고리/상태 필터와 함께(AND) 적용된다. */
/* ══════════════════════════════════════════
   지역별 보기 — 국내 / 해외 / 미상

   국내와 해외는 일하는 방식이 통째로 갈린다. 초청장 언어, 비자 안내, 보내는
   시각, 항공·숙박을 우리가 잡는지. 그래서 «해외만»을 한 번에 보는 자리가
   먼저 필요하고, 그 안에서 나라를 가른다.

   미상을 숨기지 않는다. 국가가 비어 있는 사람은 국내도 해외도 아닌 채로
   국내 목록에도 해외 목록에도 안 나오는데, 안 보이면 영영 안 채워진다.

   나라 이름은 적힌 값을 그대로 세지 않고 countryName으로 한 번 눌러서 센다 —
   «Korea»와 «대한민국»과 «KR»이 서로 다른 줄로 갈리면 나라별로 세는 뜻이 없다.
══════════════════════════════════════════ */
export const HOME_COUNTRY = '대한민국';
const ctryOf = (c) => countryName(String(c.country || '').trim());
export const regionOf = (c) => {
  const v = String(c.country || '').trim();
  /* «-»도 비어 있는 것이다. 불러올 때 빈 국가를 countryName이 «-»로 바꿔 놓는데
     (화면에 «-»로 찍으려고), 그걸 나라 이름으로 보면 «해외 -  7명» 같은 줄이
     생기고 «국가 미상»은 0이 된다 — 채워야 할 사람이 화면에서 사라진다. */
  if(!v || v === '-') return 'unknown';
  return ctryOf(c) === HOME_COUNTRY ? 'home' : 'abroad';
};

export function setMDBRegion(v){
  mdbUi.mdbRegion = mdbUi.mdbRegion === v ? null : v;
  buildMDBRegionList();
  renderMDB();
}

/* ── 분야가 맨 위 축이다 ──
   사이드바가 행사·지역·분야 순이던 시절에는 셋이 서로 남남이라, 분야를
   눌러 놓고 지역 칩을 보면 그 숫자는 여전히 전체 인원이었다. 743명 중
   건축 95명을 보고 있는데 «북미 15명»이라 적혀 있으면, 그 15명이 건축의
   15명인지 전체의 15명인지 알 수가 없다.

   이제 분야를 먼저 고르고 그 안에서 국가·행사·카테고리·태그로 좁힌다.
   아래 목록들은 모두 이 범위 안에서 센다. 분야 목록 자신만 늘 전체를
   세는데, 그게 맨 위 축이기 때문이다 — 제 숫자가 제 선택에 따라 변하면
   어디로 갈 수 있는지를 알 수 없다. */
function domainScope(list){
  if(!mdbDomainFilter) return list;
  const map = buildContactDomainMap();
  return list.filter(c => {
    const doms = map.get(c.id) || [];
    return mdbDomainFilter === UNASSIGNED_DOMAIN ? doms.length === 0 : doms.includes(mdbDomainFilter);
  });
}

export function buildMDBRegionList(){
  const el = document.getElementById('mdb-region-list');
  if(!el) return;
  const base = domainScope(contacts);
  const n = (f) => base.filter(f).length;
  const chip = (key, label, cnt, dot, indent) =>
    `<button class="ev-chip${mdbUi.mdbRegion === key ? ' on' : ''}" onclick="setMDBRegion(${key === null ? 'null' : `'${escAttr(key)}'`})"${
      indent ? ' style="padding-left:20px"' : ''}>
      <span class="ev-chip-dot" style="background:${dot}"></span>
      <span class="ev-chip-nm">${escapeHtml(label)}</span>
      <span class="ev-chip-ct">${cnt}명</span>
    </button>`;

  /* 해외는 대륙으로 묶는다. 나라별로 펼쳤더니 1명짜리가 열두 줄이었다 —
     대만 1, 독일 1, 스위스 1, 싱가포르 1… 세어 볼 수는 있어도 «유럽에서 몇 명
     오나»를 못 본다. 초청·항공·시차는 나라가 아니라 대륙 단위로 움직인다.

     특정 나라를 찾을 일은 검색창이 받는다 — «국가:싱가포르»로 찾으면 된다. */
  const byCont = new Map();
  base.filter(c => regionOf(c) === 'abroad').forEach(c => {
    const k = continentOf(ctryOf(c));
    byCont.set(k, (byCont.get(k) || 0) + 1);
  });
  const conts = CONTINENT_ORDER.filter(k => byCont.has(k));
  const unknown = n(c => regionOf(c) === 'unknown');

  el.innerHTML =
    chip(null, '전체', base.length, 'var(--i4)')
    + chip('home', '국내', n(c => regionOf(c) === 'home'), 'var(--a)')
    + chip('abroad', '해외', n(c => regionOf(c) === 'abroad'), 'var(--g)')
    + conts.map(k => chip('k:' + k, k, byCont.get(k), 'var(--g)', true)).join('')
    + (unknown ? chip('unknown', '국가 미상', unknown, 'var(--am)') : '');
}

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
      return `<button class="ev-chip${mdbDomainFilter===d.id?' on':''}" onclick="setMDBDomain('${escAttr(d.id)}')"`+
        ` ondragover="onMDBDragOver(event,this)" ondragleave="onMDBDragLeave(this)"`+
        ` ondrop="onMDBDropToDomain(event,'${escAttr(d.id)}',this)" title="여기에 끌어다 놓으면 이 분야로 옮겨요">`+
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
export function sortMDBBy(col){
  if(mdbUi.mdbSortCol === col) mdbUi.mdbSortDir = -mdbUi.mdbSortDir;
  else { mdbUi.mdbSortCol = col; mdbUi.mdbSortDir = 1; }
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
export function applyMDBSort(pairs){
  const keyFn = MDB_SORT_KEYS[mdbUi.mdbSortCol];
  if(!keyFn) return pairs;
  /* 값을 먼저 한 번씩 뽑는다 — 비교마다 뽑으면 «행사» 정렬이 비교 횟수만큼 참가 표 전체를 훑었다 */
  let evCount = null;
  if(mdbUi.mdbSortCol === 'events'){
    const m = new Map();
    participations.forEach(x => { const k = String(x.contactId); if(!m.has(k)) m.set(k, new Set()); if(x.eventId) m.get(k).add(x.eventId); });
    evCount = (c) => (m.get(String(c.id)) || new Set()).size;
  }
  const keyed = pairs.map(x => ({ x, k: evCount && !x.p ? evCount(x.c) : keyFn(x) }));
  keyed.sort((a, b) => a.k < b.k ? -mdbUi.mdbSortDir : a.k > b.k ? mdbUi.mdbSortDir : 0);
  return keyed.map(y => y.x);
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
/* ── 줄 고르기 ──
   하나 누르고 Shift를 누른 채 아래를 누르면 그 사이가 전부 딸려 온다.
   백 명을 고르려면 백 번 눌러야 했다 — 표를 쓰는 사람은 파일 탐색기에서
   하던 손버릇을 여기서도 쓴다.

   «그 사이»는 지금 화면에 보이는 차례를 말한다. 정렬을 바꾸거나 걸러낸
   뒤에는 보이는 차례가 곧 사람이 생각하는 차례라, 원본 순서로 세면
   엉뚱한 사람들이 딸려 온다. 그래서 그릴 때 차례를 적어 둔다. */

export function setMDBRowOrder(ids){ mdbUi.mdbRowOrder = ids; }

export function toggleMDBSelect(id, ev){
  const turningOn = !mdbSelected.has(id);

  if(ev && ev.shiftKey && mdbUi.mdbAnchorId != null && mdbUi.mdbAnchorId !== id){
    const a = mdbUi.mdbRowOrder.indexOf(mdbUi.mdbAnchorId);
    const b = mdbUi.mdbRowOrder.indexOf(id);
    if(a >= 0 && b >= 0){
      /* 기준부터 지금 누른 줄까지를 «켠다». 누른 줄이 이미 켜져 있다고 해서
         그 사이를 끄지는 않는다 — 범위 안을 다시 눌렀을 때 앞쪽이 통째로
         풀리면, 무엇을 고르고 있었는지가 한 번에 날아간다. 풀 때는 한 줄씩
         누르거나 «선택 해제»를 쓴다. */
      const [from, to] = a < b ? [a, b] : [b, a];
      for(let i = from; i <= to; i++) mdbSelected.add(mdbUi.mdbRowOrder[i]);
      renderMDB();
      return;   // 기준은 그대로 둔다 — 같은 자리에서 범위를 넓혔다 줄일 수 있다
    }
  }

  if(turningOn) mdbSelected.add(id);
  else mdbSelected.delete(id);
  mdbUi.mdbAnchorId = id;
  renderMDB();
}
export function clearMDBSelection(){
  mdbSelected.clear();
  renderMDB();
}
/* 현재 필터링돼서 보이는 목록 전체를 선택/해제 — 화면에 없는(필터에 안 걸린)
   사람은 건드리지 않는다. */
export function toggleMDBSelectAll(checked){
  const pairs = window.getMDBPairs();
  if(checked) pairs.forEach(({c}) => mdbSelected.add(c.id));
  else pairs.forEach(({c}) => mdbSelected.delete(c.id));
  renderMDB();
}
/* ══════════════════════════════════════════
   모바일 — 길게 눌러 고르기

   좁은 화면에서 고를 수 있는 자리는 이름 아바타 하나뿐이었다. 28px짜리 동그라미를
   정확히 눌러야 하는데, 조금만 빗나가면 드로어가 열린다. 여러 명을 고르려면 그
   실수를 사람 수만큼 반복하게 된다.

   그래서 카드를 길게 누르면 골라진다. 한 명이라도 골라져 있으면 그때부터는 톡
   누르는 것도 고르기다 — 휴대폰 사진첩과 같은 방식이라 따로 배울 게 없다.
   다 풀면 톡 누르기는 다시 드로어를 연다.

   손가락이 움직이면 취소한다. 목록을 넘기려고 쓸어내린 것을 «길게 누름»으로
   잡으면, 스크롤할 때마다 엉뚱한 사람이 골라진다.
══════════════════════════════════════════ */
const LONG_PRESS_MS = 450;

/* 인라인 핸들러가 ${c.id}를 따옴표 없이 넣으므로 id는 숫자다. dataset은 늘
   문자열이라 되돌려 놓지 않으면 Set 안에서 다른 값이 된다. */
const cidOf = (v) => (/^-?\d+$/.test(v) ? Number(v) : v);
const mdbCardOf = (t) => (t && t.closest ? t.closest('.mdbc[data-cid]') : null);
const cancelLongPress = () => { if(mdbUi.lpTimer){ clearTimeout(mdbUi.lpTimer); mdbUi.lpTimer = null; } };

function initMDBLongPress(){
  document.addEventListener('touchstart', (e) => {
    if(!isMobile()) return;
    const card = mdbCardOf(e.target);
    if(!card) return;
    cancelLongPress();
    mdbUi.lpTimer = setTimeout(() => {
      mdbUi.lpTimer = null;
      mdbUi.lpSwallowClick = true;        // 손을 뗄 때 따라오는 click은 삼킨다
      navigator.vibrate?.(15);
      toggleMDBSelect(cidOf(card.dataset.cid));
    }, LONG_PRESS_MS);
  }, { passive: true });

  ['touchmove', 'touchend', 'touchcancel'].forEach(ev =>
    document.addEventListener(ev, cancelLongPress, { passive: true }));

  document.addEventListener('click', (e) => {
    if(mdbUi.lpSwallowClick){ mdbUi.lpSwallowClick = false; e.stopPropagation(); e.preventDefault(); return; }
    if(!isMobile() || !mdbSelected.size) return;
    const card = mdbCardOf(e.target);
    if(!card) return;
    // 아바타에는 이미 자기 핸들러가 있다 — 여기서 또 뒤집으면 두 번 눌린 셈이 된다
    if(e.target.closest('.tdav')) return;
    // 전화·메일 같은 바로가기는 고르기보다 우선한다
    if(e.target.closest('a')) return;
    e.stopPropagation(); e.preventDefault();
    toggleMDBSelect(cidOf(card.dataset.cid));
  }, true);

  /* 길게 누를 때 뜨는 기본 메뉴(복사·공유)를 막는다 — 고르기와 겹쳐서
     둘 다 제대로 안 된다 */
  document.addEventListener('contextmenu', (e) => {
    if(isMobile() && mdbCardOf(e.target)) e.preventDefault();
  });
}
initMDBLongPress();

export function renderMDBSelectionBar(){
  const el = document.getElementById('mdb-bulkbar');
  if(!el) return;
  const n = mdbSelected.size;
  if(!n){ el.style.display = 'none'; el.innerHTML=''; return; }
  el.style.display = 'flex';
  el.innerHTML = `
    <span style="font-size:12px;font-weight:600;color:var(--i1)">${n}명 선택됨</span>${
      isMobile() ? '<span style="font-size:10.5px;color:var(--i5)">탭하면 선택·해제 · 길게 눌러 시작</span>' : ''}
    <button class="btn bp bs" onclick="openMDBBulkEditModal()">기업명/카테고리/국가/상태 일괄 변경</button>
    <button class="btn bs" onclick="openMDBToCrmModal()"
      title="고른 사람들을 행사 참가자로 올리고, 소속 기업을 CRM 타겟으로 잡습니다">행사에 초청</button>
    <button class="btn bs" style="color:var(--re);border-color:var(--re)" onclick="bulkDeleteMDBContacts()">선택 삭제</button>
    <button class="btn bs" style="margin-left:auto" onclick="clearMDBSelection()">선택 해제</button>
  `;
}

/* «마스터DB 선택 → 초청·일괄 고치기·지우기»은 ../features/mdb/mdb-bulk.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* ══════════════════════════════════════════
   사이드바의 거르개들 — 한 군데서만 판단한다

   목록을 만드는 자리가 셋이다: 전체 보기(getMDBPairs)와, 행사별 그룹 보기의
   표와 카드. 그런데 그룹 보기 둘은 participations에서 제 목록을 따로 만들면서
   상태와 검색어만 걸고 있었다. 그래서 지역·분야·국가 확인을 눌러도 아무 일도
   안 일어났다 — 칩은 켜지는데 목록은 그대로라, 고장 난 줄도 모르고 그냥 안 쓰게 된다.

   거르는 규칙을 여기 하나로 둔다. 거르개가 늘 때 세 곳을 고치는 일이 없어진다.
══════════════════════════════════════════ */
/* ══════════════════════════════════════════
   검색 — 여러 낱말과 «칸:값»

   이름·기업·직함만 훑고 있었다. 그래서 «싱가포르에 있는 사람»도 «gmail 쓰는
   사람»도 못 찾았고, 낱말을 둘 넣으면 그 통짜 문장을 찾느라 아무것도 안 나왔다.

   낱말은 띄어 쓰면 «그리고»다 — «파렉셀 팀장»은 둘 다 맞는 사람. 앞에 칸 이름을
   붙이면 그 칸만 본다: «국가:싱가포르», «이메일:.kr», «태그:BD». 칸 이름은
   한글로도 영문으로도 받는다 — 외우게 하지 않는다.

   칸을 안 붙이면 사람에 관한 거의 모든 칸을 훑는다. 좁히고 싶을 때만 붙이면 된다.
══════════════════════════════════════════ */
const Q_FIELDS = {
  이름: ['nameKo', 'nameEn'], name: ['nameKo', 'nameEn'],
  기업: ['orgKo', 'orgEn'],   org: ['orgKo', 'orgEn'], company: ['orgKo', 'orgEn'],
  국가: ['country'],          country: ['country'],
  직함: ['titleKo', 'titleEn'], title: ['titleKo', 'titleEn'],
  부서: ['deptKo', 'deptEn'], dept: ['deptKo', 'deptEn'],
  이메일: ['email1', 'email2'], email: ['email1', 'email2'], mail: ['email1', 'email2'],
  연락처: ['phone1', 'phone2'], phone: ['phone1', 'phone2'],
  태그: ['tags'], tag: ['tags'],
  분야: ['beat'], 품목: ['products'],
  메모: ['memo1', 'memo2', 'memo3'], memo: ['memo1', 'memo2', 'memo3'],
  경칭: ['prefix'], prefix: ['prefix'],
  출처: ['source'], source: ['source'],
  상태: ['status'], 언어: ['lang'],
};
const ALL_Q = ['nameKo', 'nameEn', 'orgKo', 'orgEn', 'titleKo', 'titleEn',
  'deptKo', 'deptEn', 'country', 'email1', 'email2', 'phone1', 'phone2',
  'tags', 'beat', 'products', 'source', 'memo1', 'memo2', 'memo3', 'prefix'];
const hay = (c, keys) => keys.map(k => String(c[k] ?? '')).join(' ').toLowerCase();

export function matchesQuery(c, q){
  /* 번호 모양 검색어는 통째로 번호로 견준다 — «010 1234 5678»을 칸마다 끊어
     보면 엉뚱한 사람이 걸리고, 하이픈 유무만 달라도 못 찾는다 */
  if(phoneMatch(q, c.phone1, c.phone2)) return true;
  const terms = String(q || '').trim().split(/\s+/).filter(Boolean);
  if(!terms.length) return true;
  return terms.every(t => {
    const m = t.match(/^([^:：]+)[:：](.*)$/);
    if(m && Q_FIELDS[m[1]]){
      const v = m[2].toLowerCase();
      return !v || hay(c, Q_FIELDS[m[1]]).includes(v);   // «국가:»만 치면 거르지 않는다
    }
    return hay(c, ALL_Q).includes(t.toLowerCase());
  });
}

/* 지금 검색창에 뭐라도 쳐 있나 — 필터·배지·건수가 같은 값을 봐야 숫자가
   서로 어긋나지 않는다. */
export const mdbQuery = () => String((document.getElementById('mdb-q')||{}).value || '').trim();

/* 퇴사자를 목록에서 내릴 자리인가.

   내리는 건 «연락할 사람을 고르는 목록»일 때뿐이다. 세 경우엔 내리지 않는다.
   - 칩을 눌러 직접 펴 봤을 때
   - 행사별 보기 — 그 행사에 온 건 지금도 사실이라, 빼면 몇 해 전 참가자
     명단이 실제와 달라진다
   - 검색 중일 때 — 이름을 콕 집어 찾는 건 «숨겨둔 것까지 보여달라»는 뜻이다.
     여기서 빼면 «분명히 있었는데 검색이 안 되네» 하고 같은 사람을 또 등록하게
     된다. 찾는 걸 막는 건 감추는 것보다 나쁘다. */
export const hidingLeft = () => !mdbUi.mdbShowLeft && !mdbEvFilter && !mdbQuery() && !(mdbUi.mdbAi && mdbUi.mdbAi.plan.include_left);

/* ══════════════════════════════════════════
   질문으로 찾기 — «작년 KIC 연사 중 올해 안 온 미국 사람»
   질문을 서버(routes/ai.js /query-plan)가 Claude에게 보내 «조건표»로 받아 온다.
   연락처는 보내지 않는다 — 행사·역할·카테고리·태그·국가 이름과 질문만 간다.
   거르기는 여기서 제 데이터로 한다. 사이드바 거르개·검색어와 «그리고»로 겹친다.
══════════════════════════════════════════ */
function aiMatches(c, plan){
  const parts = participations.filter(p => p.contactId === c.id);
  const anyEv = plan.events_any || [], allEv = plan.events_all || [], noEv = plan.events_none || [], roles = plan.roles || [];
  if(allEv.length && !allEv.every(e => parts.some(p => p.eventId === e))) return false;
  const evScope = [...anyEv, ...allEv];
  if(evScope.length){
    const hit = parts.filter(p => evScope.includes(p.eventId));
    if(!hit.length) return false;
    if(roles.length && !hit.some(p => roles.includes(p.role || '참가자'))) return false;
  } else if(roles.length && !parts.some(p => roles.includes(p.role || '참가자'))) return false;
  if(noEv.length && parts.some(p => noEv.includes(p.eventId))) return false;
  if((plan.cats || []).length && !plan.cats.some(k => c.cat === k || parts.some(p => ROLE_TO_CAT[p.role] === k))) return false;
  if((plan.tags || []).length && !plan.tags.some(t => matchesTagFilter(c, t))) return false;
  if(plan.clevel && !isCLevelContact(c)) return false;
  if((plan.countries || []).length && !plan.countries.includes(String(c.country || ''))) return false;
  const has = (keys, words) => { const h = hay(c, keys); return words.some(w => h.includes(String(w).toLowerCase())); };
  if((plan.org_keywords || []).length && !has(['orgKo', 'orgEn'], plan.org_keywords)) return false;
  if((plan.title_keywords || []).length && !has(['titleKo', 'titleEn'], plan.title_keywords)) return false;
  return true;
}
export async function askMdbAi(){
  const inp = document.getElementById('mdb-ai-q');
  const q = String(inp?.value || '').trim();
  if(!q) return;
  renderMdbAiBar('✨ 질문을 조건으로 바꾸는 중…');
  const r = await aiQueryPlan({
    question: q,
    today: new Date().toISOString().slice(0, 10),
    events: EVENT_LIST.map(e => ({ key: e.key, short: e.short || '', date: e.date || '' })),
    roles: [...new Set(['참가자', ...PART_TYPES.map(t => t.key), ...participations.map(p => p.role).filter(Boolean)])],
    cats: CAT_KEYS.map(k => ({ key: k, label: CL[k] || k })),
    tags: TAGS.map(t => ({ key: t.key, label: t.label || t.key })),
    countries: [...new Set(contacts.map(c => String(c.country || '').trim()).filter(Boolean))],
  });
  if(!r.ok){ renderMdbAiBar('<span style="color:var(--re)">찾지 못했어요: ' + escapeHtml(r.error || '') + '</span>'); return; }
  mdbUi.mdbAi = { q, plan: r.plan };
  renderMDB();
}
export function clearMdbAi(){
  mdbUi.mdbAi = null;
  const inp = document.getElementById('mdb-ai-q');
  if(inp) inp.value = '';
  renderMDB();
}
function renderMdbAiBar(msg){
  const el = document.getElementById('mdb-ai-msg');
  if(!el) return;
  if(msg){ el.innerHTML = msg; return; }
  if(!mdbUi.mdbAi){ el.innerHTML = ''; return; }
  const p = mdbUi.mdbAi.plan;
  const evs = (k) => (p[k] || []).map(e => escapeHtml(evShort(e))).join(', ');
  const bits = [
    p.events_any?.length ? '참가: ' + evs('events_any') : '',
    p.events_all?.length ? '모두 참가: ' + evs('events_all') : '',
    p.events_none?.length ? '불참: ' + evs('events_none') : '',
    p.roles?.length ? '역할: ' + escapeHtml(p.roles.join(', ')) : '',
    p.cats?.length ? '카테고리: ' + escapeHtml(p.cats.map(k => CL[k] || k).join(', ')) : '',
    p.tags?.length ? '태그: ' + escapeHtml(p.tags.join(', ')) : '',
    p.clevel ? 'C-level' : '',
    p.countries?.length ? '국가: ' + escapeHtml(p.countries.join(', ')) : '',
    p.org_keywords?.length ? '기업: ' + escapeHtml(p.org_keywords.join('/')) : '',
    p.title_keywords?.length ? '직함: ' + escapeHtml(p.title_keywords.join('/')) : '',
    p.include_left ? '퇴사자 포함' : '',
  ].filter(Boolean);
  el.innerHTML = `<span class="pill p-blue" style="cursor:default" title="${escapeHtml(mdbUi.mdbAi.q)}">✨ ${escapeHtml(p.explain || mdbUi.mdbAi.q)}</span>
    <span style="color:var(--i4)">${bits.join(' · ')}</span>
    ${p.unsupported ? `<span style="color:var(--am)">⚠️ 반영 못 한 조건: ${escapeHtml(p.unsupported)}</span>` : ''}
    <button class="btn bs" style="font-size:10.5px" onclick="clearMdbAi()">✕ 질문 지우기</button>`;
}

export function mdbFilterPairs(pairs){
  let out = pairs;
  /* 참가 유형 — p가 있으면 그 줄의 역할을, 없으면(전체 보기) 그 사람의
     참가 이력 어딘가에 그 역할이 있는지를 본다. */
  if(mdbTypeFilter){
    out = out.filter(({ c, p }) => p
      ? (p.role || '참가자') === mdbTypeFilter
      : participations.some(x => x.contactId === c.id && (x.role || '참가자') === mdbTypeFilter));
  }
  if(hidingLeft()) out = out.filter(({ c }) => !hasLeft(c));
  if(mdbUi.mdbAi) out = out.filter(({ c }) => aiMatches(c, mdbUi.mdbAi.plan));
  if(mdbStat) out = out.filter(({ c }) => c.status === mdbStat);
  if(mdbUi.mdbCtryOnly) out = out.filter(({ c }) => !!ctryCheck(c));
  if(mdbUi.mdbRegion) out = out.filter(({ c }) =>
      mdbUi.mdbRegion.startsWith('k:') ? regionOf(c) === 'abroad' && continentOf(ctryOf(c)) === mdbUi.mdbRegion.slice(2)
    : mdbUi.mdbRegion.startsWith('c:') ? ctryOf(c) === mdbUi.mdbRegion.slice(2)
    : regionOf(c) === mdbUi.mdbRegion);
  if(mdbDomainFilter){
    const domainMap = buildContactDomainMap();
    out = out.filter(({ c }) => {
      const doms = domainMap.get(c.id) || [];
      return mdbDomainFilter === UNASSIGNED_DOMAIN ? doms.length === 0 : doms.includes(mdbDomainFilter);
    });
  }
  return out;
}

/* 모바일 검색칸 — 상단바(.tb)가 모바일에서 통째로 숨겨져 데스크톱 검색창을
   쓸 수 없다(헤더의 돋보기가 숨은 칸에 focus를 걸고 있어 아무 일도 안 일어났다).
   검색어는 데스크톱 칸 하나로 모아 둔다 — 읽는 자리가 여섯 군데라, 둘이 서로
   다른 값을 들고 있으면 어느 쪽이 지금 걸린 조건인지 알 수 없다. */
export function searchMdbM(v){
  const d = document.getElementById('mdb-q');
  if(d) d.value = v;
  renderMDB();
}

export function renderMDB(){
  const pairs = window.getMDBPairs();
  renderCtryChip();
  renderLeftChip();
  renderMdbAiBar();
  buildMDBFilterBar();
  /* 행사 목록도 여기서 다시 그린다 — 분야를 바꾸면 그 안의 인원으로 세어야
     하는데, 지금까지는 행사를 고를 때만 그려서 숫자가 옛것으로 남아 있었다. */
  buildMDBEvList();
  buildMDBRegionList();
  buildMDBDomainList();
  buildMDBTagList();
  renderMDBSelectionBar();

  const ctEl = document.getElementById('db-ct');
  if(ctEl){
    /* 목록에 퇴사자가 섞여 있으면 몇 명인지 적는다 — 평소엔 안 보이던 사람이
       갑자기 끼어 있으면 «왜 나왔지»가 되고, 세어 보기 전엔 알 수도 없다. */
    const leftN = pairs.filter(({ c }) => hasLeft(c)).length;
    const suffix = leftN ? ` · 퇴사 ${leftN}명 포함` : '';
    ctEl.textContent = mdbEvFilter
      ? `${pairs.length}명 (${evShort(mdbEvFilter)})${suffix}`
      : `${pairs.length}명${suffix}`;
  }

  // 모바일은 좁아서 표 대신 카드로 그린다(교차표는 원래 가로 스크롤이 전제라 그대로)
  /* 다른 보기로 넘어갔을 때 옛 차례가 남아 있으면 Shift가 엉뚱한 줄을 집는다.
     목록 보기는 제 안에서 정렬한 차례로 다시 적는다. */
  setMDBRowOrder(pairs.map(({ c }) => c.id));

  const mob = isMobile();
  if(mdbView==='group')  { if (mob) window.renderMDBGroupedCards(pairs); else window.renderMDBGrouped(pairs); }
  else if(mdbView==='matrix') window.renderMDBMatrix();
  else { if (mob) window.renderMDBFlatCards(pairs); else window.renderMDBFlat(pairs); }

  updateMDBBadges(pairs);
}

/* 몇 명이 걸리는지 세어 칩에 적는다 — 0명이면 칩을 아예 안 띄운다.
   할 일이 없는 날에도 자리를 차지하면 그 줄 전체를 안 보게 된다. */
function renderCtryChip(){
  const el = document.getElementById('mdb-ctry-chip');
  if(!el) return;
  const n = contacts.filter(c => ctryCheck(c)).length;
  if(!n && !mdbUi.mdbCtryOnly){ el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';
  el.innerHTML = `<button class="pill ${mdbUi.mdbCtryOnly ? 'p-amber' : 'p-gray'}"
    style="border:0;cursor:pointer;font:inherit"
    title="전화 국가번호·이메일 국가 도메인이 적힌 국가와 다른 사람이에요. 눌러서 그 사람만 봅니다."
    onclick="toggleMdbCtry()">국가 확인 ${n}</button>`;
}

/* 퇴사자가 몇 명 빠졌는지 — 목록에서 조용히 사라지면 «있었는데 없어졌다»가
   된다. 숫자를 적어 두고, 누르면 함께 보여 준다. 행사별 보기에서는 애초에
   빼지 않으므로 칩도 띄우지 않는다. */
function renderLeftChip(){
  const el = document.getElementById('mdb-left-chip');
  if(!el) return;
  const n = contacts.filter(c => hasLeft(c)).length;
  if(!n || mdbEvFilter){ el.style.display = 'none'; el.innerHTML = ''; return; }
  el.style.display = '';

  /* 검색 중에는 퇴사자가 이미 함께 나온다 — 이때 토글을 그대로 두면 눌러도
     아무 일이 안 일어나 고장 난 것처럼 보인다. 누를 수 없는 안내로 바꾼다. */
  if(mdbQuery()){
    /* 숫자를 여기 적지 않는다 — 이 n은 «DB 전체의 퇴사자»라 목록에 그만큼
       있는 것처럼 읽힌다. 지금 목록에 몇 명인지는 오른쪽 건수가 말한다. */
    el.innerHTML = `<span class="pill p-amber" style="cursor:default"
      title="이름으로 찾을 때는 퇴사한 사람도 함께 보여 줍니다. 검색어를 지우면 다시 내려가요."
      >퇴사 포함</span>`;
    return;
  }
  el.innerHTML = `<button class="pill ${mdbUi.mdbShowLeft ? 'p-amber' : 'p-gray'}"
    style="border:0;cursor:pointer;font:inherit"
    title="회사를 떠난 담당자예요. 목록에서는 내려 두고, 행사 참여 이력은 그대로 남습니다. 눌러서 함께 봅니다."
    onclick="toggleMdbLeft()">퇴사 ${n}</button>`;
}

/* 원본 1844~1876행 */
export function updateMDBBadges(pairs){
  // Cat counts
  const basePairs = (() => {
    let bp = mdbEvFilter
      ? participations.filter(p=>p.eventId===mdbEvFilter).map(p=>({c:getContactById(p.contactId),p})).filter(x=>x.c)
      : contacts.map(c=>({c,p:null}));
    /* 분야가 맨 위 축이라 카테고리·태그 숫자도 그 안에서 센다 */
    if(mdbDomainFilter){
      const inDom = new Set(domainScope(contacts).map(c => String(c.id)));
      bp = bp.filter(({c}) => inDom.has(String(c.id)));
    }
    if(hidingLeft()) bp = bp.filter(({c}) => !hasLeft(c));
    if(mdbStat) bp=bp.filter(({c})=>c.status===mdbStat);
    const q=(document.getElementById('mdb-q')||{}).value||'';
    // orgEn이 빠져 있어 영문 기업명으로 검색하면 목록에는 나오는데 배지 숫자는
    // 달랐다 — 목록(getMDBPairs)과 같은 필드를 본다
    if(q) bp = bp.filter(({c}) => matchesQuery(c, q));
    return bp;
  })();

  const cats=['all','speaker','vip','attendee','exhibitor'];
  const ids =['ct-all','ct-sp','ct-vip','ct-at','ct-ex'];
  // 사람 → 참가 역할이 닿는 카테고리들. 사람마다 참가 표 전체를 훑으면 연락처×참가만큼 돌았다
  const catsOf = new Map();
  participations.forEach(pp => { const k = pp.contactId; const ct = ROLE_TO_CAT[pp.role]; if(!ct) return; if(!catsOf.has(k)) catsOf.set(k, new Set()); catsOf.get(k).add(ct); });
  const byId = new Map(basePairs.map(({c}) => [c.id, c]));
  cats.forEach((cat,i)=>{
    const el=document.getElementById(ids[i]);if(!el)return;
    if(cat==='all'){ el.textContent=[...new Set(basePairs.map(({c})=>c.id))].length; return; }
    if(mdbEvFilter){
      el.textContent=basePairs.filter(({c,p})=>(c&&c.cat===cat)||(p&&ROLE_TO_CAT[p.role]===cat)).length;
    } else {
      el.textContent=basePairs.filter(({c})=>{
        if(c.cat===cat) return true;
        return !!catsOf.get(c.id)?.has(cat);
      }).length;
    }
  });
  // 태그(BD/C-level/커스텀)는 cat이 아니라 연락처의 영구 태그만 별도로 세는
  // 비배타적 보조 배지 — attendee 등과 겹쳐도 되므로 위 cats 루프와 분리해서 처리한다.
  TAGS.forEach(t => {
    const el = document.getElementById('ct-tag-'+t.key);
    if(!el) return;
    el.textContent = [...byId.values()].filter(c => matchesTagFilter(c, t.key)).length;
  });
  ['verified','pending','new'].forEach((s,i)=>{
    const el=document.getElementById(['ct-vf','ct-pe','ct-nw'][i]);
    if(el) el.textContent=[...new Set(basePairs.map(({c})=>c.id))].filter(id=>{
      const c=byId.get(id);return c&&c.status===s;
    }).length;
  });
}

/* «마스터DB 목록·카드·묶음·표 보기»은 ../features/mdb/mdb-views.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
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
window.renderMDB = renderMDB;
window.searchMdbM = searchMdbM;
window.updateMDBBadges = updateMDBBadges;
window.askMdbAi = askMdbAi;
window.clearMdbAi = clearMdbAi;
window.setMDBRegion = setMDBRegion;
window.buildMDBRegionList = buildMDBRegionList;

/* «소속 기업·섹터·드래그로 분류»은 ../features/mdb/mdb-drag.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */