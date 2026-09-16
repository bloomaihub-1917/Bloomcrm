/* 행사에 걸어 둔 사람들의 소속 기업을 그 행사의 CRM 타겟으로 만든다.

   타겟은 행사마다 따로 쌓인다. 컨택도 제안서도 행사마다 따로 가기 때문에,
   같은 회사라도 행사가 둘이면 줄도 둘이다 — 한 줄로 합치면 «EVENTKOREA는
   미팅까지 갔는데 AIASK는 아직 미접촉»인 상태를 적을 데가 없어진다.

   대상은 «분야에 드는 모든 기업»이 아니라 «이 행사로 만날 상대로 이미
   추려 둔 사람들의 회사»다. 분야 전체를 쓸어 담으면 CRM이 창고의 복사본이
   되고, 그때부터 아무도 그 목록을 보지 않는다.

   이름이 같은 타겟이 그 행사에 이미 있으면 건너뛴다.

     node db/seed-crm-targets.js <행사id> [<행사id> …] [--dry]
     node db/seed-crm-targets.js EVK AIA --dry                             */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EVENTS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!EVENTS.length) { console.error('행사 id를 하나 이상 주세요 (예: EVK AIA).'); process.exit(1); }

/* 본사 — 기업 쪽에 «-»처럼 값이 아닌 것이 들어 있다. 그대로 옮기면
   타겟 목록에 «-»가 줄줄이 남아 빈칸보다 더 시끄럽다. */
const hqOf = (o) => {
  const v = String(o.hq || o.country || '').trim();
  return (v === '-' || v === '--' || v.toLowerCase() === 'n/a') ? '' : v;
};

const key = (v) => String(v || '').trim().toLowerCase()
  .replace(/㈜|\(주\)|주식회사|\(유\)|유한회사/g, '').replace(/\s+/g, '');

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const today = new Date().toISOString().slice(0, 10);
    let seq = 0;
    const stamp = Date.now();
    const report = [];

    for (const evId of EVENTS) {
      const ev = (await client.query(`SELECT id, short, name FROM events WHERE id = $1`, [evId])).rows[0];
      if (!ev) { console.error(`«${evId}» 행사가 없습니다 — 건너뜁니다.`); continue; }

      /* 이 행사에 걸린 사람들의 소속 기업 */
      const { rows: orgs } = await client.query(
        `SELECT DISTINCT o.id, o.name_ko, o.name_en, COALESCE(o.sectors,'') sectors,
                COALESCE(o.hq,'') hq, COALESCE(o.country,'') country, COALESCE(o.kind,'') kind
           FROM participations pp
           JOIN contacts c ON c.id = pp.contact_id
           JOIN orgs o ON o.id = c.org_id
          WHERE pp.event_id = $1`, [evId]);

      /* 그 행사에 이미 있는 타겟 — 이름으로 본다(타겟은 org_id를 안 들고 있다) */
      const { rows: had } = await client.query(
        `SELECT name, "nameEn" FROM crm_targets WHERE event = $1`, [evId]);
      const have = new Set();
      had.forEach((t) => { if (t.name) have.add(key(t.name)); if (t.nameEn) have.add(key(t.nameEn)); });

      let made = 0; let skipped = 0;
      for (const o of orgs) {
        const nm = o.name_ko || o.name_en || '';
        if (!nm) continue;
        if (have.has(key(o.name_ko)) || have.has(key(o.name_en))) { skipped++; continue; }
        const log = [{ type: '메모', date: today, color: '#9C9890',
          text: `${ev.short || ev.id} 참여 명단에서 타겟으로 잡음` }];
        await client.query(
          `INSERT INTO crm_targets
             (id, name, "nameEn", sector, hq, event, role, status, priority,
              assignee, "currentStage", "lastActivity", log)
           VALUES ($1,$2,$3,$4,$5,$6,'','미접촉','mid','',1,$7,$8)`,
          [`T-${stamp}-${seq++}`, o.name_ko || o.name_en, o.name_en || '',
           o.sectors.split('|')[0] || '', hqOf(o), evId, today, JSON.stringify(log)]);
        have.add(key(nm));
        made++;
      }
      report.push({ ev: ev.short || ev.id, orgs: orgs.length, made, skipped });
    }

    console.log('--- 만든 CRM 타겟 ---');
    report.forEach((r) => console.log(
      `  ${String(r.ev).padEnd(18)} 기업 ${String(r.orgs).padStart(4)} → 새로 ${String(r.made).padStart(4)}`
      + (r.skipped ? ` · 이미 있어 건너뜀 ${r.skipped}` : '')));

    const after = await client.query(
      `SELECT COALESCE(e.short, t.event) ev, count(*)::int n
         FROM crm_targets t LEFT JOIN events e ON e.id = t.event
        GROUP BY 1 ORDER BY 2 DESC`);
    console.log('\n--- 행사별 CRM 타겟 ---');
    after.rows.forEach((x) => console.log(`  ${String(x.ev).padEnd(18)} ${x.n}`));

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
