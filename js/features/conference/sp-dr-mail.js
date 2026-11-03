/* ══════════════════════════════════════════════════════════════
   features/conference/sp-dr-mail.js — 연사 연락 상대·메일·기록
   (modules/speaker-drawer.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { deleteSpeakerContact, saveSpeakerContact, saveSpeakerLog } from '../../api/conf-save.js';
import { eventMailFrom, fileToBase64, mailFilesOf, sendMail } from '../../api/mail-send.js';
import { changed, removed, trackAction } from '../../core/audit-log.js';
import { autoVariant, draftFor, fillTemplate, flowStatus, pendingItems, stepVariants } from '../../modules/speaker-flow.js';
import { aiDraftHtml } from '../../shared/mail/ai-mail-draft.js';
import { resolveDue } from '../../shared/mail/follow-up.js';
import { filterMail, mailActionsHtml, mailFilBar, mailStateHtml, mailToggleAttr, setMailDone } from '../../shared/mail/mail-mark.js';
import { libItem, libItems } from '../../shared/mail/mail-templates.js';
import { varChipsHtml } from '../../shared/mail/var-chips.js';
import { CONF_SESSIONS, EVENT_LIST, SESSION_SPEAKERS, SPEAKER_CONTACTS, SPEAKER_LOGS, assignmentsFor, coOf, confCfg, contacts, contactsOfSpeaker, currentUser, getSpeakerById, leadOf, logsOfSpeaker, rolesOfSpeaker } from '../../state.js';
import { escAttr, escapeHtml, mailDirPill, nowStamp, td } from '../../utils.js';
import { confLockNotice, confLocked } from './conf-common.js';
import { spDrUi } from './speaker-drawer-ui.js';
import { MAIL_KINDS, fg, mailBodyHtml, needState, patchSpeaker, renderSpeakerDr, speakerLabel, switchSpeakerDT, txt } from '../../modules/speaker-drawer.js';
import { BIO_PARTS } from './sp-dr-basic.js';

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
/* 연사 본인의 메일·전화는 기본 정보(마스터DB 연락처)가 정본이다. 연락 상대에
   또 적게 하면 두 곳이 갈라진다 — «연사 본인» 줄은 칸이 비어 있으면 기본 정보를
   그대로 읽고, 연락 상대가 하나도 없으면 연사 본인을 수신으로 본다. */
const selfCon = (sp) => sp && sp.contact_id ? contacts.find(c => String(c.id) === String(sp.contact_id)) : null;
const selfEmail = (sp) => String(selfCon(sp)?.email1 || '').trim();
const selfPhone = (sp) => String(selfCon(sp)?.phone1 || selfCon(sp)?.phone2 || '').trim();
const isSelf = (r) => r.kind === '연사 본인';
const norm = (v) => String(v || '').trim().toLowerCase();
/* 연사 본인은 마스터DB 메일이 정본 — 있으면 그걸 쓰고, 줄에 적힌 메일은 마스터에
   메일이 없을 때만 쓴다. 반대로 하면 기본 탭에서 메일을 고쳐도 옛 주소로 나갔다. */
export const rowEmail = (sp, r) => isSelf(r)
  ? (selfEmail(sp) || String(r.email || '').trim())
  : String(r.email || '').trim();

export function mailTargets(speakerId){
  const sp = getSpeakerById(speakerId);
  const rows = contactsOfSpeaker(speakerId);
  if(!rows.length){
    const em = selfEmail(sp);
    return { to: em ? [em] : [], cc: [] };
  }
  const pick = (s) => rows.filter(r => r.send === s).map(r => rowEmail(sp, r)).filter(Boolean);
  return { to: pick('to'), cc: pick('cc') };
}

/* ── 공동연사에게 함께 보내기 ──
   공동 발표는 시간·발제·자료가 하나라 안내도 같은 글이 두 번 나간다. 따로 보내면
   한쪽만 받거나 내용이 갈린다. 상대의 수신·참조를 합쳐 한 통으로 보내고,
   기록은 두 사람 모두에게 남긴다(그래야 상대 쪽 연락 단계도 함께 넘어간다). */
export function coPartners(sp){
  const out = new Map();
  SESSION_SPEAKERS.filter(x => x.speaker_id === sp.id).forEach(a => {
    const l = leadOf(a);
    [l, ...coOf(l)].forEach(x => {
      if(x.speaker_id === sp.id) return;
      const p = getSpeakerById(x.speaker_id);
      if(p && p.status !== '취소') out.set(p.id, p);
    });
  });
  return [...out.values()];
}
function mailTargetsFor(sp){
  const t = mailTargets(sp.id);
  if(!spDrUi.spWithCo) return { ...t, partners: [] };
  const partners = coPartners(sp);
  const to = [...t.to], cc = [...t.cc];
  const seen = new Set([...to, ...cc].map(norm));
  partners.forEach(p => {
    const pt = mailTargets(p.id);
    pt.to.forEach(e => { if(!seen.has(norm(e))){ seen.add(norm(e)); to.push(e); } });
    pt.cc.forEach(e => { if(!seen.has(norm(e))){ seen.add(norm(e)); cc.push(e); } });
  });
  return { to, cc, partners };
}
export function toggleSpWithCo(on){ spDrUi.spWithCo = !!on; renderSpeakerDr(); }

