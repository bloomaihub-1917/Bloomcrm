/* ══════════════════════════════════════════════════════════════
   api.js — Node/Express 백엔드(backend-node/) 통신 레이어
   (Google Apps Script + Sheets에서 마이그레이션 — 프로토콜 모양은 그대로,
   구현만 Postgres로 교체됐다. backend-node/routes/data.js 참고)

   패턴
   - GET  : `${API_BASE_URL}/api/data?sheet=xxx`  + Authorization 헤더 (읽기)
   - POST : `${API_BASE_URL}/api/data` JSON body { sheet, action, row|rows }
            + Authorization: Bearer <Firebase ID token> 헤더            (쓰기)
     action: append | upsert | batchAppend | batchUpsert | replaceAll | delete

   이 파일의 책임
   1) safeFetch — 재시도 포함 GET 래퍼 (원본 loadFromSheets 내부 지역함수를 이동)
   2) loadFromSheets — 전체 시트 로드 → state.js의 배열/객체를 채움
   3) normalizeParticipationRow — participations 시트의 컬럼 혼용
      (ev_id/행사명, cid, type/role 등)을 항상 같은 필드로 정규화
      (핵심 개선사항 — 기존 여기저기 흩어진 r.ev_id||r.ev, r.type||r.role
      같은 임시방편 fallback을 이 지점 하나로 모음)
   4) saveEventToSheet / saveSectors / upsertPartTypeRow 등 원본에서
      API_BASE_URL로 쓰기 요청을 보내던 "공통" 성격의 함수들

   범위 밖(포함하지 않음): saveCoNotes/saveCoWebsite/saveContactEdit/
   addTarget/submitAddCoEvent 등 특정 탭 UI에 강하게 결합된 쓰기 함수는
   각 tab 모듈(company-tab.js/crm-tab.js/db-tab.js 등)에서 이 파일의
   safeFetch/postToSheet를 가져다 쓰는 방식으로 이동할 것.
═══════════════════════════════════════════════════════════════ */

import { normalizeCat, countryName, sectorRowValues } from './utils.js';
import { auth } from './firebase.js';
import {
  API_BASE_URL, MAIL_LIBRARY,
  authToken,
  setAuthToken,
  EVENT_LIST,
  CONF_SESSIONS, SPEAKERS, SESSION_SPEAKERS, SPEAKER_CONTACTS, SPEAKER_LOGS,
  contacts,
  participations,
  targets,
  CONTACT_ROUNDS, ROUND_MEMBERS, CONTACT_ATTEMPTS,
  EXHIBITORS,
  EXH_CONTACTS,
  EXH_ITEMS,
  EXH_INVOICES,
  EXH_TAX,
  EXH_PAYMENTS,
  EXH_LOGS,
  EXH_APPS,
  ORGS,
  EQUIP_CATALOG,
  WATCH_FOLDERS, WATCH_FILES,
  CODE_LISTS, applyCodeLists,
  loadExhCfg,
  EXH_CFG,
  auditLog,
  COMPANY_SECTORS,
  DOMAINS,
  setDomains,
  TAGS,
  setTags,
  CATMAPS,
  PART_TYPES, syncPartColors,
  currentUser,
  curApp,
  sheetsConnected,
  setSheetsConnected,
  userColor,
} from './state.js';

/* ══════════════════════════════════════════
   0) participations 필드명 정규화 (신규 — 이번 재구축의 핵심 개선사항)

   code.gs의 participations 시트 컬럼: id, ev_id, 행사명, cid, 소속, 성명, 직함, type, note, matched
   (시트 컬럼명/순서는 절대 바꾸지 않음 — 정규화는 프론트로 들어오는
   이 지점에서만 수행)

   정규화 후 항상 아래 필드로 접근한다:
     { id, eventId, event, contactId, contact, role, note, matched }
   - eventId   : 행사 key. 원본의 r.ev_id||r.ev 조합을 그대로 계승
   - event     : 행사 표시명(행사명 컬럼). 비어있으면 eventId로 대체
                 (실무 데이터에서 행사명/소속/성명/직함 컬럼은 항상
                 빈 문자열로 저장되고 있어 — code.gs onEdit 트리거 및
                 프론트 append 로직 확인 결과 — eventId/EVENT_LIST 조인으로
                 표시명을 구하는 게 실제 동작이지만, 시트에 값이 채워지는
                 경우까지 대비해 우선순위를 둠)
   - contactId : contacts.id 와 매칭되는 숫자 id (원본 +r.cid)
   - contact   : 성명 스냅샷(원본 미사용이라 대개 빈 문자열)
   - role      : 원본의 r.type||r.role 조합을 그대로 계승
   - matched   : 재저장(round-trip) 시 필요해서 유지 (원본 removeParticipation/
                 confirmAddEv 등에서 part.matched를 그대로 다시 씀)

   ⚠ 다른 모듈로 옮겨지는 기존 코드가 p.cid / p.ev / p.ev_id / p.type / p.role
   를 참조하던 자리는 p.contactId / p.eventId / p.event / p.role 로
   바꿔써야 한다 (동작은 동일, 필드명만 통일).
══════════════════════════════════════════ */
export function normalizeParticipationRow(r){
  const eventId = r.ev_id || r.ev || '';
  return {
    id:        r.id || '',
    eventId,
    event:     r['행사명'] || eventId,
    contactId: r.cid ? +r.cid : null,
    contact:   r['성명'] || '',
    role:      r.type || r.role || '',
    note:      r.note || '',
    matched:   r.matched || '',
    /* 비어 있으면 타겟(부를 후보), 날짜가 있으면 그날 참가가 확정됐다는 뜻 */
    confirmedAt: r.confirmed_at || '',
  };
}

