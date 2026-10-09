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
const NL = String.fromCharCode(10);
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

/* 같은 회사 다른 표기 찾기 — 회사명만 보낸다(개인정보 아님)
   body: { known: [{id, ko, en}], incoming?: [이름…] }
   incoming이 있으면: 그 이름들이 known의 어느 회사와 같은지 (업로드 때)
   없으면: known 안에서 같은 회사끼리 (기업DB 정리)
   답: { ok, pairs: [{ a, b, reason, caution }] } — a는 incoming 이름 또는 known id, b는 known id */
router.post('/company-pairs', async (req, res) => {
  if (!enabled()) return res.status(503).json({ ok: false, error: 'AI가 꺼져 있어요(ANTHROPIC_API_KEY 없음)' });
  const { known, incoming } = req.body || {};
  const ks = (Array.isArray(known) ? known : []).slice(0, 3000)
    .map((o) => ({ id: String(o.id || '').slice(0, 60), ko: String(o.ko || '').slice(0, 80), en: String(o.en || '').slice(0, 80) }))
    .filter((o) => o.id && (o.ko || o.en));
  const inc = Array.isArray(incoming) ? [...new Set(incoming.map((x) => String(x || '').trim().slice(0, 80)).filter(Boolean))].slice(0, 500) : null;
  if (!ks.length || (inc && !inc.length)) return res.status(400).json({ ok: false, error: '회사명이 없어요' });

  const ids = ks.map((o) => o.id);
  const schema = {
    type: 'object', additionalProperties: false, required: ['pairs'],
    properties: { pairs: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['a', 'b', 'reason', 'caution'],
      properties: { a: { type: 'string' }, b: { type: 'string' }, reason: { type: 'string' }, caution: { type: 'string' } },
    } } },
  };
  const list = ks.map((o) => [o.id, o.ko, o.en].join(' | ')).join(NL);
  const rules = [
    '같은 법인을 다르게 적은 것만 고르세요: 국문/영문 표기, 약칭, 옛 이름, 띄어쓰기·오타 (예: 한국엠에스디 = MSD Korea, 엘지화학 = LG Chem).',
    '이름이 비슷해도 다른 회사면 고르지 마세요 (예: Merck KGaA와 MSD(Merck & Co.)는 다른 회사, 삼성바이오로직스와 삼성바이오에피스는 다른 회사).',
    '한국 법인과 해외 본사(예: 한국화이자제약 ↔ Pfizer Inc.)처럼 같은 그룹이지만 법인이 다를 수 있으면 고르되 caution에 그렇게 적으세요. 아니면 caution은 "".',
    '확신이 없으면 고르지 마세요. 놓치는 것보다 잘못 합치는 것이 더 나쁩니다.',
    'reason은 한국어 한 줄로 근거를 적으세요.',
  ];
  const prompt = (inc
    ? ['행사 CRM에 새로 올라온 회사명이 이미 등록된 회사와 같은 곳인지 찾아 주세요.', ...rules,
      'a에는 새 회사명을 그대로, b에는 같은 곳인 등록 회사의 id를 적으세요. 같은 곳이 없으면 넣지 마세요.',
      '', '등록된 회사 (id | 국문 | 영문):', list, '', '새로 올라온 회사명:', ...inc]
    : ['행사 CRM의 회사 목록에서 같은 회사가 두 번 등록된 쌍을 찾아 주세요.', ...rules,
      'a와 b에는 두 회사의 id를 적으세요. 가장 확실한 것부터 최대 40쌍.',
      '', '회사 (id | 국문 | 영문):', list]).join(NL);

  try {
    const r = await ai().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: 55000, maxRetries: 0 }); // Vercel 함수는 60초에 끊긴다 — 그 전에 알아듣게 실패한다
    if (r.stop_reason === 'refusal') return res.status(502).json({ ok: false, error: 'AI가 답하지 않았어요' });
    const out = JSON.parse(r.content.filter((b) => b.type === 'text').map((b) => b.text).join(''));
    const incSet = new Set(inc || []);
    const seen = new Set();
    const pairs = (out.pairs || []).filter((p) => {
      if (!ids.includes(p.b)) return false;
      if (inc ? !incSet.has(p.a) : (!ids.includes(p.a) || p.a === p.b)) return false;
      const k = inc ? p.a : [p.a, p.b].sort().join('|');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map((p) => ({ a: p.a, b: p.b, reason: String(p.reason || '').slice(0, 160), caution: String(p.caution || '').slice(0, 160) }));
    res.json({ ok: true, pairs });
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError) return res.status(504).json({ ok: false, error: '기업이 많아 시간 안에 끝나지 않았어요' });
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ ok: false, error: 'AI 요청이 많아요 — 잠시 뒤에 다시' });
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ ok: false, error: 'AI 키가 맞지 않아요' });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ ok: false, error: `AI 오류 (${e.status || '연결'})` });
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* 질문으로 찾기 — 질문을 «조건표»로 바꾼다. 연락처는 보내지 않는다.
   보내는 것: 질문 문장, 행사 목록(이름·날짜), 참가 역할·카테고리·태그 이름, 국가 이름 목록, 오늘 날짜.
   거르기는 화면이 제 데이터로 한다(js/modules/db-tab.js의 aiMatches).
   body: { question, today, events:[{key,short,date}], roles:[…], cats:[{key,label}], tags:[{key,label}], countries:[…] } */
