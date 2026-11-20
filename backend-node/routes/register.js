/* ══════════════════════════════════════════════════════════════
   register.js — 바깥 등록 링크·엑셀 명단 (받아 두었다가 확정하면 마스터DB로)

     공개   GET  /r/<열쇠>        신청서 (국문·영문 단추)
            POST /r/<열쇠>        제출 → 임시 표(register_submissions)에만 쌓는다
     CRM    GET  /api/register/<행사>           이 행사의 링크·신청 대기
            POST /api/register/<행사>           새 링크 { role, title }
            POST /api/register/<행사>/import    엑셀 명단·직접 입력 { role, rows, via } → 임시 표에
            PUT  /api/register/link/<열쇠>      { enabled }
            POST /api/register/sub/<id>/accept  확정 → 마스터DB(연락처 + 참가 확정)로 옮긴다
            POST /api/register/sub/<id>/drop    버린다(마스터DB에 안 남는다)

   링크 하나 = 행사 하나 + 참가 유형 하나. 셀러용·바이어용을 따로 만들어 보낸다 —
   신청자에게 역할을 고르게 하면 아무거나 골라 온다.

   들어온 신청(링크든 엑셀이든)은 마스터DB에 넣지 않는다. 바깥 사람이 적은 것이 담당자
   확인 없이 사람 창고에 섞이면 안 된다 — 임시 표에 두었다가, 등록 링크 창에서 «확정»을
   누르면 그때 연락처를 만들고(또는 붙이고) 참가 확정으로 넣는다.

   같은 사람 판정은 메일 → 전화 끝 8자리 → 이름+소속 순(db/contact-upsert.js). 이미 있으면
   새로 만들지 않고 빈 칸만 채운다 — 바깥 사람이 우리 DB의 값을 덮어쓰지 못하게.
   연락처는 contactUpserter로 넣는다(같은 사람 찾기·16자리 id·기업DB 연결 — CLAUDE.md).
══════════════════════════════════════════════════════════════ */
const crypto = require('crypto');
const express = require('express');
const pool = require('../db/pool');
const { contactUpserter } = require('../db/contact-upsert');

let ready = null;
const ensure = () => ready || (ready = pool.query(`CREATE TABLE IF NOT EXISTS register_links (
    token TEXT PRIMARY KEY, event_id TEXT, role TEXT, title TEXT, enabled TEXT,
    created_at TEXT, created_by TEXT, submits INTEGER DEFAULT 0, last_at TEXT)`)
  .then(() => pool.query(`CREATE TABLE IF NOT EXISTS register_submissions (
    id TEXT PRIMARY KEY, token TEXT, event_id TEXT, role TEXT, data TEXT, status TEXT,
    created_at TEXT, decided_at TEXT, decided_by TEXT, contact_id TEXT, via TEXT)`))
  /* 확정 취소용 — 확정이 무엇을 만들었나(참가 기록 id·새로 만든 줄인지·덧붙이기 전 메모·새 연락처인지) */
  .then(() => pool.query(`ALTER TABLE register_submissions ADD COLUMN IF NOT EXISTS undo TEXT`))
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
];
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
/* 기본 칸 밖의 항목(참가목적·관심분야·부스 규모 …) — 행사 홈페이지 신청서마다 다르니
   { 항목 이름: 값 }으로 그대로 받아 두었다가 확정할 때 참가 메모로 옮긴다 */
const clipLong = (v, n) => String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim().slice(0, n);
const cleanExtra = (x) => {
  const o = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return o;
  Object.entries(x).slice(0, 30).forEach(([k, val]) => {
    const key = clip(k, 40);
    const v = Array.isArray(val) ? val.map((s) => clip(s, 200)).filter(Boolean).join(', ') : clipLong(val, 2000);
    if (key && v) o[key] = v;
  });
  return o;
};
const cleanRow = (b) => {
  const v = {};
  FIELDS.forEach((f) => { v[f.k] = clip(b && b[f.k], f.max); });
  const ex = cleanExtra(b && b.extra);
  if (Object.keys(ex).length) v.extra = ex;
  return v;
};
const extraLines = (v) => Object.entries(v.extra || {}).map(([k, x]) => `${k}: ${x}`).join('\n');

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

