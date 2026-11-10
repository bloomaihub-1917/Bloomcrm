/* ══════════════════════════════════════════════════════════════
   upload-tab.js — 업로드(up) 탭: 엑셀/CSV 업로드 파이프라인 + 기업 병합 관리
   (원본 contact_crm.html 2208~3198행, 6577~6653행대에서 정리)

   Twenty CRM의 spreadsheet-import 스텝퍼(업로드→헤더확인→컬럼매칭→검증/저장)를
   벤치마킹해, 원본에서 한 함수(processWorkbook)에 뭉쳐 있던 파싱 과정을
   4개의 명확한 단계 함수로 재구성했다. 각 단계는 끝날 때 #ai-log 패널에
   "N단계: ..." 로그를 남겨 사용자가 지금 어느 단계인지 확인할 수 있다.
   (state.js의 aiStep 값을 단계 번호로 사용)

     STEP 1 업로드         runUploadStep(file)          (원본 startFileParsing, 2266행)
     STEP 2 헤더 확인       runHeaderStep(wb)            (원본 processWorkbook,   2323행)
     STEP 3 컬럼 매칭       runMatchColumnsStep(headers,rows) (원본 mapColumns,   2541행)
     STEP 4 검증 및 저장    runValidationStep(newRows,dupRows) (원본 proceedImport, 2980행)

   ※ 각 단계의 실제 파싱/매칭/중복판정 알고리즘은 원본과 동일하다 —
     바뀐 것은 "몇 개의 함수로 나뉘어 어떤 순서로 화면에 진행 상태를 보여주는가"뿐이다.

   ※ XSS 방지: 업로드된 엑셀의 회사명/이름/이메일/헤더 등 사용자 데이터를
     innerHTML에 넣는 모든 지점에 utils.js의 escapeHtml()을 적용했다
     (원본에는 없던 처리 — showSuspectModal/미리보기 테이블/AI 로그 메시지 등).

   ※ participations 필드명: 원본은 in-memory에서도 p.ev_id/p.ev/p.cid/p.type을
     그대로 썼지만, api.js의 normalizeParticipationRow()가 시트에서 읽어온
     participations를 { eventId, event, contactId, contact, role } 형태로
     통일하므로, 이 모듈에서 새로 생성하는 participation 객체도 같은 형태로
     맞췄다(로직은 동일 — ev_id||ev → eventId, cid → contactId, type||role → role).
     구글시트로 보낼 때의 컬럼 순서(id, ev_id, 행사명, cid, 소속, 성명, 직함, type,
     note, matched)는 원본 그대로 유지한다(원본도 행사명/소속/성명/직함 칸은
     항상 빈 문자열로 저장했음 — api.js 상단 주석 참고).
═══════════════════════════════════════════════════════════════ */

import {
  uploadLogs,
  mergeProps,
  aiLogs,
  parserPrev,
  parsedRows,
  mappedContacts,
  aiStep,
  setAiStep,
  uploadedFileName,
  setUploadedFileName,
  detectedCatFromFilename,
  setDetectedCatFromFilename,
  contacts,
  participations,
  CO_DB,
  getOrgById,
  getContactById,
  EVENT_LIST,
  COMPANY_SECTORS,
  ORG_KINDS,
  CATMAPS,
  PART_TYPES,
  API_BASE_URL,
  currentUser,
  nextContactId,
} from '../state.js';
import { SECTOR_RENAMES } from '../state.js';
import { CL } from '../constants.js';
import { td, normalizeCat, normalizeCountry, escapeHtml, escAttr, scopedSectorName, slugifySectorName, sectorRowValues, sectorKey } from '../utils.js';
import { postToSheet } from '../api.js';
import { saveCatmap } from '../api/settings-save.js';
import { aiStatus, aiMapColumns, aiCompanyPairs } from '../api/ai.js';
import { buildCoCAT } from './company-tab.js';
import { buildCoDB } from '../domain/co-db.js';
import { batchUpsertCompanies, patchOrgFields } from '../domain/org-save.js';
import { ensureOrgsForNames, orgIdForName, suggestSector } from '../domain/orgs.js';
import { renderMDB, buildMDBEvList } from './db-tab.js';
import { trackAction } from '../core/audit-log.js';
/* 화면 상태는 ../features/upload/upload-ui.js의 uploadUi 한곳에 둔다 — 이 탭의 구획을 다른 파일로 떼어도 같은 값을 보게 */
import { uploadUi } from '../features/upload/upload-ui.js';

/* switchApp만 router.js 소관이라 window 경유로 호출한다(router.js가 모든
   tab 모듈을 최상위에서 조립하는 진입점이라 여기서 역참조하면 순환이
   꼬이므로) — router.js가 `window.switchApp = switchApp`로 등록해 둔다. */
export function callHook(name, ...args){
  const fn = window[name];
  if(typeof fn === 'function') return fn(...args);
  console.warn('[upload-tab] "' + name + '"를 찾을 수 없어요 — 관련 모듈이 아직 로드되지 않았을 수 있어요.');
  return undefined;
}

/* ── up 탭 사이드바 하위탭 상태(upload/log/merge) — state.js 밖의 화면 전용 값 ── */

/* ── 업로드 폼의 "연결 행사" 직접입력 모드 여부 (원본 6604행) ── */

/* ── 충돌 없는 신규 id 생성기 (신규) ──
   기존 `Date.now() + random(100000)` 방식은 대량 업로드 시 전 행이 같은
   밀리초를 공유해 충돌 공간이 10만뿐이라, 수백 행 업로드에서 id 충돌로
   연락처가 조용히 누락되는 버그가 있었다. ms 타임스탬프 × 1000 + 단조
   증가 카운터로 세션 내 충돌을 원천 차단한다 (최대값 ≈ 1.7e15로
   Number.MAX_SAFE_INTEGER 이내 — 기존 숫자 id 체계와 호환). */
export const genContactId = () => nextContactId();   // state.js — 기존 최대 id보다 크게, 1씩

/* ═══════════════════════════════════════
   AI 로그 한 줄 추가 (애니메이션 없이 즉시) (원본 2838행)
   state.js의 aiLogs 배열에도 함께 기록해 DOM 밖에서도 진행 이력을 조회할 수 있게 함.
═══════════════════════════════════════ */
const AI_LOG_ICONS = {
  ok:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;color:#6EFF6E"><polyline points="20 6 9 17 4 12"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;color:#FFD166"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;color:#74C0FC"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};
export function addAiLog(type, msg){
  const log = document.getElementById('ai-log');
  const stepPrefix = aiStep ? '[' + aiStep + '/4단계] ' : '';
  if(log){
    const p = document.createElement('p');
    p.innerHTML = (AI_LOG_ICONS[type] || AI_LOG_ICONS.ok) + ' ' + stepPrefix + msg;
    p.className = type;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
  }
  aiLogs.push({ t: type, m: stepPrefix + msg });
}

/* «업로드 STEP 1 — 파일 읽기와 파일명으로 카테고리 짐작»은 ../features/upload/upload-read.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* ═══════════════════════════════════════
   STEP 2 — 헤더 확인: 워크북 → 첫 시트 JSON 변환 + 헤더 언어 감지 (원본 processWorkbook, 2323~2346행)
═══════════════════════════════════════ */
export function runHeaderStep(wb){
  setAiStep(2);
  const sheetNames = wb.SheetNames;
  addAiLog('ok', '2단계: 헤더 확인 — 시트 ' + sheetNames.length + '개 감지: ' + escapeHtml(sheetNames.join(', ')));

  const firstSheet = wb.Sheets[sheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '', raw: false });

  if(!rows.length){
    addAiLog('warn', '데이터가 없는 빈 시트예요');
    return;
  }

  parsedRows.splice(0, parsedRows.length, ...rows);
  addAiLog('ok', '행 ' + rows.length + '개 추출 완료');

  // 언어 감지 (헤더에 한글/영문 혼합 여부)
  const headers = Object.keys(rows[0]);
  const hasKo = headers.some(h => /[가-힣]/.test(h));
  const hasEn = headers.some(h => /^[A-Za-z\s]+$/.test(h));
  addAiLog('ok', '컬럼 ' + headers.length + '개: ' + (hasKo && hasEn ? '국문/영문 혼합' : hasKo ? '국문' : '영문'));

  runMatchColumnsStep(headers, rows);
}

