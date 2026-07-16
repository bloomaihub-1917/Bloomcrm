/* ══════════════════════════════════════════════════════════════
   db-tab.js — Master DB(MDB) 탭 (원본 contact_crm.html)
   - MDB 목록/그룹/교차표 렌더 + 필터: 1745~2206행
   - 연락처 상세 드로어(열람/편집/행사참여 추가) + 연락처 직접 추가 모달: 5614~6252행
   로직/조건문은 원본과 동일, 전역변수는 state.js import로, RP2/CL2/RP3/CL3/
   ROLE_TO_CAT 중복 정의는 constants.js 단일 소스로 통합했다.
   (conEditMode 인라인 대입은 모듈 스코프에서 동작하지 않아 startContactEdit/
   cancelContactEdit 래퍼 함수 호출로 바꿨다 — 동작은 동일)
═══════════════════════════════════════════════════════════════ */

import {
  GS_URL,
  EVENT_LIST,
  contacts,
  participations,
  currentUser,
  sheetsConnected,
  PART_TYPES,
  evColor,
  evShort,
  getContactById,
  contactEvents,
  mdbEvFilter,
  mdbView,
  mdbCat,
  mdbStat,
  setMdbEvFilter,
  setMdbView,
  setMdbCat,
  setMdbStat,
} from '../state.js';
import { CP, CL, RP, ROLE_TO_CAT, COUNTRIES, avB, avF } from '../constants.js';
import { ab, countryName, countryOptions, escapeHtml, escAttr } from '../utils.js';
import { postToSheet } from '../api.js';
import { buildCoDB } from './company-tab.js';
import { trackAction } from './audit-tab.js';

/* ══════════════════════════════════════════
   행사 칩 목록 (원본 1745~1764행)
══════════════════════════════════════════ */
export function buildMDBEvList(){
  const usedEvs = EVENT_LIST.filter(e => participations.some(p => p.eventId === e.key));
  const el = document.getElementById('mdb-ev-list');
  if(!el) return;
  el.innerHTML =
    `<button class="ev-chip${!mdbEvFilter?' on':''}" onclick="setMDBEv(null)">
      <span class="ev-chip-dot" style="background:var(--i4)"></span>
      <span class="ev-chip-nm">전체 행사</span>
      <span class="ev-chip-ct">${contacts.length}명</span>
    </button>` +
    usedEvs.map(e => {
      const cnt = [...new Set(participations.filter(p=>p.eventId===e.key).map(p=>p.contactId))].length;
      return `<button class="ev-chip${mdbEvFilter===e.key?' on':''}" onclick="setMDBEv('${escAttr(e.key)}')">`+
        `<span class="ev-chip-dot" style="background:${e.color}"></span>`+
        `<span class="ev-chip-nm">${escapeHtml(e.short)}</span>`+
        `<span class="ev-chip-ct">${cnt}명</span>`+
        `</button>`;
    }).join('');
}
export function setMDBEv(ev){ setMdbEvFilter(ev); buildMDBEvList(); renderMDB(); }

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
    if(mdbCat !== 'all'){
      // "전체"와 동일하게: 연락처 자체의 cat 또는 참가 역할 둘 중 하나라도 맞으면 포함
      evParts = evParts.filter(p => {
        const c = getContactById(p.contactId);
        if(c && c.cat === mdbCat) return true;
        return ROLE_TO_CAT[p.role] === mdbCat;
      });
    }
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
    if(mdbCat !== 'all'){
      pairs = pairs.filter(({c}) => {
        if(c.cat === mdbCat) return true;
        return participations.some(p => p.contactId === c.id && ROLE_TO_CAT[p.role] === mdbCat);
      });
    }
  }

  // stat filter
  if(mdbStat) pairs = pairs.filter(({c}) => c.status === mdbStat);
  // text search
  if(q){
    const lq = q.toLowerCase();
    pairs = pairs.filter(({c}) =>
      [c.nameKo,c.nameEn,c.orgKo,c.orgEn,c.titleKo,c.titleEn].some(v => v && v.toLowerCase().includes(lq))
    );
  }
  return pairs;
}

/* ── Main render dispatcher (원본 1829~1842행) ── */
export function renderMDB(){
  const pairs = getMDBPairs();

  const ctEl = document.getElementById('db-ct');
  if(ctEl) ctEl.textContent = mdbEvFilter
    ? `${pairs.length}명 (${evShort(mdbEvFilter)})`
    : `${pairs.length}명`;

  if(mdbView==='group')  renderMDBGrouped(pairs);
  else if(mdbView==='matrix') renderMDBMatrix();
  else renderMDBFlat(pairs);

  updateMDBBadges(pairs);
}

