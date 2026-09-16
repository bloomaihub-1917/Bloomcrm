/* AIA 등급이 국가 칸에 들어가 있는 것을 메모로 옮긴다.

   «AIA Designation» 열이 업로드에서 국가로 잡혔다. 컬럼 이름을 알아보는
   2단계(별칭이 헤더 안에 들어 있으면 같은 것으로 본다)에서 country의 별칭
   «nation»이 «desig-nation»의 꼬리에 걸린 탓이다. 그래서 85명의 국가 칸에
   Hon. FAIA · Assoc. AIA 같은 값이 들어갔다.

   국가는 지역별 보기와 국가 확인 경고가 걸려 있는 칸이라, 이대로 두면
   «국가 미상»과 «기타»가 계속 틀린 수를 말한다. 등급 자체는 버릴 값이
   아니므로(누구를 어떻게 부를지가 걸린다) 메모로 옮기고 국가만 비운다.

   등급은 85명 모두 memo2에 둔다 — 자리가 사람마다 다르면 나중에 «등급이
   Hon. FAIA인 사람»을 한 번에 뽑을 수가 없다. memo2에 이미 다른 자격
   (LEED AP·KIRA)이 적힌 세 명은 그 값을 memo3으로 밀어낸다.

   별칭 쪽 고침은 js/modules/upload-tab.js의 guessColumn에 있다 —
   이 스크립트는 이미 들어간 값만 되돌린다.

     node db/fix-aia-designation.js [--dry]                                   */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

/* 국가 칸에서 빼낼 값들. 이 목록에 없는 값은 건드리지 않는다 —
   «미국»·«대한민국»처럼 진짜 국가가 섞여 있다. */
const GRADES = ['AIA', 'FAIA', 'Hon. AIA', 'Hon. FAIA', 'Assoc. AIA', 'Intl. Assoc. AIA'];
/* 값이라 할 수 없는 것 — 메모로 옮길 것도 없이 비운다 */
const JUNK = ['-', '--', 'N/A', 'n/a'];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, "nameEn", "nameKo", country, memo2, memo3
         FROM contacts WHERE country = ANY($1) OR country = ANY($2)
        ORDER BY id`, [GRADES, JUNK]);

    const moved = []; const cleared = []; const stuck = [];

    for (const r of rows) {
      if (JUNK.includes(r.country)) {
        await client.query(`UPDATE contacts SET country = '' WHERE id = $1`, [r.id]);
        cleared.push(r);
        continue;
      }
      const busy = String(r.memo2 || '').trim();
      if (busy && String(r.memo3 || '').trim()) { stuck.push(r); continue; }  // 밀어낼 자리가 없다
      await client.query(
        `UPDATE contacts SET memo2 = $2, memo3 = $3, country = '' WHERE id = $1`,
        [r.id, r.country, busy || r.memo3 || '']);
      moved.push({ ...r, pushed: busy });
    }

    const by = (arr, k) => arr.reduce((m, r) => m.set(r[k], (m.get(r[k]) || 0) + 1), new Map());

    console.log(`등급 → 메모로 옮김 ${moved.length}명`);
    [...by(moved, 'country')].forEach(([v, n]) => console.log(`   ${String(n).padStart(3)}  ${v}`));
    const pushed = moved.filter((r) => r.pushed);
    if (pushed.length) {
      console.log(`   (memo2에 있던 자격을 memo3으로 밀어낸 ${pushed.length}명: `
        + pushed.map((r) => `${r.nameEn || r.nameKo}(${r.pushed})`).join(', ') + ')');
    }
    if (cleared.length) console.log(`값이 아닌 것 비움 ${cleared.length}명`);
    if (stuck.length) {
      console.log(`⚠ 메모 세 칸이 다 차서 손대지 않은 ${stuck.length}명: `
        + stuck.map((r) => r.nameEn || r.nameKo).join(', '));
    }

    const left = await client.query(
      `SELECT country, count(*)::int n FROM contacts
        WHERE COALESCE(country,'') <> '' GROUP BY country ORDER BY n DESC`);
    console.log('\n남은 국가 값: ' + left.rows.map((r) => `${r.country}(${r.n})`).join(' · '));

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
