/* ══════════════════════════════════════════════════════════════
   speaker-flow.js — 행사별 연사 연락 순서와 «지금 할 일»

   연사 한 명에게 무엇을 언제 보내야 하는지가 사람 머릿속에만 있었다.
   보낸 날짜·받은 자료는 화면에 있는데, 그걸 보고 «그래서 다음엔 뭘 하지»를
   매번 사람이 계산했다. 그래서 순서를 행사 설정에 적어 두고, 연사마다 지금
   어느 단계인지와 그 단계의 메일 초안을 여기서 만든다.

   단계 목록(key·끝난 기준)은 코드가 정한다 — 끝났는지를 판단하는 규칙까지
   설정에서 고치게 하면 아무도 왜 그 단계에 머무는지 설명할 수 없게 된다.
   행사마다 고치는 것은 이름·설명·마감일·메일 양식·끄기다(conf.flow).

   끝난 기준
     field:<칸>  연사 칸에 날짜가 있으면 끝 (보냄·초청 회신·참가 확정)
     needs       역할이 요구하는 자료를 다 받았으면 끝 (숙박·항공은 따로 본다)
     log         그 단계 메일을 보낸 기록(speaker_logs.kind = 단계 key)이 있으면 끝
══════════════════════════════════════════════════════════════ */
import { EVENT_LIST, CONF_SESSIONS, confCfg, assignmentsFor, rolesOfSpeaker,
  logsOfSpeaker, speakerNeed, currentUser } from '../state.js';
import { SP_COLS, spCell } from './conf-tab.js';

