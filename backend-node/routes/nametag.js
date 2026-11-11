/* ══════════════════════════════════════════════════════════════
   nametag.js — 네임택 발급·하단바·체크인 (행사 DB › 네임택 탭)

     GET  /api/nametag/<행사>               판 + 발급 기록 + 사람(하단바) + 살아 있는 체크인
     PUT  /api/nametag/<행사>/template      판 저장 { width_mm, height_mm, lang, sheet, layout, print_offset, background_data, background_print, bar_types }
     POST /api/nametag/<행사>/issue         발급 { cards:[…], reason, onsite } → batch_id와 기록
     POST /api/nametag/print/<id>/void      «인쇄 안 됨» 되돌리기(기록은 지우지 않는다)
     PUT  /api/nametag/<행사>/bars          하단바 정하기 { items:[{ person_key, bar }], via } — 한 명·여러 명·엑셀 모두
     PUT  /api/nametag/<행사>/people/<key>  현장 신규의 이메일·전화 { email, phone }
     POST /api/nametag/<행사>/checkin       체크인 { person_key } — 사전 출력한 사람이 현장에 왔을 때
     POST /api/nametag/checkin/<id>/void    체크인 취소(지우지 않는다)
     GET  /api/nametag/<행사>/live?since=   현장 실시간 — 살아 있는 체크인 전부 + since 뒤로 바뀐 발급 기록·사람
     POST /api/nametag/<행사>/promote       현장 신규를 마스터DB에 { person_keys:[w…] } → 연락처 + 이 행사 참가 확정

   bizmatching의 네임택 발급(nametag-package, 2026-11-10)을 옮겨 왔다. 원칙 두 가지는 그대로다.
   - 기록이 먼저, 인쇄는 나중. 브라우저는 인쇄가 실제로 됐는지 알려 주지 않으므로 «인쇄를 지시한 시각»을
     남기고, 안 나왔으면 voided_at으로 되돌린다.
   - 출력물 한 장 = 한 줄. 그때 찍은 이름·소속·직함·하단바를 그대로 남긴다(마스터DB가 나중에 바뀌어도 기록은 그대로).

   명단은 서버에서 다시 만들지 않는다. 참가자(participations)·연사(speakers)·부스 인원(exhibitor_contacts)은
   화면이 이미 다 들고 있고, 셋을 합치는 규칙도 화면(js/features/nametag/nt-people.js)에 있다.
   서버는 찍은 값을 받아 길이만 맞춰 저장한다. person_key(c<연락처 id> · s/x<줄 id> · 현장 신규 w<첫 발급 id>)로
   «이 사람이 이미 받았는지»를 센다 — 그래서 한 사람이 연사 겸 참가자여도 한 번 받은 것으로 센다.

   하단바(2026-11-10 등록 담당자 피드백): 투포켓 명찰 아래에 끼우는 색 띠. 종류는 행사마다 달라 판(bar_types)에 두고,
   사람마다 어느 띠를 줄지는 nametag_people.bar(종류 id). 인쇄 때 그 이름을 nametag_prints.bar에 그대로 남긴다.
   체크인: 현장 출력(onsite)이면 인쇄와 함께, 사전 출력한 사람은 체크인 데스크에서 따로. 살아 있는 체크인은 한 사람에 하나.

   마스터DB는 발급 때 고치지 않는다. 데스크에서 직함을 고쳐 찍어도 그 값은 이 기록에만 남는다.
   현장 신규는 이름·소속을 발급 기록에, 이메일·전화를 nametag_people에 둔다. 행사가 끝나고 «마스터DB에 올리기»를
   누르면 그때 연락처(같은 이메일이면 그 사람)와 참가 확정을 만들고, 그 사람의 기록 키를 w…에서 c<연락처 id>로 옮긴다.
   시험 계정은 쓰지 못한다(이름을 가려 찍을 수는 없다).

   끊김 대비(2026-11-10): 데스크는 기록을 기기(태블릿·휴대폰·노트북)에 먼저 남기고 인쇄한 뒤, 연결되면 차례로 보낸다
   (js/features/nametag/nt-outbox.js). 그래서 발급·체크인 기록 id와 시각은 기기가 만든다.
   - 같은 id가 다시 오면(응답이 끊겨 기기가 다시 보낸 것) 새로 넣지 않고 처음 기록을 돌려준다
   - 늦게 도착한 기록도 다른 데스크가 받도록 synced_at(서버가 받은 시각)을 두고 /live는 그것으로 묻는다
   - 기기가 모르는 사이 다른 데스크가 먼저 뽑았으면 409로 막지 않고 «재발급 · 동시 발급»으로 남긴다(종이는 이미 나왔다)
══════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');
const { contactIdAllocator } = require('../db/contact-ids');

const router = express.Router();
const newId = (p) => p + Date.now() + crypto.randomBytes(3).toString('hex');
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 10) / 10)) : d; };
const kstStamp = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const HANGUL = /[가-힣]/;
const SOURCES = new Set(['part', 'speaker', 'exh']);
const LANGS = new Set(['auto', 'ko', 'en']);
const SHEETS = new Set(['a4', 'fit']);   // 출력 종이: A4 맨 위 가운데 | 네임택 크기 그대로. 가로는 언제나 가운데(예전 a4l도 a4로 저장)
const REASONS = new Set(['분실', '오타', '훼손', '기타']);
const RACE_REASON = '동시 발급';   // 기기가 모르는 사이 다른 데스크가 먼저 뽑은 사람
const PRINT_ID = /^NP-[0-9a-z]{8,40}$/i, CHECKIN_ID = /^NC-[0-9a-z]{8,40}$/i, BATCH_ID = /^NB-[0-9a-z]{8,40}$/i;
/* 기기가 보낸 시각 — 이상하면(형식이 틀리거나 서버보다 10분 넘게 앞서면) 서버 시각 */
const devTime = (v, now) => {
  const t = Date.parse(typeof v === 'string' ? v : '');
  return Number.isFinite(t) && t <= Date.parse(now) + 600e3 && t > Date.parse(now) - 30 * 86400e3 ? new Date(t).toISOString() : now;
};
const WALK_IN_ROLE = '참가자';   // 마스터DB에 올린 현장 신규의 참가 유형

