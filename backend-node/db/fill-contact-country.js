/* ══════════════════════════════════════════════════════════════
   fill-contact-country.js — 근거가 있는 사람만 국가를 채운다

   2026-08-31의 일괄 이관에서 열세 명이 빈 국가로 들어왔다. 전시 신청서가
   담당자 국가를 묻지 않아(exhibitor_contacts에 칸이 없다) 가져올 값이 없었다.

   기업 국가로 메우지 않는다. 그렇게 메운 값이 이미 열아홉 명 틀려 있다 —
   「포트리아 코리아 유한회사」 담당자가 «미국», 「시믹코리아」 담당자가 «일본».
   본사가 어디인지와 이 사람이 어디 있는지는 다른 질문이다.

   그 사람이 실제로 쓰는 것에서만 읽는다.
     · 전화 국가번호     +65 → 싱가포르
     · 이메일 국가 도메인 @x.co.kr → 대한민국
     · 한글 이름         박혜림 → 대한민국

   근거가 없는 사람은 비워 둔다. 비어 있으면 마스터DB의 «국가 미상»에 남아
   나중에라도 채울 수 있지만, 틀린 값이 들어가면 틀렸다는 것조차 안 보인다.

   이미 적힌 값은 건드리지 않는다 — 어긋난 값을 고치는 건 사람이 볼 일이다.

     node db/fill-contact-country.js --dry   무엇을 채울지만 본다
     node db/fill-contact-country.js         채운다
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const pool = require('./pool');
const DRY = process.argv.includes('--dry');

const DIAL = { '82':'대한민국','65':'싱가포르','81':'일본','86':'중국','886':'대만','852':'홍콩',
  '44':'영국','49':'독일','33':'프랑스','61':'호주','41':'스위스','31':'네덜란드','46':'스웨덴',
  '91':'인도','60':'말레이시아','66':'태국','84':'베트남','62':'인도네시아' };
const TLD = { kr:'대한민국', sg:'싱가포르', jp:'일본', cn:'중국', tw:'대만', hk:'홍콩', uk:'영국',
  de:'독일', fr:'프랑스', au:'호주', ch:'스위스', nl:'네덜란드', se:'스웨덴', in:'인도',
  vn:'베트남', th:'태국', my:'말레이시아', ca:'캐나다', it:'이탈리아', es:'스페인' };

function guess(c){
  const s = String(c.phone1 || '').replace(/[^0-9+]/g, '');
  if(s.startsWith('+')){
    for(const len of [3, 2, 1]){
      const hit = DIAL[s.slice(1, 1 + len)];
      if(hit) return { country: hit, why: '전화 국가번호' };
    }
  }
  const m = String(c.email1 || '').toLowerCase().trim().match(/\.([a-z]{2})$/);
  if(m && TLD[m[1]]) return { country: TLD[m[1]], why: '이메일 국가 도메인' };
  if(/[가-힣]/.test(String(c.nameKo || ''))) return { country: '대한민국', why: '한글 이름' };
  return null;
}

(async () => {
  try {
    const { rows } = await pool.query(
      `SELECT id,"nameKo","nameEn",email1,phone1,"orgKo" FROM contacts WHERE COALESCE(country,'') = ''`);
    const fill = [], skip = [];
    rows.forEach(c => { const g = guess(c); (g ? fill : skip).push({ c, g }); });

    console.log(`국가가 빈 연락처 ${rows.length}명\n`);
    console.log(`■ 채울 수 있는 ${fill.length}명`);
    fill.forEach(({ c, g }) => console.log(
      `   ${(c.nameKo || c.nameEn || '(이름없음)').padEnd(20)} ${String(c.orgKo).padEnd(24)} → ${g.country}  (${g.why})`));
    console.log(`\n■ 근거가 없어 비워 두는 ${skip.length}명`);
    skip.forEach(({ c }) => console.log(
      `   ${(c.nameKo || c.nameEn || '(이름없음)').padEnd(20)} ${String(c.orgKo).padEnd(24)} ${c.email1 || ''}`));

    if(DRY){ console.log('\n--dry 라서 아무것도 바꾸지 않았습니다.'); return; }

    for(const { c, g } of fill){
      await pool.query(`UPDATE contacts SET country = $1 WHERE id = $2`, [g.country, c.id]);
      await pool.query(
        `INSERT INTO activity_log (id,ts,email,name,type,action,target,detail,link)
         VALUES ($1,$2,'','정리 스크립트','edit','국가 채움',$3,$4,$5)`,
        [ 'AL-' + Date.now() + '-' + c.id, new Date().toISOString(),
          c.nameKo || c.nameEn || c.id,
          `<b>${c.nameKo || c.nameEn || c.id}</b> 국가를 <b>${g.country}</b>로 채웠어요 — ${g.why}`,
          /* 되돌릴 재료를 함께 남긴다 — 잘못 채웠으면 활동 기록에서 되돌린다 */
          JSON.stringify({ kind: 'contact', id: c.id, table: 'contacts', row: c.id,
            op: 'update', before: { country: '' }, after: { country: g.country } }) ]);
    }
    console.log(`\n${fill.length}명 채웠습니다. ${skip.length}명은 «국가 미상»에 남아 있어요.`);
  } catch (e) {
    console.error('실패:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end?.();
  }
})();
