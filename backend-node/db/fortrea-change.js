/* ══════════════════════════════════════════════════════════════
   fortrea-change.js — 포트리아 코리아 비품 변경 요청 반영

   취소 4건은 카드 부분 취소로 환불하고, 추가 4건을 새로 신청받았다.

   취소한 품목은 지운다. 청구 제외로 남겨 두면 발주 집계에는 수량이 그대로
   남아 취소한 정수기를 주문하게 된다. 대신 무엇을 언제 뺐는지 활동 로그에
   남겨 되짚을 수 있게 한다.

   환불은 '요청' 상태로 넣는다 — 카드 부분 취소가 실제로 승인되기 전에 입금액에서
   빼면 아직 나가지 않은 돈이 나간 것처럼 보인다. 승인되면 화면에서 체크한다.

     node db/fortrea-change.js --dry
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EVENT = '2026 KIC';
const EXH = 'X-1787561569304_45';   // 포트리아 코리아 유한회사 (13-14)
const TODAY = new Date().toISOString().slice(0, 10);

/* 코드로 지목한다 — 이름은 표기가 흔들려 엉뚱한 줄을 지울 수 있다 */
const CANCEL = [
  { code: 'E-080', qty: 1, label: 'Water Dispenser' },
  { code: 'O-001', qty: 4, label: 'Water' },
  { code: 'T-133', qty: 1, label: 'High Glossy Table 1200' },
  { code: 'C-170', qty: 2, label: 'VIP Sofa 2p' },
];

const ADD = [
  { code: 'T-070', qty: 3, cat: 'equip' },
  { code: 'D-030', qty: 1, cat: 'equip' },
  { code: 'C-040', qty: 2, cat: 'equip' },
  // 카탈로그에 없는 그래픽 — 이미 같은 품목이 $88에 들어와 있어 그 단가를 쓴다
  { name: 'Information Desk Wrapping (PET)', qty: 1, unit: 88, cat: 'graphic' },
];

