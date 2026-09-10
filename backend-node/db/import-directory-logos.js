/* ══════════════════════════════════════════════════════════════
   import-directory-logos.js — 로고 폴더 → 웹디렉토리에 쓸 이미지

   OneDrive의 Logo 폴더에 기업별 하위 폴더가 있고, 그 안에 ai·eps·jpg·png가
   뒤섞여 있다. 브라우저는 ai도 eps도 못 읽으므로 래스터(jpg·png)만 골라
   웹용으로 줄여 backend-node/public/logos/<행사슬러그>/<도록순번>에 넣는다.
   routes/public.js가 그 폴더를 도록 순번으로 훑어 카드에 붙인다.

     node db/import-directory-logos.js [--event "2026 KIC"] [--dry]

   ── 번호로 짝짓지 않는다 ──
   폴더명이 "<번호>_[등급_]<기업명>"이라 번호가 도록 순번처럼 보이지만, 실제로는
   어긋난다. 2026 KIC에서 여덟 곳이 밀려 있었다 — 폴더 14는 Aurigon인데 도록
   14번은 Bredis이고, 폴더 47·48은 서울대병원과 분당서울대병원이 서로 바뀌어
   있다. 번호로 붙이면 남의 로고가 공개 화면에 올라간다.

   폴더 번호는 신청 순서대로 만들어 두고 도록 번호는 지면 사정으로 다시 매기는데,
   폴더명은 그때 고치지 않는다. 그래서 이름으로 짝짓고, 하나로 좁혀지지 않는
   폴더는 넘기고 보고한다(추측해서 붙이는 것보다 비어 있는 게 낫다).
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pool = require('./pool');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const EVENT = arg('--event') || '2026 KIC';

const LOGO_DIR = arg('--dir') || 'C:/Users/cdaky/OneDrive - STUDIO BLOOM/4.행사/2026년/'
  + '1013-1015 KoNECT International Conference/300. 전시/Logo';

const OUT_ROOT = path.join(__dirname, '..', 'public', 'logos');

/* 행사 id를 URL 슬러그로 — routes/public.js와 같은 규칙이어야 한다 */
const slugify = (v) => String(v || '').toLowerCase().trim()
  .replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '');

/* 이름을 눌러 견준다 — 법인 접미사와 기호를 떼면 폴더명과 DB 이름이 맞는다
   ('16_BXPLANT' ↔ 'BX PLANT Co., Ltd') */
const squash = (v) => String(v || '').toLowerCase()
  .replace(/\(주\)|\(유\)|주식회사|㈜|유한회사/g, '')
  .replace(/\b(inc|corp|corporation|co|ltd|limited|llc|llp|gmbh|pte|pty|plc|kk)\b\.?/g, '')
  .replace(/[^a-z0-9가-힣]/g, '');

/* 폴더명에서 순번과 등급 딱지를 뗀다:
   '8_BRONZE_PENETRIUM BIOSCIENCE' → 'PENETRIUM BIOSCIENCE' */
const folderName = (d) => d.replace(/^\d+_/, '')
  .replace(/^(DIA|GOLD|SILVER|BRONZE|기타)_/i, '')
  .replace(/\s*\(전시\s*x\)\s*/i, '')
  .trim();

/* 한 폴더에 여러 장이 있을 때 웹에 쓸 것을 고른다.
   투명한 PNG > 화면용(RGB) > 인쇄용(CMYK·Pantone), 복사본과 내려받다 붙은
   '(1)'은 뒤로 보낸다. 같은 점수면 큰 파일을 쓴다(해상도가 높을 때가 많다). */
function score(fn) {
  const n = fn.toLowerCase();
  let s = 0;
  if (n.endsWith('.png')) s += 40;
  if (n.includes('rgb')) s += 12;
  if (n.includes('cmyk') || n.includes('pantone')) s -= 12;
  if (n.includes('copy')) s -= 30;
  if (/\(\d+\)/.test(n)) s -= 6;
  if (n.includes('wordmark') || n.includes('full name')) s += 4;
  if (fn.includes('변환됨')) s -= 4;
  return s;
}

const isRaster = (f) => /\.(png|jpe?g)$/i.test(f);

