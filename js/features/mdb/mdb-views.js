/* ══════════════════════════════════════════════════════════════
   features/mdb/mdb-views.js — 마스터DB 목록·카드·묶음·표 보기
   (modules/db-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { CL, CP, ROLE_TO_CAT, avB, avF } from '../../constants.js';
import { sanitizeForCsv } from '../../modules/audit-tab.js';
import { EVENT_LIST, contactEvents, contacts, evColor, evShort, getContactById, hasLeft, isConfirmedFor, mdbCat, mdbEvFilter, mdbSelected, mdbStat, participations, setMdbCat, setMdbStat, sheetsConnected, contactOrgEn } from '../../state.js';
import { ab, cleanEmail, escAttr, escapeHtml, leftPill, personName, td } from '../../utils.js';
import { mdbUi } from './mdb-ui.js';
import { applyMDBSort, contactCountryText, ctryPill, hidingLeft, isBDContact, isCLevelContact, matchesQuery, mdbFilterPairs, renderMDB, setMDBRowOrder, sortMDBBy, toggleMDBSelect, toggleMDBSelectAll } from '../../modules/db-tab.js';

/* ══════════════════════════════════════════
   모바일 카드 뷰

   가로 10칸짜리 표는 폭 375px에 들어가지 않는다. 예전에는 CSS로 표를 세로로
   펼치고 td:nth-child(n)으로 몇 칸을 감췄는데, 나중에 맨 앞에 체크박스 열이
   생기면서 칸 번호가 한 칸씩 밀려 기업명이 감춰져 버렸다. 위치로 칸을 지목하는
   방식은 열이 하나만 바뀌어도 이렇게 조용히 깨진다.

   그래서 모바일에서는 표 대신 카드를 직접 그린다. 무엇을 보여줄지 코드에
   이름으로 적혀 있어 열 순서가 바뀌어도 영향받지 않고, 좁은 화면에서 정말
   필요한 정보(기업 · 이름 · 직함 · 역할 · 행사 · 연락처)만 골라 담을 수 있다.
══════════════════════════════════════════ */
const ST_MARK  = { verified:'stv', pending:'stp', new:'stn' };
const ST_LABEL = { verified:'검증됨', pending:'확인 중', new:'신규' };

/* 행사 배지 — 카드에서는 2개까지만 보여주고 나머지는 +N으로 접는다 */
function mEvPills(c, p){
  const one = (ev) => evPill(ev, isConfirmedFor(c.id, ev));
  if(p) return one(p.eventId);
  const evs = contactEvents(c);
  return evs.slice(0, 2).map(one).join('')
    + (evs.length > 2 ? `<span class="pill p-gray">+${evs.length - 2}</span>` : '');
}

/* 연락처 한 줄 — 탭하면 바로 메일/전화로 이어지게 한다 */
function mContactLinks(c){
  const bits = [];
  const em = cleanEmail(c.email1);
  if(em) bits.push(`<a href="mailto:${escAttr(em)}" onclick="event.stopPropagation()" class="mdbc-lnk">✉ ${escapeHtml(em)}</a>`);
  if(c.phone1) bits.push(`<a href="tel:${escAttr(String(c.phone1).replace(/[^0-9+]/g, ''))}" onclick="event.stopPropagation()" class="mdbc-lnk">☎ ${escapeHtml(c.phone1)}</a>`);
  return bits.length ? `<div class="mdbc-ct">${bits.join('')}</div>` : '';
}

/* 연락처 카드 한 장.
   showOrg=false는 행사별 보기처럼 기업명이 이미 그룹 머리글에 있을 때 쓴다. */
