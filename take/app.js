// ============================================================================
// Web quiz-taking — mirrors ui/preview/QuizPreviewViewModel.kt's flow: load,
// per-question timer, answer, (optional) instant feedback, advance, score,
// submit. Poll rendering lands in a later pass (see the plan); it currently
// shows a "not available on web yet" placeholder with Skip. Fill Blank mirrors
// the app's inline sentence design exactly (see FillBlankQuestionBody.kt).
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
if (!window.Evaluator || !window.SupabaseClient || !window.FillBlank || !window.Poll) {
  app.innerHTML =
    '<div style="padding:24px;font-family:sans-serif;color:#DC2626">' +
    "<b>Couldn't load this page.</b><br><br>" +
    "A required script failed to load (often a slow/blocked connection to the Supabase library CDN). " +
    "Please check your connection and reload the page." +
    "</div>";
  throw new Error("QuizCode web: required globals missing (Evaluator/SupabaseClient/FillBlank/Poll) — aborting boot.");
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
const FB = window.FillBlank;
const PL = window.Poll;

const params = new URLSearchParams(window.location.search);
const shareCode = (params.get("code") || "").toUpperCase();

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  screen: "loading", // loading | landing | confirmName | quiz | finishing | result | error
  errorMessage: "",
  quiz: null,
  user: null,
  existingAttempt: null, // latest real attempt this user already has for this quiz, or null
  currentIndex: 0,
  selectedAnswers: new Set(), // index-strings, same convention as the Kotlin VM
  writtenAnswer: "",
  fillBlankDraft: [], // FILL_BLANK only — one entry per blank, in template order
  // POLL only — mirrors QuizPreviewUiState's poll* fields.
  pollState: null, // { status, opened_at, closes_at } | null
  pollDisplayOrder: [], // shuffled option indices, "Other" excluded (always last)
  pollSelected: new Set(), // numeric option indices, PL.POLL_OTHER_INDEX for "Other"
  pollOtherText: "",
  pollReasonText: "",
  pollHasVoted: false,
  pollDistribution: null, // set once the poll is closed
  pollConsensus: null,
  secondsRemaining: 0,
  totalTimeSec: 0,
  timerHandle: null,
  questionStartSec: 0,
  questionAnswers: {}, // questionId -> raw keys (index-strings / written text)
  questionTimings: {}, // questionId -> seconds
  instantFeedback: null,
  hintVisible: false, // current question's hint panel open/closed
  hintUsed: {}, // questionId -> true once its hint was opened (sticky, unlike hintVisible)
  result: null, // { score, total, answers }
  landingTickerHandle: null, // ticks the Scheduled-quiz countdown on the landing card
  hasJoined: false, // Join clicked (and joined_quizzes recorded) this session — gates Start Quiz
  joinError: null,
  joining: false,
};

