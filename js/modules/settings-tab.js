/* ══════════════════════════════════════════════════════════════
   settings-tab.js — 설정(arch) 탭
   (원본 contact_crm.html 1116~1410행 마크업 + 3685~4174행,
    5996~6116행, 6291~6350행대, 6353~6376행, 6421~6537행,
    6439~6450행, 3169~3174행 JS에서 정리)

   설정 탭은 3개 하위탭으로 구성됨:
   1) 행사 관리(ev)   — EVENT_LIST 추가/삭제, 국가명·기업명 데이터 정리
   2) 기업 섹터(sector) — COMPANY_SECTORS 트리(드래그앤드롭 재배치),
                          섹터 병합/그룹핑, 참가 유형(PART_TYPES) 관리
   3) 시스템 구조(sys)  — 정적 다이어그램(전체 아키텍처/구글시트/업무 플로우)
                          전환만 하는 switchAV — 다이어그램 자체는
                          index.html 정적 마크업에 그대로 남아있음

   이 모듈이 소유하지 않는 것:
   - renderSimilarCompanyList / findSimilarCompanyPairs → company-tab.js가
     window에 등록(섹터 탭 하위 "유사 기업명 찾기" 버튼에서 인라인 onclick
     으로 호출되므로 여기서 import할 필요는 없음)
   - buildCoCAT / buildCoDB / renderCoDashboard / setCoCat → company-tab.js,
     renderMDB / buildMDBEvList → db-tab.js, populateUploadEvDropdown →
     upload-tab.js. company-tab.js/db-tab.js가 이 파일의 parseSectors 등을
     역으로 import하므로 순환 참조가 생기지만, 실제 호출은 전부 이벤트
     핸들러 안(모듈 최상단 평가 이후)에서만 일어나 ES 모듈에서 안전하다.
   - switchApp → router.js. router.js가 모든 tab 모듈을 최상위에서
     import/조립하는 진입점이라 여기서 역참조하면 순환이 더 꼬이므로,
     router.js가 `window.switchApp = switchApp`로 등록해 둔 것을
     `window.switchApp?.()`로만 호출한다.
═══════════════════════════════════════════════════════════════ */

import {
  API_BASE_URL,
  currentUser,
  contacts,
  participations,
  CO_DB,
  ORGS,
  EVENT_LIST,
  COMPANY_SECTORS,
  DOMAINS,
  TAGS,
  PART_TYPES,
  CODE_LISTS,
  applyCodeLists,
  EXH_CFG,
  EQUIP_CATALOG,
  EXH_ITEMS,
  evParts,
  evPartDone,
  codeList,
  confCfg, confDays, speakerNeed,
  CONF_SESSIONS, EXHIBITORS, SPEAKERS, SPEAKER_LOGS, EXH_LOGS,
  syncPartColors,
} from '../state.js';
import { isUnread, isPending, runMailSync } from '../shared/mail/mail-mark.js';
import { dueInputHtml, readDueInput, followCfg, FOLLOW_DEFAULT } from '../shared/mail/follow-up.js';
import { exhMailSteps, exhMailFileStep } from './exh-mail.js';
import './exh-mail-editor.js';

import { saveEventToSheet, postToSheet, safeFetch, authHeaders } from '../api.js';
import { saveConfSession, reloadSpeakerData } from '../api/conf-save.js';
import { upsertSectorRow, deleteSectorRow, upsertPartTypeRow, deletePartTypeRow, deleteEventFromSheet, saveDomains, saveTags, saveExhCfgToSheet } from '../api/settings-save.js';
import { saveEquipCatalog, deleteEquipCatalog } from '../api/exh-save.js';
import { loadMailFiles, mailFilesOf, uploadMailFile, deleteMailFile, fileToBase64, loadMailAccounts, saveMailAccount, loadMailFooter, saveMailFooter, deleteMailAccount, testMailAccount, eventMailFrom, syncSentMail, syncInboxMail } from '../api/mail-send.js';
import { trackAction, changed, removed } from '../core/audit-log.js';

