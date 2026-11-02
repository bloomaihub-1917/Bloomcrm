/* 리팩토링 안전망 ③ — 계산 결과 지문. 같은 테스트 데이터로 master 화면과 이 브랜치 화면에서
   각각 돌려 결과가 똑같은지 본다(테스트 로그인 뒤, 콘솔에서).
     const f = await import('<앱 경로>/scripts/refactor/fingerprint.mjs'); await f.run('<앱 경로>')
   앱 경로는 그 화면의 js/가 있는 곳 — 모듈을 그 화면 것으로 읽어야 같은 상태를 본다. */
export async function run(base){
  const st = await import(base + '/js/state.js');
  const tab = await import(base + '/js/modules/exh-tab.js');
  const out = { exh: [], co: [] };
  for (const x of st.EXHIBITORS) {
    const s = tab.settleState(x);
    out.exh.push([x.id, s.billed, s.paid, s.balance, s.cur, s.state, s.due, s.overdue,
      tab.STEPS.map((step) => { const c = tab.cellState(x, step); return c.state + ':' + (c.text || ''); }).join('|'),
      tab.progressOf(x)?.pct ?? JSON.stringify(tab.progressOf(x))]);
  }
  (await import(base + '/js/modules/company-tab.js')).buildCoDB();
  for (const c of st.CO_DB) out.co.push([c.key, c.nameKo, c.nameEn, c.abbr, (c.sectors || []).join('|'), (c.events || []).length, (c.contacts || []).length, JSON.stringify(c.trade || null)]);
  const text = JSON.stringify(out);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return { exhibitors: out.exh.length, companies: out.co.length, hash: [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('') };
}
