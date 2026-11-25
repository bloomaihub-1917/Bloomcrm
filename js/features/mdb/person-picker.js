/* ══════════════════════════════════════════════════════════════
   features/mdb/person-picker.js — «사람 고르기» 창 하나 (2026-11-25)

   파트마다(행사 참가자·파트너링·연사·전시 담당자 …) 사람을 넣는 창이 따로 있었고, 저마다 연락처를
   만들었다. 그래서 같은 사람이 파트마다 한 번씩 생기고, 동명이인은 엉뚱한 사람에 붙었다.
   이제 모든 «추가»가 이 창을 연다 — 순서는 언제나 같다.
     1) 찾기 — 이름·기업·메일·전화. 찾은 사람마다 어느 행사에 왔었는지 보여 줘 동명이인을 가른다
     2) 고르기 — 그 파트가 할 일만 한다(onPick: 참가 기록·연사 줄·전시 담당 배정 …)
     3) 없으면 새로 만들기 — 저장 전에 서버에 같은 사람을 물어보고(«이미 있어요» / «닮은 사람»),
        서버 한 길(api/contacts.js → routes/contacts.js → contactUpserter)로 넣는다. 기업DB 연결까지
   파트가 정하는 것: 제목, 미리 채울 값, 덧붙일 칸(역할 고르기 등), 고를 수 없는 사람(mark), onPick.
══════════════════════════════════════════════════════════════ */
import { contacts, EVENT_LIST, contactEvents } from '../../state.js';
import { escapeHtml, escAttr } from '../../utils.js';
import { matchContacts, upsertContact } from '../../api/contacts.js';
import { normalizeCompanyKey } from '../../domain/org-names.js';

let pk = null;   // { opts, q, mode:'find'|'new', check, busy }
const s = (v) => String(v ?? '').trim();
const evShortOf = (k) => { const e = EVENT_LIST.find((x) => x.key === k); return e ? (e.short || e.name || k) : k; };
const nm = (c) => s(c.nameKo) || s(c.nameEn) || '(이름 없음)';

export function openPersonPicker(opts){
  pk = { opts: { pickLabel: '고르기', ...opts }, q: s(opts.query), mode: 'find', check: null, busy: false, msg: '' };
  closePersonPicker();
  const pop = document.createElement('div');
  pop.id = 'person-picker'; pop.className = 'mw on';
  pop.addEventListener('click', (e) => { if(e.target === pop) closePersonPicker(); });
  document.body.appendChild(pop);
  render();
  setTimeout(() => document.getElementById('pp-q')?.focus(), 30);
}
export function closePersonPicker(){ document.getElementById('person-picker')?.remove(); }

/* 찾기 — 말이 없으면 기업 안 사람(scopeOrg)부터 */
function found(){
  const { scopeOrg } = pk.opts;
  const live = contacts.filter((c) => !s(c.moved_to_id));
  const q = pk.q.toLowerCase(), qd = pk.q.replace(/\D/g, '');
  if(!q){
    if(!scopeOrg) return [];
    const ok = normalizeCompanyKey(scopeOrg.name || '');
    return live.filter((c) => (scopeOrg.org_id && c.org_id === scopeOrg.org_id)
      || (ok && [c.orgKo, c.orgEn].some((o) => normalizeCompanyKey(s(o)) === ok))).slice(0, 40);
  }
  const words = q.split(/\s+/).filter(Boolean);
  return live.filter((c) => {
    const hay = [c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.email1, c.email2, c.titleKo, c.titleEn].map((v) => s(v).toLowerCase()).join(' ');
    if(words.every((w) => hay.includes(w))) return true;
    return qd.length >= 4 && [c.phone1, c.phone2].some((p) => s(p).replace(/\D/g, '').includes(qd));
  }).slice(0, 40);
}