export const FLOW_STEPS = [
  {
    key: 'invite', label: '초청·가이드 발송', done: 'field:guide_sent_at',
    desc: '초청 메일에 가이드라인과 제출 양식을 함께 보냅니다. 보내면 «보냄» 날짜가 찍힙니다.',
    subject_ko: '[{행사}] 연사 초청', subject_en: '[{행사}] Invitation to speak',
    body_ko: '{이름} 님, 안녕하세요.\n\n{행사}에 연사로 모시고자 연락드립니다.\n\n{세션}\n\n가이드라인: {가이드}\n제출 양식: {양식}\n\n참석 가능 여부를 {마감일}까지 회신해 주시면 감사하겠습니다.\n\n감사합니다.\n{담당자} 드림',
    body_en: 'Dear {이름},\n\nWe are pleased to invite you to speak at {행사}.\n\n{세션}\n\nGuidelines: {가이드}\nSubmission form: {양식}\n\nWe would be grateful if you could confirm your participation by {마감일}.\n\nBest regards,\n{담당자}',
  },
  {
    key: 'reply', label: '참석 회신 받기', done: 'field:invite_replied_at',
    desc: '참석 여부 회신을 받으면 «초청 회신» 날짜를 적습니다. 답이 없으면 회신 요청 메일을 보냅니다.',
    subject_ko: '[{행사}] 참석 여부 회신 부탁드립니다', subject_en: '[{행사}] Kindly confirm your participation',
    body_ko: '{이름} 님, 안녕하세요.\n\n지난번 보내드린 {행사} 연사 초청 건으로 다시 연락드립니다.\n참석 가능 여부를 {마감일}까지 알려주시면 일정을 확정하겠습니다.\n\n감사합니다.\n{담당자} 드림',
    body_en: 'Dear {이름},\n\nI am following up on our invitation to speak at {행사}.\nCould you kindly let us know by {마감일} whether you are able to join us?\n\nBest regards,\n{담당자}',
  },
  {
    key: 'collect', label: '자료 받기', done: 'needs',
    desc: '역할이 요구하는 자료를 모두 받습니다. 요청 메일을 이미 보냈으면 «독촉»으로 바뀝니다.',
    subject_ko: '[{행사}] 연사 자료 요청', subject_en: '[{행사}] Speaker materials request',
    body_ko: '{이름} 님, 안녕하세요.\n\n{행사} 준비를 위해 아래 자료를 {마감일}까지 부탁드립니다.\n\n{남은자료}\n\n제출 양식: {양식}\n\n감사합니다.\n{담당자} 드림',
    body_en: 'Dear {이름},\n\nTo prepare for {행사}, could you please send us the following by {마감일}?\n\n{남은자료}\n\nSubmission form: {양식}\n\nBest regards,\n{담당자}',
    remind_subject_ko: '[{행사}] 연사 자료 제출 요청 (재안내)', remind_subject_en: '[{행사}] Reminder: speaker materials',
    remind_body_ko: '{이름} 님, 안녕하세요.\n\n{행사} 연사 자료 중 아직 받지 못한 것이 있어 다시 연락드립니다.\n\n{남은자료}\n\n{마감일}까지 보내주시면 프로그램북 제작에 차질이 없도록 하겠습니다.\n\n감사합니다.\n{담당자} 드림',
    remind_body_en: 'Dear {이름},\n\nThis is a gentle reminder that we have not yet received the following for {행사}:\n\n{남은자료}\n\nWe would appreciate it if you could send them by {마감일}.\n\nBest regards,\n{담당자}',
  },
  {
    key: 'confirm', label: '참가 확정', done: 'field:confirmed_at',
    desc: '자료를 다 받고 일정이 정해지면 «참가 확정» 날짜를 적고 확정 안내를 보냅니다.',
    subject_ko: '[{행사}] 연사 참가 확정 안내', subject_en: '[{행사}] Your participation is confirmed',
    body_ko: '{이름} 님, 안녕하세요.\n\n{행사} 연사 참가가 확정되었습니다. 보내주신 자료 감사합니다.\n\n{세션}\n\n현장 안내는 행사 전에 다시 드리겠습니다.\n\n감사합니다.\n{담당자} 드림',
    body_en: 'Dear {이름},\n\nWe are delighted to confirm your participation in {행사}. Thank you for the materials.\n\n{세션}\n\nWe will send on-site information closer to the event.\n\nBest regards,\n{담당자}',
  },
  {
    key: 'travel', label: '숙박·항공 안내', done: 'log', need: 'travel',
    desc: '숙박·항공을 제공하는 연사에게 예약 안내를 보냅니다. 보내면 이 단계가 끝납니다.',
    subject_ko: '[{행사}] 숙박·항공 안내', subject_en: '[{행사}] Accommodation & flights',
    body_ko: '{이름} 님, 안녕하세요.\n\n{행사} 숙박과 항공을 준비하겠습니다.\n희망 일정과 여권 사본을 {마감일}까지 보내주시면 예약 후 안내드리겠습니다.\n\n감사합니다.\n{담당자} 드림',
    body_en: 'Dear {이름},\n\nWe will arrange your accommodation and flights for {행사}.\nCould you please send us your preferred dates and a copy of your passport by {마감일}?\n\nBest regards,\n{담당자}',
  },
  {
    key: 'thanks', label: '감사 메일', done: 'log',
    desc: '행사가 끝나면 감사 인사를 보냅니다.',
    subject_ko: '[{행사}] 참여해 주셔서 감사합니다', subject_en: '[{행사}] Thank you',
    body_ko: '{이름} 님, 안녕하세요.\n\n{행사}에 연사로 함께해 주셔서 진심으로 감사드립니다.\n덕분에 뜻깊은 자리가 되었습니다.\n\n감사합니다.\n{담당자} 드림',
    body_en: 'Dear {이름},\n\nThank you very much for speaking at {행사}.\nYour contribution made the event truly meaningful.\n\nBest regards,\n{담당자}',
  },
];

/* 이 행사의 단계 — 코드 기본값 위에 행사 설정(conf.flow[key])을 얹는다 */
export function flowSteps(evKey, { withOff = false } = {}){
  const over = confCfg(evKey).flow || {};
  return FLOW_STEPS.map(s => ({ ...s, ...(over[s.key] || {}), key: s.key, done: s.done, need: s.need }))
    .filter(s => withOff || !s.off);
}

const needOf = (sp, key) => {
  let best = '';
  rolesOfSpeaker(sp.id).forEach(r => {
    const v = speakerNeed(sp.event_id, r, key);
    if(v === 'req' || (v === 'opt' && best !== 'req')) best = v;
  });
  return best;
};

/* 아직 못 받은 자료 — 숙박·항공은 자기 단계가 따로 있어 뺀다 */
export function missingItems(sp){
  return SP_COLS.filter(c => c.key !== 'travel')
    .map(c => ({ c, st: spCell(sp, sp.event_id, c.key) }))
    .filter(x => x.st.state === 'todo' || x.st.state === 'part');
}

const sentLog = (sp, key) => logsOfSpeaker(sp.id).some(l => l.kind === key);

function isDone(sp, step){
  if(step.done.startsWith('field:')) return !!sp[step.done.slice(6)];
  if(step.done === 'needs') return !missingItems(sp).length;
  if(step.done === 'log') return sentLog(sp, step.key);
  return false;
}

