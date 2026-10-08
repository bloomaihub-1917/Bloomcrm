/* ══════════════════════════════════════════════════════════════
   exh-bulkmail.js — 여러 참가사에 같은 안내를 한 번에

   «매뉴얼 보냈나», «그래픽 마감 안내 다 돌렸나»는 기업 수십 곳에 같은 메일을
   보내는 일이다. 한 통에 모두를 수신으로 넣으면 서로의 주소가 보이고, 기록도
   기업마다 남지 않는다. 그래서 기업마다 따로 한 통씩 보내고 그 기업 기록에 남긴다.

   - 받는 곳: 지금 전시 목록에서 걸러 보고 있는 기업(visibleList) 중 체크한 곳
   - 문구: 전시 메일 양식(exh-mail.js)의 단계 문구. 여기서 고친 문구는 이번 발송에만 쓴다
   - 언어: 기업별 자동(기업DB 국가) / 모두 국문 / 모두 영문
   - 받는 사람: 메인 담당자만 / 메일 있는 담당자 모두
   - 첨부: 그 단계의 기본 첨부(설정 › 행사 › 메일)
══════════════════════════════════════════════════════════════ */
import { EXH_LOGS, EXHIBITORS, currentUser, getExhibitorById } from '../state.js';
import { sendMail, eventMailFrom, loadMailFiles, mailFilesOf } from '../api.js';
import { escapeHtml, escAttr, nowStamp } from '../utils.js';
import { visibleList, exhNames, exhContacts, exhMailCtx, exhLocked, exhLockNotice } from './exh-tab.js';
import { exhMailSteps, exhIsEnglish, fillExhTemplate, exhMailFileStep } from './exh-mail.js';
import { trackAction } from './audit-tab.js';
import './exh-mail-editor.js';

let bm = null;   // { evKey, ids:Set, step, lang, who, tpl:{subject_ko,...}, sending }

const close = () => { document.getElementById('exh-bulkmail')?.remove(); bm = null; };
const mailsOf = (x, who) => {
  const ppl = exhContacts(x).filter(p => p.email);
  const pick = who === 'all' ? ppl : [ppl.find(p => p.primary) || ppl[0]].filter(Boolean);
  return [...new Set(pick.map(p => String(p.email).trim()).filter(Boolean))];
};
const enOf = (x) => bm.lang === 'en' ? true : bm.lang === 'ko' ? false : exhIsEnglish(x);

/* stepKey를 주면 그 단계가 골라진 채로 연다(전시 메일 단계 편집 창의 «📨 여러 기업에») */
export async function openExhBulkMail(stepKey){
  const list = visibleList();
  if(!list.length){ alert('지금 전시 목록에 기업이 없어요 — 전시 탭에서 행사를 열고 보내 주세요.'); return; }
  const evKey = list[0].event_id;
  const steps = exhMailSteps(evKey);
  if(!steps.length){ alert('이 행사에 켜진 메일 단계가 없어요.'); return; }
  const st = steps.find(s => s.key === stepKey) || steps[0];
  bm = { evKey, ids: new Set(list.filter(x => mailsOf(x, 'primary').length).map(x => x.id)),
    step: st.key, lang: 'auto', who: 'primary', tpl: pickTpl(evKey, st.key), sending: false };
  await loadMailFiles(evKey);
  render();
}
function pickTpl(evKey, key){
  const st = exhMailSteps(evKey).find(s => s.key === key) || {};
  return { subject_ko: st.subject_ko || '', body_ko: st.body_ko || '', subject_en: st.subject_en || '', body_en: st.body_en || '' };
}

