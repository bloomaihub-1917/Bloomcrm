/* ══════════════════════════════════════════════════════════════
   exh-mail-editor.js — 전시 참가사 메일 단계 편집 창

   연사 연락 단계 편집 창(flow-editor.js)과 같은 틀. 행사를 돌리다 «주차 안내»,
   «철수 일정 변경»처럼 처음엔 없던 안내가 생기면 참가사 메일 탭이나
   «여러 기업에 메일»에서 바로 단계를 더하고 고친다. 고치면 곧바로 저장된다.

   정본은 행사 설정(EXH_CFG[행사].exhMail · exhMailCustom) — 이 창은 그걸 고치는 문이다.
     기본 단계  이름·메일 문구 고치기, 끄고 켜기 (마감은 설정 › 행사 › 일정의 마감을 읽는다)
     더한 단계  더하기·고치기·지우기, 놓을 자리, 마감일(날짜를 바로 적는다)
══════════════════════════════════════════════════════════════ */
import { EVENT_LIST, EXH_CFG, evPartDone } from '../state.js';
import { EXH_MAIL_STEPS, EXH_MAIL_VARS, exhMailSteps, exhMailFileStep, isCustomExhStep } from './exh-mail.js';
import { saveExhCfgToSheet, loadMailFiles, mailFilesOf, uploadMailFile, deleteMailFile, fileToBase64 } from '../api.js';
import { trackAction } from './audit-tab.js';
import { escapeHtml, escAttr } from '../utils.js';

let edEv = null, edOpen = null, edDraft = null;

const FIELDS = [['label', '단계 이름'], ['subject_ko', '제목 (국문)'], ['body_ko', '본문 (국문)'],
  ['subject_en', '제목 (영문)'], ['body_en', '본문 (영문)']];
const locked = () => !!edEv && evPartDone(edEv, 'exh');

/* 저장 — 행사 설정 전체를 고쳐 올리고, 실패하면 되돌린다 */
async function pushCfg(fn, label){
  if(locked()){ alert('진행 완료된 전시예요 — 열람만 됩니다.'); return false; }
  const prev = EXH_CFG[edEv] ? JSON.parse(JSON.stringify(EXH_CFG[edEv])) : undefined;
  const cfg = JSON.parse(JSON.stringify(prev || {}));
  if(fn(cfg) === false) return false;
  if(cfg.exhMail && !Object.keys(cfg.exhMail).length) delete cfg.exhMail;
  if(cfg.exhMailCustom && !cfg.exhMailCustom.length) delete cfg.exhMailCustom;
  EXH_CFG[edEv] = cfg;
  const r = await saveExhCfgToSheet(edEv, cfg);
  if(r && r.ok === false){
    if(prev) EXH_CFG[edEv] = prev; else delete EXH_CFG[edEv];
    alert('저장하지 못했어요. 네트워크 확인 후 다시 시도해주세요.');
    return false;
  }
  const ev = EVENT_LIST.find(e => e.key === edEv) || {};
  trackAction('edit', '전시 메일 단계', edEv, `${ev.name || edEv} — ${label}`);
  window.renderExhDr?.();
  if(document.getElementById('exh-bulkmail')) window.refreshExhBulkMail?.();
  if(document.getElementById('evmb-msg')) window.renderEvDetail?.();   // 설정 › 메일이 열려 있으면
  return true;
}

export function openExhMailEditor(evKey, stepKey){
  edEv = evKey; edDraft = null;
  edOpen = stepKey && exhMailSteps(evKey, { withOff: true }).some(s => s.key === stepKey) ? stepKey : null;
  let ov = document.getElementById('exm-ed');
  if(!ov){
    ov = document.createElement('div');
    ov.id = 'exm-ed';
    ov.style.cssText = 'position:fixed;inset:0;z-index:1002;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto';
    ov.addEventListener('mousedown', e => { if(e.target === ov) closeExhMailEditor(); });
    document.body.appendChild(ov);
  }
  render();
  loadMailFiles(evKey).then(fillFiles);
}
export function closeExhMailEditor(){ document.getElementById('exm-ed')?.remove(); edEv = null; }

