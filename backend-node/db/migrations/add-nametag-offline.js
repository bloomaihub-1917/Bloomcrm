/* 네임택 끊김 대비 (2026-11-10) — 기기(태블릿·휴대폰·노트북)에 먼저 남기고, 연결되면 한꺼번에 보낸다
     nametag_prints.synced_at     서버가 받은 시각. printed_at은 «인쇄를 지시한 시각»(기기 시각)이라,
     nametag_checkins.synced_at   늦게 도착한 기록을 다른 데스크가 /live에서 놓치지 않게 받은 시각으로 묻는다
   기록 id는 기기가 만든다 — 같은 기록이 두 번 와도(응답이 끊겨 다시 보낸 것) 서버는 한 번만 받는다.
   정의는 schema.sql 끝과 같다. 여러 번 돌려도 안전하다.
     node db/migrations/add-nametag-offline.js */
require('dotenv').config();
const pool = require('../pool');
(async () => {
  for (const [t, from] of [['nametag_prints', 'printed_at'], ['nametag_checkins', 'checked_at']]) {
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS synced_at TEXT`);
    await pool.query(`UPDATE ${t} SET synced_at = ${from} WHERE synced_at IS NULL`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${t}_synced_idx ON ${t} (event_id, synced_at)`);
  }
  console.log('✓ nametag 끊김 대비(prints·checkins.synced_at)');
  await pool.end();
})();
