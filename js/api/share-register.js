/* ══════════════════════════════════════════════════════════════
   api/share-register.js — 바깥 공유·등록 링크 — /api/share, /api/register
   (api/mail-send.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { authHeaders } from '../api.js';
import { API_BASE_URL, currentUser } from '../state.js';

/* ── 연사 프로그램·수급 현황 바깥 공유 (routes/share.js) ── */
async function shareApi(path, method = 'GET', body){
  if(!API_BASE_URL || !currentUser) return { ok: false, offline: true, error: '테스트 모드에서는 공유할 수 없어요' };
  try {
    const headers = { ...await authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) };
    const res = await fetch(API_BASE_URL + '/api/share' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if(!res.ok && j.ok !== false) return { ok: false, error: `실패 (${res.status})` };
    return j;
  } catch(e){ return { ok: false, error: e.message }; }
}
export const loadShares    = (evKey) => shareApi(`/${encodeURIComponent(evKey)}`);
export const setShare      = (evKey, kind, body) => shareApi(`/${encodeURIComponent(evKey)}/${kind}`, 'PUT', body);
export const pushShareData = (evKey, kind, data) => shareApi(`/${encodeURIComponent(evKey)}/${kind}/data`, 'POST', { data });
export const shareUrl      = (path) => (API_BASE_URL || '') + path;

/* ── 바깥 등록 링크 (routes/register.js) ── */
async function registerApi(path, method = 'GET', body){
  if(!API_BASE_URL || !currentUser) return { ok: false, offline: true, error: '테스트 모드에서는 등록 링크를 쓸 수 없어요' };
  try {
    const headers = { ...await authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) };
    const res = await fetch(API_BASE_URL + '/api/register' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if(!res.ok && j.ok !== false) return { ok: false, error: `실패 (${res.status})` };
    return j;
  } catch(e){ return { ok: false, error: e.message }; }
}
export const loadRegisterLinks = (evKey) => registerApi(`/${encodeURIComponent(evKey)}`);
export const createRegisterLink = (evKey, body) => registerApi(`/${encodeURIComponent(evKey)}`, 'POST', body);
export const setRegisterLink   = (token, body) => registerApi(`/link/${encodeURIComponent(token)}`, 'PUT', body);
export const importRegisterRows = (evKey, body) => registerApi(`/${encodeURIComponent(evKey)}/import`, 'POST', body);
export const decideRegisterSub = (id, act) => registerApi(`/sub/${encodeURIComponent(id)}/${act}`, 'POST', {});

