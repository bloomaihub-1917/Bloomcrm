/* 탭 본문 단락 여백 검사 — 단락마다 padding:Npx 16px를 손으로 적으면 간격이 다시 들쭉날쭉해진다.
   .sec / .sec-bar / .sec-rows(components.css, --gap-sec·--pad-x)를 쓰지 않고 «Npx 16px 0»·«Npx 16px 40px»를 직접 적은 줄을 찾는다.
     node scripts/refactor/check-spacing.js   (찾으면 종료 코드 1) */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['js/modules', 'js/features'];
const BAD = /padding:\s*\d+px (?:16px|var\(--pad-x\)) (?:0|40px)\b/;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
});
let n = 0;
for (const dir of DIRS) for (const f of walk(path.join(ROOT, dir))) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (BAD.test(line)) { n++; console.log(`${path.relative(ROOT, f)}:${i + 1}  ${line.trim().slice(0, 110)}`); }
  });
}
console.log(n ? `\n${n}곳 — class="sec" / "sec sec-bar" / "sec-rows"로 바꿔 주세요` : '여백 직접 적은 곳 없음');
process.exit(n ? 1 : 0);
