// 라벨/색상/기준 데이터 — 여러 곳에 중복 정의되던 것을 이 파일 하나로 통합

/* ── 역할(participation role) 라벨/색상 맵 ──
   원본에서 RP/CP/CL은 contact_crm.html 1560~1562행이 정본.
   같은 값이 RP2/CL2(1891, 1973, 2137행)와 RP3/CL3(5631~5632행)라는
   이름으로 함수 내부에 그대로 복붙되어 있었음 — 값이 CP/CL과 완전히 동일하므로
   이 파일의 CP/CL을 import해서 쓰도록 통합(값 변경 없음). */
/* 참가 역할 → 배지색. 키는 PART_TYPES_SEED의 key와 정확히 같아야 한다 —
   어긋나면 조용히 p-gray로 떨어져 색이 빠진다(전시참가기업/비즈니스파트너링/주최사가
   그랬다). 옛 표기(전시기업/주최)도 남겨 과거 데이터를 함께 받는다. */
export const RP = {스폰서:'p-green',전시참가기업:'p-purple',연사:'p-blue',투자자:'p-amber',
  바이어:'p-teal',BD:'p-teal',기자:'p-red','기자/미디어':'p-red',참가자:'p-gray',VIP:'p-gold',
  주최사:'p-indigo',비즈니스파트너링:'p-amber',
  전시기업:'p-purple',주최:'p-indigo'};
export const CP = {speaker:'p-blue',sponsor:'p-green',investor:'p-amber',buyer:'p-teal',bd:'p-teal',exhibitor:'p-purple',press:'p-red',attendee:'p-gray',vip:'p-gold',organizer:'p-indigo'};
export const CL = {speaker:'연사',sponsor:'스폰서',investor:'투자자',buyer:'바이어',bd:'BD',exhibitor:'전시참가기업',press:'기자',attendee:'일반참가자',vip:'VIP',organizer:'주최'};
/* 카테고리 선택지 — 화면에서 고를 수 있는 순서대로.
   전에는 세 화면(연락처 추가·드로어 편집·일괄 변경)이 각자
   ['speaker','vip','attendee'] 셋만 하드코딩하고 있었다. 그래서 CL에는 있고
   데이터에도 54건이나 들어 있는 '전시참가기업'을 화면에서 고를 수가 없었다.
   목록을 한 곳에 두어 표시(CL)와 선택지가 갈라지지 않게 한다. */
export const CAT_KEYS = ['attendee', 'exhibitor', 'speaker', 'sponsor', 'buyer',
  'investor', 'bd', 'press', 'vip', 'organizer'];

export const SC = {미접촉:'#9C9890',컨택중:'#3B5BDB',협의중:'#C97B0A',확정:'#16A34A',보류:'#DC2626'};
export const LC = {이메일:'#6D28D9',전화:'#16A34A',미팅:'#3B5BDB',메모:'#9C9890',계약:'#16A34A'};
export const BG = ['#EEF2FF','#F0FDF4','#FFFBEB','#F5F3FF','#F0FDFA','#FEF2F2'];
export const FG = ['#3B5BDB','#16A34A','#C97B0A','#6D28D9','#0F766E','#DC2626'];
export const EC = ['#3B5BDB','#16A34A','#C97B0A','#6D28D9'];
export const STGS = ['타겟 등록','초기 컨택','제안서 발송','미팅','협의 중','계약 완료'];

/* 아바타 배경/전경 색상 인덱싱 헬퍼 (BG/FG 참조) */
export const avB = i => BG[i % 6];
export const avF = i => FG[i % 6];

/* participations.type(=role)의 한글 PART_TYPES 값 ↔ contacts.cat(영문 키) 매핑.
   cat은 speaker/vip/attendee 3분류만 쓰므로, VIP/연사를 제외한 모든 참가
   역할(BD/바이어/전시참가기업/스폰서/주최사/참가자 등)은 attendee로 묶인다.
   BD는 실제 데이터에서 attendee 대부분에 폭넓게 쓰이는 태그라, cat 자체를
   분리하면 attendee가 통째로 비어버린다 — 그래서 cat은 attendee로 유지하고,
   "BD" 필터/배지는 db-tab.js에서 참가 역할(role==='BD')만 별도로 검사하는
   식으로 attendee와 겹치는(비배타적) 보조 필터로 구현했다. */
