/* ══════════════════════════════════════════════════════════════
   features/mdb/mdb-ui.js — db-tab.js의 화면 상태

   전에는 탭 파일 안의 let 변수였다. 다른 모듈은 import한 변수에 값을 다시 넣을 수 없어서
   «상태를 고치는 구획»을 다른 파일로 떼어 낼 수 없었다. 객체 속성은 어디서 고쳐도 모두가
   같은 값을 보므로, 상태를 여기 모아 두면 구획을 떼어도 동작이 그대로다.
   화면에만 쓰는 값이다 — 서버에 저장하지 않는다.
═══════════════════════════════════════════════════════════════ */
export const mdbUi = {
  mdbRegion: null,   // null | 'home' | 'abroad' | 'unknown' | 'c:<나라이름>'
  mdbSortCol: null,
  mdbSortDir: 1,   // 1 = 오름차순, -1 = 내림차순
  mdbRowOrder: [],   // 지금 그려진 줄의 id — 위에서 아래 순서
  mdbAnchorId: null,   // Shift의 기준이 되는, 마지막으로 그냥 누른 줄
  lpTimer: null,
  lpSwallowClick: false,
  mdbCtryOnly: false,
  mdbShowLeft: false,
  mdbAi: null,   // { q, plan }
  dragIds: [],
};
