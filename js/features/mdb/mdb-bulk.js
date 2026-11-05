/* ══════════════════════════════════════════════════════════════
   features/mdb/mdb-bulk.js — 마스터DB 선택 → 초청·일괄 고치기·지우기
   (modules/db-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { postToSheet } from '../../api.js';
import { CAT_KEYS, CL, ROLE_TO_CAT } from '../../constants.js';
import { changed, removed as removedMeta, trackAction } from '../../core/audit-log.js';
import { buildCoDB } from '../../domain/co-db.js';
import { ensureOrgsForNames, orgIdForName } from '../../domain/orgs.js';
import { CONTACT_ATTEMPTS, CO_DB, EVENT_LIST, SALES_TARGETS, EXHIBITORS, EXH_CONTACTS, SPEAKERS, SPEAKER_CONTACTS, TAGS, contacts, getContactById, getOrgById, getSpeakerById, mdbCat, mdbEvFilter, mdbSelected, mdbTypeFilter, participations, setMdbView, targets } from '../../state.js';
import { countryOptions, escAttr, escapeHtml, personName, td } from '../../utils.js';
import { mdbUi } from './mdb-ui.js';
import { MDB_CAT_VALUES, buildMDBEvList, clearMDBSelection, matchesQuery, matchesTagFilter, mdbFilterPairs, pickChanged, renderMDB, setContactTag } from '../../modules/db-tab.js';

/* ══════════════════════════════════════════
   마스터DB 선택 → 행사에 초청

   «이 사람을 이 행사에 부른다»가 한 건이다. 그래서 고른 사람을 기업으로 합치지
   않는다 — 한 회사에서 세 명을 부르면 초청도 세 건이다. 합쳐 버리면 누구를
   불렀는지가 사라지고, 나중에 두 명만 왔을 때 나머지 한 명을 짚을 수 없다.

   두 가지가 만들어진다.

     ① 참가 이력(participations) — 사람마다 한 줄. 이게 초청 그 자체다.
        마스터DB 행사별 보기, 기업DB 행사 이력, 전시 담당자 후보가 모두 여기를 본다.
     ② CRM 타겟(crm_targets) — 소속 기업이 그 행사에 아직 없을 때만 한 줄.
        CRM은 기업 단위로 진행 단계를 쫓는 화면이라(연락처 칸 자체가 없다) 사람
        수만큼 만들면 같은 회사가 여러 줄로 갈린다. 사람은 ①에 남아 있고, CRM은
        기업명으로 그 사람들을 되찾아 보여준다.

   이미 그 행사에 «같은 참여 유형»으로 있는 것은 건너뛴다. 초청을 두 번 적으면
   참가자 수가 부풀고, 타겟이 두 줄이면 진행 단계가 갈려 어느 쪽이 최신인지 알 수 없다.
   유형이 다르면 넣는다 — 전시 참가사가 파트너링에는 셀러로 오는 일이 흔하다
   (행사 화면은 사람 단위로 접으므로 참가자 수는 부풀지 않는다).

   «참가 확정으로 넣기»를 켜면 오늘 날짜로 확정해 넣는다 — 이미 참가가 정해진
   명단(파트너링 셀러·바이어 등)을 옮길 때 행사 화면에서 다시 확정할 일을 던다.
══════════════════════════════════════════ */

const nameKeyOf = (v) => String(v || '').toLowerCase()
  /* 법인 표기는 따로 떨어진 낱말일 때만 뗀다 — 경계 없이 떼면 «Coway»가 «way»,
     «Incheon»이 «heon»이 되어 엉뚱한 회사와 같은 키가 됐다. */
  .replace(/\(주\)|주식회사|㈜|\b(?:inc|corp|co|ltd)\b\.?/gi, '')
  .replace(/[^a-z0-9가-힣]/g, '');

/* 고른 사람들을 그대로 들고 온다. 소속은 CRM 타겟을 만들 때만 쓴다 —
   소속이 없어도 사람은 행사에 부를 수 있다. */
function mdbSelectedPeople(){
  return [...mdbSelected].map(id => getContactById(id)).filter(Boolean)
    .sort((a, b) => String(a.orgKo || a.orgEn || '').localeCompare(String(b.orgKo || b.orgEn || ''), 'ko')
      || String(a.nameKo || a.nameEn || '').localeCompare(String(b.nameKo || b.nameEn || ''), 'ko'));
}

const invitedAlready = (cid, ev, role) =>
  participations.some(p => String(p.contactId) === String(cid) && String(p.eventId || p.event || '') === ev
    && String(p.role || '') === String(role || ''));

const crmHasOrg = (name, ev) => !!name && targets.some(t =>
  String(t.event || '') === ev && nameKeyOf(t.name) === nameKeyOf(name));

