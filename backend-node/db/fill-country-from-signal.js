/* ══════════════════════════════════════════════════════════════
   fill-country-from-signal.js — 비어 있는 국가를 자료로 채운다

   마스터DB의 «국가»가 비어 있는 사람이 846명 중 565명이었다. 비어 있으면
   국내 목록에도 해외 목록에도 안 나온다 — 초청장 언어·비자 안내·보내는 시각이
   전부 이 칸에서 갈리는데, 안 보이니 영영 안 채워진다.

   채울 근거는 이미 자료 안에 있다. 전화번호의 국가번호, 국내 번호 모양,
   이메일·웹주소의 국가 도메인, 한글 이름·소속 — 사람이 짐작으로 적은 값이
   아니라 그 사람이 실제로 쓰는 것들이다. 판단은 화면과 같은 규칙(countryHint)을
   그대로 불러다 쓴다. 여기에 규칙을 따로 적으면 화면이 말하는 것과 스크립트가
   넣는 값이 갈라진다.

   ── 비어 있는 칸만 채운다 ──
   이미 적혀 있는 값은 건드리지 않는다. 사람이 알고 적은 값(국적과 근무지가
   다른 경우 등)을 자료 짐작으로 덮으면, 틀렸다는 사실조차 안 보인다.
   적힌 값과 자료가 어긋나는 건은 화면(countryCheck)이 짚어 준다.

     node db/fill-country-from-signal.js --domain mice --dry
     node db/fill-country-from-signal.js --domain mice
     node db/fill-country-from-signal.js --all            (분야 제한 없이)
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const path = require('path');
const pool = require('./pool');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const DOMAIN = argv.includes('--all') ? null : (arg('--domain') || 'mice');

(async () => {
  /* 화면이 쓰는 규칙을 그대로 불러온다 — ESM이라 동적 import로 읽는다 */
  const { countryHint } = await import(
    'file://' + path.resolve(__dirname, '../../js/country-signal.js').replace(/\\/g, '/'));

  const where = DOMAIN
    ? `and exists (select 1 from sectors s where s.domain = $1 and o.sectors::text ilike '%'||s.name||'%')`
    : '';
  const { rows } = await pool.query(`
    select c.id, c."nameKo", c."nameEn", c."orgKo", c."orgEn",
           c.email1, c.email2, c.phone1, c.phone2, o.website
      from contacts c
      left join orgs o on o.id = c.org_id
     where coalesce(c.country, '') in ('', '-') ${where}
     order by c."nameKo", c."orgKo"`, DOMAIN ? [DOMAIN] : []);

  const plan = [];
  const skip = [];
  rows.forEach(c => {
    const h = countryHint(c);
    if(h) plan.push({ c, ...h }); else skip.push(c);
  });

  const by = new Map();
  plan.forEach(p => {
    const k = `${p.country} · ${p.why}`;
    by.set(k, (by.get(k) || 0) + 1);
  });
  console.log(`대상 ${rows.length}명 (국가 빈칸${DOMAIN ? ` · 분야 ${DOMAIN}` : ''})`);
  [...by.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
  console.log(`  ${String(skip.length).padStart(4)}  판단할 자료 없음 (그대로 둠)`);

  /* 한국이 아닌 판정은 전부 찍어 둔다 — 수가 적고, 틀리면 눈에 띄어야 한다 */
  plan.filter(p => p.country !== '대한민국').forEach(p => console.log(
    `  해외 → ${p.country} (${p.why}) : ${p.c.nameKo || p.c.nameEn} · ${p.c.orgEn || p.c.orgKo} · ${p.c.phone1 || ''} ${p.c.email1 || ''}`));

  if(DRY){ console.log('\n--dry 라 아무것도 쓰지 않았습니다.'); await pool.end(); return; }

  let n = 0;
  for(const p of plan){
    /* 그 사이에 누가 값을 넣었으면 건드리지 않는다 — 조건을 update에도 건다 */
    const r = await pool.query(
      `update contacts set country = $1 where id = $2 and coalesce(country,'') in ('','-')`,
      [p.country, p.c.id]);
    n += r.rowCount;
  }
  console.log(`\n${n}명의 국가를 채웠습니다.`);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
