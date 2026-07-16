/* ══════════════════════════════════════════════════════════════
   state.js — 공유 상태 저장소 (원본 contact_crm.html 1556~2264행,
   4900~4924행, 6258~6350행대에서 정리)

   설계 원칙
   - 배열/객체(contacts, participations, CO_DB, COMPANY_INFO, ...)는
     "참조"를 그대로 유지한 채 내용만 비우고 채우는 방식으로 갱신합니다.
     예) contacts.length = 0; contacts.push(...newData)
         또는 contacts.splice(0, contacts.length, ...newData)
     → import한 배열/객체 바인딩은 그대로 두고 내용만 바꾸면 다른
       모듈에서도 즉시 최신 내용을 보게 됩니다.
   - 원시값(문자열/숫자/불리언/null)은 ES 모듈에서 import한 바인딩에
     외부 모듈이 직접 재할당할 수 없으므로(재할당해도 원본 모듈에는
     반영되지 않음), 아래처럼 "getter 불필요 + setter 함수" 조합으로
     내보냅니다. 다른 모듈은 반드시 setXxx(value) 형태의 함수를 통해
     값을 바꿔야 합니다. (값을 읽을 때는 import한 바인딩을 그냥
     읽기만 하면 됩니다 — 라이브 바인딩이라 항상 최신값입니다.)
═══════════════════════════════════════════════════════════════ */

import { EVENT_LIST_SEED } from './constants.js';

/* ── Apps Script 배포 URL (원본 1558행) ──
   테스트 모드(test/test/test 로그인) 진입 시 setGsUrl('')으로 비워서
   이 세션 동안 모든 구글시트 읽기/쓰기를 원천 차단한다(auth.js 참고). */
let GS_URL = 'https://script.google.com/macros/s/AKfycbwiXforYFOO8tyFw8aBLgR3ai7HWS6I8nGG8dp124MaepIMHmNAf5X1rRrcyKiwpUa3pw/exec';
export function setGsUrl(v){ GS_URL = v; }
export { GS_URL };

/* ══════════════════════════════════════════
   EVENT_LIST — 행사 마스터 (원본 1603~1614행)
   시트(events)에서 로드되면 내용이 splice로 교체되는 가변 상태.
══════════════════════════════════════════ */
export const EVENT_LIST = [...EVENT_LIST_SEED];
export function evColor(ev){ const f = EVENT_LIST.find(e => e.key === ev); return f ? f.color : '#9C9890'; }
export function evShort(ev){ const f = EVENT_LIST.find(e => e.key === ev); return f ? f.short : ev; }

/* ══════════════════════════════════════════
   MASTER DATA MODEL (원본 1573~1601행)
   contacts       = 사람 마스터 (1인 1row)
   participations = 사람 × 행사 × 역할 교차 테이블
   (한 사람이 여러 행사에 / 한 행사에 여러 역할로 참가 가능)

   ※ participations 항목 필드명은 api.js의 normalizeParticipationRow()가
     시트 원본 컬럼(ev_id/행사명/cid/소속/성명/직함/type)을 정규화하여
     아래 형태로 채웁니다:
     { id, eventId, event, contactId, contact, role, note, matched }
     - eventId   : 행사 key (EVENT_LIST.key와 매칭, 기존 ev_id||ev)
     - event     : 행사 표시명 (비어있으면 eventId로 대체)
     - contactId : contacts.id (숫자)
     - contact   : 참가자 성명 스냅샷 (시트에 비어있으면 '')
     - role      : 참가 유형 (기존 type||role)
     기존 코드의 p.cid/p.ev/p.ev_id/p.type/p.role 참조는
     p.contactId/p.event/p.eventId/p.role 로 옮겨써야 합니다.
══════════════════════════════════════════ */
export const contacts = [];
export const participations = [];

