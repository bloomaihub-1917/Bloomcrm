/* ══════════════════════════════════════════════════════════════
   features/conference/sp-dr-basic.js — 연사 기본·이력·발제
   (modules/speaker-drawer.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { NEED_LABEL, NEED_MARK, SPEAKER_ROLES, SP_CONSENTS } from '../../constants.js';
import { trackAction } from '../../core/audit-log.js';
import { patchContact } from '../../modules/db-tab.js';
import { CONF_SESSIONS, SESSION_SPEAKERS, assignmentsFor, coOf, confCfg, contacts, contactsOfSpeaker, getSpeakerById, leadOf, nextContactId, rolesOfSpeaker, speakerNeed } from '../../state.js';
import { countryName, countryOptions, escAttr, escapeHtml, td } from '../../utils.js';
import { confLockNotice, confLocked, syncPartRole } from './conf-common.js';
import { spDrUi } from './speaker-drawer-ui.js';
import { STATUSES, area, asField, asStamp, closeSpeakerDr, countHint, dateIn, eunNeun, fg, gotRow, needState, patchSpeaker, renderSpeakerDr, spField, spStamp, txt } from '../../modules/speaker-drawer.js';

/* ══════════════════════════════════════════
   기본
══════════════════════════════════════════ */
function basicHtml(sp, con, evKey){
  const roles = rolesOfSpeaker(sp.id);
  // 연락 상대의 «연사 본인» 줄 — 마스터DB 연결이 없을 때 메일·전화가 여기 있다
  const selfRow = contactsOfSpeaker(sp.id).find(r => r.kind === '연사 본인') || null;
  const nOf = (k) => needState(evKey, roles, k);

  /* 연락처는 «지금 어디 있는 사람인가»를 보여줄 뿐 여기서 고치지 않는다.
     프로그램북에 나가는 값은 아래 스냅숏이다. 둘이 다르면 그 사실을 알려
     끌어올지 사람이 정하게 한다 — 조용히 덮으면 손으로 고쳐 둔 직함이 날아간다. */
  const diff = con && [
    ['소속', con.orgKo || '', sp.org_ko || ''],
    ['직함', con.titleKo || '', sp.title_ko || ''],
  ].filter(([, a, b]) => a && a !== b).map(([k]) => k);

  const conBox = con
    ? `<div style="padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:var(--rd-7)">
        <div style="font-size:var(--fs-12);font-weight:600">${escapeHtml(con.nameKo || con.nameEn || con.id)}
          ${con.nameKo && con.nameEn ? `<span style="font-weight:400;color:var(--i4);font-size:var(--fs-11)">${escapeHtml(con.nameEn)}</span>` : ''}</div>
        <div style="font-size:var(--fs-11);color:var(--i3);margin-top:2px">
          ${escapeHtml([con.orgKo, con.titleKo].filter(Boolean).join(' · ') || '(소속·직함 없음)')}</div>
        ${con.orgEn || con.titleEn ? `<div style="font-size:var(--fs-10_5);color:var(--i4)">${escapeHtml([con.orgEn, con.titleEn].filter(Boolean).join(' · '))}</div>` : ''}
        ${(() => {
          /* 메일·전화는 마스터DB 연락처에만 둔다 — 연사 쪽에 따로 적으면 번호가
             바뀌었을 때 어느 쪽이 맞는지 모르게 된다. 여기서 고치면 마스터DB가 고쳐진다. */
          /* 여기는 마스터DB에 «등록돼 있는 것»만 보여 준다. 고치는 칸은 위 «연락처»에 있다 —
             빈 칸에 예시 글자가 흐리게 들어가 있으면 값이 있는 줄 안다. */
          const have = [['email1', '메일'], ['email2', '메일 2'], ['phone1', '휴대폰'], ['phone2', '전화']]
            .filter(([k]) => String(con[k] || '').trim());
          return have.length ? `<div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin-top:6px;font-size:var(--fs-11)">
            ${have.map(([k, l]) => `<span style="color:var(--i4)">${l}</span><span style="color:var(--i2)">${escapeHtml(con[k])}</span>`).join('')}
          </div>` : `<div style="font-size:var(--fs-10_5);color:var(--i4);margin-top:6px">마스터DB에 등록된 메일·전화가 없어요</div>`;
        })()}
        ${diff.length ? `<div style="font-size:var(--fs-10_5);color:var(--am);margin-top:5px;line-height:1.6">
          마스터DB의 ${escapeHtml(diff.join('·'))}이 아래와 달라요.
          <br>연사 자료를 새로 받아 고친 것이면 <b>마스터DB로 보내기</b>,
          그 사람이 이직해 발표 당시 소속만 남겨야 하면 그대로 두세요.</div>` : ''}
        <div style="display:flex;gap:6px;margin-top:7px;flex-wrap:wrap">
          <button class="btn" style="font-size:var(--fs-10_5)" onclick="pushSpeakerProfile()"
            title="여기서 고친 소속·직함을 마스터DB 연락처에 반영합니다 — 기업DB도 새 소속으로 묶여요">마스터DB로 보내기</button>
          <button class="btn" style="font-size:var(--fs-10_5)" onclick="pullSpeakerProfile()">연락처에서 끌어오기</button>
          <button class="btn" style="font-size:var(--fs-10_5)" onclick="unlinkSpeakerContact()">연결 끊기</button>
        </div>
      </div>`
    : `<div style="padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:var(--rd-7)">
        <div style="font-size:var(--fs-11_5);color:var(--i3);line-height:1.6">
          연락처를 연결하면 소속·직함을 한 번에 끌어오고, 메일·전화도 여기 보입니다. 연결하지 않아도
          아래에 직접 적을 수 있어요.</div>
        <input class="fi" style="margin-top:7px" placeholder="이름·기업·메일로 검색…"
          oninput="searchSpeakerContact(this.value)">
        <div id="sp-con-hits" style="margin-top:5px"></div>
        <div style="display:flex;align-items:center;gap:7px;margin-top:7px;flex-wrap:wrap">
          <button class="btn" style="font-size:var(--fs-10_5)" onclick="createSpeakerContact()"
            title="아래 성명·소속·직함·국적으로 마스터DB에 연락처를 만들고 바로 연결합니다">마스터DB에 새로 등록</button>
          <span style="font-size:var(--fs-10);color:var(--i4)">검색해도 없을 때 — 아래 적은 값으로 만들고 연결해요</span>
        </div>
      </div>`;

  return `
    <div class="fgr">
      ${fg('성명 국문', txt(sp.name_snapshot, `spField('name_snapshot',this.value,'성명 국문')`, '홍길동'))}
      ${fg('성명 영문', txt(sp.name_en, `spField('name_en',this.value,'성명 영문')`, 'Gil-dong Hong'))}
    </div>
    <div style="font-size:var(--fs-10);color:var(--i4);margin:-4px 0 12px">
      프로그램에 나갈 이름입니다 — 연락처를 지워도 프로그램에서 사라지지 않도록 따로 굳혀 둡니다.
      해외 연사는 영문만 있어도 됩니다.</div>
    ${con ? `<div class="fgr">
      ${fg('메일', `<input class="fi" type="email" value="${escapeHtml(con.email1 || '')}" onchange="spContactField('email1',this.value)">`)}
      ${fg('메일 2', `<input class="fi" type="email" value="${escapeHtml(con.email2 || '')}" onchange="spContactField('email2',this.value)">`)}
    </div>
    <div class="fgr">
      ${fg('휴대폰', `<input class="fi" type="tel" value="${escapeHtml(con.phone1 || '')}" onchange="spContactField('phone1',this.value)">`)}
      ${fg('전화', `<input class="fi" type="tel" value="${escapeHtml(con.phone2 || '')}" onchange="spContactField('phone2',this.value)">`)}
    </div>
    <div style="font-size:var(--fs-10);color:var(--i4);margin:-4px 0 12px">
      메일·전화는 마스터DB 연락처에 저장돼요.${!con.email1 && selfRow && selfRow.email
        ? ` <span style="color:var(--am)">마스터DB엔 메일이 없고, «연락 상대»의 연사 본인 줄에 ${escapeHtml(selfRow.email)}이 있어 메일은 그 주소로 나갑니다.</span>` : ''}</div>`
    : selfRow ? `<div class="fgr">
      ${fg('메일', `<input class="fi" type="email" value="${escapeHtml(selfRow.email || '')}" onchange="scField('${escAttr(selfRow.id)}','email',this.value,'연사 본인 메일')">`)}
      ${fg('전화', `<input class="fi" type="tel" value="${escapeHtml(selfRow.phone || '')}" onchange="scField('${escAttr(selfRow.id)}','phone',this.value,'연사 본인 전화')">`)}
    </div>
    <div style="font-size:var(--fs-10);color:var(--i4);margin:-4px 0 12px">
      마스터DB 연락처가 연결되지 않아 «연락 상대»의 연사 본인 줄에 저장돼요. 아래에서 연결하면 마스터DB로 옮겨 적어 주세요.</div>`
    : `<div style="font-size:var(--fs-10_5);color:var(--i4);margin:-4px 0 12px">
      메일·전화는 아래 «연락처 연결»에서 마스터DB 연락처를 연결하면 적을 수 있어요.</div>`}
    <div class="fgr">
      ${fg('소속 국문', txt(sp.org_ko, `spField('org_ko',this.value,'소속 국문')`, '○○대학교'))}
      ${fg('소속 영문', txt(sp.org_en, `spField('org_en',this.value,'소속 영문')`, 'XX University'))}
    </div>
    <div class="fgr">
      ${fg('직함 국문', txt(sp.title_ko, `spField('title_ko',this.value,'직함 국문')`, '교수'))}
      ${fg('직함 영문', txt(sp.title_en, `spField('title_en',this.value,'직함 영문')`, 'Professor'))}
    </div>
    <div style="font-size:var(--fs-10);color:var(--i4);margin:-4px 0 12px">
      프로그램북에 나가는 값입니다 — 발표 당시의 소속이라, 나중에 이직해도 그대로 둡니다.</div>
    <div class="fgr">
      ${fg('국적', `<select class="fi" onchange="spField('nationality',this.value,'국적')">
        <option value="">미정</option>${countryOptions(sp.nationality)}</select>`)}
      ${fg('거주지', `<select class="fi" onchange="spField('residence_country',this.value,'거주지')">
        <option value="">미정</option>${countryOptions(sp.residence_country)}</select>`)}
    </div>
    ${countryGapNote(sp)}
    ${fg('연락처 연결' + (nOf('profile') ? ` ${NEED_MARK[nOf('profile')]}` : ''), conBox)}
    <div class="fgr">
      ${fg('섭외 상태', `<select class="fi" onchange="spField('status',this.value,'섭외 상태')">
        ${STATUSES.map(s => `<option value="${escapeHtml(s)}"${(sp.status || '섭외중') === s ? ' selected' : ''}>${s}</option>`).join('')}</select>`)}
      ${fg('언어', `<select class="fi" onchange="spField('lang_pref',this.value,'언어')">
        <option value=""${!sp.lang_pref ? ' selected' : ''}>미정</option>
        <option value="both"${sp.lang_pref === 'both' ? ' selected' : ''}>국·영문 모두</option>
        <option value="en"${sp.lang_pref === 'en' ? ' selected' : ''}>영문만 (해외 연사)</option>
      </select>`, '국가로 짐작하지 않고 물어서 적습니다')}
    </div>
    <div style="font-size:var(--fs-11);font-weight:700;color:var(--i3);margin:16px 0 4px">보낸 것</div>
    <div style="font-size:var(--fs-10);color:var(--i4);margin-bottom:6px;line-height:1.6">
      받은 것만 적어 두면 «왜 안 오지»를 묻게 됩니다 — 안 보냈을 수도 있어요.</div>
    ${gotRow('초청 · 가이드라인 · 양식', sp.guide_sent_at, `spStamp('guide_sent_at','초청·가이드라인 보냄')`,
      `spField('guide_sent_at',this.value,'초청·가이드라인 발송')`)}
    ${gotRow('마지막 독촉', sp.reminded_at, `spStamp('reminded_at','독촉')`,
      `spField('reminded_at',this.value,'마지막 독촉')`)}
    <div class="fgr" style="margin-top:10px">
      ${fg('초청 회신', dateIn(sp.invite_replied_at, `spField('invite_replied_at',this.value,'초청 회신')`))}
      ${fg('참가 확정', dateIn(sp.confirmed_at, `spField('confirmed_at',this.value,'참가 확정')`))}
    </div>
    ${fg('갈라디너', `<select class="fi" onchange="spField('gala_rsvp',this.value,'갈라디너')">
      <option value=""${!sp.gala_rsvp ? ' selected' : ''}>미확인</option>
      <option value="yes"${sp.gala_rsvp === 'yes' ? ' selected' : ''}>참석</option>
      <option value="no"${sp.gala_rsvp === 'no' ? ' selected' : ''}>불참</option>
    </select>`, '신청서의 갈라디너 참석 여부')}

    <div style="font-size:var(--fs-11);font-weight:700;color:var(--i3);margin:16px 0 4px">받은 것</div>
    ${nOf('photo') ? gotRow('연사 사진', sp.photo_received_at,
      `spStamp('photo_received_at','사진 받음')`,
      `spField('photo_received_at',this.value,'사진 받은 날')`, nOf('photo')) : ''}
    ${nOf('photo') ? window.photoBoxHtml(sp, evKey) : ''}
    ${nOf('photo') ? fg('사진 파일명', txt(sp.photo_file, `spField('photo_file',this.value,'사진 파일')`, '원드라이브 파일명'),
      '원본은 원드라이브가 정본입니다 — 인쇄물에는 원본을 씁니다') : ''}
    ${nOf('consent') ? gotRow('개인정보 제공 동의서', sp.consent_at,
      `spStamp('consent_at','동의서 받음')`,
      `spField('consent_at',this.value,'동의서 받은 날')`, nOf('consent')) : ''}
    ${nOf('consent') ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px;margin:6px 0 4px">
      ${SP_CONSENTS.map(c => `<label style="font-size:var(--fs-10_5);color:${sp[c.key] === 'no' ? 'var(--re)' : 'var(--i3)'}">${c.label}
        <select class="fi" style="font-size:var(--fs-11);padding:3px 5px${sp[c.key] === 'no' ? ';border-color:var(--re);color:var(--re)' : ''}"
          onchange="spField('${c.key}',this.value,'동의 — ${c.label}')">
          <option value=""${!sp[c.key] ? ' selected' : ''}>미확인</option>
          <option value="yes"${sp[c.key] === 'yes' ? ' selected' : ''}>동의</option>
          <option value="no"${sp[c.key] === 'no' ? ' selected' : ''}>동의 안 함</option>
        </select></label>`).join('')}
    </div>
    ${fg('동의서 파일명', txt(sp.consent_file, `spField('consent_file',this.value,'동의서 파일')`, '원드라이브 파일명'))}
    ${fg('동의 메모', txt(sp.consent_note, `spField('consent_note',this.value,'동의 메모')`, '예: 영상 촬영은 발표 앞부분만'))}` : ''}

    <div class="fgr" style="margin-top:10px">
      ${fg('발표 영상 게재', `<select class="fi" onchange="spField('video_publish',this.value,'영상 게재 동의')"
        ${sp.video_publish === 'no' ? 'style="border-color:var(--re);color:var(--re)"' : ''}>
        <option value=""${!sp.video_publish ? ' selected' : ''}>미확인</option>
        <option value="yes"${sp.video_publish === 'yes' ? ' selected' : ''}>동의</option>
        <option value="no"${sp.video_publish === 'no' ? ' selected' : ''}>비동의</option>
      </select>`, '행사 뒤 홈페이지·교육 자료 게재')}
      ${fg('회신 받은 날', dateIn(sp.video_publish_at, `spField('video_publish_at',this.value,'영상 게재 회신')`))}
    </div>

    ${fg('메모', area(sp.note, `spField('note',this.value,'메모')`, '섭외 경위, 주의할 점 등', 3))}`;
}

/* 국적과 거주지가 다르면 알려 준다. 다를 때가 문제이기 때문이다 —
   한국 국적이지만 해외에 사는 연사는 연사료를 해외 거주자로 원천징수하고
   항공도 거주지에서 띄운다. 어느 쪽 기준인지는 우리가 정하지 않는다. */
function countryGapNote(sp){
  const nat = sp.nationality, res = sp.residence_country;
  if(!nat || !res || nat === res) return '';
  return `<div style="font-size:var(--fs-10_5);color:var(--am);margin:-6px 0 12px;line-height:1.6">
    국적(${escapeHtml(countryName(nat))})과 거주지(${escapeHtml(countryName(res))})가 달라요 —
    연사료·항공을 어느 쪽 기준으로 할지는 «제공사항»에서 정하세요.</div>`;
}

/* 이 연사에게 적용할 기준 국가 — 정하지 않았으면 거주지를 먼저 본다.
   돈을 보내고 비행기를 띄우는 일은 그 사람이 지금 있는 곳에서 일어난다. */
export function payCountry(sp){
  if(sp.pay_basis === 'nationality') return sp.nationality || sp.residence_country || '';
  return sp.residence_country || sp.nationality || '';
}

/* 드로어에서 지우면 드로어부터 닫는다 — 지워진 사람을 그리려다 빈 화면이
   남는다. 실제로 지우는 일은 연사 탭 한 곳에서만 한다(묻는 말이 두 벌이 되면
   한쪽이 빠뜨린다). */
export function removeSpeakerFromDr(){
  const id = spDrUi.spId;
  if(!id) return;
  closeSpeakerDr();
  window.removeConfSpeaker?.(id);
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
    : `<div style="font-size:var(--fs-11);color:var(--i4);padding:5px 2px">찾는 사람이 없어요 — 아래 «마스터DB에 새로 등록»으로 만들 수 있어요</div>`;
}

/* 마스터DB에 없는 연사를 여기서 바로 만든다. 전에는 «마스터DB에 먼저
   등록하라»고만 했는데, 그러려면 드로어를 닫고 다른 탭에서 같은 이름·소속을
   다시 적어야 했다 — 그래서 연결 안 된 연사가 쌓였다. 연사에 이미 적은
   값으로 만들고 곧바로 잇는다. */
export async function createSpeakerContact(){
  if(confLocked()){ confLockNotice(); return; }
  const sp = getSpeakerById(spDrUi.spId);
  if(!sp) return;
  const nameKo = String(sp.name_snapshot || '').trim(), nameEn = String(sp.name_en || '').trim();
  if(!nameKo && !nameEn){ alert('성명을 먼저 적어주세요.'); return; }

  /* 같은 이름이 이미 있으면 한 번 묻는다 — 검색을 건너뛰고 누르는 일이 있다 */
  const same = contacts.filter(c => (nameKo && c.nameKo === nameKo) || (nameEn && c.nameEn === nameEn));

  /* 이름에 소속까지 같으면 같은 사람이다 — 새로 만들지 않고 그 사람을 고르게 한다.
     행사마다 «새로 등록»을 눌러 같은 사람이 둘 생겼다(노연홍, 11-04 Jump AI·GPBFair). */
  const normOrg = s => String(s || '').toLowerCase().replace(/\(주\)|㈜|\(재\)|주식회사|재단법인|\s|[().,]/g, '');
  const spOrgs = [sp.org_ko, sp.org_en].map(normOrg).filter(Boolean);
  const sameOrg = same.filter(c => {
    const orgs = [c.orgKo, c.orgEn].map(normOrg).filter(Boolean);
    return !spOrgs.length || !orgs.length || orgs.some(o => spOrgs.includes(o));
  });
  if(sameOrg.length){
    const box = document.getElementById('sp-con-hits');
    if(box) box.innerHTML = `<div style="font-size:var(--fs-11);color:var(--re);padding:5px 2px">
        마스터DB에 이미 있는 사람이에요 — 새로 만들지 않고 아래에서 골라 연결해 주세요</div>`
      + sameOrg.slice(0, 8).map(c => `<div class="drw" onclick="linkSpeakerContact('${escAttr(c.id)}')">
        <div><div class="drn">${escapeHtml(c.nameKo || c.nameEn || c.id)} <span class="btn" style="font-size:var(--fs-10);padding:1px 6px">이 사람으로 연결</span></div>
        <div class="drm">${escapeHtml([c.orgKo || c.orgEn, c.titleKo || c.titleEn, c.email1].filter(Boolean).join(' · '))}</div></div>
      </div>`).join('');
    else alert(`마스터DB에 이미 있는 사람이에요: ${sameOrg[0].nameKo || sameOrg[0].nameEn} — ${sameOrg[0].orgKo || sameOrg[0].orgEn || '소속 없음'}\n검색해서 연결해 주세요.`);
    return;
  }

  if(same.length && !confirm(`마스터DB에 같은 이름이 ${same.length}명 있어요:

