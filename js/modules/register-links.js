/* ══════════════════════════════════════════════════════════════
   register-links.js — 바깥 등록 링크 창 (행사 화면 «🔗 등록 링크»)

   링크 하나 = 이 행사 + 참가 유형 하나. 셀러용·바이어용을 따로 만들어 보낸다.
   받은 신청은 확정 전(타겟)으로 들어온다 — 행사 화면 «타겟»·파트너링 «확정 대기»에서
   보고 «참가 확정». 같은 이메일이 이미 DB에 있으면 그 사람에 붙고 빈 칸만 채운다.
   서버는 routes/register.js.
══════════════════════════════════════════════════════════════ */
import { PART_TYPES } from '../state.js';
import { loadRegisterLinks, createRegisterLink, setRegisterLink, shareUrl } from '../api.js';
import { escapeHtml, escAttr } from '../utils.js';
import { trackAction } from './audit-tab.js';

let openEv = '';
let links = [];

export async function openRegisterLinks(evKey){
  openEv = evKey;
  let el = document.getElementById('reg-links');
  if(!el){
    el = document.createElement('div');
    el.id = 'reg-links';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1100;display:flex;align-items:center;justify-content:center;padding:12px';
    el.addEventListener('click', (e) => { if(e.target === el) el.remove(); });
    document.body.appendChild(el);
  }
  el.innerHTML = `<div style="background:var(--W);border-radius:12px;width:min(620px,100%);max-height:94vh;overflow:auto">
    <div style="padding:12px 16px;border-bottom:1px solid var(--i6);display:flex;align-items:center;gap:8px">
      <div style="font-size:14px;font-weight:700">🔗 등록 링크</div>
      <button class="drcls" style="margin-left:auto" onclick="document.getElementById('reg-links').remove()">✕</button></div>
    <div id="reg-links-bd" style="padding:14px 16px 18px;font-size:12px;color:var(--i4)">불러오는 중…</div></div>`;
  const r = await loadRegisterLinks(evKey);
  const bd = document.getElementById('reg-links-bd');
  if(!r.ok){ if(bd) bd.innerHTML = `<span style="color:var(--re)">${escapeHtml(r.error || '불러오지 못했어요')}</span>`; return; }
  links = r.links || [];
  render();
}

function linkRow(l){
  const url = l.path ? shareUrl(l.path) : '';
  return `<div style="border:1px solid var(--i6);border-radius:9px;padding:10px 12px;margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span class="pill p-blue" style="font-size:10px">${escapeHtml(l.role)}</span>
      <div style="font-size:12.5px;font-weight:700;color:var(--i1)">${escapeHtml(l.title || '(제목 없음)')}</div>
      <span class="pill ${l.enabled ? 'p-green' : 'p-gray'}" style="font-size:10px">${l.enabled ? '받는 중' : '닫힘'}</span>
      <button class="btn" style="margin-left:auto;font-size:11px" onclick="toggleRegisterLink('${escAttr(l.token)}',${!l.enabled})">${l.enabled ? '닫기' : '다시 열기'}</button>
    </div>
    ${l.enabled && url ? `<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
      <input class="fi" readonly value="${escapeHtml(url)}" style="flex:1;min-width:0;font-size:11.5px" onclick="this.select()">
      <button class="btn" style="font-size:11px" onclick="copyRegisterLink('${escAttr(url)}',this)">복사</button>
      <a class="btn" style="font-size:11px" href="${escapeHtml(url)}" target="_blank" rel="noopener">열기</a></div>` : ''}
    <div style="font-size:11px;color:var(--i4)">신청 ${l.submits}건${l.last_at ? ` · 마지막 ${escapeHtml(l.last_at)}` : ''} · 만든 날 ${escapeHtml(l.created_at)}${l.created_by ? ` · ${escapeHtml(l.created_by)}` : ''}</div>
  </div>`;
}

function render(){
  const bd = document.getElementById('reg-links-bd');
  if(!bd) return;
  bd.style.color = '';
  const opts = PART_TYPES.map(t => `<option value="${escapeHtml(t.key)}">${escapeHtml(t.label || t.key)}</option>`).join('');
  bd.innerHTML = `<div style="font-size:11.5px;color:var(--i4);line-height:1.55;margin-bottom:12px">
      링크를 받은 사람이 이름·소속·이메일 등을 직접 적어 신청해요. 신청은 이 행사에 <b>확정 전(타겟)</b>으로 들어오니,
      «타겟»에서 보고 «참가 확정»을 눌러 주세요. 같은 이메일이 이미 있으면 새로 만들지 않고 그 사람에 붙여요.</div>
    ${links.length ? links.map(linkRow).join('') : '<div style="font-size:12px;color:var(--i4);margin-bottom:12px">아직 만든 링크가 없어요.</div>'}
    <div style="border-top:1px solid var(--i6);padding-top:12px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <select id="reg-new-role" class="fi" style="font-size:12px;width:auto">${opts}</select>
      <input id="reg-new-title" class="fi" placeholder="신청서 제목 (예: 바이어 사전 신청)" style="flex:1;min-width:160px;font-size:12px">
      <button class="btn bp" style="font-size:11px" onclick="makeRegisterLink()">새 링크 만들기</button>
    </div>`;
}

export async function makeRegisterLink(){
  const role = document.getElementById('reg-new-role')?.value || '';
  const title = document.getElementById('reg-new-title')?.value.trim() || '';
  const r = await createRegisterLink(openEv, { role, title });
  if(!r.ok){ alert(r.error || '만들지 못했어요'); return; }
  links.push(r.link);
  render();
  trackAction('create', '등록 링크', openEv, `${role}${title ? ` · ${title}` : ''} 링크 만듦`);
}
export async function toggleRegisterLink(token, on){
  const r = await setRegisterLink(token, { enabled: on });
  if(!r.ok){ alert(r.error || '바꾸지 못했어요'); return; }
  links = links.map(l => l.token === token ? r.link : l);
  render();
  trackAction('edit', '등록 링크', openEv, `${r.link.role} 링크 ${on ? '다시 엶' : '닫음'}`);
}
export async function copyRegisterLink(url, btn){
  try { await navigator.clipboard.writeText(url); if(btn){ btn.textContent = '복사됨'; setTimeout(() => { btn.textContent = '복사'; }, 1500); } }
  catch(e){ prompt('링크를 복사하세요', url); }
}

window.openRegisterLinks = openRegisterLinks;
window.makeRegisterLink = makeRegisterLink;
window.toggleRegisterLink = toggleRegisterLink;
window.copyRegisterLink = copyRegisterLink;
