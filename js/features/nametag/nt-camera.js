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
   - 🔤 이름 읽기(2026-11-13): QR이 없는 네임택은 이름이 보이게 비추고 단추를 누르면 글자를 읽어(Tesseract.js, 이 기기 안에서 —
     사진은 어디로도 보내지 않는다) 명단에서 찾는다. 이름이 그대로 한 명만 맞으면 바로 체크인, 아니면 후보를 띄워 고르게 한다.
     읽기 도구·글자 자료(국문·영문 약 15MB)는 처음 누를 때 받고, 그 뒤로는 브라우저가 기억한다
   - 자동 이름 읽기(2026-11-16, 기본 켬): 단추를 누르지 않아도 AUTO_GAP마다 화면을 읽는다. 입구에서 단추를 누를 손이 없다.
     · 화면이 지난번 «못 찾음»과 거의 같으면(아무도 없음·같은 사람이 서 있음) 읽지 않는다 — 읽기는 무겁다(sameScene)
     · 못 찾으면 조용히 넘어간다(빨강·삑 없음). 이름이 꽤 닮을 때(AUTO_PICK)만 후보를 띄우고, 고르는 동안은 멈춘다
     · 방금 체크인한 사람은 NAME_COOLDOWN 동안 다시 세지 않는다. QR이 읽히는 중이면 QR이 먼저
     · «자동» 체크를 끄면 예전처럼 단추로만. 고른 값은 이 기기에 기억
═══════════════════════════════════════════════════════════════ */
import { escapeHtml } from '../../utils.js';
import { parseScan } from '../../domain/nametag-layout.js';

const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const COOLDOWN = 4000;   // 같은 QR을 다시 받기까지(ms)
const EVERY = 120;       // 몇 ms마다 한 번 읽을지 — 휴대폰이 뜨거워지지 않게

const AUTO_GAP = 1200;        // 자동 이름 읽기 — 한 번 읽고 나서 다음까지(ms)
const NAME_COOLDOWN = 15000;  // 이름으로 체크인한 사람을 다시 세기까지(ms)
const AUTO_PICK = 0.85;       // 자동일 때 후보를 띄우는 닮음 — 그 아래는 다른 글자를 잘못 읽은 것으로 보고 넘어간다
const PICK_HOLD = 15000;      // 후보를 띄우면 자동 읽기를 이만큼 멈춘다(고르면 바로 다시)

