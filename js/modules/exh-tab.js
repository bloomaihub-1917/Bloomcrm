/* ══════════════════════════════════════════════════════════════
   exh-tab.js — 전시 참가기업 진행관리 (전시 탭)

   기존 CRM 탭은 일반 영업 파이프라인(미접촉→컨택중→확정)이라 성격이 완전히
   달라 섞지 않고 분리했다. 여기서 다루는 건 전시 실무 흐름이다:
     매뉴얼 발송/회신 → 신청서 → 부스 배정 → 정산(인보이스·세금계산서·입금)
     → 그래픽 → 도록 → 현장
   여기에 더해, 단계와 무관하게 수시로 들어오는 문의사항을 받아 적고
   답변 여부를 추적한다(답변 안 한 문의가 묻히는 게 가장 큰 리스크).

   데이터는 전부 서버 컬럼명(snake_case) 그대로 다룬다 — 변환 레이어를 두지
   않아 저장할 때 필드명이 어긋날 여지를 없앴다.
═══════════════════════════════════════════════════════════════ */

import { unent } from './audit-describe.js';
import {
  EXHIBITORS, EXH_ITEMS, EXH_INVOICES, EXH_TAX, EXH_PAYMENTS, EXH_LOGS, EXH_CFG,
  exhEvent, setExhEvent,
  exhibitorsForEvent, getExhibitorById, itemsFor, invoicesFor, taxInvoicesFor, paymentsFor,
  logsFor, openInquiriesFor, contactsFor, primaryContactFor,
  EVENT_LIST, contacts, participations, CO_DB, currentUser, API_BASE_URL, auditLog,
  catalogItem, catalogFor, findCatalogByName, EQUIP_CATALOG, getOrgById, liveItemsFor,
  appsFor, openAppFor, nextItemSort,
  codeList, codeItem, codeLabel, codeCls,
  evPartOn, evPartDone, evPartState,
  findOrgByName, orgName, ORGS,
} from '../state.js';
import { td, escapeHtml, escAttr, isMobile, cleanEmail, countryName, leftPill, levenshteinDist, phoneMatch } from '../utils.js';
export { cleanEmail };   // exh-drawer가 여기서 가져다 쓴다
import { postToSheet as _postToSheet } from '../api.js';
import { saveExhCfgToSheet as _saveExhCfgToSheet } from '../api/settings-save.js';
import { saveExhibitor as _saveExhibitor, saveExhItem as _saveExhItem, saveExhInvoice as _saveExhInvoice, saveExhPayment as _saveExhPayment, saveExhLog as _saveExhLog, deleteExhItem as _deleteExhItem, deleteExhInvoice as _deleteExhInvoice, deleteExhPayment as _deleteExhPayment, deleteExhLog as _deleteExhLog, batchCreateExhibitors as _batchCreateExhibitors } from '../api/exh-save.js';
/* 화면 상태는 ../features/exhibition/exh-ui.js의 exhUi 한곳에 둔다 — 이 탭의 구획을 다른 파일로 떼어도 같은 값을 보게 */
import { exhUi } from '../features/exhibition/exh-ui.js';
import { makePartLock } from '../core/part-lock.js';

/* 진행 완료된 행사에서는 저장을 아예 보내지 않는다. 감싸는 자리를 하나로
   둬야 새 저장 지점이 생겨도 가드에서 빠지지 않는다. */
const postToSheet = guardWrite(_postToSheet);
export const saveExhibitor = guardWrite(_saveExhibitor);
export const saveExhItem = guardWrite(_saveExhItem);
const saveExhInvoice = guardWrite(_saveExhInvoice);
const saveExhPayment = guardWrite(_saveExhPayment);
const saveExhLog = guardWrite(_saveExhLog);
const deleteExhItem = guardWrite(_deleteExhItem);
const deleteExhInvoice = guardWrite(_deleteExhInvoice);
const deleteExhPayment = guardWrite(_deleteExhPayment);
const deleteExhLog = guardWrite(_deleteExhLog);
export const batchCreateExhibitors = guardWrite(_batchCreateExhibitors);
export const saveExhCfgToSheet = guardWrite(_saveExhCfgToSheet);
import { trackAction, changed } from '../core/audit-log.js';
import { isStale, isUnread, mailCardHtml } from '../shared/mail/mail-mark.js';
import { resolveDue, dueInputHtml, readDueInput, followCfg, followState } from '../shared/mail/follow-up.js';
import { boothChange, exhMailSteps } from './exh-mail.js';
import { renderWatchView, initWatchFolders } from './exh-watch.js';
import { createOrg } from '../features/companies/co-detail.js';
import { normalizeCompanyKey } from '../domain/org-names.js';
import { reloadOrgs, orgIdForName } from '../domain/orgs.js';

export function cancelledExhibitors(evKey){
  return exhibitorsForEvent(evKey).filter(x => x.status === CANCELLED);
}

/* 스폰서 등급별 배지색 — 'Exhibitor'(일반)는 배지를 달지 않는다 */
/* 등급 색상도 행사마다 다를 수 있어 설정에서 읽는다(code_lists.grade).
   목록에 없는 등급은 회색으로 떨어진다. */
export const gradeCls = (g, evKey) => codeCls('grade', evKey || exhEvent, g);

/* ── 기업 이름 ──
   exhibitors.company_name은 등록할 때 찍힌 국문 스냅샷이라 영문이 없다. 해외
   기업은 메일도 인보이스도 영문명으로 오가서, 화면에 국문만 있으면 "Labcorp가
   어느 줄이지"를 눈으로 못 찾는다. 연결된 기업 레코드에서 영문명을 끌어와 함께
   보여준다(연결이 없으면 스냅샷 그대로).

   국문명이 아예 없는 기업은 영문을 제목 자리로 올린다 — 빈칸 아래 영문이
   따라붙는 모양이 되지 않게. */
export function exhNames(x){
  const o = x && x.org_id ? getOrgById(x.org_id) : null;
  const ko = (o && o.name_ko) || x?.company_name || '';
  const en = (o && o.name_en) || '';
  return { ko: ko || en, en: ko ? en : '' };
}

/* 한 줄에 국문 + 영문을 나란히 (표 칸처럼 세로 공간이 좁을 때) */
export function nameCell(x, opts = {}){
  const { ko, en } = exhNames(x);
  const off = opts.off ? ';text-decoration:line-through;opacity:.6' : '';
  return `<span style="font-size:${opts.size || 12.5}px;font-weight:700${off}">${escapeHtml(ko)}</span>${
    en ? `<span style="font-size:${(opts.size || 12.5) - 2}px;font-weight:400;color:var(--i4);margin-left:5px">${escapeHtml(en)}</span>` : ''}`;
}

/* 체크리스트 표의 열 정의. key는 exhibitors 컬럼, 또는 파생 계산(calc). */
export const STEPS = [
  { key: 'manual_sent_at',       label: '매뉴얼<br>발송' },
  { key: 'manual_replied_at',    label: '매뉴얼<br>회신' },
  { key: 'app_received_at',      label: '신청서',   flag: 'app_received',
    /* 아직 반영하지 않은 접수가 있으면 경고다 — 받아만 두고 품목에 옮기지
       않으면 발주가 옛 내용으로 나간다. 정보 누락도 같은 자리에서 본다. */
    warn: (x) => ((x.app_received_at || x.app_received === 'yes') && x.app_complete === 'no')
      || !!openAppFor(x.id) },
  { key: 'booth_confirmed_at',   label: '부스', flag: 'booth_confirmed' },
  /* 독립부스만 해당한다 — 조립부스는 우리가 짓는 것이라 받을 도면이 없어
     'na'(·)로 비운다. 51곳 중 18곳이라 열 하나를 더 세울 값어치가 있다. */
  { key: 'calc:design',          label: '부스<br>도면' },
  { key: 'calc:invoice',         label: '인보이스' },
  { key: 'calc:tax',             label: '세금<br>계산서' },
  { key: 'calc:payment',         label: '입금' },
  { key: 'calc:graphic',         label: '그래픽' },
  /* 기본부스·블록부스만 해당한다 — 독립부스는 업체가 직접 지어 우리가 만들 게 없다 */
  { key: 'calc:base',            label: '기본<br>시공' },
  { key: 'directory_received_at',label: '도록', flag: 'directory_received' },
  { key: 'movein_at',            label: '현장' },
];


/* 단계별 집계 알약을 누르면 그 단계만 걸러 본다. "신청서 47/51"에서 못 채운
   네 곳이 어디인지 보려면 지금은 51줄을 눈으로 훑어야 한다.

   한 번 더 누르면 완료 → 미완료 → 전체로 돌아간다. 두 방향을 다 보고 싶은데
   알약을 셋으로 늘리면 열한 단계가 서른셋이 되어 알약 줄이 화면을 덮는다.

   해당 없는 곳(부스 도면이 없는 조립부스 같은)은 어느 쪽에도 넣지 않는다 —
   집계의 분모에서도 빠져 있어서, 여기서만 끼면 개수가 안 맞는다. */
/* 대시보드 단계 줄에서 펼쳐 둔 경고 목록 — 한 번에 하나.
   숫자만 보여 주면 «3곳»이 어디인지 찾으러 기업리스트를 훑어야 한다. */
export function toggleStepWarn(key){
  exhUi.stepWarnOpen = exhUi.stepWarnOpen === key ? '' : key;
  renderExh();
}


export function setStepFil(key){
  exhUi.stepFil = !exhUi.stepFil || exhUi.stepFil.key !== key ? { key, mode: 'done' }
    : exhUi.stepFil.mode === 'done' ? { key, mode: 'todo' } : null;
  renderExh();
}

/* 그래픽 현황 안의 보기와 거르개. 그래픽은 기업 한 줄로 볼 일(단계 진행)과
   파일 한 줄로 볼 일(무엇이 안 왔나)이 갈린다 — 화면 하나에 둘 다 넣으면
   어느 쪽도 제대로 안 보여서 나눠 두고 전환한다. */

export function setGraphicView(v){ exhUi.gView = v; renderExh(); }
export function setGraphicFil(v){ exhUi.gFil = exhUi.gFil === v && v !== 'all' ? 'all' : v; renderExh(); }
export function setPayFil(v){ exhUi.payFil = exhUi.payFil === v && v !== 'all' ? 'all' : v; renderExh(); }

/* 드로어는 exh-drawer.js가 소유한다. 이 파일이 그쪽을 import하면 순환 참조가
   되므로(드로어가 여기 집계 함수를 쓴다) window 경유로만 호출한다 —
   기존 모듈들이 window.switchApp?.() 를 쓰는 것과 같은 방식. */

/* 41개 함수를 ../features/exhibition/exh-calc.js로 옮겼다 — 이 파일에서도 쓰고, 옛 경로로 가져가는 곳도 있어 다시 내보낸다 */
import { num, EXH_ROLES, activeExhibitors, reloadExhibitors, CANCELLED, money, TCELL, TPILL, liveInvoices, currencyOf, mixedCurrency, isBillable, billableItems, EXRENTAL_CHANNEL, isExrentalApp, exrentalBilled, ourBillableItems, needsReissue, billedAmount, invoiceGap, billedByCategory, isDoneRefund, isPendingRefund, paidAmount, paidBreakdown, pendingRefunds, payGroup, taxNeed, settleByCurrency, payDueDate, settleState, isOwing, isOverdue, isWaiting, refundDue, TAX_STAGES, GRAPHIC_STAGES, stageOf, stageAge, exhibitorTradeFor, fmtMoney, exhCfg, setExhCfg, daysSince, eventDeadlines } from '../features/exhibition/exh-calc.js';
export { EXH_ROLES, activeExhibitors, reloadExhibitors, CANCELLED, money, TCELL, TPILL, liveInvoices, currencyOf, mixedCurrency, isBillable, billableItems, EXRENTAL_CHANNEL, isExrentalApp, exrentalBilled, ourBillableItems, needsReissue, billedAmount, invoiceGap, billedByCategory, isDoneRefund, isPendingRefund, paidAmount, paidBreakdown, pendingRefunds, payGroup, taxNeed, settleByCurrency, payDueDate, settleState, isOwing, isOverdue, isWaiting, refundDue, TAX_STAGES, GRAPHIC_STAGES, stageOf, stageAge, exhibitorTradeFor, fmtMoney, exhCfg, setExhCfg, daysSince, eventDeadlines } from '../features/exhibition/exh-calc.js';

/* 부스 바뀐 곳 — 부스 번호를 고치면 «알린 부스»(마지막으로 보낸 메일의 «부스 번호:» 줄)와
   달라진 기업이 생긴다. 누구에게 변경 안내를 보내야 하는지 사람이 기억하지 않게 목록 위에 띄운다 */
