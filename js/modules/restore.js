/* ══════════════════════════════════════════════════════════════
   restore.js — 활동 기록에서 되돌리기

   지우고 나서 «아까 그거 뭐였지»가 되는 일이 실제로 났다. ㈜브레디스헬스케어의
   부스 금액 165,000원이 사라졌는데 활동 기록 어디에도 없었고, 인보이스 금액을
   거꾸로 짚어서야 무엇이 있었는지 알아냈다.

   그래서 지금은 바뀐 값과 지워진 줄을 기록에 통째로 담는다(audit-tab.js의
   changed·removed·created). 여기는 그 재료로 실제로 되돌리는 자리다.

   ── 무엇을 되돌리나 ──
     지움(delete)      지워진 줄을 그대로 다시 넣는다. 딸린 줄(also)도 함께.
     고침(update)      before에 적힌 값을 그 칸에 도로 쓴다.
     여럿(update-many) 줄마다 before를 도로 쓴다.
     만듦(create)      되돌리는 건 지우기다.

   ── 되돌리기도 기록에 남는다 ──
   되돌린 것 자체가 하나의 변경이다. 남기지 않으면 «누가 되살렸나»를 알 수 없고,
   되돌리기를 되돌릴 수도 없다.

   ── 덮어쓸 수 있다는 걸 먼저 말한다 ──
   지운 뒤에 같은 자리를 다시 고쳤다면, 되돌리기는 그 뒤 작업을 덮는다. 기록에
   적힌 그때 값으로 돌아가는 것이지 «없던 일»이 되는 게 아니다. 그래서 무엇을
   어떤 값으로 되돌리는지 물음에 그대로 적는다.
═══════════════════════════════════════════════════════════════ */

import { auditLog, currentUser } from '../state.js';
import { postToSheet, loadFromSheets } from '../api.js';
import { escapeHtml } from '../utils.js';
import { trackAction } from './audit-tab.js';

/* 사람이 읽는 표 이름 — 물음에 «exhibitor_items 줄을 되살릴까요»라고 쓰면
   무엇을 되살리는지 알 수 없다. */
const TABLE_LABEL = {
  exhibitors: '전시 참가기업', exhibitor_items: '금액 항목',
  exhibitor_contacts: '기업 담당자', exhibitor_invoices: '인보이스',
  exhibitor_tax_invoices: '세금계산서', exhibitor_payments: '입금·환불',
  exhibitor_logs: '문의·기록', exhibitor_apps: '신청서 접수',
  contacts: '연락처', participations: '행사 참여', orgs: '기업',
  crm_targets: 'CRM 타겟', speakers: '연사', speaker_contacts: '연사 연락 상대',
  speaker_logs: '연사 기록', conf_sessions: '세션', session_speakers: '세션 배정',
  equip_catalog: '품목', events: '행사', sectors: '업종', domains: '분야',
  tags: '태그', part_types: '참가 유형', watch_folders: '지켜보는 폴더',
  watch_files: '폴더 파일',
};
const tbl = (t) => TABLE_LABEL[t] || t;

/* 되돌릴 수 있는 기록인가 — 재료가 있어야 한다 */
export function canRestore(e){
  const x = e && e.extra;
  if(!x || !x.op) return false;
  if(x.op === 'delete') return !!(x.table && x.before);
  if(x.op === 'create') return !!(x.table && x.row);
  if(x.op === 'update') return !!(x.table && x.row && x.before);
  if(x.op === 'update-many') return !!(x.table && Array.isArray(x.rows) && x.rows.length);
  return false;
}

