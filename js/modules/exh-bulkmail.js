/* ══════════════════════════════════════════════════════════════
   exh-bulkmail.js — 여러 참가사에 같은 안내를 한 번에

   «매뉴얼 보냈나», «그래픽 마감 안내 다 돌렸나»는 기업 수십 곳에 같은 메일을
   보내는 일이다. 한 통에 모두를 수신으로 넣으면 서로의 주소가 보이고, 기록도
   기업마다 남지 않는다. 그래서 기업마다 따로 한 통씩 보내고 그 기업 기록에 남긴다.

   - 받는 곳: 지금 전시 목록에서 걸러 보고 있는 기업(visibleList) 중 체크한 곳.
     보낼 차례인 곳이 미리 골라진다(exhMailState). 부스 변경 안내는 알린 부스와 지금
     부스가 다른 곳만 잡힌다(exh-mail.js boothChange)
   - 다시 보내기(개정판): «↻ 이미 받은 곳에 다시 보내기»로 발송 묶음(EXH_CFG.exhMailRounds)을
     연다. 그 순간 이미 받았거나 끝낸 곳이 대상이 되고, 다 보내면 묶음이 저절로 닫힌다
   - 보내기 전: 기업마다 넘겨 보는 미리보기, «나에게 먼저 1통»(기록에 안 남는 시험 발송)
   - 문구: 전시 메일 양식(exh-mail.js)의 단계 문구. 여기서 고친 문구는 이번 발송에만 쓴다
   - 언어: 기업별 자동(기업DB 국가) / 모두 국문 / 모두 영문
   - 받는 사람: 메인 담당자만 / 메일 있는 담당자 모두 / 첨부: 그 단계의 기본 첨부
   - 기업별 사진: PC 폴더를 고르면 하위 폴더(기업명 또는 부스 번호)마다 그 기업 메일에
     사진을 붙인다. 못 맞춘 폴더는 손으로 기업을 고른다. 사진은 보낼 때 줄여서(긴 변 1600px JPEG)
     한 통 3MB(서버 LOCAL_MAX) 안에 넣는다. 폴더는 서버에 올리지 않고 이번 발송에만 쓴다.
     사진은 첨부가 아니라 본문(html, cid)에 넣는다 — 문구의 {사진} 자리, 없으면 맨 끝
══════════════════════════════════════════════════════════════ */
import { EXH_LOGS, EXHIBITORS, EXH_CFG, currentUser, logsFor } from '../state.js';
import { sendMail, eventMailFrom, loadMailFiles, mailFilesOf, saveExhCfgToSheet } from '../api.js';
import { escapeHtml, escAttr, nowStamp } from '../utils.js';
import { normalizeCompanyKey } from './company-tab.js';
import { visibleList, exhNames, exhContacts, exhMailCtx, exhLocked, exhLockNotice, STEPS, cellState } from './exh-tab.js';
import { exhMailSteps, exhIsEnglish, fillExhTemplate, exhMailFileStep, boothChange, exhStepVariants } from './exh-mail.js';
import { libItems, libItem } from './mail-templates.js';
import { followState } from './follow-up.js';
import { trackAction } from './audit-tab.js';
import { varChipsHtml } from './var-chips.js';
import { aiDraftHtml, registerAiDraft } from './ai-mail-draft.js';
import './exh-mail-editor.js';

let bm = null;   // { evKey, ids:Set, step, variant, lang, who, tpl, sending, pi, failed:Set, photos }
const isLib = (key) => String(key || '').startsWith('lib:');

/* ── 기업별 사진 폴더 ──
   bm.photos = { root, folders: [{ name, files:[File], exId }] } — 폴더 하나가 기업 하나.
   고른 폴더 바로 아래에 사진이 있으면(하위 폴더 없음) 파일 이름 하나를 폴더 하나로 본다 */
const IMG_RE = /\.(jpe?g|png|webp|gif|bmp|heic)$/i;
const PHOTO_MAX = 3 * 1024 * 1024;   // 서버 LOCAL_MAX — PC에서 고른 첨부는 한 통에 합쳐서 3MB
const keyOf = (s) => normalizeCompanyKey(String(s || '').replace(/[_\-]+/g, ' '));
const boothKey = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
/* «10-11. DreamCIS»처럼 부스 번호를 앞에 붙인 이름은 번호와 기업명을 나눠 본다 */
const PREFIX_RE = /^\s*([0-9A-Za-z]+(?:\s*[-~,]\s*[0-9A-Za-z]+)*)\s*[.)]\s+(.+)$/;
function matchFolder(name, xs){
  const m = String(name || '').match(PREFIX_RE);
  if(m){
    const byName = matchFolder(m[2], xs);
    if(byName) return byName;
    const nums = m[1].split(/\s*[-~,]\s*/).map(boothKey);
    const r = xs.filter(x => x.booth_no && nums.some(n => boothKey(x.booth_no) === n || boothKey(x.booth_no).replace(/^[a-z]+-?/, '') === n));
    if(r.length === 1) return r[0].id;
  }
  const k = keyOf(name), b = boothKey(name);
  if(!k) return '';
  const hit = (f) => xs.filter(f);
  // 이름이 같은 곳 → 부스 번호가 같은 곳 → 폴더 이름에 기업명이 들어 있는 곳 (하나일 때만)
  for(const f of [
    x => [exhNames(x).ko, exhNames(x).en, x.company_name].some(n => n && keyOf(n) === k),
    x => x.booth_no && boothKey(x.booth_no) === b,
    x => [exhNames(x).ko, exhNames(x).en].some(n => { const nk = keyOf(n); return nk.length >= 2 && k.includes(nk); }),
    x => x.booth_no && boothKey(x.booth_no).length >= 2 && b.includes(boothKey(x.booth_no)),
  ]){ const r = hit(f); if(r.length === 1) return r[0].id; if(r.length > 1) return ''; }
  return '';
}
const photosOf = (id) => (bm?.photos?.folders || []).filter(f => f.exId === id).flatMap(f => f.files);

/* 사진을 줄여 base64로 — 긴 변 side px JPEG. 못 읽는 형식(HEIC 등)은 원본 그대로 */
async function shrink(file, side, q){
  try{
    const img = await createImageBitmap(file);
    const r = Math.min(1, side / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    img.close?.();
    const data = c.toDataURL('image/jpeg', q).split(',')[1];
    return { filename: file.name.replace(/\.[^.]+$/, '') + '.jpg', content_type: 'image/jpeg', data, size: Math.floor(data.length * 3 / 4) };
  }catch(e){
    const data = await new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = no; fr.readAsDataURL(file); });
    return { filename: file.name, content_type: file.type || 'application/octet-stream', data, size: file.size };
  }
}
/* 한 기업의 사진 첨부 — 3MB를 넘으면 더 작게 다시 줄인다. 그래도 넘으면 error */
/* top — 맨 위 공통 이미지(이미 줄인 것). 3MB 안에 함께 센다 */
async function photoAttachments(id, top){
  const files = photosOf(id);
  const topSize = top ? top.size : 0;
  const strip = ({ size, ...a }) => a;
  if(!files.length) return topSize > PHOTO_MAX ? { error: '맨 위 이미지가 3MB를 넘어요' } : { list: [], top: top && strip(top) };
  for(const [side, q] of [[1600, .82], [1200, .75], [900, .7]]){
    const list = [];
    for(const f of files) list.push(await shrink(f, side, q));
    if(topSize + list.reduce((n, a) => n + a.size, 0) <= PHOTO_MAX) return { list: list.map(strip), top: top && strip(top) };
  }
  return { error: `사진 ${files.length}장${top ? '과 맨 위 이미지' : ''}가 줄여도 3MB를 넘어요 — 사진 수를 줄여 주세요` };
}