export function openMDBToCrmModal(){
  if(!mdbSelected.size){ alert('먼저 초청할 사람을 선택해주세요.'); return; }
  closeMDBToCrmModal();

  const pop = document.createElement('div');
  pop.id = 'mdb-tocrm-modal';
  pop.className = 'mw on';
  let downOnBg = false;
  pop.addEventListener('mousedown', (e) => { downOnBg = (e.target === pop); });
  pop.addEventListener('click', (e) => { if(e.target === pop && downOnBg) closeMDBToCrmModal(); });

  pop.innerHTML = `<div class="modal" style="max-width:580px">
    <div class="mh"><div style="flex:1;min-width:0"><div class="mt2">행사에 초청</div>
      <div style="font-size:var(--fs-11);color:var(--i4);margin-top:2px">고른 ${mdbSelected.size}명을 행사 참가자로 올리고, 소속 기업을 CRM 타겟으로 함께 잡아요</div></div></div>
    <div class="mb">
      <div class="fgr">
        <div class="fg"><label class="fl">초청할 행사 *</label>
          <select class="fi" id="tocrm-ev" onchange="renderMDBToCrmList()">
            ${EVENT_LIST.map(e => `<option value="${escapeHtml(e.key)}">${escapeHtml(e.short || e.key)}${
              e.date ? ` (${escapeHtml(e.date)})` : ''}</option>`).join('')}
          </select></div>
        <div class="fg"><label class="fl">참여 유형</label>
          <select class="fi parttype-select" id="tocrm-role" onchange="renderMDBToCrmList()"></select></div>
      </div>
      <label style="display:flex;align-items:flex-start;gap:7px;cursor:pointer;padding:2px 0 6px">
        <input type="checkbox" id="tocrm-conf" onchange="renderMDBToCrmList()" style="margin-top:2px">
        <span><span style="font-size:var(--fs-12);font-weight:600">참가 확정으로 넣기</span>
          <span style="display:block;font-size:var(--fs-10_5);color:var(--i5);margin-top:2px">
            이미 오기로 정해진 사람이면 켜세요 — 오늘 날짜로 확정돼 파트너링·행사 참여자 화면에 바로 나와요.</span></span>
      </label>
      <label style="display:flex;align-items:flex-start;gap:7px;cursor:pointer;padding:2px 0 8px">
        <input type="checkbox" id="tocrm-mk" checked onchange="renderMDBToCrmList()" style="margin-top:2px">
        <span><span style="font-size:var(--fs-12);font-weight:600">소속 기업을 CRM 타겟으로도 올리기</span>
          <span style="display:block;font-size:var(--fs-10_5);color:var(--i5);margin-top:2px">
            CRM은 기업 단위로 진행 단계를 쫓아요. 이미 그 행사 타겟에 있는 기업은 건드리지 않습니다.</span></span>
      </label>
      <div class="fgr" id="tocrm-crmopts">
        <div class="fg"><label class="fl">우선순위</label>
          <select class="fi" id="tocrm-pri">
            <option value="high">높음</option><option value="mid" selected>중간</option><option value="low">낮음</option>
          </select></div>
        <div class="fg"><label class="fl">담당자</label>
          <input class="fi" id="tocrm-who" placeholder="담당자 이름"></div>
      </div>
      <div class="fg"><label class="fl">메모</label>
        <input class="fi" id="tocrm-note" placeholder="왜 부르는지 — 참가 이력과 타겟 첫 기록에 남습니다"></div>
      <div class="fg"><label class="fl">초청할 사람</label>
        <div id="tocrm-list" style="max-height:230px;overflow-y:auto;border:1px solid var(--i7);border-radius:var(--r);padding:6px"></div></div>
      <div id="tocrm-msg" style="font-size:var(--fs-11_5);color:var(--i4);min-height:16px"></div>
    </div>
    <div class="mf2">
      <button class="btn" onclick="closeMDBToCrmModal()">취소</button>
      <button class="btn bp" id="tocrm-btn" onclick="confirmMDBToCrm()">초청</button>
    </div></div>`;
  document.body.appendChild(pop);
  window.populateUploadEvDropdown?.();   // 참여 유형 채우기
  renderMDBToCrmList();
}
export function closeMDBToCrmModal(){ document.getElementById('mdb-tocrm-modal')?.remove(); }

