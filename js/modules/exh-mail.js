/* ══════════════════════════════════════════════════════════════
   exh-mail.js — 전시 참가사에게 보내는 메일의 단계별 기본 문구

   연사 연락 순서(speaker-flow.js)와 같은 틀이다. 단계와 기본 문구는 여기 코드가
   갖고, 행사마다 바꾼 문구는 설정 › 행사 › 메일 «전시 메일 양식»에서 고쳐
   EXH_CFG[행사].exhMail에 담는다(바꾼 칸만). 기본 첨부는 mail_files에 step
   'exh-<단계>'로 올린다 — 연사 단계와 이름이 겹치지 않게.

   마감일은 따로 적지 않는다 — 설정 › 행사 › 일정의 마감(due)을 그대로 읽는다.
   한 사실을 두 곳에 적으면 갈라진다.
══════════════════════════════════════════════════════════════ */
import { EVENT_LIST, EXH_CFG, EXH_LOGS, getOrgById, currentUser, logsFor } from '../state.js';
import { countryName } from '../utils.js';

/* due: 설정 › 일정의 마감 키(exh-tab.js DUE_STEPS) */
export const EXH_MAIL_STEPS = [
  {
    key: 'manual', label: '참가 매뉴얼 안내', due: 'manual_replied_at',
    subject_ko: '[{행사}] 참가 매뉴얼 안내 — {기업}', subject_en: '[{행사}] Exhibitor Manual — {기업}',
    body_ko: '{담당자}님께\n\n안녕하십니까. {행사} 사무국입니다.\n{행사}에 참가해 주셔서 진심으로 감사드립니다.\n\n참가 준비에 필요한 내용을 정리한 참가 매뉴얼을 첨부드립니다.\n확인하신 뒤 {마감일}까지 회신해 주시면 이후 일정을 차례로 안내드리겠습니다.\n\n궁금하신 점은 언제든 사무국으로 문의해 주십시오.\n\n감사합니다.\n{행사} 사무국 {보내는사람} 드림',
    body_en: 'Dear {담당자},\n\nThank you for participating in {행사}.\nPlease find attached the exhibitor manual with everything you need to prepare.\nWe would appreciate your confirmation by {마감일}; we will then guide you through the next steps.\n\nPlease do not hesitate to contact us with any questions.\n\nBest regards,\n{보내는사람}\n{행사} Secretariat',
  },
  {
    key: 'app', label: '신청서 제출 요청', due: 'app_received_at',
    subject_ko: '[{행사}] 참가 신청서 제출 요청 — {기업}', subject_en: '[{행사}] Request for Application Form — {기업}',
    body_ko: '{담당자}님께\n\n안녕하십니까. {행사} 사무국입니다.\n부스 운영에 필요한 참가 신청서(비품·전기·그래픽 등)를 {마감일}까지 제출해 주시기 바랍니다.\n양식은 첨부 파일을 참고해 주십시오.\n\n감사합니다.\n{행사} 사무국 {보내는사람} 드림',
    body_en: 'Dear {담당자},\n\nKindly submit the exhibitor application form (furniture, electricity, graphics, etc.) by {마감일}.\nPlease refer to the attached form.\n\nBest regards,\n{보내는사람}\n{행사} Secretariat',
  },
  {
    key: 'booth', label: '부스 배정 안내', due: 'booth_confirmed_at',
    subject_ko: '[{행사}] 부스 배정 안내 — {기업}', subject_en: '[{행사}] Booth Allocation — {기업}',
    body_ko: '{담당자}님께\n\n안녕하십니까. {행사} 사무국입니다.\n{기업}의 부스가 아래와 같이 배정되었음을 알려드립니다.\n\n■ 부스 번호: {부스}\n\n도면을 확인하시고 {마감일}까지 확정 여부를 회신해 주십시오.\n\n감사합니다.\n{행사} 사무국 {보내는사람} 드림',
    body_en: 'Dear {담당자},\n\nWe are pleased to inform you of your booth allocation.\n\nBooth No.: {부스}\n\nPlease review the floor plan and confirm by {마감일}.\n\nBest regards,\n{보내는사람}\n{행사} Secretariat',
  },
  {
    /* 부스 번호가 바뀌면 «알린 부스»(그 기업에 마지막으로 보낸 메일의 «부스 번호:» 줄)와
       지금 번호가 다른 곳에만 선다. 새 번호를 담은 메일을 보내면 끝 */
    key: 'booth_change', label: '부스 변경 안내', due: '',
    subject_ko: '[{행사}] 부스 위치 변경 안내 — {기업}', subject_en: '[{행사}] Change of Booth Location — {기업}',
    body_ko: '{담당자}님께\n\n안녕하십니까. {행사} 사무국입니다.\n전시장 배치가 조정되어 {기업}의 부스 위치가 아래와 같이 변경되었음을 알려드립니다.\n\n■ 변경 내용\n{변경내용}\n\n■ 부스 번호: {부스}\n\n변경된 도면을 첨부드리니 확인 부탁드립니다. 혼란을 드려 대단히 죄송합니다.\n\n감사합니다.\n{행사} 사무국 {보내는사람} 드림',
    body_en: 'Dear {담당자},\n\nDue to an adjustment of the floor plan, your booth location has changed as follows.\n\nWhat has changed:\n{변경내용}\n\nBooth No.: {부스}\n\nPlease find the updated floor plan attached. We apologise for any inconvenience.\n\nBest regards,\n{보내는사람}\n{행사} Secretariat',
  },
  {
    key: 'payment', label: '인보이스·입금 안내', due: 'calc:payment',
    subject_ko: '[{행사}] 인보이스 송부 및 입금 안내 — {기업}', subject_en: '[{행사}] Invoice & Payment — {기업}',
    body_ko: '{담당자}님께\n\n안녕하십니까. {행사} 사무국입니다.\n참가비 인보이스를 첨부드립니다.\n\n■ 청구액: {청구액}\n■ 남은 금액: {미납액}\n■ 입금 기한: {마감일}\n\n입금하신 뒤 알려주시면 확인해 드리겠습니다.\n\n감사합니다.\n{행사} 사무국 {보내는사람} 드림',
    body_en: 'Dear {담당자},\n\nPlease find attached the invoice for your participation.\n\nAmount: {청구액}\nOutstanding: {미납액}\nDue date: {마감일}\n\nKindly let us know once the payment has been made.\n\nBest regards,\n{보내는사람}\n{행사} Secretariat',
  },
  {
    key: 'graphic', label: '그래픽 자료 요청', due: 'calc:graphic',
    subject_ko: '[{행사}] 부스 그래픽 자료 요청 — {기업}', subject_en: '[{행사}] Booth Graphic Files — {기업}',
    body_ko: '{담당자}님께\n\n안녕하십니까. {행사} 사무국입니다.\n부스 그래픽 제작을 위해 디자인 파일을 {마감일}까지 보내주시기 바랍니다.\n규격과 파일 형식은 첨부 가이드를 참고해 주십시오.\n\n감사합니다.\n{행사} 사무국 {보내는사람} 드림',
    body_en: 'Dear {담당자},\n\nTo produce your booth graphics, please send us the design files by {마감일}.\nKindly refer to the attached guide for sizes and file formats.\n\nBest regards,\n{보내는사람}\n{행사} Secretariat',
  },
  {
    key: 'directory', label: '도록 정보 요청', due: 'directory_received_at',
    subject_ko: '[{행사}] 참가사 도록 정보 요청 — {기업}', subject_en: '[{행사}] Exhibitor Directory Information — {기업}',
    body_ko: '{담당자}님께\n\n안녕하십니까. {행사} 사무국입니다.\n참가사 도록(프로그램북)에 실릴 기업 소개·로고·연락처를 {마감일}까지 보내주시기 바랍니다.\n\n감사합니다.\n{행사} 사무국 {보내는사람} 드림',
    body_en: 'Dear {담당자},\n\nPlease send us your company profile, logo and contact details for the exhibitor directory by {마감일}.\n\nBest regards,\n{보내는사람}\n{행사} Secretariat',
  },
  {
    key: 'movein', label: '반입·설치 안내', due: 'movein_at',
    subject_ko: '[{행사}] 반입·설치 일정 안내 — {기업}', subject_en: '[{행사}] Move-in Schedule — {기업}',
    body_ko: '{담당자}님께\n\n안녕하십니까. {행사} 사무국입니다.\n반입·설치 일정을 안내드립니다.\n\n■ 반입·설치: {마감일}\n■ 부스 번호: {부스}\n\n세부 동선과 주의사항은 첨부를 확인해 주십시오.\n\n감사합니다.\n{행사} 사무국 {보내는사람} 드림',
    body_en: 'Dear {담당자},\n\nPlease find below the move-in schedule.\n\nMove-in: {마감일}\nBooth No.: {부스}\n\nDetails and on-site rules are attached.\n\nBest regards,\n{보내는사람}\n{행사} Secretariat',
  },
  {
    key: 'note', label: '기타 안내', due: '',
    subject_ko: '[{행사}] 안내 — {기업}', subject_en: '[{행사}] Notice — {기업}',
    body_ko: '{담당자}님께\n\n안녕하십니까. {행사} 사무국입니다.\n\n\n감사합니다.\n{행사} 사무국 {보내는사람} 드림',
    body_en: 'Dear {담당자},\n\n\nBest regards,\n{보내는사람}\n{행사} Secretariat',
  },
];
export const EXH_MAIL_VARS = ['{기업}', '{담당자}', '{행사}', '{부스}', '{변경내용}', '{마감일}', '{청구액}', '{미납액}', '{보내는사람}'];

