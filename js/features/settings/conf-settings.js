/* ══════════════════════════════════════════════════════════════
   features/settings/conf-settings.js — 설정 › 행사 상세 › 컨퍼런스 설정
   (modules/settings-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { deleteMailFile, fileToBase64, loadMailFiles, mailFilesOf, saveConfSession, uploadMailFile } from '../../api.js';
import { NEED_CYCLE, NEED_LABEL, NEED_MARK, SPEAKER_NEEDS, SPEAKER_NEEDS_ON_TALK, SPEAKER_ROLES } from '../../constants.js';
import { changed, trackAction } from '../../core/audit-log.js';
import { flowSteps } from '../../modules/speaker-flow.js';
import { openFlowEditor } from '../../shared/mail/flow-editor.js';
import { CONF_SESSIONS, EVENT_LIST, codeList, confCfg, confDays, speakerNeed } from '../../state.js';
import { TRACK_COLORS, pickTrackColorIndex, trackColorIndex, trackColorOf } from '../../track-colors.js';
import { escAttr, escapeHtml } from '../../utils.js';
import { saveConf } from '../conference/conf-common.js';
import { settingsUi } from './settings-ui.js';
import { fillExhMailFiles, removeEvMailbox, renderEvDetail, saveEvMailbox, syncEvSentMail, testEvMailbox } from './event-detail.js';

/* ══════════════════════════════════════════
   컨퍼런스 설정 — 행사 상세의 «컨퍼런스» 세그먼트

   연사를 넣기 전에 정해 둬야 하는 것들이다. 역할 목록과 역할별 요구 항목이
   없으면 그 뒤 화면이 «무엇을 받아야 하나»를 계산할 근거가 없다.

   담는 곳은 exh_cfg_<행사키> JSON의 conf 한 자리다 — parts·due·book이 이미
   그 줄에 얹혀 있고, 쓰는 곳들이 {...prev}로 저장하므로 서로 지우지 않는다.
══════════════════════════════════════════ */

