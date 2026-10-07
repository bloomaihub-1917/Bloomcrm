/* ══════════════════════════════════════════════════════════════
   conf-dash.js — 연사 대시보드 (컨퍼런스 탭 › 대시보드)

   전시 대시보드와 같은 질문에 답한다 — 사람 하나하나가 아니라 행사 전체를 본다.
     어디까지 왔나   연락 단계별 · 받을 자료별 진행
     오늘 뭘 하나    마감 지난 단계, 오래 답이 없는 연사, 미배정 세션
   숫자는 모두 «해당하는 사람»만 분모로 센다. 좌장에게 초록을 묻지 않듯
   묻지 않는 것을 분모에 넣으면 영영 100%가 안 된다.

   취소된 연사는 세지 않는다. 프로그램에서 빠진 사람의 자료가 안 왔다고
   처리 필요에 올리면 정작 할 일이 묻힌다.
══════════════════════════════════════════════════════════════ */
import { speakersForEvent, sessionsForEvent, assignmentsOfSession, assignmentsFor,
  rolesOfSpeaker, logsOfSpeaker, auditLog } from '../state.js';
import { SPEAKER_ROLES } from '../constants.js';
import { escapeHtml, escAttr, td } from '../utils.js';
import { progressBar } from './exh-tab.js';
import { SP_COLS, spCell } from './conf-tab.js';
import { flowStatus, missingItems } from './speaker-flow.js';
import { isStale, isUnread, mailCardHtml } from './mail-mark.js';

const dayDiff = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);
const spName = (sp) => sp.name_snapshot || sp.name_en || '(이름 없음)';

/* 이 연사와 마지막으로 무엇이든 주고받은 날 — 보낸 날짜 칸과 메일 기록 중 가장 늦은 것 */
function lastTouch(sp){
  const ds = [sp.guide_sent_at, sp.invite_replied_at, sp.reminded_at, sp.confirmed_at,
    // 계좌 열람 같은 내부 기록은 연락이 아니다 — 세면 «답 없음» 알림이 사라진다
    ...logsOfSpeaker(sp.id).filter(l => l.kind !== 'view').map(l => l.ts)].filter(Boolean).map(d => String(d).slice(0, 10));
  return ds.sort().pop() || '';
}