/* ═══════════════════════════════════════
   STEP 3 — 컬럼 매칭: 헤더 자동 매핑 + 미리보기 + contacts 형식 변환 + 중복/의심 판정
   (원본 guessColumn 2515행, mapColumns 2541~2805행)
═══════════════════════════════════════ */
const COLUMN_ALIASES = {
  nameKo: [
    '이름','성명','성함','국문명','한글명','한글이름','한글성명',
    '담당자','참가자명','성명(국문)',
    'nameko','namekr','namekor','koreanname','name_ko','ko_name',
  ],
  nameEnFirst: [
    '영문명(이름)',
    'firstname','first name','givenname','given name','f name','name_first',
    'nameen_f','nameen_first',
    'name (english first)','name(english first)',
  ],
  /* 중간이름은 따로 보관하지 않는다 — nameEn에 First·Middle·Last 순으로
     합쳐 넣는다. 우리 쪽에서 쓰는 건 언제나 «부르는 전체 이름» 한 줄이라
     칸을 나눠두면 표시할 때마다 도로 이어붙여야 한다. */
  middleName: [
    '영문명(중간이름)','중간이름','미들네임',
    'middlename','middle name','middle','middleinitial','middle initial',
    'name_middle','nameen_m','nameen_middle',
  ],
  lastName: [
    '영문명(성)','영문(성)','성(영문)',
    'lastname','last name','surname','familyname','family name','lname','name_last',
    'nameen_l','nameen_last',
    'name (english last)','name(english last)',
  ],
  nameEn: [
    '영문이름','영문성명','이름(영문)','영문명',
    'nameen','name_en','englishname','english name',
    'name(en)','nameen_full',
  ],
  orgKo: [
    '기업','회사','소속','기관','소속기관','소속(회사/기관)','소속(국문)',
    '기업명','기관/기업/단체명','기관명','단체명','업체명','기업명(국문)','기관/단체명',
    '회사명','기관명','단체명',
    'orgko','org_ko','ko_org',
    'organization','company','org','institute','affiliation',
  ],
  orgEn: [
    '영문기업','영문회사','영문소속','영문기관',
    '소속(영문)','기관(영문)','회사(영문)','소속영문','기관영문',
    'orgen','org_en','org(en)',
    'companyen','company_en','company(en)',
    'organizationen','organization_en','organization(en)',
    'affiliationen','affiliation_en','affiliation(en)',
    'institutionen','institution_en',
    'englishcompany','englishorg','englishorganization','englishaffiliation',
    'company name','companyname',
  ],
  /* 경칭은 직함이 아니다 — Dr.는 «박사님»이라 부르는 호칭이고,
     titleKo/titleEn은 그 사람이 회사에서 맡은 자리다. 섞으면 명단에
     "Dr." 가 직함 칸에 찍힌다. */
  prefix: ['경칭','호칭','존칭','prefix','salutation','honorific','titleprefix','name prefix'],
  titleKo: [
    '직함','직책','직급','직위','국문직위','국문직책','국문직함',
    '직책(국문)','직함(국문)','직위(국문)',
    'position','titleko','title_ko',
  ],
  titleEn: [
    '영문직함','영문직책','직책(영문)','직함(영문)','영문직위',
    'title','titleen','positionen','position(en)','title_en','titleen',
    'job title','jobtitle',
  ],
  deptKo: ['부서','부서명','소속부서','담당부서','팀','팀명','부서(국문)','팀(국문)','department','dept'],
  deptEn: ['영문부서','영문팀','부서(영문)','팀(영문)','departmenten','department(en)'],
  country: ['국가','나라','country','nation'],
  email1:  ['이메일','이메일1','메일','메일주소','이메일주소','email','email1','e-mail','mail'],
  email2:  ['이메일2','보조이메일','email2','email address 2'],
  /* 명단에 유선과 휴대폰이 같이 있으면 유선이 먼저 온다(기관 명단이 그렇다).
     둘 다 남겨야 해서 phone1/phone2 두 칸에 나눠 담는다 — 어느 쪽을 1번으로
     둘지는 매핑 드롭다운에서 바꿀 수 있다. */
  phone1: [
    '연락처','전화번호','연락처1','휴대폰','휴대폰번호','핸드폰','핸드폰번호','휴대전화',
    'phone','phone1','tel','hp',
  ],
  phone2: [
    '연락처2','전화번호2','휴대폰2','일반번호','대표번호','유선번호','사무실번호','사무실',
    'mobile','mobile number','cell','cellphone',
    'phone2','tel2','mobile phone','mobilephone',
  ],
  /* '카테고리'를 뺐다 — 우리 명단에서 그 말은 참가 구분이 아니라 업종의 세분류로
     쓰인다(셀러 명단의 «카테고리» 열은 LED·음향·렌탈 같은 취급 품목이다).
     참가 구분으로 읽히면 154종짜리 값별 매핑 창이 뜬다. 참가 구분은 아래
     '구분/참가구분/등록구분'과 업로드 화면의 «기본 카테고리»로 잡는다. */
  cat: ['분류','구분','참가구분','등록구분','참가유형','category','role'],
  beat:     ['대분류','분야','업종','업종대분류','산업분야','섹터','취재분야','출입처','beat','sector','industry'],
  products: ['전시품목','품목','제품','제품명','취급품목','출품작','products','exhibits','item'],
  /* 회사·제품 소개글 — 사람이 아니라 회사의 글이라 기업 DB의 «회사소개»로 간다.
     참가 신청서(KOTRA 상담회 등)는 «제품소개(국문)»처럼 적어 온다. */
  intro:    ['회사소개','기업소개','제품소개','제품설명','intro','company profile','description'],
  website:  ['웹페이지','홈페이지','웹사이트','website','homepage','url'],
  /* 행마다 출처가 다른 명단이 있다(이벤트넷에서 긁어온 줄과 직접 받은 줄이 섞인다).
     열이 없으면 업로드 화면의 «수집 출처» 한 값을 전체에 쓴다 — 예전 그대로다. */
  source:   ['출처','수집출처','유입경로','source','origin'],
  note:     ['비고','설명','참고사항','note','notes','remark','remarks'],
  /* memo1~3: 기본 항목으로 떨어지지 않는 열을 그대로 담아 두는 칸.
     위 note와 달리 연락처 자신에게 붙는다(note는 소속 기업의 메모로 간다). */
  memo1:    ['메모','메모1','카테고리','세부카테고리','소분류','기타','기타1','memo','memo1'],
  memo2:    ['메모2','기타2','memo2'],
  memo3:    ['메모3','기타3','memo3'],
};

/* ── 대분류 → 표준 섹터 이름 ──
   명단의 대분류는 사람이 손으로 적은 값이라 같은 뜻이 여러 표기로 온다
   (이벤트 부스 / 이벤트부스, 프리렌서, 동역). 원문을 그대로 흘려보내면
   기업DB 섹터에 «IT Soultion»이 그랬듯 아무도 다시 안 보는 분류가 쌓인다.
   그래서 여기서 한 번 표준 이름으로 접는다 — 표준 목록 자체는
   backend-node/db/seeds/seed-evk-sectors.js가 심는다.

   «동역»은 오타로 보인다. 원본 파일의 «카테고리 정리» 시트에서 그 열 아래에
   통역사·통역장비·통역운영이 달려 있어 통역으로 접었다. */
const SECTOR_ALIASES = {
  // 셀러 — 표기 흔들림과 오타만 접는다. 대분류 이름 자체는 명단 그대로 쓴다.
  '전시부스/무대/구조물': '부스/무대/구조물',
  '베뉴(대관사)': '베뉴',
  '이벤트부스': '이벤트 부스',
  '프리렌서': '프리랜서',
  '동역': '통역',
  // 바이어 — 같은 뜻인데 표기가 갈린 것들
  '지자체': '지방자치단체',
  '협·단체': '협∙단체',
  '협.단체': '협∙단체',
  '협회': '협∙단체',
  '학회': '협∙단체',
  '체육단체': '협∙단체',
  '대학': '대학교',
  '학교(대학)': '대학교',
  '민간기업': '기업',
  '기업(단독행사주최기업)': '기업',
};

