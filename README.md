# 페니의 게임 — 나플라스 부스 (코인 결제 배포판)

Penney's Game(페니의 게임)을 Vercel에 배포하고, **나플라스 코인으로 입장 참가비를 결제**하도록 만든 버전입니다.
MathTetris와 동일한 나플 코인 연동 구조를 사용합니다.

## 동작 방식

- 홈에서 **입장하기** → 학번 4자리 입력 → **참가비 결제**(기본 100코인) → 결제 승인 후 입장.
- 결제는 전부 서버(`/api/coin/*`)가 중개하며, 나플 코인 **API 키는 브라우저에 절대 노출되지 않습니다.**
- AI 대결(pve)에서 **승리하면 보상 코인**을 지급합니다(기본 200코인).
  - 승패는 아직 브라우저에서 계산되므로, 보상 실지급은 **기본 비활성화**(`ALLOW_REAL_REWARDS=false`)입니다.
  - 결제 1건(게임 토큰 jti)당 보상은 **최대 1회**만 지급되도록 서버에서 막습니다.
- 패턴 선택 화면의 **"카드 순서 보기"** 버튼으로 코인을 더 내면(기본 50코인), 셔플된 52장 전체 순서를 **본인 화면에만 5초간** 보여주고 그 뒤 패턴을 자유롭게 바꿀 수 있습니다.
  - 입장 결제 때 확인한 학번을 재사용해 다시 묻지 않습니다.
  - 라운드(1P/2P 각각)당 1회만 구매할 수 있고, 다음 라운드에서 다시 활성화됩니다.

## 파일 구조

```
index.html            게임 화면 (코인 게이트 모달 포함)
game.js               게임 로직 (기존 단일 HTML의 스크립트를 외부 파일로 분리)
js/
  coin-gate.js        결제 게이트 UI/흐름 (ES 모듈)
  coin-api.js         /api 호출 래퍼
  coin-config.js      가격/보상/폴링 설정
  runtime-config.js   빌드시 서버 환경변수로부터 생성 (가격/보상/테스트 플래그)
api/
  _http.js _naplace.js _security.js   서버 공통 (HMAC 서명·레이트리밋·나플 fetch)
  coin/student.js            학번 → 이름/잔액 조회
  coin/payment-requests.js   참가비 결제 요청 생성
  coin/payment-status.js     결제 승인 폴링
  coin/payment-cancel.js     결제 취소
  coin/reward.js             승리 보상 정산 (기본 모의)
scripts/generate-config.js   runtime-config.js 생성 (빌드 스텝)
vercel.json / package.json / .env.example
```

## 로컬에서 UI만 빠르게 보기

정적 파일만 열면 게임은 동작하지만 `/api`가 없어 결제는 실패합니다.
결제까지 로컬에서 테스트하려면 `vercel dev`(아래) 또는 스텁 서버가 필요합니다.

## 배포 (Vercel)

자세한 순서는 `DEPLOYMENT.md`를 참고하세요. 요약:

1. 이 폴더를 Vercel 프로젝트로 임포트(또는 `vercel` CLI).
2. Environment Variables에 `.env.example`의 값을 등록:
   - `NAPLACE_COIN_BASE_URL` = `https://naplace-coin.vercel.app/api/v1`
   - `NAPLACE_COIN_API_KEY` = 나플 코인 관리자에서 발급한 **활성** 부스 키
   - `GAME_SIGNING_SECRET` = 32자 이상 무작위 (`openssl rand -base64 48`)
   - `ENTRY_COIN_PRICE` = `100`, `WIN_REWARD_COINS` = `200`, `PEEK_COIN_PRICE` = `50`
   - `ALLOW_TEST_NICKNAME` = `false`, `ALLOW_REAL_REWARDS` = `false`
3. 배포 후 홈 → 입장하기로 결제 흐름 확인.

> ⚠️ `NAPLACE_COIN_API_KEY`와 `GAME_SIGNING_SECRET`은 **서버 환경변수에만** 저장하세요. `js/` 등 브라우저 코드에 절대 넣지 않습니다.
