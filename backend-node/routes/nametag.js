/* ══════════════════════════════════════════════════════════════
   nametag.js — 네임택 발급 (행사 DB › 네임택 탭)

     GET  /api/nametag/<행사>            판 + 발급 기록(최근 1000장)
     PUT  /api/nametag/<행사>/template   판 저장 { width_mm, height_mm, lang, sheet, layout, print_offset, background_data, background_print }
     POST /api/nametag/<행사>/issue      발급 { cards:[…], reason } → batch_id와 기록
     POST /api/nametag/print/<id>/void   «인쇄 안 됨» 되돌리기(기록은 지우지 않는다)

   bizmatching의 네임택 발급(nametag-package, 2026-11-10)을 옮겨 왔다. 원칙 두 가지는 그대로다.
   - 기록이 먼저, 인쇄는 나중. 브라우저는 인쇄가 실제로 됐는지 알려 주지 않으므로 «인쇄를 지시한 시각»을
     남기고, 안 나왔으면 voided_at으로 되돌린다.
   - 출력물 한 장 = 한 줄. 그때 찍은 이름·소속·직함을 그대로 남긴다(마스터DB가 나중에 바뀌어도 기록은 그대로).

   명단은 서버에서 다시 만들지 않는다. 참가자(participations)·연사(speakers)·부스 인원(exhibitor_contacts)은
   화면이 이미 다 들고 있고, 셋을 합치는 규칙도 화면(js/features/nametag/nt-people.js)에 있다.
   서버는 찍은 값을 받아 길이만 맞춰 저장한다. person_key(c<연락처 id> 또는 s/x<줄 id>)로 «이 사람이 이미
   받았는지»를 센다 — 그래서 한 사람이 연사 겸 참가자여도 한 번 받은 것으로 센다.

   마스터DB는 고치지 않는다. 데스크에서 직함을 고쳐 찍어도 그 값은 이 기록에만 남는다.
   현장 신규(walk_in)도 연락처를 만들지 않는다 — 이름·소속만 기록에 남긴다.
   시험 계정은 쓰지 못한다(이름을 가려 찍을 수는 없다).
══════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');

const router = express.Router();
const newId = (p) => p + Date.now() + crypto.randomBytes(3).toString('hex');
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 10) / 10)) : d; };
const SOURCES = new Set(['part', 'speaker', 'exh']);
const LANGS = new Set(['auto', 'ko', 'en']);
const SHEETS = new Set(['a4', 'a4l', 'fit']);   // 출력 종이: A4 맨 위 가운데 | A4 맨 위 왼쪽 | 네임택 크기 그대로
const REASONS = new Set(['분실', '오타', '훼손', '기타']);

router.use((req, res, next) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 네임택을 쓸 수 없어요' });
  next();
});

const TEMPLATE_COLS = `id, name, width_mm::float8 AS width_mm, height_mm::float8 AS height_mm, lang, sheet,
  background_data, background_print, layout, print_offset, is_default, updated_at, updated_by`;
const PRINT_COLS = `id, event_id, batch_id, template_id, person_key, source, ref_id, contact_id, name, company, job_title,
  badge, lang, kind, reason, printed_by, printed_at, voided_at, voided_by`;

router.get('/:eventId', async (req, res, next) => {
  try {
    const ev = String(req.params.eventId);
    const [t, p] = await Promise.all([
      pool.query(`SELECT ${TEMPLATE_COLS} FROM nametag_templates WHERE event_id = $1 ORDER BY is_default DESC, updated_at DESC LIMIT 1`, [ev]),
      pool.query(`SELECT ${PRINT_COLS} FROM nametag_prints WHERE event_id = $1 ORDER BY printed_at DESC LIMIT 1000`, [ev]),
    ]);
    // 판이 아직 없으면 null — 화면이 코드의 기준값(js/domain/nametag-layout.js)으로 그린다
    res.json({ ok: true, template: t.rows[0] || null, prints: p.rows });
  } catch (e) { next(e); }
});

/* 판 저장 — 행사마다 기본 판 하나를 고쳐 쓴다(설정 › 행사 상세 › 네임택).
   레이아웃의 키·범위는 화면이 읽을 때 normalizeLayout으로 다시 맞추므로, 여기서는 모양만 본다.
   배경은 «글자를 어디에 놓을지» 맞춰 보는 가늠자라 화면이 긴 변 1600px JPEG로 줄여 data URL로 보낸다.
   파일 저장소가 없어 연사 사진(routes/photos.js)처럼 표에 둔다. 한 응답 4.5MB 한도(Vercel) 안에 들게 2MB까지만 받는다. */
