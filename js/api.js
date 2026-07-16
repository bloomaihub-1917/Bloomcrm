/* ══════════════════════════════════════════════════════════════
   api.js — Google Apps Script 백엔드 통신 레이어
   (원본 contact_crm.html 5342~6571행대에서 정리)

   패턴
   - GET  : `${GS_URL}?sheet=xxx&email=...`                (읽기)
   - POST : JSON body { sheet, email, action, row|rows }   (쓰기)
     action: append | upsert | batchAppend | batchUpsert | replaceAll | delete

   이 파일의 책임
   1) safeFetch — 재시도 포함 GET 래퍼 (원본 loadFromSheets 내부 지역함수를 이동)
   2) loadFromSheets — 전체 시트 로드 → state.js의 배열/객체를 채움
   3) normalizeParticipationRow — participations 시트의 컬럼 혼용
      (ev_id/행사명, cid, type/role 등)을 항상 같은 필드로 정규화
      (핵심 개선사항 — 기존 여기저기 흩어진 r.ev_id||r.ev, r.type||r.role
      같은 임시방편 fallback을 이 지점 하나로 모음)
   4) saveEventToSheet / saveSectors / upsertPartTypeRow 등 원본에서
      GS_URL로 쓰기 요청을 보내던 "공통" 성격의 함수들

   범위 밖(포함하지 않음): saveCoNotes/saveCoWebsite/saveContactEdit/
   addTarget/submitAddCoEvent 등 특정 탭 UI에 강하게 결합된 쓰기 함수는
   각 tab 모듈(company-tab.js/crm-tab.js/db-tab.js 등)에서 이 파일의
   safeFetch/GS_URL을 가져다 쓰는 방식으로 이동할 것.
═══════════════════════════════════════════════════════════════ */

