/* 나라장터 행사대행 발주기관 담당자 → 행사 바이어 + 우리 용역 영업 대상 (2026-11-23)

   발주기관 담당자는 두 자리에 동시에 선다 —
     ① 행사(예: 이벤트코리아)에 오는 바이어: 참가 기업을 만나 컨설팅·미팅을 한다
     ② 우리가 용역을 따내려는 상대: 그 기관의 행사대행 공고가 우리 제안서 행사다
   그래서 한 번 올리면
     1) 사업·계약 담당자 → Master DB (contactUpserter — 같은 사람 찾기·16자리 id·기업DB 연결)
     2) 같은 사람 → 고른 행사의 «바이어» 참가
     3) 기관마다 영업 파이프라인(crm_targets) 한 줄 — 공고(사업명·금액·게시일·공고번호)를 기록으로
     4) 차수를 고르면 그 차수 명단(round_members)에 기관을 넣고, 담당자를 그 행사 영업 DB(sales_targets)로 켠다
   를 한 번에 한다. 이미 있는 참가·파이프라인 줄은 건드리지 않고, 파이프라인에는 새 공고만 기록에 더한다.

   rows: «검증 공고» 시트를 배열 그대로(머리글 줄 포함). 머리글 이름으로 칸을 찾는다. */
const { contactUpserter } = require('../db/contact-upsert');

const TITLES = /(과장|주무관|대리|팀장|주임|사원|차장|부장|선임|책임|실장|연구원)$/;
const t = (v) => String(v ?? '').trim();
const split = (v) => t(v).split(/\s*\/\s*/).map(t);
const ymd = (v) => {
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const s = t(v).replace(/[./]/g, '-');
  return /^\d{4}-\d{1,2}-\d{1,2}/.test(s) ? s.slice(0, 10) : '';
};

/* 머리글 → 칸 번호. 사업 담당과 계약·공고 담당이 같은 이름(«담당자» 등)을 쓰니 앞뒤를 가려 찾는다 */
const COLS = {
  org: ['영업 기준 기관', '기관', '수요기관'], 사업명: ['사업명'], 유형: ['유형'], 게시일: ['나라장터 게시일', '게시일', '공고일'],
  금액: ['사업금액 (원)', '사업금액', '금액'], 금액기준: ['금액 기준'], 공고번호: ['나라장터 공고번호', '공고번호'], url: ['공고문·과업 근거 URL'],
  dept: ['사업 담당 부서'], name: ['사업 담당자'], tel: ['사업 전화'], mail: ['사업 이메일'],
  dept2: ['계약·공고 부서'], name2: ['계약·공고 담당자'], tel2: ['계약·공고 전화'], mail2: ['계약·공고 이메일'],
};
const norm = (s) => t(s).replace(/\s/g, '');

function findHeader(rows){
  const hi = rows.findIndex((r) => (r || []).some((c) => norm(c) === norm('사업명')));
  if (hi < 0) return null;
  const head = rows[hi].map(norm);
  const col = {};
  for (const [k, names] of Object.entries(COLS)) col[k] = head.findIndex((h) => names.some((n) => h === norm(n)));
  if (col.org < 0 || (col.name < 0 && col.mail < 0)) return null;
  return { hi, col };
}

