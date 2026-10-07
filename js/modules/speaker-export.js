/* ══════════════════════════════════════════════════════════════
   speaker-export.js — 연사 엑셀 내려받기

   주최 측과 주고받는 프로그램표(AIA SK Conference Speaker.xlsx)는 손으로
   만든 엑셀이었다. 연사의 소속·직함·발제명이 CRM에서 바뀌어도 그 표는
   그대로라, 보낼 때마다 둘을 맞춰 봐야 했다. 그 양식 그대로 CRM에서 찍는다.

     [Program At a Glance]  쓰던 양식 그대로 — Time·RT·Program·Venue·Name·
                            Affiliation·Title·발제명. 끝나는 시각은 =시작+TIME(,RT,)
                            로 두어 받은 사람이 RT만 고쳐도 뒤가 따라온다.
     [Speaker List]         한 사람 한 줄 — 연락처, 받은 것, 동의, 갈라디너,
                            연사료, 숙박·항공까지 운영에 필요한 것 전부
     [Bio & Abstract]       프로그램북에 들어가는 글

   계좌번호는 넣지 않는다 — 엑셀은 메일로 돌기 쉽다. 받았는지만 적는다.
═══════════════════════════════════════════════════════════════ */

import {
  EVENT_LIST, contacts,
  sessionsForEvent, speakersForEvent, assignmentsOfSession, assignmentsFor,
  contactsOfSpeaker, getSpeakerById, CONF_SESSIONS,
} from '../state.js';
import { SP_CONSENTS } from '../constants.js';
import { spCell, consentRefused } from './conf-tab.js';
import { loadExcelJs } from './exh-export.js';
import { showSaveErrorToast } from '../api.js';
import { trackAction } from './audit-tab.js';

/* ── 서식 ── 양식의 것을 그대로: 맑은 고딕 12, 머리글 짙은 회색(#262626)에 흰 굵은 글씨 */
const FONT   = { name: '맑은 고딕', size: 12 };
const C_HEAD = 'FF262626';
const C_BODY = 'FF222222';
const C_TIME = 'FF393738';
const C_SESS = 'FFF2F2F2';
const BORDER = { style: 'thin', color: { argb: 'FFD9D9D9' } };
const BOX    = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

const t2x = (hhmm) => {                 // 'HH:MM' → 엑셀 시각(하루의 비율)
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  return m ? (+m[1] * 60 + +m[2]) / 1440 : null;
};
const minsBetween = (a, b) => {
  const x = t2x(a), y = t2x(b);
  return x != null && y != null && y > x ? Math.round((y - x) * 1440) : null;
};
const yn = (v) => v === 'yes' ? 'O' : v === 'no' ? 'X' : '';
const got = (v) => v ? `받음 ${v}` : '';

function head(ws, row, labels){
  labels.forEach((l, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = l;
    c.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C_HEAD } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = BOX;
  });
  ws.getRow(row).height = 20;
}

function body(c, opt = {}){
  c.font = { ...FONT, color: { argb: opt.time ? C_TIME : C_BODY }, bold: !!opt.bold };
  c.alignment = { horizontal: opt.left ? 'left' : 'center', vertical: 'middle', wrapText: true };
  c.border = BOX;
  if(opt.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opt.fill } };
}

const nameOf  = (sp) => sp.name_snapshot || sp.name_en || '';
const orgOf   = (sp) => sp.org_en || sp.org_ko || '';
const titleOf = (sp) => sp.title_en || sp.title_ko || '';
const talkOf  = (a) => a.title_en || a.title_ko || '';

/* 연사 본인 연락처 — 연사 줄의 «연사 본인»이 먼저, 없으면 마스터DB */
function selfContact(sp){
  const own = contactsOfSpeaker(sp.id).find(x => /본인/.test(x.kind || '') && (x.email || x.phone));
  const m = sp.contact_id ? contacts.find(c => String(c.id) === String(sp.contact_id)) : null;
  return { email: own?.email || m?.email1 || '', phone: own?.phone || m?.phone1 || '' };
}
const staffOf = (sp) => contactsOfSpeaker(sp.id).filter(x => !/본인/.test(x.kind || ''))
  .map(x => [x.name, x.kind && `(${x.kind})`, x.email].filter(Boolean).join(' ')).join('\n');

