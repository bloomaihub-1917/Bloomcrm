/* 분야 = 차수 = 담당자 (2026-11-25)
   - contact_rounds.sector: 이 차수가 맡는 분야. 그 분야로 새 기업이 기업DB에 들어오면 이 차수 명단에 자동으로 붙는다(routes/data.js)
   - contact_rounds.owner : 이 분야 담당자. 자동으로 붙은 기업의 담당(round_members.assignee)이 된다
   - orgs.created_by      : 기업을 넣은 사람(메일) — 업로드·손 등록 모두
   이벤트 코리아(EVK) 분야 차수는 차수 이름 = 분야 이름이라 sector를 이름으로 채운다. */
require('dotenv').config();
const pool = require('../pool');
(async () => {
  await pool.query(`ALTER TABLE contact_rounds ADD COLUMN IF NOT EXISTS sector TEXT`);
  await pool.query(`ALTER TABLE contact_rounds ADD COLUMN IF NOT EXISTS owner TEXT`);
  await pool.query(`ALTER TABLE orgs ADD COLUMN IF NOT EXISTS created_by TEXT`);
  const r = await pool.query(`UPDATE contact_rounds r SET sector = r.name
    WHERE r.event_id = 'EVK' AND coalesce(r.sector,'') = ''
      AND EXISTS (SELECT 1 FROM orgs o WHERE o.sectors LIKE '%' || r.name || '%') RETURNING name`);
  console.log('✓ contact_rounds.sector/owner, orgs.created_by');
  console.log('분야 차수로 묶음:', r.rows.map(x => x.name).join(', '));
  await pool.end();
})();
