const { json } = require("../_http");
const { naplaceFetch } = require("../_naplace");
const { enforceRateLimit, issueGameToken, paymentDetails, verifyPayload } = require("../_security");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { message: "GET만 지원합니다." });
  if (!enforceRateLimit(req, res, "payment-status", 60, 60 * 1000)) return;
  try {
    const tracking = verifyPayload(req.query.token, "payment");
    const id = String(tracking.requestId || "");
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return json(res, 400, { message: "추적 토큰의 요청 번호가 올바르지 않습니다." });
    const response = await naplaceFetch(`/payment-requests/${encodeURIComponent(id)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return json(res, response.status, { message: data.message || "결제 상태 조회에 실패했습니다." });
    const details = paymentDetails(data);
    const upstreamStudentId = String(details.studentId || "");
    if (/^\d{4}$/.test(upstreamStudentId) && upstreamStudentId !== tracking.studentId) {
      return json(res, 403, { message: "결제 요청 소유자가 일치하지 않습니다." });
    }
    if (details.amount !== undefined && Number(details.amount) !== Number(tracking.amount)) return json(res, 403, { message: "결제 요청 금액이 일치하지 않습니다." });
    return json(res, 200, {
      status: details.status || "pending",
      ...(details.status === "approved" ? {
        game_token: issueGameToken({
          requestId: tracking.requestId,
          studentId: tracking.studentId,
          amount: tracking.amount,
          purpose: tracking.purpose,
          roomId: tracking.roomId,
        }),
      } : {}),
    });
  } catch (error) {
    const status = /토큰|서명|만료/.test(error.message || "") ? 401 : 500;
    return json(res, status, { message: error.message || "Naplace Coin 연결에 실패했습니다." });
  }
};