export function boothAlertHtml(all){
  const ch = all.filter(x => boothChange(x).changed);
  if(!ch.length) return '';
  const names = ch.slice(0, 4).map(x => { const b = boothChange(x); return `${exhNames(x).ko} ${b.from}→${b.to}`; }).join(', ')
    + (ch.length > 4 ? ` 외 ${ch.length - 4}곳` : '');
  return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:9px 12px;margin-bottom:10px;
      border:1px solid var(--am);border-radius:var(--rd-10);background:var(--W);font-size:var(--fs-11_5)">
    <b style="color:var(--am)">부스 바뀐 곳 ${ch.length}곳</b>
    <span style="color:var(--i3)">${escapeHtml(names)} — 알린 부스와 지금 부스가 달라요</span>
    <button class="btn bp bs" style="margin-left:auto" onclick="openExhBulkMail('booth_change')">✉ 부스 변경 안내 보내기</button>
  </div>`;
}

/* 전시 메일 문구에 넣을 이 기업의 값(exh-mail.js fillExhTemplate의 ctx).
   계산은 여기 있는 정산 함수를 그대로 쓴다 — 메일에 적힌 금액과 정산 탭이 갈리지 않게 */
export function exhMailCtx(x){
  const s = settleState(x);
  return {
    names: exhNames(x),
    contact: exhContact(x),
    billed: s.billed ? fmtMoney(s.billed, s.cur) : '',
    unpaid: s.state === 'settled' ? fmtMoney(0, s.cur) : s.billed ? fmtMoney(Math.max(0, s.balance), s.cur) : '',
  };
}

/* ── 프로그램북 글자수 한도 ──
   지면 기준이 행사마다 다르다(2026 KIC은 1,354자·189단어라 여유를 둬 1,300/200).
   설정이 없으면 이 기본값을 쓴다. */
export const BOOK_LIMIT_DEFAULT = { chars: 1300, words: 200 };
export function bookLimit(evKey){
  const b = exhCfg(evKey).book || {};
  return {
    chars: Number(b.chars) > 0 ? Number(b.chars) : BOOK_LIMIT_DEFAULT.chars,
    words: Number(b.words) > 0 ? Number(b.words) : BOOK_LIMIT_DEFAULT.words,
  };
}

/* ── 단계별 마감일 ──
   마감을 걸 만한 단계만 고른다. "매뉴얼 발송"처럼 우리가 언제든 할 수 있는 일이
   아니라, 기업에서 받아내야 해서 늦으면 행사 준비가 밀리는 것들이다.
   키는 STEPS의 키와 같아야 체크리스트 칸에 그대로 붙는다. */
export const DUE_STEPS = [
  ['manual_replied_at',     '매뉴얼 회신'],
  ['app_received_at',       '신청서 접수'],
  ['booth_confirmed_at',    '부스 확정'],
  ['calc:design',           '부스 도면 (독립부스)'],
  ['calc:payment',          '입금'],
  ['calc:graphic',          '그래픽 확정'],
  ['calc:base',             '기본 시공 (간판명·디자인)'],
  ['directory_received_at', '도록 정보'],
  ['movein_at',             '반입·설치'],
];

/* ══════════════════════════════════════════
   진행 완료 잠금

   끝난 행사는 열어 볼 수는 있어야 하고, 고쳐지면 안 된다. 화면에서 입력칸을
   비활성하는 것만으로는 부족하다 — 남은 인라인 핸들러나 콘솔로 값이 들어가면
   끝난 행사의 기록이 조용히 바뀐다. 실제로 데이터를 지키는 건 저장 가드다.

   가드는 exh-drawer도 함께 쓴다(같은 행사를 다루므로 판단 기준이 하나여야 한다).
══════════════════════════════════════════ */
/* 참가기업 창은 감사 로그 등에서 다른 행사 기업으로도 열린다 — 창이 열려 있는
   동안은 «그 기업의 행사»로 잠금을 판단한다(인보이스 파일 폴더도 같은 이유). */
/* 틀은 core/part-lock.js — 컨퍼런스 잠금과 같은 코드다.
   모두 함수 선언으로 둔다 — 이 파일 머리(saveExhibitor = guardWrite(…))와 다른 파일 머리가 이 함수들을
   파일을 다 읽기 전에 부른다. const로 두면 그때 아직 없어서 깨진다. 잠금 틀은 처음 부를 때 만든다. */
function exhLock(){ return exhLock.v || (exhLock.v = makePartLock({ part: 'exh', label: '행사', fallback: () => exhEvent })); }
export function setExhLockEv(v){ exhLock().setLockEv(v); }
export function exhLocked(){ return exhLock().locked(); }
export function exhLockNotice(){ exhLock().notice(); }
/* api.js 쓰기 함수를 이 모듈과 드로어가 나눠 쓰므로, 감싸는 자리를 하나로 둬야 빠지는 길이 없다 */
export function guardWrite(fn){ return exhLock().guard(fn); }

/* 마감을 놓친 줄을 눌렀을 때 열 드로어 탭 — 바로 처리할 수 있는 자리로 보낸다 */
export const DUE_TAB = {
  'manual_sent_at': 'progress',
  'manual_replied_at': 'progress', 'app_received_at': 'apply',
  'booth_confirmed_at': 'progress', 'calc:design': 'progress', 'calc:payment': 'billing',
  'calc:invoice': 'billing', 'calc:tax': 'billing',
  'calc:graphic': 'graphic', 'calc:base': 'progress',
  'directory_received_at': 'book', 'movein_at': 'progress',
};


/* 오늘 기준 남은 날 — 마감이 없으면 null.
   days > 0 남음, 0 오늘, 음수면 지났다. */
export function dueInfo(stepKey, evKey){
  const date = String(eventDeadlines(evKey)[stepKey] || '').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(date + 'T00:00:00');
  return { date, days: Math.round((d - today) / 86400000) };
}

/* 그래픽 진행 상태 — 주문 안 했으면 해당 없음, 출력/제작에 따라 완료 기준이 다르다 */
/* ── 독립부스 도면이 어디까지 왔나 ──
   자체 시공은 부스를 업체가 직접 짓지만 무엇을 지을지는 우리가 본다(높이 제한,
   통로 침범, 인접 부스 가림). 부스 현황·드로어가 같은 정의를 쓰게 한곳에 둔다. */
export function boothDesignState(x){
  if(!x.booth_design_received_at) return { state: 'none', text: '미수령' };
  if(!x.booth_design_checked_at)  return { state: 'todo', text: '확인 대기' };
  if(x.booth_design_result === 'fix') return { state: 'warn', text: '수정 요청' };
  if(x.booth_design_result === 'ok')  return { state: 'done', text: '적합' };
  return { state: 'todo', text: '결과 미기재' };
}

/* ══════════════════════════════════════════
   기본 제공 시공 — 추가 발주와 다른 것

   추가 발주는 기업이 신청하고 돈을 더 내는 것이라 안 하면 그만이다. 여기 것은
   계약에 이미 들어 있어서, 기업이 아무 말을 안 해도 우리가 만들어 세워야 한다.
   빠뜨리면 개막날 부스에 상호가 없다.

   무엇을 해야 하는지는 부스 타입이 정한다 — 따로 적게 하면 타입을 고칠 때마다
   두 군데를 맞춰야 하고, 어긋난 쪽이 조용히 틀린 값이 된다.

     기본부스(Octanium)  간판명을 받아 → 우리가 간판을 만든다
     블록·라이팅 부스     디자인을 받아 → 우리가 출력·시공한다
     독립부스            해당 없음 (업체가 직접 짓는다)
══════════════════════════════════════════ */
/* 어느 종류만 볼지 — 비어 있으면 전부 */
export function setBaseFil(k){ exhUi.baseFil = exhUi.baseFil === k ? '' : k; renderExh(); }

/* ══════════════════════════════════════════
   부스 디자인 의뢰 (G-130)

   블록·라이팅 부스는 보통 기업이 디자인을 만들어 보내고 우리가 출력·시공한다.
   그런데 디자인까지 의뢰한 곳이 있다 — 그때는 우리가 그리고, 출력하고, 세운다.

   기본 시공 화면에서 이게 안 보이면 «디자인 수령» 칸이 빈 채로 남아 있는 것을
   보고 «아직 안 왔네, 독촉해야지»가 된다. 받을 것이 없는 곳에 독촉을 보내는
   일이고, 정작 우리가 그려야 한다는 건 아무도 안 짚는다.

   판별은 품목의 분류로 한다 — 코드를 코드에 박아 두면 디자인 품목이 하나 더
   생길 때 또 고쳐야 한다(exh-drawer의 isDesignItem과 같은 기준). 카탈로그에
   안 이어진 옛 줄이 있어 이름도 함께 본다. */
export function hasDesignOrder(x){
  return liveItemsFor(x.id).some(i => {
    /* 부스에 딸려 오는 기본 제공은 의뢰가 아니다.
       블록·라이팅 부스에는 「G-131 벽면 그래픽 출력(디자인 비용 별도)」이 계약으로
       깔려 있는데 그 품목의 분류가 «디자인»이라, 분류만 보면 블록·라이팅 21곳이
       전부 디자인 의뢰가 된다. 이름 그대로 디자인 비용은 별도이고 디자인은 기업이
       준다 — 우리가 그리는 곳은 G-130을 따로 주문한 곳뿐이다. */
    if(isBoothGiven(i)) return false;
    const c = i.catalog_id ? catalogItem(i.catalog_id) : null;
    if(c) return (c.category || '') === '디자인';
    return /^G-130|부스\s*디자인\s*의뢰/.test(String(i.name || ''));
  });
}
export const designPill = (x) => hasDesignOrder(x)
  ? ` <span class="pill p-teal" style="font-size:var(--fs-9)"
      title="부스 디자인까지 의뢰한 곳이에요 — 디자인을 받는 게 아니라 우리가 그려서 출력·시공합니다">디자인 의뢰</span>` : '';

export const BASE_KINDS = {
  fascia: { label: '간판명', cls: 'p-purple', recv: '간판명 확정', done: '간판 제작', types: ['Octanium (Standard)', 'Octanium (Black)'] },
  print:  { label: '출력·시공', cls: 'p-blue', recv: '디자인 수령', done: '출력 완료',
            types: ['Block System A', 'Block System B', 'Block System C', 'Lighting Booth'] },
};

export function baseKind(x){
  if(isBookOnly(x)) return '';
  /* 공동 부스에서 부스 수에서 빠진 쪽은 기본 시공도 받을 게 없다 — 간판·벽면
     그래픽은 부스를 대표한 기관이 한 번 보낸다(2026 KIC 부스 39: 서울대학교병원이
     다 보냈고 분당서울대학교병원은 금액만 나눠 낸다). 남겨 두면 «미수령»으로
     영영 남아 독촉 대상에 섞인다. */
  if(isSharedBooth(x)) return '';
  const t = String(x.booth_type || '').trim();
  if(!t) return '';
  return Object.keys(BASE_KINDS).find(k => BASE_KINDS[k].types.includes(t)) || '';
}

/* ── 기본 제공 시공은 그래픽 항목 위에서 돈다 ──

   부스 타입이 깔아 주는 것(간판·벽면 그래픽)은 그래픽 항목으로 들어온다.
   전에는 그 사실을 기업 칸(base_recv_at/base_done_at)에 따로 적어서, 같은 일이
   두 군데에 적혔다 — 스물두 곳 중 열세 곳이 그래픽에는 «받음», 기본 시공에는
   «미수령»이었다. 그 화면만 보고 독촉하면 이미 보낸 곳에 독촉이 나간다.

   이제 정본은 항목 줄이다. 기업 칸은 항목이 아직 없는 기업을 위해서만 읽는다.
   여럿이면 전부 와야 «받음»이고 전부 끝나야 «완료»다 — 하나가 비었는데 완료로
   보이면 그 한 장을 아무도 안 찾는다. */
export function baseItems(x){
  return liveItemsFor(x.id).filter(i => (i.category || '') === 'graphic' && isBoothGiven(i));
}
/* 이름을 바꾸기 전에 쓰던 자리 — 드로어가 아직 이 이름으로 부른다 */
export const baseRecvItems = baseItems;

const allDate = (items, field) => {
  if(items.some(i => !String(i[field] || '').trim())) return '';
  return items.map(i => String(i[field] || '')).sort().pop();
};
export function baseRecvAt(x){
  const gi = baseItems(x);
  return gi.length ? allDate(gi, 'received_at') : String(x.base_recv_at || '').trim();
}
export function baseDoneAt(x){
  const gi = baseItems(x);
  return gi.length ? allDate(gi, 'done_at') : String(x.base_done_at || '').trim();
}

/* 화면에서 고친 날짜도 항목으로 들어간다 — 읽는 곳과 쓰는 곳이 다르면
   고쳐도 화면이 안 바뀐다. 항목이 없는 기업만 옛 기업 칸에 적는다. */
async function setBaseDate(exhId, field, itemField, v, label){
  const x = getExhibitorById(exhId);
  if(!x) return;
  const gi = baseItems(x);
  if(!gi.length){ await patchExh(exhId, { [field]: v }, label); return; }
  /* 항목 저장은 드로어가 갖고 있다 — 이 파일이 그쪽을 import하면 순환 참조라
     window 경유로 부른다(이 파일의 다른 드로어 호출과 같은 방식). */
  for(const i of gi) await window.setItemField?.(i.id, itemField, v);
  refreshExhViews();
}
export const setBaseRecvAt = (exhId, v) =>
  setBaseDate(exhId, 'base_recv_at', 'received_at', v, '디자인 수령·간판명 확정');
export const setBaseDoneAt = (exhId, v) =>
  setBaseDate(exhId, 'base_done_at', 'done_at', v, '기본 시공 완료');
/* 우리가 하는 일은 날짜를 받지 않는다 — 됐다/안 됐다만 누른다. 값은 누른 날로
   적히지만 화면은 체크만 보여 준다(스무 줄을 날짜로 채우게 하지 않는다). */
export const toggleBaseDone = (exhId) =>
  setBaseDoneAt(exhId, baseDoneAt(getExhibitorById(exhId) || {}) ? '' : td());
/* 드로어와 목록이 같은 단추를 쓴다 — 한쪽만 체크로 바뀌면 어느 쪽이 맞는지
   다시 확인하게 된다. */
export function baseDoneCheck(x, extra = ''){
  const on = baseDoneAt(x);
  const got = baseRecvAt(x);
  return `<button onclick="event.stopPropagation();toggleBaseDone('${escAttr(x.id)}')"
    class="pill ${on ? 'p-green' : got ? 'p-amber' : 'p-gray'}"
    style="border:0;cursor:pointer;font:inherit;padding:0 10px;${extra}"
    title="${on ? `${escAttr(on)}에 했어요 — 누르면 되돌립니다` : '누르면 «했음»으로 표시합니다'}">${
    on ? '✓ 했음' : '안 했음'}</button>`;
}

/* 어디까지 왔나. 받는 것과 만드는 것이 따로라 두 단계로 본다 —
   "디자인은 왔는데 아직 안 뽑았다"가 제일 흔한 상태이고, 그걸 완료로 묶으면
   출력소에 넘길 목록을 다시 손으로 세게 된다. */
export function baseState(x){
  const k = baseKind(x);
  if(!k) return { state: 'na' };
  /* 간판명은 도록 이름에서 자동으로 채워지니 «적혀 있다»가 «받았다»는 뜻이
     못 된다. 사람이 확정한 날(base_recv_at)로만 판단한다. */
  // 간판은 영문명이 있어야 만든다. 확정 도장을 찍었어도 이름이 없으면 못 만든다.
  if(k === 'fascia' && !fasciaName(x)) return { state: 'warn', text: '영문명 없음' };
  const got = baseRecvAt(x);
  if(!got)             return { state: 'todo', text: '미수령' };
  if(!baseDoneAt(x))   return { state: 'part', text: '수령 · 작업 전' };
  return { state: 'done', text: BASE_KINDS[k].done };
}

export function graphicState(x){
  if(!x.graphic_ordered_at) return { state: 'none' };
  if(x.graphic_type === 'print'){
    if(x.graphic_spec_ok === 'no') return { state: 'warn', text: '규격 확인' };
    return x.graphic_spec_ok === 'yes' ? { state: 'done', text: '출력' } : { state: 'todo', text: '규격 미확인' };
  }
  if(x.graphic_type === 'design'){
    if(x.graphic_final_at)   return { state: 'done', text: '최종안' };
    if(x.graphic_revised_at) return { state: 'todo', text: '수정안' };
    if(x.graphic_draft_at)   return { state: 'todo', text: '초안' };
    return { state: 'todo', text: '진행 전' };
  }
  return { state: 'todo', text: '유형 미정' };
}

/* 담당자 한 줄(exhibitor_contacts 레코드)을 화면용으로 푼다.
   contact_id가 있으면 마스터DB(contacts)에서 실시간으로 읽는다 — 값을 복사해두면
   마스터DB에서 이메일을 고쳐도 전시 쪽은 옛 값으로 남기 때문이다.
   마스터DB에 없는 사람은 그 줄에 직접 적은 값을 쓴다. */
export function resolveContact(row){
  if(!row) return null;
  if(row.contact_id){
    const c = contacts.find(k => String(k.id) === String(row.contact_id));
    if(c) return {
      row, linked: true, id: c.id,
      /* 퇴사 여부도 여기서 같이 푼다 — 전시 담당자는 전부 이 함수를 거치므로
         한 곳만 채우면 목록·표·드로어가 함께 알게 된다. 숨기지는 않는다:
         그 행사의 담당자가 그 사람이었던 건 지금도 사실이다. */
      left_at: c.left_at || '', moved_to_id: c.moved_to_id || '',
      name:  c.nameKo || c.nameEn || '',
      email: cleanEmail(c.email1),
      phone: c.phone1 || '',
      title: c.titleKo || c.titleEn || '',
      role:  row.role || '', primary: row.is_primary === 'yes',
    };
  }
  return { row, linked: false, id: null, name: row.name || '', email: cleanEmail(row.email),
    phone: row.phone || '', title: '', role: row.role || '', primary: row.is_primary === 'yes',
    left_at: '', moved_to_id: '' };
}

/* 이 기업의 담당자 전원 (메인이 맨 앞) */
export function exhContacts(x){
  return contactsFor(x.id).map(resolveContact).filter(Boolean);
}
/* 메인 담당자 — 목록/헤더에 한 명만 보여줄 때 */
export function exhContact(x){
  return resolveContact(primaryContactFor(x.id))
    // 아직 담당자 줄이 없는 기업은 빈 값으로 (화면이 깨지지 않게)
    || { row: null, linked: false, id: null, name: '', email: '', phone: '', title: '', role: '', primary: false };
}

/* 이 기업의 마스터DB 연락처 후보 — 드로어 드롭다운에 쓴다 */
/* 이 기업의 마스터DB 연락처 — 기업 연결(org_id)이 있으면 그걸 쓴다.
   이름 문자열로 맞추면 표기가 조금만 달라도 사람이 통째로 빠진다. 아직 연결이
   없는 옛 연락처를 위해 이름 대조도 남겨 둔다. */
export function contactsForExhibitor(x){
  if(!x) return [];
  const key = x.company_key || '';
  const nameKey = normalizeCompanyKey(x.company_name || '');
  return contacts.filter(c => {
    if(x.org_id && c.org_id) return c.org_id === x.org_id;
    const k = normalizeCompanyKey(c.orgKo || c.orgEn || '');
    return k && (k === key || k === nameKey);
  });
}

/* 진행률 바 — components.css 규약이 .br(행) > .brt(트랙) > .brf(채움)인데
   .brt를 빼거나 .brf에 배경을 안 주면 막대가 아예 보이지 않는다. */
export function progressBar(pct, color = 'var(--a)', width = ''){
  return `<div class="br" style="margin:0${width ? `;width:${width}` : ''}">
    <div class="brt"><div class="brf" style="width:${Math.max(0, Math.min(100, pct))}%;background:${color}"></div></div>
  </div>`;
}

/* 표에 넣을 짧은 표시값 — 날짜(YYYY-MM-DD)는 월-일만 남기고, 그 외 상태 문자열은
   그대로 쓴다. 예전에는 무조건 5글자를 잘라 '규격 미확인'이 '인'으로 보였다. */
export function shortCell(v){
  const s = String(v || '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(5, 10) : s;
}


/* 셀 상태 계산 — 완료(done) / 미완(todo) / 주의(warn) */
/* 아직 못 끝낸 단계에 마감일이 걸려 있으면 그 사실을 칸에 얹는다.
   지난 건 눈에 띄게 경고로 올리고, 임박한 건 색을 바꾸지 않고 남은 날만 붙인다 —
   아직 늦지 않은 걸 빨갛게 칠하면 진짜 늦은 것과 구분이 안 된다. */
export const DUE_SOON_DAYS = 7;
function withDue(c, x, step){
  if(c.state === 'done' || c.state === 'na') return c;
  const d = dueInfo(step.key, x.event_id);
  if(!d) return c;
  if(d.days < 0) return { ...c, state: 'warn', due: d, text: c.text || `${-d.days}일 지남` };
  if(d.days <= DUE_SOON_DAYS) return { ...c, due: d, text: c.text || (d.days === 0 ? '오늘 마감' : `D-${d.days}`) };
  return { ...c, due: d };
}

export function cellState(x, step){ return withDue(rawCellState(x, step), x, step); }

/* 요청한 단계의 기다림·리마인더 — 기업에서 받아야 끝나는 단계를 요청했는데 아직 안 왔으면.
   공은 기업에 있지만, 날이 차면 리마인더가 우리 일이다(follow-up.js). 끝났거나 아직 안 보냈으면 null */
export function exhFollowOf(x, st){
  if(!st || st.custom || st.lib || st.key === 'note' || st.key === 'booth_change') return null;
  const step = st.due && STEPS.find(s => s.key === st.due);
  if(!step) return null;
  const c = cellState(x, step);
  if(c.state === 'done' || c.state === 'na') return null;
  const logs = logsFor(x.id);
  const sends = logs.filter(l => l.kind === `exh-${st.key}` && l.direction !== 'in').map(l => l.ts);
  if(!sends.length) return null;
  const f = followState({ evKey: x.event_id, sends, due: ((EXH_CFG[x.event_id] || {}).due || {})[st.due], logs, stepKey: st.key });
  return f.state === 'ask' ? null : f;
}


export function rawCellState(x, step){
  // 프로그램북만 참가하는 곳은 도록 외에는 받을 것이 없다
  if(isBookOnly(x) && step.key !== 'directory_received_at') return { state: 'na' };
  if(step.key === 'calc:invoice'){
    const inv = invoicesFor(x.id).filter(i => i.status !== 'void');
    if(!inv.length) return { state: 'todo' };
    const sent = inv.filter(i => i.sent_at);
    if(!sent.length) return { state: 'warn', text: '미발송' };
    // 금액이 안 적힌 인보이스가 있으면 청구액이 실제보다 적게 잡힌다 — 눈에 띄게 한다
    if(inv.some(i => String(i.amount ?? '').trim() === '')) return { state: 'warn', text: '금액 미입력' };
    return { state: 'done', text: sent.length > 1 ? `${sent.length}건` : sent[0].sent_at };
  }
  if(step.key === 'calc:tax'){
    // 발행 완료의 기준은 (예전부터 그랬듯) 발행일이 적혀 있느냐다 — 단계값(stage)은
    // 재촉 대상을 가리는 용도일 뿐이라, 단계를 안 넘기고 날짜만 적어도 완료로 본다.
    // 여기서 stage만 보게 바꿨다가 날짜는 있는데 단계가 안 넘어간 건들이 전부
    // "완료"에서 빠지는 회귀가 있었다.
    /* 누가 대상인지는 taxNeed가 정한다 — 드로어·처리 필요 목록도 같은 판정을
       쓴다. 화면마다 따로 가르면 한 곳만 고쳤을 때 숫자가 갈린다. */
    const need = taxNeed(x);
    if(need.kind === 'na')    return { state: 'na',   text: need.why };
    if(need.kind === 'check') return { state: 'warn', text: need.why };
    if(need.kind === 'pre')   return { state: 'warn', text: need.why };
    if(need.kind === 'after') return { state: 'todo', text: need.why };
    const tx = need.tx;
    const sent = tx.filter(t => t.sent_at);
    if(!sent.length) return { state: 'warn', text: stageOf(TAX_STAGES, tx[0].stage).label };
    if(tx.some(t => String(t.amount ?? '').trim() === '')) return { state: 'warn', text: '금액 미입력' };
    return { state: 'done', text: sent.length > 1 ? `${sent.length}건` : sent[0].sent_at };
  }
  if(step.key === 'calc:payment'){
    const s = settleState(x);
    if(s.state === 'settled') return { state: 'done', text: '완납 처리' };
    if(s.state === 'paid')    return { state: 'done', text: '완납' };
    if(s.state === 'over')    return { state: 'warn', text: '초과 입금' };
    if(s.state === 'none')    return { state: 'todo' };
    if(s.state === 'partial') return { state: 'part', text: Math.round(s.paid / s.billed * 100) + '%' };
    return s.overdue ? { state: 'warn', text: '기한 지남' } : { state: 'todo' };
  }
  if(step.key === 'calc:graphic'){
    const g = graphicState(x);
    if(g.state === 'none') return { state: 'na' };
    return g;
  }
  if(step.key === 'calc:base') return baseState(x);
  if(step.key === 'calc:design'){
    if((x.booth_type || '') !== SELF_BUILD_TYPE) return { state: 'na' };
    const d = boothDesignState(x);
    return d.state === 'none' ? { state: 'todo' } : d;
  }
  const v = x[step.key];
  // 관리대장에 O/X만 있고 날짜가 없는 항목이 많다. 날짜를 지어내지 않되
  // "받았다"는 사실은 완료로 인정한다(날짜가 없으면 ✓만 표시).
  const done = v || (step.flag && x[step.flag] === 'yes');
  if(step.warn && step.warn(x)) return { state: 'warn', text: v || '' };
  return done ? { state: 'done', text: v || '' } : { state: 'todo' };
}

/* 기업별 진행률 — 해당 없음(그래픽 미주문)은 분모에서 제외 */
export function progressOf(x){
  let done = 0, total = 0;
  STEPS.forEach(s => {
    const c = cellState(x, s);
    if(c.state === 'na') return;
    total++;
    if(c.state === 'done') done++;
  });
  return total ? Math.round(done / total * 100) : 0;
}

/* ══════════════════════════════════════════
   사이드바
══════════════════════════════════════════ */
/* 고를 수 있는 행사 목록.
   events 테이블(EVENT_LIST)에 등록되지 않았는데 participations에는 전시참가기업으로
   올라와 있는 행사가 실제로 존재한다(업로드 시 행사를 따로 만들지 않은 경우).
   그런 행사도 전시 관리 대상이므로 key만으로 만들어 함께 보여준다. */
export function exhEventOptions(){
  const map = new Map(EVENT_LIST.map(e => [e.key, e]));
  const addLoose = (key) => {
    if(!key || map.has(key)) return;
    map.set(key, { key, name: key, short: key, color: '#9C9890', loose: true });
  };
  participations.forEach(p => {
    if(EXH_ROLES.includes(String(p.role || '').trim())) addLoose(p.eventId);
  });
  EXHIBITORS.forEach(x => addLoose(x.event_id));
  return [...map.values()];
}

export function buildExhEvList(){
  const el = document.getElementById('exh-ev-list');
  if(!el) return;
  const opts = exhEventOptions();

  /* 지금 챙길 것만 위에 둔다. 끝난 행사도 열어 봐야 할 때가 있으니 지우지 않고
     아래로 내린다 — 목록이 길어지면 정작 오늘 볼 행사를 눈으로 찾아야 한다.

     EVENT_LIST에 없는 느슨한 행사(참여 기록에만 있는 것)는 설정이 없어
     기본값인 진행 중으로 잡힌다. */
  const hasWork = (k) => exhibitorsForEvent(k).length || window.exhibitorCandidates(k).length;
  const stateOf = (e) => evPartState(e.key, 'exh');

  const doing = opts.filter(e => stateOf(e) === 'doing' && hasWork(e.key));
  const done  = opts.filter(e => stateOf(e) === 'done');
  const off   = opts.filter(e => stateOf(e) === 'none');
  const empty = opts.filter(e => stateOf(e) === 'doing' && !hasWork(e.key));

  // 처음 열 때는 진행 중인 행사를 고른다 — 끝난 행사가 먼저 열리면 손댈 수 없는
  // 화면부터 보게 된다
  if(!exhEvent || !opts.some(e => e.key === exhEvent)){
    const first = doing[0] || done[0] || empty[0] || off[0];
    if(first) setExhEvent(first.key);
  }

  const row = (e, n) => `<button class="nr${exhEvent === e.key ? ' on' : ''}" onclick="setExhEvent2('${escAttr(e.key)}')">
      <span class="ev-pill-dot" style="background:${escAttr(e.color || '#9C9890')}"></span>${escapeHtml(e.short || e.name || e.key)}
      ${n ? `<span class="nbg">${n}</span>` : ''}</button>`;

  const head = (t) => `<div style="font-size:var(--fs-10);color:var(--i4);margin:10px 0 4px;padding-left:2px">${t}</div>`;
  const group = (arr, title, withCount) => arr.length
    ? (title ? head(title) : '') + arr.map(e => row(e, withCount ? activeExhibitors(e.key).length : 0)).join('')
    : '';

  /* 설정에서 전시를 «안 함»으로 둔 행사는 목록에서 뺀다 — 고를 일이 없는데 자리만
     차지했다. 몇 개가 빠졌는지와 켜는 곳만 한 줄로 남긴다.

     참가기업이 아직 없는 진행 중 행사(예전 «전시 대상 없음»)는 따로 묶지 않고
     진행 중 맨 뒤에 둔다 — 그 행사를 열어야 참가기업을 넣을 수 있으니 숨길 수 없고,
     «안 함»과 이름이 비슷해 둘을 헷갈렸다. */
  const hiddenNote = off.length
    ? `<div style="font-size:var(--fs-10);color:var(--i5);margin:10px 0 0;padding-left:2px"
         title="${escapeHtml(off.map(e => e.short || e.name || e.key).join(', '))}">전시 안 하는 행사 ${off.length}개는 숨겼어요 — 설정 › 행사 관리에서 켜요</div>`
    : '';
  el.innerHTML = ((
      group([...doing, ...empty], '', true)
    + group(done,  '진행 완료', true)
  ) || '<div style="font-size:var(--fs-11);color:var(--i4);padding:6px 2px">진행 중인 전시가 없어요</div>') + hiddenNote;

  buildExhFilters();
}

/* 필터는 사이드바에서 본문 목록 바로 위 칩으로 옮겼다 — «고른 행사 안에서 거르는
   것»이라 행사를 고르는 사이드바보다 거를 목록 곁에 있어야 한다. 0건인 칩은
   숨긴다(지금 켜 둔 칩은 0이어도 남겨서 끌 수 있게). */
function buildExhFilters(){}
function exhFilterChipsHtml(){
  const list = activeExhibitors(exhEvent);
  const openInq = list.reduce((s, x) => s + openInquiriesFor(x.id).length, 0);
  const incomplete = list.filter(x => progressOf(x) < 100).length;
  const overdue = list.filter(x => isOverdue(settleState(x))).length;
  const waiting = list.filter(x => isWaiting(settleState(x))).length;
  const cancelled = cancelledExhibitors(exhEvent).length;
  const refund = cancelledExhibitors(exhEvent).filter(refundDue).length;
  // 초과 입금·통화 혼재·금액 미입력처럼 사람이 봐야 하는 정산 건
  const attention = list.filter(x => settleState(x).state === 'over' ||
    invoicesFor(x.id).some(i => i.status !== 'void' && String(i.amount ?? '').trim() === '')).length;
  const f = (k, label, n, tip = '') => (n || k === 'all' || exhUi.exhFilter === k)
    ? `<button class="btn bs${exhUi.exhFilter === k ? ' bp' : ''}" style="font-size:var(--fs-11);padding:3px 10px;gap:5px"
        title="${escapeHtml(tip)}" onclick="setExhFilter('${k}')">${label}<span style="${exhUi.exhFilter === k ? '' : 'color:var(--i4);'}font-weight:700">${n}</span></button>`
    : '';
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:10px 16px 0">
    ${f('all', '전체', list.length, '참가 취소 기업은 빼고 셉니다')}${
      f('incomplete', '준비 중', incomplete, '신청서·부스·그래픽 같은 준비 단계가 아직 다 끝나지 않은 기업')}${
      f('ready', '준비 완료', list.length - incomplete, '준비 단계를 모두 마친 기업')}${
      f('overdue', '입금 기한 지남', overdue, '입금 기한이 지났는데 잔액이 남은 기업 — 챙겨야 할 곳')}${
      f('waiting', '입금 예정', waiting, '잔액이 남았지만 기한 전이거나(행사 후 납부 합의 포함) 기한이 없는 기업')}${
      f('inquiry', '미답변 문의', openInq)}${f('billing', '정산 확인 필요', attention)}${
      f('cancelled', '참가 취소', cancelled, '목록과 금액 집계에서 빠진 기업')}${
      f('refund', '환불 확인 필요', refund, '참가 취소했는데 낸 돈이 남아 있는 기업')}
  </div>`;
}