import { TRACK_COLORS, trackColorOf, trackColorIndex, pickTrackColorIndex } from '../track-colors.js';
import { flowSteps } from './speaker-flow.js';
import { openFlowEditor } from '../shared/mail/flow-editor.js';
import { CL, CAT_KEYS, EVENT_PARTS, PART_STATES, partStateOf,
  SPEAKER_ROLES, SPEAKER_NEEDS, SPEAKER_NEEDS_ON_TALK,
  NEED_CYCLE, NEED_MARK, NEED_LABEL } from '../constants.js';
import { slugifySectorName, escapeHtml, escAttr, countryName, scopedSectorName, parseSectorScope, sectorRowValues, sectorKey, parseDomains, joinDomains } from '../utils.js';
import { buildCoCAT, renderCoDashboard, setCoCat } from './company-tab.js';
import { buildCoDB } from '../domain/co-db.js';
import { renderMDB, buildMDBEvList, buildMDBTagList } from './db-tab.js';
import { populateUploadEvDropdown } from '../features/upload/upload-event-select.js';
import { renderAiSettings } from './ai-settings.js';
import { contactFillCount, renderContactFill, enrichCounts, saveOrgFields } from './data-clean.js';
/* 화면 상태는 settingsUi 한곳에 둔다 — 이 탭의 구획을 다른 파일로 떼어도 같은 값을 보게 */
import { settingsUi } from '../features/settings/settings-ui.js';

/* 드래그 중인 섹터 id (원본 3693행 전역 변수 → 모듈 스코프로 축소) */

/* 14개 함수를 ../domain/sectors.js로 옮겼다 — 이 파일에서도 쓰고, 옛 경로로 가져가는 곳도 있어 다시 내보낸다 */
import { sectorName, sectorId, findSectorByName, parseSectors, joinSectors, mainSectors, subSectors, UNASSIGNED_DOMAIN, domainName, domainOfSector, sectorNamesInDomain, computeSectorCompanyCounts, sectorCountFor, collectUnregisteredSectors } from '../domain/sectors.js';
export { sectorName, sectorId, findSectorByName, parseSectors, joinSectors, mainSectors, subSectors, UNASSIGNED_DOMAIN, domainName, domainOfSector, sectorNamesInDomain, computeSectorCompanyCounts, sectorCountFor, collectUnregisteredSectors } from '../domain/sectors.js';

/* «섹터 트리·병합·묶기·편입»은 ../features/settings/sector-tree.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* «분야·연락처 태그·참가 유형 관리»은 ../features/settings/taxonomy.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* «행사 관리»은 ../features/settings/event-admin.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* ── 연락처 데이터 정리 도구 (원본 5996~6115행) ──
   arch-pane-ev(행사 관리 탭) 하단에 함께 배치돼 있던 일괄 정리 버튼들.
   contacts 시트 자체를 직접 정리하는 기능이라 db-tab.js와도 관련이 있지만,
   UI가 설정 탭에만 있고 다른 모듈이 소유를 명시하지 않아 이 파일에 둔다. */
