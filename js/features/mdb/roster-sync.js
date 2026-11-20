/* ══════════════════════════════════════════════════════════════
   features/mdb/roster-sync.js — 행사 DB «📋 명단 맞추기»

   주최·파트너링 플랫폼이 명단 파일을 새로 보낼 때마다(«참석자 바뀜», «플랫폼 파일 11/17»)
   지금 이 행사·이 역할 명단과 견줘 손봐야 했다. 화면에 길이 없어 GPBFair 2026 한 주에만
   일회성 스크립트를 다섯 번 썼다(db/oneoff/gpb-*-1113·1113b·1117·1117b·1118). 그 일을 화면으로 옮긴다.

   파일 한 장 + 역할 하나(셀러·바이어·참가자 …)를 고르면 넷으로 나눠 보여 준다.
     · 새로 들어옴 — 파일에는 있고 이 역할 명단에는 없는 사람. 마스터DB에 있으면 그 사람에게 역할만,
                     없으면 새 연락처(기업DB 연결까지)
     · 바뀐 값     — 같은 사람인데 직함·메일·전화·소속이 파일과 다름. 메일·전화는 옛 값을 둘째 칸에 남긴다
     · 빠짐        — 이 역할 명단에는 있는데 파일에는 없는 사람. 이 역할 참가 기록만 뺀다(연락처는 남김)
     · 그대로      — 셀 뿐
   모두 체크로 고르고 «반영»을 눌러야 바뀐다.

   같은 사람 기준은 연락처 넣기 한 길(backend-node/db/contact-upsert.js · 엑셀 업로드)과 같다.
   이 역할 명단 안에서는 이름만 같아도 같은 사람으로 본다 — 같은 행사의 같은 명단이다.
══════════════════════════════════════════════════════════════ */
import { contacts, participations, nextContactId } from '../../state.js';
import { postToSheet } from '../../api.js';
import { ensureOrgsForNames, orgIdForName } from '../../domain/orgs.js';
import { normalizeCompanyKey } from '../../domain/org-names.js';
import { trackAction } from '../../core/audit-log.js';
import { escapeHtml, escAttr, td } from '../../utils.js';

const s = (v) => String(v ?? '').trim();
const HANGUL = /[가-힣]/;
const mailKey = (v) => s(v).toLowerCase();
const telKey = (v) => { const d = s(v).replace(/\D/g, ''); return d.length >= 8 ? d.slice(-8) : ''; };
const koKey = (v) => s(v).replace(/\s/g, '');
const enKey = (v) => s(v).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
const nameKeys = (c) => [koKey(c.nameKo), enKey(c.nameEn)].filter(Boolean);
const orgKeys = (c) => [c.orgKo, c.orgEn].map((o) => normalizeCompanyKey(o)).filter(Boolean);
const sameName = (a, b) => { const x = nameKeys(a), y = nameKeys(b); return !x.length || !y.length || x.some((k) => y.includes(k)); };
const personName = (c) => s(c.nameKo) || s(c.nameEn) || '(이름 없음)';
const evOf = (p) => p.eventId || p.event;

/* ── 머리글 알아보기 ── 띄어쓰기를 지우고 견준다 */
const HEAD = [
  ['nameEn', /^(영문(이름|성명|명)|englishname|name\(en(glish)?\)|fullname|name)$/i],
  ['nameKo', /^(성명|이름|국문(이름|성명)|성함|담당자(명|성함)?|참석자(명)?|참가자(명)?|name\(ko(rean)?\))$/i],
  ['org',    /^(소속|기업명|회사명|업체명|기관명|기관\/?기업\/?단체명|소속기관|company|organi[sz]ation|affiliation|companyname)$/i],
  ['title',  /^(직함|직위|직책|직급|title|position|jobtitle)$/i],
  ['dept',   /^(부서|부서명|department|dept)$/i],
  ['email',  /(이메일|메일|e-?mail)/i],
  ['phone',  /(휴대폰|핸드폰|휴대전화|전화|연락처|mobile|phone|tel)/i],
  ['country', /^(국가|나라|country|국적)$/i],
];
const norm = (v) => s(v).replace(/\s+/g, '');
function mapHeader(row){
  const map = {};
  row.forEach((h, i) => {
    const t = norm(h);
    if(!t) return;
    const hit = HEAD.find(([k, re]) => !(k in map) && re.test(t));
    if(hit) map[hit[0]] = i;
  });
  return map;
}

