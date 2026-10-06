/* 지켜보는 폴더를 파트로 가른다 — 전시(exh)와 연사(conf).

   연사도 사진·발표자료·CV가 OneDrive 폴더로 들어온다. 같은 행사의 폴더를
   한 목록에 두면 전시 담당이 연사 사진 «확인 필요»를 떠안는다.
   비어 있는 줄(이 칸 전에 만든 폴더)은 전시 것으로 본다. */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`ALTER TABLE watch_folders ADD COLUMN IF NOT EXISTS part TEXT`);
  console.log('✓ watch_folders.part — 전시·연사 가르기');
  await pool.end();
})();
