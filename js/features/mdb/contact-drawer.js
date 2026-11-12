/* ══════════════════════════════════════════════════════════════
   features/mdb/contact-drawer.js — 연락처 상세 창 — 보기·고치기, 참여 행사 추가, 직접 추가, 퇴사 처리
   (modules/db-tab.js에서 옮겼다 — 탭 화면 파일에 기대지 않게)
═══════════════════════════════════════════════════════════════ */

import { postToSheet } from '../../api.js';
import { CAT_KEYS, CL, CONTACT_ORIGINS, COUNTRIES, CP, RP, avB, avF } from '../../constants.js';
import { changed, removed, trackAction } from '../../core/audit-log.js';
import { countryCheckText } from '../../country-signal.js';
import { buildCoDB } from '../../domain/co-db.js';
import { ensureOrgsForNames, orgIdForName } from '../../domain/orgs.js';
import { CONTACT_ROUNDS, EVENT_LIST, EXH_CONTACTS, PART_TYPES, ROUND_MEMBERS, SALES_TARGETS, contactEvents, contacts, evColor, evShort, getContactById, hasLeft, movedTo, nextContactId, participations, speakersOfContact, contactOrgEn, contactOrgSectors } from '../../state.js';
import { ab, countryName, countryOptions, escAttr, escapeHtml, personFullName, personName, td, sectorKey } from '../../utils.js';
import { coDomainOptionsHtml, coSectorOptionsHtml, currentCoSectorPick } from '../../modules/company-tab.js';
import { contactMailsHtml } from '../../modules/contact-mails.js';
import { speakerMaterialsHtml } from '../../modules/contact-speaker.js';
/* 마스터DB 탭(db-tab.js)의 도우미를 쓴다. 마스터DB 탭은 이 파일을 import하지 않는다 —
   화면의 onclick(window)으로만 이 창을 연다. 한 방향이라 고리가 생기지 않는다 */
import { buildMDBEvList, renderMDB, contactCountryText, contactPatch, ctryCheck, isBDContact, isCLevelContact, pickChanged } from '../../modules/db-tab.js';
import { contactSectorField, saveContactSectorField } from './mdb-drag.js';
import { isSalesTarget, markSalesTargets, unmarkSalesTarget } from '../../domain/sales-targets.js';
import { coList } from '../../domain/rounds.js';

/* ══════════════════════════════════════════
   연락처 상세 드로어 (원본 5614~6252행)
══════════════════════════════════════════ */
let conDrId = null;
let conEditMode = false;

/* 출처(사람마다 하나, 바뀌지 않음)와 행사별 영업 DB(행사마다 켜고 끔) — docs/manual-db-axes.md.
   누르면 바로 저장한다. 출처는 upsertPartial로 이 칸만 보내 다른 칸을 덮지 않는다. */
function contactAxesHtml(c){
  const chip = (o, on, click) => `<button type="button" class="pill ${on ? o.cls : 'p-gray'}" title="${escAttr(o.desc||'')}"
      style="cursor:pointer;border:0;margin:0 4px 4px 0;${on ? '' : 'opacity:.45'}" onclick="${click}">${on ? '✓ ' : ''}${escapeHtml(o.label)}</button>`;
  const salesEv = new Set(SALES_TARGETS.filter(t => t.contact_id === c.id).map(t => t.event_id));
  return `
    <div class="sct" style="margin-top:14px">출처 · 행사별 영업 DB</div>
    <div class="ig">
      <div class="ic" style="grid-column:span 2"><div class="il">출처 <span style="color:var(--i4);font-weight:400">처음 들어온 길 · 바뀌지 않음</span></div><div class="iv">
        ${CONTACT_ORIGINS.map(o => chip(o, c.origin === o.key, `setContactOrigin(${c.id},'${o.key}')`)).join('')}
      </div></div>
      <div class="ic" style="grid-column:span 2"><div class="il">영업 DB <span style="color:var(--i4);font-weight:400">이 사람을 어느 행사의 영업 DB로 쓰나 · 행사마다</span></div><div class="iv">
        ${EVENT_LIST.map(e => chip({ label: e.short || e.key, cls: 'p-purple', desc: e.name || e.key },
          salesEv.has(e.key), `toggleSalesTarget(${c.id},'${escAttr(e.key)}')`)).join('')}
      </div></div>
      ${contactRoundsHtml(c)}
    </div>`;
}

/* 이 사람 소속 기업이 들어가 있는 컨택 차수 — 여기서 바로 넣고 뺀다.
   컨택 명단은 기업 단위다. 넣으면 이 사람이 그 행사의 영업 DB로 켜지고, 빼도 영업 DB는 그대로다 */
function contactRoundsHtml(c){
  const co = coList().find(x => (x.contacts || []).some(p => +p.id === c.id));
  const head = `<div class="il">컨택 <span style="color:var(--i4);font-weight:400">소속 기업 단위 · 넣으면 그 행사 영업 DB로 켜져요</span></div>`;
  if(!co) return `<div class="ic" style="grid-column:span 2">${head}<div class="iv" style="color:var(--i4)">기업DB에 연결된 기업이 없어 컨택 명단에 넣을 수 없어요</div></div>`;
  const ms = ROUND_MEMBERS.filter(m => m.org_id === co.key).map(m => ({ m, r: CONTACT_ROUNDS.find(r => r.id === m.round_id) })).filter(x => x.r);
  return `<div class="ic" style="grid-column:span 2">${head}<div class="iv">
    ${ms.map(({ m, r }) => `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
      <span class="pill ${m.closed_at ? 'p-gray' : 'p-blue'}">${escapeHtml(evShort(r.event_id))} · ${escapeHtml(r.name)}${m.closed_at ? ' (종료)' : ''}</span>
      ${m.closed_at ? '' : `<button class="btn bs" style="font-size:var(--fs-11);padding:2px 8px" onclick="drawerRemoveFromRound('${escAttr(m.id)}')">빼기</button>`}
    </div>`).join('')}
    <button class="btn bs" style="font-size:var(--fs-11);padding:3px 8px" onclick="drawerSendToRound(${c.id})">+ 컨택에 넣기</button>
  </div></div>`;
}

export function drawerSendToRound(cid){
  const co = coList().find(x => (x.contacts || []).some(p => +p.id === +cid));
  if(!co) return;
  window.openSendToRound?.([co.key], personName(getContactById(cid)) || '연락처', { from: '연락처에서 고른', people: [+cid] });
}
export async function drawerRemoveFromRound(mid){
  if(await window.removeOrCloseMembers?.([mid])) renderContactDr();
}

export async function setContactOrigin(cid, key){
  const c = getContactById(cid);
  if(!c) return;
  /* 같은 것을 다시 누르면 비운다 — 잘못 고른 것을 되돌릴 길 */
  const before = c.origin;
  c.origin = c.origin === key ? '' : key;
  renderContactDr();
  const r = await postToSheet({ sheet:'contacts', action:'upsertPartial', data:{ id: c.id, origin: c.origin } }, '출처 저장');
  if(r && r.ok === false){ c.origin = before; renderContactDr(); }
}