const sessSort = (a, b) => `${a.date || ''} ${a.start_at || ''}`.localeCompare(`${b.date || ''} ${b.start_at || ''}`)
  || String(a.seq || '').localeCompare(String(b.seq || ''), undefined, { numeric: true });
const asgSort = (a, b) => String(a.start_at || '').localeCompare(String(b.start_at || ''))
  || String(a.seq || '').localeCompare(String(b.seq || ''), undefined, { numeric: true });

/* ── 1. Program At a Glance ── */
function drawGlance(wb, evKey, title){
  const ws = wb.addWorksheet('Program At a Glance', { views: [{ state: 'frozen', ySplit: 2 }] });
  [15, 15, 8, 60, 16.7, 22.3, 40.2, 23, 57.1, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.getCell('A1').value = title;
  ws.getCell('A1').font = { ...FONT, bold: true };
  head(ws, 2, ['Time', 'End', 'RT', 'Program', 'Venue', 'Name', 'Affiliation', 'Title', '발제명', 'Role']);

  let r = 3, lastDate = null;
  const sessions = sessionsForEvent(evKey).slice().sort(sessSort);
  const multiDay = new Set(sessions.map(s => s.date).filter(Boolean)).size > 1;

  sessions.forEach(s => {
    if(multiDay && s.date !== lastDate){
      lastDate = s.date;
      ws.mergeCells(r, 1, r, 10);
      const c = ws.getCell(r, 1);
      c.value = s.date || '일자 미정';
      body(c, { bold: true, left: true, fill: 'FFD9D9D9' });
      r++;
    }
    /* 취소한 연사는 주최측에 보내는 프로그램표에 싣지 않는다 — 배정을 안 풀어 둔 채로 나갔다 */
    const asg = assignmentsOfSession(s.id)
      .filter(a => (getSpeakerById(a.speaker_id) || {}).status !== '취소').slice().sort(asgSort);
    const rows = asg.length ? asg : [null];
    const start = r;
    const sessMin = minsBetween(s.start_at, s.end_at);

    rows.forEach((a, i) => {
      const sp = a ? getSpeakerById(a.speaker_id) : null;
      const st = (a && a.start_at) || (i === 0 ? s.start_at : '');
      const rt = a ? (Number(a.duration_min) || minsBetween(a.start_at, a.end_at)
        || (sessMin && Math.round(sessMin / rows.length))) : sessMin;

      const cA = ws.getCell(r, 1), cB = ws.getCell(r, 2), cC = ws.getCell(r, 3);
      /* 시작이 없는 줄은 바로 위 줄이 끝나는 시각에서 시작한다(양식의 =B4 방식) */
      cA.value = t2x(st) != null ? t2x(st) : (r > start ? { formula: `B${r - 1}` } : null);
      cC.value = rt || null;
      cB.value = cA.value != null && rt ? { formula: `A${r}+TIME(,C${r},)` } : null;
      [cA, cB].forEach(c => { c.numFmt = 'h:mm'; body(c, { time: true }); });
      body(cC, { time: true });

      const vals = [nameOf(sp || {}), orgOf(sp || {}), titleOf(sp || {}), a ? talkOf(a) : '', a ? (a.role || '') : ''];
      vals.forEach((v, k) => {
        const c = ws.getCell(r, 6 + k);
        c.value = v;
        body(c, { left: k === 3 });
      });
      r++;
    });

    const cD = ws.getCell(start, 4), cE = ws.getCell(start, 5);
    cD.value = s.title_en || s.title_ko || '';
    cE.value = s.room || s.track || '';
    if(r - 1 > start){ ws.mergeCells(start, 4, r - 1, 4); ws.mergeCells(start, 5, r - 1, 5); }
    body(cD, { bold: true, left: true });
    body(cE);
  });
  return sessions.length;
}

/* ── 2. Speaker List ── 운영에 필요한 것 전부 */
const LIST_COLS = [
  ['No', 6], ['시간', 9], ['세션', 30], ['역할', 9], ['상태', 9],
  ['성명', 12], ['Name (EN)', 20], ['소속', 24], ['Affiliation (EN)', 30], ['직함', 14], ['Title (EN)', 24],
  ['국적', 9], ['거주지', 9], ['자료 언어', 10], ['구사 언어', 18],
  ['이메일', 28], ['전화', 18], ['실무 담당', 28],
  ['발제명', 30], ['발제명 (EN)', 40], ['키워드', 20],
  ['이력', 14], ['사진', 14], ['사진 파일', 20], ['CV', 14], ['초록', 14], ['발표자료', 14],
  ['동의서', 14], ...SP_CONSENTS.map(c => [`동의-${c.label}`, 9]), ['동의 메모', 22],
  ['신분증·여권', 14], ['계좌', 14],
  ['갈라디너', 10], ['연사료', 12], ['연사료 지급', 12],
  ['숙박', 26], ['항공', 30],
  ['가이드 보냄', 12], ['마지막 독촉', 12], ['메모', 40],
];

function drawList(wb, evKey){
  const ws = wb.addWorksheet('Speaker List', { views: [{ state: 'frozen', xSplit: 7, ySplit: 1 }] });
  LIST_COLS.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });
  head(ws, 1, LIST_COLS.map(c => c[0]));

  const list = sortedSpeakers(evKey);
  list.forEach((sp, i) => {
    const asg = assignmentsFor(sp.id).slice().sort(asgSort);
    const sess = asg.map(a => CONF_SESSIONS.find(s => s.id === a.session_id)).filter(Boolean);
    const me = selfContact(sp);
    const cell = (k) => spCell(sp, evKey, k);
    const st = (k) => { const c = cell(k); return c.state === 'na' ? '해당 없음' : c.state === 'done' ? (c.text || '받음') : c.state === 'part' ? `일부 ${c.text || ''}` : ''; };
    const talk = (f) => [...new Set(asg.map(a => a[f]).filter(Boolean))].join('\n');
    const recv = (f) => [...new Set(asg.map(a => a[f]).filter(Boolean))].join(', ');
    const idDoc = sp.id_card_received_at || sp.passport_received_at;

    const vals = [
      i + 1,
      asg.map(a => a.start_at).filter(Boolean).join(', ') || sess.map(s => s.start_at).filter(Boolean).join(', '),
      sess.map(s => s.title_en || s.title_ko).join('\n'),
      [...new Set(asg.map(a => a.role).filter(Boolean))].join(', '),
      sp.status || '',
      sp.name_snapshot || '', sp.name_en || '', sp.org_ko || '', sp.org_en || '', sp.title_ko || '', sp.title_en || '',
      sp.nationality || '', sp.residence_country || '',
      sp.lang_pref === 'en' ? '영문만' : sp.lang_pref === 'both' ? '국·영문' : '', sp.languages || '',
      me.email, me.phone, staffOf(sp),
      talk('title_ko'), talk('title_en'), talk('keywords'),
      got(sp.profile_received_at), got(sp.photo_received_at), sp.photo_file || '', got(sp.cv_received_at),
      got(recv('abstract_received_at')), got(recv('slides_received_at')),
      got(sp.consent_at), ...SP_CONSENTS.map(c => yn(sp[c.key])), sp.consent_note || '',
      got(idDoc), st('bank'),
      sp.gala_rsvp === 'yes' ? '참석' : sp.gala_rsvp === 'no' ? '불참' : '',
      sp.fee_amount ? Number(String(sp.fee_amount).replace(/[^\d.-]/g, '')) || sp.fee_amount : '',
      sp.fee_paid_at || '',
      [sp.stay_hotel, sp.stay_in && `${sp.stay_in}~${sp.stay_out || ''}`, sp.stay_room_type].filter(Boolean).join(' · '),
      [sp.air_in_flight && `IN ${sp.air_in_flight} ${sp.air_in_at || ''}`, sp.air_out_flight && `OUT ${sp.air_out_flight} ${sp.air_out_at || ''}`]
        .filter(Boolean).join('\n'),
      sp.guide_sent_at || '', sp.reminded_at || '', sp.note || '',
    ];
    const row = ws.getRow(i + 2);
    vals.forEach((v, k) => {
      const c = row.getCell(k + 1);
      c.value = v;
      body(c, { left: LIST_COLS[k][1] >= 20 });
      if(v === 'X'){ c.font = { ...c.font, bold: true, color: { argb: 'FFC00000' } }; }
    });
    if(LIST_COLS.findIndex(c => c[0] === '연사료') >= 0) row.getCell(LIST_COLS.findIndex(c => c[0] === '연사료') + 1).numFmt = '#,##0';
    /* 공유를 거절한 사람은 줄 전체를 옅게 칠해 자료집 만들 때 눈에 걸리게 한다 */
    if(consentRefused(sp).length) row.eachCell(c => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEA' } };
    });
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: LIST_COLS.length } };
  return list.length;
}