export function renderMDBToCrmList(){
  const el = document.getElementById('tocrm-list');
  if(!el) return;
  const ev = document.getElementById('tocrm-ev')?.value || '';
  const role = document.getElementById('tocrm-role')?.value || '';
  const mkCrm = !!document.getElementById('tocrm-mk')?.checked;
  const conf = !!document.getElementById('tocrm-conf')?.checked;
  const people = mdbSelectedPeople();
  el._people = people;

  const opts = document.getElementById('tocrm-crmopts');
  if(opts) opts.style.display = mkCrm ? '' : 'none';

  el.innerHTML = people.map((c, i) => {
    const dup = invitedAlready(c.id, ev, role);
    const org = String(c.orgKo || c.orgEn || '').trim();
    return `<label style="display:flex;align-items:center;gap:9px;padding:6px 7px;border-radius:var(--rd-6);cursor:${dup ? 'default' : 'pointer'};opacity:${dup ? .45 : 1}">
      <input type="checkbox" class="tocrm-cb" data-i="${i}" ${dup ? 'disabled' : 'checked'}>
      <span style="font-weight:600;font-size:var(--fs-12);min-width:74px">${escapeHtml(c.nameKo || c.nameEn || '(이름 없음)')}</span>
      <span style="font-size:var(--fs-11);color:var(--i3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${
        org ? escapeHtml(org) : '<span style="color:var(--i5)">소속 없음</span>'}</span>
      ${dup ? `<span class="pill p-gray">이미 ${escapeHtml(role || '초청')}</span>` : ''}
    </label>`;
  }).join('');

  // 이번에 새로 생길 CRM 타겟이 몇 곳인지 미리 알려 준다
  const picked = people.filter(c => !invitedAlready(c.id, ev, role));
  const newOrgs = [...new Set(picked.map(c => String(c.orgKo || c.orgEn || '').trim())
    .filter(Boolean).filter(nm => !crmHasOrg(nm, ev)).map(nameKeyOf))].length;
  const dupN = people.length - picked.length;
  const noOrg = picked.filter(c => !String(c.orgKo || c.orgEn || '').trim()).length;

  const msg = document.getElementById('tocrm-msg');
  if(msg) msg.innerHTML = [
    dupN ? `이미 이 행사에 ${escapeHtml(role)}(으)로 있는 <b>${dupN}명</b>은 건너뜁니다` : '',
    conf ? `<b>${picked.length}명</b>을 참가 확정으로 넣어요` : '',
    mkCrm ? (newOrgs ? `CRM 타겟 <b>${newOrgs}곳</b>이 새로 생깁니다` : 'CRM 타겟은 모두 이미 있어요')
          : 'CRM 타겟은 만들지 않습니다',
    noOrg ? `소속이 안 적힌 <b>${noOrg}명</b>은 초청만 되고 타겟에는 안 잡혀요` : '',
  ].filter(Boolean).join(' · ');
}

export async function confirmMDBToCrm(){
  const el = document.getElementById('tocrm-list');
  const ev = document.getElementById('tocrm-ev')?.value || '';
  const people = (el && el._people) || [];
  const picked = [...document.querySelectorAll('.tocrm-cb')]
    .filter(cb => cb.checked && !cb.disabled).map(cb => people[+cb.dataset.i]).filter(Boolean);
  if(!ev){ alert('초청할 행사를 골라주세요.'); return; }
  if(!picked.length){ alert('초청할 사람을 선택해주세요.'); return; }

  const btn = document.getElementById('tocrm-btn');
  if(btn){ btn.disabled = true; btn.textContent = '초청 중…'; }

  const role = document.getElementById('tocrm-role')?.value || '';
  const note = document.getElementById('tocrm-note')?.value || '';
  const mkCrm = !!document.getElementById('tocrm-mk')?.checked;
  const confirmedAt = document.getElementById('tocrm-conf')?.checked ? td() : '';

  /* ① 초청 — 사람마다 한 줄. 확정이면 맨 뒤 칸(confirmed_at)에 오늘 날짜 */
  const parts = picked.map((c, i) => ({
    id: `P-${Date.now()}-${i}`, eventId: ev, event: ev,
    contactId: c.id, contact: '', role, note,
    matched: '✅ 마스터DB에서 초청', confirmedAt,
  }));
  parts.forEach(p => participations.push(p));
  const pRes = await Promise.all(parts.map(p => postToSheet({
    sheet: 'participations',
    row: [p.id, p.eventId, '', p.contactId, '', '', '', p.role, p.note, p.matched,
      ...(p.confirmedAt ? [p.confirmedAt] : [])],
  }, '행사 초청')));
  const pBad = parts.filter((_, i) => !pRes[i].ok);
  pBad.forEach(p => { const k = participations.indexOf(p); if(k >= 0) participations.splice(k, 1); });
  const okParts = parts.filter(p => !pBad.includes(p));

  /* ② CRM 타겟 — 초청이 실제로 들어간 사람의 소속만, 그 행사에 없을 때만 */
  const made = [];
  if(mkCrm){
    const okIds = new Set(okParts.map(p => String(p.contactId)));
    const seen = new Set();
    const pri = document.getElementById('tocrm-pri')?.value || 'mid';
    const who = document.getElementById('tocrm-who')?.value || '';
    picked.filter(c => okIds.has(String(c.id))).forEach((c, i) => {
      const name = String(c.orgKo || c.orgEn || '').trim();
      const key = nameKeyOf(name);
      if(!key || seen.has(key) || crmHasOrg(name, ev)) return;
      seen.add(key);
      const co = CO_DB.find(o => o.key === key);
      made.push({
        id: Date.now() + i,
        name, nameEn: String(c.orgEn || (co && co.nameEn) || '').trim(),
        sector: (co && co.sector) || '', hq: (co && (co.hq || co.country)) || '',
        event: ev, role, status: '미접촉', priority: pri, assignee: who,
        lastActivity: td(), currentStage: 1,
        branches: [name, c.orgEn].filter(Boolean), mainBranch: name,
        log: note ? [{ type: '메모', text: note, date: td(), color: '#9C9890' }] : [],
      });
    });
  }
  let tBad = [];
  if(made.length){
    const { saveTargetToSheet } = await import('../../modules/crm-tab.js');
    made.forEach(t => targets.unshift(t));
    const tRes = await Promise.all(made.map(t => saveTargetToSheet(t, { log: true })));
    tBad = made.filter((_, i) => !tRes[i].ok);
    tBad.forEach(t => { const k = targets.indexOf(t); if(k >= 0) targets.splice(k, 1); });
  }

  closeMDBToCrmModal();
  clearMDBSelection();
  buildCoDB();
  buildMDBEvList(); renderMDB();
  window.invalidateEvRows?.();   // 행사 화면의 참여자 집계를 다시 세게
  /* crm-tab을 위에서 import하면 순환 참조가 된다 — 필요할 때만 불러온다 */
  const crm = await import('../../modules/crm-tab.js');
  crm.buildEvFil(); crm.renderCrm(); crm.updBadges();

  const okT = made.length - tBad.length;
  if(okParts.length) trackAction('add', '행사 초청', `${okParts.length}명`,
    `마스터DB에서 <b>${escapeHtml(String(okParts.length))}명</b>을 <b>${escapeHtml(ev)}</b>에 ${escapeHtml(role)}(으)로 ${confirmedAt ? '참가 확정' : '초청'}${
      okT ? ` · CRM 타겟 ${okT}곳 추가` : ''}`);
  const fail = pBad.length + tBad.length;
  if(fail) alert(`${fail}건은 저장에 실패해 되돌렸어요. 네트워크 확인 후 다시 시도해주세요.`);
}

