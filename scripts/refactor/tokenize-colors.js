/* 색 값 정리 — js·CSS의 스타일 값에 직접 적힌 색(#…)을 tokens.css 변수로 바꾼다. 값은 그대로라 화면은 같다.
   스타일 값만 본다: «:» 또는 «solid » 바로 뒤의 #색. JS 데이터('#9C9890'처럼 따옴표 안 — 행사 색·기록 색·캔버스)는 그대로.
   바깥으로 나가는 HTML(메일 본문·꼬리말 미리보기·인쇄·공유·보고서·등록 링크)도 그대로 — tokens.css가 없다.
     node scripts/refactor/tokenize-colors.js          (시험)
     node scripts/refactor/tokenize-colors.js --apply */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const SKIP = new Set(['js/modules/exh-export.js', 'js/modules/speaker-share.js', 'js/modules/contact-report.js',
  'js/shared/mail/mail-original.js', 'js/modules/register-links.js']);
/* 메일 본문·메일처럼 보이는 미리보기(흰 종이) 줄 */
const MAILISH = /Malgun|font-family:Arial|width:640px|evmb-fprev|max-height:420px;overflow:auto;background:#fff/;
const SAME = { // tokens.css에 이미 있는 값
  '9C9890': '--i4', '3B5BDB': '--a', '16A34A': '--g', '6D28D9': '--pu', 'C97B0A': '--am', '0F766E': '--te', 'DC2626': '--re',
  'EEF2FF': '--ad', 'FFFBEB': '--ab', 'FEF2F2': '--rb', 'F5F3FF': '--pb', 'F0FDFA': '--tb', 'F0FDF4': '--gb',
};
const NEW = { // 새로 이름 붙인 값(tokens.css에 추가)
  'C7D2FE': '--al', 'BBF7D0': '--gl', 'DDD6FE': '--pl', 'FDE68A': '--aml', '99F6E4': '--tel', 'FECACA': '--rel',
  '818CF8': '--in', 'F3F5FF': '--inb', '4338CA': '--ink', '3730A3': '--ink2', 'E0E7FF': '--inl', '6366F1': '--in6',
  'F2FBF5': '--gs', 'FEF9C3': '--yb', '854D0E': '--yk', 'FEF3C7': '--amb2', 'F59E0B': '--amd', '92400E': '--amk',
  'F7F9FF': '--selb', 'A8F5A0': '--code',
};
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
  const out = src.split('\n').map((line) => MAILISH.test(line) ? line : line
    .replace(/([\w-]+)(:\s*|:[^;"'`{}]*?solid\s+)#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b(?![\w-])/g, (m, prop, mid, hex) => {
      const h = hex.toUpperCase();
      let v;
      if (h === 'FFF' || h === 'FFFFFF') v = /color$/.test(prop) && !/background|border/.test(prop) ? '--on' : prop === 'background' || prop === 'background-color' ? '--W' : null;
      else v = SAME[h] || NEW[h];
      return v ? (n++, `${prop}${mid}var(${v})`) : m;
    })).join('\n');
  if (n) { total += n; console.log(String(n).padStart(4), rel); if (apply) fs.writeFileSync(f, out); }
}
console.log('합계', total, apply ? '(적용함)' : '(시험 — --apply로 적용)');
