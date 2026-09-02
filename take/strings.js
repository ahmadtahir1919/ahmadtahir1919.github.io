// ============================================================================
// Every user-facing string on the web take/result flow, in one place.
//
// Same discipline as the Android app's res/values/strings.xml: no user-visible
// text is written inline in app.js / evaluator.js / poll.js. Keys are grouped by
// the screen they belong to. Values that interpolate take a function so the
// caller can't accidentally reorder or drop a placeholder.
//
// Wording here is byte-identical to the Kotlin side wherever a string has an
// Android counterpart (notably the EVAL_* feedback messages, which mirror
// AnswerEvaluator.kt) — a taker must read the same words in the app and here.
// ============================================================================

const S = {
  // ── Errors ─────────────────────────────────────────────────────────────
  // NOTE: app.js's two boot-failure messages are deliberately NOT here. They are shown
  // exactly when a required script failed to load — possibly this one — so they must not
  // depend on it. They are the only user-facing literals left inline on purpose.
  ERR_GENERIC_TITLE: "Oops, that didn't work",
  ERR_NO_CODE: "No quiz code in the link.",
  ERR_QUIZ_NOT_FOUND: "Quiz not found. Double-check the code.",
  ERR_SUPABASE_CDN: "Supabase library failed to load from CDN.",

  // ── Generic ────────────────────────────────────────────────────────────
  LOADING: "Loading…",
  SUBMITTING: "Submitting…",
  JOINING: "Joining…",
  SAVING: "Saving…",
  DONE: "Done",
  SKIP: "Skip",
  GOT_IT: "Got it",
  HINT: "💡 Hint",

  // ── Closed / thanks screen ─────────────────────────────────────────────
  CLOSED_WAVE: "👋",
  CLOSED_DEFAULT_TITLE: "Thanks!",
  CLOSED_THANKS: "Thanks for taking the quiz!",
  CLOSED_CAN_CLOSE: "You can close this tab now.",
  CLOSED_CLOSE_TAB: "Close tab",
  LEAVE_CONFIRM: "Leave this quiz? Your progress won't be saved.",
  QUIZ_CLOSED: "Quiz closed",

  // ── Landing ────────────────────────────────────────────────────────────
  LANDING_KICKER: "QUICK JOIN",
  LANDING_ARCHIVED:
    "This quiz has been archived by its creator and is no longer accepting responses.",
  LANDING_ENDED: "This quiz has ended.",
  LANDING_ALREADY_DONE: "You've already completed this quiz. Retakes aren't allowed.",
  LANDING_SEE_RESULT: "See Result",
  LANDING_RETAKE: "Retake Exam",
  LANDING_START: "Start Quiz",
  questionCount: (n) => `${n} question${n === 1 ? "" : "s"}`,
  yourScore: (score, total) => `Your score: ${score} / ${total}`,
  version: (v, build) => `v${v} (build ${build})`,

  // ── Auth ───────────────────────────────────────────────────────────────
  SIGN_IN_GOOGLE: "Sign in with Google",
  SIGN_IN_BLURB:
    "Sign in with Google to take this quiz — your result is saved to your account, same as the app.",
  SIGN_OUT: "Not you? Sign out",
  signedInAs: (name) => `Signed in as ${name}`,

  // ── Confirm name ───────────────────────────────────────────────────────
  CONFIRM_NAME_KICKER: "ONE QUICK THING",
  CONFIRM_NAME_TITLE: "Confirm your name",
  CONFIRM_NAME_BLURB:
    "This is the name shown on your quizzes and results — some Google accounts have the wrong name attached, so fix it here if needed.",
  CONFIRM_NAME_PLACEHOLDER: "Your name",
  CONFIRM_NAME_SUBMIT: "Confirm & Continue",

  // ── Taking a quiz ──────────────────────────────────────────────────────
  SELECT_ALL_THAT_APPLY: "Select all that apply",
  ANSWER_PLACEHOLDER: "Type your answer…",
  BLANK_PLACEHOLDER: "Your answer…",
  questionXofN: (current, total) => `QUESTION ${current} OF ${total}`,
  blankCorrectAnswer: (index, answer) => `Blank ${index} — Correct answer: ${answer}`,
  correctAnswerIs: (answer) => `Correct answer: ${answer}`,

  // ── Submission failures ────────────────────────────────────────────────
  SUBMIT_QUIZ_CLOSED:
    "The owner closed this quiz, or its scheduled time ran out, while you were still answering — so this submission can no longer go through.",
  SUBMIT_REMOVED:
    "This quiz's owner removed you from it, so this submission can no longer go through.",
  SUBMIT_NO_RETAKE: "This quiz doesn't allow retakes, and you've already completed it.",
  SUBMIT_SAVE_FAILED_PREFIX: "Couldn't save your result: ",

  // ── Poll ───────────────────────────────────────────────────────────────
  POLL: "POLL",
  POLL_OTHER: "Other",
  POLL_VOTED: "✓ You voted",
  POLL_RESULTS_AFTER_CLOSE: "Results are shown once the poll closes.",
  POLL_TAP_NEXT: "Tap Next to cast your vote.",
  POLL_REASON_PLACEHOLDER: "Why? (optional)",
  participantCount: (n) => `${n} participant${n === 1 ? "" : "s"}`,
  voteCount: (n) => `${n} vote${n === 1 ? "" : "s"}`,
  otherEntry: (text, count) => `${text} (${count})`,
  quotedReason: (reason) => `“${reason}”`,

  // ── Result ─────────────────────────────────────────────────────────────
  RESULT_YOUR_SCORE: "YOUR SCORE",
  RESULT_FAILED: "Failed",
  RESULT_PENDING_TITLE: "Waiting to be marked",
  RESULT_PENDING_BODY:
    "Your answers have been submitted. The quiz admin still has to mark them by hand, so there's no result to show yet. Check back a little later.",
  RESULT_AWAITING_MARKING: "Awaiting marking",
  RESULT_HIDDEN: "Results are hidden for this quiz — check with the quiz creator.",
  RESULT_ANSWER_REVIEW: "ANSWER REVIEW",
  RESULT_CORRECT_ANSWER: "CORRECT ANSWER",
  RESULT_YOUR_ANSWER: "YOUR ANSWER",
  RESULT_MARKS_BLURB: "Questions that carry marks, scored out of their total.",
  RESULT_CORRECT_ANSWERS: "Correct answers",
  RESULT_CORRECTNESS_BLURB: "Questions that carry no marks — just counted right or wrong.",
  questionPill: (index) => `Q${index}`,
  percent: (p) => `${p}%`,
  outOf: (total) => ` / ${total}`,
  marksBadge: (awarded, total) => `MARKS ${awarded}/${total}`,
  marksFraction: (awarded, total) => `${awarded}/${total}`,
  pointsFraction: (awarded, total) => `${awarded}/${total} points`,
  timeTaken: (sec) => `⏱ ${sec}s`,

  // ── Written-answer evaluation labels ───────────────────────────────────
  EVAL_LABEL_TYPO: "Accepted — small typo",
  EVAL_LABEL_PARTIAL: "Partial match",
  EVAL_LABEL_INCORRECT: "Incorrect",

  // ── Evaluator feedback (mirrors AnswerEvaluator.kt verbatim) ───────────
  EVAL_CORRECT: "Correct!",
  EVAL_INCORRECT: "Incorrect answer.",
  EVAL_NO_ANSWER: "No answer provided.",
  EVAL_TYPO: "Accepted — small typo.",
  EVAL_PARTIAL: "Partial match — some words correct.",
  EVAL_KEYWORDS_ALL: "Correct! All keywords found.",
  EVAL_KEYWORDS_MISSING: "Incorrect — missing required keywords.",
  EVAL_INCORRECT_NUMBER: "Incorrect number.",
  evalKeywordsAccepted: (pct) => `Accepted — ${pct}% keywords found.`,
  evalKeywordsPartial: (pct) => `Partial — ${pct}% keywords found.`,
};

window.S = S;
