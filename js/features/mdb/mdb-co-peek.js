/* ══════════════════════════════════════════════════════════════
   mdb-co-peek.js — Master DB에서 기업 정보 바로 보기

   Master DB 줄의 기업명을 누르면 Master DB를 떠나지 않고 그 기업의 정보를 띄운다.
   기업DB 화면으로 옮겨 가면 거르던 목록·선택이 끊기기 때문이다.
   고치려면 «기업DB에서 열기»로 간다 — 여기서는 읽기만 한다.
═══════════════════════════════════════════════════════════════ */

import { CO_DB, CONTACT_ROUNDS, ROUND_MEMBERS, getContactById, hasLeft } from '../../state.js';
import { escapeHtml, escAttr, personName } from '../../utils.js';
import { coList } from '../../domain/rounds.js';
import { parseSectors } from '../../domain/sectors.js';

/* 연락처가 속한 기업 — 기업DB가 연락처를 org_id(없으면 이름)로 묶어 둔 것을 따른다 */
export function coOfContact(cid){
  return (CO_DB.length ? CO_DB : coList()).find(co => (co.contacts || []).some(p => +p.id === +cid)) || null;
}

const row = (label, v) => v ? `<div style="display:flex;gap:10px;font-size:var(--fs-12);padding:3px 0">
  <div style="width:72px;flex:none;color:var(--i4)">${label}</div><div style="flex:1;min-width:0;word-break:break-all">${v}</div></div>` : '';

export function openCoPeek(cid){
  const co = coOfContact(cid);
  if(!co){
    const c = getContactById(cid);
    alert(`«${(c && (c.orgKo || c.orgEn)) || '소속'}»은(는) 기업DB에 연결된 기업이 없어요.\n연락처 상세 «편집»에서 기업을 연결해 주세요.`);
    return;
  }
  const o = co.org || {};
  const ppl = (co.contacts || []).map(p => getContactById(p.id) || p);
  const working = ppl.filter(p => !hasLeft(p));
  const left = ppl.length - working.length;
  const rounds = ROUND_MEMBERS.filter(m => m.org_id === co.key)
    .map(m => ({ m, r: CONTACT_ROUNDS.find(r => r.id === m.round_id) })).filter(x => x.r);
  const web = co.website || o.website || '';
  const sectors = o.sectors ? parseSectors(o.sectors) : (co.sector && co.sector !== '미분류' ? [co.sector] : []);

  let ov = document.getElementById('co-peek');
  if(!ov){
    ov = document.createElement('div');
    ov.id = 'co-peek';
    ov.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto';
    ov.addEventListener('mousedown', e => { if(e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
  }
  ov.innerHTML = `<div style="background:var(--W);border-radius:var(--rl);width:100%;max-width:520px;padding:18px 20px;box-shadow:var(--shl)">
    <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px">
      <div style="flex:1;min-width:0">
        <div style="font-size:var(--fs-15);font-weight:700">${escapeHtml(co.nameKo || co.nameEn || '(이름 없음)')}</div>
        ${co.nameKo && co.nameEn ? `<div style="font-size:var(--fs-12);color:var(--i4)">${escapeHtml(co.nameEn)}</div>` : ''}
      </div>
      ${co.kind ? `<span class="pill p-gray">${escapeHtml(co.kind)}</span>` : ''}
      <button class="btn bs" onclick="document.getElementById('co-peek').remove()">닫기</button>
    </div>
    ${row('분야', sectors.map(s => `<span class="pill p-teal" style="margin:0 4px 2px 0">${escapeHtml(s)}</span>`).join(''))}
    ${row('국가', escapeHtml(co.country || co.hq || ''))}
    ${row('웹사이트', web ? `<a href="${escAttr(/^https?:/i.test(web) ? web : 'https://' + web)}" target="_blank" rel="noopener" style="color:var(--a)">${escapeHtml(web)}</a>` : '')}
    ${row('대표 전화', escapeHtml(co.phone || ''))}
    ${row('대표 메일', escapeHtml(co.email || ''))}
    ${row('주소', escapeHtml(co.address || ''))}
    ${row('제품', escapeHtml(co.products || ''))}
    ${row('소개', escapeHtml(co.intro || ''))}
    ${row('메모', escapeHtml(co.notes || ''))}
    ${row('참여 행사', (co.events || []).map(e => `<span class="pill p-blue" style="margin:0 4px 2px 0">${escapeHtml(e.short || e.name || e.key)}${(e.roles || []).length ? ' · ' + escapeHtml(e.roles.join('·')) : ''}</span>`).join(''))}
    ${row('컨택', rounds.map(({ m, r }) => `<span class="pill ${m.closed_at ? 'p-gray' : 'p-purple'}" style="margin:0 4px 2px 0">${escapeHtml(r.name)}${m.closed_at ? ' (종료)' : ''}</span>`).join(''))}
    <div style="font-size:var(--fs-12);font-weight:600;margin:12px 0 4px">담당자 ${working.length}명${left ? ` <span style="color:var(--i4);font-weight:400">· 퇴사 ${left}명</span>` : ''}</div>
    <div style="max-height:220px;overflow:auto;border:1px solid var(--i7);border-radius:var(--rs)">
      ${working.map(p => `<div onclick="document.getElementById('co-peek').remove();openContactDr(${+p.id})"
          style="display:flex;gap:8px;align-items:center;padding:5px 8px;border-bottom:1px solid var(--i8);cursor:pointer;font-size:var(--fs-12)">
        <span style="font-weight:600">${escapeHtml(personName(p))}</span>
        <span style="color:var(--i4);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.titleKo || p.titleEn || p.title || '')}</span>
        <span style="color:var(--i4)">${escapeHtml(p.email1 || p.email || '')}</span></div>`).join('')
        || '<div style="padding:8px;font-size:var(--fs-12);color:var(--i4)">재직 중인 담당자가 없어요</div>'}
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px">
      ${String(co.key).startsWith('name:') ? '' : `<button class="btn bp" onclick="document.getElementById('co-peek').remove();openContactCo('${escAttr(co.key)}')">기업DB에서 열기 · 고치기</button>`}
    </div>
  </div>`;
}

window.openCoPeek = openCoPeek;
