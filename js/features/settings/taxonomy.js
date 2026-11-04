/* ══════════════════════════════════════════════════════════════
   features/settings/taxonomy.js — 분야·연락처 태그·참가 유형 관리
   (modules/settings-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { postToSheet } from '../../api.js';
import { deletePartTypeRow, saveDomains, saveTags, upsertPartTypeRow } from '../../api/settings-save.js';
import { changed, removed, trackAction } from '../../core/audit-log.js';
import { buildCoDB } from '../../domain/co-db.js';
import { domainOfSector, mainSectors } from '../../domain/sectors.js';
import { buildCoCAT, renderCoDashboard } from '../../modules/company-tab.js';
import { buildMDBEvList, buildMDBTagList, renderMDB } from '../../modules/db-tab.js';
import { DOMAINS, PART_TYPES, TAGS, contacts, syncPartColors } from '../../state.js';
import { escAttr, escapeHtml, joinDomains, parseDomains, sectorRowValues } from '../../utils.js';
import { populateUploadEvDropdown } from '../upload/upload-event-select.js';
import { populateSectorScopeSelect, renderMainConvertList, renderSectorMergeList, renderSectorTree, renderUnregisteredSectors } from './sector-tree.js';

/* ══════════════════════════════════════════
   분야(도메인) 관리 (신규) — PART_TYPES 관리 UI 패턴
══════════════════════════════════════════ */
export function renderDomainList(){
  const el = document.getElementById('domain-list');
  if(!el) return;
  if(!DOMAINS.length){
    el.innerHTML = '<span style="font-size:var(--fs-12);color:var(--i4)">등록된 분야가 없어요 — 모든 섹터가 미분류로 표시됩니다.</span>';
    return;
  }
  const mainCount = id => mainSectors().filter(m => domainOfSector(m).includes(id)).length;
  el.innerHTML = DOMAINS.map(d => `
    <span style="display:inline-flex;align-items:center;gap:6px;background:var(--W);border:1px solid var(--i6);border-radius:var(--rd-20);padding:4px 6px 4px 12px;font-size:var(--fs-12)">
      <b>${escapeHtml(d.name)}</b>
      <span style="font-size:var(--fs-10);color:var(--i4)">${mainCount(d.id)}개 섹터</span>
      <button onclick="renameDomain('${escAttr(d.id)}')" title="이름 변경"
        style="background:none;border:none;cursor:pointer;color:var(--i4);font-size:var(--fs-12);padding:0">✎</button>
      <button onclick="removeDomain('${escAttr(d.id)}')" title="삭제"
        style="background:none;border:none;cursor:pointer;color:var(--i4);font-size:var(--fs-14);line-height:1;padding:0"
        onmouseover="this.style.color='var(--re)'" onmouseout="this.style.color='var(--i4)'">×</button>
    </span>`).join('');
}

export async function addDomain(){
  const inp = document.getElementById('domain-add-input');
  const raw = inp ? inp.value.trim() : '';
  if(!raw){ inp && inp.focus(); return; }
  if(DOMAINS.some(d => d.name === raw)){ alert('이미 있는 분야예요.'); return; }
  let id = raw.toLowerCase().replace(/[^a-z0-9가-힣]+/g,'_').replace(/^_+|_+$/g,'').slice(0,20) || 'domain';
  let n = 2; const base = id;
  while(DOMAINS.some(d => d.id === id)) id = `${base}_${n++}`;
  DOMAINS.push({ id, name: raw });
  if(inp) inp.value = '';
  const r = await saveDomains();
  if(!r.ok){ DOMAINS.pop(); renderDomainList(); return; } // 실패 시 롤백
  trackAction('edit', '분야 추가', raw, `분야 "${raw}" 추가`);
  renderDomainList();
  renderSectorTree();
  try { buildCoCAT(); } catch(e){}
}

