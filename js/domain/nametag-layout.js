/* ══════════════════════════════════════════════════════════════
   nametag-layout.js — 네임택 판의 모양(용지 크기·글자 자리)

   좌표는 mm, 글자 크기는 pt. 화면 미리보기와 인쇄가 같은 숫자를 쓴다.
   bizmatching nametag-package의 lib/nametag-types.ts를 옮겼다(타입만 뺐다).
   서버(routes/nametag.js)는 저장할 때 모양만 보고, 키·범위는 읽을 때 여기서 맞춘다 —
   DB에 무엇이 들어 있든 화면은 이 함수를 거친 값만 그린다.

   입장 QR(qr): 판에서 켜면 사람마다 «nt:<등록번호>»를 QR로 찍는다. 체크인 데스크에서 바코드 스캐너로 읽으면
   검색칸에 그 글자가 들어오고 Enter에 바로 체크인한다(parseScan). 크기는 mm, x·y는 QR 가운데.
═══════════════════════════════════════════════════════════════ */

/* 국/영문 병기(2026-11-11): *_alt는 «다른 말»로 한 번 더 찍는 칸 — 본 칸이 국문이면 영문, 영문이면 국문.
   기본은 꺼 두고, 판에서 켜면 병기가 된다. 다른 말 값이 없거나 본 칸과 같으면 비운다(nt-people.js cardOf) */
export const TEXT_KEYS = ['name', 'name_alt', 'company', 'company_alt', 'job_title', 'job_title_alt', 'badge'];
export const EL_KEYS = [...TEXT_KEYS, 'qr'];
export const EL_LABEL = { name: '이름', name_alt: '이름 병기', company: '소속', company_alt: '소속 병기', job_title: '직함', job_title_alt: '직함 병기', badge: '구분', qr: '입장 QR' };
export const LINE_GAPS = [0.9, 1, 1.15, 1.3];   // 줄 간격(글자 크기의 배) — 두 줄일 때 줄 사이

/* 100×120mm(10 × 12cm) 세로 네임택 기준값 — 우리 행사 기본 용지 (2026-11-10)
   이름은 두 줄까지 쓴다(영문 이름은 한 줄에 안 들어가는 일이 잦다). 소속·직함은 그 두 번째 줄을 피해 아래에 둔다.
   구분(연사·바이어 등)은 위에 작게 — 꾸러미에서는 기본으로 껐지만 우리 행사는 연사·셀러·바이어를 가르는 일이 많아 켠다.
   가로 위치는 가운데(50), 칸 너비는 좌우 6mm씩 남긴 88mm */
export const DEFAULT_LAYOUT = {
  name:      { x: 50, y: 50, size: 36, weight: 700, align: 'center', maxWidth: 88, show: true, lines: 2 },
  company:   { x: 50, y: 72, size: 18, weight: 400, align: 'center', maxWidth: 88, show: true, lines: 1 },
  job_title: { x: 50, y: 81.3, size: 15, weight: 400, align: 'center', maxWidth: 88, show: true, lines: 1 },
  badge:     { x: 50, y: 24, size: 12, weight: 700, align: 'center', maxWidth: 66, show: true, lines: 1 },
  // 병기 — 켜면 본 칸 바로 아래 작게. 자리는 판마다 옮긴다
  name_alt:      { x: 50, y: 61, size: 16, weight: 400, align: 'center', maxWidth: 88, show: false, lines: 1 },
  company_alt:   { x: 50, y: 77, size: 12, weight: 400, align: 'center', maxWidth: 88, show: false, lines: 1 },
  job_title_alt: { x: 50, y: 86, size: 11, weight: 400, align: 'center', maxWidth: 88, show: false, lines: 1 },
  qr:        { x: 50, y: 100, size: 18, show: false },   // 켜면 이름·소속 아래 가운데. 아래 «종이 밖» 띠(4mm)에 안 걸린다
};
/* top: 프린터가 못 찍는 위 여백(mm). 레이저 프린터는 종이 앞끝 4mm쯤에 토너를 못 올려 판 위 끝이 비었다(2026-11-10 실측).
   인쇄 때 판을 통째로 이만큼 내려 찍는다 → 위는 안 잘리고, 판 아래 top mm가 종이 밖으로 나간다(편집기에 칠해 보여 준다) */
