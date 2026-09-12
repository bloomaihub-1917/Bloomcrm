/* ══════════════════════════════════════════════════════════════
   state.js — 공유 상태 저장소 (원본 contact_crm.html 1556~2264행,
   4900~4924행, 6258~6350행대에서 정리)

   설계 원칙
   - 배열/객체(contacts, participations, CO_DB, ORGS, ...)는
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

import { EVENT_LIST_SEED, CL, CP, CAT_KEYS, EVENT_PARTS, PART_STATES,
  SPEAKER_ROLES, SPEAKER_NEEDS } from './constants.js';

/* ── 백엔드 API 베이스 URL (Node/Express, backend-node/) ──
   Render 등에 배포한 뒤 이 값만 바꾸면 된다(과거 GS_URL과 동일한 역할).
   테스트 모드(test/test/test 로그인) 진입 시 setApiBaseUrl('')으로 비워서
   이 세션 동안 모든 서버 읽기/쓰기를 원천 차단한다(auth.js 참고). */
let API_BASE_URL = 'https://backend-node-jade-delta.vercel.app';
export function setApiBaseUrl(v){ API_BASE_URL = v; }
export { API_BASE_URL };

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
   ORGS — 기업 마스터 (서버 orgs 테이블과 1:1)

   전에는 기업이 contacts의 소속 문자열에서 매번 파생되는 값이었다. 이름이
   식별자였던 탓에 이름을 고치면 다른 회사가 되어 섹터·메모가 끊겼고, 연락처가
   없는 기업(잠재 고객사, 시공 벤더)은 아예 등록할 수 없었다. 이제 기업은
   이름과 무관한 id를 가진 저장된 레코드이고, contacts.org_id와
   exhibitors.org_id가 그 id를 가리킨다.

   CO_DB는 여전히 화면용 뷰다 — ORGS를 바탕으로 연락처·행사·거래를 붙여
   buildCoDB()가 만든다(company-tab.js). 다른 점은 이제 그 바탕이 문자열이
   아니라 진짜 레코드라는 것이다.
══════════════════════════════════════════ */
/* ══════════════════════════════════════════
   CODE_LISTS — 화면에서 고르는 짧은 목록들

   부스 타입·스폰서 등급·비품 분류처럼 고르는 값이 코드에 박혀 있었다. 행사가
   바뀌면 목록도 바뀌는데 그때마다 개발자가 코드를 고쳐야 했다. 이제 서버에서
   읽어 오고, 설정 화면에서 고칠 수 있다.

   행사별 덮어쓰기: 그 행사 전용 목록이 있으면 그걸 쓰고, 없으면 공통을 쓴다.
══════════════════════════════════════════ */
export const CODE_LISTS = [];

/* 고를 수 있는 항목 — 내린 것(active='no')은 뺀다.
   서버 값이 아직 안 왔으면 fallback을 쓴다. 목록이 비어 화면이 텅 비는 것보다
   코드에 남은 기본값이라도 보여주는 편이 낫다(로그인 직후 한순간). */
export function codeList(listKey, evKey, fallback){
  const all = CODE_LISTS.filter(c => c.list_key === listKey && c.active !== 'no');
  const mine = evKey ? all.filter(c => c.event_id === evKey) : [];
  const rows = (mine.length ? mine : all.filter(c => !c.event_id))
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  return rows.length ? rows : (fallback || []);
}

/* 저장된 값 하나를 이름·색으로 옮긴다. 목록에서 내려간 값도 이름은 찾아준다 —
   옛 데이터가 코드 그대로 노출되면 무슨 뜻인지 알 수 없다. */
export function codeItem(listKey, evKey, code){
  const c = String(code ?? '');
  const pool = CODE_LISTS.filter(x => x.list_key === listKey);
  return pool.find(x => x.code === c && x.event_id === evKey)
    || pool.find(x => x.code === c && !x.event_id)
    || null;
}
export const codeLabel = (listKey, evKey, code) =>
  codeItem(listKey, evKey, code)?.label || String(code ?? '');
export const codeCls = (listKey, evKey, code) =>
  codeItem(listKey, evKey, code)?.cls || 'p-gray';

export const ORGS = [];

export function getOrgById(id){ return ORGS.find(o => o.id === id); }

