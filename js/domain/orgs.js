/* ══════════════════════════════════════════════════════════════
   domain/orgs.js — 기업 저장소 — 업종 추천, 업로드가 데려온 기업 등록, 이름으로 id 찾기
   (modules/company-tab.js에서 옮겼다 — 탭 화면 파일에 기대지 않게)
═══════════════════════════════════════════════════════════════ */

import { COMPANY_SECTORS, ORGS, API_BASE_URL, currentUser, findOrgByName } from '../state.js';
import { postToSheet } from '../api.js';
import { normalizeCompanyKey, abbrOf } from './org-names.js';

/* ══════════════════════════════════════════
   업종 원문값 → 표준 섹터 추천

   기업은 대개 한 곳씩 손으로 넣지 않고 참가사 명단을 통째로 올려 들어온다.
   그 명단의 업종 칸은 보내 준 쪽이 쓴 그대로다 — 'CRO', 'Clinical CRO',
   'IT Soultion'(오타), 'Central Lab.'. 이걸 그대로 받으면 표준 목록을 만든
   의미가 없어진다. 실제로 지금 데이터가 그렇게 흩어졌다.

   그래서 올릴 때 대조한다. 완전히 같으면 바로, 표기만 다르면(대소문자·공백·
   점·괄호) 같은 것으로, 흔한 표현은 별칭표로 옮긴다. 무엇으로도 안 걸리면
   추천하지 않는다 — 찍어서 넣는 것보다 비워 두고 사람이 고르는 편이 낫다.
══════════════════════════════════════════ */
/* 비교용 정규화 — 'IT Solution', 'it-solution', 'IT  솔루션(주)'을 한 줄로 만든다 */
const secNorm = (v) => String(v || '').toLowerCase()
  .replace(/[\s·・._\-/()[\]{},&]+/g, '')
  .replace(/주식회사|㈜|inc|ltd/g, '');

/* 별칭 — 왼쪽은 정규화된 조각, 오른쪽은 표준 섹터 이름.
   위에서부터 먼저 걸리는 것을 쓴다(좁은 것을 위에 둔다: 'imagingcro'가
   'cro'보다 먼저 걸려야 영상·이미징까지 함께 붙는다). */
const SECTOR_ALIASES = [
  [['imagingcro', 'imaging', 'image', '영상', '이미징', '판독'], ['CRO', '영상·이미징']],
  [['rwecro', 'rwe', 'realworld'],                              ['CRO', '임상 IT·데이터']],
  [['cdro'],                                                    ['CRO', 'CDMO']],
  [['labcro'],                                                  ['CRO', '분석·중앙실험실']],
  [['smo', '임상시험지원', '시험기관지원'],                        ['SMO']],
  [['cro', '임상시험수탁', '수탁연구'],                            ['CRO']],
  [['cdmo', 'cmo', '위탁생산', '제조수탁'],                        ['CDMO']],
  [['centrallab', 'laboratory', 'labservice', 'lab', '분석', '실험실', '검체'], ['분석·중앙실험실']],
  [['itsolution', 'itsoultion', 'edc', 'ecoa', 'epro', 'dct', 'software', 'saas',
    'technologyvendor', 'digitalendpoint', 'datamanagement', '데이터', '솔루션', '플랫폼'], ['임상 IT·데이터']],
  [['hospital', '병원', '의료원', '의료기관'],                     ['의료기관']],
  [['pharma', 'pharmaceutical', 'biotech', 'bio', '제약', '바이오'], ['제약·바이오텍']],
  [['consulting', 'regulatory', 'ra', 'translation', '번역', '컨설팅', '규제', '인허가'], ['규제·컨설팅']],
  [['university', 'institute', 'academy', '대학', '연구소', '사업단'], ['대학·연구소']],
  [['association', 'society', 'foundation', '학회', '협회', '재단'], ['학회·협회']],
  [['government', 'ministry', 'public', '정부', '공공', '진흥원', '청'], ['정부·공공기관']],
  [['venturecapital', 'vc', 'investment', '투자', '벤처캐피탈'],    ['투자·금융']],
  [['media', 'press', '언론', '미디어', '기자'],                   ['미디어']],
  // ── 이벤트·MICE ──
  [['boothconstruction', 'booth', '부스', '시공', '전시장치'],      ['부스시공·전시장치']],
  [['audiovisual', 'av', '음향', '조명', '무대', '영상장비'],        ['무대·음향·조명']],
  [['rental', '렌탈', '렌털', '비품'],                             ['렌탈·비품']],
  [['printing', 'signage', '인쇄', '출력', '사인', '그래픽'],        ['그래픽·인쇄']],
  [['pco', 'peo', '행사대행', '대행사'],                           ['행사대행(PCO)']],
  [['convention', 'venue', '컨벤션', '전시장'],                    ['전시장·컨벤션']],
  [['catering', 'staffing', '케이터링', '인력', '의전'],            ['인력·의전']],
];

