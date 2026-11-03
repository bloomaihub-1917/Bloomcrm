/* ══════════════════════════════════════════════════════════════
   features/conference/conf-ui.js — conf-tab.js의 화면 상태

   전에는 탭 파일 안의 let 변수였다. 다른 모듈은 import한 변수에 값을 다시 넣을 수 없어서
   «상태를 고치는 구획»을 다른 파일로 떼어 낼 수 없었다. 객체 속성은 어디서 고쳐도 모두가
   같은 값을 보므로, 상태를 여기 모아 두면 구획을 떼어도 동작이 그대로다.
   화면에만 쓰는 값이다 — 서버에 저장하지 않는다.
═══════════════════════════════════════════════════════════════ */
export const confUi = {
  confEvent: '',
  confView: 'dash',   // 'dash' | 'pga' | 'program' | 'people'
  confOpenSession: '',   // 배정 칸이 열려 있는 세션
  confEditSession: '',   // 수정 칸이 열려 있는 세션
  confNewSession: false,   // 세션 추가 칸이 열려 있나
  confNeedFil: null,   // {key, mode:'done'|'todo'} — 받을 것 칩으로 거르기
  confRoleFil: '',   // 역할로 거르기
  confShowHidden: false,   // 숨긴 연사도 보이기
  confSessFil: '',   // 세션으로 거르기
  confPhase: '',   // 'prep' 준비 | 'settle' 정산 — 비우면 행사 끝난 날로 정한다
  confSettleFil: '',   // 정산 거르기 'docs' 서류 남음 | 'unpaid' 미지급
  confShowNoFee: false,   // 정산에서 접은 «연사료 없음» 줄 펼치기
  confLayout: 'table',   // 준비 단계 보기 'table' 표 | 'cards' 사진 카드
  confCardFil: '',   // 카드 거르기 'ok' 다 받음 | 'part' 일부 | 'todo' 하나도 못 받음
  confVideoFil: '',   // 영상 게재 동의로 거르기 'yes' | 'no' | 'none'(미확인)
  dragAsgId: null,
};
