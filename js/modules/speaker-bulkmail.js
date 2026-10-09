/* ══════════════════════════════════════════════════════════════
   speaker-bulkmail.js — 여러 연사에게 같은 단계 메일을 한 번에

   «일정표가 바뀌어 정정 메일», «발표자료 요청»처럼 연사 수십 명에게 같은 단계
   메일을 돌릴 일이 생긴다. 한 명씩 연사 화면을 열어 보내면 빠뜨리기 쉽다.
   그래서 연사마다 따로 한 통씩(서로 주소가 안 보이게) 보내고, 그 연사 기록에
   남긴다 — 기록이 남아야 연락 단계가 «끝»으로 넘어간다.

   - 받는 연사: 그 단계가 «지금 해당되고 아직 안 끝난» 연사가 미리 골라진다.
     일정 변경 안내는 알린 일정과 지금 일정이 다른 연사만 잡힌다(speaker-flow.js scheduleDiff)
   - 다시 보내기(개정판): «↻ 이미 받은 연사에게 다시 보내기»로 발송 묶음(conf.mailRounds)을 연다.
     그 순간 이미 받았거나 끝낸 연사가 대상이 되고, 다 보내면 묶음이 저절로 닫힌다.
     나눠 보내도 묶음이 남아 있어 «이어서 보내기»가 된다
   - 보내기 전: 사람마다 넘겨 보는 미리보기, «나에게 먼저 1통»(기록에 안 남는 시험 발송)
   - 문구: 연락 단계 양식. 연사마다 {호칭}·{세션}·{변경내용}이 채워지고, 영문(EN) 연사에게는
     영문 양식이 나간다. 여기서 고친 문구는 이번 발송에만 쓴다
   - 받는 사람: 연사 화면 «연락 상대»의 수신·참조 그대로 / 첨부: 그 단계의 기본 첨부
══════════════════════════════════════════════════════════════ */
import { EVENT_LIST, SPEAKER_LOGS, currentUser, speakersForEvent, evPartDone, confCfg } from '../state.js';
import { sendMail, eventMailFrom, loadMailFiles, mailFilesOf, saveSpeaker } from '../api.js';
import { escapeHtml, escAttr, nowStamp, td } from '../utils.js';
import { flowSteps, flowStatus, draftFor, fillTemplate, roundTargets, resentAfter,
  sessionItems, toldSchedule } from './speaker-flow.js';
import { mailTargets } from './speaker-drawer.js';
import { saveConf } from './settings-tab.js';
import { trackAction } from './audit-tab.js';

let bm = null;   // { evKey, step, ids:Set, show:'due'|'all', tpl, sending, pi, failed:Set }

const nameOf = (sp) => sp.name_snapshot || sp.name_en || sp.id;
const isEn = (sp) => sp.lang_pref === 'en';
/* 그 단계가 이 연사에게 어떤 상태인가
     due     보낼 차례            resend  다시 보낼 차례(묶음 대상, 아직 다시 안 보냄)
     done    이미 끝              na      해당 없음
     unknown 일정 변경 안내인데 알린 일정을 메일에서 못 읽었다(앱 밖에서 다른 모양으로 보냈을 때) */
function stateOf(sp, key){
  const f = flowStatus(sp);
  const s = f.steps.find(x => x.key === key);
  if(key === 'schedule' && !(s && s.applies))
    return !f.skip && sp.guide_sent_at && sessionItems(sp).length && !toldSchedule(sp) ? 'unknown' : 'na';
  if(!s || !s.applies) return 'na';
  if(s.resend) return s.isDone ? 'done' : 'resend';
  return s.isDone ? 'done' : 'due';
}
const isTurn = (s) => s === 'due' || s === 'resend';
const PILL = {
  due: '<span class="pill p-amber" style="font-size:9.5px">보낼 차례</span>',
  resend: '<span class="pill p-amber" style="font-size:9.5px">다시 보낼 차례</span>',
  done: '<span class="pill p-green" style="font-size:9.5px">보냄</span>',
  na: '<span class="pill p-gray" style="font-size:9.5px">해당 없음</span>',
  unknown: '<span class="pill p-gray" style="font-size:9.5px" title="이 연사에게 보낸 메일에서 세션 줄을 못 읽었어요 — 바뀌었는지 직접 확인하세요">알린 일정 모름</span>',
};
const liveSpeakers = (evKey) => speakersForEvent(evKey)
  .slice().sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ko'));
