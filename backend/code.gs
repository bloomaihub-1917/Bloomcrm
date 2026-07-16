// ══════════════════════════════════════════
//  Contact CRM — Apps Script
//  배포: 실행 계정 → 나 / 액세스 → 모든 사용자(익명 포함)
//
//  ※ BloomCrm-v2용 로컬 참고 사본. 기존 운영 중인 Apps Script 배포/
//  스프레드시트는 이 파일과 무관하며 그대로 유지된다. v2를 실제로
//  테스트하려면 이 파일을 별도의 새 Apps Script 프로젝트(같은 스프레드
//  시트에 새 스크립트를 붙이거나 테스트용 시트 사본에 배포)로 옮겨
//  웹앱으로 새로 배포한 뒤, 그 배포 URL을 js/state.js의 GS_URL에
//  반영해야 한다. 시트 스키마(SHEET_HEADERS)·인증(verifyUser)은
//  운영 데이터 호환을 위해 원본과 동일하게 유지했다.
// ══════════════════════════════════════════

const ALLOWED_DOMAIN = '@13100m.net';

// 사용자 자격증명은 코드에 하드코딩하지 않고 Script Properties에서 읽는다.
// 설정 방법: Apps Script 편집기 → 프로젝트 설정 → 스크립트 속성 →
//   키: CRM_USERS / 값: {"cdakyo@13100m.net":"비밀번호"}
function getUsers() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('CRM_USERS') || '{}');
  } catch (e) {
    return {};
  }
}

const SHEET_HEADERS = {
  contacts:      ['id','nameKo','nameEn','orgKo','orgEn','titleKo','titleEn','deptKo','deptEn','country','cat','lang','source','date','status','email1','email2','phone1','phone2','beat','products'],
  participations:['id','ev_id','행사명','cid','소속','성명','직함','type','note','matched'],
  events:        ['id','name','short','date_start','date_end','location','color'],
  crm_targets:   ['id','name','nameEn','sector','hq','event','role','status','priority','assignee','currentStage','lastActivity','log'],
  activity_log:  ['id','ts','email','name','type','action','target','detail'],
  settings:       ['key','value'],
  sectors:        ['id','name','parent'],
  companies:      ['key','sector','hq','website','notes','catCode','country','abbr','source','updatedAt'],
  part_types:     ['key','label','cls'],
};

const TEXT_COLUMNS = {
  contacts:      ['id','phone1','phone2'],
  participations:['id','ev_id','cid'],
  events:        ['id'],
  crm_targets:   ['id'],
  activity_log:  ['id','ts'],
};

function verifyUser(email, password) {
  if (!email || !email.endsWith(ALLOWED_DOMAIN)) return false;
  const users = getUsers();
  return !!password && users[email] === password;
}

function safeStr(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (typeof v === 'number') {
    if (!isFinite(v)) return '';
    if (v === Math.floor(v)) return v.toFixed(0);
    return parseFloat(v.toPrecision(10)).toString();
  }
  return String(v);
}

function out(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.TEXT);
}

function getOrCreateSheet(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (SHEET_HEADERS[name]) {
      sh.appendRow(SHEET_HEADERS[name]);
      applyTextFormat(sh, SHEET_HEADERS[name]);
    }
  }
  return sh;
}

function applyTextFormat(sh, headers) {
  const cols = TEXT_COLUMNS[sh.getName()] || [];
  cols.forEach(col => {
    const idx = headers.indexOf(col);
    if (idx >= 0) sh.getRange(1, idx+1, sh.getMaxRows(), 1).setNumberFormat('@');
  });
}

function applyTextFormatRow(sh, headers, rowNum, colCount) {
  const cols = TEXT_COLUMNS[sh.getName()] || [];
  cols.forEach(col => {
    const idx = headers.indexOf(col);
    if (idx >= 0 && idx < colCount) sh.getRange(rowNum, idx+1).setNumberFormat('@');
  });
}

function applyTextFormatBlock(sh, headers, startRow, numRows, colCount) {
  const cols = TEXT_COLUMNS[sh.getName()] || [];
  cols.forEach(col => {
    const idx = headers.indexOf(col);
    if (idx >= 0 && idx < colCount) sh.getRange(startRow, idx+1, numRows, 1).setNumberFormat('@');
  });
}

