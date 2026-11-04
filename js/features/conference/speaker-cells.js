/* ══════════════════════════════════════════════════════════════
   features/conference/speaker-cells.js — 연사 표의 칸 — 받을 것마다 받았나·안 왔나·묻지 않음
   (modules/conf-tab.js에서 옮겼다 — 탭 화면 파일에 기대지 않게)
═══════════════════════════════════════════════════════════════ */

import { EVENT_LIST, assignmentsFor, bankDocs, isDomesticSpeaker, rolesOfSpeaker, speakerNeed } from '../../state.js';
import { escapeHtml, escAttr, td } from '../../utils.js';
import { consentRefused, isHiddenSp, reuseState } from './conf-common.js';
/* 연락 칸은 연락 단계(speaker-flow)를 보여 주고, 연락 단계는 이 칸들로 남은 자료를 센다 —
   둘은 서로를 부르지만 함수가 불릴 때만이라 읽는 순서는 상관없다 */
import { nextActionLabel } from '../../modules/speaker-flow.js';

/* 표에 세울 항목 — 받을 것 중에서 «칸으로 볼 수 있는 것»만 고른다.
   순서는 실제로 받는 순서를 따랐다(사람 정보 → 발제 → 서류). */
/* show:'text' — ✓ 대신 받은 값을 그대로 보여준다.
   «소속·직함을 받았는가»는 ✓로 답할 질문이 아니다. 프로그램북에 그 글자가
   그대로 나가므로, 여기서 보고 싶은 건 «받았다»가 아니라 «무엇을 받았나»다.
   ✓만 보면 결국 한 사람씩 열어 확인하게 된다. */
/* 설정 › 컨퍼런스의 약력 갈래 — 이력 칸 하나로 모아 센다 */
const BIO_PARTS = [
  ['bio_profile', '소개'], ['bio_pro', '경력'], ['bio_work', '근무'], ['bio_edu', '학력'],
  ['bio_awards', '수상'], ['bio_credentials', '자격'], ['bio_teaching', '강의'],
  ['bio_affil', '학회'], ['bio_pubs', '출판'],
].map(([key, label]) => ({ key, label, fields: [`${key}_ko`, `${key}_en`] }))
  .concat([{ key: 'languages', label: '구사 언어', fields: ['languages'] }]);

export const SP_COLS = [
  { key: 'profile',  label: '소속·직함', show: 'text', wide: true },
  { key: 'bio_pro',  label: '이력' },
  { key: 'cv',       label: 'CV' },
  { key: 'photo',    label: '사진' },
  { key: 'title',    label: '발제명' },
  { key: 'abstract', label: '초록' },
  { key: 'consent',  label: '동의서' },
  { key: 'bank',     label: '계좌' },
  { key: 'passport', label: '여권' },
  { key: 'travel',   label: '숙박·항공' },
  /* 발표자료는 늘 가장 늦게 온다 — 현장에서 USB로 받는 일도 있다. 맨 뒤에 둔다 */
  { key: 'slides',   label: '발표자료' },
];

/* 우리가 보낸 것 — 받을 것과 성격이 다르다. 받을 것은 상대가 주는 것이고
   이쪽은 우리가 한 일이다. 보낸 날을 모르면 안 보내고 기다리거나 또 보낸다.
   역할과 무관하게 모두에게 해당하므로 «묻지 않음»이 없다. */
export const SP_SENT = [
  /* 보낼 때는 한 번이다. 초청은 사전에 이미 컨택이 끝난 상태로 오고,
     가이드라인과 프로필 양식은 그 메일에 같이 실린다 — 실제로 한 번에
     일어나는 일을 세 칸으로 나누면 세 번 찍거나 한 번도 안 찍게 된다.
     예전 invite_sent_at·form_sent_at은 DB에 남겨 두고 화면에서만 뺐다.

     받는 쪽은 합치지 않는다. 이력만 먼저 오고 사진이 며칠 뒤에 오는 일이
     흔하고, 그때 «무엇이 아직 안 왔나»가 이 화면이 답해야 하는 질문이다. */
  { key: 'guide_sent_at',  label: '보냄', tip: '초청 · 가이드라인 · 프로필 양식' },
  { key: 'reminded_at',    label: '독촉', tip: '마지막으로 독촉한 날' },
];

/* 이 사람의 이 항목이 어떤 상태인가.
   'na'  — 역할이 묻지 않는다(분모에서 뺀다)
   'done'— 받았다      'part' — 일부만    'todo' — 아직
   text는 칸 아래 작게 붙는 값(받은 날짜 등) */
