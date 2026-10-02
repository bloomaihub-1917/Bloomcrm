/* KIC 연사 계좌 양식(Appendix 4 Bank Information Form)에 맞춰 계좌 칸을 늘린다.

   양식은 받는 사람의 주소·우편번호, 지점, ABA인지 IBAN인지, 나라별 은행 코드
   (영국 Sort Code · 호주 BSB · 캐나다 CC), 비고를 따로 받는다. 전에는 칸이 없어
   비고에 섞어 적거나 빠뜨렸다 — 송금은 하나라도 빠지면 되돌아온다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COLS = [
  ['bank_holder_address', '예금주 주소'],
  ['bank_holder_postal',  '예금주 우편번호'],
  ['bank_branch',         '지점'],
  ['bank_iban_kind',      "ABA·IBAN 구분 — 'ABA' | 'IBAN' | ''"],
  ['bank_code',           '은행 코드 (Sort Code · BSB · CC)'],
  ['bank_note',           '계좌 비고'],
  ['bank_first_name',     'First Name (여권 표기)'],
  ['bank_last_name',      'Last Name (여권 표기)'],
  ['bank_form_file',      '받은 Word 양식 파일명'],
  ['bank_form_received_at', 'Word 양식 받은 날'],
  ['id_card_file',        '신분증 파일명 (국내 연사)'],
  ['id_card_received_at', '신분증 받은 날'],
  ['bankbook_file',       '통장사본 파일명 (국내 연사)'],
  ['bankbook_received_at', '통장사본 받은 날'],
];

(async () => {
  for (const [c, label] of COLS) {
    await pool.query(`ALTER TABLE speakers ADD COLUMN IF NOT EXISTS ${c} TEXT`);
    console.log(`✓ speakers.${c} — ${label}`);
  }
  await pool.end();
})();
