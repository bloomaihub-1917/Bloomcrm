/* ══════════════════════════════════════════════════════════════
   var-chips.js — 메일 칸 칩: 끌어다 놓거나 눌러서 제목·본문에 넣는다

   칸 목록은 mail-vars.js가 정본이다. 메일 양식을 고치는 곳마다 varChipsHtml(영역)을
   제목·본문 칸과 같은 묶음(부모 요소 또는 data-vscope) 안에 그려 두면 된다.

   두 가지 쓰임
     양식 칩  {호칭}처럼 칸 이름을 넣는다 — 보낼 때 받는 사람마다 채워진다
              (연락 단계·변형·양식 보관함·여러 명에게 메일·컨택 차수 양식)
     값 칩    실제 값을 넣는다 — 한 사람에게 바로 쓰는 메일은 칸을 채우지 않고 글 그대로 보낸다
              (연사·전시 드로어 메일, 영업 CRM 메일). registerVarResolver로 값 구하는 함수를 건다

   - 누르기: 마지막으로 커서가 있던 제목·본문 칸의 커서 자리에 넣는다(없으면 첫 본문 칸)
   - 끌기: 놓은 자리에 들어간다(브라우저가 넣고 input 이벤트를 낸다)
   - 넣으면 input 이벤트를 내 각 화면의 oninput(문구 담기·미리보기)이 그대로 돈다
   - 양식 칩은 글에 쓴 칸을 진하게 표시하고, 이 영역에 없는 칸({호칭님} 같은 오타)을 알린다
   - 값이 없는 칸은 칩을 흐리게 하고 미리 알린다 — 양식 칩은 행사 칸(opts.ev의 행사 정보),
     값 칩은 지금 고른 사람·기업의 값. 쓴 칸이 비어 있으면 어떻게 나가는지까지 적는다
══════════════════════════════════════════════════════════════ */
import { MAIL_VARS, unknownVars, eventVarValues } from './mail-vars.js';
import { escapeHtml, escAttr } from '../utils.js';
import { confCfg } from '../state.js';

const resolvers = {};
/* 값 칩이 쓸 함수 — fn(칸 이름) → 실제 값. 그 화면이 지금 고른 사람·언어로 구한다 */
export function registerVarResolver(name, fn){ resolvers[name] = fn; }

export function varChipsHtml(part, opts = {}){
  const defs = MAIL_VARS[part] || [];
  const groups = [];
  defs.forEach(d => { let g = groups.find(x => x.name === d.group); if(!g) groups.push(g = { name: d.group, items: [] }); g.items.push(d); });
  const val = !!opts.resolve;
  return `<div class="vchips" data-part="${escAttr(part)}"${val ? ` data-resolve="${escAttr(opts.resolve)}"` : ''}${opts.ev ? ` data-ev="${escAttr(opts.ev)}"` : ''}>
    <div class="vchips-hd">${val ? '값 넣기' : '칸 넣기'} <span>— 끌어다 놓거나 누르면 커서 자리에 ${val ? '실제 값이 ' : ''}들어가요${opts.note ? ` · ${escapeHtml(opts.note)}` : ''}</span></div>
    ${groups.map(g => `<div class="vchips-row"><span class="vchips-g">${escapeHtml(g.name)}</span>${g.items.map(d =>
      `<span class="vchip" draggable="true" data-k="${escAttr(d.key)}"${d.where ? ` data-where="${escAttr(d.where)}"` : ''} title="${escAttr(`{${d.key}} — ${d.desc}`)}">${escapeHtml(d.key)}</span>`).join('')}</div>`).join('')}
    <div class="vchips-info"></div>
    <div class="vchips-warn"></div>
  </div>`;
}

/* ── 동작 — 한 번만 건다 ── */
let lastField = null;
const isText = (el) => !!el && !el.disabled && !el.readOnly
  && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el.type || 'text') === 'text'));
