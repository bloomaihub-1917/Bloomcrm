# 전시 진행 데이터 넘겨받는 형식 (메일 트래킹 → CRM)

다른 세션에서 메일을 읽어 정리한 결과를 전시 탭에 정확히 넣기 위한 형식이다.

## 1. 기업을 무엇으로 특정하나

**담당자 이메일 주소**를 쓴다. 2026 KIC 51개사 전원이 마스터DB에 이메일을 갖고
있고 **전부 고유**해서, 이름 표기 흔들림("메디안 메디컬 테크놀로지" vs
"메디안 테크놀로지")에 영향받지 않는다.

- 1순위: `email` — 그 기업 담당자의 메일 주소 (메일 헤더에서 그대로)
- 2순위: `company` — 기업명 (이메일을 모를 때만. 표기가 다르면 매칭 실패할 수 있음)
- 둘 다 넣어주면 이메일로 맞추고 기업명은 검증에만 쓴다

⚠️ 도메인만으로는 안 된다 — `precisionformedicine.com`이 2개사에 걸쳐 있다.

## 2. 절대 지켜야 할 규칙

1. **모르는 필드는 아예 빼라.** 빈 문자열(`""`)을 넣으면 기존 값을 지운다.
   넘어온 키만 갱신하는 방식이라, 생략 = 건드리지 않음이다.
2. **추측 금지.** 메일에 근거가 있는 것만 넣는다. 애매하면 `note`에 적어
   사람이 판단하게 한다.
3. **날짜는 `YYYY-MM-DD`.** 메일 수신 시각이 아니라 그 일이 실제로 일어난 날.
4. **금액은 숫자만.** 콤마·원·₩ 없이 `3300000`.
5. **통화는 `items` / `invoices` / `payments` 각 줄에 넣는다** (`"currency": "KRW"` 또는 `"USD"`).
   최상위에 넣으면 무시된다 — 기업 단위 통화 컬럼은 없다. 한 기업 안에서 통화를
   섞지 말 것(합계가 한쪽만 더해져 "완납"으로 잘못 표시된다).
6. **날짜를 모르지만 "했다"는 건 확실하면** `*_at` 대신 여부 플래그를 쓴다:
   `app_received` / `directory_received` / `booth_confirmed` 에 `"yes"`.
   날짜를 지어내지 않기 위해 둘을 분리해뒀다.

## 3. 형식

기업 하나당 객체 하나, 전체를 배열로.

```json
[
  {
    "email": "espark@bredis.co.kr",
    "company": "㈜브레디스헬스케어",

    "manual_sent_at": "2026-07-15",
    "manual_replied_at": "2026-07-18",

    "app_received": "yes",
    "app_received_at": "2026-07-20",
    "app_complete": "no",
    "app_missing": "사업자등록증 미첨부",
    "extra_equipment": "추가 테이블 2, 전기 3kW",

    "booth_no": "A-12",
    "booth_floor": "2",
    "booth_type": "Self-Construction",
    "booth_qty": "1",
    "grade": "GOLD",
    "booth_confirmed": "yes",
    "booth_confirmed_at": "2026-07-25",

    "graphic_ordered_at": "2026-08-02",
    "graphic_type": "design",
    "graphic_draft_at": "2026-08-05",
    "graphic_revised_at": "2026-08-08",
    "graphic_final_at": "2026-08-11",

    "tax_sent_at": "2026-08-05",
    "tax_amount": "3300000",
    "tax_contact_name": "김경리",
    "tax_contact_email": "acc@bredis.co.kr",

    "directory_received": "yes",
    "directory_received_at": "2026-08-01",

    "movein_at": "2026-10-12",
    "builder": "OO디자인",
    "badge_count": "3",

    "invoices": [
      { "title": "EX-25-01", "amount": "3300000", "currency": "KRW",
        "created_at": "2026-08-01", "sent_at": "2026-08-01", "due_date": "2026-08-15" }
    ],
    "payments": [
      { "paid_at": "2026-08-10", "amount": "1500000", "currency": "KRW", "method": "계좌이체", "note": "1차" }
    ],
    "items": [
      { "category": "equip", "name": "추가 테이블", "qty": "2", "unit_price": "50000",
        "amount": "100000", "currency": "KRW" }
    ],
    "logs": [
      { "kind": "inquiry", "ts": "2026-07-22", "channel": "이메일",
        "counterpart": "박은선", "category": "부스",
        "subject": "부스 전기 용량 문의",
        "body": "3kW로 충분한지 확인 부탁드립니다.",
        "answered_at": "2026-07-23",
        "answer": "3kW면 장비 2대까지 충분합니다." }
    ],
    "note": "8/3 메일에서 부스 위치 변경 요청 언급 — 확정 여부 불명"
  }
]
```

### 필드 뜻

