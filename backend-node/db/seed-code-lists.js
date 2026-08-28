/* ══════════════════════════════════════════════════════════════
   seed-code-lists.js — 코드에 박혀 있던 목록들을 code_lists로 옮긴다

   지금 화면에 나오는 값과 똑같이 넣는다. 옮기는 것 자체로 동작이 달라지면
   무엇이 바뀐 건지 알 수 없게 되므로, 값·순서·색을 그대로 가져온다.

   행사마다 달라지는 목록(부스 타입·등급·비품 분류)은 event_id를 붙여 2026 KIC
   전용으로 넣는다. 다음 행사는 이 행을 복제해 고치면 되고, 지난 행사 값은
   그대로 남아 옛 데이터가 무엇을 가리키는지 잃지 않는다.

   여러 번 돌려도 안전하다 — 같은 (list_key, event_id, code)면 덮어쓴다.
     node db/seed-code-lists.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const KIC = '2026 KIC';

/* [list_key, event_id, [ [code, label, cls?] ... ] ] */
const LISTS = [
  // ── 연락처 카테고리 (constants.js CL/CP/CAT_KEYS) ──
  ['contact_cat', '', [
    ['attendee',  '일반참가자',   'p-gray'],
    ['exhibitor', '전시참가기업', 'p-purple'],
    ['speaker',   '연사',         'p-blue'],
    ['sponsor',   '스폰서',       'p-green'],
    ['buyer',     '바이어',       'p-teal'],
    ['investor',  '투자자',       'p-amber'],
    ['bd',        'BD',           'p-teal'],
    ['press',     '기자',         'p-red'],
    ['vip',       'VIP',          'p-gold'],
    ['organizer', '주최',         'p-indigo'],
  ]],

  // ── 기업 종류 (state.js ORG_KINDS) ──
  ['org_kind', '', [
    ['전시참가기업', '전시 참가기업', 'p-blue'],
    ['잠재고객사',   '잠재 고객사',   'p-amber'],
    ['벤더시공사',   '벤더·시공사',   'p-teal'],
  ]],

  // ── 기업 상태 (state.js ORG_STATUSES) ──
  ['org_status', '', [
    ['활성',     '활성',     'p-green'],
    ['휴면',     '휴면',     'p-gray'],
    ['거래종료', '거래종료', 'p-gray'],
  ]],

  // ── 전시 담당자 역할 (exh-drawer.js C_ROLES) ──
  ['contact_role', '', [
    ['실무', '실무', 'p-gray'],
    ['정산', '정산', 'p-gray'],
    ['현장', '현장', 'p-gray'],
    ['기타', '기타', 'p-gray'],
  ]],

  // ── 금액 항목 분류 (exh-drawer.js CATS) ──
  ['item_cat', '', [
    ['booth',   '부스',   'p-gray'],
    ['equip',   '비품',   'p-gray'],
    ['graphic', '그래픽', 'p-gray'],
    ['etc',     '기타',   'p-gray'],
  ]],

  // ── 통화 (exh-drawer.js CURRENCIES) ──
  ['currency', '', [
    ['KRW', 'KRW', ''],
    ['USD', 'USD', ''],
  ]],

  // ── 문의·기록 채널 (exh-drawer.js CHANNELS) ──
  ['log_channel', '', [
    ['이메일', '이메일', ''], ['전화', '전화', ''], ['카톡', '카톡', ''],
    ['미팅', '미팅', ''], ['현장', '현장', ''],
  ]],

  // ── 문의·기록 분류 (exh-drawer.js LOG_CATS) ──
  ['log_cat', '', [
    ['부스', '부스', ''], ['비품', '비품', ''], ['그래픽', '그래픽', ''],
    ['정산', '정산', ''], ['현장', '현장', ''], ['기타', '기타', ''],
  ]],

  /* ── 아래 셋은 행사마다 달라진다 ── */

  // 부스 타입 (exh-tab.js BOOTH_TYPES)
  ['booth_type', KIC, [
    ['Self-Construction',   'Self-Construction',   ''],
    ['Block System A',      'Block System A',      ''],
    ['Block System B',      'Block System B',      ''],
    ['Block System C',      'Block System C',      ''],
    ['Lighting Booth',      'Lighting Booth',      ''],
    ['Octanium (Standard)', 'Octanium (Standard)', ''],
  ]],

  // 스폰서 등급 (exh-drawer.js GRADES + exh-tab.js GRADE_CLS)
  ['grade', KIC, [
    ['DIA',        'DIA',        'p-indigo'],
    ['GOLD',       'GOLD',       'p-gold'],
    ['SILVER',     'SILVER',     'p-gray'],
    ['BRONZE',     'BRONZE',     'p-amber'],
    ['Exhibitor',  'Exhibitor',  'p-gray'],
  ]],

  // 비품 카탈로그 분류 (exh-tab.js EQ_CATS)
  ['equip_cat', KIC, [
    ['의자',     '의자',     ''],
    ['테이블',   '테이블',   ''],
    ['진열대',   '진열대',   ''],
    ['가전제품', '가전제품', ''],
    ['기타비품', '기타비품', ''],
  ]],
];

const slug = (v) => String(v).replace(/[^A-Za-z0-9가-힣]/g, '').slice(0, 24);

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let n = 0;

    for (const [listKey, eventId, rows] of LISTS) {
      for (let i = 0; i < rows.length; i++) {
        const [code, label, cls] = rows[i];
        const rec = {
          id: `CD-${listKey}-${eventId ? slug(eventId) + '-' : ''}${slug(code)}`,
          list_key: listKey, event_id: eventId,
          code, label, cls: cls || '', note: '', active: '',
          sort_order: String((i + 1) * 10),
        };
        if (!DRY) {
          const cols = Object.keys(rec);
          await client.query(
            `INSERT INTO code_lists (${cols.map((c) => `"${c}"`).join(',')})
             VALUES (${cols.map((_, k) => `$${k + 1}`).join(',')})
             ON CONFLICT (id) DO UPDATE SET ${cols.filter((c) => c !== 'id')
               .map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}`,
            cols.map((c) => rec[c]));
        }
        n++;
      }
      console.log(`  ${listKey.padEnd(14)} ${eventId || '(공통)'} — ${rows.length}개`);
    }

    console.log(`\n총 ${n}개 항목 / ${LISTS.length}개 목록`);
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
