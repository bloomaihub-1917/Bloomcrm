/* 리팩토링 안전망 — 메일 «보내기»를 견주려고, 한 커밋의 화면 코드를 따로 풀어 메일 발송만 가짜로 바꾼 사본을 만든다.

   node scripts/refactor/mock-copy.js <커밋|브랜치> <풀 폴더>

   테스트 로그인은 서버 주소가 비어 sendMail이 언제나 «테스트 모드에서는 보내지 않아요»로 실패한다.
   그래서 실패하는 길만 지나고, 보낸 뒤 기록 넣기·묶음 저절로 닫기 같은 길은 볼 수 없다.
   사본에서만 바꾼다(저장소 파일은 건드리지 않는다):
   - sendMail      → window.__mockSend(payload)가 돌려주는 값을 그대로 (테스트가 정한다)
   - eventMailFrom → 늘 «시험 발신 <test@bloom.test>»
   - SEND_GAP      → 0 (통 사이 20초씩 쉬지 않게)
   - aiApi         → window.__mockAi가 있으면 그 값을 (상황 물어보기 답을 견주려고, 파트 H4)
   두 사본(master·이 브랜치)에 똑같이 바꾸므로 견주기에는 영향이 없다. 운영 서버로는 아무것도 가지 않는다. */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const [ref, out] = process.argv.slice(2);
if (!out) { console.error('쓰는 법: mock-copy.js <커밋> <폴더>'); process.exit(1); }
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
/* WORKTREE — 아직 커밋하지 않은 지금 파일(새로 만든 파일 포함)을 그대로 */
if (ref === 'WORKTREE') {
  for (const p of ['index.html', 'js', 'styles', 'scripts', 'assets', 'img', 'images']) {
    if (fs.existsSync(p)) fs.cpSync(p, path.join(out, p), { recursive: true });
  }
} else {
  execSync(`git archive ${ref} | tar -x -C "${out.replace(/\\/g, '/')}"`, { stdio: 'inherit', shell: 'bash' });
}

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
let hits = { sendMail: 0, eventMailFrom: 0, SEND_GAP: 0, aiApi: 0 };
for (const f of walk(path.join(out, 'js')).filter((f) => f.endsWith('.js'))) {
  let s = fs.readFileSync(f, 'utf8');
  const before = s;
  s = s.replace(/export async function sendMail\(payload\)\{/, () => { hits.sendMail++; return 'export async function sendMail(payload){ return window.__mockSend(payload);'; });
  s = s.replace(/export async function eventMailFrom\(evKey, force\)\{/, () => { hits.eventMailFrom++; return "export async function eventMailFrom(evKey, force){ return { ok: true, addr: 'test@bloom.test', text: '시험 발신 <test@bloom.test>' };"; });
  s = s.replace(/async function aiApi\(path, method = 'GET', body\)\{/, (m) => { hits.aiApi++; return m + ' if(window.__mockAi) return window.__mockAi(path, body);'; });
  s = s.replace(/const SEND_GAP = \d+;/, () => { hits.SEND_GAP++; return 'const SEND_GAP = 0;'; });
  if (s !== before) fs.writeFileSync(f, s);
}
console.log(ref, '→', out, hits);
if (hits.sendMail !== 1 || hits.eventMailFrom !== 1 || hits.SEND_GAP !== 2 || hits.aiApi !== 1) { console.error('✗ 바꿀 자리를 다 못 찾았다'); process.exit(1); }
