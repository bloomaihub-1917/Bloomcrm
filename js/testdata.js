/* ══════════════════════════════════════════════════════════════
   testdata.js — 로컬 테스트 로그인(이름/이메일/비밀번호를 모두 "test"로
   입력) 전용 더미 데이터 로더.

   Data/ 폴더에 있는 예시 엑셀 5개를 브라우저에서 직접 fetch + XLSX로
   읽어 contacts/participations/EVENT_LIST를 채운다. 구글시트는 전혀
   건드리지 않는다 — auth.js가 테스트 세션 시작 시 GS_URL을 비워서
   이중으로 막아두므로, 이 파일이 실수로 저장 요청을 만들어도 어차피
   나가지 않는다.
═══════════════════════════════════════════════════════════════ */

import { contacts, participations, EVENT_LIST } from './state.js';
import { normalizeCat, normalizeCountry, countryName } from './utils.js';

/* catDefault는 speaker/vip/attendee 3분류만 사용 — 연사(speaker) 외에는
   전부 attendee(일반참가자)로 기본 설정한다(상세 구분은 role에만 남음). */
const FILES = [
  { name: '전시 BK2025_업로드용_신청순_250625.xlsx',   event: 'BK2025 전시',    color: '#3B5BDB', date: '2025-06', role: '전시참가기업',   catDefault: 'attendee' },
  { name: '전시 BK2026_업로드용_신청순_260601.xlsx',   event: 'BK2026 전시',    color: '#C97B0A', date: '2026-06', role: '전시참가기업',   catDefault: 'attendee' },
  { name: '컨퍼런스 BK2026_업로드용_코디초청연사.xlsx',  event: 'BK2026 컨퍼런스', color: '#16A34A', date: '2026-06', role: '연사',           catDefault: 'speaker' },
  { name: '파트너링 BK2025_업로드용_참가자리스트.xlsx',   event: 'BK2025 파트너링', color: '#6D28D9', date: '2025-06', role: '비즈니스파트너링', catDefault: 'attendee' },
  { name: '파트너링 BK2026_업로드용_DB참가자리스트.xlsx', event: 'BK2026 파트너링', color: '#0F766E', date: '2026-06', role: '비즈니스파트너링', catDefault: 'attendee' },
];

function cell(row, keys){
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') return String(row[k]).trim();
  }
  return '';
}

export async function loadTestData(){
  contacts.length = 0;
  participations.length = 0;
  EVENT_LIST.length = 0;

  let idSeq = 1;
  let partSeq = 1;

  for (const f of FILES) {
    EVENT_LIST.push({ key: f.event, short: f.event, color: f.color, date: f.date });

    let wb;
    try {
      const res = await fetch('Data/' + encodeURIComponent(f.name));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      wb = XLSX.read(buf, { type: 'array', cellText: true, cellDates: true });
    } catch (e) {
      console.warn('[testdata] 파일 로드 실패:', f.name, e);
      continue;
    }

    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

    rows.forEach(row => {
      const nameKo = cell(row, ['이름', '성명']);
      const nameEn = cell(row, ['영문이름', '영문성명']);
      if (!nameKo && !nameEn) return;

      const id = idSeq++;
      const rawCountry = cell(row, ['국가']);

      contacts.push({
        id,
        nameKo, nameEn,
        orgKo: cell(row, ['기업', '소속']),
        orgEn: cell(row, ['영문기업', '영문소속']),
        titleKo: cell(row, ['직책']),
        titleEn: cell(row, ['영문직책']),
        deptKo: cell(row, ['부서']),
        deptEn: '',
        country: rawCountry ? countryName(normalizeCountry(rawCountry)) : '',
        cat: normalizeCat(cell(row, ['카테고리'])) || f.catDefault,
        lang: nameKo ? 'KO' : 'EN',
        source: f.name + ' (테스트 더미 데이터)',
        date: new Date().toISOString().slice(0, 10),
        status: 'new',
        email1: cell(row, ['이메일']),
        email2: '',
        phone1: cell(row, ['연락처1']),
        phone2: cell(row, ['연락처2']),
        beat: cell(row, ['분야']),
        products: cell(row, ['전시품목', '취급품목']),
      });

      participations.push({
        id: 'TEST-' + (partSeq++),
        eventId: f.event,
        event: f.event,
        contactId: id,
        contact: nameKo || nameEn,
        role: f.role,
        note: '',
        matched: '✅ 테스트 데이터',
      });
    });
  }

  console.log('[testdata] 더미 데이터 로드 완료:', contacts.length, '명,', EVENT_LIST.length, '개 행사');
}