/* 원본 1844~1876행 */
export function updateMDBBadges(pairs){
  // Cat counts
  const basePairs = (() => {
    let bp = mdbEvFilter
      ? participations.filter(p=>p.eventId===mdbEvFilter).map(p=>({c:getContactById(p.contactId),p})).filter(x=>x.c)
      : contacts.map(c=>({c,p:null}));
    if(mdbStat) bp=bp.filter(({c})=>c.status===mdbStat);
    const q=(document.getElementById('mdb-q')||{}).value||'';
    if(q){ const lq=q.toLowerCase(); bp=bp.filter(({c})=>[c.nameKo,c.nameEn,c.orgKo,c.titleKo,c.titleEn].some(v=>v&&v.toLowerCase().includes(lq))); }
    return bp;
  })();

  const cats=['all','speaker','vip','attendee'];
  const ids =['ct-all','ct-sp','ct-vip','ct-at'];
  cats.forEach((cat,i)=>{
    const el=document.getElementById(ids[i]);if(!el)return;
    if(cat==='all'){ el.textContent=[...new Set(basePairs.map(({c})=>c.id))].length; return; }
    if(mdbEvFilter){
      el.textContent=basePairs.filter(({c,p})=>(c&&c.cat===cat)||(p&&ROLE_TO_CAT[p.role]===cat)).length;
    } else {
      el.textContent=basePairs.filter(({c})=>{
        if(c.cat===cat) return true;
        return participations.some(pp=>pp.contactId===c.id&&ROLE_TO_CAT[pp.role]===cat);
      }).length;
    }
  });
  ['verified','pending','new'].forEach((s,i)=>{
    const el=document.getElementById(['ct-vf','ct-pe','ct-nw'][i]);
    if(el) el.textContent=[...new Set(basePairs.map(({c})=>c.id))].filter(id=>{
      const c=getContactById(id);return c&&c.status===s;
    }).length;
  });
}

/* ── FLAT VIEW (원본 1879~1958행) ── */
export function renderMDBFlat(pairs){
  // matrix 뷰에서 테이블이 교체됐을 경우 복원
  const tw = document.getElementById('mdb-tw');
  if(tw && !tw.querySelector('#mdb-body')){
    tw.innerHTML = '<table><thead><tr>'
      + '<th>이름</th><th>기업</th><th>국가</th><th>직함/부서</th>'
      + '<th id="mdb-th-role">카테고리</th><th>행사</th><th>연락처</th><th>수집일</th><th>상태</th>'
      + '</tr></thead><tbody id="mdb-body"></tbody></table>';
  }
  // 이 컬럼은 상황에 따라 서로 다른 값을 보여준다 — 특정 행사로 필터링하지 않았을 때는
  // 연락처의 카테고리(연사/VIP/일반참가자), 특정 행사로 필터링했을 때는 그 행사에서의
  // 참가 역할(연사/BD/바이어 등 세부 유지)이다. 헤더 제목도 그에 맞게 매번 갱신해서
  // "카테고리"라는 이름이 서로 다른 데이터를 가리키며 혼동되지 않게 한다.
  const roleTh = document.getElementById('mdb-th-role');
  if(roleTh) roleTh.textContent = mdbEvFilter ? '참가 역할' : '카테고리';

  const sm={verified:'stv',pending:'stp',new:'stn'};
  const sl={verified:'검증됨',pending:'확인 중',new:'신규'};

  const body = document.getElementById('mdb-body');
  if(!body) return;

  body.innerHTML = pairs.map(({c,p})=>{
    const gi = contacts.indexOf(c);
    const roleKey = p ? p.role : c.cat;

    const nameKo = escapeHtml(c.nameKo), nameEn = escapeHtml(c.nameEn);
    const orgKo  = escapeHtml(c.orgKo),  orgEn  = escapeHtml(c.orgEn);
    const orgTitle = escapeHtml(c.orgKo||c.orgEn||'');
    const orgEnTitle = escapeHtml(c.orgKo?(c.orgEn||''):'');

    // Events column
    let evCell = '';
    if(p){
      evCell = `<span class="ev-pill" style="background:${evColor(p.eventId)}18;color:${evColor(p.eventId)}">
        <span class="ev-pill-dot" style="background:${evColor(p.eventId)}"></span>${escapeHtml(evShort(p.eventId))}
      </span>${p.note?`<div style="font-size:10px;color:var(--i3);margin-top:3px">${escapeHtml(p.note)}</div>`:''}`;
    } else {
      const evs = contactEvents(c);
      const shown = evs.slice(0,2).map(ev=>
        `<span class="ev-pill" style="background:${evColor(ev)}18;color:${evColor(ev)};margin-bottom:2px">
          <span class="ev-pill-dot" style="background:${evColor(ev)}"></span>${escapeHtml(evShort(ev))}
        </span>`).join('');
      const more = evs.length>2?`<span class="pill p-gray">+${evs.length-2}</span>`:'';
      evCell = `<div style="display:flex;gap:3px;flex-wrap:wrap;align-items:center">${shown}${more}</div>`;
    }

    const contactCell = [c.email1, c.phone1].filter(Boolean).map(v=>`<div style="font-size:10px;color:var(--i3);white-space:nowrap">${escapeHtml(v)}</div>`).join('') || '<span style="color:var(--i6)">—</span>';

    return `<tr onclick="openContactDr(${c.id})" style="cursor:pointer">
      <td><div class="tdco">
        <div class="tdav" style="background:${avB(gi)};color:${avF(gi)}">${ab(c.nameKo||c.nameEn||"")}</div>
        <div><div class="tdnm">${c.nameKo?nameKo:nameEn}</div><div class="tdsb">${nameEn}</div></div>
      </div></td>
      <td style="max-width:200px"><div class="tdnm" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${orgTitle}">${c.orgKo?orgKo:orgEn}</div><div class="tdsb" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${orgEnTitle}">${c.orgKo?orgEn:''}</div></td>
      <td style="color:var(--i2);font-size:12px;white-space:nowrap">${escapeHtml(countryName(c.country))}</td>
      <td style="color:var(--i3);font-size:12px;max-width:170px;white-space:normal;line-height:1.4">
        <div>${escapeHtml(c.titleKo||'')}${c.titleKo&&c.titleEn?' · ':''}${escapeHtml(c.titleEn||'')}</div>
        <div style="font-size:10px;color:var(--i4);margin-top:1px">${escapeHtml(c.deptKo||'')}${c.deptKo&&c.deptEn?' · ':''}${escapeHtml(c.deptEn||'')}</div>
        ${c.beat?`<div style="font-size:10px;color:var(--te);margin-top:2px">🏭 ${escapeHtml(c.beat)}</div>`:''}
        ${c.products?`<div style="font-size:10px;color:var(--pu);margin-top:2px">📦 ${escapeHtml(c.products)}</div>`:''}
      </td>
      <td><span class="pill ${CP[roleKey]||'p-gray'}">${escapeHtml(CL[roleKey]||roleKey)}</span></td>
      <td style="max-width:200px">${evCell}</td>
      <td>${contactCell}</td>
      <td style="color:var(--i4);font-size:11px">${escapeHtml(c.date)}</td>
      <td><span style="display:flex;align-items:center;gap:5px">
        <span class="std ${sm[c.status]||'stn'}"></span>${escapeHtml(sl[c.status]||c.status)}
      </span></td>
    </tr>`;
  }).join('') || emptyStateRow();
}

