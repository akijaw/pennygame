import {
  PEEK_PRICE_BASE,
  PAYMENT_POLL_MS,
  getCoinStudent,
  createPeekPayment,
  getPaymentStatus,
  cancelPaymentRequest,
} from "./coin-api.js";

const Penney = (window.Penney = window.Penney || {});

const $ = (id) => document.getElementById(id);

const gate = $("peekGate");
const els = {
  close: $("peekGateCloseBtn"),
  price: $("peekGatePrice"),
  payPrice: $("peekGatePayPrice"),
  login: $("peekGateLogin"),
  studentId: $("peekGateStudentId"),
  loginMsg: $("peekGateLoginMsg"),
  lookup: $("peekGateLookupBtn"),
  confirm: $("peekGateConfirm"),
  student: $("peekGateStudent"),
  confirmMsg: $("peekGateConfirmMsg"),
  pay: $("peekGatePayBtn"),
  back: $("peekGateBackBtn"),
  waiting: $("peekGateWaiting"),
  waitingMsg: $("peekGateWaitingMsg"),
  cancel: $("peekGateCancelBtn"),
  toast: $("coinToast"),
};

// game.js가 요금표(peekPriceForRemaining)를 계산할 때 쓸 기준값을 공유하고,
// 이미 그려둔 버튼 라벨을 실제 값으로 갱신한다.
Penney.PEEK_PRICE_BASE = PEEK_PRICE_BASE;
if (typeof Penney.refreshPeekPrice === "function") Penney.refreshPeekPrice();

// 게이트에 필요한 DOM이 없으면 조용히 비활성화 — 이 경우 game.js가 무료 미리보기로 대체한다.
if (gate && els.studentId) {
  let proceed = null;
  let student = null;
  let trackingToken = null;
  let pollTimer = null;
  let busy = false;
  let currentRemaining = 52;
  let currentPrice = PEEK_PRICE_BASE;

  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function showStep(step) {
    els.login.hidden = step !== "login";
    els.confirm.hidden = step !== "confirm";
    els.waiting.hidden = step !== "waiting";
  }

  function applyPriceLabels() {
    els.price.textContent = String(currentPrice);
    els.payPrice.textContent = String(currentPrice);
  }

  function openGate(remaining, price, onSuccess) {
    proceed = onSuccess;
    currentRemaining = remaining;
    currentPrice = price;
    trackingToken = null;
    busy = false;
    els.confirmMsg.textContent = "";
    els.confirmMsg.className = "coin-gate-msg";
    applyPriceLabels();
    gate.classList.add("active");

    // 입장할 때 이미 학번을 확인했다면 다시 묻지 않고 바로 확인 화면으로.
    const known = Penney.currentStudent;
    if (known && known.studentId) {
      student = { studentId: known.studentId, name: known.name, balance: null };
      showStep("confirm");
      refreshBalance();
    } else {
      els.studentId.value = "";
      els.loginMsg.textContent = "";
      showStep("login");
      setTimeout(() => els.studentId.focus(), 50);
    }
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

  async function refreshBalance() {
    if (!student) return;
    els.confirmMsg.textContent = "잔액 확인 중…";
    els.confirmMsg.className = "coin-gate-msg ok";
    try {
      const data = await getCoinStudent(student.studentId);
      student.balance = Number(data.balance);
      renderStudent();
    } catch (err) {
      els.confirmMsg.textContent = err.message || "지갑 정보를 불러오지 못했습니다.";
      els.confirmMsg.className = "coin-gate-msg";
      els.pay.disabled = true;
    }
  }

  function renderStudent() {
    els.student.innerHTML =
      `<div class="cg-name">${escapeHtml(student.name)} <span style="color:var(--paper-dim);font-weight:400;">(${escapeHtml(student.studentId)})</span></div>` +
      `<div class="cg-balance">보유 코인 <b>${Number(student.balance).toLocaleString()}</b></div>`;
    const enough = student.balance >= currentPrice;
    els.pay.disabled = !enough;
    els.confirmMsg.textContent = enough ? "" : `잔액이 부족해요. 지금은 ${currentPrice}코인이 필요해요.`;
    els.confirmMsg.className = "coin-gate-msg";
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
      renderStudent();
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
      // 실제 청구 금액은 서버가 remaining 값으로 다시 계산해서 확정한다.
      const res = await createPeekPayment(student.studentId, currentRemaining);
      if (res.status === "approved") {
        approved();
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
        if (res.status === "approved") {
          stopPoll();
          approved();
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

  function approved() {
    trackingToken = null;
    stopPoll();
    gate.classList.remove("active");
    toast(`카드 순서 공개 <span class="ct-coin">-${currentPrice.toLocaleString()} 코인</span>`);
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
    if (!els.toast) return;
    els.toast.innerHTML = html;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 3200);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  els.lookup.addEventListener("click", lookup);
  els.studentId.addEventListener("keydown", (e) => { if (e.key === "Enter") lookup(); });
  els.studentId.addEventListener("input", () => {
    els.studentId.value = els.studentId.value.replace(/\D/g, "").slice(0, 4);
  });
  els.pay.addEventListener("click", pay);
  els.back.addEventListener("click", () => {
    Penney.currentStudent = null; // 잘못된 학번이었을 수 있으니 재사용 캐시를 지운다
    els.loginMsg.textContent = "";
    showStep("login");
    setTimeout(() => els.studentId.focus(), 50);
  });
  els.cancel.addEventListener("click", cancel);
  els.close.addEventListener("click", closeGate);

  // 게임 훅 등록: game.js가 (remaining, price, onSuccess)로 호출한다.
  Penney.onPeekRequest = function (remaining, price, onSuccess) {
    openGate(remaining, price, onSuccess);
  };
}
