/* ══════════════════════════════════════════════════════════════
   features/conference/conf-people.js — 연사 보기 — 준비·정산·카드
   (modules/conf-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { loadSpeakerPhotos, speakerPhotoOf, speakerPhotosLoaded } from '../../api.js';
import { SPEAKER_ROLES } from '../../constants.js';
import { trackAction } from '../../core/audit-log.js';
import { progressBar, shortCell } from '../../modules/exh-tab.js';
import { nextActionLabel } from '../../modules/speaker-flow.js';
import { CONF_SESSIONS, assignmentsFor, bankDocs, contactsOfSpeaker, getSpeakerById, isDomesticSpeaker, paysFee, rolesOfSpeaker, sessionsForEvent, speakerNeed, speakersForEvent } from '../../state.js';
import { escAttr, escapeHtml, isMobile, photoSrc, td } from '../../utils.js';
import { confLockNotice, confLocked, isBreak, isHiddenSp } from './conf-common.js';
import { confUi } from './conf-ui.js';
import { SP_COLS, SP_SENT, nextActionTd, spCell } from './speaker-cells.js';
import { confPhotoAsked, countryChip, gSaveAssign, gSaveSpeaker, removeConfSpeaker, renderConf, schedAlertHtml, spFlagPills, spLeftPill } from '../../modules/conf-tab.js';
import { setSpeakerHidden, toggleConfHidden } from './conf-program.js';

/* ══════════════════════════════════════════
   연사 — 전시 진행관리와 같은 방식으로 본다

   전시에서 51개 기업의 준비 상황을 한 표로 보는 이유가 여기도 그대로다.
   연사가 스무 명이면 «누구에게 무엇이 안 왔나»를 사람마다 열어 볼 수 없다.
   한 줄에 한 사람, 한 칸에 한 항목을 놓고, 칸의 색과 기호로 상태를 읽는다.

   전시와 다른 점이 하나 있다. 전시는 모든 기업이 같은 단계를 밟지만 연사는
   역할마다 받을 것이 다르다 — 좌장에게 초록은 «안 온 것»이 아니라 «묻지 않은
   것»이다. 그래서 묻지 않는 칸은 빈칸(·)으로 두고 분모에서도 뺀다.
   그러지 않으면 좌장은 영원히 진행률 70%에 머문다.
══════════════════════════════════════════ */


/* 진행률 — 묻는 것만 분모에 넣는다 */
function spProgress(sp, evKey){
  const cells = SP_COLS.map(c => spCell(sp, evKey, c.key)).filter(c => c.state !== 'na');
  if(!cells.length) return { pct: 0, n: 0, of: 0 };
  const n = cells.filter(c => c.state === 'done').length;
  return { pct: Math.round(n / cells.length * 100), n, of: cells.length };
}

/* 칸 하나 — 전시 표와 같은 기호를 쓴다. 두 화면을 오가며 보는 사람이
   기호를 두 번 배우지 않게. */
/* 보낸 것 칸 — 날짜를 눌러 오늘로 찍고, 다시 누르면 지운다.
   표에서 바로 체크할 수 있어야 스무 명을 훑으며 정리할 수 있다. */
function spSentHtml(sp, col){
  const v = sp[col.key] || '';
  return `<td style="text-align:center;padding:5px 3px">
    <button onclick="event.stopPropagation();toggleSpeakerDate('${escAttr(sp.id)}','${col.key}')"
      title="${escapeHtml(`${col.tip || col.label}\n${v ? `보낸 날 ${v} — 누르면 지웁니다` : '누르면 오늘 날짜로 표시'}`)}"
      style="border:0;cursor:pointer;font:inherit;min-width:44px;padding:3px 5px;border-radius:5px;
      background:${v ? 'var(--ad)' : 'transparent'};color:${v ? 'var(--a)' : 'var(--i5)'};
      font-size:${v ? '9.5' : '12'}px;font-weight:${v ? '600' : '800'};line-height:1.2">${
      v ? escapeHtml(shortCell(v)) : '—'}</button></td>`;
}

function spCellHtml(c, colLabel, name, col){
  /* 값을 보여주는 칸은 기호를 쓰지 않는다 — 기호와 값이 함께 있으면 눈이
     기호를 먼저 읽고 값을 흘린다. */
  if(col && col.show === 'text'){
    if(c.state === 'na') return `<td title="${escapeHtml(`${name}의 역할은 ${colLabel}을(를) 받지 않아요`)}"></td>`;
    /* 칸 폭은 표가 정하므로 td의 max-width만으로는 글이 옆 칸으로 넘친다.
       안쪽 div에 폭을 박고 두 줄에서 자른다 — 전문은 title로 본다. */
    return `<td style="font-size:11px;line-height:1.4;color:${c.text ? 'var(--i2)' : 'var(--i5)'}"
      title="${escapeHtml(c.text || '')}"><div style="width:180px;white-space:normal;overflow:hidden;
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere">${
      c.text ? escapeHtml(c.text) : '—'}</div></td>`;
  }
  return spCellMark(c, colLabel, name);
}

function spCellMark(c, colLabel, name){
  const map = {
    done: { bg: 'var(--gb)', fg: 'var(--g)',  mark: '✓' },
    part: { bg: 'var(--ab)', fg: 'var(--am)', mark: '◐' },
    todo: { bg: 'transparent', fg: 'var(--i5)', mark: '—' },
    na:   { bg: 'transparent', fg: 'var(--i6)', mark: '·' },
  }[c.state];
  /* 받지 않는 칸은 비워 둔다 — 점이라도 찍혀 있으면 확인할 거리처럼 보인다 */
  if(c.state === 'na' && c.lapsed) return `<td style="text-align:center;font-size:9.5px;color:var(--i5)"
    title="${escapeHtml(`행사가 끝나 ${colLabel}은(는) 더 받지 않아요${c.text ? ` (${c.text})` : ''}`)}">지남</td>`;
  if(c.state === 'na') return `<td title="${escapeHtml(`${name}의 역할은 ${colLabel}을(를) 받지 않아요`)}"></td>`;
  const tip = c.state === 'na'
    ? `${name}의 역할은 ${colLabel}을(를) 받지 않아요`
    : c.state === 'done' ? `${colLabel} 받음${c.text ? ` (${c.text})` : ''}`
    : c.state === 'part' ? `${colLabel} 일부만 (${c.text})`
    : `${colLabel} 아직${c.need === 'opt' ? ' — 있으면 좋음' : ''}`;
  return `<td style="text-align:center;padding:5px 3px" title="${escapeHtml(tip)}">
    <div style="display:inline-flex;flex-direction:column;align-items:center;gap:1px;min-width:40px;
      padding:3px 4px;border-radius:5px;background:${map.bg}">
      <span style="font-size:12px;font-weight:800;color:${map.fg};line-height:1">${map.mark}</span>
      ${c.text ? `<span style="font-size:9px;color:${map.fg};line-height:1.1">${escapeHtml(shortCell(c.text))}</span>` : ''}
    </div></td>`;
}

/* 항목별 집계 — «묻는 사람» 중 몇 명이 냈나 */
function spTally(list, evKey, key){
  const live = list.map(sp => spCell(sp, evKey, key)).filter(c => c.state !== 'na');
  return { n: live.filter(c => c.state === 'done').length, of: live.length };
}

