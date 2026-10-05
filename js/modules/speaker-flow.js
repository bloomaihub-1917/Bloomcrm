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

/* 문투 — 비즈니스 메일 기준(global-email-expert 스킬)을 따른다.
   ① 첫 세 문장 안에 목적을 밝힌다  ② 세부사항은 항목(■ / -)으로 나눈다
   ③ 마감일을 박은 회신 요청으로 맺는다  ④ 서명에 이름과 소속(사무국)을 넣는다.
   한국어는 «○○○ 교수님께 / 안녕하십니까, ○○ 사무국 ○○○입니다»로 연다. */
export const FLOW_STEPS = [
  {
    key: 'invite', label: '초청·가이드 발송', done: 'field:guide_sent_at',
    desc: '초청 메일에 가이드라인과 제출 양식을 함께 보냅니다. 보내면 «보냄» 날짜가 찍힙니다.',
    subject_ko: '[{행사}] 연사 초청의 건 — {호칭}', subject_en: '[{행사}] Invitation to Speak',
    body_ko: '{호칭}께\n\n안녕하십니까. {행사} 사무국 {담당자}입니다.\n{행사}에 {호칭}을 연사로 모시고자 정중히 초청의 말씀을 드립니다.\n\n■ 배정 세션\n{세션}\n\n■ 안내 자료\n- 가이드라인: {가이드}\n- 제출 양식: {양식}\n\n참석 가능 여부를 {마감일}까지 회신해 주시면, 이후 일정과 준비 사항을 상세히 안내드리겠습니다.\n바쁘신 가운데 검토해 주셔서 감사합니다.\n\n{담당자} 드림\n{행사} 사무국',
    body_en: 'Dear {호칭},\n\nOn behalf of the {행사} Secretariat, it is my pleasure to invite you to speak at {행사}.\n\nYour session:\n{세션}\n\nFor your reference:\n- Speaker guidelines: {가이드}\n- Submission form: {양식}\n\nWe would be grateful if you could confirm your availability by {마감일}. Upon your confirmation, we will share the detailed schedule and next steps.\n\nThank you for your kind consideration.\n\nSincerely,\n{담당자}\n{행사} Secretariat',
  },
  {
    key: 'reply', label: '참석 회신 받기', done: 'field:invite_replied_at',
    desc: '참석 여부 회신을 받으면 «초청 회신» 날짜를 적습니다. 답이 없으면 회신 요청 메일을 보냅니다.',
    subject_ko: '[{행사}] 연사 초청 회신 요청 — {호칭}', subject_en: '[{행사}] Kind Follow-up on Our Speaker Invitation',
    body_ko: '{호칭}께\n\n안녕하십니까. {행사} 사무국 {담당자}입니다.\n앞서 드린 {행사} 연사 초청과 관련하여, 참석 가능 여부를 여쭙고자 다시 연락드립니다.\n\n■ 배정 세션\n{세션}\n\n프로그램 확정 일정상 {마감일}까지 회신을 주시면 큰 도움이 되겠습니다.\n일정 조율이 필요하시거나 궁금하신 점이 있으시면 편하게 말씀해 주십시오.\n\n{담당자} 드림\n{행사} 사무국',
    body_en: 'Dear {호칭},\n\nI hope this message finds you well. I am writing to kindly follow up on our invitation to speak at {행사}.\n\nYour session:\n{세션}\n\nAs we are finalising the programme, we would greatly appreciate your reply by {마감일}. Should you need any adjustment to the schedule, please do not hesitate to let us know.\n\nSincerely,\n{담당자}\n{행사} Secretariat',
  },
  {
    key: 'collect', label: '자료 받기', done: 'needs',
    desc: '역할이 요구하는 자료를 모두 받습니다. 요청 메일을 이미 보냈으면 «독촉»으로 바뀝니다.',
    subject_ko: '[{행사}] 연사 자료 제출 요청 — {호칭}', subject_en: '[{행사}] Request for Speaker Materials',
    body_ko: '{호칭}께\n\n안녕하십니까. {행사} 사무국 {담당자}입니다.\n프로그램북 제작과 현장 준비를 위해 아래 자료를 요청드리고자 연락드립니다.\n\n■ 제출 요청 자료\n{남은자료}\n\n■ 제출 기한\n- {마감일}\n\n■ 제출 양식\n- {양식}\n\n바쁘신 중에 번거로우시겠지만 기한 내 회신 부탁드립니다. 작성 중 궁금하신 점은 언제든 문의해 주십시오.\n\n{담당자} 드림\n{행사} 사무국',
    body_en: 'Dear {호칭},\n\nTo prepare the programme book and on-site arrangements for {행사}, may I kindly ask you to send us the following materials.\n\nRequested materials:\n{남은자료}\n\nDeadline: {마감일}\nSubmission form: {양식}\n\nPlease feel free to contact me if you have any questions.\n\nSincerely,\n{담당자}\n{행사} Secretariat',
    remind_subject_ko: '[{행사}] 연사 자료 제출 재요청 — {호칭}', remind_subject_en: '[{행사}] Gentle Reminder: Speaker Materials',
    remind_body_ko: '{호칭}께\n\n안녕하십니까. {행사} 사무국 {담당자}입니다.\n앞서 요청드린 연사 자료 중 아직 받지 못한 항목이 있어 다시 한번 안내드립니다.\n\n■ 미제출 자료\n{남은자료}\n\n■ 제출 기한\n- {마감일}\n\n프로그램북 인쇄 일정이 있어 기한 내 제출을 정중히 부탁드립니다. 이미 보내주셨다면 이 메일은 넘기셔도 됩니다.\n\n{담당자} 드림\n{행사} 사무국',
    remind_body_en: 'Dear {호칭},\n\nThis is a gentle reminder regarding the speaker materials for {행사}. We have not yet received the following items:\n\n{남은자료}\n\nDeadline: {마감일}\n\nAs the programme book goes to print shortly, we would greatly appreciate your submission by the deadline. If you have already sent them, please disregard this message.\n\nSincerely,\n{담당자}\n{행사} Secretariat',
  },
  {
    key: 'confirm', label: '참가 확정', done: 'field:confirmed_at',
    desc: '자료를 다 받고 일정이 정해지면 «참가 확정» 날짜를 적고 확정 안내를 보냅니다.',
    subject_ko: '[{행사}] 연사 참가 확정 안내 — {호칭}', subject_en: '[{행사}] Confirmation of Your Participation',
    body_ko: '{호칭}께\n\n안녕하십니까. {행사} 사무국 {담당자}입니다.\n{호칭}의 {행사} 연사 참가가 확정되었음을 알려드립니다. 보내주신 자료에도 깊이 감사드립니다.\n\n■ 발표 일정\n{세션}\n\n현장 동선과 리허설 등 세부 안내는 행사 전 별도로 드리겠습니다.\n함께해 주셔서 감사합니다.\n\n{담당자} 드림\n{행사} 사무국',
    body_en: 'Dear {호칭},\n\nI am delighted to confirm your participation as a speaker at {행사}. Thank you very much for the materials you have provided.\n\nYour session:\n{세션}\n\nWe will send you on-site information, including the rehearsal schedule, closer to the event.\n\nWe look forward to welcoming you.\n\nSincerely,\n{담당자}\n{행사} Secretariat',
  },
  {
    key: 'travel', label: '숙박·항공 안내', done: 'log', need: 'travel',
    desc: '숙박·항공을 제공하는 연사에게 예약 안내를 보냅니다. 보내면 이 단계가 끝납니다.',
    subject_ko: '[{행사}] 숙박·항공 예약 안내 — {호칭}', subject_en: '[{행사}] Accommodation & Flight Arrangements',
    body_ko: '{호칭}께\n\n안녕하십니까. {행사} 사무국 {담당자}입니다.\n{호칭}의 참석을 위한 숙박과 항공 예약을 진행하고자 연락드립니다.\n\n■ 회신 요청 사항\n- 희망 입국·출국 일정 (출발 도시 포함)\n- 여권 사본 (영문 성명 확인용)\n- 기타 요청 사항 (좌석, 식이 제한 등)\n\n{마감일}까지 회신해 주시면 예약 후 확정 내역을 안내드리겠습니다.\n\n{담당자} 드림\n{행사} 사무국',
    body_en: 'Dear {호칭},\n\nWe would like to arrange your accommodation and flights for {행사}. Could you kindly provide the following:\n\n- Preferred arrival and departure dates (including departure city)\n- A copy of your passport (to match the name on your ticket)\n- Any special requests (seating, dietary requirements, etc.)\n\nWe would appreciate your reply by {마감일}, after which we will send you the booking confirmation.\n\nSincerely,\n{담당자}\n{행사} Secretariat',
  },
  {
    key: 'thanks', label: '감사 메일', done: 'log',
    desc: '행사가 끝나면 감사 인사를 보냅니다.',
    subject_ko: '[{행사}] 참여에 깊이 감사드립니다 — {호칭}', subject_en: '[{행사}] Thank You for Your Contribution',
    body_ko: '{호칭}께\n\n안녕하십니까. {행사} 사무국 {담당자}입니다.\n바쁘신 가운데 {행사}에 연사로 함께해 주셔서 진심으로 감사드립니다.\n{호칭}의 발표 덕분에 참석자 모두에게 뜻깊은 자리가 되었습니다.\n\n앞으로도 좋은 인연으로 다시 뵙기를 희망합니다.\n감사합니다.\n\n{담당자} 드림\n{행사} 사무국',
    body_en: 'Dear {호칭},\n\nOn behalf of the {행사} Secretariat, I would like to express our sincere gratitude for your participation as a speaker.\nYour presentation made the event truly meaningful for all attendees.\n\nWe hope to have the opportunity to work with you again.\n\nWith warm regards,\n{담당자}\n{행사} Secretariat',
  },
];