/* 하단바 종류 — [{ id, label, color }]. 화면(nt-editor.js)이 만든 것을 모양만 맞춰 받는다 */
function cleanBarTypes(v) {
  const seen = new Set();
  return (Array.isArray(v) ? v : []).slice(0, 20).map((b) => ({
    id: text(b && b.id, 20), label: text(b && b.label, 20),
    color: /^#[0-9a-f]{6}$/i.test(b && b.color) ? b.color.toLowerCase() : '#888888',
    // 이 띠를 기본으로 줄 참가 역할(참가 유형 이름) — 사람마다 정한 띠가 없으면 역할로 정한다(2026-11-11)
    roles: [...new Set((Array.isArray(b && b.roles) ? b.roles : []).map((r) => text(r, 30)).filter(Boolean))].slice(0, 30),
  })).filter((b) => b.id && b.label && !seen.has(b.id) && seen.add(b.id));
}
async function barTypesOf(q, ev) {
  const r = await q.query(`SELECT bar_types FROM nametag_templates WHERE event_id = $1 AND is_default`, [ev]);
  return cleanBarTypes(r.rows[0] && r.rows[0].bar_types);
}
const log = (q, req, type, action, ev, detail) => q.query(`INSERT INTO activity_log (id, ts, email, name, type, action, target, detail)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [newId('L-'), new Date().toISOString(), req.user?.email || '', req.user?.name || '', type, action, ev, detail]);

router.use((req, res, next) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 네임택을 쓸 수 없어요' });
  next();
});

const TEMPLATE_COLS = `id, name, width_mm::float8 AS width_mm, height_mm::float8 AS height_mm, lang, sheet,
  background_data, background_print, layout, print_offset, bar_types, is_default, updated_at, updated_by`;
const PRINT_COLS = `id, event_id, batch_id, template_id, person_key, source, ref_id, contact_id, name, company, job_title,
  badge, bar, lang, kind, reason, printed_by, printed_at, voided_at, voided_by, synced_at`;
const PEOPLE_COLS = `person_key, bar, email, phone, contact_id, updated_at, updated_by`;
const CHECKIN_COLS = `id, person_key, via, print_id, checked_at, checked_by, voided_at, voided_by, synced_at`;

router.get('/:eventId', async (req, res, next) => {
  try {
    const ev = String(req.params.eventId);
    const [t, p, pe, ck] = await Promise.all([
      pool.query(`SELECT ${TEMPLATE_COLS} FROM nametag_templates WHERE event_id = $1 ORDER BY is_default DESC, updated_at DESC LIMIT 1`, [ev]),
      pool.query(`SELECT ${PRINT_COLS} FROM nametag_prints WHERE event_id = $1 ORDER BY printed_at DESC LIMIT 5000`, [ev]),
      pool.query(`SELECT ${PEOPLE_COLS} FROM nametag_people WHERE event_id = $1`, [ev]),
      pool.query(`SELECT ${CHECKIN_COLS} FROM nametag_checkins WHERE event_id = $1 AND voided_at IS NULL`, [ev]),
    ]);
    // 판이 아직 없으면 null — 화면이 코드의 기준값(js/domain/nametag-layout.js)으로 그린다
    res.json({ ok: true, template: t.rows[0] || null, prints: p.rows, people: pe.rows, checkins: ck.rows, now: new Date().toISOString() });
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
    const offset = JSON.stringify({ x: num(b.print_offset?.x, -10, 10, 0), y: num(b.print_offset?.y, -10, 10, 0), scale: num(b.print_offset?.scale, 90, 110, 100), top: num(b.print_offset?.top, 0, 15, 4) });
    const bg = typeof b.background_data === 'string' && b.background_data ? b.background_data : null;
    if (bg && (!/^data:image\/(jpeg|png|webp);base64,/.test(bg) || bg.length > BG_MAX)) {
      return res.status(400).json({ ok: false, error: '배경 이미지는 JPG·PNG·WebP, 2MB까지예요' });
    }
    const vals = [ev, text(b.name, 40) || '기본 네임택',
      num(b.width_mm, 20, 420, 100), num(b.height_mm, 20, 420, 120),
      LANGS.has(b.lang) ? b.lang : 'auto', layout, offset, new Date().toISOString(), req.user?.email || '',
      bg, !!(bg && b.background_print), SHEETS.has(b.sheet) ? b.sheet : 'a4', JSON.stringify(cleanBarTypes(b.bar_types))];
    const { rows } = await pool.query(`
      INSERT INTO nametag_templates (id, event_id, name, width_mm, height_mm, lang, layout, print_offset, is_default, updated_at, updated_by,
        background_data, background_print, sheet, bar_types)
      VALUES ('NT-' || md5(random()::text || clock_timestamp()::text), $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, true, $8, $9, $10, $11, $12, $13::jsonb)
      ON CONFLICT (event_id) WHERE is_default DO UPDATE SET name = EXCLUDED.name, width_mm = EXCLUDED.width_mm,
        height_mm = EXCLUDED.height_mm, lang = EXCLUDED.lang, layout = EXCLUDED.layout, print_offset = EXCLUDED.print_offset,
        background_data = EXCLUDED.background_data, background_print = EXCLUDED.background_print, sheet = EXCLUDED.sheet,
        bar_types = EXCLUDED.bar_types, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
      RETURNING ${TEMPLATE_COLS}`, vals);
    res.json({ ok: true, template: rows[0] });
  } catch (e) { next(e); }
});

/* 발급 — 기록이 먼저다. 화면은 돌려받은 기록으로 인쇄 창을 그린다 → 기록과 종이가 늘 같다.
   이미 받은(무효 아닌 기록이 있는) 사람이 섞이면 재발급이고, 사유가 있어야 한다.
   onsite(현장 출력)면 뽑은 사람을 모두 체크인한다. 현장 신규도 같다 — 사전 출력으로 뽑으면 체크인하지 않는다
   (예전에는 현장 신규를 언제나 체크인해 사전 출력 중에도 체크인으로 잡혔다, 2026-11-11).
   새 현장 신규는 person_key = w<발급 id>. 그 사람을 다시 뽑을 때는 화면이 그 키를 보낸다(재발급). */
router.post('/:eventId/issue', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const ev = String(req.params.eventId);
    const b = req.body || {};
    const raw = Array.isArray(b.cards) ? b.cards : [];
    if (!raw.length) return res.status(400).json({ ok: false, error: '뽑을 사람을 골라 주세요' });
    if (raw.length > 500) return res.status(400).json({ ok: false, error: '한 번에 500장까지 뽑을 수 있어요' });
    const now = new Date().toISOString();
    const cards = raw.map((c) => {
      const walkIn = c.source === 'walk_in';
      const key = text(c.person_key, 60) || null;
      const devId = PRINT_ID.test(c.id || '') ? c.id : null;   // 기기가 만든 기록 id
      const id = devId || newId('NP-');
      const fresh = walkIn && (!key || (devId && key === 'w' + devId) || !key.startsWith('w'));   // 처음 오는 현장 신규
      return {
        id, devId, walkIn, fresh, source: walkIn ? 'walk_in' : SOURCES.has(c.source) ? c.source : null,
        at: devTime(c.printed_at, now), checkin_id: CHECKIN_ID.test(c.checkin_id || '') ? c.checkin_id : null,
        person_key: fresh ? 'w' + id : key,
        bar: text(c.bar, 20) || null, email: text(c.email, 120) || null, phone: text(c.phone, 40) || null,
        ref_id: walkIn ? null : text(c.ref_id, 60) || null,
        contact_id: walkIn ? null : text(String(c.contact_id ?? ''), 20) || null,
        name: text(c.name, 60), company: text(c.company, 80), job_title: text(c.job_title, 60) || null,
        badge: text(c.badge, 30) || null, lang: c.lang === 'en' ? 'en' : 'ko',
      };
    });
    if (cards.some((c) => !c.source || !c.person_key)) return res.status(400).json({ ok: false, error: '명단에 없는 사람이 섞여 있어요. 화면을 새로 고쳐 주세요' });
    // 이름이 빈 네임택도 뽑는다(소속만 찍거나 손으로 쓸 빈 네임택, 2026-11-11). 기록의 name은 빈 글자로 남는다
    const reason = REASONS.has(b.reason) ? b.reason : null;
    const fromDevice = cards.every((c) => c.devId);

    /* 다시 온 기록 — 이미 받은 id면 새로 넣지 않고 그때 기록을 돌려준다(한 묶음은 한 트랜잭션이라 다 있거나 다 없다) */
    if (fromDevice) {
      const ids = cards.map((c) => c.id);
      const { rows: got } = await client.query(`SELECT ${PRINT_COLS} FROM nametag_prints WHERE id = ANY($1)`, [ids]);
      if (got.length) {
        const wk = got.filter((r) => r.kind === 'walk_in').map((r) => r.person_key);
        const [pp, ck] = await Promise.all([
          wk.length ? client.query(`SELECT ${PEOPLE_COLS} FROM nametag_people WHERE event_id = $1 AND person_key = ANY($2)`, [ev, wk]) : { rows: [] },
          client.query(`SELECT ${CHECKIN_COLS} FROM nametag_checkins WHERE event_id = $1 AND print_id = ANY($2)`, [ev, ids]),
        ]);
        return res.json({ ok: true, replay: true, batch_id: got[0].batch_id, prints: got, people: pp.rows, checkins: ck.rows });
      }
    }

    const keys = cards.filter((c) => !c.fresh).map((c) => c.person_key);
    const { rows: had } = keys.length ? await client.query(
      `SELECT DISTINCT person_key FROM nametag_prints WHERE event_id = $1 AND voided_at IS NULL AND person_key = ANY($2)`, [ev, keys]) : { rows: [] };
    const already = new Set(had.map((r) => r.person_key));
    if (already.size && !reason && !fromDevice) {
      return res.status(409).json({ ok: false, error: '이미 네임택을 받은 사람이 있어요. 재발급 사유를 골라 주세요', need_reason: [...already] });
    }

    const tpl = await client.query(`SELECT id, bar_types FROM nametag_templates WHERE event_id = $1 AND is_default`, [ev]);
    const templateId = tpl.rows[0]?.id || null;
    const barLabel = new Map(cleanBarTypes(tpl.rows[0]?.bar_types).map((t) => [t.id, t.label]));
    /* 하단바 — 사람 줄에 정해 둔 것. 새 현장 신규는 데스크에서 고른 것(비워도 된다, 나중에 채운다) */
    const { rows: ppl } = keys.length ? await client.query(
      `SELECT person_key, bar FROM nametag_people WHERE event_id = $1 AND person_key = ANY($2)`, [ev, keys]) : { rows: [] };
    const barOf = new Map(ppl.map((r) => [r.person_key, r.bar]));
    const onsite = !!b.onsite;
    const batch = BATCH_ID.test(b.batch_id || '') ? b.batch_id : newId('NB-');
    const by = req.user?.email || '';
    await client.query('BEGIN');
    const out = [], people = [], checkins = [];
    for (const c of cards) {
      const kind = c.fresh ? 'walk_in' : already.has(c.person_key) ? 'reissue' : 'issue';
      const bar = c.fresh ? (barLabel.has(c.bar) ? c.bar : null) : barOf.get(c.person_key) || null;
      if (c.fresh) {
        const { rows: [pp] } = await client.query(`INSERT INTO nametag_people (event_id, person_key, bar, email, phone, updated_at, updated_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_id, person_key) DO UPDATE SET updated_at = EXCLUDED.updated_at
          RETURNING ${PEOPLE_COLS}`, [ev, c.person_key, bar, c.email, c.phone, now, by]);
        people.push(pp);
      }
      const { rows: [r] } = await client.query(`
        INSERT INTO nametag_prints (id, event_id, batch_id, template_id, person_key, source, ref_id, contact_id,
          name, company, job_title, badge, bar, lang, kind, reason, printed_by, printed_at, synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING ${PRINT_COLS}`,
      [c.id, ev, batch, templateId, c.person_key, c.source, c.ref_id, c.contact_id,
        c.name, c.company, c.job_title, c.badge, bar ? barLabel.get(bar) || null : null, c.lang, kind,
        kind === 'issue' ? null : reason || RACE_REASON, by, c.at, now]);
      out.push(r);
      if (onsite) {
        const { rows: [k] } = await client.query(`INSERT INTO nametag_checkins (id, event_id, person_key, via, print_id, checked_at, checked_by, synced_at)
          VALUES ($1,$2,$3,'print',$4,$5,$6,$7) ON CONFLICT (event_id, person_key) WHERE voided_at IS NULL DO NOTHING RETURNING ${CHECKIN_COLS}`,
        [c.checkin_id || newId('NC-'), ev, c.person_key, r.id, c.at, by, now]);
        if (k) checkins.push(k);
      }
    }
    const re = out.filter((r) => r.kind === 'reissue').length;
    const wi = out.filter((r) => r.kind === 'walk_in').length;
    await log(client, req, 'create', '네임택 발급', ev,
      `${out.length}장${re ? ` (재발급 ${re} · ${reason || RACE_REASON})` : ''}${wi ? ` · 현장 신규 ${wi}` : ''}${checkins.length ? ` · 체크인 ${checkins.length}` : ''} — ${out.slice(0, 5).map((r) => r.name).join(', ')}${out.length > 5 ? ' 외' : ''}`);
    await client.query('COMMIT');
    res.json({ ok: true, batch_id: batch, prints: out, people, checkins });
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
    await log(pool, req, 'update', '네임택 인쇄 안 됨', rows[0].event_id || '', `${rows[0].name} (${rows[0].company || ''})`);
    res.json({ ok: true, print: rows[0] });
  } catch (e) { next(e); }
});

/* 하단바 정하기 — 한 명·고른 여러 명·엑셀 모두 이것. bar가 비면 하단바를 뺀다.
   판에 없는 종류는 받지 않는다(엑셀 오타가 그대로 들어가지 않게 화면이 먼저 거르고, 여기서 한 번 더) */
router.put('/:eventId/bars', async (req, res, next) => {
  try {
    const ev = String(req.params.eventId);
    const raw = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!raw.length) return res.status(400).json({ ok: false, error: '정할 사람이 없어요' });
    if (raw.length > 5000) return res.status(400).json({ ok: false, error: '한 번에 5000명까지예요' });
    const types = new Set((await barTypesOf(pool, ev)).map((t) => t.id));
    const items = raw.map((i) => ({ key: text(i && i.person_key, 60), bar: text(i && i.bar, 20) || null })).filter((i) => i.key);
    if (items.some((i) => i.bar && !types.has(i.bar))) {
      return res.status(400).json({ ok: false, error: '판에 없는 하단바 종류가 있어요. 설정 › 행사 상세 › 네임택에서 먼저 만들어 주세요' });
    }
    const at = new Date().toISOString(), by = req.user?.email || '';
    const { rows } = await pool.query(`
      INSERT INTO nametag_people (event_id, person_key, bar, updated_at, updated_by)
      SELECT $1, k, b, $4, $5 FROM unnest($2::text[], $3::text[]) AS u(k, b)
      ON CONFLICT (event_id, person_key) DO UPDATE SET bar = EXCLUDED.bar, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
      RETURNING ${PEOPLE_COLS}`, [ev, items.map((i) => i.key), items.map((i) => i.bar), at, by]);
    await log(pool, req, 'update', '네임택 하단바', ev, `${rows.length}명${req.body?.via === 'excel' ? ' (엑셀)' : ''}`);
    res.json({ ok: true, people: rows });
  } catch (e) { next(e); }
});

/* 현장 신규의 이메일·전화 — 마스터DB에 올릴 때 같은 사람을 찾고 연락처에 넣는다 */
router.put('/:eventId/people/:key', async (req, res, next) => {
  try {
    const ev = String(req.params.eventId), key = String(req.params.key);
    if (!key.startsWith('w')) return res.status(400).json({ ok: false, error: '현장 신규만 여기서 고쳐요' });
    const { rows } = await pool.query(`
      INSERT INTO nametag_people (event_id, person_key, email, phone, updated_at, updated_by) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (event_id, person_key) DO UPDATE SET email = EXCLUDED.email, phone = EXCLUDED.phone,
        updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by RETURNING ${PEOPLE_COLS}`,
    [ev, key, text(req.body?.email, 120) || null, text(req.body?.phone, 40) || null, new Date().toISOString(), req.user?.email || '']);
    res.json({ ok: true, person: rows[0] });
  } catch (e) { next(e); }
});

/* 체크인 — 사전 출력한 사람이 현장에 왔을 때. 이미 체크인했으면 그 기록을 돌려준다(두 데스크가 동시에 눌러도 하나) */
router.post('/:eventId/checkin', async (req, res, next) => {
  try {
    const ev = String(req.params.eventId), key = text(req.body?.person_key, 60);
    if (!key) return res.status(400).json({ ok: false, error: '체크인할 사람을 골라 주세요' });
    const now = new Date().toISOString();
    const devId = CHECKIN_ID.test(req.body?.id || '') ? req.body.id : null;
    if (devId) {   // 다시 온 체크인 — 처음 받은 것을 그대로(그 뒤 취소됐으면 취소된 줄)
      const { rows: [again] } = await pool.query(`SELECT ${CHECKIN_COLS} FROM nametag_checkins WHERE id = $1`, [devId]);
      if (again) return res.json({ ok: true, checkin: again, replay: true });
    }
    const { rows: [k] } = await pool.query(`INSERT INTO nametag_checkins (id, event_id, person_key, via, checked_at, checked_by, synced_at)
      VALUES ($1,$2,$3,'desk',$4,$5,$6) ON CONFLICT (event_id, person_key) WHERE voided_at IS NULL DO NOTHING RETURNING ${CHECKIN_COLS}`,
    [devId || newId('NC-'), ev, key, devTime(req.body?.checked_at, now), req.user?.email || '', now]);
    if (k) return res.json({ ok: true, checkin: k });
    const { rows: [had] } = await pool.query(`SELECT ${CHECKIN_COLS} FROM nametag_checkins
      WHERE event_id = $1 AND person_key = $2 AND voided_at IS NULL`, [ev, key]);
    res.json({ ok: true, checkin: had, already: true });
  } catch (e) { next(e); }
});

router.post('/checkin/:id/void', async (req, res, next) => {
  try {
    const { rows: [k] } = await pool.query(`UPDATE nametag_checkins SET voided_at = $2, voided_by = $3
      WHERE id = $1 AND voided_at IS NULL RETURNING event_id, ${CHECKIN_COLS}`, [String(req.params.id), new Date().toISOString(), req.user?.email || '']);
    if (!k) return res.status(404).json({ ok: false, error: '이미 취소했거나 없는 체크인이에요' });
    await log(pool, req, 'update', '네임택 체크인 취소', k.event_id, k.person_key);
    res.json({ ok: true, checkin: k });
  } catch (e) { next(e); }
});

/* 현장 실시간 — 데스크 여러 대가 같은 숫자를 보게 화면이 15초마다 묻는다. 판(배경 그림)은 무거워 다시 보내지 않는다.
   since 뒤로 바뀐 것만 보낸다(체크인은 취소된 줄도 — 화면이 지운다). 서버가 받은 시각(synced_at)으로 묻고,
   쓰는 중이던 트랜잭션을 놓치지 않게 1분 겹쳐 묻는다(화면은 id로 합치니 겹쳐도 된다) */
router.get('/:eventId/live', async (req, res, next) => {
  try {
    const ev = String(req.params.eventId);
    const t = Date.parse(String(req.query.since || ''));
    const since = Number.isFinite(t) ? new Date(t - 60e3).toISOString() : '1970-01-01T00:00:00Z';
    const now = new Date().toISOString();
    const [ck, p, pe] = await Promise.all([
      pool.query(`SELECT ${CHECKIN_COLS} FROM nametag_checkins WHERE event_id = $1 AND (synced_at > $2 OR voided_at > $2)`, [ev, since]),
      pool.query(`SELECT ${PRINT_COLS} FROM nametag_prints WHERE event_id = $1 AND (synced_at > $2 OR voided_at > $2) ORDER BY printed_at DESC`, [ev, since]),
      pool.query(`SELECT ${PEOPLE_COLS} FROM nametag_people WHERE event_id = $1 AND updated_at > $2`, [ev, since]),
    ]);
    res.json({ ok: true, delta: true, checkins: ck.rows, prints: p.rows, people: pe.rows, now });
  } catch (e) { next(e); }
});

/* 현장 신규 → 마스터DB. 한 사람씩 트랜잭션: 연락처 찾기(이메일)/만들기 → 이 행사 참가 확정 → 기록 키 옮기기.
   연락처 id는 contactIdAllocator로(CLAUDE.md «16자리 이하»). 이미 옮긴 사람은 건너뛴다 */
async function promoteOne(client, ev, evName, key, req) {
  const by = req.user?.email || '';
  const now = new Date().toISOString();
  const first = (await client.query(`SELECT * FROM nametag_prints WHERE event_id = $1 AND person_key = $2
    ORDER BY printed_at LIMIT 1 FOR UPDATE`, [ev, key])).rows[0];
  if (!first) return null;
  const last = (await client.query(`SELECT name, company, job_title FROM nametag_prints WHERE event_id = $1 AND person_key = $2
    AND voided_at IS NULL ORDER BY printed_at DESC LIMIT 1`, [ev, key])).rows[0] || first;
  const pp = (await client.query(`SELECT * FROM nametag_people WHERE event_id = $1 AND person_key = $2`, [ev, key])).rows[0] || {};
  const name = last.name || first.name, org = last.company || '', title = last.job_title || '';
  if (!name) return null;   // 이름 없이 뽑은 현장 신규는 연락처로 만들지 않는다(누군지 모른다) — 현장 신규로 남는다
  const email = String(pp.email || '').trim(), phone = String(pp.phone || '').trim();
  const ko = HANGUL.test(name), orgKo = HANGUL.test(org), titleKo = HANGUL.test(title);
  const found = email ? (await client.query(`SELECT * FROM contacts
    WHERE lower(trim(email1)) = $1 OR lower(trim(email2)) = $1 ORDER BY id LIMIT 1`, [email.toLowerCase()])).rows[0] : null;
  let cid, created = false, contact;
  if (found) {
    cid = found.id;
    /* 빈 칸만 채운다 */
    const fill = { [ko ? 'nameKo' : 'nameEn']: name, [orgKo ? 'orgKo' : 'orgEn']: org, [titleKo ? 'titleKo' : 'titleEn']: title, phone1: phone };
    const sets = [], args = [cid];
    Object.entries(fill).forEach(([col, val]) => { if (val && !String(found[col] || '').trim()) { args.push(val); sets.push(`"${col}" = $${args.length}`); } });
    if (sets.length) await client.query(`UPDATE contacts SET ${sets.join(', ')} WHERE id = $1`, args);
    contact = (await client.query('SELECT * FROM contacts WHERE id = $1', [cid])).rows[0];
  } else {
    cid = (await contactIdAllocator(client))();
    created = true;
    contact = (await client.query(`INSERT INTO contacts (id, "nameKo", "nameEn", "orgKo", "orgEn", "titleKo", "titleEn",
        source, date, email1, phone1, lang, cat, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'attendee','new') RETURNING *`,
    [cid, ko ? name : '', ko ? '' : name, orgKo ? org : '', orgKo ? '' : org, titleKo ? title : '', titleKo ? '' : title,
      `현장 등록 · ${evName || ev}`, kstStamp(Date.now()).slice(0, 10), email, phone, ko ? 'ko' : 'en'])).rows[0];
  }
  const today = kstStamp(Date.now()).slice(0, 10);
  const note = `현장 신규 네임택(${kstStamp(first.printed_at)})`;
  /* 이미 이 행사 참가 기록이 있으면 그 줄을 확정하고 메모를 덧붙인다 */
  const dup = (await client.query(`SELECT id, note, confirmed_at FROM participations WHERE event_id = $1 AND contact_id = $2
    ORDER BY (role = $3) DESC LIMIT 1`, [ev, cid, WALK_IN_ROLE])).rows[0];
  const part = dup
    ? (await client.query('UPDATE participations SET note = $2, confirmed_at = $3 WHERE id = $1 RETURNING *',
      [dup.id, [dup.note, note].filter(Boolean).join('\n').slice(0, 4000), dup.confirmed_at || today])).rows[0]
    : (await client.query(`INSERT INTO participations (id, event_id, contact_id, role, note, matched, confirmed_at)
      VALUES ($1,$2,$3,$4,$5,'현장 등록',$6) RETURNING *`, [newId('P-'), ev, cid, WALK_IN_ROLE, note, today])).rows[0];

  /* 기록 키 옮기기 — c<연락처 id>에 이미 하단바·체크인이 있으면 그쪽을 살린다 */
  const to = 'c' + cid;
  await client.query(`UPDATE nametag_prints SET person_key = $3, contact_id = $4, synced_at = $5 WHERE event_id = $1 AND person_key = $2`, [ev, key, to, cid, now]);
  const hadPerson = (await client.query(`SELECT bar FROM nametag_people WHERE event_id = $1 AND person_key = $2`, [ev, to])).rows[0];
  if (hadPerson) {
    await client.query(`UPDATE nametag_people SET bar = COALESCE(bar, $3), updated_at = $4, updated_by = $5
      WHERE event_id = $1 AND person_key = $2`, [ev, to, pp.bar || null, now, by]);
    await client.query(`DELETE FROM nametag_people WHERE event_id = $1 AND person_key = $2`, [ev, key]);
  } else {
    await client.query(`UPDATE nametag_people SET person_key = $3, contact_id = $4, updated_at = $5, updated_by = $6
      WHERE event_id = $1 AND person_key = $2`, [ev, key, to, cid, now, by]);
  }
  const liveTo = (await client.query(`SELECT 1 FROM nametag_checkins WHERE event_id = $1 AND person_key = $2 AND voided_at IS NULL`, [ev, to])).rows[0];
  if (liveTo) await client.query(`UPDATE nametag_checkins SET voided_at = $3, voided_by = $4
    WHERE event_id = $1 AND person_key = $2 AND voided_at IS NULL`, [ev, key, now, by]);
  await client.query(`UPDATE nametag_checkins SET person_key = $3, synced_at = $4 WHERE event_id = $1 AND person_key = $2`, [ev, key, to, now]);
  await client.query(`INSERT INTO activity_log (id, ts, email, name, type, action, target, detail, link)
    VALUES ($1,$2,$3,$4,'create','현장 신규 마스터DB에',$5,$6,$7)`,
  [newId('L-'), now, by, req.user?.name || '', ev, `${name} (${org})${created ? ' · 새 연락처' : ' · 기존 연락처에 붙임'}`,
    JSON.stringify({ kind: 'contact', id: cid, table: 'participations', row: part.id })]);
  const person = (await client.query(`SELECT ${PEOPLE_COLS} FROM nametag_people WHERE event_id = $1 AND person_key = $2`, [ev, to])).rows[0] || null;
  return { from: key, to, created, contact, participation: part, person };
}

router.post('/:eventId/promote', async (req, res, next) => {
  const ev = String(req.params.eventId);
  const keys = [...new Set((Array.isArray(req.body?.person_keys) ? req.body.person_keys : [])
    .map((k) => text(k, 60)).filter((k) => k.startsWith('w')))].slice(0, 1000);
  if (!keys.length) return res.status(400).json({ ok: false, error: '올릴 현장 신규가 없어요' });
  try {
    const evName = ((await pool.query('SELECT name FROM events WHERE id = $1', [ev])).rows[0] || {}).name;
    const out = [];
    for (const key of keys) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await promoteOne(client, ev, evName, key, req);
        await client.query(r ? 'COMMIT' : 'ROLLBACK');
        if (r) out.push(r);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
    }
    res.json({ ok: true, promoted: out });
  } catch (e) { next(e); }
});

module.exports = router;
