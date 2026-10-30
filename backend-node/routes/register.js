/* ══════════════════════════════════════════════════════════════
   register.js — 바깥 등록 링크·엑셀 명단 (받아 두었다가 확정하면 마스터DB로)

     공개   GET  /r/<열쇠>        신청서 (국문·영문 단추)
            POST /r/<열쇠>        제출 → 임시 표(register_submissions)에만 쌓는다
     CRM    GET  /api/register/<행사>           이 행사의 링크·신청 대기
            POST /api/register/<행사>           새 링크 { role, title }
            POST /api/register/<행사>/import    엑셀 명단 { role, rows } → 임시 표에
            PUT  /api/register/link/<열쇠>      { enabled }
            POST /api/register/sub/<id>/accept  확정 → 마스터DB(연락처 + 참가 확정)로 옮긴다
            POST /api/register/sub/<id>/drop    버린다(마스터DB에 안 남는다)

   링크 하나 = 행사 하나 + 참가 유형 하나. 셀러용·바이어용을 따로 만들어 보낸다 —
   신청자에게 역할을 고르게 하면 아무거나 골라 온다.

   들어온 신청(링크든 엑셀이든)은 마스터DB에 넣지 않는다. 바깥 사람이 적은 것이 담당자
   확인 없이 사람 창고에 섞이면 안 된다 — 임시 표에 두었다가, 등록 링크 창에서 «확정»을
   누르면 그때 연락처를 만들고(또는 붙이고) 참가 확정으로 넣는다.

   같은 사람 판정은 이메일 하나로만 한다(email1·email2, 대소문자 무시). 이미 있으면
   새로 만들지 않고 빈 칸만 채운다 — 바깥 사람이 우리 DB의 값을 덮어쓰지 못하게.
   연락처 id는 contactIdAllocator로(CLAUDE.md «16자리 이하»).
══════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');
const { contactIdAllocator } = require('../db/contact-ids');

let ready = null;
const ensure = () => ready || (ready = pool.query(`CREATE TABLE IF NOT EXISTS register_links (
    token TEXT PRIMARY KEY, event_id TEXT, role TEXT, title TEXT, enabled TEXT,
    created_at TEXT, created_by TEXT, submits INTEGER DEFAULT 0, last_at TEXT)`)
  .then(() => pool.query(`CREATE TABLE IF NOT EXISTS register_submissions (
    id TEXT PRIMARY KEY, token TEXT, event_id TEXT, role TEXT, data TEXT, status TEXT,
    created_at TEXT, decided_at TEXT, decided_by TEXT, contact_id TEXT, via TEXT)`))
  .catch((e) => { ready = null; throw e; }));

const newToken = () => crypto.randomBytes(15).toString('base64url');
const newId = (p) => p + Date.now() + crypto.randomBytes(3).toString('hex');
const kstStamp = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const okToken = (t) => /^[A-Za-z0-9_-]{16,40}$/.test(String(t || ''));
const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clip = (v, n = 200) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const HANGUL = /[가-힣]/;

/* 칸 — 이름·소속·이메일은 꼭. 순서가 곧 신청서·엑셀 양식의 순서 */
const FIELDS = [
  { k: 'name',    ko: '이름',        en: 'Name',         need: true,  max: 60 },
  { k: 'org',     ko: '소속(회사·기관)', en: 'Organization', need: true,  max: 120 },
  { k: 'title',   ko: '직함',        en: 'Job title',    need: false, max: 80 },
  { k: 'email',   ko: '이메일',      en: 'Email',        need: true,  max: 120, type: 'email' },
  { k: 'phone',   ko: '전화',        en: 'Phone',        need: false, max: 40,  type: 'tel' },
  { k: 'country', ko: '국가',        en: 'Country',      need: false, max: 60 },
  { k: 'memo',    ko: '관심 분야·요청 사항', en: 'Interests / requests', need: false, max: 1000, area: true },
];
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const cleanRow = (b) => { const v = {}; FIELDS.forEach((f) => { v[f.k] = clip(b && b[f.k], f.max); }); return v; };