/* 시트 → 사람 줄. 맨 위 10줄 중 머리글이 둘 이상 알아지는 줄을 머리로 본다 */
function readRows(aoa){
  for(let h = 0; h < Math.min(10, aoa.length); h++){
    const map = mapHeader(aoa[h] || []);
    if(Object.keys(map).length < 2 || !(('nameKo' in map) || ('nameEn' in map) || ('email' in map))) continue;
    const at = (r, k) => (k in map ? s(r[map[k]]) : '');
    const rows = aoa.slice(h + 1).map((r, i) => {
      let nameKo = at(r, 'nameKo'), nameEn = at(r, 'nameEn');
      if(nameKo && !HANGUL.test(nameKo) && !nameEn){ nameEn = nameKo; nameKo = ''; }
      if(nameEn && HANGUL.test(nameEn) && !nameKo){ nameKo = nameEn; nameEn = ''; }
      const org = at(r, 'org'), title = at(r, 'title'), dept = at(r, 'dept');
      return {
        line: h + i + 2, nameKo, nameEn,
        orgKo: HANGUL.test(org) ? org : '', orgEn: HANGUL.test(org) ? '' : org,
        titleKo: HANGUL.test(title) ? title : '', titleEn: HANGUL.test(title) ? '' : title,
        deptKo: HANGUL.test(dept) ? dept : '', deptEn: HANGUL.test(dept) ? '' : dept,
        email1: mailKey(at(r, 'email').split(/[\s,;/]+/)[0]), phone1: at(r, 'phone'), country: at(r, 'country'),
      };
    }).filter((v) => v.nameKo || v.nameEn || v.email1);
    return { map, head: aoa[h], rows };
  }
  return null;
}

/* ── 견주기 ── */
function plan(evKey, role, rows){
  const rolePs = participations.filter((p) => evOf(p) === evKey && p.role === role && p.contactId != null);
  const byId = new Map(contacts.map((c) => [String(c.id), c]));
  const inRole = rolePs.map((p) => ({ p, c: byId.get(String(p.contactId)) })).filter((x) => x.c);
  const usedPart = new Set();
  const added = [], changed = [], same = [];

  rows.forEach((v) => {
    /* ① 이 역할 명단 안 — 메일 · 전화 · 이름 */
    const pool = inRole.filter((x) => !usedPart.has(x.p.id));
    const mails = [v.email1].filter(Boolean);
    const tel = telKey(v.phone1);
    const hit = pool.find((x) => mails.some((m) => [x.c.email1, x.c.email2].map(mailKey).includes(m)) && sameName(v, x.c))
      || (tel && pool.find((x) => [x.c.phone1, x.c.phone2].map(telKey).includes(tel) && sameName(v, x.c)))
      || (nameKeys(v).length && pool.find((x) => nameKeys(x.c).some((k) => nameKeys(v).includes(k))));
    if(hit){
      usedPart.add(hit.p.id);
      const diffs = diffOf(hit.c, v);
      (diffs.length ? changed : same).push({ v, c: hit.c, diffs });
      return;
    }
    /* ② 마스터DB 전체 — 메일(+이름) · 전화(+이름) · 이름+소속. 메일만 같고 이름이 다르거나 이름만 같으면 의심 */
    let c = null, suspect = null;
    for(const m of mails){
      const xs = contacts.filter((x) => [x.email1, x.email2].map(mailKey).includes(m));
      c = xs.find((x) => sameName(v, x)) || null;
      if(!c && xs.length) suspect = xs[0];
      if(c) break;
    }
    if(!c && tel && nameKeys(v).length) c = contacts.find((x) => [x.phone1, x.phone2].map(telKey).includes(tel) && sameName(v, x)) || null;
    const named = c ? [] : contacts.filter((x) => nameKeys(x).some((k) => nameKeys(v).includes(k)));
    if(!c && orgKeys(v).length) c = named.find((x) => orgKeys(x).some((k) => orgKeys(v).includes(k))) || null;
    if(!c && !suspect && named.length) suspect = named[0];
    added.push({ v, c, suspect, diffs: c ? diffOf(c, v) : [] });
  });
  const dropped = inRole.filter((x) => !usedPart.has(x.p.id));
  return { added, changed, same, dropped, roleCount: inRole.length };
}

