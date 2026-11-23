/* ══════════════════════════════════════════════════════════════
   features/upload/g2b-buyers.js — 데이터 업로드 › 나라장터 발주기관 → 바이어
   나라장터 행사대행 공고 엑셀(«검증 공고» 시트)을 올리면
     담당자 → Master DB(기업DB 연결) · 고른 행사의 바이어 · 기관별 영업 파이프라인(공고를 기록으로)
   을 서버(backend-node/lib/g2b-buyers.js)가 한 번에 한다. 먼저 시험 실행 결과를 보여 주고 «저장»으로 넣는다.
   window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.
═══════════════════════════════════════════════════════════════ */

import { authHeaders } from '../../api.js';
import { API_BASE_URL, CONTACT_ROUNDS, EVENT_LIST, currentUser } from '../../state.js';
import { escapeHtml as h } from '../../utils.js';

const ui = { rows: null, file: '', busy: false };

async function post(body){
  if(!API_BASE_URL || !currentUser) return { ok: false, error: '테스트 모드에서는 쓸 수 없어요' };
  try {
    const res = await fetch(API_BASE_URL + '/api/imports/g2b-buyers', {
      method: 'POST', headers: { ...await authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    return res.ok || j.ok === false ? j : { ok: false, error: `실패 (${res.status})` };
  } catch(e){ return { ok: false, error: e.message }; }
}

export function renderG2bBuyers(){
  const sel = document.getElementById('g2b-ev');
  if(sel && !sel.options.length){
    const evs = [...EVENT_LIST].sort((a, b) => String(b.date_start || '').localeCompare(String(a.date_start || '')));
    sel.innerHTML = evs.map(e => `<option value="${h(e.key)}">${h(e.short || e.name || e.key)}</option>`).join('');
    if(evs.some(e => e.key === 'EVK')) sel.value = 'EVK';
  }
  fillRounds();
}

/* 차수 — 그 행사의 열린 차수. 이름에 «바이어»가 든 차수를 먼저 고른다. 안 넣으려면 «넣지 않음» */
function fillRounds(){
  const ev = document.getElementById('g2b-ev')?.value;
  const sel = document.getElementById('g2b-round');
  if(!sel) return;
  const rs = CONTACT_ROUNDS.filter(r => r.event_id === ev && r.status !== 'closed');
  sel.innerHTML = '<option value="">넣지 않음</option>' + rs.map(r => `<option value="${h(r.id)}">${h(r.name)}${r.channel ? ` · ${h(r.channel)}` : ''}</option>`).join('');
  const buyer = rs.find(r => /바이어/.test(r.name || ''));
  if(buyer) sel.value = buyer.id;
}

function g2bEvChanged(){ fillRounds(); if(ui.rows) runG2b(false); }

function pickSheet(wb){
  /* 이 양식은 두 번째 시트(«검증 공고»)가 공고 명단이다 — 첫 시트는 기관별 우선순위 요약 */
  const named = wb.SheetNames.find(n => n.replace(/\s/g, '') === '검증공고');
  return named || wb.SheetNames[1] || wb.SheetNames[0];
}

function readSheet(){
  const sheet = document.getElementById('g2b-sheet').value;
  ui.rows = XLSX.utils.sheet_to_json(ui.wb.Sheets[sheet], { header: 1, defval: '', raw: true })
    .map(r => r.map(c => (c instanceof Date ? c.toISOString().slice(0, 10) : c)));
  runG2b(false);
}

function handleG2bFile(e){
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      ui.wb = XLSX.read(ev.target.result, { type: 'array' });
      const pick = pickSheet(ui.wb);
      const sel = document.getElementById('g2b-sheet');
      sel.innerHTML = ui.wb.SheetNames.map((n, i) => `<option value="${h(n)}">${i + 1}번째 · ${h(n)}</option>`).join('');
      sel.value = pick;
      sel.parentElement.style.display = '';
      document.getElementById('g2b-file').textContent = file.name;
      readSheet();
    } catch(err){ show(`<div class="g2b-err">엑셀을 읽지 못했어요 — ${h(err.message)}</div>`); }
  };
  reader.readAsArrayBuffer(file);
}

function show(html){ const el = document.getElementById('g2b-out'); if(el) el.innerHTML = html; }

async function runG2b(apply){
  if(!ui.rows || ui.busy) return;
  const eventId = document.getElementById('g2b-ev').value;
  const roundId = document.getElementById('g2b-round')?.value || '';
  if(apply && !confirm('이 결과대로 저장할까요?')) return;
  ui.busy = true;
  show(`<div class="g2b-note">${apply ? '저장하는 중…' : '시험 실행 중…'}</div>`);
  const j = await post({ eventId, roundId, rows: ui.rows, apply });
  ui.busy = false;
  if(!j.ok){ show(`<div class="g2b-err">${h(j.error || '실패')}</div>`); return; }
  show(report(j.report, j.applied));
}

function report(r, applied){
  const c = r.contacts, ev = h(r.event.name || r.event.id);
  const head = applied
    ? `<div class="g2b-done">✅ 저장했어요 — 화면에 보이려면 <button class="btn bs" onclick="location.reload()">새로 고침</button></div>`
    : `<div class="g2b-note">시험 실행 결과예요. 아직 아무것도 저장하지 않았어요.
         <button class="btn bp" onclick="runG2b(true)">이대로 저장</button></div>`;
  const stat = (n, l) => `<div class="stat-card"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const list = (title, items) => items.length ? `<div class="g2b-sub">${title}</div><ul class="g2b-ul">${items.join('')}</ul>` : '';
  return head + `
    <div class="stat-grid">
      ${stat(r.deals, `공고 · 기관 ${r.orgCount}곳`)}
      ${stat(c.created, `새 연락처 · 붙임 ${c.attached}`)}
      ${stat(r.participations.created, `${ev} 바이어 추가`)}
      ${stat(r.pipeline.created, `영업 파이프라인 새 기관${r.pipeline.dealsAdded ? ` · 공고 ${r.pipeline.dealsAdded}건 더함` : ''}`)}
      ${r.round ? stat(r.round.added, `차수 «${h(r.round.name)}» 명단에 넣을 기관${r.round.existed ? ` · 이미 ${r.round.existed}` : ''}`) : ''}
      ${r.round ? stat(r.round.salesOn, '영업 DB로 켤 담당자') : ''}
      ${stat(r.orgsCreated.length, '기업DB 새 기업')}
    </div>
    ${list(`담당자 ${r.people.length}명`, r.people.map(p =>
      `<li><b>${h(p.name)}</b> · ${h(p.org)} <span class="g2b-tag">${h(p.kinds.join('·'))}</span>
        <span class="g2b-tag">${p.created ? '새로' : '기존 연락처'}</span>${p.part === '있음' ? ' <span class="g2b-tag">이미 바이어</span>' : ''}</li>`))}
    ${list(`같은 사람인지 확인할 ${c.suspects.length}명 — 새 사람으로 넣어요`, c.suspects.map(s =>
      `<li>${h(s.name)} (${h(s.org)}) ≈ ${h(s.withName)} (${h(s.withOrg)}) — ${h(s.why)}</li>`))}
    ${list(`이름·메일이 없어 연락처로 못 넣은 ${r.skipped.length}건 (기관은 파이프라인에 들어가요)`, r.skipped.map(s =>
      `<li>${h(s.org)} ${h(s.kind)} — ${h(s.dept)} ${h(s.phone)}</li>`))}
    ${r.round ? list(`담당자가 없어 차수 명단에 못 넣는 기관 ${r.round.noContact.length}곳 — 파이프라인에는 들어가요`, r.round.noContact.map(o => `<li>${h(o)}</li>`)) : ''}
    ${list('기업DB에 새로 만드는 기업', r.orgsCreated.length ? [`<li>${r.orgsCreated.map(h).join(', ')}</li>`] : [])}
    ${list('영업 파이프라인', r.orgs.map(o => `<li>${h(o.org)} · 공고 ${o.deals}건 <span class="g2b-tag">${h(o.state)}</span></li>`))}`;
}

window.handleG2bFile = handleG2bFile;
window.runG2b = runG2b;
window.readG2bSheet = readSheet;
window.renderG2bBuyers = renderG2bBuyers;
window.g2bEvChanged = g2bEvChanged;
window.g2bRoundChanged = () => { if(ui.rows) runG2b(false); };
