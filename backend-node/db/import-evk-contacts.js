/* 셀러·바이어 명단의 담당자를 연락처로 올린다.

   기업은 이미 들어와 있고 사람만 지워진 상태라, 여기서는 사람만 만든다.
   기업 이름으로 org_id를 찾아 붙이므로 기업DB에서 바로 이어진다 —
   이름이 아니라 id로 이어져야 나중에 사명이 바뀌어도 끊기지 않는다.

   이미 있는 사람은 건너뛴다. 판단 기준은 두 가지다.
     1) 이메일이 같으면 같은 사람 — 가장 확실하다.
     2) 이메일이 없으면 이름+기업이 같은 사람.
   둘 다 아니면 새 사람으로 본다.

   시트마다 칸이 조금 다르다.
     셀러  : 기업명 · 성함 · 직책 · 핸드폰 번호 · 메일
     바이어 : 기관/기업/단체명 · 부서명 · 성함 · 직책 · 일반번호 · 핸드폰 번호 · 메일 · 비고
   바이어의 비고는 공고·사업명이라 사람에게 붙는 메모1로 넣는다. 기업 메모에
   넣으면 한 기관에 여러 건이 들어올 때 서로 덮어쓴다.

   행사 참여 기록은 만들지 않는다 — 이 사람들은 아직 «앞으로 만날 상대»지
   어떤 행사에 온 사람이 아니다. 행사에 걸려면 업로드 화면에서 연결 행사를
   고르거나, 마스터DB에서 «행사에 초청»을 쓴다.

     node db/import-evk-contacts.js <엑셀경로> [--dry]                       */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const FILE = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!FILE) { console.error('엑셀 경로를 주세요.'); process.exit(1); }

const key = (v) => String(v || '').trim().toLowerCase()
  .replace(/㈜|\(주\)|주식회사|\(유\)|유한회사/g, '')
  .replace(/\s+/g, '');
const isKo = (v) => /[가-힣]/.test(String(v || ''));
const clean = (v) => String(v == null ? '' : v).trim();

/* 앱의 genContactId와 같은 모양 — 밀리초 × 1000에서 하나씩 올린다 */
let _id = Date.now() * 1000;
const nextId = () => String(++_id);

const SHEETS = [
  { name: '종합_셀러', org: '기업명', source: '셀러 명단',
    dept: null, tel: null, memo: null },
  { name: '종합_바이어', org: '기관/기업/단체명', source: '바이어 명단',
    dept: '부서명', tel: '일반번호', memo: '비고' },
];

(async () => {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(FILE);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* 기업 — 이름으로 찾아 id와 섹터를 가져온다 */
    const orgMap = new Map();
    (await client.query(`SELECT id, name_ko, name_en, COALESCE(sectors,'') sectors FROM orgs`))
      .rows.forEach((o) => {
        if (o.name_ko) orgMap.set(key(o.name_ko), o);
        if (o.name_en) orgMap.set(key(o.name_en), o);
      });

    /* 이미 있는 사람 — 이메일과 «이름+기업» 두 가지로 본다 */
    const byEmail = new Set();
    const byNameOrg = new Set();
    (await client.query(
      `SELECT "nameKo", "nameEn", "orgKo", "orgEn", email1 FROM contacts`)).rows.forEach((c) => {
      if (c.email1) byEmail.add(c.email1.trim().toLowerCase());
      const nm = key(c.nameKo || c.nameEn);
      const og = key(c.orgKo || c.orgEn);
      if (nm) byNameOrg.add(nm + '|' + og);
    });

    const made = []; const dup = []; const noOrg = [];

    for (const sh of SHEETS) {
      const ws = wb.Sheets[sh.name];
      if (!ws) { console.error(`«${sh.name}» 시트가 없습니다.`); continue; }
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

      for (const r of rows) {
        const person = clean(r['성함']);
        const orgName = clean(r[sh.org]);
        if (!person || !orgName) continue;   // 이름 없는 줄은 기업만 있는 줄이다

        const email = clean(r['메일']).toLowerCase();
        const nameOrgKey = key(person) + '|' + key(orgName);
        if (email && byEmail.has(email)) { dup.push(person); continue; }
        if (!email && byNameOrg.has(nameOrgKey)) { dup.push(person); continue; }

        const org = orgMap.get(key(orgName));
        if (!org) noOrg.push(orgName);

        const title = clean(r['직책']);
        const id = nextId();
        await client.query(
          `INSERT INTO contacts
             (id, "nameKo", "nameEn", "orgKo", "orgEn", "titleKo", "titleEn",
              "deptKo", "deptEn", country, cat, lang, source, date, status,
              email1, email2, phone1, phone2, beat, products, tags, org_id, memo1)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'','','attendee',$9,$10,$11,'new',
                   $12,'',$13,$14,$15,'','',$16,$17)`,
          [
            id,
            isKo(person) ? person : '', isKo(person) ? '' : person,
            isKo(orgName) ? orgName : '', isKo(orgName) ? '' : orgName,
            isKo(title) ? title : '', isKo(title) ? '' : title,
            sh.dept ? clean(r[sh.dept]) : '',
            isKo(person) ? 'KO' : 'EN',
            sh.source,
            new Date().toISOString().slice(0, 10),
            clean(r['메일']),
            clean(r['핸드폰 번호']),
            sh.tel ? clean(r[sh.tel]) : '',
            org ? org.sectors : '',
            org ? org.id : '',
            sh.memo ? clean(r[sh.memo]) : '',
          ]);

        if (email) byEmail.add(email);
        byNameOrg.add(nameOrgKey);
        made.push({ person, orgName, source: sh.source, linked: !!org });
      }
    }

    const bySource = made.reduce((m, v) => m.set(v.source, (m.get(v.source) || 0) + 1), new Map());
    console.log(`새로 만든 연락처 ${made.length}명`);
    [...bySource].forEach(([s, n]) => console.log(`   ${String(n).padStart(3)}  ${s}`));
    console.log(`   기업과 이어진 사람 ${made.filter((v) => v.linked).length}명`);
    if (dup.length) console.log(`\n이미 있어 건너뛴 ${dup.length}명`);
    if (noOrg.length) {
      const uniq = [...new Set(noOrg)];
      console.log(`\n기업DB에서 못 찾아 기업 연결이 빈 채로 들어간 ${uniq.length}곳:`);
      console.log('   ' + uniq.slice(0, 15).join(' · ') + (uniq.length > 15 ? ' …' : ''));
    }

    const tot = await client.query(`SELECT count(*)::int n FROM contacts`);
    console.log(`\n연락처 합계 ${tot.rows[0].n}명`);

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