const close = () => { document.getElementById('sp-bulkmail')?.remove(); bm = null; };
const curStep = () => flowSteps(bm.evKey).find(s => s.key === bm.step);

export async function openSpeakerBulkMail(evKey, stepKey){
  const steps = flowSteps(evKey);
  if(!steps.length){ alert('이 행사에 켜진 연락 단계가 없어요.'); return; }
  /* 단계를 안 정했으면 보낼 사람이 가장 많은 단계부터 */
  const cnt = (k) => liveSpeakers(evKey).filter(sp => isTurn(stateOf(sp, k))).length;
  const step = steps.some(s => s.key === stepKey) ? stepKey
    : steps.slice().sort((a, b) => cnt(b.key) - cnt(a.key))[0].key;
  bm = { evKey, step, ids: new Set(), show: 'due', tpl: null, sending: false, pi: 0, failed: new Set() };
  pickDue();
  await loadMailFiles(evKey);
  render();
}
function pickDue(){
  bm.ids = new Set(liveSpeakers(bm.evKey)
    .filter(sp => isTurn(stateOf(sp, bm.step)) && mailTargets(sp.id).to.length).map(sp => sp.id));
  bm.pi = 0;
}

/* 문구 — 고치지 않았으면 연사마다 그 단계 초안(자료 독촉·지난 자료 확인도 연사별로 갈린다)을,
   고쳤으면 고친 문구를 연사마다 채워 쓴다 */
function mailFor(sp){
  if(!bm.tpl) return draftFor(sp, bm.step);
  const st = flowStatus(sp).steps.find(s => s.key === bm.step) || curStep();
  const en = isEn(sp);
  return { subject: fillTemplate(bm.tpl[en ? 'subject_en' : 'subject_ko'], sp, st),
    body: fillTemplate(bm.tpl[en ? 'body_en' : 'body_ko'], sp, st), kind: bm.step, category: st.label };
}

/* ── 다시 보내기 묶음 — 행사 설정(conf.mailRounds)에 둔다. 묶음은 단계당 하나만 열린다 ── */
async function pushRounds(fn){
  if(evPartDone(bm.evKey, 'conf')){ alert('진행 완료된 컨퍼런스예요 — 열람만 됩니다.'); return false; }
  const cfg = JSON.parse(JSON.stringify(confCfg(bm.evKey)));
  cfg.mailRounds = cfg.mailRounds || [];
  if(fn(cfg.mailRounds) === false) return false;
  /* 닫힌 묶음은 최근 20개만 남긴다 — «언제 무엇을 다시 돌렸나»는 기록(로그)에 남아 있다 */
  const open = cfg.mailRounds.filter(r => !r.closed_at), shut = cfg.mailRounds.filter(r => r.closed_at).slice(-20);
  cfg.mailRounds = [...shut, ...open];
  return saveConf(bm.evKey, cfg);
}
function roundProgress(st){
  const r = st && st.round;
  if(!r) return null;
  const ids = new Set(r.targets || []);
  const sps = speakersForEvent(bm.evKey).filter(sp => ids.has(sp.id) && sp.status !== '취소');
  return { r, total: sps.length, done: sps.filter(sp => resentAfter(sp, st.key, r.since)).length };
}
export async function startSpRound(){
  if(!bm || bm.sending) return;
  const st = curStep();
  if(!st) return;
  const targets = roundTargets(st.key, liveSpeakers(bm.evKey));
  if(!targets.length){ alert(`«${st.label}»을 이미 받았거나 끝낸 연사가 없어요 — 다시 보낼 사람이 없습니다.`); return; }
  const label = (prompt(`이미 «${st.label}»을 받은 연사 ${targets.length}명에게 다시 보냅니다.\n이번 묶음의 이름 (예: 가이드라인 개정판)`,
    `${st.label} 개정판`) || '').trim();
  if(!label) return;
  const ok = await pushRounds(list => {
    list.push({ id: `R-${Date.now().toString(36)}`, step: st.key, label, since: nowStamp(), targets,
      by: currentUser?.name || currentUser?.email || '' });
  });
  if(!ok) return;
  trackAction('add', '연사 다시 보내기', bm.evKey, `«${st.label}» 묶음 «${label}» ${targets.length}명`);
  bm.tpl = null;
  pickDue();
  render();
  window.renderConf?.(); window.renderSpeakerDr?.();
}
export async function closeSpRound(silent){
  if(!bm) return;
  const st = curStep();
  if(!st || !st.round) return;
  if(!silent){
    const p = roundProgress(st);
    if(!confirm(`다시 보내기 묶음 «${st.round.label}»을 닫을까요?${p && p.done < p.total ? `\n\n아직 ${p.total - p.done}명에게 다시 안 보냈어요. 닫으면 그 연사들은 평소 상태로 돌아갑니다.` : ''}`)) return;
  }
  const ok = await pushRounds(list => { const r = list.find(x => x.id === st.round.id); if(!r) return false; r.closed_at = nowStamp(); });
  if(!ok) return;
  trackAction('edit', '연사 다시 보내기', bm.evKey, `«${st.label}» 묶음 «${st.round.label}» 닫음`);
  pickDue();
  render();
  window.renderConf?.(); window.renderSpeakerDr?.();
}

