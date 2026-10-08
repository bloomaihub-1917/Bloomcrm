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
import { SPEAKER_ROLES } from '../constants.js';
import { reusePending, reuseSummary } from './contact-speaker.js';

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
    /* 지난 행사에서 가져온 자료가 있으면 새로 달라고 하지 않고 확인을 부탁한다 */
    reuse_subject_ko: '[{행사}] 연사 자료 확인 요청 — {호칭}', reuse_subject_en: '[{행사}] Kindly Confirm Your Speaker Profile',
    reuse_body_ko: '{호칭}께\n\n안녕하십니까. {행사} 사무국 {담당자}입니다.\n지난 행사 때 보내주신 자료로 이번 프로그램북과 현장 안내를 준비하고자 합니다. 번거로우시지 않도록 새로 작성을 요청드리는 대신, 아래 내용이 지금도 맞는지 확인을 부탁드립니다.\n\n■ 확인 부탁드릴 자료\n{가져온자료}\n\n■ 추가로 필요한 자료\n{남은자료}\n\n바뀐 내용이 있으시면 수정본을, 그대로이시면 «변동 없음»으로 {마감일}까지 회신해 주십시오.\n\n{담당자} 드림\n{행사} 사무국',
    reuse_body_en: 'Dear {호칭},\n\nFor {행사}, we would like to use the materials you kindly provided for a previous event. Rather than asking you to fill in the form again, may we ask you to confirm that the details below are still current?\n\nFor your confirmation:\n{가져온자료}\n\nAdditional materials needed:\n{남은자료}\n\nIf anything has changed, please send us the updated version; otherwise a simple "no changes" reply by {마감일} would be much appreciated.\n\nSincerely,\n{담당자}\n{행사} Secretariat',
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
    /* 발표자료는 가장 늦게 온다(현장에서 받기도 한다). 자료 받기·참가 확정을 막지 않게
       따로 뒤에 둔다. 받으면 끝 — 발제 탭에서 발표자료를 받음으로 표시하면 된다 */
    key: 'slides', label: '발표자료 받기', done: 'cell:slides', need: 'slides',
    desc: '발표자료는 보통 가장 늦게 오고 현장에서 받기도 합니다. 행사 전에 한 번 요청하고, 받으면 발제 탭에서 받음으로 표시하세요.',
    subject_ko: '[{행사}] 발표자료 제출 요청 — {호칭}', subject_en: '[{행사}] Request for Your Presentation File',
    body_ko: '{호칭}께\n\n안녕하십니까. {행사} 사무국 {담당자}입니다.\n원활한 현장 진행을 위해 발표자료를 미리 받아 두고자 연락드립니다.\n\n■ 발표 일정\n{세션}\n\n■ 제출 기한\n- {마감일}\n\n최종본이 늦어지실 경우 초안을 먼저 보내주시고, 현장에서 최종본으로 교체하셔도 괜찮습니다. 영상·음원이 포함된 경우 파일을 함께 보내주시면 미리 재생을 확인해 두겠습니다.\n\n{담당자} 드림\n{행사} 사무국',
    body_en: 'Dear {호칭},\n\nTo ensure a smooth presentation on the day, may we kindly ask you to send us your presentation file in advance.\n\nYour session:\n{세션}\n\nDeadline: {마감일}\n\nIf your final version is not ready yet, a draft is perfectly fine — you may replace it with the final version on site. If your slides include video or audio, please send those files as well so that we can test playback beforehand.\n\nSincerely,\n{담당자}\n{행사} Secretariat',
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
const ITEM_EN = { profile: 'Affiliation & job title', bio_pro: 'Biography', cv: 'CV', photo: 'Portrait photo (high resolution)',
  title: 'Presentation title', abstract: 'Abstract', slides: 'Presentation file', consent: 'Consent form',
  bank: 'Bank details', passport: 'Copy of passport', travel: 'Travel details' };

/* 행사를 돌리다 생기는 연락 — 담당자가 연사 화면에서 바로 더하는 단계(conf.flow_custom).
   끝난 기준은 하나: 그 단계 메일을 보내면 끝. «기준일»을 적으면 그날까지 초청한
   연사에게만 서고, 그날 이후 보낸 메일만 센다 — 일정표가 또 바뀌면 날짜만 고친다. */
