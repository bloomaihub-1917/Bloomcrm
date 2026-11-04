/* 토큰 정리 — js·CSS에 숫자로 적힌 글자 크기·둥근 모서리를 tokens.css 변수로 바꾼다.
   값은 그대로(같은 px)라 화면은 바뀌지 않는다. 나중에 tokens.css 값만 고치면 전체가 따라온다.
   바깥으로 나가는 HTML(인쇄 창·공유·보고서·메일 원문·등록 링크 페이지)은 tokens.css가 없어 그대로 둔다.
     node scripts/refactor/tokenize.js          (시험: 몇 곳 바뀌는지만)
     node scripts/refactor/tokenize.js --apply */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const SKIP = new Set(['js/modules/exh-export.js', 'js/modules/speaker-share.js', 'js/modules/contact-report.js',
  'js/shared/mail/mail-original.js', 'js/modules/register-links.js']);
const MAILISH = /Malgun|font-family:Arial|width:640px/;
const FS = ['8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '12.5', '13', '13.5', '14', '15', '16', '17', '18', '19', '20'];
const fsName = (v) => '--fs-' + v.replace('.', '_');
const RD = { 2: '--rd-2', 3: '--rd-3', 4: '--rd-4', 5: '--rs', 6: '--rd-6', 7: '--rd-7', 8: '--r', 9: '--rd-9', 10: '--rd-10',
  12: '--rd-12', 14: '--rd-14', 20: '--rd-20', 99: '--rd-pill', 999: '--rd-pill' };
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? files(p) : /\.(js|css)$/.test(d.name) ? [p] : [];
  });
}
const targets = [...files(path.join(ROOT, 'js')), path.join(ROOT, 'styles/layout.css'), path.join(ROOT, 'styles/components.css')];
const apply = process.argv.includes('--apply');
let total = 0;
for (const f of targets) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  if (SKIP.has(rel)) continue;
  let n = 0;
  const src = fs.readFileSync(f, 'utf8');
  /* 메일 본문·메일 꼬리말 미리보기처럼 받는 쪽에서 보는 HTML 줄은 숫자 그대로 둔다(tokens.css가 없다) */
  const out = src.split('\n').map((line) => MAILISH.test(line) ? line : line
    .replace(/font-size:(\s*)(\d+(?:\.\d+)?)px(?![\w.])/g, (m, sp, v) => FS.includes(v) ? (n++, `font-size:${sp}var(${fsName(v)})`) : m)
    .replace(/border-radius:(\s*)(\d+)px(?=\s*[;"'}`!])/g, (m, sp, v) => RD[v] ? (n++, `border-radius:${sp}var(${RD[v]})`) : m)).join('\n');
  if (n) { total += n; console.log(String(n).padStart(4), rel); if (apply) fs.writeFileSync(f, out); }
}
console.log('합계', total, apply ? '(적용함)' : '(시험 — --apply로 적용)');