/* «+ 단계 추가» 옆에 미리 채워 두는 양식 — 전시를 돌리다 자주 생기는 안내 */
const SIGN_KO = '\n\n감사합니다.\n{행사} 사무국 {보내는사람} 드림', SIGN_EN = '\n\nBest regards,\n{보내는사람}\n{행사} Secretariat';
export const EXH_CUSTOM_PRESETS = [
  {
    label: '반입·철수 일정 변경', after: 'movein',
    subject_ko: '[{행사}] 반입·철수 일정 변경 안내 — {기업}', subject_en: '[{행사}] Revised Move-in / Move-out Schedule — {기업}',
    body_ko: '{담당자}님께\n\n안녕하십니까. {행사} 사무국입니다.\n반입·철수 일정이 아래와 같이 변경되어 알려드립니다.\n\n■ 반입·설치: \n■ 철수: \n■ 부스 번호: {부스}\n\n일정에 맞춰 차량·인력 배치를 다시 확인 부탁드립니다.' + SIGN_KO,
    body_en: 'Dear {담당자},\n\nPlease note that the move-in and move-out schedule has been revised as follows.\n\nMove-in: \nMove-out: \nBooth No.: {부스}\n\nKindly review your vehicle and staff arrangements accordingly.' + SIGN_EN,
  },
  {
    label: '주차·출입 안내', after: 'movein',
    subject_ko: '[{행사}] 주차 및 출입 안내 — {기업}', subject_en: '[{행사}] Parking & Access Information — {기업}',
    body_ko: '{담당자}님께\n\n안녕하십니까. {행사} 사무국입니다.\n행사 기간 주차와 출입 방법을 안내드립니다.\n\n■ 주차: \n■ 출입증 수령: \n■ 출입 가능 시간: \n\n현장에서 궁금하신 점은 사무국으로 연락 주십시오.' + SIGN_KO,
    body_en: 'Dear {담당자},\n\nPlease find below the parking and access information for the event.\n\nParking: \nBadge collection: \nAccess hours: \n\nPlease contact the Secretariat on site if you have any questions.' + SIGN_EN,
  },
  {
    label: '철수 안내', after: 'movein',
    subject_ko: '[{행사}] 철수 안내 — {기업}', subject_en: '[{행사}] Move-out Information — {기업}',
    body_ko: '{담당자}님께\n\n안녕하십니까. {행사} 사무국입니다.\n행사 종료 후 철수 일정과 유의사항을 안내드립니다.\n\n■ 철수 일시: \n■ 부스 번호: {부스}\n■ 유의사항: 임대 비품은 부스에 두고, 개인 물품과 폐기물은 모두 반출해 주십시오.\n\n함께해 주셔서 감사합니다.' + SIGN_KO,
    body_en: 'Dear {담당자},\n\nPlease find below the move-out schedule and guidelines.\n\nMove-out: \nBooth No.: {부스}\nPlease leave rented furniture in the booth and remove all personal items and waste.\n\nThank you for participating.' + SIGN_EN,
  },
];

