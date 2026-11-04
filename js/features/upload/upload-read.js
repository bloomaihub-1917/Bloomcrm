/* ══════════════════════════════════════════════════════════════
   features/upload/upload-read.js — 업로드 STEP 1 — 파일 읽기와 파일명으로 카테고리 짐작
   (modules/upload-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { CL } from '../../constants.js';
import { aiLogs, detectedCatFromFilename, setAiStep, setDetectedCatFromFilename, setUploadedFileName } from '../../state.js';
import { escapeHtml, td } from '../../utils.js';
import { uploadUi } from './upload-ui.js';
import { addAiLog, runHeaderStep } from '../../modules/upload-tab.js';

/* ═══════════════════════════════════════
   STEP 1 — 업로드: 파일 읽기 + 파일명 카테고리 추정 (원본 2243~2320행)
═══════════════════════════════════════ */

/* 파일명 → 카테고리 자동 추정용 힌트 (원본 2350~2359행) */
const FILENAME_CATEGORY_HINTS = {
  speaker: ['연사','강연자','발표자','speaker','speakers','presenter'],
  // cat은 speaker/vip/attendee 3분류만 쓰므로, 스폰서/투자자/바이어/BD/전시/기자
  // 관련 파일명 힌트는 전부 attendee(일반참가자)로 모은다(각 힌트 키워드 자체는
  // 그대로 유지 — 파일명 인식 정확도는 그대로, 결과 카테고리만 단순화됨).
  attendee: [
    '스폰서','후원','협찬','sponsor','sponsors','sponsorship',
    '투자자','투자','vc','investor','investors','funding',
    '바이어','구매','buyer','buyers','procurement',
    'bd','사업개발','파트너십','partnership','partner',
    '전시','부스','exhibitor','exhibitors','booth',
    '기자','언론','미디어','취재','press','media','journalist','reporter',
  ],
};
// 카테고리 한글 라벨은 constants.js의 CL(참가 역할 라벨)과 값이 완전히 동일해
// 별도 상수(CAT_LABEL_KR)로 중복 정의하지 않고 CL을 그대로 가져다 쓴다.

function guessCategoryFromFilename(filename){
  const base = filename.replace(/\.[^.]+$/, '');
  const norm = base.toLowerCase().replace(/[\s_\-()[\]]/g, '');
  for(const cat in FILENAME_CATEGORY_HINTS){
    for(const hint of FILENAME_CATEGORY_HINTS[cat]){
      const h = hint.toLowerCase().replace(/[\s_\-]/g, '');
      if(norm.includes(h)) return cat;
    }
  }
  return null;
}

/* input[type=file] onchange (원본 2243행) */
export function handleFileSelect(e){
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  runUploadStep(file);
}

/* drop-zone ondrop (원본 2248행) */
export function handleFileDrop(e){
  e.preventDefault();
  e.currentTarget.style.borderColor = '';
  e.currentTarget.style.background = '';
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if(!file) return;
  const fi = document.getElementById('file-input');
  if(fi){
    const dt = new DataTransfer();
    dt.items.add(file);
    fi.files = dt.files;
  }
  runUploadStep(file);
}

/* STEP 1 본체 (원본 startFileParsing, 2266~2320행) */
export function runUploadStep(file){
  setAiStep(1);
  setUploadedFileName(file.name);
  const dzName = document.getElementById('dz-filename');
  if(dzName) dzName.textContent = '📄 ' + file.name; // textContent라 이스케이프 불필요

  const log = document.getElementById('ai-log');
  if(log){ log.innerHTML = ''; log.style.display = 'block'; }
  aiLogs.length = 0;
  const upBtns = document.getElementById('up-btns');
  if(upBtns) upBtns.style.display = 'none';
  const mergeWrap = document.getElementById('merge-wrap');
  if(mergeWrap) mergeWrap.innerHTML = '';
  uploadUi.coNew = []; uploadUi.coPairs = [];
  const prevEl = document.getElementById('parser-prev');
  if(prevEl) prevEl.innerHTML =
    '<tr><td colspan="4" style="padding:18px;text-align:center;color:var(--i4);font-size:var(--fs-11)">파일을 분석하고 있어요…</td></tr>';

  addAiLog('info', '1단계: 파일 업로드 — ' + escapeHtml(file.name) + ' 읽는 중 (' + (file.size/1024/1024).toFixed(2) + 'MB)…');

  // ── 파일명에서 카테고리 추정 (원본 2282~2290행) ──
  setDetectedCatFromFilename(guessCategoryFromFilename(file.name));
  if(detectedCatFromFilename){
    addAiLog('ok', '파일명에서 카테고리 감지: <b>' + escapeHtml(CL[detectedCatFromFilename] || detectedCatFromFilename) + '</b> ("' + escapeHtml(file.name) + '")');
    const catSel = document.getElementById('up-cat');
    if(catSel) catSel.value = detectedCatFromFilename;
  } else {
    addAiLog('info', '파일명에서 카테고리를 추정하지 못했어요 — 컬럼 데이터로 분류해요');
  }

  const ext = file.name.split('.').pop().toLowerCase();

  if(ext === 'csv'){
    const reader = new FileReader();
    reader.onload = (ev) => {
      try{
        const wb = XLSX.read(ev.target.result, { type:'string', cellText:true });
        runHeaderStep(wb);
      }catch(err){
        addAiLog('warn', 'CSV 파싱 오류: ' + escapeHtml(err.message));
        console.error('[upload-tab] CSV 파싱 오류:', err);
      }
    };
    reader.readAsText(file, 'utf-8');
  } else if(ext === 'xlsx' || ext === 'xls'){
    const reader = new FileReader();
    reader.onload = (ev) => {
      try{
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type:'array', cellText:true, cellDates:true });
        runHeaderStep(wb);
      }catch(err){
        addAiLog('warn', 'Excel 파싱 오류: ' + escapeHtml(err.message));
        console.error('[upload-tab] Excel 파싱 오류:', err);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    addAiLog('warn', '지원하지 않는 파일 형식이에요 (.xlsx, .xls, .csv만 가능)');
  }
}


/* 화면의 onclick이 부르는 것 */
window.handleFileSelect       = handleFileSelect;
window.handleFileDrop         = handleFileDrop;