function peopleTabHtml(sp){
  const rows = contactsOfSpeaker(sp.id);
  const t = mailTargets(sp.id);

  const row = (r) => `<div style="border:1px solid var(--i6);border-radius:8px;padding:9px 11px;margin-bottom:7px">
    <div class="fgr">
      ${fg('이름', txt(r.name, `scField('${escAttr(r.id)}','name',this.value,'연락 상대 이름')`, '홍길동'))}
      ${fg('관계', `<select class="fi" onchange="scField('${escAttr(r.id)}','kind',this.value,'연락 상대 관계')">
        ${CONTACT_KINDS.map(k => `<option value="${escapeHtml(k)}"${(r.kind || '') === k ? ' selected' : ''}>${k}</option>`).join('')}
      </select>`)}
    </div>
    <div class="fgr">
      ${fg('메일', txt(r.email, `scField('${escAttr(r.id)}','email',this.value,'연락 상대 메일')`,
        isSelf(r) && selfEmail(sp) ? selfEmail(sp) : 'name@org.kr'))}
      ${fg('전화', txt(r.phone, `scField('${escAttr(r.id)}','phone',this.value,'연락 상대 전화')`,
        isSelf(r) && selfPhone(sp) ? selfPhone(sp) : ''))}
    </div>
    ${isSelf(r) ? `<div style="font-size:10px;color:var(--i4);margin:-2px 0 5px">${
      selfEmail(sp) && r.email && norm(r.email) !== norm(selfEmail(sp))
        ? `<span style="color:var(--am)">기본 정보(마스터DB)의 ${escapeHtml(selfEmail(sp))}로 나갑니다</span> — 여기 적힌 주소는 쓰지 않아요. 바꾸려면 기본 탭에서 고치세요`
        : selfEmail(sp) ? '기본 정보(마스터DB)의 메일로 나갑니다 — 고치려면 기본 탭에서'
        : r.email ? '마스터DB에 메일이 없어 여기 적힌 주소로 나갑니다'
        : '<span style="color:var(--re)">메일이 없어요</span> — 기본 탭에서 넣어주세요'}</div>` : ''}
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
        따로 정한 연락 상대가 없어 <b>연사 본인</b>(기본 정보의 메일)에게 보냅니다.
        실무진을 거쳐야 하면 추가해서 실무진을 수신, 연사를 참조로 두세요.</div>`)
    + `<button class="btn" style="font-size:11px" onclick="addSpeakerContact()">+ 연락 상대 추가</button>`;
}

