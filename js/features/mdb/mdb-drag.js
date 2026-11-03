/* ══════════════════════════════════════════════════════════════
   features/mdb/mdb-drag.js — 소속 기업·섹터·드래그로 분류
   (modules/db-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { postToSheet, upsertSectorRow } from '../../api.js';
import { CL } from '../../constants.js';
import { changed, trackAction } from '../../core/audit-log.js';
import { buildCoDB } from '../../domain/co-db.js';
import { UNASSIGNED_DOMAIN, domainName, domainOfSector, findSectorByName, mainSectors } from '../../domain/sectors.js';
import { applyCoSectors } from '../companies/co-edit.js';
import { COMPANY_SECTORS, CO_DB, contacts, getContactById, mdbSelected } from '../../state.js';
import { escapeHtml, parseSectorScope, slugifySectorName } from '../../utils.js';
import { mdbUi } from './mdb-ui.js';
import { buildMDBFilterBar, renderMDB, setMDBType } from '../../modules/db-tab.js';

/* ══════════════════════════════════════════════════════════════
   소속 기업 · 섹터 · 드래그&드롭

   왜 필요했나
   ----------
   연락처가 «분야»를 갖는 길은 하나뿐이다.

     연락처 → 소속 기업 → 그 기업의 섹터 → 섹터에 붙은 분야

   그런데 연락처 편집 화면에는 기업 «이름»만 있었다. 이름을 적어도 기업DB의
   기업과 묶이지 않으면(org_id) 사슬이 첫 칸에서 끊기고, 묶여도 그 기업에
   섹터가 없으면 두 번째 칸에서 끊긴다. 그래서 «분야로 옮길 방법이 없다»는
   말이 나온다 — 방법이 숨어 있는 게 아니라 실제로 길이 끊겨 있었다.

   여기서 그 사슬을 한 화면에서 잇는다. 그리고 목록에서 끌어다 왼쪽
   «분야»·«카테고리»에 떨어뜨리면 같은 일이 한 번에 된다.
══════════════════════════════════════════════════════════════ */

/* 이 연락처가 묶인 기업(기업DB의 줄). org_id가 먼저고, 없으면 이름으로 찾는다 */
export function coOfContact(c){
  if(!c) return null;
  if(c.org_id){
    const byId = CO_DB.find(x => String(x.org_id || x.id) === String(c.org_id));
    if(byId) return byId;
  }
  return CO_DB.find(x => (x.contacts || []).some(p => String(p.id) === String(c.id))) || null;
}

/* 연락처가 지금 속한 분야 — 사슬을 그대로 따라간다 */
export function domainsOfContact(c){
  const co = coOfContact(c);
  if(!co) return [];
  const out = new Set();
  ((co.sectors && co.sectors.length) ? co.sectors : [co.sector]).forEach(name => {
    if(!name) return;
    const sec = findSectorByName(name);
    if(sec) domainOfSector(sec).forEach(d => out.add(d));
  });
  return [...out];
}

/* 편집 화면의 «소속 기업·섹터» 칸.
   섹터는 연락처가 아니라 기업에 저장된다 — 같은 회사 사람 둘이 서로 다른
   섹터를 가질 수는 없기 때문이다. 그래서 여기서 고치면 그 회사 전체가 바뀐다는
   걸 화면에 적어 둔다. */
