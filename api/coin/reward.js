const { json } = require("../_http");
const { naplaceFetch } = require("../_naplace");
const { enforceJsonRequest, enforceRateLimit, enforceSameOrigin, verifyPayload } = require("../_security");

// 페니의 게임 승리 보상.
//
// 보안 주의: 승패는 아직 브라우저에서 계산됩니다. 이 엔드포인트는
//   1) 결제로 발급된 서명 게임 토큰(typ:"game", purpose:"entry")을 검증하고
//   2) 결제 1건(jti)당 보상은 단 한 번만 지급되도록 정산 키로 막습니다.
// 따라서 조작으로 최대한 얻을 수 있는 건 "낸 참가비 1건당 보상 1회"로 제한됩니다.
// 실제 코인 지급(ALLOW_REAL_REWARDS=true)을 켜기 전에는, 여러 서버 인스턴스에 걸친
// 중복 지급을 확실히 막기 위해 durable 원장(Supabase/KV 등)으로 mockCompleted를
// 교체하는 것을 권장합니다. 기본값은 실제 지급 없이 검증만 수행하는 모의 정산입니다.

const mockCompleted = new Map();

function winReward() {
  const value = Number(process.env.WIN_REWARD_COINS || 700);
  return Number.isInteger(value) && value >= 0 ? value : 700;
}

function checkedEntryToken(token) {
  const payload = verifyPayload(token, "game");
  if (payload.purpose !== "entry") throw new Error("결제 토큰의 용도가 올바르지 않습니다.");
  if (!/^\d{4}$/.test(payload.studentId || "")) throw new Error("결제 토큰의 학번이 올바르지 않습니다.");
  return payload;
}

async function transferRealCoins(settlement) {
  const response = await naplaceFetch("/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      student_id: settlement.studentId,
      amount: settlement.amount,
      type: "club_to_student",
      title: settlement.reason,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "실제 코인 지급이 거절되었습니다.");
    error.statusCode = 502;
    throw error;
  }
  return { success: true, amount: settlement.amount, message: "실제 코인 지급이 완료되었습니다." };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { message: "POST만 지원합니다." });
  if (!enforceRateLimit(req, res, "reward", 20, 60 * 1000)) return;
  if (!enforceSameOrigin(req, res) || !enforceJsonRequest(req, res)) return;
  try {
    const body = req.body || {};
    const player = checkedEntryToken(body.gameToken);
    const won = body.won === true;
    const amount = won ? winReward() : 0;
    const settlementKey = `single:${player.jti}`;
    const reason = "페니의 게임 승리 보상";

    if (!won || amount === 0) {
      return json(res, 200, { success: true, amount: 0, message: "지급할 코인이 없습니다." });
    }
    if (amount > 50000) return json(res, 400, { message: "정산 금액이 허용 범위를 벗어났습니다." });

    // 결제 1건당 보상 1회 (best-effort 중복 방지)
    if (mockCompleted.has(settlementKey)) {
      return json(res, 200, { success: true, amount: 0, duplicate: true, message: "이미 받은 보상입니다." });
    }

    const realRewards = process.env.ALLOW_REAL_REWARDS === "true";
    let result;
    if (realRewards) {
      const transfer = await transferRealCoins({ studentId: player.studentId, amount, reason });
      result = { ...transfer, studentId: player.studentId, reason };
    } else {
      result = { success: true, mock: true, studentId: player.studentId, amount, reason, message: "검증된 테스트 정산 (실제 코인 지급 없음)" };
    }

    if (mockCompleted.size > 5000) mockCompleted.clear();
    mockCompleted.set(settlementKey, result);
    return json(res, 200, result);
  } catch (error) {
    const status = error.statusCode || (/토큰|서명|만료/.test(error.message || "") ? 401 : 400);
    return json(res, status, { message: error.message || "정산 요청이 올바르지 않습니다." });
  }
};
