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
  COMPANY_INFO,
  EVENT_LIST,
  COMPANY_SECTORS,
  PART_TYPES,
  GS_URL,
  currentUser,
} from '../state.js';
import { CL } from '../constants.js';
import { normalizeCat, normalizeCountry, escapeHtml } from '../utils.js';
import { postToSheet } from '../api.js';
import { buildCoDB, buildCoCAT, batchUpsertCompanies } from './company-tab.js';
import { renderMDB, buildMDBEvList } from './db-tab.js';
import { trackAction } from './audit-tab.js';

/* switchApp만 router.js 소관이라 window 경유로 호출한다(router.js가 모든
   tab 모듈을 최상위에서 조립하는 진입점이라 여기서 역참조하면 순환이
   꼬이므로) — router.js가 `window.switchApp = switchApp`로 등록해 둔다. */
function callHook(name, ...args){
  const fn = window[name];
  if(typeof fn === 'function') return fn(...args);
  console.warn('[upload-tab] "' + name + '"를 찾을 수 없어요 — 관련 모듈이 아직 로드되지 않았을 수 있어요.');
  return undefined;
}

/* ── up 탭 사이드바 하위탭 상태(upload/log/merge) — state.js 밖의 화면 전용 값 ── */
let upV = 'upload';

/* ── 업로드 폼의 "연결 행사" 직접입력 모드 여부 (원본 6604행) ── */
let _evDirectMode = false;

/* ── 충돌 없는 신규 id 생성기 (신규) ──
   기존 `Date.now() + random(100000)` 방식은 대량 업로드 시 전 행이 같은
   밀리초를 공유해 충돌 공간이 10만뿐이라, 수백 행 업로드에서 id 충돌로
   연락처가 조용히 누락되는 버그가 있었다. ms 타임스탬프 × 1000 + 단조
   증가 카운터로 세션 내 충돌을 원천 차단한다 (최대값 ≈ 1.7e15로
   Number.MAX_SAFE_INTEGER 이내 — 기존 숫자 id 체계와 호환). */
let _lastGenId = 0;
function genContactId(){
  const base = Date.now() * 1000;
  _lastGenId = base > _lastGenId ? base : _lastGenId + 1;
  return _lastGenId;
}

/* ═══════════════════════════════════════
   AI 로그 한 줄 추가 (애니메이션 없이 즉시) (원본 2838행)
   state.js의 aiLogs 배열에도 함께 기록해 DOM 밖에서도 진행 이력을 조회할 수 있게 함.
═══════════════════════════════════════ */
const AI_LOG_ICONS = {
  ok:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;color:#6EFF6E"><polyline points="20 6 9 17 4 12"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;color:#FFD166"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px;color:#74C0FC"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
};
function addAiLog(type, msg){
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

/* ═══════════════════════════════════════
   STEP 1 — 업로드: 파일 읽기 + 파일명 카테고리 추정 (원본 2243~2320행)
═══════════════════════════════════════ */

/* 파일명 → 카테고리 자동 추정용 힌트 (원본 2350~2359행) */
const FILENAME_CATEGORY_HINTS = {
  speaker: ['연사','강연자','발표자','speaker','speakers','presenter'],
  // cat은 speaker/vip/attendee 3분류만 쓰므로, 스폰서/투자자/바이어/BD/전시/기자
  // 관련 파일명 힌트는 전부 attendee(일반참가자)로 모은다(각 힌트 키워드 자체는
  // 그대로 유지 — 파일명 인식 정확도는 그대로, 결과 카테고리만 단순화됨).
  attendee: [
    '스폰서','후원','협찬','sponsor','sponsors','sponsorship',
    '투자자','투자','vc','investor','investors','funding',
    '바이어','구매','buyer','buyers','procurement',
    'bd','사업개발','파트너십','partnership','partner',
    '전시','부스','exhibitor','exhibitors','booth',
    '기자','언론','미디어','취재','press','media','journalist','reporter',
  ],
};
// 카테고리 한글 라벨은 constants.js의 CL(참가 역할 라벨)과 값이 완전히 동일해
// 별도 상수(CAT_LABEL_KR)로 중복 정의하지 않고 CL을 그대로 가져다 쓴다.

function guessCategoryFromFilename(filename){
  const base = filename.replace(/\.[^.]+$/, '');
  const norm = base.toLowerCase().replace(/[\s_\-()[\]]/g, '');
  for(const cat in FILENAME_CATEGORY_HINTS){
    for(const hint of FILENAME_CATEGORY_HINTS[cat]){
      const h = hint.toLowerCase().replace(/[\s_\-]/g, '');
      if(norm.includes(h)) return cat;
    }
  }
  return null;
}

/* input[type=file] onchange (원본 2243행) */
export function handleFileSelect(e){
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  runUploadStep(file);
}

/* drop-zone ondrop (원본 2248행) */
export function handleFileDrop(e){
  e.preventDefault();
  e.currentTarget.style.borderColor = '';
  e.currentTarget.style.background = '';
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if(!file) return;
  const fi = document.getElementById('file-input');
  if(fi){
    const dt = new DataTransfer();
    dt.items.add(file);
    fi.files = dt.files;
  }
  runUploadStep(file);
}

/* STEP 1 본체 (원본 startFileParsing, 2266~2320행) */
export function runUploadStep(file){
  setAiStep(1);
  setUploadedFileName(file.name);
  const dzName = document.getElementById('dz-filename');
  if(dzName) dzName.textContent = '📄 ' + file.name; // textContent라 이스케이프 불필요

  const log = document.getElementById('ai-log');
  if(log){ log.innerHTML = ''; log.style.display = 'block'; }
  aiLogs.length = 0;
  const upBtns = document.getElementById('up-btns');
  if(upBtns) upBtns.style.display = 'none';
  const mergeWrap = document.getElementById('merge-wrap');
  if(mergeWrap) mergeWrap.innerHTML = '';
  const prevEl = document.getElementById('parser-prev');
  if(prevEl) prevEl.innerHTML =
    '<tr><td colspan="4" style="padding:18px;text-align:center;color:var(--i4);font-size:11px">파일을 분석하고 있어요…</td></tr>';

  addAiLog('info', '1단계: 파일 업로드 — ' + escapeHtml(file.name) + ' 읽는 중 (' + (file.size/1024/1024).toFixed(2) + 'MB)…');

  // ── 파일명에서 카테고리 추정 (원본 2282~2290행) ──
  setDetectedCatFromFilename(guessCategoryFromFilename(file.name));
  if(detectedCatFromFilename){
    addAiLog('ok', '파일명에서 카테고리 감지: <b>' + escapeHtml(CL[detectedCatFromFilename] || detectedCatFromFilename) + '</b> ("' + escapeHtml(file.name) + '")');
    const catSel = document.getElementById('up-cat');
    if(catSel) catSel.value = detectedCatFromFilename;
  } else {
    addAiLog('info', '파일명에서 카테고리를 추정하지 못했어요 — 컬럼 데이터로 분류해요');
  }

  const ext = file.name.split('.').pop().toLowerCase();

  if(ext === 'csv'){
    const reader = new FileReader();
    reader.onload = (ev) => {
      try{
        const wb = XLSX.read(ev.target.result, { type:'string', cellText:true });
        runHeaderStep(wb);
      }catch(err){
        addAiLog('warn', 'CSV 파싱 오류: ' + escapeHtml(err.message));
        console.error('[upload-tab] CSV 파싱 오류:', err);
      }
    };
    reader.readAsText(file, 'utf-8');
  } else if(ext === 'xlsx' || ext === 'xls'){
    const reader = new FileReader();
    reader.onload = (ev) => {
      try{
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type:'array', cellText:true, cellDates:true });
        runHeaderStep(wb);
      }catch(err){
        addAiLog('warn', 'Excel 파싱 오류: ' + escapeHtml(err.message));
        console.error('[upload-tab] Excel 파싱 오류:', err);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    addAiLog('warn', '지원하지 않는 파일 형식이에요 (.xlsx, .xls, .csv만 가능)');
  }
}

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
  deptKo: ['부서','팀','부서(국문)','팀(국문)','department','dept'],
  deptEn: ['영문부서','영문팀','부서(영문)','팀(영문)','departmenten','department(en)'],
  country: ['국가','나라','country','nation'],
  email1:  ['이메일','이메일1','email','email1','e-mail','mail'],
  email2:  ['이메일2','보조이메일','email2','email address 2'],
  phone1: [
    '연락처','전화번호','연락처1','휴대폰','휴대폰번호','핸드폰','핸드폰번호','휴대전화',
    'phone','phone1','tel','hp',
  ],
  phone2: [
    '연락처2','전화번호2','휴대폰2','mobile','mobile number','cell','cellphone',
    'phone2','tel2','mobile phone','mobilephone',
  ],
  cat: ['카테고리','분류','구분','참가구분','등록구분','참가유형','category','type','role'],
  beat:     ['분야','업종','산업분야','섹터','취재분야','출입처','beat','sector','industry'],
  products: ['전시품목','품목','제품','출품작','products','exhibits','item'],
  website:  ['웹페이지','홈페이지','웹사이트','website','homepage','url'],
  note:     ['비고','메모','설명','참고사항','note','notes','remark','remarks'],
};

