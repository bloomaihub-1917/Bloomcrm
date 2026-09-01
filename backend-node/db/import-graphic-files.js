/* ══════════════════════════════════════════════════════════════
   import-graphic-files.js — 그래픽 폴더를 훑어 "파일 받음"을 채운다

   OneDrive의 Graphic 폴더가 진짜 접수대장 노릇을 하고 있는데, CRM에는 두 곳만
   받은 날이 찍혀 있었다. 사양서까지 써 둔 건이 화면에서는 "전달 전"으로 남아
   있어서, 아직 안 온 곳과 이미 온 곳이 구분되지 않았다.

   폴더는 "<부스번호>. <기업명> (메모)" 꼴이다. 앞자리는 프로그램북 순번이
   아니라 부스번호다 — 로고 폴더와 다르다. 8번은 써모피셔(순번 50), 37번은
   심유(순번 47)로, 순번으로 읽으면 전혀 다른 회사에 붙는다.

   받은 날은 그 회사가 보낸 파일의 가장 이른 수정일이다. 사양서는 우리가 쓴
   문서라 세지 않는다 — 그걸 세면 우리가 정리한 날이 기업이 보낸 날이 된다.
   한 회사가 랩핑·인포데스크처럼 여러 폴더에 걸쳐 있으면 그중 가장 이른 날이다.

   독립부스는 건드리지 않는다. 자체시공 도면이라 우리가 출력·제작하는 그래픽이
   아니고, 여기에 받은 날을 찍으면 그래픽 발주 목록이 실제보다 부풀어 오른다.

   이미 받은 날이 있는 곳은 덮어쓰지 않는다. 사람이 손으로 적어 둔 날짜가
   파일 수정일보다 사정을 더 안다(써모피셔 8/30, PSI 8/31).

     node db/import-graphic-files.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EVENT = '2026 KIC';
const ROOT = 'C:/Users/cdaky/OneDrive - STUDIO BLOOM/4.행사/2026년/'
  + '1013-1015 KoNECT International Conference/300. 전시/Graphic';

/* 최상위 폴더가 곧 유형이다. 독립부스는 대상이 아니라 빠져 있다. */
const KIND = { '디자인 출력': 'print', '디자인 의뢰': 'design' };

const squash = (v) => String(v || '').toLowerCase()
  .replace(/\(주\)|\(유\)|주식회사|㈜|유한회사|inc\.?|corp\.?|co\.?|ltd\.?|llc\.?/g, '')
  .replace(/[^a-z0-9가-힣]/g, '');

/* 폴더명 "13-14. Fortrea (확인 O)" → { no:'13-14', name:'Fortrea' } */
function parseDir(name){
  const m = name.match(/^(\d+(?:-\d+)?)\s*[.]\s*(.+)$/);
  if(!m) return null;
  return { no: m[1], name: m[2].replace(/\s*\([^)]*\)\s*$/, '').trim() };
}

/* 기업이 보낸 파일만 센다 — 사양서는 우리 문서다 */
const isTheirFile = (f) => !/사양서/.test(f);

/* 하위 폴더까지 훑어 가장 이른 수정일을 찾는다 (없으면 null) */
function earliestMtime(dir){
  let best = null;
  for(const e of fs.readdirSync(dir, { withFileTypes: true })){
    const p = path.join(dir, e.name);
    const t = e.isDirectory() ? earliestMtime(p)
      : (isTheirFile(e.name) ? fs.statSync(p).mtime : null);
    if(t && (!best || t < best)) best = t;
  }
  return best;
}

/* "<번호>. <이름>" 폴더를 깊이 상관없이 모은다 — 출력은 품목별 하위 폴더가,
   블록부스는 블록별 하위 폴더가 한 겹 더 있다.

   품목 폴더도 "01. 랩핑 PVC 켈지"처럼 번호로 시작해서 이름만으로는 기업 폴더와
   구분되지 않는다. 안에 또 번호 폴더가 있으면 분류로 보고 한 겹 더 내려간다 —
   기업 폴더 밑에는 "블럭 A_최종"처럼 번호 없는 폴더만 있다. */
const isCategory = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .some((e) => e.isDirectory() && parseDir(e.name));

