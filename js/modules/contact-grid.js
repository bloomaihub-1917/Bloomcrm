/* ══════════════════════════════════════════════════════════════
   contact-grid.js — 컨택 › 현황표

   엑셀 TM 현황표를 옮긴 것이다. 한 줄에 한 기업, 열은 그 행사의 차수들
   (1차 TM | 2차 TM | DM …). 칸에는 그 차수의 최근 반응·횟수·날짜만 두고,
   누르면 «오늘 할 컨택»의 그 기업 카드로 가서 기록 전체를 본다.

   엑셀로 내려받으면 지금까지 보고하던 모양으로 나온다:
     현황표  업체 · 담당자(1)(2) · 차수마다 [최근 일자 · 반응 · 횟수 · 목표 · 진행 내용]
             진행 내용은 엑셀에 손으로 적던 «10/08 16:45 계인 부재중 · 메모»를 줄마다 한 줄
     기록    한 번 걸고 보낸 것 하나가 한 줄 — 거르고 세기 좋게

   어느 행사의 표인가는 왼쪽에서 고른 차수가 정한다(그 차수의 행사). 고른 차수
   열은 진하게 보이고, 위쪽 거르기(목표 달성·연락 전 …)도 그 차수를 기준으로 한다.
══════════════════════════════════════════════════════════════ */
import { CONTACT_ROUNDS, CONTACT_ATTEMPTS } from '../state.js';
import {
  REACTIONS, roundById, membersOf, attemptsOf, memberState, memberName, peopleOf, coOf,
  evLabel, currentRoundId,
} from './contact-tab.js';
import { loadExcelJs } from './exh-export.js';
import { showSaveErrorToast } from '../api.js';
import { escapeHtml, escAttr } from '../utils.js';
import { trackAction } from './audit-tab.js';

/* 반응을 보고서의 네 칸으로 묶는다 — 엑셀 총괄표의 긍정·보류·부정·오류와 같다 */
export const BUCKET = {
  positive: '긍정', reply: '긍정', hold: '보류', negative: '부정',
  noanswer: '미연결', wrongnum: '미연결', bounce: '미연결', sent: '보냄',
};
const BUCKETS = ['긍정', '보류', '부정', '미연결', '보냄'];

let gFil = 'all';   // all | todo(이 차수 연락 전) | goal(목표 달성) | open(아직 안 끝남)

/* ── 이 행사의 차수와 기업별 줄 ── */
export function gridData(evKey){
  const rounds = CONTACT_ROUNDS.filter(r => r.event_id === evKey)
    .sort((a, b) => String(a.date_from || a.created_at || '').localeCompare(String(b.date_from || b.created_at || '')));
  const byOrg = new Map();
  rounds.forEach(r => membersOf(r.id).forEach(m => {
    if(!byOrg.has(m.org_id)) byOrg.set(m.org_id, { org_id: m.org_id, name: memberName(m), sources: new Set(), cells: {} });
    const row = byOrg.get(m.org_id);
    if(m.source) row.sources.add(m.source);
    const atts = attemptsOf(m.id);
    row.cells[r.id] = { m, atts, st: memberState(m, atts) };
  }));
  const rows = [...byOrg.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  rows.forEach(row => {
    const all = Object.values(row.cells).flatMap(c => c.atts);
    row.total = all.length;
    row.last = all.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))[0] || null;
  });
  return { rounds, rows };
}

/* 차수 하나의 숫자 — 명단·연락한 곳·최근 반응별·목표 */
export function roundStats(r, rows){
  const st = { members: 0, touched: 0, goal: 0, attempts: 0 };
  BUCKETS.forEach(b => { st[b] = 0; });
  rows.forEach(row => {
    const c = row.cells[r.id];
    if(!c) return;
    st.members++;
    st.attempts += c.atts.length;
    if(c.atts.length){ st.touched++; const b = BUCKET[c.atts[0].reaction]; if(b) st[b]++; }
    if(c.m.goal_at) st.goal++;
  });
  return st;
}

