/* ══════════════════════════════════════════
   follow-up.js — 요청하고 기다리는 일, 그리고 리마인더 (연사·전시 공통)

   공을 넘겨도(요청 메일을 보내도) 자료가 안 오면 다시 챙기는 것이 사무국 일이다.
   그런데 마감을 사람·기업마다 넣는 것은 부담이고, 실제로는 거의 다 ASAP이다.
   그래서 마감 대신 «요청한 지 며칠»을 센다 (2026-10-24 결정).

     wait     요청했고 아직 기다릴 때 — 우리 할 일이 아니다(«요청 2일째 · 1일 뒤 리마인더»)
     nudge    기다린 만큼 기다렸다 — 리마인더를 보낼 때(우리 할 일로 돌아온다)
     snoozed  사람이 «다시 볼 날»을 정해 미뤘다 — 그날까지 기다림
     ask      아직 요청하지 않았다(보낼 차례는 단계 쪽이 판단한다)

   기준 숫자는 행사마다 «설정 › 행사 관리 › 일정»(EXH_CFG[행사].follow)
     first  첫 요청 뒤 며칠이면 리마인더 (기본 3)
     again  리마인더 뒤 며칠마다 다시 (기본 4)
   정말 넘기면 안 되는 마감이 있으면(행사일 기준 «D-7» 등) 그 하루 전부터는 날수와 상관없이 리마인더.

   «다시 볼 날»은 따로 칸을 만들지 않고 그 사람·기업의 기록(logs)에 kind 'follow' 메모로 남긴다
   — category=단계 키, answered_at=다시 볼 날. 왜 미뤘는지가 기록으로 같이 남는다.
══════════════════════════════════════════ */
import { EVENT_LIST, EXH_CFG, SPEAKER_LOGS, EXH_LOGS, currentUser } from '../state.js';
import { td, nowStamp } from '../utils.js';
import { saveSpeakerLog, saveExhLog } from '../api.js';

export const FOLLOW_DEFAULT = { first: 3, again: 4 };
export function followCfg(evKey){
  const f = (EXH_CFG[evKey] || {}).follow || {};
  return { first: Number(f.first) > 0 ? Number(f.first) : FOLLOW_DEFAULT.first,
           again: Number(f.again) > 0 ? Number(f.again) : FOLLOW_DEFAULT.again };
}

const day = (s) => String(s || '').slice(0, 10);
const diffDays = (a, b) => Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000);
export const addDays = (d, n) => { const t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

/* 마감 값 읽기 — 날짜(2026-10-20) 그대로, 또는 «D-7»(행사 시작 7일 전). 행사 날짜가 바뀌면 따라간다 */
export function resolveDue(evKey, v){
  const s = String(v || '').trim();
  const m = s.match(/^D-(\d{1,3})$/i);
  if(!m) return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  const ev = EVENT_LIST.find(e => e.key === evKey) || {};
  const start = day(ev.date_start || ev.date);
  return /^\d{4}-\d{2}-\d{2}$/.test(start) ? addDays(start, -Number(m[1])) : '';
}

/* 이 단계를 미룬 기록 중 가장 최근 것 */
function snoozeOf(logs, stepKey){
  const l = logs.filter(x => x.kind === 'follow' && x.category === stepKey)
    .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))[0];
  return l ? { until: day(l.answered_at), why: l.body || '', at: day(l.ts) } : null;
}