export const DEFAULT_OFFSET = { x: 0, y: 0, scale: 100, top: 4 };

/* 우리가 쓰는 네임택 크기 (2026-11-10). 다른 크기는 편집기에서 가로·세로를 직접 넣는다 */
export const SIZE_PRESETS = [
  { label: '100 × 120mm (기본)', width_mm: 100, height_mm: 120 },
  { label: '100 × 100mm (투포켓 · 하단바)', width_mm: 100, height_mm: 100 },
];
/* 출력 종이 — 인쇄할 때 프린터에 알려 주는 쪽 크기와, 그 쪽 안에서 네임택을 놓는 자리.
   100 × 120mm 같은 작은 종이를 그 크기로 알려 주면 프린터(드라이버)가 받지 않는 일이 많다(2026-11-10 현장).
   그래서 기본은 A4 쪽의 맨 위에 그리고, 작은 종이를 그대로 넣어 위쪽만 찍히게 한다.
   가로는 언제나 가운데 — 현장 프린터가 가운데로 급지한다(2026-11-10). 예전 'a4l'(맨 위 왼쪽)은 'a4'로 읽는다 */
export const SHEET_OPTIONS = [
  ['a4', 'A4 맨 위 가운데 — 네임택 종이를 가운데 맞춰 넣어요'],
  ['fit', '네임택 크기 그대로 — 프린터가 이 크기를 받을 때(가운데)'],
];
export const SHEETS = SHEET_OPTIONS.map(o => o[0]);
export const A4 = { width_mm: 210, height_mm: 297 };
export const LANG_OPTIONS = [['auto', '자동 (한글 이름이면 국문)'], ['ko', '국문'], ['en', '영문']];
export const REISSUE_REASONS = ['분실', '오타', '훼손', '기타'];

export const DEFAULT_TEMPLATE = {
  id: '', name: '기본 네임택', width_mm: 100, height_mm: 120, lang: 'auto', sheet: 'a4',
  background_data: null, background_print: false, layout: DEFAULT_LAYOUT, print_offset: DEFAULT_OFFSET, bar_types: [], is_default: true,
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
    lh: num(o.lh, 0.8, 2, d.lh || 1.15),   // 줄 간격 — 두 줄일 때 줄 사이(글자 크기의 배)
  };
}

export function normalizeLayout(v){
  const o = v || {};
  const q = o.qr || {};
  return {
    ...Object.fromEntries(TEXT_KEYS.map(k => [k, normText(o[k], DEFAULT_LAYOUT[k])])),
    qr: {
      x: num(q.x, -50, 470, DEFAULT_LAYOUT.qr.x), y: num(q.y, -50, 470, DEFAULT_LAYOUT.qr.y),
      size: num(q.size, 8, 120, DEFAULT_LAYOUT.qr.size),
      show: typeof q.show === 'boolean' ? q.show : DEFAULT_LAYOUT.qr.show,
    },
  };
}

export function normalizeOffset(v){
  const o = v || {};
  return { x: num(o.x, -10, 10, 0), y: num(o.y, -10, 10, 0), scale: num(o.scale, 90, 110, 100), top: num(o.top, 0, 15, 4) };
}

/* 하단바 종류 — 투포켓 명찰 아래에 끼우는 색 띠. 행사마다 종류가 달라 판에 둔다(2026-11-10 등록 담당자 피드백)
   [{ id, label, color }]. id는 한 번 정하면 바꾸지 않는다(사람마다 정해 둔 값이 이 id를 가리킨다) */
export const BAR_COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#7048e8', '#212529', '#868e96', '#e64980'];
export function normalizeBarTypes(v){
  const seen = new Set();
  return (Array.isArray(v) ? v : []).slice(0, 20).map(b => ({
    id: String(b?.id || '').trim().slice(0, 20), label: String(b?.label || '').trim().slice(0, 20),
    color: /^#[0-9a-f]{6}$/i.test(b?.color) ? b.color.toLowerCase() : '#868e96',
    roles: [...new Set((Array.isArray(b?.roles) ? b.roles : []).map(r => String(r || '').trim().slice(0, 30)).filter(Boolean))].slice(0, 30),
  })).filter(b => b.id && b.label && !seen.has(b.id) && seen.add(b.id));
}