function dueText(st){
  if(st.custom) return st.due_date ? `마감 ${st.due_date}` : '';
  const d = st.due && ((EXH_CFG[edEv] || {}).due || {})[st.due];
  return st.due ? (d ? `마감 ${d} (일정 탭)` : '마감 없음 (일정 탭)') : '';
}

function render(){
  const ov = document.getElementById('exm-ed');
  if(!ov || !edEv) return;
  const ev = EVENT_LIST.find(e => e.key === edEv) || {};
  const steps = exhMailSteps(edEv, { withOff: true });
  const ro = locked();
  ov.innerHTML = `<div style="background:var(--W);border-radius:10px;width:min(760px,100%);padding:16px 18px;box-shadow:0 10px 30px rgba(0,0,0,.2)">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <b style="font-size:14px">전시 메일 단계</b>
      <span style="font-size:11.5px;color:var(--i4)">${escapeHtml(ev.name || ev.short || edEv)}</span>
      <button class="btn" style="margin-left:auto;font-size:11px" onclick="closeExhMailEditor()">닫기</button>
    </div>
    <div style="font-size:11px;color:var(--i4);line-height:1.6;margin-bottom:10px">
      참가사 메일 탭과 «여러 기업에 메일»에서 단계를 고르면 이 문구로 채워집니다. 고치면 바로 저장돼요.
      기본 단계는 끄기만 되고, 더한 단계는 지울 수 있어요. 해외 기업(기업DB 국가)에는 영문 양식이 나갑니다.
      ${ro ? '<br><b style="color:var(--re)">진행 완료된 전시라 열람만 됩니다.</b>' : ''}</div>
    ${steps.map((st, i) => rowHtml(st, i, ro)).join('')}
    ${edOpen === 'new' ? `<div style="border:1px solid var(--a);border-radius:8px;margin-bottom:6px">${formHtml(edDraft, true)}</div>` : ''}
    ${ro || edOpen === 'new' ? '' : `<div style="margin-top:10px"><button class="btn bp" style="font-size:11px" onclick="newExhMailStep()">+ 단계 추가</button></div>`}
  </div>`;
  fillFiles();
}

function rowHtml(st, i, ro){
  const open = edOpen === st.key;
  const due = dueText(st);
  return `<div style="border:1px solid ${open ? 'var(--a)' : 'var(--i6)'};border-radius:8px;margin-bottom:6px;background:var(--W)">
    <div style="padding:7px 10px;display:flex;gap:8px;align-items:center;font-size:12px;flex-wrap:wrap;${st.off ? 'opacity:.55' : ''}">
      <input type="checkbox" title="이 행사에서 이 단계를 씀" ${st.off ? '' : 'checked'} ${ro ? 'disabled' : ''}
        onchange="toggleExhMailStep('${escAttr(st.key)}',this.checked)">
      <b>${i + 1}. ${escapeHtml(st.label || '(이름 없음)')}</b>
      ${st.custom ? '<span class="pill p-amber" style="font-size:9.5px">더한 단계</span>' : ''}
      ${due ? `<span class="pill p-gray" style="font-size:9.5px">${escapeHtml(due)}</span>` : ''}
      ${st.since ? `<span class="pill p-amber" style="font-size:9.5px" title="이날 이후 이 메일을 받지 않은 곳에 다시 보냅니다">기준일 ${escapeHtml(st.since)}</span>` : ''}
      ${ro ? '' : `<span style="margin-left:auto;display:flex;gap:4px">
        ${st.off ? '' : `<button class="btn" style="font-size:10.5px" title="이 단계 메일을 여러 기업에 한 번에 보냅니다"
          onclick="openExhBulkMail('${escAttr(st.key)}')">📨 여러 기업에</button>`}
        <button class="btn" style="font-size:10.5px" onclick="editExhMailStep('${escAttr(st.key)}')">${open ? '접기' : '고치기'}</button>
        ${st.custom ? `<button class="btn" style="font-size:10.5px;color:var(--re)" onclick="deleteExhMailStep('${escAttr(st.key)}')">지우기</button>` : ''}</span>`}
    </div>
    ${open ? formHtml(st, false) : ''}
  </div>`;
}

