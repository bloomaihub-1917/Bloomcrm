/* ══════════════════════════════════════════
   참가 이력 정리 — 연사·전시 담당자를 마스터DB 연락처와 잇고 참여 기록을 채운다
     node db/fix-participation-history.js           시험 실행(바꾸지 않고 무엇을 할지만 보인다)
     node db/fix-participation-history.js --apply   실제로 고친다(한 트랜잭션)

   2026-10-23 점검: 컨퍼런스 엑셀 올리기가 연사를 연락처 없이(contact_id '') 만들어서
   2026 KIC 연사 137명 등이 마스터DB에 없었다 — 다음 행사 섭외 때 못 찾고, 연락처 화면의
   참여 행사·주고받은 메일에도 안 보였다.

   1. 연사 — contact_id가 빈 연사:
      연락 상대(speaker_contacts) 메일이 마스터DB에 있으면 그 사람에 잇고,
      없으면 연사 정보(이름·소속·직함·국가·메일)로 연락처를 새로 만든다(id는 contact-ids.js).
      메일도 없는 연사는 만들지 않는다 — 이름만으로는 같은 사람인지 알 수 없다.
      잇거나 만든 연락처는 speakers.contact_id와 그 연사의 «연사 본인» speaker_contacts.contact_id에 적는다.
   2. 전시 담당자 — contact_id가 빈 exhibitor_contacts 중 메일이 마스터DB에 있으면 잇는다.
   3. 참여 기록 — 연락처가 이어진 연사·전시 담당자인데 그 행사 participations가 없으면 만든다
      (연사는 «연사», VIP 역할만 맡았으면 «VIP» / 전시 담당자는 «전시참가기업»).
   같은 사람·같은 행사 줄이 이미 있으면 건드리지 않는다.
══════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');
const { contactIdAllocator } = require('./contact-ids');

const APPLY = process.argv.includes('--apply');
const low = (v) => String(v || '').trim().toLowerCase();
const isKo = (v) => /[가-힣]/.test(String(v || ''));

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const nextContactId = await contactIdAllocator(client);
    const q = async (s, p) => (await client.query(s, p)).rows;

    const contacts = await q(`SELECT id, email1, email2 FROM contacts`);
    const byMail = new Map();
    contacts.forEach(k => [k.email1, k.email2].forEach(e => { if (low(e) && !byMail.has(low(e))) byMail.set(low(e), String(k.id)); }));
    const parts = await q(`SELECT event_id, contact_id FROM participations`);
    const hasPart = new Set(parts.map(p => `${p.event_id}|${p.contact_id}`));
    const today = new Date().toISOString().slice(0, 10);
    const stat = { linked: 0, created: 0, noMail: 0, exhLinked: 0, parts: 0 };
    const newParts = [];
    const addPart = (ev, cid, role, note) => {
      const k = `${ev}|${cid}`;
      if (hasPart.has(k)) return;
      hasPart.add(k);
      newParts.push([ev, cid, role, note]);
    };

    /* 1. 연사 */
    const sps = await q(`SELECT * FROM speakers`);
    const scs = await q(`SELECT * FROM speaker_contacts`);
    const roles = await q(`SELECT speaker_id, role FROM session_speakers`);
    for (const sp of sps) {
      const mine = scs.filter(x => x.speaker_id === sp.id);
      let cid = String(sp.contact_id || '');
      if (!cid) {
        const mailRow = mine.find(x => low(x.email) && x.kind === '연사 본인') || mine.find(x => low(x.email));
        if (!mailRow) { stat.noMail++; continue; }
        const mail = low(mailRow.email);
        cid = byMail.get(mail) || '';
        if (cid) stat.linked++;
        else {
          cid = nextContactId();
          const name = sp.name_snapshot || sp.name_en || mailRow.name || '';
          if (APPLY) await client.query(
            `INSERT INTO contacts (id, "nameKo", "nameEn", "orgKo", "orgEn", "titleKo", "titleEn", "deptKo", "deptEn",
               country, cat, lang, source, date, status, email1, email2, phone1, phone2, beat, products, tags, org_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'','',$8,'speaker',$9,$10,$11,'new',$12,'',$13,'','','','','')`,
            [cid, isKo(name) ? name : '', sp.name_en || (isKo(name) ? '' : name),
              sp.org_ko || '', sp.org_en || '', sp.title_ko || '', sp.title_en || '',
              sp.residence_country || sp.nationality || '', isKo(name) ? 'KO' : 'EN',
              `${sp.event_id} 연사 (참가 이력 정리)`, today, mailRow.email.trim(), mailRow.phone || '']);
          byMail.set(mail, cid);
          stat.created++;
        }
        if (APPLY) {
          await client.query(`UPDATE speakers SET contact_id=$1 WHERE id=$2`, [cid, sp.id]);
          await client.query(`UPDATE speaker_contacts SET contact_id=$1 WHERE speaker_id=$2 AND lower(trim(email))=$3 AND coalesce(contact_id,'')=''`,
            [cid, sp.id, mail]);
        }
      }
      if (sp.status === '취소') continue;
      const rs = roles.filter(r => r.speaker_id === sp.id).map(r => r.role);
      addPart(sp.event_id, cid, rs.length && rs.every(r => r === 'VIP') ? 'VIP' : '연사', '연사 화면에서 이음');
    }

    /* 2·3. 전시 담당자 */
    const exc = await q(`SELECT x.id, x.contact_id, x.email, e.event_id FROM exhibitor_contacts x JOIN exhibitors e ON e.id=x.exhibitor_id`);
    for (const x of exc) {
      let cid = String(x.contact_id || '');
      if (!cid && low(x.email) && byMail.get(low(x.email))) {
        cid = byMail.get(low(x.email));
        if (APPLY) await client.query(`UPDATE exhibitor_contacts SET contact_id=$1 WHERE id=$2`, [cid, x.id]);
        stat.exhLinked++;
      }
      if (cid) addPart(x.event_id, cid, '전시참가기업', '전시 담당자에서 이음');
    }

    let seq = 0;
    for (const [ev, cid, role, note] of newParts) {
      if (APPLY) await client.query(
        `INSERT INTO participations (id, event_id, contact_id, role, note) VALUES ($1,$2,$3,$4,$5)`,
        [`P-${Date.now()}-fix${++seq}`, ev, cid, role, note]);
      stat.parts++;
    }
    const byEv = {};
    newParts.forEach(([ev, , role]) => { byEv[`${ev} · ${role}`] = (byEv[`${ev} · ${role}`] || 0) + 1; });

    console.log(APPLY ? '── 고쳤어요 ──' : '── 시험 실행 (바꾸지 않음) ──');
    console.log(`연사 → 기존 연락처에 이음 ${stat.linked}명 · 연락처 새로 만듦 ${stat.created}명 · 메일 없어 건너뜀 ${stat.noMail}명`);
    console.log(`전시 담당자 → 기존 연락처에 이음 ${stat.exhLinked}명`);
    console.log(`참여 기록 새로 ${stat.parts}줄`, byEv);
    if (APPLY) {
      await client.query(
        `INSERT INTO activity_log (id, ts, email, name, type, action, target, detail, link) VALUES ($1,$2,'','스크립트','edit','참가 이력 정리','participations',$3,'')`,
        [String(Date.now()), new Date().toISOString(),
          `연사 이음 ${stat.linked} · 새 연락처 ${stat.created} · 전시 담당자 이음 ${stat.exhLinked} · 참여 기록 ${stat.parts}줄`]);
      const long = await q(`SELECT count(*) n FROM contacts WHERE length(id::text) > 16`);
      if (Number(long[0].n)) throw new Error(`16자리 넘는 id ${long[0].n}개 — 되돌립니다`);
      await client.query('COMMIT');
    } else await client.query('ROLLBACK');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('실패 — 아무것도 바꾸지 않았어요:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
