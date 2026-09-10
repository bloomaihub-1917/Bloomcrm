/* ══════════════════════════════════════════════════════════════
   speaker-drawer.js — 연사 한 사람의 상세

   왜 이렇게 갈랐나
   ---------------
   연사에게 받아야 하는 것은 한 덩어리가 아니다. 성명·소속·직함은 사람에게
   붙고, 발제명·초록·발표자료는 «그 사람이 그 세션에서 맡은 역할»에 붙는다.
   한 사람이 두 세션에서 발표하면 발제도 둘이다. 그래서 발제 정보는 연사 줄이
   아니라 배정 줄(session_speakers)에 저장한다.

   이력은 국·영문을 따로 받는다. 해외 연사는 보통 영문만 주므로 국문이 비어
   있는 것이 정상이고, 그걸 «안 받은 것»으로 세면 안 된다 — 그래서 받았는지는
   글자 유무가 아니라 profile_received_at 한 칸으로 본다.

   글자수 한도는 행사마다 다르다. 여기서는 컨퍼런스 설정의 한도를 읽어
   지금 몇 자인지만 보여준다. 넘었다고 막지는 않는다 — 원문을 잘라 두면
   무엇을 받았는지가 사라진다.
═══════════════════════════════════════════════════════════════ */

import {
  contacts, EVENT_LIST,
  SPEAKERS, SESSION_SPEAKERS, CONF_SESSIONS, SPEAKER_CONTACTS, SPEAKER_LOGS,
  getSpeakerById, assignmentsFor, rolesOfSpeaker,
  contactsOfSpeaker, logsOfSpeaker,
  confCfg, speakerNeed, speakerNeedList,
} from '../state.js';
import { SPEAKER_ROLES, NEED_MARK, NEED_LABEL } from '../constants.js';
import { td, escapeHtml, escAttr } from '../utils.js';
import {
  saveSpeaker, saveSessionSpeaker,
  saveSpeakerContact, deleteSpeakerContact,
  sendMail,
} from '../api.js';
import { trackAction } from './audit-tab.js';
import { confLocked, confLockNotice, renderConf, buildConfEvList } from './conf-tab.js';

let spId = null;
let spTab = 'basic';

const TABS = [
  { key: 'basic',  label: '기본' },
  { key: 'bio',    label: '이력' },
  { key: 'talk',   label: '발제' },
  { key: 'people', label: '연락 상대' },
  { key: 'mail',   label: '메일' },
];

const STATUSES = ['섭외중', '확정', '보류', '취소'];

/* ── 여닫기 ── */
export function openSpeakerDr(id, tab){
  spId = id;
  if(tab && TABS.some(t => t.key === tab)) spTab = tab;
  document.getElementById('sp-dr')?.classList.add('on');
  renderSpeakerDr();
}
export function closeSpeakerDr(){
  spId = null;
  document.getElementById('sp-dr')?.classList.remove('on');
}
export function switchSpeakerDT(v){ spTab = v; renderSpeakerDr(); }

/* ── 저장 ──
   화면을 먼저 바꾸고 실패하면 되돌린다. 저장이 안 됐는데 화면만 바뀌면
   받은 줄 알고 다시 묻지 않게 된다. */
