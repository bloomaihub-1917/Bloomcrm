/* ══════════════════════════════════════════════════════════════
   ai-settings.js — 설정 › ✨ AI 설정

   Claude를 쓰는 기능(backend-node/routes/ai.js)마다
   - 켜기/끄기: 끈 기능은 서버가 «설정에서 꺼져 있어요»로 답한다
   - 모델: Sonnet(기본) · Haiku(빠르고 싸다, 단순 분류용) · Opus(가장 똑똑, 비싸다)
   - 생각 깊이: 낮음/보통/높음 (Haiku는 받지 않는다)
   그리고 한 달 호출 한도(0 = 없음)와 이번 달 사용량을 보여 준다.
   저장은 서버 settings key='ai_config' — 모든 직원에게 같이 적용된다.
══════════════════════════════════════════════════════════════ */
import { aiConfig, aiSaveConfig } from '../api.js';
import { escapeHtml } from '../utils.js';

const MODEL_LABEL = { sonnet: 'Sonnet (기본)', haiku: 'Haiku (빠름·저렴)', opus: 'Opus (가장 정확·비쌈)' };
const EFFORT_LABEL = { low: '낮음', medium: '보통', high: '높음' };
let meta = null;    // 서버가 준 기능·모델 목록, 사용량
let draft = null;   // 화면에서 고치는 중인 설정

export async function renderAiSettings(){
  const el = document.getElementById('ai-settings');
  if(!el) return;
  el.innerHTML = '<div style="font-size:12px;color:var(--i4)">불러오는 중…</div>';
  const r = await aiConfig();
  if(!r.ok){
    el.innerHTML = `<div style="font-size:12px;color:var(--re)">${escapeHtml(r.error || '불러오지 못했어요')}</div>`;
    return;
  }
  meta = r;
  draft = JSON.parse(JSON.stringify(r.config));
  draw();
}