/* 이름으로 기업 찾기 — 현재 이름과 옛 이름(aliases)을 함께 본다.
   업로드로 들어온 옛 표기를 같은 회사로 이어 붙일 때 쓴다. */
export function findOrgByName(name, normalize){
  const t = String(name || '').trim();
  if(!t) return null;
  const k = normalize ? normalize(t) : t.toLowerCase();
  return ORGS.find(o => {
    const names = [o.name_ko, o.name_en, ...String(o.aliases || '').split('\n')].filter(Boolean);
    return names.some(n => (normalize ? normalize(n) : n.toLowerCase()) === k);
  }) || null;
}

export const orgName = (o) => (o ? (o.name_ko || o.name_en || '') : '');

/* 기업 종류 — 무엇을 관리하는지에 따라 화면에서 다르게 다룬다 */
export const ORG_KINDS = [
  { key: '전시참가기업', label: '전시 참가기업', cls: 'p-blue' },
  { key: '잠재고객사',   label: '잠재 고객사',   cls: 'p-amber' },
  { key: '벤더시공사',   label: '벤더·시공사',   cls: 'p-teal' },
];
export const ORG_STATUSES = ['활성', '휴면', '거래종료'];

/* ── 서버 목록을 코드 상수에 덮어씌운다 ──────────────────────────
   ORG_KINDS·CL·CP·CAT_KEYS는 20곳 넘는 화면이 직접 import해 쓴다. 호출부를
   전부 함수로 바꾸는 대신, 목록을 읽어 온 뒤 '같은 객체 안의 내용만' 갈아끼운다
   (배열·객체 참조를 유지하는 기존 규약 그대로). 서버에 그 목록이 없으면
   코드에 있던 기본값을 그대로 둔다 — 목록이 비어 선택지가 사라지면 안 된다. */
export function applyCodeLists(){
  const kinds = CODE_LISTS.filter(c => c.list_key === 'org_kind' && c.active !== 'no');
  if(kinds.length) ORG_KINDS.splice(0, ORG_KINDS.length,
    ...kinds.sort(byOrder).map(c => ({ key: c.code, label: c.label, cls: c.cls || 'p-gray' })));

  const st = CODE_LISTS.filter(c => c.list_key === 'org_status' && c.active !== 'no');
  if(st.length) ORG_STATUSES.splice(0, ORG_STATUSES.length, ...st.sort(byOrder).map(c => c.code));

  const cats = CODE_LISTS.filter(c => c.list_key === 'contact_cat' && c.active !== 'no');
  if(cats.length){
    const rows = cats.sort(byOrder);
    CAT_KEYS.splice(0, CAT_KEYS.length, ...rows.map(c => c.code));
    // 이름·색은 지우지 않고 덮어쓰기만 한다. 목록에서 내린 카테고리라도 옛
    // 데이터에는 남아 있어서, 이름을 잃으면 화면에 코드가 그대로 노출된다
    rows.forEach(c => { CL[c.code] = c.label; if(c.cls) CP[c.code] = c.cls; });
  }
}
const byOrder = (a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);

/* ══════════════════════════════════════════
   CO_DB — 기업 화면용 뷰 (ORGS + 연락처/행사/거래) (원본 1616~1620행)
══════════════════════════════════════════ */
export const CO_DB = [];
// (COMPANY_INFO 삭제 — 이름을 키로 쓰던 오버레이였고, 이제 ORGS가 그 자리를 대신한다)

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
   전시 참가기업 진행관리 (전시 탭)
   CRM targets(일반 영업 파이프라인)와 별개로, 전시 참가기업의
   매뉴얼→신청서→부스→정산→그래픽→도록→현장 실무 흐름을 추적한다.
   서버 테이블과 1:1 대응하며, 컬럼명은 전부 snake_case다.
══════════════════════════════════════════ */
export const EXHIBITORS   = [];  // 기업×행사 1건 (체크리스트 본체)
export const EXH_CONTACTS = [];  // 기업측 담당자 (한 기업에 여러 명)
export const EXH_ITEMS    = [];  // 금액 항목 (부스/비품/그래픽/기타)
export const EXH_INVOICES = [];  // 인보이스 (여러 장 발행 가능)
export const EXH_TAX      = [];  // 세금계산서 (여러 장 발행·수정 발행 가능)
export const EXH_PAYMENTS = [];  // 입금 내역 (분할 입금 대응)
export const EXH_LOGS     = [];  // 문의사항(kind='inquiry') + 자유 기록(kind='note')
export const EXH_APPS     = [];  // 신청서 접수 이력 (최초 + 변경/취소 재접수)

