/* 리팩토링 안전망 ② — 테스트 로그인한 화면에서 모든 탭을 한 번씩 열어 본다.

   쓰는 법(브라우저 콘솔, 테스트 로그인 test/test/test 뒤):
     const s = await import('/<앱 경로>/scripts/refactor/smoke.mjs'); await s.run()

   돌려주는 것
   - errors: 탭을 여는 동안 난 에러(던져진 것 + console.error)
   - fns:    window에 걸린 함수 이름(정렬). 인라인 onclick이 이 이름으로 부르므로
             리팩토링 전 목록(window-baseline.json)과 견줘 하나라도 빠지면 화면이 깨진 것이다
   테스트 로그인은 서버 주소를 비워 두므로 여기서 무엇을 눌러도 운영 데이터에 닿지 않는다. */
const TABS = ['mdb', 'co', 'evdb', 'crm', 'ptn', 'exh', 'conf', 'audit', 'arch', 'up'];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run({ baseline } = {}) {
  if (!baseline) {
    try { baseline = await (await fetch(new URL('./window-baseline.json', import.meta.url))).json(); } catch (e) { baseline = null; }
  }
  const errors = [];
  const onErr = (e) => errors.push(`[throw] ${e.message || e.reason?.message || e.reason}`);
  const origErr = console.error;
  console.error = (...a) => { errors.push('[console] ' + a.map(String).join(' ')); origErr.apply(console, a); };
  window.addEventListener('error', onErr);
  window.addEventListener('unhandledrejection', onErr);
  const opened = [];
  try {
    for (const t of TABS) {
      try { window.switchApp(t); opened.push(t); } catch (e) { errors.push(`[${t}] ${e.message}`); }
      await wait(250);
    }
    /* 설정 탭은 하위 탭(행사·기업·사람·공통·비품·정리·AI·시스템·업로드)마다 그리는 코드가 다르다 */
    window.switchApp('arch');
    for (const b of document.querySelectorAll('[id^="arch-tab-"]')) {
      const k = b.id.replace('arch-tab-', '');
      try { window.switchArchTab(k); opened.push('arch:' + k); } catch (e) { errors.push(`[arch:${k}] ${e.message}`); }
      await wait(150);
    }
    window.switchApp('mdb');
    await wait(100);
  } finally {
    console.error = origErr;
    window.removeEventListener('error', onErr);
    window.removeEventListener('unhandledrejection', onErr);
  }
  const fns = Object.keys(window).filter((k) => typeof window[k] === 'function').sort();
  const out = { opened, errors, fnCount: fns.length, fns };
  if (baseline) {
    const now = new Set(fns);
    out.missing = baseline.filter((f) => !now.has(f));
  }
  return out;
}