export const CUSTOM_PRESETS = [
  {
    label: '일정 변경 안내',
    desc: '프로그램 일정표가 바뀌어, 바뀌기 전에 안내받은 연사에게 바뀐 발표 일정을 다시 알립니다.',
    subject_ko: '[{행사}] 프로그램 일정 변경 안내 — {호칭}', subject_en: '[{행사}] Updated Programme Schedule',
    body_ko: '{호칭}께\n\n안녕하십니까. {행사} 사무국 {담당자}입니다.\n{행사} 프로그램 일정표가 변경되어, 앞서 안내드린 발표 일정을 아래와 같이 정정하여 다시 알려드립니다.\n\n■ 변경된 발표 일정\n{세션}\n\n혼란을 드려 대단히 죄송합니다. 변경된 일정에 참석이 어려우시면 {마감일}까지 회신해 주십시오. 일정을 다시 조율하겠습니다.\n\n{담당자} 드림\n{행사} 사무국',
    body_en: 'Dear {호칭},\n\nPlease note that the programme schedule for {행사} has been revised. We would like to share your updated session details below, which supersede our previous information.\n\nYour session:\n{세션}\n\nWe apologise for any inconvenience. Should the new schedule not suit you, please let us know by {마감일} and we will be happy to work out an alternative.\n\nSincerely,\n{담당자}\n{행사} Secretariat',
    after: 'invite', since: 'today',
  },
];
export const isCustomStep = (key) => String(key || '').startsWith('c-');

/* 이 행사의 단계 — 코드 기본값 위에 행사 설정(conf.flow[key])을 얹고,
   더한 단계(conf.flow_custom)를 «after» 단계 뒤에 끼운다(없으면 맨 끝) */
