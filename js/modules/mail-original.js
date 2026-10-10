/* ══════════════════════════════════════════════════════════════
   mail-original.js — 원문 보기 · 주인 없는 메일

   원문 보기: 기록에는 글자만 남는다(이미지 자리는 [🖼 이미지]로). 이미지·표를 봐야 할 때
   그때 메일함에서 원본을 가져와 보인다. 서버가 스크립트·폼·외부 불러오기를 걷어 내고,
   화면은 스크립트가 돌지 않는 iframe(sandbox + CSP)에 띄운다. 외부 이미지는 누를 때만.
   첨부는 열지 않는다 — 이름만 보이고, 원본 첨부는 메일플러그 웹메일(백신 검사)에서 연다.

   주인 없는 메일: 받은메일함에서 아는 사람과 주소가 안 맞은 메일. 스팸·대량 발송·
   자동 답장은 이미 서버에서 걸렀다. 사람이 보고 연사·참가사에 연결하거나 무시한다.
   연결할 때 «이 주소를 연락처로 추가»하면 다음부터는 자동으로 그 사람에게 붙는다.
══════════════════════════════════════════════════════════════ */
import { SPEAKERS, EXHIBITORS } from '../state.js';
import { mailOriginal, loadUnassigned, linkUnassigned, ignoreUnassigned, reloadSpeakerData } from '../api.js';
import { escapeHtml, escAttr } from '../utils.js';
import { trackAction } from './audit-tab.js';

function overlay(id){
  let el = document.getElementById(id);
  if(!el){
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1100;display:flex;align-items:center;justify-content:center;padding:12px';
    el.addEventListener('click', (e) => { if(e.target === el) el.remove(); });
    document.body.appendChild(el);
  }
  return el;
}
const box = (inner) => `<div style="background:var(--W);border-radius:12px;width:min(920px,100%);max-height:94vh;display:flex;flex-direction:column;overflow:hidden">${inner}</div>`;

