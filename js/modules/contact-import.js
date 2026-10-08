/* ══════════════════════════════════════════════════════════════
   contact-import.js — 옛 엑셀 TM/DM 기록을 차수로 가져오기

   지금까지 TM 현황은 엑셀에 적었다. 두 가지 모양이 있다:

   ㄱ. 짝 칸 — «TM일자 | TM내용»이 오른쪽으로 계속 늘어난다(2025 한국전자전).
       한 칸에 여러 번을 몰아 적었다:
         «주선신청 안내>계인_부재중 1106, 1725 / 예지_부재중_1324»
       «/»로 나누고, «계인_»에서 누가, «1106»에서 몇 시인지 읽는다.
       한 조각에 시각이 둘이면 두 번 건 것이다. 반응은 낱말로 짐작한다
       (부재중·없는 번호·불가·완료 …) — 가져오기 전에 미리보기로 확인한다.
   ㄴ. 차수 칸 — «TM_1차 … TM_4차»에 날짜, «긍정·보류·부정·부재중/오류» 칸에 표시,
       «진행 내용»에 메모(BIO KOREA 통합 DB). 마지막 차수에 결과를 붙이고, 그 앞은
       결과가 적혀 있지 않아 «부재중»으로 넣는다(다시 걸었다는 건 앞에서 안 끝났다는 뜻).
       «DM_1차 …»는 DM 보냄, «발송» 칸에 주소 오류·서버 거부가 있으면 반송.

   기업은 기업DB에서 이름으로 찾는다(법인 표기·띄어쓰기 무시, 옛 이름 포함).
   못 찾은 곳은 넣지 않고 목록으로 보여 준다 — 기업DB에 먼저 올린 뒤 다시 가져오면 된다.
   같은 파일을 두 번 가져와도 같은 기록(같은 곳·시각·반응·내용)은 한 번만 들어간다.
══════════════════════════════════════════════════════════════ */
import { CONTACT_ATTEMPTS, ROUND_MEMBERS } from '../state.js';
import { addRoundMembers, addAttempts, saveRoundMember } from '../api.js';
import { escapeHtml, nowStamp } from '../utils.js';
import { trackAction } from './audit-tab.js';
import { normalizeCompanyKey } from './company-tab.js';
import { REACTIONS, roundById, membersOf, coList, coOf, renderRoundNav } from './contact-tab.js';

/* ── 머리글 알아보기 ── 띄어쓰기·줄바꿈을 지우고 견준다 */
const norm = (v) => String(v ?? '').replace(/\s+/g, '').trim();
const HEAD = {
  org:     [/^(업체명|기업명|회사명|국문소속|기관명|국문기업명)$/, /^(organization|company)$/i, /^소속$/],
  source:  [/^구분$/],
  caution: [/^(비고|참고사항|주의사항|특이사항)$/],
  hours:   [/^(주요시간|시간|통화가능시간)$/],
  name:    [/^(성명|담당자|국문명|이름)$/, /^name$/i],
  title:   [/^(직위|직책|직함)$/],
  phone:   [/^(유선번호|전화|전화번호|phone|tel)$/i],
  mobile:  [/^(핸드폰번호|휴대폰|휴대전화|핸드폰|mobile)$/i],
  email:   [/^(이메일|email|e-mail|메일)$/i],
  note:    [/^(진행내용|TM내용|비고내용)$/i],
};
const isDateHead = (h) => /^(TM)?일자$/i.test(h);
const isTextHead = (h) => /내용$/.test(h);
const isTmHead   = (h) => /^TM[_-]?\d+차$/i.test(h);
const isDmHead   = (h) => /^DM[_-]?\d+차$/i.test(h);
const RESULT = { positive: /긍정/, hold: /보류/, negative: /부정/, noanswer: /부재|오류/ };
const findCol = (H, key, after = -1) => {
  for(const re of HEAD[key]){ const i = H.findIndex((h, k) => k > after && re.test(h)); if(i >= 0) return i; }
  return -1;
};

