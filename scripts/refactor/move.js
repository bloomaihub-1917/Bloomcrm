/* 리팩토링 도구 — 한 파일의 줄 범위를 새 파일로 옮기고 import를 다시 잇는다.

   node scripts/refactor/move.js <원래 파일> <시작줄> <끝줄> <새 파일> "<새 파일 머리 import들>" ["<머리 주석>"]
   예) node scripts/refactor/move.js js/modules/settings-tab.js 96 194 js/domain/sectors.js \
         "import { COMPANY_SECTORS } from '../state.js';" "섹터 조회"

   하는 일
   1) 범위를 잘라 새 파일에 넣는다(머리 import + 주석을 붙여).
   2) 원래 파일 그 자리에: 옮긴 export 이름을 import하고 그대로 다시 내보낸다
      (원래 파일 안에서도 쓰고, 아직 옛 경로로 가져가는 파일도 깨지지 않게).
   3) 다른 파일이 원래 파일에서 가져가던 이름 중 옮긴 것은 새 파일에서 가져가게 바꾼다.
   줄 끝(CRLF/LF)은 원래 파일 것을 따른다. */
const fs = require('fs');
const path = require('path');

const [src, from, to, dest, headImports = '', title = ''] = process.argv.slice(2);
if (!dest) { console.error('쓰는 법: move.js <파일> <시작> <끝> <새 파일> "<import>" ["<제목>"]'); process.exit(1); }
const raw = fs.readFileSync(src, 'utf8');
const EOL = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);
const chunk = lines.slice(from - 1, to);
const names = [];
for (const l of chunk) {
  const m = l.match(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/);
  if (m) names.push(m[1]);
}
if (!names.length) { console.error('범위에 export가 없다'); process.exit(1); }

const relImport = (fromFile, toFile) => {
  let r = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, '/');
  return r.startsWith('.') ? r : './' + r;
};

const head = [
  '/* ' + '═'.repeat(62),
  `   ${path.relative('js', dest).replace(/\\/g, '/')} — ${title || '옮겨 온 함수들'}`,
  `   (${path.relative('js', src).replace(/\\/g, '/')}에서 옮겼다 — 탭 화면 파일에 기대지 않게)`,
  '═'.repeat(63) + ' */',
  '',
  ...headImports.split(/\\n|\n/).filter(Boolean),
  '',
];
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, [...head, ...chunk, ''].join(EOL));

const p = relImport(src, dest);
const stub = [
  `/* ${names.length}개 함수를 ${p}로 옮겼다 — 이 파일에서도 쓰고, 옛 경로로 가져가는 곳도 있어 다시 내보낸다 */`,
  `import { ${names.join(', ')} } from '${p}';`,
  `export { ${names.join(', ')} } from '${p}';`,
];
lines.splice(from - 1, to - from + 1, ...stub);
fs.writeFileSync(src, lines.join(EOL));

/* 다른 파일들의 import를 새 자리로 */
const all = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else if (e.name.endsWith('.js')) all.push(q); } })('js');
const moved = new Set(names);
let touched = 0;
for (const f of all) {
  if (path.resolve(f) === path.resolve(src) || path.resolve(f) === path.resolve(dest)) continue;
  let s = fs.readFileSync(f, 'utf8');
  const re = /import\s*\{([^}]+)\}\s*from\s*'(\.{1,2}\/[^']+)';/g;
  let changedFile = false;
  s = s.replace(re, (all0, list, spec) => {
    if (path.resolve(path.dirname(f), spec) !== path.resolve(src)) return all0;
    const items = list.split(',').map((x) => x.trim()).filter(Boolean);
    const mv = items.filter((x) => moved.has(x.split(/\s+as\s+/)[0]));
    if (!mv.length) return all0;
    const rest = items.filter((x) => !mv.includes(x));
    changedFile = true;
    const nl = all0.includes('\r\n') || s.includes('\r\n') ? '\r\n' : '\n';
    let out = `import { ${mv.join(', ')} } from '${relImport(f, dest)}';`;
    if (rest.length) out = `import { ${rest.join(', ')} } from '${spec}';` + nl + out;
    return out;
  });
  if (changedFile) { fs.writeFileSync(f, s); touched++; }
}
console.log(`옮김: ${names.join(', ')}`);
console.log(`import를 고친 파일 ${touched}개`);
