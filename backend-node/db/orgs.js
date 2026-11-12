/* ══════════════════════════════════════════
   소속 이름 → 기업DB(orgs) id — 연락처를 넣는 서버 코드·스크립트는 모두 이것을 쓴다
   (CLAUDE.md «연락처를 넣으면 기업DB에 잇는다»)

   2026-11-09·11-12 두 번, 연락처만 넣고 org_id를 비워 둔 스크립트·신청 확정 때문에
   Master DB에는 있는데 기업DB에는 없는 기업이 160명씩 생겼다. 화면(js/domain/orgs.js
   ensureOrgsForNames)은 이미 찾고·없으면 만드는데 서버 쪽엔 같은 길이 없었다.

   - 이름은 법인격((주)·주식회사 등)·공백·마침표·쉼표를 빼고 대소문자 없이 비교한다.
     국문명·영문명·약칭·옛 이름(aliases) 어느 것에 맞아도 같은 기업이다.
   - «A / B»처럼 소속 둘을 붙여 쓰면 앞의 것(주 소속)으로, 줄바꿈은 띄어쓰기로 본다.
   - «미국 FDA (FDA)»처럼 끝의 괄호 약칭은 빼고도 한 번 더 찾아본다.
   - 없으면 «잠재고객사»로 새로 만든다. 한 번 실행 안에서 같은 이름은 한 곳만 만든다.
══════════════════════════════════════════ */
const orgKey = s => String(s || '')
  .replace(/㈜|\(주\)|주식회사|\(재\)|재단법인|사단법인|\(사\)/g, '')
  .replace(/[\s.,]/g, '').toLowerCase();

/* 붙여 쓴 소속을 주 소속 하나로 */
function primaryOrgName(raw){
  let s = String(raw || '').replace(/\s*\n\s*/g, ' ').trim();
  if (/\s\/\s?|\s?\/\s/.test(s)) s = s.split(/\s*\/\s*/)[0].trim();
  // 국문은 «서울의대, 서울대병원»처럼 쉼표로도 붙여 쓴다(영문 «Co., Ltd.»는 그대로 둔다)
  if (/[가-힣]/.test(s) && s.includes(', ')) s = s.split(', ')[0].trim();
  // 소속 뒤의 진료과·부서 괄호 «(내분비대사내과)»는 기업 이름이 아니다
  s = s.replace(/\s*\([^)]*(과|부|팀|실|센터)\)\s*/g, ' ').replace(/\)\s*$/, m => (s.match(/\(/g) || []).length < (s.match(/\)/g) || []).length ? '' : m).trim();
  return s;
}
const dropParen = s => s.replace(/\s*\([^)]*\)\s*$/, '').trim();

const abbrOf = nm => /[가-힣]/.test(nm) ? nm.slice(0, 2)
  : nm.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();

/* client로 orgs를 한 번 읽어 두고 resolve(orgKo, orgEn) → org id를 돌려주는 함수를 만든다.
   resolve는 없는 기업을 같은 client(트랜잭션)로 만든다. */
async function orgResolver(client, { source = '연락처 소속', kind = '잠재고객사' } = {}){
  const by = new Map();
  const put = (n, o) => { const k = orgKey(n); if (k && !by.has(k)) by.set(k, o); };
  (await client.query('SELECT id, name_ko, name_en, abbr, aliases FROM orgs')).rows
    .forEach(o => [o.name_ko, o.name_en, ...String(o.aliases || '').split(/\n|,/)].forEach(n => put(n, o)));
  const base = Date.now(); let seq = 0;
  const created = [];

  async function resolve(orgKo, orgEn){
    const ko = primaryOrgName(orgKo), en = primaryOrgName(orgEn);
    if (!ko && !en) return '';
    const hit = [ko, en, dropParen(ko), dropParen(en)].map(orgKey).filter(Boolean).map(k => by.get(k)).find(Boolean);
    if (hit) return hit.id;
    const nameKo = /[가-힣]/.test(ko) ? ko : '', nameEn = nameKo ? en : (en || ko);
    const nm = nameKo || nameEn;
    const o = { id: `O-${base}_${++seq}`, name_ko: nameKo, name_en: nameEn };
    const now = new Date().toISOString();
    await client.query(`INSERT INTO orgs (id,name_ko,name_en,abbr,aliases,kind,status,sectors,country,hq,website,biz_no,cat_code,notes,source,created_at,updated_at)
      VALUES ($1,$2,$3,$4,'',$5,'활성','','','','','','','',$6,$7,$7)`, [o.id, nameKo, nameEn, abbrOf(nm), kind, source, now]);
    [nameKo, nameEn].forEach(n => put(n, o));
    created.push(o);
    return o.id;
  }
  resolve.created = created;
  return resolve;
}

module.exports = { orgResolver, orgKey, primaryOrgName };
