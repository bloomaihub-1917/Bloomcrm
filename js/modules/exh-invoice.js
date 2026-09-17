/* ══════════════════════════════════════════════════════════════
   exh-invoice.js — 참가기업 인보이스 내보내기

   정산 탭에서 인보이스를 한 줄 만들면 금액과 발송일·입금 기한은 CRM에 남는다.
   그런데 기업에 실제로 보내는 것은 양식에 맞춰 찍은 엑셀 한 장이고, 그 한 장은
   그동안 사람이 만들었다 — 양식 파일을 복사해 열고, 기업명·부스번호·인보이스
   번호를 적고, 품목을 한 줄씩 옮겨 적고, 단가를 다시 두드렸다. 59개사면 59번이다.

   옮겨 적는 동안 숫자는 갈라진다. CRM에서 항목 하나를 고쳐도 이미 만든 엑셀은
   따라오지 않고, 어느 쪽이 맞는지는 두 개를 나란히 놓고 대조해야만 알 수 있다.

   그래서 정산의 금액 항목에서 그대로 찍어낸다. 양식은 쓰던 것을 그대로 쓴다 —
   Data/인보이스_양식.xlsx를 읽어서 빈 칸만 채운다. 로고·직인·계좌 안내·인쇄
   설정은 손대지 않는다. 처음부터 그려내면 그 한 장이 조용히 다른 문서가 된다.
   (양식 파일 자체는 저장소에 없다 — 직인과 계좌번호가 박혀 있고 이 저장소는
   공개다. 아래 loadTemplate 참고.)

   ── 국문·영문 두 장 ──
   양식에는 국문·영문 시트가 함께 있다. 둘 다 같은 내용으로 채운다 — 국문 시트는
   국문 상호와 품목명을, 영문 시트는 영문 상호와 카탈로그 영문 품명을 쓴다.
   보낼 때 필요한 쪽을 골라 쓰던 방식 그대로다.

   ── 통화 ──
   한 기업 안에서 부스는 달러, 비품은 원화로 갈리는 일이 실제로 있다. 인보이스
   한 장에 두 통화를 담을 수는 없으므로 그 인보이스의 통화와 같은 항목만 싣고,
   빠진 항목이 있으면 알린다(실제로 원화·달러를 따로 발행해 왔다).

   ── 왜 행을 넣거나 빼지 않나 ──
   남는 줄은 지우지 않고 숨긴다 — ExcelJS의 행 삭제는 병합·그림·수식을 따라
   옮기지 못해서 양식 아래쪽(TOTAL·계좌 안내·직인)이 통째로 어긋난다. 숨긴 줄은
   화면에도 인쇄에도 나오지 않으니 3줄짜리 인보이스는 손으로 만든 것과 같은
   모습이 된다.

   항목 칸이 몇 줄인지는 코드에 박지 않고 양식에서 읽는다(B열의 TOTAL을 찾는다).
   받은 원본 양식은 국문 9줄·영문 11줄이고, scripts/build-invoice-template.js로
   24줄까지 늘려 쓸 수도 있다 — 어느 쪽이든 그대로 채운다.

   ── 금액 칸은 값이 아니라 수식으로 ──
   금액을 값으로 박아 넣으면 받은 사람이 수량 한 칸을 고쳤을 때 합계가 따라오지
   않는다. 양식이 쓰던 대로 `=단가×수량`을 남기고 TOTAL은 SUM으로 둔다. 다만
   CRM의 금액이 수량×단가와 맞지 않는 줄(금액만 적어 둔 항목 등)은 청구액이
   기준이므로 금액을 그대로 적는다 — 없는 단가를 만들어 넣지 않는다.
═══════════════════════════════════════════════════════════════ */

import {
  getExhibitorById, invoicesFor, liveItemsFor, catalogItem, findCatalogByName,
  EXH_INVOICES, EVENT_LIST, exhEvent,
} from '../state.js';
import { exhNames, isBillable, currencyOf } from './exh-tab.js';
import { createInvoiceRow } from './exh-drawer.js';
import {
  supported, pickFolder, delHandle, readyFolder, folderLabel, subFolder, writeFile,
} from './local-folder.js';
import { showSaveErrorToast } from '../api.js';
import { trackAction } from './audit-tab.js';

const EXCELJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
const TEMPLATE_URL = 'Data/인보이스_양식.xlsx';

/* 항목 칸은 9행에서 시작한다(머리글이 8행). 어디서 끝나는지는 양식마다 달라서
   코드에 박지 않고 읽는다 — 아래 sheetBounds 참고. */
const FIRST_ROW = 9;

/* 두 시트의 차이는 단위·기한 문구·언어뿐이다. 품명 칸(C:E)과 TOTAL 위치,
   계좌 안내는 두 장이 같다. */
const SHEETS = [
  { name: '국문', lang: 'ko', unit: '개',  duePrefix: '납입기한: ' },
  { name: '영문', lang: 'en', unit: 'EA', duePrefix: 'Due Date: ' },
];

/* 품명을 어느 칸에 적나 — 양식마다 다르다.

   국문 시트는 상세 칸이 C:E 한 칸이다. 영문 시트는 받은 원본에서 코드(C)와
   품명(D:E)이 갈려 있고, 24줄로 늘린 양식은 실제 발행해 온 인보이스를 따라
   C:E 한 칸으로 합쳐 두었다. 한 칸짜리 양식에 «코드 칸»을 가정하고 적으면
   품명이 7자 남짓한 칸에 들어가 잘린다(실제로 잘려 나갔다).

   그래서 9행의 병합을 보고 정한다: 품명 칸이 E까지 뻗어 있으면 거기에 다 적고,
   아니면 코드는 C에 품명은 D에 적는다. */
const COL_E = 5;
function nameLayout(ws){
  const m = Object.values(ws._merges).map(x => x.model)
    .find(d => d.top <= FIRST_ROW && d.bottom >= FIRST_ROW && d.left === 3);  // C열에서 시작하는 병합
  return (m && m.right >= COL_E) ? { name: 'C', code: null } : { name: 'D', code: 'C' };
}

/* 품목 코드 — 카탈로그 코드, 없으면 품목명 앞에 붙어 있는 코드 */
const CODE_RE = /^([A-Z]{1,2}-\d{2,4})\s+/;
function itemCode(i){
  const c = catalogItem(i.catalog_id);
  if(c && c.code) return String(c.code);
  const m = CODE_RE.exec(String(i.name || '').trim());
  return m ? m[1] : '';
}

/* 구분 칸에 적히는 이름. 설정(code_lists)의 화면 라벨을 따르지 않는다 — 화면
   라벨을 바꿨다고 기업에 나가는 인보이스의 글자가 바뀌면 곤란하다. 영문은 받은
   양식에 박혀 있던 표기 그대로. */
const GROUPS = [
  { cat: 'booth',   ko: '부스 타입',     en: 'Booth Type' },
  { cat: 'equip',   ko: '비품 임대',     en: 'Office Furniture Rental' },
  { cat: 'graphic', ko: '사인물 프린팅', en: 'Graphic' },
  { cat: 'etc',     ko: '기타',          en: 'Others' },
];
const CATS = GROUPS.map(g => g.cat);

const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
const pad2 = (n) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date(), p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/* 품명 — 국문 시트는 CRM에 적힌 그대로, 영문 시트는 카탈로그의 영문명을 쓴다.
   카탈로그 코드는 품명 앞에 붙여 준다("C-040 Folding Chair") — 지금 발행해 온
   인보이스가 그 꼴이고, 렌탈사와 대조할 때 코드로 찾는다.

   카탈로그 연결(catalog_id)이 없는 항목이 많다. 신청서에서 손으로 옮겨 적으면
   이름만 남는데, 그 이름이 국문이면 영문 인보이스에 «C-011 디자인 체어 (화이트)»가
   그대로 실려 나간다(실제로 그렇게 나갔다). 연결이 없으면 이름으로 카탈로그를
   한 번 더 찾는다 — 코드·국문명·영문명을 모두 훑으므로 대개 걸린다. */
function itemName(i, lang){
  const raw = String(i.name || '').trim();
  if(lang === 'ko') return raw;
  const x = getExhibitorById(i.exhibitor_id);
  const c = catalogItem(i.catalog_id) || findCatalogByName(x && x.event_id, raw);
  if(!c || !c.name_en) return raw;
  const code = String(c.code || '').trim();
  return code ? `${code} ${c.name_en}` : c.name_en;
}