function formHtml(st, isNew){
  const custom = isNew || st.custom;
  const fld = (f, l) => {
    const v = st[f] ?? '';
    if(f.includes('body')) return `<div style="grid-column:1/-1"><div class="mlbl">${l}</div>
      <textarea class="fi" id="xe-${f}" rows="7" style="width:100%;resize:vertical;font-size:11.5px">${escapeHtml(v)}</textarea></div>`;
    return `<div${f === 'label' ? ' style="grid-column:1/-1"' : ''}><div class="mlbl">${l}</div>
      <input class="fi" id="xe-${f}" value="${escAttr(v)}" style="width:100%"></div>`;
  };
  const others = exhMailSteps(edEv, { withOff: true }).filter(x => x.key !== st.key);
  const extra = custom ? `
    <div><div class="mlbl">놓을 자리</div><select class="fi" id="xe-after" style="width:100%">
      <option value=""${st.after === '' ? ' selected' : ''}>맨 앞</option>
      ${others.map(x => `<option value="${escAttr(x.key)}"${st.after === x.key ? ' selected' : ''}>«${escapeHtml(x.label)}» 다음</option>`).join('')}
      <option value="__end"${st.after == null || st.after === '__end' ? ' selected' : ''}>맨 끝</option></select></div>
    <div><div class="mlbl">마감일 <span style="font-weight:400;color:var(--i4)">— {마감일} 자리에 들어가요</span></div>
      <input class="fi" type="date" id="xe-due_date" value="${escAttr(st.due_date || '')}" style="width:160px"></div>`
    : `<div style="grid-column:1/-1;font-size:10.5px;color:var(--i4)">{마감일}은 설정 › 행사 › 일정의 마감을 읽어요${st.due ? ` — 지금 ${escapeHtml(dueText(st))}` : ' — 이 단계는 마감이 없어요'}.</div>`;
  const sinceFld = st.key === 'note' ? '' : `
    <div style="grid-column:1/-1"><div class="mlbl">기준일 <span style="font-weight:400;color:var(--i4)">— 다시 보낼 때만. 비우면 평소대로</span></div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input class="fi" type="date" id="xe-since" value="${escAttr(st.since || '')}" style="width:160px">
        <button class="btn" style="font-size:10.5px" onclick="document.getElementById('xe-since').value=new Date(Date.now()+9*3600e3).toISOString().slice(0,10)">오늘</button>
        <button class="btn" style="font-size:10.5px" onclick="document.getElementById('xe-since').value=''">비우기</button>
      </div>
      <div style="font-size:10px;color:var(--i4);margin-top:2px;line-height:1.5">적으면 «여러 기업에 메일»에서 이날 이후 이 메일을 받지 않은 곳이 모두 보낼 차례가 됩니다 — 진행 칸이 끝난 곳도요(예: 매뉴얼 개정판). 다 보냈으면 비워 두세요.</div></div>`;
  return `<div style="padding:4px 11px 11px;border-top:1px solid var(--i7)">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
      ${FIELDS.map(([f, l]) => fld(f, l)).join('')}${extra}${sinceFld}
    </div>
    <div style="font-size:10.5px;color:var(--i4);margin-top:6px;line-height:1.6">쓸 수 있는 칸: ${EXH_MAIL_VARS.map(v => `<code>${escapeHtml(v)}</code>`).join(' ')}</div>
    ${isNew ? '' : `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--i7)">
      <div class="mlbl">기본 첨부 <span style="font-weight:400;color:var(--i4)">— 이 단계 메일에 자동으로 붙어요 (파일당 3MB)</span></div>
      <div id="xe-files" data-step="${escAttr(exhMailFileStep(st.key))}" style="font-size:11px;color:var(--i4)">불러오는 중…</div>
      <label class="btn" style="font-size:10.5px;margin-top:5px;display:inline-block;cursor:pointer">+ 파일 올리기
        <input type="file" multiple style="display:none" onchange="uploadExhMailEdFiles('${escAttr(exhMailFileStep(st.key))}',this)"></label></div>`}
    <div style="display:flex;gap:6px;margin-top:10px;align-items:center">
      <button class="btn bp" style="font-size:11px" onclick="saveExhMailStep('${isNew ? 'new' : escAttr(st.key)}')">${isNew ? '추가' : '저장'}</button>
      <button class="btn" style="font-size:11px" onclick="editExhMailStep(null)">취소</button>
      ${!custom ? `<button class="btn" style="font-size:11px;margin-left:auto" onclick="resetExhMailStep('${escAttr(st.key)}')"
        title="이 행사에서 고친 문구를 지우고 기본 문구로 돌립니다">기본 문구로 되돌리기</button>` : ''}
    </div>
  </div>`;
}

