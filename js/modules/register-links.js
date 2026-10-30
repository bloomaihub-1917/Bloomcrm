/* ══════════════════════════════════════════════════════════════
   register-links.js — 바깥 등록 링크·엑셀 명단 창 (행사 화면 «🔗 등록 링크»)

   링크 하나 = 이 행사 + 참가 유형 하나. 셀러용·바이어용을 따로 만들어 보낸다.
   엑셀 양식을 내려받아 채워 올려도 된다(주최사가 명단을 모아 줄 때).

   링크로 온 신청도, 엑셀로 올린 줄도 마스터DB에 바로 가지 않는다 — 이 창의
   «신청 대기»에 쌓였다가 «확정»을 누르면 그때 연락처를 만들고(같은 이메일이면 그 사람에
   붙여 빈 칸만 채운다) 이 행사 참가 확정으로 넣는다. «버리기»는 마스터DB에 남지 않는다.
   서버는 routes/register.js.
══════════════════════════════════════════════════════════════ */
import { PART_TYPES, contacts, participations } from '../state.js';
import {
  loadRegisterLinks, createRegisterLink, setRegisterLink, importRegisterRows, decideRegisterSub, shareUrl,
} from '../api.js';
import { escapeHtml, escAttr } from '../utils.js';
import { trackAction } from './audit-tab.js';

/* 양식의 열 — 서버 FIELDS와 같은 순서·이름. 머리줄 글자로 칸을 찾는다(국문·영문 둘 다 받는다) */
const COLS = [
  { k: 'name',    ko: '이름*',          en: 'Name' },
  { k: 'org',     ko: '소속*',          en: 'Organization' },
  { k: 'title',   ko: '직함',           en: 'Job title' },
  { k: 'email',   ko: '이메일*',        en: 'Email' },
  { k: 'phone',   ko: '전화',           en: 'Phone' },
  { k: 'country', ko: '국가',           en: 'Country' },
  { k: 'memo',    ko: '관심 분야·요청 사항', en: 'Interests / requests' },
];
const norm = (s) => String(s || '').replace(/[\s*()·/]/g, '').toLowerCase();

let openEv = '';
let links = [];
let subs = [];

/* ── 신청 대기 — 행사 참여자 목록(event-tab.js)도 같은 것을 «타겟» 줄로 보여 준다.
   마스터DB에는 없는 사람이라 목록이 따로 받아 둔다. 확정은 어느 쪽에서 눌러도 acceptPending 하나로 */
const pending = new Map();   // evKey → 신청 줄 배열
const listeners = new Set();
export const pendingFor = (evKey) => pending.get(evKey) || [];
export const onPendingChange = (fn) => listeners.add(fn);
const changed = (evKey) => listeners.forEach(fn => { try { fn(evKey); } catch(e){ console.warn(e); } });
const loading = new Map();
export function fetchPending(evKey, force){
  if(!force && (pending.has(evKey) || loading.has(evKey))) return loading.get(evKey) || Promise.resolve(pendingFor(evKey));
  const job = loadRegisterLinks(evKey).then(r => {
    loading.delete(evKey);
    if(r.ok){ pending.set(evKey, r.submissions || []); changed(evKey); if(evKey === openEv){ links = r.links || []; subs = pendingFor(evKey); } }
    return pendingFor(evKey);
  });
  loading.set(evKey, job);
  return job;
}

