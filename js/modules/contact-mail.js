/* ══════════════════════════════════════════════════════════════
   contact-mail.js — 컨택 DM: 차수 명단에 메일 보내기

   «주선신청 안내 메일 돌리기»는 명단 수백 곳에 같은 안내를 보내는 일이다. 한 통에
   모두를 넣으면 서로의 주소가 보이고 기록도 기업마다 남지 않는다. 그래서 전시의
   «여러 기업에 메일»(exh-bulkmail.js)처럼 기업마다 한 통씩 따로 보낸다.
   보낸 것은 서버가 그 기업의 컨택 기록에 «DM · 보냄»으로 남긴다(routes/mail.js).

   - 받는 곳: 이 차수 명단 중 고른 곳. 처음엔 «보낼 차례»(걸 차례·다시 걸 차례)인 곳이 골라져 있다
   - 받는 사람: 한 명(최근 연락한 사람, 없으면 메일 있는 첫 사람) / 메일 있는 담당자 모두
   - 언어: 기업별 자동(기업DB 국가가 한국이 아니면 영문) / 모두 국문 / 모두 영문
   - 문구: 차수에 저장한 양식(contact_rounds.mail_*). {기업}·{담당자}·{행사}는 기업마다 채운다
   - 보낸 뒤 다음 연락일은 «보냄»과 같이 +3일
══════════════════════════════════════════════════════════════ */
import { CONTACT_ATTEMPTS, EVENT_LIST, currentUser } from '../state.js';
import { sendMail, eventMailFrom, saveRound, saveAttempt, saveRoundMember } from '../api.js';
import { escapeHtml, escAttr, nowStamp } from '../utils.js';
import { trackAction } from './audit-tab.js';
import { varPattern, eventVarValues } from './mail-vars.js';
import { varChipsHtml } from './var-chips.js';
import { libItems, libItem } from './mail-templates.js';
import {
  roundById, membersOf, attemptsOf, memberState, memberName, peopleOf, coOf, evLabel, renderRoundNav, pickedPersonId,
} from './contact-tab.js';

const NEXT_DAYS = 3;
const KO = /^(한국|대한민국|korea|republic of korea|south korea|kr)$/i;
let cm = null;   // { rid, ids:Set, who, lang, tpl, sending }

const isEn = (m) => { const c = coOf(m.org_id)?.country; return !!c && !KO.test(String(c).trim()); };
const enOf = (m) => (cm.lang === 'en' ? true : cm.lang === 'ko' ? false : isEn(m));
/* ── 받는 곳 ──
   받는 곳 하나 = { id, name, nameEn, emails[], rep }. 담당자는 연락처 id, 대표 메일은 REP.

   1) 담당자 메일이 있으면 담당자에게 — 한 명(최근 연락한 사람 먼저) 또는 «모두»
   2) 메일 있는 담당자가 없으면 기업DB «대표 메일»로 — 담당자 이름을 몰라 {담당자}는
      «담당자»(영문 Sir/Madam)로 채워지고, 기록에는 «대표 메일»로 남는다(contact_id 없음)
   3) 둘 다 없으면 못 보낸다
   대표 메일은 담당자가 있을 때 덧붙이지 않는다 — 같은 회사에 두 통이 간다. 꼭 같이 보내야 하면
   «이 기업에 메일»(한 기업) 창에서 대표 메일을 함께 체크한다.
   담당자 메일은 메일1이 없으면 메일2를 쓴다. */
