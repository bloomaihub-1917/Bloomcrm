/* ══════════════════════════════════════════════════════════════
   import-invoice-sent.js — 2026 KIC 인보이스 발송일 반영

   운영에서 정리해 온 발송일 목록을 exhibitor_invoices.sent_at에 넣는다.
   메모에 적힌 "9월말 납부 예정" 같은 입금 예정일도 due_date로 함께 넣는다.

   이름은 국문·영문이 섞여 있어 orgs(현재 이름 + 옛 이름)와 exhibitors의
   표시명까지 훑어 맞춘다. 못 찾은 이름은 조용히 넘기지 않고 끝에 모아 보여준다 —
   조용히 빠지면 발송한 줄 알고 넘어가게 된다.

   미리 보기: node db/import-invoice-sent.js --dry
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const YEAR = '2026';
const EVENT = '2026 KIC';

/* 운영 정리본 그대로. note는 사람이 남긴 맥락이라 지우지 않고 기록으로 남긴다. */
const SENT = [
  ['08-24', '츌립앤사이언스 씨알오(CRO)센터'],
  ['08-24', 'SCL Healthcare'],
  ['08-24', 'data4life'],
  ['08-24', 'medpace'],
  ['08-24', 'labcorp'],
  ['08-24', 'JNPMEDI'],
  ['08-24', 'C&R'],

  ['08-21', '클립스비엔씨'],
  ['08-21', '비엑스플랜트'],
  ['08-21', '뉴로핏'],
  ['08-21', '페니트리움바이오사이언스'],
  ['08-21', '나눔스페이스'],
  ['08-21', '심유'],

  ['08-20', '드림씨아이에스'],
  ['08-20', 'Oracle'],
  ['08-20', 'Aurigon Labs LTD'],
  ['08-20', '셀타스퀘어'],

  ['08-19', '넥스트로브', { note: '원화 인보이스 발송' }],

  ['08-18', 'ACCMED'],
  ['08-18', 'lsk global', { due: `${YEAR}-09-30`, note: '9월말 납부 예정' }],
  ['08-18', '메디라마'],

  ['08-13', 'SmartTech Clinical Research Center'],
  ['08-13', 'U2XLab Co., Ltd.'],
  ['08-13', 'Medidata', { note: '(주)레디두 8/19 결제함' }],
  ['08-13', 'Novotech', { due: `${YEAR}-09-17`, note: '블록 C 인보이스 발송 · 9/17 전까지 입금 예정' }],
  ['08-13', 'Certara', { note: '영문 인보이스 발송' }],

  ['08-12', 'Thermo Fisher Scientific', { due: `${YEAR}-08-28`, note: '8/12 정정 인보이스 발송 · 8/28 입금 예정' }],
  ['08-12', 'HungaroTrial CRO', { note: '원화 인보이스 발송' }],

  ['08-11', 'PSI CRO', { due: `${YEAR}-08-25`, note: '원화 인보이스 발송 · 8/25 14시 전시 대금 납부 예정' }],

  ['08-10', 'Parexel'],
  ['08-10', 'Bredis Healthcare Inc.'],

  ['08-04', 'Kakao Healthcare', { note: '독립부스 인보이스 발송 · 8/12 엑스렌탈에서 결제함' }],

  ['07-24', 'Median Technologies', { note: '7/24 인보이스 발송 · 8/12 엑스렌탈 신청함(미수금)' }],
];

/* 표기 흔들림을 흡수한다. 프론트 normalizeCompanyKey와 같은 규칙에
   공백·괄호·앰퍼샌드까지 더 눌러서 'C&R' ↔ '㈜씨엔알리서치' 같은 건은
   여기서 못 잡고 아래 ALIAS로 따로 잇는다. */
function norm(raw) {
  let s = String(raw || '').trim().toLowerCase();
  s = s.replace(/^(주식회사|㈜|\(주\))\s*/, '').replace(/\s*(주식회사|㈜|\(주\))$/, '');
  s = s.replace(/[\s,.]*\b(incorporated|inc|co\.?,?\s*(ltd|limited)|ltd|limited|co|llc|llp|corp(oration)?|gmbh|pte\.?\s*ltd|pty\.?\s*ltd|plc)\b\.?\s*$/i, '');
  return s.replace(/[^a-z0-9가-힣]/g, '');
}

