/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-graphic-views.js — 그래픽 현황 — 독립부스·받을 파일 계획·품목별·기업별 진행
   (features/exhibition/exh-item-views.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { exhMailSteps } from '../../modules/exh-mail.js';
import { DUE_SOON_DAYS, SELF_BUILD_TYPE, applyCell, baseKind, boothDesignState, boothSortKey, coCell, dueInfo, emptyView, exhFollowOf, exhNames, graphicState, renderExh, setExhField, setGraphicFil, setGraphicView, toggleEquipRow, viewShell, visibleList } from '../../modules/exh-tab.js';
import { catalogItem, exhEvent, getExhibitorById, liveItemsFor } from '../../state.js';
import { escAttr, escapeHtml, isMobile, td } from '../../utils.js';
import { openNewCatalogItem, openNewGraphicOrder, renderBaseView } from './exh-book.js';
import { GRAPHIC_STAGES, TCELL, TPILL, daysSince, fmtMoney, isBillable } from './exh-calc.js';
import { exhUi } from './exh-ui.js';
import { stageCell } from './exh-item-views.js';

/* ── 그래픽 현황 ──
   제작(디자인)은 초안 → 수정안 → 최종안으로 왔다 갔다 하고, 출력은 규격이
   맞는지만 보면 된다. 두 흐름이 섞여 있어 한 표에서 지금 누가 어느 단계에
   걸려 있는지 봐야 다음 연락처를 정할 수 있다. */
function renderGraphicView(list){
  const rows = list.filter(x => x.graphic_ordered_at || x.graphic_type
    || liveItemsFor(x.id).some(i => (i.category || '') === 'graphic'));
  /* 독립부스는 우리에게 그래픽을 «주문»하지 않는다 — 자기들이 만들어 와서
     우리는 받아 보기만 한다. 그래서 주문 목록(rows)이 아니라 부스 타입으로 잡는다.
     주문이 하나도 없어도 이 보기는 열려야 한다. */
  const selfRows = list.filter(x => (x.booth_type || '') === SELF_BUILD_TYPE);
  const baseAny = list.some(x => baseKind(x));
  if(!rows.length && !selfRows.length && !baseAny) return emptyView('그래픽을 주문한 기업이 없어요');

  /* 보기 전환 — 기업별은 "이 회사가 어느 단계인가", 항목별은 "무엇이 아직 안 왔나".
     그래픽은 한 기업이 백월·행잉배너·데스크 랩핑을 함께 주문하므로 기업 한 줄로는
     무엇을 받았는지 체크할 자리가 없다. 그래서 받을 파일 목록을 기본으로 둔다. */
  /* «기본 제공»이 맨 앞이다 — 계약에 들어 있어 기업이 조용해도 우리가 만들어
     세워야 하는 것이라, 안 하면 그만인 추가 주문보다 먼저 본다. 전에는 「기본
     시공」이라는 제 탭을 갖고 있었는데, 거기서 하던 일이 결국 그래픽 파일을
     받아 만드는 일이라 같은 화면으로 들어왔다. */
  const baseN = list.filter(x => baseKind(x)).length;
  const seg = `<div class="subbar" style="padding:10px 16px 0"><div class="seg">
    ${[['base', `기본 제공${baseN ? ` ${baseN}` : ''}`], ['item', '받을 파일'], ['kind', '품목별'], ['co', '기업별 진행'],
       ['self', `독립부스${selfRows.length ? ` ${selfRows.length}` : ''}`]].map(([k, l]) =>
      `<button class="seg-b${exhUi.gView === k ? ' on' : ''}" onclick="setGraphicView('${k}')">${l}</button>`).join('')}
  </div></div>`;

  if(exhUi.gView === 'base') return seg + renderBaseView(list);
  if(exhUi.gView === 'self') return seg + renderSelfBoothView(selfRows);
  if(!rows.length) return seg + emptyView('그래픽을 주문한 기업이 없어요');
  return seg + (exhUi.gView === 'co' ? renderGraphicCoView(rows)
    : exhUi.gView === 'kind' ? renderGraphicKindView(rows)
    : renderGraphicItemView(rows));
}

/* ── 독립부스 ──
   자체 시공은 부스를 업체가 직접 짓는다. 우리가 만들 것은 없지만 그냥 두면
   안 된다 — 높이 제한을 넘기거나 통로를 침범하거나 옆 부스를 가리는 도면이
   개막 직전에 발견되면 그때는 고칠 시간이 없다.

   그래서 세 가지를 받는다. 누가 짓는지(시공사), 무엇을 짓는지(도면·그래픽),
   그리고 우리가 봤는지(확인). 셋이 한 줄에 있어야 "받았는데 아직 안 봤다"가
   보인다 — 받은 것만 세면 그게 완료로 착각된다. */
function renderSelfBoothView(rows){
  if(!rows.length) return emptyView('독립부스(Self-Construction)로 신청한 기업이 없어요');

  const bk = (x) => { const k = boothSortKey(x); return k === Infinity ? 1e9 : k; };
  const list = [...rows].sort((a, b) => bk(a) - bk(b));

  const hasBuilder = (x) => !!String(x.builder || '').trim();
  const got  = (x) => !!x.booth_design_received_at;
  const seen = (x) => !!x.booth_design_checked_at;
  const nB = list.filter(hasBuilder).length;
  const nG = list.filter(got).length;
  const nS = list.filter(seen).length;
  const nOk  = list.filter(x => x.booth_design_result === 'ok').length;
  const nFix = list.filter(x => x.booth_design_result === 'fix').length;
  const nW = list.filter(x => x.work_report_at).length;   // 시공사가 호텔에 낸 작업신고서
  const due = dueInfo('calc:design', exhEvent);

  /* 숫자만 보면 12/18이 얼마나 남은 건지 안 들어온다 */
  const bar = (v, of, color) => `<div style="display:flex;align-items:center;gap:6px;min-width:120px">
    <div style="flex:1;height:5px;border-radius:var(--rd-3);background:var(--i7);overflow:hidden">
      <div style="width:${of ? Math.round(v / of * 100) : 0}%;height:100%;background:${v === of ? 'var(--g)' : color}"></div></div>
    <span style="font-size:var(--fs-11);font-weight:700;color:${v === of ? 'var(--g)' : 'var(--i3)'}">${v}/${of}</span></div>`;

  const pills = `<span class="pill p-gray">독립부스 ${list.length}곳</span>`
    + `<span class="pill ${nB === list.length ? 'p-green' : 'p-amber'}">시공사 ${nB}/${list.length}</span>`
    + `<span class="pill ${nG === list.length ? 'p-green' : 'p-amber'}">도면 수령 ${nG}/${list.length}</span>`
    + `<span class="pill ${nS === list.length ? 'p-green' : 'p-amber'}">확인 ${nS}/${list.length}</span>`
    + `<span class="pill ${nW === list.length ? 'p-green' : 'p-amber'}" title="${escapeHtml(list.filter(x => !x.work_report_at).map(x => exhNames(x).ko).join(', ') || '모두 제출')}">작업신고서 ${nW}/${list.length}</span>`
    + (nFix ? `<span class="pill p-red" title="${escapeHtml(list.filter(x => x.booth_design_result === 'fix').map(x => exhNames(x).ko).join(', '))}">수정 요청 ${nFix}</span>` : '')
    + (nOk ? `<span class="pill p-green">적합 ${nOk}</span>` : '')
    + (due
      ? `<span class="pill ${due.days < 0 ? 'p-red' : due.days <= 7 ? 'p-amber' : 'p-gray'}">수령 마감 ${escapeHtml(due.date)}${
          due.days < 0 ? ` · ${-due.days}일 지남` : due.days === 0 ? ' · 오늘' : ` · D-${due.days}`}</span>`
      : '');

  const board = `<div class="uc" style="margin:12px 0 10px;padding:11px 14px">
    <div style="display:flex;flex-wrap:wrap;gap:14px 26px">
      ${[['시공사 정보', nB, 'var(--a)'], ['도면·그래픽 수령', nG, 'var(--am)'],
         ['우리 확인', nS, 'var(--am)'], ['적합 판정', nOk, 'var(--g)'], ['호텔 작업신고서', nW, 'var(--a)']].map(([l, v, c]) =>
        `<div style="min-width:150px">
          <div style="font-size:var(--fs-10);color:var(--i5);font-weight:600">${l}</div>
          <div style="margin-top:4px">${bar(v, list.length, c)}</div></div>`).join('')}
    </div>
    ${nG > nS ? `<div style="font-size:var(--fs-11);color:var(--am);margin-top:8px">받아 놓고 아직 안 본 도면이 <b>${nG - nS}건</b> 있어요 — 확인해야 적합·수정을 판정할 수 있습니다</div>` : ''}
  </div>`;

  const txt = (x, f, ph, label, w) => `<input class="fi" style="width:${w};padding:3px 6px;font-size:var(--fs-11_5)"
    placeholder="${escapeHtml(ph)}" value="${escapeHtml(x[f] || '')}" onclick="event.stopPropagation()"
    onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr(label)}')">`;
  /* 작업신고서는 냈는지만 본다 — 체크하면 오늘 날짜가 들어가고(언제 체크했는지는
     남는다), 풀면 비운다 */
  const wr = (x) => `<label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:var(--fs-11_5)"
    onclick="event.stopPropagation()"><input type="checkbox"${x.work_report_at ? ' checked' : ''}
    onchange="setExhField('${escAttr(x.id)}','work_report_at',this.checked ? '${td()}' : '','작업신고서 제출')">
    ${x.work_report_at ? '<span style="color:var(--g)">받음</span>' : '<span style="color:var(--i5)">미제출</span>'}</label>`;
  const dt = (x, f, label) => `<input type="date" class="fi" style="width:124px;padding:3px 6px;font-size:var(--fs-11_5)"
    value="${escapeHtml(x[f] || '')}" onclick="event.stopPropagation()"
    onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr(label)}')">`;

  /* 확인 결과는 받아 보기 전에는 고를 수 없게 둔다 — 안 본 도면에 «적합»이
     찍히면 그 부스는 아무도 다시 안 본다. */
  const resultCell = (x) => !got(x)
    ? '<span style="font-size:var(--fs-11);color:var(--i6)">도면 수령 후</span>'
    : `<select class="fi" style="width:104px;padding:3px 5px;font-size:var(--fs-11_5)" onclick="event.stopPropagation()"
        onchange="setExhField('${escAttr(x.id)}','booth_design_result',this.value,'도면 확인 결과')">
        ${[['', '미판정'], ['ok', '적합'], ['fix', '수정 요청']].map(([v, l]) =>
          `<option value="${v}"${(x.booth_design_result || '') === v ? ' selected' : ''}>${l}</option>`).join('')}
      </select>`;

  const stateCell = (x) => { const s = boothDesignState(x);
    const c = s.state === 'done' ? 'p-green' : s.state === 'warn' ? 'p-red'
      : s.state === 'none' ? 'p-gray' : 'p-amber';
    return `<span class="pill ${c}">${escapeHtml(s.text)}</span>`; };

  /* 연락처는 칸을 다 벌리면 표가 안 읽힌다 — 있는지만 보이고 자세한 건 툴팁에 */
  const contactOf = (x) => [x.builder_contact, x.builder_tel, x.builder_mobile, x.builder_email]
    .map(v => String(v || '').trim()).filter(Boolean);

  if(isMobile()) return viewShell(pills, board + list.map(x => `
    <div style="background:var(--W);border:1px solid var(--i7);border-radius:var(--rd-10);padding:11px 12px;margin-bottom:7px">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:5px">
        <span class="pill p-gray">${x.booth_no ? '부스 ' + escapeHtml(x.booth_no) : '미배정'}</span>
        <span onclick="openExhDr('${escAttr(x.id)}','progress')"
          style="font-size:var(--fs-13);font-weight:700;flex:1;min-width:0;cursor:pointer">${escapeHtml(exhNames(x).ko)}</span>
        ${stateCell(x)}
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <span style="font-size:var(--fs-11);color:var(--i4);min-width:56px">시공사</span>${txt(x, 'builder', '업체명', '시공업체', '100%')}</div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <span style="font-size:var(--fs-11);color:var(--i4);min-width:56px">수령</span>${dt(x, 'booth_design_received_at', '도면 수령')}</div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
        <span style="font-size:var(--fs-11);color:var(--i4);min-width:56px">확인</span>${dt(x, 'booth_design_checked_at', '도면 확인')}</div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:var(--fs-11);color:var(--i4);min-width:56px">결과</span>${resultCell(x)}</div>
      <div style="display:flex;gap:6px;align-items:center;margin-top:4px">
        <span style="font-size:var(--fs-11);color:var(--i4);min-width:56px">작업신고</span>${wr(x)}</div>
    </div>`).join(''));

  return viewShell(pills, board + `<div class="tw"><table><thead><tr>
      <th style="min-width:44px;text-align:right">신청순</th>
      <th style="min-width:56px">부스</th>
      <th style="min-width:150px">기업</th>
      <th style="min-width:150px">시공사</th>
      <th style="min-width:70px;text-align:center">연락처</th>
      <th style="min-width:130px">도면·그래픽 수령</th>
      <th style="min-width:130px">우리 확인</th>
      <th style="min-width:110px">결과</th>
      <th style="min-width:90px" title="시공사가 호텔에 작업신고서를 냈는지">작업신고서</th>
      <th style="min-width:90px;text-align:center">상태</th>
      <th style="min-width:150px">비고</th>
    </tr></thead><tbody>
    ${list.map(x => {
      const c = contactOf(x);
      return `<tr>
        ${applyCell(x)}
        <td style="font-size:var(--fs-11_5);color:var(--i3)">${escapeHtml(x.booth_no || '—')}</td>
        ${coCell(x, 'progress')}
        <td>${txt(x, 'builder', '업체명', '시공업체', '142px')}</td>
        <td style="text-align:center">${c.length
          ? `<span class="pill p-green" title="${escapeHtml(c.join(' · '))}">있음</span>`
          : '<span class="pill p-gray" title="기업 상세 › 현장에서 담당자·연락처를 넣을 수 있어요">없음</span>'}</td>
        <td>${dt(x, 'booth_design_received_at', '도면 수령')}</td>
        <td>${dt(x, 'booth_design_checked_at', '도면 확인')}</td>
        <td>${resultCell(x)}</td>
        <td>${wr(x)}</td>
        <td style="text-align:center">${stateCell(x)}</td>
        <td>${txt(x, 'booth_design_note', '수정 요청 내용 등', '도면 비고', '100%')}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`);
}

/* ── 받을 파일 계획 ──
   기업 단위 단계(graphic_stage)는 "기업 전달"까지밖에 못 담는다 — 셋 중 둘만 온
   경우가 그 칸에 안 들어간다. 받아야 할 파일 하나를 한 줄로 놓고, 언제까지 받기로
   했는지(due_at)를 함께 잡는다. 마감이 없으면 미수령 목록은 길어지기만 하고
   누구부터 재촉할지 정할 근거가 없다. */
export function graphicItemsOf(exhId){
  return liveItemsFor(exhId).filter(i => (i.category || '') === 'graphic');
}

/* 마감 읽기. 받은 항목은 마감이 지났어도 늦은 게 아니다 — 이미 끝난 일이다.
   rank는 정렬용이다(급한 것이 위로). */
export function graphicDueInfo(i){
  if(i.received_at) return { cls: 'p-green', text: '받음', rank: 4 };
  const d = String(i.due_at || '').trim();
  /* 마감을 파일마다 넣지 않는다(대부분 ASAP) — 그래픽 자료를 요청한 지 며칠인지로 본다(follow-up.js) */
  if(!d){
    const x = getExhibitorById(i.exhibitor_id);
    const st = x && exhMailSteps(x.event_id).find(s => s.key === 'graphic');
    const f = st && exhFollowOf(x, st);
    if(f && f.state === 'nudge') return { cls: 'p-amber', text: `리마인더 · 요청 ${f.since}일째`, rank: 1, soon: true };
    if(f) return { cls: 'p-blue', text: `요청 ${f.since}일째`, rank: 2 };
    return { cls: 'p-gray', text: '요청 전', rank: 3 };
  }
  const over = daysSince(d);
  if(over > 0)   return { cls: 'p-red', text: `${over}일 지남`, rank: 0, late: true };
  if(over === 0) return { cls: 'p-red', text: '오늘 마감',      rank: 0, late: true };
  return -over <= DUE_SOON_DAYS
    ? { cls: 'p-amber', text: `D-${-over}`, rank: 1, soon: true }
    : { cls: 'p-gray',  text: `D-${-over}`, rank: 2 };
}

function graphicPlanRows(list){
  const out = [];
  list.forEach(x => graphicItemsOf(x.id).forEach(i => out.push({ x, i, d: graphicDueInfo(i) })));
  /* 급한 것부터. 같은 급함 안에서는 마감이 빠른 순, 그다음 기업 이름 순 —
     한 기업 파일이 흩어지지 않아야 연락 한 번에 함께 물어볼 수 있다. */
  out.sort((a, b) => a.d.rank - b.d.rank
    || String(a.i.due_at || '9999').localeCompare(String(b.i.due_at || '9999'))
    || exhNames(a.x).ko.localeCompare(exhNames(b.x).ko, 'ko'));
  return out;
}

/* ── 같은 파일은 한 줄로 ──
   신청은 회차별로 갈라 받아야 «몇 차에 무엇이 늘었나»가 남는다. 그런데 파일을
   받을 때 필요한 건 «이 기업에서 이 파일 몇 장»이지 회차가 아니다. 회차가 갈린
   탓에 같은 파일이 두 줄로 앉아 있으면 받았는지 세다가 한 장을 빠뜨린다.

   그래서 화면에서만 묶는다. 기업·품목·마감·받은 날·받은 것 메모가 모두 같을
   때만 합친다 — 하나라도 다르면 그 줄에 무엇을 적어야 할지 알 수 없으니 따로
   둔다. 합친 줄에 마감이나 받은 날을 적으면 묶인 항목 모두에 같이 들어간다. */
function mergeSamePlanRows(rows){
  const out = [];
  const by = new Map();
  rows.forEach(r => {
    const i = r.i;
    const k = [r.x.id, i.catalog_id || `n:${String(i.name || '').trim()}`,
      i.due_at || '', i.received_at || '', i.received_note || '',
      i.currency || 'KRW', String(i.unit_price || '')].join('');
    const q = Number(String(i.qty || '').replace(/[^0-9.-]/g, '')) || 0;
    const a = Number(String(i.amount || '').replace(/[^0-9.-]/g, '')) || 0;
    if(!by.has(k)){
      const m = { ...r, ids: [i.id], qty: q, amt: a, n: 1 };
      by.set(k, m); out.push(m);
      return;
    }
    const m = by.get(k);
    m.ids.push(i.id); m.qty += q; m.amt += a; m.n++;
  });
  return out;
}

function renderGraphicItemView(list){
  const all = mergeSamePlanRows(graphicPlanRows(list));
  if(!all.length) return emptyView('정산 탭에서 그래픽 분류로 항목을 넣으면 여기에 받을 파일로 잡혀요');

  const got  = all.filter(r => r.i.received_at);
  const todo = all.filter(r => !r.i.received_at);
  const late = todo.filter(r => r.d.late);
  const soon = todo.filter(r => r.d.soon);
  const none = todo.filter(r => !String(r.i.due_at || '').trim());

  const shown = exhUi.gFil === 'todo' ? todo
    : exhUi.gFil === 'late' ? todo.filter(r => r.d.late || r.d.soon)
    : exhUi.gFil === 'none' ? none
    : exhUi.gFil === 'got'  ? got : all;

  const fpill = (k, l, n, cls) => `<button class="pill ${exhUi.gFil === k ? cls : 'p-gray'}"
    style="border:0;cursor:pointer${exhUi.gFil === k ? ';outline:2px solid var(--i5)' : ''}"
    onclick="setGraphicFil('${k}')">${l} ${n}</button>`;
  const pills = fpill('all', '전체', all.length, 'p-blue')
    + fpill('todo', '미수령', todo.length, 'p-amber')
    + fpill('late', '지남·리마인더', late.length + soon.length, 'p-red')
    + fpill('none', '마감 없음', none.length, 'p-gray')
    + fpill('got', '받음', got.length, 'p-green');

  /* 마감 일괄 잡기 — 계획은 보통 "이 기업들 다 며칟날까지"로 세운다. 지금 걸러 놓은
     미수령 항목에만 넣는다(이미 받은 것은 건드리지 않는다). */
  const actions = `<input type="date" id="g-bulk-due" class="fi" style="width:140px;padding:4px 7px;font-size:var(--fs-11_5)">
    <button class="btn bs" onclick="applyGraphicDue()"
      title="지금 보고 있는 미수령 항목의 마감일을 한꺼번에 정합니다">마감 일괄 지정</button>
    <button class="btn bp bs" onclick="openNewGraphicOrder()">+ 그래픽 주문 추가</button>`;

  const chk = (r) => `<button onclick="event.stopPropagation();toggleItemReceived('${escAttr(r.ids.join(','))}')"
    title="${r.i.received_at ? '받음 표시를 지웁니다' : '오늘 받은 것으로 표시합니다'}${
      r.n > 1 ? ` — 묶인 ${r.n}줄 모두` : ''}"
    style="width:20px;height:20px;border-radius:var(--rs);line-height:1;flex-shrink:0;cursor:pointer;font-size:var(--fs-12);font-weight:800;color:var(--on);border:1.5px solid ${
      r.i.received_at ? 'var(--g)' : 'var(--i6)'};background:${r.i.received_at ? 'var(--g)' : 'transparent'}">${r.i.received_at ? '✓' : ''}</button>`;

  if(isMobile()) return viewShell(pills, shown.map(r => `
    <div style="background:var(--W);border:1px solid var(--i7);border-radius:var(--rd-10);padding:11px 12px;margin-bottom:7px">
      <div style="display:flex;align-items:center;gap:8px">
        ${chk(r)}
        <span style="flex:1;min-width:0" onclick="openExhDr('${escAttr(r.x.id)}','graphic')">
          <div style="font-size:var(--fs-12_5);font-weight:600">${escapeHtml(r.i.name || '(이름 없음)')}${
            r.qty > 1 ? `<span style="font-weight:400;color:var(--i4)"> · ${r.qty}장</span>` : ''}</div>
          <div style="font-size:var(--fs-11);color:var(--i4)">${escapeHtml(exhNames(r.x).ko)}${
            r.x.booth_no ? ` · 부스 ${escapeHtml(r.x.booth_no)}` : ''}</div>
        </span>
        <span class="pill ${r.d.cls}">${escapeHtml(r.d.text)}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-top:7px">
        <span style="font-size:var(--fs-10_5);color:var(--i5)">마감</span>
        <input type="date" class="fi" style="${TCELL};width:130px" value="${escapeHtml(r.i.due_at || '')}"
          onchange="setItemField('${escAttr(r.ids.join(','))}','due_at',this.value)">
      </div>
      <input class="fi" style="width:100%;margin-top:5px;padding:4px 8px;font-size:var(--fs-11_5)"
        value="${escapeHtml(r.i.received_note || '')}" placeholder="받은 것 — 예: 백월_최종.ai"
        onchange="setItemField('${escAttr(r.ids.join(','))}','received_note',this.value)">
    </div>`).join('') || emptyView('해당하는 항목이 없어요'), actions);

  return viewShell(pills, `<div class="tw"><table><thead><tr>
      <th style="min-width:30px"></th>
      <th style="min-width:150px">기업</th>
      <th style="min-width:56px">부스</th>
      <th style="min-width:180px">받을 파일</th>
      <th style="min-width:44px;text-align:right">수량</th>
      <th style="width:126px;min-width:126px">마감</th>
      <th style="width:96px;min-width:96px;text-align:center">상태</th>
      <th style="width:126px;min-width:126px">받은 날</th>
      <th style="min-width:200px">받은 것</th>
      <th style="min-width:96px;text-align:right">금액</th>
    </tr></thead><tbody>
    ${shown.map(r => `<tr${r.i.received_at ? ' style="opacity:.72"' : ''}>
      <td>${chk(r)}</td>
      ${coCell(r.x, 'graphic')}
      <td style="font-size:var(--fs-11_5);color:var(--i3)">${escapeHtml(r.x.booth_no || '—')}</td>
      <td style="font-size:var(--fs-12)">${escapeHtml(r.i.name || '(이름 없음)')}${
        r.n > 1 ? `<span class="pill p-gray" style="font-size:var(--fs-9);margin-left:4px"
          title="접수 회차가 갈려 ${r.n}줄로 들어왔어요 — 받는 입장에서는 한 장의 파일이라 묶었습니다">${r.n}줄</span>` : ''}</td>
      <td style="text-align:right;font-size:var(--fs-11_5)">${r.qty || ''}</td>
      <td><input type="date" class="fi" style="${TCELL}" value="${escapeHtml(r.i.due_at || '')}"
        onchange="setItemField('${escAttr(r.ids.join(','))}','due_at',this.value)"></td>
      <td style="text-align:center"><span class="pill ${r.d.cls}" style="${TPILL}">${escapeHtml(r.d.text)}</span></td>
      <td><input type="date" class="fi" style="${TCELL}" value="${escapeHtml(r.i.received_at || '')}"
        onchange="setItemField('${escAttr(r.ids.join(','))}','received_at',this.value)"></td>
      <td><input class="fi" style="${TCELL}" value="${escapeHtml(r.i.received_note || '')}"
        placeholder="예: 백월_최종.ai · CMYK" onchange="setItemField('${escAttr(r.ids.join(','))}','received_note',this.value)"></td>
      <td style="text-align:right;font-size:var(--fs-11_5)">${r.amt ? escapeHtml(fmtMoney(r.amt, r.i.currency || 'KRW')) : '-'}</td>
    </tr>`).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--i4);padding:24px">해당하는 항목이 없어요</td></tr>'}
    </tbody></table></div>`, actions);
}

