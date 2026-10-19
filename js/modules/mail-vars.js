/* ══════════════════════════════════════════════════════════════
   mail-vars.js — 메일 양식에 쓰는 칸({호칭}·{기업}…)의 정본

   칸 목록·설명·묶음은 여기 한 곳에만 둔다. 칸 칩(var-chips.js), «쓸 수 있는 칸» 안내,
   모르는 칸 검사, 채우는 함수의 정규식(speaker-flow·exh-mail·contact-mail)이 모두 이것을 읽는다.
   칸을 더하려면 여기 정의를 더하고, 그 영역의 채우는 함수에 값을 넣는다.

   영역
     conf     연사 메일 — 연락 단계·변형·양식 보관함·여러 연사에게 메일
     exh      전시 메일 — 메일 단계·변형·양식 보관함·여러 기업에게 메일
     contact  컨택 차수 DM — 차수 메일 양식·양식 보관함
     crm      영업 CRM 메일 — 한 기업에 바로 쓰는 메일이라 칸 대신 실제 값을 넣는다

   ⚠ {담당자}는 영역마다 뜻이 다르다. 연사 메일에서는 우리 사무국 담당자(보내는 쪽),
     전시·컨택·CRM에서는 상대 기업 담당자(받는 쪽)다. 저장된 양식이 이미 이 이름을 쓰고
     있어 이름은 그대로 두고, 칩의 묶음·설명으로 구분한다.

   행사 칸({행사}·{행사일}·{장소}·{주최}·{주관}·{주제}·{홈페이지})은 모든 영역 공통이다.
   값은 설정 › 행사 관리(기간·장소·영문명)와 행사 탭 «행사 개요»(주최·주관·대주제·홈페이지)가 정본이다.
══════════════════════════════════════════════════════════════ */
import { EVENT_LIST } from '../state.js';

const EVENT_DEFS = [
  { key: '행사',     group: '행사', desc: '행사 이름 — 영문 메일은 영문 행사명(설정 › 행사 관리)' },
  { key: '행사일',   group: '행사', desc: '행사 기간 — 설정 › 행사 관리의 시작일~종료일 (예: 2026년 10월 27일(화)~28일(수))' },
  { key: '장소',     group: '행사', desc: '행사 장소 — 설정 › 행사 관리' },
  { key: '주최',     group: '행사', desc: '주최 기관 — 행사 탭 «행사 개요»' },
  { key: '주관',     group: '행사', desc: '주관 기관 — 행사 탭 «행사 개요»' },
  { key: '주제',     group: '행사', desc: '대주제 — 행사 탭 «행사 개요»' },
  { key: '홈페이지', group: '행사', desc: '행사 홈페이지 주소 — 행사 탭 «행사 개요»' },
];