function normalizeSector(v){
  const t = String(v || '').trim();
  if(!t) return '';
  /* 설정에서 이름을 바꾼 섹터는 옛 표기로 와도 바뀐 이름으로(바뀐 것이 또 바뀌어도 끝까지 따라간다) */
  let cur = SECTOR_ALIASES[t] || SECTOR_ALIASES[t.toLowerCase()] || t;
  for(let i = 0; i < 5 && SECTOR_RENAMES[cur]; i++) cur = SECTOR_RENAMES[cur];
  return cur;
}

/* 컬럼명 자동 매핑 후보 탐색 (원본 2515~2539행) */
const COL_SEP = /[\s_\-\/().·,]/;
const colNorm = h => String(h||'').toLowerCase().replace(/[\s_\-\/().·,]/g,'');

/* 정규화하면서 «원문에서 낱말이 시작된 자리»를 함께 적어 둔다.
   2단계가 낱말 한가운데를 물지 않게 하려면 이 자리가 필요하다 —
   «AIA Designation»이 국가로 잡힌 적이 있다. 별칭 «nation»이
   desig-nation의 꼬리에 걸려서, 85명의 국가 칸에 AIA 등급이 들어갔다. */
function colNormWithStarts(h){
  let out = ''; const starts = new Set([0]); let atStart = true;
  for(const ch of String(h||'').toLowerCase()){
    if(COL_SEP.test(ch)){ atStart = true; continue; }
    if(atStart){ starts.add(out.length); atStart = false; }
    out += ch;
  }
  return { text: out, starts };
}

function guessColumn(headers, aliases, usedHeaders){
  const used = usedHeaders || new Set();

  // 1단계: 완전 일치
  for(const h of headers){
    if(used.has(h)) continue;
    const nh = colNorm(h);
    for(const a of aliases){
      if(nh === colNorm(a)) return h;
    }
  }
  /* 2단계: alias가 헤더 안에 들어 있으면 같은 것으로 본다 — 4자 이상만,
     그리고 «낱말이 시작되는 자리»에서 시작할 때만. 그래야 Preferred Email의
     email은 잡고 Designation의 nation은 안 잡는다. */
  for(const h of headers){
    if(used.has(h)) continue;
    const nh = colNormWithStarts(h);
    for(const a of aliases){
      const na = colNorm(a);
      if(na.length < 4) continue;
      for(let i = nh.text.indexOf(na); i >= 0; i = nh.text.indexOf(na, i + 1)){
        if(nh.starts.has(i)) return h;
      }
    }
  }
  return null;
}

/* ── 간단한 기업명 유사도 병합 제안 (원본 2808~2835행) ──
   업로드 파일에 알려진 다국어 표기 쌍(KNOWN_PAIRS)이 있고, 기존 DB에도 짝이
   이미 있으면 업로드 폼(#merge-wrap) 안에 병합 제안 카드를 보여준다.
   ※ "기업병합관리" 사이드 하위탭(switchUV('merge'))의 mergeProps 목록과는
     별개의 기능 — 이건 업로드 직후 즉석에서 보여주는 간단한 휴리스틱 제안이다. */
/* 전에는 4쌍(삼성전자·현대자동차·구글·AWS)을 코드에 적어 두고, 승인을 눌러도
   아무것도 저장하지 않았다. 이제는 기업DB에 없는 파일의 회사명만 모아
   «✨ 기존 기업과 같은 곳 찾기»를 띄운다 — 매핑을 바꿀 때마다 다시 그려지므로 AI는 눌렀을 때만 부른다.
   «기존 기업으로 넣기»는 그 표기를 기존 기업의 옛 이름(aliases)에 더한다. 그러면 저장할 때
   ensureOrgsForNames가 새 기업을 만들지 않고 기존 기업에 붙인다. */
function checkMergeCandidate(rows){
  const mergeWrap = document.getElementById('merge-wrap');
  if(!mergeWrap) return;
  const names = [...new Set(rows.map(r => String(r.orgKo || r.orgEn || r.org || '').trim()).filter(Boolean))];
  const fresh = names.filter(n => !orgIdForName(n));
  const same = fresh.length === uploadUi.coNew.length && fresh.every((n, i) => n === uploadUi.coNew[i]);
  if(!same){ uploadUi.coNew = fresh; uploadUi.coPairs = []; }
  renderCoMatch();
}
function renderCoMatch(msg){
  const mergeWrap = document.getElementById('merge-wrap');
  if(!mergeWrap) return;
  if(!uploadUi.aiOn || !uploadUi.coNew.length){ mergeWrap.innerHTML = ''; return; }
  const cards = uploadUi.coPairs.map((p, i) => {
    const o = getOrgById(p.b);
    if(!o) return '';
    const on = o.name_ko || o.name_en;
    return `<div style="border:1px solid var(--i6);border-radius:var(--r);padding:8px 10px;margin-top:6px;background:var(--W)">
      <div style="font-size:var(--fs-12)"><b>${escapeHtml(p.a)}</b> <span style="color:var(--i4)">(파일)</span> → <b>${escapeHtml(on)}</b>
        ${o.name_ko && o.name_en ? `<span style="color:var(--i4)">${escapeHtml(o.name_en)}</span>` : ''} <span style="color:var(--i4)">(기업DB)</span></div>
      <div style="font-size:var(--fs-11);color:var(--i4);margin-top:2px">✨ ${escapeHtml(p.reason)}</div>
      ${p.caution ? `<div style="font-size:var(--fs-11);color:var(--am);margin-top:2px">⚠️ ${escapeHtml(p.caution)}</div>` : ''}
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn bp bs" onclick="coMatchApply(${i})">기존 «${escapeHtml(on)}»으로 넣기</button>
        <button class="btn bs" onclick="coMatchSkip(${i})">새 기업으로 둠</button>
      </div></div>`;
  }).join('');
  mergeWrap.innerHTML = `<div style="border:1px solid var(--i6);border-radius:var(--rd-10);padding:10px 12px;margin:8px 0;background:var(--i8)">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:var(--fs-12)">
      <span>기업DB에 없는 회사 <b>${uploadUi.coNew.length}곳</b>이 새 기업으로 들어갈 예정이에요.</span>
      <button class="btn bs" id="co-match-btn" style="font-size:var(--fs-11)" onclick="coMatchFind()"
        title="회사명만 보냅니다 — 국문·영문 표기나 약칭이 달라 같은 회사인데 새로 생기는 것을 막아요">✨ 기존 기업과 같은 곳 찾기</button>
    </div>
    ${msg ? `<div style="font-size:var(--fs-11);color:var(--i3);margin-top:6px">${msg}</div>` : ''}
    ${cards}</div>`;
}
export async function coMatchFind(){
  const btn = document.getElementById('co-match-btn');
  if(btn){ btn.disabled = true; btn.textContent = '✨ 찾는 중…'; }
  const known = CO_DB.map(c => ({ id: c.key, ko: c.nameKo || '', en: c.nameEn || '' })).filter(o => o.ko || o.en);
  const r = await aiCompanyPairs({ known, incoming: uploadUi.coNew });
  if(!r.ok){ renderCoMatch('<span style="color:var(--re)">AI로 찾지 못했어요: ' + escapeHtml(r.error || '') + '</span>'); return; }
  uploadUi.coPairs = r.pairs || [];
  addAiLog('ok', '✨ 새 회사 ' + uploadUi.coNew.length + '곳 중 ' + uploadUi.coPairs.length + '곳이 기존 기업과 같아 보여요');
  renderCoMatch(uploadUi.coPairs.length ? '' : '✨ 기존 기업과 같은 곳을 찾지 못했어요 — 모두 새 기업으로 들어갑니다.');
}
export async function coMatchApply(i){
  const p = uploadUi.coPairs[i];
  const o = p && getOrgById(p.b);
  if(!o) return;
  const before = o.aliases || '';
  const list = String(before).split('\n').map(v => v.trim()).filter(Boolean);
  if(!list.includes(p.a)) list.push(p.a);
  const r = await patchOrgFields(o.id, { aliases: list.join('\n') });
  if(r && r.ok === false){ alert('저장하지 못했어요 — 다시 시도해주세요.'); return; }
  trackAction('edit', '기업 옛 이름 추가', o.name_ko || o.name_en, `업로드 표기 «${escapeHtml(p.a)}»를 같은 기업으로 연결`);
  addAiLog('ok', '«' + escapeHtml(p.a) + '» → 기존 «' + escapeHtml(o.name_ko || o.name_en) + '»에 붙여요');
  uploadUi.coNew = uploadUi.coNew.filter(n => n !== p.a);
  uploadUi.coPairs.splice(i, 1);
  renderCoMatch();
}
export function coMatchSkip(i){ uploadUi.coPairs.splice(i, 1); renderCoMatch(); }

