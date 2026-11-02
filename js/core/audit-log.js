/* ══════════════════════════════════════════════════════════════
   core/audit-log.js — 활동 기록 남기기 (모든 쓰기 동작이 여기로 모인다)

   전에는 활동 로그 «탭» 파일(audit-tab.js) 안에 있어서, 무엇을 저장하든
   그 탭 화면 파일을 끌어와야 했다. 기록을 남기는 일과 기록을 보여 주는
   화면을 떼어, 이 파일은 상태(state.js)와 저장(api.js)만 안다.
   화면(배지·목록 다시 그리기)은 audit-tab.js가 onAuditChange로 건다.
═══════════════════════════════════════════════════════════════ */

import { auditLog, currentUser } from '../state.js';
import { saveAuditToSheets } from '../api.js';

/* ══════════════════════════════════════════
   되돌릴 재료

   활동 기록은 사람이 읽는 문장이다 — «그래픽 주문 2026-09-13 지움»은 읽을 수는
   있어도 되돌릴 수는 없다. 어느 표의 어느 줄이었는지, 지워진 값이 정확히
   무엇이었는지를 문장에서 다시 캐내야 한다.

   그래서 값 자체를 함께 담는다. 되돌리는 기능은 나중에 붙이더라도 재료는
   오늘부터 쌓아야 한다 — 오늘 안 남긴 값은 내일 만들 기능으로도 되살릴 수 없다.

   trackAction의 다섯째 자리에 그대로 넣는다. 그 자리는 원래 «눌러서 갈 곳»
   (kind·id)을 담던 데라, 둘을 합쳐 두면 기록 한 줄이 갈 곳과 되돌릴 방법을
   함께 들고 다닌다.
══════════════════════════════════════════ */
/* 고침 — 바뀐 칸만 담는다. 안 바뀐 칸까지 넣으면 기록이 몇 배로 불어난다. */
export function changed(table, row, before, after, extra = {}){
  const keys = Object.keys(after || {});
  const b = {};
  keys.forEach(k => { b[k] = (before || {})[k] ?? ''; });
  return { ...extra, table, row, op: 'update', before: b, after };
}
/* 지움 — 줄을 통째로 담는다. 줄 전체가 없어진 거라 되살리려면 모든 칸이 있어야 한다. */
export const removed = (table, row, before, extra = {}) =>
  ({ ...extra, table, row, op: 'delete', before: before || {} });
/* 새로 만듦 — 되돌리는 건 «지우기»다. 무엇을 지울지 알면 되니 id만 있으면 된다. */
export const created = (table, row, after, extra = {}) =>
  ({ ...extra, table, row, op: 'create', after: after || {} });

/* 기록이 늘 때 부를 화면 쪽 함수들 — 활동 로그 탭이 배지를 고치려고 건다 */
const listeners = [];
export function onAuditChange(fn){ listeners.push(fn); }

/* extra는 "이 기록이 가리키는 곳"이다 — { kind, id, ev, tab, field }.
   kind/id가 있으면 로그 줄을 눌러 그 창을 열 수 있고, field가 있으면 창을
   연 뒤 그 칸을 잠깐 물들인다. 대상이 없는 기록(로그인, 일괄 작업처럼 창
   하나로 좁혀지지 않는 것)은 extra를 비워 둔다 — 눌러도 갈 곳이 없는 줄을
   누를 수 있게 해 두면 매번 헛손질을 하게 된다. */
export function trackAction(type, action, target, detail, extra){
  if(!currentUser) return;
  const entry = {
    id: Date.now(),
    ts: new Date().toISOString(),
    email: currentUser.email,
    name: currentUser.name,
    color: currentUser.color,
    type,      // 'status'|'log'|'add'|'stage'|'login'
    action,    // 사람이 읽는 액션명
    target,    // 기업명 or 이메일
    detail,    // 상세 설명
    extra: extra||null,
  };
  auditLog.unshift(entry);

  // 배지 업데이트
  listeners.forEach(fn => fn(entry));

  // 서버 저장
  saveAuditToSheets(entry);
}