const BG_MAX = 2 * 1024 * 1024;
router.put('/:eventId/template', async (req, res, next) => {
  try {
    const ev = String(req.params.eventId);
    const b = req.body || {};
    const layout = b.layout && typeof b.layout === 'object' ? JSON.stringify(b.layout) : null;
    if (!layout || layout.length > 20000) return res.status(400).json({ ok: false, error: '판 모양이 올바르지 않아요' });
    const offset = JSON.stringify({ x: num(b.print_offset?.x, -10, 10, 0), y: num(b.print_offset?.y, -10, 10, 0), scale: num(b.print_offset?.scale, 90, 110, 100) });
    const bg = typeof b.background_data === 'string' && b.background_data ? b.background_data : null;
    if (bg && (!/^data:image\/(jpeg|png|webp);base64,/.test(bg) || bg.length > BG_MAX)) {
      return res.status(400).json({ ok: false, error: '배경 이미지는 JPG·PNG·WebP, 2MB까지예요' });
    }
    const vals = [ev, text(b.name, 40) || '기본 네임택',
      num(b.width_mm, 20, 420, 100), num(b.height_mm, 20, 420, 120),
      LANGS.has(b.lang) ? b.lang : 'auto', layout, offset, new Date().toISOString(), req.user?.email || '',
      bg, !!(bg && b.background_print), SHEETS.has(b.sheet) ? b.sheet : 'a4'];
    const { rows } = await pool.query(`
      INSERT INTO nametag_templates (id, event_id, name, width_mm, height_mm, lang, layout, print_offset, is_default, updated_at, updated_by,
        background_data, background_print, sheet)
      VALUES ('NT-' || md5(random()::text || clock_timestamp()::text), $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, true, $8, $9, $10, $11, $12)
      ON CONFLICT (event_id) WHERE is_default DO UPDATE SET name = EXCLUDED.name, width_mm = EXCLUDED.width_mm,
        height_mm = EXCLUDED.height_mm, lang = EXCLUDED.lang, layout = EXCLUDED.layout, print_offset = EXCLUDED.print_offset,
        background_data = EXCLUDED.background_data, background_print = EXCLUDED.background_print, sheet = EXCLUDED.sheet,
        updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
      RETURNING ${TEMPLATE_COLS}`, vals);
    res.json({ ok: true, template: rows[0] });
  } catch (e) { next(e); }
});

/* 발급 — 기록이 먼저다. 화면은 돌려받은 기록으로 인쇄 창을 그린다 → 기록과 종이가 늘 같다.
   이미 받은(무효 아닌 기록이 있는) 사람이 섞이면 재발급이고, 사유가 있어야 한다. */
