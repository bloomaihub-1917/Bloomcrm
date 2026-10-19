/* ══════════════════════════════════════════════════════════════
   fix-usd-payment-log-unit.js — 달러 입금 기록의 단위를 바로잡는다 (2026-10-19)

   입금 확인 기록은 통화를 안 보고 «N원»으로, 입금 금액 수정 기록은 단위 없이
   적었다. 달러 입금이 «1,436원», «1739 → 1766»으로 남았다.
   그 입금 줄의 통화가 USD인 기록만 «$1,436», «$1,739 → $1,766»으로 고친다.

     node db/fix-usd-payment-log-unit.js          (시험)
     node db/fix-usd-payment-log-unit.js --apply
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');
const APPLY = process.argv.includes('--apply');
const usd = (s) => { const n = Number(String(s).replace(/[$,\s]/g, '')); return isFinite(n) && String(s).trim() !== '' ? '$' + n.toLocaleString('en-US') : s; };

(async () => {
  const client = await pool.connect();
  try {
    const cur = new Map((await client.query(`SELECT id, currency FROM exhibitor_payments`)).rows.map(r => [r.id, r.currency]));
    const logs = (await client.query(`SELECT id, action, detail, link FROM activity_log WHERE action IN ('입금 확인', '입금 수정')`)).rows;
    const fixes = [];
    for (const l of logs) {
      let k; try { k = JSON.parse(l.link || '{}'); } catch { continue; }
      const c = k.after?.currency || cur.get(k.row);
      if (c !== 'USD') continue;
      let d = l.detail;
      if (l.action === '입금 확인') d = d.replace(/입금 \$?([\d,.]+)원 확인/, (_, n) => `입금 ${usd(n)} 확인`);
      else if (k.field === 'amount') d = d.replace(/금액 (\S+) → (\S+)$/, (_, a, b) => `금액 ${a === '(없음)' ? a : usd(a)} → ${b === '(없음)' ? b : usd(b)}`);
      if (d !== l.detail) fixes.push({ id: l.id, from: l.detail, to: d });
    }
    fixes.forEach(f => console.log(`${f.from}\n  → ${f.to}`));
    console.log(`고칠 기록 ${fixes.length}건`);
    if (APPLY) {
      await client.query('BEGIN');
      for (const f of fixes) await client.query(`UPDATE activity_log SET detail = $2 WHERE id = $1`, [f.id, f.to]);
      await client.query('COMMIT');
      console.log('적용했습니다.');
    } else console.log('시험 실행 — --apply로 적용');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); console.error(e.message); process.exitCode = 1; }
  finally { client.release(); await pool.end(); }
})();
