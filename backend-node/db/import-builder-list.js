/* ══════════════════════════════════════════════════════════════
   import-builder-list.js — 다른 행사에서 모은 시공사 명단을 기업 DB에 올린다

   import-builders.js는 이번 행사 참가기업 행에 적힌 시공사를 올린다. 이건
   그 밖에서 받아 둔 명단(지난 행사 독립부스 시공 담당 업체 정보)이다.
   원본은 같은 회사가 표기만 바꿔 여러 번 나온다 — 이지텍 인터내셔널 /
   (주)이지텍인터내셔널 / 이지텍인터네셔널, 디자인티티 / DESIGN TT / 해울디자인 처럼.
   그래서 손으로 한 회사로 묶어 두고, 다른 표기는 aliases로 남긴다.
   원본 오타(010-33311-8005)는 같은 사람의 다른 줄 번호로 고쳤다.

   여러 번 돌려도 된다 — 이미 있는 기업·연락처는 빈 칸만 채운다.

     node db/import-builder-list.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const SOURCE = '타 행사 독립부스 시공사 명단';

/* [회사, 다른 표기, [[이름, 직함, 전화, 휴대폰, 메일], …]] */
const LIST = [
  ['디자인플러스코리아', ['Designpluskorea Co.Ltd'], [['이정화', '', '', '010-5382-7234', 'designpluskorea@gmail.com']]],
  ['(주)우인', [], [['심명용', '', '', '010-9283-0002', '9283002@naver.com']]],
  ['엔와이어소시에이츠', [], [['장규승', '', '', '010-5298-2418', 'jangks13@nate.com']]],
  ['(주)마운틴디스플레이테크', ['마운틴디스플레이 테크'], [
    ['임전빈', '', '02-422-1888', '010-3895-8582', 'chomdt@nate.com'],
    ['최효연', '', '', '010-3907-7923', '']]],
  ['(주)큐베스트', [], [['김선희', '', '', '010-6209-6333', '777cocototo@hanmail.net']]],
  ['이앤애드', [], [['백종현', '', '', '010-6434-6903', 'enad@enad.kr']]],
  ['애니비주얼', [], [['정병철', '', '', '010-3435-9304', '']]],
  ['전시기획 틈', [], [['이슬기', '', '031-905-0507', '010-3311-8005', 'booth3@hanmail.net']]],
  ['(주)이지텍인터내셔널', ['이지텍 인터내셔널', '이지텍인터네셔널'], [
    ['나웅', '', '02-6258-1600', '010-2430-1707', 'coolwoong@iztec.co.kr'],
    ['박정석', '', '02-6258-1600', '010-8309-0504', 'js0504@iztec.co.kr']]],
  ['(주)서울부스애드컴', [], [
    ['박희선', '', '02-6959-4488', '010-4015-4095', 'heesun@seouladcom.com'],
    ['김현준', '', '02-6959-4488', '010-3381-4092', 'hyunjun@seouladcom.com']]],
  ['(주)디젤', [], [['김동주', '', '', '010-7759-5647', 'pdzmk71@nate.com']]],
  ['디자인티티', ['DESIGN TT', '해울디자인'], [
    ['손권율', '', '070-8856-6369', '010-8607-4470', 'designtt88@naver.com'],
    ['황태원', '', '070-8856-6369', '010-6332-5260', 'mkt@designtt.kr'],
    /* 해울디자인으로 따로 적혔지만 디자인티티 메일·대표번호 대역을 쓴다 */
    ['이경준', '', '070-8856-2706', '010-7770-8012', 'mkt@designtt.kr']]],
  ['주식회사 덱스', [], [['이정원', '', '031-521-0715', '010-7788-1726', 'dexkorea@dexkorea.co.kr']]],
  ['앤드앤부스', [], [['홍성문', '', '', '010-3726-7448', 'hong.sm@daum.net']]],
  ['주식회사 그리드디자인', [], [['김택규', '실장', '', '010-7167-7815', 'care0105@naver.com']]],
  ['아이젠전시문화', [], [['한진영', '', '', '010-3226-2745', 'mrush2@naver.com']]],
  ['인터내셔날서비스비즈니스', [], [['김유진', '', '02-525-3711', '010-9703-9321', 'kyj@e-isb.com']]],
  ['에이치투아이엔씨', [], [['신다인', '', '', '010-9882-9304', 'h7@htwoinc.com']]],
  ['디자인혼', [], [['육지현', '', '', '010-6270-2729', 'youkjji@gmail.com']]],
  ['주식회사 래빗', [], [['안성찬', '', '070-7707-6355', '010-3697-0242', 'sc.an@rabbitspace.co.kr']]],
  ['에이치앤파트너스', [], [['김재훈', '', '02-942-3937', '010-3419-1546', 'h_and3937@naver.com']]],
  ['(주)인터블루커뮤니케이션', [], [['김시현', '', '070-4808-1344', '010-8233-7323', 'ksh8233@interblue.co.kr']]],
  ['(주)씨에스텍플러스', [], [['윤지원', '', '070-4352-5835', '', 'jwyoon@cstec.co.kr']]],
  ['더모스트기획', [], [['이지은', '팀장', '', '010-2352-4620', 'jieun.plan@themostplan.com']]],
  ['디자인에이플', ['원일디자인'], [['김재성', '', '02-581-8313', '010-6269-1644', 'design_ap@naver.com']]],
  ['디자인지오', [], [['고송희', '', '02-333-3611', '010-8763-1695', 'treesong76@naver.com']]],
  ['디페', [], [['송민수', '', '', '010-2662-1021', '']]],
  ['마움디자인', ['Maum', '마움다지인'], [['홍완석', '', '02-3489-1103', '010-9626-2209', 'wanth2@maumdesign.co.kr']]],
];

