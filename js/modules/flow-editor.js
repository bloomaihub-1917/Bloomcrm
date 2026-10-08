/* ══════════════════════════════════════════════════════════════
   flow-editor.js — 연사 연락 단계 편집 창

   행사를 돌리다 보면 «일정표가 바뀌어 정정 메일», «만찬 안내»처럼 처음엔 없던
   연락이 생긴다. 그때마다 설정 › 행사 › 컨퍼런스까지 가서 고치기 번거로워,
   연사 화면·메일 탭에서 바로 이 창을 연다. 고치면 그 자리에서 저장된다.

   정본은 그대로 행사 설정(conf.flow · conf.flow_custom)이다 — 이 창은 그걸 고치는
   또 하나의 문일 뿐이라 설정 화면과 늘 같은 값을 본다.
     기본 단계  이름·설명·마감일·메일 양식 고치기, 끄고 켜기 (지울 수 없다 — 끝난 기준이 코드에 있다)
     더한 단계  더하기·고치기·지우기, 어느 단계 뒤에 둘지, 기준일
══════════════════════════════════════════════════════════════ */
import { EVENT_LIST, confCfg, evPartDone } from '../state.js';
import { FLOW_STEPS, FLOW_VARS, CUSTOM_PRESETS, flowSteps, isCustomStep } from './speaker-flow.js';
import { saveConf } from './settings-tab.js';
import { trackAction } from './audit-tab.js';
import { loadMailFiles, mailFilesOf, uploadMailFile, deleteMailFile, fileToBase64 } from '../api.js';
import { escapeHtml, escAttr, td } from '../utils.js';

let edEv = null;      // 고치는 행사
let edOpen = null;    // 펼친 단계 key ('new'면 새 단계)
let edDraft = null;   // 새 단계 초안

const FIELDS = [
  ['label', '단계 이름'], ['desc', '설명'], ['due', '마감일'],
  ['subject_ko', '제목 (국문)'], ['body_ko', '본문 (국문)'],
  ['subject_en', '제목 (영문)'], ['body_en', '본문 (영문)'],
  ['remind_subject_ko', '독촉 제목 (국문)'], ['remind_body_ko', '독촉 본문 (국문)'],
  ['remind_subject_en', '독촉 제목 (영문)'], ['remind_body_en', '독촉 본문 (영문)'],
  ['reuse_subject_ko', '지난 자료 확인 제목 (국문)'], ['reuse_body_ko', '지난 자료 확인 본문 (국문)'],
  ['reuse_subject_en', '지난 자료 확인 제목 (영문)'], ['reuse_body_en', '지난 자료 확인 본문 (영문)'],
];
const CUSTOM_FIELDS = ['label', 'desc', 'due', 'subject_ko', 'body_ko', 'subject_en', 'body_en'];

const locked = () => !!edEv && evPartDone(edEv, 'conf');

function ruleOf(st){
  if(st.custom) return st.since ? `${st.since}까지 초청한 연사 — 그 뒤 이 메일을 보내면 끝` : '이 메일을 보내면 끝';
  if(st.since) return `기준일 ${st.since} — 이미 받은 연사에게 다시 보내면 끝`;
  if(st.done === 'needs') return '역할이 요구하는 자료를 다 받으면 끝';
  if(st.done.startsWith('cell:')) return '발표자료를 받음으로 표시하면 끝';
  if(st.done === 'log') return '이 단계 메일을 보내면 끝';
  return ({ guide_sent_at: '«보냄» 날짜가 찍히면 끝', invite_replied_at: '«초청 회신» 날짜가 있으면 끝',
    confirmed_at: '«참가 확정» 날짜가 있으면 끝' })[st.done.slice(6)] || '';
}

/* ── 저장 — 행사 설정을 고쳐 곧바로 올리고, 열린 화면들을 다시 그린다 ── */
async function pushFlow(fn, label){
  if(locked()){ alert('진행 완료된 컨퍼런스예요 — 열람만 됩니다.'); return false; }
  const cfg = JSON.parse(JSON.stringify(confCfg(edEv)));
  if(fn(cfg) === false) return false;
  if(cfg.flow && !Object.keys(cfg.flow).length) delete cfg.flow;
  if(cfg.flow_custom && !cfg.flow_custom.length) delete cfg.flow_custom;
  if(!await saveConf(edEv, cfg)) return false;
  const ev = EVENT_LIST.find(e => e.key === edEv) || {};
  trackAction('edit', '연사 연락 단계', edEv, `${ev.name || edEv} — ${label}`);
  window.renderSpeakerDr?.(); window.renderConf?.();
  if(document.getElementById('conf-msg')) window.renderEvDetail?.();   // 설정 화면이 열려 있으면
  return true;
}

