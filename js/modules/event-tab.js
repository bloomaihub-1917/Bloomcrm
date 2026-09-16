/* ══════════════════════════════════════════════════════════════
   event-tab.js — 행사 DB (행사 탭)

   왜 만들었나
   ----------
   행사에 다녀오면 명단이 남는다. 그 명단은 마스터DB에 연락처로 쌓이고,
   기업DB에서 기업으로 묶이고, 전시 탭에서 참가기업으로 관리된다. 그런데
   정작 "행사" 자체를 주인공으로 놓고 보는 화면이 없었다.

   그래서 두 가지가 끊겨 있었다.
     1) 행사가 끝나고 한두 해 지나면 그 행사가 무엇이었는지 아무도 모른다.
        events에는 이름·기간·장소뿐이라 성격을 적어 둘 칸이 없었다.
     2) 행사에서 만난 사람이 곧 다음 행사의 영업 대상인데, 명단에서 타겟으로
        넘기는 길이 없었다. CRM 타겟 추가는 기업명을 처음부터 검색해야 했다.

   이 탭이 그 둘을 잇는다 — 행사를 고르면 개요를 적고, 그 행사에 온 사람과
   기업을 보고, 기업을 골라 CRM 타겟이나 전시 참가기업으로 그 자리에서 보낸다.

   데이터는 새로 만들지 않는다. 참여자는 participations, 기업은 그 연락처의
   소속을 묶은 것이고, 새로 저장하는 건 events의 개요 칸뿐이다.
═══════════════════════════════════════════════════════════════ */

import {
  EVENT_LIST, contacts, participations, targets, DOMAINS,
  EXHIBITORS, exhibitorsForEvent, PART_TYPES, evParts, evPartDone, getOrgById, CO_DB,
} from '../state.js';
import { RP, EVENT_PARTS, partStateOf } from '../constants.js';
import { td, escapeHtml, escAttr, countryName, isMobile } from '../utils.js';
import { saveEventToSheet, batchCreateExhibitors, postToSheet } from '../api.js';
import { saveTargetToSheet, buildEvFil, renderCrm, updBadges } from './crm-tab.js';
import { normalizeCompanyKey } from './company-tab.js';
import { domainOfSector, domainName, findSectorByName } from './settings-tab.js';
/* changed는 이 파일의 지역 변수 이름과 겹친다 — 별칭으로 들여온다 */
import { trackAction, changed as changeMeta } from './audit-tab.js';

/* ── 모듈 상태 ──
   고른 행사와 보고 있는 화면. 다른 탭이 알 필요가 없어 state.js로 올리지 않는다. */
let evdbEvent = '';
let evdbView = 'profile';
let evdbRoleFil = '';      // 참여자·기업 화면의 역할 필터
let evdbQuery = '';        // 검색어
const evdbPicked = new Set();   // 기업 화면에서 고른 기업 (company_key)
/* 참여자 화면 — 확정/타겟 거르개와 고른 사람 */
let evdbStatFil = '';           // '' | 'confirmed' | 'target'
const evdbPickedPeople = new Set();   // 고른 사람의 cid
/* CRM 타겟 화면 — 창고에서 끌어올 기업 */
let evdbTgtFil = 'new';         // 'new'(아직 타겟 아님) | 'on'(이미 타겟)
const evdbPickedTgt = new Set();      // 고른 기업의 org id

const VIEWS = [['profile', '개요'], ['people', '참여자'], ['orgs', '기업'], ['target', 'CRM 타겟']];

/* ══════════════════════════════════════════
   집계 — participations를 행사 기준으로 다시 세운다

   연락처를 매번 찾아 붙이므로 한 번 만들어 두고 화면 세 개가 나눠 쓴다.
   행사가 바뀔 때만 다시 만든다(참여자가 수천 명이면 매 렌더가 아깝다).
══════════════════════════════════════════ */
let _cache = { key: null, people: [], recs: 0, noOrg: [] };

/* 사람 단위로 센다. participations는 "참여 기록"이라 한 사람이 한 행사에 두 역할로
   들어오면(연사 겸 스폰서) 줄이 둘이다 — 그걸 그대로 세면 두 명이 된다.
   참여자는 몇 명이 왔느냐지 기록이 몇 줄이냐가 아니므로 contactId로 접는다.
   역할은 잃지 않고 모아 둔다(한 사람이 여러 역할일 수 있다).

   contactId가 비어 있는 옛 기록은 접을 근거가 없으니 각자 한 명으로 둔다 —
   전부 한 명으로 뭉치는 것보다 낫다. */
function evPeople(evKey){
  if(_cache.key === evKey) return _cache.people;
  const byId = new Map(contacts.map(c => [c.id, c]));
  const map = new Map();
  let recs = 0;

  participations.filter(p => p.eventId === evKey).forEach(p => {
    recs++;
    const key = p.contactId != null ? `c${p.contactId}` : `p${p.id}`;
    if(!map.has(key)){
      const c = byId.get(p.contactId) || {};
      const org = (c.orgKo || c.orgEn || '').trim();
      map.set(key, {
        cid: c.id, roles: new Set(), recs: 0,
        name: c.nameKo || c.nameEn || p.contact || '',
        nameEn: c.nameEn || '', title: c.titleKo || c.titleEn || '',
        org, orgEn: c.orgEn || '', orgKey: normalizeCompanyKey(org || c.orgEn),
        country: c.country || '', email: c.email1 || c.email2 || '',
        sector: c.beat || '',
        phone: c.phone1 || c.phone2 || '', dept: c.deptKo || c.deptEn || '',
        /* 확정은 참여 기록에 붙는다. 한 사람이 두 역할이면 줄도 둘이라,
           한 줄이라도 확정이면 그 사람은 온 것으로 본다. */
        partIds: [], confirmedAt: '',
      });
    }
    const m = map.get(key);
    m.recs++;
    m.partIds.push(p.id);
    if(p.confirmedAt && !m.confirmedAt) m.confirmedAt = p.confirmedAt;
    if(p.role) m.roles.add(p.role);
  });

  const people = [...map.values()];
  _cache = { key: evKey, people, recs, noOrg: people.filter(r => !r.orgKey) };
  return people;
}
/* 참여 기록 줄 수 — 사람 수와 다르면 화면에 그 사실을 적는다 */
const evRecCount = (evKey) => { evPeople(evKey); return _cache.recs; };
/* 소속이 비어 기업으로 묶지 못한 사람 — 세는 데서 빠지므로 어디 갔는지 밝힌다 */
const evNoOrg = (evKey) => { evPeople(evKey); return _cache.noOrg; };

/* 참여 기록이 바뀌면(업로드·수정) 다음 렌더에서 다시 센다 */
export function invalidateEvRows(){ _cache = { key: null, people: [], recs: 0, noOrg: [] }; }

/* 참여 기업으로 접기 — 한 기업에서 몇 명이 오든 기업은 하나다.
   기업명 표기가 흔들려도("(주)가온솔루션" / "가온솔루션 주식회사") 같은 곳으로
   보도록 normalizeCompanyKey로 맞춘 뒤 묶는다. */
function evOrgs(evKey){
  const map = new Map();
  evPeople(evKey).forEach(r => {
    if(!r.orgKey) return;   // 소속이 비면 어느 기업인지 알 수 없다 — evNoOrg가 따로 챙긴다
    if(!map.has(r.orgKey)) map.set(r.orgKey, {
      key: r.orgKey, name: r.org, nameEn: r.orgEn,
      country: r.country, sector: r.sector, people: [], roles: new Set(),
    });
    const o = map.get(r.orgKey);
    o.people.push(r);
    r.roles.forEach(v => o.roles.add(v));
    if(!o.nameEn && r.orgEn) o.nameEn = r.orgEn;
    if(!o.country && r.country) o.country = r.country;
    if(!o.sector && r.sector) o.sector = r.sector;
  });
  /* 참가기업(exhibitors)도 이 목록의 원천이다.
     전에는 연락처(participations)만 봤다. 그래서 담당자를 아직 등록하지 않은
     기업은 이 화면에 아예 없었다 — 지난 행사 명부처럼 "누가 왔었다"만 아는
     기업은 통째로 비어 보인다(2025 KIC 48곳이 0곳으로 나왔다).
     행사에서 만난 기업을 골라 타겟으로 보내는 화면이라, 담당자를 모르는 기업이
     빠지면 이 화면을 만든 이유가 없어진다. */
  exhibitorsForEvent(evKey).forEach(x => {
    const o = x.org_id ? getOrgById(x.org_id) : null;
    const name   = (o && o.name_ko) || x.company_name || (o && o.name_en) || '';
    const nameEn = (o && o.name_en) || '';
    const key = x.company_key || normalizeCompanyKey(name || nameEn);
    if(!key) return;
    if(!map.has(key)) map.set(key, {
      key, name: name || nameEn, nameEn,
      country: (o && o.country) || '', sector: (o && o.sectors) || '',
      people: [], roles: new Set(),
    });
    const g = map.get(key);
    g.roles.add('전시참가기업');
    g.exhibitor = true;
    if(!g.nameEn && nameEn) g.nameEn = nameEn;
    if(!g.country && o && o.country) g.country = o.country;
  });

  return [...map.values()].sort((a, b) => b.people.length - a.people.length
    || a.name.localeCompare(b.name));
}

