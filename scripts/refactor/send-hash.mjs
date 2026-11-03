/* 리팩토링 안전망 — 일괄 메일 «보내기» 지문 (파트 H3).
   mock-copy.js로 만든 사본(메일 발송만 가짜)에서, 테스트 로그인 뒤 콘솔로:
     const r = await import('/<사본>/scripts/refactor/send-hash.mjs'); await r.run('/<사본>')
   가짜 발송: 네 통째마다 실패, 다섯 통째마다 «나갔지만 기록 id 없음». 순서가 같으면 결과도 같다.
   참가사·연사 각각
   - 모두 고르고 보내기 → 실패한 곳만 다시 보내기
   - 다시 보내기 묶음을 열고 모두에게 보내기 → 실패한 곳 다시 보내기(묶음이 저절로 닫히는지)
   를 하고, confirm·alert 문구, 창 아래 알림 줄, 새로 생긴 기록, 보낸 내용(받는 사람·제목·종류), 창 HTML을 센다. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s)
  .replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+Z?)?/g, '#T')
  .replace(/R-[a-z0-9]{6,}/g, '#R').replace(/nolog-\d+-\d+/g, '#NOLOG').replace(/\d{13,}/g, '#ID')
  .replace(/\/(master|branch)\//g, '/');
const hash = async (s) => {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm(s)));
  return [...new Uint8Array(b)].slice(0, 6).map((x) => x.toString(16).padStart(2, '0')).join('');
};
const body = () => { const c = document.body.cloneNode(true); c.querySelectorAll('#um-since,#last-sync-time').forEach((e) => { e.textContent = ''; }); return c.innerHTML; };

export async function run(base) {
  const st = await import(base + '/js/state.js');
  const sent = [];
  let n = 0;
  let stopAfter = 0, stopFn = null;   // 멈춤 시험 — 이 단계에서 stopAfter통째를 보낸 뒤 창 닫기(멈춤)를 누른다
  window.__mockSend = async (p) => {
    n++;
    if (stopFn && --stopAfter === 0) { const f = stopFn; stopFn = null; f(); }   // 바로 누른다 — 쉬는 시간이 0이라 타이머로 미루면 다 보낸 뒤에야 돈다
    sent.push({ to: p.to, cc: p.cc, subject: p.subject, kind: p.kind, category: p.category, ex: p.exhibitor_id, sp: p.speaker_id, files: p.file_ids });
    if (n % 4 === 3) return { ok: false, error: '시험 실패' };
    if (n % 5 === 0) return { ok: true };
    return { ok: true, logId: `L-mock-${n}` };
  };
  const said = [];
  const orig = { alert: window.alert, prompt: window.prompt, confirm: window.confirm };
  window.alert = (m) => { said.push('A ' + m); };
  window.prompt = (m, d) => { said.push('P ' + m); return '개정판 시험'; };
  window.confirm = (m) => { said.push('C ' + m); return true; };
  const out = {}, errors = [];
  const step = async (k, msgId, logs, fn) => {
    said.length = 0; sent.length = 0;
    const before = logs.length;
    try { await fn(); } catch (e) { errors.push(`${k}: ${e.message}`); }
    await wait(200);
    const msg = document.getElementById(msgId)?.textContent || '';
    const rec = { said: said.slice(), msg, logs: logs.slice(before), sent: sent.slice() };
    out[k] = await hash(JSON.stringify(rec) + body());
    out[k + ':text'] = norm(`${said.join(' / ')} || ${msg} || 기록 ${rec.logs.length} · 보냄 ${rec.sent.length}`);
  };
  try {
    window.switchApp('exh'); await wait(300);
    await window.openExhBulkMail(); await wait(200);
    const L = st.EXH_LOGS;
    await step('exh:all', 'bm-msg', L, async () => { window.bmAll(true); await window.sendExhBulkMail(); });
    await step('exh:failed', 'bm-msg', L, async () => { window.bmAll('failed'); await window.sendExhBulkMail(); });
    await step('exh:round-open', 'bm-msg', L, async () => { await window.startExhRound(); });
    await step('exh:round-send', 'bm-msg', L, async () => { window.bmAll(true); await window.sendExhBulkMail(); });
    await step('exh:round-failed', 'bm-msg', L, async () => { window.bmAll('failed'); await window.sendExhBulkMail(); });
    await step('exh:round-failed2', 'bm-msg', L, async () => { window.bmAll('failed'); await window.sendExhBulkMail(); });
    await step('exh:stop', 'bm-msg', L, async () => { window.bmAll(true); stopAfter = 2; stopFn = () => window.closeExhBulkMail(); await window.sendExhBulkMail(); });

    window.switchApp('conf'); await wait(300);
    const spEv = st.SPEAKERS.find((x) => x)?.event_id;
    /* 시험 연사에는 메일 주소가 없다 — 화면 안에서만 연사 본인(마스터DB 연락처) 메일을 채운다. 양쪽에 똑같이 */
    const sps = st.SPEAKERS.filter((sp) => sp.event_id === spEv);
    sps.forEach((sp, i) => {
      let c = sp.contact_id ? st.contacts.find((x) => String(x.id) === String(sp.contact_id)) : null;
      if (!c) { c = { id: 9000000000000 + i, name: sp.name || `연사${i}` }; st.contacts.push(c); sp.contact_id = c.id; }
      if (!String(c.email1 || '').trim()) c.email1 = `sp${i}@bloom.test`;
    });
    /* «모두 고르기» 단추가 없다(sbmAll은 due·failed만) — 하나씩 고른다 */
    const pickAll = () => { window.sbmAll(false); sps.forEach((sp) => window.sbmPick(sp.id, true)); };
    await window.openSpeakerBulkMail(spEv); await wait(200);
    const S = st.SPEAKER_LOGS;
    await step('sp:all', 'sbm-msg', S, async () => { pickAll(); await window.sendSpBulkMail(); });
    await step('sp:failed', 'sbm-msg', S, async () => { window.sbmAll('failed'); await window.sendSpBulkMail(); });
    await step('sp:round-open', 'sbm-msg', S, async () => { await window.startSpRound(); });
    await step('sp:round-send', 'sbm-msg', S, async () => { pickAll(); await window.sendSpBulkMail(); });
    await step('sp:round-failed', 'sbm-msg', S, async () => { window.sbmAll('failed'); await window.sendSpBulkMail(); });
    await step('sp:round-failed2', 'sbm-msg', S, async () => { window.sbmAll('failed'); await window.sendSpBulkMail(); });
    await step('sp:stop', 'sbm-msg', S, async () => { pickAll(); stopAfter = 2; stopFn = () => window.closeSpBulkMail(); await window.sendSpBulkMail(); });
  } finally {
    Object.assign(window, orig);
  }
  return { out, errors };
}