| 필드 | 언제 채우나 |
|---|---|
| `manual_sent_at` | 참가 매뉴얼을 보낸 날 |
| `app_received` / `directory_received` / `booth_confirmed` | `"yes"` — **날짜를 모를 때** 쓰는 여부 플래그 |
| `manual_replied_at` | 기업이 회신한 날 (내용 무관, 회신 자체) |
| `app_received_at` | 신청서를 실제로 받은 날 |
| `app_complete` | `"yes"` 필수정보 완비 / `"no"` 누락 있음 |
| `app_missing` | 무엇이 비었는지 (app_complete가 no일 때) |
| `extra_equipment` | 추가 비품 신청 내역 (원문 그대로) |
| `booth_no` / `booth_floor` / `booth_type` / `booth_qty` | 부스 번호·층·타입·수량 |
| `grade` | 스폰서 등급 — `DIA` / `GOLD` / `SILVER` / `BRONZE` / `Exhibitor` |
| `booth_confirmed_at` | 배정 확정일 |
| `graphic_ordered_at` | 그래픽 주문일 (주문했을 때만) |
| `graphic_type` | `"design"`(제작) / `"print"`(출력) |
| `graphic_spec_ok` / `graphic_spec_note` | 출력일 때 규격 적합 여부(`yes`/`no`)와 메모 |
| `graphic_draft_at` / `graphic_revised_at` / `graphic_final_at` | 제작일 때 초안·수정안·최종안 확정일 |
| `builder` / `badge_count` / `badge_issued_at` | 설치업체 / 출입증 매수 / 발급일 |
| `tax_sent_at` 등 | 세금계산서 발송일·금액·담당자 |
| `directory_received_at` | 도록용 자료(회사소개·로고) 받은 날 |
| `movein_at` | 반입·설치일 |

### logs — 문의와 기록

- `kind`: `"inquiry"` 답변이 필요한 문의 / `"note"` 그냥 기록
- `answered_at` + `answer`를 넣으면 답변 완료, 없으면 **미답변**으로 남아
  화면 상단 "미답변 문의" 패널에 뜬다
- `category`: 부스 / 비품 / 그래픽 / 정산 / 현장 / 기타
- `body`에는 **받은 메일 본문을 그대로** 넣어도 된다 (요약보다 원문이 낫다)

### items — 금액 항목

`category`: `booth`(부스) / `equip`(비품) / `graphic`(그래픽) / `etc`(기타)

### contacts — 기업 담당자 (여러 명)

한 기업에 실무·정산·현장 담당이 따로면 배열로 넣는다. 마스터DB에 있는 사람은
이메일로 자동 연결되고, 없으면 적어준 이름/이메일이 그대로 쓰인다.

```json
"contacts": [
  { "name": "박은선", "email": "espark@bredis.co.kr", "role": "실무", "is_primary": "yes" },
  { "name": "김경리", "email": "acc@bredis.co.kr", "role": "정산" }
]
```
`role`: 실무 / 정산 / 현장 / 기타. `is_primary`는 기업당 한 명만.

## 4. 다른 세션에 이렇게 요청하면 된다

> 지금까지 트래킹한 2026 KIC 전시 참가기업 메일을 아래 형식의 JSON 배열로
> 정리해줘.
>
> - 기업 식별은 담당자 **이메일 주소**(`email`)로 한다. 기업명(`company`)도 함께 넣어줘.
> - **메일에 근거가 있는 것만** 넣어. 확실하지 않으면 그 필드를 아예 빼고,
>   대신 `note`에 무엇이 애매한지 적어줘. 빈 문자열은 넣지 마.
> - 날짜는 `YYYY-MM-DD`, 금액은 콤마 없이 숫자만.
> - 문의 메일은 `logs`에 `kind:"inquiry"`로. 답장을 보냈으면 `answered_at`과
>   `answer`를 채우고, 아직 답 안 했으면 그 두 필드는 빼줘.
> - 결과는 JSON 파일 하나로 저장하되 **`Data/mail-tracking/` 아래에** 둬줘.
>   (저장소가 public이라 `docs/`에 두면 실명·이메일·결제정보가 그대로 공개된다.
>    `Data/`는 gitignore 대상이다.)
>
> (형식 상세는 이 문서를 그대로 붙여넣어 전달)

## 5. 받은 뒤

⚠️ **실데이터 파일은 반드시 `Data/` 아래에 둔다.** 한 번 `docs/`에 커밋됐다가
담당자 실명·업무 이메일·카드 결제 승인번호가 공개 저장소에 노출된 적이 있어
히스토리까지 정리해야 했다. `docs/*.json`은 gitignore로 막아뒀다.

JSON 파일 경로를 알려주면 이쪽에서:
1. 이메일로 51개사와 매칭 → **매칭 실패 건을 먼저 보고**한다(임의로 넣지 않음)
2. 기존 값과 충돌하는 항목(이미 다른 날짜가 들어있는 경우)을 보여주고 확인받는다
3. 확인 후 반영하고, 반영 결과를 건수로 보고한다
