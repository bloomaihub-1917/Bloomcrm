/* ══════════════════════════════════════════════════════════════
   photos.js — 연사 사진

   사진 원본은 OneDrive의 연사 폴더에 들어온다. CRM에는 파일명 칸(photo_file)만
   있어서, 얼굴을 보려면 폴더를 열어야 했고 휴대폰에서는 아예 못 봤다.
   서버(Vercel)는 OneDrive를 읽지 못하므로 웹용으로 줄인 사본을 DB에 둔다.

     GET    /api/photos?event_id=AIA   행사 연사 사진 전부 (줄인 것이라 장당 수십 KB)
     PUT    /api/photos/:speakerId     올리기·갈아 끼우기
     DELETE /api/photos/:speakerId

   원본은 여전히 OneDrive가 정본이다 — 인쇄물·현수막에는 그쪽 원본을 쓴다.
   여기 것은 누구인지 알아보는 용도로 긴 변 800px까지만 받는다.

   speakers 줄에 넣지 않고 표를 따로 둔다. 연사 목록은 화면을 열 때마다 통째로
   내려오는데, 거기에 사진이 섞이면 사진을 안 보는 화면까지 무거워진다.

   시험 계정에는 사진을 내주지 않는다 — 이름은 앞 두 글자로 가리면서 얼굴을
   보여주면 가린 의미가 없다(middleware/test-mask.js).
══════════════════════════════════════════════════════════════ */
const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

const PHOTO_MAX = 1024 * 1024;   // 줄인 사본 기준. 800px JPEG는 보통 50~150KB

let ready = null;
const ensure = () => ready || (ready = pool.query(`
  CREATE TABLE IF NOT EXISTS speaker_photos (
    speaker_id TEXT PRIMARY KEY, event_id TEXT, file TEXT, content_type TEXT,
    data TEXT, size INTEGER, updated_at TEXT, author_email TEXT)`)
  .then(() => pool.query('CREATE INDEX IF NOT EXISTS idx_speaker_photos_event ON speaker_photos(event_id)'))
  .catch((e) => { ready = null; throw e; }));

const b64size = (s) => Math.floor(String(s || '').length * 3 / 4);

router.get('/', async (req, res) => {
  if (req.user && req.user.isTest) return res.json({ ok: true, photos: [] });
  const ev = String(req.query.event_id || '');
  if (!ev) return res.status(400).json({ ok: false, error: '행사가 필요해요' });
  try {
    await ensure();
    const r = await pool.query(
      `SELECT speaker_id, file, content_type, data, updated_at
         FROM speaker_photos WHERE event_id = $1`, [ev]);
    res.json({ ok: true, photos: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put('/:speakerId', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 올릴 수 없어요' });
  const { event_id, file, content_type, data } = req.body || {};
  if (!event_id || !data) return res.status(400).json({ ok: false, error: '행사·사진이 필요해요' });
  if (!/^image\/(jpeg|png|webp)$/.test(content_type || '')) {
    return res.status(400).json({ ok: false, error: '사진은 JPG·PNG·WEBP만 받아요' });
  }
  const size = b64size(data);
  if (size > PHOTO_MAX) return res.status(413).json({ ok: false, error: `사진이 너무 커요 (${(size / 1048576).toFixed(1)}MB)` });
  try {
    await ensure();
    const updated_at = new Date().toISOString();
    await pool.query(
      `INSERT INTO speaker_photos (speaker_id, event_id, file, content_type, data, size, updated_at, author_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (speaker_id) DO UPDATE SET event_id = $2, file = $3, content_type = $4, data = $5,
         size = $6, updated_at = $7, author_email = $8`,
      [req.params.speakerId, event_id, String(file || '').slice(0, 200), content_type, data, size,
        updated_at, req.user?.email || '']);
    res.json({ ok: true, photo: { speaker_id: req.params.speakerId, file, content_type, updated_at } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete('/:speakerId', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 지울 수 없어요' });
  try {
    await ensure();
    await pool.query('DELETE FROM speaker_photos WHERE speaker_id = $1', [req.params.speakerId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
