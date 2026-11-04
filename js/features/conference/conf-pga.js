/* ══════════════════════════════════════════════════════════════
   features/conference/conf-pga.js — 프로그램표(PROGRAM AT A GLANCE)
   (modules/conf-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { SPEAKER_ROLES } from '../../constants.js';
import { assignmentsOfSession, confCfg, getSpeakerById, leadOf, roleLabel, sessionsForEvent } from '../../state.js';
import { trackColorOf } from '../../track-colors.js';
import { escAttr, escapeHtml, isMobile, td } from '../../utils.js';
import { isBreak, speakerName } from './conf-common.js';
import { confUi } from './conf-ui.js';
import { dayLabel, renderConf, setConfEvent, timeLabel } from '../../modules/conf-tab.js';
import { kindOf } from './conf-program.js';

/* ══════════════════════════════════════════
   PROGRAM AT A GLANCE — 프로그램표

   프로그램북 앞에 늘 들어가는 한 장이다. 가로는 장소, 세로는 일자와 시간,
   칸은 트랙 색으로 묶인 세션. 참가자는 이 한 장으로 «내가 갈 세션이 언제
   어디서 열리는지»를 정한다.

   우리가 따로 적어 넣는 게 아니라 세션 데이터에서 그대로 만든다 — 프로그램을
   고치고 나서 이 표를 다시 그리는 일을 사람이 하면, 둘은 반드시 어긋난다.
   실제로 프로그램북의 표와 현장 안내가 다른 사고는 거기서 난다.

   장소가 없는 세션(개막식·기조연설처럼 전체가 모이는 것)은 한 줄을 통째로
   쓴다. 첨부한 프로그램북도 개막식을 그렇게 뽑았다.
══════════════════════════════════════════ */

/* 트랙 색은 track-colors.js가 정한다 — 설정 화면과 프로그램표가 같은 값을
   봐야 «설정에서 본 색»과 «표의 색»이 같다. */
const trackColor = (evKey, track) => trackColorOf(confCfg(evKey), track);

/* 올리기 단추 — 표 화면과 프로그램 화면이 같이 쓴다.
   처음 열리는 화면에 없으면 탭을 옮겨야 보이고, 그러면 «어디서 올리지»가
   된다. 실제로 그 말을 들었다. */
function importBtns(){
  return `<span id="conf-import-msg" style="font-size:var(--fs-10_5);color:var(--i4)"></span>
    <button class="btn" style="font-size:var(--fs-11)" onclick="downloadConfTemplate()"
      title="세션·연사·배정 세 시트로 된 빈 양식을 받습니다">양식 받기</button>
    <button class="btn" style="font-size:var(--fs-11)" onclick="pickConfFile()"
      title="채운 양식을 올립니다 — 기존 것을 지우지 않고 더하거나 고칩니다">엑셀 올리기</button>
    <input type="file" id="conf-xlsx-input" accept=".xlsx,.xls" style="display:none"
      onchange="handleConfFile(event)">`;
}

/* 프로그램표의 연사 줄.

   이름만 늘어놓으면 «누가 나오나»는 알아도 «무엇을 하나»는 모른다. 표를
   보는 사람이 다음으로 묻는 것이 그거다 — 좌장이 누구고, 어느 발표가 몇
   시고, 발제명이 무엇인지. 배정 순서대로 적고 역할과 시각을 함께 둔다.

   발제명이 있으면 이름 아래 붙인다. 프로그램북의 세션 면이 정확히 이
   모양이라, 여기서 보이는 그대로 옮겨 쓸 수 있어야 한다. */