/* 지켜보는 폴더와, 훑어서 본 파일들 — schema.sql 주석 참고.
   폴더 손잡이는 여기 없다(브라우저 IndexedDB에만 산다). 여기 있는 건 «무슨
   폴더를 지켜보기로 했나»와 «무엇이 들어와 있었나»다. */
export const WATCH_FOLDERS = [];
export const WATCH_FILES   = [];
export const watchFoldersFor = (evKey) => WATCH_FOLDERS
  .filter(f => String(f.event_id || '') === String(evKey || '') && f.active !== 'no')
  .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
    || String(a.name || '').localeCompare(String(b.name || ''), 'ko'));

/* 렌탈 비품 품목표 — 행사별로 다르다(렌탈사와 단가가 행사마다 바뀐다).
   신청 항목(EXH_ITEMS.catalog_id)이 여기의 id를 가리킨다. */
export const EQUIP_CATALOG = [];

/* 이 행사에서 고를 수 있는 품목 — 내린 품목(active='no')은 뺀다.
   다만 이미 신청에 쓰인 품목은 이름을 보여줘야 하므로 조회는 따로 한다. */
/* kind를 주면 그 종류만 — 비어 있는 옛 행은 비품으로 본다(전부 비품이었다) */
export function catalogFor(evKey, kind){
  return EQUIP_CATALOG
    .filter(c => c.event_id === evKey && c.active !== 'no')
    .filter(c => !kind || (c.kind || 'equip') === kind)
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
}
export function catalogItem(id){ return EQUIP_CATALOG.find(c => c.id === id) || null; }

/* 이름으로 품목 찾기 — 표기 흔들림(공백·대소문자·괄호)을 눌러서 비교한다.
   "C-040 Folding Chair"와 "접이식 체어"처럼 서로 다른 표기가 같은 품목을
   가리킬 수 있어, 코드·국문명·영문명을 모두 훑는다. */
export function findCatalogByName(evKey, name){
  const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const k = norm(name);
  if(!k) return null;
  const codeM = String(name || '').toUpperCase().match(/\b([A-Z]{1,2}-\d{2,4})\b/);
  return EQUIP_CATALOG.find(c => {
    if(c.event_id !== evKey) return false;
    if(codeM && String(c.code || '').toUpperCase() === codeM[1]) return true;
    return [c.name_ko, c.name_en, `${c.code} ${c.name_ko}`, `${c.code} ${c.name_en}`]
      .filter(Boolean).some(n => norm(n) === k);
  }) || null;
}

/* 전시 탭에서 지금 보고 있는 행사 (null = 미선택) */
let exhEvent = null;
export function setExhEvent(v){ exhEvent = v; }
export { exhEvent };

/* ── 전시 조회 헬퍼 ── */
export function exhibitorsForEvent(evKey){
  return EXHIBITORS.filter(x => x.event_id === evKey);
}
export function getExhibitorById(id){
  return EXHIBITORS.find(x => x.id === id);
}
/* 담당자 목록 — 메인(is_primary)을 항상 맨 앞에 둔다 */
export function contactsFor(exhId){
  return EXH_CONTACTS.filter(c => c.exhibitor_id === exhId)
    .sort((a,b) => (b.is_primary === 'yes' ? 1 : 0) - (a.is_primary === 'yes' ? 1 : 0));
}
export function primaryContactFor(exhId){
  const list = contactsFor(exhId);
  return list.find(c => c.is_primary === 'yes') || list[0] || null;
}
/* 신청 항목 — 넣은 순서(sort_order)대로 세운다.

   전에는 EXH_ITEMS 배열 순서를 그대로 썼다. 그 순서는 화면을 볼 때마다 달라진다 —
   새로 추가하면 배열 끝에 붙고, 새로고침하면 서버의 id순으로 돌아온다. 그래서
   기업을 펼칠 때마다 같은 항목이 다른 자리에 있었다.

   sort_order는 항목을 넣을 때부터 채우고 있었는데 정렬에 쓰는 곳이 없었다.
   값이 빈 옛 줄은 뒤로 보내고, 같은 번호는 id로 갈라 순서가 늘 하나로 정해지게 한다.
   (빼기 비교에 Infinity를 쓰면 NaN이 되어 정렬이 무너지므로 큰 수를 쓴다) */
