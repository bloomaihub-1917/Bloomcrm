/* ══════════════════════════════════════════════════════════════
   testdata.js — 로컬 테스트 로그인(이름/이메일/비밀번호를 모두 "test"로
   입력) 전용 가짜 데이터.

   서버 표와 같은 모양의 행을 만들어 api.js의 loadFromSheets에 넘긴다
   (setTestFixtures) — 실제 화면이 쓰는 읽기 길을 그대로 타므로 연사·전시·
   컨택 탭이 운영 때와 똑같이 그려진다. 사람·기업·메일·전화는 전부 지어낸
   값이다(example.com, 010-0000-xxxx). 소개 영상 녹화용으로도 쓴다.

   날짜는 오늘을 기준으로 잡는다 — «요청 N일째» 리마인더, «다시 걸 차례»가
   언제 열어도 보이게.

   백엔드는 건드리지 않는다 — auth.js가 테스트 세션 시작 시 API_BASE_URL을
   비워 두므로 저장 요청은 나가지 않는다.
═══════════════════════════════════════════════════════════════ */

/* 행사 넷 — 이름은 실제 행사를 따르고, 사람·기업은 전부 지어낸다 */
const KIC  = '2026 KIC';        // 컨퍼런스 (연사)
const AIA  = '2026 AIA';        // 심포지엄 (연사)
const BK25 = 'BIO KOREA 2025';  // 지난 전시 — 진행 완료
const BK26 = 'BIO KOREA 2026';  // 전시 + 컨택 차수
const EV = BK26;

