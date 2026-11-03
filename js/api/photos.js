/* ══════════════════════════════════════════════════════════════
   api/photos.js — 연사 사진 — /api/photos
   (api/mail-send.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { authHeaders } from '../api.js';
import { API_BASE_URL, currentUser } from '../state.js';

/* ── 연사 사진 (backend-node/routes/photos.js) ──
   행사 단위로 한 번에 받아 둔다. 드로어를 열 때마다 묻지 않고, 받는 중이면 같은
   약속을 돌려준다(연사를 빠르게 넘겨 열어도 요청은 한 번). */
const speakerPhotoCache = {};      // evKey → { [speakerId]: { file, content_type, data, updated_at } }
const speakerPhotoLoading = {};
export const speakerPhotoOf = (evKey, spId) => speakerPhotoCache[evKey]?.[spId] || null;
export const speakerPhotosLoaded = (evKey) => !!speakerPhotoCache[evKey];
export function loadSpeakerPhotos(evKey){
  if(speakerPhotoCache[evKey]) return Promise.resolve(speakerPhotoCache[evKey]);
  if(!API_BASE_URL || !currentUser){ speakerPhotoCache[evKey] = {}; return Promise.resolve(speakerPhotoCache[evKey]); }
  return speakerPhotoLoading[evKey] || (speakerPhotoLoading[evKey] = (async () => {
    try {
      // 서버가 나눠 보낸다(한 응답 4.5MB 한도) — next가 없을 때까지 이어 받는다
      const got = {};
      let after = '', ok = false;
      for(let page = 0; page < 50; page++){
        const res = await fetch(`${API_BASE_URL}/api/photos?event_id=${encodeURIComponent(evKey)}&after=${encodeURIComponent(after)}`, { headers: await authHeaders() });
        const j = await res.json().catch(() => ({}));
        if(!j.ok){ ok = false; break; }
        ok = true;
        (j.photos || []).forEach(p => { got[p.speaker_id] = p; });
        if(!j.next) break;
        after = j.next;
      }
      if(ok) speakerPhotoCache[evKey] = got;
    } catch(e){ console.warn('[CRM] 연사 사진 실패:', e.message); }
    delete speakerPhotoLoading[evKey];
    return speakerPhotoCache[evKey] || {};
  })());
}
export async function saveSpeakerPhoto(evKey, spId, rec){
  const keep = () => { (speakerPhotoCache[evKey] = speakerPhotoCache[evKey] || {})[spId] = { ...rec, updated_at: new Date().toISOString() }; };
  if(!API_BASE_URL || !currentUser){ keep(); return { ok: true, offline: true }; }
  try {
    const headers = { 'Content-Type': 'application/json', ...await authHeaders() };
    const res = await fetch(`${API_BASE_URL}/api/photos/${encodeURIComponent(spId)}`,
      { method: 'PUT', headers, body: JSON.stringify({ event_id: evKey, ...rec }) });
    const j = await res.json().catch(() => ({}));
    if(!res.ok || j.ok === false) return { ok: false, error: j.error || `올리기 실패 (${res.status})` };
    keep(); return { ok: true };
  } catch(e){ return { ok: false, error: `올리기 실패: ${e.message}` }; }
}
export async function deleteSpeakerPhoto(evKey, spId){
  const drop = () => { if(speakerPhotoCache[evKey]) delete speakerPhotoCache[evKey][spId]; };
  if(!API_BASE_URL || !currentUser){ drop(); return { ok: true }; }
  try {
    const res = await fetch(`${API_BASE_URL}/api/photos/${encodeURIComponent(spId)}`, { method: 'DELETE', headers: await authHeaders() });
    const j = await res.json().catch(() => ({}));
    if(!res.ok || j.ok === false) return { ok: false, error: j.error || `삭제 실패 (${res.status})` };
    drop(); return { ok: true };
  } catch(e){ return { ok: false, error: `삭제 실패: ${e.message}` }; }
}
/* 브라우저에서 사진을 줄인다 — 연사 사진 원본은 5~10MB가 흔하다(이원석 10.7MB).
   긴 변 800px JPEG로 그려 내면 100KB 안팎이 된다. 휴대폰 사진의 회전(EXIF)은
   요즘 브라우저가 그릴 때 알아서 바로 세운다(image-orientation 기본값 from-image). */
export function shrinkImage(file, max = 800){
  return new Promise((ok, no) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);   // 투명 PNG가 검게 뜨지 않게
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok({ content_type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error('사진을 읽지 못했어요 (JPG·PNG·WEBP만)')); };
    img.src = url;
  });
}


