/* ══════════════════════════════════════════════════════════════
   routes/contacts.js — 화면에서 연락처를 넣는 한 길 (2026-11-25)

   서버 스크립트·신청 확정·현장 신규·나라장터는 contactUpserter 한 길로 모였는데(CLAUDE.md «한 길»),
   화면은 일곱 곳(데이터 업로드·명단 맞추기·연사 자동 연결·연사 기본·전시 담당자·직접 추가·컨택 명단 채우기)이
   nextContactId()로 저마다 만들고 같은 사람 찾기도 저마다 했다. 화면도 여기로 보내 기준을 하나로 둔다.

     POST /api/contacts/match   { contacts:[…] }                → 같은 사람 미리보기(쓰지 않는다)
     POST /api/contacts/upsert  { contacts:[…], source, onSuspect } → 같은 사람이면 빈 칸만 채우고, 아니면 새 id로 넣고
                                                                     기업DB에 잇는다. 넣은 줄·새 기업을 돌려준다
   한 번에 200명까지. 한 트랜잭션 — 한 줄이 틀리면 모두 되돌린다(반쪽만 들어가지 않게).
   «의심»(메일만 같고 이름이 다름 · 이름만 같음)은 기본으로 새 사람으로 넣고 무엇과 닮았는지 돌려준다.
══════════════════════════════════════════════════════════════ */
const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { contactUpserter } = require('../db/contact-upsert');

const router = express.Router();
const MAX = 200;
const FIELDS = ['nameKo', 'nameEn', 'orgKo', 'orgEn', 'titleKo', 'titleEn', 'deptKo', 'deptEn', 'prefix',
  'country', 'cat', 'lang', 'status', 'email1', 'email2', 'phone1', 'phone2', 'beat', 'products', 'tags',
  'org_id', 'memo1', 'memo2', 'memo3', 'origin', 'source'];
const clean = (raw) => {
  const v = {};
  FIELDS.forEach((k) => { if (raw && raw[k] != null && String(raw[k]).trim() !== '') v[k] = String(raw[k]).trim().slice(0, 2000); });
  return v;
};
const listOf = (body) => (Array.isArray(body?.contacts) ? body.contacts : body?.contact ? [body.contact] : []).slice(0, MAX + 1);
const brief = (c) => c && ({ id: String(c.id), name: c.nameKo || c.nameEn || '', org: c.orgKo || c.orgEn || '', email: c.email1 || '' });
const kstNow = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

/* 미리보기 — 넣지 않고 같은 사람만 찾는다(«새로 만들기» 전에 «이미 있어요»를 보여 주려고) */
router.post('/match', async (req, res, next) => {
  const list = listOf(req.body);
  if (list.length > MAX) return res.status(400).json({ ok: false, error: `한 번에 ${MAX}명까지예요` });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const put = await contactUpserter(client, { source: '미리보기' });
    const out = list.map((raw) => {
      const m = put.match(clean(raw));
      return { contact: brief(m.contact), by: m.by || '', suspect: brief(m.suspect), why: m.why || '' };
    });
    await client.query('ROLLBACK');
    res.json({ ok: true, results: out });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});

router.post('/upsert', async (req, res, next) => {
  const list = listOf(req.body);
  if (!list.length) return res.status(400).json({ ok: false, error: '넣을 사람이 없어요' });
  if (list.length > MAX) return res.status(400).json({ ok: false, error: `한 번에 ${MAX}명까지예요` });
  const source = String(req.body?.source || '화면에서 추가').slice(0, 200);
  const onSuspect = req.body?.onSuspect === 'skip' ? 'skip' : 'new';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const put = await contactUpserter(client, { source, onSuspect });
    const results = [];
    for (let i = 0; i < list.length; i++) {
      const v = clean(list[i]);
      if (!v.nameKo && !v.nameEn && !v.email1) { results.push({ error: '이름도 메일도 없어요' }); continue; }
      const m = put.match(v);
      const r = await put(v);
      results.push({ id: r.id, created: r.created, by: r.by, suspect: brief(r.suspect), why: m.why || '' });
    }
    const ids = results.map((r) => r.id).filter(Boolean);
    const rows = ids.length ? (await client.query('SELECT * FROM contacts WHERE id::text = ANY($1)', [ids])).rows : [];
    const orgIds = put.orgsCreated.map((o) => o.id);
    const orgs = orgIds.length ? (await client.query('SELECT * FROM orgs WHERE id = ANY($1)', [orgIds])).rows : [];
    const made = results.filter((r) => r.created).length;
    await client.query(`INSERT INTO activity_log (id, ts, email, name, type, action, target, detail, link)
      VALUES ($1,$2,$3,$4,'create','연락처 넣기',$5,$6,'')`,
    ['L-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'), new Date().toISOString(), req.user?.email || '', req.user?.name || '',
      source, `${kstNow()} ${source} — 새로 ${made} · 붙임 ${results.filter((r) => r.id && !r.created).length}`
        + `${results.some((r) => r.suspect) ? ` · 의심 ${results.filter((r) => r.suspect).length}` : ''}${orgs.length ? ` · 새 기업 ${orgs.length}` : ''}`]);
    await client.query('COMMIT');
    res.json({ ok: true, results, contacts: rows, orgs });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); }
  finally { client.release(); }
});

module.exports = router;
