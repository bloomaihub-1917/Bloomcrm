/* 리팩토링 도구 — backend-node/db/의 스크립트 129개를 폴더로 나눈다(한 번 쓰는 도구, 기록으로 남긴다).

   node scripts/refactor/db-reorg.js [--apply]      (저장소 뿌리에서. --apply 없이는 무엇을 옮길지만 보인다)

   db/ 에 남기는 것 — 서버(routes)와 여러 스크립트가 함께 쓰거나, 문서가 그 경로로 부르라고 적은 것
     pool.js · contact-ids.js · schema.sql · seed.sql · fix-unsafe-contact-ids.js(CLAUDE.md가 다시 돌리라고 적었다)
   db/migrations/ — add-*.js : 표에 칸·표를 더하는 일(운영 DB에 한 번씩 돌린 것)
   db/seeds/      — seed-*.js : 처음 값 넣기
   db/oneoff/     — 나머지 : 특정 행사·자료를 한 번 들여오거나 고친 것. 짝으로 쓰는 .py도 같이 간다

   고치는 것
   - require('./pool')·require('./contact-ids') → 새 자리에서 본 경로
   - path.join(__dirname, …) / path.resolve(__dirname, '…') — 한 단계 깊어졌으니 '..'를 하나 더한다.
     같이 옮기는 짝 파일(.py·.json)을 가리키는 것은 그대로 둔다
   - 저장소 글(코드 주석·문서·CLAUDE.md) 안의 «db/<이름>.js» 언급 → 새 경로 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const APPLY = process.argv.includes('--apply');
const DB = 'backend-node/db';
const KEEP = new Set(['pool.js', 'contact-ids.js', 'schema.sql', 'seed.sql', 'fix-unsafe-contact-ids.js']);
/* 짝 파일 — 스크립트가 __dirname 옆에서 찾는다. 스크립트와 같은 폴더로 간다 */
const PAIRS = { 'resize-logos.py': 'oneoff', 'resize-speaker-photos.py': 'oneoff', '_build-aia-verbatim.py': 'oneoff', '_aia-verbatim.json': 'oneoff' };

const folderOf = (f) => {
  if (KEEP.has(f)) return '';
  if (PAIRS[f]) return PAIRS[f];
  if (/^add-/.test(f)) return 'migrations';
  if (/^seed-/.test(f)) return 'seeds';
  return 'oneoff';
};
const files = fs.readdirSync(DB).filter((f) => fs.statSync(path.join(DB, f)).isFile());
const plan = files.map((f) => ({ f, to: folderOf(f) })).filter((x) => x.to);
const where = Object.fromEntries(files.map((f) => [f, folderOf(f)]));

const counts = {};
plan.forEach((x) => { counts[x.to] = (counts[x.to] || 0) + 1; });
console.log('옮길 파일', plan.length, counts);
if (!APPLY) { console.log('(--apply로 실제로 옮긴다)'); process.exit(0); }

/* 1) 옮기기 — git이 아는 파일은 git mv, 모르는 것(무시 목록의 json)은 그냥 */
const tracked = new Set(execFileSync('git', ['ls-files', DB]).toString().split('\n').filter(Boolean).map((p) => path.basename(p)));
for (const { f, to } of plan) {
  fs.mkdirSync(path.join(DB, to), { recursive: true });
  if (tracked.has(f)) execFileSync('git', ['mv', path.join(DB, f), path.join(DB, to, f)]);
  else fs.renameSync(path.join(DB, f), path.join(DB, to, f));
}

/* 2) 옮긴 스크립트 안의 경로 */
for (const { f, to } of plan.filter((x) => x.f.endsWith('.js'))) {
  const p = path.join(DB, to, f);
  let s = fs.readFileSync(p, 'utf8');
  s = s.replace(/require\((['"])\.\/([\w.-]+?)(\.js)?\1\)/g, (w, q, name) => {
    const tgt = where[name + '.js'] ?? where[name];
    if (tgt === undefined) return w;
    const r = tgt === to ? `./${name}` : tgt === '' ? `../${name}` : `../${tgt}/${name}`;
    return `require(${q}${r}${q})`;
  });
  /* __dirname 기준 경로 — 짝 파일(같이 옮긴 것)이 아니면 한 단계 위로 */
  s = s.replace(/path\.join\(__dirname,\s*(['"])([^'"]+)\1/g, (w, q, first) => {
    if (where[first] === to) return w;          // 같이 옮긴 짝 파일
    return `path.join(__dirname, '..', ${q}${first}${q}`;
  });
  s = s.replace(/path\.resolve\(__dirname,\s*(['"])(\.\.\/[^'"]*)\1/g, (w, q, rel) => `path.resolve(__dirname, ${q}../${rel}${q}`);
  fs.writeFileSync(p, s);
}

/* 3) 저장소 글 안의 «db/이름» 언급 — 코드 주석, 문서, CLAUDE.md */
const moved = Object.fromEntries(plan.map((x) => [x.f, x.to]));
const textFiles = execFileSync('git', ['ls-files']).toString().split('\n')
  .filter((p) => /\.(js|mjs|md|json|html|sql|py)$/.test(p) && fs.existsSync(p));
let touched = 0;
for (const p of textFiles) {
  const s = fs.readFileSync(p, 'utf8');
  const out = s.replace(/(^|[^\w/.-])((?:backend-node\/)?db\/)([\w.-]+\.(?:js|py|json))/g, (w, pre, dir, name) =>
    moved[name] ? `${pre}${dir}${moved[name]}/${name}` : w);
  if (out !== s) { fs.writeFileSync(p, out); touched++; }
}
console.log('옮김', plan.length, '· 언급 고친 파일', touched);
