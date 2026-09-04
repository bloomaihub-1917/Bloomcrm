/* ══════════════════════════════════════════════════════════════
   data4life-to-usd.js — 데이터포라이프를 USD 청구로 바꾼다

   인보이스가 USD로 발급됐다고 확인받았다. 지금 DB에는 원화로 들어가 있어
   금액 항목의 통화를 USD로 바꾼다.

   금액은 지어내지 않는다. 행사 품목표(equip_catalog)의 USD 단가를 쓰고,
   같은 품목을 USD로 신청한 다른 기업의 값과 맞는지 확인한 것만 바꾼다.

     부스 Octanium (Standard)  1,300,000원 → $930
       (메디안·오리곤이 같은 타입을 $930으로 청구했다)
     E-043 LED TV 55            484,000원 → $484
       (포트리아·오리곤·오라클이 $484로 신청했다)
     O-100 스탠드 행거            22,000원 → $22

   추가배지는 청구 제외 항목이라 합계에 안 들어간다. 통화만 맞춰 둔다 —
   한 기업 안에서 통화가 갈려 있으면 나중에 보는 사람이 헷갈린다.

   인보이스는 건드리지 않는다. 실제 발급된 USD 금액은 사람만 알고,
   지어내면 고객에게 나간 문서와 어긋난다.

     node db/data4life-to-usd.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EXH = 'X-1787561569303_10';   // 데이터포라이프

const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };

/* [지금 원화 금액, 바꿀 USD 금액, 확인용 이름 조각] */
const MAP = [
  [1300000, 930, 'Octanium'],
  [484000, 484, 'E-043'],
  [22000, 22, 'O-100'],
  [50000, 50, '추가배지'],   // 청구 제외 — 합계에 영향 없음
];

(async () => {
  const client = await pool.connect();
  try {
    const { rows: items } = await client.query(
      'SELECT id, category, name, qty, unit_price, amount, currency, billable FROM exhibitor_items WHERE exhibitor_id = $1 ORDER BY category, id',
      [EXH]);

    const plan = [], skip = [];
    for (const i of items) {
      if ((i.currency || 'KRW') === 'USD') { skip.push([i, '이미 USD']); continue; }
      const hit = MAP.find(([krw, , frag]) =>
        num(i.amount) === krw && String(i.name || '').includes(frag));
      if (!hit) { skip.push([i, '짝지을 USD 단가를 못 찾음']); continue; }
      plan.push({ i, usd: hit[1] });
    }

    console.log('데이터포라이프 금액 항목\n');
    plan.forEach(({ i, usd }) => console.log(
      `   ${(i.category || '').padEnd(8)} ${String(num(i.amount).toLocaleString()).padStart(11)}원 → $${usd}`
      + `   ${(i.name || '').slice(0, 34)}${i.billable === 'no' ? '  [청구 제외]' : ''}`));
    if (skip.length) {
      console.log('\n   건드리지 않음');
      skip.forEach(([i, why]) => console.log(`     ${(i.name || '').slice(0, 34)} — ${why}`));
    }

    const billed = plan.filter(({ i }) => i.billable !== 'no').reduce((s, { usd }) => s + usd, 0);
    console.log(`\n   바꾼 뒤 청구 대상 합계: $${billed.toLocaleString()}`);

    const { rows: iv } = await client.query(
      `SELECT id, title, amount, currency, sent_at FROM exhibitor_invoices
        WHERE exhibitor_id = $1 AND COALESCE(status,'') <> 'void'`, [EXH]);
    console.log('\n   인보이스 (건드리지 않음)');
    iv.forEach((v) => console.log(`     ${v.currency || 'KRW'} ${num(v.amount).toLocaleString()} · ${v.title || ''} · 발송 ${v.sent_at || '-'}`));

    if (DRY) { console.log('\n--dry 라서 아무것도 바꾸지 않았습니다.'); return; }

    await client.query('BEGIN');
    let seq = 0;
    for (const { i, usd } of plan) {
      await client.query(
        `UPDATE exhibitor_items SET currency = 'USD', amount = $1, unit_price = $2 WHERE id = $3`,
        [String(usd), num(i.unit_price) ? String(usd / Math.max(1, num(i.qty) || 1)) : '', i.id]);
      await client.query(
        `INSERT INTO activity_log (id, ts, email, name, type, action, target, detail)
         VALUES ($1,$2,'','정리 스크립트','edit','금액 항목 통화 변경','데이터포라이프',$3)`,
        [`L-${Date.now()}-${seq++}`, new Date().toISOString(),
          `<b>${i.name || i.category}</b> KRW ${num(i.amount).toLocaleString()} → USD ${usd}`]);
    }
    await client.query('COMMIT');
    console.log(`\n반영 완료 — ${plan.length}건`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