export function openMDBBulkEditModal(){
  if(!mdbSelected.size) return;
  closeMDBBulkEditModal();

  // 선택된 연락처들이 지금 전부 같은 기업 소속이면 "분리" 제안 버튼을 보여준다
  // (다른 기업들이 섞여 있으면 분리라는 개념 자체가 애매하므로 숨김)
  const selContacts = [...mdbSelected].map(id => getContactById(id)).filter(Boolean);
  const orgsInSel = new Set(selContacts.map(c => c.orgKo || c.orgEn || ''));
  const commonOrg = orgsInSel.size === 1 ? [...orgsInSel][0] : '';

  const pop = document.createElement('div');
  pop.id = 'mdb-bulk-modal';
  pop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.32);z-index:9999;display:flex;align-items:center;justify-content:center';
  pop.onclick = () => closeMDBBulkEditModal();
  pop.innerHTML = `
    <div style="background:var(--W);border-radius:var(--rd-10);padding:20px;width:340px;box-shadow:0 12px 40px rgba(0,0,0,.2)" onclick="event.stopPropagation()">
      <div style="font-size:var(--fs-14);font-weight:700;margin-bottom:12px">선택한 ${mdbSelected.size}명 일괄 변경</div>
      <div class="fg">
        <label class="fl">기업명(국문) — 비워두면 유지<br>
          <span style="font-weight:400;color:var(--i4)">목록에서 기존 기업을 고르면 그 기업으로 <b>통합</b>, 새 이름을 입력하면 <b>분리</b>돼요</span>
        </label>
        <input class="fi" id="mdb-bulk-org" list="mdb-bulk-org-list" placeholder="예: 삼성전자" oninput="updateMDBBulkOrgHint()">
        <datalist id="mdb-bulk-org-list">
          ${CO_DB.map(c => `<option value="${escapeHtml(c.nameKo||c.nameEn)}" label="${c.contacts.length}명 배정됨">`).join('')}
        </datalist>
        <div id="mdb-bulk-org-hint" style="font-size:var(--fs-11);color:var(--i4);margin-top:4px;min-height:14px"></div>
        ${commonOrg ? `<button type="button" class="btn bs" style="margin-top:2px;font-size:var(--fs-11)" onclick="suggestMDBSplitName()">🔀 "${escapeHtml(commonOrg)}"에서 분리할 새 이름 제안</button>` : ''}
      </div>
      <div class="fg" style="margin-top:8px"><label class="fl">카테고리 — 유지하려면 선택 안 함</label>
        <select class="fi" id="mdb-bulk-cat"><option value="">변경 안 함</option>
          ${CAT_KEYS.map(k=>`<option value="${k}">${CL[k]}</option>`).join('')}
        </select></div>
      <div class="fg" style="margin-top:8px"><label class="fl">국가 — 유지하려면 선택 안 함<br>
          <span style="font-weight:400;color:var(--i4)">«비우기»를 고르면 국가를 지웁니다 — 잘못 들어간 값을 되돌릴 때 씁니다</span>
        </label>
        <select class="fi" id="mdb-bulk-country">
          <option value="">변경 안 함</option>
          <option value="__blank__">— 비우기 —</option>
          ${countryOptions('')}
        </select></div>
      <div class="fg" style="margin-top:8px"><label class="fl">상태 — 유지하려면 선택 안 함</label>
        <select class="fi" id="mdb-bulk-status"><option value="">변경 안 함</option>
          <option value="verified">검증됨</option><option value="pending">확인 중</option><option value="new">신규</option>
        </select></div>
      ${TAGS.map(t => `
      <div class="fg" style="margin-top:8px"><label class="fl">${escapeHtml(t.label)} 태그 — 참가 역할·카테고리와 무관하게 계속 남는 꼬리표(다음 행사 메일링에 재사용)</label>
        <select class="fi" id="mdb-bulk-tag-${escAttr(t.key)}"><option value="">유지</option><option value="add">${escapeHtml(t.label)}로 표시</option><option value="remove">${escapeHtml(t.label)} 표시 해제</option></select></div>`).join('')}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
        <button class="btn bs" onclick="closeMDBBulkEditModal()">취소</button>
        <button class="btn bp" onclick="applyMDBBulkEdit()">적용</button>
      </div>
    </div>`;
  document.body.appendChild(pop);
}
export function closeMDBBulkEditModal(){
  const el = document.getElementById('mdb-bulk-modal');
  if(el) el.remove();
}
/* "분리" 제안 — 지금 선택된 사람들이 다 같은 기업 소속일 때, 그 이름에
   " (분리)" 접미사를 붙여 입력창에 채워준다. 사용자가 그대로 저장하거나
   직접 다듬어서 적용하면, buildCoDB가 다음 재빌드 때 이 사람들을 원래
   기업과 다른 별도의 CO_DB 항목으로 묶는다(기업 구분은 orgKo/orgEn 텍스트
   기준으로만 이뤄지므로 별도의 저장 로직이 필요 없음). */
