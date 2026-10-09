/* ══════════════════════════════════════════════════════════════
   exh-bulkmail.js — 여러 참가사에 같은 안내를 한 번에

   «매뉴얼 보냈나», «그래픽 마감 안내 다 돌렸나»는 기업 수십 곳에 같은 메일을
   보내는 일이다. 한 통에 모두를 수신으로 넣으면 서로의 주소가 보이고, 기록도
   기업마다 남지 않는다. 그래서 기업마다 따로 한 통씩 보내고 그 기업 기록에 남긴다.

   - 받는 곳: 지금 전시 목록에서 걸러 보고 있는 기업(visibleList) 중 체크한 곳.
     보낼 차례인 곳이 미리 골라진다(exhMailState). 부스 변경 안내는 알린 부스와 지금
     부스가 다른 곳만 잡힌다(exh-mail.js boothChange)
   - 다시 보내기(개정판): «↻ 이미 받은 곳에 다시 보내기»로 발송 묶음(EXH_CFG.exhMailRounds)을
     연다. 그 순간 이미 받았거나 끝낸 곳이 대상이 되고, 다 보내면 묶음이 저절로 닫힌다
   - 보내기 전: 기업마다 넘겨 보는 미리보기, «나에게 먼저 1통»(기록에 안 남는 시험 발송)
   - 문구: 전시 메일 양식(exh-mail.js)의 단계 문구. 여기서 고친 문구는 이번 발송에만 쓴다
   - 언어: 기업별 자동(기업DB 국가) / 모두 국문 / 모두 영문
   - 받는 사람: 메인 담당자만 / 메일 있는 담당자 모두 / 첨부: 그 단계의 기본 첨부
══════════════════════════════════════════════════════════════ */
import { EXH_LOGS, EXHIBITORS, EXH_CFG, currentUser, logsFor } from '../state.js';
import { sendMail, eventMailFrom, loadMailFiles, mailFilesOf, saveExhCfgToSheet } from '../api.js';
import { escapeHtml, escAttr, nowStamp } from '../utils.js';
import { visibleList, exhNames, exhContacts, exhMailCtx, exhLocked, exhLockNotice, STEPS, cellState } from './exh-tab.js';
import { exhMailSteps, exhIsEnglish, fillExhTemplate, exhMailFileStep, boothChange, exhStepVariants } from './exh-mail.js';
import { libItems, libItem } from './mail-templates.js';
import { trackAction } from './audit-tab.js';
import './exh-mail-editor.js';

let bm = null;   // { evKey, ids:Set, step, variant, lang, who, tpl, sending, pi, failed:Set }
const isLib = (key) => String(key || '').startsWith('lib:');

const close = () => { document.getElementById('exh-bulkmail')?.remove(); bm = null; };
const mailsOf = (x, who) => {
  const ppl = exhContacts(x).filter(p => p.email);
  const pick = who === 'all' ? ppl : [ppl.find(p => p.primary) || ppl[0]].filter(Boolean);
  return [...new Set(pick.map(p => String(p.email).trim()).filter(Boolean))];
};
/* ── 이 기업에게 이 메일이 지금 보낼 차례인가 ──
   기본 단계는 진행 체크리스트의 그 칸(due 키 = STEPS 키)을 본다 — 매뉴얼은 «매뉴얼 회신»,
   신청서는 «신청서 접수»처럼 기업에서 받아야 끝나는 칸이다.
     done    그 칸이 끝났거나 해당 없음 → 보내지 않는다
     late    메일은 보냈는데 마감이 지났다 → 다시 보낼 차례(독촉)
     sent    보냈고 아직 기다리는 중 → 고르지 않는다
     due     아직 안 보냈다 → 보낼 차례
     resend  다시 보내기 묶음의 대상인데 묶음을 연 뒤 아직 다시 안 보냈다 → 보낼 차례
     na      해당 없음(부스 변경 안내인데 부스가 그대로인 곳)
   더한 단계는 칸이 없으니 이 단계 메일을 보낸 기록만 본다. «기타 안내»는 차례가 없다(free). */
