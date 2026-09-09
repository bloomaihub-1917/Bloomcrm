/* ══════════════════════════════════════════════════════════════
   public.js — 웹디렉토리 (프로그램북 게재 정보의 공개 화면)

   프로그램북은 인쇄물이라 한 번 넘기면 고칠 수 없고, 지면이 좁아 회사소개를
   잘라 싣는다. 같은 정보를 웹에 두면 QR로 바로 열 수 있고, 오탈자나 바뀐
   연락처도 인쇄 뒤에 고칠 수 있다. 그래서 프로그램북에는 이 URL만 싣는다.

     GET /d/2026-kic       기업 목록 (한 페이지)
     GET /d/2026-kic.json  같은 내용의 JSON

   화면 글자는 전부 영어다. 국제 컨퍼런스라 참가기업 절반이 해외 법인이고,
   게재 정보(주소·연락처·회사소개)도 처음부터 영문으로 받았다. 기업명만 DB에
   국문으로 들어 있어 orgs.name_en을 끌어다 쓴다.

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
  return String(a.name || '').localeCompare(String(b.name || ''), 'en');
}

/* 스폰서는 돈을 더 낸 자리라 프로그램북에서도 앞장에 크게 실린다. 웹에서도
   같아야 한다 — 등급 배지를 달고 카드를 도드라지게 한다.

   순번 1~9가 지금 스폰서지만 번호로 가르지 않는다. 도록 번호는 지면 사정으로
   바뀌고(서울대·분당서울대를 44/45로 나눈 것처럼), 등급이 곧 스폰서 여부다.
   Exhibitor는 등급 칸에 있지만 스폰서가 아닌 일반 참가기업이다. */
const SPONSOR_GRADES = {
  DIA: { label: 'DIAMOND', cls: 'g-dia' },
  GOLD: { label: 'GOLD', cls: 'g-gold' },
  SILVER: { label: 'SILVER', cls: 'g-silver' },
  BRONZE: { label: 'BRONZE', cls: 'g-bronze' },
};
const sponsorOf = (x) => SPONSOR_GRADES[String(x.grade || '').trim().toUpperCase()] || null;

/* 슬러그로 행사를 찾고 그 행사의 게재 대상을 읽는다.
   취소된 기업은 뺀다 — 인쇄물에서도 빠진 자리다. */