/* ── 3. Bio & Abstract ── 프로그램북 */
const BIO_COLS = [
  ['성명', 12], ['Name (EN)', 20], ['Affiliation (EN)', 28], ['Title (EN)', 24], ['자격·면허', 18],
  ['Professional Profile (EN)', 60], ['Professional Profile', 50],
  ['Education', 40], ['Professional Experience', 50], ['Awards', 40],
  ['발제명 (EN)', 40], ['Abstract (EN)', 70], ['발제명', 30], ['초록', 60],
];
function drawBio(wb, evKey){
  const ws = wb.addWorksheet('Bio & Abstract', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
  BIO_COLS.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });
  head(ws, 1, BIO_COLS.map(c => c[0]));
  sortedSpeakers(evKey).forEach((sp, i) => {
    const asg = assignmentsFor(sp.id).slice().sort(asgSort);
    const j = (f) => asg.map(a => a[f]).filter(Boolean).join('\n\n');
    const vals = [sp.name_snapshot || '', sp.name_en || '', sp.org_en || sp.org_ko || '', sp.title_en || sp.title_ko || '',
      sp.bio_credentials_en || sp.bio_credentials_ko || '',
      sp.bio_profile_en || '', sp.bio_profile_ko || '',
      sp.bio_edu_en || sp.bio_edu_ko || '', sp.bio_pro_en || sp.bio_pro_ko || '', sp.bio_awards_en || sp.bio_awards_ko || '',
      j('title_en'), j('abstract_en'), j('title_ko'), j('abstract_ko')];
    vals.forEach((v, k) => {
      const c = ws.getCell(i + 2, k + 1);
      c.value = v;
      body(c, { left: true });
      c.alignment = { ...c.alignment, vertical: 'top' };
    });
  });
}

