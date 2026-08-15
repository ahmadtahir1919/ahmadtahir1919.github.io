// ============================================================================
// Web quiz-taking — mirrors ui/preview/QuizPreviewViewModel.kt's flow: load,
// per-question timer, answer, (optional) instant feedback, advance, score,
// submit. Poll/Fill-blank rendering land in later passes (see the plan);
// they currently show a "not available on web yet" placeholder with Skip.
// ============================================================================

// Same palette as ui/theme/QuizThemeColors.kt — keep in sync if it changes.
const QUIZ_THEME_COLORS = {
  Indigo: "#4F46E5", Forest: "#16A34A", Crimson: "#DC2626", Teal: "#0F766E",
  Amber: "#D97706", Rose: "#BE185D", Sky: "#0284C7", Violet: "#7C3AED",
  Orange: "#EA580C", Cyan: "#0891B2",
};
function themeColorFromName(name) {
  return QUIZ_THEME_COLORS[name] || QUIZ_THEME_COLORS.Indigo;
}

const app = document.getElementById("app");

// A missing global here (evaluator.js/supabase-client.js failed to load or
// threw during init — e.g. the Supabase CDN script was blocked/slow) used to
// throw right here and leave the whole page blank with nothing on screen and
// no clue why. Show it instead of silently dying.
if (!window.Evaluator || !window.SupabaseClient) {
  app.innerHTML =
    '<div style="padding:24px;font-family:sans-serif;color:#DC2626">' +
    "<b>Couldn't load this page.</b><br><br>" +
    "A required script failed to load (often a slow/blocked connection to the Supabase library CDN). " +
    "Please check your connection and reload the page." +
    "</div>";
  throw new Error("QuizCode web: required globals missing (Evaluator/SupabaseClient) — aborting boot.");
}
if (window.SupabaseClient.initError) {
  app.innerHTML =
    '<div style="padding:24px;font-family:sans-serif;color:#DC2626">' +
    "<b>Couldn't connect.</b><br><br>" +
    window.SupabaseClient.initError.message +
    "</div>";
  throw new Error("QuizCode web: Supabase client failed to initialize — aborting boot.");
}

const { evaluate, computeScore, defaultAnswerRule } = window.Evaluator;
const SC = window.SupabaseClient;

const params = new URLSearchParams(window.location.search);
const shareCode = (params.get("code") || "").toUpperCase();

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  screen: "loading", // loading | landing | quiz | finishing | result | error
  errorMessage: "",
  quiz: null,
  user: null,
  currentIndex: 0,
  selectedAnswers: new Set(), // index-strings, same convention as the Kotlin VM
  writtenAnswer: "",
  secondsRemaining: 0,
  totalTimeSec: 0,
  timerHandle: null,
  questionStartSec: 0,
  questionAnswers: {}, // questionId -> raw keys (index-strings / written text)
  questionTimings: {}, // questionId -> seconds
  instantFeedback: null,
  result: null, // { score, total, answers }
};

function render() {
  app.innerHTML = "";
  switch (state.screen) {
    case "loading": return renderLoading();
    case "landing": return renderLanding();
    case "quiz": return renderQuiz();
    case "finishing": return renderLoading("Submitting…");
    case "result": return renderResult();
    case "closed": return renderClosed();
    case "error": return renderError();
  }
}

/** Leaving the flow (Done, or the X mid-quiz) never navigates anywhere — there's
 *  no page at the site root, which is exactly what caused the 404. This just
 *  swaps to a plain "you're done" screen; the tab itself is meant to be closed
 *  by hand or via the Close button below (best-effort — window.close() only
 *  actually works on tabs the browser considers script-opened; most mobile
 *  browsers won't close a tab that was reached via a regular link tap, so the
 *  message says so explicitly rather than promising something that may not fire). */
function leaveQuiz(message) {
  clearInterval(state.timerHandle);
  state.closedMessage = message;
  state.screen = "closed";
  render();
}

