/* ══════════════════════════════════════════════════════════════
   api/mail-send.js — 메일 보내기 — /api/mail/send
   (api.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { API_BASE_URL, currentUser } from '../state.js';
import { authHeaders } from '../api.js';

/* ══════════════════════════════════════════
   메일 보내기 — /api/mail/send

   데이터 저장과 길이 다르다(postToSheet가 아니다). 보낸 사실은 서버가
   기록에 남기므로, 어느 상대에게 보내는지를 exhibitor_id나 speaker_id로
   함께 넘긴다 — 둘 중 하나가 없으면 메일은 나가지만 기록이 비어
   «몇 번 독촉했나»를 다시 셀 수 없게 된다.

   테스트 모드에서는 보내지 않는다. 더미 데이터로 실제 메일이 나가면
   연습이 사고가 된다.
══════════════════════════════════════════ */
export async function sendMail(payload){
  if(!API_BASE_URL || !currentUser){
    return { ok: false, offline: true, error: '테스트 모드에서는 메일을 보내지 않아요' };
  }
  try {
    const headers = { 'Content-Type': 'application/json', ...await authHeaders() };
    const res = await fetch(API_BASE_URL + '/api/mail/send', {
      method: 'POST', headers, body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    if(!res.ok || j.ok === false) return { ok: false, error: j.error || `발송 실패 (${res.status})` };
    return j;
  } catch(e){
    return { ok: false, error: `발송 실패: ${e.message}` };
  }
}

/* 메일 설정이 됐는지 — 보내기 전에 왜 못 보내는지 알려주려고 쓴다 */
export async function mailStatus(){
  if(!API_BASE_URL || !currentUser) return { ok: false, offline: true };
  try {
    const res = await fetch(API_BASE_URL + '/api/mail/status', { headers: await authHeaders() });
    return await res.json();
  } catch(e){ return { ok: false, error: e.message }; }
}

/* ── 행사 공용 메일 (메일플러그) ──
   행사마다 그 행사 주소로 보낸다. 비밀번호는 서버가 암호화해 들고 있고
   화면에는 «있다/없다»만 온다. */
async function mailApi(path, method = 'GET', body){
  if(!API_BASE_URL || !currentUser) return { ok: false, offline: true, error: '테스트 모드에서는 쓸 수 없어요' };
  try {
    const headers = { ...await authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) };
    const res = await fetch(API_BASE_URL + '/api/mail' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if(!res.ok && j.ok !== false) return { ok: false, error: `실패 (${res.status})` };
    return j;
  } catch(e){ return { ok: false, error: e.message }; }
}
export const loadMailAccounts  = () => mailApi('/accounts');

/* 이 행사 메일이 어느 주소로 나가는지 — 보내기 전에 눈으로 확인하게 보여 준다.
   계정을 저장·삭제하면 새로 고칠 수 있게 force를 둔다. */
let mailAcctCache = null;
export async function eventMailFrom(evKey, force){
  if(!mailAcctCache || force || mailAcctCache.ok === false) mailAcctCache = await loadMailAccounts();
  let r = mailAcctCache || {};
  if(r.offline) return { ok: false, text: '테스트 모드 — 보내지 않음' };
  let b = (r.accounts || []).find(a => a.event_id === evKey);
  /* 다른 사람이 방금 계정을 넣었을 수 있다 — 없다고 막기 전에 한 번 새로 읽는다 */
  if(!b && !force){ mailAcctCache = r = await loadMailAccounts(); b = (r.accounts || []).find(a => a.event_id === evKey); }
  if(!b) return { ok: false, text: '이 행사에 공용 메일이 없어요 — 설정 › 행사 관리 › 메일에서 넣어주세요' };
  return { ok: true, addr: b.from_addr, text: b.from_name ? `${b.from_name} <${b.from_addr}>` : b.from_addr };
}
/* 행사 메일 계정 하나 — 마지막 가져온 시각(last_sync_at)을 대시보드에 보인다 */
export async function mailAccountOf(evKey, force){
  if(!mailAcctCache || force || mailAcctCache.ok === false) mailAcctCache = await loadMailAccounts();
  return ((mailAcctCache || {}).accounts || []).find(a => a.event_id === evKey) || null;
}
export const saveMailAccount   = (evKey, rec) => mailApi(`/accounts/${encodeURIComponent(evKey)}`, 'PUT', rec);
/* 행사 메일 푸터 — 이 메일함으로 나가는 모든 메일 끝에 서버가 붙인다(routes/mail.js withFooter) */
export const loadMailFooter    = (evKey) => mailApi(`/accounts/${encodeURIComponent(evKey)}/footer`);
export const saveMailFooter    = (evKey, rec) => mailApi(`/accounts/${encodeURIComponent(evKey)}/footer`, 'PUT', rec);
export const deleteMailAccount = (evKey) => mailApi(`/accounts/${encodeURIComponent(evKey)}`, 'DELETE');
export const testMailAccount   = (evKey) => mailApi(`/accounts/${encodeURIComponent(evKey)}/test`, 'POST', {});
/* 보낸메일함을 읽어 연사 발송 기록으로 — apply 없이 부르면 미리보기만 */
export const syncSentMail      = (evKey, apply) => mailApi(`/accounts/${encodeURIComponent(evKey)}/sync-sent`, 'POST', { apply: !!apply });
/* 받은메일함을 읽어 연사·참가사 기록으로 — apply 없이 부르면 미리보기만 */
/* 원문 보기·주인 없는 메일 — t: 'sp' | 'ex' | 'un'(주인 없는 메일) */
export const mailOriginal      = (t, id, remote) => mailApi(`/original/${t}/${encodeURIComponent(id)}${remote ? '?remote=1' : ''}`);
export const loadUnassigned    = (evKey) => mailApi(`/unassigned/${encodeURIComponent(evKey)}`);
export const linkUnassigned    = (id, body) => mailApi(`/unassigned/${encodeURIComponent(id)}/link`, 'POST', body);
/* CRM 협의 타겟의 컨택 이력에 받은 메일을 붙인다 — { targetId, memo } */
export const linkUnassignedCrm = (id, body) => mailApi(`/unassigned/${encodeURIComponent(id)}/link-crm`, 'POST', body);
export const ignoreUnassigned  = (id, domain) => mailApi(`/unassigned/${encodeURIComponent(id)}/ignore`, 'POST', { domain: !!domain });
/* 기업 후보함 — 홍보·제안 메일에서 기업 후보를 뽑아 보이고, 사람이 고쳐 «추가»하면 기업·연락처를 만든다 */
export const loadOrgCandidates = (evKey) => mailApi(`/org-candidates/${encodeURIComponent(evKey)}`);
export const addOrgCandidate   = (id, body) => mailApi(`/org-candidates/${encodeURIComponent(id)}/add`, 'POST', body);
export const syncInboxMail    = (evKey, apply) => mailApi(`/accounts/${encodeURIComponent(evKey)}/sync-inbox`, 'POST', { apply: !!apply });

/* ── 메일 기본 첨부 (단계별 가이드·양식 파일) ──
   행사별로 한 번 받아 두고 같이 쓴다. 테스트 모드에서는 서버에 올리지 않고
   이 탭 안에서만 들고 있는다 — 화면 동작은 확인할 수 있게. */
const mailFilesCache = {};
export const mailFilesOf = (evKey) => mailFilesCache[evKey] || [];
export async function loadMailFiles(evKey){
  if(!API_BASE_URL || !currentUser){ mailFilesCache[evKey] = mailFilesCache[evKey] || []; return mailFilesCache[evKey]; }
  try {
    const res = await fetch(`${API_BASE_URL}/api/mail/files?event_id=${encodeURIComponent(evKey)}`, { headers: await authHeaders() });
    const j = await res.json().catch(() => ({}));
    if(j.ok) mailFilesCache[evKey] = j.files || [];
  } catch(e){ console.warn('[CRM] 기본 첨부 목록 실패:', e.message); }
  return mailFilesOf(evKey);
}
export async function uploadMailFile(rec){
  if(!API_BASE_URL || !currentUser){
    const file = { ...rec, id: `MF-local-${Date.now()}`, size: Math.floor(rec.data.length * 3 / 4) };
    delete file.data;
    (mailFilesCache[rec.event_id] = mailFilesCache[rec.event_id] || []).push(file);
    return { ok: true, file, offline: true };
  }
  try {
    const headers = { 'Content-Type': 'application/json', ...await authHeaders() };
    const res = await fetch(API_BASE_URL + '/api/mail/files', { method: 'POST', headers, body: JSON.stringify(rec) });
    const j = await res.json().catch(() => ({}));
    if(!res.ok || j.ok === false) return { ok: false, error: j.error || `올리기 실패 (${res.status})` };
    (mailFilesCache[rec.event_id] = mailFilesCache[rec.event_id] || []).push(j.file);
    return j;
  } catch(e){ return { ok: false, error: `올리기 실패: ${e.message}` }; }
}
export async function deleteMailFile(evKey, id){
  const drop = () => { mailFilesCache[evKey] = mailFilesOf(evKey).filter(f => f.id !== id); };
  if(!API_BASE_URL || !currentUser){ drop(); return { ok: true }; }
  try {
    const res = await fetch(`${API_BASE_URL}/api/mail/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await authHeaders() });
    const j = await res.json().catch(() => ({}));
    if(!res.ok || j.ok === false) return { ok: false, error: j.error || `삭제 실패 (${res.status})` };
    drop(); return { ok: true };
  } catch(e){ return { ok: false, error: `삭제 실패: ${e.message}` }; }
}
/* 브라우저 파일 → base64 (data: 머리 뗀 것) */
export const fileToBase64 = (file) => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] || '');
  r.onerror = () => no(r.error);
  r.readAsDataURL(file);
});