export async function normalizeAllCountries(){
  const msgEl = document.getElementById('country-fix-msg');
  if(!API_BASE_URL || !currentUser){
    if(msgEl) msgEl.textContent = '서버 연동 정보가 없어요.';
    return;
  }

  if(msgEl) msgEl.textContent = '원본 데이터 확인 중...';
  const raw = await safeFetch(API_BASE_URL + '/api/data?sheet=contacts', 'contacts(정리)', 1, await authHeaders());
  if(!Array.isArray(raw)){
    if(msgEl) msgEl.textContent = '시트 조회에 실패했어요. 네트워크를 확인해주세요.';
    return;
  }

  const targets = raw.filter(r => r.country && r.country !== countryName(r.country));
  const orgN = orgCountryTargets().length;
  if(!targets.length && !orgN){
    if(msgEl) msgEl.textContent = '이미 모두 한글 국가명으로 정리돼 있어요.';
    return;
  }
  if(!confirm(`국가명을 한글로 통일할까요?\n연락처 ${targets.length}건 · 기업 ${orgN}곳`)) return;
  if(orgN){
    if(msgEl) msgEl.textContent = `기업 저장 중... (${orgN}곳)`;
    if(await normalizeOrgCountries(msgEl) < 0) return;
    renderCleanCounts();
  }
  if(!targets.length){
    if(msgEl) msgEl.textContent = `완료: 기업 ${orgN}곳 정리했어요.`;
    return;
  }

  if(msgEl) msgEl.textContent = `저장 중... (${targets.length}건)`;
  const rows = targets.map(r => {
    const newCountry = countryName(r.country);
    const c = contacts.find(x => String(x.id) === String(r.id));
    if(c) c.country = newCountry;
    return [r.id, r.nameKo, r.nameEn, r.orgKo, r.orgEn, r.titleKo, r.titleEn, r.deptKo, r.deptEn,
      newCountry, r.cat, r.lang, r.source, r.date, r.status, r.email1, r.email2, r.phone1, r.phone2,
      r.beat, r.products, r.tags||''];
  });
  const r = await postToSheet({ sheet: 'contacts', action: 'batchUpsert', rows }, '국가명 정리');
  if(msgEl) msgEl.textContent = r.ok
    ? `완료: ${targets.length}건 정리했어요.`
    : '저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.';
  if(r.ok) trackAction('edit', '국가명 정리', 'contacts', `국가명 한글 통일 ${targets.length}건`);
  try { renderMDB(); buildCoDB(); } catch(e){}
}

/* 기업의 국가·본사 칸 — 전에는 연락처만 정리해서 기업에 «한국»이 94곳 남아 있었다 */
function orgCountryTargets(){
  const fix = (v) => { const t = String(v || '').trim(); return t && t !== '-' && t !== countryName(t) ? countryName(t) : null; };
  return ORGS.map(o => {
    const p = { id: o.id };
    const c = fix(o.country), h = fix(o.hq);
    if(c) p.country = c;
    if(h) p.hq = h;
    return (c || h) ? p : null;
  }).filter(Boolean);
}
async function normalizeOrgCountries(msgEl){
  const patches = orgCountryTargets();
  if(!patches.length) return 0;
  const r = await saveOrgFields(patches, '기업 국가명 정리');
  if(!r.ok){ if(msgEl) msgEl.textContent = '기업 국가명 저장에 실패했어요. 다시 시도해주세요.'; return -1; }
  trackAction('edit', '국가명 정리', 'orgs', `기업 국가명 한글 통일 ${r.saved}건`);
  return r.saved;
}

// ── 기업명 국문/영문 분리: "한국보건산업진흥원 Korea Health Industry Development Institute" 처럼
// 공백으로만 붙어있는 국/영문 기업명을 orgKo/orgEn으로 분리. "SK 바이오사이언스"처럼 짧은 접두/접미
// 영문 약어까지 잘못 쪼개지 않도록, 영문 쪽이 2단어 이상일 때만 분리한다. (원본 6043~6064행)
export function splitMixedOrgName(raw){
  const tokens = (raw||'').trim().split(/\s+/).filter(Boolean);
  if(tokens.length < 2) return null;
  const isKo = t => /[가-힣]/.test(t);
  const flags = tokens.map(isKo);
  let i = 0;
  while(i < flags.length && flags[i] === flags[0]) i++;
  if(i === 0 || i === flags.length) return null;          // 언어가 안 섞여있음
  if(!flags.slice(i).every(f => f === flags[i])) return null; // 중간에 뒤섞여 있으면 손대지 않음

  const firstPart  = tokens.slice(0, i);
  const secondPart = tokens.slice(i);
  const firstIsKo  = flags[0];
  const enPart = firstIsKo ? secondPart : firstPart;
  const koPart = firstIsKo ? firstPart  : secondPart;
  if(enPart.length < 2 || koPart.length < 1) return null;  // 영문이 1단어(약어)면 그대로 둠

  return { ko: koPart.join(' '), en: enPart.join(' ') };
}

