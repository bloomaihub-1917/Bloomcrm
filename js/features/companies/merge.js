/* ══════════════════════════════════════════════════════════════
   features/companies/merge.js — 비슷한 기업 찾기와 기업 병합
   (modules/company-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { postToSheet } from '../../api.js';
import { deleteRoundMembers, saveAttempt, saveExhibitor, saveRoundMember } from '../../api/exh-save.js';
import { aiCompanyPairs } from '../../api/ai.js';
import { changed, removed as removedMeta, trackAction } from '../../core/audit-log.js';
import { buildCoDB } from '../../domain/co-db.js';
import { normalizeCompanyKey } from '../../domain/org-names.js';
import { applyOrgLocal, patchOrgFields } from '../../domain/org-save.js';
import { CONTACT_ATTEMPTS, CO_DB, EXHIBITORS, ORGS, ROUND_MEMBERS, contacts, getOrgById } from '../../state.js';
import { escAttr, escapeHtml, levenshteinDist } from '../../utils.js';
import { buildCoCAT, renderCoList } from '../../modules/company-tab.js';

/* ══════════════════════════════════════════
   유사 기업명 찾기 (자동 정규화로 못 잡는 오타/줄임말 등 후보를 찾아 수동 병합)
   (원본 3320~3413행) — 레벤슈타인 거리는 utils.js의 levenshteinDist를 재사용
══════════════════════════════════════════ */
export function findSimilarCompanyPairs(){
  /* 이름끼리 견준다. 전에는 c.key를 견줬는데, 기업이 레코드가 된 뒤로 key는 기업 id
     (O-1789709803776_bio4)라서 id 끝자리만 다른 아무 기업이나 «유사도 95%»로 나왔다.
     국문은 국문끼리, 영문은 영문끼리 — 둘 중 더 가까운 쪽을 쓴다. */
  const items = CO_DB.map(c => ({ c, names: [c.nameKo, c.nameEn].map(normalizeCompanyKey) }))
    .filter(x => x.names.some(n => n.length >= 3));
  const pairs = [];
  for(let i=0; i<items.length; i++){
    for(let j=i+1; j<items.length; j++){
      const a = items[i], b = items[j];
      let best = null;
      for(let k=0; k<2; k++){
        const x = a.names[k], y = b.names[k];
        if(x.length < 3 || y.length < 3) continue;
        const maxLen = Math.max(x.length, y.length);
        const dist = levenshteinDist(x, y);
        const similarity = 1 - dist/maxLen;
        // 너무 짧은 이름은 오탐이 많아 임계치를 더 엄격하게
        const threshold = maxLen <= 5 ? 1 : (maxLen <= 8 ? 2 : 3);
        if(dist > 0 && dist <= threshold && similarity >= 0.75 && (!best || similarity > best)) best = similarity;
      }
      if(best) pairs.push({ a: a.c, b: b.c, similarity: best });
    }
  }
  return pairs.sort((x,y) => y.similarity - x.similarity).slice(0, 50);
}

export function renderSimilarCompanyList(){
  const el = document.getElementById('similar-co-list');
  if(!el) return;
  el.innerHTML = '<div style="font-size:12px;color:var(--i4)">검사 중...</div>';

  const pairs = findSimilarCompanyPairs();
  if(!pairs.length){
    el.innerHTML = '<div style="font-size:12px;color:var(--i4)">유사한 기업명 후보를 못 찾았어요.</div>';
    return;
  }

  el.innerHTML = pairs.map(({a, b, similarity}) => `
    <div style="background:var(--W);border:1px solid var(--i6);border-radius:8px;padding:10px 12px">
      <div style="font-size:11px;color:var(--i4);margin-bottom:6px">유사도 ${Math.round(similarity*100)}%</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:120px;font-size:13px;font-weight:600">${escapeHtml(a.nameKo||a.nameEn)} <span style="font-size:11px;color:var(--i4);font-weight:400">(${a.contacts.length}명)</span></div>
        <span style="color:var(--i4)">↔</span>
        <div style="flex:1;min-width:120px;font-size:13px;font-weight:600">${escapeHtml(b.nameKo||b.nameEn)} <span style="font-size:11px;color:var(--i4);font-weight:400">(${b.contacts.length}명)</span></div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn bp bs" onclick="mergeCompanies('${escAttr(b.key)}','${escAttr(a.key)}')">"${escapeHtml(a.nameKo||a.nameEn)}"로 합치기</button>
        <button class="btn bp bs" onclick="mergeCompanies('${escAttr(a.key)}','${escAttr(b.key)}')">"${escapeHtml(b.nameKo||b.nameEn)}"로 합치기</button>
        <button class="btn bs" onclick="this.closest('div[style*=\\'border-radius:8px\\']').remove()">다른 기업임</button>
      </div>
    </div>`).join('');
}

