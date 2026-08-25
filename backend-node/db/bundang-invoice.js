/* ══════════════════════════════════════════════════════════════
   bundang-invoice.js — 분당서울대학교병원(39-2) 인보이스·세금계산서 반영

   실제 발행 문서에서 읽은 값이다.
     인보이스 EX-39-2-01   발행 2026-07-27  1,263,250원  납부기한 2026-08-21
     전자세금계산서         작성 2026-08-10  공급가 1,148,409 + 세액 114,841
     공급받는 자 분당서울대학교 병원 (129-82-06989) 전영태 / 02106@snubh.org
     인보이스 수신인 분당서울대학교병원 임상시험센터 (박혜림)

   앞서 넣어 둔 "비품 분담금 한 줄"을 실제 인보이스와 같은 개별 품목으로 바꾼다.
   문서와 화면이 다르면 대조할 때마다 어느 쪽이 맞는지 다시 확인해야 한다.

   비품 줄에는 shared_ref로 39-1을 가리켜 둔다. 양쪽에 수량을 적으면 발주
   집계에서 의자 4개가 8개가 되므로, 금액은 세되 수량은 39-1 것만 센다.

     node db/bundang-invoice.js --dry
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EVENT = '2026 KIC';

const INVOICE = { no: 'EX-39-2-01', sent: '2026-07-27', due: '2026-08-21', amount: '1263250' };
const TAX = { at: '2026-08-10', amount: '1263250', name: '전영태', email: '02106@snubh.org' };
const BIZ_NO = '129-82-06989';
const CONTACT = { name: '박혜림', email: '', role: '실무', note: '임상시험센터 · 인보이스 수신인' };

/* 인보이스에 적힌 그대로. 단가는 정가, 금액은 50% 분담분이다. */
const LINES = [
  { code: '',      name: 'Block System A 3m x 2m x 2.5m(H)', qty: '1', unit: '2400000', amount: '1200000', cat: 'booth' },
  { code: 'C-040', name: 'C-040 Folding Chair',              qty: '4', unit: '11000',   amount: '22000',   cat: 'equip' },
  { code: 'T-013', name: 'T-013 Round Table 650',            qty: '1', unit: '33000',   amount: '16500',   cat: 'equip' },
  { code: 'O-020', name: 'O-020 Catalogue Holder B',         qty: '1', unit: '49500',   amount: '24750',   cat: 'equip' },
];
const SHARE_NOTE = '공동 부스 39 · 50% 분담';

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bd = (await client.query(
      `SELECT * FROM exhibitors WHERE event_id=$1 AND booth_no='39-2'`, [EVENT])).rows[0];
    const snuh = (await client.query(
      `SELECT * FROM exhibitors WHERE event_id=$1 AND booth_no='39-1'`, [EVENT])).rows[0];
    if (!bd || !snuh) throw new Error('39-1 / 39-2 참가기업을 찾을 수 없습니다.');

    const sum = LINES.reduce((a, l) => a + Number(l.amount), 0);
    if (String(sum) !== INVOICE.amount) throw new Error(`품목 합 ${sum} ≠ 인보이스 ${INVOICE.amount}`);
    console.log(`\n품목 합 ${sum.toLocaleString()}원 = 인보이스 금액 ✓`);

    const cat = (await client.query('SELECT * FROM equip_catalog WHERE event_id=$1', [EVENT])).rows;

    /* ── 항목을 인보이스와 같게 다시 넣는다 ── */
    if (!DRY) await client.query('DELETE FROM exhibitor_items WHERE exhibitor_id=$1', [bd.id]);
    let i = 0;
    for (const l of LINES) {
      const c = l.code ? cat.find((k) => String(k.code).toUpperCase() === l.code) : null;
      const rec = {
        id: `XI-bd39-${++i}`, exhibitor_id: bd.id, category: l.cat,
        name: `${l.name} (${SHARE_NOTE})`,
        qty: l.qty, unit_price: l.unit, amount: l.amount, currency: 'KRW',
        note: SHARE_NOTE, sort_order: String(i),
        catalog_id: c ? c.id : '', billable: '',
        // 실물 수량은 39-1이 들고 있다 — 발주 집계에서 두 번 세지 않게
        shared_ref: l.cat === 'equip' ? snuh.id : '',
      };
      if (!DRY) {
        const cols = Object.keys(rec);
        await client.query(
          `INSERT INTO exhibitor_items (${cols.map((c2) => `"${c2}"`).join(',')})
           VALUES (${cols.map((_, k) => `$${k + 1}`).join(',')})`, cols.map((c2) => rec[c2]));
      }
      console.log(`  항목: ${l.name} ×${l.qty}  ${Number(l.amount).toLocaleString()}원${rec.shared_ref ? '  (수량은 39-1에서 셈)' : ''}`);
    }

    /* ── 인보이스 ── */
    const has = (await client.query(
      `SELECT id FROM exhibitor_invoices WHERE exhibitor_id=$1 AND title=$2`, [bd.id, INVOICE.no])).rows;
    if (!has.length) {
      const rec = {
        id: `XV-bd39-01`, exhibitor_id: bd.id, title: INVOICE.no,
        created_at: INVOICE.sent, sent_at: INVOICE.sent, due_date: INVOICE.due,
        amount: INVOICE.amount, currency: 'KRW', status: '', void_note: '',
        note: '서울대학교병원(39-1)과 부스 공동 사용 · 비용 50% 분담',
      };
      if (!DRY) {
        const cols = Object.keys(rec);
        await client.query(
          `INSERT INTO exhibitor_invoices (${cols.map((c) => `"${c}"`).join(',')})
           VALUES (${cols.map((_, k) => `$${k + 1}`).join(',')})`, cols.map((c) => rec[c]));
      }
      console.log(`  인보이스: ${INVOICE.no} ${Number(INVOICE.amount).toLocaleString()}원 발송 ${INVOICE.sent} 기한 ${INVOICE.due}`);
    } else console.log('  인보이스 이미 있음 — 건드리지 않습니다');

    /* ── 세금계산서 ── */
    if (!DRY) await client.query(
      `UPDATE exhibitors SET tax_sent_at=$2, tax_amount=$3, tax_contact_name=$4, tax_contact_email=$5,
              pay_due_date=$6, updated_at=$7 WHERE id=$1`,
      [bd.id, TAX.at, TAX.amount, TAX.name, TAX.email, INVOICE.due, new Date().toISOString().slice(0, 10)]);
    console.log(`  세금계산서: ${TAX.at} ${Number(TAX.amount).toLocaleString()}원 · ${TAX.name} (${TAX.email})`);

    /* ── 사업자등록번호 · 담당자 ── */
    if (!DRY && bd.org_id) await client.query(
      `UPDATE orgs SET biz_no=$2, updated_at=$3 WHERE id=$1`,
      [bd.org_id, BIZ_NO, new Date().toISOString()]);
    console.log(`  사업자등록번호: ${BIZ_NO}`);

    const hasC = (await client.query(
      `SELECT id FROM exhibitor_contacts WHERE exhibitor_id=$1`, [bd.id])).rows;
    if (!hasC.length) {
      if (!DRY) await client.query(
        `INSERT INTO exhibitor_contacts (id, exhibitor_id, contact_id, name, email, phone, role, is_primary, note)
         VALUES ($1,$2,'',$3,$4,'',$5,'yes',$6)`,
        [`XC-bd39-1`, bd.id, CONTACT.name, CONTACT.email, CONTACT.role, CONTACT.note]);
      console.log(`  담당자: ${CONTACT.name} (${CONTACT.note})`);
    } else console.log('  담당자 이미 있음');

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
