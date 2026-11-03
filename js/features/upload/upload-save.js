/* ══════════════════════════════════════════════════════════════
   features/upload/upload-save.js — 업로드 STEP 4 — 의심 케이스 확인과 마스터DB 반영
   (modules/upload-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { postToSheet } from '../../api.js';
import { saveCatmap } from '../../api/settings-save.js';
import { trackAction } from '../../core/audit-log.js';
import { buildCoDB } from '../../domain/co-db.js';
import { batchUpsertCompanies } from '../../domain/org-save.js';
import { ensureOrgsForNames, orgIdForName } from '../../domain/orgs.js';
import { buildCoCAT } from '../../modules/company-tab.js';
import { buildMDBEvList, renderMDB } from '../../modules/db-tab.js';
import { API_BASE_URL, CATMAPS, COMPANY_SECTORS, CO_DB, EVENT_LIST, aiLogs, contacts, currentUser, getContactById, getOrgById, mappedContacts, parsedRows, parserPrev, participations, setAiStep, setDetectedCatFromFilename, setUploadedFileName, uploadedFileName } from '../../state.js';
import { escapeHtml, scopedSectorName, sectorKey, sectorRowValues, slugifySectorName, td } from '../../utils.js';
import { uploadUi } from './upload-ui.js';
import { COMPANY_FILL, _orgOnlyRows, addAiLog, callHook, collectCatMapFromUI, companyInfoOf, genContactId } from '../../modules/upload-tab.js';

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
  const selectedEv = (uploadUi.evDirectMode && _evInp && _evInp.value.trim())
    ? _evInp.value.trim()
    : (_evSel && _evSel.value !== '__direct__' ? _evSel.value : '');
  const selectedRole   = (document.getElementById('up-ev-role') ||{}).value || '참가자';
  const selectedSector = (document.getElementById('up-sector')  ||{}).value || '';
  /* 이 파일이 어느 쪽 명단인지 — 셀러(벤더시공사)냐 발주처(잠재고객사)냐.
     비워 두면 ensureOrgsForNames가 예전처럼 '잠재고객사'로 넣는다. */
  const selectedKind   = (document.getElementById('up-kind')    ||{}).value || '';
  console.log('[upload-tab] 업로드 확정 — selectedEv:', JSON.stringify(selectedEv),
    '| _evDirectMode:', uploadUi.evDirectMode, '| up-ev.value:', _evSel && _evSel.value,
    '| up-ev-text.value:', _evInp && _evInp.value);

  // ── 카테고리 값별 매핑 수집 (토글 off이면 null → 기존 일괄 방식) ──
  const catSel = collectCatMapFromUI();
  if(catSel && catSel.newVals.length){
    // "새 행사 섹터로 생성" — 연락처 저장 전에 섹터부터 만들어야
    // beat가 존재하지 않는 섹터명을 가리키지 않는다
    const evShortName = (EVENT_LIST.find(e => e.key === selectedEv)||{}).short || selectedEv;
    if(!evShortName){
      alert('새 행사 섹터 생성은 연결 행사를 선택했을 때만 가능해요.');
      if(btn){ btn.disabled = false; btn.textContent = 'DB에 추가'; }
      return;
    }
    const created = [];
    catSel.newVals.forEach(v => {
      const name = scopedSectorName(evShortName, v);
      let s = COMPANY_SECTORS.find(x => sectorKey(x.name) === sectorKey(name));
      if(!s){
        s = { id: slugifySectorName(name), name, parent: null, domain: '', canonical: '' };
        COMPANY_SECTORS.push(s);
        created.push(s);
      }
      catSel.map[v] = name;
    });
    if(created.length){
      const rSec = await postToSheet({
        sheet: 'sectors', action: 'batchUpsert',
        rows: created.map(sectorRowValues),
      }, '행사 섹터 생성');
      if(!rSec.ok){
        created.forEach(s => {
          const i = COMPANY_SECTORS.findIndex(x => x.id === s.id);
          if(i >= 0) COMPANY_SECTORS.splice(i, 1);
        });
        alert('행사 섹터 생성 저장에 실패해서 업로드를 중단했어요. 다시 시도해주세요.');
        if(btn){ btn.disabled = false; btn.textContent = 'DB에 추가'; }
        return;
      }
      addAiLog('ok', '행사 섹터 ' + created.length + '개 생성: ' + created.map(s=>s.name).join(', '));
    }
  }

  // 1) 화면(Master DB)에 즉시 반영 — 중복 id 방지
  const newParts = [];
  const touchedCompanyKeys = new Set(); // 이번 업로드에 등장한 회사(원문 표기) — 기업 마스터에 최초 저장 대상 확인용
  const existingIds = new Set(contacts.map(c => c.id));
  const addedContacts = []; // 시트 저장 실패 시 롤백용
  newRows.forEach(r => {
    const { _dup, _suspect, _suspectId, _suspectName, _suspectOrg, _suspectEmail, _companyWebsite, _companyNote, _companyIntro, ...clean } = r;
    if(existingIds.has(clean.id)){
      // 이제 genContactId()로 세션 내 충돌은 없지만, 만에 하나 걸리면 조용히 버리지 않고 알린다
      addAiLog('warn', 'id 충돌로 1건 스킵: ' + (clean.nameKo||clean.nameEn||clean.id));
      console.warn('[upload-tab] id 충돌 스킵:', clean.id, clean.nameKo||clean.nameEn);
      return;
    }
    existingIds.add(clean.id);
    addedContacts.push(clean);
    // 기업 카테고리(sector) → beat 저장:
    // 값별 매핑이 켜져 있으면 컬럼 원문값을 매핑된 섹터명으로 치환('|' 복수값 개별 처리,
    // 미매핑 값은 원문 유지), 꺼져 있으면 기존처럼 일괄 선택값 적용
    if(catSel){
      clean.beat = String(clean.beat||'').split('|').map(v=>v.trim()).filter(Boolean)
        .map(v => (v in catSel.map) ? catSel.map[v] : v)   // 빈 값으로 정한 것은 버린다
        .filter(Boolean).join('|');
      if(!clean.beat && selectedSector) clean.beat = selectedSector; // 컬럼 값이 빈 행은 일괄값으로 보충
    } else if(selectedSector){
      clean.beat = selectedSector;
    }
    contacts.push(clean);

    const coKey = (clean.orgKo || clean.orgEn || '').trim();
    if(coKey) touchedCompanyKeys.add(coKey);

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
    // 확인창에서 «동일 인물»로 고른 줄은 그때 가리킨 사람이 정답이다 — 이름+기업으로
    // 다시 찾으면 동명이인이나 소속이 바뀐 사람에게서 엇나간다.
    const existing = (r._suspectId != null && getContactById(r._suspectId))
      // 중복 판정(email1·email2 둘 다 본다)과 같은 기준으로 찾는다 — email1만 보면 기존 사람의
      // email2로 들어온 줄이 «중복»으로 걸러지고도 행사가 안 붙었다
      || (email && contacts.find(c => [c.email1, c.email2].some(e => e && String(e).toLowerCase() === email)))
      // 빈 칸끼리는 같다고 보지 않는다 — 영문 이름·해외 소속 줄이 국문 칸이 빈 아무 연락처에나 붙었다
      || (r.nameKo && contacts.find(c =>
          (c.nameKo||c.name||'') === r.nameKo &&
          (c.orgKo||c.org||'')   === (r.orgKo||'')));
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

  /* ── 새로 등장한 기업을 먼저 등록한다 ──
     기업은 더 이상 연락처에서 파생되지 않고 저장된 레코드다. 여기서 만들어
     두지 않으면 연락처만 들어오고 기업DB에서는 통째로 빠져 보인다. 등록한 뒤
     연락처마다 org_id를 붙여 이름이 아니라 id로 이어지게 한다. */
  try {
    /* 명단의 업종을 기업에도 붙인다. 전에는 연락처(beat)에만 붙어서, 명단에
       업종이 적혀 있는데도 기업DB에는 '미분류'로 들어왔다. 한 회사에서 두 사람이
       서로 다른 업종으로 들어오면 먼저 나온 값을 쓴다 — 드문 일이고, 어느 쪽도
       비워 두는 것보다는 낫다(기업DB에서 고칠 수 있다). */
    const orgSectors = new Map();
    addedContacts.forEach(c => {
      const nm = (c.orgKo || c.orgEn || '').trim();
      if(!nm || !c.beat || orgSectors.has(nm)) return;
      orgSectors.set(nm, c.beat);
    });
    // 담당자 이름이 없어 연락처는 못 만든 줄도 기업은 등록한다
    _orgOnlyRows.forEach(o => {
      if(!o.name) return;
      touchedCompanyKeys.add(o.name);
      if(o.beat && !orgSectors.has(o.name)) orgSectors.set(o.name, o.beat);
    });

    const ensured = await ensureOrgsForNames([...touchedCompanyKeys], selectedKind, orgSectors);
    if(ensured.created) addAiLog('ok', '새 기업 ' + ensured.created + '개를 등록했어요.');
    if(ensured.filled) addAiLog('ok', '업종이 비어 있던 기업 ' + ensured.filled + '곳을 명단 값으로 채웠어요.');
    addedContacts.forEach(c => { c.org_id = orgIdForName(c.orgKo || c.orgEn) || ''; });
    const unlinked = addedContacts.filter(c => (c.orgKo || c.orgEn) && !c.org_id).length;
    if(unlinked) addAiLog('warn', unlinked + '건은 기업 연결에 실패했어요 — 기업DB에서 직접 연결해주세요.');
  } catch(e){
    console.warn('[upload-tab] 기업 등록 실패:', e);
    addAiLog('warn', '기업 등록에 실패했어요 — 연락처는 저장되지만 기업DB 연결은 나중에 해야 해요.');
  }

  try {
    buildCoDB(); buildCoCAT(); renderMDB(); buildMDBEvList();
  } catch(e){ console.warn('[upload-tab] 업로드 후 화면 갱신 실패:', e); }

  // ── 기업 마스터(orgs) 저장 대상 모으기 ──
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
    // ensureOrgsForNames가 이미 만들어 뒀으므로 새로 저장할 건 없다.
    // website/note 갱신만 아래 companyUpdates에서 처리한다.
    if(getOrgById(co.key)) return;
    companiesToSave.set(co.key, co);
  });

  /* 업로드 파일의 웹사이트·메모·품목·회사소개는 소속 기업에 붙는다 — 비어 있는 칸만 채운다.
     이미 DB에 있는 사람(dupRows)과 담당자 없이 회사만 적힌 줄도 회사 정보는 같이 들어온다.
     고친 칸만 보낸다: 통째로 보내면 그 사이 남이 기업DB에서 고친 칸을 내 화면의 옛 값으로 되돌린다. */
  const filledFields = new Map(); // co.key → 채운 칸
  [...newRows, ...dupRows].map(companyInfoOf).concat(_orgOnlyRows.map(o => o.info)).forEach(u => {
    if(!u || !u.key) return;
    const co = CO_DB.find(x => x.key === u.key || x.branches?.includes(u.key) || x.nameKo === u.key || x.nameEn === u.key);
    if(!co) return;
    COMPANY_FILL.forEach(k => {
      if(!u[k] || String(co[k] || '').trim()) return;
      co[k] = u[k];
      if(!filledFields.has(co.key)) filledFields.set(co.key, new Set());
      filledFields.get(co.key).add(k);
    });
    if(filledFields.has(co.key) && !companiesToSave.has(co.key)) companiesToSave.set(co.key, co);
  });

  if(companiesToSave.size){
    // 아직 DB에 없던 기업(위 touchedCompanyKeys)은 통째로, 칸을 채운 기업은 그 칸만
    const isNew = new Set([...companiesToSave.keys()].filter(k => !getOrgById(k)));
    const savedCount = isNew.size;
    batchUpsertCompanies([...companiesToSave.values()],
      c => isNew.has(c.key) ? undefined : [...filledFields.get(c.key)])
      .catch(e => console.warn('companies 일괄 저장 실패:', e));
    if(savedCount > 0) addAiLog('ok', '기업 ' + savedCount + '개를 기업DB에 저장했어요.');
    if(filledFields.size){
      const n = k => [...filledFields.values()].filter(s => s.has(k)).length;
      const parts = [['products', '취급 품목'], ['intro', '회사소개'], ['website', '웹사이트'], ['notes', '메모']]
        .filter(([k]) => n(k)).map(([k, label]) => label + ' ' + n(k));
      addAiLog('ok', '기업 ' + filledFields.size + '곳의 빈 칸을 명단 값으로 채웠어요 — ' + parts.join(' · '));
    }
  }

  console.log('[upload-tab] 업로드 확정 — newParts.length:', newParts.length, '| API_BASE_URL:', !!API_BASE_URL, '| currentUser:', !!currentUser);

  // 2) 구글시트에 저장 (Apps Script 연동) — 여러 행을 batchAppend로 한 번에 저장해 왕복 횟수를 줄임
  // ⚠ 수정: 기존에는 응답을 확인하지 않아 저장 실패도 "저장됨"으로 표시되고,
  // 새로고침 시 업로드 내용이 통째로 사라지는 버그가 있었다. 이제 contacts
  // 저장 실패 시 화면 반영을 롤백하고 업로드 화면을 유지해 재시도할 수 있다.
  let partsSaveFailed = false;
  if(API_BASE_URL && currentUser){
    if(addedContacts.length){
      // 위치 배열 — 뒤쪽 memo1~3까지 보내려면 그 앞의 left_at/moved_to_id 자리도 채워야 한다(신규라 빈 값).
      const contactRows = addedContacts.map(r => [r.id, r.nameKo, r.nameEn, r.orgKo, r.orgEn, r.titleKo, r.titleEn, r.deptKo, r.deptEn,
            r.country, r.cat, r.lang, r.source, r.date, r.status, r.email1, r.email2, r.phone1, r.phone2,
            r.beat||'', r.products||'', r.tags||'', r.org_id||'', '', '',
            r.memo1||'', r.memo2||'', r.memo3||'', r.prefix||'']);
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
              c.beat||'', c.products||'', c.tags||'', c.org_id||'', c.left_at||'', c.moved_to_id||'',
              c.memo1||'', c.memo2||'', c.memo3||'', c.prefix||''],
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
    // 카테고리 값별 매핑을 행사별로 저장 — 같은 행사 재업로드 시 자동 적용
    if(catSel && selectedEv && Object.keys(catSel.map).length){
      CATMAPS[selectedEv] = { ...(CATMAPS[selectedEv]||{}), ...catSel.map };
      await saveCatmap(selectedEv);
      addAiLog('ok', '카테고리 매핑 ' + Object.keys(catSel.map).length + '개 저장 — 다음 업로드에 자동 적용돼요');
    }

    const evMsg = selectedEv ? ` / 행사 "${selectedEv}" ${newParts.length}건 연결` : '';
    trackAction('upload', '파일 업로드', uploadedFileName,
      '<b>' + escapeHtml(uploadedFileName) + '</b> 업로드 — 신규 ' + addedContacts.length + '건 저장' + evMsg
      + (catSel ? ' / 카테고리 매핑 적용' : '')
      + (partsSaveFailed ? ' (⚠️ 행사 연결 저장 실패)' : ''));
  } else {
    const evMsg = selectedEv ? ` / 행사 "${selectedEv}" ${newParts.length}건 연결` : '';
    trackAction('upload', '파일 업로드', uploadedFileName,
      '<b>' + escapeHtml(uploadedFileName) + '</b> 업로드 — 신규 ' + addedContacts.length + '건 반영' + evMsg + ' (서버 미연동)');
  }

  if(btn){ btn.disabled = false; }
  addAiLog('ok', '검증/저장 완료: 신규 ' + addedContacts.length + '건 Master DB 반영' + (API_BASE_URL?' (서버 저장 포함)':''));
  alert(addedContacts.length + '건이 Master DB에 추가되었어요' + (API_BASE_URL?' (서버에도 저장됨)':'')
    + (partsSaveFailed ? '\n⚠️ 단, 행사 참여 기록 저장은 실패했어요 — 감사 로그를 확인해주세요.' : ''));
  resetUpload();
  callHook('switchApp', 'mdb', document.querySelector('.atab'));
}

