/* ══════════════════════════════════════════════════════════════
   nt-people.js — 네임택 명단: 이 행사에서 네임택을 받을 사람

   새로 만드는 데이터는 없다. 세 곳에서 모은다.
     연사        speakers         — 소속·직함·영문명이 «발표 당시» 값으로 굳어 있어 그대로 찍는다
     부스 인원   exhibitor_contacts — 취소한 참가기업은 뺀다
     참가자      participations   — 연락처(contacts)의 현재 값
   한 사람이 둘 이상에 있으면(연사 겸 참가자) 한 줄로 접는다. 앞의 것이 이긴다(연사 > 부스 > 참가자) —
   연사는 소속을 굳혀 두었고, 부스 인원은 기업명이 참가기업 기준이라 그쪽이 더 맞다.

   person_key: 연락처가 있으면 c<연락처 id>, 없으면 s<연사 id>·x<부스 인원 id>.
   서버(routes/nametag.js)가 이 키로 «이미 받았는지»를 센다.
═══════════════════════════════════════════════════════════════ */
import { contacts, participations, speakersForEvent, exhibitorsForEvent, EXH_CONTACTS, getOrgById, contactOrgEn } from '../../state.js';

const HANGUL = /[가-힣]/;
const s = (v) => String(v ?? '').trim();
export const SOURCE_LABEL = { speaker: '연사', exh: '부스', part: '참가자', walk_in: '현장 신규' };

/* 현장 신규 — 마스터DB에 없는 사람이라 발급 기록(nametag_prints)에서 모은다. 키는 w<첫 발급 id>.
   찍은 값은 «안 됨»이 아닌 마지막 발급 것(다 안 됨이면 마지막 것). 이메일·전화는 nametag_people */
export function walkInPeople(prints, peopleRows){
  const m = new Map();
  [...prints].sort((a, b) => String(a.printed_at).localeCompare(String(b.printed_at))).forEach(p => {
    const k = s(p.person_key);
    if(!k.startsWith('w')) return;
    const cur = m.get(k);
    if(cur && p.voided_at && !cur.voided) return;
    m.set(k, { voided: !!p.voided_at, p });
  });
  return [...m.entries()].map(([key, { p }]) => {
    const pp = peopleRows.get(key) || {};
    const ko = HANGUL.test(p.name);
    return { key, source: 'walk_in', ref_id: '', contact_id: '', email: s(pp.email), phone: s(pp.phone),
      nameKo: ko ? s(p.name) : '', nameEn: ko ? '' : s(p.name), orgKo: s(p.company), orgEn: s(p.company),
      titleKo: s(p.job_title), titleEn: s(p.job_title), badgeKo: s(p.badge), badgeEn: s(p.badge), confirmed: true, walkIn: true };
  });
}

export function ntPeople(evKey){
  const byId = new Map(contacts.map(c => [s(c.id), c]));
  const out = new Map();
  const put = (p) => { if(!out.has(p.key)) out.set(p.key, p); };

  speakersForEvent(evKey).filter(sp => sp.hidden !== 'yes' && sp.status !== '취소').forEach(sp => {
    const cid = s(sp.contact_id);
    const c = cid ? byId.get(cid) : null;
    put({ email: s(c?.email1) || s(sp.email),
      key: cid ? `c${cid}` : `s${sp.id}`, source: 'speaker', ref_id: s(sp.id), contact_id: cid,
      nameKo: s(sp.name_snapshot), nameEn: s(sp.name_en), orgKo: s(sp.org_ko), orgEn: s(sp.org_en),
      titleKo: s(sp.title_ko), titleEn: s(sp.title_en), badgeKo: '연사', badgeEn: 'Speaker',
      confirmed: sp.status === '확정' || !!sp.confirmed_at,
    });
  });

  const exhs = new Map(exhibitorsForEvent(evKey).filter(x => x.status !== '취소').map(x => [x.id, x]));
  EXH_CONTACTS.filter(ec => exhs.has(ec.exhibitor_id)).forEach(ec => {
    const x = exhs.get(ec.exhibitor_id);
    const o = x.org_id ? getOrgById(x.org_id) : null;
    const cid = s(ec.contact_id);
    const c = cid ? byId.get(cid) : null;
    const name = s(ec.name) || s(c?.nameKo) || s(c?.nameEn);
    if(!name) return;
    put({ email: s(ec.email) || s(c?.email1),
      key: cid ? `c${cid}` : `x${ec.id}`, source: 'exh', ref_id: s(ec.id), contact_id: cid,
      nameKo: HANGUL.test(name) ? name : s(c?.nameKo), nameEn: s(c?.nameEn) || (HANGUL.test(name) ? '' : name),
      orgKo: s(o?.name_ko) || s(x.company_name), orgEn: s(o?.name_en) || s(x.book_name_en),
      titleKo: s(c?.titleKo), titleEn: s(c?.titleEn),
      badgeKo: '전시', badgeEn: 'Exhibitor', confirmed: true,
    });
  });

  /* 참가자 — 한 사람이 두 역할로 두 줄이면 역할을 모아 한 줄로(event-tab.js evPeople과 같은 규칙) */
  const parts = new Map();
  participations.filter(p => p.eventId === evKey && p.contactId != null).forEach(p => {
    const cid = s(p.contactId);
    const m = parts.get(cid) || { roles: new Set(), confirmed: false, partId: s(p.id) };
    if(p.role) m.roles.add(s(p.role));
    if(p.confirmedAt) m.confirmed = true;
    parts.set(cid, m);
  });
  parts.forEach((m, cid) => {
    const c = byId.get(cid);
    if(!c) return;
    const role = [...m.roles][0] || '';
    put({ email: s(c.email1),
      key: `c${cid}`, source: 'part', ref_id: m.partId, contact_id: cid,
      nameKo: s(c.nameKo), nameEn: s(c.nameEn), orgKo: s(c.orgKo), orgEn: s(contactOrgEn(c)),
      titleKo: s(c.titleKo), titleEn: s(c.titleEn), badgeKo: role, badgeEn: role,
      confirmed: m.confirmed,
    });
  });

  return [...out.values()].filter(p => p.nameKo || p.nameEn)
    .sort((a, b) => (a.orgKo || a.orgEn).localeCompare(b.orgKo || b.orgEn, 'ko') || (a.nameKo || a.nameEn).localeCompare(b.nameKo || b.nameEn, 'ko'));
}

/* 이 사람을 무슨 말로 찍을지. auto는 한글 이름이 있으면 국문 */
export const langOf = (p, lang) => lang === 'ko' || lang === 'en' ? lang : (HANGUL.test(p.nameKo) ? 'ko' : 'en');

/* 찍을 값 — 고른 말이 비어 있으면 다른 말로 채운다 */
export function cardOf(p, lang){
  const ko = langOf(p, lang) === 'ko';
  const pick = (k, e) => ko ? (k || e) : (e || k);
  return {
    name: pick(p.nameKo, p.nameEn), company: pick(p.orgKo, p.orgEn),
    job_title: pick(p.titleKo, p.titleEn), badge: pick(p.badgeKo, p.badgeEn), lang: ko ? 'ko' : 'en',
  };
}