/* 이미 보낸 곳인지 — 같은 기업을 두 번 보내면 CRM에 중복 카드가 생긴다.
   기업명 정규화 키로 맞춰 본다(표기가 흔들려도 같은 회사로 본다). */
const targetKeys = () => new Set(targets.map(t => normalizeCompanyKey(t.name)).filter(Boolean));
const exhKeysOf = (evKey) => new Set(exhibitorsForEvent(evKey)
  .map(x => x.company_key || normalizeCompanyKey(x.company_name)).filter(Boolean));

/* ══════════════════════════════════════════
   사이드바 — 행사 목록
══════════════════════════════════════════ */
export function buildEvDbList(){
  const el = document.getElementById('evdb-ev-list');
  if(!el) return;

  if(!EVENT_LIST.length){
    el.innerHTML = '<div style="font-size:11px;color:var(--i4);padding:8px 4px">등록된 행사가 없어요.</div>';
    return;
  }
  // 최근 행사부터 — 지금 챙길 일이 있는 건 대개 최근 것이다
  const sorted = [...EVENT_LIST].sort((a, b) =>
    String(b.date_start || b.date || '').localeCompare(String(a.date_start || a.date || '')));

  if(!evdbEvent || !EVENT_LIST.some(e => e.key === evdbEvent)) evdbEvent = sorted[0].key;

  el.innerHTML = sorted.map(e => {
    const n = participations.filter(p => p.eventId === e.key).length;
    return `<button class="nr${e.key === evdbEvent ? ' on' : ''}" onclick="setEvDbEvent('${escAttr(e.key)}')">
      <span style="width:8px;height:8px;border-radius:50%;background:${escAttr(e.color || '#9C9890')};flex-shrink:0"></span>
      ${escapeHtml(e.short || e.name || e.key)}
      <span class="nbg">${n}</span></button>`;
  }).join('');
}

export function setEvDbEvent(key){
  evdbEvent = key;
  evdbRoleFil = ''; evdbQuery = '';
  evdbPicked.clear();
  buildEvDbList();
  renderEvDb();
}

export function setEvDbView(v){ evdbView = v; evdbPicked.clear(); renderEvDb(); }
export function setEvDbRole(v){ evdbRoleFil = v; evdbPicked.clear(); renderEvDb(); }
export function setEvDbStat(v){ evdbStatFil = v; evdbPickedPeople.clear(); renderEvDb(); }

/* 검색은 글자를 칠 때마다 다시 그리는데, 통째로 갈면 입력칸이 포커스를 잃는다.
   목록만 갈아 끼우고 입력칸은 그대로 둔다(설정 탭 비품 검색과 같은 방식). */
export function setEvDbQuery(v){
  evdbQuery = v;
  const box = document.getElementById('evdb-rows');
  if(!box){ renderEvDb(); return; }
  box.innerHTML = evdbView === 'orgs' ? orgsRowsHtml() : peopleRowsHtml();
}

/* ══════════════════════════════════════════
   렌더
══════════════════════════════════════════ */
export function renderEvDb(){
  const el = document.getElementById('evdb-body');
  if(!el) return;
  const ev = EVENT_LIST.find(e => e.key === evdbEvent);

  const ttl = document.getElementById('evdb-ttl');
  if(ttl) ttl.innerHTML = `행사 DB <span class="tb-s">${ev
    ? escapeHtml(ev.short || ev.name) + ' · 참여자와 기업'
    : '행사를 골라주세요'}</span>`;
  const mttl = document.getElementById('mob-evdb-ttl');
  if(mttl) mttl.textContent = ev ? (ev.short || ev.name || '행사 DB') : '행사 DB';

  if(!ev){
    el.innerHTML = `<div class="empty" style="padding:60px 20px;text-align:center">
      <div style="font-size:30px;margin-bottom:10px">🗓</div>
      <div style="font-weight:700;margin-bottom:6px">등록된 행사가 없어요</div>
      <div style="font-size:12px;color:var(--i4)">설정 › 행사 관리에서 행사를 먼저 만들어주세요</div></div>`;
    return;
  }

  const seg = `<div class="tbar" style="padding:10px 16px 0">
    <div class="seg" style="flex-wrap:wrap">
      ${VIEWS.map(([k, l]) => `<button class="seg-b${evdbView === k ? ' on' : ''}"
        onclick="setEvDbView('${k}')">${l}</button>`).join('')}
    </div></div>`;

  el.innerHTML = seg + (evdbView === 'profile' ? profileHtml(ev)
    : evdbView === 'orgs' ? orgsHtml(ev)
    : evdbView === 'target' ? targetHtml(ev)
    : peopleHtml(ev));
}

/* 행사의 분야 — 여러 개 걸칠 수 있다(바이오 행사인데 건축 자재사가 오는 식).
   그래서 하나만 고르는 드롭다운이 아니라 체크로 둔다. */
function domainField(ev){
  const on = String(ev.domain || '').split('|').map(v => v.trim()).filter(Boolean);
  return `<div><div class="mlbl">분야 <span style="font-size:9px;color:var(--i4)">마스터DB에서 «이 분야 행사에 왔던 사람»을 찾을 때 씁니다</span></div>
    <div id="evdb-domain" style="display:flex;gap:10px;flex-wrap:wrap;padding:7px 0">
      ${DOMAINS.map(d => `<label style="display:flex;align-items:center;gap:5px;font-size:11.5px;cursor:pointer">
        <input type="checkbox" class="evdb-dom" value="${escAttr(d.id)}"${on.includes(d.id) ? ' checked' : ''}>
        ${escapeHtml(d.name)}</label>`).join('')
        || '<span style="font-size:11px;color:var(--i4)">설정 › 섹터 관리에서 분야를 먼저 만들어주세요</span>'}
    </div></div>`;
}

/* ── 개요 ──
   위는 자동으로 세는 것, 아래는 사람이 적는 것. 세는 값을 사람이 적게 하면
   틀리고, 성격을 자동으로 뽑으려 하면 헛말이 된다. 갈라 둔다. */