export const MAIL_VARS = {
  conf: [
    { key: '호칭',     group: '받는 사람', desc: '이름 + 직함 (예: 홍길동 교수님 / Professor Hong)' },
    { key: '이름',     group: '받는 사람', desc: '연사 이름' },
    { key: '직함',     group: '받는 사람', desc: '연사 직함' },
    { key: '소속',     group: '받는 사람', desc: '연사 소속' },
    { key: '세션',     group: '발표',     desc: '배정 세션 — 제목·날짜·시각·장소를 한 줄씩' },
    { key: '발표시간', group: '발표',     desc: '발표 날짜·시각만 한 줄씩' },
    { key: '남은자료', group: '자료',     desc: '아직 안 받은 자료 목록' },
    { key: '가져온자료', group: '자료',   desc: '지난 행사에서 가져온 자료 목록' },
    { key: '가이드',   group: '자료',     desc: '연사 가이드라인 링크 — 설정 › 컨퍼런스 문서' },
    { key: '양식',     group: '자료',     desc: '제출 양식 링크 — 설정 › 컨퍼런스 문서' },
    { key: '마감일',   group: '일정',     desc: '이 단계의 마감일 (없으면 «가급적 빠른 시일»)' },
    { key: '변경내용', group: '일정',     desc: '알린 일정과 달라진 내용' },
    ...EVENT_DEFS,
    { key: '담당자',   group: '보내는 쪽', desc: '우리 사무국 담당자 — 보내는 사람 이름' },
  ],
  exh: [
    { key: '기업',     group: '받는 곳', desc: '참가사 이름 (영문 메일은 영문명)' },
    { key: '담당자',   group: '받는 곳', desc: '참가사 담당자 이름 (없으면 «담당자» / Sir/Madam)' },
    { key: '부스',     group: '부스·비용', desc: '부스 번호 (없으면 «배정 예정»)' },
    { key: '청구액',   group: '부스·비용', desc: '청구 총액' },
    { key: '미납액',   group: '부스·비용', desc: '아직 안 들어온 금액' },
    { key: '마감일',   group: '일정',     desc: '이 단계의 마감일 — 설정 › 행사 › 일정' },
    { key: '변경내용', group: '일정',     desc: '부스 번호가 바뀐 내용' },
    ...EVENT_DEFS,
    { key: '보내는사람', group: '보내는 쪽', desc: '우리 사무국 담당자 — 보내는 사람 이름' },
  ],
  contact: [
    { key: '기업',   group: '받는 곳', desc: '명단 기업 이름 (영문 메일은 영문명)' },
    { key: '담당자', group: '받는 곳', desc: '받는 사람 이름 (없으면 «담당자» / Sir/Madam)' },
    ...EVENT_DEFS,
  ],
  crm: [
    { key: '기업',   group: '받는 곳', desc: '이 기업 이름' },
    { key: '담당자', group: '받는 곳', desc: '체크한 받는 사람 중 첫 사람 이름' },
    ...EVENT_DEFS,
  ],
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* «{호칭}» 꼴 목록 — 예전 FLOW_VARS·EXH_MAIL_VARS 자리 */
export const varTokens = (part) => (MAIL_VARS[part] || []).map(v => `{${v.key}}`);

/* 채우는 함수가 쓰는 정규식 — 긴 이름 먼저(«{행사일}»이 «{행사}»로 잘리지 않게) */
const patCache = {};
export function varPattern(part){
  if(patCache[part]) return patCache[part];
  const keys = (MAIL_VARS[part] || []).map(v => v.key).sort((a, b) => b.length - a.length);
  return (patCache[part] = new RegExp(`\\{(${keys.map(esc).join('|')})\\}`, 'g'));
}

/* 글에 있는데 이 영역에 없는 칸 — 오타 난 칸은 메일에 글자 그대로 나간다 */
export function unknownVars(text, part){
  const known = new Set((MAIL_VARS[part] || []).map(v => v.key));
  const out = new Set();
  String(text || '').replace(/\{([^{}\s]{1,12})\}/g, (m, k) => { if(!known.has(k)) out.add(m); return m; });
  return [...out];
}

/* ── 행사 칸 값 ── */
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
const MON_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function ymd(s){
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s || '').trim());
  if(!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d) ? null : { y: +m[1], mo: +m[2], d: +m[3], dow: d.getDay() };
}
/* 2026년 10월 27일(화)~28일(수) · October 27–28, 2026 — 날짜 꼴이 아니면 적힌 그대로 */
export function eventDateText(ev, en){
  const rawS = (ev && (ev.date_start || ev.date)) || '', rawE = (ev && ev.date_end) || '';
  const s = ymd(rawS), e = ymd(rawE);
  if(!s) return [rawS, rawE].filter(Boolean).join(' ~ ');
  const same = !e || (e.y === s.y && e.mo === s.mo && e.d === s.d);
  if(en){
    if(same) return `${MON_EN[s.mo - 1]} ${s.d}, ${s.y}`;
    if(e.y !== s.y) return `${MON_EN[s.mo - 1]} ${s.d}, ${s.y} – ${MON_EN[e.mo - 1]} ${e.d}, ${e.y}`;
    if(e.mo !== s.mo) return `${MON_EN[s.mo - 1]} ${s.d} – ${MON_EN[e.mo - 1]} ${e.d}, ${s.y}`;
    return `${MON_EN[s.mo - 1]} ${s.d}–${e.d}, ${s.y}`;
  }
  const a = `${s.y}년 ${s.mo}월 ${s.d}일(${DOW_KO[s.dow]})`;
  if(same) return a;
  const b = e.y !== s.y ? `${e.y}년 ${e.mo}월 ${e.d}일` : e.mo !== s.mo ? `${e.mo}월 ${e.d}일` : `${e.d}일`;
  return `${a}~${b}(${DOW_KO[e.dow]})`;
}
export function eventVarValues(evKey, en){
  const ev = EVENT_LIST.find(e => e.key === evKey);
  if(!ev) return { 행사: evKey || '', 행사일: '', 장소: '', 주최: '', 주관: '', 주제: '', 홈페이지: '' };
  return {
    행사: (en && ev.name_en) || ev.name || ev.short || ev.key,
    행사일: eventDateText(ev, en),
    장소: ev.location || '',
    주최: ev.host || '',
    주관: ev.organizer || '',
    주제: ev.theme || '',
    홈페이지: ev.homepage || '',
  };
}