export const itemSort = (i) => {
  // Number('')는 0이라, 빈 값을 먼저 걸러야 번호 없는 줄이 맨 앞으로 오지 않는다
  const v = String(i.sort_order ?? '').trim();
  if(!v) return 1e9;
  const n = Number(v);
  return Number.isFinite(n) ? n : 1e9;
};
export function itemsFor(exhId){
  return EXH_ITEMS.filter(i => i.exhibitor_id === exhId)
    .sort((a, b) => itemSort(a) - itemSort(b) || String(a.id).localeCompare(String(b.id)));
}

/* 다음 순서 번호 — 개수+1로 매기면 중간을 지운 뒤 추가할 때 이미 있는 번호와
   겹쳐 또 순서가 흔들린다. 가장 큰 번호 다음을 쓴다. */
export function nextItemSort(exhId){
  const rows = EXH_ITEMS.filter(i => i.exhibitor_id === exhId);
  return String(rows.reduce((m, i) => Math.max(m, Number(i.sort_order) || 0), 0) + 1);
}
/* 살아 있는 품목 — 취소된 줄은 뺀다. 발주·정산·대장은 전부 이걸 본다.
   취소를 지우지 않고 내리는 이유는 이미 나간 인보이스를 설명해야 하기 때문. */
export const isVoided = (i) => !!String(i.voided_at || '').trim();
export function liveItemsFor(exhId){ return itemsFor(exhId).filter(i => !isVoided(i)); }

/* 신청서 접수 이력 — 받은 순서대로(차수 오름차순) */
export function appsFor(exhId){
  return EXH_APPS.filter(a => a.exhibitor_id === exhId)
    .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0)
      || String(a.received_at || '').localeCompare(String(b.received_at || '')));
}
/* 아직 반영 중인 접수 건. 이게 열려 있으면 그동안 고친 품목이 여기 달린다 —
   사람이 "추가인가 변경인가"를 매번 고르게 하면 안 적히거나 틀리게 적힌다. */
export function openAppFor(exhId){
  return appsFor(exhId).filter(a => !String(a.handled_at || '').trim()).pop() || null;
}
export function invoicesFor(exhId){ return EXH_INVOICES.filter(i => i.exhibitor_id === exhId); }
export function taxInvoicesFor(exhId){ return EXH_TAX.filter(i => i.exhibitor_id === exhId); }
export function paymentsFor(exhId){ return EXH_PAYMENTS.filter(p => p.exhibitor_id === exhId); }
export function logsFor(exhId){
  return EXH_LOGS.filter(l => l.exhibitor_id === exhId)
    .sort((a,b) => String(b.ts||'').localeCompare(String(a.ts||'')));
}
/* 미답변 문의 — 답변 안 한 게 묻히는 걸 막는 게 이 기능의 핵심이라
   여러 화면(체크리스트 배지/상단 패널/드로어)에서 같은 정의를 공유한다. */
export function openInquiriesFor(exhId){
  return EXH_LOGS.filter(l => l.exhibitor_id === exhId && l.kind === 'inquiry' && !l.answered_at);
}

/* ══════════════════════════════════════════
   Audit / 세션 (원본 4902~4910행)
══════════════════════════════════════════ */
export const ALLOWED_DOMAIN = '@13100m.net';
export const auditLog = [];

let currentUser = null;
export function setCurrentUser(v){ currentUser = v; }
export { currentUser };

/* ── Firebase ID 토큰 캐시 ──
   Firebase Auth가 로그인/세션 유지를 전담하므로, 이 값은 매 API 호출 직전
   auth.currentUser.getIdToken()로 새로 받아 갱신한다(1시간 만료, SDK가 자동
   갱신). localStorage에 영구 저장하지 않는다 — 신뢰 주체는 Firebase SDK. */