/* ── 창 ── */
export function openFlowEditor(evKey, stepKey){
  edEv = evKey; edDraft = null;
  edOpen = stepKey && flowSteps(evKey, { withOff: true }).some(s => s.key === stepKey) ? stepKey : null;
  let ov = document.getElementById('flow-ed');
  if(!ov){
    ov = document.createElement('div');
    ov.id = 'flow-ed';
    ov.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto';
    ov.addEventListener('mousedown', e => { if(e.target === ov) closeFlowEditor(); });
    document.body.appendChild(ov);
  }
  renderFlowEditor();
  loadMailFiles(evKey).then(fillFiles);
}
export function closeFlowEditor(){ document.getElementById('flow-ed')?.remove(); edEv = null; }

function renderFlowEditor(){
  const ov = document.getElementById('flow-ed');
  if(!ov || !edEv) return;
  const ev = EVENT_LIST.find(e => e.key === edEv) || {};
  const steps = flowSteps(edEv, { withOff: true });
  const ro = locked();
  ov.innerHTML = `<div style="background:var(--W);border-radius:10px;width:min(760px,100%);padding:16px 18px;box-shadow:0 10px 30px rgba(0,0,0,.2)">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <b style="font-size:14px">연사 연락 단계</b>
      <span style="font-size:11.5px;color:var(--i4)">${escapeHtml(ev.name || ev.short || edEv)}</span>
      <button class="btn" style="margin-left:auto;font-size:11px" onclick="closeFlowEditor()">닫기</button>
    </div>
    <div style="font-size:11px;color:var(--i4);line-height:1.6;margin-bottom:10px">
      고치면 바로 저장되고 연사 화면의 «지금 할 일»에 반영돼요. 기본 단계는 끄기만 되고, 더한 단계는 지울 수 있어요.
      ${ro ? '<br><b style="color:var(--re)">진행 완료된 컨퍼런스라 열람만 됩니다.</b>' : ''}</div>
    ${steps.map((st, i) => rowHtml(st, i, ro)).join('')}
    ${edOpen === 'new' ? `<div style="border:1px solid var(--a);border-radius:8px;margin-bottom:6px">${formHtml(edDraft, true)}</div>` : ''}
    ${ro || edOpen === 'new' ? '' : `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
      <button class="btn bp" style="font-size:11px" onclick="newFlowStep(-1)">+ 단계 추가</button>
      ${CUSTOM_PRESETS.map((p, k) => `<button class="btn" style="font-size:11px" onclick="newFlowStep(${k})">+ ${escapeHtml(p.label)}</button>`).join('')}
    </div>`}
  </div>`;
  fillFiles();
}

function rowHtml(st, i, ro){
  const open = edOpen === st.key;
  return `<div style="border:1px solid ${open ? 'var(--a)' : 'var(--i6)'};border-radius:8px;margin-bottom:6px;background:var(--W)">
    <div style="padding:7px 10px;display:flex;gap:8px;align-items:center;font-size:12px;${st.off ? 'opacity:.55' : ''}">
      <input type="checkbox" title="이 행사에서 이 단계를 씀" ${st.off ? '' : 'checked'} ${ro ? 'disabled' : ''}
        onchange="toggleFlowStep('${escAttr(st.key)}',this.checked)">
      <b>${i + 1}. ${escapeHtml(st.label || '(이름 없음)')}</b>
      ${st.custom ? '<span class="pill p-amber" style="font-size:9.5px">더한 단계</span>' : ''}
      ${st.due ? `<span class="pill p-gray" style="font-size:9.5px">마감 ${escapeHtml(st.due)}</span>` : ''}
      ${st.since && !st.custom ? `<span class="pill p-amber" style="font-size:9.5px">다시 보내기 ${escapeHtml(st.since)}</span>` : ''}
      <span style="font-size:10.5px;color:var(--i4);margin-left:auto;text-align:right">${escapeHtml(ruleOf(st))}</span>
      ${ro ? '' : `<button class="btn" style="font-size:10.5px" onclick="editFlowStep('${escAttr(st.key)}')">${open ? '접기' : '고치기'}</button>
      ${st.off ? '' : `<button class="btn" style="font-size:10.5px" title="이 단계 메일을 여러 연사에게 한 번에 보냅니다"
        onclick="openSpeakerBulkMail('${escAttr(edEv)}','${escAttr(st.key)}')">📨 여러 명에게</button>`}
      ${st.custom ? `<button class="btn" style="font-size:10.5px;color:var(--re)" onclick="deleteFlowStep('${escAttr(st.key)}')">지우기</button>` : ''}`}
    </div>
    ${open ? formHtml(st, false) : ''}
  </div>`;
}