export async function toggleSalesTarget(cid, evKey){
  const p = isSalesTarget(cid, evKey) ? unmarkSalesTarget(cid, evKey) : markSalesTargets([cid], evKey);
  renderContactDr();
  await p;
  renderContactDr();
}

export function openContactDr(id){
  conDrId = id;
  conEditMode = false;
  renderContactDr();
  document.getElementById('con-dr').classList.add('on');
  document.getElementById('con-bd').classList.add('on');
}
export function closeContactDr(){
  document.getElementById('con-dr').classList.remove('on');
  document.getElementById('con-bd').classList.remove('on');
  conDrId = null;
  conEditMode = false;
}

export function renderContactDr(){
  const c = contacts.find(x => x.id === conDrId);
  if(!c) return;
  const gi = contacts.indexOf(c);

  document.getElementById('con-dr-av').style.background = avB(gi);
  document.getElementById('con-dr-av').style.color = avF(gi);
  document.getElementById('con-dr-av').textContent = ab(c.nameKo||c.nameEn||'');
  /* 국문명이 없으면 « · John»처럼 점부터 시작하던 자리 */
  document.getElementById('con-dr-name').textContent = personFullName(c);
  document.getElementById('con-dr-meta').innerHTML =
    /* 기업명을 누르면 기업 정보 창(mdb-co-peek.js) */
    '<span class="co-link" onclick="openCoPeek(' + c.id + ')" title="눌러서 기업 정보 보기">🏢 ' + escapeHtml(c.orgKo||c.orgEn||'-') +
      ((c.orgKo||c.orgEn) ? '<button type="button" class="co-info-btn">기업정보</button>' : '') + '</span>' +
    '<span>🌐 ' + escapeHtml(contactCountryText(c)) + '</span>' +
    '<span class="pill ' + (CP[c.cat]||'p-gray') + '">' + (CL[c.cat]||c.cat) + '</span>';

  document.getElementById('con-dr-body').innerHTML = conEditMode ? contactEditForm(c) : contactViewPanel(c);
}

/* conEditMode는 모듈 스코프 변수라 onclick="conEditMode=true"처럼 인라인 대입으로는
   바뀌지 않는다 — 대신 아래 두 래퍼 함수를 window에 등록해서 호출한다(동작 동일). */
export function startContactEdit(){ conEditMode = true; renderContactDr(); }
export function cancelContactEdit(){ conEditMode = false; renderContactDr(); }