router.post('/query-plan', async (req, res) => {
  if (!enabled()) return res.status(503).json({ ok: false, error: 'AI가 꺼져 있어요(ANTHROPIC_API_KEY 없음)' });
  const b = req.body || {};
  const question = String(b.question || '').trim().slice(0, 300);
  if (!question) return res.status(400).json({ ok: false, error: '질문을 적어주세요' });
  const str = (v, n) => String(v || '').slice(0, n);
  const events = (Array.isArray(b.events) ? b.events : []).slice(0, 300)
    .map((e) => ({ key: str(e.key, 80), short: str(e.short, 40), date: str(e.date, 10) })).filter((e) => e.key);
  const roles = (Array.isArray(b.roles) ? b.roles : []).map((r) => str(r, 30)).filter(Boolean).slice(0, 40);
  const cats = (Array.isArray(b.cats) ? b.cats : []).map((c) => ({ key: str(c.key, 30), label: str(c.label, 30) })).filter((c) => c.key).slice(0, 30);
  const tags = (Array.isArray(b.tags) ? b.tags : []).map((t) => ({ key: str(t.key, 40), label: str(t.label, 40) })).filter((t) => t.key).slice(0, 100);
  const countries = (Array.isArray(b.countries) ? b.countries : []).map((c) => str(c, 40)).filter(Boolean).slice(0, 250);

  const list = (items) => ({ type: 'array', items });
  const en = (vals) => (vals.length ? { type: 'string', enum: vals } : { type: 'string' });
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['explain', 'unsupported', 'events_any', 'events_all', 'events_none', 'roles', 'cats', 'tags', 'clevel', 'countries', 'org_keywords', 'title_keywords', 'include_left'],
    properties: {
      explain: { type: 'string' },
      unsupported: { type: 'string' },
      events_any: list(en(events.map((e) => e.key))),
      events_all: list(en(events.map((e) => e.key))),
      events_none: list(en(events.map((e) => e.key))),
      roles: list(en(roles)),
      cats: list(en(cats.map((c) => c.key))),
      tags: list(en(tags.map((t) => t.key))),
      clevel: { type: 'boolean' },
      countries: list(en(countries)),
      org_keywords: list({ type: 'string' }),
      title_keywords: list({ type: 'string' }),
      include_left: { type: 'boolean' },
    },
  };
  const prompt = [
    '행사 CRM의 연락처 검색 질문을 아래 조건표로 바꿔 주세요. 조건은 모두 «그리고»로 겹칩니다. 쓰지 않는 조건은 빈 목록·false로 두세요.',
    '- events_any: 이 행사들 중 하나라도 참가한 사람. events_all: 이 행사들에 모두 참가한 사람(«둘 다», «모두», «연속»). events_none: 이 행사들에는 참가하지 않은 사람.',
    '- roles: 참가 역할. events_any·events_all이 있으면 그 행사에서의 역할, 없으면 어느 행사에서든 그 역할.',
    '- «기업 담당자», «참가사», «전시사», «부스»는 카테고리 exhibitor(전시참가기업)를 뜻합니다. «연사»는 speaker, «후원사»는 sponsor.',
    '- cats: 연락처 카테고리. tags: 태그. clevel: 대표·임원(C-level)만.',
    '- countries: 국가(목록에 있는 이름만). org_keywords / title_keywords: 기업명·직함에 들어갈 낱말(하나라도 맞으면). 국문·영문 표기를 함께 넣으세요(예: 대표, CEO).',
    '- include_left: 퇴사자도 포함할지. 질문에 없으면 false.',
    '- «작년», «올해», «최근» 같은 말은 오늘 날짜와 행사 날짜로 풀어서 행사를 고르세요. «BIO KOREA», «KIC»처럼 행사 이름 일부만 말하면 해당하는 행사를 모두 고르세요.',
    '- 이 조건표로 표현할 수 없는 부분(예: 회신 여부, 메일 내용, 연사료)은 unsupported에 한국어로 적고 나머지만 바꾸세요. 없으면 "". 이 칸과 explain에는 events_any 같은 칸 이름을 쓰지 말고 사람이 읽는 말로 적으세요.',
    '- explain: 어떻게 해석했는지 한국어 한 줄 (예: «2025년 KIC 행사 연사 중 2026년 행사에 없는 미국 사람»).',
    '',
    `오늘: ${str(b.today, 10)}`,
    `행사 (key | 약칭 | 날짜):${NL}${events.map((e) => [e.key, e.short, e.date].join(' | ')).join(NL)}`,
    `참가 역할: ${roles.join(', ')}`,
    `카테고리 (key | 이름): ${cats.map((c) => `${c.key}=${c.label}`).join(', ')}`,
    `태그 (key | 이름): ${tags.map((t) => `${t.key}=${t.label}`).join(', ')}`,
    `국가: ${countries.join(', ')}`,
    '',
    `질문: ${question}`,
  ].join(NL);

  try {
    const r = await ai().beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: 55000, maxRetries: 0 });
    if (r.stop_reason === 'refusal') return res.status(502).json({ ok: false, error: 'AI가 답하지 않았어요' });
    const plan = JSON.parse(r.content.filter((x) => x.type === 'text').map((x) => x.text).join(''));
    res.json({ ok: true, plan });
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError) return res.status(504).json({ ok: false, error: '시간 안에 끝나지 않았어요' });
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ ok: false, error: 'AI 요청이 많아요 — 잠시 뒤에 다시' });
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ ok: false, error: 'AI 키가 맞지 않아요' });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ ok: false, error: `AI 오류 (${e.status || '연결'})` });
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* 기업 질문으로 찾기 — 위와 같은 방식, 기업DB용 조건표.
   보내는 것: 질문, 행사 목록, 행사 역할·기업 종류·업종·국가 이름. 기업명·금액은 보내지 않는다.
   거르기는 화면(js/modules/company-tab.js의 coAiMatches)이 한다.
   body: { question, today, events, roles, kinds:[{key,label}], sectors:[…], countries:[…] } */
