/* ══════════════════════════════════════════════════════════════
   merge-item-names.js — 같은 물건인데 다르게 적힌 정산 항목을 하나로

   정산 항목의 이름은 신청서에서 옮겨 적은 값이라 표기가 흔들린다. 사람 눈에는
   같은 물건인데 데이터로는 다른 줄이 되어, 발주할 때 같은 것을 두 번 세거나
   품목별 합계가 갈린다.

   손대는 건 두 가지뿐이다.

   1) 부스 타입 대소문자 — code_lists.booth_type의 값이 정본이다. 부스 타입은
      그 목록에서 고르게 돼 있는데, 손으로 적힌 줄이 대소문자만 달라 목록의 어느
      값과도 맞지 않는다. 필터·집계에서 빠진다.

   2) 품목표에 뒤늦게 생긴 품목 연결 — 부대시설(전기·조명)은 카탈로그에 없던
      시절 손으로 적혔다. 이제 품목이 있으니 catalog_id를 붙인다. 이름은 받은
      그대로 둔다 — 신청서에 뭐라고 적혀 왔는지가 나중에 근거가 된다.

   금액은 건드리지 않는다. 연결만 하고, 단가가 품목표와 어긋나면 알려만 준다 —
   실제로 청구한 값이 맞고 품목표가 나중에 바뀌었을 수도 있다.

     node db/merge-item-names.js --dry
     node db/merge-item-names.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

/* 앱과 같은 규칙으로 이름을 눌러 본다 (state.js findCatalogByName) */
const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
const num = (v) => Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0;

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* ── 1) 부스 타입 표기를 code_lists 정본에 맞춘다 ── */
    const types = (await client.query(
      "SELECT code FROM code_lists WHERE list_key='booth_type' AND coalesce(active,'')<>'no'")).rows
      .map((r) => String(r.code).trim());
    const byNorm = new Map(types.map((t) => [norm(t), t]));

    const boothRows = (await client.query(
      "SELECT id, name FROM exhibitor_items WHERE category='booth' AND coalesce(voided_at,'')=''")).rows;

    let renamed = 0;
    for (const r of boothRows) {
      const canon = byNorm.get(norm(r.name));
      if (!canon || canon === r.name) continue;
      console.log(`  표기  «${r.name}» → «${canon}»`);
      renamed++;
      if (!DRY) await client.query('UPDATE exhibitor_items SET name=$1 WHERE id=$2', [canon, r.id]);
    }

    /* ── 2) 품목표에 뒤늦게 생긴 품목에 연결 ── */
    const cats = (await client.query(
      "SELECT id, event_id, code, name_ko, name_en, price_krw, price_usd FROM equip_catalog")).rows;
    const loose = (await client.query(`
      SELECT i.id, i.name, i.qty, i.amount, i.currency, x.event_id
        FROM exhibitor_items i JOIN exhibitors x ON x.id = i.exhibitor_id
       WHERE coalesce(i.catalog_id,'')='' AND coalesce(i.voided_at,'')=''
         AND i.category IN ('equip','graphic')`)).rows;

    let linked = 0;
    const priceWarn = [];
    for (const it of loose) {
      const k = norm(it.name);
      // 코드가 이름에 들어 있으면 그걸 먼저 본다 ("O-020 Catalogue Holder B")
      const codeM = String(it.name).toUpperCase().match(/\b([A-Z]{1,2}-\d{2,4})\b/);
      const hit = cats.find((c) => c.event_id === it.event_id && (
        (codeM && String(c.code).toUpperCase() === codeM[1])
        || norm(c.name_ko) === k || norm(c.name_en) === k));
      if (!hit) continue;

      const unit = it.currency === 'USD' ? num(hit.price_usd) : num(hit.price_krw);
      const qty = num(it.qty) || 1;
      const amt = num(it.amount);
      if (unit && amt && Math.abs(unit * qty - amt) > 0.5) {
        priceWarn.push(`${it.name} — 청구 ${amt} vs 품목표 ${unit}×${qty}=${unit * qty}`);
      }

      console.log(`  연결  «${it.name}» → ${hit.code} ${hit.name_ko || hit.name_en}`);
      linked++;
      if (!DRY) await client.query('UPDATE exhibitor_items SET catalog_id=$1 WHERE id=$2', [hit.id, it.id]);
    }

    /* ── 3) 이름이 겹치는 품목표 항목은 알리기만 한다 ──
       단가가 다르면 서로 다른 물건인데 이름만 같게 지어진 것이다. 합치면
       한쪽 값이 사라지므로, 무엇이 다른지 아는 사람이 이름을 고쳐야 한다. */
    const dupes = (await client.query(`
      SELECT event_id, regexp_replace(lower(coalesce(nullif(name_ko,''),name_en)),'[^a-z0-9가-힣]','','g') k,
             STRING_AGG(code||' ₩'||coalesce(price_krw,'-'), ' / ' ORDER BY code) 목록
        FROM equip_catalog GROUP BY 1,2 HAVING COUNT(*) > 1`)).rows;

    /* ── 4) 끝내 못 붙은 비품·그래픽 항목을 보여준다 ──
       이름이 조금만 달라도 자동으로는 붙이지 않는다. 짐작으로 이으면 엉뚱한
       품목의 단가로 합계가 잡힌다. 대신 짧은 목록으로 뽑아 사람이 판단하게 한다.
       (부스·기타는 품목표에 있을 물건이 아니라 여기서 뺀다) */
    const left = (await client.query(`
      SELECT x.event_id, i.name, i.qty, i.amount, i.currency
        FROM exhibitor_items i JOIN exhibitors x ON x.id = i.exhibitor_id
       WHERE coalesce(i.catalog_id,'')='' AND coalesce(i.voided_at,'')=''
         AND i.category IN ('equip','graphic')
       ORDER BY i.name`)).rows;

    if (DRY) await client.query('ROLLBACK'); else await client.query('COMMIT');

    console.log(`\n표기 통일 ${renamed}건 / 품목표 연결 ${linked}건`);
    if (priceWarn.length) {
      console.log('\n금액이 품목표와 다릅니다 (연결만 했고 금액은 그대로 뒀습니다):');
      priceWarn.forEach((w) => console.log('  · ' + w));
    }
    if (dupes.length) {
      console.log('\n품목표에 같은 이름이 둘 이상 — 단가가 다르면 다른 물건입니다. 이름을 갈라 주세요:');
      dupes.forEach((d) => console.log(`  · ${d.event_id} — ${d.목록}`));
    }
    if (left.length) {
      console.log(`\n품목표에 못 붙인 비품·그래픽 ${left.length}건 — 품목표에 없는 물건이거나 이름이 많이 다른 것들입니다:`);
      left.forEach((r) => console.log(`  · ${r.name}  (${r.qty || '?'}개 · ${r.amount || '-'} ${r.currency || ''})`));
      console.log('  → 품목표에 넣을 것이면 설정 › 비품 카탈로그에서 추가한 뒤 이 스크립트를 다시 돌리세요.');
    }
    if (DRY) console.log('\n--dry — 실제로 바꾸지 않았습니다.');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
