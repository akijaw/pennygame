const { json } = require("../_http");
const { naplaceFetch } = require("../_naplace");
const { enforceJsonRequest, enforceRateLimit, enforceSameOrigin, issueGameToken, issueTrackingToken, paymentDetails } = require("../_security");

// 페니의 게임: 입장 참가비(entry) 또는 카드 순서 보기(peek) 결제를 처리합니다.
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { message: "POST만 지원합니다." });
  if (!enforceRateLimit(req, res, "payment-create", 5, 60 * 1000)) return;
  if (!enforceSameOrigin(req, res) || !enforceJsonRequest(req, res)) return;
  try {
    const { studentId, amount, purpose = "entry" } = req.body || {};
    const coinAmount = Number(amount);
    if (!/^\d{4}$/.test(String(studentId || ""))) return json(res, 400, { message: "올바른 4자리 학번을 입력하세요." });
    if (!Number.isInteger(coinAmount) || coinAmount < 0) return json(res, 400, { message: "결제 금액은 0 이상의 정수여야 합니다." });
    if (purpose !== "entry" && purpose !== "peek") return json(res, 400, { message: "결제 목적이 올바르지 않습니다." });

    let expectedPrice, title;
    if (purpose === "entry") {
      expectedPrice = Number(process.env.ENTRY_COIN_PRICE || 100);
      title = "페니의 게임 참가비";
    } else {
      expectedPrice = Number(process.env.PEEK_COIN_PRICE || 50);
      title = "페니의 게임 - 카드 순서 보기";
    }
    if (coinAmount !== expectedPrice) return json(res, 400, { message: `${purpose === "entry" ? "참가비" : "카드 순서 보기"}는 ${expectedPrice}코인입니다.` });

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
      tracking_token: trackingToken,
      ...(approved ? { game_token: issueGameToken({ requestId: details.requestId, studentId, amount: coinAmount, purpose }) } : {}),
    });
  } catch (error) {
    return json(res, 500, { message: error.message || "Naplace Coin 연결에 실패했습니다." });
  }
};
