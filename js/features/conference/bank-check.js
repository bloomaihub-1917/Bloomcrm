/* ══════════════════════════════════════════════════════════════
   features/conference/bank-check.js — 연사 계좌 검수

   해외 송금은 칸 하나만 틀려도 은행에서 되돌아오고, 수수료는 그대로 나간다.
   2026 AIA에서 실제로 걸린 것들:
     - Eric Ho 계좌가 10자리라 «숫자가 빠졌나» 메일로 되물었다(홍콩 HSBC는 지점 3자리 포함 10자리가 맞았다)
     - Borden Tseng 은행 주소에 도시가 없었다(East District — 타이난)
     - Borden 예금주가 개인이 아니라 회사(Q-LAB)였다 — 인보이스가 필요했다
   BIO KOREA 2026 해외 지급대장에서도 같은 일이 있었다 — 회사 계좌(OY·LLC·INC)는
   인보이스 번호를 받았고, 미국 회사는 EIN을, 호주는 BSB를 따로 받았다.

   AI에 묻지 않는다. 계좌번호·예금주는 개인정보라 바깥으로 보내지 않기로 했고(2026-10-08),
   자릿수·검증숫자는 규칙으로 정확히 맞는지 틀리는지 가릴 수 있다.

   나라가 늘면 BANK_RULES에 한 줄 더한다. 각 규칙은 BK2026·AIA 2026에서 실제로 받은
   계좌로 맞춰 봤다(그 해에 받은 형식이 «정상»이다).

   돌려주는 것: [{ f: 칸 이름(speakers 칸), lv: 'err' | 'warn' | 'info', msg }]
   화면은 f로 그 칸 바로 아래에 문구를 단다 — 어느 칸을 고칠지 바로 보이게
     err  — 이대로 보내면 돌아온다(검증숫자 틀림·필수 칸 없음)
     warn — 대개 틀린 것(자릿수가 그 나라 보통과 다름·나라가 안 맞음)
     info — 받을 때 함께 챙길 것(인보이스·EIN)
═══════════════════════════════════════════════════════════════ */

import { COUNTRIES } from '../../constants.js';

const digits = (v) => String(v || '').replace(/\D/g, '');
/* «N/A»·«-»는 빈칸으로 본다 — 양식의 빈칸을 그렇게 채워 보내는 사람이 많다 */
const clean  = (v) => { const s = String(v || '').trim(); return /^(n\/?a|none|없음|-+)$/i.test(s) ? '' : s; };
const alnum  = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/* 받침에 따라 은/는 — «홍콩는»이 아니라 «홍콩은» */
const eunNeun = (w) => { const c = String(w).charCodeAt(String(w).length - 1);
  return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? `${w}은` : `${w}는`; };
const upper  = (v) => clean(v).toUpperCase().replace(/\s+/g, '');

/* 나라 이름 → ISO 코드. COUNTRIES에 없는 IBAN 나라는 여기서 더 받는다 */
const MORE = {
  FI: ['finland', '핀란드'], BE: ['belgium', '벨기에'], AT: ['austria', '오스트리아'], DK: ['denmark', '덴마크'],
  NO: ['norway', '노르웨이'], IE: ['ireland', '아일랜드'], PT: ['portugal', '포르투갈'], LU: ['luxembourg', '룩셈부르크'],
  PL: ['poland', '폴란드'], NZ: ['new zealand', '뉴질랜드'],
};
export function countryCode(text){
  const s = clean(text).toLowerCase().replace(/\(.*?\)/g, '').replace(/[.]/g, '').trim();
  if(!s) return '';
  if(/^[a-z]{2}$/.test(s)) return s.toUpperCase();
  if(/taiwan|대만|roc/.test(s)) return 'TW';
  for(const c of COUNTRIES) if(c.code !== 'OTHER' && (c.nameKo === s || c.aliases.includes(s))) return c.code;
  for(const [code, al] of Object.entries(MORE)) if(al.includes(s)) return code;
  return '';
}

