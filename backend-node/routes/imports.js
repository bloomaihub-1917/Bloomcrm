/* ══════════════════════════════════════════════════════════════
   imports.js — 화면에서 올리는 정해진 양식의 엑셀 가져오기

     POST /api/imports/g2b-buyers   { eventId, roundId?, rows, apply }
          나라장터 행사대행 발주기관 담당자 → Master DB + 행사 바이어 + 영업 파이프라인(lib/g2b-buyers.js)
          apply가 없으면 시험 실행 — 같은 일을 한 뒤 되돌리고 결과만 돌려준다
══════════════════════════════════════════════════════════════ */
const express = require('express');
const pool = require('../db/pool');
const { checkContacts } = require('../db/contact-upsert');
const { importG2bBuyers } = require('../lib/g2b-buyers');

const router = express.Router();

router.post('/g2b-buyers', async (req, res) => {
  const { eventId, rows, roundId } = req.body || {};
  const apply = req.body?.apply === true;
  if (!eventId || !Array.isArray(rows) || !rows.length) return res.status(400).json({ ok: false, error: '행사와 엑셀 줄이 필요해요' });
  if (rows.length > 5000) return res.status(400).json({ ok: false, error: '한 번에 5000줄까지 올릴 수 있어요' });
  if (apply && req.user?.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 저장할 수 없어요' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const report = await importG2bBuyers(client, { rows, eventId: String(eventId), roundId: roundId ? String(roundId) : '', by: req.user?.email || '' });
    const chk = await checkContacts(client);
    if (chk.longIds) throw new Error('16자리를 넘는 연락처 id가 생겨 되돌렸어요');
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    res.json({ ok: true, applied: apply, report });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

module.exports = router;