export function contactSectorField(c){
  const co = coOfContact(c);
  const doms = domainsOfContact(c);
  const mains = mainSectors().filter(s => !parseSectorScope(s.name).eventShort);

  if(!co){
    return `<div class="sec-t" style="margin:16px 0 8px">소속 기업 · 분야</div>
      <div style="padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;
        font-size:11.5px;color:var(--i3);line-height:1.7;margin-bottom:12px">
        아직 기업DB의 기업과 묶이지 않았어요. 분야는 <b>소속 기업의 섹터</b>에서 오기 때문에,
        묶이기 전에는 어느 분야에도 들어가지 않아요.
        <br>위 «기업 (국문)»에 이름을 적고 저장하면 기업DB에 만들어 묶어 드릴게요.
      </div>`;
  }

  return `<div class="sec-t" style="margin:16px 0 8px">소속 기업 · 분야</div>
    <div style="padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;margin-bottom:12px">
      <div style="font-size:12px;font-weight:600">${escapeHtml(co.nameKo || co.nameEn || co.key)}</div>
      <div style="font-size:10.5px;color:var(--i4);margin-top:2px">
        이 기업에 묶인 연락처 ${(co.contacts || []).length}명
      </div>
      <div class="fg" style="margin:9px 0 0">
        <label class="fl">섹터</label>
        <select class="fi" id="ce-sector">
          <option value="">미분류</option>
          ${mains.map(s => `<option value="${escapeHtml(s.name)}"${
            (co.sectors || []).includes(s.name) ? ' selected' : ''}>${escapeHtml(s.name)}${
            domainOfSector(s).length ? ` — ${escapeHtml(domainOfSector(s).map(domainName).join('·'))}` : ' — 분야 없음'}</option>`).join('')}
        </select>
        <div style="font-size:10px;color:var(--i4);margin-top:3px">
          섹터는 기업에 저장돼요 — 여기서 바꾸면 이 기업에 묶인 ${(co.contacts || []).length}명 모두가 함께 옮겨집니다.</div>
      </div>
      <div style="font-size:10.5px;color:var(--i3);margin-top:8px">
        지금 분야: <b>${doms.length ? escapeHtml(doms.map(domainName).join(' · ')) : '미분류'}</b>
      </div>
    </div>`;
}

/* 편집 저장에서 불린다 — 섹터가 바뀌었으면 기업 쪽에 반영한다 */
export function saveContactSectorField(c){
  const el = document.getElementById('ce-sector');
  if(!el) return false;
  const co = coOfContact(c);
  if(!co) return false;
  const next = el.value ? [el.value] : [];
  const cur = (co.sectors || []).filter(Boolean);
  if(next.join('|') === cur.join('|')) return false;
  applyCoSectors(co, next);
  trackAction('edit', '기업 섹터 변경', co.nameKo || co.nameEn,
    `«${co.nameKo || co.nameEn}» 섹터를 ${cur.join(', ') || '미분류'} → ${next.join(', ') || '미분류'}`,
    changed('orgs', co.key, { sector: cur.join(', ') }, { sector: next.join(', ') },
      { kind: 'company', id: co.key }));
  return true;
}

/* ══════════════════════════════════════════
   드래그 → 분야 · 카테고리에 떨어뜨리기

   카테고리는 연락처에 바로 붙는 값이라 그대로 바꾸면 된다.
   분야는 아니다 — 기업의 섹터를 타고 오므로, 어느 섹터로 보낼지를 정해야
   한다. 분야에 섹터가 하나뿐이면 묻지 않고 그것으로 보내고, 여럿이면
   고르게 한다. 우리가 대신 고르면 엉뚱한 업종에 꽂힌 걸 아무도 모른다.
══════════════════════════════════════════ */

export function onMDBDragStart(e, id){
  /* 끌기 시작한 줄이 선택돼 있으면 선택한 전부를 옮긴다 — 하나씩 끌게 하면
     스무 명을 옮길 때 스무 번 끌어야 한다. */
  mdbUi.dragIds = mdbSelected.has(id) ? [...mdbSelected] : [id];
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(id));
  document.body.classList.add('mdb-dragging');
}
export function onMDBDragEnd(){
  mdbUi.dragIds = [];
  document.body.classList.remove('mdb-dragging');
  document.querySelectorAll('.drop-on').forEach(el => el.classList.remove('drop-on'));
}
export function onMDBDragOver(e, el){
  if(!mdbUi.dragIds.length) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if(el) el.classList.add('drop-on');
}
export function onMDBDragLeave(el){ if(el) el.classList.remove('drop-on'); }