/* 서버에서 온 판(없으면 null)을 화면이 그릴 수 있는 모양으로 */
export function normalizeTemplate(t){
  if(!t) return { ...DEFAULT_TEMPLATE, layout: normalizeLayout(null), print_offset: { ...DEFAULT_OFFSET }, bar_types: [] };
  return {
    id: t.id || '', name: t.name || DEFAULT_TEMPLATE.name,
    width_mm: num(t.width_mm, 20, 420, 100), height_mm: num(t.height_mm, 20, 420, 120),
    lang: ['auto', 'ko', 'en'].includes(t.lang) ? t.lang : 'auto',
    sheet: SHEETS.includes(t.sheet) ? t.sheet : 'a4',
    background_data: typeof t.background_data === 'string' && t.background_data ? t.background_data : null,
    background_print: !!t.background_print,
    layout: normalizeLayout(t.layout), print_offset: normalizeOffset(t.print_offset),
    bar_types: normalizeBarTypes(t.bar_types),
    is_default: t.is_default !== false, updated_at: t.updated_at || '', updated_by: t.updated_by || '',
  };
}

/* ── 입장 QR ──
   담는 글자는 «nt:» + 등록번호(person_key)를 소문자로. 스캐너는 키보드처럼 글자를 쳐 넣는데, 한글 입력 상태면
   영문이 한글로 바뀌어 들어온다(c → ㅊ). 대문자는 한글 자판에서 되살릴 수 없어 소문자만 쓰고,
   읽을 때 한글을 두벌식 자판 글쇠로 되돌린다(deHangul) */
export const qrText = (card) => card && card.person_key ? 'nt:' + String(card.person_key).toLowerCase() : '';
const CHO = ['r', 'R', 's', 'e', 'E', 'f', 'a', 'q', 'Q', 't', 'T', 'd', 'w', 'W', 'c', 'z', 'x', 'v', 'g'];
const JUNG = ['k', 'o', 'i', 'O', 'j', 'p', 'u', 'P', 'h', 'hk', 'ho', 'hl', 'y', 'n', 'nj', 'np', 'nl', 'b', 'm', 'ml', 'l'];
const JONG = ['', 'r', 'R', 'rt', 's', 'sw', 'sg', 'e', 'f', 'fr', 'fa', 'fq', 'ft', 'fx', 'fv', 'fg', 'a', 'q', 'qt', 't', 'T', 'd', 'w', 'c', 'z', 'x', 'v', 'g'];
const COMPAT = ['r', 'R', 'rt', 's', 'sw', 'sg', 'e', 'E', 'f', 'fr', 'fa', 'fq', 'ft', 'fx', 'fv', 'fg', 'a', 'q', 'Q', 'qt', 't', 'T', 'd', 'w', 'W', 'c', 'z', 'x', 'v', 'g',
  'k', 'o', 'i', 'O', 'j', 'p', 'u', 'P', 'h', 'hk', 'ho', 'hl', 'y', 'n', 'nj', 'np', 'nl', 'b', 'm', 'ml', 'l'];
export function deHangul(s){
  return String(s || '').replace(/[가-힣ㄱ-ㅣ]/g, ch => {
    const c = ch.charCodeAt(0);
    if(c >= 0x3131 && c <= 0x3163) return COMPAT[c - 0x3131] || '';
    const i = c - 0xac00;
    return CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28];
  });
}
/* 스캐너가 쳐 넣은 글자 → 등록번호(소문자). QR이 아니면 '' */
export function parseScan(s){
  const v = deHangul(String(s || '').trim()).toLowerCase();
  const m = /^nt:(\S+)$/.exec(v);
  return m ? m[1] : '';
}

export const MM_PX = 96 / 25.4;     // CSS 1mm = 96/25.4 px
export const PT_MM = 25.4 / 72;     // 1pt = 0.3528mm
export const LINE_HEIGHT = 1.15;    // 기본 줄 간격 — 칸마다 lh로 바꾼다(편집기 손잡이 높이도 그 값으로 잰다)
