/* ══════════════════════════════════════════════════════════════
   speaker-bulkmail.js — 여러 연사에게 같은 단계 메일을 한 번에

   «일정표가 바뀌어 정정 메일», «발표자료 요청»처럼 연사 수십 명에게 같은 단계
   메일을 돌릴 일이 생긴다. 한 명씩 연사 화면을 열어 보내면 빠뜨리기 쉽다.
   그래서 연사마다 따로 한 통씩(서로 주소가 안 보이게) 보내고, 그 연사 기록에
   남긴다 — 기록이 남아야 연락 단계가 «끝»으로 넘어간다.

   - 받는 연사: 그 단계가 «지금 해당되고 아직 안 끝난» 연사가 미리 골라진다
   - 문구: 연락 단계 양식(speaker-flow.js). 연사마다 {호칭}·{세션}이 채워지고,
     영문(EN) 연사에게는 영문 양식이 나간다. 여기서 고친 문구는 이번 발송에만 쓴다
   - 받는 사람: 연사 화면 «연락 상대»의 수신·참조 그대로
   - 첨부: 그 단계의 기본 첨부
══════════════════════════════════════════════════════════════ */
import { EVENT_LIST, SPEAKER_LOGS, currentUser, speakersForEvent, evPartDone } from '../state.js';
import { sendMail, eventMailFrom, loadMailFiles, mailFilesOf, saveSpeaker } from '../api.js';
import { escapeHtml, escAttr, nowStamp, td } from '../utils.js';
import { flowSteps, flowStatus, draftFor, fillTemplate } from './speaker-flow.js';
import { mailTargets } from './speaker-drawer.js';
import { trackAction } from './audit-tab.js';

let bm = null;   // { evKey, step, ids:Set, show:'due'|'all', tpl:{...}|null, sending }

const nameOf = (sp) => sp.name_snapshot || sp.name_en || sp.id;
const isEn = (sp) => sp.lang_pref === 'en';
/* 그 단계가 이 연사에게 어떤 상태인가 — due(보낼 차례) / done(이미 끝) / na(해당 없음) */
function stateOf(sp, key){
  const f = flowStatus(sp);
  const s = f.steps.find(x => x.key === key);
  if(!s || !s.applies) return 'na';
  return s.isDone ? 'done' : 'due';
}
const liveSpeakers = (evKey) => speakersForEvent(evKey)
  .slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ko'));
const close = () => { document.getElementById('sp-bulkmail')?.remove(); bm = null; };

export async function openSpeakerBulkMail(evKey, stepKey){
  const steps = flowSteps(evKey);
  if(!steps.length){ alert('이 행사에 켜진 연락 단계가 없어요.'); return; }
  /* 단계를 안 정했으면 보낼 사람이 가장 많은 단계부터 */
  const cnt = (k) => liveSpeakers(evKey).filter(sp => stateOf(sp, k) === 'due').length;
  const step = steps.some(s => s.key === stepKey) ? stepKey
    : steps.slice().sort((a, b) => cnt(b.key) - cnt(a.key))[0].key;
  bm = { evKey, step, ids: new Set(), show: 'due', tpl: null, sending: false };
  pickDue();
  await loadMailFiles(evKey);
  render();
}
function pickDue(){
  bm.ids = new Set(liveSpeakers(bm.evKey)
    .filter(sp => stateOf(sp, bm.step) === 'due' && mailTargets(sp.id).to.length).map(sp => sp.id));
}

/* 문구 — 고치지 않았으면 연사마다 그 단계 초안(자료 독촉·지난 자료 확인도 연사별로 갈린다)을,
   고쳤으면 고친 문구를 연사마다 채워 쓴다 */
function mailFor(sp){
  if(!bm.tpl) return draftFor(sp, bm.step);
  const st = flowStatus(sp).steps.find(s => s.key === bm.step) || flowSteps(bm.evKey).find(s => s.key === bm.step);
  const en = isEn(sp);
  return { subject: fillTemplate(bm.tpl[en ? 'subject_en' : 'subject_ko'], sp, st),
    body: fillTemplate(bm.tpl[en ? 'body_en' : 'body_ko'], sp, st), kind: bm.step, category: st.label };
}

