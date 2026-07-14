# 배포 가이드 (Vercel + 나플라스 코인)

## 1. 나플라스 코인 부스 키 발급
- 나플라스 코인 관리자 페이지에서 이 게임(부스)용 **API 키**를 발급합니다.
- 키가 **활성(active)** 상태인지 확인합니다. (비활성 키는 "조회 불가"로 결제가 막힙니다.)

## 2. Vercel 환경변수 등록
프로젝트 → Settings → Environment Variables 에 등록:

| 이름 | 값 | 비고 |
|------|-----|------|
| `NAPLACE_COIN_BASE_URL` | `https://naplace-coin.vercel.app/api/v1` | **localhost 금지** (배포에선 반드시 프로덕션 주소) |
| `NAPLACE_COIN_API_KEY` | (발급받은 활성 키) | 서버 전용. 브라우저 노출 금지 |
| `GAME_SIGNING_SECRET` | `openssl rand -base64 48` 결과 | 최소 32자 |
| `ENTRY_COIN_PRICE` | `100` | 입장 참가비 |
| `WIN_REWARD_COINS` | `200` | 승리 보상 |
| `PEEK_COIN_PRICE` | `50` | 카드 순서 보기 1회 가격 |
| `ALLOW_TEST_NICKNAME` | `false` | 로컬/프리뷰에서만 true |
| `ALLOW_REAL_REWARDS` | `false` | 실제 보상 지급 스위치 (아래 참고) |

## 3. 배포
- `vercel` CLI 또는 대시보드에서 Deploy.
- 빌드 스텝(`npm run build`)이 `js/runtime-config.js`를 환경변수 값으로 다시 굽습니다.

## 4. Vercel Firewall 레이트리밋 (권장)
- `/api/coin/payment-requests` : 1분당 5회
- `/api/coin/student` : 1분당 30회
- `/api/coin/payment-status` : 1분당 60회
- `/api/coin/payment-cancel` : 1분당 10회
- `/api/coin/reward` : 1분당 20회

서버 함수 안의 메모리 레이트리밋은 보조 장치이며, 여러 인스턴스에 걸친 공격은 Firewall 규칙으로 막아야 합니다.

## 5. 승리 보상 실지급을 켤 때 (`ALLOW_REAL_REWARDS=true`)
기본값은 검증만 하고 실제 코인은 주지 않는 **모의 정산**입니다. 실지급을 켜기 전에:

1. **중복 지급 방지 원장**을 durable 저장소로 교체하세요.
   현재 `api/coin/reward.js`의 중복 방지(`mockCompleted`)는 서버 인스턴스 메모리라, 여러 인스턴스에 걸치면 중복 지급을 완전히 막지 못합니다.
   Supabase(예: MathTetris의 `coin_settlements`) 또는 Vercel KV로 `settlement_key`(=`single:<jti>`) 유일 제약을 두는 것을 권장합니다.
2. 승패가 **브라우저에서 계산**된다는 점을 인지하세요. 결제 1건당 보상 1회로 상한은 있지만, 확실히 막으려면 서버 권위형 결과 검증이 필요합니다.
3. 위 두 가지가 준비된 뒤에만 Production에서 `ALLOW_REAL_REWARDS=true`로 설정하세요.

## 로컬 결제 테스트 (선택)
`vercel dev`로 서버 함수를 로컬 실행할 수 있습니다. 실제 코인 없이 흐름만 보려면
`ENTRY_COIN_PRICE=0` + `ALLOW_TEST_NICKNAME=true`로 두면 0코인 요청이 즉시 승인됩니다
(결제 서버를 거치지 않는 테스트 경로).