export async function addSpeakerContact(){
  if(confLocked()){ confLockNotice(); return; }
  const sp = getSpeakerById(spDrUi.spId);
  if(!sp) return;
  /* 첫 상대는 연사 본인으로 두고 수신으로 잡는다 — 실무진이 붙으면 그때
     수신을 옮기면 된다. 처음부터 비워 두면 수신 없는 채로 메일 칸을 연다. */
  const first = !contactsOfSpeaker(sp.id).length;
  /* 연사 본인 줄은 메일·전화를 비워 둔다 — 기본 정보를 읽는다(rowEmail) */
  const row = {
    speaker_id: sp.id, contact_id: '',
    name: first ? (sp.name_snapshot || sp.name_en || '') : '', email: '', phone: '',
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
  trackAction('edit', '연사 연락 상대', getSpeakerById(spDrUi.spId)?.event_id, `${speakerLabel()} — ${label || field}`,
    changed('speaker_contacts', id, { [field]: backup }, { [field]: value ?? '' },
      { kind: 'speaker', id: spDrUi.spId, field }));
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
  trackAction('delete', '연사 연락 상대', getSpeakerById(spDrUi.spId)?.event_id,
    `${speakerLabel()} — ${r.name || r.email || r.kind || '이름 없는'} 연락 상대 지움`,
    removed('speaker_contacts', id, r, { kind: 'speaker', id: spDrUi.spId }));
  renderSpeakerDr();
}

/* ── 메일 ──
   무엇을 물을지가 정해져 있으니 제목·본문의 뼈대는 우리가 만든다. 사람이
   고쳐 보내는 걸 전제로 하고, 자동으로 나가는 일은 없다. */

/* 줄을 누르면 보낸 본문을 펼친다 — «뭐라고 보냈지»를 메일함까지 가서 찾지 않게 */
const spLogRow = (l) => `<details style="border-top:1px solid var(--i7);padding:7px 0"${mailToggleAttr('sp', l)}>
  <summary style="cursor:pointer;list-style:none">
  <div style="display:flex;gap:7px;align-items:baseline">
    ${mailDirPill(l)}${mailStateHtml('sp', l)}<span class="pill p-gray" style="font-size:10px">${escapeHtml(l.category || '기타')}</span>
    <div style="font-size:11.5px;font-weight:${l.direction === 'in' && !l.read_at ? 800 : 600};flex:1;min-width:0">${escapeHtml(l.subject || '(제목 없음)')}</div>
    <div style="font-size:10.5px;color:var(--i4)">${escapeHtml(l.ts || '')} ▾</div>
  </div>
  <div style="font-size:10.5px;color:var(--i4);margin-top:2px">${escapeHtml(l.counterpart || '')}</div>
  </summary>
  <div style="margin-top:6px;padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;
    font-size:11.5px;color:var(--i2);white-space:pre-wrap;line-height:1.6">${mailBodyHtml(l.body)}</div>
  ${mailActionsHtml('sp', l)}
</details>`;

/* ── 회신 중 ── 받은 메일의 «↩ 회신»에서 들어온다(mail-mark.js replyMail) */
export function startSpeakerReply(d){ spDrUi.spReply = { ...d, filled: false, pick: new Set() }; spDrUi.spTab = 'mail'; renderSpeakerDr(); }
/* 회신에 붙일 행사 파일 — 단계 기본 첨부와 달리 처음엔 아무것도 안 고른 채로 */
export function toggleSpReplyFile(id, on){ if(!spDrUi.spReply) return; on ? spDrUi.spReply.pick.add(id) : spDrUi.spReply.pick.delete(id); }
window.toggleSpReplyFile = toggleSpReplyFile;
export function cancelSpeakerReply(){ spDrUi.spReply = null; renderSpeakerDr(); }
function fillSpeakerReply(){
  const s = document.getElementById('sp-mail-subject'), b = document.getElementById('sp-mail-body');
  if(!s || !b || !spDrUi.spReply) return;
  // 한 번 채운 뒤에는 고친 글을 지키려고 다시 덮지 않는다(창을 다시 그리면 마지막 글로)
  if(!spDrUi.spReply.filled){ spDrUi.spReply.filled = true; spDrUi.spReply.curSubject = spDrUi.spReply.subject; spDrUi.spReply.curBody = spDrUi.spReply.body; }
  s.value = spDrUi.spReply.curSubject; b.value = spDrUi.spReply.curBody;
  s.oninput = () => { spDrUi.spReply && (spDrUi.spReply.curSubject = s.value); };
  b.oninput = () => { spDrUi.spReply && (spDrUi.spReply.curBody = b.value); };
  b.focus(); b.setSelectionRange(0, 0);
}
window.startSpeakerReply = startSpeakerReply;
window.cancelSpeakerReply = cancelSpeakerReply;

function mailTabHtml(sp, evKey){
  const t = spDrUi.spReply ? { to: spDrUi.spReply.to, cc: [] } : mailTargetsFor(sp);
  const coAll = spDrUi.spReply ? [] : coPartners(sp);
  const noMail = (p) => !mailTargets(p.id).to.length && !mailTargets(p.id).cc.length;
  const ev = EVENT_LIST.find(e => e.key === evKey);
  // 영문 연사에게는 영문 행사명(설정 › 행사 › 기본 정보)
  const evName = ev ? ((sp.lang_pref === 'en' && ev.name_en) || ev.name || ev.short || ev.key) : evKey;
  /* 계좌 열람(kind 'view') 같은 내부 기록은 «보낸 기록»이 아니다 */
  const logs = logsOfSpeaker(sp.id).filter(l => l.kind !== 'view')
    .slice()
    .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));


  return `
    <div style="padding:9px 11px;background:var(--i8);border:1px solid var(--i6);border-radius:7px;
      font-size:11.5px;color:var(--i3);line-height:1.7;margin-bottom:11px">
      ${spDrUi.spReply ? `<div style="color:var(--a);font-weight:700">↩ 회신 중 — 이 메일을 보낸 사람에게 답합니다
        <a href="#" onclick="cancelSpeakerReply();return false" style="font-weight:400;margin-left:6px">회신 취소</a></div>` : ''}
      <span id="sp-mail-from">발신 확인 중…</span><br>
      ${t.to.length ? `수신 <b>${escapeHtml(t.to.join(', '))}</b>` : '<b style="color:var(--re)">수신이 없어요</b> — «연락 상대»에서 먼저 정해주세요'}
      ${t.cc.length ? `<br>참조 ${escapeHtml(t.cc.join(', '))}` : ''}
      ${coAll.length ? `<br><label style="cursor:pointer;color:var(--a)"><input type="checkbox"${spDrUi.spWithCo ? ' checked' : ''}
        onchange="toggleSpWithCo(this.checked)" style="vertical-align:-2px"> 공동연사 ${escapeHtml(coAll.map(p => p.name_snapshot || p.name_en).join(', '))}에게도 한 통으로 함께 보내기</label>${
        spDrUi.spWithCo && coAll.some(noMail)
          ? ` <span style="color:var(--am)">— ${escapeHtml(coAll.filter(noMail).map(p => p.name_snapshot || p.name_en).join(', '))}은(는) 메일 주소가 없어요</span>` : ''}` : ''}
    </div>
    ${(() => {
      /* 연락 단계가 먼저 — 지금 할 일이 골라진 채로 열린다. 개별 요청은 아래에 */
      const f = flowStatus(sp);
      const stepOpts = f.steps.filter(x => x.applies).map(x =>
        `<option value="${x.key}"${f.current && f.current.key === x.key ? ' selected' : ''}>${
          x.isDone ? '✓ ' : f.current && f.current.key === x.key ? '● ' : ''}${escapeHtml(
          x.key === 'collect' && f.remind ? '자료 독촉' : x.label)}</option>`).join('');
      const extra = MAIL_KINDS.filter(k => !['invite', 'travel', 'slides'].includes(k.key));
      return fg('무슨 메일인가', `<select class="fi" id="sp-mail-kind" onchange="fillSpeakerMail(this.value)">
        <optgroup label="연락 단계">${stepOpts}</optgroup>
        <optgroup label="개별 요청">${extra.map(k => `<option value="${k.key}">${k.label}</option>`).join('')}</optgroup>
        ${libItems('conf', evKey).length ? `<optgroup label="양식 보관함">${libItems('conf', evKey).map(it =>
          `<option value="lib:${escAttr(it.id)}">${escapeHtml(it.name)}</option>`).join('')}</optgroup>` : ''}
      </select>
        <div id="sp-mail-var"></div>
        <button class="btn" style="font-size:10.5px;margin-top:5px" title="이 행사의 연락 순서 설정을 열어 고른 단계의 기본 제목·본문·첨부를 고칩니다"
          onclick="openFlowEditor('${escAttr(evKey)}',document.getElementById('sp-mail-kind').value)">✎ 이 단계 기본 문구 고치기</button>
        <button class="btn" style="font-size:10.5px;margin-top:5px" title="단계와 상관없이 꺼내 쓰는 양식 — 이 행사만 또는 모든 행사 공통"
          onclick="openMailTemplates('conf','${escAttr(evKey)}')">📚 양식 보관함</button>
        <button class="btn" style="font-size:10.5px;margin-top:5px" onclick="openFlowEditor('${escAttr(evKey)}')">+ 단계 추가</button>`,
        '고르면 그 단계의 기본 문구로 제목·본문이 채워집니다. 기본 문구·단계는 위 단추로 바로 고칩니다');
    })()}
    <div id="sp-bulk-pick"></div>
    ${aiDraftHtml('sp', { reply: !!spDrUi.spReply })}
    <div data-vscope>
    ${fg('제목', `<input class="fi" id="sp-mail-subject" value="${escapeHtml(`[${evName}] 연사 안내`)}">`)}
    ${fg('내용', `<textarea class="fi" id="sp-mail-body" rows="10" style="resize:vertical"></textarea>
      ${varChipsHtml('conf', { resolve: 'sp-drawer', note: '이 연사의 값' })}`)}
    </div>
    ${fg('첨부', `<div id="sp-mail-files" style="font-size:11px"></div>
      <label class="btn" style="font-size:10.5px;margin-top:5px;display:inline-block;cursor:pointer">+ PC에서 파일 추가
        <input type="file" multiple style="display:none" onchange="addSpMailFiles(this)"></label>`,
      '단계의 기본 첨부는 «단계 편집»에서 올려 둡니다. PC에서 고른 파일은 합쳐서 3MB까지')}
    <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
      <button class="btn bp" style="font-size:11px" onclick="sendSpeakerMail()">보내기</button>
      <span id="sp-mail-msg" style="font-size:10.5px;color:var(--i4)"></span>
    </div>

    ${logs.length ? `<div style="font-size:11px;color:var(--i4);margin-top:16px;cursor:pointer" onclick="switchSpeakerDT('box')">
      주고받은 기록 ${logs.length}건은 «메일함» 탭에 있어요 ›</div>` : ''}`;
}