export function flowSteps(evKey, { withOff = false } = {}){
  const cfg = confCfg(evKey);
  const over = cfg.flow || {};
  const out = FLOW_STEPS.map(s => ({ ...s, ...(over[s.key] || {}), key: s.key, done: s.done, need: s.need }));
  (cfg.flow_custom || []).forEach(c => {
    const st = { ...c, custom: true, done: c.since ? 'since' : 'log', need: undefined };
    const i = c.after === '' ? -1 : out.findIndex(x => x.key === c.after);
    if(c.after === '') out.unshift(st); else out.splice(i < 0 ? out.length : i + 1, 0, st);
  });
  return out.filter(s => withOff || !s.off);
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
/* 숙박·항공과 발표자료는 자기 단계가 따로 있다 — «자료 받기»를 막지 않게 뺀다 */
const OWN_STEP = ['travel', 'slides'];
/* «필수»만 센다 — 설정 범례대로 «있으면 좋음»은 받으면 표시만 하고 독촉하지 않는다.
   그걸 세면 해외 연사는 여권, 패널은 초록 때문에 «자료 받기»가 끝나지 않았다. */
export function missingItems(sp){
  return SP_COLS.filter(c => !OWN_STEP.includes(c.key))
    .map(c => ({ c, st: spCell(sp, sp.event_id, c.key) }))
    .filter(x => x.st.need === 'req' && (x.st.state === 'todo' || x.st.state === 'part'));
}

/* ── 남은 일 ──
   연사 화면의 «남은 일», 탭 배지, «안 받은 자료 한 번에 요청» 메일이 모두 이 목록을 쓴다.
   따로 세면 위에서는 «동의서·계좌», 탭에서는 이력·발제·제공사항까지 «1»로 떠
   무엇부터 할지 알 수 없었다. 필수·있으면 좋음은 설정 › 행사 › 컨퍼런스 격자가 정본.

     when  now   지금 받을 것(필수) — 자료 받기 단계
           later 다음에 받을 것(필수) — 발표자료처럼 자기 단계가 따로 있는 것
           nice  있으면 좋음 — 받으면 표시만, 독촉하지 않는다
           ours  우리가 할 일 — 연사료 지급·숙박·항공 예약
     tab   그 항목이 있는 연사 화면 탭(파트) — 결과는 파트별로 쌓인다 */
const TAB_OF = { profile: 'basic', photo: 'basic', consent: 'basic', bio_pro: 'bio', cv: 'bio',
  title: 'talk', abstract: 'talk', slides: 'talk', bank: 'bank', passport: 'bank', travel: 'offer' };
export const PART_LABEL = { basic: '기본', bio: '이력', talk: '발제', offer: '제공사항', bank: '계좌·여권' };
export function pendingItems(sp){
  if(!sp || noFlow(sp) || sp.status === '취소') return [];
  const steps = flowSteps(sp.event_id, { withOff: true });
  const dueOf = (k) => (steps.find(s => s.key === k) || {}).due || '';
  const out = [];
  SP_COLS.forEach(c => {
    if(c.key === 'travel') return;                       // 숙박·항공은 우리가 할 일로
    const st = spCell(sp, sp.event_id, c.key);
    if(!(st.state === 'todo' || st.state === 'part')) return;
    const own = c.key === 'slides';
    out.push({ key: c.key, label: c.label, more: st.state === 'part' && st.text ? st.text : '',
      tab: TAB_OF[c.key] || 'basic', when: st.need === 'req' ? (own ? 'later' : 'now') : 'nice',
      due: own ? dueOf('slides') : dueOf('collect') });
  });
  if(sp.fee_amount && !sp.fee_paid_at) out.push({ key: 'fee', label: '연사료 지급', tab: 'offer', when: 'ours', due: '' });
  const tr = spCell(sp, sp.event_id, 'travel');
  if((tr.state === 'todo' || tr.state === 'part') && (sp.stay_hotel || sp.air_route))
    out.push({ key: 'travel', label: '숙박·항공 예약', tab: 'offer', when: 'ours', due: dueOf('travel') });
  return out;
}

const sentLog = (sp, key) => logsOfSpeaker(sp.id).some(l => l.kind === key);

function isDone(sp, step){
  if(step.done.startsWith('field:')) return !!sp[step.done.slice(6)];
  if(step.done === 'needs') return !missingItems(sp).length;
  if(step.done === 'since') return logsOfSpeaker(sp.id)
    .some(l => l.kind === step.key && String(l.ts || '').slice(0, 10) >= step.since);
  /* 숙박·항공은 안내 메일을 보냈거나, 제공사항 탭에서 예약을 다 마쳤으면 끝이다 */
  if(step.done === 'log') return sentLog(sp, step.key)
    || (step.key === 'travel' && spCell(sp, sp.event_id, 'travel').state === 'done');
  if(step.done.startsWith('cell:')){
    const c = spCell(sp, sp.event_id, step.done.slice(5));
    // «있으면 좋음»이면 안 받아도 이 단계를 막지 않는다
    return c.state === 'done' || c.state === 'na' || c.need !== 'req';
  }
  return false;
}

/* 우리가 연락하지 않는 사람 — 맡은 역할이 모두 noMail(VIP)이면.
   역할이 하나도 없으면(아직 배정 전) 연락 대상으로 본다. */
export function noFlow(sp){
  const roles = rolesOfSpeaker(sp.id);
  return roles.length > 0 && roles.every(r => (SPEAKER_ROLES.find(x => x.key === r) || {}).noMail);
}

/* 연사 한 명의 단계 상태 — current는 해당되면서 아직 안 끝난 첫 단계.
   skip이면 연락 단계 자체가 없다(주최사 전달) — 집계에서 빼야 한다. */
export function flowStatus(sp){
  /* 취소한 연사에게는 더 연락하지 않는다 — 할 일·독촉 목록에서 빠진다 */
  const cancelled = sp.status === '취소';
  const skip = noFlow(sp) || cancelled;
  const steps = flowSteps(sp.event_id).map(s => {
    /* 숙박·항공은 기본이 «있으면 좋음»이라 그대로 두면 국내 연사 모두에게 걸린다 —
       필수로 정했거나 제공사항에 숙박·항공을 적은 연사에게만 단계가 선다 */
    const need = s.need ? needOf(sp, s.need) : '';
    /* 일정 변경 안내는 바뀐 날까지 초청(세션 안내)을 받은 연사에게만 — 그 뒤에 초청한
       연사는 이미 바뀐 일정을 받았다 */
    if(s.done === 'since'){
      const applies = !skip && !!s.since && !!sp.guide_sent_at && String(sp.guide_sent_at).slice(0, 10) <= s.since;
      return { ...s, applies, isDone: applies && isDone(sp, s) };
    }
    const applies = !skip && (!s.need || (s.key === 'travel'
      ? (need === 'req' || !!sp.stay_hotel || !!sp.air_route)
      : !!need));
    /* 기본 단계에 기준일을 적으면 «다시 보내기» — 이미 이 단계를 받았거나 끝낸 연사에게만
       다시 걸고(그날 이후 이 단계 메일을 보내면 끝), 아직 이 단계까지 오지 않은 연사는
       평소대로 간다. 안 그러면 확정 전 연사에게 «참가 확정 안내»가 나간다 */
    if(s.since && applies){
      const normal = isDone(sp, s);
      if(normal || sentLog(sp, s.key)){
        const again = logsOfSpeaker(sp.id).some(l => l.kind === s.key && String(l.ts || '').slice(0, 10) >= s.since);
        return { ...s, applies, isDone: again, resend: true };
      }
      return { ...s, applies, isDone: normal };
    }
    return { ...s, applies, isDone: applies && isDone(sp, s) };
  });
  const current = steps.find(s => s.applies && !s.isDone) || null;
  /* 자료 요청을 이미 보냈는데 아직 덜 받았으면 다음 메일은 독촉이다 */
  const remind = !!current && current.key === 'collect' && !current.resend && sentLog(sp, 'collect');
  const live = steps.filter(s => s.applies);
  return { steps, current, remind, skip, cancelled, nDone: live.filter(s => s.isDone).length, nAll: live.length };
}

/* 표·CRM에 쓸 한 줄 */
export function nextActionLabel(sp){
  const f = flowStatus(sp);
  if(f.cancelled) return { text: '취소', done: true, skip: true };
  if(f.skip) return { text: '주최사 전달', done: true, skip: true };
  if(!f.current) return { text: '연락 완료', done: true };
  const label = f.remind ? '자료 독촉' : f.current.resend ? `${f.current.label} (다시)` : f.current.label;
  const left = f.current.key === 'collect' ? missingItems(sp).length : 0;
  return { text: `${label}${left ? ` (${left})` : ''}`, step: f.current.key, due: f.current.due || '', done: false };
}

/* ── 양식 채우기 ── */
export function fillTemplate(text, sp, step){
  const en = sp.lang_pref === 'en';
  const ev = EVENT_LIST.find(e => e.key === sp.event_id);
  /* 영문 메일은 영문 행사명(설정 › 행사 › 기본 정보)을 쓴다 — 없으면 행사명 */
  const evName = ev ? ((en && ev.name_en) || ev.name || ev.short || ev.key) : sp.event_id;
  const cfg = confCfg(sp.event_id);
  /* 여러 세션이면 발표 순서대로 — 배정한 순서로 나가면 날짜가 뒤섞인다 */
  const whenOf = (a) => { const s = CONF_SESSIONS.find(x => x.id === a.session_id) || {};
    return `${s.date || '9999'} ${a.start_at || s.start_at || '99:99'}`; };
  const asgSorted = assignmentsFor(sp.id).slice().sort((a, b) => whenOf(a).localeCompare(whenOf(b)));
  const docs = cfg.docs || {};
  const sessions = asgSorted.map(a => {
    const s = CONF_SESSIONS.find(x => x.id === a.session_id);
    if(!s || s.kind) return '';
    /* 연사에게는 세션 시간이 아니라 «본인 발표 시각»을 알린다 */
    const when = a.start_at ? `${a.start_at}${a.end_at ? '–' + a.end_at : ''}` : (s.start_at || '');
    return `- ${en ? (s.title_en || s.title_ko) : (s.title_ko || s.title_en)}${s.date ? ` (${s.date}${when ? ' ' + when : ''})` : ''} — ${en ? (ROLE_EN[a.role] || a.role) : a.role}`;
  }).filter(Boolean);
  /* 발표 시간만 따로 — «■ 발표 시간» 아래에 날짜·시각만 적고 싶을 때 */
  const talkTimes = asgSorted.map(a => {
    const s = CONF_SESSIONS.find(x => x.id === a.session_id);
    if(!s || s.kind) return '';
    const st = a.start_at || s.start_at || '', ed = a.start_at ? (a.end_at || '') : (s.end_at || '');
    return [s.date, st ? `${st}${ed ? '–' + ed : ''}` : ''].filter(Boolean).join(' ');
  }).filter(Boolean);
  /* 확인 메일에서는 가져온 자료를 «남은 자료»에 또 적지 않는다 */
  const pend = new Set(step?.reuse ? reusePending(sp).map(g => g.key === 'bio' ? 'bio_pro' : g.key) : []);
  const items = missingItems(sp).filter(({ c }) => !pend.has(c.key)).map(({ c, st }) =>
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
    소속: en ? (sp.org_en || '') : (sp.org_ko || sp.org_en || ''),
    행사: evName,
    세션: sessions.join('\n'),
    발표시간: talkTimes.join('\n'),
    /* 장소는 행사 설정(설정 › 행사 관리 › 기본 정보)이 정본 — 메일에 따로 적지 않는다 */
    장소: ev ? (ev.location || '') : '',
    /* 확인 메일에서 더 받을 게 없으면 «추가로 필요한 자료» 제목째 빠지게 비운다 */
    남은자료: items.length ? items.join('\n') : step?.reuse ? '' : (en ? '(nothing outstanding)' : '(남은 자료 없음)'),
    마감일: step?.due || (en ? 'your earliest convenience' : '가급적 빠른 시일'),
    가이드: docs[en ? 'guide_en' : 'guide_ko'] || docs.guide_ko || docs.guide_en || '',
    양식: docs[en ? 'form_en' : 'form_ko'] || docs.form_ko || docs.form_en || '',
    담당자: en ? (/[가-힣]/.test(currentUser?.name || '') ? '' : (currentUser?.name || ''))
      : (currentUser?.name || '담당자'),
    가져온자료: reuseSummary(sp, en),
  };
  /* 마감일이 없으면 «까지»·«by»가 붙은 문장이 어색해진다 — 문장째 바꾼다 */
  let t = String(text || '');
  if(!step?.due) t = t
    .replace(/\{마감일\}까지/g, '가급적 빠른 시일 내에')
    .replace(/by \{마감일\}/g, 'at your earliest convenience')
    .replace(/^■ 제출 기한\n- \{마감일\}\n?/gm, '')
    .replace(/^Deadline: \{마감일\}\n?/gm, '');
  return t
    .replace(/\{(이름|호칭|직함|소속|행사|장소|세션|발표시간|남은자료|가져온자료|마감일|가이드|양식|담당자)\}/g, (_, k) => vars[k] ?? '')
    .replace(/^\s*드림\s*$/gm, '')          // 담당자 이름이 없으면 «드림»만 남는다
    // 값이 비어 남은 항목 줄 — «- 가이드라인: », «- », «Submission form: »
    .replace(/^- [^\n:：]{1,24}[:：] ?$/gm, '')
    .replace(/^- ?$/gm, '')
    .replace(/^(Deadline|Submission form|Speaker guidelines): ?$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    // 내용이 다 빠진 제목 줄(■ 안내 자료, Your session: 따위)을 걷어낸다
    .replace(/^(■[^\n]*|Your session:|For your reference:|Requested materials:|For your confirmation:|Additional materials needed:)\n(?=\n|$)/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* 단계의 메일 초안 */
export function draftFor(sp, stepKey){
  const f = flowStatus(sp);
  const step = f.steps.find(s => s.key === stepKey);
  if(!step) return null;
  const en = sp.lang_pref === 'en';
  /* 확인 요청은 처음 한 번 — 보냈는데도 답이 없으면 그다음은 독촉이다 */
  const reuse = stepKey === 'collect' && !f.remind && reusePending(sp).length > 0;
  const remind = stepKey === 'collect' && f.remind;
  const pre = reuse ? 'reuse_' : remind ? 'remind_' : '';
  const pick = (k) => step[`${pre}${k}_${en ? 'en' : 'ko'}`] || step[`${k}_${en ? 'en' : 'ko'}`] || '';
  const st = reuse ? { ...step, reuse: true } : step;
  return {
    subject: fillTemplate(pick('subject'), sp, st),
    body: fillTemplate(pick('body'), sp, st),
    kind: stepKey, category: reuse ? '자료 확인 요청' : remind ? '자료 독촉' : step.label,
  };
}

export const FLOW_VARS = ['{호칭}', '{이름}', '{직함}', '{소속}', '{행사}', '{장소}', '{세션}', '{발표시간}', '{남은자료}', '{가져온자료}', '{마감일}', '{가이드}', '{양식}', '{담당자}'];