/* 표에서 바로 날짜를 찍는다. 연사 드로어를 열지 않고 스무 명을 훑으며
   «보냈다»를 체크하는 일이 실제로 있다. 전시의 받음 체크와 같은 규칙으로
   오늘 날짜를 찍고, 다시 누르면 지운다. */
/* 한꺼번에 온 것을 한 번에 찍는다.

   받는 쪽을 합치지 않은 대신 이 길을 둔다. 이력·사진·동의서가 한 메일에
   같이 오는 일이 흔한데, 그때 칸을 하나씩 누르게 하면 네 번을 누르거나
   귀찮아서 안 누른다 — 안 누른 칸은 «아직 안 왔다»로 남아 또 독촉하게 된다.

   역할이 묻지 않는 항목과 이미 받은 것은 건드리지 않는다. 무엇이 찍히는지
   먼저 보여주고, 실제로 안 온 것은 사람이 다시 지운다. */
export async function receiveAll(spId){
  if(confLocked()){ confLockNotice(); return; }
  const sp = getSpeakerById(spId);
  if(!sp) return;
  const today = td();

  /* 연사 줄에 붙는 것과 배정 줄에 붙는 것이 다르다 — 발제는 배정마다 따로다 */
  const onSpeaker = [
    ['bio_pro',  'profile_received_at', '이력'],
    ['photo',    'photo_received_at',   '사진'],
    ['cv',       'cv_received_at',      'CV'],
    ['consent',  'consent_at',          '동의서'],
    ['passport', 'passport_received_at', '여권'],
  ].filter(([needKey, field]) => spCell(sp, sp.event_id, needKey).state === 'todo' && !sp[field]);

  const onAssign = [];
  assignmentsFor(sp.id).forEach(a => {
    [['abstract', 'abstract_received_at', '초록'], ['slides', 'slides_received_at', '발표자료']]
      .forEach(([needKey, field, label]) => {
        if(speakerNeed(sp.event_id, a.role, needKey) && !a[field]) onAssign.push({ a, field, label });
      });
  });

  if(!onSpeaker.length && !onAssign.length){
    alert('아직 안 받은 항목이 없어요.');
    return;
  }
  const names = [...onSpeaker.map(x => x[2]), ...onAssign.map(x => x.label)];
  if(!confirm(`${sp.name_snapshot || spId} — 아래를 ${today}에 받은 것으로 표시할까요?\n\n`
    + `· ${names.join('\n· ')}\n\n실제로 안 온 것은 그 칸을 다시 눌러 지우세요.`)) return;

  for(const [, field] of onSpeaker){
    const res = await gSaveSpeaker({ id: sp.id, [field]: today, updated_at: today });
    if(!res || res.ok === false){ if(!res?.locked) alert('저장에 실패했어요.'); renderConf(); return; }
    sp[field] = today;
  }
  for(const { a, field } of onAssign){
    const res = await gSaveAssign({ id: a.id, [field]: today });
    if(!res || res.ok === false){ if(!res?.locked) alert('저장에 실패했어요.'); renderConf(); return; }
    a[field] = today;
  }
  trackAction('edit', '연사 받음 일괄', confUi.confEvent,
    `${sp.name_snapshot || spId} — ${names.join(', ')} 받음`);
  renderConf();
}

export async function toggleSpeakerDate(spId, field){
  if(confLocked()){ confLockNotice(); return; }
  const sp = getSpeakerById(spId);
  if(!sp) return;
  const next = sp[field] ? '' : td();
  const backup = sp[field];
  sp[field] = next;
  renderConf();
  const res = await gSaveSpeaker({ id: spId, [field]: next, updated_at: td() });
  if(!res || res.ok === false){
    sp[field] = backup;
    renderConf();
    if(!res?.locked) alert('저장에 실패했어요.');
    return;
  }
  const label = (SP_SENT.find(c => c.key === field) || {}).label || field;
  trackAction('edit', '연사 진행', confUi.confEvent,
    `${sp.name_snapshot || spId} — ${label} ${next || '표시 지움'}`);
}

export function setConfNeedFil(key){
  /* 전시의 단계 칩과 같은 순환 — 완료만 → 미완료만 → 전체 */
  if(!confUi.confNeedFil || confUi.confNeedFil.key !== key) confUi.confNeedFil = { key, mode: 'done' };
  else if(confUi.confNeedFil.mode === 'done') confUi.confNeedFil = { key, mode: 'todo' };
  else confUi.confNeedFil = null;
  renderConf();
}
/* 대시보드에서 누르면 Speakers 표로 가서 그 조건으로 거른다 — 센 숫자를 눌렀는데
   아무 일이 없으면 셀 수만 있고 쓸 수는 없는 숫자가 된다 */
export function openConfNeedTodo(key){ confUi.confNeedFil = { key, mode: 'todo' }; confUi.confView = 'people'; renderConf(); }
export function openConfRole(role){ confUi.confRoleFil = role; confUi.confView = 'people'; renderConf(); }
export function openConfSess(id){ confUi.confSessFil = id; confUi.confView = 'people'; renderConf(); }
export function setConfSessFil(id){
  confUi.confSessFil = confUi.confSessFil === id ? '' : id;
  renderConf();
}
export function setConfRoleFil(role){
  confUi.confRoleFil = confUi.confRoleFil === role ? '' : role;
  renderConf();
}
export function setConfLayout(v){ confUi.confLayout = v; renderConf(); }
export function setConfCardFil(v){ confUi.confCardFil = confUi.confCardFil === v ? '' : v; renderConf(); }
export function setConfPhase(v){ confUi.confPhase = v; renderConf(); }
export function setConfSettleFil(v){ confUi.confSettleFil = confUi.confSettleFil === v ? '' : v; renderConf(); }
export function toggleConfNoFee(){ confUi.confShowNoFee = !confUi.confShowNoFee; renderConf(); }
export function setConfVideoFil(v){
  confUi.confVideoFil = confUi.confVideoFil === v ? '' : v;
  renderConf();
}

/* ── 연사 찾기 ──
   연사가 열일곱이면 눈으로 훑어도 되지만, 행사가 커지면 백 명이 넘고 칩으로
   좁혀도 한 화면에 안 들어온다. «그 사람 이름이 뭐였더라»가 아니라 «그 사람
   사진 받았던가»를 확인하려고 여는 화면이라, 이름을 쳐서 한 줄만 남기는
   편이 빠르다. 소속과 세션명으로도 찾는다 — 이름이 기억 안 날 때 대신
   떠오르는 것이 그 둘이다.

   검색칸은 본문이 아니라 상단바에 둔다(전시 탭과 같은 자리). 본문은 글자
   하나에 통째로 다시 그려지는데, 칸이 그 안에 있으면 매번 새로 만들어져
   커서가 날아간다 — 밖에 두면 그 일이 아예 없다. */
function confQuery(){
  return ((document.getElementById('conf-q')?.value
    || document.getElementById('conf-q-m')?.value || '')).trim();
}
function clearConfQuery(){
  const d = document.getElementById('conf-q');   if(d) d.value = '';
  const m = document.getElementById('conf-q-m'); if(m) m.value = '';
}
/* 모바일 칸에 친 것을 데스크톱 칸에도 옮겨 둔다 — 둘이 다른 값을 들고 있으면
   어느 쪽을 믿어야 할지 알 수 없다 */
