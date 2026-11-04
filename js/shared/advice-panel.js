/* ══════════════════════════════════════════════════════════════
   shared/advice-panel.js — ✨ 상황 물어보기 칸의 화면 틀 (참가사·연사 상세 창이 함께 쓴다)

   질문 칸·«물어보기» 단추·오류 줄·답(요약·할 일 목록·주의·기록에 남기기·닫기)은 둘이 같다.
   다른 것 — 겉 상자 모양, 칸 id, 안내 문구, 줄마다 붙는 단추 종류, 부르는 함수 이름 — 만 넘겨받는다.
   AI에 무엇을 보내는지, 단추를 누르면 무엇을 하는지는 각자 파일에 남아 있다.
══════════════════════════════════════════════════════════════ */
import { escapeHtml, escAttr } from '../utils.js';

/* o — 각자 넘기는 것
   a            지금 이 사람의 질문·답 상태(없으면 null) { q, loading, err, ans, saved }
   wrapStyle    겉 상자 style
   inputId      질문 칸 id
   placeholder  질문 칸 안내
   inputTitle   질문 칸 title(무엇을 보내는지)
   ask / act / save / clear  window에 걸린 함수 이름
   labels       { action: 단추 글자 } — 답 줄마다 붙는 단추
   savedText    기록에 남긴 뒤 보이는 말
   saveTitle    «기록에 남기기» 단추 title */
export function adviceHtml(o){
  const a = o.a;
  const btn = (t) => {
    const label = o.labels[t.action];
    return label ? ` <button class="btn" style="font-size:var(--fs-10);padding:1px 7px" onclick="${o.act}('${t.action}','${escAttr(t.arg)}')">${label}</button>` : '';
  };
  return `<div style="${o.wrapStyle}">
    <div style="display:flex;gap:6px">
      <input class="fi" id="${o.inputId}" style="flex:1;font-size:var(--fs-11_5)" value="${escapeHtml(a ? a.q : '')}"
        placeholder="${o.placeholder}"
        onkeydown="if(event.key==='Enter')${o.ask}()" title="${o.inputTitle}">
      <button class="btn" style="font-size:var(--fs-10_5)" onclick="${o.ask}()" ${a && a.loading ? 'disabled' : ''}>${a && a.loading ? '생각 중…' : '물어보기'}</button>
    </div>
    ${a && a.err ? `<div style="font-size:var(--fs-11);color:var(--re);margin-top:5px">${escapeHtml(a.err)}</div>` : ''}
    ${a && a.ans ? `<div style="margin-top:7px;padding:8px 10px;background:var(--ad);border-radius:var(--rd-7);font-size:var(--fs-11_5);line-height:1.6">
        <div style="font-weight:700;color:var(--i1)">✨ ${escapeHtml(a.ans.summary)}</div>
        <ol style="margin:4px 0 0 18px;padding:0">${a.ans.todo.map(t => `<li style="margin:2px 0">${escapeHtml(t.text)}${btn(t)}</li>`).join('')}</ol>
        ${a.ans.caution ? `<div style="color:var(--am);margin-top:4px">⚠️ ${escapeHtml(a.ans.caution)}</div>` : ''}
        <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
          ${a.saved ? `<span style="font-size:var(--fs-10_5);color:var(--g)">${o.savedText}</span>`
            : `<button class="btn" style="font-size:var(--fs-10)" onclick="${o.save}()" title="${o.saveTitle}">기록에 남기기</button>`}
          <button class="btn" style="font-size:var(--fs-10)" onclick="${o.clear}()">닫기</button>
        </div></div>` : ''}
  </div>`;
}
