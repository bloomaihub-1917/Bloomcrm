/* ══════════════════════════════════════════════════════════════
   nt-camera.js — 카메라로 입장 QR 읽기 (행사 DB › 네임택 › 체크인)

   바코드 스캐너가 없을 때 노트북 웹캠·휴대폰 카메라로 읽는다. 한 번 켜 두면 단추를 누르지 않는다 —
   QR이 비치면 바로 onScan(등록번호)을 부르고, 돌아온 결과를 크게 띄운다(초록 체크인 · 노랑 이미 · 빨강 없음).
   - 읽기: 브라우저에 BarcodeDetector가 있으면 그것(안드로이드 크롬·맥), 없으면 jsQR(윈도 크롬 등)을 그때 불러 쓴다
   - 같은 QR이 계속 비쳐도 COOLDOWN 동안은 다시 부르지 않는다(한 번 비추면 한 번)
   - 창은 화면 구석에 떠 있다. 명단을 다시 그려도 카메라가 꺼지지 않게 데스크 밖(body)에 둔다
   - ⛶ 전체 화면(2026-11-11): 태블릿·노트북을 입구에 세워 두고 쓰게 창을 화면 가득 키운다. 브라우저 전체 화면도 함께
     요청한다(안 되는 기기 — 아이폰 사파리 — 는 창만 가득). 다시 누르거나 Esc로 줄인다. 고른 크기는 이 기기에 기억
   - 카메라는 https(또는 localhost)에서만 켜진다
═══════════════════════════════════════════════════════════════ */
import { escapeHtml } from '../../utils.js';
import { parseScan } from '../../domain/nametag-layout.js';

const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const COOLDOWN = 4000;   // 같은 QR을 다시 받기까지(ms)
const EVERY = 120;       // 몇 ms마다 한 번 읽을지 — 휴대폰이 뜨거워지지 않게

const FULL_KEY = 'nametag.camera-full.v1';
const cam = { stream: null, raf: 0, last: 0, seen: new Map(), detector: null, onScan: null, busy: false, facing: 'environment', alive: null };

function loadJsQR(){
  if(window.jsQR) return Promise.resolve();
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = JSQR_URL; s.onload = ok; s.onerror = () => no(new Error('QR 읽기 도구를 못 불러왔어요'));
    document.head.appendChild(s);
  });
}

/* 삑 — 체크인은 높게 한 번, 이미·없음은 낮게 두 번 */
let actx = null;
function beep(ok){
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const tone = (f, at) => { const o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.15, actx.currentTime + at); g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + at + 0.15);
      o.start(actx.currentTime + at); o.stop(actx.currentTime + at + 0.16); };
    if(ok) tone(1320, 0); else { tone(440, 0); tone(440, 0.2); }
  } catch {}
}

function panel(){
  let el = document.getElementById('nt-cam');
  if(el) return el;
  el = document.createElement('div');
  el.id = 'nt-cam';
  el.innerHTML = `<div class="nt-cam-head"><b>📷 카메라 체크인</b>
      <span style="flex:1"></span>
      <button type="button" class="btn bs" data-act="flip" title="앞·뒤 카메라 바꾸기">↺</button>
      <button type="button" class="btn bs" data-act="full" title="화면 가득 키우기 · 줄이기 (Esc로도 줄여요)">⛶ 전체 화면</button>
      <button type="button" class="btn bs" data-act="close">끄기</button></div>
    <div class="nt-cam-view"><video playsinline muted></video><div class="nt-cam-aim"></div></div>
    <div class="nt-cam-msg" data-state="idle">네임택 QR을 네모 안에 비춰 주세요</div>`;
  document.body.appendChild(el);
  el.querySelector('[data-act="close"]').addEventListener('click', closeCamera);
  el.querySelector('[data-act="flip"]').addEventListener('click', () => { cam.facing = cam.facing === 'environment' ? 'user' : 'environment'; start(); });
  el.querySelector('[data-act="full"]').addEventListener('click', () => setFull(!el.classList.contains('full')));
  return el;
}

/* 전체 화면 — 창을 화면 가득(클래스 full) + 되면 브라우저 전체 화면 */
function setFull(on, remember = true){
  const el = document.getElementById('nt-cam');
  if(!el) return;
  el.classList.toggle('full', on);
  el.querySelector('[data-act="full"]').textContent = on ? '⛶ 작게' : '⛶ 전체 화면';
  if(remember){ try { localStorage.setItem(FULL_KEY, on ? '1' : ''); } catch {} }
  if(on){ if(!document.fullscreenElement) el.requestFullscreen?.().catch(() => {}); }
  else if(document.fullscreenElement === el) document.exitFullscreen?.().catch(() => {});
}
/* 브라우저 전체 화면에서 Esc로 빠지면 창도 줄인다 */
document.addEventListener('fullscreenchange', () => {
  const el = document.getElementById('nt-cam');
  if(el?.classList.contains('full') && !document.fullscreenElement) setFull(false);
});
/* 브라우저 전체 화면을 못 쓰는 기기에서도 Esc로 줄인다 */
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && !document.fullscreenElement && document.getElementById('nt-cam')?.classList.contains('full')) setFull(false);
});

