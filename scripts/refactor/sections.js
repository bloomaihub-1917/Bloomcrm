/* 리팩토링 도구 — 큰 파일을 구획(/* ═══ 제목 줄)으로 나눠, 구획끼리 서로 무엇을 부르는지 본다.

   node scripts/refactor/sections.js <파일>

   쪼갤 때 고리를 만들지 않으려면, 떼어 낼 구획은 «파일의 다른 구획이 부르지 않는» 것이어야 한다.
   그런 구획은 화면의 onclick(window)으로만 불리므로, 떼어 낸 파일이 스스로 window에 걸고
   app.js가 그 파일을 읽으면 된다 — 원래 파일은 새 파일을 import하지 않는다(한 방향).

   보이는 것: 구획마다 줄 범위, 다른 구획이 부르는 이름(있으면 떼기 어렵다), 이 구획이 쓰는
   모듈 상태(let)와 그것을 고치는지(고치면 상태 주인이 옮기거나 set 함수가 필요). */
const fs = require('fs');
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const lines = src.split(/\r?\n/);

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

/* 구획 시작: 맨 앞 칸의 «/* ═══…» 다음 줄이 제목 */
const secs = [];
lines.forEach((l, i) => {
  if (/^\/\* ?═{8,}/.test(l)) secs.push({ start: i, title: (lines[i + 1] || '').trim().slice(0, 50) });
});
if (!secs.length || secs[0].start > 0) secs.unshift({ start: 0, title: '(머리 — import·상태)' });
secs.forEach((s, k) => { s.end = (secs[k + 1] ? secs[k + 1].start : lines.length) - 1; });

const decl = /^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const owner = new Map();       // 최상위 이름 → 구획 번호
const lets = new Set();
secs.forEach((s, k) => {
  for (let i = s.start; i <= s.end; i++) {
    const m = lines[i].match(decl);
    if (m) { owner.set(m[1], k); if (/^(?:export\s+)?let\b/.test(lines[i])) lets.add(m[1]); }
    const lm = lines[i].match(/^(?:export\s+)?let\s+(.*)/);
    if (lm) lm[1].split(',').forEach((p) => { const n = p.trim().match(/^([A-Za-z_$][\w$]*)/); if (n) { owner.set(n[1], k); lets.add(n[1]); } });
  }
});

secs.forEach((s, k) => {
  /* «window.X = X;» 줄은 부르는 게 아니라 거는 것이다 — 세면 모든 구획이 «다른 구획이 부름»으로 보인다.
     Object.assign(window, { … }) 묶음도 같은 까닭으로 뺀다 */
  const body = strip(lines.slice(s.start, s.end + 1)
    .filter((l) => !/^\s*window\.[A-Za-z_$][\w$]*\s*=\s*[A-Za-z_$][\w$]*\s*;\s*$/.test(l))
    .join('\n')
    .replace(/Object\.assign\(window,\s*\{[\s\S]*?\}\);?/g, ' '));
  s.uses = new Map();   // 다른 구획 번호 → Set(이름)
  s.state = new Set(); s.writes = new Set();
  for (const m of body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\b/g)) {
    const n = m[2]; const o = owner.get(n);
    if (o === undefined || o === k) continue;
    if (!s.uses.has(o)) s.uses.set(o, new Set());
    s.uses.get(o).add(n);
    if (lets.has(n)) s.state.add(n);
  }
  for (const m of body.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*(?:=(?![=>])|\+\+|--|[-+*/%|&]=)/g)) {
    if (lets.has(m[2]) && owner.get(m[2]) !== k) s.writes.add(m[2]);
  }
});

const usedBy = secs.map(() => new Map());
secs.forEach((s, k) => s.uses.forEach((names, o) => usedBy[o].set(k, names)));

secs.forEach((s, k) => {
  /* 머리 구획(import·상태)도 코드가 들어 있으면 부르는 쪽이다 — 빼면 exh-drawer 머리가 부르는
     dLogs를 놓치고 «뗄 수 있음»이라 잘못 알린다 */
  const by = [...usedBy[k]];
  const leaf = k !== 0 && !by.length;
  console.log(`[${k}] ${s.start + 1}-${s.end + 1} (${s.end - s.start + 1}줄) ${s.title}${leaf ? '  ← 뗄 수 있음' : ''}`);
  if (by.length) console.log('     다른 구획이 부름: ' + by.map(([o, n]) => `[${o}] ${[...n].slice(0, 5).join(',')}${n.size > 5 ? '…' : ''}`).join(' / '));
  if (s.writes.size) console.log('     다른 구획의 상태를 고침: ' + [...s.writes].join(','));
});
