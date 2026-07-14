const { json } = require("../_http");
const { naplaceFetch } = require("../_naplace");
const { enforceJsonRequest, enforceRateLimit, enforceSameOrigin, issueGameToken, issueTrackingToken, paymentDetails } = require("../_security");

// 카드 순서 보기 요금표: 남은 카드 수가 적을수록 비싸진다.
// js/coin-api.js의 peekPriceForRemaining()과 반드시 동일하게 유지할 것 —
// 클라이언트가 보내는 remaining 값으로 서버가 직접 계산해서 청구하므로
// (클라이언트가 보낸 amount는 신뢰하지 않음) 여기가 실제 가격의 기준이 된다.
function peekPriceForRemaining(remaining, base) {
  const r = Math.max(0, Math.min(52, remaining));
  let mult;
  if (r > 40) mult = 1;
  else if (r > 20) mult = 2;
  else if (r > 8) mult = 4;
  else mult = 8;
  return base * mult;
}

// 페니의 게임: 입장 참가비(entry) 또는 카드 순서 보기(peek) 결제를 처리합니다.
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { message: "POST만 지원합니다." });
  if (!enforceRateLimit(req, res, "payment-create", 5, 60 * 1000)) return;
  if (!enforceSameOrigin(req, res) || !enforceJsonRequest(req, res)) return;
  try {
    const { studentId, amount, purpose = "entry", remaining } = req.body || {};
    if (!/^\d{4}$/.test(String(studentId || ""))) return json(res, 400, { message: "올바른 4자리 학번을 입력하세요." });
    if (purpose !== "entry" && purpose !== "peek") return json(res, 400, { message: "결제 목적이 올바르지 않습니다." });

    let coinAmount, title;
    if (purpose === "entry") {
      coinAmount = Number(amount);
      if (!Number.isInteger(coinAmount) || coinAmount < 0) return json(res, 400, { message: "결제 금액은 0 이상의 정수여야 합니다." });
      const entryPrice = Number(process.env.ENTRY_COIN_PRICE || 150);
      if (coinAmount !== entryPrice) return json(res, 400, { message: `참가비는 ${entryPrice}코인입니다.` });
      title = "페니의 게임 참가비";
    } else {
      const remainingCount = Number(remaining);
      if (!Number.isInteger(remainingCount) || remainingCount < 0 || remainingCount > 52) {
        return json(res, 400, { message: "남은 카드 수 정보가 올바르지 않습니다." });
      }
      const base = Number(process.env.PEEK_COIN_PRICE_BASE || 30);
      coinAmount = peekPriceForRemaining(remainingCount, base); // 클라이언트가 보낸 amount는 무시하고 서버가 재계산
      title = `페니의 게임 - 카드 순서 보기 (남은 ${remainingCount}장)`;
    }

    // 0코인(테스트) 요청은 결제 서버를 거치지 않고 바로 승인 게임 토큰을 발급합니다.
    if (coinAmount === 0) {
      const requestId = `test-${Date.now()}-${String(studentId)}`;
      return json(res, 201, {
        status: "approved",
        test: true,
        game_token: issueGameToken({ requestId, studentId, amount: 0, purpose }),
        message: "0코인 테스트 요청이 승인되었습니다.",
      });
    }

    const response = await naplaceFetch("/payment-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ student_id: String(studentId), amount: coinAmount, title }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return json(res, response.status, { message: data.message || "결제 요청 생성에 실패했습니다." });
    const details = paymentDetails(data);
    if (!details.requestId) return json(res, 502, { message: "결제 서버가 요청 번호를 반환하지 않았습니다." });
    const trackingToken = issueTrackingToken({ requestId: details.requestId, studentId, amount: coinAmount, purpose });
    const approved = details.status === "approved";
    return json(res, response.status, {
      status: details.status || "pending",
      amount: coinAmount,
      tracking_token: trackingToken,
      ...(approved ? { game_token: issueGameToken({ requestId: details.requestId, studentId, amount: coinAmount, purpose }) } : {}),
    });
  } catch (error) {
    return json(res, 500, { message: error.message || "Naplace Coin 연결에 실패했습니다." });
  }
};