function personRow(c){
  const why = pk.opts.mark?.(c) || '';            // 고를 수 없는 까닭(이미 배정됨 등)
  const tag = !why && (pk.opts.tag?.(c) || '');   // 고를 수는 있고 알려만 줄 것(이미 이 행사 등)
  const evs = contactEvents(c);
  return `<div style="display:flex;gap:10px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--i7);font-size:var(--fs-12)">
    <div style="flex:1;min-width:0">
      <div><b style="color:var(--i1)">${escapeHtml(nm(c))}</b>${s(c.nameKo) && s(c.nameEn) ? ` <span style="color:var(--i4)">${escapeHtml(c.nameEn)}</span>` : ''}
        <span style="color:var(--i3)"> · ${escapeHtml(s(c.orgKo) || s(c.orgEn) || '소속 없음')}</span>${s(c.titleKo) || s(c.titleEn) ? `<span style="color:var(--i4)"> · ${escapeHtml(s(c.titleKo) || s(c.titleEn))}</span>` : ''}</div>
      <div style="color:var(--i4);font-size:var(--fs-11)">${escapeHtml([c.email1, c.phone1].map(s).filter(Boolean).join(' · ') || '메일·전화 없음')}
        ${evs.length ? ` · <span title="${escapeHtml(evs.map(evShortOf).join(', '))}">${escapeHtml(evs.slice(-3).map(evShortOf).join(', '))}${evs.length > 3 ? ` 외 ${evs.length - 3}` : ''}</span>` : ''}</div>
    </div>
    ${tag ? `<span class="pill p-blue" style="flex:0 0 auto">${escapeHtml(tag)}</span>` : ''}
    ${why ? `<span class="pill p-gray" style="flex:0 0 auto">${escapeHtml(why)}</span>`
      : `<button class="btn bp bs" style="flex:0 0 auto" ${pk.busy ? 'disabled' : ''} onclick="personPickerPick(${escAttr(JSON.stringify(String(c.id)))})">${escapeHtml(pk.opts.pickLabel)}</button>`}
  </div>`;
}

const F = [['nameKo', '성명 (국문)', '홍길동'], ['nameEn', '성명 (영문)', 'Gildong Hong'], ['orgKo', '소속 (국문)', '기관·기업'], ['orgEn', '소속 (영문)', 'Company'],
  ['titleKo', '직함 (국문)', '팀장'], ['titleEn', '직함 (영문)', 'Manager'], ['email1', '이메일', 'name@company.com'], ['phone1', '전화', '010-0000-0000']];
