/* ══════════════════════════════════════════════════════════════
   features/conference/fee-ledger-export.js — 연사료 지급대장 내려받기

   행사가 끝나면 회계에 넘기는 지급대장(AIA2026_연사료 지급대장.xlsx)을
   손으로 만들었다. CRM의 연사료·계좌를 한 칸씩 옮겨 적다 보면 예금주가
   바뀐 것(Borden — 개인 → Q-LAB)이 대장에는 안 따라오는 일이 생긴다.
   그 양식 그대로 CRM에서 찍는다.

     [국내]  세액 3.3%(소득세+주민세, 10원 미만 버림) — 신분증·통장사본으로 받는 연사
     [해외]  세액 8.8%(USD 3,000 이상만) + USD 환산 — 여권·은행 양식으로 받는 연사

   국내·해외는 연사 창의 «받는 양식»(isDomesticSpeaker)을 따른다.
   대상은 정산 표와 같다 — 연사료가 있고 연사료를 받는 역할인 사람.

   주민등록번호·주소·여권번호는 CRM에 두지 않는다. 칸만 남겨 두고 회계가 채운다.
   계좌번호는 전부 들어간다 — 이체에 쓰는 문서라서다. 연사 창에서 계좌를 열면
   기록이 남듯, 내려받기도 누가 언제 몇 명을 받았는지 남긴다.
═══════════════════════════════════════════════════════════════ */

import { EVENT_LIST, CONF_SESSIONS, assignmentsFor, isDomesticSpeaker, paysFee, speakersForEvent } from '../../state.js';
import { loadExcelJs } from '../../modules/exh-export.js';
import { selfContact } from '../../modules/speaker-export.js';
import { showSaveErrorToast } from '../../api.js';
import { trackAction } from '../../core/audit-log.js';
import { isHiddenSp } from './conf-common.js';
import { settleMissing } from './conf-people.js';
import { checkBank } from './bank-check.js';

/* 양식의 것 그대로 — 머리글 연한 파랑(#DDEBF7) 굵은 글씨, 환율 칸 노랑 */
const C_HEAD = 'FFDDEBF7';
const C_RATE = 'FFFFFF00';
const THIN   = { style: 'thin', color: { argb: 'FF999999' } };
const BOX    = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const WON    = '#,##0';
const USD    = '#,##0.00';
/* 해외 송금 환율 기본값 — 받은 사람이 노란 칸만 고치면 USD 칸이 따라온다 */
const RATE   = 1320;

const DUTY = { '연사': 'Speaker', '공동연사': 'Speaker', '좌장': 'Chair', '패널': 'Panel', '사회': 'Moderator' };

const feeNum = (sp) => Number(String(sp.fee_amount || '').replace(/[^\d.-]/g, '')) || 0;
const isUsd  = (sp) => /usd|\$/i.test(sp.fee_currency || '');

/* 발표 순서대로 — 첫 배정의 일자·시각 */
function firstAsg(sp){
  return assignmentsFor(sp.id).slice().sort((a, b) =>
    `${a.date || ''} ${a.start_at || ''}`.localeCompare(`${b.date || ''} ${b.start_at || ''}`))[0] || null;
}
function sessionOf(a){
  const ss = a && CONF_SESSIONS.find(x => x.id === a.session_id);
  return ss ? (ss.track || ss.title_en || ss.title_ko || '') : '';
}
const orderKey = (sp) => { const a = firstAsg(sp); return a ? `${a.date || ''} ${a.start_at || '99:99'}` : '~'; };

/* 비고 — 연사료 메모, 계좌 메모, 아직 안 온 서류, 계좌 점검 */
function noteOf(sp){
  const miss = settleMissing(sp);
  /* 계좌 점검에서 고칠 것·확인할 것 — 이체 전에 회계가 같이 본다 */
  const chk = checkBank(sp, { domestic: isDomesticSpeaker(sp) }).filter(x => x.lv !== 'info').map(x => `[점검] ${x.msg}`);
  return [sp.fee_note, sp.bank_note, miss.length && `${miss.join('·')} 미수령`, ...chk]
    .map(x => String(x || '').trim()).filter(Boolean).join(' / ');
}