/* 카테고리로 떨어뜨리기 */
export async function onMDBDropToCat(e, cat, el){
  e.preventDefault();
  if(el) el.classList.remove('drop-on');
  const ids = mdbUi.dragIds; onMDBDragEnd();
  if(!ids.length || !cat || cat === 'all') return;

  const list = ids.map(getContactById).filter(Boolean);
  const already = list.filter(c => c.cat === cat);
  if(already.length === list.length){ return; }   // 이미 다 그 카테고리다 — 조용히 넘긴다

  const backup = list.map(c => ({ c, cat: c.cat }));
  list.forEach(c => { c.cat = cat; });
  renderMDB();

  const r = await postToSheet({
    sheet: 'contacts', action: 'batchUpsert',
    rows: list.map(c => [c.id,c.nameKo,c.nameEn,c.orgKo,c.orgEn,c.titleKo,c.titleEn,c.deptKo,c.deptEn,
      c.country,c.cat,c.lang,c.source,c.date,c.status,c.email1,c.email2,c.phone1,c.phone2,
      c.beat,c.products,c.tags||'',c.org_id||'']),
  }, '카테고리 이동(드래그)');
  if(!r.ok){
    backup.forEach(b => { b.c.cat = b.cat; });
    renderMDB();
    alert('카테고리 변경 저장에 실패해서 되돌렸어요.');
    return;
  }
  trackAction('edit', '카테고리 이동(드래그)', `${list.length}명`,
    `연락처 ${list.length}명을 «${CL[cat] || cat}»으로 옮김`,
    { table: 'contacts', op: 'update-many',
      rows: backup.map(b => ({ row: b.c.id, before: { cat: b.cat }, after: { cat } })) });
  mdbSelected.clear();
  renderMDB();
}

/* 분야로 떨어뜨리기 */
export function onMDBDropToDomain(e, domainId, el){
  e.preventDefault();
  if(el) el.classList.remove('drop-on');
  const ids = mdbUi.dragIds; onMDBDragEnd();
  if(!ids.length || !domainId || domainId === UNASSIGNED_DOMAIN) return;

  const list = ids.map(getContactById).filter(Boolean);
  /* 기업에 묶이지 않은 사람은 옮길 수 없다 — 분야는 기업의 섹터에 붙는다.
     조용히 빼면 «왜 몇 명만 옮겨졌지»가 되므로 누가 빠지는지 이름을 댄다. */
  const withCo = [], without = [];
  list.forEach(c => (coOfContact(c) ? withCo : without).push(c));
  if(!withCo.length){
    alert(`옮길 수 없어요 — 분야는 소속 기업의 섹터에서 오는데, `
      + `${without.map(c => c.nameKo || c.nameEn).join(', ')}${without.length > 3 ? ' 등' : ''}`
      + `은 기업DB의 기업과 묶여 있지 않아요.\n\n연락처를 열어 기업명을 적고 저장하면 묶입니다.`);
    return;
  }

  const secs = mainSectors().filter(s => !parseSectorScope(s.name).eventShort
    && domainOfSector(s).includes(domainId));
  if(!secs.length){
    alert(`«${domainName(domainId)}» 분야에 섹터가 하나도 없어요.\n`
      + `설정 › 기업 분류에서 섹터를 만들고 분야에 «${domainName(domainId)}»을 체크해주세요.`);
    return;
  }

  const cos = [...new Map(withCo.map(c => [coOfContact(c).key, coOfContact(c)])).values()];
  const note = without.length
    ? `\n\n기업과 안 묶인 ${without.length}명은 빠집니다: ${without.map(c => c.nameKo || c.nameEn).slice(0, 5).join(', ')}`
    : '';

  openDomainSectorPicker(cos, secs, domainId, note);
}

/* ── 분야만 옮기기 ──
   분야는 저장되는 값이 아니라 기업의 섹터에서 파생된다. 그래서 «건축으로
   옮겨»라고만 하려 해도 업종을 하나 골라야 했다 — 64곳을 한꺼번에 옮기는
   자리에서 그걸 다 알 리가 없고, 모르면서 아무거나 고르면 틀린 분류가 64곳에
   박힌다. 회사 이름만 보고 우리가 짐작해 넣는 건 더 나쁘다. 틀려도 아무도
   모른 채 맞는 값처럼 보이기 때문이다.

   그래서 그 분야의 «업종 미정» 자리로 보낸다. 분야별 보기에서는 바로
   «건축»으로 잡히고, 기업DB 섹터 칸에는 아직 안 정했다는 말이 그대로 적혀
   있어 나중에 그것만 뽑아 고칠 수 있다. */
const catchAllName = (domainId) => domainName(domainId) + ' 업종 미정';