export function bmPhotoPick(input){
  if(!bm || bm.sending) return;
  const all = [...(input.files || [])].filter(f => IMG_RE.test(f.name));
  input.value = '';
  if(!all.length){ alert('고른 폴더에 사진(jpg·png 등)이 없어요.'); return; }
  const groups = new Map();
  let root = '';
  for(const f of all){
    const parts = String(f.webkitRelativePath || f.name).split('/');
    root = root || (parts.length > 1 ? parts[0] : '');
    const name = parts.length > 2 ? parts[1] : f.name.replace(/\.[^.]+$/, '');
    if(!groups.has(name)) groups.set(name, []);
    groups.get(name).push(f);
  }
  const xs = eventExhibitors();
  const folders = [...groups].map(([name, files]) => ({ name, files, exId: matchFolder(name, xs) }))
    .sort((a, b) => (!!b.exId - !!a.exId) || a.name.localeCompare(b.name, 'ko'));
  bm.photos = { root, folders };
  render();
}
export function bmPhotoAssign(i, exId){ if(!bm?.photos || bm.sending) return; bm.photos.folders[i].exId = exId; render(); }
export function bmPhotoClear(){ if(!bm || bm.sending) return; bm.photos = null; render(); }

function photoBlockHtml(){
  const p = bm.photos;
  if(!p) return `<div style="margin-top:8px;font-size:11px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <label class="btn" style="font-size:10.5px;cursor:pointer">📷 기업별 사진 폴더 고르기
        <input type="file" webkitdirectory multiple style="display:none" onchange="bmPhotoPick(this)"></label>
      <span style="color:var(--i4)">폴더 안 하위 폴더 이름(기업명 또는 부스 번호)으로 기업을 찾아 그 기업 메일에만 붙여요</span></div>`;
  const xs = eventExhibitors().slice().sort((a, b) => exhNames(a).ko.localeCompare(exhNames(b).ko, 'ko'));
  const ok = p.folders.filter(f => f.exId), miss = p.folders.filter(f => !f.exId);
  const opts = (cur) => `<option value="">— 기업 고르기 —</option>${xs.map(x => `<option value="${escAttr(x.id)}"${x.id === cur ? ' selected' : ''}>${escapeHtml(exhNames(x).ko)}${x.booth_no ? ` (${escapeHtml(x.booth_no)})` : ''}</option>`).join('')}`;
  return `<div style="margin-top:8px;padding:7px 9px;border:1px solid var(--i6);border-radius:7px;font-size:11px">
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <b>📷 기업별 사진</b><span style="color:var(--i4)">${escapeHtml(p.root || '고른 폴더')} · 짝 맞음 ${ok.length}곳${miss.length ? ` · <span style="color:var(--am)">못 맞춘 폴더 ${miss.length}개</span>` : ''}</span>
      <span style="margin-left:auto;display:flex;gap:4px">
        <button class="btn" style="font-size:10px" onclick="bmAll('photo')" title="사진이 짝 맞은 기업만 고릅니다">사진 있는 곳만</button>
        <button class="btn" style="font-size:10px" onclick="bmPhotoClear()">빼기</button></span></div>
    <details${miss.length ? ' open' : ''} style="margin-top:4px"><summary style="cursor:pointer;color:var(--i3)">폴더별 짝 보기·고치기</summary>
      <div style="max-height:180px;overflow:auto;margin-top:4px">${p.folders.map((f, i) => `<div style="display:flex;gap:6px;align-items:center;padding:2px 0">
        <span style="flex:0 0 40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escAttr(f.name)}">📁 ${escapeHtml(f.name)} <span style="color:var(--i4)">${f.files.length}장</span></span>
        <select class="fi" style="font-size:10.5px;flex:1;${f.exId ? '' : 'border-color:var(--am)'}" onchange="bmPhotoAssign(${i},this.value)" ${bm.sending ? 'disabled' : ''}>${opts(f.exId)}</select></div>`).join('')}</div></details>
  </div>`;
}

const close = () => { document.getElementById('exh-bulkmail')?.remove(); bm = null; };
const mailsOf = (x, who) => {
  const ppl = exhContacts(x).filter(p => p.email);
  const pick = who === 'primary' ? [ppl.find(p => p.primary) || ppl[0]].filter(Boolean) : ppl;
  const out = [...new Set(pick.map(p => String(p.email).trim()).filter(Boolean))];
  if(who !== 'rest') return out;
  const got = gotMails(x);
  return out.filter(m => !got.has(m.toLowerCase()));
};
/* 이 메일(같은 단계·같은 제목 묶음)을 이미 받은 주소 — «아직 못 받은 담당자만»에서 뺀다.
   기타 안내·보관함 양식은 kind가 모두 'note'라 카테고리(단계 이름)까지 맞춘다 */
function gotMails(x){
  const st = curStep();
  const kind = !st ? '' : bm.step === 'note' || st.lib ? 'note' : `exh-${bm.step}`;
  const out = new Set();
  logsFor(x.id).filter(l => l.direction !== 'in' && l.kind === kind && (kind !== 'note' || l.category === st.label))
    .forEach(l => String(l.counterpart || '').replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, (m) => { out.add(m.toLowerCase()); return m; }));
  return out;
}
/* ── 이 기업에게 이 메일이 지금 보낼 차례인가 ──
   기본 단계는 진행 체크리스트의 그 칸(due 키 = STEPS 키)을 본다 — 매뉴얼은 «매뉴얼 회신»,
   신청서는 «신청서 접수»처럼 기업에서 받아야 끝나는 칸이다.
     done    그 칸이 끝났거나 해당 없음 → 보내지 않는다
     late    요청을 보냈는데 기다린 만큼 기다렸다(follow-up.js) → 리마인더 보낼 차례
     sent    보냈고 아직 기다리는 중 → 고르지 않는다
     due     아직 안 보냈다 → 보낼 차례
     resend  다시 보내기 묶음의 대상인데 묶음을 연 뒤 아직 다시 안 보냈다 → 보낼 차례
     na      해당 없음(부스 변경 안내인데 부스가 그대로인 곳)
   더한 단계는 칸이 없으니 이 단계 메일을 보낸 기록만 본다. «기타 안내»는 차례가 없다(free). */
const sentOf = (x, key, since) => logsFor(x.id).some(l => l.kind === `exh-${key}` && l.direction !== 'in'
  && (!since || String(l.ts || '') >= since));
/* 요청한 단계의 기다림·리마인더 — 기업에서 받아야 끝나는 단계를 요청했는데 아직 안 왔으면.
   공은 기업에 있지만, 날이 차면 리마인더가 우리 일이다(follow-up.js). 끝났거나 아직 안 보냈으면 null */
export function exhFollowOf(x, st){
  if(!st || st.custom || st.lib || st.key === 'note' || st.key === 'booth_change') return null;
  const step = st.due && STEPS.find(s => s.key === st.due);
  if(!step) return null;
  const c = cellState(x, step);
  if(c.state === 'done' || c.state === 'na') return null;
  const logs = logsFor(x.id);
  const sends = logs.filter(l => l.kind === `exh-${st.key}` && l.direction !== 'in').map(l => l.ts);
  if(!sends.length) return null;
  const f = followState({ evKey: x.event_id, sends, due: ((EXH_CFG[x.event_id] || {}).due || {})[st.due], logs, stepKey: st.key });
  return f.state === 'ask' ? null : f;
}

