/* CV 원본과 프로필 확장, 그리고 발제의 키워드·형식.

   받은 파일 넷을 보고 정한 것들이다.

   CV 원본(cv_file) — 두 연사 모두 CV를 PDF로 보냈는데 저장할 칸이 없었다.
   사진·발표자료·여권은 파일명 칸이 있는데 정작 제일 먼저 오는 CV가 없었다.
   4쪽짜리 CV를 칸으로 다 쪼개는 건 맞지 않는다. 프로그램북에 나가는 것만
   칸으로 두고, 나머지는 원본을 보관해 필요할 때 연다.

   프로필 확장 — 자격·강의·학회·출판은 두 CV에 모두 있었다. 프로그램북에서
   이름 옆의 «AIA · LEED AP»가 자격이고, 좌장 소개에 강의·학회가 들어간다.

   구사 언어(languages)는 lang_pref와 다르다. lang_pref는 «우리가 어느
   언어로 자료를 받나»이고, 이쪽은 «이 사람이 무슨 말을 하나»다 —
   통역을 붙일지 정할 때 보는 값이다.

   발제의 키워드·형식·라운드테이블 주제는 배정 줄에 붙는다. 한 사람이 두
   세션에서 발표하면 키워드도 형식도 다르다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SPEAKER_COLS = [
  ['cv_file',             'CV 원본 파일명'],
  ['cv_received_at',      'CV 받은 날'],
  ['bio_credentials_ko',  '자격·면허 국문'],
  ['bio_credentials_en',  '자격·면허 영문'],
  ['bio_teaching_ko',     '강의·교육 국문'],
  ['bio_teaching_en',     '강의·교육 영문'],
  ['bio_affil_ko',        '학회·공직 국문'],
  ['bio_affil_en',        '학회·공직 영문'],
  ['bio_pubs_ko',         '출판·전시 국문'],
  ['bio_pubs_en',         '출판·전시 영문'],
  ['languages',           '구사 언어'],
];
const ASSIGN_COLS = [
  ['keywords',   '발제 키워드'],
  ['talk_format', '발표 형식'],
  ['discussion', '라운드테이블 논의 주제'],
];

(async () => {
  for (const [c, label] of SPEAKER_COLS) {
    await pool.query(`ALTER TABLE speakers ADD COLUMN IF NOT EXISTS ${c} TEXT`);
    console.log(`✓ speakers.${c} — ${label}`);
  }
  for (const [c, label] of ASSIGN_COLS) {
    await pool.query(`ALTER TABLE session_speakers ADD COLUMN IF NOT EXISTS ${c} TEXT`);
    console.log(`✓ session_speakers.${c} — ${label}`);
  }
  const a = await pool.query(`select count(*) n from information_schema.columns where table_name='speakers'`);
  const b = await pool.query(`select count(*) n from information_schema.columns where table_name='session_speakers'`);
  console.log(`\nspeakers ${a.rows[0].n}열 · session_speakers ${b.rows[0].n}열`);
  await pool.end();
})();
