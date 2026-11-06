/* BIO KOREA 2026(BIO-002) 연사를 마스터DB 연락처로 한꺼번에 잇는다.

   컨퍼런스 업로드로 들어온 168명이 연락처와 하나도 연결되지 않았다.
   화면의 «마스터DB 등록»(sp-dr-basic.js)을 사람마다 누르는 것과 같은 일을 한다.

   1) 해외 연사는 업로드 때 국문 성명 칸에 영문 이름이 그대로 들어갔다.
      국문 성명(name_snapshot)이 영문 성명과 같으면 국문 칸을 비운다.
      영문 칸이 비어 있고 국문 칸에 한글이 없으면 영문 칸으로 옮긴다.
      (화면은 국문이 비면 영문으로 보인다 — conf-common.js speakerName)
   2) 연결할 연락처 찾기: 연사 본인 메일 → 같은 이름+같은 소속. 둘 다 없으면 새로 만든다.
      같은 이름만 있고 소속이 다르면 새로 만들고 목록에 따로 보여준다(동명이인 확인용).
   3) 연사에 contact_id, 연사 본인 연락처 줄(speaker_contacts)에도 contact_id.
      새 연락처의 메일·전화는 연사 본인 연락처 줄에서 가져온다.
   4) 행사 참가 기록(participations)을 만든다 — 맡은 자리가 모두 VIP면 VIP, 아니면 연사.
      (conf-common.js syncPartRole과 같은 규칙)

   실행: node db/oneoff/link-bk2026-speakers.js          (시험 — 바꿀 것만 보여줌)
         node db/oneoff/link-bk2026-speakers.js --apply
*/
require('dotenv').config();
const pool = require('../pool');
const { contactIdAllocator } = require('../contact-ids');

const EV = 'BIO-002';
const apply = process.argv.includes('--apply');
const t = (v) => String(v ?? '').trim();
const low = (v) => t(v).toLowerCase().replace(/\s+/g, ' ');
const hasKo = (v) => /[가-힣]/.test(v || '');
// 기관 이름이 바뀐 것 — 안전성평가연구소 → 국가독성과학연구소(KIT → KITOX)
const SAME_ORG = [['국가독성과학연구소', '안전성평가연구소']];
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

