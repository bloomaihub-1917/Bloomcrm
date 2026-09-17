/* AIA South Korea symposium 두 연사의 CV·발제를 제자리에 넣는다.

   왜 «넣는다»가 아니라 «제자리에»인가 — 두 사람 다 이미 등록돼 있었는데,
   CV의 절이 엉뚱한 칸에 들어가 있었다.

     Yenling Chen : PROFESSIONAL PROFILE이 bio_pro(경력)에,
                    PROFESSIONAL EXPERIENCE가 bio_work(직무)에
     Rong-Hao Chang : bio_pro에 사람 소개가 아니라 소속 기관(PEI) 소개가,
                    본인 프로필이 bio_work에

   칸이 넷뿐이던 시절에 있는 칸으로 밀어 넣은 결과다. 그대로 두면
   프로그램북을 뽑을 때 «경력» 자리에 회사 소개가 나간다.

   원문은 CV PDF에서 그대로 옮겼다. 줄여 쓰거나 고쳐 쓰지 않는다 — 요약은
   사람이 할 일이고, 우리가 줄이면 무엇이 원문이었는지 알 수 없게 된다.

   실행: node db/fill-aia-speakers.js --dry   (무엇이 바뀌는지만 보기)
         node db/fill-aia-speakers.js
*/
require('dotenv').config();
const { Pool } = require('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const dry = process.argv.includes('--dry');

const CHEN = 'SP-1789090821008_10';
const CHANG = 'SP-1789097599495_1';

/* ── Yenling Chen — Yenling Chen CV 2026.pdf ──

   프로필과 경력은 다시 적지 않고 칸만 옮긴다. 이미 들어 있는 글이 CV 원문
   그대로였다(경력 4,096자 = CV의 PROFESSIONAL EXPERIENCE 전문). 옮기면 될
   것을 다시 타이핑하면 그 과정에서 한 줄이 빠져도 아무도 모른다.
     bio_pro_en(지금: 프로필)  → bio_profile_en
     bio_work_en(지금: 경력)   → bio_pro_en
   나머지 절은 CV에 있는데 DB에 없던 것들이라 새로 넣는다. */
const chen = {
  _move: { bio_profile_en: 'bio_pro_en', bio_pro_en: 'bio_work_en' },
  bio_edu_en: `Master of Science in Advanced Architectural Design (MS.AAD), 2003
Columbia University, Graduate School of Architecture, Planning and Preservation (GSAPP) | New York, USA

Bachelor of Architecture, 2000
Tamkang University, Department of Architecture | Taipei, Taiwan`,

  bio_credentials_en: `Registered Architect, New York State, USA · AIA — Member, American Institute of Architects · LEED AP — USGBC / GBCI Accredited Professional (Sustainable Design)`,

  bio_teaching_en: `Adjunct Assistant Professor, Dept. of Architecture, 2015 – 2025
National Cheng Kung University (NCKU) | Tainan, Taiwan

Adjunct Lecturer, Dept. of Architecture, 2017 – 2018
National Taipei University of Technology | Taipei, Taiwan

Adjunct Lecturer, Dept. of Architecture, 2014 – 2015
Tamkang University | Taipei, Taiwan`,

  bio_affil_en: `• Jury Chair, Public Space Category — Taipei International Design Award (TIDA), 2024
• AIA Taipei — Board Member; Education Committee, 1st Session Chairman
• National Architects Association of R.O.C. — International Affair Committee, Consultant (15th Session)
• Architecture Institute of Taiwan — Architecture Education Committee, Vice Chairman
• Columbia Alumni Association of Taiwan — Supervisor, Board Member`,

  bio_pubs_en: `Column curator, International Architectural Practice — Taiwan Architect Magazine (ongoing)
The Architectural Review No. 1524 (2025)
TA Publication / Images Publishing — New Wave of Tea Shops (théÂTRE Beijing / Shanghai), Taipei International, Linear Light Realm
SDA 2022 Taiwan Design BEST100
Taiwan Architect Magazine — No. 608 (Column: Architect's Competencies; Hsinchu Fine Art Museum Competition, Honorable Mention), No. 598 (Lintianshan Forestry Culture Park), No. 597 (Neihu Share Village Public Housing), No. 590, No. 577 (Carguru Plaza, Neihu), No. 570 (Nuannuan Fire Station), No. 566 (Promised Land Church), No. 563 (Taiwan Next Generation Architects)
Ta Magazine — Vol. 340, Vol. 328 (Dapingding Columbarium), Vol. 319 (Nuannuan Fire Station)
Ministry of Agriculture Journal — 2023 Excellent Awards for Agriculture Construction
Taipei Architecture Renovation, Issue 2023`,

  bio_awards_en: `2025 — K-Design Award Grand Prize (Korea) · IDA Silver, Public/Government Buildings (USA) · Good Design Award Best 100 (Japan) · Architizer A+Awards Finalist (USA)
2024 — Architecture MasterPrize Winner (USA) · Good Design Award Winner (Japan) · iF Design Award (Germany) · IDA Silver, Cultural Preservation (USA)
2023 — Taiwan Architecture Award Outstanding · iF Design Award ×2 (Germany) · Golden Pin Design Award · A'Design Award (Italy)
2022 — Red Dot Design Award (Germany) · [d]arc Awards (UK) · FIABCI Taiwan Real Estate Excellence Award
2021 — Taiwan Architecture Award · Taipei International Design Award · A'Design Award (Italy)
2019 — FIABCI Taiwan Real Estate Excellence Award
2018 — Golden Pin Design Award, Spatial Design`,

  languages: `English (professional fluency) · Mandarin Chinese (native) · Japanese (professional fluency)`,
  residence_country: '대만',
  cv_file: 'Yenling Chen CV  2026.pdf',
};

/* ── Rong-Hao Chang — RONG-HAO CHANG_CV.pdf ── */
const chang = {
  /* 프로필은 옮긴다 — 지금 bio_work_en에 들어 있는 글이 본인 소개다.
     bio_pro_en에 있는 건 사람이 아니라 소속 기관(PEI) 소개라, 경력으로 쓸 수
     없다. 지우지 않고 메모로 옮긴다 — 받은 글이고, 기관 소개가 필요할 때
     다시 받아야 하는 건 일이다. */
  _move: { bio_profile_en: 'bio_work_en', note: 'bio_pro_en' },
  _noteLabel: '소속 기관 소개 (CV 1쪽, Predesign Energy Innovation):\n',

  bio_pro_en: `Principal, Predesign Planning & Consultant Ltd., 2024–
Principal, r.c. Architects, Taipei / Shanghai, 2013–2025
Founding Partner, H2R architects, Taipei / Beijing / Tokyo, 2010–2013
Senior Architect, Paliburg Development Consultants Ltd., Hong Kong, 2007–2010
Architect, Frank Williams & Partners Architects, New York, 2004–2007`,

  bio_edu_en: `Master of Science in Advanced Architectural Design, Columbia University GSAPP | New York, USA
Feng Chia University`,

  bio_credentials_en: `RA · AIA · LEED AP`,

  bio_teaching_en: `Associate Professor (Adjunct): GIA, NYCU, Hsinchu, 2025–
Associate Professor (Adjunct): NCKU, Tainan, 2024–2025`,

  bio_affil_en: `Jury Member, TEAM20 Architecture and Planning Award, Taiwan, 2020
Jury Member, The Modern Atlanta (MA) Prize, USA, 2013`,

  bio_pubs_en: `Exhibitions — Exhibitor, Taiwan Pavilion, 19th Venice Architecture Biennale, Italy, 2025 · Curator, Taiwan 20, Taiwan, 2020 · Exhibitor, Shenzhen Design Week – A'Design Exhibition

Publications — The Circular Ruins: Architecture within the Dream of Artificial Intelligence, Taiwan Architect No.616, April 2026, pp. 88-90 · The Future of Architecture: The "Generative Field" of Energy × Information, Taiwan Architect No.615, March 2026, pp. 59-93 · ECAT – Energy-Centric Architectural Thinking, Taiwan Architecture Vol.360, September 2025, pp. 22-81 · Healtdeva Manor: Taipei, Taiwan Architecture Vol.319, April 2022 · Letters to Students (On Seeming Paradoxes), Taiwan Architecture Vol.316, January 2022 · Hoyu Holdings Headquarters, Taiwan Architecture Vol.311, August 2021

Selected lectures — Architecture Association of Taiwan (ROC), 2026 · Low-Carbon Dislocation: Is the Architect Becoming Obsolete?, NTCAA, New Taipei, 2026 · ECAT, Taiwan Architecture (ta) Podcast, Taipei, 2025 · New Architectural Trends in the Low-Carbon Era, NCKU Arch, Tainan, 2024`,

  bio_awards_en: `Silver A' Design Award: Public Awareness, Volunteerism and Society Design, Como, Italy, 2017
Honorable Mention: It's LIQUID International Contest, Shanghai, China, 2017
Nominated (H2R): ADA Awards for Emerging Architects, Taipei, Taiwan, 2016`,

  cv_file: 'RONG-HAO CHANG_CV.pdf',
};

/* ── 발제 — 제안서·발제문에서 ── */
const ASSIGN = [
  {
    id: 'SS-1789090821874_11',   // Yenling Chen
    who: 'Yenling Chen',
    talk_format: '15-minute presentation, followed by round table discussion',
    discussion: `• Who authorizes a reading of the past — the government, the market, or the people who live there?
• Which is more resilient — a district that can absorb a new economy, or one protected from changing at all?
• When a place's history is uncomfortable, is the choice between erasing it and aestheticizing it — or is there a third position?`,
    keywords: 'Adaptive Reuse · Industrial Heritage · Urban Regeneration',
  },
  {
    id: 'SS-1789104457435_1',    // Rong-Hao Chang
    who: 'RONG-HAO CHANG',
    keywords: '#Architectural Transformation #Asia-Pacific Tech SupplyChain #Low-Carbon Development',
  },
];

const RECEIVED = '2026-09-17';   // 파일을 받은 날

(async () => {
  const targets = [[CHEN, chen, 'Yenling Chen'], [CHANG, chang, 'RONG-HAO CHANG']];

  for (const [id, data, name] of targets) {
    const cur = (await pool.query('select * from speakers where id = $1', [id])).rows[0];
    if (!cur) { console.log(`!! ${name} — 연사 줄을 못 찾았어요 (${id})`); continue; }

    const { _move, _noteLabel, ...fresh } = data;
    const patch = { ...fresh, cv_received_at: RECEIVED, updated_at: RECEIVED };

    /* 있는 글은 옮긴다 — 다시 적으면 그 과정에서 한 줄이 빠져도 아무도 모른다.
       to: from 꼴이고, 옮겨 온 칸은 아래에서 비운다. */
    const emptied = new Set();
    Object.entries(_move || {}).forEach(([to, from]) => {
      const v = String(cur[from] ?? '').trim();
      if (!v) return;
      patch[to] = to === 'note' && _noteLabel ? `${_noteLabel}${v}` : v;
      emptied.add(from);
    });
    /* 옮겨 온 자리는 비운다. 두 군데에 같은 글이 남으면 프로그램북에 두 번
       나간다. 다만 이번에 새 값을 넣는 칸이면 그 값을 살리고, 한 칸이
       «보낸 자리»이면서 «받는 자리»일 수도 있다(프로필→bio_profile,
       경력→bio_pro에서 bio_pro가 그렇다) — 그때는 비우면 안 된다. */
    emptied.forEach((f) => {
      if (f in fresh || f in (_move || {})) return;
      patch[f] = '';
    });
    /* bio_work_en(Working experience)은 두 CV 모두 따로 없다 — 경력 하나로
       적혀 있다. 옮기고 나면 비워 둔다. */
    if (!('bio_work_en' in patch)) patch.bio_work_en = '';

    const changed = Object.keys(patch).filter((k) => String(cur[k] ?? '') !== String(patch[k] ?? ''));
    console.log(`\n══ ${name}`);
    changed.forEach((k) => {
      const before = String(cur[k] ?? '');
      const after = String(patch[k] ?? '');
      console.log(`  ${dry ? '·' : '✓'} ${k}: ${before ? `${before.slice(0, 38)}… (${before.length}자)` : '(비어 있음)'}`
        + ` → ${after ? `${after.slice(0, 38)}… (${after.length}자)` : '(비움)'}`);
    });
    if (!changed.length) { console.log('  = 바뀔 것이 없어요'); continue; }
    if (dry) continue;

    const sets = changed.map((k, i) => `"${k}" = $${i + 2}`).join(', ');
    await pool.query(`update speakers set ${sets} where id = $1`, [id, ...changed.map((k) => patch[k])]);
  }

  console.log('\n── 발제 ──');
  for (const a of ASSIGN) {
    const cur = (await pool.query('select * from session_speakers where id = $1', [a.id])).rows[0];
    if (!cur) { console.log(`!! ${a.who} — 배정 줄을 못 찾았어요 (${a.id})`); continue; }
    const patch = {};
    ['keywords', 'talk_format', 'discussion'].forEach((k) => { if (a[k]) patch[k] = a[k]; });
    const changed = Object.keys(patch).filter((k) => String(cur[k] ?? '') !== String(patch[k]));
    console.log(`\n══ ${a.who}`);
    changed.forEach((k) => console.log(`  ${dry ? '·' : '✓'} ${k}: ${String(patch[k]).slice(0, 56)}…`));
    if (!changed.length) { console.log('  = 바뀔 것이 없어요'); continue; }
    if (dry) continue;
    const sets = changed.map((k, i) => `"${k}" = $${i + 2}`).join(', ');
    await pool.query(`update session_speakers set ${sets} where id = $1`, [a.id, ...changed.map((k) => patch[k])]);
  }

  console.log(dry ? '\n(dry — 아무것도 바꾸지 않았습니다)' : '\n넣었습니다.');
  await pool.end();
})();