function evConfHtml(ev){
  const cfg = confCfg(ev.key);
  const days = confDays(ev.key);
  const slots = cfg.slots || [];
  const tracks = cfg.tracks || [];
  const rooms = cfg.rooms || [];
  const limits = cfg.limits || {};
  const docs = cfg.docs || {};
  const roles = codeList('speaker_role', ev.key, SPEAKER_ROLES.map(r => ({ code: r.key, label: r.label, cls: r.cls })));

  /* ── 역할 × 받을 항목 격자 ──
     설계 문서의 그 표를 그대로 화면에 둔다. 셀을 누르면 ● → ○ → — 로 돈다.
     기본값은 코드(SPEAKER_ROLES)에 있고, 여기서 바꾼 것만 conf.roleNeeds에 담긴다.
     그래서 코드의 기본값을 나중에 고치면 손대지 않은 행사에는 그것이 따라온다. */
  const grid = `<div style="overflow-x:auto">
    <table style="min-width:520px;font-size:12px">
      <thead><tr>
        <th style="text-align:left;min-width:160px">받을 것</th>
        ${roles.map(r => `<th style="text-align:center;min-width:62px">${escapeHtml(r.label || r.code)}</th>`).join('')}
      </tr></thead>
      <tbody>
        ${SPEAKER_NEEDS.map(n => `<tr>
          <td style="font-size:11.5px">
            ${escapeHtml(n.label)}
            <div style="font-family:monospace;font-size:9.5px;color:var(--i5)">${escapeHtml(n.where)}${
              SPEAKER_NEEDS_ON_TALK.includes(n.key) ? ' · 발제' : ''}</div>
          </td>
          ${roles.map(r => { const st = speakerNeed(ev.key, r.code, n.key);
            const over = ((cfg.roleNeeds || {})[r.code] || {});
            const changed = (n.key in over);
            return `<td style="text-align:center;padding:4px">
              <button onclick="cycleSpeakerNeed('${escAttr(r.code)}','${escAttr(n.key)}')"
                title="${escapeHtml(`${r.label || r.code} · ${n.label} — ${NEED_LABEL[st]}${changed ? ' (이 행사만 바꿈)' : ''}`)}"
                style="width:30px;height:26px;border-radius:6px;cursor:pointer;font-size:13px;line-height:1;
                  border:1px solid ${changed ? 'var(--a)' : 'var(--i6)'};
                  background:${st === 'req' ? 'var(--gb)' : st === 'opt' ? 'var(--ab)' : 'var(--W)'};
                  color:${st === 'req' ? 'var(--g)' : st === 'opt' ? 'var(--am)' : 'var(--i5)'};
                  font-weight:700">${NEED_MARK[st]}</button></td>`; }).join('')}
        </tr>`).join('')}
      </tbody></table></div>
    <div style="font-size:10.5px;color:var(--i5);margin-top:8px;line-height:1.7">
      <b>●</b> 받아야 함 — 안 오면 «받을 것 현황»과 독촉 목록에 뜹니다 ·
      <b>○</b> 있으면 좋음 — 받으면 표시만 하고 독촉하지 않습니다 ·
      <b>—</b> 묻지 않음 — 그 칸이 화면에서 사라집니다<br>
      테두리가 파란 칸은 이 행사만 기본값과 다르게 정한 것이에요.
      ${(cfg.roleNeeds && Object.keys(cfg.roleNeeds).length)
        ? `<button class="btn" style="font-size:10.5px;margin-top:6px" onclick="resetSpeakerNeeds()">기본값으로 되돌리기</button>` : ''}
    </div>`;

  const row = (label, hint, inner) => `<div style="padding:11px 0;border-bottom:1px solid var(--i7)">
    <div class="mlbl">${escapeHtml(label)}${hint ? `<span style="color:var(--i5);font-weight:400"> ${escapeHtml(hint)}</span>` : ''}</div>
    ${inner}</div>`;

  const numIn = (id, v, ph) => `<input class="fi" type="number" id="${id}" value="${escapeHtml(v || '')}"
    placeholder="${escapeHtml(ph)}" style="width:110px">`;
  const txtIn = (id, v, ph) => `<input class="fi" id="${id}" value="${escapeHtml(v || '')}"
    placeholder="${escapeHtml(ph)}" style="width:100%">`;

  return `
    <div style="font-size:12px;font-weight:700;color:var(--i2);margin-bottom:4px">역할별로 무엇을 받나</div>
    <div style="font-size:11px;color:var(--i4);margin-bottom:10px">
      이 격자가 «받을 것 현황»의 계산식이에요. 좌장에게 초록을 독촉하지 않는 것도 여기서 정해집니다.
      역할 이름 자체는 <b>설정값 › 선택 목록 › 연사 역할</b>에서 고칩니다.
    </div>
    ${grid}

    <div style="font-size:12px;font-weight:700;color:var(--i2);margin:22px 0 4px">발표 일자·시간</div>
    ${row('발표 일자', `행사 기간에서 자동으로 만들어요 (${days.length}일)`, `
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px">
        ${days.length ? days.map(d => {
          const extra = (cfg.days || []).includes(d);
          return `<span class="pill ${extra ? 'p-blue' : 'p-gray'}" title="${extra ? '설정에서 더한 날' : '행사 기간'}">${escapeHtml(d)}${
            extra ? ` <span onclick="removeConfDay('${escAttr(d)}')" style="cursor:pointer">✕</span>` : ''}</span>`;
        }).join('') : '<span style="font-size:11.5px;color:var(--i5)">행사 기간이 비어 있어요 — 기본 정보에서 넣어주세요</span>'}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="date" class="fi" id="conf-day-add" style="width:150px">
        <button class="btn" style="font-size:11px" onclick="addConfDay()">+ 날짜 더하기</button>
        <span style="font-size:10.5px;color:var(--i5)">사전행사처럼 기간 밖의 날만 더하면 돼요</span>
      </div>`)}

    ${row('시간대', '세션을 짤 때 고르는 칸이에요', `
      <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:6px">
        ${slots.length ? slots.map((sl, i) => `<div style="display:flex;gap:6px;align-items:center;font-size:11.5px">
          <span class="pill p-gray" style="min-width:104px;text-align:center">${escapeHtml(sl.start || '')}–${escapeHtml(sl.end || '')}</span>
          <span style="flex:1;min-width:0;color:var(--i3)">${escapeHtml(sl.label || '')}</span>
          <button class="btn" style="font-size:10.5px" onclick="removeConfSlot(${i})">삭제</button>
        </div>`).join('') : '<div style="font-size:11.5px;color:var(--i5)">아직 없어요 — 세션 시간을 직접 적어도 되지만, 자주 쓰는 시간대를 넣어 두면 고르기만 하면 됩니다</div>'}
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input type="time" class="fi" id="conf-slot-s" style="width:104px">
        <span style="color:var(--i5)">–</span>
        <input type="time" class="fi" id="conf-slot-e" style="width:104px">
        <input class="fi" id="conf-slot-l" placeholder="이름 (예: 오전 세션)" style="flex:1;min-width:120px">
        <button class="btn" style="font-size:11px" onclick="addConfSlot()">추가</button>
      </div>`)}

    ${row('장소', '적은 순서가 표의 열 순서', `
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px">
        ${rooms.length ? rooms.map((t, i) => `<span class="pill p-teal">${escapeHtml(t)}
          ${i > 0 ? `<span onclick="moveConfRoom(${i},-1)" style="cursor:pointer" title="왼쪽으로">◀</span>` : ''}
          ${i < rooms.length - 1 ? `<span onclick="moveConfRoom(${i},1)" style="cursor:pointer" title="오른쪽으로">▶</span>` : ''}
          <span onclick="removeConfRoom(${i})" style="cursor:pointer">✕</span></span>`).join('')
          : '<span style="font-size:11.5px;color:var(--i5)">비워 두면 세션에 적힌 장소를 이름순으로 세웁니다</span>'}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input class="fi" id="conf-room-add" placeholder="예: HALL C" style="width:180px"
          onkeydown="if(event.key==='Enter')addConfRoom()">
        <button class="btn" style="font-size:11px" onclick="addConfRoom()">추가</button>
      </div>
      <div style="font-size:10.5px;color:var(--i4);margin-top:5px;line-height:1.6">
        메인 공간을 먼저 적으세요 — 프로그램표는 적은 순서대로 왼쪽부터 세웁니다.
        이름순으로는 «어디가 메인인지»를 알 길이 없어요.</div>`)}

    ${row('트랙', '동시에 여는 방', `
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px">
        ${tracks.length ? tracks.map((t, i) => {
          const c = trackColorOf(cfg, t);
          return `<span class="pill" style="background:${c.bg};color:var(--i1);border:1px solid ${c.bd}">
            <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c.bd};margin-right:4px"></span>${escapeHtml(t)}
            <span onclick="cycleTrackColor('${escAttr(t)}')" style="cursor:pointer;margin-left:3px" title="색 바꾸기">🎨</span>
            <span onclick="renameConfTrack(${i})" style="cursor:pointer;margin-left:3px" title="이름 바꾸기 — 이 트랙을 쓰는 세션도 함께 바뀝니다">✎</span>
            <span onclick="removeConfTrack(${i})" style="cursor:pointer">✕</span></span>`;
        }).join('')
          : '<span style="font-size:11.5px;color:var(--i5)">트랙이 하나면 비워 두세요</span>'}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input class="fi" id="conf-track-add" placeholder="예: Track A" style="width:180px"
          onkeydown="if(event.key==='Enter')addConfTrack()">
        <button class="btn" style="font-size:11px" onclick="addConfTrack()">추가</button>
      </div>`)}

    <div style="font-size:12px;font-weight:700;color:var(--i2);margin:22px 0 4px">글자수 한도</div>
    <div style="font-size:11px;color:var(--i4);margin-bottom:8px">
      행사마다 달라요. 넘치면 화면이 얼마나 줄여야 하는지까지 알려줍니다 — 비우면 한도를 걸지 않아요.
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;padding-bottom:11px;border-bottom:1px solid var(--i7)">
      <div><div class="mlbl">Professional Profile</div>${numIn('conf-lim-prof', limits.bio_profile, '자')}</div>
      <div><div class="mlbl">Professional experience</div>${numIn('conf-lim-pro', limits.bio_pro, '자')}</div>
      <div><div class="mlbl">Working experience</div>${numIn('conf-lim-work', limits.bio_work, '자')}</div>
      <div><div class="mlbl">Education</div>${numIn('conf-lim-edu', limits.bio_edu, '자')}</div>
      <div><div class="mlbl">Awards</div>${numIn('conf-lim-awards', limits.bio_awards, '자')}</div>
      <div><div class="mlbl">자격·면허</div>${numIn('conf-lim-cred', limits.bio_credentials, '자')}</div>
      <div><div class="mlbl">강의·교육</div>${numIn('conf-lim-teach', limits.bio_teaching, '자')}</div>
      <div><div class="mlbl">학회·공직</div>${numIn('conf-lim-affil', limits.bio_affil, '자')}</div>
      <div><div class="mlbl">출판·전시</div>${numIn('conf-lim-pubs', limits.bio_pubs, '자')}</div>
      <div><div class="mlbl">초록</div>${numIn('conf-lim-abs', limits.abstract, '자')}</div>
    </div>

    <div style="font-size:12px;font-weight:700;color:var(--i2);margin:22px 0 4px">양식·가이드라인</div>
    <div style="font-size:11px;color:var(--i4);margin-bottom:8px">
      매번 바뀌니 행사별로 둡니다. 연사의 언어 설정에 따라 국문본·영문본 중 무엇을 보낼지가 갈려요.
      OneDrive 링크나 파일명을 적으세요.
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding-bottom:11px;border-bottom:1px solid var(--i7)">
      <div><div class="mlbl">가이드라인 (국문)</div>${txtIn('conf-guide-ko', docs.guide_ko, '링크 또는 파일명')}</div>
      <div><div class="mlbl">가이드라인 (영문)</div>${txtIn('conf-guide-en', docs.guide_en, '링크 또는 파일명')}</div>
      <div><div class="mlbl">제출 양식 (국문)</div>${txtIn('conf-form-ko', docs.form_ko, '링크 또는 파일명')}</div>
      <div><div class="mlbl">제출 양식 (영문)</div>${txtIn('conf-form-en', docs.form_en, '링크 또는 파일명')}</div>
    </div>

    ${row('OneDrive 폴더', '사진·발표자료·동의서가 쌓이는 곳', txtIn('conf-folder', cfg.folder,
      '예: C:/Users/…/OneDrive - STUDIO BLOOM/4.행사/2026년/…/연사'))}

    ${flowEditorHtml(ev.key)}

    <div style="display:flex;gap:8px;align-items:center;margin-top:14px">
      <button class="btn bp" onclick="saveEvConf()" style="min-width:80px">저장</button>
      <span id="conf-msg" style="font-size:11px;color:var(--g)"></span>
      <span style="font-size:10.5px;color:var(--i5);margin-left:auto">
        일자·시간대·트랙·역할 격자는 누르는 즉시 저장돼요</span>
    </div>`;
}