// ══════════════════════════════════════════
//  participations 자동 매칭 트리거
//  시트에서 직접 입력 시 id/cid/matched 자동 생성
// ══════════════════════════════════════════
function onEdit(e) {
  const sh   = e.range.getSheet();
  const name = sh.getName();

  // ── contacts 시트: id 자동 생성 (여러 행 붙여넣기도 전체 순회) ──
  if (name === 'contacts') {
    const startRow = e.range.getRow();
    const numRows  = e.range.getNumRows();
    if (startRow + numRows - 1 < 2) return;

    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
    const idIdx   = headers.indexOf('id');
    if (idIdx < 0) return;

    for (let r = Math.max(startRow, 2); r <= startRow + numRows - 1; r++) {
      const rowVals = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
      // id가 비어있고 다른 데이터가 있으면 id 생성
      const hasData = rowVals.some((v, i) => i !== idIdx && v !== '' && v !== null);
      if (hasData && !rowVals[idIdx]) {
        const newId = String(new Date().getTime()) + '_' + r;
        sh.getRange(r, idIdx + 1).setNumberFormat('@').setValue(newId);
        Logger.log('contacts id 생성: ' + newId + ' (행 ' + r + ')');
      }
    }
    return;
  }

  // ── sectors 시트: 시트에서 직접 행 추가 시 id 자동 생성 (name → slug, 여러 행 붙여넣기도 전체 순회) ──
  if (name === 'sectors') {
    const startRow = e.range.getRow();
    const numRows  = e.range.getNumRows();
    if (startRow + numRows - 1 < 2) return;

    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
    const idIdx   = headers.indexOf('id');
    const nameIdx = headers.indexOf('name');
    if (idIdx < 0 || nameIdx < 0) return;

    for (let r = Math.max(startRow, 2); r <= startRow + numRows - 1; r++) {
      const rowVals = sh.getRange(r, 1, 1, sh.getLastColumn()).getValues()[0];
      const nameVal = String(rowVals[nameIdx] || '').trim();
      if (nameVal && !rowVals[idIdx]) {
        const slug = nameVal.toLowerCase().replace(/[^a-z0-9가-힣]/g, '_').slice(0, 20)
          + '_' + new Date().getTime().toString().slice(-4) + r;
        sh.getRange(r, idIdx + 1).setNumberFormat('@').setValue(slug);
        Logger.log('sectors id 생성: ' + slug + ' (행 ' + r + ')');
      }
    }
    return;
  }

  if (name !== 'participations') return;

  const row   = e.range.getRow();
  const col   = e.range.getColumn();
  if (row < 2) return; // 헤더 행 제외

  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);

  const idIdx      = headers.indexOf('id');
  const cidIdx     = headers.indexOf('cid');
  const emailIdx   = headers.indexOf('email');
  const phoneIdx   = headers.indexOf('phone');
  const matchedIdx = headers.indexOf('matched');

  const rowVals = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];

  // id 자동 생성
  if (idIdx >= 0 && !rowVals[idIdx]) {
    const newId = 'P-' + new Date().getTime();
    sh.getRange(row, idIdx + 1).setNumberFormat('@').setValue(newId);
    rowVals[idIdx] = newId;
  }

  // cid 자동 매칭 (이메일 또는 전화번호로)
  if (cidIdx >= 0 && !rowVals[cidIdx]) {
    const emailVal = emailIdx >= 0 ? String(rowVals[emailIdx]||'').trim().toLowerCase() : '';
    const phoneVal = phoneIdx >= 0 ? String(rowVals[phoneIdx]||'').trim().replace(/[\s\-\(\)]/g,'') : '';

    if (emailVal || phoneVal) {
      const csh   = ss.getSheetByName('contacts');
      if (csh) {
        const cHeaders = csh.getRange(1,1,1,csh.getLastColumn()).getValues()[0].map(String);
        const cData    = csh.getRange(2,1,csh.getLastRow()-1,csh.getLastColumn()).getValues();

        const cIdIdx     = cHeaders.indexOf('id');
        const cEmail1Idx = cHeaders.indexOf('email1');
        const cEmail2Idx = cHeaders.indexOf('email2');
        const cPhone1Idx = cHeaders.indexOf('phone1');
        const cPhone2Idx = cHeaders.indexOf('phone2');

        let matchedCid = '', matchType = '';

        for (const r of cData) {
          if (!r[cIdIdx]) continue;
          // 이메일 매칭
          if (emailVal) {
            const e1 = String(r[cEmail1Idx]||'').toLowerCase();
            const e2 = String(r[cEmail2Idx]||'').toLowerCase();
            if (e1 === emailVal || e2 === emailVal) {
              matchedCid = String(r[cIdIdx]);
              matchType  = '✅ 이메일';
              break;
            }
          }
          // 전화번호 매칭
          if (phoneVal) {
            const p1 = String(r[cPhone1Idx]||'').replace(/[\s\-\(\)]/g,'');
            const p2 = String(r[cPhone2Idx]||'').replace(/[\s\-\(\)]/g,'');
            if (p1 && p1 === phoneVal || p2 && p2 === phoneVal) {
              matchedCid = String(r[cIdIdx]);
              matchType  = '✅ 전화번호';
              break;
            }
          }
        }

        if (matchedCid) {
          sh.getRange(row, cidIdx+1).setNumberFormat('@').setValue(matchedCid);
          if (matchedIdx >= 0) sh.getRange(row, matchedIdx+1).setValue(matchType);
        } else {
          if (matchedIdx >= 0) sh.getRange(row, matchedIdx+1).setValue('⚠️ 미매칭');
        }
      }
    }
  }
}