const FULL_KEY = 'nametag.camera-full.v1';
const AUTO_KEY = 'nametag.camera-autoread.v1';
const cam = { stream: null, raf: 0, last: 0, seen: new Map(), detector: null, onScan: null, onText: null, busy: false, facing: 'environment', alive: null,
  ocr: null, reading: false, auto: true, autoT: 0, holdUntil: 0, qrAt: 0, sig: null, names: new Map(), pickSig: '' };

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
    <div class="nt-cam-act"><label class="nt-cam-auto" title="켜 두면 단추를 누르지 않아도 비추는 대로 이름을 읽어요"><input type="checkbox" data-act="auto"> 자동</label>
      <button type="button" class="btn bp" data-act="read" title="QR이 없는 네임택 — 이름이 보이게 비추고 눌러요">🔤 이름 읽기</button></div>
    <div class="nt-cam-msg" data-state="idle">${idleText()}</div>`;
  document.body.appendChild(el);
  el.querySelector('[data-act="close"]').addEventListener('click', closeCamera);
  el.querySelector('[data-act="flip"]').addEventListener('click', () => { cam.facing = cam.facing === 'environment' ? 'user' : 'environment'; start(); });
  el.querySelector('[data-act="full"]').addEventListener('click', () => setFull(!el.classList.contains('full')));
  el.querySelector('[data-act="read"]').addEventListener('click', () => readName(false));
  const au = el.querySelector('[data-act="auto"]');
  au.checked = cam.auto;
  au.addEventListener('change', () => {
    cam.auto = au.checked;
    try { localStorage.setItem(AUTO_KEY, cam.auto ? '1' : '0'); } catch {}
    cam.sig = null;
    if(cam.auto) scheduleAuto(0);
    const m = el.querySelector('.nt-cam-msg');
    if(m?.dataset.state === 'idle') m.textContent = idleText();
  });
  /* 이름 후보를 누르면 그 사람으로 체크인 — 자동 읽기는 바로 다시 */
  el.querySelector('.nt-cam-msg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-key]');
    if(!b) return;
    cam.holdUntil = 0; cam.pickSig = '';
    cam.names.set(b.dataset.key, Date.now());
    checkKey(b.dataset.key);
  });
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

const idleText = () => cam.auto ? '네임택 QR이나 이름을 네모 안에 비춰 주세요 — 자동으로 읽어요'
  : '네임택 QR을 네모 안에 비추거나, 이름이 보이게 비추고 «🔤 이름 읽기»를 눌러요';
function show(state, html, ms = 3500){
  const m = document.querySelector('#nt-cam .nt-cam-msg');
  if(!m) return;
  m.dataset.state = state;
  m.innerHTML = html;
  clearTimeout(show.t);
  if(state !== 'idle') show.t = setTimeout(() => { m.dataset.state = 'idle'; m.textContent = '다음 네임택을 비춰 주세요'; cam.holdUntil = 0; cam.pickSig = ''; }, ms);
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
  if(cam.auto && cam.onText) scheduleAuto(800);
}

function stopStream(){
  cancelAnimationFrame(cam.raf); cam.raf = 0;
  clearTimeout(cam.autoT); cam.autoT = 0;
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
  cam.qrAt = now;   // QR이 비치는 동안은 자동 이름 읽기를 쉰다
  if(now - (cam.seen.get(txt) || 0) < COOLDOWN) return;
  cam.seen.set(txt, now);
  const key = parseScan(txt);
  if(!key){ beep(false); show('bad', '네임택 입장 QR이 아니에요'); return; }
  await checkKey(key);
}

async function checkKey(key){
  show('wait', '확인하는 중…');
  const r = await cam.onScan(key);
  const who = r.person ? `<b>${escapeHtml(r.person.name)}</b><span>${escapeHtml(r.person.org || '')}${r.person.bar ? ` · ${r.person.bar}` : ''}</span>` : '';
  if(r.state === 'ok'){ beep(true); show('ok', `✓ 체크인 ${who}`); }
  else if(r.state === 'already'){ beep(false); show('warn', `이미 ${escapeHtml(r.at)}에 체크인했어요 ${who}`); }
  else if(r.state === 'unknown'){ beep(false); show('bad', '이 행사 명단에 없는 QR이에요'); }
  else { beep(false); show('bad', `체크인하지 못했어요 — ${escapeHtml(r.error || '')}`); }
}

/* ── 이름 읽기 ── */
function loadTess(){
  if(window.Tesseract) return Promise.resolve();
  return new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = TESS_URL; s.onload = ok; s.onerror = () => no(new Error('글자 읽기 도구를 못 불러왔어요'));
    document.head.appendChild(s);
  });
}
async function ocrWorker(){
  if(!cam.ocr) cam.ocr = (async () => {
    await loadTess();
    const w = await window.Tesseract.createWorker(['kor', 'eng'], 1);
    return w;
  })().catch(e => { cam.ocr = null; throw e; });
  return cam.ocr;
}
/* 화면의 네모 안을 잘라 흑백으로 — 600px로 둔다. 글자가 너무 크면(이름이 150px쯤) 오히려 못 읽었다(2026-11-13 시험) */
const ocrCanvas = document.createElement('canvas');
function grabAim(v){
  const side = Math.min(v.videoWidth, v.videoHeight) * 0.9;
  const sx = (v.videoWidth - side) / 2, sy = (v.videoHeight - side) / 2, n = 600;
  ocrCanvas.width = ocrCanvas.height = n;
  const g = ocrCanvas.getContext('2d', { willReadFrequently: true });
  g.filter = 'grayscale(1) contrast(1.4)';
  g.drawImage(v, sx, sy, side, side, 0, 0, n, n);
  return ocrCanvas;
}
/* 화면이 지난번과 거의 같은지 — 24 × 24 흑백으로 줄여 밝기 차의 평균을 잰다.
   지난번에 못 찾은 화면과 같으면 다시 읽어도 못 찾는다(아무도 없거나, 같은 사람이 그대로 서 있음) */
const sigCanvas = document.createElement('canvas');
function sceneSig(img){
  const n = 24;
  sigCanvas.width = sigCanvas.height = n;
  const g = sigCanvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, n, n);
  const d = g.getImageData(0, 0, n, n).data, out = new Uint8Array(n * n);
  for(let i = 0; i < out.length; i++) out[i] = d[i * 4];
  return out;
}
/* 평균이 아니라 «크게 바뀐 칸 수»로 본다 — 흰 종이에 글자만 생기면 576칸 중 16칸만 바뀌어 평균으로는 같은 화면이었다(시험).
   카메라 잡음은 24 × 24로 줄이면 칸마다 몇 단계라 20을 넘지 않는다 */
const sameScene = (a, b) => { if(!a || !b) return false; let n = 0; for(let i = 0; i < a.length; i++) if(Math.abs(a[i] - b[i]) > 20 && ++n >= 6) return false; return true; };

/* 자동 이름 읽기 — 읽고 나서 AUTO_GAP 뒤에 다음. 쉴 때(후보 고르는 중·QR·결과 표시·창을 내림)는 그냥 다음 차례로 */
function scheduleAuto(ms = AUTO_GAP){
  clearTimeout(cam.autoT);
  cam.autoT = setTimeout(async () => {
    if(!cam.stream || !cam.auto || !cam.onText) return;
    const m = document.querySelector('#nt-cam .nt-cam-msg')?.dataset.state;
    const now = Date.now();
    const rest = document.hidden || cam.reading || now < cam.holdUntil || now - cam.qrAt < 2000 || (m && m !== 'idle');
    if(!rest) await readName(true);
    if(cam.stream && cam.auto) scheduleAuto();
  }, ms);
}

/* auto: 자동으로 부른 것 — 못 찾으면 조용히, 닮은 이름이 꽤 있을 때만 후보, 방금 체크인한 사람은 넘긴다 */
async function readName(auto = false){
  const v = document.querySelector('#nt-cam video');
  if(cam.reading || !v || v.readyState < 2) return;
  if(!cam.onText) return auto ? undefined : show('bad', '이름 읽기를 쓸 수 없어요');
  const img = grabAim(v);   // 누른 순간의 화면 — 읽는 동안 손을 치워도 된다
  const sig = sceneSig(img);
  if(auto && sameScene(sig, cam.sig)) return;
  cam.reading = true;
  const btn = document.querySelector('#nt-cam [data-act="read"]');
  if(btn){ btn.disabled = true; if(auto) btn.textContent = '🔤 읽는 중…'; }
  try {
    if(!auto) show('wait', cam.ocr ? '이름 읽는 중…' : '이름 읽는 중… 처음에는 읽기 도구를 받느라 조금 걸려요', 60000);
    else if(!cam.ocr) show('idle', '이름 읽기 도구를 받는 중… 처음 한 번만 조금 걸려요');
    const w = await ocrWorker();
    /* 읽는 방식 두 가지 — 흩어진 글자(11)로 먼저, 이름을 바로 못 찾으면 한 덩어리 글(6)로 한 번 더 읽어 합친다.
       같은 그림도 방식에 따라 이름을 놓치는 일이 잦았다 */
    let text = '', r = null;
    for(const psm of ['11', '6']){
      await w.setParameters({ tessedit_pageseg_mode: psm });
      text += '\n' + ((await w.recognize(img)).data.text || '');
      r = cam.onText(text);
      if(r.exact) break;
    }
    if(!cam.stream) return;   // 읽는 동안 카메라를 껐다
    const now = Date.now();
    if(r.exact){
      if(auto && now - (cam.names.get(r.exact) || 0) < NAME_COOLDOWN){ cam.sig = sig; return; }   // 방금 그 사람 — 서 있는 동안 다시 안 센다
      cam.names.set(r.exact, now);
      cam.sig = sig;
      await checkKey(r.exact);
    } else if(r.list.length && (!auto || (r.best || 0) >= AUTO_PICK)){
      const ps = r.list.map(p => p.key).join('|');
      cam.sig = sig;
      if(auto && ps === cam.pickSig) return;   // 같은 후보를 또 띄우지 않는다
      cam.pickSig = ps; cam.holdUntil = now + PICK_HOLD;
      beep(false);
      show('pick', `<span>${escapeHtml(r.why || '누구인지 골라 주세요')}${r.read ? ` · 읽은 글자 «${escapeHtml(r.read)}»` : ''}</span>
        <div class="nt-cam-pick">${r.list.map(p => `<button type="button" class="btn bs" data-key="${escapeHtml(p.key)}"><b>${escapeHtml(p.name)}</b> ${escapeHtml(p.org || '')}</button>`).join('')}</div>`, PICK_HOLD);
    } else if(auto){
      cam.sig = sig;   // 못 찾음 — 조용히. 화면이 바뀌면 다시 읽는다
      const m = document.querySelector('#nt-cam .nt-cam-msg');
      if(m?.dataset.state === 'idle') m.textContent = idleText();
    } else { beep(false); show('bad', `명단에서 이름을 못 찾았어요${r.read ? ` — 읽은 글자 «${escapeHtml(r.read)}»` : ''}. 이름을 네모 가득 비추고 다시 눌러 주세요`, 6000); }
  } catch(e){
    if(!auto){ beep(false); show('bad', `이름을 읽지 못했어요 — ${escapeHtml(e.message || String(e))}`, 6000); }
    else { console.warn('자동 이름 읽기', e); cam.holdUntil = Date.now() + 10000; }   // 도구를 못 받았으면 잠시 쉬었다가
  } finally {
    cam.reading = false;
    if(btn){ btn.disabled = false; btn.textContent = '🔤 이름 읽기'; }
  }
}

/* 체크인 데스크를 열 때 미리 받아 둔다 — 그 뒤 인터넷이 끊겨도 카메라 읽기가 된다 */
export function preloadQrReader(){ if(!('BarcodeDetector' in window)) loadJsQR().catch(() => {}); }

/* onScan(key) → { state: 'ok'|'already'|'unknown'|'error', person: { name, org, bar }, at, error }
   alive() → false면 카메라를 끈다(데스크가 체크인 화면을 떠났을 때)
   onText(읽은 글자) → { exact: key | '', list: [{ key, name, org }], read } — 이름 읽기에서 명단 찾기 */
export async function openCamera(onScan, alive, onText){
  if(!navigator.mediaDevices?.getUserMedia) return alert('이 브라우저에서는 카메라를 쓸 수 없어요. https 주소로 열었는지 확인해 주세요.');
  cam.onScan = onScan; cam.alive = alive || null; cam.onText = onText || null; cam.seen.clear();
  cam.names.clear(); cam.sig = null; cam.holdUntil = 0; cam.pickSig = '';
  try { cam.auto = localStorage.getItem(AUTO_KEY) !== '0'; } catch { cam.auto = true; }
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
  show('idle', idleText());
  if(cam.auto && cam.onText) ocrWorker().catch(() => {});   // 읽기 도구를 미리 받아 둔다 — 첫 사람이 기다리지 않게
}

export function closeCamera(){
  stopStream();
  if(document.fullscreenElement?.id === 'nt-cam') document.exitFullscreen?.().catch(() => {});
  document.getElementById('nt-cam')?.remove();
}
export const cameraOn = () => !!document.getElementById('nt-cam');