/* ── 연사 연락 순서 ──
   고치는 곳은 편집 창 하나(flow-editor.js) — 연사 화면에서도 같은 창이 열린다.
   여기서는 지금 순서만 보여 주고 창을 연다. 고치면 그 자리에서 저장된다. */
function flowEditorHtml(evKey){
  const steps = flowSteps(evKey, { withOff: true });
  return `
    <div style="display:flex;align-items:center;gap:8px;margin:22px 0 6px">
      <span style="font-size:12px;font-weight:700;color:var(--i2)">연사 연락 순서</span>
      <button class="btn" style="font-size:10.5px;margin-left:auto" onclick="openFlowEditor('${escAttr(evKey)}')">✎ 단계 편집</button>
    </div>
    <div style="font-size:11px;color:var(--i4);margin-bottom:6px;line-height:1.6">
      단계 추가·고치기·끄기와 메일 양식·기본 첨부는 «단계 편집»에서 합니다. 연사 화면에서도 같은 창이 열리고, 고치면 바로 저장돼요.</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">${steps.map((st, i) => `<span class="pill ${st.off ? 'p-gray' : st.custom ? 'p-amber' : 'p-blue'}"
      style="font-size:10.5px;cursor:pointer;${st.off ? 'text-decoration:line-through' : ''}" onclick="openFlowEditor('${escAttr(evKey)}','${escAttr(st.key)}')"
      >${i + 1}. ${escapeHtml(st.label)}</span>`).join('')}</div>`;
}

