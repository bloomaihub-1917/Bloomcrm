/* ══════════════════════════════════════════════════════════════
   features/upload/upload-logs.js — 업로드 › 수집 로그·기업 병합 관리 하위 탭
   (modules/upload-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { mergeProps, uploadLogs } from '../../state.js';
import { escapeHtml, td } from '../../utils.js';
import { uploadUi } from './upload-ui.js';

/* ═══════════════════════════════════════
   수집 로그 / 기업 병합 관리 하위탭 (원본 3150~3167행)
   up 탭 사이드바의 3개 하위탭(업로드/로그/병합) 전환 + 각 목록 렌더링.
   ※ uploadLogs/mergeProps는 원본에서도 실제로 채워 넣는 로직이 없는
     데모 스캐폴딩 배열이라(항상 빈 배열) 렌더 함수도 그 상태 그대로 옮김.
═══════════════════════════════════════ */
function renderLog(){
  const el = document.getElementById('log-body');
  if(!el) return;
  el.innerHTML = uploadLogs.map(l=>`
    <tr><td>${escapeHtml(l.date)}</td><td style="color:var(--i3)">${escapeHtml(l.source)}</td>
    <td style="font-family:monospace;font-size:11px;color:var(--pu)">${escapeHtml(l.file)}</td>
    <td><span class="pill p-blue">${escapeHtml(l.cat)}</span></td>
    <td style="color:var(--g);font-weight:600">+${l.added}</td><td style="color:var(--i3)">${l.dup}건</td>
    <td style="color:var(--am)">${l.merged}건</td><td style="color:var(--i3)">${escapeHtml(l.by)}</td></tr>`).join('');
}
function renderMerge(){
  const el = document.getElementById('merge-ls');
  if(!el) return;
  el.innerHTML = mergeProps.map(m=>`
    <div style="display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid var(--i7)">
      <div style="flex:1"><div style="font-size:12px;font-weight:600;color:var(--i1)">${escapeHtml(m.a)} <span style="color:var(--i4)">↔</span> ${escapeHtml(m.b)}</div><div style="font-size:10px;color:var(--i3);margin-top:2px">${escapeHtml(m.reason)}</div></div>
      ${m.status==='approved'?'<span class="pill p-green">승인됨</span>':`<button class="btn bp bs" onclick="approveMg('${m.id}',this)">병합 승인</button><button class="btn bs" style="margin-left:4px" onclick="rejectMg('${m.id}',this)">별도 유지</button>`}
    </div>`).join('');
}

/* "병합 승인"/"별도 유지" 버튼 onclick (원본 3165~3166행) */
export function approveMg(id, btn){
  const m = mergeProps.find(x=>x.id===id);
  if(m) m.status='approved';
  const row = btn.closest('div');
  row.querySelector('.btn+.btn')?.remove();
  btn.outerHTML = '<span class="pill p-green">승인됨</span>';
}
export function rejectMg(id, btn){
  btn.closest('div').querySelector('.btn')?.remove();
  btn.outerHTML = '<span class="pill p-gray">별도 유지</span>';
}

/* up 탭 사이드바 하위탭(업로드/로그/기업 병합 관리) 전환 (원본 switchUV, 2208~2216행) */
export function switchUV(v, btn){
  uploadUi.upV = v;
  ['upload','log','merge'].forEach(id=>{const el=document.getElementById('upv-'+id);if(el)el.style.display=id===v?'block':'none'});
  document.querySelectorAll('#arch-up-sub .nr').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  const tt={upload:'업로드 & AI 파서',log:'수집 로그',merge:'기업 병합 관리'};
  const sb={upload:'파일 업로드 후 자동 파싱',log:'업로드 이력 확인',merge:'동일 기업 통합 관리'};
  const ttlEl = document.getElementById('up-ttl');
  if(ttlEl) ttlEl.innerHTML=`${tt[v]} <span class="tb-s">${sb[v]}</span>`;
  if(v==='log') renderLog();
  if(v==='merge') renderMerge();
}


/* 화면의 onclick이 부르는 것 */
window.switchUV               = switchUV;
window.approveMg              = approveMg;
window.rejectMg               = rejectMg;