/* 하단 네비 배지 — 미답변 문의가 있으면 숫자를 띄운다(놓치지 않는 게 핵심 기능이라
   다른 탭에 있어도 보이게). */
function updateExhBadge(){
  const el = document.getElementById('mn-exh-badge');
  if(!el) return;
  const n = activeExhibitors(exhEvent).reduce((s, x) => s + openInquiriesFor(x.id).length, 0);
  el.textContent = n > 99 ? '99+' : String(n);
  el.style.display = n ? 'block' : 'none';
}

export function setExhView(v){
  // 폴더 이름은 권한을 묻지 않고 읽는다 — 그림을 그리다 권한 창이 뜨면 안 된다
  if(v === 'watch') initWatchFolders(exhEvent);
  // 부스 타입으로 걸러 둔 채 다른 보기로 갔다가 돌아오면, 왜 목록이 짧은지
  // 알 수 없다. 보기를 옮기거나 행사를 바꾸면 푼다.
  if(v !== 'booth') exhUi.boothTypeFil = '';
  if(v !== 'money') exhUi.payFil = 'all';
  if(v !== 'list') exhUi.stepFil = null;
  exhUi.exhView = v; renderExh();
}
export function setExhEvent2(key){
  exhUi.boothTypeFil = '';
  exhUi.payFil = 'all';
  setExhEvent(key);
  buildExhEvList();
  renderExh();
  /* 인보이스 저장 폴더는 행사마다 다르다 — 어느 폴더에 저장되는지 화면에 적으려면
     행사를 바꿀 때 다시 읽어야 한다(exh-invoice.js가 소유, window 경유). */
  window.initInvoiceFolder?.(key);
}
export function setExhFilter(k){ exhUi.exhFilter = k; exhUi.stepFil = null; buildExhFilters(); renderExh(); }