/* STEP 3 본체 (원본 mapColumns, 2541~2805행) */
export function runMatchColumnsStep(headers, rows){
  setAiStep(3);
  const colMap = {};
  const usedHeaders = new Set();
  for(const key in COLUMN_ALIASES){
    const matched = guessColumn(headers, COLUMN_ALIASES[key], usedHeaders);
    colMap[key] = matched;
    if(matched) usedHeaders.add(matched);
  }
  /* 머리글은 «이름»인데 값이 영문인 명단(해외 참가자) — 한글 이름 칸이 아니라 영문 이름 칸으로.
     값 있는 줄의 70% 넘게 한글이 없으면 영문 이름으로 본다. 영문 이름 열이 따로 있으면 그대로 둔다. */
  if(colMap.nameKo && !colMap.nameEn && !colMap.nameEnFirst && !colMap.lastName){
    const vals = rows.map(r => String(r[colMap.nameKo] ?? '').trim()).filter(Boolean);
    const latin = vals.filter(v => !/[가-힣]/.test(v) && /[A-Za-z]/.test(v)).length;
    if(vals.length && latin / vals.length > 0.7){
      addAiLog('ok', '«' + escapeHtml(colMap.nameKo) + '» 열은 값이 영문이라 이름(영문)으로 넣어요 (' + latin + '/' + vals.length + '줄)');
      colMap.nameEn = colMap.nameKo;
      colMap.nameKo = null;
    }
  }

  // ── 매핑 결과 상세 로그 ──
  const mappedKeys = Object.entries(colMap).filter(([,v])=>v).map(([k,v])=>v+'→'+k);
  addAiLog('ok', '3단계: 컬럼 매칭 완료 (' + mappedKeys.length + '개): ' + escapeHtml(mappedKeys.join(', ')));
  if(!colMap.nameKo && !colMap.nameEn){
    addAiLog('warn', '⚠️ 이름 컬럼을 찾지 못했어요. 파일 헤더: ' + escapeHtml(headers.join(', ')));
  }
  console.log('[upload-tab] colMap:', JSON.stringify(colMap));
  console.log('[upload-tab] 첫번째행 샘플:', JSON.stringify(rows[0]));

  // 재사용을 위해 보관 — 사용자가 드롭다운으로 매핑을 고치면 이 값들로 다시 계산한다
  uploadUi.lastHeaders = headers;
  uploadUi.lastRows = rows;
  for(const k in _aiPicks){ delete _aiPicks[k]; delete _aiReasons[k]; }
  checkAiOn();

  renderColumnMappingPreview(headers, rows, colMap);
  applyColumnMap(colMap);
}

/* ══════════════════════════════════════════
   컬럼 매핑 미리보기 — Twenty CRM의 MatchColumnsStep 벤치마킹.
   원본 컬럼(파일의 실제 헤더) 하나하나를 행으로 보여주고, 그 컬럼이
   어느 DB 필드로 들어갈지를 드롭다운으로 직접 고칠 수 있게 한다.
   (원본에는 없던 기능 — 자동 매칭 결과를 표시만 하던 것을, 신뢰도가
   낮거나 잘못 매칭된 컬럼을 사용자가 즉시 바로잡을 수 있도록 개선함)
══════════════════════════════════════════ */
const DB_FIELD_LABELS = {
  '': '매핑 안 함',
  nameKo: '이름(한글)', nameEn: '이름(영문)',
  nameEnFirst: '이름(영문·이름부분)', middleName: '이름(영문·중간이름)', lastName: '이름(영문·성)',
  orgKo: '기업(한글)', orgEn: '기업(영문)',
  titleKo: '직함(한글)', titleEn: '직함(영문)',
  deptKo: '부서(한글)', deptEn: '부서(영문)',
  prefix: '경칭(Mr./Dr.)',
  country: '국가', email1: '이메일1', email2: '이메일2',
  phone1: '연락처1', phone2: '연락처2',
  cat: '카테고리', beat: '분야(산업/업종)', products: '전시품목(기업 취급 품목)',
  intro: '기업 회사소개', website: '웹사이트', note: '기업 메모', source: '수집 출처',
  memo1: '메모1', memo2: '메모2', memo3: '메모3',
};

function renderColumnMappingPreview(headers, rows, colMap){
  const sample = rows[0] || {};
  const prevEl = document.getElementById('parser-prev');
  if(!prevEl) return;

  if(!headers.length){
    prevEl.innerHTML = '<tr><td colspan="4" style="padding:18px;text-align:center;color:var(--re);font-size:var(--fs-11)">컬럼을 찾지 못했어요. 헤더명을 확인해주세요.</td></tr>';
    return;
  }

  const optionsHtml = (selectedKey) => Object.entries(DB_FIELD_LABELS)
    .map(([key,label]) => `<option value="${key}"${key===selectedKey?' selected':''}>${escapeHtml(label)}</option>`)
    .join('');

  // 데이터가 실제로 들어있는 컬럼인지 확인(헤더만 있고 전부 빈 값이면 매핑 안내 대상에서 제외)
  const hasData = (h) => rows.some(r => String(r[h] ?? '').trim() !== '');

  // 매핑되지 않았는데 데이터는 있는 컬럼 — 조용히 버리지 않고 사용자에게 결정을 묻는다
  const unmappedWithData = headers.filter(h => !Object.values(colMap).includes(h) && hasData(h));

  /* 머리글 없는 열(__EMPTY, __EMPTY_2…)은 병합 셀·비고 찌꺼기가 많다 — 이름을 늘어놓지 않고 개수로 묶는다 */
  const named = unmappedWithData.filter(h => !/^__EMPTY/.test(h));
  const blankN = unmappedWithData.length - named.length;
  const warnCols = [named.length ? `<b>${escapeHtml(named.join(', '))}</b>` : '', blankN ? `<b>머리글 없는 열 ${blankN}개</b>` : '']
    .filter(Boolean).join(', ');
  const warnRow = unmappedWithData.length
    ? `<tr><td colspan="4" style="padding:10px 12px;background:var(--ab);border-bottom:1px solid var(--aml);font-size:var(--fs-11);color:var(--am)">
        ${uploadUi.aiOn ? `<button class="btn" id="ai-map-btn" style="font-size:var(--fs-10_5);margin-right:6px" onclick="aiFillColumns()"
          title="머리글과 값의 모양(한글=가, 영문=a, 숫자=9)만 보냅니다. 실제 이름·메일·전화는 보내지 않아요">✨ AI로 남은 열 맞추기</button>` : ''}
        ⚠️ ${warnCols} 에는 데이터가 있지만 아직 어느 DB 항목에 넣을지 정하지 않았어요.
        노란색 행의 "DB 컬럼" 드롭다운으로 매핑해주세요 — 매핑하지 않으면 저장되지 않고 버려집니다.
      </td></tr>`
    : '';

  const bodyRows = headers.map(h => {
    const matchedKey = Object.keys(colMap).find(k => colMap[k] === h) || '';
    const isAuto = !!matchedKey;
    const aiWhy = matchedKey && _aiPicks[h] === matchedKey ? _aiReasons[h] : '';
    const needsDecision = !isAuto && hasData(h);
    return `
      <tr${needsDecision ? ' style="background:var(--ab)"' : ''}>
        <td style="padding:7px 10px;border-bottom:1px solid var(--i7);font-family:monospace;font-size:var(--fs-11);color:var(--i2)">${escapeHtml(h)}</td>
        <td style="padding:7px 10px;border-bottom:1px solid var(--i7)">
          <select class="fi cm-select" data-header="${escapeHtml(h)}" onchange="onColumnMapChange()" style="font-size:var(--fs-11);padding:3px 6px;width:auto">
            ${optionsHtml(matchedKey)}
          </select>
        </td>
        <td style="padding:7px 10px;border-bottom:1px solid var(--i7);font-size:var(--fs-11);color:var(--i3)">${escapeHtml(String(sample[h] ?? ''))}</td>
        <td style="padding:7px 10px;border-bottom:1px solid var(--i7);font-size:var(--fs-10);color:${needsDecision?'var(--am)':'var(--i3)'}" class="cm-badge"${aiWhy ? ` title="${escapeHtml(aiWhy)}"` : ''}>${aiWhy ? '✨ AI 추천 — ' + escapeHtml(aiWhy) : isAuto ? '자동 인식' : (needsDecision ? '⚠️ 매핑 필요' : '미매핑')}</td>
      </tr>`;
  }).join('');

  prevEl.innerHTML = warnRow + bodyRows;

  if(unmappedWithData.length){
    addAiLog('warn', '⚠️ 데이터는 있지만 아직 매핑되지 않은 컬럼: ' + escapeHtml(unmappedWithData.join(', ')) + ' — 매핑하지 않으면 저장되지 않아요. 위 표에서 매핑해주세요.');
  }

  // 다른 화면에서 재조회할 수 있게 state.js의 parserPrev에도 반영
  parserPrev.splice(0, parserPrev.length, ...headers.map(h => ({
    orig: h, db: DB_FIELD_LABELS[Object.keys(colMap).find(k => colMap[k] === h) || ''] || '매핑 안 함',
    sample: sample[h], conf: null,
  })));
}

