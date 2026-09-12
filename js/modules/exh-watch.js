/* ══════════════════════════════════════════════════════════════
   exh-watch.js — 지켜보는 폴더

   기업이 로고나 도면을 보내면 OneDrive 폴더에 쌓인다. 무엇이 새로 들어왔는지
   알려면 폴더를 열어 수정 날짜로 정렬해 눈으로 훑어야 했다. 폴더가 여러 개면
   여러 번이고, 훑고 나서도 "이건 내가 본 건가"는 어디에도 안 남는다.

   여기서 하는 일은 셋이다.
     ① 폴더를 훑어 무엇이 있는지 적어 둔다
     ② 지난번과 견주어 새로 들어온 것·바뀐 것·없어진 것을 가른다
     ③ 담당자가 «확인»을 누르면 누가 언제 봤는지 남긴다

   ── 왜 PC에서만 훑는가 ──
   브라우저는 임의 경로를 읽지 못한다. 사람이 한 번 고른 폴더만 읽을 수 있고
   (File System Access API), 그마저 Chrome·Edge 데스크톱에만 있다. 휴대폰
   브라우저에는 아예 없다.

   그래서 훑기는 PC에서 하고 결과는 DB에 남긴다. 휴대폰에서는 그 결과를 보고
   확인 단추를 누른다 — 폴더를 직접 열지 않아도 되는 목적은 이걸로 닿는다.

   ── 왜 바뀌면 확인이 풀리는가 ──
   같은 이름으로 다시 올리는 일이 잦다(로고를 고쳐 보내면 파일명이 같다).
   한 번 확인했다고 계속 확인된 채로 두면, 고쳐 보낸 파일을 아무도 안 본 채
   지나간다. 그래서 수정 시각이 바뀌면 확인을 비운다.

   ── 왜 없어진 파일을 지우지 않는가 ──
   확인까지 마친 파일이 조용히 사라지면 그 자체가 봐야 할 일이다. 지우는 대신
   «없어짐»으로 남겨 두고, 확인을 누르면 목록에서 접힌다.
═══════════════════════════════════════════════════════════════ */

import { WATCH_FOLDERS, WATCH_FILES, watchFoldersFor, currentUser } from '../state.js';
import { escapeHtml, escAttr } from '../utils.js';
import { saveWatchFolder, deleteWatchFolder, saveWatchFiles } from '../api.js';
import { trackAction } from './audit-tab.js';
import {
  supported, pickFolder, delHandle, readyFolder, folderLabel, scanFolder,
} from './local-folder.js';

/* 폴더 손잡이는 브라우저마다 따로 산다. DB의 폴더 줄(id)을 열쇠로 삼아
   이 PC에서 어느 실제 폴더를 가리키는지 IndexedDB에 매어 둔다. */
const handleKey = (folderId) => `watch:${folderId}`;

const now = () => new Date().toISOString();
const whoAmI = () => (currentUser && (currentUser.name || currentUser.email)) || '';

/* 이 PC에서 폴더가 매여 있는지 — 그림을 그릴 때마다 묻지 않도록 모아 둔다
   (권한 창은 사람이 무언가를 누른 직후에만 뜰 수 있다). */
const boundNames = {};

export async function initWatchFolders(evKey){
  if(!supported()) return;
  await Promise.all(watchFoldersFor(evKey).map(async (f) => {
    boundNames[f.id] = await folderLabel(handleKey(f.id));
  }));
  renderWatchBodyIfOpen();
}

/* ══ 파일 한 줄의 상태 ══
   확인이 필요한 것을 위로 올리는 게 이 화면의 전부다. */
export function fileState(f){
  if(f.gone_at && !f.checked_at) return { key: 'gone',    label: '없어짐',   cls: 'p-amber' };
  if(f.gone_at)                  return { key: 'gone-ok', label: '없어짐',   cls: 'p-gray'  };
  if(f.checked_at)               return { key: 'ok',      label: '확인함',   cls: 'p-green' };
  if(f.changed_at && f.first_seen_at && f.changed_at !== f.first_seen_at)
                                 return { key: 'changed', label: '바뀜',     cls: 'p-blue'  };
  return { key: 'new', label: '새로 들어옴', cls: 'p-blue' };
}
const needsEye = (f) => !f.checked_at;

