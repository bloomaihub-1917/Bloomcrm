/* ══════════════════════════════════════════════════════════════
   seed-evk-sectors.js — EVENTKOREA 셀러·바이어 대분류를 섹터로 심는다

   이벤트·MICE 섹터는 seed-sectors.js가 심어 둔 8개였고, 주석에도 "아직 등록된
   기업이 없다 — 참가사를 넣기 시작하면 채워진다"고 적혀 있다. 그 순간이 지금이다.

   이름은 우리가 새로 짓지 않고 명단의 대분류를 그대로 쓴다. 섹터 이름은
   사람이 고르는 말이라, 명단에서 «부스/무대/구조물»이라 부르던 것을 DB에서만
   «부스시공·전시장치»로 바꿔 두면 고를 때마다 머릿속에서 한 번 옮겨야 한다.
   표기가 흔들리는 것(이벤트부스/이벤트 부스)과 오타(프리렌서, 동역)만 접는다.
   그 대응표는 업로드 쪽 SECTOR_ALIASES(js/modules/upload-tab.js)에 있다.

   그래서 이 스크립트는 «추가»만 하지 않고 이름도 맞춘다 — 먼저 만들어 둔
   일반적인 이름(부스시공·전시장치 …)을 명단의 이름으로 고쳐 쓴다. 다만
   그 섹터를 쓰는 기업이 이미 있으면 건드리지 않고 경고만 남긴다. 이름이
   곧 저장된 값이라(orgs.sectors는 이름을 이어 붙인다) 바꾸면 그 기업의
   분류가 끊기기 때문이다.

     node db/seed-evk-sectors.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

/* ── 셀러 (이벤트·MICE) ── 명단의 «카테고리 정리» 시트에 적힌 순서 그대로.

   «기타»는 공통의 기존 «기타»를 함께 쓰려다 되돌렸다. 셀러 명단의 기타는
   야광맨·한복·전기처럼 이벤트 현장에서 쓰는 업종이지 분야를 넘나드는 기타가
   아니다. 공통에 넣으면 이벤트·MICE를 눌렀을 때 그 23곳이 빠진다.

   이름이 곧 저장되는 값이라(orgs.sectors는 이름을 이어 붙인다) 그냥 «기타»로
   둘을 만들 수는 없다 — 어느 쪽인지 구분할 방법이 사라진다. 그래서 분야
   이름을 앞에 붙인다. 같은 자리의 «이벤트·MICE 업종 미정»과 같은 방식이다. */
const MICE = [
  { id: 'venue',       name: '베뉴' },
  { id: 'evk_traffic', name: '교통' },
  { id: 'evk_fx',      name: '이벤트(특효)장치/장비' },
  { id: 'evk_booth',   name: '이벤트 부스' },
  /* 케이터링은 명단의 대분류에 없던 것을 뒤늦게 세운 자리다. 그동안 도시락·
     다과·출장뷔페를 부르는 곳은 «이벤트·MICE 기타»에 섞여 있었는데, 행사마다
     빠지지 않고 찾는 업종이라 기타에 묻어두면 매번 다시 훑어야 한다. */
  { id: 'evk_catering', name: '케이터링' },
  { id: 'evk_enter',   name: '엔터에이전시(MC/공연)' },
  { id: 'booth',       name: '부스/무대/구조물' },
  { id: 'evk_led',     name: 'LED/LCD 디스플레이' },
  { id: 'evk_video',   name: '영상' },
  { id: 'evk_audio',   name: '음향' },
  { id: 'evk_light',   name: '조명' },
  { id: 'evk_trans',   name: '통역' },
  { id: 'rental',      name: '행사가구/텐트/렌탈' },
  { id: 'evk_promo',   name: '판촉(기념품,굿즈)' },
  { id: 'micetech',    name: 'IT솔루션' },
  { id: 'evk_free',    name: '프리랜서' },
  { id: 'sign',        name: '인쇄/출력' },
  { id: 'agency',      name: '대행사' },
  { id: 'evk_etc',     name: '이벤트·MICE 기타' },
];