function fillFiles(){
  const el = document.getElementById('xe-files');
  if(!el || !edEv) return;
  const files = mailFilesOf(edEv).filter(f => f.step === el.dataset.step);
  el.innerHTML = files.length ? files.map(f => `<div style="display:flex;gap:6px;align-items:center;padding:2px 0">
      📎 <span style="color:var(--i2)">${escapeHtml(f.filename)}</span>
      <span>${(Number(f.size || 0) / 1024).toFixed(0)}KB</span>
      <button class="btn" style="font-size:10px;padding:1px 6px;margin-left:auto" onclick="removeExhMailEdFile('${escAttr(f.id)}')">삭제</button></div>`).join('')
    : '없음';
}

export function editExhMailStep(key){ edOpen = edOpen === key ? null : key; edDraft = null; render(); }
export function newExhMailStep(){
  edDraft = { label: '', subject_ko: '[{행사}]  — {기업}', subject_en: '[{행사}]  — {기업}',
    body_ko: '{담당자}님께\n\n안녕하십니까. {행사} 사무국입니다.\n\n\n감사합니다.\n{행사} 사무국 {보내는사람} 드림',
    body_en: 'Dear {담당자},\n\n\nBest regards,\n{보내는사람}\n{행사} Secretariat', after: '__end' };
  edOpen = 'new';
  render();
  document.getElementById('xe-label')?.focus();
}

const readForm = () => {
  const o = {};
  [...FIELDS.map(([f]) => f), 'after', 'due_date', 'since'].forEach(f => {
    const el = document.getElementById(`xe-${f}`);
    if(el) o[f] = f.includes('body') ? el.value.replace(/\s+$/, '') : el.value.trim();
  });
  return o;
};