/* 컬럼 매핑 드롭다운 변경 시 — DOM에서 현재 선택값을 읽어 colMap을
   다시 만들고, 파싱 결과(mappedContacts)를 즉시 재계산한다. */
export function onColumnMapChange(){
  if(!uploadUi.lastHeaders || !uploadUi.lastRows) return;
  const selects = Array.from(document.querySelectorAll('#parser-prev .cm-select'));
  const newColMap = {};
  const usedKeys = new Set();
  selects.forEach(sel => {
    const key = sel.value;
    const header = sel.dataset.header;
    if(!key) return;
    if(usedKeys.has(key)){
      addAiLog('warn', '⚠️ "' + escapeHtml(DB_FIELD_LABELS[key]||key) + '" 필드에 컬럼이 두 개 이상 선택됐어요 — 마지막 선택(' + escapeHtml(header) + ')만 반영돼요.');
    }
    usedKeys.add(key);
    newColMap[key] = header;
  });
  // 표 전체를 다시 그려서 "매핑 필요" 경고/강조가 즉시 갱신되게 한다
  // (각 행의 선택값은 newColMap을 통해 그대로 유지된다)
  renderColumnMappingPreview(uploadUi.lastHeaders, uploadUi.lastRows, newColMap);
  applyColumnMap(newColMap);
}

/* ── AI로 남은 열 맞추기 ──
   규칙(COLUMN_ALIASES)으로 못 맞춘 열만 묻는다. 사람이 이미 고른 칸은 건드리지 않는다.
   보내는 것: 머리글, 값 있는 줄 수, 값 3개의 «모양»(한글=가, 영문=a/A, 숫자=9).
   실제 값은 보내지 않는다 — 서버(routes/ai.js)도 한 번 더 모양으로 바꾼다. */
