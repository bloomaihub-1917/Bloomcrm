/* ══════════════════════════════════════════════════════════════
   core/part-lock.js — 진행 완료 잠금 (전시·컨퍼런스가 함께 쓰는 틀)

   끝난 행사는 열어 볼 수는 있어야 하고, 고쳐지면 안 된다. 화면에서 입력칸을
   비활성하는 것만으로는 부족하다 — 남은 인라인 핸들러나 콘솔로 값이 들어가면
   끝난 행사의 기록이 조용히 바뀐다. 실제로 데이터를 지키는 건 저장 가드다.

   전에는 전시(exh-tab의 exhLocked·guardWrite)와 컨퍼런스(conf-common의
   confLocked·guardConf)가 같은 코드를 따로 들고 있었다. 다른 것은 파트 이름,
   알림 문구의 «행사/컨퍼런스», 창이 없을 때 어느 행사로 판단하느냐뿐이다.

   판단할 행사
   - 상세 창이 열려 있는 동안은 «그 기업·연사의 행사» — 창은 감사 로그·연락처 등
     다른 행사 화면에서도 열리므로, 탭에서 고른 행사로 판단하면 끝난 행사의 기록이
     고쳐지거나 진행 중인 것이 막힌다. 창이 setLockEv로 알려 준다.
   - 창이 없으면 탭에서 고른 행사 — fallback이 돌려준다.
══════════════════════════════════════════════════════════════ */
import { evPartDone } from '../state.js';

/* part: evPartDone의 파트 키('exh' | 'conf')  label: 알림에 쓸 말('행사' | '컨퍼런스')
   fallback: 창이 없을 때 행사 키를 돌려주는 함수(나중에 onFallback으로 바꿀 수 있다) */
export function makePartLock({ part, label, fallback = () => '' }) {
  let lockEv = null;
  let fb = fallback;
  let toastAt = 0;
  const locked = () => { const ev = lockEv || fb(); return !!ev && evPartDone(ev, part); };
  /* 막혔다는 걸 알린다. 연달아 누르면 알림이 쌓이므로 잠깐 사이엔 한 번만. */
  const notice = () => {
    const now = Date.now();
    if (now - toastAt < 1500) return;
    toastAt = now;
    alert(`진행 완료된 ${label}예요 — 열람만 됩니다.\n고치려면 설정 › 행사 관리 › 진행 파트에서 "진행 중"으로 되돌리세요.`);
  };
  /* 저장 함수를 감싸 잠긴 행사면 아예 보내지 않는다 — 감싸는 자리가 하나여야 빠지는 길이 없다 */
  const guard = (fn) => async (...args) => {
    if (locked()) { notice(); return { ok: false, locked: true }; }
    return fn(...args);
  };
  return {
    locked, notice, guard,
    setLockEv: (v) => { lockEv = v || null; },
    onFallback: (f) => { fb = f; },
  };
}