/* 같은 사람의 바뀐 칸 — 빈 칸 채우기와 다른 값 바꾸기. 메일·전화는 옛 값을 둘째 칸으로 */
function diffOf(c, v){
  const out = [];
  const put = (col, label, to, extra) => { if(s(to) && s(to) !== s(c[col])) out.push({ col, label, from: s(c[col]), to: s(to), ...extra }); };
  if(v.nameKo && !s(c.nameKo)) put('nameKo', '국문 이름', v.nameKo);
  if(v.nameEn && !s(c.nameEn)) put('nameEn', '영문 이름', v.nameEn);
  ['titleKo', 'titleEn', 'deptKo', 'deptEn'].forEach((k) => {
    const lb = { titleKo: '직함', titleEn: '영문 직함', deptKo: '부서', deptEn: '영문 부서' }[k];
    if(v[k] && norm(v[k]) !== norm(c[k])) put(k, lb, v[k]);
  });
  const orgNew = v.orgKo || v.orgEn;
  if(orgNew && !orgKeys(c).includes(normalizeCompanyKey(orgNew))){
    const col = v.orgKo ? 'orgKo' : 'orgEn';
    put(col, '소속', orgNew, { org: true });
  }
  if(v.email1 && ![c.email1, c.email2].map(mailKey).includes(v.email1))
    out.push({ col: 'email1', label: '메일', from: s(c.email1), to: v.email1, keepOld: 'email2' });
  if(telKey(v.phone1) && ![c.phone1, c.phone2].map(telKey).includes(telKey(v.phone1)))
    out.push({ col: 'phone1', label: '전화', from: s(c.phone1), to: v.phone1, keepOld: 'phone2' });
  if(v.country && !s(c.country)) put('country', '국가', v.country);
  return out;
}

/* ── 화면 ── */
let st = null;
const ROLE_PICKS = ['셀러', '바이어', '참가자', '연사', '전시참가기업', 'VIP', '비즈니스파트너링'];

export function openRosterSync(evKey, role){
  st = { evKey, role: role || '', fileName: '', plan: null, pick: {}, confirm: false, err: '' };
  closeRosterSync();
  const pop = document.createElement('div');
  pop.id = 'roster-sync-modal';
  pop.className = 'mw on';
  pop.addEventListener('click', (e) => { if(e.target === pop) closeRosterSync(); });
  document.body.appendChild(pop);
  render();
}
export function closeRosterSync(){ document.getElementById('roster-sync-modal')?.remove(); }

function rolesOfEvent(evKey){
  const have = [...new Set(participations.filter((p) => evOf(p) === evKey).map((p) => p.role).filter(Boolean))];
  return [...new Set([...have, ...ROLE_PICKS])];
}

const chk = (key, on) => `<input type="checkbox" ${on ? 'checked' : ''} onchange="rosterSyncPick('${escAttr(key)}',this.checked)">`;
const sub = (t) => `<div style="color:var(--i4);font-size:var(--fs-10_5)">${t}</div>`;
const who = (c) => `<b>${escapeHtml(personName(c))}</b>${sub(escapeHtml([s(c.orgKo) || s(c.orgEn), s(c.titleKo) || s(c.titleEn)].filter(Boolean).join(' · ')))}`;

