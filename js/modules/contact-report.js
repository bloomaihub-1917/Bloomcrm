/* ══════════════════════════════════════════════════════════════
   contact-report.js — 컨택 › 보고

   엑셀 «총괄표»를 옮긴 것이다. 발주처에 매일 보내던 숫자를 기록에서 바로 센다.
     차수별    행사의 차수마다 명단·연락한 곳·반응·목표·진행률
     명단별    고른 차수의 명단(«2022 전시 국내» …)마다 같은 숫자 + 기준일·이번 주 진행 수
     담당자별  누가 기준일·이번 주·누계로 몇 건 했나 (엑셀의 «계인_», «예지_»)
     날짜별    최근 14일 진행 수
     일일보고  위 숫자를 문장으로 — 복사해서 메일·메신저에 붙인다

   기준일을 바꾸면 그날 저녁 기준으로 다시 센다 — 그날 이후 기록은 빼고,
   반응은 그날까지의 마지막 반응으로 본다. 지난 보고를 다시 만들 때 쓴다.
══════════════════════════════════════════════════════════════ */
import { CONTACT_ROUNDS, CONTACT_ATTEMPTS } from '../state.js';
import { REACTIONS, roundById, membersOf, attemptsOf, memberName, evLabel, currentRoundId } from './contact-tab.js';
import { BUCKET } from './contact-grid.js';
import { escapeHtml, escAttr, td } from '../utils.js';
import { trackAction } from './audit-tab.js';

const BUCKETS = ['긍정', '보류', '부정', '미연결'];
const WD = ['일', '월', '화', '수', '목', '금', '토'];
let repDate = null;   // 기준일 — 비면 오늘

const dayOf = (a) => String(a.at || '').slice(0, 10);
const fmtDay = (d) => { const x = new Date(d + 'T00:00'); return `${d.slice(5).replace('-', '/')}(${WD[x.getDay()]})`; };
function shift(d, n){
  const x = new Date(d + 'T00:00'); x.setDate(x.getDate() + n);
  const p = (v) => String(v).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
}
/* 이번 주 = 기준일이 든 주의 월요일부터 */
const mondayOf = (d) => { const w = new Date(d + 'T00:00').getDay(); return shift(d, -((w + 6) % 7)); };
const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);

/* ── 한 차수를 기준일 저녁 기준으로 센다 ── */
export function roundReport(r, d){
  const mon = mondayOf(d);
  const blank = () => ({ total: 0, touched: 0, goal: 0, day: 0, week: 0, dayOrgs: 0, ...Object.fromEntries(BUCKETS.map(b => [b, 0])) });
  const sum = blank();
  const bySrc = new Map();
  membersOf(r.id).forEach(m => {
    /* 명단에 넣은 날로 거르지 않는다 — 옛 엑셀 기록을 가져오면 명단은 오늘 생기고
       기록은 지난 날짜다. 거르면 지난 보고에서 그 기록이 통째로 빠진다. */
    const atts = attemptsOf(m.id).filter(a => dayOf(a) <= d);
    const src = m.source || '(명단 이름 없음)';
    if(!bySrc.has(src)) bySrc.set(src, blank());
    const day = atts.filter(a => dayOf(a) === d).length;
    [sum, bySrc.get(src)].forEach(s => {
      s.total++;
      if(atts.length) s.touched++;
      const b = atts.length && BUCKET[atts[0].reaction];
      if(b && s[b] !== undefined) s[b]++;
      if(m.goal_at && m.goal_at <= d) s.goal++;
      s.day += day;
      if(day) s.dayOrgs++;
      s.week += atts.filter(a => dayOf(a) >= mon).length;
    });
  });
  const atts = CONTACT_ATTEMPTS.filter(a => a.round_id === r.id && dayOf(a) <= d);
  const byStaff = new Map();
  atts.forEach(a => {
    const k = a.by_name || a.by_email || '(이름 없음)';
    if(!byStaff.has(k)) byStaff.set(k, { day: 0, week: 0, total: 0, ...Object.fromEntries(BUCKETS.map(b => [b, 0])) });
    const s = byStaff.get(k);
    s.total++;
    if(dayOf(a) >= mon) s.week++;
    if(dayOf(a) === d){ s.day++; const b = BUCKET[a.reaction]; if(s[b] !== undefined) s[b]++; }
  });
  const trend = Array.from({ length: 14 }, (_, i) => shift(d, i - 13)).map(day => {
    const xs = atts.filter(a => dayOf(a) === day);
    return { day, n: xs.length, orgs: new Set(xs.map(a => a.member_id)).size, pos: xs.filter(a => BUCKET[a.reaction] === '긍정').length };
  });
  // 오늘 특이사항 — 메모가 있는 긍정·보류·부정
  const notes = atts.filter(a => dayOf(a) === d && a.note && ['긍정', '보류', '부정'].includes(BUCKET[a.reaction]))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  // 오늘 진행한 반응별 수 (곳이 아니라 건)
  const dayB = Object.fromEntries(BUCKETS.map(b => [b, atts.filter(a => dayOf(a) === d && BUCKET[a.reaction] === b).length]));
  return { sum, bySrc: [...bySrc.entries()].sort((a, b) => b[1].total - a[1].total), byStaff: [...byStaff.entries()].sort((a, b) => b[1].total - a[1].total), trend, notes, dayB, mon };
}