const scopeOf = (vc) => vc.closest('[data-vscope]') || vc.parentElement;
const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
const fieldsOf = (scope) => [...scope.querySelectorAll('textarea, input')].filter(isText);

function valueOf(vc, key){
  const name = vc.dataset.resolve;
  if(!name) return `{${key}}`;
  try { return String(resolvers[name]?.(key) ?? ''); }
  catch(e){ console.warn('[CRM] 칸 값 구하기 실패:', key, e); return ''; }
}
function targetOf(vc){
  const scope = scopeOf(vc);
  if(lastField && lastField.isConnected && scope.contains(lastField) && visible(lastField)) return lastField;
  const f = fieldsOf(scope).filter(visible);
  return f.find(x => x.tagName === 'TEXTAREA') || f[0] || null;
}
function insert(el, text){
  el.focus();
  const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
  el.setRangeText(text, s, e, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function say(vc, html){ const w = vc.querySelector('.vchips-warn'); if(w) w.innerHTML = html; }

/* 값이 없는 칸 — 값 칩은 지금 값으로, 양식 칩은 행사 칸만(사람마다 다른 칸은 미리 알 수 없다) */
const whereOf = (chip) => chip.dataset.where || '';
function emptyChips(vc){
  const chips = [...vc.querySelectorAll('.vchip')];
  if(vc.dataset.resolve) return chips.filter(c => !valueOf(vc, c.dataset.k).trim());
  if(!vc.dataset.ev) return [];
  const ev = eventVarValues(vc.dataset.ev, false);
  /* 연사 가이드·제출 양식 링크도 행사마다 하나다 — 국문·영문 중 하나라도 있으면 채워진다 */
  if(vc.dataset.part === 'conf'){
    const d = confCfg(vc.dataset.ev).docs || {};
    ev.가이드 = d.guide_ko || d.guide_en || '';
    ev.양식 = d.form_ko || d.form_en || '';
  }
  return chips.filter(c => c.dataset.k in ev && !String(ev[c.dataset.k] || '').trim());
}
function info(vc, html){ const w = vc.querySelector('.vchips-info'); if(w) w.innerHTML = html; }

/* 쓴 칸 표시 · 값 없는 칸 · 모르는 칸 알림 */
function refresh(vc){
  const fields = fieldsOf(scopeOf(vc));
  const text = fields.map(f => f.value).join('\n');
  const empty = emptyChips(vc);
  vc.querySelectorAll('.vchip').forEach(c => {
    const e = empty.includes(c);
    c.classList.toggle('vc-empty', e);
    const base = c.title.replace(/\n· 값 없음[\s\S]*$/, '');
    c.title = e ? `${base}\n· 값 없음 — ${vc.dataset.resolve ? '눌러도 아무것도 안 들어가요' : '채우면 들어가요'}` : base;
  });
  /* 어디서 채우는지 같은 자리(행사 탭 «행사 개요» 등)끼리 묶어 한 줄로 */
  const by = {};
  empty.forEach(c => { const w = whereOf(c); (by[w] = by[w] || []).push(c.dataset.k); });
  info(vc, empty.length ? `${vc.dataset.resolve ? '이 받는 쪽에 값이 없는 칸' : '이 행사에 값이 없는 칸'}: ${Object.entries(by).map(([w, ks]) =>
    `${ks.map(k => `<b>${escapeHtml(k)}</b>`).join('·')}${w ? ` <span>(${escapeHtml(w)}에서 채워요)</span>` : ''}`).join(' · ')}` : '');
  if(vc.dataset.resolve){
    const raw = [...new Set(text.match(/\{[^{}\s]{1,12}\}/g) || [])];
    say(vc, raw.length ? `⚠ ${raw.map(escapeHtml).join(' ')} — 이 메일은 칸을 채우지 않고 글 그대로 보내요. 칩을 누르면 실제 값이 들어가요.` : '');
    return;
  }
  vc.querySelectorAll('.vchip').forEach(c => c.classList.toggle('on', text.includes(`{${c.dataset.k}}`)));
  const bad = unknownVars(text, vc.dataset.part);
  const usedEmpty = empty.filter(c => text.includes(`{${c.dataset.k}}`)).map(c => `{${c.dataset.k}}`);
  const how = vc.dataset.part === 'conf' ? '«- 주최: »처럼 그 칸만 있는 줄은 빠지고, 문장 안에서는 빈칸으로 나가요'
    : '빈 채로 나가요(«- 주최: »처럼)';
  say(vc, [
    usedEmpty.length ? `⚠ 쓴 칸 중 값이 없는 칸 ${usedEmpty.map(escapeHtml).join(' ')} — ${how}.` : '',
    bad.length ? `⚠ 모르는 칸 ${bad.map(escapeHtml).join(' ')} — 채워지지 않고 글자 그대로 나가요. 위 칩에서 골라 넣으세요.` : '',
  ].filter(Boolean).join('<br>'));
}
const refreshIn = (el) => {
  document.querySelectorAll('.vchips').forEach(vc => { if(scopeOf(vc).contains(el)) refresh(vc); });
};

if(!window.__varChipsBound){
  window.__varChipsBound = true;
  document.addEventListener('focusin', e => { if(isText(e.target)) lastField = e.target; });
  /* 칩을 눌러 본문 칸에서 포커스가 빠져도 칸은 커서 자리(selectionStart/End)를 기억한다 —
     mousedown을 막지 않는다(막으면 크롬에서 끌기가 시작되지 않는다) */
  document.addEventListener('click', e => {
    const chip = e.target.closest?.('.vchip');
    if(!chip) return;
    const vc = chip.closest('.vchips');
    const el = targetOf(vc);
    if(!el){ say(vc, '넣을 제목·본문 칸이 안 보여요 — 칸을 펼치거나 먼저 눌러 주세요.'); return; }
    const v = valueOf(vc, chip.dataset.k);
    if(!v){ say(vc, `«${escapeHtml(chip.dataset.k)}» 값이 비어 있어요 — ${escapeHtml(chip.title.split('\n')[0].replace(/^\{[^}]+\} — /, ''))}`); return; }
    insert(el, v);
  });
  document.addEventListener('dragstart', e => {
    const chip = e.target.closest?.('.vchip');
    if(!chip) return;
    e.dataTransfer.setData('text/plain', valueOf(chip.closest('.vchips'), chip.dataset.k));
    e.dataTransfer.effectAllowed = 'copy';
  });
  // 값 칩은 마우스를 올리면 들어갈 값을 보여 준다
  document.addEventListener('mouseover', e => {
    const chip = e.target.closest?.('.vchips[data-resolve] .vchip');
    if(!chip) return;
    const v = valueOf(chip.closest('.vchips'), chip.dataset.k);
    const desc = chip.title.split('\n')[0];
    chip.title = `${desc}\n→ ${v || '(비어 있음)'}`;
  });
  document.addEventListener('input', e => { if(isText(e.target)) refreshIn(e.target); });
  // 값 칩은 받는 사람·언어·단계를 바꾸면 값이 달라진다
  document.addEventListener('change', () => document.querySelectorAll('.vchips[data-resolve]').forEach(refresh));
  /* 화면이 칩을 새로 그리면(innerHTML) 그 자리에서 한 번 살핀다 — 이미 쓴 칸·오타를 처음부터 보이게 */
  let queued = false;
  new MutationObserver(() => {
    if(queued) return;
    queued = true;
    setTimeout(() => {   // rAF는 창이 뒤에 있으면 돌지 않는다
      queued = false;
      document.querySelectorAll('.vchips:not([data-seen])').forEach(vc => { vc.dataset.seen = '1'; refresh(vc); });
    });
  }).observe(document.body, { childList: true, subtree: true });
}

/* 화면이 칸 값을 코드로 바꾼 뒤(단계 고르기 등) 부른다 */
export function refreshVarChips(root = document){
  root.querySelectorAll('.vchips').forEach(refresh);
}