export const REP = 'co';
const isMail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const mailOfPerson = (p) => [p.email1, p.email2].map(e => String(e || '').trim()).find(isMail) || '';
/* 기업DB «대표 메일» — 쉼표·세미콜론으로 여러 개 적힌 곳도 있다 */
export const repMails = (m) => [...new Set(String(coOf(m.org_id)?.email || '').split(/[,;\s]+/).map(e => e.trim()).filter(isMail))];
const personRcpt = (p) => ({ id: String(p.id), name: p.nameKo || p.nameEn || '', nameEn: p.nameEn || p.nameKo || '', emails: [mailOfPerson(p)], rep: false });
const repRcpt = (m) => { const e = repMails(m); return e.length ? { id: REP, name: '', nameEn: '', emails: e, rep: true } : null; };
const mailable = (m) => peopleOf(m).filter(mailOfPerson).map(personRcpt);
/* 이 기업에 보낼 수 있는 곳 전부 — 한 기업 창의 체크 목록 */
const allRcpts = (m) => [...mailable(m), repRcpt(m)].filter(Boolean);
function peopleTo(m, who){
  // 한 기업만 보낼 때는 창에서 체크한 곳들(담당자·대표 메일)
  if(cm && cm.only === m.id) return allRcpts(m).filter(r => cm.toIds.has(r.id));
  const ppl = mailable(m);
  if(!ppl.length){ const r = repRcpt(m); return r ? [r] : []; }
  if(who === 'all') return ppl;
  const lastCid = attemptsOf(m.id)[0]?.contact_id;
  return [ppl.find(p => p.id === String(lastCid)) || ppl[0]];
}
const toOf = (rs) => [...new Set(rs.flatMap(r => r.emails))];
const rcptLabel = (rs) => rs.map(r => r.rep ? `대표 메일 ${r.emails.join(', ')}` : r.emails.join(', ')).join(', ');
const isTurn = (m) => ['todo', 'again'].includes(memberState(m));
function addDays(n){
  const d = new Date(); d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fill(t, m, person, en){
  const ev = EVENT_LIST.find(e => e.key === roundById(cm.rid)?.event_id) || {};
  // 대표 메일로 가는 곳은 이름이 없다 — {담당자}는 «담당자»/Sir/Madam
  const nm = person ? (en ? person.nameEn : person.name) : '';
  const co = coOf(m.org_id);
  const vars = {
    ...eventVarValues(ev.key, en),   // {행사일}·{장소}·{주최}… 행사 칸(mail-vars.js)
    기업: en ? (co?.nameEn || memberName(m)) : memberName(m),
    담당자: nm || (en ? 'Sir/Madam' : '담당자'),
    행사: (en ? (ev.name_en || ev.name) : ev.name) || evLabel(ev.key),
  };
  return String(t || '').replace(varPattern('contact'), (_, k) => vars[k] ?? '');
}

/* mid를 주면 그 기업 한 곳만 — 카드의 «✉ 이 기업에 메일». 받는 사람은 카드에서
   고른 사람이 먼저 체크돼 있고, 창에서 담당자를 더하거나 뺀다 */
export function openRoundMail(rid, mid, preIds){
  const r = roundById(rid);
  if(!r) return;
  cm = { rid, ids: new Set(), who: 'one', lang: 'auto', sending: false, only: null, toIds: new Set(),
    tpl: { subject_ko: r.mail_subject_ko || '', body_ko: r.mail_body_ko || '', subject_en: r.mail_subject_en || '', body_en: r.mail_body_en || '' } };
  const m = mid && membersOf(rid).find(x => x.id === mid);
  if(m){
    cm.only = m.id;
    cm.ids = new Set([m.id]);
    const ppl = mailable(m);
    const pid = pickedPersonId(m);
    // 카드에서 고른 담당자 — 메일 있는 담당자가 없으면 대표 메일
    const first = ppl.find(p => p.id === String(pid)) || ppl[0] || repRcpt(m);
    cm.toIds = new Set(first ? [first.id] : []);
  } else if(Array.isArray(preIds) && preIds.length){
    // 오늘 할 컨택에서 «미연결 n번 이상» 곳을 넘겨받았다 — 그 곳만 골라 둔다
    cm.ids = new Set(preIds.filter(id => { const x = membersOf(rid).find(y => y.id === id); return x && peopleTo(x, cm.who).length; }));
  } else pickTurn();
  render();
}
export function rmTo(id, on){ if(!cm) return; on ? cm.toIds.add(String(id)) : cm.toIds.delete(String(id)); render(); }
const close = () => { document.getElementById('round-mail')?.remove(); cm = null; };
function pickTurn(){
  cm.ids = new Set(membersOf(cm.rid).filter(m => isTurn(m) && peopleTo(m, cm.who).length).map(m => m.id));
}

function render(){
  if(!cm) return;
  const r = roundById(cm.rid);
  const list = cm.only ? membersOf(cm.rid).filter(m => m.id === cm.only)
    : membersOf(cm.rid).slice().sort((a, b) => isTurn(b) - isTurn(a) || memberName(a).localeCompare(memberName(b), 'ko'));
  const picked = list.filter(m => cm.ids.has(m.id));
  const sample = picked[0];
  const sp = sample && peopleTo(sample, cm.who)[0];
  const prev = sample ? { s: fill(cm.tpl[enOf(sample) ? 'subject_en' : 'subject_ko'], sample, sp, enOf(sample)),
    b: fill(cm.tpl[enOf(sample) ? 'body_en' : 'body_ko'], sample, sp, enOf(sample)) } : null;
  const opt = (v, cur, l) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
  const ST = { todo: '보낼 차례', again: '다시 보낼 차례', wait: '기다림', done: '끝남' };
  let el = document.getElementById('round-mail');
  if(!el){
    el = document.createElement('div');
    el.id = 'round-mail';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div style="background:var(--W);border-radius:12px;width:min(980px,100%);max-height:92vh;overflow:auto;padding:16px 18px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <div style="font-size:14px;font-weight:700">메일 보내기 — ${cm.only && list[0] ? `${escapeHtml(memberName(list[0]))} <span style="font-weight:400;color:var(--i4)">· ${escapeHtml(r.name)}</span>` : escapeHtml(r.name)}</div>
      <span style="font-size:11px;color:var(--i4)">${cm.only ? '이 기업에 한 통 — 컨택 기록에 «DM · 보냄»으로 남깁니다' : '기업마다 한 통씩 따로 보내고 그 기업 컨택 기록에 «DM · 보냄»으로 남깁니다'}</span>
      <button class="drcls" style="margin-left:auto" onclick="closeRoundMail()">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div><div class="mlbl">언어</div><select class="fi" onchange="rmSet('lang',this.value)">${opt('auto', cm.lang, '기업별 자동 (해외는 영문)')}${opt('ko', cm.lang, '모두 국문')}${opt('en', cm.lang, '모두 영문')}</select></div>
      ${cm.only ? '<div></div>' : `<div><div class="mlbl">받는 사람</div><select class="fi" onchange="rmSet('who',this.value)">${opt('one', cm.who, '한 명 (최근 연락한 사람)')}${opt('all', cm.who, '메일 있는 담당자 모두')}</select></div>`}
    </div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:14px">
      ${cm.only && list[0] ? `<div>
        <div class="mlbl" style="margin:0 0 4px">받는 사람 — 체크한 사람 모두가 한 통의 받는 사람이 돼요</div>
        <div style="border:1px solid var(--i6);border-radius:8px;max-height:360px;overflow:auto">
          ${peopleOf(list[0]).map(p => { const mail = mailOfPerson(p), has = !!mail; return `<label style="display:flex;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--i8);font-size:11.5px;opacity:${has ? 1 : .5}">
            <input type="checkbox" ${cm.toIds.has(String(p.id)) ? 'checked' : ''} ${has ? '' : 'disabled'} onchange="rmTo('${escAttr(String(p.id))}',this.checked)">
            <b>${escapeHtml(p.nameKo || p.nameEn || '')}</b><span style="color:var(--i4)">${escapeHtml([p.deptKo, p.titleKo].filter(Boolean).join(' '))}</span>
            <span style="color:var(--i3);margin-left:auto">${has ? escapeHtml(mail) : '메일 없음'}</span></label>`; }).join('')}
          ${(() => { const rp = repRcpt(list[0]); return rp ? `<label style="display:flex;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--i8);font-size:11.5px">
            <input type="checkbox" ${cm.toIds.has(REP) ? 'checked' : ''} onchange="rmTo('${REP}',this.checked)">
            <span class="pill p-gray" style="font-size:9.5px">대표 메일</span><span style="color:var(--i4)">기업DB</span>
            <span style="color:var(--i3);margin-left:auto">${escapeHtml(rp.emails.join(', '))}</span></label>`
            : `<div style="padding:6px 8px;font-size:11px;color:var(--i4)">기업DB에 대표 메일이 없어요</div>`; })()}
        </div>
      </div>` : `<div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <div class="mlbl" style="margin:0">받는 곳 ${picked.length}/${list.length}</div>
          <button class="btn" style="font-size:10px;margin-left:auto" onclick="rmAll('turn')" title="걸 차례·다시 걸 차례인 곳만">보낼 차례만</button>
          <button class="btn" style="font-size:10px" onclick="rmAll('miss')" title="부재중·번호 오류·반송이 차수에 정한 횟수 이상 이어진 곳 — 전화로 안 닿는 곳">미연결만</button>
          <button class="btn" style="font-size:10px" onclick="rmAll(true)">전체</button>
          <button class="btn" style="font-size:10px" onclick="rmAll(false)">해제</button>
        </div>
        <div style="border:1px solid var(--i6);border-radius:8px;max-height:360px;overflow:auto">
          ${list.map(m => { const ps = peopleTo(m, cm.who); const st = memberState(m); return `<label style="display:flex;gap:6px;align-items:center;padding:5px 8px;border-bottom:1px solid var(--i8);font-size:11.5px;opacity:${ps.length ? 1 : .5}">
            <input type="checkbox" ${cm.ids.has(m.id) ? 'checked' : ''} ${ps.length ? '' : 'disabled'} onchange="rmPick('${escAttr(m.id)}',this.checked)">
            <b style="flex:0 0 auto">${escapeHtml(memberName(m))}</b>
            <span class="pill p-gray" style="font-size:9.5px">${enOf(m) ? 'EN' : 'KO'}</span>
            <span class="pill ${isTurn(m) ? 'p-blue' : 'p-gray'}" style="font-size:9.5px">${ST[st]}</span>
            ${ps[0]?.rep ? '<span class="pill p-gray" style="font-size:9.5px" title="메일 있는 담당자가 없어 기업DB 대표 메일로 보내요">대표 메일</span>' : ''}
            <span style="color:var(--i4);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ps.length ? escapeHtml(toOf(ps).join(', ')) : '메일 없음 — 담당자·대표 메일 모두 없어요'}</span>
          </label>`; }).join('') || '<div style="padding:12px;font-size:11.5px;color:var(--i4)">명단이 비어 있어요</div>'}
        </div>
      </div>`}
      <div>
        ${(() => { const libs = libItems('contact', r.event_id); return `<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
          <select class="fi" style="font-size:11.5px;flex:1" onchange="rmLib(this.value);this.value=''">
            <option value="">📚 양식 보관함에서 불러오기${libs.length ? '' : ' — 아직 없어요'}</option>
            ${libs.map(it => `<option value="${escAttr(it.id)}">${escapeHtml(it.name)}${it.scope === 'all' ? ' · 공통' : ''}</option>`).join('')}</select>
          <button class="btn" style="font-size:10.5px" title="컨택 메일 양식을 더하고 고칩니다 — 이 행사만 또는 모든 행사 공통"
            onclick="openMailTemplates('contact','${escAttr(r.event_id || '')}')">양식 보관함</button></div>`; })()}
        <details${cm.lang !== 'en' ? ' open' : ''}><summary style="cursor:pointer;font-size:11.5px;font-weight:700;margin-bottom:4px">국문 문구</summary>
          <input class="fi" style="font-size:11.5px;margin-bottom:4px" placeholder="[{행사}] 비즈니스 상담회 주선신청 안내" value="${escapeHtml(cm.tpl.subject_ko)}" oninput="rmTpl('subject_ko',this.value)">
          <textarea class="fi" rows="7" style="font-size:11.5px;width:100%" placeholder="{기업} {담당자}님, 안녕하세요." oninput="rmTpl('body_ko',this.value)">${escapeHtml(cm.tpl.body_ko)}</textarea></details>
        <details${cm.lang === 'en' ? ' open' : ''} style="margin-top:6px"><summary style="cursor:pointer;font-size:11.5px;font-weight:700;margin-bottom:4px">영문 문구</summary>
          <input class="fi" style="font-size:11.5px;margin-bottom:4px" value="${escapeHtml(cm.tpl.subject_en)}" oninput="rmTpl('subject_en',this.value)">
          <textarea class="fi" rows="7" style="font-size:11.5px;width:100%" placeholder="Dear {담당자}," oninput="rmTpl('body_en',this.value)">${escapeHtml(cm.tpl.body_en)}</textarea></details>
        ${varChipsHtml('contact', { ev: r.event_id })}
        <div style="font-size:10.5px;color:var(--i4);margin-top:4px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span>칸은 기업마다 채워집니다.</span>
          <a href="javascript:void(0)" onclick="saveRoundMailTpl()" style="color:var(--a)">이 문구를 차수 양식으로 저장</a>
          <span id="rm-saved" style="color:var(--g)"></span></div>
        ${prev ? `<div style="margin-top:10px;padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;font-size:11.5px;white-space:pre-wrap;line-height:1.55;max-height:220px;overflow:auto"><div style="font-size:10px;color:var(--i4);margin-bottom:4px">미리보기 — ${escapeHtml(memberName(sample))}</div><b>${escapeHtml(prev.s)}</b>\n\n${escapeHtml(prev.b)}</div>` : ''}
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:12px">
      <button class="btn bp" onclick="sendRoundMail()" ${picked.length && !cm.sending ? '' : 'disabled'}>${cm.only ? '보내기' : `${picked.length}곳에 보내기`}</button>
      <span id="rm-msg" style="font-size:11px;color:var(--i4)"></span>
    </div>
  </div>`;
}

export function rmSet(k, v){
  if(!cm || cm.sending) return;
  cm[k] = v;
  if(k === 'who') membersOf(cm.rid).forEach(m => { if(!peopleTo(m, v).length) cm.ids.delete(m.id); });
  render();
}
export function rmPick(id, on){ if(!cm) return; on ? cm.ids.add(id) : cm.ids.delete(id); render(); }
export function rmAll(on){
  if(!cm) return;
  if(on === 'turn') pickTurn();
  else if(on === 'miss'){
    const r = roundById(cm.rid);
    const lim = +r?.noanswer_limit || 4;
    const streak = (m) => { let n = 0; for(const a of attemptsOf(m.id)){ if(['noanswer', 'wrongnum', 'bounce'].includes(a.reaction)) n++; else break; } return n; };
    cm.ids = new Set(membersOf(cm.rid).filter(m => memberState(m) !== 'done' && streak(m) >= lim && peopleTo(m, cm.who).length).map(m => m.id));
  }
  else cm.ids = new Set(on ? membersOf(cm.rid).filter(m => peopleTo(m, cm.who).length).map(m => m.id) : []);
  render();
}
// 문구는 다시 그리지 않고 담아만 둔다 — 그리면 입력 중인 칸이 초기화된다
export function rmTpl(k, v){ if(cm) cm.tpl[k] = v; }

/* 양식 보관함에서 불러오기 — 이번 창의 문구만 바꾼다. 차수 양식으로 남기려면 «차수 양식으로 저장» */
export function rmLib(id){
  const it = cm && id && libItem(id);
  if(!it) return;
  const has = Object.values(cm.tpl).some(v => String(v || '').trim());
  if(has && !confirm(`지금 문구를 «${it.name}» 양식으로 바꿀까요?`)) return;
  cm.tpl = { subject_ko: it.subject_ko || '', body_ko: it.body_ko || '', subject_en: it.subject_en || '', body_en: it.body_en || '' };
  render();
}
/* 양식 보관함을 고치면(mail-templates.js refreshAll) 불러오기 목록을 다시 그린다 — 문구는 cm.tpl에 담겨 있어 그대로 */
export function refreshRoundMail(){ if(cm && document.getElementById('round-mail')) render(); }

export async function saveRoundMailTpl(){
  const r = cm && roundById(cm.rid);
  if(!r) return;
  const data = { mail_subject_ko: cm.tpl.subject_ko, mail_body_ko: cm.tpl.body_ko, mail_subject_en: cm.tpl.subject_en, mail_body_en: cm.tpl.body_en };
  const before = Object.fromEntries(Object.keys(data).map(k => [k, r[k] || '']));
  Object.assign(r, data);
  const res = await saveRound({ id: r.id, ...data });
  if(!res.ok){ Object.assign(r, before); return; }
  const s = document.getElementById('rm-saved'); if(s) s.textContent = '저장했어요';
  trackAction('edit', '컨택 DM 양식', r.name, `차수 «${escapeHtml(r.name)}»의 메일 양식을 고침`);
}

export async function sendRoundMail(){
  if(!cm || cm.sending) return;
  const r = roundById(cm.rid);
  const msg = (t, ok) => { const m = document.getElementById('rm-msg'); if(m){ m.style.color = ok ? 'var(--g)' : 'var(--re)'; m.textContent = t; } };
  const list = membersOf(cm.rid).filter(m => cm.ids.has(m.id));
  if(!list.length){ msg('받을 곳을 골라주세요.'); return; }
  const needEn = list.some(m => enOf(m)), needKo = list.some(m => !enOf(m));
  if((needKo && !cm.tpl.subject_ko.trim() && !cm.tpl.body_ko.trim()) || (needEn && !cm.tpl.subject_en.trim() && !cm.tpl.body_en.trim())){
    msg(`${needKo && needEn ? '국문·영문' : needEn ? '영문' : '국문'} 문구를 채워주세요.`); return;
  }
  const from = await eventMailFrom(r.event_id);
  if(!from.ok){ msg(from.text); return; }
  if(cm.only){
    const rs = peopleTo(list[0]);
    const to = toOf(rs);
    if(!to.length){ msg('받는 사람을 체크해 주세요.'); return; }
    if(!confirm(`«${memberName(list[0])}»에 «${r.name}» 메일을 보낼까요?

받는 사람: ${rcptLabel(rs)}
발신 ${from.text}`)) return;
  }
  const notTurn = list.filter(m => !isTurn(m)).length;
  const viaRep = cm.only ? 0 : list.filter(m => peopleTo(m, cm.who)[0]?.rep).length;
  // 밖으로 나가는 일 — 한 번 묻는다
  if(!cm.only && !confirm(`${list.length}곳에 «${r.name}» 메일을 보낼까요?${notTurn ? `\n\n이 중 ${notTurn}곳은 보낼 차례가 아니에요(기다림·끝남).` : ''}\n\n발신 ${from.text}\n받는 사람: ${cm.who === 'all' ? '메일 있는 담당자 모두' : '한 명'}${viaRep ? `\n이 중 ${viaRep}곳은 메일 있는 담당자가 없어 기업 대표 메일로 갑니다.` : ''}\n기업마다 한 통씩 따로 나갑니다.`)) return;

  cm.sending = true;
  render();
  let ok = 0;
  const fails = [];
  const next = addDays(NEXT_DAYS);
  for(const [i, m] of list.entries()){
    msg(`보내는 중… ${i + 1}/${list.length} ${memberName(m)}`, true);
    const ppl = peopleTo(m, cm.who);
    const p = ppl.find(x => !x.rep) || ppl[0];   // {담당자}는 사람 이름 먼저
    const en = enOf(m);
    const subject = fill(cm.tpl[en ? 'subject_en' : 'subject_ko'], m, p, en);
    const text = fill(cm.tpl[en ? 'body_en' : 'body_ko'], m, p, en);
    const to = toOf(ppl);
    if(!to.length){ fails.push(`${memberName(m)}: 받는 메일 없음`); continue; }
    // 대표 메일만 받는 곳은 사람이 아니다 — 기록에 «대표 메일»로 남기고 contact_id는 비운다
    const person = ppl.find(x => !x.rep);
    const contact_name = person ? person.name : '대표 메일';
    const res = await sendMail({ to, subject, text, round_member_id: m.id, event_id: r.event_id,
      contact_id: person ? person.id : '', contact_name, category: r.name, kind: 'contact-dm' });
    if(!res.ok){ fails.push(`${memberName(m)}: ${res.error || '실패'}`); continue; }
    ok++;
    const a = { id: res.logId || `CA-${Date.now()}_${i}`, round_id: r.id, member_id: m.id, org_id: m.org_id,
      contact_id: person ? person.id : '', contact_name, phone: to.join(', '), channel: 'DM', at: nowStamp(),
      by_email: currentUser?.email || '', by_name: currentUser?.name || '', reaction: 'sent', note: subject };
    CONTACT_ATTEMPTS.push(a);
    // 서버가 기록을 못 남겼으면(예전 서버) 여기서 남긴다 — 메일은 이미 나갔다
    if(!res.logged) await saveAttempt(a);
    if(!m.closed_at && !m.goal_at){ m.next_at = next; await saveRoundMember({ id: m.id, next_at: next }); }
  }
  trackAction('add', '컨택 DM 보냄', r.name, `«${escapeHtml(r.name)}» ${ok}곳 보냄${fails.length ? ` · 실패 ${fails.length}곳` : ''}`);
  cm.sending = false;
  if(!cm.only) pickTurn();   // 보낸 곳은 «기다림»으로 넘어가 빠진다
  render();
  msg(`${ok}곳에 보냈어요${fails.length ? ` — 실패 ${fails.length}곳: ${fails.slice(0, 5).join(' / ')}${fails.length > 5 ? ' …' : ''}` : ''}`, !fails.length);
  window.renderCrm?.(); renderRoundNav();
}

Object.assign(window, { openRoundMail, rmLib, refreshRoundMail, rmTo, closeRoundMail: close, rmSet, rmPick, rmAll, rmTpl, saveRoundMailTpl, sendRoundMail });
