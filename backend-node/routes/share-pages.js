/* ══════════════════════════════════════════════════════════════
   share-pages.js — 바깥 공유 화면 두 장 (share.js가 데이터를 읽어 넘긴다)

   웹디렉토리(public.js)와 같은 결: 서버가 HTML을 다 만들어 내려 주고, 검색·거르기만
   브라우저에서 한다. 행사장 와이파이처럼 느린 곳에서도 글이 먼저 보여야 한다.

   프로그램은 국문·영문을 둘 다 그려 두고 단추로 바꾼다(한쪽이 비면 다른 쪽을 보인다).
   수급 현황은 한국어 화면이다 — 주최사가 보는 표다.
══════════════════════════════════════════════════════════════ */
const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
function dayLabel(d, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  if (!m) return lang === 'ko' ? '일자 미정' : 'Date TBA';
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return lang === 'ko' ? `${+m[2]}월 ${+m[3]}일 (${DOW_KO[dt.getUTCDay()]})`
    : `${DOW_EN[dt.getUTCDay()]}, ${MONTHS[+m[2] - 1]} ${+m[3]}`;
}
const period = (a, b) => [a, b].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join(' ~ ');
const time = (a, b) => [a, b].filter(Boolean).join('–');

const BASE_CSS = `
  :root { --line:#e5e7eb; --dim:#6b7280; --ink:#111827; --accent:#1d4ed8; --bg:#f8fafc; --panel:#fff; --body:#374151; --chip:#eef2ff;
    --ok:#15803d; --okbg:#dcfce7; --part:#a16207; --partbg:#fef3c7; --no:#b91c1c; --nobg:#fee2e2; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic","Apple SD Gothic Neo",sans-serif; }
  .top { padding:28px 0 14px; }
  .top h1 { margin:0 0 6px; font-size:20px; letter-spacing:-.2px; }
  .top .meta { color:var(--dim); font-size:13px; }
  .bar { position:sticky; top:0; z-index:3; background:var(--bg); padding:12px 0; border-bottom:1px solid var(--line);
    display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .bar input[type=search] { flex:1; min-width:180px; padding:10px 13px; font-size:16px; color:var(--ink);
    border:1px solid var(--line); border-radius:10px; background:var(--panel); }
  .bar input:focus, .bar select:focus { outline:2px solid var(--accent); outline-offset:-1px; }
  .seg { display:inline-flex; border:1px solid var(--line); border-radius:9px; overflow:hidden; background:var(--panel); }
  .seg button { border:0; background:none; padding:8px 12px; font:inherit; font-size:13px; color:var(--dim); cursor:pointer; }
  .seg button.on { background:var(--accent); color:#fff; font-weight:600; }
  a { color:var(--accent); }
  footer { margin-top:28px; color:var(--dim); font-size:12px; }
  .empty { display:none; padding:24px 4px; color:var(--dim); }
  @media (prefers-color-scheme: dark) {
    :root { --line:#27272a; --dim:#9ca3af; --ink:#f3f4f6; --accent:#93b4ff; --bg:#0b0d12; --panel:#14161c; --body:#d1d5db; --chip:#1b2440;
      --ok:#86efac; --okbg:#12301d; --part:#fcd34d; --partbg:#3b2e0c; --no:#fca5a5; --nobg:#3b1414; }
  }`;

/* ── 프로그램 ── */
const ROLE_EN = { 좌장: 'Chair', 연사: 'Speaker', 공동연사: 'Co-speaker', 패널: 'Panelist', 패널리스트: 'Panelist',
  모더레이터: 'Moderator', 사회: 'MC', 사회자: 'MC', 토론: 'Discussant', 토론자: 'Discussant', 기조연설: 'Keynote' };
/* 두 언어를 다 그려 둔다 — 한쪽이 비면 다른 쪽 글을 넣어 빈칸이 생기지 않게 */
const bi = (ko, en, tag = 'span') => {
  const k = String(ko || '').trim() || String(en || '').trim(), e = String(en || '').trim() || String(ko || '').trim();
  if (!k) return '';
  return k === e ? `<${tag}>${esc(k)}</${tag}>` : `<${tag} class="ko">${esc(k)}</${tag}><${tag} class="en">${esc(e)}</${tag}>`;
};

