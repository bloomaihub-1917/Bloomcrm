/* 이름이 아닌 것이 이름 칸에 적힌 줄을 비운다.

   명단의 성함 칸에는 사람 이름 대신 «컨택»·«*»이 적혀 오는 일이 있다.
   대표 메일로 받으라는 뜻이지 그런 이름의 사람이 있는 게 아니다. 그대로
   두면 «컨택»이라는 사람이 예순 몇 명 있는 것처럼 보이고, 메일 첫머리에
   «컨택 님께»라고 쓰게 된다.

   비워 두는 것이 더 정확하다 — 이름 칸이 비어 있으면 그 줄은 사람이 아니라
   그 회사의 메인 컨택포인트라는 뜻이고, 화면은 그것을 «-»로 보여준다.

   같은 이유로, 담당자를 못 찾은 회사를 목록에 올리면서 이름 칸에 기업명을
   넣어 둔 줄도 비운다 — 옆 칸에 같은 이름이 또 있으니 아무것도 말해 주지
   않는다. 부서명이 적힌 줄은 그대로 둔다. «학생복지팀»은 누구에게 연락해야
   하는지를 말해 주는 정보이고, 그 팀의 담당자를 알아내면 그때 덮어쓴다.

   그 줄이 빠져 보이지 않게 태그와 상태로 표를 해 둔다. 담당자를 알아내면
   이름을 적고 태그만 떼면 그대로 정상 연락처가 된다.

     node db/clear-placeholder-names.js [--dry]                             */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const TAG = '담당자미정';
const TAG_LABEL = '담당자 미정';

/* 이름이 아닌 것들. «담당자»·«대표»는 뺐다 — 실제로 그렇게 불리는 직함이
   이름 칸에 들어온 경우와 가릴 수가 없다. 확실한 것만 지운다. */
const NOT_NAMES = ['컨택', '컨택포인트', '컨텍', '*', '-', '--', 'n/a', 'N/A', '.', '?'];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, "nameKo", "nameEn", "orgKo", "orgEn", COALESCE(tags,'') tags, status
         FROM contacts
        WHERE lower(btrim(COALESCE("nameKo",''))) = ANY($1)
           OR lower(btrim(COALESCE("nameEn",''))) = ANY($1)`,
      [NOT_NAMES.map((v) => v.toLowerCase())]);

    for (const r of rows) {
      const tags = String(r.tags || '').split('|').map((v) => v.trim()).filter(Boolean);
      if (!tags.includes(TAG)) tags.push(TAG);
      await client.query(
        `UPDATE contacts SET "nameKo" = '', "nameEn" = '', tags = $2, status = 'pending'
          WHERE id = $1`, [r.id, tags.join('|')]);
    }
    console.log(`이름을 비운 줄 ${rows.length}건`);
    rows.slice(0, 8).forEach((r) => console.log(
      `   ${(r.nameKo || r.nameEn).padEnd(8)} → (빈칸)   ${r.orgKo || r.orgEn}`));
    if (rows.length > 8) console.log(`   … 외 ${rows.length - 8}건`);

    /* 이미 이름이 비어 있던 줄도 같은 표를 달아 준다 — 규칙이 하나여야
       «이름 칸이 비면 메인 컨택포인트»가 늘 참이 된다. */
    const { rows: blanks } = await client.query(
      `SELECT id, COALESCE(tags,'') tags FROM contacts
        WHERE btrim(COALESCE("nameKo",'')) = '' AND btrim(COALESCE("nameEn",'')) = ''
          AND COALESCE(tags,'') NOT LIKE '%' || $1 || '%'`, [TAG]);
    for (const b of blanks) {
      const tags = String(b.tags || '').split('|').map((v) => v.trim()).filter(Boolean);
      tags.push(TAG);
      await client.query(`UPDATE contacts SET tags = $2, status = 'pending' WHERE id = $1`,
        [b.id, tags.join('|')]);
    }
    if (blanks.length) console.log(`이미 비어 있어 표만 단 줄 ${blanks.length}건`);

    /* ── 이름 자리에 기업명이 들어간 줄 ──
       담당자를 못 찾은 회사를 목록에 올리면서 이름 칸에 기업명을 넣어 둔 적이
       있다. 옆 칸에 같은 이름이 또 있으니 아무것도 말해 주지 않고, «이름 칸이
       비면 메인 컨택포인트»라는 규칙과도 어긋난다.

       부서명이 적힌 줄은 건드리지 않는다 — «학생복지팀»은 누구에게 연락해야
       하는지를 말해 주는 정보다. 나중에 그 팀의 담당자를 알아내면 이름을
       덮어쓰면 된다. */
    const { rows: dupName } = await client.query(
      `SELECT id, "nameKo", "nameEn", "orgKo", "orgEn" FROM contacts
        WHERE COALESCE(tags,'') LIKE '%' || $1 || '%'
          AND btrim(COALESCE("deptKo",'')) = ''
          AND (btrim(COALESCE("nameKo",'')) <> '' OR btrim(COALESCE("nameEn",'')) <> '')`, [TAG]);
    for (const d of dupName) {
      await client.query(`UPDATE contacts SET "nameKo" = '', "nameEn" = '' WHERE id = $1`, [d.id]);
    }
    if (dupName.length) {
      console.log(`이름 칸의 기업명을 비운 줄 ${dupName.length}건`);
      dupName.slice(0, 5).forEach((d) => console.log(`   ${(d.nameKo || d.nameEn)} → (빈칸)`));
      if (dupName.length > 5) console.log(`   … 외 ${dupName.length - 5}건`);
    }

    /* 태그 목록에 없으면 사이드바에 칩이 안 뜬다 */
    const row = (await client.query(`SELECT value FROM settings WHERE key = 'tags'`)).rows[0];
    const list = row ? JSON.parse(row.value) : [];
    if (!list.some((t) => t.key === TAG)) {
      list.push({ key: TAG, label: TAG_LABEL });
      await client.query(
        `INSERT INTO settings (key, value) VALUES ('tags', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(list)]);
      console.log(`태그 «${TAG_LABEL}» 추가`);
    }

    const after = await client.query(
      `SELECT count(*) FILTER (WHERE btrim(COALESCE("nameKo",'')) = ''
                                 AND btrim(COALESCE("nameEn",'')) = '')::int 이름없음,
              count(*) FILTER (WHERE COALESCE(tags,'') LIKE '%' || $1 || '%')::int 태그,
              count(*)::int 전체 FROM contacts`, [TAG]);
    const a = after.rows[0];
    console.log(`\n이름 칸이 빈 줄 ${a.이름없음}건 · «${TAG_LABEL}» 태그 ${a.태그}건 · 연락처 전체 ${a.전체}명`);

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
