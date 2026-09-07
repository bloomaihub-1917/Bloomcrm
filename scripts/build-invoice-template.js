/* 인보이스 양식 2단계 — 항목 칸을 24줄로 늘린다.

   받은 양식의 항목 칸은 국문 9줄 · 영문 11줄이다. 손으로 쓸 때는 줄이 남으면
   지우고 모자라면 끼워 넣었지만, 실행 시점(exh-invoice.js)에서 행을 넣거나 빼는
   일은 못 한다 — ExcelJS의 행 삭제(spliceRows)는 병합·그림·수식을 따라 옮기지
   못해서 양식 아래쪽(TOTAL·계좌 안내·직인)이 통째로 어긋난다. 행을 늘리는
   duplicateRow는 되지만, 늘린 뒤의 좌표와 메모리 안의 좌표가 갈려서 병합을
   다시 그리는 일이 위태롭다.

   그래서 늘리는 일은 여기서 한 번만 하고, 실행 시점에는 남는 줄을 숨기기만 한다.
   숨긴 줄은 화면에도 인쇄에도 나오지 않으니 3줄짜리 인보이스는 지금 손으로
   만드는 것과 같은 모습이 된다.

     node scripts/build-invoice-template.js <1단계결과.xlsx> Data/인보이스_양식.xlsx

   ROWS를 더 늘려야 하면(항목이 24개를 넘는 기업이 생기면) 이 값만 고쳐 다시
   돌린 뒤 exh-invoice.js의 LAST_ROW도 같이 고친다. */
const ExcelJS = require('exceljs');

const ROWS = 24;
const SHEETS = {
  /* first~last = 받은 양식의 항목 칸, spare = 복제할 본이 되는 가운데 줄,
     src = 24줄의 서식을 맞출 본 줄(첫 줄 — 가운데 줄은 구분 칸이 병합에 먹혀
     가운데 정렬·줄바꿈 서식이 비어 있다), name = 품명 칸의 병합 범위.
     영문 양식은 원래 코드(C)와 품명(D:E)이 갈려 있었지만, 실제로 발행해 온
     인보이스는 C8을 'Item'으로 바꿔 C:E 한 칸에 품명을 적어 왔다 — 그쪽을 따른다
     (품명에 코드가 이미 붙어 있어 칸을 나누면 좁은 칸이 더 좁아진다). */
  '국문': { first: 9, last: 17, spare: 13, name: ['C', 'E'], src: 9, print: 'B1:L45' },
  '영문': { first: 9, last: 19, spare: 15, name: ['C', 'E'], src: 9, print: 'B1:L46',
            head: { C8: 'Item', D8: null }, headMerge: 'C8:E8' },
};