/* 예전 «양식 고치기» 자리 — 이제 단계 편집 창을 그 단계가 펼쳐진 채로 연다 */
export function openFlowSettings(evKey, stepKey){ openFlowEditor(evKey, stepKey); }

/* 단계별 기본 첨부 — 목록은 서버에서 받아 각 단계 자리에 끼운다 */
export async function fillFlowFiles(evKey){
  await loadMailFiles(evKey);
  flowSteps(evKey, { withOff: true }).forEach(st => {
    const el = document.getElementById(`flowfiles-${st.key}`);
    if(!el) return;
    const files = mailFilesOf(evKey).filter(f => f.step === st.key);
    el.innerHTML = files.length ? files.map(f => `<div style="display:flex;gap:6px;align-items:center;padding:2px 0">
        📎 <span style="color:var(--i2)">${escapeHtml(f.filename)}</span>
        <span>${(Number(f.size || 0) / 1024).toFixed(0)}KB</span>
        <button class="btn" style="font-size:10px;padding:1px 6px;margin-left:auto"
          onclick="removeFlowFile('${escAttr(evKey)}','${escAttr(f.id)}')">삭제</button></div>`).join('')
      : '없음';
  });
}
export async function uploadFlowFiles(evKey, step, input){
  const files = [...(input.files || [])];
  input.value = '';
  for(const f of files){
    if(f.size > 3 * 1024 * 1024){ alert(`${f.name}: 3MB가 넘어 올릴 수 없어요.`); continue; }
    const data = await fileToBase64(f);
    const r = await uploadMailFile({ event_id: evKey, step, filename: f.name, content_type: f.type, data });
    if(!r.ok){ alert(`${f.name}: ${r.error || '올리지 못했어요'}`); continue; }
    trackAction('add', '메일 기본 첨부', evKey, `${step} 단계에 «${f.name}» 올림`);
  }
  fillFlowFiles(evKey); fillExhMailFiles(evKey);
}
export async function removeFlowFile(evKey, id){
  const f = mailFilesOf(evKey).find(x => x.id === id);
  if(!f || !confirm(`«${f.filename}»을(를) 기본 첨부에서 지울까요?`)) return;
  const r = await deleteMailFile(evKey, id);
  if(!r.ok){ alert(r.error || '지우지 못했어요'); return; }
  trackAction('delete', '메일 기본 첨부', evKey, `${f.step} 단계 «${f.filename}» 지움`);
  fillFlowFiles(evKey); fillExhMailFiles(evKey);
}