function renderClosed() {
  app.appendChild(
    el("div", { class: "screen centered" }, [
      el("div", { class: "card", style: "width:100%" }, [
        el("p", { style: "font-size:40px;margin:0" }, ["👋"]),
        el("h2", { class: "quiz-title" }, [state.closedMessage || "Thanks!"]),
        el("p", { class: "muted" }, ["You can close this tab now."]),
        el("button", { class: "primary", style: "margin-top:8px", onclick: () => window.close() }, ["Close tab"]),
      ]),
    ])
  );
}

function el(tag, props, children) {
  const node = document.createElement(tag);
  Object.entries(props || {}).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  });
  (children || []).forEach((c) => node.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return node;
}

/** Fragment from an HTML string — used for the small inline SVG icons below. */
function html(markup) {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  return t.content.firstChild;
}

// Official 4-color Google "G" — same colors as LoginScreen.kt's GoogleGLogo
// (#EA4335 red, #FBBC05 yellow, #34A853 green, #4285F4 blue).
const GOOGLE_G_SVG = `
<svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
  <path fill="#4285F4" d="M19.6 10.23c0-.68-.06-1.36-.18-2.02H10v3.83h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.9-1.75 2.99-4.33 2.99-7.33z"/>
  <path fill="#34A853" d="M10 20c2.7 0 4.96-.89 6.62-2.42l-3.23-2.5c-.9.6-2.05.95-3.39.95-2.6 0-4.8-1.76-5.59-4.12H1.06v2.59A10 10 0 0 0 10 20z"/>
  <path fill="#FBBC05" d="M4.41 11.9a5.99 5.99 0 0 1 0-3.8V5.51H1.06a10 10 0 0 0 0 8.98l3.35-2.6z"/>
  <path fill="#EA4335" d="M10 3.98c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 10 0 10 10 0 0 0 1.06 5.51l3.35 2.59C5.2 5.74 7.4 3.98 10 3.98z"/>
</svg>`;

const CHECK_SVG = `<svg viewBox="0 0 20 20" fill="none"><path d="M4 10.5l4 4 8-9" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CLOSE_X_SVG = `<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const CLOCK_SVG = `<svg viewBox="0 0 20 20" fill="none" width="13" height="13"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.6"/><path d="M10 6v4l2.6 2.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const CHEVRON_RIGHT_SVG = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M6 3l5 5-5 5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEVRON_DOWN_SVG = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M4 6l4 4 4-4" stroke="#BBBACC" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const TROPHY_SVG = `<svg viewBox="0 0 24 24" fill="none" width="20" height="20"><path d="M7 4h10v4a5 5 0 01-10 0V4z" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 6H4a3 3 0 003 3M17 6h3a3 3 0 01-3 3" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M12 13v3M9 20h6M9.5 20c0-2 .8-3 2.5-3s2.5 1 2.5 3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderLoading(label) {
  app.appendChild(
    el("div", { class: "screen centered" }, [
      el("div", { class: "spinner" }),
      el("p", { class: "muted" }, [label || "Loading…"]),
    ])
  );
}

function renderError() {
  app.appendChild(
    el("div", { class: "screen centered" }, [
      el("p", { class: "quiz-title" }, ["Something went wrong"]),
      el("p", { class: "muted" }, [state.errorMessage]),
    ])
  );
}