function profileHtml(ev){
  const rows = evPeople(ev.key);
  const orgs = evOrgs(ev.key);
  const recs = evRecCount(ev.key);
  const noOrg = evNoOrg(ev.key);
  /* 역할별 사람 수. 한 사람이 두 역할이면 양쪽에 들어가므로 합이 참여자보다
     클 수 있다 — 그 경우 아래에 그렇게 적는다. */
  const roleCnt = {};
  rows.forEach(r => {
    if(!r.roles.size){ roleCnt['(역할 없음)'] = (roleCnt['(역할 없음)'] || 0) + 1; return; }
    r.roles.forEach(k => { roleCnt[k] = (roleCnt[k] || 0) + 1; });
  });
  const topRoles = Object.entries(roleCnt).sort((a, b) => b[1] - a[1]);
  const roleSum = topRoles.reduce((a, b) => a + b[1], 0);

  const cntry = {};
  rows.forEach(r => { const k = countryName(r.country) || '(미상)'; cntry[k] = (cntry[k] || 0) + 1; });
  const topCntry = Object.entries(cntry).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const exhN = exhibitorsForEvent(ev.key).length;
  const tgtKeys = targetKeys();
  const already = orgs.filter(o => tgtKeys.has(o.key)).length;
  const parts = evParts(ev.key);

  const stat = (v, l, sub) => `<div style="flex:1;min-width:118px;background:var(--W);border:1px solid var(--i6);border-radius:9px;padding:11px 13px">
    <div style="font-size:19px;font-weight:700;color:var(--i1);line-height:1.1">${v}</div>
    <div style="font-size:10.5px;color:var(--i4);margin-top:3px">${l}</div>
    ${sub ? `<div style="font-size:10px;color:var(--i5);margin-top:3px">${sub}</div>` : ''}</div>`;

  /* 참여자와 참여 기업이 같은 수로 나오면 안 접힌 것처럼 보인다. 실제로 1기업
     1명인 행사(전시 신청 목록이 그렇다)가 있으므로, 몇 명이 한 기업으로 접혔는지
     숫자로 밝혀 둔다 — 의심하지 않아도 되게. */
  const avg = orgs.length ? (rows.length - noOrg.length) / orgs.length : 0;

  const fld = (id, label, val, ph) => `<div><div class="mlbl">${label}</div>
    <input class="fi" id="evdb-${id}" value="${escAttr(val || '')}" placeholder="${escAttr(ph || '')}" style="width:100%"></div>`;
  const area = (id, label, val, ph) => `<div style="margin-bottom:10px"><div class="mlbl">${label}</div>
    <textarea class="fi" id="evdb-${id}" rows="3" placeholder="${escAttr(ph || '')}"
      style="width:100%;resize:vertical;line-height:1.5">${escapeHtml(val || '')}</textarea></div>`;

  return `<div style="padding:14px 16px 40px;max-width:900px">

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      ${stat(rows.length.toLocaleString(), '참여자 (사람)',
        recs !== rows.length ? `참여 기록 ${recs.toLocaleString()}건 — 여러 역할로 들어온 사람이 있어요` : '')}
      ${stat(orgs.length.toLocaleString(), '참여 기업',
        orgs.length ? `1개사당 평균 ${avg.toFixed(1)}명` + (noOrg.length ? ` · 소속 없음 ${noOrg.length}명 제외` : '') : '')}
      ${stat(exhN.toLocaleString(), '전시 참가기업')}
      ${stat(already.toLocaleString(), 'CRM 타겟으로 잡힌 기업')}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">
      <div style="background:var(--i8);border:1px solid var(--i6);border-radius:10px;padding:13px 15px">
        <div style="font-size:11px;font-weight:700;color:var(--i2);margin-bottom:8px">역할 분포</div>
        ${topRoles.length ? topRoles.map(([r, n]) => `<div style="display:flex;align-items:center;gap:8px;padding:3px 0">
          <span class="pill ${escAttr(RP[r] || 'p-gray')}" style="min-width:88px;text-align:center">${escapeHtml(r)}</span>
          <div style="flex:1;height:6px;background:var(--i7);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${Math.round(n / rows.length * 100)}%;background:var(--i4)"></div></div>
          <span style="font-size:11px;color:var(--i3);min-width:34px;text-align:right">${n}명</span>
        </div>`).join('') : '<div style="font-size:11.5px;color:var(--i4)">참여 기록이 없어요.</div>'}
        ${roleSum > rows.length ? `<div style="font-size:10px;color:var(--i5);margin-top:6px">
          합이 참여자보다 많아요 — 한 사람이 여러 역할로 온 경우가 있습니다.</div>` : ''}
      </div>
      <div style="background:var(--i8);border:1px solid var(--i6);border-radius:10px;padding:13px 15px">
        <div style="font-size:11px;font-weight:700;color:var(--i2);margin-bottom:8px">국가</div>
        ${topCntry.length ? topCntry.map(([c, n]) =>
          `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11.5px">
            <span style="color:var(--i2)">${escapeHtml(c)}</span>
            <span style="color:var(--i4)">${n}명</span></div>`).join('')
          : '<div style="font-size:11.5px;color:var(--i4)">참여 기록이 없어요.</div>'}
      </div>
    </div>

    <div style="background:var(--i8);border:1px solid var(--i6);border-radius:10px;padding:16px">
      <div style="font-size:12px;font-weight:700;color:var(--i2);margin-bottom:4px">행사 개요</div>
      <div style="font-size:11px;color:var(--i4);margin-bottom:12px">
        기간·장소·진행 파트는 <b>설정 › 행사 관리</b>에서 정합니다. 여기는 몇 해 뒤에 이 행사를 다시 꺼내 볼 때 필요한 것들이에요.
      </div>

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
        <span class="pill p-gray">${escapeHtml(ev.date_start || ev.date || '기간 미정')}${ev.date_end ? ' ~ ' + escapeHtml(ev.date_end) : ''}</span>
        ${ev.location ? `<span class="pill p-gray">📍 ${escapeHtml(ev.location)}</span>` : ''}
        ${EVENT_PARTS.filter(p => parts[p.key] !== 'none').map(p => {
          const st = partStateOf(parts[p.key]);
          return `<span class="pill ${escAttr(st.cls)}">${escapeHtml(p.label)} · ${escapeHtml(st.label)}</span>`;
        }).join('')}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        ${fld('host', '주최', ev.host, '예: 한국보건산업진흥원')}
        ${fld('organizer', '주관', ev.organizer, '예: 스튜디오 블룸')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        ${fld('our_role', '우리가 맡은 일', ev.our_role, '예: 전시 운영대행 · 부스 시공')}
        ${fld('scale', '규모', ev.scale, '예: 참가사 120개사 · 관람객 8,000명')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        ${fld('theme', '대주제', ev.theme, '예: 바이오헬스 글로벌 협력')}
        ${domainField(ev)}
        ${fld('homepage', '홈페이지', ev.homepage, 'https://')}
      </div>
      ${area('summary', '행사 성격 — 어떤 행사였나', ev.summary, '누가 오는 행사인지, 무엇을 하는 자리인지')}
      ${area('outcome', '성과·비고 — 다음에 참고할 것', ev.outcome, '잘된 것, 막힌 것, 다음에 달리 할 것')}

      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn bp" onclick="saveEvDbProfile()" style="min-width:80px">저장</button>
        <span id="evdb-prof-msg" style="font-size:11px;color:var(--g)"></span>
      </div>
    </div>
  </div>`;
}

