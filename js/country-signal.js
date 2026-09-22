/* ══════════════════════════════════════════════════════════════
   country-signal.js — 이 사람이 실제로 어디에 있나

   마스터DB의 «국가»는 사람의 칸인데, 실제로는 소속 기업의 국가가 그대로
   복사돼 들어온 경우가 많다. 97명 중 68명이 소속 기업과 똑같고, 다른 사람은
   한 명뿐이었다 — 사람마다 다 다를 리가 없는 숫자다.

   그래서 틀린 값이 조용히 쌓인다.
     · 「포트리아 코리아 유한회사」의 이준영 씨 — 국가가 «미국»
     · 「시믹코리아」의 박소은 씨 — 국가가 «일본»
     · 카탈란트의 Gilyun Yeo 씨 — 국가가 «미국», 전화는 +65 싱가포르
   초청장을 어느 시차에 맞춰 보낼지, 비자 안내가 필요한지, 어느 말로 쓸지가
   전부 이 칸에서 갈린다.

   ── 무엇으로 알아내나 ──
   자료에 이미 답이 있다. 전화번호의 국가번호와 이메일 주소의 국가 도메인은
   사람이 짐작으로 적은 값이 아니라, 그 사람이 실제로 쓰는 것이다.

     +65 9123 4567        → 싱가포르
     hong@company.co.kr   → 대한민국
     홍길동               → 대한민국 (한글 이름)

   ── 왜 고쳐 주지 않고 «확인하세요»만 하나 ──
   전화가 +82라고 그 사람이 한국 사람인 건 아니다. 한국 지사에 파견 나온
   외국인일 수도 있고, 한국 번호를 쓰는 교포일 수도 있다. 이 칸이 국적인지
   근무지인지도 쓰는 사람마다 다르게 본다.

   그래서 덮어쓰지 않는다. 어긋난 곳을 짚어 주기만 하고, 무엇이 맞는지는
   사람이 정한다. 자동으로 고쳤다가 틀리면, 틀렸다는 사실조차 안 보인다.
═══════════════════════════════════════════════════════════════ */

/* 전화 국가번호 — 긴 것부터 맞춰야 한다(+1과 +12는 다른 나라가 아니지만,
   +6과 +65는 다르다). 확실한 것만 담는다: +1은 미국과 캐나다가 함께 써서
   어느 쪽인지 못 가린다. */
const DIAL = {
  '82': '대한민국', '65': '싱가포르', '81': '일본', '86': '중국', '886': '대만',
  '852': '홍콩', '44': '영국', '49': '독일', '33': '프랑스', '61': '호주',
  '41': '스위스', '31': '네덜란드', '46': '스웨덴', '91': '인도', '972': '이스라엘',
  '971': '아랍에미리트', '84': '베트남', '66': '태국', '62': '인도네시아',
  '55': '브라질', '52': '멕시코', '34': '스페인', '39': '이탈리아',
  '63': '필리핀', '60': '말레이시아',
};

/* 이메일 국가 도메인. .com·.org·.net처럼 나라를 안 가리는 것은 담지 않는다.
   .co.kr / .com.sg 같은 두 겹짜리도 마지막 조각만 보면 된다. */
const TLD = {
  kr: '대한민국', sg: '싱가포르', jp: '일본', cn: '중국', tw: '대만', hk: '홍콩',
  uk: '영국', de: '독일', fr: '프랑스', au: '호주', ch: '스위스', nl: '네덜란드',
  se: '스웨덴', in: '인도', il: '이스라엘', ae: '아랍에미리트', vn: '베트남',
  th: '태국', id: '인도네시아', br: '브라질', mx: '멕시코', es: '스페인',
  it: '이탈리아', ph: '필리핀', my: '말레이시아', ca: '캐나다',
};

const dialCountry = (phone) => {
  const s = String(phone || '').replace(/[^0-9+]/g, '');
  if(!s.startsWith('+')) return null;          // 국가번호가 없으면 알 수 없다
  for(const len of [3, 2, 1]){
    const hit = DIAL[s.slice(1, 1 + len)];
    if(hit) return hit;
  }
  return null;
};

const tldCountry = (email) => {
  const m = String(email || '').toLowerCase().trim().match(/\.([a-z]{2})$/);
  return (m && TLD[m[1]]) || null;
};

