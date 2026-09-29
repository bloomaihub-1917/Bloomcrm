/* ══════════════════════════════════════════════════════════════
   add-work-report.js — 독립부스 시공사의 호텔 작업신고서 제출일

   독립부스(Self-Construction)는 시공사가 호텔에 작업신고서를 내야 반입·시공이
   된다. 낸 곳과 안 낸 곳을 현장 전에 가려 독촉하려고 제출일을 적는다.

     node db/add-work-report.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

(async () => {
  try {
    await pool.query(`ALTER TABLE exhibitors ADD COLUMN IF NOT EXISTS work_report_at TEXT`);
    console.log('칸 준비 완료 — 기존 기업은 빈 칸(미제출)으로 남습니다.');
  } catch (e) {
    console.error('실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end?.();
  }
})();
