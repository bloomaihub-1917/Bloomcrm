/* ══════════════════════════════════════════════════════════════
   import-speaker-photos.js — 연사 폴더의 사진 → CRM 연사 드로어

   연사 사진은 OneDrive의 «100.연사관리» 아래 연사별 폴더로 들어온다
   («1B-2. Eric Ho», «2B. NorthGlass 패널/Paul Bae (J Partner)»). 폴더를 훑어
   연사와 짝짓고, 사진을 줄여 speaker_photos에 넣는다(routes/photos.js).

     node db/import-speaker-photos.js [--event AIA] [--dir <연사관리 폴더>] [--dry] [--force]

     --dry    무엇을 넣을지만 보여준다
     --force  CRM에 이미 사진이 있는 연사도 갈아 끼운다(기본은 건너뜀 —
              드로어에서 손으로 고른 사진을 폴더 쪽이 덮으면 안 된다)

   ── 짝짓기 ──
   폴더명 앞의 세션 번호(«1B-2. »)와 괄호(«(J Partner)»)를 떼고 연사 국·영문
   이름과 견준다. 하나로 좁혀지지 않는 폴더는 넘기고 보고한다 — 남의 얼굴이
   붙느니 비어 있는 게 낫다. 연사와 안 맞는 폴더(«2B. NorthGlass 패널»)는
   한 단계 안까지 들어가 본다.

   ── 사진 고르기 ──
   폴더에는 여권·신분증·통장 사본·서명도 jpg로 섞여 있다. 그런 이름은 빼고,
   CRM «사진 파일명»(photo_file)과 같은 파일이 있으면 그것을, 없으면 이름에
   사진·photo·portrait가 든 것 → 큰 파일 순으로 고른다.

   speakers 줄(받은 날·파일명)은 건드리지 않는다. 웹에서 모은 사진(«_web»)도
   폴더에 있어서, 폴더에 있다고 «받았다»고 적으면 독촉이 빠진다.
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pool = require('./pool');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const FORCE = argv.includes('--force');
const EVENT = arg('--event') || 'AIA';
const DIR = arg('--dir') || 'C:/Users/cdaky/OneDrive - STUDIO BLOOM/4.행사/2026년/'
  + '1016 AIA Symposium/2026aisymposium/100.연사관리';

const squash = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');

/* «1B-2. Eric Ho» → «Eric Ho», «Paul Bae (J Partner)» → «Paul Bae» */
const folderKey = (d) => squash(d.replace(/^[A-Z0-9]+(-\d+)?\.\s*/i, '').replace(/\([^)]*\)/g, ''));

const isImage = (f) => /\.(jpe?g|png|webp)$/i.test(f);
const NOT_PORTRAIT = /passport|여권|신분증|id[ _-]?(copy|card)|통장|bank|signature|서명|sign\b|logo|로고/i;

function matchSpeaker(dir, speakers) {
  const k = folderKey(dir);
  if (!k) return [];
  /* 폴더명이 이름 뒤에 소속을 붙이는 일이 있다(«이원석 더블유아키텍츠») —
     그래서 같거나, 이름으로 시작하는 것까지 본다 */
  return speakers.filter((s) => s.keys.some((n) => n && (k === n || (n.length >= 3 && k.startsWith(n)))));
}

function pickPhoto(full, sp) {
  const files = fs.readdirSync(full, { withFileTypes: true })
    .filter((e) => e.isFile() && isImage(e.name) && !NOT_PORTRAIT.test(e.name))
    .map((e) => ({ name: e.name, size: fs.statSync(path.join(full, e.name)).size }));
  if (!files.length) return null;
  const want = String(sp.photo_file || '').toLowerCase();
  const same = files.find((f) => f.name.toLowerCase() === want);
  if (same) return same;
  const score = (f) => (/사진|photo|portrait|pic|프로필/i.test(f.name) ? 1 : 0);
  return files.sort((a, b) => score(b) - score(a) || b.size - a.size)[0];
}

