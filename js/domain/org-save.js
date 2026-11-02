/* ══════════════════════════════════════════════════════════════
   domain/org-save.js — 기업 저장 — orgs 표에 바뀐 칸만 보낸다
   (modules/company-tab.js에서 옮겼다 — 탭 화면 파일에 기대지 않게)
═══════════════════════════════════════════════════════════════ */

import { getOrgById } from '../state.js';
import { postToSheet } from '../api.js';
import { joinSectors } from './sectors.js';
import { buildCoDB } from './co-db.js';

/* ══════════════════════════════════════════
   기업 저장 — orgs 테이블

   전에는 companies 시트에 "정규화된 이름"을 키로 저장했다. 이름을 고치면 키가
   바뀌어 옛 키의 값이 고아가 됐다(실제로 그렇게 섹터·메모를 잃은 적이 있다).
   이제 id로 저장하므로 이름은 그냥 하나의 필드다.

   부분 저장(data)을 쓴다 — 섹터만 고칠 때 메모까지 함께 실어 보내지 않으므로,
   두 화면에서 동시에 다른 필드를 고쳐도 서로를 덮어쓰지 않는다.
══════════════════════════════════════════ */
const ORG_FIELDS = {
  nameKo:'name_ko', nameEn:'name_en', abbr:'abbr', kind:'kind', orgStatus:'status',
  country:'country', hq:'hq', website:'website', bizNo:'biz_no', catCode:'cat_code',
  notes:'notes', products:'products', phone:'phone', email:'email', source:'source',
  address:'address', intro:'intro',
};

/* 화면용 기업 객체(c)에서 바뀐 필드만 서버 컬럼명으로 옮겨 담는다.
   fields를 주면 그 필드만, 안 주면 전부 보낸다. */
function orgPatch(c, fields){
  const patch = { id: c.key, updated_at: new Date().toISOString() };
  const keys = fields || Object.keys(ORG_FIELDS);
  keys.forEach(k => { if(ORG_FIELDS[k]) patch[ORG_FIELDS[k]] = c[k] || ''; });
  if(!fields || fields.includes('sectors')) patch.sectors = joinSectors(c.sectors || []);
  if(!fields || fields.includes('aliases')) patch.aliases = (c.aliases || []).join('\n');
  return patch;
}

/* 로컬 ORGS 레코드도 함께 맞춰둔다 — 다음 buildCoDB가 이걸 읽는다 */
function applyOrgLocal(patch){
  const o = getOrgById(patch.id);
  if(o) Object.assign(o, patch);
}

export async function upsertCompanyRow(c, fields){
  const patch = orgPatch(c, fields);
  applyOrgLocal(patch);
  c.updatedAt = patch.updated_at;
  return postToSheet({ sheet: 'orgs', action: 'upsert', data: patch }, '기업 정보 저장');
}

/* 다른 화면(참가기업 서랍 등)에서 기업 DB의 칸 몇 개만 고칠 때 — 서버 컬럼명 그대로 받는다 */
export async function patchOrgFields(orgId, cols){
  const patch = { id: orgId, ...cols, updated_at: new Date().toISOString() };
  applyOrgLocal(patch);
  buildCoDB();
  return postToSheet({ sheet: 'orgs', action: 'upsert', data: patch }, '기업 정보 저장');
}

/* 여러 기업을 한 번에 저장 — 업로드 직후처럼 수십~수백 개를 저장할 때
   기업마다 개별 POST를 보내면 요청이 몰려 일부가 실패한다. 한 번으로 묶는다. */
/* fieldsOf(c) — 그 기업에서 보낼 칸 목록. 없으면(undefined) 통째로 보낸다(새 기업). */
export async function batchUpsertCompanies(companies, fieldsOf){
  if(!companies.length) return;
  const rows = companies.map(c => { const p = orgPatch(c, fieldsOf && fieldsOf(c)); applyOrgLocal(p); c.updatedAt = p.updated_at; return p; });
  return postToSheet({ sheet: 'orgs', action: 'batchUpsert', dataRows: rows }, '기업 일괄 저장');
}
