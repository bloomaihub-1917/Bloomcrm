/* 행사 참여 기록을 지운다 — 지우기 전에 파일로 남긴다.

   참여 기록은 «그 행사에 걸었다»는 사실이라, 잘못 지우면 누구를 불렀는지가
   통째로 사라진다. 되돌릴 방법이 없으면 지우는 일 자체가 위험해지므로,
   지운 줄을 그대로 JSON으로 적어 두고 그 경로를 알려 준다.

   연락처와 기업, CRM 타겟은 건드리지 않는다 — 다른 표에 있고, 행사에 안
   걸렸다고 창고에서 빠질 이유가 없다.

     node db/clear-participations.js <행사id> [--role=참가자] [--matched=...] [--dry]

   예)
     node db/clear-participations.js EVK --dry
     node db/clear-participations.js AIA --role=참가자                      */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const EVENT = args.find((a) => !a.startsWith('--'));
const argVal = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const ROLE = argVal('role');
const MATCHED = argVal('matched');

if (!EVENT) { console.error('행사 id를 주세요 (예: EVK).'); process.exit(1); }

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const where = ['event_id = $1'];
    const vals = [EVENT];
    if (ROLE) { vals.push(ROLE); where.push(`role = $${vals.length}`); }
    if (MATCHED) { vals.push(MATCHED); where.push(`matched = $${vals.length}`); }
    const cond = where.join(' AND ');

    const { rows } = await client.query(
      `SELECT p.*, c."nameKo", c."nameEn", c."orgKo", c."orgEn"
         FROM participations p LEFT JOIN contacts c ON c.id = p.contact_id
        WHERE ${cond.replace(/\bevent_id\b/, 'p.event_id').replace(/\brole\b/, 'p.role')
                   .replace(/\bmatched\b/, 'p.matched')}
        ORDER BY p.id`, vals);

    if (!rows.length) { console.log('지울 기록이 없습니다.'); await client.query('ROLLBACK'); return; }

    const ev = (await client.query(`SELECT short FROM events WHERE id = $1`, [EVENT])).rows[0];
    const byRole = rows.reduce((m, r) => m.set(r.role || '(없음)', (m.get(r.role || '(없음)') || 0) + 1), new Map());
    console.log(`«${(ev && ev.short) || EVENT}»에서 지울 참여 기록 ${rows.length}건`
      + (ROLE ? ` · 역할 ${ROLE}` : '') + (MATCHED ? ` · 출처 ${MATCHED}` : ''));
    [...byRole].forEach(([r, n]) => console.log(`   ${String(r).padEnd(14)} ${n}`));
    console.log(`   사람 ${new Set(rows.map((r) => r.contact_id)).size}명`);
    rows.slice(0, 5).forEach((r) => console.log(
      `   예) ${r.nameKo || r.nameEn || '(이름 없음)'} · ${r.orgKo || r.orgEn || ''}`));

    if (!DRY) {
      const dir = path.join(__dirname, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir,
        `participations_${EVENT.replace(/[^\w가-힣-]/g, '_')}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`);
      fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf-8');
      console.log(`\n지운 줄을 남겨 뒀습니다: ${file}`);

      await client.query(`DELETE FROM participations WHERE ${cond}`, vals);
    }

    const after = await client.query(
      `SELECT COALESCE(e.short, p.event_id) ev, count(*)::int n
         FROM participations p LEFT JOIN events e ON e.id = p.event_id
        GROUP BY 1 ORDER BY 2 DESC`);
    console.log('\n--- 남은 행사별 참여 기록 ---');
    if (!after.rows.length) console.log('  (없음)');
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