function draw(){
  const el = document.getElementById('ai-settings');
  if(!el || !meta) return;
  const use = Object.fromEntries((meta.usage || []).map(u => [u.feature, u]));
  const tot = (meta.usage || []).reduce((a, u) => ({ calls: a.calls + u.calls, inp: a.inp + u.input_tokens, out: a.out + u.output_tokens }), { calls: 0, inp: 0, out: 0 });
  const n = (v) => (v || 0).toLocaleString();
  const card = 'background:var(--i8);border:1px solid var(--i6);border-radius:10px;padding:14px;margin-bottom:14px';

  const keyBox = meta.enabled
    ? '<b style="color:var(--g)">연결됨</b> <span style="color:var(--i4)">— 서버에 ANTHROPIC_API_KEY가 있어요</span>'
    : '<b style="color:var(--re)">꺼짐</b> <span style="color:var(--i4)">— 서버 환경변수 ANTHROPIC_API_KEY가 없어요. 모든 AI 단추가 동작하지 않습니다</span>';

  const rows = meta.features.map(f => {
    const c = draft.features[f.key];
    const u = use[f.key];
    const models = meta.models.map(m => `<option value="${m.key}" ${c.model === m.key ? 'selected' : ''}>${MODEL_LABEL[m.key] || m.key}</option>`).join('');
    const efforts = Object.keys(EFFORT_LABEL).map(k => `<option value="${k}" ${c.effort === k ? 'selected' : ''}>${EFFORT_LABEL[k]}${k === f.defaultEffort ? ' (기본)' : ''}</option>`).join('');
    return `<tr style="border-top:1px solid var(--i7);${c.on ? '' : 'opacity:.55'}">
      <td style="padding:8px 6px"><label style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" ${c.on ? 'checked' : ''} onchange="aiSetSet('${f.key}','on',this.checked)">
        <span><b style="font-size:12px;color:var(--i1)">${escapeHtml(f.label)}</b><br><span style="font-size:10.5px;color:var(--i4)">${escapeHtml(f.where || '')}</span></span>
      </label></td>
      <td style="padding:8px 6px"><select class="fi" style="font-size:12px;padding:4px 6px" ${c.on ? '' : 'disabled'} onchange="aiSetSet('${f.key}','model',this.value)">${models}</select></td>
      <td style="padding:8px 6px"><select class="fi" style="font-size:12px;padding:4px 6px" ${c.on && c.model !== 'haiku' ? '' : 'disabled'} title="${c.model === 'haiku' ? 'Haiku는 생각 깊이를 고를 수 없어요' : ''}" onchange="aiSetSet('${f.key}','effort',this.value)">${efforts}</select></td>
      <td style="padding:8px 6px;text-align:right;font-size:12px;color:var(--i2);white-space:nowrap">${u ? `${n(u.calls)}회${u.fails ? ` <span style="color:var(--re)">(실패 ${n(u.fails)})</span>` : ''}` : '<span style="color:var(--i5)">-</span>'}</td>
    </tr>`;
  }).join('');

  const cap = draft.monthlyCap || 0;
  el.innerHTML = `
    <div style="${card}">
      <div style="font-size:12px;font-weight:700;color:var(--i2);margin-bottom:8px">연결 상태</div>
      <div style="font-size:12px">${keyBox}</div>
    </div>

    <div style="${card}">
      <div style="font-size:12px;font-weight:700;color:var(--i2);margin-bottom:4px">기능별 설정</div>
      <div style="font-size:11px;color:var(--i4);margin-bottom:8px">단순한 분류(열 맞추기·검색·국가/업종)는 Haiku로 바꾸면 빠르고 비용이 적어요. 상담·메일 초안은 Sonnet을 권해요.</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:560px">
        <thead><tr style="font-size:11px;color:var(--i4);text-align:left">
          <th style="padding:4px 6px;font-weight:600">기능</th><th style="padding:4px 6px;font-weight:600">모델</th>
          <th style="padding:4px 6px;font-weight:600">생각 깊이</th><th style="padding:4px 6px;font-weight:600;text-align:right">이번 달</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>

    <div style="${card}">
      <div style="font-size:12px;font-weight:700;color:var(--i2);margin-bottom:8px">한 달 사용 (${escapeHtml(meta.month || '')})</div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:12px;margin-bottom:12px">
        <span>호출 <b>${n(tot.calls)}</b>회</span>
        <span>보낸 토큰 <b>${n(tot.inp)}</b></span>
        <span>받은 토큰 <b>${n(tot.out)}</b></span>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;flex-wrap:wrap">
        한 달 호출 한도
        <input class="fi" type="number" min="0" step="50" value="${cap}" style="width:110px" oninput="aiSetCap(this.value)">
        <span style="color:var(--i4);font-size:11px">회 — 0이면 한도 없음. 넘으면 그 달은 AI 단추가 멈춰요</span>
      </label>
    </div>

    <div style="display:flex;gap:8px;align-items:center">
      <button class="btn bp" onclick="aiSaveSettings()" style="min-width:80px">저장</button>
      <button class="btn" onclick="aiResetSettings()">기본값으로</button>
      <span id="ai-set-msg" style="font-size:11px;color:var(--g)"></span>
    </div>`;
}

function setFeature(key, field, value){
  if(!draft?.features[key]) return;
  draft.features[key][field] = value;
  draw();
}
function setCap(v){ if(draft) draft.monthlyCap = Math.max(0, Math.floor(Number(v) || 0)); }

async function save(){
  const msg = document.getElementById('ai-set-msg');
  if(msg){ msg.style.color = 'var(--i4)'; msg.textContent = '저장 중…'; }
  const r = await aiSaveConfig(draft);
  if(!r.ok){
    if(msg){ msg.style.color = 'var(--re)'; msg.textContent = r.error || '저장하지 못했어요'; }
    return;
  }
  meta.config = r.config;
  draft = JSON.parse(JSON.stringify(r.config));
  draw();
  const m2 = document.getElementById('ai-set-msg');
  if(m2){ m2.style.color = 'var(--g)'; m2.textContent = '저장했어요 — 모든 직원에게 바로 적용돼요'; }
}

function reset(){
  if(!meta) return;
  meta.features.forEach(f => { draft.features[f.key] = { on: true, model: 'sonnet', effort: f.defaultEffort }; });
  draft.monthlyCap = 0;
  draw();
  const msg = document.getElementById('ai-set-msg');
  if(msg){ msg.style.color = 'var(--i4)'; msg.textContent = '기본값으로 바꿨어요 — 저장을 눌러야 적용돼요'; }
}

window.aiSetSet         = setFeature;
window.aiSetCap         = setCap;
window.aiSaveSettings   = save;
window.aiResetSettings  = reset;
