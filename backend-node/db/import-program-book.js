/* ══════════════════════════════════════════════════════════════
   import-program-book.js — 프로그램북 게재 정보 엑셀 → exhibitors

   운영에서 정리한 "프로그램북 광고" 시트를 읽어 넣는다.
     순서 | 기업명(프로그램북) | 부스번호 | 주소 | 연락처 | 웹사이트 | 회사소개

   엑셀의 글자수 칸은 가져오지 않는다. 화면에서 늘 다시 세기 때문에, 세어 둔
   값을 저장하면 본문을 고치는 순간 어긋난다. 대신 엑셀 값과 실제 길이가 맞는지
   확인만 하고 다르면 알린다.

   기업명은 프로그램북용 표기라 우리 쪽 이름과 조금씩 다르다(Almac ↔ Almac Group,
   Fortrea ↔ Fortrea Korea Limited). orgs의 현재 이름·영문명·옛 이름과 전시
   표시명까지 훑어 맞추고, 그래도 못 찾으면 조용히 넘기지 않고 보고한다.

     node db/import-program-book.js --file "경로.xlsx" [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const path = require('path');
const pool = require('./pool');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const FILE = arg('--file');
const EVENT = arg('--event') || '2026 KIC';
const SHEET = '프로그램북 광고';

if (!FILE) {
  console.error('사용법: node db/import-program-book.js --file "경로.xlsx" [--event "2026 KIC"] [--dry]');
  process.exit(1);
}

/* 엑셀에서 온 문자열은 줄바꿈이 CRLF로, 공백이 비파괴 공백으로 섞여 있다.
   둘 다 눈에 안 보이는데 글자수와 이름 대조를 어긋나게 한다. CRLF를 LF로 펴야
   엑셀이 세어 둔 글자수와 같아진다 — 그러지 않으면 줄 수만큼 더 세어진다. */
const clean = (v) => String(v ?? '')
  .replace(/\u00A0/g, ' ')
  .replace(/\r\n?/g, '\n')
  .trim();

/* 이름 대조용 정규화 — 법인 접미사와 기호를 눌러 표기 차이를 흡수한다 */
function norm(raw) {
  let s = clean(raw).toLowerCase();
  s = s.replace(/^(주식회사|㈜|\(주\))\s*/, '').replace(/\s*(주식회사|㈜|\(주\))$/, '');
  s = s.replace(/[\s,.]*\b(incorporated|inc|co\.?,?\s*(ltd|limited)|ltd|limited|co|llc|llp|corp(oration)?|gmbh|s\.r\.l|srl|pte\.?\s*ltd|pty\.?\s*ltd|plc)\b\.?\s*$/i, '');
  return s.replace(/[^a-z0-9가-힣]/g, '');
}

/* 자동으로 못 잇는 것만 손으로 적는다 */
const ALIAS = {
  'seoulnationaluniversityhospitalclinicaltrialscenter': '서울대학교병원',
  'seoulnationaluniversitybundanghospitalclinicaltrialscenter': '분당서울대학교병원',
  'oraclehealthandlifesciences': 'oracle',
  'perceptiveimaging': 'perceptive',
  // 프로그램북 표기가 더 짧다 — 우리 쪽은 Median Medical Technology
  'mediantechnologies': '메디안 메디컬 테크놀로지',
};