const sentOf = (x, key, since) => logsFor(x.id).some(l => l.kind === `exh-${key}` && l.direction !== 'in'
  && (!since || String(l.ts || '') >= since));
function baseState(x, st){
  if(st.key === 'booth_change') return boothChange(x).changed ? 'due' : 'na';
  const sent = sentOf(x, st.key);
  if(st.custom) return sent ? 'sent' : 'due';
  const step = st.due && STEPS.find(s => s.key === st.due);
  if(step){
    const c = cellState(x, step);
    if(c.state === 'done' || c.state === 'na') return c.state === 'na' ? 'na' : 'done';
    if(sent) return c.due && c.due.days < 0 ? 'late' : 'sent';
    return 'due';
  }
  return sent ? 'sent' : 'due';
}
export function exhMailState(x, st){
  if(!st || st.key === 'note' || st.lib) return 'free';
  if(st.round && (st.round.targets || []).includes(x.id)) return sentOf(x, st.key, st.round.since) ? 'sent' : 'resend';
  return baseState(x, st);
}
const isTurn = (s) => s === 'due' || s === 'late' || s === 'resend';
const STATE_PILL = {
  due:    '<span class="pill p-amber" style="font-size:9.5px">보낼 차례</span>',
  resend: '<span class="pill p-amber" style="font-size:9.5px">다시 보낼 차례</span>',
  late:   '<span class="pill p-red" style="font-size:9.5px;background:var(--rb);color:var(--re)">마감 지남·재발송</span>',
  sent:   '<span class="pill p-blue" style="font-size:9.5px">보냄·기다림</span>',
  done:   '<span class="pill p-green" style="font-size:9.5px">끝남</span>',
  na:     '<span class="pill p-gray" style="font-size:9.5px">해당 없음</span>',
  free: '',
};
/* 지금 고른 메일 — 보관함 양식이면 단계 모양으로 바꿔 돌려준다(차례가 없어 «기타 안내»처럼 다룬다) */
const curStep = () => {
  if(isLib(bm.step)){ const it = libItem(bm.step.slice(4)); return it ? { ...it, key: bm.step, label: it.name, due: '', lib: true } : null; }
  return exhMailSteps(bm.evKey).find(s => s.key === bm.step);
};
/* 보낼 차례이고 메일 받을 사람이 있는 기업 */
function pickTurn(){
  const st = curStep();
  const list = visibleList().filter(x => mailsOf(x, bm.who).length);
  bm.ids = new Set((!st || st.key === 'note' || st.lib ? list : list.filter(x => isTurn(exhMailState(x, st)))).map(x => x.id));
  bm.pi = 0;
}
const enOf = (x) => bm.lang === 'en' ? true : bm.lang === 'ko' ? false : exhIsEnglish(x);

/* stepKey를 주면 그 단계가 골라진 채로 연다(전시 메일 단계 편집 창의 «📨 여러 기업에») */
export async function openExhBulkMail(stepKey){
  const list = visibleList();
  if(!list.length){ alert('지금 전시 목록에 기업이 없어요 — 전시 탭에서 행사를 열고 보내 주세요.'); return; }
  const evKey = list[0].event_id;
  const steps = exhMailSteps(evKey);
  if(!steps.length){ alert('이 행사에 켜진 메일 단계가 없어요.'); return; }
  const st = steps.find(s => s.key === stepKey) || steps[0];
  bm = { evKey, ids: new Set(), step: st.key, variant: '', lang: 'auto', who: 'primary', tpl: pickTpl(evKey, st.key),
    sending: false, pi: 0, failed: new Set() };
  pickTurn();
  await loadMailFiles(evKey);
  render();
}
/* 처음 채울 문구 — 보관함 양식, 고른 변형, 아니면 단계 문구 */
function pickTpl(evKey, key, variant){
  const st = isLib(key) ? (libItem(key.slice(4)) || {}) : (exhMailSteps(evKey).find(s => s.key === key) || {});
  const v = variant ? exhStepVariants(evKey, key).find(x => x.id === variant) : null;
  const src = v || st;
  return { subject_ko: src.subject_ko || st.subject_ko || '', body_ko: src.body_ko || st.body_ko || '',
    subject_en: src.subject_en || st.subject_en || '', body_en: src.body_en || st.body_en || '' };
}
function mailFor(x){
  const st = curStep();
  const en = enOf(x), ctx = exhMailCtx(x);
  return { subject: fillExhTemplate(bm.tpl[en ? 'subject_en' : 'subject_ko'], x, st, en, ctx),
    body: fillExhTemplate(bm.tpl[en ? 'body_en' : 'body_ko'], x, st, en, ctx), en };
}

