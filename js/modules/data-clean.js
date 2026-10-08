/* ══════════════════════════════════════════════════════════════
   data-clean.js — 설정 › 데이터 정리의 국가·업종 채우기

   1) 연락처 빈 국가 채우기 — AI 없이. «국가 확인» 칩이 이미 하는 짐작
      (전화 국가번호 → 이메일 국가 도메인 → 국내 번호·메일 → 한글 이름·소속)을
      근거별로 묶어 보여 주고, 고른 묶음만 채운다. 이미 적힌 국가는 건드리지 않는다.
   2) 기업 국가·업종 추천 — Claude(backend-node/routes/ai.js /org-enrich).
      국가가 비었거나 업종이 «○○ 업종 미정»·빈칸인 기업만. 보내는 것은 기업명·웹주소·
      품목·소개 앞부분과 고를 수 있는 업종 이름뿐이다. 사람 정보는 보내지 않는다.
      추천은 표로 보여 주고, 체크한 것만 저장한다.
══════════════════════════════════════════════════════════════ */
import { API_BASE_URL, currentUser, contacts, ORGS, COMPANY_SECTORS } from '../state.js';
import { COUNTRIES } from '../constants.js';
import { escapeHtml, escAttr } from '../utils.js';
import { postToSheet, safeFetch, authHeaders, aiOrgEnrich } from '../api.js';
import { countryHint } from '../country-signal.js';
import { buildCoDB } from './company-tab.js';
import { renderMDB } from './db-tab.js';
import { trackAction } from './audit-tab.js';

const blank = (v) => { const t = String(v ?? '').trim(); return !t || t === '-'; };
const splitSectors = (v) => String(v || '').split('|').map(s => s.trim()).filter(Boolean);
const isUndecided = (s) => /업종 미정$/.test(s);

/* ── 1) 연락처 빈 국가 채우기 ── */
let fillGroups = [];   // [{ key, country, why, ids:[] }]
function contactFillGroups(){
  const by = new Map();
  contacts.forEach(c => {
    if(!blank(c.country)) return;
    const h = countryHint(c);
    if(!h) return;
    const k = `${h.country}|${h.why}`;
    if(!by.has(k)) by.set(k, { key: k, country: h.country, why: h.why, ids: [] });
    by.get(k).ids.push(c.id);
  });
  return [...by.values()].sort((a, b) => b.ids.length - a.ids.length);
}
export function contactFillCount(){ return contactFillGroups().reduce((n, g) => n + g.ids.length, 0); }

export function renderContactFill(){
  const el = document.getElementById('ctry-fill-list');
  if(!el) return;
  fillGroups = contactFillGroups();
  if(!fillGroups.length){ el.innerHTML = '<div style="font-size:11px;color:var(--i4)">국가가 비었는데 짐작할 근거가 있는 연락처가 없어요.</div>'; return; }
  // 한글 이름·소속만 보고 하는 짐작은 약하다 — 기본으로 꺼 둔다
  const weak = (g) => /한글/.test(g.why);
  el.innerHTML = fillGroups.map((g, i) => `<label style="display:flex;gap:8px;align-items:center;font-size:12px;padding:2px 0">
      <input type="checkbox" class="ctry-fill-ck" data-i="${i}" ${weak(g) ? '' : 'checked'}>
      <b>${escapeHtml(g.country)}</b> <span style="color:var(--i4)">${escapeHtml(g.why)}</span>
      <span class="pill p-gray">${g.ids.length}명</span>${weak(g) ? '<span style="font-size:10.5px;color:var(--am)">짐작이 약해요</span>' : ''}</label>`).join('')
    + `<div style="display:flex;gap:8px;align-items:center;margin-top:8px">
        <button class="btn bp" onclick="applyContactFill()">고른 묶음 채우기</button>
        <span id="ctry-fill-msg" style="font-size:11px;color:var(--i3)"></span></div>`;
}

