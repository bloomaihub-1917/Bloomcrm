/* ══════════════════════════════════════════════════════════════
   nt-editor.js — 설정 › 행사 상세 › 네임택 (네임택 판 편집기)

   판은 행사마다 한 번 정해 두는 값이라 발급 데스크가 아니라 설정에 둔다(데스크에는 «판 고치기» 단추만).
   이름·소속·직함·구분을 끌어 옮기고, 크기·굵기·정렬·줄 수·칸 너비를 정한다.
   - 좌표는 mm, 글자 크기는 pt. 화면에 보이는 그대로 인쇄된다
   - 끌기는 0.1mm 단위, 방향키 1mm(Shift 0.1mm). 끌 때 가운데선 ±1mm 안에서는 자석처럼 붙는다
   - 배경은 가늠자다. 용지를 찍거나 스캔해 올리면 글자 자리를 맞춰 볼 수 있고, «배경도 함께 인쇄»를
     켜지 않으면 종이에는 글자만 찍힌다(이미 인쇄된 네임택 용지에 얹는 방식)
   bizmatching nametag-package의 NametagEditor를 옮겼다. 판은 행사마다 하나(기본 판)만 둔다 — 여럿 둘 일이 생기면 그때 넓힌다.

   숫자 칸은 onchange(칸을 벗어나거나 Enter)로 받고 판만 다시 그린다 — 칠 때마다 통째로 그리면 입력칸이 포커스를 잃는다.
═══════════════════════════════════════════════════════════════ */
import { escapeHtml, escAttr } from '../../utils.js';
import { normalizeTemplate, normalizeLayout, normalizeOffset, DEFAULT_LAYOUT, BAR_COLORS, SIZE_PRESETS, SHEET_OPTIONS, SHEETS, LANG_OPTIONS, TEXT_KEYS, EL_KEYS, EL_LABEL, MM_PX, PT_MM, LINE_HEIGHT } from '../../domain/nametag-layout.js';
import { loadNametag, saveNametagTemplate } from '../../api/nametag.js';
import { ntCardHtml } from './nt-card.js';
import { fitNametags } from './nt-fit.js';
import { openPrintWindow, fillPrintWindow } from './nt-print.js';
import { ntPeople, cardOf } from './nt-people.js';
import { ntTemplateSaved } from './nt-desk.js';

