/* ══════════════════════════════════════════════════════════════
   add-event-tax-rate.js — events에 국내 연사료 세율 칸(dom_tax_rate)을 붙인다

   국내 연사료에서 뗄 세율은 행사마다 다르다(3.3% 사업소득 · 8.8% 기타소득 — 2026 KIC는 8.8%).
   정산 화면에서 고르고, 지급대장 [국내]와 신한 대량이체 파일이 같은 값을 쓴다.
   비어 있으면 3.3%로 본다. 기존 값은 건드리지 않는다.

     node db/migrations/add-event-tax-rate.js --dry
     node db/migrations/add-event-tax-rate.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('../pool');

const DRY = process.argv.includes('--dry');

async function main(){
  const { rows } = await pool.query(`
    SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'dom_tax_rate'`);
  if(rows.length){ console.log('이미 붙어 있습니다 — 할 일 없음.'); return; }
  console.log('붙일 컬럼: dom_tax_rate (국내 연사료 세율)');
  if(DRY){ console.log('--dry — 실제로 바꾸지 않았습니다.'); return; }
  await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS dom_tax_rate TEXT');
  console.log('완료 — 값은 비어 있습니다(정산 화면에서 고릅니다).');
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