/* ══════════════════════════════════════════
   1) safeFetch — GET 재시도 래퍼 (원본 5380~5398행, loadFromSheets 내부 지역함수를 이동)
   Apps Script 콘텐츠 서빙이 동시 요청 시 가끔 일시적으로 404/HTML을
   반환하는 경우가 있어, 실패 시 짧게 대기 후 최대 2번 재시도한다.
══════════════════════════════════════════ */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Firebase ID 토큰을 매번 새로 받아온다 — SDK가 만료 임박(1시간) 시 자동
   갱신, 아니면 캐시된 값을 즉시 반환하므로 매 요청마다 불러도 비용이 없다.
   state.js의 authToken은 UI 표시/디버깅용 캐시일 뿐 신뢰 주체가 아니다. */
export async function authHeaders(){
  if(!auth.currentUser) return {};
  const token = await auth.currentUser.getIdToken();
  setAuthToken(token);
  return { Authorization: 'Bearer ' + token };
}

export async function safeFetch(url, label, attempt = 1, headers = null){
  try {
    console.log('[CRM] fetching', label, attempt > 1 ? `(재시도 ${attempt-1})` : '', '...');
    const res  = await fetch(url, { method: 'GET', redirect: 'follow', credentials: 'omit', headers: headers || await authHeaders() });
    const text = await res.text();
    const json = JSON.parse(text);
    if(json && json.error){ console.error('[CRM]', label, 'error:', json.error); return null; }
    console.log('[CRM]', label, '->', Array.isArray(json) ? json.length+'건' : JSON.stringify(json).slice(0,60));
    return json;
  } catch(e) {
    if(attempt < 3){
      console.warn('[CRM]', label, '일시 실패, 재시도 예정:', e.message);
      await sleep(500 * attempt);
      return safeFetch(url, label, attempt + 1, headers);
    }
    console.warn('[CRM]', label, 'failed:', e.message);
    return null;
  }
}

/* showSheetsWarning — 연동 실패 배너 토글 (원본 5605~5608행, loadFromSheets 전용) */
export function showSheetsWarning(show){
  const el = document.getElementById('sheets-warn');
  if(el) el.style.display = show ? 'flex' : 'none';
}