/* ── 바이어 (공통) ── 셀러와 같은 원칙으로 명단의 대분류를 그대로 쓴다.
   기관 성격에 따라 입찰·수의계약 방식이 갈려서 «정부·공공기관» 한 덩어리로는
   파이프라인에서 쓸모가 없다.

   «기업»과 «민간기업»이 섞여 있어 «기업»으로 모았다 — 명단에서 더 많이 쓰는
   말이고, 원본 «카테고리 정리» 시트의 바이어 줄도 그 자리를 «기업»이라 적는다.

   «대학교»는 기존 «대학·연구소»와 따로 둔다 — 그쪽은 바이오 행사에서 쓰는
   분류라 연구소를 품고 있고, 쓰는 기업도 이미 있어 이름을 바꿀 수 없다. */
const COMMON = [
  { id: 'evk_govt',   name: '정부기관' },
  { id: 'evk_local',  name: '지방자치단체' },
  { id: 'evk_public', name: '공공기관' },
  { id: 'evk_quango', name: '정부산하기관' },
  { id: 'assoc',      name: '협∙단체' },
  { id: 'evk_found',  name: '재단법인' },
  { id: 'evk_univ',   name: '대학교' },
  { id: 'evk_corp',   name: '기업' },
];

/* 명단에 없는 구분 — 잘게 나뉘면서 갈 곳이 없어졌다.
   av는 음향·영상·조명으로, gov는 정부기관·공공기관·정부산하기관으로 쪼개졌다.
   남겨 두면 고를 때 «정부기관»과 «정부·공공기관»이 나란히 떠서, 같은 기관이
   둘로 갈린다. 쓰는 기업이 있으면 지우지 않는다. */
const DROP = ['av', 'staff', 'gov'];

const SECTORS = [
  ...MICE.map((s) => ({ ...s, domain: 'mice' })),
  ...COMMON.map((s) => ({ ...s, domain: 'common' })),
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cur = new Map((await client.query('SELECT id, name, domain FROM sectors')).rows
      .map((r) => [r.id, r]));

    /* 어떤 섹터 이름이 실제로 쓰이고 있는지 — orgs.sectors는 '|'로 이어 붙인 이름이다 */
    const used = new Set();
    (await client.query(`SELECT sectors FROM orgs WHERE COALESCE(sectors,'') <> ''`)).rows
      .forEach((r) => String(r.sectors).split('|').forEach((n) => used.add(n.trim())));

    const added = []; const renamed = []; const held = []; const dropped = [];

    for (const s of SECTORS) {
      const have = cur.get(s.id);
      if (!have) {
        await client.query(
          `INSERT INTO sectors (id, name, parent, domain, canonical) VALUES ($1, $2, '', $3, '')`,
          [s.id, s.name, s.domain]);
        added.push(s);
      } else if (have.name !== s.name) {
        if (used.has(have.name)) { held.push({ ...s, was: have.name }); continue; }
        await client.query(`UPDATE sectors SET name = $2, domain = $3 WHERE id = $1`,
          [s.id, s.name, s.domain]);
        renamed.push({ ...s, was: have.name });
      }
    }

    for (const id of DROP) {
      const have = cur.get(id);
      if (!have) continue;
      if (used.has(have.name)) { held.push({ id, name: have.name, was: have.name }); continue; }
      await client.query(`DELETE FROM sectors WHERE id = $1`, [id]);
      dropped.push(have);
    }

    console.log(`추가 ${added.length} · 이름 정리 ${renamed.length} · 삭제 ${dropped.length}`);
    added.forEach((s) => console.log(`   + ${s.domain.padEnd(7)} ${s.name}`));
    renamed.forEach((s) => console.log(`   ~ ${s.domain.padEnd(7)} ${s.was} → ${s.name}`));
    dropped.forEach((s) => console.log(`   - ${s.domain.padEnd(7)} ${s.name}`));
    held.forEach((s) => console.log(`   ! 건너뜀 — «${s.was}»를 쓰는 기업이 있어 그대로 뒀습니다`));

    const after = (await client.query(
      `SELECT name FROM sectors WHERE domain = 'mice' ORDER BY id`)).rows.map((r) => r.name);
    console.log(`\n이벤트·MICE ${after.length}종: ${after.join(' · ')}`);

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