const clean = (v) => String(v ?? '').replace(/ /g, ' ').trim();
const norm = (v) => clean(v).toLowerCase()
  .replace(/주식회사|㈜|\(주\)|co\.?\s*ltd\.?/g, '')
  .replace(/\(.*?\)/g, '')
  .replace(/인터네셔널/g, '인터내셔널')
  .replace(/[^a-z0-9가-힣]/g, '');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orgs = (await client.query(`SELECT id, name_ko, name_en, aliases, phone, kind FROM orgs`)).rows;
    const index = new Map();
    orgs.forEach((o) => [o.name_ko, o.name_en, ...String(o.aliases || '').split('\n')]
      .filter(Boolean).forEach((n) => { const k = norm(n); if (k && !index.has(k)) index.set(k, o); }));

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const stamp = now.getTime();
    let seq = 0;
    const made = [], linked = [], people = [], filled = [];

    for (const [name, alts, persons] of LIST) {
      let org = [name, ...alts].map((n) => index.get(norm(n))).find(Boolean);
      const tel = persons.map((p) => p[2]).find(Boolean) || '';
      if (!org) {
        org = { id: `O-${stamp}_bl${++seq}`, name_ko: name, aliases: alts.join('\n'), phone: tel };
        if (!DRY) await client.query(
          `INSERT INTO orgs (id, name_ko, name_en, aliases, kind, status, sectors, phone, source, created_at, updated_at)
           VALUES ($1, $2, '', $3, '벤더시공사', '활성', '', $4, $5, $6, $7)`,
          [org.id, name, org.aliases, tel, SOURCE, now.toISOString(), today]);
        made.push(name);
      } else {
        linked.push(`${name} → ${org.name_ko}${org.kind && org.kind !== '벤더시공사' ? ` (종류: ${org.kind})` : ''}`);
        const have = String(org.aliases || '').split('\n').filter(Boolean);
        const add = [name, ...alts].filter((n) => n !== org.name_ko && !have.includes(n));
        const patch = {};
        if (add.length) patch.aliases = [...have, ...add].join('\n');
        if (!clean(org.phone) && tel) patch.phone = tel;
        /* 잠재고객사로 먼저 들어온 곳도 이 명단에 있으면 시공사다 */
        if (org.kind === '잠재고객사' || !org.kind) patch.kind = '벤더시공사';
        const cols = Object.keys(patch);
        if (cols.length && !DRY) await client.query(
          `UPDATE orgs SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ')}, updated_at = $${cols.length + 2} WHERE id = $1`,
          [org.id, ...cols.map((c) => patch[c]), today]);
      }
      [name, ...alts].forEach((n) => index.set(norm(n), org));

      for (const [pn, title, ptel, mob, email] of persons) {
        const dup = (await client.query(
          `SELECT id, phone1, phone2, email1, "titleKo" FROM contacts WHERE org_id = $1 AND "nameKo" = $2`,
          [org.id, pn])).rows[0];
        const p1 = mob || ptel, p2 = mob ? ptel : '';
        if (dup) {
          const patch = {};
          if (!clean(dup.phone1) && p1) patch.phone1 = p1;
          if (!clean(dup.phone2) && p2 && p2 !== dup.phone1) patch.phone2 = p2;
          if (!clean(dup.email1) && email) patch.email1 = email;
          if (!clean(dup.titleKo) && title) patch.titleKo = title;
          const cols = Object.keys(patch);
          if (cols.length) {
            filled.push(`${pn} (${org.name_ko}): ${cols.join(',')}`);
            if (!DRY) await client.query(
              `UPDATE contacts SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ')} WHERE id = $1`,
              [dup.id, ...cols.map((c) => patch[c])]);
          }
          continue;
        }
        if (!DRY) await client.query(
          `INSERT INTO contacts (id, "nameKo", "orgKo", "titleKo", cat, lang, source, date, status,
                                 email1, phone1, phone2, org_id)
           VALUES ($1, $2, $3, $4, '', 'ko', $5, $6, 'new', $7, $8, $9, $10)`,
          [`${stamp}${String(++seq).padStart(4, '0')}`, pn, org.name_ko, title, SOURCE, today, email, p1, p2, org.id]);
        people.push(`${pn}${title ? ' ' + title : ''} (${org.name_ko})`);
      }
    }

    console.log(`\n${SOURCE} — 회사 ${LIST.length}곳`);
    console.log(`  새 기업 ${made.length}: ${made.join(', ') || '-'}`);
    console.log(`  기존 기업에 이음 ${linked.length}:`); linked.forEach((l) => console.log('    ', l));
    console.log(`  새 연락처 ${people.length}:`); people.forEach((p) => console.log('    ', p));
    console.log(`  기존 연락처 빈 칸 채움 ${filled.length}:`); filled.forEach((p) => console.log('    ', p));

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
