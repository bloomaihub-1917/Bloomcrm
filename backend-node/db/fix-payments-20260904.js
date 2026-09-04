/* ══════════════════════════════════════════════════════════════
   fix-payments-20260904.js — 통장 대조 결과를 반영한다

   통장 입출금내역(2026/06/01~09/01) 18건과 CRM 원화 입금을 맞춰 본 결과다.
   18건 모두 CRM에 있었고, 아래만 손보면 된다.

   ① 수단 미기재 → 계좌이체
      통장에 찍힌 건은 전부 계좌이체다. 카드로 결제한 건은 이미 수단이 적혀
      있으므로, 남은 미기재를 계좌이체로 채운다. 통장에서 확인되지 않은 건은
      건드리지 않는다 — 추측으로 채우면 다음 대조 때 근거가 사라진다.

   ② 단테비전 입금일 08-11 → 08-10
      통장이 08/10이다. 통장을 기준으로 맞춘다.

   ③ 메디데이터 — 시공사가 카드로 대신 결제
      통장에 같은 금액이 없어 확인했더니 ㈜레디두(시공사)가 카드로 냈다.

   ④ 시공사 대납 표시
      통장 예금주가 참가기업이 아니라 시공사인 건이 있다. 금액·날짜가 맞아
      짝은 확실하지만, 적어 두지 않으면 다음에 통장과 맞출 때 또 헷갈린다.

     node db/fix-payments-20260904.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

/* [입금 id, 바꿀 값들, 설명] */
const FIXES = [
  ['XP-1787565413953_207', { paid_at: '2026-08-10' },
    '단테비전 입금일을 통장(08/10)에 맞춤'],
  ['XP-1787565396556_27', { method: '카드', note: '㈜레디두(시공사) 카드 대납 · 2026081912140147' },
    '메디데이터 — 시공사가 카드로 대신 결제'],
  ['XP-1788231585290_206', { method: '계좌이체', note: '웰디자인 주식회사(시공사) 대납' },
    '에스씨엘헬스케어 — 시공사 대납'],
  ['XP-1787565413471_202', { method: '계좌이체', note: '㈜디자인지오(시공사) 대납 · 2026081113421499' },
    '에이씨엠글로벌래버러토리스 — 시공사 대납'],
];

/* 통장에서 계좌이체로 확인된 건 — 금액과 날짜가 통장과 맞는 것만 채운다 */
const BANK = [
  ['2026-09-01', 2800000], ['2026-08-31', 209000], ['2026-08-28', 165000],
  ['2026-08-28', 2246000], ['2026-08-26', 3515000], ['2026-08-25', 3890500],
  ['2026-08-25', 5306000], ['2026-08-24', 1263250], ['2026-08-24', 1300000],
  ['2026-08-21', 1263250], ['2026-08-21', 3137000], ['2026-08-20', 2488000],
  ['2026-08-19', 2526500], ['2026-08-18', 1371500], ['2026-08-18', 2748500],
  ['2026-08-11', 715000], ['2026-08-10', 1382500],
];
const num = (v) => Number(String(v ?? '').replace(/[^0-9.]/g, '')) || 0;

(async () => {
  const client = await pool.connect();
  try {
    await client.query(DRY ? 'BEGIN' : 'BEGIN');
    let seq = 0;
    const audit = (action, target, detail) => client.query(
      `INSERT INTO activity_log (id, ts, email, name, type, action, target, detail)
       VALUES ($1,$2,'','통장 대조','edit',$3,$4,$5)`,
      [`L-${Date.now()}-${seq++}`, new Date().toISOString(), action, target, detail]);

    // ①~④ 개별 수정
    console.log('■ 개별 수정');
    for (const [id, set, why] of FIXES) {
      const { rows } = await client.query(
        `SELECT p.amount, p.paid_at, p.method, p.note, e.company_name
           FROM exhibitor_payments p JOIN exhibitors e ON e.id = p.exhibitor_id WHERE p.id = $1`, [id]);
      if (!rows[0]) { console.log(`   ${id} — 못 찾음`); continue; }
      const b = rows[0];
      const cols = Object.keys(set);
      console.log(`   ${b.company_name} — ${why}`);
      cols.forEach((c) => console.log(`       ${c}: ${JSON.stringify(b[c] || '')} → ${JSON.stringify(set[c])}`));
      await client.query(
        `UPDATE exhibitor_payments SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...cols.map((c) => set[c])]);
      await audit('입금 정보 수정', b.company_name, `${why} — ${cols.map((c) => `${c} ${b[c] || '(빈값)'} → ${set[c]}`).join(' / ')}`);
    }

    // ① 나머지 미기재 → 계좌이체 (통장에서 확인된 건만)
    const { rows: blanks } = await client.query(`
      SELECT p.id, p.amount, p.paid_at, e.company_name
        FROM exhibitor_payments p JOIN exhibitors e ON e.id = p.exhibitor_id
       WHERE e.event_id = '2026 KIC' AND COALESCE(p.method,'') = ''
         AND COALESCE(p.kind,'') <> 'refund'
         AND COALESCE(NULLIF(p.currency,''),'KRW') = 'KRW'`);

    const hit = [], miss = [];
    blanks.forEach((p) => {
      (BANK.some(([d, a]) => d === p.paid_at && a === num(p.amount)) ? hit : miss).push(p);
    });

    console.log(`\n■ 미기재 → 계좌이체 ${hit.length}건 (통장에서 확인된 것만)`);
    hit.forEach((p) => console.log(`   ${p.paid_at} ${String(num(p.amount).toLocaleString()).padStart(10)} ${p.company_name}`));
    if (miss.length) {
      console.log(`\n■ 통장에서 못 찾아 그대로 두는 미기재 ${miss.length}건`);
      miss.forEach((p) => console.log(`   ${p.paid_at || '날짜없음'} ${String(num(p.amount).toLocaleString()).padStart(10)} ${p.company_name}`));
    }
    for (const p of hit) {
      await client.query(`UPDATE exhibitor_payments SET method = '계좌이체' WHERE id = $1`, [p.id]);
    }
    if (hit.length) await audit('결제 수단 채움', '2026 KIC',
      `통장에서 확인된 계좌이체 <b>${hit.length}건</b>의 수단을 채움`);

    if (DRY) { await client.query('ROLLBACK'); console.log('\n--dry 라서 되돌렸습니다.'); return; }
    await client.query('COMMIT');
    console.log('\n반영 완료.');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