/* sends: 요청·리마인더를 보낸 날들(ts 또는 날짜) */
export function followState({ evKey, sends, due, logs, stepKey }){
  const ds = (sends || []).map(day).filter(Boolean).sort();
  if(!ds.length) return { state: 'ask' };
  const today = td();
  const first = ds[0], last = ds[ds.length - 1], n = ds.length;
  const since = diffDays(today, first);          // 처음 요청한 지
  const quiet = diffDays(today, last);           // 마지막으로 보낸 지
  const cfg = followCfg(evKey);
  const wait = n <= 1 ? cfg.first : cfg.again;
  const nudges = n - 1;
  const base = { since, quiet, n, nudges, first, last };
  const sz = logs ? snoozeOf(logs, stepKey) : null;
  if(sz && sz.until > today && sz.at >= last)
    return { ...base, state: 'snoozed', until: sz.until, why: sz.why,
      text: `${sz.until.slice(5).replace('-', '/')}까지 기다림${sz.why ? ` — ${sz.why}` : ''}` };
  const dueDate = resolveDue(evKey, due);
  const dueClose = dueDate && diffDays(dueDate, today) <= 1;
  if(quiet >= wait || dueClose || (sz && sz.until <= today && sz.at >= last))
    return { ...base, state: 'nudge',
      text: `리마인더 보낼 때 · 요청 ${since}일째${nudges ? ` · 리마인더 ${nudges}번 보냄` : ''}${dueDate ? ` · 마감 ${dueDate.slice(5).replace('-', '/')}` : ''}` };
  return { ...base, state: 'wait', left: wait - quiet,
    text: `요청 ${since}일째 · ${wait - quiet}일 뒤 리마인더` };
}

/* «다시 볼 날» — 연사(t='sp') 또는 전시 기업(t='ex')의 기록에 남긴다 */
export async function snoozeFollow(t, id, stepKey, until, why = ''){
  const row = {
    kind: 'follow', ts: nowStamp(), direction: '', channel: '메모', counterpart: '',
    category: stepKey, subject: `리마인더 미룸 → ${until}`, body: String(why || '').trim(),
    answered_at: until, answer: '', status: 'done',
    author_email: currentUser?.email || '', author_name: currentUser?.name || '',
    ...(t === 'sp' ? { speaker_id: id } : { exhibitor_id: id }),
  };
  const res = t === 'sp' ? await saveSpeakerLog(row) : await saveExhLog(row);
  if(!res || (res.ok === false && !res.offline)) return false;
  (t === 'sp' ? SPEAKER_LOGS : EXH_LOGS).push({ ...row, id: res.id || `${t === 'sp' ? 'SL' : 'XL'}-tmp-${Date.now()}` });
  return true;
}

/* 화면 칩 — 상태마다 색 */
export function followPill(f){
  if(!f || f.state === 'ask') return '';
  const c = f.state === 'nudge' ? 'p-amber' : f.state === 'snoozed' ? 'p-gray' : 'p-blue';
  const icon = f.state === 'nudge' ? '🔔' : '⏳';
  return `<span class="pill ${c}" style="font-size:9.5px" title="${f.first ? `처음 요청 ${f.first} · 마지막 ${f.last}` : ''}">${icon} ${f.text}</span>`;
}

/* 마감 입력 — «행사 N일 전»이 먼저, 날짜는 꼭 날짜여야 할 때만. 저장값은 'D-7' 또는 '2026-10-20'.
   행사 날짜가 바뀌면 «N일 전»은 따라가서 행사마다 날짜를 다시 넣지 않아도 된다 */
export function dueInputHtml(id, raw, evKey){
  const v = String(raw || '').trim();
  const m = v.match(/^D-(\d{1,3})$/i);
  const resolved = m && evKey ? resolveDue(evKey, v) : '';
  return `<span style="display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;font-size:11px;color:var(--i3)">
    행사 <input class="fi" type="number" min="0" max="365" id="${id}-rel" value="${m ? m[1] : ''}" placeholder="—"
      style="width:58px;padding:3px 6px" oninput="if(this.value)document.getElementById('${id}').value=''">일 전
    <span style="color:var(--i5)">또는</span>
    <input class="fi" type="date" id="${id}" value="${m ? '' : v}" style="width:140px;padding:3px 6px"
      oninput="if(this.value)document.getElementById('${id}-rel').value=''">
    ${resolved ? `<span style="color:var(--i4)">(${resolved})</span>` : ''}</span>`;
}
export function readDueInput(id){
  const rel = String(document.getElementById(`${id}-rel`)?.value || '').trim();
  if(/^\d{1,3}$/.test(rel)) return `D-${Number(rel)}`;
  return String(document.getElementById(id)?.value || '').trim();
}
