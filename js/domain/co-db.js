/* ══════════════════════════════════════════════════════════════
   domain/co-db.js — 기업 화면용 뷰(CO_DB) 만들기 — 저장된 기업에 연락처·행사·전시 거래를 붙인다
   (modules/company-tab.js에서 옮겼다 — 탭 화면 파일에 기대지 않게)
═══════════════════════════════════════════════════════════════ */

import { CO_DB, EVENT_LIST, EXHIBITORS, ORGS, contacts, participations, findOrgByName, orgName } from '../state.js';
import { abbrOf, normalizeCompanyKey } from './org-names.js';
import { parseSectors } from './sectors.js';
import { exhibitorTradeFor } from '../features/exhibition/exh-calc.js';

/* ══════════════════════════════════════════
   buildCoDB — 화면용 기업 뷰를 만든다

   전에는 이 함수가 기업 목록 자체를 만들어냈다(contacts의 소속 문자열을
   정규화해 묶는 방식). 그래서 연락처가 없으면 기업이 사라지고, 이름을 고치면
   다른 회사가 됐다. 이제 기업은 ORGS에 저장된 레코드이고, 이 함수는 거기에
   연락처·행사 참가·전시 거래를 붙여 화면이 쓰기 좋은 모양으로 펼치기만 한다.

   연결은 org_id로 한다. 아직 org_id가 없는 옛 연락처는 이름으로 한 번 더
   맞춰본다 — 마이그레이션 전에 들어온 업로드가 화면에서 통째로 빠지지 않도록.
══════════════════════════════════════════ */
export function buildCoDB(){
  CO_DB.splice(0, CO_DB.length);
  if(!ORGS.length) return;

  /* 칸 하나 고칠 때마다 불린다 — 기업×참가×연락처를 겹쳐 돌면 데이터가 늘수록 화면이 멈췄다.
     한 번씩만 훑어 색인을 만든다: 이름 → 기업(같은 이름은 한 번만 찾는다), 연락처 → 참가, 행사 키 → 행사 */
  const nameHit = new Map();
  const orgByName = (nm) => {
    const k = String(nm || '');
    if(!nameHit.has(k)) nameHit.set(k, k ? findOrgByName(k, normalizeCompanyKey) : null);
    return nameHit.get(k);
  };
  const partsByContact = new Map(), partIdx = new Map();
  participations.forEach((p, i) => {
    partIdx.set(p, i);
    if(!partsByContact.has(p.contactId)) partsByContact.set(p.contactId, []);
    partsByContact.get(p.contactId).push(p);
  });
  const evByKey = new Map(EVENT_LIST.map(e => [e.key, e]));

  /* 연락처를 기업별로 모은다. org_id가 우선, 없으면 이름으로 폴백. */
  const byOrg = new Map();
  ORGS.forEach(o => byOrg.set(o.id, []));
  contacts.forEach(c => {
    let oid = c.org_id;
    if(!oid || !byOrg.has(oid)){
      const o = orgByName(c.orgKo || c.orgEn);
      oid = o ? o.id : null;
    }
    if(oid && byOrg.has(oid)) byOrg.get(oid).push(c);
  });

  /* 전시 참가도 같은 방식으로 */
  const exhByOrg = new Map();
  EXHIBITORS.forEach(x => {
    let oid = x.org_id;
    if(!oid || !byOrg.has(oid)){
      const o = orgByName(x.company_name);
      oid = o ? o.id : null;
    }
    if(!oid) return;
    if(!exhByOrg.has(oid)) exhByOrg.set(oid, []);
    exhByOrg.get(oid).push(x);
  });

  /* 독립부스를 맡아 지은 시공사 — 참가기업 행의 시공사 칸이 곧 그 회사의
     행사 이력이다. 연결(builder_org_id)이 우선, 없으면 이름으로 찾는다.
     «직접 설치»는 회사가 아니다. */
  const buildByOrg = new Map();
  EXHIBITORS.forEach(x => {
    const nm = String(x.builder || '').trim();
    let oid = x.builder_org_id;
    if(!oid || !byOrg.has(oid)){
      if(!nm || /^직접\s*설치$/.test(nm)) return;
      const o = orgByName(nm);
      oid = o ? o.id : null;
    }
    if(!oid) return;
    if(!buildByOrg.has(oid)) buildByOrg.set(oid, []);
    buildByOrg.get(oid).push(x);
  });

  ORGS.forEach(o => {
    const coContacts = byOrg.get(o.id) || [];
    const cById = new Map(coContacts.map(c => [c.id, c]));
    // 원래 순서(참가 표 순)를 지킨다 — 행사 이력 줄 순서가 바뀌지 않게
    const parts = [...cById.keys()].flatMap(id => partsByContact.get(id) || []).sort((a, b) => partIdx.get(a) - partIdx.get(b));

    // ── 행사별 참가 집계 ──
    const evMap = {};
    parts.forEach(p => {
      const ev = evByKey.get(p.eventId)
        || { key: p.eventId, short: p.eventId, name: p.eventId, color:'#9C9890', date:'' };
      if(!evMap[p.eventId]) evMap[p.eventId] = {
        key: p.eventId,
        name: ev.name || ev.key,
        short: ev.short || ev.key,
        year: (ev.date||'').slice(0,4) || String(new Date().getFullYear()),
        date: ev.date || '', loc: '', color: ev.color || '#9C9890',
        roles: [], people: [], note: '',
      };
      const role = p.role || '참가자';
      if(!evMap[p.eventId].roles.includes(role)) evMap[p.eventId].roles.push(role);
      const c = cById.get(p.contactId);
      const nm = c ? (c.nameKo || c.nameEn || '') : '';
      if(nm && !evMap[p.eventId].people.includes(nm)) evMap[p.eventId].people.push(nm);
    });

    // ── 전시 거래 — 행사별 부스·청구·입금 ──
    // 전시 탭에만 쌓여 있어 기업 화면에서 안 보이던 값들이다.
    const trade = (exhByOrg.get(o.id) || []).map(x => exhibitorTradeFor(x));
    trade.forEach(t => {
      // 전시로만 참가한 행사도 참가 이력에 나타나게 한다
      if(!evMap[t.eventId]){
        const ev = EVENT_LIST.find(e => e.key === t.eventId)
          || { key: t.eventId, short: t.eventId, name: t.eventId, color:'#9C9890', date:'' };
        evMap[t.eventId] = { key: t.eventId, name: ev.name || ev.key, short: ev.short || ev.key,
          year: (ev.date||'').slice(0,4), date: ev.date || '', loc: '', color: ev.color || '#9C9890',
          roles: ['전시참가기업'], people: [], note: '' };
      }
    });

    // ── 독립부스 시공 — 그 행사에 «시공사» 딱지, 어느 부스를 지었는지는 메모로 ──
    const built = {};
    (buildByOrg.get(o.id) || []).forEach(x => {
      if(!x.event_id) return;
      (built[x.event_id] = built[x.event_id] || []).push(x.company_name || '');
    });
    Object.entries(built).forEach(([evId, booths]) => {
      if(!evMap[evId]){
        const ev = EVENT_LIST.find(e => e.key === evId)
          || { key: evId, short: evId, name: evId, color:'#9C9890', date:'' };
        evMap[evId] = { key: evId, name: ev.name || ev.key, short: ev.short || ev.key,
          year: (ev.date||'').slice(0,4), date: ev.date || '', loc: '', color: ev.color || '#9C9890',
          roles: [], people: [], note: '' };
      }
      const e = evMap[evId];
      if(!e.roles.includes('시공사')) e.roles.push('시공사');
      const list = booths.filter(Boolean);
      if(list.length){
        const txt = `시공: ${list.slice(0, 5).join(', ')}${list.length > 5 ? ` 외 ${list.length - 5}곳` : ''} 부스`;
        e.note = e.note ? `${e.note} · ${txt}` : txt;
      }
    });

    const sectors = o.sectors ? parseSectors(o.sectors) : [];
    const name = orgName(o);

    /* 기업 칸(대표 전화·메일)이 비었으면 보여줄 담당자 연락처 — 퇴사자는 건너뛴다.
       복사해 저장하지 않는다(담당자가 바뀌면 옛 값이 대표번호로 굳는다). 화면이 «담당자»로 구분해 보여준다. */
    const fromContact = (f) => {
      const k = coContacts.find(x => !x.left_at && x[f]);
      return k ? { v: k[f], who: k.nameKo || k.nameEn || '' } : null;
    };

    CO_DB.push({
      // key는 화면 곳곳이 기업을 지목할 때 쓰는 값 — 이제 안정 id다.
      // 이름을 고쳐도 선택 상태나 링크가 끊기지 않는다.
      key:      o.id,
      org:      o,
      /* 국문·영문 중 한쪽만 있는 기업이 있다. 빈 칸을 다른 언어 이름으로 채우면
         상세 화면에 같은 이름이 두 번 찍히고, 국문명을 새로 적을 자리도 사라진다.
         비어 있으면 비워 두고, 보여줄 때만 있는 쪽으로 넘어간다(displayName). */
      nameKo:   o.name_ko || '',
      nameEn:   o.name_en || '',
      // 사명이 바뀌면 옛 이름으로 만들어 둔 약어가 남아 아바타가 엉뚱한 글자를
      // 보여준다(압타머사이언스 → 츌립앤사이언스인데 약어는 '압타'). 지금 이름의
      // 앞글자와 맞지 않으면 다시 만든다 — 직접 적어 넣은 약어는 대체로 맞으므로
      // 이름과 어긋날 때만 손댄다.
      abbr:     (o.abbr && name.startsWith(o.abbr[0])) ? o.abbr : abbrOf(name),
      aliases:  String(o.aliases || '').split('\n').filter(Boolean),
      kind:     o.kind || '',
      orgStatus: o.status || '활성',
      sector:   sectors[0] || '미분류',
      sectors,
      hq:       o.hq || coContacts.find(c => c.country)?.country || '',
      country:  o.country || '',
      website:  o.website || '',
      bizNo:    o.biz_no || '',
      notes:    o.notes || '',
      products: o.products || '',
      phone:    o.phone || '',
      email:    o.email || '',
      fbPhone:  o.phone ? null : fromContact('phone1'),
      fbEmail:  o.email ? null : fromContact('email1'),
      address:  o.address || '',
      intro:    o.intro || '',
      catCode:  o.cat_code || '',
      source:   o.source || '',
      updatedAt: o.updated_at || '',
      branches: [...new Set(coContacts.map(c => (c.orgKo || c.orgEn || '').trim()).filter(Boolean))],
      mainBranch: name,
      events:   Object.values(evMap),
      contacts: coContacts.map(c => ({
        id: c.id,
        /* 퇴사 두 칸을 같이 실어 둔다 — 이 투영은 원본 연락처를 다 담지 않아서
           여기 없으면 기업 화면에서 퇴사 여부를 알 길이 없다 */
        left_at: c.left_at || '', moved_to_id: c.moved_to_id || '',
        name: c.nameKo || c.nameEn || '',
        nameEn: c.nameEn || '',
        title: c.titleKo || c.titleEn || '',
        email: c.email1 || '',
        phone: c.phone1 || '',
        cats: [c.cat].filter(Boolean),
        events: participations.filter(p => p.contactId === c.id).map(p => p.eventId),
      })),
      trade,
    });
  });

  /* 정렬·대시보드 다시 그리기는 화면(company-tab.js) 몫이다 — 거기서 onCoDbBuilt로 건다 */
  builtListeners.forEach(fn => fn());
}

/* buildCoDB가 끝날 때마다 부를 화면 쪽 함수 */
const builtListeners = [];
export function onCoDbBuilt(fn){ builtListeners.push(fn); }
