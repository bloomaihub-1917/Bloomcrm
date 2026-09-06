/* ══════════════════════════════════════════════════════════════
   import-apply-files.js — 신청서 폴더를 훑어 접수 이력을 채운다

   신청서는 원드라이브 한 폴더에 모여 있고, 그 폴더가 곧 접수 기록이다.
   같은 기업 파일이 둘이면 두 번 받은 것이고, 파일명 꼬리에 왜 다시 받았는지가
   적혀 있다 — "전시패스 추가", "프북 수정", "가족사 소개 포함".

   파일은 CRM에 올리지 않는다. 파일명과 받은 날만 접수 줄로 남기고 원본은
   원드라이브에 둔다(로고·그래픽 폴더를 훑던 방식과 같다).

   폴더에 없는 접수는 여기서 만들 수 없다 — 메일 본문이나 유선으로 온 변경은
   흔적이 없다. 그건 화면에서 사람이 한 줄 추가한다. 이 스크립트는 손입력을
   줄이는 쪽으로만 쓴다.

   여러 번 돌려도 안전하다. 이미 들어간 파일명은 건너뛴다.

     node db/import-apply-files.js [--dry]
══════════════════════════════════════════════════════════════ */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

const DRY   = process.argv.includes('--dry');
const EVENT = '2026 KIC';
const DIR = 'C:/Users/cdaky/OneDrive - STUDIO BLOOM/4.행사/2026년/'
  + '1013-1015 KoNECT International Conference/300. 전시/Exhibition Application';

const LEGAL = /(co\.?,?\s*ltd\.?|corp(oration)?\.?|inc\.?|llc|gmbh|s\.?r\.?l\.?|ag|limited|주식회사|㈜|\(주\))/gi;
const norm = (s) => String(s || '').toLowerCase().replace(LEGAL, '').replace(/[^a-z0-9가-힣]/g, '');

/* 한 파일이 두 기업인 경우가 있다(공동 부스). 사람이 정해서 박아 둔다. */
const SPLIT = {
  '2026_KIC_Application_Form_KOR_서울대학교병원&분당서울대학교병원 .docx':
    ['서울대학교병원', '분당서울대학교병원'],
  /* 파일명 오타(스템/스텝)와 옛 사명이라 이름으로는 못 잡힌다 */
  '2026_KIC_Application_Form_KR_HLB 바이오스템.docx': ['HLB바이오스텝㈜'],
  '2026_KIC_Application_Form_EN_Median Technologies.pdf': ['메디안 메디컬 테크놀로지'],
  '2026_KIC_Application_Form_츌립앤사이언스씨알오센터(구,압타머사이언스).docx':
    ['츌립앤사이언스 씨알오(CRO) 센터'],
};

/* 파일명에서 기업 이름과 메모를 갈라낸다.
   "2026_KIC_Application_Form_EN_NEXTROVE 0818_전시패스 추가.docx"
     → 이름 "NEXTROVE" · 메모 "전시패스 추가" */