export async function saveEvDbProfile(){
  const ev = EVENT_LIST.find(e => e.key === evdbEvent);
  if(!ev) return;
  const msg = document.getElementById('evdb-prof-msg');
  const say = (t, ok) => { if(msg){ msg.style.color = ok ? 'var(--g)' : 'var(--re)'; msg.textContent = t; } };
  const g = (id) => (document.getElementById('evdb-' + id)?.value || '').trim();

  const FIELDS = ['host', 'organizer', 'our_role', 'scale', 'theme', 'homepage', 'summary', 'outcome', 'domain'];
  const prev = {};
  FIELDS.forEach(f => { prev[f] = ev[f] || ''; });

  /* 분야는 체크박스 여럿이라 값 읽는 방법이 다르다 — 섹터와 같은 방식으로
     파이프로 이어 한 칸에 담는다. */
  const domain = [...document.querySelectorAll('#evdb-domain .evdb-dom:checked')]
    .map(el => el.value).join('|');

  const next = {};
  FIELDS.forEach(f => { next[f] = f === 'domain' ? domain : g(f); });
  const changed = FIELDS.filter(f => prev[f] !== next[f]);
  if(!changed.length){ say('바뀐 게 없어요.', true); return; }

  Object.assign(ev, next);
  const r = await saveEventToSheet(ev);
  if(r && r.ok === false){
    Object.assign(ev, prev);
    say('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    renderEvDb();
    return;
  }
  // 무엇이 바뀌었는지만 남긴다 — 긴 글 두 개를 통째로 로그에 넣으면 못 읽는다
  trackAction('edit', '행사 개요 수정', ev.key,
    `${ev.name || ev.key} — ${changed.join(', ')} 수정`,
    changeMeta('events', ev.key, prev,
      changed.reduce((o, f) => (o[f] = next[f], o), {})));
  say('저장했어요.', true);
  setTimeout(() => { const m = document.getElementById('evdb-prof-msg'); if(m) m.textContent = ''; }, 2000);
}

/* ── 참여자 ── */
/* 역할 칩 — 세는 대상이 탭마다 다르다.
   참여자 탭은 사람을, 기업 탭은 기업을 센다. 전에는 둘 다 사람으로 세서,
   4명이 온 기업이 한 줄로 잘 접혀 있는데도 머리에는 "전체 76"이 떠 있었다.
   목록과 숫자가 다른 것을 세면 접기가 안 된 줄 안다.
   단위(명·개사)를 붙여 두 번 다시 헷갈리지 않게 한다. */
function roleChips(evKey, byOrg){
  const cnt = {};
  let total;
  if(byOrg){
    const orgs = evOrgs(evKey);
    total = orgs.length;
    // 한 기업이 여러 역할을 걸칠 수 있다(연사도 보내고 부스도 낸 곳) —
    // 그 기업은 양쪽 칩에 한 번씩 잡힌다. 기업 하나가 두 번 세어지지는 않는다.
    orgs.forEach(o => o.roles.forEach(k => { cnt[k] = (cnt[k] || 0) + 1; }));
  } else {
    const rows = evPeople(evKey);
    total = rows.length;
    rows.forEach(r => r.roles.forEach(k => { cnt[k] = (cnt[k] || 0) + 1; }));
  }
  const unit = byOrg ? '개사' : '명';

  const order = PART_TYPES.map(p => p.key).filter(k => cnt[k]);
  Object.keys(cnt).forEach(k => { if(!order.includes(k)) order.push(k); });

  return `<div class="seg" style="flex-wrap:wrap">
    <button class="seg-b${!evdbRoleFil ? ' on' : ''}" onclick="setEvDbRole('')">전체 ${total}${unit}</button>
    ${order.map(k => `<button class="seg-b${evdbRoleFil === k ? ' on' : ''}"
      onclick="setEvDbRole('${escAttr(k)}')">${escapeHtml(k)} ${cnt[k]}${unit}</button>`).join('')}
  </div>`;
}

/* 확정 표시 — 눌러서 그 자리에서 바꾼다. 한 명씩 고치는 일이 제일 잦다.
   확정된 날짜를 툴팁에 둔다 — 언제 정해졌는지가 나중에 꼭 문제가 된다. */
const confirmBadge = (r) => r.confirmedAt
  ? `<span class="pill p-green" style="cursor:pointer" title="${escAttr(r.confirmedAt)}에 확정 — 눌러서 해제"
      onclick="event.stopPropagation();toggleEvDbConfirm(${r.cid})">✓ 확정</span>`
  : `<span class="pill p-gray" style="cursor:pointer" title="눌러서 참가 확정"
      onclick="event.stopPropagation();toggleEvDbConfirm(${r.cid})">타겟</span>`;

/* 한 사람이 여러 역할일 수 있다 — 하나만 보여주면 나머지를 못 본다 */
const roleBadges = (r) => [...r.roles]
  .map(v => `<span class="pill ${escAttr(RP[v] || 'p-gray')}" style="margin-right:3px">${escapeHtml(v)}</span>`).join('');

function filteredRows(){
  let l = evPeople(evdbEvent);
  if(evdbRoleFil) l = l.filter(r => r.roles.has(evdbRoleFil));
  if(evdbStatFil === 'confirmed') l = l.filter(r => !!r.confirmedAt);
  if(evdbStatFil === 'target')    l = l.filter(r => !r.confirmedAt);
  const q = evdbQuery.trim().toLowerCase();
  if(q) l = l.filter(r => [r.name, r.nameEn, r.org, r.orgEn, r.title, r.email]
    .some(v => String(v || '').toLowerCase().includes(q)));
  return l;
}

/* ── 타겟과 참가자 ──
   행사에 «건다»는 것과 «온다»는 것은 다른 일이다. 역할(연사·바이어)로
   가르면 안 된다 — 바이어였다가 참가자가 되는 게 아니라 바이어인 채로
   확정되는 것이다. 그래서 확정 여부로만 가른다. */
function statChips(evKey){
  const all = evPeople(evKey);
  const conf = all.filter(r => r.confirmedAt).length;
  const chip = (v, label, n) => `<button class="seg-b${evdbStatFil === v ? ' on' : ''}"
    onclick="setEvDbStat('${v}')">${label} ${n}명</button>`;
  return `<div class="seg" style="flex-wrap:wrap">
    ${chip('', '전체', all.length)}
    ${chip('confirmed', '참가 확정', conf)}
    ${chip('target', '타겟', all.length - conf)}
  </div>`;
}

function peopleHtml(ev){
  const shown = filteredRows();
  const picked = evdbPickedPeople.size;
  return `<div style="padding:10px 16px 0">${statChips(ev.key)}</div>
    <div style="padding:8px 16px 0">${roleChips(ev.key)}</div>
    <div style="padding:10px 16px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      ${searchBoxHtml('이름·기업·직함 검색…')}
      <button class="btn" style="font-size:11px" onclick="toggleEvDbPeopleAll()">전체 선택/해제</button>
      <div style="flex:1"></div>
      <span id="evdb-picked-n" style="font-size:11px;color:var(--i4)">${picked ? picked + '명 선택' : ''}</span>
      <button class="btn" style="font-size:11px" onclick="confirmEvDbPeople(true)">참가 확정</button>
      <button class="btn" style="font-size:11px" onclick="confirmEvDbPeople(false)">확정 해제</button>
      <button class="btn" style="font-size:11px" onclick="openEvDbMailList()">메일 대상 모으기</button>
      <button class="btn bp" style="font-size:11px" onclick="exportEvDbPeople()">명단 내보내기 (${shown.length})</button>
    </div>
    <div id="evdb-rows" style="padding:6px 16px 40px">${peopleRowsHtml()}</div>`;
}

const searchBoxHtml = (ph) => `<div class="srch" style="width:100%;max-width:340px">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
  <input type="text" id="evdb-q" placeholder="${escAttr(ph)}" value="${escAttr(evdbQuery)}"
    style="width:100%" oninput="setEvDbQuery(this.value)"></div>`;

function peopleRowsHtml(){
  const l = filteredRows();
  if(!l.length) return '<div style="font-size:12px;color:var(--i4);padding:20px 0">해당하는 참여자가 없어요.</div>';

  // 좁은 화면에서는 표가 옆으로 넘쳐 읽을 수 없다 — 카드로 바꿔 준다
  if(isMobile()) return l.map(r => `<div style="background:var(--W);border:1px solid var(--i6);border-radius:8px;padding:10px 12px;margin-bottom:6px">
    <div style="display:flex;align-items:center;gap:7px">
      <input type="checkbox" ${evdbPickedPeople.has(r.cid) ? 'checked' : ''}
        onchange="pickEvDbPerson(${r.cid},this.checked)">
      <span style="font-size:13px;font-weight:600;color:var(--i1)">${escapeHtml(r.name)}</span>
      ${confirmBadge(r)}
      ${roleBadges(r)}
    </div>
    <div style="font-size:11px;color:var(--i3);margin-top:3px">${escapeHtml(r.org)}${r.title ? ' · ' + escapeHtml(r.title) : ''}</div>
    <div style="font-size:10.5px;color:var(--i4);margin-top:2px">${escapeHtml(countryName(r.country) || '')}${r.email ? ' · ' + escapeHtml(r.email) : ''}</div>
  </div>`).join('');

  return `<div style="overflow-x:auto"><table style="width:100%">
    <thead><tr>
      <th style="width:26px"></th><th style="width:74px">참가</th>
      <th>성명</th><th>기업·기관</th><th>직함</th><th>역할</th><th>국가</th><th>연락처</th>
    </tr></thead><tbody>
    ${l.map(r => `<tr>
      <td style="text-align:center"><input type="checkbox" ${evdbPickedPeople.has(r.cid) ? 'checked' : ''}
        onchange="pickEvDbPerson(${r.cid},this.checked)"></td>
      <td>${confirmBadge(r)}</td>
      <td><span style="font-weight:600">${escapeHtml(r.name)}</span>${r.nameEn ? `<div style="font-size:10.5px;color:var(--i4)">${escapeHtml(r.nameEn)}</div>` : ''}</td>
      <td>${escapeHtml(r.org)}${r.orgEn && r.orgEn !== r.org ? `<div style="font-size:10.5px;color:var(--i4)">${escapeHtml(r.orgEn)}</div>` : ''}</td>
      <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(r.title)}</td>
      <td>${roleBadges(r)}</td>
      <td style="font-size:11.5px;color:var(--i3)">${escapeHtml(countryName(r.country) || '')}</td>
      <td style="font-size:11px;color:var(--i4)">${escapeHtml(r.email)}</td>
    </tr>`).join('')}
    </tbody></table></div>`;
}

/* ── 기업 ──
   이 화면이 이 탭을 만든 이유다. 행사에서 만난 기업을 골라 타겟으로 보낸다. */
function orgsHtml(ev){
  return `<div style="padding:10px 16px 0">${roleChips(ev.key, true)}</div>
    <div style="padding:10px 16px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      ${searchBoxHtml('기업명 검색…')}
      <button class="btn" style="font-size:11px" onclick="toggleEvDbAll()">전체 선택/해제</button>
      <div style="flex:1"></div>
      <button class="btn bp" id="evdb-send-btn" onclick="openEvDbSend()">타겟으로 보내기</button>
    </div>
    <div id="evdb-rows" style="padding:8px 16px 40px">${orgsRowsHtml()}</div>`;
}

function filteredOrgs(){
  let l = evOrgs(evdbEvent);
  if(evdbRoleFil) l = l.filter(o => o.roles.has(evdbRoleFil));
  const q = evdbQuery.trim().toLowerCase();
  if(q) l = l.filter(o => [o.name, o.nameEn].some(v => String(v || '').toLowerCase().includes(q)));
  return l;
}

function orgsRowsHtml(){
  const l = filteredOrgs();
  const tail = noOrgNoteHtml();
  if(!l.length) return '<div style="font-size:12px;color:var(--i4);padding:20px 0">해당하는 기업이 없어요.</div>' + tail;
  const tgt = targetKeys();
  const exh = exhKeysOf(evdbEvent);

  return l.map(o => {
    const isT = tgt.has(o.key), isX = exh.has(o.key);
    const people = o.people.slice(0, 3).map(p => p.name).filter(Boolean);
    return `<label style="display:flex;align-items:center;gap:10px;background:var(--W);border:1px solid var(--i6);
        border-radius:8px;padding:10px 12px;margin-bottom:6px;cursor:pointer">
      <input type="checkbox" class="evdb-cb" data-k="${escAttr(o.key)}" ${evdbPicked.has(o.key) ? 'checked' : ''}
        onchange="pickEvDbOrg('${escAttr(o.key)}',this.checked)">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:600;color:var(--i1)">${escapeHtml(o.name)}</span>
          ${isT ? '<span class="pill p-green">CRM 타겟</span>' : ''}
          ${isX ? '<span class="pill p-purple">전시 참가</span>' : ''}
        </div>
        <div style="font-size:11px;color:var(--i4);margin-top:3px">
          ${[...o.roles].map(r => `<span class="pill ${escAttr(RP[r] || 'p-gray')}" style="margin-right:3px">${escapeHtml(r)}</span>`).join('')}
          ${escapeHtml(countryName(o.country) || '')}
        </div>
        <div style="font-size:10.5px;color:var(--i5);margin-top:3px">
          ${o.people.length
            ? `${o.people.length}명 — ${escapeHtml(people.join(', '))}${o.people.length > 3 ? ` 외 ${o.people.length - 3}명` : ''}`
            : '<span style="color:var(--i5)">담당자 미등록 — 참가기업 명부에서 왔어요</span>'}
        </div>
      </div>
    </label>`;
  }).join('') + tail;
}

