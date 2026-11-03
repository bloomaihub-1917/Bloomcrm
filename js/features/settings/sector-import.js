/* ══════════════════════════════════════════════════════════════
   features/settings/sector-import.js — 설정 › 엑셀로 섹터 일괄 추가
   (modules/settings-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { upsertSectorRow } from '../../api/settings-save.js';
import { buildCoCAT } from '../../modules/company-tab.js';
import { COMPANY_SECTORS } from '../../state.js';
import { escapeHtml, parseSectorScope, scopedSectorName, sectorKey, slugifySectorName } from '../../utils.js';
import { populateUploadEvDropdown } from '../upload/upload-event-select.js';
import { settingsUi } from './settings-ui.js';
import { renderSectorList } from './taxonomy.js';

/* ══════════════════════════════════════════
   엑셀로 섹터 일괄 추가 (신규 — 원본에는 없던 기능)
   "메인섹터"/"서브섹터" 2컬럼 엑셀을 업로드하면, 지금 선택된 범위(_sectorScope)에
   메인·서브 섹터를 한 번에 만든다. 미리보기 → 확정 2단계로 진행해서
   실수로 잘못된 파일을 그대로 반영하지 않게 한다.
══════════════════════════════════════════ */
const SECTOR_COL_ALIASES = {
  main: ['메인섹터','메인 섹터','대분류','메인','main','mainsector','main sector','maincategory','main category'],
  sub:  ['서브섹터','서브 섹터','소분류','서브','sub','subsector','sub sector','subcategory','sub category'],
};

function guessSectorColumn(headers, aliases){
  const norm = h => String(h).toLowerCase().replace(/[\s_\-\/().·,]/g,'');
  for(const h of headers){
    if(aliases.some(a => norm(h) === norm(a))) return h;
  }
  for(const h of headers){
    if(aliases.some(a => norm(a).length >= 3 && norm(h).includes(norm(a)))) return h;
  }
  return null;
}


