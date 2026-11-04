/* ══════════════════════════════════════════════════════════════
   shared/mail/resend-round.js — 일괄 메일 «다시 보내기 묶음» (참가사·연사가 함께 쓰는 틀)

   이미 받은 곳에 개정판을 다시 보낼 때, «지금 이 순간»을 기준으로 묶음을 연다.
   묶음을 열 때 이미 받았던 곳이 대상이고, 그 뒤로 다시 보낸 곳을 센다. 다 보내면
   보내기 쪽이 저절로 닫는다. 묶음은 단계당 하나만 열린다.

   전에는 exh-bulkmail.js와 speaker-bulkmail.js가 같은 네 함수(진행 세기·열기·닫기·띠)를
   따로 들고 있었다. 다른 것은 대상 고르기, 말(곳/명), 열고 닫은 뒤 다시 그리는 것뿐이라
   그것만 넘겨받는다. 묶음을 어디에 저장하는지(pushRounds)도 각자 넘긴다.
══════════════════════════════════════════════════════════════ */
import { escapeHtml, nowStamp } from '../../utils.js';
import { currentUser } from '../../state.js';
import { trackAction } from '../../core/audit-log.js';

/* o — 각자 넘기는 것
   ctx()               { bm, st } — 지금 창 상태와 고른 단계
   members(ids)        묶음 대상 id 중 지금 셀 대상
   resent(m, key, since, before) 묶음을 연 뒤 다시 보냈나 — before는 묶음을 연 그 분에 이미 있던 기록 id
   before(ids, key, since) 묶음을 여는 그 분에 대상들이 이미 가진 이 단계 기록 id(기록 시각이 분까지라 따로 적어 둔다)
   targets(st)         묶음을 열 때의 대상 id들(이미 받았거나 끝낸 곳)
   pushRounds(fn)      묶음 목록을 고쳐 저장 — 실패하면 false
   track               활동 로그 이름 ('참가사 다시 보내기' 등)
   count(n)            '3곳' / '3명'
   text: { none(st), ask(st, n), leftover(n) }   알림·묻기 문구
   afterStart() / afterClose()   열고 닫은 뒤 다시 그리기
   bar: { hidden(st), unit, help, start, close, title, button }   띠 */
export function makeResendRound(o) {
  function progress(st) {
    const r = st && st.round;
    if (!r) return null;
    const ids = new Set(r.targets || []);
    const xs = o.members(ids);
    return { r, total: xs.length, done: xs.filter(x => o.resent(x, st.key, r.since, r.before)).length };
  }
  async function start() {
    const { bm, st } = o.ctx();
    if (!bm || bm.sending) return;
    if (!st) return;
    const targets = o.targets(st);
    if (!targets.length) { alert(o.text.none(st)); return; }
    const label = (prompt(o.text.ask(st, targets.length), `${st.label} 개정판`) || '').trim();
    if (!label) return;
    const since = nowStamp();
    const before = o.before(targets, st.key, since);
    const ok = await o.pushRounds(list => {
      list.push({ id: `R-${Date.now().toString(36)}`, step: st.key, label, since, before, targets,
        by: currentUser?.name || currentUser?.email || '' });
    });
    if (!ok) return;
    trackAction('add', o.track, bm.evKey, `«${st.label}» 묶음 «${label}» ${o.count(targets.length)}`);
    o.afterStart();
  }
  async function close(silent) {
    const { bm, st } = o.ctx();
    if (!bm) return;
    if (!st || !st.round) return;
    if (!silent) {
      const p = progress(st);
      if (!confirm(`다시 보내기 묶음 «${st.round.label}»을 닫을까요?${p && p.done < p.total ? o.text.leftover(p.total - p.done) : ''}`)) return;
    }
    const ok = await o.pushRounds(list => { const r = list.find(x => x.id === st.round.id); if (!r) return false; r.closed_at = nowStamp(); });
    if (!ok) return;
    trackAction('edit', o.track, bm.evKey, `«${st.label}» 묶음 «${st.round.label}» 닫음`);
    o.afterClose();
  }
  function barHtml(st, rp) {
    const b = o.bar;
    if (!st || st.lib || b.hidden(st)) return '';
    if (rp) return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:-2px 0 10px;padding:7px 10px;border:1px solid var(--am);border-radius:var(--r);font-size:var(--fs-11)">
      <b style="color:var(--am)">↻ 다시 보내기 «${escapeHtml(rp.r.label)}»</b>
      <span style="color:var(--i3)">다시 보냄 ${rp.done}/${rp.total}${b.unit}</span>
      <span style="color:var(--i4)">· ${escapeHtml(rp.r.since)} 시작${rp.r.by ? ` · ${escapeHtml(rp.r.by)}` : ''}</span>
      <span style="color:var(--i4)">— ${b.help}</span>
      <button class="btn" style="font-size:var(--fs-10);margin-left:auto" onclick="${b.close}()">묶음 닫기</button></div>`;
    return `<div style="margin:-2px 0 10px"><button class="btn" style="font-size:var(--fs-10_5)" onclick="${b.start}()"
      title="${b.title}">${b.button}</button></div>`;
  }
  return { progress, start, close, barHtml };
}
