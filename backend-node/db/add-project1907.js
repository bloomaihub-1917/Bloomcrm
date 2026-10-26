/* ══════════════════════════════════════════════════════════════
   add-project1907.js — 친환경 현수막 업체 project 1907을 벤더로 올린다

   (주)세상에없는세상은 셀러 명단으로 «잠재고객사»에 먼저 들어와 있었다.
   2026-10-26 친환경 현수막 소개서·견적을 받았다 — 우리가 사서 쓰는 쪽이므로
   벤더시공사로 바꾸고, 메일을 보낸 방주헌 대리를 담당자로 넣는다.

   여러 번 돌려도 된다 — 빈 칸만 채우고, 있는 사람은 다시 넣지 않는다.

     node db/add-project1907.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');
const { contactIdAllocator } = require('./contact-ids');

const DRY = process.argv.includes('--dry');
const ORG_ID = 'O-1789540571879_117';
const SOURCE = '메일 2026-10-26 친환경 현수막 소개서';
const NOTE = '친환경 현수막(폐페트병 리사이클+생분해 «리앤생» 소재, 환경표지·재생PET·오코텍스·GRS 인증). '
  + '현수막 전 사이즈 제작, X배너 1매 16,000원(실내 X배너 거치대/실외 물통 거치대 선택). '
  + '소개서·견적 2026-10-26 수신 — 2026 친환경대전 ESG 박람회에서 만남.';
/* 첨부 PDF 두 개(현수막 소개서·리앤생 소재 소개 자료)를 읽고 줄인 것 */
const INTRO = [
  '■ 회사: 사회적기업 (주)세상에없는세상의 업사이클링 브랜드 project 1907. 서울시 우수 사회적기업(공공기관 우선구매 대상), 2023 SVI 최고등급 «탁월».',
  '■ 소재 «리앤생(Re&生)»: 국내산 폐페트병 100% 리사이클 + 생분해 원단(에코엔). 생분해 2~3년(일반 현수막 500년+), 탄소 배출 약 70~75% 절감, 2022 행안부 공식 권장 소재. 인증 — 환경표지(녹색구매 실적 인정)·오코텍스·GRS·재생PET, FITI 생분해 성적서.',
  '■ 가격(VAT 별도 여부 확인 필요): 현수막 5,000×900mm 37,000원 / 6,000×700mm 31,000원, 배너 600×1,800mm 16,000원(실내·실외 거치대 추가). 규격 외 대형·소형 모두 제작.',
  '■ 후가공·서비스: 열재단·사방타공 무료, 큐방·원봉·각목·족자마감 가능. 디자인 의뢰, 설치·철거 인력, 사용 후 수거(자원화 — 자동차 내장재 등)까지 원스톱. LCA 기반 제작건별 탄소 절감 리포트 제공.',
  '■ 할인: 업무 협약 5%, 대량 발주 시 최대 10%.',
  '■ 문의: 070-4408-8299(평일 10~17시), 1907eco@gmail.com, 현수막 전용 1907banner@gmail.com, 인스타 @project1907_official.',
].join('\n');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const org = (await client.query(`SELECT * FROM orgs WHERE id = $1`, [ORG_ID])).rows[0];
    if (!org) throw new Error(`${ORG_ID} 기업이 없습니다`);
    const today = new Date().toISOString().slice(0, 10);

    const aliases = String(org.aliases || '').split('\n').filter(Boolean);
    for (const a of ['project 1907', '프로젝트1907']) if (!aliases.includes(a)) aliases.push(a);
    const sectors = String(org.sectors || '').split('|').filter(Boolean);
    if (!sectors.includes('인쇄/출력')) sectors.push('인쇄/출력');
    const patch = {
      kind: '벤더시공사',
      abbr: 'project 1907',          // 예전 업로드에서 «(주»로 잘려 들어와 있었다
      aliases: aliases.join('\n'),
      sectors: sectors.join('|'),
      phone: org.phone || '070-4408-8299',
      email: org.email || '1907eco@gmail.com',
      address: org.address || '서울시 영등포구 선유로 130 에이스하이테크시티 3차 1105호',
      website: 'www.project1907.com',
      notes: String(org.notes || '').includes('리앤생') ? org.notes : [org.notes, NOTE].filter(Boolean).join('\n'),
    };
    if (!org.intro) patch.intro = INTRO;
    const cols = Object.keys(patch);
    if (!DRY) await client.query(
      `UPDATE orgs SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ')}, updated_at = $${cols.length + 2} WHERE id = $1`,
      [ORG_ID, ...cols.map((c) => patch[c]), today]);
    console.log('기업 갱신:', patch);

    const dup = (await client.query(
      `SELECT id FROM contacts WHERE org_id = $1 AND "nameKo" = '방주헌'`, [ORG_ID])).rows[0];
    if (dup) console.log('방주헌 대리는 이미 있습니다 —', dup.id);
    else {
      const cid = (await contactIdAllocator(client))();
      if (!DRY) await client.query(
        `INSERT INTO contacts (id, "nameKo", "orgKo", "titleKo", country, cat, lang, source, date, status,
                               email1, phone1, beat, org_id)
         VALUES ($1, '방주헌', $2, '대리', '대한민국', '', 'KO', $3, $4, 'new',
                 '1907eco@gmail.com', '070-4408-8299', '인쇄/출력', $5)`,
        [cid, org.name_ko, SOURCE, today, ORG_ID]);
      console.log('새 연락처: 방주헌 대리', cid, `(${String(cid).length}자리)`);
    }

    if (DRY) { await client.query('ROLLBACK'); console.log('\n--dry 라서 되돌렸습니다.'); }
    else { await client.query('COMMIT'); console.log('\n반영 완료.'); }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end?.();
  }
})();