router.post('/org-query-plan', async (req, res) => {
  if (!enabled()) return res.status(503).json({ ok: false, error: 'AI가 꺼져 있어요(ANTHROPIC_API_KEY 없음)' });
  const b = req.body || {};
  const question = String(b.question || '').trim().slice(0, 300);
  if (!question) return res.status(400).json({ ok: false, error: '질문을 적어주세요' });
  const str = (v, n) => String(v || '').slice(0, n);
  const events = (Array.isArray(b.events) ? b.events : []).slice(0, 300)
    .map((e) => ({ key: str(e.key, 80), short: str(e.short, 40), date: str(e.date, 10) })).filter((e) => e.key);
  const strs = (a, n, m) => (Array.isArray(a) ? a : []).map((x) => str(x, n)).filter(Boolean).slice(0, m);
  const roles = strs(b.roles, 30, 40);
  const kinds = (Array.isArray(b.kinds) ? b.kinds : []).map((k) => ({ key: str(k.key, 30), label: str(k.label, 30) })).filter((k) => k.key).slice(0, 20);
  const sectors = strs(b.sectors, 40, 300);
  const countries = strs(b.countries, 40, 250);

  const list = (items) => ({ type: 'array', items });
  const en = (vals) => (vals.length ? { type: 'string', enum: vals } : { type: 'string' });
  const evKeys = events.map((e) => e.key);
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['explain', 'unsupported', 'events_any', 'events_all', 'events_none', 'roles', 'kinds', 'sectors', 'countries',
      'name_keywords', 'product_keywords', 'unpaid', 'overdue'],
    properties: {
      explain: { type: 'string' },
      unsupported: { type: 'string' },
      events_any: list(en(evKeys)),
      events_all: list(en(evKeys)),
      events_none: list(en(evKeys)),
      roles: list(en(roles)),
      kinds: list(en(kinds.map((k) => k.key))),
      sectors: list(en(sectors)),
      countries: list(en(countries)),
      name_keywords: list({ type: 'string' }),
      product_keywords: list({ type: 'string' }),
      unpaid: { type: 'boolean' },
      overdue: { type: 'boolean' },
    },
  };
  const prompt = [
    '행사 CRM의 기업 검색 질문을 아래 조건표로 바꿔 주세요. 조건은 모두 «그리고»로 겹칩니다. 쓰지 않는 조건은 빈 목록·false로 두세요.',
    '- events_any: 이 행사들 중 하나라도 참가한 기업. events_all: 모두 참가한 기업(«둘 다», «연속»). events_none: 참가하지 않은 기업.',
    '- roles: 행사에서의 역할(예: 전시참가기업, 시공사, 스폰서). 행사 조건이 있으면 그 행사에서의 역할.',
    '- kinds: 기업 종류. sectors: 업종(목록에 있는 이름만). countries: 국가(목록에 있는 이름만).',
    '- name_keywords: 기업명에 들어갈 낱말, product_keywords: 전시 품목·소개에 들어갈 낱말(하나라도 맞으면). 국문·영문을 함께 넣으세요.',
    '- unpaid: 청구했는데 아직 다 받지 못한 돈(미납·미수금·잔금)이 있는 기업. 행사 조건이 있으면 그 행사의 청구만 봅니다.',
    '- overdue: 납부 기한이 지난 미납이 있는 기업(«연체», «기한 지난»).',
    '- «전시 참가 기업», «참가사», «전시사»는 역할 전시참가기업 또는 기업 종류 전시참가기업입니다 — 행사 조건이 있으면 역할로, 없으면 종류로 거세요.',
    '- «작년», «올해»는 오늘 날짜와 행사 날짜로 풀고, «KIC»처럼 이름 일부만 말하면 해당 행사를 모두 고르세요.',
    '- 표현할 수 없는 부분은 unsupported에 한국어로 적고 나머지만 바꾸세요. 없으면 "". explain과 unsupported에는 칸 이름(events_any 등)을 쓰지 말고 사람이 읽는 말로.',
    '- explain: 어떻게 해석했는지 한국어 한 줄.',
    '',
    `오늘: ${str(b.today, 10)}`,
    `행사 (key | 약칭 | 날짜):${NL}${events.map((e) => [e.key, e.short, e.date].join(' | ')).join(NL)}`,
    `행사 역할: ${roles.join(', ')}`,
    `기업 종류 (key=이름): ${kinds.map((k) => `${k.key}=${k.label}`).join(', ')}`,
    `업종: ${sectors.join(', ')}`,
    `국가: ${countries.join(', ')}`,
    '',
    `질문: ${question}`,
  ].join(NL);

  try {
    const r = await ai().beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: 55000, maxRetries: 0 });
    if (r.stop_reason === 'refusal') return res.status(502).json({ ok: false, error: 'AI가 답하지 않았어요' });
    const plan = JSON.parse(r.content.filter((x) => x.type === 'text').map((x) => x.text).join(''));
    res.json({ ok: true, plan });
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError) return res.status(504).json({ ok: false, error: '시간 안에 끝나지 않았어요' });
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ ok: false, error: 'AI 요청이 많아요 — 잠시 뒤에 다시' });
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ ok: false, error: 'AI 키가 맞지 않아요' });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ ok: false, error: `AI 오류 (${e.status || '연결'})` });
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* 기업 국가·업종 추천 — 국가가 비었거나 업종이 «미정»인 기업
   보내는 것: 기업명(국문·영문), 웹사이트, 전시 품목·소개 앞부분, 지금 업종. 사람 정보는 보내지 않는다.
   body: { orgs:[{id, ko, en, web, about, sectors, wantCountry, sectorChoices:[업종 이름…]}], countries:[국가 이름…] }
   답: { ok, items:[{ id, country, sector, sure, reason }] } — 고를 수 없으면 ''. 저장은 화면에서 사람이 고른 것만 */
