/* 리팩토링 도구 — 큰 탭 파일에서 «파일의 다른 구획이 부르지 않는» 구획을 한 방향으로 떼어 낸다.

   node scripts/refactor/split-leaf.js <탭 파일> <시작줄> <끝줄> <새 파일> "<머리 주석 제목>"

   (sections.js로 «뗄 수 있음»을 먼저 확인한다. 화면의 onclick(window)으로만 불리는 구획이어야 한다.)

   하는 일
   1) 범위가 빌려 쓰는 이름을 찾아 새 파일 머리 import를 만든다 — import에서 온 것은 그 경로를 새 자리에
      맞춰, 탭 파일의 최상위 이름은 탭 파일에서. 탭 파일에서 비공개였던 이름은 export를 붙인다.
   2) 범위를 새 파일로 옮긴다. 탭 파일은 새 파일을 import하지 않는다(그래야 고리가 안 생긴다).
   3) 옮긴 함수를 거는 window 줄(window.X = X; 와 window.Y = X; 같은 별칭)을 새 파일 끝으로 옮긴다.
   4) app.js가 탭 파일 바로 뒤에 새 파일을 읽게 한다 — 새 파일이 스스로 window에 건다.
   다른 파일이 탭 파일에서 옮긴 이름을 import하고 있으면 새 파일을 보게 돌린다. */
const fs = require('fs');
const path = require('path');
const [src, fromS, toS, dest, title = '떼어 낸 구획'] = process.argv.slice(2);
const from = +fromS, to = +toS;
if (!dest) { console.error('쓰는 법: split-leaf.js <탭 파일> <시작> <끝> <새 파일> "<제목>"'); process.exit(1); }

const raw = fs.readFileSync(src, 'utf8');
const NL = raw.includes('\r\n') ? '\r\n' : '\n';
let lines = raw.split(/\r?\n/);
const inRange = (i) => i >= from - 1 && i <= to - 1;
const rel = (a, b) => { let r = path.relative(path.dirname(a), b).replace(/\\/g, '/'); return r.startsWith('.') ? r : './' + r; };

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/* 탭 파일의 import 이름 → 원래 경로 */
const importOf = new Map();
for (const m of raw.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
  m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
    const [orig, local] = s.split(/\s+as\s+/).map((x) => x.trim());
    importOf.set(local || orig, { orig, spec: m[2] });
  });
}
/* 탭 파일의 최상위 이름(범위 밖) → 줄 번호 */
const decl = /^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const outsideTop = new Map();
const insideTop = new Set();
lines.forEach((l, i) => {
  const m = l.match(decl);
  if (!m) return;
  if (inRange(i)) insideTop.add(m[1]); else outsideTop.set(m[1], i);
});
const lets = new Set(lines.filter((l, i) => !inRange(i) && /^(?:export\s+)?let\b/.test(l)).map((l) => l.match(decl)?.[1]).filter(Boolean));

const body = strip(lines.slice(from - 1, to).join('\n'));
const used = new Set([...body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)].map((m) => m[2]));

/* 범위가 탭 파일의 let 상태를 고치면 떼면 안 된다 */
const writes = [...body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*(?:=(?![=>])|\+\+|--|[-+*/%|&]=)/g)].map((m) => m[2]).filter((n) => lets.has(n) && !insideTop.has(n));
if (writes.length) { console.error('✗ 이 범위가 탭 파일의 상태를 고친다: ' + [...new Set(writes)].join(', ') + ' — 상태와 함께 옮기거나 set 함수를 두어야 한다'); process.exit(1); }