export async function applyContactFill(){
  const msg = document.getElementById('ctry-fill-msg');
  const picked = [...document.querySelectorAll('.ctry-fill-ck:checked')].map(x => fillGroups[+x.dataset.i]).filter(Boolean);
  const want = new Map();
  picked.forEach(g => g.ids.forEach(id => want.set(String(id), g.country)));
  if(!want.size){ if(msg) msg.textContent = '채울 묶음을 골라주세요.'; return; }
  if(!API_BASE_URL || !currentUser){ if(msg) msg.textContent = '서버 연동 정보가 없어요.'; return; }
  if(!confirm(`연락처 ${want.size}명의 빈 국가를 채울까요?\n이미 국가가 적힌 사람은 건드리지 않아요.`)) return;
  if(msg) msg.textContent = '원본 데이터 확인 중...';
  // 저장은 «국가명 일괄 정리»와 같은 방식 — 서버 원본을 다시 읽어 국가 칸만 바꾼다
  const raw = await safeFetch(API_BASE_URL + '/api/data?sheet=contacts', 'contacts(국가 채우기)', 1, await authHeaders());
  if(!Array.isArray(raw)){ if(msg) msg.textContent = '원본을 읽지 못했어요. 네트워크를 확인해주세요.'; return; }
  const targets = raw.filter(r => want.has(String(r.id)) && blank(r.country));
  if(!targets.length){ if(msg) msg.textContent = '채울 사람이 없어요 — 그새 누가 채웠을 수 있어요.'; return; }
  const rows = targets.map(r => {
    const country = want.get(String(r.id));
    const c = contacts.find(x => String(x.id) === String(r.id));
    if(c) c.country = country;
    return [r.id, r.nameKo, r.nameEn, r.orgKo, r.orgEn, r.titleKo, r.titleEn, r.deptKo, r.deptEn,
      country, r.cat, r.lang, r.source, r.date, r.status, r.email1, r.email2, r.phone1, r.phone2,
      r.beat, r.products, r.tags || ''];
  });
  if(msg) msg.textContent = `저장 중... (${rows.length}명)`;
  const r = await postToSheet({ sheet: 'contacts', action: 'batchUpsert', rows }, '빈 국가 채우기');
  if(msg) msg.textContent = r.ok ? `완료: ${rows.length}명의 국가를 채웠어요.` : '저장에 실패했어요. 다시 시도해주세요.';
  if(r.ok) trackAction('edit', '빈 국가 채우기', 'contacts', `연락처 ${rows.length}명 국가 채움 (${picked.map(g => `${g.country}·${g.why}`).join(', ')})`);
  try { renderMDB(); } catch(e){}
  renderContactFill();
}

/* ── 기업 레코드 저장 — dataRows는 «전체 레코드»로 덮어쓰므로 원래 값에 고친 칸만 얹어 보낸다 ── */
export async function saveOrgFields(patches, label){
  const now = new Date().toISOString();
  const recs = patches.map(p => {
    const o = ORGS.find(x => x.id === p.id);
    return o ? { ...o, ...p, updated_at: now } : null;
  }).filter(Boolean);
  for(let i = 0; i < recs.length; i += 100){
    const r = await postToSheet({ sheet: 'orgs', action: 'batchUpsert', dataRows: recs.slice(i, i + 100) }, label);
    if(!r || r.ok === false) return { ok: false, saved: i };
    recs.slice(i, i + 100).forEach(rec => { const o = ORGS.find(x => x.id === rec.id); if(o) Object.assign(o, rec); });
  }
  try { buildCoDB(); } catch(e){}
  return { ok: true, saved: recs.length };
}

/* ── 2) 기업 국가·업종 추천 ── */
const mainSectorNames = (domains) => COMPANY_SECTORS
  .filter(s => !s.parent && !isUndecided(s.name) && (!domains || String(s.domain || '').split('|').some(d => domains.includes(d))))
  .map(s => s.name);

function enrichTargets(){
  return ORGS.map(o => {
    const cur = splitSectors(o.sectors);
    const undecided = cur.find(isUndecided);
    let choices = [];
    if(undecided){
      // «건축 업종 미정»이면 건축 분야 업종 중에서(공통 분야 포함) 고른다
      const dom = (COMPANY_SECTORS.find(s => s.name === undecided) || {}).domain || '';
      choices = mainSectorNames([...String(dom).split('|').filter(Boolean), 'common']);
    } else if(!cur.length) choices = mainSectorNames(null);
    const wantCountry = blank(o.country) && blank(o.hq);
    return (wantCountry || choices.length) ? { o, cur, undecided, wantCountry, choices } : null;
  }).filter(Boolean);
}
export function enrichCounts(){
  const t = enrichTargets();
  return { country: t.filter(x => x.wantCountry).length, sector: t.filter(x => x.choices.length).length, total: t.length };
}