let authToken = '';
export function setAuthToken(v){ authToken = v || ''; }
export { authToken };

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
let selCo = null, coTab = 0, coCatF = null, coCodeF = null, coDomainF = null, coCountryF = null;
export function setSelCo(v){ selCo = v; }
export function setCoTab(v){ coTab = v; }
export function setCoCatF(v){ coCatF = v; }
export function setCoCodeF(v){ coCodeF = v; }
export function setCoDomainF(v){ coDomainF = v; }
export function setCoCountryF(v){ coCountryF = v; } // 'domestic' | 'overseas' | null
export { selCo, coTab, coCatF, coCodeF, coDomainF, coCountryF };

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
let mdbDomainFilter = null; // 분야별 보기 — DOMAINS의 id, 또는 '__none__'(미분류). null=전체
export function setMdbEvFilter(v){ mdbEvFilter = v; }
export function setMdbView(v){ mdbView = v; }
export function setMdbCat(v){ mdbCat = v; }
export function setMdbStat(v){ mdbStat = v; }
export function setMdbDomainFilter(v){ mdbDomainFilter = v; }
export { mdbEvFilter, mdbView, mdbCat, mdbStat, mdbDomainFilter };

/* 마스터DB 행 선택(체크) 상태 — 아바타 클릭으로 토글, 일괄 병합/삭제/변경에 사용.
   Set은 재할당 없이 add/delete로 직접 조작(CO_DB 등과 동일한 패턴). */
export const mdbSelected = new Set();

/* ══════════════════════════════════════════
   DOMAINS — 섹터의 최상위 "분야(도메인)" 목록 (신규)
   { id, name } — 예: {id:'bio', name:'BIO'}
   settings 시트 key='domains'의 JSON에서 로드된다.
   섹터(COMPANY_SECTORS)의 domain 필드가 이 id를 참조한다.
══════════════════════════════════════════ */
export const DOMAINS = [];
export function setDomains(arr){
  DOMAINS.length = 0;
  DOMAINS.push(...(arr || []));
}

/* ══════════════════════════════════════════
   CATMAPS — 업로드 카테고리 값별 매핑 (신규)
   { [행사key]: { [엑셀 원문 카테고리값]: 섹터name } }
   settings 시트 key='catmap_<행사key>' JSON에서 로드.
   같은 행사 재업로드 시 매핑 UI에 자동 preselect된다.
══════════════════════════════════════════ */
export const CATMAPS = {};

/* ══════════════════════════════════════════
   EXH_CFG — 행사별 전시 설정 (settings 시트 key='exh_cfg_<행사키>' JSON)

     { due: { 단계키: 'YYYY-MM-DD' },      // 단계별 마감일
       book: { chars, words } }            // 프로그램북 글자수 한도

   행사가 바뀌면 마감일도 도록 판형도 같이 바뀐다. 뜻풀이는 전시 탭이 하고
   여기서는 담아만 둔다 — api.js가 전시 탭을 import하면 순환 참조가 된다.
══════════════════════════════════════════ */
export const EXH_CFG = {};
export function loadExhCfg(settingsRows){
  for(const k in EXH_CFG) delete EXH_CFG[k];
  (settingsRows || []).forEach(r => {
    const k = String(r.key || '');
    if(!k.startsWith('exh_cfg_')) return;
    try {
      const v = JSON.parse(r.value);
      if(v && typeof v === 'object') EXH_CFG[k.slice('exh_cfg_'.length)] = v;
    } catch(e){ console.warn('[CRM] 행사 설정 파싱 실패:', k, e); }
  });
}

/* ── 진행 파트 — EXH_CFG.parts ──
   저장은 exh_cfg_<행사키> 안에 함께 담는다. 행사 하나가 settings에 한 줄인
   구조를 그대로 두는 편이, 파트를 넣자고 events 테이블에 열을 늘리는 것보다
   되돌리기 쉽다.

   정해 둔 게 없는 행사는 EVENT_PARTS의 기본값을 쓴다 — 지금까지 만든 행사에는
   parts가 없으므로, 여기서 전시를 켜 두지 않으면 멀쩡히 쓰던 전시 탭이
   한꺼번에 잠긴다. */
const PART_STATE_KEYS = PART_STATES.map(s => s.key);

/* 옛 값은 참/거짓이었다 — true는 진행 중, false는 안 함으로 읽는다.
   저장된 걸 통째로 고치지 않고 읽을 때 옮기는 이유는, 한 번도 안 연 행사의
   설정까지 건드릴 일이 없기 때문이다. */
const toPartState = (v, dflt) => {
  if(v === true)  return 'doing';
  if(v === false) return 'none';
  return PART_STATE_KEYS.includes(v) ? v : dflt;
};