function programPage(row, exhibitorsUrl) {
  const d = JSON.parse(row.data || '{}');
  const days = Array.isArray(d.days) ? d.days : [];
  const hasEn = days.some((x) => (x.sessions || []).some((s) => s.title_en));
  const name = row.event_name || row.event_id;
  const people = (ps) => (ps || []).map((p) => `<div class="who">${bi(p.name_ko, p.name_en, 'b')}${
    (p.title_ko || p.title_en || p.org_ko || p.org_en) ? `<span class="aff">${bi([p.title_ko, p.org_ko].filter(Boolean).join(', '), [p.title_en, p.org_en].filter(Boolean).join(', '))}</span>` : ''}</div>`).join('');
  /* 초록이 있으면 발제를 눌러 펼친다 — 목록은 짧게, 읽을 사람만 연다 */
  const abs = (t) => {
    const k = String(t.abstract_ko || '').trim(), e = String(t.abstract_en || '').trim();
    if (!k && !e) return '';
    return `<div class="abs">${k ? `<p class="ko">${esc(k)}</p>` : `<p class="ko">${esc(e)}</p>`}${e ? `<p class="en">${esc(e)}</p>` : `<p class="en">${esc(k)}</p>`}</div>`;
  };
  const talk = (t) => {
    const a = abs(t);
    const head = `<div class="tt">${t.start ? `<span class="tm">${esc(time(t.start, t.end))}</span>` : ''}${t.role ? `<span class="role"><span class="ko">${esc(t.role)}</span><span class="en">${esc(ROLE_EN[t.role] || t.role)}</span></span>` : ''}</div>
      ${t.title_ko || t.title_en ? `<div class="ttl">${bi(t.title_ko, t.title_en)}</div>` : ''}
      ${people(t.people)}`;
    return a
      ? `<li class="talk"><details><summary>${head}<span class="more"><span class="ko">초록 보기</span><span class="en">Abstract</span></span></summary>${a}</details></li>`
      : `<li class="talk">${head}</li>`;
  };
  const sess = (s) => `<section class="sess${s.brk ? ' brk' : ''}">
      <div class="when">${esc(time(s.start, s.end))}</div>
      <div class="what"><h3>${bi(s.title_ko, s.title_en)}</h3>${s.room ? `<span class="room">${esc(s.room)}</span>` : ''}
        ${(s.talks || []).length ? `<ul>${s.talks.map(talk).join('')}</ul>` : ''}</div></section>`;

  return `<!doctype html>
<html lang="${hasEn ? 'en' : 'ko'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} — Program</title>
<meta property="og:title" content="${esc(name)} — Program">
<style>${BASE_CSS}
  .wrap { max-width:820px; margin:0 auto; padding:0 16px 64px; }
  .nav { display:flex; gap:14px; font-size:13px; margin-top:6px; }
  .day { margin:24px 0 10px; font-size:13px; font-weight:700; letter-spacing:.04em; color:var(--dim); }
  .sess { display:grid; grid-template-columns:96px 1fr; gap:14px; background:var(--panel); border:1px solid var(--line);
    border-radius:12px; padding:14px 16px; margin:0 0 10px; }
  .sess.brk { background:transparent; border-style:dashed; padding:9px 16px; }
  .sess.brk h3 { font-weight:500; color:var(--dim); font-size:14px; }
  .when { color:var(--accent); font-weight:600; font-size:14px; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .what h3 { margin:0; font-size:16px; letter-spacing:-.2px; display:inline; }
  .room { display:inline-block; margin-left:8px; padding:1px 8px; border-radius:999px; background:var(--chip); color:var(--accent); font-size:12px; vertical-align:2px; }
  ul { list-style:none; margin:10px 0 0; padding:0; }
  .talk { padding:9px 0 0; margin-top:9px; border-top:1px solid var(--line); }
  .talk:first-child { border-top:0; margin-top:0; padding-top:0; }
  .tt { display:flex; gap:8px; align-items:center; font-size:12px; color:var(--dim); }
  .tm { font-variant-numeric:tabular-nums; }
  .role { padding:0 7px; border-radius:4px; background:var(--chip); color:var(--accent); font-weight:600; font-size:11px; }
  .ttl { font-weight:600; color:var(--ink); margin:2px 0 3px; }
  .who { font-size:14px; color:var(--body); }
  .who b { color:var(--ink); font-weight:600; margin-right:6px; }
  .aff { color:var(--dim); font-size:13px; }
  .talk summary { list-style:none; cursor:pointer; }
  .talk summary::-webkit-details-marker { display:none; }
  .talk summary::marker { content:''; }
  .more { display:inline-block; margin-top:4px; font-size:12px; color:var(--accent); font-weight:600; }
  .more::after { content:' ▾'; }
  details[open] .more::after { content:' ▴'; }
  .abs { margin-top:8px; padding:10px 12px; border-radius:8px; background:var(--bg); border:1px solid var(--line);
    font-size:14px; color:var(--body); line-height:1.7; }
  .abs p { margin:0; white-space:pre-wrap; }
  body.l-ko .en, body.l-en .ko { display:none; }
  @media (max-width:560px) { .sess { grid-template-columns:1fr; gap:4px; } }
</style>
</head>
<body class="l-${hasEn ? 'en' : 'ko'}">
<div class="wrap">
  <div class="top">
    <h1>${esc(name)}</h1>
    <div class="meta"><span class="ko">프로그램</span><span class="en">Program</span>${period(row.date_start, row.date_end) ? ` · ${esc(period(row.date_start, row.date_end))}` : ''}</div>
    ${exhibitorsUrl ? `<div class="nav"><a href="${esc(exhibitorsUrl)}"><span class="ko">참가기업 디렉토리 →</span><span class="en">Exhibitor Directory →</span></a></div>` : ''}
  </div>
  <div class="bar">
    <input id="q" type="search" placeholder="Search · 검색" autocomplete="off" aria-label="Search">
    <div class="seg" role="group" aria-label="Language"><button type="button" data-l="ko">국문</button><button type="button" data-l="en">EN</button></div>
  </div>
  <main id="list">
${days.map((x) => `<div class="day-wrap"><div class="day"><span class="ko">${esc(dayLabel(x.date, 'ko'))}</span><span class="en">${esc(dayLabel(x.date, 'en'))}</span></div>
${(x.sessions || []).map(sess).join('\n')}</div>`).join('\n')}
  </main>
  <p class="empty" id="empty"><span class="ko">맞는 항목이 없어요.</span><span class="en">No matching sessions.</span></p>
  <footer><span class="ko">마지막 갱신</span><span class="en">Last updated</span> ${esc(row.updated_at || '')}${row.homepage ? ` · <a href="${esc(row.homepage)}" target="_blank" rel="noopener">Website</a>` : ''}</footer>
</div>
<script>
(function(){
  var b = document.body, segs = document.querySelectorAll('.seg button');
  function setL(l){ b.className = 'l-' + l; segs.forEach(function(x){ x.classList.toggle('on', x.dataset.l === l); });
    try { localStorage.setItem('prog-lang', l); } catch(e){} }
  var saved = null; try { saved = localStorage.getItem('prog-lang'); } catch(e){}
  setL(saved === 'ko' || saved === 'en' ? saved : b.className.slice(2));
  segs.forEach(function(x){ x.onclick = function(){ setL(x.dataset.l); }; });
  var q = document.getElementById('q'), empty = document.getElementById('empty');
  q.addEventListener('input', function(){
    var v = q.value.trim().toLowerCase(), any = false;
    document.querySelectorAll('.day-wrap').forEach(function(dw){
      var shown = 0;
      dw.querySelectorAll('.sess').forEach(function(s){
        var hit = !v || s.textContent.toLowerCase().indexOf(v) >= 0;
        s.style.display = hit ? '' : 'none'; if(hit) shown++;
      });
      dw.style.display = shown ? '' : 'none'; if(shown) any = true;
    });
    empty.style.display = any ? 'none' : 'block';
  });
})();
</script>
</body>
</html>`;
}