/* ── 빈 상태 안내 (원본 1944~1958행) ── */
export function emptyStateRow(){
  if(contacts.length === 0){
    if(!sheetsConnected){
      return '<tr><td colspan="9" style="padding:40px 20px;text-align:center">'
        + '<div style="font-size:13px;color:var(--i3);margin-bottom:6px">📋 아직 등록된 연락처가 없어요</div>'
        + '<div style="font-size:11px;color:var(--i4)">상단 \'업로드\' 메뉴에서 파일을 추가하거나, 구글시트 연동을 확인해주세요</div>'
        + '</td></tr>';
    }
    return '<tr><td colspan="9" style="padding:40px 20px;text-align:center">'
      + '<div style="font-size:13px;color:var(--i3);margin-bottom:6px">📋 아직 등록된 연락처가 없어요</div>'
      + '<div style="font-size:11px;color:var(--i4)">상단 \'업로드\' 메뉴에서 파일을 추가해주세요</div>'
      + '</td></tr>';
  }
  return '<tr><td colspan="9" style="padding:32px;text-align:center;color:var(--i4);font-size:13px">검색 조건에 맞는 연락처가 없어요</td></tr>';
}

/* ── GROUP VIEW: 행사별 → 기업별 소그룹 (원본 1961~2132행) ── */
export function renderMDBGrouped(pairs){
  // matrix 뷰에서 테이블이 교체됐을 경우 복원
  const tw = document.getElementById('mdb-tw');
  if(tw && !tw.querySelector('#mdb-body')){
    tw.innerHTML = '<table><thead><tr>'
      + '<th>이름</th><th>기업</th><th>국가</th><th>직함/부서</th>'
      + '<th id="mdb-th-role">참가 역할</th><th>행사</th><th>연락처</th><th>수집일</th><th>상태</th>'
      + '</tr></thead><tbody id="mdb-body"></tbody></table>';
  }
  // 행사별 그룹 보기는 모든 행이 특정 행사 참가 이력을 기준으로 묶이므로,
  // 이 컬럼은 항상 "참가 역할"이다(연락처 자체의 카테고리와는 다른 값 — 위 renderMDBFlat 참고)
  const roleTh = document.getElementById('mdb-th-role');
  if(roleTh) roleTh.textContent = '참가 역할';

  const sm={verified:'stv',pending:'stp',new:'stn'};
  const sl={verified:'검증됨',pending:'확인 중',new:'신규'};

  const body = document.getElementById('mdb-body');
  if(!body) return;

  let rows = '';

  if(mdbEvFilter){
    // Group by org within this event
    const byOrg = {};
    pairs.forEach(({c,p}) => { const k=c.orgKo||c.orgEn||''; (byOrg[k]||(byOrg[k]=[])).push({c,p}); });
    const col = evColor(mdbEvFilter);

    Object.entries(byOrg).sort((a,b)=>a[0].localeCompare(b[0],'ko')).forEach(([org,members])=>{
      rows += `<tr style="pointer-events:none"><td colspan="9" style="padding:0">
        <div class="grp-hd" style="background:${col}0A;border-left:3px solid ${col}">
          <svg viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2" style="width:12px;height:12px;flex-shrink:0"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>
          <div class="grp-hd-nm">${escapeHtml(org)}</div>
          <div class="grp-hd-ct">${members.length}명</div>
        </div>
      </td></tr>`;
      members.forEach(({c,p})=>{
        const gi=contacts.indexOf(c);
        rows += `<tr>
          <td><div class="tdco">
            <div class="tdav" style="background:${avB(gi)};color:${avF(gi)}">${ab(c.nameKo||c.nameEn||"")}</div>
            <div><div class="tdnm">${escapeHtml(c.nameKo||c.nameEn)}</div><div class="tdsb">${escapeHtml(c.nameEn)}</div></div>
          </div></td>
          <td style="color:var(--i3);font-size:12px">${escapeHtml(c.titleKo||c.titleEn||'-')}</td>
          <td><span class="pill ${CP[p.role]||'p-gray'}">${escapeHtml(CL[p.role]||p.role)}</span></td>
          <td colspan="2" style="color:var(--i3);font-size:11px;font-style:italic">${escapeHtml(p.note||'')}</td>
          <td><span class="lt">${escapeHtml(c.lang)}</span></td>
          <td style="color:var(--i3);font-size:11px">${escapeHtml(c.source)}</td>
          <td style="color:var(--i4);font-size:11px">${escapeHtml(c.date)}</td>
          <td><span style="display:flex;align-items:center;gap:5px">
            <span class="std ${sm[c.status]||'stn'}"></span>${escapeHtml(sl[c.status]||c.status)}
          </span></td>
        </tr>`;
      });
    });
  } else {
    // Group by event, sub-group by org
    const usedEvs = EVENT_LIST.filter(e=>participations.some(p=>p.eventId===e.key));
    usedEvs.forEach(evObj=>{
      // Filter participations matching current cat/stat/search
      let evParts = participations.filter(p=>p.eventId===evObj.key);
      if(mdbCat!=='all'){
        evParts=evParts.filter(p=>{
          const c=getContactById(p.contactId);
          if(c&&c.cat===mdbCat) return true;
          return ROLE_TO_CAT[p.role]===mdbCat;
        });
      }
      let members = evParts.map(p=>({c:getContactById(p.contactId),p})).filter(x=>x.c);
      if(mdbStat) members=members.filter(({c})=>c.status===mdbStat);
      const q=(document.getElementById('mdb-q')||{}).value||'';
      if(q){ const lq=q.toLowerCase(); members=members.filter(({c})=>[c.nameKo,c.nameEn,c.orgKo,c.orgEn,c.titleKo,c.titleEn].some(v=>v&&v.toLowerCase().includes(lq))); }
      if(!members.length) return;

      // Event header
      rows += `<tr style="pointer-events:none"><td colspan="9" style="padding:0">
        <div class="grp-hd" style="border-left:3px solid ${evObj.color}">
          <div class="grp-hd-dot" style="background:${evObj.color}"></div>
          <div class="grp-hd-nm">${escapeHtml(evObj.key)}</div>
          <div class="grp-hd-ct">${members.length}명</div>
          <div class="grp-hd-date">${escapeHtml(evObj.date)}</div>
        </div>
      </td></tr>`;

      // Sub-group by org
      const byOrg={};
      members.forEach(m=>{ const k=m.c.orgKo||m.c.orgEn||''; (byOrg[k]||(byOrg[k]=[])).push(m); });
      Object.entries(byOrg).forEach(([org,ms])=>{
        if(ms.length>1){
          rows += `<tr style="pointer-events:none"><td colspan="9" style="padding:0">
            <div style="display:flex;align-items:center;gap:7px;padding:4px 20px 2px;background:${evObj.color}06">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px;color:var(--i4);flex-shrink:0"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
              <span style="font-size:11px;font-weight:600;color:var(--i3)">${escapeHtml(org)}</span>
              <span style="font-size:10px;color:var(--i4)">${ms.length}명</span>
            </div>
          </td></tr>`;
        }
        ms.forEach(({c,p})=>{
          const gi=contacts.indexOf(c);
          rows+=`<tr onclick="openContactDr(${c.id})" style="cursor:pointer">
            <td><div class="tdco" style="padding-left:${ms.length>1?'8px':'0'}">
              <div class="tdav" style="background:${avB(gi)};color:${avF(gi)}">${ab(c.nameKo||c.nameEn||"")}</div>
              <div><div class="tdnm">${escapeHtml(c.nameKo||c.nameEn)}</div><div class="tdsb">${escapeHtml(c.nameEn)}</div></div>
            </div></td>
            <td style="color:var(--i2);font-size:12px;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(c.orgKo||c.orgEn||'')}">${ms.length>1?'':escapeHtml(c.orgKo||c.orgEn||'')}</td>
            <td style="color:var(--i2);font-size:11px;white-space:nowrap">${escapeHtml(countryName(c.country))}</td>
            <td style="color:var(--i3);font-size:12px;max-width:140px;white-space:normal;line-height:1.4">${escapeHtml(c.titleKo||'')}${c.deptKo?(' · '+escapeHtml(c.deptKo)):''}</td>
            <td><span class="pill ${CP[p.role]||'p-gray'}">${escapeHtml(CL[p.role]||p.role)}</span></td>
            <td style="color:var(--i3);font-size:11px;font-style:italic;max-width:160px;white-space:normal">${escapeHtml(p.note||'')}</td>
            <td style="font-size:10px;color:var(--i3)">${escapeHtml(c.email1||c.phone1||'—')}</td>
            <td style="color:var(--i4);font-size:11px">${escapeHtml(c.date)}</td>
            <td><span style="display:flex;align-items:center;gap:5px">
              <span class="std ${sm[c.status]||'stn'}"></span>${escapeHtml(sl[c.status]||c.status)}
            </span></td>
          </tr>`;
        });
      });
    });

    // 미배정: 참가 이력(participations)이 전혀 없는 연락처
    const assignedIds = new Set(participations.map(p=>p.contactId));
    let unassigned = contacts.filter(c => !assignedIds.has(c.id));
    if(mdbCat!=='all') unassigned = unassigned.filter(c=>c.cat===mdbCat);
    if(mdbStat) unassigned = unassigned.filter(c=>c.status===mdbStat);
    const qU=(document.getElementById('mdb-q')||{}).value||'';
    if(qU){ const lqU=qU.toLowerCase(); unassigned = unassigned.filter(c=>[c.nameKo,c.nameEn,c.orgKo,c.orgEn,c.titleKo,c.titleEn].some(v=>v&&v.toLowerCase().includes(lqU))); }

    if(unassigned.length){
      rows += `<tr style="pointer-events:none"><td colspan="9" style="padding:0">
        <div class="grp-hd" style="border-left:3px solid var(--i5)">
          <div class="grp-hd-dot" style="background:var(--i5)"></div>
          <div class="grp-hd-nm">미배정</div>
          <div class="grp-hd-ct">${unassigned.length}명</div>
        </div>
      </td></tr>`;

      const byOrgU = {};
      unassigned.forEach(c=>{ const k=c.orgKo||c.orgEn||''; (byOrgU[k]||(byOrgU[k]=[])).push(c); });
      Object.entries(byOrgU).forEach(([org,cs])=>{
        if(cs.length>1){
          rows += `<tr style="pointer-events:none"><td colspan="9" style="padding:0">
            <div style="display:flex;align-items:center;gap:7px;padding:4px 20px 2px;background:var(--i8)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:10px;height:10px;color:var(--i4);flex-shrink:0"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
              <span style="font-size:11px;font-weight:600;color:var(--i3)">${escapeHtml(org)}</span>
              <span style="font-size:10px;color:var(--i4)">${cs.length}명</span>
            </div>
          </td></tr>`;
        }
        cs.forEach(c=>{
          const gi=contacts.indexOf(c);
          rows+=`<tr onclick="openContactDr(${c.id})" style="cursor:pointer">
            <td><div class="tdco" style="padding-left:${cs.length>1?'8px':'0'}">
              <div class="tdav" style="background:${avB(gi)};color:${avF(gi)}">${ab(c.nameKo||c.nameEn||"")}</div>
              <div><div class="tdnm">${escapeHtml(c.nameKo||c.nameEn)}</div><div class="tdsb">${escapeHtml(c.nameEn)}</div></div>
            </div></td>
            <td style="color:var(--i2);font-size:12px;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(c.orgKo||c.orgEn||'')}">${cs.length>1?'':escapeHtml(c.orgKo||c.orgEn||'')}</td>
            <td style="color:var(--i2);font-size:11px;white-space:nowrap">${escapeHtml(countryName(c.country))}</td>
            <td style="color:var(--i3);font-size:12px;max-width:140px;white-space:normal;line-height:1.4">${escapeHtml(c.titleKo||'')}${c.deptKo?(' · '+escapeHtml(c.deptKo)):''}</td>
            <td><span class="pill p-gray">미배정</span></td>
            <td style="color:var(--i3);font-size:11px;font-style:italic;max-width:160px;white-space:normal"></td>
            <td style="font-size:10px;color:var(--i3)">${escapeHtml(c.email1||c.phone1||'—')}</td>
            <td style="color:var(--i4);font-size:11px">${escapeHtml(c.date)}</td>
            <td><span style="display:flex;align-items:center;gap:5px">
              <span class="std ${sm[c.status]||'stn'}"></span>${escapeHtml(sl[c.status]||c.status)}
            </span></td>
          </tr>`;
        });
      });
    }

    if(!rows) rows='<tr><td colspan="9" style="padding:32px;text-align:center;color:var(--i4);font-size:13px">일치하는 연락처가 없어요</td></tr>';
  }
  body.innerHTML=rows;
}