function formHtml(st, isNew){
  const custom = isNew || st.custom;
  const def = custom ? null : FLOW_STEPS.find(x => x.key === st.key);
  const id = (f) => `fe-${f}`;
  const fld = (f, l) => {
    if(!custom && def[f] === undefined && !['label', 'desc', 'due'].includes(f)) return '';
    if(custom && !CUSTOM_FIELDS.includes(f)) return '';
    const v = st[f] ?? '';
    if(f === 'due') return `<div><div class="mlbl">${l}</div><input class="fi" type="date" id="${id(f)}" value="${escAttr(v)}" style="width:160px"></div>`;
    if(f.includes('body')) return `<div style="grid-column:1/-1"><div class="mlbl">${l}</div>
      <textarea class="fi" id="${id(f)}" rows="7" style="width:100%;resize:vertical;font-size:11.5px">${escapeHtml(v)}</textarea></div>`;
    return `<div${f === 'desc' ? ' style="grid-column:1/-1"' : ''}><div class="mlbl">${l}</div>
      <input class="fi" id="${id(f)}" value="${escAttr(v)}" style="width:100%"></div>`;
  };
  /* 더한 단계는 놓을 자리와 기준일을 고른다 — 자기 자신 뒤에는 둘 수 없다 */
  const others = flowSteps(edEv, { withOff: true }).filter(x => x.key !== st.key);
  const extra = custom ? `
    <div><div class="mlbl">놓을 자리</div><select class="fi" id="fe-after" style="width:100%">
      <option value=""${st.after === '' ? ' selected' : ''}>맨 앞</option>
      ${others.map(x => `<option value="${escAttr(x.key)}"${st.after === x.key ? ' selected' : ''}>«${escapeHtml(x.label)}» 다음</option>`).join('')}
      <option value="__end"${st.after == null || st.after === '__end' ? ' selected' : ''}>맨 끝</option></select></div>
    <div><div class="mlbl">기준일 <span style="font-weight:400;color:var(--i4)">— 비우면 모든 연사</span></div>
      <input class="fi" type="date" id="fe-since" value="${escAttr(st.since || '')}" style="width:160px">
      <div style="font-size:10px;color:var(--i4);margin-top:2px">이날까지 초청한 연사에게만 서고, 이날 이후 보낸 메일만 끝으로 셉니다</div></div>`
    : `<div style="grid-column:1/-1"><div class="mlbl">기준일 — 다시 보내기 <span style="font-weight:400;color:var(--i4)">— 비우면 평소대로</span></div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input class="fi" type="date" id="fe-since" value="${escAttr(st.since || '')}" style="width:160px">
        <button class="btn" style="font-size:10.5px" onclick="document.getElementById('fe-since').value='${td()}'">오늘</button>
        <button class="btn" style="font-size:10.5px" onclick="document.getElementById('fe-since').value=''">비우기</button></div>
      <div style="font-size:10px;color:var(--i4);margin-top:2px;line-height:1.5">적으면 이 단계를 이미 받았거나 끝낸 연사에게 다시 «지금 할 일»로 서고, 이날 이후 이 메일을 보내면 끝납니다(예: 가이드라인 개정판). 아직 이 단계까지 오지 않은 연사는 평소대로 갑니다. 다 보냈으면 비워 두세요.</div></div>`;
  return `<div style="padding:4px 11px 11px;border-top:1px solid var(--i7)">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
      ${FIELDS.map(([f, l]) => fld(f, l)).join('')}${extra}
    </div>
    <div style="font-size:10.5px;color:var(--i4);margin-top:6px;line-height:1.6">쓸 수 있는 칸: ${FLOW_VARS.map(v => `<code>${escapeHtml(v)}</code>`).join(' ')} — 영문(EN) 연사에게는 영문 양식이 나가요</div>
    ${isNew ? '' : `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--i7)">
      <div class="mlbl">기본 첨부 <span style="font-weight:400;color:var(--i4)">— 이 단계 메일에 자동으로 붙어요 (파일당 3MB)</span></div>
      <div id="fe-files" data-step="${escAttr(st.key)}" style="font-size:11px;color:var(--i4)">불러오는 중…</div>
      <label class="btn" style="font-size:10.5px;margin-top:5px;display:inline-block;cursor:pointer">+ 파일 올리기
        <input type="file" multiple style="display:none" onchange="uploadFlowEdFiles('${escAttr(st.key)}',this)"></label></div>`}
    <div style="display:flex;gap:6px;margin-top:10px;align-items:center">
      <button class="btn bp" style="font-size:11px" onclick="saveFlowStep('${isNew ? 'new' : escAttr(st.key)}')">${isNew ? '추가' : '저장'}</button>
      <button class="btn" style="font-size:11px" onclick="editFlowStep(null)">취소</button>
      ${!isNew && !custom ? `<button class="btn" style="font-size:11px;margin-left:auto" onclick="resetFlowStep('${escAttr(st.key)}')"
        title="이 행사에서 고친 문구를 지우고 기본 문구로 돌립니다">기본 문구로 되돌리기</button>` : ''}
    </div>
  </div>`;
}