/* ══════════════════════════════════════════
   메인 — 미답변 문의 패널 + 기업리스트 표
══════════════════════════════════════════ */
/* ── 참가기업 이름 검색 ──
   전에는 company_name(국문) 하나만 봤다. 국문명이 아예 없고 영문만 있는 기업이
   있어서(화면에는 영문이 뜬다) 보이는 이름 그대로 쳐도 안 걸렸다.

   기업DB 검색과 같은 규칙을 쓴다 — 친 그대로 먼저 견주고(부분어·띄어쓰기 포함
   검색을 살린다), 안 걸리면 양쪽에서 법인격 표기와 기호·공백을 눌러 없앤 뒤
   다시 견준다. 옛 사명(별칭)으로도 찾을 수 있어야 한다. */
function matchExhName(x, q){
  const lq = String(q || '').trim().toLowerCase();
  if(!lq) return true;
  /* 번호로도 찾는다 — 기업 대표번호, 담당자(마스터DB 번호 포함), 프로그램북·세금계산서 번호 */
  if(phoneMatch(lq, getOrgById(x.org_id)?.phone, x.book_phone, x.tax_contact_phone,
    exhContacts(x).map(c => c.phone))) return true;
  const squash = (v) => String(v || '').toLowerCase()
    .replace(/\(주\)|\(유\)|주식회사|㈜|유한회사|inc\.?|corp\.?|co\.?|ltd\.?|llc\.?/g, '')
    .replace(/[^a-z0-9가-힣]/g, '');
  const sq = squash(lq);

  const o = x.org_id ? getOrgById(x.org_id) : null;
  const fields = [x.company_name, o?.name_ko, o?.name_en, o?.abbr,
    ...String(o?.aliases || '').split('\n')].filter(Boolean);

  return fields.some(v => String(v).toLowerCase().includes(lq))
    || (!!sq && fields.some(v => squash(v).includes(sq)));
}

/* 모바일 검색칸 — 데스크톱 칸과 값을 맞춰 두고 다시 그린다. 둘이 서로 다른
   값을 들고 있으면 어느 쪽이 지금 걸린 조건인지 알 수 없다. */
export function searchExhM(v){
  const d = document.getElementById('exh-q');
  if(d) d.value = v;
  renderExh();
}

/* 지금 걸린 검색어 — 데스크톱 칸이 숨어 있는 모바일에서는 모바일 칸을 본다 */
function exhQuery(){
  return ((document.getElementById('exh-q')?.value
    || document.getElementById('exh-q-m')?.value || '')).trim().toLowerCase();
}

export function visibleList(){
  const q = exhQuery();
  let list = ['cancelled', 'refund'].includes(exhUi.exhFilter) ? cancelledExhibitors(exhEvent) : activeExhibitors(exhEvent);
  if(exhUi.exhFilter === 'incomplete') list = list.filter(x => progressOf(x) < 100);
  if(exhUi.exhFilter === 'ready')      list = list.filter(x => progressOf(x) >= 100);
  if(exhUi.exhFilter === 'overdue')    list = list.filter(x => isOverdue(settleState(x)));
  if(exhUi.exhFilter === 'waiting')    list = list.filter(x => isWaiting(settleState(x)));
  if(exhUi.exhFilter === 'refund')     list = list.filter(refundDue);
  if(exhUi.exhFilter === 'billing')    list = list.filter(x => { const s = settleState(x);
    return s.state === 'over' ||
      invoicesFor(x.id).some(i => i.status !== 'void' && String(i.amount ?? '').trim() === ''); });
  if(exhUi.exhFilter === 'inquiry')    list = list.filter(x => openInquiriesFor(x.id).length);
  if(exhUi.stepFil){
    const step = STEPS.find(s => s.key === exhUi.stepFil.key);
    if(step) list = list.filter(x => {
      const st = cellState(x, step).state;
      if(st === 'na') return false;                 // 해당 없는 곳은 양쪽 다 아니다
      return exhUi.stepFil.mode === 'done' ? st === 'done' : st !== 'done';
    });
  }
  if(q) list = list.filter(x => matchExhName(x, q));
  return list.sort((a, b) => String(a.company_name || '').localeCompare(String(b.company_name || ''), 'ko'));
}

export function renderExh(){
  const el = document.getElementById('exh-body');
  if(!el) return;

  const ev = exhEventOptions().find(e => e.key === exhEvent);
  const ttl = document.getElementById('exh-ttl');
  if(ttl) ttl.innerHTML = `전시 진행관리 <span class="tb-s">${ev ? escapeHtml(ev.short || ev.name) + ' · ' : ''}참가기업 준비 현황</span>`;
  // 모바일 헤더 제목은 행사명으로 (화면이 좁아 부제를 넣을 자리가 없다)
  const mttl = document.getElementById('mob-exh-ttl');
  if(mttl) mttl.textContent = ev ? (ev.short || ev.name || '전시 진행관리') : '전시 진행관리';
  updateExhBadge();

  // 이 행사가 전시를 안 하기로 돼 있으면 목록을 열지 않는다 — 참가기업이
  // 남아 있어도 지금 다룰 일이 아니고, 여기서 손대면 설정과 화면이 어긋난다
  if(exhEvent && !evPartOn(exhEvent, 'exh')){
    el.innerHTML = `<div class="empty" style="height:auto;padding:60px 20px;text-align:center">
      <div style="font-size:30px;margin-bottom:10px">🚧</div>
      <div style="font-weight:700;margin-bottom:6px">이 행사는 전시를 진행하지 않아요</div>
      <div style="font-size:var(--fs-12);color:var(--i4)">설정 › 행사 관리에서 이 행사를 고른 뒤
        <b>진행 파트</b>에서 전시를 켜면 다시 열립니다.</div></div>`;
    return;
  }

  /* 끝난 행사임을 화면 맨 위에 못박아 둔다 — 입력이 안 먹는 이유를 모른 채
     헤매게 두면 안 된다. 참가기업이 하나도 없을 때도 보여야 해서 빈 화면보다
     앞에 둔다. */
  const banner = exhLocked() ? `<div style="display:flex;align-items:center;gap:9px;margin:10px 16px 0;
      background:var(--i8);border:1px solid var(--i6);border-left:3px solid var(--g);border-radius:var(--r);padding:9px 13px">
    <span class="pill p-green">진행 완료</span>
    <span style="font-size:var(--fs-11_5);color:var(--i3)">끝난 행사라 열람만 됩니다. 고치려면 설정 › 행사 관리 › 진행 파트에서 <b>진행 중</b>으로 되돌리세요.</span>
  </div>` : '';

  const list = visibleList();
  const all = activeExhibitors(exhEvent);

  if(!all.length){
    el.innerHTML = banner + `<div class="empty" style="height:auto;padding:60px 20px;text-align:center">
      <div style="font-size:30px;margin-bottom:10px">🏢</div>
      <div style="font-weight:700;margin-bottom:6px">등록된 참가기업이 없어요</div>
      ${exhLocked()
        ? '<div style="font-size:var(--fs-12);color:var(--i4)">진행 완료된 행사예요 — 참가기업 없이 끝났거나, 기록이 다른 행사에 들어가 있을 수 있어요.</div>'
        : `<div style="font-size:var(--fs-12);color:var(--i4);margin-bottom:14px">
             기업DB에 "전시참가기업"으로 기록된 기업을 불러오거나 직접 추가할 수 있어요</div>
           <button class="btn" onclick="openExhAdd()">참가기업 추가</button>
           <button class="btn bp" onclick="openExhImport()">참가기업 불러오기</button>`}
    </div>`;
    return;
  }

  /* 보기 전환 — 진행 전체를 보는 두 가지(대시보드·기업리스트) 다음에,
     실무를 품목 단위로 처리하는 세 가지를 둔다. 부스·비품·그래픽은 각각
     담당이 갈리고 마감도 달라서, 기업별 드로어를 51번 열지 않고 한 화면에서
     끝낼 수 있어야 한다. */
  const VIEWS = [['dash','대시보드'], ['list','기업리스트'],
    ['booth','부스 현황'], ['equip','비품 현황'], ['graphic','그래픽 현황'],
    ['money','금액 현황'], ['book','프로그램북'], ['onsite','현장 처리'],['watch','파일 감시']];
  const seg = `<div class="tbar" style="padding:10px 16px 0">
    <div class="seg" style="flex-wrap:wrap">
      ${VIEWS.map(([k, l]) => `<button class="seg-b${exhUi.exhView === k ? ' on' : ''}" onclick="setExhView('${k}')">${l}</button>`).join('')}
    </div></div>`;

  /* 검색은 목록을 거르는 일인데, 대시보드와 파일 감시에는 거를 목록이 없다.
     그 두 화면에서는 무엇을 쳐도 화면이 그대로여서 «검색이 안 된다»로 보였다.
     모바일은 대시보드가 첫 화면이라 특히 그랬다. 그래서 검색어가 들어오면
     기업리스트를 대신 보여준다 — 보기 설정은 건드리지 않아서, 검색어를 지우면
     보던 화면으로 그대로 돌아온다. */
  const q = exhQuery();
  const searchOverride = !!q && (exhUi.exhView === 'dash' || exhUi.exhView === 'watch');
  const searchNote = searchOverride ? `<div style="display:flex;align-items:center;gap:8px;margin:12px 16px 0;
      background:var(--i8);border:1px solid var(--i6);border-radius:var(--r);padding:8px 12px">
    <span style="font-size:var(--fs-11_5);color:var(--i3)">«<b>${escapeHtml(q)}</b>» 검색 결과 ${list.length}곳 —
      검색어를 지우면 ${exhUi.exhView === 'dash' ? '대시보드' : '파일 감시'}로 돌아갑니다</span></div>` : '';

  const bodyHtml = searchOverride ? searchNote + renderInquiryPanel() + renderChecklist(list, all)
    : exhUi.exhView === 'dash'    ? window.renderDashboard(all)
    : exhUi.exhView === 'booth'   ? window.renderBoothView(list)
    : exhUi.exhView === 'equip'   ? window.renderEquipView(list)
    : exhUi.exhView === 'graphic' ? window.renderGraphicView(list)
    : exhUi.exhView === 'base'    ? window.renderGraphicView(list)   /* 옛 주소로 들어와도 그래픽으로 */
    : exhUi.exhView === 'money'   ? window.renderMoneyView(list)
    : exhUi.exhView === 'book'    ? window.renderBookView(list)
    : exhUi.exhView === 'onsite'  ? renderOnsiteView(list)
    : exhUi.exhView === 'watch'   ? `<div style="padding:14px 16px 40px">${renderWatchView(exhEvent)}</div>`
    : renderInquiryPanel() + renderChecklist(list, all);
  // 거를 목록이 없는 화면(대시보드·파일 감시)에는 필터 칩도 두지 않는다
  const chips = (searchOverride || !['dash', 'watch'].includes(exhUi.exhView)) ? exhFilterChipsHtml() : '';
  el.innerHTML = seg + chips + banner
    + (exhLocked() ? `<div class="ro">${bodyHtml}</div>` : bodyHtml);
}

/* 미답변 문의 패널 — 프로세스와 무관하게 들어오는 문의를 놓치지 않는 게 목적이라
   화면 최상단에 두고 오래된 것부터 보여준다. */
function renderInquiryPanel(){
  // 취소 기업은 사이드바 카운트·하단 배지·필터에서 빠지므로 여기서도 빼서
  // "패널엔 보이는데 클릭하면 목록에 없는" 상태를 막는다.
  const list = activeExhibitors(exhEvent);
  const open = [];
  list.forEach(x => openInquiriesFor(x.id).forEach(l => open.push({ l, x })));
  if(!open.length) return '';
  open.sort((a, b) => String(a.l.ts || '').localeCompare(String(b.l.ts || '')));

  return `<div class="uc" style="margin:14px 16px;border-left:3px solid var(--am)">
    <div class="uc-ttl" style="display:flex;align-items:center;gap:8px">
      <span>미답변 문의</span><span class="pill p-amber">${open.length}건</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:1px;margin-top:8px">
      ${open.slice(0, 8).map(({ l, x }) => {
        const d = daysSince(l.ts);
        return `<div onclick="openExhDr('${escAttr(x.id)}','logs')" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--rd-6);cursor:pointer;background:var(--i9)">
          <span style="font-weight:700;font-size:var(--fs-12);min-width:120px">${escapeHtml(exhNames(x).ko)}${
            exhNames(x).en ? `<span style="font-weight:400;color:var(--i4);font-size:var(--fs-10_5);margin-left:4px">${escapeHtml(exhNames(x).en)}</span>` : ''}</span>
          <span style="font-size:var(--fs-12);color:var(--i2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l.subject || l.body || '(내용 없음)')}</span>
          ${l.status === 'hold' ? '<span class="pill p-gray">확인 중</span>' : ''}
          <span class="pill ${d >= 3 ? 'p-amber' : 'p-gray'}">${d === 0 ? '오늘' : d + '일 경과'}</span>
        </div>`;
      }).join('')}
      ${open.length > 8 ? `<div style="font-size:var(--fs-11);color:var(--i4);padding:6px 10px">외 ${open.length - 8}건</div>` : ''}
    </div></div>`;
}

/* ── 지난 행사와 견주기 (신규 · 재참가 · 이탈) ──
   "이 회사가 작년에도 왔나"는 플래그로 적어 두면 왜 그런 판정인지 되짚을 수 없고
   해마다 다시 적어야 한다. 지난 행사의 참가기업을 같은 모양(exhibitors)으로
   넣어 두고 계산한다 — 근거가 데이터에 남고, "작년엔 왔는데 올해 안 온 곳"까지
   덤으로 나온다(내년 영업 타겟이다).

   어느 행사가 "지난 행사"인가는 설정(exh_cfg.prev)으로 정한다. 날짜로 자동
   추정하면 날짜를 안 채운 행사에서 조용히 엉뚱한 곳을 가리킨다. */
