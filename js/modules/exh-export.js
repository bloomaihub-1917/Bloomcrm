/* ══════════════════════════════════════════════════════════════
   exh-export.js — 비품 신청 종합관리대장 내보내기

   비품 현황 화면은 "지금 무엇이 얼마나 신청됐나"를 보는 데는 좋지만, 렌탈사에
   넘기는 발주서와 주최 측에 내는 정산 근거는 결국 엑셀 한 장이다. 그동안은 그
   엑셀(2026 KIC_비품 신청 종합관리대장.xlsx)을 손으로 유지했다 — 신청이 하나
   바뀔 때마다 사람이 열어 수량을 고쳐 넣었고, CRM과 엑셀이 조용히 갈라졌다.

   그래서 그 엑셀을 CRM 데이터에서 그대로 찍어낸다. 형식은 쓰던 것을 따른다:

     [카탈로그_단가표]        품목표 그대로 (코드·규격·단가)
     [종합비품신청관리대장]   가로=품목코드, 세로=참가기업인 교차표
                              3행(숨김)에 단가를 가로로 깔고 SUMPRODUCT로 소계
     [카탈로그 외 신청내역]   교차표에 열이 없는 항목 (있을 때만)

   ── 왜 단가를 3행에 숨겨 두나 ──
   소계를 값으로 박아 넣으면 엑셀에서 수량을 고쳤을 때 금액이 따라오지 않는다.
   단가를 수량과 같은 방향(가로)으로 깔아 두면 SUMPRODUCT가 바로 먹고, 표를
   받은 사람이 수량 한 칸을 고쳐도 소계·총액이 스스로 맞는다.

   ── 왜 SheetJS가 아니라 ExcelJS인가 ──
   index.html이 이미 읽어 두는 SheetJS(무료판)는 셀 서식을 쓰지 못한다. 이
   대장은 머리글이 두 단(그룹/코드)이고 소계 열에 색이 들어가야 80개 열을
   눈으로 따라갈 수 있어서, 서식을 쓸 수 있는 ExcelJS를 내보내기를 누른
   순간에만 CDN에서 불러온다(첫 화면 로딩을 늘리지 않는다).
═══════════════════════════════════════════════════════════════ */

import {
  EQUIP_CATALOG, catalogItem, itemsFor,
  exhEvent, EVENT_LIST,
} from '../state.js';
import { activeExhibitors, exhNames, exhContact, currencyOf, isBillable } from './exh-tab.js';
import { showSaveErrorToast } from '../api.js';
import { trackAction } from './audit-tab.js';

const EXCELJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';

/* ExcelJS는 누를 때 한 번만 받아 온다. 실패하면 붙잡지 않고 다시 받을 수 있게
   약속(promise)을 비운다 — 잠깐 끊긴 네트워크 때문에 영영 못 쓰게 되면 곤란하다. */
let excelJs = null;
function loadExcelJs(){
  if(window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if(excelJs) return excelJs;
  excelJs = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = EXCELJS_SRC;
    s.onload  = () => window.ExcelJS ? resolve(window.ExcelJS)
                                     : reject(new Error('ExcelJS를 읽었지만 초기화되지 않았어요'));
    s.onerror = () => reject(new Error('엑셀 라이브러리를 불러오지 못했어요 (네트워크 확인)'));
    document.head.appendChild(s);
  }).catch(err => { excelJs = null; throw err; });
  return excelJs;
}

/* ── 서식 ── 쓰던 대장의 색을 그대로 쓴다(짙은 남색 그룹머리 / 남색 머리글 /
   연한 파랑 소계). 색이 바뀌면 인쇄해서 나란히 놓을 때 다른 문서처럼 보인다. */
const FONT     = { name: '맑은 고딕', size: 9 };
const C_GROUP  = 'FF1F3864';
const C_HEAD   = 'FF305496';
const C_SUBTOT = 'FFD9E1F2';
const C_TOTROW = 'FFF2F2F2';
const BORDER   = { style: 'thin', color: { argb: 'FFD9D9D9' } };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const headStyle = (argb) => ({
  font: { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } },
  fill: fill(argb),
  alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
});

const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };

/* ══════════════════════════════════════════
   집계 — 화면(비품 현황)과 같은 규칙으로 센다
══════════════════════════════════════════ */

/* 대장에 실을 항목. 부스·기타는 대장의 대상이 아니다(렌탈 비품과 그래픽만). */
const LEDGER_CATS = ['equip', 'graphic'];
const CAT_LABEL = { equip: '비품', graphic: '그래픽' };

/* ── 통화 ──
   같은 품목을 어떤 기업은 원화로, 어떤 기업은 달러로 청구받는다(2026 KIC은
   원화 23곳 · 달러 16곳). 통화를 적지 않고 원화로 환산해 버리면, 달러로 청구한
   기업의 숫자가 실제 청구액과 다른 채로 대장에 남는다.

   그래서 한 줄은 한 통화만 담는다. 두 통화가 섞인 기업(신청서는 원화, 그래픽
   추가분은 달러 — 실제로 3곳)은 통화별로 줄을 나눈다. 억지로 한 줄에 합치면
   원화와 달러를 더한 숫자가 되고, 어느 쪽으로 환산해도 실제 청구액이 아니다. */
const CURRENCIES = ['KRW', 'USD'];
const curOf = (i) => (i.currency === 'USD' ? 'USD' : 'KRW');

export function buildLedger(evKey){
  const exhs = activeExhibitors(evKey).slice().sort((a, b) => {
    const an = exhNames(a), bn = exhNames(b);
    return String(an.en || an.ko).localeCompare(String(bn.en || bn.ko), 'en');
  });

  /* 열을 무엇으로 세울까 ─ 이 행사의 살아 있는 품목 전부.
     내린 품목(active='no')이라도 이미 신청에 쓰였으면 열을 남긴다. 열이 없으면
     그 기업의 수량이 대장에서 소리 없이 사라진다. */
  const used = new Set();
  const offCatalog = [];   // 카탈로그에 잇지 못한 신청 — 교차표에 담을 자리가 없다
  const rows = [];         // 대장의 한 줄 = 한 기업 × 한 통화

  exhs.forEach(x => {
    const byCur = new Map();   // 통화 → Map(catalogId → 수량)
    itemsFor(x.id).forEach(i => {
      if(!LEDGER_CATS.includes(i.category || '')) return;
      const cat = i.catalog_id ? catalogItem(i.catalog_id) : null;
      if(!cat || cat.event_id !== evKey){ offCatalog.push({ x, i }); return; }
      used.add(cat.id);
      /* 공동 부스에서 비용만 나눠 낸 줄은 수량을 세지 않는다 — 실물은 상대
         기업이 주문하므로 여기서 또 세면 없는 의자를 발주하게 된다.
         (비품 현황 화면과 같은 규칙) */
      if(String(i.shared_ref || '').trim()) return;
      const c = curOf(i);
      if(!byCur.has(c)) byCur.set(c, new Map());
      const m = byCur.get(c);
      m.set(cat.id, (m.get(cat.id) || 0) + (num(i.qty) || 1));
    });

    if(!byCur.size){
      /* 아직 아무것도 신청하지 않은 기업. 줄은 남긴다 — 누가 안 냈는지가
         대장에서 보여야 한다. 통화는 화면과 같은 규칙으로 정한다(인보이스 우선). */
      rows.push({ x, cur: currencyOf(x.id), qty: new Map(), split: false, empty: true });
      return;
    }
    const present = CURRENCIES.filter(c => byCur.has(c));
    present.forEach(c => rows.push({
      x, cur: c, qty: byCur.get(c), split: present.length > 1, empty: false,
    }));
  });

  const cols = EQUIP_CATALOG
    .filter(c => c.event_id === evKey && (c.active !== 'no' || used.has(c.id)))
    .sort((a, b) => {
      const ka = (a.kind || 'equip') === 'graphic' ? 1 : 0;
      const kb = (b.kind || 'equip') === 'graphic' ? 1 : 0;
      if(ka !== kb) return ka - kb;                       // 가구비품 → 그래픽·부대시설
      const sa = num(a.sort_order), sb = num(b.sort_order);
      if(sa !== sb) return sa - sb;
      return String(a.code || '').localeCompare(String(b.code || ''));
    });

  return {
    exhs, rows, cols, offCatalog,
    equipCols:   cols.filter(c => (c.kind || 'equip') !== 'graphic'),
    graphicCols: cols.filter(c => (c.kind || 'equip') === 'graphic'),
  };
}