const day = (n) => {                       // 오늘 + n일, YYYY-MM-DD (nowStamp처럼 이 컴퓨터 시각 기준)
  const d = new Date(); d.setDate(d.getDate() + n);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const at = (n, hh = 10) => `${day(n)} ${String(hh).padStart(2, '0')}:00`;   // nowStamp()와 같은 꼴

/* 기업 12곳 — 앞 8곳은 전시 참가, 뒤 4곳은 컨택(판촉) 대상 */
const ORG_SRC = [
  ['그린셀바이오',   'GreenCell Bio',      '대한민국'],
  ['한빛제약',       'Hanbit Pharma',      '대한민국'],
  ['누리진단',       'Nuri Diagnostics',   '대한민국'],
  ['바이오브릿지',   'BioBridge Inc.',     '미국'],
  ['솔라메디칼',     'Solar Medical',      '대한민국'],
  ['코어랩스',       'CoreLabs',           '싱가포르'],
  ['미래바이오텍',   'Mirae Biotech',      '대한민국'],
  ['오로라CRO',      'Aurora CRO',         '일본'],
  ['하늘굿즈',       'Haneul Goods',       '대한민국'],
  ['별빛프린팅',     'Byeolbit Printing',  '대한민국'],
  ['초록기획',       'Chorok Planning',    '대한민국'],
  ['다온디자인',     'Daon Design',        '대한민국'],
];

/* 사람 — [이름, 영문, 기업 번호, 직함] */
const PEOPLE = [
  ['김하늘', 'Haneul Kim',   0, '사업개발 팀장'], ['이서준', 'Seojun Lee',   1, '마케팅 매니저'],
  ['박지우', 'Jiwoo Park',   2, '대표'],          ['최유나', 'Yuna Choi',    3, 'BD Director'],
  ['정민호', 'Minho Jung',   4, '영업 과장'],     ['강수아', 'Sua Kang',     5, 'Regional Manager'],
  ['윤도현', 'Dohyun Yoon',  6, '전략기획 실장'], ['임채원', 'Chaewon Lim',  7, 'Project Lead'],
  ['한지민', 'Jimin Han',    8, '대표'],          ['오세훈', 'Sehun Oh',     9, '실장'],
  ['서다인', 'Dain Seo',    10, '팀장'],          ['문태오', 'Taeo Moon',   11, '디자이너'],
];

/* 연사 — [이름, 영문, 소속, 직함, 상태, 진행 정도(0~4), 행사, 세션, 국가] */
const SPEAKER_SRC = [
  ['장윤서', 'Yunseo Jang',   '한국바이오연구원',  '책임연구원', '확정',   4, KIC, 'CS-K1', '대한민국'],
  ['배현우', 'Hyunwoo Bae',   '서울미래대학교',    '교수',       '확정',   3, KIC, 'CS-K2', '대한민국'],
  ['Emily Carter', 'Emily Carter', 'Northfield Bio', 'VP, R&D', '확정', 3, KIC, 'CS-K2', '미국'],
  ['송지호', 'Jiho Song',     '그린셀바이오',      'CTO',        '확정',   2, KIC, 'CS-K4', '대한민국'],
  ['류하은', 'Haeun Ryu',     '국가바이오정책원',  '센터장',     '섭외중', 1, KIC, 'CS-K4', '대한민국'],
  ['Kenji Sato', 'Kenji Sato', 'Aurora CRO',       'Director',   '섭외중', 1, KIC, 'CS-K5', '일본'],
  ['노준혁', 'Junhyuk Noh',   '한빛제약',          '연구소장',   '섭외중', 0, KIC, 'CS-K5', '대한민국'],
  ['정다은', 'Daeun Jeong',   '예시건축사사무소',  '대표 건축가', '확정',   4, AIA, 'CS-A1', '대한민국'],
  ['Lucas Moreau', 'Lucas Moreau', 'Atelier Exemple', 'Principal', '확정', 2, AIA, 'CS-A2', '프랑스'],
  ['신우진', 'Woojin Shin',   '가상공간연구소',    '소장',       '섭외중', 1, AIA, 'CS-A2', '대한민국'],
];
/* 파트너링 바이어 — [이름, 기업, 직함, 국가] */
const BUYER_SRC = [
  ['Olivia Grant',   'Westbridge Pharma',  'Head of Sourcing',     '미국'],
  ['Takumi Mori',    'Sakura Life Science', 'Purchasing Manager',  '일본'],
  ['Lena Hoffmann',  'Rheinmed GmbH',      'Business Development', '독일'],
  ['Arjun Mehta',    'Lotus Healthcare',   'Procurement Lead',     '인도'],
];
const WAITING = 4;   // 류하은 — 9일 전에 초청하고 아직 답이 없다 «🔔 리마인더 보낼 때»

export function buildTestFixtures(){
  const orgs = ORG_SRC.map(([ko, en, country], i) => ({
    id: `O-T${String(i + 1).padStart(3, '0')}`, name_ko: ko, name_en: en, abbr: '', aliases: '',
    kind: i < 8 ? '전시참가기업' : '벤더시공사', status: '활성', sectors: '', country,
    hq: '', website: `www.${en.toLowerCase().replace(/[^a-z]/g, '')}.example.com`, biz_no: '',
    cat_code: '', notes: '', source: '테스트 데이터', created_at: at(-60), updated_at: at(-5),
    products: '', phone: `02-0000-${String(1000 + i)}`, email: `info${i + 1}@example.com`,
    address: '서울시 가상구 예시로 ' + (i + 1), intro: `${ko}는 테스트용으로 지어낸 기업입니다.`,
  }));

  /* 연락처 id는 작은 숫자로 — 16자리 규칙(CLAUDE.md)과 부딪히지 않는다 */
  const contacts = [];
  const participations = [];
  PEOPLE.forEach(([ko, en, oi, title], i) => {
    const id = 1001 + i;
    contacts.push({
      id, nameKo: ko, nameEn: en, orgKo: ORG_SRC[oi][0], orgEn: ORG_SRC[oi][1],
      titleKo: title, titleEn: '', deptKo: '', deptEn: '', country: ORG_SRC[oi][2],
      cat: 'attendee', lang: 'KO', source: '테스트 데이터', date: day(-30), status: 'new',
      email1: `contact${id}@example.com`, email2: '', phone1: `010-0000-${String(id)}`, phone2: '',
      beat: '', products: '', tags: '', org_id: orgs[oi].id,
    });
    participations.push({ id: `P-T${id}`, ev_id: EV, cid: id, '성명': ko,
      type: oi < 8 ? '전시참가기업' : '비즈니스파트너링', note: '', matched: '' });
  });
  /* 파트너링 — 전시 참가사 다섯 곳이 셀러로도 신청(넷 확정), 해외 바이어 넷(셋 확정) */
  [0, 1, 2, 4, 6].forEach((oi, k) => participations.push({ id: `P-TS${1001 + oi}`, ev_id: EV, cid: 1001 + oi,
    '성명': PEOPLE[oi][0], type: '셀러', note: '', matched: '', confirmed_at: k < 4 ? day(-10 + k) : '' }));
  BUYER_SRC.forEach(([en, org, title, country], i) => {
    const id = 3001 + i;
    contacts.push({
      id, nameKo: '', nameEn: en, orgKo: '', orgEn: org, titleKo: '', titleEn: title,
      deptKo: '', deptEn: '', country, cat: 'attendee', lang: 'EN', source: '테스트 데이터', date: day(-20),
      status: 'new', email1: `buyer${id}@example.com`, email2: '', phone1: `+1-000-000-${id}`, phone2: '',
      beat: '', products: '', tags: '', org_id: '',
    });
    participations.push({ id: `P-T${id}`, ev_id: EV, cid: id, '성명': en, type: '바이어', note: '', matched: '',
      confirmed_at: i < 3 ? day(-8 + i) : '' });
  });
  SPEAKER_SRC.forEach(([ko, en, org, title, , , , , country], i) => {
    const id = 2001 + i;
    contacts.push({
      id, nameKo: /[가-힣]/.test(ko) ? ko : '', nameEn: en, orgKo: org, orgEn: '', titleKo: title, titleEn: '',
      deptKo: '', deptEn: '', country, cat: 'speaker',
      lang: /[가-힣]/.test(ko) ? 'KO' : 'EN', source: '테스트 데이터', date: day(-40), status: 'new',
      email1: `speaker${id}@example.com`, email2: '', phone1: `010-0000-${id}`, phone2: '',
      beat: '', products: '', tags: '', org_id: '',
    });
    participations.push({ id: `P-T${id}`, ev_id: SPEAKER_SRC[i][6], cid: id, '성명': ko, type: '연사', note: '', matched: '' });
  });

  const mkEv = (id, name, color, d, loc, summary) => ({
    id, name, short: name, color, date_start: day(d), date_end: day(d + 2), location: loc,
    host: '', organizer: '스튜디오 블룸', our_role: '운영 대행', theme: '', scale: '', homepage: '',
    summary, outcome: '', domain: '', name_en: name,
  });
  const events = [
    mkEv(KIC,  '2026 KIC Conference',      '#16A34A',  24, '서울 예시컨벤션센터', '테스트용 — 연사 7명'),
    mkEv(AIA,  '2026 AIA EA SYMPOSIUM',    '#6D28D9',  38, '서울 예시아트홀',     '테스트용 — 연사 3명'),
    mkEv(BK26, 'BIO KOREA 2026',           '#C97B0A',  31, '서울 예시전시장',     '테스트용 — 전시 8개사, 컨택 차수 2개, 파트너링 셀러 5·바이어 4'),
    mkEv(BK25, 'BIO KOREA 2025',           '#3B5BDB', -330, '서울 예시전시장',    '테스트용 — 지난 전시 4개사'),
  ];

  /* ── 컨퍼런스 ── */
  const mkSess = (ev, pre, d, list) => list.map(([ko, en, st, e, track, kind], i) => ({
    id: `CS-${pre}${i + 1}`, event_id: ev, seq: String(i + 1), title_ko: ko, title_en: en,
    date: day(d), start_at: st, end_at: e, track, room: 'Hall A', note: '', kind,
  }));
  const sessions = [
    ...mkSess(KIC, 'K', 24, [
      ['개회 · 기조강연', 'Opening Keynote', '09:30', '10:30', 'Opening Keynote', ''],
      ['세션 1 · 바이오 소재의 미래', 'Session 1', '11:00', '12:00', 'Session 1', ''],
      ['점심', 'Lunch', '12:00', '13:30', '', 'lunch'],
      ['세션 2 · 임상 데이터와 AI', 'Session 2', '13:30', '14:30', 'Session 2', ''],
      ['패널 토론', 'Panel Discussion', '15:00', '16:00', 'Session 3', ''],
    ]),
    ...mkSess(AIA, 'A', 38, [
      ['기조강연 · 도시와 건축', 'Keynote', '10:00', '11:00', 'Keynote', ''],
      ['세션 · 지속 가능한 설계', 'Session 1', '13:00', '14:30', 'Session 1', ''],
    ]),
  ];

  const speakers = [];
  const sessionSpeakers = [];
  const speakerContacts = [];
  const speakerLogs = [];
  SPEAKER_SRC.forEach(([ko, en, org, title, status, prog, ev, sess], i) => {
    const id = `SP-T${i + 1}`;
    const waiting = i === WAITING;
    const has = (n) => !waiting && prog >= n;   // 답을 기다리는 연사는 초청 말고는 아무것도 없다
    speakers.push({
      id, event_id: ev, contact_id: String(2001 + i), name_snapshot: ko, name_en: en, status,
      lang_pref: /[가-힣]/.test(ko) ? 'ko' : 'en', note: '', updated_at: at(-1),
      org_ko: org, org_en: '', title_ko: title, title_en: '',
      nationality: '', residence_country: '',
      invite_sent_at: at(waiting ? -9 : -30 + i), invite_replied_at: has(1) ? at(-25 + i) : null,
      /* 리마인더는 «참석 회신 받기» 단계에서 센다 — 기다리는 연사도 가이드는 보낸 상태여야 한다 */
      guide_sent_at: waiting ? at(-9) : (has(1) ? at(-20) : null), confirmed_at: status === '확정' ? at(-22) : null,
      profile_received_at: has(2) ? at(-15) : null, bio_profile_ko: has(2) ? `${org} ${title}. 테스트용 약력입니다.` : null,
      photo_file: has(3) ? 'photo.jpg' : null, photo_received_at: has(3) ? at(-12) : null,
      consent_basic: has(3) ? 'yes' : null, consent_photo: has(3) ? 'yes' : null,
      consent_video: has(4) ? 'yes' : (has(3) ? 'no' : null), consent_at: has(3) ? at(-10) : null,
      video_publish: has(4) ? 'yes' : null,
      fee_amount: i === 0 ? '0' : (status === '확정' ? '300000' : null), fee_currency: 'KRW',
      fee_tax_type: i === 0 ? '지급 없음' : (status === '확정' ? '국내 사업소득' : null),
      bank_holder: has(4) ? ko : null, bank_name: has(4) ? '예시은행' : null, bank_account: has(4) ? '000-0000-0000' : null,
      reminded_at: null, hidden: '', gala_rsvp: null,
    });
    sessionSpeakers.push({
      id: `SS-T${i + 1}`, event_id: ev, session_id: sess, speaker_id: id, seq: String(i + 1),
      role: i === 5 || i === 6 ? '패널' : '연사', lang: '', duration_min: '20',
      title_ko: `${ko} 발표`, title_en: '', abstract_ko: '', abstract_en: '',
      abstract_received_at: has(2) ? at(-14) : '', slides_file: has(4) ? 'slides.pptx' : '',
      slides_received_at: has(4) ? at(-3) : '', slides_version: '', note: '', start_at: '', end_at: '',
    });
    speakerContacts.push({ id: `SC-T${i + 1}`, speaker_id: id, contact_id: String(2001 + i), name: ko,
      email: `speaker${2001 + i}@example.com`, phone: '', kind: '연사 본인', send: 'to', note: '' });
    speakerLogs.push({ id: `SL-T${i}a`, speaker_id: id, kind: 'invite', ts: at(waiting ? -9 : -30 + i),
      direction: 'out', channel: '이메일', counterpart: ko, category: '초청·가이드 발송',
      subject: `[${ev}] 연사 초청드립니다`, body: '', answered_at: '', answer: '', status: 'done',
      author_email: 'test@13100m.net', author_name: '테스트 사용자', read_at: null, read_by: null });
    if(has(1)) speakerLogs.push({ id: `SL-T${i}b`, speaker_id: id, kind: 'note', ts: at(-25 + i),
      direction: 'in', channel: '이메일', counterpart: ko, category: '회신',
      subject: 'Re: 연사 초청 — 참석하겠습니다', body: '', answered_at: '', answer: '', status: i === 3 ? 'open' : 'done',
      author_email: '', author_name: '자동 (받은메일함에서 가져옴)', read_at: i === 3 ? null : at(-24), read_by: null });
  });

  /* ── 전시 ── 8곳, 진행 정도를 섞는다 */
  const exhibitors = [];
  const exhContacts = [];
  const exhItems = [];
  const exhInvoices = [];
  const exhPayments = [];
  const exhLogs = [];
  const BOOTH = ['Block System A', 'Block System B', 'Block System A', 'Block System C',
                 'Block System A', 'Lighting Booth', 'Block System B', 'Block System A'];
  const GRADE = ['GOLD', 'Exhibitor', 'SILVER', 'Exhibitor', 'Exhibitor', 'BRONZE', 'Exhibitor', 'Exhibitor'];
  for(let i = 0; i < 8; i++){
    const id = `X-T${String(i + 1).padStart(2, '0')}`;
    const p = 7 - i;                          // 앞쪽 기업일수록 많이 진행됨
    const yes = (n) => p >= n ? 'yes' : null;
    const when = (n, d) => p >= n ? at(d) : null;
    exhibitors.push({
      id, event_id: EV, company_key: ORG_SRC[i][1].toLowerCase().replace(/[^a-z]/g, ''),
      company_name: ORG_SRC[i][0], org_id: orgs[i].id, status: '준비중', note: '', updated_at: at(-1),
      apply_order: String(i + 1), grade: GRADE[i], booth_type: BOOTH[i], booth_qty: i === 0 ? '2' : '1',
      booth_floor: '1', booth_no: String(i + 1),
      manual_sent_at: at(-28), manual_replied_at: when(1, -26),
      app_received: yes(2), app_received_at: when(2, -20), app_complete: yes(2),
      booth_confirmed: yes(3), booth_confirmed_at: when(3, -15),
      graphic_type: p >= 4 ? 'print' : null, graphic_ordered_at: when(4, -10), graphic_stage: p >= 5 ? 'replied' : '',
      directory_received: yes(5), directory_received_at: when(5, -8),
      book_name_en: ORG_SRC[i][1], book_intro: p >= 5 ? '테스트용 도록 소개문입니다.' : null,
      movein_at: null, badge_count: String(2 + (i % 3)), settled: p >= 7 ? 'yes' : null,
      pay_due_date: day(10),
    });
    exhContacts.push({ id: `XC-T${i + 1}`, exhibitor_id: id, contact_id: String(1001 + i),
      name: PEOPLE[i][0], email: `contact${1001 + i}@example.com`, phone: `010-0000-${1001 + i}`,
      role: '실무', is_primary: 'yes', note: '' });
    const boothAmt = (i === 0 ? 2 : 1) * 1300000;
    exhItems.push({ id: `XI-T${i}a`, exhibitor_id: id, category: 'booth', name: BOOTH[i],
      qty: i === 0 ? '2' : '1', unit_price: '1300000', amount: String(boothAmt), currency: 'KRW', sort_order: '1', note: null });
    exhItems.push({ id: `XI-T${i}b`, exhibitor_id: id, category: 'equip', name: 'LED TV 55',
      qty: '1', unit_price: '220000', amount: '220000', currency: 'KRW', sort_order: '2', note: null });
    if(p >= 4) exhItems.push({ id: `XI-T${i}c`, exhibitor_id: id, category: 'graphic', name: '상단 사인물',
      qty: '1', unit_price: '165000', amount: '165000', currency: 'KRW', sort_order: '3', note: null });
    const total = boothAmt + 220000 + (p >= 4 ? 165000 : 0);
    if(p >= 3){
      exhInvoices.push({ id: `XV-T${i + 1}`, exhibitor_id: id, title: `EX-${String(i + 1).padStart(2, '0')}-01`,
        created_at: at(-14), sent_at: at(-14), due_date: day(10), amount: String(total), currency: 'KRW', note: null, status: '' });
      /* 둘은 다 냈고, 하나는 반만, 나머지는 아직 — 금액 현황에 «받을 돈»이 남는다 */
      if(p >= 5) exhPayments.push({ id: `XP-T${i + 1}`, exhibitor_id: id, invoice_id: `XV-T${i + 1}`,
        paid_at: at(-5), amount: String(p >= 6 ? total : Math.round(total / 2)), method: '계좌이체', note: '',
        currency: 'KRW', kind: 'in', status: 'done' });
    }
    exhLogs.push({ id: `XL-T${i}a`, exhibitor_id: id, kind: 'exh-manual', ts: at(-28), direction: 'out',
      channel: 'email', counterpart: PEOPLE[i][0], category: '참가 매뉴얼 안내', subject: '[BIO KOREA 2026] 참가 매뉴얼 안내',
      body: '', answered_at: '', answer: '', status: 'done', author_email: 'test@13100m.net', author_name: '테스트 사용자' });
    if(i === 2 || i === 5) exhLogs.push({ id: `XL-T${i}b`, exhibitor_id: id, kind: 'inquiry', ts: at(-1, 9),
      direction: 'in', channel: 'email', counterpart: PEOPLE[i][0], category: '받은 메일',
      subject: i === 2 ? '부스 전기 용량 추가 문의드립니다' : '인보이스 재발행 요청', body: '', answered_at: null, answer: null,
      status: 'open', author_email: '', author_name: '자동 (받은메일함에서 가져옴)', read_at: null, read_by: null });
  }

  /* 지난 BIO KOREA 2025 — 4곳, 전부 끝나고 정산까지 마쳤다 */
  exhibitors.slice(0, 4).forEach((x, i) => {
    const id = `X-P${String(i + 1).padStart(2, '0')}`;
    exhibitors.push({ ...x, id, event_id: BK25, booth_no: String(i + 11), settled: 'yes',
      manual_replied_at: at(-360), app_received: 'yes', booth_confirmed: 'yes', directory_received: 'yes',
      movein_at: at(-332), pay_due_date: day(-340), updated_at: at(-320) });
    exhContacts.push({ ...exhContacts[i], id: `XC-P${i + 1}`, exhibitor_id: id });
    exhItems.filter(it => it.exhibitor_id === x.id).forEach((it, j) =>
      exhItems.push({ ...it, id: `XI-P${i}${j}`, exhibitor_id: id }));
    const total = exhItems.filter(it => it.exhibitor_id === id).reduce((a, it) => a + +it.amount, 0);
    exhInvoices.push({ id: `XV-P${i + 1}`, exhibitor_id: id, title: `EX25-${i + 1}`, created_at: at(-350),
      sent_at: at(-350), due_date: day(-340), amount: String(total), currency: 'KRW', note: null, status: '' });
    exhPayments.push({ id: `XP-P${i + 1}`, exhibitor_id: id, invoice_id: `XV-P${i + 1}`, paid_at: at(-342),
      amount: String(total), method: '계좌이체', note: '', currency: 'KRW', kind: 'in', status: 'done' });
  });

  /* ── 컨택 — TM 차수 하나, DM 차수 하나 ── */
  const rounds = [
    { id: 'R-T1', event_id: EV, name: '판촉물 업체 섭외', channel: 'TM', purpose: '이벤트 개최 안내', goal: '메일회신',
      date_from: day(-7), date_to: day(7), noanswer_limit: '3', retry_hours: '2', status: 'open', note: '',
      created_at: at(-7), created_by: 'test@13100m.net' },
    { id: 'R-T2', event_id: EV, name: '참가사 최종 안내문', channel: 'DM', purpose: '최종안내문', goal: '',
      date_from: day(-3), date_to: day(10), noanswer_limit: '1', retry_hours: null, status: 'open', note: '',
      created_at: at(-3), created_by: 'test@13100m.net' },
  ];
  const members = [];
  const attempts = [];
  const addMember = (round, oi, next_at = '', closed = '') => {
    const id = `RM-${round.id}-${oi}`;
    members.push({ id, round_id: round.id, org_id: orgs[oi].id, org_name: ORG_SRC[oi][0], source: '테스트 데이터',
      caution: '', hold_until: '', call_hours: '', next_at, goal_at: '', closed_at: closed ? day(-1) : '',
      closed_reason: closed, created_at: round.created_at, calling_by: '', calling_at: '' });
    return id;
  };
  const addAttempt = (round, mid, oi, reaction, d, note = '') => attempts.push({
    id: `CA-${mid}-${attempts.length}`, round_id: round.id, member_id: mid, org_id: orgs[oi].id,
    contact_id: String(1001 + oi), contact_name: PEOPLE[oi][0], phone: `010-0000-${1001 + oi}`,
    channel: round.channel, at: at(d, 5), by_email: 'test@13100m.net', by_name: '테스트 사용자', reaction, note });
  /* TM: 판촉 업체 4곳 + 참가사 2곳 — 처음 걸 곳, 다시 걸 곳, 끝난 곳을 섞는다 */
  const [tm, dm] = rounds;
  addMember(tm, 8);                                                     // 걸 차례
  addMember(tm, 9);                                                     // 걸 차례
  addAttempt(tm, addMember(tm, 10, day(0)), 10, 'noanswer', -1);        // 다시 걸 차례
  addAttempt(tm, addMember(tm, 11, day(3)), 11, 'hold', -2, '다음 주에 견적 보내 달라고 함');
  addAttempt(tm, addMember(tm, 6, '', '부정'), 6, 'negative', -2, '올해는 예산 없음');
  addAttempt(tm, addMember(tm, 7, day(2)), 7, 'positive', -1, '회사소개서 메일로 요청');
  /* DM: 참가사 8곳 — 절반은 보냄, 하나는 회신 */
  for(let i = 0; i < 8; i++){
    const mid = addMember(dm, i, i < 4 ? day(3) : '');
    if(i < 4) addAttempt(dm, mid, i, i === 0 ? 'reply' : 'sent', -1);
  }

  return {
    contacts, participations, events, orgs,
    crm_targets: [], activity_log: [], sectors: [], part_types: [], code_lists: [],
    /* 컨퍼런스 파트는 기본이 «안 함»이라 켜 둬야 연사 탭이 열린다 */
    settings: [
      [KIC,  { exh: 'none',  conf: 'doing' }],
      [AIA,  { exh: 'none',  conf: 'doing' }],
      [BK26, { exh: 'doing', conf: 'none', partnering: 'doing' }],
      [BK25, { exh: 'done',  conf: 'none' }],
    ].map(([ev, parts]) => ({ key: `exh_cfg_${ev}`, value: JSON.stringify({ parts }) })),
    exhibitors, exhibitor_contacts: exhContacts, exhibitor_items: exhItems, exhibitor_invoices: exhInvoices,
    exhibitor_tax_invoices: [], exhibitor_payments: exhPayments, exhibitor_logs: exhLogs, exhibitor_apps: [],
    equip_catalog: [],
    conf_sessions: sessions, speakers, session_speakers: sessionSpeakers,
    speaker_contacts: speakerContacts, speaker_logs: speakerLogs,
    watch_folders: [], watch_files: [],
    contact_rounds: rounds, round_members: members, contact_attempts: attempts,
  };
}