/* 국가번호 없이 적힌 한국 번호. 국내에서 받은 명단은 «010-1234-5678»,
   «02-322-1297»처럼 국가번호를 떼고 적는다 — 그게 한국 번호라는 뜻인데,
   +82만 보면 국내 명단 전체가 «알 수 없음»으로 남는다.

   대표번호(1588·1544·15xx·16xx·18xx)도 한국에만 있는 모양이다. */
const KR_PHONE = /^(0(1[016789]|[2-6][0-4]?)\d{6,8}|1[5-8]\d{2}\d{4})$/;
const krPhone = (phone) => {
  /* 한 칸에 두 번호가 들어 있는 줄이 많다(«02-1234-5678 / 010-...»).
     조각마다 본다 — 앞 조각이 대표번호면 뒤 조각을 못 보고 지나친다. */
  return String(phone || '').split(/[/,·]/).some(part => {
    const s = part.replace(/[^0-9+]/g, '');
    if(!s || s.startsWith('+')) return false;   // 국가번호가 붙어 있으면 위에서 이미 봤다
    return KR_PHONE.test(s);
  }) ? '대한민국' : null;
};

/* 나라를 가리키는 무료 메일. 도메인이 .com이라 국가 도메인으로는 안 잡히는데,
   이 주소를 쓰는 사람은 거의 한국에서 일한다. */
const KR_MAIL = ['naver.com', 'hanmail.net', 'daum.net', 'nate.com', 'kakao.com',
  'korea.com', 'empas.com', 'dreamwiz.com', 'paran.com', 'hanmir.com'];
const krMail = (email) => {
  const s = String(email || '').toLowerCase();
  return KR_MAIL.some(d => s.includes('@' + d)) ? '대한민국' : null;
};

/* 웹주소의 국가 도메인 — 이메일과 같은 규칙이되, 경로가 붙어 있어(«pabloair.com/kr»)
   호스트 부분만 본다. */
