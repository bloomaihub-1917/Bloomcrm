/* ══════════════════════════════════════════════════════════════
   features/upload/upload-ui.js — upload-tab.js의 화면 상태

   전에는 탭 파일 안의 let 변수였다. 다른 모듈은 import한 변수에 값을 다시 넣을 수 없어서
   «상태를 고치는 구획»을 다른 파일로 떼어 낼 수 없었다. 객체 속성은 어디서 고쳐도 모두가
   같은 값을 보므로, 상태를 여기 모아 두면 구획을 떼어도 동작이 그대로다.
   화면에만 쓰는 값이다 — 서버에 저장하지 않는다.
═══════════════════════════════════════════════════════════════ */
export const uploadUi = {
  upV: 'upload',
  evDirectMode: false,
  coNew: [],   // 기업DB에 없는 파일의 회사명
  coPairs: [],   // AI 추천 [{ a: 파일 이름, b: org id, reason, caution }]
  aiOn: false,
  aiAsked: false,
  lastHeaders: null,
  lastRows: null,
  lastColMap: null,
  catmapOn: false,
};