function baseState(x, st){
  if(st.key === 'booth_change') return boothChange(x).changed ? 'due' : 'na';
  const sent = sentOf(x, st.key);
  if(st.custom) return sent ? 'sent' : 'due';
  const step = st.due && STEPS.find(s => s.key === st.due);
  if(step){
    const c = cellState(x, step);
    if(c.state === 'done' || c.state === 'na') return c.state === 'na' ? 'na' : 'done';
    if(sent){ const f = exhFollowOf(x, st); return f && f.state === 'nudge' ? 'late' : 'sent'; }
    return 'due';
  }
  return sent ? 'sent' : 'due';
}
export function exhMailState(x, st){
  if(!st || st.key === 'note' || st.lib) return 'free';
  if(st.round && (st.round.targets || []).includes(x.id)) return sentOf(x, st.key, st.round.since) ? 'sent' : 'resend';
  return baseState(x, st);
}
const isTurn = (s) => s === 'due' || s === 'late' || s === 'resend';
const STATE_PILL = {
  due:    '<span class="pill p-amber" style="font-size:9.5px">보낼 차례</span>',
  resend: '<span class="pill p-amber" style="font-size:9.5px">다시 보낼 차례</span>',
  late:   '<span class="pill p-amber" style="font-size:9.5px">🔔 리마인더 보낼 때</span>',
  sent:   '<span class="pill p-blue" style="font-size:9.5px">⏳ 요청함·기다림</span>',
  done:   '<span class="pill p-green" style="font-size:9.5px">끝남</span>',
  na:     '<span class="pill p-gray" style="font-size:9.5px">해당 없음</span>',
  free: '',
};
/* 지금 고른 메일 — 보관함 양식이면 단계 모양으로 바꿔 돌려준다(차례가 없어 «기타 안내»처럼 다룬다) */
const curStep = () => {
  if(isLib(bm.step)){ const it = libItem(bm.step.slice(4)); return it ? { ...it, key: bm.step, label: it.name, due: '', lib: true } : null; }
  return exhMailSteps(bm.evKey).find(s => s.key === bm.step);
};
/* 보낼 차례이고 메일 받을 사람이 있는 기업 */
function pickTurn(){
  const st = curStep();
  const list = shownList().filter(x => mailsOf(x, bm.who).length);
  bm.ids = new Set((!st || st.key === 'note' || st.lib ? list : list.filter(x => isTurn(exhMailState(x, st)))).map(x => x.id));
  bm.pi = 0;
}
const enOf = (x) => bm.lang === 'en' ? true : bm.lang === 'ko' ? false : exhIsEnglish(x);
/* 목록 필터 — 국문으로 갈 곳 / 영문으로 갈 곳만 보기. «전체»·«보낼 차례만»·«사진 있는 곳만»도 보이는 곳 안에서 고른다 */
const shownList = () => visibleList().filter(x => !bm.langF || (enOf(x) ? 'en' : 'ko') === bm.langF);
export function bmLangF(v){ if(!bm || bm.sending) return; bm.langF = v; render(); }

/* stepKey를 주면 그 단계가 골라진 채로 연다(전시 메일 단계 편집 창의 «📨 여러 기업에») */
export async function openExhBulkMail(stepKey){
  const list = visibleList();
  if(!list.length){ alert('지금 전시 목록에 기업이 없어요 — 전시 탭에서 행사를 열고 보내 주세요.'); return; }
  const evKey = list[0].event_id;
  const steps = exhMailSteps(evKey);
  if(!steps.length){ alert('이 행사에 켜진 메일 단계가 없어요.'); return; }
  const st = steps.find(s => s.key === stepKey) || steps[0];
  bm = { evKey, ids: new Set(), step: st.key, variant: '', lang: 'auto', who: 'primary', tpl: pickTpl(evKey, st.key),
    sending: false, pi: 0, failed: new Set() };
  pickTurn();
  await loadMailFiles(evKey);
  render();
}
/* 처음 채울 문구 — 보관함 양식, 고른 변형, 아니면 단계 문구 */
/* «✨ AI로 초안 쓰기» — 여러 기업에 같은 틀. 회사명·담당자 대신 변수가 든 틀을 받아 국문·영문 문구에 넣는다 */
registerAiDraft('exbulk', () => {
  if(!bm) return null;
  const st = curStep() || {};
  const n = bm.ids.size;
  return { part: 'exh', ev: bm.evKey, lang: 'both', reply: false, step: { ...st, ...bm.tpl }, stepLabel: st.label,
    state: [`여러 참가기업${n ? `(${n}곳)` : ''}에 같은 틀로 한꺼번에 보냄 — 기업마다 {기업}·{담당자}·{부스} 같은 변수가 채워짐`],
    apply(tpl){ const next = { ...bm.tpl }; for(const k of ['subject_ko', 'body_ko', 'subject_en', 'body_en']) if(tpl[k]) next[k] = tpl[k]; bm.tpl = next; render(); } };
});
function pickTpl(evKey, key, variant){
  const st = isLib(key) ? (libItem(key.slice(4)) || {}) : (exhMailSteps(evKey).find(s => s.key === key) || {});
  const v = variant ? exhStepVariants(evKey, key).find(x => x.id === variant) : null;
  const src = v || st;
  return { subject_ko: src.subject_ko || st.subject_ko || '', body_ko: src.body_ko || st.body_ko || '',
    subject_en: src.subject_en || st.subject_en || '', body_en: src.body_en || st.body_en || '' };
}
/* 본문의 {사진} 자리 — fillExhTemplate가 이 표시로 채우고, 여기서 사진(html)이나 안내(글)로 바꾼다 */
const PHOTO_MARK = '⟦사진⟧';
const SEND_GAP = 20;   // 통 사이 쉬는 초 — sendExhBulkMail
function mailFor(x){
  const st = curStep();
  const en = enOf(x), ctx = { ...exhMailCtx(x), photoMark: PHOTO_MARK };
  const again = exhFollowOf(x, st) ? (en ? '[Reminder] ' : '[리마인더] ') : '';   // 이미 요청한 곳은 리마인더
  const raw = fillExhTemplate(bm.tpl[en ? 'body_en' : 'body_ko'], x, st, en, ctx);
  const n = photosOf(x.id).length;
  const note = n ? (en ? `(${n} photo${n > 1 ? 's' : ''} below)` : `(사진 ${n}장)`) : '';
  const evName = fillExhTemplate('{행사}', x, st, en, ctx);
  const firm = fillExhTemplate('{기업}', x, st, en, ctx);
  // 이미지 대체 문구 — 이미지를 안 띄우는 메일 프로그램과 스팸 필터가 읽는 글
  const alt = { top: en ? `${evName} Thank-you letter` : `${evName} 감사 서한`,
    photo: (i) => en ? `${firm} booth photo ${i + 1}` : `${firm} 부스 사진 ${i + 1}` };
  let body = raw.split(PHOTO_MARK).join(note).replace(/\n{3,}/g, '\n\n').trim();
  // 글 없이 이미지만이면 글자 본문이 비지 않게 — 이미지만 든 메일은 스팸으로 잡히기 쉽다
  if(bannerOf(en) && !body.replace(/\(.*?\)/g, '').trim()) body = `${alt.top}\n${body}`.trim();
  if(footerText()) body += `\n\n${footerPlain()}`;
  return { subject: again + fillExhTemplate(bm.tpl[en ? 'subject_en' : 'subject_ko'], x, st, en, ctx),
    raw, body, en, alt };
}
/* 사진이 든 html 본문 — srcs[i]는 i번째 사진 주소(보낼 때 cid:, 미리보기 때 blob:).
   {사진}이 없으면 본문 맨 끝에 넣는다. alt는 mailFor의 대체 문구 */
