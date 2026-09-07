/* ══════════════════════════════════════════════════════════════
   backfill-tax-done.js — stage는 비었는데 발행일(sent_at)만 있는 세금계산서를
   'done'으로 채운다

   exhibitors 한 칸짜리 시절에는 "발행 완료" 판정이 tax_sent_at 날짜 유무였고,
   tax_stage(요청→재무팀→완료) 단계 값은 그와 별개로 손으로 넘겨야 했다. 그래서
   날짜만 적고 단계는 안 넘긴 건이 여러 건 있었는데, exhibitor_tax_invoices로
   옮기면서 그 상태 그대로 옮겨졌다 — stage가 비어 있으면 화면에서 "요청 전"으로
   보여 발행 완료 표시가 사라진 것처럼 보인다.

   발행일이 있다는 건 실제로 발행됐다는 뜻이므로 stage를 done으로 채운다.

     node db/backfill-tax-done.js --dry
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

async function main(){
  const { rows } = await pool.query(`
    SELECT t.id, e.company_name, t.sent_at
      FROM exhibitor_tax_invoices t JOIN exhibitors e ON e.id = t.exhibitor_id
     WHERE COALESCE(t.stage,'') = '' AND COALESCE(t.sent_at,'') <> '' AND COALESCE(t.status,'') <> 'void'`);

  console.log(`stage 비어있는데 발행일 있는 건 ${rows.length}건`);
  rows.forEach(r => console.log(`   ${r.company_name.padEnd(24)} 발행일 ${r.sent_at}`));

  if(!rows.length || DRY){ if(DRY) console.log('\n--dry — 실제로 바꾸지 않았습니다.'); return; }

  await pool.query(`
    UPDATE exhibitor_tax_invoices SET stage = 'done'
     WHERE COALESCE(stage,'') = '' AND COALESCE(sent_at,'') <> '' AND COALESCE(status,'') <> 'void'`);
  console.log('\n반영 완료.');
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