export function prevEventKey(evKey){
  const ev = evKey || exhEvent;
  const set = exhCfg(ev).prev;
  if(set) return set;
  /* 설정이 없으면 날짜가 이 행사보다 앞선 행사 중 가장 최근 것.
     날짜가 없는 행사는 견줄 수 없으니 뺀다. */
  const here = EVENT_LIST.find(e => e.key === ev);
  const mine = here && here.date;
  if(!mine) return null;
  return EVENT_LIST
    .filter(e => e.key !== ev && e.date && e.date < mine && exhibitorsForEvent(e.key).length)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.key || null;
}

/* 지난 행사에 참가했던 기업(org_id) 집합. 기업 레코드를 키로 쓴다 —
   이름으로 맞추면 사명이 바뀐 곳이 새 기업으로 보인다(압타머사이언스 →
   츌립앤사이언스). 아직 기업에 연결되지 않은 옛 줄은 이름으로 한 번 더 본다. */
export function prevOrgKeys(evKey){
  const prev = prevEventKey(evKey);
  if(!prev) return null;
  const ids = new Set(), names = new Set();
  exhibitorsForEvent(prev).forEach(x => {
    if(x.org_id) ids.add(x.org_id);
    const n = exhNames(x);
    [n.ko, n.en, x.company_name].forEach(v => { const k = normalizeCompanyKey(v || ''); if(k) names.add(k); });
  });
  return { prev, ids, names };
}

/* 이 기업이 지난 행사에도 왔나. 지난 행사 자료가 없으면 null(모름) — 안 왔다와
   구별해야 한다. 모르는 걸 "신규"로 세면 첫 행사가 전부 신규가 된다. */
export function isReturning(x, keys){
  if(!keys) return null;
  if(x.org_id && keys.ids.has(x.org_id)) return true;
  const n = exhNames(x);
  return [n.ko, n.en, x.company_name]
    .some(v => { const k = normalizeCompanyKey(v || ''); return k && keys.names.has(k); });
}

/* 지난 행사에는 있었는데 이번에 없는 기업 — 이탈. 취소한 곳도 이탈로 본다
   (신청했다가 취소한 것은 따로 표시한다). */
export function droppedFromPrev(evKey){
  const prev = prevEventKey(evKey);
  if(!prev) return [];
  const here = exhibitorsForEvent(evKey || exhEvent);
  const alive = here.filter(x => x.status !== CANCELLED);
  const ids = new Set(alive.map(x => x.org_id).filter(Boolean));
  const names = new Set();
  alive.forEach(x => { const n = exhNames(x);
    [n.ko, n.en, x.company_name].forEach(v => { const k = normalizeCompanyKey(v || ''); if(k) names.add(k); }); });
  const cancelled = new Map();
  here.filter(x => x.status === CANCELLED).forEach(x => {
    if(x.org_id) cancelled.set(x.org_id, x);
  });
  return exhibitorsForEvent(prev).filter(x => {
    if(x.org_id && ids.has(x.org_id)) return false;
    const n = exhNames(x);
    return ![n.ko, n.en, x.company_name]
      .some(v => { const k = normalizeCompanyKey(v || ''); return k && names.has(k); });
  }).map(x => ({ x, cancelled: x.org_id ? cancelled.get(x.org_id) : null }));
}

/* ── 참가기업 구성 요약 ──
   기업리스트는 "이 기업이 어디까지 왔나"를 한 줄씩 보는 화면이라, 51줄을 눈으로
   더하기 전에는 "몇 개국 몇 개사인지", "해외가 몇 부스인지"를 알 수 없었다.
   주최사 보고와 홍보 문구("12개국 51개사 60부스")에 매번 쓰는 숫자인데 그때마다
   엑셀로 옮겨 세고 있었다.

   기업 수와 부스 수를 따로 센다 — 한 기업이 두세 부스를 쓰는 곳이 있어서
   둘이 같지 않다(2026 KIC은 51개사 60부스). 발주·도면·안내는 부스 수로 움직이고
   초청·등록은 기업 수로 움직여서, 둘 중 하나만 있으면 늘 다시 세게 된다. */
const isDomestic = (c) => countryName(c) === '대한민국';
/* countBy와 같은데 1씩이 아니라 weight만큼 더한다(기업 수가 아니라 부스 수) */
const sumBy = (list, key, weight) => {
  const c = {};
  list.forEach(x => { const k = key(x); if(k) c[k] = (c[k] || 0) + weight(x); });
  return c;
};
/* ── 부스 수 ──
   안 적힌 곳은 1부스로 본다(대부분 1부스라 비워 두고 넘어간다).

   공동 부스로 표시된 기업은 0으로 센다. 한 부스를 두 기관이 나눠 쓰면 기업은
   둘이지만 부스는 하나다 — 둘 다 1로 세면 주최사 보고 숫자가 한 칸 늘고
   조립부스 발주도 한 벌 더 잡힌다. 기업 수에서는 빼지 않는다. */
export const isSharedBooth = (x) => x.booth_shared === 'yes';

/* 프로그램북에만 이름을 올리는 참가. 모기업 부스에 얹힌 자회사처럼 주고받을
   게 도록뿐인 곳이다.

   일반 참가와 같은 체크리스트에 세우면 매뉴얼·신청서·인보이스·입금이 영영
   미완료로 남는다. 안 받을 것을 못 받은 것으로 세면 "몇 곳 남았나"가 늘 틀리고,
   틀린 숫자는 며칠 지나면 아무도 안 본다. 그래서 도록 말고는 해당 없음으로
   비운다 — 지우는 게 아니라 분모에서 빼는 것이라, 유형을 되돌리면 그대로 살아난다.

   부스도 세지 않는다. 부스는 모기업 것 하나뿐이다. */
export const isBookOnly = (x) => x.scope === 'book';

/* 부스 없이 참가하는 기업 — 세미나·상담회만 하거나 모기업 부스에 얹힌 곳.
   부스 타입 고르는 칸에서 함께 고르게 한다(따로 칸을 두면 «타입 미지정»과
   «부스 안 함»이 구분이 안 돼서 미지정이 영영 남는다). 행사마다 다른 타입
   목록이 아니라 늘 있는 값이라 설정 목록에 넣지 않고 여기 고정한다. */
export const NO_BOOTH_TYPE = 'No Booth';
export const NO_BOOTH_LABEL = '부스 진행 안함';
export const isNoBooth = (x) => x.booth_type === NO_BOOTH_TYPE;
export const boothTypeText = (t) => (t === NO_BOOTH_TYPE ? NO_BOOTH_LABEL : (t || ''));

const boothQty = (x) => (isSharedBooth(x) || isBookOnly(x) || isNoBooth(x) ? 0 : Math.max(1, num(x.booth_qty) || 1));

/* ── 모기업 · 예하 기업 ──
   host_key에 모기업의 company_key를 적는다. 한 단계만 둔다 — 예하의 예하까지
   열면 누가 누구 밑인지 표에서 읽을 수 없고, 서로를 가리키는 고리가 생긴다. */
export const hostOf = (x, list) => {
  const k = String(x.host_key || '').trim();
  return k ? (list || exhibitorsForEvent(x.event_id)).find(o => o.company_key === k && o.id !== x.id) || null : null;
};
/* 모기업으로 고를 수 있는 곳 — 자기 자신, 이미 누구의 예하인 곳, 프로그램북만인 곳,
   그리고 이 기업을 모기업으로 둔 곳(고리가 생긴다)은 뺀다 */
export function hostCandidates(x){
  return exhibitorsForEvent(x.event_id)
    .filter(o => o.id !== x.id && !isBookOnly(o) && !String(o.host_key || '').trim())
    .sort((a, b) => String(a.company_name || '').localeCompare(String(b.company_name || ''), 'ko'));
}
export function hostOptions(x){
  const cur = String(x.host_key || '').trim();
  // 이미 예하를 거느린 기업은 누구의 예하가 될 수 없다 — 두 단계가 된다
  const hasKids = exhibitorsForEvent(x.event_id).some(o => o.id !== x.id && o.host_key === x.company_key);
  if(hasKids && !cur) return `<option value="" selected>모기업</option>`;
  return `<option value=""${cur ? '' : ' selected'}>— 없음 —</option>`
    + hostCandidates(x).map(o => `<option value="${escapeHtml(o.company_key)}"${cur === o.company_key ? ' selected' : ''}>${
        escapeHtml(exhNames(o).ko)}${o.booth_no ? ` (부스 ${escapeHtml(o.booth_no)})` : ''}</option>`).join('');
}
/* 모기업 바로 밑에 예하 기업을 붙여 세운다. 모기업이 목록에 없으면(걸러졌으면)
   제자리에 둔다 — 안 보이는 부모 밑에 숨기면 줄이 사라진다. */
export function groupByHost(rows){
  const kids = new Map();
  const top = [];
  rows.forEach(x => {
    const h = hostOf(x, rows);
    if(h){
      if(!kids.has(h.company_key)) kids.set(h.company_key, []);
      kids.get(h.company_key).push(x);
    } else top.push(x);
  });
  return top.flatMap(x => [x, ...(kids.get(x.company_key) || [])]);
}

/* 누구의 부스에 얹혔는지까지 알려 준다 — "프로그램북만"이라는 말만으로는
   왜 이 회사가 부스도 없이 목록에 있는지 설명이 안 된다. */
export function bookOnlyTip(x){
  const host = String(x.host_key || '').trim()
    ? exhibitorsForEvent(x.event_id).find(o => o.company_key === x.host_key) : null;
  return host
    ? `프로그램북에만 오르는 참가예요 — ${exhNames(host).ko}의 부스를 함께 씁니다. 부스 수와 체크리스트에서는 빠집니다.`
    : '프로그램북에만 오르는 참가예요 — 부스 수와 체크리스트에서 빠집니다.';
}

function exhSummary(all){
  const of = (x) => {
    const o = x.org_id ? getOrgById(x.org_id) : null;
    return (o && o.country) || '';
  };
  const g = { home: [], away: [], unknown: [] };
  all.forEach(x => {
    const c = of(x);
    (!c ? g.unknown : isDomestic(c) ? g.home : g.away).push(x);
  });
  const boothsOf = (arr) => arr.reduce((a, x) => a + boothQty(x), 0);
  const countries = new Set(all.map(of).filter(Boolean).map(countryName));

  return {
    all, countries,
    co:    { home: g.home.length, away: g.away.length, unknown: g.unknown.length },
    booth: { home: boothsOf(g.home), away: boothsOf(g.away), unknown: boothsOf(g.unknown),
             total: boothsOf(all) },
    /* 층과 부스 타입은 부스 수로 센다 — 도면·안내·조립부스 발주가 전부 부스
       단위로 움직인다. 한 기업이 두 부스를 쓰면 조립도 두 벌이다.
       등급은 스폰서 계약이라 기업 수로 센다. */
    floor: sumBy(all, x => (x.booth_floor ? x.booth_floor + '층' : ''), boothQty),
    type:  sumBy(all, x => (isNoBooth(x) ? '' : x.booth_type || ''), boothQty),
    grade: countBy(all.filter(x => x.grade && x.grade !== 'Exhibitor'), x => x.grade),
    noBooth: all.filter(x => !isBookOnly(x) && !isNoBooth(x) && !String(x.booth_no || '').trim()).length,
    shared: all.filter(isSharedBooth).length,
    bookOnly: all.filter(isBookOnly).length,
    prev: (() => {
      const keys = prevOrgKeys();
      if(!keys) return null;
      const back = all.filter(x => isReturning(x, keys));
      return { key: keys.prev, back: back.length, fresh: all.length - back.length,
               dropped: droppedFromPrev().length };
    })(),
  };
}

/* 요약 카드. 숫자 하나를 크게 놓고 그 아래에 무엇을 나눈 값인지 적는다 —
   "23"만 있으면 기업 수인지 부스 수인지 알 수 없다. */
export function renderExhSummary(all){
  if(!all.length) return '';
  const s = exhSummary(all);
  const n = (v) => `<b style="font-size:var(--fs-17);font-weight:800">${v}</b>`;
  const sub = (t) => `<div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:2px">${t}</div>`;

  let nth = 0;
  const block = (title, body, grow = 1) => `<div style="flex:${grow};min-width:${grow > 1 ? 210 : 140}px;padding:0 12px${
    nth++ ? ';border-left:1px solid var(--i7)' : ''}">
    <div style="font-size:var(--fs-10);color:var(--i5);font-weight:600;letter-spacing:.02em">${title}</div>
    <div style="margin-top:3px">${body}</div></div>`;

  const cnt = (obj, cls) => Object.entries(obj).sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `<span class="pill ${cls}" style="font-size:var(--fs-9_5)">${escapeHtml(k)} ${v}</span>`).join('');

  return `<div class="uc" style="margin:12px 0 10px;padding:11px 4px">
    <div style="display:flex;flex-wrap:wrap;gap:10px 0;align-items:flex-start">
      ${block('참가기업', `${n(s.all.length)}<span style="font-size:var(--fs-11);color:var(--i4)"> 개사</span>
        <span style="color:var(--i6);margin:0 5px">·</span>${n(s.countries.size)}<span style="font-size:var(--fs-11);color:var(--i4)"> 개국</span>
        ${sub(`국내 ${s.co.home} · 해외 ${s.co.away}${s.co.unknown ? ` · 국가 미확인 ${s.co.unknown}` : ''}`)}`)}

      ${block('부스', `${n(s.booth.total)}<span style="font-size:var(--fs-11);color:var(--i4)"> 부스</span>
        ${sub(`국내 ${s.booth.home} · 해외 ${s.booth.away}${s.booth.unknown ? ` · 미확인 ${s.booth.unknown}` : ''}`)}
        ${s.shared ? sub(`<span title="한 부스를 나눠 쓰는 기업이에요 — 기업 수에는 있고 부스 수에는 없습니다">공동 부스 ${s.shared}곳 제외</span>`) : ''}
        ${s.bookOnly ? sub(`<span title="프로그램북에만 오르는 참가예요 — 부스도 체크리스트도 세지 않습니다">프로그램북만 ${s.bookOnly}곳 제외</span>`) : ''}`)}

      ${block('층', `<div style="display:flex;flex-wrap:wrap;gap:3px">${cnt(s.floor, 'p-gray')}</div>
        ${sub(s.noBooth ? `<span style="color:var(--am)">부스 미배정 ${s.noBooth}곳</span>` : '부스 수 기준')}`)}

      ${block('부스 타입', `<div style="display:flex;flex-wrap:wrap;gap:3px">${cnt(s.type, 'p-blue')}</div>
        ${sub('부스 수 기준')}`, 2)}

      ${s.prev ? block('지난 행사 대비', `<div>${n(s.prev.back)}<span style="font-size:var(--fs-11);color:var(--i4)"> 재참가</span>
        <span style="color:var(--i6);margin:0 5px">·</span>${n(s.prev.fresh)}<span style="font-size:var(--fs-11);color:var(--i4)"> 신규</span></div>
        ${sub(`${escapeHtml(s.prev.key)} 대비${s.prev.dropped ? ` · <span style="color:var(--am)">이탈 ${s.prev.dropped}곳</span>` : ''}`)}`) : ''}

      ${Object.keys(s.grade).length
        ? block('스폰서 등급', `<div style="display:flex;flex-wrap:wrap;gap:3px">${
            Object.entries(s.grade).sort((a, b) => b[1] - a[1])
              .map(([k, v]) => `<span class="pill ${gradeCls(k)}" style="font-size:var(--fs-9_5)">${escapeHtml(k)} ${v}</span>`).join('')
          }</div>${sub(`일반 ${s.all.length - Object.values(s.grade).reduce((a, b) => a + b, 0)}곳`)}`)
        : ''}
    </div></div>`;
}