// ══════════════════════════════════════════
//  미매칭 participations 일괄 재매칭
//  Apps Script 에디터에서 수동 실행
// ══════════════════════════════════════════
function rematchParticipations() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const psh = ss.getSheetByName('participations');
  const csh = ss.getSheetByName('contacts');
  if (!psh || !csh) { Logger.log('시트 없음'); return; }

  const pHeaders = psh.getRange(1,1,1,psh.getLastColumn()).getValues()[0].map(String);
  const cHeaders = csh.getRange(1,1,1,csh.getLastColumn()).getValues()[0].map(String);

  const pData = psh.getRange(2,1,psh.getLastRow()-1,psh.getLastColumn()).getValues();
  const cData = csh.getRange(2,1,csh.getLastRow()-1,csh.getLastColumn()).getValues();

  const cidIdx     = pHeaders.indexOf('cid');
  const emailIdx   = pHeaders.indexOf('email');
  const phoneIdx   = pHeaders.indexOf('phone');
  const matchedIdx = pHeaders.indexOf('matched');

  const cIdIdx     = cHeaders.indexOf('id');
  const cEmail1Idx = cHeaders.indexOf('email1');
  const cEmail2Idx = cHeaders.indexOf('email2');
  const cPhone1Idx = cHeaders.indexOf('phone1');
  const cPhone2Idx = cHeaders.indexOf('phone2');

  let fixed = 0;
  pData.forEach((row, i) => {
    if (row[cidIdx]) return; // 이미 매칭됨

    const emailVal = String(row[emailIdx]||'').trim().toLowerCase();
    const phoneVal = String(row[phoneIdx]||'').trim().replace(/[\s\-\(\)]/g,'');
    if (!emailVal && !phoneVal) return;

    for (const c of cData) {
      if (!c[cIdIdx]) continue;
      let matched = false, type = '';
      if (emailVal) {
        if (String(c[cEmail1Idx]||'').toLowerCase() === emailVal ||
            String(c[cEmail2Idx]||'').toLowerCase() === emailVal) {
          matched = true; type = '✅ 이메일';
        }
      }
      if (!matched && phoneVal) {
        const p1 = String(c[cPhone1Idx]||'').replace(/[\s\-\(\)]/g,'');
        const p2 = String(c[cPhone2Idx]||'').replace(/[\s\-\(\)]/g,'');
        if (p1 && p1 === phoneVal || p2 && p2 === phoneVal) {
          matched = true; type = '✅ 전화번호';
        }
      }
      if (matched) {
        psh.getRange(i+2, cidIdx+1).setNumberFormat('@').setValue(String(c[cIdIdx]));
        if (matchedIdx >= 0) psh.getRange(i+2, matchedIdx+1).setValue(type);
        fixed++;
        break;
      }
    }
  });
  Logger.log('재매칭 완료: ' + fixed + '건');
}