/* ── 일일보고 문장 ── */
export function dailyText(r, d, rep = roundReport(r, d)){
  const { sum, bySrc, notes, dayB, mon } = rep;
  const goal = r.goal || '목표';
  const memOf = new Map(membersOf(r.id).map(m => [m.id, m]));
  const L = [];
  L.push(`[${evLabel(r.event_id)}] ${r.name} — ${fmtDay(d)} 일일보고`);
  L.push(`· 오늘 진행 ${sum.day}건(${sum.dayOrgs}곳): ${BUCKETS.map(b => `${b} ${dayB[b]}`).join(' · ')}`);
  L.push(`· 이번 주(${fmtDay(mon)}~) ${sum.week}건`);
  L.push(`· 누계: 명단 ${sum.total}곳 중 ${sum.touched}곳 연락(${pct(sum.touched, sum.total)}%), ${goal} ${sum.goal}곳`);
  L.push(`  최근 반응 — ${BUCKETS.map(b => `${b} ${sum[b]}`).join(' · ')}`);
  if(bySrc.length > 1){
    L.push('· 명단별');
    bySrc.forEach(([src, s]) => L.push(`  - ${src}: ${s.total}곳 중 ${s.touched}곳 연락(${pct(s.touched, s.total)}%) · 긍정 ${s['긍정']} · 보류 ${s['보류']} · 부정 ${s['부정']} · ${goal} ${s.goal}`));
  }
  if(notes.length){
    L.push('· 특이사항');
    notes.slice(0, 12).forEach(a => {
      const m = memOf.get(a.member_id);
      L.push(`  - ${m ? memberName(m) : ''}: ${REACTIONS[a.reaction]?.label || ''} — ${a.note}`);
    });
    if(notes.length > 12) L.push(`  … 외 ${notes.length - 12}건`);
  }
  return L.join('\n');
}