function renderLanding() {
  const quiz = state.quiz;
  const accent = themeColorFromName(quiz.themeColorName);
  document.documentElement.style.setProperty("--accent", accent);

  const status = SC.effectiveStatus(quiz);
  const body = [
    el("span", { class: "pill" }, ["QUICK JOIN"]),
    el("h2", { class: "quiz-title" }, [quiz.title]),
    el("p", { class: "quiz-meta" }, [`${quiz.questions.length} question${quiz.questions.length === 1 ? "" : "s"}`]),
  ];

  if (status !== "ACTIVE") {
    body.push(
      el("p", { class: "muted" }, [
        status === "SCHEDULED" ? "This quiz hasn't started yet." : "This quiz has ended.",
      ])
    );
    app.appendChild(el("div", { class: "screen" }, [el("div", { class: "card" }, body)]));
    return;
  }

  if (!state.user) {
    const googleBtn = el(
      "button",
      {
        class: "google",
        onclick: async () => {
          const redirectTo = `${window.location.origin}${window.location.pathname}?code=${shareCode}`;
          await SC.signInWithGoogle(redirectTo);
        },
      },
      ["Sign in with Google"]
    );
    googleBtn.prepend(html(GOOGLE_G_SVG));
    body.push(
      el("p", { class: "muted" }, ["Sign in with Google to take this quiz — your result is saved to your account, same as the app."]),
      googleBtn
    );
  } else {
    body.push(
      el("p", { class: "muted" }, [`Signed in as ${SC.resolveDisplayName(state.user)}`]),
      el("button", { class: "primary", onclick: startQuiz }, ["Start Quiz"])
    );
  }

  app.appendChild(el("div", { class: "screen" }, [el("div", { class: "card" }, body)]));
}

function currentQuestion() {
  return state.quiz.questions[state.currentIndex];
}

function startQuiz() {
  state.currentIndex = 0;
  state.screen = "quiz";
  render();
  prepareCurrentQuestion();
}

function prepareCurrentQuestion() {
  const q = currentQuestion();
  state.selectedAnswers = new Set();
  state.writtenAnswer = "";
  state.instantFeedback = null;
  state.questionStartSec = Math.floor(Date.now() / 1000);
  if (q.type === "POLL") {
    // Poll rendering lands in a later pass — see task list.
    render();
    return;
  }
  startTimer();
  render();
}

function startTimer() {
  clearInterval(state.timerHandle);
  const q = currentQuestion();
  const timeSec = q.timeSec;
  if (!timeSec || timeSec <= 0) {
    state.totalTimeSec = 0;
    state.secondsRemaining = 0;
    return;
  }
  state.totalTimeSec = timeSec;
  state.secondsRemaining = timeSec;
  state.timerHandle = setInterval(() => {
    state.secondsRemaining -= 1;
    if (state.secondsRemaining <= 0) {
      clearInterval(state.timerHandle);
      advance(true);
      return;
    }
    updateTimerDisplay();
  }, 1000);
}

function formatSeconds(total) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Mirrors QuizPreviewScreen's TimerChip (top bar) + TimerProgressBar (above the
 *  bottom bar) — both update every tick without a full re-render. */
function updateTimerDisplay() {
  if (state.totalTimeSec <= 0) return;
  const urgent = state.secondsRemaining <= 10;
  const chip = document.getElementById("timer-chip");
  if (chip) {
    chip.textContent = "";
    chip.appendChild(html(CLOCK_SVG));
    chip.appendChild(document.createTextNode(" " + formatSeconds(state.secondsRemaining)));
    chip.className = "timer-chip" + (urgent ? " urgent" : "");
  }
  const fill = document.getElementById("timer-fill");
  if (fill) {
    fill.style.width = `${(state.secondsRemaining / state.totalTimeSec) * 100}%`;
    fill.style.background = urgent ? "#EF4444" : "var(--accent)";
  }
}

function toggleAnswer(optionIndex) {
  const q = currentQuestion();
  const key = String(optionIndex);
  if (q.type === "MULTIPLE_CORRECT") {
    if (state.selectedAnswers.has(key)) state.selectedAnswers.delete(key);
    else state.selectedAnswers.add(key);
  } else {
    if (state.selectedAnswers.has(key)) state.selectedAnswers.clear();
    else { state.selectedAnswers.clear(); state.selectedAnswers.add(key); }
  }
  render();
}

function onNext() { advance(true); }

