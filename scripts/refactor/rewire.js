/* 리팩토링 도구 — <옛 파일>에서 가져가던 이름 중 <새 파일>이 내보내는 것은 새 파일에서 가져가게 바꾼다.

   node scripts/refactor/rewire.js <옛 파일> <새 파일>

   move.js는 옮긴 그 순간의 이름만 돌린다. 나중에 손으로 더 옮긴 이름이 있으면 이걸로 마저 돌린다.
   옛 파일 자신과 새 파일은 건드리지 않는다. */
const fs = require('fs');
const path = require('path');
const [oldF, newF] = process.argv.slice(2);
const src = fs.readFileSync(newF, 'utf8');
const exported = new Set();
for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) exported.add(m[1]);

const rel = (from, to) => { const r = path.relative(path.dirname(from), to).replace(/\\/g, '/'); return r.startsWith('.') ? r : './' + r; };
const all = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else if (e.name.endsWith('.js')) all.push(q); } })('js');

let touched = 0;
for (const f of all) {
  if ([oldF, newF].some((x) => path.resolve(x) === path.resolve(f))) continue;
  let s = fs.readFileSync(f, 'utf8');
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  let hit = false;
  s = s.replace(/import\s*\{([^}]+)\}\s*from\s*'(\.{1,2}\/[^']+)';/g, (whole, list, spec) => {
    if (path.resolve(path.dirname(f), spec) !== path.resolve(oldF)) return whole;
    const items = list.split(',').map((x) => x.trim()).filter(Boolean);
    const mv = items.filter((x) => exported.has(x.split(/\s+as\s+/)[0]));
    if (!mv.length) return whole;
    hit = true;
    const rest = items.filter((x) => !mv.includes(x));
    const out = `import { ${mv.join(', ')} } from '${rel(f, newF)}';`;
    return rest.length ? `import { ${rest.join(', ')} } from '${spec}';${nl}${out}` : out;
  });
  if (hit) { fs.writeFileSync(f, s); touched++; console.log('  ' + path.relative('.', f)); }
}
console.log(`고친 파일 ${touched}개`);