/* 확정 → 서버가 연락처·참가 확정을 만들고, 그 결과를 이 화면의 contacts·participations에 그대로 넣는다 */
export async function acceptPending(evKey, id){
  const r = await decideRegisterSub(id, 'accept');
  if(!r.ok) return r;
  const cid = +r.contactId, d = r.data || {};
  const ko = /[가-힣]/.test(d.name || ''), orgKo = /[가-힣]/.test(d.org || ''), tKo = /[가-힣]/.test(d.title || '');
  if(!contacts.some(c => c.id === cid)) contacts.push({
    id: cid, nameKo: ko ? d.name : '', nameEn: ko ? '' : d.name, orgKo: orgKo ? d.org : '', orgEn: orgKo ? '' : d.org,
    titleKo: tKo ? d.title : '', titleEn: tKo ? '' : d.title, deptKo: '', deptEn: '',
    country: d.country || '', cat: 'attendee', lang: ko ? 'ko' : 'en', source: r.source || '',
    date: (r.confirmedAt || '').slice(0, 10), status: 'new', email1: d.email || '', email2: '',
    phone1: d.phone || '', phone2: '', beat: '', products: '', tags: '',
  });
  const old = r.existingPart && participations.find(p => p.id === r.partId);
  if(old) old.confirmedAt = old.confirmedAt || r.confirmedAt;
  else participations.push({ id: r.partId, eventId: evKey, event: evKey, contactId: cid, contact: '',
    role: r.role, note: r.note || '', matched: r.matched || '', confirmedAt: r.confirmedAt });
  pending.set(evKey, pendingFor(evKey).filter(x => x.id !== id));
  if(evKey === openEv) subs = pendingFor(evKey);
  changed(evKey);
  return r;
}

export async function openRegisterLinks(evKey){
  openEv = evKey;
  let el = document.getElementById('reg-links');
  if(!el){
    el = document.createElement('div');
    el.id = 'reg-links';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1100;display:flex;align-items:center;justify-content:center;padding:12px';
    el.addEventListener('click', (e) => { if(e.target === el) el.remove(); });
    document.body.appendChild(el);
  }
  el.innerHTML = `<div style="background:var(--W);border-radius:12px;width:min(720px,100%);max-height:94vh;overflow:auto">
    <div style="padding:12px 16px;border-bottom:1px solid var(--i6);display:flex;align-items:center;gap:8px">
      <div style="font-size:14px;font-weight:700">🔗 등록 링크 · 엑셀 명단</div>
      <button class="drcls" style="margin-left:auto" onclick="document.getElementById('reg-links').remove()">✕</button></div>
    <div id="reg-links-bd" style="padding:14px 16px 18px;font-size:12px;color:var(--i4)">불러오는 중…</div></div>`;
  await reload();
}

async function reload(){
  const r = await loadRegisterLinks(openEv);
  const bd = document.getElementById('reg-links-bd');
  if(!r.ok){ if(bd) bd.innerHTML = `<span style="color:var(--re)">${escapeHtml(r.error || '불러오지 못했어요')}</span>`; return; }
  links = r.links || [];
  subs = r.submissions || [];
  pending.set(openEv, subs);
  changed(openEv);
  render();
}

function linkRow(l){
  const url = l.path ? shareUrl(l.path) : '';
  return `<div style="border:1px solid var(--i6);border-radius:9px;padding:10px 12px;margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span class="pill p-blue" style="font-size:10px">${escapeHtml(l.role)}</span>
      <div style="font-size:12.5px;font-weight:700;color:var(--i1)">${escapeHtml(l.title || '(제목 없음)')}</div>
      <span class="pill ${l.enabled ? 'p-green' : 'p-gray'}" style="font-size:10px">${l.enabled ? '받는 중' : '닫힘'}</span>
      <button class="btn" style="margin-left:auto;font-size:11px" onclick="toggleRegisterLink('${escAttr(l.token)}',${!l.enabled})">${l.enabled ? '닫기' : '다시 열기'}</button>
    </div>
    ${l.enabled && url ? `<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
      <input class="fi" readonly value="${escapeHtml(url)}" style="flex:1;min-width:0;font-size:11.5px" onclick="this.select()">
      <button class="btn" style="font-size:11px" onclick="copyRegisterLink('${escAttr(url)}',this)">복사</button>
      <a class="btn" style="font-size:11px" href="${escapeHtml(url)}" target="_blank" rel="noopener">열기</a></div>` : ''}
    <div style="font-size:11px;color:var(--i4)">신청 ${l.submits}건${l.last_at ? ` · 마지막 ${escapeHtml(l.last_at)}` : ''} · 만든 날 ${escapeHtml(l.created_at)}${l.created_by ? ` · ${escapeHtml(l.created_by)}` : ''}</div>
  </div>`;
}

