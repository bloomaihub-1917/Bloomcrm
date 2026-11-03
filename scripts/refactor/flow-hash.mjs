/* 리팩토링 안전망 ⑤ — 창 열기 순서 지문. 연락처 상세 창·고치기·직접 추가, 기업 상세·참여 이력 추가,
   전시·연사 상세 창을 같은 순서로 열어 그때마다 화면 전체 HTML을 해시한다.
   새로 로그인한 직후 master와 이 브랜치에서 각각 돌려 같은지 본다. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/* 로그인 시각(사용자 메뉴)은 매번 다르니 빼고 센다. 다른 점검(smoke 등)을 먼저 돌리면 거르개·하위 탭 상태가
   남아 달라지므로, 이 점검은 새로 로그인한 직후 맨 먼저 돌린다 */
const h = async () => {
  const html = document.body.innerHTML
    .replace(/<div class="user-menu-since" id="um-since">[^<]*<\/div>/, '')
    .replace(/<span id="last-sync-time">[^<]*<\/span>/, '')    // «마지막 동기화» 시각 — 두 화면 사이에 분이 넘어가면 달라진다
    /* 새로 만든 연락처 id는 지금 시각(ms×1000)으로 정해져(CLAUDE.md) 돌릴 때마다 다르다. 저장 시각도 같다 */
    .replace(/\d{13,}/g, '#ID')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '#TS');
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
  return [...new Uint8Array(b)].slice(0, 6).map((x) => x.toString(16).padStart(2, '0')).join('');
};
/* 업로드 — 브라우저에서 엑셀을 만들어 실제로 올린다: 파일 읽기 → 머리글·컬럼 맞추기 → 검증·저장(테스트 모드라
   서버로는 안 가고 화면 상태만 바뀐다) → 처음으로. 하위 탭(로그·병합)과 연결 행사 직접 입력도 연다.
   두 화면에서 같은 파일을 쓰도록 내용은 고정이다 */
export async function runUpload() {
  const out = {}; const errors = [];
  const step = async (name, fn, ms = 250) => { try { await fn(); await wait(ms); out[name] = await h(); } catch (e) { errors.push(`${name}: ${e.message}`); } };
  window.switchApp('up'); await wait(250);
  const XLSX = window.XLSX;
  const rows = [
    ['이름', '영문 이름', '소속', '직함', '이메일', '전화', '국가', '구분'],
    ['김시험', 'Siheom Kim', '시험바이오', '팀장', 'kim.test@example.com', '010-0000-0001', '대한민국', '연사'],
    ['Jane Probe', 'Jane Probe', 'Probe Labs Inc.', 'Director', 'jane.probe@example.com', '+1-555-0100', 'USA', 'VIP'],
    ['박검증', '', '(주)검증메디칼', '연구원', 'park.check@example.com', '', '', '일반'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const file = new File([buf], '시험_참가자명단.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  await step('evInputOn', () => window.toggleEvInput(true));
  await step('evInputOff', () => window.toggleEvInput(false));
  const sel = document.getElementById('up-ev');
  if (sel && sel.options.length > 1) sel.value = sel.options[1].value;
  await step('read', () => window.handleFileSelect({ target: { files: [file] } }), 1500);
  await step('confirm', () => window.confirmImport(), 1200);
  await step('reset', () => window.resetUpload());
  for (const v of ['log', 'merge', 'upload']) await step('uv-' + v, () => window.switchUV(v, null));
  return { out, errors };
}

/* 설정 — 하위 탭 전부, 행사 상세(앞 두 행사 × 화면에 보이는 모든 세그먼트), 비품 목록의 종류·범위·행사 바꾸기 */
export async function runSettings(base) {
  const st = await import(base + '/js/state.js');
  const out = {}; const errors = [];
  const step = async (name, fn, ms = 200) => { try { await fn(); await wait(ms); out[name] = await h(); } catch (e) { errors.push(`${name}: ${e.message}`); } };
  const clicks = (re) => [...new Set([...document.querySelectorAll('[onclick]')].map((b) => b.getAttribute('onclick')).filter((oc) => re.test(oc)))];
  window.switchApp('arch'); await wait(200);
  for (const k of ['ev', 'org', 'people', 'common', 'equip', 'clean', 'ai', 'sys']) await step('arch-' + k, () => window.switchArchTab(k));
  for (const ev of st.EVENT_LIST.slice(0, 2)) {
    window.switchArchTab('ev'); await wait(150);
    await step('ev-' + ev.key, () => window.openEvDetail(ev.key));
    for (const oc of clicks(/^setEvDetailSeg\(/)) await step(`ev-${ev.key}-${oc}`, () => new Function(oc)());
  }
  window.closeEvDetail?.(); await wait(100);
  await step('equip', () => window.switchArchTab('equip'));
  for (const oc of clicks(/^(setEqKind|setEquipScope|setEqEvent|setEqCatFil)\(/).slice(0, 12)) await step('eq-' + oc, () => new Function(oc)());
  await step('org-again', () => window.switchArchTab('org'));
  return { out, errors };
}

/* 전시 — 목록·일괄 메일·참가기업 상세 창(앞 3곳의 모든 하위 탭)·대시보드 */
export async function runExh(base) {
  const st = await import(base + '/js/state.js');
  const out = {}; const errors = [];
  const step = async (name, fn) => { try { await fn(); await wait(200); out[name] = await h(); } catch (e) { errors.push(`${name}: ${e.message}`); } };
  window.switchApp('exh'); await wait(200);
  await step('list', () => window.setExhView('list'));
  await step('bulk', () => window.openExhBulkMail());
  await step('bulkClose', () => window.closeExhBulkMail());
  for (const x of st.EXHIBITORS.slice(0, 3)) {
    await step('dr' + x.id, () => window.openExhDr(x.id));
    const tabs = [...new Set([...document.querySelectorAll('[onclick*="switchExhDT("]')].map((b) => b.getAttribute('onclick')))];
    for (const [k, oc] of tabs.entries()) await step(`dr${x.id}t${k}`, () => new Function(oc)());
    window.closeExhDr(); await wait(100);
  }
  await step('dash', () => window.setExhView('dash'));
  return { out, errors };
}

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