/* 컬럼명 자동 매핑 후보 탐색 (원본 2515~2539행) */
function guessColumn(headers, aliases, usedHeaders){
  const used = usedHeaders || new Set();
  const norm = h => h.toLowerCase().replace(/[\s_\-\/().·,]/g,'');

  // 1단계: 완전 일치
  for(const h of headers){
    if(used.has(h)) continue;
    const nh = norm(h);
    for(const a of aliases){
      if(nh === norm(a)) return h;
    }
  }
  // 2단계: alias가 헤더에 포함 (alias ⊂ 헤더) — 4자 이상만
  for(const h of headers){
    if(used.has(h)) continue;
    const nh = norm(h);
    for(const a of aliases){
      const na = norm(a);
      if(na.length >= 4 && nh.includes(na)) return h;
    }
  }
  return null;
}

/* ── 간단한 기업명 유사도 병합 제안 (원본 2808~2835행) ──
   업로드 파일에 알려진 다국어 표기 쌍(KNOWN_PAIRS)이 있고, 기존 DB에도 짝이
   이미 있으면 업로드 폼(#merge-wrap) 안에 병합 제안 카드를 보여준다.
   ※ "기업병합관리" 사이드 하위탭(switchUV('merge'))의 mergeProps 목록과는
     별개의 기능 — 이건 업로드 직후 즉석에서 보여주는 간단한 휴리스틱 제안이다. */
function checkMergeCandidate(rows){
  const KNOWN_PAIRS = [
    ['Samsung Electronics','삼성전자'], ['Hyundai Motor','현대자동차'],
    ['Google LLC','구글'], ['AWS','Amazon Web Services'],
  ];
  const mergeWrap = document.getElementById('merge-wrap');
  if(!mergeWrap) return;
  const orgsInFile = new Set(rows.map(r=>r.orgKo||r.org).filter(Boolean));
  for(const [a,b] of KNOWN_PAIRS){
    if(orgsInFile.has(a) || orgsInFile.has(b)){
      const existingOrgs = new Set(contacts.map(c=>c.orgKo||c.org||'').filter(Boolean));
      if((orgsInFile.has(a) && existingOrgs.has(b)) || (orgsInFile.has(b) && existingOrgs.has(a))){
        mergeWrap.innerHTML = `
          <div class="ma">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>
            <div>
              <div class="ma-t">"${a}" ↔ "${b}" 병합 제안</div>
              <div class="ma-s">동일 기업 다국어 표기로 감지. 병합 시 모든 이력이 통합됩니다.</div>
              <div class="ma-b">
                <button class="btn bp bs" onclick="this.closest('.ma').innerHTML='<div style=\\'font-size:11px;color:var(--g);padding:4px 0\\'>✓ 병합 승인됨 (다음 동기화 시 반영)</div>'">병합 승인</button>
                <button class="btn bs" onclick="this.closest('.ma').remove()">별도 유지</button>
              </div>
            </div>
          </div>`;
        return;
      }
    }
  }
}

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

  // ── 매핑 결과 상세 로그 ──
  const mappedKeys = Object.entries(colMap).filter(([,v])=>v).map(([k,v])=>v+'→'+k);
  addAiLog('ok', '3단계: 컬럼 매칭 완료 (' + mappedKeys.length + '개): ' + escapeHtml(mappedKeys.join(', ')));
  if(!colMap.nameKo && !colMap.nameEn){
    addAiLog('warn', '⚠️ 이름 컬럼을 찾지 못했어요. 파일 헤더: ' + escapeHtml(headers.join(', ')));
  }
  console.log('[upload-tab] colMap:', JSON.stringify(colMap));
  console.log('[upload-tab] 첫번째행 샘플:', JSON.stringify(rows[0]));

  // 재사용을 위해 보관 — 사용자가 드롭다운으로 매핑을 고치면 이 값들로 다시 계산한다
  _lastHeaders = headers;
  _lastRows = rows;

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
  nameEnFirst: '이름(영문·이름부분)', lastName: '이름(영문·성)',
  orgKo: '기업(한글)', orgEn: '기업(영문)',
  titleKo: '직함(한글)', titleEn: '직함(영문)',
  deptKo: '부서(한글)', deptEn: '부서(영문)',
  country: '국가', email1: '이메일1', email2: '이메일2',
  phone1: '연락처1', phone2: '연락처2',
  cat: '카테고리', beat: '분야(산업/업종)', products: '전시품목',
  website: '웹사이트', note: '메모',
};

