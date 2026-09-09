/* ══════════════════════════════════════════════════════════════
   public.js — 웹디렉토리 (프로그램북 게재 정보의 공개 화면)

   프로그램북은 인쇄물이라 한 번 넘기면 고칠 수 없고, 지면이 좁아 회사소개를
   잘라 싣는다. 같은 정보를 웹에 두면 QR로 바로 열 수 있고, 오탈자나 바뀐
   연락처도 인쇄 뒤에 고칠 수 있다. 그래서 프로그램북에는 이 URL만 싣는다.

     GET /d/2026-kic       기업 목록 (한 페이지)
     GET /d/2026-kic.json  같은 내용의 JSON

   인증을 걸지 않는다 — 인쇄물의 QR을 찍은 사람이 곧 관람객이다. 대신 내보내는
   칸을 book_* 여섯 개와 부스번호로 못박아, CRM의 진행 상황(입금·세금계산서·
   담당자 연락처)이 실수로 새어 나갈 자리를 만들지 않는다.

   화면은 서버가 HTML로 다 만들어 내려준다. 스크립트가 죽거나 느린 네트워크에서도
   글이 먼저 보여야 하고(행사장 와이파이), 검색은 목록이 이미 손에 있으니
   브라우저에서 거르기만 하면 된다.
══════════════════════════════════════════════════════════════ */
const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

/* 행사 id는 '2026 KIC'처럼 공백과 대문자가 섞여 있어 URL에 그대로 못 쓴다.
   id와 약칭을 같은 규칙으로 눌러 슬러그를 만들고, 그걸로 찾는다 —
   슬러그를 따로 저장하면 행사를 새로 만들 때마다 채워야 한다. */
const slugify = (v) => String(v || '').toLowerCase().trim()
  .replace(/[^a-z0-9가-힣]+/g, '-')
  .replace(/^-+|-+$/g, '');

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* 웹사이트 칸은 기업이 적어 준 그대로 들어온다 — 'www.x.com'처럼 스킴이 없거나
   'mailto:'·'javascript:'가 섞일 수 있다. http(s)로만 링크를 걸고 나머지는
   글자로만 보여준다(링크로 만들면 클릭 한 번에 스크립트가 도는 자리가 된다). */