export function evParts(evKey){
  const saved = (EXH_CFG[evKey] || {}).parts || {};
  const out = {};
  EVENT_PARTS.forEach(p => {
    out[p.key] = (p.key in saved) ? toPartState(saved[p.key], p.dflt) : p.dflt;
  });
  return out;
}
export function evPartState(evKey, part){ return evParts(evKey)[part]; }

/* 화면을 보여줄지 — 끝난 파트도 들여다볼 수는 있어야 한다 */
export function evPartOn(evKey, part){ return evPartState(evKey, part) !== 'none'; }
/* 고칠 수 있는지 — 끝난 파트는 열람만 */
export function evPartDone(evKey, part){ return evPartState(evKey, part) === 'done'; }

/* ══════════════════════════════════════════
   컨퍼런스 · 연사

   설정은 EXH_CFG[행사키].conf 한 곳에 담는다 — parts·due·book이 이미 그 줄에
   얹혀 있고, 쓰는 곳들이 모두 {...prev}로 저장하므로 모르는 키를 지우지 않는다.
   키 이름이 exh_cfg_로 시작해 컨퍼런스 설정이 들어가는 게 어긋나 보이지만,
   행사 설정이 한 줄에 모여 있는 이점이 더 크다.

     conf = { days:[], slots:[{start,end,label}], tracks:[],
              due:{항목키:날짜}, limits:{bio_pro,bio_work,abstract},
              docs:{guide_ko,guide_en,form_ko,form_en}, folder:'',
              roleNeeds:{역할:{항목키:'req'|'opt'|''}} }
══════════════════════════════════════════ */
export const CONF_SESSIONS   = [];
export const SPEAKERS        = [];
export const SESSION_SPEAKERS = [];
export const SPEAKER_CONTACTS = [];
export const SPEAKER_LOGS    = [];

export function confCfg(evKey){ return (EXH_CFG[evKey] || {}).conf || {}; }

/* 발표 일자 — 행사 기간에서 만들고, 설정에서 더한 날을 합친다.
   기간을 이미 알고 있으니 손으로 다시 적게 하지 않는다. 사전행사처럼
   기간 밖의 날만 conf.days에 더한다. */
export function confDays(evKey){
  const ev = EVENT_LIST.find(e => e.key === evKey) || {};
  const out = [];
  const s = ev.date_start || ev.date || '', e = ev.date_end || s;
  if(s){
    for(let d = new Date(s); d <= new Date(e); d.setDate(d.getDate() + 1)){
      out.push(d.toISOString().slice(0, 10));
      if(out.length > 60) break;   // 기간이 잘못 들어와도 멈춘다
    }
  }
  (confCfg(evKey).days || []).forEach(d => { if(d && !out.includes(d)) out.push(d); });
  return out.sort();
}

/* 이 역할이 이 항목을 받아야 하나 — 'req' | 'opt' | ''
   행사별 덮어쓰기(conf.roleNeeds)가 있으면 그것을, 없으면 기본값을 쓴다.
   덮어쓰기는 예외가 아니라 정규 경로다 — 패널의 초록이 행사마다 갈린다. */
export function speakerNeed(evKey, role, needKey){
  const over = (confCfg(evKey).roleNeeds || {})[role];
  if(over && (needKey in over)) return over[needKey];
  const def = SPEAKER_ROLES.find(r => r.key === role);
  return def ? (def.needs[needKey] ?? '') : '';
}
/* 그 역할이 요구하는 항목만 — 화면이 물어볼 것을 여기서 받는다 */
export function speakerNeedList(evKey, role){
  return SPEAKER_NEEDS
    .map(n => ({ ...n, state: speakerNeed(evKey, role, n.key) }))
    .filter(n => n.state);
}

export const speakersForEvent   = (evKey) => SPEAKERS.filter(x => x.event_id === evKey);
export const sessionsForEvent   = (evKey) => CONF_SESSIONS.filter(x => x.event_id === evKey)
  .sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
    || String(a.start_at || '').localeCompare(String(b.start_at || ''))
    || String(a.track || '').localeCompare(String(b.track || '')));
export const assignmentsFor     = (speakerId) => SESSION_SPEAKERS.filter(x => x.speaker_id === speakerId);
export const assignmentsOfSession = (sessionId) => SESSION_SPEAKERS.filter(x => x.session_id === sessionId)
  .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