function collect(dir, out){
  for(const e of fs.readdirSync(dir, { withFileTypes: true })){
    if(!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    const hit = parseDir(e.name);
    if(!hit || isCategory(p)){ collect(p, out); continue; }
    if(!fs.readdirSync(p).length) continue;   // 자리만 만들어 둔 분류 폴더
    out.push({ ...hit, at: earliestMtime(p), from: path.relative(ROOT, p) });
  }
  return out;
}

const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  .toISOString().slice(0, 10);

(async () => {
  const client = await pool.connect();
  try {
    const found = [];
    for(const [top, kind] of Object.entries(KIND)){
      const dir = path.join(ROOT, top);
      if(!fs.existsSync(dir)){ console.log(`⚠ 폴더 없음: ${top}`); continue; }
      collect(dir, found).filter((f) => !f.kind).forEach((f) => { f.kind = f.kind || kind; });
    }

    const { rows } = await client.query(
      `SELECT id, booth_no, company_name, graphic_ordered_at, graphic_type,
              graphic_stage, graphic_received_at
         FROM exhibitors WHERE event_id = $1`, [EVENT]);

    /* 한 회사가 여러 폴더에 걸쳐 있다 — 부스번호로 묶고 가장 이른 날을 남긴다 */
    const byBooth = new Map();
    const empties = [], misses = [];
    for(const f of found){
      if(!f.at){ empties.push(f.from); continue; }
      const cur = byBooth.get(f.no);
      if(!cur) byBooth.set(f.no, { ...f, dirs: [f.from] });
      else { cur.dirs.push(f.from); if(f.at < cur.at) cur.at = f.at; }
    }

    const plan = [];
    for(const [no, f] of byBooth){
      let cands = rows.filter((r) => String(r.booth_no || '').trim() === no);
      if(cands.length > 1) cands = cands.filter((r) => squash(r.company_name) === squash(f.name)) || cands;
      if(!cands.length){ misses.push([f.from, `부스 ${no}에 해당하는 기업 없음`]); continue; }
      const x = cands[0];
      const at = ymd(f.at);

      const patch = {};
      if(!String(x.graphic_received_at || '').trim()) patch.graphic_received_at = at;
      /* 주문일이 비어 있으면 받은 날로 채운다 — 파일이 온 이상 그날엔 이미
         주문건이었다. 주문일이 없으면 그래픽 현황에서 "해당 없음"으로 빠진다. */
      if(!String(x.graphic_ordered_at || '').trim()) patch.graphic_ordered_at = at;
      if(!String(x.graphic_type || '').trim()) patch.graphic_type = f.kind;
      /* 받은 날만 찍고 단계를 두면 화면이 "전달 전"이라고 말한다. 다음 할 일이
         그래픽팀 확인 요청이라는 뜻으로 received까지만 올린다 — 폴더명의
         "확인 O"는 누가 확인한 것인지 폴더만으로는 단정할 수 없다. */
      if(!String(x.graphic_stage || '').trim() && patch.graphic_received_at) patch.graphic_stage = 'received';

      plan.push({ x, f, at, patch });
    }

    plan.sort((a, b) => a.at.localeCompare(b.at));

    console.log(`그래픽 폴더에서 찾은 기업 ${byBooth.size}곳 / 손댈 곳 ${plan.filter((p) => Object.keys(p.patch).length).length}곳\n`);
    for(const p of plan){
      const keys = Object.keys(p.patch);
      console.log(`  부스 ${String(p.f.no).padEnd(6)} ${p.x.company_name.padEnd(22)} ${p.at}  ${keys.length ? keys.map((k) => `${k.replace('graphic_', '')}=${p.patch[k]}`).join(', ') : '— 이미 채워져 있어 그대로 둠'}`);
      p.f.dirs.forEach((d) => console.log(`        ${d}`));
    }
    if(empties.length){ console.log('\n파일이 없어 건너뛴 폴더:'); empties.forEach((e) => console.log(`   ${e}`)); }
    if(misses.length){ console.log('\n짝을 못 지은 폴더:'); misses.forEach(([d, why]) => console.log(`   ${d} — ${why}`)); }

    if(DRY){ console.log('\n--dry 라서 아무것도 바꾸지 않았습니다.'); return; }

    await client.query('BEGIN');
    let n = 0;
    for(const p of plan){
      const keys = Object.keys(p.patch);
      if(!keys.length) continue;
      const sets = keys.map((k, i) => `"${k}" = $${i + 2}`);
      await client.query(
        `UPDATE exhibitors SET ${sets.join(', ')}, updated_at = $${keys.length + 2} WHERE id = $1`,
        [p.x.id, ...keys.map((k) => p.patch[k]), new Date().toISOString().slice(0, 10)]);
      n++;
    }
    await client.query('COMMIT');
    console.log(`\n반영 완료 — ${n}곳`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
