import { COIN_PRICE, WIN_REWARD, PEEK_PRICE_BASE, PAYMENT_POLL_MS, ALLOW_TEST_NICKNAME } from "./coin-config.js";

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `코인 서버 오류 (${res.status})`);
  return data;
}

export { COIN_PRICE, WIN_REWARD, PEEK_PRICE_BASE, PAYMENT_POLL_MS, ALLOW_TEST_NICKNAME };

// 남은 카드 수가 적을수록 비싸지는 요금표. api/coin/payment-requests.js의 계산식과
// 반드시 동일하게 유지할 것 — 서버가 최종 금액을 다시 계산해서 실제로 청구한다.
export function peekPriceForRemaining(remaining) {
  const base = PEEK_PRICE_BASE;
  const r = Math.max(0, Math.min(52, remaining));
  let mult;
  if (r > 40) mult = 1;
  else if (r > 20) mult = 2;
  else if (r > 8) mult = 4;
  else mult = 8;
  return base * mult;
}

export function getCoinStudent(studentId) {
  return api(`/api/coin/student?studentId=${encodeURIComponent(studentId)}`);
}

export function createPaymentRequest(studentId, amount = COIN_PRICE, purpose = "entry") {
  return api("/api/coin/payment-requests", {
    method: "POST",
    body: JSON.stringify({ studentId, amount, purpose }),
  });
}

// remaining: 결제 시점에 덱에 남아있는 카드 수. 서버가 이 값으로 가격을 직접 계산해 청구한다
// (클라이언트가 보낸 amount는 참고용일 뿐 신뢰하지 않음).
export function createPeekPayment(studentId, remaining) {
  return api("/api/coin/payment-requests", {
    method: "POST",
    body: JSON.stringify({ studentId, purpose: "peek", remaining }),
  });
}

export function getPaymentStatus(trackingToken) {
  return api(`/api/coin/payment-status?token=${encodeURIComponent(trackingToken)}`);
}

export function cancelPaymentRequest(trackingToken) {
  return api("/api/coin/payment-cancel", {
    method: "POST",
    body: JSON.stringify({ trackingToken }),
  });
}

export function requestReward(gameToken, won) {
  return api("/api/coin/reward", {
    method: "POST",
    body: JSON.stringify({ rewardType: "single", gameToken, won: won === true }),
  });
}
