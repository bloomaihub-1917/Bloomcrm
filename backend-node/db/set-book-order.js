/* ══════════════════════════════════════════════════════════════
   set-book-order.js — 도록 순번을 받은 목록대로 다시 매긴다

   목록은 영문 사명 56줄이다. DB의 국문 사명과는 못 맞으니 orgs.name_en과
   별칭으로 맞춘다. 표기가 조금씩 달라(OPIS ↔ OPIS s.r.l., Almac ↔ Almac Group)
   글자 그대로는 안 맞는 줄이 여럿이다.

   그래서 세 단계로 좁힌다. 눌러서 정확히 같은 것 → 한쪽이 다른 쪽을 통째로
   품는 것(단 하나일 때만) → 못 맞춘 것은 그대로 두고 보고한다.

   포함으로 맞출 때 후보가 둘 이상이면 손대지 않는다. "Seoul National University
   Hospital"은 분당서울대에도 통째로 들어 있어서, 아무거나 고르면 두 병원의
   순번이 조용히 뒤바뀐다.

     node db/set-book-order.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');

const DRY = process.argv.includes('--dry');
const EVENT = '2026 KIC';

const WANT = `
1 SeltaSquare
2 ACM Global Laboratories
3 C&R Research Inc.
4 DreamCIS
5 Labcorp
6 OPIS s.r.l.
7 Novotech
8 Penetrium Bioscience
9 SCL Healthcare
10 ABC Bioscience Co., Ltd.
11 ACCMED TECHNOLOGY PTE. LTD.
12 Almac
13 Aurigon Labs LTD
14 Bredis Healthcare Inc.
15 BXPLANT
16 C&R SMO Inc.
17 Catalent
18 Certara
19 CHOOLIP&SCIENCES CRO CENTER Inc.
20 Clario
21 CLIPS BnC Co., Ltd.
22 CMIC Korea
23 DanteVision Inc.
24 Data4Life
25 Fortrea
26 Frontage Laboratories, Inc.
27 GCCL
28 HLB bioStep
29 HungaroTrial CRO
30 JNPMEDI Inc.
31 Kakao Healthcare Corp.
32 LSK Global PS
33 Median Technologies
34 Medidata
35 Mediplexus Co., Ltd.
36 MediRama
37 Medpace
38 MERIT CRO, Inc.
39 Nanum Space Co,.Ltd
40 NEUROPHET Inc.
41 Nextrove Korea LLC
42 Oracle Health and Life Sciences
43 Parexel
44 Perceptive Imaging
45 Precision for Medicine
46 PSI
47 Seoul National University Bundang Hospital Clinical Trials Center
48 Seoul National University Hospital Clinical Trials Center
49 SmartTech Clinical Research Center
50 Symyoo Co., Ltd
51 Syneos Health
52 Taimei Technology
53 Thermo Fisher Scientific
54 TI Image Pte. Ltd.
55 Trial Informatics Inc.
56 U2XLab Co., Ltd.
`.trim().split('\n').map((l) => {
  const m = l.trim().match(/^(\d+)\s+(.*)$/);
  return { no: m[1], name: m[2].trim() };
});

/* 이름이 달라 자동으로는 못 맞추는 줄. 짐작으로 붙이지 않고 여기 적어 둔다 —
   나중에 "왜 이게 저기에 붙었나"를 되짚을 수 있어야 한다.

   목록의 "Median Technologies"는 DB의 "Median Medical Technology"(메디안 메디컬
   테크놀로지)다. 서로 남은 줄이 이 하나씩뿐이고, 알파벳 자리(33번, Medidata 앞)도
   맞는다. 다만 실제로 이름이 다른 회사이므로 orgs의 영문명은 건드리지 않는다. */
const MANUAL = { 'Median Technologies': '메디안 메디컬 테크놀로지' };

/* 법인격과 기호를 떼고 눌러서 견준다 — Co., Ltd.·Inc.·LLC가 붙고 안 붙고로
   갈리는 줄이 대부분이다. */
const squash = (v) => String(v || '').toLowerCase()
  .replace(/\b(co|inc|corp|corporation|ltd|llc|limited|gmbh|s\.?r\.?l|pte|plc|group)\b/g, '')
  .replace(/[^a-z0-9]/g, '');

