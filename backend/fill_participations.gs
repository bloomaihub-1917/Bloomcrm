// ══════════════════════════════════════════
//  fill_participations.gs
//  participations 시트 참조 컬럼 자동 채우기
//
//  최종 컬럼 구조:
//  A: id
//  B: ev_id      C: 행사명(참조, 자동)
//  D: cid        E: 소속(참조, 자동)   F: 성명(참조, 자동)   G: 직함(참조, 자동)
//  H: type       ← 참가 유형 (VIP/연사/BD/바이어/전시참가기업/스폰서/비즈니스파트너링/주최사)
//  I: note
//  J: matched
//
//  사용법:
//  1) Apps Script 에디터에 이 파일 추가
//  2) installTrigger() 1회 실행 → 자동 트리거 등록
//  3) fillAllParticipations() 실행 → 기존 데이터 전체 채우기
// ══════════════════════════════════════════

const P_COL = {
  id:       1,  // A
  ev_id:    2,  // B
  ev_name:  3,  // C ← 자동
  cid:      4,  // D
  org:      5,  // E ← 자동
  name:     6,  // F ← 자동
  title:    7,  // G ← 자동
  type:     8,  // H
  note:     9,  // I
  matched:  10, // J
};

const TYPE_OPTIONS = [
  'VIP','연사','BD','바이어','전시참가기업',
  '스폰서','비즈니스파트너링','주최사','참가자','기타',
];

// ── 헤더 설정 ──
function ensureHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('participations');
  if (!sh) return;

  // 현재 헤더 확인
  const lastCol = Math.max(sh.getLastColumn(), 10);
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];

  const required = {
    [P_COL.id]:      'id',
    [P_COL.ev_id]:   'ev_id',
    [P_COL.ev_name]: '행사명',
    [P_COL.cid]:     'cid',
    [P_COL.org]:     '소속',
    [P_COL.name]:    '성명',
    [P_COL.title]:   '직함',
    [P_COL.type]:    'type',
    [P_COL.note]:    'note',
    [P_COL.matched]: 'matched',
  };

  Object.entries(required).forEach(([col, label]) => {
    const idx = +col - 1;
    if (headers[idx] !== label) {
      const cell = sh.getRange(1, +col);
      cell.setValue(label).setFontWeight('bold');
      // 자동 참조 컬럼은 파란색, 데이터 컬럼은 기본
      if ([P_COL.ev_name, P_COL.org, P_COL.name, P_COL.title].includes(+col)) {
        cell.setBackground('#E8F0FE').setFontColor('#1A73E8');
      } else {
        cell.setBackground('#F8F9FA').setFontColor('#202124');
      }
    }
  });

  // type 컬럼에 드롭다운 유효성 검사
  if (sh.getLastRow() > 1) {
    const typeRange = sh.getRange(2, P_COL.type, sh.getMaxRows() - 1, 1);
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(TYPE_OPTIONS, true)
      .setAllowInvalid(true)
      .build();
    typeRange.setDataValidation(rule);
  }

  Logger.log('헤더 설정 완료');
}

// ── 캐시 빌드 ──
function buildCache() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // contacts 캐시
  const csh    = ss.getSheetByName('contacts');
  const cCache = {};
  if (csh && csh.getLastRow() > 1) {
    const ch    = csh.getRange(1,1,1,csh.getLastColumn()).getValues()[0].map(String);
    const cData = csh.getRange(2,1,csh.getLastRow()-1,csh.getLastColumn()).getValues();
    const f = (arr, key) => arr.indexOf(key);
    const idIdx     = f(ch,'id');
    const nameKoIdx = f(ch,'nameKo');
    const nameEnIdx = f(ch,'nameEn');
    const orgKoIdx  = f(ch,'orgKo');
    const orgEnIdx  = f(ch,'orgEn');
    const titleIdx  = f(ch,'titleKo');
    cData.forEach(r => {
      const id = String(r[idIdx]||'').trim();
      if (!id) return;
      cCache[id] = {
        org:   String(r[orgKoIdx]  || r[orgEnIdx]  || '').trim(),
        name:  String(r[nameKoIdx] || r[nameEnIdx] || '').trim(),
        title: String(r[titleIdx]  || '').trim(),
      };
    });
  }

  // events 캐시
  const esh    = ss.getSheetByName('events');
  const eCache = {};
  if (esh && esh.getLastRow() > 1) {
    const eh    = esh.getRange(1,1,1,esh.getLastColumn()).getValues()[0].map(String);
    const eData = esh.getRange(2,1,esh.getLastRow()-1,esh.getLastColumn()).getValues();
    const eIdIdx   = eh.indexOf('id');
    const eNameIdx = eh.indexOf('name');
    eData.forEach(r => {
      const id = String(r[eIdIdx]||'').trim();
      if (!id) return;
      eCache[id] = String(r[eNameIdx]||id).trim();
    });
  }

  return { cCache, eCache };
}