/* ── AI로 다른 표기 찾기 ──
   글자 거리로는 못 잡는 짝(한국엠에스디 ↔ MSD Korea, 엘지화학 ↔ LG Chem)을 Claude에게 묻는다.
   보내는 것은 기업 id와 국문·영문 이름뿐이다. 합치기는 위와 같은 mergeCompanies — 사람이 누른다. */
export async function aiFindCompanyPairs(){
  const el = document.getElementById('similar-co-list');
  if(!el) return;
  const known = CO_DB.map(c => ({ id: c.key, ko: c.nameKo || '', en: c.nameEn || '' })).filter(o => o.ko || o.en);
  el.innerHTML = `<div style="font-size:12px;color:var(--i4)">✨ 기업 ${known.length}곳을 AI가 살펴보는 중… (1분쯤 걸릴 수 있어요)</div>`;
  const r = await aiCompanyPairs({ known });
  if(!r.ok){ el.innerHTML = `<div style="font-size:12px;color:var(--re)">AI로 찾지 못했어요: ${escapeHtml(r.error || '')}</div>`; return; }
  const pairs = (r.pairs || []).map(p => ({ ...p, A: CO_DB.find(c => c.key === p.a), B: CO_DB.find(c => c.key === p.b) })).filter(p => p.A && p.B);
  if(!pairs.length){ el.innerHTML = '<div style="font-size:12px;color:var(--i4)">✨ AI도 같은 회사로 보이는 짝을 못 찾았어요.</div>'; return; }
  const nm = (c) => escapeHtml(c.nameKo || c.nameEn);
  el.innerHTML = pairs.map(({ A, B, reason, caution }) => `
    <div style="background:var(--W);border:1px solid var(--i6);border-radius:8px;padding:10px 12px">
      <div style="font-size:11px;color:var(--i4);margin-bottom:6px">✨ AI 추천 — ${escapeHtml(reason)}</div>
      ${caution ? `<div style="font-size:11px;color:var(--am);margin-bottom:6px">⚠️ ${escapeHtml(caution)}</div>` : ''}
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="flex:1;min-width:120px;font-size:13px;font-weight:600">${nm(A)} <span style="font-size:11px;color:var(--i4);font-weight:400">${A.nameKo && A.nameEn ? escapeHtml(A.nameEn) + ' · ' : ''}(${A.contacts.length}명)</span></div>
        <span style="color:var(--i4)">↔</span>
        <div style="flex:1;min-width:120px;font-size:13px;font-weight:600">${nm(B)} <span style="font-size:11px;color:var(--i4);font-weight:400">${B.nameKo && B.nameEn ? escapeHtml(B.nameEn) + ' · ' : ''}(${B.contacts.length}명)</span></div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="btn bp bs" onclick="mergeCompanies('${escAttr(B.key)}','${escAttr(A.key)}')">"${nm(A)}"로 합치기</button>
        <button class="btn bp bs" onclick="mergeCompanies('${escAttr(A.key)}','${escAttr(B.key)}')">"${nm(B)}"로 합치기</button>
        <button class="btn bs" onclick="this.parentElement.parentElement.remove()">다른 기업임</button>
      </div>
    </div>`).join('');
}