/* ── 다시 보내기 묶음 — 행사 설정(EXH_CFG[행사].exhMailRounds). 단계당 하나만 열린다 ── */
async function pushRounds(fn){
  if(exhLocked()){ exhLockNotice(); return false; }
  const prev = EXH_CFG[bm.evKey] ? JSON.parse(JSON.stringify(EXH_CFG[bm.evKey])) : undefined;
  const cfg = JSON.parse(JSON.stringify(prev || {}));
  cfg.exhMailRounds = cfg.exhMailRounds || [];
  if(fn(cfg.exhMailRounds) === false) return false;
  // 닫힌 묶음은 최근 20개만 — «언제 무엇을 다시 돌렸나»는 기업 기록에 남아 있다
  cfg.exhMailRounds = [...cfg.exhMailRounds.filter(r => r.closed_at).slice(-20), ...cfg.exhMailRounds.filter(r => !r.closed_at)];
  EXH_CFG[bm.evKey] = cfg;
  const r = await saveExhCfgToSheet(bm.evKey, cfg);
  if(r && r.ok === false){
    if(prev) EXH_CFG[bm.evKey] = prev; else delete EXH_CFG[bm.evKey];
    alert('저장하지 못했어요. 네트워크 확인 후 다시 시도해주세요.');
    return false;
  }
  return true;
}
const eventExhibitors = () => EXHIBITORS.filter(x => x.event_id === bm.evKey);
function roundProgress(st){
  const r = st && st.round;
  if(!r) return null;
  const ids = new Set(r.targets || []);
  const xs = eventExhibitors().filter(x => ids.has(x.id));
  return { r, total: xs.length, done: xs.filter(x => sentOf(x, st.key, r.since)).length };
}
export async function startExhRound(){
  if(!bm || bm.sending) return;
  const st = curStep();
  if(!st) return;
  /* 이미 받았거나 끝낸 곳 — 아직 안 받은 곳은 평소대로 «보낼 차례»라 묶음에 넣지 않는다 */
  const targets = eventExhibitors().filter(x => ['sent', 'late', 'done'].includes(baseState(x, st))).map(x => x.id);
  if(!targets.length){ alert(`«${st.label}»을 이미 받은 곳이 없어요 — 다시 보낼 곳이 없습니다.`); return; }
  const label = (prompt(`이미 «${st.label}»을 받은 ${targets.length}곳에 다시 보냅니다.\n이번 묶음의 이름 (예: 매뉴얼 개정판)`, `${st.label} 개정판`) || '').trim();
  if(!label) return;
  const ok = await pushRounds(list => {
    list.push({ id: `R-${Date.now().toString(36)}`, step: st.key, label, since: nowStamp(), targets,
      by: currentUser?.name || currentUser?.email || '' });
  });
  if(!ok) return;
  trackAction('add', '참가사 다시 보내기', bm.evKey, `«${st.label}» 묶음 «${label}» ${targets.length}곳`);
  pickTurn();
  render();
}
export async function closeExhRound(silent){
  if(!bm) return;
  const st = curStep();
  if(!st || !st.round) return;
  if(!silent){
    const p = roundProgress(st);
    if(!confirm(`다시 보내기 묶음 «${st.round.label}»을 닫을까요?${p && p.done < p.total ? `\n\n아직 ${p.total - p.done}곳에 다시 안 보냈어요. 닫으면 그 기업들은 평소 상태로 돌아갑니다.` : ''}`)) return;
  }
  const ok = await pushRounds(list => { const r = list.find(x => x.id === st.round.id); if(!r) return false; r.closed_at = nowStamp(); });
  if(!ok) return;
  trackAction('edit', '참가사 다시 보내기', bm.evKey, `«${st.label}» 묶음 «${st.round.label}» 닫음`);
  pickTurn();
  render();
}

