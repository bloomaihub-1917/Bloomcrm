/* ══════════════════════════════════════════════════════════════
   set-kpbma-invite-mail.js — 2026 바이오 상생교류회 «초청·가이드 발송» 기본 본문

   사무국이 실제로 쓰는 문구로 바꾼다(2026-10-06 요청). 행사 설정
   exh_cfg_<행사>.conf.flow.invite.body_ko에 넣는다 — 화면에서는
   설정 › 행사 관리 › 컨퍼런스 › 연사 연락 순서에서 그대로 보이고 고칠 수 있다.
   사람마다 바뀌는 곳만 변수로 둔다: {호칭} {담당자} {행사} {발표시간}

     node db/set-kpbma-invite-mail.js          (시험 — 바꾸지 않는다)
     node db/set-kpbma-invite-mail.js --apply
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const EV = '2026 KPBMA';
const KEY = `exh_cfg_${EV}`;
const APPLY = process.argv.includes('--apply');

const BODY = `{호칭}께

안녕하십니까. {행사} 사무국 {담당자}입니다.
연사로 참여하시는 [{행사}] 관련하여 안내 말씀을 드립니다.

■ 행사 개요
    - 행사명 : {행사}
    - 행사일 : 2026년 10월 27일
    - 장소 : 한국제약바이오협회 4층
    - 주요 프로그램 : 세미나, 네트워킹 만찬

■ 발표 시간
    {발표시간}

■ 제출 자료


발표자료 관련한 상세 내용과 제출하셔야하는 자료는 첨부된 자료를 확인하여주시기 바랍니다.

촉박한 일정으로 발표 자료 준비를 요청 드려 송구한 마음이 앞섭니다. 너그러운 마음으로 양해해주시기 바랍니다.

본 행사 사전 홍보를 위하여 제출 주실 자료 중 별첨 1번을 우선적으로 요청 드립니다.
정확한 소속, 직책, 발표제목과 사진을 우선적으로 제출 부탁 드립니다.

본행사와 관련하여 추가적으로 궁금하신 부분이 있으시다면, 언제든지 사무국으로 문의 주시기 바랍니다.

감사합니다.

{행사} 사무국 드림`;

async function main(){
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [KEY]);
  if(!rows.length) throw new Error(`${KEY} 설정이 없어요`);
  const cfg = JSON.parse(rows[0].value || '{}');
  cfg.conf = cfg.conf || {};
  cfg.conf.flow = cfg.conf.flow || {};
  const prev = cfg.conf.flow.invite || {};
  console.log('지금 invite 덮어쓰기:', JSON.stringify(prev));
  cfg.conf.flow.invite = { ...prev, body_ko: BODY };
  if(!APPLY){ console.log('\n시험 실행 — --apply로 저장합니다.\n\n' + BODY); return; }
  await pool.query('UPDATE settings SET value = $1 WHERE key = $2', [JSON.stringify(cfg), KEY]);
  console.log('저장했어요. 이전 값:', JSON.stringify(prev));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
