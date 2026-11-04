/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-booth-view.js — 부스 현황 보기 — 타입별·번호 겹침·엑셀로 받기
   (modules/exh-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { exhEvent } from '../../state.js';
import { escAttr, escapeHtml, isMobile, td } from '../../utils.js';
import { exhUi } from './exh-ui.js';
import { NO_BOOTH_LABEL, NO_BOOTH_TYPE, SELF_BUILD_TYPE, applyCell, boothDesignState, boothSortKey, boothTypeOptions, boothTypeText, boothTypes, coCell, countBy, emptyView, exhNames, gradeCls, groupByHost, hostOf, isNoBooth, isSharedBooth, parseBooth, setBoothTypeFil, setExhField, toggleExhFlag, toggleSharedBooth, viewShell } from '../../modules/exh-tab.js';

function renderBoothView(list){
  if(!list.length){ exhUi.boothShown = { rows: [], dupBooth: new Set(), typeFil: exhUi.boothTypeFil }; return emptyView('표시할 기업이 없어요'); }
  const all0 = groupByHost([...list].sort((a, b) => boothSortKey(a) - boothSortKey(b)));
  // 걸러도 배지의 숫자는 전체 기준을 유지한다 — 누를 때마다 숫자가 1로 바뀌면
  // 다른 타입이 몇 곳인지 알 수 없어 옮겨 다닐 수가 없다
  const rows = exhUi.boothTypeFil ? all0.filter(x => (x.booth_type || '') === exhUi.boothTypeFil) : all0;
  const noBooth = all0.filter(x => !isNoBooth(x) && !String(x.booth_no || '').trim()).length;
  const noBoothN = all0.filter(isNoBooth).length;
  const selfN = all0.filter(x => x.booth_type === SELF_BUILD_TYPE).length;
  const unconfirmed = all0.filter(x => !isNoBooth(x) && x.booth_confirmed !== 'yes' && !x.booth_confirmed_at).length;

  /* 번호에서 읽은 부스 수와 적어둔 수량이 다르면 알린다 — 10-11이면 2부스인데
     수량이 1로 적혀 있으면 청구액이 절반으로 잡힌다. */
  const qtyOdd = all0.filter(x => {
    if(isSharedBooth(x)) return false;   // 나눠 쓰는 부스는 번호와 수량이 안 맞는 게 정상
    const b = parseBooth(x.booth_no);
    const q = Number(String(x.booth_qty || '').replace(/[^0-9]/g, ''));
    return b.kind === 'range' && q && q !== b.count;
  });
  /* 공동 부스는 번호가 같은 두 줄로 들어와 있어 번호로 세면 두 번 잡힌다 */
  const totalBooths = rows.reduce((a, x) => a + (isSharedBooth(x) ? 0 : parseBooth(x.booth_no).count), 0);
  const sharedN = all0.filter(isSharedBooth).length;
  /* 「공동」 토글은 번호가 겹치는 줄에만 붙인다. 모든 줄에 달면 1부스짜리
     50줄에도 눌 일 없는 버튼이 생겨 표가 어수선해진다. 이미 켜 둔 줄은
     번호를 나중에 고쳤어도 계속 보여준다(끌 수 있어야 한다). */
  const dupBooth = new Set();
  {
    const seen = new Set();
    all0.forEach(x => {
      const k = String(x.booth_no || '').trim();
      if(!k) return;
      if(seen.has(k)) dupBooth.add(k); else seen.add(k);
    });
  }
  const typeCnt = countBy(all0, x => x.booth_type);
  exhUi.boothShown = { rows, dupBooth, typeFil: exhUi.boothTypeFil };
  /* 내보내기는 exh-export.js 소관 — 순환 참조를 피해 window 경유로 부른다 */
  const actions = rows.length
    ? `<button class="btn bs" id="booth-export-btn" onclick="exportBoothStatus()"
        title="지금 보이는 부스 현황 표를 엑셀로 받습니다">엑셀 다운로드</button>` : '';

  const pills = `<span class="pill p-gray">기업 ${exhUi.boothTypeFil ? `${rows.length}/${all0.length}` : all0.length}</span>`
    + `<span class="pill p-gray">부스 ${totalBooths}칸</span>`
    + (noBooth ? `<span class="pill p-red">번호 미배정 ${noBooth}</span>` : '')
    + (noBoothN ? `<span class="pill p-gray" title="부스 없이 참가하는 기업이에요 — 부스 수와 미배정·미확정에서 빠집니다">${NO_BOOTH_LABEL} ${noBoothN}</span>` : '')
    + (sharedN ? `<span class="pill p-blue" title="한 부스를 나눠 쓰는 기업이에요 — 부스 수에서 빠집니다">공동 부스 ${sharedN}</span>` : '')
    + (unconfirmed ? `<span class="pill p-amber">배정 미확정 ${unconfirmed}</span>` : '')
    + (qtyOdd.length ? `<span class="pill p-red" title="${escapeHtml(qtyOdd.map(x => `${x.company_name} ${x.booth_no}(${parseBooth(x.booth_no).count}칸) ↔ 수량 ${x.booth_qty}`).join(', '))}">수량 불일치 ${qtyOdd.length}</span>` : '')
    + `<span class="pill p-blue">독립부스 ${selfN}</span>`
    + (() => {
      const self = all0.filter(x => x.booth_type === SELF_BUILD_TYPE);
      const wait = self.filter(x => ['none', 'todo'].includes(boothDesignState(x).state)).length;
      const fix  = self.filter(x => boothDesignState(x).state === 'warn').length;
      return (wait ? `<span class="pill p-amber" title="도면을 못 받았거나 아직 확인하지 않은 독립부스예요">도면 확인 필요 ${wait}</span>` : '')
        + (fix ? `<span class="pill p-red" title="수정 요청한 뒤 아직 정리되지 않은 도면이에요">도면 수정 요청 ${fix}</span>` : '');
    })()
    + '<span style="font-size:var(--fs-10_5);color:var(--i5);margin-left:2px">번호·층·수량은 행을 눌러 상세에서 고쳐요</span>';

  /* 부스 타입은 배지가 아니라 탭으로 세운다 — 열두 개가 다른 배지들과 한 줄에
     섞여 있어 어느 것이 «지금 보는 것»인지 눈에 안 들어왔다. 비품 현황과 같은
     모양으로 맞춘다.

     순서는 설정의 부스 타입 목록을 따른다 — 대시보드의 부스 타입별 금액과 같은
     순서라야 두 화면을 나란히 읽을 수 있고, 개수 많은 순으로 두면 기업이 한 곳
     늘고 줄 때마다 탭 자리가 바뀌어 누르려던 것을 놓친다. 목록에 없는 옛 타입은
     뒤에 이름순으로 붙인다(그 타입으로 저장된 기업이 아직 있다). */
  const typeSeg = (() => {
    const order = boothTypes(exhEvent).map(t => t.code);
    const rank = (k) => { const i = order.indexOf(k); return i < 0 ? 999 : i; };
    const tabs = Object.entries(typeCnt)
      .filter(([t]) => String(t || '').trim())
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], 'ko'));
    const label = (code) => code === NO_BOOTH_TYPE ? NO_BOOTH_LABEL : boothTypes(exhEvent).find(t => t.code === code)?.label || code;
    return `<div class="subbar" style="padding:10px 16px 0"><div class="seg" style="flex-wrap:wrap">
      <button class="seg-b${exhUi.boothTypeFil ? '' : ' on'}" onclick="setBoothTypeFil('')">전체 ${all0.length}</button>
      ${tabs.map(([t, n]) => `<button class="seg-b${exhUi.boothTypeFil === t ? ' on' : ''}"
        onclick="setBoothTypeFil('${escAttr(t)}')" title="${escapeHtml(t)}">${escapeHtml(label(t))} ${n}</button>`).join('')}
    </div></div>`;
  })();

  if(!rows.length) return typeSeg + viewShell(pills,
    emptyView(`"${boothTypeText(exhUi.boothTypeFil)}" 부스를 쓰는 기업이 없어요`), actions);

  if(isMobile()) return typeSeg + viewShell(pills, rows.map(x => `
    <div onclick="openExhDr('${escAttr(x.id)}','progress')" style="background:var(--W);border:1px solid var(--i7);border-radius:var(--rd-10);padding:11px 12px;margin-bottom:7px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <span class="pill ${x.booth_no ? 'p-blue' : isNoBooth(x) ? 'p-gray' : 'p-red'}">${x.booth_no ? '부스 ' + escapeHtml(x.booth_no) : isNoBooth(x) ? NO_BOOTH_LABEL : '미배정'}${
          (() => { const b = parseBooth(x.booth_no);
            return b.kind === 'range' ? ` (${b.count}칸)` : b.kind === 'split' ? ' 공동' : ''; })()}</span>
        <span style="font-size:var(--fs-13);font-weight:700;flex:1;min-width:0">${hostOf(x, all0) ? '↳ ' : ''}${escapeHtml(exhNames(x).ko)}</span>
        ${x.booth_confirmed === 'yes' || x.booth_confirmed_at ? '<span class="pill p-green">확정</span>' : '<span class="pill p-amber">미확정</span>'}
        ${isSharedBooth(x) ? '<span class="pill p-blue" title="부스 수에서 빠져요">공동 부스</span>' : ''}
      </div>
      ${exhNames(x).en ? `<div style="font-size:var(--fs-11);color:var(--i4);margin:-2px 0 3px">${escapeHtml(exhNames(x).en)}</div>` : ''}
      <div style="font-size:var(--fs-11);color:var(--i4)">${[x.booth_floor && x.booth_floor + '층', boothTypeText(x.booth_type), x.booth_qty && x.booth_qty + '부스', x.grade].filter(Boolean).map(escapeHtml).join(' · ') || '정보 없음'}</div>
      ${x.builder ? `<div style="font-size:var(--fs-11);color:var(--i3);margin-top:3px">🔧 ${escapeHtml(x.builder)}${x.builder_mobile ? ' · ' + escapeHtml(x.builder_mobile) : ''}</div>` : ''}
      ${x.booth_type === SELF_BUILD_TYPE ? (() => {
        const d = boothDesignState(x);
        const cls = { none: 'p-gray', todo: 'p-amber', warn: 'p-red', done: 'p-green' }[d.state];
        return `<div style="margin-top:4px"><span class="pill ${cls}" style="font-size:var(--fs-9_5)">도면 ${escapeHtml(d.text)}</span></div>`;
      })() : ''}
    </div>`).join(''), actions);

  return typeSeg + viewShell(pills, `<div class="tw"><table><thead><tr>
      <th style="min-width:44px;text-align:right">신청순</th>
      <th style="min-width:64px">부스</th>
      <th style="min-width:150px">기업</th>
      <th style="min-width:46px">층</th>
      <th style="min-width:130px">타입</th>
      <th style="min-width:50px">수량</th>
      <th style="min-width:70px">등급</th>
      <th style="min-width:60px;text-align:center">확정</th>
      <th style="min-width:180px">시공사 (독립부스)</th>
      <th style="min-width:110px">부스 도면</th>
    </tr></thead><tbody>
    ${rows.map(x => {
      const self = x.booth_type === SELF_BUILD_TYPE;
      const done = x.booth_confirmed === 'yes' || !!x.booth_confirmed_at;
      return `<tr onclick="openExhDr('${escAttr(x.id)}','progress')" style="cursor:pointer"
        title="부스 번호·층·수량은 여기서 열리는 상세에서 고칩니다">
        ${applyCell(x)}
        <td style="font-size:var(--fs-12);font-weight:700${x.booth_no ? '' : ';color:var(--i6)'}">${x.booth_no ? escapeHtml(x.booth_no) : isNoBooth(x) ? '<span style="font-size:var(--fs-10_5);font-weight:400">부스 없음</span>' : '—'}
          ${(() => { const b = parseBooth(x.booth_no);
            return b.kind === 'range' ? `<div style="font-size:var(--fs-9_5);color:var(--i4);font-weight:400;margin-top:1px">${b.count}칸</div>` : ''; })()}
          ${dupBooth.has(String(x.booth_no || '').trim()) || isSharedBooth(x)
            ? `<div style="margin-top:2px"><span onclick="event.stopPropagation();toggleSharedBooth('${escAttr(x.id)}')"
            title="${isSharedBooth(x) ? '부스 수에서 빠져 있어요 — 눌러서 되돌립니다' : '한 부스를 나눠 쓴다면 눌러서 부스 수에서 뺍니다'}"
            style="cursor:pointer;font-size:var(--fs-9);font-weight:400;padding:1px 5px;border-radius:var(--rd-4);
              border:1px solid ${isSharedBooth(x) ? 'var(--a)' : 'var(--i7)'};
              background:${isSharedBooth(x) ? 'var(--ad)' : 'transparent'};
              color:${isSharedBooth(x) ? 'var(--a)' : 'var(--i5)'}">공동${isSharedBooth(x) ? ' ✓' : ''}</span></div>`
            : ''}</td>
        ${(() => {
          /* 예하 기업은 들여 써서 모기업 밑에 달린 줄로 읽히게 한다 */
          const h = hostOf(x, all0);
          if(!h) return coCell(x, 'progress');
          return coCell(x, 'progress').replace('<td style="min-width:150px">',
            `<td style="min-width:150px;padding-left:22px;position:relative" title="${escapeHtml(exhNames(h).ko)} 예하">
              <span style="position:absolute;left:8px;color:var(--i5);font-size:var(--fs-11)">↳</span>`);
        })()}
        <td style="font-size:var(--fs-11_5);color:var(--i3)">${x.booth_floor ? escapeHtml(x.booth_floor) + '층' : '<span style="color:var(--i6)">—</span>'}</td>
        <td><select class="fi" style="width:126px;padding:3px 4px;font-size:var(--fs-11)" onclick="event.stopPropagation()"
          onchange="setExhField('${escAttr(x.id)}','booth_type',this.value,'부스 타입')">${boothTypeOptions(x.booth_type)}</select></td>
        <td style="font-size:var(--fs-11_5);color:var(--i3);text-align:center">${x.booth_qty ? escapeHtml(x.booth_qty) : '<span style="color:var(--i6)">—</span>'}</td>
        <td>${x.grade ? `<span class="pill ${gradeCls(x.grade)}">${escapeHtml(x.grade)}</span>` : '<span style="color:var(--i6)">—</span>'}</td>
        <td style="text-align:center">
          <button onclick="event.stopPropagation();toggleExhFlag('${escAttr(x.id)}','booth_confirmed','booth_confirmed_at','배정 확정')"
            title="${done ? '확정 해제' : '배정 확정으로 표시'}"
            style="width:20px;height:20px;border-radius:var(--rs);line-height:1;cursor:pointer;
              border:1.5px solid ${done ? 'var(--g)' : 'var(--i6)'};background:${done ? 'var(--g)' : 'transparent'};
              color:#fff;font-size:var(--fs-11);font-weight:800">${done ? '✓' : ''}</button></td>
        <td>${self
          ? (x.builder || x.builder_contact || x.builder_mobile
            ? `<div style="font-size:var(--fs-11_5);font-weight:600">${escapeHtml(x.builder || '업체명 미입력')}</div>
               <div style="font-size:var(--fs-10_5);color:var(--i4)">${[x.builder_contact, x.builder_mobile || x.builder_tel].filter(Boolean).map(escapeHtml).join(' · ')}</div>`
            : `<button class="btn bs" style="font-size:var(--fs-10_5)" onclick="openExhDr('${escAttr(x.id)}','progress')">시공사 입력</button>`)
          : '<span style="color:var(--i6);font-size:var(--fs-11)">—</span>'}</td>
        <td>${self ? (() => {
          /* 자체 시공은 무엇을 지을지도 우리가 본다 — 도면을 받았는지, 봤는지,
             고쳐 달라고 했는지가 시공사 연락처만큼 중요하다. */
          const d = boothDesignState(x);
          const cls = { none: 'p-gray', todo: 'p-amber', warn: 'p-red', done: 'p-green' }[d.state];
          return `<span class="pill ${cls}">${escapeHtml(d.text)}</span>${
            x.booth_design_received_at ? `<div style="font-size:var(--fs-9_5);color:var(--i4);margin-top:2px">받음 ${escapeHtml(x.booth_design_received_at)}</div>` : ''}`;
        })() : '<span style="color:var(--i6);font-size:var(--fs-11)">—</span>'}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`, actions);
}


/* 화면의 onclick이 부르는 것 */
window.renderBoothView = renderBoothView;   // 탭(exh-tab.js)이 window로 부른다
