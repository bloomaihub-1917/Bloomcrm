/* ══════════════════════════════════════════════════════════════
   features/conference/conf-common.js — 연사 공용 — 진행 완료 잠금, 동의 거절, 숨긴 연사, 식사·휴식 세션, 가져온 이력 확인 대기
   (modules/conf-tab.js에서 옮겼다 — 탭 화면 파일에 기대지 않게)
═══════════════════════════════════════════════════════════════ */

import { SESSION_SPEAKERS, evPartDone, assignmentsFor, getSpeakerById, participations, EXH_CFG } from '../../state.js';
import { postToSheet } from '../../api.js';
import { td } from '../../utils.js';
import { saveExhCfgToSheet } from '../../api/settings-save.js';
import { trackAction } from '../../core/audit-log.js';
import { makePartLock } from '../../core/part-lock.js';
import { SP_CONSENTS } from '../../constants.js';
import { reusePending } from '../../modules/contact-speaker.js';

/* 동의하지 않은 것 — 받은 날 체크만으로는 안 보인다 */
export const consentRefused = (sp) => SP_CONSENTS.filter(c => sp[c.key] === 'no').map(c => c.label);

/* 다른 행사에서 받아 온 이력·사진이 아직 확인 대기인가 */
export const reuseState = (sp, key, need) => reusePending(sp).some(g => g.key === key)
  ? { state: 'part', text: '가져옴 · 확인 대기', need } : null;

/* ══════════════════════════════════════════
   진행 완료 잠금

   전시의 exhLocked와 같은 이유다 — 끝난 행사의 프로그램이 조용히 바뀌면
   그때 무엇을 했는지가 지금 값으로 덮인다. 화면을 비활성하는 것만으로는
   인라인 핸들러나 콘솔로 값이 들어가므로, 저장 함수를 감싸는 자리를 둔다.
══════════════════════════════════════════ */
/* 연사 창은 컨퍼런스 탭 밖(연락처·감사 로그·CRM)에서도 열린다. 그때는 탭에서
   고른 행사가 아니라 «그 연사의 행사»로 잠금을 판단해야 한다 — 안 그러면 끝난
   행사의 연사가 고쳐지고, 반대로 진행 중인 연사가 막힌다. 창이 열려 있는 동안만 쓴다. */
/* 틀은 core/part-lock.js — 전시 잠금과 같은 코드다.
   창이 없을 때는 컨퍼런스 탭에서 고른 행사로 판단한다 — 탭이 onConfLockFallback으로 알려 준다.
   모두 함수 선언으로 둔다 — 컨퍼런스 탭 머리가 파일을 다 읽기 전에 guardConf(…)를 부른다. 잠금 틀은 처음 부를 때 만든다. */
function confLock(){ return confLock.v || (confLock.v = makePartLock({ part: 'conf', label: '컨퍼런스' })); }
export function setConfLockEv(v){ confLock().setLockEv(v); }
export function onConfLockFallback(fn){ confLock().onFallback(fn); }
export function confLocked(){ return confLock().locked(); }
export function confLockNotice(){ confLock().notice(); }
/* 쓰기 함수를 감싼다. 이 탭과 연사 드로어가 같은 행사를 다루므로 판단 기준이 한 군데여야 빠지는 길이 없다. */
export function guardConf(fn){ return confLock().guard(fn); }

/* 종류를 안 고르고 만든 «커피 브레이크»«만찬»도 식사·휴식으로 본다 — 엑셀에서
   종류 칸을 비우는 일이 잦다. 다만 연사가 배정된 세션은 제목이 어떻든 발표 세션이다. */
export const MEAL_TITLE = /브레이크|휴식|커피|오찬|점심|중식|만찬|디너|갈라|네트워킹|기념\s*촬영|단체\s*사진|등록|coffee\s*break|lunch|dinner|reception|networking|photo\s*session|group\s*photo|registration/i;

/* 숨기기 — 목록에서 접고 받을 항목에서 뺀다(지우지 않는다. 프로그램·배정은 그대로) */
export const isHiddenSp = (sp) => !!sp && sp.hidden === 'yes';