// ── 단일 행 참조 채우기 ──
function fillRow(sh, rowNum, ev_id, cid, cache) {
  const evName  = cache.eCache[ev_id] || ev_id || '';
  const contact = cid ? cache.cCache[String(cid).trim()] : null;

  sh.getRange(rowNum, P_COL.ev_name).setValue(evName)
    .setBackground('#EAF1FB').setFontColor('#1A73E8').setFontStyle('italic');

  if (contact) {
    sh.getRange(rowNum, P_COL.org)  .setValue(contact.org)  .setBackground('#EAF1FB').setFontColor('#1A73E8').setFontStyle('italic');
    sh.getRange(rowNum, P_COL.name) .setValue(contact.name) .setBackground('#EAF1FB').setFontColor('#1A73E8').setFontStyle('italic');
    sh.getRange(rowNum, P_COL.title).setValue(contact.title).setBackground('#EAF1FB').setFontColor('#1A73E8').setFontStyle('italic');
  }
}

// ══════════════════════════════════════════
//  전체 채우기 — 수동 실행
// ══════════════════════════════════════════
function fillAllParticipations() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('participations');
  if (!sh) { Logger.log('participations 시트 없음'); return; }

  ensureHeaders();
  const cache   = buildCache();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) { Logger.log('데이터 없음'); return; }

  // 기존 컬럼 구조 확인 (email/phone 제거 여부)
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  Logger.log('현재 헤더: ' + headers.join(', '));

  const data = sh.getRange(2, 1, lastRow-1, Math.max(sh.getLastColumn(), P_COL.cid)).getValues();
  let count = 0;

  data.forEach((row, i) => {
    const rowNum = i + 2;
    const ev_id  = String(row[P_COL.ev_id - 1] || '').trim();
    const cid    = String(row[P_COL.cid  - 1] || '').trim();
    if (!ev_id && !cid) return;
    fillRow(sh, rowNum, ev_id, cid, cache);
    count++;
  });

  Logger.log('채우기 완료: ' + count + '행');
  SpreadsheetApp.getUi().alert('완료! ' + count + '행 업데이트');
}

// ══════════════════════════════════════════
//  시트 컬럼 구조 재정비
//  기존 email/phone 컬럼 제거 후 새 구조로 재배치
//  ⚠️ 실행 전 백업 권장
// ══════════════════════════════════════════
function restructureParticipations() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('participations');
  if (!sh) { Logger.log('시트 없음'); return; }

  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    '⚠️ participations 시트 구조 재정비',
    '기존 email/phone 컬럼을 제거하고 새 구조로 재배치합니다.\n반드시 백업 후 실행하세요.\n\n계속하시겠습니까?',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  const lastRow = sh.getLastRow();
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  Logger.log('기존 헤더: ' + headers.join(', '));

  // 기존 데이터 읽기
  const allData = lastRow > 1
    ? sh.getRange(2,1,lastRow-1,headers.length).getValues()
    : [];

  // 기존 컬럼 인덱스 파악
  const old = {
    id:      headers.indexOf('id'),
    ev_id:   headers.indexOf('ev_id') >= 0 ? headers.indexOf('ev_id') : headers.indexOf('ev'),
    cid:     headers.indexOf('cid'),
    type:    headers.indexOf('type') >= 0 ? headers.indexOf('type') : headers.indexOf('role'),
    note:    headers.indexOf('note'),
    matched: headers.indexOf('matched'),
  };

  // 새 구조로 재배치
  const newRows = allData.map(r => {
    const get = (idx) => idx >= 0 ? String(r[idx]||'').trim() : '';
    return [
      get(old.id),        // A: id
      get(old.ev_id),     // B: ev_id
      '',                 // C: 행사명 (자동)
      get(old.cid),       // D: cid
      '',                 // E: 소속 (자동)
      '',                 // F: 성명 (자동)
      '',                 // G: 직함 (자동)
      get(old.type),      // H: type
      get(old.note),      // I: note
      get(old.matched),   // J: matched
    ];
  });

  // 시트 초기화 후 재작성
  sh.clearContents();
  sh.clearFormats();

  // 헤더 쓰기
  const headerRow = ['id','ev_id','행사명','cid','소속','성명','직함','type','note','matched'];
  sh.getRange(1,1,1,10).setValues([headerRow]).setFontWeight('bold');

  // 자동 참조 컬럼 스타일
  [3,5,6,7].forEach(col => {
    sh.getRange(1,col).setBackground('#E8F0FE').setFontColor('#1A73E8');
  });

  // 데이터 쓰기
  if (newRows.length > 0) {
    sh.getRange(2,1,newRows.length,10).setValues(newRows);
  }

  // 텍스트 형식 설정
  [1,2,4].forEach(col => {
    sh.getRange(1,col,sh.getMaxRows(),1).setNumberFormat('@');
  });

  // 참조 채우기
  ensureHeaders();
  const cache = buildCache();
  newRows.forEach((row, i) => {
    const rowNum = i + 2;
    if (!row[1] && !row[3]) return;
    fillRow(sh, rowNum, row[1], row[3], cache);
  });

  Logger.log('재정비 완료: ' + newRows.length + '행');
  ui.alert('재정비 완료! ' + newRows.length + '행');
}