/* ── 격자 셀 한 번 누르기 — ● → ○ → — ──
   바꾼 값만 conf.roleNeeds에 담는다. 기본값과 같아지면 그 칸을 지워, 나중에
   코드의 기본값을 고치면 손대지 않은 행사에는 그것이 따라온다. */
export async function cycleSpeakerNeed(role, needKey){
  const ev = EVENT_LIST.find(e => e.key === settingsUi.evDetailKey);
  if(!ev) return;
  const cfg = JSON.parse(JSON.stringify(confCfg(ev.key)));
  const cur = speakerNeed(ev.key, role, needKey);
  const next = NEED_CYCLE[(NEED_CYCLE.indexOf(cur) + 1) % NEED_CYCLE.length];

  const def = SPEAKER_ROLES.find(r => r.key === role);
  const dflt = def ? (def.needs[needKey] ?? '') : '';

  cfg.roleNeeds = cfg.roleNeeds || {};
  cfg.roleNeeds[role] = { ...(cfg.roleNeeds[role] || {}) };
  if(next === dflt) delete cfg.roleNeeds[role][needKey];
  else cfg.roleNeeds[role][needKey] = next;
  if(!Object.keys(cfg.roleNeeds[role]).length) delete cfg.roleNeeds[role];
  if(!Object.keys(cfg.roleNeeds).length) delete cfg.roleNeeds;

  if(!await saveConf(ev.key, cfg)) return;
  trackAction('edit', '연사 요구 항목 변경', ev.key,
    `${ev.name || ev.key} — ${role} · ${SPEAKER_NEEDS.find(n => n.key === needKey)?.label || needKey}: ${NEED_LABEL[cur]} → ${NEED_LABEL[next]}`);
  renderEvDetail();
}

