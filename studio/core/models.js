// Quiz + question shapes for the v2 creator pages.
//
// These mirror the Android models field for field, because both write the SAME Supabase
// rows — a quiz built here has to be takeable by the app and by deploy/take/. The
// authoritative references are:
//   • supabase/schema.sql (columns and the type check constraint)
//   • data/model/Models.kt, AnswerModels.kt, PollModels.kt, FillBlankModels.kt (JSONB shapes)
//   • ui/create/QuestionFormLogic.kt buildQuestionFromForm (what a saved question carries)
//   • ui/create/QuizDraftFactory.kt (what a saved quiz carries)
//
// Defaults below are the Kotlin defaults, not invented ones: a quiz saved from the web with
// untouched settings must behave exactly like one saved from the app.

/** The six types questions.type accepts — schema.sql's questions_type_check. */
export const QUESTION_TYPES = {
  SINGLE_CHOICE: "SINGLE_CHOICE",
  MULTIPLE_CORRECT: "MULTIPLE_CORRECT",
  TRUE_FALSE: "TRUE_FALSE",
  WRITTEN: "WRITTEN",
  FILL_BLANK: "FILL_BLANK",
  POLL: "POLL",
};

/** Ordered for the "add question" menu — commonest first, matching the app's list. */
export const QUESTION_TYPE_ORDER = [
  QUESTION_TYPES.SINGLE_CHOICE,
  QUESTION_TYPES.MULTIPLE_CORRECT,
  QUESTION_TYPES.TRUE_FALSE,
  QUESTION_TYPES.WRITTEN,
  QUESTION_TYPES.FILL_BLANK,
  QUESTION_TYPES.POLL,
];

/** Ids are client-generated and must be stable across edits, same as the app's. A UUID is
 *  what Room/Kotlin produces; crypto.randomUUID is in every browser this page supports. */
export function newId() {
  return crypto.randomUUID();
}

/** Share codes are generated client-side (QuizRepository.generateUniqueShareCode) and only
 *  checked for collisions server-side via the share_code_exists RPC.
 *
 *  Alphabet excludes characters that are easy to misread aloud or retype from a projector
 *  (O/0, I/1) — a share code's whole job is being read off a screen and typed by hand. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomShareCode(length = 6) {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

// ── AnswerRule (questions.answer_rule jsonb) ────────────────────────────────
// Mirrors AnswerModels.kt's AnswerRule defaults exactly. marksPattern defaults to
// ALL_OR_NOTHING deliberately: WEIGHTED_BY_SIMILARITY used to be the default and silently
// graded written answers on a curve (the G-01 bug). Don't "improve" this default.

export const MATCH_MODES = {
  STRICT_EXACT: "STRICT_EXACT",
  CASE_SENSITIVE_EXACT: "CASE_SENSITIVE_EXACT",
  FUZZY_TYPO_TOLERANT: "FUZZY_TYPO_TOLERANT",
  KEYWORD_MATCH: "KEYWORD_MATCH",
  NUMERIC_EQUIVALENT: "NUMERIC_EQUIVALENT",
};

export const MARKS_PATTERNS = {
  ALL_OR_NOTHING: "ALL_OR_NOTHING",
  HALF_FOR_PARTIAL: "HALF_FOR_PARTIAL",
  WEIGHTED_BY_SIMILARITY: "WEIGHTED_BY_SIMILARITY",
};

export function defaultAnswerRule() {
  return {
    matchModeList: [MATCH_MODES.FUZZY_TYPO_TOLERANT],
    aliasPairs: [],
    minSimilarity: 0.85,
    keywords: [],
    keywordCoverage: "ALL",
    showMatchedAgainst: true,
    revealTypoAcceptance: true,
    // No partialCreditEnabled: marksPattern alone decides what a partial match earns.
    marksPattern: MARKS_PATTERNS.ALL_OR_NOTHING,
  };
}

// ── PollSettings (questions.poll_settings jsonb) ────────────────────────────
// Mirrors PollModels.kt. showResultsToVoters is true by default matching PollModels.kt:28.

export function defaultPollSettings() {
  return {
    allowMultiple: true,
    anonymous: false,
    allowVoteChange: false,
    allowOther: false,
    askReason: false,
    shuffleOptions: false,
    noTimeLimit: false,
    showResultsToVoters: true,
  };
}

/** Quick-fill option sets for a poll. */
export const POLL_TEMPLATES = [
  ["Yes", "No"],
  ["Yes", "No", "Maybe"],
  ["Agree", "Neutral", "Disagree"],
  ["Strongly agree", "Agree", "Neutral", "Disagree", "Strongly disagree"],
  ["1", "2", "3", "4", "5"],
];

