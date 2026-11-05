/* ══════════════════════════════════════════════════════════════
   org-candidates.js — 기업 후보함

   모르는 곳이 보낸 홍보·제안 메일에서 기업 후보를 뽑아 보인다(서버 규칙, AI 없음).
   사람이 칸을 고쳐 «추가»를 누르면 기업DB(잠재고객사)와 연락처가 생긴다.
   행사 참가 기록은 만들지 않는다 — 우리가 모객할 대상이지 참가기업이 아니다.
══════════════════════════════════════════════════════════════ */
import { loadOrgCandidates, addOrgCandidate, ignoreUnassigned } from '../../api/mail-send.js';
import { escapeHtml, escAttr } from '../../utils.js';
import { trackAction } from '../../core/audit-log.js';

let ocEv = '', ocItems = [];

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

export async function orgCandidateCount(evKey){
  const r = await loadOrgCandidates(evKey);
  return r.ok ? (r.items || []).filter(x => !x.dup).length : 0;
}

export async function openOrgCandidates(evKey){
  ocEv = evKey;
  const el = overlay('org-candidates');
  el.innerHTML = box('<div style="padding:30px;text-align:center;font-size:12px;color:var(--i4)">불러오는 중…</div>');
  const r = await loadOrgCandidates(evKey);
  ocItems = r.ok ? (r.items || []) : [];
  renderOrgCandidates(r.ok ? '' : (r.error || '불러오지 못했어요'));
}

const field = (id, key, label, val, w) => `<label style="font-size:10.5px;color:var(--i4);display:flex;flex-direction:column;gap:2px;${w ? `width:${w}` : 'flex:1;min-width:130px'}">${label}
  <input class="fi" id="oc-${key}-${escAttr(id)}" value="${escAttr(val || '')}" style="font-size:12px"></label>`;

function renderOrgCandidates(err){
  const el = document.getElementById('org-candidates');
  if(!el) return;
  el.innerHTML = box(`
    <div style="padding:12px 16px;border-bottom:1px solid var(--i6);display:flex;gap:8px;align-items:center">
      <div style="font-size:14px;font-weight:700">기업 후보 ${ocItems.length || ''}</div>
      <span style="font-size:11px;color:var(--i4)">홍보·제안 메일에서 뽑았어요. 칸을 확인·수정하고 «추가»를 누르면 기업DB(잠재고객사)에 등록돼요. 행사 참가 기록은 만들지 않아요.</span>
      <button class="drcls" style="margin-left:auto" onclick="document.getElementById('org-candidates').remove()">✕</button>
    </div>
    <div style="overflow:auto;padding:10px 16px 16px">
      ${err ? `<div style="color:var(--re);font-size:12px">${escapeHtml(err)}</div>` : ''}
      ${ocItems.length ? ocItems.map(u => { const c = u.cand || {}, id = u.id; return `<div style="border:1px solid var(--i6);border-radius:8px;padding:9px 11px;margin-bottom:8px">
        <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
          <span style="font-size:10.5px;color:var(--i4)">${escapeHtml(u.ts || '')}</span>
          <b style="font-size:12px">${escapeHtml(u.subject || '(제목 없음)')}</b>
          <span style="font-size:11px;color:var(--i4)">${escapeHtml(c.email || '')}</span>
        </div>
        ${u.dup ? `<div style="font-size:11.5px;color:var(--am);margin-top:4px">이미 있어요 — ${escapeHtml(u.dup.by)}이 같은 ${escapeHtml(u.dup.label || '')}. 추가하면 새로 만들지 않고 이 기업에 담당자만 붙여요.</div>` : ''}
        ${u.has_body ? '' : '<div style="font-size:11px;color:var(--i4);margin-top:4px">본문을 저장하지 않은 메일이라 서명을 못 읽었어요 — 직접 적어 주세요.</div>'}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
          ${field(id, 'org', '기업명', c.org)}${field(id, 'name', '담당자', c.name, '110px')}${field(id, 'title', '직함', c.title, '90px')}
          ${field(id, 'email', '이메일', c.email)}${field(id, 'phone', '전화', c.phone, '140px')}
          ${field(id, 'website', '홈페이지', c.website)}${field(id, 'sector', '대분류(섹터)', '', '150px')}
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-top:7px">
          <button class="btn bp" style="font-size:10.5px" onclick="addOrgCand('${escAttr(id)}')">추가</button>
          <button class="btn" style="font-size:10.5px" onclick="openMailOriginal('un','${escAttr(id)}')">원문 보기</button>
          <span style="flex:1"></span>
          <button class="btn" style="font-size:10.5px" onclick="skipOrgCand('${escAttr(id)}',false)">무시</button>
          ${c.free ? '' : `<button class="btn" style="font-size:10.5px;color:var(--re)" onclick="skipOrgCand('${escAttr(id)}',true)">이 도메인 늘 무시</button>`}
        </div></div>`; }).join('')
      : (err ? '' : '<div style="font-size:12px;color:var(--i4);padding:10px 0">기업 후보가 없어요. «메일함에서 주고받은 기록 가져오기»를 누르면 새 홍보메일이 들어와요.</div>')}
    </div>`);
}

export async function addOrgCand(id){
  const g = (k) => document.getElementById(`oc-${k}-${id}`)?.value || '';
  const body = { org: g('org'), name: g('name'), title: g('title'), email: g('email'), phone: g('phone'), website: g('website'), sector: g('sector') };
  if(!body.org.trim()){ alert('기업명을 적어 주세요.'); return; }
  const r = await addOrgCandidate(id, body);
  if(!r.ok){ alert(r.error || '추가하지 못했어요'); return; }
  trackAction('add', '기업 후보 추가', ocEv, `${body.org}${r.orgCreated ? '' : ' (기존 기업에 담당자 추가)'}`);
  ocItems = ocItems.filter(x => x.id !== id);
  renderOrgCandidates();
  window.renderEvInbox?.();
}

export async function skipOrgCand(id, domain){
  const u = ocItems.find(x => x.id === id);
  const dom = String(u && u.cand && u.cand.email || '').split('@')[1] || '';
  if(domain && !confirm(`@${dom} 에서 오는 메일을 앞으로 이 행사에서 모두 무시할까요?`)) return;
  const r = await ignoreUnassigned(id, domain);
  if(!r.ok){ alert(r.error || '처리하지 못했어요'); return; }
  ocItems = ocItems.filter(x => domain ? String(x.cand && x.cand.email || '').split('@')[1] !== dom : x.id !== id);
  renderOrgCandidates();
}

window.openOrgCandidates = openOrgCandidates;
window.addOrgCand = addOrgCand;
window.skipOrgCand = skipOrgCand;