/* ── helpers — 상태를 직접 조회하는 함수 (원본 1591~1601행) ── */
export function getParts(contactId){
  return participations.filter(p => p.contactId === contactId);
}
export function getEvParts(evName){
  return participations.filter(p => p.eventId === evName);
}
export function getContactById(id){
  return contacts.find(c => c.id === id);
}
export function contactEvents(c){
  return [...new Set(
    participations
      .filter(p => String(p.contactId) === String(c.id))
      .map(p => p.eventId)
      .filter(Boolean)
  )];
}

/* ══════════════════════════════════════════
   CO_DB — 기업 마스터 (Company DB 탭용) (원본 1616~1620행)
══════════════════════════════════════════ */
export const CO_DB = [];
// key(회사명) → { sector, hq, website, notes, catCode, country, abbr, source, updatedAt }
// companies 시트에서 로드된 회사 단위 관리 정보
export const COMPANY_INFO = {};

/* ══════════════════════════════════════════
   Upload / Merge meta-data (원본 1622~1627행, 2217~2241행, 2264행)
══════════════════════════════════════════ */
export const uploadLogs = [];
export const mergeProps = [];

// 업로드 파이프라인 작업용 배열/상태 (원본 2217~2264행)
export const aiLogs = [];      // AI 파서 로그 (데모/진행 메시지)
export const parserPrev = [];  // 컬럼 매핑 미리보기 데이터
export const parsedRows = [];      // 파싱된 원본 행 데이터 (헤더 포함)
export const mappedContacts = [];  // DB 컬럼으로 매핑된 결과

let aiStep = 0;
export function setAiStep(v){ aiStep = v; }
export { aiStep };

let uploadedFileName = '';
export function setUploadedFileName(v){ uploadedFileName = v; }
export { uploadedFileName };

let detectedCatFromFilename = null;
export function setDetectedCatFromFilename(v){ detectedCatFromFilename = v; }
export { detectedCatFromFilename };

/* ══════════════════════════════════════════
   CRM targets (원본 1629~1632행)
══════════════════════════════════════════ */
export const targets = [];

/* ══════════════════════════════════════════
   Audit / 세션 (원본 4902~4910행)
══════════════════════════════════════════ */
export const ALLOWED_DOMAIN = '@13100m.net';
export const auditLog = [];

let currentUser = null;
export function setCurrentUser(v){ currentUser = v; }
export { currentUser };

/* ── 사용자별 아바타 색상 (원본 4912~4918행) ── */
export const USER_COLORS = ['#3B5BDB','#16A34A','#C97B0A','#6D28D9','#0F766E','#DC2626','#0369A1'];
export function userColor(email){
  let h = 0;
  for(let i=0;i<email.length;i++) h = email.charCodeAt(i) + ((h<<5)-h);
  return USER_COLORS[Math.abs(h) % USER_COLORS.length];
}

/* ── Audit(audit) 탭 상태 (원본 4909~4910행) ── */
let auditFilter = 'all';
let auditUserFilter = '';
export function setAuditFilter(v){ auditFilter = v; }
export function setAuditUserFilter(v){ auditUserFilter = v; }
export { auditFilter, auditUserFilter };

/* ══════════════════════════════════════════
   앱 전역 탭 / 연동 상태 (원본 1738~1742행)
══════════════════════════════════════════ */
let curApp = 'mdb';
export function setCurApp(v){ curApp = v; }
export { curApp };

let sheetsConnected = false;
export function setSheetsConnected(v){ sheetsConnected = v; }
export { sheetsConnected };

/* ── 기업DB(co) 탭 상태 ── */
let selCo = null, coTab = 0, coCatF = null, coCodeF = null;
export function setSelCo(v){ selCo = v; }
export function setCoTab(v){ coTab = v; }
export function setCoCatF(v){ coCatF = v; }
export function setCoCodeF(v){ coCodeF = v; }
export { selCo, coTab, coCatF, coCodeF };

