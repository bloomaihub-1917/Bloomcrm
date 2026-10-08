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

module.exports = router;
module.exports.shape = shape;
