/* ══════════════════════════════════════════════════════════════
   features/settings/settings-ui.js — settings-tab.js의 화면 상태

   전에는 탭 파일 안의 let 변수였다. 다른 모듈은 import한 변수에 값을 다시 넣을 수 없어서
   «상태를 고치는 구획»을 다른 파일로 떼어 낼 수 없었다. 객체 속성은 어디서 고쳐도 모두가
   같은 값을 보므로, 상태를 여기 모아 두면 구획을 떼어도 동작이 그대로다.
   화면에만 쓰는 값이다 — 서버에 저장하지 않는다.
═══════════════════════════════════════════════════════════════ */
export const settingsUi = {
  draggedSectorId: null,
  sectorScope: '',   // '' = 공통, 그 외엔 EVENT_LIST[].short 값
  pendingSectorImport: null,   // { groups: [{ main, subs:[...] }] }
  archV: 'arch',
  clGroup: 'common',
  bInclRow: null,   // 지금 고치고 있는 부스 타입 행
  bInclLines: [],   // 편집 중인 목록 (저장을 눌러야 반영된다)
  eqKind: 'equip',   // 비품 / 그래픽 — 한 표에 함께 담겨 있다
  eqEvent: '',   // 보고 있는 행사
  eqCatFil: '',   // 분류 필터
  eqQuery: '',   // 검색어
  eqTarget: 'eqcat-rows',
  eqLockEv: '',
  evDetailKey: '',   // 보고 있는 행사 (빈 문자열 = 목록 뷰)
  evDetailSeg: 'basic',
  mailAccounts: null,
  evFooter: null,   // { evKey, text, img(미리보기 data URL), imgNew(새 이미지 | null=빼기 | undefined=그대로), imgType }
  inboxEv: '',
};
