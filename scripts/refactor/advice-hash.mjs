/* 리팩토링 안전망 — ✨ 상황 물어보기 칸 지문 (파트 H4).
   mock-copy.js로 만든 사본(AI 답만 가짜)에서, 테스트 로그인 뒤 콘솔로:
     const r = await import('/<사본>/scripts/refactor/advice-hash.mjs'); await r.run('/<사본>')
   참가사·연사 상세 창마다 빈 칸 → 생각 중 → 답(모든 단추 종류 + 모르는 종류) → 기록에 남기기 → 닫기 → 오류를
   차례로 만들고, 칸 HTML과 alert 문구를 센다. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = async (s) => {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s).replace(/\/(master|branch)\//g, '/')));
  return [...new Uint8Array(b)].slice(0, 6).map((x) => x.toString(16).padStart(2, '0')).join('');
};
const ACTS = ['mail', 'tab', 'mailedit', 'bulk', 'undo', 'editflow', 'zzz'];
const ANS = { ok: true, summary: '요약 <b>&</b>', caution: '조심 "따옴표"', todo: ACTS.map((a, i) => ({ text: `할 일 ${i} <i>`, action: a, arg: `arg'${i}"` })) };

export async function run(base) {
  const st = await import(base + '/js/state.js');
  const said = [];
  const orig = { alert: window.alert, confirm: window.confirm };
  window.alert = (m) => { said.push('A ' + m); };
  window.confirm = (m) => { said.push('C ' + m); return true; };
  const out = {}, errors = [];
  const snap = async (k, id) => {
    await wait(150);
    const el = document.getElementById(id)?.parentElement?.parentElement;
    const html = (el ? el.outerHTML : '(없음)') + ' || ' + said.join(' / ');
    said.length = 0;
    out[k] = await hash(html);
    out[k + ':len'] = html.length;
  };
  const side = async (p, id, input, ask, save, clear, open) => {
    try {
      await open(); await snap(p + ':empty', id);
      let release;
      window.__mockAi = () => new Promise((r) => { release = () => r(ANS); });
      document.getElementById(id).value = '질문 <x> "y"';
      const pending = window[ask]();
      await snap(p + ':loading', id);
      release(); await pending; await snap(p + ':answer', id);
      await window[save](); await snap(p + ':saved', id);
      window[clear](); await snap(p + ':cleared', id);
      window.__mockAi = async () => ({ ok: false, error: '시험 오류 <e>' });
      document.getElementById(id).value = '다시';
      await window[ask](); await snap(p + ':error', id);
    } catch (e) { errors.push(`${p}: ${e.message}`); }
  };
  try {
    window.switchApp('exh'); await wait(300);
    const x = st.EXHIBITORS[0];
    await side('exh', 'exh-advice-q', null, 'askExhAdvice', 'saveExhAdvice', 'clearExhAdvice', async () => { window.openExhDr(x.id); });
    window.closeExhDr?.();
    window.switchApp('conf'); await wait(300);
    const sp = st.SPEAKERS[0];
    await side('sp', 'sp-advice-q', null, 'askSpAdvice', 'saveSpAdvice', 'clearSpAdvice', async () => {
      window.openSpeakerDr(sp.id); await wait(200);
      if (!document.getElementById('sp-advice-q')) window.toggleSpFlow();
    });
  } finally {
    Object.assign(window, orig); delete window.__mockAi;
  }
  return { out, errors };
}
