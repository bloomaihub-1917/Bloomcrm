/* ══════════════════════════════════════════════════════════════
   local-folder.js — 지정한 로컬 폴더에 파일을 쓴다

   내보낸 파일은 브라우저 다운로드 폴더에 떨어지고, 사람이 그걸 OneDrive의
   행사 폴더로 옮겼다. 파일 하나면 몇 초지만 59개사면 59번이고, 옮기다 놓친
   파일은 어디에도 없는 채로 잊힌다.

   브라우저는 임의 경로에 파일을 쓸 수 없다 — 대신 사람이 폴더를 한 번 고르면
   그 폴더에 계속 쓸 수 있게 해 주는 창구가 있다(File System Access API).
   OneDrive 동기화 폴더를 고르면 우리가 로컬에 쓰고 OneDrive가 클라우드로
   올린다. 별도 계정 연동이 없어 오늘 쓸 수 있다.

   ── 폴더를 기억하는 방법 ──
   고른 폴더의 손잡이(FileSystemDirectoryHandle)는 문자열이 아니라 객체다.
   localStorage에는 못 넣고 IndexedDB에만 들어간다. 그래서 작은 저장소를 하나
   둔다. 새로고침한 뒤에는 권한이 잠들어 있어 다시 물어야 하는데, 그 물음은
   사람이 무언가를 누른 직후에만 뜰 수 있다 — 그래서 이 함수들은 모두 버튼
   클릭에서 시작해야 한다.

   ── 되지 않는 브라우저 ──
   Chrome·Edge 데스크톱에만 있다. supported()가 false면 부르는 쪽이 다운로드로
   되돌아가야 한다 — 여기서 대신 다운로드하지는 않는다(무엇으로 되돌아갈지는
   부르는 쪽이 안다).
═══════════════════════════════════════════════════════════════ */

const DB_NAME = 'bloom-crm-folders';
const STORE = 'handles';

export const supported = () => typeof window.showDirectoryPicker === 'function';

function openDb(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('폴더 기억 저장소를 열지 못했어요'));
  });
}

function tx(mode, fn){
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req && req.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  }));
}

/* 사생활 보호 창처럼 IndexedDB가 막힌 데서는 조용히 없는 것으로 본다 —
   폴더를 기억하지 못할 뿐이고, 그때마다 고르면 쓸 수 있다. */
const quiet = (p) => p.catch(() => null);

export const getHandle = (key) => quiet(tx('readonly', s => s.get(key)));
export const setHandle = (key, h) => quiet(tx('readwrite', s => s.put(h, key)));
export const delHandle = (key) => quiet(tx('readwrite', s => s.delete(key)));

/* 권한 확인 — 새로고침 뒤에는 'prompt'로 잠들어 있다. 클릭에서 불러야 물음이 뜬다. */
export async function ensurePermission(h, mode = 'readwrite'){
  if(!h || !h.queryPermission) return false;
  if(await h.queryPermission({ mode }) === 'granted') return true;
  try { return await h.requestPermission({ mode }) === 'granted'; }
  catch(e){ return false; }
}

/* 폴더 고르기 — 고르면 기억한다. 취소하면 null(오류가 아니다). */
export async function pickFolder(key, startIn){
  if(!supported()) throw new Error('이 브라우저는 폴더 저장을 지원하지 않아요 (Chrome·Edge 데스크톱)');
  let h;
  try {
    h = await window.showDirectoryPicker({ id: key, mode: 'readwrite', startIn });
  } catch(e){
    if(e && e.name === 'AbortError') return null;   // 사람이 취소했다
    throw e;
  }
  await setHandle(key, h);
  return h;
}

/* 기억해 둔 폴더를 쓸 수 있는 상태로 돌려준다. 없거나 권한을 못 받으면 null. */
export async function readyFolder(key){
  const h = await getHandle(key);
  if(!h) return null;
  return (await ensurePermission(h)) ? h : null;
}

/* 이름만 — 화면에 "어디에 저장되나"를 적으려고 쓴다. 권한을 묻지 않는다
   (그림을 그리는 중에 권한 창이 뜨면 안 된다). */
export async function folderLabel(key){
  const h = await getHandle(key);
  return h ? h.name : null;
}

/* 하위 폴더 찾기 — 없으면 만든다.

   기업 폴더는 "42-43. Parexel"처럼 부스번호가 앞에 붙어 있고, 뒤의 이름이 CRM의
   영문명과 늘 같지는 않다("13-14. Fortrea Korea Limited" ↔ CRM "Fortrea").
   이름으로만 찾으면 같은 기업의 폴더가 둘로 갈린다. 그래서 앞자리(prefix)로
   먼저 찾고, 없을 때만 새로 만든다. */
export async function subFolder(dir, name, prefix){
  if(prefix){
    for await (const [entry, handle] of dir.entries()){
      if(handle.kind === 'directory' && entry.startsWith(prefix)) return handle;
    }
  }
  return dir.getDirectoryHandle(name, { create: true });
}

/* 파일 쓰기 — 같은 이름이 있으면 덮어쓴다. 같은 인보이스를 다시 뽑는 일은
   "고쳐서 다시 낸다"는 뜻이고, 다시 낼 때마다 (1)(2)가 붙으면 어느 것이
   최신인지 알 수 없어진다. 발행을 새로 하면 번호가 달라져 파일도 갈린다. */
export async function writeFile(dir, name, blob){
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try { await w.write(blob); } finally { await w.close(); }
  return fh;
}

/* ══════════════════════════════════════════
   폴더 훑기 — 무엇이 들어와 있나

   하위 폴더까지 내려간다. 로고 폴더는 「42-43. Parexel」처럼 기업별 폴더가
   한 겹 있고, 그 안에 파일이 있다. 한 겹만 보면 아무것도 못 본다.

   숨김 파일과 OneDrive가 만드는 찌꺼기는 뺀다 — 사람이 넣은 적 없는 파일이
   «새로 들어왔다»고 뜨면, 그 목록은 곧 안 보게 된다.

   깊이를 막아 둔다. 잘못 고른 폴더(예: OneDrive 루트)를 끝까지 훑다 브라우저가
   멈추는 것보다, 덜 훑고 «너무 깊어요»라고 말하는 편이 낫다.
══════════════════════════════════════════ */
const SKIP_NAME = /^(~\$|\.|desktop\.ini$|thumbs\.db$)/i;
const MAX_DEPTH = 4;
const MAX_FILES = 3000;

export async function scanFolder(dir, { maxDepth = MAX_DEPTH, maxFiles = MAX_FILES } = {}){
  const out = [];
  let truncated = false;

  async function walk(d, prefix, depth){
    if(depth > maxDepth || truncated) return;
    for await (const [name, handle] of d.entries()){
      if(SKIP_NAME.test(name)) continue;
      if(out.length >= maxFiles){ truncated = true; return; }
      const rel = prefix ? prefix + '/' + name : name;
      if(handle.kind === 'directory'){ await walk(handle, rel, depth + 1); continue; }
      try {
        const f = await handle.getFile();
        out.push({ rel, name, size: f.size, mtime: f.lastModified });
      } catch(e){
        /* 동기화 중이라 아직 못 읽는 파일이 있다. 건너뛰면 다음 훑기에서
           잡히지만, 없어진 것으로 오해하면 안 되므로 표시해 둔다. */
        out.push({ rel, name, size: null, mtime: null, unreadable: true });
      }
    }
  }

  await walk(dir, '', 1);
  return { files: out, truncated };
}
