/* 리팩토링 안전망 — 서버(backend-node)의 경로 표 지문.
   node scripts/refactor/route-table.js <backend-node 폴더> [--list]
   app.js를 읽어 Express에 걸린 경로(방법·주소·거치는 함수 수)를 모두 적는다. DB에는 닿지 않는다 —
   pool은 만들 때가 아니라 질의할 때 연결하고, DATABASE_URL은 닿지 않는 주소로 먼저 채워 둔다
   (dotenv는 이미 있는 값을 덮지 않으므로 .env의 운영 주소를 읽지 않는다).
   master의 backend-node와 이 브랜치의 것을 각각 돌려 견준다.
   node_modules는 원래 저장소 것을 NODE_PATH로 빌려 쓴다. */
const path = require('path');
const dir = path.resolve(process.argv[2] || 'backend-node');
process.env.DATABASE_URL = 'postgres://x:y@127.0.0.1:1/none';
const app = require(path.join(dir, 'app.js'));
const mountOf = (l) => {
  const s = l.regexp.source;
  if (s === '^\\/?$' || s === '^\\/?(?=\\/|$)') return '';
  return s.replace(/^\^/, '').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/');
};
/* 거치는 함수의 본문까지 센다 — 경로만 같고 처리하는 함수가 바뀌면(옮기다 다른 함수를 걸면) 잡히게 */
const fnHash = (st) => require('crypto').createHash('sha256').update(st.map((x) => String(x.handle).replace(/\r\n/g, '\n')).join('\n')).digest('hex').slice(0, 8);
const out = [];
const walk = (stack, prefix) => {
  for (const l of stack) {
    if (l.route) {
      for (const m of Object.keys(l.route.methods)) out.push(`${m.toUpperCase()} ${prefix}${l.route.path} ×${l.route.stack.length} ${fnHash(l.route.stack)}`);
    } else if (l.name === 'router' && l.handle.stack) {
      walk(l.handle.stack, prefix + mountOf(l));
    } else out.push(`USE ${prefix}${mountOf(l)} ${l.name}`);
  }
};
walk(app._router.stack, '');
const text = out.join('\n');
if (process.argv.includes('--list')) console.log(text);
console.log(out.length + '개', require('crypto').createHash('sha256').update(text).digest('hex').slice(0, 16));
setTimeout(() => process.exit(0), 50);
