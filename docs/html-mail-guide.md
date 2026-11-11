# 단체 메일 HTML 본문 만들기

행사 › 참가기업 › **여러 기업에게 메일 보내기**에서 «HTML로 보내기»를 켜면 문구 칸을 HTML 소스로 씁니다.
메일용 HTML은 웹페이지와 달라서 Outlook·Gmail이 많은 기능을 지우거나 무시합니다. 아래 규칙대로 만들면 대부분 깨지지 않습니다.

## 1. 기본 틀

```html
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f4;">
  <tr>
    <td align="center" style="padding:20px 0;">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
        <tr>
          <td style="padding:24px; font-family:'Malgun Gothic',Arial,sans-serif; font-size:14px; line-height:1.6; color:#333333;">
            안녕하세요, {담당자}님.<br><br>
            {기업}의 {행사} 참가를 진심으로 감사드립니다.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

- 겉 표는 바탕색, 안쪽 표는 **폭 600px** 본문입니다. 600px가 메일에서 가장 안전한 폭입니다.
- `<html>`, `<head>`, `<body>`는 넣지 않습니다. 본문에 들어갈 부분만 적습니다.

## 2. 꼭 지킬 것

| 해야 할 것 | 하면 안 되는 것 |
|---|---|
| 배치는 `<table>`로 | `<div>` + `flex`·`grid`·`float`·`position` |
| 스타일은 태그마다 `style="..."` | `<style>` 블록, 외부 CSS (Gmail이 지움) |
| 색은 `#333333`처럼 6자리 | `rgba()`, CSS 변수 |
| 여백은 `<td style="padding:...">` | `<p>`·`<div>`의 `margin` (Outlook이 무시) |
| 글꼴은 `'Malgun Gothic',Arial,sans-serif` | 웹폰트 (대부분 안 보임) |
| 이미지는 `https://` 전체 주소 + `width`·`alt` | 내 PC 경로, 이미지 위에 글자 겹치기 |
| 버튼은 색 칠한 `<td>` 안에 `<a>` | `<button>`, 그림자 |

## 3. 자주 쓰는 조각

**버튼**

```html
<table cellpadding="0" cellspacing="0" border="0"><tr>
  <td style="background:#1a5fb4; border-radius:4px;">
    <a href="https://example.com" style="display:inline-block; padding:12px 24px; color:#ffffff; text-decoration:none; font-weight:bold;">신청하기</a>
  </td>
</tr></table>
```

**정보 표 (부스·일정 안내 등)**

```html
<table width="100%" cellpadding="8" cellspacing="0" border="0" style="border-collapse:collapse; font-size:13px;">
  <tr><td style="background:#f0f4fa; width:120px; border:1px solid #dddddd;"><b>부스 번호</b></td>
      <td style="border:1px solid #dddddd;">{부스}</td></tr>
  <tr><td style="background:#f0f4fa; border:1px solid #dddddd;"><b>설치 일정</b></td>
      <td style="border:1px solid #dddddd;">2026.11.24(화) 09:00~18:00</td></tr>
</table>
```

**이미지**

```html
<img src="https://도메인/파일.png" width="600" alt="행사 안내" style="display:block; width:100%; max-width:600px; border:0;">
```

## 4. 이 앱에서 쓸 때

- **변수**(문구 칸 아래 칩에 나오는 `{기업}`, `{담당자}` 등)는 HTML 안에 그대로 적습니다. 기업마다 채워집니다.
- **맨 위 공통 이미지, 기업별 사진(`{사진}`), 맨 아래 푸터**는 앱이 따로 붙입니다. HTML 안에 또 넣지 않습니다.
- **줄바꿈은 `<br>`** 로 적습니다. HTML로 보내면 엔터로 바꾼 줄은 무시됩니다.
- `<script>`, `<iframe>`, `<form>`, `<input>`, `<button>`, `onclick` 같은 것은 보낼 때 빠집니다.
- HTML을 못 보는 메일 프로그램용 글 본문은 태그를 빼서 자동으로 같이 붙습니다.
- 미리보기 칸은 실제 모양으로 보여 줍니다(폭은 줄여서).

## 5. 보내기 전 확인

1. **«나에게 먼저 1통»** 으로 먼저 받아 봅니다.
2. Gmail과 Outlook에서 각각 엽니다. Outlook이 가장 많이 깨집니다.
3. 휴대폰에서도 엽니다.
4. 전체 크기는 **100KB 아래**로 맞춥니다. Gmail은 102KB가 넘으면 뒷부분을 «메일 더보기»로 접습니다.

## 6. 외부 편집기로 만들 때

스티비·Mailchimp·Beefree 같은 메일 편집기에서 «HTML 내보내기»를 하면 위 규칙이 지켜진 소스가 나옵니다.

- `<body>` 안쪽만 잘라서 넣습니다.
- 그 서비스 전용 표시(`*|UNSUB|*` 같은 수신 거부 자리)는 지웁니다.

일반 웹페이지 HTML이나 PowerPoint·Word에서 «HTML로 저장»한 파일은 대부분 깨지니 쓰지 않습니다.
