/* 컨퍼런스 업로드 양식(.xlsx)을 만든다.

   앱의 «양식 받기» 버튼과 같은 정의(js/conf-import-spec.js)를 읽는다 —
   두 군데에 적어 두면 열을 하나 더하는 순간 어긋나고, 그때는 «양식대로
   넣었는데 안 들어간다»가 된다.

   실행: node db/make-conf-template.js [내보낼 경로]
*/
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

/* 브라우저용 ES 모듈을 노드에서 읽는다 — 정의 파일 하나를 양쪽이 쓰려고
   여기서만 export 구문을 걷어낸다. 정의는 순수한 값뿐이라 이걸로 충분하다. */
function loadSpec() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'conf-import-spec.js'), 'utf8');
  const body = src.replace(/^export /gm, '');
  const fn = new Function(`${body}\nreturn { IMPORT_SHEETS, IMPORT_GUIDE };`);
  return fn();
}

const { IMPORT_SHEETS, IMPORT_GUIDE } = loadSpec();
const out = process.argv[2] || path.join(__dirname, '..', '..', '컨퍼런스_업로드_양식.xlsx');

const wb = XLSX.utils.book_new();

/* 안내 먼저 — 파일을 열었을 때 처음 보이는 장이 설명이어야 한다 */
const guide = XLSX.utils.aoa_to_sheet(IMPORT_GUIDE);
guide['!cols'] = [{ wch: 14 }, { wch: 92 }];
XLSX.utils.book_append_sheet(wb, guide, '안내');

IMPORT_SHEETS.forEach((sh) => {
  /* 1행 머리글, 2행 설명, 3행부터 예시.
     설명을 시트 안에 두면 파일만 돌아다녀도 채우는 법이 함께 간다.
     불러올 때는 2행을 «설명»으로 알아보고 건너뛴다. */
  const rows = [
    sh.cols.map((c) => c.label),
    sh.cols.map((c) => (c.hint ? `↳ ${c.hint}` : '')),
    ...sh.sample,
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = sh.cols.map((c) => ({ wch: Math.max(12, Math.min(34, c.label.length * 2 + 8)) }));
  ws['!freeze'] = { xSplit: 0, ySplit: 2 };
  XLSX.utils.book_append_sheet(wb, ws, sh.name);
});

XLSX.writeFile(wb, out);
console.log(`✓ ${out}`);
console.log(`  시트: 안내 · ${IMPORT_SHEETS.map((s) => s.name).join(' · ')}`);
