/* ══════════════════════════════════════════════════════════════
   api/contacts.js — 화면에서 연락처를 넣는 한 길 (2026-11-25)
   서버 routes/contacts.js(→ db/contact-upsert.js contactUpserter)를 부른다. 같은 사람 찾기
   (메일+이름 → 전화 끝 8자리+이름 → 이름+소속), 빈 칸만 채우기, 16자리 이하 id, 기업DB 연결을
   서버 한 곳에서 한다. 화면이 nextContactId()로 저마다 만들던 길을 여기로 모은다.

   upsertContacts(list, { source }) → { ok, results:[{ id, created, by, suspect, why, contact }] }
     넣은 줄과 서버가 새로 만든 기업을 화면 목록(contacts·ORGS)에 바로 넣어 둔다.
   matchContacts(list) → { ok, results:[{ contact, by, suspect, why }] } — 넣지 않고 미리보기만

   시험 로그인(서버 없음)에서는 같은 기준을 화면 데이터로 흉내 낸다.
══════════════════════════════════════════════════════════════ */
import { API_BASE_URL, contacts, ORGS, nextContactId } from '../state.js';
import { authHeaders, postToSheet } from '../api.js';
import { normalizeCompanyKey } from '../domain/org-names.js';

const s = (v) => String(v ?? '').trim();
/* 서버 줄 → 화면 연락처(load.js와 같은 모양 — id는 숫자, 빈 칸은 '') */
export function toClientContact(r){
  const c = {};
  Object.entries(r || {}).forEach(([k, v]) => { c[k] = v == null ? '' : v; });
  c.id = +r.id;
  return c;
}
function merge(rows, orgs){
  (orgs || []).forEach((o) => { if(!ORGS.some((x) => x.id === o.id)) ORGS.push(o); });
  (rows || []).forEach((row) => {
    const c = toClientContact(row);
    const k = contacts.findIndex((x) => String(x.id) === String(c.id));
    if(k >= 0) Object.assign(contacts[k], c); else contacts.push(c);
  });
  if((orgs || []).length) import('../domain/co-db.js').then((m) => { try { m.buildCoDB(); } catch(e){} });
}
async function call(path, body){
  try {
    const res = await fetch(API_BASE_URL + '/api/contacts' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => null);
    return j || { ok: false, error: `서버 응답을 읽지 못했어요 (${res.status})` };
  } catch(e){ return { ok: false, error: '서버에 닿지 않았어요 — 네트워크를 확인해 주세요' }; }
}

export async function matchContacts(list){
  if(!API_BASE_URL) return { ok: true, results: list.map(localMatch) };
  const j = await call('/match', { contacts: list });
  if(!j.ok) return j;
  return { ok: true, results: j.results.map((r) => ({ ...r, contact: r.contact ? byId(r.contact.id) || r.contact : null, suspect: r.suspect ? byId(r.suspect.id) || r.suspect : null })) };
}

export async function upsertContacts(list, { source = '화면에서 추가' } = {}){
  if(!list.length) return { ok: true, results: [] };
  if(!API_BASE_URL) return localUpsert(list, source);
  const out = [];
  for(let i = 0; i < list.length; i += 200){
    const j = await call('/upsert', { contacts: list.slice(i, i + 200), source });
    if(!j.ok) return { ok: false, error: j.error || '저장하지 못했어요', results: out };
    merge(j.contacts, j.orgs);
    j.results.forEach((r) => out.push({ ...r, contact: r.id ? byId(r.id) : null }));
  }
  return { ok: true, results: out };
}
export async function upsertContact(raw, opts){
  const r = await upsertContacts([raw], opts);
  return r.ok ? { ok: true, ...r.results[0] } : r;
}
const byId = (id) => contacts.find((c) => String(c.id) === String(id)) || null;

/* ── 시험 로그인용 — 서버 기준(db/contact-upsert.js)을 화면 데이터로 ── */
const mailKey = (v) => s(v).toLowerCase();
const telKey = (v) => { const d = s(v).replace(/\D/g, ''); return d.length >= 8 ? d.slice(-8) : ''; };
const nameKeys = (c) => [c.nameKo, c.nameEn].map((v) => s(v).toLowerCase().replace(/\s+/g, '')).filter(Boolean);
const orgKeys = (c) => [c.orgKo, c.orgEn].map((v) => normalizeCompanyKey(s(v))).filter(Boolean);
const sameName = (a, b) => { const x = nameKeys(a), y = nameKeys(b); return !x.length || !y.length || x.some((k) => y.includes(k)); };
function localMatch(v){
  const live = contacts.filter((c) => !s(c.moved_to_id));
  const mails = [v.email1, v.email2].map(mailKey).filter(Boolean);
  let other = null;
  for(const c of live){
    if(![c.email1, c.email2].map(mailKey).some((k) => k && mails.includes(k))) continue;
    if(sameName(v, c)) return { contact: c, by: '메일' };
    other = other || c;
  }
  const tels = [v.phone1, v.phone2].map(telKey).filter(Boolean);
  const t = tels.length && nameKeys(v).length ? live.find((c) => [c.phone1, c.phone2].map(telKey).some((k) => k && tels.includes(k)) && sameName(v, c)) : null;
  if(t) return { contact: t, by: '전화' };
  const nk = nameKeys(v), ok = orgKeys(v);
  const named = nk.length ? live.filter((c) => nameKeys(c).some((k) => nk.includes(k))) : [];
  const o = ok.length ? named.find((c) => orgKeys(c).some((k) => ok.includes(k))) : null;
  if(o) return { contact: o, by: '이름+소속' };
  if(other) return { suspect: other, why: '메일은 같은데 이름이 달라요' };
  if(named.length) return { suspect: named[0], why: '이름만 같아요' };
  return {};
}
async function localUpsert(list, source){
  const results = [];
  for(const raw of list){
    const v = {}; Object.entries(raw).forEach(([k, x]) => { if(s(x)) v[k] = s(x); });
    if(!v.nameKo && !v.nameEn && !v.email1){ results.push({ error: '이름도 메일도 없어요' }); continue; }
    const m = localMatch(v);
    if(m.contact){
      Object.entries(v).forEach(([k, x]) => { if(!s(m.contact[k])) m.contact[k] = x; });
      results.push({ id: String(m.contact.id), created: false, by: m.by, contact: m.contact });
      continue;
    }
    const c = { source, date: new Date().toISOString().slice(0, 10), status: 'new', cat: 'attendee', ...v, id: nextContactId() };
    contacts.push(c);
    await postToSheet({ sheet: 'contacts', action: 'batchUpsert', dataRows: [{ ...c, id: String(c.id) }] }, '연락처 넣기', { silent: true });
    results.push({ id: String(c.id), created: true, by: '', suspect: m.suspect || null, why: m.why || '', contact: c });
  }
  return { ok: true, results };
}