/* ── 메일함 — 이 연사와 주고받은 기록 ──
   보낸 메일·받은 메일을 최신순으로. 받은 메일은 읽음·처리를 체크한다(mail-mark.js) */
function boxTabHtml(sp){
  const logs = logsOfSpeaker(sp.id).filter(l => l.kind !== 'view')
    .slice().sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  const list = filterMail(logs);
  return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
      <div style="font-size:12px;font-weight:700;color:var(--i2)">주고받은 기록 ${logs.length || ''}</div>
      <button class="btn" style="font-size:10.5px;margin-left:auto" onclick="switchSpeakerDT('mail')">✉ 메일 쓰기</button>
    </div>
    ${logs.some(l => l.direction === 'in') ? mailFilBar(logs) : ''}
    ${list.length ? list.map(spLogRow).join('')
      : `<div style="font-size:11px;color:var(--i4);padding:6px 0">${logs.length ? '이 조건에 맞는 메일이 없어요'
        : '아직 주고받은 메일이 없어요 — 설정 › 행사 관리 › 메일에서 메일함 기록을 가져올 수 있어요'}</div>`}`;
}

/* ── 메일 첨부 ──
   기본 첨부(그 단계에 올려 둔 가이드·양식)는 체크된 채로 나오고, PC에서 고른
   파일은 보내기 전까지 이 화면에만 들고 있는다. */
function renderSpMailFiles(kind, reset){
  const sp = getSpeakerById(spDrUi.spId);
  const el = document.getElementById('sp-mail-files');
  if(!sp || !el) return;
  if(reset){ spDrUi.spSkipDefault = new Set(); }
  const k = kind || document.getElementById('sp-mail-kind')?.value || '';
  // 회신 중이면 이 행사에 올려 둔 파일 전부를 고를 수 있게(처음엔 꺼 둔다)
  const defs = spDrUi.spReply ? mailFilesOf(sp.event_id) : mailFilesOf(sp.event_id).filter(f => f.step === k);
  const kb = (n) => n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
  const localTotal = spDrUi.spLocalFiles.reduce((n, f) => n + f.size, 0);
  el.innerHTML = (defs.map(f => `<label style="display:flex;gap:6px;align-items:center;padding:2px 0">
      ${spDrUi.spReply
        ? `<input type="checkbox" ${spDrUi.spReply.pick.has(f.id) ? 'checked' : ''} onchange="toggleSpReplyFile('${escAttr(f.id)}',this.checked)">`
        : `<input type="checkbox" ${spDrUi.spSkipDefault.has(f.id) ? '' : 'checked'} onchange="toggleSpDefaultFile('${escAttr(f.id)}',this.checked)">`}
      📎 ${escapeHtml(f.filename)} <span style="color:var(--i4)">${kb(Number(f.size) || 0)} · ${spDrUi.spReply ? '행사 파일' : '기본 첨부'}</span></label>`).join('')
    + spDrUi.spLocalFiles.map((f, i) => `<div style="display:flex;gap:6px;align-items:center;padding:2px 0">
      📎 ${escapeHtml(f.name)} <span style="color:var(--i4)">${kb(f.size)}</span>
      <button class="btn" style="font-size:10px;padding:1px 6px" onclick="removeSpMailFile(${i})">빼기</button></div>`).join(''))
    || '<span style="color:var(--i4)">첨부 없음</span>';
  if(localTotal > 3 * 1024 * 1024) el.innerHTML += `<div style="color:var(--re);margin-top:3px">PC 파일이 합쳐서 3MB를 넘어요 (${kb(localTotal)}) — 큰 파일은 링크로 보내주세요</div>`;
}
export function addSpMailFiles(input){
  spDrUi.spLocalFiles.push(...[...(input.files || [])]);
  input.value = '';
  renderSpMailFiles();
}
export function removeSpMailFile(i){ spDrUi.spLocalFiles.splice(i, 1); renderSpMailFiles(); }
export function toggleSpDefaultFile(id, on){ if(on) spDrUi.spSkipDefault.delete(id); else spDrUi.spSkipDefault.add(id); }

/* 뼈대 채우기 — 무엇을 받아야 하는지는 역할에서 이미 알고 있다.
   해외 연사(영문만)에게는 영문으로 만든다. */
/* 안 받은 자료를 한 통에 — 필수(지금·다음)와 있으면 좋음을 나눠 적는다.
   목록은 «남은 일»(pendingItems)과 같다. 연사가 영문(EN)이면 영문으로 */
/* 무엇을 이번에 요청할지 — 일부만 먼저 받는 일이 많아서 고를 수 있게 한다.
   기본은 필수(지금·다음)만 켜 둔다. 연사가 바뀌면 다시 기본으로 */
function bulkDefault(sp){ return new Set(pendingItems(sp).filter(x => x.when === 'now' || x.when === 'later').map(x => x.key)); }
export function toggleBulkItem(key, on){
  const sp = getSpeakerById(spDrUi.spId);
  if(!sp) return;
  if(!spDrUi.bulkPick || spDrUi.bulkPickFor !== sp.id){ spDrUi.bulkPick = bulkDefault(sp); spDrUi.bulkPickFor = sp.id; }
  on ? spDrUi.bulkPick.add(key) : spDrUi.bulkPick.delete(key);
  fillBulkRequest(sp);
}
window.toggleBulkItem = toggleBulkItem;
function renderBulkPick(sp){
  const el = document.getElementById('sp-bulk-pick');
  if(!el) return;
  const pend = pendingItems(sp).filter(x => x.when !== 'ours');
  const G = { now: '지금', later: '다음', nice: '있으면 좋음' };
  el.innerHTML = pend.length ? `<div class="mlbl">이번에 요청할 것 <span style="font-size:9px;color:var(--i4)">이미 받은 건 빠져 있어요 — 일부만 받은 건 빠진 부분을 적어요</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:4px 12px;margin:2px 0 8px">${pend.map(x => `<label style="display:flex;gap:4px;align-items:center;font-size:11.5px;cursor:pointer">
      <input type="checkbox" ${spDrUi.bulkPick.has(x.key) ? 'checked' : ''} onchange="toggleBulkItem('${escAttr(x.key)}',this.checked)">
      ${escapeHtml(x.label)}${x.more ? `<span style="color:var(--i4)">(${escapeHtml(x.more)})</span>` : ''}
      <span style="font-size:9.5px;color:var(--i5)">${G[x.when]}</span></label>`).join('')}</div>` : '';
}