function renderColumnMappingPreview(headers, rows, colMap){
  const sample = rows[0] || {};
  const prevEl = document.getElementById('parser-prev');
  if(!prevEl) return;

  if(!headers.length){
    prevEl.innerHTML = '<tr><td colspan="4" style="padding:18px;text-align:center;color:var(--re);font-size:11px">컬럼을 찾지 못했어요. 헤더명을 확인해주세요.</td></tr>';
    return;
  }

  const optionsHtml = (selectedKey) => Object.entries(DB_FIELD_LABELS)
    .map(([key,label]) => `<option value="${key}"${key===selectedKey?' selected':''}>${escapeHtml(label)}</option>`)
    .join('');

  // 데이터가 실제로 들어있는 컬럼인지 확인(헤더만 있고 전부 빈 값이면 매핑 안내 대상에서 제외)
  const hasData = (h) => rows.some(r => String(r[h] ?? '').trim() !== '');

  // 매핑되지 않았는데 데이터는 있는 컬럼 — 조용히 버리지 않고 사용자에게 결정을 묻는다
  const unmappedWithData = headers.filter(h => !Object.values(colMap).includes(h) && hasData(h));

  const warnRow = unmappedWithData.length
    ? `<tr><td colspan="4" style="padding:10px 12px;background:var(--ab);border-bottom:1px solid #FDE68A;font-size:11px;color:var(--am)">
        ⚠️ <b>${escapeHtml(unmappedWithData.join(', '))}</b> 컬럼에는 데이터가 있지만 아직 어느 DB 항목에 넣을지 정하지 않았어요.
        아래 표에서 노란색으로 표시된 행의 "DB 컬럼" 드롭다운으로 매핑해주세요 — 매핑하지 않으면 이 데이터는 저장되지 않고 그대로 버려집니다.
      </td></tr>`
    : '';

  const bodyRows = headers.map(h => {
    const matchedKey = Object.keys(colMap).find(k => colMap[k] === h) || '';
    const isAuto = !!matchedKey;
    const needsDecision = !isAuto && hasData(h);
    return `
      <tr${needsDecision ? ' style="background:var(--ab)"' : ''}>
        <td style="padding:7px 10px;border-bottom:1px solid var(--i7);font-family:monospace;font-size:11px;color:var(--i2)">${escapeHtml(h)}</td>
        <td style="padding:7px 10px;border-bottom:1px solid var(--i7)">
          <select class="fi cm-select" data-header="${escapeHtml(h)}" onchange="onColumnMapChange()" style="font-size:11px;padding:3px 6px;width:auto">
            ${optionsHtml(matchedKey)}
          </select>
        </td>
        <td style="padding:7px 10px;border-bottom:1px solid var(--i7);font-size:11px;color:var(--i3)">${escapeHtml(String(sample[h] ?? ''))}</td>
        <td style="padding:7px 10px;border-bottom:1px solid var(--i7);font-size:10px;color:${needsDecision?'var(--am)':'var(--i3)'}" class="cm-badge">${isAuto ? '자동 인식' : (needsDecision ? '⚠️ 매핑 필요' : '미매핑')}</td>
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
  if(!_lastHeaders || !_lastRows) return;
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
  renderColumnMappingPreview(_lastHeaders, _lastRows, newColMap);
  applyColumnMap(newColMap);
}

let _lastHeaders = null;
let _lastRows = null;

/* colMap을 실제로 적용해 mappedContacts(파싱 결과)를 계산하고,
   AI 로그/"DB에 추가" 버튼을 갱신한다. 최초 자동 매칭 시와, 사용자가
   드롭다운으로 매핑을 고쳤을 때 둘 다 이 함수를 통해 재계산된다. */
function applyColumnMap(colMap){
  const headers = _lastHeaders || [];
  const rows = _lastRows || [];

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
    const rawLast        = colMap.lastName     ? String(r[colMap.lastName]   ||'').trim() : '';

    const isKorean = (s) => /[가-힣]/.test(s);

    const buildEnName = (first, last) => {
      const f = (first||'').trim(), l = (last||'').trim();
      if(!f) return l;
      if(!l) return f;
      if(f.toLowerCase().includes(l.toLowerCase())) return f;
      if(l.toLowerCase().includes(f.toLowerCase())) return l;
      return f + ' ' + l;
    };

    let nameKo = '', nameEn = '';
    const sameCol = (colMap.nameKo && colMap.nameEn && colMap.nameKo === colMap.nameEn);

    if(rawNameEnFirst){
      nameEn = buildEnName(rawNameEnFirst, rawLast);
      if(rawNameKo && isKorean(rawNameKo)) nameKo = rawNameKo;
    } else if(rawNameEn && !sameCol){
      nameEn = isKorean(rawNameEn) ? '' : rawNameEn;
      if(rawNameKo && isKorean(rawNameKo)) nameKo = rawNameKo;
    } else if(rawLast && !rawNameEn && !rawNameEnFirst){
      nameEn = isKorean(rawLast) ? '' : rawLast;
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
    const existByEmail = email1Val ? emailMap[email1Val] : null;

    const nkTrim = nameKo.trim(), neTrim = nameEn.trim();
    const suspectByName = !existByEmail && (
      (nkTrim && nameMap[nkTrim] && nameMap[nkTrim].length > 0) ||
      (neTrim && nameMap[neTrim] && nameMap[neTrim].length > 0)
    );
    const suspectMatch = suspectByName
      ? (nameMap[nkTrim]||nameMap[neTrim]||[])[0]
      : null;

    const isDup = !!existByEmail;
    const isSuspect = !isDup && !!suspectMatch;
    if(isDup) dupCount++;
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
      deptKo:  colMap.deptKo  ? String(r[colMap.deptKo] ||'').trim() : '',
      deptEn:  colMap.deptEn  ? String(r[colMap.deptEn] ||'').trim() : '',
      country: countryCode,
      // beat 필드 = 기업의 산업 분야(자유 텍스트, 예: Pharma/Biotech/Digital Health).
      // cat이 speaker/vip/attendee 3분류로 단순화되며 "기자" 카테고리가 사라져서,
      // 예전에 있던 기자 전용 취재분야 코드(BEATS) 정규화 분기는 더 이상 쓰이지 않는다.
      beat: colMap.beat ? String(r[colMap.beat]||'').trim() : '',
      products: colMap.products ? String(r[colMap.products]||'').trim() : '',
      // website/note는 연락처가 아니라 "기업" 속성 — runValidationStep()에서 companies 시트로 반영하고 contact 저장 시엔 제거한다.
      _companyWebsite: colMap.website ? String(r[colMap.website]||'').trim() : '',
      _companyNote: colMap.note ? String(r[colMap.note]||'').trim() : '',
      email1: colMap.email1 ? String(r[colMap.email1]||'').trim() : '',
      email2: (colMap.email2 && colMap.email2 !== colMap.email1)
              ? String(r[colMap.email2]||'').trim() : '',
      phone1: colMap.phone1 ? String(r[colMap.phone1]||'').trim() : '',
      phone2: (colMap.phone2 && colMap.phone2 !== colMap.phone1)
              ? String(r[colMap.phone2]||'').trim() : '',
      cat: rowCat,
      lang: /[가-힣]/.test(name) ? 'KO' : 'EN',
      source: (document.getElementById('up-src')||{}).value || '직접 업로드',
      date: new Date().toISOString().slice(0,10),
      status: 'new',
      _dup: isDup,
      _suspect: isSuspect,
      _suspectId: suspectMatch ? suspectMatch.id : null,
      _suspectName: suspectMatch ? (suspectMatch.nameKo||suspectMatch.nameEn||'') : '',
      _suspectOrg:  suspectMatch ? (suspectMatch.orgKo||suspectMatch.orgEn||'') : '',
      _suspectEmail:suspectMatch ? (suspectMatch.email1||'') : '',
    };
  }).filter(c => c.nameKo || c.nameEn); // 이름 없는 빈 행 제외

  mappedContacts.splice(0, mappedContacts.length, ...result);

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
}

/* ═══════════════════════════════════════
   STEP 4 — 검증 및 저장: 의심 케이스 확인 → Master DB 반영 + 구글시트 저장
   (원본 confirmImport 2881행, showSuspectModal 2896행, decideSuspect 2945행, proceedImport 2980~3148행)
═══════════════════════════════════════ */

/* "DB에 추가" 버튼 onclick (원본 2881행) — 검증 단계 진입점 */
export async function confirmImport(){
  const newRows     = mappedContacts.filter(c => !c._dup && !c._suspect);
  const dupRows     = mappedContacts.filter(c => c._dup);
  const suspectRows = mappedContacts.filter(c => c._suspect);

  // ── 의심 케이스가 있으면 먼저 확인 ──
  if(suspectRows.length > 0){
    showSuspectModal(suspectRows);
    return; // 모달에서 사용자가 결정 후 decideSuspect()가 다시 confirmImport()를 호출
  }

  await runValidationStep(newRows, dupRows);
}

/* 의심 케이스 확인 모달 (원본 2896~2943행) — 사용자 데이터는 모두 escapeHtml 처리 */
function showSuspectModal(suspectRows){
  const rows = suspectRows.map((r, i) => `
    <div style="border:1px solid var(--i6);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--i8)">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <!-- 새 데이터 -->
        <div style="flex:1;min-width:0">
          <div style="font-size:10px;color:var(--am);font-weight:700;margin-bottom:4px">📥 업로드 데이터</div>
          <div style="font-size:13px;font-weight:600">${escapeHtml(r.nameKo||r.nameEn||'')}</div>
          <div style="font-size:11px;color:var(--i3)">${escapeHtml(r.orgKo||r.orgEn||'')}</div>
          <div style="font-size:11px;color:var(--i4)">${escapeHtml(r.email1)||'이메일 없음'}</div>
        </div>
        <div style="color:var(--i4);font-size:18px;padding-top:14px">≈</div>
        <!-- 기존 데이터 -->
        <div style="flex:1;min-width:0">
          <div style="font-size:10px;color:var(--a);font-weight:700;margin-bottom:4px">🗄 기존 DB</div>
          <div style="font-size:13px;font-weight:600">${escapeHtml(r._suspectName)}</div>
          <div style="font-size:11px;color:var(--i3)">${escapeHtml(r._suspectOrg)}</div>
          <div style="font-size:11px;color:var(--i4)">${escapeHtml(r._suspectEmail)||'이메일 없음'}</div>
        </div>
      </div>
      <!-- 판단 버튼 -->
      <div style="display:flex;gap:6px;margin-top:10px">
        <button class="btn" style="flex:1;font-size:11px;background:#FEF3C7;border-color:#F59E0B;color:#92400E"
          onclick="decideSuspect(${i}, 'same')">
          ✅ 동일 인물 — 기존에 행사만 추가
        </button>
        <button class="btn" style="flex:1;font-size:11px;background:#EEF2FF;border-color:#6366F1;color:#3730A3"
          onclick="decideSuspect(${i}, 'diff')">
          👤 다른 사람 — 신규 등록
        </button>
      </div>
    </div>`).join('');

  const html = `
    <div id="suspect-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px">
      <div style="background:var(--W);border-radius:14px;padding:24px;width:100%;max-width:560px;max-height:80vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.2)">
        <div style="font-size:15px;font-weight:700;color:var(--i1);margin-bottom:6px">⚠️ 동일 인물 여부 확인</div>
        <div style="font-size:12px;color:var(--i3);margin-bottom:16px">이름이 같은 기존 연락처가 있어요. 각각 판단해주세요.</div>
        <div id="suspect-list">${rows}</div>
        <div style="font-size:11px;color:var(--i4);text-align:center;margin-top:8px">모두 판단하면 자동으로 진행됩니다</div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  // 판단 결과 저장 (원본과 동일하게 window에 임시 보관)
  window._suspectDecisions = new Array(suspectRows.length).fill(null);
  window._suspectRows = suspectRows;
}

/* 의심 케이스 카드의 "동일 인물"/"다른 사람" 버튼 onclick (원본 2945~2978행) */
export function decideSuspect(idx, decision){
  window._suspectDecisions[idx] = decision;

  const cards = document.querySelectorAll('#suspect-list > div');
  if(cards[idx]){
    cards[idx].style.opacity = '0.5';
    cards[idx].style.pointerEvents = 'none';
    const label = decision === 'same' ? '✅ 동일 인물로 처리' : '👤 신규 등록으로 처리';
    const color = decision === 'same' ? '#92400E' : '#3730A3';
    cards[idx].insertAdjacentHTML('beforeend',
      `<div style="text-align:center;font-size:12px;font-weight:700;color:${color};margin-top:6px">${label}</div>`);
  }

  if(window._suspectDecisions.every(d => d !== null)){
    document.getElementById('suspect-modal')?.remove();
    window._suspectRows.forEach((r, i) => {
      const decision = window._suspectDecisions[i];
      if(decision === 'same'){
        r._dup = true;
        r._suspect = false;
      } else {
        r._dup = false;
        r._suspect = false;
      }
    });
    confirmImport();
  }
}

/* STEP 4 본체 — 화면 반영 + 구글시트 저장 (원본 proceedImport, 2980~3148행) */
export async function runValidationStep(newRows, dupRows){
  if(!newRows.length && !dupRows.length){
    alert('추가할 신규 데이터가 없어요 (전부 중복이거나 파일이 비어있어요)');
    return;
  }

  setAiStep(4);
  addAiLog('info', '4단계: 검증 및 저장 — Master DB에 반영 중…');

  const btn = document.querySelector('#up-btns .bp');
  if(btn){ btn.disabled = true; btn.textContent = '저장 중…'; }

  // ── 선택된 행사 정보 ──
  const _evInp = document.getElementById('up-ev-text');
  const _evSel = document.getElementById('up-ev');
  const selectedEv = (_evDirectMode && _evInp && _evInp.value.trim())
    ? _evInp.value.trim()
    : (_evSel && _evSel.value !== '__direct__' ? _evSel.value : '');
  const selectedRole   = (document.getElementById('up-ev-role') ||{}).value || '참가자';
  const selectedSector = (document.getElementById('up-sector')  ||{}).value || '';
  console.log('[upload-tab] 업로드 확정 — selectedEv:', JSON.stringify(selectedEv),
    '| _evDirectMode:', _evDirectMode, '| up-ev.value:', _evSel && _evSel.value,
    '| up-ev-text.value:', _evInp && _evInp.value);

  // 1) 화면(Master DB)에 즉시 반영 — 중복 id 방지
  const newParts = [];
  const companyUpdates = []; // 업로드된 website/note를 기업(companies) 단위로 반영할 목록
  const touchedCompanyKeys = new Set(); // 이번 업로드에 등장한 회사(원문 표기) — companies 시트에 최초 저장 대상 확인용
  const existingIds = new Set(contacts.map(c => c.id));
  const addedContacts = []; // 시트 저장 실패 시 롤백용
  newRows.forEach(r => {
    const { _dup, _suspect, _suspectId, _suspectName, _suspectOrg, _suspectEmail, _companyWebsite, _companyNote, ...clean } = r;
    if(existingIds.has(clean.id)){
      // 이제 genContactId()로 세션 내 충돌은 없지만, 만에 하나 걸리면 조용히 버리지 않고 알린다
      addAiLog('warn', 'id 충돌로 1건 스킵: ' + (clean.nameKo||clean.nameEn||clean.id));
      console.warn('[upload-tab] id 충돌 스킵:', clean.id, clean.nameKo||clean.nameEn);
      return;
    }
    existingIds.add(clean.id);
    addedContacts.push(clean);
    // 기업 카테고리(sector) 일괄 적용 → beat 필드에 저장
    if(selectedSector) clean.beat = selectedSector;
    contacts.push(clean);

    const coKey = (clean.orgKo || clean.orgEn || '').trim();
    if(coKey) touchedCompanyKeys.add(coKey);

    // 업로드 파일의 website/note는 연락처가 아니라 소속 기업 속성 → companies 시트로 반영
    if(_companyWebsite || _companyNote){
      if(coKey) companyUpdates.push({ key: coKey, website: _companyWebsite||'', notes: _companyNote||'' });
    }

    // 행사 선택 시 participations 자동 생성 (정규화된 필드 형태: eventId/event/contactId/contact/role)
    if(selectedEv){
      const part = {
        id:        'P-' + genContactId(),
        eventId:   selectedEv,
        event:     selectedEv,
        contactId: clean.id,
        contact:   clean.nameKo || clean.nameEn || '',
        role:      selectedRole,
        note:      '',
        matched:   '✅ 앱에서 추가',
      };
      participations.push(part);
      newParts.push(part);
    }
  });

  // ── 중복 contacts — 이메일 기준으로 기존 contact 찾아서 행사 추가 + 기업명 국문 보강 ──
  let evAddedCount = 0;
  const isKoreanText = s => /[가-힣]/.test(s||'');
  const orgUpgraded = []; // 영문 orgKo → 국문 orgKo로 승격되어 시트 재저장이 필요한 기존 연락처
  const emailAdded  = []; // 추가 이메일(email2)이 채워져 시트 재저장이 필요한 기존 연락처
  dupRows.forEach(r => {
    const email = (r.email1||'').toLowerCase();
    // 이메일이 일치하는 기존 연락처를 먼저 찾고, 못 찾으면(=업로드 이메일이 기존과 달라
    // "의심 케이스" 확인창에서 사용자가 "동일 인물"로 결정한 경우 포함) 이름+기업으로도 찾는다.
    // ※ 예전엔 이메일 값이 있으면 이름+기업 폴백을 아예 안 해서, "동일 인물"로 확인해도
    //    이메일이 다르면 기존 연락처를 못 찾아 행사 추가가 조용히 무시되는 버그가 있었다.
    const existing = (email && contacts.find(c => c.email1 && c.email1.toLowerCase() === email))
      || contacts.find(c =>
          (c.nameKo||c.name||'') === (r.nameKo||'') &&
          (c.orgKo||c.org||'')   === (r.orgKo||''));
    if(!existing) return;

    // 같은 사람인데 이메일이 다르면(=추가 이메일) — 기존 email2가 비어있을 때만 채워 넣는다
    const newEmail = (r.email1||'').trim();
    if(newEmail && existing.email1 && newEmail.toLowerCase() !== existing.email1.toLowerCase() && !existing.email2){
      existing.email2 = newEmail;
      emailAdded.push(existing);
    }

    // 기존 기업명이 영문뿐인데 새로 들어온 데이터에 국문 기업명이 있으면
    // 기존 영문명은 orgEn으로 옮기고 orgKo를 국문명으로 승격
    const newOrgKo = (r.orgKo||'').trim();
    if(newOrgKo && isKoreanText(newOrgKo) && existing.orgKo && !isKoreanText(existing.orgKo) && existing.orgKo !== newOrgKo){
      if(!existing.orgEn) existing.orgEn = existing.orgKo;
      existing.orgKo = newOrgKo;
      orgUpgraded.push(existing);
    }

    if(!selectedEv) return;
    if(participations.some(p => p.contactId === existing.id && p.eventId === selectedEv && p.role === selectedRole)) return;
    const part = {
      id:        'P-' + genContactId(),
      eventId:   selectedEv,
      event:     selectedEv,
      contactId: existing.id,
      contact:   existing.nameKo || existing.nameEn || '',
      role:      selectedRole,
      note:      '',
      matched:   '✅ 앱에서 추가',
    };
    participations.push(part);
    newParts.push(part);
    evAddedCount++;
  });

  try {
    buildCoDB(); buildCoCAT(); renderMDB(); buildMDBEvList();
  } catch(e){ console.warn('[upload-tab] 업로드 후 화면 갱신 실패:', e); }

  // ── companies 시트 저장 대상 모으기 ──
  // (원본의 버그: 업로드 파일에 website/note 컬럼이 있는 회사만 저장되고,
  // 그 외 새 회사는 화면(기업DB 탭)에는 보이지만 구글시트에는 저장되지 않고
  // 있었음 — 아래에서 시트에 아직 없는 회사도 함께 저장 대상에 넣는다)
  // ⚠ 회사마다 개별 POST를 날리면 업로드 한 번에 수백 개 동시 요청이 나가서
  // Apps Script가 과부하로 일부 요청을 실패시키고 브라우저에는 CORS 에러로
  // 나타난다 — 그래서 개별 upsertCompanyRow 대신 batchUpsertCompanies로
  // 한 번의 요청에 모아서 보낸다.
  const companiesToSave = new Map(); // key → co 객체 (중복 방지)

  touchedCompanyKeys.forEach(rawKey => {
    const co = CO_DB.find(x => x.key === rawKey || x.branches?.includes(rawKey) || x.nameKo === rawKey || x.nameEn === rawKey);
    if(!co) return;
    const hasExistingRow = COMPANY_INFO[co.key] || (co.branches||[]).some(b => COMPANY_INFO[b]);
    if(hasExistingRow) return; // 이미 시트에 있음 — website/note 갱신은 아래 companyUpdates에서 처리
    companiesToSave.set(co.key, co);
  });

  // 업로드 파일에 담겨있던 웹사이트/메모를 소속 기업(companies 시트)에 반영
  companyUpdates.forEach(u => {
    const co = CO_DB.find(x => x.key === u.key || x.branches?.includes(u.key) || x.nameKo === u.key || x.nameEn === u.key);
    if(!co) return;
    if(u.website && !co.website) co.website = u.website;
    if(u.notes && !co.notes) co.notes = u.notes;
    companiesToSave.set(co.key, co);
  });

  if(companiesToSave.size){
    const newCount = companiesToSave.size;
    batchUpsertCompanies([...companiesToSave.values()])
      .catch(e => console.warn('companies 일괄 저장 실패:', e));
    addAiLog('ok', '기업 ' + newCount + '개를 companies 시트에 저장했어요.');
  }

  console.log('[upload-tab] 업로드 확정 — newParts.length:', newParts.length, '| GS_URL:', !!GS_URL, '| currentUser:', !!currentUser);

  // 2) 구글시트에 저장 (Apps Script 연동) — 여러 행을 batchAppend로 한 번에 저장해 왕복 횟수를 줄임
  // ⚠ 수정: 기존에는 응답을 확인하지 않아 저장 실패도 "저장됨"으로 표시되고,
  // 새로고침 시 업로드 내용이 통째로 사라지는 버그가 있었다. 이제 contacts
  // 저장 실패 시 화면 반영을 롤백하고 업로드 화면을 유지해 재시도할 수 있다.
  let partsSaveFailed = false;
  if(GS_URL && currentUser){
    if(addedContacts.length){
      const contactRows = addedContacts.map(r => [r.id, r.nameKo, r.nameEn, r.orgKo, r.orgEn, r.titleKo, r.titleEn, r.deptKo, r.deptEn,
            r.country, r.cat, r.lang, r.source, r.date, r.status, r.email1, r.email2, r.phone1, r.phone2,
            r.beat||'', r.products||'']);
      const res = await postToSheet(
        { sheet: 'contacts', action: 'batchAppend', rows: contactRows }, '연락처 업로드');
      if(!res.ok){
        // 롤백: 방금 화면에 넣은 연락처/참여기록 제거, 업로드 상태는 유지해서 재시도 가능하게
        const addedIdSet = new Set(addedContacts.map(c => c.id));
        const newPartIdSet = new Set(newParts.map(p => p.id));
        for(let i = contacts.length - 1; i >= 0; i--){
          if(addedIdSet.has(contacts[i].id)) contacts.splice(i, 1);
        }
        for(let i = participations.length - 1; i >= 0; i--){
          if(newPartIdSet.has(participations[i].id)) participations.splice(i, 1);
        }
        try { buildCoDB(); buildCoCAT(); renderMDB(); buildMDBEvList(); } catch(e){}
        addAiLog('warn', '⚠️ 구글시트 저장 실패 — 반영을 취소했어요. 네트워크 확인 후 "DB에 추가"를 다시 눌러주세요.');
        alert('구글시트 저장에 실패해서 추가를 취소했어요.\n네트워크를 확인하고 "DB에 추가"를 다시 눌러주세요.');
        if(btn){ btn.disabled = false; btn.innerHTML = 'DB에 추가 (' + addedContacts.length + '건)'; }
        return;
      }
    }
    // 기업명 국문 승격 / 추가 이메일(email2) 보강된 기존 연락처 재저장
    // (개별 upsert — 대상이 적어 배치 불필요. 같은 연락처가 두 목록에 겹칠 수 있어 id로 중복 제거)
    const toResave = new Map();
    [...orgUpgraded, ...emailAdded].forEach(c => toResave.set(c.id, c));
    for(const c of toResave.values()){
      await postToSheet({
        sheet: 'contacts',
        action: 'upsert',
        row: [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
              c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2,
              c.beat||'', c.products||''],
      }, '연락처 정보 보강');
    }
    // participations 구글시트 저장 — batchAppend로 한 번에
    // (시트 컬럼 순서: id, ev_id, 행사명, cid, 소속, 성명, 직함, type, note, matched —
    //  원본과 동일하게 행사명/소속/성명/직함 칸은 빈 문자열로 저장)
    if(newParts.length){
      const partRows = newParts.map(p => [p.id, p.eventId, '', p.contactId, '', '', '', p.role, p.note||'', p.matched||'✅ 앱에서 추가']);
      const pRes = await postToSheet(
        { sheet: 'participations', action: 'batchAppend', rows: partRows }, '행사 참여 기록');
      if(!pRes.ok){
        partsSaveFailed = true;
        addAiLog('warn', '⚠️ 행사 참여 기록 저장 실패 — 연락처는 저장됐지만 행사 연결(' + newParts.length + '건)은 시트에 반영되지 않았어요.');
      }
    }
    const evMsg = selectedEv ? ` / 행사 "${selectedEv}" ${newParts.length}건 연결` : '';
    trackAction('upload', '파일 업로드', uploadedFileName,
      '<b>' + escapeHtml(uploadedFileName) + '</b> 업로드 — 신규 ' + addedContacts.length + '건 저장' + evMsg
      + (partsSaveFailed ? ' (⚠️ 행사 연결 저장 실패)' : ''));
  } else {
    const evMsg = selectedEv ? ` / 행사 "${selectedEv}" ${newParts.length}건 연결` : '';
    trackAction('upload', '파일 업로드', uploadedFileName,
      '<b>' + escapeHtml(uploadedFileName) + '</b> 업로드 — 신규 ' + addedContacts.length + '건 반영' + evMsg + ' (구글시트 미연동)');
  }

  if(btn){ btn.disabled = false; }
  addAiLog('ok', '검증/저장 완료: 신규 ' + addedContacts.length + '건 Master DB 반영' + (GS_URL?' (구글시트 저장 포함)':''));
  alert(addedContacts.length + '건이 Master DB에 추가되었어요' + (GS_URL?' (구글시트에도 저장됨)':'')
    + (partsSaveFailed ? '\n⚠️ 단, 행사 참여 기록 저장은 실패했어요 — 감사 로그를 확인해주세요.' : ''));
  resetUpload();
  callHook('switchApp', 'mdb', document.querySelector('.atab'));
}

/* 업로드 폼 초기화 — "다시 업로드" 버튼 onclick (원본 resetUpload, 2852~2878행) */
export function resetUpload(){
  _evDirectMode = false;
  const sel    = document.getElementById('up-ev');
  const inp    = document.getElementById('up-ev-text');
  const btn    = document.getElementById('up-ev-toggle');
  const secSel = document.getElementById('up-sector');
  if(sel){ sel.style.display='block'; sel.value=''; }
  if(inp){ inp.style.display='none'; inp.value=''; }
  if(btn) btn.textContent='직접 입력';
  if(secSel) secSel.value='';
  const dzName = document.getElementById('dz-filename');
  if(dzName) dzName.textContent = '파일을 드래그하거나 클릭해서 업로드';
  const fi = document.getElementById('file-input');
  if(fi) fi.value = '';
  setDetectedCatFromFilename(null);
  const catSel = document.getElementById('up-cat');
  if(catSel) catSel.value = '';  // 자동 분류로 초기화
  const log = document.getElementById('ai-log');
  if(log){ log.style.display = 'none'; log.innerHTML = ''; }
  const mergeWrap = document.getElementById('merge-wrap');
  if(mergeWrap) mergeWrap.innerHTML = '';
  const upBtns = document.getElementById('up-btns');
  if(upBtns) upBtns.style.display = 'none';
  const prevEl = document.getElementById('parser-prev');
  if(prevEl) prevEl.innerHTML =
    '<tr><td colspan="4" style="padding:18px;text-align:center;color:var(--i4);font-size:11px">파일을 업로드하면 컬럼 매핑이 표시됩니다</td></tr>';
  parsedRows.length = 0;
  mappedContacts.length = 0;
  parserPrev.length = 0;
  aiLogs.length = 0;
  setUploadedFileName('');
  setAiStep(0);
}

/* ═══════════════════════════════════════
   수집 로그 / 기업 병합 관리 하위탭 (원본 3150~3167행)
   up 탭 사이드바의 3개 하위탭(업로드/로그/병합) 전환 + 각 목록 렌더링.
   ※ uploadLogs/mergeProps는 원본에서도 실제로 채워 넣는 로직이 없는
     데모 스캐폴딩 배열이라(항상 빈 배열) 렌더 함수도 그 상태 그대로 옮김.
═══════════════════════════════════════ */
function renderLog(){
  const el = document.getElementById('log-body');
  if(!el) return;
  el.innerHTML = uploadLogs.map(l=>`
    <tr><td>${escapeHtml(l.date)}</td><td style="color:var(--i3)">${escapeHtml(l.source)}</td>
    <td style="font-family:monospace;font-size:11px;color:var(--pu)">${escapeHtml(l.file)}</td>
    <td><span class="pill p-blue">${escapeHtml(l.cat)}</span></td>
    <td style="color:var(--g);font-weight:600">+${l.added}</td><td style="color:var(--i3)">${l.dup}건</td>
    <td style="color:var(--am)">${l.merged}건</td><td style="color:var(--i3)">${escapeHtml(l.by)}</td></tr>`).join('');
}
function renderMerge(){
  const el = document.getElementById('merge-ls');
  if(!el) return;
  el.innerHTML = mergeProps.map(m=>`
    <div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--i7)">
      <div style="flex:1"><div style="font-size:12px;font-weight:600;color:var(--i1)">${escapeHtml(m.a)} <span style="color:var(--i4)">↔</span> ${escapeHtml(m.b)}</div><div style="font-size:10px;color:var(--i3);margin-top:2px">${escapeHtml(m.reason)}</div></div>
      ${m.status==='approved'?'<span class="pill p-green">승인됨</span>':`<button class="btn bp bs" onclick="approveMg('${m.id}',this)">병합 승인</button><button class="btn bs" style="margin-left:4px" onclick="rejectMg('${m.id}',this)">별도 유지</button>`}
    </div>`).join('');
}

/* "병합 승인"/"별도 유지" 버튼 onclick (원본 3165~3166행) */
export function approveMg(id, btn){
  const m = mergeProps.find(x=>x.id===id);
  if(m) m.status='approved';
  const row = btn.closest('div');
  row.querySelector('.btn+.btn')?.remove();
  btn.outerHTML = '<span class="pill p-green">승인됨</span>';
}
export function rejectMg(id, btn){
  btn.closest('div').querySelector('.btn')?.remove();
  btn.outerHTML = '<span class="pill p-gray">별도 유지</span>';
}

/* up 탭 사이드바 하위탭(업로드/로그/기업 병합 관리) 전환 (원본 switchUV, 2208~2216행) */
export function switchUV(v, btn){
  upV = v;
  ['upload','log','merge'].forEach(id=>{const el=document.getElementById('upv-'+id);if(el)el.style.display=id===v?'block':'none'});
  document.querySelectorAll('#sbp-up .nr').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  const tt={upload:'업로드 & AI 파서',log:'수집 로그',merge:'기업 병합 관리'};
  const sb={upload:'파일 업로드 후 자동 파싱',log:'업로드 이력 확인',merge:'동일 기업 통합 관리'};
  const ttlEl = document.getElementById('up-ttl');
  if(ttlEl) ttlEl.innerHTML=`${tt[v]} <span class="tb-s">${sb[v]}</span>`;
  if(v==='log') renderLog();
  if(v==='merge') renderMerge();
}

/* ═══════════════════════════════════════
   업로드 폼 드롭다운 채우기 (원본 populateUploadEvDropdown, 6577~6602행)
   api.js의 loadFromSheets(hooks)가 시트 데이터 로드 후 호출하는 훅 중 하나.
═══════════════════════════════════════ */

/* up-ev-role 등 참가 유형 선택 드롭다운 새로고침.
   원본 renderPartTypeList()(6378행)는 설정(settings) 탭의 참가 유형 관리
   UI(#parttype-list 렌더링 + 추가/삭제)까지 함께 처리했지만, 그 관리 UI는
   settings-tab.js 소관이라 이 모듈 범위 밖이다. up 탭이 실제로 필요로 하는
   부분(.parttype-select 드롭다운을 PART_TYPES 최신값으로 채우는 로직)만
   동일하게 유지해 up-ev-role이 원본과 똑같이 동작하도록 한다. */
function refreshUploadRoleOptions(){
  document.querySelectorAll('.parttype-select').forEach(sel => {
    const cur = sel.value;
    sel.innerHTML = PART_TYPES.map(t => `<option value="${escapeHtml(t.key)}"${t.key===cur?' selected':''}>${escapeHtml(t.label)}</option>`).join('');
  });
}

export function populateUploadEvDropdown(){
  refreshUploadRoleOptions();
  // sector 드롭다운 채우기
  const secSel = document.getElementById('up-sector');
  if(secSel){
    const cur = secSel.value;
    secSel.innerHTML = '<option value="">적용 안 함</option>' +
      COMPANY_SECTORS.map(s => {
        const name = typeof s==='string' ? s : s.name;
        const indent = (typeof s!=='string' && s.parent) ? '　↳ ' : '';
        return `<option value="${escapeHtml(name)}"${name===cur?' selected':''}>${indent}${escapeHtml(name)}</option>`;
      }).join('');
  }

  const sel = document.getElementById('up-ev');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">행사 연결 안 함</option>' +
    EVENT_LIST.map(e =>
      `<option value="${escapeHtml(e.key)}"${e.key===current?' selected':''}>${escapeHtml(e.short)} (${escapeHtml(e.date)})</option>`
    ).join('') +
    '<option value="__direct__">✏️ 직접 입력…</option>';

  // EVENT_LIST가 비어있으면 자동으로 직접입력 모드
  if(!EVENT_LIST.length) toggleEvInput(true);
}

/* "연결 행사" 드롭다운 ↔ 직접입력 토글 버튼 onclick (원본 toggleEvInput, 6604~6625행) */
export function toggleEvInput(forceOn){
  _evDirectMode = forceOn !== undefined ? forceOn : !_evDirectMode;
  const sel  = document.getElementById('up-ev');
  const inp  = document.getElementById('up-ev-text');
  const btn  = document.getElementById('up-ev-toggle');
  if(!sel || !inp) return;
  if(_evDirectMode){
    sel.style.display = 'none';
    inp.style.display = 'block';
    inp.focus();
    if(btn) btn.textContent = '목록에서 선택';
  } else {
    sel.style.display = 'block';
    inp.style.display = 'none';
    if(btn) btn.textContent = '직접 입력';
    // 드롭다운에서 "직접입력…" 선택하면 자동 전환
    sel.onchange = () => {
      if(sel.value === '__direct__') toggleEvInput(true);
    };
  }
}

/* ══════════════════════════════════════════
   window 노출 — 원본 HTML의 onclick/onchange 인라인 핸들러가 참조하는 함수들.
   ES 모듈 함수는 전역에 자동 노출되지 않으므로 반드시 여기서 등록해야 한다.
══════════════════════════════════════════ */
window.handleFileSelect       = handleFileSelect;
window.handleFileDrop         = handleFileDrop;
window.confirmImport          = confirmImport;
window.resetUpload            = resetUpload;
window.decideSuspect          = decideSuspect;
window.switchUV               = switchUV;
window.approveMg              = approveMg;
window.rejectMg               = rejectMg;
window.toggleEvInput          = toggleEvInput;
window.populateUploadEvDropdown = populateUploadEvDropdown;
window.onColumnMapChange      = onColumnMapChange;