import { normalizeCat, countryName } from './utils.js';
import {
  GS_URL,
  EVENT_LIST,
  contacts,
  participations,
  targets,
  auditLog,
  COMPANY_INFO,
  COMPANY_SECTORS,
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

export async function safeFetch(url, label, attempt = 1){
  try {
    console.log('[CRM] fetching', label, attempt > 1 ? `(재시도 ${attempt-1})` : '', '...');
    const res  = await fetch(url, { method: 'GET', redirect: 'follow', credentials: 'omit' });
    const text = await res.text();
    const json = JSON.parse(text);
    if(json && json.error){ console.error('[CRM]', label, 'error:', json.error); return null; }
    console.log('[CRM]', label, '->', Array.isArray(json) ? json.length+'건' : JSON.stringify(json).slice(0,60));
    return json;
  } catch(e) {
    if(attempt < 3){
      console.warn('[CRM]', label, '일시 실패, 재시도 예정:', e.message);
      await sleep(500 * attempt);
      return safeFetch(url, label, attempt + 1);
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
  // 구글시트는 유일한 데이터 소스 — 미연동 시 빈 화면 유지
  if(!GS_URL || !currentUser){
    setSheetsConnected(false);
    showSheetsWarning(true);
    try { hooks.buildMDBEvList?.(); hooks.renderMDB?.(); } catch(e){}
    return;
  }
  showSheetsWarning(false); // 시도 시작 시 일단 숨김
  const email = encodeURIComponent(currentUser.email);

  try {
    const [conData, partsData, targetsData, logsData, eventsData, settingsData, sectorsData, companiesData, partTypesData] = await Promise.all([
      safeFetch(GS_URL + '?sheet=contacts&email='       + email, 'contacts'),
      safeFetch(GS_URL + '?sheet=participations&email=' + email, 'participations'),
      safeFetch(GS_URL + '?sheet=crm_targets&email='    + email, 'crm_targets'),
      safeFetch(GS_URL + '?sheet=activity_log&email='   + email, 'activity_log'),
      safeFetch(GS_URL + '?sheet=events&email='         + email, 'events'),
      safeFetch(GS_URL + '?sheet=settings&email='       + email, 'settings'),
      safeFetch(GS_URL + '?sheet=sectors&email='        + email, 'sectors'),
      safeFetch(GS_URL + '?sheet=companies&email='      + email, 'companies'),
      safeFetch(GS_URL + '?sheet=part_types&email='     + email, 'part_types'),
    ]);

    setSheetsConnected(true);
    showSheetsWarning(false);
    // 마지막 동기화 시각 업데이트
    const syncEl = document.getElementById('last-sync-time');
    if(syncEl){
      const now = new Date();
      syncEl.textContent = now.toLocaleDateString('ko-KR',{month:'2-digit',day:'2-digit'})
        + ' ' + now.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});
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
        };
      }));
      console.log('[CRM] contacts loaded & cleaned:', contacts.length);
      // 동기화 시각 업데이트
      const _syncEl = document.getElementById('last-sync-time');
      if(_syncEl) _syncEl.textContent = new Date().toLocaleTimeString('ko-KR');

    // ── sectors 시트 → COMPANY_SECTORS (스프레드시트에서 직접 행 추가/삭제 가능) ──
    if(sectorsData && Array.isArray(sectorsData) && sectorsData.length){
      COMPANY_SECTORS.splice(0, COMPANY_SECTORS.length, ...sectorsData.map(r => ({
        id: r.id || '', name: r.name || '', parent: r.parent || null,
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

    // ── companies 시트 → COMPANY_INFO (회사 단위 관리 정보: 섹터/HQ/메모) ──
    for(const k in COMPANY_INFO) delete COMPANY_INFO[k];
    if(companiesData && Array.isArray(companiesData)){
      companiesData.forEach(r => {
        if(!r.key) return;
        COMPANY_INFO[r.key] = {
          sector: r.sector || '', hq: r.hq || '', website: r.website || '', notes: r.notes || '',
          catCode: r.catCode || '', country: r.country || '', abbr: r.abbr || '', source: r.source || '', updatedAt: r.updatedAt || '',
        };
      });
      console.log('[CRM] companies 시트 로드:', Object.keys(COMPANY_INFO).length, '개');
    }

    // ── part_types 시트 → PART_TYPES (행사 참가 유형, 설정에서 추가/삭제 가능) ──
    if(partTypesData && Array.isArray(partTypesData) && partTypesData.length){
      PART_TYPES.splice(0, PART_TYPES.length, ...partTypesData
        .filter(r => r.key)
        .map(r => ({ key: r.key, label: r.label || r.key, cls: r.cls || 'p-gray' })));
      console.log('[CRM] part_types 시트 로드:', PART_TYPES.length, '개');
    } else if(GS_URL && currentUser){
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
      targets.splice(0, targets.length, ...targetsData.map(r=>({
        id:+r.id, name:r.name, nameEn:r.nameEn||'',
        sector:r.sector||'', hq:r.hq||'',
        event:r.event||'', role:r.role||'스폰서',
        status:r.status||'미접촉', priority:r.priority||'mid',
        assignee:r.assignee||'', currentStage:+r.currentStage||1,
        lastActivity:r.lastActivity||'',
        branches:[r.name], mainBranch:r.name,
        contacts:[], eventHistory:[], log:[],
      })));
      console.log('targets loaded:', targets.length);
    }

    // activity_log 업데이트
    if(logsData && Array.isArray(logsData)){
      const remoteLog = logsData.map(r=>({
        id: Date.now() + Math.random(),
        ts: r.ts||new Date().toISOString(),
        email: r.email||'', name: r.name||'',
        color: userColor(r.email||''),
        type: r.action==='로그인'?'login':
              r.action==='상태 변경'?'status':
              r.action==='컨택 기록 추가'?'log':
              r.action==='타겟 추가'?'add':
              r.action==='단계 변경'?'stage':'login',
        action: r.action||'', target: r.target||'',
        detail: r.detail||'',
      }));
      auditLog.splice(0, auditLog.length, ...remoteLog);
    }

    // UI 갱신 (각 tab 모듈이 넘겨준 hooks를 통해 호출 — 없으면 조용히 건너뜀)
    try { hooks.buildMDBEvList?.(); hooks.renderMDB?.(); } catch(e){}
    try { hooks.buildEvFil?.(); hooks.updBadges?.(); }     catch(e){}
    try { hooks.populateUploadEvDropdown?.(); }            catch(e){}
    try { hooks.buildCoDB?.(); hooks.buildCoCAT?.(); }     catch(e){}
    // 마지막 동기화 시간 업데이트
    const syncEl2 = document.getElementById('last-sync-time');
    if(syncEl2) syncEl2.textContent = new Date().toLocaleTimeString('ko-KR');
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
export async function saveAuditToSheets(entry){
  if(!GS_URL || !currentUser) return;
  try{
    await fetch(GS_URL, {
      method:'POST',
      body: JSON.stringify({
        sheet:'activity_log',
        email: currentUser.email,
        row:[
          entry.ts, entry.name, entry.email,
          entry.action, entry.target,
          entry.detail.replace(/<[^>]+>/g,'')
        ]
      })
    });
  }catch(e){ console.warn('Audit log save failed (offline?):', e); }
}

// 행사 저장/삭제 (원본 6540~6571행)
export async function saveEventToSheet(ev){
  if(!GS_URL || !currentUser) return;
  try {
    await fetch(GS_URL, {
      method: 'POST',
      body: JSON.stringify({
        sheet:  'events',
        email:  currentUser.email,
        action: 'upsert',
        row: [ev.key, ev.name, ev.short, ev.date_start||ev.date||'', ev.date_end||'', ev.location||'', ev.color],
      })
    });
    console.log('[CRM] event saved:', ev.key);
  } catch(e){ console.warn('event 저장 실패:', e); }
}

export async function deleteEventFromSheet(key){
  if(!GS_URL || !currentUser) return;
  try {
    await fetch(GS_URL, {
      method: 'POST',
      body: JSON.stringify({
        sheet:  'events',
        email:  currentUser.email,
        action: 'delete',
        row:    [key],
      })
    });
    console.log('[CRM] event deleted:', key);
  } catch(e){ console.warn('event 삭제 실패:', e); }
}

// 섹터 저장/삭제/마이그레이션 (원본 4139~4174행, 6307~6333행)
export async function upsertSectorRow(sector){
  if(!GS_URL || !currentUser) return;
  try{
    await fetch(GS_URL, {
      method: 'POST',
      body: JSON.stringify({
        sheet:  'sectors',
        email:  currentUser.email,
        action: 'upsert',
        row:    [sector.id, sector.name, sector.parent || ''],
      }),
    });
  } catch(e){ console.warn('섹터 저장 실패:', e); }
  try { localStorage.setItem('crm_sectors', JSON.stringify(COMPANY_SECTORS)); } catch(e){}
}

export async function deleteSectorRow(id){
  if(GS_URL && currentUser){
    try{
      await fetch(GS_URL, {
        method: 'POST',
        body: JSON.stringify({ sheet: 'sectors', email: currentUser.email, action: 'delete', row: [id] }),
      });
    } catch(e){ console.warn('섹터 삭제 실패:', e); }
  }
  try { localStorage.setItem('crm_sectors', JSON.stringify(COMPANY_SECTORS)); } catch(e){}
}

// 구버전 settings.sectors(JSON blob) → sectors 시트로 1회 마이그레이션
export async function migrateSectorsToSheet(){
  if(!GS_URL || !currentUser) return;
  for(const s of COMPANY_SECTORS){
    await upsertSectorRow(s);
  }
  console.log('[CRM] sectors 시트 마이그레이션 완료:', COMPANY_SECTORS.length, '개');
}

export async function saveSectors(){
  // 구글시트 settings 시트에 저장
  if(GS_URL && currentUser){
    try {
      await fetch(GS_URL, {
        method: 'POST',
        body: JSON.stringify({
          sheet:  'settings',
          email:  currentUser.email,
          action: 'upsert',
          row:    ['sectors', JSON.stringify(COMPANY_SECTORS)],  // 객체 배열
        })
      });
      console.log('[CRM] sectors 저장 완료:', COMPANY_SECTORS.length, '개');
    } catch(e){ console.warn('sectors 저장 실패:', e); }
  }
  // localStorage에도 백업
  try { localStorage.setItem('crm_sectors', JSON.stringify(COMPANY_SECTORS)); } catch(e){}
}

export function loadSectors(){
  // loadFromSheets에서 이미 처리됨 — localStorage는 오프라인 백업용
  // (원본은 `COMPANY_SECTORS = parsed;` 로 재할당했으나, ES 모듈에서
  //  다른 모듈이 import한 배열 참조가 살아있도록 splice로 내용만 교체)
  try {
    if(!GS_URL){
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
  if(!GS_URL || !currentUser) return;
  try{
    await fetch(GS_URL, {
      method: 'POST',
      body: JSON.stringify({ sheet: 'part_types', email: currentUser.email, action: 'upsert', row: [t.key, t.label, t.cls] }),
    });
  } catch(e){ console.warn('참가 유형 저장 실패:', t.key, e); }
}

export async function deletePartTypeRow(key){
  if(!GS_URL || !currentUser) return;
  try{
    await fetch(GS_URL, {
      method: 'POST',
      body: JSON.stringify({ sheet: 'part_types', email: currentUser.email, action: 'delete', row: [key] }),
    });
  } catch(e){ console.warn('참가 유형 삭제 실패:', key, e); }
}

export async function migratePartTypesToSheet(){
  for(const t of PART_TYPES) await upsertPartTypeRow(t);
  console.log('[CRM] part_types 시트 마이그레이션 완료:', PART_TYPES.length, '개');
}