function fillBulkRequest(sp){
  if(!spDrUi.bulkPick || spDrUi.bulkPickFor !== sp.id){ spDrUi.bulkPick = bulkDefault(sp); spDrUi.bulkPickFor = sp.id; }
  renderBulkPick(sp);
  const en = sp.lang_pref === 'en';
  const ev = EVENT_LIST.find(e => e.key === sp.event_id);
  const evName = ev ? ((en && ev.name_en) || ev.name || ev.short || ev.key) : sp.event_id;
  const pend = pendingItems(sp).filter(x => x.when !== 'ours' && spDrUi.bulkPick.has(x.key));
  const titleKo = String(sp.title_ko || '').split(/[\/·,]/)[0].trim();
  const name = en ? (sp.name_en || sp.name_snapshot || '') : (sp.name_snapshot || sp.name_en || '');
  const honor = en ? name : (titleKo ? `${name} ${titleKo}님` : `${name} 님`);
  const line = (x) => `- ${x.label}${x.more ? ` (${x.more})` : ''}${x.due ? (en ? ` — by ${x.due}` : ` — ${x.due}까지`) : ''}`;
  const req = pend.filter(x => x.when === 'now' || x.when === 'later');
  const nice = pend.filter(x => x.when === 'nice');
  const me = currentUser?.name || '';
  const body = en
    ? `Dear ${honor},\n\nTo prepare for ${evName}, may we kindly ask you to send us the following.\n\n${
        req.length ? `Required:\n${req.map(line).join('\n')}\n\n` : ''}${
        nice.length ? `If available:\n${nice.map(line).join('\n')}\n\n` : ''}Thank you very much for your help.\n\nBest regards,\n${/[가-힣]/.test(me) ? '' : me}\n${evName} Secretariat`
    : `${honor}께\n\n안녕하십니까. ${evName} 사무국 ${me}입니다.\n행사 준비를 위해 아래 자료를 한꺼번에 요청드립니다.\n\n${
        req.length ? `■ 꼭 필요한 자료\n${req.map(line).join('\n')}\n\n` : ''}${
        nice.length ? `■ 있으시면 함께 보내주실 자료\n${nice.map(line).join('\n')}\n\n` : ''}바쁘신 중에 번거로우시겠지만 부탁드립니다.\n\n감사합니다.\n${evName} 사무국 ${me} 드림`;
  const s = document.getElementById('sp-mail-subject'), b = document.getElementById('sp-mail-body');
  if(s) s.value = en ? `[${evName}] Request for Outstanding Materials` : `[${evName}] 미제출 자료 요청 — ${honor}`;
  if(b) b.value = pend.length ? body : (en ? 'Nothing outstanding.' : '안 받은 자료가 없어요.');
}

