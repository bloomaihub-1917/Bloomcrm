/* ══════════════════════════════════════════════════════════════
   mail-preview.js — 메일 양식 편집기의 «미리보기»

   고치는 양식에 연사·참가사 한 곳을 골라 칸을 채운 결과를 바로 보여 준다.
   채우기는 보낼 때 쓰는 함수 그대로다(speaker-flow fillTemplate · exh-mail fillExhTemplate ·
   컨택은 행사 칸 + 예시 기업). 미리보기용 채우기를 따로 만들지 않는다.

   쓰는 법: 칸 칩과 같은 묶음(data-vscope) 안에 previewHtml(영역, { ev, step })을 그린다.
   묶음 안의 «…subject_ko / …body_ko / …subject_en / …body_en» 칸을 읽는다(id 끝으로 찾는다).
   연사 연락 순서처럼 독촉(remind_)·지난 자료 확인(reuse_) 칸이 함께 있으면 마지막으로
   커서가 있던 칸의 묶음을 보여 준다.

   speaker-flow·exh-mail·exh-tab은 이 파일을 쓰는 화면들과 서로 얽혀 있어 그릴 때 불러온다.
══════════════════════════════════════════════════════════════ */
import { EXHIBITORS, speakersForEvent } from '../state.js';
import { eventVarValues, varPattern } from './mail-vars.js';
import { escapeHtml, escAttr } from '../utils.js';

const spName = (sp) => sp.name_snapshot || sp.name_en || '(이름 없음)';