/* ══════════════════════════════════════════
   인보이스 한 장의 내용 — 엑셀을 모르는 순수 계산
══════════════════════════════════════════ */
export function invoiceDoc(inv){
  const x = inv && getExhibitorById(inv.exhibitor_id);
  if(!x) return null;
  const cur = inv.currency || currencyOf(x.id);
  const all = liveItemsFor(x.id).filter(isBillable);
  const mine = all.filter(i => (i.currency || 'KRW') === cur);

  const rows = [];
  const groups = [];
  GROUPS.forEach(g => {
    const list = mine.filter(i => (CATS.includes(i.category) ? i.category : 'etc') === g.cat);
    if(!list.length) return;
    groups.push({ ...g, count: list.length });
    list.forEach(i => {
      const amount = num(i.amount), qty = num(i.qty), up = num(i.unit_price);
      /* 수량×단가가 청구액과 맞을 때만 수식으로 둔다 — 맞지 않으면 청구액이
         기준이다. 단가를 금액÷수량으로 꾸며 넣으면 나누어떨어지지 않는 줄에서
         합계가 청구액과 어긋난다. */
      const exact = qty > 0 && up > 0 && Math.round(qty * up) === Math.round(amount);
      rows.push({ item: i, qty: qty > 0 ? qty : null, up: exact ? up : null, amount });
    });
  });

  const { ko, en } = exhNames(x);
  const seq = Math.max(invoicesFor(x.id).findIndex(i => i.id === inv.id) + 1, 1);
  const booth = String(x.booth_no ?? '').trim();
  /* 인보이스 번호는 쓰던 규칙 그대로 — EX-{부스번호}-{발행 순번}.
     부스가 한 칸이면 두 자리로 맞추고(EX-01-01), 두 칸을 쓰면 그대로(EX-42-43-04). */
  const boothNo = /^\d+$/.test(booth) ? pad2(booth) : booth;

  return {
    exhId: x.id,
    no: `EX-${boothNo || '00'}-${pad2(seq)}`,
    date: inv.sent_at || today(),
    due: inv.due_date || '',
    booth,
    to: { ko: ko || en, en: en || ko },
    cur, groups, rows,
    /* 알려야 할 것들 — 숫자가 조용히 갈라지는 자리다 */
    itemSum: rows.reduce((s, r) => s + r.amount, 0),
    invAmount: String(inv.amount ?? '').trim() === '' ? null : num(inv.amount),
    otherCur: all.length - mine.length,
  };
}

/* ══════════════════════════════════════════
   양식 채우기 — 워크북과 문서만 받는다(브라우저 API 없음)
══════════════════════════════════════════ */

/* 항목 칸이 어디서 끝나는지 — 양식에게 묻는다.

   전에는 24줄이라고 코드에 박아 두었다. 그런데 앱을 GitHub Pages에 올리면
   Data/ 폴더가 없어서(공개 저장소라 양식을 넣지 않는다) 파일 고르기 창이 뜨고,
   거기서 받은 원본 양식(국문 9줄·영문 11줄)을 고르는 일이 실제로 있었다.
   그러면 10~24번째 «항목 줄»이 TOTAL·납입 안내·계좌 안내·직인 자리를 그대로
   덮어썼다 — 아래가 통째로 사라진 인보이스가 기업 폴더에 저장됐고, 열어보기
   전에는 아무도 몰랐다.

   그래서 줄 수를 세지 않고 B열에서 TOTAL을 찾는다. 원본 양식이든 24줄로 늘린
   양식이든 그 자리가 항목 칸의 끝이다. 못 찾으면 인보이스 양식이 아니므로
   채우지 않는다 — 망가뜨리는 것보다 거절하는 편이 낫다. */
