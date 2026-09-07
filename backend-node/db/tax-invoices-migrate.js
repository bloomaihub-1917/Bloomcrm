/* ══════════════════════════════════════════════════════════════
   tax-invoices-migrate.js — 세금계산서를 exhibitors 한 칸에서
   exhibitor_tax_invoices 1:N 테이블로 옮긴다

   인보이스처럼 세금계산서도 나눠 발행하거나(부스+비품 먼저, 그래픽 나중)
   통화·금액을 잘못 적어 수정 발행하는 일이 있는데, exhibitors에는
   tax_stage/tax_sent_at/tax_amount 한 칸씩만 있어 두 번째 건을 적을 곳이
   없었다. exhibitor_invoices와 같은 모양의 새 테이블을 만들고 기존 값을
   옮긴 뒤, exhibitors의 옛 칸은 지운다.

     node db/tax-invoices-migrate.js --dry
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

async function main(){
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS exhibitor_tax_invoices (
        id            TEXT PRIMARY KEY,
        exhibitor_id  TEXT,
        title         TEXT,
        stage         TEXT,
        requested_at  TEXT,
        to_finance_at TEXT,
        sent_at       TEXT,
        amount        TEXT,
        currency      TEXT,
        status        TEXT,
        void_note     TEXT,
        note          TEXT
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_exhibitor_tax_invoices_exh ON exhibitor_tax_invoices(exhibitor_id)`);

    const { rows: toMove } = await client.query(`
      SELECT id, company_name, tax_stage, tax_requested_at, tax_to_finance_at, tax_sent_at, tax_amount
        FROM exhibitors
       WHERE COALESCE(tax_stage,'') <> '' OR COALESCE(tax_sent_at,'') <> '' OR COALESCE(tax_amount,'') <> ''
          OR COALESCE(tax_requested_at,'') <> '' OR COALESCE(tax_to_finance_at,'') <> ''`);

    console.log(`옮길 세금계산서 ${toMove.length}건`);
    toMove.forEach(r => console.log(
      `   ${String(r.company_name).padEnd(24)} stage=${r.tax_stage || '(없음)'} 금액=${r.tax_amount || '(없음)'} 발행일=${r.tax_sent_at || '(없음)'}`));

    if(!DRY){
      await client.query(`
        INSERT INTO exhibitor_tax_invoices (id, exhibitor_id, title, stage, requested_at, to_finance_at, sent_at, amount, currency, status)
        SELECT 'XT-' || id, id, '세금계산서', tax_stage, tax_requested_at, tax_to_finance_at, tax_sent_at, tax_amount, 'KRW', ''
          FROM exhibitors
         WHERE COALESCE(tax_stage,'') <> '' OR COALESCE(tax_sent_at,'') <> '' OR COALESCE(tax_amount,'') <> ''
            OR COALESCE(tax_requested_at,'') <> '' OR COALESCE(tax_to_finance_at,'') <> ''
        ON CONFLICT (id) DO NOTHING`);

      await client.query(`ALTER TABLE exhibitors DROP COLUMN IF EXISTS tax_stage`);
      await client.query(`ALTER TABLE exhibitors DROP COLUMN IF EXISTS tax_sent_at`);
      await client.query(`ALTER TABLE exhibitors DROP COLUMN IF EXISTS tax_amount`);
      await client.query(`ALTER TABLE exhibitors DROP COLUMN IF EXISTS tax_requested_at`);
      await client.query(`ALTER TABLE exhibitors DROP COLUMN IF EXISTS tax_to_finance_at`);
    }

    if(DRY){ await client.query('ROLLBACK'); console.log('\n--dry 라서 되돌렸습니다.'); }
    else { await client.query('COMMIT'); console.log('\n반영 완료 — exhibitors의 옛 tax_* 칼럼은 지웠습니다.'); }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main().finally(() => pool.end());