function subRow(s){
  const d = s.data || {};
  return `<tr>
    <td style="padding:6px 4px"><span class="pill p-blue" style="font-size:10px">${escapeHtml(s.role)}</span></td>
    <td style="padding:6px 4px"><b>${escapeHtml(d.name)}</b>${d.title ? `<div style="color:var(--i4)">${escapeHtml(d.title)}</div>` : ''}</td>
    <td style="padding:6px 4px">${escapeHtml(d.org)}${d.country ? `<div style="color:var(--i4)">${escapeHtml(d.country)}</div>` : ''}</td>
    <td style="padding:6px 4px">${escapeHtml(d.email)}${d.phone ? `<div style="color:var(--i4)">${escapeHtml(d.phone)}</div>` : ''}</td>
    <td style="padding:6px 4px;color:var(--i4)">${s.via === 'excel' ? '📄 엑셀' : '🔗 링크'}<div>${escapeHtml(s.created_at)}</div>${d.memo ? `<div title="${escapeHtml(d.memo)}">💬 메모</div>` : ''}</td>
    <td style="padding:6px 4px;white-space:nowrap;text-align:right">
      <button class="btn bp" style="font-size:10.5px" onclick="decideRegister('${escAttr(s.id)}','accept',this)">확정</button>
      <button class="btn" style="font-size:10.5px;color:var(--re)" onclick="decideRegister('${escAttr(s.id)}','drop',this)">버리기</button></td>
  </tr>`;
}

function render(){
  const bd = document.getElementById('reg-links-bd');
  if(!bd) return;
  bd.style.color = '';
  const opts = PART_TYPES.map(t => `<option value="${escapeHtml(t.key)}">${escapeHtml(t.label || t.key)}</option>`).join('');
  bd.innerHTML = `<div style="font-size:11.5px;color:var(--i4);line-height:1.55;margin-bottom:12px">
      링크로 받은 신청과 엑셀로 올린 명단은 <b>마스터DB에 바로 들어가지 않아요</b>. 참여자 목록에는 «타겟»으로 보이고,
      여기 «확정»이나 참여자 목록의 «참가 확정»을 누르면 그때 마스터DB로 옮겨 참가 확정으로 넣어요. 같은 이메일이 이미 있으면 그 사람에 붙여요.</div>

    <div style="font-size:13px;font-weight:700;color:var(--i1);margin:4px 0 8px;display:flex;align-items:center;gap:8px">
      신청 대기 ${subs.length}건
      ${subs.length > 1 ? `<button class="btn" style="margin-left:auto;font-size:11px" onclick="acceptAllRegister(this)">모두 확정</button>` : ''}</div>
    ${subs.length ? `<div style="overflow-x:auto;margin-bottom:16px"><table style="width:100%;border-collapse:collapse;font-size:11.5px;color:var(--i2)">
      ${subs.map(subRow).join('')}</table></div>`
      : '<div style="font-size:12px;color:var(--i4);margin-bottom:16px">대기 중인 신청이 없어요.</div>'}

    <div style="font-size:13px;font-weight:700;color:var(--i1);margin:4px 0 8px">신청 링크</div>
    ${links.length ? links.map(linkRow).join('') : '<div style="font-size:12px;color:var(--i4);margin-bottom:10px">아직 만든 링크가 없어요.</div>'}

    <div style="border-top:1px solid var(--i6);padding-top:12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <select id="reg-new-role" class="fi" style="font-size:12px;width:auto" title="새 링크·엑셀 명단의 참가 유형">${opts}</select>
      <input id="reg-new-title" class="fi" placeholder="신청서 제목 (예: 바이어 사전 신청)" style="flex:1;min-width:160px;font-size:12px">
      <button class="btn bp" style="font-size:11px" onclick="makeRegisterLink()">새 링크 만들기</button>
    </div>
    <div style="margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <span style="font-size:11.5px;color:var(--i4)">엑셀로 받기 — 위에서 고른 참가 유형으로 들어가요</span>
      <div style="flex:1"></div>
      <button class="btn" style="font-size:11px" onclick="downloadRegisterTemplate()">📥 엑셀 양식 내려받기</button>
      <button class="btn" style="font-size:11px" onclick="document.getElementById('reg-file').click()">📤 엑셀 올리기</button>
      <input type="file" id="reg-file" accept=".xlsx,.xls,.csv" style="display:none" onchange="uploadRegisterExcel(event)">
    </div>
    <div id="reg-upload-msg" style="font-size:11.5px;margin-top:6px"></div>`;
}

