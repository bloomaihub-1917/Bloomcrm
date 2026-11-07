/* ══════════════════════════════════════════════════════════════
   sync-sent.js — 보낸메일함 → 연사·참가사 발송 기록
   (../../routes/mail.js에서 떼어 냈다. 그 파일이 이 파일을 require한다 — 이 파일은 그 파일을 부르지 않는다)
═══════════════════════════════════════════════════════════════ */
const pool = require('../../db/pool');
const { LOCAL_MAX, TOTAL_MAX, FILE_MAX, ensureFiles, b64size, cfg, transport, kstDate, kstStamp, PROVIDERS, prov, ensureBox, markSynced, secretKey, seal, BOX_SELECT, boxOf, boxTransport, boxPublic, FOOTER_IMG_MAX, withFooter, imapClient, SENT_NAMES, saveToSent, partDone, senderFor } = require('./box');
const { simpleParser } = require('mailparser');
const { convert: htmlToText } = require('html-to-text');
const { ensureExtra, isSpam, isBulk, domainOf, FREE_MAIL, mailWarnings } = require('./screen');
const { isOurs, domainList } = require('../../routes/mail-forward');

/* ── 보낸메일함 → 연사 발송 기록 ──
   CRM이 생기기 전(또는 메일플러그 웹메일에서 직접) 보낸 메일은 기록에 없다. 행사
   메일함의 보낸메일함을 읽어, 받는 사람이 이 행사 연사(기본 정보 메일·연락 상대)인
   메일을 그 연사의 «보낸 기록»으로 옮긴다. 제목에 «초청»이 들어가면 초청·가이드를
   보낸 것으로 보고 «보냄» 날짜(guide_sent_at)가 비어 있을 때만 찍는다.

   apply가 없으면 무엇을 할지만 돌려준다 — 화면에서 확인한 뒤 apply로 다시 부른다.
   같은 날·같은 제목의 보낸 기록이 이미 있으면 건너뛴다(CRM에서 보낸 것, 두 번 누른 것). */
/* 본문 글자 — 메일플러그 웹메일은 본문을 HTML로만 보낸다(text 없음). text가 비면
   HTML을 글자로 바꾼다. 안 그러면 기록에 첨부 이름만 남았다. 이미지·링크 주소는 뺀다 */
const H2T = { wordwrap: false,
  selectors: [{ selector: 'img', format: 'skip' }, { selector: 'a', options: { ignoreHref: true } }] };
/* 본문으로 쓸 첨부 — 어떤 메일은 본문(text/html)을 이름 붙은 조각으로 넣어 첨부로 잡힌다
   («def3907333c4» 같은 이름). 글자·HTML 본문이 둘 다 비면 이걸 본문으로 쓴다 */
const bodyParts = (mail) => (mail.attachments || [])
  .filter((a) => /^text\/(html|plain)/i.test(a.contentType || '') && a.content && a.size < 512 * 1024);
/* 이미지 자리 — 글자로 바꾸면 이미지가 사라져 «아래 사진 참고»를 놓친다.
   자리에 [🖼 이미지: 이름]을 남긴다(1×1 추적 픽셀은 뺀다). 이미지는 «원문 보기»로 본다 */