function pgaSpeakers(ss, opts){
  const asg = assignmentsOfSession(ss.id);
  if(!asg.length) return '';
  const compact = opts && opts.compact;

  /* 시각을 맨 앞 한 줄로 세운다. 프로그램표에서 눈이 먼저 찾는 건 «몇 시»고,
     그게 줄 끝에 있으면 발표마다 다른 자리에 있어 훑을 수가 없다.
     그 옆이 발제명 — 무엇을 하는지가 다음 질문이다.
     사람은 그 아래 — 누가 하는지는 무엇을 하는지 다음에 온다. */
  return `<div style="margin-top:5px;border-top:1px solid var(--i7);padding-top:4px">
    ${asg.map(a => {
      const sp = getSpeakerById(a.speaker_id);
      const nm = speakerName(a.speaker_id);
      const org = sp ? (sp.org_ko || sp.org_en || '') : '';
      const jobTitle = sp ? (sp.title_ko || sp.title_en || '') : '';
      /* 발제명은 국·영문을 함께 보여준다. 프로그램북이 둘 다 싣고, 우리가
         고르면 어느 쪽이 빠졌는지 화면에서 알 수 없다 — 하나만 있으면
         그것만 나온다. */
      /* 공동연사 줄은 주 발표자 줄 아래 이름만 — 시각·발제명은 위 줄에 이미 있다 */
      const isCo = leadOf(a) !== a;
      const titleKo = isCo ? '' : (a.title_ko || '');
      const titleEn = isCo ? '' : (a.title_en || '');
      const title = titleKo || titleEn;
      const when = !isCo && a.start_at ? timeLabel(a.start_at, a.end_at) : '';
      const roleC = (SPEAKER_ROLES.find(r => r.key === a.role) || {}).cls || 'p-gray';

      const person = `<span class="pill ${roleC}" style="font-size:var(--fs-8_5);padding:1px 4px;vertical-align:1px">${
          escapeHtml(roleLabel(a))}</span>
        <span style="color:var(--i2)"> ${escapeHtml(nm)}</span>${
        (sp && sp.name_snapshot && sp.name_en)
          ? `<span style="color:var(--i4)"> ${escapeHtml(sp.name_en)}</span>` : ''}${
        jobTitle ? `<span style="color:var(--i4)"> · ${escapeHtml(jobTitle)}</span>` : ''}${
        org ? `<span style="color:var(--i4)"> · ${escapeHtml(org)}</span>` : ''}`;

      return `<div style="display:flex;gap:7px;margin-top:4px">
        <div style="flex:0 0 auto;min-width:62px;font-size:var(--fs-9_5);color:var(--i3);
          line-height:1.5;white-space:nowrap;font-variant-numeric:tabular-nums">${escapeHtml(when)}</div>
        <div style="min-width:0;flex:1">
          ${title && !compact
            ? `<div style="font-size:var(--fs-11_5);font-weight:600;color:var(--i1);line-height:1.4">${
                 escapeHtml(titleKo || titleEn)}</div>
               ${titleKo && titleEn
                 ? `<div style="font-size:var(--fs-10);color:var(--i3);line-height:1.4">${escapeHtml(titleEn)}</div>` : ''}
               <div style="font-size:var(--fs-9_5);line-height:1.4;margin-top:1px">${person}</div>`
            : `<div style="font-size:var(--fs-9_5);line-height:1.4">${person}</div>`}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function pgaHtml(ev){
  const sessions = sessionsForEvent(ev.key);
  if(!sessions.length){
    /* 올리기 단추를 함께 그린다 — 세션이 하나도 없을 때가 곧 엑셀로 한꺼번에
       올리는 때다. 안내에 «위의 양식 받기»라고 적어 놓고 단추가 없으면
       그게 제일 나쁘다. */
    return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <div style="font-size:var(--fs-12_5);font-weight:700">Program at a Glance</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-left:auto">${importBtns()}</div>
      </div>
      <div style="padding:22px;background:var(--i8);border:1px solid var(--i6);border-radius:var(--rd-10);
      font-size:var(--fs-12);color:var(--i5);line-height:1.7">
      세션이 없어요. 위의 <b>양식 받기</b>로 엑셀 양식을 받아 채운 뒤 <b>엑셀 올리기</b>로
      한 번에 넣거나, <b>Program</b> 탭에서 하나씩 만드세요.<br>
      표는 세션의 <b>일자 · 시각 · 장소 · 트랙</b>으로 그려져요 — 장소를 안 적은 세션은
      개막식처럼 한 줄을 통째로 씁니다.</div>`;
  }

  /* 가로축은 장소. 세션에 실제로 적힌 장소만 세운다 — 설정에 있는 방까지
     세우면 쓰지도 않는 빈 칸이 표의 절반을 차지한다. */
  /* 장소 순서는 설정에 적은 순서를 그대로 쓴다 — 어디가 메인 공간인지는
     이름에서 나오지 않는다(코사이어티는 HALL C가 메인이고 B가 서브다).
     설정에 없는 장소는 뒤에 붙이되 이름순으로 세운다. 숫자를 숫자로 읽어야
     «10호»가 «9호» 뒤에 온다. */
  const used = [...new Set(sessions.map(x => x.room).filter(Boolean))];
  const order = confCfg(ev.key).rooms || [];
  const rooms = [
    ...order.filter(r => used.includes(r)),
    ...used.filter(r => !order.includes(r))
      .sort((a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true })),
  ];
  const days = [...new Set(sessions.map(x => x.date || ''))].sort();
  const noRoomOnly = !rooms.length;

  /* 식사·휴식 칸 — 트랙 색 없이 회색 한 칸 */
  const breakCell = (ss) => `<div onclick="openPgaSession('${escAttr(ss.id)}')"
    title="${escapeHtml([ss.title_ko, ss.title_en, timeLabel(ss.start_at, ss.end_at), ss.room].filter(Boolean).join(' · '))}"
    style="cursor:pointer;background:var(--i7);border:1px solid var(--i6);border-radius:var(--rd-4);padding:7px;
    text-align:center;margin-bottom:5px;color:var(--i4)">
    <div style="font-size:var(--fs-11);font-weight:600">${escapeHtml(ss.title_ko || ss.title_en || kindOf(ss.kind).pill || '')}</div>
    ${ss.title_ko && ss.title_en ? `<div style="font-size:var(--fs-9_5);margin-top:1px">${escapeHtml(ss.title_en)}</div>` : ''}
  </div>`;

  const cell = (ss) => {
    if(isBreak(ss)) return breakCell(ss);
    const c = trackColor(ev.key, ss.track);
    return `<div onclick="openPgaSession('${escAttr(ss.id)}')" title="${escapeHtml(
        [ss.title_ko, ss.title_en, timeLabel(ss.start_at, ss.end_at), ss.room].filter(Boolean).join(' · '))}"
      style="cursor:pointer;border:1px solid ${c.bd}33;border-radius:var(--rd-4);overflow:hidden;margin-bottom:5px">
      ${ss.track ? `<div style="background:${c.bg};border-left:3px solid ${c.bd};padding:3px 6px;
        font-size:var(--fs-10_5);font-weight:700;color:var(--i1)">${escapeHtml(ss.track)}</div>` : ''}
      <div style="padding:6px 7px 8px;background:var(--W);overflow-wrap:anywhere">
        <div style="font-size:var(--fs-11);line-height:1.45;color:var(--i1)">${escapeHtml(ss.title_ko || ss.title_en || '(세션명 없음)')}</div>
        ${ss.title_ko && ss.title_en ? `<div style="font-size:var(--fs-9_5);color:var(--i4);line-height:1.4;margin-top:2px">${escapeHtml(ss.title_en)}</div>` : ''}
        ${pgaSpeakers(ss)}
      </div>
    </div>`;
  };

  /* 한 줄을 통째로 쓰는 세션 — 장소를 안 적은 것. 개막식·오찬처럼 전체가
     한자리에 모이는 일들이다. */
  const wideCell = (ss) => {
    if(isBreak(ss)) return breakCell(ss);
    const c = trackColor(ev.key, ss.track);
    return `<div onclick="openPgaSession('${escAttr(ss.id)}')" title="${escapeHtml(ss.title_en || '')}"
      style="cursor:pointer;background:${ss.track ? c.bg : 'var(--i8)'};border:1px solid ${ss.track ? c.bd + '55' : 'var(--i6)'};
      border-radius:var(--rd-4);padding:9px;text-align:center;margin-bottom:5px">
      <div style="font-size:var(--fs-11_5);font-weight:600">${escapeHtml(ss.title_ko || ss.title_en || '(세션명 없음)')}</div>
      ${ss.title_en && ss.title_ko ? `<div style="font-size:var(--fs-9_5);color:var(--i4);margin-top:2px">${escapeHtml(ss.title_en)}</div>` : ''}
      ${(() => {
        /* 연사 항목은 장소가 있는 세션과 똑같이(시각·역할 배지·소속) 그린다.
           제목은 가운데지만 연사 줄은 왼쪽 정렬해야 시각 열이 맞는다. */
        const sp = pgaSpeakers(ss);
        return sp ? `<div style="text-align:left;margin-top:6px;padding-top:4px;
          border-top:1px solid var(--i6)">${sp}</div>` : '';
      })()}
    </div>`;
  };

  const dayBlock = (d) => {
    const mine = sessions.filter(x => (x.date || '') === d);
    /* 세로는 시간대. 같은 시각에 시작하는 것이 한 줄이 된다 —
       시각을 안 적은 세션은 맨 아래에 «시간 미정» 줄로 모은다. */
    const slots = [...new Set(mine.map(x => x.start_at || ''))]
      .sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b));

    const rowFor = (slot) => {
      const here = mine.filter(x => (x.start_at || '') === slot);
      const wide = here.filter(x => !x.room);
      const placed = here.filter(x => x.room);
      const timeCol = `<td style="vertical-align:top;padding:7px 8px;font-size:var(--fs-10_5);color:var(--i3);
        white-space:nowrap;border-top:1px solid var(--i6)">${slot ? escapeHtml(timeLabel(slot,
          // 그 시간대에서 가장 늦게 끝나는 것으로 폭을 적는다
          here.map(x => x.end_at).filter(Boolean).sort().slice(-1)[0] || ''))
          : '<span style="color:var(--i4)">시간 미정</span>'}</td>`;
      const wideRow = wide.length
        ? `<tr>${timeCol}<td colspan="${Math.max(1, rooms.length)}" style="padding:7px 8px;border-top:1px solid var(--i6)">
            ${wide.map(wideCell).join('')}</td></tr>`
        : '';
      const placedRow = placed.length || !wide.length
        ? `<tr>${wide.length ? `<td style="border-top:1px solid var(--i6)"></td>` : timeCol}
            ${(rooms.length ? rooms : ['']).map(rm => `<td style="vertical-align:top;padding:7px 8px;
              border-top:1px solid var(--i6);border-left:1px solid var(--i7)">
              ${placed.filter(x => (x.room || '') === rm).map(cell).join('') || ''}</td>`).join('')}
          </tr>`
        : '';
      return wideRow + placedRow;
    };

    return `<tr><td colspan="${rooms.length + 1}" style="padding:9px 8px 3px;background:var(--i8);
        border-top:1px solid var(--i6);font-size:var(--fs-11_5);font-weight:700">
        ${escapeHtml(d ? dayLabel(d) : '날짜 미정')}
        <span style="font-weight:400;color:var(--i4);margin-left:6px">세션 ${mine.length}</span></td></tr>`
      + slots.map(rowFor).join('');
  };

  /* ── 모바일 ──
     가로가 장소인 표는 좁은 화면에 들어가지 않는다. 옆으로 밀면 시간 열이
     사라져 «몇 시 것인지»를 잃는다. 그래서 시간 순 목록으로 바꾼다 —
     장소는 각 줄에 적어 둔다. 표가 하려던 일(언제·어디서·무엇을)은 남는다. */
  if(isMobile()){
    const line = (ss) => {
      const c = trackColor(ev.key, ss.track);
      const brk = isBreak(ss);
      return `<div onclick="openPgaSession('${escAttr(ss.id)}')"
        style="cursor:pointer;${brk ? 'color:var(--i4);' : ''}background:${brk ? 'var(--i7)' : 'var(--W)'};border:1px solid var(--i6);border-left:3px solid ${
          ss.track ? c.bd : 'var(--i5)'};border-radius:var(--r);padding:9px 11px;margin-bottom:7px">
        <div style="display:flex;gap:7px;align-items:baseline;flex-wrap:wrap">
          <span style="font-size:var(--fs-11);color:var(--i3);white-space:nowrap">${escapeHtml(timeLabel(ss.start_at, ss.end_at) || '시간 미정')}</span>
          ${ss.room ? `<span class="pill p-gray" style="font-size:var(--fs-9)">${escapeHtml(ss.room)}</span>` : ''}
          ${ss.track ? `<span style="font-size:var(--fs-10);padding:2px 6px;border-radius:var(--rd-4);background:${c.bg}">${escapeHtml(ss.track)}</span>` : ''}
        </div>
        <div style="font-size:var(--fs-12_5);font-weight:600;margin-top:4px;line-height:1.45">${escapeHtml(ss.title_ko || ss.title_en || '(세션명 없음)')}</div>
        ${ss.title_ko && ss.title_en ? `<div style="font-size:var(--fs-10);color:var(--i4);line-height:1.4">${escapeHtml(ss.title_en)}</div>` : ''}
        ${pgaSpeakers(ss)}
      </div>`;
    };
    const byDay = (d) => {
      const mine = sessions.filter(x => (x.date || '') === d)
        .slice()
        .sort((a, b) => String(a.start_at || '').localeCompare(String(b.start_at || ''))
          || String(a.room || '').localeCompare(String(b.room || ''), 'ko', { numeric: true }));
      return `<div style="font-size:var(--fs-12);font-weight:700;margin:12px 0 6px">${escapeHtml(d ? dayLabel(d) : '날짜 미정')}
          <span style="font-weight:400;color:var(--i4)">세션 ${mine.length}</span></div>
        ${mine.map(line).join('')}`;
    };
    return `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <div style="font-size:var(--fs-12_5);font-weight:700">Program at a Glance</div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-left:auto">${importBtns()}</div>
      </div>
      <div style="font-size:var(--fs-10);color:var(--i4);margin-bottom:2px">좁은 화면에서는 시간 순 목록으로 보여드려요</div>
      ${days.map(byDay).join('')}`;
  }

  /* 트랙 범례 — 색만 보고는 무슨 트랙인지 모른다 */
  const usedTracks = [...new Set(sessions.map(x => x.track).filter(Boolean))];
  /* 트랙이 빈 세션은 색이 안 붙는다. 개막식처럼 장소가 없는 것은 원래
     그렇지만, 장소가 있는데 트랙만 빈 세션은 대개 빠뜨린 것이다 —
     색을 찾기 전에 왜 없는지를 알 수 있게 세어 둔다. */
  const noTrack = sessions.filter(x => x.room && !x.track && !isBreak(x));
  const legend = usedTracks.length ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
    ${usedTracks.map(t => {
      const c = trackColor(ev.key, t);
      return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:var(--fs-10_5);color:var(--i3)">
        <span style="width:11px;height:11px;border-radius:var(--rd-3);background:${c.bg};border-left:3px solid ${c.bd}"></span>
        ${escapeHtml(t)}</span>`;
    }).join('')}
    ${noTrack.length ? `<span style="font-size:var(--fs-10_5);color:var(--am)"
      title="${escapeHtml(noTrack.map(x => x.title_ko || x.title_en || x.id).join('\n'))}">
      트랙 없는 세션 ${noTrack.length}개 — 색이 안 붙어요</span>` : ''}
  </div>` : '';

  const hint = noRoomOnly ? `<div style="font-size:var(--fs-10_5);color:var(--i4);margin-bottom:8px;line-height:1.6">
    장소를 적은 세션이 없어 한 칸으로 그렸어요 — 세션에 «장소»를 넣으면 방별로 나뉩니다.</div>` : '';

  return `<div style="display:flex;align-items:center;gap:9px;margin-bottom:8px;flex-wrap:wrap">
      <div style="font-size:var(--fs-12_5);font-weight:700">Program at a Glance</div>
      <div style="font-size:var(--fs-10_5);color:var(--i4)">세션 ${sessions.length} · ${days.length}일${
        rooms.length ? ` · ${rooms.length}개 장소` : ''}</div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-left:auto">
        ${importBtns()}
        <button class="btn" style="font-size:var(--fs-11)" onclick="copyPga()"
          title="표를 그대로 복사해 프로그램북·메일에 붙여 넣습니다">표 복사</button>
      </div>
    </div>
    ${legend}${hint}
    <div class="tw" id="pga-table"><table style="width:100%;border-collapse:collapse;table-layout:fixed">
      <colgroup>
        <col style="width:82px">
        ${(rooms.length ? rooms : ['전체']).map(() =>
          `<col style="width:${(100 / Math.max(1, rooms.length || 1)).toFixed(4)}%">`).join('')}
      </colgroup>
      <thead><tr>
        <th style="text-align:left;font-size:var(--fs-10)">시간</th>
        ${(rooms.length ? rooms : ['전체']).map(rm => `<th style="text-align:center;font-size:var(--fs-10_5);
          border-left:1px solid var(--i7)">${escapeHtml(rm)}</th>`).join('')}
      </tr></thead>
      <tbody>${days.map(dayBlock).join('')}</tbody>
    </table></div>
    <div style="font-size:var(--fs-10);color:var(--i4);margin-top:7px;line-height:1.6">
      칸을 누르면 그 세션의 수정 칸이 열려요. 장소를 안 적은 세션은 개막식처럼 한 줄을 통째로 씁니다.
    </div>`;
}

/* 표에서 세션을 누르면 프로그램으로 건너가 그 세션을 연다 —
   여기서 바로 고치게 하면 같은 수정 칸이 두 군데 생긴다. */
export function openPgaSession(sid){
  confUi.confView = 'program';
  confUi.confEditSession = sid;
  renderConf();
  setTimeout(() => {
    document.getElementById(`es-${sid}-ko`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 60);
}

/* 활동 로그에서 건너올 때 — 다른 행사의 세션일 수 있으니 행사부터 맞춘다.
   setConfEvent이 열린 수정 칸을 닫으므로 반드시 먼저 부른다. */
export function openAuditSession(sid, ev){
  if(ev && ev !== confUi.confEvent) setConfEvent(ev);
  openPgaSession(sid);
}

/* 표를 그대로 복사한다 — 프로그램북 원고와 메일이 이 표를 그대로 쓴다.
   서식 있는 복사(text/html)와 글자 복사를 함께 담아, 붙여 넣는 곳이
   무엇이든 형태가 남게 한다. */
export async function copyPga(){
  const el = document.getElementById('pga-table');
  if(!el) return;
  /* 글자 크기·모서리 변수(tokens.css)는 붙여 넣는 곳에 없으니 지금 값(px)으로 바꿔 담는다 */
  const root = getComputedStyle(document.documentElement);
  const html = el.innerHTML.replace(/var\((--(?:fs-[\d_]+|rd-\w+|rs|r))\)/g, (m, name) => root.getPropertyValue(name).trim() || m);
  const text = [...el.querySelectorAll('tr')]
    .map(tr => [...tr.children].map(td => td.innerText.replace(/\s*\n\s*/g, ' ').trim()).join('\t'))
    .join('\n');
  try {
    if(navigator.clipboard && window.ClipboardItem){
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
    } else {
      await navigator.clipboard.writeText(text);
    }
    alert('표를 복사했어요. 문서나 메일에 붙여 넣으세요.');
  } catch(e){
    alert(`복사하지 못했어요 (${e.message}).\n표를 끌어서 직접 선택해 복사해주세요.`);
  }
}


/* 화면의 onclick이 부르는 것 */
window.openPgaSession    = openPgaSession;
window.openAuditSession  = openAuditSession;
window.copyPga           = copyPga;
window.pgaHtml = pgaHtml;   // 탭(conf-tab.js)이 window로 부른다
window.importBtns = importBtns;   // 탭(conf-tab.js)이 window로 부른다