/* 영문 메일에 한국어 표기가 섞이지 않게 — 역할과 자료 이름의 영문 */
const ROLE_EN = { 연사: 'Speaker', 패널: 'Panelist', 좌장: 'Moderator', 사회: 'MC', VIP: 'Guest of Honour' };
const ITEM_EN = { profile: 'Affiliation & job title', bio_pro: 'Biography', photo: 'Portrait photo (high resolution)',
  title: 'Presentation title', abstract: 'Abstract', slides: 'Presentation file', consent: 'Consent form',
  bank: 'Bank details', passport: 'Copy of passport', travel: 'Travel details' };

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
    return `- ${en ? (s.title_en || s.title_ko) : (s.title_ko || s.title_en)}${s.date ? ` (${s.date}${when ? ' ' + when : ''})` : ''} — ${en ? (ROLE_EN[a.role] || a.role) : a.role}`;
  }).filter(Boolean);
  const items = missingItems(sp).map(({ c, st }) =>
    `- ${en ? (ITEM_EN[c.key] || c.label) : c.label}${st.state === 'part' && st.text ? ` (${en ? 'partly received' : '일부만 받음'})` : ''}`);
  const name = sp[en ? 'name_en' : 'name_snapshot'] || sp.name_snapshot || sp.name_en || '';
  const titleKo = String(sp.title_ko || '').split(/[\/·,]/)[0].trim();
  const titleEn = String(sp.title_en || '');
  /* 호칭 — 성명에 직함을 붙인다. «대표/소장»처럼 둘이면 앞의 것만.
     영문은 교수만 Professor로 부르고 나머지는 성명 그대로 둔다(Mr./Ms.는 성별을 짐작해야 한다) */
  const honor = en
    ? (/professor|prof\./i.test(titleEn) ? `Professor ${name}` : /^dr\.?\b|ph\.?d/i.test(titleEn) ? `Dr. ${name}` : name)
    : (titleKo ? `${name} ${titleKo}님` : `${name} 님`);
  const vars = {
    이름: name,
    호칭: honor,
    직함: en ? titleEn : (sp.title_ko || ''),
    소속: en ? (sp.org_en || sp.org_ko || '') : (sp.org_ko || sp.org_en || ''),
    행사: evName,
    세션: sessions.join('\n'),
    남은자료: items.length ? items.join('\n') : (en ? '(nothing outstanding)' : '(남은 자료 없음)'),
    마감일: step?.due || (en ? 'your earliest convenience' : '가급적 빠른 시일'),
    가이드: docs[en ? 'guide_en' : 'guide_ko'] || docs.guide_ko || docs.guide_en || '',
    양식: docs[en ? 'form_en' : 'form_ko'] || docs.form_ko || docs.form_en || '',
    담당자: currentUser?.name || (en ? '' : '담당자'),
  };
  /* 마감일이 없으면 «까지»·«by»가 붙은 문장이 어색해진다 — 문장째 바꾼다 */
  let t = String(text || '');
  if(!step?.due) t = t
    .replace(/\{마감일\}까지/g, '가급적 빠른 시일 내에')
    .replace(/by \{마감일\}/g, 'at your earliest convenience')
    .replace(/^■ 제출 기한\n- \{마감일\}\n?/gm, '')
    .replace(/^Deadline: \{마감일\}\n?/gm, '');
  return t
    .replace(/\{(이름|호칭|직함|소속|행사|세션|남은자료|마감일|가이드|양식|담당자)\}/g, (_, k) => vars[k] ?? '')
    .replace(/^\s*드림\s*$/gm, '')          // 담당자 이름이 없으면 «드림»만 남는다
    // 값이 비어 남은 항목 줄 — «- 가이드라인: », «- », «Submission form: »
    .replace(/^- [^\n:：]{1,24}[:：] ?$/gm, '')
    .replace(/^- ?$/gm, '')
    .replace(/^(Deadline|Submission form|Speaker guidelines): ?$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    // 내용이 다 빠진 제목 줄(■ 안내 자료, Your session: 따위)을 걷어낸다
    .replace(/^(■[^\n]*|Your session:|For your reference:|Requested materials:)\n(?=\n|$)/gm, '')
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

export const FLOW_VARS = ['{호칭}', '{이름}', '{직함}', '{소속}', '{행사}', '{세션}', '{남은자료}', '{마감일}', '{가이드}', '{양식}', '{담당자}'];
