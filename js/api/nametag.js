/* ══════════════════════════════════════════════════════════════
   api/nametag.js — 네임택 발급 — /api/nametag (backend-node/routes/nametag.js)
═══════════════════════════════════════════════════════════════ */
import { authHeaders } from '../api.js';
import { API_BASE_URL } from '../state.js';

async function call(path, method = 'GET', body){
  if(!API_BASE_URL) throw new Error('서버에 연결되지 않았어요');
  const headers = await authHeaders();
  if(body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API_BASE_URL}/api/nametag${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if(!j.ok){ const e = new Error(j.error || `요청 실패 (${res.status})`); e.status = res.status; e.data = j; throw e; }
  return j;
}

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
