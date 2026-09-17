/* AIA 두 연사의 CV를 원문 그대로 다시 넣는다.

   앞서 한 번 넣었는데, 내가 옮겨 적으면서 줄을 합치고 순서를 바꿨다. 더
   나쁜 건 Chang의 강연 목록을 13개 중 4개만 넣은 것이다 — 요약할 자리가
   아닌데 요약했다. 받은 자료를 우리가 고쳐 넣으면 무엇이 원문이었는지 알
   수 없게 되고, 프로그램북에 나갈 때 연사가 보낸 글과 달라진다.

   그래서 사람 손으로 옮기지 않는다. _build-aia-verbatim.py가 CV PDF의
   텍스트를 절 머리글로 잘라 _aia-verbatim.json에 담고, 이 스크립트는 그걸
   그대로 쓴다. 손대는 건 줄 끝 공백뿐이다(PDF 추출이 남기는 것이라 원문이
   아니다).

   우리 칸에 자리가 없는 절도 버리지 않는다. Chen의 CORE COMPETENCIES와
   Chang의 BUILT WORK·PROJECT는 원문 머리글을 달아 메모에 넣는다 —
   칸이 없다는 건 우리 사정이지 그 글이 필요 없다는 뜻이 아니다.

   실행: node db/fill-aia-verbatim.js --dry
         node db/fill-aia-verbatim.js
*/
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const dry = process.argv.includes('--dry');

const V = JSON.parse(fs.readFileSync(path.join(__dirname, '_aia-verbatim.json'), 'utf8'));

const CHEN = 'SP-1789090821008_10';
const CHANG = 'SP-1789097599495_1';

/* 메모에 담는 절 — 원문 머리글을 그대로 달아 어디서 온 글인지 남긴다 */
const chenNote = `CORE COMPETENCIES\n${V.chen_core}`;
const changNote = [V.chang_pei_note, V.chang_extra].filter(Boolean).join('\n\n');

const TARGETS = [
  { id: CHEN, name: 'Yenling Chen', data: { ...V.chen, note: chenNote } },
  { id: CHANG, name: 'RONG-HAO CHANG', data: { ...V.chang, note: changNote } },
];

(async () => {
  for (const t of TARGETS) {
    const cur = (await pool.query('select * from speakers where id = $1', [t.id])).rows[0];
    if (!cur) { console.log(`!! ${t.name} — 연사 줄을 못 찾았어요`); continue; }
    const changed = Object.keys(t.data).filter((k) => String(cur[k] ?? '') !== String(t.data[k] ?? ''));

    console.log(`\n══ ${t.name}`);
    if (!changed.length) { console.log('  = 이미 원문과 같아요'); continue; }
    changed.forEach((k) => {
      const a = String(cur[k] ?? ''), b = String(t.data[k] ?? '');
      const d = b.length - a.length;
      console.log(`  ${dry ? '·' : '✓'} ${k.padEnd(20)} ${a.length}자 → ${b.length}자`
        + ` (${d > 0 ? '+' : ''}${d})`);
    });
    if (dry) continue;
    const sets = changed.map((k, i) => `"${k}" = $${i + 2}`).join(', ');
    await pool.query(`update speakers set ${sets}, updated_at = $${changed.length + 2} where id = $1`,
      [t.id, ...changed.map((k) => t.data[k]), new Date().toISOString().slice(0, 10)]);
  }
  console.log(dry ? '\n(dry — 아무것도 바꾸지 않았습니다)' : '\n원문 그대로 넣었습니다.');
  await pool.end();
})();