function headRow(ws, row, labels){
  labels.forEach((l, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = l;
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_HEAD } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = BOX;
  });
}
function bodyRow(ws, row, values, money){
  values.forEach((v, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = v;
    c.alignment = { vertical: 'middle', wrapText: true };
    c.border = BOX;
    if(money[i + 1]) c.numFmt = money[i + 1];
  });
}
function totalRow(ws, row, nameCol, cols, from, money){
  /* 대상이 없으면 SUM(I4:I3)이 된다 — 합계 대신 비었다고 적는다 */
  if(row === from){ ws.getCell(row, nameCol).value = '대상 없음'; return; }
  ws.getCell(row, nameCol).value = '합계';
  ws.getCell(row, nameCol).font = { bold: true };
  cols.forEach(col => {
    const L = ws.getColumn(col).letter, c = ws.getCell(row, col);
    c.value = { formula: `SUM(${L}${from}:${L}${row - 1})` };
    c.font = { bold: true };
    c.numFmt = money[col];
  });
}
const widths = (ws, ws_) => ws_.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

/* ── 국내 ── 강연료 I · 세액 J · 외국인 K · 실지급 L */
function drawDomestic(wb, title, list){
  const ws = wb.addWorksheet('입금대장(국내)', { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { bold: true, size: 14 };
  headRow(ws, 3, ['No.', '세션', '발표 제목', 'Duty', '성함', '국적', 'E-mail', 'Contact No.', '강연료',
    '세액 3.3%\n(소득세+주민세)', '외국인 8.8%', '실지급액', '주민등록번호', '주소', '은행명', '계좌번호', '예금주', '비고']);
  const money = { 9: WON, 10: WON, 11: WON, 12: WON };
  list.forEach((sp, k) => {
    const r = 4 + k, a = firstAsg(sp), me = selfContact(sp);
    bodyRow(ws, r, [
      { formula: 'ROW()-3' }, sessionOf(a), a ? (a.title_en || a.title_ko || '') : '',
      DUTY[a?.role] || a?.role || '', sp.name_snapshot || sp.name_en || '', sp.nationality || '',
      me.email, me.phone, feeNum(sp),
      { formula: `ROUNDDOWN(I${r}*3.3%,-1)` }, null, { formula: `I${r}-J${r}-K${r}` },
      '', '', sp.bank_name || '', sp.bank_account || '', (sp.bank_holder || '').trim(), noteOf(sp),
    ], money);
  });
  totalRow(ws, 4 + list.length, 5, [9, 10, 11, 12], 4, money);
  widths(ws, [6, 16, 40, 9, 14, 9, 22, 16, 11, 13, 10, 12, 16, 40, 14, 20, 16, 40]);
}

/* ── 해외 ── 원화 H·I·J, USD K·L·M(=원화/환율, 환율은 K2) */
function drawOverseas(wb, title, list){
  const ws = wb.addWorksheet('입금대장(해외)', { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('J2').value = '환율';
  ws.getCell('K2').value = RATE;
  for(const a of ['J2', 'K2']){
    ws.getCell(a).font = { bold: true };
    ws.getCell(a).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_RATE } };
  }
  ws.getCell('L2').value = '← USD 1 = KRW (노란 칸을 고치면 USD 금액이 따라옵니다)';
  headRow(ws, 3, ['No.', '세션', '발표 제목', 'Duty', '성함', '국적', 'Contact',
    '강연료(KRW)', '세액 8.8%\n(USD 3,000 이상)', '송금액(KRW)', '강연료(USD)', '세액 8.8%\n(USD 3,000 이상)', '송금액(USD)',
    '여권번호', 'Account Holder', 'Country', 'Address', 'ZIP', 'Bank Name', 'Branch', 'SWIFT', 'Bank Country',
    'Bank Address', 'Account No.', 'IBAN / Bank Code', '비고']);
  const money = { 8: WON, 9: WON, 10: WON, 11: USD, 12: USD, 13: USD };
  list.forEach((sp, k) => {
    const r = 4 + k, a = firstAsg(sp), me = selfContact(sp);
    /* 연사료를 USD로 정했으면 USD가 원본이고 원화가 환산이다 */
    const krw = isUsd(sp) ? { formula: `K${r}*$K$2` } : feeNum(sp);
    const usd = isUsd(sp) ? feeNum(sp) : { formula: `ROUND(H${r}/$K$2,2)` };
    bodyRow(ws, r, [
      { formula: 'ROW()-3' }, sessionOf(a), a ? (a.title_en || a.title_ko || '') : '',
      DUTY[a?.role] || a?.role || '', sp.name_en || sp.name_snapshot || '', sp.nationality || '', me.email,
      krw, { formula: `IF(K${r}>=3000,ROUND(H${r}*8.8%,0),0)` }, { formula: `H${r}-I${r}` },
      usd, { formula: `IF(K${r}>=3000,ROUND(K${r}*8.8%,2),0)` }, { formula: `K${r}-L${r}` },
      '', (sp.bank_holder || '').trim(), sp.residence_country || sp.bank_country || '',
      sp.bank_holder_address || '', sp.bank_holder_postal || '', sp.bank_name || '', sp.bank_branch || '',
      sp.bank_swift || '', sp.bank_country || '', sp.bank_address || '', sp.bank_account || '',
      sp.bank_iban || sp.bank_code || '', noteOf(sp),
    ], money);
  });
  totalRow(ws, 4 + list.length, 5, [8, 9, 10, 11, 12, 13], 4, money);
  widths(ws, [6, 16, 30, 9, 18, 9, 26, 12, 14, 12, 12, 14, 12, 12, 20, 12, 34, 8, 26, 16, 16, 12, 30, 18, 16, 40]);
}

export async function exportFeeLedger(evKey){
  const btn = document.getElementById('sp-ledger-btn');
  const label = btn ? btn.innerHTML : '';
  if(btn){ btn.disabled = true; btn.innerHTML = '만드는 중…'; }
  try {
    const list = speakersForEvent(evKey)
      .filter(sp => !isHiddenSp(sp) && feeNum(sp) > 0 && paysFee(sp))
      .sort((a, b) => orderKey(a).localeCompare(orderKey(b)));
    if(!list.length){ showSaveErrorToast('연사료를 줄 연사가 없어요 — 연사 창 «제공사항»에서 연사료를 넣어 주세요'); return; }

    const ExcelJS = await loadExcelJs();
    const ev = EVENT_LIST.find(e => e.key === evKey);
    const evName = (ev && (ev.name_en || ev.name || ev.short)) || evKey;
    const evLabel = (ev && (ev.short || ev.name || ev.key)) || evKey;
    const d = new Date(), p = (v) => String(v).padStart(2, '0');
    const stamp = `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}`;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Bloom CRM';
    wb.created = d;
    const dom = list.filter(isDomesticSpeaker), ovs = list.filter(sp => !isDomesticSpeaker(sp));
    drawDomestic(wb, `${evName} 연사료 [국내] 지급대장`, dom);
    drawOverseas(wb, `${evName} 연사료 [해외] 지급대장`, ovs);

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${evLabel}_연사료 지급대장_${stamp}.xlsx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    trackAction('export', '연사료 지급대장', evKey,
      `연사료 지급대장(계좌번호 포함)을 내려받았어요 — 국내 ${dom.length}명 · 해외 ${ovs.length}명`);
  } catch(err){
    console.error('[fee-ledger] 내보내기 실패', err);
    showSaveErrorToast(err.message || '지급대장을 만들지 못했어요');
  } finally {
    if(btn){ btn.disabled = false; btn.innerHTML = label; }
  }
}

window.exportFeeLedger = exportFeeLedger;