/* 지금 걸러 놓은 미수령 항목에 마감을 한 번에 넣는다. 이미 받은 항목은 빼고,
   이미 마감이 잡힌 항목이 몇 건 덮이는지 먼저 알려 준다 — 계획을 다시 잡는 일도
   있지만, 실수로 남의 마감을 밀어 버리면 되돌릴 방법이 없다. */
export async function applyGraphicDue(){
  const v = (document.getElementById('g-bulk-due')?.value || '').trim();
  if(!v){ alert('마감일을 먼저 고르세요.'); return; }
  const base = graphicPlanRows(visibleList()).filter(r => !r.i.received_at);
  const target = exhUi.gFil === 'none' ? base.filter(r => !String(r.i.due_at || '').trim())
    : exhUi.gFil === 'late' ? base.filter(r => r.d.late || r.d.soon)
    : exhUi.gFil === 'got'  ? [] : base;
  if(!target.length){ alert('마감을 넣을 미수령 항목이 없어요.'); return; }
  const over = target.filter(r => String(r.i.due_at || '').trim() && r.i.due_at !== v).length;
  if(!confirm(`미수령 ${target.length}건의 마감을 ${v}로 정합니다.`
    + (over ? `\n이미 마감이 잡힌 ${over}건도 이 날짜로 바뀝니다.` : ''))) return;
  for(const r of target) await window.setItemField?.(r.i.id, 'due_at', v);
}

