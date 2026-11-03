/* ══════════════════════════════════════════════════════════════
   shared/mail/bulk-send.js — 일괄 메일 보내기 순서 (참가사·연사가 함께 쓰는 틀)

   전에는 exh-bulkmail.js와 speaker-bulkmail.js가 같은 순서를 따로 들고 있었다.
     통 사이 쉬기 → 멈춤 확인 → «보내는 중…» → 한 통 → 실패면 모아 두고 다음
     → 나갔으면 기록(기록 id가 없어도 화면에는 «보냄»으로) → 활동 로그
     → 멈췄으면 닫고 알림 / 아니면 다시 보내기 묶음을 다 보냈는지 보고 닫기
   한 통을 만들고 보내는 일, 보낸 뒤 남기는 기록, 마지막 알림 문구는 둘이 달라 각자 넘긴다.
   보내기 전 확인(누구에게·몇 통·발신 주소)도 각자 한다 — 이 틀은 «보낸다»고 정한 뒤부터 맡는다.
══════════════════════════════════════════════════════════════ */
import { trackAction } from '../../core/audit-log.js';

/* 통 사이 쉬기 — 같은 모양 메일을 쉬지 않고 수십 통 보내면 받는 쪽이 대량 발송으로 보고 스팸함에 넣는다.
   1초씩 이어 붙이면 뒤로 보낸 탭에서 브라우저가 타이머를 1분 단위로 몰아 한 통에 수십 분이 걸렸다.
   남은 시간은 시계로 재고, 멈춤을 누르면 바로 나온다.
   getBm: 지금 창 상태(닫혔으면 null) · say: 창 아래 알림 줄 */
export function makePause(getBm, say) {
  return async function pause(sec, label) {
    const end = Date.now() + sec * 1000;
    while (getBm() && !getBm().stop && Date.now() < end) {
      say(label(Math.ceil((end - Date.now()) / 1000)), true);
      await new Promise(r => setTimeout(r, Math.min(1000, end - Date.now())));
    }
  };
}

/* o — 각자 넘기는 것
   bm, list, st          창 상태, 보낼 대상(확인 창에서 «예»를 받은 뒤), 고른 단계
   gap, pause, pauseText(i, n, s, item)   통 사이 쉬는 초와 그동안 보일 말
   name(item)            알림·실패 목록에 쓸 이름
   say, render           창 아래 알림 줄, 창 다시 그리기
   send(item, i)         한 통 만들어 보내기 → { fail: '이유' } | { res, ctx } (res: sendMail 응답)
   sent(item, res, i, ctx)  나간 뒤 — 화면 기록 넣기 등
   track: { label, unit }   활동 로그 이름과 세는 말('곳' | '명')
   round: { progress(st), close(silent), curStep() }   다시 보내기 묶음
   close()               창 닫기(멈췄을 때)
   stopped({ ok, fails, unlogged })        멈췄을 때 알림
   done({ ok, fails, unlogged, closed })   다 보냈을 때 알림·다시 그리기 */
export async function runBulkSend(o) {
  const { bm, list, st } = o;
  bm.sending = true;
  o.render();
  let ok = 0;
  const fails = [], unlogged = [];
  bm.failed = new Set();
  for (const [i, x] of list.entries()) {
    if (i) await o.pause(o.gap, (s) => o.pauseText(i, list.length, s, x));   // 첫 통 앞에서는 쉬지 않는다
    if (bm.stop) break;
    o.say(`보내는 중… ${i + 1}/${list.length} ${o.name(x)}`, true);
    const r = await o.send(x, i);
    if (r.fail) { fails.push(`${o.name(x)}: ${r.fail}`); bm.failed.add(x.id); continue; }
    const res = r.res;
    if (!res.ok) { fails.push(`${o.name(x)}: ${res.error || '실패'}`); bm.failed.add(x.id); continue; }
    ok++;
    /* 나갔는데 기록을 못 남겼어도 화면에는 «보냄»으로 넣는다 — 안 그러면 «보낼 차례»로 다시 골라져
       같은 곳에 두 번 나간다. 서버 기록은 보낸메일함 가져오기가 채운다 */
    if (!res.logId) unlogged.push(o.name(x));
    await o.sent(x, res, i, r.ctx);
  }
  const stopped = bm.stop;
  const u = o.track.unit;
  trackAction('add', o.track.label, bm.evKey, `«${st.label}»${st.round ? ` (${st.round.label})` : ''} ${ok}${u} 보냄${fails.length ? ` · 실패 ${fails.length}${u}` : ''}${stopped ? ' · 중간에 멈춤' : ''}`);
  bm.sending = false;
  if (stopped) {
    bm.stop = false;
    o.close();
    o.stopped({ ok, fails, unlogged });
    return;
  }
  /* 묶음 대상에게 다 다시 보냈으면 묶음을 닫는다 */
  const rp = o.round.progress(o.round.curStep());
  let closed = false;
  if (rp && rp.done >= rp.total) { await o.round.close(true); closed = true; }
  o.done({ ok, fails, unlogged, closed });
}