const SCAN_LIMIT = 200;
export function sheetBounds(ws){
  for(let y = FIRST_ROW + 1; y <= SCAN_LIMIT; y++){
    const v = ws.getCell(`B${y}`).value;
    if(String(v == null ? '' : (v.richText ? v.richText.map(t => t.text).join('') : v)).trim().toUpperCase() === 'TOTAL'){
      /* 납입 안내는 TOTAL 두 줄 아래다(가운데 한 줄은 비어 있다) — 원본 양식과
         늘린 양식이 같고, 그 사이 간격이 양식의 생김새다. */
      return { first: FIRST_ROW, last: y - 1, totalRow: y, dueRow: y + 2, capacity: y - FIRST_ROW };
    }
  }
  return null;
}

/* 항목 칸 안에 완전히 들어가는 병합을 푼다. 구분 칸을 그룹 단위로 다시 묶기
   전에 자리를 비워야 한다 — 병합이 남은 채로 아랫줄에 적으면 대표 칸이 덮여
   앞 그룹의 이름이 사라진다. */
function unmergeGroupCol(ws, b){
  Object.values(ws._merges)
    .map(m => ({ range: m.range, d: m.model }))
    .filter(x => x.d.left === 2 && x.d.top >= b.first && x.d.bottom <= b.last)
    .forEach(x => { try { ws.unMergeCells(x.range); } catch(e){} });
}

/* 양식이 맞는지 본다. 아니면 이유를 들고 거절한다 — 엉뚱한 파일을 채우면
   조용히 망가진 인보이스가 나온다. */
export function checkTemplate(wb){
  const bad = [];
  SHEETS.forEach(spec => {
    const ws = wb.getWorksheet(spec.name);
    if(!ws) { bad.push(`'${spec.name}' 시트가 없어요`); return; }
    if(!sheetBounds(ws)) bad.push(`'${spec.name}' 시트에서 TOTAL 줄을 찾지 못했어요`);
  });
  return bad;
}

export function fillInvoiceWorkbook(wb, doc){
  const bad = checkTemplate(wb);
  if(bad.length) throw new Error(`인보이스 양식이 아닌 것 같아요 — ${bad.join(' · ')}`);

  /* 통화 표기는 양식에서 읽어 온다. 국문 시트에는 원화 기호와 원화 표시형식이,
     영문 시트에는 달러 쪽이 이미 들어 있다 — 코드에 다시 적으면 두 곳이 갈린다. */
  const src = wb.getWorksheet(doc.cur === 'USD' ? '영문' : '국문');
  const sym = src.getCell(`I${FIRST_ROW}`).value;
  const fmt = src.getCell('C6').numFmt;
  /* 두 시트의 항목 칸 길이가 다를 수 있다(원본 양식은 국문 9줄·영문 11줄) —
     짧은 쪽이 이 양식으로 담을 수 있는 줄 수다. */
  const capacity = Math.min(...SHEETS.map(sp => sheetBounds(wb.getWorksheet(sp.name)).capacity));
  const used = Math.min(doc.rows.length, capacity);
  const over = Math.max(doc.rows.length - capacity, 0);

  SHEETS.forEach(spec => {
    const ws = wb.getWorksheet(spec.name);
    const b = sheetBounds(ws);
    const { last: LAST_ROW, totalRow, dueRow } = b;
    const nc = nameLayout(ws);
    unmergeGroupCol(ws, b);

    ws.getCell('C3').value = doc.no;
    ws.getCell('C4').value = doc.date;
    ws.getCell('C5').value = doc.to[spec.lang];
    ws.getCell('L3').value = doc.booth;

    for(let y = FIRST_ROW; y <= LAST_ROW; y++){
      const r = doc.rows[y - FIRST_ROW];
      ws.getCell(`B${y}`).value = null;
      /* 코드 칸이 따로 있는 양식이면 코드는 코드 칸에, 품명에서는 뗀다 */
      const nm = r ? itemName(r.item, spec.lang) : null;
      const code = r && nc.code ? itemCode(r.item) : '';
      ws.getCell(`${nc.name}${y}`).value = code ? nm.replace(CODE_RE, '') : nm;
      if(nc.code) ws.getCell(`${nc.code}${y}`).value = code || null;
      ws.getCell(`F${y}`).value = r ? r.qty : null;
      ws.getCell(`H${y}`).value = r ? r.up : null;
      /* 단위와 통화 기호는 빈 줄에도 남긴다 — 양식이 원래 깔아 두는 값이고,
         줄을 늘려 쓸 때 그대로 쓰인다. */
      ws.getCell(`G${y}`).value = spec.unit;
      ws.getCell(`I${y}`).value = sym;
      ws.getCell(`J${y}`).value = r && r.up == null ? r.amount : { formula: `H${y}*F${y}` };
      ws.getRow(y).hidden = !r;
    }

    /* 그룹 이름은 그 그룹의 첫 줄에 적고, 두 줄 이상이면 병합해 한 칸으로 본다.

       정렬은 9행에서 가져온다. 양식의 구분 칸은 원래 그룹 단위로 병합돼 있어서
       둘째 줄부터는 서식이 비어 있다(병합에 먹힌 칸이다). 그 자리에 그대로 적으면
       «Office Furniture Rental»이 줄바꿈 없이 한 줄로 잘린다. */
    const bStyle = ws.getCell(`B${FIRST_ROW}`).alignment;
    let y = FIRST_ROW;
    doc.groups.forEach(g => {
      if(y > LAST_ROW) return;
      ws.getCell(`B${y}`).value = g[spec.lang];
      if(bStyle) ws.getCell(`B${y}`).alignment = bStyle;
      const bottom = Math.min(y + g.count - 1, LAST_ROW);
      if(bottom > y) { try { ws.mergeCells(`B${y}:B${bottom}`); } catch(e){} }
      y += g.count;
    });

    ws.getCell(`I${totalRow}`).value = sym;
    ws.getCell(`I${dueRow}`).value = sym;
    ws.getCell(`L${dueRow}`).value = doc.due ? spec.duePrefix + doc.due : null;
    ws.getCell('C6').numFmt = fmt;
  });
  return { used, capacity, over };
}

