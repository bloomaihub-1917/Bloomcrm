/* ══════════════════════════════════════════════════════════════
   rollback-20260903-1800.js — 2026-09-03 18시 이후 변경을 되돌린다

   활동 로그 15건(18:36~18:40, 정다교)을 근거로 되돌린다. 로그가 "A → B" 꼴로
   이전 값을 담고 있어서 되돌릴 값을 지어내지 않아도 된다.

   되돌릴 값의 근거(로그 원문):
     18:36:55  tax_stage requested / tax_requested_at 2026-09-03
               → "→"가 없다 = 처음 설정된 것 = 그 전에는 비어 있었다
     18:36:58  tax_stage requested → to_finance / tax_to_finance_at 2026-09-03
     18:37:02  세금계산서 재무팀 요청 → 발행 완료   (tax_sent_at이 이때 채워졌다)
     18:38:17  그래픽 유형 print → design           → 되돌릴 값 print
     18:40:21  graphic_stage received → to_team     → 18시 시점 값은 received
     18:40:51  graphic_stage to_team → team_ok

   지운 값은 activity_log에 그대로 남긴다 — 이 롤백 자체가 잘못됐을 때
   다시 되돌릴 수 있어야 한다. 값을 지우면서 무엇을 지웠는지 안 남기면
   두 번째 실수는 복구할 방법이 없다.

   읽기만 한 것(비품 대장 내보내기)과 18시 이전 값(graphic_received_at)은
   건드리지 않는다.

     node db/rollback-20260903-1800.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');

const BREDIS = 'X-1787561569303_1';   // ㈜브레디스헬스케어
const BXPLANT = 'X-1787561569303_2';  // ㈜비엑스플랜트

/* [참가기업 id, 이름, { 필드: 되돌릴 값 }] */
const FIELDS = [
  [BREDIS, '㈜브레디스헬스케어', {
    tax_stage: '', tax_requested_at: '', tax_to_finance_at: '', tax_sent_at: '',
    graphic_type: 'print',
  }],
  [BXPLANT, '㈜비엑스플랜트', {
    graphic_stage: 'received', graphic_to_team_at: '', graphic_team_ok_at: '',
  }],
];

/* 18시 이후에 새로 만들어진 줄 — 지운다 */
const DEL_LOG = 'XL-1788428446470_348';         // 그래픽 피드백 "ㄴㅇㄹ"
const DEL_CONTACT = '1788428178211';            // 마스터DB 연락처 "ㅁ"
const DEL_PART = 'P-1788428171240-387';         // 그 사람의 행사 참여 기록

let seq = 0;
const audit = (client, action, target, detail) => client.query(
  `INSERT INTO activity_log (id, ts, email, name, type, action, target, detail)
   VALUES ($1,$2,'','롤백 스크립트','edit',$3,$4,$5)`,
  [`L-${Date.now()}-${seq++}`, new Date().toISOString(), action, target, detail]);

(async () => {
  const client = await pool.connect();
  try {
    console.log('되돌릴 값 — 지금 값과 나란히\n');

    const plan = [];
    for (const [id, name, fields] of FIELDS) {
      const cols = Object.keys(fields);
      const { rows } = await client.query(
        `SELECT ${cols.map((c) => `"${c}"`).join(',')} FROM exhibitors WHERE id = $1`, [id]);
      if (!rows[0]) { console.log(`   ${name}: 참가기업을 못 찾음`); continue; }
      const cur = rows[0];
      console.log(`■ ${name}`);
      const changed = {};
      cols.forEach((c) => {
        const now = cur[c] == null ? '' : String(cur[c]);
        const to = fields[c];
        const mark = now === to ? '  (이미 같음)' : '';
        console.log(`   ${c.padEnd(20)} ${JSON.stringify(now).padEnd(16)} → ${JSON.stringify(to)}${mark}`);
        if (now !== to) changed[c] = { from: now, to };
      });
      if (Object.keys(changed).length) plan.push({ id, name, changed });
      console.log();
    }

    const { rows: lg } = await client.query(
      'SELECT id, subject, body FROM exhibitor_logs WHERE id = $1', [DEL_LOG]);
    const { rows: ct } = await client.query(
      'SELECT id, "nameKo", "orgKo", email1 FROM contacts WHERE id = $1', [DEL_CONTACT]);
    const { rows: pt } = await client.query(
      'SELECT id, event_id, contact_id FROM participations WHERE id = $1', [DEL_PART]);
    const { rows: xc } = await client.query(
      'SELECT id, exhibitor_id FROM exhibitor_contacts WHERE contact_id = $1', [DEL_CONTACT]);

    console.log('■ 지울 것');
    console.log(`   그래픽 피드백  ${lg[0] ? `"${lg[0].body}" (${lg[0].subject})` : '없음(이미 지워짐)'}`);
    console.log(`   마스터DB 연락처 ${ct[0] ? `${ct[0].nameKo} / ${ct[0].orgKo} / ${ct[0].email1}` : '없음'}`);
    console.log(`   행사 참여 기록  ${pt[0] ? `${pt[0].event_id}` : '없음'}`);
    console.log(`   전시 담당자 줄  ${xc.length ? xc.map((r) => r.id).join(', ') : '없음(이미 지워짐)'}`);

    console.log('\n■ 건드리지 않는 것');
    console.log('   비품 대장 내보내기 — 읽기만 한 것이라 되돌릴 게 없다');
    console.log('   graphic_received_at — 18시 이전 값(브레디스 08-28, 비엑스플랜트 08-24)');

    if (DRY) { console.log('\n--dry 라서 아무것도 바꾸지 않았습니다.'); return; }

    await client.query('BEGIN');

    for (const { id, name, changed } of plan) {
      const cols = Object.keys(changed);
      await client.query(
        `UPDATE exhibitors SET ${cols.map((c, i) => `"${c}" = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...cols.map((c) => changed[c].to)]);
      // 무엇을 무엇으로 되돌렸는지 남긴다 — 이 롤백이 틀렸을 때 되짚을 근거
      await audit(client, '18시 이후 변경 되돌림', name,
        cols.map((c) => `${c} ${changed[c].from || '(빈값)'} → ${changed[c].to || '(빈값)'}`).join(' / '));
    }

    if (lg[0]) {
      await client.query('DELETE FROM exhibitor_logs WHERE id = $1', [DEL_LOG]);
      await audit(client, '그래픽 피드백 삭제', '㈜비엑스플랜트', `되돌림 — 지운 내용: "${lg[0].body}"`);
    }
    for (const r of xc) {
      await client.query('DELETE FROM exhibitor_contacts WHERE id = $1', [r.id]);
      await audit(client, '전시 담당자 배정 해제', '㈜브레디스헬스케어', `되돌림 — ${r.id}`);
    }
    if (pt[0]) {
      await client.query('DELETE FROM participations WHERE id = $1', [DEL_PART]);
      await audit(client, '행사 참여 기록 삭제', pt[0].event_id, `되돌림 — 연락처 ${pt[0].contact_id}`);
    }
    if (ct[0]) {
      await client.query('DELETE FROM contacts WHERE id = $1', [DEL_CONTACT]);
      await audit(client, '연락처 삭제', ct[0].orgKo,
        `되돌림 — 지운 연락처: ${ct[0].nameKo} / ${ct[0].email1}`);
    }

    await client.query('COMMIT');
    console.log('\n되돌렸습니다. 무엇을 어떻게 바꿨는지는 로그 탭에 "롤백 스크립트"로 남아 있습니다.');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