const SAMPLES = [
  ['ko', '국문 견본', { name: '홍길동', company: '스튜디오블룸', job_title: '사업개발 팀장', badge: '연사' }],
  ['en', '긴 영문 이름', { name: 'Maximilian Alexander Wolfgang-Schneider', company: 'Boehringer Ingelheim Pharmaceuticals GmbH', job_title: 'Senior Vice President, Business Development', badge: 'Speaker' }],
];
const ALIGNS = [['left', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']];
const BG_EDGE = 1600;   // 배경 이미지 긴 변 — 가늠자라 이 정도면 충분하고, 표에 넣으므로 작게

const ed = { ev: '', t: null, bgDim: null, saved: '', sel: 'name', sample: 'ko', bgOpacity: 1, busy: false, msg: '', err: '', guide: { x: false, y: false } };
const dirty = () => !!ed.t && JSON.stringify(ed.t) !== ed.saved;
const round = (v) => Math.round(v * 10) / 10;   // 0.1mm 단위 — v / 0.1 * 0.1은 55.800000000000004가 된다
const snap = (v, to) => (Math.abs(v - to) <= 1 ? to : v);
const zoomOf = (t) => Math.min(1, 460 / (t.width_mm * MM_PX), 560 / (t.height_mm * MM_PX));

/* 설정 › 행사 상세가 <div id="nt-ed">를 그린 뒤 부른다 */
export async function mountNametagEditor(evKey){
  const box = document.getElementById('nt-ed');
  if(!box) return;
  if(ed.ev !== evKey || !ed.t){
    Object.assign(ed, { ev: evKey, t: null, sel: 'name', msg: '', err: '' });
    box.innerHTML = '<div class="nt-note">네임택 판을 불러오는 중…</div>';
    try {
      const j = await loadNametag(evKey);
      if(ed.ev !== evKey) return;
      ed.t = normalizeTemplate(j.template);
      ed.saved = JSON.stringify(ed.t);
    } catch(e){
      box.innerHTML = `<div class="nt-warn">네임택 판을 못 불러왔어요 — ${escapeHtml(e.message)}</div>`;
      ed.ev = '';
      return;
    }
    if(!document.getElementById('nt-ed')) return;
  }
  renderEditor();
}

function sampleCard(){
  if(ed.sample.startsWith('p:')){
    const p = ntPeople(ed.ev).find(x => x.key === ed.sample.slice(2));
    if(p) return { ...cardOf(p, ed.t.lang), person_key: p.key };   // 이 행사 사람이면 입장 QR도 그 사람 것으로
  }
  return (SAMPLES.find(s => s[0] === ed.sample) || SAMPLES[0])[2];
}

/* 손잡이: 글자 칸을 대강 감싸는 네모(가로 = 칸 너비, 세로 = 글자 크기 × 줄 수) */
function handleBox(key){
  const x = ed.t.layout[key];
  if(key === 'qr') return `left:${x.x - x.size / 2}mm;top:${x.y - x.size / 2}mm;width:${x.size}mm;height:${x.size}mm`;
  const h = x.size * LINE_HEIGHT * PT_MM * x.lines + 1;
  const left = x.align === 'left' ? x.x : x.align === 'right' ? x.x - x.maxWidth : x.x - x.maxWidth / 2;
  return `left:${left}mm;top:${x.y - h / 2}mm;width:${x.maxWidth}mm;height:${h}mm`;
}

function canvasHtml(){
  const t = ed.t, z = zoomOf(t);
  const g = ed.guide;
  return `<div style="width:${t.width_mm * MM_PX * z + 2}px;height:${t.height_mm * MM_PX * z + 2}px">
    <div class="nt-stage" style="transform:scale(${z});--nt-bg-opacity:${ed.bgOpacity}"><div class="nt-frame">
      ${ntCardHtml(t, sampleCard())}
      <div class="nt-safe" style="left:5mm;top:5mm;right:5mm;bottom:5mm"></div>
      ${t.print_offset.top ? `<div class="nt-cut" style="height:${t.print_offset.top}mm" title="프린터가 위 ${t.print_offset.top}mm를 못 찍어 판을 그만큼 내려 찍어요. 이 부분은 종이 밖으로 나가요"><span>종이 밖 ${t.print_offset.top}mm</span></div>` : ''}
      ${g.x ? `<div class="nt-guide" style="left:${t.width_mm / 2}mm;top:0;width:0.3mm;height:${t.height_mm}mm"></div>` : ''}
      ${g.y ? `<div class="nt-guide" style="top:${t.height_mm / 2}mm;left:0;height:0.3mm;width:${t.width_mm}mm"></div>` : ''}
      ${EL_KEYS.filter(k => t.layout[k].show).map(k => `<button type="button" class="nt-handle" data-k="${k}"
        aria-pressed="${ed.sel === k}" aria-label="${EL_LABEL[k]} 옮기기" title="${EL_LABEL[k]} — 끌어 옮기거나 방향키로" style="${handleBox(k)}"></button>`).join('')}
    </div></div></div>`;
}

function renderCanvas(){
  const c = document.getElementById('nt-ed-canvas');
  if(!c) return;
  c.innerHTML = canvasHtml();
  fitNametags(c);
  document.fonts?.ready.then(() => fitNametags(c));
  c.querySelectorAll('.nt-handle').forEach(h => {
    h.addEventListener('pointerdown', (e) => startDrag(e, h.dataset.k));
    h.addEventListener('keydown', (e) => onKey(e, h.dataset.k));
  });
  const st = document.getElementById('nt-ed-state');
  if(st) st.innerHTML = stateHtml();
  const cw = document.getElementById('nt-ed-cut');
  if(cw) cw.innerHTML = cutWarnHtml();
  const zl = document.getElementById('nt-ed-zoom');
  if(zl) zl.textContent = `${ed.t.width_mm} × ${ed.t.height_mm}mm · 화면 ${Math.round(zoomOf(ed.t) * 100)}%`;
}

/* 판을 위 여백만큼 내려 찍으면 아래 끝이 종이 밖으로 나간다 — 그 띠에 걸친 글자를 알려 준다 */
function cutWarnHtml(){
  const t = ed.t, cut = t.print_offset.top;
  if(!cut) return '';
  const hit = EL_KEYS.filter(k => {
    const x = t.layout[k];
    return x.show && x.y + (k === 'qr' ? x.size : x.size * LINE_HEIGHT * PT_MM * x.lines + 1) / 2 > t.height_mm - cut;
  });
  return hit.length ? `<div class="nt-warn">${hit.map(k => EL_LABEL[k]).join('·')}이(가) 아래 «종이 밖» 띠에 걸려 잘려요. 위로 올려 주세요.</div>` : '';
}

const stateHtml = () => ed.err ? `<span style="color:var(--re)">${escapeHtml(ed.err)}</span>`
  : dirty() ? '<span style="color:var(--am);font-weight:700">● 저장 안 됨</span>'
  : ed.msg ? `<span style="color:var(--g)">${escapeHtml(ed.msg)}</span>` : '';

function renderEditor(){
  const box = document.getElementById('nt-ed');
  if(!box || !ed.t) return;
  const t = ed.t, el = t.layout[ed.sel];
  const sizeVal = `${t.width_mm}x${t.height_mm}`;
  const people = ntPeople(ed.ev).slice(0, 30);
  const seg = (cur, list, fn) => `<div class="seg">${list.map(([k, l]) =>
    `<button type="button" class="seg-b${String(cur) === String(k) ? ' on' : ''}" onclick="${fn}(${typeof k === 'number' ? k : `'${k}'`})">${l}</button>`).join('')}</div>`;
  const off = t.print_offset;

  box.innerHTML = `<div class="nt-editor">
    <div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
        <b style="font-size:var(--fs-12_5)">네임택 판</b><span id="nt-ed-zoom" class="nt-note"></span>
        <div style="flex:1"></div>
        <select class="fi" style="width:auto" onchange="ntEdSample(this.value)" title="판 위에 놓아 볼 견본">
          ${SAMPLES.map(([k, l]) => `<option value="${k}"${ed.sample === k ? ' selected' : ''}>${l}</option>`).join('')}
          ${people.length ? `<optgroup label="이 행사 사람">${people.map(p => `<option value="p:${escAttr(p.key)}"${ed.sample === 'p:' + p.key ? ' selected' : ''}>${escapeHtml(p.nameKo || p.nameEn)} · ${escapeHtml(p.orgKo || p.orgEn)}</option>`).join('')}</optgroup>` : ''}
        </select>
      </div>
      <div class="nt-note" style="margin-bottom:8px">글자를 끌어서 옮기고, 고른 뒤 방향키로 1mm(Shift 0.1mm)씩 맞춰요. 가운데선 가까이 가면 자석처럼 붙어요. 점선은 가장자리 5mm 안전선이에요.</div>
      <div class="nt-stage-wrap" id="nt-ed-canvas"></div>
      <div id="nt-ed-cut"></div>
    </div>

    <div class="nt-panel">
      <section><h4>네임택 크기</h4>
        <select class="fi" onchange="ntEdSize(this.value)">
          ${SIZE_PRESETS.map(s => `<option value="${s.width_mm}x${s.height_mm}"${sizeVal === `${s.width_mm}x${s.height_mm}` ? ' selected' : ''}>${s.label}</option>`).join('')}
          ${SIZE_PRESETS.some(s => s.width_mm === t.width_mm && s.height_mm === t.height_mm) ? '' : `<option selected value="${sizeVal}">직접 입력 (${t.width_mm} × ${t.height_mm}mm)</option>`}
        </select>
        <div class="nt-row">
          <label><div class="mlbl">가로 mm</div><input class="fi" type="number" min="20" max="420" step="0.5" value="${t.width_mm}" onchange="ntEdPaper('width_mm',this.value)"></label>
          <label><div class="mlbl">세로 mm</div><input class="fi" type="number" min="20" max="420" step="0.5" value="${t.height_mm}" onchange="ntEdPaper('height_mm',this.value)"></label>
        </div>
        <label><div class="mlbl">출력 종이</div><select class="fi" onchange="ntEdSheet(this.value)">
          ${SHEET_OPTIONS.map(([k, l]) => `<option value="${k}"${t.sheet === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="nt-note">${t.sheet === 'fit'
          ? '인쇄 쪽 크기를 네임택 크기로 알려 줘요. 프린터가 이 크기를 안 받으면 A4 맨 위로 바꿔 주세요.'
          : `인쇄 대화상자에서는 A4로 두고, 네임택 종이를 그대로 넣어요. 쪽 맨 위 가운데에 찍혀요. 위 끝이 잘리면 인쇄 보정의 세로 값으로 내려 주세요.`}</div>
        <label><div class="mlbl">기본 말</div><select class="fi" onchange="ntEdLang(this.value)">
          ${LANG_OPTIONS.map(([k, l]) => `<option value="${k}"${t.lang === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      </section>

      <section><h4>하단바 종류 <span class="nt-note" style="font-weight:400">· 이 행사</span></h4>
        <div class="nt-note">투포켓 명찰 아래에 끼우는 색 띠예요. 발급 데스크 명단에 사람마다 어느 띠를 줄지 보여 주고, 인쇄 창에도 띄워요. 종이에는 찍지 않아요.</div>
        ${(t.bar_types || []).map((b, i) => `<div class="nt-row" style="align-items:center">
          <input type="color" value="${b.color}" onchange="ntEdBarSet(${i},'color',this.value)" title="띠 색" style="flex:none;width:36px;height:32px;padding:0;border:1px solid var(--i6);border-radius:var(--rs)">
          <input class="fi" value="${escAttr(b.label)}" maxlength="20" placeholder="예: VIP" oninput="ntEdBarSet(${i},'label',this.value)">
          <button type="button" class="btn bs" style="flex:none" onclick="ntEdBarDel(${i})" title="이 종류 빼기">빼기</button></div>`).join('')}
        <button type="button" class="btn bs" onclick="ntEdBarAdd()">＋ 하단바 종류</button>
      </section>

      <section><h4>배경 <span class="nt-note" style="font-weight:400">· 가늠자</span></h4>
        <div class="nt-note">네임택 용지를 찍거나 스캔해 올리면 글자를 어디에 놓을지 맞춰 볼 수 있어요.</div>
        <input class="fi" type="file" accept="image/png,image/jpeg,image/webp" onchange="ntEdBg(this.files[0])"${ed.busy ? ' disabled' : ''}>
        ${t.background_data ? `
          <label><div class="mlbl">미리보기 진하기 ${Math.round(ed.bgOpacity * 100)}%</div>
            <input type="range" min="10" max="100" value="${ed.bgOpacity * 100}" style="width:100%" oninput="ntEdBgOpacity(this.value)"></label>
          <label class="nt-check"><input type="checkbox"${t.background_print ? ' checked' : ''} onchange="ntEdBgPrint(this.checked)">
            <span>배경도 함께 인쇄 <span class="nt-note">· 꺼 두면 종이에는 글자만 찍혀요(기본)</span></span></label>
          ${bgRatioHtml()}
          <button type="button" class="btn bs" onclick="ntEdBgClear()">배경 빼기</button>` : ''}
      </section>

      <section><h4>글자 · 입장 QR</h4>
        <div class="nt-el-tabs">${EL_KEYS.map(k => `<button type="button" aria-pressed="${ed.sel === k}" data-hidden="${!t.layout[k].show}" onclick="ntEdSel('${k}')">${EL_LABEL[k]}</button>`).join('')}</div>
        <label class="nt-check"><input type="checkbox"${el.show ? ' checked' : ''} onchange="ntEdPatch({show:this.checked},true)"><span>${EL_LABEL[ed.sel]} 넣기</span></label>
        <div class="nt-row">
          <label><div class="mlbl">가로 위치 mm</div><input id="nt-ed-x" class="fi" type="number" step="0.5" value="${el.x}" onchange="ntEdPatch({x:+this.value})"></label>
          <label><div class="mlbl">세로 위치 mm</div><input id="nt-ed-y" class="fi" type="number" step="0.5" value="${el.y}" onchange="ntEdPatch({y:+this.value})"></label>
        </div>
        <button type="button" class="btn bs" onclick="ntEdPatch({x:${t.width_mm / 2}},true)">가로 가운데로</button>
        ${ed.sel === 'qr' ? `<div><div class="mlbl">QR 크기 mm</div><div class="nt-num">
          <button type="button" onclick="ntEdPatch({size:${Math.max(8, el.size - 1)}},true)" aria-label="작게">−</button>
          <input class="fi" type="number" min="8" max="120" step="1" value="${el.size}" onchange="ntEdPatch({size:+this.value},true)">
          <button type="button" onclick="ntEdPatch({size:${Math.min(120, el.size + 1)}},true)" aria-label="크게">+</button></div>
          <div class="nt-note">사람마다 «등록번호»를 담아요. 체크인 데스크에서 바코드 스캐너로 읽으면 바로 체크인돼요. 15mm보다 작으면 스캐너가 못 읽을 수 있어요.</div></div>` : `
        <div><div class="mlbl">글자 크기 pt</div><div class="nt-num">
          <button type="button" onclick="ntEdPatch({size:${Math.max(6, el.size - 1)}},true)" aria-label="작게">−</button>
          <input class="fi" type="number" min="6" max="120" step="1" value="${el.size}" onchange="ntEdPatch({size:+this.value},true)">
          <button type="button" onclick="ntEdPatch({size:${Math.min(120, el.size + 1)}},true)" aria-label="크게">+</button></div></div>
        <div><div class="mlbl">정렬</div>${seg(el.align, ALIGNS, 'ntEdAlign')}</div>
        <div><div class="mlbl">굵기</div>${seg(el.weight, [[400, '보통'], [700, '굵게']], 'ntEdWeight')}</div>
        <div><div class="mlbl">줄 수</div>${seg(el.lines, [[1, '한 줄'], [2, '두 줄']], 'ntEdLines')}
          <div class="nt-note">두 줄이면 긴 영문 이름이 줄을 바꿔 들어가요. 아래 글자와 겹치지 않게 자리를 넉넉히 두세요.</div></div>
        <label><div class="mlbl">글자 칸 너비 mm</div><input class="fi" type="number" min="5" max="420" step="1" value="${el.maxWidth}" onchange="ntEdPatch({maxWidth:+this.value},true)">
          <div class="nt-note">이 너비를 넘으면 줄을 바꾸거나 글자를 줄여 칸 안에 넣어요.</div></label>`}
      </section>

      <section><h4>인쇄 보정 <span class="nt-note" style="font-weight:400">· 행사 기본값</span></h4>
        <div class="nt-note">프린터마다 종이 먹는 자리가 달라요. 인쇄 창에서 PC마다 따로 고친 값이 있으면 그 값이 먼저예요.</div>
        <label><div class="mlbl">프린터가 못 찍는 위 여백 mm</div><input class="fi" type="number" min="0" max="15" step="0.5" value="${off.top}" onchange="ntEdOffset('top',this.value)"></label>
        <div class="nt-note">판을 이만큼 통째로 내려 찍어 위 끝이 잘리지 않아요. 대신 판 아래 같은 만큼이 종이 밖으로 나가요(판에 빗금). 0이면 내리지 않아요.</div>
        <div class="nt-row">
          <label><div class="mlbl">가로 mm</div><input class="fi" type="number" step="0.5" value="${off.x}" onchange="ntEdOffset('x',this.value)"></label>
          <label><div class="mlbl">세로 mm</div><input class="fi" type="number" step="0.5" value="${off.y}" onchange="ntEdOffset('y',this.value)"></label>
          <label><div class="mlbl">배율 %</div><input class="fi" type="number" step="1" value="${off.scale}" onchange="ntEdOffset('scale',this.value)"></label>
        </div>
      </section>

      <section class="nt-actions">
        <button type="button" class="btn bp" onclick="ntEdSave()"${ed.busy ? ' disabled' : ''}>저장</button>
        <button type="button" class="btn bs" onclick="ntEdTestPrint()" title="기록을 남기지 않고 견본 한 장을 인쇄 창으로">시험 인쇄</button>
        <button type="button" class="btn bs" onclick="ntEdReset()">글자 자리 되돌리기</button>
        <button type="button" class="btn bs" onclick="ntEdRevert()"${dirty() ? '' : ' disabled'}>저장한 판으로</button>
        <span id="nt-ed-state" class="nt-note"></span>
      </section>
      ${t.updated_at ? `<div class="nt-note">마지막 저장 ${escapeHtml(String(t.updated_at).slice(0, 16).replace('T', ' '))} UTC · ${escapeHtml(t.updated_by || '')}</div>` : '<div class="nt-note">아직 저장한 판이 없어 기본값(100 × 120mm)이에요.</div>'}
    </div>
  </div>`;
  renderCanvas();
}

/* 배경은 네임택에 꽉 차게(늘여서) 깐다 — 용지를 스캔한 그림이면 모서리가 곧 용지 모서리다.
   그래서 그림 비율이 네임택과 다르면 늘어나 보인다(1:1 그림을 100 × 120mm에 깔면 세로로 늘어난다).
   그때는 알려 주고, 그림 비율대로 네임택 크기를 맞추는 단추를 준다(가로는 두고 세로를 맞춘다) */
function bgRatioHtml(){
  const t = ed.t, d = ed.bgDim;
  if(!t.background_data) return '';
  if(!d || d.url !== t.background_data){
    const img = new Image();
    img.onload = () => { ed.bgDim = { url: t.background_data, w: img.naturalWidth, h: img.naturalHeight }; renderEditor(); };
    img.src = t.background_data;
    return '';
  }
  const want = Math.round(t.width_mm * d.h / d.w * 10) / 10;
  if(Math.abs(want - t.height_mm) / t.height_mm < 0.02) return '';
  const p = SIZE_PRESETS.find(s => s.width_mm === t.width_mm && Math.abs(s.height_mm - want) / want < 0.02);
  const h = p ? p.height_mm : want;
  return `<div class="nt-warn">배경 그림 비율(${d.w} × ${d.h}px)이 네임택(${t.width_mm} × ${t.height_mm}mm)과 달라 늘어나 보여요.
    <button type="button" class="btn bs" style="margin-top:6px" onclick="ntEdSize('${t.width_mm}x${h}')">네임택을 ${t.width_mm} × ${h}mm${p ? ` (${escapeHtml(p.label.replace(/^.*?\(|\)$/g, ''))})` : ''}로</button></div>`;
}

/* ── 끌기 · 방향키 ── */
/* 자석은 끌 때만 — 방향키에도 붙이면 가운데에서 1mm 옮기려 해도 도로 붙어 한 칸도 못 움직인다 */
function moveTo(key, x, y, magnet = true){
  const t = ed.t;
  x = magnet ? snap(round(x), t.width_mm / 2) : round(x);
  y = magnet ? snap(round(y), t.height_mm / 2) : round(y);
  ed.guide = { x: x === t.width_mm / 2, y: y === t.height_mm / 2 };
  t.layout[key] = { ...t.layout[key], x, y };
  ed.msg = ''; ed.err = '';
}
const syncXY = () => {
  const el = ed.t.layout[ed.sel];
  const xi = document.getElementById('nt-ed-x'), yi = document.getElementById('nt-ed-y');
  if(xi) xi.value = el.x;
  if(yi) yi.value = el.y;
};

function startDrag(e, key){
  if(ed.sel !== key){ ed.sel = key; renderEditor(); }
  const h = document.querySelector(`#nt-ed-canvas .nt-handle[data-k="${key}"]`);
  if(!h) return;
  e.preventDefault();
  h.setPointerCapture?.(e.pointerId);
  const z = zoomOf(ed.t);
  const start = { px: e.clientX, py: e.clientY, x: ed.t.layout[key].x, y: ed.t.layout[key].y };
  const toMm = (d) => d / (MM_PX * z);
  let raf = 0;
  const onMove = (ev) => {
    moveTo(key, start.x + toMm(ev.clientX - start.px), start.y + toMm(ev.clientY - start.py));
    if(!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      /* 판만 다시 그리면 손잡이가 새로 생겨 포인터를 놓친다 → 글자와 손잡이 자리만 옮긴다 */
      const c = document.getElementById('nt-ed-canvas');
      const card = c?.querySelector('.nt-card');
      if(card){ card.outerHTML = ntCardHtml(ed.t, sampleCard()); fitNametags(c); }
      h.setAttribute('style', handleBox(key));
      syncXY();
    });
  };
  const onUp = () => {
    h.removeEventListener('pointermove', onMove);
    h.removeEventListener('pointerup', onUp);
    h.removeEventListener('pointercancel', onUp);
    ed.guide = { x: false, y: false };
    renderCanvas();
    document.querySelector(`#nt-ed-canvas .nt-handle[data-k="${key}"]`)?.focus();
  };
  h.addEventListener('pointermove', onMove);
  h.addEventListener('pointerup', onUp);
  h.addEventListener('pointercancel', onUp);
}

function onKey(e, key){
  const step = e.shiftKey ? 0.1 : 1;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if(!d) return;
  e.preventDefault();
  ed.sel = key;
  const el = ed.t.layout[key];
  moveTo(key, el.x + d[0], el.y + d[1], false);
  ed.guide = { x: false, y: false };
  renderCanvas(); syncXY();
  document.querySelector(`#nt-ed-canvas .nt-handle[data-k="${key}"]`)?.focus();
}

/* ── 패널 ── */
const touched = () => { ed.msg = ''; ed.err = ''; };
export function ntEdSel(k){ ed.sel = k; renderEditor(); }
export function ntEdSample(v){ ed.sample = v; renderCanvas(); }
/* full: 패널도 다시 그린다(단추·체크 — 포커스를 잃어도 되는 것) */
export function ntEdPatch(p, full){
  ed.t.layout = normalizeLayout({ ...ed.t.layout, [ed.sel]: { ...ed.t.layout[ed.sel], ...p } });
  touched();
  if(full) renderEditor(); else renderCanvas();
}
export const ntEdAlign = (v) => ntEdPatch({ align: v }, true);
export const ntEdWeight = (v) => ntEdPatch({ weight: +v }, true);
export const ntEdLines = (v) => ntEdPatch({ lines: +v }, true);
/* 용지를 바꾸면 글자 자리를 새 용지 비율로 옮긴다 — 안 그러면 90×120 자리가 100×70 밖으로 나간다.
   가로 위치·칸 너비는 가로 비율, 세로 위치는 세로 비율. 글자 크기는 그대로 둔다(종이가 작아져도 이름은 읽혀야 한다) */
function resizePaper(w, h){
  const t = ed.t, kx = w / t.width_mm, ky = h / t.height_mm;
  const lay = {};
  TEXT_KEYS.forEach(k => { const e = t.layout[k]; lay[k] = { ...e, x: round(e.x * kx), y: round(e.y * ky), maxWidth: round(e.maxWidth * kx) }; });
  lay.qr = { ...t.layout.qr, x: round(t.layout.qr.x * kx), y: round(t.layout.qr.y * ky) };
  t.layout = normalizeLayout({ ...t.layout, ...lay });
  Object.assign(t, { width_mm: w, height_mm: h });
  touched(); renderEditor();
}
export function ntEdSize(v){
  const [w, h] = String(v).split('x').map(Number);
  if(w && h) resizePaper(w, h);
}
export function ntEdPaper(k, v){
  const n = Math.min(420, Math.max(20, Math.round(Number(v) * 10) / 10));
  if(!Number.isFinite(n)) return;
  resizePaper(k === 'width_mm' ? n : ed.t.width_mm, k === 'height_mm' ? n : ed.t.height_mm);
}
export function ntEdSheet(v){ ed.t.sheet = SHEETS.includes(v) ? v : 'a4'; touched(); renderEditor(); }
export function ntEdLang(v){ ed.t.lang = v; touched(); renderCanvas(); }
export function ntEdOffset(k, v){ ed.t.print_offset = normalizeOffset({ ...ed.t.print_offset, [k]: v }); touched(); renderCanvas(); }
/* 하단바 종류 — id는 처음 만들 때 한 번 정한다(사람마다 정해 둔 값이 id를 가리킨다). 이름·색은 언제든 바꾼다 */
export function ntEdBarAdd(){
  const l = ed.t.bar_types = ed.t.bar_types || [];
  if(l.length >= 20) return alert('하단바 종류는 20개까지예요.');
  l.push({ id: 'b' + Date.now().toString(36), label: '', color: BAR_COLORS[l.length % BAR_COLORS.length] });
  touched(); renderEditor();
}
export function ntEdBarSet(i, k, v){
  const b = (ed.t.bar_types || [])[i];
  if(!b) return;
  b[k] = k === 'label' ? String(v).slice(0, 20) : v;
  touched();
}
export function ntEdBarDel(i){
  const b = (ed.t.bar_types || [])[i];
  if(!b || !confirm(`하단바 «${b.label || '이름 없음'}»을 뺄까요?
이 띠로 정해 둔 사람은 «지운 종류»로 보여요. 저장해야 반영돼요.`)) return;
  ed.t.bar_types.splice(i, 1); touched(); renderEditor();
}
export function ntEdBgOpacity(v){ ed.bgOpacity = Math.max(0.1, Math.min(1, Number(v) / 100)); renderCanvas(); }
export function ntEdBgPrint(on){ ed.t.background_print = !!on; touched(); renderCanvas(); }
export function ntEdBgClear(){ Object.assign(ed.t, { background_data: null, background_print: false }); touched(); renderEditor(); }
export function ntEdReset(){
  if(!confirm('글자 자리·크기를 기본값으로 되돌릴까요? 저장하기 전까지는 판에 반영되지 않아요.')) return;
  ed.t.layout = normalizeLayout(DEFAULT_LAYOUT); touched(); renderEditor();
}
export function ntEdRevert(){ ed.t = JSON.parse(ed.saved); touched(); renderEditor(); }

/* 배경은 긴 변 1600px JPEG로 줄여 data URL로 — 서버는 2MB까지 받는다 */
export async function ntEdBg(file){
  if(!file) return;
  if(!/^image\/(png|jpeg|webp)$/.test(file.type)){ alert('PNG·JPG·WebP 이미지만 올릴 수 있어요.'); return; }
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, BG_EDGE / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(bmp, 0, 0, cv.width, cv.height);
    let q = 0.85, url = cv.toDataURL('image/jpeg', q);
    while(url.length > 1.9 * 1024 * 1024 && q > 0.4){ q -= 0.15; url = cv.toDataURL('image/jpeg', q); }
    ed.t.background_data = url; touched(); renderEditor();
  } catch(e){ alert('이미지를 읽지 못했어요 — ' + e.message); }
}

export async function ntEdSave(){
  if(ed.busy) return;
  if((ed.t.bar_types || []).some(b => !String(b.label || '').trim())) return alert('이름이 빈 하단바 종류가 있어요. 이름을 적거나 빼 주세요.');
  ed.busy = true; touched(); renderCanvas();
  try {
    const j = await saveNametagTemplate(ed.ev, ed.t);
    ed.t = normalizeTemplate(j.template);
    ed.saved = JSON.stringify(ed.t);
    ed.msg = '저장했어요. 발급 데스크에 바로 반영돼요.';
    ntTemplateSaved(ed.ev, ed.t);
  } catch(e){ ed.err = '저장하지 못했어요 — ' + e.message; }
  ed.busy = false;
  renderEditor();
}

/* 시험 인쇄 — 기록 없이 지금 고친 판(저장 전이어도)으로 견본 한 장 */
export function ntEdTestPrint(){
  const w = openPrintWindow();
  if(!w) return alert('인쇄 창이 막혔어요. 브라우저 주소창 오른쪽에서 이 사이트의 팝업을 허용해 주세요.');
  fillPrintWindow(w, ed.t, [sampleCard()]);
}

/* 설정 화면을 떠났다 돌아오면 서버 값을 다시 읽는다(데스크에서 용지만 바꿨을 수도 있다) — 고치던 것이 있으면 둔다 */
export function ntEdForget(){ if(!dirty()) ed.ev = ''; }
export const ntEdDirty = dirty;

Object.assign(window, { mountNametagEditor, ntEdSel, ntEdSample, ntEdPatch, ntEdAlign, ntEdWeight, ntEdLines, ntEdSize, ntEdPaper, ntEdSheet, ntEdLang,
  ntEdOffset, ntEdBarAdd, ntEdBarSet, ntEdBarDel, ntEdBgOpacity, ntEdBgPrint, ntEdBgClear, ntEdReset, ntEdRevert, ntEdBg, ntEdSave, ntEdTestPrint, ntEdForget });