export function searchConfM(v){
  const d = document.getElementById('conf-q');
  if(d) d.value = v;
  renderConf();
}
export function clearConfSearch(){
  clearConfQuery();
  renderConf();
}

/* ── 단계 ──
   행사 전에 챙기는 것(이력·사진·초록·발표자료)과 끝난 뒤 챙기는 것(연사료 서류·지급·
   영상 게재)은 겹치지 않는다. 한 표에 다 늘어놓으면 끝난 행사에서 «—»만 가득하다.
   행사 마지막 날이 지나면 정산이 먼저 열린다. */
const confPhaseOf = (ev) => confUi.confPhase
  || (String(ev.date_end || ev.date_start || ev.date || '9999') < td() ? 'settle' : 'prep');
const feeNum = (sp) => Number(String(sp.fee_amount || '').replace(/[^\d.-]/g, '')) || 0;
/* 연사료를 줄 사람 — 금액이 있고 역할이 연사료를 받는다 */
const feeOn = (sp) => feeNum(sp) > 0 && paysFee(sp);
/* 연사료 서류 중 아직 안 온 것 — 국내 신분증·통장사본·계좌번호, 해외 계좌·여권 */
export function settleMissing(sp){
  if(!feeOn(sp)) return [];
  const docs = bankDocs(sp).filter(d => !d.got).map(d => d.label);
  if(!isDomesticSpeaker(sp) && !sp.passport_received_at) docs.push('여권');
  return docs;
}

