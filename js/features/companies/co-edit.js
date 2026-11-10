/* ══════════════════════════════════════════════════════════════
   features/companies/co-edit.js — 기업 필드 고치기·분야와 섹터·드래그
   (modules/company-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { postToSheet } from '../../api.js';
import { upsertSectorRow } from '../../api/settings-save.js';
import { aiOrgPdfSummary } from '../../api/ai.js';
import { changed, trackAction } from '../../core/audit-log.js';
import { orgKindOf } from '../../domain/org-names.js';
import { upsertCompanyRow } from '../../domain/org-save.js';
import { domainName, domainOfSector, findSectorByName, joinSectors } from '../../domain/sectors.js';
import { COMPANY_SECTORS, CO_DB, DOMAINS, ORG_KINDS, contacts, selCo } from '../../state.js';
import { escAttr, escapeHtml, parseLinks, parseSectorScope, safeUrl, slugifySectorName } from '../../utils.js';
import { coUi } from './co-ui.js';
import { CATEGORY_CODES, buildCoCAT, renderCoDashboard, renderCoList, renderMDB } from '../../modules/company-tab.js';
import { assignCategoryCode, renderCoDetail } from './co-detail.js';

/* ══════════════════════════════════════════
   기업 필드 인라인 편집 — Twenty Record Table 벤치마킹
   (원본은 editCoNotes/editCoWebsite/editCoCountry/editCoAbbr/editCoSource가
   각각 화면 중앙 모달을 띄우고 별도 저장 버튼(saveCoNotes 등)을 눌러야 저장되는
   방식이었음. 여기서는 클릭한 span 자리에서 바로 input/textarea로 바뀌어
   Enter 또는 포커스 아웃 시 저장, Escape로 취소하는 인라인 편집으로 개선함.
   저장 로직(upsertCompanyRow → GS_URL companies 시트 upsert)은 원본 그대로.
══════════════════════════════════════════ */
const CO_TEXT_FIELDS = {
  notes:   { placeholder: '이 기업에 대한 메모를 남겨보세요', multiline: true,  empty: '메모 추가' },
  /* 섹터가 «고르는 값»이라면 이쪽은 «적는 값» — 회사가 실제로 하는 일을
     명단에 적힌 그대로 담는다(예: 렌탈,포토 / 음향, 통역시스템). */
  products:{ placeholder: '예: LED, 렌탈,포토 — 쉼표로 여러 개',  multiline: false, empty: '취급 품목 추가' },
  /* 담당자를 아직 못 찾은 회사의 대표번호 — 사람이 아니라 회사에 붙는다 */
  phone:   { placeholder: '02-000-0000',                      multiline: false, empty: '대표 전화 추가' },
  email:   { placeholder: 'info@example.com',                 multiline: false, empty: '대표 메일 추가' },
  /* 프로그램북 원고에서 옮겨 온 값 — 행사가 아니라 회사에 붙는다 */
  address: { placeholder: '예: 서울시 강남구 …',               multiline: true,  empty: '주소 추가' },
  intro:   { placeholder: '회사소개',                          multiline: true,  empty: '회사소개 추가' },
  website: { placeholder: 'https://example.com',              multiline: false, empty: '웹사이트 추가', isLink: true },
  country: { placeholder: '예: 한국',                          multiline: false, empty: '국가 추가' },
  abbr:    { placeholder: '예: SK',                            multiline: false, empty: '약어 추가' },
  source:  { placeholder: '예: 홈페이지 조사',                  multiline: false, empty: '출처 추가' },
  nameKo:  { placeholder: '회사명(국문)',                       multiline: false, empty: '국문명 추가' },
  nameEn:  { placeholder: '회사명(영문)',                       multiline: false, empty: '영문명 추가' },
  // 세금계산서를 끊을 때 필요한데 지금까지 적어둘 곳이 없어 메모에 섞여 있었다
  bizNo:   { placeholder: '000-00-00000',                     multiline: false, empty: '사업자번호 추가' },
};