function targets(part, ev){
  if(part === 'conf') return speakersForEvent(ev)
    .filter(sp => sp.hidden !== 'yes' && sp.status !== '취소')
    .map(sp => ({ id: sp.id, label: `${spName(sp)}${sp.org_ko || sp.org_en ? ` · ${sp.org_ko || sp.org_en}` : ''}` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  if(part === 'exh') return EXHIBITORS.filter(x => x.event_id === ev)
    .map(x => ({ id: x.id, label: x.company_name || x.id }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
  return [];
}

export function previewHtml(part, { ev = '', step = '' } = {}){
  const list = targets(part, ev);
  const who = part === 'contact' ? '<span style="color:var(--i4)">예시 기업으로 채워요</span>'
    : list.length ? `<select class="fi vprev-who" style="font-size:11px;max-width:240px">${list.map(t =>
        `<option value="${escAttr(t.id)}">${escapeHtml(t.label)}</option>`).join('')}</select>`
    : `<span style="color:var(--i4)">이 행사에 ${part === 'conf' ? '연사' : '참가사'}가 없어 행사 칸만 채워요</span>`;
  return `<div class="vprev" data-part="${escAttr(part)}" data-ev="${escAttr(ev)}" data-step="${escAttr(step)}">
    <div class="vprev-hd"><b>미리보기</b>${who}
      <select class="fi vprev-lang" style="font-size:11px;width:auto">
        <option value="auto">${part === 'contact' ? '국문' : '받는 쪽 언어'}</option><option value="ko">국문</option><option value="en">영문</option></select></div>
    <div class="vprev-out"></div>
  </div>`;
}

/* ── 채우기 ── */
async function fillers(){
  const [sf, em, et] = await Promise.all([import('./speaker-flow.js'), import('./exh-mail.js'), import('./exh-tab.js')]);
  return { sf, em, et };
}
async function filler(vp){
  const { part, ev, step: stepKey } = vp.dataset;
  const id = vp.querySelector('.vprev-who')?.value || '';
  const lang = vp.querySelector('.vprev-lang')?.value || 'auto';
  const { sf, em, et } = await fillers();
  if(part === 'conf'){
    const sp = speakersForEvent(ev).find(s => String(s.id) === id);
    const step = (stepKey && sf.flowSteps(ev, { withOff: true }).find(s => s.key === stepKey)) || {};
    if(!sp) return { en: lang === 'en', fill: (t) => fillEventOnly(t, ev, lang === 'en', 'conf') };
    const en = lang === 'auto' ? sp.lang_pref === 'en' : lang === 'en';
    const who = { ...sp, lang_pref: en ? 'en' : 'ko' };   // 언어를 바꿔 볼 때 — 원본은 건드리지 않는다
    return { en, fill: (t) => sf.fillTemplate(t, who, step) };
  }
  if(part === 'exh'){
    const x = EXHIBITORS.find(e => String(e.id) === id);
    const step = (stepKey && em.exhMailSteps(ev, { withOff: true }).find(s => s.key === stepKey)) || {};
    if(!x) return { en: lang === 'en', fill: (t) => fillEventOnly(t, ev, lang === 'en', 'exh') };
    const en = lang === 'auto' ? em.exhIsEnglish(x) : lang === 'en';
    const ctx = et.exhMailCtx(x);
    return { en, fill: (t) => em.fillExhTemplate(t, x, step, en, ctx) };
  }
  // 컨택 — 명단은 차수마다 달라 예시 기업으로 채운다(행사 칸은 실제 값)
  const en = lang === 'en';
  const vars = { ...eventVarValues(ev, en), 기업: en ? 'Example Co.' : '예시 기업', 담당자: en ? 'Jane Doe' : '홍길동' };
  return { en, fill: (t) => String(t || '').replace(varPattern('contact'), (_, k) => vars[k] ?? '') };
}
function fillEventOnly(t, ev, en, part){
  const vars = eventVarValues(ev, en);
  return String(t || '').replace(varPattern(part), (m, k) => (k in vars ? vars[k] : m));
}

/* 묶음 안에서 지금 볼 제목·본문 칸 — 마지막으로 커서가 있던 칸의 접두(remind_·reuse_)를 따른다 */
let lastField = null;
function fieldsFor(scope, en){
  const all = [...scope.querySelectorAll('input[id], textarea[id]')];
  const pre = (() => {
    const m = lastField && scope.contains(lastField) && /(?:^|-)((?:remind_|reuse_)?)(?:subject|body)_(?:ko|en)$/.exec(lastField.id);
    return m ? m[1] : '';
  })();
  const pick = (k) => all.find(el => new RegExp(`(?:^|-)${pre}${k}$`).test(el.id));
  const l = en ? 'en' : 'ko';
  return { s: pick(`subject_${l}`), b: pick(`body_${l}`), pre };
}

const hl = (s) => escapeHtml(s).replace(/\{[^{}\s]{1,12}\}/g, m => `<mark class="vprev-raw">${m}</mark>`);
const PRE_LABEL = { remind_: '독촉', reuse_: '지난 자료 확인' };

let seq = 0;
async function render(vp){
  const out = vp.querySelector('.vprev-out');
  if(!out) return;
  const my = ++seq; vp.dataset.seq = String(my);
  let f;
  try { f = await filler(vp); }
  catch(e){ console.warn('[CRM] 미리보기 실패:', e); out.textContent = '미리보기를 만들지 못했어요.'; return; }
  if(vp.dataset.seq !== String(my)) return;   // 그사이 다시 그렸다
  const scope = vp.closest('[data-vscope]') || vp.parentElement;
  const { s, b, pre } = fieldsFor(scope, f.en);
  const subj = s?.value || '', body = b?.value || '';
  if(!subj.trim() && !body.trim()){
    out.innerHTML = `<div style="color:var(--i4)">${f.en ? '영문' : '국문'} ${PRE_LABEL[pre] ? PRE_LABEL[pre] + ' ' : ''}문구가 비어 있어요.</div>`;
    return;
  }
  /* 쓴 칸 중 값이 빈 것 — 연사 메일은 그 줄이 빠지고, 전시·컨택은 빈 채로 나간다 */
  const used = [...new Set((subj + '\n' + body).match(/\{[^{}\s]{1,12}\}/g) || [])];
  const empty = used.filter(t => { const v = f.fill(t); return !String(v).trim(); });
  out.innerHTML = `${PRE_LABEL[pre] ? `<div class="vprev-note">${PRE_LABEL[pre]} 문구</div>` : ''}
    <div class="vprev-subj">${hl(f.fill(subj)) || '<span style="color:var(--i4)">(제목 없음)</span>'}</div>
    <div class="vprev-body">${hl(f.fill(body))}</div>
    ${empty.length ? `<div class="vprev-note">값이 비어 있는 칸: ${empty.map(escapeHtml).join(' ')}</div>` : ''}`;
}

/* ── 동작 — 한 번만 건다 ── */
if(!window.__mailPreviewBound){
  window.__mailPreviewBound = true;
  const inScope = (el) => [...document.querySelectorAll('.vprev')].filter(vp => (vp.closest('[data-vscope]') || vp.parentElement).contains(el));
  let t = null;
  document.addEventListener('input', e => {
    const vps = inScope(e.target);
    if(!vps.length) return;
    clearTimeout(t); t = setTimeout(() => vps.forEach(render), 150);
  });
  document.addEventListener('change', e => { const vp = e.target.closest?.('.vprev'); if(vp) render(vp); });
  document.addEventListener('focusin', e => {
    if(!/^(INPUT|TEXTAREA)$/.test(e.target.tagName || '')) return;
    const changed = lastField !== e.target; lastField = e.target;
    if(changed) inScope(e.target).forEach(render);   // 독촉 칸으로 옮기면 독촉 문구를 보여 준다
  });
  let queued = false;
  new MutationObserver(() => {
    if(queued) return;
    queued = true;
    setTimeout(() => {   // rAF는 창이 뒤에 있으면 돌지 않는다
      queued = false;
      document.querySelectorAll('.vprev:not([data-seen])').forEach(vp => { vp.dataset.seen = '1'; render(vp); });
    });
  }).observe(document.body, { childList: true, subtree: true });
}