// ── FillBlankContent (questions.fill_blank jsonb) ───────────────────────────
// Mirrors FillBlankModels.kt. The template carries each blank inline as [[blankId]], e.g.
// "The capital of Pakistan is [[b1]]." — marker order in the template, not array order in
// `blanks`, defines the order answers are collected in. `title` is an optional heading.

export const FILL_BLANK_CHECKING = { FLEXIBLE: "FLEXIBLE", STRICT: "STRICT" };

const BLANK_MARKER = /\[\[([^[\]]*)\]\]/g;

/** Blank ids actually referenced by the template, in the order they appear. */
export function templateBlankIds(template) {
  BLANK_MARKER.lastIndex = 0;
  const ids = [];
  let match;
  while ((match = BLANK_MARKER.exec(template || "")) !== null) ids.push(match[1]);
  return ids;
}

/** questions.text for a fill-blank question: the template with every marker shown as a rule,
 *  so screens that only read the text still show something sensible (fillBlankPlainText). */
export function fillBlankPlainText(template) {
  return String(template ?? "").replace(BLANK_MARKER, "_____");
}

export function defaultFillBlankContent() {
  return { template: "", blanks: [], checking: FILL_BLANK_CHECKING.FLEXIBLE, title: null };
}

/** First entry of acceptedAnswers is the canonical answer; the rest are alternatives.
 *  `points` stays null unless the creator customises per-blank points. */
export function newBlank(canonicalAnswer = "") {
  return { id: newId().slice(0, 8), acceptedAnswers: [canonicalAnswer], points: null };
}

// ── Question ────────────────────────────────────────────────────────────────

/** Points default to 10, as in the app's builder (QuestionBuilderViewModel.kt:147). */
export const DEFAULT_POINTS = 10;
export const MAX_POINTS = 1000;

/** Question time presets for the builder, seconds; 0 = no limit. */
export const TIME_PRESETS = [10, 20, 30, 45, 60, 90, 120];

/** A fresh question of [type], carrying only the JSONB payloads its own type uses — the
 *  others stay null, matching how the app writes them. */
export function newQuestion(type, { orderIndex = 0, timeSec = 30, points = DEFAULT_POINTS } = {}) {
  const q = {
    id: newId(),
    type,
    text: "",
    options: null,
    correct: null,
    writtenAnswer: null,
    timeSec,
    points,
    orderIndex,
    hint: null,
    reason: null,
    answerRule: null,
    pollSettings: null,
    fillBlank: null,
    acceptAnyCorrect: false,
    // null = follow the quiz's Rapid Response Bonus. Always null on a poll.
    rapidBonus: null,
  };

  switch (type) {
    case QUESTION_TYPES.SINGLE_CHOICE:
    case QUESTION_TYPES.MULTIPLE_CORRECT:
      q.options = ["", ""];
      q.correct = [];
      break;
    case QUESTION_TYPES.TRUE_FALSE:
      // Stored as ordinary two-option data so grading needs no special case, same as the app
      // (defaultTrueFalseOptions: "True" starts as the correct one).
      q.options = ["True", "False"];
      q.correct = ["True"];
      break;
    case QUESTION_TYPES.WRITTEN:
      q.writtenAnswer = "";
      q.answerRule = defaultAnswerRule();
      break;
    case QUESTION_TYPES.FILL_BLANK:
      q.fillBlank = defaultFillBlankContent();
      break;
    case QUESTION_TYPES.POLL:
      q.options = ["", ""];
      q.pollSettings = defaultPollSettings();
      // A poll has no right answer, so it carries no marks.
      q.points = 0;
      break;
  }
  return q;
}