(async () => {
  try {
    const sp = await pool.query(
      'SELECT id, name_snapshot, name_en, photo_file FROM speakers WHERE event_id = $1', [EVENT]);
    const speakers = sp.rows.map((s) => ({ ...s, keys: [squash(s.name_snapshot), squash(s.name_en)].filter(Boolean) }));
    await pool.query(`CREATE TABLE IF NOT EXISTS speaker_photos (
      speaker_id TEXT PRIMARY KEY, event_id TEXT, file TEXT, content_type TEXT,
      data TEXT, size INTEGER, updated_at TEXT, author_email TEXT)`);
    const have = new Set((await pool.query(
      'SELECT speaker_id FROM speaker_photos WHERE event_id = $1', [EVENT])).rows.map((r) => r.speaker_id));

    const plan = [];       // { sp, src, rel }
    const skipped = [];
    const walk = (dir, depth) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const full = path.join(dir, e.name);
        const rel = path.relative(DIR, full);
        const hit = matchSpeaker(e.name, speakers);
        if (hit.length > 1) { skipped.push(`${rel} — 연사가 여럿 맞음: ${hit.map((s) => s.name_snapshot || s.name_en).join(', ')}`); continue; }
        if (!hit.length) { if (depth < 1) walk(full, depth + 1); continue; }
        const s = hit[0];
        const f = pickPhoto(full, s);
        if (!f) { skipped.push(`${rel} — 사진 없음`); continue; }
        if (have.has(s.id) && !FORCE) { skipped.push(`${rel} — CRM에 이미 사진 있음 (--force로 갈아 끼움)`); continue; }
        if (plan.some((p) => p.sp.id === s.id)) { skipped.push(`${rel} — 같은 연사 폴더가 또 있음`); continue; }
        plan.push({ sp: s, src: path.join(full, f.name), rel: path.join(rel, f.name) });
      }
    };
    walk(DIR, 0);

    console.log(`\n넣을 사진 ${plan.length}장 (${EVENT})`);
    plan.forEach((p) => console.log(`  ${(p.sp.name_snapshot || p.sp.name_en).trim().padEnd(16)} ← ${p.rel}`));
    if (skipped.length) { console.log('\n넘긴 것'); skipped.forEach((s) => console.log(`  ${s}`)); }
    const none = speakers.filter((s) => !have.has(s.id) && !plan.some((p) => p.sp.id === s.id));
    if (none.length) console.log(`\n사진 없는 연사: ${none.map((s) => (s.name_snapshot || s.name_en).trim()).join(', ')}`);
    if (DRY || !plan.length) { console.log(DRY ? '\n--dry: 넣지 않았어요' : ''); return; }

    const listFile = path.join(os.tmpdir(), `speaker-photos-${Date.now()}.json`);
    fs.writeFileSync(listFile, JSON.stringify(plan.map((p) => p.src)), 'utf8');
    let out;
    try {
      out = JSON.parse(execFileSync('python', [path.join(__dirname, 'resize-speaker-photos.py'), listFile],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    } finally { fs.unlinkSync(listFile); }

    const now = new Date().toISOString();
    let n = 0;
    for (const p of plan) {
      const r = out.find((o) => o.src === p.src);
      if (!r || r.error) { console.log(`  ✗ ${p.rel}: ${r ? r.error : '결과 없음'}`); continue; }
      await pool.query(
        `INSERT INTO speaker_photos (speaker_id, event_id, file, content_type, data, size, updated_at, author_email)
         VALUES ($1,$2,$3,'image/jpeg',$4,$5,$6,'import-speaker-photos')
         ON CONFLICT (speaker_id) DO UPDATE SET event_id = $2, file = $3, content_type = 'image/jpeg',
           data = $4, size = $5, updated_at = $6, author_email = 'import-speaker-photos'`,
        [p.sp.id, EVENT, path.basename(p.src), r.data, Math.floor(r.data.length * 3 / 4), now]);
      n++;
      console.log(`  ✓ ${(p.sp.name_snapshot || p.sp.name_en).trim()} (${r.kb}KB)`);
    }
    console.log(`\n${n}장 넣었어요 — 연사 드로어를 다시 열면 보입니다`);
  } catch (e) {
    console.error('실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end?.();
  }
})();