/* ══════════════════════════════════════════
   1.5) postToSheet — 모든 쓰기 요청의 공통 래퍼 (신규)

   기존 문제: 쓰기 함수들이 fetch만 하고 응답 본문을 확인하지 않았다.
   Apps Script는 오류도 HTTP 200 + {error:...} JSON으로 반환하므로
   저장 실패가 조용히 삼켜져 "화면에는 있는데 시트에는 없는" 데이터
   불일치가 생겼다. 이 래퍼는:
   - 응답 JSON의 ok/error를 검사해 실패를 실패로 처리
   - 실패 시 사용자에게 토스트로 알림 (silent 옵션으로 억제 가능)
   - 반환값: 성공 시 서버 JSON({ok:true,...}), 실패 시 {ok:false, error}
   - 테스트 모드(API_BASE_URL 없음)에서는 {ok:true, offline:true} — 로컬 전용
     동작이 정상이므로 실패로 취급하지 않는다.
══════════════════════════════════════════ */
let _toastTimer = null;
export function showSaveErrorToast(msg){
  let el = document.getElementById('save-error-toast');
  if(!el){
    el = document.createElement('div');
    el.id = 'save-error-toast';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);'
      + 'background:var(--re);color:var(--on);padding:10px 18px;border-radius:var(--r);'
      + 'font-size:var(--fs-13);font-weight:600;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.25);'
      + 'max-width:90vw;text-align:center';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

let settingsReady = false;   // 로그인 때 settings 표를 읽었나 — loadFromSheets가 정한다
export function setSettingsReady(v){ settingsReady = v; }   // 불러오기(api/load.js)가 정한다
export async function postToSheet(payload, label, { silent = false } = {}){
  if(!API_BASE_URL) return { ok: true, offline: true };   // 테스트 모드
  /* 로그인이 풀렸으면 저장을 «성공»으로 돌려주지 않는다 — 전에는 다른 탭에서 로그아웃하면
     이 탭의 저장이 성공처럼 보이고 서버에는 아무것도 안 갔다 */
  if(!currentUser){ showSaveErrorToast(`저장 안 됨 (${label || '저장'}) — 로그인이 풀렸어요. 새로고침해서 다시 로그인하세요.`); return { ok: false, error: 'logged out' }; }
  /* 설정 묶음(JSON 한 줄)은 화면의 사본을 통째로 올린다. 로그인 때 못 읽었으면 사본이 비어 있어
     서버의 양식 보관함·행사 설정을 지운다 — 새로고침해 읽은 뒤에만 저장한다 */
  if(payload && payload.sheet === 'settings' && !settingsReady){
    showSaveErrorToast(`저장 안 됨 (${label || '설정'}) — 처음 불러올 때 설정을 못 읽었어요. 새로고침한 뒤 다시 해 주세요.`);
    return { ok: false, error: 'settings not loaded' };
  }
  try {
    const headers = { 'Content-Type': 'application/json', ...await authHeaders() };
    const res  = await fetch(API_BASE_URL + '/api/data', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    let json = null;
    try { json = JSON.parse(await res.text()); } catch(e){}
    /* 덮어쓰기를 막아 거절된 것은 «고장»이 아니다. 여기서 빨간 토스트를 띄우면
       «저장 실패 — 네트워크를 확인하세요»가 뜨는데, 네트워크는 멀쩡하고 남이
       고쳤을 뿐이다. 부르는 쪽이 무엇과 부딪혔는지 보여줄 수 있게 그대로 넘긴다. */
    if(json && json.conflict) return json;
    if(!res.ok || !json || json.error || json.ok === false){
      const errMsg = (json && (json.error || json.action)) || ('HTTP ' + res.status);
      console.error('[CRM] 저장 실패:', label, errMsg);
      if(!silent) showSaveErrorToast(`저장 실패 (${label}): ${errMsg} — 새로고침 전 다시 시도하세요`);
      return { ok: false, error: errMsg };
    }
    return json;
  } catch(e){
    const errMsg = String(e && e.message || e);
    console.error('[CRM] 저장 실패(네트워크):', label, errMsg);
    if(!silent) showSaveErrorToast(`저장 실패 (${label}): 네트워크 오류 — 새로고침 전 다시 시도하세요`);
    return { ok: false, error: errMsg };
  }
}

/* ══════════════════════════════════════════
   3) 쓰기 요청 함수들 (원본 곳곳 — 아래 각 함수 주석에 원본 행 번호 표기)
══════════════════════════════════════════ */

// 활동 로그 저장 (원본 5343~5359행)
// ⚠ 수정: 기존에는 6개 값을 시트 헤더(id,ts,email,name,type,action,target,detail
// — 8컬럼)와 다른 순서로 append해서 모든 로그가 한 칸씩 밀려 저장되는
// 버그가 있었다. 시트 헤더 순서에 정확히 맞춘다.
export async function saveAuditToSheets(entry){
  await postToSheet({
    sheet: 'activity_log',
    row: [
      String(entry.id || Date.now()),
      entry.ts, entry.email, entry.name,
      entry.type || '', entry.action, entry.target,
      String(entry.detail || '').replace(/<[^>]+>/g, ''),
      /* 이 기록이 가리키는 곳 — 없으면 빈 칸. 새로 고친 뒤에도 로그에서
         그 창으로 갈 수 있으려면 화면 메모리에만 두면 안 된다. */
      entry.extra ? JSON.stringify(entry.extra) : '',
    ],
  }, '활동 로그', { silent: true }); // 로그 저장 실패는 업무 흐름을 막지 않음(콘솔에만 기록)
}

// 행사 저장/삭제 (원본 6540~6571행)
export async function saveEventToSheet(ev){
  const r = await postToSheet({
    sheet:  'events',
    action: 'upsert',
    // 위치 배열이라 data.js의 events.columns와 순서가 정확히 같아야 한다
    row: [ev.key, ev.name, ev.short, ev.date_start||ev.date||'', ev.date_end||'', ev.location||'', ev.color,
      ev.host||'', ev.organizer||'', ev.our_role||'', ev.theme||'',
      ev.scale||'', ev.homepage||'', ev.summary||'', ev.outcome||'', ev.domain||'', ev.name_en||'', ev.dom_tax_rate||''],
  }, '행사 저장');
  if(r.ok) console.log('[CRM] event saved:', ev.key);
  return r;
}


/* 서버와 주고받는 나머지는 기능별로 js/api/ 아래에 있다 — 쓰는 곳은 그 파일을 바로 import한다.
   이 파일은 그 모두가 쓰는 바탕(주소·인증 머리·safeFetch·postToSheet·참가 기록 이름 맞추기)만 둔다.
   load.js           로그인 때 전체 데이터 불러오기(loadFromSheets)
   conf-save.js      컨퍼런스 세션·연사·연락 상대·기록 저장
   exh-save.js       전시 참가기업 진행관리 저장
   settings-save.js  행사·섹터·분야·태그·참가 유형·전시 설정·메일 문구 저장
   mail-send.js      메일 보내기·행사 메일 계정·메일함 동기화·기본 첨부
   share-register.js 바깥 공유·등록 링크
   photos.js         연사 사진
   ai.js             Claude에게 묻는 일 */
