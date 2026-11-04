# BloomCrm-v2 규칙

## 연락처 id는 16자리 이하 숫자로 만든다

화면(`js/api.js`)은 연락처 id를 숫자로 바꿔 쓴다(`+r.id`, `contactId: +r.cid`).
자바스크립트 숫자는 2^53(9,007,199,254,740,991, 16자리)을 넘으면 끝자리가 반올림된다.

- 2026-09-29에 가져오기 스크립트가 `${Date.now()}${순번 4자리}`(17자리)로 id를 만들었다.
  그 결과 옆 번호의 사람들이 한 사람으로 뭉개져 남의 행사 기록이 붙었고, 반올림된
  번호로 저장되면서 같은 사람이 한 번 더 생겼다. `backend-node/db/fix-unsafe-contact-ids.js`로
  158명을 다시 매기고 겹친 12쌍을 합쳤다.
- **새 연락처 id**는 직접 만들지 않고 정해진 함수로 받는다 — 화면은 `nextContactId()`(`js/state.js`),
  서버 스크립트는 `contactIdAllocator(client)`(`backend-node/db/contact-ids.js`).
  둘 다 max(지금 ms × 1000, 기존 최대 id + 1)에서 1씩 올려 1000명·1만 명을 넣어도 16자리 그대로다.
  `${Date.now()}${순번 3자리}`처럼 순번을 뒤에 붙이면 1000번째에서 17자리가 되니 쓰지 않는다.
- 연락처를 넣는 스크립트를 새로 만들면, 넣은 뒤 긴 id가 생겼는지 확인한다.
  생겼다면 `node db/fix-unsafe-contact-ids.js`(시험 실행) → `--apply`로 고친다.
- 연락처 id를 가리키는 곳: `participations.contact_id`, `exhibitor_contacts.contact_id`,
  `speakers.contact_id`, `speaker_contacts.contact_id`, `contact_attempts.contact_id`,
  `activity_log.link`(JSON 안). id를 바꿀 때는 이 여섯 곳을 같이 고친다.

## 서버 스크립트(`backend-node/db/`)는 하는 일에 따라 폴더에 둔다

- `db/` 바로 아래: 여럿이 함께 쓰는 것만 — `pool.js`, `contact-ids.js`, `schema.sql`, `seed.sql`, `fix-unsafe-contact-ids.js`
- `db/migrations/`: 표에 칸·표를 더하는 `add-*.js`
- `db/seeds/`: 처음 값을 넣는 `seed-*.js`
- `db/oneoff/`: 특정 행사·자료를 한 번 들여오거나 고치는 것. 짝으로 쓰는 `.py`도 같은 폴더에
- 폴더 안에서는 `require('../pool')`, `require('../contact-ids')`로 부른다. 돌릴 때는 `backend-node`에서 `node db/oneoff/<이름>.js`

## 탭 본문 단락 여백은 클래스로만 준다

탭 본문에서 위에서 아래로 쌓이는 단락(요약 카드·보기 칸·필터 줄·명단)에 `padding:12px 16px 0`처럼 px를 직접 적지 않는다.
단락마다 값을 따로 적다 보니 12·10·8·6px이 섞여 행사 DB 참가자 탭 간격이 들쭉날쭉했다(2026-11-04).

- 단락은 `class="sec"`, 버튼·검색 줄은 `class="sec sec-bar"`, 맨 아래 명단은 `class="sec-rows"`(`styles/components.css`).
  세로 간격은 `--gap-sec`, 좌우는 `--pad-x` 하나로 정한다 — 바꿀 때는 `styles/tokens.css` 값만 바꾼다.
- 요약 숫자 카드는 `stat-grid` / `stat-card`(내용 세로 가운데 — 한 줄 카드는 가장 큰 카드 높이로 늘어난다).
- 화면을 고친 뒤 `node scripts/refactor/check-spacing.js`로 직접 적은 여백이 없는지 확인한다.