/* 소속이 비어 기업으로 묶지 못한 사람 — 참여자 수와 기업별 인원 합이 안 맞는
   이유가 여기 있다. 안 보이면 데이터가 샜다고 오해한다. */
function noOrgNoteHtml(){
  const l = evNoOrg(evdbEvent);
  if(!l.length) return '';
  const names = l.slice(0, 8).map(r => r.name).filter(Boolean);
  return `<div style="margin-top:12px;padding:10px 12px;border:1px dashed var(--i6);border-radius:8px;background:var(--i8)">
    <div style="font-size:11.5px;font-weight:600;color:var(--i2)">소속이 비어 기업으로 묶지 못한 ${l.length}명</div>
    <div style="font-size:10.5px;color:var(--i4);margin-top:4px">
      ${escapeHtml(names.join(', '))}${l.length > names.length ? ` 외 ${l.length - names.length}명` : ''}
    </div>
    <div style="font-size:10px;color:var(--i5);margin-top:5px">
      참여 기업 수에서 빠져 있고 타겟으로도 보낼 수 없어요 — 마스터DB에서 소속을 채우면 여기 올라옵니다.
    </div>
  </div>`;
}

export function pickEvDbOrg(key, on){
  if(on) evdbPicked.add(key); else evdbPicked.delete(key);
  const btn = document.getElementById('evdb-send-btn');
  if(btn) btn.textContent = evdbPicked.size ? `타겟으로 보내기 (${evdbPicked.size})` : '타겟으로 보내기';
}

export function toggleEvDbAll(){
  const shown = filteredOrgs();
  // 하나라도 안 골라진 게 있으면 전체 선택, 다 골라져 있으면 전체 해제
  const allOn = shown.length > 0 && shown.every(o => evdbPicked.has(o.key));
  shown.forEach(o => { if(allOn) evdbPicked.delete(o.key); else evdbPicked.add(o.key); });
  renderEvDb();
  const btn = document.getElementById('evdb-send-btn');
  if(btn) btn.textContent = evdbPicked.size ? `타겟으로 보내기 (${evdbPicked.size})` : '타겟으로 보내기';
}

/* ══════════════════════════════════════════
   타겟으로 보내기

   두 군데로 보낼 수 있다.
     CRM 타겟      — 아직 영업 전. 미접촉부터 파이프라인을 태운다.
     전시 참가기업  — 참가가 정해진 곳. 매뉴얼→신청서 체크리스트가 바로 생긴다.
   무엇을 쓸지는 상황이 정하는 것이라 고르게 두고, 기본값은 CRM으로 둔다.
══════════════════════════════════════════ */

/* 전시기업으로 등록한 곳의 담당자를 그 행사 참여자로 올린다.
   부스를 잡았다는 건 참가가 정해졌다는 뜻이라 확정일까지 함께 적는다 —
   «초청했지만 아직 등록 안 한» 사람과 갈리는 지점이 여기다.

   이미 걸려 있는 사람은 역할을 건드리지 않는다. 연사로도 오는 사람이
   있고, 무엇으로 왔는지는 사람이 적어 둔 것이 맞다. */
async function linkExhibitorPeople(orgsSent, toEv){
  const when = td();
  const add = [];
  orgsSent.forEach(o => {
    (o.people || []).forEach(pr => {
      if(!pr.id) return;
      const had = participations.filter(p => p.eventId === toEv && String(p.contactId) === String(pr.id));
      if(had.length){
        had.forEach(p => { if(!p.confirmedAt) p.confirmedAt = when; });
        return;
      }
      add.push({
        id: 'P-' + Date.now() + '-x' + add.length,
        eventId: toEv, event: toEv, contactId: pr.id, contact: pr.name || '',
        role: '전시참가기업', note: '', matched: '✅ 전시 참가기업에서', confirmedAt: when,
      });
    });
  });
  if(!add.length){ invalidateEvRows(); return; }

  add.forEach(p => participations.push(p));
  const r = await postToSheet({
    sheet: 'participations', action: 'batchAppend',
    rows: add.map(p => [p.id, p.eventId, '', p.contactId, '', '', '',
      p.role, p.note, p.matched, p.confirmedAt]),
  }, '전시 참가기업 참여 기록');
  if(!r.ok){
    /* 참여 기록만 실패해도 전시기업 등록은 이미 됐다 — 되돌리지 않고
       무엇이 안 됐는지 말한다. 조용히 넘어가면 행사 참여자에서 또 빈다. */
    const ids = new Set(add.map(p => p.id));
    for(let i = participations.length - 1; i >= 0; i--){
      if(ids.has(participations[i].id)) participations.splice(i, 1);
    }
    alert('전시기업은 등록됐지만 행사 참여 기록 저장에 실패했어요.\n'
      + '행사 탭 참여자 목록에는 아직 안 보입니다 — 네트워크 확인 후 다시 보내주세요.');
  }
  invalidateEvRows();
}

export function openEvDbSend(){
  if(!evdbPicked.size){ alert('보낼 기업을 골라주세요.'); return; }
  const picked = evOrgs(evdbEvent).filter(o => evdbPicked.has(o.key));
  const from = EVENT_LIST.find(e => e.key === evdbEvent);

  const pop = document.createElement('div');
  pop.id = 'evdb-send-modal';
  pop.className = 'mw on';
  // 드래그가 배경에서 끝나도 닫히지 않게 — 목록을 긁다가 창이 사라지면 곤란하다
  let downOnBg = false;
  pop.addEventListener('mousedown', e => { downOnBg = (e.target === pop); });
  pop.addEventListener('click', e => { if(e.target === pop && downOnBg) closeEvDbSend(); });

  pop.innerHTML = `<div class="modal" style="max-width:520px">
    <div class="mh"><div class="mt2">타겟으로 보내기</div>
      <button class="mc" onclick="closeEvDbSend()">✕</button></div>
    <div class="mb">
      <div style="font-size:11.5px;color:var(--i4);margin-bottom:12px">
        <b>${escapeHtml(from?.short || from?.name || evdbEvent)}</b>에서 만난 <b>${picked.length}개사</b>를 보냅니다.
      </div>

      <div class="fg"><div class="fl">어디로</div>
        <div class="seg" style="flex-wrap:wrap">
          <button class="seg-b on" id="evdb-dest-crm" onclick="setEvDbDest('crm')">CRM 타겟</button>
          <button class="seg-b" id="evdb-dest-exh" onclick="setEvDbDest('exh')">전시 참가기업</button>
        </div>
        <div id="evdb-dest-hint" style="font-size:10.5px;color:var(--i5);margin-top:6px">
          아직 영업 전인 곳 — 미접촉부터 파이프라인을 태웁니다.
        </div>
      </div>

      <div class="fg"><div class="fl">어느 행사의 타겟인가</div>
        <select class="fi" id="evdb-send-ev" style="width:100%">
          ${EVENT_LIST.map(e => `<option value="${escAttr(e.key)}"${e.key === evdbEvent ? ' selected' : ''}>${escapeHtml(e.short || e.name || e.key)}</option>`).join('')}
        </select>
        <div style="font-size:10.5px;color:var(--i5);margin-top:5px">보통은 <b>다음에 열 행사</b>를 고릅니다 — 이 사람들을 부를 행사요.</div>
      </div>

      <div id="evdb-crm-opts">
        <div class="fgr">
          <div class="fg"><div class="fl">참여 유형</div>
            <select class="fi" id="evdb-send-role" style="width:100%">
              ${PART_TYPES.map(p => `<option value="${escAttr(p.key)}"${p.key === '전시참가기업' ? ' selected' : ''}>${escapeHtml(p.label)}</option>`).join('')}
            </select></div>
          <div class="fg"><div class="fl">우선순위</div>
            <select class="fi" id="evdb-send-pri" style="width:100%">
              <option value="high">높음</option><option value="mid" selected>중간</option><option value="low">낮음</option>
            </select></div>
        </div>
        <div class="fg"><div class="fl">담당자</div>
          <input class="fi" id="evdb-send-who" placeholder="비우면 안 넣어요" style="width:100%"></div>
      </div>

      <div class="fg"><div class="fl">고른 기업</div>
        <div style="max-height:170px;overflow-y:auto;border:1px solid var(--i6);border-radius:7px;padding:7px 9px">
          ${picked.map(o => `<div style="font-size:11.5px;padding:2px 0;color:var(--i2)">
            ${escapeHtml(o.name)} <span style="color:var(--i5)">· ${o.people.length}명</span></div>`).join('')}
        </div></div>

      <div id="evdb-send-msg" style="font-size:11px;color:var(--re);margin-top:8px"></div>
    </div>
    <div class="mf2">
      <button class="btn" onclick="closeEvDbSend()">취소</button>
      <button class="btn bp" id="evdb-send-go" onclick="confirmEvDbSend()">보내기</button>
    </div>
  </div>`;
  document.body.appendChild(pop);
}

