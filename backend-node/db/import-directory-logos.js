/* ══════════════════════════════════════════════════════════════
   import-directory-logos.js — 로고 폴더 → 웹디렉토리에 쓸 이미지

   OneDrive의 Logo 폴더에 기업별 하위 폴더가 있고, 그 안에 ai·eps·jpg·png가
   뒤섞여 있다. 브라우저는 ai도 eps도 못 읽으므로 래스터(jpg·png)만 골라
   웹용으로 줄여 backend-node/assets/logos/<행사슬러그>/<도록순번>에 넣는다.
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

const OUT_ROOT = path.join(__dirname, '..', 'assets', 'logos');

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

/* 래스터가 아예 없는 기업이 있다(Certara는 'Certara logo.ai' 한 장뿐이었다).
   일러스트레이터가 PDF 호환으로 저장한 ai는 PDF 리더로 펼칠 수 있어, 래스터가
   없을 때만 이걸 쓴다 — 펼친 그림보다 기업이 보내 준 래스터가 늘 낫다. */
const isVector = (f) => /\.(ai|eps|pdf)$/i.test(f);

/* 두 이름이 앞에서 몇 글자까지 같은지 — 폴더명이 정식명보다 짧게 줄어 있을 때
   ('Ultragenicglobal' ↔ 'Ultragenic Research and Technologies') 짝을 찾는 데 쓴다. */