function fillFiles(){
  const el = document.getElementById('fe-files');
  if(!el || !edEv) return;
  const files = mailFilesOf(edEv).filter(f => f.step === el.dataset.step);
  el.innerHTML = files.length ? files.map(f => `<div style="display:flex;gap:6px;align-items:center;padding:2px 0">
      📎 <span style="color:var(--i2)">${escapeHtml(f.filename)}</span>
      <span>${(Number(f.size || 0) / 1024).toFixed(0)}KB</span>
      <button class="btn" style="font-size:10px;padding:1px 6px;margin-left:auto" onclick="removeFlowEdFile('${escAttr(f.id)}')">삭제</button></div>`).join('')
    : '없음';
}

/* ── 동작 ── */
export function editFlowStep(key){ edOpen = edOpen === key ? null : key; edDraft = null; renderFlowEditor(); }

export function newFlowStep(presetIdx){
  const p = CUSTOM_PRESETS[presetIdx] || { label: '', desc: '', subject_ko: '[{행사}]  — {호칭}', subject_en: '[{행사}] ',
    body_ko: '{호칭}께\n\n안녕하십니까. {행사} 사무국 {담당자}입니다.\n\n\n\n{담당자} 드림\n{행사} 사무국',
    body_en: 'Dear {호칭},\n\n\n\nSincerely,\n{담당자}\n{행사} Secretariat' };
  edDraft = { ...p, since: p.since === 'today' ? td() : (p.since || ''), after: p.after ?? '__end' };
  edOpen = 'new';
  renderFlowEditor();
  document.getElementById('fe-label')?.focus();
}

const readForm = () => {
  const o = {};
  [...FIELDS.map(([f]) => f), 'since', 'after'].forEach(f => {
    const el = document.getElementById(`fe-${f}`);
    if(el) o[f] = el.value.trim();
  });
  return o;
};

export async function saveFlowStep(key){
  const v = readForm();
  if(!v.label){ alert('단계 이름을 적어 주세요.'); return; }
  if(key === 'new' || isCustomStep(key)){
    const rec = {};
    CUSTOM_FIELDS.forEach(f => { if(v[f]) rec[f] = v[f]; });
    if(v.since) rec.since = v.since;
    if(v.after !== '__end') rec.after = v.after;
    const nk = key === 'new' ? `c-${Date.now().toString(36)}` : key;
    const ok = await pushFlow(cfg => {
      const list = cfg.flow_custom = cfg.flow_custom || [];
      const i = list.findIndex(x => x.key === nk);
      const prev = i >= 0 ? list[i] : {};
      const next = { key: nk, ...rec, ...(prev.off ? { off: true } : {}) };
      if(i >= 0) list[i] = next; else list.push(next);
    }, `${key === 'new' ? '단계 추가' : '단계 고침'} «${v.label}»`);
    if(ok){ edOpen = key === 'new' ? nk : null; edDraft = null; renderFlowEditor(); }
    return;
  }
  /* 기본 단계 — 코드 기본값과 다른 칸만 담는다(기본 문구를 고치면 손대지 않은 행사에 따라오게) */
  const def = FLOW_STEPS.find(x => x.key === key);
  if(!def) return;
  const ok = await pushFlow(cfg => {
    const flow = cfg.flow = cfg.flow || {};
    const o = { ...(flow[key] && flow[key].off !== undefined ? { off: flow[key].off } : {}) };
    FIELDS.forEach(([f]) => { if(v[f] !== undefined && v[f] !== String(def[f] ?? '')) o[f] = v[f]; });
    if(v.since) o.since = v.since;
    if(Object.keys(o).length) flow[key] = o; else delete flow[key];
  }, `«${v.label}» 단계 고침${v.since ? ` (기준일 ${v.since})` : ''}`);
  if(ok){ edOpen = null; renderFlowEditor(); }
}

