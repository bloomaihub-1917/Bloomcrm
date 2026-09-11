/* ══════════════════════════════════════════════════════════════
   conf-import-spec.js — 컨퍼런스 엑셀 양식의 정의

   양식을 만드는 쪽(내려받기 버튼·스크립트)과 읽는 쪽(불러오기)이 같은
   정의를 본다. 두 군데에 적어 두면 열을 하나 더하는 순간 어긋나고,
   그때는 «양식대로 넣었는데 안 들어간다»가 된다.

   시트를 셋으로 나눈 이유는 데이터가 실제로 셋이기 때문이다.
     세션 — 언제 어디서 무엇을
     연사 — 누가 (사람 하나에 한 줄)
     배정 — 그 사람이 그 세션에서 무슨 역할로 (발제 정보가 여기 붙는다)

   한 장으로 받으면 두 세션에서 발표하는 사람이 두 줄이 되고, 그 사람의
   이력·계좌를 어느 줄에 적을지가 매번 달라진다.
═══════════════════════════════════════════════════════════════ */

/* key = 우리 칸 이름, label = 엑셀 머리글, hint = 안내 시트에 적을 설명 */
export const IMPORT_SHEETS = [
  {
    name: '세션',
    key: 'sessions',
    cols: [
      { key: 'date',      label: '일자',        hint: 'YYYY-MM-DD (예: 2026-10-16)' },
      { key: 'start_at',  label: '시작',        hint: 'HH:MM (예: 11:15)' },
      { key: 'end_at',    label: '종료',        hint: 'HH:MM' },
      { key: 'room',      label: '장소',        hint: '비우면 개막식처럼 전체 폭으로 그려집니다' },
      { key: 'track',     label: '트랙',        hint: '프로그램표의 색 띠가 됩니다' },
      { key: 'title_ko',  label: '세션명(국문)', hint: '국문·영문 중 하나는 있어야 합니다' },
      { key: 'title_en',  label: '세션명(영문)', hint: '' },
      { key: 'note',      label: '메모',        hint: '' },
    ],
    sample: [
      ['2026-10-16', '09:30', '10:00', '', '', '개회사', 'Opening Remarks', ''],
      ['2026-10-16', '11:15', '12:30', 'HALL C', 'Session 1A', '적응하는 도시', 'Adaptive Cities', ''],
      ['2026-10-16', '11:15', '12:30', 'HALL B', 'Session 1B', '새로운 영토의 건축가들', 'Architects in New Territories', ''],
    ],
  },
  {
    name: '연사',
    key: 'speakers',
    cols: [
      { key: 'name_snapshot', label: '성명',        hint: '프로그램에 나갈 이름. 배정 시트에서 이 이름으로 찾습니다' },
      { key: 'org_ko',        label: '소속(국문)',  hint: '발표 당시의 소속입니다' },
      { key: 'org_en',        label: '소속(영문)',  hint: '' },
      { key: 'title_ko',      label: '직함(국문)',  hint: '' },
      { key: 'title_en',      label: '직함(영문)',  hint: '' },
      { key: 'lang_pref',     label: '언어',        hint: '비움 / both(국·영문) / en(해외 연사, 영문만)' },
      { key: 'status',        label: '섭외 상태',   hint: '섭외중 / 확정 / 보류 / 취소 — 비우면 섭외중' },
      { key: 'email',         label: '메일',        hint: '적어 두면 연락 상대(수신)로 함께 만들어집니다' },
      { key: 'phone',         label: '전화',        hint: '' },
      { key: 'fee_amount',    label: '연사료',      hint: '숫자만 (예: 500000)' },
      { key: 'fee_currency',  label: '통화',        hint: 'KRW / USD — 비우면 KRW' },
      { key: 'note',          label: '메모',        hint: '' },
    ],
    sample: [
      ['정청수', '○○건축사사무소', 'OO Architects', '대표', 'Principal', 'both', '확정', 'chung@example.kr', '', '500000', 'KRW', ''],
      ['Eric Ho', '', 'Studio Ho', '', 'Founder', 'en', '섭외중', 'eric@example.com', '', '', '', '해외 연사'],
    ],
  },
  {
    name: '배정',
    key: 'assignments',
    cols: [
      { key: '_session',    label: '세션명',        hint: '세션 시트의 «세션명(국문)» 또는 «세션명(영문)»과 같아야 합니다' },
      { key: '_speaker',    label: '성명',          hint: '연사 시트의 «성명»과 같아야 합니다' },
      { key: 'role',        label: '역할',          hint: '연사 / 패널 / 좌장 / 사회' },
      { key: 'seq',         label: '순서',          hint: '세션 안에서의 차례. 비우면 적은 순서대로' },
      { key: 'start_at',    label: '발표 시작',      hint: 'HH:MM — 세션 시간이 아니라 이 사람이 올라가는 시각' },
      { key: 'end_at',      label: '발표 종료',      hint: 'HH:MM' },
      { key: 'duration_min', label: '길이(분)',      hint: '' },
      { key: 'lang',        label: '발표 언어',      hint: 'ko / en' },
      { key: 'title_ko',    label: '발제명(국문)',   hint: '좌장·사회는 비워 둡니다' },
      { key: 'title_en',    label: '발제명(영문)',   hint: '' },
      { key: 'note',        label: '메모',          hint: '' },
    ],
    sample: [
      ['적응하는 도시', '정청수', '좌장', '1', '11:15', '11:20', '5', 'ko', '', '', ''],
      ['적응하는 도시', 'Eric Ho', '연사', '2', '11:20', '11:50', '30', 'en', '', 'Adaptive Cities in Practice', ''],
    ],
  },
];

/* 안내 시트 — 양식만 보고도 채울 수 있게. 파일을 주고받다 보면 설명은
   메일에서 사라지고 파일만 남는다. */
export const IMPORT_GUIDE = [
  ['컨퍼런스 프로그램 업로드 양식'],
  [''],
  ['채우는 순서', '세션 → 연사 → 배정. 배정 시트가 앞의 두 시트를 이름으로 찾습니다.'],
  ['머리글', '1행은 고치지 마세요. 이 이름으로 칸을 찾습니다. 열 순서는 바뀌어도 됩니다.'],
  ['빈 칸', '비워 두면 그 값만 넘어갑니다. 나중에 화면에서 채우면 됩니다.'],
  ['이미 있는 것', '같은 이름의 세션·연사가 이미 있으면 새로 만들지 않고 그 줄을 씁니다.'],
  ['날짜·시각', '날짜는 2026-10-16, 시각은 11:15 형태로. 엑셀이 자동 서식을 걸면 «텍스트»로 바꿔주세요.'],
  ['장소', '비우면 개막식처럼 표에서 한 줄을 통째로 씁니다. 장소 순서(어디가 메인인지)는 설정 › 행사 관리 › 컨퍼런스에서 정합니다.'],
  ['역할', '연사 / 패널 / 좌장 / 사회. 역할에 따라 무엇을 받아야 하는지가 자동으로 정해집니다 — 좌장에게는 발제명·초록을 묻지 않습니다.'],
  ['지우지 않습니다', '올려도 기존 세션·연사를 지우지 않습니다. 더하거나 고칠 뿐이라, 잘못 올렸을 때 되돌릴 것이 남습니다.'],
];