/* ── 알린 부스와 지금 부스 ──
   그 기업에 마지막으로 나간 메일 본문의 «부스 번호: …»·«Booth No.: …» 줄이 «알린 부스»다.
   따로 적어 두지 않는다 — 실제로 나간 글이 정본이다. 아직 배정 전이라 «배정 예정/TBA»로
   나간 것은 알린 게 아니다 */
const BOOTH_RE = /(?:부스 번호|Booth No\.?)\s*[:：]\s*([^\n]+)/;
const NOT_YET = ['배정 예정', 'TBA', ''];
const boothCache = new Map();
export function toldBooth(x){
  const sig = `${EXH_LOGS.length}|${(EXH_LOGS[EXH_LOGS.length - 1] || {}).id || ''}`;
  const hit = boothCache.get(x.id);
  if(hit && hit.sig === sig) return hit.v;
  let v = null;
  for(const l of logsFor(x.id)){       // 최근 것부터
    if(l.direction !== 'out' || !l.body) continue;
    const m = String(l.body).split('[첨부]')[0].match(BOOTH_RE);
    if(m){ const b = m[1].trim(); if(!NOT_YET.includes(b)){ v = { booth: b, ts: l.ts }; break; } }
  }
  boothCache.set(x.id, { sig, v });
  return v;
}
const normBooth = (b) => String(b || '').replace(/\s+/g, '').toUpperCase();
export function boothChange(x){
  const t = toldBooth(x);
  const cur = String(x.booth_no || '').trim();
  return { known: !!t, from: t ? t.booth : '', to: cur, changed: !!t && !!cur && normBooth(t.booth) !== normBooth(cur) };
}
export const EXH_MAIL_FIELDS = [
  ['label', '단계 이름'], ['subject_ko', '제목 (국문)'], ['body_ko', '본문 (국문)'],
  ['subject_en', '제목 (영문)'], ['body_en', '본문 (영문)'],
];
export const exhMailFileStep = (key) => `exh-${key}`;