/* 업로드 폼 초기화 — "다시 업로드" 버튼 onclick (원본 resetUpload, 2852~2878행) */
export function resetUpload(){
  uploadUi.evDirectMode = false;
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
  const catmapWrap = document.getElementById('catmap-wrap');
  if(catmapWrap) catmapWrap.innerHTML = '';
  uploadUi.catmapOn = false;
  uploadUi.lastColMap = null;
  const upSectorEl = document.getElementById('up-sector');
  if(upSectorEl) upSectorEl.disabled = false;
  const upBtns = document.getElementById('up-btns');
  if(upBtns) upBtns.style.display = 'none';
  const prevEl = document.getElementById('parser-prev');
  if(prevEl) prevEl.innerHTML =
    '<tr><td colspan="4" style="padding:18px;text-align:center;color:var(--i4);font-size:11px">파일을 업로드하면 컬럼 매핑이 표시됩니다</td></tr>';
  parsedRows.length = 0;
  mappedContacts.length = 0;
  _orgOnlyRows.length = 0;
  parserPrev.length = 0;
  aiLogs.length = 0;
  setUploadedFileName('');
  setAiStep(0);
}


/* 화면의 onclick이 부르는 것 */
window.confirmImport          = confirmImport;
window.resetUpload            = resetUpload;
window.decideSuspect          = decideSuspect;
