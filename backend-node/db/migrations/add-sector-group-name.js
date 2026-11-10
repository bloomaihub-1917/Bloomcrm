/* ══════════════════════════════════════════════════════════════
   add-sector-group-name.js — sectors에 «큰 갈래» 칸(group_name)을 붙인다

   섹터는 메인 → 서브 2단계라, 시공·설치 / 전기·설비 / 제작·렌탈 / 연출·기술 / 운영·서비스 같은
   큰 갈래는 표에 둘 자리가 없어 문서(docs/category-plan.md)에만 있었다. 메인 섹터마다 갈래 이름을
   적는 칸을 두고, 사이드바·설정·선택창이 이 값으로 제목을 묶는다.
   (단계를 하나 더 늘리지 않은 이유: 화면 곳곳이 메인/서브 2단계를 전제로 한다)

   처음 값: 정해 둔 MICE 갈래. 이미 값이 있는 행은 건드리지 않는다.

     node db/migrations/add-sector-group-name.js          (시험 실행)
     node db/migrations/add-sector-group-name.js --apply
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('../pool');

const APPLY = process.argv.includes('--apply');

const GROUPS = {
  '시공·설치': ['부스/무대/구조물'],
  '전기·설비': ['전기', '급배수·압축공기', '가스설비', '방염'],
  '제작·렌탈': ['판촉(기념품,굿즈)', '인쇄/출력', '행사가구/텐트/렌탈'],
  '연출·기술': ['영상', 'LED/LCD 디스플레이', '음향', '조명', '이벤트(특효)장치/장비', 'IT솔루션'],
  '운영·서비스': ['대행사', '엔터에이전시(MC/공연)', '통역', '케이터링', '교통', '프리랜서'],
  '장소': ['베뉴'],
  '기타': ['이벤트 부스', '이벤트·MICE 기타'],
};

async function main(){
  if(APPLY) await pool.query('ALTER TABLE sectors ADD COLUMN IF NOT EXISTS group_name TEXT');
  const { rows } = await pool.query('SELECT id, name FROM sectors').catch(() => ({ rows: null }));
  if(!rows){ console.log('(컬럼이 아직 없음 — --apply로 붙인다)'); return; }
  const byName = new Map(rows.map(r => [r.name, r.id]));
  let n = 0;
  for(const [g, names] of Object.entries(GROUPS)){
    for(const name of names){
      const id = byName.get(name);
      if(!id){ console.log(`  (없음) ${name}`); continue; }
      console.log(`  ${g.padEnd(8)} ← ${name}`);
      n++;
      if(APPLY) await pool.query('UPDATE sectors SET group_name = $1 WHERE id = $2 AND group_name IS NULL', [g, id]);
    }
  }
  console.log(APPLY ? `완료 — ${n}개` : `\n시험 실행 — ${n}개를 묶을 예정. --apply로 적용`);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
