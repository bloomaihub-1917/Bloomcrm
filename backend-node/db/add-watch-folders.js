/* ══════════════════════════════════════════════════════════════
   add-watch-folders.js — 지켜보는 폴더 표 두 개를 만든다

   OneDrive 폴더에 무엇이 새로 들어왔는지와, 담당자가 그걸 확인했는지를
   남길 자리다. 자세한 이야기는 schema.sql의 주석에 있다.

     node db/add-watch-folders.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS watch_folders (
      id TEXT PRIMARY KEY, event_id TEXT, name TEXT, path_hint TEXT, note TEXT,
      active TEXT, sort_order INTEGER, scanned_at TEXT, scanned_by TEXT, created_at TEXT)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS watch_files (
      id TEXT PRIMARY KEY, folder_id TEXT, event_id TEXT, rel_path TEXT, name TEXT,
      size TEXT, mtime TEXT, first_seen_at TEXT, changed_at TEXT, gone_at TEXT,
      checked_at TEXT, checked_by TEXT, note TEXT)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_watch_files_folder ON watch_files(folder_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_watch_files_event  ON watch_files(event_id)`);
    console.log('watch_folders · watch_files 준비 완료 — 전시 탭의 「파일 감시」에서 폴더를 등록하세요.');
  } catch (e) {
    console.error('실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end?.();
  }
})();
