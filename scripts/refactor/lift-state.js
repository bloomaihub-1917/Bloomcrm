/* 리팩토링 도구 — 탭 파일의 화면 상태(let)를 공유 객체 하나로 옮긴다.

   node scripts/refactor/lift-state.js <탭 파일> <새 상태 파일> <객체 이름> <변수> [<변수> …]
   예) node scripts/refactor/lift-state.js js/modules/upload-tab.js js/features/upload/upload-ui.js uploadUi upV _evDirectMode

   왜: 다른 모듈에서 import한 변수에는 값을 다시 넣을 수 없다. 그래서 «화면 상태를 고치는 구획»은
   다른 파일로 뗄 수 없었다. 객체의 속성은 어디서든 고칠 수 있으므로, let을 객체 속성으로 바꿔 두면
   그 뒤에는 구획을 떼어도 같은 상태를 함께 본다.

   하는 일
   - `let 이름 = 처음값;` 줄을 지우고(옆 주석은 새 파일로 함께), 새 파일에 `export const 객체 = { 키: 처음값, … }`
     키는 앞의 밑줄을 뗀 이름(_evDirectMode → evDirectMode)
   - 탭 파일에서 그 이름이 나오는 곳(속성 .이름·객체 키 이름: 은 빼고)을 `객체.키`로 바꾼다
   - 탭 파일 머리에 import를 더한다
   멈추는 경우: 한 줄에 여럿을 선언(let a, b)했거나, 처음값이 여러 줄이거나, 같은 이름이 함수 안에서
   다시 선언되어 있을 때 — 그때는 손으로 본다.

   펼침 «...이름»도 이름으로 센다 — 점으로 시작해 속성으로 잘못 보고 EVENT_LIST import를 놓친 적이 있다
   */
const fs = require('fs');
const path = require('path');
const [tab, dest, obj, ...names] = process.argv.slice(2);
if (!names.length) { console.error('쓰는 법: lift-state.js <탭> <새 파일> <객체> <변수>…'); process.exit(1); }

let src = fs.readFileSync(tab, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const keyOf = (n) => n.replace(/^_+/, '');
const props = [];

for (const n of names) {
  const re = new RegExp(`^let ${n}\\s*=\\s*([^;\\n]+);[ \\t]*(//[^\\n]*)?\\r?\\n`, 'm');
  const m = src.match(re);
  if (!m) { console.error(`✗ «let ${n} = …;» 한 줄 선언을 못 찾았다`); process.exit(1); }
  /* 같은 이름을 다시 선언하는 곳(지역 변수·매개변수)이 있으면 바꾸면 안 된다 */
  /* 선언(let/const/var/function 이름)과 함수 매개변수(function f(…이름…) / (…이름…) =>)만 본다.
     호출 인자(console.log('…', 이름, …))는 다시 선언이 아니다 */
  const rest = require('./js-scan.js').codeOnly(src.replace(m[0], ''));   // 문자열·주석 속 «let x»는 선언이 아니다
  const hits = [...rest.matchAll(new RegExp(`\\b(?:let|const|var|function)\\s+${n}\\b|\\b${n}\\s*=>`, 'g'))];
  /* 매개변수 목록에서는 «이름 자리»만 본다 — f(evKey = inboxEv)의 기본값은 다시 선언이 아니다 */
  for (const pm of rest.matchAll(/(?:\bfunction\s*[\w$]*\s*\(([^)]*)\)|\(([^()]*)\)\s*=>)/g)) {
    const params = (pm[1] ?? pm[2] ?? '').split(',').map((p) => p.split('=')[0].replace(/[{}[\].\s]/g, ''));
    if (params.includes(n)) hits.push(pm);
  }
  if (hits.length) { console.error(`✗ ${n}을(를) 다시 선언하는 곳이 있다 — 손으로 본다`); process.exit(1); }
  props.push(`  ${keyOf(n)}: ${m[1].trim()},${m[2] ? '   ' + m[2] : ''}`);
  src = src.replace(m[0], '');
}

/* 이름 바꾸기 — 공용 훑기(js-scan.js)로 코드 자리만 찾는다(문자열·주석·정규식·템플릿 글자는 건드리지 않는다).
   속성(.x)은 빼고 펼침(...x)은 넣는다. 객체 키 «{ upV: …»는 그대로, 삼항 «a ? upV : b»는 바꾼다.
   전에는 도구 안에서 따로 훑다가 정규식 글자 /["']/g의 따옴표를 문자열 시작으로 읽어, 전시 상세 창의
   뒤쪽 3천 줄에서 이름을 못 바꾼 적이 있다 */
{
  const { codeOnly, identifiers } = require('./js-scan.js');
  const code = codeOnly(src);
  const want = new Set(names);
  const edits = identifiers(code).filter(({ name, at }) => {
    if (!want.has(name)) return false;
    const after = code.slice(at + name.length).match(/^\s*(:)?/);
    const prevNonWs = code.slice(0, at).replace(/\s+$/, '').slice(-1);
    return !(after && after[1] && (prevNonWs === '{' || prevNonWs === ','));
  });
  for (const { name, at } of edits.reverse()) src = src.slice(0, at) + `${obj}.${keyOf(name)}` + src.slice(at + name.length);
}

/* import 더하기 — 파일 머리의 import 묶음 끝에. «파일 안 마지막 import»에 붙이면 안 된다: 설정 탭에서는
   그것이 파일 한가운데 구획 안에 있던 다시 내보내기 줄이라, 그 구획을 떼어 낼 때 import가 함께 끌려 나갔다.
   머리 묶음 = 첫 함수·변수·클래스 선언 앞에 있는 import들 */
const rel = (() => { let r = path.relative(path.dirname(tab), dest).replace(/\\/g, '/'); return r.startsWith('.') ? r : './' + r; })();
const firstCode = src.search(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\b/m);
const imports = [...src.matchAll(/^import[\s\S]*?;[ \t]*\r?\n/gm)].filter((m) => firstCode < 0 || m.index < firstCode);
const last = imports[imports.length - 1];
const at = last.index + last[0].length;
src = src.slice(0, at) + `/* 화면 상태는 ${rel}의 ${obj} 한곳에 둔다 — 이 탭의 구획을 다른 파일로 떼어도 같은 값을 보게 */${NL}import { ${obj} } from '${rel}';${NL}` + src.slice(at);
fs.writeFileSync(tab, src);

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, [
  '/* ' + '═'.repeat(62),
  `   ${path.relative('js', dest).replace(/\\/g, '/')} — ${path.basename(tab)}의 화면 상태`,
  '',
  '   전에는 탭 파일 안의 let 변수였다. 다른 모듈은 import한 변수에 값을 다시 넣을 수 없어서',
  '   «상태를 고치는 구획»을 다른 파일로 떼어 낼 수 없었다. 객체 속성은 어디서 고쳐도 모두가',
  '   같은 값을 보므로, 상태를 여기 모아 두면 구획을 떼어도 동작이 그대로다.',
  '   화면에만 쓰는 값이다 — 서버에 저장하지 않는다.',
  '═'.repeat(63) + ' */',
  `export const ${obj} = {`,
  ...props,
  '};',
  '',
].join(NL));
console.log(`옮긴 상태 ${names.length}개 → ${dest} (${obj})`);
