/* ══════════════════════════════════════════════════════════════
   audit-describe.js — 활동 로그 한 줄을 사람 말로 푼다

   기록에는 «마무리 — title_en, kind 고침»처럼 DB 칸 이름이 그대로 남아 있었다.
   어느 행사의 무엇인지, 무엇에서 무엇으로 바뀌었는지가 없어서 읽어도 알 수 없었다.

   기록 자체는 고치지 않는다. 되돌리기용으로 남겨 둔 이전 값·새 값(extra.before/after)이
   이미 있으니 그릴 때 풀어서 보여준다 — 그래서 지난 기록 2,900여 건도 같이 읽기 쉬워진다.
══════════════════════════════════════════════════════════════ */
import { EVENT_LIST } from '../state.js';

/* 칸 이름 → 사람이 부르는 이름. 모르는 칸은 칸 이름 그대로 둔다 */
const F = {
  // 공통
  title_ko: '제목', title_en: '영문 제목', name: '이름', note: '메모', status: '상태',
  date: '날짜', start_at: '시작', end_at: '끝', updated_at: '수정일', seq: '순서',
  // 세션
  kind: '종류', track: '트랙', room: '회의실',
  // 배정
  role: '역할', lang: '발표 언어', duration_min: '발표 시간(분)', keywords: '키워드',
  talk_format: '발표 형식', discussion: '논의 주제', abstract_ko: '초록', abstract_en: '영문 초록',
  abstract_received_at: '초록 받은 날', slides_file: '발표자료 파일', slides_received_at: '발표자료 받은 날',
  slides_version: '발표자료 판', speaker_id: '연사', session_id: '세션',
  // 연사
  name_snapshot: '성명', name_en: '영문 성명', org_ko: '소속', org_en: '영문 소속',
  nationality: '국적', residence_country: '거주지', pay_basis: '연사료 기준', lang_pref: '자료 언어',
  invite_sent_at: '초청 보낸 날', invite_replied_at: '초청 회신', guide_sent_at: '가이드 보낸 날',
  form_sent_at: '양식 보낸 날', reminded_at: '독촉한 날', confirmed_at: '참가 확정',
  bio_profile_ko: '소개', bio_profile_en: '영문 소개', bio_pro_ko: '경력', bio_pro_en: '영문 경력',
  bio_work_ko: '근무', bio_work_en: '영문 근무', bio_edu_ko: '학력', bio_edu_en: '영문 학력',
  bio_awards_ko: '수상', bio_awards_en: '영문 수상', bio_credentials_ko: '자격', bio_credentials_en: '영문 자격',
  bio_teaching_ko: '강의', bio_teaching_en: '영문 강의', bio_affil_ko: '학회', bio_affil_en: '영문 학회',
  bio_pubs_ko: '출판', bio_pubs_en: '영문 출판', languages: '구사 언어',
  cv_file: 'CV 파일', cv_received_at: 'CV 받은 날', profile_received_at: '이력 받은 날',
  photo_file: '사진 파일', photo_received_at: '사진 받은 날',
  fee_amount: '연사료', fee_currency: '연사료 통화', fee_tax_type: '세금 구분', fee_paid_at: '연사료 지급일', fee_note: '연사료 메모',
  stay_hotel: '호텔', stay_in: '체크인', stay_out: '체크아웃', stay_room_type: '객실', stay_booked: '숙박 예약', stay_note: '숙박 메모',
  air_route: '항공 구간', air_in_flight: '입국편', air_in_at: '입국 시각', air_out_flight: '출국편', air_out_at: '출국 시각',
  air_class: '좌석 등급', air_ticketed_at: '발권일', air_note: '항공 메모',
  consent_basic: '동의(기본)', consent_photo: '동의(사진)', consent_abstract: '동의(초록)', consent_slides: '동의(발표자료)',
  consent_video: '동의(영상)', consent_at: '동의서 받은 날', consent_file: '동의서 파일', consent_note: '동의 메모',
  passport_file: '여권 파일', passport_received_at: '여권 받은 날',
  reuse_from: '가져온 행사', reused_at: '가져온 날',
  // 연락처
  nameKo: '이름', nameEn: '영문 이름', orgKo: '기업', orgEn: '영문 기업',
  titleKo: '직함', titleEn: '영문 직함', deptKo: '부서', deptEn: '영문 부서',
  country: '국가', cat: '카테고리', email1: '이메일 1', email2: '이메일 2', phone1: '연락처 1', phone2: '연락처 2',
  beat: '분야', products: '품목', tags: '태그', prefix: '경칭', memo1: '메모 1', memo2: '메모 2', memo3: '메모 3',
  left_at: '퇴사 확인일', email: '이메일', phone: '연락처', send: '메일 수신',
  // 전시
  company_name: '기업명', booth_no: '부스 번호', booth_type: '부스 타입', booth_floor: '층', grade: '등급',
  graphic_spec_ok: '그래픽 규격 확인',
  // 전시 진행 (exhibitors)
  company_key: '기업', org_id: '기업', manual_sent_at: '매뉴얼 보낸 날', manual_replied_at: '매뉴얼 회신',
  app_received: '신청서 받음', app_received_at: '신청서 받은 날', app_complete: '신청서 다 받음', app_missing: '신청서 빠진 것',
  extra_equipment: '추가 비품', booth_qty: '부스 수', booth_confirmed: '부스 확정', booth_confirmed_at: '부스 확정일',
  booth_design_received_at: '도면 받은 날', booth_design_checked_at: '도면 검토일', booth_design_result: '도면 검토 결과',
  booth_design_note: '도면 메모', work_report_at: '작업 신고서 받은 날', booth_shared: '부스 함께 씀', scope: '참가 범위',
  fascia_name: '간판명', base_recv_at: '기본 시공 자료 받은 날', base_done_at: '기본 시공 완료', base_note: '기본 시공 메모',
  settled: '완납 처리', settled_note: '정산 메모', pay_due_date: '입금 기한', gap_ack: '금액 차이 확인', reissue_ack: '다시 발행 확인',
  tax_contact_name: '세금계산서 담당자', tax_contact_email: '세금계산서 이메일', tax_contact_phone: '세금계산서 연락처',
  graphic_stage: '그래픽 단계', graphic_received_at: '그래픽 받은 날', graphic_to_team_at: '그래픽팀 전달일',
  graphic_team_ok_at: '그래픽팀 확인일', graphic_replied_at: '기업 회신일', graphic_ordered_at: '그래픽 주문일',
  graphic_type: '그래픽 종류', graphic_spec_note: '그래픽 규격 메모', graphic_draft_at: '시안일',
  graphic_revised_at: '수정안일', graphic_final_at: '최종안일',
  directory_received: '도록 정보 받음', directory_received_at: '도록 정보 받은 날', directory_note: '도록 메모',
  apply_order: '신청 번호', book_order: '도록 순번', book_logo: '도록 로고', book_address: '도록 주소',
  book_phone: '도록 전화', book_website: '도록 웹사이트', book_intro: '도록 소개', book_name_ko: '도록 국문명',
  book_name_en: '도록 영문명', movein_at: '반입일', builder: '시공사', builder_org_id: '시공사',
  builder_contact: '시공사 담당자', builder_tel: '시공사 전화', builder_mobile: '시공사 휴대폰', builder_email: '시공사 이메일',
  badge_count: '배지 수', badge_issued_at: '배지 발급일', onsite_note: '현장 메모', host_key: '부스 같이 쓰는 기업',
  is_primary: '주 담당자', handler: '처리자',
  // 금액 항목 · 신청서 · 입금 · 세금계산서
  unit_price: '단가', catalog_id: '품목', billable: '청구 포함', shared_ref: '같이 쓰는 항목',
  received_at: '받은 날', received_note: '받은 메모', due_at: '마감일', done_at: '완료일', app_id: '신청서',
  change_kind: '변경 종류', prev_qty: '이전 수량', prev_amount: '이전 금액', voided_at: '취소일',
  edited_at: '고친 날', edited_by: '고친 사람', origin: '출처', handled_at: '처리일', summary: '요약',
  method: '결제 수단', paid_at: '입금일', tax_stage: '세금계산서 단계', requested_at: '요청일',
  to_finance_at: '재무팀 요청일', sent_at: '발행일', tax_requested_at: '세금계산서 요청일',
  tax_to_finance_at: '세금계산서 재무팀 요청일', tax_sent_at: '세금계산서 발행일',
  price_krw: '단가(원)', price_usd: '단가(달러)', name_en_item: '영문 품명', sort_order: '순서',
  // 기업 · CRM · 설정
  sector: '섹터', currentStage: '진행 단계', bioStep: '이력 진행', cls: '색', our_role: '우리 역할',
  organizer: '주관', host: '주최', theme: '주제', homepage: '홈페이지', domain: '분야',
  scale: '규모', location: '장소', color: '색', short: '약칭', date_start: '시작일', date_end: '종료일',
  contact_id: '연락처', exhibitor_id: '참가기업', event_id: '행사',
  amount: '금액', currency: '통화', category: '분류', qty: '수량', price: '단가', stage: '단계', due: '마감일',
};
/* 계좌·여권 번호처럼 기록 화면에 펼쳐 보이면 안 되는 값 */
const SECRET = /^bank_/;
/* 값이 코드로 저장되는 칸 */
const V = {
  kind: { '': '세션', break: '커피 브레이크', lunch: '런치', dinner: '갈라 디너' },
  stay_booked: { yes: '예약함', '': '안 함' },
  lang_pref: { both: '국·영문', en: '영문만' },
  send: { to: '받는 사람', cc: '참조', '': '보내지 않음' },
  graphic_stage: { '': '전달 전', received: '기업 전달', to_team: '그래픽팀 확인', team_ok: '확인 완료', replied: '기업 회신' },
  tax_stage: { '': '요청 전', requested: '기업 요청', to_finance: '재무팀 요청', done: '발행 완료' },
  currentStage: Object.fromEntries(['타겟 등록', '초기 컨택', '제안서 발송', '미팅', '협의 중', '계약 완료'].map((l, i) => [String(i + 1), l])),
  billable: { no: '청구 제외', '': '청구 포함' },
  booth_design_result: { ok: '적합', ng: '보완 필요' },
  cls: { '': '기본색' },
  graphic_type: { print: '출력', design: '제작', '': '없음' },
};
/* yes/no처럼 여러 칸이 같이 쓰는 값 */
const COLOR = { blue: '파랑', amber: '주황', green: '초록', red: '빨강', gray: '회색', purple: '보라',
  gold: '금색', teal: '청록', indigo: '남색' };
