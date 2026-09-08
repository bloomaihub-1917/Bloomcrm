/* ══════════════════════════════════════════════════════════════
   map-org-sectors.js — 기업 74곳의 업종을 표준값으로 옮긴다

   seed-sectors.js가 심은 목록으로 값을 갈아 끼운다. 규칙은 둘이다.

   1) 지금 적혀 있는 값으로 옮긴다(BY_VALUE). 'IT Soultion'(오타)과
      'IT Solution'이 한 자리로 합쳐지고, 'CRO, Lab, CDMO'처럼 한 문자열에
      뭉쳐 있던 것은 세 섹터로 나뉜다. 구분자도 파이프(|)로 통일한다 —
      화면(parseSectors)이 그 형식을 읽는다.
   2) 비어 있는 곳은 이름으로 채운다(BY_NAME). 회사 이름에 CRO·LAB·SMO가
      그대로 들어 있는 곳이 많아 대부분 확정된다.

   무엇으로도 판단이 안 서는 곳은 비워 둔다. 이름만으로 CRO인지 IT인지
   진단인지 갈리는 회사를 찍어서 넣으면, 나중에 그 값이 맞는 줄 알고 아무도
   다시 안 본다. 비어 있으면 기업DB에서 '미분류'로 눈에 띈다.

   같은 값을 두 곳이 들고 있다(orgs.sectors · contacts.beat). 32건이 어긋나
   있어 함께 맞춘다. companies.sector도 같은 값을 들고 있었지만 그 표는
   동결했다 — 처음 돌릴 때 한 번 맞춰 두었고, 이후로는 건드리지 않는다.

     node db/map-org-sectors.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

const CRO = 'CRO', SMO = 'SMO', LAB = '분석·중앙실험실', CDMO = 'CDMO';
const PHARMA = '제약·바이오텍', CTIT = '임상 IT·데이터', IMG = '영상·이미징';
const HOSP = '의료기관', REG = '규제·컨설팅', ACAD = '대학·연구소';

/* seed-sectors.js가 심은 이름들 — 이미 표준값인 줄을 알아보는 데 쓴다.
   두 번 돌려도 "바뀐 곳 0"이 나와야 나중에 사람이 안심하고 다시 돌린다. */
const STANDARD = [CRO, SMO, LAB, CDMO, PHARMA, CTIT, IMG, HOSP, REG, ACAD];

/* 지금 적혀 있는 값 → 표준 섹터 */
const BY_VALUE = {
  'CRO':                          [CRO],
  'CRO / IT Solution':            [CRO, CTIT],
  'CRO, IT Solution':             [CRO, CTIT],
  'CRO, Lab, CDMO':               [CRO, LAB, CDMO],
  'CDRO':                         [CRO, CDMO],   // CDMO+CRO 결합 표기
  'CDMO':                         [CDMO],
  'Central Laboratory':           [LAB],
  'Laboratory Service':           [LAB],
  'Lab':                          [LAB],
  'Lab CRO (Central Laboratory)': [CRO, LAB],
  'Lab CRO (GCLP-compliant)':     [CRO, LAB],
  'Imaging CRO':                  [CRO, IMG],
  'RWE CRO':                      [CRO, CTIT],
  'IT Solution':                  [CTIT],
  'IT Soultion':                  [CTIT],        // 오타 — 같은 자리로 합친다
  'IT Soultion / Non-Profit':     [CTIT],
  'Digital Endpoint Company':     [CTIT],
  'Technology Vendor':            [CTIT],
  'Biotech':                      [PHARMA],
  'Hospital':                     [HOSP],
  'Consulting':                   [REG],
  '사업단':                        [ACAD],
};

/* 비어 있는 곳 — 회사 이름으로 확정되는 것만 */
const BY_NAME = {
  'RARAS CRO':                                [CRO],
  'Pharmaron Korea':                          [CRO, CDMO],
  'Linical Korea':                            [CRO],
  'Harvest Integrated Research Organization (HiRO)': [CRO],
  'C&R SMO Inc.':                             [SMO],
  'EONE LABORATORIES':                        [LAB],
  'IQVIA Korea':                              [CRO, CTIT],
  '일동제약 주식회사':                          [PHARMA],
  'MedDRA MSSO':                              [REG],
  'RWS Korea':                                [REG],
  'QuantifiCare':                             [IMG],
  'TI Image Pte. Ltd.':                       [IMG],
  'Trial Informatics Inc.':                   [IMG],
  'InHandPlus':                               [CTIT],
  'Caresquare Inc.':                          [CTIT],
  'Bioforum - The Data Masters':              [CTIT],
};

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orgs = (await client.query(
      `SELECT id, name_ko, name_en, coalesce(sectors,'') sectors FROM orgs ORDER BY name_ko`)).rows;

    const done = [];    // 바뀐 것
    const kept = [];    // 판단이 안 서서 비워 둔 것
    const same = [];    // 이미 표준값인 것

    for (const o of orgs) {
      const cur = o.sectors.trim();
      const byName = BY_NAME[o.name_en] || BY_NAME[o.name_ko];
      const mapped = cur ? BY_VALUE[cur] : byName;

      if (!mapped) {
        // 이미 표준 이름이면 그대로 둔다(두 번 돌려도 안전하다)
        if (cur && cur.split('|').every((v) => STANDARD.includes(v.trim()))) {
          same.push(o); continue;
        }
        kept.push(o); continue;
      }

      const next = mapped.join('|');
      if (next === cur) { same.push(o); continue; }

      await client.query(`UPDATE orgs SET sectors = $2, updated_at = $3 WHERE id = $1`,
        [o.id, next, new Date().toISOString().slice(0, 10)]);

      /* 연락처도 같은 값을 들고 있다 — 한 곳만 고치면 화면에 따라 다른 업종이
         보인다. companies는 동결해서 빼 두었다(routes/data.js 주석 참고). */
      await client.query(`UPDATE contacts SET beat = $2 WHERE org_id = $1`, [o.id, next]);

      done.push({ o, from: cur || '(빈값)', to: next });
    }

    console.log(`\n바뀐 기업 ${done.length}곳`);
    done.forEach(({ o, from, to }) =>
      console.log(`   ${(o.name_ko || o.name_en || '').slice(0, 26).padEnd(28)} ${from}  →  ${to}`));

    /* 값이 안 바뀐 기업이라도 연락처 쪽 칸이 비어 있는 일이 있다 — 기업에는
       'CRO'가 적혀 있는데 그 회사 사람 16명은 업종이 비어 있었다. 채워 둔다
       (사람에게 따로 적어 둔 값이 있으면 손대지 않는다). */
    const filled = await client.query(
      `UPDATE contacts c SET beat = o.sectors FROM orgs o
        WHERE o.id = c.org_id AND coalesce(c.beat,'') = '' AND coalesce(o.sectors,'') <> ''`);

    console.log(`\n이미 표준값 ${same.length}곳 · 연락처 업종 채움 ${filled.rowCount}명`);

    console.log(`\n비워 둔 기업 ${kept.length}곳 — 무슨 회사인지 확인되면 기업DB에서 골라 주세요`);
    kept.forEach((o) => console.log(`   ${(o.name_ko || o.name_en || '')}`));

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
