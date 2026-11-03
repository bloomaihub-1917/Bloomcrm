/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-dr-logs.js — 참가기업 상세 › 문의·기록
   (modules/exh-drawer.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { CO_DB, codeList, logsFor } from '../../state.js';
import { escAttr, escapeHtml } from '../../utils.js';
import { daysSince } from './exh-calc.js';
import { sct } from '../../modules/exh-drawer.js';
import { addExhLog, answerExhLog, delExhLog, holdExhLog } from './exh-dr-actions.js';

/* ══════════════════════════════════════════
   4) 문의·기록
══════════════════════════════════════════ */
/* 문의 채널·분류도 설정에서 고친다(code_lists) */
const channels = () => codeList('log_channel', null,
  ['이메일', '전화', '카톡', '미팅', '현장'].map(c => ({ code: c, label: c })));
const logCats = () => codeList('log_cat', null,
  ['부스', '비품', '그래픽', '정산', '현장', '기타'].map(c => ({ code: c, label: c })));

function dLogs(x){
  const logs = logsFor(x.id);
  const open = logs.filter(l => l.kind === 'inquiry' && !l.answered_at);
  const rest = logs.filter(l => !(l.kind === 'inquiry' && !l.answered_at));
  const cos = CO_DB.find(c => c.key === x.company_key);
  const people = (cos?.contacts || []).map(c => c.name).filter(Boolean);

  const item = (l) => {
    const isInq = l.kind === 'inquiry';
    const unanswered = isInq && !l.answered_at;
    const d = daysSince(l.ts);
    return `<div style="padding:10px 11px;border-radius:8px;margin-bottom:6px;background:${unanswered ? 'var(--ab)' : 'var(--i9)'};border-left:3px solid ${unanswered ? 'var(--am)' : isInq ? 'var(--g)' : 'var(--i6)'}">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
        <span class="pill ${isInq ? (unanswered ? 'p-amber' : 'p-green') : 'p-gray'}">${isInq ? (unanswered ? (l.status === 'hold' ? '확인 중' : '답변 대기') : '답변 완료') : '기록'}</span>
        ${l.category ? `<span class="pill p-gray">${escapeHtml(l.category)}</span>` : ''}
        ${l.channel ? `<span style="font-size:10.5px;color:var(--i4)">${escapeHtml(l.channel)}</span>` : ''}
        ${l.counterpart ? `<span style="font-size:10.5px;color:var(--i4)">· ${escapeHtml(l.counterpart)}</span>` : ''}
        <span style="font-size:10.5px;color:var(--i5);margin-left:auto">${escapeHtml(l.ts || '')}${unanswered && d > 0 ? ` · ${d}일 경과` : ''}</span>
      </div>
      ${l.subject ? `<div style="font-size:12.5px;font-weight:700;margin-bottom:3px">${escapeHtml(l.subject)}</div>` : ''}
      ${l.body ? `<div style="font-size:12px;color:var(--i2);white-space:pre-wrap;line-height:1.5">${escapeHtml(l.body)}</div>` : ''}
      ${l.answered_at ? `<div style="margin-top:7px;padding:7px 9px;background:var(--W);border-radius:6px">
          <div style="font-size:10.5px;color:var(--g);font-weight:700;margin-bottom:2px">답변 · ${escapeHtml(l.answered_at)}</div>
          <div style="font-size:12px;color:var(--i2);white-space:pre-wrap">${escapeHtml(l.answer || '')}</div></div>` : ''}
      ${unanswered ? `<div style="margin-top:8px;display:flex;gap:5px;align-items:flex-start">
          <textarea class="fi" id="ans-${escAttr(l.id)}" rows="2" placeholder="답변 내용을 적고 완료 처리하세요" style="flex:1;font-size:11.5px"></textarea>
          <div style="display:flex;flex-direction:column;gap:4px">
            <button class="btn bp bs" onclick="answerExhLog('${escAttr(l.id)}')">답변 완료</button>
            <button class="btn bs" onclick="holdExhLog('${escAttr(l.id)}')">${l.status === 'hold' ? '대기로' : '확인 중'}</button>
          </div></div>` : ''}
      <div style="margin-top:5px;text-align:right">
        <button class="btn bs" onclick="delExhLog('${escAttr(l.id)}')" style="font-size:10px;opacity:.6">삭제</button></div>
    </div>`;
  };

  return `
  <div class="uc" style="margin-bottom:14px">
    <div class="uc-ttl">새 문의 / 기록</div>
    <div style="display:flex;gap:5px;margin:8px 0 6px;flex-wrap:wrap">
      <select class="fi" id="lg-kind-${escAttr(x.id)}" style="width:84px;font-size:11.5px;padding:6px">
        <option value="inquiry">문의</option><option value="note">기록</option></select>
      <select class="fi" id="lg-ch-${escAttr(x.id)}" style="width:82px;font-size:11.5px;padding:6px">
        ${channels().map(c => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.label)}</option>`).join('')}</select>
      <select class="fi" id="lg-cat-${escAttr(x.id)}" style="width:82px;font-size:11.5px;padding:6px">
        ${logCats().map(c => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.label)}</option>`).join('')}</select>
      <input class="fi" id="lg-who-${escAttr(x.id)}" placeholder="문의한 사람" list="lg-people-${escAttr(x.id)}" style="flex:1;min-width:100px;font-size:11.5px;padding:6px">
      <datalist id="lg-people-${escAttr(x.id)}">${people.map(p => `<option value="${escapeHtml(p)}">`).join('')}</datalist>
    </div>
    <input class="fi" id="lg-sub-${escAttr(x.id)}" placeholder="제목 / 한 줄 요약" style="font-size:12px;margin-bottom:5px">
    <textarea class="fi" id="lg-body-${escAttr(x.id)}" rows="3" placeholder="받은 메일 내용을 그대로 붙여넣어도 돼요" style="font-size:12px"></textarea>
    <div style="text-align:right;margin-top:6px">
      <button class="btn bp bs" onclick="addExhLog('${escAttr(x.id)}')">등록</button></div>
  </div>

  ${open.length ? `<div class="sct">답변 대기 <span class="pill p-amber">${open.length}</span></div>
    <div style="margin-bottom:14px">${open.map(item).join('')}</div>` : ''}

  <div class="sct">전체 이력</div>
  ${rest.length ? rest.map(item).join('')
    : '<div style="font-size:11.5px;color:var(--i5);padding:10px 2px">아직 기록이 없어요</div>'}
  `;
}


/* 화면의 onclick이 부르는 것 */
window.dLogs = dLogs;   // 탭(exh-drawer.js)이 window로 부른다