router.post('/:eventId/issue', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const ev = String(req.params.eventId);
    const b = req.body || {};
    const raw = Array.isArray(b.cards) ? b.cards : [];
    if (!raw.length) return res.status(400).json({ ok: false, error: '뽑을 사람을 골라 주세요' });
    if (raw.length > 500) return res.status(400).json({ ok: false, error: '한 번에 500장까지 뽑을 수 있어요' });
    const cards = raw.map((c) => {
      const walkIn = c.source === 'walk_in';
      return {
        walkIn, source: walkIn ? 'walk_in' : SOURCES.has(c.source) ? c.source : null,
        person_key: walkIn ? null : text(c.person_key, 60) || null,
        ref_id: walkIn ? null : text(c.ref_id, 60) || null,
        contact_id: walkIn ? null : text(String(c.contact_id ?? ''), 20) || null,
        name: text(c.name, 60), company: text(c.company, 80), job_title: text(c.job_title, 60) || null,
        badge: text(c.badge, 30) || null, lang: c.lang === 'en' ? 'en' : 'ko',
      };
    });
    if (cards.some((c) => !c.source || (!c.walkIn && !c.person_key))) return res.status(400).json({ ok: false, error: '명단에 없는 사람이 섞여 있어요. 화면을 새로 고쳐 주세요' });
    if (cards.some((c) => !c.name)) return res.status(400).json({ ok: false, error: '이름이 빈 네임택이 있어요' });
    const reason = REASONS.has(b.reason) ? b.reason : null;

    const keys = cards.filter((c) => c.person_key).map((c) => c.person_key);
    const { rows: had } = keys.length ? await client.query(
      `SELECT DISTINCT person_key FROM nametag_prints WHERE event_id = $1 AND voided_at IS NULL AND person_key = ANY($2)`, [ev, keys]) : { rows: [] };
    const already = new Set(had.map((r) => r.person_key));
    if (already.size && !reason) {
      return res.status(409).json({ ok: false, error: '이미 네임택을 받은 사람이 있어요. 재발급 사유를 골라 주세요', need_reason: [...already] });
    }

    const tpl = await client.query(`SELECT id FROM nametag_templates WHERE event_id = $1 AND is_default`, [ev]);
    const templateId = tpl.rows[0]?.id || null;
    const batch = newId('NB-');
    const at = new Date().toISOString();
    const by = req.user?.email || '';
    await client.query('BEGIN');
    const out = [];
    for (const c of cards) {
      const kind = c.walkIn ? 'walk_in' : already.has(c.person_key) ? 'reissue' : 'issue';
      const { rows: [r] } = await client.query(`
        INSERT INTO nametag_prints (id, event_id, batch_id, template_id, person_key, source, ref_id, contact_id,
          name, company, job_title, badge, lang, kind, reason, printed_by, printed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING ${PRINT_COLS}`,
      [newId('NP-'), ev, batch, templateId, c.person_key, c.source, c.ref_id, c.contact_id,
        c.name, c.company, c.job_title, c.badge, c.lang, kind, kind === 'issue' ? null : reason, by, at]);
      out.push(r);
    }
    const re = out.filter((r) => r.kind === 'reissue').length;
    const wi = out.filter((r) => r.kind === 'walk_in').length;
    await client.query(`INSERT INTO activity_log (id, ts, email, name, type, action, target, detail)
      VALUES ($1,$2,$3,$4,'create','네임택 발급',$5,$6)`,
    [newId('L-'), at, by, req.user?.name || '', ev,
      `${out.length}장${re ? ` (재발급 ${re} · ${reason})` : ''}${wi ? ` · 현장 신규 ${wi}` : ''} — ${out.slice(0, 5).map((r) => r.name).join(', ')}${out.length > 5 ? ' 외' : ''}`]);
    await client.query('COMMIT');
    res.json({ ok: true, batch_id: batch, prints: out });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally { client.release(); }
});

router.post('/print/:id/void', async (req, res, next) => {
  try {
    const at = new Date().toISOString();
    const { rows } = await pool.query(`UPDATE nametag_prints SET voided_at = $2, voided_by = $3
      WHERE id = $1 AND voided_at IS NULL RETURNING ${PRINT_COLS}`, [String(req.params.id), at, req.user?.email || '']);
    if (!rows[0]) return res.status(404).json({ ok: false, error: '이미 되돌렸거나 없는 기록이에요' });
    await pool.query(`INSERT INTO activity_log (id, ts, email, name, type, action, target, detail)
      VALUES ($1,$2,$3,$4,'update','네임택 인쇄 안 됨',$5,$6)`,
    [newId('L-'), at, req.user?.email || '', req.user?.name || '', rows[0].event_id || '', `${rows[0].name} (${rows[0].company || ''})`]);
    res.json({ ok: true, print: rows[0] });
  } catch (e) { next(e); }
});

module.exports = router;
