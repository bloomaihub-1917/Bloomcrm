/* ══════════════════════════════════════════════════════════════
   api/settings-save.js — 설정 저장 — 행사·섹터·분야·태그·참가 유형·전시 설정·메일 문구
   (api/conf-save.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { authHeaders, postToSheet, safeFetch } from '../api.js';
import { API_BASE_URL, CATMAPS, COMPANY_SECTORS, DOMAINS, MAIL_LIBRARY, PART_TYPES, TAGS, currentUser } from '../state.js';
import { sectorRowValues } from '../utils.js';

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
/* 행사 설정은 JSON 한 줄이라 통째로 올린다. 그 사이 남이 다른 칸(마감일·진행 파트 등)을 고쳤으면
   내 화면의 옛 값이 그것을 지웠다. 그래서 «로그인 때 읽은 값»(exhCfgBase)과 견줘 내가 바꾼
   칸만 서버의 지금 값에 얹는다. 같은 칸을 둘 다 고쳤으면 나중 것이 이긴다.
   합친 결과는 넘겨받은 cfg에 그대로 채운다 — 부르는 쪽이 그 객체를 EXH_CFG에 넣는다 */
const exhCfgBase = {};   // 행사 → 마지막으로 서버와 맞춘 설정(JSON 문자열)
export function noteExhCfgBase(cfgs){ for(const k in exhCfgBase) delete exhCfgBase[k]; for(const k in cfgs) exhCfgBase[k] = JSON.stringify(cfgs[k]); }
export async function saveExhCfgToSheet(evKey, cfg){
  cfg = cfg || {};
  if(API_BASE_URL && currentUser){
    const rows = await safeFetch(API_BASE_URL + '/api/data?sheet=settings', 'settings', 1, await authHeaders());
    if(Array.isArray(rows)){
      const row = rows.find(x => x.key === 'exh_cfg_' + evKey);
      let server = {};
      try { server = row && row.value ? JSON.parse(row.value) : {}; } catch(e){ server = {}; }
      const baseStr = exhCfgBase[evKey] ?? '{}';
      if(JSON.stringify(server) !== baseStr){
        const base = JSON.parse(baseStr);
        const merged = { ...server };
        new Set([...Object.keys(base), ...Object.keys(cfg)]).forEach(k => {
          if(JSON.stringify(cfg[k]) === JSON.stringify(base[k])) return;   // 내가 안 바꾼 칸 — 서버 값
          if(cfg[k] === undefined) delete merged[k]; else merged[k] = cfg[k];
        });
        for(const k of Object.keys(cfg)) delete cfg[k];
        Object.assign(cfg, merged);
      }
    }
  }
  const r = await postToSheet({
    sheet:  'settings',
    action: 'upsert',
    row:    ['exh_cfg_' + evKey, JSON.stringify(cfg)],
  }, '행사 설정 저장');
  if(r.ok){ exhCfgBase[evKey] = JSON.stringify(cfg); console.log('[CRM] 행사 설정 저장:', evKey); }
  return r;
}

/* 메일 양식 보관함 — settings 시트 key='mail_library' JSON(state.js MAIL_LIBRARY) */
/* 보관함도 JSON 한 줄이라 통째로 올린다 — 두 사람이 비슷한 때 양식을 하나씩 넣으면 한쪽이 사라졌다.
   행사 설정과 같은 방식: 로그인 때 읽은 목록(libBase)과 견줘 내가 넣고·고치고·뺀 양식만
   서버의 지금 목록에 얹는다(양식 id 기준). 합친 결과로 MAIL_LIBRARY를 바꾼다 */
let libBase = null;   // id → JSON 문자열
export function noteMailLibraryBase(){ libBase = new Map(MAIL_LIBRARY.map(it => [it.id, JSON.stringify(it)])); }
export async function saveMailLibrary(){
  if(libBase && API_BASE_URL && currentUser){
    const rows = await safeFetch(API_BASE_URL + '/api/data?sheet=settings', 'settings', 1, await authHeaders());
    if(Array.isArray(rows)){
      let server = [];
      try { const row = rows.find(x => x.key === 'mail_library'); server = row && row.value ? JSON.parse(row.value) : []; } catch(e){ server = []; }
      if(Array.isArray(server)){
        const mine = new Map(MAIL_LIBRARY.map(it => [it.id, it]));
        const out = server.filter(it => {
          if(!mine.has(it.id)) return !libBase.has(it.id);          // 내가 뺀 것은 빼고, 남이 새로 넣은 것은 둔다
          return true;
        }).map(it => {
          const m = mine.get(it.id);
          return m && JSON.stringify(m) !== libBase.get(it.id) ? m : it;   // 내가 고친 것만 내 것으로
        });
        const have = new Set(out.map(it => it.id));
        MAIL_LIBRARY.forEach(it => { if(!have.has(it.id) && !libBase.has(it.id)) out.push(it); });   // 내가 새로 넣은 것
        MAIL_LIBRARY.splice(0, MAIL_LIBRARY.length, ...out);
      }
    }
  }
  const r = await postToSheet({
    sheet:  'settings',
    action: 'upsert',
    row:    ['mail_library', JSON.stringify(MAIL_LIBRARY)],
  }, '메일 양식 보관함 저장');
  if(r && r.ok !== false) noteMailLibraryBase();
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