function renderChecklist(list, all){
  // 모바일에서는 표를 쓰지 않는다. layout.css가 모든 table을 마스터DB용 카드
  // 규칙(헤더 숨김 + 특정 열 강제 숨김)으로 바꿔버려 15열짜리 체크리스트는
  // 의미를 잃고 뭉개진다. 그래서 아예 전용 카드 목록으로 그린다.
  if(isMobile()) return window.renderChecklistCards(list, all);
  return window.renderChecklistTable(list, all);
}

/* ══════════════════════════════════════════
   품목별 현황 보기 — 부스 / 비품 / 그래픽

   체크리스트는 "이 기업이 어디까지 왔나"를 본다. 그런데 실무는 품목으로 갈린다 —
   부스 배치는 현장 담당이, 비품은 발주 담당이, 그래픽은 디자인이 맡고 마감도
   서로 다르다. 그때마다 기업 드로어를 51번 열어 필요한 칸만 찾아보는 건
   현실적이지 않아서, 품목별로 한 화면에 모아 거기서 바로 고칠 수 있게 한다.

   좁은 화면에서는 표 대신 카드로 그린다(마스터DB·체크리스트와 같은 이유).
══════════════════════════════════════════ */

/* 표/카드 공통 껍데기 — 요약 배지 + 본문 */
/* 알약 줄은 한 줄로 못 박는다 — 거르개를 누를 때마다 알약 개수가 달라지는데,
   줄바꿈을 허용하면 그때마다 아래 표가 한 줄만큼 위아래로 뛴다. 넘치면 가로로
   민다(모바일은 화면이 좁아 줄바꿈이 낫다). 높이도 한 값으로 잡아 둔다. */
export const viewShell = (pills, inner, actions = '') => `<div style="padding:0 16px 16px">
  <div style="display:flex;gap:6px;margin:12px 0;align-items:center;min-height:30px;${
    isMobile() ? 'flex-wrap:wrap' : 'flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden'}">
    ${pills}${actions ? `<span style="margin-left:auto;display:flex;gap:6px;flex:0 0 auto">${actions}</span>` : ''}
  </div>
  ${inner}</div>`;

export const countBy = (list, fn) => {
  const c = {};
  list.forEach(x => { const v = fn(x); if(v) c[v] = (c[v] || 0) + 1; });
  return c;
};
const pillsOf = (cnt, cls = 'p-gray') => Object.entries(cnt)
  .sort((a, b) => b[1] - a[1])
  .map(([k, n]) => `<span class="pill ${cls}">${escapeHtml(k)} ${n}</span>`).join('');

export const emptyView = (msg) => `<div class="empty" style="padding:40px 20px;text-align:center;color:var(--i4);font-size:var(--fs-13)">${escapeHtml(msg)}</div>`;

/* ── 현장 처리 ──
   행사 기간에 «했음»을 누른 항목은 전부 현장에서 한 일이다(2026-10-13 KIC부터
   이렇게 쓴다). 메모 칸을 따로 두지 않는다 — 완료일(done_at)이 행사 기간 안이면
   그게 곧 «현장»이라, 체크 한 번이면 여기 모인다. 행사 날짜는 설정 › 행사의
   기간이 정본이다. 사전 준비분과 현장 대응분을 나눠 보고(정산·결과보고),
   잘못 누른 것을 되돌리는 자리. */
export function isOnsiteDate(d, evKey = exhEvent){
  const ev = EVENT_LIST.find(e => e.key === evKey) || {};
  const s = ev.date_start || ev.date || '', e = ev.date_end || s;
  d = String(d || '').slice(0, 10);
  return !!(s && d && d >= s && d <= e);
}
function renderOnsiteView(list){
  const rows = [];
  for(const x of list){
    const items = liveItemsFor(x.id).filter(i => isOnsiteDate(i.done_at));
    items.forEach(i => rows.push({ x, i, d: String(i.done_at).slice(0, 10) }));
    // 항목이 없는 기업은 기본 시공 완료가 기업 칸에 적힌다
    if(!liveItemsFor(x.id).some(i => (i.category || '') === 'graphic') && isOnsiteDate(x.base_done_at))
      rows.push({ x, i: null, d: String(x.base_done_at).slice(0, 10) });
  }
  if(!rows.length) return emptyView('행사 기간에 «했음»으로 체크한 항목이 아직 없어요 — 현장에서 체크하면 여기에 모입니다');
  rows.sort((a, b) => a.d.localeCompare(b.d) || boothSortKey(a.x) - boothSortKey(b.x));
  const days = [...new Set(rows.map(r => r.d))];
  const pills = `<span class="pill p-blue">현장 처리 ${rows.length}건</span>`
    + `<span class="pill p-gray">${new Set(rows.map(r => r.x.id)).size}곳</span>`
    + days.map(d => `<span class="pill p-gray">${escapeHtml(d.slice(5).replace('-', '/'))} ${rows.filter(r => r.d === d).length}</span>`).join('')
    + '<span style="font-size:var(--fs-10_5);color:var(--i5);margin-left:2px">행사 기간에 «했음»으로 체크한 것 — 체크를 풀면 여기서도 빠집니다</span>';
  const line = (r) => {
    const cat = r.i ? ((r.i.category || '') === 'graphic' ? '그래픽' : '비품') : '기본 시공';
    const name = r.i ? (r.i.name || '(이름 없음)') : '기본 시공';
    const undo = r.i
      ? `toggleItemDone('${escAttr(r.i.id)}')`
      : `toggleBaseDone('${escAttr(r.x.id)}')`;
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--i8);flex-wrap:${isMobile() ? 'wrap' : 'nowrap'}">
      <span class="pill p-gray" style="flex:0 0 auto">${r.x.booth_no ? '부스 ' + escapeHtml(r.x.booth_no) : '미배정'}</span>
      <span onclick="openExhDr('${escAttr(r.x.id)}','progress')" style="font-size:var(--fs-12_5);font-weight:700;cursor:pointer;min-width:120px">${escapeHtml(exhNames(r.x).ko)}</span>
      <span class="pill ${cat === '그래픽' ? 'p-teal' : 'p-gray'}" style="flex:0 0 auto">${cat}</span>
      <span style="flex:1;min-width:0;font-size:var(--fs-12_5)">${escapeHtml(name)}${r.i?.qty ? ` <span style="color:var(--i4);font-size:var(--fs-10_5)">· ${escapeHtml(String(r.i.qty))}개</span>` : ''}</span>
      <button class="pill p-green" style="border:0;cursor:pointer;font:inherit;padding:0 10px;flex:0 0 auto"
        onclick="${undo}" title="현장 처리 — 누르면 «안 했음»으로 되돌립니다">✓ 현장</button>
    </div>`;
  };
  const inner = days.map(d => `<div style="margin-bottom:16px">
      <div style="font-size:var(--fs-12);font-weight:800;color:var(--i2);margin-bottom:4px">${escapeHtml(d)} · ${rows.filter(r => r.d === d).length}건</div>
      ${rows.filter(r => r.d === d).map(line).join('')}</div>`).join('');
  return viewShell(pills, `<div style="background:var(--W);border:1px solid var(--i7);border-radius:var(--rd-10);padding:6px 14px">${inner}</div>`);
}

/* ── 현장 추가 (대시보드 카드) ──
   현장에서 받은 접수(경로 '현장')로 들어온 품목을 기업마다 모은다. 차수 배지에는
   «현장»으로 적히고, 여기서는 현장 정산·추가 청구할 곳을 한눈에 본다.
   현장 처리(행사 기간에 «했음»)와는 다르다. 무효로 돌린 품목은 뺀다. */
export function onsiteAddCard(all){
  const groups = [];
  const sums = {};
  for(const x of all){
    const apps = new Set(appsFor(x.id).filter(a => a.channel === '현장').map(a => a.id));
    if(!apps.size) continue;
    const items = liveItemsFor(x.id).filter(i => apps.has(i.app_id));
    if(!items.length) continue;
    const sub = {};
    items.filter(i => i.change_kind !== '취소').forEach(i => {
      const c = i.currency || 'KRW';
      sub[c] = (sub[c] || 0) + num(i.amount);
      sums[c] = (sums[c] || 0) + num(i.amount);
    });
    groups.push({ x, items, sub });
  }
  if(!groups.length) return '';
  groups.sort((p, q) => boothSortKey(p.x) - boothSortKey(q.x));
  const n = groups.reduce((s, g) => s + g.items.length, 0);
  const row = ({ x, items, sub }) => `<div onclick="openExhDr('${escAttr(x.id)}','billing')"
      style="display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:var(--rd-6);cursor:pointer;background:var(--i9);margin-bottom:4px">
      ${x.booth_no ? `<span class="pill p-gray" style="flex:0 0 auto">${escapeHtml(x.booth_no)}</span>` : ''}
      <span style="font-size:var(--fs-11_5);font-weight:700;flex:0 0 auto">${escapeHtml(exhNames(x).ko)}</span>
      <span style="font-size:var(--fs-11);color:var(--i4);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${
        escapeHtml(items.map(i => (i.name || '(이름 없음)') + (i.change_kind === '취소' ? '(취소)' : '')).join(' · '))}</span>
      <span style="font-size:var(--fs-11_5);font-weight:700;flex:0 0 auto">${
        escapeHtml(Object.entries(sub).map(([c, v]) => fmtMoney(v, c)).join(' · '))}</span>
    </div>`;
  return `<div class="uc">
      <div class="uc-ttl">현장 추가 <span style="font-weight:400;color:var(--i4);font-size:var(--fs-11)">${groups.length}곳 · ${n}건 · ${
        escapeHtml(Object.entries(sums).map(([c, v]) => fmtMoney(v, c)).join(' · '))}</span></div>
      ${groups.map(row).join('')}
    </div>`;
}

/* 받침에 따라 '와/과'를 고른다 — 기업명이 값이라 문장에 그대로 이어 붙는다 */
function wa(name){
  const ch = String(name || '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if(code >= 0xAC00 && code <= 0xD7A3) return (code - 0xAC00) % 28 ? '과' : '와';
  return '와';   // 영문·숫자로 끝나면 읽는 대로 갈리므로 기본값
}

/* 신청순 칸 — 참가 신청을 받은 순서. 프로그램북 순번과 다른 값이라 따로 둔다.

   한 번호를 두 곳이 함께 쓰는 자리가 있다. 부스를 나눠 쓰는 서울대학교병원과
   분당서울대학교병원이 한 건으로 신청했기 때문인데, 행은 따로 두고 번호만 같다.
   실수로 보이지 않게 그 줄에 표시를 남긴다 — 없으면 다음 사람이 고치려 든다. */
export const applyCell = (x) => {
  if(!x.apply_order) return '<td style="min-width:44px;text-align:right;font-size:var(--fs-11_5);color:var(--i6)">-</td>';
  const same = activeExhibitors(x.event_id)
    .filter(o => o.id !== x.id && String(o.apply_order || '') === String(x.apply_order))
    .map(o => exhNames(o).ko);
  return `<td style="min-width:44px;text-align:right;font-size:var(--fs-11_5);color:var(--i4)"${
    same.length ? ` title="${escapeHtml(same.join(', '))}${wa(same[same.length - 1])} 같은 신청 건이에요 — 부스를 나눠 써서 번호를 함께 씁니다"` : ''
  }>${escapeHtml(x.apply_order)}${same.length ? '<span style="color:var(--a);font-size:var(--fs-9)">*</span>' : ''}</td>`;
};

/* 기업 이름 칸 — 어느 보기에서든 클릭하면 그 기업 드로어로 간다 */
export const coCell = (x, tab) => `<td style="min-width:150px">
  <span onclick="openExhDr('${escAttr(x.id)}','${tab}')" style="cursor:pointer;font-size:var(--fs-12_5);font-weight:600${
    x.status === CANCELLED ? ';text-decoration:line-through;opacity:.6' : ''}">${escapeHtml(exhNames(x).ko)}</span>${
    exhNames(x).en ? `<div style="font-size:var(--fs-10_5);color:var(--i4);font-weight:400">${escapeHtml(exhNames(x).en)}</div>` : ''}</td>`;

/* ── 부스 현황 ──
   부스 번호로 정렬해 배치도를 훑듯 볼 수 있게 한다. 독립부스는 시공사가 따로
   있어 현장에서 연락할 상대가 다르므로 그 열을 함께 보여준다. */
/* 부스 타입은 주최 측이 정한 몇 가지 중 하나다. 자유 입력이었더니 같은 타입을
   조금씩 다르게 적을 수 있어 집계가 갈라진다 — 골라 쓰게 한다.
   드로어와 부스 현황 두 곳이 같은 목록을 써야 해서 여기(단방향 상류)에 둔다. */
export const SELF_BUILD_TYPE = 'Self-Construction';

/* 부스 타입은 행사마다 다르다 — 설정에서 고친다(code_lists.booth_type).
   아래 값은 서버 목록이 아직 안 왔을 때만 쓰는 기본값이다. */
const BOOTH_TYPE_FALLBACK = [SELF_BUILD_TYPE, 'Block System A', 'Block System B',
  'Block System C', 'Lighting Booth', 'Octanium (Standard)'].map(c => ({ code: c, label: c }));
export const boothTypes = (evKey) => codeList('booth_type', evKey || exhEvent, BOOTH_TYPE_FALLBACK);

/* 목록에 없는 값이 이미 들어 있으면(옛 데이터·행사마다 다른 타입) 그 값도 함께
   보여준다 — 고정 목록으로 바꿨다는 이유로 저장돼 있던 값이 조용히 사라지면 안 된다. */
export function boothTypeOptions(current, evKey){
  const cur = String(current || '').trim();
  const list = boothTypes(evKey).map(t => [t.code, t.label]);
  // 목록에 없는 값이 이미 저장돼 있으면 그 값도 보기에 넣는다 — 목록을 고쳤다는
  // 이유로 저장돼 있던 값이 조용히 사라지면 안 된다
  if(cur && cur !== NO_BOOTH_TYPE && !list.some(([c]) => c === cur)) list.push([cur, cur + ' (목록에 없음)']);
  return `<option value=""${cur ? '' : ' selected'}>— 미지정 —</option>`
    + `<option value="${NO_BOOTH_TYPE}"${cur === NO_BOOTH_TYPE ? ' selected' : ''}>${NO_BOOTH_LABEL}</option>`
    + list.map(([c, l]) => `<option value="${escapeHtml(c)}"${cur === c ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
}
/* ── 부스 번호 읽기 ──
   번호에 하이픈이 두 가지 뜻으로 쓰인다.
     10-11, 44-46  연속된 부스를 여러 개 쓴다 (2개, 3개)
     39-1, 39-2    부스 하나를 두 기업이 나눠 쓴다
   뒤 숫자가 앞보다 크면 범위, 작으면 분할 번호다. 실제 데이터가 그렇게 되어
   있고 달리 구분할 방법이 없다.

   전에는 숫자만 뽑아 이어 붙여서 "10-11"을 1011로 읽었다. 그래서 1 다음에
   10-11이 오고 2가 그 뒤에 오는 식으로 순서가 뒤죽박죽이었다. */