/* ── 원문 보기 ── */
export async function openMailOriginal(t, id, remote){
  const el = overlay('mail-original');
  el.innerHTML = box('<div style="padding:30px;text-align:center;font-size:12px;color:var(--i4)">메일함에서 원문을 가져오는 중…</div>');
  const r = await mailOriginal(t, id, remote);
  if(!document.getElementById('mail-original')) return;
  if(!r.ok){
    el.innerHTML = box(`<div style="padding:20px"><div style="color:var(--re);font-size:12.5px">${escapeHtml(r.error || '원문을 가져오지 못했어요')}</div>
      <button class="btn" style="margin-top:10px" onclick="document.getElementById('mail-original').remove()">닫기</button></div>`);
    return;
  }
  /* 원문은 스크립트가 아예 돌지 않는 칸에 — sandbox에 allow-scripts·allow-same-origin을 주지 않고,
     CSP로 외부 불러오기를 막는다(외부 이미지 보기를 눌렀을 때만 이미지 허용) */
  const csp = `default-src 'none'; img-src data:${remote ? ' https: http:' : ''}; style-src 'unsafe-inline'; font-src data:`;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
    <base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.55;margin:14px;color:#222;word-break:break-word}img{max-width:100%;height:auto}</style>
    </head><body>${r.html || ''}</body></html>`;
  el.innerHTML = box(`
    <div style="padding:12px 16px;border-bottom:1px solid var(--i6)">
      <div style="display:flex;gap:8px;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div style="font-size:13.5px;font-weight:700">${escapeHtml(r.subject || '(제목 없음)')}</div>
          <div style="font-size:11px;color:var(--i4);margin-top:2px">${escapeHtml(r.from || '')} · ${escapeHtml(r.date || '')}${r.to ? ` · 받는 사람 ${escapeHtml(r.to)}` : ''}</div>
        </div>
        <button class="drcls" onclick="document.getElementById('mail-original').remove()">✕</button>
      </div>
      ${r.spam ? '<div style="margin-top:6px;font-size:11.5px;color:var(--re);font-weight:700">⚠ 스팸 의심 메일 — 링크를 막아 두었어요</div>' : ''}
      ${(r.warnings || []).map(w => `<div style="margin-top:4px;font-size:11.5px;color:var(--re)">⚠ ${escapeHtml(w)}</div>`).join('')}
      ${r.blocked ? `<div style="margin-top:6px;font-size:11px;color:var(--i4)">외부 이미지를 막아 두었어요(열람 추적 방지)
        <button class="btn" style="font-size:10.5px;margin-left:6px" onclick="openMailOriginal('${t}','${escAttr(id)}',true)">외부 이미지 보기</button></div>` : ''}
      ${(r.attachments || []).length ? `<div style="margin-top:6px;font-size:11px;color:var(--i3)">첨부(여기서는 열지 않아요 — 메일플러그 웹메일에서 여세요):
        ${r.attachments.map(a => `<span class="pill p-gray" style="margin:2px 3px 0 0">📎 ${escapeHtml(a.filename)}</span>`).join('')}</div>` : ''}
    </div>
    <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"
      style="flex:1;min-height:55vh;border:0;width:100%;background:#fff" srcdoc="${escAttr(doc)}"></iframe>`);
}

/* ── 주인 없는 메일 ── */
let unEv = '', unItems = [];
export async function unassignedCount(evKey){
  const r = await loadUnassigned(evKey);
  return r.ok ? (r.items || []).length : 0;
}
export async function openUnassigned(evKey){
  unEv = evKey;
  const el = overlay('mail-unassigned');
  el.innerHTML = box('<div style="padding:30px;text-align:center;font-size:12px;color:var(--i4)">불러오는 중…</div>');
  const r = await loadUnassigned(evKey);
  unItems = r.ok ? (r.items || []) : [];
  renderUnassigned(r.ok ? '' : (r.error || '불러오지 못했어요'));
}
function renderUnassigned(err){
  const el = document.getElementById('mail-unassigned');
  if(!el) return;
  const sps = SPEAKERS.filter(x => x.event_id === unEv && x.status !== '취소');
  const exs = EXHIBITORS.filter(x => x.event_id === unEv);
  const opts = `<option value="">연사·참가사 고르기…</option>
    ${sps.length ? `<optgroup label="연사">${sps.map(x => `<option value="sp:${escAttr(x.id)}">${escapeHtml(x.name_snapshot || x.name_en || x.id)}</option>`).join('')}</optgroup>` : ''}
    ${exs.length ? `<optgroup label="참가사">${exs.map(x => `<option value="ex:${escAttr(x.id)}">${escapeHtml(x.company_name || x.id)}</option>`).join('')}</optgroup>` : ''}`;
  el.innerHTML = box(`
    <div style="padding:12px 16px;border-bottom:1px solid var(--i6);display:flex;gap:8px;align-items:center">
      <div style="font-size:14px;font-weight:700">주인 없는 메일 ${unItems.length || ''}</div>
      <span style="font-size:11px;color:var(--i4)">아는 사람과 주소가 안 맞은 받은 메일 — 스팸·광고·자동 답장은 이미 걸렀어요</span>
      <button class="drcls" style="margin-left:auto" onclick="document.getElementById('mail-unassigned').remove()">✕</button>
    </div>
    <div style="overflow:auto;padding:10px 16px 16px">
      ${err ? `<div style="color:var(--re);font-size:12px">${escapeHtml(err)}</div>` : ''}
      ${unItems.length ? unItems.map(u => `<div style="border:1px solid var(--i6);border-radius:8px;padding:9px 11px;margin-bottom:8px">
        <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
          <span style="font-size:10.5px;color:var(--i4)">${escapeHtml(u.ts || '')}</span>
          <b style="font-size:12px">${escapeHtml(u.from_name || '')}</b>
          <span style="font-size:11px;color:var(--i4)">${escapeHtml(u.from_addr || '')}</span>
        </div>
        <div style="font-size:12.5px;font-weight:600;margin-top:3px">${escapeHtml(u.subject || '(제목 없음)')}</div>
        ${u.fwd ? `<div style="font-size:11px;color:var(--i3);margin-top:3px;padding:4px 7px;background:var(--i8);border-radius:5px;line-height:1.5;overflow-wrap:anywhere">↪ ${escapeHtml(u.fwd.by)} 전달${u.fwd.from
          ? ` · 원래 <b>${escapeHtml(u.fwd.from)}</b>${u.fwd.to ? ` → ${escapeHtml(u.fwd.to)}` : ''}${u.fwd.sent ? ` · ${escapeHtml(u.fwd.sent)}` : ''}`
          : ' · 원래 보낸 사람을 못 읽었어요 — 본문을 보고 골라 주세요'}</div>` : ''}
        ${(u.warnings || []).map(w => `<div style="font-size:11px;color:var(--re);margin-top:2px">⚠ ${escapeHtml(w)}</div>`).join('')}
        <details style="margin-top:4px"><summary style="cursor:pointer;font-size:11px;color:var(--i4)">본문 보기</summary>
          <div style="font-size:11.5px;white-space:pre-wrap;line-height:1.5;margin-top:4px;max-height:200px;overflow:auto;color:var(--i2)">${escapeHtml(String(u.body || '').slice(0, 3000))}</div></details>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:7px">
          ${(u.suggestions || []).map(s => `<button class="btn bp" style="font-size:10.5px" onclick="linkUn('${escAttr(u.id)}','${s.t}','${escAttr(s.id)}')"
            title="${escAttr(s.why)}">→ ${escapeHtml(s.name || '')}에 연결 <span style="font-weight:400">(${escapeHtml(s.why)})</span></button>`).join('')}
          <select class="fi" id="un-pick-${escAttr(u.id)}" style="font-size:11.5px;width:auto;max-width:240px">${opts}</select>
          <button class="btn" style="font-size:10.5px" onclick="linkUnPicked('${escAttr(u.id)}')">연결</button>
          ${u.contact_addr ? `<label style="font-size:11px;display:flex;gap:4px;align-items:center"><input type="checkbox" id="un-add-${escAttr(u.id)}" checked>${
            u.fwd ? `${escapeHtml(u.contact_addr)}를 연락처로 추가` : '이 주소를 연락처로 추가'}</label>` : ''}
          <span style="flex:1"></span>
          <button class="btn" style="font-size:10.5px" onclick="openMailOriginal('un','${escAttr(u.id)}')">원문 보기</button>
          <button class="btn" style="font-size:10.5px" onclick="ignoreUn('${escAttr(u.id)}',false)">무시</button>
          ${u.fwd ? '' : `<button class="btn" style="font-size:10.5px;color:var(--re)" onclick="ignoreUn('${escAttr(u.id)}',true)">이 도메인 늘 무시</button>`}
        </div></div>`).join('')
      : (err ? '' : '<div style="font-size:12px;color:var(--i4);padding:10px 0">주인 없는 메일이 없어요.</div>')}
    </div>`);
}
export async function linkUn(id, t, ownerId){
  const addContact = !!document.getElementById(`un-add-${id}`)?.checked;
  const r = await linkUnassigned(id, { t, ownerId, addContact });
  if(!r.ok){ alert(r.error || '연결하지 못했어요'); return; }
  const u = unItems.find(x => x.id === id);
  trackAction('add', '주인 없는 메일 연결', unEv, `${u ? u.from_addr : ''} → ${t === 'sp' ? '연사' : '참가사'}${r.contactAdded ? ' (연락처 추가)' : ''}`);
  unItems = unItems.filter(x => x.id !== id);
  renderUnassigned();
  await reloadSpeakerData();
  window.renderSpeakerDr?.(); window.renderExhDr?.(); window.renderConf?.(); window.renderExh?.(); window.renderEvInbox?.();
}
export function linkUnPicked(id){
  const v = document.getElementById(`un-pick-${id}`)?.value || '';
  if(!v){ alert('연결할 연사·참가사를 골라주세요.'); return; }
  const [t, ownerId] = [v.slice(0, 2), v.slice(3)];
  linkUn(id, t, ownerId);
}
export async function ignoreUn(id, domain){
  const u = unItems.find(x => x.id === id);
  if(domain && !confirm(`@${String(u && u.from_addr || '').split('@')[1] || ''} 에서 오는 메일을 앞으로 이 행사에서 모두 무시할까요?`)) return;
  const r = await ignoreUnassigned(id, domain);
  if(!r.ok){ alert(r.error || '처리하지 못했어요'); return; }
  const d = String(u && u.from_addr || '').toLowerCase().split('@')[1];
  unItems = unItems.filter(x => domain ? String(x.from_addr || '').toLowerCase().split('@')[1] !== d : x.id !== id);
  renderUnassigned();
  window.renderConf?.(); window.renderExh?.(); window.renderEvInbox?.();
}

window.openMailOriginal = openMailOriginal;
window.openUnassigned = openUnassigned;
window.linkUn = linkUn;
window.linkUnPicked = linkUnPicked;
window.ignoreUn = ignoreUn;
