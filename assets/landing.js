// The landing page keeps behavior in one external file so its CSP
// can reject inline scripts.
(function () {
  // The signature product proof is checked-in HTML, not a JavaScript rewrite.
  // This marker lets browser checks distinguish a complete first fold while the
  // same proof remains present when scripts are disabled or slow to execute.
  var panel = document.querySelector(".lp-preview .lp-panel[data-hero-product-proof]");
  if (panel) {
    document.documentElement.setAttribute("data-hero-product-proof", "ready");
  }

  var footerScope = document.getElementById("lp-footer-scope");
  if (footerScope) {
    footerScope.textContent = "The sample opens in Work and stays in this browser.";
  }
})();

// Visible WebMCP handoff replay: Observe → Narrow → Prepare → Decide.
(function () {
  var btn = document.getElementById("replay-play");
  var demo = document.getElementById("replay-demo");
  var stageLabel = document.getElementById("replay-stage-label");
  var steps = document.querySelectorAll(".lp-replay-step");
  var note = document.getElementById("replay-note");
  var views = demo ? demo.querySelectorAll("[data-replay-view]") : [];
  var progress = demo ? demo.querySelectorAll("[data-replay-progress]") : [];
  if (document.documentElement.getAttribute("data-hero-product-proof") !== "ready" || !btn || !demo || !steps.length || steps.length !== views.length) return;

  var STEP_MS = 2200;
  var DEFAULT_NOTE = "Press play — four steps, about ten seconds. No account, no setup.";
  var timer = null;
  var index = 0;
  var stateNames = ["observe", "narrow", "prepare", "decide"];
  var stageNames = ["Observe · 1 of 4", "Narrow · 2 of 4", "Prepare · 3 of 4", "Decide · 4 of 4"];
  var stateLabels = [
    "Observe: the agent reads eight visible work items and identifies a blocked client handoff.",
    "Narrow: the agent shows two relevant items out of eight while the workspace remains unchanged.",
    "Prepare: the agent cites the blocked workflow and blocker, then proposes an unsaved next action.",
    "Decide: the agent stops before Save and leaves Discard draft or Approve and save to the person."
  ];
  var stepNotes = [
    "Observed the exact visible queue — a client handoff is blocked while details are pending.",
    "Narrowed Work and Review to the relevant items — the denominators stay visible and workspace data is unchanged.",
    "Prepared a next action from verified workspace facts — the draft is still unsaved.",
    "Decision stays with the person — approve and save the draft, edit it, or discard it."
  ];

  function clearAll() {
    for (var i = 0; i < steps.length; i++) {
      steps[i].classList.remove("is-on");
      steps[i].removeAttribute("aria-current");
      steps[i].setAttribute("aria-pressed", "false");
    }
    for (var j = 0; j < views.length; j++) {
      views[j].classList.remove("is-active");
    }
    for (var k = 0; k < progress.length; k++) {
      progress[k].classList.remove("is-current", "is-complete");
    }
  }

  function setNote(text) {
    if (note) note.textContent = text;
  }

  function selectStep(nextIndex) {
    if (nextIndex < 0 || nextIndex >= steps.length) return;
    clearAll();
    index = nextIndex;
    steps[index].classList.add("is-on");
    steps[index].setAttribute("aria-current", "step");
    steps[index].setAttribute("aria-pressed", "true");
    views[index].classList.add("is-active");
    demo.setAttribute("data-replay-state", stateNames[index]);
    demo.setAttribute("aria-label", stateLabels[index]);
    if (stageLabel) stageLabel.textContent = stageNames[index];
    for (var i = 0; i < progress.length; i++) {
      if (i < index) progress[i].classList.add("is-complete");
      if (i === index) progress[i].classList.add("is-current");
    }
    if (index < stepNotes.length) setNote(stepNotes[index]);
  }

  function advance(wrap) {
    if (index >= steps.length - 1) {
      if (wrap === false) { pause(); return; }
      selectStep(0);
      return;
    }
    selectStep(index + 1);
  }

  function pause() {
    if (timer) { clearInterval(timer); timer = null; }
    btn.textContent = "▶ Watch the handoff";
    btn.setAttribute("aria-pressed", "false");
  }

  function start() {
    pause();
    index = -1;
    clearAll();
    advance(true);
    btn.textContent = "❚❚ Stop the handoff";
    btn.setAttribute("aria-pressed", "true");
    timer = setInterval(function () { advance(false); }, STEP_MS);
  }

  function stop() {
    pause();
    selectStep(0);
    setNote(DEFAULT_NOTE);
  }

  // Native controls share one path; direct selection pauses playback.
  steps.forEach(function (step, stepIndex) {
    step.addEventListener("click", function () {
      pause();
      selectStep(stepIndex);
    });
  });

  // Reduced motion advances one step per activation and never starts a timer.
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    btn.addEventListener("click", function () {
      advance(true); // wraps: 1 → 2 → 3 → 4 → 1
    });
  } else {
    btn.addEventListener("click", function () {
      if (timer) stop(); else start();
    });
  }

  selectStep(0);
  setNote(DEFAULT_NOTE);
})();
