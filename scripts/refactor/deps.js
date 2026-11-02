/* 리팩토링 안전망 ① — 화면(js/) 모듈의 import 관계를 본다.

   node scripts/refactor/deps.js            순환 관계 · 큰 파일 요약
   node scripts/refactor/deps.js --check    import한 이름이 그 파일에 실제로 있는지까지

   빌드가 없어서 import 경로나 이름이 틀려도 브라우저에서 그 탭을 열 때까지 모른다.
   파일을 옮기거나 함수를 꺼낸 뒤 이걸 돌리면 그 자리에서 잡힌다. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'js');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p);
  }
})(ROOT);

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const graph = {}, problems = [], exportsOf = {};

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]+)\}(?:\s*from\s*'[^']+')?/gm)) {
    m[1].split(',').map((s) => s.trim()).filter(Boolean)
      .forEach((s) => names.add(s.split(/\s+as\s+/).pop().trim()));
  }
  exportsOf[rel(f)] = { names, star: [...src.matchAll(/^export\s*\*\s*from\s*'([^']+)'/gm)].map((m) => m[1]) };
}

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const deps = new Set();
  const re = /^\s*(?:import|export)\s*(?:(\{[^}]*\}|\*\s+as\s+\w+|[\w$]+)\s*from\s*)?'(\.{1,2}\/[^']+)'/gm;
  for (const m of src.matchAll(re)) {
    const target = path.resolve(path.dirname(f), m[2]);
    if (!fs.existsSync(target)) { problems.push(`${rel(f)}: 없는 파일 ${m[2]}`); continue; }
    deps.add(rel(target));
    if (m[1] && m[1].startsWith('{')) {
      const want = m[1].slice(1, -1).split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      const has = (file, name, seen = new Set()) => {
        if (seen.has(file)) return false; seen.add(file);
        const ex = exportsOf[file]; if (!ex) return false;
        if (ex.names.has(name)) return true;
        return ex.star.some((s) => has(rel(path.resolve(path.join(ROOT, path.dirname(file)), s)), name, seen));
      };
      want.forEach((n) => { if (!has(rel(target), n)) problems.push(`${rel(f)}: ${m[2]}에 ${n} 없음`); });
    }
  }
  graph[rel(f)] = [...deps];
}

/* 순환 — 강하게 이어진 덩어리(Tarjan)로 묶어 보인다 */
let idx = 0; const st = [], on = new Set(), I = {}, L = {}, sccs = [];
function sc(v) {
  I[v] = L[v] = idx++; st.push(v); on.add(v);
  for (const w of graph[v] || []) {
    if (I[w] === undefined) { sc(w); L[v] = Math.min(L[v], L[w]); }
    else if (on.has(w)) L[v] = Math.min(L[v], I[w]);
  }
  if (L[v] === I[v]) { const c = []; let w; do { w = st.pop(); on.delete(w); c.push(w); } while (w !== v); if (c.length > 1) sccs.push(c.sort()); }
}
Object.keys(graph).forEach((v) => { if (I[v] === undefined) sc(v); });

const pairs = [];
for (const [a, ds] of Object.entries(graph)) for (const b of ds) if (a < b && (graph[b] || []).includes(a)) pairs.push(`${a} ↔ ${b}`);

console.log(`파일 ${files.length}개`);
console.log(`서로 import하는 쌍 ${pairs.length}개`);
pairs.forEach((p) => console.log('  ' + p));
console.log(`순환 덩어리 ${sccs.length}개 (가장 큰 것 ${Math.max(0, ...sccs.map((c) => c.length))}개 파일)`);
sccs.forEach((c) => console.log(`  [${c.length}] ${c.join(', ')}`));
const big = files.map((f) => [rel(f), fs.readFileSync(f, 'utf8').split('\n').length]).filter(([, n]) => n > 1500).sort((a, b) => b[1] - a[1]);
console.log('1500줄 넘는 파일: ' + big.map(([f, n]) => `${f}(${n})`).join(', '));

if (process.argv.includes('--check')) {
  if (problems.length) { console.log(`\n✗ import 문제 ${problems.length}개`); problems.forEach((p) => console.log('  ' + p)); process.exit(1); }
  console.log('\n✓ import한 이름이 모두 있다');
}