router.post('/org-enrich', async (req, res) => {
  if (!enabled()) return res.status(503).json({ ok: false, error: 'AI가 꺼져 있어요(ANTHROPIC_API_KEY 없음)' });
  const b = req.body || {};
  const str = (v, n) => String(v || '').slice(0, n);
  const countries = (Array.isArray(b.countries) ? b.countries : []).map((c) => str(c, 40)).filter(Boolean).slice(0, 300);
  const orgs = (Array.isArray(b.orgs) ? b.orgs : []).slice(0, 80).map((o) => ({
    id: str(o.id, 60), ko: str(o.ko, 80), en: str(o.en, 80), web: str(o.web, 80), about: str(o.about, 160),
    sectors: str(o.sectors, 80), wantCountry: !!o.wantCountry,
    sectorChoices: (Array.isArray(o.sectorChoices) ? o.sectorChoices : []).map((s) => str(s, 40)).filter(Boolean).slice(0, 60),
  })).filter((o) => o.id && (o.ko || o.en) && (o.wantCountry || o.sectorChoices.length));
  if (!orgs.length) return res.status(400).json({ ok: false, error: '추천할 기업이 없어요' });

  const schema = {
    type: 'object', additionalProperties: false, required: ['items'],
    properties: { items: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['id', 'country', 'sector', 'sure', 'reason'],
      properties: { id: { type: 'string' }, country: { type: 'string' }, sector: { type: 'string' }, sure: { type: 'boolean' }, reason: { type: 'string' } },
    } } },
  };
  const prompt = [
    '행사 CRM의 기업 목록입니다. 기업마다 빠진 국가와 업종을 채워 주세요.',
    '- country: «국가 필요»인 기업만. 본사 국가를 아래 국가 목록의 이름 그대로 적으세요. 한국어 이름이나 .kr 웹사이트, ㈜·주식회사가 붙은 회사는 대개 대한민국입니다. 모르면 "".',
    '- sector: «업종 후보»가 있는 기업만. 그 후보 중 하나를 그대로 적으세요. 이름·품목으로 판단이 안 되면 "".',
    '- 필요 없는 칸은 ""로 두세요.',
    '- sure: 잘 알려진 회사이거나 이름·품목만으로 분명하면 true, 짐작이면 false.',
    '- reason: 한국어 한 줄 근거.',
    '',
    `국가 목록: ${countries.join(', ')}`,
    '',
    '기업:',
    ...orgs.map((o) => [
      `[${o.id}] ${[o.ko, o.en].filter(Boolean).join(' / ')}`,
      o.web ? `웹: ${o.web}` : '',
      o.about ? `품목·소개: ${o.about}` : '',
      o.sectors ? `지금 업종: ${o.sectors}` : '',
      o.wantCountry ? '국가 필요' : '',
      o.sectorChoices.length ? `업종 후보: ${o.sectorChoices.join(', ')}` : '',
    ].filter(Boolean).join(' · ')),
  ].join(NL);

  try {
    const r = await ai().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: 55000, maxRetries: 0 });
    if (r.stop_reason === 'refusal') return res.status(502).json({ ok: false, error: 'AI가 답하지 않았어요' });
    const out = JSON.parse(r.content.filter((x) => x.type === 'text').map((x) => x.text).join(''));
    const byId = new Map(orgs.map((o) => [o.id, o]));
    const cset = new Set(countries);
    const items = (out.items || []).filter((it) => byId.has(it.id)).map((it) => {
      const o = byId.get(it.id);
      return {
        id: it.id,
        country: o.wantCountry && cset.has(it.country) ? it.country : '',
        sector: o.sectorChoices.includes(it.sector) ? it.sector : '',
        sure: !!it.sure,
        reason: String(it.reason || '').slice(0, 160),
      };
    }).filter((it) => it.country || it.sector);
    res.json({ ok: true, items });
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError) return res.status(504).json({ ok: false, error: '시간 안에 끝나지 않았어요' });
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ ok: false, error: 'AI 요청이 많아요 — 잠시 뒤에 다시' });
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ ok: false, error: 'AI 키가 맞지 않아요' });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ ok: false, error: `AI 오류 (${e.status || '연결'})` });
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* 연사 상황 상담 — «발표자료 파일이 깨져서 다시 받아야 해» 같은 질문에 할 일을 답한다.
   메일 본문·이름·메일 주소·제목은 보내지 않는다(메일 제목에 이름이 들어간다).
   보내는 것: 질문, 역할·섭외 상태·언어, 연락 단계(이름·끝났는지·지금 단계·마감), 남은 일 이름,
   최근 기록의 날짜·방향·단계 이름. 화면이 답의 단추(action)를 실제 기능에 잇는다.
   body: { question, today, lang, roles, status, steps:[{key,label,applies,done,current,resend,since,due,undoable}],
           remind, pending:[{label,when,due}], logs:[{date,dir,step,channel}] } */
