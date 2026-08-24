// 순수 헬퍼 함수 모음 — 원본 곳곳에 흩어져 있던 유틸 함수를 이 파일 하나로 통합

import { COUNTRIES } from './constants.js';
import { COMPANY_SECTORS } from './state.js';

/* 이름에서 이니셜 추출 (한글/영문 대문자 최대 2글자) */
export function ab(n){ const m=n.match(/[가-힣A-Z]/g); return (m||[]).slice(0,2).join('').toUpperCase() || n.slice(0,2).toUpperCase(); }

/* 오늘 날짜 문자열 (YYYY-MM-DD) */
export function td(){ return new Date().toISOString().slice(0,10); }

/* 국가코드 또는 국가명(영문/한글) → 한글 국가명 */
export function countryName(val){
  if(!val || val === '-') return '-';
  const v  = String(val).trim();
  const vl = v.toLowerCase().replace(/[.\s\(\)]/g, ''); // 정규화: 공백·점·괄호 제거

  // 1) 코드로 직접 매칭 (2글자 대문자)
  const byCode = COUNTRIES.find(c => c.code === v.toUpperCase());
  if(byCode) return byCode.nameKo;

  // 2) aliases로 매칭 (정규화 후 비교)
  const byAlias = COUNTRIES.find(c =>
    c.aliases.some(a => a.toLowerCase().replace(/[.\s\(\)]/g,'') === vl)
  );
  if(byAlias) return byAlias.nameKo;

  // 3) 매칭 안 되면 원본 그대로
  return v;
}
export function countryOptions(selected){
  const norm = v => v ? String(v).toLowerCase() : '';
  const selCode = COUNTRIES.find(c => c.code === (selected||'').toUpperCase() || c.aliases.includes(norm(selected)));
  const selName = selCode ? selCode.nameKo : selected;
  return COUNTRIES.map(c=>`<option value="${c.nameKo}"${selName===c.nameKo?' selected':''}>${c.nameKo}</option>`).join('');
}

/* 모바일 뷰포트 여부 (반응형 분기용) */
export function isMobile(){ return window.innerWidth <= 768; }