/* ── 반응 짐작 ── 순서가 중요하다(«없는 번호»가 «부정»보다 먼저) */
function guessReaction(t){
  const s = String(t || '');
  if(/없는\s*번호|유효하지\s*않|번호\s*(오류|틀림)|결번|잘못된\s*번호|없는번호/.test(s)) return 'wrongnum';
  if(/부재|안\s*받|받지\s*않|수신음|통화\s*중|연결\s*(이\s*)?(안|x|불가|어려)|전화\s*x/i.test(s)) return 'noanswer';
  if(/반송|틀린\s*(메일|이메일)|서버.*(거부|불가)|없는\s*(메일|이메일)/.test(s)) return 'bounce';
  // 신청·등록을 했다는 말이 있으면 뒤에 «거절»이 섞여도 긍정이다(«주선신청 했음. 바이어 신청건 거절»)
  if(/신청\s*(했|함|완)|등록\s*(했|함|완)|참여\s*예정|참가\s*예정/.test(s)) return 'positive';
  if(/거절|불참|불가능|참여\s*(불가|x|안)|참가\s*(불가|안)|관심\s*(x|없)|안\s*하겠|원치\s*않/i.test(s)) return 'negative';
  if(/완료|하겠다|긍정|진행\s*예정/.test(s)) return 'positive';
  return 'hold';
}