/* ── CRM(crm) 탭 상태 ── */
let crmV = 'pipeline', crmEvF = null, crmStF = null, tblSt = '전체';
export function setCrmV(v){ crmV = v; }
export function setCrmEvF(v){ crmEvF = v; }
export function setCrmStF(v){ crmStF = v; }
export function setTblSt(v){ tblSt = v; }
export { crmV, crmEvF, crmStF, tblSt };

/* ── CRM 드로어(dr) 상태 ── */
let drID = null, drTab = 0, mSel = null;
export function setDrID(v){ drID = v; }
export function setDrTab(v){ drTab = v; }
export function setMSel(v){ mSel = v; }
export { drID, drTab, mSel };

/* ── MDB(mdb) 탭 상태 (원본 1635~1639행) ── */
let mdbEvFilter = null;
let mdbView = 'flat';
let mdbCat = 'all';
let mdbStat = null;
export function setMdbEvFilter(v){ mdbEvFilter = v; }
export function setMdbView(v){ mdbView = v; }
export function setMdbCat(v){ mdbCat = v; }
export function setMdbStat(v){ mdbStat = v; }
export { mdbEvFilter, mdbView, mdbCat, mdbStat };

/* ══════════════════════════════════════════
   COMPANY_SECTORS — 기업 섹터 트리 (원본 6258~6276행)
   { id, name, parent: null or parent_id }
══════════════════════════════════════════ */
export const COMPANY_SECTORS = [
  {id:'pharma-global',    name:'글로벌 제약사',          parent:null},
  {id:'pharma-big',       name:'Big Pharma & Bio',       parent:'pharma-global'},
  {id:'pharma-spec',      name:'Specialized Pharma',     parent:'pharma-global'},
  {id:'biotech',          name:'Biotech',                parent:null},
  {id:'biotech-platform', name:'Biotech & Platform',     parent:'biotech'},
  {id:'ai',               name:'Artificial Intelligence',parent:null},
  {id:'vc',               name:'Venture Capital',        parent:null},
  {id:'assoc',            name:'학회 / 협회',             parent:null},
  {id:'gov',              name:'정부 / 공공기관',          parent:null},
  {id:'univ',             name:'대학 / 연구소',            parent:null},
  {id:'hospital',         name:'병원 / 의료기관',          parent:null},
  {id:'mice',             name:'MICE / Event',           parent:null},
  {id:'global-partner',   name:'Global Partners',        parent:null},
  {id:'bio-service',      name:'Bio Service & Logi',     parent:null},
  {id:'embassy',          name:'Embassy',                parent:null},
  {id:'others',           name:'General / Others',       parent:null},
];
// COMPANY_SECTORS 전체를 통째로 갈아끼워야 하는 경우(원본 loadSectors()의
// `COMPANY_SECTORS = parsed;` 처럼 재할당하던 자리) 참조를 유지한 채
// 내용만 교체하려면 이 헬퍼를 사용하세요.
export function setCompanySectors(arr){
  COMPANY_SECTORS.length = 0;
  COMPANY_SECTORS.push(...(arr || []));
}

/* ══════════════════════════════════════════
   PART_TYPES — 행사 참가 유형 목록 (원본 6337~6347행)
══════════════════════════════════════════ */
export const PART_TYPES = [
  {key:'VIP',         label:'VIP',         cls:'p-gold'},
  {key:'연사',         label:'연사',         cls:'p-blue'},
  {key:'BD',          label:'BD',           cls:'p-teal'},
  {key:'바이어',        label:'바이어',        cls:'p-teal'},
  {key:'전시참가기업',   label:'전시참가기업',   cls:'p-purple'},
  {key:'스폰서',        label:'스폰서',        cls:'p-green'},
  {key:'비즈니스파트너링',label:'비즈니스파트너링',cls:'p-amber'},
  {key:'주최사',        label:'주최사',        cls:'p-indigo'},
  {key:'참가자',        label:'참가자',        cls:'p-gray'},
];