export async function saveExhMailStep(key){
  const v = readForm();
  if(!v.label){ alert('단계 이름을 적어 주세요.'); return; }
  if(key === 'new' || isCustomExhStep(key)){
    const nk = key === 'new' ? `c-${Date.now().toString(36)}` : key;
    const ok = await pushCfg(cfg => {
      const list = cfg.exhMailCustom = cfg.exhMailCustom || [];
      const i = list.findIndex(x => x.key === nk);
      const rec = { key: nk };
      FIELDS.forEach(([f]) => { if(v[f]) rec[f] = v[f]; });
      if(v.due_date) rec.due_date = v.due_date;
      if(v.since) rec.since = v.since;
      if(v.after !== '__end') rec.after = v.after;
      if(i >= 0 && list[i].off) rec.off = true;
      if(i >= 0) list[i] = rec; else list.push(rec);
    }, `${key === 'new' ? '단계 추가' : '단계 고침'} «${v.label}»`);
    if(ok){ edOpen = key === 'new' ? nk : null; render(); }
    return;
  }
  /* 기본 단계 — 기본 문구와 다른 칸만 담는다 */
  const def = EXH_MAIL_STEPS.find(x => x.key === key);
  if(!def) return;
  const ok = await pushCfg(cfg => {
    const over = cfg.exhMail = cfg.exhMail || {};
    const o = over[key]?.off ? { off: true } : {};
    FIELDS.forEach(([f]) => { if(v[f] !== undefined && v[f] !== String(def[f] ?? '')) o[f] = v[f]; });
    if(v.since) o.since = v.since;
    if(Object.keys(o).length) over[key] = o; else delete over[key];
  }, `«${v.label}» 단계 고침${v.since ? ` (기준일 ${v.since})` : ''}`);
  if(ok){ edOpen = null; render(); }
}

export async function resetExhMailStep(key){
  const def = EXH_MAIL_STEPS.find(x => x.key === key);
  if(!def || !confirm(`«${def.label}»을 기본 문구로 되돌릴까요?\n이 행사에서 고친 이름·메일 문구가 지워집니다.`)) return;
  const ok = await pushCfg(cfg => {
    const over = cfg.exhMail || {};
    const keep = {};
    if(over[key]?.off) keep.off = true;
    if(over[key]?.since) keep.since = over[key].since;
    if(Object.keys(keep).length) over[key] = keep; else delete over[key];
    cfg.exhMail = over;
  }, `«${def.label}» 기본 문구로`);
  if(ok){ edOpen = null; render(); }
}

export async function toggleExhMailStep(key, on){
  const st = exhMailSteps(edEv, { withOff: true }).find(s => s.key === key);
  if(!st) return;
  await pushCfg(cfg => {
    if(isCustomExhStep(key)){
      const c = (cfg.exhMailCustom || []).find(x => x.key === key);
      if(!c) return false;
      if(on) delete c.off; else c.off = true;
    } else {
      const over = cfg.exhMail = cfg.exhMail || {};
      const o = { ...(over[key] || {}) };
      if(on) delete o.off; else o.off = true;
      if(Object.keys(o).length) over[key] = o; else delete over[key];
    }
  }, `«${st.label}» ${on ? '켬' : '끔'}`);
  render();
}

export async function deleteExhMailStep(key){
  const st = exhMailSteps(edEv, { withOff: true }).find(s => s.key === key);
  if(!st || !st.custom) return;
  if(!confirm(`«${st.label}» 단계를 지울까요?\n이미 보낸 메일 기록은 남아요. 다시 쓸 일이 있으면 지우지 말고 체크를 꺼 두세요.`)) return;
  const ok = await pushCfg(cfg => { cfg.exhMailCustom = (cfg.exhMailCustom || []).filter(x => x.key !== key); }, `단계 지움 «${st.label}»`);
  if(ok){ if(edOpen === key) edOpen = null; render(); }
}

export async function uploadExhMailEdFiles(step, input){
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
export async function removeExhMailEdFile(id){
  const f = mailFilesOf(edEv).find(x => x.id === id);
  if(!f || !confirm(`«${f.filename}»을(를) 기본 첨부에서 지울까요?`)) return;
  const r = await deleteMailFile(edEv, id);
  if(!r.ok){ alert(r.error || '지우지 못했어요'); return; }
  trackAction('delete', '메일 기본 첨부', edEv, `${f.step} 단계 «${f.filename}» 지움`);
  fillFiles();
}

Object.assign(window, { openExhMailEditor, closeExhMailEditor, editExhMailStep, newExhMailStep, saveExhMailStep,
  resetExhMailStep, toggleExhMailStep, deleteExhMailStep, uploadExhMailEdFiles, removeExhMailEdFile });