export async function resetFlowStep(key){
  const def = FLOW_STEPS.find(x => x.key === key);
  if(!def || !confirm(`«${def.label}»을 기본 문구로 되돌릴까요?\n이 행사에서 고친 이름·설명·마감일·메일 문구가 지워집니다.`)) return;
  const ok = await pushFlow(cfg => {
    const flow = cfg.flow || {};
    const keep = {};
    if(flow[key]?.off !== undefined) keep.off = flow[key].off;
    if(flow[key]?.since) keep.since = flow[key].since;
    if(Object.keys(keep).length) flow[key] = keep; else delete flow[key];
    cfg.flow = flow;
  }, `«${def.label}» 기본 문구로`);
  if(ok){ edOpen = null; renderFlowEditor(); }
}

export async function toggleFlowStep(key, on){
  const st = flowSteps(edEv, { withOff: true }).find(s => s.key === key);
  if(!st) return;
  const ok = await pushFlow(cfg => {
    if(isCustomStep(key)){
      const c = (cfg.flow_custom || []).find(x => x.key === key);
      if(!c) return false;
      if(on) delete c.off; else c.off = true;
    } else {
      const flow = cfg.flow = cfg.flow || {};
      const o = { ...(flow[key] || {}) };
      if(on) delete o.off; else o.off = true;
      if(Object.keys(o).length) flow[key] = o; else delete flow[key];
    }
  }, `«${st.label}» ${on ? '켬' : '끔'}`);
  renderFlowEditor();
  return ok;
}

export async function deleteFlowStep(key){
  const st = flowSteps(edEv, { withOff: true }).find(s => s.key === key);
  if(!st || !st.custom) return;
  if(!confirm(`«${st.label}» 단계를 지울까요?\n이미 보낸 메일 기록은 남아요. 다시 쓸 일이 있으면 지우지 말고 체크를 꺼 두세요.`)) return;
  const ok = await pushFlow(cfg => { cfg.flow_custom = (cfg.flow_custom || []).filter(x => x.key !== key); }, `단계 지움 «${st.label}»`);
  if(ok){ if(edOpen === key) edOpen = null; renderFlowEditor(); }
}

export async function uploadFlowEdFiles(step, input){
  const files = [...(input.files || [])];
  input.value = '';
  for(const f of files){
    if(f.size > 3 * 1024 * 1024){ alert(`${f.name}: 3MB가 넘어 올릴 수 없어요.`); continue; }
    const data = await fileToBase64(f);
    const r = await uploadMailFile({ event_id: edEv, step, filename: f.name, content_type: f.type, data });
    if(!r.ok){ alert(`${f.name}: ${r.error || '올리지 못했어요'}`); continue; }
    trackAction('add', '메일 기본 첨부', edEv, `${step} 단계에 «${f.name}» 올림`);
  }
  fillFiles();
}
export async function removeFlowEdFile(id){
  const f = mailFilesOf(edEv).find(x => x.id === id);
  if(!f || !confirm(`«${f.filename}»을(를) 기본 첨부에서 지울까요?`)) return;
  const r = await deleteMailFile(edEv, id);
  if(!r.ok){ alert(r.error || '지우지 못했어요'); return; }
  trackAction('delete', '메일 기본 첨부', edEv, `${f.step} 단계 «${f.filename}» 지움`);
  fillFiles();
}

Object.assign(window, { openFlowEditor, closeFlowEditor, editFlowStep, newFlowStep, saveFlowStep,
  resetFlowStep, toggleFlowStep, deleteFlowStep, uploadFlowEdFiles, removeFlowEdFile });