function renderCoFieldDisplay(key, field){
  const c = CO_DB.find(x => x.key === key);
  const cfg = CO_TEXT_FIELDS[field];
  const span = document.getElementById(`co-${field}-${key}`);
  if(!c || !cfg || !span) return;
  const val = c[field] || '';
  if(cfg.isLink && val){
    span.innerHTML = parseLinks(val).map(({ url, label }) => {
      const href = safeUrl(url);
      const a = href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(url)}</a>`
        : escapeHtml(url);
      return a + (label ? ` <span style="color:var(--i5);font-size:var(--fs-10)">${escapeHtml(label)}</span>` : '');
    }).join('<span style="color:var(--i6)"> · </span>');
  } else {
    span.textContent = val || cfg.empty;
  }
}

async function saveCoTextField(key, field, rawValue){
  const c = CO_DB.find(x => x.key === key);
  if(!c) return;
  const before = c[field] || '';
  c[field] = rawValue.trim();

  /* 사명이 바뀌면 옛 이름을 남긴다. 이름은 더 이상 식별자가 아니라 데이터가
     끊기지는 않지만, 옛 이름으로 찾는 사람과 옛 이름으로 들어오는 업로드가
     있다 — alias에 있어야 같은 회사로 이어진다. */
  const fields = [field];
  if((field === 'nameKo' || field === 'nameEn') && before && before !== c[field]){
    if(!c.aliases.includes(before)){ c.aliases = [...c.aliases, before]; fields.push('aliases'); }
  }
  await upsertCompanyRow(c, fields);
  /* 헤더는 "적어 둔 것"만 줄로 보여주고 빈 칸은 접어 둔다 — 값이 생기거나
     지워지면 그 줄이 어느 쪽에 속하는지가 바뀌므로 통째로 다시 그린다.
     한 칸만 갈아 끼우면 방금 채운 값이 접힌 쪽에 남아 안 보인다. */
  renderCoDetail(c);
  if(field === 'abbr' || field === 'nameKo' || field === 'nameEn') renderCoList();
  if(field === 'nameKo' || field === 'nameEn'){
    // 기업 이름만 바꾸고 끝나면 마스터DB는 연락처 원본 orgKo/orgEn을 그대로
    // 보여주는 화면이라 반영이 안 된 것처럼 보인다 — mergeCompanies와 동일하게
    // 소속 연락처 전원의 org 필드도 함께 갱신한다.
    const orgField = field === 'nameKo' ? 'orgKo' : 'orgEn';
    const changed = [];
    (c.contacts||[]).forEach(cc => {
      const contact = contacts.find(x => x.id === cc.id);
      if(contact && contact[orgField] !== c[field]){
        contact[orgField] = c[field];
        changed.push(contact);
      }
    });
    if(changed.length){
      await postToSheet({
        sheet: 'contacts', action: 'batchUpsert',
        rows: changed.map(ct => [ct.id,ct.nameKo,ct.nameEn,ct.orgKo,ct.orgEn,ct.titleKo,ct.titleEn,ct.deptKo,ct.deptEn,
          ct.country,ct.cat,ct.lang,ct.source,ct.date,ct.status,ct.email1,ct.email2,ct.phone1,ct.phone2,
          ct.beat,ct.products,ct.tags||'',ct.org_id||'']),
      }, '기업명 변경 - 연락처 반영');
      try { renderMDB(); } catch(e){}
    }
  }
}

function startCoInlineEdit(key, field){
  const c = CO_DB.find(x => x.key === key);
  const cfg = CO_TEXT_FIELDS[field];
  if(!c || !cfg) return;
  const span = document.getElementById(`co-${field}-${key}`);
  if(!span) return;
  if(span.querySelector('input,textarea')) return; // 이미 편집 중이면 무시

  const current = c[field] || '';
  const tag = cfg.multiline ? 'textarea' : 'input';
  const sizeStyle = cfg.multiline
    ? 'width:220px;height:64px;resize:vertical;font-size:var(--fs-11);padding:4px 6px;font-family:inherit'
    : 'width:160px;font-size:var(--fs-11);padding:2px 6px;font-family:inherit';
  span.innerHTML = `<${tag} class="fi" id="co-inline-input-${field}-${escapeHtml(key)}" style="${sizeStyle}" placeholder="${escapeHtml(cfg.placeholder)}"></${tag}>`;
  const input = document.getElementById(`co-inline-input-${field}-${key}`);
  if(!input) return;
  input.value = current;
  input.addEventListener('click', e => e.stopPropagation());
  input.focus();
  if(input.select) input.select();

  let settled = false;
  const commit = () => {
    if(settled) return; settled = true;
    saveCoTextField(key, field, input.value);
  };
  const cancel = () => {
    if(settled) return; settled = true;
    renderCoFieldDisplay(key, field);
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if(e.key === 'Enter' && !cfg.multiline){ e.preventDefault(); input.blur(); }
    if(e.key === 'Escape'){ e.preventDefault(); input.removeEventListener('blur', commit); cancel(); }
  });
}

/* 담당자 연락처를 기업 대표 칸에 저장 — 사람이 «이게 대표번호다»라고 확인했을 때만 누른다 */
export async function saveCoRepFromContact(key, field){
  const c = CO_DB.find(x => x.key === key);
  const fb = c && (field === 'phone' ? c.fbPhone : c.fbEmail);
  if(!fb) return;
  /* 저장하면 상세를 바로 다시 그리므로, 대신 보이던 값은 먼저 비운다 */
  if(field === 'phone') c.fbPhone = null; else c.fbEmail = null;
  await saveCoTextField(key, field, fb.v);
  renderCoList();
}

export function editCoNameKo(key){ startCoInlineEdit(key, 'nameKo'); }
export function editCoNameEn(key){ startCoInlineEdit(key, 'nameEn'); }
export function editCoNotes(key){ startCoInlineEdit(key, 'notes'); }
export function editCoProducts(key){ startCoInlineEdit(key, 'products'); }
export function editCoPhone(key){ startCoInlineEdit(key, 'phone'); }
export function editCoEmail(key){ startCoInlineEdit(key, 'email'); }
export function editCoWebsite(key){ startCoInlineEdit(key, 'website'); }
export function editCoAddress(key){ startCoInlineEdit(key, 'address'); }
export function editCoIntro(key){ startCoInlineEdit(key, 'intro'); }
export function editCoCountry(key){ startCoInlineEdit(key, 'country'); }
export function editCoAbbr(key){ startCoInlineEdit(key, 'abbr'); }
export function editCoSource(key){ startCoInlineEdit(key, 'source'); }
export function editCoBizNo(key){ startCoInlineEdit(key, 'bizNo'); }

/* ── 소개서 PDF로 회사소개 채우기 ──
   업체가 보낸 소개서·견적서는 대개 글자가 아니라 그림으로 된 PDF다. 그래서 글자를
   뽑지 않고 쪽마다 JPEG로 바꿔 Claude에게 보여 준다(backend-node/routes/ai.js
   /org-pdf-summary). PDF 원본을 그대로 보내면 서버 요청 한도(4.5MB)에 걸린다.
   요약은 회사소개에 넣고(이미 있으면 덮을지 묻는다), 대표 연락처·품목은 빈 칸만 채운다. */
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
function loadPdfjs(){
  return coUi.pdfjsReady || (coUi.pdfjsReady = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = PDFJS + 'pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; ok(window.pdfjsLib); };
    s.onerror = () => { coUi.pdfjsReady = null; fail(new Error('PDF 읽기 도구를 못 불러왔어요')); };
    document.head.appendChild(s);
  }));
}
async function pdfToJpegs(file, maxPages){
  const lib = await loadPdfjs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for(let i = 1; i <= Math.min(doc.numPages, maxPages); i++){
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(2, 1400 / Math.max(base.width, base.height)) }); // 긴 변 1400px — 작은 글씨(단가표)까지 읽힌다
    const cv = document.createElement('canvas');
    cv.width = vp.width; cv.height = vp.height;
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    out.push(cv.toDataURL('image/jpeg', 0.7).split(',')[1]);
  }
  return out;
}
export function fillCoIntroFromPdf(key){
  const c = CO_DB.find(x => x.key === key);
  if(!c) return;
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/pdf,.pdf'; inp.multiple = true;
  inp.onchange = async () => {
    const files = [...inp.files].slice(0, 5);
    if(!files.length) return;
    const msg = (t) => { const el = document.getElementById(`co-pdf-msg-${key}`); if(el) el.textContent = t; };
    try {
      msg('PDF 읽는 중…');
      let left = 30;
      const sent = [];
      for(const f of files){
        if(left <= 0) break;
        const pages = await pdfToJpegs(f, left);
        left -= pages.length;
        sent.push({ name: f.name, pages });
      }
      msg('요약하는 중… (30초쯤)');
      const r = await aiOrgPdfSummary({ name: c.nameKo || c.nameEn || '', files: sent });
      if(!r.ok){ msg(''); alert('요약 실패 — ' + (r.error || '')); return; }
      msg('');
      if(!r.intro){ alert('문서에서 요약할 내용을 못 찾았어요.'); return; }
      if(c.intro && c.intro.trim() && !confirm(`회사소개가 이미 있습니다. 새 요약으로 바꿀까요?\n\n── 새 요약 ──\n${r.intro}`)) return;
      const fields = ['intro'];
      c.intro = r.intro;
      ['phone', 'email', 'website', 'address', 'products'].forEach(k => {
        if(r[k] && !String(c[k] || '').trim()){ c[k] = r[k]; fields.push(k); }
      });
      await upsertCompanyRow(c, fields);
      renderCoDetail(c);
      msg(`✓ ${files.map(f => f.name).join(', ')} 요약 저장`);
    } catch(e){ msg(''); alert('PDF를 읽지 못했어요 — ' + e.message); }
  };
  inp.click();
}

/* ── 기업 종류 ──
   무엇을 관리하는 회사인지에 따라 화면에서 다르게 다룬다. 값이 셋뿐이라
   팝오버 대신 그 자리에서 순환시킨다 — 누를 때마다 다음 종류로 넘어간다. */
export async function editCoKind(key){
  const c = CO_DB.find(x => x.key === key);
  if(!c) return;
  const i = ORG_KINDS.findIndex(k => k.key === c.kind);
  const next = ORG_KINDS[(i + 1) % ORG_KINDS.length];
  const before = c.kind;
  c.kind = next.key;
  renderCoDetail(c);
  const r = await upsertCompanyRow(c, ['kind']);
  if(!r || !r.ok){
    c.kind = before;
    renderCoDetail(c);
    alert('기업 종류 저장에 실패했어요.');
    return;
  }
  trackAction('edit', '기업 종류 변경', c.nameKo || c.nameEn,
    `<b>${escapeHtml(c.nameKo || c.nameEn)}</b> 종류 ${escapeHtml(orgKindOf(before)?.label || '없음')} → ${escapeHtml(next.label)}`,
    changed('orgs', c.key, { kind: before }, { kind: next.key },
      { kind: 'company', id: c.key, field: 'kind' }));
  renderCoList();
}

/* ── 기업 섹터 편집(복수 선택) — 클릭한 필드 바로 아래 앵커된 팝오버로 인라인 편집 ──
   원본은 화면 중앙 고정 모달이었음. Twenty의 select 셀 편집(클릭한 셀 위치에
   드롭다운이 뜨는 방식)을 벤치마킹해 앵커 팝오버 + 바깥 클릭 시 닫힘으로 개선.
   저장 로직(saveCoSector 내부의 upsertCompanyRow/contacts upsert)은 원본 그대로. */
function handleCoSectorOutsideClick(e){
  const pop = document.getElementById('co-sector-popover');
  if(pop && !pop.contains(e.target)) closeCoSectorPopover();
}
export function closeCoSectorPopover(){
  const pop = document.getElementById('co-sector-popover');
  if(pop) pop.remove();
  document.removeEventListener('mousedown', handleCoSectorOutsideClick);
}

/* ══════════════════════════════════════════
   분야와 섹터를 나란히

   화면에는 섹터만 있었다. 그런데 «임상 IT·데이터»를 보고 그게 바이오 분야인지
   아는 건 그 목록을 외운 사람뿐이다. 분야는 섹터에서 파생되니 계산할 수
   있는데도 보여주지 않아서, 옆 사람에게 물어야 알 수 있었다.

   섹터를 모르는 채로 분야만 정해야 할 때도 있다 — 건축 행사에서 만난 회사인데
   설계인지 시공인지는 아직 모르는 식이다. 그럴 때 분야 배지를 눌러 분야만
   고르면, 그 분야의 «업종 미정» 자리로 들어간다. 나중에 섹터를 알면 그때
   옮기면 된다. */
function coDomainsOf(c){
  const out = new Set();
  (c.sectors || []).forEach(name => {
    const sec = findSectorByName(name);
    if(sec) domainOfSector(sec).forEach(d => out.add(d));
  });
  return [...out];
}

function coDomainPill(c){
  const doms = coDomainsOf(c);
  const label = doms.length ? doms.map(d => domainName(d)).join(' · ') : '분야 미정';
  return `<span class="pill ${doms.length ? 'p-teal' : 'p-gray'}" style="cursor:pointer"
      onclick="editCoDomain('${escAttr(c.key)}')" title="클릭하여 분야 지정 — 섹터를 몰라도 분야만 정할 수 있어요">
      <span id="co-domain-${escapeHtml(c.key)}">${escapeHtml(label)}</span></span>`;
}

export function closeCoDomainPopover(){
  const el = document.getElementById('co-domain-pop');
  if(el) el.remove();
}

export function editCoDomain(key){
  const c = CO_DB.find(x => x.key === key);
  if(!c) return;
  closeCoDomainPopover();
  const cur = coDomainsOf(c);

  const wrap = document.createElement('div');
  wrap.id = 'co-domain-pop';
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9999;'
    + 'display:flex;align-items:center;justify-content:center;padding:16px';
  wrap.onclick = (e) => { if(e.target === wrap) closeCoDomainPopover(); };
  wrap.innerHTML = `<div style="background:var(--W);border-radius:var(--rd-12);padding:20px;width:100%;max-width:400px;
      max-height:80vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.2)" onclick="event.stopPropagation()">
    <div style="font-size:var(--fs-14);font-weight:700;margin-bottom:4px">분야 지정</div>
    <div style="font-size:var(--fs-11_5);color:var(--i3);line-height:1.6;margin-bottom:12px">
      섹터를 아직 모르면 분야만 골라 두세요 — 그 분야의 «업종 미정» 자리로 들어가고,
      나중에 섹터를 알면 옆의 섹터 배지에서 옮기면 됩니다.
      ${cur.length ? `<br>지금: <b>${escapeHtml(cur.map(d => domainName(d)).join(' · '))}</b>` : ''}
    </div>
    ${DOMAINS.map(d => `<button class="btn" style="width:100%;justify-content:flex-start;margin-bottom:5px;font-size:var(--fs-12)"
      data-dom="${escapeHtml(d.id)}">${escapeHtml(d.name)}${cur.includes(d.id) ? ' ✓' : ''}</button>`).join('')
      || '<div style="font-size:var(--fs-11_5);color:var(--i4)">설정 › 기업 분류에서 분야를 먼저 만들어주세요.</div>'}
    <button class="btn bs" style="width:100%;justify-content:center;margin-top:8px"
      onclick="closeCoDomainPopover()">취소</button>
  </div>`;
  document.body.appendChild(wrap);

  wrap.querySelectorAll('[data-dom]').forEach(b => {
    b.onclick = async () => {
      closeCoDomainPopover();
      await assignCoDomain(c, b.dataset.dom);
    };
  });
}

/* 분야만 정한다 — 그 분야에 이미 섹터가 붙어 있으면 아무것도 하지 않는다.
   덮어쓰면 손으로 골라 둔 섹터가 «업종 미정»으로 후퇴한다. */
async function assignCoDomain(c, domainId){
  if(coDomainsOf(c).includes(domainId)) return;
  const name = `${domainName(domainId)} 업종 미정`;
  let sec = findSectorByName(name);
  if(!sec){
    sec = { id: slugifySectorName(name), name, parent: null, domain: domainId, canonical: '' };
    COMPANY_SECTORS.push(sec);
    const r = await upsertSectorRow(sec);
    if(r && r.ok === false){
      const i = COMPANY_SECTORS.indexOf(sec);
      if(i >= 0) COMPANY_SECTORS.splice(i, 1);
      alert(`«${name}» 섹터를 만들지 못했어요. 네트워크를 확인하고 다시 시도해주세요.`);
      return;
    }
  }
  applyCoSectors(c, [...(c.sectors || []), sec.name]);
  renderCoDetail(c);
  try { buildCoCAT(); } catch(e){}
}

export function editCoSector(key){
  const c = CO_DB.find(x => x.key === key);
  if(!c) return;
  closeCoSectorPopover();

  const anchorSpan = document.getElementById('co-sector-' + key);
  const anchor = anchorSpan ? anchorSpan.parentElement : null;
  const rect = anchor ? anchor.getBoundingClientRect() : { bottom: 80, left: 20 };

  const currentSectors = c.sectors && c.sectors.length ? c.sectors : (c.sector ? [c.sector] : []);

  const checkboxRow = (s) => {
    const name   = typeof s==='string' ? s : s.name;
    const parent = typeof s==='string' ? null : s.parent;
    const checked = currentSectors.includes(name) ? 'checked' : '';
    const indent  = parent ? 'margin-left:16px' : '';
    const prefix  = parent ? '↳ ' : '';
    const label   = parseSectorScope(name).plainName;
    return `<label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;${indent}">
      <input type="checkbox" value="${escapeHtml(name)}" ${checked} style="width:13px;height:13px;cursor:pointer">
      <span style="font-size:var(--fs-12)">${prefix}${escapeHtml(label)}</span>
    </label>`;
  };

  /* 이 기업의 분야 안 섹터만 먼저 펼쳐 보인다 — 섹터가 60개쯤 되어 전부 늘어놓으면
     고르기 힘들다. 공통·다른 분야는 «더 보기»로 접어 두되, 이미 고른 섹터가 들어 있는
     묶음은 열어 둔다(접혀 있어도 체크는 그대로 저장된다). 분야가 아직 없으면 분야별로 모두 펼친다. */
  const myDoms = coDomainsOf(c);
  const nameOf = s => typeof s==='string' ? s : s.name;
  const domsOf = s => domainOfSector(typeof s==='string' ? findSectorByName(s) : s);
  const plain  = COMPANY_SECTORS.filter(s => !parseSectorScope(nameOf(s)).eventShort);
  const section = (label, items, open, collapsible) => {
    if(!items.length) return '';
    /* 설정의 «큰 갈래»가 바뀌는 자리마다 작은 제목을 끼운다 */
    const rows = items.map((s, i) => {
      const g = typeof s === 'string' ? '' : (s.group || '');
      const prev = i ? (typeof items[i-1] === 'string' ? '' : (items[i-1].group || '')) : '';
      const gh = g && g !== prev ? `<div style="font-size:var(--fs-10);font-weight:700;color:var(--a);margin:6px 0 1px">▍${escapeHtml(g)}</div>` : '';
      return gh + checkboxRow(s);
    }).join('');
    const head = `<span style="font-size:var(--fs-10);font-weight:700;color:var(--i4);letter-spacing:.04em">${escapeHtml(label)}</span>`;
    if(!collapsible) return `<div style="margin-bottom:8px"><div style="margin-bottom:2px">${head}</div>${rows}</div>`;
    const hasChecked = items.some(s => currentSectors.includes(nameOf(s)));
    return `<details style="margin-bottom:6px" ${(open || hasChecked) ? 'open' : ''}><summary style="cursor:pointer;margin-bottom:2px">${head} <span style="font-size:var(--fs-10);color:var(--i4)">${items.length}</span></summary>${rows}</details>`;
  };
  let groupsHtml = '';
  if(myDoms.length){
    myDoms.forEach(d => { groupsHtml += section(`${domainName(d)} (이 기업 분야)`, plain.filter(s => domsOf(s).includes(d)), true, false); });
    const common = plain.filter(s => domsOf(s).includes('common') && !myDoms.includes('common'));
    groupsHtml += section('공통 — 공공기관·대학·협단체 등', common, false, true);
    DOMAINS.filter(d => d.id !== 'common' && !myDoms.includes(d.id))
      .forEach(d => { groupsHtml += section(`다른 분야 · ${d.name}`, plain.filter(s => domsOf(s).includes(d.id)), false, true); });
    const noDom = plain.filter(s => !domsOf(s).length);
    groupsHtml += section('분야 없음', noDom, false, true);
  } else {
    DOMAINS.forEach(d => { groupsHtml += section(d.name, plain.filter(s => domsOf(s).includes(d.id)), true, true); });
    groupsHtml += section('분야 없음', plain.filter(s => !domsOf(s).length), true, true);
  }
  // 행사별로 이름 앞에 행사가 붙은 섹터(이 기업이 참가한 행사)는 따로 묶는다
  const companyEventShorts = [...new Set((c.events||[]).map(e => e.short))];
  companyEventShorts.forEach(short => {
    const items = COMPANY_SECTORS.filter(s => parseSectorScope(nameOf(s)).eventShort === short);
    groupsHtml += section(short, items, true, false);
  });

  const pop = document.createElement('div');
  pop.id = 'co-sector-popover';
  pop.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${rect.left}px;background:var(--W);border:1px solid var(--i6);border-radius:var(--r);padding:10px 12px;width:280px;max-height:360px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.16);z-index:9999`;
  pop.onclick = e => e.stopPropagation();
  pop.innerHTML = `
    <div style="font-size:var(--fs-11);color:var(--i4);margin-bottom:8px">섹터 선택 (복수 가능) — 이 기업의 분야 안에서 먼저 보여요. 다른 분야는 «더 보기»를 눌러 펼쳐요</div>
    ${groupsHtml || '<div style="font-size:var(--fs-12);color:var(--i4)">등록된 섹터 없음</div>'}
    <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:10px">
      <button class="btn bs" style="font-size:var(--fs-11);padding:2px 8px" onclick="closeCoSectorPopover()">취소</button>
      <button class="btn bp" style="font-size:var(--fs-11);padding:2px 8px" onclick="saveCoSector('${escAttr(key)}')">저장</button>
    </div>`;
  document.body.appendChild(pop);
  setTimeout(() => document.addEventListener('mousedown', handleCoSectorOutsideClick), 0);
}

/* 기업의 섹터 배열을 교체하고 연락처 beat/companies 시트에 반영 — 섹터 선택
   팝오버 저장과 드래그&드롭 이동이 이 로직을 공유한다. */
export function applyCoSectors(c, newSectors){
  c.sectors = newSectors;
  c.sector  = newSectors[0] || '';
  const el = document.getElementById('co-sector-' + c.key);
  if(el) el.textContent = newSectors.join(', ') || '미분류';
  const beatVal = joinSectors(newSectors);
  // ⚠ 수정: 기존엔 소속 연락처 전원에게 개별 POST를 병렬 발사해서
  // (연락처 100명이면 100개 동시 요청) Apps Script 과부하로 일부만
  // 성공하는 불일치가 있었다 — batchUpsert 한 번으로 묶는다.
  const changedContacts = [];
  c.contacts.forEach(ct => {
    const contact = contacts.find(x => x.id === ct.id);
    if(contact){
      contact.beat = beatVal;
      changedContacts.push(contact);
    }
  });
  if(changedContacts.length){
    postToSheet({
      sheet: 'contacts',
      action: 'batchUpsert',
      rows: changedContacts.map(ct2 => [ct2.id,ct2.nameKo,ct2.nameEn,ct2.orgKo,ct2.orgEn,
        ct2.titleKo,ct2.titleEn,ct2.deptKo,ct2.deptEn,
        ct2.country,ct2.cat,ct2.lang,ct2.source,ct2.date,
        ct2.status,ct2.email1,ct2.email2,ct2.phone1,ct2.phone2,
        ct2.beat,ct2.products,ct2.tags||'',ct2.org_id||'']),
    }, '기업 섹터 반영');
  }
  upsertCompanyRow(c);
}

export function saveCoSector(key){
  const pop = document.getElementById('co-sector-popover');
  const checkboxes = pop ? pop.querySelectorAll('input[type=checkbox]:checked') : [];
  const newSectors = [...checkboxes].map(cb => cb.value);
  const c = CO_DB.find(x => x.key === key);
  if(c){
    applyCoSectors(c, newSectors);
    buildCoCAT();
    renderCoList();
  }
  closeCoSectorPopover();
}

/* ══════════════════════════════════════════
   기업 리스트 → 사이드바 섹터로 드래그&드롭 이동 (신규)
   드래그한 기업의 섹터를 드롭한 섹터 하나로 통째로 교체한다("이동" 의미 —
   기존에 여러 섹터가 있었어도 드롭한 섹터 하나로 대체됨).
══════════════════════════════════════════ */
export function onCoDragStart(e, key){
  coUi.draggedCoKey = key;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', key); // Firefox 등에서 드래그 시작 요건 충족용
}
export function onCoDropToSector(e, sectorName){
  e.preventDefault();
  const key = coUi.draggedCoKey;
  coUi.draggedCoKey = null;
  if(!key || !sectorName) return;
  const c = CO_DB.find(x => x.key === key);
  if(!c) return;
  const beforeSectors = (c.sectors || []).join(', ');
  applyCoSectors(c, [sectorName]);
  trackAction('edit', '기업 섹터 이동(드래그)', c.nameKo||c.nameEn,
    `"${c.nameKo||c.nameEn}" 섹터를 드래그해서 "${parseSectorScope(sectorName).plainName}"(으)로 변경`,
    changed('orgs', c.key, { sector: beforeSectors }, { sector: sectorName },
      { kind: 'company', id: c.key, field: 'sectors' }));
  buildCoCAT();
  renderCoList();
  if(selCo === key) renderCoDetail(c);
  if(!selCo) renderCoDashboard();
}

/* ── 카테고리 코드 부여 (prefix 선택 UI) — 원본에서 이미 인라인 방식이었음 (원본 4444~4459행) ── */
export function showAssignCatCodeUI(key){
  const el = document.getElementById('co-catcode-' + key);
  if(!el) return;
  const opts = CATEGORY_CODES.map(cc => `<option value="${cc.code}">${cc.code} · ${escapeHtml(cc.label)}</option>`).join('');
  el.innerHTML = `<select id="co-catcode-sel-${escapeHtml(key)}" class="fi" style="font-size:var(--fs-11);padding:2px 6px" onchange="doAssignCatCode('${escAttr(key)}')">
    <option value="">prefix 선택</option>${opts}
  </select>`;
}
export function doAssignCatCode(key){
  const c = CO_DB.find(x => x.key === key);
  const sel = document.getElementById('co-catcode-sel-' + key);
  if(!c || !sel || !sel.value) return;
  assignCategoryCode(c, sel.value);
  renderCoDetail(c);
  renderCoList();
}
/* «기업 화면에서 행사 참여 이력 직접 추가»은 ../features/companies/add-co-event.js로 떼어 냈다 — 그 파일이 스스로 window에 건다 */


/* 화면의 onclick이 부르는 것 */
window.onCoDragStart = onCoDragStart;
window.onCoDropToSector = onCoDropToSector;
window.editCoSector = editCoSector;
window.editCoNameKo = editCoNameKo;
window.editCoNameEn = editCoNameEn;
window.editCoNotes = editCoNotes;
window.editCoProducts = editCoProducts;
window.editCoDomain = editCoDomain;
window.closeCoDomainPopover = closeCoDomainPopover;
window.editCoPhone = editCoPhone;
window.saveCoRepFromContact = saveCoRepFromContact;
window.editCoAddress = editCoAddress;
window.editCoIntro = editCoIntro;
window.fillCoIntroFromPdf = fillCoIntroFromPdf;
window.editCoEmail = editCoEmail;
window.editCoWebsite = editCoWebsite;
window.editCoCountry = editCoCountry;
window.editCoAbbr = editCoAbbr;
window.editCoSource = editCoSource;
window.editCoBizNo = editCoBizNo;
window.editCoKind = editCoKind;
window.saveCoSector = saveCoSector;
window.closeCoSectorPopover = closeCoSectorPopover;
window.showAssignCatCodeUI = showAssignCatCodeUI;
window.doAssignCatCode = doAssignCatCode;
window.coDomainPill = coDomainPill;   // 탭(company-tab.js)이 window로 부른다
