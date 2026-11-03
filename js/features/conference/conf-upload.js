/* ══════════════════════════════════════════════════════════════
   features/conference/conf-upload.js — 연사·세션 엑셀로 올리기
   (modules/conf-tab.js에서 떼어 냈다. 이 파일은 그 탭의 도우미를 쓰지만 탭은 이 파일을
    import하지 않는다 — 화면의 onclick(window)으로만 부른다. 그래서 고리가 생기지 않는다.
    window에 거는 것은 맨 아래, 이 파일을 읽는 것은 app.js.)
═══════════════════════════════════════════════════════════════ */

import { saveSpeakerContact } from '../../api.js';
import { IMPORT_GUIDE, IMPORT_SHEETS } from '../../conf-import-spec.js';
import { SPEAKER_ROLES } from '../../constants.js';
import { trackAction } from '../../core/audit-log.js';
import { CONF_SESSIONS, EVENT_LIST, SESSION_SPEAKERS, SPEAKERS, SPEAKER_CONTACTS, assignmentsOfSession, confCfg, contacts, contactsOfSpeaker, sessionsForEvent, speakersForEvent } from '../../state.js';
import { pickTrackColorIndex } from '../../track-colors.js';
import { confLockNotice, confLocked, saveConf } from './conf-common.js';
import { confUi } from './conf-ui.js';
import { buildConfEvList, gSaveAssign, gSaveSession, gSaveSpeaker, renderConf } from '../../modules/conf-tab.js';
import { kindOf } from './conf-program.js';

/* ══════════════════════════════════════════════════════════════
   엑셀로 한 번에 올리기

   프로그램은 보통 엑셀로 먼저 돈다 — 학술위원회가 세션을 짜고, 사무국이
   연사를 채우고, 그 파일이 메일로 오간다. 그걸 화면에서 한 줄씩 다시
   치게 하면 옮겨 적는 동안 오타가 생기고, 원본과 어긋난 순간부터 어느
   쪽이 맞는지 아무도 모르게 된다.

   지우지 않는다. 올려도 기존 세션·연사를 지우지 않고 더하거나 고칠 뿐이다 —
   잘못 올렸을 때 되돌릴 것이 남아야 한다.
══════════════════════════════════════════════════════════════ */

