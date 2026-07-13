const { json } = require("../_http");
const { naplaceFetch } = require("../_naplace");
const { enforceJsonRequest, enforceRateLimit, enforceSameOrigin, verifyPayload } = require("../_security");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { message: "POST만 지원합니다." });
  if (!enforceRateLimit(req, res, "payment-cancel", 10, 60 * 1000)) return;
  if (!enforceSameOrigin(req, res) || !enforceJsonRequest(req, res)) return;
  try {
    const tracking = verifyPayload(req.body?.trackingToken, "payment");
    const id = String(tracking.requestId || "");
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return json(res, 400, { message: "추적 토큰의 요청 번호가 올바르지 않습니다." });
    const response = await naplaceFetch(`/payment-requests/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return json(res, response.status, { message: data.message || "결제 요청 취소에 실패했습니다." });
    return json(res, 200, { status: "canceled" });
  } catch (error) {
    const status = /토큰|서명|만료/.test(error.message || "") ? 401 : 500;
    return json(res, status, { message: error.message || "Naplace Coin 연결에 실패했습니다." });
  }
};
