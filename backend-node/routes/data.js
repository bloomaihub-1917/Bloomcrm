const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

/* 기존 프론트(js/api.js)가 Google Sheets에 쓰던 것과 같은 모양의 프로토콜을
   그대로 받는다: { sheet, action, row|rows }. sheet별 테이블/컬럼 순서만
   여기서 매핑하고, 실제 저장은 Postgres에 진짜 트랜잭션/upsert로 한다.
   프론트 28개 호출 지점은 한 곳도 건드리지 않는다. */
const TABLES = {
  contacts: {
    table: 'contacts', pk: 'id', idPrefix: '',
    columns: ['id', 'nameKo', 'nameEn', 'orgKo', 'orgEn', 'titleKo', 'titleEn', 'deptKo', 'deptEn',
      'country', 'cat', 'lang', 'source', 'date', 'status', 'email1', 'email2', 'phone1', 'phone2',
      'beat', 'products', 'tags'],
  },
  events: {
    table: 'events', pk: 'id', idPrefix: '',
    columns: ['id', 'name', 'short', 'date_start', 'date_end', 'location', 'color'],
  },
  crm_targets: {
    table: 'crm_targets', pk: 'id', idPrefix: '',
    columns: ['id', 'name', 'nameEn', 'sector', 'hq', 'event', 'role', 'status', 'priority',
      'assignee', 'currentStage', 'lastActivity', 'log'],
  },
  activity_log: {
    table: 'activity_log', pk: 'id', idPrefix: '',
    columns: ['id', 'ts', 'email', 'name', 'type', 'action', 'target', 'detail'],
  },
  settings: {
    table: 'settings', pk: 'key', idPrefix: null, // settings는 key를 클라이언트가 직접 정함
    columns: ['key', 'value'],
  },
  sectors: {
    table: 'sectors', pk: 'id', idPrefix: null, // sectors도 id(slug)를 클라이언트가 직접 정함
    columns: ['id', 'name', 'parent', 'domain', 'canonical'],
  },
  companies: {
    table: 'companies', pk: 'key', idPrefix: null, // companies도 key를 클라이언트가 직접 정함
    columns: ['key', 'sector', 'hq', 'website', 'notes', 'catCode', 'country', 'abbr', 'source',
      'updatedAt', 'nameKo', 'nameEn'],
  },
  part_types: {
    table: 'part_types', pk: 'key', idPrefix: null,
    columns: ['key', 'label', 'cls'],
  },
};

let seq = 0;
function genId(prefix) {
  seq = (seq + 1) % 1000;
  return `${prefix}${Date.now()}_${seq}`;
}

const q = (col) => `"${col}"`;

// Postgres 바인드 파라미터 상한(65535)에 안전하게 걸치지 않도록 청크 단위로 나눠 처리한다.
const CHUNK_SIZE = 500;
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function rowToRecord(columns, row) {
  const rec = {};
  columns.forEach((col, i) => { rec[col] = row[i] === undefined ? null : row[i]; });
  return rec;
}

/* 한 건씩 왕복하면 수백 건짜리 업로드가 Vercel 함수 실행시간 제한(기본 10초)을
   넘겨 항상 실패한다 — 청크당 한 번의 다중 행 INSERT로 왕복 횟수를 확 줄인다.
   같은 청크 안에 pk가 중복되면 "ON CONFLICT DO UPDATE cannot affect row a
   second time" 에러가 나므로, 청크에 넣기 전에 pk 기준으로 먼저 중복 제거한다
   (뒤에 온 값이 이긴다 — 일반적인 upsert 기대 동작과 동일). */
