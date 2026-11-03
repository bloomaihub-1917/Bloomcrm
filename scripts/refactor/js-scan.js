/* 리팩토링 도구들이 함께 쓰는 낱말 훑기 — «코드만 남긴 사본»을 만든다.

   codeOnly(src)는 src와 길이가 똑같은 문자열을 돌려준다. 문자열·주석·정규식 글자·템플릿의 글자 부분은
   공백으로 지우고(줄바꿈은 남긴다), 템플릿 안의 ${식}은 코드로 남긴다. 자리가 원본과 똑같아서
   «사본에서 이름을 찾고, 원본의 같은 자리를 고친다»가 된다.

   왜 따로 두나: 도구마다 제 나름으로 훑다가 같은 함정에 차례로 빠졌다 —
   - 템플릿 속 템플릿(${url ? `<a target="_blank">` : ''})
   - 펼침(...EVENT_LIST)을 속성으로 오인
   - 정규식 글자 안의 따옴표(/["']/g)를 문자열 시작으로 오인 → 그 뒤 수천 줄을 거꾸로 읽음
   한곳에서 제대로 훑고 모두 이것을 쓴다.

   정규식인지 나눗셈인지: 앞의 (공백 아닌) 글자가 연산자·여는 괄호·쉼표 등이거나 return/typeof 같은
   낱말이면 정규식, 이름·숫자·닫는 괄호 뒤면 나눗셈으로 본다(보통의 JS 토크나이저 규칙). */
'use strict';

const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

function codeOnly(src) {
  const out = src.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '; };
  const stack = [];           // 'tpl' | 숫자(템플릿 식 안의 { 깊이)
  let i = 0;
  let lastSig = '';           // 코드에서 마지막으로 본 공백 아닌 글자
  let lastWord = '';          // 그 글자가 낱말 끝이면 그 낱말
  const regexAllowed = () => {
    if (!lastSig) return true;
    if (/[\w$]/.test(lastSig)) return REGEX_AFTER_WORD.has(lastWord);
    return !/[)\].]/.test(lastSig) || lastSig === undefined;
  };
  while (i < src.length) {
    const top = stack[stack.length - 1];
    const c = src[i], d = src[i + 1];
    if (top === 'tpl') {
      if (c === '\\') { blank(i, i + 2); i += 2; continue; }
      if (c === '`') { stack.pop(); i++; lastSig = '`'; lastWord = ''; continue; }
      if (c === '$' && d === '{') { blank(i, i + 1); stack.push(0); i += 2; lastSig = '{'; lastWord = ''; continue; }
      blank(i, i + 1); i++; continue;
    }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      blank(i + 1, j); i = j + 1; lastSig = c; lastWord = ''; continue;
    }
    if (c === '`') { stack.push('tpl'); i++; continue; }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, inClass = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      blank(i + 1, j);
      j++; const flags = j; while (/[a-z]/.test(src[j] || '')) j++;
      blank(flags, j);         // 꼬리표(g·i…)도 이름이 아니다
      i = j; lastSig = '/'; lastWord = ''; continue;
    }
    if (typeof top === 'number') {
      if (c === '{') stack[stack.length - 1]++;
      else if (c === '}') {
        if (top === 0) { stack.pop(); i++; lastSig = '}'; lastWord = ''; continue; }
        stack[stack.length - 1]--;
      }
    }
    if (/[\w$]/.test(c)) {
      let j = i; while (j < src.length && /[\w$]/.test(src[j])) j++;
      lastWord = src.slice(i, j); lastSig = src[j - 1]; i = j; continue;
    }
    if (!/\s/.test(c)) { lastSig = c; lastWord = ''; }
    i++;
  }
  return out.join('');
}

/* 사본에서 이름 하나하나의 자리 — 속성(.x)은 빼고 펼침(...x)은 넣는다 */
function identifiers(code) {
  const res = [];
  for (const m of code.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const at = m.index;
    const prev = code[at - 1];
    if (prev && /[\w$]/.test(prev)) continue;
    if (prev === '.' && code.slice(at - 3, at) !== '...') continue;
    res.push({ name: m[0], at });
  }
  return res;
}

module.exports = { codeOnly, identifiers };