async function patchSpeaker(patch, label){
  if(confLocked()){ confLockNotice(); return { ok: false, locked: true }; }
  const sp = getSpeakerById(spId);
  if(!sp) return { ok: false };
  const backup = {};
  Object.keys(patch).forEach(k => { backup[k] = sp[k]; });
  Object.assign(sp, patch);
  renderSpeakerDr();

  const r = await saveSpeaker({ id: sp.id, ...patch, updated_at: td() });
  if(!r || r.ok === false){
    Object.assign(sp, backup);
    renderSpeakerDr();
    if(!r?.locked) alert('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    return r || { ok: false };
  }
  sp.updated_at = td();
  if(label) trackAction('edit', '연사', sp.event_id, `${sp.name_snapshot || sp.id} — ${label}`);
  renderConf();
  buildConfEvList();
  return r;
}

/* 발제는 배정 줄에 저장한다 — 한 사람이 두 세션에서 발표하면 발제도 둘이다 */
async function patchAssign(aid, patch, label){
  if(confLocked()){ confLockNotice(); return { ok: false, locked: true }; }
  const a = SESSION_SPEAKERS.find(x => x.id === aid);
  if(!a) return { ok: false };
  const backup = {};
  Object.keys(patch).forEach(k => { backup[k] = a[k]; });
  Object.assign(a, patch);
  renderSpeakerDr();

  const r = await saveSessionSpeaker({ id: aid, ...patch });
  if(!r || r.ok === false){
    Object.assign(a, backup);
    renderSpeakerDr();
    if(!r?.locked) alert('저장에 실패했어요. 네트워크 확인 후 다시 시도해주세요.');
    return r || { ok: false };
  }
  if(label) trackAction('edit', '세션 배정', a.event_id, `${speakerLabel()} — ${label}`);
  renderConf();
  return r;
}

/* 은/는을 받침으로 가른다 — 역할 이름이 문장에 들어가므로 «좌장는»이 되면
   우리가 적은 글이 아니라 기계가 뱉은 글처럼 읽힌다. */
function eunNeun(word){
  const ch = String(word || '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if(!(code >= 0xAC00 && code <= 0xD7A3)) return '는';   // 한글이 아니면 «는»
  return (code - 0xAC00) % 28 === 0 ? '는' : '은';
}

const speakerLabel = () => {
  const sp = getSpeakerById(spId);
  return sp ? (sp.name_snapshot || sp.id) : '';
};

/* 인라인 핸들러가 부르는 얇은 껍데기 — 값이 그대로면 저장하지 않는다
   (포커스가 빠질 때마다 같은 값을 보내면 기록이 변경 이력으로 더러워진다) */
export function spField(field, value, label){
  const sp = getSpeakerById(spId);
  if(!sp || String(sp[field] ?? '') === String(value ?? '')) return;
  patchSpeaker({ [field]: value }, label || field);
}
export function asField(aid, field, value, label){
  const a = SESSION_SPEAKERS.find(x => x.id === aid);
  if(!a || String(a[field] ?? '') === String(value ?? '')) return;
  patchAssign(aid, { [field]: value }, label || field);
}

/* 받았다고 체크하면 오늘 날짜를 찍는다 — 전시 쪽과 같은 규칙이다.
   날짜를 손으로 고칠 수 있어야 하니 칸도 함께 보여준다. */
export function spStamp(field, label){
  const sp = getSpeakerById(spId);
  if(!sp) return;
  patchSpeaker({ [field]: sp[field] ? '' : td() }, label);
}
export function asStamp(aid, field, label){
  const a = SESSION_SPEAKERS.find(x => x.id === aid);
  if(!a) return;
  patchAssign(aid, { [field]: a[field] ? '' : td() }, label);
}

/* ══════════════════════════════════════════
   렌더
══════════════════════════════════════════ */
export function renderSpeakerDr(){
  if(!spId) return;
  const sp = getSpeakerById(spId);
  if(!sp){ closeSpeakerDr(); return; }
  const evKey = sp.event_id;
  const roles = rolesOfSpeaker(sp.id);
  const con = sp.contact_id ? contacts.find(c => String(c.id) === String(sp.contact_id)) : null;

  const h = document.getElementById('sp-drh');
  if(h) h.innerHTML = `
    <div style="flex:1;min-width:0">
      <div class="drnm">${escapeHtml(sp.name_snapshot || '(이름 없음)')}
        ${roles.map(r => `<span class="pill ${(SPEAKER_ROLES.find(x => x.key === r) || {}).cls || 'p-gray'}"
          style="vertical-align:middle;font-size:10px">${escapeHtml(r)}</span>`).join(' ')}</div>
      <div class="drmt">${escapeHtml(sp.status || '섭외중')}${
        con ? ` · ${escapeHtml(con.orgKo || con.orgEn || '')}${con.titleKo || con.titleEn ? ' ' + escapeHtml(con.titleKo || con.titleEn) : ''}` : ' · 연락처 연결 안 됨'}${
        assignmentsFor(sp.id).length ? ` · 세션 ${assignmentsFor(sp.id).length}` : ''}</div>
    </div>
    <button class="drcls" onclick="closeSpeakerDr()">✕</button>`;

  /* 탭에 «아직 안 받은 것»의 수를 띄운다 — 열어 보기 전에 남은 일이 보이게 */
  const left = {
    basic: missingBasic(sp, con, evKey).length,
    bio: missingBio(sp, evKey).length,
    talk: missingTalk(sp, evKey).length,
    /* 수신이 없으면 메일을 못 보낸다 — 메일 탭을 열어 보고 알기보다
       탭에서 먼저 보이는 게 낫다 */
    people: mailTargets(sp.id).to.length ? 0 : 1,
    mail: 0,
  };
  const tabsEl = document.getElementById('sp-drtabs');
  if(tabsEl) tabsEl.innerHTML = TABS.map(t =>
    `<button class="drtab${spTab === t.key ? ' on' : ''}" onclick="switchSpeakerDT('${t.key}')">${t.label}${
      left[t.key] ? ` <span class="pill p-amber">${left[t.key]}</span>` : ''}</button>`).join('');

  const b = document.getElementById('sp-drbd');
  if(b){
    b.classList.toggle('ro', confLocked());
    b.innerHTML = spTab === 'bio' ? bioHtml(sp, evKey)
      : spTab === 'talk' ? talkHtml(sp, evKey)
      : spTab === 'people' ? peopleTabHtml(sp)
      : spTab === 'mail' ? mailTabHtml(sp, evKey)
      : basicHtml(sp, con, evKey);
  }
}

/* ── «받아야 함»인데 아직 없는 것 ──
   역할이 요구하지 않는 항목은 세지 않는다. 좌장에게 초록이 없는 건
   빠진 게 아니라 애초에 묻지 않은 것이다. */
const needState = (evKey, roles, key) => {
  let best = '';
  roles.forEach(r => {
    const s = speakerNeed(evKey, r, key);
    if(s === 'req') best = 'req';
    else if(s === 'opt' && best !== 'req') best = 'opt';
  });
  return best;
};
const isReq = (evKey, roles, key) => needState(evKey, roles, key) === 'req';

function missingBasic(sp, con, evKey){
  const roles = rolesOfSpeaker(sp.id);
  const out = [];
  if(isReq(evKey, roles, 'profile') && !(con && (con.orgKo || con.orgEn))) out.push('소속');
  if(isReq(evKey, roles, 'photo') && !sp.photo_received_at) out.push('사진');
  if(isReq(evKey, roles, 'consent') && !sp.consent_at) out.push('개인정보 제공 동의');
  return out;
}
function missingBio(sp, evKey){
  const roles = rolesOfSpeaker(sp.id);
  const out = [];
  if((isReq(evKey, roles, 'bio_pro') || isReq(evKey, roles, 'bio_work')) && !sp.profile_received_at) out.push('이력');
  return out;
}
function missingTalk(sp, evKey){
  const out = [];
  assignmentsFor(sp.id).forEach(a => {
    const need = (k) => speakerNeed(evKey, a.role, k) === 'req';
    if(need('title') && !(a.title_ko || a.title_en)) out.push('발제명');
    if(need('abstract') && !a.abstract_received_at) out.push('초록');
    if(need('slides') && !a.slides_received_at) out.push('발표자료');
  });
  return out;
}

/* ── 작은 조각들 ── */
/* 라벨을 이스케이프하지 않는다 — 글자수 표시처럼 이미 만들어 둔 조각이 들어온다.
   호출하는 자리의 라벨은 모두 이 파일의 고정 문구이고, 사람이 적은 값은
   섞지 않는다(섞을 일이 생기면 그 자리에서 escapeHtml을 씌운다). */
const fg = (label, inner, hint) => `<div class="fg"><label class="fl">${label}</label>${inner}${
  hint ? `<div style="font-size:10px;color:var(--i4);margin-top:3px">${hint}</div>` : ''}</div>`;

const txt = (val, handler, ph) => `<input class="fi" type="text" value="${escAttr(val || '')}"
  placeholder="${escAttr(ph || '')}" onchange="${handler}">`;

const area = (val, handler, ph, rows) => `<textarea class="fi" rows="${rows || 4}"
  placeholder="${escAttr(ph || '')}" style="resize:vertical" onchange="${handler}">${escapeHtml(val || '')}</textarea>`;

const dateIn = (val, handler) => `<input class="fi" type="date" value="${escAttr(val || '')}" onchange="${handler}">`;

/* 받았는지 — 체크는 오늘 날짜를 찍고, 날짜 칸은 손으로 고칠 수 있다 */
const gotRow = (label, date, toggleH, dateH, need) => `<div style="display:flex;align-items:center;gap:9px;
    padding:7px 0;border-bottom:1px solid var(--i7)">
    <input type="checkbox" ${date ? 'checked' : ''} onchange="${toggleH}">
    <div style="flex:1;min-width:0">
      <div style="font-size:12px">${escapeHtml(label)}
        ${need ? `<span style="color:var(--i4);font-size:10px" title="${escAttr(NEED_LABEL[need] || '')}">${NEED_MARK[need] || ''}</span>` : ''}</div>
    </div>
    <input class="fi" type="date" style="width:132px" value="${escAttr(date || '')}" onchange="${dateH}">
  </div>`;

/* 글자수 — 한도는 행사마다 다르고, 넘어도 막지 않는다.
   해외 연사는 국문이 비는 게 정상이라 빈 칸을 «넘침»처럼 보이게 하지 않는다. */
const countHint = (val, limit) => {
  const n = String(val || '').length;
  if(!limit) return n ? `${n}자` : '';
  const over = n > Number(limit);
  return `<span style="color:${over ? 'var(--am)' : 'var(--i4)'}">${n} / ${limit}자${over ? ' — 넘었어요' : ''}</span>`;
};

/* ══════════════════════════════════════════
   기본
══════════════════════════════════════════ */
function basicHtml(sp, con, evKey){
  const roles = rolesOfSpeaker(sp.id);
  const nOf = (k) => needState(evKey, roles, k);

  const conBox = con
    ? `<div style="padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px">
        <div style="font-size:12px;font-weight:600">${escapeHtml(con.nameKo || con.nameEn || con.id)}
          ${con.nameKo && con.nameEn ? `<span style="font-weight:400;color:var(--i4);font-size:11px">${escapeHtml(con.nameEn)}</span>` : ''}</div>
        <div style="font-size:11px;color:var(--i3);margin-top:2px">
          ${escapeHtml([con.orgKo, con.titleKo].filter(Boolean).join(' · ') || '(소속·직함 없음)')}</div>
        ${con.orgEn || con.titleEn ? `<div style="font-size:10.5px;color:var(--i4)">${escapeHtml([con.orgEn, con.titleEn].filter(Boolean).join(' · '))}</div>` : ''}
        <div style="font-size:10.5px;color:var(--i4);margin-top:3px">${escapeHtml(con.email1 || '')}</div>
        <button class="btn" style="font-size:10.5px;margin-top:7px" onclick="unlinkSpeakerContact()">연결 끊기</button>
      </div>`
    : `<div style="padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px">
        <div style="font-size:11.5px;color:var(--i3);line-height:1.6">
          소속·직함은 마스터DB의 연락처에서 옵니다. 여기서 또 적으면 두 곳의 값이 갈려요 —
          연락처를 찾아 연결하면 국·영문이 함께 따라옵니다.</div>
        <input class="fi" style="margin-top:7px" placeholder="이름·기업·메일로 검색…"
          oninput="searchSpeakerContact(this.value)">
        <div id="sp-con-hits" style="margin-top:5px"></div>
      </div>`;

  return `
    ${fg('성명 (프로그램에 나갈 이름)', txt(sp.name_snapshot, `spField('name_snapshot',this.value,'성명')`, '홍길동'),
      '연락처를 지워도 프로그램에서 이름이 사라지지 않도록 따로 굳혀 둡니다')}
    ${fg('연락처 연결' + (nOf('profile') ? ` ${NEED_MARK[nOf('profile')]}` : ''), conBox)}
    <div class="fgr">
      ${fg('섭외 상태', `<select class="fi" onchange="spField('status',this.value,'섭외 상태')">
        ${STATUSES.map(s => `<option value="${escAttr(s)}"${(sp.status || '섭외중') === s ? ' selected' : ''}>${s}</option>`).join('')}</select>`)}
      ${fg('언어', `<select class="fi" onchange="spField('lang_pref',this.value,'언어')">
        <option value=""${!sp.lang_pref ? ' selected' : ''}>미정</option>
        <option value="both"${sp.lang_pref === 'both' ? ' selected' : ''}>국·영문 모두</option>
        <option value="en"${sp.lang_pref === 'en' ? ' selected' : ''}>영문만 (해외 연사)</option>
      </select>`, '국가로 짐작하지 않고 물어서 적습니다')}
    </div>
    <div class="fgr">
      ${fg('초청 발송', dateIn(sp.invite_sent_at, `spField('invite_sent_at',this.value,'초청 발송')`))}
      ${fg('회신', dateIn(sp.invite_replied_at, `spField('invite_replied_at',this.value,'초청 회신')`))}
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--i3);margin:16px 0 4px">받은 것</div>
    ${nOf('photo') ? gotRow('연사 사진', sp.photo_received_at,
      `spStamp('photo_received_at','사진 받음')`,
      `spField('photo_received_at',this.value,'사진 받은 날')`, nOf('photo')) : ''}
    ${nOf('photo') ? fg('사진 파일명', txt(sp.photo_file, `spField('photo_file',this.value,'사진 파일')`, '원드라이브 파일명'),
      '파일은 원드라이브에 올리고 여기엔 파일명만 적습니다') : ''}
    ${nOf('consent') ? gotRow('개인정보 제공 동의서', sp.consent_at,
      `spStamp('consent_at','동의서 받음')`,
      `spField('consent_at',this.value,'동의서 받은 날')`, nOf('consent')) : ''}

    ${fg('메모', area(sp.note, `spField('note',this.value,'메모')`, '섭외 경위, 주의할 점 등', 3))}`;
}

/* 연락처 검색 — 이미 있는 사람을 다시 적지 않게 한다 */
export function searchSpeakerContact(q){
  const box = document.getElementById('sp-con-hits');
  if(!box) return;
  const t = String(q || '').trim().toLowerCase();
  if(t.length < 2){ box.innerHTML = ''; return; }
  const hits = contacts.filter(c =>
    [c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.email1].some(v => String(v || '').toLowerCase().includes(t))
  ).slice(0, 8);
  box.innerHTML = hits.length
    ? hits.map(c => `<div class="drw" onclick="linkSpeakerContact('${escAttr(c.id)}')">
        <div><div class="drn">${escapeHtml(c.nameKo || c.nameEn || c.id)}</div>
        <div class="drm">${escapeHtml([c.orgKo || c.orgEn, c.titleKo || c.titleEn, c.email1].filter(Boolean).join(' · '))}</div></div>
      </div>`).join('')
    : `<div style="font-size:11px;color:var(--i4);padding:5px 2px">찾는 사람이 없어요 — 마스터DB에 먼저 등록해주세요</div>`;
}

export async function linkSpeakerContact(cid){
  const c = contacts.find(x => String(x.id) === String(cid));
  const sp = getSpeakerById(spId);
  if(!c || !sp) return;
  /* 이름 스냅숏이 비어 있으면 연락처 이름으로 채운다. 이미 적혀 있으면
     건드리지 않는다 — 프로그램에 나갈 이름을 손으로 고쳐 뒀을 수 있다. */
  const patch = { contact_id: String(c.id) };
  if(!sp.name_snapshot) patch.name_snapshot = c.nameKo || c.nameEn || '';
  await patchSpeaker(patch, `연락처 연결 (${c.nameKo || c.nameEn || c.id})`);
}
export async function unlinkSpeakerContact(){
  await patchSpeaker({ contact_id: '' }, '연락처 연결 끊기');
}

/* ══════════════════════════════════════════
   이력 — 국·영문 따로. 해외 연사는 영문만 오는 게 정상이다.
══════════════════════════════════════════ */
function bioHtml(sp, evKey){
  const roles = rolesOfSpeaker(sp.id);
  const nPro = needState(evKey, roles, 'bio_pro');
  const nWork = needState(evKey, roles, 'bio_work');
  const lim = confCfg(evKey).limits || {};
  const enOnly = sp.lang_pref === 'en';

  if(!nPro && !nWork){
    return `<div style="padding:16px;background:var(--i8);border:1px solid var(--i6);border-radius:8px;
      font-size:12px;color:var(--i5);line-height:1.7">
      이 연사의 역할(${escapeHtml(roles.join(' · ') || '배정 없음')})은 이력을 받지 않아요.
      받아야 한다면 설정 › 행사 관리 › 컨퍼런스에서 역할별 항목을 고치세요.</div>`;
  }

  const pair = (label, need, koField, enField) => {
    const koVal = sp[koField], enVal = sp[enField];
    const limit = koField.includes('pro') ? lim.bio_pro : lim.bio_work;
    return `<div style="margin-bottom:16px">
      <div style="display:flex;align-items:baseline;gap:7px;margin-bottom:5px">
        <div style="font-size:11.5px;font-weight:700">${escapeHtml(label)}</div>
        <div style="font-size:10px;color:var(--i4)" title="${escAttr(NEED_LABEL[need] || '')}">${NEED_MARK[need] || ''}</div>
      </div>
      ${enOnly ? '' : fg(`국문 · ${countHint(koVal, limit)}`,
        area(koVal, `spField('${koField}',this.value,'${escAttr(label)} 국문')`, '', 5))}
      ${fg(`영문 · ${countHint(enVal, limit)}`,
        area(enVal, `spField('${enField}',this.value,'${escAttr(label)} 영문')`, '', 5))}
    </div>`;
  };

  return `
    ${enOnly ? `<div style="padding:8px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;
      font-size:11px;color:var(--i3);margin-bottom:12px">
      해외 연사(영문만)로 적혀 있어 국문 칸을 숨겼어요. 기본 탭의 «언어»를 바꾸면 다시 보여요.</div>` : ''}
    ${gotRow('이력 받음', sp.profile_received_at,
      `spStamp('profile_received_at','이력 받음')`,
      `spField('profile_received_at',this.value,'이력 받은 날')`,
      nPro === 'req' || nWork === 'req' ? 'req' : 'opt')}
    <div style="font-size:10.5px;color:var(--i4);margin:5px 0 14px">
      받았는지는 이 체크로 봅니다 — 해외 연사는 국문이 비는 게 정상이라 글자 유무로 세지 않아요.</div>
    ${nPro ? pair('Professional experience', nPro, 'bio_pro_ko', 'bio_pro_en') : ''}
    ${nWork ? pair('Working experience', nWork, 'bio_work_ko', 'bio_work_en') : ''}`;
}

/* ══════════════════════════════════════════
   발제 — 배정마다 하나. 역할이 묻지 않는 항목은 아예 보이지 않는다.
══════════════════════════════════════════ */
function talkHtml(sp, evKey){
  const asg = assignmentsFor(sp.id);
  if(!asg.length){
    return `<div style="padding:16px;background:var(--i8);border:1px solid var(--i6);border-radius:8px;
      font-size:12px;color:var(--i5);line-height:1.7">
      아직 세션에 배정되지 않았어요. «프로그램»에서 세션에 넣고 역할을 정하면
      그 역할이 요구하는 발제 정보가 여기 나타납니다.</div>`;
  }
  const lim = confCfg(evKey).limits || {};

  const block = (a) => {
    const s = CONF_SESSIONS.find(x => x.id === a.session_id);
    const need = (k) => speakerNeed(evKey, a.role, k);
    const nTitle = need('title'), nAbs = need('abstract'), nSlides = need('slides');
    const head = `<div style="display:flex;align-items:baseline;gap:7px;margin-bottom:7px">
      <span class="pill ${(SPEAKER_ROLES.find(r => r.key === a.role) || {}).cls || 'p-gray'}" style="font-size:10px">${escapeHtml(a.role || '역할 없음')}</span>
      <div style="font-size:12px;font-weight:600;min-width:0">${escapeHtml(s ? (s.title_ko || s.title_en || s.id) : '(삭제된 세션)')}</div>
      <div style="font-size:10.5px;color:var(--i4)">${escapeHtml([s?.date, s?.start_at].filter(Boolean).join(' '))}</div>
    </div>`;

    if(!nTitle && !nAbs && !nSlides){
      return `<div style="border:1px solid var(--i6);border-radius:9px;padding:11px 12px;margin-bottom:11px">
        ${head}
        <div style="font-size:11.5px;color:var(--i5);line-height:1.6">
          ${escapeHtml(a.role)}${eunNeun(a.role)} 이 행사에서 발제 정보를 받지 않아요.</div></div>`;
    }

    return `<div style="border:1px solid var(--i6);border-radius:9px;padding:11px 12px;margin-bottom:11px">
      ${head}
      ${nTitle ? `<div class="fgr">
        ${fg(`발제명 국문 ${NEED_MARK[nTitle]}`, txt(a.title_ko, `asField('${escAttr(a.id)}','title_ko',this.value,'발제명 국문')`))}
        ${fg(`발제명 영문 ${NEED_MARK[nTitle]}`, txt(a.title_en, `asField('${escAttr(a.id)}','title_en',this.value,'발제명 영문')`))}
      </div>` : ''}
      <div class="fgr">
        ${fg('발표 언어', `<select class="fi" onchange="asField('${escAttr(a.id)}','lang',this.value,'발표 언어')">
          <option value=""${!a.lang ? ' selected' : ''}>미정</option>
          <option value="ko"${a.lang === 'ko' ? ' selected' : ''}>국문</option>
          <option value="en"${a.lang === 'en' ? ' selected' : ''}>영문</option></select>`)}
        ${fg('발표 시간(분)', txt(a.duration_min, `asField('${escAttr(a.id)}','duration_min',this.value,'발표 시간')`, '20'))}
      </div>

      ${nAbs ? `<div style="margin-top:6px">
        ${gotRow('초록 받음', a.abstract_received_at,
          `asStamp('${escAttr(a.id)}','abstract_received_at','초록 받음')`,
          `asField('${escAttr(a.id)}','abstract_received_at',this.value,'초록 받은 날')`, nAbs)}
        ${fg(`초록 국문 · ${countHint(a.abstract_ko, lim.abstract)}`,
          area(a.abstract_ko, `asField('${escAttr(a.id)}','abstract_ko',this.value,'초록 국문')`, '', 5))}
        ${fg(`초록 영문 · ${countHint(a.abstract_en, lim.abstract)}`,
          area(a.abstract_en, `asField('${escAttr(a.id)}','abstract_en',this.value,'초록 영문')`, '', 5))}
      </div>` : ''}

      ${nSlides ? `<div style="margin-top:6px">
        ${gotRow('발표자료 받음', a.slides_received_at,
          `asStamp('${escAttr(a.id)}','slides_received_at','발표자료 받음')`,
          `asField('${escAttr(a.id)}','slides_received_at',this.value,'발표자료 받은 날')`, nSlides)}
        <div class="fgr">
          ${fg('파일명', txt(a.slides_file, `asField('${escAttr(a.id)}','slides_file',this.value,'발표자료 파일')`, '원드라이브 파일명'))}
          ${fg('판', txt(a.slides_version, `asField('${escAttr(a.id)}','slides_version',this.value,'발표자료 판')`, 'v2'))}
        </div>
        <div style="font-size:10px;color:var(--i4);margin-top:-4px">
          발표자료는 현장에서 바뀝니다 — 어느 판을 받았는지 적어 두면 무엇을 틀지 헷갈리지 않아요.</div>
      </div>` : ''}

      ${fg('메모', area(a.note, `asField('${escAttr(a.id)}','note',this.value,'발제 메모')`, '', 2))}
    </div>`;
  };

  return asg.map(block).join('');
}

/* ══════════════════════════════════════════════════════════════
   연락 상대 · 메일 · 기록

   연사와 직접 주고받는 일도 있지만, 조교수·조수 같은 실무진과 하는 일이
   더 많다. 그때 메일은 실무진이 수신이고 연사는 참조다 — 연사를 수신에
   두면 실무진이 답을 못 하고, 실무진만 두면 연사가 진행 상황을 모른다.
   그래서 상대마다 수신/참조를 정해 두고, 메일 칸을 그 값으로 채운다.

   보낸 메일은 speaker_logs에 남는다. 이게 빠지면 «이 연사에게 초록을 몇 번
   물었나»를 다시 셀 수 없고, 그러면 또 묻거나 아예 안 묻게 된다.
══════════════════════════════════════════════════════════════ */

const CONTACT_KINDS = ['연사 본인', '실무진', '비서', '기관 담당', '기타'];
const SEND_LABEL = { to: '수신', cc: '참조', '': '안 보냄' };

/* 이 연사에게 메일 보낼 때의 수신·참조 — 상대 목록에서 만든다 */
export function mailTargets(speakerId){
  const rows = contactsOfSpeaker(speakerId);
  const pick = (s) => rows.filter(r => r.send === s && String(r.email || '').trim())
    .map(r => String(r.email).trim());
  return { to: pick('to'), cc: pick('cc') };
}

function peopleTabHtml(sp){
  const rows = contactsOfSpeaker(sp.id);
  const t = mailTargets(sp.id);

  const row = (r) => `<div style="border:1px solid var(--i6);border-radius:8px;padding:9px 11px;margin-bottom:7px">
    <div class="fgr">
      ${fg('이름', txt(r.name, `scField('${escAttr(r.id)}','name',this.value,'연락 상대 이름')`, '홍길동'))}
      ${fg('관계', `<select class="fi" onchange="scField('${escAttr(r.id)}','kind',this.value,'연락 상대 관계')">
        ${CONTACT_KINDS.map(k => `<option value="${escAttr(k)}"${(r.kind || '') === k ? ' selected' : ''}>${k}</option>`).join('')}
      </select>`)}
    </div>
    <div class="fgr">
      ${fg('메일', txt(r.email, `scField('${escAttr(r.id)}','email',this.value,'연락 상대 메일')`, 'name@org.kr'))}
      ${fg('전화', txt(r.phone, `scField('${escAttr(r.id)}','phone',this.value,'연락 상대 전화')`))}
    </div>
    <div style="display:flex;align-items:center;gap:9px;margin-top:2px">
      <div class="seg">
        ${['to', 'cc', ''].map(s => `<button class="seg-b${(r.send || '') === s ? ' on' : ''}"
          onclick="scField('${escAttr(r.id)}','send','${s}','${SEND_LABEL[s]}')">${SEND_LABEL[s]}</button>`).join('')}
      </div>
      <button class="btn" style="font-size:10.5px;margin-left:auto" onclick="removeSpeakerContact('${escAttr(r.id)}')">삭제</button>
    </div>
  </div>`;

  const summary = `<div style="padding:9px 11px;background:var(--i8);border:1px solid var(--i6);
      border-radius:7px;font-size:11.5px;color:var(--i3);line-height:1.7;margin-bottom:11px">
      ${t.to.length ? `수신 <b>${escapeHtml(t.to.join(', '))}</b>` : '<b>수신이 비어 있어요</b> — 상대 하나를 수신으로 정해주세요'}
      ${t.cc.length ? `<br>참조 ${escapeHtml(t.cc.join(', '))}` : ''}
    </div>`;

  return summary
    + (rows.length ? rows.map(row).join('')
      : `<div style="font-size:11.5px;color:var(--i5);line-height:1.7;margin-bottom:9px">
        아직 연락 상대가 없어요. 실무진을 수신으로, 연사를 참조로 두는 게 보통입니다.</div>`)
    + `<button class="btn" style="font-size:11px" onclick="addSpeakerContact()">+ 연락 상대 추가</button>`;
}

export async function addSpeakerContact(){
  if(confLocked()){ confLockNotice(); return; }
  const sp = getSpeakerById(spId);
  if(!sp) return;
  /* 첫 상대는 연사 본인으로 두고 수신으로 잡는다 — 실무진이 붙으면 그때
     수신을 옮기면 된다. 처음부터 비워 두면 수신 없는 채로 메일 칸을 연다. */
  const first = !contactsOfSpeaker(sp.id).length;
  const row = {
    speaker_id: sp.id, contact_id: '',
    name: first ? (sp.name_snapshot || '') : '', email: '', phone: '',
    kind: first ? '연사 본인' : '실무진', send: first ? 'to' : 'cc', note: '',
  };
  const res = await saveSpeakerContact(row);
  if(!res || res.ok === false){ if(!res?.locked) alert('연락 상대를 추가하지 못했어요.'); return; }
  SPEAKER_CONTACTS.push({ ...row, id: res.id || `SC-tmp-${Date.now()}` });
  renderSpeakerDr();
}

export async function scField(id, field, value, label){
  if(confLocked()){ confLockNotice(); return; }
  const r = SPEAKER_CONTACTS.find(x => x.id === id);
  if(!r || String(r[field] ?? '') === String(value ?? '')) return;
  const backup = r[field];
  r[field] = value;
  renderSpeakerDr();
  const res = await saveSpeakerContact({ id, [field]: value });
  if(!res || res.ok === false){
    r[field] = backup; renderSpeakerDr();
    if(!res?.locked) alert('저장에 실패했어요.');
    return;
  }
  trackAction('edit', '연사 연락 상대', getSpeakerById(spId)?.event_id, `${speakerLabel()} — ${label || field}`);
}

export async function removeSpeakerContact(id){
  if(confLocked()){ confLockNotice(); return; }
  const r = SPEAKER_CONTACTS.find(x => x.id === id);
  if(!r) return;
  if(!confirm(`«${r.name || r.email || id}»을 연락 상대에서 지울까요?`)) return;
  const res = await deleteSpeakerContact(id);
  if(res && res.ok === false){ if(!res.locked) alert('지우지 못했어요.'); return; }
  const i = SPEAKER_CONTACTS.findIndex(x => x.id === id);
  if(i >= 0) SPEAKER_CONTACTS.splice(i, 1);
  trackAction('delete', '연사 연락 상대', getSpeakerById(spId)?.event_id, r.name || r.email || id);
  renderSpeakerDr();
}

/* ── 메일 ──
   무엇을 물을지가 정해져 있으니 제목·본문의 뼈대는 우리가 만든다. 사람이
   고쳐 보내는 걸 전제로 하고, 자동으로 나가는 일은 없다. */
const MAIL_KINDS = [
  { key: 'invite',   label: '초청' },
  { key: 'profile',  label: '이력·사진 요청' },
  { key: 'abstract', label: '발제명·초록 요청' },
  { key: 'slides',   label: '발표자료 요청' },
  { key: 'travel',   label: '숙박·항공 안내' },
  { key: 'note',     label: '기타' },
];

function mailTabHtml(sp, evKey){
  const t = mailTargets(sp.id);
  const ev = EVENT_LIST.find(e => e.key === evKey);
  const evName = ev ? (ev.name || ev.short || ev.key) : evKey;
  const logs = logsOfSpeaker(sp.id)
    .slice()
    .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));

  const logRow = (l) => `<div style="border-top:1px solid var(--i7);padding:7px 0">
    <div style="display:flex;gap:7px;align-items:baseline">
      <span class="pill p-gray" style="font-size:10px">${escapeHtml(l.category || '기타')}</span>
      <div style="font-size:11.5px;font-weight:600;flex:1;min-width:0">${escapeHtml(l.subject || '(제목 없음)')}</div>
      <div style="font-size:10.5px;color:var(--i4)">${escapeHtml(l.ts || '')}</div>
    </div>
    <div style="font-size:10.5px;color:var(--i4);margin-top:2px">${escapeHtml(l.counterpart || '')}</div>
  </div>`;

  return `
    <div style="padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;
      font-size:11.5px;color:var(--i3);line-height:1.7;margin-bottom:11px">
      ${t.to.length ? `수신 <b>${escapeHtml(t.to.join(', '))}</b>` : '<b style="color:var(--re)">수신이 없어요</b> — «연락 상대»에서 먼저 정해주세요'}
      ${t.cc.length ? `<br>참조 ${escapeHtml(t.cc.join(', '))}` : ''}
    </div>
    ${fg('무슨 메일인가', `<select class="fi" id="sp-mail-kind" onchange="fillSpeakerMail(this.value)">
      ${MAIL_KINDS.map(k => `<option value="${k.key}">${k.label}</option>`).join('')}</select>`,
      '고르면 제목·본문의 뼈대가 채워집니다 — 그대로 보내지 말고 고쳐 보내세요')}
    ${fg('제목', `<input class="fi" id="sp-mail-subject" value="${escAttr(`[${evName}] 연사 안내`)}">`)}
    ${fg('내용', `<textarea class="fi" id="sp-mail-body" rows="10" style="resize:vertical"></textarea>`)}
    <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
      <button class="btn bp" style="font-size:11px" onclick="sendSpeakerMail()">보내기</button>
      <span id="sp-mail-msg" style="font-size:10.5px;color:var(--i4)"></span>
    </div>

    <div style="font-size:11px;font-weight:700;color:var(--i3);margin:18px 0 2px">보낸 기록 ${logs.length || ''}</div>
    ${logs.length ? logs.map(logRow).join('')
      : `<div style="font-size:11px;color:var(--i4);padding:6px 0">아직 보낸 메일이 없어요</div>`}`;
}

