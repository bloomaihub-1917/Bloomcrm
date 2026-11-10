/* ══════════════════════════════════════════════════════════════
   nametag-layout.js — 네임택 판의 모양(용지 크기·글자 자리)

   좌표는 mm, 글자 크기는 pt. 화면 미리보기와 인쇄가 같은 숫자를 쓴다.
   bizmatching nametag-package의 lib/nametag-types.ts를 옮겼다(타입만 뺐다).
   서버(routes/nametag.js)는 저장할 때 모양만 보고, 키·범위는 읽을 때 여기서 맞춘다 —
   DB에 무엇이 들어 있든 화면은 이 함수를 거친 값만 그린다.

   입장 QR(qr)은 자리만 남겨 둔다. CRM에는 아직 입장 체크인이 없어 그리지 않는다.
═══════════════════════════════════════════════════════════════ */

export const TEXT_KEYS = ['name', 'company', 'job_title', 'badge'];
export const EL_LABEL = { name: '이름', company: '소속', job_title: '직함', badge: '구분', qr: '입장 QR' };

/* 100×120mm(10 × 12cm) 세로 네임택 기준값 — 우리 행사 기본 용지 (2026-11-10)
   이름은 두 줄까지 쓴다(영문 이름은 한 줄에 안 들어가는 일이 잦다). 소속·직함은 그 두 번째 줄을 피해 아래에 둔다.
   구분(연사·바이어 등)은 위에 작게 — 꾸러미에서는 기본으로 껐지만 우리 행사는 연사·셀러·바이어를 가르는 일이 많아 켠다.
   가로 위치는 가운데(50), 칸 너비는 좌우 6mm씩 남긴 88mm */
export const DEFAULT_LAYOUT = {
  name:      { x: 50, y: 50, size: 36, weight: 700, align: 'center', maxWidth: 88, show: true, lines: 2 },
  company:   { x: 50, y: 72, size: 18, weight: 400, align: 'center', maxWidth: 88, show: true, lines: 1 },
  job_title: { x: 50, y: 81.3, size: 15, weight: 400, align: 'center', maxWidth: 88, show: true, lines: 1 },
  badge:     { x: 50, y: 24, size: 12, weight: 700, align: 'center', maxWidth: 66, show: true, lines: 1 },
  qr:        { x: 50, y: 100, size: 20, show: false },
};
export const DEFAULT_OFFSET = { x: 0, y: 0, scale: 100 };

/* 우리가 쓰는 네임택 크기 (2026-11-10). 다른 크기는 편집기에서 가로·세로를 직접 넣는다 */
export const SIZE_PRESETS = [
  { label: '100 × 120mm (기본)', width_mm: 100, height_mm: 120 },
  { label: '100 × 100mm (투포켓 · 하단바)', width_mm: 100, height_mm: 100 },
];
/* 출력 종이 — 인쇄할 때 프린터에 알려 주는 쪽 크기와, 그 쪽 안에서 네임택을 놓는 자리.
   100 × 120mm 같은 작은 종이를 그 크기로 알려 주면 프린터(드라이버)가 받지 않는 일이 많다(2026-11-10 현장).
   그래서 기본은 A4 쪽의 맨 위에 그리고, 작은 종이를 그대로 넣어 위쪽만 찍히게 한다.
   가로 자리는 종이를 넣는 방식에 맞춘다 — 급지대 가운데 맞춤이면 가운데, 왼쪽에 붙여 넣으면 왼쪽 */
export const SHEET_OPTIONS = [
  ['a4', 'A4 맨 위 가운데 — 종이를 가운데 맞춰 넣을 때'],
  ['a4l', 'A4 맨 위 왼쪽 — 종이를 왼쪽에 붙여 넣을 때'],
  ['fit', '네임택 크기 그대로 — 프린터가 이 크기를 받을 때'],
];
export const SHEETS = SHEET_OPTIONS.map(o => o[0]);
export const A4 = { width_mm: 210, height_mm: 297 };
export const LANG_OPTIONS = [['auto', '자동 (한글 이름이면 국문)'], ['ko', '국문'], ['en', '영문']];
export const REISSUE_REASONS = ['분실', '오타', '훼손', '기타'];

export const DEFAULT_TEMPLATE = {
  id: '', name: '기본 네임택', width_mm: 100, height_mm: 120, lang: 'auto', sheet: 'a4',
  background_data: null, background_print: false, layout: DEFAULT_LAYOUT, print_offset: DEFAULT_OFFSET, is_default: true,
};

const num = (v, min, max, d) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 10) / 10)) : d;
};

function normText(v, d){
  const o = v || {};
  return {
    x: num(o.x, -50, 470, d.x), y: num(o.y, -50, 470, d.y),
    size: num(o.size, 6, 120, d.size),
    weight: o.weight === 400 || o.weight === 700 ? o.weight : d.weight,
    align: ['left', 'center', 'right'].includes(o.align) ? o.align : d.align,
    maxWidth: num(o.maxWidth, 5, 420, d.maxWidth),
    show: typeof o.show === 'boolean' ? o.show : d.show,
    lines: Math.round(num(o.lines, 1, 3, d.lines)),
  };
}

export function normalizeLayout(v){
  const o = v || {};
  const q = o.qr || {};
  return {
    name: normText(o.name, DEFAULT_LAYOUT.name),
    company: normText(o.company, DEFAULT_LAYOUT.company),
    job_title: normText(o.job_title, DEFAULT_LAYOUT.job_title),
    badge: normText(o.badge, DEFAULT_LAYOUT.badge),
    qr: {
      x: num(q.x, -50, 470, DEFAULT_LAYOUT.qr.x), y: num(q.y, -50, 470, DEFAULT_LAYOUT.qr.y),
      size: num(q.size, 8, 120, DEFAULT_LAYOUT.qr.size),
      show: typeof q.show === 'boolean' ? q.show : DEFAULT_LAYOUT.qr.show,
    },
  };
}

export function normalizeOffset(v){
  const o = v || {};
  return { x: num(o.x, -10, 10, 0), y: num(o.y, -10, 10, 0), scale: num(o.scale, 90, 110, 100) };
}

/* 서버에서 온 판(없으면 null)을 화면이 그릴 수 있는 모양으로 */
export function normalizeTemplate(t){
  if(!t) return { ...DEFAULT_TEMPLATE, layout: normalizeLayout(null), print_offset: { ...DEFAULT_OFFSET } };
  return {
    id: t.id || '', name: t.name || DEFAULT_TEMPLATE.name,
    width_mm: num(t.width_mm, 20, 420, 100), height_mm: num(t.height_mm, 20, 420, 120),
    lang: ['auto', 'ko', 'en'].includes(t.lang) ? t.lang : 'auto',
    sheet: SHEETS.includes(t.sheet) ? t.sheet : 'a4',
    background_data: typeof t.background_data === 'string' && t.background_data ? t.background_data : null,
    background_print: !!t.background_print,
    layout: normalizeLayout(t.layout), print_offset: normalizeOffset(t.print_offset),
    is_default: t.is_default !== false, updated_at: t.updated_at || '', updated_by: t.updated_by || '',
  };
}

export const MM_PX = 96 / 25.4;     // CSS 1mm = 96/25.4 px
export const PT_MM = 25.4 / 72;     // 1pt = 0.3528mm
export const LINE_HEIGHT = 1.15;    // .nt-el 줄 높이 — 편집기 손잡이 높이도 같은 값으로 잰다