/* 기업명 입력창에 값이 바뀔 때마다 그 이름과 정확히 일치하는 CO_DB 기업이
   있는지 찾아 현재 배정 인원 수를 보여준다 — 통합 전에 "몇 명짜리 기업에
   합쳐지는지" 미리 알 수 있게 하기 위함(사용자 요청). 일치하는 기업이 없으면
   지금 입력 중인 이름이 새 기업(분리)이 된다는 걸 알려준다. */
export function updateMDBBulkOrgHint(){
  const hintEl = document.getElementById('mdb-bulk-org-hint');
  if(!hintEl) return;
  const val = ((document.getElementById('mdb-bulk-org')||{}).value||'').trim();
  if(!val){ hintEl.textContent = ''; return; }
  const match = CO_DB.find(c => (c.nameKo||'').trim() === val || (c.nameEn||'').trim() === val);
  if(match){
    hintEl.textContent = `→ "${match.nameKo||match.nameEn}"에 현재 ${match.contacts.length}명 배정돼있어요 — 선택한 사람들이 여기 합쳐져요`;
    hintEl.style.color = 'var(--a)';
  } else {
    hintEl.textContent = '→ 일치하는 기존 기업이 없어요 — 새 기업으로 분리돼요';
    hintEl.style.color = 'var(--i4)';
  }
}
export function suggestMDBSplitName(){
  const input = document.getElementById('mdb-bulk-org');
  if(!input) return;
  const selContacts = [...mdbSelected].map(id => getContactById(id)).filter(Boolean);
  const orgsInSel = new Set(selContacts.map(c => c.orgKo || c.orgEn || ''));
  if(orgsInSel.size !== 1) return;
  const base = [...orgsInSel][0];
  input.value = base ? `${base} (분리)` : '';
  input.focus();
  input.select();
  updateMDBBulkOrgHint();
}
export async function applyMDBBulkEdit(){
  const org    = ((document.getElementById('mdb-bulk-org')||{}).value||'').trim();
  const cat    = (document.getElementById('mdb-bulk-cat')||{}).value||'';
  const status = (document.getElementById('mdb-bulk-status')||{}).value||'';
  /* 국가는 «안 바꿈»과 «비우기»를 구분해야 한다 — 빈 문자열 하나로는
     «건드리지 마»와 «지워»가 같은 말이 된다. */
  const countrySel = (document.getElementById('mdb-bulk-country')||{}).value||'';
  const country = countrySel === '__blank__' ? '' : countrySel;
  const tagOps = TAGS.map(t => ({ key: t.key, label: t.label, op: (document.getElementById('mdb-bulk-tag-'+t.key)||{}).value||'' }))
    .filter(x => x.op);
  if(!org && !cat && !status && !countrySel && !tagOps.length){ alert('변경할 값을 하나 이상 입력/선택하세요.'); return; }

  const ids = [...mdbSelected];
  const changed = [];
  const backup = []; // 저장 실패 시 롤백용
  ids.forEach(id => {
    const c = getContactById(id);
    if(!c) return;
    backup.push({ c, orgKo: c.orgKo, orgEn: c.orgEn, cat: c.cat, status: c.status, country: c.country, tags: c.tags, org_id: c.org_id });
    // 소속을 바꾸면 영문 소속도 새 회사로 — 전에는 영문이 옛 회사로 남아 영문 메일 {기업}에 남의 이름이 들어갔다
    if(org){ c.orgKo = org; c.orgEn = /[가-힣]/.test(org) ? '' : org; }
    if(cat) c.cat = cat;
    if(status) c.status = status;
    if(countrySel) c.country = country;
    tagOps.forEach(t => setContactTag(c, t.key, t.op === 'add'));
    changed.push(c);
  });
  closeMDBBulkEditModal();
  if(!changed.length) return;

  /* 소속을 바꿨으면 기업 연결도 새 소속을 따라가야 한다 — 안 그러면 화면에는
     새 회사 이름이 뜨는데 기업DB에서는 옛 회사에 그대로 매달려 있게 된다. */
  if(org){
    try {
      await ensureOrgsForNames([org]);
      const oid = orgIdForName(org);
      const o = oid ? getOrgById(oid) : null;
      changed.forEach(c => { c.org_id = oid || c.org_id || ''; if(o && o.name_en) c.orgEn = o.name_en; });
    } catch(e){ console.warn('[db-tab] 기업 재연결 실패:', e); }
  }

  const r = await postToSheet({
    sheet: 'contacts', action: 'batchUpsert',
    rows: changed.map(c => [c.id,c.nameKo,c.nameEn,c.orgKo,c.orgEn,c.titleKo,c.titleEn,c.deptKo,c.deptEn,
      c.country,c.cat,c.lang,c.source,c.date,c.status,c.email1,c.email2,c.phone1,c.phone2,c.beat,c.products,c.tags||'',c.org_id||'']),
  }, '연락처 일괄 변경');
  if(!r.ok){
    // 기업 병합(mergeCompanies)과 동일한 원칙 — 저장 실패 시 로컬 변경을 되돌려서
    // 화면엔 바뀐 것처럼 보이는데 새로고침하면 원복되는 거짓 성공을 막는다.
    backup.forEach(b => { b.c.orgKo = b.orgKo; b.c.orgEn = b.orgEn; b.c.cat = b.cat; b.c.status = b.status; b.c.country = b.country; b.c.tags = b.tags; b.c.org_id = b.org_id; });
    buildCoDB();
    mdbSelected.clear();
    renderMDB();
    alert('일괄 변경 저장에 실패해서 취소했어요. 네트워크 확인 후 다시 시도해주세요.');
    return;
  }

  const parts = [org&&'기업명', cat&&'카테고리', status&&'상태',
    countrySel && (country ? `국가→${country}` : '국가 비움'), ...tagOps.map(t=>`${t.label} ${t.op==='add'?'추가':'해제'}`)].filter(Boolean).join(', ');
  /* 여러 명을 한꺼번에 바꾼 것 — 사람마다 이전값이 다르므로 줄마다 담는다 */
  trackAction('edit', '연락처 일괄 변경', `${changed.length}명`, `연락처 ${changed.length}명 일괄 변경(${parts})`,
    { table: 'contacts', op: 'update-many',
      rows: backup.map(b => ({ row: b.c.id,
        before: pickChanged(b.c, b), after: pickChanged(b, b.c) })) });
  mdbSelected.clear();
  buildCoDB();
  renderMDB();
}