function parseName(file){
  let s = file.replace(/\.(docx?|pdf|hwp)$/i, '').replace(/\.docx$/i, '');
  /* 공통 접두어를 먼저 벗긴다. 날짜부터 지우면 "2026_"이 사라져
     "2026 KIC Application Form"이 더는 안 잡힌다 — 순서가 중요하다. */
  s = s.replace(/(2026[_\s]*)?KIC[_\s]*Application[_\s]*Form/i, ' ');
  s = s.replace(/^[\s_-]*\d{4}[_\s-]+/, ' ');                // 앞에 붙은 날짜(0827_)
  /* 국문/영문 표시를 뗀다. \b를 쓰면 안 된다 — 밑줄도 단어 문자라
     "_EN_"의 EN이 경계로 잡히지 않는다. 알파벳만 경계로 본다. */
  s = s.replace(/(?<![A-Za-z])(EN|KOR|KR)(?![A-Za-z])/gi, ' ');
  s = s.replace(/신청서/g, ' ');
  const notes = [];
  s = s.replace(/\(([^)]+)\)/g, (m, g) => {
    if(/구[,\s]|former/i.test(g)) return ' ' + g;            // 옛 사명은 이름 후보로 남긴다
    notes.push(g.trim()); return ' ';
  });
  s = s.replace(/[_\s-]+(\d{4})(?=[_\s]|$)/g, ' ');          // 파일명 날짜(0818)
  s = s.replace(/updated\s+\w+\s+\d+/i, (m) => { notes.push(m); return ' '; });
  s = s.replace(/[_\s-]*v?\d+\.\d+\s*$/i, '');               // -v1.0
  const tail = s.match(/[_\s-]+([가-힣][가-힣\s]*(?:추가|수정|포함|변경|취소))\s*$/);
  if(tail){ notes.push(tail[1].trim()); s = s.replace(tail[0], ''); }
  let name = s.replace(/[_\-&]+/g, ' ').replace(/\s+/g, ' ').trim();
  /* 이름이 통째로 괄호 안에 있는 파일이 있다 — "…_KOR (LSK Global PS).docx".
     접두어를 벗기면 이름이 비므로, 메모로 빼 둔 첫 조각을 이름으로 되돌린다. */
  if(!name && notes.length) name = notes.shift();
  return { name, notes };
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const exs = (await client.query(
      `SELECT x.id, x.company_name, o.name_ko, o.name_en, o.aliases
         FROM exhibitors x LEFT JOIN orgs o ON o.id = x.org_id
        WHERE x.event_id = $1 AND x.status <> '취소'`, [EVENT])).rows;
    /* 한글 이름은 두 글자짜리가 실제로 있다(㈜심유 → "심유"). 영문은 세 글자
       미만이면 우연히 겹치는 일이 잦아 뺀다. */
    const namesOf = (x) => [x.name_ko, x.name_en, x.company_name,
      ...String(x.aliases || '').split(/[\n,]/)].map(norm)
      .filter(v => v.length >= (/[가-힣]/.test(v) ? 2 : 3));

    const files = fs.readdirSync(DIR)
      .filter(f => /Application[_\s]*Form/i.test(f) && /\.(docx?|pdf|hwp)$/i.test(f));

    /* 이미 들어간 파일명은 건너뛴다 — 다시 돌려도 접수가 두 번 생기지 않는다 */
    const seen = new Set((await client.query(
      `SELECT a.file_name FROM exhibitor_apps a JOIN exhibitors x ON x.id = a.exhibitor_id
        WHERE x.event_id = $1 AND COALESCE(a.file_name,'') <> ''`, [EVENT])).rows.map(r => r.file_name));

    /* 기업별로 모아 받은 날짜 순으로 차수를 매긴다 */
    const byExh = new Map();
    const miss = [];
    for(const f of files){
      const forced = SPLIT[f];
      const { name, notes } = parseName(f);
      const k = norm(name);
      /* 이름이 그대로 맞는 곳이 있으면 그걸 쓴다. 품고 있는지(부분일치)만
         보면 짧은 이름이 여러 곳에 걸린다 — "labcorp"가 5곳에 걸렸다. */
      const exact = exs.filter(x => namesOf(x).includes(k));
      const hits = forced
        ? exs.filter(x => forced.some(t => namesOf(x).includes(norm(t))))
        : exact.length ? exact
        : exs.filter(x => namesOf(x).some(v => k.includes(v) || v.includes(k)));
      if(!hits.length || (!forced && hits.length > 1)){
        miss.push({ f, name, n: hits.length });
        continue;
      }
      const at = fs.statSync(path.join(DIR, f)).mtime.toISOString().slice(0, 10);
      hits.forEach(x => {
        if(!byExh.has(x.id)) byExh.set(x.id, { x, list: [] });
        byExh.get(x.id).list.push({ f, at, reason: notes.join(' · ') });
      });
    }

    let made = 0, skipped = 0;
    for(const { x, list } of byExh.values()){
      list.sort((a, b) => a.at.localeCompare(b.at));
      const have = (await client.query(
        'SELECT seq FROM exhibitor_apps WHERE exhibitor_id = $1', [x.id])).rows;
      let seq = have.length;
      for(const r of list){
        if(seen.has(r.f)){ skipped++; continue; }
        seq++;
        const kind = seq === 1 ? '최초' : '변경';
        if(!DRY) await client.query(
          `INSERT INTO exhibitor_apps (id, exhibitor_id, seq, received_at, channel, kind,
             reason, file_name, complete, missing, handled_at, handler, summary, note)
           VALUES ($1,$2,$3,$4,'신청서',$5,$6,$7,'','','','','', $8)`,
          [`XA-${Date.now()}_${made}`, x.id, String(seq), r.at, kind, r.reason, r.f,
           '폴더에서 자동으로 채운 줄이에요']);
        made++;
        console.log(`  ${(x.name_ko || x.company_name).padEnd(20)} ${seq}차 ${kind}  ${r.at}  ${r.f}${r.reason ? '   ← ' + r.reason : ''}`);
      }
    }

    console.log(`\n파일 ${files.length}개 · 접수 ${made}건 생성 · 이미 있어 건너뜀 ${skipped}건`);
    console.log(`기업을 못 맞춘 파일 ${miss.length}개 — 화면에서 손으로 추가해주세요`);
    miss.forEach(m => console.log(`   ${m.f}  (뽑아낸 이름 "${m.name}" · 후보 ${m.n}곳)`));

    if(DRY){ await client.query('ROLLBACK'); console.log('\n--dry 라서 되돌렸습니다.'); }
    else { await client.query('COMMIT'); console.log('\n반영했습니다.'); }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('실패 — 되돌렸습니다:', e.message);
    process.exitCode = 1;
  } finally { client.release(); process.exit(); }
})();
