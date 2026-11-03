/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-dr-booth.js — 상세 창 독립부스 도면 검토·품목 고르기
   (modules/exh-drawer.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { trackAction } from '../../core/audit-log.js';
import { ieyo } from '../../country-signal.js';
import { SELF_BUILD_TYPE, boothDesignState, boothTypes, cleanEmail, contactsForExhibitor, exhContacts, exhLockNotice, exhLocked, exhNames, patchExh, refreshExhViews } from '../../modules/exh-tab.js';
import { EXH_CONTACTS, EXH_LOGS, catalogFor, contacts, contactsFor, currentUser, exhibitorsForEvent, findCatalogByName, getExhibitorById, getOrgById, logsFor, nextContactId, participations } from '../../state.js';
import { countryOptions, escAttr, escapeHtml, leftPill, td } from '../../utils.js';
import { modalShell } from './exh-book.js';
import { money } from './exh-calc.js';
import { exhDrUi } from './exh-drawer-ui.js';
import { cRoles, localId, saveExhContact, saveExhLog, saveFailed, setBuilderOrg, textRow } from '../../modules/exh-drawer.js';

/* ══════════════════════════════════════════
   독립부스 도면 검토

   자체 시공은 부스를 업체가 직접 짓는다. 그래서 시공사 연락처만 있으면 될 것
   같지만, 실제로는 "무엇을 지을 것인가"도 우리가 본다 — 높이 제한, 인접 부스
   가림, 통로 침범, 소방 규정. 2026 KIC만 18곳이 자체 시공이다.

   받았는지 · 봤는지 · 뭐라고 했는지 셋을 남긴다. 오간 말은 새 표를 만들지 않고
   문의·기록에 담는다(그래픽 피드백과 같은 방식) — 도면 얘기만 따로 모아 두면
   이 기업과 무슨 얘기가 오갔나를 두 군데서 봐야 한다.
══════════════════════════════════════════ */
export const boothDesignFeedback = (exhId) =>
  logsFor(exhId).filter(l => l.category === '부스도면' && l.kind === 'note');

export function boothDesignBlock(x){
  const isSelf = (x.booth_type || '') === SELF_BUILD_TYPE;
  const has = x.booth_design_received_at || x.booth_design_checked_at
    || x.booth_design_note || boothDesignFeedback(x.id).length;
  /* 조립부스는 우리가 짓는 것이라 도면을 받을 일이 없다. 다만 이미 적어둔 게
     있으면 타입을 나중에 고쳤어도 숨지 않게 그대로 보여준다. */
  if(!isSelf && !has) return '';

  const st = boothDesignState(x);
  const rows = boothDesignFeedback(x.id);
  const me = currentUser?.email || '';
  const dateCell = (f, label) => `<div class="fg"><label class="fl">${label}</label>
    <input type="date" class="fi" style="font-size:12px" value="${escapeHtml(x[f] || '')}"
      onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${label}')"></div>`;

  return `<div style="padding:9px 11px;background:var(--i9);border-radius:8px;border-left:3px solid ${
      st.state === 'warn' ? 'var(--re)' : st.state === 'done' ? 'var(--g)' : 'var(--a)'};margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:7px">
      <span style="font-size:11px;font-weight:700;color:var(--i2)">부스 도면 검토</span>
      <span class="pill ${{ none: 'p-gray', todo: 'p-amber', warn: 'p-red', done: 'p-green' }[st.state]}"
        style="font-size:9px">${escapeHtml(st.text)}</span>
      ${isSelf ? '' : '<span style="font-size:10px;color:var(--i5)">부스 타입은 자체 시공이 아니에요</span>'}
    </div>

    <div class="fgr">${dateCell('booth_design_received_at', '도면 받은 날')}${dateCell('booth_design_checked_at', '확인한 날')}</div>
    ${isSelf ? `<label style="display:flex;align-items:center;gap:6px;font-size:12px;margin:2px 0 8px;cursor:pointer">
      <input type="checkbox"${x.work_report_at ? ' checked' : ''}
        onchange="setExhField('${escAttr(x.id)}','work_report_at',this.checked ? '${td()}' : '','작업신고서 제출')">
      시공사가 호텔에 작업신고서 제출</label>` : ''}

    <div style="margin-top:2px">
      <label class="fl">확인 결과</label>
      <div class="stbs" style="margin:4px 0 8px">
        ${[['', '미확인'], ['ok', '적합'], ['fix', '수정 필요']].map(([v, l]) =>
          `<button class="stb${(x.booth_design_result || '') === v ? ' on' : ''}"
            onclick="setBoothDesignResult('${escAttr(x.id)}','${v}')">${l}</button>`).join('')}
      </div>
      ${textRow(x, 'booth_design_note', '확인 메모 — 무엇을 봤나요',
        '예: 높이 3.5m 초과, 통로 쪽 벽면 후퇴 필요', true)}
    </div>

    <div style="border-top:1px solid var(--i7);margin-top:8px;padding-top:8px">
      <div style="font-size:11px;color:var(--i4);margin-bottom:6px">
        오간 말은 <b>문의·기록</b> 탭에도 함께 남아요. 남기는 사람은
        <b>${escapeHtml(currentUser?.name || currentUser?.email || '(로그인 정보 없음)')}</b>으로 적힙니다.</div>
      <textarea class="fi" id="bdf-${escAttr(x.id)}" rows="2"
        placeholder="예: 시공사에 3.5m 이하로 낮춰 재도면 요청, 9/10까지 회신 약속"
        style="width:100%;resize:vertical;font-size:12px"></textarea>
      <div style="display:flex;justify-content:flex-end;margin-top:6px">
        <button class="btn bp bs" onclick="addBoothDesignFeedback('${escAttr(x.id)}')">피드백 남기기</button>
      </div>
      ${rows.length ? rows.map(l => `
        <div style="padding:7px 0;border-top:1px solid var(--i8)">
          <div style="display:flex;align-items:baseline;gap:6px;flex-wrap:wrap">
            <span style="font-size:11.5px;font-weight:700">${escapeHtml(l.author_name || l.author_email || '알 수 없음')}</span>
            ${l.subject ? `<span class="pill p-gray" style="font-size:9px">${escapeHtml(l.subject)}</span>` : ''}
            <span style="font-size:10px;color:var(--i5)">${escapeHtml(l.ts || '')}</span>
            ${l.author_email && l.author_email === me
              ? `<button class="btn bs" style="margin-left:auto;font-size:10px;padding:1px 6px"
                  onclick="delGraphicFeedback('${escAttr(l.id)}')">삭제</button>` : ''}
          </div>
          <div style="font-size:12px;color:var(--i2);white-space:pre-wrap;margin-top:3px">${escapeHtml(l.body || '')}</div>
        </div>`).join('')
        : '<div style="font-size:11.5px;color:var(--i5);margin-top:8px">아직 남긴 피드백이 없어요</div>'}
    </div>
  </div>`;
}

/* 결과를 누르면 확인한 날도 함께 채운다 — 결과를 적었다는 건 본 것이다.
   날짜를 따로 누르게 하면 절반은 비어 있게 된다. */
export async function setBoothDesignResult(exhId, v){
  const x = getExhibitorById(exhId);
  if(!x) return;
  const patch = { booth_design_result: v };
  if(v && !x.booth_design_checked_at) patch.booth_design_checked_at = td();
  await patchExh(exhId, patch, '부스 도면 확인');
}

export async function addBoothDesignFeedback(exhId){
  const ta = document.getElementById(`bdf-${exhId}`);
  const body = ta?.value.trim() || '';
  if(!body){ ta?.focus(); return; }
  const x = getExhibitorById(exhId);
  const st = boothDesignState(x || {});

  const ok = await window.addRow(EXH_LOGS, {
    id: localId('XL-'), exhibitor_id: exhId, kind: 'note', ts: td(),
    direction: '', channel: '', counterpart: '', category: '부스도면',
    subject: st.text || '', body, answered_at: '', answer: '', status: 'done',
    author_email: currentUser?.email || '', author_name: currentUser?.name || '',
  }, saveExhLog);

  const el = document.getElementById(`bdf-${exhId}`);
  if(!ok){ if(el){ el.value = body; el.focus(); } return; }
  if(el) el.value = '';
  trackAction('log', '부스 도면 피드백', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> 부스 도면(${escapeHtml(st.text)}): ${escapeHtml(body.slice(0, 40))}`,
    { kind: 'exhibitor', id: x?.id, tab: 'progress' });
}

/* ── 렌탈 비품 카탈로그 ──
   비품 이름을 손으로 적으면 같은 의자가 "접이식 체어", "C-040 Folding Chair",
   "폴딩체어"로 제각각 들어와 발주 합계가 갈라지고 단가도 매번 다시 찾아야 한다.
   행사 카탈로그를 골라 넣으면 이름·규격·단가가 한 번에 채워지고, 어떤 품목인지
   id로 이어져 집계가 표기에 흔들리지 않는다.

   자유 입력도 그대로 둔다 — 카탈로그 밖의 품목(그래픽 랩핑, 전기 등)이 실제로
   들어오기 때문에 목록에 없다고 못 적게 하면 안 된다. */
/* 고른 분류에 맞는 것만 보여준다. 예전에는 비품과 그래픽을 한 목록에 담아
   놓고 분류와 상관없이 늘 같은 걸 띄웠다 — «부스»를 골라 놓고 의자 목록을
   훑게 되고, 거기서 잘못 고르면 분류와 품목이 어긋난 줄이 저장된다.

   차림은 품목코드 순이다. 발주서와 렌탈사 카탈로그가 코드 순이라, 다른
   순서로 두면 눈으로 짚어 가며 맞춰야 한다.

   부스는 카탈로그가 아니라 부스 타입 목록에서 온다(그게 실제로 청구하는
   단위다). 기타는 목록을 주지 않는다 — 카탈로그 밖이라는 뜻이라서, 목록이
   있으면 그게 곧 «여기 있는 걸 골라라»라는 말이 된다. */
const byCode = (a, b) =>
  String(a.code || '힣').localeCompare(String(b.code || '힣'), 'ko', { numeric: true });

function itemCatalogFor(evKey, cat){
  if(cat === 'booth') return boothTypes(evKey)
    .map(t => ({ value: t.code, desc: t.label && t.label !== t.code ? t.label : '', code: t.code }));
  if(cat === 'etc') return [];
  return catalogFor(evKey, cat === 'graphic' ? 'graphic' : 'equip')
    .slice().sort(byCode)
    .map(c => ({
      value: `${c.code} ${c.name_ko}`,
      code: c.code,
      desc: [c.name_en, c.spec, c.price_krw && money(c.price_krw) + '원'].filter(Boolean).join(' · '),
    }));
}

export const itemListId = (x, cat) => `eqcat-${escAttr(x.id)}-${cat}`;

export function catalogDatalist(x){
  return window.itemCats().map(({ code: cat }) => {
    const list = itemCatalogFor(x.event_id, cat);
    if(!list.length) return '';
    return `<datalist id="${itemListId(x, cat)}">${list.map(o =>
      `<option value="${escapeHtml(o.value)}">${escapeHtml(o.desc)}</option>`).join('')}</datalist>`;
  }).join('');
}

/* ── 비품·그래픽은 품목표에서 골라야만 들어간다 ──
   예전에는 목록에 없는 이름을 적으면 품목마스터에 X-코드로 자동 등록했다.
   그러다 «인포데스크»가 D-029, «프리미엄 인포데스크», «하이인포데스크»처럼
   표기만 다른 품목 세 개로 갈라져 발주 합계가 흩어지고, 단가 없는 품목이
   0원으로 청구됐다. 이제는 글자로 짐작하지 않는다 — 목록에 없으면 설정의
   품목표에 먼저 올리고 고른다. 부스·기타는 품목표가 없으니 그대로 적는다. */
export const needsCatalog = (cat) => cat === 'equip' || cat === 'graphic';
export function catalogPickMissing(exhId){
  const cat = window.val(`it-cat-${exhId}`) || 'etc';
  if(!needsCatalog(cat)) return false;
  if(document.getElementById(`it-nm-${exhId}`)?.dataset.catalogId) return false;
  alert('비품·그래픽은 품목표 목록에서 골라 주세요.\n목록에 없는 품목이면 설정 › 비품 목록에 먼저 추가하세요.');
  document.getElementById(`it-nm-${exhId}`)?.focus();
  return true;
}

/* 카탈로그에서 고른 값이면 단가·분류를 대신 채운다. 손으로 적던 값은 건드리지 않는다. */
export function pickCatalogItem(exhId){
  const x = getExhibitorById(exhId);
  if(!x) return;
  const nameEl = document.getElementById(`it-nm-${exhId}`);
  if(!nameEl) return;
  const typed = nameEl.value.trim();
  /* 목록에서 고른 값(«코드 품명») 먼저, 없으면 코드·국문명·영문명까지 훑는다.
     코드만 치고 넘어가는 일이 실제로 가장 잦은데(«D-029»), 완전일치만 보던
     때는 그때마다 단가를 손으로 적어야 했다. 국문명이 빈 영문 전용 품목은
     목록에서 골라도 값 끝에 공백이 남아 매칭이 빗나갔다 — 그것도 여기서 걸린다. */
  const hit = catalogFor(x.event_id).find(c => `${c.code} ${c.name_ko}`.trim() === typed)
    || findCatalogByName(x.event_id, typed);
  // 고른 뒤 글자를 고치면 더는 그 품목이 아니다 — 남은 id로 엉뚱한 품목에 붙지 않게
  if(!hit){ delete nameEl.dataset.catalogId; return; }

  /* 코드만 쳤으면 품명까지 채워 준다 — 저장된 이름이 기업마다 갈리지 않게 */
  if(String(hit.code || '').toLowerCase() === typed.toLowerCase()){
    nameEl.value = `${hit.code} ${hit.name_ko || hit.name_en || ''}`.trim();
  }

  const up = document.getElementById(`it-up-${exhId}`);
  const cur = document.getElementById(`it-cur-${exhId}`);
  const cat = document.getElementById(`it-cat-${exhId}`);
  // 품목표에 비품과 그래픽이 함께 있다 — 고른 품목의 종류대로 분류를 맞춰 둔다
  const kind = (hit.kind || 'equip') === 'graphic' ? 'graphic' : 'equip';
  if(cat){ cat.value = kind; exhDrUi.lastItemCat = kind; window.markItemCat(exhId, kind); }
  if(up && !up.value.trim()){
    up.value = (cur && cur.value === 'USD') ? (hit.price_usd || '') : (hit.price_krw || '');
  }
  window.calcItemAmount(exhId);
  nameEl.dataset.catalogId = hit.id;
}

/* ── 남의 회사 사람이 들어왔는지 본다 ──

   실제로 셀타스퀘어 담당자 세 명이 시믹코리아 담당자로 들어간 적이 있다.
   드로어 머리에 기업명이 떠 있어도, 메일에서 이름·주소를 옮겨 적다 보면
   지금 누구 화면인지 놓친다. 사람이 알아채기를 기다리는 대신 화면이 먼저 묻는다.

   판단 근거는 이 기업의 마스터DB 연락처가 쓰는 도메인이다. 근거가 없으면
   (마스터DB에 이메일이 하나도 없으면) 아무 말도 하지 않는다 — 모르면서
   경고하면 다들 무시하게 된다. 회사 메일이 아닌 곳(gmail 등)도 넘어간다. */
const FREE_MAIL = ['gmail.com', 'naver.com', 'daum.net', 'hanmail.net', 'kakao.com',
  'outlook.com', 'hotmail.com', 'icloud.com', 'yahoo.com'];
const mailDomain = (v) => {
  const m = String(v || '').match(/@([^\s>,;]+)/);
  return m ? m[1].toLowerCase().replace(/[^a-z0-9.-]/g, '') : '';
};

function foreignDomain(email, cands){
  const d = mailDomain(email);
  if(!d || FREE_MAIL.includes(d)) return '';
  const own = new Set(cands.map(c => mailDomain(c.email1)).filter(x => x && !FREE_MAIL.includes(x)));
  if(!own.size) return '';           // 견줄 근거가 없으면 말하지 않는다
  return own.has(d) ? '' : [...own].join(', ');
}

export function dContact(x){
  const list = exhContacts(x);
  const cands = contactsForExhibitor(x);
  const usedIds = new Set(list.map(c => c.row.contact_id).filter(Boolean).map(String));
  // 아직 연결 안 된 마스터DB 연락처만 추가 후보로 보여준다
  const free = cands.filter(c => !usedIds.has(String(c.id)));

  const card = (p) => {
    const r = p.row;
    return `<div style="padding:9px 11px;background:var(--i9);border-radius:8px;border-left:3px solid ${p.primary ? 'var(--a)' : 'var(--i6)'};margin-bottom:6px">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <span style="font-size:13px;font-weight:700${p.linked ? ';cursor:pointer;text-decoration:underline dotted' : ''}"${p.linked
          ? ` onclick="openExhPerson('${escAttr(String(r.contact_id))}')" title="마스터DB 연락처 정보 보기"` : ''}>${escapeHtml(p.name || p.email || '이름 없음')}</span>${leftPill(p)}
        ${p.title ? `<span class="pill p-gray">${escapeHtml(p.title)}</span>` : ''}
        ${p.primary ? '<span class="pill p-blue">메인</span>' : ''}
        <select class="fi" style="width:74px;padding:2px 5px;font-size:10.5px;margin-left:auto"
          onchange="setExhContactField('${escAttr(r.id)}','role',this.value)">
          ${cRoles().map(v => `<option value="${escapeHtml(v.code)}"${(r.role || '기타') === v.code ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}
        </select>
      </div>
      <div style="font-size:11.5px;color:var(--i3);display:flex;flex-direction:column;gap:2px">
        ${p.email ? `<div>✉ <a href="mailto:${escAttr(p.email)}" style="color:var(--a)">${escapeHtml(p.email)}</a>${
          (() => {
            // 사유를 적어 둔 줄은 더 묻지 않는다 — 대행사가 대신 진행하는 기업처럼
            // 도메인이 다른 게 맞는 경우가 있고, 계속 경고하면 다들 무시하게 된다
            const memo = String(r.note || '').trim();
            if(memo) return `<span class="pill p-gray" style="margin-left:5px;cursor:help"
              title="${escapeHtml(memo)}">${escapeHtml(memo.length > 14 ? memo.slice(0, 14) + '…' : memo)}</span>`;
            const own = foreignDomain(p.email, cands);
            return own ? `<span class="pill p-amber" style="margin-left:5px;cursor:pointer"
              onclick="noteExhContact('${escAttr(r.id)}')"
              title="이 기업의 마스터DB 연락처는 ${escAttr(own)} 도메인을 씁니다. 다른 회사 사람을 잘못 넣은 건 아닌지 확인해주세요. 맞다면 눌러서 이유를 적어 두세요.">다른 도메인</span>` : '';
          })()
        }</div>` : ''}
        ${p.phone ? `<div>☎ ${escapeHtml(p.phone)}</div>` : ''}
        ${!p.linked ? `
          <div class="fgr" style="margin-top:5px">
            <input class="fi" style="font-size:11.5px;padding:5px" placeholder="이름" value="${escapeHtml(r.name || '')}"
              onchange="setExhContactField('${escAttr(r.id)}','name',this.value)">
            <input class="fi" style="font-size:11.5px;padding:5px" placeholder="이메일" value="${escapeHtml(r.email || '')}"
              onchange="setExhContactField('${escAttr(r.id)}','email',this.value)">
          </div>
          <input class="fi" style="font-size:11.5px;padding:5px;margin-top:4px" placeholder="연락처" value="${escapeHtml(r.phone || '')}"
            onchange="setExhContactField('${escAttr(r.id)}','phone',this.value)">` : ''}
      </div>
      <div style="display:flex;gap:5px;margin-top:7px;align-items:center;flex-wrap:wrap">
        <span style="font-size:10px;color:${p.linked ? 'var(--a)' : 'var(--am)'}"
          title="${p.linked ? '' : '이 사람은 이 전시에만 적혀 있어요 — 마스터DB에 없어서 다음 행사에 다시 쓸 수 없고, 행사 참여 이력에도 안 잡힙니다'}"
          >${p.linked ? '마스터DB 연결됨' : '마스터DB에 없음'}</span>
        ${!p.linked ? `<button class="btn bp bs" style="font-size:10px"
          onclick="promoteExhContact('${escAttr(x.id)}','${escAttr(r.id)}')"
          title="이 사람을 마스터DB 연락처로 등록하고 이 행사 참여로도 남깁니다">마스터DB로 올리기</button>` : ''}
        ${!p.primary ? `<button class="btn bs" style="margin-left:auto;font-size:10px" onclick="setPrimaryExhContact('${escAttr(r.id)}')">메인으로</button>` : '<span style="margin-left:auto"></span>'}
        <button class="btn bs" style="font-size:10px;opacity:.6" onclick="delExhContact('${escAttr(r.id)}')">삭제</button>
      </div>
    </div>`;
  };

  return `
  <div style="font-size:11px;color:var(--i5);margin-bottom:8px">
    이 전시에서 우리가 연락하는 사람들이에요. 실무·정산·현장이 다르면 여러 명 배정할 수 있어요.</div>

  ${list.length ? list.map(card).join('')
    : '<div style="font-size:11.5px;color:var(--i5);padding:6px 2px;margin-bottom:6px">아직 배정된 담당자가 없어요 — 아래에서 고르세요</div>'}

  <div style="display:flex;align-items:center;gap:8px;margin:16px 0 7px;padding-top:12px;border-top:1px solid var(--i7)">
    <span style="font-size:11px;font-weight:700;color:var(--i3)">이 기업의 마스터DB 연락처</span>
    <span style="font-size:10.5px;color:var(--i5)">${cands.length}명</span>
    <button class="btn bp bs" style="margin-left:auto;font-size:11px" onclick="openNewContact('${escAttr(x.id)}')">+ 직접 입력</button>
  </div>

  ${cands.length ? cands.map(c => {
    const on = usedIds.has(String(c.id));
    const sub = [c.titleKo || c.titleEn, c.deptKo || c.deptEn, cleanEmail(c.email1)].filter(Boolean).join(' · ');
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:7px;margin-bottom:4px;
      background:${on ? 'var(--ad)' : 'var(--W)'};border:1px solid ${on ? 'var(--a)' : 'var(--i7)'}">
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:600;cursor:pointer" onclick="openExhPerson('${escAttr(String(c.id))}')" title="마스터DB 연락처 정보 보기">${escapeHtml(c.nameKo || c.nameEn || '이름 없음')}${
          c.nameKo && c.nameEn ? `<span style="font-weight:400;color:var(--i4);margin-left:5px">${escapeHtml(c.nameEn)}</span>` : ''}</div>
        ${sub ? `<div style="font-size:10.5px;color:var(--i4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(sub)}</div>` : ''}
      </div>
      <button class="btn ${on ? 'bs' : 'bp bs'}" style="flex:0 0 auto;font-size:10.5px"
        onclick="${on ? `unassignExhContact('${escAttr(x.id)}','${escAttr(String(c.id))}')`
                      : `assignExhContact('${escAttr(x.id)}','${escAttr(String(c.id))}')`}"
        title="${on ? '이 전시 담당자에서 뺍니다 (마스터DB에는 그대로 남아요)' : '이 전시 담당자로 넣습니다'}">${
        on ? '배정 해제' : '배정'}</button>
    </div>`;
  }).join('')
  : `<div style="font-size:11.5px;color:var(--am);padding:8px 2px">
      이 기업 연락처가 마스터DB에 없어요 — <b>직접 입력</b>으로 추가하면 마스터DB에도 함께 등록됩니다</div>`}
  ${mailCandidates(x, list, cands)}`;
}

/* ── 메일함에 나온 주소 중 아직 담당자가 아닌 사람 ──
   메일을 주고받다 보면 참조로 다른 담당자·시공사·대행사가 붙는다. 그 주소는 메일함에만
   있고 담당자 칸에는 없어서, 다음 메일을 쓸 때 또 메일을 뒤져야 했다.

   자동으로 넣지 않는다 — 이 사람이 기업 담당자인지, 이 기업 부스를 짓는 시공사인지,
   우리와 상관없는 사람인지는 사람이 보고 정한다. 화면은 후보와 판단 자료(도메인,
   몇 통에 나왔는지)만 보여 주고, 어디에 넣을지는 단추로 고르게 한다.

   여러 기업 메일에 두루 나오는 도메인(사무국·주관사·우리 쪽)은 후보에서 뺀다 —
   한 기업 사람이면 그 기업 메일에만 나온다. */
const MAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const hideKey = (ev) => `bloom.mailcand.hide.${ev}`;
const hiddenCands = (ev) => { try { return new Set(JSON.parse(localStorage.getItem(hideKey(ev)) || '[]')); } catch(e){ return new Set(); } };

/* "이름 <주소>, 주소2 (cc) 주소3" → [{ email, name }] */
function parseCounterpart(s){
  const out = [];
  String(s || '').replace(/\(cc\)/gi, ',').split(/[,;]/).forEach(part => {
    const m = part.match(MAIL_RE);
    if(!m) return;
    const name = part.replace(/<[^>]*>/g, '').replace(MAIL_RE, '').replace(/["']/g, '').trim();
    out.push({ email: m[0].toLowerCase(), name });
  });
  return out;
}

/* 이 행사에서 여러 기업 메일에 두루 나오는 도메인 — 우리 쪽이다 */
function sharedDomains(evKey){
  const seen = new Map();
  const ids = new Set(exhibitorsForEvent(evKey).map(e => e.id));
  EXH_LOGS.filter(l => ids.has(l.exhibitor_id) && l.channel === '이메일').forEach(l =>
    parseCounterpart(l.counterpart).forEach(({ email }) => {
      const d = mailDomain(email);
      if(!seen.has(d)) seen.set(d, new Set());
      seen.get(d).add(l.exhibitor_id);
    }));
  const own = mailDomain(currentUser?.email || '');
  const out = new Set([...seen].filter(([, s]) => s.size >= 4).map(([d]) => d));
  if(own) out.add(own);
  return out;
}

function mailCandidates(x, list, cands){
  const known = new Set([...list.map(p => p.email), ...cands.map(c => c.email1), ...cands.map(c => c.email2), x.builder_email]
    .map(e => cleanEmail(e || '').toLowerCase()).filter(Boolean));
  const shared = sharedDomains(x.event_id);
  const hidden = hiddenCands(x.event_id);
  const found = new Map();
  logsFor(x.id).filter(l => l.channel === '이메일').forEach(l =>
    parseCounterpart(l.counterpart).forEach(({ email, name }) => {
      if(known.has(email) || hidden.has(email) || shared.has(mailDomain(email))) return;
      const f = found.get(email) || { email, name: '', n: 0, last: '' };
      if(name && !f.name) f.name = name;
      f.n++;
      if(String(l.ts || '') > f.last) f.last = String(l.ts || '');
      found.set(email, f);
    }));
  if(!found.size) return '';
  const rows = [...found.values()].sort((a, b) => b.n - a.n || b.last.localeCompare(a.last));
  const a = (s) => escAttr(s);
  return `
  <div style="display:flex;align-items:center;gap:8px;margin:16px 0 4px;padding-top:12px;border-top:1px solid var(--i7)">
    <span style="font-size:11px;font-weight:700;color:var(--i3)">메일함에 나온 주소 — 아직 담당자 아님</span>
    <span style="font-size:10.5px;color:var(--i5)">${rows.length}명</span>
  </div>
  <div style="font-size:10.5px;color:var(--i5);margin-bottom:7px">기업 담당자인지, 시공사·벤더인지 보고 골라 주세요. 관계없는 주소는 숨기면 이 행사에서 다시 안 나와요.</div>
  ${rows.map(f => {
    const other = foreignDomain(f.email, cands);
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:7px;margin-bottom:4px;border:1px dashed var(--i6)">
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:600">${escapeHtml(f.name || f.email)}${other
          ? `<span class="pill p-amber" style="margin-left:5px" title="이 기업의 마스터DB 연락처는 ${a(other)} 도메인을 씁니다 — 시공사·대행사일 수 있어요">다른 도메인</span>` : ''}</div>
        <div style="font-size:10.5px;color:var(--i4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.name ? escapeHtml(f.email) + ' · ' : ''}메일 ${f.n}통 · 최근 ${escapeHtml(f.last.slice(0, 10))}</div>
      </div>
      <button class="btn bp bs" style="flex:0 0 auto;font-size:10.5px" onclick="openNewContact('${a(x.id)}','${a(f.name)}','${a(f.email)}')"
        title="이 기업 담당자로 마스터DB에 등록하고 배정합니다 — 창에서 이름·직함을 확인한 뒤 추가돼요">기업 담당자로</button>
      <button class="btn bs" style="flex:0 0 auto;font-size:10.5px" onclick="mailCandAsBuilder('${a(x.id)}','${a(f.name)}','${a(f.email)}')"
        title="이 기업 부스 시공사 담당자로 적습니다(진행 탭 «독립부스 시공사»)">시공사로</button>
      <button class="btn bs" style="flex:0 0 auto;font-size:10.5px;opacity:.6" onclick="hideMailCand('${a(x.event_id)}','${a(f.email)}')"
        title="담당자가 아닌 주소 — 이 행사에서 다시 보이지 않게 합니다(내 브라우저에만)">숨기기</button>
    </div>`;
  }).join('')}`;
}

/* 담당자 이름을 누르면 마스터DB 연락처 드로어를 띄운다(db-tab.js) — id는 숫자로 맞춘다 */
export function openExhPerson(id){
  const c = contacts.find(o => String(o.id) === String(id));
  if(c) window.openContactDr?.(c.id);
}

export function hideMailCand(evKey, email){
  const s = hiddenCands(evKey);
  s.add(email);
  try { localStorage.setItem(hideKey(evKey), JSON.stringify([...s])); } catch(e){}
  refreshExhViews();
}

/* 시공사 담당자로 — 이미 다른 사람이 적혀 있으면 덮기 전에 묻는다 */
export function mailCandAsBuilder(exhId, name, email){
  if(exhLocked()){ exhLockNotice(); return; }
  const x = getExhibitorById(exhId);
  if(!x) return;
  const cur = [x.builder_contact, x.builder_email].filter(Boolean).join(' · ');
  if(cur && !confirm(`시공 담당자가 이미 적혀 있어요: ${cur}\n${name || email}(으)로 바꿀까요?`)) return;
  if(!String(x.builder || '').trim()){
    const b = prompt('시공사명을 적어 주세요 (기업 DB의 시공사와 연결됩니다). 모르면 비워 두세요.', '');
    if(b === null) return;
    if(b.trim()) setBuilderOrg(exhId, b.trim());
  }
  if(name) window.setExhField(exhId, 'builder_contact', name, '시공 담당자');
  window.setExhField(exhId, 'builder_email', email, '시공사 이메일');
}

/* ── 담당자 직접 입력 ──
   여기서 적은 사람은 마스터DB(연락처)에도 함께 등록한다. 전시에만 적어 두면
   다음 행사에서 같은 사람을 또 손으로 적게 되고, 기업DB에서도 안 보인다.

   성명·직함·부서를 국문·영문으로 나눠 받는다 — 해외 기업은 영문만, 국내는
   국문만 오는 일이 많아 한 칸에 몰아넣으면 나중에 갈라내야 한다. */
export function openNewContact(exhId, name, email){
  const x = getExhibitorById(exhId);
  if(!x) return;
  const org = x.org_id ? getOrgById(x.org_id) : null;
  const pair = (a, b, la, lb, pa, pb) => `<div class="fgr">
    <div class="fg"><label class="fl">${la}</label><input class="fi" id="nc-${a}" placeholder="${pa}"></div>
    <div class="fg"><label class="fl">${lb}</label><input class="fi" id="nc-${b}" placeholder="${pb}"></div>
  </div>`;
  modalShell('new-contact-modal', `담당자 추가 — ${exhNames(x).ko}`, `
    <div style="font-size:11.5px;color:var(--i4);margin-bottom:12px;line-height:1.6">
      마스터DB에도 함께 등록되고, 이 전시 담당자로 바로 배정됩니다.</div>
    ${pair('nameKo', 'nameEn', '성명 (국문)', '성명 (영문)', '예: 이호진', '예: Hojin Lee')}
    ${pair('titleKo', 'titleEn', '직함 (국문)', '직함 (영문)', '예: 팀장', '예: Manager')}
    ${pair('deptKo', 'deptEn', '부서 (국문)', '부서 (영문)', '예: 마케팅팀', '예: Marketing')}
    ${pair('email', 'phone', '이메일', '연락처', 'name@company.com', '010-0000-0000')}
    <div class="fgr">
      <div class="fg"><label class="fl">이 전시에서의 역할</label>
        <select class="fi" id="nc-role">${cRoles().map(v => `<option value="${escapeHtml(v.code)}"${v.code === '실무' ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}</select></div>
      <div class="fg"><label class="fl">국가 <span style="font-weight:400;color:var(--i5)">— 이 사람이 있는 곳</span></label>
        <select class="fi" id="nc-country">
          <option value="" selected>— 모르면 비워두세요</option>
          ${countryOptions('')}
        </select></div>
    </div>
    ${/* 기업 국가를 미리 골라 두지 않는다. 그렇게 채운 값이 열아홉 명 틀려 있었다 —
         「포트리아 코리아 유한회사」 담당자가 «미국», 「시믹코리아」 담당자가 «일본».
         본사가 어디인지와 이 사람이 어디 있는지는 다른 질문이다.

         대신 기업 국가를 옆에 적어 준다. 같으면 고르면 되고, 다르면 다르게
         고르면 된다 — 판단할 자료는 주되 대신 정해 주지는 않는다. */''}
    <div style="font-size:10.5px;color:var(--i5);margin:-6px 0 12px">
      ${org?.country ? `이 기업은 <b>${escapeHtml(org.country)}</b>${ieyo(org.country).slice(org.country.length)} — 담당자가 같은 곳에 있으면 그대로 고르세요.` : ''}
      비워두면 나중에 마스터DB에서 채울 수 있어요.</div>
    <div id="nc-msg" style="font-size:11.5px;min-height:16px;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn bs" onclick="closeNewContact()">취소</button>
      <button class="btn bp" id="nc-save" onclick="submitNewContact('${escAttr(exhId)}')">추가</button>
    </div>`);
  // 메일함에서 온 사람이면 이름·주소를 채워 둔다 — 이름이 한글이면 국문, 아니면 영문 칸
  const setV = (id, v) => { const el = document.getElementById('nc-' + id); if(el && v) el.value = v; };
  setV('email', email);
  setV(/[가-힣]/.test(name || '') ? 'nameKo' : 'nameEn', name);
  document.getElementById('nc-nameKo')?.focus();
}
export const closeNewContact = () => document.getElementById('new-contact-modal')?.remove();

export async function submitNewContact(exhId){
  if(exhLocked()){ exhLockNotice(); return; }
  const v = (id) => (document.getElementById('nc-' + id) || {}).value?.trim() || '';
  const msg = document.getElementById('nc-msg');
  const btn = document.getElementById('nc-save');
  const fail = (t) => { if(msg){ msg.style.color = 'var(--re)'; msg.textContent = t; }
    if(btn){ btn.disabled = false; btn.textContent = '추가'; } };

  const nameKo = v('nameKo'), nameEn = v('nameEn');
  if(!nameKo && !nameEn) return fail('성명을 국문이나 영문 중 하나는 입력해주세요.');
  if(btn){ btn.disabled = true; btn.textContent = '추가 중…'; }

  const x = getExhibitorById(exhId);
  const org = x?.org_id ? getOrgById(x.org_id) : null;
  const today = td();
  const c = {
    id: nextContactId(),   // CLAUDE.md 16자리 규칙
    nameKo, nameEn,
    orgKo: org?.name_ko || x?.company_name || '', orgEn: org?.name_en || '',
    titleKo: v('titleKo'), titleEn: v('titleEn'),
    deptKo: v('deptKo'), deptEn: v('deptEn'),
    /* 기업 국가를 베끼지 않는다 — 사람이 고른 값만 넣고, 안 골랐으면 비운다.
       빈 칸은 마스터DB의 «국가 확인» 목록에 잡혀 나중에라도 채울 수 있다. */
    country: v('country'), cat: 'exhibitor', lang: nameKo ? 'KO' : 'EN',
    source: `${x?.event_id || ''} 전시 담당자`, date: today, status: 'new',
    email1: v('email'), email2: '', phone1: v('phone'), phone2: '',
    beat: '', products: '', tags: '', org_id: x?.org_id || '',
  };

  /* 마스터DB에 먼저 넣는다 — 저장이 실패하면 전시 쪽도 만들지 않는다.
     반쪽만 생기면 어느 쪽이 맞는지 알 수 없게 된다. */
  contacts.push(c);
  const { postToSheet } = await import('../../api.js');
  const r = await postToSheet({
    sheet: 'contacts',
    row: [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
      c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2,
      c.beat, c.products, c.tags, c.org_id],
  }, '담당자 추가', { silent: true });
  if(!r.ok){
    const i = contacts.indexOf(c);
    if(i >= 0) contacts.splice(i, 1);
    return fail('마스터DB 저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
  }

  const ok = await assignExhContact(exhId, String(c.id), v('role'));
  if(!ok) return fail('마스터DB에는 등록됐지만 전시 배정에 실패했어요 — 아래 목록에서 다시 배정해주세요.');

  /* 이 행사에 참여하는 것으로도 남긴다.
     여기서 만든 사람은 "그 행사 전시 담당자"라서 행사 참여가 곧 사실인데,
     전에는 마스터DB에만 들어가 참여 이력이 비어 있었다. 그러면 기업DB의
     행사별 집계와 CRM의 참여 이력에서 이 사람이 통째로 빠진다. */
  await addExhParticipation(c.id, x?.event_id, v('role'));

  trackAction('add', '담당자 추가', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(nameKo || nameEn)} 마스터DB 등록 + 전시 배정`,
    { kind: 'exhibitor', id: x?.id, tab: 'contact' });
  closeNewContact();
  try { const { buildCoDB } = await import('../../modules/company-tab.js'); buildCoDB(); } catch(e){}
  refreshExhViews();
}

/* ── 예전에 이 전시에만 적어 둔 담당자를 마스터DB로 올린다 ──

   전에는 담당자를 이 전시 안에서만 적을 수 있었다(exhibitor_contacts에 이름·
   이메일을 직접 넣는 방식). 그렇게 넣은 사람은 마스터DB에 없어서 다음 행사에
   다시 쓸 수 없고, 기업DB의 행사별 집계와 CRM 참여 이력에서도 통째로 빠진다.
   지금 '직접 입력'은 마스터DB에 넣고 연결하는 방식으로 바뀌었지만, 예전 방식으로
   들어간 줄이 남아 있어서 그 줄을 올릴 길을 둔다.

   이름도 이메일도 없는 줄은 올릴 게 없다 — 먼저 채우게 한다. */
export async function promoteExhContact(exhId, rowId){
  if(exhLocked()){ exhLockNotice(); return; }
  const r = EXH_CONTACTS.find(o => o.id === rowId);
  if(!r) return;
  if(r.contact_id){ alert('이미 마스터DB에 연결된 담당자예요.'); return; }

  const nm = String(r.name || '').trim();
  const em = cleanEmail(r.email || '');
  if(!nm && !em){ alert('이름이나 이메일 중 하나는 적어야 마스터DB에 올릴 수 있어요.'); return; }

  const x = getExhibitorById(exhId);
  const org = x?.org_id ? getOrgById(x.org_id) : null;
  const today = td();
  // 이름 칸에 "메디라마 (MediRama)"처럼 기업명이 들어간 줄이 있다. 그대로 두면
  // 사람 이름이 기업명이 되므로, 한글이 있으면 국문 이름으로만 넣는다.
  const c = {
    id: nextContactId(),
    nameKo: /[가-힣]/.test(nm) ? nm : '', nameEn: /[가-힣]/.test(nm) ? '' : nm,
    orgKo: org?.name_ko || x?.company_name || '', orgEn: org?.name_en || '',
    titleKo: '', titleEn: '', deptKo: '', deptEn: '',
    country: org?.country || '', cat: 'exhibitor', lang: /[가-힣]/.test(nm) ? 'KO' : 'EN',
    source: `${x?.event_id || ''} 전시 담당자(옮김)`, date: today, status: 'new',
    email1: em, email2: '', phone1: String(r.phone || '').trim(), phone2: '',
    beat: '', products: '', tags: '', org_id: x?.org_id || '',
  };

  contacts.push(c);
  const { postToSheet } = await import('../../api.js');
  const res = await postToSheet({
    sheet: 'contacts',
    row: [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
      c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2,
      c.beat, c.products, c.tags, c.org_id],
  }, '담당자 마스터DB 등록', { silent: true });
  if(!res.ok){
    const i = contacts.indexOf(c);
    if(i >= 0) contacts.splice(i, 1);
    saveFailed(res, '마스터DB 저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    return;
  }

  // 이 줄을 그 연락처에 연결한다 — 새 줄을 만들지 않아야 역할·메인 표시가 남는다
  const before = { contact_id: r.contact_id, name: r.name, email: r.email, phone: r.phone };
  r.contact_id = String(c.id);
  refreshExhViews();
  const r2 = await saveExhContact({ id: r.id, contact_id: r.contact_id });
  if(!r2.ok){ Object.assign(r, before); refreshExhViews(); alert('연결에 실패했어요.'); return; }

  await addExhParticipation(c.id, x?.event_id, r.role);

  trackAction('add', '담당자 마스터DB 등록', x?.company_name || '',
    `<b>${escapeHtml(x?.company_name || '')}</b> ${escapeHtml(nm || em)} — 전시에만 있던 담당자를 마스터DB로 옮김`,
    { kind: 'exhibitor', id: x?.id, tab: 'contact' });
  try { const { buildCoDB } = await import('../../modules/company-tab.js'); buildCoDB(); } catch(e){}
  refreshExhViews();
}

/* 행사 참여 기록 — 전시 담당자로 넣은 사람은 그 행사에 오는 사람이다.

   실패해도 담당자 등록 자체는 되돌리지 않는다. 참여 이력이 빠진 건 나중에
   기업DB에서 채울 수 있지만, 방금 적은 이름·이메일을 통째로 잃는 건 되돌리기가
   어렵다. 대신 무엇이 빠졌는지 로그에 남긴다. */
async function addExhParticipation(contactId, eventId, role){
  if(exhLocked()){ exhLockNotice(); return; }
  if(!eventId) return false;
  /* 역할까지 봐야 한다. 사람+행사만 보면 이미 다른 역할로 등록된 사람에게
     이 역할 줄이 만들어지지 않는다 — 참가기업 임원이 세션에서 발표하는 경우
     그 사람이 행사 DB에서 «연사»로 잡히지 않는다.
     company-tab·db-tab·upload-tab의 같은 검사는 처음부터 역할을 보고 있었다. */
  const dup = participations.some(p =>
    String(p.contactId) === String(contactId) && p.eventId === eventId
    && p.role === '전시참가기업');
  if(dup) return true;

  const part = {
    id: 'P-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
    /* 숫자로 둔다 — api.js가 불러올 때 +r.cid로 숫자로 바꾸고, 행사 참여자·기업DB는
       contactId === c.id로 맞춘다. 문자열로 넣으면 새로고침 전까지 이 사람이 빠져 보였다. */
    eventId, event: eventId, contactId: Number(contactId), contact: '',
    role: '전시참가기업', note: role ? `전시 ${role}` : '',
    matched: '✅ 전시 담당자 등록',
  };
  participations.push(part);

  const { postToSheet } = await import('../../api.js');
  const r = await postToSheet({
    sheet: 'participations',
    row: [part.id, part.eventId, '', part.contactId, '', '', '', part.role, part.note, part.matched],
  }, '행사 참여 추가', { silent: true });

  if(!r.ok){
    const i = participations.indexOf(part);
    if(i >= 0) participations.splice(i, 1);
    trackAction('add', '행사 참여 저장 실패', eventId,
      `담당자를 등록했지만 <b>${escapeHtml(eventId)}</b> 참여 기록은 저장되지 않았어요 — 기업DB에서 직접 추가해주세요`);
    return false;
  }
  return true;
}

/* 마스터DB 연락처를 이 전시 담당자로 넣는다 */
export async function assignExhContact(exhId, contactId, role){
  const already = contactsFor(exhId).some(c => String(c.contact_id) === String(contactId));
  if(already) return true;
  const first = contactsFor(exhId).length === 0;
  return window.addRow(EXH_CONTACTS, {
    id: localId('XC-'), exhibitor_id: exhId, contact_id: String(contactId),
    name: '', email: '', phone: '', role: role || '실무',
    is_primary: first ? 'yes' : '',   // 첫 담당자는 자동으로 메인
    note: '',
  }, saveExhContact);
}

/* 이 전시 담당자에서만 뺀다 — 마스터DB 연락처는 건드리지 않는다.
   행사가 끝나도 그 사람은 그 기업 연락처로 남아야 다음에 다시 쓸 수 있다. */
export async function unassignExhContact(exhId, contactId){
  const row = contactsFor(exhId).find(c => String(c.contact_id) === String(contactId));
  if(!row) return;
  await window.delExhContact(row.id);
}


