const DEFAULT_BASE_URL = "https://naplace-coin.vercel.app/api/v1";
const FETCH_TIMEOUT_MS = 10000;

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} 환경변수가 없습니다.`);
  return value;
}

function baseUrl() {
  const raw = String(process.env.NAPLACE_COIN_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const parsed = new URL(raw);
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new Error("NAPLACE_COIN_BASE_URL은 HTTPS 주소여야 합니다.");
  }
  return raw;
}

async function naplaceFetch(path, options = {}) {
  if (!String(path || "").startsWith("/")) throw new Error("Naplace Coin API 경로가 올바르지 않습니다.");
  return fetch(`${baseUrl()}${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "X-API-Key": required("NAPLACE_COIN_API_KEY"),
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
}

module.exports = { naplaceFetch };