export async function bulkDeleteMDBContacts(){
  const ids = [...mdbSelected];
  if(!ids.length) return;

  /* 전시 담당자·연사·연사 연락 상대로 걸린 사람은 지우지 않는다.
     참여 기록과 달리 이 줄들은 같이 지우면 전시 체크리스트·연사 섭외 기록이
     통째로 사라지고, 남겨 두면 없는 사람을 가리키는 줄이 된다(이름 칸이 비어
     «누구였는지» 알 수 없다). 어느 쪽도 조용히 해선 안 되니 먼저 풀게 한다. */
  const blocked = [];
  ids.forEach(id => {
    const k = String(id);
    const where = [];
    EXH_CONTACTS.filter(r => String(r.contact_id || '') === k).forEach(r => {
      const x = EXHIBITORS.find(e => e.id === r.exhibitor_id);
      where.push(`전시 담당자(${(x && (x.company_name || x.event_id)) || r.exhibitor_id})`);
    });
    SPEAKERS.filter(r => String(r.contact_id || '') === k).forEach(r =>
      where.push(`연사(${r.event_id || r.id})`));
    SPEAKER_CONTACTS.filter(r => String(r.contact_id || '') === k).forEach(r => {
      const sp = getSpeakerById(r.speaker_id);
      where.push(`연사 연락 상대(${(sp && (sp.name_snapshot || sp.name_en)) || r.speaker_id})`);
    });
    const att = CONTACT_ATTEMPTS.filter(a => String(a.contact_id || '') === k).length;
    if(att) where.push(`컨택 DM·TM 기록 ${att}건`);
    if(where.length) blocked.push(`· ${personName(getContactById(id)) || id} — ${where.join(', ')}`);
  });
  if(blocked.length){
    alert(`아래 ${blocked.length}명이 다른 곳에 연결돼 있어 삭제를 멈췄어요(아무도 지우지 않았습니다).\n`
      + `전시 담당자·연사 쪽에서 먼저 연결을 풀거나 다른 사람으로 바꾼 뒤 지워주세요.\n\n`
      + blocked.slice(0, 15).join('\n') + (blocked.length > 15 ? `\n… 외 ${blocked.length - 15}명` : ''));
    return;
  }

  if(!confirm(`선택한 ${ids.length}명의 연락처를 삭제할까요?\n관련 행사 참여 기록도 함께 삭제되며, 되돌릴 수 없습니다.`)) return;

  const idSet = new Set(ids);
  const removedParts = participations.filter(p => idSet.has(p.contactId)).map(p => ({ ...p }));
  const goneContacts = contacts.filter(c => idSet.has(c.id)).map(c => ({ ...c }));

  // 로컬 먼저 반영(화면 즉시 갱신), 시트 삭제는 그 뒤 순차 처리
  for(let i = contacts.length-1; i >= 0; i--) if(idSet.has(contacts[i].id)) contacts.splice(i,1);
  for(let i = participations.length-1; i >= 0; i--) if(idSet.has(participations[i].contactId)) participations.splice(i,1);

  mdbSelected.clear();
  buildCoDB();
  renderMDB();

  /* 참여 기록을 먼저 지우고 사람을 지운다 — 거꾸로면 참여 삭제가 실패했을 때 없는 사람을
     가리키는 줄이 남아 행사 명단에 빈 이름이 뜬다. 실패한 것은 화면에 되돌린다 */
  const failedParts = [];
  for(const p of removedParts){
    const r = await postToSheet({ sheet:'participations', action:'delete', row:[p.id] }, '행사 참여 삭제');
    if(!r || r.ok === false) failedParts.push(p);
  }
  /* 행사별 영업 DB 줄도 같이 지운다 — 남기면 없는 사람을 가리킨다 */
  const goneSales = SALES_TARGETS.filter(t => idSet.has(t.contact_id));
  if(goneSales.length){
    const r = await postToSheet({ sheet:'sales_targets', action:'delete', row: goneSales.map(t => t.id) }, '영업 DB 삭제');
    if(r && r.ok !== false) goneSales.forEach(t => SALES_TARGETS.splice(SALES_TARGETS.indexOf(t), 1));
  }
  const stuck = new Set(failedParts.map(p => p.contactId));   // 참여가 남은 사람은 지우지 않는다
  const failedIds = [...stuck];
  for(const id of ids){
    if(stuck.has(id)) continue;
    const r = await postToSheet({ sheet:'contacts', action:'delete', row:[id] }, '연락처 삭제');
    if(!r || r.ok === false) failedIds.push(id);
  }
  if(failedIds.length || failedParts.length){
    const back = new Set(failedIds);
    goneContacts.filter(c => back.has(c.id)).forEach(c => contacts.push(c));
    participations.push(...failedParts);   // 지워진 참여 기록은 서버에서도 지워졌다 — 못 지운 것만 되돌린다
    buildCoDB(); renderMDB();
    alert(`${failedIds.length}명은 지우지 못해 되돌렸어요. 네트워크 확인 후 다시 시도해주세요.`);
  }
  /* 지운 연락처와 딸린 참여 기록을 통째로 담는다 — «되돌릴 수 없습니다»라고
     물어 놓고 정말 아무것도 안 남기면, 잘못 지운 날 할 수 있는 게 없다. */
  const doneIds = ids.filter(id => !failedIds.includes(id));
  const doneParts = removedParts.filter(p => !failedParts.includes(p));
  if(!doneIds.length && !doneParts.length) return;
  trackAction('edit', '연락처 일괄 삭제', `${doneIds.length}명`, `연락처 ${doneIds.length}명 삭제`,
    removedMeta('contacts', doneIds.join(','), goneContacts.filter(c => doneIds.includes(c.id)),
      /* 참여 기록은 제 표 이름을 달고 간다 — 없으면 되돌릴 때 연락처 표로 들어간다 */
      { also: doneParts.map(p => ({ table: 'participations', before: p })) }));
}