/* ── 수급 현황 ── */
const MARK = { done: ['✓', 'ok'], part: ['일부', 'part'], todo: ['미수급', 'no'] };
const yn = (v) => (v === true ? '<i class="ok">✓</i>' : v === false ? '<i class="no">✕</i>' : '<i class="dim">–</i>');

function cellHtml(col, c) {
  if (!c || c.s === 'na') return '<td class="na">–</td>';
  /* 계좌·여권은 받았는지만 */
  if (col.yn) return `<td><span class="st ${c.s === 'done' ? 'ok' : 'no'}">${c.s === 'done' ? '받음' : '안받음'}</span></td>`;
  const [label, cls] = MARK[c.s] || MARK.todo;
  const lang = col.lang && (c.ko !== undefined || c.en !== undefined)
    ? `<div class="lang"><span>국 ${yn(c.ko)}</span><span>영 ${yn(c.en)}</span></div>` : '';
  return `<td><span class="st ${cls}">${label}</span>${c.t ? `<div class="sub">${esc(c.t)}</div>` : ''}${lang}</td>`;
}
function travelHtml(t) {
  if (!t || (!t.hotel && !t.route)) return '<td><span class="dim">미정</span></td>';
  const lines = [];
  if (t.hotel) lines.push(`<div>🏨 ${esc(t.hotel)}${t.in || t.out ? ` <span class="dim">${esc(period(t.in, t.out))}</span>` : ''}${t.room ? ` <span class="dim">${esc(t.room)}</span>` : ''}
    <span class="st ${t.booked ? 'ok' : 'no'}">${t.booked ? '예약됨' : '미예약'}</span></div>`);
  if (t.route) lines.push(`<div>✈ ${esc(t.route)}${t.cls ? ` <span class="dim">${esc(t.cls)}</span>` : ''}
    <span class="st ${t.ticketed ? 'ok' : 'no'}">${t.ticketed ? '발권됨' : '미발권'}</span>
    ${t.in_flight || t.in_at ? `<div class="sub">도착 ${esc([t.in_flight, t.in_at].filter(Boolean).join(' '))}</div>` : ''}
    ${t.out_flight || t.out_at ? `<div class="sub">출발 ${esc([t.out_flight, t.out_at].filter(Boolean).join(' '))}</div>` : ''}</div>`);
  return `<td class="travel">${lines.join('')}</td>`;
}