async function main(src, dst){
  /* ── 1단계: 행을 늘리고 그림 기준행을 같이 내린다 ──
     로고와 직인은 행에 매달려 있다(twoCellAnchor). 행만 늘리면 그림은 제자리에
     남아 표 위에 겹친다. */
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(src);
  for(const [nm, s] of Object.entries(SHEETS)){
    const ws = wb.getWorksheet(nm);
    const grow = ROWS - (s.last - s.first + 1);
    ws.duplicateRow(s.spare, grow, true);
    ws.getImages().forEach(im => {
      if(im.range.tl.nativeRow >= s.spare) im.range.tl.nativeRow += grow;
      if(im.range.br.nativeRow >= s.spare) im.range.br.nativeRow += grow;
    });
    /* 복제된 줄의 금액 칸은 공유 수식(shared formula)의 사본이 되어 저장이 막힌다
       ("Shared Formula master must exist above and or left of clone") — 홑수식으로 바꾼다. */
    for(let y = s.first; y < s.first + ROWS; y++){
      ws.getCell(`K${y}`).value = null;
      ws.getCell(`J${y}`).value = { formula: `H${y}*F${y}` };
    }
  }
  const mid = await wb.xlsx.writeBuffer();

  /* ── 2단계: 다시 읽어(좌표가 정리된 상태에서) 병합과 서식을 다시 그린다 ──
     duplicateRow는 서식만 복제하고 병합은 옮겨 주지 않는다. 늘린 줄에는 품명·금액
     병합이 없고, 원래 있던 그룹 병합(B9:B10 등)은 엉뚱한 범위로 남는다. */
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(mid);
  for(const [nm, s] of Object.entries(SHEETS)){
    const ws = wb2.getWorksheet(nm);
    const first = s.first, last = s.first + ROWS - 1;
    Object.values(ws._merges).map(m => ({ range: m.range, d: m.model }))
      .filter(x => x.d.top >= first && x.d.bottom <= last)
      .forEach(x => { try { ws.unMergeCells(x.range); } catch(e){} });

    /* 테두리는 F열(사방 얇은 선)을 본으로 통일한다. 양식의 항목 칸은 그룹 병합
       때문에 줄마다 테두리가 달랐고, 병합에 먹힌 칸은 테두리가 아예 없어서
       병합을 풀면 그 빈 자리가 그대로 드러난다. 병합한 칸의 안쪽 선은 엑셀이
       그리지 않으니 사방을 다 둘러도 격자는 깔끔하게 남는다.
       (ExcelJS는 병합할 때 딸린 칸의 서식을 대표 칸 것으로 덮으므로, 열마다 다른
        테두리를 두면 품명 칸의 오른쪽 선이 사라진다.) */
    const GRID = ws.getCell(`F${s.src}`).border;
    'BCDEFGHIJKL'.split('').forEach(col => {
      const base = ws.getCell(`${col}${s.src}`).style;
      for(let y = first; y <= last; y++){
        const c = ws.getCell(`${col}${y}`);
        c.style = base;
        c.border = GRID;
      }
    });
    const [n0, n1] = s.name;
    for(let y = first; y <= last; y++){
      ws.getCell(`K${y}`).value = null;
      ws.getCell(`J${y}`).value = { formula: `H${y}*F${y}` };
      ws.mergeCells(`${n0}${y}:${n1}${y}`);
      ws.mergeCells(`J${y}:K${y}`);
    }
    ws.getCell(`J${last + 1}`).value = { formula: `SUM(J${first}:K${last})` };
    ws.getCell(`J${last + 3}`).value = { formula: `J${last + 1}` };
    ws.getCell('C6').value = { formula: `J${last + 1}` };
    if(s.head) Object.entries(s.head).forEach(([a, v]) => { ws.getCell(a).value = v; });
    /* 품명 머리글도 본문과 같이 C:E로 묶는다 — 코드 칸을 없앤 자리에 세로선이
       남으면 표가 한 칸 더 있는 것처럼 보인다. */
    if(s.headMerge){ try { ws.unMergeCells('D8:E8'); } catch(e){} ws.mergeCells(s.headMerge); }
    /* 납입기한은 좁은 비고 칸(L)에 들어간다. 국문은 "납입기한: 2026-08-21"이
       한 줄에 안 들어가 잘렸다 — 두 줄로 접는다(L은 두 행이 병합돼 있다). */
    const due = ws.getCell(`L${last + 3}`);
    due.alignment = { ...(due.alignment || {}), wrapText: true, vertical: 'middle' };
    /* 인쇄 영역은 받은 양식이 서명 줄까지로 잡아 두었다. 행을 늘린 만큼 넓히지
       않으면 TOTAL·계좌 안내·직인이 통째로 인쇄에서 빠진다(실제로 그랬다). */
    ws.pageSetup.printArea = s.print;
    /* 한 장에 맞춘다. 항목이 24줄까지 늘 수 있어 고정 배율(83%/76%)로 두면 긴
       인보이스가 두 장으로 넘어간다 — 넘칠 때만 엑셀이 줄여 준다. */
    ws.pageSetup.fitToPage = true;
    ws.pageSetup.fitToWidth = 1;
    ws.pageSetup.fitToHeight = 1;
  }
  await wb2.xlsx.writeFile(dst);
  console.log(`wrote ${dst} — 항목 칸 ${SHEETS['국문'].first}~${SHEETS['국문'].first + ROWS - 1}행`);
}

const [src, dst] = process.argv.slice(2);
if(!src || !dst){
  console.error('usage: node scripts/build-invoice-template.js <1단계결과.xlsx> <출력.xlsx>');
  process.exit(1);
}
main(src, dst).catch(e => { console.error(e); process.exit(1); });
