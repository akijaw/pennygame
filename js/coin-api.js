import { COIN_PRICE, WIN_REWARD, PEEK_PRICE, PAYMENT_POLL_MS, ALLOW_TEST_NICKNAME } from "./coin-config.js";

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `코인 서버 오류 (${res.status})`);
  return data;
}

export { COIN_PRICE, WIN_REWARD, PEEK_PRICE, PAYMENT_POLL_MS, ALLOW_TEST_NICKNAME };

export function getCoinStudent(studentId) {
  return api(`/api/coin/student?studentId=${encodeURIComponent(studentId)}`);
}

export function createPaymentRequest(studentId, amount = COIN_PRICE, purpose = "entry") {
  return api("/api/coin/payment-requests", {
    method: "POST",
    body: JSON.stringify({ studentId, amount, purpose }),
  });
}

export function createPeekPayment(studentId) {
  return createPaymentRequest(studentId, PEEK_PRICE, "peek");
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
