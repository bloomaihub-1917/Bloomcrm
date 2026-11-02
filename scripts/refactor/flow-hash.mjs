/* 리팩토링 안전망 ⑤ — 창 열기 순서 지문. 연락처 상세 창·고치기·직접 추가, 기업 상세·참여 이력 추가,
   전시·연사 상세 창을 같은 순서로 열어 그때마다 화면 전체 HTML을 해시한다.
   새로 로그인한 직후 master와 이 브랜치에서 각각 돌려 같은지 본다. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/* 로그인 시각(사용자 메뉴)은 매번 다르니 빼고 센다. 다른 점검(smoke 등)을 먼저 돌리면 거르개·하위 탭 상태가
   남아 달라지므로, 이 점검은 새로 로그인한 직후 맨 먼저 돌린다 */
const h = async () => {
  const html = document.body.innerHTML.replace(/<div class="user-menu-since" id="um-since">[^<]*<\/div>/, '');
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
  return [...new Uint8Array(b)].slice(0, 6).map((x) => x.toString(16).padStart(2, '0')).join('');
};
export async function run(base) {
  const st = await import(base + '/js/state.js');
  const out = {}; const errors = [];
  const step = async (name, fn) => { try { await fn(); await wait(200); out[name] = await h(); } catch (e) { errors.push(`${name}: ${e.message}`); } };
  const c = st.contacts.find((x) => st.participations.some((p) => p.contactId === x.id)) || st.contacts[0];
  window.switchApp('mdb'); await wait(200);
  await step('contactDr', () => window.openContactDr(c.id));
  await step('contactEdit', () => window.startContactEdit());
  await step('contactEditCancel', () => window.cancelContactEdit());
  await step('addEv', () => window.openAddEvModal());
  await step('addEvClose', () => window.closeAddEvModal());
  await step('leave', () => window.openLeaveModal(c.id));
  await step('leaveClose', () => window.closeLeaveModal());
  window.closeContactDr(); await wait(100);
  await step('addContact', () => window.openAddContactModal());
  await step('addContactClose', () => window.closeAddContactModal());
  window.switchApp('co'); await wait(200);
  const co = st.CO_DB.find((x) => (x.events || []).length) || st.CO_DB[0];
  await step('coDetail', () => window.selectCo(co.key));
  await step('addCoEv', () => window.openAddCoEventModal(co.key));
  document.querySelectorAll('.modal-bg, .mo, [id$="-modal"]').forEach(() => {});
  window.switchApp('arch'); await wait(100);
  await step('archOrg', () => window.switchArchTab('org'));
  await step('similar', () => window.renderSimilarCompanyList?.());
  return { out, errors };
}