function peopleHtml(ev){
  const every = speakersForEvent(ev.key);
  const hiddenN = every.filter(isHiddenSp).length;
  /* 숨긴 연사는 목록·요약에서 뺀다 — «숨긴 연사 N명»을 눌러야 보인다 */
  const all = confUi.confShowHidden ? every : every.filter(sp => !isHiddenSp(sp));
  if(!every.length){
    return `<div style="padding:22px;background:var(--i8);border:1px solid var(--i6);border-radius:10px;
      font-size:12px;color:var(--i5);line-height:1.7">
      아직 연사가 없어요. «프로그램»에서 세션을 만들고 사람을 배정하면 여기 쌓여요.</div>`;
  }

  let list = all.slice().sort((a, b) =>
    String(a.name_snapshot || a.name_en || '').localeCompare(String(b.name_snapshot || b.name_en || ''), 'ko'));
  if(confUi.confRoleFil) list = list.filter(sp => rolesOfSpeaker(sp.id).includes(confUi.confRoleFil));
  /* '__none__'은 «배정 없음» — 세션에 안 들어간 사람이 남아 있는지 보려는
     것이라 세션 하나를 고른 것과 성격이 같다. */
  if(confUi.confSessFil === '__none__') list = list.filter(sp => !assignmentsFor(sp.id).length);
  else if(confUi.confSessFil.startsWith('t:')){
    /* 트랙 칩 — 그 트랙의 세션 아무 곳에나 들어가 있으면 남는다 */
    const t = confUi.confSessFil.slice(2);
    const ids = new Set(sessionsForEvent(ev.key).filter(x => (x.track || '') === t).map(x => x.id));
    list = list.filter(sp => assignmentsFor(sp.id).some(a => ids.has(a.session_id)));
  }
  else if(confUi.confSessFil) list = list.filter(sp =>
    assignmentsFor(sp.id).some(a => a.session_id === confUi.confSessFil));
  // 칩이 보이는 단계에서만 건다 — 안 보이는 칩이 표를 몰래 좁히지 않게
  const phase = confPhaseOf(ev);
  if(phase === 'settle'){
    if(confUi.confVideoFil) list = list.filter(sp => (sp.video_publish || 'none') === confUi.confVideoFil);
    if(confUi.confSettleFil === 'docs') list = list.filter(sp => settleMissing(sp).length);
    if(confUi.confSettleFil === 'unpaid') list = list.filter(sp => feeOn(sp) && !sp.fee_paid_at);
  }
  if(confUi.confNeedFil && phase === 'prep'){
    list = list.filter(sp => {
      const c = spCell(sp, ev.key, confUi.confNeedFil.key);
      if(c.state === 'na') return false;
      return confUi.confNeedFil.mode === 'done' ? c.state === 'done' : c.state !== 'done';
    });
  }
  /* 찾는 말은 칩보다 나중에 건다 — 칩으로 좁힌 안에서 다시 찾는 것이 순서다.
     띄어쓰기는 사람마다 달라서(«한양 대학교» / «한양대학교») 양쪽 다 지우고 견준다. */
  const sq = confQuery().toLowerCase().replace(/\s+/g, '');
  if(sq){
    list = list.filter(sp => [
      sp.name_snapshot, sp.name_en, sp.org_ko, sp.org_en, sp.title_ko, sp.title_en,
      ...assignmentsFor(sp.id).map(a => {
        const ss = CONF_SESSIONS.find(x => x.id === a.session_id);
        return ss ? [ss.title_ko, ss.title_en, ss.track].filter(Boolean).join(' ') : '';
      }),
    ].filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, '').includes(sq));
  }

  /* ── 위쪽 요약 — 전시의 카드 줄과 같은 자리 ── */
  const byStatus = (v) => all.filter(sp => (sp.status || '섭외중') === v).length;
  const noSession = all.filter(sp => !assignmentsFor(sp.id).length).length;
  const avg = all.length
    ? Math.round(all.reduce((n, sp) => n + spProgress(sp, ev.key).pct, 0) / all.length) : 0;
  const feeLeft = all.filter(sp => sp.fee_amount && !sp.fee_paid_at && paysFee(sp)).length;

  const card = (label, value, sub) => `<div style="min-width:96px">
    <div style="font-size:10px;color:var(--i4);margin-bottom:2px">${escapeHtml(label)}</div>
    <div style="font-size:18px;font-weight:800;line-height:1.1">${value}</div>
    ${sub ? `<div style="font-size:10px;color:var(--i4);margin-top:2px">${sub}</div>` : ''}
  </div>`;

  /* 정산 요약 — 연사료 대상·서류·지급·영상 게재 */
  const settleCards = () => {
    const fee = all.filter(feeOn), paid = fee.filter(sp => sp.fee_paid_at).length;
    const docs = fee.filter(sp => settleMissing(sp).length).length;
    const sum = fee.reduce((n, sp) => n + feeNum(sp), 0);
    const u = (t) => `<span style="font-size:11px;font-weight:600;color:var(--i4)">${t}</span>`;
    const v = (k) => all.filter(sp => (sp.video_publish || 'none') === k).length;
    return card('연사료 대상', `${fee.length}${u('명')}`, `총 ${sum.toLocaleString('ko-KR')}`)
      + card('서류', `${fee.length - docs}${u(`/${fee.length} 받음`)}`, docs ? `<span style="color:var(--am)">${docs}명 남음</span>` : '다 받음')
      + card('지급', `${paid}${u(`/${fee.length}`)}`, paid < fee.length ? `<span style="color:var(--am)">${fee.length - paid}명 미지급</span>` : '모두 지급')
      + card('영상 게재', `${v('yes')}${u('명 동의')}`, `비동의 ${v('no')} · 미확인 ${v('none')}`);
  };
  const summary = `<div style="display:flex;flex-wrap:wrap;gap:${isMobile() ? '14px 22px' : '20px'};padding:12px 14px;margin-bottom:10px;
      background:var(--i8);border:1px solid var(--i6);border-radius:10px">
    ${phase === 'settle' ? settleCards() : `${card('연사', `${all.length}<span style="font-size:11px;font-weight:600;color:var(--i4)">명</span>`,
      `확정 ${byStatus('확정')} · 섭외중 ${byStatus('섭외중')}`)}
    ${card('평균 진행률', `${avg}<span style="font-size:11px;font-weight:600;color:var(--i4)">%</span>`,
      '역할이 묻는 항목만 셈')}
    ${card('세션', `${sessionsForEvent(ev.key).filter(s => !isBreak(s)).length}<span style="font-size:11px;font-weight:600;color:var(--i4)">개</span>`,
      noSession ? `<span style="color:var(--am)">배정 없는 연사 ${noSession}</span>` : '모두 배정됨')}
    ${(() => { const live = all.filter(x => x.status !== '취소'), y = live.filter(x => x.gala_rsvp === 'yes').length,
        n = live.filter(x => x.gala_rsvp === 'no').length;
      return card('갈라디너', `${y}<span style="font-size:11px;font-weight:600;color:var(--i4)">명 참석</span>`,
        `불참 ${n} · 미확인 ${live.length - y - n}`); })()}
    ${feeLeft ? card('연사료', `${feeLeft}<span style="font-size:11px;font-weight:600;color:var(--i4)">명</span>`, '아직 미지급') : ''}`}
    <div style="margin-left:auto;align-self:center;display:flex;gap:6px">
      <button class="btn bs" onclick="openSpeakerBulkMail('${escAttr(ev.key)}')"
        title="연락 단계 메일(일정 변경 안내·자료 요청 등)을 여러 연사에게 한 번에 — 연사마다 한 통씩 따로 나갑니다">📨 여러 연사에게 메일</button>
      <button class="btn bs" id="sp-export-btn" onclick="exportSpeakers('${escAttr(ev.key)}')"
        title="프로그램표(Program At a Glance)·연사 전체 정보·약력과 초록을 엑셀 한 파일로 받습니다">엑셀 다운로드</button>
      <button class="btn bs" onclick="openSpeakerShare('${escAttr(ev.key)}')"
        title="프로그램(공개 주소)·수급 현황(비밀 링크)을 웹 페이지로 바깥에 보여 줍니다">🔗 외부 공유</button></div>
  </div>${schedAlertHtml(ev.key, all)}`;

  /* ── 세션 칩 ──
     세션명은 길다. 여덟 개가 늘어서면 칩 줄이 그대로 목록이 되어, 고르는
     자리가 아니라 읽는 자리가 된다 — 좁은 화면에서는 화면 절반을 먹는다.

     그래서 트랙이 있으면 트랙으로 묶는다. «이 트랙 사람들»이 실제로 챙기는
     단위이기도 하고, 색도 프로그램 표와 같은 색을 써서 두 화면이 이어진다.
     트랙이 없는 세션만 제 이름으로 남는다 — 묶을 데가 없으니 숨기면 아예
     고를 수 없게 된다. 세션 하나하나는 툴팁에 일자·시각과 함께 적어 둔다. */
  /* 검색칸은 상단바에 있다. 여기서는 «지금 걸려 있다»는 것과 몇 명이 남았는지만
     알린다 — 치고 나서 왜 줄이 줄었는지 화면 안에 이유가 있어야 한다. */
  const q = confQuery();
  const searchNote = q ? `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;
      background:var(--i8);border:1px solid var(--i6);border-radius:8px;padding:7px 11px">
    <span style="font-size:11.5px;color:var(--i3)">«<b>${escapeHtml(q)}</b>»로 찾은 연사 ${list.length}명${
      confUi.confView !== 'people' ? ' — 검색어를 지우면 보던 화면으로 돌아갑니다' : ''}</span>
    <button class="btn bs" style="font-size:10.5px;padding:2px 8px;margin-left:auto"
      onclick="clearConfSearch()">검색 지우기</button>
  </div>` : '';

  /* ── 거르기 한 줄 ──
     세션·역할은 칩 두 줄이 화면 위 3분의 1을 먹었다. 고르는 자리이니 드롭다운으로
     줄이고, 단계에 따라 바뀌는 칩(정산의 서류·지급·영상 게재)만 칩으로 둔다.
     식사·휴식은 시간표에만 있고 연사가 없다 — 세션 고르기에서 뺀다 */
  const sessions = sessionsForEvent(ev.key).filter(s => !isBreak(s));
  const noSess = all.filter(sp => !assignmentsFor(sp.id).length).length;
  const headN = (ids) => all.filter(sp => assignmentsFor(sp.id).some(a => ids.has(a.session_id))).length;
  const chipTracks = [...new Set(sessions.map(s => s.track).filter(Boolean))];
  const looseSess = sessions.filter(s => !s.track);
  const opt = (v, label, on) => `<option value="${escapeHtml(v)}"${on ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const sessSel = (sessions.length || noSess) ? `<select class="fi" style="width:auto;max-width:240px;font-size:11.5px;padding:4px 7px"
      onchange="setConfSessFil(this.value || '')" title="세션·트랙으로 거르기">
    ${opt('', '전체 세션', !confUi.confSessFil)}
    ${chipTracks.map(t => { const ss = sessions.filter(x => x.track === t);
      return opt('t:' + t, `${t} · ${headN(new Set(ss.map(x => x.id)))}명`, confUi.confSessFil === 't:' + t); }).join('')}
    ${looseSess.map(ss => opt(ss.id, `${ss.title_ko || ss.title_en || ss.id} · ${
      all.filter(sp => assignmentsFor(sp.id).some(a => a.session_id === ss.id)).length}명`, confUi.confSessFil === ss.id)).join('')}
    ${noSess ? opt('__none__', `배정 없음 · ${noSess}명`, confUi.confSessFil === '__none__') : ''}
  </select>` : '';
  const roleSel = `<select class="fi" style="width:auto;font-size:11.5px;padding:4px 7px"
      onchange="setConfRoleFil(this.value || '')" title="역할로 거르기">
    ${opt('', `전체 역할 · ${all.length}명`, !confUi.confRoleFil)}
    ${SPEAKER_ROLES.map(r => { const n = all.filter(sp => rolesOfSpeaker(sp.id).includes(r.key)).length;
      return n ? opt(r.key, `${r.label} · ${n}명`, confUi.confRoleFil === r.key) : ''; }).join('')}
  </select>`;
  const chip = (on, onclick, label, tip, tone) => `<button class="pill ${on ? 'p-blue' : tone || 'p-gray'}"
    style="border:0;cursor:pointer;font:inherit;font-size:11px" title="${escapeHtml(tip || '')}" onclick="${onclick}">${label}${on ? ' ✕' : ''}</button>`;
  const vn = (v) => all.filter(sp => (sp.video_publish || 'none') === v).length;
  const settleChips = phase === 'settle' ? (() => {
    const docsN = all.filter(sp => settleMissing(sp).length).length;
    const unpaidN = all.filter(sp => feeOn(sp) && !sp.fee_paid_at).length;
    return chip(confUi.confSettleFil === 'docs', "setConfSettleFil('docs')", `서류 남음 ${docsN}명`, '연사료 서류(신분증·통장·계좌·여권)가 아직 안 온 연사', docsN ? 'p-amber' : 'p-green')
      + chip(confUi.confSettleFil === 'unpaid', "setConfSettleFil('unpaid')", `미지급 ${unpaidN}명`, '연사료를 아직 안 보낸 연사', unpaidN ? 'p-amber' : 'p-green')
      + '<span style="width:1px;height:16px;background:var(--i6);margin:0 2px"></span>'
      + [['yes', '동의'], ['no', '비동의'], ['none', '미확인']].map(([v, l]) =>
        chip(confUi.confVideoFil === v, `setConfVideoFil('${v}')`, `영상 ${l} ${vn(v)}`, '발표 영상 게재 동의 — 연사 드로어 «발표 영상 게재»에서 고른 값',
          v === 'no' && vn(v) ? 'p-red' : 'p-gray')).join('');
  })() : '';
  const filterBar = `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px">
    <div class="seg" style="margin:0">
      <button class="seg-b${phase === 'prep' ? ' on' : ''}" onclick="setConfPhase('prep')" title="행사 전 — 자료 받기·연락">준비</button>
      <button class="seg-b${phase === 'settle' ? ' on' : ''}" onclick="setConfPhase('settle')" title="행사 뒤 — 연사료 서류·지급·영상 게재">정산</button>
    </div>
    ${phase === 'prep' ? `<div class="seg" style="margin:0">
      <button class="seg-b${confUi.confLayout !== 'cards' ? ' on' : ''}" onclick="setConfLayout('table')">표</button>
      <button class="seg-b${confUi.confLayout === 'cards' ? ' on' : ''}" onclick="setConfLayout('cards')" title="사진과 받은 자료를 연사마다 카드로 — 발표 순서대로">카드</button>
    </div>` : ''}
    ${sessSel}${roleSel}
    ${hiddenN ? chip(confUi.confShowHidden, 'toggleConfHidden()', `숨긴 연사 ${hiddenN}명`, '숨긴 연사는 받을 항목에서 빠져요 — 눌러서 보이기/감추기') : ''}
    ${settleChips}
  </div>`;

  /* ── 받을 것 칩 — 전시의 단계 칩과 같은 방식으로 누르면 걸러진다 ── */
  const stats = SP_COLS.map(c => ({ col: c, ...spTally(all, ev.key, c.key) })).filter(x => x.of);
  /* 보낸 것도 세어 둔다 — «가이드라인 몇 명에게 보냈나»가 실제로 묻는 말이다 */
  const sentStats = SP_SENT.map(c => ({ col: c, n: all.filter(sp => sp[c.key]).length, of: all.length }));
  const needChips = `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
    ${stats.map(({ col, n, of }) => {
      const on = confUi.confNeedFil && confUi.confNeedFil.key === col.key;
      const cls = on ? (confUi.confNeedFil.mode === 'done' ? 'p-blue' : 'p-amber')
        : n === of ? 'p-green' : 'p-gray';
      const tip = on ? (confUi.confNeedFil.mode === 'done' ? '받은 사람만 보는 중 — 한 번 더 누르면 안 받은 사람만'
        : '안 받은 사람만 보는 중 — 한 번 더 누르면 전체') : '눌러서 받은 사람만 보기';
      return `<button class="pill ${cls}" title="${escapeHtml(tip)}" style="border:0;cursor:pointer;font:inherit"
        onclick="setConfNeedFil('${escAttr(col.key)}')">${escapeHtml(col.label)} ${
        on ? (confUi.confNeedFil.mode === 'done' ? `${n}명` : `${of - n}명`) : `${n}/${of}`}${
        on ? `<span style="margin-left:3px">${confUi.confNeedFil.mode === 'done' ? '받음' : '안 받음'} ✕</span>` : ''}</button>`;
    }).join('')}
    ${sentStats.filter(x => x.n).map(({ col, n, of }) =>
      `<span class="pill p-blue" style="opacity:.85" title="${escapeHtml(`${col.label}을(를) 보낸 연사`)}">${
        escapeHtml(col.label)} 보냄 ${n}/${of}</span>`).join('')}
  </div>`;

  if(!list.length){
    return summary + searchNote + filterBar + (phase === 'prep' ? needChips : '')
      + `<div style="padding:20px;background:var(--i8);border:1px solid var(--i6);border-radius:10px;
        font-size:12px;color:var(--i5)">${q
          ? `«${escapeHtml(q)}»로 찾은 연사가 없어요. 이름 대신 소속이나 세션명으로도 찾을 수 있어요.`
          : '이 조건에 맞는 연사가 없어요.'}</div>`;
  }

  /* ── 카드 보기 ──
     사진이 왔는지는 체크 표시로는 모른다 — 웹에서 긁은 400px짜리인지, 인쇄할 원본인지는
     봐야 안다. 발표 순서대로 사진과 받은 자료를 한 장씩 놓는다(100.연사관리/연사자료현황.html을
     CRM으로 옮긴 것). 사진은 연사 창에서 올린 것을 쓴다. */
  if(phase === 'prep' && confUi.confLayout === 'cards'){
    /* 한 번만 묻는다 — 실패하면 캐시가 안 차서, 그릴 때마다 다시 부르면 요청이 끝없이 돈다 */
    if(!speakerPhotosLoaded(ev.key) && !confPhotoAsked.has(ev.key)){
      confPhotoAsked.add(ev.key);
      loadSpeakerPhotos(ev.key).then(() => renderConf());
    }
    const firstAt = (sp) => assignmentsFor(sp.id).map(a => {
      const ss = CONF_SESSIONS.find(x => x.id === a.session_id) || {};
      return `${ss.date || '9999'} ${a.start_at || ss.start_at || '99:99'}`;
    }).sort()[0] || '9999 99:99';
    const stOf = (sp) => { const pr = spProgress(sp, ev.key); return !pr.of ? 'na' : pr.n === pr.of ? 'ok' : pr.n ? 'part' : 'todo'; };
    const BADGE = { ok: ['다 받음', 'var(--g)'], part: ['일부', 'var(--am)'], todo: ['미수령', 'var(--re)'], na: ['받을 것 없음', 'var(--i5)'] };
    const cnt = (k) => list.filter(sp => stOf(sp) === k).length;
    const shownCards = list.filter(sp => !confUi.confCardFil || stOf(sp) === confUi.confCardFil).sort((a, b) => firstAt(a).localeCompare(firstAt(b)));
    const scard = (sp) => {
      const p = speakerPhotoOf(ev.key, sp.id);
      const st = stOf(sp), [bl, bc] = BADGE[st];
      const at = firstAt(sp).slice(11);
      const org = [sp.title_en || sp.title_ko, sp.org_en || sp.org_ko].filter(Boolean).join(' · ');
      const items = SP_COLS.filter(c => c.key !== 'profile').map(c => ({ c, x: spCell(sp, ev.key, c.key) })).filter(o => o.x.state !== 'na');
      return `<section onclick="openSpeakerDr('${escAttr(sp.id)}')" style="background:var(--W);border:1px solid var(--i6);
          border-radius:10px;padding:12px;cursor:pointer;display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap">
          ${at && at !== '99:99' ? `<span style="font-size:11px;color:var(--i4)">${escapeHtml(at)}</span>` : ''}
          <b style="font-size:13px">${escapeHtml(sp.name_snapshot || sp.name_en || sp.id)}</b>
          ${sp.name_snapshot && sp.name_en ? `<span style="font-size:11px;color:var(--i4)">${escapeHtml(sp.name_en)}</span>` : ''}
          <span style="margin-left:auto;font-size:10.5px;color:#fff;background:${bc};border-radius:99px;padding:1px 8px">${bl}</span>
        </div>
        ${org ? `<div style="font-size:11px;color:var(--i4);margin-top:-5px">${escapeHtml(org)}</div>` : ''}
        ${p ? `<img src="${photoSrc(p)}" alt="" loading="lazy"
            style="width:100%;height:190px;object-fit:cover;object-position:50% 25%;border-radius:6px;background:var(--i8)">`
          : `<div style="height:190px;display:grid;place-items:center;border:1px dashed var(--i6);border-radius:6px;
            font-size:11px;color:var(--i4);background:var(--i8)">${speakerPhotosLoaded(ev.key) ? '사진 없음' : '불러오는 중'}</div>`}
        <div style="display:flex;gap:4px;flex-wrap:wrap">${items.map(({ c, x }) => `<span title="${escapeHtml(
          x.state === 'done' ? `${c.label} 받음${x.text ? ` (${x.text})` : ''}` : x.state === 'part' ? `${c.label} 일부 (${x.text})` : `${c.label} 아직`)}"
          style="font-size:10.5px;border-radius:4px;padding:0 6px;border:1px solid ${
          x.state === 'done' ? 'var(--g);color:var(--g)' : x.state === 'part' ? 'var(--am);color:var(--am)' : 'var(--i6);color:var(--i5)'}">${
          x.state === 'part' ? '◐ ' : ''}${escapeHtml(c.label)}</span>`).join('')}</div>
      </section>`;
    };
    const cchip = (k, label) => `<button class="pill ${confUi.confCardFil === k ? 'p-blue' : 'p-gray'}" style="border:0;cursor:pointer;font:inherit;font-size:11px"
      onclick="setConfCardFil('${k}')">${label} ${cnt(k)}${confUi.confCardFil === k ? ' ✕' : ''}</button>`;
    return summary + searchNote + filterBar
      + `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
          ${cchip('ok', '다 받음')}${cchip('part', '일부')}${cchip('todo', '미수령')}
          <span style="font-size:10.5px;color:var(--i4)">— 역할이 받는 항목 기준 · 발표 순서대로 · 카드를 누르면 연사 창이 열립니다</span></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(${isMobile() ? '100%' : '260px'},1fr));gap:12px">
          ${shownCards.map(scard).join('')}</div>`;
  }

  /* ── 모바일 ──
     칸을 열로 늘어놓는 표는 좁은 화면에서 성립하지 않는다. 열 열두 개를
     담으려다 글자가 한 자씩 끊기고, 옆으로 밀려 나간 칸은 아예 못 본다.
     그래서 사람마다 카드 하나로 바꾸고, «아직 안 받은 것»만 딱지로 보여준다 —
     받은 것을 다 보여줄 자리는 없고, 실제로 찾는 것은 남은 쪽이다. */
  if(isMobile()){
    const card = (sp) => {
      const pr = spProgress(sp, ev.key);
      const roles = rolesOfSpeaker(sp.id);
      const left = SP_COLS
        .map(c => ({ c, st: spCell(sp, ev.key, c.key) }))
        .filter(x => x.st.state !== 'na' && x.st.state !== 'done');
      const sess = assignmentsFor(sp.id).map(a => {
        const ss = CONF_SESSIONS.find(x => x.id === a.session_id);
        return ss ? (ss.title_ko || ss.title_en || '') : '';
      }).filter(Boolean);
      return `<div onclick="openSpeakerDr('${escAttr(sp.id)}')"
        style="background:var(--W);border:1px solid var(--i6);border-radius:10px;padding:11px 12px;
        margin-bottom:8px;cursor:pointer">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:700">${escapeHtml(sp.name_snapshot || sp.name_en || sp.id)}</span>${spLeftPill(sp)}${spFlagPills(sp)}${isHiddenSp(sp) ? '<span class="pill p-gray" style="font-size:9px" title="받을 항목에서 빠진 연사예요">숨김</span>' : ''}
          ${roles.map(r => `<span class="pill ${(SPEAKER_ROLES.find(x => x.key === r) || {}).cls || 'p-gray'}"
            style="font-size:9px">${escapeHtml(r)}</span>`).join('')}
          ${countryChip(sp)}
          ${sp.lang_pref === 'en' ? '<span class="pill p-gray" style="font-size:9px">EN</span>' : ''}
          ${sp.status && sp.status !== '확정' ? `<span class="pill p-amber" style="font-size:9px">${escapeHtml(sp.status)}</span>` : ''}
        </div>
        ${sp.org_ko || sp.org_en ? `<div style="font-size:11px;color:var(--i4);margin-top:2px">${escapeHtml(
          [sp.org_ko || sp.org_en, sp.title_ko || sp.title_en].filter(Boolean).join(' · '))}</div>` : ''}
        ${sess.length ? `<div style="font-size:11px;color:var(--i3);margin-top:4px;overflow:hidden;
          text-overflow:ellipsis;white-space:nowrap">${escapeHtml(sess[0])}${
          sess.length > 1 ? ` 외 ${sess.length - 1}` : ''}</div>`
          : '<div style="font-size:11px;color:var(--am);margin-top:4px">배정 없음</div>'}
        <div style="display:flex;align-items:center;gap:7px;margin-top:7px">
          <div style="flex:1">${progressBar(pr.pct, pr.pct === 100 ? 'var(--g)' : 'var(--a)')}</div>
          <span style="font-size:10.5px;color:var(--i4);white-space:nowrap">${pr.n}/${pr.of}</span>
        </div>
        ${(() => { const na = nextActionLabel(sp); return `<div style="font-size:11px;margin-top:6px;font-weight:600;color:${
          na.skip ? 'var(--i4)' : na.done ? 'var(--g)' : 'var(--a)'}">${na.skip ? '— ' : na.done ? '✓ ' : '● '}${escapeHtml(na.text)}${
          na.due ? ` <span style="font-weight:400;color:${na.due < td() ? 'var(--re)' : 'var(--i4)'}">~${escapeHtml(na.due)}</span>` : ''}</div>`; })()}
        ${left.length
          ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:7px">
              ${left.map(({ c, st }) => `<span style="font-size:10px;font-weight:600;padding:3px 7px;
                border-radius:5px;white-space:nowrap;background:${st.state === 'part' ? 'var(--ab)' : 'var(--i8)'};
                color:${st.state === 'part' ? 'var(--am)' : 'var(--i5)'}">${
                st.state === 'part' ? '◐ ' : ''}${escapeHtml(c.label)}${st.text ? ` ${escapeHtml(st.text)}` : ''}</span>`).join('')}
            </div>`
          : `<div style="font-size:10.5px;color:var(--g);margin-top:7px">받을 것을 다 받았어요</div>`}
        ${(() => {
          const sent = SP_SENT.filter(c => sp[c.key]);
          return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">
            <button onclick="event.stopPropagation();removeConfSpeaker('${escAttr(sp.id)}')"
              style="border:0;font:inherit;cursor:pointer;font-size:10px;padding:3px 7px;border-radius:5px;
              background:var(--rb);color:var(--re);margin-left:auto">지우기</button>
            <button onclick="event.stopPropagation();setSpeakerHidden('${escAttr(sp.id)}',${!isHiddenSp(sp)})"
              title="${isHiddenSp(sp) ? '다시 목록에 보이고 받을 항목도 셉니다' : '목록에서 접고 받을 항목에서 뺍니다 — 지우지는 않아요'}"
              style="border:0;font:inherit;cursor:pointer;font-size:10px;padding:3px 7px;border-radius:5px;
              background:var(--i8);color:var(--i3)">${isHiddenSp(sp) ? '다시 보이기' : '숨기기'}</button>
            <button onclick="event.stopPropagation();receiveAll('${escAttr(sp.id)}')"
              style="border:0;font:inherit;cursor:pointer;font-size:10px;padding:3px 7px;border-radius:5px;
              background:var(--gb);color:var(--g);font-weight:600">한꺼번에 받음</button>
            ${SP_SENT.map(c => `<button onclick="event.stopPropagation();toggleSpeakerDate('${escAttr(sp.id)}','${c.key}')"
              style="border:0;font:inherit;cursor:pointer;font-size:10px;padding:3px 7px;border-radius:5px;
              background:${sp[c.key] ? 'var(--ad)' : 'var(--i8)'};color:${sp[c.key] ? 'var(--a)' : 'var(--i5)'}">${
              escapeHtml(c.label)}${sp[c.key] ? ` ${escapeHtml(shortCell(sp[c.key]))}` : ''}</button>`).join('')}
          </div>`;
        })()}
        ${sp.fee_amount && paysFee(sp) ? `<div style="font-size:10.5px;margin-top:6px;color:${sp.fee_paid_at ? 'var(--g)' : 'var(--am)'}">
          연사료 ${escapeHtml(Number(String(sp.fee_amount).replace(/[^\d.-]/g, '') || 0).toLocaleString('ko-KR'))}
          · ${sp.fee_paid_at ? '지급' : '미지급'}</div>` : ''}
      </div>`;
    };
    return summary + searchNote + filterBar + (phase === 'prep' ? needChips : '')
      + `<div style="font-size:10px;color:var(--i4);margin-bottom:7px">딱지는 아직 안 받은 것이에요 — 카드를 누르면 그 연사가 열립니다</div>`
      + list.map(card).join('');
  }

  /* 이름·세션 칸 — 준비·정산 표가 같이 쓴다 */
  const nameTd = (sp) => {
    const name = sp.name_snapshot || sp.name_en || sp.id;
    const roles = rolesOfSpeaker(sp.id);
    return `<td><div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
          <span style="font-weight:700;font-size:12px">${escapeHtml(name)}</span>
          ${sp.name_snapshot && sp.name_en
            ? `<span style="font-size:10.5px;color:var(--i4)">${escapeHtml(sp.name_en)}</span>` : ''}${spLeftPill(sp)}${spFlagPills(sp)}${isHiddenSp(sp) ? '<span class="pill p-gray" style="font-size:9px" title="받을 항목에서 빠진 연사예요">숨김</span>' : ''}
          ${roles.map(r => `<span class="pill ${(SPEAKER_ROLES.find(x => x.key === r) || {}).cls || 'p-gray'}"
            style="font-size:9px">${escapeHtml(r)}</span>`).join('')}
          ${countryChip(sp)}
          ${sp.lang_pref === 'en' ? '<span class="pill p-gray" style="font-size:9px" title="영문만 받는 해외 연사예요">EN</span>' : ''}
          ${sp.status && sp.status !== '확정' ? `<span class="pill ${sp.status === '취소' ? 'p-gray' : 'p-amber'}" style="font-size:9px">${escapeHtml(sp.status)}</span>` : ''}
        </div>
        ${sp.org_ko || sp.org_en ? (() => {
          const org = [sp.org_ko || sp.org_en, sp.title_ko || sp.title_en].filter(Boolean).join(' · ');
          return `<div style="font-size:10px;color:var(--i4);max-width:260px;white-space:nowrap;overflow:hidden;
            text-overflow:ellipsis" title="${escapeHtml(org)}">${escapeHtml(org)}</div>`;
        })() : ''}</td>`;
  };
  const sessTd = (sp) => {
    const sess = assignmentsFor(sp.id).map(a => {
      const ss = CONF_SESSIONS.find(x => x.id === a.session_id);
      return ss ? (ss.title_ko || ss.title_en || '') : '';
    }).filter(Boolean);
    return `<td style="max-width:170px">
        ${sess.length ? `<div style="font-size:10.5px;color:var(--i3);white-space:nowrap;overflow:hidden;
            text-overflow:ellipsis" title="${escapeHtml(sess.join(' / '))}">${escapeHtml(sess[0])}${
            sess.length > 1 ? ` 외 ${sess.length - 1}` : ''}</div>`
          : '<span style="font-size:10.5px;color:var(--am)">배정 없음</span>'}</td>`;
  };

  /* ── 정산 표 ──
     연사료·서류·지급·영상 게재만. 줄 연사료가 없는 사람 — 연사료를 받지 않는 역할(VIP·축사)과
     연사료 칸이 비었거나 0인 연사 — 은 챙길 서류·지급이 없으므로 맨 아래 한 줄로 접는다.
     영상 게재 칩으로 거를 때는 접지 않는다(영상 동의는 연사료와 무관하게 받는다). */
  if(phase === 'settle'){
    const noFee = confUi.confVideoFil ? [] : list.filter(sp => !feeOn(sp));
    const shown = list.filter(sp => !noFee.includes(sp));
    const won = (sp) => feeNum(sp).toLocaleString('ko-KR');
    const srow = (sp) => {
      const on = feeOn(sp), miss = settleMissing(sp);
      const dom = isDomesticSpeaker(sp);
      const vp = sp.video_publish;
      return `<tr style="cursor:pointer" onclick="openSpeakerDr('${escAttr(sp.id)}')">
        ${nameTd(sp)}${sessTd(sp)}
        <td style="text-align:right;font-size:11.5px;white-space:nowrap">${on ? won(sp)
          : `<span style="font-size:10.5px;color:var(--i5)">${paysFee(sp) ? '없음' : '해당 없음'}</span>`}</td>
        <td style="font-size:11px;white-space:nowrap">${on ? `<span style="font-size:9.5px;color:var(--i4);margin-right:5px">${dom ? '국내' : '해외'}</span>${
          miss.length ? `<span style="color:var(--am);font-weight:600">${escapeHtml(miss.join('·'))} 아직</span>`
            : '<span style="color:var(--g);font-weight:600">✓ 다 받음</span>'}` : ''}</td>
        <td style="font-size:11px;white-space:nowrap">${on ? (sp.fee_paid_at
          ? `<span style="color:var(--g)">✓ ${escapeHtml(shortCell(sp.fee_paid_at))}</span>`
          : '<span style="color:var(--am)">미지급</span>') : ''}</td>
        <td style="font-size:11px;white-space:nowrap">${vp === 'yes' ? '<span style="color:var(--g);font-weight:600">동의</span>'
          : vp === 'no' ? '<span style="color:var(--re);font-weight:600">비동의</span>'
          : '<span style="color:var(--i5)">미확인</span>'}${sp.video_publish_at
          ? ` <span style="font-size:9.5px;color:var(--i4)">${escapeHtml(shortCell(sp.video_publish_at))}</span>` : ''}</td>
      </tr>`;
    };
    return summary + searchNote + filterBar
      + `<div class="tw"><table><thead><tr>
          <th style="min-width:160px">연사</th>
          <th style="min-width:120px">세션</th>
          <th style="text-align:right;min-width:80px">연사료</th>
          <th style="min-width:150px" title="국내: 신분증·통장사본·계좌번호 / 해외: 계좌·여권">서류</th>
          <th style="min-width:70px">지급</th>
          <th style="min-width:80px" title="행사 뒤 홈페이지·교육 자료 게재 동의">영상 게재</th>
        </tr></thead><tbody>${shown.map(srow).join('')}
        ${noFee.length ? `<tr onclick="toggleConfNoFee()" style="cursor:pointer;background:var(--i8)">
          <td colspan="6" style="font-size:11px;color:var(--i4)">${confUi.confShowNoFee ? '▾' : '▸'} 연사료 없음 ${noFee.length}명 (VIP 등 포함) — ${
            escapeHtml(noFee.map(sp => sp.name_snapshot || sp.name_en || '').join(', '))}</td></tr>
          ${confUi.confShowNoFee ? noFee.map(srow).join('') : ''}` : ''}
        </tbody></table></div>
        <div style="font-size:10px;color:var(--i4);margin-top:7px;line-height:1.6">
          줄을 누르면 연사 창이 열립니다 — 서류·지급일은 «계좌·여권»·«제공사항» 탭, 영상 게재는 «기본» 탭에서 고칩니다
        </div>`;
  }

  /* 지금 보이는 연사 중 아무도 받지 않는 항목은 열째로 뺀다 — 숙박·항공을 아무에게도
     제공하지 않는 행사에서 빈 열을 훑으며 체크할 이유가 없다 */
  const cols = SP_COLS.filter(c => list.some(sp => spCell(sp, ev.key, c.key).state !== 'na'));

  const row = (sp) => {
    const name = sp.name_snapshot || sp.name_en || sp.id;
    const pr = spProgress(sp, ev.key);
    const to = contactsOfSpeaker(sp.id).filter(x => x.send === 'to' && x.email);

    return `<tr style="cursor:pointer" onclick="openSpeakerDr('${escAttr(sp.id)}')">
      ${nameTd(sp)}${sessTd(sp)}
      <td style="min-width:70px">
        ${progressBar(pr.pct, pr.pct === 100 ? 'var(--g)' : 'var(--a)')}
        <div style="font-size:9.5px;color:var(--i4);margin-top:2px">${pr.n}/${pr.of}</div></td>
      ${nextActionTd(sp)}
      ${cols.map(c => spCellHtml(spCell(sp, ev.key, c.key), c.label, name, c)).join('')}
      ${SP_SENT.map(c => spSentHtml(sp, c)).join('')}
      <td style="text-align:center;padding:5px 3px">
        <button class="btn" style="font-size:10px;padding:2px 7px"
          onclick="event.stopPropagation();receiveAll('${escAttr(sp.id)}')"
          title="이 연사에게서 아직 안 받은 것을 모두 오늘 받은 것으로 표시합니다">받음</button></td>
      <td style="text-align:center;font-size:10.5px;color:${to.length ? 'var(--i4)' : 'var(--am)'}"
        title="${escapeHtml(to.length ? to.map(x => x.email).join(', ') : '메일 수신자가 정해지지 않았어요')}">
        ${to.length ? '✓' : '—'}</td>
      <td style="text-align:right;font-size:11px;white-space:nowrap">
        ${!paysFee(sp) && assignmentsFor(sp.id).length
          ? '<span style="color:var(--i5);font-size:10px" title="맡은 역할이 연사료를 받지 않아요">해당 없음</span>'
          : sp.fee_amount
          ? `<span style="color:${sp.fee_paid_at ? 'var(--g)' : 'var(--i2)'}">${
              escapeHtml(Number(String(sp.fee_amount).replace(/[^\d.-]/g, '') || 0).toLocaleString('ko-KR'))}</span>
             <div style="font-size:9.5px;color:${sp.fee_paid_at ? 'var(--g)' : 'var(--am)'}">${
              sp.fee_paid_at ? '지급' : '미지급'}</div>`
          : '<span style="color:var(--i6)">—</span>'}</td>
    </tr>`;
  };

  return summary + searchNote + filterBar + (phase === 'prep' ? needChips : '')
    + `<div class="tw"><table><thead><tr>
        <th style="min-width:140px">연사</th>
        <th style="min-width:120px">세션</th>
        <th style="min-width:70px">진행률</th>
        <th style="min-width:110px" title="연락 단계에서 다음에 할 일 — 누르면 그 메일 초안이 열립니다">지금 할 일</th>
        ${cols.map(c => `<th style="text-align:${c.show === 'text' ? 'left' : 'center'};font-size:10px;line-height:1.2${
          c.wide ? ';min-width:120px' : ''}">${escapeHtml(c.label)}</th>`).join('')}
        ${SP_SENT.map(c => `<th style="text-align:center;font-size:10px;line-height:1.2;color:var(--a)"
          title="${escapeHtml(c.tip || '')}">${escapeHtml(c.label)}</th>`).join('')}
        <th style="text-align:center;font-size:10px;line-height:1.2" title="한 메일에 같이 온 것을 한 번에 표시합니다">한꺼번에</th>
        <th style="text-align:center;min-width:44px;font-size:10px">수신</th>
        <th style="text-align:right;min-width:70px;font-size:10px">연사료</th>
      </tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>
      <div style="font-size:10px;color:var(--i4);margin-top:7px;line-height:1.6">
        ✓ 받음 · ◐ 일부 · — 아직 · 빈칸은 그 역할이 받지 않는 것(진행률에서 뺌) · 아무도 받지 않는 항목은 열째로 숨겨요
      </div>`;
}


/* 화면의 onclick이 부르는 것 */
window.setConfNeedFil    = setConfNeedFil;
window.openConfNeedTodo  = openConfNeedTodo;
window.openConfRole      = openConfRole;
window.openConfSess      = openConfSess;
window.setConfRoleFil    = setConfRoleFil;
window.setConfVideoFil   = setConfVideoFil;
window.setConfPhase      = setConfPhase;
window.setConfLayout     = setConfLayout;
window.setConfCardFil    = setConfCardFil;
window.setConfSettleFil  = setConfSettleFil;
window.toggleConfNoFee   = toggleConfNoFee;
window.searchConfM       = searchConfM;
window.clearConfSearch   = clearConfSearch;
window.setConfSessFil    = setConfSessFil;
window.toggleSpeakerDate = toggleSpeakerDate;
window.receiveAll        = receiveAll;
window.clearConfQuery = clearConfQuery;   // 탭(conf-tab.js)이 window로 부른다
window.confQuery = confQuery;   // 탭(conf-tab.js)이 window로 부른다
window.peopleHtml = peopleHtml;   // 탭(conf-tab.js)이 window로 부른다