function newForm(){
  const p = pk.opts.prefill || {};
  const ck = pk.check;
  const hint = !ck ? '' : ck.contact
    ? `<div style="border:1px solid var(--a);border-radius:8px;padding:10px;margin-top:10px;font-size:var(--fs-12)">
        이미 있는 사람이에요 (${escapeHtml(ck.by)}로 찾음): <b>${escapeHtml(nm(ck.contact))}</b> · ${escapeHtml(s(ck.contact.orgKo) || s(ck.contact.orgEn))} ${escapeHtml(s(ck.contact.email1))}
        <div style="color:var(--i4);font-size:var(--fs-11);margin-top:2px">이 사람으로 고르면 적은 값 중 빈 칸만 채워요.</div>
        <div style="text-align:right;margin-top:6px"><button class="btn bp bs" onclick="personPickerSave(true)">이 사람으로 ${escapeHtml(pk.opts.pickLabel)}</button></div></div>`
    : ck.suspect
    ? `<div style="border:1px solid var(--am);border-radius:8px;padding:10px;margin-top:10px;font-size:var(--fs-12)">
        닮은 사람이 있어요 — ${escapeHtml(ck.why)}: <b>${escapeHtml(nm(ck.suspect))}</b> · ${escapeHtml(s(ck.suspect.orgKo) || s(ck.suspect.orgEn))} ${escapeHtml(s(ck.suspect.email1))}
        <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px">
          <button class="btn bs" onclick="personPickerPick(${escAttr(JSON.stringify(String(ck.suspect.id)))})">그 사람으로</button>
          <button class="btn bp bs" onclick="personPickerSave(true)">다른 사람이에요 — 새로 만들기</button></div></div>` : '';
  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 10px">
      ${F.map(([k, l, ph]) => `<div><div class="mlbl">${l}</div><input class="fi" id="pp-${k}" style="width:100%" placeholder="${ph}" value="${escapeHtml(s(p[k]))}" oninput="personPickerDirty()"></div>`).join('')}</div>
    <div style="font-size:var(--fs-11);color:var(--i4);margin-top:6px">저장하기 전에 같은 사람(메일 → 전화 → 이름+소속)이 있는지 먼저 봐요. 소속은 기업DB에 이어져요.</div>
    ${hint}`;
}

function render(){
  const pop = document.getElementById('person-picker');
  if(!pop || !pk) return;
  const o = pk.opts;
  const list = pk.mode === 'find' ? found() : [];
  /* 덧붙인 칸(역할 고르기 등)은 다시 그려도 고른 값을 지킨다 */
  const kept = [...pop.querySelectorAll('#pp-extra [id]')].map((el) => [el.id, el.value]);
  pop.innerHTML = `<div class="modal" style="max-width:640px">
    <div class="mh"><div style="flex:1;min-width:0"><div class="mt2">${escapeHtml(o.title || '사람 고르기')}</div>
      ${o.sub ? `<div style="font-size:var(--fs-11);color:var(--i4);margin-top:2px">${o.sub}</div>` : ''}</div></div>
    <div class="mb" style="max-height:66vh;overflow:auto">
      ${o.extraHtml ? `<div id="pp-extra" style="margin-bottom:12px">${o.extraHtml}</div>` : ''}
      ${pk.mode === 'find' ? `
        <input class="fi" id="pp-q" style="width:100%" placeholder="이름·기업·메일·전화로 찾기" value="${escapeHtml(pk.q)}" oninput="personPickerSearch(this.value)" autocomplete="off">
        <div id="pp-list" style="margin-top:8px;border:1px solid var(--i6);border-radius:var(--r);max-height:340px;overflow:auto">${listHtml(list)}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:var(--fs-11_5);color:var(--i4)">찾는 사람이 없나요?
          <button class="btn bs" onclick="personPickerNew()">＋ 새로 만들기</button></div>`
      : `<a href="javascript:void(0)" style="font-size:var(--fs-11);color:var(--a)" onclick="personPickerBack()">‹ 찾기로 돌아가기</a>
        <div style="margin-top:8px">${newForm()}</div>`}
      <div id="pp-msg" style="font-size:var(--fs-11_5);color:var(--re);min-height:16px;margin-top:8px">${escapeHtml(pk.msg || '')}</div>
    </div>
    <div class="mf2"><button class="btn" onclick="closePersonPicker()">닫기</button>
      ${pk.mode === 'new' && !(pk.check && (pk.check.contact || pk.check.suspect)) ? `<button class="btn bp" ${pk.busy ? 'disabled' : ''} onclick="personPickerSave(false)">${pk.busy ? '저장 중…' : `만들고 ${escapeHtml(o.pickLabel)}`}</button>` : ''}</div>
  </div>`;
  kept.forEach(([id, v]) => { const el = document.getElementById(id); if(el) el.value = v; });
}
function listHtml(list){
  if(!list.length) return `<div style="padding:14px;font-size:var(--fs-11_5);color:var(--i4)">${pk.q ? '찾는 사람이 없어요 — 아래 «새로 만들기»로 만들어요.'
    : pk.opts.scopeOrg ? `${escapeHtml(pk.opts.scopeOrg.name || '이 기업')}에 마스터DB 사람이 없어요. 찾거나 새로 만들어요.` : '이름·기업·메일·전화를 적으면 찾아요.'}</div>`;
  return (!pk.q && pk.opts.scopeOrg ? `<div style="padding:6px 10px;font-size:var(--fs-10_5);color:var(--i4);background:var(--i8)">${escapeHtml(pk.opts.scopeOrg.name || '')} 사람</div>` : '') + list.map(personRow).join('');
}
export function personPickerSearch(v){
  if(!pk) return;
  pk.q = s(v);
  const box = document.getElementById('pp-list');
  if(box) box.innerHTML = listHtml(found());
}
export function personPickerNew(){
  if(!pk) return;
  /* 찾던 말을 이름 칸에 옮겨 둔다 — 한글이면 국문, 아니면 영문(메일 모양이면 메일) */
  const p = { ...(pk.opts.prefill || {}) };
  if(pk.q){
    if(/@/.test(pk.q)) p.email1 = p.email1 || pk.q;
    else if(/[가-힣]/.test(pk.q)) p.nameKo = p.nameKo || pk.q;
    else if(!/^\d[\d\s-]+$/.test(pk.q)) p.nameEn = p.nameEn || pk.q;
  }
  pk.opts.prefill = p; pk.mode = 'new'; pk.check = null; pk.msg = '';
  render();
  document.getElementById(p.nameKo || p.nameEn ? 'pp-orgKo' : 'pp-nameKo')?.focus();
}
export function personPickerBack(){ if(pk){ pk.mode = 'find'; pk.check = null; pk.msg = ''; render(); } }
export function personPickerDirty(){ if(pk && pk.check){ readForm(); pk.check = null; render(); } }
function readForm(){
  const v = {};
  F.forEach(([k]) => { const x = s(document.getElementById('pp-' + k)?.value); if(x) v[k] = x; });
  pk.opts.prefill = { ...(pk.opts.prefill || {}), ...v };
  F.forEach(([k]) => { if(!v[k]) delete pk.opts.prefill[k]; });
  return v;
}

async function finish(c, extra){
  pk.busy = true; render();
  let r;
  try { r = await pk.opts.onPick(c, extra); }
  catch(e){ r = e.message || '저장하지 못했어요'; }
  if(r === true || r === undefined){ closePersonPicker(); pk = null; return; }
  pk.busy = false; pk.msg = typeof r === 'string' ? r : '저장하지 못했어요'; render();
}
export async function personPickerPick(id){
  if(!pk || pk.busy) return;
  const c = contacts.find((x) => String(x.id) === String(id));
  if(!c) return;
  await finish(c, { created: false, by: '고름' });
}
/* 새로 만들기 — 처음 누르면 같은 사람부터 묻는다. force면 묻지 않고 서버 한 길로 넣는다 */
export async function personPickerSave(force){
  if(!pk || pk.busy) return;
  const v = pk.mode === 'new' && document.getElementById('pp-nameKo') ? readForm() : { ...(pk.opts.prefill || {}) };
  if(!v.nameKo && !v.nameEn){ pk.msg = '성명을 국문이나 영문 중 하나는 적어 주세요.'; render(); return; }
  pk.busy = true; pk.msg = ''; render();
  if(!force){
    const m = await matchContacts([v]);
    if(!m.ok){ pk.busy = false; pk.msg = m.error || '같은 사람을 확인하지 못했어요'; render(); return; }
    const r = m.results[0] || {};
    if(r.contact || r.suspect){ pk.busy = false; pk.check = r; render(); return; }
  }
  const raw = { ...(pk.opts.newDefaults || {}), ...v };
  const u = await upsertContact(raw, { source: pk.opts.source || '화면에서 추가' });
  if(!u.ok || u.error || !u.contact){ pk.busy = false; pk.msg = u.error || '저장하지 못했어요'; render(); return; }
  pk.busy = false;
  await finish(u.contact, { created: !!u.created, by: u.by || '' });
}

Object.assign(window, { closePersonPicker, personPickerSearch, personPickerNew, personPickerBack, personPickerDirty, personPickerPick, personPickerSave });
