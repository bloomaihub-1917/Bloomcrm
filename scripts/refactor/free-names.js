/* 리팩토링 도구 — 줄 범위를 옮기기 전에, 그 범위가 바깥(같은 파일의 다른 곳·import)에서
   빌려 쓰는 이름을 뽑는다. 옮긴 뒤 이 이름들을 새 파일 머리에서 import해야 한다.

   node scripts/refactor/free-names.js <파일> <시작줄> <끝줄>

   정식 파서가 아니라 낱말을 훑는다: 범위 안의 낱말 중, 그 파일의 최상위 선언이나
   import 이름과 같고 범위 안에서 선언되지 않은 것을 보인다. 속성 이름(.foo)은 뺀다.
   지역 변수와 이름이 같은 최상위 이름은 잘못 잡힐 수 있으니 결과는 눈으로 한 번 본다. */
const fs = require('fs');
const [file, from, to] = process.argv.slice(2);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const inRange = (i) => i >= from - 1 && i <= to - 1;

const strip = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  /* 따옴표 안에 ${…}가 든 것(onclick="f('${escAttr(x)}')")은 지우지 않는다 — 그 안의 함수 이름을 놓친다 */
  .replace(/'(?:\\.|[^'\\\n$])*'/g, "''")
  .replace(/"(?:\\.|[^"\\\n$])*"/g, '""');

/* 바깥 이름: 최상위 선언 + import 이름 (범위 밖) */
const outside = new Map();   // name → 'import from X' | 'line N'
const src = lines.join('\n');
for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
  m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
    const local = s.split(/\s+as\s+/).pop().trim();
    outside.set(local, `import ${s} from '${m[2]}'`);
  });
}
lines.forEach((l, i) => {
  if (inRange(i)) return;
  const m = l.match(/^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/);
  if (m) outside.set(m[1], `${file}:${i + 1}`);
});

/* 범위 안에서 선언된 최상위 이름 */
const inside = new Set();
lines.forEach((l, i) => {
  if (!inRange(i)) return;
  const m = l.match(/^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/);
  if (m) inside.add(m[1]);
});

const body = strip(lines.slice(from - 1, to).join('\n'));
const used = new Set();
for (const m of body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)) used.add(m[2]);

const need = [...used].filter((n) => outside.has(n) && !inside.has(n)).sort();
const fromImports = need.filter((n) => outside.get(n).startsWith('import'));
const fromFile = need.filter((n) => !outside.get(n).startsWith('import'));
console.log('import에서 빌려 쓰는 이름:');
fromImports.forEach((n) => console.log(`  ${n}  ← ${outside.get(n)}`));
console.log('같은 파일의 다른 곳에서 빌려 쓰는 이름 (옮기면 안 되거나 함께 옮겨야 한다):');
fromFile.forEach((n) => console.log(`  ${n}  ← ${outside.get(n)}`));