const siteCountry = (site) => {
  const host = String(site || '').toLowerCase().trim()
    .replace(/^https?:\/\//, '').split(/[/\s]/)[0];
  const m = host.match(/\.([a-z]{2})$/);
  return (m && TLD[m[1]]) || null;
};

/* 이 사람이 어디 사람인지 자료가 말해 주는 것.
   전화 > 이메일 > 이름 > 소속 > 웹주소 순으로 믿는다 — 전화는 그 나라 번호를
   실제로 쓴다는 뜻이고, 이메일은 회사 도메인이라 본사 나라일 수 있으며, 이름과
   소속은 그보다 약하다. 웹주소는 사람이 아니라 회사의 것이라 맨 뒤에 둔다.

   국가번호가 붙은 번호를 국내 형식보다 먼저 본다 — 한 사람이 «+86 …»과
   «010 …»을 함께 적어 두는 경우(한국에 온 중국 업체 담당자)에, 국내 번호를
   먼저 보면 그 사람이 한국 사람이 되어 버린다. */
export function countryHint(c){
  if(!c) return null;
  const byPhone = dialCountry(c.phone1) || dialCountry(c.phone2);
  if(byPhone) return { country: byPhone, why: '전화번호 국가번호' };

  const byMail = tldCountry(c.email1) || tldCountry(c.email2);
  if(byMail) return { country: byMail, why: '이메일 국가 도메인' };

  const byKrPhone = krPhone(c.phone1) || krPhone(c.phone2);
  if(byKrPhone) return { country: byKrPhone, why: '국내 전화번호' };

  const byKrMail = krMail(c.email1) || krMail(c.email2);
  if(byKrMail) return { country: byKrMail, why: '국내 메일 주소' };

  if(/[가-힣]/.test(String(c.nameKo || ''))) return { country: '대한민국', why: '한글 이름' };
  if(/[가-힣]/.test(String(c.orgKo || '')))  return { country: '대한민국', why: '한글 소속명' };

  const bySite = siteCountry(c.website);
  if(bySite) return { country: bySite, why: '웹주소 국가 도메인' };
  return null;
}

/* 적힌 국가와 자료가 어긋나는가.
   - 'mismatch' 적혀 있는데 자료는 다른 나라를 가리킨다
   - 'empty'    비어 있는데 채울 근거가 있다
   - null       어긋나지 않거나, 판단할 자료가 없다

   소속 기업의 국가와 같은 값이면 더 의심스럽다 — 기업에서 복사된 값일
   가능성이 높다는 뜻이라, 화면에서 그 사실을 함께 말해 준다. */
export function countryCheck(c, orgCountry){
  const hint = countryHint(c);
  if(!hint) return null;
  const has = String(c.country || '').trim();
  if(!has) return { kind: 'empty', ...hint };
  if(has === hint.country) return null;
  return {
    kind: 'mismatch', ...hint, current: has,
    fromOrg: !!orgCountry && String(orgCountry).trim() === has,
  };
}

/* 조사는 받침을 보고 고른다 — «국가 도메인는», «대한민국를»처럼 어긋난 말은
   읽는 사람이 기계가 쓴 글로 여기게 되고, 그러면 내용도 덜 믿는다.
   한글이 아닌 글자(영문·숫자)로 끝나면 받침 없는 쪽을 쓴다. */
function josa(word, withBatchim, without){
  const ch = String(word || '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if(!(code >= 0xAC00 && code <= 0xD7A3)) return without;
  return (code - 0xAC00) % 28 ? withBatchim : without;
}
const eun = (w) => w + josa(w, '은', '는');
/* 다른 화면에서도 쓴다 — «미국예요»가 아니라 «미국이에요» */
export const ieyo = (w) => w + josa(w, '이에요', '예요');
const eul = (w) => w + josa(w, '을', '를');
const ro  = (w) => {                       // «미국으로» / «싱가포르로»
  const ch = String(w || '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  const bat = (code >= 0xAC00 && code <= 0xD7A3) ? (code - 0xAC00) % 28 : 0;
  return w + (!bat || bat === 8 ? '로' : '으로');   // 받침 ㄹ(8)은 «로»
};

export const countryCheckText = (r) => {
  if(!r) return '';
  if(r.kind === 'empty') return `국가가 비어 있어요 — ${eun(r.why)} ${eul(r.country)} 가리켜요`;
  return `국가가 «${r.current}»${ro(r.current).slice(r.current.length)} 적혀 있는데 ${eun(r.why)} ${eul(r.country)} 가리켜요`
    + (r.fromOrg ? ' (소속 기업 국가와 같아요 — 기업에서 따라온 값일 수 있어요)' : '');
};

/* ══════════════════════════════════════════
   대륙

   나라별로 늘어놓으니 1명짜리가 열두 줄이었다 — 대만 1, 독일 1, 스위스 1,
   싱가포르 1… 세어 볼 수는 있어도 «유럽에서 몇 명 오나»를 못 본다. 초청·항공·
   시차는 나라가 아니라 대륙 단위로 굴러간다.

   나라를 더 얹어도 여기만 고치면 된다. 못 찾은 나라는 «기타»로 보낸다 —
   빠뜨리는 것보다 한 줄에 모이는 게 낫다. */
export const CONTINENT = {
  대한민국:'아시아', 일본:'아시아', 중국:'아시아', 싱가포르:'아시아', 홍콩:'아시아',
  대만:'아시아', 인도:'아시아', 베트남:'아시아', 태국:'아시아', 인도네시아:'아시아',
  필리핀:'아시아', 말레이시아:'아시아',
  이스라엘:'중동', 아랍에미리트:'중동',
  미국:'북미', 캐나다:'북미',
  멕시코:'중남미', 브라질:'중남미',
  영국:'유럽', 독일:'유럽', 프랑스:'유럽', 네덜란드:'유럽', 스위스:'유럽',
  스웨덴:'유럽', 스페인:'유럽', 이탈리아:'유럽', 헝가리:'유럽',
  호주:'오세아니아', 뉴질랜드:'오세아니아',
};
/* 사이드바에 세울 차례 — 가까운 곳부터. 가나다순이면 «북미»가 맨 앞에 오는데,
   우리 일의 대부분은 아시아다. */
export const CONTINENT_ORDER = ['아시아', '북미', '유럽', '오세아니아', '중동', '중남미', '기타'];
export const continentOf = (countryKo) => CONTINENT[String(countryKo || '').trim()] || '기타';