/* 머리 import 만들기 */
const bySpec = new Map();
const add = (spec, name) => { if (!bySpec.has(spec)) bySpec.set(spec, new Set()); bySpec.get(spec).add(name); };
const fromTab = [];
for (const n of used) {
  if (insideTop.has(n)) continue;
  if (importOf.has(n)) {
    const { orig, spec } = importOf.get(n);
    const target = path.resolve(path.dirname(src), spec);
    add(rel(dest, target), orig === n ? n : `${orig} as ${n}`);
  } else if (outsideTop.has(n)) fromTab.push(n);
}
/* 탭 파일 쪽 비공개 이름에 export 붙이기 */
for (const n of fromTab) {
  const i = outsideTop.get(n);
  if (!/^export\b/.test(lines[i])) lines[i] = 'export ' + lines[i];
}
const head = [
  '/* ' + '═'.repeat(62),
  `   ${path.relative('js', dest).replace(/\\/g, '/')} — ${title}`,
  `   (${path.relative('js', src).replace(/\\/g, '/')}에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을`,
  '    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.',
  '    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)',
  '═'.repeat(63) + ' */',
  '',
  ...[...bySpec].sort().map(([spec, names]) => `import { ${[...names].sort().join(', ')} } from '${spec}';`),
  ...(fromTab.length ? [`import { ${fromTab.sort().join(', ')} } from '${rel(dest, path.resolve(src))}';`] : []),
  '',
];

/* 옮기기 */
const chunk = lines.slice(from - 1, to);
const moved = new Set([...insideTop]);
lines.splice(from - 1, to - from + 1,
  `/* «${title}»은 ${path.relative(path.dirname(src), dest).replace(/\\/g, '/')}로 떼어 냈다 — 그 파일이 스스로 window에 건다 */`);

/* window 줄 옮기기 */
const winLines = [];
lines = lines.filter((l) => {
  const m = l.match(/^window\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;\s*$/);
  if (m && moved.has(m[2])) { winLines.push(l); return false; }
  return true;
});
fs.writeFileSync(src, lines.join(NL));
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, [...head, ...chunk, '', ...(winLines.length ? ['/* 화면의 onclick이 부르는 것 */', ...winLines] : []), ''].join(NL));

/* 다른 파일이 옮긴 이름을 탭 파일에서 가져가면 새 파일로 */
const all = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else if (e.name.endsWith('.js')) all.push(q); } })('js');
let rewired = 0;
for (const f of all) {
  if ([src, dest].some((x) => path.resolve(x) === path.resolve(f))) continue;
  let s = fs.readFileSync(f, 'utf8');
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  let hit = false;
  s = s.replace(/import\s*\{([^}]+)\}\s*from\s*'(\.{1,2}\/[^']+)';/g, (whole, list, spec) => {
    if (path.resolve(path.dirname(f), spec) !== path.resolve(src)) return whole;
    const items = list.split(',').map((x) => x.trim()).filter(Boolean);
    const mv = items.filter((x) => moved.has(x.split(/\s+as\s+/)[0]));
    if (!mv.length) return whole;
    hit = true;
    const rest = items.filter((x) => !mv.includes(x));
    const out = `import { ${mv.join(', ')} } from '${rel(f, path.resolve(dest))}';`;
    return rest.length ? `import { ${rest.join(', ')} } from '${spec}';${nl}${out}` : out;
  });
  if (hit) { fs.writeFileSync(f, s); rewired++; }
}

/* app.js */
const app = 'js/app.js';
let a = fs.readFileSync(app, 'utf8');
const srcSpec = rel(app, path.resolve(src)), destSpec = rel(app, path.resolve(dest));
const line = a.match(new RegExp(`^import '${srcSpec.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}';.*$`, 'm'));
if (!line) { console.error(`✗ app.js에서 import '${srcSpec}'를 못 찾았다 — 손으로 넣는다`); }
else if (!a.includes(`'${destSpec}'`)) {
  a = a.replace(line[0], `${line[0]}\nimport '${destSpec}';   // ${title} — 스스로 window에 건다`);
  fs.writeFileSync(app, a);
}
console.log(`옮김: 최상위 ${moved.size}개, window 줄 ${winLines.length}개, 탭에서 빌리는 이름 ${fromTab.length}개(${fromTab.join(', ')})`);
console.log(`다른 파일 import 돌림 ${rewired}개`);