// 기업/직책/부서 세 필드 모두에 같은 분리 규칙 적용 (원본 6067~6071행)
const BILINGUAL_FIELD_PAIRS = [
  { ko: 'orgKo',   en: 'orgEn',   label: '기업' },
  { ko: 'titleKo', en: 'titleEn', label: '직책' },
  { ko: 'deptKo',  en: 'deptEn',  label: '부서' },
];

export async function splitMixedOrgNames(){
  const msgEl = document.getElementById('orgsplit-fix-msg');
  const targets = [];
  let firstExample = null;

  contacts.forEach(c => {
    let changed = false;
    BILINGUAL_FIELD_PAIRS.forEach(({ko, en, label}) => {
      if(!c[ko] || c[en]) return; // 영문 필드가 이미 채워져 있으면 손대지 않음
      const split = splitMixedOrgName(c[ko]);
      if(!split) return;
      if(!firstExample) firstExample = { label, before: c[ko], ...split };
      c[ko] = split.ko; c[en] = split.en;
      changed = true;
    });
    if(changed) targets.push(c);
  });

  if(!targets.length){
    if(msgEl) msgEl.textContent = '분리할 항목이 없어요.';
    return;
  }
  if(!confirm(`${targets.length}건의 기업/직책/부서를 국문·영문으로 분리해서 저장할까요?\n예(${firstExample.label}): "${firstExample.before}" → "${firstExample.ko}" / "${firstExample.en}"`)) return;

  if(!API_BASE_URL || !currentUser){
    if(msgEl) msgEl.textContent = `완료: ${targets.length}건 정리했어요 (로컬만 반영, 서버 미연동).`;
    try { renderMDB(); buildCoDB(); } catch(e){}
    return;
  }

  if(msgEl) msgEl.textContent = `저장 중... (${targets.length}건)`;
  const rows = targets.map(c => [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
    c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2,
    c.beat, c.products, c.tags||'', c.org_id||'']);
  const r = await postToSheet({ sheet: 'contacts', action: 'batchUpsert', rows }, '기업/직책/부서 분리');
  if(msgEl) msgEl.textContent = r.ok
    ? `완료: ${targets.length}건 분리했어요.`
    : '저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.';
  if(r.ok) trackAction('edit', '국영문 분리', 'contacts', `기업/직책/부서 국영문 분리 ${targets.length}건`);
  try { renderMDB(); buildCoDB(); } catch(e){}
}

/* ══════════════════════════════════════════
   설정 탭 하위탭 전환 (원본 6439~6450행) / 시스템 구조 문서 하위탭 (원본 3168~3174행)
   행사·기업 분류·사람 분류·공통 목록·데이터 정리·시스템 구조 패널을 전환한다.
   arch-pane-sys 내부의 정적 SVG 다이어그램(전체 아키텍처/구글시트 연동/
   업무 플로우) 자체는 index.html 정적 마크업에 그대로 남아있고,
   switchAV는 그 3개 다이어그램 중 무엇을 보여줄지 display 토글만 한다
   (JS 로직은 사실상 이 전환 함수 하나뿐).
══════════════════════════════════════════ */
export function switchArchTab(tab){
  /* 옛 이름으로 불러도 연다 — 다른 화면이 switchArchTab('sector')처럼 부를 수 있다 */
  tab = ({ sector: 'org', val: 'common' })[tab] || tab;
  /* 업로드 화면에서도 설정 사이드바가 보이므로, 거기서 누르면 설정으로 먼저 돌아온다 */
  if(window.curApp && window.curApp !== 'arch') window.switchApp?.('arch', null);
  ['ev','org','people','common','equip','clean','ai','sys'].forEach(t => {
    const btn  = document.getElementById('arch-tab-'+t);
    const pane = document.getElementById('arch-pane-'+t);
    // 모바일 본문 전환줄 — 사이드바 버튼과 같은 상태를 유지해야 지금 어느 탭인지 보인다
    const mbtn = document.getElementById('arch-mtab-'+t);
    if(btn)  btn.classList.toggle('on', t===tab);
    if(mbtn) mbtn.classList.toggle('on', t===tab);
    if(pane) pane.style.display = t===tab ? 'block' : 'none';
  });
  const sysnav = document.getElementById('sbp-arch-sysnav');
  if(sysnav) sysnav.style.display = tab==='sys' ? 'block' : 'none';
  if(tab==='ev')     { window.closeEvDetail(); }   // 목록부터 — 상세는 카드를 눌러서 연다
  if(tab==='org')    { window.renderSectorList(); window.mountCodeList('org'); }
  if(tab==='people') { window.renderPartTypeList(); window.renderTagList(); window.renderAliasList(); window.mountCodeList('people'); }
  if(tab==='common') { window.mountCodeList('common'); }
  if(tab==='equip')  { window.mountEquipCatalog('eqcat-rows', ''); }
  if(tab==='clean')  { window.renderSectorList(); renderCleanCounts(); }
  if(tab==='ai')     { renderAiSettings(); }
  if(tab==='sys')    { renderSysInfo(); }
}