export function confDashHtml(ev){
  const all = speakersForEvent(ev.key);
  const live = all.filter(sp => sp.status !== '취소');
  const cancelled = all.length - live.length;
  if(!live.length){
    return `<div style="padding:22px;background:var(--i8);border:1px solid var(--i6);border-radius:10px;
      font-size:12px;color:var(--i5);line-height:1.7">
      아직 연사가 없어요. «Program»에서 세션을 만들고 사람을 배정하면 여기에 진행이 모여요.</div>`;
  }
  const today = td();
  /* VIP처럼 주최사가 정보를 넘겨주는 사람은 우리가 연락하지 않는다 — 단계·처리 필요에서 뺀다 */
  const flows = live.map(sp => ({ sp, f: flowStatus(sp) })).filter(x => !x.f.skip);

  /* ── 연락 단계 ── 단계 정의는 행사 설정(conf.flow)을 따른다 */
  const steps = (flows[0]?.f.steps || []).map(s => {
    const rows = flows.map(({ sp, f }) => ({ sp, st: f.steps.find(x => x.key === s.key) }))
      .filter(r => r.st && r.st.applies);
    const done = rows.filter(r => r.st.isDone).length;
    // 지금 이 단계에 머물러 있는 사람 — 앞 단계가 안 끝난 사람은 여기서 재촉하지 않는다
    const here = flows.filter(({ f }) => f.current && f.current.key === s.key).length;
    return { s, of: rows.length, done, here };
  }).filter(x => x.of);

  /* ── 받을 자료 ── */
  const needs = SP_COLS.map(c => {
    const cells = live.map(sp => spCell(sp, ev.key, c.key)).filter(x => x.state !== 'na');
    return { c, of: cells.length,
      done: cells.filter(x => x.state === 'done').length,
      part: cells.filter(x => x.state === 'part').length };
  }).filter(x => x.of);

  /* ── 처리 필요 ── */
  const dueMiss = [], silent = [];
  flows.forEach(({ sp, f }) => {
    if(!f.current) return;
    const label = f.remind ? '자료 독촉' : f.current.label;
    if(f.current.due && f.current.due < today){
      dueMiss.push({ sp, step: f.current.key, label,
        text: `${f.current.due} 마감 · ${f.current.key === 'collect'
          ? missingItems(sp).map(m => m.c.label).join('·') + ' 아직' : '아직 안 됨'}`,
        days: dayDiff(today, f.current.due) });
      return;
    }
    // 보낸 뒤 열흘 넘게 아무 기록이 없으면 연락이 끊긴 것으로 본다
    const t = lastTouch(sp);
    if(t && f.current.key !== 'invite' && dayDiff(today, t) >= 10){
      silent.push({ sp, step: f.current.key, label, text: `마지막 연락 ${t}`, days: dayDiff(today, t) });
    }
  });
  dueMiss.sort((a, b) => b.days - a.days);
  silent.sort((a, b) => b.days - a.days);

  const sessions = sessionsForEvent(ev.key).filter(s => !s.kind);
  const emptySess = sessions.filter(s => !assignmentsOfSession(s.id).length);
  const unassigned = live.filter(sp => !assignmentsFor(sp.id).length);
  /* 처리 필요에는 3일 넘게 처리 안 한 받은 메일만 — 전부 넣으면 마감 지난 일이 묻힌다.
     나머지는 «메일함» 카드에서 본다(규칙은 mail-mark.js) */
  const inbox = [];
  live.forEach(sp => logsOfSpeaker(sp.id).filter(isStale).forEach(l => inbox.push({ sp, l })));
  inbox.sort((a, b) => String(a.l.ts || '').localeCompare(String(b.l.ts || '')));   // 오래된 것부터
  const todo = dueMiss.length + silent.length + emptySess.length + unassigned.length + inbox.length;

  const confirmed = live.filter(sp => sp.confirmed_at).length;
  const doneAll = flows.filter(({ f }) => !f.current).length;
  const avg = Math.round(live.reduce((s, sp) => {
    const cells = SP_COLS.map(c => spCell(sp, ev.key, c.key)).filter(x => x.state !== 'na');
    return s + (cells.length ? cells.filter(x => x.state === 'done').length / cells.length : 1);
  }, 0) / live.length * 100);

  const card = (label, value, sub, color) => `<div class="cosi" style="flex:1 1 128px">
    <div class="cosn" style="color:${color || 'var(--i1)'}">${value}</div>
    <div class="cosl">${label}</div>
    ${sub ? `<div style="font-size:9.5px;color:var(--i5);margin-top:2px">${sub}</div>` : ''}</div>`;

  const barRow = (label, done, of, { onclick = '', tip = '', right = '', late = false } = {}) => {
    const pct = of ? Math.round(done / of * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:9px;margin-bottom:7px${onclick ? ';cursor:pointer' : ''}"${
        onclick ? ` onclick="${onclick}" title="${escAttr(tip)}"` : ''}>
      <span style="font-size:11.5px;color:var(--i3);flex:0 0 92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(label)}</span>
      <div style="flex:1;min-width:0">${progressBar(pct, pct === 100 ? 'var(--g)' : late ? 'var(--re)' : 'var(--a)')}</div>
      <span style="font-size:11px;color:var(--i4);flex:0 0 44px;text-align:right">${done}/${of}</span>
      <span style="flex:0 0 72px;text-align:right;font-size:10px;color:${late ? 'var(--re)' : 'var(--i5)'}">${right}</span>
    </div>`;
  };

  const cardFlow = `<div class="uc">
    <div class="uc-ttl">연락 단계</div>
    ${steps.map(x => {
      const late = x.s.due && x.s.due < today && x.done < x.of;
      return barRow(x.s.label, x.done, x.of, {
        late,
        right: (x.here ? `지금 ${x.here}명` : '') + (x.s.due ? ` ${escapeHtml(x.s.due.slice(5))}` : ''),
      });
    }).join('')}
    <div style="font-size:10.5px;color:var(--i5);margin-top:6px">단계 이름·마감일은 설정 › 행사 관리 › 컨퍼런스에서 정합니다</div>
  </div>`;

  const cardNeeds = `<div class="uc">
    <div class="uc-ttl">받을 자료</div>
    ${needs.map(x => barRow(x.c.label, x.done, x.of, {
      onclick: `openConfNeedTodo('${escAttr(x.c.key)}')`,
      tip: `${x.c.label}을 아직 안 낸 연사 보기`,
      right: x.part ? `일부 ${x.part}` : '',
    })).join('')}
    <div style="font-size:10.5px;color:var(--i5);margin-top:6px">줄을 누르면 아직 안 낸 연사만 보여요</div>
  </div>`;

  const cardPeople = (() => {
    const byRole = {};
    live.forEach(sp => rolesOfSpeaker(sp.id).forEach(r => { byRole[r] = (byRole[r] || 0) + 1; }));
    const byStatus = {};
    all.forEach(sp => { const s = sp.status || '섭외중'; byStatus[s] = (byStatus[s] || 0) + 1; });
    const roles = SPEAKER_ROLES.map(r => r.key).filter(k => byRole[k])
      .concat(Object.keys(byRole).filter(k => !SPEAKER_ROLES.some(r => r.key === k)));
    return `<div class="uc">
      <div class="uc-ttl">연사 구성</div>
      <div style="font-size:10.5px;color:var(--i4);margin-bottom:3px">역할</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">
        ${roles.map(r => `<span class="pill ${(SPEAKER_ROLES.find(x => x.key === r) || {}).cls || 'p-gray'}"
          style="cursor:pointer" onclick="openConfRole('${escAttr(r)}')">${escapeHtml(r)} ${byRole[r]}</span>`).join('')
          || '<span style="font-size:11.5px;color:var(--i5)">배정된 역할이 없어요</span>'}
      </div>
      <div style="font-size:10.5px;color:var(--i4);margin-bottom:3px">섭외 상태</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px">
        ${['확정', '섭외중', '보류', '취소'].filter(s => byStatus[s]).map(s =>
          `<span class="pill ${s === '확정' ? 'p-green' : s === '취소' ? 'p-gray' : 'p-amber'}">${s} ${byStatus[s]}</span>`).join('')}
      </div>
      <div style="font-size:10.5px;color:var(--i4);margin-bottom:3px">세션</div>
      <div style="font-size:11.5px;color:var(--i3)">발표 세션 ${sessions.length}개${
        emptySess.length ? ` · <span style="color:var(--am)">연사 없는 세션 ${emptySess.length}</span>` : ''}</div>
    </div>`;
  })();

  const attnRow = (o) => `<div onclick="openSpeakerDr('${escAttr(o.sp.id)}');openFlowDraft('${escAttr(o.step)}')"
    style="display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:6px;cursor:pointer;background:var(--i9);margin-bottom:4px"
    title="이 단계 메일 초안 열기">
    <span style="flex:0 0 128px;font-weight:700;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(spName(o.sp))}</span>
    <span class="pill p-gray" style="flex:0 0 auto">${escapeHtml(o.label)}</span>
    <span style="font-size:11.5px;color:var(--i3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(o.text)}</span>
    ${o.days > 0 ? `<span class="pill ${o.days >= 3 ? 'p-amber' : 'p-gray'}" style="flex:0 0 auto">${o.days}일</span>` : ''}
  </div>`;

  const cardTodo = todo ? `<div class="uc" style="border-left:3px solid var(--am)">
      <div class="uc-ttl">처리 필요 <span class="pill p-amber">${todo}건</span></div>
      ${inbox.slice(0, 8).map(({ sp, l }) => `<div onclick="openSpeakerDr('${escAttr(sp.id)}','box')"
        style="display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:6px;cursor:pointer;background:var(--i9);margin-bottom:4px"
        title="메일함 탭 열기">
        <span style="flex:0 0 128px;font-weight:700;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(spName(sp))}</span>
        <span class="pill ${isUnread(l) ? 'p-red' : 'p-gray'}" style="flex:0 0 auto">${isUnread(l) ? '● 안 읽은 메일 3일+' : '받은 메일 3일+'}</span>
        <span style="font-size:11.5px;color:var(--i3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(l.subject || '(제목 없음)')}</span>
        ${dayDiff(today, String(l.ts || '').slice(0, 10)) > 0 ? `<span class="pill ${dayDiff(today, String(l.ts).slice(0, 10)) >= 3 ? 'p-amber' : 'p-gray'}" style="flex:0 0 auto">${dayDiff(today, String(l.ts).slice(0, 10))}일</span>` : ''}
      </div>`).join('')}
      ${inbox.length > 8 ? `<div style="font-size:11px;color:var(--i4);padding:2px 2px 6px">받은 메일 외 ${inbox.length - 8}건 — 설정 › 행사 › 메일에서 모아 볼 수 있어요</div>` : ''}
      ${dueMiss.slice(0, 10).map(attnRow).join('')}
      ${silent.slice(0, 6).map(o => attnRow({ ...o, label: '답 없음 · ' + o.label })).join('')}
      ${emptySess.slice(0, 5).map(s => `<div onclick="openPgaSession('${escAttr(s.id)}')"
        style="display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:6px;cursor:pointer;background:var(--i9);margin-bottom:4px">
        <span style="flex:0 0 128px;font-weight:700;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${
          escapeHtml(s.title_ko || s.title_en || '(세션)')}</span>
        <span class="pill p-gray">연사 없음</span>
        <span style="font-size:11.5px;color:var(--i3)">${escapeHtml([s.date, s.start_at].filter(Boolean).join(' '))}</span></div>`).join('')}
      ${unassigned.length ? `<div onclick="openConfSess('__none__')" style="font-size:11px;color:var(--am);padding:6px 2px;cursor:pointer">
        세션에 배정 안 된 연사 ${unassigned.length}명 — ${unassigned.slice(0, 4).map(sp => escapeHtml(spName(sp))).join(', ')}${
          unassigned.length > 4 ? ' …' : ''}</div>` : ''}
      ${dueMiss.length > 10 || silent.length > 6 ? `<div style="font-size:11px;color:var(--i4);padding:6px 2px">나머지는 Speakers 표의 «지금 할 일»에서 볼 수 있어요</div>` : ''}
    </div>` : `<div class="uc" style="border-left:3px solid var(--g)">
      <div class="uc-ttl">처리 필요</div>
      <div style="font-size:12px;color:var(--g)">지금 처리할 게 없어요</div></div>`;

  const cardRecent = (() => {
    const recent = auditLog.filter(l => l.target === ev.key)
      .sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 8);
    return `<div class="uc">
      <div class="uc-ttl">최근 변경</div>
      ${recent.length ? recent.map(l => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--i8)">
        <span style="font-size:11px;color:var(--i3);flex:0 0 auto">${escapeHtml(l.name || '')}</span>
        <span style="font-size:11.5px;color:var(--i2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${
          escapeHtml((l.detail || '').replace(/<[^>]+>/g, ''))}</span>
        <span style="font-size:10px;color:var(--i5);flex:0 0 auto">${escapeHtml(String(l.ts || '').slice(5, 10))}</span>
      </div>`).join('') : '<div style="font-size:11.5px;color:var(--i5)">아직 변경 이력이 없어요</div>'}
    </div>`;
  })();

  return `<div class="exh-dash">
    <div class="cost exh-dash-kpi" style="margin:0">
      ${card('연사', live.length + '명', cancelled ? '취소 ' + cancelled : '')}
      ${card('참가 확정', `${confirmed}/${live.length}`, '', confirmed === live.length ? 'var(--g)' : '')}
      ${card('자료 진행률', avg + '%', `연락 완료 ${doneAll}명`)}
      ${card('처리 필요', todo + '건',
        `${inbox.length ? `묵은 메일 ${inbox.length} · ` : ''}마감 지남 ${dueMiss.length} · 답 없음 ${silent.length} · 미배정 ${emptySess.length + unassigned.length}`,
        todo ? 'var(--re)' : 'var(--g)')}
    </div>
    <div class="exh-dash-third">${cardFlow}</div>
    <div class="exh-dash-third">${cardNeeds}</div>
    <div class="exh-dash-third">${cardPeople}</div>
    <div class="exh-dash-wide">${mailCardHtml(ev.key, 'conf')}</div>
    <div class="exh-dash-wide">${cardTodo}</div>
    <div class="exh-dash-side">${cardRecent}</div>
  </div>`;
}