/* 들어온 길 — link(바깥 링크)·excel(엑셀 명단)·manual(직원이 한 명씩 입력) */
const VIA = { link: ['등록 링크', '🔗 등록 링크', '등록 링크 신청'], excel: ['엑셀 명단', '📄 엑셀 명단', '엑셀 명단'], manual: ['직접 입력', '✍️ 직접 입력', '직접 입력'] };
const viaOf = (v) => VIA[v] || VIA.link;

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
  const via = req.body && req.body.via === 'manual' ? 'manual' : 'excel';
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
      /* 우리가 모아 올리는 명단이라 필수 칸이 없다 — 다 빈 줄과 틀린 이메일만 뺀다 */
      if (FIELDS.every((f) => !v[f.k]) || (v.email && !EMAIL.test(v.email))) { bad.push(Number(rows[i] && rows[i].line) || i + 2); continue; }
      await stage(eventId, role, '', via, v);
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
    const r = await acceptWith(client, id, by);
    await client.query(r.gone ? 'ROLLBACK' : 'COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}
async function acceptWith(client, id, by) {
  {
    /* 둘이 동시에 누르면 한 번만 — 아직 대기인 줄만 잡는다 */
    const sub = (await client.query(`UPDATE register_submissions SET status = 'done', decided_at = $2, decided_by = $3
      WHERE id = $1 AND COALESCE(status,'') = '' RETURNING *`, [id, kstStamp(Date.now()), by])).rows[0];
    if (!sub) return { gone: true };
    const v = cleanRow(subShape(sub).data);
    const ev = (await client.query('SELECT name FROM events WHERE id = $1', [sub.event_id])).rows[0] || {};
    const ko = HANGUL.test(v.name), orgKo = HANGUL.test(v.org), titleKo = HANGUL.test(v.title);
    /* 같은 사람 찾기·id·기업DB 연결은 연락처 넣기 한 길(db/contact-upsert.js)로 —
       전에는 메일로만 찾아, 메일을 바꿔 신청한 기존 연락처가 새로 한 명 더 생겼다.
       이제 전화 끝 8자리·이름+소속도 본다. 있으면 빈 칸만 채운다 */
    const put = await contactUpserter(client, { source: `${viaOf(sub.via)[0]} · ${ev.name || sub.event_id}` });
    const r = await put({
      [ko ? 'nameKo' : 'nameEn']: v.name, [orgKo ? 'orgKo' : 'orgEn']: v.org,
      [titleKo ? 'titleKo' : 'titleEn']: v.title, email1: v.email, phone1: v.phone, country: v.country,
      lang: ko ? 'ko' : 'en',
    });
    const cid = r.id, created = r.created;
    /* 이름만 같은 기존 연락처는 새 사람으로 넣되 활동 기록에 남겨 «중복 찾기»에서 보게 한다 */
    const suspectNote = r.suspect ? ` · 같은 이름 기존 연락처 #${r.suspect.id} 있음(확인)` : '';
    const today = kstStamp(Date.now()).slice(0, 10);
    const note = [[`${viaOf(sub.via)[2]}(${sub.created_at})`, v.memo].filter(Boolean).join(' — '), extraLines(v)]
      .filter(Boolean).join('\n');
    /* 같은 행사·같은 유형으로 이미 있으면 그 줄을 확정하고 메모를 덧붙인다 */
    const dup = (await client.query(`SELECT id, note, confirmed_at FROM participations
      WHERE event_id = $1 AND contact_id = $2 AND role = $3 LIMIT 1`, [sub.event_id, cid, sub.role])).rows[0];
    let partId;
    if (dup) {
      partId = dup.id;
      await client.query('UPDATE participations SET note = $2, confirmed_at = $3, registered_at = COALESCE(registered_at, $4) WHERE id = $1',
        [dup.id, [dup.note, note].filter(Boolean).join('\n').slice(0, 4000), dup.confirmed_at || today, sub.created_at || null]);
    } else {
      partId = newId('P-');
      /* registered_at = 신청한 때(KST) — 결과보고 «일자별 등록 추이»가 이것으로 센다 */
      await client.query(`INSERT INTO participations (id, event_id, contact_id, role, note, matched, confirmed_at, registered_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [partId, sub.event_id, cid, sub.role, note, viaOf(sub.via)[1], today, sub.created_at || null]);
    }
    const undo = { partId, partNew: !dup, prevNote: dup ? dup.note || '' : '', prevConfirmed: dup ? dup.confirmed_at || '' : '', contactNew: created };
    await client.query('UPDATE register_submissions SET contact_id = $2, undo = $3 WHERE id = $1', [sub.id, cid, JSON.stringify(undo)]);
    await client.query(`INSERT INTO activity_log (id, ts, email, name, type, action, target, detail, link)
      VALUES ($1,$2,'',$3,'create','등록 신청 확정',$4,$5,$6)`,
    [newId('L-'), new Date().toISOString(), by, sub.event_id,
      `${v.name} (${v.org}) — ${sub.role}${created ? ' · 새 연락처' : ` · 기존 연락처에 붙임(${r.by})`}${suspectNote}`,
      JSON.stringify({ kind: 'contact', id: cid, table: 'participations', row: partId })]);
    /* 화면이 다시 읽지 않고 제 목록에 바로 넣을 수 있게 넣은 그대로 돌려준다 */
    return { contactId: cid, created, partId, existingPart: !!dup, confirmedAt: (dup && dup.confirmed_at) || today,
      role: sub.role, note, matched: viaOf(sub.via)[1], data: v,
      source: `${viaOf(sub.via)[0]} · ${ev.name || sub.event_id}` };
  }
}

/* ── 확정 취소 — 확정이 만든 것을 되돌리고 신청 대기로 돌린다 ──
   2026-11-17 엑셀 71줄을 «모두 확정»한 뒤 잘못 올린 명단인 걸 알고 스크립트로 되돌렸다
   (db/oneoff/rollback-gpb-register-1117.js). 그 일을 화면에서 한다.
   · 확정이 새로 만든 참가 기록은 지우고, 이미 있던 줄에 덧붙였으면 메모·확정일을 그 전으로
   · 확정이 새로 만든 연락처는 다른 곳(다른 행사 참가·연사·전시 담당·컨택·영업 DB·네임택·다른 확정)에
     쓰이지 않을 때만 지운다 — 쓰이고 있으면 남기고 알린다
   · 기존 연락처의 빈 칸을 채운 값은 그대로 둔다(틀린 값이 아니다)
   undo 칸이 없는 옛 확정(11-20 전)은 활동 기록 «등록 신청 확정»에서 읽는다 */
const CONTACT_USES = [['participations', 'contact_id'], ['exhibitor_contacts', 'contact_id'], ['speakers', 'contact_id'],
  ['speaker_contacts', 'contact_id'], ['contact_attempts', 'contact_id'], ['sales_targets', 'contact_id']];
async function undoWith(client, id, by) {
  const sub = (await client.query(`SELECT * FROM register_submissions WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!sub || sub.status !== 'done') return { gone: true };
  let u = null;
  try { u = sub.undo ? JSON.parse(sub.undo) : null; } catch (e) { u = null; }
  const cid = String(sub.contact_id || '');
  if (!u && cid) {
    const log = (await client.query(`SELECT detail, link FROM activity_log WHERE action = '등록 신청 확정' AND target = $1
      AND link LIKE '%' || $2 || '%' ORDER BY ts DESC LIMIT 1`, [sub.event_id, `"${cid}"`])).rows[0];
    if (log) {
      let l = {}; try { l = JSON.parse(log.link || '{}'); } catch (e) { /* 깨진 기록 */ }
      const contactNew = String(log.detail || '').includes('· 새 연락처');
      u = { partId: l.row || '', partNew: contactNew ? true : null, prevNote: null, prevConfirmed: null, contactNew };
    }
  }
  if (!u) return { error: '이 확정이 무엇을 만들었는지 기록이 없어 되돌릴 수 없어요' };

  const marker = `${viaOf(sub.via)[2]}(${sub.created_at})`;
  const part = u.partId ? (await client.query(`SELECT * FROM participations WHERE id = $1`, [u.partId])).rows[0] : null;
  let partDeleted = false, partRestored = null;
  if (part) {
    const note = String(part.note || '');
    /* 옛 확정은 새 줄이었는지 모른다 — 메모가 이 신청 표시로 시작하면 새 줄이다 */
    const isNew = u.partNew === true || (u.partNew === null && note.startsWith(marker));
    if (isNew) {
      await client.query(`DELETE FROM participations WHERE id = $1`, [part.id]);
      partDeleted = true;
    } else {
      const prevNote = u.prevNote != null ? u.prevNote
        : note.split('\n').filter((x) => !x.startsWith(marker)).join('\n');
      const prevConf = u.prevConfirmed != null ? u.prevConfirmed : part.confirmed_at;
      await client.query(`UPDATE participations SET note = $2, confirmed_at = $3 WHERE id = $1`, [part.id, prevNote, prevConf || null]);
      partRestored = { id: part.id, note: prevNote, confirmedAt: prevConf || '' };
    }
  }
  let contactDeleted = false, contactKept = '';
  if (u.contactNew && cid) {
    let uses = 0;
    for (const [tb, col] of CONTACT_USES) uses += Number((await client.query(`SELECT count(*) n FROM "${tb}" WHERE "${col}" = $1`, [cid])).rows[0].n);
    uses += Number((await client.query(`SELECT count(*) n FROM register_submissions WHERE contact_id = $1 AND id <> $2 AND status = 'done'`, [cid, sub.id])).rows[0].n);
    /* 네임택 표는 행사를 돌려 본 DB에만 있다 — 없으면 셀 것도 없다 */
    const nt = await client.query(`SELECT to_regclass('nametag_people') t`);
    if (nt.rows[0].t) uses += Number((await client.query(`SELECT count(*) n FROM nametag_people WHERE person_key = $1`, [`c${cid}`])).rows[0].n);
    if (uses) contactKept = '다른 기록에 쓰이고 있어 연락처는 남겼어요';
    else { await client.query(`DELETE FROM contacts WHERE id = $1`, [cid]); contactDeleted = true; }
  }
  await client.query(`UPDATE register_submissions SET status = '', decided_at = '', decided_by = '', contact_id = '', undo = NULL WHERE id = $1`, [sub.id]);
  let d = {}; try { d = JSON.parse(sub.data || '{}'); } catch (e) { /* 빈 칸 */ }
  await client.query(`INSERT INTO activity_log (id, ts, email, name, type, action, target, detail, link)
    VALUES ($1,$2,'',$3,'delete','등록 확정 취소',$4,$5,$6)`,
  [newId('L-'), new Date().toISOString(), by, sub.event_id,
    `${d.name || ''} (${d.org || ''}) — ${sub.role} · ${sub.decided_at} ${sub.decided_by || ''} 확정을 취소해 신청 대기로`
      + `${partDeleted ? ' · 참가 기록 지움' : partRestored ? ' · 참가 기록 되돌림' : ''}${contactDeleted ? ' · 새 연락처 지움' : ''}${contactKept ? ' · ' + contactKept : ''}`,
    JSON.stringify({ kind: 'contact', id: cid, table: 'register_submissions', row: sub.id })]);
  return { ok: true, contactId: cid, partId: u.partId || '', partDeleted, partRestored, contactDeleted, contactKept,
    submission: subShape({ ...sub, status: '' }) };
}
async function undo(id, by) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await undoWith(client, id, by);
    await client.query(r.ok ? 'COMMIT' : 'ROLLBACK');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

/* 최근 확정 — 확정 취소할 수 있게 보여 준다(최근 30일) */
router.get('/:eventId/decided', async (req, res) => {
  try {
    await ensure();
    if (req.user && req.user.isTest) return res.json({ ok: true, decided: [] });
    const since = kstStamp(Date.now() - 30 * 86400e3);
    const { rows } = await pool.query(`SELECT * FROM register_submissions WHERE event_id = $1 AND status = 'done'
      AND decided_at >= $2 ORDER BY decided_at DESC, created_at`, [String(req.params.eventId), since]);
    res.json({ ok: true, decided: rows.map((r) => ({ ...subShape(r), decided_at: r.decided_at || '', decided_by: r.decided_by || '', contact_id: r.contact_id || '' })) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/sub/:id/:act', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 바꿀 수 없어요' });
  const { id, act } = req.params;
  if (!['accept', 'drop', 'undo'].includes(act)) return res.status(400).json({ ok: false, error: '모르는 처리예요' });
  const by = req.user?.name || req.user?.email || '';
  try {
    await ensure();
    if (act === 'drop') {
      const u = await pool.query(`UPDATE register_submissions SET status = 'dropped', decided_at = $2, decided_by = $3
        WHERE id = $1 AND COALESCE(status,'') = ''`, [id, kstStamp(Date.now()), by]);
      return u.rowCount ? res.json({ ok: true }) : res.status(409).json({ ok: false, error: '이미 처리된 신청이에요' });
    }
    if (act === 'undo') {
      const u = await undo(id, by);
      if (u.gone) return res.status(409).json({ ok: false, error: '확정된 신청이 아니에요(이미 취소했을 수 있어요)' });
      if (u.error) return res.status(409).json({ ok: false, error: u.error });
      return res.json(u);
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
  .hp { position:absolute; left:-9999px; }
  .done { text-align:center; padding:32px 24px; }
  .done .tick { width:52px; height:52px; margin:0 auto 14px; border-radius:50%; background:#dcfce7; color:#15803d;
    font-size:26px; font-weight:700; line-height:52px; }
  .done h1 { font-size:20px; margin-bottom:10px; }
  .done p { color:#374151; margin:0 0 8px; font-size:14px; } .done .lead { color:var(--ink); font-weight:600; }
  .done .sum { text-align:left; margin:20px 0 16px; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .done .sum-h { font-size:12px; font-weight:700; color:var(--dim); background:var(--bg); padding:8px 14px; border-bottom:1px solid var(--line); }
  .done table { width:100%; border-collapse:collapse; font-size:13.5px; }
  .done th { width:34%; text-align:left; font-weight:500; color:var(--dim); padding:7px 14px; vertical-align:top; }
  .done td { padding:7px 14px; word-break:break-all; }
  .done .close { color:var(--dim); font-size:13px; margin-top:4px; }`;

const L = {
  ko: { sub: '참가 신청서', consent: '행사 운영(안내·연락)을 위해 위 정보를 수집·이용하는 데 동의합니다. 행사 종료 후 주최 측 DB에 보관되며, 요청하시면 삭제합니다.',
    send: '제출하기', need: '필수 항목을 채워 주세요', badMail: '이메일 주소를 확인해 주세요', noConsent: '개인정보 수집·이용에 동의해 주세요',
    done: '참가 신청이 접수되었습니다', fail: '일시적인 오류로 신청을 접수하지 못했습니다. 잠시 후 다시 시도해 주시기 바랍니다.',
    doneLead: (ev) => `${ev} 참가 신청이 정상적으로 접수되었습니다.`,
    doneNext: '사무국에서 신청 내용을 확인한 후, 기재하신 이메일로 참가 확정 및 행사 안내를 보내드릴 예정입니다.',
    doneSum: '접수 내용', doneAt: '접수 일시', doneClose: '신청해 주셔서 감사합니다. 이 창은 닫으셔도 됩니다.',
    gone: '유효하지 않은 링크이거나 신청이 마감되었습니다. 행사 사무국으로 문의해 주시기 바랍니다.' },
  en: { sub: 'Registration', consent: 'I agree that the information above may be collected and used to run this event (notices and contact). It is kept in the organizer\'s database and deleted on request.',
    send: 'Submit', need: 'Please fill in the required fields', badMail: 'Please check your email address', noConsent: 'Please agree to the data collection notice',
    done: 'Registration received', fail: 'We were unable to process your registration due to a temporary error. Please try again shortly.',
    doneLead: (ev) => `Your registration for ${ev} has been successfully received.`,
    doneNext: 'Our secretariat will review your submission and send confirmation and event details to the email address you provided.',
    doneSum: 'Submission summary', doneAt: 'Received', doneClose: 'Thank you for registering. You may now close this window.',
    gone: 'This link is no longer valid or registration has closed. Please contact the event secretariat.' },
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

/* 접수 완료 — 무엇이 어디로 접수됐는지 보여 준다(나중에 «제대로 냈나» 묻는 일이 줄도록) */
function donePage(row, v, lang) {
  const t = L[lang];
  const sum = FIELDS.filter((f) => v[f.k]).map((f) => `<tr><th>${esc(f[lang])}</th><td>${esc(v[f.k])}</td></tr>`).join('');
  return shell(t.done, `<div class="card done">
    <div class="tick" aria-hidden="true">✓</div>
    <h1>${esc(t.done)}</h1>
    <p class="lead">${esc(t.doneLead(row.event_name || ''))}</p>
    <p>${esc(t.doneNext)}</p>
    ${sum ? `<div class="sum"><div class="sum-h">${esc(t.doneSum)}</div><table>${sum}
      <tr><th>${esc(t.doneAt)}</th><td>${esc(kstStamp(Date.now()))} (KST)</td></tr></table></div>` : ''}
    <p class="close">${esc(t.doneClose)}</p></div>`, lang);
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
    if (clip(b.website)) return res.type('html').send(donePage(row, {}, lang));
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
    res.type('html').send(donePage(row, v, lang));
  } catch (e) { next(e); }
});

/* 행사 홈페이지가 제 신청서를 그대로 두고 여기로 보낸다 — POST /r/<열쇠>/submit
   본문은 JSON 글자({ name, org, title, email, phone, extra, consent }). text/plain으로 받아
   브라우저가 사전 확인(preflight) 없이 보내게 한다. 열쇠가 있어야 들어온다 */
publicRouter.options('/:token/submit', (req, res) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.sendStatus(204);
});

publicRouter.post('/:token/submit', express.text({ type: '*/*', limit: '40kb' }), async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  try {
    const row = await linkByToken(req.params.token);
    if (!row) return res.status(404).json({ ok: false, error: 'closed' });
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
    if (!b || typeof b !== 'object') return res.status(400).json({ ok: false, error: 'bad' });
    if (clip(b.website)) return res.json({ ok: true });
    const v = cleanRow(b);
    if (FIELDS.some((f) => f.need && !v[f.k])) return res.status(400).json({ ok: false, error: 'need' });
    if (!EMAIL.test(v.email)) return res.status(400).json({ ok: false, error: 'email' });
    if (b.consent !== 'yes') return res.status(400).json({ ok: false, error: 'consent' });
    await stage(row.event_id, row.role, row.token, 'link', v);
    await pool.query('UPDATE register_links SET submits = COALESCE(submits,0) + 1, last_at = $2 WHERE token = $1',
      [row.token, kstStamp(Date.now())]);
    res.json({ ok: true });
  } catch (e) { console.error('[register] 홈페이지 제출 실패:', e.message); res.status(500).json({ ok: false, error: 'fail' }); }
});

module.exports = router;
module.exports.acceptWith = acceptWith;
module.exports.undoWith = undoWith;
module.exports.stage = stage;
module.exports.ensure = ensure;
module.exports.publicRouter = publicRouter;
module.exports.FIELDS = FIELDS;