/* ══════════════════════════════════════════
   화면
══════════════════════════════════════════ */
export function renderGrid(){
  const el = document.getElementById('v-grid');
  if(!el) return;
  const cur = roundById(currentRoundId());
  if(!cur){
    el.innerHTML = `<div class="empty" style="height:auto;padding:60px 20px"><p style="font-size:12px">왼쪽에서 차수를 고르거나 새로 만드세요</p>
      <button class="btn bp bs" onclick="openRoundEditor()">차수 만들기</button></div>`;
    return;
  }
  const { rounds, rows } = gridData(cur.event_id);
  const q = ((document.getElementById('crm-q') || {}).value || '').trim().toLowerCase();
  const list = rows.filter(row => {
    const c = row.cells[cur.id];
    if(gFil === 'todo' && !(c && !c.atts.length && !c.m.closed_at && !c.m.goal_at)) return false;
    if(gFil === 'goal' && !(c && c.m.goal_at)) return false;
    if(gFil === 'open' && !(c && c.st !== 'done')) return false;
    if(!q) return true;
    const co = coOf(row.org_id);
    return [row.name, co?.nameEn, ...row.sources, ...(co ? co.contacts : []).flatMap(p => [p.nameKo, p.phone1, p.phone2])]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  });
  const stats = Object.fromEntries(rounds.map(r => [r.id, roundStats(r, rows)]));
  const seg = (k, l) => `<button class="seg-b${gFil === k ? ' on' : ''}" onclick="setGridFil('${k}')">${l}</button>`;
  const th = 'position:sticky;top:0;background:var(--i8);z-index:1;font-size:11px;text-align:left;padding:7px 8px;border-bottom:1px solid var(--i6);white-space:nowrap';
  const td = 'padding:6px 8px;border-bottom:1px solid var(--i7);font-size:11.5px;vertical-align:top';

  el.innerHTML = `
    <div class="tbar" style="flex-wrap:wrap;gap:8px">
      <span style="font-size:13px;font-weight:700">${escapeHtml(evLabel(cur.event_id))}</span>
      <span style="font-size:11px;color:var(--i4)">차수 ${rounds.length}개 · ${rows.length}곳</span>
      <div class="seg">${seg('all', '전체')}${seg('todo', '이 차수 연락 전')}${seg('open', '이 차수 안 끝남')}${seg('goal', '이 차수 목표 달성')}</div>
      <span class="tct">${list.length}곳</span>
    </div>
    <div class="tw"><table style="width:100%;border-collapse:collapse;min-width:${360 + rounds.length * 150}px">
      <thead><tr>
        <th style="${th};width:34px">No</th>
        <th style="${th}">기업</th>
        <th style="${th}">담당자</th>
        ${rounds.map(r => {
          const s = stats[r.id];
          const on = r.id === cur.id;
          return `<th style="${th};${on ? 'background:var(--ad);color:var(--a)' : ''};cursor:pointer" onclick="pickRound('${escAttr(r.id)}')" title="${escapeHtml(r.purpose || '')}">
            <div>${escapeHtml(r.channel || 'TM')} · ${escapeHtml(r.name)}</div>
            <div style="font-weight:400;color:var(--i4);font-size:10.5px;margin-top:2px">연락 ${s.touched}/${s.members} · 목표 ${s.goal}</div>
            <div style="font-weight:400;font-size:10.5px;margin-top:1px">${BUCKETS.filter(b => s[b]).map(b => `${b} ${s[b]}`).join(' · ') || '<span style="color:var(--i5)">기록 없음</span>'}</div></th>`;
        }).join('')}
        <th style="${th}">최근 연락</th>
      </tr></thead>
      <tbody>${list.length ? list.map((row, i) => {
        const p = primaryPeople(row)[0];
        return `<tr>
          <td style="${td};color:var(--i4)">${i + 1}</td>
          <td style="${td}"><div style="font-weight:600">${escapeHtml(row.name)}</div>
            ${row.sources.size ? `<div style="font-size:10.5px;color:var(--i4)">${escapeHtml([...row.sources].join(' · '))}</div>` : ''}</td>
          <td style="${td}">${p ? `${escapeHtml(p.nameKo || p.nameEn || '')} <span style="color:var(--i4)">${escapeHtml(p.titleKo || '')}</span>
            <div style="font-size:10.5px;color:var(--i4)">${escapeHtml(p.phone2 || p.phone1 || '')}</div>` : '<span style="color:var(--i5)">—</span>'}</td>
          ${rounds.map(r => cellHtml(row.cells[r.id], r, r.id === cur.id, td)).join('')}
          <td style="${td};white-space:nowrap;color:var(--i3)">${row.last ? `${escapeHtml(String(row.last.at).slice(5, 10))} ${escapeHtml(row.last.by_name || '')}<div style="font-size:10.5px;color:var(--i4)">총 ${row.total}번</div>` : '<span style="color:var(--i5)">—</span>'}</td>
        </tr>`;
      }).join('') : `<tr><td colspan="${4 + rounds.length}" style="${td};text-align:center;color:var(--i4);padding:30px">${rows.length ? '해당하는 곳이 없어요' : '이 행사 차수에 명단이 아직 없어요'}</td></tr>`}</tbody>
    </table></div>`;
}

