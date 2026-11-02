/* ══════════════════════════════════════════════════════════════
   domain/sectors.js — 섹터·분야 조회 (기업 섹터 표 COMPANY_SECTORS를 읽기만 한다)
   (modules/settings-tab.js에서 옮겼다 — 탭 화면 파일에 기대지 않게)
═══════════════════════════════════════════════════════════════ */

import { COMPANY_SECTORS, DOMAINS, CO_DB } from '../state.js';
import { sectorKey, parseSectorScope, parseDomains } from '../utils.js';

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