function section(title, n, body, note){
  if(!n) return '';
  return `<div style="margin-bottom:14px"><div style="font-weight:700;font-size:var(--fs-12_5);margin-bottom:4px">${title} <span style="color:var(--i4);font-weight:600">${n}</span></div>
    ${note ? `<div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:6px">${note}</div>` : ''}
    <div style="border:1px solid var(--i7);border-radius:var(--r)">${body}</div></div>`;
}
const rowCss = 'display:grid;grid-template-columns:22px 1.3fr 2fr;gap:8px;align-items:start;padding:6px 10px;border-bottom:1px solid var(--i8);font-size:var(--fs-12)';
const diffHtml = (d) => d.map((x) => `<div>${escapeHtml(x.label)}: <span style="color:var(--i4);text-decoration:${x.from ? 'line-through' : 'none'}">${escapeHtml(x.from || '빈칸')}</span> → <b>${escapeHtml(x.to)}</b>${x.keepOld && x.from ? sub('옛 값은 둘째 칸에 남겨요') : ''}</div>`).join('');

function render(){
  const pop = document.getElementById('roster-sync-modal');
  if(!pop || !st) return;
  const P = st.plan;
  const roleOpts = rolesOfEvent(st.evKey).map((r) => `<option ${r === st.role ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('');
  let body = '';
  if(st.err) body = `<div style="padding:16px;color:var(--re)">${escapeHtml(st.err)}</div>`;
  else if(!P) body = `<div style="padding:16px;font-size:var(--fs-12);color:var(--i3);line-height:1.7">
      주최·플랫폼이 보낸 명단 파일(엑셀·CSV)을 고르면 지금 <b>${escapeHtml(st.evKey)}</b>의 <b>${escapeHtml(st.role || '역할')}</b> 명단과 견줘 보여 줘요.<br>
      머리글은 이름·영문 이름·소속·직함·부서·메일·전화·국가를 알아봐요. 고른 것만 반영하고, 연락처는 지우지 않아요.</div>`;
  else {
    const addRows = P.added.map((a, i) => `<label style="${rowCss}">${chk('a' + i, st.pick['a' + i])}
      <div>${who(a.v)}${sub('파일 ' + a.v.line + '줄')}</div>
      <div>${a.c ? `마스터DB의 <b>${escapeHtml(personName(a.c))}</b>에게 «${escapeHtml(st.role)}»만 붙여요${a.diffs.length ? diffHtml(a.diffs) : ''}`
        : `새 연락처로 만들어요${a.suspect ? `<div style="color:var(--am)">⚠️ 같은 이름이 마스터DB에 있어요 — ${escapeHtml(personName(a.suspect))} (${escapeHtml(s(a.suspect.orgKo) || s(a.suspect.orgEn) || '-')}). 같은 사람이면 넣은 뒤 «중복 찾기»로 합쳐요</div>` : ''}`}
        ${sub(escapeHtml([a.v.email1, a.v.phone1].filter(Boolean).join(' · ')))}</div></label>`).join('');
    const chRows = P.changed.map((x, i) => `<label style="${rowCss}">${chk('c' + i, st.pick['c' + i])}<div>${who(x.c)}</div><div>${diffHtml(x.diffs)}</div></label>`).join('');
    const dropRows = P.dropped.map((x, i) => `<label style="${rowCss}">${chk('d' + i, st.pick['d' + i])}<div>${who(x.c)}</div>
      <div>이 행사 «${escapeHtml(st.role)}» 기록을 빼요${x.p.confirmedAt ? ' <span class="pill p-green" style="font-size:10px">확정이었음</span>' : ''}${sub('연락처는 마스터DB에 남아요')}</div></label>`).join('');
    body = `<div style="font-size:var(--fs-11_5);color:var(--i3);margin-bottom:10px">파일 <b>${escapeHtml(st.fileName)}</b> ${P.added.length + P.changed.length + P.same.length}명 · 지금 «${escapeHtml(st.role)}» ${P.roleCount}명 — 그대로 ${P.same.length}명</div>`
      + section('새로 들어옴', P.added.length, addRows, `마스터DB에 있는 사람 ${P.added.filter((a) => a.c).length} · 새 연락처 ${P.added.filter((a) => !a.c).length}`)
      + section('바뀐 값', P.changed.length, chRows, '파일 값으로 고쳐요. 메일·전화는 옛 값을 둘째 칸에 남겨요')
      + section('빠짐', P.dropped.length, dropRows, '파일에 없는 사람이에요 — 담당자가 바뀌었거나 명단에서 빠졌어요')
      + (P.added.length + P.changed.length + P.dropped.length ? '' : '<div style="padding:16px;text-align:center;color:var(--i4)">파일과 명단이 같아요. 고칠 것이 없어요.</div>');
  }
  const n = Object.values(st.pick).filter(Boolean).length;
  pop.innerHTML = `<div class="modal" style="max-width:860px">
    <div class="mh"><div style="flex:1;min-width:0"><div class="mt2">📋 명단 맞추기 — ${escapeHtml(st.evKey)}</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;font-size:var(--fs-12)">
        역할 <select onchange="rosterSyncRole(this.value)">${st.role ? '' : '<option value="">고르세요</option>'}${roleOpts}</select>
        <input type="file" accept=".xlsx,.xls,.csv" onchange="rosterSyncFile(this)" ${st.role ? '' : 'disabled'}>
      </div></div></div>
    <div class="mb" style="max-height:62vh;overflow:auto">${body}</div>
    <div class="mf2">
      ${P && P.added.length ? `<label style="margin-right:auto;font-size:var(--fs-11_5);color:var(--i3)"><input type="checkbox" ${st.confirm ? 'checked' : ''} onchange="rosterSyncConfirm(this.checked)"> 새로 넣는 사람은 참가 확정으로</label>` : '<span style="margin-right:auto"></span>'}
      <button class="btn" onclick="closeRosterSync()">닫기</button>
      <button class="btn bp" ${P && n ? '' : 'disabled'} onclick="applyRosterSync(this)">고른 ${n}건 반영</button>
    </div></div>`;
}

export function rosterSyncRole(role){ st.role = role; st.plan = null; st.pick = {}; render(); }
/* 체크 하나에 창을 다시 그리면 스크롤이 맨 위로 튄다 — 단추 숫자만 고친다 */
export function rosterSyncPick(key, on){
  st.pick[key] = on;
  const n = Object.values(st.pick).filter(Boolean).length;
  const b = document.querySelector('#roster-sync-modal .mf2 .bp');
  if(b){ b.textContent = `고른 ${n}건 반영`; b.disabled = !n; }
}
export function rosterSyncConfirm(on){ st.confirm = on; }

export async function rosterSyncFile(input){
  const f = input.files && input.files[0];
  if(!f || !st.role) return;
  st.err = ''; st.plan = null; st.fileName = f.name;
  try {
    const XLSX = window.XLSX;
    if(!XLSX) throw new Error('엑셀 읽기 도구를 불러오지 못했어요. 새로고침해 주세요.');
    const wb = /\.csv$/i.test(f.name)
      ? XLSX.read(await f.text(), { type: 'string', cellText: true })
      : XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', cellText: true });
    /* 시트가 여럿이면 사람 줄이 가장 많이 읽히는 시트 */
    const best = wb.SheetNames.map((n) => readRows(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' })))
      .filter(Boolean).sort((a, b) => b.rows.length - a.rows.length)[0];
    if(!best || !best.rows.length) throw new Error('이름·메일 머리글을 찾지 못했어요. 첫 줄 근처에 «이름»·«소속»·«메일» 같은 머리글이 있어야 해요.');
    st.plan = plan(st.evKey, st.role, best.rows);
    /* 기본 선택 — 새로 들어옴·바뀐 값은 켜고, 빠짐도 켠다(파일이 정본). 하나씩 끌 수 있다 */
    st.pick = {};
    st.plan.added.forEach((_, i) => { st.pick['a' + i] = true; });
    st.plan.changed.forEach((_, i) => { st.pick['c' + i] = true; });
    st.plan.dropped.forEach((_, i) => { st.pick['d' + i] = true; });
  } catch(e){ st.err = e.message || String(e); }
  render();
}

/* ── 반영 ── */
export async function applyRosterSync(btn){
  const P = st && st.plan;
  if(!P) return;
  const on = (k) => !!st.pick[k];
  const adds = P.added.filter((_, i) => on('a' + i));
  const chs = [...P.changed.filter((_, i) => on('c' + i)), ...adds.filter((a) => a.c && a.diffs.length)];
  const drops = P.dropped.filter((_, i) => on('d' + i));
  if(!confirm(`«${st.role}» 명단을 이렇게 바꿔요.\n새로 들어옴 ${adds.length}명 · 바뀐 값 ${chs.length}명 · 빠짐 ${drops.length}명\n\n계속할까요?`)) return;
  if(btn){ btn.disabled = true; btn.textContent = '반영 중…'; }
  const fail = [];
  const src = `명단 맞추기 · ${st.evKey} · ${st.fileName}`;

  /* ① 소속을 기업DB에 — 새 사람·소속이 바뀐 사람 */
  const orgNames = [...new Set([
    ...adds.filter((a) => !a.c).map((a) => a.v.orgKo || a.v.orgEn),
    ...chs.flatMap((x) => x.diffs.filter((d) => d.org).map((d) => d.to)),
  ].filter(Boolean))];
  if(orgNames.length){ const r = await ensureOrgsForNames(orgNames); if(!r.ok) fail.push('기업DB 연결'); }

  /* ② 새 연락처 */
  const today = td();
  const newCs = adds.filter((a) => !a.c).map((a) => {
    const v = a.v;
    const c = { id: nextContactId(), nameKo: v.nameKo, nameEn: v.nameEn, orgKo: v.orgKo, orgEn: v.orgEn,
      titleKo: v.titleKo, titleEn: v.titleEn, deptKo: v.deptKo, deptEn: v.deptEn, country: v.country,
      email1: v.email1, phone1: v.phone1, lang: HANGUL.test(v.nameKo) ? 'KO' : 'EN', source: src, date: today, status: 'new',
      org_id: orgIdForName(v.orgKo || v.orgEn) || '' };
    a.c = c;
    return c;
  });
  if(newCs.length){
    const r = await postToSheet({ sheet: 'contacts', action: 'batchUpsert', dataRows: newCs.map((c) => ({ ...c, id: String(c.id) })) }, '명단 맞추기 · 새 연락처');
    if(r.ok) contacts.push(...newCs); else { fail.push('새 연락처'); adds.forEach((a) => { if(newCs.includes(a.c)) a.c = null; }); }
  }

  /* ③ 바뀐 값 */
  const patches = chs.map((x) => {
    const c = x.c, p = { id: String(c.id) };
    x.diffs.forEach((d) => {
      if(d.keepOld && d.from && !s(c[d.keepOld])) p[d.keepOld] = d.from;
      p[d.col] = d.to;
      if(d.org){ p[d.col === 'orgKo' ? 'orgEn' : 'orgKo'] = ''; p.org_id = orgIdForName(d.to) || ''; }
    });
    return { c, p };
  });
  if(patches.length){
    const r = await postToSheet({ sheet: 'contacts', action: 'batchUpsert', dataRows: patches.map((x) => x.p) }, '명단 맞추기 · 바뀐 값');
    if(r.ok) patches.forEach(({ c, p }) => Object.assign(c, p, { id: c.id })); else fail.push('바뀐 값');
  }

  /* ④ 참가 기록 — 새로 들어온 사람에게 이 역할 */
  const parts = adds.filter((a) => a.c && !participations.some((p) => evOf(p) === st.evKey && p.role === st.role && String(p.contactId) === String(a.c.id)))
    .map((a, i) => ({ id: `P-${Date.now()}-${i}`, eventId: st.evKey, event: st.evKey, contactId: a.c.id, contact: '', role: st.role,
      note: `명단 맞추기(${st.fileName})`, matched: '📋 명단 맞추기', confirmedAt: st.confirm ? today : '' }));
  if(parts.length){
    const r = await postToSheet({ sheet: 'participations', action: 'batchAppend',
      rows: parts.map((p) => [p.id, p.eventId, '', String(p.contactId), '', '', '', p.role, p.note, p.matched, p.confirmedAt]) }, '명단 맞추기 · 참가 기록');
    if(r.ok) participations.push(...parts); else fail.push('참가 기록');
  }

  /* ⑤ 빠진 사람 — 이 역할 기록만 */
  if(drops.length){
    const ids = drops.map((x) => x.p.id);
    const r = await postToSheet({ sheet: 'participations', action: 'delete', row: ids }, '명단 맞추기 · 빠진 사람');
    if(r.ok) ids.forEach((id) => { const k = participations.findIndex((p) => p.id === id); if(k >= 0) participations.splice(k, 1); });
    else fail.push('빠진 사람');
  }

  trackAction('update', '명단 맞추기', st.evKey,
    `${st.role} · ${st.fileName} — 새로 ${parts.length}(새 연락처 ${newCs.length}) · 바뀐 값 ${patches.length} · 빠짐 ${drops.length}`
    + (drops.length ? ` [${drops.map((x) => personName(x.c)).join(', ')}]` : ''));
  window.invalidateEvRows?.();
  window.renderEvDb?.();
  closeRosterSync();
  alert(fail.length ? `일부를 저장하지 못했어요: ${fail.join(', ')}\n나머지는 반영했어요. 새로고침한 뒤 다시 맞춰 보세요.`
    : `반영했어요 — 새로 ${parts.length}명(새 연락처 ${newCs.length}) · 바뀐 값 ${patches.length}명 · 빠짐 ${drops.length}명`);
}

window.openRosterSync = openRosterSync;
window.closeRosterSync = closeRosterSync;
window.rosterSyncRole = rosterSyncRole;
window.rosterSyncPick = rosterSyncPick;
window.rosterSyncConfirm = rosterSyncConfirm;
window.rosterSyncFile = rosterSyncFile;
window.applyRosterSync = applyRosterSync;