export const closeEvDbSend = () => document.getElementById('evdb-send-modal')?.remove();

let evdbDest = 'crm';
export function setEvDbDest(d){
  evdbDest = d;
  document.getElementById('evdb-dest-crm')?.classList.toggle('on', d === 'crm');
  document.getElementById('evdb-dest-exh')?.classList.toggle('on', d === 'exh');
  const opts = document.getElementById('evdb-crm-opts');
  if(opts) opts.style.display = d === 'crm' ? 'block' : 'none';
  const hint = document.getElementById('evdb-dest-hint');
  if(hint) hint.innerHTML = d === 'crm'
    ? '아직 영업 전인 곳 — 미접촉부터 파이프라인을 태웁니다.'
    : '참가가 정해진 곳 — 매뉴얼·신청서·부스 체크리스트가 바로 생깁니다.';
}

export async function confirmEvDbSend(){
  const picked = evOrgs(evdbEvent).filter(o => evdbPicked.has(o.key));
  if(!picked.length){ closeEvDbSend(); return; }
  const toEv = document.getElementById('evdb-send-ev')?.value || evdbEvent;
  const msg = document.getElementById('evdb-send-msg');
  const say = (t) => { if(msg) msg.textContent = t; };
  const btn = document.getElementById('evdb-send-go');
  const busy = (on) => { if(btn){ btn.disabled = on; btn.textContent = on ? '보내는 중…' : '보내기'; } };

  const fromEv = EVENT_LIST.find(e => e.key === evdbEvent);
  const fromName = fromEv?.short || fromEv?.name || evdbEvent;

  if(evdbDest === 'exh'){
    // 끝난 행사에 새 참가기업이 생기면 그때의 기록이 아니게 된다
    if(evPartDone(toEv, 'exh')){ say('그 행사는 전시가 진행 완료라 새로 넣을 수 없어요.'); return; }
    // 이미 그 행사에 등록된 곳은 빼고 보낸다 — 같은 기업이 두 줄이 되면
    // 체크리스트가 갈려서 어느 쪽이 진짜인지 알 수 없다
    const have = exhKeysOf(toEv);
    const fresh = picked.filter(o => !have.has(o.key));
    if(!fresh.length){ say('고른 기업이 이미 전부 그 행사에 등록돼 있어요.'); return; }

    busy(true);
    const rows = fresh.map(o => ({
      event_id: toEv, company_key: o.key, company_name: o.name,
      status: '준비중', note: `${fromName}에서 만남`, updated_at: td(),
    }));
    const r = await batchCreateExhibitors(rows);
    if(!r.ok){ busy(false); say('등록에 실패했어요. 네트워크 확인 후 다시 시도해주세요.'); return; }

    // 서버가 id를 만들어 주므로 저장 직후 재조회로 맞춘다(전시 탭과 같은 방식)
    await reloadExhibitors();
    /* 전시기업이 되는 것도 «그 행사에 들어온다»는 일이다. 참여 기록을 함께
       만들지 않으면 전시 탭에만 쌓이고 행사 참여자 목록에는 안 보인다 —
       실제로 2025 KIC은 전시기업 48곳에 참여자가 0명이었다. */
    await linkExhibitorPeople(fresh, toEv);
    trackAction('add', '전시 참가기업 등록', `${fresh.length}개사`,
      `<b>${escapeHtml(fromName)}</b>에서 만난 <b>${fresh.length}개사</b>를 <b>${escapeHtml(toEv)}</b> 전시 참가기업으로 등록`);
    finishSend(fresh.length, picked.length - fresh.length, '전시 참가기업');
    return;
  }

  // ── CRM 타겟 ──
  const have = targetKeys();
  const fresh = picked.filter(o => !have.has(o.key));
  if(!fresh.length){ say('고른 기업이 이미 전부 CRM 타겟으로 잡혀 있어요.'); return; }

  const role = document.getElementById('evdb-send-role')?.value || '전시참가기업';
  const pri = document.getElementById('evdb-send-pri')?.value || 'mid';
  const who = (document.getElementById('evdb-send-who')?.value || '').trim();

  busy(true);
  const made = [];
  for(const o of fresh){
    // 그 행사에서 만난 사람을 첫 기록으로 남긴다 — 나중에 "누구를 통해
    // 뚫는지"가 타겟 카드에서 바로 보여야 한다
    const people = o.people.map(p => [p.name, p.title].filter(Boolean).join(' ')).filter(Boolean);
    const t = {
      id: Date.now() + made.length,     // 같은 밀리초에 여러 건이 만들어지면 id가 겹친다
      name: o.name, nameEn: o.nameEn || '',
      sector: o.sector || '', hq: countryName(o.country) || '',
      event: toEv, role, status: '미접촉', priority: pri,
      assignee: who, currentStage: 1, lastActivity: td(),
      branches: [o.name, o.nameEn].filter(Boolean), mainBranch: o.name,
      log: [{ type: '메모', date: td(), color: '#9C9890',
        text: `${fromName}에서 만남 — ${people.slice(0, 5).join(', ')}${people.length > 5 ? ` 외 ${people.length - 5}명` : ''}` }],
    };
    targets.unshift(t);
    const r = await saveTargetToSheet(t);
    if(!r.ok){
      // 중간에 끊기면 넣은 것만 되돌린다 — 반쯤 들어간 채로 두면 다시 보낼 때
      // 무엇이 이미 들어갔는지 알 수 없다
      [...made, t].forEach(x => { const i = targets.indexOf(x); if(i >= 0) targets.splice(i, 1); });
      busy(false);
      say('저장 도중 실패했어요. 아무것도 추가되지 않았습니다.');
      return;
    }
    made.push(t);
  }
  trackAction('add', 'CRM 타겟 추가', `${made.length}개사`,
    `<b>${escapeHtml(fromName)}</b>에서 만난 <b>${made.length}개사</b>를 <b>${escapeHtml(toEv)}</b> 타겟으로 추가`);
  finishSend(made.length, picked.length - made.length, 'CRM 타겟');
}

/* 서버가 id를 생성하는 일괄 등록 직후에만 쓰는 재조회 (exh-tab.js와 같은 이유) */
async function reloadExhibitors(){
  const { safeFetch, authHeaders } = await import('../api.js');
  const { API_BASE_URL, currentUser } = await import('../state.js');
  if(!API_BASE_URL || !currentUser) return;
  const rows = await safeFetch(API_BASE_URL + '/api/data?sheet=exhibitors', 'exhibitors', 1, await authHeaders());
  if(Array.isArray(rows)) EXHIBITORS.splice(0, EXHIBITORS.length, ...rows);
}

function finishSend(n, skipped, what){
  evdbPicked.clear();
  closeEvDbSend();
  renderEvDb();
  // 보낸 곳도 같이 갱신해 둔다 — 탭을 옮겼을 때 방금 넣은 게 없으면 실패한 줄 안다
  try { buildEvFil(); renderCrm(); updBadges(); } catch(e){}
  try { window.buildExhEvList?.(); window.renderExh?.(); } catch(e){}
  alert(`${n}개사를 ${what}으로 보냈어요.` + (skipped ? `\n(이미 들어 있던 ${skipped}개사는 건너뛰었습니다)` : ''));
}

/* ── 탭 진입 훅 (router.js가 부른다) ── */

/* ══════════════════════════════════════════
   참가 확정 · 명단 내보내기 · 메일 대상

   행사 담당자가 이 화면에서 실제로 하는 일 세 가지다. 마스터DB로 건너가서
   하게 하면 «내 행사»라는 범위가 매번 풀린다.
══════════════════════════════════════════ */
export function pickEvDbPerson(cid, on){
  if(on) evdbPickedPeople.add(cid); else evdbPickedPeople.delete(cid);
  const el = document.getElementById('evdb-picked-n');
  if(el) el.textContent = evdbPickedPeople.size ? evdbPickedPeople.size + '명 선택' : '';
}

export function toggleEvDbPeopleAll(){
  const shown = filteredRows();
  const allOn = shown.length > 0 && shown.every(r => evdbPickedPeople.has(r.cid));
  shown.forEach(r => { if(allOn) evdbPickedPeople.delete(r.cid); else evdbPickedPeople.add(r.cid); });
  renderEvDb();
}

/* 참여 기록에 확정 날짜를 적는다. 한 사람이 두 역할이면 줄도 둘이라
   둘 다 같이 움직여야 «연사로는 확정, 바이어로는 미정» 같은 게 안 생긴다. */