export async function renameDomain(id){
  const d = DOMAINS.find(x => x.id === id);
  if(!d) return;
  const name = prompt('분야의 새 이름을 입력하세요.', d.name);
  if(!name || !name.trim() || name.trim() === d.name) return;
  const prev = d.name;
  d.name = name.trim();
  const r = await saveDomains();
  if(!r.ok){ d.name = prev; renderDomainList(); return; }
  trackAction('edit', '분야 이름 변경', d.name, `분야 이름: ${prev} → ${d.name}`,
    changed('domains', d.id, { name: prev }, { name: d.name }));
  renderDomainList();
  renderSectorTree();
  try { buildCoCAT(); } catch(e){}
}

export async function removeDomain(id){
  const d = DOMAINS.find(x => x.id === id);
  if(!d) return;
  const affected = mainSectors().filter(m => parseDomains(m.domain).includes(id));
  if(!confirm(`분야 "${d.name}"을(를) 삭제할까요?`
    + (affected.length ? `\n소속 메인 섹터 ${affected.length}개에서 이 분야만 제거됩니다(다른 분야에 속해 있으면 유지).` : ''))) return;

  // 소속 섹터에서 이 분야 id만 제거하고 일괄 저장 (batchUpsert 1회) — 다중 분야
  // 소속인 경우 나머지 분야는 그대로 유지된다.
  const prevValues = affected.map(s => s.domain || '');
  if(affected.length){
    affected.forEach(s => { s.domain = joinDomains(parseDomains(s.domain).filter(x => x !== id)); });
    const r = await postToSheet({
      sheet: 'sectors', action: 'batchUpsert',
      rows: affected.map(sectorRowValues),
    }, '분야 해제');
    if(!r.ok){ affected.forEach((s,i) => { s.domain = prevValues[i]; }); return; } // 실패 시 롤백
  }
  const idx = DOMAINS.findIndex(x => x.id === id);
  if(idx >= 0) DOMAINS.splice(idx, 1);
  const r2 = await saveDomains();
  if(!r2.ok){ DOMAINS.splice(idx, 0, d); renderDomainList(); return; }
  /* 분야 줄과, 이 분야를 가리키던 섹터들의 이전값을 함께 담는다 — 분야만
     되살리면 섹터는 미분류로 남는다 */
  trackAction('edit', '분야 삭제', d.name, `분야 "${d.name}" 삭제 (섹터 ${affected.length}개 미분류로 이동)`,
    removed('domains', id, d, { also: affected.map((s, i) => ({ row: s.id, domain: prevValues[i] })) }));
  renderDomainList();
  renderSectorTree();
  try { buildCoCAT(); } catch(e){}
}

/* ══════════════════════════════════════════
   연락처 태그 관리 (신규) — 분야(도메인) 관리와 동일한 UI 패턴.
   BD/C-level처럼 참가 역할·직함과 무관하게 연락처에 직접 붙는 영구 꼬리표
   (contacts.tags 컬럼)의 "정의"를 추가/이름변경/삭제한다 — 개별 연락처에
   태그를 붙이고 떼는 건 마스터DB 일괄 변경 모달에서 한다.
══════════════════════════════════════════ */
export function renderTagList(){
  const el = document.getElementById('tag-list');
  if(!el) return;
  if(!TAGS.length){
    el.innerHTML = '<span style="font-size:var(--fs-12);color:var(--i4)">등록된 태그가 없어요.</span>';
    return;
  }
  el.innerHTML = TAGS.map(t => `
    <span style="display:inline-flex;align-items:center;gap:6px;background:var(--W);border:1px solid var(--i6);border-radius:var(--rd-20);padding:4px 6px 4px 12px;font-size:var(--fs-12)">
      <b>${escapeHtml(t.label)}</b>
      <span style="font-size:var(--fs-10);color:var(--i4)">${escapeHtml(t.key)}</span>
      <button onclick="renameTag('${escAttr(t.key)}')" title="이름 변경"
        style="background:none;border:none;cursor:pointer;color:var(--i4);font-size:var(--fs-12);padding:0">✎</button>
      <button onclick="removeTag('${escAttr(t.key)}')" title="삭제"
        style="background:none;border:none;cursor:pointer;color:var(--i4);font-size:var(--fs-14);line-height:1;padding:0"
        onmouseover="this.style.color='var(--re)'" onmouseout="this.style.color='var(--i4)'">×</button>
    </span>`).join('');
}