let enrichRows = [];   // [{ id, name, country, sector, sure, reason, undecided, cur }]
export async function runOrgEnrich(){
  const el = document.getElementById('org-enrich-list');
  const btn = document.getElementById('org-enrich-btn');
  if(!el) return;
  const targets = enrichTargets();
  if(!targets.length){ el.innerHTML = '<div style="font-size:11px;color:var(--i4)">국가·업종이 빈 기업이 없어요.</div>'; return; }
  if(btn) btn.disabled = true;
  const countries = COUNTRIES.map(c => c.nameKo);
  const chunks = [];
  for(let i = 0; i < targets.length; i += 60) chunks.push(targets.slice(i, i + 60));
  enrichRows = [];
  let done = 0, failed = 0;
  const paint = () => { el.innerHTML = `<div style="font-size:11px;color:var(--i3)">✨ 기업 ${targets.length}곳 살펴보는 중… ${done}/${chunks.length}묶음${failed ? ` · 실패 ${failed}` : ''}</div>`; };
  paint();
  // 한 묶음은 60곳 — 서버 함수가 60초에 끊기므로 나눠서, 세 묶음씩 동시에
  const work = async (chunk) => {
    const r = await aiOrgEnrich({
      countries,
      orgs: chunk.map(t => ({
        id: t.o.id, ko: t.o.name_ko || '', en: t.o.name_en || '', web: t.o.website || '',
        about: [t.o.products, t.o.intro].filter(Boolean).join(' / '),
        sectors: t.cur.join(', '), wantCountry: t.wantCountry, sectorChoices: t.choices,
      })),
    });
    if(r.ok) (r.items || []).forEach(it => {
      const t = chunk.find(x => x.o.id === it.id);
      if(t) enrichRows.push({ ...it, name: t.o.name_ko || t.o.name_en, nameEn: t.o.name_ko ? t.o.name_en : '', undecided: t.undecided || '', cur: t.cur });
    });
    else failed++;
    done++; paint();
  };
  const queue = [...chunks];
  await Promise.all([0, 1, 2].map(async () => { while(queue.length) await work(queue.shift()); }));
  if(btn) btn.disabled = false;
  enrichRows.sort((a, b) => (b.sure - a.sure) || String(a.name).localeCompare(String(b.name)));
  renderEnrich(failed ? `${failed}묶음은 실패했어요 — 다시 누르면 남은 기업만 다시 봅니다.` : '');
}

