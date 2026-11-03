/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-add.js — 참가기업 직접 추가·불러오기
   (modules/exh-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { trackAction } from '../../core/audit-log.js';
import { normalizeCompanyKey } from '../../domain/org-names.js';
import { orgIdForName, reloadOrgs } from '../../domain/orgs.js';
import { createOrg } from '../../modules/company-tab.js';
import { EVENT_LIST, ORGS, contacts, evPartDone, exhEvent, exhibitorsForEvent, findOrgByName, getOrgById, orgName, participations, setExhEvent } from '../../state.js';
import { escapeHtml, levenshteinDist, td } from '../../utils.js';
import { EXH_ROLES, activeExhibitors, reloadExhibitors } from './exh-calc.js';
import { exhUi } from './exh-ui.js';
import { batchCreateExhibitors, buildExhEvList, exhEventOptions, exhLocked, exhNames, renderExh } from '../../modules/exh-tab.js';

/* ══════════════════════════════════════════
   참가기업 직접 추가

   불러오기는 기업DB에 이미 있는 기업만 데려온다. 행사 도중 새로 신청하는
   기업은 기업DB에도 없어서, 지금까지는 기업DB에서 먼저 만들고 연락처에
   전시참가기업 역할을 붙인 뒤 돌아와 불러와야 했다. 세 화면을 거치는 동안
   기업명 표기가 갈리기도 했다.

   그래서 한 자리에서 둘 다 만든다. 기업DB에 같은 이름이 이미 있으면 새로
   만들지 않고 그 기업에 잇는다 — 여기서 또 만들면 기업DB에 같은 회사가
   두 줄 생기고, 지난 행사 이력이 갈린다.
══════════════════════════════════════════ */
/* 기업DB 후보 찾기 — 이름을 치는 동안 이미 있는 기업을 보여준다.

   정확히 같은 이름만 봐서는 부족했다. 표기가 조금만 달라도(오타, 띄어쓰기,
   국문/영문 교차) 새 기업이 하나 더 생기고, 지난 행사 이력이 두 줄로 갈렸다.
   그래서 (a) 부분일치와 (b) 레벤슈타인 근사값까지 후보로 올린다. 자동으로
   붙이지는 않는다 — 비슷한 이름의 다른 회사도 실제로 있기 때문에, 고르는 건
   사람이 한다. */
export function findOrgCandidates(raw, limit = 6){
  const t = String(raw || '').trim();
  if(t.length < 2) return [];
  const k = normalizeCompanyKey(t);
  if(!k) return [];
  const out = [];
  for(const o of ORGS){
    const names = [o.name_ko, o.name_en, ...String(o.aliases || '').split('\n')]
      .map(n => String(n || '').trim()).filter(Boolean);
    let best = 0;
    for(const n of names){
      const nk = normalizeCompanyKey(n);
      if(!nk) continue;
      if(nk === k){ best = 1; break; }
      if(nk.includes(k) || k.includes(nk)){ best = Math.max(best, 0.9); continue; }
      const maxLen = Math.max(nk.length, k.length);
      if(maxLen < 3) continue;
      const sim = 1 - levenshteinDist(nk, k) / maxLen;
      if(sim >= 0.7) best = Math.max(best, sim);
    }
    if(best > 0) out.push({ org: o, score: best });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function openExhAdd(){
  closeExhAdd();
  if(exhLocked()){
    alert('진행 완료된 행사예요.\n설정 › 행사 관리 › 진행 파트에서 "진행 중"으로 되돌리세요.');
    return;
  }
  const pop = document.createElement('div');
  pop.id = 'exh-add-modal';
  pop.className = 'mw on';
  let downOnBg = false;
  pop.addEventListener('mousedown', (e) => { downOnBg = (e.target === pop); });
  pop.addEventListener('click', (e) => { if(e.target === pop && downOnBg) closeExhAdd(); });

  // 신청순은 다음 번호를 미리 넣어 둔다 — 새로 신청한 곳이니 대개 맨 뒤다.
  // 고칠 수 있게 열어 두는 건, 늦게 입력했지만 신청은 먼저 받은 경우가 있어서다.
  const next = Math.max(0, ...activeExhibitors(exhEvent)
    .map(x => Number(x.apply_order) || 0)) + 1;

  pop.innerHTML = `<div class="modal" style="max-width:480px">
    <div class="mh"><div class="mt2">참가기업 추가</div>
      <div class="mc">기업DB에 없는 기업도 여기서 바로 등록해요 — 기업DB에도 함께 만들어집니다</div></div>
    <div class="mb">
      <div class="fg"><label class="fl">기업명 (국문) *</label>
        <input class="fi" id="exh-add-ko" placeholder="예) 주식회사 블룸" autocomplete="off"></div>
      <div class="fg"><label class="fl">기업명 (영문)</label>
        <input class="fi" id="exh-add-en" placeholder="예) Bloom Co., Ltd." autocomplete="off"></div>
      <div class="fg"><label class="fl">국가</label>
        <input class="fi" id="exh-add-country" placeholder="비우면 국내로 봅니다" autocomplete="off"></div>
      <div class="fg"><label class="fl">신청순</label>
        <input class="fi" id="exh-add-order" value="${next}" inputmode="numeric"></div>
      <div id="exh-add-hits" style="margin:-4px 0 8px"></div>
      <div id="exh-add-msg" style="font-size:11.5px;color:var(--i4);min-height:16px"></div>
    </div>
    <div class="mf2">
      <button class="btn" onclick="closeExhAdd()">취소</button>
      <button class="btn bp" onclick="confirmExhAdd()" id="exh-add-btn">추가</button>
    </div></div>`;
  document.body.appendChild(pop);
  ['exh-add-ko', 'exh-add-en'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', renderExhAddHits);
  });
  document.getElementById('exh-add-ko')?.focus();
}

/* 고른 기업을 붙들어 둔다 — 이름을 더 고쳐도 연결은 유지된다.
   비어 있으면 "이름으로 찾기"로 돌아간다. */

export function renderExhAddHits(){
  const box = document.getElementById('exh-add-hits');
  if(!box) return;
  const v = (id) => String(document.getElementById(id)?.value || '').trim();

  if(exhUi.exhAddPickedOrg){
    const o = getOrgById(exhUi.exhAddPickedOrg);
    if(o){
      box.innerHTML = `<div style="display:flex;align-items:center;gap:8px;background:var(--bl-w,#eff6ff);border:1px solid var(--bl,#3b82f6);border-radius:8px;padding:7px 10px">
        <span style="font-size:12px;color:var(--i3)">기업DB의 <b>${escapeHtml(orgName(o))}</b>에 연결합니다</span>
        <button class="btn" style="margin-left:auto;padding:2px 8px;font-size:11px" id="exh-add-unpick">해제</button></div>`;
      document.getElementById('exh-add-unpick')?.addEventListener('click', () => {
        exhUi.exhAddPickedOrg = ''; renderExhAddHits();
      });
      return;
    }
    exhUi.exhAddPickedOrg = '';
  }

  const seen = new Set();
  const hits = [...findOrgCandidates(v('exh-add-ko')), ...findOrgCandidates(v('exh-add-en'))]
    .filter(h => !seen.has(h.org.id) && seen.add(h.org.id))
    .sort((a, b) => b.score - a.score).slice(0, 6);
  if(!hits.length){ box.innerHTML = ''; return; }

  box.innerHTML = `<div style="font-size:11px;color:var(--i4);margin-bottom:4px">기업DB에 비슷한 이름이 있어요 — 같은 곳이면 눌러서 연결하세요</div>
    <div style="display:flex;flex-direction:column;gap:4px;max-height:150px;overflow:auto">${
      hits.map(({ org: o, score }) => `<button class="btn" data-org="${escapeHtml(o.id)}"
        style="display:flex;align-items:center;gap:8px;text-align:left;padding:5px 9px;font-size:12px">
        <span style="font-weight:600">${escapeHtml(o.name_ko || o.name_en || '')}</span>
        ${o.name_ko && o.name_en ? `<span style="color:var(--i4);font-size:11px">${escapeHtml(o.name_en)}</span>` : ''}
        <span style="margin-left:auto;color:var(--i4);font-size:11px">${score >= 1 ? '같은 이름' : `${Math.round(score*100)}%`}</span>
      </button>`).join('')}</div>`;
  box.querySelectorAll('[data-org]').forEach((b) => {
    b.addEventListener('click', () => {
      const o = getOrgById(b.dataset.org);
      if(!o) return;
      exhUi.exhAddPickedOrg = o.id;
      const ko = document.getElementById('exh-add-ko'), en = document.getElementById('exh-add-en');
      if(ko && o.name_ko) ko.value = o.name_ko;
      if(en && o.name_en) en.value = o.name_en;
      renderExhAddHits();
    });
  });
}

export function closeExhAdd(){ exhUi.exhAddPickedOrg = ''; document.getElementById('exh-add-modal')?.remove(); }

export async function confirmExhAdd(){
  const v = (id) => String(document.getElementById(id)?.value || '').trim();
  const msg = document.getElementById('exh-add-msg');
  const say = (t, bad) => { if(msg){ msg.textContent = t; msg.style.color = bad ? 'var(--re)' : 'var(--i4)'; } };

  const nameKo = v('exh-add-ko'), nameEn = v('exh-add-en');
  const name = nameKo || nameEn;
  if(!name) return say('기업명을 입력해주세요.', true);

  const key = normalizeCompanyKey(name);
  const dupExh = exhibitorsForEvent(exhEvent).find(x => x.company_key === key);
  if(dupExh) return say(`이미 이 행사에 등록된 기업이에요 — ${exhNames(dupExh).ko}`, true);

  const btn = document.getElementById('exh-add-btn');
  if(btn){ btn.disabled = true; btn.textContent = '추가 중…'; }
  const fail = (t) => { if(btn){ btn.disabled = false; btn.textContent = '추가'; } say(t, true); };

  /* ① 기업DB — 같은 이름이 있으면 그 기업을 쓴다.
     createOrg는 중복이면 ok:false와 함께 그 기업(org)을 돌려준다. */
  let orgId = '';
  /* 고른 기업이 있으면 그걸 쓴다. 없으면 국문·영문 둘 다로 찾는다 —
     영문명으로만 등록된 기업에 국문명을 치면(반대도 마찬가지) 한쪽만 보던
     때는 못 찾고 같은 회사를 하나 더 만들었다. */
  const existing = (exhUi.exhAddPickedOrg && getOrgById(exhUi.exhAddPickedOrg))
    || findOrgByName(nameKo, normalizeCompanyKey)
    || findOrgByName(nameEn, normalizeCompanyKey);

  /* 이름이 똑같지는 않지만 비슷한 기업이 있으면 한 번 묻는다. 오타 하나로
     기업DB가 갈리면 지난 행사 이력이 두 줄로 흩어진다. */
  if(!existing){
    const near = [...findOrgCandidates(nameKo), ...findOrgCandidates(nameEn)]
      .filter(h => h.score < 1).slice(0, 3);
    if(near.length){
      const names = near.map(h => `· ${orgName(h.org)}`).join('\n');
      const go = confirm(`기업DB에 비슷한 이름이 있어요:\n${names}\n\n같은 곳이면 취소하고 위 목록에서 골라 연결하세요.\n정말 새 기업으로 만들까요?`);
      if(!go) return say('기업DB의 후보 중에서 골라주세요.');
    }
  }

  if(existing){
    orgId = existing.id;
    say(`기업DB에 이미 있는 «${orgName(existing)}»에 이어 붙였어요.`);
  } else {
    const r = await createOrg({
      nameKo, nameEn, kind: '전시참가기업',
      country: v('exh-add-country'),
      notes: `${exhEvent} 전시 참가기업으로 등록`,
    });
    if(!r.ok && !r.org) return fail(r.error || '기업DB 등록에 실패했어요.');
    orgId = r.ok ? r.id : r.org.id;
  }

  /* ② 전시 참가기업 — 이름은 기업DB에 넣은 그대로 쓴다. 여기서 다르게 적으면
     같은 회사가 화면마다 다른 이름으로 보인다. */
  const rec = {
    event_id: exhEvent, org_id: String(orgId || ''),
    company_key: key, company_name: nameKo || nameEn,
    status: '준비중', apply_order: v('exh-add-order'), updated_at: td(),
  };
  const res = await batchCreateExhibitors([rec]);
  if(!res.ok) return fail('전시 등록에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');

  await reloadExhibitors();
  await reloadOrgs();
  closeExhAdd();
  buildExhEvList();
  renderExh();
  trackAction('add', '전시 참가기업 추가', name,
    `<b>${escapeHtml(name)}</b>를 ${escapeHtml(exhEvent)} 참가기업으로 추가${
      existing ? ' (기업DB의 기존 기업에 연결)' : ' — 기업DB에도 새로 등록'}`);
}

/* ══════════════════════════════════════════
   참가기업 불러오기 — 트래킹 대상 확보

   participations에서 이 행사의 "전시참가기업" 역할을 뽑아 기업 단위로 묶는다.
   (CO_DB[].events는 eventId를 안 들고 있어 행사별로 되짚을 수 없다.)
══════════════════════════════════════════ */
export function exhibitorCandidates(evKey){
  const map = new Map();
  participations
    .filter(p => p.eventId === evKey && EXH_ROLES.includes(String(p.role || '').trim()))
    .forEach(p => {
      const c = contacts.find(x => String(x.id) === String(p.contactId));
      if(!c) return;
      const raw = c.orgKo || c.orgEn || '';
      if(!raw) return;
      /* 기업DB 연결 — 연락처에 붙은 org_id가 먼저, 없으면 이름(표기 차이 무시)으로 찾는다.
         CO_DB.key는 org id라 이름 키로는 늘 못 찾았고, org_id 없이 들어가 기업DB·지난 참가와 끊겼다 */
      const orgId = String(c.org_id || '') || orgIdForName(raw);
      const org = orgId ? getOrgById(orgId) : null;
      const key = orgId ? 'org:' + orgId : normalizeCompanyKey(raw);
      if(!map.has(key)){
        map.set(key, { company_key: normalizeCompanyKey((org && (org.name_ko || org.name_en)) || raw), org_id: orgId,
          company_name: (org && (org.name_ko || org.name_en)) || raw, people: [] });
      }
      const nm = c.nameKo || c.nameEn || '';
      if(nm && !map.get(key).people.includes(nm)) map.get(key).people.push(nm);
    });
  return [...map.values()].sort((a, b) => a.company_name.localeCompare(b.company_name, 'ko'));
}

export function openExhImport(){
  closeExhImport();
  const evKey = exhEvent || (EVENT_LIST[0] && EVENT_LIST[0].key) || '';
  const pop = document.createElement('div');
  pop.id = 'exh-import-modal';
  pop.className = 'mw on';
  /* 위 modalShell과 같은 이유 — 드래그 선택이 배경에서 끝나도 닫지 않는다 */
  let popDownOnBg = false;
  pop.addEventListener('mousedown', (e) => { popDownOnBg = (e.target === pop); });
  pop.addEventListener('click', (e) => { if(e.target === pop && popDownOnBg) closeExhImport(); });
  pop.innerHTML = `<div class="modal" style="max-width:560px">
    <div class="mh"><div class="mt2">참가기업 불러오기</div>
      <div class="mc">기업DB에 "전시참가기업"으로 기록된 기업을 골라 진행관리에 등록해요</div></div>
    <div class="mb">
      <div class="fg"><label class="fl">행사</label>
        <select class="fi" id="exh-imp-ev" onchange="renderExhImportList()">
          ${exhEventOptions().map(e => `<option value="${escapeHtml(e.key)}"${e.key === evKey ? ' selected' : ''}>${escapeHtml(e.name || e.key)}</option>`).join('')}
        </select></div>
      <div class="fg"><label class="fl">대상 기업</label>
        <div id="exh-imp-list" style="max-height:300px;overflow-y:auto;border:1px solid var(--i7);border-radius:8px;padding:6px"></div></div>
    </div>
    <div class="mf2">
      <button class="btn" onclick="closeExhImport()">취소</button>
      <button class="btn bp" onclick="confirmExhImport()" id="exh-imp-btn">등록</button>
    </div></div>`;
  document.body.appendChild(pop);
  renderExhImportList();
}
export function closeExhImport(){ document.getElementById('exh-import-modal')?.remove(); }

export function renderExhImportList(){
  const el = document.getElementById('exh-imp-list');
  if(!el) return;
  const evKey = document.getElementById('exh-imp-ev').value;
  const cands = exhibitorCandidates(evKey);
  const already = new Set(exhibitorsForEvent(evKey).map(x => x.company_key));
  const alreadyOrg = new Set(exhibitorsForEvent(evKey).map(x => String(x.org_id || '')).filter(Boolean));

  if(!cands.length){
    el.innerHTML = `<div style="font-size:12px;color:var(--i4);padding:14px;text-align:center">
      이 행사에 "전시참가기업" 역할로 기록된 기업이 없어요.<br>
      업로드 시 참가 역할을 전시참가기업으로 지정했는지 확인해주세요.</div>`;
    return;
  }
  el.innerHTML = cands.map((c, i) => {
    const dup = already.has(c.company_key) || (!!c.org_id && alreadyOrg.has(String(c.org_id)));
    return `<label style="display:flex;align-items:center;gap:9px;padding:6px 7px;border-radius:6px;cursor:${dup ? 'default' : 'pointer'};opacity:${dup ? .45 : 1}">
      <input type="checkbox" class="exh-imp-cb" data-i="${i}" ${dup ? 'disabled' : 'checked'}>
      <span style="font-weight:600;font-size:12px;flex:1">${escapeHtml(c.company_name)}</span>
      ${c.people.length ? `<span style="font-size:10px;color:var(--i4)">${escapeHtml(c.people.slice(0,2).join(', '))}${c.people.length > 2 ? ` 외 ${c.people.length - 2}` : ''}</span>` : ''}
      ${dup ? '<span class="pill p-gray">등록됨</span>' : ''}
    </label>`;
  }).join('');
  el._cands = cands;
}

export async function confirmExhImport(){
  const el = document.getElementById('exh-imp-list');
  const evKey = document.getElementById('exh-imp-ev').value;
  const cands = el._cands || [];
  const picked = [...document.querySelectorAll('.exh-imp-cb')]
    .filter(cb => cb.checked && !cb.disabled)
    .map(cb => cands[+cb.dataset.i]).filter(Boolean);

  if(!picked.length){ alert('등록할 기업을 선택해주세요.'); return; }
  // 여기서는 고른 행사가 지금 보고 있는 행사와 다를 수 있어 따로 본다
  if(evPartDone(evKey, 'exh')){
    alert('진행 완료된 행사에는 참가기업을 넣을 수 없어요.\n설정 › 행사 관리 › 진행 파트에서 "진행 중"으로 되돌리세요.');
    return;
  }
  const btn = document.getElementById('exh-imp-btn');
  if(btn){ btn.disabled = true; btn.textContent = '등록 중…'; }

  const rows = picked.map(c => ({
    event_id: evKey, org_id: String(c.org_id || ''), company_key: c.company_key, company_name: c.company_name,
    status: '준비중', updated_at: td(),
  }));

  const r = await batchCreateExhibitors(rows);
  if(!r.ok){
    if(btn){ btn.disabled = false; btn.textContent = '등록'; }
    alert('등록에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    return;
  }
  // 서버가 id를 만들어 주므로, 로컬 반영은 저장 직후 재조회로 맞춘다
  await reloadExhibitors();
  setExhEvent(evKey);
  closeExhImport();
  buildExhEvList();
  renderExh();
  trackAction('add', '전시 참가기업 등록', `${picked.length}개사`,
    `<b>${escapeHtml(picked.length + '개사')}</b>를 전시 진행관리에 등록했어요`);
}


/* 화면의 onclick이 부르는 것 */
window.openExhAdd = openExhAdd;
window.closeExhAdd = closeExhAdd;
window.confirmExhAdd = confirmExhAdd;
window.openExhImport = openExhImport;
window.closeExhImport = closeExhImport;
window.renderExhImportList = renderExhImportList;
window.confirmExhImport = confirmExhImport;
window.exhibitorCandidates = exhibitorCandidates;   // 탭(exh-tab.js)이 window로 부른다