/* 프로그램 순서대로 — 처음 올라가는 시각, 배정 없는 사람은 뒤에 */
function sortedSpeakers(evKey){
  const firstAt = (sp) => {
    const t = assignmentsFor(sp.id).map(a => {
      const s = CONF_SESSIONS.find(x => x.id === a.session_id);
      return `${s?.date || '9999'} ${a.start_at || s?.start_at || '99:99'}`;
    }).sort()[0];
    return t || '~';
  };
  return speakersForEvent(evKey).filter(sp => sp.status !== '취소').slice().sort((a, b) => firstAt(a).localeCompare(firstAt(b))
    || nameOf(a).localeCompare(nameOf(b), 'ko'));
}

export async function exportSpeakers(evKey){
  const btn = document.getElementById('sp-export-btn');
  const label = btn ? btn.innerHTML : '';
  if(btn){ btn.disabled = true; btn.innerHTML = '만드는 중…'; }
  try {
    const ExcelJS = await loadExcelJs();
    const ev = EVENT_LIST.find(e => e.key === evKey);
    const evLabel = (ev && (ev.short || ev.name || ev.key)) || evKey;
    const d = new Date(), p = (v) => String(v).padStart(2, '0');
    const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Bloom CRM';
    wb.created = d;
    drawGlance(wb, evKey, `${(ev && ev.name) || evLabel} — Program At a Glance (${today} 기준)`);
    const n = drawList(wb, evKey);
    drawBio(wb, evKey);

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${evLabel}_연사_${today.slice(2).replace(/-/g, '')}.xlsx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    trackAction('export', '연사', evKey, `연사 ${n}명을 엑셀로 내려받았어요`);
  } catch(err){
    console.error('[speaker-export] 내보내기 실패', err);
    showSaveErrorToast(err.message || '엑셀을 만들지 못했어요');
  } finally {
    if(btn){ btn.disabled = false; btn.innerHTML = label; }
  }
}

window.exportSpeakers = exportSpeakers;
