/* ══════════════════════════════════════════════════════════════
   features/companies/co-detail.js — 기업 상세 화면
   (modules/company-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { postToSheet } from '../../api.js';
import { RP, avB, avF } from '../../constants.js';
import { trackAction } from '../../core/audit-log.js';
import { buildCoDB } from '../../domain/co-db.js';
import { abbrOf, normalizeCompanyKey, orgKindOf } from '../../domain/org-names.js';
import { applyOrgLocal, batchUpsertCompanies, patchOrgFields, upsertCompanyRow } from '../../domain/org-save.js';
import { ensureOrgsForNames, orgIdForName, reloadOrgs, suggestSector } from '../../domain/orgs.js';
import { joinSectors } from '../../domain/sectors.js';
import { CO_DB, ORGS, coTab, findOrgByName, orgName, selCo, setCoTab } from '../../state.js';
import { escAttr, escapeHtml, parseLinks, safeUrl } from '../../utils.js';
import { backToCoList, buildCoCAT, coListLabel, renderCoList, shortDate } from '../../modules/company-tab.js';

/* ══════════════════════════════════════════
   renderCoDetail — 기업 상세 화면 (원본 3623~3683행)
   editCoSector/editCoNotes/... 클릭 시 인라인 편집으로 전환되는 span들을 렌더링
══════════════════════════════════════════ */
export function renderCoDetail(c){
  const i=CO_DB.findIndex(x=>x.key===c.key);
  // 역할별로 어느 행사에서 쓰였는지 함께 추적 (같은 역할이 여러 행사에 걸쳐 있으면 툴팁으로 구분)
  const roleEvMap={};
  c.events.forEach(e=>e.roles.forEach(r=>{
    if(!roleEvMap[r]) roleEvMap[r]=new Set();
    roleEvMap[r].add(e.short||e.name);
  }));
  const roles=Object.keys(roleEvMap);
  const yrs=c.events.map(e=>+e.year);
  const cdhEl = document.getElementById('cdh');
  if(cdhEl) cdhEl.innerHTML=`
    <div style="margin-bottom:10px">
      <button onclick="backToCoList()" style="background:none;border:none;cursor:pointer;color:var(--i3);font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;padding:0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        ${escapeHtml(coListLabel())} 목록
      </button>
    </div>
    <div class="cdt2">
      <div class="cdl" style="background:${avB(i)};color:${avF(i)}">${escapeHtml(c.abbr)}</div>
      <div style="flex:1;min-width:0">
        ${(() => {
          /* 이름 — 있는 쪽을 제목으로 삼는다. 전에는 국문이 없으면 '국문명 추가'라는
             안내가 제목 자리에 앉고 영문 사명이 그 뒤에 붙어, 회사 이름이
             "국문명 추가 SML Meditree"로 읽혔다. 없는 것은 아래 줄로 내린다. */
          const ko = c.nameKo || '', en = c.nameEn || '';
          const edKo = `editCoNameKo('${escAttr(c.key)}')`, edEn = `editCoNameEn('${escAttr(c.key)}')`;
          /* 인라인 편집기가 #co-nameKo-<key> / #co-nameEn-<key> 를 찾아 그 자리를
             입력칸으로 바꾼다 — 이름이 어느 줄에 있든 id는 따라다녀야 한다. */
          const fid = (f) => `co-${f}-${escapeHtml(c.key)}`;
          const title = (f, txt, on) => `<div class="cdn"><span id="${fid(f)}" style="cursor:pointer" onclick="${on}">${escapeHtml(txt)}</span></div>`;
          const sub = (f, txt, on) => `<div style="font-size:12.5px;color:var(--i4);margin-bottom:2px"><span id="${fid(f)}" style="cursor:pointer" onclick="${on}">${escapeHtml(txt)}</span></div>`;
          const add = (f, txt, on) => `<div style="font-size:11px;color:var(--i5);margin-bottom:2px">＋ <span id="${fid(f)}" style="cursor:pointer" onclick="${on}">${escapeHtml(txt)}</span></div>`;
          if(ko && en) return title('nameKo', ko, edKo) + sub('nameEn', en, edEn);
          if(ko)       return title('nameKo', ko, edKo) + add('nameEn', '영문명 추가', edEn);
          if(en)       return title('nameEn', en, edEn) + add('nameKo', '국문명 추가', edKo);
          return title('nameKo', '(이름 없음)', edKo) + add('nameEn', '영문명 추가', edEn);
        })()}

        <div class="cdmt">
          ${(() => { const k = orgKindOf(c.kind); return k
            ? `<span class="pill ${k.cls}" style="cursor:pointer" onclick="editCoKind('${escAttr(c.key)}')" title="클릭하여 기업 종류 변경">${escapeHtml(k.label)}</span>`
            : `<span class="pill p-gray" style="cursor:pointer" onclick="editCoKind('${escAttr(c.key)}')">종류 지정</span>`; })()}
          ${window.coDomainPill(c)}
          <span class="pill ${c.sector ? 'p-blue' : 'p-gray'}" style="cursor:pointer" onclick="editCoSector('${escAttr(c.key)}')" title="클릭하여 섹터 변경">
            <span id="co-sector-${escapeHtml(c.key)}">${escapeHtml(c.sectors && c.sectors.length ? c.sectors.join(' · ') : '미분류')}</span></span>
          ${c.catCode ? `<span class="btag main" id="co-catcode-${escapeHtml(c.key)}">${escapeHtml(c.catCode)}</span>`
            : `<span id="co-catcode-${escapeHtml(c.key)}"></span>`}
          ${c.aliases.length
            // 사명이 바뀐 회사는 옛 이름으로 찾는 사람이 있다 — 여기 남겨두면 헛걸음하지 않는다
            ? `<span style="color:var(--i4)" title="예전 이름 — 이 이름으로도 검색됩니다">↩ ${escapeHtml(c.aliases.join(', '))}</span>`
            : ''}
        </div>

        ${(() => {
          /* 아래 줄은 "적어 둔 것"만 보여준다. 전에는 빈 칸까지 전부 늘어놓아
             웹사이트·메모·국가·약어·출처·사업자번호 여섯 개의 '추가' 안내가
             실제 값과 같은 무게로 섞였다 — 화면의 대부분이 아직 없는 정보였다.
             비어 있는 것은 맨 끝 '＋ 정보 추가'에 접어 두고, 누르면 그 자리에서 편다. */
          const F = [
            ['website', '웹사이트', c.website, `editCoWebsite('${escAttr(c.key)}')`, true],
            ['country', '국가',     c.country, `editCoCountry('${escAttr(c.key)}')`, false],
            ['hq',      '본사',     c.hq,      '', false],
            ['bizNo',   '사업자번호', c.bizNo,  `editCoBizNo('${escAttr(c.key)}')`, false],
            ['abbr',    '약어',     c.abbr,    `editCoAbbr('${escAttr(c.key)}')`, false],
            ['source',  '출처',     c.source,  `editCoSource('${escAttr(c.key)}')`, false],
            ['phone',   '대표 전화', c.phone,   `editCoPhone('${escAttr(c.key)}')`, false],
            ['email',   '대표 메일', c.email,   `editCoEmail('${escAttr(c.key)}')`, false],
            ['products','취급 품목', c.products, `editCoProducts('${escAttr(c.key)}')`, false],
            ['address', '주소',     c.address, `editCoAddress('${escAttr(c.key)}')`, false],
            ['intro',   '회사소개', c.intro,   `editCoIntro('${escAttr(c.key)}')`, false],
            ['notes',   '메모',     c.notes,   `editCoNotes('${escAttr(c.key)}')`, false],
          ];
          const has = F.filter(f => String(f[2] || '').trim());
          const gap = F.filter(f => !String(f[2] || '').trim() && f[3]);

          /* 한 칸에 주소가 여럿이면 각각 링크로 그린다 — 통째로 걸면
             하나도 제대로 안 열린다. 괄호에 적힌 설명은 이름표로 옆에 둔다. */
          const linksHtml = (val) => parseLinks(val).map(({ url, label }) => {
            const href = safeUrl(url);
            const a = href
              ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(url)}</a>`
              : escapeHtml(url);
            return a + (label ? ` <span style="color:var(--i5);font-size:10px">${escapeHtml(label)}</span>` : '');
          }).join('<span style="color:var(--i6)"> · </span>');

          /* 값 칸은 white-space:pre-line이라(메모의 줄바꿈을 살리려고) 태그 사이
             들여쓰기 줄바꿈까지 그대로 줄이 된다 — 여는 태그 바로 뒤에 붙여 쓴다 */
          const row = ([id, label, val, on, isLink]) => `
            <div style="display:flex;gap:8px;align-items:baseline;padding:2px 0;font-size:11.5px">
              <span style="flex:0 0 62px;color:var(--i5)">${escapeHtml(label)}</span>
              <span style="flex:1;min-width:0;color:var(--i2);white-space:pre-line;${on ? 'cursor:pointer' : ''}" ${on ? `onclick="${on}"` : ''}><span id="co-${id}-${escapeHtml(c.key)}">${
                  isLink && val ? linksHtml(val)
                    : val ? escapeHtml(val)
                    /* 빈 줄은 누를 자리가 없으면 편집으로 들어갈 수 없다 — 옅은 안내를 둔다 */
                    : `<span style="color:var(--i5)">입력</span>`}</span></span>
            </div>`;

          return `<div style="margin-top:7px">
            ${has.map(row).join('')}
            <div id="co-gaps-${escapeHtml(c.key)}" style="display:none">${gap.map(row).join('')}</div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:5px">
              ${gap.length ? `<button id="co-gaps-btn-${escapeHtml(c.key)}" class="btn bs" style="font-size:10.5px;padding:2px 8px"
                onclick="toggleCoGaps('${escAttr(c.key)}')">＋ 정보 추가 ${gap.length}</button>` : ''}
              ${c.catCode ? '' : `<button class="btn bs" style="font-size:10.5px;padding:2px 8px"
                onclick="showAssignCatCodeUI('${escAttr(c.key)}')">코드 부여</button>`}
              <button class="btn bs" style="font-size:10.5px;padding:2px 8px" title="업체가 보낸 소개서·견적서 PDF를 읽어 회사소개를 채웁니다"
                onclick="fillCoIntroFromPdf('${escAttr(c.key)}')">📄 소개서 PDF로 채우기</button>
              <span id="co-pdf-msg-${escapeHtml(c.key)}" style="font-size:10.5px;color:var(--i4)"></span>
              <span style="margin-left:auto;color:var(--i5);font-size:10.5px" title="${escapeHtml(c.updatedAt || '')}">${escapeHtml(shortDate(c.updatedAt) || '')}</span>
            </div>
          </div>`;
        })()}
      </div>
    </div>
    <div class="cost">
      <div class="cosi"><div class="cosn">${c.events.length}</div><div class="cosl">총 참여 행사</div></div>
      <div class="cosi"><div class="cosn">${c.contacts.length}</div><div class="cosl">등록 담당자</div></div>
      <div class="cosi"><div class="cosn">${yrs.length?Math.min(...yrs):'-'}</div><div class="cosl">첫 참여</div></div>
      ${(() => { const t = window.tradeTotals(c); return t.billed || t.balance
        ? `<div class="cosi"><div class="cosn" style="font-size:15px">${window.tradeMoney(t, 'billed')}</div><div class="cosl">누적 청구</div></div>
           <div class="cosi"><div class="cosn" style="font-size:15px;color:${t.balance > 0 ? 'var(--re)' : 'var(--ge)'}">${window.tradeMoney(t, 'balance')}</div><div class="cosl">미수금</div></div>`
        : ''; })()}
      <div class="cosi"><div class="cosn" style="display:flex;gap:3px;flex-wrap:wrap">${roles.map(r=>`<span class="pill ${RP[r]||'p-gray'}" title="${escapeHtml([...roleEvMap[r]].join(', '))}">${escapeHtml(r)}</span>`).join('')}</div><div class="cosl">유형</div></div>
    </div>
    <div class="cobr">${c.branches.map(b=>`<span class="btag${b===c.mainBranch?' main':''}">${escapeHtml(b)}</span>`).join('')}</div>`;
  const tabs=['행사 참여 이력','거래','담당자','요약'];
  const tabsEl = document.getElementById('cotabs');
  if(tabsEl) tabsEl.innerHTML=tabs.map((t,k)=>`<div class="cotab${coTab===k?' on':''}" onclick="switchCoT(${k})">${t}</div>`).join('');
  window.renderCoBody(c);
}
/* 비어 있는 항목 펼치기/접기 — 새로 들어온 회사는 대부분이 빈칸이라
   기본은 접어 둔다. 채우려고 열었을 때만 보이면 된다. */
export function toggleCoGaps(key){
  const box = document.getElementById('co-gaps-' + key);
  const btn = document.getElementById('co-gaps-btn-' + key);
  if(!box) return;
  const on = box.style.display === 'none';
  box.style.display = on ? 'block' : 'none';
  if(btn) btn.textContent = on ? '접기' : ('＋ 정보 추가 ' + box.children.length);
}

export function switchCoT(k){
  setCoTab(k);
  const c=CO_DB.find(x=>x.key===selCo);
  document.querySelectorAll('.cotab').forEach((t,j)=>t.classList.toggle('on',j===k));
  window.renderCoBody(c);
}

/* 3개 함수를 ../domain/org-save.js로 옮겼다 — 이 파일에서도 쓰고, 옛 경로로 가져가는 곳도 있어 다시 내보낸다 */
/* (옮기며 뺀 import — 머리 import가 대신한다) */

/* 4개 함수를 ../domain/orgs.js로 옮겼다 — 이 파일에서도 쓰고, 옛 경로로 가져가는 곳도 있어 다시 내보낸다 */
/* (옮기며 뺀 import — 머리 import가 대신한다) */

/* ── 기업 신규 등록 ──
   전에는 기업이 연락처에서 파생됐기 때문에, 담당자를 모르는 회사는 등록할 방법이
   아예 없었다. 잠재 고객사나 시공 벤더를 먼저 적어두고 나중에 사람을 붙일 수 있게
   한다. 이름이 같은 기업(옛 이름 포함)이 이미 있으면 새로 만들지 않고 알린다. */
export async function createOrg({ nameKo, nameEn, kind, sectors, country, website, bizNo, notes, products, phone, email }){
  const name = (nameKo || nameEn || '').trim();
  if(!name) return { ok: false, error: '기업명을 입력해주세요.' };

  const dup = findOrgByName(name, normalizeCompanyKey);
  if(dup) return { ok: false, error: `이미 등록된 기업이에요 — ${orgName(dup)}`, org: dup };

  const now = new Date().toISOString();
  const rec = {
    name_ko: nameKo || '', name_en: nameEn || '', abbr: abbrOf(name), aliases: '',
    kind: kind || '잠재고객사', status: '활성',
    sectors: joinSectors(sectors || []), country: country || '', hq: country || '',
    website: website || '', biz_no: bizNo || '', cat_code: '', notes: notes || '',
    products: products || '', phone: phone || '', email: email || '',
    source: '수동 등록', created_at: now, updated_at: now,
  };
  const r = await postToSheet({ sheet: 'orgs', action: 'upsert', data: rec }, '기업 등록');
  if(!r.ok) return { ok: false, error: '저장에 실패했어요.' };

  ORGS.push({ id: r.id, ...rec });
  buildCoDB(); buildCoCAT(); renderCoList();
  trackAction('add', '기업 등록', name, `<b>${escapeHtml(name)}</b> 등록`);
  return { ok: true, id: r.id };
}

// ── 카테고리 코드 부여 (PREFIX-NNN, 이미 있으면 재계산하지 않음) (원본 4269~4281행) ──
export function assignCategoryCode(company, prefix){
  if(company.catCode) return;
  let maxSeq = 0;
  CO_DB.forEach(co => {
    if(co.catCode && co.catCode.startsWith(prefix+'-')){
      const seq = parseInt(co.catCode.slice(prefix.length+1), 10);
      if(!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  });
  company.catCode = `${prefix}-${String(maxSeq+1).padStart(3,'0')}`;
  upsertCompanyRow(company);
}


/* 화면의 onclick이 부르는 것 */
window.switchCoT = switchCoT;
window.toggleCoGaps = toggleCoGaps;
window.createOrg = createOrg;
window.renderCoDetail = renderCoDetail;   // 탭(company-tab.js)이 window로 부른다