/** No answerable question has a time limit (QuizSetupSummary.kt:141) — the timer, preview and
 *  rapid bonus rules are greyed out then, with their saved values kept. */
export function hasOnlyUntimedQuestions(questions) {
  const answerable = questions.filter((q) => q.type !== QUESTION_TYPES.POLL);
  return answerable.length > 0 && answerable.every((q) => !(q.timeSec > 0));
}

// ── Quiz themes and reading time ────────────────────────────────────────────

/** QUIZ_THEME_COLORS (ui/theme/QuizThemeColors.kt) — `name` is what theme_color_name stores. */
export const QUIZ_THEMES = [
  { name: "Indigo", color: "#4F46E5" },
  { name: "Forest", color: "#16A34A" },
  { name: "Crimson", color: "#DC2626" },
  { name: "Teal", color: "#0F766E" },
  { name: "Amber", color: "#D97706" },
  { name: "Rose", color: "#BE185D" },
  { name: "Sky", color: "#0284C7" },
  { name: "Violet", color: "#7C3AED" },
  { name: "Orange", color: "#EA580C" },
  { name: "Cyan", color: "#0891B2" },
];

/** Unknown or unset names fall back to Indigo, like themeColorFromName. */
export function themeColor(name) {
  return (QUIZ_THEMES.find((theme) => theme.name === name) ?? QUIZ_THEMES[0]).color;
}

export const DEFAULT_PREVIEW_SEC = 5;
/** The reading times offered (Models.kt QUESTION_PREVIEW_OPTIONS); 0 = off. */
export const PREVIEW_OPTIONS = [5, 6, 8, 10];

/** normalizeQuestionPreviewSec: 0 and offered values are kept, anything else becomes 5. */
export function normalizePreviewSec(sec) {
  const n = Number(sec) || 0;
  if (n <= 0) return 0;
  return PREVIEW_OPTIONS.includes(n) ? n : DEFAULT_PREVIEW_SEC;
}

// ── Quiz ────────────────────────────────────────────────────────────────────

/** created_at/start_at/end_at are epoch MILLIS bigints, not timestamps — sending an ISO
 *  string here would be silently wrong. */
export function newQuiz() {
  return {
    id: newId(),
    ownerId: null,
    title: "",
    groupName: "",
    shareCode: "",
    defaultTimeSec: 30,
    // New quizzes start as drafts: is_draft=false is what "published" means, and a draft's
    // share code deliberately does not resolve for anyone but the owner.
    isDraft: true,
    isArchived: false,
    sortOrder: 2147483647,
    allowRetake: false,
    allowBack: false,
    // Off by default, like the app's new-quiz settings (CreateQuizViewModel.kt:47) —
    // turning it on asks first because it can leak answers. show_answers follows it.
    showResult: false,
    showAnswers: false,
    themeColorName: QUIZ_THEMES[0].name,
    createdAt: Date.now(),
    startAt: null,
    endAt: null,
    manualMarkingDefault: false,
    showCorrectnessInstantly: false,
    showQuestionNumbers: true,
    showTimers: true,
    splitPointsAcrossChoices: false,
    timeWeightageEnabled: false,
    questionPreviewSec: DEFAULT_PREVIEW_SEC,
    // Same defaults as the app's new quiz (Quiz.resultsReleaseMode / resultsReleasedAt).
    resultsReleaseMode: "AUTO",
    resultsReleasedAt: null,
  };
}

/** The public join link the app shares (ui/navigation/DeepLinks.kt JOIN_APP_LINK_BASE). It
 *  opens the app if installed, otherwise the live web take page. Only works once published. */
export function joinLink(shareCode) {
  return `https://quizoma.com/join?code=${encodeURIComponent(shareCode ?? "")}`;
}
