/* 담당자 이름이 없는 줄도 마스터DB에 올린다.

   기업에만 적어 두면 마스터DB에서는 보이지 않는다. 그런데 이 106곳이야말로
   파이프라인에서 제일 먼저 해야 할 일이다 — 전화 한 통이면 담당자를 알아낼
   수 있는 곳들이라, 사람 목록에서 안 보이면 아무도 손을 안 댄다.

   이름 칸에는 부서명이 있으면 부서명을, 없으면 기업명을 넣는다. 사람 이름이
   아닌 것이 이름 칸에 들어가는 건 분명한 대가다. 그래서 두 가지로 표를 해 둔다.
     · 태그 «담당자 미정» — 마스터DB 사이드바에서 한 번에 추릴 수 있다
     · 상태 «확인 중»     — 검증된 자료가 아니라는 표시
   담당자를 알아내면 이름을 고치고 태그를 떼면 그대로 정상 연락처가 된다.

   대표 전화·메일은 기업에도 남아 있다(db/fill-org-contact.js). 어느 쪽을
   보든 같은 번호가 나오게 두는 편이, 한쪽에만 있어서 못 찾는 것보다 낫다.

     node db/import-evk-pending-contacts.js <엑셀경로> [--dry]              */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const FILE = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!FILE) { console.error('엑셀 경로를 주세요.'); process.exit(1); }

const TAG = '담당자미정';
const TAG_LABEL = '담당자 미정';

const clean = (v) => String(v == null ? '' : v).trim();
const real = (v) => {
  const t = clean(v);
  return (!t || t === '*' || t === '-' || t === 'N/A') ? '' : t;
};
const key = (v) => clean(v).toLowerCase()
  .replace(/㈜|\(주\)|주식회사|\(유\)|유한회사/g, '').replace(/\s+/g, '');
const isKo = (v) => /[가-힣]/.test(String(v || ''));

let _id = Date.now() * 1000;
const nextId = () => String(++_id);

const SHEETS = [
  { name: '종합_셀러',  org: '기업명',           dept: null,     mobile: '핸드폰 번호', tel: null,
    memo: null,   source: '셀러 명단 (담당자 미정)' },
  { name: '종합_바이어', org: '기관/기업/단체명', dept: '부서명', mobile: '핸드폰 번호', tel: '일반번호',
    memo: '비고', source: '바이어 명단 (담당자 미정)' },
];

(async () => {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(FILE);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orgMap = new Map();
    (await client.query(`SELECT id, name_ko, name_en, COALESCE(sectors,'') sectors FROM orgs`))
      .rows.forEach((o) => {
        if (o.name_ko) orgMap.set(key(o.name_ko), o);
        if (o.name_en) orgMap.set(key(o.name_en), o);
      });

    /* 이미 올라간 줄은 건너뛴다 — 같은 기업에 같은 이름이 또 생기면
       담당자를 알아낸 뒤에도 빈 줄이 하나 남는다. */
    const existing = new Set();
    (await client.query(`SELECT "nameKo", "nameEn", "orgKo", "orgEn" FROM contacts`))
      .rows.forEach((c) => existing.add(
        key(c.nameKo || c.nameEn) + '|' + key(c.orgKo || c.orgEn)));

    const made = []; const dup = [];

    for (const sh of SHEETS) {
      const ws = wb.Sheets[sh.name];
      if (!ws) { console.error(`«${sh.name}» 시트가 없습니다.`); continue; }
      for (const r of XLSX.utils.sheet_to_json(ws, { defval: '' })) {
        const orgName = clean(r[sh.org]);
        if (!orgName || clean(r['성함'])) continue;   // 이름이 있는 줄은 이미 들어갔다

        const dept = sh.dept ? clean(r[sh.dept]) : '';
        const mobile = real(r[sh.mobile]);
        const tel = sh.tel ? real(r[sh.tel]) : '';
        const email = real(r['메일']);
        if (!mobile && !tel && !email) continue;      // 연락할 길이 아예 없으면 줄을 만들 이유가 없다

        const label = dept || orgName;                // 이름 칸에 들어갈 말
        const k = key(label) + '|' + key(orgName);
        if (existing.has(k)) { dup.push(label); continue; }

        const org = orgMap.get(key(orgName));
        await client.query(
          `INSERT INTO contacts
             (id, "nameKo", "nameEn", "orgKo", "orgEn", "titleKo", "titleEn",
              "deptKo", "deptEn", country, cat, lang, source, date, status,
              email1, email2, phone1, phone2, beat, products, tags, org_id, memo1)
           VALUES ($1,$2,$3,$4,$5,'','',$6,'','','attendee',$7,$8,$9,'pending',
                   $10,'',$11,$12,$13,'',$14,$15,$16)`,
          [nextId(),
           isKo(label) ? label : '', isKo(label) ? '' : label,
           isKo(orgName) ? orgName : '', isKo(orgName) ? '' : orgName,
           dept, isKo(label) ? 'KO' : 'EN', sh.source,
           new Date().toISOString().slice(0, 10),
           email, mobile, tel, org ? org.sectors : '', TAG, org ? org.id : '',
           sh.memo ? clean(r[sh.memo]) : '']);

        existing.add(k);
        made.push({ label, orgName, source: sh.source, linked: !!org });
      }
    }

    /* 태그 목록에 «담당자 미정»을 더한다 — 목록에 없으면 사이드바에 칩이 안 뜬다 */
    const row = (await client.query(`SELECT value FROM settings WHERE key = 'tags'`)).rows[0];
    const tags = row ? JSON.parse(row.value) : [];
    if (!tags.some((t) => t.key === TAG)) {
      tags.push({ key: TAG, label: TAG_LABEL });
      await client.query(
        `INSERT INTO settings (key, value) VALUES ('tags', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(tags)]);
      console.log(`태그 «${TAG_LABEL}» 추가`);
    }

    const by = made.reduce((m, v) => m.set(v.source, (m.get(v.source) || 0) + 1), new Map());
    console.log(`\n새로 올린 줄 ${made.length}개`);
    [...by].forEach(([s, n]) => console.log(`   ${String(n).padStart(3)}  ${s}`));
    console.log(`   기업과 이어진 줄 ${made.filter((v) => v.linked).length}개`);
    made.slice(0, 6).forEach((v) => console.log(`   + ${v.label}  (${v.orgName})`));
    if (made.length > 6) console.log(`   … 외 ${made.length - 6}개`);
    if (dup.length) console.log(`\n이미 있어 건너뛴 ${dup.length}개`);

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