/* 지금 할 일 칸 — 누르면 그 연사의 메일 탭에 그 단계 초안이 열린다 */
export function nextActionTd(sp){
  const na = nextActionLabel(sp);
  if(na.skip) return `<td style="font-size:var(--fs-10_5);color:var(--i4);white-space:nowrap" title="${na.text === '취소'
    ? '취소한 연사라 더 연락하지 않아요' : '주최사가 정보를 넘겨주는 역할이라 메일로 연락하지 않아요'}">— ${escapeHtml(na.text)}</td>`;
  if(na.done) return `<td style="font-size:var(--fs-10_5);color:var(--g);white-space:nowrap">✓ 연락 완료</td>`;
  /* 요청하고 기다리는 중 — 공은 연사에게 있다. 날이 차면 «리마인더»로 돌아온다(follow-up.js) */
  if(na.wait) return `<td style="white-space:nowrap" onclick="event.stopPropagation();openSpeakerDr('${escAttr(sp.id)}')"
    title="${escapeHtml(`${na.text} — ${na.follow.text}`)}">
    <span style="font-size:var(--fs-10_5);color:var(--i4);cursor:pointer">⏳ ${escapeHtml(na.text)}</span>
    <div style="font-size:var(--fs-9_5);color:var(--i5)">${escapeHtml(na.follow.text)}</div></td>`;
  return `<td style="white-space:nowrap" onclick="event.stopPropagation();openSpeakerDr('${escAttr(sp.id)}');openFlowDraft('${escAttr(na.step)}')"
    title="이 단계의 메일 초안 열기">
    <span style="font-size:var(--fs-10_5);font-weight:600;color:${na.follow ? 'var(--am)' : 'var(--a)'};cursor:pointer">${na.follow ? '🔔' : '●'} ${escapeHtml(na.text)}</span>${
      na.follow ? `<div style="font-size:var(--fs-9_5);color:var(--am)">${escapeHtml(na.follow.text.replace(/^리마인더 보낼 때 · /, ''))}</div>`
      : na.due ? `<div style="font-size:var(--fs-9_5);color:${na.due < td() ? 'var(--re)' : 'var(--i4)'}">마감 ${escapeHtml(na.due)}</div>` : ''}</td>`;
}

/* 행사가 끝나면 행사 전에 쓰려고 받던 자료는 더 받지 않는다 — 끝난 뒤에도 초록·사진이
   «아직»으로 남아 독촉 대상·남은 일·진행률에 계속 잡혔다. 못 받은 채 끝난 칸은 «지남»으로
   두고 분모에서 뺀다(받은 칸은 그대로 «받음»). 동의서(영상 게재)·계좌·여권은 정산에 쓰니 그대로 센다 */
