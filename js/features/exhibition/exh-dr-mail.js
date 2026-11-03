/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-dr-mail.js — 참가기업 상세 › 메일 — 담당자에게 바로 보내기
   (modules/exh-drawer.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { eventMailFrom, fileToBase64, loadMailFiles, mailFilesOf, sendMail } from '../../api.js';
import { trackAction } from '../../core/audit-log.js';
import { exhIsEnglish, exhMailFileStep, exhMailSteps, exhStepVariants, fillExhTemplate } from '../../modules/exh-mail.js';
import { exhContacts, exhFollowOf, exhLockNotice, exhLocked, exhMailCtx, exhNames } from '../../modules/exh-tab.js';
import { aiDraftHtml, registerAiDraft } from '../../shared/mail/ai-mail-draft.js';
import { filterMail, mailActionsHtml, mailFilBar, mailStateHtml, mailToggleAttr, setMailDone } from '../../shared/mail/mail-mark.js';
import { libItem, libItems } from '../../shared/mail/mail-templates.js';
import { registerVarResolver, varChipsHtml } from '../../shared/mail/var-chips.js';
import { EVENT_LIST, EXH_LOGS, currentUser, getExhibitorById, logsFor } from '../../state.js';
import { escAttr, escapeHtml, mailDirPill, nowStamp } from '../../utils.js';
import { settleState } from './exh-calc.js';
import { exhDrUi } from './exh-drawer-ui.js';
import { mailBodyHtml, renderExhDr, sct, switchExhDT } from '../../modules/exh-drawer.js';

/* ══════════════════════════════════════════════════════════════
   메일 — 이 기업 담당자에게 바로 보낸다

   보내는 주소는 행사 설정 › 메일에 넣은 행사 공용 메일이다(없으면 보내지 않는다). 어느 주소로 나갈지는 서버가 이 기업의 행사를 보고 고른다 — 화면에서
   고르게 하면 다른 행사 주소로 나가는 실수가 생긴다.
   보낸 메일은 서버가 문의·기록(exhibitor_logs)에 남긴다.
══════════════════════════════════════════════════════════════ */
/* ── 회신 중 ── 받은 메일의 «↩ 회신»에서 들어온다(mail-mark.js replyMail) */
export function startExhReply(d){ exhDrUi.exhReply = { ...d, filled: false, pick: new Set() }; exhDrUi.drTab = 'mail'; renderExhDr(); }
export function toggleExhReplyFile(exhId, id){
  if(!exhDrUi.exhReply) return;
  exhDrUi.exhReply.pick.has(id) ? exhDrUi.exhReply.pick.delete(id) : exhDrUi.exhReply.pick.add(id);
  const x = getExhibitorById(exhId); if(x) renderExhDefFiles(x);
}
window.toggleExhReplyFile = toggleExhReplyFile;
export function cancelExhReply(){ exhDrUi.exhReply = null; renderExhDr(); }
function fillExhReply(x){
  const s = document.getElementById(`exm-sub-${x.id}`), b = document.getElementById(`exm-body-${x.id}`);
  if(!s || !b || !exhDrUi.exhReply) return;
  if(!exhDrUi.exhReply.filled){ exhDrUi.exhReply.filled = true; exhDrUi.exhReply.curSubject = exhDrUi.exhReply.subject; exhDrUi.exhReply.curBody = exhDrUi.exhReply.body; }
  s.value = exhDrUi.exhReply.curSubject; b.value = exhDrUi.exhReply.curBody;
  s.oninput = () => { exhDrUi.exhReply && (exhDrUi.exhReply.curSubject = s.value); };
  b.oninput = () => { exhDrUi.exhReply && (exhDrUi.exhReply.curBody = b.value); };
  b.dataset.touched = '1';
  b.focus(); b.setSelectionRange(0, 0);
  loadMailFiles(x.event_id).then(() => renderExhDefFiles(x));
}
window.startExhReply = startExhReply;
window.cancelExhReply = cancelExhReply;

/* «✨ AI로 초안 쓰기» — 회사명·담당자·금액은 보내지 않고 상태만. 돌아온 틀에 이 기업의 값을 채운다 */
registerAiDraft('ex', () => {
  const x = getExhibitorById(exhDrUi.aiExhId);
  if(!x) return null;
  const stepKey = document.getElementById(`exm-step-${x.id}`)?.value || '';
  const en = document.getElementById(`exm-lang-${x.id}`)?.value === 'en';
  const lib = String(stepKey).startsWith('lib:') ? libItem(String(stepKey).slice(4)) : null;
  const st = lib ? { label: lib.name, subject_ko: lib.subject_ko, body_ko: lib.body_ko, subject_en: lib.subject_en, body_en: lib.body_en }
    : exhMailSteps(x.event_id).find(s => s.key === stepKey) || {};
  const ctx = exhMailCtx(x);
  const state = [
    x.booth_no ? '부스 배정됨({부스} 사용 가능)' : '부스 아직 배정 전',
    ctx.billed ? `인보이스 발행됨({청구액}) · ${settleState(x).state === 'settled' ? '완납' : '미납 있음({미납액})'}` : '인보이스 발행 전',
    st.due ? '이 단계 마감일 있음({마감일})' : '',
  ].filter(Boolean);
  return { part: 'exh', ev: x.event_id, lang: en ? 'en' : 'ko', reply: !!exhDrUi.exhReply, step: exhDrUi.exhReply ? {} : st, stepLabel: st.label, state,
    apply(tpl){
      const sEl = document.getElementById(`exm-sub-${x.id}`), bEl = document.getElementById(`exm-body-${x.id}`);
      const subj = fillExhTemplate(en ? tpl.subject_en : tpl.subject_ko, x, st, en, ctx);
      const body = fillExhTemplate(en ? tpl.body_en : tpl.body_ko, x, st, en, ctx);
      if(exhDrUi.exhReply){
        // 회신은 제목을 두고, 처음 회신 초안(인용된 원래 메일) 위에 새 글을 얹는다 — 다시 눌러도 겹치지 않게
        exhDrUi.exhReply.curBody = `${body}\n\n${String(exhDrUi.exhReply.body || '').replace(/^\s+/, '')}`;
        if(bEl){ bEl.value = exhDrUi.exhReply.curBody; bEl.dataset.touched = '1'; }
        return;
      }
      if(sEl && subj) sEl.value = subj;
      if(bEl && body.trim()){ bEl.value = body; bEl.dataset.touched = '1'; }
    } };
});
function dMail(x){
  exhDrUi.aiExhId = x.id;
  /* 메일 «값 넣기» 칩 — 드로어 메일은 글 그대로 나가므로 이 기업의 실제 값을 넣는다.
     언어·마감일은 지금 고른 «언어»·«무슨 메일인가»를 따른다 */
  registerVarResolver('exh-drawer', (key) => {
    const en = document.getElementById(`exm-lang-${x.id}`)?.value === 'en';
    const stepKey = document.getElementById(`exm-step-${x.id}`)?.value || '';
    const st = exhMailSteps(x.event_id).find(s => s.key === stepKey) || {};
    return fillExhTemplate(`{${key}}`, x, st, en, exhMailCtx(x));
  });
  /* 회신 중이면 보낸 사람을 받는 사람 맨 위에(체크), 담당자는 아래에(해제)로 */
  const ppl0 = exhContacts(x).filter(p => p.email);
  const ppl = exhDrUi.exhReply
    ? [...exhDrUi.exhReply.to.map(e => ({ email: e, name: '회신 대상', primary: false, reply: true })),
       ...ppl0.filter(p => !exhDrUi.exhReply.to.includes(String(p.email).trim()))]
    : ppl0;
  const ev = EVENT_LIST.find(e => e.key === x.event_id);
  const evName = ev ? (ev.short || ev.name || ev.key) : '';
  const id = escAttr(x.id);
  const sent = logsFor(x.id).filter(l => (l.direction === 'out' || l.direction === 'in') && l.channel === '이메일')
    .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  return `
  <div class="uc" style="margin-bottom:14px">
    <div class="uc-ttl">메일 보내기</div>
    ${exhDrUi.exhReply ? `<div style="font-size:11.5px;color:var(--a);font-weight:700;margin-top:6px">↩ 회신 중 — 이 메일을 보낸 사람에게 답합니다
      <a href="#" onclick="cancelExhReply();return false" style="font-weight:400;margin-left:6px">회신 취소</a></div>` : ''}
    <div id="exm-from" style="font-size:11px;color:var(--i4);margin:6px 0 10px">보내는 주소 확인 중…</div>
    <div class="mlbl">받는 사람</div>
    <div style="display:flex;flex-direction:column;gap:4px;margin:4px 0 10px">
      ${ppl.length ? ppl.map((p, i) => `<label style="display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer">
        <input type="checkbox" class="exm-to" value="${escapeHtml(p.email)}"${(exhDrUi.exhReply ? p.reply : (p.primary || i === 0)) ? ' checked' : ''}>
        <b>${escapeHtml(p.name || '')}</b> <span style="color:var(--i4)">${escapeHtml(p.email)}</span>
        ${p.primary ? '<span class="pill p-blue" style="font-size:9.5px">메인</span>' : ''}</label>`).join('')
      : `<div style="font-size:11.5px;color:var(--re)">메일 주소가 있는 담당자가 없어요 —
          <a href="#" onclick="switchExhDT('contact');return false" style="color:var(--a)">담당자 탭</a>에서 먼저 넣어주세요.</div>`}
    </div>
    <div style="display:grid;grid-template-columns:1fr auto;gap:6px;margin-bottom:8px">
      <div><div class="mlbl">무슨 메일인가 <span style="font-size:9px;color:var(--i4)">고르면 그 단계 문구로 채워져요</span>
        <a href="#" style="font-size:10px;margin-left:4px" title="이 행사의 전시 메일 단계를 더하고, 고치고, 끄거나 지웁니다"
          onclick="openExhMailEditor('${escAttr(x.event_id)}',document.getElementById('exm-step-${id}').value);return false">✎ 단계 편집</a>
        <a href="#" style="font-size:10px;margin-left:4px" title="단계와 상관없이 꺼내 쓰는 양식 — 이 행사만 또는 모든 행사 공통"
          onclick="openMailTemplates('exh','${escAttr(x.event_id)}');return false">📚 양식 보관함</a></div>
        <select class="fi" id="exm-step-${id}" onchange="fillExhMail('${id}')" style="font-size:12px">
          <optgroup label="메일 단계">${exhMailSteps(x.event_id).map(st => `<option value="${st.key}"${st.key === exhDrUi.exhMailStep ? ' selected' : ''}>${escapeHtml(st.label)}</option>`).join('')}</optgroup>
          ${libItems('exh', x.event_id).length ? `<optgroup label="양식 보관함">${libItems('exh', x.event_id).map(it =>
            `<option value="lib:${escAttr(it.id)}"${'lib:' + it.id === exhDrUi.exhMailStep ? ' selected' : ''}>${escapeHtml(it.name)}</option>`).join('')}</optgroup>` : ''}
        </select>
        <div id="exm-var-${id}"></div></div>
      <div><div class="mlbl">언어</div>
        <select class="fi" id="exm-lang-${id}" onchange="fillExhMail('${id}')" style="font-size:12px">
          <option value="ko"${exhIsEnglish(x) ? '' : ' selected'}>국문</option><option value="en"${exhIsEnglish(x) ? ' selected' : ''}>영문</option>
        </select></div>
    </div>
    <div class="mlbl">참조 <span style="font-size:9px;color:var(--i4)">쉼표로 여러 개</span></div>
    <input class="fi" id="exm-cc-${id}" style="font-size:12px;margin-bottom:8px">
    ${aiDraftHtml('ex', { reply: !!exhDrUi.exhReply })}
    <div data-vscope>
    <div class="mlbl">제목</div>
    <input class="fi" id="exm-sub-${id}" value="${escapeHtml(evName ? `[${evName}] ` : '')}" style="font-size:12px;margin-bottom:8px">
    <div class="mlbl">내용</div>
    <textarea class="fi" id="exm-body-${id}" rows="9" style="font-size:12px;resize:vertical">${escapeHtml(
      `${exhNames(x).ko || ''} 담당자님, 안녕하세요.\n\n\n\n감사합니다.`)}</textarea>
    ${varChipsHtml('exh', { resolve: 'exh-drawer', note: '이 기업의 값' })}
    </div>
    <div id="exm-deffiles" style="font-size:11px;margin-top:6px"></div>
    <div id="exm-files" style="font-size:11px;margin-top:4px"></div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
      <label class="btn bs" style="cursor:pointer">+ 첨부 (합쳐서 3MB)
        <input type="file" multiple style="display:none" onchange="addExhMailFiles(this)"></label>
      <button class="btn bp bs" onclick="sendExhMail('${id}')"${ppl.length ? '' : ' disabled'}>보내기</button>
      <span id="exm-msg" style="font-size:11px;color:var(--i4)"></span>
    </div>
  </div>
  ${sent.length ? `<div style="font-size:11px;color:var(--i4);margin-top:4px;cursor:pointer" onclick="switchExhDT('box')">주고받은 메일 ${sent.length}건은 «메일함» 탭에 있어요 ›</div>` : ''}`;
}

/* ── 메일함 — 이 기업 담당자와 주고받은 메일 ──
   받은 메일은 읽음·처리를 체크한다(mail-mark.js) */
function dMailBox(x){
  const sent = logsFor(x.id).filter(l => (l.direction === 'out' || l.direction === 'in') && l.channel === '이메일')
    .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  return `<div style="display:flex;align-items:center;gap:8px">
    <div class="sct" style="margin:0">주고받은 메일 ${sent.length || ''}</div>
    <button class="btn bs" style="margin-left:auto" onclick="switchExhDT('mail')">✉ 메일 쓰기</button></div>
  ${sent.some(l => l.direction === 'in') ? mailFilBar(sent) : ''}
  ${filterMail(sent).length ? filterMail(sent).map(l => `<details style="border-top:1px solid var(--i7);padding:7px 0"${mailToggleAttr('ex', l)}>
      <summary style="cursor:pointer;list-style:none">
      <div style="display:flex;gap:7px;align-items:baseline">
        ${mailDirPill(l)}${mailStateHtml('ex', l)}
        <div style="font-size:12px;font-weight:${l.direction === 'in' && !l.read_at ? 800 : 600};flex:1;min-width:0">${escapeHtml(l.subject || '(제목 없음)')}</div>
        <div style="font-size:10.5px;color:var(--i4)">${escapeHtml(l.ts || '')} ▾</div></div>
      <div style="font-size:10.5px;color:var(--i4);margin-top:2px">${escapeHtml(l.counterpart || '')}</div></summary>
      <div style="margin-top:6px;padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;
        font-size:12px;color:var(--i2);white-space:pre-wrap;line-height:1.6">${mailBodyHtml(l.body)}</div>${mailActionsHtml('ex', l)}</details>`).join('')
    : '<div style="font-size:11.5px;color:var(--i5);padding:8px 2px">아직 주고받은 메일이 없어요</div>'}`;
}

/* ── 단계 문구 채우기 ──
   단계·언어를 바꾸면 제목·본문을 그 단계 문구로 바꾼다. 처음 열 때(first)는 이미 적어 둔
   글이 있으면 덮지 않는다 — 쓰다 만 메일이 탭을 오가다 사라지면 안 된다. */
const exhDefFiles = (x) => mailFilesOf(x.event_id).filter(f => f.step === exhMailFileStep(exhDrUi.exhMailStep));
export async function fillExhMail(exhId, first){
  const x = getExhibitorById(exhId);
  if(!x) return;
  const sEl = document.getElementById(`exm-sub-${exhId}`), bEl = document.getElementById(`exm-body-${exhId}`);
  const stepKey = document.getElementById(`exm-step-${exhId}`)?.value || exhDrUi.exhMailStep;
  const en = document.getElementById(`exm-lang-${exhId}`)?.value === 'en';
  if(stepKey !== exhDrUi.exhMailStep) exhDrUi.exhSkipDefault = new Set();
  exhDrUi.exhMailStep = stepKey;
  /* 양식 보관함이면 그 양식을, 단계면 고른 변형(없으면 단계 문구)을 쓴다 */
  const lib = String(stepKey).startsWith('lib:') ? libItem(String(stepKey).slice(4)) : null;
  const st = lib ? { key: stepKey, label: lib.name, due: '' } : exhMailSteps(x.event_id).find(s => s.key === stepKey);
  const vs = lib ? [] : exhStepVariants(x.event_id, stepKey);
  const vEl = document.getElementById(`exm-var-${exhId}`);
  const prevVar = document.getElementById(`exm-varsel-${exhId}`)?.value || '';
  const vId = vs.some(v => v.id === prevVar) ? prevVar : '';
  if(vEl) vEl.innerHTML = vs.length ? `<div style="display:flex;gap:6px;align-items:center;margin-top:5px;font-size:11px">
      <span style="color:var(--i4)">양식</span>
      <select class="fi" id="exm-varsel-${escAttr(exhId)}" style="font-size:11.5px;flex:1" onchange="fillExhMail('${escAttr(exhId)}')">
        <option value="">기본 문구</option>
        ${vs.map(v => `<option value="${escapeHtml(v.id)}"${vId === v.id ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}
      </select></div>` : '';
  const src = lib || vs.find(v => v.id === vId) || st;
  if(sEl && bEl && st && !(first && bEl.dataset.touched)){
    const ctx = exhMailCtx(x);
    // 이미 요청한 단계를 다시 쓰면 리마인더다 — 제목 앞에 붙여 받는 쪽이 같은 요청임을 알게 한다
    const again = exhFollowOf(x, st) ? (en ? '[Reminder] ' : '[리마인더] ') : '';
    sEl.value = again + fillExhTemplate(src[en ? 'subject_en' : 'subject_ko'] || src.subject_ko || st.subject_ko, x, st, en, ctx);
    bEl.value = fillExhTemplate(src[en ? 'body_en' : 'body_ko'] || src.body_ko || st.body_ko, x, st, en, ctx);
    bEl.oninput = () => { bEl.dataset.touched = '1'; };
  }
  await loadMailFiles(x.event_id);
  renderExhDefFiles(x);
}
function renderExhDefFiles(x){
  const el = document.getElementById('exm-deffiles');
  if(!el) return;
  // 회신 중이면 이 행사에 올려 둔 파일 전부를 고를 수 있게(처음엔 꺼 둔다)
  if(exhDrUi.exhReply){
    const all = mailFilesOf(x.event_id);
    el.innerHTML = all.length ? `<span style="color:var(--i4)">행사 파일 붙이기</span> ${all.map(f => `<span class="pill ${exhDrUi.exhReply.pick.has(f.id) ? 'p-blue' : 'p-gray'}" style="margin:2px 4px 0 0;cursor:pointer"
      onclick="toggleExhReplyFile('${escAttr(x.id)}','${escAttr(f.id)}')">${exhDrUi.exhReply.pick.has(f.id) ? '✓ ' : '+ '}📎 ${escapeHtml(f.filename)}</span>`).join('')}` : '';
    return;
  }
  const files = exhDefFiles(x);
  el.innerHTML = files.length ? `<span style="color:var(--i4)">단계 기본 첨부</span> ${files.map(f => `<span class="pill ${exhDrUi.exhSkipDefault.has(f.id) ? 'p-gray' : 'p-blue'}" style="margin:2px 4px 0 0;${exhDrUi.exhSkipDefault.has(f.id) ? 'text-decoration:line-through' : ''}">📎 ${escapeHtml(f.filename)}
    <a href="#" onclick="toggleExhDefFile('${escAttr(x.id)}','${escAttr(f.id)}');return false" style="margin-left:4px;color:var(--i4)">${exhDrUi.exhSkipDefault.has(f.id) ? '넣기' : '빼기'}</a></span>`).join('')}` : '';
}
export function toggleExhDefFile(exhId, fid){
  if(exhDrUi.exhSkipDefault.has(fid)) exhDrUi.exhSkipDefault.delete(fid); else exhDrUi.exhSkipDefault.add(fid);
  const x = getExhibitorById(exhId);
  if(x) renderExhDefFiles(x);
}
window.fillExhMail = fillExhMail;
window.toggleExhDefFile = toggleExhDefFile;

async function fillExhMailFrom(x){
  const f = await eventMailFrom(x.event_id);
  const el = document.getElementById('exm-from');
  if(!el) return;
  el.innerHTML = f.ok ? `발신 <b>${escapeHtml(f.text)}</b> — 행사 공용 메일`
    : `<b style="color:var(--re)">${escapeHtml(f.text)}</b>`;
  renderExhMailFiles();
}
function renderExhMailFiles(){
  const el = document.getElementById('exm-files');
  if(el) el.innerHTML = exhDrUi.exhMailFiles.map((f, i) => `<span class="pill p-gray" style="margin:2px 4px 0 0">📎 ${escapeHtml(f.name)}
    <a href="#" onclick="dropExhMailFile(${i});return false" style="margin-left:4px;color:var(--i4)">✕</a></span>`).join('');
}
export function addExhMailFiles(inp){ exhDrUi.exhMailFiles.push(...inp.files); inp.value = ''; renderExhMailFiles(); }
export function dropExhMailFile(i){ exhDrUi.exhMailFiles.splice(i, 1); renderExhMailFiles(); }

/* 보내는 중 — 확인 창·SMTP를 기다리는 동안 «보내기»를 또 누르면 같은 메일이 두 번 나갔다 */
export async function sendExhMail(exhId){
  if(exhDrUi.exhMailBusy) return;
  exhDrUi.exhMailBusy = true;
  try { await sendExhMailNow(exhId); } finally { exhDrUi.exhMailBusy = false; }
}
async function sendExhMailNow(exhId){
  const x = getExhibitorById(exhId);
  if(!x) return;
  // 보내면 기록(exhibitor_logs)이 남는 쓰기다 — 다른 저장처럼 잠긴 행사면 묻기 전에 막는다
  if(exhLocked()){ exhLockNotice(); return; }
  const msg = document.getElementById('exm-msg');
  const say = (t, ok) => { if(msg){ msg.style.color = ok ? 'var(--g)' : 'var(--re)'; msg.textContent = t; } };
  const to = [...document.querySelectorAll('.exm-to:checked')].map(el => el.value);
  const cc = (document.getElementById(`exm-cc-${exhId}`)?.value || '').split(/[,;]/).map(v => v.trim()).filter(Boolean);
  const subject = (document.getElementById(`exm-sub-${exhId}`)?.value || '').trim();
  const text = (document.getElementById(`exm-body-${exhId}`)?.value || '').trim();
  if(!to.length){ say('받는 사람을 골라주세요.'); return; }
  if(!subject && !text){ say('제목이나 내용 중 하나는 있어야 해요.'); return; }
  if(exhDrUi.exhMailFiles.reduce((n, f) => n + f.size, 0) > 3 * 1024 * 1024){ say('첨부가 합쳐서 3MB를 넘어요.'); return; }
  // 밖으로 나가는 일은 한 번 묻는다 — 받는 사람을 눈으로 확인하게
  const from = await eventMailFrom(x.event_id);
  if(!from.ok){ say(from.text); return; }
  if(!confirm(`이 내용으로 보낼까요?\n\n발신 ${from.text}\n수신 ${to.join(', ')}${cc.length ? `\n참조 ${cc.join(', ')}` : ''}\n제목 ${subject}`)) return;

  say('보내는 중…', true);
  const attachments = [];
  for(const f of exhDrUi.exhMailFiles) attachments.push({ filename: f.name, content_type: f.type, data: await fileToBase64(f) });
  const reply = exhDrUi.exhReply;
  const stepKey = document.getElementById(`exm-step-${exhId}`)?.value || 'note';
  const lib = String(stepKey).startsWith('lib:') ? libItem(String(stepKey).slice(4)) : null;
  const st = lib ? { key: 'note', label: lib.name } : exhMailSteps(x.event_id).find(s => s.key === stepKey);
  // 회신은 단계 메일이 아니다 — 단계 기본 첨부를 붙이지 않는다
  const fileIds = reply ? [...reply.pick] : exhDefFiles(x).filter(f => !exhDrUi.exhSkipDefault.has(f.id)).map(f => f.id);
  const kind = reply ? 'reply' : stepKey === 'note' || lib ? 'note' : `exh-${stepKey}`;
  const category = reply ? '회신' : st ? st.label : '메일';
  const res = await sendMail({ to, cc, subject, text, exhibitor_id: x.id, category, kind, attachments, file_ids: fileIds });
  if(!res.ok){ say(res.offline ? '테스트 모드에서는 보내지 않아요.' : (res.error || '보내지 못했어요.')); return; }
  // 서버가 기록을 남긴다 — 화면에도 바로 끼워 방금 보낸 게 안 보여 또 보내는 일을 막는다
  /* 서버가 남긴 기록 id를 쓴다 — 임시 id로 두면 이 줄을 지울 때 서버에서 안 지워진다 */
  if(res.logId) EXH_LOGS.push({
    id: res.logId, exhibitor_id: x.id, kind, ts: nowStamp(), direction: 'out', channel: '이메일',
    counterpart: [to.join(', '), cc.length ? `(cc) ${cc.join(', ')}` : ''].filter(Boolean).join(' '),
    category, subject, answered_at: '', answer: '', status: 'done',
    body: text + ((attachments.length || fileIds.length) ? `\n\n[첨부] ${[...mailFilesOf(x.event_id).filter(f => fileIds.includes(f.id)).map(f => f.filename), ...attachments.map(a => a.filename)].join(', ')}` : ''),
    author_email: currentUser?.email || '', author_name: currentUser?.name || '',
  });
  trackAction('add', '참가사 메일', x.event_id, `${exhNames(x).ko || x.id} — ${subject}`, { kind: 'exhibitor', id: x.id, tab: 'mail' });
  exhDrUi.exhMailFiles = []; exhDrUi.exhSkipDefault = new Set();
  // 회신이었으면 그 받은 메일을 처리함으로 닫는다
  if(reply){ exhDrUi.exhReply = null; await setMailDone('ex', reply.logId, true); }
  renderExhDr();
  const m = document.getElementById('exm-msg');
  if(m){ m.style.color = res.logged === false ? 'var(--re)' : 'var(--g)';
    m.textContent = res.logged === false ? `보냈어요 (${res.via || ''}) — 다만 기록 저장에 실패했어요.` : `보냈어요 · ${res.via || ''}`;
    if(res.sentError) m.textContent += ` (보낸메일함에는 못 남겼어요: ${res.sentError})`; }
}
window.addExhMailFiles = addExhMailFiles;
window.dropExhMailFile = dropExhMailFile;
window.sendExhMail = sendExhMail;


/* 화면의 onclick이 부르는 것 */
window.dMailBox = dMailBox;   // 탭(exh-drawer.js)이 window로 부른다
window.dMail = dMail;   // 탭(exh-drawer.js)이 window로 부른다
window.fillExhMailFrom = fillExhMailFrom;   // 탭(exh-drawer.js)이 window로 부른다
window.fillExhReply = fillExhReply;   // 탭(exh-drawer.js)이 window로 부른다
window.fillExhMail = fillExhMail;   // 탭(exh-drawer.js)이 window로 부른다