function advance(castPollVote) {
  if (state.instantFeedback) return; // already mid-feedback — ignore stray taps
  const q = currentQuestion();
  clearInterval(state.timerHandle);

  if (q.type !== "POLL") {
    const elapsed = Math.max(1, Math.floor(Date.now() / 1000) - state.questionStartSec);
    state.questionTimings[q.id] = elapsed;
    if (q.type === "WRITTEN") {
      state.questionAnswers[q.id] = state.writtenAnswer.trim() ? [state.writtenAnswer] : [];
    } else if (q.type === "FILL_BLANK") {
      state.questionAnswers[q.id] = []; // filled in by the fill-blank pass
    } else {
      state.questionAnswers[q.id] = Array.from(state.selectedAnswers);
    }
  }

  const quiz = state.quiz;
  if (quiz.showCorrectnessInstantly && q.type !== "POLL") {
    const feedback = buildInstantFeedback(q, state.questionAnswers[q.id] || []);
    state.instantFeedback = feedback;
    render();
    setTimeout(() => proceedPastQuestion(), feedback.isCorrect ? 1100 : 1900);
    return;
  }
  proceedPastQuestion();
}

function buildInstantFeedback(q, rawKeys) {
  if (q.type === "SINGLE_CHOICE" || q.type === "MULTIPLE_CORRECT" || q.type === "TRUE_FALSE") {
    const selectedIndices = new Set(rawKeys.map(Number).filter((n) => !Number.isNaN(n)));
    const options = q.options || [];
    const correctTexts = new Set(q.correctAnswers || []);
    const correctIndices = new Set(options.map((_, i) => i).filter((i) => correctTexts.has(options[i])));
    const eq = selectedIndices.size === correctIndices.size && [...selectedIndices].every((i) => correctIndices.has(i));
    return { isCorrect: eq, correctOptionIndices: correctIndices, wrongSelectedIndices: new Set([...selectedIndices].filter((i) => !correctIndices.has(i))) };
  }
  if (q.type === "WRITTEN") {
    const userInput = rawKeys[0] || "";
    const expected = q.writtenAnswer || "";
    let correct = false;
    if (userInput.trim() && expected.trim()) {
      const rule = q.answerRule || defaultAnswerRule();
      correct = computeScore(evaluate(userInput, expected, rule), q.points, rule) > 0;
    }
    return { isCorrect: correct, correctWrittenAnswer: !correct ? expected : null };
  }
  return { isCorrect: true };
}

function proceedPastQuestion() {
  if (state.currentIndex === state.quiz.questions.length - 1) {
    finishQuiz();
    return;
  }
  state.currentIndex += 1;
  prepareCurrentQuestion();
}

function finishQuiz() {
  state.screen = "finishing";
  render();

  const evaluator = window.Evaluator;
  const scored = state.quiz.questions.filter((q) => q.type !== "POLL");
  const answers = scored.map((q) => {
    const rawKeys = state.questionAnswers[q.id] || [];
    let given;
    if (q.type === "WRITTEN" || q.type === "FILL_BLANK") given = rawKeys;
    else given = rawKeys.map((k) => (q.options || [])[Number(k)]).filter((v) => v !== undefined);

    let isCorrect;
    if (q.type === "WRITTEN") {
      const userInput = given[0] || "";
      const expected = q.writtenAnswer || "";
      const rule = q.answerRule || defaultAnswerRule();
      isCorrect = userInput.trim() && expected.trim()
        ? evaluator.computeScore(evaluator.evaluate(userInput, expected, rule), q.points, rule) > 0
        : false;
    } else if (q.type === "FILL_BLANK") {
      isCorrect = false; // fill-blank grading lands in a later pass
    } else {
      const a = new Set(given), b = new Set(q.correctAnswers || []);
      isCorrect = a.size === b.size && [...a].every((x) => b.has(x));
    }

    return {
      questionId: q.id,
      isCorrect,
      givenAnswers: given,
      timeTakenSec: state.questionTimings[q.id] || 0,
    };
  });

  const score = answers.filter((a) => a.isCorrect).length;

  SC.submitAttempt(state.quiz.id, state.user.id, score, scored.length, answers)
    .then(() => {
      state.result = { score, total: scored.length, answers };
      state.screen = "result";
      render();
    })
    .catch((err) => {
      state.errorMessage = "Couldn't save your result: " + (err.message || err);
      state.screen = "error";
      render();
    });
}