function render() {
  // The landing countdown ticker only makes sense while its own card is on screen —
  // torn down the moment anything else renders, so it can never re-render (and wipe)
  // an unrelated screen the user has since navigated to (e.g. mid-typing in the quiz).
  if (state.screen !== "landing" && state.landingTickerHandle) {
    clearInterval(state.landingTickerHandle);
    state.landingTickerHandle = null;
  }
  app.innerHTML = "";
  switch (state.screen) {
    case "loading": return renderLoading();
    case "landing": return renderLanding();
    case "confirmName": return renderConfirmName();
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
 *  by hand, or via renderClosed's Close button when the browser will actually
 *  honor window.close() (see that function's doc — most tabs reached via a
 *  regular link tap don't qualify, so the button just doesn't render there). */
function leaveQuiz(message) {
  clearInterval(state.timerHandle);
  state.closedMessage = message;
  state.screen = "closed";
  render();
}

function renderClosed() {
  // window.close() only actually works when the browser considers this tab
  // "script-closable" — opened via window.open() (window.opener set) or with no
  // navigation history of its own (history.length <= 1, i.e. it never followed a
  // link to get here). The common case — tapping a regular share-code link — is
  // neither, so the button would silently no-op on click. A dead button is worse
  // than no button, so it's only rendered when the heuristic says it'll work.
  const canClose = window.opener != null || window.history.length <= 1;
  const children = [
    el("p", { style: "font-size:40px;margin:0" }, ["👋"]),
    el("h2", { class: "quiz-title" }, [state.closedMessage || "Thanks!"]),
    el("p", { class: "muted" }, ["You can close this tab now."]),
  ];
  if (canClose) {
    children.push(el("button", { class: "primary", style: "margin-top:8px", onclick: () => window.close() }, ["Close tab"]));
  }
  app.appendChild(
    el("div", { class: "screen centered" }, [
      el("div", { class: "card", style: "width:100%" }, children),
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

// ── Markdown (mirrors MarkdownParser.kt) — question text supports bold/italic/
// underline/strikethrough/code inline spans plus #/##/- block prefixes on Android
// (QuestionText's parseMarkdown), but this page just printed the raw "**text**"
// asterisks verbatim since none of that existed here at all. ─────────────────────

const MD_INLINE_MARKERS = [
  { marker: "**", tag: "strong" },
  { marker: "~~", tag: "s" },
  { marker: "__", tag: "u" },
  { marker: "*",  tag: "em" },
  { marker: "`",  tag: "code" },
];

/** Same left-to-right scan as appendInlineSpans() in MarkdownParser.kt: a dangling
 *  (unclosed) marker is silently dropped rather than shown literally, and a lone "*"
 *  that's actually the start of "**" is treated as a plain character so bold doesn't
 *  get misread as two nested italics. */
function appendInlineMarkdown(container, text, depth) {
  depth = depth || 0;
  if (depth > 6 || !text) {
    if (text) container.appendChild(document.createTextNode(text));
    return;
  }
  let i = 0;
  let plain = "";
  const flushPlain = () => {
    if (plain) { container.appendChild(document.createTextNode(plain)); plain = ""; }
  };
  while (i < text.length) {
    const def = MD_INLINE_MARKERS.find((d) => text.startsWith(d.marker, i));
    if (!def) { plain += text[i]; i++; continue; }
    if (def.marker === "*" && text.startsWith("**", i)) { plain += text[i]; i++; continue; }
    const openEnd = i + def.marker.length;
    const closeIdx = text.indexOf(def.marker, openEnd);
    if (closeIdx < 0) { i += def.marker.length; continue; }
    flushPlain();
    const span = document.createElement(def.tag);
    appendInlineMarkdown(span, text.slice(openEnd, closeIdx), depth + 1);
    container.appendChild(span);
    i = closeIdx + def.marker.length;
  }
  flushPlain();
}

/** Mirrors parseMarkdown() in MarkdownParser.kt. Returns a DOM fragment (not a string —
 *  building real <strong>/<em> nodes is the only way to get real formatting; this file
 *  has no innerHTML-from-markdown pipeline) ready to drop straight into el()'s children. */
function renderMarkdown(md) {
  const frag = document.createDocumentFragment();
  (md || "").split("\n").forEach((rawLine, idx) => {
    if (idx > 0) frag.appendChild(document.createElement("br"));
    let line = rawLine;
    let prefixText = "";
    let big = false;
    if (line.startsWith("## ")) { big = "sub"; line = line.slice(3); }
    else if (line.startsWith("# ")) { big = "main"; line = line.slice(2); }
    else if (line.startsWith("- ")) { prefixText = "• "; line = line.slice(2); }
    else {
      const numMatch = line.match(/^\d+\. /);
      if (numMatch) { prefixText = numMatch[0]; line = line.slice(numMatch[0].length); }
    }
    const lineSpan = document.createElement("span");
    if (big) { lineSpan.style.fontWeight = "700"; lineSpan.style.fontSize = big === "main" ? "1.25em" : "1.1em"; }
    if (prefixText) lineSpan.appendChild(document.createTextNode(prefixText));
    appendInlineMarkdown(lineSpan, line);
    frag.appendChild(lineSpan);
  });
  return frag;
}

/** Plain-text equivalent — mirrors stripMarkdown() in MarkdownParser.kt, used where a
 *  full render isn't wanted (short previews, list headers). */
function stripMarkdownText(md) {
  let s = (md || "")
    .replace(/^#{1,2} /gm, "")
    .replace(/^- /gm, "")
    .replace(/^\d+\. /gm, "");
  const inlinePatterns = [/\*\*(.*?)\*\*/g, /~~(.*?)~~/g, /__(.*?)__/g, /\*(.*?)\*/g, /`(.*?)`/g];
  for (let pass = 0; pass < 3; pass++) {
    inlinePatterns.forEach((p) => { s = s.replace(p, "$1"); });
  }
  return s;
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
      el("p", { class: "quiz-title" }, ["Oops, that didn't work"]),
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

  // Archived overrides schedule-based status entirely, same rule as the Android app's
  // ArchivedQuizStatusAction — the creator deliberately took this quiz out of
  // circulation, distinct from it simply having expired on its own schedule.
  if (quiz.isArchived) {
    body.push(el("p", { class: "muted" }, ["This quiz has been archived by its creator and is no longer accepting responses."]));
    appendLandingScreen(body);
    return;
  }

  if (status === "SCHEDULED") {
    // Ticks every second so a Scheduled quiz flips to Active on its own the moment the
    // start time arrives — same as JoinViewModel.startStatusTicker on Android — instead
    // of leaving the visitor stuck on a stale "hasn't started yet" until they reload.
    if (!state.landingTickerHandle) {
      state.landingTickerHandle = setInterval(render, 1000);
    }
    body.push(el("p", { class: "muted" }, [SC.countdownUntil(quiz.startAt)]));
    appendLandingScreen(body);
    return;
  }

  if (status !== "ACTIVE") {
    body.push(el("p", { class: "muted" }, ["This quiz has ended."]));
    appendLandingScreen(body);
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
  } else if (state.existingAttempt && !quiz.allowRetake) {
    // Same rule as JoinScreen.kt's alreadyDoneAndLocked — a completed attempt
    // already exists and this quiz doesn't allow retakes, so don't offer Start.
    body.push(
      signedInLine(state.user),
      el("p", { class: "muted" }, ["You've already completed this quiz. Retakes aren't allowed."]),
      el("p", { class: "quiz-meta" }, [`Your score: ${state.existingAttempt.score} / ${state.existingAttempt.total}`]),
      signOutRow()
    );
  } else if (!state.hasJoined) {
    // Join is its own step, separate from Start — records membership (joined_quizzes)
    // right away so the owner's Participants tab sees this person the moment they join,
    // same as joining by code in the app, rather than only once they actually finish
    // answering something.
    body.push(
      signedInLine(state.user),
      el("button", { class: "primary", onclick: joinQuizAction }, [state.joining ? "Joining…" : "Join"])
    );
    if (state.joinError) {
      body.push(el("p", { class: "muted", style: "color:var(--error)" }, [state.joinError]));
    }
    body.push(signOutRow());
  } else {
    body.push(
      signedInLine(state.user),
      el("button", { class: "primary", onclick: startQuiz }, ["Start Quiz"]),
      signOutRow()
    );
  }

  appendLandingScreen(body);
}

/** Small, clean version label under the Join card — mirrors the Android app's own
 *  drawer version text (BuildConfig.VERSION_NAME), just visible without digging into a
 *  menu since this page has no drawer. Bump WEB_VERSION by hand alongside meaningful
 *  releases. BUILD_NUMBER is read straight off this very file's own `?v=N` cache-buster
 *  (index.html's <script src="app.js?v=N">) via import.meta.url — no separate constant
 *  to remember to bump, it just always matches whatever was last deployed, so seeing it
 *  change on screen is a real, unfakeable confirmation that a fresh deploy actually
 *  landed (as opposed to the browser still running a cached copy of this file). */
const WEB_VERSION = "1.0";
const BUILD_NUMBER = new URL(import.meta.url).searchParams.get("v") || "?";

function appendLandingScreen(body) {
  app.appendChild(
    el("div", { class: "screen" }, [
      el("div", { class: "card" }, body),
      el("p", { class: "app-version" }, [`v${WEB_VERSION} (build ${BUILD_NUMBER})`]),
    ])
  );
}

/** One-time gate right after a brand-new signup (profiles.name_confirmed = false) —
 *  mirrors the Android app's ConfirmNameScreen. Blocking, no skip: some Google
 *  accounts have the wrong/nickname-y name attached, and this is what the quiz
 *  creator and other participants will see this person as everywhere else. */
function renderConfirmName() {
  if (state.confirmNameDraft == null) {
    state.confirmNameDraft = SC.resolveDisplayName(state.user);
  }
  const trimmed = (state.confirmNameDraft || "").trim();

  const input = el("input", {
    type: "text",
    value: state.confirmNameDraft || "",
    placeholder: "Your name",
    autocomplete: "name",
    oninput: (e) => {
      state.confirmNameDraft = e.target.value;
      saveBtn.disabled = state.confirmNameSaving || e.target.value.trim().length === 0;
    },
  });

  const saveBtn = el(
    "button",
    { class: "primary", onclick: () => submitConfirmedName() },
    [state.confirmNameSaving ? "Saving…" : "Confirm & Continue"]
  );
  saveBtn.disabled = state.confirmNameSaving || trimmed.length === 0;

  const body = [
    el("span", { class: "pill" }, ["ONE QUICK THING"]),
    el("h2", { class: "quiz-title" }, ["Confirm your name"]),
    el("p", { class: "quiz-meta" }, [
      "This is the name shown on your quizzes and results — some Google accounts have the wrong name attached, so fix it here if needed.",
    ]),
    input,
  ];
  if (state.confirmNameError) {
    body.push(el("p", { class: "muted", style: "color:var(--error)" }, [state.confirmNameError]));
  }
  body.push(saveBtn);

  app.appendChild(el("div", { class: "screen" }, [el("div", { class: "card" }, body)]));
}

async function submitConfirmedName() {
  const name = (state.confirmNameDraft || "").trim();
  if (!name || state.confirmNameSaving) return;
  state.confirmNameSaving = true;
  state.confirmNameError = null;
  render();
  try {
    await SC.confirmDisplayName(state.user.id, name);
    // Keep the in-memory user in sync so the "Signed in as ..." line on the landing
    // screen right after this reflects the corrected name without a re-fetch.
    state.user.user_metadata = { ...(state.user.user_metadata || {}), full_name: name, name };
    state.confirmNameSaving = false;
    state.screen = "landing";
    render();
  } catch (e) {
    state.confirmNameSaving = false;
    state.confirmNameError = "Couldn't save your name. Check your connection and try again.";
    render();
  }
}

function currentQuestion() {
  return state.quiz.questions[state.currentIndex];
}

function signedInLine(user) {
  return el("p", { class: "muted" }, [`Signed in as ${SC.resolveDisplayName(user)}`]);
}

/** "Sign out" escape hatch — wrong Google account picked, or just wants to switch,
 *  shouldn't mean reloading the tab and hunting for a way out. Deliberately its own
 *  full-width row below the primary action (Join/Start), separated by a divider line —
 *  sitting right next to that button risked a mis-tap signing someone out by accident. */
function signOutRow() {
  return el("div", { class: "sign-out-row" }, [
    el("button", { class: "skip-link", onclick: signOutAction }, ["Not you? Sign out"]),
  ]);
}

async function signOutAction() {
  await SC.signOut();
  // Back to square one on this same landing card — sign-in button reappears, and any
  // in-progress Join/Start state for the account that just signed out no longer applies.
  state.user = null;
  state.hasJoined = false;
  state.joinError = null;
  state.existingAttempt = null;
  render();
}

async function joinQuizAction() {
  if (state.joining) return;
  // The landing card was rendered once when the quiz was still Active and doesn't
  // re-render on its own while sitting open (only a Scheduled countdown ticks) — so a
  // tab left open past the deadline could still fire this write. Re-check live, right
  // before the write, instead of trusting whatever status the button was drawn under.
  if (SC.effectiveStatus(state.quiz) !== "ACTIVE") {
    render();
    return;
  }
  state.joining = true;
  state.joinError = null;
  render();
  try {
    await SC.joinQuiz(state.user.id, state.quiz.id);
    state.hasJoined = true;
  } catch (e) {
    state.joinError = "Couldn't join — check your connection and try again.";
  }
  state.joining = false;
  render();
}

function startQuiz() {
  // Same re-check as joinQuizAction, for the same reason — a tab left open past the
  // deadline must not be able to start (and then submit) a quiz that's since ended,
  // just because the button was drawn while it was still Active.
  if (SC.effectiveStatus(state.quiz) !== "ACTIVE") {
    render();
    return;
  }
  state.currentIndex = 0;
  state.screen = "quiz";
  render();
  prepareCurrentQuestion();
}

function prepareCurrentQuestion() {
  const q = currentQuestion();
  state.selectedAnswers = new Set();
  state.writtenAnswer = "";
  state.fillBlankDraft = q.type === "FILL_BLANK" && q.fillBlankContent
    ? new Array(FB.orderedBlanks(q.fillBlankContent).length).fill("")
    : [];
  state.instantFeedback = null;
  state.hintVisible = false;
  state.questionStartSec = Math.floor(Date.now() / 1000);
  if (q.type === "POLL") {
    state.pollState = null;
    state.pollDisplayOrder = [];
    state.pollSelected = new Set();
    state.pollOtherText = "";
    state.pollReasonText = "";
    state.pollHasVoted = false;
    state.pollDistribution = null;
    state.pollConsensus = null;
    state.totalTimeSec = 0; // reset; loadPollForCurrentQuestion starts this taker's own
    state.secondsRemaining = 0; // countdown once the poll is known to be open
    render(); // loading state while ensurePollOpen/fetchPollVotes round-trip
    loadPollForCurrentQuestion(q);
    return;
  }
  startTimer();
  render();
}

/** Opens the poll on first visit (lazy — mirrors PollRepository.ensureOpen:
 *  the poll's clock starts the first time ANYONE, on any device, reaches this
 *  question), pre-fills this voter's own existing vote if they've been here
 *  before, and computes the static distribution once closed. Mirrors
 *  QuizPreviewViewModel.loadPollForCurrentQuestion() exactly. */
async function loadPollForCurrentQuestion(q) {
  const settings = q.pollSettings || {};
  let opened;
  try {
    opened = await SC.ensurePollOpen(q.id);
  } catch (e) {
    // RLS rejects a non-owner's very first open (poll_states writes are
    // owner-only — same latent gap the Android app has today, see schema.sql).
    // Falls back to a local-only "just opened now" state so voting still works
    // for this visitor even though it never reaches other devices.
    opened = { status: "OPEN", opened_at: Date.now(), closes_at: null };
  }
  // Stale question guard — the user may have already swiped past this question
  // (Next/timer) by the time this async round-trip resolves.
  if (currentQuestion()?.id !== q.id) return;

  // Only an explicit close counts. A passed closes_at used to close the poll for everyone,
  // which meant the first person to reach the question locked out everyone who arrived
  // later — see PollState.closesAt in PollModels.kt.
  const effectiveClosed = opened.status === "CLOSED";
  state.pollState = opened;

  const votes = (await SC.fetchPollVotes(q.id).catch(() => [])) || [];
  const myVote = votes.find((v) => v.voterKey === state.user.id) || null;
  state.pollHasVoted = myVote != null;
  if (myVote) {
    state.pollSelected = new Set(myVote.selectedOptionIndices || []);
    state.pollOtherText = myVote.otherText || "";
    state.pollReasonText = myVote.reason || "";
  }

  if (effectiveClosed) {
    const distribution = PL.computePollDistribution(q.options || [], votes);
    state.pollDistribution = distribution;
    state.pollConsensus = PL.computePollConsensus(distribution);
  } else {
    const optionCount = (q.options || []).length;
    state.pollDisplayOrder = settings.shuffleOptions
      ? PL.pollShuffledOrder(state.user.id, q.id, optionCount)
      : Array.from({ length: optionCount }, (_, i) => i);
    // This taker's own countdown, starting now — the same per-question timer every other
    // question type gets. When it runs out it just advances them; it never closes the poll.
    // Same quiz-wide "Show Timer" gate as startTimer() — was missing here too.
    const pollTimeSec = (!state.quiz.showTimers || settings.noTimeLimit) ? 0 : (q.timeSec || 0);
    if (pollTimeSec > 0) {
      state.totalTimeSec = pollTimeSec;
      state.secondsRemaining = pollTimeSec;
      state.timerHandle = setInterval(() => {
        state.secondsRemaining -= 1;
        if (state.secondsRemaining <= 0) {
          clearInterval(state.timerHandle);
          advance(true);
          return;
        }
        updateTimerDisplay();
      }, 1000);
    } else {
      state.totalTimeSec = 0;
      state.secondsRemaining = 0;
    }
  }
  render();
}

function startTimer() {
  clearInterval(state.timerHandle);
  const q = currentQuestion();
  // Mirrors QuizPreviewViewModel.prepareCurrentQuestion: `if (s0.quizShowTimers && ...)
  // question.timeSec else 0` — quiz-wide, no per-question override. This was never
  // checked here at all before, so turning "Show Timer" off on the quiz had no effect
  // on web: every question still ran its own timeSec countdown regardless.
  const timeSec = state.quiz.showTimers ? q.timeSec : 0;
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
  // Same element-mutation-in-place trick as #timer-fill above (not a full re-render) —
  // this is what lets the CSS transition below actually animate every tick instead of
  // snapping, since the element persists across ticks instead of being torn down.
  const segFill = document.getElementById("current-progress-fill");
  if (segFill) {
    segFill.style.width = `${((state.totalTimeSec - state.secondsRemaining) / state.totalTimeSec) * 100}%`;
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

/** Poll's own toggle — separate from toggleAnswer() since options are already
 *  cast, and this respects allowMultiple + the "Other" sentinel index (-1)
 *  instead of the plain single/multi rule every other question type uses. */
function togglePollOption(optionIndex) {
  const q = currentQuestion();
  const settings = q.pollSettings || {};
  const locked = state.pollHasVoted && settings.allowVoteChange === false;
  if (locked) return;
  if (settings.allowMultiple) {
    if (state.pollSelected.has(optionIndex)) state.pollSelected.delete(optionIndex);
    else state.pollSelected.add(optionIndex);
  } else {
    state.pollSelected = state.pollSelected.has(optionIndex) ? new Set() : new Set([optionIndex]);
  }
  render();
}

// Skip and Next both advance, but only Next casts whatever's selected on a
// Poll question — a skipped poll is left unvoted, even if an option was
// tapped first, mirroring QuizPreviewViewModel's onSkip()/onNext() split.
function onNext() { advance(true); }
function onSkip() { advance(false); }

function advance(castPollVote) {
  if (state.instantFeedback) return; // already mid-feedback — ignore stray taps
  const q = currentQuestion();
  clearInterval(state.timerHandle);

  if (q.type === "POLL") {
    const settings = q.pollSettings || {};
    const locked = state.pollHasVoted && settings.allowVoteChange === false;
    if (castPollVote && !locked && state.pollSelected.size > 0 && state.pollState) {
      const vote = {
        questionId: q.id,
        voterKey: state.user.id,
        selectedOptionIndices: Array.from(state.pollSelected),
        otherText: state.pollSelected.has(PL.POLL_OTHER_INDEX) ? state.pollOtherText : null,
        reason: state.pollReasonText || null,
        participantId: settings.anonymous ? null : state.user.id,
      };
      SC.castPollVote(vote).catch(() => {}); // fire-and-forget, same as the app
    }
    proceedPastQuestion();
    return;
  }

  const elapsed = Math.max(1, Math.floor(Date.now() / 1000) - state.questionStartSec);
  state.questionTimings[q.id] = elapsed;
  if (q.type === "WRITTEN") {
    state.questionAnswers[q.id] = state.writtenAnswer.trim() ? [state.writtenAnswer] : [];
  } else if (q.type === "FILL_BLANK") {
    state.questionAnswers[q.id] = [...state.fillBlankDraft];
  } else {
    state.questionAnswers[q.id] = Array.from(state.selectedAnswers);
  }

  const quiz = state.quiz;
  // Never flash right/wrong on a question the owner marks by hand — nobody has decided
  // yet, so any verdict shown here would be a guess we'd have to take back.
  if (quiz.showCorrectnessInstantly && !requiresManualMarking(q, quiz)) {
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
    if (userInput.trim()) {
      // No expected answer was ever set — nothing to grade against, so any attempt
      // at all counts as correct rather than being auto-failed.
      if (!expected.trim()) {
        correct = true;
      } else {
        const rule = q.answerRule || defaultAnswerRule();
        // Math.max(points, 1): see finishQuiz — a no-marks question would otherwise
        // multiply every verdict down to zero and always read as wrong.
        correct = computeScore(evaluate(userInput, expected, rule), Math.max(q.points, 1), rule) > 0;
      }
    }
    return { isCorrect: correct, correctWrittenAnswer: !correct && expected.trim() ? expected : null };
  }
  if (q.type === "FILL_BLANK" && q.fillBlankContent) {
    const blankCorrectness = FB.fillBlankCorrectness(q.fillBlankContent, rawKeys);
    return { isCorrect: blankCorrectness.length > 0 && blankCorrectness.every(Boolean), blankCorrectness };
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

/** Mirrors Grading.kt's requiresManualMarking: all-or-nothing at the quiz level, no
 *  per-question override. Polls are never hand-marked — nothing to be right about. */
function requiresManualMarking(q, quiz) {
  return q.type !== "POLL" && quiz.manualMarkingDefault === true;
}

async function finishQuiz() {
  state.screen = "finishing";
  render();

  // Mirrors QuizPreviewViewModel.finishPreview on Android — the landing/Start-Quiz status
  // check only ever ran once, when this taker opened the quiz; it has no way to know the
  // owner ended it (manually, or its own schedule ran out) sometime after that, while this
  // taker was still mid-quiz answering. Re-fetch fresh here, right before the submission
  // would otherwise land, instead of trusting the possibly-stale state.quiz already in memory.
  const liveStatus = await SC.fetchQuizStatus(state.quiz.id);
  if (liveStatus && (liveStatus.isArchived || SC.effectiveStatus(liveStatus) !== "ACTIVE")) {
    state.errorMessage = "The owner closed this quiz, or its scheduled time ran out, while you were still answering — so this submission can no longer go through.";
    state.screen = "error";
    render();
    return;
  }

  // Mirrors QuizPreviewViewModel.finishPreview on Android — an owner's remove-participant
  // action deletes this taker's joined_quizzes row remotely at any point during the quiz,
  // and nothing earlier in this flow would know. `=== false` specifically (not `!== true`):
  // null means the check itself failed (offline/error), which must never itself block a
  // legitimate submission — only a confirmed "no" does.
  if ((await SC.isJoined(state.quiz.id, state.user.id)) === false) {
    state.errorMessage = "This quiz's owner removed you from it, so this submission can no longer go through.";
    state.screen = "error";
    render();
    return;
  }

  const evaluator = window.Evaluator;
  const scored = state.quiz.questions.filter((q) => q.type !== "POLL");
  const answers = scored.map((q) => {
    const rawKeys = state.questionAnswers[q.id] || [];
    let given;
    if (q.type === "WRITTEN" || q.type === "FILL_BLANK") given = rawKeys;
    else given = rawKeys.map((k) => (q.options || [])[Number(k)]).filter((v) => v !== undefined);

    // Hand-marked questions skip evaluation entirely and submit as pending, exactly as
    // QuizPreviewViewModel.finishPreview does. Grading them here would hand the taker a
    // verdict the owner never gave — and one the owner's marking would then overwrite.
    const isManual = requiresManualMarking(q, state.quiz);

    let isCorrect = false;
    // Populated only for an auto-graded WRITTEN answer with something on both sides to
    // actually compare — mirrors Android's evalResult, which is likewise null for the
    // trivial blank-input/blank-expected-answer cases. Used by the review card to show
    // the same status label/points/word-by-word detail Android's WrittenEvalRow does,
    // instead of a flat correct/wrong line with no explanation of *why*.
    let evaluationResult = null;
    if (!isManual) {
      if (q.type === "WRITTEN") {
        const userInput = given[0] || "";
        const expected = q.writtenAnswer || "";
        if (!userInput.trim()) {
          isCorrect = false;
        } else if (!expected.trim()) {
          // No expected answer was ever set — any attempt counts as correct.
          isCorrect = true;
        } else {
          const rule = q.answerRule || defaultAnswerRule();
          evaluationResult = evaluator.evaluate(userInput, expected, rule);
          // Math.max(points, 1): computeScore multiplies by points, so a no-marks
          // question (points = 0) would grade every answer as wrong no matter what.
          isCorrect = evaluator.computeScore(evaluationResult, Math.max(q.points, 1), rule) > 0;
        }
      } else if (q.type === "FILL_BLANK") {
        isCorrect = q.fillBlankContent ? FB.fillBlankIsQuestionCorrect(q.fillBlankContent, given) : false;
      } else {
        const a = new Set(given), b = new Set(q.correctAnswers || []);
        isCorrect = a.size === b.size && [...a].every((x) => b.has(x));
      }
    }

    return {
      questionId: q.id,
      isCorrect,
      givenAnswers: given,
      timeTakenSec: state.questionTimings[q.id] || 0,
      needsManualMarking: isManual,
      // null on a manual answer is what marks it pending; an auto-graded one banks its
      // marks now (full points when right, none when wrong).
      awardedPoints: isManual ? null : (isCorrect ? q.points : 0),
      maxPoints: q.points,
      usedHint: state.hintUsed[q.id] === true,
      // In-memory only for this same-session review — attempt_answers has no column for
      // it (mirrors what's actually persisted), same as Android's evalResult isn't
      // re-derivable after the fact either without re-running the evaluator.
      evaluationResult,
    };
  });

  // Pending answers can't count yet — the owner's marking recomputes this server-side.
  const score = answers.filter((a) => a.isCorrect && !a.needsManualMarking).length;

  SC.submitAttempt(state.quiz.id, state.user.id, score, scored.length, answers)
    .then(() => {
      state.result = { score, total: scored.length, answers };
      state.screen = "result";
      render();
    })
    .catch((err) => {
      // Backstop for a race (e.g. two tabs submitting at once) — the landing-page
      // check above normally catches this first, but the server is the real guard.
      state.errorMessage = err.message === "RETAKE_NOT_ALLOWED"
        ? "This quiz doesn't allow retakes, and you've already completed it."
        : "Couldn't save your result: " + (err.message || err);
      state.screen = "error";
      render();
    });
}

/** Top bar: X close, title, timer chip — mirrors QuizPreviewScreen's PreviewTopBar. */
function buildQuizTopBar(quiz, q) {
  const closeBtn = el("button", { class: "icon-btn", onclick: () => { if (confirm("Leave this quiz? Your progress won't be saved.")) leaveQuiz("Quiz closed"); } }, []);
  closeBtn.appendChild(html(CLOSE_X_SVG));

  // Reserved-width slot either way, so the title stays centered whether or not
  // this question has a timer. Gated on quiz.showTimers too, not just q.timeSec — an
  // empty timer-chip pill was rendering (and reserving layout space) even with the
  // quiz-wide "Show Timer" setting off, since this check ignored it entirely.
  const right = quiz.showTimers && q.timeSec > 0
    ? el("div", { id: "timer-chip", class: "timer-chip" }, [])
    : el("div", { style: "width:36px" }, []);

  return el("div", { class: "quiz-topbar" }, [closeBtn, el("span", { class: "title" }, [quiz.title]), right]);
}

/** One segment per question (Stories-style) rather than a single continuous bar —
 *  answered questions read as fully filled, the current one mid-fill, upcoming
 *  ones empty, so progress through the quiz is legible at a glance. */
// Tracks which question index last actually played its no-timer fill animation —
// renderQuiz() re-runs (and so re-calls this) on EVERY state change while a question is
// on screen (picking an option, typing, revealing a hint), not just on advancing to a
// new one. Without this guard, every full-DOM rebuild (see this file's render() doc)
// would recreate the current segment's fill element from scratch and replay its
// animation on every incidental click, instead of playing once when the question is
// actually reached.
let lastAnimatedProgressIndex = -1;

/** Current segment's fill tracks elapsed time within the question (Stories-style — the
 *  bar drains AS time passes, not "instantly filled the moment you arrive"), when the
 *  question actually has a timer running. Gets a stable id so updateTimerDisplay can
 *  keep nudging its width every tick the same way it already does #timer-fill, instead
 *  of a one-shot animation — that's what makes it track the countdown continuously
 *  rather than jumping once. Untimed questions (no timer to track) fall back to the
 *  one-shot "just arrived" fill instead, since there's nothing to animate against.
 */
function buildQuestionProgressBar(quiz) {
  const total = quiz.questions.length;
  const isNewQuestion = lastAnimatedProgressIndex !== state.currentIndex;
  lastAnimatedProgressIndex = state.currentIndex;
  const timed = state.totalTimeSec > 0;
  const segments = [];
  for (let i = 0; i < total; i++) {
    let fillPct = 0;
    let animate = false;
    let segId = null;
    if (i < state.currentIndex) {
      fillPct = 100;
    } else if (i === state.currentIndex) {
      if (timed) {
        fillPct = ((state.totalTimeSec - state.secondsRemaining) / state.totalTimeSec) * 100;
        segId = "current-progress-fill";
      } else {
        // No timer on this question — nothing to track, so it just reads as "reached"
        // the same way completed segments do, via a one-shot @keyframes fill (CSS
        // `transition` can't animate this — a fresh element every render has nothing to
        // transition FROM, see the hint-box/instant-correctness fix earlier this session).
        fillPct = 100;
        animate = isNewQuestion;
      }
    }
    const props = { class: "progress-segment-fill" + (animate ? " filling" : ""), style: `width:${fillPct}%` };
    if (segId) props.id = segId;
    segments.push(el("div", { class: "progress-segment" }, [el("div", props)]));
  }
  return el("div", { class: "progress-track segmented" }, segments);
}

/** Bottom action bar: timer progress bar pinned above it, Skip + Next — mirrors
 *  QuizPreviewScreen's PreviewBottomBar. */
function buildBottomBar(q, isLastQuestion, onSkipFn, onNextFn) {
  const rows = [];
  // state.totalTimeSec, not q.timeSec — it's already the single source of truth computed
  // at question-load time (startTimer/loadPollForCurrentQuestion), correctly folding in
  // quiz.showTimers and a poll's own noTimeLimit; q.timeSec alone ignores both.
  if (state.totalTimeSec > 0) {
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

  // Hint — only shown when this question actually has one (mirrors PreviewBottomBar's
  // hasHint gate on Android). Left slot always reserved so Skip/Next don't shift when a
  // question without a hint follows one that had it.
  const barRow = el("div", { class: "bar-row" }, []);
  if (q.hint) {
    const hintBtn = el("button", { class: "hint-btn", onclick: showHintAction }, ["💡 Hint"]);
    if (disabled) hintBtn.disabled = true;
    barRow.appendChild(hintBtn);
  } else {
    barRow.appendChild(el("div", { style: "width:56px" }, []));
  }
  barRow.appendChild(skipBtn);
  barRow.appendChild(nextBtn);
  rows.push(barRow);
  return el("div", { class: "quiz-bottombar" }, rows);
}

/** Mirrors QuizPreviewViewModel.onShowHint — marks this question's hint as used the
 *  moment it's opened (not only if the taker reads all the way through), and reveals it
 *  inline (see renderQuiz's hint-box, right below the question) rather than a popup, to
 *  keep this file's plain-DOM approach — no modal/bottom-sheet primitive exists here. */
function showHintAction() {
  if (state.instantFeedback) return;
  const q = currentQuestion();
  state.hintVisible = true;
  state.hintUsed[q.id] = true;
  render();
}

/** Inline hint reveal — mirrors HintSheetContent's "Got it" dismiss, just inline instead
 *  of a bottom sheet (see showHintAction's doc for why). */
function buildHintBox(hint) {
  return el("div", { class: "hint-box" }, [
    el("div", { class: "hint-box-header" }, [
      el("span", { class: "hint-box-title" }, ["💡 Hint"]),
      el("button", { class: "skip-link", onclick: () => { state.hintVisible = false; render(); } }, ["Got it"]),
    ]),
    el("p", { class: "hint-box-text" }, [hint]),
  ]);
}

/** Mirrors QuizPreviewScreen.kt's QuestionLabel — "QUESTION X OF N" plus a "Select all
 *  that apply" pill for MULTIPLE_CORRECT — gated by quiz.showQuestionNumbers. Was never
 *  implemented on web at all before (the setting synced to Supabase but had zero effect
 *  here, unlike Android where it's genuinely wired), so toggling it never did anything. */
function buildQuestionNumberLabel(quiz, q) {
  const children = [
    el("span", { class: "question-number-label" }, [`QUESTION ${state.currentIndex + 1} OF ${quiz.questions.length}`]),
  ];
  if (q.type === "MULTIPLE_CORRECT") {
    children.push(el("span", { class: "select-all-badge" }, ["Select all that apply"]));
  }
  return el("div", { class: "question-number-row" }, children);
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

  if (q.type === "POLL") {
    const questionArea = el("div", { class: "screen no-pad-top", style: "flex:1" }, [
      ...(quiz.showQuestionNumbers ? [buildQuestionNumberLabel(quiz, q)] : []),
      el("div", { class: "card" }, [el("p", { class: "question-text" }, [renderMarkdown(q.text)])]),
    ]);
    if (!state.pollState) {
      questionArea.appendChild(el("p", { class: "muted" }, ["Loading…"]));
    } else if (state.pollDistribution) {
      questionArea.appendChild(buildPollResults(q));
    } else {
      questionArea.appendChild(buildPollVoting(q));
    }
    wrapper.appendChild(questionArea);
    wrapper.appendChild(buildBottomBar(q, isLastQuestion, onSkip, onNext));
    app.appendChild(wrapper);
    updateTimerDisplay();
    return;
  }

  // Fill Blank has an optional heading instead of a mandatory question text —
  // absent entirely when the creator left it blank, rather than falling back to
  // the auto-generated underscore sentence (that's already shown, interactively,
  // in the sentence card itself). Mirrors QuizPreviewScreen.kt's same condition.
  const fillBlankTitle = q.type === "FILL_BLANK" ? (q.fillBlankContent?.title || "").trim() : "";
  const showTitleCard = q.type !== "FILL_BLANK" || fillBlankTitle;
  const questionArea = el("div", { class: "screen no-pad-top", style: "flex:1" }, [
    ...(quiz.showQuestionNumbers ? [buildQuestionNumberLabel(quiz, q)] : []),
    ...(showTitleCard
      ? [el("div", { class: "card" }, [el("p", { class: "question-text" }, [renderMarkdown(fillBlankTitle || q.text)])])]
      : []),
  ]);

  if (q.hint && state.hintVisible) {
    questionArea.appendChild(buildHintBox(q.hint));
  }

  if (q.type === "FILL_BLANK") {
    // Unlike WRITTEN/options (which swap their whole input away for a banner
    // during feedback), the sentence itself always stays on screen — it's just
    // as much the answer *display* as it is the input, so it renders its own
    // correct/wrong coloring inline rather than disappearing behind a banner.
    if (q.fillBlankContent) {
      questionArea.appendChild(buildFillBlankSentence(q));
    }
    if (state.instantFeedback) {
      const fb = state.instantFeedback;
      questionArea.appendChild(
        el("div", { class: "feedback-banner " + (fb.isCorrect ? "correct" : "wrong") }, [fb.isCorrect ? "✓ Correct!" : "✗ Wrong"])
      );
      const ordered = q.fillBlankContent ? FB.orderedBlanks(q.fillBlankContent) : [];
      ordered.forEach((blank, i) => {
        if (fb.blankCorrectness && fb.blankCorrectness[i] === false) {
          const correctAnswer = (blank.acceptedAnswers || [])[0];
          if (correctAnswer) {
            questionArea.appendChild(
              el("p", { class: "fb-answer-reveal" }, [`Blank ${i + 1} — Correct answer: ${correctAnswer}`])
            );
          }
        }
      });
    }
  } else if (state.instantFeedback) {
    const fb = state.instantFeedback;
    questionArea.appendChild(
      el("div", { class: "feedback-banner " + (fb.isCorrect ? "correct" : "wrong") }, [fb.isCorrect ? "✓ Correct!" : "✗ Wrong"])
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
  wrapper.appendChild(buildBottomBar(q, isLastQuestion, onSkip, onNext));
  app.appendChild(wrapper);
  updateTimerDisplay();
}

// ── Poll — voting + results (mirrors PollComponents.kt's PollVotingBody /
// PollDistributionBody: options in the per-voter shuffled order, "Other" and
// "Why?" fields, then a static percent-bar distribution once closed). ───────

function buildPollVoting(q) {
  const settings = q.pollSettings || {};
  const locked = state.pollHasVoted && settings.allowVoteChange === false;
  const container = el("div", { style: "display:flex;flex-direction:column;gap:10px" }, []);

  if (settings.allowMultiple && !locked) {
    container.appendChild(el("p", { class: "poll-note" }, ["Select all that apply"]));
  }

  const optionRow = (idx, label) => {
    const selected = state.pollSelected.has(idx);
    const props = {
      class: "option-row" + (selected ? " selected" : ""),
      style: locked ? "cursor:default;opacity:0.65" : "",
    };
    if (!locked) props.onclick = () => togglePollOption(idx);
    return el("div", props, [
      el("div", { class: "option-marker" + (settings.allowMultiple ? " square" : "") }, selected ? [html(CHECK_SVG)] : []),
      el("span", {}, [label]),
    ]);
  };

  state.pollDisplayOrder.forEach((idx) => {
    container.appendChild(optionRow(idx, (q.options || [])[idx]));
  });

  if (settings.allowOther) {
    const otherSelected = state.pollSelected.has(PL.POLL_OTHER_INDEX);
    container.appendChild(optionRow(PL.POLL_OTHER_INDEX, "Other"));
    if (otherSelected) {
      const otherProps = {
        type: "text",
        placeholder: "Type your answer…",
        value: state.pollOtherText,
        oninput: (e) => { state.pollOtherText = e.target.value; },
      };
      if (locked) otherProps.disabled = "true";
      container.appendChild(el("input", otherProps));
    }
  }

  if (settings.askReason && state.pollSelected.size > 0) {
    const reasonProps = {
      rows: "2",
      placeholder: "Why? (optional)",
      oninput: (e) => { state.pollReasonText = e.target.value; },
    };
    if (locked) reasonProps.disabled = "true";
    container.appendChild(el("textarea", reasonProps, state.pollReasonText ? [state.pollReasonText] : []));
  }

  if (state.pollHasVoted) {
    container.appendChild(el("p", { class: "poll-voted-check" }, ["✓ You voted"]));
    if (locked) container.appendChild(el("p", { class: "poll-note" }, ["Results are shown once the poll closes."]));
  } else if (state.pollSelected.size > 0) {
    container.appendChild(el("p", { class: "poll-note" }, ["Tap Next to cast your vote."]));
  }

  return container;
}

function buildPollResults(q) {
  const dist = state.pollDistribution;
  const container = el("div", { style: "display:flex;flex-direction:column;gap:10px" }, [
    el("p", { class: "poll-note" }, [`${dist.voterCount} participant${dist.voterCount === 1 ? "" : "s"}`]),
  ]);

  if (state.pollConsensus) {
    container.appendChild(el("div", { class: "poll-consensus" }, [consensusText(state.pollConsensus)]));
  }

  dist.options.forEach((opt) => {
    container.appendChild(buildPollResultRow(opt, state.pollSelected.has(opt.optionIndex)));
  });
  if (dist.other.count > 0) {
    container.appendChild(buildPollResultRow(dist.other, state.pollSelected.has(PL.POLL_OTHER_INDEX), dist.otherEntries));
  }

  return container;
}

function buildPollResultRow(opt, mine, otherEntries) {
  const children = [
    el("div", { class: "top" }, [
      el("span", { class: "label" }, [opt.label]),
      el("span", { class: "pct" }, [`${opt.percent}%`]),
    ]),
    el("div", { class: "poll-result-bar" }, [el("div", { class: "poll-result-bar-fill", style: `width:${opt.percent}%` })]),
    el("div", { class: "poll-result-count" }, [`${opt.count} vote${opt.count === 1 ? "" : "s"}`]),
  ];
  // "Other" free-text entries — what people actually typed, grouped and counted by
  // computePollDistribution's otherEntries. Was collected and computed but never
  // rendered anywhere on web (the aggregate "Other: N votes" bar was all a viewer saw).
  if (otherEntries && otherEntries.length > 0) {
    children.push(
      el("ul", { class: "poll-other-entries" }, otherEntries.map((entry) =>
        el("li", {}, [`${entry.text} (${entry.count})`])
      ))
    );
  }
  // Per-voter "why" text from Ask Reason — also collected and computed already, just
  // never shown on web.
  if (opt.reasons && opt.reasons.length > 0) {
    children.push(
      el("ul", { class: "poll-reasons" }, opt.reasons.map((reason) => el("li", {}, [`“${reason}”`])))
    );
  }
  return el("div", { class: "poll-result-row" + (mine ? " mine" : "") }, children);
}

function consensusText(c) {
  if (c.type === "strong") return `🔥 Strong agreement — ${c.percent}% chose "${c.option}"`;
  if (c.type === "divided") return `⚖️ Split — "${c.optionA}" vs "${c.optionB}"`;
  return `📊 "${c.option}" is leading with ${c.percent}%`;
}

// ── Fill Blank — inline sentence (mirrors QuizPreviewScreen.kt's
// FillBlankQuestionBody/InlineBlankField exactly: the blank is a real input
// embedded directly in the flowing sentence, not a separate field list). ─────

/** Groups parsed template segments into lines on the creator's manual line
 *  breaks, splitting each line's text into individual words so within-line
 *  wrapping is word-by-word — mirrors splitFillBlankSegmentsIntoLines() in
 *  QuizPreviewScreen.kt exactly (same reasoning: a flex-wrap row needs each
 *  word as its own child to wrap word-by-word instead of as one ragged block). */
function splitFillBlankIntoTokenLines(segments) {
  const lines = [[]];
  segments.forEach((seg) => {
    if (seg.type === "text") {
      seg.text.split("\n").forEach((textLine, i) => {
        if (i > 0) lines.push([]);
        textLine.split(/\s+/).filter((w) => w.length > 0).forEach((word) => {
          lines[lines.length - 1].push({ type: "word", text: word });
        });
      });
    } else {
      lines[lines.length - 1].push({ type: "blank", orderIndex: seg.orderIndex, blank: seg.blank });
    }
  });
  return lines;
}

function buildFillBlankSentence(q) {
  const content = q.fillBlankContent;
  const segments = FB.parseFillBlankTemplate(content.template, content.blanks);
  const lines = splitFillBlankIntoTokenLines(segments);
  const ordered = FB.orderedBlanks(content);
  const fb = state.instantFeedback;

  // Populated as inputs are built below, in template order — each input's Enter
  // handler closes over this to hop to the next blank (or blur, on the last).
  const inputRefs = [];

  const lineEls = lines.map((line) =>
    el(
      "div",
      { class: "fb-sentence" },
      line.map((token) => {
        if (token.type === "word") return el("span", { class: "fb-word" }, [token.text]);

        if (fb) {
          const correct = fb.blankCorrectness ? fb.blankCorrectness[token.orderIndex] : null;
          const value = state.fillBlankDraft[token.orderIndex] || "";
          return el(
            "span",
            { class: "fb-blank-chip " + (correct ? "correct" : "wrong") },
            [value || "—"]
          );
        }
        const isLast = token.orderIndex === ordered.length - 1;
        return buildFillBlankInput(token.orderIndex, isLast, inputRefs);
      })
    )
  );

  return el("div", { class: "card" }, [
    el("div", { style: "display:flex;flex-direction:column;gap:10px" }, lineEls),
  ]);
}

/** One blank, embedded directly in the sentence as just another flowing child —
 *  a hidden mirror span measures the typed text so the visible input can grow
 *  to fit it (plain <input> has no native "size to content" everywhere), capped
 *  via CSS max-width so one very long answer scrolls internally instead of
 *  blowing out the sentence's layout — same behavior as the Android app's
 *  capped InlineBlankField. */
function buildFillBlankInput(orderIndex, isLast, inputRefs) {
  const value = state.fillBlankDraft[orderIndex] || "";
  const placeholder = "Your answer…";

  const mirror = el("span", { class: "fb-blank-mirror" }, [value || placeholder]);
  const input = el("input", {
    type: "text",
    class: "fb-blank-input" + (value.trim() ? " filled" : ""),
    value,
    placeholder,
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    enterkeyhint: isLast ? "done" : "next",
    oninput: (e) => {
      const v = e.target.value;
      state.fillBlankDraft[orderIndex] = v;
      mirror.textContent = v || placeholder;
      input.classList.toggle("filled", v.trim().length > 0);
      // mirror.offsetWidth forces a synchronous reflow of the (out-of-flow,
      // absolutely-positioned) mirror — cheap for a single short span, and
      // avoids a one-frame lag where the input hasn't grown yet.
      input.style.width = Math.min(220, Math.max(92, mirror.offsetWidth + 20)) + "px";
    },
    onkeydown: (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (isLast) { input.blur(); return; }
      inputRefs[orderIndex + 1]?.focus();
    },
  });

  inputRefs[orderIndex] = input;
  return el("span", { class: "fb-blank-wrap" }, [mirror, input]);
}

const expandedReviews = new Set();

/** Mirrors Grading.kt's List&lt;AnswerResult&gt;.scoreBreakdown() — splits answers into two
 *  tracks that never get blended into one number: questions carrying points (maxPoints
 *  &gt; 0) are scored as marksAwarded/marksTotal, everything else as plain
 *  correctCount/total right-or-wrong. Was entirely missing on web before — the result
 *  screen only ever showed the correctness-track count (via buildScoreCard), so a quiz
 *  where questions carry real points (e.g. "20/40") never showed that anywhere. */
function computeScoreBreakdown(answers) {
  const marksTrack = answers.filter((a) => a.maxPoints > 0);
  const correctnessTrack = answers.filter((a) => !(a.maxPoints > 0));
  const isPendingAnswer = (a) => a.needsManualMarking === true && a.awardedPoints == null;

  const marksAwarded = marksTrack.reduce((sum, a) => sum + (a.awardedPoints ?? 0), 0);
  const marksTotal = marksTrack.reduce((sum, a) => sum + a.maxPoints, 0);
  const marksPending = marksTrack.filter(isPendingAnswer).length;

  const correctCount = correctnessTrack.filter((a) => !isPendingAnswer(a) && a.isCorrect).length;
  const correctnessTotal = correctnessTrack.length;
  const correctnessPending = correctnessTrack.filter(isPendingAnswer).length;

  return {
    hasMarks: marksTrack.length > 0,
    hasCorrectness: correctnessTrack.length > 0,
    marksAwarded,
    marksTotal,
    marksPending,
    marksPercent: marksTotal > 0 ? Math.floor((marksAwarded * 100) / marksTotal) : null,
    correctCount,
    correctnessTotal,
    correctnessPending,
    correctnessPercent: correctnessTotal > 0 ? Math.floor((correctCount * 100) / correctnessTotal) : null,
  };
}

/** Mirrors ResultScreen.kt's ScoreSectionCard — title/subtitle on the left, "N / Total"
 *  and percent (suppressed while anything in this track is still pending marking, same
 *  as Android) on the right. */
function buildScoreSectionCard(title, subtitle, value, percent, pending) {
  const right = [el("div", { class: "score-section-value" }, [value])];
  if (percent != null && pending === 0) {
    right.push(el("div", { class: "score-section-percent" }, [`${percent}%`]));
  }
  return el("div", { class: "score-section-card" }, [
    el("div", { class: "score-section-left" }, [
      el("div", { class: "score-section-title" }, [title]),
      el("div", { class: "score-section-subtitle" }, [subtitle]),
    ]),
    el("div", { class: "score-section-right" }, right),
  ]);
}

/** Mirrors ResultScreen.kt's ScoreCard — same gradient, trophy badge, big score +
 *  accuracy%, and progress track. No "Passed"/"Not passed" status label anymore (a 60%-
 *  threshold pass/fail read as needlessly harsh on an otherwise-decent score) — only a
 *  genuine zero-correct result gets called out as "Failed", same as Android. */
function buildScoreCard(score, total) {
  const accuracy = total > 0 ? Math.floor((score * 100) / total) : 0;

  const badge = el("div", { class: "badge" }, []);
  badge.appendChild(html(TROPHY_SVG));

  const labelColumn = [el("div", { class: "label" }, ["YOUR SCORE"])];
  if (score === 0) {
    labelColumn.push(el("div", { class: "status" }, ["Failed"]));
  }

  const card = el("div", { class: "score-card" }, [
    el("div", { class: "row-top" }, [
      badge,
      el("div", {}, labelColumn),
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

/**
 * "Waiting to be marked" — mirrors ResultScreen.kt's PendingReviewCard.
 *
 * Doubles as the partial-marking banner: when some questions WERE app-checked
 * ([gradedCount] > 0) it renders under the score card and reports that part too, since
 * withholding it entirely would mean the taker learns nothing from this screen.
 */
function buildPendingCard(pending, score, gradedCount) {
  const body = gradedCount > 0
    ? `${score} of ${gradedCount} app-checked questions correct. The other ${pending} still need the quiz admin to mark them by hand, so this isn't your final result yet.`
    : "Your answers have been submitted. The quiz admin still has to mark them by hand, so there's no result to show yet. Check back a little later.";

  return el("div", { class: "pending-card" }, [
    el("div", { class: "pending-title" }, ["Waiting to be marked"]),
    el("div", { class: "pending-body" }, [body]),
  ]);
}

/** Mirrors ResultScreen.kt's ReviewCard: colored left accent, Q# pill, question
 *  text, expands to show the options (or written comparison) with correct/wrong
 *  highlighting. */
function buildReviewCard(answer, index) {
  const q = state.quiz.questions.find((qq) => qq.id === answer.questionId);
  if (!q) return null;
  const isCorrect = answer.isCorrect;
  // An unmarked answer isn't wrong, it's undecided — red here would tell the taker they
  // got something wrong that nobody has actually looked at yet.
  const isPending = answer.needsManualMarking === true && answer.awardedPoints == null;
  const stateClass = isPending ? "pending" : isCorrect ? "correct" : "wrong";
  const expanded = expandedReviews.has(answer.questionId);

  const accent = el("div", { class: "review-accent " + stateClass }, []);
  const meta = el("div", { class: "review-meta" }, [
    el("span", { class: "q-pill " + stateClass }, [`Q${index + 1}`]),
    el("span", { class: "muted" }, [`⏱ ${answer.timeTakenSec}s`]),
  ]);
  // Mirrors ResultScreen.kt's per-row marks badge ("X/Y") for a points-carrying question —
  // was missing on web entirely, so a marks-based quiz's review list gave no indication
  // of how many marks each question actually earned, just a green/red accent color.
  if (q.type !== "POLL" && answer.maxPoints > 0) {
    meta.appendChild(el("span", { class: "marks-badge " + stateClass }, [`${answer.awardedPoints ?? 0}/${answer.maxPoints}`]));
  }
  if (isPending) meta.appendChild(el("span", { class: "pending-tag" }, ["Awaiting marking"]));
  if (answer.usedHint) meta.appendChild(el("span", { class: "hint-used-tag" }, ["💡 Hint"]));
  const header = el(
    "div",
    { class: "review-header", onclick: () => { expandedReviews.has(q.id) ? expandedReviews.delete(q.id) : expandedReviews.add(q.id); render(); } },
    [accent, el("div", { style: "flex:1" }, [meta, el("div", { class: "review-question" }, [stripMarkdownText(q.text)])])]
  );
  header.appendChild(html(CHEVRON_DOWN_SVG));

  const card = el("div", { class: "review-card" }, [header]);

  if (expanded) {
    const bodyEl = el("div", { class: "review-body" }, []);
    if (q.type === "WRITTEN") {
      const given = answer.givenAnswers[0] || "";
      // The expected answer stays hidden while pending: it's the owner's reference for
      // marking, and revealing it before they've judged invites "but I wrote that" .
      if (!isPending) bodyEl.appendChild(reviewLine("CORRECT ANSWER", q.writtenAnswer || "", "#22C55E"));
      bodyEl.appendChild(reviewLine("YOUR ANSWER", given || "(no answer)", isPending ? "#B08900" : isCorrect ? "#22C55E" : "#EF4444"));
      // Mirrors ResultScreen.kt's WrittenEvalRow — status label, points-earned badge,
      // and per-word matched/unmatched chips from the evaluator's own breakdown. Was
      // previously discarded entirely on web (only isCorrect survived past evaluate()),
      // so a typo-tolerant/partial-credit answer just showed a flat green/red line with
      // no explanation of how the verdict was actually reached.
      const evalResult = answer.evaluationResult;
      if (!isPending && evalResult) {
        bodyEl.appendChild(buildWrittenEvalDetail(evalResult, answer.awardedPoints, answer.maxPoints));
      }
    } else if (q.type === "FILL_BLANK") {
      // This branch didn't exist at all before — FILL_BLANK has no q.options (that's
      // WRITTEN/FILL_BLANK-only null per buildQuestionFromForm), so it fell into the
      // "else" options branch below and rendered nothing on expand. Mirrors ResultScreen.kt's
      // ReviewCard FILL_BLANK branch: one "correct answer"/"your answer" line pair per blank.
      const content = q.fillBlankContent;
      if (content) {
        const ordered = FB.orderedBlanks(content);
        const given = answer.givenAnswers || [];
        ordered.forEach((blank, i) => {
          const givenText = given[i] || "";
          if (answer.needsManualMarking) {
            // Manual: no accepted answer was ever recorded, so nothing to reveal — just
            // the taker's own text, colored by the owner's whole-question verdict (or
            // neutral while still pending).
            const color = isPending ? "#B08900" : isCorrect ? "#22C55E" : "#EF4444";
            bodyEl.appendChild(reviewLine(`BLANK ${i + 1} — YOUR ANSWER`, givenText || "(no answer)", color));
          } else {
            const blankCorrect = FB.fillBlankIsCorrect(blank, givenText, content.checking);
            const correctText = (blank.acceptedAnswers || []).find((a) => a && a.trim()) || "";
            bodyEl.appendChild(reviewLine(`BLANK ${i + 1} — CORRECT ANSWER`, correctText, "#22C55E"));
            bodyEl.appendChild(reviewLine(`BLANK ${i + 1} — YOUR ANSWER`, givenText || "(no answer)", blankCorrect ? "#22C55E" : "#EF4444"));
          }
        });
      }
    } else {
      (q.options || []).forEach((opt) => {
        const wasGiven = answer.givenAnswers.includes(opt);
        const isCorrectOpt = (q.correctAnswers || []).includes(opt);
        // While pending, only show what they picked — no green "this was right" hints.
        const cls = isPending ? (wasGiven ? "pending" : "") : isCorrectOpt ? "correct" : wasGiven ? "wrong" : "";
        // isCorrectOpt alone only ever means "this is a/the right answer" — shown green
        // whether or not the taker actually picked it (that's what reveals the correct
        // answer to them). Without a "YOUR ANSWER" tag, nothing distinguished "correct,
        // and you picked it" from "correct, but you didn't" — both were a plain green
        // check, so a reader genuinely couldn't tell what the taker had actually chosen.
        const labelChildren = [el("span", {}, [opt])];
        if (wasGiven) labelChildren.push(el("span", { class: "option-your-answer-tag" }, ["YOUR ANSWER"]));
        bodyEl.appendChild(
          el("div", { class: "option-row" + (cls ? " " + cls : ""), style: "cursor:default" }, [
            el("div", { class: "option-marker" }, (isPending ? wasGiven : isCorrectOpt || wasGiven) ? [html(CHECK_SVG)] : []),
            el("div", { style: "display:flex;flex-direction:column;gap:2px" }, labelChildren),
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

const WRITTEN_STATUS_LABELS = {
  EXACT_MATCH: "Correct",
  ACCEPTED_WITH_TYPO: "Accepted — small typo",
  PARTIAL_MATCH: "Partial match",
  INCORRECT: "Incorrect",
};

/** Mirrors ResultScreen.kt's WrittenEvalRow: a status chip, a points-earned badge, and
 *  a word-by-word matched/unmatched breakdown from the evaluator's wordDetails. */
function buildWrittenEvalDetail(evalResult, awardedPoints, maxPoints) {
  const statusColor = evalResult.status === "EXACT_MATCH" || evalResult.status === "ACCEPTED_WITH_TYPO"
    ? "#22C55E"
    : evalResult.status === "PARTIAL_MATCH" ? "#B08900" : "#EF4444";
  const children = [
    el("div", { class: "written-eval-top" }, [
      el("span", { class: "written-eval-status", style: `color:${statusColor}` }, [
        WRITTEN_STATUS_LABELS[evalResult.status] || evalResult.status,
      ]),
      el("span", { class: "written-eval-points" }, [`${awardedPoints ?? 0}/${maxPoints} points`]),
    ]),
  ];
  if (evalResult.wordDetails && evalResult.wordDetails.length > 0) {
    children.push(
      el("div", { class: "written-eval-words" }, evalResult.wordDetails.map((w) =>
        el("span", { class: "written-eval-word" + (w.matched ? " matched" : " unmatched") }, [w.expectedWord])
      ))
    );
  }
  return el("div", { class: "written-eval-detail" }, children);
}

function renderResult() {
  const quiz = state.quiz;
  const accent = themeColorFromName(quiz.themeColorName);
  document.documentElement.style.setProperty("--accent", accent);
  const { score, total, answers } = state.result;

  const pending = answers.filter((a) => a.needsManualMarking && a.awardedPoints == null).length;
  const gradedCount = answers.length - pending;

  const content = el("div", { class: "screen" }, [
    el("h2", { class: "quiz-title", style: "text-align:center;margin:4px 0 0" }, [quiz.title]),
    // Nothing marked yet means there is no score — not a zero, not a partial one — so the
    // score card is replaced outright rather than showing 0/N (mirrors PendingReviewCard).
    pending > 0 && gradedCount === 0
      ? buildPendingCard(pending, 0, 0)
      : buildScoreCard(score, total),
  ]);

  if (pending > 0 && gradedCount > 0) {
    // Some questions were app-checked and some weren't: the score above is real but not
    // final, and saying so is the difference between trusting it and being surprised.
    content.appendChild(buildPendingCard(pending, score, gradedCount));
  }

  // Marks vs plain correctness — two different currencies, shown as their own labelled
  // sections (see computeScoreBreakdown's doc). Most quizzes only ever populate one
  // track, so the other simply doesn't render.
  const breakdown = computeScoreBreakdown(answers);
  if (breakdown.hasMarks) {
    content.appendChild(buildScoreSectionCard(
      "Marks",
      "Questions that carry marks, scored out of their total.",
      `${breakdown.marksAwarded} / ${breakdown.marksTotal}`,
      breakdown.marksPercent,
      breakdown.marksPending
    ));
  }
  if (breakdown.hasCorrectness) {
    content.appendChild(buildScoreSectionCard(
      "Correct answers",
      "Questions that carry no marks — just counted right or wrong.",
      `${breakdown.correctCount} / ${breakdown.correctnessTotal}`,
      breakdown.correctnessPercent,
      breakdown.correctnessPending
    ));
  }

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
    if (state.user) {
      state.existingAttempt = await SC.fetchExistingAttempt(quiz.id, state.user.id);
    }

    // No retake and already completed: land straight on the real result screen (score
    // breakdown, review cards) instead of a one-line "you've already completed this"
    // blurb with no way to actually see it — mirrors what re-opening a finished attempt
    // in the Android app shows. Only takes this path when there's genuinely nothing left
    // to do here (retake off); when retake IS allowed, the landing screen's own Start
    // button still offers a fresh attempt as before.
    if (state.user && state.existingAttempt && quiz.allowRetake === false) {
      const answers = await SC.fetchAttemptAnswers(state.existingAttempt.id);
      state.result = { score: state.existingAttempt.score, total: state.existingAttempt.total, answers };
      state.screen = "result";
      render();
      return;
    }

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

    // Some Google accounts have a wrong/nickname-y name attached — a brand-new
    // signup (mirrors the same one-time gate the Android app now has) is asked
    // to confirm/correct it once before taking the quiz, since that name is
    // what the quiz creator and other participants will see them as.
    if (state.user && !(await SC.fetchNameConfirmed(state.user.id))) {
      state.screen = "confirmName";
      render();
      return;
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