/* 두 문자열 간 레벤슈타인 거리 (유사 기업명 후보 탐지용) */
export function levenshteinDist(a, b){
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, () => new Array(n+1).fill(0));
  for(let i=0; i<=m; i++) dp[i][0] = i;
  for(let j=0; j<=n; j++) dp[0][j] = j;
  for(let i=1; i<=m; i++){
    for(let j=1; j<=n; j++){
      dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

/* ── 행사별 섹터 스코프 ──
   sectors 시트 스키마(id,name,parent)를 바꾸지 않고도 섹터를 행사별로
   구분하기 위해, name 컬럼 자체에 "행사짧은이름 · 섹터명" 형태로 접두어를
   붙인다. 접두어가 없으면 "공통"(모든 행사 공유) 섹터로 취급한다. */
export function scopedSectorName(eventShort, plainName){
  return eventShort ? `${eventShort} · ${plainName}` : plainName;
}
export function parseSectorScope(name){
  const idx = String(name||'').indexOf(' · ');
  if(idx < 0) return { eventShort: null, plainName: name };
  return { eventShort: name.slice(0, idx), plainName: name.slice(idx + 3) };
}

/* 섹터명 비교용 정규화 키 (대소문자·앞뒤 공백 무시) — 업로드/설정 등에서
   "Pharma"와 "pharma"를 같은 섹터로 인식시키기 위한 단일 소스.
   섹터 표시 이름 자체는 바꾸지 않고, 동일성 판단(중복 생성 방지·집계·필터)에만 사용한다. */
export function sectorKey(name){
  return String(name||'').trim().toLowerCase();
}

/* 메인 섹터의 domain 컬럼 값 파싱/조합 — 섹터 하나가 여러 분야에 동시에 속할 수
   있도록 "bio|vc"처럼 파이프로 여러 분야 id를 이어붙여 한 컬럼에 저장한다
   (시트 스키마는 그대로, parseSectors/joinSectors와 동일한 패턴). */
export function parseDomains(domain){
  if(!domain) return [];
  return String(domain).split('|').map(s=>s.trim()).filter(Boolean);
}
export function joinDomains(arr){
  return (arr||[]).filter(Boolean).join('|');
}

/* 연락처의 tags 컬럼 값 파싱/조합 — BD/C-level처럼 참가 역할·직함과 무관하게
   그 사람에게 직접 붙이는 영구 꼬리표. "bd|clevel"처럼 파이프로 여러 개를
   이어붙인다(parseDomains와 동일한 패턴). */
export function parseTags(tags){
  if(!tags) return [];
  return String(tags).split('|').map(s=>s.trim()).filter(Boolean);
}
export function joinTags(arr){
  return (arr||[]).filter(Boolean).join('|');
}

/* sectors 시트 한 행의 값 배열 — 시트 컬럼(id,name,parent,domain,canonical)의
   단일 소스. sectors에 쓰는 모든 upsert/batchUpsert/replaceAll은 반드시 이
   헬퍼를 거쳐야 한다 (컬럼 폭이 모자라면 replaceAll이 뒷 컬럼을 통째로
   지워버리는 회귀를 원천 차단). */
export function sectorRowValues(s){
  return [s.id, s.name, s.parent || '', s.domain || '', s.canonical || ''];
}

/* 섹터명 → 깔끔한 id 슬러그 (연속 특수문자는 밑줄 1개로, 충돌할 때만 짧은 번호를 붙임) */
export function slugifySectorName(name){
  let base = name.trim().toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if(!base) base = 'sector';
  if(!COMPANY_SECTORS.some(s => (typeof s==='string'?s:s.id) === base)) return base;
  let n = 2;
  while(COMPANY_SECTORS.some(s => (typeof s==='string'?s:s.id) === `${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/* ── cat 값 정규화 (한글 원문 → DB 코드) ──
   연락처(contacts)의 cat은 speaker/vip/attendee 3분류로만 저장한다.
   스폰서/투자자/바이어/BD/전시기업/기자/주최 등 그 외 상세 구분은 여기서
   사라지고, 행사 참가 역할(participations.role/PART_TYPES)에만 남는다.
   BD는 cat을 분리하지 않고 attendee로 유지 — db-tab.js에서 참가 역할
   기준의 비배타적 보조 필터로 별도 구현했다(자세한 이유는 constants.js의
   ROLE_TO_CAT 주석 참고). */
const CAT_NORMALIZE_MAP = {
  // ── 연사 (좌장/패널도 무대에 오르는 발표 프로그램 참가자라 같은 그룹으로 묶음) ──
  '연사':'speaker','발표자':'speaker','강연자':'speaker','키노트':'speaker',
  'speaker':'speaker','presenter':'speaker','keynote':'speaker',
  '좌장':'speaker','세션좌장':'speaker','사회자':'speaker',
  '패널':'speaker','패널리스트':'speaker','패널토론자':'speaker','토론자':'speaker',
  '모더레이터':'speaker',
  'moderator':'speaker','chair':'speaker','chairperson':'speaker','sessionchair':'speaker',
  'panelist':'speaker','panel':'speaker','discussant':'speaker',
  // ── VIP ──
  'vip':'vip','귀빈':'vip','vvip':'vip','v.i.p':'vip',
  // ── 그 외는 전부 일반참가자로 통합 ──
  '스폰서':'attendee','후원':'attendee','후원사':'attendee',
  'sponsor':'attendee','sponsorship':'attendee',
  '투자자':'attendee','vc':'attendee','investor':'attendee',
  '바이어':'attendee','buyer':'attendee',
  // ── BD (Business Development) — cat은 attendee로 유지(위 주석 참고) ──
  'bd':'attendee','비디':'attendee','사업개발':'attendee','비즈니스디벨롭먼트':'attendee','businessdevelopment':'attendee',
  '파트너':'attendee',
  '전시기업':'attendee','전시참가기업':'attendee','전시참가':'attendee',
  '전시':'attendee','부스':'attendee',
  'exhibitor':'attendee','booth':'attendee',
  'exhibitor pass':'attendee','exhibitorpass':'attendee',  // 바이오코리아
  '기자':'attendee','언론':'attendee','미디어':'attendee','취재':'attendee',
  'press':'attendee','media':'attendee','journalist':'attendee',
  'conference pass':'attendee','conferencepass':'attendee',
  'all pass':'attendee','allpass':'attendee',
  'visitor':'attendee',
  '참가자':'attendee','일반참가자':'attendee','일반':'attendee',
  '일반참가자(사전등록)':'attendee','일반참가자(현장등록)':'attendee',
  '사전등록':'attendee','현장등록':'attendee',
  'organizer':'attendee','주최':'attendee','주최사':'attendee','관계자':'attendee','주최담당자':'attendee','담당자':'attendee',
  'attendee':'attendee','participant':'attendee','general':'attendee',
};
export function normalizeCat(raw){
  if(!raw) return '';
  const t  = String(raw).trim();
  const tl = t.toLowerCase().replace(/\s+/g,'');
  if(CAT_NORMALIZE_MAP[t])  return CAT_NORMALIZE_MAP[t];
  if(CAT_NORMALIZE_MAP[tl]) return CAT_NORMALIZE_MAP[tl];
  for(const [k,v] of Object.entries(CAT_NORMALIZE_MAP)){
    if(tl.includes(k.toLowerCase().replace(/\s+/g,''))) return v;
  }
  const valid=['speaker','vip','attendee'];
  if(valid.includes(tl)) return tl;
  return '';
}

/* 국가 텍스트 → 국가 코드 변환 */
export function normalizeCountry(text){
  // 코드('KR')/영문명('Korea')/한글명 모두 한글 국가명으로 통일해서 저장
  if(!text) return '';
  return countryName(String(text).trim());
}

/* 사용자 이름 → 아바타용 이니셜(최대 2글자) (원본 contact_crm.html 4919~4924행,
   AUTH & AUDIT LOG SYSTEM 섹션). auth.js(로그인 아바타)와 audit-tab.js
   (활동 로그 아바타) 양쪽에서 공용으로 쓰는 순수 헬퍼라 utils.js로 통합. */
export function userInitials(name){
  if(!name) return '?';
  const parts = name.trim().split(/\s+/);
  if(parts.length >= 2) return (parts[0][0]+(parts[1]?parts[1][0]:'')).toUpperCase();
  return name.slice(0,2).toUpperCase();
}

/* ── 신규 추가: XSS 방지용 HTML 이스케이프 헬퍼 ──
   원본에는 없던 함수. co-notes, contactViewPanel 등에서 사용자 입력값을
   이스케이프 없이 innerHTML에 직접 삽입하던 위험 지점이 있었는데,
   앞으로 사용자 입력을 렌더링하는 모든 모듈이 이 함수로 감싸도록 하기 위해 추가. */
export function escapeHtml(str){
  if(str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── 인라인 핸들러 속성(onclick="fn('...')")에 문자열 인자를 넣을 때의
   이스케이프 (신규) ──
   기존 모듈들의 `.replace(/'/g,"\\'")`는 작은따옴표만 처리해서, 값에
   큰따옴표가 들어오면 속성 경계를 탈출해 임의 속성 주입(XSS)이 가능했다.
   1) JS 문자열 이스케이프(백슬래시·작은따옴표) 후
   2) HTML 이스케이프(&, ", <, >)를 적용한다 — 브라우저가 속성값을 파싱할 때
   &quot; 등이 원래 문자로 복원되므로 JS 쪽에서는 정상 문자열로 동작한다. */
export function escAttr(s){
  return String(s === null || s === undefined ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* 업로드 원본에 <a@b.com> 처럼 꺾쇠가 섞여 들어온 건이 있어 표시·링크 전에 벗긴다 */
export const cleanEmail = (e) => String(e || '').replace(/[<>]/g, '').trim();
