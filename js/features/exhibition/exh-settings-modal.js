/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-settings-modal.js — 행사 설정 모달 — 단계별 마감일 + 프로그램북 글자수 한도
   (modules/exh-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { changed, trackAction } from '../../core/audit-log.js';
import { dueInputHtml, followCfg, readDueInput } from '../../shared/mail/follow-up.js';
import { exhEvent } from '../../state.js';
import { escapeHtml } from '../../utils.js';
import { exhCfg, setExhCfg } from './exh-calc.js';
import { BOOK_LIMIT_DEFAULT, DUE_STEPS, bookLimit, exhEventOptions, renderExh, saveExhCfgToSheet } from '../../modules/exh-tab.js';

/* ══════════════════════════════════════════
   행사 설정 모달 — 단계별 마감일 + 프로그램북 글자수 한도

   행사가 바뀌면 마감일도 도록 판형도 바뀐다. 두 가지가 성격은 다르지만 둘 다
   "이 행사는 이렇게 간다"는 약속이라 한 자리에서 정하게 둔다.

   마감일은 행사 공통값이다. 기업마다 따로 봐주는 건 지금 필요가 없고, 있으면
   어느 날짜가 진짜인지 두 군데를 봐야 한다.
══════════════════════════════════════════ */
export function openExhCfg(){
  const cfg = exhCfg(exhEvent);
  const due = cfg.due || {};
  const lim = bookLimit(exhEvent);
  const ev = exhEventOptions().find(e => e.key === exhEvent);

  window.modalShell('exh-cfg-modal', `${ev ? (ev.short || ev.name) : exhEvent} 설정`, `
    <div style="font-size:var(--fs-11_5);color:var(--i4);margin-bottom:10px">
      대부분은 비워 두세요 — 마감이 없으면 ASAP로 보고, 요청한 뒤 ${followCfg(exhEvent).first}일이 지나면
      <b>처리 필요</b>에 «리마인더 보낼 때»로 올라옵니다(기준은 설정 › 행사 관리 › 일정).
      도록 인쇄·반입처럼 정말 넘기면 안 되는 것만 «행사 N일 전»으로 적으세요 — 행사 날짜가 바뀌면 따라갑니다.</div>

    ${DUE_STEPS.map(([key, label]) => `
      <div class="fg" style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap">
        <label class="fl" style="flex:1;margin:0;min-width:120px">${escapeHtml(label)}</label>
        ${dueInputHtml(`cfg-due-${key}`, due[key] || '', exhEvent)}
      </div>`).join('')}

    <div style="font-size:var(--fs-12);font-weight:700;color:var(--i2);margin:18px 0 4px">프로그램북 글자수 한도</div>
    <div style="font-size:var(--fs-11_5);color:var(--i4);margin-bottom:8px">
      도록 지면에 맞춘 회사소개 한도입니다. 둘 중 하나만 넘어도 넘친 것으로 봅니다.
      판형이 바뀌면 여기서 고치면 되고, 이미 받아 둔 소개글은 새 한도로 다시 셉니다.</div>
    <div style="display:flex;gap:10px">
      <div class="fg" style="flex:1"><label class="fl">글자수 (띄어쓰기 포함)</label>
        <input class="fi" type="number" id="cfg-book-chars" value="${escapeHtml(lim.chars)}" min="1"></div>
      <div class="fg" style="flex:1"><label class="fl">단어수</label>
        <input class="fi" type="number" id="cfg-book-words" value="${escapeHtml(lim.words)}" min="1"></div>
    </div>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn" onclick="closeExhCfg()">취소</button>
      <button class="btn bp" onclick="saveExhCfg()">저장</button>
    </div>`);
}

export async function saveExhCfg(){
  const prev = JSON.parse(JSON.stringify(exhCfg(exhEvent)));

  const due = {};
  DUE_STEPS.forEach(([key]) => {
    const v = readDueInput(`cfg-due-${key}`);
    if(v) due[key] = v;   // 빈 칸은 아예 안 담는다 — 마감 없음과 빈 문자열을 구분할 필요가 없다
  });

  const chars = Number(document.getElementById('cfg-book-chars')?.value);
  const words = Number(document.getElementById('cfg-book-words')?.value);
  if(!(chars > 0) || !(words > 0)){ alert('글자수·단어수 한도는 1 이상이어야 해요.'); return; }

  const cfg = { ...prev, due, book: { chars, words } };
  setExhCfg(exhEvent, cfg);
  const r = await saveExhCfgToSheet(exhEvent, cfg);
  if(!r.ok){ setExhCfg(exhEvent, prev); return; }   // 실패하면 되돌린다

  // 무엇이 어떻게 바뀌었는지 남긴다 — 마감일은 나중에 "언제부터 이 날짜였나"를
  // 따지게 되는 값이라 결과만 적어 두면 소용이 없다
  const changed = [];
  DUE_STEPS.forEach(([key, label]) => {
    const a = (prev.due || {})[key] || '', b = due[key] || '';
    if(a !== b) changed.push(`${label} ${a || '없음'} → ${b || '없음'}`);
  });
  const pl = prev.book || {};
  if(pl.chars !== chars || pl.words !== words){
    changed.push(`프로그램북 한도 ${pl.chars || BOOK_LIMIT_DEFAULT.chars}자·${pl.words || BOOK_LIMIT_DEFAULT.words}단어 → ${chars}자·${words}단어`);
  }
  if(changed.length) trackAction('edit', '행사 설정 변경', exhEvent, changed.join(' / '));

  closeExhCfg();
  renderExh();
}

export const closeExhCfg = () => document.getElementById('exh-cfg-modal')?.remove();

window.openExhCfg  = openExhCfg;
window.saveExhCfg  = saveExhCfg;
window.closeExhCfg = closeExhCfg;