const shape = (r) => ({
  token: r.token, path: `/r/${r.token}`, role: r.role || '', title: r.title || '',
  enabled: r.enabled === 'yes', created_at: r.created_at || '', created_by: r.created_by || '',
  submits: Number(r.submits) || 0, last_at: r.last_at || '',
});
const subShape = (r) => {
  let data = {};
  try { data = JSON.parse(r.data || '{}'); } catch (e) { /* 깨진 줄은 빈 칸으로 */ }
  return { id: r.id, token: r.token || '', role: r.role || '', via: r.via || 'link', created_at: r.created_at || '', data };
};

async function stage(eventId, role, token, via, v) {
  await pool.query(`INSERT INTO register_submissions (id, token, event_id, role, data, status, created_at, decided_at, decided_by, contact_id, via)
    VALUES ($1,$2,$3,$4,$5,'',$6,'','','',$7)`,
  [newId('R-'), token || '', eventId, role, JSON.stringify(v), kstStamp(Date.now()), via]);
}

/* ── CRM 쪽 (로그인 필요 — app.js에서 requireAuth) ── */
const router = express.Router();

router.get('/:eventId', async (req, res) => {
  try {
    await ensure();
    const eventId = String(req.params.eventId);
    const test = !!(req.user && req.user.isTest);
    const { rows } = await pool.query('SELECT * FROM register_links WHERE event_id = $1 ORDER BY created_at', [eventId]);
    // 시험 계정은 열쇠도, 신청자 개인정보도 주지 않는다 — 실제 DB다
    const subs = test ? [] : (await pool.query(`SELECT * FROM register_submissions
      WHERE event_id = $1 AND COALESCE(status,'') = '' ORDER BY created_at`, [eventId])).rows.map(subShape);
    res.json({ ok: true, links: rows.map(shape).map((l) => (test ? { ...l, token: '', path: '' } : l)), submissions: subs });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/:eventId', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 만들 수 없어요' });
  const eventId = String(req.params.eventId);
  const role = clip(req.body && req.body.role, 40), title = clip(req.body && req.body.title, 80);
  if (!role) return res.status(400).json({ ok: false, error: '참가 유형을 골라 주세요' });
  try {
    await ensure();
    const ev = (await pool.query('SELECT id FROM events WHERE id = $1', [eventId])).rows[0];
    if (!ev) return res.status(404).json({ ok: false, error: '없는 행사예요' });
    const token = newToken();
    await pool.query(`INSERT INTO register_links (token, event_id, role, title, enabled, created_at, created_by, submits, last_at)
      VALUES ($1,$2,$3,$4,'yes',$5,$6,0,'')`,
    [token, eventId, role, title, kstStamp(Date.now()), req.user?.name || req.user?.email || '']);
    const r = (await pool.query('SELECT * FROM register_links WHERE token = $1', [token])).rows[0];
    res.json({ ok: true, link: shape(r) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* 엑셀 명단 — 화면이 양식을 읽어 줄로 넘긴다. 링크 신청과 같이 임시 표에만 쌓는다.
   빠진 칸·틀린 이메일 줄은 넣지 않고 몇째 줄인지 돌려준다 */
router.post('/:eventId/import', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 올릴 수 없어요' });
  const eventId = String(req.params.eventId);
  const role = clip(req.body && req.body.role, 40);
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  if (!role) return res.status(400).json({ ok: false, error: '참가 유형을 골라 주세요' });
  if (!rows.length) return res.status(400).json({ ok: false, error: '올릴 줄이 없어요' });
  if (rows.length > 2000) return res.status(413).json({ ok: false, error: '한 번에 2,000줄까지 올릴 수 있어요' });
  try {
    await ensure();
    const ev = (await pool.query('SELECT id FROM events WHERE id = $1', [eventId])).rows[0];
    if (!ev) return res.status(404).json({ ok: false, error: '없는 행사예요' });
    const bad = [];
    let added = 0;
    for (let i = 0; i < rows.length; i++) {
      const v = cleanRow(rows[i]);
      if (FIELDS.some((f) => f.need && !v[f.k]) || !EMAIL.test(v.email)) { bad.push(Number(rows[i] && rows[i].line) || i + 2); continue; }
      await stage(eventId, role, '', 'excel', v);
      added++;
    }
    res.json({ ok: true, added, bad });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.put('/link/:token', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 바꿀 수 없어요' });
  if (!okToken(req.params.token)) return res.status(400).json({ ok: false, error: '모르는 링크예요' });
  try {
    await ensure();
    const u = await pool.query('UPDATE register_links SET enabled = $2 WHERE token = $1',
      [req.params.token, req.body && req.body.enabled ? 'yes' : '']);
    if (!u.rowCount) return res.status(404).json({ ok: false, error: '없는 링크예요' });
    const r = (await pool.query('SELECT * FROM register_links WHERE token = $1', [req.params.token])).rows[0];
    res.json({ ok: true, link: shape(r) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* 확정 — 한 트랜잭션: 신청 줄 잡기 → 연락처 찾기/만들기 → 참가 확정 → 활동 기록 */
async function accept(id, by) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    /* 둘이 동시에 누르면 한 번만 — 아직 대기인 줄만 잡는다 */
    const sub = (await client.query(`UPDATE register_submissions SET status = 'done', decided_at = $2, decided_by = $3
      WHERE id = $1 AND COALESCE(status,'') = '' RETURNING *`, [id, kstStamp(Date.now()), by])).rows[0];
    if (!sub) { await client.query('ROLLBACK'); return { gone: true }; }
    const v = cleanRow(subShape(sub).data);
    const ev = (await client.query('SELECT name FROM events WHERE id = $1', [sub.event_id])).rows[0] || {};
    const ko = HANGUL.test(v.name), orgKo = HANGUL.test(v.org), titleKo = HANGUL.test(v.title);
    const found = (await client.query(`SELECT * FROM contacts
      WHERE lower(trim(email1)) = $1 OR lower(trim(email2)) = $1 ORDER BY id LIMIT 1`, [v.email.toLowerCase()])).rows[0];
    let cid, created = false;
    if (found) {
      cid = found.id;
      /* 빈 칸만 채운다 */
      const fill = {
        [ko ? 'nameKo' : 'nameEn']: v.name, [orgKo ? 'orgKo' : 'orgEn']: v.org,
        [titleKo ? 'titleKo' : 'titleEn']: v.title, phone1: v.phone, country: v.country,
      };
      const sets = [], args = [cid];
      Object.entries(fill).forEach(([col, val]) => {
        if (val && !String(found[col] || '').trim()) { args.push(val); sets.push(`"${col}" = $${args.length}`); }
      });
      if (sets.length) await client.query(`UPDATE contacts SET ${sets.join(', ')} WHERE id = $1`, args);
    } else {
      cid = (await contactIdAllocator(client))();
      created = true;
      await client.query(`INSERT INTO contacts (id, "nameKo", "nameEn", "orgKo", "orgEn", "titleKo", "titleEn",
          country, source, date, email1, phone1, lang)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [cid, ko ? v.name : '', ko ? '' : v.name, orgKo ? v.org : '', orgKo ? '' : v.org,
        titleKo ? v.title : '', titleKo ? '' : v.title, v.country,
        `${sub.via === 'excel' ? '엑셀 명단' : '등록 링크'} · ${ev.name || sub.event_id}`,
        kstStamp(Date.now()).slice(0, 10), v.email, v.phone, ko ? 'ko' : 'en']);
    }
    const today = kstStamp(Date.now()).slice(0, 10);
    const note = [`${sub.via === 'excel' ? '엑셀 명단' : '등록 링크 신청'}(${sub.created_at})`, v.memo].filter(Boolean).join(' — ');
    /* 같은 행사·같은 유형으로 이미 있으면 그 줄을 확정하고 메모를 덧붙인다 */
    const dup = (await client.query(`SELECT id, note, confirmed_at FROM participations
      WHERE event_id = $1 AND contact_id = $2 AND role = $3 LIMIT 1`, [sub.event_id, cid, sub.role])).rows[0];
    let partId;
    if (dup) {
      partId = dup.id;
      await client.query('UPDATE participations SET note = $2, confirmed_at = $3 WHERE id = $1',
        [dup.id, [dup.note, note].filter(Boolean).join('\n').slice(0, 4000), dup.confirmed_at || today]);
    } else {
      partId = newId('P-');
      await client.query(`INSERT INTO participations (id, event_id, contact_id, role, note, matched, confirmed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [partId, sub.event_id, cid, sub.role, note, sub.via === 'excel' ? '📄 엑셀 명단' : '🔗 등록 링크', today]);
    }
    await client.query('UPDATE register_submissions SET contact_id = $2 WHERE id = $1', [sub.id, cid]);
    await client.query(`INSERT INTO activity_log (id, ts, email, name, type, action, target, detail, link)
      VALUES ($1,$2,'',$3,'create','등록 신청 확정',$4,$5,$6)`,
    [newId('L-'), new Date().toISOString(), by, sub.event_id,
      `${v.name} (${v.org}) — ${sub.role}${created ? ' · 새 연락처' : ' · 기존 연락처에 붙임'}`,
      JSON.stringify({ kind: 'contact', id: cid, table: 'participations', row: partId })]);
    await client.query('COMMIT');
    return { contactId: cid, created };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

router.post('/sub/:id/:act', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 바꿀 수 없어요' });
  const { id, act } = req.params;
  if (!['accept', 'drop'].includes(act)) return res.status(400).json({ ok: false, error: '모르는 처리예요' });
  const by = req.user?.name || req.user?.email || '';
  try {
    await ensure();
    if (act === 'drop') {
      const u = await pool.query(`UPDATE register_submissions SET status = 'dropped', decided_at = $2, decided_by = $3
        WHERE id = $1 AND COALESCE(status,'') = ''`, [id, kstStamp(Date.now()), by]);
      return u.rowCount ? res.json({ ok: true }) : res.status(409).json({ ok: false, error: '이미 처리된 신청이에요' });
    }
    const r = await accept(id, by);
    if (r.gone) return res.status(409).json({ ok: false, error: '이미 처리된 신청이에요' });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ── 공개 쪽 ── */
async function linkByToken(token) {
  await ensure();
  if (!okToken(token)) return null;
  return (await pool.query(`SELECT l.*, e.name AS event_name, e.date_start, e.date_end, e.location
    FROM register_links l JOIN events e ON e.id = l.event_id
   WHERE l.token = $1 AND l.enabled = 'yes'`, [token])).rows[0] || null;
}

const PAGE_CSS = `
  :root { --line:#e5e7eb; --dim:#6b7280; --ink:#111827; --accent:#1d4ed8; --bg:#f8fafc; --panel:#fff; --no:#b91c1c; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic","Apple SD Gothic Neo",sans-serif; }
  main { max-width:560px; margin:0 auto; padding:28px 16px 48px; }
  h1 { font-size:20px; margin:0 0 4px; } .meta { color:var(--dim); font-size:13px; margin-bottom:18px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:20px; }
  label { display:block; font-size:13px; font-weight:600; margin:14px 0 5px; } label:first-child { margin-top:0; }
  label .req { color:var(--no); margin-left:3px; }
  input, textarea { width:100%; padding:10px 12px; font:inherit; font-size:16px; border:1px solid var(--line); border-radius:9px; background:#fff; color:var(--ink); }
  textarea { min-height:90px; resize:vertical; }
  input:focus, textarea:focus { outline:2px solid var(--accent); outline-offset:-1px; }
  .consent { display:flex; gap:8px; align-items:flex-start; font-weight:400; font-size:13px; color:#374151; margin-top:18px; }
  .consent input { width:auto; margin-top:4px; }
  button { margin-top:20px; width:100%; padding:12px; font:inherit; font-weight:700; color:#fff; background:var(--accent); border:0; border-radius:10px; cursor:pointer; }
  .err { background:#fee2e2; color:var(--no); padding:10px 12px; border-radius:9px; font-size:13px; margin-bottom:14px; }
  .lang { float:right; font-size:12px; } .lang a { color:var(--accent); text-decoration:none; margin-left:8px; } .lang a.on { color:var(--ink); font-weight:700; }
  .hp { position:absolute; left:-9999px; }`;

const L = {
  ko: { sub: '참가 신청서', consent: '행사 운영(안내·연락)을 위해 위 정보를 수집·이용하는 데 동의합니다. 행사 종료 후 주최 측 DB에 보관되며, 요청하시면 삭제합니다.',
    send: '제출하기', need: '필수 항목을 채워 주세요', badMail: '이메일 주소를 확인해 주세요', noConsent: '개인정보 수집·이용에 동의해 주세요',
    done: '신청이 접수됐어요', doneMsg: '담당자가 확인한 뒤 연락드릴게요. 이 창은 닫으셔도 됩니다.', fail: '접수하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
    gone: '링크가 바뀌었거나 신청이 마감됐어요. 사무국에 문의해 주세요.' },
  en: { sub: 'Registration', consent: 'I agree that the information above may be collected and used to run this event (notices and contact). It is kept in the organizer\'s database and deleted on request.',
    send: 'Submit', need: 'Please fill in the required fields', badMail: 'Please check your email address', noConsent: 'Please agree to the data collection notice',
    done: 'Thank you — you are registered', doneMsg: 'Our team will review and get back to you. You may close this window.', fail: 'We could not save your registration. Please try again shortly.',
    gone: 'This link has changed or registration is closed. Please contact the event secretariat.' },
};
const langOf = (q) => (q === 'en' ? 'en' : 'ko');
const period = (a, b) => [a, b].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join(' ~ ');

function shell(title, body, lang) {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body><main>${body}</main></body></html>`;
}

function formPage(row, lang, vals = {}, error = '') {
  const t = L[lang];
  const head = `<div class="lang"><a href="?lang=ko" class="${lang === 'ko' ? 'on' : ''}">한국어</a><a href="?lang=en" class="${lang === 'en' ? 'on' : ''}">English</a></div>
    <h1>${esc(row.event_name || '')}</h1>
    <div class="meta">${esc(row.title || t.sub)}${period(row.date_start, row.date_end) ? ' · ' + esc(period(row.date_start, row.date_end)) : ''}${row.location ? ' · ' + esc(row.location) : ''}</div>`;
  const fields = FIELDS.map((f) => {
    const lab = `<label for="f-${f.k}">${esc(f[lang])}${f.need ? '<span class="req">*</span>' : ''}</label>`;
    const attrs = `id="f-${f.k}" name="${f.k}" maxlength="${f.max}"${f.need ? ' required' : ''}`;
    return lab + (f.area ? `<textarea ${attrs}>${esc(vals[f.k])}</textarea>`
      : `<input ${attrs} type="${f.type || 'text'}" value="${esc(vals[f.k])}" autocomplete="${{ name: 'name', org: 'organization', title: 'organization-title', email: 'email', phone: 'tel', country: 'country-name' }[f.k] || 'off'}">`);
  }).join('');
  return shell(row.event_name || t.sub, `${head}<div class="card">
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <form method="post" action="?lang=${lang}">
      ${fields}
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <label class="consent"><input type="checkbox" name="consent" value="yes" required>${esc(t.consent)}</label>
      <button type="submit">${esc(t.send)}</button>
    </form></div>`, lang);
}

const msgPage = (title, msg, lang) => shell(title, `<div class="card"><h1>${esc(title)}</h1><p style="color:#374151">${esc(msg)}</p></div>`, lang);

const publicRouter = express.Router();
publicRouter.use(express.urlencoded({ extended: false, limit: '20kb' }));
publicRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

publicRouter.get('/:token', async (req, res, next) => {
  const lang = langOf(req.query.lang);
  try {
    const row = await linkByToken(req.params.token);
    if (!row) return res.status(404).type('html').send(msgPage('—', L[lang].gone, lang));
    res.type('html').send(formPage(row, lang));
  } catch (e) { next(e); }
});

publicRouter.post('/:token', async (req, res, next) => {
  const lang = langOf(req.query.lang), t = L[lang];
  try {
    const row = await linkByToken(req.params.token);
    if (!row) return res.status(404).type('html').send(msgPage('—', t.gone, lang));
    const b = req.body || {};
    /* 숨은 칸을 채웠으면 사람이 아니다 — 받은 척만 한다 */
    if (clip(b.website)) return res.type('html').send(msgPage(t.done, t.doneMsg, lang));
    const v = cleanRow(b);
    const back = (msg) => res.status(400).type('html').send(formPage(row, lang, v, msg));
    if (FIELDS.some((f) => f.need && !v[f.k])) return back(t.need);
    if (!EMAIL.test(v.email)) return back(t.badMail);
    if (b.consent !== 'yes') return back(t.noConsent);
    try {
      await stage(row.event_id, row.role, row.token, 'link', v);
      await pool.query('UPDATE register_links SET submits = COALESCE(submits,0) + 1, last_at = $2 WHERE token = $1',
        [row.token, kstStamp(Date.now())]);
    } catch (e) { console.error('[register] 제출 실패:', e.message); return res.status(500).type('html').send(formPage(row, lang, v, t.fail)); }
    res.type('html').send(msgPage(t.done, t.doneMsg, lang));
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.publicRouter = publicRouter;
module.exports.FIELDS = FIELDS;
