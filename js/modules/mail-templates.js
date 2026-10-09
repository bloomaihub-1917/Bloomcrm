/* ══════════════════════════════════════════════════════════════
   mail-templates.js — 메일 양식 여러 개: 단계 변형 · 양식 보관함 · 지난 행사에서 가져오기

   연사(conf)와 전시(exh)가 같은 틀을 쓴다. 저장 자리는 모두 «설정»이다.
     단계 변형    한 단계 안의 다른 문구(예: 초청 — 기조연사용/패널용/좌장용).
                  연사는 역할 조건을 걸면 그 역할 연사에게 저절로 골라지고, 조건 없는 변형은
                  보낼 때 직접 고른다. 끝남·보낼 차례 계산은 단계 그대로다.
                  conf.flow_variants[단계] · EXH_CFG[행사].exhMailVariants[단계]
     양식 보관함  단계와 무관한 자유 양식. «이 행사만» 또는 «모든 행사 공통».
                  settings 표 key='mail_library' 한 줄(MAIL_LIBRARY) — 행사 설정에 두면
                  공통 양식을 둘 자리가 없다
     가져오기     다른 행사에서 다듬은 단계 문구·더한 단계·변형·행사 보관함 양식을 복사한다.
                  날짜(마감·대상 제한)와 첨부는 행사마다 달라 가져오지 않는다
══════════════════════════════════════════════════════════════ */
import { EVENT_LIST, EXH_CFG, MAIL_LIBRARY, confCfg, currentUser, evPartDone, codeList } from '../state.js';
import { saveMailLibrary, saveExhCfgToSheet } from '../api.js';
import { saveConf } from './settings-tab.js';
import { SPEAKER_ROLES } from '../constants.js';
import { FLOW_VARS, flowSteps } from './speaker-flow.js';
import { EXH_MAIL_VARS, exhMailSteps } from './exh-mail.js';
import { trackAction } from './audit-tab.js';
import { escapeHtml, escAttr, nowStamp } from '../utils.js';

