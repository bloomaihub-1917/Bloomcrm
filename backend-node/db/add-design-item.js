/* ══════════════════════════════════════════════════════════════
   add-design-item.js — 부스 디자인 의뢰에 품목코드를 만든다

   부스 디자인을 의뢰받은 건에는 품목코드가 없었다. 그래서 정산 항목에 이름만
   손으로 적혔고("디자인 의뢰-블록시스템 C 1부스"), 품목표에 없으니 다음에
   같은 의뢰가 와도 또 손으로 적게 된다. 표기가 갈리면 "디자인 의뢰 올해 몇 건,
   얼마"를 셀 수 없다.

   코드는 하나로 통일한다 — 대상마다 코드를 나누면 세는 단위가 흩어진다.
   대신 무엇을 디자인했는지는 항목의 note에 따로 적는다(exhibitor_items.note).
   그 칸은 화면에서 부스 타입·품목표에서 골라 넣게 해, 손으로 적어 표기가
   흔들리는 것을 막는다.

   단가는 비워 둔다. 대상과 범위에 따라 매번 다르다(지금 건은 블록시스템 C
   1부스에 ₩330,000). 품목표 단가를 넣어 두면 그 값이 자동으로 채워져 실제
   청구액을 덮는다.

   여러 번 돌려도 안전하다 — 코드가 같으면 덮어쓰고, 이미 연결된 항목은 그대로 둔다.

     node db/add-design-item.js --dry
     node db/add-design-item.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes('--dry');
const EVENT = arg('--event') || '2026 KIC';

const CODE = 'G-130';
const NAME = '부스 디자인 의뢰';
/* 그래픽 코드가 G-010~G-120을 쓰고 있어 그 다음 자리다. 분류를 따로 둬서
   화면이 "이 항목은 디자인 의뢰다"를 카탈로그만 보고 알 수 있게 한다. */
const CATEGORY = '디자인';
const SORT = '130';

/* 이름에 대상이 붙어 있던 옛 항목 — 대상을 note로 옮기고 이름을 코드로 통일한다.
   지어내지 않고, 실제로 들어 있는 표기만 적는다. */
const SPLIT = [
  { match: '디자인 의뢰-블록시스템 C 1부스', target: 'Block System C 1부스' },
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1) 품목 만들기 ──
    const have = (await client.query(
      'SELECT id FROM equip_catalog WHERE event_id=$1 AND code=$2', [EVENT, CODE])).rows[0];
    const id = have ? have.id : `EC-DSG-${CODE}-${EVENT.replace(/[^A-Za-z0-9]/g, '')}`;
    const rec = {
      id, event_id: EVENT, kind: 'graphic', category: CATEGORY,
      code: CODE, name_ko: NAME, name_en: 'Booth Design', spec: '',
      price_krw: '', price_usd: '',
      note: '단가는 대상·범위마다 달라 항목에서 직접 적습니다',
      active: '', sort_order: SORT,
    };
    console.log(`  ${have ? '갱신' : '신규'}  ${CODE}  ${NAME}  (단가 없음 — 항목에서 입력)`);
    if (!DRY) {
      const cols = Object.keys(rec);
      await client.query(
        `INSERT INTO equip_catalog (${cols.map((c) => `"${c}"`).join(',')})
         VALUES (${cols.map((_, k) => `$${k + 1}`).join(',')})
         ON CONFLICT (id) DO UPDATE SET ${cols.filter((c) => c !== 'id')
          .map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}`,
        cols.map((c) => rec[c]));
    }

    // ── 2) 이름에 대상이 붙어 있던 항목을 코드에 연결하고 대상을 note로 ──
    let moved = 0;
    for (const s of SPLIT) {
      const rows = (await client.query(
        `SELECT i.id, i.name, i.note FROM exhibitor_items i
           JOIN exhibitors x ON x.id = i.exhibitor_id
          WHERE x.event_id=$1 AND i.name=$2 AND coalesce(i.voided_at,'')=''`,
        [EVENT, s.match])).rows;
      for (const it of rows) {
        // 이미 대상이 적혀 있으면 덮지 않는다 — 사람이 고쳐 둔 것일 수 있다
        const note = String(it.note || '').trim() || s.target;
        console.log(`  연결  «${it.name}» → ${CODE}   대상: ${note}`);
        moved++;
        if (!DRY) {
          await client.query(
            'UPDATE exhibitor_items SET catalog_id=$1, name=$2, note=$3 WHERE id=$4',
            [id, `${CODE} ${NAME}`, note, it.id]);
        }
      }
    }

    if (DRY) await client.query('ROLLBACK'); else await client.query('COMMIT');

    console.log(`\n${EVENT}: 품목 1건 · 기존 항목 ${moved}건 연결`);
    if (DRY) console.log('--dry — 실제로 바꾸지 않았습니다.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
