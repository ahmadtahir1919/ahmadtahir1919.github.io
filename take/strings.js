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
  ERR_QUIZ_NOT_FOUND: "Quiz not found. Double-check the code.",
  ERR_SUPABASE_CDN: "Supabase library failed to load from CDN.",

  // ── Shared shell (header + footer on every screen) ─────────────────────
  BRAND: "Testly",
  STATUS_READY: "Ready",
  STATUS_LOADING: "Loading",
  STATUS_ERROR: "Error",
  STATUS_IN_PROGRESS: "In progress",
  STATUS_SESSION_READY: "Session Ready",
  STATUS_PAUSED: "Maintenance",
  footerVersion: (v) => `Testly Web v${v}`,
  FOOTER_TERMS: "Terms",
  FOOTER_PRIVACY: "Privacy",

  // ── Enter code ─────────────────────────────────────────────────────────
  ENTER_CODE_KICKER: "JOIN A QUIZ",
  ENTER_CODE_TITLE: "Enter Quiz Code",
  ENTER_CODE_BLURB: "Ask your quiz host or teacher for their 6-character PIN code to jump right in.",
  ENTER_CODE_LABEL: "6-CHARACTER PIN",
  ENTER_CODE_HINT: "Code not working? Double-check uppercase letters and numbers.",
  ENTER_CODE_JOIN: "Join Quiz",
  ENTER_CODE_PASTE: "Paste Code from Clipboard",
  ENTER_CODE_NOTE: "Have a link? Just paste it above or enter the code to begin.",
  ENTER_CODE_CLIPBOARD_EMPTY: "No quiz code found on the clipboard.",

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
  // Mirrors preview_exit_title + preview_exit_msg_retake / _no_retake (one line — the
  // browser's own confirm() box has no separate title).
  LEAVE_CONFIRM_RETAKE:
    "Leave this quiz? Your answers won't be saved — nothing has been submitted yet. You can retake it later.",
  LEAVE_CONFIRM_NO_RETAKE:
    "Leave this quiz? Your answers won't be saved, and the creator doesn't allow retakes — you won't be able to take this quiz again.",
  QUIZ_CLOSED: "Quiz closed",
  POLL_ALL_CLOSED: "This poll has already closed, so there's nothing here for you to answer.",

  // ── Landing ────────────────────────────────────────────────────────────
  LANDING_KICKER: "QUICK JOIN",
  LANDING_ARCHIVED:
    "This quiz has been archived by its creator and is no longer accepting responses.",
  LANDING_ENDED: "This quiz has ended.",
  LANDING_ALREADY_DONE: "You've already completed this quiz. Retakes aren't allowed.",
  LANDING_SEE_RESULT: "See Result",
  LANDING_RETAKE: "Retake Exam",
  // Mirrors joined_status_abandoned / joined_locked_message — started earlier, left
  // without submitting (nothing counted).
  LANDING_LEFT_WITHOUT_SUBMITTING: "Left without submitting",
  LANDING_LEFT_LOCKED: "You left this quiz without submitting, and the creator doesn't allow retakes.",
  LANDING_JOIN: "Join Quiz Room",
  LANDING_START: "Start Quiz",
  questionCount: (n) => `${n} question${n === 1 ? "" : "s"}`,
  sessionLine: (n) => `Session: ${n} Question${n === 1 ? "" : "s"}`,
  yourScore: (score, total) => `Your score: ${score} / ${total}`,
  version: (v, build) => `v${v} (build ${build})`,

  // ── Auth ───────────────────────────────────────────────────────────────
  SIGN_IN_GOOGLE: "Sign in with Google",
  SIGN_IN_BLURB:
    "Sign in with Google to take this quiz — your result is saved to your account, same as the Android app.",
  SIGNED_IN_AS_LABEL: "SIGNED IN AS",
  SIGN_OUT_PREFIX: "Not you? ",
  SIGN_OUT: "Sign out",

  // ── Confirm name ───────────────────────────────────────────────────────
  CONFIRM_NAME_KICKER: "ONE QUICK THING",
  CONFIRM_NAME_TITLE: "Confirm your display name",
  CONFIRM_NAME_BLURB:
    "This is the name shown on your quizzes, leaderboard, and results. Some Google accounts have a nickname or email attached, so make sure it's accurate.",
  CONFIRM_NAME_LABEL: "YOUR FULL NAME",
  CONFIRM_NAME_PLACEHOLDER: "Your name",
  CONFIRM_NAME_SYNCED: "Synced from Google account",
  CONFIRM_NAME_SUBMIT: "Confirm & Continue",
  CONFIRM_NAME_CANCEL: "Cancel & Sign out",

  // ── Taking a quiz ──────────────────────────────────────────────────────
  SELECT_ALL_THAT_APPLY: "Select all that apply",
  SELECT_ANY_CORRECT: "Select any correct answer",
  NAV_NEXT: "Next",
  NAV_FINISH: "Finish",
  NAV_VOTE: "Vote",
  ANSWER_PLACEHOLDER: "Type your answer…",
  BLANK_PLACEHOLDER: "Your answer…",
  questionXofN: (current, total) => `QUESTION ${current} OF ${total}`,
  blankCorrectAnswer: (index, answer) => `Blank ${index} — Correct answer: ${answer}`,
  correctAnswerIs: (answer) => `Correct answer: ${answer}`,
  // Redesigned quiz screen — wording mirrors the Android qz_* strings.
  HINT_BUTTON: "Hint",
  CLEAR: "Clear",
  ANONYMOUS: "Anonymous",
  SKIP_POLL: "Skip Poll",
  POLL_CHIP: "Poll",
  POLL_OVERLINE: "Live community poll",
  POLL_HELPER_SINGLE: "Select single choice",
  POLL_HELPER_ANONYMOUS: "Your response is anonymous and not scored",
  POLL_HELPER_NAMED: "Your response is not scored",
  HELPER_SINGLE_CHOICE: "Select single choice only",
  HELPER_TRUE_FALSE: "Select true or false",
  HELPER_WRITTEN: "Type your detailed written answer below",
  HELPER_FILL_BLANK: "Type the missing words in the blanks below",
  YOUR_SELECTION: "Your selection",
  TF_SELECTED: "Selected choice",
  TF_ALTERNATIVE: "Alternative choice",
  YOUR_ANSWER_LABEL: "Your answer",
  REASON_LABEL: "Optional reason (why this choice?)",
  questionCountSuffix: (n) => ` (${n}q)`,
  pollHelper: (choice, privacy) => `${choice} • ${privacy}`,
  optionsSelected: (n) => `${n} option${n === 1 ? "" : "s"} selected`,
  charCountSuffix: (max) => ` / ${max} characters`,
  charCount: (n, max) => `${n}/${max}`,

  // ── Submission failures ────────────────────────────────────────────────
  SUBMIT_QUIZ_CLOSED:
    "The owner closed this quiz, or its scheduled time ran out, while you were still answering — so this submission can no longer go through.",
  SUBMIT_REMOVED:
    "This quiz's owner removed you from it, so this submission can no longer go through.",
  SUBMIT_NO_RETAKE: "This quiz doesn't allow retakes, and you've already completed it.",
  SUBMIT_SAVE_FAILED_PREFIX: "Couldn't save your result: ",
  SAVE_NAME_FAILED: "Couldn't save your name. Check your connection and try again.",
  JOIN_FAILED: "Couldn't join — check your connection and try again.",
  JOIN_PAUSED: "Joining quizzes is paused for maintenance right now. It'll be back shortly.",

  // ── Poll ───────────────────────────────────────────────────────────────
  POLL_OTHER: "Other",
  POLL_VOTED: "✓ You voted",
  POLL_RESULTS_AFTER_CLOSE: "Results are shown once the poll closes.",
  POLL_TAP_NEXT: "Tap Next to cast your vote.",
  POLL_CHANGE_VOTE: "Change vote",
  POLL_RESULTS_NOT_SHARED: "The quiz owner hasn't shared this poll's results.",
  POLL_REASON_PLACEHOLDER: "Share why you picked this…",
  participantCount: (n) => `${n} participant${n === 1 ? "" : "s"}`,
  otherEntry: (text, count) => `${text} (${count})`,
  quotedReason: (reason) => `“${reason}”`,

  // ── Result ─────────────────────────────────────────────────────────────
  RESULT_YOUR_SCORE: "YOUR SCORE",
  RESULT_FAILED: "Failed",
  RESULT_PENDING_TITLE: "Waiting to be marked",
  RESULT_PENDING_BODY:
    "Your answers have been submitted. The quiz admin still has to mark them by hand, so there's no result to show yet. Check back a little later.",
  pendingPartial: (score, graded, pending) =>
    `${score} of ${graded} app-checked questions correct. The other ${pending} still need the quiz admin to mark them by hand, so this isn't your final result yet.`,
  RESULT_AWAITING_MARKING: "Awaiting marking",
  RESULT_HIDDEN: "Results are hidden for this quiz — check with the quiz creator.",
  RESULT_ANSWER_REVIEW: "ANSWER REVIEW",
  RESULT_REVIEW_SUBTITLE: "Detailed question analysis and correct answers",
  RESULT_CANDIDATE: "Candidate:",
  resultCount: (total, scored, polls) =>
    polls > 0
      ? `${total} Question${total === 1 ? "" : "s"} (${scored} Scored + ${polls} Poll${polls === 1 ? "" : "s"})`
      : `${total} Question${total === 1 ? "" : "s"}`,
  RESULT_QUESTIONS_CORRECT: "Questions Correct",
  marksLine: (awarded, total) => `${awarded} / ${total} MARKS`,
  RESULT_STAT_CORRECT: "Correct",
  RESULT_STAT_INCORRECT: "Incorrect",
  RESULT_STAT_TIME: "Total Time",
  RESULT_STAT_HINTS: "Hints Used",
  qsCount: (n) => `${n} Qs`,
  secondsShort: (n) => `${n}s`,
  hintsUsed: (n) => `${n} Used`,
  tabAll: (n) => `All (${n})`,
  tabIncorrect: (n) => `Incorrect (${n})`,
  tabCorrect: (n) => `Correct (${n})`,
  tabPoll: (n) => `Poll (${n})`,
  TYPE_WRITTEN: "Written Response",
  TYPE_MULTI: "Multiple Correct (Checkbox)",
  TYPE_FILL: "Fill in the Blanks",
  TYPE_TF: "True / False",
  TYPE_SINGLE: "Single Choice MCQ",
  TYPE_POLL: "Poll",
  TYPE_POLL_CLOSED: "Poll Closed",
  TYPE_POLL_OPEN: "Poll Open",
  RESULT_YOUR_TYPED: "Your Typed Answer:",
  RESULT_ACCEPTED: "Accepted Answers:",
  RESULT_MATCH: "Match",
  RESULT_MISMATCH: "Mismatch",
  RESULT_TAG_YOUR_CORRECT: "Your Choice & Correct",
  RESULT_TAG_YOUR_CHOICE: "Your Choice",
  RESULT_TAG_CORRECT_ANSWER: "Correct Answer",
  RESULT_TAG_NOT_SELECTED: "Not Selected",
  RESULT_TF_YOUR_CORRECT: "✓ Your Choice (Correct)",
  RESULT_TF_YOUR_WRONG: "✗ Your Choice (Incorrect)",
  RESULT_TF_YOUR_PENDING: "Your Choice",
  RESULT_EXPLANATION: "Explanation:",
  RESULT_YOUR_VOTE: "Your Vote",
  pollPctVotes: (pct, n) => `${pct}% (${n} vote${n === 1 ? "" : "s"})`,
  pollRespondents: (n) => `Total respondents: ${n}`,
  POLL_UNSCORED: "Unscored reflection question",
  consensusStrong: (pct, option) => `🔥 Strong agreement — ${pct}% chose "${option}"`,
  consensusDivided: (a, b) => `⚖️ Split — "${a}" vs "${b}"`,
  consensusLeading: (option, pct) => `📊 "${option}" is leading with ${pct}%`,
  RESULT_RETAKE: "Retake Quiz",
  RESULT_PDF: "PDF Result",
  RESULT_NO_ANSWER: "(no answer)",
  RESULT_MARKS: "Marks",
  RESULT_CORRECT: "Correct",
  FEEDBACK_CORRECT: "✓ Correct!",
  FEEDBACK_WRONG: "✗ Wrong",
  RESULT_MARKS_BLURB: "Questions that carry marks, scored out of their total.",
  RESULT_CORRECT_ANSWERS: "Correct answers",
  RESULT_CORRECTNESS_BLURB: "Questions that carry no marks — just counted right or wrong.",
  questionPill: (index) => `Q${index}`,
  percent: (p) => `${p}%`,
  outOf: (total) => ` / ${total}`,
  marksFraction: (awarded, total) => `${awarded}/${total}`,
  pointsFraction: (awarded, total) => `${awarded}/${total} points`,
  timeTaken: (sec) => `${sec}s`,

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