export const ROLE_TO_CAT = {
  'VIP':'vip', '연사':'speaker', 'BD':'attendee', '바이어':'attendee',
  '전시참가기업':'exhibitor', '스폰서':'attendee', '주최사':'attendee', '참가자':'attendee',
  '비즈니스파트너링':'attendee',
};

/* ── EVENT_LIST 초기 시드 데이터 ──
   실제 EVENT_LIST는 시트에서 로드되어 state.js에서 배열 내용이 교체(splice)되는
   가변 상태이므로, state.js가 초기값으로 이 배열을 import해서 사용하도록
   "_SEED" 접미사로 구분해서 export함(원본 1603~1612행). */
export const EVENT_LIST_SEED = [
  {key:'KIC Silicon Valley 2025', short:'KIC SV 2025', color:'#3B5BDB', date:'2025-09'},
  {key:'CES 2025',                short:'CES 2025',    color:'#C97B0A', date:'2025-01'},
  {key:'GHC 2025',                short:'GHC 2025',    color:'#16A34A', date:'2025-03'},
  {key:'KIC New York 2025',       short:'KIC NY 2025', color:'#6D28D9', date:'2025-04'},
  {key:'KIC New York 2024',       short:'KIC NY 2024', color:'#818CF8', date:'2024-04'},
  {key:'KIC Silicon Valley 2024', short:'KIC SV 2024', color:'#0F766E', date:'2024-09'},
  {key:'KIC SF 2023',             short:'KIC SF 2023', color:'#9C9890', date:'2023-06'},
  {key:'KIC Silicon Valley 2023', short:'KIC SV 2023', color:'#9C9890', date:'2023-10'},
];

/* ── PART_TYPES 초기 시드 데이터 ──
   실제 PART_TYPES도 시트(part_types)에서 로드되어 내용이 교체(splice)되는
   가변 상태이므로 위와 같은 이유로 "_SEED" 접미사로 구분(원본 6337~6347행). */
export const PART_TYPES_SEED = [
  {key:'VIP',         label:'VIP',         cls:'p-gold'},
  {key:'연사',         label:'연사',         cls:'p-blue'},
  {key:'BD',          label:'BD',           cls:'p-teal'},
  {key:'바이어',        label:'바이어',        cls:'p-teal'},
  {key:'전시참가기업',   label:'전시참가기업',   cls:'p-purple'},
  {key:'스폰서',        label:'스폰서',        cls:'p-green'},
  {key:'비즈니스파트너링',label:'비즈니스파트너링',cls:'p-amber'},
  {key:'주최사',        label:'주최사',        cls:'p-indigo'},
  {key:'참가자',        label:'참가자',        cls:'p-gray'},
];

