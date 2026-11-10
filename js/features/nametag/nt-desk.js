/* ══════════════════════════════════════════════════════════════
   nt-desk.js — 행사 DB › 네임택 탭 (발급 데스크)

   현장 데스크에서: 사람 찾기 → 미리보기(소속·직함은 여기서 고쳐 찍는다) → 인쇄 → 기록.
   bizmatching nametag-package의 NametagDesk를 옮겼다. 다른 점:
   - 명단은 서버에 묻지 않는다. 연사·부스 인원·참가자를 화면이 가진 데이터에서 모은다(nt-people.js)
   - 고쳐 찍은 값은 발급 기록에만 남는다. 마스터DB 연락처는 그대로다
   - 국·영문을 판 기본값(자동·국문·영문)으로 고르고, 한 사람씩 바꿀 수 있다
   - 입장 QR·체크인은 없다(CRM에 입장 체크인이 아직 없다)

   왼쪽 명단은 #evdb-rows라 검색(event-tab.js setEvDbQuery)이 목록만 갈아 끼운다.
═══════════════════════════════════════════════════════════════ */
import { escapeHtml, escAttr } from '../../utils.js';
import { normalizeTemplate, SIZE_PRESETS, LANG_OPTIONS, REISSUE_REASONS, MM_PX } from '../../domain/nametag-layout.js';
import { loadNametag, saveNametagTemplate, issueNametags, voidNametag } from '../../api/nametag.js';
import { ntPeople, cardOf, langOf, SOURCE_LABEL } from './nt-people.js';
import { ntCardHtml } from './nt-card.js';
import { fitNametags } from './nt-fit.js';
import { openPrintWindow, fillPrintWindow } from './nt-print.js';

const nt = {
  ev: '', loaded: '', loading: false, err: '',
  template: normalizeTemplate(null), prints: [],
  filter: 'todo',        // 'todo'(아직 안 받음) | 'done'(받음) | 'all'
  src: '',               // '' | 'speaker' | 'exh' | 'part'
  picked: new Set(), focus: '',
  edits: new Map(),      // person_key → { name, company, job_title, badge, lang }
  walkIn: null,          // 현장 신규 입력 중이면 { name, company, job_title, badge }
  reason: '', busy: false,
};

const rerender = () => window.renderEvDb?.();

function ensureLoaded(evKey){
  if(nt.ev !== evKey){
    Object.assign(nt, { ev: evKey, loaded: '', err: '', template: normalizeTemplate(null), prints: [], focus: '', walkIn: null, reason: '' });
    nt.picked.clear(); nt.edits.clear();
  }
  if(nt.loaded === evKey || nt.loading) return;
  nt.loading = true;
  loadNametag(evKey).then(j => {
    if(nt.ev !== evKey) return;
    nt.template = normalizeTemplate(j.template);
    nt.prints = j.prints || [];
    nt.loaded = evKey;
  }).catch(e => { nt.err = e.message; nt.loaded = evKey; })
    .finally(() => { nt.loading = false; rerender(); });
}

/* 받은 기록 — 무효 아닌 것만 센다 */
function printedMap(){
  const m = new Map();
  nt.prints.forEach(p => {
    if(p.voided_at || !p.person_key) return;
    const v = m.get(p.person_key) || { n: 0, last: '' };
    v.n++; if(p.printed_at > v.last) v.last = p.printed_at;
    m.set(p.person_key, v);
  });
  return m;
}

const kst = (iso) => {
  if(!iso) return '';
  const d = new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString();
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  return d.slice(0, 10) === today ? d.slice(11, 16) : `${d.slice(5, 10).replace('-', '/')} ${d.slice(11, 16)}`;
};

/* 이 사람에게 찍을 값 — 데스크에서 고친 값이 있으면 그것 */
function cardFor(p){
  const e = nt.edits.get(p.key) || {};
  const base = cardOf(p, e.lang || nt.template.lang);
  return { ...base, ...Object.fromEntries(Object.entries(e).filter(([k, v]) => k !== 'lang' && v != null)) };
}

function visible(evKey, query){
  const done = printedMap();
  const q = String(query || '').trim().toLowerCase();
  return ntPeople(evKey).filter(p =>
    (!nt.src || p.source === nt.src)
    && (nt.filter === 'all' || (nt.filter === 'done') === done.has(p.key))
    && (!q || [p.nameKo, p.nameEn, p.orgKo, p.orgEn, p.titleKo, p.badgeKo].some(v => String(v || '').toLowerCase().includes(q))));
}