const YESNO = { yes: '예', no: '아니요', true: '예', false: '아니요' };

/* &amp; · -&gt; 처럼 글자로 남은 기호를 되돌린다 */
const unent = (t) => String(t ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/* 받침에 맞지 않는 조사 — «확정로», «대한민국로», «통화을(를)», «굿윈를».
   한글 낱자의 받침 유무로 고른다. ㄹ 받침은 «로»가 맞다(«서울로»). */
const jong = (ch) => { const c = ch.charCodeAt(0) - 0xAC00; return c < 0 || c > 11171 ? -1 : c % 28; };
function josa(t){
  return t
    .replace(/([가-힣])(?:을\(를\)|를\(을\))/g, (m, c) => c + (jong(c) > 0 ? '을' : '를'))
    .replace(/([가-힣])(?:이\(가\)|가\(이\))/g, (m, c) => c + (jong(c) > 0 ? '이' : '가'))
    .replace(/([가-힣])(?:\(으\)로)/g, (m, c) => c + (jong(c) > 0 && jong(c) !== 8 ? '으로' : '로'))
    .replace(/([가-힣])(으로|로)(?=[\s»"'”]*(?:옮김|옮겨|채웠|채움|변경|바꿈|바꿨|고쳤|지정|이동|넣음|돌림|되돌|정함))/g,
      (m, c, j) => c + (jong(c) > 0 && jong(c) !== 8 ? '으로' : '로'))
    .replace(/([가-힣])(을|를)(?= )/g, (m, c, j) => {
      const want = jong(c) > 0 ? '을' : '를';
      return j === want ? m : c + want;
    });
}

const label = (k) => F[k] || (SECRET.test(k) ? '계좌 정보' : k);
const short = (v) => {
  const s = String(v ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
};
const show = (k, v) => {
  if(V[k] && String(v ?? '') in V[k]) return V[k][String(v ?? '')];
  if(String(v ?? '') in YESNO) return YESNO[String(v)];
  if(k === 'cls' && /^p-/.test(String(v || ''))) return COLOR[String(v).slice(2)] || String(v);
  const s = short(v);
  return s === '' ? '없음' : s;
};

export const evName = (key) => {
  const e = EVENT_LIST.find(x => x.key === key);
  return e ? (e.short || e.name || e.key) : '';
};

/* {where, what, lines} — where: «2026 KIC · 컨퍼런스 세션», what: 본문 첫 줄, lines: 바뀐 칸들 */
export function describeAudit(e){
  const x = e.extra || {};
  const ev = evName(e.target) || evName(x.ev);
  /* 대상이 행사 key면 행사 이름으로, 기업·사람 이름이면 그대로 */
  const where = [ev || (e.target && !/@/.test(e.target) ? e.target : ''), e.action]
    .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');

  let what = unent(String(e.detail || '').replace(/<[^>]+>/g, ''));
  let lines = [];
  if(x.op === 'update' && x.after && typeof x.after === 'object'){
    const keys = Object.keys(x.after).filter(k => String((x.before || {})[k] ?? '') !== String(x.after[k] ?? ''));
    lines = keys.map(k => SECRET.test(k)
      ? `${label(k)} 고침`
      : `${label(k)}: ${show(k, (x.before || {})[k])} → ${show(k, x.after[k])}`);
    /* «… — title_en, kind 고침»의 칸 이름 꼬리는 아래 줄이 대신하니 떼어 낸다 */
    if(lines.length) what = what.replace(/\s*—\s*[A-Za-z0-9_, ]+ 고침\s*$/, '');
  }
  /* 지운 것·만든 것도 태그는 «정보 수정»으로 찍혀 왔다 — 무엇을 했는지 앞에 밝힌다 */
  /* 이미 «지움»«삭제»«추가»라고 적힌 줄에는 또 붙이지 않는다 */
  const said = `${e.action || ''} ${what}`;
  if(e.type === 'view') what = '열어 봄 · ' + what;          // 계좌·여권을 펼쳐 본 기록
  else if(x.op === 'delete' && !/삭제|지움|제거|뺐|되돌림/.test(said)) what = '삭제 · ' + what;
  else if(x.op === 'create' && !/추가|등록|확인|접수|업로드|초청|배정|입력/.test(said)) what = '추가 · ' + what;
  /* 꼬리를 못 뗀 옛 기록에서도 칸 이름만은 사람 말로 바꾼다 */
  what = what.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\b(?:kind|track|room|role|status|date|seq|note|sector|method|billable|cls|currentStage|bioStep|name|location|color|host|organizer|theme|homepage|domain|summary|handler|scale)\b/g, k => F[k] || k)
    /* 옛 기록 본문에 남은 yes/no, 단계 코드 */
    .replace(/\b(yes|no)\b/g, k => YESNO[k])
    .replace(/(그래픽 단계 )([a-z_]+) → ([a-z_]*)/g, (m, a, b, c) => a + show('graphic_stage', b) + ' → ' + show('graphic_stage', c))
    .replace(/(그래픽 종류 )([a-z]+) → ([a-z]*)/g, (m, a, b, c) => a + show('graphic_type', b) + ' → ' + show('graphic_type', c))
    .replace(/(세금계산서 단계 )([a-z_]+) → ([a-z_]*)/g, (m, a, b, c) => a + show('tax_stage', b) + ' → ' + show('tax_stage', c));
  /* 옛 기록마다 빈 값을 (빈값)·(빈칸)·(없음)·(지움)·(비어 있음)으로 다르게 적었다 — «없음» 하나로 */
  what = what.replace(/([^\s→])\((?:빈값|빈칸|없음|지움|비어 있음|비움)\)/g, '$1')   // «요청 전(빈값)» → «요청 전»
    .replace(/\((?:빈값|빈칸|없음|지움|비어 있음|비움)\)/g, '없음')
    .replace(/\bp-([a-z]+)\b/g, (m, c) => COLOR[c] || m)
    .replace(/([가-힣])([»”\"']*)\(으\)로/g, (m, c, q) => c + q + (jong(c) > 0 && jong(c) !== 8 ? '으로' : '로'));
  what = josa(what);
  lines = lines.map(l => josa(unent(l)));
  return { where: unent(where), what, lines };
}

/* 화면용 — 바뀐 뒤 값과 숫자를 굵게. 글자는 먼저 escape하고 나서 감싼다 */
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function boldChange(text){
  return esc(text)
    // «→ 새 값» — 다음 « / »·«|»·« (»·문장 끝까지
    .replace(/→ ([^/|(—]+?)(?=\s*(?:\/|\||\(|—|$|로 |으로 |을 |를 ))/g, (m, v) => `→ <b>${v}</b>`)
    // 금액·수량·순번 (이미 굵게 된 안은 건드리지 않는다)
    /* 날짜(2026-09-03)·품목 코드(G-030)·번호(XA-1790…)는 숫자여도 굵게 하지 않는다 */
    .replace(/(<b>[^<]*<\/b>)|(\d{4}-\d{2}-\d{2}|[A-Za-z]+-[\w-]+)|((?:[$₩])?\d[\d,.]*(?:\s?(?:원|KRW|USD|명|곳|개사|건|번|품목|칸|분))?)/g,
      (m, b, skip, n) => {
        if(b || skip) return b || skip;
        if(/^(19|20)\d{2}$/.test(n)) return n;                       // «2026 KIC»의 연도
        /* 단위가 없는 작은 숫자는 이름의 일부일 때가 많다(North Glass 1, 세션 7) — 굵게 하지 않는다 */
        if(!/[^\d,.]/.test(n) && !/,|\d{4,}/.test(n)) return n;
        /* 781000 → 781,000 — 옛 기록은 금액에 쉼표가 없다 */
        const v = /^\d{4,}$/.test(n) ? Number(n).toLocaleString('ko-KR') : n;
        return `<b>${v}</b>`;
      });
}