export async function resetSpeakerNeeds(){
  const ev = EVENT_LIST.find(e => e.key === settingsUi.evDetailKey);
  if(!ev) return;
  if(!confirm('역할별 받을 항목을 기본값으로 되돌릴까요?\n이 행사만 바꿔 둔 칸이 모두 사라집니다.')) return;
  const cfg = JSON.parse(JSON.stringify(confCfg(ev.key)));
  delete cfg.roleNeeds;
  if(!await saveConf(ev.key, cfg)) return;
  trackAction('edit', '연사 요구 항목 초기화', ev.key, `${ev.name || ev.key} — 기본값으로 되돌림`);
  renderEvDetail();
}

/* ── 일자·시간대·트랙 — 누르는 즉시 저장 ──
   목록에 한 줄 더하는 일은 «저장»을 따로 누르게 하면 잊는다. 아래 글자 칸들은
   타이핑 중이라 즉시 저장하지 않고 저장 버튼으로 모아 보낸다. */
async function pushConf(fn, label){
  const ev = EVENT_LIST.find(e => e.key === settingsUi.evDetailKey);
  if(!ev) return;
  const cfg = JSON.parse(JSON.stringify(confCfg(ev.key)));
  if(fn(cfg) === false) return;
  if(!await saveConf(ev.key, cfg)) return;
  trackAction('edit', '컨퍼런스 설정', ev.key, `${ev.name || ev.key} — ${label}`);
  renderEvDetail();
}

export const addConfDay = () => {
  const v = (document.getElementById('conf-day-add')?.value || '').trim();
  if(!v){ alert('날짜를 고르세요.'); return; }
  return pushConf(c => {
    c.days = c.days || [];
    if(c.days.includes(v)) return false;
    c.days.push(v); c.days.sort();
  }, `발표 일자 ${v} 더함`);
};
export const removeConfDay = (d) => pushConf(c => {
  c.days = (c.days || []).filter(x => x !== d);
}, `발표 일자 ${d} 뺌`);

export const addConfSlot = () => {
  const s = (document.getElementById('conf-slot-s')?.value || '').trim();
  const e = (document.getElementById('conf-slot-e')?.value || '').trim();
  const l = (document.getElementById('conf-slot-l')?.value || '').trim();
  if(!s || !e){ alert('시작·종료 시각을 넣어주세요.'); return; }
  if(e <= s){ alert('종료가 시작보다 빠르거나 같아요.'); return; }
  return pushConf(c => {
    c.slots = c.slots || [];
    c.slots.push({ start: s, end: e, label: l });
    c.slots.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  }, `시간대 ${s}–${e} 추가`);
};
export const removeConfSlot = (i) => pushConf(c => {
  c.slots = (c.slots || []).filter((_, k) => k !== i);
}, '시간대 삭제');

export const addConfRoom = () => {
  const v = (document.getElementById('conf-room-add')?.value || '').trim();
  if(!v) return;
  return pushConf(c => {
    c.rooms = c.rooms || [];
    if(c.rooms.includes(v)) return false;
    c.rooms.push(v);
  }, `장소 «${v}» 추가`);
};
export const removeConfRoom = (i) => pushConf(c => {
  c.rooms = (c.rooms || []).filter((_, k) => k !== i);
}, '장소 삭제');
/* 순서가 곧 표의 열 순서라, 지웠다 다시 넣게 하면 순서를 바꿀 때마다
   세션의 장소 이름과 어긋날 수 있다 — 자리만 맞바꾼다. */
