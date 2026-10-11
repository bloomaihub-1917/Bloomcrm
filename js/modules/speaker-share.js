/* ══════════════════════════════════════════════════════════════
   speaker-share.js — 연사 프로그램·수급 현황 바깥 공유

     프로그램   /d/<행사>/program   공개 — 확정 연사만. 프로그램북 웹디렉토리와 같은 결
     수급 현황  /s/<열쇠>           비밀 링크 — 주최사에만. 새 링크를 만들면 옛 링크는 막힌다

   받았는지 판정은 여기서(conf-tab.js spCell) 하고 결과만 서버에 올린다 — 서버에 규칙을 한 벌
   더 두면 둘이 다른 답을 낸다. 컨퍼런스 탭이 다시 그려질 때 바뀐 게 있으면 저절로 다시 올린다.
   연락처·연사료·계좌번호·여권번호는 싣지 않는다(계좌·여권은 받았는지만).
══════════════════════════════════════════════════════════════ */
import {
  sessionsForEvent, speakersForEvent, assignmentsOfSession, assignmentsFor,
  getSpeakerById, leadOf, coOf, roleLabel, speakerNeed, CONF_SESSIONS,
} from '../state.js';
import { loadShares, setShare, pushShareData, shareUrl } from '../api.js';
import { escapeHtml, escAttr } from '../utils.js';
import { trackAction } from './audit-tab.js';
import { spCell, SP_COLS, isBreak } from './conf-tab.js';

const sessSort = (a, b) => `${a.date || ''} ${a.start_at || ''}`.localeCompare(`${b.date || ''} ${b.start_at || ''}`)
  || String(a.seq || '').localeCompare(String(b.seq || ''), undefined, { numeric: true });
const asgSort = (a, b) => String(a.start_at || '').localeCompare(String(b.start_at || ''))
  || String(a.seq || '').localeCompare(String(b.seq || ''), undefined, { numeric: true });
const has = (v) => !!String(v ?? '').trim();

/* ── 프로그램 — 확정 연사만 ── */
const person = (sp) => ({
  name_ko: sp.name_snapshot || '', name_en: sp.name_en || '',
  org_ko: sp.org_ko || '', org_en: sp.org_en || '', title_ko: sp.title_ko || '', title_en: sp.title_en || '',
});
export function buildProgram(evKey){
  const ok = (a) => (getSpeakerById(a.speaker_id) || {}).status === '확정';
  const days = [];
  sessionsForEvent(evKey).slice().sort(sessSort).forEach(s => {
    let day = days[days.length - 1];
    if(!day || day.date !== (s.date || '')) days.push(day = { date: s.date || '', sessions: [] });
    /* 공동 발표는 한 줄 — 주 발표자 줄에 공동 연사를 잇는다(엑셀 프로그램표와 같게) */
    const talks = assignmentsOfSession(s.id).filter(a => ok(a) && leadOf(a) === a).sort(asgSort).map(a => ({
      start: a.start_at || '', end: a.end_at || '', role: roleLabel(a),
      title_ko: a.title_ko || '', title_en: a.title_en || '',
      people: [getSpeakerById(a.speaker_id), ...coOf(a).filter(ok).map(x => getSpeakerById(x.speaker_id))].filter(Boolean).map(person),
    }));
    day.sessions.push({ start: s.start_at || '', end: s.end_at || '', title_ko: s.title_ko || '', title_en: s.title_en || '',
      room: s.room || s.track || '', brk: isBreak(s), talks });
  });
  return { days };
}