const clone = (o) => JSON.parse(JSON.stringify(o || {}));
const newId = (p) => `${p}-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const TEXT_FIELDS = ['label', 'desc', 'subject_ko', 'body_ko', 'subject_en', 'body_en',
  'remind_subject_ko', 'remind_body_ko', 'remind_subject_en', 'remind_body_en',
  'reuse_subject_ko', 'reuse_body_ko', 'reuse_subject_en', 'reuse_body_en'];

const PART = {
  conf: {
    name: '연사', unit: '명', vars: () => FLOW_VARS,
    steps: (ev) => flowSteps(ev, { withOff: true }),
    cfg: (ev) => confCfg(ev),
    save: (ev, cfg) => saveConf(ev, cfg),
    varKey: 'flow_variants', overKey: 'flow', customKey: 'flow_custom',
    locked: (ev) => evPartDone(ev, 'conf'),
  },
  exh: {
    name: '전시', unit: '곳', vars: () => EXH_MAIL_VARS,
    steps: (ev) => exhMailSteps(ev, { withOff: true }),
    cfg: (ev) => EXH_CFG[ev] || {},
    save: async (ev, cfg) => {
      const prev = EXH_CFG[ev];
      EXH_CFG[ev] = cfg;
      const r = await saveExhCfgToSheet(ev, cfg);
      if(r && r.ok === false){ if(prev) EXH_CFG[ev] = prev; else delete EXH_CFG[ev]; alert('저장하지 못했어요. 네트워크 확인 후 다시 시도해주세요.'); return false; }
      return true;
    },
    varKey: 'exhMailVariants', overKey: 'exhMail', customKey: 'exhMailCustom',
    locked: (ev) => evPartDone(ev, 'exh'),
  },
};

/* 고친 뒤 열린 화면들을 다시 그린다 */
function refreshAll(){
  window.__refreshFlowEditor?.(); window.__refreshExhMailEditor?.();
  window.renderSpeakerDr?.(); window.renderConf?.(); window.renderExhDr?.();
  window.refreshExhBulkMail?.(); window.refreshSpBulkMail?.();
  if(document.getElementById('tpl-mgr')) renderMgr();
}
const evName = (ev) => { const e = EVENT_LIST.find(x => x.key === ev) || {}; return e.short || e.name || ev; };

/* ══ 단계 변형 ══ */
export const variantsOf = (part, ev, step) => ((PART[part].cfg(ev)[PART[part].varKey]) || {})[step] || [];
const roleList = (ev) => codeList('speaker_role', ev, SPEAKER_ROLES.map(r => ({ code: r.key, label: r.label })))
  .map(r => ({ key: r.code ?? r.key, label: r.label || r.code || r.key }));

let vEd = null;   // { part, ev, step, id | 'new', draft }

/* 단계 고치기 칸 안에 들어가는 «양식 변형» 묶음 */
export function variantsHtml(part, ev, step, ro){
  const vs = variantsOf(part, ev, step);
  const roles = part === 'conf' ? roleList(ev) : [];
  const rLabel = (k) => (roles.find(r => r.key === k) || {}).label || k;
  const editing = vEd && vEd.part === part && vEd.ev === ev && vEd.step === step ? vEd : null;
  const row = (v) => editing && editing.id === v.id ? formHtml(part, ev, step, v, roles)
    : `<div style="display:flex;gap:6px;align-items:center;padding:4px 0;border-top:1px solid var(--i7);font-size:11.5px">
        <b>${escapeHtml(v.label || '(이름 없음)')}</b>
        ${(v.roles || []).length ? (v.roles || []).map(r => `<span class="pill p-blue" style="font-size:9.5px">${escapeHtml(rLabel(r))}</span>`).join('')
          : `<span style="font-size:10px;color:var(--i4)">${part === 'conf' ? '조건 없음 — 보낼 때 직접 고름' : '보낼 때 고름'}</span>`}
        ${ro ? '' : `<span style="margin-left:auto;display:flex;gap:4px">
          <button class="btn" style="font-size:10px" onclick="tplVarEdit('${part}','${escAttr(ev)}','${escAttr(step)}','${escAttr(v.id)}')">고치기</button>
          <button class="btn" style="font-size:10px;color:var(--re)" onclick="tplVarDelete('${part}','${escAttr(ev)}','${escAttr(step)}','${escAttr(v.id)}')">지우기</button></span>`}
      </div>`;
  return `<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--i7)">
    <div class="mlbl">양식 변형 <span style="font-weight:400;color:var(--i4)">— 이 단계의 다른 문구. ${part === 'conf'
      ? '역할을 고르면 그 역할 연사에게 저절로 이 문구가 나가요(위에서부터 먼저 맞는 것)' : '보낼 때 메일 탭·«여러 기업에 메일»에서 고릅니다'}</span></div>
    ${vs.map(row).join('') || '<div style="font-size:11px;color:var(--i4)">없음 — 위 문구 하나로 보냅니다</div>'}
    ${editing && editing.id === 'new' ? formHtml(part, ev, step, editing.draft, roles) : ''}
    ${ro || editing ? '' : `<button class="btn" style="font-size:10.5px;margin-top:5px" onclick="tplVarEdit('${part}','${escAttr(ev)}','${escAttr(step)}','new')">+ 변형 추가</button>`}
  </div>`;
}
function formHtml(part, ev, step, v, roles){
  const inp = (f, l) => `<div${f === 'label' ? ' style="grid-column:1/-1"' : ''}><div class="mlbl">${l}</div><input class="fi" id="tv-${f}" value="${escAttr(v[f] || '')}" style="width:100%"></div>`;
  const area = (f, l) => `<div style="grid-column:1/-1"><div class="mlbl">${l}</div><textarea class="fi" id="tv-${f}" rows="6" style="width:100%;resize:vertical;font-size:11.5px">${escapeHtml(v[f] || '')}</textarea></div>`;
  return `<div style="border:1px solid var(--a);border-radius:7px;padding:8px 10px;margin-top:6px;background:var(--W)">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${inp('label', '변형 이름 (예: 패널용, 해외 기조연사용)')}
      ${part === 'conf' ? `<div style="grid-column:1/-1"><div class="mlbl">이 역할 연사에게 저절로 <span style="font-weight:400;color:var(--i4)">— 안 고르면 보낼 때 직접 고릅니다</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${roles.map(r => `<label style="font-size:11.5px;display:flex;gap:4px;align-items:center">
          <input type="checkbox" class="tv-role" value="${escAttr(r.key)}" ${(v.roles || []).includes(r.key) ? 'checked' : ''}> ${escapeHtml(r.label)}</label>`).join('')}</div></div>` : ''}
      ${inp('subject_ko', '제목 (국문)')}${inp('subject_en', '제목 (영문)')}
      ${area('body_ko', '본문 (국문)')}${area('body_en', '본문 (영문)')}
    </div>
    <div style="font-size:10.5px;color:var(--i4);margin-top:5px">쓸 수 있는 칸: ${PART[part].vars().map(x => `<code>${escapeHtml(x)}</code>`).join(' ')}</div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn bp" style="font-size:11px" onclick="tplVarSave()">${v.id ? '저장' : '추가'}</button>
      <button class="btn" style="font-size:11px" onclick="tplVarCancel()">취소</button>
    </div>
  </div>`;
}
export function tplVarEdit(part, ev, step, id){
  let draft = null;
  if(id === 'new'){
    /* 새 변형은 지금 단계 문구에서 시작한다 — 빈칸에서 쓰는 것보다 고치는 게 빠르다 */
    const st = PART[part].steps(ev).find(s => s.key === step) || {};
    draft = { label: '', roles: [], subject_ko: st.subject_ko || '', body_ko: st.body_ko || '', subject_en: st.subject_en || '', body_en: st.body_en || '' };
  }
  vEd = { part, ev, step, id, draft };
  refreshAll();
  document.getElementById('tv-label')?.focus();
}
export function tplVarCancel(){ vEd = null; refreshAll(); }
export async function tplVarSave(){
  if(!vEd) return;
  const { part, ev, step, id } = vEd;
  const P = PART[part];
  if(P.locked(ev)){ alert('진행 완료된 행사예요 — 열람만 됩니다.'); return; }
  const g = (f) => (document.getElementById(`tv-${f}`)?.value || '');
  const rec = { label: g('label').trim(), subject_ko: g('subject_ko').trim(), body_ko: g('body_ko').replace(/\s+$/, ''),
    subject_en: g('subject_en').trim(), body_en: g('body_en').replace(/\s+$/, '') };
  if(!rec.label){ alert('변형 이름을 적어 주세요.'); return; }
  if(part === 'conf') rec.roles = [...document.querySelectorAll('.tv-role:checked')].map(el => el.value);
  const cfg = clone(P.cfg(ev));
  const all = cfg[P.varKey] = cfg[P.varKey] || {};
  const list = all[step] = all[step] || [];
  if(id === 'new') list.push({ id: newId('V'), ...rec });
  else { const i = list.findIndex(v => v.id === id); if(i < 0) return; list[i] = { ...list[i], ...rec }; }
  if(!await P.save(ev, cfg)) return;
  trackAction('edit', `${P.name} 메일 양식`, ev, `«${step}» 변형 ${id === 'new' ? '추가' : '고침'} «${rec.label}»`);
  vEd = null;
  refreshAll();
}
export async function tplVarDelete(part, ev, step, id){
  const P = PART[part];
  const v = variantsOf(part, ev, step).find(x => x.id === id);
  if(!v || !confirm(`양식 변형 «${v.label}»을 지울까요?`)) return;
  if(P.locked(ev)){ alert('진행 완료된 행사예요 — 열람만 됩니다.'); return; }
  const cfg = clone(P.cfg(ev));
  cfg[P.varKey][step] = (cfg[P.varKey][step] || []).filter(x => x.id !== id);
  if(!cfg[P.varKey][step].length) delete cfg[P.varKey][step];
  if(!Object.keys(cfg[P.varKey]).length) delete cfg[P.varKey];
  if(!await P.save(ev, cfg)) return;
  trackAction('delete', `${P.name} 메일 양식`, ev, `«${step}» 변형 지움 «${v.label}»`);
  refreshAll();
}

/* ══ 양식 보관함 ══ */
export const libItems = (part, ev) => MAIL_LIBRARY.filter(it => it.part === part && (it.scope === 'all' || it.scope === ev));
export const libItem = (id) => MAIL_LIBRARY.find(it => it.id === id) || null;
async function pushLibrary(fn, label){
  const backup = clone(MAIL_LIBRARY);
  if(fn(MAIL_LIBRARY) === false) return false;
  const r = await saveMailLibrary();
  if(r && r.ok === false){
    MAIL_LIBRARY.splice(0, MAIL_LIBRARY.length, ...backup);
    alert('저장하지 못했어요. 네트워크 확인 후 다시 시도해주세요.');
    return false;
  }
  trackAction('edit', '메일 양식 보관함', mg?.ev || '', label);
  return true;
}

let mg = null;   // { part, ev, tab:'lib'|'import', edit: id|'new'|null, src }

export function openMailTemplates(part, ev, tab = 'lib'){
  mg = { part, ev, tab, edit: null, src: '' };
  let ov = document.getElementById('tpl-mgr');
  if(!ov){
    ov = document.createElement('div');
    ov.id = 'tpl-mgr';
    ov.style.cssText = 'position:fixed;inset:0;z-index:1003;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto';
    ov.addEventListener('mousedown', e => { if(e.target === ov) closeMailTemplates(); });
    document.body.appendChild(ov);
  }
  renderMgr();
}
export function closeMailTemplates(){ document.getElementById('tpl-mgr')?.remove(); mg = null; }

function renderMgr(){
  const ov = document.getElementById('tpl-mgr');
  if(!ov || !mg) return;
  const P = PART[mg.part];
  const tab = (k, l) => `<button class="btn${mg.tab === k ? ' bp' : ''}" style="font-size:11px" onclick="tplTab('${k}')">${l}</button>`;
  ov.innerHTML = `<div style="background:var(--W);border-radius:10px;width:min(760px,100%);padding:16px 18px;box-shadow:0 10px 30px rgba(0,0,0,.2)">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <b style="font-size:14px">${P.name} 메일 양식</b>
      <span style="font-size:11.5px;color:var(--i4)">${escapeHtml(evName(mg.ev))}</span>
      <span style="display:flex;gap:4px;margin-left:12px">${tab('lib', '📚 양식 보관함')}${tab('import', '⇩ 지난 행사에서 가져오기')}</span>
      <button class="btn" style="margin-left:auto;font-size:11px" onclick="closeMailTemplates()">닫기</button>
    </div>
    ${mg.tab === 'lib' ? libHtml() : importHtml()}
  </div>`;
}
export function tplTab(t){ if(!mg) return; mg.tab = t; mg.edit = null; renderMgr(); }

function libHtml(){
  const P = PART[mg.part];
  const items = libItems(mg.part, mg.ev);
  const edit = mg.edit;
  const cur = edit === 'new' ? { name: '', scope: mg.ev, subject_ko: '', body_ko: '', subject_en: '', body_en: '' } : edit ? libItem(edit) : null;
  return `<div style="font-size:11px;color:var(--i4);line-height:1.6;margin-bottom:8px">
      단계와 상관없이 꺼내 쓰는 양식이에요. ${P.name} 메일 탭의 «무슨 메일인가»와 «여러 ${P.name === '연사' ? '연사' : '기업'}에게 메일»에서 «양식 보관함» 묶음으로 보입니다.
      «모든 행사 공통»으로 두면 다른 행사에서도 보여요.</div>
    ${items.map(it => edit === it.id ? libForm(it) : `<div style="display:flex;gap:6px;align-items:center;padding:6px 8px;border:1px solid var(--i6);border-radius:7px;margin-bottom:5px;font-size:12px">
        <b>${escapeHtml(it.name || '(이름 없음)')}</b>
        <span class="pill ${it.scope === 'all' ? 'p-blue' : 'p-gray'}" style="font-size:9.5px">${it.scope === 'all' ? '모든 행사 공통' : '이 행사만'}</span>
        <span style="font-size:10.5px;color:var(--i4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1">${escapeHtml(it.subject_ko || it.subject_en || '')}</span>
        <button class="btn" style="font-size:10px" onclick="tplLibEdit('${escAttr(it.id)}')">고치기</button>
        <button class="btn" style="font-size:10px" onclick="tplLibCopy('${escAttr(it.id)}')">복제</button>
        <button class="btn" style="font-size:10px;color:var(--re)" onclick="tplLibDelete('${escAttr(it.id)}')">지우기</button>
      </div>`).join('') || '<div style="font-size:11.5px;color:var(--i4);margin-bottom:6px">아직 양식이 없어요.</div>'}
    ${edit === 'new' ? libForm(cur) : ''}
    ${edit ? '' : `<button class="btn bp" style="font-size:11px;margin-top:6px" onclick="tplLibEdit('new')">+ 양식 추가</button>`}`;
}
function libForm(it){
  const P = PART[mg.part];
  const inp = (f, l) => `<div><div class="mlbl">${l}</div><input class="fi" id="tl-${f}" value="${escAttr(it[f] || '')}" style="width:100%"></div>`;
  const area = (f, l) => `<div style="grid-column:1/-1"><div class="mlbl">${l}</div><textarea class="fi" id="tl-${f}" rows="7" style="width:100%;resize:vertical;font-size:11.5px">${escapeHtml(it[f] || '')}</textarea></div>`;
  return `<div style="border:1px solid var(--a);border-radius:8px;padding:9px 11px;margin-bottom:6px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${inp('name', '양식 이름')}
      <div><div class="mlbl">어디서 보일까</div><select class="fi" id="tl-scope" style="width:100%">
        <option value="${escAttr(mg.ev)}"${it.scope !== 'all' ? ' selected' : ''}>이 행사만 (${escapeHtml(evName(mg.ev))})</option>
        <option value="all"${it.scope === 'all' ? ' selected' : ''}>모든 행사 공통</option></select></div>
      ${inp('subject_ko', '제목 (국문)')}${inp('subject_en', '제목 (영문)')}
      ${area('body_ko', '본문 (국문)')}${area('body_en', '본문 (영문)')}
    </div>
    <div style="font-size:10.5px;color:var(--i4);margin-top:5px">쓸 수 있는 칸: ${P.vars().map(x => `<code>${escapeHtml(x)}</code>`).join(' ')}</div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn bp" style="font-size:11px" onclick="tplLibSave()">${it.id ? '저장' : '추가'}</button>
      <button class="btn" style="font-size:11px" onclick="tplLibEdit(null)">취소</button></div>
  </div>`;
}
export function tplLibEdit(id){ if(!mg) return; mg.edit = id; renderMgr(); document.getElementById('tl-name')?.focus(); }
export async function tplLibSave(){
  if(!mg) return;
  const g = (f) => (document.getElementById(`tl-${f}`)?.value || '');
  const rec = { name: g('name').trim(), scope: g('scope') || mg.ev, subject_ko: g('subject_ko').trim(), body_ko: g('body_ko').replace(/\s+$/, ''),
    subject_en: g('subject_en').trim(), body_en: g('body_en').replace(/\s+$/, '') };
  if(!rec.name){ alert('양식 이름을 적어 주세요.'); return; }
  const id = mg.edit;
  const ok = await pushLibrary(list => {
    const meta = { part: mg.part, updated_at: nowStamp(), updated_by: currentUser?.name || currentUser?.email || '' };
    if(id === 'new') list.push({ id: newId('T'), ...rec, ...meta });
    else { const i = list.findIndex(x => x.id === id); if(i < 0) return false; list[i] = { ...list[i], ...rec, ...meta }; }
  }, `${id === 'new' ? '추가' : '고침'} «${rec.name}»`);
  if(!ok) return;
  mg.edit = null;
  refreshAll();
}
export async function tplLibCopy(id){
  const it = libItem(id);
  if(!it) return;
  const ok = await pushLibrary(list => { list.push({ ...clone(it), id: newId('T'), name: `${it.name} 사본`, scope: mg.ev, updated_at: nowStamp() }); }, `복제 «${it.name}»`);
  if(ok) refreshAll();
}
export async function tplLibDelete(id){
  const it = libItem(id);
  if(!it || !confirm(`양식 «${it.name}»을 지울까요?${it.scope === 'all' ? '\n\n모든 행사 공통 양식이라 다른 행사에서도 사라져요.' : ''}`)) return;
  const ok = await pushLibrary(list => { const i = list.findIndex(x => x.id === id); if(i < 0) return false; list.splice(i, 1); }, `지움 «${it.name}»`);
  if(ok) refreshAll();
}

/* ══ 지난 행사에서 가져오기 ══ */
function sourceSummary(part, src){
  const P = PART[part];
  const c = P.cfg(src);
  const over = Object.values(c[P.overKey] || {}).filter(o => TEXT_FIELDS.some(f => o[f] !== undefined)).length;
  const custom = (c[P.customKey] || []).length;
  const vars = Object.values(c[P.varKey] || {}).reduce((n, l) => n + l.length, 0);
  const lib = MAIL_LIBRARY.filter(it => it.part === part && it.scope === src).length;
  return { over, custom, vars, lib, any: over + custom + vars + lib };
}
function importHtml(){
  const srcs = EVENT_LIST.filter(e => e.key !== mg.ev).map(e => ({ e, s: sourceSummary(mg.part, e.key) })).filter(x => x.s.any);
  const sel = srcs.find(x => x.e.key === mg.src);
  const box = (k, l, n) => `<label style="display:flex;gap:6px;align-items:center;font-size:12px;opacity:${n ? 1 : .45}">
    <input type="checkbox" class="ti-opt" value="${k}" ${n ? 'checked' : 'disabled'}> ${l} <span style="color:var(--i4)">${n}개</span></label>`;
  return `<div style="font-size:11px;color:var(--i4);line-height:1.6;margin-bottom:8px">
      다른 행사에서 다듬어 둔 문구를 이번 행사로 복사해요. 같은 단계의 문구는 가져온 것으로 바뀌고, 같은 이름의 더한 단계·변형은 건너뜁니다.
      <b>마감일·대상 제한 날짜와 기본 첨부는 행사마다 달라 가져오지 않아요.</b></div>
    ${srcs.length ? `<div class="mlbl">어느 행사에서</div>
      <select class="fi" style="width:100%;margin-bottom:10px" onchange="tplImportSrc(this.value)">
        <option value="">— 고르세요 —</option>
        ${srcs.map(x => `<option value="${escAttr(x.e.key)}"${x.e.key === mg.src ? ' selected' : ''}>${escapeHtml(x.e.short || x.e.name || x.e.key)}${x.e.date ? ` (${escapeHtml(x.e.date)})` : ''} — 양식 ${x.s.any}개</option>`).join('')}
      </select>
      ${sel ? `<div style="display:flex;flex-direction:column;gap:5px;padding:9px 11px;border:1px solid var(--i6);border-radius:8px">
          ${box('over', '단계 문구 (고친 것)', sel.s.over)}
          ${box('custom', '더한 단계', sel.s.custom)}
          ${box('vars', '양식 변형', sel.s.vars)}
          ${box('lib', '«이 행사만» 보관함 양식', sel.s.lib)}
        </div>
        <button class="btn bp" style="font-size:11px;margin-top:10px" onclick="tplImportRun()">이번 행사로 가져오기</button>` : ''}`
    : `<div style="font-size:11.5px;color:var(--i4)">가져올 양식이 있는 다른 행사가 없어요. «모든 행사 공통» 보관함 양식은 따로 가져오지 않아도 보입니다.</div>`}`;
}
export function tplImportSrc(v){ if(!mg) return; mg.src = v; renderMgr(); }
export async function tplImportRun(){
  if(!mg || !mg.src) return;
  const part = mg.part, P = PART[part], src = mg.src, dst = mg.ev;
  if(P.locked(dst)){ alert('진행 완료된 행사예요 — 열람만 됩니다.'); return; }
  const opts = new Set([...document.querySelectorAll('.ti-opt:checked')].map(el => el.value));
  if(!opts.size) return;
  if(!confirm(`«${evName(src)}»의 양식을 «${evName(dst)}»로 가져올까요?\n같은 단계의 문구는 가져온 것으로 바뀝니다.`)) return;
  const s = P.cfg(src), cfg = clone(P.cfg(dst));
  const n = { over: 0, custom: 0, vars: 0, lib: 0 };
  /* 단계 문구 — 글만 옮긴다(끄기·마감은 이 행사 것 그대로) */
  if(opts.has('over')){
    const over = cfg[P.overKey] = cfg[P.overKey] || {};
    Object.entries(s[P.overKey] || {}).forEach(([k, o]) => {
      const t = {}; TEXT_FIELDS.forEach(f => { if(o[f] !== undefined) t[f] = o[f]; });
      if(!Object.keys(t).length) return;
      over[k] = { ...(over[k] || {}), ...t }; n.over++;
    });
  }
  /* 더한 단계 — 같은 이름이 있으면 그걸 쓰고, 없으면 새 key로. 놓을 자리(after)도 새 key로 옮긴다 */
  const keyMap = {};
  if(opts.has('custom') || opts.has('vars')){
    const mine = cfg[P.customKey] = cfg[P.customKey] || [];
    (s[P.customKey] || []).forEach(c => {
      const same = mine.find(m => m.label === c.label);
      if(same){ keyMap[c.key] = same.key; return; }
      if(!opts.has('custom')) return;
      const nk = `c-${Date.now().toString(36)}${n.custom}`;
      keyMap[c.key] = nk;
      const copy = { ...clone(c), key: nk };
      delete copy.due_date; delete copy.since; delete copy.due; delete copy.off;
      mine.push(copy); n.custom++;
    });
    mine.forEach(c => { if(c.after && keyMap[c.after]) c.after = keyMap[c.after]; });
    if(!mine.length) delete cfg[P.customKey];
  }
  /* 변형 — 같은 단계에 같은 이름이 있으면 건너뛴다 */
  if(opts.has('vars')){
    const all = cfg[P.varKey] = cfg[P.varKey] || {};
    Object.entries(s[P.varKey] || {}).forEach(([k, list]) => {
      const key = keyMap[k] || k;
      if(String(k).startsWith('c-') && !keyMap[k]) return;   // 그 단계를 안 가져왔다
      const mine = all[key] = all[key] || [];
      list.forEach(v => { if(mine.some(m => m.label === v.label)) return; mine.push({ ...clone(v), id: newId('V') }); n.vars++; });
      if(!mine.length) delete all[key];
    });
    if(!Object.keys(all).length) delete cfg[P.varKey];
  }
  if((n.over || n.custom || n.vars) && !await P.save(dst, cfg)) return;
  if(opts.has('lib')){
    const items = MAIL_LIBRARY.filter(it => it.part === part && it.scope === src);
    const mineNames = new Set(libItems(part, dst).map(it => it.name));
    const add = items.filter(it => !mineNames.has(it.name));
    if(add.length && await pushLibrary(list => { add.forEach(it => list.push({ ...clone(it), id: newId('T'), scope: dst, updated_at: nowStamp() })); }, `«${evName(src)}»에서 ${add.length}개 가져옴`)) n.lib = add.length;
  }
  trackAction('edit', `${P.name} 메일 양식`, dst, `«${evName(src)}»에서 가져옴 — 단계 문구 ${n.over} · 더한 단계 ${n.custom} · 변형 ${n.vars} · 보관함 ${n.lib}`);
  alert(`가져왔어요 — 단계 문구 ${n.over} · 더한 단계 ${n.custom} · 변형 ${n.vars} · 보관함 ${n.lib}\n(이미 같은 이름이 있던 것은 건너뛰었어요)`);
  mg.src = '';
  refreshAll();
}

Object.assign(window, { tplVarEdit, tplVarCancel, tplVarSave, tplVarDelete, openMailTemplates, closeMailTemplates, tplTab,
  tplLibEdit, tplLibSave, tplLibCopy, tplLibDelete, tplImportSrc, tplImportRun });
