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

const { evaluate, computeScore, defaultAnswerRule } = window.Evaluator;
const SC = window.SupabaseClient;

const app = document.getElementById("app");
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
    case "error": return renderError();
  }
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
    body.push(
      el("p", { class: "muted" }, ["Sign in with Google to take this quiz — your result is saved to your account, same as the app."]),
      el(
        "button",
        {
          class: "google",
          onclick: async () => {
            const redirectTo = `${window.location.origin}${window.location.pathname}?code=${shareCode}`;
            await SC.signInWithGoogle(redirectTo);
          },
        },
        ["Sign in with Google"]
      )
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

function updateTimerDisplay() {
  const timerEl = document.getElementById("timer-display");
  const fillEl = document.getElementById("timer-fill");
  if (!timerEl || state.totalTimeSec <= 0) return;
  timerEl.textContent = `${state.secondsRemaining}s`;
  timerEl.className = "timer" + (state.secondsRemaining <= 10 ? " low" : "");
  if (fillEl) fillEl.style.width = `${(state.secondsRemaining / state.totalTimeSec) * 100}%`;
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

function renderQuiz() {
  const q = currentQuestion();
  const quiz = state.quiz;
  const accent = themeColorFromName(quiz.themeColorName);
  document.documentElement.style.setProperty("--accent", accent);

  if (q.type === "POLL" || q.type === "FILL_BLANK") {
    app.appendChild(
      el("div", { class: "screen" }, [
        el("div", { class: "progress-track" }, [el("div", { class: "progress-fill", style: `width:${((state.currentIndex + 1) / quiz.questions.length) * 100}%` })]),
        el("div", { class: "card" }, [
          el("p", { class: "quiz-meta" }, [`Question ${state.currentIndex + 1} of ${quiz.questions.length}`]),
          el("p", { class: "question-text" }, [q.text]),
          el("p", { class: "muted" }, ["This question type isn't available in the browser yet — open it in the QuizCode app, or skip it here."]),
        ]),
        el("button", { class: "primary", onclick: onNext }, ["Skip"]),
      ])
    );
    return;
  }

  const progress = el("div", { class: "progress-track" }, [
    el("div", { class: "progress-fill", style: `width:${((state.currentIndex + 1) / quiz.questions.length) * 100}%` }),
  ]);

  const header = el("div", { class: "topbar" }, [
    el("div", {}, [
      el("p", { class: "quiz-meta" }, [`Question ${state.currentIndex + 1} of ${quiz.questions.length}`]),
      q.timeSec > 0 ? el("span", { id: "timer-display", class: "timer" }, [`${state.secondsRemaining}s`]) : el("span", {}, []),
    ]),
  ]);

  const questionCard = el("div", { class: "card" }, [el("p", { class: "question-text" }, [q.text])]);

  const answerArea = el("div", { class: "screen", style: "padding-top:0" }, []);

  if (state.instantFeedback) {
    const fb = state.instantFeedback;
    answerArea.appendChild(
      el("div", { class: "feedback-banner " + (fb.isCorrect ? "correct" : "wrong") }, [fb.isCorrect ? "Correct!" : "Not quite"])
    );
    if (!fb.isCorrect && fb.correctWrittenAnswer) {
      answerArea.appendChild(el("p", { class: "muted" }, [`Correct answer: ${fb.correctWrittenAnswer}`]));
    }
  } else if (q.type === "WRITTEN") {
    answerArea.appendChild(
      el("textarea", {
        rows: "4",
        placeholder: "Type your answer…",
        oninput: (e) => { state.writtenAnswer = e.target.value; },
      }, [])
    );
    answerArea.appendChild(el("button", { class: "primary", onclick: onNext }, ["Next"]));
  } else {
    (q.options || []).forEach((optText, i) => {
      const selected = state.selectedAnswers.has(String(i));
      const isTF = q.type === "TRUE_FALSE";
      answerArea.appendChild(
        el("div", { class: "option-row" + (selected ? " selected" : ""), onclick: () => toggleAnswer(i) }, [
          el("div", { class: "option-marker" + (q.type === "MULTIPLE_CORRECT" ? " square" : "") }, []),
          el("span", {}, [optText]),
        ])
      );
    });
    answerArea.appendChild(el("button", { class: "primary", onclick: onNext }, ["Next"]));
  }

  app.appendChild(el("div", {}, [header, progress, el("div", { class: "screen" }, [questionCard]), answerArea]));
  updateTimerDisplay();
}

function renderResult() {
  const quiz = state.quiz;
  const accent = themeColorFromName(quiz.themeColorName);
  document.documentElement.style.setProperty("--accent", accent);
  const { score, total } = state.result;

  const body = [
    el("div", { class: "score-circle" }, [
      el("span", { class: "score" }, [`${score}/${total}`]),
      el("span", { class: "total" }, ["score"]),
    ]),
    el("h2", { class: "quiz-title", style: "text-align:center" }, [quiz.title]),
  ];

  if (!quiz.showResult) {
    body.push(el("p", { class: "muted", style: "text-align:center" }, ["Results are hidden for this quiz — check with the quiz creator."]));
  }

  app.appendChild(el("div", { class: "screen centered" }, [el("div", { class: "card" }, body)]));
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
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
  state.screen = "landing";
  render();
}

boot();