async function importG2bBuyers(client, { rows, eventId, roundId = '', role = '바이어', source = '나라장터 공고', by = '' }){
  const ev = (await client.query('SELECT id, name FROM events WHERE id = $1', [eventId])).rows[0];
  if (!ev) throw new Error(`행사(${eventId})를 찾지 못했어요`);
  const h = findHeader(rows || []);
  if (!h) throw new Error('«영업 기준 기관»·«사업명»·«사업 담당자» 머리글이 있는 시트가 아니에요');
  const at = (r, k) => (h.col[k] >= 0 ? r[h.col[k]] : '');
  const data = rows.slice(h.hi + 1).filter((r) => t(at(r, 'org')));

  const put = await contactUpserter(client, { source });
  const people = new Map();
  const skipped = [];
  const byOrg = new Map();

  for (const r of data) {
    const org = t(at(r, 'org'));
    const deal = { 사업명: t(at(r, '사업명')), 유형: t(at(r, '유형')), 게시일: ymd(at(r, '게시일')), 금액: Number(String(at(r, '금액')).replace(/[^0-9.]/g, '')) || 0,
      금액기준: t(at(r, '금액기준')), 공고번호: t(at(r, '공고번호')), url: t(at(r, 'url')) };
    if (!byOrg.has(org)) byOrg.set(org, []);
    byOrg.get(org).push(deal);

    for (const [sfx, kind] of [['', '사업'], ['2', '계약·공고']]) {
      const dept = t(at(r, 'dept' + sfx)), names = split(at(r, 'name' + sfx)), tels = split(at(r, 'tel' + sfx)), mails = split(at(r, 'mail' + sfx));
      const n = Math.max(names.length, tels.length, mails.length);
      for (let i = 0; i < n; i++) {
        const full = names[i] || '', name = full.replace(TITLES, '').trim(), email = mails[i] || '', phone = tels[i] || '';
        if (!name && !email) { if (phone || dept) skipped.push({ org, kind, dept, phone }); continue; }
        const { id, created } = await put({ nameKo: name, orgKo: org, deptKo: dept, titleKo: (full.match(TITLES) || [''])[0], email1: email, phone1: phone });
        if (!id) continue;
        const p = people.get(id) || { id, name: name || email, org, kinds: [], created };
        if (!p.orgId) p.orgId = (await client.query('SELECT org_id FROM contacts WHERE id=$1', [id])).rows[0]?.org_id || '';
        if (!p.kinds.includes(kind)) p.kinds.push(kind);
        people.set(id, p);
      }
    }
  }

  // 2) 행사 바이어
  let partNew = 0, partHad = 0;
  const base = Date.now() * 1000;
  for (const p of people.values()) {
    const ex = await client.query('SELECT 1 FROM participations WHERE event_id=$1 AND contact_id=$2 AND role=$3', [ev.id, p.id, role]);
    if (ex.rowCount) { partHad++; p.part = '있음'; continue; }
    await client.query('INSERT INTO participations (id, event_id, contact_id, role, note) VALUES ($1,$2,$3,$4,$5)',
      ['P-' + (base + partNew), ev.id, p.id, role, `나라장터 발주기관 ${p.kinds.join('·')} 담당`]);
    partNew++; p.part = '새로';
  }

  // 3) 영업 파이프라인 — 기관 한 줄, 공고는 기록(log)에
  let crmNew = 0, crmAdded = 0, seq = 0;
  const orgs = [];
  for (const [org, deals] of byOrg) {
    deals.sort((a, b) => b.게시일.localeCompare(a.게시일));
    const note = (d) => `[나라장터] ${d.사업명} · ${d.유형 || '유형 미상'} · ${d.금액 ? (d.금액 / 1e8).toFixed(2) + '억' + (d.금액기준 ? `(${d.금액기준})` : '') : '금액 미상'}${d.공고번호 ? ' · ' + d.공고번호 : ''}${d.url ? '\n' + d.url : ''}`;
    const ex = (await client.query('SELECT id, log, "lastActivity" FROM crm_targets WHERE name=$1 AND event=$2', [org, ev.name])).rows[0];
    if (ex) {
      let log = []; try { log = JSON.parse(ex.log || '[]'); } catch {}
      const fresh = deals.filter((d) => !log.some((l) => String(l.text || '').includes(d.공고번호 || d.사업명)));
      if (fresh.length) {
        log = [...fresh.map((d) => ({ type: '메모', date: d.게시일, color: '#9C9890', text: note(d) })), ...log];
        const last = [ex.lastActivity, deals[0].게시일].filter(Boolean).sort().pop();
        await client.query('UPDATE crm_targets SET log=$2, "lastActivity"=$3 WHERE id=$1', [ex.id, JSON.stringify(log), last]);
        crmAdded += fresh.length;
      }
      orgs.push({ org, deals: deals.length, state: fresh.length ? `공고 ${fresh.length}건 더함` : '이미 있음' });
      continue;
    }
    const log = deals.map((d) => ({ type: '메모', date: d.게시일, color: '#9C9890', text: note(d) }));
    await client.query(`INSERT INTO crm_targets (id,name,"nameEn",sector,hq,event,role,status,priority,assignee,"currentStage","lastActivity",log)
      VALUES ($1,$2,'',$3,'',$4,$5,'미접촉','mid','','1',$6,$7)`,
      [String(Date.now() + seq++), org, '공공 행사대행 발주', ev.name, role, deals[0].게시일, JSON.stringify(log)]);
    crmNew++;
    orgs.push({ org, deals: deals.length, state: '새로' });
  }

  // 4) 차수 명단 — 고른 차수에 기관을 넣고(이미 있으면 건너뜀), 담당자는 이 행사 영업 DB로 켠다(화면 «명단 채우기»와 같다)
  let round = null, rmNew = 0, rmHad = 0, stNew = 0;
  const noOrg = [];
  if (roundId) {
    round = (await client.query('SELECT id, name, event_id FROM contact_rounds WHERE id=$1', [roundId])).rows[0];
    if (!round || round.event_id !== ev.id) throw new Error('고른 차수가 이 행사의 차수가 아니에요');
    const kst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    const have = new Set((await client.query('SELECT org_id FROM round_members WHERE round_id=$1', [round.id])).rows.map((x) => x.org_id));
    const stamp = Date.now();
    for (const org of byOrg.keys()) {
      const orgId = [...people.values()].find((p) => p.org === org && p.orgId)?.orgId;
      if (!orgId) { noOrg.push(org); continue; }
      if (have.has(orgId)) { rmHad++; continue; }
      await client.query(`INSERT INTO round_members (id, round_id, org_id, org_name, source, caution, hold_until, call_hours, next_at, goal_at, closed_at, closed_reason, created_at)
        VALUES ($1,$2,$3,$4,$5,'','','','','','','',$6)`, [`RM-${stamp}_${rmNew}`, round.id, orgId, org, source, kst]);
      have.add(orgId); rmNew++;
    }
    const on = new Set((await client.query('SELECT contact_id FROM sales_targets WHERE event_id=$1', [ev.id])).rows.map((x) => String(x.contact_id)));
    for (const p of people.values()) {
      if (on.has(String(p.id))) continue;
      await client.query('INSERT INTO sales_targets (id, event_id, contact_id, created_at, created_by) VALUES ($1,$2,$3,$4,$5)',
        [`ST-${stamp}_${stNew}`, ev.id, String(p.id), kst.slice(0, 10), by]);
      stNew++;
    }
  }

  const s = put.stat;
  return {
    event: ev, deals: data.length, orgCount: byOrg.size,
    people: [...people.values()], orgs, skipped,
    contacts: { created: s.created, attached: s.attached, by: s.by, filled: s.filled, suspects: s.suspects },
    orgsCreated: (put.orgsCreated || []).map((o) => o.name_ko || o.name || String(o)),
    participations: { created: partNew, existed: partHad },
    pipeline: { created: crmNew, dealsAdded: crmAdded },
    round: round ? { name: round.name, added: rmNew, existed: rmHad, salesOn: stNew, noContact: noOrg } : null,
  };
}

module.exports = { importG2bBuyers };