function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
const LOOSE_MIN = 6;   // 이만큼 겹치지 않으면 남의 로고를 붙일 위험이 크다

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
    const all = fs.readdirSync(path.join(LOGO_DIR, d.name));
    const pick = (list) => list.sort((a, b) => score(b) - score(a)
      || fs.statSync(path.join(LOGO_DIR, d.name, b)).size
       - fs.statSync(path.join(LOGO_DIR, d.name, a)).size)[0];
    const raster = pick(all.filter(isRaster));
    /* 벡터는 ai·eps를 먼저 본다. pdf는 로고가 아닌 안내문이 섞여 있어
       ('How to use Frontage Logo.pdf') 다른 게 없을 때만 쓴다. */
    const vector = pick(all.filter((f) => /\.(ai|eps)$/i.test(f)))
      || pick(all.filter((f) => /\.pdf$/i.test(f)));
    const best = raster || vector;

    const f = squash(folderName(d.name));
    const exact = cands.filter((c) => c.keys.includes(f));
    const near = cands.filter((c) => c.keys.some((k) => k.startsWith(f) || f.startsWith(k)));
    let hits = exact.length ? exact : near;

    /* 글자 그대로도, 앞뒤 포함으로도 안 맞으면 앞에서 겹치는 길이로 좁힌다.
       폴더명이 정식명보다 짧게 줄어 있는 경우다 — 'Ultragenicglobal' 폴더와
       'Ultragenic Research and Technologies'는 어느 쪽도 다른 쪽의 앞토막이
       아니지만 'ultragenic' 열 글자가 겹친다.

       가장 많이 겹치는 곳이 하나로 좁혀질 때만 쓰고, 그것도 LOOSE_MIN자 이상
       겹쳐야 받아들인다. 짧게 겹치는 것까지 붙이면('me' 두 글자로 Median과
       Medpace가 걸린다) 남의 로고가 공개 화면에 올라간다. */
    let loose = null;
    if (!hits.length) {
      const scored = cands
        .map((c) => ({ c, n: Math.max(...c.keys.map((k) => commonPrefix(k, f))) }))
        .filter((s) => s.n >= LOOSE_MIN)
        .sort((a, b) => b.n - a.n);
      const top = scored.filter((s) => s.n === (scored[0] || {}).n);
      if (top.length === 1) { hits = [top[0].c]; loose = top[0].n; }
    }

    if (!best) { skipped.push(`${d.name} — 쓸 수 있는 그림이 없음`); return; }
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
      loose,                      // 이름 일부로만 맞춘 경우 — 보고에 표시한다
      /* 래스터가 화면에 쓸 높이(160px)보다 작으면 늘려 쓰게 되어 흐려진다.
         Ultragenic이 보낸 png가 160×33이었다. 같은 폴더에 벡터가 있으면 그걸로
         갈아타도록 후보를 함께 넘긴다 — 크기 판단은 그림을 열 수 있는 쪽에서 한다. */
      altSrc: raster && vector ? path.join(LOGO_DIR, d.name, vector) : null,
      src: path.join(LOGO_DIR, d.name, best),
      dst: path.join(OUT_ROOT, `${slug}.staging`, order),
    });
  });

  /* 한 기업에 폴더가 둘 걸리는 일이 있다 — 같은 로고를 번호만 달리해 두 번
     만들어 둔 경우다(Frontage가 26번과 34번 두 폴더에 있었다). 그대로 두면
     파일 이름이 같아 나중에 처리된 쪽이 앞의 것을 덮어쓰는데, 어느 쪽이 남을지는
     폴더를 읽는 순서가 정한다. 좋은 파일이 있는 쪽을 골라 두고 나머지는 알린다. */
  const dupes = [];
  const byOrder = new Map();
  plan.forEach((p) => {
    const kept = byOrder.get(p.order);
    if (!kept) { byOrder.set(p.order, p); return; }
    const better = score(p.file) - score(kept.file)
      || fs.statSync(p.src).size - fs.statSync(kept.src).size;
    const [win, lose] = better > 0 ? [p, kept] : [kept, p];
    byOrder.set(p.order, win);
    dupes.push(`${lose.name}(도록 ${lose.order}) — '${lose.folder}'를 넘기고 '${win.folder}'를 씀`);
  });
  plan.length = 0;
  plan.push(...byOrder.values());
  plan.sort((a, b) => Number(a.order) - Number(b.order));

  console.log(`행사 ${EVENT} (/d/${slug}) — 참가기업 ${rows.length}곳, 로고 ${plan.length}장`);
  plan.forEach((p) => {
    const fn = (p.folder.match(/^(\d+)_/) || [])[1];
    const flags = [
      fn && fn !== p.order ? `폴더 ${fn} → 도록 ${p.order}` : '',
      p.loose ? `이름 앞 ${p.loose}자만 겹쳐 맞춤 — 확인 필요` : '',
      /\.(ai|eps|pdf)$/i.test(p.file) ? `래스터가 없어 ${path.extname(p.file).slice(1)}를 펼쳐 씀` : '',
    ].filter(Boolean);
    console.log(`  ${p.order.padEnd(4)}${p.name.slice(0, 38).padEnd(40)}← ${p.folder}`
      + (flags.length ? `  ※ ${flags.join(' / ')}` : ''));
  });

  if (dupes.length) {
    console.log('\n한 기업에 폴더가 둘');
    dupes.forEach((s) => console.log(`  ${s}`));
  }

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

  /* 새 폴더에 다 만든 뒤 옛 폴더를 갈아치운다. 자리에서 덮어쓰면 쓸모없어진
     파일이 남는데, 그게 그냥 쓰레기가 아니라 틀린 로고가 된다 — 파일 이름이
     도록 순번이고 그 순번은 기업이 추가되면 밀린다. 실제로 이번에 Goodwin과
     IQVIA가 들어오며 27번 뒤가 한두 칸씩 밀렸다.

     확장자가 달라질 때도 옛 파일이 남는다(같은 순번에 20.jpg와 20.png가 함께
     남으면 어느 쪽이 뜰지 폴더를 읽는 순서가 정한다). 폴더째 바꾸면 둘 다
     생기지 않는다. */
  const stage = path.join(OUT_ROOT, `${slug}.staging`);
  const live = path.join(OUT_ROOT, slug);
  fs.rmSync(stage, { recursive: true, force: true });

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

  /* 한 장이라도 못 만들었으면 갈아치우지 않는다 — 반만 바뀐 폴더는 나머지
     기업에 옛 순번의 로고를 그대로 달고 있게 된다. */
  if (failed.length) {
    console.log('\n만들지 못한 것');
    failed.forEach((r) => console.log(`  ${r.order}: ${r.error}`));
    console.log(`\n${done.length}장은 만들었지만 갈아치우지 않았어요 — ${stage}에 두었습니다`);
    process.exit(1);
  }

  const vectors = done.filter((r) => r.vector);
  if (vectors.length) {
    console.log('\n벡터를 펼쳐 쓴 곳');
    vectors.forEach((r) => console.log(`  도록 ${r.order}  ${r.used}  ${r.w}x${r.h}`));
  }

  fs.rmSync(live, { recursive: true, force: true });
  fs.renameSync(stage, live);
  console.log(`\n만든 파일 ${done.length}장 / 합계 ${kb}KB → ${path.relative(process.cwd(), live)}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
