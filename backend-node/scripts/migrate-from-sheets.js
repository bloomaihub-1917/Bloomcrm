/* 기존 Google Apps Script + Sheets 백엔드에서 데이터를 읽어와 Postgres로
   1회 이관한다. 실제 운영 데이터가 있는 구글 계정으로 로그인해야 하므로
   이 스크립트는 반드시 팀원(사용자)이 직접 실행한다.

   사용법:
     GS_URL="https://script.google.com/.../exec" \
     GS_EMAIL="cdakyo@13100m.net" GS_PASSWORD="..." \
     DATABASE_URL="postgres://..." \
       node scripts/migrate-from-sheets.js
*/
require('dotenv').config();
const pool = require('../db/pool');

const GS_URL = process.env.GS_URL;
const GS_EMAIL = process.env.GS_EMAIL;
const GS_PASSWORD = process.env.GS_PASSWORD;

if (!GS_URL || !GS_EMAIL || !GS_PASSWORD) {
  console.error('GS_URL / GS_EMAIL / GS_PASSWORD 환경변수가 모두 필요해요');
  process.exit(1);
}

const q = (col) => `"${col}"`;

// routes/data.js의 TABLES와 동일한 컬럼 정의(중복이지만 이 스크립트는 1회성이라 의존성 없이 독립 실행되게 둔다)
const TABLES = {
  contacts: { table: 'contacts', pk: 'id',
    columns: ['id', 'nameKo', 'nameEn', 'orgKo', 'orgEn', 'titleKo', 'titleEn', 'deptKo', 'deptEn',
      'country', 'cat', 'lang', 'source', 'date', 'status', 'email1', 'email2', 'phone1', 'phone2',
      'beat', 'products', 'tags'] },
  events: { table: 'events', pk: 'id', columns: ['id', 'name', 'short', 'date_start', 'date_end', 'location', 'color'] },
  crm_targets: { table: 'crm_targets', pk: 'id',
    columns: ['id', 'name', 'nameEn', 'sector', 'hq', 'event', 'role', 'status', 'priority',
      'assignee', 'currentStage', 'lastActivity', 'log'] },
  activity_log: { table: 'activity_log', pk: 'id', columns: ['id', 'ts', 'email', 'name', 'type', 'action', 'target', 'detail'] },
  settings: { table: 'settings', pk: 'key', columns: ['key', 'value'] },
  part_types: { table: 'part_types', pk: 'key', columns: ['key', 'label', 'cls'] },
  companies: { table: 'companies', pk: 'key',
    columns: ['key', 'sector', 'hq', 'website', 'notes', 'catCode', 'country', 'abbr', 'source',
      'updatedAt', 'nameKo', 'nameEn'] },
  // sectors는 자기참조(parent/canonical)라 2단계로 따로 처리한다
};

async function login() {
  const r = await fetch(GS_URL, {
    method: 'POST',
    body: JSON.stringify({ sheet: 'login', email: GS_EMAIL, password: GS_PASSWORD }),
  });
  const data = await r.json();
  if (!data.ok || !data.token) throw new Error('기존 백엔드 로그인 실패: ' + JSON.stringify(data));
  return data.token;
}

async function fetchSheet(sheet, token) {
  const url = `${GS_URL}?sheet=${sheet}&email=${encodeURIComponent(GS_EMAIL)}&auth=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const data = await r.json();
  if (data && data.error) throw new Error(`${sheet} 조회 실패: ${data.error}`);
  return Array.isArray(data) ? data : [];
}

async function insertGeneric(client, def, rows) {
  let n = 0;
  for (const r of rows) {
    const cols = def.columns;
    const values = cols.map((c) => r[c] ?? null);
    if (!values[0]) continue; // pk 없는 행은 스킵
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const updateSet = cols.filter((c) => c !== def.pk).map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ');
    await client.query(
      `INSERT INTO ${def.table} (${cols.map(q).join(', ')}) VALUES (${placeholders})
       ON CONFLICT (${q(def.pk)}) DO UPDATE SET ${updateSet}`,
      values,
    );
    n++;
  }
  return n;
}

async function insertSectors(client, rows) {
  // 1단계: parent/canonical 없이 먼저 다 넣는다 (자기참조 FK라 순서 문제 회피)
  for (const r of rows) {
    if (!r.id) continue;
    await client.query(
      `INSERT INTO sectors (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [r.id, r.name || r.id],
    );
  }
  // 2단계: parent/canonical/domain 채우기
  for (const r of rows) {
    if (!r.id) continue;
    await client.query(
      `UPDATE sectors SET parent = NULLIF($2,''), domain = NULLIF($3,''), canonical = NULLIF($4,'') WHERE id = $1`,
      [r.id, r.parent || '', r.domain || '', r.canonical || ''],
    );
  }
  return rows.length;
}

async function insertParticipations(client, rows) {
  let n = 0;
  for (const r of rows) {
    const id = r.id;
    if (!id) continue;
    await client.query(
      `INSERT INTO participations (id, event_id, contact_id, role, note, matched)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET
         event_id = EXCLUDED.event_id, contact_id = EXCLUDED.contact_id,
         role = EXCLUDED.role, note = EXCLUDED.note, matched = EXCLUDED.matched`,
      [id, r.ev_id || null, r.cid ? String(r.cid) : null, r.type || r.role || null, r.note || null, r.matched || null],
    );
    n++;
  }
  return n;
}

async function main() {
  console.log('기존 백엔드 로그인 중...');
  const token = await login();

  const client = await pool.connect();
  try {
    // FK 의존관계 순서: part_types/sectors/events/companies → contacts → participations/crm_targets → activity_log/settings
    const order = ['part_types', 'sectors', 'events', 'companies', 'contacts', 'participations', 'crm_targets', 'activity_log', 'settings'];
    for (const sheet of order) {
      console.log(`[${sheet}] 조회 중...`);
      const rows = await fetchSheet(sheet, token);
      let n;
      if (sheet === 'sectors') n = await insertSectors(client, rows);
      else if (sheet === 'participations') n = await insertParticipations(client, rows);
      else n = await insertGeneric(client, TABLES[sheet], rows);
      console.log(`[${sheet}] ${n}건 이관 완료 (원본 ${rows.length}건)`);
    }
  } finally {
    client.release();
    await pool.end();
  }
  console.log('이관 완료. db/seed.sql을 마저 실행해 도메인 분류를 채워주세요.');
}

main().catch((e) => { console.error(e); process.exit(1); });