function markImages(html, mail) {
  return String(html || '').replace(/<img\b[^>]*>/gi, (tag) => {
    if (/\b(width|height)\s*=\s*["']?1["'\s>]/i.test(tag)) return '';
    const attr = (k) => ((tag.match(new RegExp(k + '\\s*=\\s*["\']([^"\']*)["\']', 'i')) || [])[1] || '');
    const src = attr('src');
    let name = attr('alt');
    if (!name && /^cid:/i.test(src)) {
      const a = (mail.attachments || []).find((x) => String(x.cid || '').replace(/[<>]/g, '') === src.slice(4));
      name = (a && a.filename) || '';
    }
    if (!name) name = (src.split('/').pop() || '').split('?')[0];
    if (/^data:/i.test(name)) name = '';
    return ` [🖼 이미지${name ? ': ' + name.slice(0, 60) : ''}] `;
  });
}
const mailText = (mail) => {
  // 본문에 이미지가 있으면 HTML 쪽을 글자로 바꾼다 — 글자 본문에는 이미지 자리가 없다
  const direct = (mail.html && /<img\b/i.test(mail.html) ? htmlToText(markImages(mail.html, mail), H2T).trim() : '')
    || String(mail.text || '').trim()
    || (mail.html ? htmlToText(mail.html, H2T).trim() : '');
  if (direct) return direct;
  return bodyParts(mail).map((a) => {
    const t = a.content.toString('utf8');
    return /html/i.test(a.contentType) ? htmlToText(t, H2T).trim() : t.trim();
  }).filter(Boolean).join('\n\n');
};
const norm = (v) => String(v || '').trim().toLowerCase();
/* 보낸 메일이 연락 단계 중 무엇인지 — 행사마다 제목을 다르게 쓴다
   (KPBMA «연사 가이드라인 송부», AIA «연사 확정 안내 및 자료 제출 요청»,
   «Speaker Confirmation & Submission Request», «Reminder — Speaker Materials»).
   단어 하나로 맞추면 다른 행사는 전부 «기타»가 됐다. 회신·전달(RE/FW)은 단계 메일이 아니다.
   kind는 speaker-flow.js의 단계 키 — invite면 «보냄» 날짜를 찍고, collect가 있으면
   다음 메일은 독촉으로 바뀐다. */
const REPLY_RE = /^\s*(제목\s*:\s*)?\[?\s*(re|fw|fwd|답장|전달)\s*\]?\s*[:\]]?/i;
function classifySent(subject) {
  const t = String(subject || '');
  if (REPLY_RE.test(t)) return { kind: 'note', category: '회신' };
  if (/reminder|재요청|독촉|다시 요청/i.test(t)) return { kind: 'collect', category: '자료 독촉' };
  if (/초청|가이드|확정 안내|invitation|guideline|confirmation/i.test(t)) return { kind: 'invite', category: '초청·가이드 발송' };
  if (/자료\s*(제출|요청)|submission|materials|이력|초록|abstract|profile/i.test(t)) return { kind: 'collect', category: '자료 받기' };
  if (/숙박|항공|accommodation|flight/i.test(t)) return { kind: 'travel', category: '숙박·항공 안내' };
  if (/발표\s*자료|presentation|slides/i.test(t)) return { kind: 'slides', category: '발표자료 받기' };
  if (/감사|thank/i.test(t)) return { kind: 'thanks', category: '감사 메일' };
  return { kind: 'note', category: '기타' };
}
/* 참가사에게 보낸 메일이 어느 단계인지 — js/modules/exh-mail.js EXH_MAIL_STEPS와 같은 키 */
const EXH_LABEL = { manual: '참가 매뉴얼 안내', app: '신청서 제출 요청', booth: '부스 배정 안내',
  payment: '인보이스·입금 안내', graphic: '그래픽 자료 요청', directory: '도록 정보 요청', movein: '반입·설치 안내' };
function classifyExhSent(subject) {
  const t = String(subject || '');
  if (REPLY_RE.test(t)) return { kind: 'note', category: '회신' };
  const k = /매뉴얼|manual/i.test(t) ? 'manual'
    : /신청서|application/i.test(t) ? 'app'
    : /인보이스|입금|invoice|payment/i.test(t) ? 'payment'
    : /그래픽|graphic|디자인 파일/i.test(t) ? 'graphic'
    : /도록|디렉토리|directory|프로그램북/i.test(t) ? 'directory'
    : /반입|설치|move-?in|installation/i.test(t) ? 'movein'
    : /부스\s*(배정|위치|도면)|booth/i.test(t) ? 'booth' : '';
  return k ? { kind: `exh-${k}`, category: EXH_LABEL[k] } : { kind: 'note', category: '기타' };
}
/* 자동 답장·반송 — 헤더(Auto-Submitted, X-Autoreply 등)나 제목으로 알아본다 */
const AUTO_SUBJ = /(^|\W)(automatic reply|auto[- ]?reply|autoreply|out of (the )?office|자동 ?회신|자동 ?응답|부재중|undeliverable|delivery status notification|mail delivery failed)/i;
function isAutoReply(mail) {
  const h = mail.headers || new Map();
  const as = String(h.get('auto-submitted') || '').toLowerCase();
  if (as && as !== 'no') return true;
  if (h.get('x-autoreply') || h.get('x-autorespond') || h.get('x-auto-response-suppress') === 'All') return true;
  if (/^(auto_reply|bulk|junk)$/i.test(String(h.get('precedence') || ''))) return true;
  return AUTO_SUBJ.test(String(mail.subject || ''));
}
const prevDay = (d) => new Date(new Date(`${d}T00:00:00Z`).getTime() - 864e5).toISOString().slice(0, 10);

const syncSentHandler = async (req, res) => {
  const apply = !!(req.body && req.body.apply);
  await ensureExtra().catch(() => {});
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 바꿀 수 없어요' });
  const eventId = String(req.params.eventId);
  try {
    const b = await boxOf(eventId);
    if (!b) return res.status(404).json({ ok: false, error: '이 행사에 공용 메일이 없어요' });
    if (apply && await partDone(eventId, 'conf')) return res.status(423).json({ ok: false, error: '컨퍼런스가 진행 완료라 기록을 바꿀 수 없어요' });

    /* 이 행사 연사의 메일 주소 → 연사 */
    const sp = (await pool.query(`
      SELECT s.id, s.name_snapshot, s.name_en, s.guide_sent_at, c.email1, c.email2
        FROM speakers s LEFT JOIN contacts c ON c.id = s.contact_id
       WHERE s.event_id = $1`, [eventId])).rows;
    const extra = (await pool.query(`
      SELECT sc.speaker_id, sc.email FROM speaker_contacts sc
        JOIN speakers s ON s.id = sc.speaker_id WHERE s.event_id = $1`, [eventId])).rows;
    /* 우리·주최사·행사 메일함 주소는 누구의 주소도 아니다. 담당자 칸에 잘못 들어가 있으면
       거의 모든 메일이 참조(info-kic@…)로 걸려 한 기업에 쌓였다(2026-10, 데이터포라이프에 남의 메일 190통) */
    const hostDomains = domainList(b.host_domains);
    const shared = new Set([norm(b.username), norm(b.from_addr)]);
    const skip = (k) => !k || shared.has(k) || isOurs(k) || hostDomains.includes(domainOf(k));
    const byMail = new Map();
    const add = (em, id) => { const k = norm(em); if (!skip(k) && !byMail.has(k)) byMail.set(k, id); };
    sp.forEach((r) => { add(r.email1, r.id); add(r.email2, r.id); });
    extra.forEach((r) => add(r.email, r.speaker_id));
    const spById = new Map(sp.map((r) => [r.id, r]));

    /* 참가사 담당자 주소 → 기업. 같은 주소가 연사면 연사로 본다(위에서 먼저 잡힌다).
       전시가 진행 완료면 참가사 기록은 건드리지 않는다 */
    const exhDone = await partDone(eventId, 'exh');
    const exByMail = new Map();
    const exName = new Map();
    if (!exhDone) {
      (await pool.query(`SELECT id, company_name FROM exhibitors WHERE event_id = $1`, [eventId])).rows
        .forEach((r) => exName.set(r.id, r.company_name || r.id));
      (await pool.query(`
        SELECT xc.exhibitor_id, xc.email, c.email1, c.email2 FROM exhibitor_contacts xc
          JOIN exhibitors x ON x.id = xc.exhibitor_id LEFT JOIN contacts c ON c.id = xc.contact_id
         WHERE x.event_id = $1`, [eventId])).rows
        .forEach((r) => [r.email, r.email1, r.email2].forEach((em) => {
          const k = norm(em); if (!skip(k) && !byMail.has(k) && !exByMail.has(k)) exByMail.set(k, r.exhibitor_id);
        }));
    }
    const exSeen = new Set((await pool.query(
      `SELECT exhibitor_id id, ts, subject FROM exhibitor_logs WHERE direction = 'out' AND exhibitor_id = ANY($1)`,
      [[...exName.keys()]])).rows.map((l) => `${l.id}|${String(l.ts || '').slice(0, 10)}|${norm(l.subject)}`));

    const logs = (await pool.query(`
      SELECT speaker_id, ts, subject FROM speaker_logs
       WHERE direction = 'out' AND speaker_id = ANY($1)`, [sp.map((r) => r.id)])).rows;
    const seen = new Set(logs.map((l) => `${l.speaker_id}|${String(l.ts || '').slice(0, 10)}|${norm(l.subject)}`));

    /* 보낸메일함 읽기 */
    const client = imapClient(b);
    /* 어느 단계에서 막혔는지 알려 준다 — IMAP 서버는 «Command failed»만 돌려줘서
       무엇이 안 됐는지 알 수 없었다 */
    let stage = '메일함 로그인';
    try { await client.connect(); }
    catch (e) { throw new Error(`${stage} 실패: ${e.responseText || e.message} — 메일플러그 IMAP 사용이 켜져 있는지, 앱 비밀번호가 맞는지 확인해주세요`); }
    const found = [];
    let sentPath = '', total = 0;
    try {
      stage = '메일함 목록 읽기';
      const boxes = await client.list();
      const sent = boxes.find((x) => x.specialUse === '\\Sent')
        || boxes.find((x) => SENT_NAMES.test(x.name || '') || SENT_NAMES.test(x.path || ''));
      if (!sent) throw new Error(`보낸메일함을 찾지 못했어요 (${boxes.map((x) => x.path).join(', ')})`);
      sentPath = sent.path;
      stage = `«${sent.path}» 열기`;
      const lock = await client.getMailboxLock(sent.path);
      try {
        const n = (client.mailbox && client.mailbox.exists) || 0;
        const since = Date.now() - 120 * 864e5;
        /* 1) 머리만 훑는다 — 받는 사람·제목·날짜. 본문은 새로 남길 메일만 2)에서 받는다.
           300통 본문을 다 받아 읽으면 Gmail처럼 큰 메일함은 60초(Vercel)를 넘겼다.
           날짜 검색(SEARCH SINCE)은 메일플러그가 거절해 번호로 마지막 300통을 본다 */
        stage = `«${sent.path}» 메일 머리 읽기`;
        const heads = [];
        for await (const m of (n ? client.fetch(`${Math.max(1, n - 299)}:*`, { envelope: true, internalDate: true, uid: true }) : [])) {
          if (m.internalDate && new Date(m.internalDate).getTime() < since) continue;
          total++;
          const env = m.envelope || {};
          const to = (env.to || []).map((a) => a.address).filter(Boolean);
          const cc = (env.cc || []).map((a) => a.address).filter(Boolean);
          const ids = [...new Set([...to, ...cc].map((a) => byMail.get(norm(a))).filter(Boolean))];
          const exIds = [...new Set([...to, ...cc].map((a) => exByMail.get(norm(a))).filter(Boolean))];
          if (!ids.length && !exIds.length) continue;
          const dt = env.date || m.internalDate || Date.now();
          const date = kstDate(dt), at = kstStamp(dt), subject = String(env.subject || '').trim();
          const dupIn = (set, id) => set.has(`${id}|${date}|${norm(subject)}`) || set.has(`${id}|${prevDay(date)}|${norm(subject)}`);
          heads.push({ uid: String(m.uid || ''), to, cc, ids, exIds, date, at, subject,
            dupEx: new Map(exIds.map((id) => [id, dupIn(exSeen, id)])), dupSp: new Map(ids.map((id) => [id, dupIn(seen, id)])) });
          exIds.forEach((id) => exSeen.add(`${id}|${date}|${norm(subject)}`));
          ids.forEach((id) => seen.add(`${id}|${date}|${norm(subject)}`));
        }
        /* 2) 새로 남길 메일만 본문을 받는다 */
        let needUids = heads.filter((h) => [...h.dupEx.values(), ...h.dupSp.values()].some((d) => !d)).map((h) => h.uid);
        // 한 번에 60통까지(최신부터) — 나머지는 다음 차례에. 본문 없이 남기지 않게 이번 목록에서도 뺀다
        if (needUids.length > 60) {
          const keep = new Set(needUids.slice(-60));
          for (let i = heads.length - 1; i >= 0; i--) {
            const h = heads[i];
            if ([...h.dupEx.values(), ...h.dupSp.values()].some((d) => !d) && !keep.has(h.uid)) heads.splice(i, 1);
          }
          needUids = [...keep];
        }
        const bodyOf = new Map();
        stage = `«${sent.path}» 메일 본문 읽기`;
        if (needUids.length) {
          for await (const m of client.fetch(needUids.join(','), { source: true }, { uid: true })) {
            const mail = await simpleParser(m.source);
            // 본문으로 쓴 조각은 첨부 목록에서 뺀다
            const asBody = new Set(String(mail.text || '').trim() || mail.html ? [] : bodyParts(mail));
            const files = (mail.attachments || []).filter((a) => !asBody.has(a)).map((a) => a.filename).filter(Boolean);
            bodyOf.set(String(m.uid), mailText(mail) + (files.length ? `\n\n[첨부] ${files.join(', ')}` : ''));
          }
        }
        for (const h of heads) {
          const body = bodyOf.get(h.uid) || '';
          for (const id of h.exIds) {
            const cls = classifyExhSent(h.subject);
            found.push({
              t: 'ex', exhibitor_id: id, name: exName.get(id) || id, date: h.date, at: h.at, subject: h.subject, box: sentPath, uid: h.uid,
              to: h.to.join(', '), cc: h.cc.join(', '), kind: cls.kind, category: cls.category, dup: h.dupEx.get(id), body,
            });
          }
          for (const id of h.ids) {
            const s0 = spById.get(id);
            const cls = classifySent(h.subject);
            const invite = cls.kind === 'invite';
            found.push({
              speaker_id: id, name: s0.name_snapshot || s0.name_en || id, date: h.date, at: h.at, subject: h.subject, box: sentPath, uid: h.uid,
              to: h.to.join(', '), cc: h.cc.join(', '), invite, kind: cls.kind, category: cls.category, dup: h.dupSp.get(id),
              stamp: invite && !s0.guide_sent_at, body,
            });
          }
        }
      } finally { lock.release(); }
    } catch (e) {
      // 메일함 쪽 실패는 단계와 서버가 준 사유를 붙여 돌려준다
      e.message = `${stage} 실패: ${e.responseText || e.message}${e.serverResponseCode ? ` (${e.serverResponseCode})` : ''}`;
      throw e;
    } finally { await client.logout().catch(() => {}); }

    /* 초청 날짜는 가장 이른 초청 메일 날짜로 */
    const firstInvite = {};
    found.filter((f) => f.stamp).forEach((f) => {
      if (!firstInvite[f.speaker_id] || f.date < firstInvite[f.speaker_id]) firstInvite[f.speaker_id] = f.date;
    });

    let added = 0, stamped = 0, filled = 0, sorted = 0;
    if (apply) {
      /* 이미 들어간 기록 중 본문이 비어 있던 것(첨부 이름만 있던 것)은 본문을 채운다 —
         HTML 본문을 못 읽던 때 가져온 기록이다 */
      /* 비었는지는 공백·줄바꿈을 다 지우고 본다 — btrim은 줄바꿈을 안 지워서
         «줄바꿈 두 개 + [첨부]…»로 들어간 빈 본문을 못 알아봤다 */
      for (const f of found.filter((x) => x.dup && x.t !== 'ex')) {
        const u = await pool.query(`
          UPDATE speaker_logs SET body = $1
           WHERE speaker_id = $2 AND left(ts, 10) IN ($3, $4) AND lower(btrim(subject)) = $5 AND direction = 'out'
             AND regexp_replace(split_part(COALESCE(body, ''), '[첨부]', 1), '\\s', '', 'g') = ''
             AND regexp_replace($6, '\\s', '', 'g') <> ''`,
        [f.body, f.speaker_id, f.date, prevDay(f.date), norm(f.subject), f.body.split('[첨부]')[0]]);
        filled += u.rowCount || 0;
        await pool.query(`
          UPDATE speaker_logs SET ts = $1
           WHERE speaker_id = $2 AND ts IN ($3, $4) AND lower(btrim(subject)) = $5 AND direction = 'out'
             AND author_name LIKE '%메일함에서 가져옴%'`, [f.at, f.speaker_id, f.date, prevDay(f.date), norm(f.subject)]);
        if (f.kind !== 'note' || f.category !== '기타') {
          const k = await pool.query(`
            UPDATE speaker_logs SET kind = $1, category = $2
             WHERE speaker_id = $3 AND left(ts, 10) IN ($4, $5) AND lower(btrim(subject)) = $6 AND direction = 'out'
               AND kind = 'note' AND COALESCE(category, '기타') = '기타' AND author_name LIKE '%보낸메일함에서 가져옴%'`,
          [f.kind, f.category, f.speaker_id, f.date, prevDay(f.date), norm(f.subject)]);
          sorted += k.rowCount || 0;
        }
      }
      /* 이미 가져온 기록에 원문 위치(메일함·번호)를 채운다 — «원문 보기»가 쓴다 */
      for (const f of found.filter((x) => x.dup && x.uid)) {
        const ex0 = f.t === 'ex';
        await pool.query(`UPDATE ${ex0 ? 'exhibitor_logs' : 'speaker_logs'} SET mail_box = $1, mail_uid = $2
           WHERE ${ex0 ? 'exhibitor_id' : 'speaker_id'} = $3 AND left(ts, 10) IN ($4, $5) AND lower(btrim(subject)) = $6
             AND direction = 'out' AND COALESCE(mail_uid, '') = ''`,
        [f.box, f.uid, ex0 ? f.exhibitor_id : f.speaker_id, f.date, prevDay(f.date), norm(f.subject)]);
      }
      for (const f of found.filter((x) => !x.dup && x.t === 'ex')) {
        await pool.query(`
          INSERT INTO exhibitor_logs (id, exhibitor_id, kind, ts, direction, channel, counterpart, category,
            subject, body, answered_at, answer, status, author_email, author_name, mail_box, mail_uid)
          VALUES ($1,$2,$3,$4,'out','이메일',$5,$6,$7,$8,'','','done',$9,$10,$11,$12)`,
        [`XL-${Date.now()}-${Math.floor(Math.random() * 100000)}`, f.exhibitor_id, f.kind, f.at,
          [f.to, f.cc ? `(cc) ${f.cc}` : ''].filter(Boolean).join(' '), f.category,
          f.subject, f.body, req.user?.email || '', `${req.user?.name || req.user?.email || ''} (보낸메일함에서 가져옴)`, f.box, f.uid]);
        added++;
      }
      for (const f of found.filter((x) => !x.dup && x.t !== 'ex')) {
        await pool.query(`
          INSERT INTO speaker_logs (id, speaker_id, kind, ts, direction, channel, counterpart, category,
            subject, body, answered_at, answer, status, author_email, author_name, mail_box, mail_uid)
          VALUES ($1,$2,$3,$4,'out','이메일',$5,$6,$7,$8,'','','done',$9,$10,$11,$12)`,
        [`SL-${Date.now()}-${Math.floor(Math.random() * 100000)}`, f.speaker_id, f.kind, f.at,
          [f.to, f.cc ? `(cc) ${f.cc}` : ''].filter(Boolean).join(' '), f.category,
          f.subject, f.body, req.user?.email || '', `${req.user?.name || req.user?.email || ''} (보낸메일함에서 가져옴)`, f.box, f.uid]);
        added++;
      }
      for (const [id, d] of Object.entries(firstInvite)) {
        const u = await pool.query(`UPDATE speakers SET guide_sent_at = $1 WHERE id = $2 AND COALESCE(guide_sent_at,'') = ''`, [d, id]);
        stamped += u.rowCount || 0;
      }
    }
    if (apply) await markSynced(eventId, req.user?.name || req.user?.email || '');
    res.json({
      ok: true, applied: apply, sentPath, scanned: total, added, stamped, filled, sorted,
      items: found.map(({ body, ...r }) => r),
      unmatchedSpeakers: sp.filter((r) => !found.some((f) => f.speaker_id === r.id))
        .map((r) => ({ id: r.id, name: r.name_snapshot || r.name_en, email: r.email1 || '' })),
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
};


module.exports = { bodyParts, mailText, norm, AUTO_SUBJ, isAutoReply, prevDay, syncSentHandler };
