/* ══════════════════════════════════════════════════════════════
   contact-speaker.js — 연락처 상세의 «연사 자료»

   연사에게 받는 것 중 사람에 붙는 것(영문 성명·사진·약력·CV·자격·구사 언어)은
   다음 행사에도 다시 쓸 수 있다. 그런데 값은 행사 × 사람 줄(speakers)에만
   있어서, 같은 사람을 또 부르면 작년에 받은 걸 두고 처음부터 다시 받았다.

   원본은 옮기지 않는다 — contacts에 복사해 두면 정본이 둘이 되어 어느 쪽이
   최신인지 매번 따져야 한다. 여기서는 그 사람의 연사 줄 중 가장 늦게 받은
   값을 골라 «어느 행사에서, 언제 받았나»와 함께 보여주기만 한다.

   소속·직함(발표 당시 값), 동의서·연사료·항공(행사마다 새로), 여권·계좌
   (민감정보)는 여기 보이지 않는다. 계좌는 바뀌었는데 옛 계좌로 보내는
   위험이 다시 받는 번거로움보다 크다.
══════════════════════════════════════════════════════════════ */
import { speakersOfContact, assignmentsFor, rolesOfSpeaker, CONF_SESSIONS, evShort } from '../state.js';
import { escapeHtml, escAttr, td } from '../utils.js';

const STALE_DAYS = 365;   // 1년이 넘은 자료는 쓰기 전에 본인에게 확인한다

const dateOf = (v) => String(v || '').slice(0, 10);
const ageDays = (d) => d ? Math.round((new Date(td()) - new Date(d)) / 86400000) : null;

/* 항목마다 «받은 날»이 어느 칸인지. 날짜 칸이 없는 항목은 연사 줄의 수정일로 본다 */
const ITEMS = [
  { key: 'name_en',     label: '영문 성명', get: sp => sp.name_en,                       at: 'updated_at' },
  { key: 'photo',       label: '사진',     get: sp => sp.photo_file || (sp.photo_received_at ? '받음' : ''), at: 'photo_received_at', file: true },
  { key: 'profile',     label: '소개',     get: sp => sp.bio_profile_ko || sp.bio_profile_en, at: 'profile_received_at', long: true },
  { key: 'pro',         label: '경력',     get: sp => sp.bio_pro_ko || sp.bio_pro_en,         at: 'profile_received_at', long: true },
  { key: 'edu',         label: '학력',     get: sp => sp.bio_edu_ko || sp.bio_edu_en,         at: 'profile_received_at', long: true },
  { key: 'credentials', label: '자격',     get: sp => sp.bio_credentials_ko || sp.bio_credentials_en, at: 'profile_received_at' },
  { key: 'languages',   label: '구사 언어', get: sp => sp.languages,                     at: 'updated_at' },
  { key: 'cv',          label: 'CV',       get: sp => sp.cv_file || (sp.cv_received_at ? '받음' : ''), at: 'cv_received_at', file: true },
];

/* 그 항목의 가장 최근 값 — 받은 날이 늦은 줄이 이긴다. 날짜가 없으면 뒤로 민다 */
function latest(rows, it){
  return rows.map(sp => ({ sp, v: String(it.get(sp) || '').trim(), d: dateOf(sp[it.at] || sp.updated_at) }))
    .filter(x => x.v)
    .sort((a, b) => b.d.localeCompare(a.d))[0] || null;
}

const sessTitle = (a) => {
  const s = CONF_SESSIONS.find(x => x.id === a.session_id);
  return a.title_ko || a.title_en || (s ? s.title_ko || s.title_en : '') || '';
};

export function speakerMaterialsHtml(c){
  const rows = speakersOfContact(c.id);
  if(!rows.length) return '';

  const got = ITEMS.map(it => ({ it, x: latest(rows, it) }));
  const has = got.filter(g => g.x);
  const many = new Set(rows.map(r => r.event_id)).size > 1;

  const line = ({ it, x }) => {
    if(!x) return `<div class="ic"><div class="il">${it.label}</div><div class="iv" style="color:var(--i5)">-</div></div>`;
    const age = ageDays(x.d);
    const stale = age !== null && age > STALE_DAYS;
    const src = `${escapeHtml(evShort(x.sp.event_id) || x.sp.event_id || '')}${x.d ? ' · ' + escapeHtml(x.d) : ''}`;
    const val = it.long
      ? `<div style="font-size:11.5px;line-height:1.55;max-height:4.7em;overflow:hidden;white-space:pre-line">${escapeHtml(x.v)}</div>`
      : it.file ? `📎 ${escapeHtml(x.v)}` : escapeHtml(x.v);
    return `<div class="ic"${it.long ? ' style="grid-column:span 2"' : ''}>
      <div class="il">${it.label}${stale ? ' <span class="pill p-amber" style="font-size:9px">확인 필요</span>' : ''}</div>
      <div class="iv" style="${stale ? 'color:var(--i4)' : ''}">${val}
        <div style="font-size:10px;color:var(--i5);font-weight:400;margin-top:2px"
          title="${stale ? `받은 지 ${age}일 — 쓰기 전에 최신인지 확인하세요` : ''}">${src}</div></div></div>`;
  };

  const hist = rows.slice().sort((a, b) => String(b.event_id).localeCompare(String(a.event_id)))
    .map(sp => {
      const roles = rolesOfSpeaker(sp.id);
      const titles = assignmentsFor(sp.id).map(sessTitle).filter(Boolean);
      return `<div onclick="closeContactDr();openSpeakerDr('${escAttr(sp.id)}')" title="이 행사의 연사 화면 열기"
        style="display:flex;align-items:center;gap:7px;padding:6px 8px;border-radius:6px;cursor:pointer;background:var(--i9);margin-bottom:4px">
        <span style="font-size:11.5px;font-weight:700;flex:0 0 auto">${escapeHtml(evShort(sp.event_id) || sp.event_id || '')}</span>
        ${roles.map(r => `<span class="pill p-gray" style="font-size:9.5px;flex:0 0 auto">${escapeHtml(r)}</span>`).join('')}
        <span style="font-size:11px;color:var(--i3);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${
          escapeHtml(titles.join(' / '))}</span>
        ${sp.status && sp.status !== '확정' ? `<span class="pill ${sp.status === '취소' ? 'p-gray' : 'p-amber'}" style="font-size:9px;flex:0 0 auto">${escapeHtml(sp.status)}</span>` : ''}
      </div>`;
    }).join('');

  return `
    <div class="sct" style="margin-top:14px;display:flex;align-items:center;justify-content:space-between">
      <span>연사 자료</span>
      <span style="font-size:10.5px;font-weight:400;color:var(--i5)">${has.length}/${ITEMS.length} 있음${many ? ' · 가장 최근 받은 것' : ''}</span>
    </div>
    <div class="ig">${got.map(line).join('')}</div>
    <div style="font-size:10.5px;color:var(--i5);margin:4px 0 8px">고치려면 연사 화면에서 고칩니다 — 여기는 연사 줄에서 모아 보여주기만 해요</div>
    <div class="sct">연사 이력</div>
    <div style="margin-bottom:14px">${hist}</div>`;
}