function cellHtml(c, r, on, td){
  const bg = on ? ';background:#F7F9FF' : '';
  if(!c) return `<td style="${td}${bg};color:var(--i5)">—</td>`;
  const a = c.atts[0];
  const R = a && REACTIONS[a.reaction];
  const head = c.m.goal_at ? `<span class="pill p-green">✓ ${escapeHtml(r.goal || '목표')}</span>`
    : c.m.closed_at ? `<span class="pill p-gray">끝냄</span>`
    : a ? `<span class="pill ${R?.cls || 'p-gray'}">${escapeHtml(R?.label || a.reaction)}</span>`
    : `<span style="color:var(--a);font-size:11px">${r.channel === 'TM' ? '걸 차례' : '보낼 차례'}</span>`;
  return `<td style="${td}${bg};cursor:pointer" onclick="openRoundMember('${escAttr(c.m.id)}')" title="${escapeHtml(a?.note || '')}">
    ${head}${c.atts.length ? ` <span style="font-size:10.5px;color:var(--i4)">${c.atts.length}번 · ${escapeHtml(String(a.at).slice(5, 10))}</span>` : ''}
    ${a?.note ? `<div style="font-size:10.5px;color:var(--i3);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(a.note)}</div>` : ''}
  </td>`;
}

/* 담당자 — 최근에 통화한 사람이 먼저, 그다음 번호가 있는 사람 */
function primaryPeople(row){
  const anyMember = Object.values(row.cells)[0]?.m;
  if(!anyMember) return [];
  const people = peopleOf(anyMember);
  const lastCid = row.last?.contact_id;
  return people.slice().sort((a, b) => (String(b.id) === String(lastCid)) - (String(a.id) === String(lastCid)));
}

export function setGridFil(k){ gFil = k; renderGrid(); }

/* ══════════════════════════════════════════
   엑셀
══════════════════════════════════════════ */
const FONT = { name: '맑은 고딕', size: 9 };
const C_GROUP = 'FF1F3864', C_HEAD = 'FF305496', C_CUR = 'FFD9E1F2';
const BORDER = { style: 'thin', color: { argb: 'FFD9D9D9' } };
const fillOf = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const headCell = (cell, argb, v) => {
  cell.value = v;
  cell.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = fillOf(argb);
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
};
const attLine = (a) => [String(a.at || '').slice(5).replace('-', '/'), a.by_name, a.channel,
  REACTIONS[a.reaction]?.label || a.reaction, a.contact_name, a.note].filter(Boolean).join(' ');

const BASE_COLS = [
  ['No', 5], ['명단', 14], ['국가', 9], ['기업명', 24],
  ['담당자(1) 성명', 10], ['부서·직위', 14], ['전화', 14], ['휴대폰', 14], ['이메일', 22],
  ['담당자(2) 성명', 10], ['전화', 14], ['이메일', 22],
];
const ROUND_COLS = [['최근 일자', 11], ['반응', 8], ['횟수', 6], ['목표', 10], ['진행 내용', 46]];

export function buildContactWorkbook(ExcelJS, evKey, stamp){
  const { rounds, rows } = gridData(evKey);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bloom CRM';
  wb.created = new Date();
  const title = `${evLabel(evKey)} TM/DM 현황`;

  /* ── 현황표 ── 1행 제목, 2행 기준 시각, 3행 묶음 머리(차수), 4행 머리글 */
  const ws = wb.addWorksheet('현황표', { views: [{ state: 'frozen', ySplit: 4, xSplit: 4 }] });
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { ...FONT, size: 13, bold: true };
  ws.getCell(2, 1).value = `${stamp.text} 기준 · ${rows.length}곳`;
  ws.getCell(2, 1).font = { ...FONT, color: { argb: 'FF6B6860' } };
  const nBase = BASE_COLS.length;
  ws.mergeCells(3, 1, 3, nBase);
  headCell(ws.getCell(3, 1), C_GROUP, '기업 · 담당자');
  BASE_COLS.forEach(([h, w], i) => { headCell(ws.getCell(4, i + 1), C_HEAD, h); ws.getColumn(i + 1).width = w; });
  rounds.forEach((r, k) => {
    const c0 = nBase + 1 + k * ROUND_COLS.length;
    ws.mergeCells(3, c0, 3, c0 + ROUND_COLS.length - 1);
    headCell(ws.getCell(3, c0), C_GROUP, `${r.channel || 'TM'} · ${r.name}${r.goal ? ` (목표: ${r.goal})` : ''}`);
    ROUND_COLS.forEach(([h, w], j) => { headCell(ws.getCell(4, c0 + j), C_HEAD, h); ws.getColumn(c0 + j).width = w; });
  });
  ws.getRow(3).height = 22; ws.getRow(4).height = 18;

  rows.forEach((row, i) => {
    const co = coOf(row.org_id);
    const [p1, p2] = primaryPeople(row);
    const vals = [
      i + 1, [...row.sources].join(' · '), co?.country || '', row.name,
      p1 ? (p1.nameKo || p1.nameEn || '') : '', p1 ? [p1.deptKo, p1.titleKo].filter(Boolean).join(' ') : '',
      p1?.phone1 || '', p1?.phone2 || '', p1?.email1 || '',
      p2 ? (p2.nameKo || p2.nameEn || '') : '', p2 ? (p2.phone2 || p2.phone1 || '') : '', p2?.email1 || '',
    ];
    rounds.forEach(r => {
      const c = row.cells[r.id];
      if(!c){ vals.push('', '', '', '', ''); return; }
      const a = c.atts[0];
      vals.push(a ? String(a.at).slice(0, 10) : '',
        c.m.closed_at && !c.m.goal_at ? `끝냄${c.m.closed_reason ? `(${c.m.closed_reason})` : ''}` : a ? (REACTIONS[a.reaction]?.label || a.reaction) : '',
        c.atts.length || '',
        c.m.goal_at ? `달성 ${c.m.goal_at}` : '',
        // 엑셀에 손으로 적던 순서대로 — 오래된 것이 위
        c.atts.slice().reverse().map(attLine).join('\n'));
    });
    const xr = ws.getRow(5 + i);
    xr.values = vals;
    xr.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = FONT;
      cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
      cell.alignment = { vertical: 'top', wrapText: col > nBase && (col - nBase) % ROUND_COLS.length === 0 };
    });
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: nBase + rounds.length * ROUND_COLS.length } };

  /* ── 차수별 합계 ── 보고 첫 장에 붙여 넣는 숫자 */
  const ss = wb.addWorksheet('차수별 합계');
  const SH = ['차수', '채널', '기간', '목표', '명단', '연락한 곳', '기록 수', ...BUCKETS, '목표 달성', '진행률'];
  SH.forEach((h, i) => headCell(ss.getCell(1, i + 1), C_HEAD, h));
  [24, 6, 22, 12, 7, 9, 8, 6, 6, 6, 7, 6, 9, 8].forEach((w, i) => { ss.getColumn(i + 1).width = w; });
  rounds.forEach((r, i) => {
    const s = roundStats(r, rows);
    const xr = ss.getRow(2 + i);
    xr.values = [r.name, r.channel || 'TM', [r.date_from, r.date_to].filter(Boolean).join(' ~ '), r.goal || '',
      s.members, s.touched, s.attempts, ...BUCKETS.map(b => s[b]), s.goal, s.members ? s.touched / s.members : 0];
    xr.eachCell({ includeEmpty: true }, (cell) => { cell.font = FONT; cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER }; });
    xr.getCell(SH.length).numFmt = '0%';
  });

  /* ── 기록 ── 한 번 걸고 보낸 것 하나가 한 줄 */
  const ls = wb.addWorksheet('기록', { views: [{ state: 'frozen', ySplit: 1 }] });
  const LH = [['차수', 22], ['기업명', 24], ['일시', 15], ['담당(우리)', 9], ['채널', 6], ['통화·수신자', 10], ['번호·주소', 18], ['반응', 8], ['메모', 50]];
  LH.forEach(([h, w], i) => { headCell(ls.getCell(1, i + 1), C_HEAD, h); ls.getColumn(i + 1).width = w; });
  const rIds = new Set(rounds.map(r => r.id));
  const nameOf = new Map(rows.map(r => [r.org_id, r.name]));
  CONTACT_ATTEMPTS.filter(a => rIds.has(a.round_id))
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
    .forEach((a, i) => {
      const xr = ls.getRow(2 + i);
      xr.values = [roundById(a.round_id)?.name || '', nameOf.get(a.org_id) || '', a.at || '', a.by_name || '', a.channel || '',
        a.contact_name || '', a.phone || '', REACTIONS[a.reaction]?.label || a.reaction || '', a.note || ''];
      xr.eachCell({ includeEmpty: true }, (cell) => { cell.font = FONT; cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER }; });
    });
  ls.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: LH.length } };
  return { wb, rounds, rows };
}

function stampNow(){
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return {
    text: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`,
    file: `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`,
  };
}

export async function exportContactGrid(){
  const cur = roundById(currentRoundId());
  if(!cur) return showSaveErrorToast('차수를 먼저 고르세요');
  const lbl = document.getElementById('crm-add-lbl');
  const prev = lbl ? lbl.textContent : '';
  if(lbl) lbl.textContent = '만드는 중…';
  try {
    const ExcelJS = await loadExcelJs();
    const stamp = stampNow();
    const { wb, rows } = buildContactWorkbook(ExcelJS, cur.event_id, stamp);
    if(!rows.length) return showSaveErrorToast('내보낼 명단이 없어요');
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${evLabel(cur.event_id)}_TM DM 현황_${stamp.file}.xlsx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    trackAction('export', '컨택 현황표', cur.event_id, `${escapeHtml(evLabel(cur.event_id))} TM/DM 현황표(${rows.length}곳)를 엑셀로 내려받았어요`);
  } catch(err){
    console.error('[contact] 현황표 내보내기 실패:', err);
    showSaveErrorToast(err.message || '엑셀을 만들지 못했어요');
  } finally {
    if(lbl) lbl.textContent = prev;
  }
}

Object.assign(window, { renderGrid, setGridFil, exportContactGrid });
