/* ══════════════════════════════════════════════════════════════
   features/exhibition/exh-ui.js — exh-tab.js의 화면 상태

   전에는 탭 파일 안의 let 변수였다. 다른 모듈은 import한 변수에 값을 다시 넣을 수 없어서
   «상태를 고치는 구획»을 다른 파일로 떼어 낼 수 없었다. 객체 속성은 어디서 고쳐도 모두가
   같은 값을 보므로, 상태를 여기 모아 두면 구획을 떼어도 동작이 그대로다.
   화면에만 쓰는 값이다 — 서버에 저장하지 않는다.
═══════════════════════════════════════════════════════════════ */
export const exhUi = {
  exhFilter: 'all',   // all | incomplete | ready | overdue | waiting | inquiry | billing | cancelled | refund
  stepWarnOpen: '',
  stepFil: null,   // { key, mode: 'done' | 'todo' }
  exhView: 'dash',   // dash | list | booth | equip | graphic | watch
  gView: 'base',   // base(기본 제공) | item(받을 파일) | kind(품목별) | co(기업별 진행) | self(독립부스)
  gFil: 'all',   // all | todo | late | none | got
  payFil: 'all',   // all | paid | partial | unpaid | none — 금액 현황의 기업별 세부
  baseFil: '',
  boothTypeFil: '',
  boothShown: { rows: [], dupBooth: new Set(), typeFil: '' },
  equipOpen: new Set(),
  equipScope: 'all',
  bookDragId: '',
  baseSel: new Set(),
  baseSelEvent: '',
  exhAddPickedOrg: '',
};