/** Top bar: X close, title, timer chip — mirrors QuizPreviewScreen's PreviewTopBar. */
function buildQuizTopBar(quiz, q) {
  const closeBtn = el("button", { class: "icon-btn", onclick: () => { if (confirm("Leave this quiz? Your progress won't be saved.")) leaveQuiz("Quiz closed"); } }, []);
  closeBtn.appendChild(html(CLOSE_X_SVG));

  // Reserved-width slot either way, so the title stays centered whether or not
  // this question has a timer.
  const right = q.timeSec > 0
    ? el("div", { id: "timer-chip", class: "timer-chip" }, [])
    : el("div", { style: "width:36px" }, []);

  return el("div", { class: "quiz-topbar" }, [closeBtn, el("span", { class: "title" }, [quiz.title]), right]);
}

function buildQuestionProgressBar(quiz) {
  const pct = ((state.currentIndex + 1) / quiz.questions.length) * 100;
  return el("div", { class: "progress-track" }, [el("div", { class: "progress-fill", style: `width:${pct}%` })]);
}

/** Bottom action bar: timer progress bar pinned above it, Skip + Next — mirrors
 *  QuizPreviewScreen's PreviewBottomBar. */
function buildBottomBar(q, isLastQuestion, onSkipFn, onNextFn) {
  const rows = [];
  if (q.timeSec > 0) {
    rows.push(
      el("div", { class: "progress-track" }, [
        el("div", { id: "timer-fill", class: "progress-fill", style: `width:${(state.secondsRemaining / state.totalTimeSec) * 100}%` }),
      ])
    );
  }
  const disabled = !!state.instantFeedback;
  const nextBtn = el("button", { class: "next-btn", onclick: onNextFn }, []);
  if (disabled) nextBtn.disabled = true;
  nextBtn.appendChild(document.createTextNode(isLastQuestion ? "Finish" : "Next"));
  nextBtn.appendChild(html(CHEVRON_RIGHT_SVG));

  const skipBtn = el("button", { class: "skip-link", onclick: onSkipFn }, ["Skip"]);
  if (disabled) skipBtn.disabled = true;

  rows.push(el("div", { class: "bar-row" }, [skipBtn, nextBtn]));
  return el("div", { class: "quiz-bottombar" }, rows);
}

function renderQuiz() {
  const q = currentQuestion();
  const quiz = state.quiz;
  const accent = themeColorFromName(quiz.themeColorName);
  document.documentElement.style.setProperty("--accent", accent);
  const isLastQuestion = state.currentIndex === quiz.questions.length - 1;

  const wrapper = el("div", { style: "display:flex;flex-direction:column;min-height:100%" }, [
    buildQuizTopBar(quiz, q),
    buildQuestionProgressBar(quiz),
  ]);

  if (q.type === "POLL" || q.type === "FILL_BLANK") {
    wrapper.appendChild(
      el("div", { class: "screen", style: "flex:1" }, [
        el("div", { class: "card" }, [
          el("p", { class: "quiz-meta" }, [`Question ${state.currentIndex + 1} of ${quiz.questions.length}`]),
          el("p", { class: "question-text" }, [q.text]),
          el("p", { class: "muted" }, ["This question type isn't available in the browser yet — open it in the QuizCode app, or skip it here."]),
        ]),
      ])
    );
    wrapper.appendChild(buildBottomBar(q, isLastQuestion, onNext, onNext));
    app.appendChild(wrapper);
    return;
  }

  const questionArea = el("div", { class: "screen no-pad-top", style: "flex:1" }, [
    el("div", { class: "card" }, [el("p", { class: "question-text" }, [q.text])]),
  ]);

  if (state.instantFeedback) {
    const fb = state.instantFeedback;
    questionArea.appendChild(
      el("div", { class: "feedback-banner " + (fb.isCorrect ? "correct" : "wrong") }, [fb.isCorrect ? "✓ Correct!" : "✗ Not quite"])
    );
    if (!fb.isCorrect && fb.correctWrittenAnswer) {
      questionArea.appendChild(el("p", { class: "muted" }, [`Correct answer: ${fb.correctWrittenAnswer}`]));
    }
    // Also color the option rows themselves while feedback is showing.
    if (q.options && fb.correctOptionIndices) {
      q.options.forEach((optText, i) => {
        const wasSelected = state.selectedAnswers.has(String(i));
        const isCorrectOpt = fb.correctOptionIndices.has(i);
        const cls = isCorrectOpt ? "correct" : wasSelected ? "wrong" : "";
        const row = el("div", { class: "option-row" + (cls ? " " + cls : "") }, [
          el("div", { class: "option-marker" + (q.type === "MULTIPLE_CORRECT" ? " square" : "") }, isCorrectOpt || wasSelected ? [html(CHECK_SVG)] : []),
          el("span", {}, [optText]),
        ]);
        questionArea.appendChild(row);
      });
    }
  } else if (q.type === "WRITTEN") {
    questionArea.appendChild(
      el("textarea", {
        rows: "4",
        placeholder: "Type your answer…",
        oninput: (e) => { state.writtenAnswer = e.target.value; },
      }, [])
    );
  } else {
    (q.options || []).forEach((optText, i) => {
      const selected = state.selectedAnswers.has(String(i));
      const markerShape = q.type === "MULTIPLE_CORRECT" ? " square" : "";
      questionArea.appendChild(
        el("div", { class: "option-row" + (selected ? " selected" : ""), onclick: () => toggleAnswer(i) }, [
          el("div", { class: "option-marker" + markerShape }, selected ? [html(CHECK_SVG)] : []),
          el("span", {}, [optText]),
        ])
      );
    });
  }

  wrapper.appendChild(questionArea);
  wrapper.appendChild(buildBottomBar(q, isLastQuestion, onNext, onNext));
  app.appendChild(wrapper);
  updateTimerDisplay();
}