/* ══════════════════════════════════════════
   mergeCompanies — 기업 병합 (원본에는 "mergeCoInto"라는 이름이 없었고
   실제 이름은 mergeCompanies였음. 핵심 로직/저장 방식 변경 없음. 원본 3381~3413행)
══════════════════════════════════════════ */
export async function mergeCompanies(loserKey, winnerKey){
  const winner = CO_DB.find(c => c.key === winnerKey);
  const loser  = CO_DB.find(c => c.key === loserKey);
  if(!winner || !loser || winner.key === loser.key) return;
  const wOrg = getOrgById(winner.key), lOrg = getOrgById(loser.key);
  const lName = loser.nameKo || loser.nameEn, wName = winner.nameKo || winner.nameEn;
  if(!confirm(`"${lName}"(${loser.contacts.length}명) 을(를) "${wName}"로 합칠까요?\n`
    + `소속 연락처·전시 참가 기록이 "${wName}"로 옮겨지고, "${lName}"는 옛 이름으로 남은 뒤 기업 목록에서 지워집니다.`)) return;

  /* 이름만 바꾸면 합쳐지지 않는다. 기업DB는 org_id로 사람을 묶기 때문에(buildCoDB)
     전에는 이름이 바뀐 뒤에도 연락처가 진 쪽 기업에 그대로 매달려, «합쳤어요» 뒤에도
     두 기업이 그대로 보였다. 연결(org_id)을 이긴 쪽으로 옮기는 게 본체다. */
  const changed = [];
  const backup = []; // 저장 실패 시 롤백용 (원래 orgKo/orgEn/org_id)
  loser.contacts.forEach(pc => {
    const c = contacts.find(x => x.id === pc.id);
    if(!c) return;
    backup.push({ c, orgKo: c.orgKo, orgEn: c.orgEn, org_id: c.org_id });
    if(c.orgKo) c.orgKo = winner.nameKo || c.orgKo;
    if(c.orgEn) c.orgEn = winner.nameEn || c.orgEn;
    if(!c.orgKo && winner.nameKo) c.orgKo = winner.nameKo;
    if(!c.orgEn && winner.nameEn) c.orgEn = winner.nameEn;
    if(wOrg) c.org_id = winner.key;
    changed.push(c);
  });

  if(changed.length){
    const rows = changed.map(c => [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
      c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2, c.beat, c.products, c.tags||'', c.org_id||'']);
    const r = await postToSheet({ sheet: 'contacts', action: 'batchUpsert', rows }, '기업 병합');
    if(!r.ok){
      // 저장 실패 → 로컬 변경 롤백 (기존엔 실패해도 "합쳤어요"가 떠서 새로고침 시 원복되는 거짓 성공이었음)
      backup.forEach(b => { b.c.orgKo = b.orgKo; b.c.orgEn = b.orgEn; b.c.org_id = b.org_id; });
      buildCoDB(); buildCoCAT();
      try { renderCoList(); } catch(e){}
      alert('병합 저장에 실패해서 취소했어요. 네트워크 확인 후 다시 시도해주세요.');
      return;
    }
  }

  /* 기업 레코드가 둘 다 있을 때만 아래를 한다 — 옛 이름 기반 기업(ORGS에 없는 것)은
     연락처 이름만 바꾸면 끝이었다. */
  const fails = [];
  if(wOrg && lOrg){
    /* 전시 참가·시공 기록도 org_id로 묶인다 — 안 옮기면 진 쪽 기업을 지우는 순간
       그 거래 이력이 어느 기업에도 안 붙는다. */
    const exhMoved = [];
    for(const x of EXHIBITORS){
      const patch = { id: x.id };
      if(x.org_id === loser.key) patch.org_id = winner.key;
      if(x.builder_org_id === loser.key) patch.builder_org_id = winner.key;
      if(Object.keys(patch).length === 1) continue;
      const r = await saveExhibitor(patch);
      if(r && r.ok !== false){ Object.assign(x, patch); exhMoved.push(x.id); }
      else fails.push(`전시 참가 ${x.company_name || x.id}`);
    }

    /* 컨택 차수 명단·DM·TM 기록도 org_id로 묶인다 — 안 옮기면 진 쪽 기업을 지운 뒤 명단 줄이
       없는 기업을 가리켜 담당자가 안 보이고, 이긴 쪽에서는 연락 이력이 안 보인다.
       같은 차수에 두 기업이 다 있으면 진 쪽 줄의 기록을 이긴 쪽 줄로 옮기고 진 쪽 줄을 지운다 */
    for(const m of ROUND_MEMBERS.filter(m => m.org_id === loser.key)){
      const keep = ROUND_MEMBERS.find(w => w.round_id === m.round_id && w.org_id === winner.key);
      const memberId = keep ? keep.id : m.id;
      for(const a of CONTACT_ATTEMPTS.filter(a => a.member_id === m.id || (a.round_id === m.round_id && a.org_id === loser.key))){
        const patch = { id: a.id, member_id: memberId, org_id: winner.key };
        const r = await saveAttempt(patch);
        if(r && r.ok !== false) Object.assign(a, patch); else fails.push(`컨택 기록 ${a.id}`);
      }
      if(keep){
        if(fails.length) continue;   // 기록을 다 못 옮겼으면 진 쪽 줄을 남긴다
        const r = await deleteRoundMembers([m.id]);
        if(r && r.ok !== false){ const i = ROUND_MEMBERS.indexOf(m); if(i >= 0) ROUND_MEMBERS.splice(i, 1); }
        else fails.push('컨택 명단 정리');
      } else {
        const r = await saveRoundMember({ id: m.id, org_id: winner.key });
        if(r && r.ok !== false) m.org_id = winner.key; else fails.push('컨택 명단');
      }
    }
    // 차수 명단 밖 기록(옛 엑셀 가져오기 등)
    for(const a of CONTACT_ATTEMPTS.filter(a => a.org_id === loser.key)){
      const r = await saveAttempt({ id: a.id, org_id: winner.key });
      if(r && r.ok !== false) a.org_id = winner.key; else fails.push(`컨택 기록 ${a.id}`);
    }

    /* 진 쪽 이름은 이긴 쪽의 옛 이름(aliases)으로 남긴다 — 다음 업로드에 옛 표기가
       들어와도 findOrgByName이 이긴 쪽으로 이어 준다. */
    const have = new Set([wOrg.name_ko, wOrg.name_en, ...String(wOrg.aliases || '').split('\n')]
      .map(v => String(v || '').trim()).filter(Boolean));
    const add = [lOrg.name_ko, lOrg.name_en, ...String(lOrg.aliases || '').split('\n')]
      .map(v => String(v || '').trim()).filter(v => v && !have.has(v));
    const aliasesBefore = wOrg.aliases || '';
    if(add.length){
      const next = [...String(aliasesBefore).split('\n').map(v => v.trim()).filter(Boolean), ...add].join('\n');
      const r = await patchOrgFields(winner.key, { aliases: next });
      if(!r || r.ok === false){ applyOrgLocal({ id: winner.key, aliases: aliasesBefore }); fails.push('옛 이름 추가'); }
    }

    /* 옮길 것을 다 옮겼을 때만 진 쪽 기업을 지운다. 하나라도 남았으면 지우지 않는다 —
       지우면 남은 줄이 없는 기업을 가리키게 된다. */
    if(!fails.length){
      const gone = { ...lOrg };
      const r = await postToSheet({ sheet: 'orgs', action: 'delete', row: [loser.key] }, '기업 병합');
      if(r && r.ok !== false){
        const i = ORGS.findIndex(o => o.id === loser.key);
        if(i >= 0) ORGS.splice(i, 1);
        trackAction('edit', '기업 병합', wName,
          `<b>${escapeHtml(lName)}</b> → <b>${escapeHtml(wName)}</b> 병합 (연락처 ${changed.length}명, 전시 ${exhMoved.length}건 이동)`,
          removedMeta('orgs', loser.key, gone, { kind: 'company', id: winner.key }));
      } else fails.push('진 쪽 기업 삭제');
    }
  }

  buildCoDB(); buildCoCAT();
  try { renderCoList(); } catch(e){}
  renderSimilarCompanyList();
  if(fails.length){
    alert(`연락처는 "${wName}"로 옮겼지만 일부가 저장되지 않았어요: ${fails.join(', ')}\n`
      + `"${lName}" 기업은 지우지 않고 남겨 뒀어요. 네트워크 확인 후 다시 합쳐주세요.`);
    return;
  }
  alert(`"${lName}"를 "${wName}"로 합쳤어요.`);
}
// 계획서에서 언급한 이름과의 호환을 위한 별칭 (핵심 로직은 mergeCompanies와 동일)
export { mergeCompanies as mergeCoInto };

/* 화면의 onclick이 부르는 것 */
window.mergeCompanies = mergeCompanies;
window.mergeCoInto = mergeCompanies;
window.renderSimilarCompanyList = renderSimilarCompanyList;
window.aiFindCompanyPairs = aiFindCompanyPairs;