/* ── 본문 ── */
export function ntPartHtml(ev, query){
  ensureLoaded(ev.key);
  if(!nt.loaded) return `<div class="sec nt-note">네임택 기록을 불러오는 중…</div>`;
  if(nt.err) return `<div class="sec"><div class="nt-warn">네임택 기록을 못 불러왔어요 — ${escapeHtml(nt.err)}
    <button class="btn bs" onclick="ntReload()">다시</button></div></div>`;

  const all = ntPeople(ev.key);
  const done = printedMap();
  const got = all.filter(p => done.has(p.key)).length;
  const live = nt.prints.filter(p => !p.voided_at);
  const re = live.filter(p => p.kind === 'reissue').length;
  const wi = live.filter(p => p.kind === 'walk_in').length;
  const t = nt.template;
  const sizeIdx = SIZE_PRESETS.findIndex(s => s.width_mm === t.width_mm && s.height_mm === t.height_mm);
  const seg = (cur, list, fn) => `<div class="seg">${list.map(([k, l]) =>
    `<button class="seg-b${cur === k ? ' on' : ''}" onclick="${fn}('${k}')">${l}</button>`).join('')}</div>`;

  setTimeout(fitPreview, 0);
  return `<div class="sec stat-grid">
      <div class="stat-card"><div class="n">${all.length}</div><div class="l">네임택 대상</div><div class="s">연사·부스 인원·참가자</div></div>
      <div class="stat-card"><div class="n">${got}</div><div class="l">받음</div><div class="s">${all.length - got}명 남음</div></div>
      <div class="stat-card"><div class="n">${live.length}</div><div class="l">뽑은 장 수</div><div class="s">재발급 ${re} · 현장 신규 ${wi}</div></div>
    </div>
    <div class="sec sec-bar">
      <div class="srch" style="width:100%;max-width:300px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input type="text" id="evdb-q" placeholder="이름·소속 검색…" value="${escAttr(query || '')}" style="width:100%" oninput="setEvDbQuery(this.value)"></div>
      ${seg(nt.filter, [['todo', '안 받음'], ['done', '받음'], ['all', '전체']], 'ntSetFilter')}
      ${seg(nt.src, [['', '모두'], ['speaker', '연사'], ['exh', '부스'], ['part', '참가자']], 'ntSetSrc')}
      <div style="flex:1"></div>
      <select class="fi" style="width:auto" onchange="ntSetPaper(this.value)" title="네임택 용지 크기 — 이 행사 기본 판에 저장돼요">
        ${SIZE_PRESETS.map((s, i) => `<option value="${i}"${i === sizeIdx ? ' selected' : ''}>${s.label}</option>`).join('')}
        ${sizeIdx < 0 ? `<option selected>${t.width_mm} × ${t.height_mm}mm</option>` : ''}</select>
      <select class="fi" style="width:auto" onchange="ntSetTplLang(this.value)" title="국문·영문 중 무엇으로 찍을지 — 사람마다 오른쪽에서 바꿀 수 있어요">
        ${LANG_OPTIONS.map(([k, l]) => `<option value="${k}"${t.lang === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn bs" onclick="ntWalkIn(true)" title="명단에 없는 사람 — 이름·소속만 기록에 남고 마스터DB에는 넣지 않아요">＋ 현장 신규</button>
    </div>
    <div class="sec-rows nt-layout">
      <div id="evdb-rows">${ntRowsHtml(ev.key, query)}</div>
      <div id="nt-side" class="nt-side">${sideHtml(ev.key)}</div>
    </div>`;
}

export function ntRowsHtml(evKey, query){
  const l = visible(evKey, query);
  const done = printedMap();
  if(!l.length) return `<div class="nt-note" style="padding:24px 0">${nt.filter === 'todo' ? '아직 안 받은 사람이 없어요.' : '해당하는 사람이 없어요.'}</div>`;
  const allOn = l.every(p => nt.picked.has(p.key));
  return `<div style="overflow-x:auto"><table class="nt-rows" style="width:100%">
    <thead><tr><th class="ck"><input type="checkbox"${allOn ? ' checked' : ''} onchange="ntPickAll(this.checked)" title="보이는 사람 모두 고르기"></th>
      <th>성명</th><th>소속</th><th>직함</th><th>구분</th><th>받음</th></tr></thead><tbody>
    ${l.map(p => { const d = done.get(p.key);
      return `<tr class="${nt.focus === p.key ? 'on' : ''}" style="cursor:pointer" onclick="ntFocus('${escAttr(p.key)}')">
      <td class="ck" onclick="event.stopPropagation()"><input type="checkbox"${nt.picked.has(p.key) ? ' checked' : ''} onchange="ntPick('${escAttr(p.key)}',this.checked)"></td>
      <td><span style="font-weight:600">${escapeHtml(p.nameKo || p.nameEn)}</span>${p.nameKo && p.nameEn ? `<div style="font-size:var(--fs-10_5);color:var(--i4)">${escapeHtml(p.nameEn)}</div>` : ''}</td>
      <td>${escapeHtml(p.orgKo || p.orgEn)}</td>
      <td style="font-size:var(--fs-11_5);color:var(--i3)">${escapeHtml(p.titleKo || p.titleEn)}</td>
      <td><span class="pill ${p.source === 'speaker' ? 'p-green' : 'p-gray'}">${SOURCE_LABEL[p.source]}</span>${p.badgeKo && p.source === 'part' ? ` <span style="font-size:var(--fs-11);color:var(--i3)">${escapeHtml(p.badgeKo)}</span>` : ''}</td>
      <td style="font-size:var(--fs-11);white-space:nowrap">${d ? `<span style="color:var(--g);font-weight:700">✓</span> ${kst(d.last)}${d.n > 1 ? ` · ${d.n}장` : ''}` : '<span style="color:var(--i5)">—</span>'}</td></tr>`; }).join('')}
    </tbody></table></div>`;
}

/* ── 오른쪽: 미리보기 · 고쳐 찍기 · 인쇄 · 최근 발급 ── */
function targets(evKey){
  const people = ntPeople(evKey);
  const byKey = new Map(people.map(p => [p.key, p]));
  const keys = nt.picked.size ? [...nt.picked] : nt.focus ? [nt.focus] : [];
  return keys.map(k => byKey.get(k)).filter(Boolean);
}

function previewHtml(card){
  const t = nt.template;
  const z = Math.min(1, 330 / (t.width_mm * MM_PX), 380 / (t.height_mm * MM_PX));
  return `<div class="nt-stage-wrap"><div style="width:${t.width_mm * MM_PX * z + 2}px;height:${t.height_mm * MM_PX * z + 2}px">
    <div class="nt-stage" style="transform:scale(${z})"><div class="nt-frame">${ntCardHtml(t, card)}</div></div></div></div>`;
}

function sideHtml(evKey){
  if(nt.walkIn) return walkInHtml();
  const list = targets(evKey);
  const focus = list.find(p => p.key === nt.focus) || list[0];
  const recent = recentHtml();
  if(!focus) return `<h4>미리보기</h4><div class="nt-note">왼쪽에서 사람을 누르면 네임택이 여기 보여요. 여러 명은 체크해서 한 번에 뽑아요.</div>${recent}`;

  const card = cardFor(focus);
  const done = printedMap();
  const again = list.filter(p => done.has(p.key));
  const f = (k, label, wide) => `<label class="${wide ? 'wide' : ''}"><div class="mlbl">${label}</div>
    <input class="fi" value="${escAttr(card[k] || '')}" oninput="ntEdit('${escAttr(focus.key)}','${k}',this.value)"></label>`;
  return `<h4>${list.length > 1 ? `고른 ${list.length}명 · ` : ''}${escapeHtml(card.name)} 미리보기</h4>
    <div id="nt-preview">${previewHtml(card)}</div>
    <div class="nt-fields">
      ${f('name', '이름', true)}${f('company', '소속', true)}${f('job_title', '직함')}${f('badge', '구분')}
      <label class="wide"><div class="mlbl">말</div><select class="fi" onchange="ntEdit('${escAttr(focus.key)}','lang',this.value)">
        <option value="ko"${card.lang === 'ko' ? ' selected' : ''}>국문</option><option value="en"${card.lang === 'en' ? ' selected' : ''}>영문</option></select></label>
    </div>
    <div class="nt-note">여기서 고친 값은 이번 네임택과 발급 기록에만 남아요. 마스터DB는 그대로예요.</div>
    ${again.length ? `<div class="nt-warn">${again.length === 1 ? escapeHtml(cardFor(again[0]).name) + ' 님은' : `${again.length}명은`} 이미 받았어요 — 재발급 사유
      <select class="fi" style="width:auto;margin-left:4px" onchange="ntSetReason(this.value)"><option value="">고르세요</option>
        ${REISSUE_REASONS.map(r => `<option${nt.reason === r ? ' selected' : ''}>${r}</option>`).join('')}</select></div>` : ''}
    <div class="nt-actions">
      <button class="btn bp" onclick="ntPrint()"${nt.busy ? ' disabled' : ''}>🖨 ${list.length > 1 ? `${list.length}장 인쇄` : '인쇄'}</button>
      ${nt.picked.size ? `<button class="btn bs" onclick="ntPickAll(false)">고른 것 풀기</button>` : ''}
    </div>${recent}`;
}

function walkInHtml(){
  const w = nt.walkIn;
  const f = (k, label, wide) => `<label class="${wide ? 'wide' : ''}"><div class="mlbl">${label}</div>
    <input class="fi" value="${escAttr(w[k] || '')}" oninput="ntWalkEdit('${k}',this.value)"></label>`;
  return `<h4>현장 신규</h4>
    <div id="nt-preview">${previewHtml(w)}</div>
    <div class="nt-fields">${f('name', '이름 *', true)}${f('company', '소속', true)}${f('job_title', '직함')}${f('badge', '구분')}</div>
    <div class="nt-note">명단에 없는 사람이에요. 이름·소속은 발급 기록에만 남고 마스터DB에는 넣지 않아요 — 연락처로 남길 사람은 «참가자 추가»로 먼저 넣어 주세요.</div>
    <div class="nt-actions"><button class="btn bp" onclick="ntPrint()"${nt.busy ? ' disabled' : ''}>🖨 인쇄</button>
      <button class="btn bs" onclick="ntWalkIn(false)">취소</button></div>${recentHtml()}`;
}

function recentHtml(){
  const l = nt.prints.slice(0, 30);
  if(!l.length) return '';
  const KIND = { issue: '', reissue: '재발급', walk_in: '현장' };
  return `<h4 style="margin-top:4px">최근 발급</h4><ul class="nt-recent">${l.map(p => `<li class="${p.voided_at ? 'voided' : ''}">
    <span class="who"><b>${escapeHtml(p.name)}</b> <span style="color:var(--i4)">${escapeHtml(p.company || '')}</span>
      ${KIND[p.kind] ? `<span class="pill p-gray">${KIND[p.kind]}${p.reason ? ' · ' + escapeHtml(p.reason) : ''}</span>` : ''}</span>
    <span style="display:flex;gap:6px;align-items:center"><span class="when" title="${escAttr(p.printed_by || '')}">${kst(p.printed_at)}</span>
      ${p.voided_at ? '<span class="when">안 됨</span>' : `<button class="btn bs" onclick="ntVoid('${escAttr(p.id)}')" title="인쇄가 안 나왔으면 되돌려요 — 기록은 남고 받은 수에서 빠져요">안 됨</button>`}</span></li>`).join('')}</ul>`;
}

function fitPreview(){
  const el = document.getElementById('nt-preview');
  if(!el) return;
  fitNametags(el);
  document.fonts?.ready.then(() => fitNametags(el));
}
/* 입력 중에는 통째로 다시 그리지 않는다(입력칸이 포커스를 잃는다) — 미리보기만 갈아 끼운다 */
function refreshPreview(card){
  const el = document.getElementById('nt-preview');
  if(!el) return;
  el.innerHTML = previewHtml(card);
  fitPreview();
}

/* ── 동작 ── */
const evPerson = (key) => ntPeople(nt.ev).find(p => p.key === key);

export function ntSetFilter(v){ nt.filter = v; rerender(); }
export function ntSetSrc(v){ nt.src = v; rerender(); }
export function ntFocus(key){ nt.focus = key; nt.walkIn = null; rerender(); }
export function ntPick(key, on){ if(on) nt.picked.add(key); else nt.picked.delete(key); if(on && !nt.focus) nt.focus = key; nt.walkIn = null; rerender(); }
export function ntPickAll(on){
  if(!on){ nt.picked.clear(); rerender(); return; }
  visible(nt.ev, document.getElementById('evdb-q')?.value || '').forEach(p => nt.picked.add(p.key));
  rerender();
}
export function ntEdit(key, field, value){
  const e = nt.edits.get(key) || {};
  e[field] = value;
  nt.edits.set(key, e);
  const p = evPerson(key);
  if(!p) return;
  if(field === 'lang'){
    /* 말을 바꾸면 그 말의 값으로 다시 채운다 — 앞서 고친 글자는 버린다 */
    nt.edits.set(key, { lang: value });
    rerender();
    return;
  }
  refreshPreview(cardFor(p));
}
export function ntWalkIn(on){ nt.walkIn = on ? { name: '', company: '', job_title: '', badge: '' } : null; rerender(); }
export function ntWalkEdit(field, value){ if(!nt.walkIn) return; nt.walkIn[field] = value; refreshPreview(nt.walkIn); }
export function ntSetReason(v){ nt.reason = v; }
export function ntReload(){ nt.loaded = ''; nt.err = ''; ensureLoaded(nt.ev); rerender(); }

async function saveTemplate(patch){
  const next = { ...nt.template, ...patch };
  try {
    const j = await saveNametagTemplate(nt.ev, next);
    nt.template = normalizeTemplate(j.template);
  } catch(e){ alert('판을 저장하지 못했어요 — ' + e.message); }
  rerender();
}
export function ntSetPaper(i){ const s = SIZE_PRESETS[+i]; if(s) saveTemplate({ width_mm: s.width_mm, height_mm: s.height_mm }); }
export function ntSetTplLang(v){ nt.edits.forEach((e, k) => { if(e.lang) nt.edits.delete(k); }); saveTemplate({ lang: v }); }

export async function ntPrint(){
  if(nt.busy) return;
  let cards;
  if(nt.walkIn){
    const w = nt.walkIn;
    if(!String(w.name || '').trim()) return alert('이름을 적어 주세요.');
    cards = [{ source: 'walk_in', name: w.name, company: w.company, job_title: w.job_title, badge: w.badge, lang: /[가-힣]/.test(w.name) ? 'ko' : 'en' }];
  } else {
    const list = targets(nt.ev);
    if(!list.length) return alert('뽑을 사람을 골라 주세요.');
    const done = printedMap();
    if(list.some(p => done.has(p.key)) && !nt.reason) return alert('이미 받은 사람이 있어요. 재발급 사유를 골라 주세요.');
    cards = list.map(p => ({ person_key: p.key, source: p.source, ref_id: p.ref_id, contact_id: p.contact_id, ...cardFor(p) }));
    if(cards.some(c => !String(c.name || '').trim())) return alert('이름이 빈 네임택이 있어요.');
  }
  /* 팝업 차단을 피하려면 누른 그 순간 창을 연다. 기록이 오면 그린다 */
  const w = openPrintWindow();
  if(!w) return alert('인쇄 창이 막혔어요. 브라우저 주소창 오른쪽에서 이 사이트의 팝업을 허용해 주세요.');
  nt.busy = true; rerender();
  try {
    const j = await issueNametags(nt.ev, cards, nt.reason || undefined);
    nt.prints = [...j.prints, ...nt.prints];
    await fillPrintWindow(w, nt.template, j.prints);
    nt.picked.clear(); nt.edits.clear(); nt.reason = ''; nt.walkIn = null;
  } catch(e){
    w.close();
    alert('발급하지 못했어요 — ' + e.message);
  } finally { nt.busy = false; rerender(); }
}

export async function ntVoid(id){
  const p = nt.prints.find(x => x.id === id);
  if(!p || !confirm(`${p.name} 님 네임택이 안 나왔다고 되돌릴까요?\n기록은 남고, 받은 수에서 빠져요.`)) return;
  try {
    const j = await voidNametag(id);
    nt.prints = nt.prints.map(x => x.id === id ? j.print : x);
  } catch(e){ alert('되돌리지 못했어요 — ' + e.message); }
  rerender();
}

Object.assign(window, { ntSetFilter, ntSetSrc, ntFocus, ntPick, ntPickAll, ntEdit, ntWalkIn, ntWalkEdit, ntSetReason, ntReload, ntSetPaper, ntSetTplLang, ntPrint, ntVoid });