const expandedReviews = new Set();

/** Mirrors ResultScreen.kt's ScoreCard — same gradient, trophy badge, big score +
 *  accuracy%, and progress track. accuracy/passed use the same formula as
 *  ResultUiState (accuracy = floor(score*100/total), passed = accuracy >= 60). */
function buildScoreCard(score, total) {
  const accuracy = total > 0 ? Math.floor((score * 100) / total) : 0;
  const passed = accuracy >= 60;

  const badge = el("div", { class: "badge" }, []);
  badge.appendChild(html(TROPHY_SVG));

  const card = el("div", { class: "score-card" }, [
    el("div", { class: "row-top" }, [
      badge,
      el("div", {}, [
        el("div", { class: "label" }, ["YOUR SCORE"]),
        el("div", { class: "status" }, [passed ? "Passed" : "Not passed"]),
      ]),
    ]),
    el("div", { class: "numbers" }, [
      el("div", { style: "display:flex;align-items:flex-end" }, [
        el("span", { class: "score-big" }, [String(score)]),
        el("span", { class: "score-total" }, [` / ${total}`]),
      ]),
      el("div", {}, [
        el("div", { class: "accuracy-num" }, [`${accuracy}%`]),
        el("div", { class: "accuracy-label" }, ["ACCURACY"]),
      ]),
    ]),
    el("div", { class: "track" }, [el("div", { class: "fill", style: `width:${accuracy}%` })]),
  ]);
  return card;
}

/** Mirrors ResultScreen.kt's ReviewCard: colored left accent, Q# pill, question
 *  text, expands to show the options (or written comparison) with correct/wrong
 *  highlighting. */
