/* ─────────────────────────────────────────────
   ai.js — Claude에게 묻는 일
   개인정보는 보내지 않는다. 열 맞추기는 머리글과 «값의 모양»만 보낸다.
   모양: 한글은 가, 영문은 a/A, 숫자는 9로 바꾼 것 — «홍길동 / gd@snuh.org»는
   «가가가 / aa@aaaa.aaa»가 된다. 화면에서 바꿔 보내지만 서버에서도 한 번 더 바꾼다.
   ANTHROPIC_API_KEY가 없으면 «꺼져 있음»으로 답하고 화면은 기존 규칙 매칭만 쓴다.
   ───────────────────────────────────────────── */
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();
const MODEL = 'claude-sonnet-5-5';
let client = null;
const ai = () => (client || (client = new Anthropic()));
const enabled = () => !!process.env.ANTHROPIC_API_KEY;

// 값의 모양 — 글자 종류만 남긴다(화면의 shapeOf와 같은 규칙)
const shape = (v) => String(v || '').slice(0, 40)
  .replace(/[가-힣ㄱ-ㅎㅏ-ㅣ]/g, '가').replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/[0-9]/g, '9')
  .replace(/[^가Aa9@.\-_/()+:,# ]/g, '?');

router.get('/status', (req, res) => res.json({ ok: true, enabled: enabled() }));

/* 열 맞추기 — body: { fields: [{key,label}], columns: [{header, samples:[…], filled}] }
   답: { ok, mappings: [{ header, field, reason }] } — field ''는 «맞는 칸 없음» */
router.post('/map-columns', async (req, res) => {
  if (!enabled()) return res.status(503).json({ ok: false, error: 'AI가 꺼져 있어요(ANTHROPIC_API_KEY 없음)' });
  const { fields, columns } = req.body || {};
  const fs = (Array.isArray(fields) ? fields : [])
    .filter((f) => f && /^[A-Za-z0-9_]{1,30}$/.test(f.key)).slice(0, 60)
    .map((f) => ({ key: f.key, label: String(f.label || '').slice(0, 40) }));
  const cs = (Array.isArray(columns) ? columns : []).slice(0, 80)
    .map((c) => ({ header: String(c.header || '').slice(0, 80), filled: Number(c.filled) || 0,
      samples: (Array.isArray(c.samples) ? c.samples : []).slice(0, 3).map(shape) }))
    .filter((c) => c.header);
  if (!fs.length || !cs.length) return res.status(400).json({ ok: false, error: '머리글이 없어요' });

  const keys = fs.map((f) => f.key);
  const schema = {
    type: 'object', additionalProperties: false, required: ['mappings'],
    properties: { mappings: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['header', 'field', 'reason'],
      properties: { header: { type: 'string' }, field: { type: 'string', enum: ['', ...keys] }, reason: { type: 'string' } },
    } } },
  };
  const prompt = [
    '행사 참가자·연락처 명단 엑셀의 열을 우리 CRM 칸에 맞춰 주세요.',
    '각 열에는 머리글과 값의 «모양»만 있습니다. 모양은 한글=가, 영문 대문자=A, 소문자=a, 숫자=9로 바꾼 것이라 실제 값은 모릅니다.',
    '- 열마다 가장 맞는 칸 하나를 고르고, 확신이 없거나 맞는 칸이 없으면 ""로 두세요.',
    '- 한 칸에 두 열을 넣지 마세요. 겹치면 더 맞는 열 하나만 고르세요.',
    '- reason은 한국어 한 줄로, 왜 그 칸인지(머리글·모양 근거)를 적으세요.',
    '',
    `우리 칸:\n${fs.map((f) => `${f.key}: ${f.label}`).join('\n')}`,
    '',
    `엑셀 열:\n${cs.map((c) => `«${c.header}» (값 있는 줄 ${c.filled}) 모양: ${c.samples.join(' | ') || '(비어 있음)'}`).join('\n')}`,
  ].join('\n');

  try {
    const r = await ai().beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    });
    if (r.stop_reason === 'refusal') return res.status(502).json({ ok: false, error: 'AI가 답하지 않았어요' });
    const text = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const out = JSON.parse(text);
    // 우리가 보낸 머리글·칸만, 한 칸에 한 열만 남긴다
    const headers = new Set(cs.map((c) => c.header));
    const used = new Set();
    const mappings = (out.mappings || []).filter((m) => headers.has(m.header)).map((m) => {
      const field = m.field && keys.includes(m.field) && !used.has(m.field) ? m.field : '';
      if (field) used.add(field);
      return { header: m.header, field, reason: String(m.reason || '').slice(0, 120) };
    });
    res.json({ ok: true, mappings });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ ok: false, error: 'AI 요청이 많아요 — 잠시 뒤에 다시' });
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ ok: false, error: 'AI 키가 맞지 않아요' });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ ok: false, error: `AI 오류 (${e.status || '연결'})` });
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
module.exports.shape = shape;
