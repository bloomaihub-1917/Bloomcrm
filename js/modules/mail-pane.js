/* ══════════════════════════════════════════════════════════════
   mail-pane.js — 받은 메일을 보면서 그 내용을 탭에 넣는다

   메일을 한 창에, CRM을 다른 창에 띄워 옮겨 적던 일을 한 화면에서 끝내려고 둔다.
   연사(sp-dr)·참가사(exh-dr) 드로어가 같이 쓴다.

   - 데스크톱 «▤ 메일함 나란히»: 드로어를 두 배로 넓혀 왼쪽에 메일함, 오른쪽에 평소 탭.
     오른쪽에서 칸을 한 번 누르면 «넣을 칸»이 되고, 왼쪽에서 글을 끌어 고른 뒤
     «→ 넣기»를 누르면 그 칸에 들어간다. 칸의 원래 저장(onchange)이 그대로 돈다.
   - «📌 고정»(모바일·좁은 화면): 받은 메일 하나를 모든 탭 위에 띠로 붙인다.
     펼치면 문단마다 «넣기»가 있어 손가락으로 글을 고르지 않아도 된다.
   - 드로어는 각 파일이 그리고, 여기서는 머리 단추·왼쪽 칸·고정 띠만 덧붙인다(decorate).
══════════════════════════════════════════════════════════════ */
import { SPEAKER_LOGS, EXH_LOGS } from '../state.js';
import { escapeHtml, escAttr, splitQuotedMail } from '../utils.js';

const DR = { sp: 'sp-dr', ex: 'exh-dr' };
const BODY = { sp: 'sp-drbd', ex: 'exh-drbd' };
const KEY = 'crm.mailSplit';
let split = (() => { try { return localStorage.getItem(KEY) === '1'; } catch(e){ return false; } })();
let pinned = null;          // { t, owner, id, open }
let target = null;          // 넣을 칸 (input/textarea)
const wide = () => window.matchMedia('(min-width: 900px)').matches;
const logsOf = (t) => (t === 'sp' ? SPEAKER_LOGS : EXH_LOGS);
const ownerKey = (t) => (t === 'sp' ? 'speaker_id' : 'exhibitor_id');

/* 오른쪽에서 마지막으로 누른 칸을 기억한다 — 드로어 본문 안의 글 칸만 */
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if(!el || !(el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|email|tel|url|search|)$/i.test(el.type || '')))) return;
  if(!el.closest('#sp-drbd, #exh-drbd')) return;
  if(target && target !== el) target.style.outline = '';
  target = el;
  el.style.outline = '2px solid var(--a)';
  document.querySelectorAll('.mp-target').forEach(x => {
    const lbl = el.closest('div')?.querySelector('.mlbl')?.textContent || el.placeholder || '고른 칸';
    x.textContent = `넣을 칸: ${lbl.trim().slice(0, 30)}`;
  });
});

/* 칸에 글을 넣는다 — 커서 자리에(비었으면 통째로). 원래 저장이 돌게 change를 일으킨다 */
function insertText(text){
  const t = String(text || '').trim();
  if(!t) return false;
  if(!target || !document.body.contains(target)){ alert('먼저 오른쪽(탭)에서 넣을 칸을 한 번 눌러 주세요.'); return false; }
  const el = target;
  const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
  const glue = el.tagName === 'TEXTAREA' && el.value && s === el.value.length ? '\n' : '';
  el.value = el.value.slice(0, s) + glue + t + el.value.slice(e);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.focus();
  return true;
}
export function paneInsertSelection(){
  const sel = String(window.getSelection ? window.getSelection() : '').trim();
  if(!sel){ alert('왼쪽 메일에서 넣을 글을 끌어 골라 주세요.'); return; }
  insertText(sel);
}
export function paneInsertPara(t, id, i){
  const l = logsOf(t).find(x => x.id === id);
  if(!l) return;
  insertText(paras(l)[i] || '');
}

