/* ══════════════════════════════════════════════════════════════
   api/conf-save.js — 컨퍼런스·연사 저장 (기타 설정 저장 포함)
   (api.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { API_BASE_URL, CATMAPS, COMPANY_SECTORS, DOMAINS, EXH_CONTACTS, EXH_LOGS, MAIL_LIBRARY, PART_TYPES, SPEAKERS, SPEAKER_CONTACTS, SPEAKER_LOGS, TAGS, currentUser } from '../state.js';
import { sectorRowValues } from '../utils.js';
import { authHeaders, postToSheet, safeFetch } from '../api.js';

/* ══════════════════════════════════════════
   컨퍼런스 · 연사 저장

   전시와 같은 방식이다 — 칸이 많고 부분 수정(체크 하나)이 잦아 위치 배열 대신
   객체형(upsertPartial)을 쓴다. 서버가 넘어온 키만 갱신하므로 바뀐 칸만 보내면
   나머지는 그대로 남는다. 위치 배열로 보내면 안 보낸 칸이 비워진다.
══════════════════════════════════════════ */
const upsertPartial = (sheet, data, label) =>
  postToSheet({ sheet, action: 'upsertPartial', data }, label);
const removeRow = (sheet, id, label) =>
  postToSheet({ sheet, action: 'delete', row: [id] }, label);

export const saveConfSession    = (r) => upsertPartial('conf_sessions', r, '세션');
export const deleteConfSession  = (id) => removeRow('conf_sessions', id, '세션 삭제');
export const saveSpeaker        = (r) => upsertPartial('speakers', r, '연사');
export const deleteSpeaker      = (id) => removeRow('speakers', id, '연사 삭제');
export const saveSessionSpeaker = (r) => upsertPartial('session_speakers', r, '세션 배정');
export const deleteSessionSpeaker = (id) => removeRow('session_speakers', id, '배정 해제');
export const saveSpeakerContact = (r) => upsertPartial('speaker_contacts', r, '연사 연락 상대');
export const deleteSpeakerContact = (id) => removeRow('speaker_contacts', id, '연락 상대 삭제');
export const saveSpeakerLog     = (r) => upsertPartial('speaker_logs', r, '연사 기록');
/* 연사·연사 기록만 다시 읽는다 — 서버가 직접 바꾼 뒤(보낸메일함 가져오기) 새로고침 없이
   화면에 보이게. 전부 다시 읽으면 열려 있는 화면 상태가 날아간다 */
export async function reloadSpeakerData(){
  if(!API_BASE_URL || !currentUser) return false;
  const base = API_BASE_URL + '/api/data?sheet=';
  const headers = await authHeaders();
  const [sp, logs] = await Promise.all([
    safeFetch(base + 'speakers', 'speakers', 1, headers),
    safeFetch(base + 'speaker_logs', 'speaker_logs', 1, headers),
  ]);
  if(Array.isArray(sp)) SPEAKERS.splice(0, SPEAKERS.length, ...sp);
  if(Array.isArray(logs)) SPEAKER_LOGS.splice(0, SPEAKER_LOGS.length, ...logs);
  // 받은 메일은 참가사 기록에도 들어간다
  const [xl, sc, xc] = await Promise.all([
    safeFetch(base + 'exhibitor_logs', 'exhibitor_logs', 1, headers),
    // 주인 없는 메일을 연결하면 연락 상대·담당자가 새로 생긴다
    safeFetch(base + 'speaker_contacts', 'speaker_contacts', 1, headers),
    safeFetch(base + 'exhibitor_contacts', 'exhibitor_contacts', 1, headers),
  ]);
  if(Array.isArray(xl)) EXH_LOGS.splice(0, EXH_LOGS.length, ...xl);
  if(Array.isArray(sc)) SPEAKER_CONTACTS.splice(0, SPEAKER_CONTACTS.length, ...sc);
  if(Array.isArray(xc)) EXH_CONTACTS.splice(0, EXH_CONTACTS.length, ...xc);
  return Array.isArray(sp) && Array.isArray(logs);
}
export const deleteSpeakerLog   = (id) => removeRow('speaker_logs', id, '연사 기록 삭제');


