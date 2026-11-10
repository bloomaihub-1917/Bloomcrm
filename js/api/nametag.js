/* ══════════════════════════════════════════════════════════════
   api/nametag.js — 네임택 발급 — /api/nametag (backend-node/routes/nametag.js)
═══════════════════════════════════════════════════════════════ */
import { authHeaders } from '../api.js';
import { API_BASE_URL } from '../state.js';

/* 현장 와이파이가 «붙어는 있는데 안 가는» 상태면 fetch가 한참 걸린다 → TIMEOUT 뒤 끊긴 것으로 본다.
   e.status가 없으면(연결·로그인 토큰·시간 초과) 다시 보내도 되는 실패다 — nt-outbox.js가 이것으로 가른다 */
const TIMEOUT = 20000;
async function call(path, method = 'GET', body){
  if(!API_BASE_URL) throw new Error('서버에 연결되지 않았어요');
  const headers = await authHeaders();
  if(body) headers['Content-Type'] = 'application/json';
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), TIMEOUT);
  let res;
  try { res = await fetch(`${API_BASE_URL}/api/nametag${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ac.signal }); }
  catch(e){ throw new Error(e.name === 'AbortError' ? '서버가 답하지 않아요' : '인터넷에 연결되지 않았어요'); }
  finally { clearTimeout(t); }
  const j = await res.json().catch(() => ({}));
  if(!j.ok){ const e = new Error(j.error || `요청 실패 (${res.status})`); e.status = res.status; e.data = j; throw e; }
  return j;
}
/* 기기에 쌓아 둔 기록을 보낼 때(nt-outbox.js) — 길만 받아 그대로 */
export const sendNametag = (path, method, body) => call(path, method, body);

export const loadNametag = (evKey) => call(`/${encodeURIComponent(evKey)}`);
export const saveNametagTemplate = (evKey, t) => call(`/${encodeURIComponent(evKey)}/template`, 'PUT', t);
export const issueNametags = (evKey, cards, reason, onsite) => call(`/${encodeURIComponent(evKey)}/issue`, 'POST', { cards, reason, onsite: !!onsite });
export const voidNametag = (id) => call(`/print/${encodeURIComponent(id)}/void`, 'POST', {});
export const saveNametagBars = (evKey, items, via) => call(`/${encodeURIComponent(evKey)}/bars`, 'PUT', { items, via });
export const saveWalkInContact = (evKey, key, v) => call(`/${encodeURIComponent(evKey)}/people/${encodeURIComponent(key)}`, 'PUT', v);
export const checkInNametag = (evKey, key) => call(`/${encodeURIComponent(evKey)}/checkin`, 'POST', { person_key: key });
export const voidCheckIn = (id) => call(`/checkin/${encodeURIComponent(id)}/void`, 'POST', {});
export const loadNametagLive = (evKey, since) => call(`/${encodeURIComponent(evKey)}/live?since=${encodeURIComponent(since || '')}`);
export const promoteWalkIns = (evKey, keys) => call(`/${encodeURIComponent(evKey)}/promote`, 'POST', { person_keys: keys });