function show(state, html){
  const m = document.querySelector('#nt-cam .nt-cam-msg');
  if(!m) return;
  m.dataset.state = state;
  m.innerHTML = html;
  clearTimeout(show.t);
  if(state !== 'idle') show.t = setTimeout(() => { m.dataset.state = 'idle'; m.textContent = '다음 QR을 비춰 주세요'; }, 3500);
}

async function start(){
  stopStream();
  const v = document.querySelector('#nt-cam video');
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cam.facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch(e){
    show('bad', e.name === 'NotAllowedError' ? '카메라를 쓰지 못하게 막혀 있어요. 주소창 왼쪽 자물쇠에서 카메라를 허용해 주세요.' : `카메라를 켜지 못했어요 — ${escapeHtml(e.message)}`);
    return;
  }
  v.srcObject = cam.stream;
  await v.play().catch(() => {});
  loop();
}

function stopStream(){
  cancelAnimationFrame(cam.raf); cam.raf = 0;
  cam.stream?.getTracks().forEach(t => t.stop());
  cam.stream = null;
}

const canvas = document.createElement('canvas');
async function readFrame(v){
  if(cam.detector){
    const r = await cam.detector.detect(v);
    return r[0]?.rawValue || '';
  }
  /* jsQR — 가운데를 잘라 작게 읽는다(빠르고, 네모 밖의 다른 QR은 안 읽는다) */
  const side = Math.min(v.videoWidth, v.videoHeight) * 0.8;
  const sx = (v.videoWidth - side) / 2, sy = (v.videoHeight - side) / 2, n = 480;
  canvas.width = canvas.height = n;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(v, sx, sy, side, side, 0, 0, n, n);
  const code = window.jsQR(g.getImageData(0, 0, n, n).data, n, n, { inversionAttempts: 'dontInvert' });
  return code?.data || '';
}

function loop(){
  cam.raf = requestAnimationFrame(async () => {
    if(!cam.stream) return;
    if(cam.alive && !cam.alive()){ closeCamera(); return; }   // 체크인 화면을 떠났으면 끈다
    const v = document.querySelector('#nt-cam video');
    const now = Date.now();
    if(v && v.readyState >= 2 && !cam.busy && now - cam.last >= EVERY){
      cam.last = now;
      cam.busy = true;
      try {
        const txt = await readFrame(v);
        if(txt) await handle(txt);
      } catch(e){ console.warn('QR 읽기', e); }
      cam.busy = false;
    }
    loop();
  });
}

async function handle(txt){
  const now = Date.now();
  if(now - (cam.seen.get(txt) || 0) < COOLDOWN) return;
  cam.seen.set(txt, now);
  const key = parseScan(txt);
  if(!key){ beep(false); show('bad', '네임택 입장 QR이 아니에요'); return; }
  show('wait', '확인하는 중…');
  const r = await cam.onScan(key);
  const who = r.person ? `<b>${escapeHtml(r.person.name)}</b><span>${escapeHtml(r.person.org || '')}${r.person.bar ? ` · ${r.person.bar}` : ''}</span>` : '';
  if(r.state === 'ok'){ beep(true); show('ok', `✓ 체크인 ${who}`); }
  else if(r.state === 'already'){ beep(false); show('warn', `이미 ${escapeHtml(r.at)}에 체크인했어요 ${who}`); }
  else if(r.state === 'unknown'){ beep(false); show('bad', '이 행사 명단에 없는 QR이에요'); }
  else { beep(false); show('bad', `체크인하지 못했어요 — ${escapeHtml(r.error || '')}`); }
}

/* 체크인 데스크를 열 때 미리 받아 둔다 — 그 뒤 인터넷이 끊겨도 카메라 읽기가 된다 */
export function preloadQrReader(){ if(!('BarcodeDetector' in window)) loadJsQR().catch(() => {}); }

/* onScan(key) → { state: 'ok'|'already'|'unknown'|'error', person: { name, org, bar }, at, error }
   alive() → false면 카메라를 끈다(데스크가 체크인 화면을 떠났을 때) */
export async function openCamera(onScan, alive){
  if(!navigator.mediaDevices?.getUserMedia) return alert('이 브라우저에서는 카메라를 쓸 수 없어요. https 주소로 열었는지 확인해 주세요.');
  cam.onScan = onScan; cam.alive = alive || null; cam.seen.clear();
  panel();
  /* 지난번에 전체 화면으로 썼으면 창만 가득(브라우저 전체 화면은 누른 순간에만 요청할 수 있다) */
  let full = false; try { full = localStorage.getItem(FULL_KEY) === '1'; } catch {}
  if(full) setFull(true, false);
  show('idle', '카메라를 켜는 중…');
  if('BarcodeDetector' in window){
    try { if((await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) cam.detector = new window.BarcodeDetector({ formats: ['qr_code'] }); }
    catch { cam.detector = null; }
  }
  if(!cam.detector){
    try { await loadJsQR(); } catch(e){ show('bad', escapeHtml(e.message)); return; }
  }
  await start();
  show('idle', '네임택 QR을 네모 안에 비춰 주세요');
}

export function closeCamera(){
  stopStream();
  if(document.fullscreenElement?.id === 'nt-cam') document.exitFullscreen?.().catch(() => {});
  document.getElementById('nt-cam')?.remove();
}
export const cameraOn = () => !!document.getElementById('nt-cam');