/* 원문 한 값 → 표준 섹터 이름 배열(없으면 빈 배열).
   why는 화면에 "어떻게 걸렸는지"를 보여주는 데 쓴다 — 자동으로 채운 값을
   사람이 훑을 때, 왜 그렇게 됐는지 없으면 믿고 넘기거나 전부 다시 본다. */
export function suggestSector(raw){
  const t = String(raw || '').trim();
  if(!t) return { names: [], why: '' };

  /* 'CRO, Lab, CDMO'처럼 한 칸에 여러 업종을 적어 보내는 곳이 많다. 쉼표·슬래시로
     갈라 각각을 찾아 합친다 — 통째로 보면 맨 앞 것만 걸려서 나머지를 잃는다.
     띄어쓰기로는 자르지 않는다('Lab CRO (GCLP-compliant)'가 조각나면 안 된다). */
  const parts = t.split(/[,/;+&]|·/).map(v => v.trim()).filter(Boolean);
  if(parts.length > 1){
    const union = [];
    parts.forEach(v => suggestSector(v).names.forEach(nm => { if(!union.includes(nm)) union.push(nm); }));
    if(union.length) return { names: union, why: '복합값' };
  }

  const n = secNorm(t);
  if(!n) return { names: [], why: '' };

  // 1) 등록된 섹터 이름과 같은가 (표기 차이는 무시)
  const exact = COMPANY_SECTORS.find(s => secNorm(s.name) === n);
  if(exact) return { names: [exact.name], why: '이름 일치' };

  // 2) 별칭표 — 좁은 것부터
  for(const [keys, names] of SECTOR_ALIASES){
    if(keys.some(k => n === k)) return { names, why: '별칭' };
  }
  /* 조각으로 걸러내기. 영문은 3글자부터(짧으면 엉뚱한 데 걸린다), 한글은
     2글자부터 본다 — '부스'·'음향'·'제약'처럼 두 글자가 그대로 업종인 말이 많다. */
  const long = (k) => /[가-힣]/.test(k) ? k.length >= 2 : k.length >= 3;
  for(const [keys, names] of SECTOR_ALIASES){
    if(keys.some(k => long(k) && n.includes(k))) return { names, why: '부분 일치' };
  }

  // 3) 등록된 섹터 이름을 품고 있는가 ('Global CRO Services' 같은 긴 원문)
  const part = COMPANY_SECTORS.find(s => secNorm(s.name).length >= 3 && n.includes(secNorm(s.name)));
  if(part) return { names: [part.name], why: '부분 일치' };

  return { names: [], why: '' };
}

/* ── 업로드가 데려온 새 기업을 등록한다 ──
   전에는 기업이 연락처 소속 문자열에서 파생됐기 때문에, 업로드하면 기업이
   저절로 "생겼다". 이제 기업은 저장된 레코드라 없으면 만들어 줘야 한다.
   만들지 않으면 연락처만 들어오고 기업DB에서는 통째로 빠져 보인다.

   이름(옛 이름 포함)으로 먼저 찾아보고 없는 것만 만든다 — 같은 회사가 표기만
   다르게 두 번 등록되는 걸 막는다. id는 서버가 만들어 주므로 저장 후 다시
   읽어와 이름 → id 표를 돌려준다. */