export const getSpeakerById     = (id) => SPEAKERS.find(x => x.id === id);
export const contactsOfSpeaker  = (speakerId) => SPEAKER_CONTACTS.filter(x => x.speaker_id === speakerId);
export const logsOfSpeaker      = (speakerId) => SPEAKER_LOGS.filter(x => x.speaker_id === speakerId);

/* 이 연사가 맡은 역할들 — 배정에서 모은다. 한 사람이 여러 역할일 수 있다. */
export function rolesOfSpeaker(speakerId){
  return [...new Set(assignmentsFor(speakerId).map(a => a.role).filter(Boolean))];
}

/* ══════════════════════════════════════════
   COMPANY_SECTORS — 기업 섹터 트리 (원본 6258~6276행)
   { id, name, parent: null or parent_id, domain: ''|분야id }
   - parent: 메인(null) → 서브(부모 id)의 2단계 계층
   - domain: 메인 섹터에만 저장되는 분야 참조 (서브는 런타임에 부모를 따라감)
══════════════════════════════════════════ */
export const COMPANY_SECTORS = [
  /* 서버(sectors 표)에서 읽어 통째로 갈아 끼운다 — 아래는 아직 안 왔을 때 쓰는
     기본값이라, db/seed-sectors.js가 심는 목록과 같아야 한다. 예전에는 여기에
     BIO KOREA 시절 트리(글로벌 제약사·VC·Embassy…)가 박혀 있었는데, 저장된 값과
     하나도 맞지 않아 섹터 필터가 아무것도 걸러내지 못했다.

     분야(domain)로 갈라 둔다. 우리가 하는 행사가 두 갈래이기 때문이다 —
     바이오·임상 행사에서 만나는 회사와 이벤트 산업 행사에서 만나는 회사는
     업종 목록이 아예 다르다. */
  {id:'cro',      name:'CRO',              parent:null, domain:'bio'},
  {id:'smo',      name:'SMO',              parent:null, domain:'bio'},
  {id:'lab',      name:'분석·중앙실험실',   parent:null, domain:'bio'},
  {id:'cdmo',     name:'CDMO',             parent:null, domain:'bio'},
  {id:'pharma',   name:'제약·바이오텍',     parent:null, domain:'bio'},
  {id:'ctit',     name:'임상 IT·데이터',    parent:null, domain:'bio'},
  {id:'img',      name:'영상·이미징',       parent:null, domain:'bio'},
  {id:'hosp',     name:'의료기관',          parent:null, domain:'bio'},
  {id:'reg',      name:'규제·컨설팅',       parent:null, domain:'bio'},
  {id:'booth',    name:'부스시공·전시장치', parent:null, domain:'mice'},
  {id:'av',       name:'무대·음향·조명',    parent:null, domain:'mice'},
  {id:'rental',   name:'렌탈·비품',         parent:null, domain:'mice'},
  {id:'sign',     name:'그래픽·인쇄',       parent:null, domain:'mice'},
  {id:'agency',   name:'행사대행(PCO)',     parent:null, domain:'mice'},
  {id:'venue',    name:'전시장·컨벤션',     parent:null, domain:'mice'},
  {id:'staff',    name:'인력·의전',         parent:null, domain:'mice'},
  {id:'micetech', name:'MICE 솔루션',       parent:null, domain:'mice'},
  {id:'gov',      name:'정부·공공기관',     parent:null, domain:'common'},
  {id:'assoc',    name:'학회·협회',         parent:null, domain:'common'},
  {id:'acad',     name:'대학·연구소',       parent:null, domain:'common'},
  {id:'invest',   name:'투자·금융',         parent:null, domain:'common'},
  {id:'media',    name:'미디어',            parent:null, domain:'common'},
  {id:'etc',      name:'기타',              parent:null, domain:'common'},
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

/* ══════════════════════════════════════════
   TAGS — 연락처 영구 태그 목록(BD/C-level 등) (신규)
   { key, label } — key는 마스터DB 필터/배지 id와 연락처.tags 값에 그대로 쓰인다.
   settings 시트 key='tags'의 JSON에서 로드된다. 설정 > 기업 섹터 탭에서
   추가/이름변경/삭제 가능.
══════════════════════════════════════════ */
export const TAGS = [
  {key:'bd',     label:'BD'},
  {key:'clevel', label:'C-level'},
];
export function setTags(arr){
  TAGS.length = 0;
  TAGS.push(...(arr || []));
}