/* 받은 메일 본문 — 이전 메일(인용)은 빼고 문단으로 */
function paras(l){
  const m = splitQuotedMail(l.body);
  return String(m.head || '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
}

/* ── 고정 ── */
export function pinMail(t, id){
  const l = logsOf(t).find(x => x.id === id);
  if(!l) return;
  pinned = { t, owner: l[ownerKey(t)], id, open: true };
  decorate(t);
}
export function unpinMail(){ const t = pinned && pinned.t; pinned = null; if(t) decorate(t); }
export function togglePin(){ if(pinned){ pinned.open = !pinned.open; decorate(pinned.t); } }

function pinHtml(t, owner){
  if(!pinned || pinned.t !== t || pinned.owner !== owner) return '';
  const l = logsOf(t).find(x => x.id === pinned.id);
  if(!l) return '';
  const ps = paras(l);
  return `<div style="border-bottom:1px solid var(--i6);background:var(--ad);padding:7px 14px;flex-shrink:0;${pinned.open ? 'max-height:50dvh;overflow:auto' : ''}">
    <div style="display:flex;gap:6px;align-items:center">
      <span style="font-size:11.5px;font-weight:700;cursor:pointer;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick="togglePinMail()">
        📌 ${escapeHtml(l.subject || '(제목 없음)')} <span style="font-weight:400;color:var(--i4)">${escapeHtml(String(l.ts || '').slice(5, 16))} ${pinned.open ? '▴' : '▾'}</span></span>
      <span class="mp-target" style="font-size:10px;color:var(--a)">${target ? '' : '탭에서 넣을 칸을 누르세요'}</span>
      <button class="btn" style="font-size:10px" onclick="setMailDone('${t}','${escAttr(l.id)}',true)">처리 완료</button>
      <button class="btn" style="font-size:10px" onclick="unpinMail()">해제</button>
    </div>
    ${pinned.open ? ps.map((p, i) => `<div style="display:flex;gap:6px;align-items:flex-start;margin-top:6px">
      <div style="flex:1;font-size:11.5px;white-space:pre-wrap;line-height:1.5;color:var(--i2)">${escapeHtml(p)}</div>
      <button class="btn bp" style="font-size:10px;flex:0 0 auto" onclick="paneInsertPara('${t}','${escAttr(l.id)}',${i})">넣기</button></div>`).join('')
      || '<div style="font-size:11px;color:var(--i4);margin-top:4px">본문이 없어요</div>' : ''}
  </div>`;
}

/* ── 나란히 보기 ── */
export function toggleSplit(t){
  split = !split;
  try { localStorage.setItem(KEY, split ? '1' : '0'); } catch(e){}
  decorate(t);
}

/* 드로어를 그린 뒤 부른다 — 머리 단추, 왼쪽 메일함, 고정 띠 */
export function decorate(t){
  const dr = document.getElementById(DR[t]);
  if(!dr) return;
  const owner = t === 'sp' ? window.__spDrId?.() : window.__exhDrId?.();
  const on = split && wide() && !!owner;
  dr.classList.toggle('split', on);

  // 머리 단추
  const head = dr.querySelector('.drh');
  if(head && wide() && !head.querySelector('.mp-split-btn')){
    const b = document.createElement('button');
    b.className = 'btn bs mp-split-btn';
    b.style.cssText = 'flex:0 0 auto;margin-right:6px';
    b.title = '왼쪽에 메일함을 띄워 놓고 오른쪽 탭에 받은 내용을 넣습니다';
    b.onclick = () => toggleSplit(t);
    const close = head.querySelector('.drcls');
    head.insertBefore(b, close || null);
  }
  const btn = head && head.querySelector('.mp-split-btn');
  if(btn) btn.textContent = on ? '▤ 나란히 끄기' : '▤ 메일함 나란히';

  // 왼쪽 칸
  let pane = dr.querySelector('.dr-mail');
  if(on){
    if(!pane){ pane = document.createElement('div'); pane.className = 'dr-mail'; dr.appendChild(pane); }
    const box = t === 'sp' ? window.__spBoxHtml?.(owner) : window.__exhBoxHtml?.(owner);
    pane.innerHTML = `<div style="position:sticky;top:0;background:var(--W);padding:10px 14px;border-bottom:1px solid var(--i6);z-index:1;display:flex;gap:8px;align-items:center">
        <b style="font-size:12px">메일함</b>
        <span class="mp-target" style="font-size:10.5px;color:var(--a)">${target ? '' : '오른쪽 탭에서 넣을 칸을 누르세요'}</span>
        <button class="btn bp bs" style="margin-left:auto" onmousedown="event.preventDefault()" onclick="paneInsertSelection()"
          title="왼쪽에서 끌어 고른 글을 오른쪽에서 고른 칸에 넣습니다">→ 고른 글 넣기</button></div>
      <div style="padding:10px 14px">${box || ''}</div>`;
  } else if(pane){ pane.remove(); }

  // 고정 띠 — 탭 줄 바로 아래
  let bar = dr.querySelector('.dr-pin');
  const html = pinHtml(t, owner);
  if(html){
    if(!bar){ bar = document.createElement('div'); bar.className = 'dr-pin'; dr.insertBefore(bar, document.getElementById(BODY[t])); }
    bar.innerHTML = html;
  } else if(bar){ bar.remove(); }
}

window.paneInsertSelection = paneInsertSelection;
window.paneInsertPara = paneInsertPara;
window.pinMail = pinMail;
window.unpinMail = unpinMail;
window.togglePinMail = togglePin;
window.mailPaneDecorate = decorate;