function webLink(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  const url = /^https?:\/\//i.test(v) ? v : (/^[\w.-]+\.[a-z]{2,}/i.test(v) ? `https://${v}` : null);
  if (!url) return null;
  return { href: url, text: v.replace(/^https?:\/\//i, '').replace(/\/$/, '') };
}

/* 도록 순번은 글자 칸이라 '10'이 '9'보다 앞에 온다. 숫자로 읽어 세우고,
   번호가 없는 기업은 뒤로 보낸 뒤 이름으로 정렬한다. */
function bookSort(a, b) {
  const na = parseInt(a.book_order, 10);
  const nb = parseInt(b.book_order, 10);
  const va = Number.isNaN(na) ? Infinity : na;
  const vb = Number.isNaN(nb) ? Infinity : nb;
  if (va !== vb) return va - vb;
  return String(a.company_name || '').localeCompare(String(b.company_name || ''), 'ko');
}

/* 슬러그로 행사를 찾고 그 행사의 게재 대상을 읽는다.
   취소된 기업은 뺀다 — 인쇄물에서도 빠진 자리다. */
async function loadDirectory(slug) {
  const want = slugify(slug);
  if (!want) return null;

  const { rows: events } = await pool.query(
    'SELECT id, name, short, date_start, date_end, location, homepage FROM events');
  const event = events.find((e) => slugify(e.id) === want || slugify(e.short) === want);
  if (!event) return null;

  const { rows } = await pool.query(
    `SELECT company_name, booth_no, book_order, book_address, book_phone, book_website, book_intro
       FROM exhibitors
      WHERE event_id = $1
        AND COALESCE(status, '') <> '취소'
        AND COALESCE(company_name, '') <> ''`,
    [event.id]);

  return { event, list: rows.sort(bookSort) };
}

/* 행사 기간은 '2026-10-13'과 '2026-10-15'처럼 따로 들어 있다. 한 줄로 합칠 때
   같은 해·같은 달이면 뒤쪽을 줄여 적는다(2026.10.13–15). */
function periodText(a, b) {
  const parse = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m ? { y: m[1], m: m[2], d: m[3] } : null;
  };
  const s = parse(a);
  const e = parse(b);
  if (!s) return '';
  const head = `${s.y}.${s.m}.${s.d}`;
  if (!e) return head;
  if (s.y === e.y && s.m === e.m) return s.d === e.d ? head : `${head}–${e.d}`;
  if (s.y === e.y) return `${head}–${e.m}.${e.d}`;
  return `${head}–${e.y}.${e.m}.${e.d}`;
}

function card(x) {
  const web = webLink(x.book_website);
  const rows = [];
  if (x.book_address) rows.push(['주소', esc(x.book_address)]);
  if (x.book_phone) rows.push(['연락처', esc(x.book_phone)]);
  if (web) rows.push(['웹사이트', `<a href="${esc(web.href)}" target="_blank" rel="noopener nofollow">${esc(web.text)}</a>`]);

  /* 검색은 브라우저가 이 칸의 글자로 거른다 — 이름·부스번호·소개글까지 한 번에 */
  const hay = [x.company_name, x.booth_no, x.book_address, x.book_intro].join(' ').toLowerCase();

  return `<article class="card" data-find="${esc(hay)}">
  <header>
    ${x.book_order ? `<span class="no">${esc(x.book_order)}</span>` : ''}
    <h2>${esc(x.company_name)}</h2>
    ${x.booth_no ? `<span class="booth">부스 ${esc(x.booth_no)}</span>` : ''}
  </header>
  ${x.book_intro ? `<p class="intro">${esc(x.book_intro).replace(/\n/g, '<br>')}</p>` : ''}
  ${rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}
</article>`;
}

function page({ event, list }) {
  const title = `${event.name || event.id} 참가기업 디렉토리`;
  const meta = [periodText(event.date_start, event.date_end), event.location].filter(Boolean).join(' · ');

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(`${event.name || event.id} 참가기업 ${list.length}개사 안내`)}">
<meta property="og:title" content="${esc(title)}">
<style>
  :root { --line:#e5e7eb; --dim:#6b7280; --ink:#111827; --accent:#1d4ed8; --bg:#f8fafc; --panel:#fff; --body:#374151; --chip:#eef2ff; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic","Apple SD Gothic Neo",sans-serif; }
  .wrap { max-width:760px; margin:0 auto; padding:0 16px 64px; }
  .top { padding:28px 0 16px; }
  .top h1 { margin:0 0 6px; font-size:20px; letter-spacing:-.2px; }
  .top .meta { color:var(--dim); font-size:13px; }
  .bar { position:sticky; top:0; z-index:2; background:var(--bg); padding:12px 0;
    border-bottom:1px solid var(--line); }
  .bar input { width:100%; padding:11px 14px; font-size:16px; color:var(--ink);
    border:1px solid var(--line); border-radius:10px; background:var(--panel); }
  .bar input:focus { outline:2px solid var(--accent); outline-offset:-1px; }
  .count { margin:14px 0 8px; color:var(--dim); font-size:13px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px;
    padding:16px 18px; margin:0 0 10px; }
  .card header { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
  .card h2 { margin:0; font-size:16px; letter-spacing:-.2px; }
  .no { min-width:26px; color:var(--dim); font-size:12px; font-variant-numeric:tabular-nums; }
  .booth { margin-left:auto; padding:2px 8px; border-radius:999px;
    background:var(--chip); color:var(--accent); font-size:12px; white-space:nowrap; }
  .intro { margin:10px 0 0; color:var(--body); }
  dl { display:grid; grid-template-columns:64px 1fr; gap:4px 12px;
    margin:12px 0 0; padding-top:12px; border-top:1px solid var(--line); font-size:13px; }
  dt { color:var(--dim); }
  dd { margin:0; word-break:break-word; }
  a { color:var(--accent); }
  .empty { display:none; padding:24px 4px; color:var(--dim); }
  footer { margin-top:28px; color:var(--dim); font-size:12px; }
  @media (prefers-color-scheme: dark) {
    :root { --line:#27272a; --dim:#9ca3af; --ink:#f3f4f6; --accent:#93b4ff; --bg:#0b0d12;
      --panel:#14161c; --body:#d1d5db; --chip:#1b2440; }
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <h1>${esc(event.name || event.id)}</h1>
    <div class="meta">참가기업 안내${meta ? ` · ${esc(meta)}` : ''}</div>
  </div>
  <div class="bar">
    <input id="q" type="search" placeholder="기업명 · 부스번호 · 소개 검색" autocomplete="off" aria-label="기업 검색">
  </div>
  <p class="count"><span id="shown">${list.length}</span>개사</p>
  <main id="list">
${list.map(card).join('\n')}
  </main>
  <p class="empty" id="empty">찾는 기업이 없습니다.</p>
  <footer>
    ${esc(event.name || event.id)} 사무국${event.homepage
      ? ` · <a href="${esc(event.homepage)}" target="_blank" rel="noopener">행사 홈페이지</a>` : ''}
  </footer>
</div>
<script>
/* 검색은 서버를 다시 부르지 않는다 — 목록이 이미 화면에 있고, 참가기업 규모가
   수십 개사라 글자만 견주면 즉시 걸러진다(행사장 네트워크가 느려도 반응한다). */
(function () {
  var q = document.getElementById('q');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var shown = document.getElementById('shown');
  var empty = document.getElementById('empty');
  q.addEventListener('input', function () {
    var v = q.value.trim().toLowerCase();
    var n = 0;
    cards.forEach(function (c) {
      var hit = !v || c.dataset.find.indexOf(v) >= 0;
      c.hidden = !hit;
      if (hit) n++;
    });
    shown.textContent = n;
    empty.style.display = n ? 'none' : 'block';
  });
})();
</script>
</body>
</html>`;
}

/* 내보내는 칸을 여기서 한 번 더 고른다 — DB 행을 그대로 JSON에 흘리면
   나중에 칸이 늘어날 때 무엇이 공개되는지 아무도 모르게 된다. */
const publicShape = (x) => ({
  order: x.book_order || '',
  name: x.company_name || '',
  booth: x.booth_no || '',
  address: x.book_address || '',
  phone: x.book_phone || '',
  website: x.book_website || '',
  intro: x.book_intro || '',
});

router.get('/:slug.json', async (req, res, next) => {
  try {
    const data = await loadDirectory(req.params.slug);
    if (!data) return res.status(404).json({ ok: false, error: 'not found' });
    res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.json({
      ok: true,
      event: {
        name: data.event.name || data.event.id,
        location: data.event.location || '',
        date_start: data.event.date_start || '',
        date_end: data.event.date_end || '',
      },
      count: data.list.length,
      exhibitors: data.list.map(publicShape),
    });
  } catch (e) { next(e); }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const data = await loadDirectory(req.params.slug);
    if (!data) {
      return res.status(404).type('html').send(
        '<!doctype html><meta charset="utf-8"><title>없는 주소</title>'
        + '<p style="font:15px/1.6 sans-serif;padding:32px">해당 행사의 디렉토리가 없습니다.</p>');
    }
    res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.type('html').send(page(data));
  } catch (e) { next(e); }
});

module.exports = router;