const fmtSize = (v) => {
  const n = Number(v);
  if(!Number.isFinite(n) || n <= 0) return '';
  if(n < 1024) return n + 'B';
  if(n < 1024 * 1024) return Math.round(n / 1024) + 'KB';
  return (n / 1024 / 1024).toFixed(1) + 'MB';
};
const fmtWhen = (iso) => {
  if(!iso) return '';
  const d = new Date(iso);
  if(isNaN(d)) return String(iso);
  return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/* ══════════════════════════════════════════
   폴더 등록 · 매기 · 잊기
══════════════════════════════════════════ */
export async function addWatchFolder(evKey){
  const name = prompt('이 폴더를 뭐라고 부를까요?\n예: 로고, 부스도면, 그래픽 원본');
  if(!name || !name.trim()) return;
  const row = {
    id: 'WF-' + Date.now(),
    event_id: evKey, name: name.trim(), path_hint: '', note: '', active: 'yes',
    sort_order: watchFoldersFor(evKey).length + 1,
    scanned_at: '', scanned_by: '', created_at: now(),
  };
  WATCH_FOLDERS.push(row);
  renderWatchBodyIfOpen();
  const res = await saveWatchFolder(row);
  if(!res.ok){
    const i = WATCH_FOLDERS.indexOf(row);
    if(i >= 0) WATCH_FOLDERS.splice(i, 1);
    renderWatchBodyIfOpen();
    alert('폴더를 등록하지 못했어요. 네트워크 확인 후 다시 시도해주세요.');
    return;
  }
  trackAction('add', '지켜보는 폴더 추가', row.name, `<b>${escapeHtml(row.name)}</b> 폴더를 지켜보기로 했어요`);
  /* 등록했으면 바로 이 PC의 폴더에 매어 준다 — 두 단계로 나누면 «등록은 됐는데
     아무것도 안 보이는» 상태에서 멈춘다. */
  if(supported()) await bindWatchFolder(row.id);
}

export async function bindWatchFolder(folderId){
  const f = WATCH_FOLDERS.find(x => x.id === folderId);
  if(!f) return;
  if(!supported()){
    alert('이 브라우저는 폴더를 읽지 못해요.\nPC의 Chrome이나 Edge에서 한 번 매어 두면, 휴대폰에서는 결과만 보면 됩니다.');
    return;
  }
  try {
    const h = await pickFolder(handleKey(folderId));
    if(!h) return;                                   // 취소
    boundNames[folderId] = h.name;
    if(f.path_hint !== h.name){
      f.path_hint = h.name;
      await saveWatchFolder({ id: f.id, path_hint: h.name });
    }
    renderWatchBodyIfOpen();
    await scanWatchFolder(folderId);                 // 매자마자 한 번 훑는다
  } catch(e){
    alert('폴더를 열지 못했어요: ' + e.message);
  }
}

export async function unbindWatchFolder(folderId){
  await delHandle(handleKey(folderId));
  boundNames[folderId] = null;
  renderWatchBodyIfOpen();
}

export async function removeWatchFolder(folderId){
  const f = WATCH_FOLDERS.find(x => x.id === folderId);
  if(!f) return;
  const n = WATCH_FILES.filter(w => w.folder_id === folderId).length;
  if(!confirm(`«${f.name}» 폴더를 목록에서 뺄까요?\n`
    + `지금까지 본 파일 ${n}건의 확인 기록도 함께 사라집니다.\n`
    + `(실제 폴더와 파일은 그대로 있습니다)`)) return;
  const i = WATCH_FOLDERS.indexOf(f);
  if(i >= 0) WATCH_FOLDERS.splice(i, 1);
  for(let k = WATCH_FILES.length - 1; k >= 0; k--){
    if(WATCH_FILES[k].folder_id === folderId) WATCH_FILES.splice(k, 1);
  }
  await delHandle(handleKey(folderId));
  renderWatchBodyIfOpen();
  await deleteWatchFolder(folderId);
  trackAction('delete', '지켜보는 폴더 삭제', f.name, `<b>${escapeHtml(f.name)}</b> 폴더를 목록에서 뺐어요`);
}

/* ══════════════════════════════════════════
   훑기 — 지난번과 견준다

   견주는 일만 따로 떼어 둔다. 폴더를 읽는 일(브라우저 권한)과 저장하는 일
   (네트워크)에 묶여 있으면, 정작 중요한 규칙 — «바뀌면 확인이 풀린다» — 이
   맞는지 확인할 길이 없다. 여기 있는 건 들어온 목록과 지난 목록뿐이다.

   before를 그 자리에서 고친다(=화면이 보고 있는 바로 그 객체다). added는
   아직 목록에 없는 새 줄이라 부르는 쪽이 넣는다.
══════════════════════════════════════════ */
export function diffScan(before, files, stamp, folder){
  const byPath = new Map(before.map(w => [w.rel_path, w]));
  const seen = new Set();
  const changed = [], added = [];
  let nNew = 0, nChg = 0, nGone = 0;

  files.forEach(s => {
    seen.add(s.rel);
    const mtime = s.mtime == null ? '' : String(s.mtime);
    const old = byPath.get(s.rel);
    if(!old){
      const row = {
        id: 'WFI-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        folder_id: folder.id, event_id: folder.event_id, rel_path: s.rel, name: s.name,
        size: s.size == null ? '' : String(s.size), mtime,
        first_seen_at: stamp, changed_at: stamp, gone_at: '',
        checked_at: '', checked_by: '', note: '',
      };
      added.push(row); changed.push(row); nNew++;
      return;
    }
    /* 읽지 못한 파일(동기화 중)은 «안 바뀐 것»으로 둔다 — 여기서 mtime을 비워
       버리면 다음 훑기에 멀쩡한 파일이 전부 «바뀜»으로 되살아난다. */
    const moved = mtime && String(old.mtime || '') !== mtime;
    const back  = !!old.gone_at;
    if(!moved && !back) return;
    if(moved){
      old.mtime = mtime;
      old.size = s.size == null ? old.size : String(s.size);
      old.changed_at = stamp;
      // 같은 이름으로 고쳐 보낸 파일이 «이미 확인함»인 채로 지나가면 안 된다
      old.checked_at = ''; old.checked_by = '';
      nChg++;
    }
    if(back) old.gone_at = '';
    changed.push(old);
  });

  before.forEach(w => {
    if(seen.has(w.rel_path) || w.gone_at) return;
    w.gone_at = stamp; w.checked_at = ''; w.checked_by = '';
    changed.push(w); nGone++;
  });

  return { changed, added, counts: { nNew, nChg, nGone } };
}

let scanning = '';

export async function scanWatchFolder(folderId){
  const f = WATCH_FOLDERS.find(x => x.id === folderId);
  if(!f || scanning) return;
  const dir = await readyFolder(handleKey(folderId));
  if(!dir){
    alert('이 PC에 폴더가 매여 있지 않아요. 「폴더 고르기」로 한 번 골라주세요.');
    return;
  }

  scanning = folderId;
  renderWatchBodyIfOpen();
  try {
    const { files, truncated } = await scanFolder(dir);
    const stamp = now();
    const before = WATCH_FILES.filter(w => w.folder_id === folderId);
    const { changed, added, counts } = diffScan(before, files, stamp, f);
    added.forEach(r => WATCH_FILES.push(r));
    const { nNew, nChg, nGone } = counts;

    f.scanned_at = stamp; f.scanned_by = whoAmI();
    renderWatchBodyIfOpen();

    /* 폴더 줄은 넘긴 칸만 고치고(부분 갱신), 파일은 전체 레코드로 한꺼번에
       보낸다. 파일 쪽은 확인 기록까지 담아 보내야 덮어써도 안 지워진다. */
    await saveWatchFolder({ id: f.id, scanned_at: stamp, scanned_by: f.scanned_by });
    if(changed.length){
      const res = await saveWatchFiles(changed.map(w => ({ ...w })));
      if(!res.ok) alert('훑기는 됐는데 기록을 저장하지 못했어요. 네트워크 확인 후 다시 훑어주세요.');
    }

    if(nNew || nChg || nGone){
      trackAction('update', '폴더 훑기', f.name,
        `<b>${escapeHtml(f.name)}</b> — 새로 ${nNew}건 · 바뀜 ${nChg}건 · 없어짐 ${nGone}건`);
    }
    if(truncated) alert('파일이 너무 많아 일부만 훑었어요. 더 좁은 폴더를 골라주세요.');
  } catch(e){
    alert('훑는 중에 멈췄어요: ' + e.message);
  } finally {
    scanning = '';
    renderWatchBodyIfOpen();
  }
}

export async function scanAllWatchFolders(evKey){
  for(const f of watchFoldersFor(evKey)){
    if(await readyFolder(handleKey(f.id))) await scanWatchFolder(f.id);
  }
}

/* ══════════════════════════════════════════
   확인 — 누가 언제 봤나
══════════════════════════════════════════ */
export async function checkWatchFile(fileId){
  const w = WATCH_FILES.find(x => x.id === fileId);
  if(!w) return;
  const on = !w.checked_at;
  const before = { checked_at: w.checked_at, checked_by: w.checked_by };
  w.checked_at = on ? now() : '';
  w.checked_by = on ? whoAmI() : '';
  renderWatchBodyIfOpen();
  const res = await saveWatchFiles([{ ...w }]);
  if(!res.ok){
    Object.assign(w, before);
    renderWatchBodyIfOpen();
    alert('확인 기록을 저장하지 못했어요.');
  }
}

export async function checkAllInFolder(folderId){
  const todo = WATCH_FILES.filter(w => w.folder_id === folderId && needsEye(w));
  if(!todo.length) return;
  const f = WATCH_FOLDERS.find(x => x.id === folderId);
  if(!confirm(`«${f ? f.name : ''}»의 확인 안 한 ${todo.length}건을 모두 확인 처리할까요?`)) return;
  const stamp = now(), who = whoAmI();
  const before = todo.map(w => ({ w, checked_at: w.checked_at, checked_by: w.checked_by }));
  todo.forEach(w => { w.checked_at = stamp; w.checked_by = who; });
  renderWatchBodyIfOpen();
  const res = await saveWatchFiles(todo.map(w => ({ ...w })));
  if(!res.ok){
    before.forEach(b => Object.assign(b.w, { checked_at: b.checked_at, checked_by: b.checked_by }));
    renderWatchBodyIfOpen();
    alert('확인 기록을 저장하지 못했어요.');
    return;
  }
  trackAction('update', '파일 확인', f ? f.name : '', `<b>${todo.length}건</b>을 확인했어요`);
}

/* ══════════════════════════════════════════
   그리기
══════════════════════════════════════════ */
let watchFil = 'need';        // need | all | gone
export function setWatchFil(v){ watchFil = v; renderWatchBodyIfOpen(); }

let openFolders = new Set();
export function toggleWatchFolder(id){
  if(openFolders.has(id)) openFolders.delete(id); else openFolders.add(id);
  renderWatchBodyIfOpen();
}

function renderWatchBodyIfOpen(){
  const el = document.getElementById('exh-watch-body');
  if(el) el.innerHTML = watchBodyHtml(el.dataset.ev || '');
}

export function renderWatchView(evKey){
  return `<div id="exh-watch-body" data-ev="${escAttr(evKey)}">${watchBodyHtml(evKey)}</div>`;
}

function watchBodyHtml(evKey){
  const folders = watchFoldersFor(evKey);
  const canScan = supported();

  const head = `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <button class="btn bp bs" onclick="addWatchFolder('${escAttr(evKey)}')">폴더 추가</button>
    ${canScan && folders.length
      ? `<button class="btn bs" onclick="scanAllWatchFolders('${escAttr(evKey)}')">전부 다시 훑기</button>` : ''}
    ${!canScan ? `<span style="font-size:11px;color:var(--i4)">
      폴더를 읽는 건 PC의 Chrome·Edge에서만 돼요 — 여기서는 훑어 둔 결과를 보고 확인만 합니다</span>` : ''}
  </div>`;

  if(!folders.length){
    return head + `<div class="empty" style="padding:26px 16px">
      <div style="font-size:13px;font-weight:700;margin-bottom:6px">지켜보는 폴더가 없어요</div>
      <div style="font-size:12px;color:var(--i4);line-height:1.6">
        로고·도면처럼 기업이 보내오는 파일이 쌓이는 폴더를 등록해두면,<br>
        무엇이 새로 들어왔는지와 담당자가 확인했는지를 여기서 봅니다.<br>
        폴더를 고르는 건 PC에서 한 번만 하면 돼요.</div></div>`;
  }

  /* 위쪽 한 줄 요약 — 폴더를 펴 보지 않고도 «오늘 볼 게 있나»를 안다 */
  const all = folders.flatMap(f => WATCH_FILES.filter(w => w.folder_id === f.id));
  const need = all.filter(needsEye).length;
  const pills = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
    ${[['need', `확인 필요 ${need}`], ['all', `전체 ${all.length}`],
       ['gone', `없어짐 ${all.filter(w => w.gone_at).length}`]].map(([k, l]) =>
      `<button class="pill ${watchFil === k ? 'p-blue' : 'p-gray'}" style="border:0;cursor:pointer;font:inherit"
        onclick="setWatchFil('${k}')">${escapeHtml(l)}</button>`).join('')}
  </div>`;

  const body = folders.map(f => folderBlock(f, canScan)).join('');
  return head + pills + body;
}

function folderBlock(f, canScan){
  const files = WATCH_FILES.filter(w => w.folder_id === f.id);
  const need  = files.filter(needsEye).length;
  const bound = boundNames[f.id];
  const busy  = scanning === f.id;
  const open  = openFolders.has(f.id) || need > 0;

  const shown = files.filter(w =>
      watchFil === 'need' ? needsEye(w)
    : watchFil === 'gone' ? !!w.gone_at
    : true)
    .sort((a, b) => (needsEye(b) - needsEye(a))
      || String(b.changed_at || '').localeCompare(String(a.changed_at || ''))
      || String(a.rel_path || '').localeCompare(String(b.rel_path || ''), 'ko', { numeric: true }));

  const rows = shown.map(w => {
    const st = fileState(w);
    const dir = w.rel_path.includes('/') ? w.rel_path.slice(0, w.rel_path.lastIndexOf('/')) : '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 2px;border-bottom:1px solid var(--i8)">
      <input type="checkbox" ${w.checked_at ? 'checked' : ''} onchange="checkWatchFile('${escAttr(w.id)}')"
        title="확인했으면 체크하세요" style="flex:0 0 auto;width:16px;height:16px">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${
          w.gone_at ? ';text-decoration:line-through;color:var(--i4)' : ''}"
          title="${escAttr(w.rel_path)}">${escapeHtml(w.name)}</div>
        <div style="font-size:10px;color:var(--i5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${
          dir ? escapeHtml(dir) + ' · ' : ''}${escapeHtml(fmtWhen(w.changed_at))}${
          w.size ? ' · ' + escapeHtml(fmtSize(w.size)) : ''}${
          w.checked_at ? ` · ${escapeHtml(w.checked_by || '')} 확인 ${escapeHtml(fmtWhen(w.checked_at))}` : ''}</div>
      </div>
      <span class="pill ${st.cls}" style="flex:0 0 auto;font-size:9.5px">${escapeHtml(st.label)}</span>
    </div>`;
  }).join('');

  return `<div style="border:1px solid var(--i6);border-radius:10px;padding:11px 13px;margin-bottom:10px;background:var(--i9)">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span style="font-size:13px;font-weight:800;cursor:pointer" onclick="toggleWatchFolder('${escAttr(f.id)}')">${
        escapeHtml(f.name)}</span>
      ${need ? `<span class="pill p-blue">확인 필요 ${need}</span>`
             : `<span class="pill p-green">다 봤어요</span>`}
      <span style="font-size:10.5px;color:var(--i5)">${files.length}개 파일${
        f.scanned_at ? ` · ${escapeHtml(fmtWhen(f.scanned_at))} 훑음` : ' · 아직 훑은 적 없어요'}${
        f.scanned_by ? ` (${escapeHtml(f.scanned_by)})` : ''}</span>
      <span style="margin-left:auto;display:flex;gap:4px;flex-wrap:wrap">
        ${canScan && bound
          ? `<button class="btn bs" ${busy ? 'disabled' : ''} onclick="scanWatchFolder('${escAttr(f.id)}')">${
              busy ? '훑는 중…' : '다시 훑기'}</button>` : ''}
        ${canScan
          ? `<button class="btn bs" onclick="bindWatchFolder('${escAttr(f.id)}')" title="${
              escAttr(bound ? `지금 «${bound}» 폴더를 보고 있어요` : '이 PC에서 볼 폴더를 고릅니다')}">${
              bound ? '폴더 바꾸기' : '폴더 고르기'}</button>` : ''}
        ${need ? `<button class="btn bs" onclick="checkAllInFolder('${escAttr(f.id)}')">모두 확인</button>` : ''}
        <button class="btn bs" onclick="removeWatchFolder('${escAttr(f.id)}')" title="목록에서 빼기">빼기</button>
      </span>
    </div>
    ${canScan && !bound ? `<div style="font-size:11px;color:var(--am);margin-top:6px">
      이 PC에는 아직 폴더가 매여 있지 않아요 — 「폴더 고르기」를 누르면 훑기 시작합니다</div>` : ''}
    ${!canScan && !f.scanned_at ? `<div style="font-size:11px;color:var(--i4);margin-top:6px">
      PC에서 한 번 훑어야 목록이 생겨요</div>` : ''}
    ${open && shown.length ? `<div style="margin-top:8px">${rows}</div>`
      : open && files.length ? `<div style="font-size:11.5px;color:var(--i4);margin-top:8px">이 조건에 맞는 파일이 없어요</div>`
      : ''}
  </div>`;
}

window.addWatchFolder       = addWatchFolder;
window.bindWatchFolder      = bindWatchFolder;
window.unbindWatchFolder    = unbindWatchFolder;
window.removeWatchFolder    = removeWatchFolder;
window.scanWatchFolder      = scanWatchFolder;
window.scanAllWatchFolders  = scanAllWatchFolders;
window.checkWatchFile       = checkWatchFile;
window.checkAllInFolder     = checkAllInFolder;
window.setWatchFil          = setWatchFil;
window.toggleWatchFolder    = toggleWatchFolder;
