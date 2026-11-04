/* ══════════════════════════════════════════════════════════════
   features/companies/add-co-event.js — 기업 화면에서 행사 참여 이력 직접 추가
   (modules/company-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { postToSheet } from '../../api.js';
import { batchCreateExhibitors } from '../../api/exh-save.js';
import { trackAction } from '../../core/audit-log.js';
import { buildCoDB } from '../../domain/co-db.js';
import { normalizeCompanyKey } from '../../domain/org-names.js';
import { CO_DB, EVENT_LIST, PART_TYPES, exhibitorsForEvent, participations, setSelCo } from '../../state.js';
import { escAttr, escapeHtml, td } from '../../utils.js';
import { EXH_ROLES, reloadExhibitors } from '../exhibition/exh-calc.js';
import { buildCoCAT, buildMDBEvList, renderMDB } from '../../modules/company-tab.js';
import { renderCoDetail } from './co-detail.js';


/* ══════════════════════════════════════════
   기업DB에서 행사 참여 이력 직접 추가 (원본 4461~4552행)
   participations 필드명은 api.js의 normalizeParticipationRow와 동일한
   { eventId, event, contactId, contact, role, note, matched } 형태로 push한다.
══════════════════════════════════════════ */
export function openAddCoEventModal(key){
  const c = CO_DB.find(x => x.key === key);
  if(!c) return;

  const evOpts = EVENT_LIST.length
    ? EVENT_LIST.map(e => `<option value="${e.key}">${escapeHtml(e.short||e.name)} (${e.date||''})</option>`).join('')
    : '<option value="">등록된 행사 없음</option>';
  /* 담당자를 모르는 기업도 전시에는 넣어야 한다 — 전시 참가기업은 기업 단위
     레코드라 사람이 없어도 성립한다. 그래서 "없음"을 늘 고를 수 있게 둔다.
     연사·스폰서처럼 사람 단위인 역할은 아래 저장 단계에서 막는다. */
  const contactOpts = '<option value="">— 담당자 없음 —</option>'
    + c.contacts.map(p => `<option value="${p.id}">${escapeHtml(p.name||p.nameEn||'이름없음')}${p.title?(' · '+escapeHtml(p.title)):''}</option>`).join('');
  const roleOpts = PART_TYPES.map(t => `<option value="${t.key}">${escapeHtml(t.label)}</option>`).join('');

  const html = `
    <div id="co-event-modal" onclick="if(event.target===this)document.getElementById('co-event-modal').remove()"
      style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center">
      <div style="background:var(--W);border-radius:var(--rd-12);padding:22px;width:360px;box-shadow:0 8px 32px rgba(0,0,0,.18)">
        <div style="font-size:var(--fs-14);font-weight:700;margin-bottom:4px">📅 행사 참여 이력 추가</div>
        <div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:14px">${escapeHtml(c.nameKo||c.nameEn)}</div>

        <div class="mlbl">담당자</div>
        <select class="fi" id="co-ev-add-contact" style="width:100%;margin-bottom:3px">${contactOpts}</select>
        <div style="font-size:var(--fs-10_5);color:var(--i5);margin-bottom:10px">
          전시참가기업은 담당자 없이도 등록됩니다. 연사·스폰서처럼 사람 단위 역할은 담당자가 필요해요.</div>

        <div class="mlbl">행사</div>
        <select class="fi" id="co-ev-add-event" style="width:100%;margin-bottom:10px">${evOpts}</select>

        <div class="mlbl">참가 유형</div>
        <select class="fi" id="co-ev-add-role" style="width:100%;margin-bottom:10px">${roleOpts}</select>

        <div class="mlbl">메모 (선택)</div>
        <input class="fi" id="co-ev-add-note" style="width:100%;margin-bottom:14px" placeholder="예: 부스 A12">

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn bs" onclick="document.getElementById('co-event-modal').remove()">취소</button>
          <button class="btn bp" onclick="submitAddCoEvent('${escAttr(key)}')">추가</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
}

/* 전시 참가기업 줄을 만든다. 전시 탭의 직접 추가와 같은 모양으로 넣어야
   두 화면이 같은 회사를 다르게 보지 않는다. */
async function addExhibitorFromCo(c, evId, note){
  /* CO_DB의 key는 기업 id(orgs.id)다. 그런데 exhibitors.company_key는 이름을
     눌러 만든 옛 키라 서로 다른 값이다 — 둘 다로 견줘야 중복이 안 생긴다. */
  const name = c.nameKo || c.nameEn;
  const nameKey = normalizeCompanyKey(name);
  const already = exhibitorsForEvent(evId).some(x =>
    (x.org_id && x.org_id === c.key)
    || (x.company_key && x.company_key === nameKey)
    || normalizeCompanyKey(x.company_name || '') === nameKey);
  if(already){ alert('이미 그 행사에 참가기업으로 등록돼 있어요.'); return false; }

  const rec = {
    event_id: evId, org_id: String(c.key || ''),
    company_key: nameKey, company_name: name,
    status: '준비중', note, updated_at: td(),
  };
  const r = await batchCreateExhibitors([rec]);
  if(!r.ok){ alert('전시 등록에 실패했어요. 네트워크 확인 후 다시 시도해주세요.'); return false; }
  /* 서버가 id를 만들어 주므로 저장 직후 다시 읽어 맞춘다(전시 탭과 같은 방식) */
  await reloadExhibitors();
  trackAction('add', '전시 참가기업 추가', name,
    `<b>${escapeHtml(name)}</b>를 <b>${escapeHtml(evId)}</b> 참가기업으로 추가`);
  return true;
}

/* 모달을 닫고 화면들을 다시 그린다 — 두 경로(전시만 / 참여 이력까지)가 함께 쓴다 */
function finishAddCoEvent(key, c, what){
  document.getElementById('co-event-modal')?.remove();
  buildCoDB(); buildCoCAT();
  const updated = CO_DB.find(x => x.key === key);
  if(updated){ setSelCo(key); renderCoDetail(updated); }
  try { renderMDB(); buildMDBEvList(); } catch(e){}
  try { window.renderExh?.(); } catch(e){}
  trackAction('status', '행사 참여 추가', c.nameKo || c.nameEn,
    `<b>${escapeHtml(c.nameKo || c.nameEn)}</b>에 ${escapeHtml(what)}`,
    { kind: 'company', id: key });
}

export async function submitAddCoEvent(key){
  const c = CO_DB.find(x => x.key === key);
  if(!c) return;

  const cidEl  = document.getElementById('co-ev-add-contact');
  const evEl   = document.getElementById('co-ev-add-event');
  const roleEl = document.getElementById('co-ev-add-role');
  const noteEl = document.getElementById('co-ev-add-note');

  const cid  = cidEl && cidEl.value ? +cidEl.value : null;
  const evId = evEl ? evEl.value : '';
  const role = roleEl ? roleEl.value : '참가자';
  const note = noteEl ? noteEl.value.trim() : '';

  if(!evId){ alert('행사를 선택하세요. 등록된 행사가 없으면 설정 → 행사 관리에서 먼저 추가해주세요.'); return; }

  /* ── 전시 참가기업은 기업 단위 레코드다 ──
     전시는 사람이 아니라 회사가 부스를 낸다. 그래서 담당자를 아직 모르는
     기업도 넣을 수 있어야 하는데, 참여 이력이 연락처(participations)에만
     매여 있어서 담당자가 없으면 아예 등록할 방법이 없었다.

     전시참가기업을 고르면 exhibitors에 기업 줄을 만든다 — 전시 탭이 보는
     실체가 그거다. 담당자를 함께 골랐으면 참여 이력도 같이 남긴다. */
  if(EXH_ROLES.includes(role)){
    const done = await addExhibitorFromCo(c, evId, note);
    if(!done) return;
    if(!cid){ finishAddCoEvent(key, c, `${evId} 전시 참가기업으로 등록`); return; }
  } else if(!cid){
    alert('연사·스폰서처럼 사람 단위 역할은 담당자가 필요해요.\n담당자 탭에서 먼저 추가하거나, 참가 유형을 전시참가기업으로 골라주세요.');
    return;
  }

  if(participations.some(p => p.contactId === cid && p.eventId === evId && p.role === role)){
    alert('이미 이 담당자는 해당 행사에 같은 참가 유형으로 등록되어 있어요.');
    return;
  }

  const part = {
    id: 'P-' + Date.now() + '-' + Math.floor(Math.random()*1000),
    eventId: evId, event: evId, contactId: cid, contact: '',
    role, note, matched: '✅ 앱에서 추가',
  };
  participations.push(part);

  const r = await postToSheet({
    sheet: 'participations',
    row: [part.id, evId, '', cid, '', '', '', role, note, part.matched],
  }, '참여 이력 추가');
  if(!r.ok){ // 저장 실패 → 방금 추가한 참여 기록 롤백
    const idx = participations.findIndex(p => p.id === part.id);
    if(idx >= 0) participations.splice(idx, 1);
    return;
  }

  finishAddCoEvent(key, c, '행사 참여 이력을 추가했어요');
}

/* 화면의 onclick이 부르는 것 */
window.openAddCoEventModal = openAddCoEventModal;
window.submitAddCoEvent = submitAddCoEvent;