/* ── View toggle (원본 1767~1772행) ── */
export function setDBView(v,btn){
  setMdbView(v);
  document.querySelectorAll('.dvt-btn').forEach(b=>b.classList.remove('on'));
  (btn||document.getElementById('dvt-'+v)).classList.add('on');
  renderMDB();
}

/* ── Core filter: returns array of {c, p|null} pairs (원본 1781~1826행) ── */
export function getMDBPairs(){
  const q = (document.getElementById('mdb-q')||{}).value||'';
  let pairs = [];

  if(mdbEvFilter){
    // 특정 행사 — participations 기준
    let evParts = participations.filter(p => p.eventId === mdbEvFilter);
    if(mdbCat !== 'all' && !MDB_CAT_VALUES.includes(mdbCat)){
      // 태그(BD/C-level/커스텀) — cat이 아니라 연락처의 영구 태그로 직접 검사(다른 카테고리와 비배타적)
      evParts = evParts.filter(p => matchesTagFilter(getContactById(p.contactId), mdbCat));
    } else if(mdbCat !== 'all'){
      // "전체"와 동일하게: 연락처 자체의 cat 또는 참가 역할 둘 중 하나라도 맞으면 포함
      evParts = evParts.filter(p => {
        const c = getContactById(p.contactId);
        if(c && c.cat === mdbCat) return true;
        return ROLE_TO_CAT[p.role] === mdbCat;
      });
    }
    if(mdbTypeFilter) evParts = evParts.filter(p => (p.role || '참가자') === mdbTypeFilter);
    // 한 행사당 한 사람은 1번만 (카테고리 필터 이후에 중복 제거해야 다중 트랙 참가자가 안 빠짐)
    const seenCids = new Set();
    pairs = evParts
      .filter(p => { if(seenCids.has(p.contactId)) return false; seenCids.add(p.contactId); return true; })
      .map(p => ({ c: getContactById(p.contactId), p }))
      .filter(x => x.c);
  } else {
    // 전체 — contacts 기준, id 중복 제거
    const seenIds = new Set();
    pairs = contacts
      .filter(c => { if(seenIds.has(c.id)) return false; seenIds.add(c.id); return true; })
      .map(c => ({ c, p: null }));
    if(mdbCat !== 'all' && !MDB_CAT_VALUES.includes(mdbCat)){
      // 태그(BD/C-level/커스텀) — cat이 아니라 연락처의 영구 태그로 직접 검사(다른 카테고리와 비배타적)
      pairs = pairs.filter(({c}) => matchesTagFilter(c, mdbCat));
    } else if(mdbCat !== 'all'){
      pairs = pairs.filter(({c}) => {
        if(c.cat === mdbCat) return true;
        return participations.some(p => p.contactId === c.id && ROLE_TO_CAT[p.role] === mdbCat);
      });
    }
  }

  pairs = mdbFilterPairs(pairs);
  if(q) pairs = pairs.filter(({ c }) => matchesQuery(c, q));
  return pairs;
}

/* ── Main render dispatcher (원본 1829~1842행) ── */
export function toggleMdbCtry(){ mdbUi.mdbCtryOnly = !mdbUi.mdbCtryOnly; renderMDB(); }
export function toggleMdbLeft(){ mdbUi.mdbShowLeft = !mdbUi.mdbShowLeft; renderMDB(); }


/* 화면의 onclick이 부르는 것 */
window.openMDBBulkEditModal = openMDBBulkEditModal;
window.openMDBToCrmModal = openMDBToCrmModal;
window.closeMDBToCrmModal = closeMDBToCrmModal;
window.renderMDBToCrmList = renderMDBToCrmList;
window.confirmMDBToCrm = confirmMDBToCrm;
window.closeMDBBulkEditModal = closeMDBBulkEditModal;
window.suggestMDBSplitName = suggestMDBSplitName;
window.updateMDBBulkOrgHint = updateMDBBulkOrgHint;
window.applyMDBBulkEdit = applyMDBBulkEdit;
window.bulkDeleteMDBContacts = bulkDeleteMDBContacts;
window.setDBView = setDBView;
window.getMDBPairs = getMDBPairs;
window.toggleMdbCtry = toggleMdbCtry;
window.toggleMdbLeft = toggleMdbLeft;