(async () => {
  const { rows: events } = await pool.query('SELECT id, short FROM events WHERE id = $1', [EVENT]);
  if (!events.length) {
    console.error(`행사를 못 찾았어요: ${EVENT}`);
    process.exit(1);
  }
  const slug = slugify(events[0].id);

  const { rows } = await pool.query(
    `SELECT x.book_order, x.company_name, x.book_name_en, x.book_name_ko,
            o.name_en, o.name_ko, o.aliases,
            COALESCE(NULLIF(TRIM(x.book_name_en), ''), NULLIF(TRIM(o.name_en), ''),
                     x.company_name) AS name
       FROM exhibitors x
       LEFT JOIN orgs o ON o.id = x.org_id
      WHERE x.event_id = $1 AND COALESCE(x.status, '') <> '취소'`,
    [EVENT]);

  const cands = rows.map((r) => ({
    row: r,
    keys: [r.book_name_en, r.name_en, r.company_name, r.book_name_ko, r.name_ko,
      ...String(r.aliases || '').split(/[,;|]/)]
      .map(squash).filter((k) => k.length >= 2),
  }));

  const plan = [];
  const skipped = [];
  const dirs = fs.readdirSync(LOGO_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());

  dirs.forEach((d) => {
    const files = fs.readdirSync(path.join(LOGO_DIR, d.name)).filter(isRaster);
    const best = files.sort((a, b) => score(b) - score(a)
      || fs.statSync(path.join(LOGO_DIR, d.name, b)).size
       - fs.statSync(path.join(LOGO_DIR, d.name, a)).size)[0];

    const f = squash(folderName(d.name));
    const exact = cands.filter((c) => c.keys.includes(f));
    const near = cands.filter((c) => c.keys.some((k) => k.startsWith(f) || f.startsWith(k)));
    const hits = exact.length ? exact : near;

    if (!best) { skipped.push(`${d.name} — 쓸 수 있는 그림이 없음(ai·eps만)`); return; }
    if (hits.length !== 1) {
      skipped.push(`${d.name} — ${hits.length ? `여럿에 걸림(${hits.map((h) => h.row.name).join(' / ')})` : '참가기업 목록에 없음'}`);
      return;
    }

    const order = String(hits[0].row.book_order || '').trim();
    if (!order) { skipped.push(`${d.name} — ${hits[0].row.name}에 도록 순번이 없음`); return; }

    plan.push({
      order,
      name: hits[0].row.name,
      folder: d.name,
      file: best,
      src: path.join(LOGO_DIR, d.name, best),
      dst: path.join(OUT_ROOT, slug, order),
    });
  });

  plan.sort((a, b) => Number(a.order) - Number(b.order));

  console.log(`행사 ${EVENT} (/d/${slug}) — 참가기업 ${rows.length}곳, 로고 ${plan.length}장`);
  plan.forEach((p) => {
    const fn = (p.folder.match(/^(\d+)_/) || [])[1];
    const moved = fn && fn !== p.order ? `  ※ 폴더 ${fn} → 도록 ${p.order}` : '';
    console.log(`  ${p.order.padEnd(4)}${p.name.slice(0, 38).padEnd(40)}← ${p.folder}${moved}`);
  });

  if (skipped.length) {
    console.log('\n넘긴 폴더');
    skipped.forEach((s) => console.log(`  ${s}`));
  }

  const covered = new Set(plan.map((p) => p.order));
  const missing = rows.filter((r) => !covered.has(String(r.book_order || '').trim()));
  if (missing.length) {
    console.log(`\n로고가 없는 참가기업 (${missing.length})`);
    missing
      .sort((a, b) => (parseInt(a.book_order, 10) || 999) - (parseInt(b.book_order, 10) || 999))
      .forEach((r) => console.log(`  ${String(r.book_order || '(순번없음)').padEnd(10)}${r.name}`));
  }

  if (DRY) { console.log('\n--dry — 파일은 만들지 않았어요'); process.exit(0); }

  /* 그림 처리는 파이썬(Pillow)에 맡긴다 — 계획만 넘기고 결과를 받는다 */
  const planFile = path.join(os.tmpdir(), `logo-plan-${Date.now()}.json`);
  fs.writeFileSync(planFile, JSON.stringify(plan), 'utf8');
  let out;
  try {
    out = JSON.parse(execFileSync('python', [path.join(__dirname, 'resize-logos.py'), planFile],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  } finally {
    fs.unlinkSync(planFile);
  }

  const failed = out.filter((r) => r.error);
  const done = out.filter((r) => !r.error);
  const kb = done.reduce((s, r) => s + r.kb, 0);
  console.log(`\n만든 파일 ${done.length}장 / 합계 ${kb}KB`);
  if (failed.length) {
    console.log('만들지 못한 것');
    failed.forEach((r) => console.log(`  ${r.order}: ${r.error}`));
  }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