/* 뼈대 채우기 — 무엇을 받아야 하는지는 역할에서 이미 알고 있다.
   해외 연사(영문만)에게는 영문으로 만든다. */
export function fillSpeakerMail(kind){
  const sp = getSpeakerById(spId);
  if(!sp) return;
  const evKey = sp.event_id;
  const ev = EVENT_LIST.find(e => e.key === evKey);
  const evName = ev ? (ev.name || ev.short || ev.key) : evKey;
  const cfg = confCfg(evKey);
  const lim = cfg.limits || {};
  const asg = assignmentsFor(sp.id);
  const en = sp.lang_pref === 'en';
  const name = sp.name_snapshot || '';

  const due = (k) => (cfg.due || {})[k] || '';
  const dueLine = (k, ko) => due(k) ? `\n- ${ko} 마감: ${due(k)}` : '';

  const sessions = asg.map(a => {
    const s = CONF_SESSIONS.find(x => x.id === a.session_id);
    return `  · ${s ? (s.title_ko || s.title_en || s.id) : ''}${s?.date ? ` (${s.date}${s.start_at ? ' ' + s.start_at : ''})` : ''} — ${a.role}`;
  }).join('\n');

  const bodies = {
    invite: en
      ? `Dear ${name},\n\nWe are pleased to invite you to ${evName}.\n\n${sessions ? `Your session(s):\n${sessions}\n\n` : ''}We would be grateful if you could confirm your participation.\n\nBest regards,`
      : `${name} 님, 안녕하세요.\n\n${evName}에 연사로 모시고자 연락드립니다.\n\n${sessions ? `배정 세션\n${sessions}\n\n` : ''}참석 가능 여부를 회신해 주시면 감사하겠습니다.\n\n감사합니다.`,
    profile: en
      ? `Dear ${name},\n\nCould you please send us the following for the programme book?\n- Professional experience${lim.bio_pro ? ` (within ${lim.bio_pro} characters)` : ''}\n- Working experience${lim.bio_work ? ` (within ${lim.bio_work} characters)` : ''}\n- A portrait photo (high resolution)\n\nBest regards,`
      : `${name} 님, 안녕하세요.\n\n프로그램북 제작을 위해 아래 자료를 부탁드립니다.\n- Professional experience${lim.bio_pro ? ` (${lim.bio_pro}자 이내)` : ''}\n- Working experience${lim.bio_work ? ` (${lim.bio_work}자 이내)` : ''}\n- 사진 (고해상도)${dueLine('profile', '자료')}\n\n감사합니다.`,
    abstract: en
      ? `Dear ${name},\n\nCould you please send us your presentation title and abstract?${lim.abstract ? `\nAbstract: within ${lim.abstract} characters.` : ''}\n\nBest regards,`
      : `${name} 님, 안녕하세요.\n\n발제명과 초록을 부탁드립니다.${lim.abstract ? `\n초록은 ${lim.abstract}자 이내로 부탁드립니다.` : ''}${dueLine('abstract', '초록')}\n\n감사합니다.`,
    slides: en
      ? `Dear ${name},\n\nCould you please send us your presentation file?\nIf you revise it later, please let us know which version is final.\n\nBest regards,`
      : `${name} 님, 안녕하세요.\n\n발표자료를 부탁드립니다.\n현장에서 수정하실 경우 어느 판이 최종인지 알려주시면 그대로 준비하겠습니다.${dueLine('slides', '발표자료')}\n\n감사합니다.`,
    travel: en
      ? `Dear ${name},\n\nWe will arrange your accommodation and flights.\nCould you please confirm your preferred dates and send a scan of your passport?\n\nBest regards,`
      : `${name} 님, 안녕하세요.\n\n숙박과 항공을 준비하겠습니다.\n희망 일정과 여권 스캔본을 보내주시면 예약 후 안내드리겠습니다.\n\n감사합니다.`,
    note: en ? `Dear ${name},\n\n\nBest regards,` : `${name} 님, 안녕하세요.\n\n\n감사합니다.`,
  };
  const subjects = {
    invite:   en ? `[${evName}] Invitation to speak` : `[${evName}] 연사 초청`,
    profile:  en ? `[${evName}] Speaker profile request` : `[${evName}] 이력·사진 요청`,
    abstract: en ? `[${evName}] Title & abstract request` : `[${evName}] 발제명·초록 요청`,
    slides:   en ? `[${evName}] Presentation file request` : `[${evName}] 발표자료 요청`,
    travel:   en ? `[${evName}] Accommodation & flight` : `[${evName}] 숙박·항공 안내`,
    note:     en ? `[${evName}]` : `[${evName}] 안내`,
  };
  const s = document.getElementById('sp-mail-subject');
  const b = document.getElementById('sp-mail-body');
  if(s) s.value = subjects[kind] || subjects.note;
  if(b) b.value = bodies[kind] || bodies.note;
  /* 이미 받은 항목을 알아서 빼 주고 싶지만 그러지 않는다 — 무엇을 뺐는지
     사람이 모르면 빠뜨린 요청을 눈치챌 수 없다. 뼈대만 주고 지우는 건 사람이 한다. */
}

