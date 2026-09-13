/* ══════════════════════════════════════════════════════════════
   restore-bredis-booth.js — 지워진 부스 금액 한 줄을 되살린다

   ㈜브레디스헬스케어(부스 25)의 부스 줄이 2026-09-13 오전에 사라졌다.
   활동 기록에는 남아 있지 않다 — 금액 항목 삭제는 그동안 아무것도 적지
   않았기 때문이다. 그래서 남은 흔적으로 되짚었다.

     · 인보이스 EX-25-01 = 291,500원 (08-10 발송)
     · 남아 있는 청구 항목 = 82,500 + 44,000 = 126,500원
     · 차이 = 165,000원

     · 남은 줄의 sort_order가 2·3·4 — 1번 자리가 비어 있다
     · 부스는 Self-Construction 1개, 행사의 자체시공 단가는 165,000원
     · 다른 자체시공 기업들도 모두 sort_order 1 · 단가 165,000 · KRW

   세 갈래가 같은 줄을 가리킨다. 126,500 + 165,000 = 291,500으로 인보이스와
   정확히 맞는다.

   id는 새로 만든다 — 원래 id는 알 길이 없고, 인보이스는 항목 id가 아니라
   금액으로 이어져 있어 되살아난 줄이 새 id를 가져도 어긋나지 않는다.

     node db/restore-bredis-booth.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const EXH = 'X-1787561569303_1';

(async () => {
  try {
    const dup = await pool.query(
      `SELECT id FROM exhibitor_items WHERE exhibitor_id=$1 AND category='booth'`, [EXH]);
    if (dup.rows.length) {
      console.log('이미 부스 줄이 있어요 — 아무것도 하지 않았습니다:', dup.rows.map(r => r.id).join(', '));
      return;
    }
    const id = 'XI-' + Date.now() + '_r1';
    await pool.query(
      `INSERT INTO exhibitor_items
        (id, exhibitor_id, category, name, qty, unit_price, amount, currency, sort_order, note)
       VALUES ($1,$2,'booth','Self-Construction','1','165000','165000','KRW','1',$3)`,
      [id, EXH, '2026-09-13 삭제된 줄을 인보이스·부스 배정으로 되짚어 복구']);

    const items = (await pool.query(
      `SELECT name, amount, billable FROM exhibitor_items WHERE exhibitor_id=$1 ORDER BY sort_order`, [EXH])).rows;
    const billed = items.filter(i => i.billable !== 'no')
      .reduce((s, i) => s + Number(i.amount || 0), 0);
    console.log('복구 완료:', id);
    items.forEach(i => console.log(`   ${i.billable === 'no' ? '(제외)' : '     '} ${i.name} — ${Number(i.amount).toLocaleString()}원`));
    console.log(`   청구 합계 ${billed.toLocaleString()}원 / 인보이스 291,500원 — ${billed === 291500 ? '일치합니다' : '어긋납니다!'}`);
  } catch (e) {
    console.error('실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end?.();
  }
})();
