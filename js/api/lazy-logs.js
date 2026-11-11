/* ══════════════════════════════════════════════════════════════
   api/lazy-logs.js — 메일 기록·활동 기록은 그 화면에 들어갈 때 받는다 (2026-11-11)

   로그인 때 표 30개를 한꺼번에 받으면서 메일 기록(exhibitor_logs·speaker_logs, 본문 포함 약 2.6MB)과
   활동 기록(activity_log, 약 2.5MB)이 절반 넘게 차지했다. 휴대폰에서 네임택 데스크만 여는데도
   이것을 다 받느라 느렸다. 그래서 로그인 때는 빼고, 쓰는 화면에 들어갈 때 한 번 받는다.
     mail  — 전시 · 연사 · 컨택(연사 진행 단계) · 기업DB(미답변 문의) · 설정 · 연락처 상세의 «주고받은 메일»
     audit — 활동 로그 · 전시/연사 대시보드의 최근 활동
   한 번 받으면 다시 받지 않는다(로그인 때 전체를 다시 읽으면 이것도 같이 다시 — refreshLoadedLogs).
   받은 뒤 화면을 다시 그리는 일은 부른 쪽이 한다(router.js · contact-mails.js).
═══════════════════════════════════════════════════════════════ */
import { API_BASE_URL, EXH_LOGS, SPEAKER_LOGS, auditLog, currentUser, userColor } from '../state.js';
import { authHeaders, safeFetch } from '../api.js';

const loaded = { mail: false, audit: false };
const pending = { mail: null, audit: null };
let fixtures = null;   // 시험 로그인(test/test/test) — 서버 대신 가짜 표
export const setLazyFixtures = (fx) => { fixtures = fx; };
export const logsLoaded = (kind) => loaded[kind];

async function read(sheets){
  if(fixtures) return sheets.map(s => fixtures[s] ?? []);
  if(!API_BASE_URL || !currentUser) return sheets.map(() => null);
  const base = API_BASE_URL + '/api/data?sheet=';
  const headers = await authHeaders();
  return Promise.all(sheets.map(s => safeFetch(base + s, s, 1, headers)));
}

/* 받기 — 받는 중이면 그 약속을 같이 기다린다. 받았으면 true */
export function ensureLogs(kind, { force = false } = {}){
  if(loaded[kind] && !force) return Promise.resolve(true);
  if(pending[kind]) return pending[kind];
  pending[kind] = (async () => {
    try {
      if(kind === 'mail'){
        const [xl, sl] = await read(['exhibitor_logs', 'speaker_logs']);
        if(Array.isArray(xl)) EXH_LOGS.splice(0, EXH_LOGS.length, ...xl);
        if(Array.isArray(sl)) SPEAKER_LOGS.splice(0, SPEAKER_LOGS.length, ...sl);
        loaded.mail = Array.isArray(xl) && Array.isArray(sl);
      } else {
        const [al] = await read(['activity_log']);
        if(Array.isArray(al)) applyAuditRows(al);
        loaded.audit = Array.isArray(al);
      }
      return loaded[kind];
    } finally { pending[kind] = null; }
  })();
  return pending[kind];
}
/* 로그인 때 전체를 다시 읽으면, 이미 받아 둔 기록도 새로 받는다 */
export function refreshLoadedLogs(){
  return Promise.all(['mail', 'audit'].filter(k => loaded[k]).map(k => ensureLogs(k, { force: true })));
}

/* activity_log 줄 → 화면 기록(auditLog). 예전 load.js에 있던 것을 그대로 옮겼다 */
function applyAuditRows(logsData){
  // 구버전 행 복구: 예전 saveAuditToSheets가 6개 값을 한 칸씩 밀린 순서
  // [id←ts, ts←name, email←email, name←action, type←target, action←detail]
  // 로 저장했었다. id 자리에 ISO 시각이 들어있으면 구버전 행으로 보고 되돌린다.
  const ACTION_TYPE = {
    '로그인':'login', '로그아웃':'login',
    '상태 변경':'status', '행사 참여 추가':'status',
    '컨택 기록 추가':'log',
    '타겟 추가':'add', '연락처 추가':'add',
    '단계 변경':'stage',
    '연락처 정보 수정':'edit', '행사 추가':'edit', '행사 삭제':'edit',
    '파일 업로드':'upload',
  };
  /* 예전 행에는 link 칸이 없고, 손으로 넣은 행에 엉뚱한 글자가 들어 있을 수도
     있다. 못 읽으면 그냥 링크 없는 줄로 둔다 — 로그 목록이 통째로 안 뜨는
     것보다 낫다. 눌러서 갈 곳(kind·id)과 되돌릴 재료(table·before) 중 하나라도 있으면 살린다. */
  const parseAuditLink = (v) => {
    if(!v) return null;
    try {
      const o = JSON.parse(v);
      if(!o || typeof o !== 'object') return null;
      return (o.kind && o.id) || o.table || o.before ? o : null;
    }
    catch(e){ return null; }
  };
  const remoteLog = logsData.map(r=>{
    const legacy = /^\d{4}-\d{2}-\d{2}T/.test(String(r.id||'')) && !r.detail && !r.target;
    const row = legacy
      ? { ts: r.id, email: r.email, name: r.ts, type: '', action: r.name, target: r.type, detail: r.action }
      : r;
    return {
      id: row.id || (Date.now() + Math.random()),
      ts: row.ts || new Date().toISOString(),
      email: row.email||'', name: row.name||'',
      color: userColor(row.email||''),
      type: row.type || ACTION_TYPE[row.action] || 'login',
      action: row.action||'', target: row.target||'',
      detail: row.detail||'',
      extra: parseAuditLink(row.link),
    };
  });
  auditLog.splice(0, auditLog.length, ...remoteLog);
}