/* ══════════════════════════════════════════
   화면
══════════════════════════════════════════ */
export function renderReport(){
  const el = document.getElementById('v-report');
  if(!el) return;
  const r = roundById(currentRoundId());
  if(!r){
    el.innerHTML = `<div class="empty" style="height:auto;padding:60px 20px"><p style="font-size:12px">왼쪽에서 차수를 고르거나 새로 만드세요</p>
      <button class="btn bp bs" onclick="openRoundEditor()">차수 만들기</button></div>`;
    return;
  }
  const d = repDate || td();
  const rep = roundReport(r, d);
  const { sum, bySrc, byStaff, trend } = rep;
  const goal = r.goal || '목표';
  const evRounds = CONTACT_ROUNDS.filter(x => x.event_id === r.event_id)
    .sort((a, b) => String(a.date_from || a.created_at || '').localeCompare(String(b.date_from || b.created_at || '')));
  const th = 'font-size:11px;text-align:right;padding:6px 8px;border-bottom:1px solid var(--i6);background:var(--i8);white-space:nowrap';
  const thl = th.replace('text-align:right', 'text-align:left');
  const tdc = 'font-size:12px;text-align:right;padding:6px 8px;border-bottom:1px solid var(--i7);white-space:nowrap';
  const tdl = tdc.replace('text-align:right', 'text-align:left') + ';white-space:normal';
  const box = (title, body, extra = '') => `<div style="background:var(--W);border:1px solid var(--i6);border-radius:var(--r);margin-bottom:12px;overflow:hidden">
    <div style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--i7)"><div style="font-size:12.5px;font-weight:700">${title}</div>${extra}</div>
    <div style="overflow:auto">${body}</div></div>`;
  const statCols = (s) => `<td style="${tdc}">${s.total}</td><td style="${tdc}">${s.touched}</td><td style="${tdc};color:var(--a);font-weight:600">${pct(s.touched, s.total)}%</td>
    ${BUCKETS.map(b => `<td style="${tdc}">${s[b] || ''}</td>`).join('')}<td style="${tdc};color:var(--g);font-weight:600">${s.goal || ''}</td>`;
  const statHead = `<th style="${th}">전체</th><th style="${th}">연락한 곳</th><th style="${th}">진행률</th>${BUCKETS.map(b => `<th style="${th}">${b}</th>`).join('')}<th style="${th}">${escapeHtml(goal)}</th>`;
  const maxN = Math.max(1, ...trend.map(t => t.n));

  el.innerHTML = `<div style="padding:12px 16px 40px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <div style="font-size:15px;font-weight:700">${escapeHtml(r.name)}</div>
      <span class="pill p-gray">${escapeHtml(evLabel(r.event_id))}</span>
      <span style="margin-left:auto;font-size:11.5px;color:var(--i3);display:flex;align-items:center;gap:5px">기준일
        <input type="date" value="${escapeHtml(d)}" max="${escapeHtml(td())}" onchange="setReportDate(this.value)" style="font-size:11.5px;border:1px solid var(--i6);border-radius:5px;padding:3px 5px">
        ${repDate && repDate !== td() ? `<a href="javascript:void(0)" onclick="setReportDate('')" style="color:var(--a)">오늘로</a>` : ''}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:12px">
      ${[[`${fmtDay(d)} 진행`, `${sum.day}건`, `${sum.dayOrgs}곳`],
         ['이번 주', `${sum.week}건`, `${fmtDay(rep.mon)}부터`],
         ['연락한 곳', `${sum.touched}/${sum.total}`, `진행률 ${pct(sum.touched, sum.total)}%`],
         [`${goal} 달성`, `${sum.goal}곳`, `명단의 ${pct(sum.goal, sum.total)}%`]].map(([l, v, s]) => `
        <div style="background:var(--W);border:1px solid var(--i6);border-radius:var(--r);padding:9px 12px">
          <div style="font-size:10.5px;color:var(--i4)">${l}</div><div style="font-size:18px;font-weight:700">${v}</div>
          <div style="font-size:10.5px;color:var(--i4)">${s}</div></div>`).join('')}
    </div>

    ${box('일일보고', `<pre id="rep-text" style="margin:0;padding:10px 12px;font-family:inherit;font-size:12px;line-height:1.7;white-space:pre-wrap">${escapeHtml(dailyText(r, d, rep))}</pre>`,
      `<button class="btn bs bp" style="margin-left:auto" onclick="copyDailyReport()">문장 복사</button>`)}

    ${box('명단별', `<table style="width:100%;border-collapse:collapse"><thead><tr><th style="${thl}">명단</th>${statHead}
        <th style="${th}">${fmtDay(d)}</th><th style="${th}">이번 주</th></tr></thead><tbody>
      ${bySrc.map(([src, s]) => `<tr><td style="${tdl}">${escapeHtml(src)}</td>${statCols(s)}<td style="${tdc}">${s.day || ''}</td><td style="${tdc}">${s.week || ''}</td></tr>`).join('')}
      <tr style="font-weight:700;background:var(--i9)"><td style="${tdl}">합계</td>${statCols(sum)}<td style="${tdc}">${sum.day || ''}</td><td style="${tdc}">${sum.week || ''}</td></tr>
      </tbody></table>`, `<span style="font-size:10.5px;color:var(--i4)">반응은 곳마다 ${fmtDay(d)}까지의 마지막 반응</span>`)}

    ${box('담당자별', byStaff.length ? `<table style="width:100%;border-collapse:collapse"><thead><tr><th style="${thl}">담당</th>
        <th style="${th}">${fmtDay(d)}</th>${BUCKETS.map(b => `<th style="${th}">${b}</th>`).join('')}<th style="${th}">이번 주</th><th style="${th}">누계</th></tr></thead><tbody>
      ${byStaff.map(([k, s]) => `<tr><td style="${tdl}">${escapeHtml(k)}</td><td style="${tdc};font-weight:600">${s.day || ''}</td>
        ${BUCKETS.map(b => `<td style="${tdc}">${s[b] || ''}</td>`).join('')}<td style="${tdc}">${s.week || ''}</td><td style="${tdc}">${s.total}</td></tr>`).join('')}
      </tbody></table>` : '<div style="padding:14px 12px;font-size:11.5px;color:var(--i4)">아직 기록이 없어요</div>', '<span style="font-size:10.5px;color:var(--i4)">건 수 — 같은 곳에 두 번 걸면 두 건</span>')}

    ${box('최근 14일', `<div style="display:flex;align-items:flex-end;gap:4px;padding:12px 12px 6px;min-width:520px">
      ${trend.map(t => `<div style="flex:1;text-align:center" title="${escapeHtml(t.day)} · ${t.n}건 · ${t.orgs}곳 · 긍정 ${t.pos}">
        <div style="font-size:10px;color:var(--i3);height:13px">${t.n || ''}</div>
        <div style="height:${Math.round(t.n / maxN * 70)}px;min-height:${t.n ? 2 : 0}px;background:${t.day === d ? 'var(--a)' : 'var(--i5)'};border-radius:3px 3px 0 0"></div>
        <div style="font-size:10px;color:${t.day === d ? 'var(--a)' : 'var(--i4)'};margin-top:3px;white-space:nowrap">${escapeHtml(t.day.slice(8))}</div></div>`).join('')}
      </div>`)}

    ${evRounds.length > 1 ? box('이 행사의 차수', `<table style="width:100%;border-collapse:collapse"><thead><tr><th style="${thl}">차수</th>
        <th style="${thl}">기간</th><th style="${th}">명단</th><th style="${th}">연락한 곳</th><th style="${th}">진행률</th>${BUCKETS.map(b => `<th style="${th}">${b}</th>`).join('')}<th style="${th}">목표 달성</th></tr></thead><tbody>
      ${evRounds.map(x => { const s = roundReport(x, d).sum; return `<tr style="${x.id === r.id ? 'background:var(--ad)' : ''};cursor:pointer" onclick="pickRound('${escAttr(x.id)}')">
        <td style="${tdl}">${escapeHtml(x.channel || 'TM')} · ${escapeHtml(x.name)}${x.goal ? ` <span style="color:var(--i4)">(${escapeHtml(x.goal)})</span>` : ''}</td>
        <td style="${tdl};white-space:nowrap;color:var(--i4)">${escapeHtml([x.date_from, x.date_to].filter(Boolean).join(' ~ '))}</td>
        <td style="${tdc}">${s.total}</td><td style="${tdc}">${s.touched}</td><td style="${tdc}">${pct(s.touched, s.total)}%</td>
        ${BUCKETS.map(b => `<td style="${tdc}">${s[b] || ''}</td>`).join('')}<td style="${tdc}">${s.goal || ''}</td></tr>`; }).join('')}
      </tbody></table>`) : ''}
  </div>`;
}

export function setReportDate(v){ repDate = v && v !== td() ? v : null; renderReport(); }

export async function copyDailyReport(){
  const r = roundById(currentRoundId());
  if(!r) return;
  const d = repDate || td();
  const text = dailyText(r, d);
  try { await navigator.clipboard.writeText(text); }
  catch(e){
    // 클립보드 권한이 없으면 글을 골라 두어 Ctrl+C로 가져가게 한다
    const pre = document.getElementById('rep-text');
    if(pre){ const rg = document.createRange(); rg.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); }
    alert('자동 복사가 안 돼서 문장을 골라 두었어요. Ctrl+C로 복사하세요.');
    return;
  }
  const btn = document.querySelector('#v-report button.bp');
  if(btn){ const t = btn.textContent; btn.textContent = '복사했어요'; setTimeout(() => { btn.textContent = t; }, 1500); }
  trackAction('export', '컨택 일일보고', r.name, `${escapeHtml(evLabel(r.event_id))} ${escapeHtml(r.name)} — ${escapeHtml(d)} 일일보고 문장을 복사했어요`);
}

Object.assign(window, { renderReport, setReportDate, copyDailyReport });