function mdbCard(c, p, { showOrg = true } = {}){
  const gi = contacts.indexOf(c);
  const roleKey = p ? p.role : c.cat;
  const isSel = mdbSelected.has(c.id);
  const org = c.orgKo || c.orgEn || '';
  const title = [c.titleKo || c.titleEn, c.deptKo || c.deptEn].filter(Boolean).join(' · ');

  return `<div class="mdbc${isSel ? ' sel' : ''}" data-cid="${escapeHtml(String(c.id))}" onclick="openContactDr(${c.id})"
    draggable="true" ondragstart="onMDBDragStart(event,${c.id})" ondragend="onMDBDragEnd()">
    <div class="mdbc-top">
      <div class="tdav${isSel ? ' sel' : ''}" style="${isSel ? '' : `background:${avB(gi)};color:${avF(gi)}`}"
        onclick="event.stopPropagation();toggleMDBSelect(${c.id})" title="탭해서 선택/해제">${isSel ? '✓' : ab(c.nameKo || c.nameEn || '')}</div>
      <div class="mdbc-hd">
        ${showOrg && org ? `<div class="mdbc-org co-link" onclick="event.stopPropagation();openCoPeek(${c.id})" title="눌러서 기업 정보 보기">${escapeHtml(org)}<button type="button" class="co-info-btn" onclick="event.stopPropagation();openCoPeek(${c.id})">기업정보</button></div>` : ''}
        <div class="mdbc-nm"${(c.nameKo||c.nameEn) ? '' : ' style="color:var(--i5)"'}>${escapeHtml(personName(c))}${
          c.nameKo && c.nameEn ? `<span class="mdbc-en">${escapeHtml(c.nameEn)}</span>` : ''}${
          isBDContact(c) ? ' <span class="pill p-teal mdbc-tag">BD</span>' : ''}${
          isCLevelContact(c) ? ' <span class="pill p-gold mdbc-tag">C-level</span>' : ''}${leftPill(c)}</div>
        ${title ? `<div class="mdbc-ttl">${escapeHtml(title)}</div>` : ''}
      </div>
      <span class="std ${ST_MARK[c.status] || 'stn'}" title="${escapeHtml(ST_LABEL[c.status] || c.status || '')}"></span>
    </div>
    <div class="mdbc-pills">
      <span class="pill ${CP[roleKey] || 'p-gray'}">${escapeHtml(CL[roleKey] || roleKey || '미분류')}</span>
      ${contactCountryText(c) ? `<span class="pill p-gray">${escapeHtml(contactCountryText(c))}</span>` : ''}${ctryPill(c)}
      ${mEvPills(c, p)}
    </div>
    ${mContactLinks(c)}
  </div>`;
}

/* 목록 보기 — 모바일 */
function renderMDBFlatCards(pairs){
  const tw = document.getElementById('mdb-tw');
  if(!tw) return;
  pairs = applyMDBSort(pairs);
  tw.innerHTML = pairs.length
    ? `<div class="mdbc-list">${pairs.map(({ c, p }) => mdbCard(c, p)).join('')}</div>`
    : `<div class="mdbc-empty">${contacts.length ? '검색 조건에 맞는 연락처가 없어요'
        : '아직 등록된 연락처가 없어요 — 업로드 메뉴에서 파일을 추가해주세요'}</div>`;
}

/* 행사별 보기 — 모바일 */
function renderMDBGroupedCards(pairs){
  const tw = document.getElementById('mdb-tw');
  if(!tw) return;
  let html = '';

  if(mdbEvFilter){
    const byOrg = {};
    pairs.forEach(({ c, p }) => { const k = c.orgKo || c.orgEn || '(기업 미상)'; (byOrg[k] || (byOrg[k] = [])).push({ c, p }); });
    const col = evColor(mdbEvFilter);
    Object.entries(byOrg).sort((a, b) => a[0].localeCompare(b[0], 'ko')).forEach(([org, ms]) => {
      html += `<div class="mdbc-grp" style="border-left:3px solid ${col};background:${col}0A">
        <span class="mdbc-grp-nm">${escapeHtml(org)}</span><span class="mdbc-grp-ct">${ms.length}명</span></div>`;
      html += ms.map(({ c, p }) => mdbCard(c, p, { showOrg: false })).join('');
    });
  } else {
    const q = (document.getElementById('mdb-q') || {}).value || '';
    EVENT_LIST.filter(e => participations.some(p => p.eventId === e.key)).forEach(evObj => {
      let evParts = participations.filter(p => p.eventId === evObj.key);
      if(mdbCat !== 'all') evParts = evParts.filter(p => {
        const c = getContactById(p.contactId);
        return (c && c.cat === mdbCat) || ROLE_TO_CAT[p.role] === mdbCat;
      });
      let members = mdbFilterPairs(evParts.map(p => ({ c: getContactById(p.contactId), p })).filter(x => x.c));
      if(q) members = members.filter(({ c }) => matchesQuery(c, q));
      if(!members.length) return;
      html += `<div class="mdbc-grp" style="border-left:3px solid ${evObj.color};background:${evObj.color}0A">
        <span class="mdbc-grp-nm">${escapeHtml(evObj.key)}</span><span class="mdbc-grp-ct">${members.length}명</span>
        <span class="mdbc-grp-dt">${escapeHtml(evObj.date || '')}</span></div>`;
      html += members.map(({ c, p }) => mdbCard(c, p)).join('');
    });
  }

  tw.innerHTML = html ? `<div class="mdbc-list">${html}</div>`
    : '<div class="mdbc-empty">조건에 맞는 참가 이력이 없어요</div>';
}

