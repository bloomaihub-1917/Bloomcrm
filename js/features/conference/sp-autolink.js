/* ──────────────────────────────────────────────────────────────────────────
   sp-autolink.js — 마스터DB에 연결 안 된 연사를 자동으로 잇는다

   참가자 목록(행사 DB)은 마스터DB 연락처의 참가 기록만 보여 준다. 그런데 연사 추가·
   프로그램 엑셀은 연락처 없이 연사만 만들어서, 연사 화면엔 있는데 참가자 목록엔
   없는 사람이 생겼다(4th Jump AI 15명 중 8명, 2026-11-11). 손으로 하나씩 «연결»을
   눌러야 했다.

   그래서 연사 화면·행사 DB를 열 때 그 행사의 연결 안 된 연사를 훑어
   - 마스터DB에 이름+소속이 같은 사람이 딱 한 명 → 그 사람에 잇는다
   - 없으면 → 연사에 적힌 값으로 새 연락처를 만들어 잇는다
   - 둘 이상(누군지 모름) → 건드리지 않는다(연사 창에서 골라 잇기)
   그 뒤 syncPartRole이 참가 기록(연사·VIP)을 만든다.
   ────────────────────────────────────────────────────────────────────────── */
import { contacts, nextContactId, speakersForEvent } from '../../state.js';
import { postToSheet } from '../../api.js';
import { saveSpeaker } from '../../api/conf-save.js';
import { ensureOrgsForNames, orgIdForName } from '../../domain/orgs.js';
import { trackAction } from '../../core/audit-log.js';
import { td } from '../../utils.js';
import { confLocked, syncPartRole } from './conf-common.js';

const normOrg = s => String(s || '').toLowerCase().replace(/\(주\)|㈜|\(재\)|주식회사|재단법인|\s|[().,]/g, '');
const normName = s => String(s || '').replace(/\s/g, '').toLowerCase();

function findSame(sp){
  const nk = normName(sp.name_snapshot), ne = normName(sp.name_en);
  const spOrgs = [sp.org_ko, sp.org_en].map(normOrg).filter(Boolean);
  if(!spOrgs.length) return [];   // 소속이 없으면 같은 사람인지 알 수 없다 — 새로 만든다
  return contacts.filter(c => {
    const nameHit = (nk && normName(c.nameKo) === nk) || (ne && normName(c.nameEn) === ne);
    if(!nameHit) return false;
    return [c.orgKo, c.orgEn].map(normOrg).filter(Boolean).some(o => spOrgs.includes(o));
  });
}

async function createContact(sp){
  const nameKo = String(sp.name_snapshot || '').trim(), nameEn = String(sp.name_en || '').trim();
  const c = {
    id: nextContactId(),   // CLAUDE.md — 16자리 이하
    nameKo, nameEn,
    orgKo: sp.org_ko || '', orgEn: sp.org_en || '',
    titleKo: sp.title_ko || '', titleEn: sp.title_en || '',
    deptKo: '', deptEn: '',
    country: sp.nationality || sp.residence_country || '', cat: 'speaker', lang: nameKo ? 'KO' : 'EN',
    source: `${sp.event_id || ''} 연사`, date: td(), status: 'new',
    email1: '', email2: '', phone1: '', phone2: '',
    beat: '', products: '', tags: '', org_id: '',
  };
  const orgNm = (c.orgKo || c.orgEn).trim();
  if(orgNm){
    try { await ensureOrgsForNames([orgNm]); c.org_id = orgIdForName(orgNm) || ''; }
    catch(e){ console.warn('[sp-autolink] 기업 연결 실패:', e); }
  }
  const r = await postToSheet({
    sheet: 'contacts',
    row: [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
      c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2,
      c.beat, c.products, c.tags, c.org_id],
  }, '연사 마스터DB 자동 등록', { silent: true });
  if(!r || !r.ok) return null;
  contacts.push(c);
  return c;
}

/* 한 연사 — 이었으면 true */
export async function autoLinkSpeaker(sp){
  if(!sp || sp.contact_id || String(sp.id || '').startsWith('SP-tmp')) return false;
  if(!String(sp.name_snapshot || sp.name_en || '').trim()) return false;
  const same = findSame(sp);
  if(same.length > 1) return false;
  const c = same[0] || await createContact(sp);
  if(!c) return false;
  const res = await saveSpeaker({ id: sp.id, contact_id: String(c.id) });
  if(!res || res.ok === false) return false;
  sp.contact_id = String(c.id);
  trackAction('edit', '연사 자동 연결', sp.event_id || '',
    `${sp.name_snapshot || sp.name_en} → ${same.length ? '기존 연락처' : '새 연락처'}`, { kind: 'contact', id: String(c.id) });
  await syncPartRole(sp.id);
  return true;
}

/* 행사 하나 — 동시에 두 번 돌지 않게 */
const running = new Set();
const tried = new Set();   // 실패한 연사는 화면을 다시 그릴 때마다 또 보내지 않는다
export async function autoLinkEvent(evKey, onDone){
  if(!evKey || running.has(evKey) || confLocked()) return;
  /* 연사·연락처를 아직 못 읽었으면 다음에 */
  if(!contacts.length) return;
  const todo = speakersForEvent(evKey).filter(sp => !sp.contact_id && !sp.hidden && !String(sp.id || '').startsWith('SP-tmp') && !tried.has(sp.id));
  if(!todo.length) return;
  running.add(evKey);
  let n = 0;
  try { for(const sp of todo){ tried.add(sp.id); if(await autoLinkSpeaker(sp)) n++; } }
  catch(e){ console.warn('[sp-autolink]', e); }
  finally { running.delete(evKey); }
  if(n) onDone?.(n);
}