/* ══════════════════════════════════════════
   시트 그리기
══════════════════════════════════════════ */

/* 엑셀 열 번호 → 문자(수식에 쓴다). 열이 80개를 넘어 AA·CF 구간까지 간다. */
function colLetter(n){
  let s = '';
  while(n > 0){ const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
  return s;
}

const CAT_SHEET = '카탈로그_단가표';
/* 카탈로그 시트의 단가 열 — 대장의 숨긴 단가 행이 통화별로 이걸 참조한다 */
const PRICE_COL = { KRW: 'F', USD: 'G' };

function drawCatalogSheet(wb, cols){
  const ws = wb.addWorksheet(CAT_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { width: 12 }, { width: 10 }, { width: 24 }, { width: 24 },
    { width: 20 }, { width: 12 }, { width: 11 }, { width: 30 },
  ];
  const head = ws.addRow(['구분', '코드', '품명(국문)', '품명(영문)', '규격', '단가(KRW)', '단가(USD)', '비고']);
  head.eachCell(c => Object.assign(c, headStyle(C_HEAD), { border: { bottom: BORDER } }));
  head.height = 20;

  cols.forEach(c => {
    const note = [c.note || '', c.active === 'no' ? '목록에서 내린 품목' : '']
      .filter(Boolean).join(' · ');
    const r = ws.addRow([
      c.category || '', c.code || '', c.name_ko || '', c.name_en || '',
      c.spec || '', num(c.price_krw) || null, num(c.price_usd) || null, note,
    ]);
    r.eachCell({ includeEmpty: true }, (cell, i) => {
      cell.font = FONT;
      cell.border = { bottom: BORDER };
      cell.alignment = { vertical: 'middle', horizontal: i <= 2 ? 'center' : 'left', wrapText: true };
    });
    [6, 7].forEach(i => {
      r.getCell(i).numFmt = '#,##0';
      r.getCell(i).alignment = { vertical: 'middle', horizontal: 'right' };
    });
  });
  return ws;
}

function drawLedgerSheet(wb, data, meta){
  const { rows, cols, equipCols, graphicCols, offCatalog } = data;
  const ws = wb.addWorksheet('종합비품신청관리대장');

  const INFO    = 7;                        // No. ~ 통화
  const cEquip0 = INFO + 1;                 // 첫 가구비품 열
  const cEquip1 = INFO + equipCols.length;
  const cEqSub  = cEquip1 + 1;              // 가구비품 소계
  const cGra0   = cEqSub + 1;
  const cGra1   = cEqSub + graphicCols.length;
  const cGraSub = cGra1 + 1;                // 그래픽·부대시설 소계
  const cTotal  = graphicCols.length ? cGraSub + 1 : cEqSub + 1;
  const L = colLetter;

  /* 카탈로그 순서(cols)의 i번째 품목이 대장에서 몇 번째 열인가 —
     가구비품과 그래픽 사이에 소계 열이 하나 끼어 있어 한 칸 밀린다. */
  const colAt = (i) => cEquip0 + i + (i >= equipCols.length ? 1 : 0);

  ws.getColumn(1).width = 5;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 9;
  ws.getColumn(4).width = 24;
  ws.getColumn(5).width = 26;
  ws.getColumn(6).width = 18;
  ws.getColumn(7).width = 7;                // 통화
  equipCols.forEach((c, i) => { ws.getColumn(cEquip0 + i).width = 7; });
  graphicCols.forEach((c, i) => { ws.getColumn(cGra0 + i).width = 14; });
  ws.getColumn(cEqSub).width = 13;
  if(graphicCols.length) ws.getColumn(cGraSub).width = 15;
  ws.getColumn(cTotal).width = 14;

  /* 1행 — 그룹 머리글 */
  const r1 = ws.getRow(1);
  r1.getCell(1).value       = '업체 정보';
  r1.getCell(cEquip0).value = '가구비품 신청 수량 (코드별)';
  if(graphicCols.length) r1.getCell(cGra0).value = '그래픽·부대시설 신청 수량';
  /* 금액 머리글에 "(원)"을 박지 않는다 — 줄마다 통화가 다르다. 통화는 G열이
     말하고, 셀 표시형식이 원/달러를 따라간다. */
  r1.getCell(cTotal).value  = '총 신청금액';
  r1.height = 20;

  /* 2행 — 열 머리글. 가구비품은 코드만(80개 가까이라 이름까지 넣으면 읽히지
     않는다 — 이름은 카탈로그 시트에 있다), 그래픽은 코드+품명(몇 개뿐이고
     이름을 봐야 무엇인지 안다). */
  const r2 = ws.getRow(2);
  ['No.', '부스타입', '부스번호', '업체명(국문)', '업체명(영문)', '담당자', '통화']
    .forEach((v, i) => { r2.getCell(i + 1).value = v; });
  equipCols.forEach((c, i) => { r2.getCell(cEquip0 + i).value = c.code || ''; });
  r2.getCell(cEqSub).value = '가구비품\n소계';
  graphicCols.forEach((c, i) => {
    r2.getCell(cGra0 + i).value = `${c.code || ''}\n${c.name_ko || c.name_en || ''}`;
  });
  if(graphicCols.length) r2.getCell(cGraSub).value = '그래픽·부대시설\n소계';
  r2.height = graphicCols.length ? 46 : 26;

  for(let c = 1; c <= cTotal; c++){
    Object.assign(r1.getCell(c), headStyle(C_GROUP));
    Object.assign(r2.getCell(c), headStyle(C_HEAD));
  }
  ws.mergeCells(1, 1, 1, INFO);
  ws.mergeCells(1, cEquip0, 1, cEqSub);
  if(graphicCols.length) ws.mergeCells(1, cGra0, 1, cGraSub);
  ws.mergeCells(1, cTotal, 2, cTotal);

  /* 3·4행 — 단가 보조행(숨김). 통화마다 한 줄씩 둔다.
     카탈로그 시트를 참조로 걸어 두면, 단가가 개정돼 그 시트만 고쳐도 대장 전체
     금액이 따라온다. 값으로 박아 두면 두 시트가 갈라진다. */
  const PRICE_ROW = { KRW: 3, USD: 4 };
  const NUM_FMT   = { KRW: '#,##0"원"', USD: '"$"#,##0' };
  const CUR_COL   = L(7);   // 통화 열 — 소계 수식과 합계가 이 열을 읽는다
  CURRENCIES.forEach(cur => {
    const rp = ws.getRow(PRICE_ROW[cur]);
    rp.getCell(INFO).value = `단가(${cur})`;
    rp.getCell(INFO).font  = { ...FONT, italic: true };
    cols.forEach((c, i) => {
      const cell = rp.getCell(colAt(i));
      cell.value  = { formula: `${CAT_SHEET}!$${PRICE_COL[cur]}$${i + 2}` };
      cell.numFmt = NUM_FMT[cur];
      cell.font   = FONT;
    });
    rp.hidden = true;
  });

  /* 5행부터 — 한 줄 = 한 기업 × 한 통화. 신청이 없는 기업도 한 줄 둔다(누가
     아직 신청하지 않았는지가 대장에서 보여야 한다). */
  const first = 5;
  rows.forEach((row, idx) => {
    const { x, cur, qty, split } = row;
    const rn = first + idx;
    const n  = exhNames(x);
    /* 담당자는 exhibitor_contacts 줄을 그대로 읽으면 안 된다 — 마스터DB로 이관된
       사람은 그 줄에 contact_id만 남고 이름·이메일 칸이 비어 있다. 화면이 쓰는
       리졸버(exhContact)를 그대로 써서 마스터DB에서 실시간으로 읽는다. */
    const pc = exhContact(x);
    const r  = ws.getRow(rn);

    r.getCell(1).value = idx + 1;
    r.getCell(2).value = x.booth_type || '';
    r.getCell(3).value = x.booth_no || '';
    r.getCell(4).value = n.ko || '';
    r.getCell(5).value = n.en || '';
    r.getCell(6).value = pc.name || pc.email || '';
    r.getCell(7).value = cur;
    cols.forEach((c, i) => {
      const q = qty.get(c.id) || 0;
      if(q) r.getCell(colAt(i)).value = q;
    });

    /* 소계는 G열 「통화」를 보고 그 통화의 단가 행과 곱한다 — 원화면 3행,
       달러면 4행. 내보낼 때의 통화를 수식에 박지 않고 G열을 읽게 해 두면,
       표를 받은 사람이 통화를 고쳐도 금액이 따라온다(수량을 고쳤을 때 소계가
       따라오는 것과 같은 이유다). */
    const sub = (c0, c1) => ({ formula:
      `IF($${CUR_COL}${rn}="USD"`
      + `,SUMPRODUCT(${L(c0)}${rn}:${L(c1)}${rn},${L(c0)}$${PRICE_ROW.USD}:${L(c1)}$${PRICE_ROW.USD})`
      + `,SUMPRODUCT(${L(c0)}${rn}:${L(c1)}${rn},${L(c0)}$${PRICE_ROW.KRW}:${L(c1)}$${PRICE_ROW.KRW}))` });

    r.getCell(cEqSub).value = equipCols.length ? sub(cEquip0, cEquip1) : 0;
    if(graphicCols.length) r.getCell(cGraSub).value = sub(cGra0, cGra1);
    r.getCell(cTotal).value = graphicCols.length
      ? { formula: `${L(cEqSub)}${rn}+${L(cGraSub)}${rn}` }
      : { formula: `${L(cEqSub)}${rn}` };

    for(let c = 1; c <= cTotal; c++){
      const cell = r.getCell(c);
      const nameCol = c === 4 || c === 5;
      cell.font      = FONT;
      cell.border    = { bottom: BORDER, right: BORDER };
      cell.alignment = { vertical: 'middle', horizontal: nameCol ? 'left' : 'center', wrapText: nameCol };
    }
    /* 두 통화로 나뉜 기업은 통화 칸을 굵게 — 같은 회사가 두 줄인 이유가
       그 칸에 있다는 걸 바로 알아채게 한다. */
    if(split) r.getCell(7).font = { ...FONT, bold: true, color: { argb: 'FFC0504D' } };
    [cEqSub, graphicCols.length ? cGraSub : null, cTotal].filter(Boolean).forEach(c => {
      const cell = r.getCell(c);
      cell.fill      = fill(C_SUBTOT);
      /* 기본 표시형식은 원화로 두고, 달러는 아래 조건부 서식이 G열을 보고
         바꾼다 — 통화를 고치면 숫자와 함께 통화 기호도 따라온다. */
      cell.numFmt    = NUM_FMT.KRW;
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    });
  });

  const last = first + rows.length - 1;

  /* 금액 칸의 통화 기호도 G열을 따라가게 한다. 표시형식은 셀에 박히는 값이라
     수식처럼 다른 칸을 볼 수 없어서, 조건부 서식으로 "G가 USD면 달러 표기"를
     걸어 둔다. 기본형식은 원화이므로 G를 KRW로 되돌리면 원 표기로 돌아온다. */
  /* priority는 시트 안에서 겹치지 않게 준다 — 겹치면 엑셀이 파일을 복구
     대상으로 본다. */
  if(rows.length) [cEqSub, graphicCols.length ? cGraSub : null, cTotal]
    .filter(Boolean).forEach((c, i) => {
      ws.addConditionalFormatting({
        ref: `${L(c)}${first}:${L(c)}${last}`,
        rules: [{ type: 'expression', priority: i + 1,
          formulae: [`$${CUR_COL}${first}="USD"`],
          style: { numFmt: NUM_FMT.USD } }],
      });
    });

  /* 합계 ─ 수량은 통화와 무관하니 전부 더하고(발주서에 그대로 옮겨 적는 숫자다),
     금액은 원화와 달러를 더할 수 없으니 통화별로 나눠 센다. */
  const totRows = [
    { label: '합계 (수량)', qty: true,  cur: null },
    ...CURRENCIES.map(c => ({ label: `합계 (${c})`, qty: false, cur: c })),
  ];
  totRows.forEach((t, i) => {
    const rn  = last + 1 + i;
    const tot = ws.getRow(rn);
    tot.getCell(1).value = t.label;
    if(t.qty){
      for(let c = cEquip0; c <= cTotal; c++){
        if(c === cEqSub || c === cGraSub || c === cTotal) continue;
        tot.getCell(c).value = { formula: `SUM(${L(c)}${first}:${L(c)}${last})` };
      }
    } else {
      [cEqSub, graphicCols.length ? cGraSub : null, cTotal].filter(Boolean).forEach(c => {
        const cell = tot.getCell(c);
        cell.value = { formula:
          `SUMIF(${CUR_COL}${first}:${CUR_COL}${last},"${t.cur}",${L(c)}${first}:${L(c)}${last})` };
        cell.numFmt    = NUM_FMT[t.cur];
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      });
    }
    for(let c = 1; c <= cTotal; c++){
      const cell = tot.getCell(c);
      cell.font   = { ...FONT, bold: true };
      cell.fill   = fill(C_TOTROW);
      cell.border = i === 0
        ? { top: { style: 'medium', color: { argb: C_HEAD } }, bottom: BORDER }
        : { bottom: BORDER };
      if(!cell.alignment) cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }
    ws.mergeCells(rn, 1, rn, INFO);
  });
  const totRow = last + totRows.length;

  /* 아래 주석 — 이 숫자가 어디서 왔고 무엇을 빼고 세었는지. 표만 넘겨받은
     사람이 되물어야 알 수 있는 것들을 표 안에 남긴다. */
  const notes = [
    `※ ${meta.eventLabel} · CRM 「전시 → 비품 현황」의 신청 내역을 ${meta.stamp}에 그대로 집계한 표입니다. 품목 코드·단가는 「${CAT_SHEET}」 시트를 참조합니다.`,
    '※ 공동 부스에서 비용만 나눠 낸 줄(실물은 상대 기업이 주문)은 수량에서 뺐습니다 — 두 번 세면 없는 물건을 발주하게 됩니다.',
    `※ 소계·총액은 「${CAT_SHEET}」의 단가 × 수량이며, G열 「통화」가 그 줄의 통화입니다(KRW는 원, USD는 달러 단가). 3·4행은 그 단가를 수량과 같은 가로 방향으로 통화별로 깔아 둔 계산용 보조행(숨김)이라 지우면 소계·총액이 계산되지 않습니다.`,
    '※ 한 줄에는 한 통화만 담습니다. 원화와 달러를 함께 신청한 기업은 통화별로 줄을 나눴습니다(업체명이 두 줄인 경우) — 한 줄에 합치면 원화와 달러를 더한 숫자가 됩니다.',
    '※ 맨 아래 합계는 수량 한 줄과 통화별 금액 두 줄입니다. 수량은 통화와 무관하므로 전부 더하고, 금액은 통화가 다르면 더할 수 없어 나눠 셉니다.',
  ];
  if(offCatalog.length) notes.push(
    `※ 카탈로그에 없는 신청 ${offCatalog.length}건은 실을 열이 없어 「카탈로그 외 신청내역」 시트에 따로 담았습니다 — 발주 전 확인이 필요합니다.`);

  notes.forEach((t, i) => {
    const cell = ws.getRow(totRow + 2 + i).getCell(1);
    cell.value     = t;
    cell.font      = { ...FONT, color: { argb: 'FF808080' } };
    cell.alignment = { vertical: 'top' };
  });

  /* 업체 정보와 머리글을 고정한다 — 80개 열을 오른쪽으로 밀고 나면 어느 회사
     줄인지 알 수 없어진다. */
  ws.views = [{ state: 'frozen', xSplit: INFO, ySplit: 4 }];
  return ws;
}

/* 교차표에 자리가 없는 항목 — 조용히 빠지면 발주에서 통째로 누락된다. */
function drawOffCatalogSheet(wb, offCatalog){
  const ws = wb.addWorksheet('카탈로그 외 신청내역', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { width: 9 }, { width: 24 }, { width: 26 }, { width: 10 }, { width: 34 },
    { width: 8 }, { width: 12 }, { width: 12 }, { width: 8 }, { width: 30 },
  ];
  const head = ws.addRow(['부스번호', '업체명(국문)', '업체명(영문)', '분류', '항목명',
    '수량', '단가', '금액', '통화', '비고']);
  head.eachCell(c => Object.assign(c, headStyle(C_HEAD), { border: { bottom: BORDER } }));
  head.height = 20;

  offCatalog.forEach(({ x, i }) => {
    const n = exhNames(x);
    const note = [
      i.note || '',
      String(i.shared_ref || '').trim() ? '비용 분담(실물은 상대 기업 주문)' : '',
      isBillable(i) ? '' : '청구 제외',
    ].filter(Boolean).join(' · ');
    const r = ws.addRow([
      x.booth_no || '', n.ko || '', n.en || '', CAT_LABEL[i.category] || i.category || '',
      i.name || '', num(i.qty) || null, num(i.unit_price) || null, num(i.amount) || null,
      i.currency || 'KRW', note,
    ]);
    r.eachCell({ includeEmpty: true }, cell => {
      cell.font      = FONT;
      cell.border    = { bottom: BORDER };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    [7, 8].forEach(c => {
      r.getCell(c).numFmt    = '#,##0';
      r.getCell(c).alignment = { vertical: 'middle', horizontal: 'right' };
    });
  });
  return ws;
}

/* ══════════════════════════════════════════
   내보내기
══════════════════════════════════════════ */

/* 워크북 만들기 — 브라우저 API를 쓰지 않는다(그래서 그대로 검증할 수 있다).
   내려받기(Blob·앵커)는 아래 exportEquipLedger가 맡는다. */
export function buildWorkbook(ExcelJS, evKey, meta){
  const data = buildLedger(evKey);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bloom CRM';
  wb.created = meta.now || new Date();

  /* 카탈로그 시트를 먼저 만든다 — 대장의 단가 보조행이 이 시트의 행 번호를
     참조하므로, 두 시트가 같은 배열(data.cols)을 같은 순서로 써야 한다. */
  drawCatalogSheet(wb, data.cols);
  drawLedgerSheet(wb, data, meta);
  if(data.offCatalog.length) drawOffCatalogSheet(wb, data.offCatalog);
  return { wb, data };
}

function stampNow(){
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return {
    text: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`,
    file: `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}`,
  };
}

export async function exportEquipLedger(){
  const evKey = exhEvent;
  if(!evKey) return showSaveErrorToast('행사를 먼저 고르세요');

  const data = buildLedger(evKey);
  if(!data.exhs.length) return showSaveErrorToast('이 행사에 참가기업이 없어 내보낼 게 없어요');
  if(!data.cols.length) return showSaveErrorToast('이 행사의 품목표가 비어 있어요 — 설정에서 비품 카탈로그를 먼저 등록하세요');

  /* 만드는 동안 두 번 눌리면 파일이 두 개 떨어진다. 누른 버튼을 잠근다. */
  const btn = document.getElementById('exh-export-btn');
  const label = btn ? btn.innerHTML : '';
  if(btn){ btn.disabled = true; btn.textContent = '만드는 중…'; }

  try {
    const ExcelJS = await loadExcelJs();
    const ev = EVENT_LIST.find(e => e.key === evKey);
    const evLabel = (ev && (ev.short || ev.key)) || evKey;
    const stamp = stampNow();

    const { wb } = buildWorkbook(ExcelJS, evKey, { eventLabel: evLabel, stamp: stamp.text });
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${evLabel}_비품 신청 종합관리대장_${stamp.file}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    trackAction('add', '비품 대장 내보내기', evLabel,
      `${data.exhs.length}개사 · ${data.cols.length}품목`
      + (data.offCatalog.length ? ` · 카탈로그 외 ${data.offCatalog.length}건` : ''));
  } catch(err){
    console.error('[exh-export] 내보내기 실패', err);
    showSaveErrorToast('내보내기 실패: ' + (err && err.message ? err.message : err));
  } finally {
    if(btn){ btn.disabled = false; btn.innerHTML = label; }
  }
}

window.exportEquipLedger = exportEquipLedger;