export const moveConfRoom = (i, dir) => pushConf(c => {
  const list = c.rooms || [];
  const j = i + dir;
  if(j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  c.rooms = list;
}, '장소 순서 변경');

/* 트랙 색을 바꾼다 — 다음 색으로 한 칸 옮긴다. 색을 고르는 창을 띄우는
   것보다, 눌러서 원하는 색이 나올 때까지 돌리는 게 빠르다. */
export const cycleTrackColor = (track) => pushConf(c => {
  const map = { ...(c.trackColors || {}) };
  const cur = Number.isInteger(map[track]) ? map[track] : trackColorIndex(c, track);
  map[track] = (cur + 1) % TRACK_COLORS.length;
  c.trackColors = map;
}, `트랙 «${track}» 색 변경`);

export const addConfTrack = () => {
  const v = (document.getElementById('conf-track-add')?.value || '').trim();
  if(!v) return;
  return pushConf(c => {
    c.tracks = c.tracks || [];
    if(c.tracks.includes(v)) return false;
    c.tracks.push(v);
    /* 색을 지금 정해 둔다. 목록 순서로 색을 정하면 트랙을 하나 더할 때마다
       다른 트랙들의 색이 밀린다 — 트랙 하나에 색 하나를 붙여 둬야 한다. */
    c.trackColors = { ...(c.trackColors || {}), [v]: pickTrackColorIndex(c) };
  }, `트랙 «${v}» 추가`);
};
/* 트랙 이름 바꾸기 — 세션은 트랙을 이름 그대로 들고 있다(conf_sessions.track).
   설정만 바꾸면 세션들은 옛 이름으로 남아 새 트랙이 따로 생긴 것처럼 보이고
   색도 갈린다. 그래서 설정·색·세션을 한 번에 바꾼다. */
export async function renameConfTrack(i){
  const ev = EVENT_LIST.find(e => e.key === settingsUi.evDetailKey);
  if(!ev) return;
  const old = (confCfg(ev.key).tracks || [])[i];
  if(old == null) return;
  const v = (prompt(`«${old}»의 새 이름`, old) || '').trim();
  if(!v || v === old) return;
  if((confCfg(ev.key).tracks || []).includes(v)){ alert(`«${v}» 트랙이 이미 있어요.`); return; }

  const mine = CONF_SESSIONS.filter(x => x.event_id === ev.key && x.track === old);
  for(const x of mine){
    const res = await saveConfSession({ id: x.id, track: v });
    if(!res || res.ok === false){
      if(!res?.locked) alert(`세션 «${x.title_ko || x.title_en || x.id}»에서 멈췄어요 — 앞의 세션들은 이미 바뀌었습니다. 다시 눌러 주세요.`);
      return;
    }
    x.track = v;
  }
  await pushConf(c => {
    c.tracks = (c.tracks || []).map(t => t === old ? v : t);
    const map = { ...(c.trackColors || {}) };
    if(old in map){ map[v] = map[old]; delete map[old]; }
    c.trackColors = map;
  }, `트랙 «${old}» → «${v}» (세션 ${mine.length}개)`);
}
/* 세션이 쓰고 있는 트랙을 지우면 세션들은 옛 이름을 그대로 들고 남는다 —
   목록에서 사라진 줄 알았던 이름이 고르는 칸에 다시 나타난다. 이름을 바꾸려던
   거라면 ✎가 세션까지 바꾼다는 걸 알려 준다. */
export const removeConfTrack = (i) => {
  const ev = EVENT_LIST.find(e => e.key === settingsUi.evDetailKey);
  const t = ev ? (confCfg(ev.key).tracks || [])[i] : null;
  const using = t ? CONF_SESSIONS.filter(x => x.event_id === ev.key && x.track === t) : [];
  if(using.length && !confirm(`«${t}» 트랙을 쓰는 세션이 ${using.length}개 있어요:

${
      using.slice(0, 5).map(x => `· ${x.title_ko || x.title_en || x.id}`).join('\n')
    }

지워도 그 세션들은 «${t}»로 남아요. 이름을 바꾸려는 거라면 취소하고 ✎를 누르세요 — 세션도 함께 바뀝니다.

그래도 지울까요?`)) return;
  return pushConf(c => {
    c.tracks = (c.tracks || []).filter((_, k) => k !== i);
  }, '트랙 삭제');
};

/* ── 글자 칸 모아 저장 ── */
export async function saveEvConf(){
  const ev = EVENT_LIST.find(e => e.key === settingsUi.evDetailKey);
  if(!ev) return;
  const msg = document.getElementById('conf-msg');
  const say = (t, ok) => { if(msg){ msg.style.color = ok ? 'var(--g)' : 'var(--re)'; msg.textContent = t; } };
  const g = (id) => (document.getElementById(id)?.value || '').trim();
  const num = (id) => { const n = Number(g(id)); return n > 0 ? String(n) : ''; };

  const cfg = JSON.parse(JSON.stringify(confCfg(ev.key)));
  const limits = {
    bio_profile: num('conf-lim-prof'), bio_pro: num('conf-lim-pro'),
    bio_work: num('conf-lim-work'), bio_edu: num('conf-lim-edu'),
    bio_awards: num('conf-lim-awards'), bio_credentials: num('conf-lim-cred'),
    bio_teaching: num('conf-lim-teach'), bio_affil: num('conf-lim-affil'),
    bio_pubs: num('conf-lim-pubs'), abstract: num('conf-lim-abs'),
  };
  Object.keys(limits).forEach(k => { if(!limits[k]) delete limits[k]; });
  if(Object.keys(limits).length) cfg.limits = limits; else delete cfg.limits;

  const docs = { guide_ko: g('conf-guide-ko'), guide_en: g('conf-guide-en'),
    form_ko: g('conf-form-ko'), form_en: g('conf-form-en') };
  Object.keys(docs).forEach(k => { if(!docs[k]) delete docs[k]; });
  if(Object.keys(docs).length) cfg.docs = docs; else delete cfg.docs;

  const folder = g('conf-folder');
  if(folder) cfg.folder = folder; else delete cfg.folder;

  /* 연락 순서(cfg.flow·flow_custom)는 단계 편집 창이 따로 저장한다 — 여기선 건드리지 않는다 */

  if(!await saveConf(ev.key, cfg)) return;
  trackAction('edit', '컨퍼런스 설정', ev.key, `${ev.name || ev.key} — 글자수 한도·양식·폴더 저장`);
  say('저장했어요.', true);
  setTimeout(() => { const m = document.getElementById('conf-msg'); if(m) m.textContent = ''; }, 2000);
}

window.cycleSpeakerNeed  = cycleSpeakerNeed;
window.uploadFlowFiles = uploadFlowFiles;
window.openFlowSettings = openFlowSettings;
window.removeFlowFile = removeFlowFile;
window.resetSpeakerNeeds = resetSpeakerNeeds;
window.addConfDay        = addConfDay;
window.removeConfDay     = removeConfDay;
window.addConfSlot       = addConfSlot;
window.removeConfSlot    = removeConfSlot;
window.addConfRoom       = addConfRoom;
window.removeConfRoom    = removeConfRoom;
window.moveConfRoom      = moveConfRoom;
window.cycleTrackColor   = cycleTrackColor;
window.addConfTrack      = addConfTrack;
window.removeConfTrack   = removeConfTrack;
window.renameConfTrack   = renameConfTrack;
window.saveEvConf        = saveEvConf;

window.saveEvMailbox   = saveEvMailbox;
window.testEvMailbox   = testEvMailbox;
window.removeEvMailbox = removeEvMailbox;
window.syncEvSentMail  = syncEvSentMail;


/* 화면의 onclick이 부르는 것 */
window.evConfHtml = evConfHtml;   // 탭(settings-tab.js)이 window로 부른다
window.fillFlowFiles = fillFlowFiles;   // 탭(settings-tab.js)이 window로 부른다
