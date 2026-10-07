/* ══════════════════════════════════════════════════════════════
   exh-mail.js — 전시 참가사에게 보내는 메일의 단계별 기본 문구

   연사 연락 순서(speaker-flow.js)와 같은 틀이다. 단계와 기본 문구는 여기 코드가
   갖고, 행사마다 바꾼 문구는 설정 › 행사 › 메일 «전시 메일 양식»에서 고쳐
   EXH_CFG[행사].exhMail에 담는다(바꾼 칸만). 기본 첨부는 mail_files에 step
   'exh-<단계>'로 올린다 — 연사 단계와 이름이 겹치지 않게.

   마감일은 따로 적지 않는다 — 설정 › 행사 › 일정의 마감(due)을 그대로 읽는다.
   한 사실을 두 곳에 적으면 갈라진다.
══════════════════════════════════════════════════════════════ */
import { EVENT_LIST, EXH_CFG, getOrgById, currentUser } from '../state.js';
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
export const EXH_MAIL_VARS = ['{기업}', '{담당자}', '{행사}', '{부스}', '{마감일}', '{청구액}', '{미납액}', '{보내는사람}'];
export const EXH_MAIL_FIELDS = [
  ['label', '단계 이름'], ['subject_ko', '제목 (국문)'], ['body_ko', '본문 (국문)'],
  ['subject_en', '제목 (영문)'], ['body_en', '본문 (영문)'],
];
export const exhMailFileStep = (key) => `exh-${key}`;

/* 이 행사의 단계 — 기본 문구 위에 행사에서 바꾼 칸을 얹는다 */
export function exhMailSteps(evKey){
  const over = ((EXH_CFG[evKey] || {}).exhMail) || {};
  return EXH_MAIL_STEPS.map(s => ({ ...s, ...(over[s.key] || {}), key: s.key, due: s.due }));
}

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
  const due = step && step.due ? String(((EXH_CFG[x.event_id] || {}).due || {})[step.due] || '') : '';
  const me = currentUser?.name || '';
  const names = ctx.names || {};
  const vars = {
    기업: en ? (names.en || names.ko || '') : (names.ko || names.en || ''),
    담당자: (ctx.contact && ctx.contact.name) || (en ? 'Sir/Madam' : '담당자'),
    행사: evName,
    부스: x.booth_no || (en ? 'TBA' : '배정 예정'),
    마감일: due || (en ? 'your earliest convenience' : '가급적 빠른 시일'),
    청구액: ctx.billed || '',
    미납액: ctx.unpaid || '',
    // 영문 메일 서명에 한글 이름은 빼고 «… Secretariat»만 남긴다
    보내는사람: en && /[가-힣]/.test(me) ? '' : me,
  };
  let t = String(text || '');
  if(!due) t = t.replace(/\{마감일\}까지/g, '가급적 빠른 시일 내에').replace(/by \{마감일\}/g, 'at your earliest convenience');
  return t.replace(/\{(기업|담당자|행사|부스|마감일|청구액|미납액|보내는사람)\}/g, (_, k) => vars[k] ?? '')
    .replace(/^\s*드림\s*$/gm, '')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