async function bulkUpsert(client, table, pk, cols, records, { onConflict = 'update' } = {}) {
  const dedup = new Map();
  records.forEach((rec) => dedup.set(rec[pk], rec));
  const unique = [...dedup.values()];
  if (!unique.length) return;

  const colList = cols.map(q).join(', ');
  const updateSet = cols.filter((c) => c !== pk).map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ');
  const conflictClause = onConflict === 'nothing'
    ? `ON CONFLICT (${q(pk)}) DO NOTHING`
    : `ON CONFLICT (${q(pk)}) DO UPDATE SET ${updateSet}`;

  for (const part of chunk(unique, CHUNK_SIZE)) {
    const values = [];
    const groups = part.map((rec, ri) => {
      const placeholders = cols.map((c, ci) => {
        values.push(rec[c] ?? null);
        return `$${ri * cols.length + ci + 1}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await client.query(
      `INSERT INTO ${table} (${colList}) VALUES ${groups.join(', ')} ${conflictClause}`,
      values,
    );
  }
}

async function upsertOne(client, def, record, opts = {}) {
  if (def.idPrefix !== null && !record[def.pk]) record[def.pk] = genId(def.idPrefix);
  await bulkUpsert(client, def.table, def.pk, def.columns, [record], opts);
  return record[def.pk];
}

/* participations는 event_id/contact_id로 정규화하고, 원본 시트가 캐시해두던
   행사명/소속/성명/직함은 저장하지 않는다 — 읽을 때 JOIN으로 즉석 계산한다. */
async function readParticipations() {
  const { rows } = await pool.query(`
    SELECT p.id, p.event_id AS ev_id, COALESCE(e.name, '') AS "행사명",
           p.contact_id AS cid, COALESCE(c."orgKo", '') AS "소속",
           COALESCE(c."nameKo", '') AS "성명", COALESCE(c."titleKo", '') AS "직함",
           p.role AS type, p.note, p.matched
    FROM participations p
    LEFT JOIN events e ON e.id = p.event_id
    LEFT JOIN contacts c ON c.id = p.contact_id
    ORDER BY p.id
  `);
  return rows;
}

const PARTICIPATION_COLS = ['id', 'event_id', 'contact_id', 'role', 'note', 'matched'];

function participationFromRow(row) {
  // 헤더 순서: id, ev_id, 행사명, cid, 소속, 성명, 직함, type, note, matched
  return {
    id: row[0] || genId('P-'),
    event_id: row[1] || null,
    contact_id: row[3] || null,
    role: row[7] || null,
    note: row[8] || null,
    matched: row[9] || null,
  };
}

router.get('/', async (req, res) => {
  const { sheet } = req.query;
  if (sheet === 'participations') return res.json(await readParticipations());
  const def = TABLES[sheet];
  if (!def) return res.status(400).json({ ok: false, error: 'unknown sheet' });
  const { rows } = await pool.query(`SELECT * FROM ${def.table} ORDER BY ${q(def.pk)}`);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { sheet, action, row, rows } = req.body || {};
  if (sheet !== 'participations' && !TABLES[sheet]) {
    return res.status(400).json({ ok: false, error: 'unknown sheet' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (sheet === 'participations') {
      if (action === 'delete') {
        const ids = row || [];
        await client.query('DELETE FROM participations WHERE id = ANY($1::text[])', [ids]);
      } else if (action === 'replaceAll') {
        await client.query('DELETE FROM participations');
        await bulkUpsert(client, 'participations', 'id', PARTICIPATION_COLS, (rows || []).map(participationFromRow));
      } else if (action === 'batchAppend' || action === 'batchUpsert') {
        const onConflict = action === 'batchAppend' ? 'nothing' : 'update';
        await bulkUpsert(client, 'participations', 'id', PARTICIPATION_COLS, (rows || []).map(participationFromRow), { onConflict });
      } else {
        // upsert(단건) / append(폴백)
        await bulkUpsert(client, 'participations', 'id', PARTICIPATION_COLS, [participationFromRow(row || [])]);
      }
    } else {
      const def = TABLES[sheet];
      if (action === 'delete') {
        const ids = row || [];
        await client.query(`DELETE FROM ${def.table} WHERE ${q(def.pk)} = ANY($1::text[])`, [ids]);
      } else if (action === 'replaceAll') {
        await client.query(`DELETE FROM ${def.table}`);
        await bulkUpsert(client, def.table, def.pk, def.columns, (rows || []).map((r) => rowToRecord(def.columns, r)));
      } else if (action === 'batchAppend' || action === 'batchUpsert') {
        const onConflict = action === 'batchAppend' ? 'nothing' : 'update';
        const records = (rows || []).map((r) => {
          const rec = rowToRecord(def.columns, r);
          if (def.idPrefix !== null && !rec[def.pk]) rec[def.pk] = genId(def.idPrefix);
          return rec;
        });
        await bulkUpsert(client, def.table, def.pk, def.columns, records, { onConflict });
      } else {
        // upsert(단건) / append(폴백) — 둘 다 실제로는 upsert로 처리해도 안전함
        await upsertOne(client, def, rowToRecord(def.columns, row || []));
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`[data] ${sheet}/${action} 실패:`, e.message);
    res.status(500).json({ ok: false, error: '저장에 실패했어요' }); // 스택은 클라이언트에 노출하지 않음
  } finally {
    client.release();
  }
});

router.TABLES = TABLES; // scripts/migrate-from-sheets.js에서 컬럼 정의 재사용
module.exports = router;
