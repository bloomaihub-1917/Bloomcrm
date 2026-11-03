/* ══════════════════════════════════════════════════════════════
   mail.js — CRM에서 메일 보내기 (1단계)

   발송은 행사별 공용 메일(메일플러그)로만 한다 — 아래 «행사별 공용 메일» 참고.
   아래 GMAIL_* 설정은 2026-09-01에 만든 1단계의 흔적으로, 지금은 /status 확인에만
   남아 있고 발송에는 쓰지 않는다.
   Gmail은 앱 비밀번호 + SMTP로 붙는다 — OAuth를 쓰면 Gmail 발송 권한이
   구글의 제한 스코프라 보안 심사를 받아야 하고, 심사 전에는 로그인이 7일마다
   풀린다. 메일함이 하나뿐이니 앱 비밀번호가 훨씬 간단하고 안전하다.

   비밀번호는 저장소에 두지 않는다. Vercel 환경변수로만 넣는다.

     GMAIL_USER        보내는 Gmail 주소 (로그인 계정)
     GMAIL_APP_PASSWORD 앱 비밀번호 16자리 (공백 있어도 됨)
     GMAIL_FROM        받는 사람에게 보일 주소. 비우면 GMAIL_USER.
                       Gmail에 '다른 주소로 보내기'로 인증해 둔 주소여야 한다 —
                       기업에 나가는 메일이 @gmail.com이면 곤란하다.
     GMAIL_FROM_NAME   보낼 때 표시할 이름 (예: 스튜디오 블룸)

   보낸 메일은 exhibitor_logs에 남긴다. 여기가 빠지면 "누구에게 몇 번 독촉했나"를
   다시 알 수 없게 된다 — 이걸 남기려고 붙이는 기능이다.
══════════════════════════════════════════════════════════════ */
const express = require('express');
const pool = require('../db/pool');
const { suggestOwners } = require('./mail-suggest');
const { isOurs, domainOf: domOf, domainList, parseForward, forwardOf, forwardCandidates, fmtAddr } = require('./mail-forward');

const router = express.Router();
/* 시험 계정은 메일 원문·주인 없는 메일·첨부·계정 목록을 읽지 못한다 — /api/data만 가리고 이 길은 열려 있었다 */
router.use((req, res, next) => {
  if (req.user && req.user.isTest && req.method === 'GET' && /^\/(original|unassigned|files|accounts)\b/.test(req.path)) {
    return res.status(403).json({ ok: false, error: '시험 계정은 메일 내용을 볼 수 없어요' });
  }
  next();
});

/* «첨부파일·행사 공용 메일 계정·푸터·IMAP»은 ../lib/mail/box.js로 떼어 냈다 */
const { LOCAL_MAX, TOTAL_MAX, FILE_MAX, ensureFiles, b64size, cfg, transport, kstDate, kstStamp, PROVIDERS, prov, ensureBox, markSynced, secretKey, seal, BOX_SELECT, boxOf, boxTransport, boxPublic, FOOTER_IMG_MAX, withFooter, imapClient, SENT_NAMES, saveToSent, partDone, senderFor } = require('../lib/mail/box');

