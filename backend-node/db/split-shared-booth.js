/* ══════════════════════════════════════════════════════════════
   split-shared-booth.js — 부스 39를 두 기업이 50:50으로 나눠 쓰는 건 반영

   서울대학교병원(39-1)과 분당서울대학교병원(39-2)이 부스 하나를 함께 쓰고,
   부스비와 비품비를 반씩 나눠 청구·세금계산서·입금을 각각 진행한다.

   지금은 서울대 한 곳만 등록돼 있고 항목에 전체 금액(부스 2,400,000)이 들어가
   있어 발행된 인보이스(1,263,250)와 맞지 않는다. 분당은 아예 없다.

   나누는 방식
     - 금액은 항목마다 반으로 나눈다.
     - 비품 수량은 서울대 쪽에만 실물 그대로 남긴다. 양쪽에 4개씩 적으면 발주
       집계가 8개가 되어 없는 의자를 주문하게 된다. 분당 몫은 금액만 한 줄로
       묶어 넣는다.
     - 항목 이름에 공동 사용임을 적어 나중에 봐도 왜 반값인지 알 수 있게 한다.

   검산: 부스 2,400,000 + 비품 126,500 = 2,526,500 → 절반 1,263,250
         서울대에 이미 발행된 인보이스 금액과 정확히 같다.

     node db/split-shared-booth.js --dry
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EVENT = '2026 KIC';
const SNUH_ID = 'X-1787561569303_18';   // 서울대학교병원 (39-1)

const SHARE_NOTE = '공동 부스 39 · 50% 분담';
const nowIso = () => new Date().toISOString();
const num = (v) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const snuh = (await client.query('SELECT * FROM exhibitors WHERE id = $1', [SNUH_ID])).rows[0];
    if (!snuh) throw new Error('서울대학교병원 참가기업을 찾을 수 없습니다.');

    const items = (await client.query(
      'SELECT * FROM exhibitor_items WHERE exhibitor_id = $1 ORDER BY category, id', [SNUH_ID])).rows;

    /* 나눌 대상은 부스와 비품이다. 추가 배지는 서울대가 자기 몫으로 신청한
       건이고 애초에 청구에서 빠져 있어 건드리지 않는다. */
    const shared = items.filter((i) => ['booth', 'equip'].includes(i.category));
    const booth = shared.filter((i) => i.category === 'booth');
    const equip = shared.filter((i) => i.category === 'equip');

    /* 비품 금액이 비어 있다. 카탈로그 단가 × 수량으로 채운다 — 이 값이 있어야
       반으로 나눌 수 있고, 지금 인보이스와 맞는지도 검산할 수 있다. */
    const cat = (await client.query(
      'SELECT * FROM equip_catalog WHERE event_id = $1', [EVENT])).rows;
    const catOf = (i) => cat.find((c) => c.id === i.catalog_id)
      || cat.find((c) => String(i.name || '').toUpperCase().includes(String(c.code || '').toUpperCase()));

    let equipFull = 0;
    const equipRows = equip.map((i) => {
      const c = catOf(i);
      const qty = num(i.qty) || 1;
      const full = num(i.amount) || (c ? num(c.price_krw) * qty : 0);
      equipFull += full;
      return { i, c, qty, full, unit: c ? num(c.price_krw) : 0 };
    });

    const boothFull = booth.reduce((a, i) => a + num(i.amount), 0);
    const total = boothFull + equipFull;
    const half = total / 2;

    console.log(`\n부스 ${boothFull.toLocaleString()}원 + 비품 ${equipFull.toLocaleString()}원 = ${total.toLocaleString()}원`);
    console.log(`  절반 ${half.toLocaleString()}원`);

    const inv = (await client.query(
      `SELECT amount FROM exhibitor_invoices WHERE exhibitor_id = $1 AND COALESCE(status,'') <> 'void'`, [SNUH_ID])).rows;
    const invAmt = inv.reduce((a, v) => a + num(v.amount), 0);
    console.log(`  서울대 인보이스 ${invAmt.toLocaleString()}원 — ${invAmt === half ? '절반과 일치 ✓' : '⚠ 절반과 다릅니다'}`);
    if (invAmt !== half) throw new Error('계산이 인보이스와 맞지 않아 중단합니다. 금액을 먼저 확인해주세요.');

    /* ── ① 서울대 항목을 반값으로 ── */
    for (const i of booth) {
      const v = num(i.amount) / 2;
      if (!DRY) await client.query(
        `UPDATE exhibitor_items SET amount=$2, unit_price=$2, name=$3, note=$4 WHERE id=$1`,
        [i.id, String(v), `${i.name} (${SHARE_NOTE})`, SHARE_NOTE]);
      console.log(`  서울대 ${i.name}: ${num(i.amount).toLocaleString()} → ${v.toLocaleString()}`);
    }
    for (const r of equipRows) {
      const v = r.full / 2;
      if (!DRY) await client.query(
        `UPDATE exhibitor_items SET amount=$2, unit_price=$3, currency='KRW', note=$4 WHERE id=$1`,
        [r.i.id, String(v), String(r.unit), SHARE_NOTE]);
      console.log(`  서울대 ${r.i.name} ×${r.qty}: ${r.full.toLocaleString()} → ${v.toLocaleString()}`);
    }

    /* ── ② 분당서울대학교병원 등록 ── */
    let org = (await client.query(`SELECT * FROM orgs WHERE name_ko = '분당서울대학교병원'`)).rows[0];
    if (!org) {
      const snuhOrg = (await client.query('SELECT * FROM orgs WHERE id = $1', [snuh.org_id])).rows[0];
      org = {
        id: `O-${Date.now()}_1`, name_ko: '분당서울대학교병원',
        name_en: 'Seoul National University Bundang Hospital', abbr: '분당',
        aliases: '', kind: '전시참가기업', status: '활성',
        sectors: snuhOrg?.sectors || '', country: '대한민국', hq: '대한민국',
        website: '', biz_no: '', cat_code: '', notes: '서울대학교병원과 부스 39 공동 사용',
        source: '공동 부스 분리', created_at: nowIso(), updated_at: nowIso(),
      };
      if (!DRY) {
        const cols = Object.keys(org);
        await client.query(
          `INSERT INTO orgs (${cols.map((c) => `"${c}"`).join(',')})
           VALUES (${cols.map((_, k) => `$${k + 1}`).join(',')})`, cols.map((c) => org[c]));
      }
      console.log(`\n  기업 등록: 분당서울대학교병원 (${org.id})`);
    } else {
      console.log(`\n  기업 이미 있음: ${org.id}`);
    }

    let bd = (await client.query(
      `SELECT * FROM exhibitors WHERE event_id=$1 AND booth_no='39-2'`, [EVENT])).rows[0];
    if (!bd) {
      bd = {
        id: `X-${Date.now()}_2`, event_id: EVENT, org_id: org.id,
        company_key: '분당서울대학교병원', company_name: '분당서울대학교병원',
        status: '준비중', note: '서울대학교병원(39-1)과 부스 하나를 함께 쓰고 부스비·비품비를 50:50으로 나눠 청구합니다.',
        updated_at: new Date().toISOString().slice(0, 10),
        booth_no: '39-2', booth_floor: snuh.booth_floor, booth_type: snuh.booth_type,
        booth_qty: snuh.booth_qty, grade: snuh.grade,
        booth_confirmed: snuh.booth_confirmed, booth_confirmed_at: snuh.booth_confirmed_at,
      };
      if (!DRY) {
        const cols = Object.keys(bd);
        await client.query(
          `INSERT INTO exhibitors (${cols.map((c) => `"${c}"`).join(',')})
           VALUES (${cols.map((_, k) => `$${k + 1}`).join(',')})`, cols.map((c) => bd[c]));
      }
      console.log(`  참가기업 등록: 분당서울대학교병원 부스 39-2 (${bd.id})`);
    } else {
      console.log(`  참가기업 이미 있음: ${bd.id}`);
    }

    /* ── ③ 분당 몫 항목 ──
       비품은 수량을 적지 않고 금액만 한 줄로 넣는다. 양쪽에 수량을 적으면
       발주 집계가 두 배가 되어 없는 의자를 주문하게 된다. */
    const has = (await client.query(
      'SELECT id FROM exhibitor_items WHERE exhibitor_id = $1', [bd.id])).rows;
    if (!has.length) {
      const rows = [
        { id: `XI-${Date.now()}_a`, exhibitor_id: bd.id, category: 'booth',
          name: `${snuh.booth_type} (${SHARE_NOTE})`, qty: '', unit_price: String(boothFull / 2),
          amount: String(boothFull / 2), currency: 'KRW', note: SHARE_NOTE, sort_order: '1', catalog_id: '', billable: '' },
        { id: `XI-${Date.now()}_b`, exhibitor_id: bd.id, category: 'equip',
          name: `비품 분담금 (${SHARE_NOTE} — 실물 수량은 39-1에 기록)`, qty: '', unit_price: '',
          amount: String(equipFull / 2), currency: 'KRW', note: SHARE_NOTE, sort_order: '2', catalog_id: '', billable: '' },
      ];
      for (const r of rows) {
        if (!DRY) {
          const cols = Object.keys(r);
          await client.query(
            `INSERT INTO exhibitor_items (${cols.map((c) => `"${c}"`).join(',')})
             VALUES (${cols.map((_, k) => `$${k + 1}`).join(',')})`, cols.map((c) => r[c]));
        }
        console.log(`  분당 항목: ${r.name} ${num(r.amount).toLocaleString()}원`);
      }
    } else {
      console.log('  분당 항목 이미 있음 — 건드리지 않습니다');
    }

    console.log(`\n결과: 양쪽 각각 ${half.toLocaleString()}원 청구`);
    console.log('  인보이스·세금계산서·입금은 각각 진행되므로 분당 쪽은 화면에서 직접 넣어주세요.');

    if (DRY) { await client.query('ROLLBACK'); console.log('\n--dry 라서 되돌렸습니다.'); }
    else { await client.query('COMMIT'); console.log('\n반영 완료.'); }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
