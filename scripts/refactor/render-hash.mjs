/* 리팩토링 안전망 ④ — 화면 그림 지문. 같은 테스트 데이터로 master와 이 브랜치에서 각각 돌려
   화면마다 그려진 HTML이 똑같은지 본다(테스트 로그인 뒤, 콘솔에서).
     const r = await import('…/scripts/refactor/render-hash.mjs'); await r.run()
   날짜·시각처럼 매번 바뀌는 값이 없는 화면만 견주므로, 다르면 진짜로 다르게 그린 것이다. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = async (s) => {
  /* 새로 만든 연락처 id(지금 시각 기준)와 저장 시각은 돌릴 때마다 달라 빼고 센다 */
  s = s.replace(/\d{13,}/g, '#ID').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '#TS');
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 6).map((x) => x.toString(16).padStart(2, '0')).join('');
};
const VIEWS = [
  ['conf', 'setConfView', ['dash', 'pga', 'program', 'people', 'watch']],
  ['exh', 'setExhView', ['dash', 'list', 'booth', 'equip', 'graphic', 'money', 'book', 'onsite', 'watch']],
];
export async function run() {
  const out = {};
  for (const [app, fn, views] of VIEWS) {
    window.switchApp(app);
    await wait(200);
    for (const v of views) {
      window[fn](v);
      await wait(200);
      const el = document.getElementById('page-' + app);
      out[`${app}:${v}`] = el ? await hash(el.innerHTML) : null;
    }
  }
  for (const app of ['mdb', 'co', 'evdb', 'crm', 'ptn', 'audit']) {
    window.switchApp(app);
    await wait(250);
    const el = document.getElementById('page-' + app);
    out[app] = el ? await hash(el.innerHTML) : null;
  }
  return out;
}
