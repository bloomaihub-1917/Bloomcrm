/* ══════════════════════════════════════════════════════════════
   sw.js — 끊겨도 앱이 열리게 (서비스 워커, 2026-11-10)

   현장 와이파이가 끊긴 채 태블릿·휴대폰이 화면을 새로 고치면 앱이 아예 안 열렸다. 그래서 한 번 열었던 것을 기기에 둔다.
   - 화면 파일(index.html·js·css): 먼저 인터넷에 묻고, 4초 안에 답이 없거나 끊겼으면 기기에 둔 것
     → 연결돼 있으면 언제나 새 코드. 배포 때 주소 끝에 ?v=<커밋>이 붙으니 같은 길의 옛 판은 지운다
   - 외부 도구(firebase·엑셀·QR·글꼴 — 주소에 판 번호가 박힌 것): 기기에 있으면 그것
   - 서버 읽기(GET /api/…): 먼저 인터넷, 끊겼으면 마지막으로 받은 것 — 명단이 있어야 네임택 데스크가 돈다.
     기기에 둔 답이면 x-bloom-cache: 1을 붙여 화면이 «연결 끊김»으로 알게 한다. /live(실시간)는 두지 않는다
   - 쓰기(POST·PUT)는 손대지 않는다 — 끊김은 네임택 대기열(js/features/nametag/nt-outbox.js)이 맡는다
   - 배포(.github/workflows/pages.yml)는 화면 파일 전부의 목록 precache.json을 만들고 이 파일 끝에 커밋 번호를 적는다
     → 배포마다 서비스 워커가 새로 깔리며 목록의 파일을 모두 미리 받아 둔다(한 번도 안 연 화면까지)
   로그아웃하면 서버 읽기 저장분(bloom-api)을 지운다(auth.js doLogout).
═══════════════════════════════════════════════════════════════ */
const APP = 'bloom-app-v1', LIB = 'bloom-lib-v1', API = 'bloom-api-v1';
const API_HOSTS = ['backend-node-jade-delta.vercel.app', 'localhost:8080', '127.0.0.1:8080'];
const LIB_HOSTS = ['www.gstatic.com', 'cdn.sheetjs.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'];
const WAIT = 4000;

self.addEventListener('install', (e) => e.waitUntil((async () => {
  /* 배포 때 만든 목록이 있으면 전부 받아 둔다(개발 중에는 없다 — 열면서 담는다) */
  try {
    const r = await fetch(new URL('precache.json', self.registration.scope).href, { cache: 'no-store' });
    if (r.ok) {
      const urls = (await r.json()).map((p) => new URL(p, self.registration.scope).href);
      for (let i = 0; i < urls.length; i += 12) {
        await Promise.all(urls.slice(i, i + 12).map(async (u) => {
          const res = await fetch(u, { cache: 'no-cache' }).catch(() => null);
          if (!res || !res.ok) return;
          if (u === new URL('./', self.registration.scope).href) await (await caches.open(APP)).put(u, res);
          else await putApp(new Request(u), res);
        }));
      }
    }
  } catch (err) { /* 목록을 못 받아도 깔린다 — 열면서 담는다 */ }
  await self.skipWaiting();
})()));
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const keep = new Set([APP, LIB, API]);
  for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
  await self.clients.claim();
})()));

const isApi = (u) => API_HOSTS.includes(u.host) && u.pathname.startsWith('/api/');
const isLib = (u) => LIB_HOSTS.includes(u.host);

/* 같은 길의 옛 판(?v=옛 커밋)을 지우고 넣는다 */
async function putApp(req, res) {
  const c = await caches.open(APP);
  const u = new URL(req.url);
  for (const k of await c.keys(req, { ignoreSearch: true })) if (new URL(k.url).search !== u.search) await c.delete(k);
  await c.put(req, res);
}
const timeout = (p, ms) => new Promise((ok, no) => { const t = setTimeout(() => no(new Error('timeout')), ms); p.then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); no(e); }); });

async function appFirstNet(e, req, navigate) {
  const net = fetch(req);
  try {
    const res = await timeout(net, WAIT);
    if (res.ok) {
      const copy = res.clone();
      e.waitUntil(navigate ? caches.open(APP).then((c) => c.put(new URL('./', self.registration.scope).href, copy)) : putApp(req, copy));
    }
    return res;
  } catch (e) {
    const c = await caches.open(APP);
    const hit = navigate ? await c.match(new URL('./', self.registration.scope).href) : await c.match(req);
    if (hit) { net.then((r) => { if (r.ok && !navigate) putApp(req, r); }).catch(() => {}); return hit; }
    return net;   // 기기에도 없다 — 인터넷이 늦게라도 오면 그것
  }
}
async function libCacheFirst(e, req) {
  const c = await caches.open(LIB);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') e.waitUntil(c.put(req, res.clone()));
  return res;
}
async function apiFirstNet(e, req) {
  try {
    const res = await fetch(req);
    if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(API).then((c) => c.put(req.url, copy))); }
    return res;
  } catch (e) {
    const hit = await (await caches.open(API)).match(req.url);
    if (!hit) throw e;
    const h = new Headers(hit.headers);
    h.set('x-bloom-cache', '1');
    return new Response(await hit.blob(), { status: hit.status, headers: h });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (isApi(u)) { if (!u.pathname.endsWith('/live')) e.respondWith(apiFirstNet(e, req)); return; }
  if (isLib(u)) { e.respondWith(libCacheFirst(e, req)); return; }
  if (u.origin !== self.location.origin || u.pathname.endsWith('/precache.json') || u.pathname.endsWith('/sw.js')) return;
  if (req.mode === 'navigate') { e.respondWith(appFirstNet(e, req, true)); return; }
  if (/\.(js|css|png|jpe?g|svg|webp|ico|woff2?|json)$/i.test(u.pathname)) e.respondWith(appFirstNet(e, req, false));
});

/* 처음 연 그 한 번은 서비스 워커가 아직 안 붙어 있어 받은 파일이 기기에 안 남는다 → 화면이 받은 파일 목록을 보내 준다 */
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'warm') return;
  e.waitUntil((async () => {
    for (const url of e.data.urls || []) {
      try {
        const u = new URL(url);
        if (isApi(u)) continue;
        if (isLib(u)) {
          const c = await caches.open(LIB);
          if (await c.match(url)) continue;
          let res = await fetch(url).catch(() => null);
          if (!res || !res.ok) res = await fetch(url, { mode: 'no-cors' }).catch(() => null);
          if (res && (res.ok || res.type === 'opaque')) await c.put(url, res);
        } else if (u.origin === self.location.origin) {
          const c = await caches.open(APP);
          if (await c.match(url)) continue;
          const res = await fetch(url).catch(() => null);
          if (res && res.ok) await (u.pathname.endsWith('/') || u.pathname.endsWith('.html') ? c.put(new URL('./', self.registration.scope).href, res) : putApp(new Request(url), res));
        }
      } catch (err) { /* 하나 못 받아도 나머지는 */ }
    }
  })());
});