/* ── 수급 현황 ── */
const BIO_KEYS = ['bio_profile', 'bio_pro', 'bio_work', 'bio_edu', 'bio_awards', 'bio_credentials', 'bio_teaching', 'bio_affil', 'bio_pubs'];
const LANG_COLS = ['profile', 'bio_pro', 'title', 'abstract'];
const YN_COLS = ['bank', 'passport'];
/* 국문·영문을 받았는지 — 영문만 받기로 한 연사의 국문은 null(«–») */
function langOf(sp, evKey, key){
  const koOk = sp.lang_pref !== 'en';
  const pick = (ko, en) => ({ ko: koOk ? ko : null, en });
  if(key === 'profile') return pick(has(sp.org_ko) || has(sp.title_ko), has(sp.org_en) || has(sp.title_en));
  if(key === 'bio_pro') return pick(BIO_KEYS.some(k => has(sp[`${k}_ko`])), BIO_KEYS.some(k => has(sp[`${k}_en`])));
  /* 발제는 배정마다 — 그 역할이 묻는 배정이 전부 갖춰야 «받음» */
  const live = assignmentsFor(sp.id).filter(a => leadOf(a) === a && speakerNeed(evKey, a.role, key));
  if(!live.length) return {};
  const f = key === 'title' ? 'title' : 'abstract';
  return pick(live.every(a => has(a[`${f}_ko`])), live.every(a => has(a[`${f}_en`])));
}
export function buildSupply(evKey){
  const sessOf = new Map(CONF_SESSIONS.map(s => [s.id, s]));
  const rows = speakersForEvent(evKey).filter(sp => sp.status !== '취소')
    .sort((a, b) => String(a.name_snapshot || a.name_en || '').localeCompare(String(b.name_snapshot || b.name_en || ''), 'ko'))
    .map(sp => {
      const asg = assignmentsFor(sp.id);
      const cells = {};
      SP_COLS.forEach(c => {
        const v = spCell(sp, evKey, c.key);
        if(!v || v.state === 'na') { cells[c.key] = { s: 'na' }; return; }
        const cell = { s: v.state };
        // 계좌는 무엇이 빠졌는지도 싣지 않는다 — 받음/안받음만
        if(v.text && !YN_COLS.includes(c.key) && c.key !== 'travel') cell.t = String(v.text);
        if(LANG_COLS.includes(c.key)) Object.assign(cell, langOf(sp, evKey, c.key));
        cells[c.key] = cell;
      });
      return {
        name: sp.name_snapshot || sp.name_en || '', name_en: sp.name_en || '',
        org: sp.org_ko || sp.org_en || '', status: sp.status || '',
        roles: [...new Set(asg.map(roleLabel).filter(Boolean))],
        sessions: asg.map(a => sessOf.get(a.session_id)).filter(Boolean).sort(sessSort)
          .map(s => [s.date ? s.date.slice(5).replace('-', '/') : '', s.start_at, s.title_ko || s.title_en].filter(Boolean).join(' ')),
        cells,
        travel: (sp.stay_hotel || sp.air_route) ? {
          hotel: sp.stay_hotel || '', in: sp.stay_in || '', out: sp.stay_out || '', room: sp.stay_room_type || '',
          booked: sp.stay_booked === 'yes',
          route: sp.air_route || '', cls: sp.air_class || '', ticketed: !!sp.air_ticketed_at,
          in_flight: sp.air_in_flight || '', in_at: sp.air_in_at || '', out_flight: sp.air_out_flight || '', out_at: sp.air_out_at || '',
        } : null,
      };
    });
  return {
    cols: SP_COLS.map(c => ({ key: c.key, label: c.label,
      lang: LANG_COLS.includes(c.key), yn: YN_COLS.includes(c.key) })),
    rows,
  };
}

/* ── 공유 상태와 자동 갱신 ── */
const shares = {};         // 행사 → { program, supply }
const lastSent = {};       // `${행사}|${kind}` → 마지막으로 올린 JSON
let timer = null;
const build = (evKey, kind) => (kind === 'program' ? buildProgram(evKey) : buildSupply(evKey));

async function ensureShares(evKey, force){
  if(!shares[evKey] || force){
    const r = await loadShares(evKey);
    if(!r.ok) return null;
    shares[evKey] = r.shares;
  }
  return shares[evKey];
}

