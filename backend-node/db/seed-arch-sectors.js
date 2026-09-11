/* 건축 분야의 섹터를 심는다.

   분야는 섹터에만 붙는다(연락처·기업이 아니라). 그래서 «건축» 분야를
   만들어 놓고 섹터를 하나도 안 붙이면, 사슬을 다 이어도 도착할 곳이 없다 —
   연락처를 아무리 고쳐도 건축으로 옮겨지지 않는 이유가 이것이다.

   업종 구분은 발주–설계–시공–자재의 흐름을 따랐다. 우리가 만나는 상대가
   그 흐름의 어디에 있는지가 영업에서 실제로 갈리는 지점이기 때문이다.
   이름이 안 맞으면 설정 › 섹터 관리에서 고치면 된다 — 심고 끝이 아니다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DOMAIN = '건축';
const NAMES = [
  '건축설계사무소',
  '종합건설·시공',
  '전문건설',
  '건설엔지니어링·CM',
  '건축자재',
  '실내건축·인테리어',
  '설비·기계',
  '전기·소방',
  '조경',
  '발주처·디벨로퍼',
  '공공기관·협회',
  '학계·연구',
];

const slug = (name, taken) => {
  let base = name.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '').slice(0, 40) || 'sector';
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  return id;
};

const dry = process.argv.includes('--dry');

(async () => {
  const cur = await pool.query('select id, name, domain from sectors');
  const taken = new Set(cur.rows.map(r => r.id));
  const byName = new Map(cur.rows.map(r => [r.name.trim(), r]));

  let made = 0, tagged = 0;
  for (const name of NAMES) {
    const exist = byName.get(name);
    if (exist) {
      /* 같은 이름이 이미 있으면 새로 만들지 않고 분야만 더한다 —
         이름이 겹친 섹터를 둘로 늘리면 기업이 어느 쪽에 붙었는지 갈린다. */
      const doms = String(exist.domain || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
      if (doms.includes(DOMAIN)) { console.log(`= ${name} 이미 ${DOMAIN}`); continue; }
      doms.push(DOMAIN);
      console.log(`${dry ? '· (dry)' : '+'} ${name} 분야에 ${DOMAIN} 더함`);
      if (!dry) await pool.query('update sectors set domain = $1 where id = $2', [doms.join(','), exist.id]);
      tagged++;
      continue;
    }
    const id = slug(name, taken);
    taken.add(id);
    console.log(`${dry ? '· (dry)' : '✓'} ${name} (${id})`);
    if (!dry) {
      await pool.query(
        `insert into sectors (id, name, parent, domain, canonical) values ($1,$2,'',$3,'')
         on conflict (id) do nothing`, [id, name, DOMAIN]);
    }
    made++;
  }
  console.log(`\n새 섹터 ${made} · 분야만 더한 것 ${tagged}`);
  await pool.end();
})();