function render(){
  if(!bm) return;
  const list = visibleList();
  const steps = exhMailSteps(bm.evKey);
  const st = curStep();
  const libs = libItems('exh', bm.evKey);
  const vs = st && !st.lib ? exhStepVariants(bm.evKey, st.key) : [];
  const files = mailFilesOf(bm.evKey).filter(f => f.step === exhMailFileStep(bm.step));
  const picked = list.filter(x => bm.ids.has(x.id));
  const rp = roundProgress(st);
  const failedN = [...bm.failed].filter(id => list.some(x => x.id === id)).length;
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
      <div><div class="mlbl">무슨 메일인가</div><select class="fi" onchange="bmSet('step',this.value)" ${bm.sending ? 'disabled' : ''}>${steps.map(s => { const n = s.key === 'note' ? 0 : list.filter(x => isTurn(exhMailState(x, s))).length;
          return opt(s.key, bm.step, escapeHtml(s.label) + (s.round ? ' ↻' : '') + (n ? ` — 보낼 차례 ${n}곳` : '')); }).join('')}
        ${libs.length ? `<optgroup label="양식 보관함">${libs.map(it => opt(`lib:${escAttr(it.id)}`, bm.step, escapeHtml(it.name))).join('')}</optgroup>` : ''}</select>
        ${vs.length ? `<div style="display:flex;gap:6px;align-items:center;margin-top:5px;font-size:11px"><span style="color:var(--i4)">양식</span>
          <select class="fi" style="font-size:11.5px;flex:1" onchange="bmSet('variant',this.value)">
            ${opt('', bm.variant, '기본 문구')}${vs.map(v => opt(escAttr(v.id), bm.variant, escapeHtml(v.label))).join('')}</select></div>` : ''}</div>
      <div><div class="mlbl">언어</div><select class="fi" onchange="bmSet('lang',this.value)">${opt('auto', bm.lang, '기업별 자동 (해외는 영문)')}${opt('ko', bm.lang, '모두 국문')}${opt('en', bm.lang, '모두 영문')}</select></div>
      <div><div class="mlbl">받는 사람</div><select class="fi" onchange="bmSet('who',this.value)">${opt('primary', bm.who, '메인 담당자만')}${opt('all', bm.who, '메일 있는 담당자 모두')}</select></div>
    </div>
    ${roundBarHtml(st, rp)}
    ${st && st.key === 'booth_change' ? `<div style="font-size:10.5px;color:var(--i4);margin:-4px 0 8px">알린 부스(그 기업에 마지막으로 보낸 메일의 «부스 번호:» 줄)와 지금 부스가 다른 곳만 잡혀요. 보내면 새 번호가 «알린 부스»가 됩니다.</div>` : ''}
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:14px">
      <div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
          <div class="mlbl" style="margin:0">받는 기업 ${picked.length}/${list.length}</div>
          <span style="margin-left:auto;display:flex;gap:4px">
            ${failedN ? `<button class="btn" style="font-size:10px;color:var(--re)" onclick="bmAll('failed')">실패한 ${failedN}곳만</button>` : ''}
            ${st && st.key !== 'note' ? `<button class="btn" style="font-size:10px" onclick="bmAll('turn')" title="이 메일이 보낼 차례인 기업만 고릅니다">보낼 차례만</button>` : ''}
            <button class="btn" style="font-size:10px" onclick="bmAll(true)">전체</button>
            <button class="btn" style="font-size:10px" onclick="bmAll(false)">해제</button></span>
        </div>
        <div style="border:1px solid var(--i6);border-radius:8px;max-height:360px;overflow:auto">
          ${list.map(x => { const ms = mailsOf(x, bm.who); const bc = st && st.key === 'booth_change' ? boothChange(x) : null;
            return `<label style="display:flex;gap:6px;align-items:center;padding:5px 8px;border-bottom:1px solid var(--i8);font-size:11.5px;cursor:${ms.length ? 'pointer' : 'default'};opacity:${ms.length ? 1 : .5}">
            <input type="checkbox" ${bm.ids.has(x.id) ? 'checked' : ''} ${ms.length && !bm.sending ? '' : 'disabled'} onchange="bmPick('${escAttr(x.id)}',this.checked)">
            <b style="flex:0 0 auto">${escapeHtml(exhNames(x).ko)}</b>
            <span class="pill p-gray" style="font-size:9.5px">${enOf(x) ? 'EN' : 'KO'}</span>${STATE_PILL[exhMailState(x, st)] || ''}${
              bc && bc.changed ? `<span style="font-size:10px;color:var(--am)">${escapeHtml(bc.from)} → ${escapeHtml(bc.to)}</span>` : ''}${
              bm.failed.has(x.id) ? '<span class="pill p-red" style="font-size:9.5px;background:var(--rb);color:var(--re)">실패</span>' : ''}
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
        <div style="font-size:10.5px;color:var(--i4);margin-top:4px">{기업}·{담당자}·{부스}·{변경내용}·{청구액}·{미납액}은 기업마다 채워집니다. 여기서 고친 문구는 이번 발송에만 쓰고, 기본 문구와 단계는
          <a href="#" onclick="openExhMailEditor('${escAttr(bm.evKey)}','${escAttr(bm.step)}');return false">✎ 단계 편집</a>에서 고칩니다.</div>
        ${files.length ? `<div style="font-size:11px;margin-top:6px">기본 첨부 ${files.map(f => `<span class="pill p-blue" style="margin:2px 3px 0 0">📎 ${escapeHtml(f.filename)}</span>`).join('')}</div>` : ''}
        <div id="bm-prev">${prevHtml(picked)}</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap">
      <button class="btn bp" onclick="sendExhBulkMail()" ${picked.length && !bm.sending ? '' : 'disabled'}>${picked.length}곳에 보내기</button>
      <button class="btn" onclick="sendExhTestMail()" ${picked.length && !bm.sending ? '' : 'disabled'}
        title="미리보기 중인 기업의 메일을 내 주소(${escAttr(currentUser?.email || '')})로 한 통 보냅니다 — 기록에 남지 않아요">나에게 먼저 1통</button>
      <span id="bm-msg" style="font-size:11px;color:var(--i4)"></span>
    </div>
  </div>`;
}

function roundBarHtml(st, rp){
  if(!st || st.lib || st.key === 'note' || st.key === 'booth_change') return '';
  if(rp) return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:-2px 0 10px;padding:7px 10px;border:1px solid var(--am);border-radius:8px;font-size:11px">
      <b style="color:var(--am)">↻ 다시 보내기 «${escapeHtml(rp.r.label)}»</b>
      <span style="color:var(--i3)">다시 보냄 ${rp.done}/${rp.total}곳</span>
      <span style="color:var(--i4)">· ${escapeHtml(rp.r.since)} 시작${rp.r.by ? ` · ${escapeHtml(rp.r.by)}` : ''}</span>
      <span style="color:var(--i4)">— 묶음을 열 때 이미 받았던 곳이 대상이에요(진행 칸이 끝난 곳 포함). 다 보내면 저절로 닫혀요.</span>
      <button class="btn" style="font-size:10px;margin-left:auto" onclick="closeExhRound()">묶음 닫기</button></div>`;
  return `<div style="margin:-2px 0 10px"><button class="btn" style="font-size:10.5px" onclick="startExhRound()"
      title="이 메일을 이미 받았거나 끝낸 곳에 개정판을 다시 보냅니다 — 지금 이 순간이 기준이 됩니다">↻ 이미 받은 곳에 다시 보내기 (개정판)</button></div>`;
}

/* 기업마다 넘겨 보는 미리보기 */
function prevHtml(picked){
  if(!picked.length) return '<div style="margin-top:10px;font-size:11px;color:var(--i4)">기업을 고르면 미리보기가 보여요.</div>';
  const i = ((bm.pi % picked.length) + picked.length) % picked.length;
  const x = picked[i], m = mailFor(x);
  return `<div style="margin-top:10px;padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;font-size:11.5px;line-height:1.55">
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;font-size:10.5px;color:var(--i4)">
      <button class="btn" style="font-size:10px;padding:1px 7px" onclick="bmPrev(-1)">◀</button>
      <span>${i + 1}/${picked.length}</span>
      <button class="btn" style="font-size:10px;padding:1px 7px" onclick="bmPrev(1)">▶</button>
      <b style="color:var(--i2)">${escapeHtml(exhNames(x).ko)}</b>${m.en ? ' (영문)' : ''}
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">→ ${escapeHtml(mailsOf(x, bm.who).join(', '))}</span>
    </div>
    <div style="white-space:pre-wrap;max-height:240px;overflow:auto"><b>${escapeHtml(m.subject)}</b>\n\n${escapeHtml(m.body)}</div>
  </div>`;
}
const refreshPrev = () => { const el = document.getElementById('bm-prev'); if(el) el.innerHTML = prevHtml(visibleList().filter(x => bm.ids.has(x.id))); };
export function bmPrev(d){ if(!bm) return; bm.pi += d; refreshPrev(); }

export function bmSet(k, v){
  if(!bm || bm.sending) return;
  bm[k] = v;
  if(k === 'step'){ bm.variant = ''; bm.tpl = pickTpl(bm.evKey, v); bm.failed = new Set(); pickTurn(); }
  if(k === 'variant') bm.tpl = pickTpl(bm.evKey, bm.step, v);
  if(k === 'who') visibleList().forEach(x => { if(!mailsOf(x, v).length) bm.ids.delete(x.id); });
  render();
}
export function bmPick(id, on){ if(!bm || bm.sending) return; on ? bm.ids.add(id) : bm.ids.delete(id); render(); }
export function bmAll(on){
  if(!bm || bm.sending) return;
  if(on === 'turn') pickTurn();
  else if(on === 'failed'){ bm.ids = new Set(bm.failed); bm.pi = 0; }
  else bm.ids = new Set(on ? visibleList().filter(x => mailsOf(x, bm.who).length).map(x => x.id) : []);
  render();
}
// 문구는 다시 그리지 않고 담아만 둔다 — 그리면 입력 중인 칸이 초기화된다. 미리보기만 고친다
export function bmTpl(k, v){ if(!bm) return; bm.tpl[k] = v; refreshPrev(); }

const say = (t, ok) => { const m = document.getElementById('bm-msg'); if(m){ m.style.color = ok ? 'var(--g)' : 'var(--re)'; m.textContent = t; } };

/* 시험 발송 — 미리보기 중인 기업의 메일을 내 주소로. exhibitor_id를 안 넘겨 기록에 남지 않는다 */
export async function sendExhTestMail(){
  if(!bm || bm.sending) return;
  const me = currentUser?.email;
  if(!me){ say('내 메일 주소를 몰라요 — 로그인 상태를 확인하세요.'); return; }
  const picked = visibleList().filter(x => bm.ids.has(x.id));
  if(!picked.length) return;
  const x = picked[((bm.pi % picked.length) + picked.length) % picked.length];
  const m = mailFor(x);
  const fileIds = mailFilesOf(bm.evKey).filter(f => f.step === exhMailFileStep(bm.step)).map(f => f.id);
  say(`${me}로 보내는 중…`, true);
  const res = await sendMail({ to: [me], subject: `[시험] ${m.subject}`, text: m.body, event_id: bm.evKey, file_ids: fileIds });
  say(res.ok ? `${me}로 «${exhNames(x).ko}» 메일을 보냈어요 — 받은편지함에서 확인하세요.` : (res.error || '보내지 못했어요.'), !!res.ok);
}

export async function sendExhBulkMail(){
  if(!bm || bm.sending) return;
  if(exhLocked()){ exhLockNotice(); return; }
  const list = visibleList().filter(x => bm.ids.has(x.id));
  if(!list.length){ say('받을 기업을 골라주세요.'); return; }
  const from = await eventMailFrom(bm.evKey);
  if(!from.ok){ say(from.text); return; }
  const st = curStep();
  if(!st) return;
  const fileIds = mailFilesOf(bm.evKey).filter(f => f.step === exhMailFileStep(bm.step)).map(f => f.id);
  // 밖으로 나가는 일 — 한 번 묻는다
  const notTurn = st.key === 'note' || st.lib ? 0 : list.filter(x => !isTurn(exhMailState(x, st))).length;
  if(!confirm(`${list.length}곳에 «${st.label}»${st.round ? ` (${st.round.label})` : ''} 메일을 보낼까요?${notTurn ? `\n\n이 중 ${notTurn}곳은 보낼 차례가 아니에요(이미 보냈거나 끝남).` : ''}\n\n발신 ${from.text}\n받는 사람: ${bm.who === 'all' ? '메일 있는 담당자 모두' : '메인 담당자'}\n기업마다 한 통씩 따로 나갑니다.`)) return;

  bm.sending = true;
  render();
  const kind = bm.step === 'note' || st.lib ? 'note' : `exh-${bm.step}`;
  let ok = 0;
  const fails = [];
  bm.failed = new Set();
  for(const [i, x] of list.entries()){
    say(`보내는 중… ${i + 1}/${list.length} ${exhNames(x).ko}`, true);
    const to = mailsOf(x, bm.who);
    const { subject, body: text } = mailFor(x);
    const res = await sendMail({ to, subject, text, exhibitor_id: x.id, category: st.label, kind, file_ids: fileIds });
    if(!res.ok){ fails.push(`${exhNames(x).ko}: ${res.error || '실패'}`); bm.failed.add(x.id); continue; }
    ok++;
    if(res.logId) EXH_LOGS.push({
      id: res.logId, exhibitor_id: x.id, kind, ts: nowStamp(), direction: 'out', channel: '이메일',
      counterpart: to.join(', '), category: st.label, subject, answered_at: '', answer: '', status: 'done',
      body: text + (fileIds.length ? `\n\n[첨부] ${mailFilesOf(bm.evKey).filter(f => fileIds.includes(f.id)).map(f => f.filename).join(', ')}` : ''),
      author_email: currentUser?.email || '', author_name: currentUser?.name || '',
    });
  }
  trackAction('add', '참가사 일괄 메일', bm.evKey, `«${st.label}»${st.round ? ` (${st.round.label})` : ''} ${ok}곳 보냄${fails.length ? ` · 실패 ${fails.length}곳` : ''}`);
  bm.sending = false;
  /* 묶음 대상에게 다 다시 보냈으면 묶음을 닫는다 */
  const rp = roundProgress(curStep());
  let closed = false;
  if(rp && rp.done >= rp.total){ await closeExhRound(true); closed = true; }
  pickTurn();   // 보낸 곳은 «보냄»으로 넘어가 빠진다
  render();
  say(`${ok}곳에 보냈어요${closed ? ' · 다시 보내기 묶음을 다 보내 닫았어요' : ''}${fails.length ? ` — 실패 ${fails.length}곳: ${fails.slice(0, 5).join(' / ')}${fails.length > 5 ? ' …' : ''}` : ''}`, !fails.length);
  window.renderExh?.();
}

/* 단계 편집 창에서 단계를 고치면 — 고른 단계가 없어졌으면 첫 단계로, 문구는 새 기본 문구로 */
window.refreshExhBulkMail = () => {
  if(!bm || bm.sending) return;
  const steps = exhMailSteps(bm.evKey);
  if(!steps.length){ close(); return; }
  if(!curStep()){ bm.step = steps[0].key; bm.variant = ''; }
  if(bm.variant && !exhStepVariants(bm.evKey, bm.step).some(v => v.id === bm.variant)) bm.variant = '';
  bm.tpl = pickTpl(bm.evKey, bm.step, bm.variant);
  pickTurn();
  render();
};
Object.assign(window, { openExhBulkMail, closeExhBulkMail: close, bmSet, bmPick, bmAll, bmTpl, bmPrev,
  sendExhBulkMail, sendExhTestMail, startExhRound, closeExhRound });