/* ══════════════════════════════════════════
   내보내기
══════════════════════════════════════════ */

/* ExcelJS는 누를 때 한 번만 받아 온다(exh-export.js와 같은 방식) */
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

/* 양식 파일은 저장소에 넣지 않는다 — 이 저장소는 공개이고, 양식에는 직인
   이미지와 계좌번호가 박혀 있다. 그래서 다른 실데이터와 같이 Data/ 아래에 두고
   (Data/는 .gitignore에 있다) 실행할 때 읽어 온다.

   그 자리에 없으면 한 번만 파일을 고르게 한다. 없다고 기능이 통째로 막히면
   "왜 안 되나"를 찾는 데 시간이 더 든다. 고른 파일은 이 세션 동안 다시 쓴다 —
   59장을 뽑는 동안 같은 파일을 59번 받아올 이유가 없다(ExcelJS는 읽을 때
   버퍼를 소비하지 않는다). */
let templateBuf = null;
async function loadTemplate(){
  if(templateBuf) return templateBuf;
  try {
    const res = await fetch(TEMPLATE_URL, { cache: 'no-cache' });
    if(res.ok){ templateBuf = await res.arrayBuffer(); return templateBuf; }
  } catch(e){ /* 파일이 없거나 서버가 막았을 때 — 아래에서 직접 고르게 한다 */ }
  templateBuf = await pickTemplate();
  return templateBuf;
}

function pickTemplate(){
  return new Promise((resolve, reject) => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = '.xlsx';
    el.style.display = 'none';
    /* 취소를 눌렀는지는 change가 오지 않는 것으로만 알 수 있다 — 창이 다시
       뜨면(focus) 파일이 없는지 확인해 거절한다. */
    el.onchange = () => {
      const f = el.files && el.files[0];
      el.remove();
      if(!f) return reject(new Error('양식 파일을 고르지 않았어요'));
      f.arrayBuffer().then(resolve, reject);
    };
    window.addEventListener('focus', () => setTimeout(() => {
      if(document.body.contains(el) && !(el.files && el.files.length)){
        el.remove();
        reject(new Error(`양식 파일이 없어요 — ${TEMPLATE_URL}에 두거나 파일을 고르세요`));
      }
    }, 500), { once: true });
    document.body.appendChild(el);
    el.click();
  });
}

/* 보내기 전에 봐야 하는 어긋남 — 파일은 나가지만 조용히 두면 안 되는 값들.
   통화 경고는 '발행'에서는 빼 준다: 그쪽은 통화마다 한 장씩 이미 내고 있어서
   "빠졌어요"가 사실이 아니다. */