function render(){
  if(!bm) return;
  const steps = flowSteps(bm.evKey);
  const st = steps.find(s => s.key === bm.step) || steps[0];
  const all = liveSpeakers(bm.evKey);
  const rows = all.map(sp => ({ sp, s: stateOf(sp, bm.step), to: mailTargets(sp.id) }))
    .filter(r => bm.show === 'all' || isTurn(r.s) || r.s === 'unknown' || bm.ids.has(r.sp.id));
  const picked = all.filter(sp => bm.ids.has(sp.id));
  const nDue = all.filter(sp => isTurn(stateOf(sp, bm.step))).length;
  const nUnknown = st && st.key === 'schedule' ? all.filter(sp => stateOf(sp, 'schedule') === 'unknown').length : 0;
  const tpl = bm.tpl || { subject_ko: st.subject_ko || '', body_ko: st.body_ko || '', subject_en: st.subject_en || '', body_en: st.body_en || '' };
  const files = mailFilesOf(bm.evKey).filter(f => f.step === bm.step);
  const ev = EVENT_LIST.find(e => e.key === bm.evKey) || {};
  const rp = roundProgress(st);
  const failedPicked = [...bm.failed].filter(id => all.some(sp => sp.id === id));

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
        ${steps.map(s => { const n = all.filter(sp => isTurn(stateOf(sp, s.key))).length;
          return `<option value="${escAttr(s.key)}"${s.key === bm.step ? ' selected' : ''}>${escapeHtml(s.label)}${s.round ? ' ↻' : ''}${n ? ` — 보낼 차례 ${n}명` : ''}</option>`; }).join('')}</select></div>
      <div><div class="mlbl">목록</div><select class="fi" onchange="sbmSet('show',this.value)">
        <option value="due"${bm.show === 'due' ? ' selected' : ''}>보낼 차례인 연사만 (${nDue}명)</option>
        <option value="all"${bm.show === 'all' ? ' selected' : ''}>모든 연사 (${all.length}명)</option></select></div>
    </div>
    ${roundBarHtml(st, rp)}
    ${st.key === 'schedule' ? `<div style="font-size:10.5px;color:var(--i4);margin:-4px 0 8px;line-height:1.6">알린 일정(그 연사에게 마지막으로 보낸 메일의 세션 줄)과 지금 일정이 다른 연사만 잡혀요. 보내면 새 일정이 «알린 일정»이 됩니다.${
      nUnknown ? ` <b style="color:var(--am)">알린 일정을 못 읽은 연사 ${nUnknown}명</b> — 앱 밖에서 다른 모양으로 보냈을 수 있어요. 바뀌었는지 직접 보고 고르세요.` : ''}</div>` : ''}
    ${st.since && st.custom ? `<div style="font-size:10.5px;color:var(--i4);margin:-4px 0 8px">대상 제한 ${escapeHtml(st.since)} — 이날까지 초청한 연사가 대상이고, 이날 이후 보낸 메일이 있으면 «보냄»으로 봅니다.</div>` : ''}
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:14px">
      <div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
          <div class="mlbl" style="margin:0">받는 연사 ${picked.length}명</div>
          <span style="margin-left:auto;display:flex;gap:4px">
            ${failedPicked.length ? `<button class="btn" style="font-size:10px;color:var(--re)" onclick="sbmAll('failed')">실패한 ${failedPicked.length}명만</button>` : ''}
            <button class="btn" style="font-size:10px" onclick="sbmAll('due')">보낼 차례 모두</button>
            <button class="btn" style="font-size:10px" onclick="sbmAll('none')">해제</button></span>
        </div>
        <div style="border:1px solid var(--i6);border-radius:8px;max-height:400px;overflow:auto">
          ${rows.length ? rows.map(({ sp, s, to }) => { const can = to.to.length > 0;
            return `<label style="display:flex;gap:6px;align-items:center;padding:5px 8px;border-bottom:1px solid var(--i8);font-size:11.5px;cursor:${can ? 'pointer' : 'default'};opacity:${can ? 1 : .5}">
            <input type="checkbox" ${bm.ids.has(sp.id) ? 'checked' : ''} ${can && !bm.sending ? '' : 'disabled'} onchange="sbmPick('${escAttr(sp.id)}',this.checked)">
            <b style="flex:0 0 auto">${escapeHtml(nameOf(sp))}</b>
            <span class="pill p-gray" style="font-size:9.5px">${isEn(sp) ? 'EN' : 'KO'}</span>${PILL[s] || ''}${bm.failed.has(sp.id) ? '<span class="pill p-red" style="font-size:9.5px;background:var(--rb);color:var(--re)">실패</span>' : ''}
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
          <div style="font-size:10.5px;color:var(--i4);margin-top:4px">{호칭}·{세션}·{변경내용} 등은 연사마다 채워집니다. 여기서 고친 문구는 이번 발송에만 쓰고, 기본 문구는
            <a href="#" onclick="openFlowEditor('${escAttr(bm.evKey)}','${escAttr(bm.step)}');return false">단계 편집</a>에서 고칩니다.</div>
        </details>
        ${files.length ? `<div style="font-size:11px;margin-top:6px">기본 첨부 ${files.map(f => `<span class="pill p-blue" style="margin:2px 3px 0 0">📎 ${escapeHtml(f.filename)}</span>`).join('')}</div>` : ''}
        <div id="sbm-prev">${prevHtml(picked)}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap">
      <button class="btn bp" onclick="sendSpBulkMail()" ${picked.length && !bm.sending ? '' : 'disabled'}>${picked.length}명에게 보내기</button>
      <button class="btn" onclick="sendSpTestMail()" ${picked.length && !bm.sending ? '' : 'disabled'}
        title="미리보기 중인 연사의 메일을 내 주소(${escAttr(currentUser?.email || '')})로 한 통 보냅니다 — 기록에 남지 않아요">나에게 먼저 1통</button>
      <span id="sbm-msg" style="font-size:11px;color:var(--i4)"></span>
    </div>
  </div>`;
}

function roundBarHtml(st, rp){
  if(!st || st.key === 'schedule') return '';
  if(rp) return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:-2px 0 10px;padding:7px 10px;border:1px solid var(--am);border-radius:8px;font-size:11px">
      <b style="color:var(--am)">↻ 다시 보내기 «${escapeHtml(rp.r.label)}»</b>
      <span style="color:var(--i3)">다시 보냄 ${rp.done}/${rp.total}명</span>
      <span style="color:var(--i4)">· ${escapeHtml(rp.r.since)} 시작${rp.r.by ? ` · ${escapeHtml(rp.r.by)}` : ''}</span>
      <span style="color:var(--i4)">— 묶음을 열 때 이미 받았던 연사가 대상이에요. 다 보내면 저절로 닫혀요.</span>
      <button class="btn" style="font-size:10px;margin-left:auto" onclick="closeSpRound()">묶음 닫기</button></div>`;
  return `<div style="margin:-2px 0 10px"><button class="btn" style="font-size:10.5px" onclick="startSpRound()"
      title="이 단계 메일을 이미 받았거나 끝낸 연사에게 개정판을 다시 보냅니다 — 지금 이 순간이 기준이 됩니다">↻ 이미 받은 연사에게 다시 보내기 (개정판)</button></div>`;
}

/* 사람마다 넘겨 보는 미리보기 — 일정 변경처럼 사람마다 내용이 다른 메일을 하나씩 확인한다 */
function prevHtml(picked){
  if(!picked.length) return '<div style="margin-top:10px;font-size:11px;color:var(--i4)">연사를 고르면 미리보기가 보여요.</div>';
  const i = ((bm.pi % picked.length) + picked.length) % picked.length;
  const sp = picked[i], m = mailFor(sp), t = mailTargets(sp.id);
  return `<div style="margin-top:10px;padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;font-size:11.5px;line-height:1.55">
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;font-size:10.5px;color:var(--i4)">
      <button class="btn" style="font-size:10px;padding:1px 7px" onclick="sbmPrev(-1)">◀</button>
      <span>${i + 1}/${picked.length}</span>
      <button class="btn" style="font-size:10px;padding:1px 7px" onclick="sbmPrev(1)">▶</button>
      <b style="color:var(--i2)">${escapeHtml(nameOf(sp))}</b>${isEn(sp) ? ' (영문)' : ''}
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">→ ${escapeHtml(t.to.join(', '))}${t.cc.length ? ` (cc ${escapeHtml(t.cc.join(', '))})` : ''}</span>
    </div>
    ${m ? `<div style="white-space:pre-wrap;max-height:300px;overflow:auto"><b>${escapeHtml(m.subject)}</b>\n\n${escapeHtml(m.body)}</div>` : '<div style="color:var(--re)">이 연사에게는 이 단계가 없어요.</div>'}
  </div>`;
}
const refreshPrev = () => {
  const el = document.getElementById('sbm-prev');
  if(el) el.innerHTML = prevHtml(liveSpeakers(bm.evKey).filter(sp => bm.ids.has(sp.id)));
};
export function sbmPrev(d){ if(!bm) return; bm.pi += d; refreshPrev(); }

export function sbmSet(k, v){
  if(!bm || bm.sending) return;
  bm[k] = v;
  if(k === 'step'){ bm.tpl = null; bm.failed = new Set(); pickDue(); }
  render();
}
export function sbmPick(id, on){ if(!bm || bm.sending) return; on ? bm.ids.add(id) : bm.ids.delete(id); render(); }
export function sbmAll(mode){
  if(!bm || bm.sending) return;
  if(mode === 'due') pickDue();
  else if(mode === 'failed'){ bm.ids = new Set(bm.failed); bm.pi = 0; }
  else bm.ids = new Set();
  render();
}
/* 문구는 다시 그리지 않고 담아만 둔다 — 그리면 입력 중인 칸이 초기화된다. 미리보기만 고친다 */
export function sbmTpl(k, v){
  if(!bm) return;
  if(!bm.tpl){ const st = curStep() || {};
    bm.tpl = { subject_ko: st.subject_ko || '', body_ko: st.body_ko || '', subject_en: st.subject_en || '', body_en: st.body_en || '' }; }
  bm.tpl[k] = v;
  refreshPrev();
}

const say = (t, ok) => { const m = document.getElementById('sbm-msg'); if(m){ m.style.color = ok ? 'var(--g)' : 'var(--re)'; m.textContent = t; } };

/* 시험 발송 — 미리보기 중인 연사의 메일을 내 주소로. speaker_id를 안 넘겨 기록에 남지 않는다 */
export async function sendSpTestMail(){
  if(!bm || bm.sending) return;
  const me = currentUser?.email;
  if(!me){ say('내 메일 주소를 몰라요 — 로그인 상태를 확인하세요.'); return; }
  const picked = liveSpeakers(bm.evKey).filter(sp => bm.ids.has(sp.id));
  if(!picked.length) return;
  const sp = picked[((bm.pi % picked.length) + picked.length) % picked.length];
  const m = mailFor(sp);
  if(!m) return;
  const fileIds = mailFilesOf(bm.evKey).filter(f => f.step === bm.step).map(f => f.id);
  say(`${me}로 보내는 중…`, true);
  const res = await sendMail({ to: [me], subject: `[시험] ${m.subject}`, text: m.body, event_id: bm.evKey, file_ids: fileIds });
  say(res.ok ? `${me}로 «${nameOf(sp)}» 메일을 보냈어요 — 받은편지함에서 확인하세요.` : (res.error || '보내지 못했어요.'), !!res.ok);
}

export async function sendSpBulkMail(){
  if(!bm || bm.sending) return;
  if(evPartDone(bm.evKey, 'conf')){ say('진행 완료된 컨퍼런스예요 — 열람만 됩니다.'); return; }
  const list = liveSpeakers(bm.evKey).filter(sp => bm.ids.has(sp.id) && mailTargets(sp.id).to.length);
  if(!list.length){ say('받을 연사를 골라주세요.'); return; }
  const st = curStep();
  if(!st) return;
  const from = await eventMailFrom(bm.evKey);
  if(!from.ok){ say(from.text); return; }
  const notTurn = list.filter(sp => !isTurn(stateOf(sp, bm.step))).length;
  // 밖으로 나가는 일 — 한 번 묻는다
  if(!confirm(`${list.length}명에게 «${st.label}» 메일을 보낼까요?\n\n발신 ${from.text}\n연사마다 한 통씩 따로 나갑니다(받는 사람은 각 연사의 «연락 상대» 수신·참조).${
    notTurn ? `\n\n이 중 ${notTurn}명은 보낼 차례가 아니에요(이미 받았거나 해당 없음).` : ''}`)) return;

  bm.sending = true;
  render();
  const fileIds = mailFilesOf(bm.evKey).filter(f => f.step === bm.step).map(f => f.id);
  const fileNote = fileIds.length ? `\n\n[첨부] ${mailFilesOf(bm.evKey).filter(f => fileIds.includes(f.id)).map(f => f.filename).join(', ')}` : '';
  let ok = 0;
  const fails = [];
  bm.failed = new Set();
  for(const [i, sp] of list.entries()){
    say(`보내는 중… ${i + 1}/${list.length} ${nameOf(sp)}`, true);
    const t = mailTargets(sp.id);
    const m = mailFor(sp);
    if(!m){ fails.push(`${nameOf(sp)}: 이 단계가 없어요`); bm.failed.add(sp.id); continue; }
    const res = await sendMail({ to: t.to, cc: t.cc, subject: m.subject, text: m.body, speaker_id: sp.id,
      category: m.category, kind: bm.step, file_ids: fileIds });
    if(!res.ok){ fails.push(`${nameOf(sp)}: ${res.error || '실패'}`); bm.failed.add(sp.id); continue; }
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
  trackAction('add', '연사 일괄 메일', bm.evKey, `«${st.label}»${st.round ? ` (${st.round.label})` : ''} ${ok}명 보냄${fails.length ? ` · 실패 ${fails.length}명` : ''}`);
  bm.sending = false;
  /* 묶음 대상에게 다 다시 보냈으면 묶음을 닫는다 */
  const rp = roundProgress(curStep());
  let closed = false;
  if(rp && rp.done >= rp.total){ await closeSpRound(true); closed = true; }
  pickDue();   // 보낸 사람은 «보냄»으로 넘어가 빠진다
  render();
  say(`${ok}명에게 보냈어요${closed ? ' · 다시 보내기 묶음을 다 보내 닫았어요' : ''}${fails.length ? ` — 실패 ${fails.length}명: ${fails.slice(0, 5).join(' / ')}${fails.length > 5 ? ' …' : ''}` : ''}`, !fails.length);
  window.renderConf?.(); window.renderSpeakerDr?.();
}

Object.assign(window, { openSpeakerBulkMail, closeSpBulkMail: close, sbmSet, sbmPick, sbmAll, sbmTpl, sbmPrev,
  sendSpBulkMail, sendSpTestMail, startSpRound, closeSpRound });
