/* 리팩토링 도구 — 서버(CommonJS) 파일의 한 범위를 새 파일로 떼어 낸다. split-leaf.js의 서버판.

   node scripts/refactor/cjs-split.js <파일> <시작줄> <끝줄> <새 파일> "<머리 주석 제목>"

   하는 일
   1) 범위가 쓰는 require 이름(파일 어디에 있든 «const x = require(…)» 한 줄짜리)을 새 파일 머리에 다시 적는다
      — 경로는 새 자리에 맞춘다. 범위 안의 require 줄은 머리로 올린다.
   2) 범위에서 선언한 최상위 이름 중 파일의 나머지가 쓰는 것을 module.exports로 내고,
      원래 파일은 그 자리에 «const { … } = require('<새 파일>')» 한 줄을 둔다.
   3) 원래 파일에 남은 require 중 이제 아무도 안 쓰는 것은 지운다.
   멈추는 경우(손으로 본다)
   - 범위가 파일의 나머지에 선언된 이름을 쓴다 — 새 파일이 원래 파일을 require하면 고리가 된다
   - 범위의 let을 파일의 나머지가 고친다 — 다른 모듈의 let은 고칠 수 없다
   코드 자리만 본다 — 문자열·주석·정규식·템플릿 글자는 js-scan.js가 걸러 낸다 */
const fs = require('fs');
const path = require('path');
const { codeOnly, identifiers } = require('./js-scan.js');
const [src, fromS, toS, dest, title = '떼어 낸 구획'] = process.argv.slice(2);
const from = +fromS, to = +toS;
if (!dest) { console.error('쓰는 법: cjs-split.js <파일> <시작> <끝> <새 파일> "<제목>"'); process.exit(1); }

const raw = fs.readFileSync(src, 'utf8');
const NL = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);
const code = codeOnly(raw);
const lineStart = []; { let p = 0; for (const l of lines) { lineStart.push(p); p += l.length + 1 + (NL === '\r\n' ? 1 : 0); } }
const lineOf = (at) => { let lo = 0, hi = lineStart.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStart[m] <= at) lo = m; else hi = m - 1; } return lo + 1; };
const inRange = (ln) => ln >= from && ln <= to;

/* 최상위 선언 — 들여쓰기 없는 줄의 const/let/var/function/async function/class */
const decls = [];   // { name, line, kind }
lines.forEach((l, i) => {
  let m = l.match(/^(?:async\s+)?function\s*\*?\s*([\w$]+)/) || l.match(/^class\s+([\w$]+)/);
  if (m) return decls.push({ name: m[1], line: i + 1, kind: 'fn' });
  m = l.match(/^(const|let|var)\s+(.*)$/);
  if (!m) return;
  const kind = m[1];
  const rest = m[2];
  if (/^\{/.test(rest)) {   // const { a, b: c } = …
    const inner = rest.slice(1, rest.indexOf('}'));
    inner.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => decls.push({ name: s.split(':').pop().trim(), line: i + 1, kind, req: /require\(/.test(rest) }));
  } else {
    const n = rest.match(/^([\w$]+)/);
    if (n) decls.push({ name: n[1], line: i + 1, kind, req: /=\s*require\(/.test(rest) });
  }
});
const declIn = decls.filter((d) => inRange(d.line) && !d.req);
const declOut = decls.filter((d) => !inRange(d.line) && !d.req);
const reqDecls = decls.filter((d) => d.req);

const ids = identifiers(code).filter(({ name, at }) => {
  const prev = code.slice(0, at).replace(/\s+$/, '').slice(-1);
  const prev3 = code.slice(Math.max(0, at - 3), at);
  return prev !== '.' || prev3 === '...';
}).map((x) => ({ ...x, line: lineOf(x.at) }));
const usedIn = new Set(ids.filter((x) => inRange(x.line)).map((x) => x.name));
const usedOut = new Set(ids.filter((x) => !inRange(x.line)).map((x) => x.name));

/* 고리 검사 — 범위가 바깥 선언을 쓰는가(바깥에서 선언했지만 범위 안에서 같은 이름을 다시 선언한 것은 뺀다) */
const inNames = new Set(declIn.map((d) => d.name));
const back = declOut.filter((d) => usedIn.has(d.name) && !inNames.has(d.name)).map((d) => d.name);
if (back.length) { console.error('✗ 범위가 파일의 나머지에 선언된 이름을 쓴다(고리가 된다): ' + [...new Set(back)].join(', ')); process.exit(1); }
/* let 고치기 검사 */
for (const d of declIn.filter((d) => d.kind === 'let')) {
  const re = new RegExp(`(^|[^\\w$.])${d.name.replace(/\$/g, '\\$')}\\s*(=(?!=)|\\+=|-=|\\+\\+|--)`, 'g');
  for (const m of code.matchAll(re)) if (!inRange(lineOf(m.index))) { console.error(`✗ 범위의 let ${d.name}을 파일의 나머지가 고친다(${lineOf(m.index)}줄)`); process.exit(1); }
}

const rel = (fromFile, target) => { let r = path.relative(path.dirname(fromFile), target).replace(/\\/g, '/'); return r.startsWith('.') ? r : './' + r; };
const fixReq = (line, fromFile, toFile) => line.replace(/require\((['"])(\.{1,2}\/[^'"]+)\1\)/g, (w, q, spec) => `require('${rel(toFile, path.resolve(path.dirname(fromFile), spec))}')`);

/* 새 파일 머리 require — 범위가 쓰는 require 이름의 줄(한 줄짜리)을 옮겨 적는다 */
const reqLinesNeeded = [...new Set(reqDecls.filter((d) => usedIn.has(d.name) || inRange(d.line)).map((d) => d.line))].sort((a, b) => a - b);
const head = reqLinesNeeded.map((ln) => fixReq(lines[ln - 1], src, dest));

const body = lines.slice(from - 1, to).filter((l, i) => !reqLinesNeeded.includes(from + i));
const exportsList = [...inNames].filter((n) => usedOut.has(n));
const destText = [
  '/* ' + '═'.repeat(62),
  `   ${path.basename(dest)} — ${title}`,
  `   (${path.relative(path.dirname(dest), src).replace(/\\/g, '/')}에서 떼어 냈다. 그 파일이 이 파일을 require한다 — 이 파일은 그 파일을 부르지 않는다)`,
  '═'.repeat(63) + ' */',
  ...head,
  '',
  ...body,
  '',
  `module.exports = { ${exportsList.join(', ')} };`,
  '',
].join(NL);

/* 원래 파일 — 범위를 require 한 줄로 바꾸고, 범위 안 require 줄은 이미 뺐다 */
const stub = exportsList.length ? [`/* «${title}»은 ${rel(src, dest)}로 떼어 냈다 */`, `const { ${exportsList.join(', ')} } = require('${rel(src, dest).replace(/\.js$/, '')}');`, '']
  : [`/* «${title}»은 ${rel(src, dest)}로 떼어 냈다 — 이 파일은 그것을 쓰지 않는다 */`];
let rest = [...lines.slice(0, from - 1), ...stub, ...lines.slice(to)];
/* 남은 require 중 아무도 안 쓰는 것 지우기 — 남은 글을 다시 훑는다 */
{
  const restCode = codeOnly(rest.join('\n'));
  const restIds = new Set(identifiers(restCode).map((x) => x.name));
  rest = rest.filter((l) => {
    const m = l.match(/^const\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\(/);
    if (!m) return true;
    const names = m[1].startsWith('{') ? m[1].slice(1, -1).split(',').map((s) => s.split(':').pop().trim()).filter(Boolean) : [m[1]];
    const count = (n) => (restCode.match(new RegExp(`(^|[^\\w$.])${n.replace(/\$/g, '\\$')}(?![\\w$])`, 'g')) || []).length;
    return names.some((n) => count(n) > 1);   // 선언 한 번 말고도 쓰이는 곳이 있으면 남긴다
  });
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, destText);
fs.writeFileSync(src, rest.join(NL));
console.log(`옮김 ${to - from + 1}줄 → ${dest} — 내보낸 이름 ${exportsList.length}개, 머리 require ${head.length}줄`);