export async function addTag(){
  const inp = document.getElementById('tag-add-input');
  const raw = inp ? inp.value.trim() : '';
  if(!raw){ inp && inp.focus(); return; }
  if(TAGS.some(t => t.label === raw)){ alert('이미 있는 태그예요.'); return; }
  let key = raw.toLowerCase().replace(/[^a-z0-9가-힣]+/g,'_').replace(/^_+|_+$/g,'').slice(0,20) || 'tag';
  let n = 2; const base = key;
  while(TAGS.some(t => t.key === key)) key = `${base}_${n++}`;
  TAGS.push({ key, label: raw });
  if(inp) inp.value = '';
  const r = await saveTags();
  if(!r.ok){ TAGS.pop(); renderTagList(); return; } // 실패 시 롤백
  trackAction('edit', '태그 추가', raw, `태그 "${raw}" 추가`);
  renderTagList();
  try { buildMDBTagList(); renderMDB(); } catch(e){}
}

export async function renameTag(key){
  const t = TAGS.find(x => x.key === key);
  if(!t) return;
  const label = prompt('태그의 새 이름을 입력하세요.', t.label);
  if(!label || !label.trim() || label.trim() === t.label) return;
  const prev = t.label;
  t.label = label.trim();
  const r = await saveTags();
  if(!r.ok){ t.label = prev; renderTagList(); return; }
  trackAction('edit', '태그 이름 변경', t.label, `태그 이름: ${prev} → ${t.label}`,
    changed('tags', t.key, { label: prev }, { label: t.label }));
  renderTagList();
  try { buildMDBTagList(); renderMDB(); } catch(e){}
}

export async function removeTag(key){
  const t = TAGS.find(x => x.key === key);
  if(!t) return;
  if(!confirm(`태그 "${t.label}"을(를) 삭제할까요?\n이 태그가 붙어있던 연락처에서는 태그만 제거되고, 연락처 자체는 그대로 남습니다.`)) return;

  // 이 태그가 붙어있던 연락처에서 태그 제거 (batchUpsert 1회)
  const affected = contacts.filter(c => (c.tags||'').split('|').map(s=>s.trim()).includes(key));
  const prevValues = affected.map(c => c.tags || '');
  if(affected.length){
    affected.forEach(c => {
      c.tags = (c.tags||'').split('|').map(s=>s.trim()).filter(s => s && s !== key).join('|');
    });
    const r = await postToSheet({
      sheet: 'contacts', action: 'batchUpsert',
      rows: affected.map(c => [c.id,c.nameKo,c.nameEn,c.orgKo,c.orgEn,c.titleKo,c.titleEn,c.deptKo,c.deptEn,
        c.country,c.cat,c.lang,c.source,c.date,c.status,c.email1,c.email2,c.phone1,c.phone2,c.beat,c.products,c.tags||'',c.org_id||'']),
    }, '태그 삭제 - 연락처 반영');
    if(!r.ok){ affected.forEach((c,i) => { c.tags = prevValues[i]; }); return; } // 실패 시 롤백
  }
  const idx = TAGS.findIndex(x => x.key === key);
  if(idx >= 0) TAGS.splice(idx, 1);
  const r2 = await saveTags();
  if(!r2.ok){ TAGS.splice(idx, 0, t); renderTagList(); return; }
  trackAction('edit', '태그 삭제', t.label, `태그 "${t.label}" 삭제 (연락처 ${affected.length}건에서 제거)`,
    removed('tags', key, t, { also: affected.map((c, i) => ({ row: c.id, tags: prevValues[i] })) }));
  renderTagList();
  try { buildMDBTagList(); renderMDB(); } catch(e){}
}

/* 섹터 탭 하위 4개 영역을 한 번에 새로고침 (원본 3685~3691행) */
export function renderSectorList(){
  renderDomainList();
  populateSectorScopeSelect();
  renderSectorTree();
  renderUnregisteredSectors();
  renderMainConvertList();
  renderSectorMergeList();
}

/* ══════════════════════════════════════════
   참가 유형(PART_TYPES) 관리 (원본 6348~6350행, 6378~6420행)
══════════════════════════════════════════ */
export function partTypeClass(type){ return (PART_TYPES.find(t=>t.key===type)||{cls:'p-gray'}).cls; }
export function partTypeLabel(type){ return (PART_TYPES.find(t=>t.key===type)||{label:type||''}).label; }

