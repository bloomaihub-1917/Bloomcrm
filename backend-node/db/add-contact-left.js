/* 담당자가 회사를 떠났다는 것을 적어 둘 칸을 만든다.

   지금까지는 적을 곳이 없어서 둘 중 하나로 흘러갔다 — 행을 지우거나,
   status를 건드리거나. 둘 다 잃는 게 있다. 지우면 그 사람이 참가했던
   행사 명단이 빈칸이 되고(participations는 성명·소속을 저장하지 않는다),
   status는 재직 여부가 아니라 자료 검증 상태라 섞으면 둘 중 하나가 틀린다.

   left_at     비어 있으면 재직. 날짜가 있으면 그날 퇴사를 확인했다는 뜻.
   moved_to_id 이직한 걸 알아냈을 때, 새 소속으로 만든 연락처 행의 id.

   실행: node db/add-contact-left.js */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS left_at TEXT`);
  console.log('✓ contacts.left_at');
  await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS moved_to_id TEXT`);
  console.log('✓ contacts.moved_to_id');
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_contacts_left ON contacts(left_at)`);
  console.log('✓ idx_contacts_left');

  const r = await pool.query(
    `select count(*)::int n from contacts where coalesce(left_at,'') <> ''`);
  console.log(`\n퇴사 표시된 연락처 ${r.rows[0].n}명`);
  await pool.end();
})();