function render(){
  if(!bm) return;
  const list = visibleList();
  const steps = exhMailSteps(bm.evKey);
  const st = steps.find(s => s.key === bm.step);
  const files = mailFilesOf(bm.evKey).filter(f => f.step === exhMailFileStep(bm.step));
  const picked = list.filter(x => bm.ids.has(x.id));
  const sample = picked[0];
  const prev = sample ? {
    s: fillExhTemplate(bm.tpl[enOf(sample) ? 'subject_en' : 'subject_ko'], sample, st, enOf(sample), exhMailCtx(sample)),
    b: fillExhTemplate(bm.tpl[enOf(sample) ? 'body_en' : 'body_ko'], sample, st, enOf(sample), exhMailCtx(sample)),
  } : null;
  const opt = (v, cur, l) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
  let el = document.getElementById('exh-bulkmail');
  if(!el){
    el = document.createElement('div');
    el.id = 'exh-bulkmail';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div style="background:var(--W);border-radius:12px;width:min(980px,100%);max-height:92vh;overflow:auto;padding:16px 18px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <div style="font-size:14px;font-weight:700">여러 기업에 메일</div>
      <span style="font-size:11px;color:var(--i4)">기업마다 한 통씩 따로 보내고 그 기업 기록에 남깁니다</span>
      <button class="drcls" style="margin-left:auto" onclick="closeExhBulkMail()">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">
      <div><div class="mlbl">무슨 메일인가</div><select class="fi" onchange="bmSet('step',this.value)">${steps.map(s => opt(s.key, bm.step, escapeHtml(s.label))).join('')}</select></div>
      <div><div class="mlbl">언어</div><select class="fi" onchange="bmSet('lang',this.value)">${opt('auto', bm.lang, '기업별 자동 (해외는 영문)')}${opt('ko', bm.lang, '모두 국문')}${opt('en', bm.lang, '모두 영문')}</select></div>
      <div><div class="mlbl">받는 사람</div><select class="fi" onchange="bmSet('who',this.value)">${opt('primary', bm.who, '메인 담당자만')}${opt('all', bm.who, '메일 있는 담당자 모두')}</select></div>
    </div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:14px">
      <div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <div class="mlbl" style="margin:0">받는 기업 ${picked.length}/${list.length}</div>
          <button class="btn" style="font-size:10px;margin-left:auto" onclick="bmAll(true)">전체</button>
          <button class="btn" style="font-size:10px" onclick="bmAll(false)">해제</button>
        </div>
        <div style="border:1px solid var(--i6);border-radius:8px;max-height:360px;overflow:auto">
          ${list.map(x => { const ms = mailsOf(x, bm.who); return `<label style="display:flex;gap:6px;align-items:center;padding:5px 8px;border-bottom:1px solid var(--i8);font-size:11.5px;cursor:${ms.length ? 'pointer' : 'default'};opacity:${ms.length ? 1 : .5}">
            <input type="checkbox" ${bm.ids.has(x.id) ? 'checked' : ''} ${ms.length ? '' : 'disabled'} onchange="bmPick('${escAttr(x.id)}',this.checked)">
            <b style="flex:0 0 auto">${escapeHtml(exhNames(x).ko)}</b>
            <span class="pill p-gray" style="font-size:9.5px">${enOf(x) ? 'EN' : 'KO'}</span>
            <span style="color:var(--i4);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ms.length ? escapeHtml(ms.join(', ')) : '메일 있는 담당자 없음'}</span>
          </label>`; }).join('')}
        </div>
      </div>
      <div>
        <details${bm.lang !== 'en' ? ' open' : ''}><summary style="cursor:pointer;font-size:11.5px;font-weight:700;margin-bottom:4px">국문 문구</summary>
          <input class="fi" style="font-size:11.5px;margin-bottom:4px" value="${escAttr(bm.tpl.subject_ko)}" oninput="bmTpl('subject_ko',this.value)">
          <textarea class="fi" rows="7" style="font-size:11.5px;width:100%" oninput="bmTpl('body_ko',this.value)">${escapeHtml(bm.tpl.body_ko)}</textarea></details>
        <details${bm.lang === 'en' ? ' open' : ''} style="margin-top:6px"><summary style="cursor:pointer;font-size:11.5px;font-weight:700;margin-bottom:4px">영문 문구</summary>
          <input class="fi" style="font-size:11.5px;margin-bottom:4px" value="${escAttr(bm.tpl.subject_en)}" oninput="bmTpl('subject_en',this.value)">
          <textarea class="fi" rows="7" style="font-size:11.5px;width:100%" oninput="bmTpl('body_en',this.value)">${escapeHtml(bm.tpl.body_en)}</textarea></details>
        <div style="font-size:10.5px;color:var(--i4);margin-top:4px">{기업}·{담당자}·{부스}·{청구액}·{미납액}은 기업마다 채워집니다. 여기서 고친 문구는 이번 발송에만 쓰고, 기본 문구와 단계는
          <a href="#" onclick="openExhMailEditor('${escAttr(bm.evKey)}','${escAttr(bm.step)}');return false">✎ 단계 편집</a>에서 고칩니다.</div>
        ${files.length ? `<div style="font-size:11px;margin-top:6px">기본 첨부 ${files.map(f => `<span class="pill p-blue" style="margin:2px 3px 0 0">📎 ${escapeHtml(f.filename)}</span>`).join('')}</div>` : ''}
        ${prev ? `<div style="margin-top:10px;padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;font-size:11.5px;white-space:pre-wrap;line-height:1.55;max-height:220px;overflow:auto"><div style="font-size:10px;color:var(--i4);margin-bottom:4px">미리보기 — ${escapeHtml(exhNames(sample).ko)}</div><b>${escapeHtml(prev.s)}</b>\n\n${escapeHtml(prev.b)}</div>` : ''}
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:12px">
      <button class="btn bp" onclick="sendExhBulkMail()" ${picked.length && !bm.sending ? '' : 'disabled'}>${picked.length}곳에 보내기</button>
      <span id="bm-msg" style="font-size:11px;color:var(--i4)"></span>
    </div>
  </div>`;
}

export function bmSet(k, v){
  if(!bm || bm.sending) return;
  bm[k] = v;
  if(k === 'step') bm.tpl = pickTpl(bm.evKey, v);
  if(k === 'who') visibleList().forEach(x => { if(!mailsOf(x, v).length) bm.ids.delete(x.id); });
  render();
}
export function bmPick(id, on){ if(!bm) return; on ? bm.ids.add(id) : bm.ids.delete(id); render(); }
export function bmAll(on){
  if(!bm) return;
  bm.ids = new Set(on ? visibleList().filter(x => mailsOf(x, bm.who).length).map(x => x.id) : []);
  render();
}
// 문구는 다시 그리지 않고 담아만 둔다 — 그리면 입력 중인 칸이 초기화된다
export function bmTpl(k, v){ if(bm) bm.tpl[k] = v; }

export async function sendExhBulkMail(){
  if(!bm || bm.sending) return;
  if(exhLocked()){ exhLockNotice(); return; }
  const msg = (t, ok) => { const m = document.getElementById('bm-msg'); if(m){ m.style.color = ok ? 'var(--g)' : 'var(--re)'; m.textContent = t; } };
  const list = visibleList().filter(x => bm.ids.has(x.id));
  if(!list.length){ msg('받을 기업을 골라주세요.'); return; }
  const from = await eventMailFrom(bm.evKey);
  if(!from.ok){ msg(from.text); return; }
  const steps = exhMailSteps(bm.evKey);
  const st = steps.find(s => s.key === bm.step);
  const fileIds = mailFilesOf(bm.evKey).filter(f => f.step === exhMailFileStep(bm.step)).map(f => f.id);
  // 밖으로 나가는 일 — 한 번 묻는다
  if(!confirm(`${list.length}곳에 «${st.label}» 메일을 보낼까요?\n\n발신 ${from.text}\n받는 사람: ${bm.who === 'all' ? '메일 있는 담당자 모두' : '메인 담당자'}\n기업마다 한 통씩 따로 나갑니다.`)) return;

  bm.sending = true;
  render();
  const kind = bm.step === 'note' ? 'note' : `exh-${bm.step}`;
  let ok = 0;
  const fails = [];
  for(const [i, x] of list.entries()){
    msg(`보내는 중… ${i + 1}/${list.length} ${exhNames(x).ko}`, true);
    const to = mailsOf(x, bm.who);
    const en = enOf(x), ctx = exhMailCtx(x);
    const subject = fillExhTemplate(bm.tpl[en ? 'subject_en' : 'subject_ko'], x, st, en, ctx);
    const text = fillExhTemplate(bm.tpl[en ? 'body_en' : 'body_ko'], x, st, en, ctx);
    const res = await sendMail({ to, subject, text, exhibitor_id: x.id, category: st.label, kind, file_ids: fileIds });
    if(!res.ok){ fails.push(`${exhNames(x).ko}: ${res.error || '실패'}`); continue; }
    ok++;
    if(res.logId) EXH_LOGS.push({
      id: res.logId, exhibitor_id: x.id, kind, ts: nowStamp(), direction: 'out', channel: '이메일',
      counterpart: to.join(', '), category: st.label, subject, answered_at: '', answer: '', status: 'done',
      body: text + (fileIds.length ? `\n\n[첨부] ${mailFilesOf(bm.evKey).filter(f => fileIds.includes(f.id)).map(f => f.filename).join(', ')}` : ''),
      author_email: currentUser?.email || '', author_name: currentUser?.name || '',
    });
  }
  trackAction('add', '참가사 일괄 메일', bm.evKey, `«${st.label}» ${ok}곳 보냄${fails.length ? ` · 실패 ${fails.length}곳` : ''}`);
  bm.sending = false;
  render();
  msg(`${ok}곳에 보냈어요${fails.length ? ` — 실패 ${fails.length}곳: ${fails.slice(0, 5).join(' / ')}${fails.length > 5 ? ' …' : ''}` : ''}`, !fails.length);
  window.renderExh?.();
}

/* 단계 편집 창에서 단계를 고치면 — 고른 단계가 없어졌으면 첫 단계로, 문구는 새 기본 문구로 */
window.refreshExhBulkMail = () => {
  if(!bm || bm.sending) return;
  const steps = exhMailSteps(bm.evKey);
  if(!steps.length){ close(); return; }
  if(!steps.some(s => s.key === bm.step)) bm.step = steps[0].key;
  bm.tpl = pickTpl(bm.evKey, bm.step);
  render();
};
window.openExhBulkMail = openExhBulkMail;
window.closeExhBulkMail = close;
window.bmSet = bmSet;
window.bmPick = bmPick;
window.bmAll = bmAll;
window.bmTpl = bmTpl;
window.sendExhBulkMail = sendExhBulkMail;