/* ══════════════════════════════════════════
   지난 자료 가져오기

   같은 사람을 다시 부르면 작년에 받은 약력·사진·CV를 새 연사 줄에 옮긴다.
   받은 날짜는 옮기지 않는다 — 옮기면 «다 받음»으로 세어져 아무도 최신인지
   묻지 않는다. 가져온 자료는 «확인 대기»로 남고, 연사가 맞다고 하면 그때
   받은 날을 찍는다(confirmReuse). 그 전까지 자료 받기 단계의 메일은
   «새로 보내 주세요»가 아니라 «이 자료가 맞는지 확인해 주세요»로 바뀐다.

   비어 있는 칸만 채운다. 이번 행사에서 이미 받은 값을 작년 값으로 덮으면 안 된다.
══════════════════════════════════════════ */
const BIO = ['profile', 'pro', 'work', 'edu', 'awards', 'credentials', 'teaching', 'affil', 'pubs']
  .flatMap(k => [`bio_${k}_ko`, `bio_${k}_en`]);
/* 묶음 하나 = 받은 날 칸 하나. 확인하면 그 칸에 오늘을 찍는다 */
export const REUSE_GROUPS = [
  { key: 'bio',   label: '약력',     fields: [...BIO, 'languages'], at: 'profile_received_at' },
  { key: 'photo', label: '사진',     fields: ['photo_file'],        at: 'photo_received_at' },
  { key: 'cv',    label: 'CV',       fields: ['cv_file'],           at: 'cv_received_at' },
  { key: 'name',  label: '영문 성명', fields: ['name_en'],           at: '' },
];
const filled = (v) => String(v ?? '').trim() !== '';

/* 이 연사 줄에 가져올 수 있는 것 — {patch, from, groups} 또는 null */
export function reuseCandidates(sp){
  if(!sp || !sp.contact_id) return null;
  const others = speakersOfContact(sp.contact_id).filter(x => x.id !== sp.id && x.event_id !== sp.event_id);
  if(!others.length) return null;
  const patch = {}, from = {}, groups = [];
  REUSE_GROUPS.forEach(g => {
    /* 묶음 단위로 한 줄에서 가져온다 — 경력은 작년, 학력은 재작년에서 섞으면
       어느 때 기준 약력인지 말할 수 없다 */
    if(g.fields.some(f => filled(sp[f]))) return;
    const src = others.filter(o => g.fields.some(f => filled(o[f])))
      .sort((a, b) => dateOf(b[g.at] || b.updated_at).localeCompare(dateOf(a[g.at] || a.updated_at)))[0];
    if(!src) return;
    g.fields.forEach(f => { if(filled(src[f])) patch[f] = src[f]; });
    from[src.event_id] = true;
    groups.push(g);
  });
  if(!groups.length) return null;
  return { patch, groups, from: Object.keys(from) };
}

/* 가져왔는데 아직 연사에게 확인받지 못한 묶음 */
export function reusePending(sp){
  if(!sp || !sp.reused_at) return [];
  return REUSE_GROUPS.filter(g => g.at && !sp[g.at] && g.fields.some(f => filled(sp[f])));
}

/* 확인 메일에 넣을 내용 — 무엇을 확인해 달라는지 본문에 실어야 상대가 첨부를 뒤지지 않는다 */
export function reuseSummary(sp, en){
  return reusePending(sp).map(g => {
    if(g.key === 'photo') return `- ${en ? 'Portrait photo' : '사진'}: ${sp.photo_file}`;
    if(g.key === 'cv') return `- CV: ${sp.cv_file}`;
    const bio = en ? (sp.bio_profile_en || sp.bio_pro_en || sp.bio_profile_ko || sp.bio_pro_ko)
      : (sp.bio_profile_ko || sp.bio_pro_ko || sp.bio_profile_en || sp.bio_pro_en);
    /* «- 약력:»처럼 콜론으로 끝나는 줄은 fillTemplate가 빈 항목으로 보고 지운다 — 콜론 없이 들여 쓴다 */
    return `- ${en ? 'Biography' : '약력'}${bio ? '\n' + String(bio).trim().split('\n').map(l => '  ' + l).join('\n') : ''}`;
  }).join('\n');
}
