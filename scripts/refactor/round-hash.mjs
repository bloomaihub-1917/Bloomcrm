/* 리팩토링 안전망 — 일괄 메일 «다시 보내기 묶음» 지문 (파트 H2).
   테스트 로그인 뒤 콘솔에서: const r = await import('<도구 경로>/round-hash.mjs'); await r.run('<앱 경로>')
   참가사·연사 일괄 메일 창을 열고 단계마다 묶음 열기 → 닫기를 해 본다.
   prompt·confirm은 저절로 답하고(묶음 이름 «개정판 시험», 닫기 «예»), alert·prompt·confirm 문구와
   창 HTML, 저장된 묶음 목록을 센다. 시각(묶음 시작 시각·id)은 빼고 센다. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s)
  .replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+Z?)?/g, '#T')
  .replace(/R-[a-z0-9]{6,}/g, '#R').replace(/\d{13,}/g, '#ID')
  .replace(/\.claude\/worktrees\/refactor\//g, '');
const hash = async (s) => {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm(s)));
  return [...new Uint8Array(b)].slice(0, 6).map((x) => x.toString(16).padStart(2, '0')).join('');
};
const body = () => { const c = document.body.cloneNode(true); c.querySelectorAll('#um-since,#last-sync-time').forEach((e) => { e.textContent = ''; }); return c.innerHTML; };

export async function run(base) {
  const st = await import(base + '/js/state.js');
  const { exhMailSteps } = await import(base + '/js/modules/exh-mail.js');
  const { flowSteps } = await import(base + '/js/modules/speaker-flow.js');
  const said = [];
  const orig = { alert: window.alert, prompt: window.prompt, confirm: window.confirm };
  window.alert = (m) => { said.push('A ' + m); };
  window.prompt = (m, d) => { said.push('P ' + m + ' | ' + d); return '개정판 시험'; };
  window.confirm = (m) => { said.push('C ' + m); return true; };
  const out = {}, errors = [];
  const step = async (k, fn) => {
    said.length = 0;
    try { await fn(); } catch (e) { errors.push(`${k}: ${e.message}`); }
    await wait(150);
    out[k] = await hash(body() + '\n' + said.join('\n'));
    out[k + ':said'] = norm(said.join(' / '));
  };
  try {
    window.switchApp('exh'); await wait(300);
    await window.openExhBulkMail(); await wait(200);
    const exEv = st.EXHIBITORS.find((x) => x)?.event_id;
    for (const s of exhMailSteps(exEv)) {
      await step(`exh:${s.key}:open`, () => window.bmSet('step', s.key));
      await step(`exh:${s.key}:start`, () => window.startExhRound());
      await step(`exh:${s.key}:close`, () => window.closeExhRound());
    }
    out['exh:rounds'] = norm(JSON.stringify((st.EXH_CFG[exEv] || {}).exhMailRounds || null));
    window.switchApp('conf'); await wait(300);
    const spEv = st.SPEAKERS.find((x) => x)?.event_id;
    await window.openSpeakerBulkMail(spEv); await wait(200);
    for (const s of flowSteps(spEv)) {
      await step(`sp:${s.key}:open`, () => window.sbmSet('step', s.key));
      await step(`sp:${s.key}:start`, () => window.startSpRound());
      await step(`sp:${s.key}:close`, () => window.closeSpRound());
    }
    out['sp:rounds'] = norm(JSON.stringify(((st.EXH_CFG[spEv] || {}).conf || {}).mailRounds || null));
  } finally {
    Object.assign(window, orig);
  }
  return { out, errors };
}