const BEFORE_EVENT = new Set(['bio_pro', 'cv', 'photo', 'title', 'abstract', 'slides', 'travel']);
const evEnded = (evKey) => {
  const ev = EVENT_LIST.find(e => e.key === evKey);
  return !!ev && String(ev.date_end || ev.date_start || ev.date || '9999') < td();
};
export function spCell(sp, evKey, key){
  const c = spCellBase(sp, evKey, key);
  if((c.state === 'todo' || c.state === 'part') && BEFORE_EVENT.has(key) && evEnded(evKey))
    return { state: 'na', lapsed: true, text: c.text || '', need: c.need };
  return c;
}
function spCellBase(sp, evKey, key){
  /* 숨긴 연사는 받을 것이 없다 — 진행률·대시보드·남은 일·외부 공유가 모두 여기서 센다 */
  if(isHiddenSp(sp)) return { state: 'na' };
  const roles = rolesOfSpeaker(sp.id);
  const asg = assignmentsFor(sp.id);
  /* 역할이 여럿이면 센 쪽을 따른다 — 좌장이자 발표자면 발제도 받아야 한다 */
  const needOf = (k) => {
    let n = '';
    roles.forEach(r => {
      const v = speakerNeed(evKey, r, k);
      if(v === 'req') n = 'req';
      else if(v === 'opt' && n !== 'req') n = 'opt';
    });
    return n;
  };
  /* 이력 칸은 설정의 약력 갈래 아홉과 구사 언어를 한데 센다 — 하나라도 묻으면 칸이 선다 */
  const need = key === 'bio_pro'
    ? BIO_PARTS.map(p => needOf(p.key)).reduce((a, v) => v === 'req' || a === 'req' ? 'req' : v || a, '')
    : needOf(key);
  if(!need) return { state: 'na' };

  const done = (v, text) => ({ state: v ? 'done' : 'todo', text: v ? (text || v) : '', need });

  switch(key){
    case 'profile': {
      const org = sp.org_ko || sp.org_en;
      const title = sp.title_ko || sp.title_en;
      return { state: org ? 'done' : 'todo',
        text: [org, title].filter(Boolean).join(' · '), need };
    }
    /* 지난 행사에서 가져온 자료는 연사가 맞다고 할 때까지 «일부»로 센다 —
       받은 날이 찍혀야 끝난다(contact-speaker.js reusePending) */
    case 'bio_pro': {
      const r = reuseState(sp, 'bio', need);
      if(r) return r;
      /* 받은 날만 보면 «학력 필수»로 정해도 학력이 빈 채 끝난 것으로 셌다.
         필수로 정한 갈래가 다 채워져야 끝이다 */
      const lack = BIO_PARTS.filter(p => needOf(p.key) === 'req' && !p.fields.some(f => String(sp[f] ?? '').trim()));
      if(!sp.profile_received_at){
        const any = BIO_PARTS.some(p => p.fields.some(f => String(sp[f] ?? '').trim()));
        return { state: any ? 'part' : 'todo', text: any && lack.length ? `${lack.map(p => p.label).join('·')} 없음` : '', need };
      }
      return lack.length ? { state: 'part', text: `${lack.map(p => p.label).join('·')} 없음`, need }
        : { state: 'done', text: sp.profile_received_at, need };
    }
    /* CV는 기본이 «선택»이다 — 선택까지 세면 모든 연사의 자료 받기가 CV 하나로 안 끝난다.
       설정에서 «필수»로 바꾼 행사에서만 칸이 선다 */
    case 'cv':       return need === 'req' ? done(sp.cv_received_at) : { state: 'na' };
    case 'photo':    return reuseState(sp, 'photo', need) || done(sp.photo_received_at);
    case 'consent': {
      const no = consentRefused(sp);
      return done(sp.consent_at, no.length ? `${no.join('·')} ✕` : '');
    }
    case 'bank':
      /* 줄 돈이 없으면 계좌를 묻지 않는다 — 무보수 연사에게 계좌를 요구할
         이유가 없고, 요구한 적 없는 걸 «안 받았다»고 세면 안 된다. */
      if(!sp.fee_amount) return { state: 'na' };
      {
        /* 국내는 신분증·통장사본·계좌번호, 해외는 계좌 — state.js bankDocs 한 곳에서 정한다 */
        const docs = bankDocs(sp), got = docs.filter(d => d.got).length;
        const miss = docs.filter(d => !d.got).map(d => d.label).join('·');
        return { state: got === docs.length ? 'done' : got ? 'part' : 'todo',
          text: got === docs.length ? '받음' : got ? `${miss} 아직` : '', need };
      }
    case 'passport':
      /* 국내 연사는 신분증으로 대신한다 */
      if(isDomesticSpeaker(sp)) return { state: 'na' };
      return done(sp.passport_received_at);
    case 'travel': {
      /* 챙기기로 한 것만 센다. 숙박·항공 중 적어 둔 게 없으면 아직 정해지지
         않은 것이라 «안 한 일»로 몰지 않는다. */
      const items = [];
      if(sp.stay_hotel) items.push(sp.stay_booked === 'yes');
      if(sp.air_route) items.push(!!sp.air_ticketed_at);
      if(!items.length) return { state: 'todo', text: '', need };
      const n = items.filter(Boolean).length;
      return { state: n === items.length ? 'done' : n ? 'part' : 'todo',
        text: `${n}/${items.length}`, need };
    }
    /* 발제 셋은 배정 줄마다 따로 있다 — 두 세션에서 발표하면 초록도 둘이다.
       그 역할이 묻는 배정만 센다(좌장 배정은 빼고 연사 배정만). */
    case 'title': case 'abstract': case 'slides': {
      const live = asg.filter(a => speakerNeed(evKey, a.role, key));
      if(!live.length) return { state: 'na' };
      const got = live.filter(a =>
        key === 'title' ? (a.title_ko || a.title_en)
        : key === 'abstract' ? a.abstract_received_at
        : a.slides_received_at);
      return { state: got.length === live.length ? 'done' : got.length ? 'part' : 'todo',
        text: live.length > 1 ? `${got.length}/${live.length}` : '', need };
    }
  }
  return { state: 'na' };
}
