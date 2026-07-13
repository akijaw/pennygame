const crypto = require("crypto");

const buckets = new Map();

function signingSecret() {
  const secret = process.env.GAME_SIGNING_SECRET || "";
  if (secret.length < 32) throw new Error("GAME_SIGNING_SECRET은 32자 이상이어야 합니다.");
  return secret;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signPayload(payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = encode({ ...payload, iat: now, exp: now + ttlSeconds });
  const signature = crypto.createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyPayload(token, expectedType) {
  const [body, providedSignature] = String(token || "").split(".");
  if (!body || !providedSignature) throw new Error("보안 토큰이 올바르지 않습니다.");
  const expectedSignature = crypto.createHmac("sha256", signingSecret()).update(body).digest("base64url");
  const left = Buffer.from(providedSignature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new Error("보안 토큰 서명이 올바르지 않습니다.");
  let payload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { throw new Error("보안 토큰을 해석할 수 없습니다."); }
  if (payload.typ !== expectedType) throw new Error("보안 토큰 종류가 올바르지 않습니다.");
  if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) throw new Error("보안 토큰이 만료되었습니다.");
  return payload;
}

function issueTrackingToken({ requestId, studentId, amount, purpose, roomId = "" }) {
  return signPayload({ typ: "payment", requestId: String(requestId), studentId: String(studentId), amount, purpose, roomId }, 5 * 60);
}

function stableGameId({ requestId, studentId, purpose, roomId = "" }) {
  const bytes = crypto.createHmac("sha256", signingSecret())
    .update(`${purpose}:${requestId}:${studentId}:${roomId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function issueGameToken({ requestId, studentId, amount, purpose, roomId = "" }) {
  return signPayload({
    typ: "game",
    jti: stableGameId({ requestId, studentId, purpose, roomId }),
    paymentRequestId: String(requestId),
    studentId: String(studentId),
    amount,
    purpose,
    roomId,
  }, 6 * 60 * 60);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

function rateLimit(req, key, limit, windowMs) {
  const now = Date.now();
  const bucketKey = `${key}:${clientIp(req)}`;
  const current = buckets.get(bucketKey);
  if (!current || current.resetAt <= now) {
    if (buckets.size >= 5000 && !buckets.has(bucketKey)) {
      for (const [entryKey, value] of buckets) {
        if (value.resetAt <= now || buckets.size >= 5000) buckets.delete(entryKey);
        if (buckets.size < 5000) break;
      }
    }
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  current.count += 1;
  return { allowed: current.count <= limit, remaining: Math.max(0, limit - current.count), resetAt: current.resetAt };
}

function enforceRateLimit(req, res, key, limit, windowMs) {
  const result = rateLimit(req, key, limit, windowMs);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(result.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)));
  if (!result.allowed) {
    res.setHeader("Retry-After", String(Math.ceil((result.resetAt - Date.now()) / 1000)));
    res.status(429).setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ message: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." }));
    return false;
  }
  return true;
}

function enforceJsonRequest(req, res, maxBytes = 16 * 1024) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const contentLength = Number(req.headers["content-length"] || 0);
  if (!contentType.startsWith("application/json")) {
    res.status(415).setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ message: "application/json 요청만 지원합니다." }));
    return false;
  }
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    res.status(413).setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ message: "요청 본문이 너무 큽니다." }));
    return false;
  }
  return true;
}

function enforceSameOrigin(req, res) {
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    res.status(403).setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ message: "교차 출처 요청은 허용되지 않습니다." }));
    return false;
  }
  const origin = String(req.headers.origin || "");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (origin) {
    try {
      if (new URL(origin).host !== host) throw new Error("origin mismatch");
    } catch {
      res.status(403).setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ message: "요청 출처가 올바르지 않습니다." }));
      return false;
    }
  }
  return true;
}

function safeString(value, maxLength) {
  const result = String(value || "").trim();
  if (!result || result.length > maxLength || /[<>\u0000-\u001f]/.test(result)) return null;
  return result;
}

function paymentDetails(data = {}) {
  const nested = data.payment_request || data.request || data.data || {};
  const student = data.student || nested.student || {};
  return {
    requestId: data.request_id ?? data.id ?? nested.request_id ?? nested.id,
    studentId: data.student_id ?? nested.student_id ?? student.student_id ?? student.id,
    amount: data.amount ?? nested.amount,
    status: String(data.status ?? nested.status ?? "").toLowerCase(),
  };
}

module.exports = {
  enforceJsonRequest,
  enforceRateLimit,
  enforceSameOrigin,
  issueGameToken,
  issueTrackingToken,
  paymentDetails,
  safeString,
  verifyPayload,
};
