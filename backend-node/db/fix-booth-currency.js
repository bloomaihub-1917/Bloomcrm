/* ══════════════════════════════════════════════════════════════
   fix-booth-currency.js — 원화로 청구한 부스비가 USD로 들어간 것을 바로잡는다

   부스 시공비 일부가 통화만 USD로 저장돼 있다. 인보이스는 원화로 끊었는데
   항목만 달러라, 청구액 합계가 통화별로 갈라져 실제보다 적게 잡힌다.

   판단 근거는 국가가 아니라 그 기업의 인보이스 통화다 — 써모 피셔는 미국
   회사인데 원화로 청구했고, 반대 경우도 있어 국가로는 알 수 없다.
   인보이스가 KRW인데 부스 항목이 USD인 건만 고친다.

   금액은 환율로 계산하지 않고, 이미 원화로 들어와 있는 같은 부스 타입의 값을
   그대로 쓴다(아래 RATE). 환산은 근사값이 되지만 실제 청구액은 정해진 단가라
   추정하면 안 된다. 표에 없는 타입은 건드리지 않고 따로 보고한다.

     node db/fix-booth-currency.js --dry
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EVENT = '2026 KIC';

/* 부스 타입별 1부스 단가 — 데이터에 이미 원화로 들어와 있는 값에서 확인했다.
   USD 금액을 단가로 나눠 부스 수를 구하고, 그만큼 원화 단가를 곱한다. */
const RATE = {
  'Self-Construction':   { usd: 120,  krw: 165000 },
  'Octanium (Standard)': { usd: 930,  krw: 1300000 },
  'Block System A':      { usd: 1710, krw: 2400000 },
  'Block System C':      { usd: 2000, krw: 2800000 },
  /* 아래 둘은 원화로 들어온 항목이 없어 처음엔 손대지 못했다. 대신 그 기업의
     원화 인보이스에서 나머지 항목을 빼 역산했다 — 추정이 아니라 실제 청구액이다.
       피에스아이 씨알오  3,615,500 − 비품 115,500 = 3,500,000 (Lighting Booth)
       프리시전 포 메디슨 2,748,500 − 비품 148,500 = 2,600,000 (Block System B)
     A 2,400,000 / B 2,600,000 / C 2,800,000으로 20만원 사다리도 들어맞는다. */
  'Block System B':      { usd: 1860, krw: 2600000 },
  'Lighting Booth':      { usd: 2500, krw: 3500000 },
};

const num = (v) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const rows = (await client.query(`
      SELECT i.id, i.name, i.amount, i.currency, i.unit_price, i.qty,
             e.company_name,
             (SELECT string_agg(DISTINCT v.currency, ',') FROM exhibitor_invoices v
               WHERE v.exhibitor_id = e.id AND COALESCE(v.status,'') <> 'void'
                 AND COALESCE(v.amount,'') <> '') AS inv_cur
        FROM exhibitor_items i JOIN exhibitors e ON e.id = i.exhibitor_id
       WHERE e.event_id = $1 AND i.category = 'booth'
       ORDER BY e.company_name`, [EVENT])).rows;

    const fixed = [];
    const unknown = [];
    const oddKrw = [];

    for (const r of rows) {
      const type = String(r.name || '').trim();
      const rate = RATE[type];
      const amt = num(r.amount);

      // ① 인보이스는 원화인데 항목만 달러
      if (r.currency === 'USD' && r.inv_cur === 'KRW') {
        if (!rate) { unknown.push({ ...r, why: '원화 단가를 확인할 수 없는 부스 타입' }); continue; }
        const n = amt / rate.usd;
        if (!Number.isInteger(n) || n <= 0) {
          unknown.push({ ...r, why: `단가 $${rate.usd}로 나누어떨어지지 않음 (부스 수를 알 수 없음)` });
          continue;
        }
        const krw = n * rate.krw;
        if (!DRY) {
          await client.query(
            `UPDATE exhibitor_items SET currency='KRW', amount=$2, unit_price=$3 WHERE id=$1`,
            [r.id, String(krw), String(rate.krw)]);
        }
        fixed.push({ co: r.company_name, type, n, from: `$${amt}`, to: `${krw.toLocaleString()}원` });
        continue;
      }

      // ② 통화는 원화인데 금액이 달러 숫자로 남아 있는 경우
      if (r.currency === 'KRW' && rate && amt > 0 && amt < rate.krw / 10) {
        const n = amt / rate.usd;
        if (Number.isInteger(n) && n > 0) {
          const krw = n * rate.krw;
          if (!DRY) {
            await client.query(
              `UPDATE exhibitor_items SET amount=$2, unit_price=$3 WHERE id=$1`,
              [r.id, String(krw), String(rate.krw)]);
          }
          fixed.push({ co: r.company_name, type, n, from: `${amt}원(달러 숫자)`, to: `${krw.toLocaleString()}원` });
        } else {
          oddKrw.push(r);
        }
      }
    }

    console.log(`\n부스 항목 ${rows.length}건 중 ${fixed.length}건 정정`);
    fixed.forEach((f) => console.log(
      `   ${String(f.co).padEnd(24)} ${f.type.padEnd(21)} ${f.n}부스  ${String(f.from).padStart(16)} → ${f.to}`));

    if (unknown.length) {
      console.log(`\n⚠ 원화 단가를 알 수 없어 손대지 않은 ${unknown.length}건 — 단가를 알려주시면 반영합니다:`);
      unknown.forEach((u) => console.log(`   ${String(u.company_name).padEnd(24)} ${u.name}  $${num(u.amount)}  (${u.why})`));
    }
    if (oddKrw.length) {
      console.log(`\n⚠ 원화인데 금액이 이상한 ${oddKrw.length}건 — 확인이 필요합니다:`);
      oddKrw.forEach((o) => console.log(`   ${String(o.company_name).padEnd(24)} ${o.name}  ${o.amount}`));
    }

    if (DRY) { await client.query('ROLLBACK'); console.log('\n--dry 라서 되돌렸습니다.'); }
    else { await client.query('COMMIT'); console.log('\n반영 완료.'); }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