function supplyPage(row) {
  const d = JSON.parse(row.data || '{}');
  const cols = (d.cols || []).filter((c) => (d.rows || []).some((r) => r.cells && r.cells[c.key] && r.cells[c.key].s !== 'na') || c.key === 'travel');
  const rows = d.rows || [];
  const name = row.event_name || row.event_id;
  const statuses = [...new Set(rows.map((r) => r.status).filter(Boolean))];
  /* 위 요약 — 묻는 사람만 분모 */
  const tally = cols.filter((c) => c.key !== 'travel').map((c) => {
    const live = rows.filter((r) => r.cells && r.cells[c.key] && r.cells[c.key].s !== 'na');
    return { c, of: live.length, done: live.filter((r) => r.cells[c.key].s === 'done').length };
  }).filter((x) => x.of);

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(name)} — 연사 수급 현황</title>
<style>${BASE_CSS}
  .wrap { max-width:1400px; margin:0 auto; padding:0 16px 64px; }
  .sum { display:flex; flex-wrap:wrap; gap:6px; margin:4px 0 12px; }
  .sum span { padding:4px 10px; border-radius:999px; background:var(--panel); border:1px solid var(--line); font-size:12.5px; }
  .sum b { font-variant-numeric:tabular-nums; }
  .bar select { padding:9px 10px; border:1px solid var(--line); border-radius:9px; background:var(--panel); color:var(--ink); font:inherit; font-size:14px; }
  .bar label { font-size:13px; color:var(--body); display:flex; gap:5px; align-items:center; }
  .tbl { overflow:auto; border:1px solid var(--line); border-radius:12px; background:var(--panel); max-height:calc(100vh - 150px); }
  table { border-collapse:separate; border-spacing:0; width:100%; font-size:13px; }
  th, td { padding:8px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; white-space:nowrap; }
  th { position:sticky; top:0; z-index:2; background:var(--panel); font-size:12px; color:var(--dim); font-weight:600; }
  th:first-child, td:first-child { position:sticky; left:0; z-index:1; background:var(--panel); border-right:1px solid var(--line); white-space:normal; min-width:170px; max-width:220px; }
  th:first-child { z-index:3; }
  td.na { color:var(--dim); text-align:center; }
  td.travel { white-space:normal; min-width:230px; font-size:12.5px; }
  .nm { font-weight:600; }
  .nm small { font-weight:400; color:var(--dim); margin-left:4px; }
  .org, .sub { color:var(--dim); font-size:12px; white-space:normal; }
  .ses { color:var(--dim); font-size:11.5px; white-space:normal; margin-top:2px; }
  .st { display:inline-block; padding:1px 7px; border-radius:5px; font-size:12px; font-weight:600; }
  .st.ok { background:var(--okbg); color:var(--ok); } .st.part { background:var(--partbg); color:var(--part); } .st.no { background:var(--nobg); color:var(--no); }
  .pill { display:inline-block; padding:0 6px; border-radius:4px; font-size:11px; background:var(--chip); color:var(--accent); margin-left:2px; }
  .lang { display:flex; gap:8px; font-size:11.5px; color:var(--dim); margin-top:3px; }
  i { font-style:normal; font-weight:700; } i.ok { color:var(--ok); } i.no { color:var(--no); } .dim, i.dim { color:var(--dim); font-weight:400; }
  .note { color:var(--dim); font-size:12px; margin:10px 2px 0; line-height:1.6; }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <h1>${esc(name)} 연사 수급 현황</h1>
    <div class="meta">${esc(period(row.date_start, row.date_end))}${row.updated_at ? ` · 마지막 갱신 ${esc(row.updated_at)}` : ''} · 연사 ${rows.length}명</div>
  </div>
  <div class="sum">${tally.map((x) => `<span>${esc(x.c.label)} <b>${x.done}/${x.of}</b></span>`).join('')}</div>
  <div class="bar">
    <input id="q" type="search" placeholder="이름·소속·세션 검색" autocomplete="off" aria-label="검색">
    ${statuses.length > 1 ? `<select id="stf" aria-label="상태"><option value="">전체 상태</option>${statuses.map((s) => `<option>${esc(s)}</option>`).join('')}</select>` : ''}
    <label><input type="checkbox" id="miss"> 빠진 것 있는 연사만</label>
  </div>
  <div class="tbl"><table>
    <thead><tr><th>연사</th><th>상태</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody id="list">