/* ── MATRIX VIEW (원본 2135~2186행) ── */
export function renderMDBMatrix(){
  const usedEvs = EVENT_LIST.filter(e=>participations.some(p=>p.eventId===e.key));

  // Collect all orgs that have any participation
  const orgMap={};
  participations.forEach(p=>{
    const c=getContactById(p.contactId);if(!c)return;
    if(mdbCat!=='all'&&c.cat!==mdbCat&&ROLE_TO_CAT[p.role]!==mdbCat) return;
    const k=c.orgKo||c.orgEn||'';
    if(!orgMap[k]) orgMap[k]={};
    if(!orgMap[k][p.eventId]) orgMap[k][p.eventId]=[];
    orgMap[k][p.eventId].push({c,p});
  });
  const orgs=Object.keys(orgMap).sort((a,b)=>a.localeCompare(b,'ko'));

  const tw=document.getElementById('mdb-tw');
  if(!tw) return;

  tw.innerHTML=`<div style="overflow:auto;height:100%;position:relative">
    <table style="border-collapse:collapse;font-size:12px;min-width:max-content">
      <thead><tr>
        <th style="position:sticky;left:0;top:0;z-index:4;background:var(--i8);padding:9px 16px;text-align:left;font-size:10px;font-weight:700;color:var(--i3);border-bottom:2px solid var(--i6);border-right:2px solid var(--i6);min-width:140px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap">기업</th>
        ${usedEvs.map(e=>`
          <th style="position:sticky;top:0;z-index:3;padding:9px 12px;text-align:center;font-size:10px;font-weight:700;color:${e.color};border-bottom:2px solid var(--i6);border-right:1px solid var(--i7);min-width:130px;white-space:nowrap;background:${e.color}12;letter-spacing:.02em">
            <div>${escapeHtml(e.short)}</div>
            <div style="font-size:9px;color:var(--i4);font-weight:400;margin-top:1px">${escapeHtml(e.date)}</div>
          </th>`).join('')}
      </tr></thead>
      <tbody>
        ${orgs.map((org,oi)=>`
          <tr>
            <td style="position:sticky;left:0;z-index:2;background:var(--W);padding:10px 16px;border-bottom:1px solid var(--i7);border-right:2px solid var(--i6);font-weight:600;color:var(--i1);font-size:12px;white-space:nowrap;vertical-align:top">
              ${escapeHtml(org)}
            </td>
            ${usedEvs.map(e=>{
              const cell=orgMap[org]&&orgMap[org][e.key]||[];
              if(!cell.length) return `<td style="padding:10px 12px;border-bottom:1px solid var(--i7);border-right:1px solid var(--i7);text-align:center;color:var(--i6);font-size:16px">—</td>`;
              return `<td style="padding:8px 10px;border-bottom:1px solid var(--i7);border-right:1px solid var(--i7);background:${e.color}07;vertical-align:top">
                ${cell.map(({c,p})=>`
                  <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;white-space:nowrap">
                    <span class="pill ${CP[p.role]||'p-gray'}" style="font-size:9px;padding:1px 5px">${escapeHtml(CL[p.role]||p.role)}</span>
                    <span style="font-size:11px;color:var(--i1);font-weight:500">${escapeHtml(c.nameKo||c.nameEn)}</span>
                  </div>`).join('')}
              </td>`;
            }).join('')}
          </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

/* ── 카테고리/상태 필터 버튼 + CSV 내보내기 (원본 2188~2205행) ── */
export function filterCat(cat,btn){setMdbCat(cat);document.querySelectorAll('#sbp-mdb .s-q .nr').forEach(b=>b.classList.remove('on'));if(btn)btn.classList.add('on');segCat(cat,null);}
export function filterStat(s,btn){setMdbStat(mdbStat===s?null:s);document.querySelectorAll('#sbp-mdb .s-s .nr').forEach(b=>b.classList.remove('on'));if(mdbStat)btn.classList.add('on');renderMDB()}
export function segCat(cat,btn){setMdbCat(cat);document.querySelectorAll('.mdb-seg-b').forEach(b=>b.classList.remove('on'));if(btn)btn.classList.add('on');renderMDB();}
export function exportCSV(){
  const h=['이름','영문명','기업','영문기업','국가','직함(국)','직함(영)','부서(국)','부서(영)','카테고리','분야','전시품목','언어','이메일1','이메일2','연락처1','연락처2','출처','날짜','상태'];
  const rows=contacts.map(c=>[
    c.nameKo,c.nameEn,c.orgKo,c.orgEn,countryName(c.country),
    c.titleKo,c.titleEn,c.deptKo,c.deptEn,
    CL[c.cat]||c.cat,
    c.beat||'',
    c.products||'',
    c.lang,
    c.email1,c.email2,c.phone1,c.phone2,
    c.source,c.date,c.status
  ]);
  const csv=[h,...rows].map(r=>r.map(v=>`"${(v||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,﻿'+encodeURIComponent(csv);a.download='master_db_export.csv';a.click();
}

/* ══════════════════════════════════════════
   연락처 상세 드로어 (원본 5614~6252행)
══════════════════════════════════════════ */
let conDrId = null;
let conEditMode = false;

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
  document.getElementById('con-dr-name').textContent = c.nameKo + (c.nameEn ? ' · ' + c.nameEn : '');
  document.getElementById('con-dr-meta').innerHTML =
    '<span>🏢 ' + escapeHtml(c.orgKo||c.orgEn||'-') + '</span>' +
    '<span>🌐 ' + escapeHtml(countryName(c.country)) + '</span>' +
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
      <div style="background:var(--W);border-radius:12px;padding:22px;width:340px;box-shadow:0 8px 32px rgba(0,0,0,.18)">
        <div style="font-size:14px;font-weight:700;color:var(--i1);margin-bottom:16px">참여 행사 추가</div>

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
  trackAction('edit', '행사 추가', ev, `${contacts.find(x=>x.id===cid)?.nameKo||cid} → ${ev} (${role})`);
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
    trackAction('edit', '행사 삭제', ev, `${contacts.find(x=>x.id===cid)?.nameKo||cid} ← ${ev} 제거`);
  }
}

/* 원본 5783~5865행 */
export function contactViewPanel(c){
  const evs = contactEvents(c);
  return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      <button class="btn bp bs" onclick="startContactEdit()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        편집
      </button>
    </div>

    <div class="sct">기본 정보</div>
    <div class="ig">
      <div class="ic"><div class="il">기업</div><div class="iv">${escapeHtml(c.orgKo)||'-'}</div></div>
      <div class="ic"><div class="il">영문 기업</div><div class="iv">${escapeHtml(c.orgEn)||'-'}</div></div>
      <div class="ic"><div class="il">국가</div><div class="iv">${escapeHtml(countryName(c.country))}</div></div>
      <div class="ic"><div class="il">카테고리</div><div class="iv"><span class="pill ${CP[c.cat]||'p-gray'}">${CL[c.cat]||c.cat}</span></div></div>
    </div>

    <div class="sct" style="margin-top:14px">직함 / 부서</div>
    <div class="ig">
      <div class="ic"><div class="il">직함 (국문)</div><div class="iv">${escapeHtml(c.titleKo)||'-'}</div></div>
      <div class="ic"><div class="il">직함 (영문)</div><div class="iv">${escapeHtml(c.titleEn)||'-'}</div></div>
      <div class="ic"><div class="il">부서 (국문)</div><div class="iv">${escapeHtml(c.deptKo)||'-'}</div></div>
      <div class="ic"><div class="il">부서 (영문)</div><div class="iv">${escapeHtml(c.deptEn)||'-'}</div></div>
    </div>

    ${c.beat ? `
    <div class="sct" style="margin-top:14px">분야</div>
    <div class="ig">
      <div class="ic"><div class="il">분야</div><div class="iv"><span class="pill p-teal">${escapeHtml(c.beat)}</span></div></div>
    </div>` : ''}

    ${c.products ? `
    <div class="sct" style="margin-top:14px">전시 품목</div>
    <div class="ig">
      <div class="ic" style="grid-column:span 2"><div class="il">제품/품목</div><div class="iv">${escapeHtml(c.products)||'-'}</div></div>
    </div>` : ''}

    <div class="sct" style="margin-top:14px">연락처</div>
    <div class="ig">
      <div class="ic"><div class="il">이메일 1</div><div class="iv">${c.email1?`<a href="mailto:${escapeHtml(c.email1)}" style="color:var(--a);text-decoration:none">${escapeHtml(c.email1)}</a>`:'-'}</div></div>
      <div class="ic"><div class="il">이메일 2</div><div class="iv">${c.email2?`<a href="mailto:${escapeHtml(c.email2)}" style="color:var(--a);text-decoration:none">${escapeHtml(c.email2)}</a>`:'-'}</div></div>
      <div class="ic"><div class="il">연락처 1</div><div class="iv">${escapeHtml(c.phone1)||'-'}</div></div>
      <div class="ic"><div class="il">연락처 2</div><div class="iv">${escapeHtml(c.phone2)||'-'}</div></div>
    </div>

    <div class="sct" style="margin-top:14px;display:flex;align-items:center;justify-content:space-between">
      <span>참여 행사</span>
      <button class="btn bs" style="font-size:11px;padding:3px 8px" onclick="openAddEvModal(${c.id})">
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
            ${role ? `<span class="pill ${roleClass}" style="font-size:10px;padding:1px 6px;flex-shrink:0">${escapeHtml(roleLabel)}</span>` : ''}
          </span>
          <button onclick="removeParticipation(${c.id},'${escAttr(partId)}','${escAttr(ev)}')"
            style="background:none;border:none;cursor:pointer;color:var(--i4);padding:2px 5px;font-size:16px;line-height:1;flex-shrink:0"
            title="삭제">×</button>
        </div>`;
      }).join('') : '<div style="font-size:12px;color:var(--i4)">참여 행사 없음</div>'}
    </div>

    <div class="sct">수집 정보</div>
    <div class="ig">
      <div class="ic"><div class="il">수집 출처</div><div class="iv" style="font-size:12px">${escapeHtml(c.source)||'-'}</div></div>
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
          ${['speaker','vip','attendee'].map(k=>`<option value="${k}"${c.cat===k?' selected':''}>${CL[k]}</option>`).join('')}
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
      <div class="sec-t" style="margin:16px 0 8px">분야</div>
      <div class="fg" style="margin-bottom:12px">
        <label class="fl">분야 (산업/업종)</label>
        <input class="fi" id="ce-beat" value="${escapeHtml(c.beat||'')}" placeholder="예: Pharma, Biotech, Digital Health 등">
      </div>
    </div>

    <div id="ce-products-field">
      <div class="sec-t" style="margin:16px 0 8px">전시 품목</div>
      <div class="fg" style="margin-bottom:12px">
        <label class="fl">제품/품목</label>
        <input class="fi" id="ce-products" value="${escapeHtml(c.products||'')}" placeholder="예: AI 카메라, 스마트 센서 등">
      </div>
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

  conEditMode = false;
  renderContactDr();
  try { renderMDB(); } catch(e){}

  // 구글시트 동기화 — upsert (id 일치 행 덮어쓰기). 실패 시 편집 전 상태로 롤백
  const r = await postToSheet({
    sheet:  'contacts',
    action: 'upsert',
    row: [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
          c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2,
          c.beat, c.products],
  }, '연락처 수정');
  if(!r.ok){
    Object.assign(c, prev);
    renderContactDr();
    try { renderMDB(); } catch(e){}
    return;
  }
  trackAction('status', '연락처 정보 수정', c.nameKo, '<b>'+c.nameKo+'</b>의 정보를 수정했어요');
}