/* 바뀐 것만 올린다 — 같은 내용을 매번 올리면 «마지막 갱신»이 의미가 없어진다 */
async function publish(evKey, kind, force){
  const sh = shares[evKey] && shares[evKey][kind];
  if(!sh || !sh.enabled) return { ok: true, skipped: true };
  const data = build(evKey, kind);
  const text = JSON.stringify(data);
  const k = `${evKey}|${kind}`;
  if(!force && lastSent[k] === text) return { ok: true, skipped: true };
  const r = await pushShareData(evKey, kind, data);
  if(r.ok){ lastSent[k] = text; sh.updated_at = r.updated_at; sh.has_data = true; }
  return r;
}

/* 컨퍼런스 탭이 다시 그려질 때 부른다 — 잦은 수정에 매번 올리지 않게 잠깐 모았다가 */
export function scheduleSharePublish(evKey){
  if(!evKey) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const sh = await ensureShares(evKey);
    if(!sh || !(sh.program.enabled || sh.supply.enabled)) return;
    await publish(evKey, 'program');
    await publish(evKey, 'supply');
    renderShareBox(evKey);
  }, 4000);
}

/* ── 공유 창 ── */
let openEv = '';
export async function openSpeakerShare(evKey){
  openEv = evKey;
  let el = document.getElementById('sp-share');
  if(!el){
    el = document.createElement('div');
    el.id = 'sp-share';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1100;display:flex;align-items:center;justify-content:center;padding:12px';
    el.addEventListener('click', (e) => { if(e.target === el) el.remove(); });
    document.body.appendChild(el);
  }
  el.innerHTML = `<div style="background:var(--W);border-radius:12px;width:min(620px,100%);max-height:94vh;overflow:auto">
    <div style="padding:12px 16px;border-bottom:1px solid var(--i6);display:flex;align-items:center;gap:8px">
      <div style="font-size:14px;font-weight:700">🔗 외부 공유</div>
      <button class="drcls" style="margin-left:auto" onclick="document.getElementById('sp-share').remove()">✕</button></div>
    <div id="sp-share-bd" style="padding:14px 16px 18px;font-size:12px;color:var(--i4)">불러오는 중…</div></div>`;
  const sh = await ensureShares(evKey, true);
  if(!sh){
    const bd = document.getElementById('sp-share-bd');
    if(bd) bd.innerHTML = '<span style="color:var(--re)">공유 상태를 불러오지 못했어요 (테스트 모드에서는 쓸 수 없어요)</span>';
    return;
  }
  renderShareBox(evKey);
}

