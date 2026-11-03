/* ══════════════════════════════════════════════════════════════
   features/conference/sp-dr-bank.js — 연사 계좌·여권
   (modules/speaker-drawer.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { deleteSpeakerPhoto, saveSpeakerLog, saveSpeakerPhoto, shrinkImage, speakerPhotoOf, speakerPhotosLoaded } from '../../api.js';
import { NEED_MARK } from '../../constants.js';
import { trackAction } from '../../core/audit-log.js';
import { SPEAKER_LOGS, autoDomestic, currentUser, getSpeakerById, isDomesticSpeaker, rolesOfSpeaker } from '../../state.js';
import { countryOptions, escapeHtml, photoSrc, td } from '../../utils.js';
import { confLockNotice, confLocked } from './conf-common.js';
import { spDrUi } from './speaker-drawer-ui.js';
import { applySpReuse, area, asField, asStamp, closeSpeakerDr, confirmSpReuse, fg, gotRow, needState, openFlowDraft, openSpeakerDr, patchSpeaker, renderSpeakerDr, spField, spSnooze, spStamp, spTravelShow, switchSpeakerDT, toggleSpFlow, txt } from '../../modules/speaker-drawer.js';
import { createSpeakerContact, linkSpeakerContact, pullSpeakerProfile, pushSpeakerProfile, removeSpeakerFromDr, searchSpeakerContact, spContactField, unlinkSpeakerContact } from './sp-dr-basic.js';
import { addSpMailFiles, addSpeakerContact, fillSpeakerMail, removeSpMailFile, removeSpeakerContact, scField, sendSpeakerMail, toggleSpDefaultFile, toggleSpWithCo } from './sp-dr-mail.js';

/* ══════════════════════════════════════════
   계좌 · 여권

   연사료를 주려면 계좌가 있어야 하고, 해외 연사는 항공권을 끊으려면 여권이
   필요하다. 둘 다 다른 정보와 성격이 다르다 — 숙박을 확인하러 열 때마다
   계좌번호가 같이 보일 이유가 없다.

   그래서 기본은 가려 두고, 「보기」를 눌러야 열리며 누가 언제 봤는지 남긴다.
   가리는 것 자체가 보호는 아니다(값은 이미 브라우저에 와 있다). 보호하는 건
   기록이다 — 누가 봤는지 남으면 함부로 열지 않는다.
══════════════════════════════════════════ */

/* 뒷자리만 남긴다. 계좌를 «확인»하는 데는 뒷자리로 충분하고,
   전체가 필요한 건 실제로 이체할 때뿐이다. */
const mask = (v, keep) => {
  const s = String(v || '').trim();
  if(!s) return '';
  const k = keep || 4;
  if(s.length <= k) return '•'.repeat(s.length);
  return '•'.repeat(Math.min(s.length - k, 12)) + s.slice(-k);
};

/* 국내·해외 판정은 state.js(isDomesticSpeaker)에 있다 — 연사 표와 같은 기준을 쓴다. */
const isDomestic = isDomesticSpeaker;