export function fillSpeakerMail(kind, variantId){
  const sp = getSpeakerById(spDrUi.spId);
  if(!sp) return;
  const sel = document.getElementById('sp-mail-kind');
  if(sel && sel.value !== kind) sel.value = kind;
  renderSpMailFiles(kind, true);
  /* 양식 변형 — 이 단계에 변형이 있으면 «자동(역할) / 기본 / 변형들» 고르기를 띄운다 */
  const vbox = document.getElementById('sp-mail-var');
  const vs = String(kind).startsWith('lib:') ? [] : stepVariants(sp.event_id, kind);
  if(vbox){
    const auto = vs.length ? autoVariant(sp, kind) : null;
    const cur = variantId || '';
    vbox.innerHTML = vs.length ? `<div style="display:flex;gap:6px;align-items:center;margin-top:5px;font-size:11px">
      <span style="color:var(--i4)">양식</span>
      <select class="fi" style="font-size:11.5px;flex:1" onchange="fillSpeakerMail('${escAttr(kind)}',this.value)">
        <option value=""${!cur ? ' selected' : ''}>자동 — ${escapeHtml(auto ? auto.label : '기본 문구')}${auto ? ' (역할)' : ''}</option>
        <option value="base"${cur === 'base' ? ' selected' : ''}>기본 문구</option>
        ${vs.map(v => `<option value="${escapeHtml(v.id)}"${cur === v.id ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}
      </select></div>` : '';
  }
  if(kind === 'bulkreq'){ fillBulkRequest(sp); return; }
  const bp = document.getElementById('sp-bulk-pick'); if(bp) bp.innerHTML = '';
  /* 양식 보관함 — 단계와 무관한 자유 양식. 칸은 단계 메일과 같이 채운다 */
  if(String(kind).startsWith('lib:')){
    const it = libItem(String(kind).slice(4));
    if(!it) return;
    const en = sp.lang_pref === 'en';
    const s = document.getElementById('sp-mail-subject'), b = document.getElementById('sp-mail-body');
    if(s) s.value = fillTemplate((en ? it.subject_en : it.subject_ko) || it.subject_ko || it.subject_en || '', sp, {});
    if(b) b.value = fillTemplate((en ? it.body_en : it.body_ko) || it.body_ko || it.body_en || '', sp, {});
    return;
  }
  const d = draftFor(sp, kind, variantId || undefined);
  if(d){
    const s = document.getElementById('sp-mail-subject');
    const b = document.getElementById('sp-mail-body');
    if(s) s.value = d.subject;
    if(b) b.value = d.body;
    return;
  }
  const evKey = sp.event_id;
  const ev = EVENT_LIST.find(e => e.key === evKey);
  const evName = ev ? ((sp.lang_pref === 'en' && ev.name_en) || ev.name || ev.short || ev.key) : evKey;
  const cfg = confCfg(evKey);
  const lim = cfg.limits || {};
  const asg = assignmentsFor(sp.id);
  const en = sp.lang_pref === 'en';
  const name = sp.name_snapshot || sp.name_en || '';

  const due = (k) => resolveDue(evKey, (cfg.due || {})[k]);   // «D-7»도 날짜로
  const dueLine = (k, ko) => due(k) ? `\n- ${ko} 마감: ${due(k)}` : '';

  const sessions = asg.map(a => {
    const s = CONF_SESSIONS.find(x => x.id === a.session_id);
    /* 연사에게는 세션 시간이 아니라 «본인 발표 시각»을 알려야 한다 */
    const when = a.start_at ? `${a.start_at}${a.end_at ? '–' + a.end_at : ''}` : (s?.start_at || '');
    return `  · ${s ? (s.title_ko || s.title_en || s.id) : ''}${s?.date ? ` (${s.date}${when ? ' ' + when : ''})` : ''} — ${a.role}`;
  }).join('\n');

  const bodies = {
    invite: en
      ? `Dear ${name},\n\nWe are pleased to invite you to ${evName}.\n\n${sessions ? `Your session(s):\n${sessions}\n\n` : ''}We would be grateful if you could confirm your participation.\n\nBest regards,`
      : `${name} 님, 안녕하세요.\n\n${evName}에 연사로 모시고자 연락드립니다.\n\n${sessions ? `배정 세션\n${sessions}\n\n` : ''}참석 가능 여부를 회신해 주시면 감사하겠습니다.\n\n감사합니다.`,
    /* 무엇을 달라고 할지는 역할이 요구하는 것에서 나온다 — 좌장에게 발제를
       묻지 않듯, 이 행사가 학력을 안 받으면 메일에도 안 적는다. */
    profile: (() => {
      const roles = rolesOfSpeaker(sp.id);
      const want = BIO_PARTS.filter(p => needState(evKey, roles, p.need));
      const line = (p) => {
        const l = lim[p.lim];
        return en ? `- ${p.label}${l ? ` (within ${l} characters)` : ''}`
          : `- ${p.label}${l ? ` (${l}자 이내)` : ''}`;
      };
      return en
        ? `Dear ${name},\n\nCould you please send us the following for the programme book?\n${
            want.map(line).join('\n')}\n- A portrait photo (high resolution)\n\nBest regards,`
        : `${name} 님, 안녕하세요.\n\n프로그램북 제작을 위해 아래 자료를 부탁드립니다.\n${
            want.map(line).join('\n')}\n- 사진 (고해상도)${dueLine('profile', '자료')}\n\n감사합니다.`;
    })(),
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
  const sp = getSpeakerById(spDrUi.spId);
  if(!sp) return;
  const msg = document.getElementById('sp-mail-msg');
  const say = (t, ok) => { if(msg){ msg.style.color = ok ? 'var(--g)' : 'var(--re)'; msg.textContent = t; } };

  const reply = spDrUi.spReply;
  const t = reply ? { to: reply.to, cc: [], partners: [] } : mailTargetsFor(sp);
  if(!t.to.length){ say('수신이 없어요 — «연락 상대»에서 먼저 정해주세요.', false); return; }
  const subject = (document.getElementById('sp-mail-subject')?.value || '').trim();
  const text = (document.getElementById('sp-mail-body')?.value || '').trim();
  if(!subject && !text){ say('제목이나 내용 중 하나는 있어야 해요.', false); return; }
  // 회신은 연락 단계 메일이 아니다 — 단계 기록·기본 첨부·날짜 찍기를 하지 않는다
  const pick = document.getElementById('sp-mail-kind')?.value || 'note';
  // 일괄 요청은 «자료 받기» 메일로 남긴다 — 그래야 다음 메일이 «독촉»으로 바뀐다
  const lib = !reply && pick.startsWith('lib:') ? libItem(pick.slice(4)) : null;
  const kind = reply ? 'reply' : pick === 'bulkreq' ? 'collect' : pick.startsWith('lib:') ? 'note' : pick;
  const flowD = reply ? null : draftFor(sp, kind);
  const category = reply ? '회신' : lib ? lib.name : pick === 'bulkreq' ? '자료 일괄 요청'
    : flowD ? flowD.category : ((MAIL_KINDS.find(k => k.key === kind) || {}).label || '기타');

  /* 밖으로 나가는 일은 한 번 묻는다 — 받는 사람을 눈으로 확인하지 않으면
     엉뚱한 사람에게 간 걸 나중에 알게 된다. */
  const from = await eventMailFrom(sp.event_id);
  if(!from.ok){ say(from.text, false); return; }
  if(!confirm(`이 내용으로 보낼까요?\n\n발신 ${from.text}\n수신 ${t.to.join(', ')}${t.cc.length ? `\n참조 ${t.cc.join(', ')}` : ''}\n제목 ${subject}`)) return;

  const fileIds = reply ? [...reply.pick]
    : mailFilesOf(sp.event_id).filter(f => f.step === kind && !spDrUi.spSkipDefault.has(f.id)).map(f => f.id);
  if(spDrUi.spLocalFiles.reduce((n, f) => n + f.size, 0) > 3 * 1024 * 1024){ say('PC에서 고른 첨부가 3MB를 넘어요.', false); return; }

  say('보내는 중…', true);
  const attachments = [];
  for(const f of spDrUi.spLocalFiles) attachments.push({ filename: f.name, content_type: f.type, data: await fileToBase64(f) });
  const res = await sendMail({ to: t.to, cc: t.cc, subject, text, speaker_id: sp.id, category, kind,
    attachments, file_ids: fileIds });
  if(!res.ok){
    say(res.offline ? '테스트 모드에서는 보내지 않아요.' : (res.error || '보내지 못했어요.'), false);
    return;
  }
  /* 서버가 기록을 남긴다. 화면에도 같은 줄을 바로 끼운다 — 새로 고쳐야
     보이면 방금 보낸 게 안 남은 줄 알고 또 보낸다. */
  /* 서버가 남긴 기록 id를 쓴다 — 임시 id로 두면 연사를 지울 때 이 기록이 안 지워졌다.
     기록 저장에 실패했으면 화면에도 끼우지 않는다(없는 기록을 보여 주면 안 된다) */
  if(res.logId) SPEAKER_LOGS.push({
    id: res.logId, speaker_id: sp.id, kind, ts: nowStamp(),
    direction: 'out', channel: '이메일',
    counterpart: [t.to.join(', '), t.cc.length ? `(cc) ${t.cc.join(', ')}` : ''].filter(Boolean).join(' '),
    category, subject, answered_at: '', answer: '', status: 'done',
    body: text + ((attachments.length || fileIds.length)
      ? `\n\n[첨부] ${[...mailFilesOf(sp.event_id).filter(f => fileIds.includes(f.id)).map(f => f.filename), ...spDrUi.spLocalFiles.map(f => f.name)].join(', ')}` : ''),
    author_email: '', author_name: '',
  });
  /* 공동연사에게도 같은 기록을 남긴다 — 상대 드로어에서도 «보냄»으로 보이고 연락 단계가 넘어간다 */
  for(const p of t.partners){
    const row = { speaker_id: p.id, kind, ts: nowStamp(), direction: 'out', channel: '이메일',
      counterpart: [t.to.join(', '), t.cc.length ? `(cc) ${t.cc.join(', ')}` : ''].filter(Boolean).join(' '),
      category, subject, answered_at: '', answer: '', status: 'done',
      body: `[공동연사 ${sp.name_snapshot || sp.name_en || ''}와 함께 보냄]

${text}`,
      author_email: currentUser?.email || '', author_name: currentUser?.name || '' };
    const r = await saveSpeakerLog(row);
    if(r && r.ok !== false && !r.offline) SPEAKER_LOGS.push({ ...row, id: r.id || `SL-tmp-${Date.now()}-${p.id}` });
    if(category === '자료 독촉') await patchSpeaker({ reminded_at: td() }, '자료 독촉 보냄 (공동연사와 함께)', p.id);
    if(kind === 'invite' && !p.guide_sent_at) await patchSpeaker({ guide_sent_at: td() }, '초청·가이드 보냄 (공동연사와 함께)', p.id);
  }
  trackAction('add', '연사 메일', sp.event_id, `${sp.name_snapshot || sp.name_en || sp.id}${
    t.partners.length ? ` + 공동연사 ${t.partners.map(p => p.name_snapshot || p.name_en).join(', ')}` : ''} — ${category}`,
    { kind: 'speaker', id: sp.id });
  say((res.logged === false ? '보냈어요 — 다만 기록 저장에 실패했어요.' : '보냈어요.')
    + (res.sentError ? ` (보낸메일함에는 못 남겼어요: ${res.sentError})` : ''), true);
  spDrUi.spLocalFiles = []; spDrUi.spSkipDefault = new Set();
  // 회신이었으면 그 받은 메일을 처리함으로 닫는다
  if(reply){ spDrUi.spReply = null; await setMailDone('sp', reply.logId, true); renderSpeakerDr(); return; }
  /* 자료 독촉을 보냈으면 «마지막 독촉» 날짜를 찍는다 — 표의 독촉 칸·엑셀이 이걸 읽는다 */
  if(category === '자료 독촉'){ await patchSpeaker({ reminded_at: td() }, '자료 독촉 보냄', sp.id); }
  /* 초청을 보냈으면 «보냄» 날짜를 찍는다 — 그래야 다음 단계로 넘어간다.
     sp.id를 넘긴다 — 보내는 몇 초 사이 다른 연사를 열면 그 사람에게 찍혔다 */
  if(kind === 'invite' && !sp.guide_sent_at){ await patchSpeaker({ guide_sent_at: td() }, '초청·가이드 보냄', sp.id); return; }
  renderSpeakerDr();
}


/* 화면의 onclick이 부르는 것 */
window.mailTargets = mailTargets;   // 탭(speaker-drawer.js)이 window로 부른다
window.peopleTabHtml = peopleTabHtml;   // 탭(speaker-drawer.js)이 window로 부른다
window.boxTabHtml = boxTabHtml;   // 탭(speaker-drawer.js)이 window로 부른다
window.mailTabHtml = mailTabHtml;   // 탭(speaker-drawer.js)이 window로 부른다
window.fillSpeakerReply = fillSpeakerReply;   // 탭(speaker-drawer.js)이 window로 부른다
window.fillSpeakerMail = fillSpeakerMail;   // 탭(speaker-drawer.js)이 window로 부른다
window.renderSpMailFiles = renderSpMailFiles;   // 탭(speaker-drawer.js)이 window로 부른다
