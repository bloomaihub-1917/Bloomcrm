/* ══════════════════════════════════════════════════════════════
   track-colors.js — 트랙 색

   같은 트랙은 언제 봐도 같은 색이어야 한다. 프로그램표에서 색으로 트랙을
   알아보는 게 이 표의 전부인데, 색이 옮겨 다니면 색을 볼 이유가 없어진다.

   전에는 설정 목록의 «순서»로 색을 정했다. 그러면 트랙을 하나 더하거나
   순서를 바꾸는 순간 다른 트랙들의 색이 밀린다. 설정에 없는 트랙은 또
   이름 해시로 색을 정했으니, 같은 트랙이 설정에 등록되기 전후로 색이
   달라졌다.

   그래서 트랙 하나에 색 하나를 붙여 설정에 적어 둔다(conf.trackColors).
   한 번 정하면 목록이 어떻게 바뀌어도 그 트랙의 색은 그대로다.
═══════════════════════════════════════════════════════════════ */

export const TRACK_COLORS = [
  { bg: '#E8F3E4', bd: '#8FBF7A' },   // 연두
  { bg: '#FDF3DC', bd: '#E0B65C' },   // 노랑
  { bg: '#FBE4E4', bd: '#DC8B8B' },   // 분홍
  { bg: '#EAE4F5', bd: '#A38BD1' },   // 보라
  { bg: '#DFEFF7', bd: '#6FAFCE' },   // 하늘
  { bg: '#DCF0EC', bd: '#6FBCAB' },   // 청록
  { bg: '#F0E7DE', bd: '#C49A75' },   // 갈색
  { bg: '#E4ECF7', bd: '#7C96C4' },   // 남
  { bg: '#F7E7F0', bd: '#C98BAE' },   // 자
  { bg: '#EDF2DE', bd: '#A8BC72' },   // 올리브
  { bg: '#E2F0F7', bd: '#71B3C4' },   // 물
  { bg: '#F2E9E4', bd: '#B79B8C' },   // 모래
];

export const NO_TRACK_COLOR = { bg: 'var(--i8)', bd: 'var(--i5)' };

/* 아직 색을 정하지 않은 트랙의 임시 자리 — 이름에서 정한다. 설정에 적히기
   전에도 색이 있어야 하고, 이름이 같으면 같은 색이 나와야 한다. */
export function hashTrackIndex(track){
  let h = 0;
  for(const ch of String(track || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % TRACK_COLORS.length;
}

export function trackColorIndex(cfg, track){
  if(!track) return -1;
  const i = ((cfg && cfg.trackColors) || {})[track];
  return Number.isInteger(i)
    ? ((i % TRACK_COLORS.length) + TRACK_COLORS.length) % TRACK_COLORS.length
    : hashTrackIndex(track);
}

export function trackColorOf(cfg, track){
  if(!track) return NO_TRACK_COLOR;
  return TRACK_COLORS[trackColorIndex(cfg, track)] || NO_TRACK_COLOR;
}

/* 새 트랙에 줄 색 — 지금 가장 덜 쓰인 색을 준다. 순서대로 돌리면 트랙을
   지웠다 더할 때 같은 색이 겹치고, 겹친 색은 표에서 두 트랙을 하나로 보게
   만든다. */
export function pickTrackColorIndex(cfg){
  const used = Object.values(((cfg && cfg.trackColors) || {})).filter(Number.isInteger);
  const count = TRACK_COLORS.map((_, i) => used.filter(u => u === i).length);
  let best = 0;
  count.forEach((n, i) => { if(n < count[best]) best = i; });
  return best;
}