/* ══════════════════════════════════════════
   참여 행사 추가 모달 (원본 5654~5753행)
══════════════════════════════════════════ */
export function openAddEvModal(cid){
  // 같은 행사라도 다른 참가 유형(트랙)으로 추가할 수 있으므로 행사 목록에서 제외하지 않음
  const available = EVENT_LIST;

  const html = `
    <div id="add-ev-modal" onclick="if(event.target===this)closeAddEvModal()"
      style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center">
      <div style="background:var(--W);border-radius:var(--rd-12);padding:22px;width:340px;box-shadow:0 8px 32px rgba(0,0,0,.18)">
        <div style="font-size:var(--fs-14);font-weight:700;color:var(--i1);margin-bottom:16px">참여 행사 추가</div>

        <div style="margin-bottom:12px">
          <div class="mlbl">행사 선택</div>
          <select class="fi" id="aem-ev" style="width:100%">
            ${available.length
              ? available.map(e=>`<option value="${escapeHtml(e.key)}">${escapeHtml(e.short)} (${escapeHtml(e.date)})</option>`).join('')
              : '<option value="">추가 가능한 행사 없음</option>'}
            <option value="__direct__">✏️ 직접 입력…</option>
          </select>
          <input class="fi" id="aem-ev-text" placeholder="행사명 직접 입력"
            style="width:100%;margin-top:6px;display:none">
        </div>

        <div style="margin-bottom:16px">
          <div class="mlbl">참가 유형</div>
          <select class="fi parttype-select" id="aem-role" style="width:100%">
            ${PART_TYPES.map(t=>`<option value="${escapeHtml(t.key)}">${escapeHtml(t.label)}</option>`).join('')}
          </select>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn bs" onclick="closeAddEvModal()">취소</button>
          <button class="btn bp" onclick="confirmAddEv(${cid})">추가</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);

  // 직접입력 전환
  document.getElementById('aem-ev').onchange = function(){
    const inp = document.getElementById('aem-ev-text');
    if(this.value === '__direct__'){
      inp.style.display = 'block'; inp.focus();
    } else {
      inp.style.display = 'none';
    }
  };
}

export function closeAddEvModal(){
  const el = document.getElementById('add-ev-modal');
  if(el) el.remove();
}

export async function confirmAddEv(cid){
  const sel = document.getElementById('aem-ev');
  const inp = document.getElementById('aem-ev-text');
  const ev  = (sel.value === '__direct__' && inp && inp.value.trim())
    ? inp.value.trim()
    : (sel.value !== '__direct__' ? sel.value : '');
  const role = document.getElementById('aem-role').value;

  if(!ev){ alert('행사를 선택하거나 입력해주세요.'); return; }

  // 같은 행사+같은 참가 유형으로 이미 있으면 스킵 (같은 행사라도 다른 유형은 허용)
  if(participations.some(p => p.contactId === cid && p.eventId === ev && p.role === role)){
    alert('이미 같은 참가 유형으로 등록된 행사입니다.'); return;
  }

  // id에 랜덤 성분 추가 — 같은 ms 내 이중 클릭 시 id 충돌로 다른 행이
  // 삭제될 수 있던 문제 방지
  const partId = 'P-' + Date.now() + '-' + Math.floor(Math.random()*1000);
  const part = {
    id:        partId,
    eventId:   ev,
    event:     ev,
    contactId: cid,
    contact:   '',
    role:      role,
    note:      '',
    matched:   '✅ 앱에서 추가',
  };
  participations.push(part);
  closeAddEvModal();
  renderContactDr();
  buildCoDB();
  renderMDB();

  // 구글시트 저장 — 실패 시 방금 추가한 참여 기록 롤백
  const r = await postToSheet({
    sheet: 'participations',
    row: [part.id, part.eventId, '', part.contactId, '', '', '', part.role, part.note, part.matched],
  }, '행사 참여 추가');
  if(!r.ok){
    const idx = participations.findIndex(p => p.id === partId);
    if(idx >= 0) participations.splice(idx, 1);
    renderContactDr(); buildCoDB(); renderMDB();
    return;
  }
  trackAction('edit', '행사 추가', ev, `${personName(getContactById(cid))} → ${ev} (${role})`,
    { kind: 'contact', id: cid, table: 'participations', row: part.id, op: 'create', after: part });
}

export async function removeParticipation(cid, partId, ev){
  if(!confirm(`"${evShort(ev)}" 참여를 삭제할까요?`)) return;

  // 로컬 제거 (실패 시 복원할 수 있도록 백업)
  const idx = participations.findIndex(p => String(p.id) === String(partId));
  const removed = idx >= 0 ? participations.splice(idx, 1)[0] : null;

  renderContactDr();
  buildCoDB();
  renderMDB();

  // 구글시트 삭제 — 실패 시 로컬 복원
  if(partId){
    const r = await postToSheet({
      sheet: 'participations',
      action: 'delete',
      row: [partId],
    }, '행사 참여 삭제');
    if(!r.ok){
      if(removed) participations.splice(Math.min(idx, participations.length), 0, removed);
      renderContactDr(); buildCoDB(); renderMDB();
      return;
    }
    trackAction('edit', '행사 삭제', ev, `${personName(getContactById(cid))} ← ${ev} 제거`,
      removedMeta('participations', partId, removed || {}, { kind: 'contact', id: cid }));
  }
}

/* 원본 5783~5865행 */
export function contactViewPanel(c){
  const evs = contactEvents(c);
  return `
    <div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:14px">
      <button class="btn bs" onclick="${hasLeft(c) ? `undoContactLeft(${c.id})` : `openLeaveModal(${c.id})`}"
        title="${hasLeft(c) ? '아직 다니고 있다면 표시를 되돌립니다.' : '회사를 떠났다고 표시합니다. 행은 지우지 않아요.'}">
        ${hasLeft(c) ? '퇴사 표시 해제' : '퇴사 처리'}
      </button>
      <button class="btn bp bs" onclick="startContactEdit()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        편집
      </button>
    </div>

    ${hasLeft(c) ? (() => {
      const to = movedTo(c);
      return `<div style="display:flex;gap:8px;align-items:flex-start;padding:10px 12px;margin-bottom:14px;
        border-radius:var(--r);background:var(--i7);border:1px solid var(--i6)">
        <span style="font-size:var(--fs-13);line-height:1.5">🚪</span>
        <div style="font-size:var(--fs-12);color:var(--i2);line-height:1.6">
          <b>${escapeHtml(c.left_at)}</b>에 퇴사를 확인했어요. 목록에서는 내려가 있고,
          아래 참여 행사 기록은 그대로 남습니다.
          ${to
            ? `<div style="margin-top:4px">지금은
                <a href="javascript:void(0)" onclick="openContactDr(${to.id})"
                   style="color:var(--a);text-decoration:none;font-weight:600"
                  >${escapeHtml(to.orgKo || to.orgEn || '다른 회사')} · ${escapeHtml(to.nameKo || to.nameEn || '')}</a>
               </div>`
            : `<div style="margin-top:4px;color:var(--i4)">옮겨간 곳은 아직 몰라요.</div>`}
        </div>
      </div>`;
    })() : ''}

    <div class="sct">기본 정보</div>
    <div class="ig">
      <div class="ic"><div class="il">기업</div><div class="iv">${escapeHtml(c.orgKo)||'-'}</div></div>
      <div class="ic"><div class="il">영문 기업</div><div class="iv">${escapeHtml(contactOrgEn(c))||'-'}</div></div>
      <div class="ic"><div class="il">국가</div><div class="iv">${escapeHtml(contactCountryText(c)) || '-'}${
        (() => {
          /* 괄호만 보면 그게 거주지인지 알 수 없다 — 상세에서는 풀어 쓴다 */
          const sp = speakersOfContact(c.id).find(x => x.residence_country
            && countryName(x.residence_country) !== countryName(x.nationality || c.country));
          return sp ? `<div style="font-size:var(--fs-10);color:var(--i4);margin-top:2px">국적 ${
            escapeHtml(countryName(sp.nationality || c.country))} · 거주지 ${
            escapeHtml(countryName(sp.residence_country))}</div>` : '';
        })()}${
        (() => { const r = ctryCheck(c); return r
          ? `<div style="font-size:var(--fs-10_5);color:var(--am);font-weight:400;margin-top:3px;line-height:1.5">${
              escapeHtml(countryCheckText(r))}</div>` : ''; })()}</div></div>
      <div class="ic"><div class="il">카테고리</div><div class="iv"><span class="pill ${CP[c.cat]||'p-gray'}">${CL[c.cat]||c.cat}</span></div></div>
      <div class="ic"><div class="il">태그</div><div class="iv">
        ${isBDContact(c)?'<span class="pill p-teal" style="margin-right:4px">BD</span>':''}${isCLevelContact(c)?'<span class="pill p-gold">C-level</span>':''}${(!isBDContact(c)&&!isCLevelContact(c))?'<span style="color:var(--i4)">-</span>':''}
      </div></div>
    </div>

    ${contactAxesHtml(c)}

    <div class="sct" style="margin-top:14px">경칭 / 직함 / 부서</div>
    <div class="ig">
      <div class="ic"><div class="il">경칭</div><div class="iv">${escapeHtml(c.prefix)||'-'}</div></div>
      <div class="ic"><div class="il">직함 (국문)</div><div class="iv">${escapeHtml(c.titleKo)||'-'}</div></div>
      <div class="ic"><div class="il">직함 (영문)</div><div class="iv">${escapeHtml(c.titleEn)||'-'}</div></div>
      <div class="ic"><div class="il">부서 (국문)</div><div class="iv">${escapeHtml(c.deptKo)||'-'}</div></div>
      <div class="ic"><div class="il">부서 (영문)</div><div class="iv">${escapeHtml(c.deptEn)||'-'}</div></div>
    </div>

    ${(() => { const secs = contactOrgSectors(c); return (secs.length || c.beat) ? `
    <div class="sct" style="margin-top:14px">소속 기업 섹터</div>
    <div class="ig">
      <div class="ic"><div class="il">섹터</div><div class="iv">${secs.length
        ? secs.map(s => `<span class="pill p-teal">${escapeHtml(s)}</span>`).join(' ')
        : `<span style="color:var(--i4)">${c.org_id ? '기업에 섹터가 없어요' : '기업DB에 연결되지 않았어요'}</span>`}</div></div>
      ${c.beat ? `<div class="ic"><div class="il">업종 메모</div><div class="iv">${escapeHtml(c.beat)}</div></div>` : ''}
    </div>` : ''; })()}

    ${c.products ? `
    <div class="sct" style="margin-top:14px">전시 품목</div>
    <div class="ig">
      <div class="ic" style="grid-column:span 2"><div class="il">제품/품목</div><div class="iv">${escapeHtml(c.products)||'-'}</div></div>
    </div>` : ''}

    ${(c.memo1||c.memo2||c.memo3) ? `
    <div class="sct" style="margin-top:14px">메모</div>
    <div class="ig">
      ${[1,2,3].filter(n => c['memo'+n]).map(n => `
      <div class="ic" style="grid-column:span 2"><div class="il">메모 ${n}</div><div class="iv">${escapeHtml(c['memo'+n])}</div></div>`).join('')}
    </div>` : ''}

    <div class="sct" style="margin-top:14px">연락처</div>
    <div class="ig">
      <div class="ic"><div class="il">이메일 1</div><div class="iv">${c.email1?`<a href="mailto:${escapeHtml(c.email1)}" style="color:var(--a);text-decoration:none">${escapeHtml(c.email1)}</a>`:'-'}</div></div>
      <div class="ic"><div class="il">이메일 2</div><div class="iv">${c.email2?`<a href="mailto:${escapeHtml(c.email2)}" style="color:var(--a);text-decoration:none">${escapeHtml(c.email2)}</a>`:'-'}</div></div>
      <div class="ic"><div class="il">연락처 1</div><div class="iv">${escapeHtml(c.phone1)||'-'}</div></div>
      <div class="ic"><div class="il">연락처 2</div><div class="iv">${escapeHtml(c.phone2)||'-'}</div></div>
    </div>

    ${speakerMaterialsHtml(c)}

    ${contactMailsHtml(c)}

    <div class="sct" style="margin-top:14px;display:flex;align-items:center;justify-content:space-between">
      <span>참여 행사</span>
      <button class="btn bs" style="font-size:var(--fs-11);padding:3px 8px" onclick="openAddEvModal(${c.id})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> 추가
      </button>
    </div>
    <div id="con-ev-list-${c.id}" style="margin-bottom:14px">
      ${evs.length ? evs.map(ev => {
        const part = participations.find(p =>
          String(p.contactId) === String(c.id) && p.eventId === ev
        );
        const partId  = part ? part.id : '';
        const role    = part ? (part.role||'') : '';
        const roleClass = CP[role] || RP[role] || 'p-gray';
        const roleLabel = CL[role] || role;
        return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <span class="ev-pill" style="background:${evColor(ev)}18;color:${evColor(ev)};flex:1;min-width:0">
            <span class="ev-pill-dot" style="background:${evColor(ev)}"></span>
            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(evShort(ev))}</span>
            ${role ? `<span class="pill ${roleClass}" style="font-size:var(--fs-10);padding:1px 6px;flex-shrink:0">${escapeHtml(roleLabel)}</span>` : ''}
          </span>
          <button onclick="removeParticipation(${c.id},'${escAttr(partId)}','${escAttr(ev)}')"
            style="background:none;border:none;cursor:pointer;color:var(--i4);padding:2px 5px;font-size:var(--fs-16);line-height:1;flex-shrink:0"
            title="삭제">×</button>
        </div>`;
      }).join('') : '<div style="font-size:var(--fs-12);color:var(--i4)">참여 행사 없음</div>'}
    </div>

    <div class="sct">수집 정보</div>
    <div class="ig">
      <div class="ic"><div class="il">수집 출처</div><div class="iv" style="font-size:var(--fs-12)">${escapeHtml(c.source)||'-'}</div></div>
      <div class="ic"><div class="il">수집일</div><div class="iv">${escapeHtml(c.date)||'-'}</div></div>
      <div class="ic"><div class="il">언어</div><div class="iv"><span class="lt">${escapeHtml(c.lang)||'-'}</span></div></div>
      <div class="ic"><div class="il">상태</div><div class="iv">${({verified:'검증됨',pending:'확인 중',new:'신규'})[c.status]||escapeHtml(c.status)}</div></div>
    </div>
  `;
}

/* 원본 5867~5929행 */
export function contactEditForm(c){
  return `
    <div class="fg-row" style="margin-bottom:12px">
      <div class="fg"><label class="fl">경칭</label><input class="fi" id="ce-prefix" value="${escapeHtml(c.prefix||'')}" placeholder="Mr. / Ms. / Dr. / Prof."></div>
      <div class="fg"></div>
    </div>
    <div class="fg-row" style="margin-bottom:12px">
      <div class="fg"><label class="fl">이름 (국문)</label><input class="fi" id="ce-name" value="${escapeHtml(c.nameKo||'')}"></div>
      <div class="fg"><label class="fl">이름 (영문)</label><input class="fi" id="ce-nameEn" value="${escapeHtml(c.nameEn||'')}"></div>
    </div>
    <div class="fg-row" style="margin-bottom:12px">
      <div class="fg"><label class="fl">기업 (국문)</label><input class="fi" id="ce-org" value="${escapeHtml(c.orgKo||'')}"></div>
      <div class="fg"><label class="fl">기업 (영문)</label><input class="fi" id="ce-orgEn" value="${escapeHtml(c.orgEn||'')}"></div>
    </div>
    <div class="fg-row" style="margin-bottom:12px">
      <div class="fg"><label class="fl">국가</label>
        <select class="fi" id="ce-country">${countryOptions(c.country)}</select>
      </div>
      <div class="fg"><label class="fl">카테고리</label>
        <select class="fi" id="ce-cat">
          ${c.cat && !CAT_KEYS.includes(c.cat) ? `<option value="${escapeHtml(c.cat)}" selected>${escapeHtml(CL[c.cat] || c.cat)} (목록에서 내림)</option>` : ''}
          ${CAT_KEYS.map(k=>`<option value="${k}"${c.cat===k?' selected':''}>${CL[k]}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="sec-t" style="margin:16px 0 8px">직함 / 부서</div>
    <div class="fg-row" style="margin-bottom:12px">
      <div class="fg"><label class="fl">직함 (국문)</label><input class="fi" id="ce-titleKo" value="${escapeHtml(c.titleKo||'')}"></div>
      <div class="fg"><label class="fl">직함 (영문)</label><input class="fi" id="ce-titleEn" value="${escapeHtml(c.titleEn||'')}"></div>
    </div>
    <div class="fg-row" style="margin-bottom:12px">
      <div class="fg"><label class="fl">부서 (국문)</label><input class="fi" id="ce-deptKo" value="${escapeHtml(c.deptKo||'')}"></div>
      <div class="fg"><label class="fl">부서 (영문)</label><input class="fi" id="ce-deptEn" value="${escapeHtml(c.deptEn||'')}"></div>
    </div>

    <div id="ce-beat-field">
      <div class="sec-t" style="margin:16px 0 8px">업종 메모</div>
      <div class="fg" style="margin-bottom:12px">
        <label class="fl">업종 메모 (자유 입력)</label>
        <input class="fi" id="ce-beat" value="${escapeHtml(c.beat||'')}" placeholder="예: Pharma, Biotech, Digital Health 등">
        <div style="font-size:var(--fs-10);color:var(--i4);margin-top:3px">
          적어 두는 메모일 뿐, 왼쪽 «분야별 보기»와는 다릅니다 — 그건 아래
          소속 기업의 섹터에서 정해져요.</div>
      </div>
    </div>

    ${contactSectorField(c)}

    <div id="ce-products-field">
      <div class="sec-t" style="margin:16px 0 8px">전시 품목</div>
      <div class="fg" style="margin-bottom:12px">
        <label class="fl">제품/품목</label>
        <input class="fi" id="ce-products" value="${escapeHtml(c.products||'')}" placeholder="예: AI 카메라, 스마트 센서 등">
      </div>
    </div>

    <div class="sec-t" style="margin:16px 0 8px">메모</div>
    <div class="fg" style="margin-bottom:8px">
      <label class="fl">메모 1</label>
      <input class="fi" id="ce-memo1" value="${escapeHtml(c.memo1||'')}" placeholder="기본 항목에 없는 값 (예: 회원번호)">
    </div>
    <div class="fg-row" style="margin-bottom:12px">
      <div class="fg"><label class="fl">메모 2</label><input class="fi" id="ce-memo2" value="${escapeHtml(c.memo2||'')}"></div>
      <div class="fg"><label class="fl">메모 3</label><input class="fi" id="ce-memo3" value="${escapeHtml(c.memo3||'')}"></div>
    </div>

    <div class="sec-t" style="margin:16px 0 8px">연락처</div>
    <div class="fg-row" style="margin-bottom:8px">
      <div class="fg"><label class="fl">이메일 1</label><input class="fi" id="ce-email1" value="${escapeHtml(c.email1||'')}" placeholder="email@example.com"></div>
      <div class="fg"><label class="fl">이메일 2</label><input class="fi" id="ce-email2" value="${escapeHtml(c.email2||'')}" placeholder="선택사항"></div>
    </div>
    <div class="fg-row" style="margin-bottom:12px">
      <div class="fg"><label class="fl">연락처 1</label><input class="fi" id="ce-phone1" value="${escapeHtml(c.phone1||'')}" placeholder="+82-10-0000-0000"></div>
      <div class="fg"><label class="fl">연락처 2</label><input class="fi" id="ce-phone2" value="${escapeHtml(c.phone2||'')}" placeholder="선택사항"></div>
    </div>

    <div style="display:flex;gap:8px;margin-top:18px">
      <button class="btn bs" onclick="cancelContactEdit()" style="flex:1;justify-content:center">취소</button>
      <button class="btn bp bs" onclick="saveContactEdit()" style="flex:1;justify-content:center">저장</button>
    </div>
  `;
}

/* 원본 5938~5991행 */
export async function saveContactEdit(){
  const c = contacts.find(x => x.id === conDrId);
  if(!c) return;

  // 이름이 전부 비면 저장 거부 (기존엔 빈 이름도 저장됐음)
  const _nameKo = document.getElementById('ce-name').value.trim();
  const _nameEn = document.getElementById('ce-nameEn').value.trim();
  if(!_nameKo && !_nameEn){ alert('이름(한글 또는 영문)을 입력해주세요.'); return; }

  const prev = { ...c }; // 저장 실패 시 롤백용 스냅샷

  c.nameKo  = document.getElementById('ce-name').value.trim();
  c.nameEn  = document.getElementById('ce-nameEn').value.trim();
  c.orgKo   = document.getElementById('ce-org').value.trim();
  c.orgEn   = document.getElementById('ce-orgEn').value.trim();
  c.country = document.getElementById('ce-country').value;
  c.cat     = document.getElementById('ce-cat').value;
  c.titleKo = document.getElementById('ce-titleKo').value.trim();
  c.titleEn = document.getElementById('ce-titleEn').value.trim();
  c.deptKo  = document.getElementById('ce-deptKo').value.trim();
  c.deptEn  = document.getElementById('ce-deptEn').value.trim();
  c.email1  = document.getElementById('ce-email1').value.trim();
  c.email2  = document.getElementById('ce-email2').value.trim();
  c.phone1  = document.getElementById('ce-phone1').value.trim();
  c.phone2  = document.getElementById('ce-phone2').value.trim();

  // 카테고리별 전용 필드
  const beatEl = document.getElementById('ce-beat');
  const productsEl = document.getElementById('ce-products');
  c.beat     = beatEl ? beatEl.value : (c.beat||'');
  c.products = productsEl ? productsEl.value.trim() : (c.products||'');

  // 기본 항목에 없는 값을 담아 두는 자유 칸 세 개
  ['memo1','memo2','memo3','prefix'].forEach(k => {
    const el = document.getElementById('ce-' + k);
    if(el) c[k] = el.value.trim();
  });

  /* 소속을 바꿨으면 기업 연결(org_id)도 새 소속을 따라가야 한다 — patchContact와
     같은 이유다. 안 그러면 이름은 새 회사인데 기업DB·섹터는 옛 회사에 매달린다.
     섹터 저장이 org_id를 보므로 그보다 먼저 한다. */
  if((c.orgKo !== prev.orgKo || c.orgEn !== prev.orgEn) && (c.orgKo || c.orgEn)){
    const nm = (c.orgKo || c.orgEn).trim();
    try {
      await ensureOrgsForNames([nm]);
      const oid = orgIdForName(nm);
      if(oid) c.org_id = oid;
    } catch(e){ console.warn('[db-tab] 기업 재연결 실패:', e); }
  }

  /* 섹터는 기업에 저장된다 — 연락처 저장과 별개의 길이라 따로 부른다 */
  try { saveContactSectorField(c); } catch(e){ console.warn('[db-tab] 섹터 반영 실패:', e); }

  conEditMode = false;
  renderContactDr();
  try { renderMDB(); } catch(e){}

  // 구글시트 동기화 — upsert (id 일치 행 덮어쓰기). 실패 시 편집 전 상태로 롤백
  const r = await postToSheet({
    sheet:  'contacts',
    action: 'upsert',
    /* 바꾼 칸만 보낸다(org_id 포함) — 통째로 올리면 편집 창을 연 사이 남이 고친 칸을
       내 옛 값으로 되돌린다 */
    data: contactPatch(c, prev),
  }, '연락처 수정');
  if(!r.ok){
    Object.assign(c, prev);
    renderContactDr();
    try { renderMDB(); } catch(e){}
    return;
  }
  trackAction('status', '연락처 정보 수정', personName(c),
    '<b>' + escapeHtml(personName(c)) + '</b>의 정보를 수정했어요',
    changed('contacts', c.id, prev, pickChanged(prev, c), { kind: 'contact', id: c.id }));
}

/* ══════════════════════════════════════════
   연락처 직접 추가 모달 (원본 6121~6252행)
══════════════════════════════════════════ */
export function openAddContactModal(){
  const pick = currentCoSectorPick();
  const catOpts = CAT_KEYS.map(k =>
    `<option value="${k}">${CL[k]}</option>`).join('');
  const countryOpts = COUNTRIES.map(c =>
    `<option value="${c.nameKo}">${c.nameKo}</option>`).join('');

  const html = `
    <div id="add-contact-modal" onclick="if(event.target===this)closeAddContactModal()"
      style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px">
      <div style="background:var(--W);border-radius:var(--rd-14);padding:24px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.2)">
        <div style="font-size:var(--fs-15);font-weight:700;color:var(--i1);margin-bottom:18px">연락처 추가</div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div><div class="mlbl">이름 (한글)</div>
            <input class="fi" id="ac-nameKo" placeholder="홍길동" style="width:100%"></div>
          <div><div class="mlbl">이름 (영문)</div>
            <input class="fi" id="ac-nameEn" placeholder="Gildong Hong" style="width:100%"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div><div class="mlbl">소속 (한글)</div>
            <input class="fi" id="ac-orgKo" placeholder="한국바이오협회" style="width:100%"></div>
          <div><div class="mlbl">소속 (영문)</div>
            <input class="fi" id="ac-orgEn" placeholder="Korea Bio Association" style="width:100%"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div><div class="mlbl">직함 (한글)</div>
            <input class="fi" id="ac-titleKo" placeholder="팀장" style="width:100%"></div>
          <div><div class="mlbl">직함 (영문)</div>
            <input class="fi" id="ac-titleEn" placeholder="Team Leader" style="width:100%"></div>
        </div>
        <div class="ac-contact-row" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
          <div><div class="mlbl">이메일</div>
            <input class="fi" id="ac-email1" placeholder="name@company.com" style="width:100%"></div>
          <div><div class="mlbl">전화번호</div>
            <input class="fi" id="ac-phone1" placeholder="010-0000-0000" style="width:100%"></div>
          <div><div class="mlbl">국가</div>
            <select class="fi" id="ac-country" style="width:100%">
              <option value="대한민국">대한민국</option>
              ${countryOpts}
            </select></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
          <div><div class="mlbl">카테고리</div>
            <select class="fi" id="ac-cat" style="width:100%">
              ${catOpts}
            </select></div>
          <div><div class="mlbl">들어온 경로 <span style="font-weight:400;color:var(--i4)">— 메모</span></div>
            <input class="fi" id="ac-source" placeholder="예: 명함, 행사 등록" value="직접 입력" style="width:100%"></div>
        </div>
        <!-- 출처는 사람마다 하나, 바뀌지 않는다(docs/manual-db-axes.md) — 넣을 때 정해 둔다 -->
        <div style="margin:-6px 0 16px"><div class="mlbl">출처</div>
          <select class="fi" id="ac-origin" style="width:100%">
            <option value="">— 고르지 않음 —</option>
            ${CONTACT_ORIGINS.map(o => `<option value="${o.key}">${o.label} — ${o.desc}</option>`).join('')}
          </select></div>

        <!-- 소속이 아직 기업DB에 없으면 여기서 만들어진다. 그때 섹터를 함께
             넣어 두지 않으면 미분류로 떨어져, 나중에 기업DB에서 다시 찾아
             붙여야 한다 — 사람을 넣는 자리에서 같이 정한다. -->
        <div style="border:1px solid var(--i6);border-radius:var(--r);padding:10px 12px;margin-bottom:16px;background:var(--i9)">
        <div style="font-size:var(--fs-11);font-weight:700;color:var(--i3);margin-bottom:8px">소속 기업 분류 <span style="font-weight:400;color:var(--i4)">— 기업DB에 없는 소속이면 새 기업에 붙어요</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><div class="mlbl">분야 <span style="font-weight:400;color:var(--i4)">— 큰 갈래</span></div>
            <select class="fi" id="ac-domain" style="width:100%" onchange="onAddContactDomainChange()">
              ${coDomainOptionsHtml(pick.domain)}
            </select></div>
          <div><div class="mlbl">섹터 <span style="font-weight:400;color:var(--i4)">— 분야 안 세부</span></div>
            <select class="fi" id="ac-sector" style="width:100%">
              ${coSectorOptionsHtml(pick.domain, pick.sector)}
            </select></div>
        </div>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn bs" onclick="closeAddContactModal()">취소</button>
          <button class="btn bp" id="ac-save-btn" onclick="saveNewContact()">저장</button>
        </div>
        <div id="ac-msg" style="font-size:var(--fs-11);text-align:right;margin-top:8px;height:14px"></div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

export function closeAddContactModal(){
  document.getElementById('add-contact-modal')?.remove();
}

export async function saveNewContact(){
  const get = id => (document.getElementById(id)||{}).value?.trim()||'';
  const nameKo = get('ac-nameKo');
  const nameEn = get('ac-nameEn');
  const msg    = document.getElementById('ac-msg');

  if(!nameKo && !nameEn){
    if(msg){msg.style.color='var(--re)';msg.textContent='이름을 입력해주세요.';}
    return;
  }

  const btn = document.getElementById('ac-save-btn');
  if(btn){ btn.disabled=true; btn.textContent='저장 중…'; }

  const newId = nextContactId();   // 규칙 하나로(CLAUDE.md) — 무작위는 남의 연락처와 겹쳐 덮을 수 있었다
  const today = td();

  const c = {
    id:      newId,
    nameKo:  nameKo,
    nameEn:  nameEn,
    orgKo:   get('ac-orgKo'),
    orgEn:   get('ac-orgEn'),
    titleKo: get('ac-titleKo'),
    titleEn: get('ac-titleEn'),
    deptKo:  '', deptEn: '',
    country: get('ac-country') || '대한민국',
    cat:     get('ac-cat')     || 'attendee',
    lang:    nameKo ? 'KO' : 'EN',
    source:  get('ac-source')  || '직접 입력',
    date:    today,
    status:  'new',
    email1:  get('ac-email1'),
    email2:  '',
    phone1:  get('ac-phone1'),
    phone2:  '',
    beat:    '',
    products:'',
    origin:  get('ac-origin'),
  };

  /* 소속을 적었으면 그 기업이 있는지 보고 없으면 만든다.
     기업은 이제 연락처에서 파생되지 않으므로, 여기서 만들어 두지 않으면
     연락처만 생기고 기업DB에는 나타나지 않는다. */
  const orgNm = c.orgKo || c.orgEn;
  if(orgNm){
    try {
      const sector = get('ac-sector');
      await ensureOrgsForNames([orgNm], undefined, sector ? { [orgNm]: sector } : null);
      c.org_id = orgIdForName(orgNm) || '';
    } catch(e){ console.warn('[db-tab] 기업 연결 실패:', e); }
  }

  // 로컬 추가
  contacts.push(c);
  try { buildCoDB(); renderMDB(); buildMDBEvList(); } catch(e){}

  // 구글시트 저장 — 실패 시 로컬 추가도 롤백 (기존엔 로컬에 남아 새로고침 시 증발)
  const r = await postToSheet({
    sheet: 'contacts',
    row: [c.id,c.nameKo,c.nameEn,c.orgKo,c.orgEn,c.titleKo,c.titleEn,c.deptKo,c.deptEn,
          c.country,c.cat,c.lang,c.source,c.date,c.status,c.email1,c.email2,c.phone1,c.phone2,
          c.beat,c.products,c.tags||'',c.org_id||'','','','','','','',c.origin||''],
  }, '연락처 추가', { silent: true });
  if(!r.ok){
    const idx = contacts.findIndex(x => x.id === c.id);
    if(idx >= 0) contacts.splice(idx, 1);
    try { buildCoDB(); renderMDB(); buildMDBEvList(); } catch(e){}
    if(btn){ btn.disabled=false; btn.textContent='저장'; }
    if(msg){msg.style.color='var(--re)';msg.textContent='저장 실패: '+(r.error||'네트워크 오류')+' — 다시 시도해주세요';}
    return;
  }
  trackAction('add','연락처 추가', c.nameKo||c.nameEn,
    `${c.nameKo||c.nameEn} / ${c.orgKo||c.orgEn} 추가`,
    { kind: 'contact', id: c.id });
  closeAddContactModal();
}

/* ══════════════════════════════════════════
   퇴사 처리

   담당자가 회사를 떠났을 때 행을 지우면 안 된다. participations는 성명·소속을
   저장하지 않고 읽을 때 연락처와 이어 붙여 만들기 때문에, 사람을 지우면 그가
   참가했던 몇 해 전 행사 명단이 통째로 빈칸이 된다. 지우는 대신 내려 둔다.

   이직을 «소속만 갈아끼우기»로 처리하면 같은 이유로 과거가 뒤틀린다 — 예전
   회사 소속으로 참가했던 행사가 전부 새 회사 이름으로 표시된다. 그래서 새
   연락처를 따로 만들고 옛 행이 그쪽을 가리키게 한다. 과거는 과거 자리에,
   지금 연락할 사람은 새 행에.
══════════════════════════════════════════ */
export function openLeaveModal(cid){
  const c = getContactById(cid);
  if(!c) return;

  const evN = contactEvents(c).length;
  /* 이 사람이 어느 전시의 «대표 담당»이면 넘겨줄 사람을 정해야 한다. 그냥
     내려버리면 그 기업은 대표 연락처가 없는 채로 남고, 아무도 모른다. */
  const primaryOf = EXH_CONTACTS.filter(x =>
    String(x.contact_id||'') === String(cid) && String(x.is_primary||'') === 'yes');

  const html = `
    <div id="leave-modal" onclick="if(event.target===this)closeLeaveModal()"
      style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px">
      <div style="background:var(--W);border-radius:var(--rd-14);padding:24px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.2)">
        <div style="font-size:var(--fs-15);font-weight:700;color:var(--i1);margin-bottom:6px">퇴사 처리</div>
        <div style="font-size:var(--fs-12);color:var(--i3);margin-bottom:16px;line-height:1.6">
          <b>${escapeHtml(c.nameKo || c.nameEn || '')}</b>${
            (c.orgKo || c.orgEn) ? ` · ${escapeHtml(c.orgKo || c.orgEn)}` : ''}<br>
          연락처를 지우지 않습니다. ${evN ? `참여한 행사 ${evN}건은 그대로 남고, ` : ''}목록에서만 내려가요.
        </div>

        ${primaryOf.length ? `
        <div style="display:flex;gap:8px;padding:10px 12px;margin-bottom:14px;border-radius:var(--r);
          background:var(--i7);border:1px solid var(--am)">
          <span>⚠</span>
          <div style="font-size:var(--fs-11_5);color:var(--i2);line-height:1.6">
            이 사람은 전시 ${primaryOf.length}건의 <b>대표 담당자</b>예요. 퇴사 처리한 뒤
            전시 탭에서 대표 담당을 다른 사람에게 넘겨주세요 — 안 넘기면 그 기업은
            대표 연락처가 빈 채로 남습니다.
          </div>
        </div>` : ''}

        <div style="margin-bottom:14px">
          <div class="mlbl">퇴사 확인일</div>
          <input class="fi" id="lv-date" type="date" value="${escapeHtml(td())}" style="width:100%">
        </div>

        <label style="display:flex;align-items:center;gap:7px;cursor:pointer;margin-bottom:10px;font-size:var(--fs-12_5);color:var(--i2)">
          <input type="checkbox" id="lv-moved" onchange="toggleLeaveMoved()">
          옮겨간 곳을 알아요
        </label>

        <div id="lv-moved-box" style="display:none;padding:12px;border-radius:var(--r);background:var(--i7);margin-bottom:14px">
          <div style="font-size:var(--fs-11);color:var(--i3);line-height:1.6;margin-bottom:10px">
            새 소속으로 연락처를 하나 만들고, 이 사람과 이어 둡니다. 예전 소속으로
            참가했던 행사 기록은 지금 이 행에 그대로 남아요.
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <div><div class="mlbl">새 기업 (국문)</div>
              <input class="fi" id="lv-orgKo" style="width:100%"></div>
            <div><div class="mlbl">새 기업 (영문)</div>
              <input class="fi" id="lv-orgEn" style="width:100%"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div><div class="mlbl">새 직함</div>
              <input class="fi" id="lv-title" value="${escapeHtml(c.titleKo||'')}" style="width:100%"></div>
            <div><div class="mlbl">새 이메일</div>
              <input class="fi" id="lv-email" style="width:100%"></div>
          </div>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn bs" onclick="closeLeaveModal()">취소</button>
          <button class="btn bp" id="lv-save-btn" onclick="confirmLeave(${c.id})">퇴사 처리</button>
        </div>
        <div id="lv-msg" style="font-size:var(--fs-11);text-align:right;margin-top:8px;height:14px"></div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

export function closeLeaveModal(){ document.getElementById('leave-modal')?.remove(); }

export function toggleLeaveMoved(){
  const on  = !!(document.getElementById('lv-moved')||{}).checked;
  const box = document.getElementById('lv-moved-box');
  if(box) box.style.display = on ? '' : 'none';
}

/* 연락처 한 건을 저장 — 퇴사 두 칸과 자유 메모 세 칸까지 실어 보낸다.
   위치 배열은 «보낸 칸까지만» 덮으므로(routes/data.js), 다른 자리에서 23칸만
   보내던 코드는 그대로 둬도 퇴사 표시나 메모가 지워지지 않는다. */
function contactRow(c){
  return [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
    c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2,
    c.beat, c.products, c.tags||'', c.org_id||'', c.left_at||'', c.moved_to_id||'',
    c.memo1||'', c.memo2||'', c.memo3||'', c.prefix||''];
}

export async function confirmLeave(cid){
  const c = getContactById(cid);
  if(!c) return;

  const date  = (document.getElementById('lv-date')||{}).value || td();
  const moved = !!(document.getElementById('lv-moved')||{}).checked;
  const get   = id => (document.getElementById(id)||{}).value?.trim() || '';
  const msg   = document.getElementById('lv-msg');
  const btn   = document.getElementById('lv-save-btn');

  let newC = null;
  if(moved){
    const orgKo = get('lv-orgKo'), orgEn = get('lv-orgEn');
    if(!orgKo && !orgEn){
      if(msg){ msg.style.color='var(--re)'; msg.textContent='옮겨간 기업 이름을 적어주세요.'; }
      return;
    }
    newC = {
      id: nextContactId(),
      nameKo: c.nameKo, nameEn: c.nameEn,
      orgKo, orgEn,
      titleKo: get('lv-title'), titleEn: '',
      deptKo: '', deptEn: '',
      country: c.country, cat: c.cat, lang: c.lang,
      /* 어디서 온 행인지 적어 둔다 — 나중에 «이 사람이 왜 둘이지»의 답이 된다 */
      source: `이직 (${c.orgKo || c.orgEn || '이전 소속'})`,
      date, status: 'pending',
      email1: get('lv-email'), email2: '',
      phone1: c.phone1, phone2: '',
      beat: c.beat||'', products: '', tags: c.tags||'',
      left_at: '', moved_to_id: '',
    };
  }

  if(btn){ btn.disabled = true; btn.textContent = '처리 중…'; }

  /* 새 소속 기업이 기업DB에 없으면 만든다 — 안 만들면 연락처만 생기고
     기업 쪽에서는 보이지 않는다(saveNewContact와 같은 이유). */
  if(newC){
    const orgNm = newC.orgKo || newC.orgEn;
    try {
      await ensureOrgsForNames([orgNm]);
      newC.org_id = orgIdForName(orgNm) || '';
    } catch(e){ console.warn('[db-tab] 기업 연결 실패:', e); }
  }

  const prev = { left_at: c.left_at||'', moved_to_id: c.moved_to_id||'' };
  c.left_at     = date;
  c.moved_to_id = newC ? String(newC.id) : '';
  if(newC) contacts.push(newC);

  try { buildCoDB(); renderMDB(); renderContactDr(); } catch(e){}

  /* 새 연락처를 먼저 저장한다 — 옛 행이 가리키는 곳이 없는 상태를 만들지 않기
     위해서. 반대 순서였다가 새 행 저장이 실패하면 moved_to_id가 허공을 가리킨다. */
  if(newC){
    const rn = await postToSheet({ sheet:'contacts', action:'upsert', row: contactRow(newC) },
      '이직 연락처 추가', { silent: true });
    if(!rn.ok){
      Object.assign(c, prev);
      const i = contacts.findIndex(x => x.id === newC.id); if(i>=0) contacts.splice(i,1);
      try { buildCoDB(); renderMDB(); renderContactDr(); } catch(e){}
      if(btn){ btn.disabled=false; btn.textContent='퇴사 처리'; }
      if(msg){ msg.style.color='var(--re)'; msg.textContent='저장 실패: '+(rn.error||'네트워크 오류'); }
      return;
    }
  }

  const r = await postToSheet({ sheet:'contacts', action:'upsert', data: contactPatch(c, prev) },
    '퇴사 처리', { silent: true });
  if(!r.ok){
    Object.assign(c, prev);
    if(newC){ const i = contacts.findIndex(x => x.id === newC.id); if(i>=0) contacts.splice(i,1); }
    try { buildCoDB(); renderMDB(); renderContactDr(); } catch(e){}
    if(btn){ btn.disabled=false; btn.textContent='퇴사 처리'; }
    if(msg){ msg.style.color='var(--re)'; msg.textContent='저장 실패: '+(r.error||'네트워크 오류'); }
    return;
  }

  trackAction('status', '퇴사 처리', c.nameKo || c.nameEn,
    `<b>${escapeHtml(c.nameKo || c.nameEn || '')}</b> 퇴사 (${escapeHtml(date)})${
      newC ? ` — ${escapeHtml(newC.orgKo || newC.orgEn)}(으)로 이직` : ''}`,
    changed('contacts', c.id, prev, { left_at: c.left_at, moved_to_id: c.moved_to_id },
      { kind: 'contact', id: c.id }));

  closeLeaveModal();
  try { renderMDB(); renderContactDr(); buildMDBEvList(); } catch(e){}
}

/* 잘못 눌렀거나 실은 아직 다니고 있을 때. 이직으로 만들어 둔 새 연락처는
   지우지 않는다 — 그쪽으로 이미 뭔가 적었을 수 있고, 지우는 건 언제든 따로 할
   수 있지만 되살리는 건 못 한다. 연결만 끊는다. */
export async function undoContactLeft(cid){
  const c = getContactById(cid);
  if(!c) return;
  const to = movedTo(c);
  if(!confirm(`${c.nameKo || c.nameEn || ''} 님의 퇴사 표시를 지울까요?${
    to ? `\n\n이직으로 만든 «${to.orgKo || to.orgEn}» 연락처는 그대로 둡니다 — 연결만 끊어요.` : ''}`)) return;

  const prev = { left_at: c.left_at||'', moved_to_id: c.moved_to_id||'' };
  c.left_at = ''; c.moved_to_id = '';
  try { renderMDB(); renderContactDr(); } catch(e){}

  const r = await postToSheet({ sheet:'contacts', action:'upsert', data: contactPatch(c, prev) }, '퇴사 표시 해제');
  if(!r.ok){
    Object.assign(c, prev);
    try { renderMDB(); renderContactDr(); } catch(e){}
    return;
  }
  trackAction('status', '퇴사 표시 해제', c.nameKo || c.nameEn,
    `<b>${escapeHtml(c.nameKo || c.nameEn || '')}</b>의 퇴사 표시를 지웠어요`,
    changed('contacts', c.id, prev, { left_at: '', moved_to_id: '' }, { kind: 'contact', id: c.id }));
}

/* 화면의 onclick이 부르는 것 — 마스터DB 탭이 아니라 이 파일이 건다 */
window.openContactDr = openContactDr;
window.setContactOrigin = setContactOrigin;
window.toggleSalesTarget = toggleSalesTarget;
window.drawerSendToRound = drawerSendToRound;
window.drawerRemoveFromRound = drawerRemoveFromRound;
window.closeContactDr = closeContactDr;
window.renderContactDr = renderContactDr;
window.startContactEdit = startContactEdit;
window.cancelContactEdit = cancelContactEdit;
window.openAddEvModal = openAddEvModal;
window.closeAddEvModal = closeAddEvModal;
window.confirmAddEv = confirmAddEv;
window.removeParticipation = removeParticipation;
window.contactViewPanel = contactViewPanel;
window.contactEditForm = contactEditForm;
window.saveContactEdit = saveContactEdit;
window.openAddContactModal = openAddContactModal;
window.closeAddContactModal = closeAddContactModal;
window.saveNewContact = saveNewContact;
window.openLeaveModal = openLeaveModal;
window.closeLeaveModal = closeLeaveModal;
window.toggleLeaveMoved = toggleLeaveMoved;
window.confirmLeave = confirmLeave;
window.undoContactLeft = undoContactLeft;
/* 분야를 바꾸면 섹터 목록을 그 분야 것만 남긴다 (기업 추가 창과 같은 동작) */
window.onAddContactDomainChange = () => {
  const d = document.getElementById('ac-domain');
  const s = document.getElementById('ac-sector');
  if(!d || !s) return;
  const keep = s.value;
  s.innerHTML = coSectorOptionsHtml(d.value, keep);
  if(sectorKey(s.value || '') !== sectorKey(keep || '')) s.value = '';
};