const _aiPicks = {}, _aiReasons = {};
// 로그인 뒤 첫 업로드 때 한 번 묻는다 — 서버에 키가 있을 때만 단추가 보인다
function checkAiOn(){
  if(uploadUi.aiAsked) return;
  uploadUi.aiAsked = true;
  aiStatus().then(r => {
    if(r && r.offline){ uploadUi.aiAsked = false; return; }
    uploadUi.aiOn = !!(r && r.enabled);
    if(uploadUi.aiOn && uploadUi.lastHeaders) onColumnMapChange();
  }).catch(() => { uploadUi.aiAsked = false; });
}
const shapeOf = (v) => String(v ?? '').slice(0, 40)
  .replace(/[가-힣ㄱ-ㅎㅏ-ㅣ]/g, '가').replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/[0-9]/g, '9')
  .replace(/[^가Aa9@.-_/()+:,# ]/g, '?');
export async function aiFillColumns(){
  if(!uploadUi.lastHeaders || !uploadUi.lastRows) return;
  const selects = Array.from(document.querySelectorAll('#parser-prev .cm-select'));
  const usedKeys = new Set(selects.map(s => s.value).filter(Boolean));
  const open = selects.filter(s => !s.value && uploadUi.lastRows.some(r => String(r[s.dataset.header] ?? '').trim() !== ''));
  if(!open.length){ addAiLog('ok', '맞출 열이 남아 있지 않아요.'); return; }
  const fields = Object.entries(DB_FIELD_LABELS).filter(([k]) => k && !usedKeys.has(k)).map(([key, label]) => ({ key, label }));
  const columns = open.map(s => {
    const h = s.dataset.header;
    const vals = uploadUi.lastRows.map(r => String(r[h] ?? '').trim()).filter(Boolean);
    return { header: h, filled: vals.length, samples: vals.slice(0, 3).map(shapeOf) };
  });
  const btn = document.getElementById('ai-map-btn');
  if(btn){ btn.disabled = true; btn.textContent = '✨ 맞추는 중…'; }
  addAiLog('ok', '✨ AI에게 열 ' + columns.length + '개를 물어봐요 (머리글과 값의 모양만 보냄)');
  const r = await aiMapColumns({ fields, columns });
  if(!r.ok){
    addAiLog('warn', '⚠️ AI 열 맞추기 실패: ' + escapeHtml(r.error || ''));
    if(btn){ btn.disabled = false; btn.textContent = '✨ AI로 남은 열 맞추기'; }
    return;
  }
  let n = 0;
  (r.mappings || []).forEach(m => {
    if(!m.field || usedKeys.has(m.field)) return;
    const sel = open.find(s => s.dataset.header === m.header);
    if(!sel) return;
    sel.value = m.field; usedKeys.add(m.field);
    _aiPicks[m.header] = m.field; _aiReasons[m.header] = m.reason || '';
    n++;
    addAiLog('ok', '✨ ' + escapeHtml(m.header) + ' → ' + escapeHtml(DB_FIELD_LABELS[m.field] || m.field) + (m.reason ? ' — ' + escapeHtml(m.reason) : ''));
  });
  addAiLog(n ? 'ok' : 'warn', n ? '✨ ' + n + '개 열을 맞췄어요. 표에서 확인하고, 틀리면 드롭다운으로 고쳐주세요.' : 'AI도 맞는 칸을 찾지 못했어요. 직접 골라주세요.');
  onColumnMapChange();
}

/* 담당자 이름이 없어 연락처는 못 만들지만 기업은 등록해야 하는 줄 */
export const _orgOnlyRows = [];

/* 명단 한 줄에서 소속 기업에 붙일 값 — 기업 DB에서 비어 있는 칸만 채운다.
   품목은 연락처(products)에도 그대로 남는다(마스터DB 검색이 그쪽을 본다). */
export const COMPANY_FILL = ['website', 'notes', 'products', 'intro'];
export const companyInfoOf = r => ({
  key: (r.orgKo || r.orgEn || '').trim(),
  website: r._companyWebsite || '', notes: r._companyNote || '',
  products: r.products || '', intro: r._companyIntro || '',
});

/* colMap을 실제로 적용해 mappedContacts(파싱 결과)를 계산하고,
   AI 로그/"DB에 추가" 버튼을 갱신한다. 최초 자동 매칭 시와, 사용자가
   드롭다운으로 매핑을 고쳤을 때 둘 다 이 함수를 통해 재계산된다. */
function applyColumnMap(colMap){
  uploadUi.lastColMap = colMap;
  const headers = uploadUi.lastHeaders || [];
  const rows = uploadUi.lastRows || [];

  // 카테고리 기본값 (업로드 화면에서 선택한 값)
  const defaultCatSel = document.getElementById('up-cat');
  const defaultCat = defaultCatSel ? defaultCatSel.value : '';

  /* ── 카테고리 결정 우선순위 ──
     1) 컬럼 자체에 카테고리 값이 있으면 그 값 (행마다 다를 수 있음)
     2) 사용자가 드롭다운에서 직접 선택했으면 그 값 (전체 행 동일)
     3) 파일명에서 자동 추정한 값 (전체 행 동일)
     4) 위 모두 없으면 'attendee'(일반참가자, 기본값) —
        cat은 speaker/vip/attendee 3분류만 쓰므로 기본값도 그에 맞춤 */
  if(!colMap.cat){
    let categorySource;
    if(defaultCat && defaultCat !== ''){
      categorySource = '사용자 선택 (' + (CL[defaultCat]||defaultCat) + ')';
    } else if(detectedCatFromFilename){
      categorySource = '파일명 추정 (' + CL[detectedCatFromFilename] + ')';
    } else {
      categorySource = '기본값 (일반참가자)';
    }
    addAiLog('ok', '카테고리 적용 방식: ' + categorySource);
  } else {
    addAiLog('ok', '카테고리 적용 방식: 컬럼(' + escapeHtml(colMap.cat) + ')에서 행별로 인식');
  }

  // 실제 contacts 형식으로 변환 + 중복 감지
  // 1순위: email1 완전 일치 → 확실한 중복
  // 2순위: 이름(한글 or 영문) 일치 → 의심 케이스 (사용자 확인 필요)
  const emailMap = {};
  const nameMap  = {};
  contacts.forEach(c => {
    if(c.email1) emailMap[c.email1.toLowerCase()] = c;
    if(c.email2) emailMap[c.email2.toLowerCase()] = c;
    const nk = (c.nameKo||c.name||'').trim();
    const ne = (c.nameEn||'').trim();
    if(nk){ if(!nameMap[nk]) nameMap[nk]=[]; nameMap[nk].push(c); }
    if(ne){ if(!nameMap[ne]) nameMap[ne]=[]; nameMap[ne].push(c); }
  });

  let dupCount = 0;
  let countryDetectedCount = 0;
  const result = rows.map(r => {
    const rawNameKo      = colMap.nameKo      ? String(r[colMap.nameKo]     ||'').trim() : '';
    const rawNameEn      = colMap.nameEn      ? String(r[colMap.nameEn]     ||'').trim() : '';
    const rawNameEnFirst = colMap.nameEnFirst  ? String(r[colMap.nameEnFirst]||'').trim() : '';
    const rawMiddle      = colMap.middleName   ? String(r[colMap.middleName] ||'').trim() : '';
    const rawLast        = colMap.lastName     ? String(r[colMap.lastName]   ||'').trim() : '';

    const isKorean = (s) => /[가-힣]/.test(s);

    /* First·Middle·Last를 한 줄로 잇는다. 한 칸에 이미 전체 이름이 들어 있는
       파일이 있어서(성 칸에 "John Smith"), 다른 조각을 전부 품고 있는 칸이
       있으면 이어붙이지 않고 그 칸만 쓴다 — 안 그러면 "John John Smith"가 된다. */
    const buildEnName = (first, middle, last) => {
      const parts = [first, middle, last].map(v => (v||'').trim()).filter(Boolean);
      if(!parts.length) return '';
      const full = parts.find(p =>
        parts.every(q => q === p || p.toLowerCase().includes(q.toLowerCase())));
      return full || parts.join(' ');
    };

    let nameKo = '', nameEn = '';
    const sameCol = (colMap.nameKo && colMap.nameEn && colMap.nameKo === colMap.nameEn);

    if(rawNameEnFirst){
      nameEn = buildEnName(rawNameEnFirst, rawMiddle, rawLast);
      if(rawNameKo && isKorean(rawNameKo)) nameKo = rawNameKo;
    } else if(rawNameEn && !sameCol){
      nameEn = isKorean(rawNameEn) ? '' : rawNameEn;
      if(rawNameKo && isKorean(rawNameKo)) nameKo = rawNameKo;
    } else if(rawLast && !rawNameEn && !rawNameEnFirst){
      const built = buildEnName('', rawMiddle, rawLast);
      nameEn = isKorean(built) ? '' : built;
      if(rawNameKo && isKorean(rawNameKo)) nameKo = rawNameKo;
    } else if(rawNameKo){
      if(isKorean(rawNameKo)){
        nameKo = rawNameKo;
      } else {
        nameEn = rawNameKo;
      }
    }
    if(nameEn && isKorean(nameEn)) nameEn = '';

    const name = nameKo || nameEn;

    const { orgKo: org, orgEn: orgEnVal } = (() => {
      const rawOrgKo = colMap.orgKo ? String(r[colMap.orgKo]||'').trim() : '';
      const rawOrgEn = (colMap.orgEn && colMap.orgEn !== colMap.orgKo)
        ? String(r[colMap.orgEn]||'').trim() : '';

      let orgKo = '', orgEn = '';
      if(rawOrgKo){
        if(isKorean(rawOrgKo)) orgKo = rawOrgKo;
        else orgEn = rawOrgKo;
      }
      if(rawOrgEn){
        if(isKorean(rawOrgEn)) { if(!orgKo) orgKo = rawOrgEn; }
        else if(!orgEn) orgEn = rawOrgEn;
      }
      return { orgKo, orgEn };
    })();

    const email1Val = colMap.email1 ? String(r[colMap.email1]||'').trim().toLowerCase() : '';
    const nkTrim = nameKo.trim(), neTrim = nameEn.trim();
    /* 메일이 같아도 이름이 다르면 같은 사람으로 치지 않는다 — info@·비서실 같은 공용 주소를
       여럿이 쓰면 두 번째 사람이 «중복»으로 빠지고 그 사람의 행사가 첫 사람에게 붙었다.
       한쪽에 이름이 없으면 메일만으로 같은 사람으로 본다 */
    const sameName = (c) => {
      const ck = String(c.nameKo || '').trim(), ce = String(c.nameEn || '').trim().toLowerCase();
      if(!(ck || ce) || !(nkTrim || neTrim)) return true;
      return !!((ck && nkTrim && ck === nkTrim) || (ce && neTrim && ce === neTrim.toLowerCase()));
    };
    const mailHit = email1Val ? emailMap[email1Val] : null;
    const existByEmail = mailHit && sameName(mailHit) ? mailHit : null;
    // 메일은 같은데 이름이 다른 기존 연락처 — «의심»으로 돌려 사람이 고르게 한다
    const mailOther = mailHit && !existByEmail && mailHit.id != null ? mailHit : null;

    const suspectByName = !existByEmail && !mailOther && (
      (nkTrim && nameMap[nkTrim] && nameMap[nkTrim].length > 0) ||
      (neTrim && nameMap[neTrim] && nameMap[neTrim].length > 0)
    );
    const suspectMatch = mailOther || (suspectByName
      ? (nameMap[nkTrim]||nameMap[neTrim]||[])[0]
      : null);

    const isDup = !!existByEmail;
    const isSuspect = !isDup && !!suspectMatch;
    if(isDup) dupCount++;
    /* 같은 파일 안에서 같은 이메일이 두 번 나오는 일도 있다(세션별 명단을 이어 붙인
       파일). 기존 연락처만 보면 둘 다 새 사람으로 들어가 한 사람이 둘이 된다.
       처음 나온 줄을 표에 올려 두면 뒤의 줄은 중복으로 잡히고, 저장 단계에서
       먼저 들어간 그 연락처에 행사만 붙는다. */
    if(!isDup && (nameKo || nameEn)){   // 이름 없는 줄은 연락처가 안 생기니 기준이 될 수 없다
      const email2Val = (colMap.email2 && colMap.email2 !== colMap.email1)
        ? String(r[colMap.email2]||'').trim().toLowerCase() : '';
      const self = { nameKo, nameEn, email1: email1Val };
      if(email1Val && !emailMap[email1Val]) emailMap[email1Val] = self;
      if(email2Val && !emailMap[email2Val]) emailMap[email2Val] = self;
    }
    const countryRaw = colMap.country ? String(r[colMap.country]||'').trim() : '';
    const countryCode = normalizeCountry(countryRaw);
    if(countryCode) countryDetectedCount++;

    let rowCat = 'attendee';
    if(colMap.cat){
      const rawCat = String(r[colMap.cat]||'').trim();
      rowCat = normalizeCat(rawCat) || defaultCat || detectedCatFromFilename || 'attendee';
    } else if(defaultCat && defaultCat !== ''){
      rowCat = defaultCat;
    } else if(detectedCatFromFilename){
      rowCat = detectedCatFromFilename;
    }

    return {
      id: genContactId(),
      nameKo,
      nameEn,
      orgKo: org,
      orgEn: orgEnVal,
      titleKo: (() => {
        const v = colMap.titleKo ? String(r[colMap.titleKo]||'').trim() : '';
        return v;
      })(),
      titleEn: (() => {
        if(!colMap.titleEn) return '';
        if(colMap.titleEn === colMap.titleKo) return '';
        const v = String(r[colMap.titleEn]||'').trim();
        return /[가-힣]/.test(v) ? '' : v;
      })(),
      prefix:  colMap.prefix  ? String(r[colMap.prefix] ||'').trim() : '',
      deptKo:  colMap.deptKo  ? String(r[colMap.deptKo] ||'').trim() : '',
      deptEn:  colMap.deptEn  ? String(r[colMap.deptEn] ||'').trim() : '',
      country: countryCode,
      // beat 필드 = 기업의 산업 분야(자유 텍스트, 예: Pharma/Biotech/Digital Health).
      // cat이 speaker/vip/attendee 3분류로 단순화되며 "기자" 카테고리가 사라져서,
      // 예전에 있던 기자 전용 취재분야 코드(BEATS) 정규화 분기는 더 이상 쓰이지 않는다.
      beat: colMap.beat ? normalizeSector(r[colMap.beat]) : '',
      products: colMap.products ? String(r[colMap.products]||'').trim() : '',
      // website/note는 연락처가 아니라 "기업" 속성 — runValidationStep()에서 기업 마스터(orgs)로 반영하고 contact 저장 시엔 제거한다.
      _companyWebsite: colMap.website ? String(r[colMap.website]||'').trim() : '',
      _companyNote: colMap.note ? String(r[colMap.note]||'').trim() : '',
      _companyIntro: colMap.intro ? String(r[colMap.intro]||'').trim() : '',
      // memo1~3은 연락처 자신의 자유 칸 — 기본 항목에 없는 열(회원번호, 이사회 여부 등)을 버리지 않고 여기 담는다.
      memo1: colMap.memo1 ? String(r[colMap.memo1]||'').trim() : '',
      memo2: colMap.memo2 ? String(r[colMap.memo2]||'').trim() : '',
      memo3: colMap.memo3 ? String(r[colMap.memo3]||'').trim() : '',
      email1: colMap.email1 ? String(r[colMap.email1]||'').trim() : '',
      email2: (colMap.email2 && colMap.email2 !== colMap.email1)
              ? String(r[colMap.email2]||'').trim() : '',
      phone1: colMap.phone1 ? String(r[colMap.phone1]||'').trim() : '',
      phone2: (colMap.phone2 && colMap.phone2 !== colMap.phone1)
              ? String(r[colMap.phone2]||'').trim() : '',
      cat: rowCat,
      lang: /[가-힣]/.test(name) ? 'KO' : 'EN',
      // 열에 적힌 출처가 있으면 그 값, 없으면 업로드 화면에 적은 한 값
      source: (colMap.source ? String(r[colMap.source]||'').trim() : '')
              || (document.getElementById('up-src')||{}).value || '직접 업로드',
      date: td(),
      status: 'new',
      _dup: isDup,
      _suspect: isSuspect,
      _suspectId: suspectMatch ? suspectMatch.id : null,
      _suspectName: suspectMatch ? (suspectMatch.nameKo||suspectMatch.nameEn||'') : '',
      _suspectOrg:  suspectMatch ? (suspectMatch.orgKo||suspectMatch.orgEn||'') : '',
      _suspectEmail:suspectMatch ? (suspectMatch.email1||'') : '',
    };
  });

  /* ── 담당자 이름이 없는 줄 ──
     지금까지는 이름이 없으면 줄째로 버렸다. 모아 둔 발주처 명단은 그 줄이
     절반 가까이 된다 — 기관과 부서와 대표번호는 있는데 담당자를 아직 못
     알아낸 상태다. 파이프라인에서 먼저 하는 일이 바로 그 담당자를 찾는
     것이라, 버리면 «앞으로 뚫어야 할 곳»의 목록이 통째로 사라진다.
     그래서 연락처는 만들지 않되 기업은 등록한다. */
  const orgOnly = result.filter(c => !c.nameKo && !c.nameEn && (c.orgKo || c.orgEn));
  _orgOnlyRows.splice(0, _orgOnlyRows.length,
    ...orgOnly.map(c => ({ name: (c.orgKo || c.orgEn).trim(), beat: c.beat || '', info: companyInfoOf(c) })));

  mappedContacts.splice(0, mappedContacts.length,
    ...result.filter(c => c.nameKo || c.nameEn));
  if(_orgOnlyRows.length){
    addAiLog('info', '담당자 이름이 없는 ' + _orgOnlyRows.length + '줄은 기업DB에만 등록해요 — 연락처는 안 만들어요.');
  }

  console.log('[upload-tab] 파싱 결과:', mappedContacts.length, '건, 샘플:', JSON.stringify(mappedContacts[0]||{}));
  const newCount = mappedContacts.filter(c => !c._dup).length;
  if(colMap.country) addAiLog('ok', '국가 정보 ' + countryDetectedCount + '건 인식 완료');
  if(colMap.beat) addAiLog('ok', '분야 컬럼 인식: ' + escapeHtml(colMap.beat));
  if(colMap.products) addAiLog('ok', '전시 품목 컬럼 인식: ' + escapeHtml(colMap.products));
  if(dupCount > 0) addAiLog('warn', '중복 감지: ' + dupCount + '건 (기존 DB와 이름+기업 일치 — 스킵 예정)');
  const suspectCount  = mappedContacts.filter(c => c._suspect).length;
  const sectorSel     = (document.getElementById('up-sector')||{}).value||'';
  addAiLog('ok', '파싱 완료: 신규 ' + newCount + '건 추가 준비, 중복(이메일) ' + dupCount + '건 스킵' +
    (suspectCount ? ', ⚠️ 의심 ' + suspectCount + '건 확인 필요' : '') +
    (sectorSel ? ' / 기업 카테고리: ' + escapeHtml(sectorSel) : ''));
  if(suspectCount > 0){
    addAiLog('warn', '⚠️ 이름이 같은 기존 연락처가 있어요. "DB에 추가" 전에 확인해주세요.');
  }
  if(dupCount > 0){
    addAiLog('info', '💡 연결 행사를 선택하면 중복 ' + dupCount + '건에도 행사가 추가됩니다');
  }

  // 유사 기업명 병합 제안 (간단 휴리스틱 — Samsung/삼성전자 등 알려진 패턴)
  checkMergeCandidate(mappedContacts);

  const upBtns = document.getElementById('up-btns');
  if(upBtns) upBtns.style.display = 'block';
  const addBtn = document.querySelector('#up-btns .bp');
  if(addBtn) addBtn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>DB에 추가 (' + newCount + '건)';

  // 카테고리 컬럼이 매핑돼 있으면 값별 매핑 UI 표시 (신규)
  renderCategoryMappingUI();
}

/* ═══════════════════════════════════════
   카테고리 컬럼 값별 매핑 (신규)
   엑셀에 카테고리 컬럼(beat로 매핑됨)이 있으면 고유값별로 섹터를 배정한다.
   매핑은 행사별로 settings 시트(catmap_<행사key>)에 저장되어
   같은 행사 재업로드 시 자동으로 preselect된다.
═══════════════════════════════════════ */

function getSelectedUploadEventKey(){
  const sel = document.getElementById('up-ev');
  const inp = document.getElementById('up-ev-text');
  if(uploadUi.evDirectMode && inp && inp.value.trim()) return inp.value.trim();
  if(sel && sel.value && sel.value !== '__direct__') return sel.value;
  return '';
}

/* mappedContacts의 beat 원문값 집계 ('|' 복수값은 개별 카운트) */
function beatValueCounts(){
  const counts = {};
  mappedContacts.forEach(c => {
    String(c.beat||'').split('|').map(v=>v.trim()).filter(Boolean)
      .forEach(v => { counts[v] = (counts[v]||0)+1; });
  });
  return counts;
}

export function renderCategoryMappingUI(){
  const wrap = document.getElementById('catmap-wrap');
  if(!wrap) return;
  if(!uploadUi.lastColMap || !uploadUi.lastColMap.beat){ wrap.innerHTML = ''; uploadUi.catmapOn = false; return; }

  const counts = beatValueCounts();
  const values = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  if(!values.length){ wrap.innerHTML = ''; uploadUi.catmapOn = false; return; }

  const evKey = getSelectedUploadEventKey();
  const saved = (evKey && CATMAPS[evKey]) || {};
  const hasSaved = values.some(([v]) => v in saved);
  // 이전 매핑이 저장된 행사면 자동으로 토글 on
  if(hasSaved) uploadUi.catmapOn = true;

  const sectorOptions = sel => COMPANY_SECTORS.map(s =>
    `<option value="${escapeHtml(s.name)}"${sel===s.name?' selected':''}>${s.parent?'　↳ ':''}${escapeHtml(s.name)}</option>`).join('');

  /* 원문값마다 표준 섹터를 미리 골라 둔다. 명단은 보내 준 쪽 표기 그대로라
     ('IT Soultion', 'Central Lab.') 사람이 값마다 손으로 고르게 하면 결국
     '원문 유지'로 넘어가고, 그렇게 흩어진 값이 지금 기업DB에 쌓여 있다.
     지난번에 저장해 둔 매핑이 있으면 그게 먼저다 — 사람이 내린 판단이 추천을
     이긴다. */
  const guessOf = {};
  values.forEach(([v]) => {
    if(v in saved) return;   // 사람이 정해 둔 값이 추천보다 우선
    const g = suggestSector(v);
    if(g.names.length) guessOf[v] = g;
  });
  const guessN = Object.keys(guessOf).length;

  wrap.innerHTML = `
    <div style="background:var(--i8);border:1px solid var(--i6);border-radius:var(--r);padding:10px 12px">
      <label style="display:flex;align-items:center;gap:6px;font-size:var(--fs-12);font-weight:700;cursor:pointer">
        <input type="checkbox" id="catmap-toggle" ${uploadUi.catmapOn?'checked':''} onchange="toggleCatmap(this.checked)">
        카테고리 컬럼 값별 매핑 (${values.length}개 값)
        ${hasSaved ? '<span style="font-size:var(--fs-10);color:var(--te);font-weight:600">이전 매핑 적용됨</span>' : ''}
      </label>
      <div style="font-size:var(--fs-10);color:var(--i4);margin:4px 0 0 20px">컬럼 "${escapeHtml(uploadUi.lastColMap.beat)}"의 값별로 섹터를 배정합니다. 켜면 위의 일괄 카테고리 대신 행별 매핑이 적용돼요.
        ${guessN ? `<b style="color:var(--te)">${guessN}개 값은 표준 섹터를 자동으로 골라 뒀어요 — 맞는지만 확인해주세요.</b>` : ''}
        판단이 안 서는 값은 <b>비워 둠</b>으로 두면 기업DB에서 '미분류'로 눈에 띕니다.</div>
      <div id="catmap-table" style="display:${uploadUi.catmapOn?'block':'none'};margin-top:8px;max-height:220px;overflow-y:auto">
        ${values.map(([val, cnt]) => `
          <div style="display:flex;align-items:center;gap:8px;padding:3px 0">
            <span style="flex:1;min-width:0;font-size:var(--fs-11);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(val)}">${escapeHtml(val)} <span style="color:var(--i4)">(${cnt}건)</span></span>
            <select class="fi catmap-sel" data-val="${escapeHtml(val)}" style="width:55%;font-size:var(--fs-11);padding:2px 4px">
              ${(() => {
                /* 고를 값은 셋 중 하나다 — 지난번에 사람이 정해 둔 것, 이번에 추천한 것,
                   아무것도 아니면 '비워 둠'. 'CRO|영상·이미징'처럼 둘로 갈리는 값은
                   섹터 목록에 없으니 그 줄을 따로 만들어 넣는다. */
                const g = guessOf[val];
                const gv = g ? g.names.join('|') : '';
                const picked = (val in saved) ? saved[val] : gv;
                const combo = (v, tail) => `<option value="${escapeHtml(v)}"${picked === v ? ' selected' : ''}
                    >${escapeHtml(v.split('|').join(' + '))}${tail}</option>`;
                return (gv ? combo(gv, ' ← 추천') : '')
                  + (picked && picked !== gv && picked.includes('|') ? combo(picked, ' (지난 매핑)') : '')
                  + `<option value="__blank__"${picked ? '' : ' selected'}>— 비워 둠 (나중에 고르기)</option>`
                  + `<option value="__keep__">원문 그대로 (비표준)</option>`
                  + (evKey ? `<option value="__new__">＋ 새 행사 섹터로 생성 (비표준)</option>` : '')
                  + sectorOptions(picked && !picked.includes('|') ? picked : '');
              })()}
            </select>
          </div>`).join('')}
      </div>
    </div>`;
  applyCatmapSideEffects();
}

export function toggleCatmap(on){
  uploadUi.catmapOn = !!on;
  const tbl = document.getElementById('catmap-table');
  if(tbl) tbl.style.display = uploadUi.catmapOn ? 'block' : 'none';
  applyCatmapSideEffects();
}

function applyCatmapSideEffects(){
  const upSector = document.getElementById('up-sector');
  if(upSector) upSector.disabled = uploadUi.catmapOn; // 행별 매핑이 우선
}

/* 매핑 UI 상태 수집 — 토글 off이면 null (기존 일괄 방식 유지) */
export function collectCatMapFromUI(){
  if(!uploadUi.catmapOn) return null;
  const map = {}; const newVals = [];
  document.querySelectorAll('.catmap-sel').forEach(sel => {
    const val = sel.getAttribute('data-val');
    if(!val || sel.value === '__keep__') return;
    if(sel.value === '__new__'){ newVals.push(val); return; }
    /* 비워 둠 — 원문을 흘려보내지 않는다. 목록에 없는 값이 데이터에 들어가면
       그때부터 아무도 다시 안 본다(지금 기업DB의 'IT Soultion'이 그렇게 왔다). */
    map[val] = sel.value === '__blank__' ? '' : sel.value;
  });
  return { map, newVals };
}

/* «업로드 STEP 4 — 의심 케이스 확인과 마스터DB 반영»은 ../features/upload/upload-save.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* «업로드 › 수집 로그·기업 병합 관리 하위 탭»은 ../features/upload/upload-logs.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* «업로드 화면의 연결 행사 고르기»은 ../features/upload/upload-event-select.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* ══════════════════════════════════════════
   window 노출 — 원본 HTML의 onclick/onchange 인라인 핸들러가 참조하는 함수들.
   ES 모듈 함수는 전역에 자동 노출되지 않으므로 반드시 여기서 등록해야 한다.
══════════════════════════════════════════ */
window.onColumnMapChange      = onColumnMapChange;
window.aiFillColumns          = aiFillColumns;
window.coMatchFind            = coMatchFind;
window.coMatchApply           = coMatchApply;
window.coMatchSkip            = coMatchSkip;
window.toggleCatmap           = toggleCatmap;
