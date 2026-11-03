/* ══════════════════════════════════════════════════════════════
   features/conference/speaker-drawer-ui.js — speaker-drawer.js의 화면 상태

   전에는 탭 파일 안의 let 변수였다. 다른 모듈은 import한 변수에 값을 다시 넣을 수 없어서
   «상태를 고치는 구획»을 다른 파일로 떼어 낼 수 없었다. 객체 속성은 어디서 고쳐도 모두가
   같은 값을 보므로, 상태를 여기 모아 두면 구획을 떼어도 동작이 그대로다.
   화면에만 쓰는 값이다 — 서버에 저장하지 않는다.
═══════════════════════════════════════════════════════════════ */
export const spDrUi = {
  spId: null,
  spTab: 'basic',
  pendingDraft: '',
  spFlowOpen: false,
  spAdvice: null,   // { spId, q, loading, err, ans:{summary,todo,caution}, saved }
  spWithCo: true,   // 공동연사가 있으면 기본으로 함께 — 다른 연사를 열면 다시 켠다
  spReply: null,
  spLocalFiles: [],
  spSkipDefault: new Set(),
  bulkPick: null,
  bulkPickFor: '',
  spTravelForce: false,
  bankRevealed: false,   // 드로어를 닫거나 다른 연사로 옮기면 다시 가린다
};