/* 정리 도구마다 «지금 손볼 것이 몇 건인지»를 먼저 보여준다. 0건인 도구를
   눌러 «분리할 항목이 없어요»를 받는 일이 없게. 국가명은 화면에 올라온
   연락처로 센다 — 실제 정리는 서버 원본을 다시 읽어서 한다. */
function renderCleanCounts(){
  const set = (k, n) => {
    const el = document.getElementById('clean-cnt-' + k);
    if(!el) return;
    el.textContent = n ? `${n.toLocaleString()}건` : '할 일 없음';
    el.className = 'pill ' + (n ? 'p-amber' : 'p-gray');
  };
  /* 연락처는 불러올 때 이미 국가명을 바꿔 보여 줘서(api.js) 여기서는 늘 0이었다 —
     «한국»이 서버에 남아 있어도 «할 일 없음». 기업은 바꾸지 않고 불러오므로 기업으로 센다 */
  set('country', orgCountryTargets().length);
  set('ctryfill', contactFillCount());
  const ec = enrichCounts();
  set('orgenrich', ec.total);
  const ecEl = document.getElementById('org-enrich-sub');
  if(ecEl) ecEl.textContent = ec.total ? `국가 빈 곳 ${ec.country} · 업종 미정·빈칸 ${ec.sector}` : '';
  renderContactFill();
  set('orgsplit', contacts.filter(c => BILINGUAL_FIELD_PAIRS.some(({ ko, en }) =>
    c[ko] && !c[en] && splitMixedOrgName(c[ko]))).length);
  try { set('unreg', collectUnregisteredSectors().length); } catch(e){ set('unreg', 0); }
}

