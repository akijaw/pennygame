import {
  COIN_PRICE,
  PAYMENT_POLL_MS,
  getCoinStudent,
  createPaymentRequest,
  getPaymentStatus,
  cancelPaymentRequest,
  requestReward,
} from "./coin-api.js";

const Penney = (window.Penney = window.Penney || {});

const $ = (id) => document.getElementById(id);

const gate = $("coinGate");
const els = {
  close: $("coinGateCloseBtn"),
  price: $("coinGatePrice"),
  payPrice: $("coinGatePayPrice"),
  login: $("coinGateLogin"),
  studentId: $("coinGateStudentId"),
  loginMsg: $("coinGateLoginMsg"),
  lookup: $("coinGateLookupBtn"),
  confirm: $("coinGateConfirm"),
  student: $("coinGateStudent"),
  confirmMsg: $("coinGateConfirmMsg"),
  pay: $("coinGatePayBtn"),
  back: $("coinGateBackBtn"),
  waiting: $("coinGateWaiting"),
  waitingMsg: $("coinGateWaitingMsg"),
  cancel: $("coinGateCancelBtn"),
  toast: $("coinToast"),
};

// 게이트에 필요한 DOM이 없으면(예: 다른 페이지) 조용히 비활성화 — 게임은 무료로 동작.
if (gate && els.studentId) {
  els.price.textContent = String(COIN_PRICE);
  els.payPrice.textContent = String(COIN_PRICE);

  let proceed = null;       // 결제 성공 시 게임으로 넘어가는 콜백
  let student = null;       // { studentId, name, balance }
  let trackingToken = null; // 승인 대기 중 결제 추적 토큰
  let gameToken = null;     // 승인된 게임 토큰(보상 검증용)
  let pollTimer = null;
  let busy = false;

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function showStep(step) {
    els.login.hidden = step !== "login";
    els.confirm.hidden = step !== "confirm";
    els.waiting.hidden = step !== "waiting";
  }

  function openGate(onSuccess) {
    proceed = onSuccess;
    student = null;
    trackingToken = null;
    busy = false;
    els.studentId.value = "";
    els.loginMsg.textContent = "";
    els.confirmMsg.textContent = "";
    els.confirmMsg.className = "coin-gate-msg";
    showStep("login");
    gate.classList.add("active");
    setTimeout(() => els.studentId.focus(), 50);
  }

  async function closeGate() {
    stopPoll();
    if (trackingToken) {
      const t = trackingToken;
      trackingToken = null;
      try { await cancelPaymentRequest(t); } catch { /* 무시 */ }
    }
    gate.classList.remove("active");
    proceed = null;
  }

  async function lookup() {
    if (busy) return;
    const id = els.studentId.value.trim();
    if (!/^\d{4}$/.test(id)) {
      els.loginMsg.textContent = "학번 4자리를 정확히 입력하세요.";
      return;
    }
    busy = true;
    els.lookup.disabled = true;
    els.loginMsg.textContent = "지갑 정보를 불러오는 중…";
    els.loginMsg.className = "coin-gate-msg ok";
    try {
      const data = await getCoinStudent(id);
      student = { studentId: data.studentId, name: data.name, balance: Number(data.balance) };
      els.student.innerHTML =
        `<div class="cg-name">${escapeHtml(student.name)} <span style="color:var(--paper-dim);font-weight:400;">(${escapeHtml(student.studentId)})</span></div>` +
        `<div class="cg-balance">보유 코인 <b>${student.balance.toLocaleString()}</b></div>`;
      const enough = student.balance >= COIN_PRICE;
      els.pay.disabled = !enough;
      els.confirmMsg.textContent = enough ? "" : `잔액이 부족해요. 참가비는 ${COIN_PRICE}코인입니다.`;
      els.confirmMsg.className = "coin-gate-msg";
      els.loginMsg.textContent = "";
      showStep("confirm");
    } catch (err) {
      els.loginMsg.textContent = err.message || "지갑 정보를 불러오지 못했습니다.";
      els.loginMsg.className = "coin-gate-msg";
    } finally {
      busy = false;
      els.lookup.disabled = false;
    }
  }

  async function pay() {
    if (busy || !student) return;
    busy = true;
    els.pay.disabled = true;
    els.confirmMsg.textContent = "결제 요청 중…";
    els.confirmMsg.className = "coin-gate-msg ok";
    try {
      const res = await createPaymentRequest(student.studentId, COIN_PRICE, "entry");
      if (res.status === "approved" && res.game_token) {
        approved(res.game_token);
        return;
      }
      trackingToken = res.tracking_token;
      if (!trackingToken) throw new Error("결제 추적 정보를 받지 못했습니다.");
      els.waitingMsg.textContent = "나플라스 앱에서 결제를 승인해주세요…";
      showStep("waiting");
      startPoll();
    } catch (err) {
      els.confirmMsg.textContent = err.message || "결제 요청에 실패했습니다.";
      els.confirmMsg.className = "coin-gate-msg";
      els.pay.disabled = false;
    } finally {
      busy = false;
    }
  }

  function startPoll() {
    stopPoll();
    pollTimer = setInterval(async () => {
      if (!trackingToken) { stopPoll(); return; }
      try {
        const res = await getPaymentStatus(trackingToken);
        if (res.status === "approved" && res.game_token) {
          stopPoll();
          approved(res.game_token);
        } else if (res.status === "rejected" || res.status === "canceled" || res.status === "expired") {
          stopPoll();
          trackingToken = null;
          els.confirmMsg.textContent = "결제가 완료되지 않았어요. 다시 시도해주세요.";
          els.confirmMsg.className = "coin-gate-msg";
          els.pay.disabled = false;
          showStep("confirm");
        }
      } catch (err) {
        stopPoll();
        trackingToken = null;
        els.confirmMsg.textContent = err.message || "결제 상태 확인에 실패했습니다.";
        els.confirmMsg.className = "coin-gate-msg";
        els.pay.disabled = false;
        showStep("confirm");
      }
    }, PAYMENT_POLL_MS);
  }

  function approved(token) {
    gameToken = token;
    trackingToken = null;
    stopPoll();
    gate.classList.remove("active");
    toast(`입장 완료! 즐거운 게임 되세요 🎴`);
    // 결제를 마친 학생 정보를 전역에 남겨 카드 순서 보기(peek-gate.js) 등
    // 다른 결제 흐름에서 학번을 다시 묻지 않고 재사용할 수 있게 한다.
    if (student) Penney.currentStudent = { studentId: student.studentId, name: student.name };
    const go = proceed;
    proceed = null;
    if (typeof go === "function") go();
  }

  async function cancel() {
    stopPoll();
    if (trackingToken) {
      const t = trackingToken;
      trackingToken = null;
      try { await cancelPaymentRequest(t); } catch { /* 무시 */ }
    }
    els.pay.disabled = false;
    els.confirmMsg.textContent = "결제를 취소했어요.";
    els.confirmMsg.className = "coin-gate-msg";
    showStep("confirm");
  }

  let toastTimer = null;
  function toast(html) {
    els.toast.innerHTML = html;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 3200);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // 이벤트 배선
  els.lookup.addEventListener("click", lookup);
  els.studentId.addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(); });
  els.studentId.addEventListener("input", () => {
    els.studentId.value = els.studentId.value.replace(/\D/g, "").slice(0, 4);
  });
  els.pay.addEventListener("click", pay);
  els.back.addEventListener("click", () => { els.loginMsg.textContent = ""; showStep("login"); setTimeout(() => els.studentId.focus(), 50); });
  els.cancel.addEventListener("click", cancel);
  els.close.addEventListener("click", closeGate);

  // 게임 훅 등록
  Penney.onEntryRequest = function (onSuccess) {
    openGate(onSuccess);
  };

  Penney.onGameResult = async function ({ rewardEligible }) {
    if (!rewardEligible || !gameToken) return;
    try {
      const res = await requestReward(gameToken, true);
      const amount = Number(res.amount) || 0;
      if (amount > 0) {
        toast(`AI 대결 승리 보상 <span class="ct-coin">+${amount.toLocaleString()} 코인</span> 획득!`);
      }
    } catch { /* 보상 실패는 게임 흐름을 막지 않음 */ }
  };
}