// ══════════════════════════════════════════
//  GET
// ══════════════════════════════════════════
function doGet(e) {
  try {
    return doGetInner(e);
  } catch (err) {
    return out({ error: String(err && err.message || err), stack: err && err.stack });
  }
}

function doGetInner(e) {
  const sheet = (e.parameter.sheet || '').trim();
  const email = (e.parameter.email || '').toLowerCase().trim();
  const token = (e.parameter.token || '');

  if (sheet === 'login') return out({ ok: verifyUser(email, token), email });
  if (!email.endsWith(ALLOWED_DOMAIN)) return out({ error: 'Unauthorized' });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(sheet);
  if (!sh) return out([]);

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return out([]);

  const headers   = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const rawValues = sh.getRange(2, 1, lastRow-1, lastCol).getValues();

  const result = [];
  for (let i = 0; i < rawValues.length; i++) {
    const r = rawValues[i];
    if (r[0] === '' || r[0] === null || r[0] === undefined) continue;
    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = safeStr(r[j]);
    result.push(row);
  }
  return out(result);
}

// ══════════════════════════════════════════
//  POST
// ══════════════════════════════════════════
function doPost(e) {
  try {
    return doPostInner(e);
  } catch (err) {
    // 예외를 그대로 던지면 Apps Script가 CORS 헤더 없는 500 에러 페이지를 반환해서
    // 브라우저에서 "CORS 차단"으로 잘못 표시된다. 항상 JSON으로 응답해서 실제 원인을 알 수 있게 한다.
    return out({ error: String(err && err.message || err), stack: err && err.stack });
  }
}