async function ensureDomainCatchAll(domainId){
  const name = catchAllName(domainId);
  const have = findSectorByName(name);
  if(have) return have.name;
  const sector = { id: slugifySectorName(name), name, parent: null, domain: domainId, canonical: '' };
  COMPANY_SECTORS.push(sector);
  const r = await upsertSectorRow(sector);
  if(r && r.ok === false){
    // 저장에 실패하면 화면에만 있는 섹터가 남는다 — 되돌리고 알린다
    const i = COMPANY_SECTORS.indexOf(sector);
    if(i >= 0) COMPANY_SECTORS.splice(i, 1);
    alert('«' + name + '» 섹터를 만들지 못했어요. 네트워크를 확인하고 다시 시도해주세요.');
    return null;
  }
  return sector.name;
}

/* 분야 안에 섹터가 여럿일 때 고르게 한다 */
function openDomainSectorPicker(cos, secs, domainId, note){
  const old = document.getElementById('mdb-sector-picker');
  if(old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'mdb-sector-picker';
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;'
    + 'display:flex;align-items:center;justify-content:center;padding:16px';
  wrap.onclick = (e) => { if(e.target === wrap) wrap.remove(); };
  wrap.innerHTML = `<div style="background:var(--W);border-radius:12px;padding:20px;width:100%;max-width:420px;
      max-height:80vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.2)">
      <div style="font-size:14px;font-weight:700;margin-bottom:4px">«${escapeHtml(domainName(domainId))}» 어느 업종인가요</div>
      <div style="font-size:11.5px;color:var(--i3);line-height:1.6;margin-bottom:12px">
        기업 ${cos.length}곳을 옮깁니다. 그 기업에 묶인 연락처 전원이 함께 따라가요.${escapeHtml(note)}</div>
      <button class="btn bp" style="width:100%;justify-content:flex-start;margin-bottom:10px;font-size:12px"
        data-sector="__domain__">업종은 나중에 — «${escapeHtml(domainName(domainId))}»에만 넣기</button>
      <div style="font-size:10.5px;color:var(--i4);margin-bottom:8px">업종을 알면 아래에서 고르세요</div>
      <div id="mdb-sector-picker-list">
        ${secs.map(s => `<button class="btn" style="width:100%;justify-content:flex-start;margin-bottom:5px;font-size:12px"
          data-sector="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button>`).join('')}
      </div>
      <button class="btn bs" style="width:100%;justify-content:center;margin-top:8px"
        onclick="document.getElementById('mdb-sector-picker').remove()">취소</button>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelectorAll('[data-sector]').forEach(b => {
    b.onclick = async () => {
      wrap.remove();
      const name = b.dataset.sector === '__domain__'
        ? await ensureDomainCatchAll(domainId)
        : b.dataset.sector;
      if(name) moveCosToSector(cos, name, domainId);
    };
  });
}

async function moveCosToSector(cos, sectorName, domainId){
  const wasSectors = cos.map(co => ({ key: co.key, sector: (co.sectors || []).join(', ') }));
  cos.forEach(co => applyCoSectors(co, [sectorName]));
  trackAction('edit', '분야 이동(드래그)', `${cos.length}곳`,
    `기업 ${cos.length}곳을 «${sectorName}» 섹터로 옮겨 «${domainName(domainId)}» 분야에 넣음`,
    { table: 'orgs', op: 'update-many',
      rows: wasSectors.map(w => ({ row: w.key, before: { sector: w.sector }, after: { sector: sectorName } })) });
  try { buildCoDB(); } catch(e){}
  mdbSelected.clear();
  renderMDB();
}

/* 안내문에 쓰는 평문 — alert는 HTML을 그리지 않으므로 이스케이프하면 안 된다 */
const escapeHtmlPlain = (s) => String(s == null ? '' : s);

/* ── 인라인 핸들러용 노출 ── */
window.setMDBType        = setMDBType;
window.buildMDBFilterBar = buildMDBFilterBar;
window.onMDBDragStart    = onMDBDragStart;
window.onMDBDragEnd      = onMDBDragEnd;
window.onMDBDragOver     = onMDBDragOver;
window.onMDBDragLeave    = onMDBDragLeave;
window.onMDBDropToCat    = onMDBDropToCat;
window.onMDBDropToDomain = onMDBDropToDomain;