const num = (v) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;
const log = async (client, action, detail) => {
  if (DRY) return;
  await client.query(
    `INSERT INTO activity_log (id, ts, email, name, type, action, target, detail)
     VALUES ($1,$2,'','변경 요청 반영','edit',$3,$4,$5)`,
    [`AL-ft-${Date.now()}-${Math.floor(Math.random() * 1000)}`, new Date().toISOString(),
      action, '포트리아 코리아 유한회사', detail]);
};

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const x = (await client.query('SELECT * FROM exhibitors WHERE id=$1', [EXH])).rows[0];
    if (!x) throw new Error('포트리아 참가기업을 찾을 수 없습니다.');
    const cur = 'USD';   // 이 기업은 달러로 청구한다(인보이스도 USD)

    const cat = (await client.query('SELECT * FROM equip_catalog WHERE event_id=$1', [EVENT])).rows;
    const byCode = new Map(cat.map((c) => [String(c.code).toUpperCase(), c]));
    const items = (await client.query(
      'SELECT * FROM exhibitor_items WHERE exhibitor_id=$1', [EXH])).rows;

    /* ── ① 취소 ── */
    let refund = 0;
    console.log('\n[취소]');
    for (const c of CANCEL) {
      const hit = items.filter((i) => String(i.name || '').toUpperCase().includes(c.code));
      if (hit.length !== 1) {
        throw new Error(`${c.code} 항목이 ${hit.length}건 — 하나로 지목되지 않아 중단합니다.`);
      }
      const i = hit[0];
      if (num(i.qty) !== c.qty) {
        throw new Error(`${c.code} 수량이 ${i.qty}로 요청(${c.qty})과 달라 중단합니다.`);
      }
      refund += num(i.amount);
      if (!DRY) await client.query('DELETE FROM exhibitor_items WHERE id=$1', [i.id]);
      await log(client, '비품 취소', `<b>포트리아 코리아 유한회사</b> ${c.code} ${c.label} ×${c.qty} 취소 ($${num(i.amount)})`);
      console.log(`   ${c.code} ${c.label} ×${c.qty}  $${num(i.amount)}`);
    }
    console.log(`   취소 합계 $${refund}`);

    /* ── ② 추가 ── */
    let added = 0;
    console.log('\n[추가]');
    let n = 0;
    for (const a of ADD) {
      const c = a.code ? byCode.get(a.code) : null;
      if (a.code && !c) throw new Error(`${a.code}를 카탈로그에서 찾을 수 없습니다.`);
      const unit = c ? num(c.price_usd) : a.unit;
      if (!unit) throw new Error(`${a.code || a.name} 단가를 알 수 없습니다.`);
      const amount = unit * a.qty;
      const name = c ? `${c.code} ${c.name_en || c.name_ko}` : a.name;

      const rec = {
        id: `XI-ft-${TODAY.replace(/-/g, '')}-${++n}`, exhibitor_id: EXH, category: a.cat,
        name, qty: String(a.qty), unit_price: String(unit), amount: String(amount), currency: cur,
        note: `${TODAY} 추가 신청`, sort_order: String(90 + n),
        catalog_id: c ? c.id : '', billable: '', shared_ref: '',
      };
      if (!DRY) {
        const cols = Object.keys(rec);
        await client.query(
          `INSERT INTO exhibitor_items (${cols.map((k) => `"${k}"`).join(',')})
           VALUES (${cols.map((_, k) => `$${k + 1}`).join(',')})`, cols.map((k) => rec[k]));
      }
      await log(client, '비품 추가', `<b>포트리아 코리아 유한회사</b> ${name} ×${a.qty} 추가 ($${amount})`);
      added += amount;
      console.log(`   ${name} ×${a.qty} @$${unit}  $${amount}`);
    }
    console.log(`   추가 합계 $${added}`);

    /* ── ③ 환불 요청 ── */
    const already = (await client.query(
      `SELECT id FROM exhibitor_payments WHERE exhibitor_id=$1 AND kind='refund' AND amount=$2`,
      [EXH, String(refund)])).rows;
    if (!already.length) {
      const rec = {
        id: `XP-ft-${TODAY.replace(/-/g, '')}`, exhibitor_id: EXH, invoice_id: '',
        paid_at: '', requested_at: TODAY, amount: String(refund), currency: cur,
        kind: 'refund', status: 'requested',
        reason: `카드 결제 부분 취소 — ${CANCEL.map((c) => `${c.code}×${c.qty}`).join(', ')}`,
        method: '카드 부분 취소', note: '',
      };
      if (!DRY) {
        const cols = Object.keys(rec);
        await client.query(
          `INSERT INTO exhibitor_payments (${cols.map((k) => `"${k}"`).join(',')})
           VALUES (${cols.map((_, k) => `$${k + 1}`).join(',')})`, cols.map((k) => rec[k]));
      }
      console.log(`\n[환불] 요청 $${refund} — 카드 부분 취소 (승인되면 화면에서 완료 체크)`);
    } else console.log('\n[환불] 같은 금액의 환불이 이미 있어 넣지 않았습니다');

    /* ── 결과 ── */
    const after = (await client.query(
      `SELECT * FROM exhibitor_items WHERE exhibitor_id=$1 AND COALESCE(billable,'')<>'no'`, [EXH])).rows;
    /* --dry 에서는 실제로 지우고 넣지 않았으므로 조회값이 변경 전 상태다.
       계산으로 보여줘야 미리보기가 실제 결과와 같아진다. */
    const itemSum = after.filter((i) => (i.currency || 'KRW') === cur).reduce((a, i) => a + num(i.amount), 0)
      + (DRY ? added - refund : 0);
    const invSum = (await client.query(
      `SELECT COALESCE(SUM(NULLIF(regexp_replace(COALESCE(amount,''),'[^0-9.]','','g'),'')::numeric),0) s
         FROM exhibitor_invoices WHERE exhibitor_id=$1 AND COALESCE(status,'')<>'void' AND currency=$2`,
      [EXH, cur])).rows[0].s;
    const paid = (await client.query(
      `SELECT COALESCE(SUM(NULLIF(regexp_replace(COALESCE(amount,''),'[^0-9.]','','g'),'')::numeric),0) s
         FROM exhibitor_payments WHERE exhibitor_id=$1 AND currency=$2 AND COALESCE(kind,'in')<>'refund'`,
      [EXH, cur])).rows[0].s;

    console.log(`\n변경 후`);
    console.log(`   항목 합계 $${itemSum}   (취소 −$${refund} / 추가 +$${added} → 차액 ${added - refund >= 0 ? '+' : ''}$${added - refund})`);
    console.log(`   인보이스 $${Number(invSum)}  ← 아직 옛 금액입니다`);
    console.log(`   입금     $${Number(paid)}`);

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
