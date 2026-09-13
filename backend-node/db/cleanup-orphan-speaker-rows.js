/* ══════════════════════════════════════════════════════════════
   cleanup-orphan-speaker-rows.js — 주인 없는 연사 자료를 치운다

   연사를 지울 때 연사 줄만 지우고 연락 상대·주고받은 기록은 두고 있었다.
   그래서 없는 사람을 가리킨 채 DB에 남은 줄이 생겼다. 화면에서는 안 보이니
   아무도 모르고, 계좌·여권을 열어 본 기록까지 주인 없이 떠돈다.

   코드는 고쳤다(conf-tab.js의 removeConfSpeaker가 함께 지운다). 이 스크립트는
   그전에 남은 줄을 치운다. 지우기 전에 무엇을 지우는지 찍어 둔다 — 되살릴 일이
   생기면 그 출력이 마지막 자료다.

     node db/cleanup-orphan-speaker-rows.js
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const ORPHAN = (t) => `SELECT * FROM ${t} a
  WHERE COALESCE(a.speaker_id,'') <> ''
    AND NOT EXISTS (SELECT 1 FROM speakers b WHERE b.id = a.speaker_id)`;

(async () => {
  try {
    let total = 0;
    for (const t of ['speaker_contacts', 'speaker_logs']) {
      const { rows } = await pool.query(ORPHAN(t));
      if (!rows.length) { console.log(`${t}: 주인 없는 줄 없음`); continue; }
      console.log(`\n${t}: ${rows.length}건 — 지우기 전 내용`);
      rows.forEach(r => console.log('   ' + JSON.stringify(r)));
      await pool.query(`DELETE FROM ${t} WHERE id = ANY($1::text[])`, [rows.map(r => r.id)]);
      total += rows.length;
    }
    console.log(`\n치운 줄 ${total}건. 앞으로는 연사를 지울 때 함께 지워집니다.`);
  } catch (e) {
    console.error('실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end?.();
  }
})();