export async function ensureOrgsForNames(names, kind, sectorsByName){
  /* sectorsByName: 이름 → 'CRO|임상 IT·데이터'. 업로드가 넘겨 준다.
     전에는 새 기업이 전부 업종 빈칸으로 들어왔다 — 명단에 업종이 적혀 있어도
     그 값은 연락처(beat)에만 붙고 기업에는 닿지 않았다. 그래서 기업DB의
     '미분류'가 계속 쌓였다. */
  const secOf = (nm) => {
    if(!sectorsByName) return '';
    const m = sectorsByName instanceof Map ? sectorsByName : new Map(Object.entries(sectorsByName));
    return String(m.get(nm) || '').trim();
  };
  const table = new Map();   // 정규화 이름 → org id
  const missing = new Map(); // 정규화 이름 → 원문(대표 표기)

  (names || []).forEach(raw => {
    const t = String(raw || '').trim();
    if(!t) return;
    const k = normalizeCompanyKey(t) || t.toLowerCase();
    if(table.has(k) || missing.has(k)) return;
    const found = findOrgByName(t, normalizeCompanyKey);
    if(found) table.set(k, found.id);
    else missing.set(k, t);
  });

  if(missing.size){
    const now = new Date().toISOString();
    const rows = [...missing.values()].map(nm => ({
      name_ko: /[가-힣]/.test(nm) ? nm : '', name_en: /[가-힣]/.test(nm) ? '' : nm,
      abbr: abbrOf(nm), aliases: '',
      kind: kind || '잠재고객사', status: '활성',
      sectors: secOf(nm), country: '', hq: '', website: '', biz_no: '', cat_code: '',
      notes: '', source: '업로드', created_at: now, updated_at: now,
    }));
    const r = await postToSheet({ sheet: 'orgs', action: 'batchUpsert', dataRows: rows }, '신규 기업 등록');
    if(!r.ok) return { ok: false, table };
    await reloadOrgs();
    missing.forEach((nm, k) => {
      const o = findOrgByName(nm, normalizeCompanyKey);
      if(o) table.set(k, o.id);
    });
  }
  /* 이미 등록돼 있던 기업이 업종 빈칸이면 이번 명단의 값으로 채운다.
     이미 적혀 있는 값은 덮지 않는다 — 손으로 골라 둔 것이 명단의 원문보다
     정확할 가능성이 높고, 덮어쓰면 그 판단이 조용히 사라진다. */
  const fill = [];
  if(sectorsByName){
    (names || []).forEach(raw => {
      const nm = String(raw || '').trim();
      const want = secOf(nm);
      if(!nm || !want) return;
      const o = findOrgByName(nm, normalizeCompanyKey);
      if(!o || String(o.sectors || '').trim()) return;
      o.sectors = want;
      fill.push({ id: o.id, sectors: want, updated_at: new Date().toISOString() });
    });
    if(fill.length) await postToSheet({ sheet: 'orgs', action: 'batchUpsert', dataRows: fill }, '기업 업종 채우기');
  }

  return { ok: true, table, created: missing.size, filled: fill.length };
}

/* 저장 직후 서버가 만든 id를 받아오려면 다시 읽어야 한다 */
export async function reloadOrgs(){
  if(!API_BASE_URL || !currentUser) return;
  const { safeFetch, authHeaders } = await import('../api.js');
  const rows = await safeFetch(API_BASE_URL + '/api/data?sheet=orgs', 'orgs', 1, await authHeaders());
  if(Array.isArray(rows)) ORGS.splice(0, ORGS.length, ...rows);
}

/* 연락처의 소속 이름으로 org id를 찾아준다 — 업로드/수동 추가가 함께 쓴다 */
export function orgIdForName(name){
  const o = findOrgByName(name, normalizeCompanyKey);
  return o ? o.id : '';
}