async function saveConfirm(rows, on){
  const when = on ? td() : '';
  const touched = [];
  rows.forEach(r => {
    r.partIds.forEach(pid => {
      const p = participations.find(x => x.id === pid);
      if(!p) return;
      touched.push({ p, before: p.confirmedAt || '' });
      p.confirmedAt = when;
    });
    r.confirmedAt = when;
  });
  if(!touched.length) return true;

  invalidateEvRows();
  renderEvDb();

  /* 위치 배열 — 시트 순서 그대로. 맨 뒤가 확정 날짜다.
     (id, ev_id, 행사명, cid, 소속, 성명, 직함, type, note, matched, confirmed_at) */
  const res = await postToSheet({
    sheet: 'participations', action: 'batchUpsert',
    rows: touched.map(({ p }) => [p.id, p.eventId, '', p.contactId, '', '', '',
      p.role || '', p.note || '', p.matched || '', p.confirmedAt || '']),
  }, on ? '참가 확정' : '참가 확정 해제');

  if(!res.ok){
    touched.forEach(({ p, before }) => { p.confirmedAt = before; });
    invalidateEvRows();
    renderEvDb();
    alert('저장에 실패해서 되돌렸어요. 네트워크를 확인하고 다시 해주세요.');
    return false;
  }
  trackAction('edit', on ? '참가 확정' : '참가 확정 해제', rows.length + '명',
    evdbEvent + ' 참여자 ' + rows.length + '명을 ' + (on ? '참가 확정' : '타겟으로 되돌림'),
    { table: 'participations', op: 'update-many',
      rows: touched.map(({ p, before }) => ({ row: p.id,
        before: { confirmed_at: before }, after: { confirmed_at: p.confirmedAt || '' } })) });
  return true;
}

export async function toggleEvDbConfirm(cid){
  const r = evPeople(evdbEvent).find(x => x.cid === cid);
  if(!r) return;
  await saveConfirm([r], !r.confirmedAt);
}

export async function confirmEvDbPeople(on){
  const rows = evPeople(evdbEvent).filter(r => evdbPickedPeople.has(r.cid));
  if(!rows.length){ alert('먼저 사람을 골라주세요.'); return; }
  const todo = rows.filter(r => !!r.confirmedAt !== on);
  if(!todo.length){ alert(on ? '고른 사람은 이미 모두 확정돼 있어요.' : '고른 사람은 이미 모두 타겟이에요.'); return; }
  if(!confirm(todo.length + '명을 ' + (on ? '참가 확정' : '타겟으로 되돌림') + ' 처리할까요?')) return;
  if(await saveConfirm(todo, on)) evdbPickedPeople.clear();
  renderEvDb();
}

/* 지금 보고 있는 명단 그대로 내보낸다 — 거르개를 걸어 둔 채 «참가 확정만»,
   «바이어만» 뽑는 일이 잦다. 고른 사람이 있으면 그 사람만. */
export function exportEvDbPeople(){
  let l = filteredRows();
  if(evdbPickedPeople.size) l = l.filter(r => evdbPickedPeople.has(r.cid));
  if(!l.length){ alert('내보낼 명단이 없어요.'); return; }

  const ev = EVENT_LIST.find(e => e.key === evdbEvent);
  const head = ['참가', '성명', '영문명', '기업·기관', '부서', '직함', '역할', '국가', '이메일', '연락처', '확정일'];
  const body = l.map(r => [
    r.confirmedAt ? '확정' : '타겟',
    r.name, r.nameEn, r.org, r.dept, r.title,
    [...r.roles].join('|'), countryName(r.country) || '', r.email, r.phone, r.confirmedAt,
  ]);
  const csv = [head, ...body]
    .map(row => row.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(','))
    .join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,﻿' + encodeURIComponent(csv);
  a.download = ((ev && (ev.short || ev.name)) || evdbEvent) + '_명단_' + td() + '.csv';
  a.click();
}

/* 메일 대상 — 주소를 모아 보여준다. 여기서 바로 보내지는 않는다.
   보내는 건 메일 프로그램이 할 일이고, 우리가 할 일은 «누구에게»를 정확히
   추리는 것이다. 주소가 없는 사람은 세어서 알려 준다 — 조용히 빠지면
   보냈다고 생각한 사람에게 안 간다. */
