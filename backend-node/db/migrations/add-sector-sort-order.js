/* ══════════════════════════════════════════════════════════════
   add-sector-sort-order.js — sectors에 줄 세우는 순서 칸(sort_order)을 붙인다

   섹터 순서는 지금까지 표의 id 글자순이었고, «섹터 순» 정렬은 코드 안 목록
   (SECTOR_ORDER)을 따로 들고 있었다. 설정에서 섹터를 고쳐도 사이드바·목록·선택창이
   같이 안 바뀌던 이유다. 순서를 표 한 곳에 두고 화면 전부가 그걸 읽게 한다.

   처음 값: 정해 둔 MICE 큰 갈래 순(docs/category-plan.md) → 나머지는 지금 순서(id 순)
   → «업종 미정»은 맨 끝. 이미 값이 있는 행은 건드리지 않는다.

     node db/migrations/add-sector-sort-order.js          (시험 실행)
     node db/migrations/add-sector-sort-order.js --apply
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('../pool');

const APPLY = process.argv.includes('--apply');

const FIRST = [
  '부스/무대/구조물',
  '전기', '급배수·압축공기', '가스설비', '방염',
  '판촉(기념품,굿즈)', '인쇄/출력', '행사가구/텐트/렌탈',
  '영상', 'LED/LCD 디스플레이', '음향', '조명', '이벤트(특효)장치/장비', 'IT솔루션',
  '대행사', '엔터에이전시(MC/공연)', '통역', '케이터링', '교통', '프리랜서',
  '베뉴', '이벤트 프로그램/체험', '이벤트 부스', '이벤트·MICE 기타',
];

async function main(){
  if(APPLY) await pool.query('ALTER TABLE sectors ADD COLUMN IF NOT EXISTS sort_order INTEGER');
  const { rows } = await pool.query('SELECT id, name, sort_order FROM sectors ORDER BY id').catch(() => ({ rows: null }));
  if(!rows){ console.log('(시험 실행: 컬럼이 아직 없어 목록만 계산할 수 없음 — --apply로 컬럼부터 붙인다)'); return; }

  const rank = (r) => {
    const i = FIRST.indexOf(r.name);
    if(i >= 0) return [0, i];
    if(/업종 미정/.test(r.name)) return [2, 0];
    return [1, 0];
  };
  const sorted = rows.slice().sort((a, b) => {
    const [ga, ia] = rank(a), [gb, ib] = rank(b);
    return ga - gb || ia - ib; // 같은 묶음 안에서는 id 순 유지(정렬이 안정적이다)
  });
  const todo = [];
  sorted.forEach((r, i) => { if(r.sort_order == null) todo.push([r.id, i + 1]); });
  console.log(`섹터 ${rows.length}개 중 순서를 매길 것 ${todo.length}개`);
  sorted.slice(0, 30).forEach((r, i) => console.log(`  ${String(i + 1).padStart(3)}  ${r.name}`));
  if(!APPLY){ console.log('\n시험 실행 — 바꾸지 않았습니다. --apply로 적용'); return; }
  for(const [id, n] of todo) await pool.query('UPDATE sectors SET sort_order = $1 WHERE id = $2', [n, id]);
  console.log('완료');
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
