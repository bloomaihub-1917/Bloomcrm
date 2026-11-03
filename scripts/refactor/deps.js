/* 리팩토링 안전망 ① — 화면(js/) 모듈의 import 관계를 본다.

   node scripts/refactor/deps.js            순환 관계 · 큰 파일 요약
   node scripts/refactor/deps.js --check    import한 이름이 그 파일에 실제로 있는지까지

   빌드가 없어서 import 경로나 이름이 틀려도 브라우저에서 그 탭을 열 때까지 모른다.
   파일을 옮기거나 함수를 꺼낸 뒤 이걸 돌리면 그 자리에서 잡힌다.

   펼침 «...이름»도 이름으로 센다 — 점으로 시작해 속성으로 잘못 보고 EVENT_LIST import를 놓친 적이 있다
   */
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
  /* 그때그때 읽는 import('…') — 화면을 그릴 때는 안 불리고 저장·메일 같은 동작에서만 불려, 브라우저 비교로는
     못 잡는다. 구획을 다른 폴더로 옮기면서 경로를 안 고쳐 다섯 곳이 깨진 채 있었다(설정 탭을 쪼갤 때 발견).
     파일이 있는지와, const { a, b } = await import(…)로 꺼내는 이름이 있는지를 본다 */
  for (const m of src.matchAll(/(?:const\s*\{([^}]*)\}\s*=\s*)?await\s+import\(\s*'(\.{1,2}\/[^']+)'\s*\)|import\(\s*'(\.{1,2}\/[^']+)'\s*\)/g)) {
    const spec = m[2] || m[3];
    if (m[3] && m.index > 0 && /await\s+$/.test(src.slice(Math.max(0, m.index - 10), m.index))) continue;   // 위 갈래가 이미 셌다
    const target = path.resolve(path.dirname(f), spec);
    if (!fs.existsSync(target)) { problems.push(`${rel(f)}: 없는 파일 ${spec} (import(…))`); continue; }
    if (m[1]) {
      const ex = exportsOf[rel(target)];
      m[1].split(',').map((s) => s.trim().split(/\s*:\s*/)[0].trim()).filter(Boolean)
        .forEach((n) => { if (ex && !ex.names.has(n) && !ex.star.length) problems.push(`${rel(f)}: ${spec}에 ${n} 없음 (import(…))`); });
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

/* 빌려 쓰는데 가져오지 않은 이름 — 함수를 옮긴 뒤 옛 파일에 남은 쪽이 그 함수의 비공개 도우미를
   계속 부르고 있으면, 브라우저에서 그 화면을 열 때에야 «X is not defined»로 터진다.
   정식 파서가 아니라 낱말을 훑는다: 어느 모듈이 export하는 이름인데, 이 파일에서 선언도
   import도 안 했고 속성(.x)·객체 키(x:)도 아닌 자리에 나오면 알린다. */
/* 템플릿(`…${식}…`)의 글자는 버리고 식만 남긴다. 템플릿 안의 식 안에 또 템플릿이 드는
   일이 흔해서(${url ? `<a target="_blank">` : ''}) 정규식으로는 짝을 못 맞춘다 — 한 글자씩 훑는다. */
function stripTemplates(s) {
  let out = '';
  const stack = [];          // 'tpl' | 숫자(식 안의 { 깊이)
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const top = stack[stack.length - 1];
    if (top === 'tpl') {
      if (ch === '\\') { i++; continue; }
      if (ch === '`') { stack.pop(); out += ' '; continue; }
      if (ch === '$' && s[i + 1] === '{') { stack.push(0); i++; out += ' ; '; continue; }
      if (ch === '\n') out += '\n';   // 줄 수는 지킨다(«N줄 근처» 안내)
      continue;
    }
    if (ch === '`') { stack.push('tpl'); out += ' '; continue; }
    if (typeof top === 'number') {
      if (ch === '{') stack[stack.length - 1]++;
      else if (ch === '}') { if (top === 0) { stack.pop(); out += ' ; '; continue; } stack[stack.length - 1]--; }
    }
    out += ch;
  }
  return out;
}
/* 코드만 남긴 사본 — 공용 훑기(js-scan.js). 문자열·주석·정규식·템플릿 글자를 지우고 ${식}은 남긴다.
   (위 stripTemplates와 정규식들로 하던 것을 바꿨다 — 정규식 글자 /["']/g의 따옴표를 문자열로 읽는 등
   도구마다 같은 함정에 빠져서 한곳으로 모았다.) import·export … from 줄은 먼저 지운다 */
const { codeOnly } = require('./js-scan.js');
const stripCode = (s) => codeOnly(s.replace(/^\s*(?:import|export)\s*\{[^}]*\}\s*from\s*'[^']*';?/gm, (m) => m.replace(/[^\n]/g, ' ')));
const allExported = new Set();
Object.values(exportsOf).forEach((e) => e.names.forEach((n) => allExported.add(n)));
/* 내보내지 않은 최상위 이름도 본다 — 옮긴 덩어리의 비공개 상수(SP_SENT)를 옛 파일이
   계속 쓰면, 그 이름은 어디서도 export되지 않아 위 목록만으로는 못 잡는다.
   옮겨 받은 파일(core/·domain/·features/·shared/)만 본다 — 모든 파일로 넓히면 label·target 같은
   흔한 지역 이름이 오탐으로 쏟아진다. (이렇게 해서 applyOrgLocal·nextActionTd 누락을 찾았다) */
for (const f of files.filter((p) => /^(core|domain|features|shared)\//.test(rel(p)))) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/^(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) allExported.add(m[1]);
}
/* 인라인 onclick 문자열이 부르는 window 함수는 import하지 않는 게 맞다 */
const ONWINDOW = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'window-baseline.json'), 'utf8')));
const GLOBALS = new Set(Object.getOwnPropertyNames(globalThis).concat(['window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location', 'alert', 'confirm', 'prompt', 'fetch', 'XLSX', 'crypto']));
/* 한 덩어리 코드 안에서 선언되는 이름들 (변수·함수·매개변수·구조 분해) */
function declaredIn(src) {
  const known = new Set();
  for (const m of src.matchAll(/\b(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) known.add(m[1]);
  /* let a = 1, b = 2 — 쉼표로 이어 선언한 뒤쪽 이름들 */
  for (const m of src.matchAll(/^\s*(?:export\s+)?(?:let|var|const)\s+([^;\n]*)/gm)) {
    m[1].split(',').forEach((p) => { const k = p.trim().match(/^([A-Za-z_$][\w$]*)\s*(=|$)/); if (k) known.add(k[1]); });
  }
  for (const m of src.matchAll(/\b(?:const|let|var)\s*[{[]([^=]*?)[}\]]\s*=/g)) m[1].split(/[,:\s{}[\]]+/).forEach((n) => n && known.add(n.replace(/=.*/, '')));
  for (const m of src.matchAll(/(?:function\s*[\w$]*\s*\(|\(|,)\s*([^()]*?)\)\s*(?:=>|\{)/g)) m[1].split(/[,\s{}[\]=:.]+/).forEach((n) => n && known.add(n));
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) known.add(m[1]);
  for (const m of src.matchAll(/catch\s*\(\s*(\w+)/g)) known.add(m[1]);
  /* 기본값 있는 매개변수(f(evKey, say = () => {}))— 괄호가 겹쳐 위 규칙이 못 잡는다.
     «{ x = 1; }»(블록 안 대입)까지 선언으로 치면 import한 값에 다시 넣는 것을 못 잡아서 «(»·«,» 뒤만 본다 */
  for (const m of src.matchAll(/[(,]\s*([A-Za-z_$][\w$]*)\s*=(?![=>])/g)) known.add(m[1]);
  for (const m of src.matchAll(/for\s*\(\s*(?:const|let|var)\s+([\w$]+)/g)) known.add(m[1]);
  return known;
}

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  /* 파일 전체에서 보이는 이름: import + 맨 앞 칸에서 시작하는 최상위 선언 */
  const top = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) m[1].split(',').forEach((s) => { const n = s.trim().split(/\s+as\s+/).pop().trim(); if (n) top.add(n); });
  for (const m of src.matchAll(/import\s+\*\s+as\s+(\w+)/g)) top.add(m[1]);
  for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) top.add(m[1]);
  for (const m of src.matchAll(/^(?:export\s+)?(?:let|var|const)\s+([^;\n]*)/gm)) {
    m[1].split(',').forEach((p) => { const k = p.trim().match(/^([A-Za-z_$][\w$]*)\s*(=|$)/); if (k) top.add(k[1]); });
  }
  for (const m of src.matchAll(/^(?:export\s+)?(?:const|let|var)\s*[{[]([^=]*?)[}\]]\s*=/gm)) m[1].split(/[,:\s{}[\]]+/).forEach((n) => n && top.add(n.replace(/=.*/, '')));

  /* 최상위 선언마다 덩어리로 나눈다 — 한 함수의 지역 변수가 다른 함수의 빈 import를 가리지 않게.
     (exh-tab.js의 한 함수 안 «const num»이 파일 위쪽에서 import를 빠뜨린 num을 가려 놓친 적이 있다) */
  const lines = src.split(/\r?\n/);
  const starts = [0];
  lines.forEach((l, i) => { if (i && /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\b/.test(l)) starts.push(i); });
  starts.push(lines.length);
  /* import한 이름 — 다른 모듈에서 빌린 값은 이 파일에서 다시 넣을 수 없다(«Assignment to constant variable»).
     큰 탭 파일을 쪼갤 때 모듈 상태(let)를 고치는 구획이 다른 파일로 가면 바로 이렇게 된다 */
  const imported = new Set();
  const twice = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) m[1].split(',').forEach((s) => { const n = s.trim().split(/\s+as\s+/).pop().trim(); if (!n) return; if (imported.has(n)) twice.add(n); imported.add(n); });
  /* 같은 이름을 두 번 import하면 파일을 읽을 때 SyntaxError — 그 파일 전체(와 그 파일을 읽는 앱)가 안 뜬다 */
  twice.forEach((n) => problems.push(`${rel(f)}: ${n}를 두 번 import한다 — 파일을 읽을 때 SyntaxError가 난다`));
  const missing = new Set();
  const reassigned = new Set();
  for (let k = 0; k < starts.length - 1; k++) {
    const chunk = lines.slice(starts[k], starts[k + 1]).join('\n');
    const local = declaredIn(chunk);
    const body = stripCode(chunk);
    /* 앞이 «.»(속성)이나 «<»·«/»(HTML 태그 <td>·</td>)면 이름이 아니다 */
    for (const m of body.matchAll(/(^|[^.\w$<\/]|\.\.\.)([A-Za-z_$][\w$]*)(?=\s*[^\w$:]|$)/g)) {
      const n = m[2];
      if (allExported.has(n) && !top.has(n) && !local.has(n) && !GLOBALS.has(n) && !ONWINDOW.has(n)) missing.add(`${n} (${starts[k] + 1}줄 근처)`);
    }
    for (const m of body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*(?:=(?![=>])|\+\+|--|[-+*/%|&]=|\?\?=)|(?:\+\+|--)\s*([A-Za-z_$][\w$]*)/g)) {
      const n = m[2] || m[3];
      if (imported.has(n) && !local.has(n)) reassigned.add(`${n} (${starts[k] + 1}줄 근처)`);
    }
  }
  missing.forEach((n) => problems.push(`${rel(f)}: ${n}를 쓰는데 선언·import가 없다`));
  reassigned.forEach((n) => problems.push(`${rel(f)}: import한 ${n}에 값을 다시 넣는다 — 그 값을 가진 파일의 set 함수로 바꿔야 한다`));
}

if (process.argv.includes('--check')) {
  /* 문법 — 손으로 줄을 옮기다 객체의 닫는 «};»를 두고 와서 설정 탭이 통째로 안 읽힌 적이 있다.
     위의 이름 검사는 글자만 훑어서 이걸 못 잡는다 */
  const { spawnSync } = require('child_process');
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: fs.readFileSync(f) });
    if (r.status) problems.push(`${rel(f)}: 문법 오류 — ${String(r.stderr).split('\n').find((l) => /Error/.test(l)) || ''}`);
  }
  if (problems.length) { console.log(`\n✗ import 문제 ${problems.length}개`); problems.forEach((p) => console.log('  ' + p)); process.exit(1); }
  console.log('\n✓ import한 이름이 모두 있다');
}
