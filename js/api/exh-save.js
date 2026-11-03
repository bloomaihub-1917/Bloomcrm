/* ══════════════════════════════════════════════════════════════
   api/exh-save.js — 전시 참가기업 진행관리 저장
   (api.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { API_BASE_URL, currentUser } from '../state.js';
import { authHeaders, postToSheet, safeFetch } from '../api.js';

/* ══════════════════════════════════════════
   4) 전시 참가기업 진행관리 저장 (객체형)

   기존 시트들은 컬럼 순서에 맞춘 위치 배열(row)로 보내지만, exhibitors는
   컬럼이 35개라 순서가 어긋나는 사고가 나기 쉬워 객체(data)로 보낸다.
   서버는 이때 "넘어온 키만" 갱신하므로(부분 upsert), 체크 하나를 누를 때
   {id, manual_sent_at} 처럼 바뀐 필드만 보내면 나머지는 그대로 보존된다.
   신규 생성 시 서버가 id를 만들어 응답의 id로 돌려준다.
══════════════════════════════════════════ */
async function saveExhRow(sheet, obj, label){
  return postToSheet({ sheet, data: obj }, label);
}
async function deleteExhRow(sheet, id, label){
  return postToSheet({ sheet, action: 'delete', row: [id] }, label);
}

/* expect를 함께 보내면 서버가 «내가 본 값»과 지금 값을 견주고, 다르면 저장을
   거절한다(routes/data.js의 checkExpect). 안 보내면 예전처럼 그냥 덮는다. */
export const saveExhibitor       = (o, expect) => postToSheet(
  { sheet: 'exhibitors', data: o, ...(expect ? { expect } : {}) }, '전시 참가기업 저장');
export const saveExhContact      = (o) => saveExhRow('exhibitor_contacts', o, '담당자 저장');
export const saveExhItem         = (o) => saveExhRow('exhibitor_items',    o, '금액 항목 저장');
export const saveExhInvoice      = (o) => saveExhRow('exhibitor_invoices', o, '인보이스 저장');
export const saveExhTax          = (o) => saveExhRow('exhibitor_tax_invoices', o, '세금계산서 저장');
export const saveExhPayment      = (o) => saveExhRow('exhibitor_payments', o, '입금 내역 저장');
export const saveExhLog          = (o) => saveExhRow('exhibitor_logs',     o, '문의/기록 저장');
export const saveExhApp          = (o) => saveExhRow('exhibitor_apps',     o, '신청서 접수 저장');
export const saveWatchFolder     = (o) => saveExhRow('watch_folders',      o, '지켜보는 폴더 저장');
export const deleteWatchFolder   = (id) => deleteExhRow('watch_folders',   id, '지켜보는 폴더 삭제');
export const deleteWatchFiles    = (ids) => postToSheet(
  { sheet: 'watch_files', action: 'delete', row: ids }, '폴더 파일 기록 삭제');
/* 훑을 때마다 수백 줄이 오간다 — 한 줄씩 보내면 그만큼 왕복한다 */
export const saveWatchFiles      = (rows) => postToSheet(
  { sheet: 'watch_files', action: 'batchUpsert', dataRows: rows }, '폴더 파일 일괄 기록');
export const saveEquipCatalog    = (o) => saveExhRow('equip_catalog',      o, '품목 저장');
export const deleteEquipCatalog  = (id) => deleteExhRow('equip_catalog',   id, '품목 삭제');

export const deleteExhibitor     = (id) => deleteExhRow('exhibitors',         id, '전시 참가기업 삭제');
export const deleteExhContact    = (id) => deleteExhRow('exhibitor_contacts', id, '담당자 삭제');
export const deleteExhItem       = (id) => deleteExhRow('exhibitor_items',    id, '금액 항목 삭제');
export const deleteExhInvoice    = (id) => deleteExhRow('exhibitor_invoices', id, '인보이스 삭제');
export const deleteExhTax        = (id) => deleteExhRow('exhibitor_tax_invoices', id, '세금계산서 삭제');
export const deleteExhPayment    = (id) => deleteExhRow('exhibitor_payments', id, '입금 내역 삭제');
export const deleteExhLog        = (id) => deleteExhRow('exhibitor_logs',     id, '문의/기록 삭제');
export const deleteExhApp        = (id) => deleteExhRow('exhibitor_apps',     id, '신청서 접수 삭제');

/* ── 컨택 — TM/DM 차수 ── */
export const saveRound       = (o) => saveExhRow('contact_rounds',   o, '컨택 차수 저장');
export const deleteRound     = (id) => deleteExhRow('contact_rounds', id, '컨택 차수 삭제');
export const saveRoundMember = (o) => saveExhRow('round_members',    o, '컨택 명단 저장');
export const deleteRoundMembers = (ids) => postToSheet(
  { sheet: 'round_members', action: 'delete', row: ids }, '컨택 명단 빼기');
/* 명단 채우기는 수백 곳이 한 번에 들어간다 — 한 줄씩 보내면 그만큼 왕복한다 */
export const addRoundMembers = (rows) => postToSheet(
  { sheet: 'round_members', action: 'batchAppend', dataRows: rows }, '컨택 명단 채우기');
export const saveAttempt     = (o) => saveExhRow('contact_attempts', o, '컨택 기록 저장');
export const deleteAttempt   = (id) => deleteExhRow('contact_attempts', id, '컨택 기록 삭제');
/* 컨택 세 표만 다시 읽는다 — 여럿이 동시에 돌릴 때 팀원 기록을 받아 오려고.
   전부 다시 읽으면 열려 있는 화면 상태가 날아간다. 하나라도 못 읽으면 아무것도 바꾸지 않는다 */
export async function reloadContactData(){
  if(!API_BASE_URL || !currentUser) return null;
  const base = API_BASE_URL + '/api/data?sheet=';
  const headers = await authHeaders();
  const [r, m, a] = await Promise.all([
    safeFetch(base + 'contact_rounds', 'contact_rounds', 1, headers),
    safeFetch(base + 'round_members', 'round_members', 1, headers),
    safeFetch(base + 'contact_attempts', 'contact_attempts', 1, headers),
  ]);
  if(!Array.isArray(r) || !Array.isArray(m) || !Array.isArray(a)) return null;
  return { rounds: r, members: m, attempts: a };
}
/* 옛 엑셀 기록 가져오기 — 수백 건이 한 번에 들어간다 */
export const addAttempts     = (rows) => postToSheet(
  { sheet: 'contact_attempts', action: 'batchAppend', dataRows: rows }, '컨택 기록 가져오기');

/* 참가기업 일괄 등록 — 기업DB에서 전시참가기업을 뽑아 한 번에 만든다. */
export async function batchCreateExhibitors(rows){
  return postToSheet({ sheet: 'exhibitors', action: 'batchUpsert', dataRows: rows }, '참가기업 일괄 등록');
}