// ══════════════════════════════════════════
//  onEdit 트리거
// ══════════════════════════════════════════
function onEditFillRef(e) {
  const sh = e.range.getSheet();
  if (sh.getName() !== 'participations') return;

  const row = e.range.getRow();
  const col = e.range.getColumn();
  if (row < 2) return;

  // ev_id(B=2) 또는 cid(D=4) 편집 시만
  if (col !== P_COL.ev_id && col !== P_COL.cid) return;

  const lastCol = Math.max(sh.getLastColumn(), P_COL.cid);
  const rowVals = sh.getRange(row, 1, 1, lastCol).getValues()[0];
  const ev_id   = String(rowVals[P_COL.ev_id - 1] || '').trim();
  const cid     = String(rowVals[P_COL.cid  - 1] || '').trim();
  if (!ev_id && !cid) return;

  ensureHeaders();
  fillRow(sh, row, ev_id, cid, buildCache());
}

// ══════════════════════════════════════════
//  트리거 설치 (최초 1회)
// ══════════════════════════════════════════
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onEditFillRef')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('onEditFillRef')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();

  SpreadsheetApp.getUi().alert(
    '트리거 설치 완료!\n' +
    'participations 시트에서 ev_id/cid 입력 시 행사명/소속/성명/직함이 자동으로 채워집니다.'
  );
}

// ══════════════════════════════════════════
//  기존 행에 id 일괄 생성
//  id 컬럼이 비어있는 행에만 적용
//  Apps Script 에디터에서 수동 실행
// ══════════════════════════════════════════
function fillMissingIds() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── participations 시트 ──
  const psh = ss.getSheetByName('participations');
  if (psh && psh.getLastRow() > 1) {
    const ph      = psh.getRange(1,1,1,psh.getLastColumn()).getValues()[0].map(String);
    const idIdx   = ph.indexOf('id');
    if (idIdx >= 0) {
      const lastRow = psh.getLastRow();
      const idCol   = psh.getRange(2, idIdx+1, lastRow-1, 1).getValues();
      let count = 0;
      idCol.forEach((r, i) => {
        if (!r[0]) {
          const newId = 'P-' + (new Date().getTime() + i);
          psh.getRange(i+2, idIdx+1).setNumberFormat('@').setValue(newId);
          count++;
        }
      });
      Logger.log('participations id 생성: ' + count + '건');
    }
  }

  // ── contacts 시트 ──
  const csh = ss.getSheetByName('contacts');
  if (csh && csh.getLastRow() > 1) {
    const ch    = csh.getRange(1,1,1,csh.getLastColumn()).getValues()[0].map(String);
    const idIdx = ch.indexOf('id');
    if (idIdx >= 0) {
      const lastRow = csh.getLastRow();
      const data    = csh.getRange(2, 1, lastRow-1, csh.getLastColumn()).getValues();
      let count = 0;
      data.forEach((r, i) => {
        // id 없고 다른 데이터가 있는 행만
        const hasData = r.some((v, j) => j !== idIdx && v !== '' && v !== null);
        if (!r[idIdx] && hasData) {
          const newId = String(new Date().getTime() + i * 7 + Math.floor(Math.random()*999));
          csh.getRange(i+2, idIdx+1).setNumberFormat('@').setValue(newId);
          count++;
        }
      });
      Logger.log('contacts id 생성: ' + count + '건');
    }
  }

  SpreadsheetApp.getUi().alert(
    'id 생성 완료!\n' +
    '자세한 내용은 Apps Script 실행 로그를 확인하세요.'
  );
}

// ── contacts 시트만 id 생성 (단독 실행용) ──
function fillContactIds() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const csh = ss.getSheetByName('contacts');
  if (!csh || csh.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('contacts 시트가 없거나 데이터가 없습니다.');
    return;
  }

  const ch    = csh.getRange(1,1,1,csh.getLastColumn()).getValues()[0].map(String);
  const idIdx = ch.indexOf('id');
  if (idIdx < 0) {
    SpreadsheetApp.getUi().alert('id 컬럼을 찾을 수 없습니다.');
    return;
  }

  const lastRow = csh.getLastRow();
  const data    = csh.getRange(2, 1, lastRow-1, csh.getLastColumn()).getValues();
  let count = 0;

  data.forEach((r, i) => {
    const hasData = r.some((v, j) => j !== idIdx && v !== '' && v !== null);
    if (!r[idIdx] && hasData) {
      const newId = String(new Date().getTime() + i * 13 + Math.floor(Math.random()*9999));
      csh.getRange(i+2, idIdx+1).setNumberFormat('@').setValue(newId);
      count++;
      Utilities.sleep(1); // id 중복 방지
    }
  });

  Logger.log('contacts id 생성: ' + count + '건');
  SpreadsheetApp.getUi().alert('완료! contacts ' + count + '행에 id를 생성했습니다.');
}