async function loadDirectory(slug) {
  const want = slugify(slug);
  if (!want) return null;

  const { rows: events } = await pool.query(
    'SELECT id, name, short, date_start, date_end, location, homepage FROM events');
  const event = events.find((e) => slugify(e.id) === want || slugify(e.short) === want);
  if (!event) return null;

  /* 기업명은 orgs.name_en을 먼저 쓴다. exhibitors.company_name은 전시 관리용
     표시 이름이라 국문이고('㈜씨엔알리서치'), 영문 화면에 그대로 올릴 수 없다.
     비어 있으면 국문 이름으로 물러선다 — 이름 없이 내보내는 것보다 낫다. */
  const { rows } = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(o.name_en), ''), x.company_name) AS name,
            x.booth_no, x.grade, x.book_order,
            x.book_address, x.book_phone, x.book_website, x.book_intro
       FROM exhibitors x
       LEFT JOIN orgs o ON o.id = x.org_id
      WHERE x.event_id = $1
        AND COALESCE(x.status, '') <> '취소'
        AND COALESCE(x.company_name, '') <> ''`,
    [event.id]);

  return { event, list: rows.sort(bookSort) };
}

/* 행사 기간은 '2026-10-13'과 '2026-10-15'처럼 따로 들어 있다. 영문 화면이라
   'Oct 13–15, 2026'처럼 적고, 같은 달이면 달 이름을 한 번만 쓴다. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function periodText(a, b) {
  const parse = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    if (!m) return null;
    const mon = MONTHS[Number(m[2]) - 1];
    return mon ? { y: m[1], m: mon, d: String(Number(m[3])) } : null;
  };
  const s = parse(a);
  const e = parse(b);
  if (!s) return '';
  if (!e || (s.y === e.y && s.m === e.m && s.d === e.d)) return `${s.m} ${s.d}, ${s.y}`;
  if (s.y === e.y && s.m === e.m) return `${s.m} ${s.d}–${e.d}, ${s.y}`;
  if (s.y === e.y) return `${s.m} ${s.d} – ${e.m} ${e.d}, ${s.y}`;
  return `${s.m} ${s.d}, ${s.y} – ${e.m} ${e.d}, ${e.y}`;
}

/* 장소는 영문 칸이 따로 없어 '그랜드 롯데호텔 서울'처럼 국문으로 들어 있다.
   국문이 섞인 값은 내보내지 않는다 — 영문 화면 한복판에 한글 한 줄이 남는다.
   events.location을 영문으로 고치면 그때부터 저절로 나온다. */
const dropKorean = (v) => (/[가-힣㄰-㆏]/.test(String(v || '')) ? '' : String(v || '').trim());

function card(x) {
  const web = webLink(x.book_website);
  const sponsor = sponsorOf(x);
  const rows = [];
  if (x.book_address) rows.push(['Address', esc(x.book_address)]);
  if (x.book_phone) rows.push(['Tel', esc(x.book_phone)]);
  if (web) rows.push(['Website', `<a href="${esc(web.href)}" target="_blank" rel="noopener nofollow">${esc(web.text)}</a>`]);

  /* 검색은 브라우저가 이 칸의 글자로 거른다 — 이름·부스번호·소개글까지 한 번에.
     등급도 넣어 'GOLD'로 스폰서를 뽑아 볼 수 있게 한다. */
  const hay = [x.name, x.booth_no, sponsor && sponsor.label,
    x.book_address, x.book_intro].filter(Boolean).join(' ').toLowerCase();

  return `<article class="card${sponsor ? ` sponsor ${sponsor.cls}` : ''}" data-find="${esc(hay)}">
  <header>
    ${x.book_order ? `<span class="no">${esc(x.book_order)}</span>` : ''}
    <h3>${esc(x.name)}</h3>
    ${sponsor ? `<span class="grade">${sponsor.label}</span>` : ''}
    ${x.booth_no ? `<span class="booth">Booth ${esc(x.booth_no)}</span>` : ''}
  </header>
  ${x.book_intro ? `<p class="intro">${esc(x.book_intro).replace(/\n/g, '<br>')}</p>` : ''}
  ${rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}