function buildReviewCard(answer, index) {
  const q = state.quiz.questions.find((qq) => qq.id === answer.questionId);
  if (!q) return null;
  const isCorrect = answer.isCorrect;
  const expanded = expandedReviews.has(answer.questionId);

  const accent = el("div", { class: "review-accent " + (isCorrect ? "correct" : "wrong") }, []);
  const meta = el("div", { class: "review-meta" }, [
    el("span", { class: "q-pill " + (isCorrect ? "correct" : "wrong") }, [`Q${index + 1}`]),
    el("span", { class: "muted" }, [`⏱ ${answer.timeTakenSec}s`]),
  ]);
  const header = el(
    "div",
    { class: "review-header", onclick: () => { expandedReviews.has(q.id) ? expandedReviews.delete(q.id) : expandedReviews.add(q.id); render(); } },
    [accent, el("div", { style: "flex:1" }, [meta, el("div", { class: "review-question" }, [q.text])])]
  );
  header.appendChild(html(CHEVRON_DOWN_SVG));

  const card = el("div", { class: "review-card" }, [header]);

  if (expanded) {
    const bodyEl = el("div", { class: "review-body" }, []);
    if (q.type === "WRITTEN") {
      const given = answer.givenAnswers[0] || "";
      bodyEl.appendChild(reviewLine("CORRECT ANSWER", q.writtenAnswer || "", "#22C55E"));
      bodyEl.appendChild(reviewLine("YOUR ANSWER", given || "(no answer)", isCorrect ? "#22C55E" : "#EF4444"));
    } else {
      (q.options || []).forEach((opt) => {
        const wasGiven = answer.givenAnswers.includes(opt);
        const isCorrectOpt = (q.correctAnswers || []).includes(opt);
        const cls = isCorrectOpt ? "correct" : wasGiven ? "wrong" : "";
        bodyEl.appendChild(
          el("div", { class: "option-row" + (cls ? " " + cls : ""), style: "cursor:default" }, [
            el("div", { class: "option-marker" }, isCorrectOpt || wasGiven ? [html(CHECK_SVG)] : []),
            el("span", {}, [opt]),
          ])
        );
      });
    }
    card.appendChild(bodyEl);
  }
  return card;
}

function reviewLine(label, text, color) {
  return el("div", { class: "review-answer-line", style: `border-left-color:${color}` }, [
    el("span", { class: "rline-label", style: `color:${color}` }, [label]),
    el("span", {}, [text]),
  ]);
}

function renderResult() {
  const quiz = state.quiz;
  const accent = themeColorFromName(quiz.themeColorName);
  document.documentElement.style.setProperty("--accent", accent);
  const { score, total, answers } = state.result;

  const content = el("div", { class: "screen" }, [
    el("h2", { class: "quiz-title", style: "text-align:center;margin:4px 0 0" }, [quiz.title]),
    buildScoreCard(score, total),
  ]);

  if (!quiz.showResult) {
    content.appendChild(el("p", { class: "muted", style: "text-align:center" }, ["Results are hidden for this quiz — check with the quiz creator."]));
  } else if (quiz.showAnswers) {
    content.appendChild(el("p", { class: "muted", style: "font-weight:700;letter-spacing:0.6px" }, ["ANSWER REVIEW"]));
    answers.forEach((a, i) => {
      const card = buildReviewCard(a, i);
      if (card) content.appendChild(card);
    });
  }

  content.appendChild(
    el("button", { class: "primary", style: "margin-top:8px", onclick: () => leaveQuiz("Thanks for taking the quiz!") }, ["Done"])
  );

  app.appendChild(content);
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  try {
    if (!shareCode) {
      state.errorMessage = "No quiz code in the link.";
      state.screen = "error";
      render();
      return;
    }

    render(); // loading

    const quiz = await SC.fetchQuizByShareCode(shareCode);
    if (!quiz) {
      state.errorMessage = "Quiz not found. Double-check the code.";
      state.screen = "error";
      render();
      return;
    }
    state.quiz = quiz;
    state.user = await SC.getCurrentUser();

    // The Google sign-in redirect leaves an extra "in transit" history entry
    // (this page -> Google -> back here) and a #access_token=... fragment in
    // the address bar. Now that the session has definitely been read out of
    // it, collapse it into a clean current URL — pressing Back later goes to
    // wherever the user actually came from (WhatsApp's browser, the join
    // page, …), not back into that OAuth hop, and the token stops sitting
    // visibly in the address bar.
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }

    state.screen = "landing";
    render();
  } catch (e) {
    // Any unexpected failure (network drop, a Supabase error, …) now shows a
    // message instead of leaving the loading spinner stuck forever.
    state.errorMessage = e?.message || String(e);
    state.screen = "error";
    render();
  }
}

boot();
