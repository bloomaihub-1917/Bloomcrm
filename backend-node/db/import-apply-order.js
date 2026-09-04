/* ══════════════════════════════════════════════════════════════
   import-apply-order.js — 신청순 번호를 넣는다

   참가 신청을 받은 순서다. 프로그램북 순번(book_order)과 값이 겹치는 구간이
   많지만 같은 것이 아니다. 도록 번호는 지면 사정으로 바뀌고(서울대·분당서울대를
   44/45로 나눈 것처럼), 신청순은 사실 기록이라 바뀌지 않는다.

   목록에 부스 번호와 등급이 함께 적혀 있어 대조에 쓴다. 이름으로 짝을 지은 뒤
   부스·등급이 다르면 멈춘다 — 이름이 비슷해 엉뚱한 기업에 번호를 박는 것보다
   멈추고 묻는 편이 낫다.

     node db/import-apply-order.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EVENT = '2026 KIC';

/* [신청순, 부스No, 등급, 기업명(국문)] — 붙여받은 목록 그대로 */
const ROWS = [
  [1, '21', 'DIA', '셀타스퀘어'], [2, '20', 'GOLD', '에이씨엠글로벌래버러토리스'],
  [3, '44', 'GOLD', '㈜씨엔알리서치'], [4, '10', 'GOLD', '드림씨아이에스'],
  [5, '47', 'SILVER', '랩콥'], [6, '33', 'SILVER', '오피스'],
  [7, '19', 'BRONZE', '노보텍'], [8, '17', 'BRONZE', '페니트리움 바이오사이언스'],
  [9, '23', 'BRONZE', '에스씨엘헬스케어'], [10, '51', 'Exhibitor', '애크메드'],
  [11, '50', 'Exhibitor', '알막 그룹'], [12, '36', 'Exhibitor', '츌립앤사이언스 씨알오(CRO) 센터'],
  [13, '54', 'Exhibitor', '오리곤 랩스 리미티드'], [14, '25', 'Exhibitor', '㈜브레디스헬스케어'],
  [15, '53', 'Exhibitor', '㈜비엑스플랜트'], [16, '15', 'Exhibitor', '카탈란트'],
  [17, '35', 'Exhibitor', '서타라코리아 유한회사'], [18, '24', 'Exhibitor', '클라리오'],
  [19, '30', 'Exhibitor', '클립스비엔씨'], [20, '1', 'Exhibitor', '시믹코리아'],
  [21, '49', 'Exhibitor', '주식회사 단테비전'], [22, '5', 'Exhibitor', '데이터포라이프'],
  [23, '13', 'Exhibitor', '포트리아 코리아 유한회사'], [24, '34', 'Exhibitor', '프론티지'],
  [25, '2', 'Exhibitor', '㈜지씨씨엘'], [26, '57', 'Exhibitor', 'HLB바이오스텝㈜'],
  [27, '32', 'Exhibitor', '헝가로트라이얼'], [28, '26', 'Exhibitor', '제이앤피메디'],
  [29, '40', 'Exhibitor', '카카오헬스케어'], [30, '7', 'Exhibitor', '㈜엘에스케이글로벌파마서비스'],
  // 목록은 '메디안 테크놀로지', DB는 '메디안 메디컬 테크놀로지' — 부스 6으로 같은 곳이다
  [31, '6', 'Exhibitor', '메디안 메디컬 테크놀로지'],
  [32, '48', 'Exhibitor', '메디데이터'], [33, '9', 'Exhibitor', '메디라마'],
  [34, '29', 'Exhibitor', '메드페이스'], [35, '3', 'Exhibitor', '메리트 씨알오'],
  [36, '58', 'Exhibitor', '나눔스페이스'], [37, '52', 'Exhibitor', '뉴로핏'],
  [38, '28', 'Exhibitor', '한국넥스트로브 유한회사'], [39, '56', 'Exhibitor', '오라클'],
  [40, '42', 'Exhibitor', '파렉셀'], [41, '31', 'Exhibitor', '퍼셉티브'],
  [42, '55', 'Exhibitor', '프리시전 포 메디슨'], [43, '16', 'Exhibitor', '피에스아이 씨알오'],
  [44, '39', 'Exhibitor', '서울대학교병원'], [45, '59', 'Exhibitor', '스마트임상시험신기술개발연구사업단'],
  [46, '37', 'Exhibitor', '㈜심유'], [47, '12', 'Exhibitor', '시네오스 헬스'],
  [48, '4', 'Exhibitor', '타이메이 테크놀로지'], [49, '8', 'Exhibitor', '써모 피셔 사이언티픽'],
  [50, '38', 'Exhibitor', '유투엑스랩'],
];

const sq = (v) => String(v || '').toLowerCase()
  .replace(/\(주\)|\(유\)|주식회사|㈜|유한회사|inc\.?|corp\.?|co\.?|ltd\.?|llc\.?/g, '')
  .replace(/[^a-z0-9가-힣]/g, '');

(async () => {
  const client = await pool.connect();
  try {
    const { rows: ex } = await client.query(
      'SELECT id, company_name, booth_no, grade, apply_order, status FROM exhibitors WHERE event_id = $1',
      [EVENT]);

    const plan = [], problems = [];
    for (const [no, booth, grade, ko] of ROWS) {
      const hit = ex.filter((e) => sq(e.company_name) === sq(ko));
      if (hit.length !== 1) { problems.push(`${no} ${ko} — ${hit.length ? '후보 ' + hit.length + '곳' : '못 찾음'}`); continue; }
      const e = hit[0];
      // 부스·등급으로 한 번 더 확인한다. 부스 번호는 연속 부스면 '10-11'처럼
      // 적혀 있어 앞 번호만 견준다.
      const first = String(e.booth_no || '').split('-')[0].trim();
      if (first !== booth) { problems.push(`${no} ${ko} — 부스가 다름 (DB ${e.booth_no} / 목록 ${booth})`); continue; }
      if (String(e.grade || '') !== grade) { problems.push(`${no} ${ko} — 등급이 다름 (DB ${e.grade || '없음'} / 목록 ${grade})`); continue; }
      plan.push({ id: e.id, no: String(no), name: e.company_name, was: e.apply_order || '' });
    }

    console.log(`목록 ${ROWS.length}곳 · 참가기업 ${ex.length}곳\n`);
    if (problems.length) {
      console.log('■ 짝을 못 지음 — 넣지 않는다');
      problems.forEach((p) => console.log('   ' + p));
      console.log();
    }
    console.log(`■ 넣을 곳 ${plan.length}곳`);
    plan.forEach((p) => console.log(`   ${p.no.padStart(3)} ${p.name}${p.was ? `  (기존 ${p.was})` : ''}`));

    const got = new Set(plan.map((p) => p.id));
    const none = ex.filter((e) => !got.has(e.id));
    console.log(`\n■ 신청순이 안 붙는 곳 ${none.length}곳`);
    none.forEach((e) => console.log(`   ${e.company_name} — ${e.status === '취소' ? '취소' : '목록에 없음'} (부스 ${e.booth_no || '-'})`));

    if (DRY) { console.log('\n--dry 라서 아무것도 바꾸지 않았습니다.'); return; }
    if (problems.length) { console.log('\n짝을 못 지은 곳이 있어 멈춥니다. 위 목록을 확인해주세요.'); return; }

    await client.query('BEGIN');
    for (const p of plan) {
      await client.query('UPDATE exhibitors SET apply_order = $1 WHERE id = $2', [p.no, p.id]);
    }
    await client.query('COMMIT');
    console.log(`\n반영 완료 — ${plan.length}곳에 신청순을 넣었습니다.`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