export function handleSectorFileSelect(e){
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  const nameEl = document.getElementById('sector-file-name');
  if(nameEl) nameEl.textContent = file.name;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const wb = XLSX.read(ev.target.result, { type:'array', cellText:true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval:'', raw:false });
      if(!rows.length){ renderSectorImportPreview(null, '빈 파일이거나 데이터를 읽을 수 없어요.'); return; }

      const headers = Object.keys(rows[0]);
      const mainCol = guessSectorColumn(headers, SECTOR_COL_ALIASES.main);
      const subCol  = guessSectorColumn(headers, SECTOR_COL_ALIASES.sub);
      if(!mainCol){
        renderSectorImportPreview(null, `"메인섹터" 컬럼을 찾지 못했어요. 파일 헤더: ${headers.join(', ')}`);
        return;
      }

      const groupsMap = new Map();
      rows.forEach(r => {
        const main = String(r[mainCol]||'').trim();
        const sub  = subCol ? String(r[subCol]||'').trim() : '';
        if(!main) return;
        if(!groupsMap.has(main)) groupsMap.set(main, new Set());
        if(sub) groupsMap.get(main).add(sub);
      });
      const groups = [...groupsMap.entries()].map(([main, subsSet]) => ({ main, subs: [...subsSet] }));
      if(!groups.length){
        renderSectorImportPreview(null, '유효한 메인섹터 값을 찾지 못했어요.');
        return;
      }

      settingsUi.pendingSectorImport = { groups };
      renderSectorImportPreview(groups);
    } catch(err){
      console.warn('[settings-tab] 섹터 파일 파싱 실패:', err);
      renderSectorImportPreview(null, '파일을 읽는 중 오류가 발생했어요: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderSectorImportPreview(groups, errorMsg){
  const el = document.getElementById('sector-import-preview');
  if(!el) return;
  if(errorMsg){
    el.innerHTML = `<div style="font-size:12px;color:var(--re)">${escapeHtml(errorMsg)}</div>`;
    return;
  }
  if(!groups){ el.innerHTML = ''; return; }

  const totalSubs = groups.reduce((n,g) => n + g.subs.length, 0);
  const scopeLabel = settingsUi.sectorScope ? `"${settingsUi.sectorScope}" 전용` : '"공통"';
  el.innerHTML = `
    <div style="font-size:12px;color:var(--i2);margin-bottom:8px">
      메인 섹터 <b>${groups.length}개</b>, 서브 섹터 <b>${totalSubs}개</b>를 ${escapeHtml(scopeLabel)} 범위에 추가합니다.
    </div>
    <div style="max-height:180px;overflow-y:auto;border:1px solid var(--i6);border-radius:6px;padding:8px 10px;background:var(--W);margin-bottom:10px">
      ${groups.map(g => `
        <div style="margin-bottom:6px">
          <div style="font-size:12px;font-weight:700;color:var(--i1)">${escapeHtml(g.main)}</div>
          ${g.subs.length ? `<div style="font-size:11px;color:var(--i4);padding-left:12px">${g.subs.map(escapeHtml).join(', ')}</div>` : ''}
        </div>`).join('')}
    </div>
    <div style="display:flex;gap:6px">
      <button class="btn bp" style="font-size:11px" onclick="confirmSectorImport()">이대로 추가</button>
      <button class="btn bs" style="font-size:11px" onclick="cancelSectorImport()">취소</button>
    </div>`;
}

export function cancelSectorImport(){
  settingsUi.pendingSectorImport = null;
  const el = document.getElementById('sector-import-preview');
  if(el) el.innerHTML = '';
  const inp = document.getElementById('sector-file-input');
  if(inp) inp.value = '';
  const nameEl = document.getElementById('sector-file-name');
  if(nameEl) nameEl.textContent = '';
}

export async function confirmSectorImport(){
  if(!settingsUi.pendingSectorImport) return;
  const { groups } = settingsUi.pendingSectorImport;

  let addedMain = 0, addedSub = 0, skippedMain = 0, skippedSub = 0;

  for(const g of groups){
    const mainName = scopedSectorName(settingsUi.sectorScope, g.main);
    let mainSector = COMPANY_SECTORS.find(s => sectorKey(s.name) === sectorKey(mainName) && !s.parent);
    if(!mainSector){
      mainSector = { id: slugifySectorName(mainName), name: mainName, parent: null, domain: '', canonical: '' };
      COMPANY_SECTORS.push(mainSector);
      addedMain++;
      await upsertSectorRow(mainSector);
    } else {
      skippedMain++;
    }

    for(const subRaw of g.subs){
      // 여러 메인 섹터에 같은 서브섹터명(예: "Others")이 반복될 수 있어서,
      // 이미 다른 메인 아래 같은 이름이 있으면 메인명을 붙여 구분한다.
      const collidesElsewhere = COMPANY_SECTORS.some(s =>
        s.parent && s.parent !== mainSector.id && sectorKey(parseSectorScope(s.name).plainName) === sectorKey(subRaw)
      );
      const subPlain = collidesElsewhere ? `${subRaw} (${g.main})` : subRaw;
      const subName = scopedSectorName(settingsUi.sectorScope, subPlain);

      const exists = COMPANY_SECTORS.some(s => s.parent === mainSector.id && sectorKey(s.name) === sectorKey(subName));
      if(exists){ skippedSub++; continue; }

      const subSector = { id: slugifySectorName(subName), name: subName, parent: mainSector.id, domain: '', canonical: '' };
      COMPANY_SECTORS.push(subSector);
      addedSub++;
      await upsertSectorRow(subSector);
    }
  }

  cancelSectorImport();
  renderSectorList();
  try { buildCoCAT(); populateUploadEvDropdown(); } catch(e){}

  alert(`섹터 추가 완료 — 메인 ${addedMain}개(중복 ${skippedMain}개 건너뜀), 서브 ${addedSub}개(중복 ${skippedSub}개 건너뜀)`);
}


/* 화면의 onclick이 부르는 것 */
window.handleSectorFileSelect = handleSectorFileSelect;
window.confirmSectorImport    = confirmSectorImport;
window.cancelSectorImport     = cancelSectorImport;