/* ══════════════════════════════════════════
   연락처 직접 추가 모달 (원본 6121~6252행)
══════════════════════════════════════════ */
export function openAddContactModal(){
  const catOpts = ['speaker','vip','attendee'].map(k =>
    `<option value="${k}">${CL[k]}</option>`).join('');
  const countryOpts = COUNTRIES.map(c =>
    `<option value="${c.nameKo}">${c.nameKo}</option>`).join('');

  const html = `
    <div id="add-contact-modal" onclick="if(event.target===this)closeAddContactModal()"
      style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px">
      <div style="background:var(--W);border-radius:14px;padding:24px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.2)">
        <div style="font-size:15px;font-weight:700;color:var(--i1);margin-bottom:18px">연락처 추가</div>

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
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px">
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
          <div><div class="mlbl">출처</div>
            <input class="fi" id="ac-source" placeholder="예: 명함, 행사 등록" value="직접 입력" style="width:100%"></div>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn bs" onclick="closeAddContactModal()">취소</button>
          <button class="btn bp" id="ac-save-btn" onclick="saveNewContact()">저장</button>
        </div>
        <div id="ac-msg" style="font-size:11px;text-align:right;margin-top:8px;height:14px"></div>
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

  const newId = Date.now() + Math.floor(Math.random()*10000);
  const today = new Date().toISOString().slice(0,10);

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
  };

  // 로컬 추가
  contacts.push(c);
  try { buildCoDB(); renderMDB(); buildMDBEvList(); } catch(e){}

  // 구글시트 저장 — 실패 시 로컬 추가도 롤백 (기존엔 로컬에 남아 새로고침 시 증발)
  const r = await postToSheet({
    sheet: 'contacts',
    row: [c.id,c.nameKo,c.nameEn,c.orgKo,c.orgEn,c.titleKo,c.titleEn,c.deptKo,c.deptEn,
          c.country,c.cat,c.lang,c.source,c.date,c.status,c.email1,c.email2,c.phone1,c.phone2,
          c.beat,c.products],
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
    `${c.nameKo||c.nameEn} / ${c.orgKo||c.orgEn} 추가`);
  closeAddContactModal();
}

/* ══════════════════════════════════════════
   전역 노출 — 원본 HTML의 onclick/onchange="함수명(...)" 인라인 핸들러가
   찾을 수 있도록 window에 등록
══════════════════════════════════════════ */
window.buildMDBEvList = buildMDBEvList;
window.setMDBEv = setMDBEv;
window.setDBView = setDBView;
window.getMDBPairs = getMDBPairs;
window.renderMDB = renderMDB;
window.updateMDBBadges = updateMDBBadges;
window.renderMDBFlat = renderMDBFlat;
window.emptyStateRow = emptyStateRow;
window.renderMDBGrouped = renderMDBGrouped;
window.renderMDBMatrix = renderMDBMatrix;
window.filterCat = filterCat;
window.filterStat = filterStat;
window.segCat = segCat;
window.exportCSV = exportCSV;
window.openContactDr = openContactDr;
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