const SPEAKER_CRM_GUIDE = [
  '우리 CRM(행사 연사 관리)에서 담당자가 할 수 있는 일:',
  '- 연락 단계: 행사마다 초청·가이드 발송 → 참석 회신 받기 → 자료 받기 → 참가 확정 → 숙박·항공 안내 → 발표자료 받기 → 감사 메일 순서(행사가 단계를 더하거나 끌 수 있다). 지금 할 일은 해당되면서 안 끝난 첫 단계.',
  '- «✉ 메일 초안 만들기»(action=mail, arg=단계 key): 그 단계의 메일 양식이 채워진 초안을 연다. 다른 단계의 메일도 같은 단추로 다시 보낼 수 있다. 자료 받기 단계는 이미 요청을 보냈으면 자동으로 «독촉» 문구가 된다.',
  '- «📨 여러 연사에게»(action=bulk, arg=단계 key): 같은 단계 메일을 그 단계 차례인 연사들에게 한 번에.',
  '- «↶ 이전 단계로»(action=undo, arg=단계 key): 날짜를 찍어 끝나는 단계(초청 발송·참석 회신·참가 확정)를 안 한 것으로 되돌린다. 보낸 메일 기록은 남는다. undoable=true인 단계만 된다.',
  '- 자료를 받았다고 표시한 칸을 다시 «안 받음»으로 돌리면 자료 받기 단계가 다시 열린다 — 그 자료가 있는 탭(action=tab)에서 칸을 고친다. 탭: basic(기본: 소속·사진·동의서), bio(이력: 약력·CV), talk(발제: 제목·초록·발표자료), offer(제공사항: 연사료·숙박·항공), bank(계좌·여권).',
  '- «✎ 단계 편집»(action=editflow): 행사 전체의 단계를 고친다. 기본 단계에 «기준일»을 적으면 그 단계를 이미 받은 연사에게 «다시 보내기»가 걸린다(일정·장소가 바뀌어 모두에게 다시 알려야 할 때). 일정 변경 안내 같은 단계를 새로 더할 수도 있다.',
  '- 받은 메일·통화는 연사 «메일함» 탭에 기록으로 남는다.',
].join(NL);
router.post('/speaker-advice', async (req, res) => {
  if (!enabled()) return res.status(503).json({ ok: false, error: 'AI가 꺼져 있어요(ANTHROPIC_API_KEY 없음)' });
  const b = req.body || {};
  const str = (v, n) => String(v || '').slice(0, n);
  const question = str(b.question, 500).trim();
  if (!question) return res.status(400).json({ ok: false, error: '상황을 적어주세요' });
  const steps = (Array.isArray(b.steps) ? b.steps : []).slice(0, 20).map((s) => ({
    key: str(s.key, 40), label: str(s.label, 40), applies: !!s.applies, done: !!s.done, current: !!s.current,
    resend: !!s.resend, since: str(s.since, 10), due: str(s.due, 10), undoable: !!s.undoable,
  })).filter((s) => s.key);
  const pending = (Array.isArray(b.pending) ? b.pending : []).slice(0, 20).map((p) => ({ label: str(p.label, 30), when: str(p.when, 10), due: str(p.due, 10) }));
  const logs = (Array.isArray(b.logs) ? b.logs : []).slice(0, 15).map((l) => ({ date: str(l.date, 10), dir: str(l.dir, 6), step: str(l.step, 40), channel: str(l.channel, 10) }));
  const TABS = ['basic', 'bio', 'talk', 'offer', 'bank'];
  const stepKeys = steps.map((s) => s.key);

  const schema = {
    type: 'object', additionalProperties: false, required: ['summary', 'todo', 'caution'],
    properties: {
      summary: { type: 'string' },
      todo: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['text', 'action', 'arg'],
        properties: {
          text: { type: 'string' },
          action: { type: 'string', enum: ['none', 'mail', 'bulk', 'undo', 'tab', 'editflow'] },
          arg: { type: 'string' },
        },
      } },
      caution: { type: 'string' },
    },
  };
  const when = { now: '지금 받을 것', later: '다음에 받을 것', ours: '우리가 할 일', nice: '있으면 좋음' };
  const prompt = [
    '행사 사무국 담당자가 연사 한 명에 대해 상황을 물어봅니다. 이 CRM에서 무엇을 어떤 순서로 하면 되는지 답해 주세요.',
    '',
    SPEAKER_CRM_GUIDE,
    '',
    '답하는 법:',
    '- summary: 한두 문장으로 결론(예: «자료 받기를 다시 열고 발표자료 재요청 메일을 보내면 됩니다»).',
    '- todo: 할 일을 순서대로 2~5개. 각 줄은 한국어 한 문장. 그 줄에 맞는 단추가 있으면 action과 arg(단계 key 또는 탭)를 적고, 사람이 직접 할 일(전화, 파일 확인 등)이면 action=none, arg="".',
    '- 아래 연사 상태에 실제로 있는 단계 key만 쓰세요. undo는 undoable=true인 단계에만.',
    '- caution: 실수하기 쉬운 점이 있으면 한 줄(예: 다른 연사에게도 같은 문제가 있는지 확인). 없으면 "".',
    '- 이 연사의 이름이나 메일 내용은 모릅니다. 상태만 보고 답하세요.',
    '',
    `오늘: ${str(b.today, 10)}`,
    `역할: ${(Array.isArray(b.roles) ? b.roles : []).map((r) => str(r, 20)).join(', ') || '(미배정)'} · 섭외 상태: ${str(b.status, 20) || '-'} · 메일 언어: ${str(b.lang, 10) || '국문'}`,
    `연락 단계 (key | 이름 | 상태):${NL}${steps.map((s) => [s.key, s.label,
      !s.applies ? '해당 없음' : s.current ? '지금 할 일' : s.done ? '끝남' : '아직',
      s.resend ? `다시 보내기(기준일 ${s.since})` : '', s.due ? `마감 ${s.due}` : '', s.undoable ? 'undoable' : ''].filter(Boolean).join(' | ')).join(NL)}`,
    b.remind ? '자료 요청 메일을 이미 보냈고 아직 덜 받음(다음 자료 메일은 독촉).' : '',
    `남은 일: ${pending.map((p) => `${p.label}(${when[p.when] || p.when}${p.due ? `, 마감 ${p.due}` : ''})`).join(', ') || '없음'}`,
    `최근 기록 (날짜 | 방향 | 단계 | 채널):${NL}${logs.map((l) => [l.date, l.dir, l.step || '-', l.channel].join(' | ')).join(NL) || '없음'}`,
    '',
    `상황: ${question}`,
  ].filter((x) => x !== '').join(NL);

  try {
    const r = await ai().beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: 55000, maxRetries: 0 });
    if (r.stop_reason === 'refusal') return res.status(502).json({ ok: false, error: 'AI가 답하지 않았어요' });
    const out = JSON.parse(r.content.filter((x) => x.type === 'text').map((x) => x.text).join(''));
    // 단추는 실제로 있는 단계·탭에만 — 아니면 글만 남긴다
    const todo = (out.todo || []).slice(0, 6).map((t) => {
      let { action, arg } = t;
      const okArg = action === 'tab' ? TABS.includes(arg)
        : ['mail', 'bulk'].includes(action) ? stepKeys.includes(arg)
        : action === 'undo' ? steps.some((s) => s.key === arg && s.undoable)
        : true;
      if (!okArg) { action = 'none'; arg = ''; }
      if (action === 'none' || action === 'editflow') arg = '';
      return { text: String(t.text || '').slice(0, 300), action, arg };
    });
    res.json({ ok: true, summary: String(out.summary || '').slice(0, 400), todo, caution: String(out.caution || '').slice(0, 300) });
  } catch (e) {
    if (e instanceof Anthropic.APIConnectionTimeoutError) return res.status(504).json({ ok: false, error: '시간 안에 끝나지 않았어요' });
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ ok: false, error: 'AI 요청이 많아요 — 잠시 뒤에 다시' });
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ ok: false, error: 'AI 키가 맞지 않아요' });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ ok: false, error: `AI 오류 (${e.status || '연결'})` });
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
module.exports.shape = shape;