function render(){
  if(!bm) return;
  const steps = flowSteps(bm.evKey);
  const st = steps.find(s => s.key === bm.step) || steps[0];
  const all = liveSpeakers(bm.evKey);
  const rows = all.map(sp => ({ sp, s: stateOf(sp, bm.step), to: mailTargets(sp.id) }))
    .filter(r => bm.show === 'all' || r.s === 'due' || bm.ids.has(r.sp.id));
  const picked = all.filter(sp => bm.ids.has(sp.id));
  const nDue = all.filter(sp => stateOf(sp, bm.step) === 'due').length;
  const sample = picked[0];
  const prev = sample ? mailFor(sample) : null;
  const tpl = bm.tpl || { subject_ko: st.subject_ko || '', body_ko: st.body_ko || '', subject_en: st.subject_en || '', body_en: st.body_en || '' };
  const files = mailFilesOf(bm.evKey).filter(f => f.step === bm.step);
  const ev = EVENT_LIST.find(e => e.key === bm.evKey) || {};
  const pill = { due: '<span class="pill p-amber" style="font-size:9.5px">보낼 차례</span>',
    done: '<span class="pill p-green" style="font-size:9.5px">보냄</span>',
    na: '<span class="pill p-gray" style="font-size:9.5px">해당 없음</span>' };

  let el = document.getElementById('sp-bulkmail');
  if(!el){
    el = document.createElement('div');
    el.id = 'sp-bulkmail';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:1001;display:flex;align-items:center;justify-content:center;padding:16px';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div style="background:var(--W);border-radius:12px;width:min(1000px,100%);max-height:92vh;overflow:auto;padding:16px 18px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <div style="font-size:14px;font-weight:700">여러 연사에게 메일</div>
      <span style="font-size:11px;color:var(--i4)">${escapeHtml(ev.name || ev.short || bm.evKey)} · 연사마다 한 통씩 따로 보내고 그 연사 기록에 남깁니다</span>
      <button class="drcls" style="margin-left:auto" onclick="closeSpBulkMail()">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div><div class="mlbl">무슨 메일인가</div><select class="fi" onchange="sbmSet('step',this.value)" ${bm.sending ? 'disabled' : ''}>
        ${steps.map(s => { const n = all.filter(sp => stateOf(sp, s.key) === 'due').length;
          return `<option value="${escAttr(s.key)}"${s.key === bm.step ? ' selected' : ''}>${escapeHtml(s.label)}${n ? ` — 보낼 차례 ${n}명` : ''}</option>`; }).join('')}</select></div>
      <div><div class="mlbl">목록</div><select class="fi" onchange="sbmSet('show',this.value)">
        <option value="due"${bm.show === 'due' ? ' selected' : ''}>보낼 차례인 연사만 (${nDue}명)</option>
        <option value="all"${bm.show === 'all' ? ' selected' : ''}>모든 연사 (${all.length}명)</option></select></div>
    </div>
    ${st && st.since ? `<div style="font-size:10.5px;color:var(--i4);margin:-4px 0 8px">기준일 ${escapeHtml(st.since)} — 이날까지 초청한 연사가 대상이고, 이날 이후 보낸 메일이 있으면 «보냄»으로 봅니다.</div>` : ''}
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:14px">
      <div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <div class="mlbl" style="margin:0">받는 연사 ${picked.length}명</div>
          <button class="btn" style="font-size:10px;margin-left:auto" onclick="sbmAll('due')">보낼 차례 모두</button>
          <button class="btn" style="font-size:10px" onclick="sbmAll('none')">해제</button>
        </div>
        <div style="border:1px solid var(--i6);border-radius:8px;max-height:400px;overflow:auto">
          ${rows.length ? rows.map(({ sp, s, to }) => { const can = to.to.length > 0;
            return `<label style="display:flex;gap:6px;align-items:center;padding:5px 8px;border-bottom:1px solid var(--i8);font-size:11.5px;cursor:${can ? 'pointer' : 'default'};opacity:${can ? 1 : .5}">
            <input type="checkbox" ${bm.ids.has(sp.id) ? 'checked' : ''} ${can && !bm.sending ? '' : 'disabled'} onchange="sbmPick('${escAttr(sp.id)}',this.checked)">
            <b style="flex:0 0 auto">${escapeHtml(nameOf(sp))}</b>
            <span class="pill p-gray" style="font-size:9.5px">${isEn(sp) ? 'EN' : 'KO'}</span>${pill[s]}
            <span style="color:var(--i4);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
              title="${escAttr([...to.to, ...to.cc.map(x => `(cc) ${x}`)].join(', '))}">${can ? escapeHtml(to.to.join(', ')) : '수신 없음 — 연사 화면 «연락 상대»에서 정하세요'}</span>
          </label>`; }).join('')
            : '<div style="padding:14px;font-size:11.5px;color:var(--i4)">이 단계가 보낼 차례인 연사가 없어요. 위 «목록»을 «모든 연사»로 바꾸면 다 보입니다.</div>'}
        </div>
      </div>
      <div>
        <details${bm.tpl ? ' open' : ''}><summary style="cursor:pointer;font-size:11.5px;font-weight:700;margin-bottom:4px">이번 발송 문구 고치기${bm.tpl ? ' <span style="color:var(--am);font-weight:400">(고침)</span>' : ''}</summary>
          <div class="mlbl">국문</div>
          <input class="fi" style="font-size:11.5px;margin-bottom:4px" value="${escAttr(tpl.subject_ko)}" oninput="sbmTpl('subject_ko',this.value)">
          <textarea class="fi" rows="6" style="font-size:11.5px;width:100%" oninput="sbmTpl('body_ko',this.value)">${escapeHtml(tpl.body_ko)}</textarea>
          <div class="mlbl" style="margin-top:6px">영문</div>
          <input class="fi" style="font-size:11.5px;margin-bottom:4px" value="${escAttr(tpl.subject_en)}" oninput="sbmTpl('subject_en',this.value)">
          <textarea class="fi" rows="6" style="font-size:11.5px;width:100%" oninput="sbmTpl('body_en',this.value)">${escapeHtml(tpl.body_en)}</textarea>
          <div style="font-size:10.5px;color:var(--i4);margin-top:4px">{호칭}·{세션}·{발표시간} 등은 연사마다 채워집니다. 여기서 고친 문구는 이번 발송에만 쓰고, 기본 문구는
            <a href="#" onclick="openFlowEditor('${escAttr(bm.evKey)}','${escAttr(bm.step)}');return false">단계 편집</a>에서 고칩니다.</div>
        </details>
        ${files.length ? `<div style="font-size:11px;margin-top:6px">기본 첨부 ${files.map(f => `<span class="pill p-blue" style="margin:2px 3px 0 0">📎 ${escapeHtml(f.filename)}</span>`).join('')}</div>` : ''}
        ${prev ? `<div id="sbm-prev" style="margin-top:10px;padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;font-size:11.5px;white-space:pre-wrap;line-height:1.55;max-height:300px;overflow:auto">${prevHtml(sample, prev)}</div>`
          : '<div style="margin-top:10px;font-size:11px;color:var(--i4)">연사를 고르면 미리보기가 보여요.</div>'}
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:12px">
      <button class="btn bp" onclick="sendSpBulkMail()" ${picked.length && !bm.sending ? '' : 'disabled'}>${picked.length}명에게 보내기</button>
      <span id="sbm-msg" style="font-size:11px;color:var(--i4)"></span>
    </div>
  </div>`;
}
const prevHtml = (sp, m) => `<div style="font-size:10px;color:var(--i4);margin-bottom:4px">미리보기 — ${escapeHtml(nameOf(sp))}${isEn(sp) ? ' (영문)' : ''}</div><b>${escapeHtml(m.subject)}</b>\n\n${escapeHtml(m.body)}`;

export function sbmSet(k, v){
  if(!bm || bm.sending) return;
  bm[k] = v;
  if(k === 'step'){ bm.tpl = null; pickDue(); }
  render();
}
export function sbmPick(id, on){ if(!bm || bm.sending) return; on ? bm.ids.add(id) : bm.ids.delete(id); render(); }
export function sbmAll(mode){ if(!bm || bm.sending) return; if(mode === 'due') pickDue(); else bm.ids = new Set(); render(); }
/* 문구는 다시 그리지 않고 담아만 둔다 — 그리면 입력 중인 칸이 초기화된다. 미리보기만 고친다 */
export function sbmTpl(k, v){
  if(!bm) return;
  if(!bm.tpl){ const st = flowSteps(bm.evKey).find(s => s.key === bm.step) || {};
    bm.tpl = { subject_ko: st.subject_ko || '', body_ko: st.body_ko || '', subject_en: st.subject_en || '', body_en: st.body_en || '' }; }
  bm.tpl[k] = v;
  const sp = speakersForEvent(bm.evKey).find(x => bm.ids.has(x.id));
  const el = document.getElementById('sbm-prev');
  if(sp && el) el.innerHTML = prevHtml(sp, mailFor(sp));
}

export async function sendSpBulkMail(){
  if(!bm || bm.sending) return;
  const msg = (t, ok) => { const m = document.getElementById('sbm-msg'); if(m){ m.style.color = ok ? 'var(--g)' : 'var(--re)'; m.textContent = t; } };
  if(evPartDone(bm.evKey, 'conf')){ msg('진행 완료된 컨퍼런스예요 — 열람만 됩니다.'); return; }
  const list = liveSpeakers(bm.evKey).filter(sp => bm.ids.has(sp.id) && mailTargets(sp.id).to.length);
  if(!list.length){ msg('받을 연사를 골라주세요.'); return; }
  const st = flowSteps(bm.evKey).find(s => s.key === bm.step);
  if(!st) return;
  const from = await eventMailFrom(bm.evKey);
  if(!from.ok){ msg(from.text); return; }
  const again = list.filter(sp => stateOf(sp, bm.step) === 'done').length;
  // 밖으로 나가는 일 — 한 번 묻는다
  if(!confirm(`${list.length}명에게 «${st.label}» 메일을 보낼까요?\n\n발신 ${from.text}\n연사마다 한 통씩 따로 나갑니다(받는 사람은 각 연사의 «연락 상대» 수신·참조).${
    again ? `\n\n이 중 ${again}명은 이미 이 단계 메일을 받았어요.` : ''}`)) return;

  bm.sending = true;
  render();
  const fileIds = mailFilesOf(bm.evKey).filter(f => f.step === bm.step).map(f => f.id);
  const fileNote = fileIds.length ? `\n\n[첨부] ${mailFilesOf(bm.evKey).filter(f => fileIds.includes(f.id)).map(f => f.filename).join(', ')}` : '';
  let ok = 0;
  const fails = [];
  for(const [i, sp] of list.entries()){
    msg(`보내는 중… ${i + 1}/${list.length} ${nameOf(sp)}`, true);
    const t = mailTargets(sp.id);
    const m = mailFor(sp);
    if(!m){ fails.push(`${nameOf(sp)}: 이 단계가 없어요`); continue; }
    const res = await sendMail({ to: t.to, cc: t.cc, subject: m.subject, text: m.body, speaker_id: sp.id,
      category: m.category, kind: bm.step, file_ids: fileIds });
    if(!res.ok){ fails.push(`${nameOf(sp)}: ${res.error || '실패'}`); continue; }
    ok++;
    if(res.logId) SPEAKER_LOGS.push({
      id: res.logId, speaker_id: sp.id, kind: bm.step, ts: nowStamp(), direction: 'out', channel: '이메일',
      counterpart: [t.to.join(', '), t.cc.length ? `(cc) ${t.cc.join(', ')}` : ''].filter(Boolean).join(' '),
      category: m.category, subject: m.subject, answered_at: '', answer: '', status: 'done', body: m.body + fileNote,
      author_email: currentUser?.email || '', author_name: currentUser?.name || '',
    });
    /* 연사 화면에서 한 통 보낼 때와 같이 — 초청은 «보냄», 자료 독촉은 «마지막 독촉» 날짜를 찍는다 */
    const patch = bm.step === 'invite' && !sp.guide_sent_at ? { guide_sent_at: td() }
      : m.category === '자료 독촉' ? { reminded_at: td() } : null;
    if(patch){ const r = await saveSpeaker({ id: sp.id, ...patch, updated_at: td() }); if(r && r.ok !== false) Object.assign(sp, patch); }
  }
  trackAction('add', '연사 일괄 메일', bm.evKey, `«${st.label}» ${ok}명 보냄${fails.length ? ` · 실패 ${fails.length}명` : ''}`);
  bm.sending = false;
  pickDue();   // 보낸 사람은 «보냄»으로 넘어가 빠진다
  render();
  msg(`${ok}명에게 보냈어요${fails.length ? ` — 실패 ${fails.length}명: ${fails.slice(0, 5).join(' / ')}${fails.length > 5 ? ' …' : ''}` : ''}`, !fails.length);
  window.renderConf?.(); window.renderSpeakerDr?.();
}

window.openSpeakerBulkMail = openSpeakerBulkMail;
window.closeSpBulkMail = close;
window.sbmSet = sbmSet;
window.sbmPick = sbmPick;
window.sbmAll = sbmAll;
window.sbmTpl = sbmTpl;
window.sendSpBulkMail = sendSpBulkMail;