/* 양식 내려받기 — 정의는 conf-import-spec.js 하나만 본다 */
export function downloadConfTemplate(){
  if(typeof XLSX === 'undefined'){ alert('엑셀 라이브러리를 불러오지 못했어요. 새로고침 후 다시 해주세요.'); return; }
  const wb = XLSX.utils.book_new();
  const guide = XLSX.utils.aoa_to_sheet(IMPORT_GUIDE);
  guide['!cols'] = [{ wch: 14 }, { wch: 92 }];
  XLSX.utils.book_append_sheet(wb, guide, '안내');
  IMPORT_SHEETS.forEach(sh => {
    const rows = [
      sh.cols.map(c => c.label),
      sh.cols.map(c => (c.hint ? `↳ ${c.hint}` : '')),
      ...sh.sample,
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = sh.cols.map(c => ({ wch: Math.max(12, Math.min(34, c.label.length * 2 + 8)) }));
    XLSX.utils.book_append_sheet(wb, ws, sh.name);
  });
  const ev = EVENT_LIST.find(e => e.key === confUi.confEvent);
  XLSX.writeFile(wb, `${(ev?.short || ev?.key || '컨퍼런스')}_업로드_양식.xlsx`);
}

/* 머리글로 칸을 찾는다 — 열 순서가 바뀌어도 읽히게. 사람이 열을 옮기는 건
   흔한 일이고, 그걸로 못 읽으면 «양식대로 넣었는데»가 된다. */
function readSheet(wb, sh){
  const ws = wb.Sheets[sh.name];
  if(!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  if(!rows.length) return [];
  const head = rows[0].map(v => String(v || '').trim());
  const idx = {};
  sh.cols.forEach(c => { idx[c.key] = head.indexOf(c.label); });
  return rows.slice(1)
    /* 2행은 우리가 넣은 설명 줄이다. «↳»로 시작하면 건너뛴다 —
       지우고 쓰는 사람도 있고 남겨 두는 사람도 있다. */
    .filter(r => !String(r[0] || '').trim().startsWith('↳'))
    .map(r => {
      const o = {};
      sh.cols.forEach(c => { o[c.key] = idx[c.key] >= 0 ? String(r[idx[c.key]] ?? '').trim() : ''; });
      return o;
    })
    .filter(o => Object.values(o).some(v => v));
}

/* 엑셀이 시각을 0.4687500…으로 바꿔 놓는 일이 잦다. 되돌려 준다 —
   여기서 안 받아 주면 «시간이 다 비어서 들어왔다»가 된다. */
/* 엑셀의 종류 칸 — 사람마다 «오찬»«점심»«Lunch»로 적는다. 다 받아 준다.
   모르는 말이면 null을 돌려 올리기 전에 알린다. */
function normKind(v){
  const s = String(v || '').trim().toLowerCase().replace(/\s+/g, '');
  if(!s || s === '세션' || s === 'session') return '';
  if(/브레이크|휴식|커피|break|coffee/.test(s)) return 'break';
  if(/런치|오찬|점심|중식|lunch|luncheon/.test(s)) return 'lunch';
  if(/디너|만찬|갈라|저녁|석식|dinner|gala/.test(s)) return 'dinner';
  if(/기타|세션아님|아님|기념촬영|촬영|사진|등록|이동|other|photo|registration/.test(s)) return 'other';
  return null;
}

function normTime(v){
  const s = String(v || '').trim();
  if(!s) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if(m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  const n = Number(s);
  if(Number.isFinite(n) && n > 0 && n < 1){
    const mins = Math.round(n * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  return s;
}
function normDate(v){
  const s = String(v || '').trim();
  if(!s) return '';
  const m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s);
  if(m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  /* 엑셀이 날짜 칸을 «11/19/26»(월/일/연 두 자리)로 내보내는 일이 있다.
     그대로 두면 화면이 날짜로 못 읽어 요일이 비고 정렬도 어긋난다 */
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if(us){
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${y}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }
  /* 엑셀 일련번호(1900 기준) */
  const n = Number(s);
  if(Number.isFinite(n) && n > 20000 && n < 80000){
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return s;
}

export function pickConfFile(){
  if(confLocked()){ confLockNotice(); return; }
  document.getElementById('conf-xlsx-input')?.click();
}

export async function handleConfFile(e){
  const file = e.target?.files?.[0];
  if(e.target) e.target.value = '';   // 같은 파일을 다시 골라도 열리게
  if(!file) return;
  if(confLocked()){ confLockNotice(); return; }
  const ev = EVENT_LIST.find(x => x.key === confUi.confEvent);
  if(!ev) return;

  let wb;
  try {
    const buf = await file.arrayBuffer();
    wb = XLSX.read(buf, { type: 'array', cellText: true, cellDates: false });
  } catch(err){ alert(`엑셀을 읽지 못했어요 (${err.message}).`); return; }

  const spec = Object.fromEntries(IMPORT_SHEETS.map(sh => [sh.key, sh]));
  const missing = IMPORT_SHEETS.filter(sh => !wb.Sheets[sh.name]).map(sh => sh.name);
  if(missing.length === IMPORT_SHEETS.length){
    alert(`«${IMPORT_SHEETS.map(s => s.name).join('», «')}» 시트를 찾지 못했어요.\n«양식 받기»로 받은 파일에 채워 올려주세요.`);
    return;
  }

  const rowsS = readSheet(wb, spec.sessions);
  const rowsP = readSheet(wb, spec.speakers);
  const rowsA = readSheet(wb, spec.assignments);
  if(!rowsS.length && !rowsP.length && !rowsA.length){ alert('채워진 줄이 없어요.'); return; }

  /* 무엇이 새로 만들어지고 무엇이 이미 있는지 먼저 보여준다 — 올리고 나서
     알려 주면 되돌릴 수 없다. */
  const sessKey = (t) => String(t || '').trim().toLowerCase();
  /* 메일로 마스터DB 사람 찾기 — 비서실·공용 주소처럼 여럿이 쓰는 메일이면 이름까지 맞는 사람만.
     전에는 그 주소의 첫 사람에게 연사가 이어졌다 */
  const contactIdByMail = (m, name) => {
    const e = String(m || '').trim().toLowerCase();
    if(!e) return '';
    const hits = contacts.filter(k => [k.email1, k.email2].some(x => x && String(x).trim().toLowerCase() === e));
    if(hits.length <= 1) return hits[0] ? String(hits[0].id) : '';
    const n = sessKey(name);
    const same = hits.filter(k => n && [k.nameKo, k.nameEn].some(x => x && sessKey(x) === n));
    return same.length === 1 ? String(same[0].id) : '';
  };
  /* 식사·휴식은 이름으로 찾지 않는다 — «오찬»은 날마다 있다. 이름으로 찾으면
     둘째 날 오찬이 첫째 날 것을 덮는다. 종류·일자·시작으로 찾는다. */
  const haveSess = new Map(), haveBreak = new Map();
  const breakKey = (r) => `${r.kind}|${normDate(r.date)}|${normTime(r.start_at)}`;
  const keep = (x) => {
    if(x.kind){ haveBreak.set(breakKey(x), x); return; }
    if(x.title_ko) haveSess.set(sessKey(x.title_ko), x);
    if(x.title_en) haveSess.set(sessKey(x.title_en), x);
  };
  sessionsForEvent(ev.key).forEach(keep);
  const findSess = (r) => r.kind ? haveBreak.get(breakKey(r))
    : haveSess.get(sessKey(r.title_ko)) || haveSess.get(sessKey(r.title_en));
  const haveSp = new Map(speakersForEvent(ev.key).map(x => [sessKey(x.name_snapshot), x]));

  /* 종류를 먼저 읽는다 — 세션명이 비어 있으면 종류 이름을 세션명으로 쓴다.
     «런치»만 적은 줄도 받아야 한다(샘플이 그렇게 생겼다). */
  const badKind = [];
  rowsS.forEach(r => {
    const k = normKind(r.kind);
    if(k === null){ badKind.push(r.kind); r.kind = ''; return; }
    /* 종류 칸이 비었으면 세션명으로 짐작한다 — «커피 브레이크»«만찬»을 종류 없이 올리는 일이 잦다 */
    r.kind = k || [r.title_ko, r.title_en].map(normKind).find(Boolean) || '';
    const d = kindOf(r.kind);
    if(r.kind && !r.title_ko && !r.title_en){ r.title_ko = d.ko; r.title_en = d.en; }
  });

  const newSess = rowsS.filter(r => !findSess(r));
  const newSp = rowsP.filter(r => !haveSp.has(sessKey(r.name_snapshot)));
  /* 배정이 가리키는 세션·연사가 이 파일이나 화면에 있는지 미리 본다 */
  const willSess = new Set([...haveSess.keys(), ...rowsS.flatMap(r => [sessKey(r.title_ko), sessKey(r.title_en)]).filter(Boolean)]);
  const willSp = new Set([...haveSp.keys(), ...rowsP.map(r => sessKey(r.name_snapshot)).filter(Boolean)]);
  const orphan = rowsA.filter(r => !willSess.has(sessKey(r._session)) || !willSp.has(sessKey(r._speaker)));

  const msg = `«${ev.short || ev.key}»에 올립니다.\n\n`
    + `세션 ${rowsS.length}줄 — 새로 ${newSess.length}, 이미 있는 것 ${rowsS.length - newSess.length}\n`
    + `연사 ${rowsP.length}줄 — 새로 ${newSp.length}, 이미 있는 것 ${rowsP.length - newSp.length}\n`
    + `배정 ${rowsA.length}줄${orphan.length ? ` — 이 중 ${orphan.length}줄은 세션이나 연사를 못 찾아 건너뜁니다` : ''}\n\n`
    + (badKind.length ? `종류를 못 알아본 ${badKind.length}줄(${[...new Set(badKind)].join(', ')})은 발표 세션으로 넣습니다

` : '')
    + `이미 있는 것은 비어 있지 않은 칸만 덮어씁니다. 지우지 않습니다.`;
  if(!confirm(msg)) return;

  /* 연사는 이름으로 찾는다(배정 표도 이름으로 가리킨다). 이름이 같고 소속이 다르면 동명이인일 수 있다 —
     그대로 두면 둘째 사람이 첫 사람의 소속·직함·사례비를 덮어쓴다 */
  const orgKey = (x) => sessKey(x.org_ko || x.org_en);
  const seen = new Map();
  const homonyms = [];
  rowsP.forEach(r => {
    const k = sessKey(r.name_snapshot);
    if(!k || !orgKey(r)) return;
    const prev = seen.get(k) || haveSp.get(k);
    if(prev && orgKey(prev) && orgKey(prev) !== orgKey(r)) homonyms.push(`${r.name_snapshot} — ${prev.org_ko || prev.org_en} / ${r.org_ko || r.org_en}`);
    if(!seen.has(k)) seen.set(k, r);
  });
  if(homonyms.length && !confirm(`이름은 같은데 소속이 다른 연사가 ${homonyms.length}명 있어요:\n\n${homonyms.slice(0, 10).join('\n')}\n\n`
    + `같은 사람(소속이 바뀜)이면 확인을 누르세요 — 새 소속으로 덮어씁니다.\n다른 사람이면 취소하고, 파일에서 이름 뒤에 구분을 붙여(예: 김지훈(서울대)) 다시 올려 주세요.`)) return;

  const msgEl = document.getElementById('conf-import-msg');
  const say = (t, ok) => { if(msgEl){ msgEl.style.color = ok === false ? 'var(--re)' : 'var(--i4)'; msgEl.textContent = t; } };
  const fail = (what) => { say(`${what}에서 멈췄어요 — 여기까지는 저장됐습니다.`, false); };

  let nS = 0, nP = 0, nA = 0;
  say('올리는 중…');

  /* ── 세션 ── */
  for(const r of rowsS){
    const exist = findSess(r);
    const patch = {
      date: normDate(r.date), start_at: normTime(r.start_at), end_at: normTime(r.end_at),
      room: r.room, track: r.track, title_ko: r.title_ko, title_en: r.title_en, note: r.note,
      kind: r.kind,
    };
    /* 빈 칸은 덮지 않는다 — 엑셀에서 한 열만 채워 올리는 일이 흔한데,
       그때 나머지가 지워지면 화면에서 채워 둔 값이 통째로 날아간다. */
    Object.keys(patch).forEach(k => { if(!patch[k]) delete patch[k]; });
    if(exist){
      const diff = Object.keys(patch).filter(k => String(exist[k] ?? '') !== patch[k]);
      if(!diff.length) continue;
      const res = await gSaveSession({ id: exist.id, ...patch });
      if(!res || res.ok === false){ fail('세션'); return; }
      Object.assign(exist, patch); nS++;
    } else {
      const row = { event_id: ev.key, seq: String(sessionsForEvent(ev.key).length + 1),
        title_ko: '', title_en: '', date: '', start_at: '', end_at: '', room: '', track: '', note: '', ...patch };
      const res = await gSaveSession(row);
      if(!res || res.ok === false){ fail('세션'); return; }
      const made = { ...row, id: res.id || `CS-tmp-${Date.now()}-${nS}` };
      CONF_SESSIONS.push(made);
      keep(made);
      nS++;
    }
  }

  /* ── 연사 ── */
  for(const r of rowsP){
    if(!r.name_snapshot) continue;
    const exist = haveSp.get(sessKey(r.name_snapshot));
    const patch = {
      name_snapshot: r.name_snapshot, name_en: r.name_en, org_ko: r.org_ko, org_en: r.org_en,
      title_ko: r.title_ko, title_en: r.title_en, lang_pref: r.lang_pref,
      nationality: r.nationality, residence_country: r.residence_country,
      status: r.status, fee_amount: r.fee_amount, fee_currency: r.fee_currency, note: r.note,
    };
    Object.keys(patch).forEach(k => { if(!patch[k]) delete patch[k]; });
    let sp = exist;
    if(sp){
      const diff = Object.keys(patch).filter(k => String(sp[k] ?? '') !== patch[k]);
      if(diff.length){
        const res = await gSaveSpeaker({ id: sp.id, ...patch });
        if(!res || res.ok === false){ fail('연사'); return; }
        Object.assign(sp, patch); nP++;
      }
    } else {
      /* 마스터DB에 같은 메일의 사람이 있으면 그 사람으로 잇는다 — 안 이으면 마스터DB에서
         그 사람의 연사 이력·주고받은 메일이 안 보이고, 다음 행사 섭외 때도 못 찾는다 */
      const row = { event_id: ev.key, contact_id: contactIdByMail(r.email, r.name_snapshot), status: '섭외중', lang_pref: '', note: '', ...patch };
      const res = await gSaveSpeaker(row);
      if(!res || res.ok === false){ fail('연사'); return; }
      sp = { ...row, id: res.id || `SP-tmp-${Date.now()}-${nP}` };
      SPEAKERS.push(sp);
      haveSp.set(sessKey(sp.name_snapshot), sp);
      nP++;
    }
    /* 메일을 적었으면 연락 상대(수신)로 만들어 둔다 — 연사에게 무엇을
       보내려면 수신이 있어야 하고, 없으면 메일 칸이 열리지 않는다. */
    if(r.email && !contactsOfSpeaker(sp.id).some(x => x.email === r.email)){
      const c = { speaker_id: sp.id, contact_id: contactIdByMail(r.email, sp.name_snapshot), name: sp.name_snapshot,
        email: r.email, phone: r.phone || '', kind: '연사 본인',
        send: contactsOfSpeaker(sp.id).some(x => x.send === 'to') ? 'cc' : 'to', note: '' };
      const res = await saveSpeakerContact(c);
      if(res && res.ok !== false) SPEAKER_CONTACTS.push({ ...c, id: res.id || `SC-tmp-${Date.now()}` });
    }
  }

  /* ── 배정 ── */
  const seqBySession = {};
  for(const r of rowsA){
    const ss = haveSess.get(sessKey(r._session));
    const sp = haveSp.get(sessKey(r._speaker));
    if(!ss || !sp) continue;
    const role = r.role || SPEAKER_ROLES[0].key;
    const dup = assignmentsOfSession(ss.id).find(a => a.speaker_id === sp.id && a.role === role);
    const patch = {
      role, seq: r.seq || '', lang: r.lang,
      start_at: normTime(r.start_at), end_at: normTime(r.end_at), duration_min: r.duration_min,
      title_ko: r.title_ko, title_en: r.title_en, note: r.note,
    };
    Object.keys(patch).forEach(k => { if(!patch[k]) delete patch[k]; });
    if(!patch.seq){
      seqBySession[ss.id] = (seqBySession[ss.id] || assignmentsOfSession(ss.id).length) + 1;
      patch.seq = String(seqBySession[ss.id]);
    }
    if(dup){
      const diff = Object.keys(patch).filter(k => String(dup[k] ?? '') !== patch[k]);
      if(!diff.length) continue;
      const res = await gSaveAssign({ id: dup.id, ...patch });
      if(!res || res.ok === false){ fail('배정'); return; }
      Object.assign(dup, patch); nA++;
    } else {
      const row = { event_id: ev.key, session_id: ss.id, speaker_id: sp.id,
        lang: '', duration_min: '', start_at: '', end_at: '',
        title_ko: '', title_en: '', abstract_ko: '', abstract_en: '', abstract_received_at: '',
        slides_file: '', slides_received_at: '', slides_version: '', note: '', ...patch };
      const res = await gSaveAssign(row);
      if(!res || res.ok === false){ fail('배정'); return; }
      SESSION_SPEAKERS.push({ ...row, id: res.id || `SS-tmp-${Date.now()}-${nA}` });
      nA++;
    }
  }

  /* 엑셀에 있던 트랙·장소를 설정에 등록한다. 세션에만 있고 설정에 없으면
     고를 목록이 비어 다음부터 손으로 타이핑하게 되고, 색도 트랙마다 정해
     두지 못한다 — 올린 사람이 나중에 설정을 다시 채울 일은 없다. */
  const cfg = JSON.parse(JSON.stringify(confCfg(ev.key)));
  const before = JSON.stringify([cfg.tracks || [], cfg.rooms || [], cfg.trackColors || {}]);
  cfg.tracks = cfg.tracks || []; cfg.rooms = cfg.rooms || [];
  cfg.trackColors = { ...(cfg.trackColors || {}) };
  sessionsForEvent(ev.key).forEach(x => {
    if(x.track && !cfg.tracks.includes(x.track)) cfg.tracks.push(x.track);
    /* 장소는 순서가 곧 표의 열 순서다. 어디가 메인인지는 우리가 모르니
       뒤에 붙이고, 순서는 설정에서 사람이 정한다. */
    if(x.room && !cfg.rooms.includes(x.room)) cfg.rooms.push(x.room);
  });
  cfg.tracks.forEach(t => {
    if(!Number.isInteger(cfg.trackColors[t])) cfg.trackColors[t] = pickTrackColorIndex(cfg);
  });
  if(JSON.stringify([cfg.tracks, cfg.rooms, cfg.trackColors]) !== before){
    await saveConf(ev.key, cfg);
  }

  trackAction('add', '컨퍼런스 업로드', ev.key,
    `${ev.name || ev.key} — 세션 ${nS} · 연사 ${nP} · 배정 ${nA}`);
  say(`올렸어요 — 세션 ${nS} · 연사 ${nP} · 배정 ${nA}${orphan.length ? ` (건너뛴 배정 ${orphan.length})` : ''}`);
  buildConfEvList();
  renderConf();
}


/* 화면의 onclick이 부르는 것 */
window.downloadConfTemplate = downloadConfTemplate;
window.pickConfFile         = pickConfFile;
window.handleConfFile       = handleConfFile;