function bodyHtml(raw, srcs, top, alt){
  const a = (s) => alt ? ` alt="${escAttr(s)}"` : '';
  const imgs = srcs.map((s, i) => `<img src="${s}"${a(alt && alt.photo(i))} style="display:block;max-width:100%;width:640px;height:auto;margin:8px 0;border-radius:4px">`).join('');
  const txt = (s) => escapeHtml(s).replace(/\n/g, '<br>');
  const parts = String(raw).split(PHOTO_MARK);
  const inner = parts.length > 1 ? parts.map(txt).join(imgs) : txt(raw) + (imgs ? `<br>${imgs}` : '');
  const head = top ? `<img src="${top}"${a(alt && alt.top)} style="display:block;max-width:100%;width:640px;height:auto;margin:0 0 12px">` : '';
  return `<div style="font-family:'Malgun Gothic',Arial,sans-serif;font-size:14px;line-height:1.6;color:#222">${head}${inner}${footerHtml()}</div>`;
}
/* ── 맨 아래 푸터(사무국 주소·연락처) — 행사 설정(EXH_CFG[행사].mailFooter)에 한 번 적어 두면
   이 행사의 모든 메일 맨 끝(사진 아래)에 붙는다. **굵게** · *기울임* · www.·http 주소는 링크 ── */
