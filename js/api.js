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
  API_BASE_URL,
  authToken,
  setAuthToken,
  EVENT_LIST,
  contacts,
  participations,
  targets,
  EXHIBITORS,
  EXH_CONTACTS,
  EXH_ITEMS,
  EXH_INVOICES,
  EXH_PAYMENTS,
  EXH_LOGS,
  ORGS,
  EQUIP_CATALOG,
  CODE_LISTS, applyCodeLists,
  loadExhCfg,
  auditLog,
  COMPANY_SECTORS,
  DOMAINS,
  setDomains,
  TAGS,
  setTags,
  CATMAPS,
  PART_TYPES,
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
      + 'background:#DC2626;color:#fff;padding:10px 18px;border-radius:8px;'
      + 'font-size:13px;font-weight:600;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.25);'
      + 'max-width:90vw;text-align:center';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

export async function postToSheet(payload, label, { silent = false } = {}){
  if(!API_BASE_URL || !currentUser) return { ok: true, offline: true };
  try {
    const headers = { 'Content-Type': 'application/json', ...await authHeaders() };
    const res  = await fetch(API_BASE_URL + '/api/data', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    let json = null;
    try { json = JSON.parse(await res.text()); } catch(e){}
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
   2) loadFromSheets — 구글시트에서 전체 데이터 로드 (원본 5364~5603행)
   여러 시트(contacts/participations/events/companies/sectors/part_types/
   crm_targets/activity_log)를 불러와 state.js의 배열/객체를 채운다.

   ※ 원본의 중첩 구조(설명은 아래 주석 참고)를 그대로 보존했다 — 원본에서
   sectors/companies/part_types/events 처리가 전부 `if(conData...)` 블록
   안쪽에 있었으므로(즉 contacts 시트가 비어있으면 나머지도 갱신되지
   않는 기존 동작), 동일하게 유지한다. 이는 버그처럼 보일 수 있으나
   "로직은 바꾸지 않는다" 원칙에 따라 그대로 옮겼다.

   ※ UI 갱신 호출(buildMDBEvList/renderMDB/buildCoDB/renderCoList/renderAudit
   등)은 각 tab 모듈(db-tab.js/company-tab.js/audit-tab.js/settings-tab.js)이
   정의할 함수들이라 api.js가 직접 import할 수 없다(순환 참조 방지 —
   api.js는 통신 레이어로만 남고 화면 렌더링을 알지 못해야 함).
   대신 loadFromSheets(hooks)가 선택적 콜백 묶음을 인자로 받아
   `hooks.함수명?.()` 형태로 안전하게 호출한다. app.js가 각 tab 모듈에서
   실제 함수를 import해 아래처럼 넘겨준다:
     loadFromSheets({ buildMDBEvList, renderMDB, buildEvFil, updBadges,
       populateUploadEvDropdown, buildCoDB, buildCoCAT, buildAuditUserList,
       renderCoList, renderAudit })
══════════════════════════════════════════ */
export async function loadFromSheets(hooks = {}){
  // 백엔드 API는 유일한 데이터 소스 — 미연동 시 빈 화면 유지
  if(!API_BASE_URL || !currentUser){
    setSheetsConnected(false);
    showSheetsWarning(true);
    try { hooks.buildMDBEvList?.(); hooks.renderMDB?.(); } catch(e){}
    return;
  }
  showSheetsWarning(false); // 시도 시작 시 일단 숨김
  const base = API_BASE_URL + '/api/data?sheet=';
  const headers = await authHeaders(); // 9개 요청이 같은 토큰을 쓰도록 한 번만 계산

  try {
    const [conData, partsData, targetsData, logsData, eventsData, settingsData, sectorsData, partTypesData,
           orgsData,
           exhData, exhConData, exhItemData, exhInvData, exhPayData, exhLogData, equipCatData,
           codeListData] = await Promise.all([
      safeFetch(base + 'contacts',       'contacts',       1, headers),
      safeFetch(base + 'participations', 'participations', 1, headers),
      safeFetch(base + 'crm_targets',    'crm_targets',    1, headers),
      safeFetch(base + 'activity_log',   'activity_log',   1, headers),
      safeFetch(base + 'events',         'events',         1, headers),
      safeFetch(base + 'settings',       'settings',       1, headers),
      safeFetch(base + 'sectors',        'sectors',        1, headers),
      safeFetch(base + 'part_types',     'part_types',     1, headers),
      safeFetch(base + 'orgs',           'orgs',           1, headers),
      safeFetch(base + 'exhibitors',         'exhibitors',         1, headers),
      safeFetch(base + 'exhibitor_contacts', 'exhibitor_contacts', 1, headers),
      safeFetch(base + 'exhibitor_items',    'exhibitor_items',    1, headers),
      safeFetch(base + 'exhibitor_invoices', 'exhibitor_invoices', 1, headers),
      safeFetch(base + 'exhibitor_payments', 'exhibitor_payments', 1, headers),
      safeFetch(base + 'exhibitor_logs',     'exhibitor_logs',     1, headers),
      safeFetch(base + 'equip_catalog',      'equip_catalog',      1, headers),
      safeFetch(base + 'code_lists',         'code_lists',         1, headers),
    ]);

    // ── 실패 감지 (신규) ──
    // safeFetch는 실패 시 예외 대신 null을 반환하므로, 여기서 null 개수를
    // 세지 않으면 "전 시트 로드 실패"도 성공으로 표시되는 버그가 있었다.
    const _results = [conData, partsData, targetsData, logsData, eventsData, settingsData, sectorsData, partTypesData,
      orgsData,
      exhData, exhConData, exhItemData, exhInvData, exhPayData, exhLogData, equipCatData,
      codeListData];
    const _failed  = _results.filter(r => r === null).length;
    if(_failed === _results.length){
      // 전부 실패 — 연결 안 됨으로 처리하고 기존(stale) 화면 유지
      console.warn('[CRM] 모든 시트 로드 실패 — 연결 실패 처리');
      setSheetsConnected(false);
      showSheetsWarning(true);
      try { hooks.buildMDBEvList?.(); hooks.renderMDB?.(); } catch(e){}
      return;
    }
    setSheetsConnected(true);
    showSheetsWarning(_failed > 0); // 일부 실패 시 경고 배너 유지
    // 마지막 동기화 시각 업데이트 (전체 성공 시에만 — 부분 실패를 최신 동기화로 오인하지 않도록)
    if(_failed === 0){
      const syncEl = document.getElementById('last-sync-time');
      if(syncEl){
        const now = new Date();
        syncEl.textContent = now.toLocaleDateString('ko-KR',{month:'2-digit',day:'2-digit'})
          + ' ' + now.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
      }
    }

    // contacts 업데이트 (최신 필드 구조 반영) — 시트가 비어있으면 화면도 빈 상태 유지
    if(conData && Array.isArray(conData)){
      contacts.splice(0, contacts.length, ...conData.map(r=>{
        const cleanNEn = /[가-힣]/.test(String(r.nameEn||'')) ? '' : String(r.nameEn||'').trim();
        const cleanCat = normalizeCat(String(r.cat||'').trim()) || 'attendee';
        // date 정제: JS Date 문자열 → YYYY-MM-DD
        const cleanDate = (() => {
          const d = String(r.date||'').trim();
          if(/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
          const parsed = new Date(d);
          if(!isNaN(parsed)) return parsed.toISOString().slice(0,10);
          return d;
        })();
        // phone 정제
        const cleanPhone = (v) => {
          const s = String(v||'').trim();
          if(!s) return '';
          // 순수 음수 숫자(-9162 등) = 수식 결과 → 빈값
          if(/^-\d+$/.test(s)) return '';
          return s;
        };
        const p1 = cleanPhone(r.phone1);
        const p2 = cleanPhone(r.phone2);
        return {
          id:+r.id,
          nameKo: r.nameKo||r.name||'',
          nameEn: cleanNEn,
          orgKo:  r.orgKo||r.org||'',
          orgEn:  r.orgEn||'',
          titleKo:r.titleKo||'', titleEn:r.titleEn||'',
          deptKo: r.deptKo||'',  deptEn: r.deptEn||'',
          country:countryName(r.country||''), cat:cleanCat, lang:r.lang||'',
          source: r.source||'',  date:cleanDate, status:r.status||'new',
          email1: r.email1||'',  email2: r.email2||'',
          phone1: p1,
          phone2: (p2 && p2 !== p1) ? p2 : '', // phone1과 같으면 비움
          beat:   r.beat||'',    products:r.products||'',
          tags:   r.tags||'',
        };
      }));
      console.log('[CRM] contacts loaded & cleaned:', contacts.length);

    // ── settings 시트 → DOMAINS (분야 목록, key='domains' JSON) ──
    if(settingsData && Array.isArray(settingsData)){
      const domRow = settingsData.find(row => row.key === 'domains');
      if(domRow){
        try {
          const parsed = JSON.parse(domRow.value);
          if(Array.isArray(parsed)){
            setDomains(parsed.filter(d => d && d.id));
            console.log('[CRM] domains 로드:', DOMAINS.length, '개 분야');
          }
        } catch(e){ console.warn('[CRM] domains JSON 파싱 실패 — 전부 미분류로 표시:', e); }
      }

      // ── settings 시트 → TAGS (연락처 영구 태그 목록, key='tags' JSON) ──
      const tagsRow = settingsData.find(row => row.key === 'tags');
      if(tagsRow){
        try {
          const parsed = JSON.parse(tagsRow.value);
          if(Array.isArray(parsed) && parsed.length){
            setTags(parsed.filter(t => t && t.key));
            console.log('[CRM] tags 로드:', TAGS.length, '개 태그');
          }
        } catch(e){ console.warn('[CRM] tags JSON 파싱 실패 — 기본값(BD/C-level) 유지:', e); }
      } else if(API_BASE_URL && currentUser){
        // 시트에 아직 없으면 기본값(BD/C-level)을 1회 저장(마이그레이션)
        saveTags();
      }

      // ── settings 시트 → 행사별 전시 설정 (마감일·프로그램북 한도) ──
      loadExhCfg(settingsData);

      // ── settings 시트 → CATMAPS (업로드 카테고리 값별 매핑, key='catmap_<행사key>') ──
      for(const k in CATMAPS) delete CATMAPS[k];
      settingsData.forEach(row => {
        if(!String(row.key||'').startsWith('catmap_')) return;
        const evKey = String(row.key).slice('catmap_'.length);
        try {
          const parsed = JSON.parse(row.value);
          if(parsed && typeof parsed === 'object') CATMAPS[evKey] = parsed;
        } catch(e){ console.warn('[CRM] catmap 파싱 실패:', row.key, e); }
      });
      const catmapCount = Object.keys(CATMAPS).length;
      if(catmapCount) console.log('[CRM] 카테고리 매핑 로드:', catmapCount, '개 행사');
    }

    // ── sectors 시트 → COMPANY_SECTORS (스프레드시트에서 직접 행 추가/삭제 가능) ──
    if(sectorsData && Array.isArray(sectorsData) && sectorsData.length){
      COMPANY_SECTORS.splice(0, COMPANY_SECTORS.length, ...sectorsData.map(r => ({
        id: r.id || '', name: r.name || '', parent: r.parent || null,
        domain: r.domain || '', canonical: r.canonical || '',
      })).filter(s => s.id && s.name));
      console.log('[CRM] sectors 시트 로드:', COMPANY_SECTORS.length, '개');
    } else if(settingsData && Array.isArray(settingsData)){
      // 구버전 호환: settings 시트의 JSON blob에서 마이그레이션 (1회) → sectors 시트로 옮겨 저장
      settingsData.forEach(row => {
        if(row.key === 'sectors'){
          try {
            const parsed = JSON.parse(row.value);
            if(Array.isArray(parsed) && parsed.length){
              const converted = typeof parsed[0] === 'string'
                ? parsed.map(name => ({
                    id: name.toLowerCase().replace(/[^a-z0-9가-힣]/g,'_').slice(0,20),
                    name, parent: null,
                  }))
                : parsed;
              COMPANY_SECTORS.splice(0, COMPANY_SECTORS.length, ...converted);
              console.log('[CRM] settings→sectors 마이그레이션:', COMPANY_SECTORS.length, '개');
              migrateSectorsToSheet();
            }
          } catch(e){}
        }
      });
    }

    // companies 테이블은 더 이상 읽지 않는다 — orgs가 그 자리를 대신한다.
    // (테이블 자체는 마이그레이션 이전 값이 남아 있어 그대로 둔다)

    // ── code_lists → CODE_LISTS (화면에서 고르는 짧은 목록들) ──
    if(codeListData && Array.isArray(codeListData)){
      CODE_LISTS.splice(0, CODE_LISTS.length, ...codeListData);
      applyCodeLists();
      console.log('[CRM] code_lists 로드:', CODE_LISTS.length, '개');
    }

    // ── equip_catalog → EQUIP_CATALOG (행사별 렌탈 비품 품목표) ──
    if(equipCatData && Array.isArray(equipCatData)){
      EQUIP_CATALOG.splice(0, EQUIP_CATALOG.length, ...equipCatData);
      console.log('[CRM] equip_catalog 로드:', EQUIP_CATALOG.length, '개');
    }

    // ── orgs → ORGS (기업 마스터) ──
    // 기업 화면(CO_DB)이 이걸 바탕으로 만들어지므로 companies보다 먼저 채운다.
    if(orgsData && Array.isArray(orgsData)){
      ORGS.splice(0, ORGS.length, ...orgsData);
      console.log('[CRM] orgs 로드:', ORGS.length, '개');
    }

    // ── part_types 시트 → PART_TYPES (행사 참가 유형, 설정에서 추가/삭제 가능) ──
    if(partTypesData && Array.isArray(partTypesData) && partTypesData.length){
      PART_TYPES.splice(0, PART_TYPES.length, ...partTypesData
        .filter(r => r.key)
        .map(r => ({ key: r.key, label: r.label || r.key, cls: r.cls || 'p-gray' })));
      console.log('[CRM] part_types 시트 로드:', PART_TYPES.length, '개');
    } else if(API_BASE_URL && currentUser){
      // 시트가 비어있으면 기본값을 1회 저장 (마이그레이션)
      migratePartTypesToSheet();
    }

    // ── events 시트 → EVENT_LIST 업데이트 ──
    if(eventsData && Array.isArray(eventsData) && eventsData.length > 0){
      EVENT_LIST.splice(0, EVENT_LIST.length, ...eventsData.map(r => ({
        key:        r.id         || '',
        name:       r.name       || r.id || '',
        short:      r.short      || r.name || r.id || '',
        color:      r.color      || '#9C9890',
        date:       r.date_start || r.date || '',  // 하위 호환
        date_start: r.date_start || r.date || '',
        date_end:   r.date_end   || '',
        location:   r.location   || '',
      })).filter(e => e.key));
      console.log('[CRM] events loaded:', EVENT_LIST.length, '건');
    }
      hooks.buildCoDB?.();
    }

    // participations 업데이트 — 필드명 정규화 적용(핵심 개선사항)
    if(partsData && Array.isArray(partsData)){
      participations.splice(0, participations.length, ...partsData.map(normalizeParticipationRow));
      console.log('participations loaded:', participations.length);
    }

    // targets 업데이트
    if(targetsData && Array.isArray(targetsData)){
      targets.splice(0, targets.length, ...targetsData.map(r=>{
        // log 컬럼: 컨택 기록 JSON (없거나 파싱 실패 시 빈 배열 — 구버전 행 호환)
        let logArr = [];
        try {
          const parsed = JSON.parse(r.log || '[]');
          if(Array.isArray(parsed)) logArr = parsed;
        } catch(e){}
        return {
          id:+r.id, name:r.name, nameEn:r.nameEn||'',
          sector:r.sector||'', hq:r.hq||'',
          event:r.event||'', role:r.role||'스폰서',
          status:r.status||'미접촉', priority:r.priority||'mid',
          assignee:r.assignee||'', currentStage:+r.currentStage||1,
          lastActivity:r.lastActivity||'',
          branches:[r.name], mainBranch:r.name,
          contacts:[], eventHistory:[], log:logArr,
        };
      }));
      console.log('targets loaded:', targets.length);
    }

    /* ── 전시 참가기업 진행관리 ──
       서버 컬럼명(snake_case)을 그대로 쓰므로 변환 없이 통째로 담는다.
       주의: contacts 블록 안쪽(위)이 아니라 바깥에 둔다 — 안쪽에 두면
       연락처가 0건일 때 전시 데이터까지 갱신이 안 되는 기존 함정에 빠진다. */
    if(exhData && Array.isArray(exhData)){
      EXHIBITORS.splice(0, EXHIBITORS.length, ...exhData);
      console.log('[CRM] exhibitors 로드:', EXHIBITORS.length, '개');
    }
    if(exhConData  && Array.isArray(exhConData))  EXH_CONTACTS.splice(0, EXH_CONTACTS.length, ...exhConData);
    if(exhItemData && Array.isArray(exhItemData)) EXH_ITEMS.splice(0, EXH_ITEMS.length, ...exhItemData);
    if(exhInvData  && Array.isArray(exhInvData))  EXH_INVOICES.splice(0, EXH_INVOICES.length, ...exhInvData);
    if(exhPayData  && Array.isArray(exhPayData))  EXH_PAYMENTS.splice(0, EXH_PAYMENTS.length, ...exhPayData);
    if(exhLogData  && Array.isArray(exhLogData)){
      EXH_LOGS.splice(0, EXH_LOGS.length, ...exhLogData);
      const open = EXH_LOGS.filter(l => l.kind === 'inquiry' && !l.answered_at).length;
      if(open) console.log('[CRM] 미답변 문의:', open, '건');
    }

    // activity_log 업데이트
    if(logsData && Array.isArray(logsData)){
      // 구버전 행 복구: 예전 saveAuditToSheets가 6개 값을 한 칸씩 밀린 순서
      // [id←ts, ts←name, email←email, name←action, type←target, action←detail]
      // 로 저장했었다. id 자리에 ISO 시각이 들어있으면 구버전 행으로 보고 되돌린다.
      const ACTION_TYPE = {
        '로그인':'login', '로그아웃':'login',
        '상태 변경':'status', '행사 참여 추가':'status',
        '컨택 기록 추가':'log',
        '타겟 추가':'add', '연락처 추가':'add',
        '단계 변경':'stage',
        '연락처 정보 수정':'edit', '행사 추가':'edit', '행사 삭제':'edit',
        '파일 업로드':'upload',
      };
      const remoteLog = logsData.map(r=>{
        const legacy = /^\d{4}-\d{2}-\d{2}T/.test(String(r.id||'')) && !r.detail && !r.target;
        const row = legacy
          ? { ts: r.id, email: r.email, name: r.ts, type: '', action: r.name, target: r.type, detail: r.action }
          : r;
        return {
          id: row.id || (Date.now() + Math.random()),
          ts: row.ts || new Date().toISOString(),
          email: row.email||'', name: row.name||'',
          color: userColor(row.email||''),
          type: row.type || ACTION_TYPE[row.action] || 'login',
          action: row.action||'', target: row.target||'',
          detail: row.detail||'',
        };
      });
      auditLog.splice(0, auditLog.length, ...remoteLog);
    }

    // UI 갱신 (각 tab 모듈이 넘겨준 hooks를 통해 호출 — 없으면 조용히 건너뜀)
    try { hooks.buildMDBEvList?.(); hooks.renderMDB?.(); } catch(e){}
    try { hooks.buildEvFil?.(); hooks.updBadges?.(); }     catch(e){}
    try { hooks.populateUploadEvDropdown?.(); }            catch(e){}
    try { hooks.buildCoDB?.(); hooks.buildCoCAT?.(); }     catch(e){}
    try { hooks.buildAuditUserList?.(); }  catch(e){}
    try { hooks.renderCoList?.(); }        catch(e){}
    if(curApp==='audit') hooks.renderAudit?.();

    console.log('Sheets data loaded successfully');
  } catch(err){
    console.warn('loadFromSheets error — 구글시트 연결 실패:', err);
    setSheetsConnected(false);
    showSheetsWarning(true);
    try { hooks.buildMDBEvList?.(); hooks.renderMDB?.(); } catch(e){}
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
    ],
  }, '활동 로그', { silent: true }); // 로그 저장 실패는 업무 흐름을 막지 않음(콘솔에만 기록)
}

// 행사 저장/삭제 (원본 6540~6571행)
export async function saveEventToSheet(ev){
  const r = await postToSheet({
    sheet:  'events',
    action: 'upsert',
    row: [ev.key, ev.name, ev.short, ev.date_start||ev.date||'', ev.date_end||'', ev.location||'', ev.color],
  }, '행사 저장');
  if(r.ok) console.log('[CRM] event saved:', ev.key);
  return r;
}

export async function deleteEventFromSheet(key){
  const r = await postToSheet({ sheet: 'events', action: 'delete', row: [key] }, '행사 삭제');
  if(r.ok) console.log('[CRM] event deleted:', key);
  return r;
}

// 섹터 저장/삭제/마이그레이션 (원본 4139~4174행, 6307~6333행)
export async function upsertSectorRow(sector){
  const r = await postToSheet({
    sheet:  'sectors',
    action: 'upsert',
    row:    sectorRowValues(sector),
  }, '섹터 저장');
  try { localStorage.setItem('crm_sectors', JSON.stringify(COMPANY_SECTORS)); } catch(e){}
  return r;
}

// 업로드 카테고리 값별 매핑 저장 — settings 시트 key='catmap_<행사key>' JSON
export async function saveCatmap(eventKey){
  if(!eventKey || !CATMAPS[eventKey]) return { ok: false, error: 'no catmap' };
  return postToSheet({
    sheet:  'settings',
    action: 'upsert',
    row:    ['catmap_' + eventKey, JSON.stringify(CATMAPS[eventKey])],
  }, '카테고리 매핑 저장');
}

// 분야(도메인) 목록 저장 — settings 시트 key='domains' JSON
export async function saveDomains(){
  const r = await postToSheet({
    sheet:  'settings',
    action: 'upsert',
    row:    ['domains', JSON.stringify(DOMAINS)],
  }, '분야 목록 저장');
  if(r.ok) console.log('[CRM] domains 저장 완료:', DOMAINS.length, '개');
  return r;
}

/* 행사별 전시 설정 저장 — settings 시트 key='exh_cfg_<행사키>' JSON.
   마감일·프로그램북 한도를 행사당 한 줄로 담는다. */
export async function saveExhCfgToSheet(evKey, cfg){
  const r = await postToSheet({
    sheet:  'settings',
    action: 'upsert',
    row:    ['exh_cfg_' + evKey, JSON.stringify(cfg || {})],
  }, '행사 설정 저장');
  if(r.ok) console.log('[CRM] 행사 설정 저장:', evKey);
  return r;
}

export async function saveTags(){
  const r = await postToSheet({
    sheet:  'settings',
    action: 'upsert',
    row:    ['tags', JSON.stringify(TAGS)],
  }, '태그 목록 저장');
  if(r.ok) console.log('[CRM] tags 저장 완료:', TAGS.length, '개');
  return r;
}

export async function deleteSectorRow(id){
  const r = await postToSheet({ sheet: 'sectors', action: 'delete', row: [id] }, '섹터 삭제');
  try { localStorage.setItem('crm_sectors', JSON.stringify(COMPANY_SECTORS)); } catch(e){}
  return r;
}

// 구버전 settings.sectors(JSON blob) → sectors 시트로 1회 마이그레이션
export async function migrateSectorsToSheet(){
  if(!API_BASE_URL || !currentUser) return;
  for(const s of COMPANY_SECTORS){
    await upsertSectorRow(s);
  }
  console.log('[CRM] sectors 시트 마이그레이션 완료:', COMPANY_SECTORS.length, '개');
}

export async function saveSectors(){
  // 구글시트 settings 시트에 저장
  const r = await postToSheet({
    sheet:  'settings',
    action: 'upsert',
    row:    ['sectors', JSON.stringify(COMPANY_SECTORS)],  // 객체 배열
  }, '섹터 목록 저장');
  if(r.ok) console.log('[CRM] sectors 저장 완료:', COMPANY_SECTORS.length, '개');
  // localStorage에도 백업
  try { localStorage.setItem('crm_sectors', JSON.stringify(COMPANY_SECTORS)); } catch(e){}
  return r;
}

export function loadSectors(){
  // loadFromSheets에서 이미 처리됨 — localStorage는 오프라인 백업용
  // (원본은 `COMPANY_SECTORS = parsed;` 로 재할당했으나, ES 모듈에서
  //  다른 모듈이 import한 배열 참조가 살아있도록 splice로 내용만 교체)
  try {
    if(!API_BASE_URL){
      const s = localStorage.getItem('crm_sectors');
      if(s){
        const parsed = JSON.parse(s);
        if(parsed.length) COMPANY_SECTORS.splice(0, COMPANY_SECTORS.length, ...parsed);
      }
    }
  } catch(e){}
}

// 참가 유형(PART_TYPES) 저장/삭제/마이그레이션 (원본 6353~6376행)
export async function upsertPartTypeRow(t){
  return postToSheet({ sheet: 'part_types', action: 'upsert', row: [t.key, t.label, t.cls] }, '참가 유형 저장');
}

export async function deletePartTypeRow(key){
  return postToSheet({ sheet: 'part_types', action: 'delete', row: [key] }, '참가 유형 삭제');
}

export async function migratePartTypesToSheet(){
  for(const t of PART_TYPES) await upsertPartTypeRow(t);
  console.log('[CRM] part_types 시트 마이그레이션 완료:', PART_TYPES.length, '개');
}

/* ══════════════════════════════════════════
   4) 전시 참가기업 진행관리 저장 (객체형)

   기존 시트들은 컬럼 순서에 맞춘 위치 배열(row)로 보내지만, exhibitors는
   컬럼이 35개라 순서가 어긋나는 사고가 나기 쉬워 객체(data)로 보낸다.
   서버는 이때 "넘어온 키만" 갱신하므로(부분 upsert), 체크 하나를 누를 때
   {id, manual_sent_at} 처럼 바뀐 필드만 보내면 나머지는 그대로 보존된다.
   신규 생성 시 서버가 id를 만들어 응답의 id로 돌려준다.
══════════════════════════════════════════ */
async function saveExhRow(sheet, obj, label){
  return postToSheet({ sheet, data: obj }, label);
}
async function deleteExhRow(sheet, id, label){
  return postToSheet({ sheet, action: 'delete', row: [id] }, label);
}

export const saveExhibitor       = (o) => saveExhRow('exhibitors',         o, '전시 참가기업 저장');
export const saveExhContact      = (o) => saveExhRow('exhibitor_contacts', o, '담당자 저장');
export const saveExhItem         = (o) => saveExhRow('exhibitor_items',    o, '금액 항목 저장');
export const saveExhInvoice      = (o) => saveExhRow('exhibitor_invoices', o, '인보이스 저장');
export const saveExhPayment      = (o) => saveExhRow('exhibitor_payments', o, '입금 내역 저장');
export const saveExhLog          = (o) => saveExhRow('exhibitor_logs',     o, '문의/기록 저장');
export const saveEquipCatalog    = (o) => saveExhRow('equip_catalog',      o, '품목 저장');
export const deleteEquipCatalog  = (id) => deleteExhRow('equip_catalog',   id, '품목 삭제');

export const deleteExhibitor     = (id) => deleteExhRow('exhibitors',         id, '전시 참가기업 삭제');
export const deleteExhContact    = (id) => deleteExhRow('exhibitor_contacts', id, '담당자 삭제');
export const deleteExhItem       = (id) => deleteExhRow('exhibitor_items',    id, '금액 항목 삭제');
export const deleteExhInvoice    = (id) => deleteExhRow('exhibitor_invoices', id, '인보이스 삭제');
export const deleteExhPayment    = (id) => deleteExhRow('exhibitor_payments', id, '입금 내역 삭제');
export const deleteExhLog        = (id) => deleteExhRow('exhibitor_logs',     id, '문의/기록 삭제');

/* 참가기업 일괄 등록 — 기업DB에서 전시참가기업을 뽑아 한 번에 만든다. */
export async function batchCreateExhibitors(rows){
  return postToSheet({ sheet: 'exhibitors', action: 'batchUpsert', dataRows: rows }, '참가기업 일괄 등록');
}
