/* ══════════════════════════════════════════════════════════════
   original-html.js — 메일 원문을 안전한 HTML로
   (../../routes/mail.js에서 떼어 냈다. 그 파일이 이 파일을 require한다 — 이 파일은 그 파일을 부르지 않는다)
═══════════════════════════════════════════════════════════════ */
const { bodyParts, mailText, norm, AUTO_SUBJ, isAutoReply, prevDay, syncSentHandler } = require('./sync-sent');

/* 원문을 안전한 HTML로 — 스크립트·폼·외부 불러오기를 걷어 내고, 본문에 붙은 이미지만
   data:로 넣는다. 외부 이미지는 기본으로 막는다(열람 추적). 화면은 이 결과를 스크립트가
   돌지 않는 iframe(sandbox, CSP)에 띄운다 */
function safeOriginalHtml(mail, { remote = false, noLinks = false } = {}) {
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  let h = mail.html || (bodyParts(mail).find((a) => /html/i.test(a.contentType))?.content.toString('utf8'))
    || `<pre style="white-space:pre-wrap;font-family:inherit">${esc(mail.text || '')}</pre>`;
  h = h.replace(/<(script|iframe|frame|object|embed|applet|form|meta|link|base|svg)\b[\s\S]*?(<\/\1\s*>|\/?>)/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|action)\s*=\s*(["'])\s*(javascript|vbscript|data:text)[^"']*\2/gi, '$1=""');
  const cid = new Map((mail.attachments || [])
    .filter((a) => a.cid && /^image\/(png|jpe?g|gif|webp)$/i.test(a.contentType || '') && a.size < 3 * 1024 * 1024)   // svg·이상한 형식은 넣지 않는다
    .map((a) => [String(a.cid).replace(/[<>]/g, ''), `data:${a.contentType};base64,${a.content.toString('base64')}`]));
  h = h.replace(/src\s*=\s*(["'])cid:([^"']+)\1/gi, (m, q, c) => `src="${cid.get(c) || ''}"`);
  if (!remote) {
    h = h.replace(/(<img\b[^>]*?)\ssrc\s*=\s*(["'])(https?:|\/\/)[^"']*\2/gi, '$1 src="" data-blocked="1"')
      .replace(/url\(\s*(["']?)(https?:|\/\/)[^)]*\)/gi, 'url()');
  }
  if (noLinks) h = h.replace(/\shref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return h;
}


module.exports = { safeOriginalHtml };
