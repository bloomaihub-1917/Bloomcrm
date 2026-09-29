# BloomCrm-v2 규칙

## 연락처 id는 16자리 이하 숫자로 만든다

화면(`js/api.js`)은 연락처 id를 숫자로 바꿔 쓴다(`+r.id`, `contactId: +r.cid`).
자바스크립트 숫자는 2^53(9,007,199,254,740,991, 16자리)을 넘으면 끝자리가 반올림된다.

- 2026-09-29에 가져오기 스크립트가 `${Date.now()}${순번 4자리}`(17자리)로 id를 만들었다.
  그 결과 옆 번호의 사람들이 한 사람으로 뭉개져 남의 행사 기록이 붙었고, 반올림된
  번호로 저장되면서 같은 사람이 한 번 더 생겼다. `backend-node/db/fix-unsafe-contact-ids.js`로
  158명을 다시 매기고 겹친 12쌍을 합쳤다.
- **새 연락처 id**는 `${Date.now()}${순번 3자리}`(16자리)처럼 `Number.isSafeInteger(Number(id))`가
  참인 값만 쓴다. 한 번에 1000명 이상 넣는다면 기존 최대 id + 1부터 차례로 매긴다.
- 연락처를 넣는 스크립트를 새로 만들면, 넣은 뒤 긴 id가 생겼는지 확인한다.
  생겼다면 `node db/fix-unsafe-contact-ids.js`(시험 실행) → `--apply`로 고친다.
- 연락처 id를 가리키는 곳: `participations.contact_id`, `exhibitor_contacts.contact_id`,
  `speakers.contact_id`, `speaker_contacts.contact_id`, `activity_log.link`(JSON 안).
  id를 바꿀 때는 이 다섯 곳을 같이 고친다.