export async function sendSpeakerMail(){
  if(confLocked()){ confLockNotice(); return; }
  const sp = getSpeakerById(spId);
  if(!sp) return;
  const msg = document.getElementById('sp-mail-msg');
  const say = (t, ok) => { if(msg){ msg.style.color = ok ? 'var(--g)' : 'var(--re)'; msg.textContent = t; } };

  const t = mailTargets(sp.id);
  if(!t.to.length){ say('수신이 없어요 — «연락 상대»에서 먼저 정해주세요.', false); return; }
  const subject = (document.getElementById('sp-mail-subject')?.value || '').trim();
  const text = (document.getElementById('sp-mail-body')?.value || '').trim();
  if(!subject && !text){ say('제목이나 내용 중 하나는 있어야 해요.', false); return; }
  const kind = document.getElementById('sp-mail-kind')?.value || 'note';
  const category = (MAIL_KINDS.find(k => k.key === kind) || {}).label || '기타';

  /* 밖으로 나가는 일은 한 번 묻는다 — 받는 사람을 눈으로 확인하지 않으면
     엉뚱한 사람에게 간 걸 나중에 알게 된다. */
  if(!confirm(`이 내용으로 보낼까요?\n\n수신 ${t.to.join(', ')}${t.cc.length ? `\n참조 ${t.cc.join(', ')}` : ''}\n제목 ${subject}`)) return;

  say('보내는 중…', true);
  const res = await sendMail({ to: t.to, cc: t.cc, subject, text, speaker_id: sp.id, category, kind });
  if(!res.ok){
    say(res.offline ? '테스트 모드에서는 보내지 않아요.' : (res.error || '보내지 못했어요.'), false);
    return;
  }
  /* 서버가 기록을 남긴다. 화면에도 같은 줄을 바로 끼운다 — 새로 고쳐야
     보이면 방금 보낸 게 안 남은 줄 알고 또 보낸다. */
  SPEAKER_LOGS.push({
    id: `SL-tmp-${Date.now()}`, speaker_id: sp.id, kind, ts: td(),
    direction: 'out', channel: '이메일',
    counterpart: [t.to.join(', '), t.cc.length ? `(cc) ${t.cc.join(', ')}` : ''].filter(Boolean).join(' '),
    category, subject, body: text, answered_at: '', answer: '', status: 'done',
    author_email: '', author_name: '',
  });
  trackAction('add', '연사 메일', sp.event_id, `${sp.name_snapshot || sp.id} — ${category}`);
  say(res.logged === false ? '보냈어요 — 다만 기록 저장에 실패했어요.' : '보냈어요.', true);
  renderSpeakerDr();
}

/* ── 노출 ── */
window.openSpeakerDr        = openSpeakerDr;
window.closeSpeakerDr       = closeSpeakerDr;
window.switchSpeakerDT      = switchSpeakerDT;
window.spField              = spField;
window.asField              = asField;
window.spStamp              = spStamp;
window.asStamp              = asStamp;
window.searchSpeakerContact = searchSpeakerContact;
window.linkSpeakerContact   = linkSpeakerContact;
window.unlinkSpeakerContact = unlinkSpeakerContact;
window.renderSpeakerDr      = renderSpeakerDr;
window.addSpeakerContact    = addSpeakerContact;
window.scField              = scField;
window.removeSpeakerContact = removeSpeakerContact;
window.fillSpeakerMail      = fillSpeakerMail;
window.sendSpeakerMail      = sendSpeakerMail;