${rows.map((r) => {
    const miss = cols.some((c) => c.key !== 'travel' && r.cells && r.cells[c.key] && ['todo', 'part'].includes(r.cells[c.key].s));
    return `<tr data-st="${esc(r.status || '')}" data-miss="${miss ? 1 : 0}">
      <td><div class="nm">${esc(r.name || r.name_en || '')}${r.name && r.name_en && r.name !== r.name_en ? `<small>${esc(r.name_en)}</small>` : ''}</div>
        ${r.org ? `<div class="org">${esc(r.org)}</div>` : ''}
        ${(r.sessions || []).length ? `<div class="ses">${r.sessions.map((s) => esc(s)).join('<br>')}</div>` : ''}</td>
      <td>${esc(r.status || '')}${(r.roles || []).map((x) => `<div><span class="pill">${esc(x)}</span></div>`).join('')}</td>
      ${cols.map((c) => (c.key === 'travel' ? travelHtml(r.travel) : cellHtml(c, r.cells && r.cells[c.key]))).join('')}
    </tr>`;
  }).join('\n')}
    </tbody></table></div>
  <p class="empty" id="empty">맞는 연사가 없어요.</p>
  <p class="note">«일부»는 일부만 받았거나 지난 행사 자료를 연사가 아직 확인하지 않은 경우입니다. «국/영»은 국문·영문 정보를 받았는지이며, 영문만 받기로 한 연사의 국문은 «–»로 표시합니다.
    계좌·여권은 받았는지만 표시하고 내용은 싣지 않습니다. 이 링크는 받은 분만 볼 수 있도록 공유해 주세요.</p>
</div>
<script>
(function(){
  var q = document.getElementById('q'), st = document.getElementById('stf'), miss = document.getElementById('miss'), empty = document.getElementById('empty');
  function run(){
    var v = q.value.trim().toLowerCase(), s = st ? st.value : '', m = miss.checked, n = 0;
    document.querySelectorAll('#list tr').forEach(function(tr){
      var hit = (!v || tr.cells[0].textContent.toLowerCase().indexOf(v) >= 0) && (!s || tr.dataset.st === s) && (!m || tr.dataset.miss === '1');
      tr.style.display = hit ? '' : 'none'; if(hit) n++;
    });
    empty.style.display = n ? 'none' : 'block';
  }
  q.addEventListener('input', run); miss.addEventListener('change', run); if(st) st.addEventListener('change', run);
})();
</script>
</body>
</html>`;
}

module.exports = { programPage, supplyPage };
