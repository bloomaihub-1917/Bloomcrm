/* ══════════════════════════════════════════════════════════════
   fix-contact-org-link.js — 끊긴 연락처↔기업 연결을 이름으로 다시 잇는다

   왜 끊겼나. contacts를 저장할 때 프론트는 값을 «위치 배열»로 보내고 백엔드는
   보낸 칸까지만 덮는다. 저장하는 쪽은 org_id를 23번째 칸에 실어 보내도록
   고쳐졌는데(595e1a6), 읽는 쪽(js/api.js)이 응답에서 org_id를 담지 않아
   화면 위의 연락처는 늘 org_id가 없는 상태였다. 그래서 저장할 때마다 빈
   문자열이 실려 나가 연결이 조용히 끊겼다 — 고쳤다고 적어 둔 바로 그 버그가
   읽는 쪽만 남아 계속 돌고 있었다.

   연락처가 분야를 갖는 길은 «연락처 → 기업 → 섹터 → 분야» 하나뿐이라, 연결이
   끊긴 사람은 분야별 보기에서 미분류로 떨어진다.

   여기서 하는 일은 이름으로 다시 잇는 것뿐이다. org_id가 이미 있는 행은
   건드리지 않고, 이름이 기업DB에 정확히 일치하는 경우만 잇는다. 애매하면
   그냥 두고 이름을 대며 넘어간다 — 우리가 대신 골라 꽂으면 엉뚱한 기업에
   붙은 걸 아무도 모른다.

     node db/fix-contact-org-link.js --dry   먼저 무엇이 바뀌는지만 본다
     node db/fix-contact-org-link.js         실제로 잇는다
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

(async () => {
  /* 이름이 같은 기업이 둘 이상이면 어느 쪽인지 알 수 없다 — 그런 이름은
     아예 후보에서 뺀다(아래 ambiguous). */
  const orgs = (await pool.query(`SELECT id, name_ko, name_en FROM orgs`)).rows;
  const byName = new Map();
  const ambiguous = new Set();
  for (const o of orgs) {
    for (const nm of [o.name_ko, o.name_en]) {
      const key = String(nm || '').trim();
      if (!key) continue;
      if (byName.has(key) && byName.get(key) !== o.id) ambiguous.add(key);
      else byName.set(key, o.id);
    }
  }
  ambiguous.forEach((k) => byName.delete(k));

  const broken = (await pool.query(
    `SELECT id, "nameKo", "nameEn", "orgKo", "orgEn"
       FROM contacts WHERE coalesce(org_id, '') = ''`)).rows;

  const plan = [];
  const skipped = [];
  for (const c of broken) {
    const ko = String(c.orgKo || '').trim();
    const en = String(c.orgEn || '').trim();
    const oid = byName.get(ko) || byName.get(en) || '';
    const who = c.nameKo || c.nameEn || c.id;
    if (oid) plan.push({ id: c.id, oid, who, org: ko || en });
    else if (ko || en) skipped.push(`${who} → ${ko || en} (기업DB에 없거나 같은 이름이 둘 이상)`);
    else skipped.push(`${who} → 소속명 없음`);
  }

  console.log(`org_id가 빈 연락처 ${broken.length}건`);
  console.log(`  이을 수 있는 것 ${plan.length}건 / 건드리지 않을 것 ${skipped.length}건\n`);
  plan.forEach((p) => console.log(`  ${DRY ? '[예정]' : '잇는다'} ${p.who} → ${p.org}`));
  if (skipped.length) {
    console.log('\n그냥 두는 것:');
    skipped.forEach((s) => console.log(`  - ${s}`));
  }

  if (DRY) { console.log('\n--dry — 아무것도 바꾸지 않았습니다.'); await pool.end(); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of plan) {
      await client.query(`UPDATE contacts SET org_id = $1 WHERE id = $2`, [p.oid, p.id]);
    }
    /* 사람이 고친 것과 구분되게 남긴다 — 나중에 «이건 누가 바꿨지»의 답이 된다 */
    await client.query(
      `INSERT INTO activity_log (id, ts, email, name, type, action, target, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [`AL-fix-orglink-${Date.now()}`, new Date().toISOString(), '', '정리 스크립트',
       'edit', '기업 연결 복구', 'contacts',
       `저장할 때마다 끊기던 연락처↔기업 연결 ${plan.length}건을 이름으로 다시 이었습니다`]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('\n실패 — 아무것도 바뀌지 않았습니다:', e.message);
    client.release(); await pool.end(); process.exit(1);
  }
  client.release();

  const left = await pool.query(`SELECT count(*)::int n FROM contacts WHERE coalesce(org_id,'') = ''`);
  console.log(`\n완료. 아직 org_id가 빈 연락처 ${left.rows[0].n}건`);
  await pool.end();
})();