router.get('/accounts', async (req, res) => {
  try {
    await ensureBox();
    const r = await pool.query(`${BOX_SELECT} ORDER BY m.event_id`);
    res.json({ ok: true, keyReady: !!secretKey(), accounts: r.rows.map((x) => boxPublic(x.b)) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* 저장 — 비밀번호 칸을 비워 두면 예전 비밀번호를 그대로 쓴다
   (화면은 비밀번호를 모르므로 다른 칸만 고칠 때 매번 다시 치게 할 수 없다) */
router.put('/accounts/:eventId', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 고칠 수 없어요' });
  const eventId = String(req.params.eventId);
  const { username, password, from_addr, from_name, host, port } = req.body || {};
  const provider = PROVIDERS[req.body && req.body.provider] ? req.body.provider : 'mailplug';
  const P = PROVIDERS[provider];
  // 다른 서비스의 기본 서버가 남아 있으면 고른 서비스 것으로 바꾼다(서비스를 바꿀 때)
  const otherHosts = Object.values(PROVIDERS).map((x) => x.host);
  const smtpHost = (!String(host || '').trim() || (otherHosts.includes(String(host).trim()) && String(host).trim() !== P.host))
    ? P.host : String(host).trim();
  const user = String(username || '').trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(user)) return res.status(400).json({ ok: false, error: '로그인 메일 주소를 확인해주세요' });
  try {
    const prev = await boxOf(eventId);
    let passEnc = prev ? prev.pass_enc : null;
    /* 서버 주소·포트·로그인 주소가 바뀌면 예전 비밀번호를 이어 쓰지 않는다 — 주소만 남의 서버로
       바꾸고 «연결 시험»을 누르면 저장된 공용 메일 비밀번호가 그 서버로 넘어갔다 */
    if (prev && !String(password || '').trim()
      && (prev.host !== smtpHost || Number(prev.port) !== (Number(port) || P.port) || prev.username !== user)) {
      return res.status(400).json({ ok: false, error: '서버 주소나 로그인 주소를 바꿀 때는 비밀번호를 다시 넣어주세요' });
    }
    if (String(password || '').trim()) passEnc = seal(String(password).trim());
    if (!passEnc) return res.status(400).json({ ok: false, error: '비밀번호가 필요해요' });
    const row = [eventId, provider, smtpHost, Number(port) || P.port,
      user, passEnc, String(from_addr || '').trim() || user, String(from_name || '').trim(),
      new Date().toISOString(), req.user?.email || ''];
    if (req.body && req.body.host_domains !== undefined) {
      await ensureExtra();
      await pool.query('UPDATE event_mailboxes SET host_domains = $1 WHERE event_id = $2', [domainList(req.body.host_domains).join(','), eventId]);
    }
    await pool.query(`
      INSERT INTO event_mailboxes (event_id, provider, host, port, username, pass_enc, from_addr, from_name, updated_at, author_email)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (event_id) DO UPDATE SET provider=$2, host=$3, port=$4, username=$5, pass_enc=$6,
        from_addr=$7, from_name=$8, updated_at=$9, author_email=$10`, row);
    // 처음 만드는 계정이면 위 UPDATE가 아무 줄도 못 바꿨다 — 한 번 더
    if (req.body && req.body.host_domains !== undefined) {
      await pool.query('UPDATE event_mailboxes SET host_domains = $1 WHERE event_id = $2', [domainList(req.body.host_domains).join(','), eventId]);
    }
    res.json({ ok: true, account: boxPublic(await boxOf(eventId)) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* 푸터만 저장 — 비밀번호 칸과 따로 둔다(푸터만 고칠 때 비밀번호를 다시 묻지 않게).
   body: { footer_text, footer_img?: base64 | null(빼기), footer_img_type? } — footer_img를 안 보내면 그대로 */
router.put('/accounts/:eventId/footer', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 고칠 수 없어요' });
  const eventId = String(req.params.eventId);
  const b = req.body || {};
  try {
    const prev = await boxOf(eventId);
    if (!prev) return res.status(400).json({ ok: false, error: '행사 공용 메일을 먼저 저장해주세요' });
    const sets = ['footer_text = $2'], vals = [eventId, String(b.footer_text || '').trim().slice(0, 4000)];
    if (b.footer_img === null) sets.push('footer_img = NULL', 'footer_img_type = NULL');
    else if (b.footer_img) {
      const data = String(b.footer_img).replace(/^data:[^,]*,/, '');
      if (Buffer.byteLength(data, 'base64') > FOOTER_IMG_MAX) return res.status(413).json({ ok: false, error: '푸터 이미지는 1MB 이하로 넣어주세요' });
      const type = /^image\/(png|jpeg|gif)$/.test(b.footer_img_type || '') ? b.footer_img_type : 'image/jpeg';
      vals.push(data, type);
      sets.push(`footer_img = $${vals.length - 1}`, `footer_img_type = $${vals.length}`);
    }
    await pool.query(`UPDATE event_mailboxes SET ${sets.join(', ')} WHERE event_id = $1`, vals);
    res.json({ ok: true, account: boxPublic(await boxOf(eventId)) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
/* 푸터 미리보기 — 화면이 글·이미지를 그려 본다(목록에는 이미지를 안 실어 가볍게) */
router.get('/accounts/:eventId/footer', async (req, res) => {
  try {
    const b = await boxOf(String(req.params.eventId), { img: true });
    res.json({ ok: true, footer_text: (b && b.footer_text) || '',
      footer_img: b && b.footer_img ? `data:${b.footer_img_type || 'image/jpeg'};base64,${b.footer_img}` : '' });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete('/accounts/:eventId', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 지울 수 없어요' });
  try {
    await ensureBox();
    await pool.query('DELETE FROM event_mailboxes WHERE event_id = $1', [String(req.params.eventId)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* 로그인만 해 본다 — 메일은 보내지 않는다 */
router.post('/accounts/:eventId/test', async (req, res) => {
  let b = null;
  try {
    b = await boxOf(req.params.eventId);
    if (!b) return res.status(404).json({ ok: false, error: '이 행사에 메일 계정이 없어요' });
    await boxTransport(b).verify();
    res.json({ ok: true, 연결: '로그인 성공 — 보낼 수 있어요' });
  } catch (e) {
    res.json({ ok: false, error: `로그인 실패: ${e.message}`,
      도움말: b && b.provider === 'gmail'
        ? 'Gmail 2단계 인증을 켜고 앱 비밀번호를 넣었는지, Gmail 설정에서 IMAP이 켜져 있는지 확인해주세요.'
        : b && b.provider === 'naverworks'
        ? '네이버 웍스 관리자 › 보안 › 서비스 권한 › 메일에서 IMAP/SMTP가 «사용»인지(이 계정이 속한 권한 기준), 비밀번호를 정확히 넣고 저장했는지 확인해주세요.'
        : '메일플러그 관리자 화면에서 이 계정의 IMAP/SMTP 사용이 켜져 있는지, 메일 비밀번호가 아니라 앱 비밀번호를 넣었는지 확인해주세요.' });
  }
});

/* 설정이 됐는지 · 로그인이 되는지 — 메일을 보내지 않고 확인만 한다.
   비밀번호는 어떤 형태로도 돌려주지 않는다. */
router.get('/status', async (req, res) => {
  const c = cfg();
  const out = {
    ok: true,
    설정: {
      계정: c.user ? c.user.replace(/^(.{2}).*(@.*)$/, '$1***$2') : '(없음)',
      앱비밀번호: c.pass ? `${c.pass.length}자리 설정됨` : '(없음)',
      보내는주소: c.from || '(없음)',
      표시이름: c.fromName || '(없음)',
    },
  };
  const t = transport();
  if (!t) { out.연결 = '환경변수가 아직 안 채워졌어요'; return res.json(out); }
  try {
    await t.verify();
    out.연결 = '로그인 성공 — 보낼 수 있어요';
  } catch (e) {
    out.연결 = `로그인 실패: ${e.message}`;
    out.도움말 = '2단계 인증을 켜고 앱 비밀번호를 새로 발급했는지 확인해주세요.';
  }
  res.json(out);
});

/* 실행·스크립트·웹 파일은 첨부로 받지도 보내지도 않는다 — 행사 공용 메일로 나가면 받는 쪽 메일 서버가
   막거나, 우리 주소가 악성 메일 발신지로 찍힌다 */
const BLOCKED_EXT = /\.(exe|bat|cmd|com|scr|pif|msi|msp|js|jse|vbs|vbe|wsf|wsh|ps1|psm1|hta|jar|lnk|reg|cpl|html?|svg|xhtml)$/i;

/* 단계별 기본 첨부 — 목록은 내용 없이 이름·크기만 */
router.get('/files', async (req, res) => {
  try {
    await ensureFiles();
    const r = await pool.query(
      `SELECT id, event_id, step, filename, content_type, size, created_at, author_email
         FROM mail_files WHERE ($1 = '' OR event_id = $1) ORDER BY created_at`, [String(req.query.event_id || '')]);
    res.json({ ok: true, files: r.rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/files', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 올릴 수 없어요' });
  const { event_id, step, filename, content_type, data } = req.body || {};
  if (!event_id || !step || !filename || !data) return res.status(400).json({ ok: false, error: '행사·단계·파일이 필요해요' });
  if (BLOCKED_EXT.test(String(filename).trim())) return res.status(400).json({ ok: false, error: '실행·스크립트·웹 파일은 첨부할 수 없어요' });
  const size = b64size(data);
  if (size > FILE_MAX) return res.status(413).json({ ok: false, error: `파일이 너무 커요 (${(size / 1048576).toFixed(1)}MB, 최대 3MB)` });
  try {
    await ensureFiles();
    const id = `MF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const created_at = new Date().toISOString();
    await pool.query(
      `INSERT INTO mail_files (id, event_id, step, filename, content_type, size, data, created_at, author_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, event_id, step, String(filename).slice(0, 200), content_type || 'application/octet-stream', size, data,
        created_at, req.user?.email || '']);
    res.json({ ok: true, file: { id, event_id, step, filename, content_type, size, created_at } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.delete('/files/:id', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 지울 수 없어요' });
  try {
    await ensureFiles();
    await pool.query('DELETE FROM mail_files WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* 메일 보내기
   body: { to, subject, text, html?, cc?, exhibitor_id?, speaker_id?, category?, kind? }

   연사에게 보낼 때는 실무진이 수신, 연사가 참조인 경우가 흔하다. 누구를
   수신으로 두는지는 화면에서 정하고, 여기서는 to·cc를 그대로 받아 보낸다.
   기록은 상대에 따라 다른 표로 간다 — 전시는 exhibitor_logs, 연사는
   speaker_logs. 한쪽에 몰아 두면 «이 연사에게 몇 번 독촉했나»를 다시 셀 수
   없다. */
router.post('/send', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 메일을 보낼 수 없어요' });
  const { to, subject, text, html, cc, exhibitor_id, speaker_id, category, kind,
    attachments: localFiles, file_ids,
    // 컨택 DM — 차수 명단 한 줄(round_members)과 받는 사람
    round_member_id, contact_id, contact_name,
    // CRM 협의 — crm_targets 한 줄. 기록은 그 줄의 log(JSON)에 붙는다
    crm_target_id, memo, no_footer } = req.body || {};

  /* 어느 행사 사람인지는 서버가 상대 기록에서 찾는다 — 화면이 보낸 event_id만
     믿으면 다른 행사 주소로 나가는 실수를 막을 수 없다 */
  let eventId = (req.body && req.body.event_id) || '';
  try {
    if (exhibitor_id) eventId = (await pool.query('SELECT event_id FROM exhibitors WHERE id = $1', [exhibitor_id])).rows[0]?.event_id || eventId;
    else if (speaker_id) eventId = (await pool.query('SELECT event_id FROM speakers WHERE id = $1', [speaker_id])).rows[0]?.event_id || eventId;
    else if (round_member_id) eventId = (await pool.query(
      `SELECT r.event_id FROM round_members m JOIN contact_rounds r ON r.id = m.round_id WHERE m.id = $1`, [round_member_id])).rows[0]?.event_id || eventId;
    else if (crm_target_id) eventId = (await pool.query('SELECT event FROM crm_targets WHERE id = $1', [String(crm_target_id)])).rows[0]?.event || eventId;
  } catch (e) { /* 행사를 못 찾으면 아래에서 막힌다 */ }
  /* 진행 완료된 행사(그 파트)는 열람만 — 화면 잠금을 피해 들어와도 여기서 막는다.
     컨택 DM은 전시·컨퍼런스 어느 파트도 아니라 묻지 않는다(행사 전 모객이다) */
  const part = exhibitor_id ? 'exh' : speaker_id ? 'conf' : null;
  if (eventId && part && await partDone(eventId, part)) {
    return res.status(423).json({ ok: false, error: '진행 완료된 행사라 메일을 보낼 수 없어요' });
  }
  let sender;
  try { sender = await senderFor(eventId); }
  catch (e) { return res.status(500).json({ ok: false, error: `메일 계정을 읽지 못했어요 — 설정 › 행사 › 메일에서 앱 비밀번호를 다시 넣어주세요 (${e.message})` }); }
  if (!sender) return res.status(400).json({ ok: false, error: '이 행사에 공용 메일이 없어요 — 설정 › 행사 관리 › 메일에서 넣어주세요' });
  const t = sender.t;
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;]/))
    .map((s) => String(s).trim()).filter(Boolean);

  const toList = list(to);
  if (!toList.length) return res.status(400).json({ ok: false, error: '받는 사람이 없어요' });
  if (!String(subject || '').trim() && !String(text || '').trim()) {
    return res.status(400).json({ ok: false, error: '제목이나 내용 중 하나는 있어야 해요' });
  }

  /* 첨부 — PC에서 고른 것(base64)과 미리 올려 둔 기본 첨부(id) */
  const attachments = [];
  let localTotal = 0;
  for (const f of (Array.isArray(localFiles) ? localFiles : [])) {
    if (!f || !f.data || !f.filename) continue;
    if (BLOCKED_EXT.test(String(f.filename).trim())) return res.status(400).json({ ok: false, error: `«${String(f.filename).slice(0, 60)}»은 보낼 수 없는 형식이에요 (실행·스크립트·웹 파일)` });
    localTotal += b64size(f.data);
    // cid가 있으면 본문(html)의 <img src="cid:…">로 들어가는 사진이다 — 첨부 목록에 따로 안 뜬다
    const cid = /^[\w.@-]{1,100}$/.test(String(f.cid || '')) ? String(f.cid) : undefined;
    attachments.push({ filename: String(f.filename), content: f.data, encoding: 'base64', contentType: f.content_type || undefined,
      ...(cid ? { cid, contentDisposition: 'inline' } : {}) });
  }
  if (localTotal > LOCAL_MAX) return res.status(413).json({ ok: false, error: 'PC에서 고른 첨부가 합쳐서 3MB를 넘어요' });
  const ids = (Array.isArray(file_ids) ? file_ids : []).filter(Boolean);
  if (ids.length) {
    try {
      await ensureFiles();
      const r = await pool.query('SELECT filename, content_type, data, size FROM mail_files WHERE id = ANY($1)', [ids]);
      r.rows.forEach((f) => attachments.push({ filename: f.filename, content: f.data, encoding: 'base64', contentType: f.content_type || undefined }));
      const total = localTotal + r.rows.reduce((n, f) => n + (Number(f.size) || 0), 0);
      if (total > TOTAL_MAX) return res.status(413).json({ ok: false, error: '첨부가 합쳐서 20MB를 넘어요' });
    } catch (e) { return res.status(500).json({ ok: false, error: `기본 첨부를 읽지 못했어요: ${e.message}` }); }
  }

  try {
    /* 한 번 만든 메일을 보내고 그대로 보낸메일함에도 넣는다 — 따로 만들면
       보낸 것과 남은 것이 달라질 수 있다 */
    const mail = withFooter(no_footer ? null : sender.box, {
      from: sender.fromName ? `"${sender.fromName}" <${sender.from}>` : sender.from,
      to: toList.join(', '),
      cc: list(cc).join(', ') || undefined,
      // 답장은 로그인 계정이 아니라 보이는 주소(행사 메일함)로 오게 한다
      replyTo: sender.from,
      subject: String(subject || '').trim(),
      text: String(text || ''),
      html: html || undefined,
      attachments: attachments.length ? attachments : undefined,
    });
    const raw = await new MailComposer(mail).compile().build();
    const info = await t.sendMail({
      envelope: { from: sender.from, to: [...toList, ...list(cc)] },
      raw,
    });

    /* 보낸 사실을 기록에 남긴다. 이게 실패해도 메일은 이미 나갔으므로 성공으로
       돌려주되, 기록이 빠졌다는 걸 알려준다 — 조용히 넘어가면 독촉 이력이
       비어 있는 이유를 알 수 없다. */
    let logged = false, logError = null, logId = null;
    /* 참조까지 상대로 남긴다 — 연사 메일은 실무진이 수신, 연사가 참조인 경우가
       많아 수신만 적으면 정작 연사에게 보낸 기록이 비어 보인다. */
    const counterpart = [toList.join(', '), list(cc).length ? `(cc) ${list(cc).join(', ')}` : '']
      .filter(Boolean).join(' ');
    const target = exhibitor_id
      ? { table: 'exhibitor_logs', col: 'exhibitor_id', id: exhibitor_id, prefix: 'XL' }
      : speaker_id
        ? { table: 'speaker_logs', col: 'speaker_id', id: speaker_id, prefix: 'SL' }
        : null;
    /* 컨택 DM — 차수 기록(contact_attempts)에 «DM 보냄» 한 줄. 본문은 남기지 않는다
       (제목과 첨부 이름만) — 기록은 «언제 누구에게 무엇을»이면 충분하다 */
    if (!target && round_member_id) {
      try {
        const m = (await pool.query('SELECT round_id, org_id FROM round_members WHERE id = $1', [round_member_id])).rows[0];
        if (m) {
          logId = `CA-${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          await pool.query(
            `INSERT INTO contact_attempts (id, round_id, member_id, org_id, contact_id, contact_name, phone,
               channel, at, by_email, by_name, reaction, note)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'DM',$8,$9,$10,'sent',$11)`,
            [logId, m.round_id, round_member_id, m.org_id, contact_id ? String(contact_id) : '', contact_name || '',
              toList.join(', '), kstStamp(Date.now()), req.user?.email || '', req.user?.name || '',
              String(subject || '').trim() + (attachments.length ? ` [첨부] ${attachments.map((a) => a.filename).join(', ')}` : '')]);
          logged = true;
        }
      } catch (e) { logError = e.message; logId = null; }
    }
    /* CRM 협의 — 타겟의 컨택 이력(log JSON) 맨 앞에 «메일 보냄» 한 줄. 제목·받는 사람·첨부 이름·
       본문(«무슨 메일을 보냈나»를 다시 보려고, 길면 앞부분만)과 사람이 적은 짧은 메모를 둔다.
       한 문장으로 붙여서 같은 때 화면이 저장한 기록을 덮지 않는다 */
    let crmEntry = null;
    if (!target && !round_member_id && crm_target_id) {
      const at = kstStamp(Date.now());
      crmEntry = { type: '메일 보냄', text: String(subject || '').trim() || '(제목 없음)', to: toList.join(', '),
        attach: attachments.map((a) => a.filename).join(', '), memo: String(memo || '').trim(),
        body: String(text || '').slice(0, 6000), cc: list(cc).join(', '),
        date: at.slice(0, 10), at, by: req.user?.name || req.user?.email || '', color: '#6D28D9' };
      try {
        const u = await pool.query(
          `UPDATE crm_targets SET "lastActivity" = $3,
             log = (jsonb_build_array($2::jsonb) || CASE WHEN left(btrim(COALESCE(log, '')), 1) = '[' THEN log::jsonb ELSE '[]'::jsonb END)::text
           WHERE id = $1`, [String(crm_target_id), JSON.stringify(crmEntry), crmEntry.date]);
        logged = u.rowCount > 0;
        if (!logged) { logError = 'CRM 타겟을 찾지 못했어요'; crmEntry = null; }
      } catch (e) { logError = e.message; crmEntry = null; }
    }
    if (target) {
      try {
        await pool.query(
          `INSERT INTO ${target.table}
             (id, ${target.col}, kind, ts, direction, channel, counterpart, category,
              subject, body, answered_at, answer, status, author_email, author_name)
           VALUES ($1,$2,$3,$4,'out','이메일',$5,$6,$7,$8,'','','done',$9,$10)`,
          [(logId = `${target.prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`), target.id,
            kind || 'note', kstStamp(Date.now()),
            counterpart, category || '기타',
            String(subject || '').trim(),
            // 무엇을 붙여 보냈는지도 기록에 남긴다 — «양식 보냈나»를 나중에 다시 묻게 된다
            String(text || '') + (attachments.length ? `

[첨부] ${attachments.map((a) => a.filename).join(', ')}` : ''),
            req.user?.email || '', req.user?.name || '']);
        logged = true;
      } catch (e) { logError = e.message; logId = null; }
    }

    /* 보낸메일함 사본은 기록을 남긴 «뒤»에 넣는다. 전에는 앞이라 IMAP이 늦어 함수가 시간 초과로
       끊기면, 메일은 나갔는데 기록이 없고 화면은 «실패»라 다시 보내 같은 메일이 두 번 갔다 */
    let sentSaved = null, sentError = null;
    if (sender.box && prov(sender.box).saveSent) {
      try {
        sentSaved = await Promise.race([saveToSent(sender.box, raw),
          new Promise((_, rej) => setTimeout(() => rej(new Error('보낸메일함 응답이 늦어 건너뛰었어요')), 20000))]);
      } catch (e) { sentError = e.message; console.error('[mail] 보낸메일함 저장 실패:', e.message); }
    }

    // logId를 돌려준다 — 화면이 임시 id로 들고 있으면 나중에 그 기록을 지울 수 없다
    res.json({ ok: true, messageId: info.messageId, accepted: info.accepted, via: sender.via, logged, logError, logId, crmEntry, sentSaved, sentError });
  } catch (e) {
    console.error('[mail] 발송 실패:', e.message);
    res.status(502).json({ ok: false, error: `발송 실패: ${e.message}` });
  }
});

/* «보낸메일함 → 연사·참가사 발송 기록»은 ../lib/mail/sync-sent.js로 떼어 냈다 */
const { bodyParts, mailText, norm, AUTO_SUBJ, isAutoReply, prevDay, syncSentHandler } = require('../lib/mail/sync-sent');

/* «받은메일함 → 연사·참가사 기록, 주인 없는 메일»은 ../lib/mail/sync-inbox.js로 떼어 냈다 */
const { syncInboxHandler } = require('../lib/mail/sync-inbox');

/* ══════════════════════════════════════════════════════════════
   원문 보기 · 주인 없는 메일
══════════════════════════════════════════════════════════════ */

/* «받은 메일 거르기 — 기록 칸·주인 없는 메일 표, 스팸·대량 메일·경고»은 ../lib/mail/screen.js로 떼어 냈다 */
const { ensureExtra, isSpam, isBulk, domainOf, FREE_MAIL, mailWarnings } = require('../lib/mail/screen');


/* «메일 원문을 안전한 HTML로»은 ../lib/mail/original-html.js로 떼어 냈다 */
const { safeOriginalHtml } = require('../lib/mail/original-html');

/* 원문 보기 — 기록에 남긴 메일함·번호로 그때 가져온다(저장하지 않는다) */
router.get('/original/:t/:id', async (req, res) => {
  const t = req.params.t === 'ex' ? 'ex' : req.params.t === 'un' ? 'un' : 'sp';
  try {
    await ensureExtra();
    let row;
    if (t === 'un') {
      // 주인 없는 메일 — 연결하기 전에 원문을 보고 판단한다
      row = (await pool.query(`SELECT mail_box, mail_uid, '' category, event_id FROM mail_unassigned WHERE id = $1`, [req.params.id])).rows[0];
    } else {
      const tbl = t === 'sp' ? 'speaker_logs' : 'exhibitor_logs';
      const own = t === 'sp' ? 'speakers' : 'exhibitors';
      const col = t === 'sp' ? 'speaker_id' : 'exhibitor_id';
      const r = await pool.query(`SELECT l.mail_box, l.mail_uid, l.category, o.event_id FROM ${tbl} l
        JOIN ${own} o ON o.id = l.${col} WHERE l.id = $1`, [req.params.id]);
      row = r.rows[0];
    }
    if (!row || !row.mail_uid) return res.status(404).json({ ok: false, error: '원문 위치가 없어요 — «지금 가져오기»를 한 번 누르면 채워져요' });
    const b = await boxOf(row.event_id);
    if (!b) return res.status(404).json({ ok: false, error: '이 행사에 공용 메일이 없어요' });
    const client = imapClient(b);
    await client.connect();
    let mail;
    try {
      const lock = await client.getMailboxLock(row.mail_box || 'INBOX');
      try {
        const m = await client.fetchOne(String(row.mail_uid), { source: true }, { uid: true });
        if (!m || !m.source) return res.status(404).json({ ok: false, error: '메일함에서 이 메일을 찾지 못했어요(지워졌을 수 있어요)' });
        mail = await simpleParser(m.source);
      } finally { lock.release(); }
    } finally { await client.logout().catch(() => {}); }
    const spam = isSpam(mail) || /스팸/.test(row.category || '');
    res.json({
      ok: true, subject: mail.subject || '', date: mail.date ? kstStamp(mail.date) : '',
      from: mail.from ? mail.from.text : '', to: mail.to ? [].concat(mail.to).map((x) => x.text).join(', ') : '',
      html: safeOriginalHtml(mail, { remote: req.query.remote === '1', noLinks: spam }),
      blocked: /data-blocked="1"/.test(safeOriginalHtml(mail, { remote: false })) && req.query.remote !== '1',
      spam, warnings: mailWarnings(mail),
      attachments: (mail.attachments || []).filter((a) => !a.cid || !/^image\//i.test(a.contentType || ''))
        .map((a) => ({ filename: a.filename || '(이름 없음)', size: a.size || 0 })),
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* ── 주인 없는 메일 ── */
/* 직원이 개인 메일(cdakyo@gmail.com)로 연사에게 보내고 행사 메일함을 참조로 넣으면
   보낸 사람이 직원 자신이다. 그 주소를 연락처로 넣으면 그 뒤 그 직원이 보낸 메일이
   모두 그 연사에게 붙는다(2026-10-22 AIA — 조정구 대표님께 보낸 메일이 Ronghao Chang에게 붙음).
   연결하는 사람의 회사 주소와 아이디(@ 앞)가 같으면 본인 개인 주소로 보고 넣지 않는다. */
const isSelfAlias = (addr, user) => {
  const a = String(addr || '').toLowerCase().split('@')[0], me = String(user?.email || '').toLowerCase().split('@')[0];
  return !!a && a === me;
};
router.get('/unassigned/:eventId', async (req, res) => {
  const eventId = String(req.params.eventId);
  try {
    await ensureExtra();
    const rows = (await pool.query(`SELECT * FROM mail_unassigned WHERE event_id = $1 AND status = 'new' ORDER BY ts DESC`, [eventId])).rows;
    /* 추천 — 이름·주소·도메인·답장 제목·본문의 소속을 견줘 점수를 매긴다(mail-suggest.js). 바깥으로는 보내지 않는다 */
    const owners = new Map();
    const own = (t, id, label) => {
      const k = `${t}:${id}`;
      if (!owners.has(k)) owners.set(k, { t, id, label, names: [], orgs: [], emails: [], sentSubjects: [] });
      return owners.get(k);
    };
    const push = (arr, ...v) => v.forEach((x) => { x = String(x || '').trim(); if (x && !arr.includes(x)) arr.push(x); });
    (await pool.query(`SELECT s.id, COALESCE(NULLIF(s.name_snapshot,''), s.name_en) nm, s.name_snapshot, s.name_en, s.org_ko, s.org_en,
        c.email1, c.email2 FROM speakers s LEFT JOIN contacts c ON c.id = s.contact_id WHERE s.event_id = $1`, [eventId])).rows
      .forEach((r) => { const o = own('sp', r.id, r.nm); push(o.names, r.name_snapshot, r.name_en); push(o.orgs, r.org_ko, r.org_en); push(o.emails, r.email1, r.email2); });
    (await pool.query(`SELECT sc.speaker_id, sc.name, sc.email FROM speaker_contacts sc JOIN speakers s ON s.id = sc.speaker_id
       WHERE s.event_id = $1`, [eventId])).rows
      .forEach((r) => { const o = owners.get(`sp:${r.speaker_id}`); if (o) { push(o.names, r.name); push(o.emails, r.email); } });
    (await pool.query(`SELECT x.id, x.company_name, xc.name, xc.email, c.email1, c.email2 FROM exhibitors x
       LEFT JOIN exhibitor_contacts xc ON xc.exhibitor_id = x.id LEFT JOIN contacts c ON c.id = xc.contact_id
      WHERE x.event_id = $1`, [eventId])).rows
      .forEach((r) => { const o = own('ex', r.id, r.company_name); push(o.names, r.name); push(o.orgs, r.company_name); push(o.emails, r.email, r.email1, r.email2); });
    (await pool.query(`SELECT l.speaker_id oid, l.subject FROM speaker_logs l JOIN speakers s ON s.id = l.speaker_id
       WHERE s.event_id = $1 AND l.direction = 'out' AND l.subject <> ''`, [eventId])).rows
      .forEach((r) => { const o = owners.get(`sp:${r.oid}`); if (o) push(o.sentSubjects, r.subject); });
    (await pool.query(`SELECT l.exhibitor_id oid, l.subject FROM exhibitor_logs l JOIN exhibitors x ON x.id = l.exhibitor_id
       WHERE x.event_id = $1 AND l.direction = 'out' AND l.subject <> ''`, [eventId])).rows
      .forEach((r) => { const o = owners.get(`ex:${r.oid}`); if (o) push(o.sentSubjects, r.subject); });
    const linkedBefore = new Map();
    (await pool.query(`SELECT lower(from_addr) a, linked_t, linked_id FROM mail_unassigned
       WHERE event_id = $1 AND status = 'linked' ORDER BY ts`, [eventId])).rows
      .forEach((r) => linkedBefore.set(r.a, { t: r.linked_t, id: r.linked_id }));
    const list = [...owners.values()];
    const hostDomains = domainList((await boxOf(eventId).catch(() => null))?.host_domains);
    const out = rows.map((r) => {
      const f = forwardOf(r);
      const fw = f && f.fw;
      /* 전달 메일이면 원래 보낸 사람으로 추천을 견주고, 원래 받는 사람·참조에 아는 주소가 있으면 그 사람을 맨 앞에 */
      let sug = suggestOwners(fw ? { ...r, from_addr: fw.from.addr, from_name: fw.from.name, subject: fw.subject || r.subject } : r, list, linkedBefore);
      if (fw) {
        const exact = forwardCandidates(fw, hostDomains).map((a) => list.find((o) => o.emails.some((e) => norm(e) === a.addr)))
          .filter(Boolean).filter((o, i, arr) => arr.indexOf(o) === i);
        sug = [...exact.map((o) => ({ t: o.t, id: o.id, name: o.label, score: 99, why: '원래 메일의 주소' })),
          ...sug.filter((s) => !exact.some((o) => o.t === s.t && o.id === s.id))].slice(0, 3);
      }
      const addr = fw ? fw.from.addr : r.from_addr;
      return { ...r, warnings: r.warnings ? JSON.parse(r.warnings) : [], suggestions: sug,
        fwd: f ? { by: f.by, from: fw ? fmtAddr(fw.from) : '', to: fw ? [...fw.to, ...fw.cc].map((x) => x.addr).join(', ') : '', sent: fw ? fw.sent : '',
          addrs: fw ? [fw.from, ...fw.to, ...fw.cc].map((x) => x.addr) : [] } : null,
        // 연락처로 넣을 주소 — 우리 직원·주최사 주소면 넣지 않는다
        contact_addr: !addr || isOurs(addr) || isSelfAlias(addr, req.user) || hostDomains.includes(domOf(addr)) ? '' : addr };
    });
    res.json({ ok: true, items: out });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/unassigned/:id/link', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 바꿀 수 없어요' });
  const { t, ownerId, addContact } = req.body || {};
  const sp = t === 'sp';
  try {
    await ensureExtra();
    const u = (await pool.query(`SELECT * FROM mail_unassigned WHERE id = $1`, [req.params.id])).rows[0];
    if (!u || u.status !== 'new') return res.status(404).json({ ok: false, error: '이미 처리한 메일이에요' });
    const own = (await pool.query(`SELECT id, event_id FROM ${sp ? 'speakers' : 'exhibitors'} WHERE id = $1`, [ownerId])).rows[0];
    if (!own || own.event_id !== u.event_id) return res.status(400).json({ ok: false, error: '이 행사의 연사·참가사를 골라주세요' });
    if (await partDone(u.event_id, sp ? 'conf' : 'exh')) return res.status(423).json({ ok: false, error: '진행 완료된 행사예요' });
    const logId = `${sp ? 'SL' : 'XL'}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const warn = u.warnings ? JSON.parse(u.warnings) : [];
    const hostDomains = domainList((await boxOf(u.event_id).catch(() => null))?.host_domains);
    const f = forwardOf(u), fw = f && f.fw;
    const counterpart = fw ? [fmtAddr(fw.from), [...fw.to, ...fw.cc].length ? `→ ${[...fw.to, ...fw.cc].map((x) => x.addr).join(', ')}` : ''].filter(Boolean).join(' ')
      : (u.from_name ? `${u.from_name} <${u.from_addr}>` : u.from_addr);
    const contactAddr = fw ? fw.from.addr : u.from_addr;
    const contactName = fw ? fw.from.name : u.from_name;
    const canAdd = contactAddr && !isOurs(contactAddr) && !isSelfAlias(contactAddr, req.user) && !hostDomains.includes(domOf(contactAddr));
    await pool.query(`
      INSERT INTO ${sp ? 'speaker_logs' : 'exhibitor_logs'} (id, ${sp ? 'speaker_id' : 'exhibitor_id'}, kind, ts, direction,
        channel, counterpart, category, subject, body, answered_at, answer, status, author_email, author_name, mail_box, mail_uid)
      VALUES ($1,$2,'note',$3,'in','이메일',$4,$5,$6,$7,'','','open',$8,$9,$10,$11)`,
    [logId, ownerId, (fw && fw.sent) || u.ts, counterpart,
      warn.length ? '받은 메일 · ⚠ 확인' : '받은 메일', (fw && fw.subject) || u.subject, u.body, req.user?.email || '',
      `${f ? `${f.by} 전달 · ` : ''}${req.user?.name || req.user?.email || ''} (주인 없는 메일에서 연결)`, u.mail_box, u.mail_uid]);
    let contactAdded = false;
    if (addContact && canAdd) {
      const em = String(contactAddr || '').trim();
      if (sp) {
        const has = (await pool.query(`SELECT 1 FROM speaker_contacts WHERE speaker_id = $1 AND lower(email) = lower($2)`, [ownerId, em])).rowCount;
        if (!has) {
          // 받는 사람이 갑자기 늘지 않게 «안 보냄»으로 넣는다 — 연락 상대 탭에서 수신·참조로 바꾼다
          await pool.query(`INSERT INTO speaker_contacts (id, speaker_id, contact_id, name, email, phone, kind, send, note)
            VALUES ($1,$2,'',$3,$4,'','실무진','','메일에서 연결')`, [`SC-${Date.now()}-${Math.floor(Math.random() * 1000)}`, ownerId, contactName || '', em]);
          contactAdded = true;
        }
      } else {
        const has = (await pool.query(`SELECT 1 FROM exhibitor_contacts WHERE exhibitor_id = $1 AND lower(email) = lower($2)`, [ownerId, em])).rowCount;
        if (!has) {
          await pool.query(`INSERT INTO exhibitor_contacts (id, exhibitor_id, contact_id, name, email, phone, role, is_primary, note)
            VALUES ($1,$2,'',$3,$4,'','기타','','메일에서 연결')`, [`XC-${Date.now()}-${Math.floor(Math.random() * 1000)}`, ownerId, contactName || '', em]);
          contactAdded = true;
        }
      }
    }
    await pool.query(`UPDATE mail_unassigned SET status = 'linked', linked_t = $1, linked_id = $2, handled_by = $3 WHERE id = $4`,
      [sp ? 'sp' : 'ex', ownerId, req.user?.email || '', u.id]);
    res.json({ ok: true, logId, contactAdded });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* CRM 협의에 붙이기 — 받은 메일을 타겟 컨택 이력(log JSON)에 «메일 받음»으로 남긴다.
   본문은 옮기지 않는다(원문은 «원문 보기»로 메일함에서 그때 가져온다). 사람이 적은 메모만 둔다 */
router.post('/unassigned/:id/link-crm', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 바꿀 수 없어요' });
  const { targetId, memo } = req.body || {};
  try {
    await ensureExtra();
    const u = (await pool.query(`SELECT * FROM mail_unassigned WHERE id = $1`, [req.params.id])).rows[0];
    if (!u || u.status !== 'new') return res.status(404).json({ ok: false, error: '이미 처리한 메일이에요' });
    const t = (await pool.query(`SELECT id, event FROM crm_targets WHERE id = $1`, [String(targetId || '')])).rows[0];
    if (!t) return res.status(404).json({ ok: false, error: 'CRM 타겟을 찾지 못했어요' });
    if (t.event !== u.event_id) return res.status(400).json({ ok: false, error: '다른 행사 메일함의 메일이에요' });
    const f = forwardOf(u), fw = f && f.fw;
    const at = (fw && fw.sent) || u.ts || '';
    const entry = { type: '메일 받음', text: String((fw && fw.subject) || u.subject || '').trim() || '(제목 없음)',
      from: fw ? fmtAddr(fw.from) : (u.from_name ? `${u.from_name} <${u.from_addr}>` : u.from_addr), mu: u.id, memo: String(memo || '').trim(),
      ...(f ? { fwdBy: f.by } : {}),
      date: at.slice(0, 10), at, by: req.user?.name || req.user?.email || '', color: '#0F766E' };
    await pool.query(
      `UPDATE crm_targets SET "lastActivity" = GREATEST(COALESCE("lastActivity", ''), $3),
         log = (jsonb_build_array($2::jsonb) || CASE WHEN left(btrim(COALESCE(log, '')), 1) = '[' THEN log::jsonb ELSE '[]'::jsonb END)::text
       WHERE id = $1`, [t.id, JSON.stringify(entry), entry.date]);
    await pool.query(`UPDATE mail_unassigned SET status = 'linked', linked_t = 'crm', linked_id = $1, handled_by = $2 WHERE id = $3`,
      [t.id, req.user?.email || '', u.id]);
    res.json({ ok: true, entry });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post('/unassigned/:id/ignore', async (req, res) => {
  if (req.user && req.user.isTest) return res.status(403).json({ ok: false, error: '시험 계정은 바꿀 수 없어요' });
  try {
    await ensureExtra();
    const u = (await pool.query(`SELECT * FROM mail_unassigned WHERE id = $1`, [req.params.id])).rows[0];
    if (!u) return res.status(404).json({ ok: false, error: '없는 메일이에요' });
    let n = 0;
    if (req.body && req.body.domain) {
      // 이 도메인은 늘 무시 — 행사 메일 설정에 적어 두고, 쌓여 있던 같은 도메인 메일도 함께 숨긴다
      const d = domainOf(u.from_addr);
      if (!d || FREE_MAIL.has(d)) return res.status(400).json({ ok: false, error: '무료 메일 도메인은 통째로 무시할 수 없어요' });
      const b = await boxOf(u.event_id);
      const list = new Set(String((b && b.ignore_domains) || '').split(',').map((x) => x.trim()).filter(Boolean));
      list.add(d);
      await pool.query('UPDATE event_mailboxes SET ignore_domains = $1 WHERE event_id = $2', [[...list].join(','), u.event_id]);
      n = (await pool.query(`UPDATE mail_unassigned SET status = 'ignored', handled_by = $1
        WHERE event_id = $2 AND status = 'new' AND lower(split_part(from_addr, '@', 2)) = $3`, [req.user?.email || '', u.event_id, d])).rowCount;
    } else {
      n = (await pool.query(`UPDATE mail_unassigned SET status = 'ignored', handled_by = $1 WHERE id = $2`, [req.user?.email || '', u.id])).rowCount;
    }
    res.json({ ok: true, ignored: n });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

/* 가져오기는 한 행사·한 메일함에 한 번에 하나만 — 중복 확인을 메모리에서 «날짜|제목»으로 해서,
   15분 자동 가져오기와 사람의 «지금 가져오기»(또는 두 사람)가 겹치면 같은 메일이 두 줄 들어갔다.
   잠금은 줄 하나(행사·종류)라 Neon을 무겁게 하지 않는다. 90초 지나면 저절로 풀린다(함수는 60초에 끊긴다) */
let lockReady = null;
const ensureLock = () => lockReady || (lockReady = pool.query(
  'CREATE TABLE IF NOT EXISTS mail_sync_locks (key TEXT PRIMARY KEY, until BIGINT)').catch((e) => { lockReady = null; throw e; }));
const withSyncLock = (kind, handler) => async (req, res) => {
  if (!(req.body && req.body.apply)) return handler(req, res);   // 미리보기는 기록을 안 바꾼다
  const key = `${kind}:${req.params.eventId}`;
  const until = Date.now() + 90000;
  try {
    await ensureLock();
    const got = await pool.query(
      `INSERT INTO mail_sync_locks (key, until) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET until = EXCLUDED.until WHERE mail_sync_locks.until < $3 RETURNING key`,
      [key, until, Date.now()]);
    if (!got.rowCount) return res.status(409).json({ ok: false, busy: true, error: '지금 다른 쪽에서 가져오는 중이에요 — 잠시 뒤 다시 눌러 주세요' });
  } catch (e) { console.error('[mail] 가져오기 잠금 실패 — 잠금 없이 진행:', e.message); return handler(req, res); }
  try { return await handler(req, res); }
  finally { await pool.query('DELETE FROM mail_sync_locks WHERE key = $1 AND until = $2', [key, until]).catch(() => {}); }
};
const syncSentLocked = withSyncLock('sent', syncSentHandler);
const syncInboxLocked = withSyncLock('inbox', syncInboxHandler);
router.post('/accounts/:eventId/sync-sent', syncSentLocked);
router.post('/accounts/:eventId/sync-inbox', syncInboxLocked);

/* ── 자동 가져오기 ──
   GitHub 예약 작업이 15분마다 부른다(.github/workflows/mail-sync.yml). 로그인한 사람이
   아니라 비밀 키(CRON_SECRET, Vercel·GitHub 둘 다에 같은 값)로 들어온다.
   한 번에 행사 하나 — Vercel 함수 한 번(60초) 안에 끝나게. 행사 목록은 따로 받는다.
   처리 결과 숫자만 돌려준다(이름·제목은 GitHub 기록에 남기지 않는다). */
const cron = express.Router();
cron.use((req, res, next) => {
  const want = (process.env.CRON_SECRET || '').trim();
  if (!want) return res.status(503).json({ ok: false, error: 'CRON_SECRET이 설정되지 않았어요' });
  const got = String(req.headers['x-cron-secret'] || '');
  const a = Buffer.from(got), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ ok: false });
  next();
});
cron.get('/mail-events', async (req, res) => {
  try {
    await ensureBox();
    const r = await pool.query("SELECT event_id FROM event_mailboxes WHERE COALESCE(pass_enc, '') <> '' ORDER BY event_id");
    res.json({ ok: true, events: r.rows.map((x) => x.event_id) });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
// 처리기를 그대로 부른다 — 사람이 누를 때와 같은 규칙(중복 건너뛰기·진행 완료 제외·회신 체크)
const runHandler = (handler, eventId) => new Promise((resolve) => {
  const req = { params: { eventId }, body: { apply: true }, user: { email: 'auto@cron', name: '자동' } };
  const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, ...o }); } };
  handler(req, res).catch((e) => resolve({ code: 500, ok: false, error: e.message }));
});
cron.post('/mail-sync', async (req, res) => {
  const eventId = String(req.query.event || '');
  if (!eventId) return res.status(400).json({ ok: false, error: 'event가 필요해요' });
  // part=sent|inbox면 하나만 — 큰 메일함은 둘을 한 번(60초)에 못 끝낸다
  const part = String(req.query.part || '');
  const skip = { ok: true, added: 0, stamped: 0, replied: 0 };
  const sent = part === 'inbox' ? skip : await runHandler(syncSentLocked, eventId);
  const inbox = part === 'sent' ? skip : await runHandler(syncInboxLocked, eventId);
  res.json({
    ok: !!(sent.ok && inbox.ok),
    sent: sent.ok ? { added: sent.added, stamped: sent.stamped } : { error: sent.error },
    inbox: inbox.ok ? { added: inbox.added, replied: inbox.replied } : { error: inbox.error },
  });
});

module.exports = router;
module.exports.cron = cron;