(async () => {
  let XLSX;
  try { XLSX = require('xlsx'); } catch (e) { console.error('xlsx 모듈이 필요합니다: npm i xlsx'); process.exit(1); }

  const wb = XLSX.readFile(path.resolve(FILE));
  const sheet = wb.Sheets[SHEET];
  if (!sheet) { console.error(`[${SHEET}] 시트를 찾을 수 없습니다. 시트:`, wb.SheetNames.join(', ')); process.exit(1); }

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    .filter((r) => clean(r['기업명(프로그램북)']));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const exhs = (await client.query(
      `SELECT e.id, e.company_name, e.booth_no, o.name_ko, o.name_en, o.aliases
         FROM exhibitors e LEFT JOIN orgs o ON o.id = e.org_id
        WHERE e.event_id = $1`, [EVENT])).rows;

    const index = new Map();
    exhs.forEach((e) => {
      [e.company_name, e.name_ko, e.name_en, ...String(e.aliases || '').split('\n')]
        .filter(Boolean).forEach((n) => { const k = norm(n); if (k && !index.has(k)) index.set(k, e); });
    });

    const find = (name) => {
      const k = norm(name);
      if (index.has(k)) return index.get(k);
      if (ALIAS[k]) { const a = norm(ALIAS[k]); if (index.has(a)) return index.get(a); }
      const hits = [...index.entries()].filter(([ik]) => ik.includes(k) || k.includes(ik));
      return hits.length === 1 ? hits[0][1] : null;
    };

    const applied = [], missed = [], boothOdd = [], lenOdd = [], over = [];
    const LIMIT = 1300;

    for (const r of rows) {
      const name = clean(r['기업명(프로그램북)']);
      const e = find(name);
      if (!e) { missed.push(name); continue; }

      const intro = clean(r['회사소개']);
      const xlLen = Number(r['글자수']) || 0;
      if (intro && xlLen && xlLen !== intro.length) lenOdd.push({ name, xl: xlLen, real: intro.length });
      if (intro.length > LIMIT) over.push({ name: e.company_name, n: intro.length });

      const booth = clean(r['부스번호']);
      if (booth && e.booth_no && booth !== e.booth_no) boothOdd.push({ name: e.company_name, xl: booth, db: e.booth_no });

      /* 엑셀에 값이 있는 칸만 덮는다 — 빈 칸으로 이미 넣어 둔 값을 지우지 않게.
         로고는 이 시트에 없으므로 건드리지 않는다. */
      const patch = {};
      const put = (col, v) => { if (v) patch[col] = v; };
      put('book_order', clean(r['순서']));
      put('book_address', clean(r['주소']));
      put('book_phone', clean(r['연락처']));
      put('book_website', clean(r['웹사이트']));
      put('book_intro', intro);
      if (!Object.keys(patch).length) continue;

      if (!DRY) {
        const cols = Object.keys(patch);
        await client.query(
          `UPDATE exhibitors SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ')},
             updated_at = $${cols.length + 2} WHERE id = $1`,
          [e.id, ...cols.map((c) => patch[c]), new Date().toISOString().slice(0, 10)]);
      }
      applied.push({ co: e.company_name, n: intro.length, fields: Object.keys(patch).length });
    }

    console.log(`\n${EVENT} 프로그램북: ${applied.length}개 기업 반영 (엑셀 ${rows.length}행)`);
    const withIntro = applied.filter((a) => a.n);
    if (withIntro.length) {
      const ns = withIntro.map((a) => a.n);
      console.log(`  회사소개 ${withIntro.length}건 · ${Math.min(...ns)}~${Math.max(...ns)}자`);
    }
    if (over.length) {
      console.log(`\n⚠ 한도 ${LIMIT.toLocaleString()}자를 넘는 ${over.length}건 — 기업에 줄여 달라고 요청해야 합니다:`);
      over.sort((a, b) => b.n - a.n).forEach((o) => console.log(`   ${String(o.name).padEnd(26)} ${o.n}자  (${o.n - LIMIT}자 초과)`));
    }
    if (boothOdd.length) {
      console.log(`\n⚠ 부스번호가 시스템과 다른 ${boothOdd.length}건 — 엑셀 값은 넣지 않았습니다:`);
      boothOdd.forEach((b) => console.log(`   ${String(b.name).padEnd(26)} 엑셀 ${b.xl}  ↔  시스템 ${b.db}`));
    }
    if (lenOdd.length) {
      console.log(`\n⚠ 엑셀의 글자수 칸과 실제 길이가 다른 ${lenOdd.length}건:`);
      lenOdd.forEach((l) => console.log(`   ${String(l.name).padEnd(26)} 엑셀 ${l.xl}  실제 ${l.real}`));
    }
    if (missed.length) {
      console.log(`\n⚠ 이름을 못 찾은 ${missed.length}건 — 확인이 필요합니다:`);
      missed.forEach((m) => console.log('   ', m));
    }

    if (DRY) { await client.query('ROLLBACK'); console.log('\n--dry 라서 되돌렸습니다.'); }
    else { await client.query('COMMIT'); console.log('\n반영 완료.'); }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
