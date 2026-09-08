/* ══════════════════════════════════════════════════════════════
   seed-sectors.js — 섹터 표준 목록을 심는다

   지금까지 섹터는 자유 입력이었다. 그래서 'IT Solution'과 'IT Soultion'(오타)이
   서로 다른 분류로 살아 있고, 'CRO, Lab, CDMO'처럼 세 업종이 한 문자열에
   들어가 있으며, 74곳 중 22곳은 아예 비어 있었다. 무엇보다 화면의 섹터 트리는
   코드에 박혀 있던 BIO KOREA용 16종(글로벌 제약사·VC·Embassy…)이라
   저장된 값과 단 하나도 맞지 않았다 — 섹터 필터가 사실상 죽어 있었다.

   그래서 목록을 sectors 표에 실제로 심는다. 화면(기업DB 섹터 선택 팝오버,
   설정 › 섹터 트리)이 이미 이 표를 읽으므로 새 화면을 만들 필요가 없고,
   나중에 업종이 늘어도 설정에서 한 줄 추가하면 된다.

   분야(domain)로 한 겹 묶는다. 우리가 하는 행사가 두 갈래이기 때문이다 —
   바이오·임상 행사(KIC·BIO KOREA)에서 만나는 회사와 이벤트 산업 행사
   (EVENTKOREA)에서 만나는 회사는 업종 목록이 아예 다르다. 한 줄로 늘어놓으면
   KIC 참가사를 등록하다 '무대·음향·조명'을 지나쳐야 한다.

   이미 있는 id는 건드리지 않는다 — 사람이 설정에서 이름을 고쳐 뒀을 수 있다.

     node db/seed-sectors.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

/* 분야 — settings.domains(JSON)에 담긴다. 섹터의 domain 컬럼이 이 id를 가리킨다. */
const DOMAINS = [
  { id: 'bio',    name: '바이오·임상' },
  { id: 'mice',   name: '이벤트·MICE' },
  { id: 'common', name: '공통' },
];

/* 섹터 — name이 곧 저장되는 값이다(orgs.sectors는 이름을 이어 붙인다).
   그래서 이름은 짧게 둔다. 세부 성격(GCLP 인증, Imaging 전문 등)은 섹터를
   쪼개지 않고 orgs.notes에 적는다 — 쪼개면 'Lab CRO (GCLP-compliant)' 같은
   1곳짜리 분류가 다시 늘어난다. */
const SECTORS = [
  // ── 바이오·임상 ──
  { id: 'cro',      name: 'CRO',             domain: 'bio' },
  { id: 'smo',      name: 'SMO',             domain: 'bio' },
  { id: 'lab',      name: '분석·중앙실험실',  domain: 'bio' },
  { id: 'cdmo',     name: 'CDMO',            domain: 'bio' },
  { id: 'pharma',   name: '제약·바이오텍',    domain: 'bio' },
  { id: 'ctit',     name: '임상 IT·데이터',   domain: 'bio' },
  { id: 'img',      name: '영상·이미징',      domain: 'bio' },
  { id: 'hosp',     name: '의료기관',         domain: 'bio' },
  { id: 'reg',      name: '규제·컨설팅',      domain: 'bio' },

  // ── 이벤트·MICE ──
  // 아직 등록된 기업이 없다. EVENTKOREA처럼 동종업계와 만나는 행사에서
  // 참가사를 넣기 시작하면 채워진다 — 목록이 먼저 있어야 '기타'로 안 떨어진다.
  { id: 'booth',    name: '부스시공·전시장치', domain: 'mice' },
  { id: 'av',       name: '무대·음향·조명',    domain: 'mice' },
  { id: 'rental',   name: '렌탈·비품',        domain: 'mice' },
  { id: 'sign',     name: '그래픽·인쇄',      domain: 'mice' },
  { id: 'agency',   name: '행사대행(PCO)',    domain: 'mice' },
  { id: 'venue',    name: '전시장·컨벤션',    domain: 'mice' },
  { id: 'staff',    name: '인력·의전',        domain: 'mice' },
  { id: 'micetech', name: 'MICE 솔루션',      domain: 'mice' },

  // ── 공통 ── 어느 행사에서도 나오는 자리
  { id: 'gov',      name: '정부·공공기관',    domain: 'common' },
  { id: 'assoc',    name: '학회·협회',        domain: 'common' },
  { id: 'acad',     name: '대학·연구소',      domain: 'common' },
  { id: 'invest',   name: '투자·금융',        domain: 'common' },
  { id: 'media',    name: '미디어',           domain: 'common' },
  { id: 'etc',      name: '기타',             domain: 'common' },
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const have = new Set((await client.query('SELECT id FROM sectors')).rows.map((r) => r.id));
    const add = SECTORS.filter((s) => !have.has(s.id));
    const skip = SECTORS.filter((s) => have.has(s.id));

    for (const s of add) {
      await client.query(
        `INSERT INTO sectors (id, name, parent, domain, canonical) VALUES ($1, $2, '', $3, '')`,
        [s.id, s.name, s.domain]);
    }

    /* 분야 목록은 통째로 갈아 끼운다 — 세 갈래뿐이고, 섹터가 이 id를 가리키므로
       사람이 여기를 고칠 일은 거의 없다. */
    await client.query(
      `INSERT INTO settings (key, value) VALUES ('domains', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(DOMAINS)]);

    console.log(`분야 ${DOMAINS.length}개 저장`);
    console.log(`섹터 ${add.length}개 추가${skip.length ? ` · 이미 있어 건너뜀 ${skip.length}개` : ''}`);
    DOMAINS.forEach((d) => {
      const mine = SECTORS.filter((s) => s.domain === d.id);
      console.log(`   ${d.name.padEnd(12)} ${mine.map((s) => s.name).join(' · ')}`);
    });

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