function invoiceWarnings(doc, fit, { allCurrencies = false } = {}){
  const w = [];
  if(fit && fit.over)
    w.push(`항목이 ${doc.rows.length}건인데 이 양식은 ${fit.capacity}줄까지예요 — 뒤 ${fit.over}건이 빠졌습니다`);
  if(doc.otherCur && !allCurrencies)
    w.push(`${doc.cur}가 아닌 항목 ${doc.otherCur}건은 빠졌어요 — 통화가 다르면 따로 발행하세요`);
  if(doc.invAmount != null && Math.round(doc.invAmount) !== Math.round(doc.itemSum))
    w.push(`인보이스에 적은 금액(${doc.invAmount.toLocaleString('ko-KR')})과 항목 합계(${doc.itemSum.toLocaleString('ko-KR')})가 달라요 — 양식에는 항목 합계가 들어갑니다`);
  return w;
}

/* 파일 이름·폴더 이름 — 지금 손으로 쓰는 규칙을 따른다.
   폴더: "42-43. Parexel"  파일: "2026 KIC Exhibition Invoice_Parexel_EX-42-43-02.xlsx" */
const BAD_CHARS = /[\\/:*?"<>|]/g;
const evLabelNow = () => {
  const ev = EVENT_LIST.find(e => e.key === exhEvent);
  return (ev && (ev.short || ev.key)) || exhEvent || '';
};
function fileNames(doc){
  const name = (doc.to.en || doc.to.ko).replace(BAD_CHARS, ' ').trim();
  const ev = evLabelNow();
  return {
    file: `${ev ? ev + ' ' : ''}Exhibition Invoice_${name}_${doc.no}.xlsx`,
    dir: (doc.booth ? `${doc.booth}. ${name}` : name).replace(BAD_CHARS, ' ').trim(),
    dirPrefix: doc.booth ? `${doc.booth}.` : '',
    company: name,
  };
}

/* 채운 워크북을 파일 하나로 — 만드는 일과 어디에 두는 일을 갈라 둔다 */
async function buildInvoiceFile(doc){
  const [ExcelJS, buf] = await Promise.all([loadExcelJs(), loadTemplate()]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const fit = fillInvoiceWorkbook(wb, doc);
  const out = await wb.xlsx.writeBuffer();
  return { fit, blob: new Blob([out],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) };
}

function download(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ══════════════════════════════════════════
   저장 폴더 — 행사마다 하나
══════════════════════════════════════════ */

/* 행사 폴더 아래의 Invoice 폴더를 행사별로 기억한다. 행사가 바뀌면 경로도
   바뀌므로 한 폴더를 통째로 쓰지 않는다. */
const folderKey = (evKey) => `invoice:${evKey || ''}`;

/* 화면은 그리는 중에 기다릴 수 없어서(그리기는 동기) 폴더 이름을 미리 읽어 둔다.
   지정·해제한 뒤에 다시 읽고 화면을 다시 그린다. */
const folderNames = {};
export const invoiceFolderName = (evKey) => folderNames[folderKey(evKey)] || null;
export const folderSupported = supported;

async function refreshFolderName(evKey){
  folderNames[folderKey(evKey)] = await folderLabel(folderKey(evKey));
  return folderNames[folderKey(evKey)];
}
/* 앱이 뜨면 지금 보고 있는 행사의 폴더 이름을 한 번 읽어 둔다. 행사를 바꿀 때는
   전시 탭이 다시 그려지므로 그때 없으면 다음 그리기에서 채워진다. */
export async function initInvoiceFolder(evKey){
  await refreshFolderName(evKey);
  window.renderExhDr?.();
}

export async function pickInvoiceFolder(evKey){
  const key = folderKey(evKey || exhEvent);
  try {
    const h = await pickFolder(key);
    if(!h) return;                                  // 취소
    await refreshFolderName(evKey || exhEvent);
    showSaveErrorToast(`저장 폴더를 '${h.name}'로 정했어요 — 이제 발행하면 이 폴더에 바로 저장됩니다`);
  } catch(err){
    showSaveErrorToast('폴더를 지정하지 못했어요: ' + (err && err.message ? err.message : err));
  }
  window.renderExhDr?.();
}

export async function forgetInvoiceFolder(evKey){
  const key = folderKey(evKey || exhEvent);
  await delHandle(key);
  await refreshFolderName(evKey || exhEvent);
  showSaveErrorToast('저장 폴더를 잊었어요 — 이제 다운로드로 받습니다');
  window.renderExhDr?.();
}

/* 폴더에 저장하고, 폴더가 없거나 권한을 못 받으면 다운로드로 되돌아간다.
   되돌아간 것을 조용히 두면 "폴더에 저장됐다"고 믿은 채 파일을 잃는다. */
async function putInvoiceFile(doc, blob){
  const nm = fileNames(doc);
  if(!supported()) { download(blob, nm.file); return { how: 'download', why: 'unsupported' }; }
  const dir = await readyFolder(folderKey(exhEvent));
  if(!dir) { download(blob, nm.file); return { how: 'download', why: 'no-folder' }; }
  try {
    const sub = await subFolder(dir, nm.dir, nm.dirPrefix);
    await writeFile(sub, nm.file, blob);
    return { how: 'folder', at: `${dir.name}/${sub.name}` };
  } catch(err){
    download(blob, nm.file);
    return { how: 'download', why: err && err.message ? err.message : String(err) };
  }
}

/* 저장 결과와 어긋남을 한 줄로 — 여러 장을 낼 때는 부르는 쪽이 모아서 한 번에
   띄운다(알림 칸이 하나뿐이라 연달아 띄우면 앞의 것이 지워진다). */
function reportSave(doc, res, fit, opts){
  const nm = fileNames(doc);
  const where = res.how === 'folder'
    ? `${res.at}에 저장`
    : res.why === 'no-folder'
      ? '저장 폴더가 없어 다운로드로 받았어요 — 폴더를 지정하면 바로 저장됩니다'
      : res.why === 'unsupported'
        ? '이 브라우저는 폴더 저장을 지원하지 않아 다운로드로 받았어요 (Chrome·Edge 데스크톱)'
        : `폴더에 쓰지 못해 다운로드로 받았어요 (${res.why})`;
  trackAction('add', '인보이스 양식', nm.company,
    `${doc.no} · ${doc.rows.length}건 · ${res.how === 'folder' ? res.at : '다운로드'}`);
  return [`${doc.no} ${where}`, ...invoiceWarnings(doc, fit, opts)].join(' · ');
}

/* 버튼을 잠근다 — 만드는 동안 두 번 눌리면 파일이 두 개 떨어진다.

   버튼만 잠그는 것으로는 모자란다: 발행은 인보이스 줄을 만들고, 그러면 화면이
   다시 그려져 잠가 둔 버튼이 새 버튼으로 갈린다. 두 번 눌리면 번호가 다른
   인보이스가 두 장 생기고, 그건 기업에 나간 뒤에야 보인다. 그래서 자물쇠를
   버튼이 아니라 여기에 둔다. */
const busy = new Set();
async function withButton(id, fn){
  if(busy.has(id)) return showSaveErrorToast('아직 만드는 중이에요 — 조금만 기다려주세요');
  busy.add(id);
  const btn = document.getElementById(id);
  const label = btn ? btn.innerHTML : '';
  if(btn){ btn.disabled = true; btn.textContent = '만드는 중…'; }
  try { return await fn(); }
  finally {
    busy.delete(id);
    const now = document.getElementById(id);   // 다시 그려져 갈렸을 수 있다
    if(now){ now.disabled = false; if(now === btn) now.innerHTML = label; }
  }
}

/* ══════════════════════════════════════════
   1) 이미 있는 인보이스 줄의 양식을 다시 뽑는다
══════════════════════════════════════════ */
export async function exportExhInvoice(invId){
  const inv = EXH_INVOICES.find(i => i.id === invId);
  if(!inv) return showSaveErrorToast('인보이스를 찾지 못했어요');
  const doc = invoiceDoc(inv);
  if(!doc) return showSaveErrorToast('참가기업을 찾지 못했어요');
  if(!doc.rows.length) return showSaveErrorToast(
    `정산에 ${doc.cur} 금액 항목이 없어요 — 항목을 먼저 넣으면 인보이스 양식에 담깁니다`);

  await withButton(`inv-xls-${invId}`, async () => {
    try {
      const { fit, blob } = await buildInvoiceFile(doc);
      showSaveErrorToast(reportSave(doc, await putInvoiceFile(doc, blob), fit));
    } catch(err){
      console.error('[exh-invoice] 내보내기 실패', err);
      showSaveErrorToast('내보내기 실패: ' + (err && err.message ? err.message : err));
    }
  });
}

/* ══════════════════════════════════════════
   2) 신청 내역만 있는 기업에서 한 번에 발행한다

   지금까지는 정산 탭에서 인보이스 줄을 만들고(금액을 손으로 넣고), 그 줄에서
   양식을 뽑고, 떨어진 파일을 폴더로 옮기는 세 걸음이었다. 신청 내역이 다 적혀
   있으면 그 세 걸음의 답은 이미 정해져 있다 — 한 번에 한다.

   통화가 섞인 기업은 통화마다 한 장이다. 어느 쪽을 낼지 사람이 고르는 게 아니라
   둘 다 내야 하는 것이라, 통화별로 인보이스 줄과 파일을 각각 만든다.
══════════════════════════════════════════ */
export async function issueExhInvoice(exhId){
  const x = getExhibitorById(exhId);
  if(!x) return showSaveErrorToast('참가기업을 찾지 못했어요');

  const billable = liveItemsFor(exhId).filter(isBillable);
  if(!billable.length) return showSaveErrorToast(
    '청구할 금액 항목이 없어요 — 신청 내역을 금액 항목으로 옮긴 뒤 발행하세요');

  /* 통화 순서는 항목에 나온 순서대로 — 주 통화가 먼저 나오는 게 자연스럽다 */
  const curs = [...new Set(billable.map(i => i.currency || 'KRW'))];

  await withButton(`inv-issue-${exhId}`, async () => {
    const msgs = [];
    for(const cur of curs){
      try {
        const sum = billable.filter(i => (i.currency || 'KRW') === cur)
          .reduce((s, i) => s + num(i.amount), 0);
        /* 제목은 무엇이 담겼는지 — 정산 탭 목록에서 이 줄이 무슨 청구인지 알아야 한다 */
        const cats = GROUPS.filter(g => billable.some(i =>
          (i.currency || 'KRW') === cur && (CATS.includes(i.category) ? i.category : 'etc') === g.cat));
        const inv = await createInvoiceRow(exhId, {
          title: cats.map(g => g.ko).join('+') || '인보이스',
          amount: String(sum),
          currency: cur,
        });
        if(!inv) return;                    // 저장 실패 — createInvoiceRow가 이미 알렸다
        const doc = invoiceDoc(inv);
        const { fit, blob } = await buildInvoiceFile(doc);
        msgs.push(reportSave(doc, await putInvoiceFile(doc, blob), fit, { allCurrencies: true }));
      } catch(err){
        console.error('[exh-invoice] 발행 실패', err);
        msgs.push(`${cur} 발행 실패: ` + (err && err.message ? err.message : err));
      }
    }
    if(msgs.length) showSaveErrorToast(
      (curs.length > 1 ? `통화가 갈려 ${curs.length}장으로 발행했어요 · ` : '') + msgs.join(' / '));
  });
}

window.exportExhInvoice = exportExhInvoice;
window.issueExhInvoice = issueExhInvoice;
window.pickInvoiceFolder = pickInvoiceFolder;
window.forgetInvoiceFolder = forgetInvoiceFolder;
/* 화면(exh-drawer)이 그리는 중에 읽는다 — 그쪽이 이 파일을 import하면 순환
   참조가 되므로 window 경유로만 준다. */
window.invoiceFolderName = invoiceFolderName;
window.folderSupported = folderSupported;
window.initInvoiceFolder = initInvoiceFolder;

/* 이미 고른 행사가 있는 채로 새로고침한 경우 — 폴더 이름을 한 번 읽어 둔다.
   권한은 묻지 않는다(사람이 누르지 않았는데 권한 창이 뜨면 안 된다). */
if(exhEvent) initInvoiceFolder(exhEvent);