/* IBAN 길이 — ISO 13616 등록부 */
const IBAN_LEN = {
  AT: 20, BE: 16, CH: 21, DE: 22, DK: 18, ES: 24, FI: 18, FR: 27, GB: 22, IE: 22, IT: 27,
  LU: 20, NL: 18, NO: 15, PL: 28, PT: 25, SE: 24, AE: 23, IL: 23,
};
export function ibanOk(iban){
  const s = upper(iban);
  if(!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  const r = s.slice(4) + s.slice(0, 4);
  let m = 0;
  for(const ch of r){
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for(const d of v) m = (m * 10 + +d) % 97;
  }
  return m === 1;
}
/* 미국 ABA(라우팅 번호) 검증숫자 — 3·7·1 가중치 */
export function abaOk(aba){
  const d = digits(aba);
  if(d.length !== 9) return false;
  const w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  return [...d].reduce((n, c, i) => n + +c * w[i], 0) % 10 === 0;
}
const SWIFT_RE = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

/* ── 나라별 규칙 ──
   need: 그 나라로 보낼 때 꼭 받을 것 — 'swift' | 'iban' | 'aba' | 'code'
   acct: 계좌번호 숫자 자릿수(보통 범위), code: 은행 코드 칸의 이름과 자릿수 */
export const BANK_RULES = {
  US: { label: '미국', need: ['swift', 'aba'], acct: [4, 17],
        tip: 'ABA(Routing No.) 9자리가 꼭 필요해요. 신용조합(Credit Union)은 SWIFT가 없을 수 있어요 — 중개은행을 받으세요' },
  CA: { label: '캐나다', need: ['swift', 'code'], acct: [7, 12], code: ['Transit(5)+기관번호(3)', [8, 9]],
        tip: '지점 Transit 5자리와 은행 기관번호 3자리(TD=004 등)가 필요해요' },
  AU: { label: '호주', need: ['swift', 'code'], acct: [6, 10], code: ['BSB', [6, 6]],
        tip: 'BSB 6자리는 계좌번호와 따로 받아요 — 붙어 오면 앞 6자리가 BSB예요' },
  GB: { label: '영국', need: ['swift', 'iban', 'code'], acct: [8, 8], code: ['Sort Code', [6, 6]] },
  HK: { label: '홍콩', need: ['swift', 'code'], acct: [9, 12], code: ['은행 코드', [3, 3]],
        tip: '홍콩은 IBAN·우편번호가 없어요. 계좌번호는 지점 3자리를 포함해요(HSBC 10자리)' },
  TW: { label: '대만', need: ['swift', 'code'], acct: [12, 14], code: ['은행 코드(3)+지점(4)', [3, 7]],
        tip: '대만은 6자리(3+3) 우편번호를 써요' },
  JP: { label: '일본', need: ['swift', 'code'], acct: [7, 7], code: ['은행(4)+지점(3)', [7, 7]] },
  CN: { label: '중국', need: ['swift', 'code'], acct: [16, 19], code: ['CNAPS', [12, 12]] },
  SG: { label: '싱가포르', need: ['swift', 'code'], acct: [9, 12], code: ['은행(4)+지점(3)', [7, 7]] },
  IN: { label: '인도', need: ['swift', 'code'], acct: [9, 18], code: ['IFSC', [11, 11]] },
};
for(const c of Object.keys(IBAN_LEN)) if(!BANK_RULES[c]) BANK_RULES[c] = { label: c, need: ['swift', 'iban'] };

/* 국내 은행 계좌 자릿수 — BK2026·AIA 2026 국내 지급대장에서 받은 것 + 은행 공시 형식 */
export const KR_BANKS = [
  { re: /국민|kb/i,        len: [12, 14] },
  { re: /신한/,            len: [11, 12] },
  { re: /우리/,            len: [13, 14] },
  { re: /하나|외환/,       len: [11, 14] },
  { re: /기업|ibk/i,       len: [10, 14] },
  { re: /농협|nh/i,        len: [11, 14] },
  { re: /sc|제일/i,        len: [11, 11] },
  { re: /카카오/,          len: [13, 13] },
  { re: /토스|케이뱅크/,   len: [12, 12] },
  { re: /우체국/,          len: [14, 14] },
  { re: /새마을/,          len: [13, 14] },
  { re: /수협/,            len: [11, 12] },
  { re: /부산|경남|전북/,  len: [12, 13] },
  { re: /대구|광주/,       len: [12, 12] },
];

/* 예금주가 연사 본인인가 — 이름 조각이 하나라도 겹치면 본인으로 본다(Chen Yen Ling ↔ Yenling Chen) */
const COMPANY_RE = /\b(inc|llc|ltd|limited|co|corp|corporation|gmbh|oy|ab|ag|sa|sarl|sas|srl|spa|bv|nv|plc|pty|pte|bhd|kk)\b|주식회사|\(주\)|건축사사무소|아키텍츠|-lab|lab\b/i;
function holderIsSelf(sp){
  const h = clean(sp.bank_holder).toLowerCase();
  if(!h) return true;
  const toks = (s) => clean(s).toLowerCase().split(/[\s,.\-()]+/).filter(t => t.length >= 2);
  const me = new Set([sp.name_en, sp.name_snapshot, sp.bank_first_name, sp.bank_last_name].flatMap(toks));
  const hs = toks(h.replace(/\(.*?\)/g, ''));
  /* «Yenling» ↔ «Yen Ling» — 붙여 쓴 이름도 맞춘다 */
  const joined = hs.join('');
  return hs.some(t => me.has(t)) || [...me].some(t => t.length >= 4 && joined.includes(t));
}

function checkDomestic(sp, out){
  const acct = digits(sp.bank_account);
  if(!clean(sp.bank_name)) out.push({ f: 'bank_name', lv: 'err', msg: '은행 이름이 없어요' });
  if(!acct) return out.push({ f: 'bank_account', lv: 'err', msg: '계좌번호가 없어요' }), out;
  const bank = KR_BANKS.find(b => b.re.test(sp.bank_name || ''));
  if(bank && (acct.length < bank.len[0] || acct.length > bank.len[1])){
    out.push({ f: 'bank_account', lv: 'warn', msg: `${clean(sp.bank_name)} 계좌는 보통 ${bank.len[0] === bank.len[1] ? bank.len[0] : bank.len.join('~')}자리인데 ${acct.length}자리예요 — 숫자가 빠지거나 더 들어가지 않았는지 통장사본과 맞춰 보세요` });
  }
  if(!bank && (acct.length < 10 || acct.length > 14)) out.push({ f: 'bank_account', lv: 'warn', msg: `국내 계좌는 보통 10~14자리인데 ${acct.length}자리예요` });
  if(!clean(sp.bank_holder)) out.push({ f: 'bank_holder', lv: 'warn', msg: '예금주가 비어 있어요 — 통장사본에서 옮겨 적어 주세요' });
  return out;
}

export function checkBank(sp, { domestic } = {}){
  const out = [];
  if(!sp || !(sp.bank_account || sp.bank_iban || sp.bank_name || sp.bank_holder)) return out;
  if(domestic) checkDomestic(sp, out);
  else checkOverseas(sp, out);

  /* 예금주가 본인이 아니면 회사 계좌 — BK2026에서 OY·LLC·INC 계좌는 모두 인보이스 번호를 받았다 */
  /* «이원석(W 아키텍츠)»처럼 이름 옆에 회사가 붙은 것도 회사 계좌일 수 있다 */
  const corp = COMPANY_RE.test(sp.bank_holder || '');
  if(clean(sp.bank_holder) && (!holderIsSelf(sp) || corp)){
    out.push({ f: 'bank_holder', lv: 'info', msg: `예금주(${clean(sp.bank_holder)})${holderIsSelf(sp) ? '에 회사 이름이 들어 있어요' : '가 연사 이름과 달라요'}${corp ? ' — 회사 계좌로 보여요' : ''}. 회사 계좌면 인보이스(번호 필수, 행사명·연사명·금액·수취 회사명)를 받아야 해요` });
    if(!domestic && countryCode(sp.bank_country) === 'US' && corp && !/ein|tax id/i.test(sp.bank_note || '')){
      out.push({ f: 'bank_holder', lv: 'info', msg: '미국 회사 계좌예요 — Tax ID(EIN)를 함께 받아 두세요' });
    }
  }
  return out;
}

function checkOverseas(sp, out){
  const cc = countryCode(sp.bank_country);
  const rule = BANK_RULES[cc];
  const swift = upper(sp.bank_swift), iban = upper(sp.bank_iban), code = digits(sp.bank_code);
  const acct = digits(sp.bank_account);
  const kind = clean(sp.bank_iban_kind).toUpperCase();

  /* 받는 사람·은행 기본 칸 */
  if(!clean(sp.bank_holder)) out.push({ f: 'bank_holder', lv: 'err', msg: '예금주(Account Holder)가 없어요' });
  if(!clean(sp.bank_holder_address)) out.push({ f: 'bank_holder_address', lv: 'warn', msg: '예금주 주소가 없어요 — 해외 송금에 필요해요' });
  else if(!clean(sp.bank_holder_postal) && cc !== 'HK') out.push({ f: 'bank_holder_postal', lv: 'warn', msg: '예금주 우편번호가 없어요' });
  if(!clean(sp.bank_name)) out.push({ f: 'bank_name', lv: 'err', msg: '은행 이름이 없어요' });
  if(!clean(sp.bank_country)) out.push({ f: 'bank_country', lv: 'err', msg: '은행 국가가 없어요 — 나라를 알아야 무엇을 받을지 정해져요' });
  else if(!cc) out.push({ f: 'bank_country', lv: 'warn', msg: `은행 국가 «${clean(sp.bank_country)}»를 알아보지 못했어요 — 나라별 점검을 건너뛰어요` });
  if(!clean(sp.bank_address)) out.push({ f: 'bank_address', lv: 'warn', msg: '은행 주소가 없어요' });
  else if(clean(sp.bank_address).split(',').length < 2 && !/city|시|市/i.test(sp.bank_address)) {
    out.push({ f: 'bank_address', lv: 'warn', msg: '은행 주소에 도시가 안 보여요 — «East District»처럼 구만 있으면 어느 도시인지 은행이 몰라요' });
  }
  if(!acct && !iban) out.push({ f: 'bank_account', lv: 'err', msg: '계좌번호가 없어요' });

  /* SWIFT — 8자 또는 11자, 5·6번째 글자가 은행 나라 */
  if(swift){
    if(!SWIFT_RE.test(swift)) out.push({ f: 'bank_swift', lv: 'err', msg: `SWIFT «${swift}»가 형식에 안 맞아요 — 8자나 11자(영문 4 + 나라 2 + 지역 2 + 지점 3)예요` });
    else if(cc && swift.slice(4, 6) !== cc) out.push({ f: 'bank_swift', lv: 'warn', msg: `SWIFT의 나라(${swift.slice(4, 6)})가 은행 국가(${cc})와 달라요 — 다른 나라 은행이면 은행 국가를 고쳐 주세요` });
  } else if(rule?.need.includes('swift')) {
    out.push({ f: 'bank_swift', lv: cc === 'US' ? 'warn' : 'err', msg: 'SWIFT/BIC가 없어요' });
  }

  /* IBAN — 그 나라 길이 + 검증숫자 */
  if(iban && kind !== 'ABA' && /^[A-Z]{2}/.test(iban)){
    const ic = iban.slice(0, 2);
    if(IBAN_LEN[ic] && iban.length !== IBAN_LEN[ic]) out.push({ f: 'bank_iban', lv: 'err', msg: `${ic} IBAN은 ${IBAN_LEN[ic]}자인데 ${iban.length}자예요 — 글자가 빠졌어요` });
    else if(!ibanOk(iban)) out.push({ f: 'bank_iban', lv: 'err', msg: 'IBAN 검증숫자가 맞지 않아요 — 한 글자가 틀렸거나 자리가 바뀌었어요' });
    if(cc && ic !== cc) out.push({ f: 'bank_iban', lv: 'warn', msg: `IBAN 나라(${ic})가 은행 국가(${cc})와 달라요` });
    if(acct && !iban.includes(alnum(sp.bank_account).slice(-4))) out.push({ f: 'bank_iban', lv: 'warn', msg: '계좌번호 끝자리가 IBAN 끝과 달라요 — 같은 계좌인지 확인해 주세요' });
  } else if(rule?.need.includes('iban')) {
    out.push({ f: 'bank_iban', lv: 'err', msg: `${eunNeun(rule.label)} IBAN이 필요해요` });
  }
  if(kind === 'IBAN' && cc && !IBAN_LEN[cc]) out.push({ f: 'bank_iban_kind', lv: 'warn', msg: `${eunNeun(rule?.label || cc)} IBAN을 쓰지 않아요 — ABA·IBAN 구분을 비워 주세요` });

  /* 미국 ABA */
  if(cc === 'US'){
    const aba = digits(kind === 'ABA' || !/^[A-Z]{2}/.test(iban) ? sp.bank_iban : '') || (code.length === 9 ? code : '');
    if(!aba) out.push({ f: 'bank_iban', lv: 'err', msg: '미국은 ABA(Routing No.) 9자리가 필요해요' });
    else if(!abaOk(aba)) out.push({ f: 'bank_iban', lv: 'err', msg: `ABA «${aba}»의 검증숫자가 맞지 않아요 — ${aba.length === 9 ? '한 자리가 틀렸어요' : `9자리인데 ${aba.length}자리예요`}` });
  }

  /* 은행 코드(BSB·Sort Code·홍콩·대만 등) */
  if(rule?.code){
    const [name, [lo, hi]] = rule.code;
    if(!code) out.push({ f: 'bank_code', lv: rule.need.includes('code') ? 'err' : 'warn', msg: `${eunNeun(rule.label)} ${name}가 필요해요` });
    else if(code.length < lo || code.length > hi) out.push({ f: 'bank_code', lv: 'warn', msg: `${eunNeun(name)} ${lo === hi ? lo : `${lo}~${hi}`}자리인데 ${code.length}자리예요` });
  }

  /* 계좌번호 자릿수 */
  if(rule?.acct && acct && !(iban && IBAN_LEN[cc])){
    const [lo, hi] = rule.acct;
    if(cc === 'AU' && acct.length > hi && acct.length - 6 >= lo && acct.length - 6 <= hi){
      out.push({ f: 'bank_account', lv: 'warn', msg: '계좌번호에 BSB 6자리가 붙어 있는 것 같아요 — 앞 6자리를 은행 코드(BSB)로 옮겨 주세요' });
    } else if(acct.length < lo || acct.length > hi){
      out.push({ f: 'bank_account', lv: 'warn', msg: `${rule.label} 계좌번호는 보통 ${lo === hi ? lo : `${lo}~${hi}`}자리인데 ${acct.length}자리예요 — 숫자가 빠지지 않았는지 연사에게 확인해 주세요` });
    }
  }
  if(rule?.tip) out.push({ f: 'bank_country', lv: 'info', msg: rule.tip });
  return out;
}