export async function makeRegisterLink(){
  const role = document.getElementById('reg-new-role')?.value || '';
  const title = document.getElementById('reg-new-title')?.value.trim() || '';
  const r = await createRegisterLink(openEv, { role, title });
  if(!r.ok){ alert(r.error || '만들지 못했어요'); return; }
  links.push(r.link);
  render();
  trackAction('create', '등록 링크', openEv, `${role}${title ? ` · ${title}` : ''} 링크 만듦`);
}
export async function toggleRegisterLink(token, on){
  const r = await setRegisterLink(token, { enabled: on });
  if(!r.ok){ alert(r.error || '바꾸지 못했어요'); return; }
  links = links.map(l => l.token === token ? r.link : l);
  render();
  trackAction('edit', '등록 링크', openEv, `${r.link.role} 링크 ${on ? '다시 엶' : '닫음'}`);
}
export async function copyRegisterLink(url, btn){
  try { await navigator.clipboard.writeText(url); if(btn){ btn.textContent = '복사됨'; setTimeout(() => { btn.textContent = '복사'; }, 1500); } }
  catch(e){ prompt('링크를 복사하세요', url); }
}

/* 확정·버리기 — 확정한 사람은 마스터DB에 생겼으니, 화면 목록은 새로고침해야 보인다 */
let accepted = 0;
export async function decideRegister(id, act, btn){
  if(act === 'drop' && !confirm('이 신청을 버릴까요? 마스터DB에 남지 않아요.')) return;
  if(btn) btn.disabled = true;
  const s = subs.find(x => x.id === id);
  const r = act === 'accept' ? await acceptPending(openEv, id) : await decideRegisterSub(id, act);
  if(!r.ok){ alert(r.error || '처리하지 못했어요'); if(btn) btn.disabled = false; await reload(); return; }
  if(act === 'drop'){ subs = subs.filter(x => x.id !== id); pending.set(openEv, subs); changed(openEv); }
  if(act === 'accept') accepted++;
  render();
  if(accepted) showMsg(`${accepted}명을 참가 확정해 마스터DB로 옮겼어요.`);
  trackAction(act === 'accept' ? 'create' : 'delete', '등록 신청', openEv,
    `${s?.data?.name || ''} (${s?.data?.org || ''}) ${act === 'accept' ? '확정 → 마스터DB' : '버림'}`);
}
export async function acceptAllRegister(btn){
  if(!confirm(`대기 중인 ${subs.length}건을 모두 확정해 마스터DB로 옮길까요?`)) return;
  if(btn) btn.disabled = true;
  let fail = 0;
  for(const s of subs.slice()){
    const r = await acceptPending(openEv, s.id);
    if(r.ok) accepted++; else fail++;
  }
  await reload();
  showMsg(`${accepted}명을 참가 확정해 마스터DB로 옮겼어요${fail ? ` · ${fail}건은 못 옮겼어요` : ''}.`, !!fail);
  trackAction('create', '등록 신청', openEv, `모두 확정 → 마스터DB${fail ? ` (실패 ${fail})` : ''}`);
}
function showMsg(text, warn){
  const m = document.getElementById('reg-upload-msg');
  if(m){ m.style.color = warn ? 'var(--re)' : 'var(--gr, #15803d)'; m.textContent = text; }
}

