/* ══════════════════════════════════════════════════════════════
   api/ai.js — Claude에게 묻는 일 — /api/ai
   (api/mail-send.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { authHeaders } from '../api.js';
import { API_BASE_URL, currentUser } from '../state.js';

/* ── Claude에게 묻는 일 (backend-node/routes/ai.js) — 개인정보는 보내지 않는다 ── */
async function aiApi(path, method = 'GET', body){
  if(!API_BASE_URL || !currentUser) return { ok: false, offline: true, error: '테스트 모드에서는 쓸 수 없어요' };
  try {
    const headers = { ...await authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) };
    const res = await fetch(API_BASE_URL + '/api/ai' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if(!res.ok && j.ok !== false) return { ok: false, error: `실패 (${res.status})` };
    return j;
  } catch(e){ return { ok: false, error: e.message }; }
}
export const aiStatus     = () => aiApi('/status');
export const aiMapColumns = (body) => aiApi('/map-columns', 'POST', body);
export const aiCompanyPairs = (body) => aiApi('/company-pairs', 'POST', body);
export const aiQueryPlan    = (body) => aiApi('/query-plan', 'POST', body);
export const aiOrgQueryPlan = (body) => aiApi('/org-query-plan', 'POST', body);
export const aiOrgEnrich     = (body) => aiApi('/org-enrich', 'POST', body);
export const aiSpeakerAdvice = (body) => aiApi('/speaker-advice', 'POST', body);
export const aiExhAdvice    = (body) => aiApi('/exh-advice', 'POST', body);
export const aiMailDraft    = (body) => aiApi('/mail-draft', 'POST', body);
export const aiOrgPdfSummary = (body) => aiApi('/org-pdf-summary', 'POST', body);
// 설정 › AI 설정 — 기능별 켜기·모델·생각 깊이·월 한도, 이번 달 사용량
export const aiConfig     = () => aiApi('/config');
export const aiSaveConfig = (body) => aiApi('/config', 'PUT', body);



