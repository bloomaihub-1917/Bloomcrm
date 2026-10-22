/* 연사의 발표 영상 게재 동의 — 행사가 끝난 뒤에 따로 묻는다.

   행사 전 동의서의 «영상(consent_video)»은 심포지엄 운영 목적의 동의라,
   끝난 뒤 영상을 홈페이지·교육 자료로 올릴 때는 다시 묻는다(AIA는 메일
   회신으로 받았다, 2026-10-22). 받은 동의서와 섞으면 «언제 무엇에 동의했나»가
   흐려지므로 칸을 따로 둔다.
     video_publish    'yes' | 'no' | '' (미확인)
     video_publish_at 회신 받은 날 */
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`ALTER TABLE speakers ADD COLUMN IF NOT EXISTS video_publish TEXT`);
  await pool.query(`ALTER TABLE speakers ADD COLUMN IF NOT EXISTS video_publish_at TEXT`);
  console.log('✓ speakers.video_publish · video_publish_at — 발표 영상 게재 동의');
  await pool.end();
})();
