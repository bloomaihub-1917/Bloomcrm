/* ══════════════════════════════════════════════════════════════
   seed-equip-master.js — 행사 품목표에서 전체 품목표를 처음 만든다

   지금까지 품목표는 행사마다 따로였다. 전체 품목표(event_id = '')를 두고
   행사 품목은 그중 고른 사본(base_id)으로 바꾸면서, 이미 있는 행사 품목에서
   전체 품목을 한 번 만들어 잇는다.

   같은 품목 판단: 종류(kind) + 코드. 코드가 없으면 국문명.
   여러 행사에 있으면 가장 최근(행사 키 정렬 마지막) 것을 기본값으로 쓴다.
   이미 base_id가 있는 행은 건너뛴다 — 여러 번 돌려도 된다.

     node db/seed-equip-master.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');
const DRY = process.argv.includes('--dry');

(async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('ALTER TABLE equip_catalog ADD COLUMN IF NOT EXISTS base_id TEXT');
    const rows = (await c.query(`SELECT * FROM equip_catalog ORDER BY event_id, sort_order`)).rows;
    const masters = rows.filter(r => !r.event_id);
    const keyOf = (r) => `${r.kind || 'equip'}|${(r.code || '').trim().toUpperCase() || (r.name_ko || '').trim()}`;
    const byKey = new Map(masters.map(m => [keyOf(m), m]));
    let made = 0, linked = 0, seq = 0;
    const stamp = Date.now();
    for (const r of rows.filter(r => r.event_id && !r.base_id)) {
      let m = byKey.get(keyOf(r));
      if (!m) {
        m = { ...r, id: `EC-${stamp}_m${++seq}`, event_id: '', base_id: '', active: r.active };
        if (!DRY) await c.query(
          `INSERT INTO equip_catalog (id, event_id, category, code, name_ko, name_en, spec, price_krw, price_usd,
             note, active, sort_order, kind, base_id) VALUES ($1,'',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'')`,
          [m.id, m.category, m.code, m.name_ko, m.name_en, m.spec, m.price_krw, m.price_usd, m.note,
            m.active || '', m.sort_order, m.kind || 'equip']);
        byKey.set(keyOf(r), m); made++;
      }
      if (!DRY) await c.query('UPDATE equip_catalog SET base_id = $2 WHERE id = $1', [r.id, m.id]);
      linked++;
    }
    console.log(`전체 품목 새로 ${made}개 · 행사 품목 ${linked}개를 이음`);
    if (DRY) { await c.query('ROLLBACK'); console.log('--dry 라서 되돌렸습니다.'); }
    else { await c.query('COMMIT'); console.log('반영 완료.'); }
  } catch (e) {
    await c.query('ROLLBACK'); console.error('실패 — 되돌렸습니다:', e.message); process.exitCode = 1;
  } finally { c.release(); await pool.end?.(); }
})();
