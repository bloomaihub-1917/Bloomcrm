/* ══════════════════════════════════════════════════════════════
   features/upload/upload-event-select.js — 업로드 화면의 연결 행사 고르기
   (modules/upload-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { COMPANY_SECTORS, EVENT_LIST, ORG_KINDS, PART_TYPES } from '../../state.js';
import { escapeHtml } from '../../utils.js';
import { uploadUi } from './upload-ui.js';
import { renderCategoryMappingUI } from '../../modules/upload-tab.js';

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

  /* 기업 유형 — 설정 › 선택 목록 › 기업 종류(org_kind)를 그대로 쓴다.
     여기 목록을 코드에 박아 두면 설정에서 유형을 하나 늘려도 업로드 화면만
     옛 목록을 들고 있어, 새 유형으로 들어와야 할 기업이 조용히 기본값으로
     떨어진다. ORG_KINDS는 applyCodeLists()가 내용만 갈아끼우므로 그때그때 읽는다. */
  const kindSel = document.getElementById('up-kind');
  if(kindSel){
    const cur = kindSel.value;
    kindSel.innerHTML = '<option value="">잠재고객사 (기본)</option>' +
      ORG_KINDS.map(k =>
        `<option value="${escapeHtml(k.key)}"${k.key===cur?' selected':''}>${escapeHtml(k.label)}</option>`
      ).join('');
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
  uploadUi.evDirectMode = forceOn !== undefined ? forceOn : !uploadUi.evDirectMode;
  const sel  = document.getElementById('up-ev');
  const inp  = document.getElementById('up-ev-text');
  const btn  = document.getElementById('up-ev-toggle');
  if(!sel || !inp) return;
  if(uploadUi.evDirectMode){
    sel.style.display = 'none';
    inp.style.display = 'block';
    inp.focus();
    if(btn) btn.textContent = '목록에서 선택';
  } else {
    sel.style.display = 'block';
    inp.style.display = 'none';
    if(btn) btn.textContent = '직접 입력';
    // 드롭다운에서 "직접입력…" 선택하면 자동 전환.
    // 행사가 바뀌면 카테고리 매핑 UI를 다시 그려 그 행사의 저장된 매핑을 preselect.
    sel.onchange = () => {
      if(sel.value === '__direct__'){ toggleEvInput(true); return; }
      renderCategoryMappingUI();
    };
  }
}


/* 화면의 onclick이 부르는 것 */
window.toggleEvInput          = toggleEvInput;
window.populateUploadEvDropdown = populateUploadEvDropdown;
