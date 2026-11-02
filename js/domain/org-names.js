/* ══════════════════════════════════════════════════════════════
   domain/org-names.js — 기업 이름 다루기 — 법인격 떼기, 비교 키, 정렬 이름, 약어, 종류 배지
   (modules/company-tab.js에서 옮겼다 — 탭 화면 파일에 기대지 않게)
═══════════════════════════════════════════════════════════════ */

import { ORG_KINDS } from '../state.js';

/* ── 법인격 표기 떼기 ──
   '(주)', '주식회사', '㈜', '유한회사'는 회사 이름이 아니라 법인 형태다. 그런데
   적는 자리와 표기가 제각각이라 — 앞에 붙기도 뒤에 붙기도 하고, ㈜ 한 글자로
   쓰기도 한다 — 같은 회사가 다른 회사로 갈리고, 이름 순으로 늘어놓으면
   '㈜비엑스플랜트'와 '(주)메디라마'가 기호 자리에 모여 ㄱ·ㄴ·ㄷ이 무너진다.

   찾을 때도 셀 때도 줄 세울 때도 이 표기는 없는 셈 친다. 화면에 보이는 이름은
   그대로 둔다 — 세금계산서·명부에 적힌 정식 이름이라 지울 값이 아니다. */
const LEGAL_KO = '주식회사|유한회사|유한책임회사|합자회사|합명회사|재단법인|사단법인|의료법인|학교법인';
const LEGAL_MARK = /㈜|㈔|㈐|\(주\)|\（주\）|\(유\)|\(재\)|\(사\)|\(합\)/g;

export function stripLegalForm(raw){
  let s = String(raw || '').trim();
  if(!s) return '';
  s = s.replace(LEGAL_MARK, ' ');                                  // 기호형 — 어디에 붙어도 뗀다
  s = s.replace(new RegExp(`^\\s*(${LEGAL_KO})\\s*`), ' ');        // 앞에 붙은 말
  s = s.replace(new RegExp(`\\s*(${LEGAL_KO})\\s*$`), ' ');        // 뒤에 붙은 말
  // 영문 법인격 — 끝에 붙는 것만 뗀다(이름 가운데 든 Co는 회사 이름의 일부일 수 있다)
  s = s.replace(/[\s,.]*\b(incorporated|inc|co\.?,?\s*(ltd|limited)|ltd|limited|co|llc|llp|corp(oration)?|gmbh|pte\.?\s*ltd|pty\.?\s*ltd|plc)\b\.?\s*$/i, '');
  return s.replace(/\s+/g, ' ').trim();
}

export function normalizeCompanyKey(raw){
  if(!raw) return '';
  return stripLegalForm(raw).replace(/[.,]/g, '').replace(/\s+/g, '').trim().toLowerCase();
}

/* 줄 세울 때 쓰는 이름 — 법인격을 떼고 남은 실제 이름.
   떼고 나면 빈 문자열이 되는 이름(정말 '주식회사'만 적힌 경우)은 원문을 쓴다. */
export const coSortName = (v) => (stripLegalForm(v) || String(v || '')).trim();

/* 기업 종류 배지 */
export const orgKindOf = (kind) => ORG_KINDS.find(k => k.key === kind) || null;

/* 약어 자동 생성 (최대 2자) — 기업에 약어를 안 적었을 때 아바타에 쓴다 */
export function abbrOf(nm){
  if(!nm) return '?';
  if(nm.length <= 2) return nm;
  return /[가-힣]/.test(nm) ? nm.slice(0,2)
    : nm.split(/\s+/).map(w => w[0]).join('').slice(0,2).toUpperCase();
}
