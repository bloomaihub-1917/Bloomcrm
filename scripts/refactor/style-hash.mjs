/* 토큰 정리 안전망 — 화면마다 ① 그려진 HTML(변수를 px로 되돌려서)과 ② 실제로 보이는 글자 크기·모서리
   (getComputedStyle)를 지문으로 만든다. master와 이 브랜치에서 같은 값이면 겉모양이 같다.
     const s = await import('…/scripts/refactor/style-hash.mjs'); await s.run() */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const unvar = (s) => s.replace(/var\(--fs-(\d+)(?:_(\d))?\)/g, (m, a, b) => a + (b ? '.' + b : '') + 'px')
  .replace(/var\(--rd-pill\)/g, '99px').replace(/var\(--rd-(\d+)\)/g, '$1px')
  .replace(/border-radius:(\s*)var\(--rs\)/g, 'border-radius:$15px').replace(/border-radius:(\s*)var\(--r\)/g, 'border-radius:$18px');
const hash = async (s) => {
  s = s.replace(/\d{13,}/g, '#ID').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '#TS').replace(/오[전후] \d{1,2}:\d{2}/g, '#HM');
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 6).map((x) => x.toString(16).padStart(2, '0')).join('');
};
const look = (el) => [...el.querySelectorAll('*')].map((e) => { const c = getComputedStyle(e); return c.fontSize + ' ' + c.borderRadius; }).join('|');
const VIEWS = [
  ['conf', 'setConfView', ['dash', 'pga', 'program', 'people', 'watch']],
  ['exh', 'setExhView', ['dash', 'list', 'booth', 'equip', 'graphic', 'money', 'book', 'onsite', 'watch']],
];
export async function run() {
  const out = {};
  const take = async (k, app) => { const el = document.getElementById('page-' + app); out[k] = el ? (await hash(unvar(el.innerHTML))) + '/' + (await hash(look(el))) : null; };
  for (const [app, fn, views] of VIEWS) {
    window.switchApp(app); await wait(200);
    for (const v of views) { window[fn](v); await wait(200); await take(`${app}:${v}`, app); }
  }
  for (const app of ['mdb', 'co', 'evdb', 'crm', 'ptn', 'audit']) { window.switchApp(app); await wait(250); await take(app, app); }
  out.shell = await hash(look(document.body).slice(0, 200000));
  return out;
}