/* ── 행사 칩 ──
   행사에 «걸려 있다»와 «참가가 정해졌다»는 다른 일이다. 둘을 같은 모양으로
   그리면, 뉴스레터만 받은 사람이 그 행사에 온 사람처럼 보인다 — 실제로
   아직 열리지도 않은 행사가 109명이 참가한 것처럼 보인 적이 있다.

   확정된 것만 색을 채우고, 타겟은 테두리만 남긴다. 한눈에 갈리되 목록에서
   사라지지는 않게 — 타겟도 그 행사의 명단이긴 하다. */
function evPill(ev, confirmed){
  const col = evColor(ev);
  const base = 'margin-bottom:2px;';
  return confirmed
    ? `<span class="ev-pill" style="${base}background:${col}18;color:${col}" title="참가 확정">
        <span class="ev-pill-dot" style="background:${col}"></span>${escapeHtml(evShort(ev))}</span>`
    : `<span class="ev-pill" style="${base}background:transparent;color:${col}99;border:1px dashed ${col}66"
        title="타겟 — 아직 참가 확정 전">
        <span class="ev-pill-dot" style="background:transparent;border:1px solid ${col}99"></span>${escapeHtml(evShort(ev))}</span>`;
}

/* ── FLAT VIEW (원본 1879~1958행) ── */
export function renderMDBFlat(pairs){
  pairs = applyMDBSort(pairs);
  // matrix/행사별 뷰에서 테이블이 교체됐을 경우(또는 체크박스 헤더가 없는
  // 다른 뷰의 헤더가 남아있는 경우) 목록 뷰용 헤더로 복원
  const tw = document.getElementById('mdb-tw');
  if(tw && !tw.querySelector('#mdb-select-all')){
    tw.innerHTML = '<table><thead><tr>'
      + '<th style="width:26px"><input type="checkbox" id="mdb-select-all" onclick="event.stopPropagation();toggleMDBSelectAll(this.checked)" title="현재 목록 전체 선택/해제"></th>'
      + '<th onclick="sortMDBBy(\'name\')" style="cursor:pointer">이름<span class="mdb-sort-ind" data-sort="name"></span></th>'
      + '<th onclick="sortMDBBy(\'org\')" style="cursor:pointer">기업<span class="mdb-sort-ind" data-sort="org"></span></th>'
      + '<th onclick="sortMDBBy(\'country\')" style="cursor:pointer">국가<span class="mdb-sort-ind" data-sort="country"></span></th>'
      + '<th onclick="sortMDBBy(\'title\')" style="cursor:pointer">직함/부서<span class="mdb-sort-ind" data-sort="title"></span></th>'
      + '<th id="mdb-th-role" onclick="sortMDBBy(\'cat\')" style="cursor:pointer"><span class="mdb-th-label">카테고리</span><span class="mdb-sort-ind" data-sort="cat"></span></th>'
      + '<th onclick="sortMDBBy(\'events\')" style="cursor:pointer">행사<span class="mdb-sort-ind" data-sort="events"></span></th>'
      + '<th onclick="sortMDBBy(\'contact\')" style="cursor:pointer">연락처<span class="mdb-sort-ind" data-sort="contact"></span></th>'
      + '<th onclick="sortMDBBy(\'date\')" style="cursor:pointer">수집일<span class="mdb-sort-ind" data-sort="date"></span></th>'
      + '<th onclick="sortMDBBy(\'status\')" style="cursor:pointer">상태<span class="mdb-sort-ind" data-sort="status"></span></th>'
      + '</tr></thead><tbody id="mdb-body"></tbody></table>';
  }
  // 이 컬럼은 상황에 따라 서로 다른 값을 보여준다 — 특정 행사로 필터링하지 않았을 때는
  // 연락처의 카테고리(연사/VIP/일반참가자), 특정 행사로 필터링했을 때는 그 행사에서의
  // 참가 역할(연사/BD/바이어 등 세부 유지)이다. 헤더 제목도 그에 맞게 매번 갱신해서
  // "카테고리"라는 이름이 서로 다른 데이터를 가리키며 혼동되지 않게 한다.
  const roleTh = document.getElementById('mdb-th-role');
  const roleThLabel = roleTh ? roleTh.querySelector('.mdb-th-label') : null;
  if(roleThLabel) roleThLabel.textContent = mdbEvFilter ? '참가 역할' : '카테고리';
  else if(roleTh) roleTh.textContent = mdbEvFilter ? '참가 역할' : '카테고리';

  const sm={verified:'stv',pending:'stp',new:'stn'};
  const sl={verified:'검증됨',pending:'확인 중',new:'신규'};

  const body = document.getElementById('mdb-body');
  if(!body) return;

  setMDBRowOrder(pairs.map(({ c }) => c.id));
  /* 줄마다 참가 표 전체를 훑으면(contactEvents·isConfirmedFor) 연락처×참가만큼 돌아 화면이 멈췄다.
     사람별 참가를 한 번 묶어 두고 쓴다 */
  const pByC = new Map();
  participations.forEach(x => { const k = String(x.contactId); if(!pByC.has(k)) pByC.set(k, []); pByC.get(k).push(x); });
  const partsOfC = (c) => pByC.get(String(c.id)) || [];
  body.innerHTML = pairs.map(({c,p})=>{
    const roleKey = p ? p.role : c.cat;

    const nameKo = escapeHtml(c.nameKo), nameEn = escapeHtml(c.nameEn);
    const orgKo  = escapeHtml(c.orgKo),  orgEn  = escapeHtml(c.orgEn);
    const orgTitle = escapeHtml(c.orgKo||c.orgEn||'');
    const orgEnTitle = escapeHtml(c.orgKo?contactOrgEn(c):'');

    // Events column
    let evCell = '';
    if(p){
      evCell = evPill(p.eventId, !!p.confirmedAt)
        + (p.note?`<div style="font-size:var(--fs-10);color:var(--i3);margin-top:3px">${escapeHtml(p.note)}</div>`:'');
    } else {
      const mine = partsOfC(c);
      const evs = [...new Set(mine.map(x => x.eventId).filter(Boolean))];
      const shown = evs.slice(0,2).map(ev => evPill(ev, mine.some(x => x.eventId === ev && !!x.confirmedAt))).join('');
      const more = evs.length>2?`<span class="pill p-gray">+${evs.length-2}</span>`:'';
      evCell = `<div style="display:flex;gap:3px;flex-wrap:wrap;align-items:center">${shown}${more}</div>`;
    }

    const contactCell = [c.email1, c.phone1].filter(Boolean).map(v=>`<div style="font-size:var(--fs-10);color:var(--i3);white-space:nowrap">${escapeHtml(v)}</div>`).join('') || '<span style="color:var(--i6)">—</span>';

    const isSel = mdbSelected.has(c.id);
    return `<tr onclick="openContactDr(${c.id})" style="cursor:pointer" class="${isSel?'row-sel':''}"
      draggable="true" ondragstart="onMDBDragStart(event,${c.id})" ondragend="onMDBDragEnd()">
      <td onclick="event.stopPropagation()" style="text-align:center"><input type="checkbox" ${isSel?'checked':''} onclick="event.stopPropagation();toggleMDBSelect(${c.id}, event)" title="Shift를 누른 채 누르면 이전에 고른 줄까지 한꺼번에"></td>
      <td><div class="tdco">
        <div class="tdav${isSel?' sel':''}" onclick="event.stopPropagation();toggleMDBSelect(${c.id}, event)" title="클릭해서 선택/해제 · Shift를 누른 채 누르면 사이 전부">${isSel?'✓':ab(c.nameKo||c.nameEn||"")}</div>
        <div><div class="tdnm"${(c.nameKo||c.nameEn) ? '' : ' style="color:var(--i5)" title="이름을 아직 모르는 줄 — 그 회사의 메인 컨택포인트예요"'}>${escapeHtml(personName(c))}${isBDContact(c)?' <span class="pill p-teal" style="font-size:var(--fs-9);padding:1px 5px">BD</span>':''}${isCLevelContact(c)?' <span class="pill p-gold" style="font-size:var(--fs-9);padding:1px 5px">C-level</span>':''}${leftPill(c)}</div><div class="tdsb">${c.nameKo && c.nameEn ? nameEn : ''}</div></div>
      </div></td>
      <td style="max-width:200px">${(c.orgKo||c.orgEn) ? `<div class="tdnm co-link" style="font-size:var(--fs-13);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${orgTitle} — 눌러서 기업 정보 보기" onclick="event.stopPropagation();openCoPeek(${c.id})">${c.orgKo?orgKo:orgEn}</div>` : ''}<div class="tdsb" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${orgEnTitle}">${(c.orgKo||c.orgEn) ? `<button type="button" class="co-info-btn lead" onclick="event.stopPropagation();openCoPeek(${c.id})">기업정보</button>` : ''}${c.orgKo?orgEn:''}</div></td>
      <td style="color:var(--i2);font-size:var(--fs-12);white-space:nowrap">${escapeHtml(contactCountryText(c))}</td>
      <td style="color:var(--i3);font-size:var(--fs-12);max-width:170px;white-space:normal;line-height:1.4">
        <div>${escapeHtml(c.titleKo||'')}${c.titleKo&&c.titleEn?' · ':''}${escapeHtml(c.titleEn||'')}</div>
        <div style="font-size:var(--fs-10);color:var(--i4);margin-top:1px">${escapeHtml(c.deptKo||'')}${c.deptKo&&c.deptEn?' · ':''}${escapeHtml(c.deptEn||'')}</div>
        ${c.beat?`<div style="font-size:var(--fs-10);color:var(--te);margin-top:2px">🏭 ${escapeHtml(c.beat)}</div>`:''}
        ${c.products?`<div style="font-size:var(--fs-10);color:var(--pu);margin-top:2px">📦 ${escapeHtml(c.products)}</div>`:''}
      </td>
      <td><span class="pill ${CP[roleKey]||'p-gray'}">${escapeHtml(CL[roleKey]||roleKey)}</span></td>
      <td style="max-width:200px">${evCell}</td>
      <td>${contactCell}</td>
      <td style="color:var(--i4);font-size:var(--fs-11)">${escapeHtml(c.date)}</td>
      <td><span style="display:flex;align-items:center;gap:5px">
        <span class="std ${sm[c.status]||'stn'}"></span>${escapeHtml(sl[c.status]||c.status)}
      </span></td>
    </tr>`;
  }).join('') || emptyStateRow();

  // 헤더 체크박스는 지금 보이는 목록이 전부 선택돼 있을 때만 체크 표시
  const selectAllEl = document.getElementById('mdb-select-all');
  if(selectAllEl){
    selectAllEl.checked = pairs.length > 0 && pairs.every(({c}) => mdbSelected.has(c.id));
  }

  // 정렬 화살표 표시 — 현재 정렬 중인 컬럼에만 방향 표시
  document.querySelectorAll('.mdb-sort-ind').forEach(el => {
    el.textContent = el.dataset.sort === mdbUi.mdbSortCol ? (mdbUi.mdbSortDir === 1 ? ' ▲' : ' ▼') : '';
  });
}

