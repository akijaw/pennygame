(function () {
  "use strict";

  // 코인 결제 게이트(js/coin-gate.js)가 등록하는 훅. 없으면 결제 없이 그대로 진행.
  var Penney = (window.Penney = window.Penney || {});

  var SUITS_RED = ["♥", "♦"];
  var SUITS_BLACK = ["♠", "♣"];
  var RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  var PATTERNS = ["RRR","RRB","RBR","RBB","BRR","BRB","BBR","BBB"];
  var HOLD_INTERVAL = 200;      // 꾹 누를 때 카드 넘김 간격(ms)
  var TRICK_POP_HOLD = 650;     // 트릭 강조 시간
  var TRICK_COLLECT = 320;      // 트릭 카드 수거 애니메이션

  var state = {
    mode: "pve",       // "pve" | "pvp"
    stage: 1,
    pattern: [null, null, null],
    aiPattern: null,
    deck: [],
    revealed: [],
    segStart: 0,
    segSlots: [],
    playerTricks: 0,
    aiTricks: 0,
    busy: false,       // 트릭 연출 중 탭 잠금
    finished: false,
    holdTimer: null,
    primaryAction: null
  };

  var el = {
    topbar: document.getElementById("topbar"),
    playerBadge: document.getElementById("playerBadge"),
    aiBadge: document.getElementById("aiBadge"),
    playerChips: document.getElementById("playerChips"),
    aiChips: document.getElementById("aiChips"),
    stagePill: document.getElementById("stagePill"),
    selStageTag: document.getElementById("selStageTag"),
    selTitle: document.getElementById("selTitle"),
    selSub: document.getElementById("selSub"),
    ruleBox: document.getElementById("ruleBox"),
    aiFirstBox: document.getElementById("aiFirstBox"),
    aiFirstChips: document.getElementById("aiFirstChips"),
    slotBtns: Array.prototype.slice.call(document.querySelectorAll("#mainSlotRow .slot-btn")),
    pickWarn: document.getElementById("pickWarn"),
    pickBtn: document.getElementById("pickBtn"),
    peekBtn: document.getElementById("peekBtn"),
    peekBtnGame: document.getElementById("peekBtnGame"),
    deckPreviewOverlay: document.getElementById("deckPreviewOverlay"),
    peekTimer: document.getElementById("peekTimer"),
    peekPhaseLabel: document.getElementById("peekPhaseLabel"),
    peekGrid: document.getElementById("peekGrid"),
    peekEdit: document.getElementById("peekEdit"),
    peekSlotBtns: Array.prototype.slice.call(document.querySelectorAll("#peekSlotRow .slot-btn")),
    statusFlip: document.getElementById("statusFlip"),
    revealRow: document.getElementById("revealRow"),
    revealZone: document.querySelector(".reveal-zone"),
    deckBtn: document.getElementById("deckBtn"),
    deckCount: document.getElementById("deckCount"),
    scoreboard: document.getElementById("scoreboard"),
    sbPlayer: document.getElementById("sbPlayer"),
    sbAi: document.getElementById("sbAi"),
    opponentFrame: document.getElementById("opponentFrame"),
    opponentName: document.getElementById("opponentName"),
    playerLabel: document.getElementById("playerLabel"),
    aiLabel: document.getElementById("aiLabel"),
    sbPlayerLabel: document.getElementById("sbPlayerLabel"),
    sbAiLabel: document.getElementById("sbAiLabel"),
    screenHome: document.getElementById("screenHome"),
    homeTitle: document.getElementById("homeTitle"),
    homeStartBtn: document.getElementById("homeStartBtn"),
    screenSelect: document.getElementById("screenSelect"),
    screenGame: document.getElementById("screenGame"),
    resultModal: document.getElementById("resultModal"),
    resultTitle: document.getElementById("resultTitle"),
    resultScore: document.getElementById("resultScore"),
    resultSub: document.getElementById("resultSub"),
    resultPrimaryBtn: document.getElementById("resultPrimaryBtn"),
    homeBtn: document.getElementById("homeBtn"),
    coinAdModal: document.getElementById("coinAdModal"),
    coinAdCloseBtn: document.getElementById("coinAdCloseBtn"),
    coinAdOffer: document.getElementById("coinAdOffer"),
    coinAdBuyBtn: document.getElementById("coinAdBuyBtn"),
    coinAdReveal: document.getElementById("coinAdReveal"),
    coinAdRevealBody: document.getElementById("coinAdRevealBody"),
    coinAdRevealCloseBtn: document.getElementById("coinAdRevealCloseBtn"),
    muteBtn: document.getElementById("muteBtn"),
    coach: document.getElementById("coach"),
    coachText: document.getElementById("coachText"),
    reachFlash: document.getElementById("reachFlash"),
    resultCard: document.getElementById("resultCard")
  };

  /* ================= 코치 말풍선 (각 안내는 한 번씩만) ================= */
  var seenTips = {};
  var coachTimer = null;

  function coach(id, html, dur) {
    if (id && seenTips[id]) return;
    if (id) seenTips[id] = true;
    el.coachText.innerHTML = html;
    el.coach.classList.add("show");
    clearTimeout(coachTimer);
    coachTimer = setTimeout(function () {
      el.coach.classList.remove("show");
    }, dur || 4200);
  }

  function hideCoach() {
    clearTimeout(coachTimer);
    el.coach.classList.remove("show");
  }

  /* ================= 사운드 (외부 파일 없이 WebAudio) ================= */
  var Sfx = (function () {
    var ctx = null, master = null, bgmGain = null, muted = false;
    var bgmTimer = null, bgmPlaying = false, bgmChordIndex = 0;

    // 비장한 분위기의 안달루시아 카덴스 (Am - G - F - E) 루프.
    // 각 화음은 [저음부터] 세 음 + 한 옥타브 아래 서브 드론으로 재생.
    var BGM_CHORDS = [
      [110.00, 130.81, 164.81],  // Am
      [98.00,  123.47, 146.83],  // G
      [87.31,  110.00, 130.81],  // F
      [82.41,  103.83, 123.47]   // E (장3도 — 다음 Am으로 되돌아가는 긴장감)
    ];
    var BGM_CHORD_DUR = 3.6;

    function ensure() {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = 0.4;
        master.connect(ctx.destination);
        bgmGain = ctx.createGain();
        bgmGain.gain.value = muted ? 0 : 1;
        bgmGain.connect(master);
      }
      if (ctx.state === "suspended") ctx.resume();
      return !muted;
    }

    function tone(freq, type, gain, dur, when, freqEnd) {
      var t = ctx.currentTime + (when || 0);
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(master);
      osc.start(t); osc.stop(t + dur + 0.03);
    }

    function bgmPad(freqs, dur) {
      var t0 = ctx.currentTime;
      freqs.forEach(function (f) {
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.05, t0 + dur * 0.35);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g); g.connect(bgmGain);
        osc.start(t0); osc.stop(t0 + dur + 0.05);
      });
      // 한 옥타브 아래 서브 드론 (묵직하고 비장한 저음)
      var sub = ctx.createOscillator();
      var subG = ctx.createGain();
      sub.type = "sine";
      sub.frequency.value = freqs[0] / 2;
      subG.gain.setValueAtTime(0.0001, t0);
      subG.gain.exponentialRampToValueAtTime(0.075, t0 + dur * 0.45);
      subG.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      sub.connect(subG); subG.connect(bgmGain);
      sub.start(t0); sub.stop(t0 + dur + 0.05);
    }

    function bgmLoop() {
      if (!bgmPlaying) return;
      bgmPad(BGM_CHORDS[bgmChordIndex], BGM_CHORD_DUR);
      bgmChordIndex = (bgmChordIndex + 1) % BGM_CHORDS.length;
      bgmTimer = setTimeout(bgmLoop, BGM_CHORD_DUR * 1000);
    }

    return {
      toggle: function () {
        muted = !muted;
        if (bgmGain) bgmGain.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
        return muted;
      },
      startBgm: function () {
        ensure();
        if (bgmPlaying) return;
        bgmPlaying = true;
        bgmChordIndex = 0;
        bgmLoop();
      },
      stopBgm: function () {
        bgmPlaying = false;
        if (bgmTimer) { clearTimeout(bgmTimer); bgmTimer = null; }
      },
      flip: function () {
        if (!ensure()) return;
        tone(900, "triangle", 0.12, 0.06, 0, 500);
      },
      trickPlayer: function () {
        if (!ensure()) return;
        tone(523.25, "triangle", 0.28, 0.16);
        tone(783.99, "triangle", 0.28, 0.22, 0.09);
      },
      trickAi: function () {
        if (!ensure()) return;
        tone(140, "sawtooth", 0.3, 0.22, 0, 70);
      },
      reach: function () {
        if (!ensure()) return;
        tone(660, "sine", 0.1, 0.1);
      },
      coin: function () {
        if (!ensure()) return;
        tone(1046.5, "sine", 0.22, 0.09, 0);
        tone(1568, "sine", 0.22, 0.16, 0.08);
      },
      win: function () {
        if (!ensure()) return;
        [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
          tone(f, "triangle", 0.3, 0.45, i * 0.12);
        });
      },
      lose: function () {
        if (!ensure()) return;
        tone(160, "sawtooth", 0.32, 1.1, 0, 40);
      }
    };
  })();

  el.muteBtn.addEventListener("click", function () {
    var m = Sfx.toggle();
    el.muteBtn.textContent = m ? "🔇" : "🔊";
  });

  el.homeStartBtn.addEventListener("click", function () {
    Sfx.flip();
    function proceed() {
      Sfx.startBgm();
      state.mode = "pve";
      state.stage = 1;
      setupSelect();
    }
    // 참가비 결제 게이트가 있으면 결제 성공 후에만 입장. 없으면(오프라인 등) 바로 입장.
    if (typeof Penney.onEntryRequest === "function") {
      Penney.onEntryRequest(proceed);
    } else {
      proceed();
    }
  });

  /* ================= 연출 헬퍼: 스파크 / 뱃지 임팩트 / 컨페티 ================= */
  function spawnDeckSpark() {
    var rect = el.deckBtn.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    for (var i = 0; i < 6; i++) {
      var s = document.createElement("div");
      s.className = "spark";
      var angle = Math.random() * Math.PI * 2;
      var dist = 26 + Math.random() * 24;
      s.style.left = cx + "px";
      s.style.top = cy + "px";
      s.style.setProperty("--sx", (Math.cos(angle) * dist) + "px");
      s.style.setProperty("--sy", (Math.sin(angle) * dist) + "px");
      document.body.appendChild(s);
      (function (node) { setTimeout(function () { node.remove(); }, 480); })(s);
    }
  }

  function spawnBadgeBurst(side) {
    var badge = side === "player" ? el.playerBadge : el.aiBadge;
    var ring = document.createElement("div");
    ring.className = "impact-ring";
    badge.appendChild(ring);
    setTimeout(function () { ring.remove(); }, 560);

    var pop = document.createElement("div");
    pop.className = "score-pop" + (side === "player" ? " player" : "");
    pop.textContent = "+1";
    badge.appendChild(pop);
    setTimeout(function () { pop.remove(); }, 760);
  }

  function flashReach(side) {
    el.reachFlash.classList.remove("show", "ai");
    void el.reachFlash.offsetWidth;
    if (side === "ai") el.reachFlash.classList.add("ai");
    el.reachFlash.classList.add("show");
    setTimeout(function () { el.reachFlash.classList.remove("show"); }, 620);
  }

  function spawnConfetti() {
    var colors = ["#f0d576", "#8e2734", "#7ddb8a", "#f6efdd", "#d4af37"];
    for (var i = 0; i < 30; i++) {
      var c = document.createElement("div");
      c.className = "confetti-piece";
      c.style.left = (Math.random() * 100) + "vw";
      c.style.background = colors[Math.floor(Math.random() * colors.length)];
      c.style.animationDuration = (1.6 + Math.random() * 1.1) + "s";
      c.style.animationDelay = (Math.random() * 0.3) + "s";
      document.body.appendChild(c);
      (function (node) { setTimeout(function () { node.remove(); }, 3200); })(c);
    }
  }

  /* ================= 유틸 ================= */
  function opp(c) { return c === "R" ? "B" : "R"; }

  // 콘웨이 알고리즘: 상대 패턴에 대한 최적 카운터
  function counterOf(p) { return [opp(p[1]), p[0], p[1]]; }

  function displayName(side) {
    return side === "player" ? "플레이어" : "나플라스 AI";
  }

  function buildDeck() {
    var deck = [];
    SUITS_RED.forEach(function (suit) {
      RANKS.forEach(function (rank) { deck.push({ rank: rank, suit: suit, color: "red" }); });
    });
    SUITS_BLACK.forEach(function (suit) {
      RANKS.forEach(function (rank) { deck.push({ rank: rank, suit: suit, color: "black" }); });
    });
    return deck;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function renderChips(container, pattern) {
    container.innerHTML = "";
    pattern.forEach(function (c) {
      var chip = document.createElement("span");
      chip.className = "chip " + (c ? c : "empty");
      container.appendChild(chip);
    });
  }

  function setStatus(text) {
    el.statusFlip.innerHTML = "";
    text.split("").forEach(function (ch, i) {
      var span = document.createElement("span");
      span.className = "letter";
      span.style.animationDelay = (i * 0.02) + "s";
      span.textContent = ch === " " ? " " : ch;
      el.statusFlip.appendChild(span);
    });
  }

  function showScreen(id) {
    [el.screenHome, el.screenSelect, el.screenGame].forEach(function (s) {
      if (s) s.classList.toggle("active", s.id === id);
    });
    el.scoreboard.classList.toggle("active", id === "screenGame");
    // 홈 / 패턴 선택 화면에서는 상단 플레이어·AI 배지를 숨긴다
    el.topbar.classList.toggle("hidden", id === "screenHome");
  }

  /* ================= 패턴 진행도 (실시간 매칭 표시) ================= */
  function progressFor(patternArr) {
    if (!patternArr) return 0;
    var seg = "";
    for (var i = state.segStart; i < state.revealed.length; i++) {
      seg += state.revealed[i].color === "red" ? "R" : "B";
    }
    var pat = patternArr.join("");
    for (var l = 2; l >= 1; l--) {
      if (seg.length >= l && seg.slice(-l) === pat.slice(0, l)) return l;
    }
    return 0;
  }

  function updateProgressChips() {
    var pk = progressFor(state.pattern);
    var ak = progressFor(state.aiPattern);
    applyProgress(el.playerChips, el.playerBadge, pk);
    applyProgress(el.aiChips, el.aiBadge, ak);
    if (pk === 2 || ak === 2) {
      Sfx.reach();
      if (pk === 2 && ak === 2) {
        flashReach("both");
        coach("reach", "양쪽 다 <b>리치</b>! 다음 카드 한 장에 점수가 걸렸어요");
      } else if (pk === 2) {
        flashReach("player");
        coach("reach", "<b>리치</b>! 다음 카드가 맞으면 당신의 1점!");
      } else {
        flashReach("ai");
        coach("reach", "AI가 <b>리치</b>... 다음 카드가 맞으면 AI의 1점!");
      }
    }
  }

  function applyProgress(container, badge, k) {
    var chips = container.children;
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle("lit", i < k);
    }
    badge.classList.toggle("reach", k === 2);
  }

  function clearProgress() {
    applyProgress(el.playerChips, el.playerBadge, 0);
    applyProgress(el.aiChips, el.aiBadge, 0);
  }

  /* ================= 선택 화면 구성 ================= */
  function setupSelect() {
    state.pattern = [null, null, null];
    state.finished = false;
    el.slotBtns.forEach(function (btn) {
      btn.textContent = "?";
      btn.className = "slot-btn";
    });
    el.pickWarn.textContent = "";
    el.playerBadge.classList.remove("tracking", "reach");
    el.aiBadge.classList.remove("tracking", "reach");
    hideCoach();

    // 라벨 갱신
    el.playerLabel.textContent = displayName("player");
    el.aiLabel.textContent = displayName("ai");
    el.opponentName.textContent = displayName("ai");
    el.opponentFrame.textContent = "🏺";
    el.sbPlayerLabel.textContent = displayName("player");
    el.sbAiLabel.textContent = displayName("ai");

    seenTips = {}; // 새 게임 = 안내 초기화
    state.aiPattern = null;
    // 패턴을 고르기 전에 미리 덱을 섞어둔다 — "카드 순서 보기"가 실제 순서를 보여줄 수 있도록.
    state.deck = shuffle(buildDeck());
    updatePeekButtons();
    el.stagePill.textContent = "나플라스 AI 대결";
    el.selStageTag.textContent = "나플라스 AI 대결";
    el.selTitle.textContent = "페니의 게임";
    el.selSub.textContent = "빨강/검정 3연속 패턴을 고르고 나플라스 AI에 도전하세요";
    el.ruleBox.hidden = false;
    el.aiFirstBox.hidden = true;
    renderChips(el.aiChips, [null, null, null]);

    renderChips(el.playerChips, [null, null, null]);
    updatePickBtnState();
    showScreen("screenSelect");
  }

  // 코인 광고를 "구매"했을 때 보여줄 실제 비법 + 예시를 만든다.
  // 2P 화면(state.stage===2)에서는 실제 1P 패턴으로, 그 외(1P 화면)에서는
  // 아직 상대 패턴이 없으므로 예시용 가상 패턴으로 보여준다.
  function buildCoinAdReveal() {
    var body = el.coinAdRevealBody;
    body.innerHTML = "";

    function chipEl(c, answer) {
      var s = document.createElement("span");
      s.className = "chip " + c + (answer ? " answer" : "");
      return s;
    }
    function formulaRow(label, colors, highlightFirst) {
      var row = document.createElement("div");
      row.className = "coin-ad-formula-row";
      var lbl = document.createElement("span");
      lbl.className = "cf-label";
      lbl.textContent = label;
      row.appendChild(lbl);
      colors.forEach(function (c, i) {
        row.appendChild(chipEl(c, !!(highlightFirst && i === 0)));
      });
      return row;
    }

    var explain = document.createElement("p");
    explain.className = "coin-ad-reveal-text";
    explain.innerHTML =
      "<b>나중에 고르는 사람이 항상 유리</b>해요.<br>" +
      "상대 패턴의 <b>앞 두 색을 그대로 뒤에 붙이고</b>,<br>" +
      "상대 패턴의 <b>가운데 색은 반대로 뒤집어서 맨 앞에</b> 붙이면 돼요.";
    body.appendChild(explain);

    var isPvpStage2 = state.mode === "pvp" && state.stage === 2 && state.aiPattern;
    var sample = isPvpStage2 ? state.aiPattern : ["R", "R", "B"];
    var counter = counterOf(sample);

    var exampleWrap = document.createElement("div");
    exampleWrap.className = "coin-ad-example";

    var exLabel = document.createElement("div");
    exLabel.className = "coin-ad-example-label";
    exLabel.innerHTML = isPvpStage2
      ? "지금 <b>플레이어 1</b>이 고른 패턴으로 예를 들면:"
      : "예를 들어 상대가 <b>이런 패턴</b>을 골랐다면:";
    exampleWrap.appendChild(exLabel);

    var formula = document.createElement("div");
    formula.className = "coin-ad-formula";
    formula.appendChild(formulaRow("상대", sample, false));

    var arrowRow = document.createElement("div");
    arrowRow.className = "coin-ad-formula-arrow";
    arrowRow.textContent = "↓";
    formula.appendChild(arrowRow);

    formula.appendChild(formulaRow("추천", counter, true));
    exampleWrap.appendChild(formula);

    body.appendChild(exampleWrap);

    if (!isPvpStage2) {
      var note = document.createElement("p");
      note.className = "coin-ad-reveal-note";
      note.innerHTML = "지금은 <b>1P가 먼저</b> 고르는 차례라 아직 써먹을 수 없어요 — 2P 차례가 되면 실제 패턴으로 다시 볼 수 있어요!";
      body.appendChild(note);
    }
  }

  function updatePickBtnState() {
    var complete = state.pattern.every(function (c) { return c !== null; });
    el.pickWarn.textContent = "";
    el.pickBtn.disabled = !complete;
    el.pickBtn.textContent = complete ? "대결 시작!" : "패턴을 모두 선택하세요";
  }

  el.slotBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var slot = parseInt(btn.getAttribute("data-slot"), 10);
      var current = state.pattern[slot];
      var next = current === null ? "R" : (current === "R" ? "B" : "R");
      state.pattern[slot] = next;
      btn.textContent = next;
      btn.className = "slot-btn " + next + " active";
      renderChips(el.playerChips, state.pattern);
      updatePickBtnState();
    });
  });

  el.pickBtn.addEventListener("click", function () {
    if (el.pickBtn.disabled) return;
    Sfx.flip();

    if (state.stage === 1) {
      // AI가 즉시 카운터를 계산 — 짧은 셔플 연출(1초)만 하고 시작
      state.aiPattern = counterOf(state.pattern);
      var flicks = 0;
      setStatus("나플라스 AI가 패턴을 고르는 중...");
      showScreen("screenGame");
      el.scoreboard.classList.remove("active");
      var flicker = setInterval(function () {
        var fake = [
          Math.random() < 0.5 ? "R" : "B",
          Math.random() < 0.5 ? "R" : "B",
          Math.random() < 0.5 ? "R" : "B"
        ];
        renderChips(el.aiChips, fake);
        flicks++;
        if (flicks >= 7) {
          clearInterval(flicker);
          renderChips(el.aiChips, state.aiPattern);
          startRound();
        }
      }, 130);
    } else {
      startRound();
    }
  });

  /* ================= 카드 순서 보기 (코인, 남은 장수에 따라 가격 상승) ================= */
  // 서버(api/coin/payment-requests.js)의 계산식과 반드시 동일하게 유지할 것.
  function peekPriceForRemaining(remaining) {
    var base = (window.Penney && Penney.PEEK_PRICE_BASE) || 30;
    var r = Math.max(0, Math.min(52, remaining));
    var mult;
    if (r > 40) mult = 1;
    else if (r > 20) mult = 2;
    else if (r > 8) mult = 4;
    else mult = 8;
    return base * mult;
  }

  function currentPeekPrice() {
    var remaining = state.deck ? state.deck.length : 52;
    return peekPriceForRemaining(remaining);
  }

  function updatePeekButtons() {
    var price = currentPeekPrice();
    var locked = state.busy || state.finished || !state.deck || state.deck.length === 0;
    [el.peekBtn, el.peekBtnGame].forEach(function (btn) {
      if (!btn) return;
      btn.disabled = locked;
      var priceEl = btn.querySelector(".pk-price");
      if (priceEl) priceEl.textContent = price + "코인";
    });
  }

  function handlePeekClick() {
    if ((el.peekBtn && el.peekBtn.disabled) || (el.peekBtnGame && el.peekBtnGame.disabled)) return;
    if (!state.deck || state.deck.length === 0) return;
    var remaining = state.deck.length;
    var price = peekPriceForRemaining(remaining);
    if (typeof Penney.onPeekRequest === "function") {
      Penney.onPeekRequest(remaining, price, function () { showDeckPreview(); });
    } else {
      // 결제 게이트가 없는 환경(로컬 미리보기 등)에서는 무료로 바로 보여준다.
      showDeckPreview();
    }
  }

  if (el.peekBtn) el.peekBtn.addEventListener("click", handlePeekClick);
  if (el.peekBtnGame) el.peekBtnGame.addEventListener("click", handlePeekClick);

  // pve 전용: 사람이 고른 패턴은 항상 state.pattern에 들어있다.
  function myPatternKey() {
    return "pattern";
  }

  function renderPeekSlots(key) {
    var pat = state[key] || [null, null, null];
    el.peekSlotBtns.forEach(function (btn) {
      var slot = parseInt(btn.getAttribute("data-slot"), 10);
      var c = pat[slot];
      btn.textContent = c || "?";
      btn.className = "slot-btn " + (c ? c + " active" : "");
    });
  }

  var peekEditKey = null;
  el.peekSlotBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (!peekEditKey) return;
      var slot = parseInt(btn.getAttribute("data-slot"), 10);
      var pat = state[peekEditKey];
      var next = pat[slot] === "R" ? "B" : "R";
      pat[slot] = next;
      btn.textContent = next;
      btn.className = "slot-btn " + next + " active";
    });
  });

  function showDeckPreview() {
    if (!el.deckPreviewOverlay || !state.deck || state.deck.length === 0) return;
    updatePeekButtons(); // 결제 중/직후 잠깐 잠금
    [el.peekBtn, el.peekBtnGame].forEach(function (btn) { if (btn) btn.disabled = true; });
    Sfx.coin();

    el.peekGrid.innerHTML = "";
    state.deck.forEach(function (card) {
      var chip = document.createElement("span");
      chip.className = "chip " + (card.color === "red" ? "R" : "B");
      el.peekGrid.appendChild(chip);
    });
    el.peekGrid.hidden = false;

    // 카드가 이미 넘어가고 있는 중(게임 화면)이면 그 자리에서 패턴을 바로 바꿀 수 있게 해준다.
    var midRound = el.screenGame.classList.contains("active") && !!el.peekEdit;
    peekEditKey = midRound ? myPatternKey() : null;
    if (el.peekEdit) el.peekEdit.hidden = true; // 1단계(보기)에서는 항상 숨김 — 보면서 수정 못 하게

    el.deckPreviewOverlay.classList.add("active");
    runViewPhase();
  }

  // 1단계: 카드 배치만 5초간 보여주고, 수정은 못 하게 막는다.
  function runViewPhase() {
    var secondsLeft = 5;
    if (el.peekPhaseLabel) el.peekPhaseLabel.textContent = "카드 순서를 기억하세요";
    el.peekTimer.textContent = String(secondsLeft);
    var ticker = setInterval(function () {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        clearInterval(ticker);
        if (peekEditKey) {
          runEditPhase();
        } else {
          closePreview();
        }
        return;
      }
      el.peekTimer.textContent = String(secondsLeft);
    }, 1000);
  }

  // 2단계: 카드 배치를 완전히 가리고, 3초간만 패턴 수정을 허용한다.
  function runEditPhase() {
    el.peekGrid.hidden = true;
    renderPeekSlots(peekEditKey);
    el.peekEdit.hidden = false;
    if (el.peekPhaseLabel) el.peekPhaseLabel.textContent = "지금 패턴을 바꾸세요! (카드는 더 안 보여요)";

    var secondsLeft = 3;
    el.peekTimer.textContent = String(secondsLeft);
    var ticker = setInterval(function () {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        clearInterval(ticker);
        closePreview();
        return;
      }
      el.peekTimer.textContent = String(secondsLeft);
    }, 1000);
  }

  function closePreview() {
    el.deckPreviewOverlay.classList.remove("active");
    el.peekGrid.hidden = false;
    if (el.peekEdit) el.peekEdit.hidden = true;
    updatePeekButtons();
    if (peekEditKey) {
      // 바뀐 패턴을 화면(칩/진행도)에 반영
      renderChips(el.playerChips, state.pattern);
      renderChips(el.aiChips, state.aiPattern);
      updateProgressChips();
      peekEditKey = null;
      coach("peekEdited", "패턴이 바뀌었어요! 다음 카드부터 새 패턴으로 판정돼요.", 4200);
    } else {
      coach("peekDone", "이제 패턴을 자유롭게 바꿀 수 있어요 — 방금 본 순서로 계산해보세요!", 4200);
    }
  }

  /* ================= 라운드 ================= */
  function startRound() {
    if (!state.deck || state.deck.length !== 52) state.deck = shuffle(buildDeck());
    state.revealed = [];
    state.segStart = 0;
    state.segSlots = [];
    state.playerTricks = 0;
    state.aiTricks = 0;
    state.busy = false;
    state.finished = false;

    el.revealRow.innerHTML = "";
    el.revealRow.style.transform = "translateX(0)";
    el.deckBtn.classList.remove("empty");
    el.deckBtn.classList.add("idle");
    el.deckCount.textContent = "52장 남음";
    el.playerBadge.classList.add("tracking");
    el.aiBadge.classList.add("tracking");
    renderChips(el.playerChips, state.pattern);
    renderChips(el.aiChips, state.aiPattern);
    clearProgress();
    updateTrickScore();
    el.scoreboard.classList.add("active");
    setStatus("덱을 탭해서 카드를 넘기세요!");
    showScreen("screenGame");
  }

  function updateTrickScore(bumpSide) {
    el.sbPlayer.textContent = state.playerTricks;
    el.sbAi.textContent = state.aiTricks;
    if (bumpSide === "player") {
      el.sbPlayer.classList.remove("bump");
      void el.sbPlayer.offsetWidth;
      el.sbPlayer.classList.add("bump");
    } else if (bumpSide === "ai") {
      el.sbAi.classList.remove("bump");
      void el.sbAi.offsetWidth;
      el.sbAi.classList.add("bump");
    }
  }

  function scrollRevealRow() {
    var zoneWidth = el.revealZone.clientWidth;
    var naturalWidth = el.revealRow.scrollWidth;
    var overflow = naturalWidth - zoneWidth;
    el.revealRow.style.transform = "translateX(" + (overflow > 0 ? -overflow : 0) + "px)";
  }

  function checkTrick() {
    var n = state.revealed.length;
    if (n - state.segStart < 3) return null;
    var last3 = state.revealed.slice(n - 3).map(function (c) { return c.color === "red" ? "R" : "B"; }).join("");
    if (last3 === state.pattern.join("")) return "player";
    if (last3 === state.aiPattern.join("")) return "ai";
    return null;
  }

  function flipCard() {
    if (state.busy || state.finished || state.deck.length === 0) return;

    el.deckBtn.classList.remove("idle");
    spawnDeckSpark();
    var card = state.deck.shift();
    state.revealed.push(card);
    el.deckCount.textContent = state.deck.length + "장 남음";
    if (state.deck.length === 0) el.deckBtn.classList.add("empty");
    updatePeekButtons();

    if (state.revealed.length === 1 && state.stage === 1) {
      coach("goal", "나온 카드 색이 패턴과 맞으면 위의 <b>칩이 빛나요</b>. 3연속 완성 = <b>1점</b>!");
    } else if (state.deck.length === 26) {
      coach("half", "절반 지점! 덱이 끝났을 때 <b>점수가 높은 쪽</b>이 최종 승리예요");
    }

    Sfx.flip();

    var slot = document.createElement("div");
    slot.className = "card-slot";
    var inner = document.createElement("div");
    inner.className = "card-inner";

    var back = document.createElement("div");
    back.className = "card-face back";

    var front = document.createElement("div");
    front.className = "card-face front " + card.color;
    var corner = document.createElement("div");
    corner.className = "corner";
    corner.innerHTML = card.rank + "<br>" + card.suit;
    front.appendChild(corner);
    var center = document.createElement("span");
    center.textContent = card.suit;
    front.appendChild(center);

    inner.appendChild(back);
    inner.appendChild(front);
    slot.appendChild(inner);
    el.revealRow.appendChild(slot);
    state.segSlots.push(slot);

    scrollRevealRow();

    el.opponentFrame.classList.remove("shake");
    void el.opponentFrame.offsetWidth;
    el.opponentFrame.classList.add("shake");

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { slot.classList.add("flipped", "punch"); });
    });

    var trick = checkTrick();
    if (trick) {
      collectTrick(trick);
    } else {
      updateProgressChips();
      if (state.deck.length === 0) {
        setTimeout(finishRound, 700);
      }
    }
  }

  function collectTrick(trick) {
    state.busy = true;
    updatePeekButtons();
    stopHold();

    var trickClass = trick === "player" ? "trick-player" : "trick-ai";
    var slots = state.segSlots;

    state.segStart = state.revealed.length;
    state.segSlots = [];

    if (trick === "player") { state.playerTricks++; Sfx.trickPlayer(); }
    else { state.aiTricks++; Sfx.trickAi(); }
    updateTrickScore(trick);
    spawnBadgeBurst(trick);
    setStatus("🎉 " + displayName(trick) + " 트릭 획득!");
    if (trick === "player") {
      coach("trick_p", "🎉 패턴 3연속 완성 = <b>1점</b>! 쌓인 카드는 치우고 <b>처음부터 다시</b> 세요");
    } else {
      coach("trick_a", "AI 패턴이 먼저 완성돼 <b>AI가 1점</b>. 카드를 치우고 새로 시작 — 아직 기회 많아요!");
    }
    clearProgress();

    el.revealZone.classList.add("popping");
    slots.forEach(function (s) { s.classList.add(trickClass, "trick-pop"); });

    var flyClass = trick === "player" ? "collect-player" : "collect-ai";
    setTimeout(function () {
      slots.forEach(function (s) { s.classList.add(flyClass); });
      setTimeout(function () {
        slots.forEach(function (s) { s.remove(); });
        el.revealZone.classList.remove("popping");
        scrollRevealRow();
        state.busy = false;
        updatePeekButtons();
        if (state.deck.length === 0) {
          setTimeout(finishRound, 400);
        } else {
          setStatus("계속 탭하세요!");
        }
      }, TRICK_COLLECT);
    }, TRICK_POP_HOLD);
  }

  /* --- 덱 입력: 탭 + 꾹 누르면 연속 --- */
  function stopHold() {
    if (state.holdTimer) { clearInterval(state.holdTimer); state.holdTimer = null; }
  }

  el.deckBtn.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    flipCard();
    stopHold();
    state.holdTimer = setInterval(flipCard, HOLD_INTERVAL);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) {
    el.deckBtn.addEventListener(ev, stopHold);
  });
  el.deckBtn.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  document.addEventListener("keydown", function (e) {
    if ((e.code === "Space" || e.code === "Enter") && el.screenGame.classList.contains("active")) {
      e.preventDefault();
      flipCard();
    }
  });

  /* ================= 결과 ================= */
  function finishRound() {
    if (state.finished) return;
    state.finished = true;
    updatePeekButtons();
    stopHold();

    var p = state.playerTricks, a = state.aiTricks;
    var scoreText = "트릭 스코어  " + p + " : " + a + "  (" + displayName("player") + " : " + displayName("ai") + ")";
    var winner = p > a ? "player" : (a > p ? "ai" : "draw");
    var rewardEligible = winner === "player";

    el.resultScore.textContent = scoreText;

    // 결과를 코인 게이트에 알림 (승리 시 보상 지급 트리거)
    if (typeof Penney.onGameResult === "function") {
      Penney.onGameResult({ mode: state.mode, winner: winner, rewardEligible: rewardEligible });
    }

    if (winner === "ai") {
      setResult("lose", "나플라스 AI 승리",
        "사실 이 게임엔 <b>수학적인 비밀</b>이 있어요 — 나중에 패턴을 정하는 쪽이 유리하답니다.<br>다시 도전해 보세요!",
        "다시 하기", false);
      Sfx.lose();
    } else if (winner === "player") {
      setResult("win", "플레이어 승리!",
        "확률상 불리한 게임에서 이겼어요, 대단한 행운입니다!<br>한 번 더 해볼까요?",
        "다시 하기", true);
      Sfx.win();
    } else {
      setResult("", "무승부",
        "아슬아슬했네요! 다시 붙어볼까요?",
        "다시 하기", false);
    }
    state.primaryAction = function () { state.stage = 1; setupSelect(); };

    el.resultCard.classList.remove("lose-shake");
    if (winner === "ai") el.resultCard.classList.add("lose-shake");

    setTimeout(function () {
      el.resultModal.classList.add("active");
      if (winner === "player") spawnConfetti();
    }, 500);
  }

  function setResult(titleClass, titleText, subHtml, btnText, gold) {
    el.resultTitle.className = "result-title " + titleClass;
    typeResult(el.resultTitle, titleText);
    el.resultSub.innerHTML = subHtml;
    el.resultPrimaryBtn.textContent = btnText;
    el.resultPrimaryBtn.classList.toggle("gold", !!gold);
  }

  function typeResult(container, text) {
    container.innerHTML = "";
    text.split("").forEach(function (ch, i) {
      var span = document.createElement("span");
      span.className = "letter";
      span.style.animationDelay = (i * 0.04) + "s";
      span.textContent = ch === " " ? " " : ch;
      container.appendChild(span);
    });
  }

  el.resultPrimaryBtn.addEventListener("click", function () {
    el.resultModal.classList.remove("active");
    if (state.primaryAction) state.primaryAction();
  });

  el.homeBtn.addEventListener("click", function () {
    Sfx.flip();
    el.resultModal.classList.remove("active");
    showScreen("screenHome");
  });

  el.coinAdCloseBtn.addEventListener("click", function () {
    Sfx.flip();
    el.coinAdModal.classList.remove("active");
  });

  el.coinAdBuyBtn.addEventListener("click", function () {
    Sfx.coin();
    buildCoinAdReveal();
    el.coinAdOffer.hidden = true;
    el.coinAdReveal.hidden = false;
  });

  el.coinAdRevealCloseBtn.addEventListener("click", function () {
    Sfx.flip();
    el.coinAdModal.classList.remove("active");
  });

  window.addEventListener("resize", scrollRevealRow);

  /* dust motes */
  (function spawnDust() {
    for (var i = 0; i < 10; i++) {
      var d = document.createElement("div");
      d.className = "dust";
      var size = 2 + Math.random() * 3;
      d.style.width = size + "px";
      d.style.height = size + "px";
      d.style.left = (Math.random() * 100) + "vw";
      d.style.bottom = "-10px";
      d.style.animationDuration = (10 + Math.random() * 10) + "s";
      d.style.animationDelay = (Math.random() * 10) + "s";
      document.body.appendChild(d);
    }
  })();

  el.homeTitle.textContent = "페니의 게임";
  showScreen("screenHome");
  Penney.refreshPeekPrice = updatePeekButtons;
  updatePeekButtons();
})();
