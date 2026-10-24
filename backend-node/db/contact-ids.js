/* ══════════════════════════════════════════
   연락처 id 매기기 — 넣는 스크립트는 모두 이것을 쓴다 (CLAUDE.md «연락처 id는 16자리 이하»)

   시작값 = max(지금 ms × 1000, 기존 최대 id + 1), 그 뒤로 1씩 늘린다.
   - 지금 ms × 1000은 1.7e15대라 16자리다. 1씩 늘리므로 1000명·1만 명·100만 명을
     넣어도 자릿수가 늘지 않는다(2^53까지 약 7e15 여유).
   - `${ms}${순번 3자리}`처럼 순번을 뒤에 붙이면 1000번째에서 17자리가 됐다.
   - 기존 최대 id보다 크게 시작하므로 이전 실행·화면에서 만든 id와 겹치지 않는다.
   안전 정수를 넘으면 넣기 전에 멈춘다.
══════════════════════════════════════════ */
async function contactIdAllocator(client){
  const r = await client.query(
    `SELECT max(id::numeric) AS m FROM contacts WHERE id::text ~ '^[0-9]+$'`);
  const max = r.rows[0] && r.rows[0].m ? Number(r.rows[0].m) : 0;
  let cur = Math.max(Date.now() * 1000, Number.isSafeInteger(max) ? max + 1 : 0) - 1;
  return function nextContactId(){
    cur += 1;
    if (!Number.isSafeInteger(cur)) throw new Error(`연락처 id ${cur}가 안전 정수를 넘어요 — 넣기를 멈춥니다`);
    return String(cur);
  };
}

module.exports = { contactIdAllocator };
