/* 메일 본문을 HTML 소스로 쓸 때 — 참가기업 단체 메일(exh-bulkmail.js)·컨택 DM(contact-mail.js)
   작성 방법: docs/html-mail-guide.md */

/* 문구가 HTML 소스인가 — 맨 앞이 태그로 시작하면 HTML로 본다 */
export const looksHtml = (s) => /^\s*<(?:[a-z][a-z0-9]*|!--)[\s>/]/i.test(String(s || ''));

/* 위험한 태그·on* 속성·javascript: 주소는 뺀다 */
const BAD_TAGS = 'script,iframe,frame,object,embed,form,input,button,textarea,select,link,meta,base,svg,math';
export function cleanHtml(src){
  const doc = new DOMParser().parseFromString(`<body>${src}</body>`, 'text/html');
  doc.body.querySelectorAll(BAD_TAGS).forEach(n => n.remove());
  doc.body.querySelectorAll('*').forEach(n => [...n.attributes].forEach(a => {
    if(/^on/i.test(a.name) || (/^(href|src|action|formaction)$/i.test(a.name) && /^\s*(javascript|vbscript|data:text)/i.test(a.value))) n.removeAttribute(a.name);
  }));
  return doc.body.innerHTML;
}

/* HTML을 못 보는 메일 프로그램용 글 본문 */
export function htmlToText(src){
  const doc = new DOMParser().parseFromString(`<body>${String(src).replace(/\s*\n\s*/g, ' ')}</body>`, 'text/html');
  doc.body.querySelectorAll('script,style').forEach(n => n.remove());
  doc.body.querySelectorAll('br').forEach(n => n.replaceWith('\n'));
  doc.body.querySelectorAll('p,div,tr,h1,h2,h3,h4,li,table').forEach(n => n.append('\n'));
  doc.body.querySelectorAll('td,th').forEach(n => n.append(' '));
  doc.body.querySelectorAll('a[href]').forEach(n => { const h = n.getAttribute('href'); if(/^https?:/i.test(h) && n.textContent.trim() !== h) n.append(` (${h})`); });
  return doc.body.textContent.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