/* 식사·휴식 세션 — 종류를 골랐거나, 제목이 그렇고 배정된 연사가 없으면 */
export const isBreak = (s) => !!(s && (s.kind || (MEAL_TITLE.test(`${s.title_ko || ''} ${s.title_en || ''}`)
  && !SESSION_SPEAKERS.some(a => a.session_id === s.id))));

/* 연사 이름 — 스냅숏을 쓴다. 연락처가 지워져도 프로그램에서 이름이 사라지면
   안 되고, 연사명은 발표 당시 소속·직함과 함께 굳는 값이다. */
export const speakerName = (id) => {
  const sp = getSpeakerById(id);
  return sp ? (sp.name_snapshot || sp.name_en || '(이름 없음)') : '(삭제된 연사)';
};

/* 마스터DB의 참가 역할을 세션 역할에 맞춘다. 같은 사람이 어느 행사에선 VIP,
   어느 행사에선 연사라서 사람(cat)이 아니라 그 행사 참가 줄에 적는다.
   그 행사에서 맡은 자리가 모두 VIP면 VIP, 하나라도 발표·좌장 등이 있으면 연사.
   연사·VIP가 아닌 참가 줄(스폰서 등)은 건드리지 않는다. */
export async function syncPartRole(spId){
  const sp = getSpeakerById(spId);
  if(!sp || !sp.contact_id) return;
  const roles = assignmentsFor(spId).map(a => a.role);
  /* 세션 배정 전이어도 연사로 넣는다 — 배정을 기다리면 참가자 목록에서 빠진다 */
  const want = roles.length && roles.every(r => r === 'VIP') ? 'VIP' : '연사';
  const p = participations.find(x => String(x.contactId) === String(sp.contact_id)
    && x.eventId === sp.event_id && (x.role === '연사' || x.role === 'VIP'));
  if(!p){
    /* 참가 기록이 없으면 만든다 — 연사 화면이 정본이고 마스터DB는 따라온다 */
    const part = { id: `P-${Date.now()}-0`, eventId: sp.event_id, event: sp.event_id,
      // 참여 기록의 contactId는 숫자다(api.js가 +r.cid로 읽는다) — 문자열이면 === 비교에서 빠진다
      contactId: Number(sp.contact_id), contact: '', role: want, note: '', matched: '✅ 연사 화면에서 추가',
      // 확정된 연사는 참가 확정으로 — 아니면 타겟
      confirmedAt: sp.status === '확정' ? td() : '' };
    const r = await postToSheet({ sheet: 'participations',
      row: [part.id, part.eventId, '', part.contactId, '', '', '', part.role, part.note, part.matched, part.confirmedAt] },
      '행사 참가 추가', { silent: true });
    if(!r || !r.ok) return;
    participations.push(part);
    trackAction('edit', '행사 참가 추가', sp.event_id, `${speakerName(spId)} → ${want}`);
    return;
  }
  if(p.role === want) return;
  const was = p.role;
  const r = await postToSheet({ sheet: 'participations',
    row: [p.id, p.eventId, '', p.contactId, '', '', '', want, p.note || '', p.matched || '', p.confirmedAt || ''] },
    '행사 참가 역할', { silent: true });
  if(!r || !r.ok) return;
  p.role = want;
  trackAction('edit', '행사 참가 역할', sp.event_id, `${speakerName(spId)} — ${was} → ${want}`);
}

/* conf만 갈아 끼우고 나머지(parts·due·book)는 그대로 둔다 */
/* 컨퍼런스 설정 저장. 엑셀 업로드가 트랙·장소를 등록할 때도 이 길을 쓴다 —
   설정을 쓰는 자리가 둘이면 한쪽이 다른 키를 날린다. */
export async function saveConf(evKey, conf){
  const prev = EXH_CFG[evKey] ? JSON.parse(JSON.stringify(EXH_CFG[evKey])) : undefined;
  const cfg = { ...(prev || {}), conf };
  EXH_CFG[evKey] = cfg;
  const r = await saveExhCfgToSheet(evKey, cfg);
  if(r && r.ok === false){
    if(prev) EXH_CFG[evKey] = prev; else delete EXH_CFG[evKey];
    alert('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    window.renderEvDetail?.();   // 설정 › 행사 상세가 열려 있으면 되돌린 값으로 다시 그린다
    return false;
  }
  return true;
}
