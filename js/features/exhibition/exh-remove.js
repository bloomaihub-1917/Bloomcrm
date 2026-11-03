/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-remove.js — 참가기업 지우기 — 딸린 것까지 함께
   (modules/exh-drawer.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { removed, trackAction } from '../../core/audit-log.js';
import { refreshExhViews } from '../../modules/exh-tab.js';
import { EXHIBITORS, EXH_APPS, EXH_CONTACTS, EXH_INVOICES, EXH_ITEMS, EXH_LOGS, EXH_PAYMENTS, EXH_TAX, getExhibitorById, paymentsFor } from '../../state.js';
import { escAttr, escapeHtml } from '../../utils.js';
import { money } from './exh-calc.js';
import { closeExhDr, deleteExhApp, deleteExhContact, deleteExhInvoice, deleteExhItem, deleteExhLog, deleteExhPayment, deleteExhTax, deleteExhibitor, sct } from '../../modules/exh-drawer.js';
import { dContact } from './exh-dr-booth.js';

/* ══════════════════════════════════════════
   참가기업 지우기 — 딸린 것까지 함께

   전시 참가기업 한 줄에는 일곱 갈래가 매달려 있다: 담당자·금액 항목·인보이스·
   세금계산서·입금·문의 기록·신청서 접수. 기업 줄만 지우면 이것들이 없는 기업을
   가리킨 채 DB에 남는다 — 화면에서는 안 보이니 아무도 모르고, 발행한 인보이스와
   받은 돈까지 주인 없이 떠돈다. 연사에서 똑같은 일이 이미 한 번 났다.

   ── 돈이 오간 곳은 지우지 않는다 ──
   입금이나 환불이 한 줄이라도 있으면 막는다. 그건 회계에 이미 잡힌 숫자라,
   지우면 우리 장부에서만 사라지고 통장에는 남는다. 참가를 접은 것뿐이라면
   지울 일이 아니라 «취소» 상태로 두는 일이다 — 그래야 «왜 이 부스가 비었나»에
   답할 수 있다.

   ── 무엇이 함께 사라지는지 세어서 보여준다 ──
   «정말 지울까요?»만 묻는 물음은 아무것도 알려주지 않는다. 인보이스 두 장과
   입금 세 건이 딸려 있다는 걸 알고 누르는 것과 모르고 누르는 것은 다르다.
══════════════════════════════════════════ */
const EXH_CHILDREN = [
  ['담당자',       EXH_CONTACTS, deleteExhContact,  'exhibitor_contacts'],
  ['금액 항목',    EXH_ITEMS,    deleteExhItem,     'exhibitor_items'],
  ['인보이스',     EXH_INVOICES, deleteExhInvoice,  'exhibitor_invoices'],
  ['세금계산서',   EXH_TAX,      deleteExhTax,      'exhibitor_tax_invoices'],
  ['입금·환불',    EXH_PAYMENTS, deleteExhPayment,  'exhibitor_payments'],
  ['문의·기록',    EXH_LOGS,     deleteExhLog,      'exhibitor_logs'],
  ['신청서 접수',  EXH_APPS,     deleteExhApp,      'exhibitor_apps'],
];

export async function removeExhibitor(id){
  const x = getExhibitorById(id);
  if(!x) return;

  const kids = EXH_CHILDREN.map(([label, arr, del, table]) => ({
    label, arr, del, table,
    rows: arr.filter(r => r.exhibitor_id === id).map(r => ({ ...r })),
  }));

  /* 돈이 오간 흔적 — 금액이 적힌 입금·환불 줄이 있으면 지우지 않는다 */
  const money = paymentsFor(id).filter(p => String(p.amount ?? '').trim() !== '');
  if(money.length){
    alert(`«${x.company_name}»은(는) 입금·환불 기록이 ${money.length}건 있어 지울 수 없어요.\n\n`
      + `이미 회계에 잡힌 숫자라, 지우면 우리 장부에서만 사라집니다.\n`
      + `참가를 접은 거라면 진행 탭에서 상태를 «취소»로 두세요 — 부스 번호와 기록이 남아`
      + ` 나중에 «왜 이 자리가 비었나»에 답할 수 있어요.`);
    return;
  }

  const lines = kids.filter(k => k.rows.length).map(k => `   · ${k.label} ${k.rows.length}건`);
  if(!confirm(`«${x.company_name}» 참가기업을 지울까요?\n\n`
    + (lines.length ? `함께 지워집니다:\n${lines.join('\n')}\n\n` : '딸린 기록은 없어요.\n\n')
    + `되돌릴 수 없습니다. 참가를 접은 것뿐이라면 상태를 «취소»로 두세요.`)) return;

  /* 딸린 것부터 지운다. 기업 줄을 먼저 지웠다가 중간에 실패하면, 남은 자식들이
     가리킬 데 없는 채로 떠돈다 — 지금 고치고 있는 바로 그 상태가 된다. */
  for(const k of kids){
    for(const r of k.rows){
      const res = await k.del(r.id);
      if(res && res.ok === false){
        alert(`${k.label}을(를) 지우다 멈췄어요. 네트워크 확인 후 다시 시도해주세요.\n`
          + `여기까지 지운 것은 되돌아가지 않습니다 — 다시 누르면 남은 것부터 이어서 지웁니다.`);
        refreshExhViews();
        return;
      }
      const i = k.arr.findIndex(o => o.id === r.id);
      if(i >= 0) k.arr.splice(i, 1);
    }
  }

  const res = await deleteExhibitor(id);
  if(res && res.ok === false){ alert('참가기업을 지우지 못했어요.'); refreshExhViews(); return; }
  const i = EXHIBITORS.findIndex(o => o.id === id);
  if(i >= 0) EXHIBITORS.splice(i, 1);

  closeExhDr?.();
  trackAction('delete', '참가기업 삭제', x.company_name || '',
    `<b>${escapeHtml(x.company_name || '')}</b> 삭제`
    + (lines.length ? ` — ${kids.filter(k => k.rows.length).map(k => `${k.label} ${k.rows.length}건`).join(' · ')} 함께` : ''),
    removed('exhibitors', id, x,
      { also: kids.flatMap(k => k.rows.map(r => ({ table: k.table, row: r.id, before: r }))) }));
  refreshExhViews();
}

/* 지우는 자리는 눈에 잘 띄면 안 된다 — 담당자 탭 맨 아래, 접힌 채로 둔다 */
function dangerZone(x){
  return `<details style="margin-top:18px">
    <summary style="font-size:11px;color:var(--i5);cursor:pointer">이 참가기업 지우기</summary>
    <div style="margin-top:8px;padding:10px 12px;border:1px solid var(--re);border-radius:8px">
      <div style="font-size:11.5px;color:var(--i3);line-height:1.6">
        담당자·금액 항목·인보이스·세금계산서·입금·문의·접수가 <b>함께 지워집니다</b>.<br>
        참가를 접은 것뿐이라면 진행 탭에서 상태를 <b>취소</b>로 두세요 —
        부스 번호와 기록이 남아 나중에 «왜 이 자리가 비었나»에 답할 수 있어요.
      </div>
      <button class="btn bs" style="margin-top:8px;border-color:var(--re);color:var(--re)"
        onclick="removeExhibitor('${escAttr(x.id)}')">참가기업 삭제</button>
    </div></details>`;
}

/* ── 담당자 탭 ── */
function dContactTab(x){
  return `${sct('기업 담당자', dContact(x))}${dangerZone(x)}`;
}


/* 화면의 onclick이 부르는 것 */
window.removeExhibitor = removeExhibitor;
window.dContactTab = dContactTab;   // 탭(exh-drawer.js)이 window로 부른다