/* ── 빈 상태 안내 (원본 1944~1958행) ── */
export function emptyStateRow(){
  if(contacts.length === 0){
    if(!sheetsConnected){
      return '<tr><td colspan="10" style="padding:40px 20px;text-align:center">'
        + '<div style="font-size:var(--fs-13);color:var(--i3);margin-bottom:6px">📋 아직 등록된 연락처가 없어요</div>'
        + '<div style="font-size:var(--fs-11);color:var(--i4)">상단 \'업로드\' 메뉴에서 파일을 추가하거나, 구글시트 연동을 확인해주세요</div>'
        + '</td></tr>';
    }
    return '<tr><td colspan="10" style="padding:40px 20px;text-align:center">'
      + '<div style="font-size:var(--fs-13);color:var(--i3);margin-bottom:6px">📋 아직 등록된 연락처가 없어요</div>'
      + '<div style="font-size:var(--fs-11);color:var(--i4)">상단 \'업로드\' 메뉴에서 파일을 추가해주세요</div>'
      + '</td></tr>';
  }
  return '<tr><td colspan="10" style="padding:32px;text-align:center;color:var(--i4);font-size:var(--fs-13)">검색 조건에 맞는 연락처가 없어요</td></tr>';
}

/* ── GROUP VIEW: 행사별 → 기업별 소그룹 (원본 1961~2132행) ── */
export function renderMDBGrouped(pairs){
  // matrix 뷰에서 테이블이 교체됐거나, 목록 뷰의 체크박스 헤더가 남아있으면
  // (컬럼 수가 안 맞아 행이 밀림) 행사별 그룹 보기용 헤더로 복원
  const tw = document.getElementById('mdb-tw');
  if(tw && (!tw.querySelector('#mdb-body') || tw.querySelector('#mdb-select-all'))){
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
            <div><div class="tdnm">${escapeHtml(c.nameKo||c.nameEn)}${leftPill(c)}</div><div class="tdsb">${escapeHtml(c.nameEn)}</div></div>
          </div></td>
          <td style="color:var(--i3);font-size:var(--fs-12)">${escapeHtml(c.titleKo||c.titleEn||'-')}</td>
          <td><span class="pill ${CP[p.role]||'p-gray'}">${escapeHtml(CL[p.role]||p.role)}</span></td>
          <td colspan="2" style="color:var(--i3);font-size:var(--fs-11);font-style:italic">${escapeHtml(p.note||'')}</td>
          <td><span class="lt">${escapeHtml(c.lang)}</span></td>
          <td style="color:var(--i3);font-size:var(--fs-11)">${escapeHtml(c.source)}</td>
          <td style="color:var(--i4);font-size:var(--fs-11)">${escapeHtml(c.date)}</td>
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
      let members = mdbFilterPairs(evParts.map(p=>({c:getContactById(p.contactId),p})).filter(x=>x.c));
      const q=(document.getElementById('mdb-q')||{}).value||'';
      if(q) members = members.filter(({c}) => matchesQuery(c, q));
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
              <span style="font-size:var(--fs-11);font-weight:600;color:var(--i3)">${escapeHtml(org)}</span>
              <span style="font-size:var(--fs-10);color:var(--i4)">${ms.length}명</span>
            </div>
          </td></tr>`;
        }
        ms.forEach(({c,p})=>{
          const gi=contacts.indexOf(c);
          rows+=`<tr onclick="openContactDr(${c.id})" style="cursor:pointer">
            <td><div class="tdco" style="padding-left:${ms.length>1?'8px':'0'}">
              <div class="tdav" style="background:${avB(gi)};color:${avF(gi)}">${ab(c.nameKo||c.nameEn||"")}</div>
              <div><div class="tdnm">${escapeHtml(c.nameKo||c.nameEn)}${leftPill(c)}</div><div class="tdsb">${escapeHtml(c.nameEn)}</div></div>
            </div></td>
            <td style="color:var(--i2);font-size:var(--fs-12);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(c.orgKo||c.orgEn||'')}">${ms.length>1?'':escapeHtml(c.orgKo||c.orgEn||'')}</td>
            <td style="color:var(--i2);font-size:var(--fs-11);white-space:nowrap">${escapeHtml(contactCountryText(c))}</td>
            <td style="color:var(--i3);font-size:var(--fs-12);max-width:140px;white-space:normal;line-height:1.4">${escapeHtml(c.titleKo||'')}${c.deptKo?(' · '+escapeHtml(c.deptKo)):''}</td>
            <td><span class="pill ${CP[p.role]||'p-gray'}">${escapeHtml(CL[p.role]||p.role)}</span></td>
            <td style="color:var(--i3);font-size:var(--fs-11);font-style:italic;max-width:160px;white-space:normal">${escapeHtml(p.note||'')}</td>
            <td style="font-size:var(--fs-10);color:var(--i3)">${escapeHtml(c.email1||c.phone1||'—')}</td>
            <td style="color:var(--i4);font-size:var(--fs-11)">${escapeHtml(c.date)}</td>
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
    if(hidingLeft()) unassigned = unassigned.filter(c => !hasLeft(c));
    if(mdbCat!=='all') unassigned = unassigned.filter(c=>c.cat===mdbCat);
    if(mdbStat) unassigned = unassigned.filter(c=>c.status===mdbStat);
    const qU=(document.getElementById('mdb-q')||{}).value||'';
    if(qU) unassigned = unassigned.filter(c => matchesQuery(c, qU));

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
              <span style="font-size:var(--fs-11);font-weight:600;color:var(--i3)">${escapeHtml(org)}</span>
              <span style="font-size:var(--fs-10);color:var(--i4)">${cs.length}명</span>
            </div>
          </td></tr>`;
        }
        cs.forEach(c=>{
          const gi=contacts.indexOf(c);
          rows+=`<tr onclick="openContactDr(${c.id})" style="cursor:pointer">
            <td><div class="tdco" style="padding-left:${cs.length>1?'8px':'0'}">
              <div class="tdav" style="background:${avB(gi)};color:${avF(gi)}">${ab(c.nameKo||c.nameEn||"")}</div>
              <div><div class="tdnm">${escapeHtml(c.nameKo||c.nameEn)}${leftPill(c)}</div><div class="tdsb">${escapeHtml(c.nameEn)}</div></div>
            </div></td>
            <td style="color:var(--i2);font-size:var(--fs-12);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(c.orgKo||c.orgEn||'')}">${cs.length>1?'':escapeHtml(c.orgKo||c.orgEn||'')}</td>
            <td style="color:var(--i2);font-size:var(--fs-11);white-space:nowrap">${escapeHtml(contactCountryText(c))}</td>
            <td style="color:var(--i3);font-size:var(--fs-12);max-width:140px;white-space:normal;line-height:1.4">${escapeHtml(c.titleKo||'')}${c.deptKo?(' · '+escapeHtml(c.deptKo)):''}</td>
            <td><span class="pill p-gray">미배정</span></td>
            <td style="color:var(--i3);font-size:var(--fs-11);font-style:italic;max-width:160px;white-space:normal"></td>
            <td style="font-size:var(--fs-10);color:var(--i3)">${escapeHtml(c.email1||c.phone1||'—')}</td>
            <td style="color:var(--i4);font-size:var(--fs-11)">${escapeHtml(c.date)}</td>
            <td><span style="display:flex;align-items:center;gap:5px">
              <span class="std ${sm[c.status]||'stn'}"></span>${escapeHtml(sl[c.status]||c.status)}
            </span></td>
          </tr>`;
        });
      });
    }

    if(!rows) rows='<tr><td colspan="9" style="padding:32px;text-align:center;color:var(--i4);font-size:var(--fs-13)">일치하는 연락처가 없어요</td></tr>';
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
    <table style="border-collapse:collapse;font-size:var(--fs-12);min-width:max-content">
      <thead><tr>
        <th style="position:sticky;left:0;top:0;z-index:4;background:var(--i8);padding:9px 16px;text-align:left;font-size:var(--fs-10);font-weight:700;color:var(--i3);border-bottom:2px solid var(--i6);border-right:2px solid var(--i6);min-width:140px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap">기업</th>
        ${usedEvs.map(e=>`
          <th style="position:sticky;top:0;z-index:3;padding:9px 12px;text-align:center;font-size:var(--fs-10);font-weight:700;color:${e.color};border-bottom:2px solid var(--i6);border-right:1px solid var(--i7);min-width:130px;white-space:nowrap;background:${e.color}12;letter-spacing:.02em">
            <div>${escapeHtml(e.short)}</div>
            <div style="font-size:var(--fs-9);color:var(--i4);font-weight:400;margin-top:1px">${escapeHtml(e.date)}</div>
          </th>`).join('')}
      </tr></thead>
      <tbody>
        ${orgs.map((org,oi)=>`
          <tr>
            <td style="position:sticky;left:0;z-index:2;background:var(--W);padding:10px 16px;border-bottom:1px solid var(--i7);border-right:2px solid var(--i6);font-weight:600;color:var(--i1);font-size:var(--fs-12);white-space:nowrap;vertical-align:top">
              ${escapeHtml(org)}
            </td>
            ${usedEvs.map(e=>{
              const cell=orgMap[org]&&orgMap[org][e.key]||[];
              if(!cell.length) return `<td style="padding:10px 12px;border-bottom:1px solid var(--i7);border-right:1px solid var(--i7);text-align:center;color:var(--i6);font-size:var(--fs-16)">—</td>`;
              return `<td style="padding:8px 10px;border-bottom:1px solid var(--i7);border-right:1px solid var(--i7);background:${e.color}07;vertical-align:top">
                ${cell.map(({c,p})=>`
                  <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px;white-space:nowrap">
                    <span class="pill ${CP[p.role]||'p-gray'}" style="font-size:var(--fs-9);padding:1px 5px">${escapeHtml(CL[p.role]||p.role)}</span>
                    <span style="font-size:var(--fs-11);color:var(--i1);font-weight:500">${escapeHtml(c.nameKo||c.nameEn)}</span>
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
  const h=['경칭','이름','영문명','기업','영문기업','국가','직함(국)','직함(영)','부서(국)','부서(영)','카테고리','분야','전시품목','언어','이메일1','이메일2','연락처1','연락처2','출처','날짜','상태','태그','메모1','메모2','메모3'];
  const rows=contacts.map(c=>[
    c.prefix||'',
    c.nameKo,c.nameEn,c.orgKo,c.orgEn,contactCountryText(c),
    c.titleKo,c.titleEn,c.deptKo,c.deptEn,
    CL[c.cat]||c.cat,
    c.beat||'',
    c.products||'',
    c.lang,
    c.email1,c.email2,c.phone1,c.phone2,
    c.source,c.date,c.status,
    c.tags||'',
    c.memo1||'',c.memo2||'',c.memo3||''
  ]);
  const csv=[h,...rows].map(r=>r.map(v=>`"${sanitizeForCsv(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,﻿'+encodeURIComponent(csv);a.download='master_db_export.csv';a.click();
}

/*/* 연락처 상세 창(보기·고치기·참여 행사 추가·직접 추가·퇴사 처리)은 features/mdb/contact-drawer.js로 옮겼다.
   그 파일이 이 파일의 도우미를 쓰고, 이 파일은 그 파일을 import하지 않는다(화면의 onclick으로만 연다).
   window에 거는 것도 그 파일이 한다 — app.js가 읽는다 */

/* 화면의 onclick이 부르는 것 */
window.renderMDBFlat = renderMDBFlat;
window.emptyStateRow = emptyStateRow;
window.renderMDBGrouped = renderMDBGrouped;
window.renderMDBMatrix = renderMDBMatrix;
window.filterCat = filterCat;
window.filterStat = filterStat;
window.segCat = segCat;
window.exportCSV = exportCSV;
window.renderMDBGroupedCards = renderMDBGroupedCards;   // 탭(db-tab.js)이 window로 부른다
window.renderMDBFlatCards = renderMDBFlatCards;   // 탭(db-tab.js)이 window로 부른다
