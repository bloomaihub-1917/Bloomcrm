# 메일 연동 — 어디까지 했고 무엇이 남았나

**상태: 1단계 백엔드만 만들어 둠. 환경변수가 없어 동작하지 않음(의도된 상태).**
2026-09-01 기준. 나중에 이어서 하기로 함.

## 알아낸 것 (다시 조사하지 말 것)

회사 메일은 **메일플러그**다. Gmail도 Microsoft 365도 아니라서 원클릭 연동이 없다.

```
13100m.net  MX  → mx01.mailplug.com / mx02.mailplug.com
            SPF → v=spf1 mx include:mailplug.com ~all
            google-site-verification 없음 → Google Workspace 아님
```

CRM 사용 계정 5명 전부 `@13100m.net`이고, 등록된 연락처 중 gmail 주소는 0건이다.

연결하기로 한 건 **개인 Gmail 계정 하나**다. Workspace가 아니므로 아래가 따라온다.

- **서비스 계정 도메인 위임을 쓸 수 없다** (Workspace 전용)
- **OAuth 내부 앱(Internal)으로 만들 수 없다** → 심사 면제를 못 받는다
- Gmail 읽기·발송은 구글의 **제한 스코프**라 외부 앱은 보안 심사(CASA)가 필요하고,
  심사 전 테스트 모드는 **리프레시 토큰이 7일마다 만료**된다

그래서 **앱 비밀번호 + SMTP/IMAP**으로 간다. 메일함이 하나뿐이라 이 편이 간단하고,
개인 메일함을 여는 것도 아니다. 이 판단은 개인 Gmail을 쓰는 한 유효하다 —
나중에 Workspace로 옮기면 다시 검토할 가치가 있다.

## 만들어 둔 것

`routes/mail.js`, `app.js`에 `/api/mail`로 연결됨. 배포까지 끝났다.

| 경로 | 하는 일 |
|---|---|
| `GET /api/mail/status` | 설정·로그인 확인만. 메일을 보내지 않고, 비밀번호는 어떤 형태로도 돌려주지 않는다 |
| `POST /api/mail/send` | 발송 + `exhibitor_logs`에 `direction='out'`으로 기록 |

환경변수가 비어 있으면 `status`는 "환경변수가 아직 안 채워졌어요"를,
`send`는 400을 돌려준다. **기존 기능에는 영향이 없다** (배포 후 확인:
`/health` 200, `/api/data` 401, `/api/mail/status` 401).

## 이어서 할 때 — 사람이 해야 하는 준비

저장소에 비밀번호를 두지 않는다. Vercel 환경변수로만 넣는다.

1. 그 Gmail에서 **2단계 인증**을 켠다
2. `myaccount.google.com/apppasswords`에서 **앱 비밀번호 16자리** 발급
3. Gmail 설정 › 계정 › **다른 주소에서 메일 보내기**에 회사 주소를 추가·인증
   — 기업에 나가는 메일이 `@gmail.com`이면 곤란하다
4. Vercel › backend-node › Environment Variables

   ```
   GMAIL_USER=<그 Gmail 주소>
   GMAIL_APP_PASSWORD=<16자리>
   GMAIL_FROM=<회사 주소>
   GMAIL_FROM_NAME=스튜디오 블룸
   ```

5. Redeploy 후 `/api/mail/status`로 확인

## 남은 단계

**화면은 일부러 안 붙였다.** 연결이 확인되기 전에 버튼부터 만들면
왜 안 되는지 헷갈린다. `status`가 성공한 뒤에 붙인다.

1. **독촉 메일 보내기** — 마감 지난 기업 목록에서 바로. 마감일 기능이 이미 있어
   (`exhCfg`의 `due`) 대상은 그대로 쓸 수 있다. 보낸 이력이 남는 게 핵심이다.
2. **받은 메일 → 문의·기록 자동 등록** — 전용 메일함(BCC/전달) 방식.
   보낸 사람 주소로 기업·담당자를 찾는다. 도메인 대조 로직이 이미 있다
   (`exh-drawer.js`의 `foreignDomain`).
   Vercel은 상시 연결이 안 되니 **Cron으로 5~10분마다** IMAP 접속해 새 메일만 가져온다.
3. **첨부파일 → 그래픽 수령 처리** — `exhibitor_items.received_at`을 채운다.
   파일 저장소가 없으므로, 파일을 우리 쪽에 옮기지 말고 **Gmail 메시지 id를
   가리키기만** 하는 편이 낫다.
