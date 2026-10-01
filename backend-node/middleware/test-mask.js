/* ══════════════════════════════════════════
   시험 계정 가리기

   시험 계정(기본 test@13100m.net)으로 들어오면 기업명·사람 이름은 앞 두 글자만
   남기고(애크메드 → 애크**), 연락처·계좌·메모처럼 개인정보는 통째로 가린다.
   화면에서 가리면 개발자 도구로 원본이 보이므로 서버에서 내보내기 전에 가린다.

   시험 계정은 읽기만 한다. 가린 값을 보고 저장하면 «애크**»가 진짜 값을
   덮어쓰기 때문이다 — data.js·mail.js가 쓰기를 막는다.

     TEST_ACCOUNTS  시험 계정 이메일, 쉼표로 여럿. 비우면 test@<허용 도메인>.
══════════════════════════════════════════ */
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || '@13100m.net';

function testAccounts() {
  const raw = process.env.TEST_ACCOUNTS || `test${ALLOWED_DOMAIN}`;
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
const isTestAccount = (email) => testAccounts().includes(String(email || '').toLowerCase());

// 앞 두 글자만 남긴다 — 한글·이모지도 한 글자로 센다
function keep2(v) {
  if (v === null || v === undefined || v === '') return v;
  const chars = Array.from(String(v));
  if (chars.length <= 2) return chars[0] + '*'.repeat(chars.length - 1);
  return chars.slice(0, 2).join('') + '*'.repeat(chars.length - 2);
}
// 통째로 가린다 — 값이 있었다는 것만 보인다
const hide = (v) => (v === null || v === undefined || v === '' ? v : '***');

/* 표별로 가릴 칸. N = 앞 두 글자, H = 통째로.
   id·날짜·상태·금액처럼 화면이 연결·계산에 쓰는 칸은 그대로 둔다. */
const N = 'keep2', H = 'hide';
const RULES = {
  contacts: {
    nameKo: N, nameEn: N, orgKo: N, orgEn: N,
    email1: H, email2: H, phone1: H, phone2: H, memo1: H, memo2: H, memo3: H,
  },
  participations: { 소속: N, 성명: N },
  orgs: {
    name_ko: N, name_en: N, abbr: N, aliases: N,
    website: H, biz_no: H, phone: H, email: H, address: H, notes: H,
  },
  crm_targets: { name: N, nameEn: N, log: H },
  activity_log: { target: N, detail: H },
  exhibitors: {
    company_key: N, company_name: N, fascia_name: N, book_name_ko: N, book_name_en: N,
    note: H, settled_note: H, onsite_note: H, base_note: H, directory_note: H,
    tax_contact_name: N, tax_contact_email: H, tax_contact_phone: H,
    book_address: H, book_phone: H, book_website: H,
    builder: N, builder_contact: N, builder_tel: H, builder_mobile: H, builder_email: H,
  },
  exhibitor_contacts: { name: N, email: H, phone: H, note: H },
  exhibitor_logs: { counterpart: N, subject: H, body: H, answer: H },
  exhibitor_apps: { file_name: H, summary: H, note: H },
  exhibitor_invoices: { title: N },
  exhibitor_tax_invoices: { title: N },
  speakers: {
    name_snapshot: N, name_en: N, org_ko: N, org_en: N, note: H,
    cv_file: H, photo_file: H, consent_file: H, passport_file: H,
    stay_hotel: H, air_in_flight: H, air_out_flight: H, air_route: H,
    bank_holder: H, bank_name: H, bank_account: H, bank_swift: H, bank_iban: H, bank_address: H,
  },
  speaker_contacts: { name: N, email: H, phone: H, note: H },
  speaker_logs: { counterpart: N, subject: H, body: H, answer: H },
};

function maskRows(sheet, rows) {
  const rule = RULES[sheet];
  if (!rule || !Array.isArray(rows)) return rows;
  return rows.map((r) => {
    const out = { ...r };
    Object.entries(rule).forEach(([col, how]) => {
      if (col in out) out[col] = how === N ? keep2(out[col]) : hide(out[col]);
    });
    return out;
  });
}

module.exports = { isTestAccount, maskRows };