</article>`;
}

/* 스폰서와 일반 참가기업 사이에 제목을 한 줄 끼운다. 카드 모양만 달리 해도
   눈에는 들어오지만, 어디까지가 스폰서인지는 글로 적어야 분명해진다.
   순서는 도록 순번 그대로다 — 스폰서가 이미 앞번호를 받았고, 인쇄물과 웹의
   순서가 어긋나면 번호로 찾는 사람이 헤맨다. */
function listHtml(list) {
  const out = [];
  let seenSponsor = false;
  let seenPlain = false;
  list.forEach((x) => {
    if (sponsorOf(x)) {
      if (!seenSponsor) { out.push('<h2 class="sec">Sponsors</h2>'); seenSponsor = true; }
    } else if (!seenPlain) {
      out.push(`<h2 class="sec">${seenSponsor ? 'Exhibitors' : 'All Exhibitors'}</h2>`);
      seenPlain = true;
    }
    out.push(card(x));
  });
  return out.join('\n');
}

function page({ event, list }) {
  const title = `${event.name || event.id} — Exhibitor Directory`;
  const meta = [periodText(event.date_start, event.date_end), dropKorean(event.location)]
    .filter(Boolean).join(' · ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(`${list.length} exhibiting companies at ${event.name || event.id}`)}">
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
  .card h3 { margin:0; font-size:16px; letter-spacing:-.2px; font-weight:600; }
  .sec { margin:26px 0 10px; font-size:12px; font-weight:600; letter-spacing:.08em;
    color:var(--dim); text-transform:uppercase; }
  .sec:first-child { margin-top:6px; }

  /* 스폰서 카드 — 등급색 띠를 왼쪽에 두고 이름을 키운다. 배경까지 바꾸면
     소개글 대비가 흐려져, 테두리와 글자 크기로만 도드라지게 한다. */
  .sponsor { border-color:var(--gline); border-left:4px solid var(--gc); padding-left:15px; }
  .sponsor h3 { font-size:18px; font-weight:700; }
  .sponsor .no { color:var(--gc); font-weight:600; }
  .grade { padding:2px 8px; border-radius:4px; background:var(--gbg); color:var(--gc);
    font-size:11px; font-weight:700; letter-spacing:.06em; }
  .g-dia    { --gc:#0e7490; --gbg:#cffafe; --gline:#a5f3fc; }
  .g-gold   { --gc:#a16207; --gbg:#fef3c7; --gline:#fde68a; }
  .g-silver { --gc:#475569; --gbg:#e2e8f0; --gline:#cbd5e1; }
  .g-bronze { --gc:#9a3412; --gbg:#ffedd5; --gline:#fed7aa; }
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
    /* 어두운 바탕에서는 밝은 배지 배경이 눈을 찌른다 — 글자를 밝히고 배경을 눌러
       같은 등급색을 유지한다 */
    .g-dia    { --gc:#67e8f9; --gbg:#0d3b45; --gline:#155e6b; }
    .g-gold   { --gc:#fcd34d; --gbg:#42320c; --gline:#6b5210; }
    .g-silver { --gc:#cbd5e1; --gbg:#2a313b; --gline:#475569; }
    .g-bronze { --gc:#fdba74; --gbg:#452312; --gline:#7c3d1a; }
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <h1>${esc(event.name || event.id)}</h1>
    <div class="meta">Exhibitor Directory${meta ? ` · ${esc(meta)}` : ''}</div>
  </div>
  <div class="bar">
    <input id="q" type="search" placeholder="Search by company, booth, or keyword" autocomplete="off" aria-label="Search exhibitors">
  </div>
  <p class="count"><span id="shown">${list.length}</span> companies</p>
  <main id="list">
${listHtml(list)}
  </main>
  <p class="empty" id="empty">No matching companies.</p>
  <footer>
    ${esc(event.name || event.id)} Secretariat${event.homepage
      ? ` · <a href="${esc(event.homepage)}" target="_blank" rel="noopener">Event website</a>` : ''}
  </footer>
</div>
<script>
/* 검색은 서버를 다시 부르지 않는다 — 목록이 이미 화면에 있고, 참가기업 규모가
   수십 개사라 글자만 견주면 즉시 걸러진다(행사장 네트워크가 느려도 반응한다). */
(function () {
  var q = document.getElementById('q');
  var nodes = Array.prototype.slice.call(document.querySelectorAll('#list > *'));
  var shown = document.getElementById('shown');
  var empty = document.getElementById('empty');
  q.addEventListener('input', function () {
    var v = q.value.trim().toLowerCase();
    var n = 0;
    /* 뒤에서부터 훑는다 — 구역 제목은 그 아래 카드가 하나라도 남았을 때만
       보여야 하고, 그건 제목보다 뒤에 오는 카드를 이미 판정한 뒤에야 안다.
       ('스폰서' 제목만 남고 아래가 텅 비는 자리를 없앤다) */
    var groupHit = false;
    for (var i = nodes.length - 1; i >= 0; i--) {
      var el = nodes[i];
      if (el.classList.contains('sec')) {
        el.hidden = !groupHit;
        groupHit = false;
        continue;
      }
      var hit = !v || el.dataset.find.indexOf(v) >= 0;
      el.hidden = !hit;
      if (hit) { n++; groupHit = true; }
    }
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
  name: x.name || '',
  booth: x.booth_no || '',
  /* 스폰서 등급만 내보낸다 — 'Exhibitor'는 등급이 아니라 "스폰서가 아니다"는
     표시라, 그대로 흘리면 읽는 쪽이 등급으로 오해한다 */
  sponsor: sponsorOf(x) ? sponsorOf(x).label : '',
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
        location: dropKorean(data.event.location),
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
        '<!doctype html><meta charset="utf-8"><title>Not found</title>'
        + '<p style="font:15px/1.6 sans-serif;padding:32px">No directory for this event.</p>');
    }
    res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.type('html').send(page(data));
  } catch (e) { next(e); }
});

module.exports = router;
