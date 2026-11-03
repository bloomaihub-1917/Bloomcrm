/* ══════════════════════════════════════════════════════════════
   features/settings/sector-add-main.js — 설정 › 새 메인 섹터 추가
   (modules/settings-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { upsertSectorRow } from '../../api.js';
import { buildCoCAT } from '../../modules/company-tab.js';
import { COMPANY_SECTORS } from '../../state.js';
import { scopedSectorName, sectorKey, slugifySectorName } from '../../utils.js';
import { populateUploadEvDropdown } from '../upload/upload-event-select.js';
import { settingsUi } from './settings-ui.js';
import { renderSectorList } from './taxonomy.js';

/* ══════════════════════════════════════════
   새 메인 섹터 추가 (원본 4119~4135행)
══════════════════════════════════════════ */
export async function addMainSector(){
  const inp = document.getElementById('sector-main-add-input');
  const raw = inp ? inp.value.trim() : '';
  if(!raw){ inp && inp.focus(); return; }

  // 선택된 행사 범위(_sectorScope)가 있으면 그 행사 전용 섹터로 접두어를 붙인다
  const val = scopedSectorName(settingsUi.sectorScope, raw);
  const exists = COMPANY_SECTORS.some(s => sectorKey(typeof s==='string'?s:s.name) === sectorKey(val));
  if(exists){ alert('이미 있는 섹터예요.'); return; }

  const newId = slugifySectorName(val);
  const sector = { id: newId, name: val, parent: null, domain: '', canonical: '' };

  COMPANY_SECTORS.push(sector);
  if(inp) inp.value = '';
  renderSectorList();
  try { buildCoCAT(); populateUploadEvDropdown(); } catch(e){}
  await upsertSectorRow(sector);
}

/* «설정 › 엑셀로 섹터 일괄 추가»은 ../features/settings/sector-import.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */

/* 화면의 onclick이 부르는 것 */
window.addMainSector         = addMainSector;