const footerText = () => String((EXH_CFG[bm?.evKey] || {}).mailFooter || '').trim();
const footerPlain = () => footerText().replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
function footerHtml(){
  const t = footerText();
  if(!t) return '';
  const line = (l) => escapeHtml(l)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/\b((?:https?:\/\/|www\.)[^\s<]+)/g, (u) => `<a href="${u.startsWith('www.') ? 'https://' + u : u}" style="color:#1a0dab">${u}</a>`);
  return `<div style="margin-top:20px;font-family:Arial,sans-serif;font-size:12px;line-height:1.45;color:#222">${t.split('\n').map(line).join('<br>')}</div>`;
}
export async function bmFooterSave(){
  if(!bm || bm.sending) return;
  const el = document.getElementById('bm-footer');
  if(!el) return;
  if(exhLocked()){ exhLockNotice(); return; }
  const prev = EXH_CFG[bm.evKey];
  EXH_CFG[bm.evKey] = { ...(prev || {}), mailFooter: el.value.trim() };
  const r = await saveExhCfgToSheet(bm.evKey, EXH_CFG[bm.evKey]);
  if(r && r.ok === false){
    if(prev) EXH_CFG[bm.evKey] = prev; else delete EXH_CFG[bm.evKey];
    alert('저장하지 못했어요. 네트워크 확인 후 다시 시도해주세요.');
    return;
  }
  render();
}
/* 참조(CC) — 행사 설정(EXH_CFG[행사].mailCc). 실제 발송에만 붙고 시험 발송에는 안 붙는다 */
const ccText = () => String((EXH_CFG[bm?.evKey] || {}).mailCc || '');
const splitMails = (v) => String(v || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
const ccList = () => splitMails(ccText());
export async function bmCcSave(v){
  if(!bm || bm.sending) return;
  const list = splitMails(v);
  const bad = list.filter(s => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  if(bad.length){ alert(`메일 주소 모양이 아니에요: ${bad.join(', ')}`); return; }
  if(exhLocked()){ exhLockNotice(); return; }
  const prev = EXH_CFG[bm.evKey];
  EXH_CFG[bm.evKey] = { ...(prev || {}), mailCc: list.join(', ') };
  const r = await saveExhCfgToSheet(bm.evKey, EXH_CFG[bm.evKey]);
  if(r && r.ok === false){
    if(prev) EXH_CFG[bm.evKey] = prev; else delete EXH_CFG[bm.evKey];
    alert('저장하지 못했어요. 네트워크 확인 후 다시 시도해주세요.');
  }
  render();
}
function footerBlockHtml(){
  const t = footerText();
  return `<details style="margin-top:8px;font-size:11px"${t ? '' : ' open'}>
    <summary style="cursor:pointer">📌 맨 아래 푸터 ${t ? '— 저장됨, 모든 메일 끝(사진 아래)에 붙어요' : '— 없음'}</summary>
    <textarea id="bm-footer" rows="9" style="width:100%;margin-top:4px;font-size:11px;font-family:inherit">${escapeHtml(t)}</textarea>
    <div style="display:flex;gap:6px;align-items:center;margin-top:3px;flex-wrap:wrap">
      <button class="btn" style="font-size:10.5px" onclick="bmFooterSave()">푸터 저장</button>
      <span style="color:var(--i4)">이 행사 메일에 계속 쓰여요 · **굵게** *기울임* · www. 주소는 링크</span></div></details>`;
}
/* ── 맨 위 공통 이미지(감사장 등) — 모든 기업에 같은 이미지. 국문·영문을 따로 고를 수 있고
   영문을 안 고르면 국문 것을 쓴다. 긴 변 1400px로 줄인다(글씨가 든 이미지라 사진보다 크게) ── */
const bannerOf = (en) => bm?.banner ? ((en && bm.banner.en) || bm.banner.ko || bm.banner.en || null) : null;
export function bmBannerPick(input, lang){
  if(!bm || bm.sending) return;
  const f = [...(input.files || [])].find(f => IMG_RE.test(f.name));
  input.value = '';
  if(!f){ alert('이미지 파일(jpg·png 등)을 골라주세요.'); return; }
  bm.banner = { ...(bm.banner || {}), [lang]: f };
  render();
}
export function bmBannerClear(){ if(!bm || bm.sending) return; bm.banner = null; render(); }
function bannerBlockHtml(){
  const b = bm.banner || {};
  const pick = (lang, l) => `<label class="btn" style="font-size:10.5px;cursor:pointer">${b[lang] ? `✓ ${l}: ${escapeHtml(b[lang].name)}` : `${l} 고르기`}
      <input type="file" accept="image/*" style="display:none" onchange="bmBannerPick(this,'${lang}')"></label>`;
  return `<div style="margin-top:8px;font-size:11px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
    <b>🖼 맨 위 공통 이미지</b>${pick('ko', '국문용')}${pick('en', '영문용')}
    ${bm.banner ? '<button class="btn" style="font-size:10px" onclick="bmBannerClear()">빼기</button>' : ''}
    <span style="color:var(--i4)">감사장처럼 모두에게 같은 이미지 — 본문 맨 위에 들어가요. 영문용이 없으면 국문용을 써요</span></div>`;
}
const thumbCache = new WeakMap();
const thumbOf = (f) => { if(!thumbCache.has(f)) thumbCache.set(f, URL.createObjectURL(f)); return thumbCache.get(f); };
/* 보낼 메일 한 통 — 사진이 있으면 본문(html)에 넣고 cid 첨부로 붙인다 */
async function buildMail(x){
  const m = mailFor(x);
  const top = bannerOf(m.en);
  const ph = await photoAttachments(x.id, top ? await shrink(top, 1400, .85) : null);
  if(ph.error) return { error: ph.error };
  if(!ph.list.length && !ph.top) return { ...m, html: footerText() ? bodyHtml(m.raw, [], null, m.alt) : undefined, attachments: [] };
  const stamp = Date.now().toString(36);
  const attachments = ph.list.map((a, i) => ({ ...a, cid: `p${i}.${stamp}@bloom` }));
  const head = ph.top ? { ...ph.top, cid: `top.${stamp}@bloom` } : null;
  return { ...m, html: bodyHtml(m.raw, attachments.map(a => `cid:${a.cid}`), head && `cid:${head.cid}`, m.alt),
    attachments: head ? [head, ...attachments] : attachments };
}

/* ── 다시 보내기 묶음 — 행사 설정(EXH_CFG[행사].exhMailRounds). 단계당 하나만 열린다 ── */
async function pushRounds(fn){
  if(exhLocked()){ exhLockNotice(); return false; }
  const prev = EXH_CFG[bm.evKey] ? JSON.parse(JSON.stringify(EXH_CFG[bm.evKey])) : undefined;
  const cfg = JSON.parse(JSON.stringify(prev || {}));
  cfg.exhMailRounds = cfg.exhMailRounds || [];
  if(fn(cfg.exhMailRounds) === false) return false;
  // 닫힌 묶음은 최근 20개만 — «언제 무엇을 다시 돌렸나»는 기업 기록에 남아 있다
  cfg.exhMailRounds = [...cfg.exhMailRounds.filter(r => r.closed_at).slice(-20), ...cfg.exhMailRounds.filter(r => !r.closed_at)];
  EXH_CFG[bm.evKey] = cfg;
  const r = await saveExhCfgToSheet(bm.evKey, cfg);
  if(r && r.ok === false){
    if(prev) EXH_CFG[bm.evKey] = prev; else delete EXH_CFG[bm.evKey];
    alert('저장하지 못했어요. 네트워크 확인 후 다시 시도해주세요.');
    return false;
  }
  return true;
}
const eventExhibitors = () => EXHIBITORS.filter(x => x.event_id === bm.evKey);
function roundProgress(st){
  const r = st && st.round;
  if(!r) return null;
  const ids = new Set(r.targets || []);
  const xs = eventExhibitors().filter(x => ids.has(x.id));
  return { r, total: xs.length, done: xs.filter(x => sentOf(x, st.key, r.since)).length };
}
export async function startExhRound(){
  if(!bm || bm.sending) return;
  const st = curStep();
  if(!st) return;
  /* 이미 받았거나 끝낸 곳 — 아직 안 받은 곳은 평소대로 «보낼 차례»라 묶음에 넣지 않는다 */
  const targets = eventExhibitors().filter(x => ['sent', 'late', 'done'].includes(baseState(x, st))).map(x => x.id);
  if(!targets.length){ alert(`«${st.label}»을 이미 받은 곳이 없어요 — 다시 보낼 곳이 없습니다.`); return; }
  const label = (prompt(`이미 «${st.label}»을 받은 ${targets.length}곳에 다시 보냅니다.\n이번 묶음의 이름 (예: 매뉴얼 개정판)`, `${st.label} 개정판`) || '').trim();
  if(!label) return;
  const ok = await pushRounds(list => {
    list.push({ id: `R-${Date.now().toString(36)}`, step: st.key, label, since: nowStamp(), targets,
      by: currentUser?.name || currentUser?.email || '' });
  });
  if(!ok) return;
  trackAction('add', '참가사 다시 보내기', bm.evKey, `«${st.label}» 묶음 «${label}» ${targets.length}곳`);
  pickTurn();
  render();
}
export async function closeExhRound(silent){
  if(!bm) return;
  const st = curStep();
  if(!st || !st.round) return;
  if(!silent){
    const p = roundProgress(st);
    if(!confirm(`다시 보내기 묶음 «${st.round.label}»을 닫을까요?${p && p.done < p.total ? `\n\n아직 ${p.total - p.done}곳에 다시 안 보냈어요. 닫으면 그 기업들은 평소 상태로 돌아갑니다.` : ''}`)) return;
  }
  const ok = await pushRounds(list => { const r = list.find(x => x.id === st.round.id); if(!r) return false; r.closed_at = nowStamp(); });
  if(!ok) return;
  trackAction('edit', '참가사 다시 보내기', bm.evKey, `«${st.label}» 묶음 «${st.round.label}» 닫음`);
  pickTurn();
  render();
}

function render(){
  if(!bm) return;
  const list = visibleList();
  const steps = exhMailSteps(bm.evKey);
  const st = curStep();
  const libs = libItems('exh', bm.evKey);
  const vs = st && !st.lib ? exhStepVariants(bm.evKey, st.key) : [];
  const files = mailFilesOf(bm.evKey).filter(f => f.step === exhMailFileStep(bm.step));
  const picked = list.filter(x => bm.ids.has(x.id));
  const rp = roundProgress(st);
  const failedN = [...bm.failed].filter(id => list.some(x => x.id === id)).length;
  const opt = (v, cur, l) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
  let el = document.getElementById('exh-bulkmail');
  if(!el){
    el = document.createElement('div');
    el.id = 'exh-bulkmail';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div style="background:var(--W);border-radius:12px;width:min(1240px,100%);max-height:94vh;overflow:auto;padding:16px 18px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <div style="font-size:14px;font-weight:700">여러 기업에 메일</div>
      <span style="font-size:11px;color:var(--i4)">기업마다 한 통씩 따로 보내고 그 기업 기록에 남깁니다</span>
      <button class="drcls" style="margin-left:auto" onclick="closeExhBulkMail()">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px">
      <div><div class="mlbl">무슨 메일인가</div><select class="fi" onchange="bmSet('step',this.value)" ${bm.sending ? 'disabled' : ''}>${steps.map(s => { const n = s.key === 'note' ? 0 : list.filter(x => isTurn(exhMailState(x, s))).length;
          return opt(s.key, bm.step, escapeHtml(s.label) + (s.round ? ' ↻' : '') + (n ? ` — 보낼 차례 ${n}곳` : '')); }).join('')}
        ${libs.length ? `<optgroup label="양식 보관함">${libs.map(it => opt(`lib:${escAttr(it.id)}`, bm.step, escapeHtml(it.name))).join('')}</optgroup>` : ''}</select>
        ${vs.length ? `<div style="display:flex;gap:6px;align-items:center;margin-top:5px;font-size:11px"><span style="color:var(--i4)">양식</span>
          <select class="fi" style="font-size:11.5px;flex:1" onchange="bmSet('variant',this.value)">
            ${opt('', bm.variant, '기본 문구')}${vs.map(v => opt(escAttr(v.id), bm.variant, escapeHtml(v.label))).join('')}</select></div>` : ''}</div>
      <div><div class="mlbl">언어</div><select class="fi" onchange="bmSet('lang',this.value)">${opt('auto', bm.lang, '기업별 자동 (해외는 영문)')}${opt('ko', bm.lang, '모두 국문')}${opt('en', bm.lang, '모두 영문')}</select></div>
      <div><div class="mlbl">받는 사람</div><select class="fi" onchange="bmSet('who',this.value)">${opt('primary', bm.who, '메인 담당자만')}${opt('all', bm.who, '메일 있는 담당자 모두')}${opt('rest', bm.who, '아직 못 받은 담당자만')}</select></div>
    </div>
    ${roundBarHtml(st, rp)}
    ${st && st.key === 'booth_change' ? `<div style="font-size:10.5px;color:var(--i4);margin:-4px 0 8px">알린 부스(그 기업에 마지막으로 보낸 메일의 «부스 번호:» 줄)와 지금 부스가 다른 곳만 잡혀요. 보내면 새 번호가 «알린 부스»가 됩니다.</div>` : ''}
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:16px">
      <div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap">
          <div class="mlbl" style="margin:0">받는 기업 <b style="color:var(--i1)">${picked.length}</b>/${list.length}${
            picked.length ? ` <span style="font-weight:400;color:var(--i4)">(국문 ${picked.filter(x => !enOf(x)).length} · 영문 ${picked.filter(enOf).length})</span>` : ''}</div>
          <span style="margin-left:auto;display:flex;gap:4px">
            ${failedN ? `<button class="btn" style="font-size:10px;color:var(--re)" onclick="bmAll('failed')">실패한 ${failedN}곳만</button>` : ''}
            ${st && st.key !== 'note' ? `<button class="btn" style="font-size:10px" onclick="bmAll('turn')" title="보이는 기업 중 이 메일이 보낼 차례인 곳만 고릅니다">보낼 차례만</button>` : ''}
            <button class="btn" style="font-size:10px" onclick="bmAll(true)" title="보이는 기업을 모두 고릅니다">전체</button>
            <button class="btn" style="font-size:10px" onclick="bmAll(false)">해제</button></span>
        </div>
        <div style="display:flex;gap:4px;margin-bottom:6px;font-size:11px">
          ${[['', '전체', list.length], ['ko', '🇰🇷 국문으로 갈 곳', list.filter(x => !enOf(x)).length], ['en', '🌐 영문으로 갈 곳', list.filter(enOf).length]].map(([v, l, n]) =>
            `<button class="btn" style="font-size:10.5px;padding:3px 10px;${(bm.langF || '') === v ? 'background:var(--i1);color:var(--W);border-color:var(--i1)' : ''}" onclick="bmLangF('${v}')">${l} ${n}</button>`).join('')}
        </div>
        <div style="border:1px solid var(--i6);border-radius:8px;max-height:calc(94vh - 230px);min-height:300px;overflow:auto">
          ${shownList().map(x => { const ms = mailsOf(x, bm.who); const bc = st && st.key === 'booth_change' ? boothChange(x) : null;
            const np = photosOf(x.id).length, en = enOf(x);
            return `<label style="display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:2px 8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--i8);cursor:${ms.length ? 'pointer' : 'default'};opacity:${ms.length ? 1 : .45}">
            <input type="checkbox" style="grid-row:span 2" ${bm.ids.has(x.id) ? 'checked' : ''} ${ms.length && !bm.sending ? '' : 'disabled'} onchange="bmPick('${escAttr(x.id)}',this.checked)">
            <div style="display:flex;gap:6px;align-items:center;min-width:0">
              <span style="font-size:9.5px;font-weight:700;padding:0 5px;border-radius:4px;flex:0 0 auto;${en ? 'background:#e8f0fe;color:#1a56c4' : 'background:var(--i8);color:var(--i3)'}">${en ? 'EN' : 'KO'}</span>
              <b style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(exhNames(x).ko)}</b>${
              bc && bc.changed ? `<span style="font-size:10px;color:var(--am);flex:0 0 auto">${escapeHtml(bc.from)} → ${escapeHtml(bc.to)}</span>` : ''}</div>
            <div style="display:flex;gap:4px;align-items:center;justify-content:flex-end">${STATE_PILL[exhMailState(x, st)] || ''}${
              bm.photos ? (np ? `<span style="font-size:10px;color:var(--i3)">📷 ${np}</span>` : '<span style="font-size:10px;color:var(--am)">사진 없음</span>') : ''}${
              bm.failed.has(x.id) ? '<span class="pill p-red" style="font-size:9.5px;background:var(--rb);color:var(--re)">실패</span>' : ''}</div>
            <div style="grid-column:2 / 4;font-size:10.5px;color:var(--i4);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ms.length ? escapeHtml(ms.join(', ')) : '메일 있는 담당자 없음'}</div>
          </label>`; }).join('') || '<div style="padding:14px;font-size:11px;color:var(--i4)">이 필터에 맞는 기업이 없어요.</div>'}
        </div>
      </div>
      <div>
        ${aiDraftHtml('exbulk')}
        <details${bm.lang !== 'en' ? ' open' : ''}><summary style="cursor:pointer;font-size:11.5px;font-weight:700;margin-bottom:4px">국문 문구</summary>
          <input class="fi" style="font-size:11.5px;margin-bottom:4px" value="${escAttr(bm.tpl.subject_ko)}" oninput="bmTpl('subject_ko',this.value)">
          <textarea class="fi" rows="7" style="font-size:11.5px;width:100%" oninput="bmTpl('body_ko',this.value)">${escapeHtml(bm.tpl.body_ko)}</textarea></details>
        <details${bm.lang === 'en' ? ' open' : ''} style="margin-top:6px"><summary style="cursor:pointer;font-size:11.5px;font-weight:700;margin-bottom:4px">영문 문구</summary>
          <input class="fi" style="font-size:11.5px;margin-bottom:4px" value="${escAttr(bm.tpl.subject_en)}" oninput="bmTpl('subject_en',this.value)">
          <textarea class="fi" rows="7" style="font-size:11.5px;width:100%" oninput="bmTpl('body_en',this.value)">${escapeHtml(bm.tpl.body_en)}</textarea></details>
        ${varChipsHtml('exh', { ev: bm.evKey })}
        <div style="font-size:10.5px;color:var(--i4);margin-top:4px">칸은 기업마다 채워집니다. 여기서 고친 문구는 이번 발송에만 쓰고, 기본 문구와 단계는
          <a href="#" onclick="openExhMailEditor('${escAttr(bm.evKey)}','${escAttr(bm.step)}');return false">✎ 단계 편집</a>에서 고칩니다.</div>
        ${files.length ? `<div style="font-size:11px;margin-top:6px">기본 첨부 ${files.map(f => `<span class="pill p-blue" style="margin:2px 3px 0 0">📎 ${escapeHtml(f.filename)}</span>`).join('')}</div>` : ''}
        ${bannerBlockHtml()}
        ${photoBlockHtml()}
        ${footerBlockHtml()}
        <div id="bm-prev">${prevHtml(picked)}</div>
      </div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;margin-top:10px;font-size:11px;flex-wrap:wrap">
      <b>참조(CC)</b>
      <input id="bm-cc" value="${escAttr(ccText())}" placeholder="예: info-kic@konect.or.kr (여러 개는 쉼표)" onchange="bmCcSave(this.value)"
        style="flex:1;min-width:220px;font-size:11px" ${bm.sending ? 'disabled' : ''}>
      <span style="color:var(--i4)">기업마다 가는 메일에 모두 참조로 들어가요 · 이 행사에 저장 · 시험 발송엔 안 붙어요</span>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap">
      <button class="btn bp" onclick="sendExhBulkMail()" ${picked.length && !bm.sending ? '' : 'disabled'}>${picked.length}곳에 보내기</button>
      <button class="btn" onclick="sendExhTestMail()" ${picked.length && !bm.sending ? '' : 'disabled'}
        title="미리보기 중인 기업의 메일을 내 주소(또는 적은 주소)로 한 통 보냅니다 — 기록에 남지 않아요">나에게 먼저 1통</button>
      <button class="btn" onclick="sendExhTestMail(true)" ${picked.length > 1 && !bm.sending ? '' : 'disabled'}
        title="고른 기업 메일을 모두 내 주소(또는 적은 주소)로 보냅니다 — 제목 앞에 [시험·기업명], 기록에 남지 않아요">고른 ${picked.length}곳 모두 나에게</button>
      <span id="bm-msg" style="font-size:11px;color:var(--i4)"></span>
    </div>
  </div>`;
}

function roundBarHtml(st, rp){
  if(!st || st.lib || st.key === 'note' || st.key === 'booth_change') return '';
  if(rp) return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:-2px 0 10px;padding:7px 10px;border:1px solid var(--am);border-radius:8px;font-size:11px">
      <b style="color:var(--am)">↻ 다시 보내기 «${escapeHtml(rp.r.label)}»</b>
      <span style="color:var(--i3)">다시 보냄 ${rp.done}/${rp.total}곳</span>
      <span style="color:var(--i4)">· ${escapeHtml(rp.r.since)} 시작${rp.r.by ? ` · ${escapeHtml(rp.r.by)}` : ''}</span>
      <span style="color:var(--i4)">— 묶음을 열 때 이미 받았던 곳이 대상이에요(진행 칸이 끝난 곳 포함). 다 보내면 저절로 닫혀요.</span>
      <button class="btn" style="font-size:10px;margin-left:auto" onclick="closeExhRound()">묶음 닫기</button></div>`;
  return `<div style="margin:-2px 0 10px"><button class="btn" style="font-size:10.5px" onclick="startExhRound()"
      title="이 메일을 이미 받았거나 끝낸 곳에 개정판을 다시 보냅니다 — 지금 이 순간이 기준이 됩니다">↻ 이미 받은 곳에 다시 보내기 (개정판)</button></div>`;
}

/* 기업마다 넘겨 보는 미리보기 */
function prevHtml(picked){
  if(!picked.length) return '<div style="margin-top:10px;font-size:11px;color:var(--i4)">기업을 고르면 미리보기가 보여요.</div>';
  const i = ((bm.pi % picked.length) + picked.length) % picked.length;
  const x = picked[i], m = mailFor(x);
  return `<div style="margin-top:10px;padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;font-size:11.5px;line-height:1.55">
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;font-size:10.5px;color:var(--i4)">
      <button class="btn" style="font-size:10px;padding:1px 7px" onclick="bmPrev(-1)">◀</button>
      <span>${i + 1}/${picked.length}</span>
      <button class="btn" style="font-size:10px;padding:1px 7px" onclick="bmPrev(1)">▶</button>
      <b style="color:var(--i2)">${escapeHtml(exhNames(x).ko)}</b>${m.en ? ' (영문)' : ''}
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">→ ${escapeHtml(mailsOf(x, bm.who).join(', '))}</span>
    </div>
    ${photosOf(x.id).length || bannerOf(m.en) || footerText()
      ? `<div style="max-height:420px;overflow:auto;background:#fff;padding:6px;border-radius:5px"><b>${escapeHtml(m.subject)}</b><br><br>${
          bodyHtml(m.raw, photosOf(x.id).map(thumbOf), bannerOf(m.en) && thumbOf(bannerOf(m.en)), m.alt).replace(/width:640px/g, 'width:320px')}</div>`
      : `<div style="white-space:pre-wrap;max-height:240px;overflow:auto"><b>${escapeHtml(m.subject)}</b>\n\n${escapeHtml(m.body)}</div>`}
    ${bm.photos ? `<div style="margin-top:6px;font-size:10.5px;${photosOf(x.id).length ? '' : 'color:var(--am)'}">${photosOf(x.id).length
      ? `📷 본문에 ${photosOf(x.id).length}장 — ${photosOf(x.id).map(f => escapeHtml(f.name)).join(', ')}${/\{사진\}/.test(bm.tpl[m.en ? 'body_en' : 'body_ko']) ? '' : ' · 문구에 {사진}을 넣으면 그 자리에, 없으면 맨 끝에 들어가요'}`
      : '📷 이 기업에 맞는 사진 폴더가 없어요'}</div>` : ''}
  </div>`;
}
const refreshPrev = () => { const el = document.getElementById('bm-prev'); if(el) el.innerHTML = prevHtml(visibleList().filter(x => bm.ids.has(x.id))); };
export function bmPrev(d){ if(!bm) return; bm.pi += d; refreshPrev(); }

export function bmSet(k, v){
  if(!bm || bm.sending) return;
  bm[k] = v;
  if(k === 'step'){ bm.variant = ''; bm.tpl = pickTpl(bm.evKey, v); bm.failed = new Set(); pickTurn(); }
  if(k === 'variant') bm.tpl = pickTpl(bm.evKey, bm.step, v);
  if(k === 'who') visibleList().forEach(x => { if(!mailsOf(x, v).length) bm.ids.delete(x.id); });
  render();
}
export function bmPick(id, on){ if(!bm || bm.sending) return; on ? bm.ids.add(id) : bm.ids.delete(id); render(); }
export function bmAll(on){
  if(!bm || bm.sending) return;
  if(on === 'turn') pickTurn();
  else if(on === 'failed'){ bm.ids = new Set(bm.failed); bm.pi = 0; }
  else if(on === 'photo'){ bm.ids = new Set(shownList().filter(x => mailsOf(x, bm.who).length && photosOf(x.id).length).map(x => x.id)); bm.pi = 0; }
  else bm.ids = new Set(on ? shownList().filter(x => mailsOf(x, bm.who).length).map(x => x.id) : []);
  render();
}
// 문구는 다시 그리지 않고 담아만 둔다 — 그리면 입력 중인 칸이 초기화된다. 미리보기만 고친다
export function bmTpl(k, v){ if(!bm) return; bm.tpl[k] = v; refreshPrev(); }

const say = (t, ok) => { const m = document.getElementById('bm-msg'); if(m){ m.style.color = ok ? 'var(--g)' : 'var(--re)'; m.textContent = t; } };

/* 시험 발송 — 미리보기 중인 기업(all이면 고른 기업 모두)의 메일을 내 주소로.
   exhibitor_id를 안 넘겨 기록에 남지 않는다 */
const TEST_GAP = 5;   // 내 주소로만 가니 짧게 쉰다
export async function sendExhTestMail(all){
  if(!bm || bm.sending) return;
  // 받을 주소는 기본이 내 주소 — 행사 공용 메일함 등 다른 곳에서 보고 싶으면 바꾼다
  const me = (prompt('시험 메일을 받을 주소 (기록에 남지 않아요)', currentUser?.email || '') || '').trim();
  if(!me) return;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(me)){ say('메일 주소 모양이 아니에요.'); return; }
  const picked = visibleList().filter(x => bm.ids.has(x.id));
  if(!picked.length) return;
  const list = all ? picked : [picked[((bm.pi % picked.length) + picked.length) % picked.length]];
  if(all && !confirm(`고른 ${list.length}곳의 메일을 모두 ${me}로 보낼까요?
기업에는 안 가고 기록에도 안 남아요. 약 ${Math.ceil((list.length - 1) * TEST_GAP / 60)}분 걸려요.`)) return;
  const fileIds = mailFilesOf(bm.evKey).filter(f => f.step === exhMailFileStep(bm.step)).map(f => f.id);
  bm.sending = true;
  render();
  let ok = 0;
  const fails = [];
  for(const [i, x] of list.entries()){
    if(i) for(let s = TEST_GAP; s > 0; s--){ say(`${i}/${list.length} 보냄 — ${s}초 뒤 다음 통 (${exhNames(x).ko})`, true); await new Promise(r => setTimeout(r, 1000)); }
    say(`${me}로 보내는 중… ${i + 1}/${list.length} ${exhNames(x).ko}`, true);
    const m = await buildMail(x);
    if(m.error){ fails.push(`${exhNames(x).ko}: ${m.error}`); continue; }
    const res = await sendMail({ to: [me], subject: `[시험${all ? `·${exhNames(x).ko}` : ''}] ${m.subject}`, text: m.body, html: m.html, event_id: bm.evKey, file_ids: fileIds, attachments: m.attachments });
    if(res.ok) ok++; else fails.push(`${exhNames(x).ko}: ${res.error || '실패'}`);
  }
  bm.sending = false;
  render();
  say(ok ? `${me}로 ${all ? `${ok}통` : `«${exhNames(list[0]).ko}» 메일`}을 보냈어요 — 받은편지함에서 확인하세요.${fails.length ? ` 실패 ${fails.length}곳: ${fails.slice(0, 5).join(' / ')}` : ''}`
         : (fails.join(' / ') || '보내지 못했어요.'), !fails.length);
}

export async function sendExhBulkMail(){
  if(!bm || bm.sending) return;
  if(exhLocked()){ exhLockNotice(); return; }
  const list = visibleList().filter(x => bm.ids.has(x.id));
  if(!list.length){ say('받을 기업을 골라주세요.'); return; }
  const from = await eventMailFrom(bm.evKey);
  if(!from.ok){ say(from.text); return; }
  const st = curStep();
  if(!st) return;
  const fileIds = mailFilesOf(bm.evKey).filter(f => f.step === exhMailFileStep(bm.step)).map(f => f.id);
  // 밖으로 나가는 일 — 한 번 묻는다
  const notTurn = st.key === 'note' || st.lib ? 0 : list.filter(x => !isTurn(exhMailState(x, st))).length;
  const noPhoto = bm.photos ? list.filter(x => !photosOf(x.id).length).length : 0;
  if(!confirm(`${list.length}곳에 «${st.label}»${st.round ? ` (${st.round.label})` : ''} 메일을 보낼까요?${notTurn ? `\n\n이 중 ${notTurn}곳은 보낼 차례가 아니에요(이미 보냈거나 끝남).` : ''}${
    bm.photos ? `\n\n📷 기업별 사진: ${list.length - noPhoto}곳에 붙어요.${noPhoto ? ` ${noPhoto}곳은 맞는 사진이 없어 사진 없이 나가요.` : ''}` : ''}\n\n발신 ${from.text}\n받는 사람: ${bm.who === 'all' ? '메일 있는 담당자 모두' : bm.who === 'rest' ? '이 메일을 아직 못 받은 담당자만 (이미 받은 주소는 빠짐)' : '메인 담당자'}${ccList().length ? `\n참조: ${ccList().join(', ')}` : ''}\n기업마다 한 통씩 따로 나갑니다.${
    list.length > 1 ? `\n\n스팸으로 잡히지 않게 통마다 ${SEND_GAP}초씩 쉬어요 — 약 ${Math.ceil((list.length - 1) * SEND_GAP / 60)}분 걸려요. 다 보낼 때까지 이 창을 닫지 마세요.` : ''}`)) return;

  bm.sending = true;
  render();
  const kind = bm.step === 'note' || st.lib ? 'note' : `exh-${bm.step}`;
  let ok = 0;
  const fails = [];
  bm.failed = new Set();
  for(const [i, x] of list.entries()){
    /* 통 사이에 쉰다 — 같은 모양 메일을 쉬지 않고 수십 통 보내면 받는 쪽이 대량 발송으로 보고
       스팸함에 넣는다(특히 Gmail 같은 무료 메일 발신). 첫 통 앞에서는 쉬지 않는다 */
    if(i) for(let s = SEND_GAP; s > 0; s--){
      say(`${i}/${list.length} 보냄 — 스팸으로 잡히지 않게 ${s}초 쉬었다가 다음 통 (${exhNames(x).ko})`, true);
      await new Promise(r => setTimeout(r, 1000));
    }
    say(`보내는 중… ${i + 1}/${list.length} ${exhNames(x).ko}`, true);
    const to = mailsOf(x, bm.who);
    const ph = await buildMail(x);
    if(ph.error){ fails.push(`${exhNames(x).ko}: ${ph.error}`); bm.failed.add(x.id); continue; }
    const { subject, body: text, html } = ph;
    ph.list = ph.attachments;
    const res = await sendMail({ to, cc: ccList(), subject, text, html, exhibitor_id: x.id, category: st.label, kind, file_ids: fileIds, attachments: ph.attachments });
    if(!res.ok){ fails.push(`${exhNames(x).ko}: ${res.error || '실패'}`); bm.failed.add(x.id); continue; }
    ok++;
    const names = [...mailFilesOf(bm.evKey).filter(f => fileIds.includes(f.id)).map(f => f.filename), ...ph.list.map(a => a.filename)];
    if(res.logId) EXH_LOGS.push({
      id: res.logId, exhibitor_id: x.id, kind, ts: nowStamp(), direction: 'out', channel: '이메일',
      counterpart: to.join(', '), category: st.label, subject, answered_at: '', answer: '', status: 'done',
      body: text + (names.length ? `\n\n[첨부] ${names.join(', ')}` : ''),
      author_email: currentUser?.email || '', author_name: currentUser?.name || '',
    });
  }
  trackAction('add', '참가사 일괄 메일', bm.evKey, `«${st.label}»${st.round ? ` (${st.round.label})` : ''} ${ok}곳 보냄${fails.length ? ` · 실패 ${fails.length}곳` : ''}`);
  bm.sending = false;
  /* 묶음 대상에게 다 다시 보냈으면 묶음을 닫는다 */
  const rp = roundProgress(curStep());
  let closed = false;
  if(rp && rp.done >= rp.total){ await closeExhRound(true); closed = true; }
  pickTurn();   // 보낸 곳은 «보냄»으로 넘어가 빠진다
  render();
  say(`${ok}곳에 보냈어요${closed ? ' · 다시 보내기 묶음을 다 보내 닫았어요' : ''}${fails.length ? ` — 실패 ${fails.length}곳: ${fails.slice(0, 5).join(' / ')}${fails.length > 5 ? ' …' : ''}` : ''}`, !fails.length);
  window.renderExh?.();
}

/* 단계 편집 창에서 단계를 고치면 — 고른 단계가 없어졌으면 첫 단계로, 문구는 새 기본 문구로 */
window.refreshExhBulkMail = () => {
  if(!bm || bm.sending) return;
  const steps = exhMailSteps(bm.evKey);
  if(!steps.length){ close(); return; }
  if(!curStep()){ bm.step = steps[0].key; bm.variant = ''; }
  if(bm.variant && !exhStepVariants(bm.evKey, bm.step).some(v => v.id === bm.variant)) bm.variant = '';
  bm.tpl = pickTpl(bm.evKey, bm.step, bm.variant);
  pickTurn();
  render();
};
Object.assign(window, { openExhBulkMail, closeExhBulkMail: close, bmSet, bmPick, bmAll, bmTpl, bmPrev,
  sendExhBulkMail, sendExhTestMail, startExhRound, closeExhRound, bmPhotoPick, bmPhotoAssign, bmPhotoClear, bmBannerPick, bmBannerClear, bmFooterSave, bmCcSave, bmLangF });