(async () => {
  const client = await pool.connect();
  try {
    const sps = (await client.query(`SELECT * FROM speakers WHERE event_id=$1 ORDER BY id`, [EV])).rows;
    const scs = (await client.query(
      `SELECT * FROM speaker_contacts WHERE speaker_id = ANY($1)`, [sps.map(s => s.id)])).rows;
    const asg = (await client.query(`SELECT speaker_id, role FROM session_speakers WHERE event_id=$1`, [EV])).rows;
    const cons = (await client.query(`SELECT id,"nameKo","nameEn","orgKo","orgEn",email1,email2 FROM contacts`)).rows;
    const parts = (await client.query(
      `SELECT contact_id, role FROM participations WHERE event_id=$1`, [EV])).rows;

    const byMail = new Map();
    cons.forEach(c => [c.email1, c.email2].forEach(e => { if (t(e)) byMail.set(low(e), c); }));
    const byName = new Map();
    cons.forEach(c => [c.nameKo, c.nameEn].forEach(n => {
      if (!t(n)) return;
      const k = low(n);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(c);
    }));

    const nameFix = [], linked = [], created = [], homonym = [], newParts = [];
    const plan = [];
    for (const sp of sps) {
      // 1) 이름 정리
      let ko = t(sp.name_snapshot), en = t(sp.name_en);
      if (ko && en && low(ko) === low(en)) { nameFix.push(`${ko}  (국문 비움)`); ko = ''; }
      else if (ko && !en && !hasKo(ko)) { nameFix.push(`${ko}  (국문 → 영문 칸으로)`); en = ko; ko = ''; }

      // 2) 연락처 찾기
      const self = scs.filter(c => c.speaker_id === sp.id && /본인/.test(c.kind || ''));
      const mails = self.map(c => t(c.email)).filter(Boolean);
      const phone = self.map(c => t(c.phone)).find(Boolean) || '';
      let con = null, how = '';
      if (t(sp.contact_id)) { con = { id: sp.contact_id }; how = '이미 연결'; }
      for (const m of mails) if (!con && byMail.has(low(m))) { con = byMail.get(low(m)); how = '메일 일치'; }
      if (!con) {
        const orgs = [low(sp.org_ko), low(sp.org_en)].filter(Boolean);
        const same = [ko, en].filter(Boolean).flatMap(n => byName.get(low(n)) || []);
        const alias = (o) => [o, ...SAME_ORG.filter(g => g.map(low).includes(o)).flat().map(low)];
        const hit = same.find(c => orgs.flatMap(alias).some(o => o === low(c.orgKo) || o === low(c.orgEn)));
        if (hit) { con = hit; how = '이름+소속 일치'; }
        else if (same.length) homonym.push(`${ko || en} — ${t(sp.org_ko) || t(sp.org_en)}  ↔  기존: ${same.map(c => `${c.nameKo || c.nameEn}(${c.orgKo || c.orgEn || '소속 없음'})`).join(', ')}`);
      }
      let newCon = null;
      if (!con) {
        newCon = {
          nameKo: ko, nameEn: en, orgKo: t(sp.org_ko), orgEn: t(sp.org_en),
          titleKo: t(sp.title_ko), titleEn: t(sp.title_en),
          country: t(sp.nationality) || t(sp.residence_country), lang: ko ? 'KO' : 'EN',
          email1: mails[0] || '', email2: mails[1] || '', phone1: phone,
        };
        created.push(`${ko || en} — ${newCon.orgKo || newCon.orgEn}${newCon.email1 ? ' · ' + newCon.email1 : ''}`);
      } else if (how !== '이미 연결') linked.push(`${ko || en} → ${con.nameKo || con.nameEn} (${how})`);

      // 4) 참가 역할
      const roles = asg.filter(a => a.speaker_id === sp.id).map(a => a.role);
      const role = roles.length && roles.every(r => r === 'VIP') ? 'VIP' : '연사';
      plan.push({ sp, ko, en, con, newCon, role, selfIds: self.map(c => c.id) });
    }

    console.log(`BIO KOREA 2026 연사 ${sps.length}명`);
    console.log(`\n■ 이름 정리 ${nameFix.length}명`); nameFix.forEach(x => console.log('  ' + x));
    console.log(`\n■ 기존 연락처에 연결 ${linked.length}명`); linked.forEach(x => console.log('  ' + x));
    console.log(`\n■ 새 연락처 만듦 ${created.length}명`); created.forEach(x => console.log('  ' + x));
    console.log(`\n■ 같은 이름이 있지만 소속이 달라 새로 만듦 — 같은 사람인지 확인 ${homonym.length}명`);
    homonym.forEach(x => console.log('  ' + x));

    if (!apply) { console.log('\n시험 실행입니다. 적용하려면 --apply'); return; }

    await client.query('BEGIN');
    const nextId = await contactIdAllocator(client);
    let pSeq = 0;
    for (const p of plan) {
      let cid = p.con && String(p.con.id);
      if (p.newCon) {
        cid = nextId();
        const c = p.newCon;
        await client.query(
          `INSERT INTO contacts (id,"nameKo","nameEn","orgKo","orgEn","titleKo","titleEn","deptKo","deptEn",
             country,cat,lang,source,date,status,email1,email2,phone1,phone2,beat,products,tags,org_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'','',$8,'speaker',$9,$10,$11,'new',$12,$13,$14,'','','','','')`,
          [cid, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.country, c.lang,
           `${EV} 연사`, today, c.email1, c.email2, c.phone1]);
      }
      await client.query(
        `UPDATE speakers SET name_snapshot=$2, name_en=$3, contact_id=$4, updated_at=$5 WHERE id=$1`,
        [p.sp.id, p.ko, p.en, cid, new Date().toISOString()]);
      if (p.selfIds.length)
        await client.query(`UPDATE speaker_contacts SET contact_id=$2 WHERE id = ANY($1) AND coalesce(contact_id,'')=''`,
          [p.selfIds, cid]);
      const has = parts.some(x => String(x.contact_id) === cid && (x.role === '연사' || x.role === 'VIP'));
      if (!has) {
        await client.query(
          `INSERT INTO participations (id,event_id,contact_id,role,note,matched) VALUES ($1,$2,$3,$4,'',$5)`,
          [`P-${Date.now()}-${pSeq++}`, EV, cid, p.role, '✅ 연사 일괄 연결']);
        parts.push({ contact_id: cid, role: p.role });
        newParts.push(cid);
      }
    }
    await client.query('COMMIT');
    const long = await client.query(`SELECT count(*) n FROM contacts WHERE length(id) > 16`);
    console.log(`\n적용했어요 — 참가 기록 ${newParts.length}줄 추가. 16자리 넘는 연락처 id: ${long.rows[0].n}개`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
})();