/* 국내·해외 양식을 고르는 줄. «자동»은 국적·거주지로 정한다. */
function bankModeRow(sp){
  const auto = autoDomestic(sp) ? '국내' : '해외';
  const opt = (v, l) => `<option value="${v}"${(sp.bank_mode || '') === v ? ' selected' : ''}>${l}</option>`;
  return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:11px">
    <span style="color:var(--i3)">받는 양식</span>
    <select class="fi" style="width:auto;padding:3px 6px;font-size:11px"
      onchange="spField('bank_mode',this.value,'계좌 양식')">
      ${opt('', `자동 (${auto})`)}${opt('domestic', '국내 — 신분증·통장사본')}${opt('overseas', '해외 — KIC 양식·여권')}
    </select>
    ${sp.bank_mode ? '<span style="color:var(--am)">직접 정함</span>' : ''}
  </div>`;
}

function domesticBankHtml(sp, nBank){
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <div style="font-size:11px;color:var(--am)">열람 중 — 기록에 남았습니다</div>
      <button class="btn" style="font-size:10.5px;margin-left:auto" onclick="hideBank()">가리기</button>
    </div>
    ${bankModeRow(sp)}
    <div style="border:1px solid var(--i6);border-radius:9px;padding:11px 12px">
      <div style="font-size:12px;font-weight:700;margin-bottom:4px">국내 계좌 ${nBank ? NEED_MARK[nBank] : ''}</div>
      <div style="font-size:10.5px;color:var(--i4);margin-bottom:8px;line-height:1.6">
        신분증과 통장사본만 받습니다.</div>
      ${gotRow('신분증 받음', sp.id_card_received_at,
        `spStamp('id_card_received_at','신분증 받음')`,
        `spField('id_card_received_at',this.value,'신분증 받은 날')`, nBank || 'opt')}
      ${fg('신분증 파일명', txt(sp.id_card_file, `spField('id_card_file',this.value,'신분증 파일')`, '원드라이브 파일명'))}
      ${gotRow('통장사본 받음', sp.bankbook_received_at,
        `spStamp('bankbook_received_at','통장사본 받음')`,
        `spField('bankbook_received_at',this.value,'통장사본 받은 날')`, nBank || 'opt')}
      ${fg('통장사본 파일명', txt(sp.bankbook_file, `spField('bankbook_file',this.value,'통장사본 파일')`, '원드라이브 파일명'))}
      <div class="fgr">
        ${fg('은행', txt(sp.bank_name, `spField('bank_name',this.value,'은행')`, '예: 국민은행'))}
        ${fg('예금주', txt(sp.bank_holder, `spField('bank_holder',this.value,'예금주')`, '통장사본에 적힌 그대로'))}
      </div>
      ${fg('계좌번호', txt(sp.bank_account, `spField('bank_account',this.value,'계좌번호')`))}
      <div style="font-size:10.5px;color:var(--i4);margin-top:-4px">
        스캔본은 원드라이브에 두고 여기엔 파일명만 적습니다.</div>
    </div>`;
}