/* 되돌리면 무슨 일이 일어나는지 — 물음에 그대로 적는다 */
export function restorePlan(e){
  const x = e.extra;
  const also = Array.isArray(x.also) ? x.also : [];
  if(x.op === 'delete'){
    const rows = Array.isArray(x.before) ? x.before : [x.before];
    return { title: `${tbl(x.table)} ${rows.length}건을 되살립니다`,
      lines: [`${tbl(x.table)} ${rows.length}건`,
        ...(also.length ? [`딸려 지워진 ${also.length}건`] : [])] };
  }
  if(x.op === 'create'){
    return { title: `방금 만든 ${tbl(x.table)}를 지웁니다`, lines: [`${tbl(x.table)} 1건`] };
  }
  if(x.op === 'update'){
    return { title: `${tbl(x.table)}의 값을 되돌립니다`,
      lines: Object.keys(x.before).map(k =>
        `${k}: ${fmt(x.after && x.after[k])} → ${fmt(x.before[k])}`) };
  }
  return { title: `${tbl(x.table)} ${x.rows.length}건의 값을 되돌립니다`,
    lines: x.rows.slice(0, 5).map(r =>
      Object.keys(r.before || {}).map(k => `${k}: ${fmt(r.before[k])}`).join(', '))
      .concat(x.rows.length > 5 ? [`… 외 ${x.rows.length - 5}건`] : []) };
}
const fmt = (v) => (v === '' || v === undefined || v === null) ? '(빈값)' : String(v);

/* 한 줄 쓰기 — data 경로는 넘긴 칸만 고친다. 지워진 줄을 되살릴 때는 모든
   칸을 넘기므로 그대로 다시 만들어지고, 값을 되돌릴 때는 그 칸만 바뀐다. */
const put = (table, row) => postToSheet({ sheet: table, data: row }, '되돌리기');
const drop = (table, id) => postToSheet({ sheet: table, action: 'delete', row: [id] }, '되돌리기');

export async function restoreFromLog(entryId){
  const e = auditLog.find(a => String(a.id) === String(entryId));
  if(!e || !canRestore(e)){ alert('이 기록에는 되돌릴 자료가 없어요.'); return; }
  const x = e.extra;
  const plan = restorePlan(e);

  const when = new Date(e.ts).toLocaleString('ko-KR',
    { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  if(!confirm(`${plan.title}\n\n`
    + plan.lines.map(l => '   · ' + l).join('\n')
    + `\n\n${when}에 ${e.name || '누군가'}가 한 일을 되돌립니다.\n`
    + `그 뒤에 같은 자리를 또 고쳤다면 그 작업은 덮어써집니다.`)) return;

  const fails = [];
  const run = async (p) => { const r = await p; if(!r || r.ok === false) fails.push(r); };

  if(x.op === 'delete'){
    const rows = Array.isArray(x.before) ? x.before : [x.before];
    for(const r of rows) await run(put(x.table, r));
    /* 딸린 줄은 제 표를 들고 다닌다(세션에 딸린 배정, 연락처에 딸린 참여처럼
       본체와 다른 표다). 표가 안 적혀 있으면 본체와 같은 표로 본다. */
    for(const a of (x.also || [])){
      const t = a.table || x.table;
      const row = a.before || a;
      if(row && row.id) await run(put(t, row));
    }
  } else if(x.op === 'create'){
    await run(drop(x.table, x.row));
  } else if(x.op === 'update'){
    await run(put(x.table, { id: x.row, ...x.before }));
  } else if(x.op === 'update-many'){
    for(const r of x.rows) await run(put(x.table, { id: r.row, ...(r.before || {}) }));
  }

  if(fails.length){
    alert(`되돌리다 ${fails.length}건이 실패했어요. 네트워크 확인 후 다시 시도해주세요.\n`
      + `성공한 것은 그대로 반영돼 있습니다 — 다시 누르면 남은 것부터 이어집니다.`);
  }

  trackAction('edit', '되돌리기', e.target || tbl(x.table),
    `<b>${escapeHtml(when)}</b>의 «${escapeHtml(e.action || '')}»을(를) 되돌렸어요 — ${escapeHtml(plan.title)}`,
    { restoredFrom: String(e.id), table: x.table, row: x.row });

  /* 화면을 DB에서 다시 읽는다. 되살아난 줄은 여기 있는 배열에 없어서,
     새로 읽지 않으면 «되돌렸다»는 말만 뜨고 화면은 그대로다. */
  await loadFromSheets({});
  window.renderExh?.(); window.renderMDB?.(); window.renderCrm?.();
  window.renderConf?.(); window.renderCoList?.(); window.renderAudit?.();
}