/* ── 품목별 ──
   비품은 "의자 몇 개"를 알아야 발주서를 쓴다. 그래픽도 같다 — 출력소에 넘길 때는
   기업이 아니라 "백월 12장, 데스크 랩핑 9장"으로 넘어간다. 여기에 하나가 더 붙는데,
   그래픽은 물량이 아니라 파일이 걸림돌이라 품목마다 몇 장이 아직 안 왔는지를 함께
   본다 — 백월만 다 모이면 그것부터 먼저 걸 수 있다.

   묶는 규칙은 비품과 같다: 카탈로그에 이어진 항목은 그 id로, 나머지는 이름으로.
   기업마다 "Wall graphic print", "백월 출력"처럼 다르게 적어 보내도 한 줄이 된다. */
function graphicKindGroups(list){
  const by = new Map();
  list.forEach(x => graphicItemsOf(x.id).forEach(i => {
    const cat = i.catalog_id ? catalogItem(i.catalog_id) : null;
    const k = cat ? cat.id : String(i.name || '(이름 없음)').trim();
    if(!by.has(k)) by.set(k, {
      key: k,
      code:   cat ? cat.code : '',
      nameKo: cat ? (cat.name_ko || cat.name_en) : String(i.name || '(이름 없음)').trim(),
      nameEn: cat ? (cat.name_ko ? cat.name_en : '') : '',
      spec:   cat ? cat.spec : '',
      offCatalog: !cat,
      qty: 0, cos: [], krw: 0, usd: 0, got: 0, late: 0,
    });
    const g = by.get(k);
    const q = Number(String(i.qty || '').replace(/[^0-9.-]/g, '')) || 0;
    const amt = Number(String(i.amount || '').replace(/[^0-9.-]/g, '')) || 0;
    const d = graphicDueInfo(i);
    g.qty += q || 1;                       // 수량을 안 적었으면 1장으로 센다
    if(i.received_at) g.got++;
    if(d.late) g.late++;
    g.cos.push({ x, i, d, qty: q || 1, amt, cur: i.currency || 'KRW' });
    if(isBillable(i)){ if((i.currency || 'KRW') === 'USD') g.usd += amt; else g.krw += amt; }
    else g.excluded = true;
  }));
  /* 안 온 파일이 많은 품목이 위로. 발주를 막고 있는 게 무엇인지가 먼저다 —
     같으면 물량이 큰 순서(그래야 발주서 순서와 얼추 맞는다). */
  return [...by.values()].sort((a, b) =>
    (b.cos.length - b.got) - (a.cos.length - a.got) || b.qty - a.qty);
}