/* 시스템 정보 — 배포 버전·서버 상태·데이터 건수 */
async function renderSysInfo(){
  const el = document.getElementById('sys-info');
  if(!el) return;
  const box = (t, rows) => `<div style="background:var(--i8);border:1px solid var(--i6);border-radius:10px;padding:14px;margin-bottom:14px">
    <div style="font-size:12px;font-weight:700;color:var(--i2);margin-bottom:8px">${t}</div>
    ${rows.map(([k, v]) => `<div style="display:flex;gap:10px;font-size:12px;padding:4px 0;border-top:1px solid var(--i7)">
      <span style="width:120px;color:var(--i4);flex:0 0 auto">${k}</span><span style="color:var(--i1)">${v}</span></div>`).join('')}
  </div>`;
  const n = (a) => (a?.length || 0).toLocaleString();
  const data = box('데이터 건수', [
    ['연락처', n(contacts)], ['기업', n(CO_DB)], ['행사', n(EVENT_LIST)],
    ['행사 참여 기록', n(participations)], ['전시 참가기업', n(EXHIBITORS)],
    ['컨퍼런스 세션', n(CONF_SESSIONS)], ['연사', n(SPEAKERS)],
  ]);
  const who = box('접속', [
    ['로그인', escapeHtml(currentUser?.email || '-')],
    ['모드', API_BASE_URL ? '실제 서버' : '<b style="color:var(--am)">테스트 모드 (저장 안 됨)</b>'],
  ]);
  el.innerHTML = box('서버', [['상태', '확인 중…']]) + data + who;

  let server;
  if(!API_BASE_URL) server = [['상태', '테스트 모드라 서버에 묻지 않아요']];
  else {
    try {
      const t0 = performance.now();
      const r = await fetch(API_BASE_URL + '/health', { cache: 'no-store' });
      const j = await r.json();
      server = [
        ['상태', j.ok ? '<b style="color:var(--g)">정상</b>' : '<b style="color:var(--re)">응답 이상</b>'],
        ['배포 버전', `<code>${escapeHtml(j.commit || '-')}</code>`],
        ['응답 시간', `${Math.round(performance.now() - t0)}ms`],
        ['주소', `<code style="font-size:11px">${escapeHtml(API_BASE_URL)}</code>`],
      ];
    } catch(e){
      server = [['상태', '<b style="color:var(--re)">연결 안 됨</b> — 네트워크나 서버를 확인하세요']];
    }
  }
  if(document.getElementById('sys-info') === el) el.innerHTML = box('서버', server) + data + who;
}

// archV는 이 탭에서만 쓰는 로컬 UI 상태라 state.js로 옮기지 않고 모듈 스코프에 둠
export function switchAV(v, btn){
  settingsUi.archV = v;
  ['arch','sheet','flow'].forEach(id => {
    const el = document.getElementById('av-'+id);
    if(el) el.style.display = id===v ? 'block' : 'none';
  });
  document.querySelectorAll('#sbp-arch .nr').forEach(b => b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  const tt = {arch:'시스템 아키텍처', sheet:'구글시트 연동 구조', flow:'업무 플로우'};
  const ttlEl = document.getElementById('arch-ttl');
  if(ttlEl) ttlEl.innerHTML = `${tt[v]} <span class="tb-s">Bloom CRM 데이터 흐름</span>`;
}

/* 설정(arch) 탭이 활성화될 때 router.js가 호출하는 초기화 훅
   (원본 6647행 switchApp의 `if(app==='arch') switchArchTab('ev');`) */
export function initArchTab(){
  switchArchTab('ev');
}

/* ══════════════════════════════════════════
   window 노출 — 생성된 HTML의 인라인 onclick/ondragstart/ondrop/
   onkeydown/oninput 핸들러가 문자열로 이 함수들을 호출하므로,
   ES 모듈 스코프 밖(전역)에서도 찾을 수 있도록 명시적으로 등록한다.
══════════════════════════════════════════ */
window.normalizeAllCountries = normalizeAllCountries;
window.renderCleanCounts = renderCleanCounts;
window.splitMixedOrgNames    = splitMixedOrgNames;
window.switchArchTab         = switchArchTab;
window.switchAV              = switchAV;


/* 전시 탭의 DUE_STEPS와 같은 이름표 — 그쪽을 import하면 순환 참조가 된다 */
/* exh-tab.js의 DUE_STEPS와 같은 키·같은 순서여야 한다 — 여기 빠진 키는 설정에서
   저장할 때 지워졌다(부스 도면·기본 시공). 서로 import하면 순환이 생겨 따로 둔다. */
export const DUE_LABEL = {
  'manual_replied_at': '매뉴얼 회신', 'app_received_at': '신청서', 'booth_confirmed_at': '부스',
  'calc:design': '부스 도면', 'calc:payment': '입금', 'calc:graphic': '그래픽', 'calc:base': '기본 시공',
  'directory_received_at': '도록', 'movein_at': '반입',
};

/* «선택 목록·부스 기본 제공·업로드 표기·행사별 설정 요약»은 ../features/settings/code-lists.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */