/* 리팩토링 도구 — 파일을 통째로 다른 폴더로 옮기고 모든 import 경로를 고친다.

   node scripts/refactor/mvfile.js <새 폴더> <파일> [<파일> …]
   예) node scripts/refactor/mvfile.js js/shared/mail js/modules/mail-vars.js js/modules/mail-mark.js

   - git mv로 옮겨 이력이 이어진다.
   - 고치는 자리: import … from '…', import '…', export … from '…', 그리고 import('…')(동적).
     동적 import는 deps.js가 보지 않으므로 여기서 빠뜨리면 그 화면을 열 때에야 터진다.
   - 옮긴 파일 안의 상대 경로도 새 자리에 맞춘다.
   - 다 고친 뒤, js/ 안의 모든 상대 경로가 실제 파일을 가리키는지 확인하고 아니면 알린다. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [destDir, ...srcs] = process.argv.slice(2);
if (!destDir || !srcs.length) { console.error('쓰는 법: mvfile.js <새 폴더> <파일> …'); process.exit(1); }

const abs = (p) => path.resolve(p);
const moves = new Map(srcs.map((s) => [abs(s), abs(path.join(destDir, path.basename(s)))]));
for (const [from, to] of moves) {
  if (!fs.existsSync(from)) { console.error('없는 파일: ' + from); process.exit(1); }
  if (fs.existsSync(to)) { console.error('이미 있는 파일: ' + to); process.exit(1); }
}

const all = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) all.push(abs(q)); } })('js');

const SPEC = /(\bfrom\s*|\bimport\s*|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\2/g;
const relSpec = (fromFile, target) => { let r = path.relative(path.dirname(fromFile), target).replace(/\\/g, '/'); return r.startsWith('.') ? r : './' + r; };

/* 1) 내용 고치기 — 옮기기 전 자리 기준으로 대상을 풀고, 옮긴 뒤 자리 기준으로 다시 쓴다 */
let touched = 0;
for (const f of all) {
  const src = fs.readFileSync(f, 'utf8');
  const newSelf = moves.get(f) || f;
  const out = src.replace(SPEC, (whole, kw, q, spec) => {
    const target = path.resolve(path.dirname(f), spec);
    const newTarget = moves.get(target) || target;
    if (newTarget === target && newSelf === f) return whole;
    return `${kw}${q}${relSpec(newSelf, newTarget)}${q}`;
  });
  if (out !== src) { fs.writeFileSync(f, out); touched++; }
}

/* 2) 옮기기 */
fs.mkdirSync(destDir, { recursive: true });
for (const [from, to] of moves) execFileSync('git', ['mv', from, to]);

/* 3) 확인 — 모든 상대 경로가 실제 파일을 가리키나 */
const after = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else if (e.name.endsWith('.js')) after.push(q); } })('js');
const broken = [];
for (const f of after) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(SPEC)) {
    if (!fs.existsSync(path.resolve(path.dirname(f), m[3]))) broken.push(`${f}: ${m[3]}`);
  }
}
console.log(`옮김 ${moves.size}개, 경로를 고친 파일 ${touched}개`);
if (broken.length) { console.log('✗ 가리키는 파일이 없는 경로:'); broken.forEach((b) => console.log('  ' + b)); process.exit(1); }
console.log('✓ 모든 상대 경로(동적 import 포함)가 실제 파일을 가리킨다');