function renderGraphicKindView(list){
  const groups = graphicKindGroups(list);
  if(!groups.length) return emptyView('정산 탭에서 그래픽 분류로 항목을 넣으면 여기에 품목으로 잡혀요');

  const totQty  = groups.reduce((a, g) => a + g.qty, 0);
  const totN    = groups.reduce((a, g) => a + g.cos.length, 0);
  const totGot  = groups.reduce((a, g) => a + g.got, 0);
  const totLate = groups.reduce((a, g) => a + g.late, 0);
  const totKrw  = groups.reduce((a, g) => a + g.krw, 0);
  const totUsd  = groups.reduce((a, g) => a + g.usd, 0);

  const pills = `<span class="pill p-blue">품목 ${groups.length}종</span>`
    + `<span class="pill p-gray">총 ${totQty}장</span>`
    + `<span class="pill ${totGot === totN ? 'p-green' : 'p-amber'}" title="주문한 그래픽 항목 중 파일을 받은 것">파일 받음 ${totGot}/${totN}</span>`
    + (totLate ? `<span class="pill p-red">마감 지남 ${totLate}</span>` : '')
    + (totKrw ? `<span class="pill p-gray">${fmtMoney(totKrw, 'KRW')}</span>` : '')
    + (totUsd ? `<span class="pill p-gray">${fmtMoney(totUsd, 'USD')}</span>` : '');

  /* 한 품목씩 펼쳐 보는 것과, 전부 펼쳐 놓고 훑는 것은 쓰임이 다르다 —
     발주 전에 "누가 무엇을 몇 장" 한 번에 확인할 때는 접힌 표가 오히려 불편하다. */
  const allOpen = groups.every(g => exhUi.equipOpen.has(g.key));
  const actions = `<button class="btn bs" onclick="toggleGraphicKindAll()">${allOpen ? '모두 접기' : '모두 펼치기'}</button>`
    + `<button class="btn bs" onclick="openNewCatalogItem('graphic')"
        title="출력소 품목표에 새 그래픽 품목을 추가합니다">+ 품목 추가</button>`
    + `<button class="btn bp bs" onclick="openNewGraphicOrder()">+ 그래픽 주문 추가</button>`;

  /* 펼치면 그 품목을 주문한 기업이 나온다. 여기서도 바로 체크하고 마감을 넣는다 —
     "백월 다 모였나"를 보다가 한 곳만 안 왔으면 그 자리에서 처리해야지,
     받을 파일 보기로 되돌아가 다시 찾게 하면 안 된다. */
  /* 부스 번호순으로 세운다. 이 목록을 들고 하는 일이 현장을 도는 것이라
     — 53번 벽면, 50번 인포데스크 — 부스 순서대로 있어야 한 바퀴에 끝난다.
     마감이 급한 순으로 세우면 같은 품목을 붙이러 전시장을 왔다 갔다 하게 된다.
     boothSortKey는 번호가 없으면 Infinity라, 빼면 NaN이 되어 정렬이 무너진다. */
  const boothOf = (x) => { const k = boothSortKey(x); return k === Infinity ? 1e9 : k; };
  /* 받음 표시 단추 — 좁은 화면에서는 손가락이 닿아야 해서 조금 키운다 */
  const gotBtn = (c, sz) => `<button onclick="event.stopPropagation();toggleItemReceived('${escAttr(c.i.id)}')"
    title="${c.i.received_at ? '받음 표시를 지웁니다' : '오늘 받은 것으로 표시합니다'}"
    style="width:${sz}px;height:${sz}px;border-radius:var(--rs);line-height:1;flex-shrink:0;cursor:pointer;font-size:var(--fs-11);font-weight:800;color:var(--on);border:1.5px solid ${
      c.i.received_at ? 'var(--g)' : 'var(--i6)'};background:${c.i.received_at ? 'var(--g)' : 'transparent'}">${c.i.received_at ? '✓' : ''}</button>`;
  const dueIn = (c, w) => `<input type="date" class="fi" style="width:${w};padding:3px 6px;font-size:var(--fs-11)" value="${escapeHtml(c.i.due_at || '')}"
    onclick="event.stopPropagation()" onchange="setItemField('${escAttr(c.i.id)}','due_at',this.value)">`;

  const coSorted = (g) => g.cos.slice()
    .sort((a, b) => boothOf(a.x) - boothOf(b.x)
      || String(exhNames(a.x).ko).localeCompare(String(exhNames(b.x).ko), 'ko'));

  /* 좁은 화면에서는 한 줄에 다 못 넣는다. 다 넣으려 하면 폭이 고정된 칸들
     (날짜·마감·금액)이 자리를 차지하고, 하나뿐인 늘어나는 칸인 기업명이 0으로
     찌그러져 아예 사라진다 — 정작 «부스 9가 어느 회사인지»가 이 목록을 보는
     이유인데 그것만 없어진다.

     그래서 두 줄로 나눈다. 첫 줄에 누가·몇 장인지, 둘째 줄에 언제까지인지.
     금액은 뺀다 — 좁은 화면에서 이 목록을 볼 때 돈을 보지는 않는다(합계는
     위 품목 줄에 이미 있다). */
  const coList = (g) => coSorted(g).map(c => isMobile() ? `
    <div style="padding:6px 0;border-bottom:1px solid var(--i8)">
      <div style="display:flex;align-items:center;gap:8px">
        ${gotBtn(c, 22)}
        <span class="pill p-gray" style="flex-shrink:0">${c.x.booth_no ? '부스 ' + escapeHtml(c.x.booth_no) : '미배정'}</span>
        <span onclick="event.stopPropagation();openExhDr('${escAttr(c.x.id)}','graphic')"
          style="flex:1;min-width:0;font-size:var(--fs-12_5);font-weight:600;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(exhNames(c.x).ko)}</span>
        <span style="color:var(--i4);font-size:var(--fs-11_5);flex-shrink:0">${c.qty}장</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin:5px 0 0 30px">
        ${dueIn(c, '128px')}
        <span class="pill ${c.d.cls}">${escapeHtml(c.d.text)}</span>
      </div>
    </div>` : `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:var(--fs-11_5)">
      ${gotBtn(c, 18)}
      <span class="pill p-gray" style="min-width:52px;text-align:center">${c.x.booth_no ? '부스 ' + escapeHtml(c.x.booth_no) : '미배정'}</span>
      <span onclick="event.stopPropagation();openExhDr('${escAttr(c.x.id)}','graphic')"
        style="flex:1;min-width:0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(exhNames(c.x).ko)}</span>
      <span style="color:var(--i4)">${c.qty}장</span>
      ${dueIn(c, '124px')}
      <span class="pill ${c.d.cls}" style="min-width:64px;text-align:center">${escapeHtml(c.d.text)}</span>
      <span style="min-width:88px;text-align:right;font-weight:600">${c.amt ? escapeHtml(fmtMoney(c.amt, c.cur)) : '-'}</span>
    </div>`).join('');

  /* 받음 진행 막대 — 숫자만 보면 8/12가 얼마나 남은 건지 한눈에 안 들어온다 */
  const bar = (g) => {
    const pct = g.cos.length ? Math.round(g.got / g.cos.length * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:6px">
      <div style="flex:1;min-width:44px;height:5px;border-radius:var(--rd-3);background:var(--i7);overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${g.got === g.cos.length ? 'var(--g)' : 'var(--am)'}"></div></div>
      <span style="font-size:var(--fs-11);font-weight:700;color:${g.got === g.cos.length ? 'var(--g)' : 'var(--i3)'}">${g.got}/${g.cos.length}</span>
    </div>`;
  };

  if(isMobile()) return viewShell(pills, groups.map(g => {
    const open = exhUi.equipOpen.has(g.key);
    return `<div style="padding:8px 0;border-bottom:1px solid var(--i8)">
      <div onclick="toggleEquipRow('${escAttr(g.key)}')" style="cursor:pointer">
        <div style="display:flex;align-items:baseline;gap:7px">
          ${g.code ? `<span class="pill p-blue" style="font-size:var(--fs-9)">${escapeHtml(g.code)}</span>` : ''}
          <span style="font-size:var(--fs-12_5);font-weight:600;flex:1;min-width:0">${escapeHtml(g.nameKo)}</span>
          <span style="font-size:var(--fs-15);font-weight:800">${g.qty}<span style="font-size:var(--fs-10);font-weight:400;color:var(--i4)">장</span></span>
        </div>
        <div style="margin-top:5px">${bar(g)}</div>
        <div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:3px">
          ${g.cos.length}개사${g.late ? ` · <b style="color:var(--re)">마감 지남 ${g.late}</b>` : ''}
          ${g.krw ? ' · ' + escapeHtml(fmtMoney(g.krw, 'KRW')) : ''}${g.usd ? ' · ' + escapeHtml(fmtMoney(g.usd, 'USD')) : ''}
          <span style="color:var(--a)"> ${open ? '▲ 접기' : '▼ 주문 기업'}</span>
        </div>
      </div>
      ${open ? `<div style="margin-top:5px;padding-left:6px;border-left:2px solid var(--i6)">${coList(g)}</div>` : ''}
    </div>`;
  }).join('') + `<div class="sct">기업별 주문 내역</div>` + graphicCoDetail(list), actions);

  return viewShell(pills, `<div class="uc"><div class="uc-ttl">품목별 합계
      <span style="font-weight:400;color:var(--i4);font-size:var(--fs-10)">— 출력소에 넘기는 숫자예요. 품목을 클릭하면 주문 기업이 보이고, 거기서 바로 체크할 수 있습니다</span></div>
    <div class="tw" style="overflow:visible"><table><thead><tr>
      <th style="min-width:66px">품목코드</th>
      <th style="min-width:170px">품명(국문)</th>
      <th style="min-width:150px">품명(영문)</th>
      <th style="min-width:110px">규격</th>
      <th style="min-width:56px;text-align:right">수량</th>
      <th style="min-width:62px;text-align:right">기업</th>
      <th style="min-width:130px">파일 받음</th>
      <th style="min-width:78px;text-align:right">마감 지남</th>
      <th style="min-width:104px;text-align:right">KRW</th>
      <th style="min-width:88px;text-align:right">USD</th>
    </tr></thead><tbody>
      ${groups.map(g => {
        const open = exhUi.equipOpen.has(g.key);
        return `<tr onclick="toggleEquipRow('${escAttr(g.key)}')" style="cursor:pointer${open ? ';background:var(--ad)' : ''}"
          title="클릭하면 주문한 기업을 볼 수 있어요">
          <td style="font-size:var(--fs-11_5);font-weight:700;color:var(--i2)">
            <span style="color:var(--a)">${open ? '▾' : '▸'}</span> ${escapeHtml(g.code || '—')}</td>
          <td style="font-size:var(--fs-12_5);font-weight:600">${escapeHtml(g.nameKo)}
            ${g.excluded ? '<span class="pill p-amber" style="font-size:var(--fs-9);margin-left:4px" title="우리가 청구하지 않는 항목이라 금액 합계에서 빠져 있어요">청구 제외</span>' : ''}
            ${g.offCatalog ? '<span class="pill p-amber" style="font-size:var(--fs-9);margin-left:4px" title="품목표에 없는 항목 — 이름으로 묶었어요">품목표 외</span>' : ''}</td>
          <td style="font-size:var(--fs-11_5);color:var(--i3)">${escapeHtml(g.nameEn || '-')}</td>
          <td style="font-size:var(--fs-11);color:var(--i4)">${escapeHtml(g.spec || '-')}</td>
          <td style="text-align:right;font-weight:700">${g.qty}</td>
          <td style="text-align:right;color:var(--i4)">${g.cos.length}곳</td>
          <td>${bar(g)}</td>
          <td style="text-align:right">${g.late ? `<span class="pill p-red">${g.late}</span>` : '<span style="color:var(--i6)">-</span>'}</td>
          <td style="text-align:right">${g.krw ? escapeHtml(fmtMoney(g.krw, 'KRW')) : '<span style="color:var(--i6)">-</span>'}</td>
          <td style="text-align:right">${g.usd ? escapeHtml(fmtMoney(g.usd, 'USD')) : '<span style="color:var(--i6)">-</span>'}</td>
        </tr>
        ${open ? `<tr data-detail><td colspan="10" style="padding:8px 12px 12px;background:var(--i9)">
          <div style="font-size:var(--fs-10_5);color:var(--i4);margin-bottom:4px">주문 기업 ${g.cos.length}곳 — 왼쪽 칸을 누르면 파일 받음으로 표시됩니다</div>
          ${coList(g)}</td></tr>` : ''}`;
      }).join('')}
    </tbody>
    <tfoot><tr style="border-top:2px solid var(--i5);font-weight:800">
      <td colspan="4" style="font-size:var(--fs-12)">합계 ${groups.length}종</td>
      <td style="text-align:right">${totQty}</td>
      <td style="text-align:right;font-weight:400;color:var(--i4)">${totN}건</td>
      <td style="font-size:var(--fs-12)">${totGot}/${totN}</td>
      <td style="text-align:right">${totLate || '-'}</td>
      <td style="text-align:right">${totKrw ? escapeHtml(fmtMoney(totKrw, 'KRW')) : '-'}</td>
      <td style="text-align:right">${totUsd ? escapeHtml(fmtMoney(totUsd, 'USD')) : '-'}</td>
    </tr></tfoot></table></div></div>`
    + `<div class="sct">기업별 주문 내역</div>` + graphicCoDetail(list), actions);
}

/* 품목별 합계가 "무엇을 몇 장"이라면, 이건 "이 회사에 무엇을 받아야 하나"다.
   비품 현황도 합계 아래 같은 자리에 기업별 신청 내역을 둔다 — 발주서를 쓰다가
   한 기업 것만 확인하고 싶을 때 표를 접었다 폈다 하지 않게. 여기서는 받은 것에
   ✓를 붙여, 펼치지 않고도 어느 회사가 무엇을 아직 안 보냈는지 알아볼 수 있다. */
function graphicCoDetail(list){
  const rows = list.map(x => ({ x, items: graphicItemsOf(x.id) })).filter(r => r.items.length);
  if(!rows.length) return '';
  return rows.map(({ x, items }) => {
    const got = items.filter(i => i.received_at).length;
    const late = items.filter(i => !i.received_at && graphicDueInfo(i).late).length;
    return `<div style="background:var(--W);border:1px solid var(--i7);border-radius:var(--rd-10);padding:11px 12px;margin-bottom:7px">
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:5px">
        ${x.booth_no ? `<span class="pill p-blue">부스 ${escapeHtml(x.booth_no)}</span>` : ''}
        <span onclick="openExhDr('${escAttr(x.id)}','graphic')" style="cursor:pointer;flex:1;min-width:0">
          <span style="font-size:var(--fs-13);font-weight:700">${escapeHtml(exhNames(x).ko)}</span>${
          exhNames(x).en ? `<span style="font-size:var(--fs-11);color:var(--i4);margin-left:5px">${escapeHtml(exhNames(x).en)}</span>` : ''}</span>
        <span class="pill ${got === items.length ? 'p-green' : got ? 'p-amber' : 'p-gray'}">받음 ${got}/${items.length}</span>
        ${late ? `<span class="pill p-red">마감 지남 ${late}</span>` : ''}
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${items.map(i => { const d = graphicDueInfo(i);
          return `<span class="pill ${i.received_at ? 'p-green' : d.cls}"
            title="${escapeHtml(`${fmtMoney(i.amount, i.currency || 'KRW')}${i.due_at ? ` · 마감 ${i.due_at}` : ''}${
              i.received_at ? ` · ${i.received_at} 받음` : ''}${i.received_note ? ` · ${i.received_note}` : ''}`)}"
            >${i.received_at ? '✓ ' : ''}${escapeHtml(i.name || '(이름 없음)')}${i.qty ? ' ×' + escapeHtml(String(i.qty)) : ''}${
              !i.received_at && i.due_at ? ` · ${escapeHtml(d.text)}` : ''}</span>`; }).join('')}
      </div>
    </div>`;
  }).join('');
}

/* 모두 펼치기 / 모두 접기. 지금 화면에 있는 품목만 다룬다 — 다른 행사에서 펼쳐 둔
   줄까지 건드리면 행사를 옮겼을 때 왜 펼쳐져 있는지 알 수 없다. */
export function toggleGraphicKindAll(){
  const keys = graphicKindGroups(visibleList()).map(g => g.key);
  const allOpen = keys.every(k => exhUi.equipOpen.has(k));
  keys.forEach(k => allOpen ? exhUi.equipOpen.delete(k) : exhUi.equipOpen.add(k));
  renderExh();
}

/* ── 기업별 진행 ──
   제작(디자인)은 초안 → 수정안 → 최종안으로 왔다 갔다 하고, 출력은 규격이
   맞는지만 보면 된다. 두 흐름이 섞여 있어 한 표에서 지금 누가 어느 단계에
   걸려 있는지 봐야 다음 연락처를 정할 수 있다. */
function renderGraphicCoView(rows){
  const design = rows.filter(x => x.graphic_type === 'design');
  const print  = rows.filter(x => x.graphic_type === 'print');
  const doneN  = rows.filter(x => graphicState(x).state === 'done').length;
  const warnN  = rows.filter(x => graphicState(x).state === 'warn').length;

  /* 무엇을 받았나 — 항목마다 따로 온다. 기업 단위 단계(graphic_stage)만으로는
     세 개 중 둘만 온 경우를 담지 못해, 항목 기준으로 따로 센다. */
  const gGot = (x) => {
    const gi = graphicItemsOf(x.id);
    return { n: gi.length, got: gi.filter(i => i.received_at).length,
      late: gi.filter(i => !i.received_at && graphicDueInfo(i).late).length };
  };

  const pills = `<span class="pill p-gray">주문 ${rows.length}</span>`
    + `<span class="pill p-blue">제작 ${design.length}</span>`
    + `<span class="pill p-gray">출력 ${print.length}</span>`
    + `<span class="pill p-green">완료 ${doneN}</span>`
    + (warnN ? `<span class="pill p-red">규격 확인 ${warnN}</span>` : '')
    + (() => {
      const t = rows.reduce((a, x) => { const g = gGot(x); a.n += g.n; a.got += g.got; a.late += g.late; return a; },
        { n: 0, got: 0, late: 0 });
      if(!t.n) return '';
      return `<span class="pill ${t.got === t.n ? 'p-green' : 'p-amber'}" title="주문한 그래픽 항목 중 파일을 받은 것">파일 받음 ${t.got}/${t.n}</span>`
        + (t.late ? `<span class="pill p-red" title="받기로 한 날이 지난 파일">마감 지남 ${t.late}</span>` : '');
    })();

  const stageLabel = (x) => {
    if(x.graphic_type === 'print') return x.graphic_spec_ok === 'yes' ? '규격 확인됨'
      : x.graphic_spec_ok === 'no' ? '규격 불일치' : '규격 미확인';
    if(x.graphic_final_at) return '최종안 확정';
    if(x.graphic_revised_at) return '수정안';
    if(x.graphic_draft_at) return '초안';
    return '진행 전';
  };
  const gAmt = (x) => {
    const by = {};
    graphicItemsOf(x.id).forEach(i => {
      const c = i.currency || 'KRW';
      by[c] = (by[c] || 0) + (Number(String(i.amount || '').replace(/[^0-9.-]/g, '')) || 0);
    });
    const ks = Object.keys(by).filter(k => by[k]);
    return ks.length ? ks.map(k => fmtMoney(by[k], k)).join(' + ') : '-';
  };

  /* 받은 파일 칸 — 개수만이 아니라 무엇이 안 왔고 마감이 언제인지 함께 띄운다.
     기업 한 줄이라 여기서 체크는 못 한다. 체크는 받을 파일 보기에서 한다. */
  const gotCell = (x) => {
    const gi = graphicItemsOf(x.id);
    if(!gi.length) return '<span style="color:var(--i6)">-</span>';
    const g = gGot(x);
    return `<span class="pill ${g.got === g.n ? 'p-green' : g.got ? 'p-amber' : 'p-gray'}"
      title="${escapeHtml(gi.map(i => `${i.received_at ? '✓' : '·'} ${i.name || ''}${
        !i.received_at && i.due_at ? ` (마감 ${i.due_at})` : ''}${i.received_note ? ` (${i.received_note})` : ''}`).join(' / '))}"
      >${g.got}/${g.n}</span>${g.late ? ` <span class="pill p-red" title="받기로 한 날이 지났어요">지남 ${g.late}</span>` : ''}`;
  };

  const gActions = `<button class="btn bp bs" onclick="openNewGraphicOrder()">+ 그래픽 주문 추가</button>`;

  if(isMobile()) return viewShell(pills, rows.map(x => {
    const g = graphicState(x);
    return `<div onclick="openExhDr('${escAttr(x.id)}','graphic')" style="background:var(--W);border:1px solid var(--i7);border-radius:var(--rd-10);padding:11px 12px;margin-bottom:7px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <span class="pill p-gray">${escapeHtml(x.apply_order || '-')}</span>
        <span style="flex:1;min-width:0">
          <span style="font-size:var(--fs-13);font-weight:700">${escapeHtml(exhNames(x).ko)}</span>${
          exhNames(x).en ? `<span style="font-size:var(--fs-11);color:var(--i4);margin-left:5px">${escapeHtml(exhNames(x).en)}</span>` : ''}</span>
        <span class="pill ${x.graphic_type === 'design' ? 'p-blue' : 'p-gray'}">${x.graphic_type === 'design' ? '제작' : x.graphic_type === 'print' ? '출력' : '유형 미정'}</span>
        <span class="pill ${g.state === 'done' ? 'p-green' : g.state === 'warn' ? 'p-red' : 'p-amber'}">${escapeHtml(stageLabel(x))}</span>
      </div>
      <div style="font-size:var(--fs-11);color:var(--i4)">주문 ${escapeHtml(x.graphic_ordered_at || '-')} · 금액 ${escapeHtml(gAmt(x))}</div>
      ${(() => { const gt = gGot(x); if(!gt.n) return '';
        return `<div style="font-size:var(--fs-11);margin-top:3px;color:${gt.got === gt.n ? 'var(--g)' : 'var(--am)'}">
          파일 ${gt.got}/${gt.n} 받음${gt.got < gt.n ? ` · 미수령 ${gt.n - gt.got}건` : ''}${
            gt.late ? ` · 마감 지남 ${gt.late}건` : ''}</div>`; })()}
    </div>`;
  }).join(''), gActions);

  return viewShell(pills, `<div class="tw"><table><thead><tr>
      <th style="min-width:44px;text-align:right">신청순</th>
      <th style="min-width:150px">기업</th>
      <th style="min-width:56px">부스</th>
      <th style="min-width:80px">유형</th>
      <th style="min-width:96px">시안</th>
      <th style="min-width:150px">확인 진행</th>
      <th style="min-width:110px">받은 파일</th>
      <th style="min-width:104px">초안</th>
      <th style="min-width:104px">수정안</th>
      <th style="min-width:104px">최종안</th>
      <th style="min-width:100px;text-align:right">금액</th>
    </tr></thead><tbody>
    ${rows.map(x => {
      const g = graphicState(x);
      const isPrint = x.graphic_type === 'print';
      const dateCell = (f) => isPrint ? '<td style="color:var(--i6);text-align:center">·</td>'
        : `<td><input type="date" class="fi" style="width:100px;padding:3px 5px;font-size:var(--fs-11)" value="${escapeHtml(x[f] || '')}"
            onchange="setExhField('${escAttr(x.id)}','${f}',this.value,'${escAttr({graphic_draft_at:'초안',graphic_revised_at:'수정안',graphic_final_at:'최종안'}[f])}')"></td>`;
      return `<tr>
        ${applyCell(x)}
        ${coCell(x, 'graphic')}
        <td style="font-size:var(--fs-11_5);color:var(--i3)">${escapeHtml(x.booth_no || '—')}</td>
        <td><select class="fi" style="width:74px;padding:3px 4px;font-size:var(--fs-11)"
          onchange="setExhField('${escAttr(x.id)}','graphic_type',this.value,'그래픽 유형')">
          <option value=""${!x.graphic_type ? ' selected' : ''}>미정</option>
          <option value="design"${x.graphic_type === 'design' ? ' selected' : ''}>제작</option>
          <option value="print"${x.graphic_type === 'print' ? ' selected' : ''}>출력</option>
        </select></td>
        <td><span class="pill ${g.state === 'done' ? 'p-green' : g.state === 'warn' ? 'p-red' : 'p-amber'}">${escapeHtml(stageLabel(x))}</span></td>
        <td>${stageCell(x, 'graphic_stage', GRAPHIC_STAGES)}</td>
        <td>${gotCell(x)}</td>
        ${dateCell('graphic_draft_at')}
        ${dateCell('graphic_revised_at')}
        ${dateCell('graphic_final_at')}
        <td style="text-align:right;font-size:var(--fs-11_5);font-weight:600">${escapeHtml(gAmt(x))}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`, gActions);
}


/* 화면의 onclick이 부르는 것 */
window.toggleGraphicKindAll = toggleGraphicKindAll;
window.applyGraphicDue = applyGraphicDue;
window.renderGraphicView = renderGraphicView;   // 탭(exh-tab.js)이 window로 부른다
