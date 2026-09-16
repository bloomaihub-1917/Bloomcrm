/* 담당자 이름이 없는 줄의 대표 전화·메일을 기업에 옮긴다.

   명단에는 이름 칸만 비어 있고 번호와 메일은 적힌 줄이 106개 있다
   (셀러 41 · 바이어 65). 아직 누구를 찾아야 할지 모르는 회사들이고,
   전화 한 통이면 담당자를 알아낼 수 있는 곳이다.

   이름이 있는 줄은 건드리지 않는다 — 그 번호는 그 사람의 것이라 이미
   연락처로 들어갔다. 기업에 이미 적혀 있는 값도 덮지 않는다.

   바이어의 «일반번호»는 기관 대표번호라 그대로 기업 전화로 간다.
   셀러의 «핸드폰 번호»는 이름이 없는 줄에서는 사실상 대표번호로 쓰인다
   (02-711-4090처럼 유선이 섞여 있다).

     node db/fill-org-contact.js <엑셀경로> [--dry]                          */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const FILE = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!FILE) { console.error('엑셀 경로를 주세요.'); process.exit(1); }

const key = (v) => String(v || '').trim().toLowerCase()
  .replace(/㈜|\(주\)|주식회사|\(유\)|유한회사/g, '')
  .replace(/\s+/g, '');
const clean = (v) => String(v == null ? '' : v).trim();

/* «*»처럼 값이 아닌 것이 섞여 있다 — 그대로 넣으면 메일 칸에 별표가 남는다 */
const real = (v) => {
  const t = clean(v);
  return (!t || t === '*' || t === '-' || t === 'N/A') ? '' : t;
};

const SHEETS = [
  { name: '종합_셀러',  org: '기업명',            phone: '핸드폰 번호', mail: '메일' },
  { name: '종합_바이어', org: '기관/기업/단체명',  phone: '일반번호',    mail: '메일' },
];

(async () => {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(FILE);

  const wanted = new Map();   // 이름키 → { name, phone, email }
  for (const sh of SHEETS) {
    const ws = wb.Sheets[sh.name];
    if (!ws) { console.error(`«${sh.name}» 시트가 없습니다.`); continue; }
    for (const r of XLSX.utils.sheet_to_json(ws, { defval: '' })) {
      const orgName = clean(r[sh.org]);
      if (!orgName || clean(r['성함'])) continue;   // 이름이 있는 줄은 사람의 것
      const phone = real(r[sh.phone]);
      const email = real(r[sh.mail]);
      if (!phone && !email) continue;
      const cur = wanted.get(key(orgName));
      if (!cur) { wanted.set(key(orgName), { name: orgName, phone, email }); continue; }
      if (!cur.phone && phone) cur.phone = phone;
      if (!cur.email && email) cur.email = email;
    }
  }
  console.log(`명단에서 읽은 대표 연락처 ${wanted.size}곳`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: orgs } = await client.query(
      `SELECT id, name_ko, name_en, COALESCE(phone,'') phone, COALESCE(email,'') email FROM orgs`);

    const done = []; const kept = []; const missed = [];
    const seen = new Set();

    for (const o of orgs) {
      const hit = wanted.get(key(o.name_ko)) || wanted.get(key(o.name_en));
      if (!hit) continue;
      seen.add(key(hit.name));

      const takePhone = !!hit.phone && !o.phone;
      const takeEmail = !!hit.email && !o.email;
      if (!takePhone && !takeEmail) { kept.push(hit.name); continue; }

      const sets = []; const vals = [o.id];
      if (takePhone) { vals.push(hit.phone); sets.push(`phone = $${vals.length}`); }
      if (takeEmail) { vals.push(hit.email); sets.push(`email = $${vals.length}`); }
      vals.push(new Date().toISOString());
      sets.push(`updated_at = $${vals.length}`);
      await client.query(`UPDATE orgs SET ${sets.join(', ')} WHERE id = $1`, vals);
      done.push({ name: o.name_ko || o.name_en, phone: takePhone ? hit.phone : '', email: takeEmail ? hit.email : '' });
    }
    for (const [k, v] of wanted) if (!seen.has(k)) missed.push(v.name);

    console.log(`\n대표 연락처를 채운 기업 ${done.length}곳`);
    console.log(`   전화 ${done.filter((d) => d.phone).length}곳 · 메일 ${done.filter((d) => d.email).length}곳`);
    done.slice(0, 5).forEach((d) => console.log(
      `   ${d.name} — ${[d.phone, d.email].filter(Boolean).join(' / ')}`));
    if (done.length > 5) console.log(`   … 외 ${done.length - 5}곳`);
    if (kept.length) console.log(`\n이미 적혀 있어 그대로 둔 ${kept.length}곳`);
    if (missed.length) {
      console.log(`\n명단에는 있지만 기업DB에서 못 찾은 ${missed.length}곳:`);
      console.log('   ' + missed.slice(0, 15).join(' · ') + (missed.length > 15 ? ' …' : ''));
    }

    if (DRY) { await client.query('ROLLBACK'); console.log('\n--dry 라서 되돌렸습니다.'); }
    else { await client.query('COMMIT'); console.log('\n반영 완료.'); }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end?.();
  }
})();
