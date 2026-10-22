/* ══════════════════════════════════════════════════════════════
   ai-mail-draft.js — «✨ AI로 초안 쓰기»

   상황(연락 단계·남은 자료·직원의 지시)에 맞는 제목·본문을 AI가 쓴다. 연사·참가사 메일,
   회신, 여러 곳에 보내는 메일이 같은 칸을 쓴다.

   사람 정보는 보내지 않는다(2026-10-08 결정 — 메일 본문·이름·메일 주소는 AI로 안 감).
   AI는 {호칭}·{기업} 같은 변수가 든 «틀»을 돌려주고, 이름은 각 화면이 채운다. 회신도
   받은 메일 본문 대신 «회신이다»와 직원 지시만 보낸다. 지시 칸의 메일 주소·전화번호는
   보내기 전에 지운다(서버에서도 한 번 더).

   화면마다 registerAiDraft(scope, () => ctx)로 지금 상황을 알려 준다.
     ctx = { part:'conf'|'exh', ev, lang:'ko'|'en'|'both', reply, step:{label,desc,subject_ko,…},
             state:[짧은 줄], stepLabel, apply(tpl) }
   AI가 쓴 틀은 «양식 보관함에 저장»으로 남길 수 있다 — 다음부터는 AI 없이 같은 틀을 쓴다.
══════════════════════════════════════════════════════════════ */
import { EVENT_LIST } from '../state.js';
import { aiMailDraft } from '../api.js';
import { escAttr } from '../utils.js';
import { MAIL_VARS, eventVarValues } from './mail-vars.js';
import { addLibItem } from './mail-templates.js';

const providers = {};
const lastTpl = {};
export function registerAiDraft(scope, fn){ providers[scope] = fn; }

/* 지시에 섞인 메일 주소·전화번호를 지운다 */
const scrub = (v) => String(v || '')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[메일 주소]')
  .replace(/\+?\d{2,4}[\s.-]\d{3,4}[\s.-]\d{4}/g, '[번호]');   // 010-1234-5678 꼴 — 날짜(2026-10-16)는 남긴다

export function aiDraftHtml(scope, { reply } = {}){
  return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0 8px;padding:7px 9px;
      background:var(--ad);border-radius:7px">
    <input class="fi" id="aid-q-${escAttr(scope)}" style="flex:1;min-width:220px;font-size:11.5px"
      placeholder="${escAttr(reply ? 'AI에게 — 예: 발표자료 받았다고 감사 인사, 링크는 확인 후 다시 안내' : 'AI에게 — 예: 세션 통합으로 시간이 바뀌었다고 정중하게')}"
      onkeydown="if(event.key==='Enter'){event.preventDefault();runAiDraft('${escAttr(scope)}')}">
    <button class="btn bp" style="font-size:11px" onclick="runAiDraft('${escAttr(scope)}')">✨ AI로 ${reply ? '회신' : '초안'} 쓰기</button>
    <button class="btn" id="aid-save-${escAttr(scope)}" style="font-size:10.5px;display:none" onclick="saveAiDraft('${escAttr(scope)}')"
      title="AI가 쓴 틀(변수 그대로)을 양식 보관함에 남깁니다 — 다음부터 «무슨 메일인가»에서 고릅니다">양식 보관함에 저장</button>
    <div style="flex-basis:100%;font-size:10px;color:var(--i4)" id="aid-msg-${escAttr(scope)}">
      이름·메일 내용은 AI로 보내지 않아요 — 지시 칸에도 넣지 마세요. 쓴 글은 아래 칸을 덮으니 보내기 전에 읽고 고치세요.</div>
  </div>`;
}

export async function runAiDraft(scope){
  const fn = providers[scope];
  const ctx = fn && fn();
  if(!ctx) return;
  // 채우면서 창을 다시 그리는 화면(여러 곳 메일)이 있어 칸은 쓸 때마다 다시 찾는다
  const say = (t, c) => { const m = document.getElementById(`aid-msg-${scope}`); if(m){ m.style.color = c || 'var(--i4)'; m.textContent = t; } };
  const q = scrub(document.getElementById(`aid-q-${scope}`)?.value || '').trim();
  const evRow = EVENT_LIST.find(e => e.key === ctx.ev) || {};
  const evv = eventVarValues(ctx.ev, ctx.lang === 'en') || {};
  say('쓰는 중… (20초쯤)', 'var(--a)');
  const st = ctx.step || {};
  const r = await aiMailDraft({
    part: ctx.part, lang: ctx.lang, reply: !!ctx.reply,
    step: { label: st.label || '', desc: st.desc || '', subject_ko: st.subject_ko || '', body_ko: st.body_ko || '',
      subject_en: st.subject_en || '', body_en: st.body_en || '' },
    state: ctx.state || [],
    event: { name: evv['행사'] || evRow.name || '', date: evv['행사일'] || '', venue: evv['장소'] || '' },
    instruction: q,
    vars: [...new Set((MAIL_VARS[ctx.part] || []).map(v => v.key).concat(Object.keys(evv)))],
  });
  if(!r.ok){ say(r.error || 'AI가 쓰지 못했어요', 'var(--re)'); return; }
  const tpl = { subject_ko: r.subject_ko || '', body_ko: r.body_ko || '', subject_en: r.subject_en || '', body_en: r.body_en || '' };
  lastTpl[scope] = { part: ctx.part, ev: ctx.ev, name: `${ctx.stepLabel || st.label || '메일'} (AI)`, tpl };
  ctx.apply(tpl);
  const btnSave = document.getElementById(`aid-save-${scope}`);
  if(btnSave) btnSave.style.display = ctx.reply ? 'none' : '';
  const qEl = document.getElementById(`aid-q-${scope}`); if(qEl && !qEl.value) qEl.value = q;
  say(r.note ? `✓ 채웠어요 — 확인할 점: ${r.note}` : '✓ 채웠어요 — 읽고 고친 뒤 보내세요', r.note ? 'var(--am)' : 'var(--g)');
}

export async function saveAiDraft(scope){
  const L = lastTpl[scope];
  if(!L) return;
  const name = prompt('양식 이름', L.name);
  if(!name) return;
  const ok = await addLibItem(L.part, L.ev, { name: name.trim(), scope: L.ev, ...L.tpl });
  const msg = document.getElementById(`aid-msg-${scope}`);
  if(ok && msg){ msg.style.color = 'var(--g)'; msg.textContent = `✓ 양식 보관함에 «${name.trim()}»으로 저장했어요`; }
}

window.runAiDraft = runAiDraft;
window.saveAiDraft = saveAiDraft;