/* 이 행사의 단계 — 기본 문구 위에 행사에서 바꾼 칸(exhMail[key])을 얹고,
   행사를 돌리다 더한 단계(exhMailCustom)를 «after» 단계 뒤에 끼운다(없으면 맨 끝).
   더한 단계의 마감은 날짜를 바로 적는다(due_date) — 일정 탭에 없는 마감이라서.
   끈 단계(off)는 메일 탭·여러 기업에 보내기에서 빠진다. */
export const isCustomExhStep = (key) => String(key || '').startsWith('c-');
export function exhMailSteps(evKey, { withOff = false } = {}){
  const cfg = EXH_CFG[evKey] || {};
  const over = cfg.exhMail || {};
  /* 다시 보내기는 발송 묶음(exhMailRounds) — 예전 «기준일»(since)은 읽지 않는다 */
  const roundOf = (key) => (cfg.exhMailRounds || []).find(r => r.step === key && !r.closed_at) || null;
  const out = EXH_MAIL_STEPS.map(s => ({ ...s, ...(over[s.key] || {}), key: s.key, due: s.due, since: undefined, round: roundOf(s.key) }));
  (cfg.exhMailCustom || []).forEach(c => {
    const st = { ...c, custom: true, due: '', since: undefined, round: roundOf(c.key) };
    if(c.after === ''){ out.unshift(st); return; }
    const i = out.findIndex(x => x.key === c.after);
    out.splice(i < 0 ? out.length : i + 1, 0, st);
  });
  return out.filter(s => withOff || !s.off);
}

/* 양식 변형(mail-templates.js) — 전시는 조건 없이 보낼 때 고른다 */
export const exhStepVariants = (evKey, key) => (((EXH_CFG[evKey] || {}).exhMailVariants) || {})[key] || [];

/* 해외 기업이면 영문으로 — 기업DB의 국가. 모르면 국문 */
export function exhIsEnglish(x){
  const o = x && x.org_id ? getOrgById(x.org_id) : null;
  const c = countryName((o && o.country) || '');
  return !!c && c !== '대한민국';
}

/* 문구 채우기. ctx는 부르는 쪽이 넘긴다(exh-tab의 계산 함수를 여기서 부르면 순환이 된다):
   { names:{ko,en}, contact:{name}, booth, billed, unpaid } */
export function fillExhTemplate(text, x, step, en, ctx = {}){
  const ev = EVENT_LIST.find(e => e.key === x.event_id);
  const evName = ev ? ((en && ev.name_en) || ev.name || ev.short || ev.key) : x.event_id;
  const due = step && step.due_date ? String(step.due_date)
    : step && step.due ? String(((EXH_CFG[x.event_id] || {}).due || {})[step.due] || '') : '';
  const me = currentUser?.name || '';
  const names = ctx.names || {};
  const vars = {
    기업: en ? (names.en || names.ko || '') : (names.ko || names.en || ''),
    담당자: (ctx.contact && ctx.contact.name) || (en ? 'Sir/Madam' : '담당자'),
    행사: evName,
    부스: x.booth_no || (en ? 'TBA' : '배정 예정'),
    마감일: due || (en ? 'your earliest convenience' : '가급적 빠른 시일'),
    변경내용: /\{변경내용\}/.test(String(text || '')) ? (() => { const b = boothChange(x);
      return b.changed ? `- ${en ? 'Booth No.' : '부스 번호'}: ${b.from} → ${b.to}` : ''; })() : '',
    청구액: ctx.billed || '',
    미납액: ctx.unpaid || '',
    // 영문 메일 서명에 한글 이름은 빼고 «… Secretariat»만 남긴다
    보내는사람: en && /[가-힣]/.test(me) ? '' : me,
  };
  let t = String(text || '');
  if(!due) t = t.replace(/\{마감일\}까지/g, '가급적 빠른 시일 내에').replace(/by \{마감일\}/g, 'at your earliest convenience');
  return t.replace(/\{(기업|담당자|행사|부스|변경내용|마감일|청구액|미납액|보내는사람)\}/g, (_, k) => vars[k] ?? '')
    .replace(/^\s*드림\s*$/gm, '')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