function bankHtml(sp, evKey){
  const roles = rolesOfSpeaker(sp.id);
  const nBank = needState(evKey, roles, 'bank');
  const nPass = needState(evKey, roles, 'passport');
  const has = sp.bank_account || sp.bank_holder || sp.bank_name;

  if(!spDrUi.bankRevealed){
    return `<div style="padding:14px;background:var(--i8);border:1px solid var(--i6);border-radius:9px">
      <div style="font-size:12px;font-weight:700;margin-bottom:6px">계좌 · 여권</div>
      <div style="font-size:11.5px;color:var(--i3);line-height:1.7">
        ${has
          ? `예금주 <b>${escapeHtml(sp.bank_holder || '(없음)')}</b> · ${escapeHtml(sp.bank_name || '은행 미상')}
             <br>계좌 ${escapeHtml(mask(sp.bank_account))}`
          : '아직 계좌를 받지 않았어요.'}
        ${sp.passport_file ? `<br>여권 스캔 ${escapeHtml(sp.passport_received_at || '')} 받음` : ''}
      </div>
      <div style="font-size:10.5px;color:var(--i4);margin-top:8px;line-height:1.6">
        전체를 보려면 아래를 누르세요. 누가 언제 열었는지 기록에 남습니다.</div>
      <button class="btn" style="font-size:11px;margin-top:8px" onclick="revealBank()">전체 보기</button>
    </div>`;
  }

  if(isDomestic(sp)) return domesticBankHtml(sp, nBank);

  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <div style="font-size:11px;color:var(--am)">열람 중 — 기록에 남았습니다</div>
      <button class="btn" style="font-size:10.5px;margin-left:auto" onclick="hideBank()">가리기</button>
    </div>
    ${bankModeRow(sp)}
    <div style="border:1px solid var(--i6);border-radius:9px;padding:11px 12px;margin-bottom:11px">
      <div style="font-size:12px;font-weight:700;margin-bottom:8px">계좌 ${nBank ? NEED_MARK[nBank] : ''}</div>
      <div style="font-size:10.5px;color:var(--i4);margin:-2px 0 10px;line-height:1.6">
        KIC 연사 양식(Appendix 4 Bank Information Form) 순서대로 적습니다.
        해외 송금은 하나라도 빠지면 은행에서 되돌아옵니다.</div>
      ${gotRow('계좌 양식(Word) 받음', sp.bank_form_received_at,
        `spStamp('bank_form_received_at','계좌 양식 받음')`,
        `spField('bank_form_received_at',this.value,'계좌 양식 받은 날')`, nBank || 'opt')}
      ${fg('양식 파일명', txt(sp.bank_form_file, `spField('bank_form_file',this.value,'계좌 양식 파일')`, '원드라이브 파일명'))}
      <div style="font-size:11px;font-weight:700;color:var(--i3);margin:4px 0 6px">연사 (Personal Information)</div>
      <div class="fgr">
        ${fg('이름 (First Name)', txt(sp.bank_first_name, `spField('bank_first_name',this.value,'First Name')`, '여권 표기 그대로'))}
        ${fg('성 (Last Name)', txt(sp.bank_last_name, `spField('bank_last_name',this.value,'Last Name')`, '여권 표기 그대로'))}
      </div>
      <div class="fgr">
        ${fg('국적 (Nationality)', `<select class="fi" onchange="spField('nationality',this.value,'국적')">
          <option value="">미정</option>${countryOptions(sp.nationality)}</select>`, '기본 정보의 국적과 같은 칸입니다')}
        ${fg('소속 (Institution)', txt(sp.org_en, `spField('org_en',this.value,'소속 영문')`), '기본 정보의 소속 영문과 같은 칸입니다')}
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--i3);margin:4px 0 6px">받는 사람 (Account Holder)</div>
      ${fg('예금주 (Name)', txt(sp.bank_holder, `spField('bank_holder',this.value,'예금주')`, '통장에 찍힌 영문 이름 그대로'))}
      <div class="fgr">
        ${fg('주소 (Address)', txt(sp.bank_holder_address, `spField('bank_holder_address',this.value,'예금주 주소')`))}
        ${fg('우편번호 (Postal Code)', txt(sp.bank_holder_postal, `spField('bank_holder_postal',this.value,'예금주 우편번호')`))}
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--i3);margin:4px 0 6px">은행 (Bank Info)</div>
      <div class="fgr">
        ${fg('은행 (Bank Name)', txt(sp.bank_name, `spField('bank_name',this.value,'은행')`))}
        ${fg('지점 (Branch Name)', txt(sp.bank_branch, `spField('bank_branch',this.value,'지점')`))}
      </div>
      <div class="fgr">
        ${fg('은행 주소 (Bank Address)', txt(sp.bank_address, `spField('bank_address',this.value,'은행 주소')`), '도시와 국가는 꼭 들어가야 합니다')}
        ${fg('은행 국가', txt(sp.bank_country, `spField('bank_country',this.value,'은행 국가')`))}
      </div>
      <div class="fgr">
        ${fg('SWIFT / BIC', txt(sp.bank_swift, `spField('bank_swift',this.value,'SWIFT')`, '8~11자'),
          sp.bank_swift && !/^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$/.test(sp.bank_swift.trim())
            ? '<span style="color:var(--am)">8자나 11자가 아니에요 — 다시 확인해 주세요</span>' : '')}
        ${fg('계좌번호 (Account No.)', txt(sp.bank_account, `spField('bank_account',this.value,'계좌번호')`))}
      </div>
      <div class="fgr">
        ${fg('ABA / IBAN 구분', `<select class="fi" onchange="spField('bank_iban_kind',this.value,'ABA·IBAN 구분')">
          ${[['', '(없음)'], ['ABA', 'ABA (미국)'], ['IBAN', 'IBAN']].map(([v, l]) =>
            `<option value="${v}"${(sp.bank_iban_kind || '') === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>`)}
        ${fg('ABA / IBAN 번호', txt(sp.bank_iban, `spField('bank_iban',this.value,'ABA·IBAN')`))}
      </div>
      ${fg('은행 코드 (Bank Codes)', txt(sp.bank_code, `spField('bank_code',this.value,'은행 코드')`, '예: Sort Code 123456'),
        '영국 Sort Code(6자리) · 호주 BSB(6자리) · 캐나다 CC(0+기관번호+지점번호)는 꼭 받습니다')}
      ${fg('비고 (Other Remarks)', area(sp.bank_note, `spField('bank_note',this.value,'계좌 비고')`, '', 2))}
      <div style="font-size:10.5px;color:var(--i4);margin-top:-4px">
        연사료는 USD로 보냅니다 — USD를 받을 수 있는 계좌인지 확인하세요.</div>
    </div>
    ${!nPass && !sp.passport_received_at && !sp.passport_file ? '' : `<div style="border:1px solid var(--i6);border-radius:9px;padding:11px 12px">
      <div style="font-size:12px;font-weight:700;margin-bottom:8px">여권 ${nPass ? NEED_MARK[nPass] : ''}</div>
      ${gotRow('여권 스캔 받음', sp.passport_received_at,
        `spStamp('passport_received_at','여권 받음')`,
        `spField('passport_received_at',this.value,'여권 받은 날')`, nPass || 'opt')}
      ${fg('파일명', txt(sp.passport_file, `spField('passport_file',this.value,'여권 파일')`, '원드라이브 파일명'))}
      <div style="font-size:10.5px;color:var(--i4);margin-top:-4px">
        스캔본은 원드라이브에 두고 여기엔 파일명만 적습니다 — 이미지가 이 화면에 뜨면
        누가 옆에서 봐도 그대로 보입니다.</div>
    </div>`}`;
}

/* 열람을 기록에 남긴다. 저장이 실패하면 열지 않는다 — 기록 없이 보는 길이
   생기면 기록이 있다는 사실 자체가 의미를 잃는다. */
export async function revealBank(){
  const sp = getSpeakerById(spDrUi.spId);
  if(!sp) return;
  const row = {
    speaker_id: sp.id, kind: 'view', ts: td(),
    direction: '', channel: '', counterpart: '', category: '계좌·여권 열람',
    subject: '계좌·여권 전체 보기', body: '', answered_at: '', answer: '', status: 'done',
    author_email: currentUser?.email || '', author_name: currentUser?.name || '',
  };
  const res = await saveSpeakerLog(row);
  if(!res || res.ok === false){
    if(res?.offline){
      /* 테스트 모드는 서버가 없어 기록이 남지 않는다. 더미 데이터라 가릴
         것도 없으니 열어 준다 — 대신 기록이 안 남는다고 알린다. */
      spDrUi.bankRevealed = true;
      SPEAKER_LOGS.push({ ...row, id: `SL-tmp-${Date.now()}` });
      renderSpeakerDr();
      return;
    }
    alert('열람 기록을 남기지 못해 열지 않았어요. 잠시 뒤 다시 해주세요.');
    return;
  }
  SPEAKER_LOGS.push({ ...row, id: res.id || `SL-tmp-${Date.now()}` });
  trackAction('view', '연사 계좌·여권', sp.event_id, sp.name_snapshot || sp.name_en || sp.id);
  spDrUi.bankRevealed = true;
  renderSpeakerDr();
}
export function hideBank(){ spDrUi.bankRevealed = false; renderSpeakerDr(); }

/* ── 연사 사진 ──
   원본은 OneDrive 연사 폴더에 있고, 여기에는 알아보는 용도로 줄인 사본을 둔다
   (backend-node/routes/photos.js). 폴더에 있는 것을 한꺼번에 넣을 때는
   backend-node/db/import-speaker-photos.js를 쓴다. */
function photoBoxHtml(sp, evKey){
  const p = speakerPhotoOf(evKey, sp.id);
  const loading = !speakerPhotosLoaded(evKey);
  return `<div style="display:flex;gap:12px;align-items:flex-start;margin:8px 0 10px">
    ${p ? `<img src="${photoSrc(p)}" alt=""
        style="width:96px;height:120px;object-fit:cover;object-position:50% 25%;border-radius:6px;border:1px solid var(--i6);display:block;flex:none">`
      : `<div style="width:96px;height:120px;border-radius:6px;border:1px dashed var(--i5);display:flex;align-items:center;justify-content:center;font-size:10.5px;color:var(--i4);text-align:center">${loading ? '불러오는 중' : '사진 없음'}</div>`}
    <div style="font-size:10.5px;color:var(--i4);line-height:1.7">
      ${p ? `${escapeHtml(p.file || '')}${p.updated_at ? `<br>${escapeHtml(String(p.updated_at).slice(0, 10))} 올림` : ''}<br>` : ''}
      <label class="btn" style="font-size:10.5px;cursor:pointer;display:inline-block;margin-top:4px">${p ? '사진 바꾸기' : '사진 올리기'}
        <input type="file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="uploadSpPhoto(this)"></label>
      ${p ? `<button class="btn" style="font-size:10.5px;color:var(--re);margin-top:4px" onclick="removeSpPhoto()">지우기</button>` : ''}
    </div>
  </div>`;
}

export async function uploadSpPhoto(input){
  const file = input.files?.[0];
  input.value = '';
  const sp = getSpeakerById(spDrUi.spId);
  if(!file || !sp) return;
  if(confLocked()){ confLockNotice(); return; }
  let img;
  try { img = await shrinkImage(file); }
  catch(e){ alert(e.message); return; }
  const r = await saveSpeakerPhoto(sp.event_id, sp.id, { file: file.name, ...img });
  if(!r.ok){ alert(r.error || '사진을 올리지 못했어요.'); return; }
  trackAction('edit', '연사', sp.event_id, `${sp.name_snapshot || sp.name_en || sp.id} — 사진 올림 (${file.name})`);
  /* 받은 날과 파일명이 비어 있으면 함께 채운다 — 사진을 올렸는데 «사진 미수령»으로
     남으면 독촉 메일에 사진이 또 들어간다 */
  const patch = {};
  if(!sp.photo_received_at) patch.photo_received_at = td();
  if(!sp.photo_file) patch.photo_file = file.name;
  if(Object.keys(patch).length) await patchSpeaker(patch, '사진 받음');
  else renderSpeakerDr();
}

export async function removeSpPhoto(){
  const sp = getSpeakerById(spDrUi.spId);
  if(!sp) return;
  if(confLocked()){ confLockNotice(); return; }
  if(!confirm('CRM에 올린 사진을 지울까요? (원드라이브 원본은 그대로 있어요)')) return;
  const r = await deleteSpeakerPhoto(sp.event_id, sp.id);
  if(!r.ok){ alert(r.error || '지우지 못했어요.'); return; }
  trackAction('edit', '연사', sp.event_id, `${sp.name_snapshot || sp.name_en || sp.id} — 사진 지움`);
  renderSpeakerDr();
}

/* ── 노출 ── */
window.uploadSpPhoto        = uploadSpPhoto;
window.toggleSpWithCo       = toggleSpWithCo;
window.removeSpPhoto        = removeSpPhoto;
window.openSpeakerDr        = openSpeakerDr;
window.closeSpeakerDr       = closeSpeakerDr;
window.removeSpeakerFromDr  = removeSpeakerFromDr;
window.switchSpeakerDT      = switchSpeakerDT;
window.spField              = spField;
window.asField              = asField;
window.spStamp              = spStamp;
window.applySpReuse         = applySpReuse;
window.confirmSpReuse       = confirmSpReuse;
window.asStamp              = asStamp;
window.searchSpeakerContact = searchSpeakerContact;
window.linkSpeakerContact   = linkSpeakerContact;
window.openFlowDraft = openFlowDraft;
window.toggleSpFlow = toggleSpFlow;
window.spSnooze = spSnooze;
window.spTravelShow = spTravelShow;
window.addSpMailFiles = addSpMailFiles;
window.removeSpMailFile = removeSpMailFile;
window.toggleSpDefaultFile = toggleSpDefaultFile;
window.spContactField     = spContactField;
window.createSpeakerContact = createSpeakerContact;
window.unlinkSpeakerContact = unlinkSpeakerContact;
window.pullSpeakerProfile   = pullSpeakerProfile;
window.pushSpeakerProfile   = pushSpeakerProfile;
window.renderSpeakerDr      = renderSpeakerDr;
window.addSpeakerContact    = addSpeakerContact;
window.scField              = scField;
window.removeSpeakerContact = removeSpeakerContact;
window.fillSpeakerMail      = fillSpeakerMail;
window.sendSpeakerMail      = sendSpeakerMail;
window.revealBank           = revealBank;
window.hideBank             = hideBank;


/* 화면의 onclick이 부르는 것 */
window.bankHtml = bankHtml;   // 탭(speaker-drawer.js)이 window로 부른다
window.isDomestic = isDomestic;   // 탭(speaker-drawer.js)이 window로 부른다
window.photoBoxHtml = photoBoxHtml;   // 탭(speaker-drawer.js)이 window로 부른다