export const PART_TYPE_COLOR_CHOICES = ['p-blue','p-green','p-amber','p-teal','p-purple','p-red','p-gray','p-gold','p-indigo'];

export function renderPartTypeList(){
  const el = document.getElementById('parttype-list');
  if(!el) return;
  el.innerHTML = PART_TYPES.length
    ? PART_TYPES.map((t,i) => `
        <span style="display:inline-flex;align-items:center;gap:4px;background:var(--i7);border:1px solid var(--i6);border-radius:var(--rd-20);padding:3px 10px;font-size:var(--fs-12)">
          <span class="pill ${t.cls}" style="margin:0">${escapeHtml(t.label)}</span>
          <button onclick="removePartType(${i})"
            style="background:none;border:none;cursor:pointer;color:var(--i4);font-size:var(--fs-14);line-height:1;padding:0 0 0 2px"
            onmouseover="this.style.color='var(--re)'" onmouseout="this.style.color='var(--i4)'">×</button>
        </span>`).join('')
    : '<div style="font-size:var(--fs-12);color:var(--i4)">등록된 참가 유형 없음</div>';

  // 참가 유형을 쓰는 드롭다운들도 함께 갱신
  document.querySelectorAll('.parttype-select').forEach(sel => {
    const cur = sel.value;
    sel.innerHTML = PART_TYPES.map(t => `<option value="${t.key}"${t.key===cur?' selected':''}>${escapeHtml(t.label)}</option>`).join('');
  });
}

/* 행사를 더하고·고치고·지운 뒤 — 마스터DB 행사 목록·업로드 드롭다운뿐 아니라 기업DB도 다시 만든다.
   기업DB(CO_DB)는 행사 약칭·이름을 복사해 들고 있어서, 안 그러면 새로고침 전까지 옛 이름이 보였다 */
export function refreshAfterEventChange(){
  try { buildMDBEvList(); populateUploadEvDropdown(); } catch(e){}
  try { buildCoDB(); if(document.getElementById('co-dash')) renderCoDashboard(); } catch(e){}
}

export async function addPartType(){
  const inp = document.getElementById('parttype-add-input');
  const colorSel = document.getElementById('parttype-add-color');
  const val = inp ? inp.value.trim() : '';
  if(!val){ inp && inp.focus(); return; }
  if(PART_TYPES.some(t => t.key === val)){ alert('이미 있는 참가 유형이에요.'); return; }

  const t = { key: val, label: val, cls: (colorSel && colorSel.value) || 'p-gray' };
  PART_TYPES.push(t);
  syncPartColors();
  if(inp) inp.value = '';
  renderPartTypeList();
  await upsertPartTypeRow(t);
}

export async function removePartType(idx){
  const t = PART_TYPES[idx];
  if(!t) return;
  if(!confirm(`"${t.label}" 참가 유형을 삭제할까요? (기존에 이 유형으로 저장된 참가 기록은 남아있어요)`)) return;
  PART_TYPES.splice(idx, 1);
  renderPartTypeList();
  await deletePartTypeRow(t.key);
  trackAction('delete', '참가 유형 삭제', t.label || t.key,
    `참가 유형 <b>${escapeHtml(t.label || t.key)}</b> 삭제 — 이 유형으로 저장된 참가 기록은 남아 있어요`,
    { table: 'part_types', op: 'delete', row: t.key, before: t });
}


/* 화면의 onclick이 부르는 것 */
window.addPartType           = addPartType;
window.removePartType        = removePartType;
window.addDomain              = addDomain;
window.renameDomain           = renameDomain;
window.removeDomain           = removeDomain;
window.addTag                 = addTag;
window.renameTag              = renameTag;
window.removeTag              = removeTag;
window.renderSectorList = renderSectorList;   // 탭(settings-tab.js)이 window로 부른다
window.renderPartTypeList = renderPartTypeList;   // 탭(settings-tab.js)이 window로 부른다
window.renderTagList = renderTagList;   // 탭(settings-tab.js)이 window로 부른다