/* ── 국가 목록 (ISO 3166-1 표준, 자주 쓰는 순) ── */
export const COUNTRIES = [
  {code:'KR', nameKo:'대한민국', aliases:[
    '대한민국','한국','south korea','korea','republic of korea',
    'korea(south)','korea south','kr',
  ]},
  {code:'US', nameKo:'미국', aliases:[
    '미국','usa','us','u.s','u.s.a','u.s.a.','united states',
    'united states of america','the united states','america','us of a',
  ]},
  {code:'JP', nameKo:'일본',     aliases:['japan','일본']},
  {code:'CN', nameKo:'중국',     aliases:['china','중국','prc']},
  {code:'SG', nameKo:'싱가포르', aliases:['singapore','싱가포르']},
  {code:'HK', nameKo:'홍콩',     aliases:['hong kong','홍콩']},
  {code:'GB', nameKo:'영국',     aliases:['uk','united kingdom','great britain','영국','gb']},
  {code:'DE', nameKo:'독일',     aliases:['germany','deutschland','독일']},
  {code:'FR', nameKo:'프랑스',   aliases:['france','프랑스']},
  {code:'CA', nameKo:'캐나다',   aliases:['canada','캐나다']},
  {code:'AU', nameKo:'호주',     aliases:['australia','호주']},
  {code:'IN', nameKo:'인도',     aliases:['india','인도']},
  {code:'IL', nameKo:'이스라엘', aliases:['israel','이스라엘']},
  {code:'AE', nameKo:'아랍에미리트', aliases:['uae','united arab emirates','아랍에미리트']},
  {code:'NL', nameKo:'네덜란드', aliases:['netherlands','holland','netherland','네덜란드']},
  {code:'CH', nameKo:'스위스',   aliases:['switzerland','swiss','스위스']},
  {code:'SE', nameKo:'스웨덴',   aliases:['sweden','스웨덴']},
  {code:'TW', nameKo:'대만',     aliases:['taiwan','대만']},
  {code:'VN', nameKo:'베트남',   aliases:['vietnam','베트남']},
  {code:'TH', nameKo:'태국',     aliases:['thailand','태국']},
  {code:'ID', nameKo:'인도네시아', aliases:['indonesia','인도네시아']},
  {code:'BR', nameKo:'브라질',   aliases:['brazil','브라질']},
  {code:'MX', nameKo:'멕시코',   aliases:['mexico','멕시코']},
  {code:'ES', nameKo:'스페인',   aliases:['spain','스페인']},
  {code:'IT', nameKo:'이탈리아', aliases:['italy','이탈리아']},
  {code:'PH', nameKo:'필리핀',   aliases:['philippines','필리핀']},
  {code:'MY', nameKo:'말레이시아', aliases:['malaysia','말레이시아']},
  {code:'OTHER', nameKo:'기타',  aliases:[]},
];

/* ── EVENT_PARTS — 행사가 품는 파트(진행 여부) ──
   행사마다 무엇을 하는지가 다르다. 전시만 하는 행사가 있고, 컨퍼런스와
   파트너링을 같이 여는 행사도 있다. 전에는 이걸 적어 둘 곳이 없어서 화면이
   늘 전부 켜져 있었다.

   partTypes는 PART_TYPES_SEED의 key와 정확히 같아야 한다 — 나중에 파트별로
   명단을 걸러 보여줄 때 이 문자열로 잇는다.
   기본값(dflt)은 새 행사에 아무것도 안 정했을 때의 상태다. 전시는 이 앱이
   지금까지 해 온 일이라 켜 두고, 나머지는 정한 뒤에 켜게 한다. */
export const EVENT_PARTS = [
  { key:'exh',        label:'전시',     dflt:'doing', partTypes:['전시참가기업'] },
  { key:'conf',       label:'컨퍼런스',  dflt:'none',  partTypes:['연사','참가자'] },
  { key:'partnering', label:'파트너링',  dflt:'none',  partTypes:['비즈니스파트너링','바이어','BD'] },
  { key:'sponsor',    label:'후원',     dflt:'none',  partTypes:['스폰서'] },
];

/* ── 파트의 진행 상태 ──
   전에는 켜고 끄는 둘뿐이었다. 그런데 끝난 행사를 "안 함"으로 돌리면 없던 일이
   되고, "진행 중"으로 두면 끝난 기록을 계속 고칠 수 있다. 둘 다 틀리다.

   done은 지나간 일이라 열람만 된다. 잠그는 이유는 실수를 막으려는 것이지
   못 고치게 하려는 게 아니라서, 되돌리는 건 설정에서 한 번 누르면 된다
   (정산 입금이 늦게 들어오는 일이 실제로 있다). */
export const PART_STATES = [
  { key:'none',  label:'안 함',    cls:'p-gray'  },
  { key:'doing', label:'진행 중',  cls:'p-blue'  },
  { key:'done',  label:'진행 완료', cls:'p-green' },
];
export const partStateOf = (v) => PART_STATES.find(s => s.key === v) || PART_STATES[0];