function shareSection(evKey, kind, sh){
  const isProg = kind === 'program';
  const url = sh.path ? shareUrl(sh.path) : '';
  return `<div style="border:1px solid var(--i6);border-radius:9px;padding:12px;margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <div style="font-size:13px;font-weight:700;color:var(--i1)">${isProg ? '연사 프로그램' : '수급 현황'}</div>
      <span class="pill ${sh.enabled ? 'p-green' : 'p-gray'}" style="font-size:10px">${sh.enabled ? '공유 중' : '꺼짐'}</span>
      <button class="btn${sh.enabled ? '' : ' bp'}" style="margin-left:auto;font-size:11px" onclick="toggleSpeakerShare('${escAttr(evKey)}','${kind}',${!sh.enabled})">${sh.enabled ? '끄기' : '켜기'}</button>
    </div>
    <div style="font-size:11.5px;color:var(--i4);line-height:1.55;margin-bottom:8px">${isProg
      ? '누구나 여는 공개 주소예요 — 확정 연사만 실려요. 국문/영문을 바꿔 볼 수 있고, 참가기업 디렉토리와 서로 이어져요.'
      : '링크를 받은 사람만 보는 비밀 주소예요 — 주최사에만 보내 주세요. 연사별 자료를 받았는지(국문·영문 포함), 계좌·여권은 받음/안받음, 숙박·항공은 내용까지 보여요. 연락처·연사료·계좌번호는 싣지 않아요.'}</div>
    ${sh.enabled && url ? `<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
        <input class="fi" readonly value="${escAttr(url)}" style="flex:1;min-width:0;font-size:11.5px" onclick="this.select()">
        <button class="btn" style="font-size:11px" onclick="copySpeakerShare('${escAttr(url)}',this)">복사</button>
        <a class="btn" style="font-size:11px" href="${escAttr(url)}" target="_blank" rel="noopener">열기</a></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--i4)">
        <span>${sh.updated_at ? `마지막 갱신 ${escapeHtml(sh.updated_at)}${sh.updated_by ? ` · ${escapeHtml(sh.updated_by)}` : ''}` : '아직 안 올림'}</span>
        <button class="btn" style="font-size:10.5px;margin-left:auto" onclick="pushSpeakerShare('${escAttr(evKey)}','${kind}',this)">지금 갱신</button>
        ${isProg ? '' : `<button class="btn" style="font-size:10.5px;color:var(--re)" onclick="renewSpeakerShare('${escAttr(evKey)}')">새 링크로 바꾸기</button>`}
      </div>` : ''}
  </div>`;
}
function renderShareBox(evKey){
  const bd = document.getElementById('sp-share-bd');
  if(!bd || openEv !== evKey || !shares[evKey]) return;
  bd.style.color = '';
  bd.innerHTML = shareSection(evKey, 'program', shares[evKey].program) + shareSection(evKey, 'supply', shares[evKey].supply)
    + '<div style="font-size:11px;color:var(--i4);line-height:1.55">켜 두면 연사 화면에서 고친 내용이 몇 초 뒤 저절로 반영돼요(컨퍼런스 탭을 연 사람이 있을 때). 급하면 «지금 갱신»을 누르세요.</div>';
}

export async function toggleSpeakerShare(evKey, kind, on){
  const r = await setShare(evKey, kind, { enabled: on });
  if(!r.ok){ alert(r.error || '바꾸지 못했어요'); return; }
  shares[evKey][kind] = r.share;
  if(on){ delete lastSent[`${evKey}|${kind}`]; await publish(evKey, kind, true); }
  renderShareBox(evKey);
  trackAction('edit', '연사 외부 공유', evKey, `${kind === 'program' ? '프로그램' : '수급 현황'} ${on ? '켬' : '끔'}`);
}
export async function renewSpeakerShare(evKey){
  if(!confirm('새 링크를 만들면 지금 링크는 바로 열리지 않아요. 바꿀까요?')) return;
  const r = await setShare(evKey, 'supply', { renew: true });
  if(!r.ok){ alert(r.error || '바꾸지 못했어요'); return; }
  shares[evKey].supply = r.share;
  renderShareBox(evKey);
  trackAction('edit', '연사 외부 공유', evKey, '수급 현황 링크 새로 만듦');
}
export async function pushSpeakerShare(evKey, kind, btn){
  if(btn){ btn.disabled = true; btn.textContent = '올리는 중…'; }
  const r = await publish(evKey, kind, true);
  if(!r.ok) alert(r.error || '올리지 못했어요');
  renderShareBox(evKey);
}
export async function copySpeakerShare(url, btn){
  try { await navigator.clipboard.writeText(url); if(btn){ btn.textContent = '복사됨'; setTimeout(() => { btn.textContent = '복사'; }, 1500); } }
  catch(e){ prompt('링크를 복사하세요', url); }
}

window.openSpeakerShare = openSpeakerShare;
window.toggleSpeakerShare = toggleSpeakerShare;
window.renewSpeakerShare = renewSpeakerShare;
window.pushSpeakerShare = pushSpeakerShare;
window.copySpeakerShare = copySpeakerShare;
window.scheduleSharePublish = scheduleSharePublish;
