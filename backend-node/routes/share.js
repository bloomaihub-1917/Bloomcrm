/* ══════════════════════════════════════════════════════════════
   share.js — 연사 프로그램·수급 현황 바깥 공유

     프로그램   GET /d/<행사>/program   공개(웹디렉토리처럼 누구나) — 확정 연사만
     수급 현황  GET /s/<열쇠>           비밀 링크 — 주최사에만 보낸다. 새 링크를 만들면 옛 링크는 막힌다

   무엇을 받았는지 판정하는 규칙은 CRM 화면(conf-tab.js spCell) 한 곳에만 있다. 서버에 한 벌 더
   두면 둘이 다른 답을 낸다 — 그래서 화면이 계산한 결과(스냅숏)를 올리고, 여기서는 그대로 그린다.
   컨퍼런스 탭이 다시 그려질 때 바뀐 게 있으면 화면이 저절로 다시 올린다(speaker-share.js).

   스냅숏에는 연락처·연사료·계좌번호·여권번호를 담지 않는다(화면이 애초에 안 넣는다).
══════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');

const KINDS = ['program', 'supply'];
let ready = null;
const ensure = () => ready || (ready = pool.query(`CREATE TABLE IF NOT EXISTS public_shares (
    event_id TEXT, kind TEXT, token TEXT, enabled TEXT, data TEXT, updated_at TEXT, updated_by TEXT,
    PRIMARY KEY (event_id, kind))`).catch((e) => { ready = null; throw e; }));

const slugify = (v) => String(v || '').toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const newToken = () => crypto.randomBytes(15).toString('base64url');
const kstStamp = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

/* 화면에 내려 줄 모양 — 열쇠는 수급 현황만(프로그램은 행사 주소로 연다) */
const shape = (eventId, kind, r) => ({
  kind, enabled: !!(r && r.enabled === 'yes'),
  path: kind === 'program' ? `/d/${slugify(eventId)}/program` : (r && r.token ? `/s/${r.token}` : ''),
  updated_at: (r && r.updated_at) || '', updated_by: (r && r.updated_by) || '',
  has_data: !!(r && r.data),
});

const router = express.Router();

router.get('/:eventId', async (req, res) => {
  const eventId = String(req.params.eventId);
  try {
    await ensure();
    const rows = (await pool.query('SELECT * FROM public_shares WHERE event_id = $1', [eventId])).rows;
    const out = {};
    KINDS.forEach((k) => { out[k] = shape(eventId, k, rows.find((r) => r.kind === k)); });
    res.json({ ok: true, shares: out });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* 켜기·끄기·새 링크 */
router.put('/:eventId/:kind', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 바꿀 수 없어요' });
  const eventId = String(req.params.eventId), kind = req.params.kind;
  if (!KINDS.includes(kind)) return res.status(400).json({ ok: false, error: '모르는 공유예요' });
  const { enabled, renew } = req.body || {};
  try {
    await ensure();
    const prev = (await pool.query('SELECT * FROM public_shares WHERE event_id = $1 AND kind = $2', [eventId, kind])).rows[0];
    const token = (!prev || !prev.token || renew) ? newToken() : prev.token;
    const on = enabled === undefined ? (prev ? prev.enabled : '') : (enabled ? 'yes' : '');
    await pool.query(`INSERT INTO public_shares (event_id, kind, token, enabled, data, updated_at, updated_by)
      VALUES ($1,$2,$3,$4,'','','') ON CONFLICT (event_id, kind) DO UPDATE SET token = $3, enabled = $4`,
    [eventId, kind, token, on]);
    const r = (await pool.query('SELECT * FROM public_shares WHERE event_id = $1 AND kind = $2', [eventId, kind])).rows[0];
    res.json({ ok: true, share: shape(eventId, kind, r) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* 화면이 계산한 스냅숏을 올린다 */
router.post('/:eventId/:kind/data', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 바꿀 수 없어요' });
  const eventId = String(req.params.eventId), kind = req.params.kind;
  if (!KINDS.includes(kind)) return res.status(400).json({ ok: false, error: '모르는 공유예요' });
  const data = req.body && req.body.data;
  if (!data || typeof data !== 'object') return res.status(400).json({ ok: false, error: '내용이 없어요' });
  const text = JSON.stringify(data);
  if (text.length > 3e6) return res.status(413).json({ ok: false, error: '내용이 너무 커요' });
  try {
    await ensure();
    const at = kstStamp(Date.now()), by = req.user?.name || req.user?.email || '';
    const u = await pool.query(`UPDATE public_shares SET data = $3, updated_at = $4, updated_by = $5
      WHERE event_id = $1 AND kind = $2`, [eventId, kind, text, at, by]);
    if (!u.rowCount) return res.status(404).json({ ok: false, error: '먼저 공유를 켜 주세요' });
    res.json({ ok: true, updated_at: at });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* 공개 화면이 읽는다 */
async function shareBySlug(slug, kind) {
  await ensure();
  const want = slugify(slug);
  const { rows } = await pool.query(`SELECT s.*, e.name AS event_name, e.date_start, e.date_end, e.location, e.homepage
    FROM public_shares s JOIN events e ON e.id = s.event_id WHERE s.kind = $1 AND s.enabled = 'yes'`, [kind]);
  return rows.find((r) => slugify(r.event_id) === want) || null;
}
async function shareByToken(token) {
  await ensure();
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(String(token || ''))) return null;
  return (await pool.query(`SELECT s.*, e.name AS event_name, e.date_start, e.date_end, e.location
    FROM public_shares s JOIN events e ON e.id = s.event_id
   WHERE s.kind = 'supply' AND s.token = $1 AND s.enabled = 'yes'`, [token])).rows[0] || null;
}

module.exports = router;
module.exports.shareBySlug = shareBySlug;
module.exports.shareByToken = shareByToken;
module.exports.slugify = slugify;