export function parseBooth(no){
  const t = String(no || '').trim();
  const m = t.match(/^(\d+)\s*[-~]\s*(\d+)$/);
  if(m){
    const a = +m[1], b = +m[2];
    return b > a
      ? { first: a, last: b, sub: 0, count: b - a + 1, kind: 'range' }
      : { first: a, last: a, sub: b, count: 1, kind: 'split' };
  }
  const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n)
    ? { first: n, last: n, sub: 0, count: 1, kind: 'single' }
    : { first: Infinity, last: Infinity, sub: 0, count: 0, kind: 'none' };
}

/* 앞 번호가 우선, 같으면 분할 번호 순. 번호 없는 기업은 맨 뒤로. */
export const boothSortKey = (x) => {
  const b = parseBooth(x.booth_no);
  return b.first === Infinity ? Infinity : b.first * 100 + b.sub;
};
/* 부스 번호 글자만 있을 때 — 기업 줄이 아니라 «부스 26-27»처럼 값만 들고
   다니는 목록에서 쓴다. 없는 부스는 맨 뒤로 보낸다. */
export const boothKeyOf = (booth) => {
  const k = boothSortKey({ booth_no: booth });
  return k === Infinity ? 1e9 : k;
};

/* ── 부스 타입 골라 보기 ──
   "Block System A가 몇 곳이지"까지는 배지로 보이는데, 그게 어느 기업인지 알려면
   51줄을 눈으로 훑어야 했다. 배지를 눌러 그 타입만 남긴다. 대시보드 부스 카드의
   타입 배지도 같은 곳으로 보낸다 — 세어 둔 숫자를 눌렀는데 아무 일이 없으면
   셀 수만 있고 쓸 수는 없는 숫자가 된다. */
export function setBoothTypeFil(t){
  exhUi.boothTypeFil = (exhUi.boothTypeFil === t) ? '' : t;   // 같은 걸 또 누르면 해제
  exhUi.exhView = 'booth';                              // 대시보드에서 눌러도 부스 현황으로 간다
  renderExh();
}

/* 엑셀로 받을 때 화면에 보이던 줄을 그대로 쓴다 — 검색·타입 탭으로 거른 결과가
   파일에서 다시 51줄로 늘어나면 «보던 것»을 받은 게 아니다. */
export const boothViewRows = () => exhUi.boothShown;

/* «부스 현황 보기 — 타입별·번호 겹침·엑셀로 받기»은 ../features/exhibition/exh-booth-view.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* ── 비품 현황 ──
   발주는 기업별이 아니라 품목별로 한다 — "테이블 몇 개, 의자 몇 개"를 알아야
   주문서를 쓸 수 있는데, 지금은 51개 기업을 하나씩 열어 더해야 했다.
   품목별 합계를 먼저 보여주고, 아래에 어느 기업이 무엇을 신청했는지 붙인다. */
/* 품목별 합계에서 펼쳐 둔 줄 — 클릭한 품목의 신청 기업 목록을 그 아래 보여준다 */
export function toggleEquipRow(key){
  exhUi.equipOpen.has(key) ? exhUi.equipOpen.delete(key) : exhUi.equipOpen.add(key);
  renderExh();
}

/* «금액·비품·그래픽 현황 보기»은 ../features/exhibition/exh-item-views.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* ══════════════════════════════════════════
   프로그램북 현황

   도록에 실을 정보를 기업마다 받아 정리한다. 자료를 받았는지만 체크하던 것으로는
   무엇이 왔고 무엇이 비었는지 알 수 없어 매번 메일을 다시 열어야 했다.

   회사소개는 지면이 정해져 있어 글자수가 곧 편집 가능 여부다. 저장은 원문 그대로
   하고 글자수는 화면에서 센다 — 세어 둔 숫자를 저장하면 본문을 고쳤을 때 어긋난다.
   띄어쓰기와 줄바꿈은 그대로 세되, 앞뒤 공백만 덜어낸다(편집에서 의미가 없다).
══════════════════════════════════════════ */
export const introLen = (v) => String(v ?? '').trim().length;

/* 단어수 — 영문 소개가 대부분이라 공백으로 끊어 센다.
   지면 기준이 1,354자(189단어)로 잡혀 있어 여유를 두고 1,300자 / 200단어를
   한도로 쓴다. 둘 중 하나만 넘어도 지면을 넘길 수 있으므로 각각 본다. */
export const introWords = (v) => {
  const t = String(v ?? '').trim();
  return t ? t.split(/\s+/).length : 0;
};
/* 넘쳤나 — 넘긴 쪽과 얼마나 넘겼는지, 그때 쓴 한도까지 함께 돌려준다.
   한도가 행사별 설정이라 부르는 쪽이 따로 다시 찾지 않아도 되게 같이 준다. */
export function introOver(v, evKey){
  const lim = bookLimit(evKey);
  const c = introLen(v), w = introWords(v);
  const over = [];
  if(c > lim.chars) over.push(`${c - lim.chars}자`);
  if(w > lim.words) over.push(`${w - lim.words}단어`);
  return { chars: c, words: w, over, isOver: over.length > 0, lim };
}

export const BOOK_FIELDS = [
  ['book_address', '주소'],
  ['book_phone',   '연락처'],
  ['book_website', '웹사이트'],
];

/* 도록에 실을 이름. 안 적었으면 CRM 이름을 쓴다 — 대부분 같아서, 56줄을
   다 채우게 하면 옮겨 적는 일만 늘고 오타가 는다. 다른 곳만 적으면 된다. */
export const bookName = (x) => ({
  ko: String(x.book_name_ko || '').trim() || exhNames(x).ko,
  en: String(x.book_name_en || '').trim() || exhNames(x).en,
  custom: !!(String(x.book_name_ko || '').trim() || String(x.book_name_en || '').trim()),
});

/* 간판에 넣을 상호 — 영문이다. 따로 안 적으면 도록 영문명을 그대로 쓴다.
   같은 이름을 두 번 적게 하면 한쪽만 고쳐지고, 개막날 간판과 도록의 상호가
   다르게 된다.

   국문으로 되돌리지 않는다. 영문명이 없으면 빈 값을 내보내 화면이 «영문명 없음»
   으로 잡게 한다 — 국문을 대신 넣으면 그 부스만 한글 간판이 걸리는데, 그건
   붙이고 나서야 보인다. */
export const fasciaName = (x) => String(x.fascia_name || '').trim() || bookName(x).en;

/* 도록에 낼 정보를 다 채웠나 — 빠진 칸을 모아 알려준다 */
export function bookMissing(x){
  const miss = [];
  if(x.book_logo !== 'yes') miss.push('로고');
  BOOK_FIELDS.forEach(([f, l]) => { if(!String(x[f] || '').trim()) miss.push(l); });
  if(!introLen(x.book_intro)) miss.push('회사소개');
  return miss;
}

/* «도록 순번·기본 제공·그래픽 발주»은 ../features/exhibition/exh-book.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */
/* ══════════════════════════════════════════
   저장 — 단건 필드 수정
   서버가 "넘어온 키만" 갱신하므로 바뀐 필드만 보낸다(나머지는 보존됨).
══════════════════════════════════════════ */
/* 어떤 계정이 무엇을 바꿨는지 남긴다. 값 자체를 before → after로 적어
   나중에 "언제 왜 바뀌었나"를 되짚을 수 있게 한다. */
const FIELD_LABEL = {
  manual_sent_at:'매뉴얼 발송', manual_replied_at:'매뉴얼 회신',
  app_received:'신청서 수신', app_received_at:'신청서 수신일', app_complete:'신청서 완비',
  app_missing:'누락 항목', extra_equipment:'추가 비품',
  booth_no:'부스 번호', booth_floor:'부스 층', booth_type:'부스 타입', booth_qty:'부스 수량',
  /* 도면 칸들 — 부딪힘 알림에 칸 이름을 한글로 보여주려면 여기 있어야 한다.
     없으면 «booth_design_note가 바뀌었어요»라고 뜬다. */
  booth_design_note:'도면 비고', booth_design_received_at:'도면 수령일',
  booth_design_checked_at:'도면 확인일', work_report_at:'작업신고서 제출일', booth_design_result:'도면 검토 결과',
  movein_at:'반입·설치', note:'비고', status:'상태',
  company_name:'기업명', booth_shared:'공동 부스', apply_order:'신청순',
  graphic_stage:'그래픽 단계', graphic_received_at:'그래픽 수령',
  graphic_to_team_at:'그래픽 시공사 전달', graphic_team_ok_at:'시공사 확인',
  graphic_replied_at:'그래픽 회신',
  book_order:'도록 순번', book_logo:'도록 로고', book_address:'도록 주소',
  book_phone:'도록 연락처', book_website:'도록 홈페이지', book_intro:'도록 소개',
  scope:'참가 범위', host_key:'대표 기업',
  book_name_ko:'게재 국문명', book_name_en:'게재 영문명',
  fascia_name:'간판명', base_recv_at:'간판명 확정·디자인 수령',
  base_done_at:'간판 제작·출력 완료', base_note:'기본 시공 비고',
  builder:'시공사명', builder_contact:'시공 담당자', builder_tel:'시공사 유선', builder_mobile:'시공사 휴대폰', builder_email:'시공사 이메일',
  grade:'등급', booth_confirmed:'부스 확정', booth_confirmed_at:'부스 확정일',
  settled:'완납 처리', settled_note:'완납 사유', pay_due_date:'입금 기한',
  tax_contact_name:'세금계산서 담당자', tax_contact_email:'세금계산서 이메일', tax_contact_phone:'세금계산서 연락처',
  graphic_ordered_at:'그래픽 주문', graphic_type:'그래픽 유형', graphic_spec_ok:'그래픽 규격',
  graphic_spec_note:'규격 메모', graphic_draft_at:'초안', graphic_revised_at:'수정안', graphic_final_at:'최종안',
  directory_received:'도록 자료', directory_received_at:'도록 수신일', directory_note:'도록 메모',
  movein_at:'반입·설치', builder:'설치업체', badge_count:'출입증 매수', badge_issued_at:'출입증 발급',
  onsite_note:'현장 메모', status:'상태', note:'메모',
};
/* 로그에 담을 값 — 너무 길면 자른다. 여러 줄짜리 메모는 줄바꿈을 «⏎»로 눌러
   한 줄로 만든다: 로그 목록은 한 줄짜리라, 줄바꿈이 그대로 들어가면 뒷부분이
   잘려 나가 무엇이 바뀌었는지 안 보인다. */
const shortVal = (v) => { const t = String(v ?? '').trim().replace(/\s*\n\s*/g, ' ⏎ ');
  return !t ? '(빈칸)' : (t.length > 40 ? t.slice(0, 40) + '…' : t); };

export function logExhEdit(x, patch, backup){
  const parts = [];
  const keys = [];          // 한 칸만 바뀐 경우에만 그 칸을 짚어 준다
  Object.keys(patch).forEach(k => {
    if(k === 'updated_at' || k === 'id') return;
    const b = String(backup[k] ?? '').trim(), a = String(patch[k] ?? '').trim();
    if(b === a) return;
    const lbl = FIELD_LABEL[k] || k;
    /* 지울 때 이전 값을 함께 남긴다. 전에는 "세금계산서 발송 지움"이라고만 적혀서,
       잘못 지웠을 때 무엇이 있었는지 알 방법이 없었다 — 그렇게 한 건을 잃었다. */
    /* 무엇이 무엇으로 바뀌었는지 늘 «이전 → 이후» 꼴로 적는다.

       전에는 이전 값이 없으면 «시공사 휴대폰 010-7363-8986»이라고만 적혀서,
       읽는 사람은 그게 새로 넣은 값인지 원래 그랬는지 알 수 없었다. 로그를
       보는 이유가 «무엇이 달라졌나»인데 그게 안 보였다. */
    parts.push(a
      ? `${lbl} ${shortVal(b)} → ${shortVal(a)}`
      : `${lbl} ${shortVal(b)} → (지움)`);
    keys.push(k);
  });
  if(!parts.length) return;
  /* 사람이 읽는 문장과 별개로, 바뀐 값 자체를 그대로 담는다.

     지금까지는 «그래픽 주문 2026-09-13 지움»처럼 문장으로만 남았다. 사람은
     읽을 수 있지만 되돌릴 수는 없다 — 어느 표의 어느 줄이었는지, 지워진 값이
     정확히 무엇이었는지를 문장에서 다시 캐내야 한다.

     되돌리는 기능은 나중에 붙이더라도 재료는 오늘부터 쌓아야 한다. 오늘 안
     남긴 값은 내일 만들 기능으로도 되살릴 수 없다. */
  trackAction('edit', '전시 정보 수정', x.company_name || '',
    `<b>${escapeHtml(x.company_name || '')}</b> ${escapeHtml(parts.join(' / '))}`,
    { kind: 'exhibitor', id: x.id, field: keys.length === 1 ? keys[0] : '',
      table: 'exhibitors', op: 'update',
      before: pick(backup, keys), after: pick(patch, keys) });
}

/* 바뀐 칸만 골라 담는다 — 안 바뀐 칸까지 넣으면 기록이 몇 배로 불어난다 */
const pick = (obj, keys) => keys.reduce((o, k) => (o[k] = obj[k] ?? '', o), {});

/* ══════════════════════════════════════════
   부딪혔을 때 — 무엇과 부딪혔는지 보여주고 사람이 고른다

   두 사람이 같은 칸을 고치면 나중 저장이 앞사람 값을 소리 없이 지웠다. 이제
   서버가 막아 주는데, 막기만 하고 «저장 실패»라고만 하면 사람은 무엇이
   문제인지 모른 채 같은 걸 다시 누른다.

   그래서 지금 값과 내가 쓰려던 값을 나란히 보여준다. 자동으로 합치지 않는다 —
   메모 한 칸에도 «둘 다 남겨야 하는 경우»와 «내 것이 맞는 경우»가 다 있고,
   그건 내용을 아는 사람만 안다.

   화면의 값은 서버가 알려준 지금 값으로 맞춰 둔다. 안 그러면 옛 사진을 계속
   보면서 다음 칸을 고치다 또 부딪힌다. */
const FIELD_KO = (f) => FIELD_LABEL[f] || f;

