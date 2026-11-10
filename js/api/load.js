/* ══════════════════════════════════════════════════════════════
   api/load.js — 전체 데이터 불러오기(loadFromSheets)
   (api.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { API_BASE_URL, CATMAPS, CODE_LISTS, COMPANY_SECTORS, CONF_SESSIONS, CONTACT_ATTEMPTS, CONTACT_ROUNDS, SALES_TARGETS, DOMAINS, EQUIP_CATALOG, EVENT_LIST, EXHIBITORS, EXH_APPS, EXH_CFG, EXH_CONTACTS, EXH_INVOICES, EXH_ITEMS, EXH_LOGS, EXH_PAYMENTS, EXH_TAX, ORGS, PART_TYPES, ROUND_MEMBERS, SESSION_SPEAKERS, SPEAKERS, SPEAKER_CONTACTS, SPEAKER_LOGS, TAGS, WATCH_FILES, WATCH_FOLDERS, applyCodeLists, auditLog, contacts, curApp, currentUser, loadExhCfg, participations, setDomains, setSheetsConnected, setTags, syncPartColors, targets, userColor } from '../state.js';
import { SECTOR_RENAMES } from '../state.js';
import { countryName, normalizeCat } from '../utils.js';
import { authHeaders, normalizeParticipationRow, safeFetch, setSettingsReady, showSheetsWarning } from '../api.js';
import { migratePartTypesToSheet, migrateSectorsToSheet, noteExhCfgBase, noteMailLibraryBase, saveTags } from './settings-save.js';

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
/* 테스트 로그인(test/test/test) 전용 — 표 이름 → 행 배열. 있으면 loadFromSheets가
   서버 대신 이것을 읽는다. 쓰기는 API_BASE_URL이 비어 있어 어차피 나가지 않는다. */
let TEST_FIXTURES = null;
export function setTestFixtures(fx){ TEST_FIXTURES = fx; }

export async function loadFromSheets(hooks = {}){
  // 백엔드 API는 유일한 데이터 소스 — 미연동 시 빈 화면 유지
  if(!TEST_FIXTURES && (!API_BASE_URL || !currentUser)){
    setSheetsConnected(false);
    showSheetsWarning(true);
    try { hooks.buildMDBEvList?.(); hooks.renderMDB?.(); } catch(e){}
    return;
  }
  showSheetsWarning(false); // 시도 시작 시 일단 숨김
  const base = API_BASE_URL + '/api/data?sheet=';
  // 테스트 로그인은 서버 대신 가짜 표(testdata.js)를 같은 길로 읽는다
  const headers = TEST_FIXTURES ? null : await authHeaders(); // 표마다 같은 토큰을 쓰도록 한 번만 계산
  const get = (sheet) => TEST_FIXTURES
    ? Promise.resolve(TEST_FIXTURES[sheet] ?? [])
    : safeFetch(base + sheet, sheet, 1, headers);

  try {
    const [conData, partsData, targetsData, logsData, eventsData, settingsData, sectorsData, partTypesData,
           orgsData,
           exhData, exhConData, exhItemData, exhInvData, exhTaxData, exhPayData, exhLogData, exhAppData, equipCatData,
           codeListData,
           confSessData, speakerData, sessSpData, spConData, spLogData,
           watchFolderData, watchFileData,
           roundData, roundMemberData, attemptData, salesTargetData] = await Promise.all([
      get('contacts'),
      get('participations'),
      get('crm_targets'),
      get('activity_log'),
      get('events'),
      get('settings'),
      get('sectors'),
      get('part_types'),
      get('orgs'),
      get('exhibitors'),
      get('exhibitor_contacts'),
      get('exhibitor_items'),
      get('exhibitor_invoices'),
      get('exhibitor_tax_invoices'),
      get('exhibitor_payments'),
      get('exhibitor_logs'),
      get('exhibitor_apps'),
      get('equip_catalog'),
      get('code_lists'),
      get('conf_sessions'),
      get('speakers'),
      get('session_speakers'),
      get('speaker_contacts'),
      get('speaker_logs'),
      get('watch_folders'),
      get('watch_files'),
      get('contact_rounds'),
      get('round_members'),
      get('contact_attempts'),
      get('sales_targets'),
    ]);

    // ── 실패 감지 (신규) ──
    // safeFetch는 실패 시 예외 대신 null을 반환하므로, 여기서 null 개수를
    // 세지 않으면 "전 시트 로드 실패"도 성공으로 표시되는 버그가 있었다.
    const _results = [conData, partsData, targetsData, logsData, eventsData, settingsData, sectorsData, partTypesData,
      orgsData,
      exhData, exhConData, exhItemData, exhInvData, exhTaxData, exhPayData, exhLogData, exhAppData, equipCatData,
      confSessData, speakerData, sessSpData, spConData, spLogData,
      watchFolderData, watchFileData,
      roundData, roundMemberData, attemptData,
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
          /* org_id를 여기서 빠뜨리면 안 된다 — 저장은 c.org_id를 그대로 실어
             보내므로, 읽을 때 안 담으면 undefined가 빈칸으로 나가 연락처를 고칠
             때마다 기업 연결이 조용히 끊긴다. 쓰는 쪽만 고쳐 놨던 구멍이다. */
          org_id: r.org_id||'',
          /* 퇴사 — 비어 있으면 재직. moved_to_id는 이직해 새로 만든 연락처 id */
          left_at:     r.left_at||'',
          moved_to_id: r.moved_to_id||'',
          /* 메모·경칭 — 저장(contactRow)은 이 넷을 실어 보낸다. 읽을 때 안 담으면
             연락처를 고칠 때마다 빈칸으로 덮여 업로드한 회원번호·경칭이 지워진다. */
          memo1: r.memo1||'', memo2: r.memo2||'', memo3: r.memo3||'', prefix: r.prefix||'',
          /* DB 갈래 — ours 수주 행사 / other 타 행사 / sales 영업 DB (db/migrations/add-contact-origin.js) */
          origin: r.origin||'',
        };
      }));
      console.log('[CRM] contacts loaded & cleaned:', contacts.length);
    }

    // 설정 묶음(양식 보관함·행사 설정·분야·태그)은 읽은 뒤에만 저장한다 — postToSheet가 본다
    setSettingsReady(Array.isArray(settingsData));

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

      // ── settings 시트 → 섹터 이름 바꾼 기록 ──
      const renRow = settingsData.find(row => row.key === 'sector_renames');
      if(renRow){
        try { Object.assign(SECTOR_RENAMES, JSON.parse(renRow.value) || {}); }
        catch(e){ console.warn('[CRM] sector_renames 파싱 실패:', e); }
      }

      // ── settings 시트 → 행사별 전시 설정 (마감일·프로그램북 한도) ──
      loadExhCfg(settingsData);
      noteExhCfgBase(EXH_CFG);
      noteMailLibraryBase();

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
      /* 섹터 순서 — 표의 sort_order가 정본(설정에서 바꾼다). 값이 없는 섹터는 뒤로, 서로는 읽은 순서 */
      const loaded = sectorsData.map(r => ({
        id: r.id || '', name: r.name || '', parent: r.parent || null,
        domain: r.domain || '', canonical: r.canonical || '',
        order: r.sort_order == null || r.sort_order === '' ? null : Number(r.sort_order),
        group: r.group_name || '',
      })).filter(s => s.id && s.name);
      loaded.sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9));
      COMPANY_SECTORS.splice(0, COMPANY_SECTORS.length, ...loaded);
      console.log('[CRM] sectors 시트 로드:', COMPANY_SECTORS.length, '개');
    } else if(Array.isArray(sectorsData) && settingsData && Array.isArray(settingsData)){
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

    // ── watch_folders / watch_files → 지켜보는 폴더 ──
    if(watchFolderData && Array.isArray(watchFolderData)){
      WATCH_FOLDERS.splice(0, WATCH_FOLDERS.length, ...watchFolderData);
    }
    if(watchFileData && Array.isArray(watchFileData)){
      WATCH_FILES.splice(0, WATCH_FILES.length, ...watchFileData);
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
      syncPartColors();
      console.log('[CRM] part_types 시트 로드:', PART_TYPES.length, '개');
    } else if(Array.isArray(partTypesData) && API_BASE_URL && currentUser){
      // 시트가 비어있으면 기본값을 1회 저장 (마이그레이션) — 읽기 실패(null)면 하지 않는다
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
        // 행사 개요 — 행사 탭에서 채운다. 없는 서버(구버전)면 전부 빈 값이 된다
        host:       r.host       || '',
        organizer:  r.organizer  || '',
        our_role:   r.our_role   || '',
        theme:      r.theme      || '',
        scale:      r.scale      || '',
        homepage:   r.homepage   || '',
        summary:    r.summary    || '',
        outcome:    r.outcome    || '',
        /* 이 행사가 어느 분야였나 — 마스터DB에서 «건축 행사에 왔던 사람»을
           찾는 근거다. DOMAINS의 id, 여러 분야면 파이프로 잇는다. */
        domain:     r.domain     || '',
        // 영문 행사명 — 영문 메일·엑셀은 이것을 쓴다(없으면 행사명)
        name_en:    r.name_en    || '',
        // 국내 연사료 세율 — 정산 화면에서 고른다(비면 3.3%)
        dom_tax_rate: r.dom_tax_rate || '',
      })).filter(e => e.key));
      console.log('[CRM] events loaded:', EVENT_LIST.length, '건');
    }
    hooks.buildCoDB?.();

    // participations 업데이트 — 필드명 정규화 적용(핵심 개선사항)
    if(partsData && Array.isArray(partsData)){
      participations.splice(0, participations.length, ...partsData.map(normalizeParticipationRow));
      // 행사 탭이 참여자를 미리 세어 두고 있다 — 새로 읽었으면 다시 세게 한다
      // (window 경유 — event-tab이 이 파일을 import하므로 직접 부르면 순환이 된다)
      window.invalidateEvRows?.();
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
          log:logArr,
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
    if(exhTaxData  && Array.isArray(exhTaxData))  EXH_TAX.splice(0, EXH_TAX.length, ...exhTaxData);
    if(exhPayData  && Array.isArray(exhPayData))  EXH_PAYMENTS.splice(0, EXH_PAYMENTS.length, ...exhPayData);
    if(exhAppData  && Array.isArray(exhAppData))  EXH_APPS.splice(0, EXH_APPS.length, ...exhAppData);
    if(exhLogData  && Array.isArray(exhLogData)){
      EXH_LOGS.splice(0, EXH_LOGS.length, ...exhLogData);
      const open = EXH_LOGS.filter(l => l.kind === 'inquiry' && !l.answered_at).length;
      if(open) console.log('[CRM] 미답변 문의:', open, '건');
    }

    /* ── 컨택 — TM/DM 차수 ── 표가 아직 없으면(마이그레이션 전) null이라 건너뛴다 */
    if(Array.isArray(roundData))       CONTACT_ROUNDS.splice(0, CONTACT_ROUNDS.length, ...roundData);
    if(Array.isArray(roundMemberData)) ROUND_MEMBERS.splice(0, ROUND_MEMBERS.length, ...roundMemberData);
    if(Array.isArray(attemptData))     CONTACT_ATTEMPTS.splice(0, CONTACT_ATTEMPTS.length, ...attemptData);
    /* 행사별 영업 DB — contact_id는 화면이 숫자로 쓴다(CLAUDE.md) */
    if(Array.isArray(salesTargetData)) SALES_TARGETS.splice(0, SALES_TARGETS.length,
      ...salesTargetData.map(r => ({ ...r, contact_id: +r.contact_id })));

    /* ── 컨퍼런스 · 연사 ──
       서버 컬럼명(snake_case)을 그대로 쓰므로 변환 없이 통째로 담는다.
       표가 아직 비어 있어도(연사를 안 넣은 행사) 배열만 비워 둔다. */
    if(confSessData && Array.isArray(confSessData)) CONF_SESSIONS.splice(0, CONF_SESSIONS.length, ...confSessData);
    if(speakerData  && Array.isArray(speakerData))  SPEAKERS.splice(0, SPEAKERS.length, ...speakerData);
    if(sessSpData   && Array.isArray(sessSpData))   SESSION_SPEAKERS.splice(0, SESSION_SPEAKERS.length, ...sessSpData);
    if(spConData    && Array.isArray(spConData))    SPEAKER_CONTACTS.splice(0, SPEAKER_CONTACTS.length, ...spConData);
    if(spLogData    && Array.isArray(spLogData))    SPEAKER_LOGS.splice(0, SPEAKER_LOGS.length, ...spLogData);
    if(SPEAKERS.length) console.log('[CRM] speakers loaded:', SPEAKERS.length, '· 배정', SESSION_SPEAKERS.length);

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
      /* 예전 행에는 link 칸이 없고, 손으로 넣은 행에 엉뚱한 글자가 들어 있을 수도
         있다. 못 읽으면 그냥 링크 없는 줄로 둔다 — 로그 목록이 통째로 안 뜨는
         것보다 낫다. */
      const parseAuditLink = (v) => {
        if(!v) return null;
        try {
          const o = JSON.parse(v);
          if(!o || typeof o !== 'object') return null;
          /* 두 가지가 여기 담긴다: 눌러서 갈 곳(kind·id)과 되돌릴 재료(table·before).
             둘 중 하나만 있는 줄도 있다 — 설정 삭제는 갈 창이 없고, 옛 기록은
             재료가 없다. 하나라도 있으면 살린다. 예전에는 kind·id가 둘 다
             있어야 받아서, 재료만 담긴 줄이 읽을 때 통째로 버려졌다. */
          return (o.kind && o.id) || o.table || o.before ? o : null;
        }
        catch(e){ return null; }
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
          extra: parseAuditLink(row.link),
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


