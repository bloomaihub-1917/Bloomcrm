/* ══════════════════════════════════════════════════════════════
   renumber-graphic-codes.js — 인포데스크 랩핑 코드를 계열로 묶는다

   그래픽 코드가 십의 자리로만 올라가서, 같은 물건의 정면과 사이드가 떨어져
   있었다. 목록을 훑으면 무엇이 한 짝인지 보이지 않는다.

     지금                                         바꾼 뒤
     G-020  인포데스크 랩핑 · 정면 (Standard)     G-020  인포데스크 랩핑 · 정면
     G-030  인포데스크 랩핑 · 정면 (Premium)      G-021  인포데스크 랩핑 · 사이드
     G-040  인포데스크 사이드패널 · Premium       G-030  하이 인포데스크 랩핑 · 정면
     G-050  인포데스크 사이드패널 · Standard      G-031  하이 인포데스크 랩핑 · 사이드

   Standard와 Premium이 실은 인포데스크와 하이 인포데스크였다 — 규격이 그렇게
   말한다(정면 750H / 1000H, 사이드 748H / 898H). 엑스렌탈 영문명도 High가
   붙어 있다. 그래서 이름을 규격 등급이 아니라 물건으로 부른다.

   분류도 함께 옮긴다. 전에는 '인포데스크 랩핑'과 '인포데스크 사이드패널 랩핑'으로
   정면·사이드가 갈려 있었는데, 이제 물건으로 묶여 '인포데스크 랩핑'과
   '하이 인포데스크 랩핑' 둘이 된다.

   id도 코드에 맞춘다. 임포트 스크립트가 id를 코드에서 만들기 때문에, 반쪽만
   맞춰 두면 다음에 재임포트할 때 같은 물건이 두 줄이 된다. id를 바꾸므로
   그 id를 가리키던 신청 항목(exhibitor_items.catalog_id)도 같은 트랜잭션에서
   함께 옮긴다 — equip_catalog에는 외래키가 없어 DB가 대신 챙겨주지 않는다.

   항목 이름에 옛 코드가 박혀 있는 줄도 새 코드·이름으로 고친다. 그대로 두면
   G-040처럼 이제 없는 코드가 이름에 남아, 다음 업로드에서 코드로 맞춰 볼 때
   짝을 못 찾는다.

     node db/renumber-graphic-codes.js --dry
     node db/renumber-graphic-codes.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const EVENT = arg('--event') || '2026 KIC';

const idOf = (code) => `EC-graphic-${EVENT.replace(/[^A-Za-z0-9가-힣]/g, '')}-${code}`;

/* from은 지금 코드, to는 바꿀 코드. name/category는 최종값이다. */
const MAP = [
  { from: 'G-020', to: 'G-020', name: '인포데스크 랩핑 · 정면',        category: '인포데스크 랩핑',      sort: '20' },
  { from: 'G-050', to: 'G-021', name: '인포데스크 랩핑 · 사이드',      category: '인포데스크 랩핑',      sort: '21' },
  { from: 'G-030', to: 'G-030', name: '하이 인포데스크 랩핑 · 정면',   category: '하이 인포데스크 랩핑', sort: '30' },
  { from: 'G-040', to: 'G-031', name: '하이 인포데스크 랩핑 · 사이드', category: '하이 인포데스크 랩핑', sort: '31' },
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 지금 값을 먼저 읽어 둔다 — 바꾸는 도중에 조회하면 서로 섞인다
    const cur = new Map((await client.query(
      "SELECT id, code, name_ko FROM equip_catalog WHERE event_id=$1 AND kind='graphic'", [EVENT]
    )).rows.map((r) => [r.code, r]));

    const todo = MAP.filter((m) => cur.has(m.from));
    if (todo.length !== MAP.length) {
      const missing = MAP.filter((m) => !cur.has(m.from)).map((m) => m.from);
      console.log(`  ⚠ 품목표에 없어 건너뜁니다: ${missing.join(', ')}`);
      if (!todo.length) { console.log('  할 일이 없습니다.'); await client.query('ROLLBACK'); return; }
    }

    /* id를 옮기는 동안 서로 부딪히지 않게 임시 id로 한 번 비켜 둔다.
       G-050 → G-021처럼 목적지가 비어 있어도, 두 줄이 같은 id를 스쳐 가는
       순서가 생기면 기본키 충돌로 트랜잭션이 통째로 깨진다. */
    for (const m of todo) {
      const tmp = `TMP-${m.from}-${Date.now()}`;
      if (!DRY) {
        await client.query('UPDATE equip_catalog SET id=$1 WHERE id=$2', [tmp, cur.get(m.from).id]);
        await client.query('UPDATE exhibitor_items SET catalog_id=$1 WHERE catalog_id=$2',
          [tmp, cur.get(m.from).id]);
      }
      m._tmp = tmp;
    }

    let items = 0, names = 0;
    for (const m of todo) {
      const oldId = cur.get(m.from).id;
      const newId = idOf(m.to);
      const oldName = cur.get(m.from).name_ko;

      // 이 품목을 쓰는 신청 항목 — 이름에 옛 코드가 박힌 줄만 고친다
      const used = (await client.query(
        `SELECT id, name FROM exhibitor_items WHERE catalog_id=$1`,
        [DRY ? oldId : m._tmp])).rows;
      const stale = used.filter((r) => String(r.name || '').trim().startsWith(m.from + ' '));

      console.log(`  ${m.from} → ${m.to}   «${oldName}» → «${m.name}»`);
      console.log(`      id ${oldId} → ${newId}`);
      console.log(`      쓰는 항목 ${used.length}건${stale.length ? ` · 이름에 옛 코드 ${stale.length}건 고침` : ''}`);
      items += used.length;
      names += stale.length;

      if (!DRY) {
        await client.query(
          `UPDATE equip_catalog SET id=$1, code=$2, name_ko=$3, category=$4, sort_order=$5 WHERE id=$6`,
          [newId, m.to, m.name, m.category, m.sort, m._tmp]);
        await client.query('UPDATE exhibitor_items SET catalog_id=$1 WHERE catalog_id=$2',
          [newId, m._tmp]);
        for (const r of stale) {
          await client.query('UPDATE exhibitor_items SET name=$1 WHERE id=$2',
            [`${m.to} ${m.name}`, r.id]);
        }
      }
    }

    if (DRY) await client.query('ROLLBACK'); else await client.query('COMMIT');

    console.log(`\n${EVENT}: 품목 ${todo.length}건 재배치 · 신청 항목 ${items}건 연결 유지 · 이름 ${names}건 정리`);
    if (DRY) console.log('--dry — 실제로 바꾸지 않았습니다.');
    else console.log('임포트 스크립트(import-graphic-catalog.js)도 같은 코드를 쓰는지 확인하세요.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