/* ── 엑셀 양식 ── */
export function downloadRegisterTemplate(){
  const role = document.getElementById('reg-new-role')?.value || '';
  const ws = XLSX.utils.aoa_to_sheet([
    COLS.map(c => c.ko),
    ['홍길동', '블룸바이오', '팀장', 'gildong@example.com', '010-1234-5678', '대한민국', '(예시 줄 — 지우고 쓰세요)'],
  ]);
  ws['!cols'] = COLS.map(c => ({ wch: c.k === 'memo' ? 36 : c.k === 'email' ? 28 : 16 }));
  const guide = XLSX.utils.aoa_to_sheet([
    ['작성 안내'], [''],
    ['• 한 줄에 한 사람씩 적어 주세요. 머리줄(첫 줄)은 지우거나 바꾸지 마세요.'],
    ['• *표 칸(이름·소속·이메일)은 꼭 채워 주세요. 빠진 줄은 올라가지 않아요.'],
    ['• 영문 머리줄(Name, Organization, Job title, Email, Phone, Country, Interests / requests)도 받아요.'],
    [`• 참가 유형: ${role || '(올릴 때 고른 유형)'}`],
  ]);
  guide['!cols'] = [{ wch: 90 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '명단');
  XLSX.utils.book_append_sheet(wb, guide, '안내');
  XLSX.writeFile(wb, `${openEv}_${role || '참가'}_등록양식.xlsx`);
}

export async function uploadRegisterExcel(e){
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if(!file) return;
  const role = document.getElementById('reg-new-role')?.value || '';
  let rows;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellText: true });
    const ws = wb.Sheets['명단'] || wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    const head = (aoa[0] || []).map(norm);
    const at = {};
    COLS.forEach(c => { const i = head.findIndex(h => h && (h === norm(c.ko) || h === norm(c.en))); if(i >= 0) at[c.k] = i; });
    const missing = ['name', 'org', 'email'].filter(k => !(k in at));
    if(missing.length){
      showMsg(`머리줄에서 ${missing.map(k => COLS.find(c => c.k === k).ko.replace('*', '')).join('·')} 칸을 못 찾았어요 — 내려받은 양식을 써 주세요.`, true);
      return;
    }
    rows = aoa.slice(1).map((r, i) => {
      const o = { line: i + 2 };
      COLS.forEach(c => { o[c.k] = c.k in at ? String(r[at[c.k]] ?? '').trim() : ''; });
      return o;
    }).filter(o => COLS.some(c => o[c.k]) && !/예시 줄/.test(o.memo));
  } catch(err){ showMsg('엑셀을 읽지 못했어요: ' + err.message, true); return; }
  if(!rows.length){ showMsg('올릴 줄이 없어요.', true); return; }
  if(!confirm(`${rows.length}줄을 «${role}»로 신청 대기에 올릴까요? (마스터DB에는 확정할 때 들어가요)`)) return;
  const r = await importRegisterRows(openEv, { role, rows });
  if(!r.ok){ showMsg(r.error || '올리지 못했어요', true); return; }
  await reload();
  showMsg(`${r.added}줄을 신청 대기에 올렸어요${r.bad.length ? ` · ${r.bad.length}줄은 필수 칸이 비었거나 이메일이 틀려 뺐어요(${r.bad.slice(0, 15).join(', ')}${r.bad.length > 15 ? ' …' : ''}행)` : ''}.`, !!r.bad.length);
  trackAction('create', '등록 신청', openEv, `엑셀 ${r.added}줄 올림 (${role})`);
}

window.openRegisterLinks = openRegisterLinks;
window.makeRegisterLink = makeRegisterLink;
window.toggleRegisterLink = toggleRegisterLink;
window.copyRegisterLink = copyRegisterLink;
window.decideRegister = decideRegister;
window.acceptAllRegister = acceptAllRegister;
window.downloadRegisterTemplate = downloadRegisterTemplate;
window.uploadRegisterExcel = uploadRegisterExcel;
