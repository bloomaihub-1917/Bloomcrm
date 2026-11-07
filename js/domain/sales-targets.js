/* ══════════════════════════════════════════════════════════════
   domain/sales-targets.js — 행사별 영업 DB (docs/manual-db-axes.md)

   한 줄 = 이 사람을 이 행사의 영업 DB로 쓴다(sales_targets).
   컨택 명단에 넣을 때 같이 켠다. 컨택에서 빼도 끄지 않는다 —
   그 행사의 다른 차수에서 다시 쓸 수 있기 때문이다(2026-11-07 사용자와 정함).
═══════════════════════════════════════════════════════════════ */

import { SALES_TARGETS, currentUser } from '../state.js';
import { postToSheet } from '../api.js';
import { td } from '../utils.js';

export const isSalesTarget = (cid, evKey) =>
  SALES_TARGETS.some(t => t.contact_id === +cid && t.event_id === evKey);

export const salesEventsOf = (cid) =>
  SALES_TARGETS.filter(t => t.contact_id === +cid).map(t => t.event_id);

/* 여러 사람을 한 행사의 영업 DB로 켠다 — 이미 켜진 사람은 건너뛴다.
   돌려주는 값: 새로 켠 사람 수(실패하면 화면도 되돌리고 -1) */
export async function markSalesTargets(cids, evKey){
  if(!evKey) return 0;
  const by = (currentUser && currentUser.email) || '';
  const fresh = [...new Set(cids.map(Number))].filter(cid => cid && !isSalesTarget(cid, evKey));
  if(!fresh.length) return 0;
  const stamp = Date.now();
  const rows = fresh.map((cid, i) => ({ id: `ST-${stamp}_${i}`, event_id: evKey, contact_id: cid, created_at: td(), created_by: by }));
  SALES_TARGETS.push(...rows);
  const r = await postToSheet({ sheet: 'sales_targets', action: 'batchAppend',
    dataRows: rows.map(x => ({ ...x, contact_id: String(x.contact_id) })) }, '영업 DB 넣기');
  if(r && r.ok === false){
    rows.forEach(x => { const i = SALES_TARGETS.indexOf(x); if(i >= 0) SALES_TARGETS.splice(i, 1); });
    return -1;
  }
  return rows.length;
}

export async function unmarkSalesTarget(cid, evKey){
  const i = SALES_TARGETS.findIndex(t => t.contact_id === +cid && t.event_id === evKey);
  if(i < 0) return true;
  const [row] = SALES_TARGETS.splice(i, 1);
  const r = await postToSheet({ sheet: 'sales_targets', action: 'delete', row: [row.id] }, '영업 DB 빼기');
  if(r && r.ok === false){ SALES_TARGETS.push(row); return false; }
  return true;
}
