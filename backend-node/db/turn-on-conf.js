/* 기존 행사의 컨퍼런스 파트를 켠다.
   2026 KIC는 앞으로 할 행사라 진행중, 2025 KIC는 이미 끝났고 전시도
   진행완료라 컨퍼런스도 진행완료로 둔다 — 끝난 행사를 진행중이라 적으면
   그게 곧 틀린 기록이 된다.
   settings 줄 전체를 다시 쓰지 않고 parts만 갈아끼운다 — due·book·conf 같은
   다른 키가 같은 JSON에 함께 살고 있다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const WANT = { '2026 KIC': 'doing', '2025 KIC': 'done' };
const dry = process.argv.includes('--dry');

(async () => {
  for(const [evKey, state] of Object.entries(WANT)){
    const key = `exh_cfg_${evKey}`;
    const r = await pool.query('select value from settings where key = $1', [key]);
    let cfg = {};
    if(r.rows.length){
      try { cfg = JSON.parse(r.rows[0].value) || {}; }
      catch(e){ console.log(`  !! ${key} 파싱 실패 — 건너뜀 (${e.message})`); continue; }
    }
    const parts = { ...(cfg.parts || {}) };
    if(parts.conf === state){ console.log(`= ${evKey} 이미 conf=${state}`); continue; }
    const was = parts.conf ?? '(없음)';
    parts.conf = state;
    const next = JSON.stringify({ ...cfg, parts });
    console.log(`${dry ? '· (dry)' : '✓'} ${evKey} conf: ${was} → ${state}`);
    if(dry) continue;
    await pool.query(
      `insert into settings (key, value) values ($1, $2)
       on conflict (key) do update set value = excluded.value`, [key, next]);
  }
  await pool.end();
})();
