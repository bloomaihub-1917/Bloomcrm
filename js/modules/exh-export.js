/* ══════════════════════════════════════════════════════════════
   exh-export.js — 비품 신청 종합관리대장 내보내기

   비품 현황 화면은 "지금 무엇이 얼마나 신청됐나"를 보는 데는 좋지만, 렌탈사에
   넘기는 발주서와 주최 측에 내는 정산 근거는 결국 엑셀 한 장이다. 그동안은 그
   엑셀(2026 KIC_비품 신청 종합관리대장.xlsx)을 손으로 유지했다 — 신청이 하나
   바뀔 때마다 사람이 열어 수량을 고쳐 넣었고, CRM과 엑셀이 조용히 갈라졌다.

   그래서 그 엑셀을 CRM 데이터에서 그대로 찍어낸다. 형식은 쓰던 것을 따른다:

     [카탈로그_단가표]        품목표 그대로 (코드·규격·단가 KRW/USD)
     [종합비품신청관리대장]   가로=품목코드, 세로=참가기업(한 기업 한 줄)인 교차표
                              3행(숨김)에 단가를 깔고 SUMPRODUCT로 소계
     [추가 신청]              같은 교차표에서 기업이 따로 신청한 것만 (청구 대상)
     [기본 제공]              부스 타입에 딸려 오는 것만 (청구하지 않음)
     [카탈로그 외 신청내역]   교차표에 열이 없는 항목의 품목별 내역 (있을 때만)

   ── 왜 같은 표를 세 장 뽑나 ──
   발주는 둘을 합친 수량으로 하지만, 청구는 «추가»만 보고 부스 준비는 «기본»만
   본다. 한 장에 섞어 두면 볼 때마다 어느 줄이 어느 쪽인지 사람이 갈라야 하고,
   렌탈사에 추가분만 보내야 할 때 잘라낼 방법이 없다. 화면(비품 현황)의
   전체·기본·추가 탭과 같은 기준으로 나눈다.

   ── 왜 단가를 숨긴 행에 깔아 두나 ──
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
  EQUIP_CATALOG, catalogItem, liveItemsFor,
  exhEvent, EVENT_LIST,
} from '../state.js';
import { activeExhibitors, exhNames, exhContact, isBillable, isBoothGiven } from './exh-tab.js';
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

/* ── 한 기업 한 줄 ──
   이 대장은 «어느 기업이 무엇을 몇 개 신청했나»를 한눈에 보는 표다. 같은 회사가
   두 줄로 갈라져 있으면 그 회사의 수량을 세려고 두 줄을 눈으로 더해야 하고,
   업체명으로 거르거나 정렬하면 한쪽 줄만 잡힌다 — 발주서로 옮겨 적을 때 딱
   틀리기 좋은 모양이다.

   그래서 통화로 줄을 나누지 않는다. 금액은 전부 카탈로그의 원화 단가로 계산한다
   (청구 통화는 인보이스가 정한다 — 이 표가 보는 건 수량이다). 청구 통화까지
   봐야 할 때는 「카탈로그 외 신청내역」 시트에 품목별로 남아 있다. */

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
  const rows = [];         // 전체 — 대장의 한 줄 = 한 기업
  const base = [];         // 부스 타입에 딸려 오는 기본 제공만
  const extra = [];        // 기업이 따로 신청한 추가분만

  exhs.forEach(x => {
    /* 같은 기업을 세 벌로 센다 — 전체·기본·추가. 한 번 훑으면서 해당하는
       주머니에 같이 담는다(두 번 훑으면 규칙이 갈라진다). */
    const mk = () => ({ qty: new Map(), free: new Map(), direct: 0 });
    const all = mk(), bse = mk(), ext = mk();
    const add = (i, fn) => { fn(all); fn(isBoothGiven(i) ? bse : ext); };
    liveItemsFor(x.id).forEach(i => {
      if(!LEDGER_CATS.includes(i.category || '')) return;
      const cat = i.catalog_id ? catalogItem(i.catalog_id) : null;

      /* 카탈로그 밖의 항목(디자인 제작비·전기 인입처럼 렌탈 품목표에 없는 것)은
         교차표에 세울 열이 없다. 그래도 인보이스에는 함께 나가므로 금액은
         「카탈로그 외·분담」 칸에 담아 총액에 넣는다 — 여기서 빼면 대장 총액이
         청구서와 어긋난다. 무엇이었는지는 별도 시트에 품목별로 남는다. */
      if(!cat || cat.event_id !== evKey){
        offCatalog.push({ x, i });
        if(isBillable(i)) add(i, b => { b.direct += num(i.amount); });
        return;
      }
      used.add(cat.id);
      /* 공동 부스에서 비용만 나눠 낸 줄은 수량을 세지 않는다 — 실물은 상대
         기업이 주문하므로 여기서 또 세면 없는 의자를 발주하게 된다.
         (비품 현황 화면과 같은 규칙) 다만 그 기업이 내는 돈이라 금액은 남긴다. */
      if(String(i.shared_ref || '').trim()){
        if(isBillable(i)) add(i, b => { b.direct += num(i.amount); });
        return;
      }
      const q = num(i.qty) || 1;
      add(i, b => b.qty.set(cat.id, (b.qty.get(cat.id) || 0) + q));
      /* 무상 제공(청구 제외) 항목. 수량은 그대로 세야 한다 — 돈은 안 받아도
         물건은 만들어야 하니 발주 대상이다. 다만 소계가 수량×단가로 계산되는
         구조라 금액이 저절로 붙으므로, 그만큼을 「기타 금액」에서 뺀다. */
      if(!isBillable(i)) add(i, b => b.free.set(cat.id, (b.free.get(cat.id) || 0) + q));
    });

    /* 아직 아무것도 신청하지 않은 기업도 줄은 남긴다 — 누가 안 냈는지가
       대장에서 보여야 한다. 기본·추가 시트에서는 그쪽에 아무것도 없는 기업은
       빼 둔다(한쪽만 있는 기업이 절반이라 빈 줄이 표를 덮는다). */
    rows.push({ x, ...all });
    if(bse.qty.size || bse.direct) base.push({ x, ...bse });
    if(ext.qty.size || ext.direct) extra.push({ x, ...ext });
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
    exhs, rows, base, extra, cols, offCatalog,
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
/* 카탈로그 시트의 단가 열 — 대장의 숨긴 단가 행이 이걸 참조한다 */
const PRICE_COL = 'F';          // 단가(KRW)
const PRICE_ROW = 3;            // 단가 보조행(숨김)
const NUM_FMT   = '#,##0"원"';

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

/* 같은 교차표를 세 번 그린다 — 전체 / 추가만 / 기본만.
   view.rows 가 그 시트에 실을 줄이고, view.name 이 시트 이름이다. */
const LEDGER_VIEWS = {
  all: {
    name: '종합비품신청관리대장',
    note: '※ 이 시트는 기본 제공 + 추가 신청을 합친 «발주 수량»입니다 — 렌탈사에 넘기는 숫자입니다. 청구 대상만 보려면 「추가 신청」 시트를, 부스에 딸려 나가는 것만 보려면 「기본 제공」 시트를 보세요.',
  },
  extra: {
    name: '추가 신청',
    note: '※ 이 시트는 기업이 따로 신청한 «추가분»만 담습니다 — 청구 대상입니다. 부스 타입에 딸려 오는 기본 제공은 「기본 제공」 시트에 있고, 합친 발주 수량은 「종합비품신청관리대장」 시트에 있습니다. 그쪽에 신청이 없는 기업은 줄을 두지 않았습니다.',
  },
  base: {
    name: '기본 제공',
    note: '※ 이 시트는 부스 타입에 딸려 오는 «기본 제공»만 담습니다 — 발주는 하지만 기업에 청구하지 않습니다. 금액은 카탈로그 단가로 계산한 참고값이며 청구액이 아닙니다.',
    reference: true,
  },
};

function drawLedgerSheet(wb, data, meta, view = LEDGER_VIEWS.all){
  const { cols, equipCols, graphicCols, offCatalog } = data;
  const rows = view.rows || data.rows;
  const ws = wb.addWorksheet(view.name);

  const INFO    = 6;                        // No. ~ 담당자
  const cEquip0 = INFO + 1;                 // 첫 가구비품 열
  const cEquip1 = INFO + equipCols.length;
  const cEqSub  = cEquip1 + 1;              // 가구비품 소계
  const cGra0   = cEqSub + 1;
  const cGra1   = cEqSub + graphicCols.length;
  const cGraSub = cGra1 + 1;                // 그래픽·부대시설 소계
  /* 수량×단가로 낼 수 없는 금액 — 카탈로그 밖 품목·공동부스 분담분(+)과
     무상 제공분 차감(−). 인보이스에는 함께 나가므로 총액에 넣되, 어디서 온
     금액인지 갈라 둔다. */
  const cDirect = (graphicCols.length ? cGraSub : cEqSub) + 1;
  const cTotal  = cDirect + 1;
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
  equipCols.forEach((c, i) => { ws.getColumn(cEquip0 + i).width = 7; });
  graphicCols.forEach((c, i) => { ws.getColumn(cGra0 + i).width = 14; });
  ws.getColumn(cEqSub).width = 13;
  if(graphicCols.length) ws.getColumn(cGraSub).width = 15;
  ws.getColumn(cDirect).width = 17;
  ws.getColumn(cTotal).width = 14;

  /* 1행 — 그룹 머리글 */
  const r1 = ws.getRow(1);
  r1.getCell(1).value       = '업체 정보';
  r1.getCell(cEquip0).value = '가구비품 신청 수량 (코드별)';
  if(graphicCols.length) r1.getCell(cGra0).value = '그래픽·부대시설 신청 수량';
  r1.getCell(cDirect).value = view.reference
    ? '기타 금액\n(카탈로그 외·분담)' : '기타 금액\n(카탈로그 외·분담·무상)';
  r1.getCell(cTotal).value  = view.reference ? '참고 금액\n(청구 안 함)' : '총 신청금액';
  r1.height = 20;

  /* 2행 — 열 머리글. 가구비품은 코드만(80개 가까이라 이름까지 넣으면 읽히지
     않는다 — 이름은 카탈로그 시트에 있다), 그래픽은 코드+품명(몇 개뿐이고
     이름을 봐야 무엇인지 안다). */
  const r2 = ws.getRow(2);
  ['No.', '부스타입', '부스번호', '업체명(국문)', '업체명(영문)', '담당자']
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
  ws.mergeCells(1, cDirect, 2, cDirect);
  ws.mergeCells(1, cTotal, 2, cTotal);

  /* 3행 — 단가 보조행(숨김).
     카탈로그 시트를 참조로 걸어 두면, 단가가 개정돼 그 시트만 고쳐도 대장 전체
     금액이 따라온다. 값으로 박아 두면 두 시트가 갈라진다. */
  const rp = ws.getRow(PRICE_ROW);
  rp.getCell(INFO).value = '단가(KRW)';
  rp.getCell(INFO).font  = { ...FONT, italic: true };
  cols.forEach((c, i) => {
    const cell = rp.getCell(colAt(i));
    cell.value  = { formula: `${CAT_SHEET}!$${PRICE_COL}$${i + 2}` };
    cell.numFmt = NUM_FMT;
    cell.font   = FONT;
  });
  rp.hidden = true;

  /* 4행부터 — 한 줄 = 한 기업. 신청이 없는 기업도 한 줄 둔다(누가 아직
     신청하지 않았는지가 대장에서 보여야 한다). */
  const first = 4;
  rows.forEach((row, idx) => {
    const { x, qty, direct, free } = row;
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
    cols.forEach((c, i) => {
      const q = qty.get(c.id) || 0;
      if(q) r.getCell(colAt(i)).value = q;
    });

    /* 소계 = 수량 × 숨긴 단가 행. 값으로 박지 않아 수량 한 칸을 고쳐도
       금액이 따라온다. */
    const sub = (c0, c1) => ({ formula:
      `SUMPRODUCT(${L(c0)}${rn}:${L(c1)}${rn},${L(c0)}$${PRICE_ROW}:${L(c1)}$${PRICE_ROW})` });

    r.getCell(cEqSub).value = equipCols.length ? sub(cEquip0, cEquip1) : 0;
    if(graphicCols.length) r.getCell(cGraSub).value = sub(cGra0, cGra1);
    /* 기타 금액 = 카탈로그 밖 품목·분담분(+) − 무상 제공분(−).
       빼는 쪽은 수량은 내가 알지만 단가는 시트가 알아야 한다 — 단가 행을 참조해
       두면 카탈로그 단가가 바뀌어도 차감액이 따라온다. */
    const minus = [...free.entries()].map(([id, q]) => {
      const i = cols.findIndex(c => c.id === id);
      if(i < 0) return '';
      return `${q}*${L(colAt(i))}$${PRICE_ROW}`;
    }).filter(Boolean);
    if(minus.length && !view.reference) r.getCell(cDirect).value = { formula: `${direct}-${minus.join('-')}` };
    else if(direct)  r.getCell(cDirect).value = direct;
    r.getCell(cTotal).value = { formula:
      [cEqSub, graphicCols.length ? cGraSub : null, cDirect]
        .filter(Boolean).map(c => `${L(c)}${rn}`).join('+') };

    for(let c = 1; c <= cTotal; c++){
      const cell = r.getCell(c);
      const nameCol = c === 4 || c === 5;
      cell.font      = FONT;
      cell.border    = { bottom: BORDER, right: BORDER };
      cell.alignment = { vertical: 'middle', horizontal: nameCol ? 'left' : 'center', wrapText: nameCol };
    }
    [cEqSub, graphicCols.length ? cGraSub : null, cDirect, cTotal].filter(Boolean).forEach(c => {
      const cell = r.getCell(c);
      cell.fill      = fill(C_SUBTOT);
      cell.numFmt    = NUM_FMT;
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    });
  });

  const last = first + rows.length - 1;

  /* 합계 한 줄 — 수량도 금액도 같은 줄에서 센다. 통화로 줄을 나누지 않으니
     금액도 한 번에 더할 수 있다. */
  const totRow = last + 1;
  const tot = ws.getRow(totRow);
  tot.getCell(1).value = '합계';
  for(let c = cEquip0; c <= cTotal; c++){
    const cell = tot.getCell(c);
    cell.value = { formula: `SUM(${L(c)}${first}:${L(c)}${last})` };
    if(c === cEqSub || c === cGraSub || c === cDirect || c === cTotal){
      cell.numFmt    = NUM_FMT;
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    }
  }
  for(let c = 1; c <= cTotal; c++){
    const cell = tot.getCell(c);
    cell.font   = { ...FONT, bold: true };
    cell.fill   = fill(C_TOTROW);
    cell.border = { top: { style: 'medium', color: { argb: C_HEAD } }, bottom: BORDER };
    if(!cell.alignment) cell.alignment = { vertical: 'middle', horizontal: 'center' };
  }
  ws.mergeCells(totRow, 1, totRow, INFO);

  /* 아래 주석 — 이 숫자가 어디서 왔고 무엇을 빼고 세었는지. 표만 넘겨받은
     사람이 되물어야 알 수 있는 것들을 표 안에 남긴다. */
  const notes = [
    view.note,
    `※ ${meta.eventLabel} · CRM 「전시 → 비품 현황」의 신청 내역을 ${meta.stamp}에 그대로 집계한 표입니다. 품목 코드·단가는 「${CAT_SHEET}」 시트를 참조합니다.`,
    '※ 공동 부스에서 비용만 나눠 낸 줄(실물은 상대 기업이 주문)은 수량에서 뺐습니다 — 두 번 세면 없는 물건을 발주하게 됩니다.',
    `※ 소계·총액은 「${CAT_SHEET}」의 원화 단가 × 수량입니다. 3행은 그 단가를 수량과 같은 가로 방향으로 깔아 둔 계산용 보조행(숨김)이라 지우면 소계·총액이 계산되지 않습니다.`,
    '※ 한 기업은 한 줄입니다. 달러로 청구하는 기업의 신청도 같은 줄에 담았고, 금액은 모두 원화 단가로 계산했습니다 — 실제 청구 통화와 청구액은 인보이스를 따릅니다.',
  ];
  notes.push('※ 「기타 금액」은 수량×단가로 낼 수 없는 금액입니다 — 카탈로그에 없는 품목(디자인 제작비·전기 인입 등)과 공동 부스 분담분을 더하고, 무상 제공 항목은 뺍니다. 인보이스에는 함께 나가므로 총액에 넣었습니다.');
  if(!view.reference) notes.push('※ 무상 제공 항목은 수량은 그대로 세고(돈은 안 받아도 물건은 만들어야 하니 발주 대상입니다) 금액만 「기타 금액」에서 차감합니다 — 소계가 수량×단가로 계산되는 구조라 그냥 두면 없는 청구액이 붙습니다.');
  if(offCatalog.length) notes.push(
    `※ 그중 카탈로그에 없는 신청 ${offCatalog.length}건의 품목별 내역은 「카탈로그 외 신청내역」 시트에 있습니다 — 발주 전 확인이 필요합니다.`);

  notes.filter(Boolean).forEach((t, i) => {
    const cell = ws.getRow(totRow + 2 + i).getCell(1);
    cell.value     = t;
    cell.font      = { ...FONT, color: { argb: 'FF808080' } };
    cell.alignment = { vertical: 'top' };
  });

  /* 업체 정보와 머리글을 고정한다 — 80개 열을 오른쪽으로 밀고 나면 어느 회사
     줄인지 알 수 없어진다. */
  ws.views = [{ state: 'frozen', xSplit: INFO, ySplit: 3 }];
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
  /* 전체 → 추가 → 기본 순. 청구에 쓰는 「추가」를 앞에 둔다.
     한쪽이 아예 없는 행사(기본 제공을 안 쓰는 행사)는 그 시트를 만들지 않는다 —
     빈 표가 한 장 늘면 어느 시트를 봐야 하는지 헷갈린다. */
  drawLedgerSheet(wb, data, meta, LEDGER_VIEWS.all);
  if(data.extra.length) drawLedgerSheet(wb, data, meta, { ...LEDGER_VIEWS.extra, rows: data.extra });
  if(data.base.length)  drawLedgerSheet(wb, data, meta, { ...LEDGER_VIEWS.base,  rows: data.base });
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
