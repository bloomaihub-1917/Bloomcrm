/* ══════════════════════════════════════════════════════════════
   sync-inbox.js — 받은메일함 → 연사·참가사 기록, 주인 없는 메일
   (../../routes/mail.js에서 떼어 냈다. 그 파일이 이 파일을 require한다 — 이 파일은 그 파일을 부르지 않는다)
═══════════════════════════════════════════════════════════════ */
const pool = require('../../db/pool');
const { simpleParser } = require('mailparser');
const { isOurs, domainOf: domOf, domainList, parseForward, forwardOf, forwardCandidates, fmtAddr } = require('../../routes/mail-forward');
const { LOCAL_MAX, TOTAL_MAX, FILE_MAX, ensureFiles, b64size, cfg, transport, kstDate, kstStamp, PROVIDERS, prov, ensureBox, markSynced, secretKey, seal, BOX_SELECT, boxOf, boxTransport, boxPublic, FOOTER_IMG_MAX, withFooter, imapClient, SENT_NAMES, saveToSent, partDone, senderFor } = require('./box');
const { bodyParts, mailText, norm, AUTO_SUBJ, isAutoReply, prevDay, syncSentHandler } = require('./sync-sent');
const { ensureExtra, isSpam, isBulk, domainOf, FREE_MAIL, mailWarnings } = require('./screen');
const { isDaemon, recordBounce } = require('./bounces');

/* ── 받은메일함 → 연사·참가사 기록 ──
   상대가 보낸 메일도 그 사람 기록에 쌓는다. 보낸 사람 주소가 이 행사 연사(마스터DB
   메일·연락 상대)면 speaker_logs, 참가사 담당자(담당자 줄 메일·마스터DB 메일)면
   exhibitor_logs에 direction 'in'으로 남긴다. 둘 다 아니면 남기지 않는다 —
   광고·알림까지 쌓이면 정작 사람 메일이 묻힌다.

   «답변 대기» 문의로 만들지는 않는다(kind 'note'). 회신·자료 송부까지 전부 답할 일로
   잡히면 대기 목록이 쓸모없어진다. 문의로 돌릴 메일은 사람이 고른다.
   같은 날(또는 하루 전)·같은 제목·같은 사람의 받은 기록이 있으면 건너뛴다. */
const syncInboxHandler = async (req, res) => {
  const apply = !!(req.body && req.body.apply);
  await ensureExtra().catch(() => {});
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 바꿀 수 없어요' });
  const eventId = String(req.params.eventId);
  const t0 = Date.now();
  let timedOut = false;
  try {
    const b = await boxOf(eventId);
    if (!b) return res.status(404).json({ ok: false, error: '이 행사에 공용 메일이 없어요' });
    // 진행 완료된 파트는 건드리지 않는다
    const confDone = await partDone(eventId, 'conf');
    const exhDone = await partDone(eventId, 'exh');

    /* 주소 → 사람. 같은 주소가 연사와 담당자 둘 다면 연사로 본다 */
    /* 우리·주최사·행사 메일함 주소는 누구의 주소도 아니다 — 담당자 칸에 잘못 들어가 있어도 주인으로 잡지 않는다
       (sync-sent.js와 같은 규칙. info-kic@…가 한 기업 담당자로 걸려 받은 메일이 그 기업에 쌓였다) */
    const shared = new Set([norm(b.username), norm(b.from_addr)]);
    const hostDoms = domainList(b.host_domains);
    const skip = (k) => !k || shared.has(k) || isOurs(k) || hostDoms.includes(domOf(k));
    const byMail = new Map();
    const add = (em, who) => { const k = norm(em); if (!skip(k) && !byMail.has(k)) byMail.set(k, who); };
    const sp = (await pool.query(`
      SELECT s.id, s.name_snapshot, s.name_en, s.guide_sent_at, s.invite_replied_at, c.email1, c.email2
        FROM speakers s LEFT JOIN contacts c ON c.id = s.contact_id WHERE s.event_id = $1`, [eventId])).rows;
    const spName = new Map(sp.map((r) => [r.id, r.name_snapshot || r.name_en || r.id]));
    if (!confDone) {
      sp.forEach((r) => { add(r.email1, { t: 'sp', id: r.id }); add(r.email2, { t: 'sp', id: r.id }); });
      (await pool.query(`SELECT sc.speaker_id, sc.email FROM speaker_contacts sc
         JOIN speakers s ON s.id = sc.speaker_id WHERE s.event_id = $1`, [eventId])).rows
        .forEach((r) => add(r.email, { t: 'sp', id: r.speaker_id }));
    }
    const ex = (await pool.query(`SELECT id, company_name FROM exhibitors WHERE event_id = $1`, [eventId])).rows;
    const exName = new Map(ex.map((r) => [r.id, r.company_name || r.id]));
    if (!exhDone) {
      (await pool.query(`
        SELECT xc.exhibitor_id, xc.email, c.email1, c.email2 FROM exhibitor_contacts xc
          JOIN exhibitors x ON x.id = xc.exhibitor_id
          LEFT JOIN contacts c ON c.id = xc.contact_id
         WHERE x.event_id = $1`, [eventId])).rows
        .forEach((r) => [r.email, r.email1, r.email2].forEach((em) => add(em, { t: 'ex', id: r.exhibitor_id })));
    }

    const seen = new Set();
    (await pool.query(`SELECT speaker_id id, ts, subject FROM speaker_logs WHERE direction = 'in' AND speaker_id = ANY($1)`,
      [sp.map((r) => r.id)])).rows.forEach((l) => seen.add(`sp|${l.id}|${String(l.ts || '').slice(0, 10)}|${norm(l.subject)}`));
    (await pool.query(`SELECT exhibitor_id id, ts, subject FROM exhibitor_logs WHERE direction = 'in' AND exhibitor_id = ANY($1)`,
      [ex.map((r) => r.id)])).rows.forEach((l) => seen.add(`ex|${l.id}|${String(l.ts || '').slice(0, 10)}|${norm(l.subject)}`));

    const self = new Set([norm(b.username), norm(b.from_addr)]);
    // 행사 메일 설정의 «늘 무시» 도메인
    const ignored = new Set(String(b.ignore_domains || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean));
    const hostDomains = domainList(b.host_domains);
    const unknown = [];
    const client = imapClient(b);
    let stage = '메일함 로그인';
    try { await client.connect(); }
    catch (e) { throw new Error(`${stage} 실패: ${e.responseText || e.message} — 메일플러그 IMAP 사용이 켜져 있는지, 앱 비밀번호가 맞는지 확인해주세요`); }
    const found = [];
    const bounces = [], bounced = [];   // 반송 메일(mailer-daemon) — bounces.js
    let total = 0;
    try {
      stage = '받은메일함 열기';
      const lock = await client.getMailboxLock('INBOX');
      try {
        const n = (client.mailbox && client.mailbox.exists) || 0;
        const since = Date.now() - 120 * 864e5;
        // 주인 없는 메일로 이미 본 것(걸러진 것 포함)은 다시 받지 않는다
        const knownUn = new Set((await pool.query(
          `SELECT mail_uid FROM mail_unassigned WHERE event_id = $1 AND mail_box = 'INBOX'`, [eventId])).rows.map((r) => String(r.mail_uid)));
        /* 1) 머리만 훑는다(보낸 사람·제목·날짜). 본문은 새로 남길 메일만 2)에서 받는다 —
           300통 본문을 다 받아 읽으면 큰 메일함은 60초를 넘겼다 */
        stage = '받은메일함 머리 읽기';
        const heads = [];
        for await (const m of (n ? client.fetch(`${Math.max(1, n - 299)}:*`, { envelope: true, internalDate: true, uid: true }) : [])) {
          if (m.internalDate && new Date(m.internalDate).getTime() < since) continue;
          total++;
          const env = m.envelope || {};
          const f0 = (env.from || [])[0] || {};
          const from = f0.address || '';
          if (!from || self.has(norm(from))) continue;
          if (ignored.has(domainOf(from))) continue;
          // 반송 메일 — 보낸 곳에 «반송»을 남기려고 따로 모은다(이미 처리한 것은 knownUn에 있다)
          if (isDaemon(from)) { if (!knownUn.has(String(m.uid || ''))) bounces.push({ uid: String(m.uid || ''), dt: env.date || m.internalDate || Date.now() }); continue; }
          // 부재중·자동 답장·반송은 제목만 보고도 거른다 — 사람 메일이 아니다
          if (AUTO_SUBJ.test(String(env.subject || ''))) continue;
          const who = byMail.get(norm(from));
          const dt = env.date || m.internalDate || Date.now();
          const date = kstDate(dt), subject = String(env.subject || '').trim(), uid = String(m.uid || '');
          const base = { uid, from, fromName: f0.name || '', date, at: kstStamp(dt), subject };
          if (who) {
            const key = (d) => `${who.t}|${who.id}|${d}|${norm(subject)}`;
            const dup = seen.has(key(date)) || seen.has(key(prevDay(date)));
            seen.add(key(date));
            heads.push({ ...base, who, dup });
          } else if (!knownUn.has(uid)) {
            heads.push({ ...base, who: null });
          }
        }
        /* 2) 새로 남길 메일만 본문 */
        /* 한 번에 본문을 받는 수를 묶는다 — 처음 도는 큰 메일함은 모르는 메일이 수백 통이라 60초를 넘겼고,
           넘기면 저장도 못 해 매번 처음부터였다. 아는 사람 메일 먼저, 모르는 메일은 최신부터 40통씩 —
           돌 때마다 쌓여 몇 번 안에 따라잡는다 */
        const knownNew = heads.filter((h) => h.who && !h.dup);
        const strangers = heads.filter((h) => !h.who).slice(-40);
        const keep = new Set([...knownNew.slice(-60), ...strangers].map((h) => h.uid));
        for (let i = heads.length - 1; i >= 0; i--) if ((!heads[i].who || !heads[i].dup) && !keep.has(heads[i].uid)) heads.splice(i, 1);
        const need = [...keep];
        const parsed = new Map();
        stage = '받은메일함 본문 읽기';
        /* 한 통씩 받고 시간을 잰다 — 홍보메일은 소개서 PDF가 붙어 몇 MB씩이라 40통을 한꺼번에 받으면
           60초를 넘겨 함수가 끊겼고, 화면에는 «Failed to fetch»만 떴다(2026-11-05 EVK 지메일).
           45초가 넘으면 멈춘다. 못 받은 메일은 저장하지 않아 다음 가져오기 때 이어 받는다 */
        let cut = false;
        for (const uid of need) {
          if (Date.now() - t0 > 45000) { cut = true; break; }
          const m = await client.fetchOne(uid, { source: true }, { uid: true });
          if (m && m.source) parsed.set(String(m.uid), await simpleParser(m.source));
        }
        /* 반송 메일 — 가져오기(apply) 때만 읽고 남긴다. 최신부터 30통씩, 시간이 남을 때만 */
        if (apply) {
          const names = (w) => (w.t === 'sp' ? spName.get(w.id) : exName.get(w.id));
          for (const bn of bounces.slice(-30).reverse()) {
            if (Date.now() - t0 > 50000) { cut = true; break; }
            const m = await client.fetchOne(bn.uid, { source: true }, { uid: true });
            if (!m || !m.source) continue;
            const r = await recordBounce({ eventId, uid: bn.uid, at: kstStamp(bn.dt), mail: await simpleParser(m.source),
              skip, byMail, names, user: req.user });
            bounced.push(...r.done);
          }
        }
        timedOut = cut;
        const bodyText = (mail) => {
          const asBody = new Set(String(mail.text || '').trim() || mail.html ? [] : bodyParts(mail));
          const files = (mail.attachments || []).filter((a) => !asBody.has(a)).map((a) => a.filename).filter(Boolean);
          return { text: mailText(mail) + (files.length ? `\n\n[첨부] ${files.join(', ')}` : ''), files: files.length };
        };
        for (const h of heads) {
          const mail = parsed.get(h.uid);
          if (!mail && timedOut && keep.has(h.uid)) continue;   // 시간이 모자라 못 받은 메일 — 빈 기록으로 남기지 않고 다음에
          if (mail && isAutoReply(mail)) continue;
          if (!h.who && mail && isOurs(h.from) && !isSpam(mail)) {
            /* 우리 직원이 전달한 메일 — 원래 메일의 보낸 사람·받는 사람·참조로 주인을 찾는다.
               분류는 «받은 메일» 그대로, 전달한 사람은 작성자 칸에만. 시각은 원래 보낸 시각 */
            const fw = parseForward(mailText(mail));
            const hit = forwardCandidates(fw, hostDomains).map((a) => ({ a, who: byMail.get(norm(a.addr)) })).find((x) => x.who);
            if (hit) {
              const who = hit.who;
              const at = fw.sent || h.at, date = at.slice(0, 10);
              const subject = fw.subject || h.subject.replace(/^\s*((fw|fwd|전달)\s*[:\]]\s*|\[(fw|fwd)\]\s*)+/i, '').trim();
              const key = (d) => `${who.t}|${who.id}|${d}|${norm(subject)}`;
              const dup = seen.has(key(date)) || seen.has(key(prevDay(date)));
              seen.add(key(date));
              const bt = bodyText(mail);
              found.push({
                t: who.t, id: who.id, name: who.t === 'sp' ? spName.get(who.id) : exName.get(who.id), uid: h.uid,
                category: '받은 메일', date, at, subject, dup, files: bt.files, body: bt.text,
                from: [fmtAddr(fw.from), [...fw.to, ...fw.cc].length ? `→ ${[...fw.to, ...fw.cc].map((x) => x.addr).join(', ')}` : ''].filter(Boolean).join(' '),
                fwdBy: h.fromName || h.from,
                // 원래 보낸 사람이 그 연사 본인일 때만 «회신 받음»으로 센다 — 주최사가 연사에게 보낸 메일은 회신이 아니다
                fromOwner: hit.a === fw.from,
              });
              continue;
            }
          }
          if (!h.who) {
            /* 모르는 사람 — 스팸·대량 발송은 «걸러짐»으로만 기억하고(다음에 다시 안 받게),
               나머지는 «주인 없는 메일»로 모은다. 사람이 연결하기 전까지 어디에도 붙지 않는다 */
            if (!mail) continue;
            /* 스팸만 본문 없이 «걸러짐». 대량 발송(광고·홍보)은 «promo»로 본문을 남긴다 —
               기업 후보함이 서명에서 회사·전화를 읽는다. 주인 없는 메일 창에는 안 나온다(status 'new'만 보인다) */
            const spam = isSpam(mail), promo = !spam && isBulk(mail);
            const bt = spam ? { text: '' } : bodyText(mail);
            unknown.push({ uid: h.uid, at: h.at, from: h.from, fromName: h.fromName, subject: h.subject,
              body: bt.text, warnings: spam || promo ? [] : mailWarnings(mail), status: spam ? 'filtered' : promo ? 'promo' : 'new' });
            continue;
          }
          const spam = mail ? isSpam(mail) : /^\s*\[(spam|스팸)\]/i.test(h.subject);
          const warns = mail ? mailWarnings(mail) : [];
          const bt = mail ? bodyText(mail) : { text: '', files: 0 };
          found.push({
            t: h.who.t, id: h.who.id, name: h.who.t === 'sp' ? spName.get(h.who.id) : exName.get(h.who.id), uid: h.uid,
            // 아는 사람이어도 스팸 표시·경고가 있으면 분류에 남긴다(버리지 않는다 — 실제 회신이 잘못 걸리기도 한다)
            category: spam ? '받은 메일 · ⚠ 스팸 의심' : warns.length ? '받은 메일 · ⚠ 확인' : '받은 메일',
            date: h.date, at: h.at, subject: h.subject, from: h.fromName ? `${h.fromName} <${h.from}>` : h.from, dup: h.dup,
            files: bt.files, body: bt.text,
          });
        }
      } finally { lock.release(); }
    } catch (e) {
      e.message = `${stage} 실패: ${e.responseText || e.message}${e.serverResponseCode ? ` (${e.serverResponseCode})` : ''}`;
      throw e;
    } finally { await client.logout().catch(() => {}); }

    /* 참석 회신 — 초청·가이드를 보낸 연사에게서 그날 이후 메일이 오면 «회신 받음»을 찍는다.
       날짜는 그 조건의 가장 이른 메일. 이미 찍혀 있으면 두고, 보내기 전에 온 메일은
       회신이 아니다(섭외 전 문의일 수 있다). 이미 가져온 메일(dup)도 센다 */
    const spRow = new Map(sp.map((r) => [r.id, r]));
    const firstReply = {};
    found.filter((f) => f.t === 'sp').forEach((f) => {
      const r = spRow.get(f.id);
      if (!r || !r.guide_sent_at || r.invite_replied_at) return;
      if (f.fwdBy && !f.fromOwner) return;
      if (f.date < String(r.guide_sent_at).slice(0, 10)) return;
      if (!firstReply[f.id] || f.date < firstReply[f.id]) firstReply[f.id] = f.date;
    });
    const replyNames = Object.keys(firstReply).map((id) => spName.get(id));

    let added = 0, replied = 0, unassigned = 0;
    if (apply) {
      for (const [id, d] of Object.entries(firstReply)) {
        const u = await pool.query(`UPDATE speakers SET invite_replied_at = $1, reply_auto = 'yes'
          WHERE id = $2 AND COALESCE(invite_replied_at, '') = ''`, [d, id]);
        replied += u.rowCount || 0;
      }
      for (const f of found.filter((x) => !x.dup)) {
        const sp0 = f.t === 'sp';
        await pool.query(`
          INSERT INTO ${sp0 ? 'speaker_logs' : 'exhibitor_logs'} (id, ${sp0 ? 'speaker_id' : 'exhibitor_id'}, kind, ts, direction,
            channel, counterpart, category, subject, body, answered_at, answer, status, author_email, author_name, mail_box, mail_uid)
          VALUES ($1,$2,'note',$3,'in','이메일',$4,$5,$6,$7,'','','open',$8,$9,'INBOX',$10)`,
        [`${sp0 ? 'SL' : 'XL'}-${Date.now()}-${Math.floor(Math.random() * 100000)}`, f.id, f.at, f.from, f.category,
          f.subject, f.body, req.user?.email || '',
          f.fwdBy ? `${f.fwdBy} 전달 (받은메일함에서 가져옴)` : `${req.user?.name || req.user?.email || ''} (받은메일함에서 가져옴)`, f.uid]);
        added++;
      }
      // 이미 가져온 받은 기록에 원문 위치를 채운다
      for (const f of found.filter((x) => x.dup && x.uid)) {
        const sp0 = f.t === 'sp';
        await pool.query(`UPDATE ${sp0 ? 'speaker_logs' : 'exhibitor_logs'} SET mail_box = 'INBOX', mail_uid = $1
           WHERE ${sp0 ? 'speaker_id' : 'exhibitor_id'} = $2 AND left(ts, 10) IN ($3, $4) AND lower(btrim(subject)) = $5
             AND direction = 'in' AND COALESCE(mail_uid, '') = ''`, [f.uid, f.id, f.date, prevDay(f.date), norm(f.subject)]);
      }
      // 주인 없는 메일 — 같은 메일(메일함·번호)은 한 번만
      for (const u of unknown) {
        const r = await pool.query(`INSERT INTO mail_unassigned (id, event_id, mail_box, mail_uid, ts, from_addr, from_name, subject, body,
            warnings, status, created_at) VALUES ($1,$2,'INBOX',$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (event_id, mail_box, mail_uid) DO NOTHING`,
        [`MU-${Date.now()}-${Math.floor(Math.random() * 100000)}`, eventId, u.uid, u.at, u.from, u.fromName, u.subject, u.body,
          JSON.stringify(u.warnings), u.status || 'new', kstStamp(Date.now())]);
        if (u.status === 'new') unassigned += r.rowCount || 0;
      }
    }
    if (apply) await markSynced(eventId, req.user?.name || req.user?.email || '');
    res.json({
      ok: true, applied: apply, partial: timedOut,
      bounced, bouncePending: apply ? 0 : bounces.length, scanned: total, added, replied, replyNames, unassigned, unknown: unknown.filter((u) => u.status === 'new').length, promo: unknown.filter((u) => u.status === 'promo').length,
      items: found.map(({ body, ...r }) => r),
      skipped: [confDone ? '컨퍼런스(진행 완료)' : '', exhDone ? '전시(진행 완료)' : ''].filter(Boolean),
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
};



module.exports = { syncInboxHandler };