/* 연사 한 명의 단계 상태 — current는 해당되면서 아직 안 끝난 첫 단계 */
export function flowStatus(sp){
  const steps = flowSteps(sp.event_id).map(s => {
    const applies = !s.need || !!needOf(sp, s.need);
    return { ...s, applies, isDone: applies && isDone(sp, s) };
  });
  const current = steps.find(s => s.applies && !s.isDone) || null;
  /* 자료 요청을 이미 보냈는데 아직 덜 받았으면 다음 메일은 독촉이다 */
  const remind = !!current && current.key === 'collect' && sentLog(sp, 'collect');
  const live = steps.filter(s => s.applies);
  return { steps, current, remind, nDone: live.filter(s => s.isDone).length, nAll: live.length };
}

/* 표·CRM에 쓸 한 줄 */
export function nextActionLabel(sp){
  const f = flowStatus(sp);
  if(!f.current) return { text: '연락 완료', done: true };
  const label = f.remind ? '자료 독촉' : f.current.label;
  const left = f.current.key === 'collect' ? missingItems(sp).length : 0;
  return { text: `${label}${left ? ` (${left})` : ''}`, step: f.current.key, due: f.current.due || '', done: false };
}

/* ── 양식 채우기 ── */
export function fillTemplate(text, sp, step){
  const en = sp.lang_pref === 'en';
  const ev = EVENT_LIST.find(e => e.key === sp.event_id);
  const evName = ev ? (ev.name || ev.short || ev.key) : sp.event_id;
  const cfg = confCfg(sp.event_id);
  const docs = cfg.docs || {};
  const sessions = assignmentsFor(sp.id).map(a => {
    const s = CONF_SESSIONS.find(x => x.id === a.session_id);
    if(!s || s.kind) return '';
    /* 연사에게는 세션 시간이 아니라 «본인 발표 시각»을 알린다 */
    const when = a.start_at ? `${a.start_at}${a.end_at ? '–' + a.end_at : ''}` : (s.start_at || '');
    return `  · ${en ? (s.title_en || s.title_ko) : (s.title_ko || s.title_en)}${s.date ? ` (${s.date}${when ? ' ' + when : ''})` : ''} — ${a.role}`;
  }).filter(Boolean);
  const items = missingItems(sp).map(({ c, st }) =>
    `- ${c.label}${st.state === 'part' && st.text ? ` (${en ? 'partly received' : '일부만 받음'})` : ''}`);
  const vars = {
    이름: sp[en ? 'name_en' : 'name_snapshot'] || sp.name_snapshot || sp.name_en || '',
    행사: evName,
    세션: sessions.length ? `${en ? 'Your session(s)' : '배정 세션'}\n${sessions.join('\n')}` : '',
    남은자료: items.length ? items.join('\n') : (en ? '(nothing outstanding)' : '(남은 자료 없음)'),
    마감일: step?.due || (en ? 'the date we agreed' : '가능한 빠른 날'),
    가이드: docs[en ? 'guide_en' : 'guide_ko'] || docs.guide_ko || docs.guide_en || '',
    양식: docs[en ? 'form_en' : 'form_ko'] || docs.form_ko || docs.form_en || '',
    담당자: currentUser?.name || '',
  };
  return String(text || '')
    .replace(/\{(이름|행사|세션|남은자료|마감일|가이드|양식|담당자)\}/g, (_, k) => vars[k] ?? '')
    // 비어서 남은 «가이드라인: » 같은 줄과 겹친 빈 줄을 걷어낸다
    .replace(/^[^\n:：]{1,20}[:：]\s*$/gm, '')
    .replace(/^\s*드림\s*$/gm, '')          // 담당자 이름이 없으면 «드림»만 남는다
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* 단계의 메일 초안 */
export function draftFor(sp, stepKey){
  const f = flowStatus(sp);
  const step = f.steps.find(s => s.key === stepKey);
  if(!step) return null;
  const en = sp.lang_pref === 'en';
  const remind = stepKey === 'collect' && f.remind;
  const pick = (k) => step[`${remind ? 'remind_' : ''}${k}_${en ? 'en' : 'ko'}`] || step[`${k}_${en ? 'en' : 'ko'}`] || '';
  return {
    subject: fillTemplate(pick('subject'), sp, step),
    body: fillTemplate(pick('body'), sp, step),
    kind: stepKey, category: remind ? '자료 독촉' : step.label,
  };
}

export const FLOW_VARS = ['{이름}', '{행사}', '{세션}', '{남은자료}', '{마감일}', '{가이드}', '{양식}', '{담당자}'];