(async () => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT e.id, e.company_name, e.book_order, o.name_en, o.name_ko, o.aliases
        FROM exhibitors e LEFT JOIN orgs o ON o.id = e.org_id
       WHERE e.event_id = $1 AND COALESCE(e.status,'') <> '취소'`, [EVENT]);

    // 한 기업이 가진 모든 이름 표기를 후보로 둔다
    const keysOf = (r) => [r.name_en, r.name_ko, r.company_name,
      ...String(r.aliases || '').split(/\r?\n/)]
      .map(squash).filter((v) => v.length > 2);

    const used = new Set();
    const hits = [], misses = [], ambiguous = [];

    for (const w of WANT) {
      const k = squash(w.name);
      const free = rows.filter((r) => !used.has(r.id));

      if (MANUAL[w.name]) {
        const m = free.find((r) => r.company_name === MANUAL[w.name]);
        if (m) { used.add(m.id); hits.push({ w, r: m, manual: true }); continue; }
      }

      let cand = free.filter((r) => keysOf(r).includes(k));
      if (!cand.length) {
        // 한쪽이 다른 쪽을 통째로 품는 경우 — 가장 많이 겹치는 하나만 인정한다
        cand = free.filter((r) => keysOf(r).some((n) => n.includes(k) || k.includes(n)));
      }
      if (cand.length === 1) { used.add(cand[0].id); hits.push({ w, r: cand[0] }); }
      else if (cand.length > 1) ambiguous.push({ w, cand });
      else misses.push(w);
    }

    console.log(`목록 ${WANT.length}줄 · 참가기업 ${rows.length}곳\n`);
    console.log('■ 짝지음 — 번호가 바뀌는 곳만');
    hits.filter(({ w, r }) => String(r.book_order || '') !== w.no)
      .forEach(({ w, r, manual }) => console.log(
        `   ${String(r.book_order || '-').padStart(3)} → ${w.no.padStart(3)}  ${r.company_name.padEnd(26)} ${w.name}${
          manual ? '   ← 이름이 달라 손으로 짝지은 줄' : ''}`));
    const same = hits.filter(({ w, r }) => String(r.book_order || '') === w.no).length;
    console.log(`   (그대로인 곳 ${same})`);

    if (ambiguous.length) {
      console.log(`\n■ 후보가 여럿이라 손대지 않음 ${ambiguous.length}줄`);
      ambiguous.forEach(({ w, cand }) => console.log(
        `   ${w.no} ${w.name}  → ${cand.map((c) => c.company_name).join(' / ')}`));
    }
    if (misses.length) {
      console.log(`\n■ 못 맞춘 목록 ${misses.length}줄`);
      misses.forEach((w) => console.log(`   ${w.no} ${w.name}`));
    }
    const left = rows.filter((r) => !used.has(r.id));
    if (left.length) {
      console.log(`\n■ 목록에 없는 참가기업 ${left.length}곳 — 번호를 건드리지 않습니다`);
      left.forEach((r) => console.log(`   ${r.company_name} (${r.name_en || '-'})`));
    }

    if (ambiguous.length || misses.length || left.length) {
      console.log('\n다 맞추지 못했습니다 — 확인 후 다시 돌려주세요.');
      return;
    }
    if (DRY) { console.log('\n--dry 라서 아무것도 바꾸지 않았습니다.'); return; }

    await client.query('BEGIN');
    let seq = 0, n = 0;
    for (const { w, r } of hits) {
      if (String(r.book_order || '') === w.no) continue;
      await client.query('UPDATE exhibitors SET book_order = $2 WHERE id = $1', [r.id, w.no]);
      n++;
    }
    await client.query(
      `INSERT INTO activity_log (id, ts, email, name, type, action, target, detail)
       VALUES ($1,$2,'','정리 스크립트','edit','도록 순서 일괄 변경',$3,$4)`,
      [`L-${Date.now()}-${seq++}`, new Date().toISOString(), EVENT,
        `받은 목록대로 <b>${n}곳</b>의 도록 순번을 1~${WANT.length}번으로 다시 매김`]);
    await client.query('COMMIT');
    console.log(`\n반영 완료 — ${n}곳`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
})();