function renderEnrich(note){
  const el = document.getElementById('org-enrich-list');
  if(!el) return;
  if(!enrichRows.length){ el.innerHTML = `<div style="font-size:11px;color:var(--i4)">추천할 만한 기업을 찾지 못했어요.${note ? ' ' + escapeHtml(note) : ''}</div>`; return; }
  const nC = enrichRows.filter(r => r.country).length, nS = enrichRows.filter(r => r.sector).length;
  el.innerHTML = `<div style="font-size:11px;color:var(--i3);margin-bottom:6px">추천 ${enrichRows.length}곳 — 국가 ${nC} · 업종 ${nS}.
      «확실»은 미리 체크해 두었고 «짐작»은 꺼 두었어요. 확인하고 체크한 것만 저장합니다.${note ? ` <span style="color:var(--am)">${escapeHtml(note)}</span>` : ''}</div>
    <div style="max-height:360px;overflow:auto;border:1px solid var(--i6);border-radius:8px;background:var(--W)">
    <table style="width:100%;border-collapse:collapse;font-size:11.5px">
      <thead><tr style="background:var(--i8);position:sticky;top:0">
        <th style="text-align:left;padding:5px 8px">기업</th><th style="text-align:left;padding:5px 8px">국가</th>
        <th style="text-align:left;padding:5px 8px">업종</th><th style="text-align:left;padding:5px 8px">근거</th></tr></thead>
      <tbody>${enrichRows.map((r, i) => `<tr style="border-top:1px solid var(--i7)">
        <td style="padding:5px 8px"><b>${escapeHtml(r.name)}</b>${r.nameEn ? `<div style="font-size:10px;color:var(--i4)">${escapeHtml(r.nameEn)}</div>` : ''}
          <span class="pill ${r.sure ? 'p-green' : 'p-amber'}" style="font-size:9.5px">${r.sure ? '확실' : '짐작'}</span></td>
        <td style="padding:5px 8px">${r.country ? `<label style="display:flex;gap:4px;align-items:center"><input type="checkbox" class="oe-c" data-i="${i}" ${r.sure ? 'checked' : ''}>${escapeHtml(r.country)}</label>` : '<span style="color:var(--i5)">-</span>'}</td>
        <td style="padding:5px 8px">${r.sector ? `<label style="display:flex;gap:4px;align-items:center"><input type="checkbox" class="oe-s" data-i="${i}" ${r.sure ? 'checked' : ''}>${escapeHtml(r.sector)}</label>
          ${r.undecided ? `<div style="font-size:10px;color:var(--i4)">«${escapeHtml(r.undecided)}» 대신</div>` : ''}` : '<span style="color:var(--i5)">-</span>'}</td>
        <td style="padding:5px 8px;color:var(--i3)">${escapeHtml(r.reason)}</td></tr>`).join('')}</tbody></table></div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
      <button class="btn bs" onclick="document.querySelectorAll('.oe-c,.oe-s').forEach(x=>x.checked=true)">모두 체크</button>
      <button class="btn bs" onclick="document.querySelectorAll('.oe-c,.oe-s').forEach(x=>x.checked=false)">모두 해제</button>
      <button class="btn bp" style="margin-left:auto" onclick="applyOrgEnrich()">체크한 것 저장</button>
      <span id="org-enrich-msg" style="font-size:11px;color:var(--i3)"></span></div>`;
}

export async function applyOrgEnrich(){
  const msg = document.getElementById('org-enrich-msg');
  const byId = new Map();
  document.querySelectorAll('.oe-c:checked').forEach(x => {
    const r = enrichRows[+x.dataset.i];
    if(r) (byId.get(r.id) || byId.set(r.id, { id: r.id }).get(r.id)).country = r.country;
  });
  document.querySelectorAll('.oe-s:checked').forEach(x => {
    const r = enrichRows[+x.dataset.i];
    if(!r) return;
    // «업종 미정»만 갈아 끼우고, 이미 있던 다른 업종은 그대로 둔다
    const next = r.undecided ? r.cur.map(s => (s === r.undecided ? r.sector : s)) : [...r.cur, r.sector];
    (byId.get(r.id) || byId.set(r.id, { id: r.id }).get(r.id)).sectors = [...new Set(next)].join('|');
  });
  const patches = [...byId.values()];
  if(!patches.length){ if(msg) msg.textContent = '체크한 것이 없어요.'; return; }
  const nC = patches.filter(p => p.country).length, nS = patches.filter(p => p.sectors).length;
  if(!confirm(`기업 ${patches.length}곳을 저장할까요? (국가 ${nC} · 업종 ${nS})`)) return;
  if(msg) msg.textContent = '저장 중...';
  const r = await saveOrgFields(patches, '기업 국가·업종 채우기');
  if(!r.ok){ if(msg) msg.textContent = `저장에 실패했어요 (${r.saved}곳까지 저장됨). 다시 시도해주세요.`; return; }
  trackAction('edit', '기업 국가·업종 채우기', 'orgs', `AI 추천으로 기업 ${r.saved}곳 (국가 ${nC} · 업종 ${nS})`);
  const savedIds = new Set(patches.map(p => p.id));
  enrichRows = enrichRows.filter(x => !savedIds.has(x.id));
  renderEnrich();
  if(msg) msg.textContent = `완료: ${r.saved}곳 저장했어요.`;
  window.renderCleanCounts?.();
}

window.renderContactFill = renderContactFill;
window.applyContactFill = applyContactFill;
window.runOrgEnrich = runOrgEnrich;
window.applyOrgEnrich = applyOrgEnrich;