function doPostInner(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return out({ error: 'Invalid JSON' }); }

  const email  = (body.email  || '').toLowerCase().trim();
  const sheet  = (body.sheet  || '').trim();
  const row    = body.row    || [];
  const rows   = body.rows   || [];
  const action = body.action || 'append';

  if (!email.endsWith(ALLOWED_DOMAIN)) return out({ error: 'Unauthorized' });
  if (!sheet) return out({ error: 'sheet required' });

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = getOrCreateSheet(ss, sheet);

  // 대량 업로드용: 여러 행을 한 번의 요청으로 append (요청 왕복 횟수를 크게 줄임)
  if (action === 'batchAppend' && rows.length > 0) {
    const cleanRows = rows.map(r => r.map(v => v == null ? '' : String(v)));
    const width     = Math.max.apply(null, cleanRows.map(r => r.length));
    const paddedRows = cleanRows.map(r => {
      while (r.length < width) r.push('');
      return r;
    });
    const newRowNum = sh.getLastRow() + 1;
    const headers   = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
    applyTextFormatBlock(sh, headers, newRowNum, paddedRows.length, width);
    sh.getRange(newRowNum, 1, paddedRows.length, width).setValues(paddedRows);
    return out({ ok: true, action: 'batchAppended', count: paddedRows.length });
  }

  // 시트 전체를 주어진 순서로 재구성 (보기 좋게 정렬 등, 헤더는 유지하고 데이터 행만 통째로 교체)
  if (action === 'replaceAll') {
    const cleanRows = rows.map(r => r.map(v => v == null ? '' : String(v)));
    const headers   = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
    const lastRow   = sh.getLastRow();
    if (lastRow > 1) {
      sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
    }
    if (cleanRows.length > 0) {
      const width = Math.max.apply(null, cleanRows.map(r => r.length));
      const padded = cleanRows.map(r => { while (r.length < width) r.push(''); return r; });
      applyTextFormatBlock(sh, headers, 2, padded.length, width);
      sh.getRange(2, 1, padded.length, width).setValues(padded);
    }
    return out({ ok: true, action: 'replacedAll', count: cleanRows.length });
  }

  // 대량 수정용: id로 매칭되는 행을 찾아 한 번의 요청으로 여러 건 upsert (없으면 새로 추가)
  if (action === 'batchUpsert' && rows.length > 0) {
    const vals    = sh.getDataRange().getValues();
    const headers = vals[0].map(String);
    const idRow   = {};
    for (let i = 1; i < vals.length; i++) idRow[String(vals[i][0])] = i + 1; // 1-based sheet row

    let updated = 0;
    const toAppend = [];
    rows.forEach(r => {
      const cleanRow = r.map(v => v == null ? '' : String(v));
      const rowNum = idRow[String(cleanRow[0])];
      if (rowNum) {
        applyTextFormatRow(sh, headers, rowNum, cleanRow.length);
        sh.getRange(rowNum, 1, 1, cleanRow.length).setValues([cleanRow]);
        updated++;
      } else {
        toAppend.push(cleanRow);
      }
    });
    if (toAppend.length > 0) {
      const width = Math.max.apply(null, toAppend.map(r => r.length));
      const padded = toAppend.map(r => { while (r.length < width) r.push(''); return r; });
      const newRowNum = sh.getLastRow() + 1;
      applyTextFormatBlock(sh, headers, newRowNum, padded.length, width);
      sh.getRange(newRowNum, 1, padded.length, width).setValues(padded);
    }
    return out({ ok: true, action: 'batchUpserted', updated: updated, appended: toAppend.length });
  }

  if (action === 'delete' && row.length > 0) {
    const id   = String(row[0]);
    const vals = sh.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][0]) === id) {
        sh.deleteRow(i + 1);
        return out({ ok: true, action: 'deleted' });
      }
    }
    return out({ ok: false, action: 'not_found' });
  }

  if (action === 'upsert' && row.length > 0) {
    const id   = String(row[0]);
    const vals = sh.getDataRange().getValues();
    for (let i = 1; i < vals.length; i++) {
      if (String(vals[i][0]) === id) {
        const headers = vals[0].map(String);
        applyTextFormatRow(sh, headers, i+1, row.length);
        sh.getRange(i+1, 1, 1, row.length).setValues([row.map(v => v==null?'':String(v))]);
        return out({ ok: true, action: 'updated' });
      }
    }
  }

  const newRowNum = sh.getLastRow() + 1;
  const headers   = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  applyTextFormatRow(sh, headers, newRowNum, row.length);
  sh.getRange(newRowNum, 1, 1, row.length).setValues([row.map(v => v==null?'':String(v))]);
  return out({ ok: true, action: 'appended' });
}

// 기존 crm_targets 시트에 log 컬럼 헤더 추가 (1회 수동 실행)
// — CRM 컨택 기록을 시트에 저장할 수 있도록 스키마 확장.
//   새로 만드는 시트는 SHEET_HEADERS로 자동 생성되지만 기존 시트는
//   이 함수를 Apps Script 편집기에서 한 번 실행해서 헤더를 추가한다.
function addCrmLogColumn() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('crm_targets');
  if (!sh) { Logger.log('crm_targets 시트 없음'); return; }
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  if (headers.indexOf('log') >= 0) { Logger.log('log 컬럼 이미 존재'); return; }
  sh.getRange(1, headers.length + 1).setValue('log');
  Logger.log('log 컬럼 추가 완료 (컬럼 ' + (headers.length + 1) + ')');
}

// 기존 시트 일괄 정리 (1회 수동 실행)
function fixAllTextColumns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET_HEADERS).forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
    (TEXT_COLUMNS[name]||[]).forEach(col => {
      const idx = headers.indexOf(col);
      if (idx < 0) return;
      const range = sh.getRange(2, idx+1, sh.getLastRow()-1, 1);
      range.setNumberFormat('@');
      range.setValues(range.getValues().map(r => {
        const v = r[0];
        if (!v && v !== 0) return [''];
        if (typeof v === 'number' && v < 0) return [''];
        return [safeStr(v)];
      }));
    });
    Logger.log(name + ' 완료');
  });
}
