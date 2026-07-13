const { json } = require("../_http");
const { naplaceFetch } = require("../_naplace");
const { enforceRateLimit } = require("../_security");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { message: "GET만 지원합니다." });
  if (!enforceRateLimit(req, res, "student-balance", 30, 60 * 1000)) return;
  try {
    const studentId = String(req.query.studentId || "").trim();
    if (!/^\d{4}$/.test(studentId)) return json(res, 400, { message: "올바른 4자리 학번을 입력하세요." });
    const response = await naplaceFetch(`/students/${encodeURIComponent(studentId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return json(res, response.status, { message: data.message || "학생 지갑 정보를 불러오지 못했습니다." });
    const student = data.student || data.data || data;
    const returnedId = String(student.id ?? student.student_id ?? "");
    const name = String(student.name || "").trim();
    const balance = Number(student.balance);
    if ((returnedId && returnedId !== studentId) || !name || !Number.isFinite(balance)) {
      return json(res, 502, { message: "결제 서버의 학생 정보 형식이 올바르지 않습니다." });
    }
    return json(res, 200, { studentId, name, balance: Math.trunc(balance) });
  } catch (error) {
    return json(res, 500, { message: error.message || "Naplace Coin 연결에 실패했습니다." });
  }
};