${
      same.slice(0, 5).map(c => `· ${c.nameKo || c.nameEn} — ${c.orgKo || c.orgEn || '소속 없음'}`).join('\n')
    }

그래도 새로 만들까요? (같은 사람이면 취소하고 위에서 검색해 연결하세요)`)) return;

  const c = {
    id: nextContactId(),   // 규칙 하나로(CLAUDE.md) — 16자리 이하, 남과 안 겹친다
    nameKo, nameEn,
    orgKo: sp.org_ko || '', orgEn: sp.org_en || '',
    titleKo: sp.title_ko || '', titleEn: sp.title_en || '',
    deptKo: '', deptEn: '',
    country: sp.nationality || sp.residence_country || '', cat: 'speaker', lang: nameKo ? 'KO' : 'EN',
    source: `${sp.event_id || ''} 연사`, date: td(), status: 'new',
    email1: '', email2: '', phone1: '', phone2: '',
    beat: '', products: '', tags: '', org_id: '',
  };
  contacts.push(c);
  const { postToSheet } = await import('../../api.js');
  const r = await postToSheet({
    sheet: 'contacts',
    row: [c.id, c.nameKo, c.nameEn, c.orgKo, c.orgEn, c.titleKo, c.titleEn, c.deptKo, c.deptEn,
      c.country, c.cat, c.lang, c.source, c.date, c.status, c.email1, c.email2, c.phone1, c.phone2,
      c.beat, c.products, c.tags, c.org_id],
  }, '연사 마스터DB 등록', { silent: true });
  if(!r || !r.ok){
    const i = contacts.indexOf(c);
    if(i >= 0) contacts.splice(i, 1);
    alert('마스터DB 저장에 실패했어요. 잠시 뒤 다시 해주세요.');
    return;
  }
  trackAction('add', '연사 마스터DB 등록', sp.event_id || '', `${nameKo || nameEn} 마스터DB 등록 + 연사 연결`,
    { kind: 'contact', id: String(c.id) });
  await linkSpeakerContact(String(c.id));
}

/* 기본 탭의 메일·전화 칸 — 연결된 마스터DB 연락처를 고친다 */
export async function spContactField(k, v){
  const sp = getSpeakerById(spDrUi.spId);
  const c = sp && sp.contact_id ? contacts.find(x => String(x.id) === String(sp.contact_id)) : null;
  if(!c) return;
  const val = String(v || '').trim();
  if(String(c[k] || '') === val) return;
  const res = await patchContact(c, { [k]: val }, '연사 화면에서 연락처 수정');
  if(!res || res.ok === false){ alert('마스터DB에 저장하지 못했어요. 잠시 뒤 다시 해주세요.'); return; }
  trackAction('edit', '연락처', sp.event_id || '', `${c.nameKo || c.nameEn} — ${k} 고침 (연사 화면)`,
    { kind: 'contact', id: String(c.id) });
  // 아래 마스터 카드·연락 상대·메일 수신이 새 값을 읽게 다시 그린다
  renderSpeakerDr();
}

export async function linkSpeakerContact(cid){
  const c = contacts.find(x => String(x.id) === String(cid));
  const sp = getSpeakerById(spDrUi.spId);
  if(!c || !sp) return;
  /* 이름 스냅숏이 비어 있으면 연락처 이름으로 채운다. 이미 적혀 있으면
     건드리지 않는다 — 프로그램에 나갈 이름을 손으로 고쳐 뒀을 수 있다. */
  const patch = { contact_id: String(c.id) };
  const fill = (field, v) => { if(!sp[field] && v) patch[field] = v; };
  fill('name_snapshot', c.nameKo || c.nameEn);
  fill('name_en', c.nameEn);
  fill('org_ko', c.orgKo); fill('org_en', c.orgEn);
  fill('title_ko', c.titleKo); fill('title_en', c.titleEn);
  await patchSpeaker(patch, `연락처 연결 (${c.nameKo || c.nameEn || c.id})`);
  await syncPartRole(sp.id);   // 마스터DB 참가 역할(VIP·연사)을 맞추거나 만든다
}
/* 연락처의 값으로 스냅숏을 덮는다. 자동으로 하지 않는 이유는, 손으로 고쳐
   둔 직함(«대표» → «Founder & CEO» 같은)이 조용히 날아가기 때문이다. */
export async function pullSpeakerProfile(){
  const sp = getSpeakerById(spDrUi.spId);
  const c = sp && sp.contact_id ? contacts.find(x => String(x.id) === String(sp.contact_id)) : null;
  if(!c) return;
  const patch = {};
  const set = (field, v) => { if((v || '') !== (sp[field] || '')) patch[field] = v || ''; };
  set('name_en', c.nameEn);
  set('org_ko', c.orgKo); set('org_en', c.orgEn);
  set('title_ko', c.titleKo); set('title_en', c.titleEn);
  if(!Object.keys(patch).length){ alert('연락처와 이미 같아요.'); return; }
  const LABEL = { name_en: '성명 영문', org_ko: '소속 국문', org_en: '소속 영문',
    title_ko: '직함 국문', title_en: '직함 영문' };
  const lines = Object.entries(patch)
    .map(([k, v]) => `${LABEL[k] || k}: ${sp[k] || '(비어 있음)'} → ${v || '(비움)'}`)
    .join('\n');
  if(!confirm(`연락처의 값으로 덮을까요?\n\n${lines}`)) return;
  await patchSpeaker(patch, '연락처에서 소속·직함 끌어옴');
}

/* 여기서 고친 소속·직함을 마스터DB로 보낸다.

   스냅숏은 «발표 당시»를 굳히려고 둔 것이지만, 연사 자료를 받아 고치는
   시점에는 그게 곧 «지금»이다. 그때 마스터DB가 옛 값으로 남으면 마스터DB가
   틀린 값을 들고 있게 되고, 기업DB에는 그 회사가 아예 안 생긴다.

   자동으로 흘려보내지 않는다 — 프로그램북 표기를 일부러 다르게 둔 경우가
   있어서다(영문 표기 정리, 구 사명 유지). 무엇이 어떻게 바뀌는지 보여주고
   사람이 누른다. */
export async function pushSpeakerProfile(){
  const sp = getSpeakerById(spDrUi.spId);
  const c = sp && sp.contact_id ? contacts.find(x => String(x.id) === String(sp.contact_id)) : null;
  if(!sp) return;
  if(!c){
    alert('연락처가 연결되지 않아 보낼 곳이 없어요.\n위에서 연락처를 찾아 연결해주세요.');
    return;
  }
  const MAP = [
    ['nameKo',  'name_snapshot', '성명 국문'],
    ['nameEn',  'name_en',       '성명 영문'],
    ['orgKo',   'org_ko',   '소속 국문'],
    ['orgEn',   'org_en',   '소속 영문'],
    ['titleKo', 'title_ko', '직함 국문'],
    ['titleEn', 'title_en', '직함 영문'],
  ];
  const patch = {};
  const lines = [];
  MAP.forEach(([cf, sf, label]) => {
    const v = String(sp[sf] ?? '').trim();
    /* 연사 쪽이 빈 칸이면 보내지 않는다 — 안 받은 값으로 마스터DB를 지우면
       원래 있던 정보가 사라진다. */
    if(!v || String(c[cf] ?? '').trim() === v) return;
    patch[cf] = v;
    lines.push(`${label}: ${c[cf] || '(비어 있음)'} → ${v}`);
  });
  if(!lines.length){ alert('마스터DB와 이미 같아요.'); return; }

  const orgChanging = 'orgKo' in patch || 'orgEn' in patch;
  if(!confirm(`마스터DB의 «${c.nameKo || c.nameEn || c.id}»을 이렇게 고칠까요?\n\n${lines.join('\n')}`
    + (orgChanging ? '\n\n기업DB도 새 소속으로 묶입니다. 그 기업이 없으면 만들어요.' : '')
    + '\n\n연사 쪽 값은 그대로 남습니다(발표 당시 소속).')) return;

  const res = await patchContact(c, patch, '연사 자료로 연락처 수정');
  if(!res || res.ok === false){ alert('마스터DB에 반영하지 못했어요.'); return; }
  trackAction('edit', '연락처(연사 자료 반영)', sp.event_id,
    `${c.nameKo || c.nameEn || c.id} — ${lines.join(' · ')}`);
  renderSpeakerDr();
  alert('마스터DB에 반영했어요.');
}

export async function unlinkSpeakerContact(){
  await patchSpeaker({ contact_id: '' }, '연락처 연결 끊기');
}

/* ══════════════════════════════════════════
   이력 — 국·영문 따로. 해외 연사는 영문만 오는 게 정상이다.
══════════════════════════════════════════ */
/* 이력으로 받는 것들. 순서는 프로필에 실리는 순서를 따랐다 —
   한 문단 소개 → 경력 → 학력 → 수상. 받은 글을 그대로 옮겨 붙일 수 있어야
   프로그램북을 만들 때 다시 자르지 않는다. */
export const BIO_PARTS = [
  { need: 'bio_profile', label: 'Professional Profile', ko: 'bio_profile_ko', en: 'bio_profile_en',
    lim: 'bio_profile', hint: '한 문단짜리 소개 — 현장 소개 멘트로도 씁니다' },
  { need: 'bio_pro',  label: 'Professional experience', ko: 'bio_pro_ko',  en: 'bio_pro_en',  lim: 'bio_pro' },
  { need: 'bio_work', label: 'Working experience',      ko: 'bio_work_ko', en: 'bio_work_en', lim: 'bio_work' },
  { need: 'bio_edu',  label: 'Education',               ko: 'bio_edu_ko',  en: 'bio_edu_en',  lim: 'bio_edu' },
  { need: 'bio_awards', label: 'Selected Awards & Recognitions', ko: 'bio_awards_ko', en: 'bio_awards_en',
    lim: 'bio_awards', hint: '국제 수상·선정 이력' },
  { need: 'bio_credentials', label: 'Licenses & Credentials', ko: 'bio_credentials_ko', en: 'bio_credentials_en',
    lim: 'bio_credentials', rows: 2, hint: '이름 옆에 붙는 자격 — 예: AIA · LEED AP' },
  { need: 'bio_teaching', label: 'Academic & Teaching', ko: 'bio_teaching_ko', en: 'bio_teaching_en',
    lim: 'bio_teaching' },
  { need: 'bio_affil', label: 'Affiliations & Public Service', ko: 'bio_affil_ko', en: 'bio_affil_en',
    lim: 'bio_affil' },
  { need: 'bio_pubs', label: 'Press · Publications · Exhibitions', ko: 'bio_pubs_ko', en: 'bio_pubs_en',
    lim: 'bio_pubs' },
];

function bioHtml(sp, evKey){
  const roles = rolesOfSpeaker(sp.id);
  const lim = confCfg(evKey).limits || {};
  const enOnly = sp.lang_pref === 'en';
  const parts = BIO_PARTS.map(p => ({ ...p, state: needState(evKey, roles, p.need) }))
    .filter(p => p.state);

  if(!parts.length){
    return `<div style="padding:16px;background:var(--i8);border:1px solid var(--i6);border-radius:var(--r);
      font-size:var(--fs-12);color:var(--i5);line-height:1.7">
      이 연사의 역할(${escapeHtml(roles.join(' · ') || '배정 없음')})은 이력을 받지 않아요.
      받아야 한다면 설정 › 행사 관리 › 컨퍼런스에서 역할별 항목을 고치세요.</div>`;
  }

  const pair = (p) => {
    const koVal = sp[p.ko], enVal = sp[p.en];
    const limit = lim[p.lim];
    return `<div style="margin-bottom:16px">
      <div style="display:flex;align-items:baseline;gap:7px;margin-bottom:5px">
        <div style="font-size:var(--fs-11_5);font-weight:700">${escapeHtml(p.label)}</div>
        <div style="font-size:var(--fs-10);color:var(--i4)" title="${escapeHtml(NEED_LABEL[p.state] || '')}">${NEED_MARK[p.state] || ''}</div>
        ${p.hint ? `<div style="font-size:var(--fs-10);color:var(--i4)">${escapeHtml(p.hint)}</div>` : ''}
      </div>
      ${enOnly ? '' : fg(`국문 · ${countHint(koVal, limit)}`,
        area(koVal, `spField('${p.ko}',this.value,'${escAttr(p.label)} 국문')`, '', p.rows || 5))}
      ${fg(`영문 · ${countHint(enVal, limit)}`,
        area(enVal, `spField('${p.en}',this.value,'${escAttr(p.label)} 영문')`, '', p.rows || 5))}
    </div>`;
  };

  return `
    ${enOnly ? `<div style="padding:8px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:var(--rd-7);
      font-size:var(--fs-11);color:var(--i3);margin-bottom:12px">
      해외 연사(영문만)로 적혀 있어 국문 칸을 숨겼어요. 기본 탭의 «언어»를 바꾸면 다시 보여요.</div>` : ''}
    ${needState(evKey, roles, 'cv') ? `
      ${gotRow('CV 원본 받음', sp.cv_received_at, `spStamp('cv_received_at','CV 받음')`,
        `spField('cv_received_at',this.value,'CV 받은 날')`, needState(evKey, roles, 'cv'))}
      ${fg('CV 파일명', txt(sp.cv_file, `spField('cv_file',this.value,'CV 파일')`, '원드라이브 파일명'),
        'CV는 4쪽이 넘기도 해요 — 아래 칸에는 프로그램북에 나갈 것만 옮기고 원본은 폴더에 둡니다')}` : ''}
    ${needState(evKey, roles, 'languages') ? fg(
      `구사 언어 ${NEED_MARK[needState(evKey, roles, 'languages')] || ''}`,
      txt(sp.languages, `spField('languages',this.value,'구사 언어')`, '영어(업무 가능) · 중국어(모국어) · 일본어'),
      '통역을 붙일지 정할 때 봅니다 — 위 «언어»는 우리가 자료를 어느 언어로 받는지예요') : ''}
    ${gotRow('이력 받음', sp.profile_received_at,
      `spStamp('profile_received_at','이력 받음')`,
      `spField('profile_received_at',this.value,'이력 받은 날')`,
      parts.some(p => p.state === 'req') ? 'req' : 'opt')}
    <div style="font-size:var(--fs-10_5);color:var(--i4);margin:5px 0 14px">
      받았는지는 이 체크로 봅니다 — 해외 연사는 국문이 비는 게 정상이라 글자 유무로 세지 않아요.</div>
    ${parts.map(pair).join('')}`;
}

/* ══════════════════════════════════════════
   발제 — 배정마다 하나. 역할이 묻지 않는 항목은 아예 보이지 않는다.
══════════════════════════════════════════ */
function talkHtml(sp, evKey){
  const asg = assignmentsFor(sp.id);
  if(!asg.length){
    return `<div style="padding:16px;background:var(--i8);border:1px solid var(--i6);border-radius:var(--r);
      font-size:var(--fs-12);color:var(--i5);line-height:1.7">
      아직 세션에 배정되지 않았어요. «프로그램»에서 세션에 넣고 역할을 정하면
      그 역할이 요구하는 발제 정보가 여기 나타납니다.</div>`;
  }
  const lim = confCfg(evKey).limits || {};

  const block = (a) => {
    const s = CONF_SESSIONS.find(x => x.id === a.session_id);
    /* 공동 발표면 발표 칸은 주 발표자 줄에 적는다 — 어느 쪽 드로어에서 고쳐도 같은 줄 */
    const tid = a.talk_id || a.id;
    const raw = SESSION_SPEAKERS.find(x => x.id === a.id) || a;
    const partners = [leadOf(raw), ...coOf(leadOf(raw))].filter(x => x && x.id !== a.id)
      .map(x => getSpeakerById(x.speaker_id)).filter(Boolean)
      .map(p => p.name_snapshot || p.name_en || p.id);
    const coNote = partners.length ? `<div style="font-size:var(--fs-10_5);color:var(--a);background:var(--i8);border-radius:var(--rd-6);padding:6px 8px;margin-bottom:9px;line-height:1.6">
      ${escapeHtml(partners.join(', '))}와(과) 공동 발표 — 시간·발제·초록·자료를 함께 씁니다.
      여기서 고치면 상대 쪽에도 같이 바뀌어요.</div>` : '';
    const need = (k) => speakerNeed(evKey, a.role, k);
    const nTitle = need('title'), nAbs = need('abstract'), nSlides = need('slides');
    const head = `<div style="display:flex;align-items:baseline;gap:7px;margin-bottom:7px">
      <span class="pill ${(SPEAKER_ROLES.find(r => r.key === a.role) || {}).cls || 'p-gray'}" style="font-size:var(--fs-10)">${escapeHtml(a.role || '역할 없음')}</span>
      <div style="font-size:var(--fs-12);font-weight:600;min-width:0">${escapeHtml(s ? (s.title_ko || s.title_en || s.id) : '(삭제된 세션)')}</div>
      <div style="font-size:var(--fs-10_5);color:var(--i4)">${escapeHtml(
        [s?.date, a.start_at ? `${a.start_at}${a.end_at ? '–' + a.end_at : ''}` : s?.start_at].filter(Boolean).join(' '))}</div>
    </div>`;

    if(!nTitle && !nAbs && !nSlides){
      return `<div style="border:1px solid var(--i6);border-radius:var(--rd-9);padding:11px 12px;margin-bottom:11px">
        ${head}
        <div style="font-size:var(--fs-11_5);color:var(--i5);line-height:1.6">
          ${escapeHtml(a.role)}${eunNeun(a.role)} 이 행사에서 발제 정보를 받지 않아요.</div></div>`;
    }

    return `<div style="border:1px solid var(--i6);border-radius:var(--rd-9);padding:11px 12px;margin-bottom:11px">
      ${head}${coNote}
      ${nTitle ? `<div class="fgr">
        ${fg(`발제명 국문 ${NEED_MARK[nTitle]}`, txt(a.title_ko, `asField('${escAttr(tid)}','title_ko',this.value,'발제명 국문')`))}
        ${fg(`발제명 영문 ${NEED_MARK[nTitle]}`, txt(a.title_en, `asField('${escAttr(tid)}','title_en',this.value,'발제명 영문')`))}
      </div>` : ''}
      <div class="fgr">
        ${fg('발표 시작', `<input class="fi" type="time" value="${escapeHtml(a.start_at || '')}"
          onchange="asField('${escAttr(tid)}','start_at',this.value,'발표 시작')">`)}
        ${fg('발표 종료', `<input class="fi" type="time" value="${escapeHtml(a.end_at || '')}"
          onchange="asField('${escAttr(tid)}','end_at',this.value,'발표 종료')">`)}
      </div>
      <div style="font-size:var(--fs-10);color:var(--i4);margin:-6px 0 10px">
        세션 시간이 아니라 이 사람이 올라가는 시각입니다 — 연사 안내와 프로그램북에 이 값이 나갑니다.</div>
      <div class="fgr">
        ${fg('발표 언어', `<select class="fi" onchange="asField('${escAttr(tid)}','lang',this.value,'발표 언어')">
          <option value=""${!a.lang ? ' selected' : ''}>미정</option>
          <option value="ko"${a.lang === 'ko' ? ' selected' : ''}>국문</option>
          <option value="en"${a.lang === 'en' ? ' selected' : ''}>영문</option></select>`)}
        ${fg('길이(분)', txt(a.duration_min, `asField('${escAttr(tid)}','duration_min',this.value,'발표 길이')`, '20'))}
      </div>

      ${nAbs ? `<div style="margin-top:6px">
        ${gotRow('초록 받음', a.abstract_received_at,
          `asStamp('${escAttr(tid)}','abstract_received_at','초록 받음')`,
          `asField('${escAttr(tid)}','abstract_received_at',this.value,'초록 받은 날')`, nAbs)}
        ${fg(`초록 국문 · ${countHint(a.abstract_ko, lim.abstract)}`,
          area(a.abstract_ko, `asField('${escAttr(tid)}','abstract_ko',this.value,'초록 국문')`, '', 5))}
        ${fg(`초록 영문 · ${countHint(a.abstract_en, lim.abstract)}`,
          area(a.abstract_en, `asField('${escAttr(tid)}','abstract_en',this.value,'초록 영문')`, '', 5))}
      </div>` : ''}

      ${nSlides ? `<div style="margin-top:6px">
        ${gotRow('발표자료 받음', a.slides_received_at,
          `asStamp('${escAttr(tid)}','slides_received_at','발표자료 받음')`,
          `asField('${escAttr(tid)}','slides_received_at',this.value,'발표자료 받은 날')`, nSlides)}
        <div class="fgr">
          ${fg('파일명', txt(a.slides_file, `asField('${escAttr(tid)}','slides_file',this.value,'발표자료 파일')`, '원드라이브 파일명'))}
          ${fg('판', txt(a.slides_version, `asField('${escAttr(tid)}','slides_version',this.value,'발표자료 판')`, 'v2'))}
        </div>
        <div style="font-size:var(--fs-10);color:var(--i4);margin-top:-4px">
          발표자료는 현장에서 바뀝니다 — 어느 판을 받았는지 적어 두면 무엇을 틀지 헷갈리지 않아요.</div>
      </div>` : ''}

      ${nTitle ? `
        ${fg('키워드', txt(a.keywords, `asField('${escAttr(tid)}','keywords',this.value,'발제 키워드')`,
          '예: 적응형 재생 · 산업유산 · 저탄소'),
          '프로그램북 색인과 트랙 배정에 씁니다 — 연사가 해시태그로 보내오기도 해요')}
        ${fg('발표 형식', txt(a.talk_format, `asField('${escAttr(tid)}','talk_format',this.value,'발표 형식')`,
          '예: 15분 발표 + 라운드테이블'),
          '연사가 제안서에 적어 보내는 값입니다 — 세션 시간을 짤 때 이걸 봅니다')}
        ${fg('라운드테이블 논의 주제', area(a.discussion,
          `asField('${escAttr(tid)}','discussion',this.value,'라운드테이블 주제')`, '', 3),
          '좌장이 진행할 때 쓰는 질문들 — 연사가 함께 보내오면 여기 옮겨 둡니다')}` : ''}
      ${fg('메모', area(a.note, `asField('${escAttr(tid)}','note',this.value,'발제 메모')`, '', 2))}
    </div>`;
  };

  return asg.map(block).join('');
}


/* 화면의 onclick이 부르는 것 */
window.payCountry = payCountry;   // 탭(speaker-drawer.js)이 window로 부른다
window.bioHtml = bioHtml;   // 탭(speaker-drawer.js)이 window로 부른다
window.talkHtml = talkHtml;   // 탭(speaker-drawer.js)이 window로 부른다
window.basicHtml = basicHtml;   // 탭(speaker-drawer.js)이 window로 부른다