export function openEvDbMailList(){
  let l = filteredRows();
  if(evdbPickedPeople.size) l = l.filter(r => evdbPickedPeople.has(r.cid));
  if(!l.length){ alert('대상이 없어요.'); return; }

  const seen = new Set();
  const mails = [];
  const noMail = [];
  l.forEach(r => {
    const e = String(r.email || '').trim().toLowerCase();
    if(!e){ noMail.push(r.name || r.org); return; }
    if(seen.has(e)) return;
    seen.add(e); mails.push(r.email.trim());
  });

  const old = document.getElementById('evdb-mail-modal');
  if(old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'evdb-mail-modal';
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:9999;'
    + 'display:flex;align-items:center;justify-content:center;padding:16px';
  wrap.onclick = (e) => { if(e.target === wrap) wrap.remove(); };
  wrap.innerHTML = `<div style="background:var(--W);border-radius:12px;padding:20px;width:100%;max-width:520px;
      max-height:82vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,.2)" onclick="event.stopPropagation()">
    <div style="font-size:14px;font-weight:700;margin-bottom:4px">메일 대상 ${mails.length}명</div>
    <div style="font-size:11.5px;color:var(--i3);line-height:1.6;margin-bottom:10px">
      지금 보고 있는 명단에서 모았어요${evdbPickedPeople.size ? ' (고른 사람만)' : ''}.
      ${noMail.length ? `<br><span style="color:var(--am)">메일 주소가 없어 빠진 ${noMail.length}명: ${
        escapeHtml(noMail.slice(0, 6).join(', '))}${noMail.length > 6 ? ' 외' : ''}</span>` : ''}
    </div>
    <textarea id="evdb-mail-box" readonly style="width:100%;height:190px;font-size:11px;font-family:monospace;
      padding:8px;border:1px solid var(--i6);border-radius:8px;resize:vertical">${escapeHtml(mails.join('; '))}</textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap">
      <button class="btn bs" onclick="document.getElementById('evdb-mail-modal').remove()">닫기</button>
      <button class="btn bs" onclick="copyEvDbMails()">주소 복사</button>
    </div>
  </div>`;
  document.body.appendChild(wrap);
}

export function copyEvDbMails(){
  const box = document.getElementById('evdb-mail-box');
  if(!box) return;
  box.select();
  navigator.clipboard?.writeText(box.value)
    .then(() => { box.blur(); alert('주소를 복사했어요. 메일 프로그램의 받는 사람 칸에 붙여 넣으세요.'); })
    .catch(() => { try { document.execCommand('copy'); alert('주소를 복사했어요.'); } catch(e){ alert('복사에 실패했어요 — 직접 선택해서 복사해주세요.'); } });
}


/* ══════════════════════════════════════════
   CRM 타겟 — 이 행사의 분야에서 창고를 훑는다

   타겟은 행사마다 따로 쌓인다. AIASK는 10월 건축 행사라 건축 분야에서
   고르고, EVENTKOREA 2027은 1월 이벤트 행사라 이벤트·MICE에서 고른다.
   그 «어느 분야에서 고르나»는 행사 개요의 분야 칸이 정한다.

   지금까지 타겟을 만드는 길은 «그 행사에 이미 온 기업» 중에서 고르는 것뿐이라,
   아직 한 번도 안 만난 곳은 끌어올 수가 없었다. 열리지도 않은 행사는 온
   기업이 없으니 타겟도 만들 수 없었다는 뜻이다 — EVENTKOREA 690개사 중
   타겟이 0곳이었던 까닭이다.

   여기서는 분야만 보고 창고 전체를 훑는다. 이미 타겟인 곳은 빼서 보여주되
   («이미 타겟» 칩으로 볼 수는 있다), 두 번 만들지 않는다.
══════════════════════════════════════════ */
const evDomains = (ev) => String(ev && ev.domain || '').split('|').map(v => v.trim()).filter(Boolean);

/* 그 기업이 이 행사 분야에 드나 — 섹터의 분야로 본다 */
function orgsInDomain(doms){
  if(!doms.length) return [];
  return CO_DB.filter(co => (co.sectors || []).some(name => {
    const sec = findSectorByName(name);
    return sec && domainOfSector(sec).some(d => doms.includes(d));
  }));
}

const tgtKeyOf = (co) => co.key;

function targetHtml(ev){
  const doms = evDomains(ev);
  if(!doms.length){
    return `<div style="padding:30px 16px;max-width:620px">
      <div style="background:var(--ab);border:1px solid #FDE68A;border-radius:10px;padding:14px 16px">
        <div style="font-size:12.5px;font-weight:700;color:var(--am);margin-bottom:5px">이 행사의 분야가 아직 없어요</div>
        <div style="font-size:11.5px;color:var(--i3);line-height:1.6">
          타겟은 «어느 분야에서 고르나»가 정해져야 훑을 수 있어요.
          «개요» 화면에서 분야를 골라주세요 — 예: AIASK는 건축, EVENTKOREA는 이벤트·MICE.
        </div></div></div>`;
  }

  const onKeys = new Set(targets.filter(t => t.event === ev.key)
    .flatMap(t => [t.name, t.nameEn, ...(t.branches || [])])
    .filter(Boolean).map(normalizeCompanyKey));
  const pool = orgsInDomain(doms);
  const isOn = (co) => onKeys.has(normalizeCompanyKey(co.nameKo || co.nameEn))
    || (co.branches || []).some(b => onKeys.has(normalizeCompanyKey(b)));

  const already = pool.filter(isOn);
  const fresh = pool.filter(co => !isOn(co));
  let list = evdbTgtFil === 'on' ? already : fresh;

  const q = evdbQuery.trim().toLowerCase();
  if(q) list = list.filter(co => [co.nameKo, co.nameEn, ...(co.sectors || [])]
    .some(v => String(v || '').toLowerCase().includes(q)));

  const domNames = doms.map(d => domainName(d)).join(' · ');
  const chip = (v, label, n) => `<button class="seg-b${evdbTgtFil === v ? ' on' : ''}"
    onclick="setEvDbTgtFil('${v}')">${label} ${n}개사</button>`;

  return `<div style="padding:12px 16px 0;max-width:1000px">
      <div style="font-size:11.5px;color:var(--i3);line-height:1.6;margin-bottom:10px">
        <b>${escapeHtml(domNames)}</b> 분야의 기업 ${pool.length}개사를 훑어요 —
        이 행사(${escapeHtml(ev.short || ev.key)})의 타겟으로 잡을 곳을 고르세요.
        <span style="color:var(--i5)">분야는 «개요»에서 바꿉니다.</span>
      </div>
      <div class="seg" style="flex-wrap:wrap">
        ${chip('new', '아직 타겟 아님', fresh.length)}
        ${chip('on', '이미 타겟', already.length)}
      </div>
    </div>
    <div style="padding:10px 16px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      ${searchBoxHtml('기업명·섹터 검색…')}
      <button class="btn" style="font-size:11px" onclick="toggleEvDbTgtAll()">전체 선택/해제</button>
      <div style="flex:1"></div>
      <button class="btn bp" id="evdb-tgt-btn" onclick="openEvDbTargetSend()"
        ${evdbTgtFil === 'on' ? 'disabled style="opacity:.5"' : ''}>CRM 타겟으로 잡기${
        evdbPickedTgt.size ? ` (${evdbPickedTgt.size})` : ''}</button>
    </div>
    <div style="padding:6px 16px 40px">${targetRowsHtml(list)}</div>`;
}

function targetRowsHtml(list){
  if(!list.length) return '<div style="font-size:12px;color:var(--i4);padding:20px 0">해당하는 기업이 없어요.</div>';
  return list.map(co => {
    const nm = co.nameKo || co.nameEn || '(이름 없음)';
    const on = evdbTgtFil === 'on';
    return `<label style="display:flex;align-items:center;gap:10px;background:var(--W);border:1px solid var(--i6);
        border-radius:8px;padding:9px 12px;margin-bottom:5px;${on ? '' : 'cursor:pointer'}">
      ${on ? '<span class="pill p-green">타겟</span>'
           : `<input type="checkbox" ${evdbPickedTgt.has(co.key) ? 'checked' : ''}
                onchange="pickEvDbTgt('${escAttr(co.key)}',this.checked)">`}
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:600;color:var(--i1)">${escapeHtml(nm)}</div>
        <div style="font-size:10.5px;color:var(--i4);margin-top:2px">
          ${(co.sectors || []).map(sx => `<span class="pill p-blue" style="margin-right:3px">${escapeHtml(sx)}</span>`).join('')}
          ${co.contacts && co.contacts.length ? `담당자 ${co.contacts.length}명` : '<span style="color:var(--i5)">담당자 없음</span>'}
        </div>
      </div>
    </label>`;
  }).join('');
}

export function setEvDbTgtFil(v){ evdbTgtFil = v; evdbPickedTgt.clear(); renderEvDb(); }

export function pickEvDbTgt(key, on){
  if(on) evdbPickedTgt.add(key); else evdbPickedTgt.delete(key);
  const btn = document.getElementById('evdb-tgt-btn');
  if(btn) btn.textContent = evdbPickedTgt.size ? `CRM 타겟으로 잡기 (${evdbPickedTgt.size})` : 'CRM 타겟으로 잡기';
}

export function toggleEvDbTgtAll(){
  const ev = EVENT_LIST.find(e => e.key === evdbEvent);
  if(!ev || evdbTgtFil === 'on') return;
  const doms = evDomains(ev);
  const onKeys = new Set(targets.filter(t => t.event === ev.key)
    .flatMap(t => [t.name, t.nameEn, ...(t.branches || [])]).filter(Boolean).map(normalizeCompanyKey));
  let list = orgsInDomain(doms).filter(co => !onKeys.has(normalizeCompanyKey(co.nameKo || co.nameEn)));
  const q = evdbQuery.trim().toLowerCase();
  if(q) list = list.filter(co => [co.nameKo, co.nameEn, ...(co.sectors || [])]
    .some(v => String(v || '').toLowerCase().includes(q)));
  const allOn = list.length > 0 && list.every(co => evdbPickedTgt.has(co.key));
  list.forEach(co => { if(allOn) evdbPickedTgt.delete(co.key); else evdbPickedTgt.add(co.key); });
  renderEvDb();
}

export async function openEvDbTargetSend(){
  const ev = EVENT_LIST.find(e => e.key === evdbEvent);
  if(!ev) return;
  if(!evdbPickedTgt.size){ alert('타겟으로 잡을 기업을 골라주세요.'); return; }
  const picked = CO_DB.filter(co => evdbPickedTgt.has(co.key));
  if(!confirm(`${picked.length}개사를 «${ev.short || ev.key}» CRM 타겟으로 잡을까요?\n`
    + `진행 단계는 «타겟 등록»부터 시작합니다.`)) return;

  const made = [];
  for(const co of picked){
    const t = {
      id: 'T-' + Date.now() + '-' + made.length,
      name: co.nameKo || co.nameEn || '', nameEn: co.nameEn || '',
      sector: (co.sectors || [])[0] || '', hq: co.hq || co.country || '',
      event: ev.key, role: '', status: '미접촉', priority: 'mid', assignee: '',
      lastActivity: td(),
      branches: [co.nameKo, co.nameEn].filter(Boolean),
      mainBranch: co.nameKo || co.nameEn || '',
      log: [{ type: '메모', text: `${domainName(evDomains(ev)[0])} 분야에서 ${ev.short || ev.key} 타겟으로 잡음`,
              date: td(), color: '#9C9890' }],
      currentStage: 1,
    };
    targets.unshift(t);
    made.push(t);
  }
  renderEvDb();

  /* 한 건씩 저장한다 — 실패한 것만 정확히 되돌리기 위해서다. 수백 개를
     한 번에 보내면 어디까지 들어갔는지 알 수 없다. */
  const failed = [];
  for(const t of made){
    const r = await saveTargetToSheet(t);
    if(!r || r.ok === false) failed.push(t);
  }
  if(failed.length){
    const ids = new Set(failed.map(t => t.id));
    for(let i = targets.length - 1; i >= 0; i--) if(ids.has(targets[i].id)) targets.splice(i, 1);
    alert(`${made.length - failed.length}개사는 타겟이 됐고 ${failed.length}개사는 저장에 실패했어요.\n`
      + '실패한 곳은 목록에서 되돌렸습니다 — 네트워크 확인 후 다시 골라주세요.');
  }
  evdbPickedTgt.clear();
  try { buildEvFil(); renderCrm(); updBadges(); } catch(e){}
  renderEvDb();
  if(!failed.length){
    trackAction('add', 'CRM 타겟 등록', `${made.length}개사`,
      `<b>${escapeHtml(ev.short || ev.key)}</b> 타겟으로 <b>${made.length}개사</b>를 분야에서 잡음`);
  }
}

export function initEvDbTab(){
  invalidateEvRows();
  buildEvDbList();
  renderEvDb();
}

window.invalidateEvRows = invalidateEvRows;
window.buildEvDbList    = buildEvDbList;
window.setEvDbEvent     = setEvDbEvent;
window.setEvDbView      = setEvDbView;
window.setEvDbRole      = setEvDbRole;
window.setEvDbQuery     = setEvDbQuery;
window.renderEvDb       = renderEvDb;
window.saveEvDbProfile  = saveEvDbProfile;
window.pickEvDbOrg      = pickEvDbOrg;
window.toggleEvDbAll    = toggleEvDbAll;
window.openEvDbSend     = openEvDbSend;
window.closeEvDbSend    = closeEvDbSend;
window.setEvDbDest      = setEvDbDest;
window.confirmEvDbSend  = confirmEvDbSend;
window.setEvDbStat         = setEvDbStat;
window.pickEvDbPerson      = pickEvDbPerson;
window.toggleEvDbPeopleAll = toggleEvDbPeopleAll;
window.toggleEvDbConfirm   = toggleEvDbConfirm;
window.confirmEvDbPeople   = confirmEvDbPeople;
window.exportEvDbPeople    = exportEvDbPeople;
window.openEvDbMailList    = openEvDbMailList;
window.copyEvDbMails       = copyEvDbMails;
window.setEvDbTgtFil       = setEvDbTgtFil;
window.pickEvDbTgt         = pickEvDbTgt;
window.toggleEvDbTgtAll    = toggleEvDbTgtAll;
window.openEvDbTargetSend  = openEvDbTargetSend;