/* 자동으로는 못 잇는 것만 손으로 적는다(약칭·국문↔영문 표기 차이). */
const ALIAS = {
  'cr': '씨엔알리서치',
  'lskglobal': '엘에스케이글로벌파마서비스',
  'data4life': '데이터포라이프',
  'accmed': '애크메드',
  'mediantechnologies': '메디안 메디컬 테크놀로지',
};

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const exhs = (await client.query(
      `SELECT e.id, e.company_name, e.org_id, o.name_ko, o.name_en, o.aliases
         FROM exhibitors e LEFT JOIN orgs o ON o.id = e.org_id
        WHERE e.event_id = $1`, [EVENT])).rows;

    // 한 기업이 여러 표기로 잡히도록 이름 색인을 넓게 만든다
    const index = new Map();
    exhs.forEach((e) => {
      [e.company_name, e.name_ko, e.name_en, ...String(e.aliases || '').split('\n')]
        .filter(Boolean)
        .forEach((n) => { const k = norm(n); if (k && !index.has(k)) index.set(k, e); });
    });

    const find = (name) => {
      const k = norm(name);
      if (index.has(k)) return index.get(k);
      if (ALIAS[k] && index.has(norm(ALIAS[k]))) return index.get(norm(ALIAS[k]));
      // 부분 일치 — 'medpace' 처럼 한쪽이 다른 쪽에 들어 있는 경우
      const hits = [...index.entries()].filter(([ik]) => ik.includes(k) || k.includes(ik));
      return hits.length === 1 ? hits[0][1] : null;
    };

    const applied = [];
    const missed = [];
    const noInvoice = [];
    const conflicts = [];   // 이미 적힌 날짜와 새 목록이 다른 건

    for (const [md, name, opt = {}] of SENT) {
      const e = find(name);
      if (!e) { missed.push(name); continue; }
      const sentAt = `${YEAR}-${md}`;

      // 무효 처리된 인보이스는 건드리지 않는다 — 취소·대체된 건이라 발송일이 의미 없다
      const invs = (await client.query(
        `SELECT id, title, amount, sent_at, due_date FROM exhibitor_invoices
          WHERE exhibitor_id = $1 AND COALESCE(status,'') <> 'void' ORDER BY id`, [e.id])).rows;
      if (!invs.length) { noInvoice.push(`${name} (${e.company_name})`); continue; }

      for (const v of invs) {
        /* 운영에서 정리해 온 목록을 정본으로 삼아 덮는다. 기존 값은 다른 세션의
           메일 트래킹에서 들어온 것이라 어느 쪽이 맞는지 여기서는 알 수 없다 —
           덮되 옛 날짜를 메모에 남겨 나중에 되짚거나 되돌릴 수 있게 한다. */
        const sets = [];
        const vals = [v.id];
        const cur = String(v.sent_at || '').trim();
        const clash = cur && cur !== sentAt;
        if (clash) conflicts.push({ name, co: e.company_name, inv: v.title || '(제목 없음)', 기존: cur, 목록: sentAt });

        if (cur !== sentAt) { vals.push(sentAt); sets.push(`sent_at = $${vals.length}`); }
        if (opt.due && String(v.due_date || '').trim() !== opt.due) { vals.push(opt.due); sets.push(`due_date = $${vals.length}`); }
        if (clash) {
          const keep = `이전 발송일 기록 ${cur} (메일 트래킹)`;
          const note = String(v.note || '').includes(keep) ? v.note : [v.note, keep].filter(Boolean).join(' / ');
          vals.push(note); sets.push(`note = $${vals.length}`);
        }
        if (sets.length && !DRY) {
          await client.query(`UPDATE exhibitor_invoices SET ${sets.join(', ')} WHERE id = $1`, vals);
        }
        applied.push({ name, co: e.company_name, inv: v.title || '(제목 없음)', sentAt,
          changed: !sets.length ? '이미 같음' : clash ? '덮어씀' : '새로 채움' });
      }

      // 사람이 남긴 맥락은 기록으로 남긴다(입금 예정·결제 대행 등)
      if (opt.note && !DRY) {
        const dup = (await client.query(
          `SELECT 1 FROM exhibitor_logs WHERE exhibitor_id = $1 AND body = $2`, [e.id, opt.note])).rows;
        if (!dup.length) {
          await client.query(
            `INSERT INTO exhibitor_logs (id, exhibitor_id, kind, ts, direction, channel, category,
               subject, body, status, author_email, author_name)
             VALUES ($1,$2,'note',$3,'out','email','정산',$4,$5,'done','','인보이스 발송 정리')`,
            [`XL-inv-${e.id}`, e.id, sentAt, '인보이스 발송', opt.note]);
        }
      }
    }

    console.log(`\n반영 대상 ${applied.length}건 / 기업 ${new Set(applied.map((a) => a.co)).size}곳`);
    const byChange = {};
    applied.forEach((a) => { byChange[a.changed] = (byChange[a.changed] || 0) + 1; });
    console.log('  변경 내역:', JSON.stringify(byChange));

    if (conflicts.length) {
      console.log(`
⚠ 이미 적힌 발송일과 다른 ${conflicts.length}건 — 어느 쪽이 맞는지 확인이 필요합니다:`);
      conflicts.forEach((c) => console.log(`    ${c.co} / ${c.inv}  기존 ${c.기존}  ←→  목록 ${c.목록}`));
    }
    if (noInvoice.length) {
      console.log(`\n⚠ 발행된 인보이스가 없어 발송일을 넣을 곳이 없는 기업 ${noInvoice.length}곳:`);
      noInvoice.forEach((n) => console.log('   ', n));
    }
    if (missed.length) {
      console.log(`\n⚠ 이름을 못 찾은 ${missed.length}건 — 확인이 필요합니다:`);
      missed.forEach((n) => console.log('   ', n));
    }

    if (DRY) {
      await client.query('ROLLBACK');
      console.log('\n--dry 라서 되돌렸습니다.');
    } else {
      await client.query('COMMIT');
      console.log('\n반영 완료.');
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
