/* ══════════════════════════════════════════════════════════════
   add-event-announce-mail.js — 메일 양식 보관함에 «행사 개최 안내» 양식(국/영문)

   settings key='mail_library'(state.js MAIL_LIBRARY)에 «모든 행사 공통»으로 넣는다.
   연사(conf)·전시(exh)·컨택(contact) 메일은 쓸 수 있는 칸이 달라 셋으로 넣는다(js/modules/mail-vars.js).
     conf     {호칭} {담당자}=우리 담당자
     exh      {기업} {담당자}=참가사 담당자 {보내는사람}
     contact  {기업} {담당자}=받는 사람
   행사 칸 {행사} {행사일} {장소} {주최} {주관} {주제} {홈페이지}는 셋 다 쓰고, 값은
   설정 › 행사 관리와 행사 탭 «행사 개요»에서 채워진다.
   시각·참가비·프로그램·신청 기간처럼 행사 설정에 자리가 없는 곳은 비워 두었다 — 보낼 때 채운다.
   id가 정해져 있어 다시 돌려도 같은 양식을 고쳐 쓸 뿐 겹치지 않는다.
   화면에서 누가 고친 양식(updated_by가 «스크립트»가 아님)은 덮어쓰지 않는다.

     node db/add-event-announce-mail.js          (시험 — 바꾸지 않는다)
     node db/add-event-announce-mail.js --apply
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const APPLY = process.argv.includes('--apply');

const overview_ko = `■ 행사 개요
- 행사명: {행사}
- 일시: {행사일}
- 장소: {장소}
- 주최: {주최}
- 주관: {주관}
- 주제: {주제}
- 참가비:

■ 주요 프로그램
-
-

※ 세부 프로그램은 행사 상황에 따라 바뀔 수 있습니다.

■ 참가 신청
- 신청 기간:
- 사전등록: {홈페이지}
- 사전등록자 혜택: `;

const overview_en = `Event Overview
- Event: {행사}
- Date: {행사일}
- Venue: {장소}
- Host: {주최}
- Organizer: {주관}
- Theme: {주제}
- Registration Fee:

Program Highlights
-
-

*The program is subject to change.

Registration
- Registration Period:
- Pre-registration: {홈페이지}
- Pre-registration Benefits: `;

const ITEMS = [
  {
    id: 'T-announce-conf', name: '행사 개최 안내', part: 'conf', scope: 'all',
    subject_ko: '[{행사}] 개최 안내 및 참가 신청 안내',
    body_ko: `{호칭}께

안녕하십니까. {행사} 사무국 {담당자}입니다.

{행사}을(를) 아래와 같이 개최하게 되어 안내드립니다.
귀하를 행사에 정중히 초대합니다.

${overview_ko}

■ 문의
{행사} 사무국 {담당자}

바쁘시더라도 참석하시어 자리를 빛내 주시기 바랍니다.

감사합니다.

{행사} 사무국 드림`,
    subject_en: '[{행사}] Invitation & Registration Now Open',
    body_en: `Dear {호칭},

Greetings from the {행사} Secretariat.

We are pleased to announce that {행사} will take place as outlined below. It would be our honor to welcome you to this event.

${overview_en}

Contact
{담당자}, {행사} Secretariat

We look forward to welcoming you.

Best regards,
{담당자}
{행사} Secretariat`,
  },
  {
    id: 'T-announce-exh', name: '행사 개최 안내', part: 'exh', scope: 'all',
    subject_ko: '[{행사}] 개최 안내 및 참가 신청 안내 — {기업}',
    body_ko: `{담당자}님께

안녕하십니까. {행사} 사무국입니다.

{행사}을(를) 아래와 같이 개최하게 되어 {기업}에 안내드립니다.
귀사를 행사에 정중히 초대합니다.

${overview_ko}

■ 문의
{행사} 사무국 {보내는사람}

바쁘시더라도 참석하시어 자리를 빛내 주시기 바랍니다.

감사합니다.
{행사} 사무국 {보내는사람} 드림`,
    subject_en: '[{행사}] Invitation & Registration Now Open — {기업}',
    body_en: `Dear {담당자},

Greetings from the {행사} Secretariat.

We are pleased to announce that {행사} will take place as outlined below. It would be our honor to welcome {기업} to this event.

${overview_en}

Contact
{보내는사람}, {행사} Secretariat

We look forward to welcoming you.

Best regards,
{보내는사람}
{행사} Secretariat`,
  },
  {
    id: 'T-announce-contact', name: '행사 개최 안내', part: 'contact', scope: 'all',
    subject_ko: '[{행사}] 개최 안내 및 참가 신청 안내 — {기업}',
    body_ko: `{기업} {담당자}님께

안녕하십니까. {행사} 사무국입니다.

{행사}을(를) 아래와 같이 개최하게 되어 안내드립니다.
귀사를 행사에 정중히 초대합니다.

${overview_ko}

바쁘시더라도 참석하시어 자리를 빛내 주시기 바랍니다.

감사합니다.
{행사} 사무국 드림`,
    subject_en: '[{행사}] Invitation & Registration Now Open — {기업}',
    body_en: `Dear {담당자},

Greetings from the {행사} Secretariat.

We are pleased to announce that {행사} will take place as outlined below. It would be our honor to welcome {기업} to this event.

${overview_en}

We look forward to welcoming you.

Best regards,
{행사} Secretariat`,
  },
];

async function main(){
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'mail_library'`);
  const list = rows.length ? JSON.parse(rows[0].value || '[]') : [];
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  for(const it of ITEMS){
    const rec = { ...it, updated_at: stamp, updated_by: '스크립트' };
    const i = list.findIndex(x => x.id === it.id);
    if(i >= 0 && list[i].updated_by && list[i].updated_by !== '스크립트'){
      console.log(`건너뜀: [${it.part}] ${it.name} — ${list[i].updated_by}님이 화면에서 고친 양식`); continue;
    }
    console.log(`${i < 0 ? '추가' : '고침'}: [${it.part}] ${it.name}`);
    if(i < 0) list.push(rec); else list[i] = { ...list[i], ...rec };
  }
  if(!APPLY){ console.log('\n시험 실행 — --apply로 저장합니다. 보관함 양식 수:', list.length); return; }
  if(rows.length) await pool.query(`UPDATE settings SET value = $1 WHERE key = 'mail_library'`, [JSON.stringify(list)]);
  else await pool.query(`INSERT INTO settings (key, value) VALUES ('mail_library', $1)`, [JSON.stringify(list)]);
  console.log('저장했어요. 보관함 양식 수:', list.length);
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