/* ── 날짜 읽기 ── Date · 엑셀 일련번호 · «2025-09-25» · «9/25» · «1015»(10월 15일) */
const pad = (n) => String(n).padStart(2, '0');
function toDay(v, year){
  if(v === null || v === undefined || v === '') return '';
  // Date는 쓰지 않는다 — cellDates로 읽으면 SheetJS가 하루 앞당겨 주는 일이 있어 일련번호를 직접 읽는다
  if(v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if(typeof v === 'number'){
    if(v > 20000 && window.XLSX?.SSF){ const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : ''; }
    const n = Math.round(v);
    if(n >= 101 && n <= 1231 && n % 100 >= 1 && n % 100 <= 31) return `${year}-${pad(Math.floor(n / 100))}-${pad(n % 100)}`;
    return '';
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if(m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[/.](\d{1,2})$/);
  if(m) return `${year}-${pad(m[1])}-${pad(m[2])}`;
  m = s.match(/^(\d{1,2})(\d{2})$/);
  if(m && +m[1] >= 1 && +m[1] <= 12) return `${year}-${pad(m[1])}-${m[2]}`;
  return '';
}

/* ── 한 칸 읽기(짝 칸 모양) ── «주선신청 안내>계인_부재중 1106, 1725 / 예지_부재중_1324» */
export function parseTmCell(text, day){
  const out = [];
  let caller = '', topic = '';
  // 한 칸 안에서 «/»나 줄바꿈으로 나눠 적었다
  const segs = String(text || '').split(/\s*(?:\/|\n)\s*/).map(s => s.trim()).filter(Boolean);
  segs.forEach((seg, i) => {
    // 담당자는 조각 맨 앞이나 «>» 바로 뒤의 «이름_» — «발송완료_1504»의 «송완료»를 사람으로 읽지 않게
    const c = seg.match(/(?:^|>\s*)([가-힣]{2,3})_/);
    const own = c && !/(완료|중|함|확인|안내|필요)$/.test(c[1]) ? c[1] : '';
    // 시각 — 네 자리, 전화번호 조각(앞에 «-»)이 아닌 것
    const times = [...seg.matchAll(/(?<![\d-])([01]\d|2[0-3])([0-5]\d)(?![\d-])/g)].map(m => `${m[1]}:${m[2]}`);
    /* «주선신청 안내»처럼 사람도 시각도 없는 조각이 뒤에 더 이어지면 제목이다 —
       기록으로 세지 않고 다음 조각들 앞에 붙인다 */
    if(!own && !times.length && i < segs.length - 1){ topic = topic ? `${topic}/${seg}` : seg; return; }
    if(own) caller = own;
    const reaction = guessReaction(seg);
    const note = topic && !seg.includes('>') ? `${topic}> ${seg}` : seg;
    (times.length ? times : ['00:00']).forEach(t => out.push({ at: `${day} ${t}`, by: caller, reaction, note, channel: 'TM' }));
  });
  return out;
}

/* ── 시트 읽기 ── */
function headerRow(rows){
  let best = -1, score = 0;
  rows.slice(0, 25).forEach((r, i) => {
    const H = r.map(norm);
    if(!H.some(h => HEAD.org.some(re => re.test(h)))) return;
    const sc = H.filter(h => h && (Object.values(HEAD).some(res => res.some(re => re.test(h))) || isDateHead(h) || isTextHead(h) || isTmHead(h) || isDmHead(h))).length;
    if(sc > score){ score = sc; best = i; }
  });
  return best;
}

export function analyzeSheet(rows){
  const hr = headerRow(rows);
  if(hr < 0) return null;
  const H = rows[hr].map(norm);
  const cols = {};
  Object.keys(HEAD).forEach(k => { cols[k] = findCol(H, k); });
  // 기업 칸이 둘이면(업체명 / 업체명(정렬용)) 앞의 것 — 정렬용은 HEAD에 걸리지 않는다
  const pairs = [];
  H.forEach((h, i) => { if(isDateHead(h) && isTextHead(H[i + 1] || '')) pairs.push([i, i + 1]); });
  const tm = H.map((h, i) => (isTmHead(h) ? i : -1)).filter(i => i >= 0);
  const dm = H.map((h, i) => (isDmHead(h) ? i : -1)).filter(i => i >= 0);
  const result = {};
  Object.entries(RESULT).forEach(([k, re]) => { const i = H.findIndex(h => re.test(h) && h.length <= 10); if(i >= 0) result[k] = i; });
  const dmStatus = H.findIndex(h => h === '발송');
  // 짝 칸의 «내용»을 메모 칸으로 잘못 잡지 않게
  if(pairs.some(([, t]) => t === cols.note)) cols.note = -1;
  // 연도 짐작 — 날짜 칸(일자·TM/DM 차수)에 보이는 해 중 가장 늦은 해. «1015»처럼 월일만 적은 칸에 붙인다
  let year = new Date().getFullYear(), seen = 0;
  const dayCols = [...pairs.map(([d]) => d), ...tm, ...dm];
  rows.slice(hr + 1).forEach(r => dayCols.forEach(i => {
    const v = r[i];
    if(typeof v === 'number' && v > 20000 && window.XLSX?.SSF){ const d = XLSX.SSF.parse_date_code(v); if(d) seen = Math.max(seen, d.y); }
    else { const m = String(v ?? '').match(/^(\d{4})[-./]/); if(m) seen = Math.max(seen, +m[1]); }
  }));
  if(seen) year = seen;
  return { hr, H, cols, pairs, tm, dm, result, dmStatus, year };
}

/* 시트 → 기업별 { name, rows[], attempts[] } */
export function extract(rows, a, opt){
  const { cols, pairs, tm, dm, result, dmStatus, year } = a;
  const orgCol = opt.orgCol ?? cols.org;
  const byOrg = new Map();
  rows.slice(a.hr + 1).forEach(r => {
    const name = String(r[orgCol] ?? '').trim();
    if(!name) return;
    if(!byOrg.has(name)) byOrg.set(name, { name, rows: [], attempts: [] });
    const g = byOrg.get(name);
    g.rows.push(r);
    const person = cols.name >= 0 ? String(r[cols.name] ?? '').trim() : '';
    const phone = [cols.mobile, cols.phone].filter(i => i >= 0).map(i => String(r[i] ?? '').trim()).find(v => v && v !== '-') || '';
    const email = cols.email >= 0 ? String(r[cols.email] ?? '').trim() : '';
    const push = (x) => g.attempts.push({ ...x, person, addr: x.channel === 'DM' ? email : phone });
    // ㄱ. 짝 칸
    pairs.forEach(([dc, tc]) => {
      const text = String(r[tc] ?? '').trim();
      const day = toDay(r[dc], year);
      if(!text || !day) return;
      parseTmCell(text, day).forEach(push);
    });
    // ㄴ. 차수 칸
    const tmDays = tm.map(i => toDay(r[i], year)).filter(Boolean);
    if(tmDays.length){
      const res = Object.keys(result).find(k => String(r[result[k]] ?? '').trim()) || '';
      const note = cols.note >= 0 ? String(r[cols.note] ?? '').trim() : '';
      let last = res || (note ? guessReaction(note) : 'hold');
      if(last === 'noanswer' && /번호/.test(note)) last = 'wrongnum';
      tmDays.forEach((d, k) => {
        const isLast = k === tmDays.length - 1;
        push({ at: `${d} 00:00`, by: '', channel: 'TM', reaction: isLast ? last : 'noanswer', note: isLast ? note : '' });
      });
    }
    const dmDays = dm.map(i => toDay(r[i], year)).filter(Boolean);
    const st = dmStatus >= 0 ? String(r[dmStatus] ?? '').trim() : '';
    dmDays.forEach((d, k) => {
      const bounced = k === dmDays.length - 1 && /틀린|없는|거부|불가|오류|반송/.test(st);
      push({ at: `${d} 00:00`, by: '', channel: 'DM', reaction: bounced ? 'bounce' : 'sent', note: bounced ? st : '' });
    });
  });
  return [...byOrg.values()];
}

/* ══════════════════════════════════════════
   창
══════════════════════════════════════════ */
let im = null;   // { rid, file, wb, sheet, rows, a, orgCol, goalCol, source, groups, match }

export function openRoundImport(rid){
  im = { rid, file: '', wb: null, sheet: '', rows: [], a: null, orgCol: null, goalCol: -1, source: '' };
  render();
}
const close = () => { document.getElementById('round-import')?.remove(); im = null; };
/* 시트를 표로 — 열은 앞 200개까지만 읽는다. 통합 DB 시트는 빈 열이 16,000개를 넘어
   통째로 읽으면 브라우저가 멈춘다 */
function sheetRows(name){
  const ws = im.wb.Sheets[name];
  if(!ws || !ws['!ref']) return [];
  const rg = XLSX.utils.decode_range(ws['!ref']);
  rg.e.c = Math.min(rg.e.c, 199);
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', range: rg });
}

export async function importPickFile(input){
  const f = input.files && input.files[0];
  if(!f || !im) return;
  try {
    const buf = await f.arrayBuffer();
    im.wb = XLSX.read(buf, { type: 'array' });   // cellDates는 쓰지 않는다 — toDay 참고
    im.file = f.name;
    // 알아본 머리글이 가장 많은 시트를 고른다(숨긴 시트는 뒤로)
    const scored = im.wb.SheetNames.map((n, i) => {
      const a = analyzeSheet(sheetRows(n));
      const hidden = im.wb.Workbook?.Sheets?.[i]?.Hidden ? 1 : 0;
      return { n, s: a ? (a.pairs.length * 3 + a.tm.length * 3 + a.dm.length + 1) - hidden * 100 : -999 };
    }).sort((x, y) => y.s - x.s);
    pickSheet(scored[0].n);
  } catch(e){
    alert(`엑셀을 읽지 못했어요: ${e.message}`);
  }
}
function pickSheet(n){
  im.sheet = n;
  im.rows = sheetRows(n);
  im.a = analyzeSheet(im.rows);
  im.orgCol = im.a ? im.a.cols.org : null;
  im.goalCol = -1;
  im.source = im.a && im.a.cols.source >= 0 ? '' : String(im.file).replace(/\.(xlsx|xls|csv)$/i, '').slice(0, 40);
  build();
  render();
}
export function importSet(k, v){
  if(!im) return;
  if(k === 'sheet') return pickSheet(v);
  if(k === 'orgCol' || k === 'goalCol') im[k] = +v;
  if(k === 'source'){ im.source = v; return; }   // 다시 그리지 않는다 — 치던 글자가 날아간다
  build(); render();
}

/* 기업DB에 대 보기 */
function build(){
  if(!im.a){ im.groups = []; return; }
  im.groups = extract(im.rows, im.a, { orgCol: im.orgCol });
  const idx = new Map();
  coList().forEach(c => [c.nameKo, c.nameEn, ...(c.aliases || []), ...(c.branches || [])].forEach(n => {
    const k = normalizeCompanyKey(n); if(k && !idx.has(k)) idx.set(k, c.key);
  }));
  im.groups.forEach(g => { g.orgId = idx.get(normalizeCompanyKey(g.name)) || null; });
}

function render(){
  if(!im) return;
  const r = roundById(im.rid);
  let el = document.getElementById('round-import');
  if(!el){
    el = document.createElement('div');
    el.id = 'round-import';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:1001;display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto';
    el.addEventListener('mousedown', e => { if(e.target === el) close(); });
    document.body.appendChild(el);
  }
  const a = im.a;
  const H = a ? a.H : [];
  const groups = im.groups || [];
  const ok = groups.filter(g => g.orgId), miss = groups.filter(g => !g.orgId);
  const atts = ok.flatMap(g => g.attempts);
  const byR = {}, byWho = {};
  atts.forEach(x => { byR[x.reaction] = (byR[x.reaction] || 0) + 1; const w = x.by || '(이름 없음)'; byWho[w] = (byWho[w] || 0) + 1; });
  const colOpt = (cur, none) => (none ? `<option value="-1"${cur < 0 ? ' selected' : ''}>${none}</option>` : '')
    + H.map((h, i) => h ? `<option value="${i}"${i === cur ? ' selected' : ''}>${escapeHtml(h)}</option>` : '').join('');
  const sample = ok.flatMap(g => g.attempts.map(x => ({ g, x }))).slice(0, 10);
  const fmt = a && [a.pairs.length ? `«일자/내용» 짝 ${a.pairs.length}개` : '', a.tm.length ? `TM 차수 칸 ${a.tm.length}개 + 결과 칸` : '', a.dm.length ? `DM 차수 칸 ${a.dm.length}개` : ''].filter(Boolean).join(' · ');

  el.innerHTML = `<div style="background:var(--W);border-radius:var(--rl);width:100%;max-width:760px;padding:18px 20px;box-shadow:var(--shl)">
    <div style="display:flex;align-items:center;margin-bottom:4px">
      <div style="font-size:15px;font-weight:700">옛 엑셀 기록 가져오기</div>
      <button class="btn bs" style="margin-left:auto" onclick="closeRoundImport()">닫기</button>
    </div>
    <div style="font-size:11.5px;color:var(--i4);margin-bottom:12px">${escapeHtml(r?.name || '')}에 넣습니다 · 같은 기록은 두 번 들어가지 않아요</div>
    <input type="file" accept=".xlsx,.xls,.csv" onchange="importPickFile(this)" style="font-size:12px;margin-bottom:10px">
    ${im.wb ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <label style="font-size:11px;color:var(--i3)">시트<select class="fi" onchange="importSet('sheet',this.value)">${im.wb.SheetNames.map(n => `<option${n === im.sheet ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></label>
        <label style="font-size:11px;color:var(--i3)">기업 칸<select class="fi" onchange="importSet('orgCol',this.value)">${colOpt(im.orgCol ?? -1, a ? '' : '—')}</select></label>
        <label style="font-size:11px;color:var(--i3)">목표 달성으로 볼 칸 (값이 있으면 달성)<select class="fi" onchange="importSet('goalCol',this.value)">${colOpt(im.goalCol, '없음')}</select></label>
        <label style="font-size:11px;color:var(--i3)">명단 이름${a && a.cols.source >= 0 ? ' — 비우면 «구분» 칸 값' : ''}<input class="fi" value="${escapeHtml(im.source)}" oninput="importSet('source',this.value)"></label>
      </div>
      ${!a ? '<div style="font-size:12px;color:var(--re)">이 시트에서 기업 칸(업체명·기업명·국문소속 …)을 못 찾았어요. 다른 시트를 골라 보세요.</div>' : `
      <div style="font-size:11.5px;color:var(--i3);margin-bottom:8px">머리글 ${a.hr + 1}행 · ${fmt || '<span style="color:var(--re)">TM 기록 칸을 못 찾았어요</span>'}
        ${a.cols.caution >= 0 ? ` · 주의사항 «${escapeHtml(H[a.cols.caution])}»` : ''}${a.cols.hours >= 0 ? ` · 통화 시간 «${escapeHtml(H[a.cols.hours])}»` : ''}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;margin-bottom:8px">
        ${[['기업DB에서 찾음', `${ok.length}곳`], ['못 찾음', `${miss.length}곳`], ['가져올 기록', `${atts.length}건`]].map(([l, v]) =>
          `<div style="border:1px solid var(--i6);border-radius:var(--r);padding:7px 10px"><div style="font-size:10.5px;color:var(--i4)">${l}</div><div style="font-size:16px;font-weight:700">${v}</div></div>`).join('')}
      </div>
      <div style="font-size:11.5px;margin-bottom:4px">반응 — ${Object.entries(byR).map(([k, n]) => `<span class="pill ${REACTIONS[k]?.cls || 'p-gray'}" style="margin-right:3px">${escapeHtml(REACTIONS[k]?.label || k)} ${n}</span>`).join('') || '없음'}</div>
      <div style="font-size:11.5px;margin-bottom:8px;color:var(--i3)">담당 — ${Object.entries(byWho).map(([k, n]) => `${escapeHtml(k)} ${n}`).join(' · ') || '없음'}</div>
      ${sample.length ? `<div style="border:1px solid var(--i7);border-radius:var(--rs);max-height:220px;overflow:auto;margin-bottom:8px">
        <table style="width:100%;border-collapse:collapse;font-size:11px">${sample.map(({ g, x }) => `<tr style="border-bottom:1px solid var(--i8)">
          <td style="padding:4px 6px;white-space:nowrap">${escapeHtml(g.name)}</td><td style="padding:4px 6px;white-space:nowrap;color:var(--i4)">${escapeHtml(x.at)}</td>
          <td style="padding:4px 6px;white-space:nowrap">${escapeHtml(x.by)}</td><td style="padding:4px 6px"><span class="pill ${REACTIONS[x.reaction]?.cls || 'p-gray'}">${escapeHtml(REACTIONS[x.reaction]?.label || '')}</span></td>
          <td style="padding:4px 6px;color:var(--i3)">${escapeHtml(x.note)}</td></tr>`).join('')}</table></div>
        <div style="font-size:10.5px;color:var(--i4);margin:-4px 0 8px">반응은 내용의 낱말로 짐작했어요(앞 10건). 가져온 뒤 카드에서 고칠 수 있어요.</div>` : ''}
      ${miss.length ? `<details style="margin-bottom:8px"><summary style="cursor:pointer;font-size:11.5px;color:var(--am)">기업DB에 없는 ${miss.length}곳 — 넣지 않아요</summary>
        <div style="font-size:11px;color:var(--i3);padding:6px 4px;line-height:1.7">${miss.map(g => escapeHtml(g.name)).join(' · ')}</div>
        <div style="font-size:10.5px;color:var(--i4)">설정 › 데이터 업로드로 기업DB에 먼저 올린 뒤 다시 가져오면 들어가요.</div></details>` : ''}
      <button class="btn bp" onclick="commitRoundImport()" ${ok.length ? '' : 'disabled'} id="ri-go">${ok.length}곳 · 기록 ${atts.length}건 가져오기</button>
      <span id="ri-msg" style="font-size:11px;color:var(--i4);margin-left:6px"></span>`}` : ''}
  </div>`;
}

export async function commitRoundImport(){
  if(!im || !im.groups) return;
  const r = roundById(im.rid);
  const btn = document.getElementById('ri-go');
  const msg = (t, good) => { const m = document.getElementById('ri-msg'); if(m){ m.style.color = good ? 'var(--g)' : 'var(--re)'; m.textContent = t; } };
  if(btn) btn.disabled = true;
  const { cols } = im.a;
  const existing = new Map(membersOf(r.id).map(m => [m.org_id, m]));
  const newMembers = [], patches = [], attempts = [];
  const now = nowStamp();
  let seq = 0;
  const cell = (row, i) => (i >= 0 ? String(row[i] ?? '').trim() : '');
  im.groups.filter(g => g.orgId).forEach(g => {
    const first = g.rows[0];
    const srcCell = cell(first, cols.source);
    const caution = [...new Set(g.rows.map(x => cell(x, cols.caution)).filter(Boolean))].join(' / ');
    // 통화 가능 시간 — 같은 이름의 칸에 타임스탬프가 든 시트가 있다(날짜면 버린다)
    const hv = first[cols.hours];
    const hours = hv instanceof Date || typeof hv === 'number' ? '' : cell(first, cols.hours);
    const goalHit = im.goalCol >= 0 && g.rows.some(x => { const v = cell(x, im.goalCol); return v && !/^(x|-|0|n|no|아니오|미)$/i.test(v); });
    const lastDay = g.attempts.map(x => x.at.slice(0, 10)).sort().pop() || now.slice(0, 10);
    let m = existing.get(g.orgId);
    if(!m){
      m = { id: `RM-${Date.now()}_${seq++}`, round_id: r.id, org_id: g.orgId, org_name: coOf(g.orgId)?.nameKo || g.name,
        source: im.source.trim() || srcCell || '엑셀 가져오기', caution, hold_until: '', call_hours: hours,
        next_at: '', goal_at: goalHit ? lastDay : '', closed_at: '', closed_reason: '', created_at: now };
      newMembers.push(m);
    } else {
      const p = {};
      if(caution && !m.caution) p.caution = caution;
      if(hours && !m.call_hours) p.call_hours = hours;
      if(goalHit && !m.goal_at) p.goal_at = lastDay;
      if(Object.keys(p).length) patches.push([m, p]);
    }
    // 같은 기록은 한 번만 — 이미 있는 것과 이번 파일 안의 겹침 둘 다
    const seen = new Set(CONTACT_ATTEMPTS.filter(x => x.member_id === m.id).map(x => `${x.at}|${x.reaction}|${x.note}`));
    const people = coOf(g.orgId)?.contacts || [];
    g.attempts.forEach(x => {
      const k = `${x.at}|${x.reaction}|${x.note}`;
      if(seen.has(k)) return;
      seen.add(k);
      const pn = x.person.replace(/\s+/g, '');
      const p = pn && people.find(c => [c.nameKo, c.nameEn].some(n => String(n || '').replace(/\s+/g, '') === pn));
      attempts.push({ id: `CA-${Date.now()}_${seq++}`, round_id: r.id, member_id: m.id, org_id: g.orgId,
        contact_id: p ? String(p.id) : '', contact_name: x.person, phone: x.addr, channel: x.channel, at: x.at,
        by_email: '', by_name: x.by || '엑셀 기록', reaction: x.reaction, note: x.note });
    });
  });
  if(!newMembers.length && !patches.length && !attempts.length){ msg('새로 넣을 것이 없어요 — 이미 다 들어 있어요.', true); return; }
  msg('넣는 중…', true);
  if(newMembers.length){
    const res = await addRoundMembers(newMembers);
    if(!res.ok){ msg('명단을 넣지 못했어요. 다시 시도해 주세요.'); if(btn) btn.disabled = false; return; }
    ROUND_MEMBERS.push(...newMembers);
  }
  for(const [m, p] of patches){ if((await saveRoundMember({ id: m.id, ...p })).ok) Object.assign(m, p); }
  if(attempts.length){
    const res = await addAttempts(attempts);
    if(!res.ok){ msg(`명단 ${newMembers.length}곳은 넣었고 기록은 못 넣었어요. 다시 가져오면 기록만 들어가요.`); if(btn) btn.disabled = false; window.renderCrm?.(); renderRoundNav(); return; }
    CONTACT_ATTEMPTS.push(...attempts);
  }
  trackAction('add', '컨택 기록 가져옴', r.name,
    `«${escapeHtml(im.file)}»에서 ${escapeHtml(r.name)}으로 — 명단 ${newMembers.length}곳 새로, 기록 ${attempts.length}건`);
  msg(`명단 ${newMembers.length}곳 새로 · 기록 ${attempts.length}건 넣었어요`, true);
  window.renderCrm?.(); renderRoundNav();
  build(); render();
  msg(`명단 ${newMembers.length}곳 새로 · 기록 ${attempts.length}건 넣었어요`, true);
}

Object.assign(window, { openRoundImport, closeRoundImport: close, importPickFile, importSet, commitRoundImport });
