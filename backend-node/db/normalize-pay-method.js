/* ══════════════════════════════════════════════════════════════
   normalize-pay-method.js — 결제 수단을 표준값으로 정리한다

   입금 내역과 엑스렌탈 카드 결제가 한 덩어리로 보여 금액이 헷갈린다는 지적.
   원인은 결제 수단이 method 칸에 자유 문구로 흩어져 있어서다.

     "카드결제(exrental)" · "exrental 결제" · "exrental 카드 결제"
     "2026080717081336 exrental 결제완료"   ← 승인번호가 섞여 있다
     "계좌이체(입금)" · "계좌이체(외화송금)" · "카드(Toss Payments)" · "입금"
     "웰디자인 주식회사"                      ← 수단이 아니라 업체명
     (빈 값 다수)

   수단을 몇 개로 추린다. 화면이 이 값으로 갈라 보여준다.

     계좌이체 · 카드(엑스렌탈) · 카드 · 외화송금 · (빈 값 = 확인 안 됨)

   원래 적혀 있던 글은 버리지 않는다. 승인번호·인보이스 번호가 들어 있어서
   나중에 대사할 때 근거가 된다. note로 옮기고, note에 이미 값이 있으면 뒤에 붙인다.

     node db/normalize-pay-method.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

/* 무엇으로 볼지 — 위에서부터 먼저 걸리는 것을 쓴다.
   엑스렌탈이 카드보다 먼저다("카드결제(exrental)"은 엑스렌탈로 봐야 한다). */
function methodOf(raw){
  const t = String(raw || '').toLowerCase();
  if(!t.trim()) return '';
  if(t.includes('exrental') || t.includes('엑스렌탈')) return '카드(엑스렌탈)';
  if(t.includes('외화송금')) return '외화송금';
  if(t.includes('카드')) return '카드';
  if(t.includes('계좌이체') || t.trim() === '입금') return '계좌이체';
  return '';   // 업체명 등 수단이 아닌 값 — 비워 두고 원문은 비고로 남긴다
}

/* 표준값만 남기고 나머지를 비고로 옮긴다. "계좌이체(입금)"처럼 수단만 적힌 글은
   옮겨 봐야 같은 말이 두 번 남으므로 버린다. */
function noteFrom(raw, std){
  const t = String(raw || '').trim();
  if(!t) return '';
  const onlyMethod = ['카드결제(exrental)', '계좌이체(입금)', '계좌이체(외화송금)', '입금',
    'exrental 결제', 'exrental 카드 결제', '카드 부분 취소'];
  if(onlyMethod.includes(t)) return '';
  if(std && t.toLowerCase() === std.toLowerCase()) return '';
  return t;
}

(async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT p.id, p.amount, p.currency, p.paid_at, p.kind, p.method, p.note, e.company_name
        FROM exhibitor_payments p JOIN exhibitors e ON e.id = p.exhibitor_id
       WHERE e.event_id = '2026 KIC' ORDER BY p.paid_at`);

    const plan = [];
    rows.forEach((p) => {
      const std = methodOf(p.method);
      const extra = noteFrom(p.method, std);
      const note = [String(p.note || '').trim(), extra].filter(Boolean).join(' · ');
      if(std === (p.method || '') && note === (p.note || '')) return;   // 바꿀 게 없다
      plan.push({ p, std, note });
    });

    console.log(`입금 기록 ${rows.length}건 · 바꿀 곳 ${plan.length}건\n`);
    plan.forEach(({ p, std, note }) => console.log(
      `  ${p.company_name.slice(0, 16).padEnd(18)} ${(p.currency || 'KRW')} ${String(Number(String(p.amount).replace(/[^0-9.]/g, '')) || 0).padStart(9)}`
      + `\n      수단  ${JSON.stringify(p.method || '')} → ${JSON.stringify(std)}`
      + (note !== (p.note || '') ? `\n      비고  ${JSON.stringify(p.note || '')} → ${JSON.stringify(note)}` : '')));

    const tally = {};
    rows.forEach((p) => { const s = methodOf(p.method) || '(확인 안 됨)'; tally[s] = (tally[s] || 0) + 1; });
    console.log('\n정리 뒤 수단별 건수');
    Object.entries(tally).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`   ${k.padEnd(14)} ${v}건`));

    if (DRY) { console.log('\n--dry 라서 아무것도 바꾸지 않았습니다.'); return; }

    await client.query('BEGIN');
    let seq = 0;
    for (const { p, std, note } of plan) {
      await client.query('UPDATE exhibitor_payments SET method = $1, note = $2 WHERE id = $3', [std, note, p.id]);
      await client.query(
        `INSERT INTO activity_log (id, ts, email, name, type, action, target, detail)
         VALUES ($1,$2,'','정리 스크립트','edit','결제 수단 정리',$3,$4)`,
        [`L-${Date.now()}-${seq++}`, new Date().toISOString(), p.company_name,
          `${p.currency || 'KRW'} ${p.amount} — 수단 ${JSON.stringify(p.method || '')} → ${JSON.stringify(std)}`]);
    }
    await client.query('COMMIT');
    console.log(`\n반영 완료 — ${plan.length}건`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