async function resolveConflict(id, patch, backup, current){
  const x = getExhibitorById(id);
  const fields = Object.keys(current || {});
  /* 화면을 지금 값으로 먼저 맞춘다 — 무엇과 부딪혔는지 보여주기 전에 */
  if(x) Object.assign(x, current);
  refreshExhViews();

  const lines = fields.map(f => `   ${FIELD_KO(f)}\n`
    + `     지금  ${JSON.stringify(current[f] || '')}\n`
    + `     내 값 ${JSON.stringify(patch[f] ?? '')}`).join('\n');

  const take = confirm(
    `그 사이 다른 사람이 이 칸을 고쳤어요.\n\n`
    + lines + '\n\n'
    + `[확인] 내 값으로 덮어쓰기\n`
    + `[취소] 그대로 두기 — 지금 값이 화면에 반영됐어요`);

  if(!take) return;
  /* 덮어쓰기는 지금 값을 본 상태에서 다시 보낸다 — 한 번 더 부딪히면 그때
     또 묻는다(그 사이 세 번째 사람이 고쳤다는 뜻이다). */
  const again = {};
  fields.forEach(f => { again[f] = patch[f] ?? ''; });
  await patchExh(id, again, '덮어쓰기');
  trackAction('edit', '덮어쓰기', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> — 다른 사람이 고친 값을 보고 `
    + `${fields.map(FIELD_KO).join(', ')}를 내 값으로 덮었어요`,
    { kind: 'exhibitor', id, table: 'exhibitors', row: id, op: 'update',
      before: current, after: again });
}

export async function patchExh(id, patch, label){
  const x = getExhibitorById(id);
  if(!x) return { ok: false };
  const backup = {};
  Object.keys(patch).forEach(k => { backup[k] = x[k]; });
  Object.assign(x, patch);
  refreshExhViews();

  /* 내가 본 값을 함께 보낸다 — 그 사이 남이 고쳤으면 서버가 거절한다 */
  const r = await saveExhibitor({ id, ...patch, updated_at: td() }, backup);
  if(r.conflict){
    Object.assign(x, backup);
    refreshExhViews();
    await resolveConflict(id, patch, backup, r.current);
    return r;
  }
  if(!r.ok){
    Object.assign(x, backup); // 저장 실패 시 되돌린다 — 화면만 바뀌는 거짓 성공 방지
    refreshExhViews();
    // 잠금으로 막힌 건 고장이 아니다 — 네트워크를 확인하라고 하면 엉뚱한 데를 본다
    // (가드가 이미 이유를 알렸으므로 여기서 또 띄우지 않는다)
    if(!r.locked) alert('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    return r;
  }
  x.updated_at = td();
  logExhEdit(x, patch, backup);   // 어떤 계정이 무엇을 바꿨는지 항상 남긴다
  return r;
}

/* 표와 드로어가 같은 데이터를 보므로 항상 함께 다시 그린다.
   단, 드로어를 통째로 다시 그리면 작성 중이던 입력값(긴 문의 본문 등)이
   날아가므로, 지금 그 안에서 타이핑 중이면 드로어는 건드리지 않는다.
   해당 입력을 마치고 blur/저장하는 순간 어차피 다시 그려진다. */
export function refreshExhViews(){
  renderExh();
  buildExhFilters();
  if(!isTypingInDrawer()) window.renderExhDr?.();
}

function isTypingInDrawer(){
  const el = document.activeElement;
  if(!el) return false;
  const tag = el.tagName;
  if(tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
  const dr = document.getElementById('exh-dr');
  return !!(dr && dr.contains(el) && String(el.value || '').trim());
}

/* 날짜 토글 — 비어있으면 오늘 날짜로 체크, 이미 있으면 해제 */
export function toggleExhDate(id, field, label){
  const x = getExhibitorById(id);
  if(!x) return;
  patchExh(id, { [field]: x[field] ? '' : td() }, label);
}
export function setExhField(id, field, value, label){
  patchExh(id, { [field]: value }, label);
  // 부스 타입이 정해지면 딸려 오는 품목도 함께 정해진다 — 손으로 다시 적지 않는다
  if(field === 'booth_type') applyBoothItems(id, value);
}

/* ══════════════════════════════════════════
   부스 타입에 딸려 오는 기본 제공 품목

   매뉴얼에만 적혀 있던 것이라 기업마다 손으로 다시 적었고, 적다 보면 빠졌다.
   빠지면 현장에서 «우리 건 왜 없냐»가 된다. 부스 타입을 고르는 순간 깔아 준다.

   깔아 준 품목은 origin='booth'로 표시해 둔다. 부스를 바꾸면 그 표시가 붙은
   것만 걷어내고 새 타입 것으로 다시 깐다 — 기업이 자체로 신청한 추가 비품은
   건드리지 않는다. 표시가 없으면 부스를 한 번 바꿀 때마다 신청 내역이 날아간다.

   청구하지 않으므로 billable='no'로 넣는다(금액 합계·인보이스에서 빠진다).
   접수 회차(app_id)에도 매달지 않는다 — 기업이 신청한 게 아니라 부스에 붙어
   오는 것이라, 접수 이력에 «추가»로 찍히면 신청서 원본과 어긋난다.
══════════════════════════════════════════ */
export const BOOTH_ORIGIN = 'booth';
/* 이 기업만 다르게 둔 줄 — 설정과 다르게 가는 «예외»다.

   설정은 좀처럼 바뀌지 않지만 현장에서는 예외가 계속 나온다. 벽면 그래픽을
   자체로 만들어 오는 기업, 바스툴을 하나 더 받기로 한 기업. 그때 줄을 그냥
   고치면 다음에 부스 타입을 다시 고르는 순간 설정대로 덮여 사라진다.

   그래서 손댄 줄은 예외로 표시해 둔다. 자동 반영은 예외 줄을 건드리지 않고,
   그 품목을 설정에서 다시 깔지도 않는다 — 예외가 그 자리를 대신한다. */
export const BOOTH_EXC = 'booth-exc';
export const isBoothExc = (i) => String(i.origin || '') === BOOTH_EXC;
export const isBoothGiven = (i) => {
  const o = String(i.origin || '');
  return o === BOOTH_ORIGIN || o === BOOTH_EXC;
};
/* 줄 이름 앞머리가 품목코드다(«G-131 벽면 그래픽 출력») — 설정 줄과 맞출 때
   수량·이름이 달라도 같은 품목인지 알아야 해서 코드로 맞춘다. */
export const itemCode = (nm) => String(nm || '').trim().split(/\s+/)[0];

/* 부스 타입에 적어 둔 기본 제공 목록 — 설정에서 JSON으로 들고 있다 */
export function boothIncluded(evKey, typeCode){
  const raw = codeItem('booth_type', evKey || exhEvent, typeCode)?.included;
  if(!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(o => o && (o.name || o.code)) : [];
  } catch(e){
    console.warn('[exh] 기본 제공 품목을 읽지 못했어요:', typeCode, e.message);
    return [];
  }
}

/* 아직 안 깔린 기본 제공 — 부스 타입이 바뀔 때만 깔다 보니, 이미 부스가
   정해져 있던 기업에는 한 번도 돌지 않았다. 화면이 먼저 «넣을까요»를 묻는다. */
export function boothItemsPending(exhId){
  const x = getExhibitorById(exhId);
  if(!x || exhLocked() || isSharedBooth(x)) return null;
  const want = boothIncluded(x.event_id, x.booth_type);
  if(!want.length) return null;
  const had = itemsFor(exhId).filter(isBoothGiven);
  return had.length ? null : { want, type: x.booth_type };
}

export async function applyBoothItems(exhId, typeCode){
  const x = getExhibitorById(exhId);
  if(!x || exhLocked()) return;

  /* 한 부스를 나눠 쓰는 쪽에는 깔지 않는다 — 부스에 딸려 오는 건 부스 하나에
     하나씩이지 기업마다 하나씩이 아니다. 양쪽에 다 깔면 인포데스크가 두 개,
     바스툴이 네 개로 발주된다. 대표로 신청한 쪽에만 두고, 나눠 쓰는 쪽에
     이미 깔려 있던 것은 걷어낸다(공동으로 표시하기 전에 들어갔을 수 있다). */
  const all = isSharedBooth(x) ? [] : boothIncluded(x.event_id, typeCode);
  const had0 = itemsFor(exhId).filter(isBoothGiven);
  /* 예외 줄은 사람이 정한 것이라 건드리지 않는다. 그 품목은 설정에서 다시
     깔지도 않는다 — 빼 주기로 한 벽면 그래픽이 부스 타입을 다시 고르는 순간
     되살아나면, 만들지 않기로 한 것을 발주하게 된다. */
  const exc = had0.filter(isBoothExc);
  const had = had0.filter(i => !isBoothExc(i));
  const excCodes = new Set(exc.map(i => itemCode(i.name)));
  const want = all.filter(o => !excCodes.has(o.code || itemCode(o.name)));
  // 같은 타입을 다시 고른 것뿐이면 그대로 둔다 — 지웠다 깔면 id가 바뀌어
  // 발주서·정산에서 같은 줄이 새 줄로 보인다
  if(sameBoothSet(had, want)) return;

  /* 달라진 줄만 손댄다. 전에는 전부 지우고 다시 깔았는데, 그러면 양쪽에 다 있는
     줄까지 새 id로 바뀌면서 그 줄에 붙어 있던 «파일 받은 날»이 함께 사라졌다 —
     설정에서 품목 하나를 더하는 것만으로 이미 받은 기록이 지워지고, 그러면
     파일을 이미 보낸 기업에 독촉이 나간다. */
  const keyOf = (cat, name, qty) => `${cat}|${String(name || '').trim()}|${String(qty ?? '').trim()}`;
  const left = new Map();
  had.forEach(i => {
    const k = keyOf(i.category || 'equip', i.name, i.qty);
    if(!left.has(k)) left.set(k, []);
    left.get(k).push(i);
  });
  const make = [];
  want.forEach(o => {
    const k = keyOf(o.cat || 'equip', [o.code, o.name].filter(Boolean).join(' '), o.qty);
    const hit = left.get(k);
    if(hit && hit.length){ hit.shift(); return; }   // 그대로 두는 줄
    make.push(o);
  });

  for(const i of [...left.values()].flat()){
    const at = EXH_ITEMS.indexOf(i);
    if(at >= 0) EXH_ITEMS.splice(at, 1);
    await deleteExhItem(i.id);
  }

  for(const o of make){
    const cat = o.cat || 'equip';
    // 코드가 있으면 품목표의 그 품목에 잇는다 — 발주서에서 카탈로그 품목과
    // 같은 줄로 묶이고, 이름 표기가 갈리지 않는다
    const hit = o.code ? findCatalogByName(x.event_id, o.code) : null;
    const rec = {
      id: `XI-${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      exhibitor_id: exhId, category: cat,
      catalog_id: hit ? hit.id : '',
      name: [o.code, o.name].filter(Boolean).join(' '),
      qty: String(o.qty ?? ''), unit_price: '', amount: '', currency: 'KRW',
      note: '', billable: 'no', origin: BOOTH_ORIGIN,
      app_id: '', change_kind: '', sort_order: nextItemSort(exhId),
    };
    EXH_ITEMS.push(rec);
    const r = await saveExhItem(rec);
    if(!r.ok){
      const at = EXH_ITEMS.indexOf(rec);
      if(at >= 0) EXH_ITEMS.splice(at, 1);
      console.warn('[exh] 기본 제공 품목 저장 실패:', rec.name);
      continue;
    }
    if(r.id && r.id !== rec.id) rec.id = r.id;
  }

  refreshExhViews();
  if(make.length || [...left.values()].flat().length){
    trackAction('edit', '기본 제공 품목', x.company_name || '',
      `<b>${escapeHtml(typeCode || '부스 없음')}</b>의 기본 제공 품목을 맞췄어요 — ${make.length}건 넣고 ${
        [...left.values()].flat().length}건 걷었어요 (그대로 둔 줄은 받은 날짜도 그대로예요)`,
      { kind: 'exhibitor', id: exhId, tab: 'apply' });
  }
}

/* 이미 깔린 것과 깔아야 할 것이 같은지 — 코드·이름·수량이 모두 같으면 같다 */
function sameBoothSet(had, want){
  if(had.length !== want.length) return false;
  const key = (cat, name, qty) => `${cat}|${String(name).trim()}|${String(qty ?? '').trim()}`;
  const a = had.map(i => key(i.category || 'equip', i.name, i.qty)).sort();
  const b = want.map(o => key(o.cat || 'equip',
    [o.code, o.name].filter(Boolean).join(' '), o.qty)).sort();
  return a.every((v, n) => v === b[n]);
}

/* 여부 플래그 토글 — 끌 때는 날짜도 함께 지운다(체크는 꺼졌는데 날짜만 남는 상태 방지) */
/* 공동 부스 켜고 끄기 — 어느 쪽을 뺄지는 사람이 정한다. 부스를 대표해 신청한
   쪽이 남고 나머지가 빠지는데, 그건 데이터로 알 수 없다. */
export async function toggleSharedBooth(id){
  const x = getExhibitorById(id);
  if(!x) return;
  const on = !isSharedBooth(x);
  /* patchExh는 id를 받는다 — 객체를 넘기고 있어 getExhibitorById가 못 찾고
     조용히 되돌아갔다. 공동 부스 표시가 눌러도 켜지지 않던 이유다. */
  await patchExh(id, { booth_shared: on ? 'yes' : '' },
    on ? '공동 부스 — 부스 수 제외' : '공동 부스 해제');
  /* 켜면 깔려 있던 기본 제공을 걷고, 끄면 다시 깐다 — 부스에 딸려 오는 건
     부스 하나에 하나씩이라, 나눠 쓰는 쪽에 남아 있으면 두 배로 발주된다. */
  await applyBoothItems(id, x.booth_type);
}

export function toggleExhFlag(id, flag, dateField, label){
  const x = getExhibitorById(id);
  if(!x) return;
  const on = x[flag] === 'yes' || !!x[dateField];
  /* 켤 때 오늘 날짜를 함께 찍는다. 전에는 'yes'만 써서 체크는 됐는데 날짜가
     비었고, 화면은 그걸 "날짜 미상"으로 표시했다 — 코드가 그 상태를 예상해
     안내까지 달아 뒀는데 정작 토글이 매번 그 상태를 만들고 있었다.
     반대 방향(setExhDateWithFlag)은 날짜를 넣으면 체크를 켜 주고 있었다.

     언제 받았는지가 마감을 따지는 근거라, 나중에 손으로 채우게 두면 대개 빈다.
     날짜를 다르게 적어야 하면 옆 칸에서 바로 고칠 수 있다. */
  patchExh(id, on ? { [flag]: '', [dateField]: '' }
                  : { [flag]: 'yes', [dateField]: td() }, label);
}
/* 날짜를 넣으면 여부도 함께 켠다 */
export function setExhDateWithFlag(id, dateField, flag, value, label){
  // 날짜를 지우면 체크도 함께 푼다 — 같은 화면의 dateRow와 동작을 맞춘다
  patchExh(id, value ? { [dateField]: value, [flag]: 'yes' } : { [dateField]: '', [flag]: '' }, label);
}

window.setExhEvent2 = setExhEvent2;
window.setExhFilter = setExhFilter;
window.setExhView = setExhView;
window.setBaseFil = setBaseFil;
window.setBaseRecvAt = setBaseRecvAt;
window.setBaseDoneAt = setBaseDoneAt;
window.toggleBaseDone = toggleBaseDone;
window.setGraphicView = setGraphicView;
window.setGraphicFil = setGraphicFil;
window.setPayFil = setPayFil;
window.searchExhM = searchExhM;
window.setBoothTypeFil = setBoothTypeFil;
window.setStepFil = setStepFil;
window.toggleStepWarn = toggleStepWarn;
window.toggleEquipRow = toggleEquipRow;
// 뒤로가기로 닫을 수 있게 닫기 함수도 이름으로 내어 둔다(overlay-nav.js 참고)
window.closeNewCatalogItem = () => document.getElementById('new-eq-modal')?.remove();
window.closeNewGraphicOrder = () => document.getElementById('new-gr-modal')?.remove();
window.renderExh = renderExh;
window.toggleExhDate = toggleExhDate;
window.setExhField = setExhField;
window.applyBoothItems = applyBoothItems;
window.toggleExhFlag = toggleExhFlag;
window.toggleSharedBooth = toggleSharedBooth;
window.setExhDateWithFlag = setExhDateWithFlag;

/* «행사 설정 모달 — 단계별 마감일 + 프로그램북 글자수 한도»은 ../features/exhibition/exh-settings-modal.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */