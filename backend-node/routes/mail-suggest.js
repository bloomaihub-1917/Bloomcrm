/* ─────────────────────────────────────────────
   mail-suggest.js — 주인 없는 메일의 연결 후보 추천
   바깥으로 아무것도 보내지 않는다. 이 행사의 연사·참가사 정보와 메일 머리·본문만 견준다.
   여러 단서에 점수를 매겨 더하고, 높은 순으로 3명까지 «왜»와 함께 돌려준다.
   확정은 사람이 한다 — 여기서는 단추에 올릴 후보만 고른다.
   ───────────────────────────────────────────── */
const FREE_MAIL = new Set(['gmail.com', 'naver.com', 'daum.net', 'hanmail.net', 'kakao.com', 'nate.com', 'hotmail.com',
  'outlook.com', 'yahoo.com', 'icloud.com', 'live.com', 'me.com', 'qq.com', '163.com']);
const domainOf = (a) => String(a || '').toLowerCase().split('@')[1] || '';

// 이름 비교용 — 호칭을 떼고 소문자·공백 없이
const TITLES = /\b(dr|prof|professor|mr|mrs|ms|miss|phd|md)\b\.?|교수님?|박사님?|선생님|님|대표님?|팀장님?|부장님?|과장님?|매니저/gi;
const norm = (s) => String(s || '').replace(TITLES, ' ').toLowerCase().replace(/[^a-z0-9가-힣]+/g, '');
// 영문 이름은 낱말로도 본다 — «Hong Gildong»과 «Gildong Hong», «gildong.hong@»
const words = (s) => String(s || '').replace(TITLES, ' ').toLowerCase().split(/[^a-z가-힣]+/).filter((w) => w.length >= 3);
const sameName = (a, b) => {
  const x = norm(a), y = norm(b);
  if (x.length < 2 || y.length < 2) return false;
  if (x === y) return true;
  const wa = words(a), wb = words(b);
  return wa.length >= 2 && wb.length >= 2 && wa.length === wb.length && [...wa].sort().join() === [...wb].sort().join();
};
// 제목에서 Re:·Fwd:·[태그]를 걷어 낸 몸통
const subjectCore = (s) => String(s || '').replace(/^(\s*(re|fw|fwd|답장|회신|전달)\s*(\[\d+\])?\s*:\s*|\s*\[[^\]]*\]\s*)+/gi, '').trim().toLowerCase();
const isReply = (s) => /^\s*(re|답장|회신)\s*:/i.test(String(s || ''));

/* owners: [{ t:'sp'|'ex', id, label, names:[사람 이름…], orgs:[소속·회사명…], emails:[…], sentSubjects:[…] }]
   linkedBefore: Map(from_addr 소문자 → { t, id }) — 같은 주소를 전에 연결한 적이 있으면
   mail: { from_addr, from_name, subject, body } */
function suggestOwners(mail, owners, linkedBefore) {
  const from = String(mail.from_addr || '').toLowerCase();
  const local = from.split('@')[0] || '';
  const d = domainOf(from);
  const body = String(mail.body || '');
  const bodyN = norm(body.slice(0, 20000));
  const core = subjectCore(mail.subject);
  // 같은 도메인을 쓰는 상대가 여럿이면 도메인만으로는 약하다
  const domainOwners = d && !FREE_MAIL.has(d) ? owners.filter((o) => o.emails.some((e) => domainOf(e) === d)).length : 0;

  const scored = owners.map((o) => {
    let score = 0;
    const why = [];
    const add = (n, w) => { score += n; why.push(w); };

    const prev = linkedBefore && linkedBefore.get(from);
    if (prev && prev.t === o.t && prev.id === o.id) add(6, '전에 이 주소를 연결함');

    if (domainOwners && o.emails.some((e) => domainOf(e) === d)) add(domainOwners === 1 ? 4 : 2, `같은 도메인 @${d}`);

    const nm = o.names.find((n) => sameName(n, mail.from_name));
    if (nm) add(5, `보낸 이름 «${mail.from_name}»`);
    else {
      // 주소 앞부분에 이름이 들어 있다 — gildong.hong@, ghong@은 못 잡는다(짧은 건 우연이 많다)
      const lw = local.toLowerCase();
      const hit = o.names.find((n) => { const ws = words(n).filter((w) => /^[a-z]+$/.test(w)); return ws.length >= 2 && ws.every((w) => lw.includes(w)); });
      if (hit) add(3, `주소에 이름 «${hit}»`);
    }

    if (core.length >= 6 && isReply(mail.subject) && o.sentSubjects.some((s) => subjectCore(s) === core)) add(5, '우리가 보낸 메일에 대한 답장');

    if (!nm) {
      const inBody = o.names.find((n) => norm(n).length >= 3 && bodyN.includes(norm(n)));
      if (inBody) add(2, `본문에 «${inBody}»`);
    }
    const org = o.orgs.find((g) => norm(g).length >= 4 && bodyN.includes(norm(g)));
    if (org) add(2, `본문에 «${org}»`);

    return { t: o.t, id: o.id, name: o.label, score, why: why.join(' · ') };
  });

  // 본문 단서만으로는 올리지 않는다 — 회신 인용문에 여러 사람이 걸리기 쉽다
  return scored.filter((s) => s.score >= 3).sort((a, b) => b.score - a.score).slice(0, 3);
}

module.exports = { suggestOwners, FREE_MAIL, domainOf };
