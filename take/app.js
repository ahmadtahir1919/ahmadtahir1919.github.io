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
// strings.js is included in this guard too: every user-facing word on the page comes
// from it, so a page that loaded without it would render blank labels everywhere. The
// two failure messages below stay inline literals on purpose — they are the LAST
// resort, shown precisely when the string table may be the thing that failed to load.
if (!window.Evaluator || !window.SupabaseClient || !window.FillBlank || !window.Poll || !window.S) {
  app.innerHTML =
    '<div style="padding:24px;font-family:sans-serif;color:#DC2626">' +
    "<b>Couldn't load this page.</b><br><br>" +
    "A required script failed to load (often a slow/blocked connection to the Supabase library CDN). " +
    "Please check your connection and reload the page." +
    "</div>";
  throw new Error("Testly web: required globals missing (Evaluator/SupabaseClient/FillBlank/Poll/S) — aborting boot.");
}
if (window.SupabaseClient.initError) {
  app.innerHTML =
    '<div style="padding:24px;font-family:sans-serif;color:#DC2626">' +
    "<b>Couldn't connect.</b><br><br>" +
    window.SupabaseClient.initError.message +
    "</div>";
  throw new Error("Testly web: Supabase client failed to initialize — aborting boot.");
}

const { evaluate, computeScore, defaultAnswerRule } = window.Evaluator;
const S = window.S;
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
  pollDistribution: null, // set once closed OR once this voter has cast a vote
  pollConsensus: null,
  pollEditingVote: false, // true while a "Change vote" tap has reopened voting (allowVoteChange)
  secondsRemaining: 0,
  totalTimeSec: 0,
  timerHandle: null,
  autoFinishHandle: null, // setTimeout id — LAST question only, once it's been answered
  questionStartSec: 0,
  questionAnswers: {}, // questionId -> raw keys (index-strings / written text)
  questionTimings: {}, // questionId -> seconds
  instantFeedback: null,
  hintVisible: false, // current question's hint panel open/closed
  hintUsed: {}, // questionId -> true once its hint was opened (sticky, unlike hintVisible)
  result: null, // { score, total, answers }
  landingTickerHandle: null, // ticks the Scheduled-quiz countdown on the landing card
  hasJoined: false, // Join clicked (and joined_quizzes recorded) this session — gates Start Quiz
  // joined_quizzes.last_started_at for this account (epoch ms) or null. With no
  // existingAttempt it means "started, left without submitting" — see renderLanding.
  lastStartedAt: null,
  joinError: null,
  joining: false,
  // Admin maintenance switches (see SC.fetchFeatureFlags) — fetched once in boot() and
  // fails open, so an unreached/erroring flags call never blocks a genuine join.
  flags: { joinQuizEnabled: true },
};

// Fires window.Analytics.screen() once per genuine screen change, not once per
// re-render (render() is called far more often than state.screen actually changes —
// e.g. every keystroke while typing a written answer) — same "one event per
// destination change" granularity as AppNavHost.kt on the Android side.
let lastTrackedScreen = null;

function render() {
  if (state.screen !== lastTrackedScreen) {
    lastTrackedScreen = state.screen;
    window.Analytics.screen(state.screen);
  }
  // The landing countdown ticker only makes sense while its own card is on screen —
  // torn down the moment anything else renders, so it can never re-render (and wipe)
  // an unrelated screen the user has since navigated to (e.g. mid-typing in the quiz).
  if (state.screen !== "landing" && state.landingTickerHandle) {
    clearInterval(state.landingTickerHandle);
    state.landingTickerHandle = null;
  }
  app.innerHTML = "";
  // Every screen shares the same chrome: brand header (with a status chip) on top, the
  // screen's own content in the middle, version/legal footer at the bottom. Only the
  // chip's text changes per screen, so the header reads identically everywhere.
  app.appendChild(buildSiteHeader(headerStatusFor(state.screen)));
  main = el("main", { class: "site-main" }, []);
  app.appendChild(main);
  app.appendChild(buildSiteFooter());
  switch (state.screen) {
    case "loading": return renderLoading();
    case "enterCode": return renderEnterCode();
    case "landing": return renderLanding();
    case "confirmName": return renderConfirmName();
    case "quiz": return renderQuiz();
    case "finishing": return renderLoading(S.SUBMITTING);
    case "result": return renderResult();
    case "closed": return renderClosed();
    case "error": return renderError();
  }
}

/** The screen's content mount — the <main> between the shared header and footer.
 *  Reassigned on every render(); the render* functions append into this, not #app. */
let main = app;

function headerStatusFor(screen) {
  switch (screen) {
    case "loading":
    case "finishing": return S.STATUS_LOADING;
    case "error": return S.STATUS_ERROR;
    case "quiz": return S.STATUS_IN_PROGRESS;
    // Only these two screens actually offer a join/start action for the chip to reflect —
    // everywhere else (confirmName, result, closed) a taker already got past joining, so
    // the maintenance switch has nothing left to say about their session.
    case "enterCode":
    case "landing": return state.flags.joinQuizEnabled ? S.STATUS_READY : S.STATUS_PAUSED;
    default: return S.STATUS_READY;
  }
}

const ROCKET_SVG = `<svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="M14.5 4.5c2.2-.9 4.2-1 5-.5.5.8.4 2.8-.5 5-1.1 2.6-3.1 5.3-5.4 7.6l-2.2 2.2-3.7-3.7 2.2-2.2c2.3-2.3 5-4.3 7.6-5.4z" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.2 12.4L5 13.5l-1.5 3 3-1.5M11.6 15.8l-1.1 3.2 3 1.5-1.5-3" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="15.5" cy="8.5" r="1.3" fill="#fff"/></svg>`;

function buildSiteHeader(status) {
  return el("header", { class: "site-header" }, [
    el("div", { class: "brand" }, [
      el("span", { class: "brand-tile" }, [html(ROCKET_SVG)]),
      el("span", { class: "brand-name" }, [S.BRAND]),
    ]),
    el("span", { class: "status-chip" }, [
      el("span", { class: "status-dot" }, []),
      status,
    ]),
  ]);
}

function buildSiteFooter() {
  return el("footer", { class: "site-footer" }, [
    el("span", { class: "footer-version" }, [S.footerVersion(WEB_VERSION)]),
    el("nav", { class: "footer-links" }, [
      el("a", { href: "/terms/" }, [S.FOOTER_TERMS]),
      el("a", { href: "/privacy/" }, [S.FOOTER_PRIVACY]),
    ]),
  ]);
}

/** Leaving the flow (Done, or the X mid-quiz) never navigates anywhere — there's
 *  no page at the site root, which is exactly what caused the 404. This just
 *  swaps to a plain "you're done" screen; the tab itself is meant to be closed
 *  by hand, or via renderClosed's Close button when the browser will actually
 *  honor window.close() (see that function's doc — most tabs reached via a
 *  regular link tap don't qualify, so the button just doesn't render there). */
function leaveQuiz(message) {
  clearInterval(state.timerHandle);
  cancelLastQuestionAutoFinish();
  state.closedMessage = message;
  state.screen = "closed";
  render();
}

/** The mid-quiz "are you sure" — mirrors QuizPreviewScreen exit ConfirmActionDialog (the
 *  browser confirm() is this page own dialog pattern; no modal primitive exists here, see
 *  renderQuiz). The wording spells out what leaving costs: nothing is submitted, and with
 *  retakes off there is no way back in. */
function confirmLeave() {
  const msg = state.quiz && state.quiz.allowRetake === false ? S.LEAVE_CONFIRM_NO_RETAKE : S.LEAVE_CONFIRM_RETAKE;
  return confirm(msg);
}

// Closing/reloading the tab mid-quiz is the same "left without submitting" as the X — the
// browser shows its own generic warning (the text cannot be customized), which still beats
// silently losing an in-progress attempt.
window.addEventListener("beforeunload", (e) => {
  if (state.screen !== "quiz") return;
  e.preventDefault();
  e.returnValue = "";
});

function renderClosed() {
  // window.close() only actually works when the browser considers this tab
  // "script-closable" — opened via window.open() (window.opener set) or with no
  // navigation history of its own (history.length <= 1, i.e. it never followed a
  // link to get here). The common case — tapping a regular share-code link — is
  // neither, so the button would silently no-op on click. A dead button is worse
  // than no button, so it's only rendered when the heuristic says it'll work.
  const canClose = window.opener != null || window.history.length <= 1;
  const children = [
    el("p", { style: "font-size:40px;margin:0" }, [S.CLOSED_WAVE]),
    el("h2", { class: "quiz-title" }, [state.closedMessage || S.CLOSED_DEFAULT_TITLE]),
    el("p", { class: "muted" }, [S.CLOSED_CAN_CLOSE]),
  ];
  if (canClose) {
    children.push(el("button", { class: "primary", style: "margin-top:8px", onclick: () => window.close() }, [S.CLOSED_CLOSE_TAB]));
  }
  main.appendChild(
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
// Quiz-taking screen icons (Material Rounded/Outlined equivalents used on Android).
const BULB_SVG = `<svg viewBox="0 0 24 24" fill="none" width="15" height="15"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0012 3z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const LOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" width="13" height="13"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 018 0v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const PENCIL_SVG = `<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 20h4L19 9l-4-4L4 16v4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
const TEXT_FIELDS_SVG = `<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 7V5h11v2M9.5 5v14M7.5 19h4M14 12v-1.5h6V12M17 10.5V19M15.5 19h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const BAR_CHART_SVG = `<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M6 20V11M12 20V4M18 20v-6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
const CHECK_CIRCLE_SVG = `<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.5 12.5l3 3 6-6.5" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHECKBOX_OUTLINE_SVG = `<svg viewBox="0 0 24 24" fill="none" width="13" height="13"><rect x="3.5" y="3.5" width="17" height="17" rx="4" stroke="currentColor" stroke-width="2"/><path d="M8 12.5l2.8 2.8L16.5 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const TF_CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" width="22" height="22"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const TF_X_SVG = `<svg viewBox="0 0 24 24" fill="none" width="22" height="22"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
const COMMENT_SVG = `<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M5 5h14a1 1 0 011 1v9a1 1 0 01-1 1H10l-4 3.5V16H5a1 1 0 01-1-1V6a1 1 0 011-1z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
const CHEVRON_DOWN_SVG = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M4 6l4 4 4-4" stroke="#BBBACC" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const TROPHY_SVG = `<svg viewBox="0 0 24 24" fill="none" width="20" height="20"><path d="M7 4h10v4a5 5 0 01-10 0V4z" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M7 6H4a3 3 0 003 3M17 6h3a3 3 0 01-3 3" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M12 13v3M9 20h6M9.5 20c0-2 .8-3 2.5-3s2.5 1 2.5 3" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function renderLoading(label) {
  main.appendChild(
    el("div", { class: "screen centered" }, [
      el("div", { class: "spinner" }),
      el("p", { class: "muted" }, [label || S.LOADING]),
    ])
  );
}

function renderError() {
  main.appendChild(
    el("div", { class: "screen centered" }, [
      el("p", { class: "quiz-title" }, [S.ERR_GENERIC_TITLE]),
      el("p", { class: "muted" }, [state.errorMessage]),
    ])
  );
}

// ── Enter code ─────────────────────────────────────────────────────────────
// Shown when /take/ is opened without a ?code= (or with one nobody recognises): six
// one-character boxes, then Join reloads the page with ?code=XXXXXX so boot() takes
// the exact same path a shared link does — no second way of loading a quiz.
const CODE_LENGTH = 6;
const CODE_CHARS = /[^A-Z0-9]/g;

/** Pulls a share code out of whatever was pasted: a bare code, or a full share link. */
function extractCode(text) {
  const raw = String(text || "");
  try {
    const url = new URL(raw.trim());
    const fromParam = url.searchParams.get("code");
    if (fromParam) return fromParam.toUpperCase().replace(CODE_CHARS, "").slice(0, CODE_LENGTH);
  } catch (e) { /* not a URL — fall through */ }
  return raw.toUpperCase().replace(CODE_CHARS, "").slice(0, CODE_LENGTH);
}

function renderEnterCode() {
  const draft = (state.enterCodeDraft || "").padEnd(CODE_LENGTH, " ").slice(0, CODE_LENGTH).split("");
  const boxes = [];
  // Admin maintenance switch — visibly disables the whole join flow instead of letting
  // someone fill in a code that will just fail server-side a moment later.
  const paused = !state.flags.joinQuizEnabled;

  const currentCode = () => boxes.map((b) => b.value).join("");
  const sync = () => {
    state.enterCodeDraft = currentCode();
    boxes.forEach((b) => b.classList.toggle("filled", b.value !== ""));
    joinBtn.disabled = paused || state.enterCodeDraft.length !== CODE_LENGTH;
  };
  const focusBox = (i) => { const b = boxes[Math.max(0, Math.min(CODE_LENGTH - 1, i))]; b.focus(); b.select(); };
  const fill = (text) => {
    const code = extractCode(text);
    if (!code) return false;
    boxes.forEach((b, i) => { b.value = code[i] || ""; });
    sync();
    focusBox(Math.min(code.length, CODE_LENGTH - 1));
    return true;
  };
  const submit = () => {
    if (paused) return;
    const code = currentCode();
    if (code.length !== CODE_LENGTH) return;
    window.location.search = `?code=${code}`;
  };

  for (let i = 0; i < CODE_LENGTH; i++) {
    const box = el("input", {
      class: "code-box",
      type: "text",
      maxlength: "1",
      inputmode: "latin",
      autocapitalize: "characters",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "•",
      "aria-label": S.ENTER_CODE_LABEL,
      value: draft[i].trim(),
      ...(paused ? { disabled: "true" } : {}),
      oninput: (e) => {
        const v = e.target.value.toUpperCase().replace(CODE_CHARS, "");
        if (v.length > 1) { fill(v); return; } // some keyboards insert whole words
        e.target.value = v;
        sync();
        if (v && i < CODE_LENGTH - 1) focusBox(i + 1);
      },
      onkeydown: (e) => {
        if (e.key === "Backspace" && !e.target.value && i > 0) { e.preventDefault(); boxes[i - 1].value = ""; sync(); focusBox(i - 1); }
        else if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); focusBox(i - 1); }
        else if (e.key === "ArrowRight" && i < CODE_LENGTH - 1) { e.preventDefault(); focusBox(i + 1); }
        else if (e.key === "Enter") submit();
      },
      onpaste: (e) => {
        e.preventDefault();
        fill((e.clipboardData || window.clipboardData).getData("text"));
      },
      onfocus: (e) => e.target.select(),
    });
    boxes.push(box);
  }

  const joinBtn = el("button", { class: "primary", onclick: submit }, [S.ENTER_CODE_JOIN, html(ARROW_RIGHT_SVG)]);
  const errorLine = el("p", { class: "field-error" }, [state.enterCodeError || ""]);
  errorLine.style.display = state.enterCodeError ? "" : "none";

  const body = [
    el("span", { class: "pill centered" }, [S.ENTER_CODE_KICKER]),
    el("h1", { class: "quiz-title centered" }, [S.ENTER_CODE_TITLE]),
    el("p", { class: "quiz-meta centered" }, [S.ENTER_CODE_BLURB]),
    el("span", { class: "field-label centered" }, [S.ENTER_CODE_LABEL]),
    el("div", { class: "code-boxes" }, boxes),
    errorLine,
  ];
  // Maintenance notice replaces the ordinary hint line entirely — a taker paused mid-flow
  // needs to know joining isn't the problem here, the timing is, not a smaller hint about
  // letter case underneath a button they can still press.
  if (paused) {
    body.push(el("p", { class: "field-error centered" }, [S.JOIN_PAUSED]));
  } else {
    body.push(el("p", { class: "field-hint centered" }, [S.ENTER_CODE_HINT]));
  }
  body.push(joinBtn);
  // Only offered where the browser can actually hand the clipboard over (secure
  // context + API present) — a button that silently does nothing is worse than none.
  // Hidden entirely while paused: pasting a code nobody can submit right now is pointless.
  if (!paused && navigator.clipboard && navigator.clipboard.readText) {
    body.push(el("button", { class: "paste-btn", onclick: async () => {
      let text = "";
      try { text = await navigator.clipboard.readText(); } catch (e) { /* denied */ }
      if (!fill(text)) {
        state.enterCodeError = S.ENTER_CODE_CLIPBOARD_EMPTY;
        errorLine.textContent = state.enterCodeError;
        errorLine.style.display = "";
      }
    } }, [html(CLIPBOARD_SVG), S.ENTER_CODE_PASTE]));
  }
  body.push(el("p", { class: "card-footnote" }, [S.ENTER_CODE_NOTE]));

  main.appendChild(el("div", { class: "screen card-screen" }, [el("div", { class: "card enter-code-card" }, body)]));
  sync();
  // Land the cursor on the first empty box so a taker can start typing straight away.
  const firstEmpty = boxes.findIndex((b) => !b.value);
  focusBox(firstEmpty === -1 ? CODE_LENGTH - 1 : firstEmpty);
}

function renderLanding() {
  const quiz = state.quiz;
  const accent = themeColorFromName(quiz.themeColorName);
  document.documentElement.style.setProperty("--accent", accent);

  const status = SC.effectiveStatus(quiz);
  const n = quiz.questions.length;
  // Admin maintenance switch — only replaces the actual join/start/retake actions below;
  // signing in and viewing an already-graded result (goToExistingResult) are unaffected,
  // since neither one records a new join.
  const joinPaused = !state.flags.joinQuizEnabled;
  // Two card headers, one per sign-in state — same card frame underneath. Signed-out
  // leads with the sign-in ask; signed-in leads with a "session ready" strip and the
  // account box, so the taker can see at a glance who they're about to join as.
  const body = state.user
    ? [
        el("div", { class: "session-strip" }, [
          el("span", { class: "session-kicker" }, [S.LANDING_KICKER]),
          el("span", { class: "status-chip small" }, [el("span", { class: "status-dot" }, []), S.STATUS_SESSION_READY]),
        ]),
        el("h1", { class: "quiz-title" }, [quiz.title, el("span", { class: "title-count" }, [S.questionCountSuffix(n)])]),
        el("div", { class: "meta-chips" }, [
          el("span", { class: "meta-chip" }, [html(QUESTION_MARK_SVG), S.questionCount(n)]),
        ]),
      ]
    : [
        el("div", { class: "kicker-row" }, [
          el("span", { class: "pill dotted" }, [S.LANDING_KICKER]),
          el("span", { class: "meta-chip plain" }, [S.questionCount(n)]),
        ]),
        el("h1", { class: "quiz-title" }, [quiz.title]),
      ];

  // Archived overrides schedule-based status entirely, same rule as the Android app's
  // ArchivedQuizStatusAction — the creator deliberately took this quiz out of
  // circulation, distinct from it simply having expired on its own schedule.
  if (quiz.isArchived) {
    body.push(el("p", { class: "muted" }, [S.LANDING_ARCHIVED]));
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
    body.push(el("p", { class: "muted" }, [S.LANDING_ENDED]));
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
      [S.SIGN_IN_GOOGLE]
    );
    googleBtn.prepend(html(GOOGLE_G_SVG));
    body.push(
      el("div", { class: "info-box" }, [html(INFO_SVG), el("span", {}, [S.SIGN_IN_BLURB])]),
      googleBtn,
      el("div", { class: "card-meta-row" }, [
        el("span", {}, [S.sessionLine(n)]),
        el("span", {}, [S.version(WEB_VERSION, BUILD_NUMBER)]),
      ])
    );
  } else if (state.existingAttempt && !quiz.allowRetake) {
    // Same rule as JoinScreen.kt's alreadyDoneAndLocked — a completed attempt
    // already exists and this quiz doesn't allow retakes, so don't offer Start.
    body.push(
      signedInLine(state.user),
      el("p", { class: "muted" }, [S.LANDING_ALREADY_DONE]),
      el("p", { class: "quiz-meta" }, [S.yourScore(state.existingAttempt.score, state.existingAttempt.total)]),
      signOutRow()
    );
  } else if (state.existingAttempt && quiz.allowRetake) {
    // Retake is allowed AND this account already has a result — offer both instead of
    // forcing straight into a fresh attempt. Mirrors JoinScreen.kt's "Your Quizzes" row:
    // the default action there is opening the past RESULT (onOpenJoinedQuiz), with
    // Retake as its own separate, explicit action — not the other way around.
    body.push(
      signedInLine(state.user),
      el("p", { class: "quiz-meta" }, [S.yourScore(state.existingAttempt.score, state.existingAttempt.total)]),
      el("button", { class: "primary", onclick: goToExistingResult }, [S.LANDING_SEE_RESULT])
    );
    if (joinPaused) {
      body.push(pausedNotice());
    } else {
      body.push(el("button", { class: "secondary", onclick: retakeQuizAction }, [state.joining ? S.JOINING : S.LANDING_RETAKE]));
      if (state.joinError) {
        body.push(el("p", { class: "muted", style: "color:var(--error)" }, [state.joinError]));
      }
    }
    body.push(signOutRow());
  } else if (state.lastStartedAt && quiz.allowRetake === false) {
    // Started earlier (here or in the app) and left without submitting, retakes off — that
    // one try is used up. Mirrors JoinedQuizItem.isLockedAfterAbandon on Android.
    body.push(
      signedInLine(state.user),
      el("p", { class: "muted" }, [S.LANDING_LEFT_LOCKED]),
      signOutRow()
    );
  } else if (state.lastStartedAt) {
    // Started earlier and left without submitting — nothing counted, so this is a fresh
    // attempt, labelled as a retake like the app's Joined card.
    body.push(
      signedInLine(state.user),
      el("p", { class: "muted" }, [S.LANDING_LEFT_WITHOUT_SUBMITTING])
    );
    if (joinPaused) {
      body.push(pausedNotice());
    } else {
      body.push(el("button", { class: "primary", onclick: retakeQuizAction }, [state.joining ? S.JOINING : S.LANDING_RETAKE]));
      if (state.joinError) {
        body.push(el("p", { class: "muted", style: "color:var(--error)" }, [state.joinError]));
      }
    }
    body.push(signOutRow());
  } else if (!state.hasJoined) {
    // Join is its own step, separate from Start — records membership (joined_quizzes)
    // right away so the owner's Participants tab sees this person the moment they join,
    // same as joining by code in the app, rather than only once they actually finish
    // answering something.
    body.push(signedInLine(state.user));
    if (joinPaused) {
      body.push(pausedNotice());
    } else {
      body.push(primaryButton(state.joining ? S.JOINING : S.LANDING_JOIN, joinQuizAction));
      if (state.joinError) {
        body.push(el("p", { class: "muted", style: "color:var(--error)" }, [state.joinError]));
      }
    }
    body.push(signOutRow());
  } else {
    body.push(signedInLine(state.user));
    // Reaching here means hasJoined is already true (the membership row exists), so this
    // is resuming/starting an already-joined quiz, not creating a new join — left
    // unblocked on purpose, same as Home's Joined-tab retake/continue on Android.
    body.push(primaryButton(S.LANDING_START, startQuiz));
    body.push(signOutRow());
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
// Character caps for everything a participant types here. Mirrors AppLimits.DEFAULT's
// maxResponseChars in the Android app.
//
// Hardcoded rather than fetched: this page never calls my_limits(), and it does not need
// to. The REAL enforcement is the server's own RLS check (see attempt_answers_insert_own
// and poll_votes_write_own in supabase/schema.sql) — this number only stops the browser
// before a rejection. Do NOT turn this into a fetched value and a second source of truth;
// if an admin lowers the cap, the server still refuses, which is the behaviour that matters.
const RESPONSE_MAX_CHARS = 500;

// Mirrors FixedTextLimits.DISPLAY_NAME, and the literal in profiles_update_own's check —
// without it this page could write a name the server would simply refuse.
const DISPLAY_NAME_MAX_CHARS = 32;

const WEB_VERSION = "1.0";
const BUILD_NUMBER = new URL(import.meta.url).searchParams.get("v") || "?";

function appendLandingScreen(body) {
  main.appendChild(
    el("div", { class: "screen card-screen" }, [el("div", { class: "card landing-card" }, body)])
  );
}

/** Filled CTA with the trailing chevron every primary action on these cards carries. */
function primaryButton(label, onclick) {
  return el("button", { class: "primary", onclick }, [label, html(BTN_CHEVRON_SVG)]);
}

/** Replaces a Join/Start/Retake button while an admin has joining paused for maintenance —
 *  same info-box treatment as the sign-in blurb, so it reads as a status, not an error. */
function pausedNotice() {
  return el("div", { class: "info-box" }, [html(INFO_SVG), el("span", {}, [S.JOIN_PAUSED])]);
}

const BTN_CHEVRON_SVG = `<svg class="btn-chevron" viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ARROW_RIGHT_SVG = `<svg class="btn-chevron" viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const INFO_SVG = `<svg viewBox="0 0 20 20" fill="none" width="18" height="18"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.6"/><path d="M10 9v4.5M10 6.5v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const QUESTION_MARK_SVG = `<svg viewBox="0 0 20 20" fill="none" width="14" height="14"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.6"/><path d="M7.8 8a2.2 2.2 0 114.1 1.1c-.6.9-1.9 1.2-1.9 2.4M10 14h.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const USER_SVG = `<svg viewBox="0 0 24 24" fill="none" width="20" height="20"><circle cx="12" cy="8.5" r="3.5" stroke="#fff" stroke-width="1.8"/><path d="M5.5 19c.8-3.2 3.3-4.8 6.5-4.8s5.7 1.6 6.5 4.8" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const EDIT_PENCIL_SVG = `<svg viewBox="0 0 20 20" fill="none" width="16" height="16"><path d="M4 13.5V16h2.5l7.4-7.4-2.5-2.5L4 13.5zM12.6 4.9l2.5 2.5 1.2-1.2a1 1 0 000-1.4l-1.1-1.1a1 1 0 00-1.4 0l-1.2 1.2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const CLEAR_X_SVG = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const TICK_SVG = `<svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CLIPBOARD_SVG = `<svg viewBox="0 0 20 20" fill="none" width="15" height="15"><rect x="5" y="4" width="10" height="13" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 4V3h4v1M8 9h4M8 12h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

/** One-time gate right after a brand-new signup (profiles.name_confirmed = false) —
 *  mirrors the Android app's ConfirmNameScreen. Blocking, no skip: some Google
 *  accounts have the wrong/nickname-y name attached, and this is what the quiz
 *  creator and other participants will see this person as everywhere else. */
function renderConfirmName() {
  if (state.confirmNameDraft == null) {
    state.confirmNameDraft = SC.resolveDisplayName(state.user);
  }
  const trimmed = (state.confirmNameDraft || "").trim();
  const googleName = SC.resolveDisplayName(state.user);

  const counter = el("span", { class: "field-counter" }, [S.charCount((state.confirmNameDraft || "").length, DISPLAY_NAME_MAX_CHARS)]);
  // "Synced from Google" only holds while the field still says what Google said.
  const synced = el("p", { class: "field-helper synced" }, [html(TICK_SVG), S.CONFIRM_NAME_SYNCED]);
  const refresh = (value) => {
    saveBtn.disabled = state.confirmNameSaving || value.trim().length === 0;
    counter.textContent = S.charCount(value.length, DISPLAY_NAME_MAX_CHARS);
    synced.style.display = value === googleName ? "" : "none";
  };

  const input = el("input", {
    type: "text",
    value: state.confirmNameDraft || "",
    maxlength: String(DISPLAY_NAME_MAX_CHARS),
    placeholder: S.CONFIRM_NAME_PLACEHOLDER,
    autocomplete: "name",
    oninput: (e) => {
      state.confirmNameDraft = e.target.value;
      refresh(e.target.value);
    },
    onkeydown: (e) => { if (e.key === "Enter") submitConfirmedName(); },
  });
  const clearBtn = el("button", { class: "field-clear", type: "button", onclick: () => {
    state.confirmNameDraft = "";
    input.value = "";
    refresh("");
    input.focus();
  } }, [html(CLEAR_X_SVG)]);

  const saveBtn = primaryButton(state.confirmNameSaving ? S.SAVING : S.CONFIRM_NAME_SUBMIT, () => submitConfirmedName());
  saveBtn.disabled = state.confirmNameSaving || trimmed.length === 0;
  synced.style.display = (state.confirmNameDraft || "") === googleName ? "" : "none";

  const body = [
    el("span", { class: "pill dotted" }, [S.CONFIRM_NAME_KICKER]),
    el("div", { class: "title-row" }, [
      el("h1", { class: "quiz-title" }, [S.CONFIRM_NAME_TITLE]),
      el("span", { class: "title-badge" }, [html(USER_SVG)]),
    ]),
    el("p", { class: "quiz-meta" }, [S.CONFIRM_NAME_BLURB]),
    el("div", { class: "field-head" }, [
      el("span", { class: "field-label" }, [S.CONFIRM_NAME_LABEL]),
      counter,
    ]),
    el("div", { class: "name-field" }, [html(EDIT_PENCIL_SVG), input, clearBtn]),
    synced,
  ];
  if (state.confirmNameError) {
    body.push(el("p", { class: "muted", style: "color:var(--error)" }, [state.confirmNameError]));
  }
  body.push(
    saveBtn,
    el("button", { class: "text-link", onclick: () => cancelConfirmName() }, [S.CONFIRM_NAME_CANCEL])
  );

  main.appendChild(el("div", { class: "screen card-screen" }, [el("div", { class: "card confirm-card" }, body)]));
}

/** "Cancel & Sign out" — wrong account picked. Back to the signed-out landing card
 *  (signOutAction already re-renders); the draft is dropped so the next account's
 *  Google name is picked up fresh instead of this one's leftover edit. */
async function cancelConfirmName() {
  state.confirmNameDraft = null;
  state.confirmNameError = null;
  state.screen = "landing";
  await signOutAction();
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
    state.confirmNameError = S.SAVE_NAME_FAILED;
    render();
  }
}

function currentQuestion() {
  return state.quiz.questions[state.currentIndex];
}

/** "SIGNED IN AS" account box — initials avatar (with an online dot) + the display name. */
function signedInLine(user) {
  const name = SC.resolveDisplayName(user);
  return el("div", { class: "signed-in-box" }, [
    el("div", { class: "avatar" }, [initialsOf(name), el("span", { class: "avatar-dot" }, [])]),
    el("div", { class: "signed-in-text" }, [
      el("span", { class: "overline" }, [S.SIGNED_IN_AS_LABEL]),
      el("span", { class: "signed-in-name" }, [name]),
    ]),
  ]);
}

/** "Muhammad Ahmed Tahir" -> "MT" (first + last word), "Ahmad" -> "A", "" -> "?". */
function initialsOf(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** "Sign out" escape hatch — wrong Google account picked, or just wants to switch,
 *  shouldn't mean reloading the tab and hunting for a way out. Deliberately its own
 *  full-width row below the primary action (Join/Start), separated by a divider line —
 *  sitting right next to that button risked a mis-tap signing someone out by accident. */
function signOutRow() {
  return el("div", { class: "sign-out-row" }, [
    el("span", { class: "sign-out-prefix" }, [S.SIGN_OUT_PREFIX]),
    el("button", { class: "skip-link sign-out-link", onclick: signOutAction }, [S.SIGN_OUT]),
  ]);
}

async function signOutAction() {
  // Tracked (and reset) before signOut actually clears the session — reset() rotates
  // the distinct id, so this must still land under the outgoing account, same ordering
  // as SupabaseAuthRepository.signOut() on the Android side.
  window.Analytics.track("signed_out");
  window.Analytics.reset();
  await SC.signOut();
  // Back to square one on this same landing card — sign-in button reappears, and any
  // in-progress Join/Start state for the account that just signed out no longer applies.
  state.user = null;
  state.hasJoined = false;
  state.joinError = null;
  state.existingAttempt = null;
  state.lastStartedAt = null;
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
  // Defense in depth: the Join button is already hidden while paused (renderLanding), but
  // an admin could flip the switch after this tab loaded and before this tap landed. The
  // real backstop is the server's own joined_quizzes_insert_own check either way.
  if (!state.flags.joinQuizEnabled) {
    state.joinError = S.JOIN_PAUSED;
    render();
    return;
  }
  state.joining = true;
  state.joinError = null;
  render();
  try {
    await SC.joinQuiz(state.user.id, state.quiz.id);
    state.hasJoined = true;
    window.Analytics.track("quiz_joined", { quiz_id: state.quiz.id });
  } catch (e) {
    state.joinError = S.JOIN_FAILED;
  }
  state.joining = false;
  render();
}

/** Fetches the existing attempt's full answers and switches straight to the result
 *  screen — shared by boot()'s no-retake auto-redirect and the "See Result" button
 *  offered alongside "Retake Exam" when retake is allowed (see renderLanding). */
async function goToExistingResult() {
  const answers = await SC.fetchAttemptAnswers(state.existingAttempt.id);
  // A poll this account skipped that has since closed is hidden from them here too — but one
  // they voted on stays. Same rule as while taking (pruneHiddenPolls / QuizPreviewViewModel).
  await pruneHiddenPolls();
  const pollItems = await buildResultPollItems(state.quiz, state.user);
  state.result = { score: state.existingAttempt.score, total: state.existingAttempt.total, answers, pollItems };
  openResultScreen();
}

/** Every review card starts expanded and the filter on "All" — the review is the point
 *  of this screen, so nothing should need a tap to be seen. */
function openResultScreen() {
  state.resultFilter = "all";
  expandedReviews.clear();
  expandedPollReviews.clear();
  state.quiz.questions.forEach((q) => { expandedReviews.add(q.id); expandedPollReviews.add(q.id); });
  state.screen = "result";
  render();
}

/** "Retake Exam" when retake is allowed and this account already has a result — joins
 *  first if this session somehow doesn't already show as joined (e.g. a fresh browser/
 *  device that never loaded the join state for this quiz before), same as a first-time
 *  Join would, then starts a fresh attempt exactly like the ordinary Start Quiz button. */
async function retakeQuizAction() {
  if (!state.hasJoined) {
    await joinQuizAction();
    if (!state.hasJoined) return; // join failed — joinQuizAction already surfaced why
  }
  startQuiz();
}

async function startQuiz() {
  // Same re-check as joinQuizAction, for the same reason — a tab left open past the
  // deadline must not be able to start (and then submit) a quiz that's since ended,
  // just because the button was drawn while it was still Active.
  if (SC.effectiveStatus(state.quiz) !== "ACTIVE") {
    render();
    return;
  }
  // Drop any poll that's already closed and this person never voted on — nothing for them
  // to do with it, and it shouldn't count in "Question X of N" / the progress bar. Mirrors
  // QuizPreviewViewModel.loadQuiz's pre-filter. Spinner while its reads round-trip.
  state.screen = "loading";
  render();
  await pruneHiddenPolls();
  if (state.quiz.questions.length === 0) {
    // Poll-only quiz whose every poll has already closed for this person — nothing to answer.
    leaveQuiz(S.POLL_ALL_CLOSED);
    return;
  }
  // Re-read the stamp rather than trusting the one boot() loaded: this quiz may have been
  // started (and left) in the Android app, or another tab, since this card was drawn.
  // Retakes off + started before + nothing submitted = that one try is used up.
  if (state.quiz.allowRetake === false && !state.existingAttempt) {
    const startedBefore = await SC.fetchLastStartedAt(state.quiz.id, state.user.id);
    if (startedBefore) {
      state.lastStartedAt = startedBefore;
      state.screen = "landing";
      render();
      return;
    }
  }
  // Stamps joined_quizzes.last_started_at — mirrors QuizPreviewViewModel.loadQuiz calling
  // markQuizStarted, so leaving without submitting is remembered here too (and the owner
  // gets the same "X started your quiz" notification). Never blocks the attempt: a failed
  // stamp is no reason to refuse someone the quiz they are entitled to take.
  try {
    await SC.markQuizStarted(state.user.id, state.quiz.id);
    state.lastStartedAt = Date.now();
  } catch (e) {
    /* offline / transient — carry on */
  }
  state.currentIndex = 0;
  state.screen = "quiz";
  render();
  prepareCurrentQuestion();
}

/** Removes from state.quiz.questions every POLL that's already CLOSED and this user never
 *  voted on — mirrors QuizPreviewViewModel.loadQuiz's pre-filter and the result screen's
 *  own filter (a pruned poll never reaches buildResultPollItems either). Read-only; no-op
 *  without a signed-in user. Fail-safe: a poll whose state we couldn't read counts as OPEN
 *  and stays. */
async function pruneHiddenPolls() {
  if (!state.user) return;
  const pollIds = state.quiz.questions.filter((q) => q.type === "POLL").map((q) => q.id);
  if (pollIds.length === 0) return;
  const [states, ...voteLists] = await Promise.all([
    SC.fetchPollStates(pollIds).catch(() => ({})),
    ...pollIds.map((id) => SC.fetchPollVotes(id).catch(() => [])),
  ]);
  const votedByMe = new Set();
  pollIds.forEach((id, i) => {
    if ((voteLists[i] || []).some((v) => v.voterKey === state.user.id)) votedByMe.add(id);
  });
  state.quiz.questions = state.quiz.questions.filter((q) => {
    if (q.type !== "POLL") return true;
    const status = (states[q.id] && states[q.id].status) || "OPEN";
    return !PL.pollHiddenForNonVoter(status, votedByMe.has(q.id));
  });
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
    state.pollEditingVote = false;
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

  if (PL.pollHiddenForNonVoter(effectiveClosed ? "CLOSED" : "OPEN", myVote != null)) {
    // Closed while this taker was mid-quiz and they never voted — pruneHiddenPolls at Start
    // couldn't have known. Move on like a normal Next (proceedPastQuestion finishes the quiz
    // if this was the last, and re-runs prepareCurrentQuestion so a run of closed polls chains).
    proceedPastQuestion();
    return;
  }

  state.pollHasVoted = myVote != null;
  state.pollEditingVote = false;
  if (myVote) {
    state.pollSelected = new Set(myVote.selectedOptionIndices || []);
    state.pollOtherText = myVote.otherText || "";
    state.pollReasonText = myVote.reason || "";
  }

  // Not just CLOSED — re-entering a poll already voted on (e.g. resuming mid-quiz)
  // reveals results immediately too, same as a fresh vote does (see advance()).
  // Unless the owner kept the results to themselves: leaving pollDistribution null makes
  // render() fall through to the voting body, which already shows "✓ You voted".
  if ((effectiveClosed || myVote) && PL.pollResultsVisibleToVoters(settings)) {
    const distribution = PL.computePollDistribution(q.options || [], votes);
    state.pollDistribution = distribution;
    state.pollConsensus = PL.computePollConsensus(distribution);
  }
  if (!effectiveClosed) {
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
    chip.appendChild(html(chip.classList.contains("poll-chip") ? BAR_CHART_SVG : CLOCK_SVG));
    chip.appendChild(document.createTextNode(formatSeconds(state.secondsRemaining)));
    chip.classList.toggle("urgent", urgent);
  }
  const fill = document.getElementById("timer-fill");
  if (fill) {
    fill.style.width = `${(state.secondsRemaining / state.totalTimeSec) * 100}%`;
    fill.classList.toggle("urgent", urgent);
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
    if (state.selectedAnswers.has(key)) {
      state.selectedAnswers.delete(key);
    } else {
      // Always capped at the number of correct options, regardless of
      // splitPointsAcrossChoices (mirrors QuizPreviewViewModel.onToggleAnswer) —
      // selecting more than that is guaranteed wrong under all-or-nothing scoring
      // too, so this is a pure UX guard with no scoring effect either way. A tap
      // past the cap is a no-op, blocked rather than evicting an earlier pick, so
      // the taker never loses a choice they didn't ask to lose. Skipped when
      // correctAnswers is empty — a manual-marking question genuinely has none
      // marked, and a cap of 0 would block every selection outright.
      const correctCount = (q.correctAnswers || []).length;
      const cap = correctCount > 0 ? correctCount : Infinity;
      if (state.selectedAnswers.size < cap) state.selectedAnswers.add(key);
    }
  } else {
    if (state.selectedAnswers.has(key)) state.selectedAnswers.clear();
    else { state.selectedAnswers.clear(); state.selectedAnswers.add(key); }
  }
  scheduleLastQuestionAutoFinish();
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

/** Has the taker actually given an answer to the question they're on right now? For a poll
 *  that means a cast vote whose reveal is showing (not one reopened for editing). Mirrors
 *  QuizPreviewUiState.hasAnsweredCurrent. */
function hasAnsweredCurrent() {
  const q = currentQuestion();
  if (!q) return false;
  if (q.type === "POLL") return state.pollHasVoted && !state.pollEditingVote;
  if (q.type === "WRITTEN") return state.writtenAnswer.trim().length > 0;
  if (q.type === "FILL_BLANK") return state.fillBlankDraft.some((v) => (v || "").trim().length > 0);
  return state.selectedAnswers.size > 0;
}

/** LAST question only: once it's actually answered, submit the quiz after a short grace
 *  period so the taker never has to hunt for "Finish" — the tail end of an answered mid-quiz
 *  question rolling on when its timer ends. Re-armed on every answer change; cancelled by a
 *  manual Finish/Skip, reopening a vote, or leaving. Never armed while the last question is
 *  still unanswered (its own countdown + the Finish button stay as-is). Mirrors
 *  QuizPreviewViewModel.scheduleLastQuestionAutoFinish. */
function scheduleLastQuestionAutoFinish() {
  clearTimeout(state.autoFinishHandle);
  state.autoFinishHandle = null;
  const isLast = state.currentIndex === state.quiz.questions.length - 1;
  if (!isLast || state.instantFeedback || !hasAnsweredCurrent()) return;
  state.autoFinishHandle = setTimeout(() => { onNext(); }, 3000);
}

function cancelLastQuestionAutoFinish() {
  clearTimeout(state.autoFinishHandle);
  state.autoFinishHandle = null;
}

async function advance(castPollVote) {
  if (state.instantFeedback) return; // already mid-feedback — ignore stray taps
  // A real Finish/Skip tap (or the auto-finish firing) takes over from here.
  cancelLastQuestionAutoFinish();
  const q = currentQuestion();
  clearInterval(state.timerHandle);

  if (q.type === "POLL") {
    const settings = q.pollSettings || {};
    const locked = state.pollHasVoted && settings.allowVoteChange === false;
    // Only actually cast on a fresh vote or a deliberate re-vote (pollEditingVote) — an
    // ordinary "Next" tap after the reveal below already has nothing new to cast.
    if (castPollVote && !locked && (!state.pollHasVoted || state.pollEditingVote) &&
        state.pollSelected.size > 0 && state.pollState) {
      const vote = {
        questionId: q.id,
        voterKey: state.user.id,
        selectedOptionIndices: Array.from(state.pollSelected),
        otherText: state.pollSelected.has(PL.POLL_OTHER_INDEX) ? state.pollOtherText : null,
        reason: state.pollReasonText || null,
        participantId: settings.anonymous ? null : state.user.id,
      };
      // Awaited now (was fire-and-forget) — the results reveal right below needs the
      // fresh vote list to actually include this vote.
      await SC.castPollVote(vote).catch(() => {});
      window.Analytics.track("poll_voted", { question_id: q.id });
      if (PL.pollResultsVisibleToVoters(settings)) {
        const votes = (await SC.fetchPollVotes(q.id).catch(() => [])) || [];
        const distribution = PL.computePollDistribution(q.options || [], votes);
        state.pollDistribution = distribution;
        state.pollConsensus = PL.computePollConsensus(distribution);
      }
      state.pollHasVoted = true;
      state.pollEditingVote = false;
      // Reveal the just-cast results in place instead of snapping straight past them —
      // same as a normal consumer poll. A second tap (button now reads Next/Finish, not
      // Vote) actually advances.
      render();
      // Last question: the vote's in and its results are showing — start the grace period
      // so the taker doesn't have to tap Finish.
      scheduleLastQuestionAutoFinish();
      return;
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
    // MULTIPLE_CORRECT goes through the shared rule (mirrors Android's buildInstantFeedback)
    // so an any-one-is-enough question can't flash red here and then score as correct.
    const eq = q.type === "MULTIPLE_CORRECT"
      ? window.Evaluator.isMultipleCorrectAnswer(correctIndices, selectedIndices, !!q.acceptAnyCorrect)
      : selectedIndices.size === correctIndices.size && [...selectedIndices].every((i) => correctIndices.has(i));
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
  cancelLastQuestionAutoFinish();
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
    state.errorMessage = S.SUBMIT_QUIZ_CLOSED;
    state.screen = "error";
    render();
    return;
  }
  // Same staleness concern as the status check above: state.quiz was only ever fetched once,
  // at page load (boot()), and never refreshed — an owner flipping manual marking, split-points,
  // time-weightage, or show-timers mid-quiz would otherwise silently score this submission
  // under whatever was current when the tab first loaded. fetchQuizStatus's select() already
  // carries these too, so this reuses that same round-trip rather than firing a second one.
  if (liveStatus) {
    state.quiz.manualMarkingDefault = liveStatus.manualMarkingDefault;
    state.quiz.splitPointsAcrossChoices = liveStatus.splitPointsAcrossChoices;
    state.quiz.timeWeightageEnabled = liveStatus.timeWeightageEnabled;
    state.quiz.showTimers = liveStatus.showTimers;
  }

  // Mirrors QuizPreviewViewModel.finishPreview on Android — an owner's remove-participant
  // action deletes this taker's joined_quizzes row remotely at any point during the quiz,
  // and nothing earlier in this flow would know. `=== false` specifically (not `!== true`):
  // null means the check itself failed (offline/error), which must never itself block a
  // legitimate submission — only a confirmed "no" does.
  if ((await SC.isJoined(state.quiz.id, state.user.id)) === false) {
    state.errorMessage = S.SUBMIT_REMOVED;
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
    // rawPoints mirrors exactly what awardedPoints was before split-points/time-weightage
    // existed for every type except a split-points-enabled MULTIPLE_CORRECT — see
    // QuizPreviewViewModel.finishPreview's identical comment on the Android side.
    let rawPoints = 0;
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
        rawPoints = isCorrect ? q.points : 0;
      } else if (q.type === "FILL_BLANK") {
        isCorrect = q.fillBlankContent ? FB.fillBlankIsQuestionCorrect(q.fillBlankContent, given) : false;
        rawPoints = isCorrect ? q.points : 0;
      } else if (q.type === "MULTIPLE_CORRECT") {
        // By option position, same as buildInstantFeedback — both verdicts come from
        // evaluator.isMultipleCorrectAnswer (mirrors Android's finishPreview).
        const options = q.options || [];
        const correctIdx = options.map((_, i) => i).filter((i) => (q.correctAnswers || []).includes(options[i]));
        const pickedIdx = new Set(rawKeys.map(Number).filter((n) => !Number.isNaN(n)));
        const acceptAny = !!q.acceptAnyCorrect;
        if (state.quiz.splitPointsAcrossChoices) {
          // Correctness is a set comparison inside scoreSplitMultipleCorrect, not
          // "rawPoints === q.points" as it used to be — see that function's doc in
          // evaluator.js for the two ways that comparison marked wrong answers correct.
          const scored = evaluator.scoreSplitMultipleCorrect(correctIdx, pickedIdx, q.points, acceptAny);
          rawPoints = scored.rawPoints;
          isCorrect = scored.isCorrect;
        } else {
          isCorrect = evaluator.isMultipleCorrectAnswer(new Set(correctIdx), pickedIdx, acceptAny);
          rawPoints = isCorrect ? q.points : 0;
        }
      } else {
        const a = new Set(given), b = new Set(q.correctAnswers || []);
        isCorrect = a.size === b.size && [...a].every((x) => b.has(x));
        rawPoints = isCorrect ? q.points : 0;
      }
    }

    // Uniform across every scored type — no-op when the toggle is off or this question
    // has no active timer (see applyTimeWeightage's doc in evaluator.js).
    const elapsedSec = state.questionTimings[q.id] || 0;
    const effectiveTimeLimitSec = state.quiz.showTimers ? q.timeSec : 0;
    const finalPoints = evaluator.applyTimeWeightage(rawPoints, elapsedSec, effectiveTimeLimitSec, state.quiz.timeWeightageEnabled);

    return {
      questionId: q.id,
      isCorrect,
      givenAnswers: given,
      timeTakenSec: elapsedSec,
      needsManualMarking: isManual,
      // null on a manual answer is what marks it pending.
      awardedPoints: isManual ? null : finalPoints,
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
    .then(async () => {
      window.Analytics.track("attempt_submitted", {
        quiz_id: state.quiz.id,
        score: score,
        total: scored.length
      });
      const pollItems = await buildResultPollItems(state.quiz, state.user);
      state.result = { score, total: scored.length, answers, pollItems };
      openResultScreen();
    })
    .catch((err) => {
      // Backstop for a race (e.g. two tabs submitting at once) — the landing-page
      // check above normally catches this first, but the server is the real guard.
      state.errorMessage = err.message === "RETAKE_NOT_ALLOWED"
        ? S.SUBMIT_NO_RETAKE
        : S.SUBMIT_SAVE_FAILED_PREFIX + (err.message || err);
      state.screen = "error";
      render();
    });
}

/** Top bar: X close, title + "(Nq)", timer chip (poll chip on a poll) — mirrors
 *  QuizScreenComponents.kt's QuizTopBar. */
function buildQuizTopBar(quiz, q) {
  const closeBtn = el("button", { class: "icon-btn", onclick: () => { if (confirmLeave()) leaveQuiz(S.QUIZ_CLOSED); } }, []);
  closeBtn.appendChild(html(CLOSE_X_SVG));

  // Reserved-width slot either way, so the title stays centered whether or not
  // this question has a timer. Gated on quiz.showTimers too, not just q.timeSec — an
  // empty timer-chip pill was rendering (and reserving layout space) even with the
  // quiz-wide "Show Timer" setting off, since this check ignored it entirely.
  let right;
  if (q.type === "POLL") {
    // A timed poll's countdown is filled in by updateTimerDisplay (same #timer-chip id);
    // an untimed one just says "Poll".
    right = state.totalTimeSec > 0
      ? el("div", { id: "timer-chip", class: "timer-chip poll-chip" }, [])
      : el("div", { class: "timer-chip poll-chip" }, [html(BAR_CHART_SVG), S.POLL_CHIP]);
  } else if (quiz.showTimers && q.timeSec > 0) {
    right = el("div", { id: "timer-chip", class: "timer-chip" }, []);
  } else {
    right = el("div", { class: "topbar-spacer" }, []);
  }

  const title = el("span", { class: "title" }, [
    quiz.title,
    el("span", { class: "title-count" }, [S.questionCountSuffix(quiz.questions.length)]),
  ]);
  return el("div", { class: "quiz-topbar" }, [closeBtn, title, right]);
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
    segments.push(el("div", { class: "progress-segment" + (i === state.currentIndex ? " current" : "") }, [el("div", props)]));
  }
  return el("div", { class: "progress-track segmented" }, segments);
}

/** Bottom action bar: timer progress bar pinned above it, Skip + the tactile Next —
 *  mirrors QuizScreenComponents.kt's QuizBottomBar. */
function buildBottomBar(q, isLastQuestion, onSkipFn, onNextFn) {
  const rows = [];
  // state.totalTimeSec, not q.timeSec — it's already the single source of truth computed
  // at question-load time (startTimer/loadPollForCurrentQuestion), correctly folding in
  // quiz.showTimers and a poll's own noTimeLimit; q.timeSec alone ignores both.
  if (state.totalTimeSec > 0) {
    rows.push(
      el("div", { class: "progress-track timer-track" }, [
        el("div", { id: "timer-fill", class: "progress-fill", style: `width:${(state.secondsRemaining / state.totalTimeSec) * 100}%` }),
      ])
    );
  }
  const disabled = !!state.instantFeedback;
  // "Vote" instead of Next/Finish while a poll still needs its vote-cast tap — even as
  // the last question, since this tap casts and reveals in place rather than moving on
  // (see advance()). Matches PreviewBottomBar's isPollQuestion label on Android.
  const showVoteLabel = q.type === "POLL" && (!state.pollHasVoted || state.pollEditingVote);
  const nextBtn = el("button", { class: "tactile-btn" + (showVoteLabel ? " wide" : ""), onclick: onNextFn }, []);
  if (disabled) nextBtn.disabled = true;
  nextBtn.appendChild(document.createTextNode(
    showVoteLabel ? S.NAV_VOTE : (isLastQuestion ? S.NAV_FINISH : S.NAV_NEXT)
  ));
  nextBtn.appendChild(html(CHEVRON_RIGHT_SVG));

  const skipBtn = el("button", { class: "quiz-skip", onclick: onSkipFn }, [showVoteLabel ? S.SKIP_POLL : S.SKIP]);
  if (disabled) skipBtn.disabled = true;

  rows.push(el("div", { class: "bar-row" }, [skipBtn, nextBtn]));
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
      el("span", { class: "hint-box-title" }, [S.HINT]),
      el("button", { class: "skip-link", onclick: () => { state.hintVisible = false; render(); } }, [S.GOT_IT]),
    ]),
    el("p", { class: "hint-box-text" }, [hint]),
  ]);
}

/** "QUESTION X OF N" + Hint (and Anonymous on a poll) — mirrors the badge row in
 *  QuizPreviewScreen.kt. The number is gated by quiz.showQuestionNumbers. */
function buildBadgeRow(quiz, q) {
  const anonymous = q.type === "POLL" && (q.pollSettings || {}).anonymous !== false;
  const end = [];
  if (anonymous) end.push(el("span", { class: "anon-chip" }, [html(LOCK_SVG), S.ANONYMOUS]));
  if (q.hint) {
    const hintBtn = el("button", { class: "hint-link", onclick: showHintAction }, [html(BULB_SVG), S.HINT_BUTTON]);
    // Disabled during instant feedback: the question is settled, nothing left to hint at.
    if (state.instantFeedback) hintBtn.disabled = true;
    end.push(hintBtn);
  }
  if (!quiz.showQuestionNumbers && end.length === 0) return null;
  return el("div", { class: "badge-row" }, [
    quiz.showQuestionNumbers
      ? el("span", { class: "q-badge" }, [S.questionXofN(state.currentIndex + 1, quiz.questions.length)])
      : el("span", {}, []),
    el("div", { class: "badge-row-end" }, end),
  ]);
}

/** Question card with the accent bar — mirrors QuizScreenComponents.kt's QuestionCard.
 *  Fill Blank has an optional heading instead of a mandatory question text: the card
 *  shows just its helper line when the creator left it blank (the sentence itself is
 *  shown, interactively, below). */
function buildQuestionCard(q) {
  const title = q.type === "FILL_BLANK" ? (q.fillBlankContent?.title || "").trim() : q.text;
  const body = [];
  if (q.type === "POLL") body.push(el("div", { class: "q-overline" }, [S.POLL_OVERLINE]));
  if (title) {
    body.push(el("div", { class: "q-title" + (q.type === "TRUE_FALSE" ? " statement" : "") }, [renderMarkdown(title)]));
  }
  body.push(buildQuestionHelper(q));
  return el("div", { class: "q-card" }, [el("div", { class: "q-card-accent" }, []), el("div", { class: "q-card-body" }, body)]);
}

function buildQuestionHelper(q) {
  switch (q.type) {
    case "SINGLE_CHOICE":
      return el("div", { class: "q-helper" }, [S.HELPER_SINGLE_CHOICE]);
    case "MULTIPLE_CORRECT":
      // "Select all that apply" would tell an any-one-is-enough taker to keep ticking.
      return el("span", { class: "select-all-chip" }, [
        html(CHECKBOX_OUTLINE_SVG),
        q.acceptAnyCorrect ? S.SELECT_ANY_CORRECT : S.SELECT_ALL_THAT_APPLY,
      ]);
    case "TRUE_FALSE":
      return el("div", { class: "q-helper dot" }, [el("span", { class: "q-helper-dot" }, []), S.HELPER_TRUE_FALSE]);
    case "WRITTEN":
      return el("div", { class: "q-helper" }, [html(PENCIL_SVG), S.HELPER_WRITTEN]);
    case "FILL_BLANK":
      return el("div", { class: "q-helper" }, [html(TEXT_FIELDS_SVG), S.HELPER_FILL_BLANK]);
    default: {
      const settings = q.pollSettings || {};
      return el("div", { class: "q-helper" }, [
        S.pollHelper(
          settings.allowMultiple ? S.SELECT_ALL_THAT_APPLY : S.POLL_HELPER_SINGLE,
          settings.anonymous !== false ? S.POLL_HELPER_ANONYMOUS : S.POLL_HELPER_NAMED
        ),
      ]);
    }
  }
}

function buildFeedbackBanner(fb) {
  return el("div", { class: "feedback-banner " + (fb.isCorrect ? "correct" : "wrong") }, [fb.isCorrect ? S.FEEDBACK_CORRECT : S.FEEDBACK_WRONG]);
}

function renderQuiz() {
  const q = currentQuestion();
  const quiz = state.quiz;
  const accent = themeColorFromName(quiz.themeColorName);
  document.documentElement.style.setProperty("--accent", accent);
  const isLastQuestion = state.currentIndex === quiz.questions.length - 1;
  const fb = state.instantFeedback;

  const questionArea = el("div", { class: "quiz-body" }, []);
  const badgeRow = buildBadgeRow(quiz, q);
  if (badgeRow) questionArea.appendChild(badgeRow);
  questionArea.appendChild(buildQuestionCard(q));
  if (q.hint && state.hintVisible) {
    questionArea.appendChild(buildHintBox(q.hint));
  }

  if (q.type === "POLL") {
    if (!state.pollState) {
      questionArea.appendChild(el("p", { class: "muted" }, [S.LOADING]));
    } else if (state.pollDistribution && !state.pollEditingVote) {
      questionArea.appendChild(buildPollResults(q));
    } else {
      questionArea.appendChild(buildPollVoting(q));
    }
  } else if (q.type === "FILL_BLANK") {
    // The sentence always stays on screen, even during feedback — it's just as much
    // the answer *display* as it is the input, so it renders its own correct/wrong
    // coloring inline.
    if (q.fillBlankContent) {
      questionArea.appendChild(buildFillBlankSentence(q));
    }
    if (fb) {
      questionArea.appendChild(buildFeedbackBanner(fb));
      const ordered = q.fillBlankContent ? FB.orderedBlanks(q.fillBlankContent) : [];
      ordered.forEach((blank, i) => {
        if (fb.blankCorrectness && fb.blankCorrectness[i] === false) {
          const correctAnswer = (blank.acceptedAnswers || [])[0];
          if (correctAnswer) {
            questionArea.appendChild(
              el("p", { class: "fb-answer-reveal" }, [S.blankCorrectAnswer(i + 1, correctAnswer)])
            );
          }
        }
      });
    }
  } else if (q.type === "WRITTEN") {
    questionArea.appendChild(buildWrittenAnswer());
    if (fb) {
      questionArea.appendChild(buildFeedbackBanner(fb));
      if (!fb.isCorrect && fb.correctWrittenAnswer) {
        questionArea.appendChild(el("p", { class: "muted" }, [S.correctAnswerIs(fb.correctWrittenAnswer)]));
      }
    }
  } else {
    questionArea.appendChild(buildChoiceList(q));
    if (fb) questionArea.appendChild(buildFeedbackBanner(fb));
  }

  main.appendChild(el("div", { class: "quiz-screen" }, [
    buildQuizTopBar(quiz, q),
    buildQuestionProgressBar(quiz),
    questionArea,
    buildBottomBar(q, isLastQuestion, onSkip, onNext),
  ]));
  updateTimerDisplay();
}

// ── Answer cards (mirrors QuizScreenComponents.kt: ChoiceOptionCard / TrueFalseCard /
// AnswerInputCard) ───────────────────────────────────────────────────────────

function optionLetter(index) {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

/** Options for SINGLE_CHOICE / MULTIPLE_CORRECT / TRUE_FALSE. While instant feedback is
 *  showing, the correct option(s) turn green and a picked-but-wrong one red, and nothing
 *  is clickable. */
function buildChoiceList(q) {
  const fb = state.instantFeedback;
  const isMulti = q.type === "MULTIPLE_CORRECT";
  const isTrueFalse = q.type === "TRUE_FALSE";
  const list = el("div", { class: "choice-list" + (isMulti ? " tight" : "") }, []);
  (q.options || []).forEach((optText, i) => {
    const selected = state.selectedAnswers.has(String(i));
    let feedback = "";
    if (fb && fb.correctOptionIndices) {
      if (fb.correctOptionIndices.has(i)) feedback = "correct";
      else if (selected) feedback = "wrong";
    }
    const onClick = fb ? null : () => toggleAnswer(i);
    list.appendChild(isTrueFalse
      ? buildTrueFalseCard(optText, i, selected, feedback, onClick)
      : buildChoiceCard({ index: i, text: optText, selected, multi: isMulti, feedback, onClick }));
  });
  const wrap = el("div", { class: "choice-wrap" }, [list]);
  const count = state.selectedAnswers.size;
  if (isMulti && !fb && count > 0) {
    wrap.appendChild(el("div", { class: "selected-count-row" }, [
      el("span", { class: "selected-count-chip" }, [html(CHECK_CIRCLE_SVG), S.optionsSelected(count)]),
    ]));
  }
  return wrap;
}

function buildChoiceIndicator(selected, multi, feedback) {
  if (feedback) {
    return el("span", { class: "fb-badge " + feedback }, [html(feedback === "correct" ? CHECK_SVG : CLOSE_X_SVG)]);
  }
  return el("span", { class: multi ? "ind-check" : "ind-radio" }, selected ? [html(CHECK_SVG)] : []);
}

function buildChoiceCard({ index, text, selected, multi, feedback, onClick, poll, locked }) {
  const classes = ["choice-card"];
  if (selected && !feedback) classes.push("selected");
  if (feedback) classes.push(feedback);
  if (poll) classes.push("poll");
  if (locked) classes.push("locked");
  if (!onClick) classes.push("inert");
  const props = { class: classes.join(" "), role: multi ? "checkbox" : "radio", "aria-checked": selected ? "true" : "false" };
  if (onClick) props.onclick = onClick;
  const textCol = el("div", { class: "choice-text" }, [el("span", { class: "choice-label" }, [text])]);
  if (poll && selected) textCol.appendChild(el("span", { class: "choice-sub" }, [S.YOUR_SELECTION]));
  return el("div", props, [
    el("span", { class: "letter-box" }, [optionLetter(index)]),
    textCol,
    buildChoiceIndicator(selected, multi, feedback),
  ]);
}

function buildTrueFalseCard(text, index, selected, feedback, onClick) {
  const classes = ["choice-card", "tf-card"];
  if (selected && !feedback) classes.push("selected");
  if (feedback) classes.push(feedback);
  if (!onClick) classes.push("inert");
  const props = { class: classes.join(" "), role: "radio", "aria-checked": selected ? "true" : "false" };
  if (onClick) props.onclick = onClick;
  return el("div", props, [
    el("span", { class: "tf-icon" }, [html(index === 0 ? TF_CHECK_SVG : TF_X_SVG)]),
    el("div", { class: "choice-text" }, [
      el("span", { class: "tf-title" }, [text]),
      el("span", { class: "tf-sub" }, [selected ? S.TF_SELECTED : S.TF_ALTERNATIVE]),
    ]),
    buildChoiceIndicator(selected, false, feedback),
  ]);
}

/** Written answer — the same single <textarea> (maxlength, placeholder, oninput) inside
 *  the "YOUR ANSWER" card. Its value comes from state, so a re-render (opening the hint,
 *  Clear) never wipes what was typed. */
function buildWrittenAnswer() {
  const fb = state.instantFeedback;
  const countNum = el("b", {}, [String(state.writtenAnswer.length)]);
  const counter = el("span", { class: "char-chip" }, [countNum, S.charCountSuffix(RESPONSE_MAX_CHARS)]);
  const textareaProps = {
    rows: "4",
    maxlength: String(RESPONSE_MAX_CHARS),
    placeholder: S.ANSWER_PLACEHOLDER,
    oninput: (e) => {
      state.writtenAnswer = e.target.value;
      countNum.textContent = String(e.target.value.length);
      scheduleLastQuestionAutoFinish();
    },
  };
  if (fb) textareaProps.disabled = "true";
  const textarea = el("textarea", textareaProps, []);
  textarea.value = state.writtenAnswer;

  const clearBtn = el("button", {
    class: "answer-clear",
    onclick: () => { state.writtenAnswer = ""; cancelLastQuestionAutoFinish(); render(); },
  }, [S.CLEAR]);
  if (fb) clearBtn.disabled = true;

  return el("div", { class: "answer-card" + (fb ? (fb.isCorrect ? " correct" : " wrong") : "") }, [
    el("div", { class: "answer-head" }, [el("span", { class: "answer-label" }, [S.YOUR_ANSWER_LABEL]), counter]),
    el("div", { class: "answer-divider" }, []),
    textarea,
    el("div", { class: "answer-divider" }, []),
    el("div", { class: "answer-foot" }, [clearBtn]),
  ]);
}

// ── Poll — voting + results (mirrors PollComponents.kt's PollVotingBody /
// PollDistributionBody: options in the per-voter shuffled order, "Other" and
// "Why?" fields, then a static percent-bar distribution once closed). ───────

function buildPollVoting(q) {
  const settings = q.pollSettings || {};
  const locked = state.pollHasVoted && settings.allowVoteChange === false;
  const container = el("div", { class: "choice-list" }, []);

  // "Select all that apply" lives in the question card's helper line now.
  const optionRow = (idx, label, position) => buildChoiceCard({
    index: position,
    text: label,
    selected: state.pollSelected.has(idx),
    multi: !!settings.allowMultiple,
    poll: true,
    locked,
    onClick: locked ? null : () => togglePollOption(idx),
  });

  state.pollDisplayOrder.forEach((idx, position) => {
    container.appendChild(optionRow(idx, (q.options || [])[idx], position));
  });

  if (settings.allowOther) {
    const otherSelected = state.pollSelected.has(PL.POLL_OTHER_INDEX);
    container.appendChild(optionRow(PL.POLL_OTHER_INDEX, S.POLL_OTHER, state.pollDisplayOrder.length));
    if (otherSelected) {
      const otherProps = {
        type: "text",
        maxlength: String(RESPONSE_MAX_CHARS),
        placeholder: S.ANSWER_PLACEHOLDER,
        value: state.pollOtherText,
        oninput: (e) => { state.pollOtherText = e.target.value; },
      };
      if (locked) otherProps.disabled = "true";
      container.appendChild(el("input", otherProps));
    }
  }

  if (settings.askReason && state.pollSelected.size > 0) {
    const counter = el("span", { class: "reason-count" }, [S.charCount(state.pollReasonText.length, RESPONSE_MAX_CHARS)]);
    const reasonProps = {
      rows: "2",
      maxlength: String(RESPONSE_MAX_CHARS),
      placeholder: S.POLL_REASON_PLACEHOLDER,
      oninput: (e) => {
        state.pollReasonText = e.target.value;
        counter.textContent = S.charCount(e.target.value.length, RESPONSE_MAX_CHARS);
      },
    };
    if (locked) reasonProps.disabled = "true";
    const reasonInput = el("textarea", reasonProps, []);
    reasonInput.value = state.pollReasonText;
    container.appendChild(el("div", { class: "reason-box" }, [
      el("div", { class: "reason-head" }, [html(COMMENT_SVG), el("span", { class: "reason-label" }, [S.REASON_LABEL]), counter]),
      reasonInput,
    ]));
  }

  if (state.pollHasVoted) {
    container.appendChild(el("p", { class: "poll-voted-check" }, [S.POLL_VOTED]));
    // Don't promise results on close when the owner never shares them at all.
    if (!PL.pollResultsVisibleToVoters(settings)) {
      container.appendChild(el("p", { class: "poll-note" }, [S.POLL_RESULTS_NOT_SHARED]));
    } else if (locked) {
      container.appendChild(el("p", { class: "poll-note" }, [S.POLL_RESULTS_AFTER_CLOSE]));
    }
  } else if (state.pollSelected.size > 0) {
    container.appendChild(el("p", { class: "poll-note" }, [S.POLL_TAP_NEXT]));
  }

  return container;
}

function buildPollResults(q) {
  const dist = state.pollDistribution;
  const container = el("div", { style: "display:flex;flex-direction:column;gap:10px" }, [
    el("p", { class: "poll-note" }, [S.participantCount(dist.voterCount)]),
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

  const settings = q.pollSettings || {};
  if (state.pollState?.status !== "CLOSED" && settings.allowVoteChange) {
    container.appendChild(
      el("p", { class: "poll-change-vote", onclick: () => { state.pollEditingVote = true; cancelLastQuestionAutoFinish(); render(); } }, [S.POLL_CHANGE_VOTE])
    );
  }

  return container;
}

/** Fetches every Poll question's votes for the finished/already-taken quiz and builds
 *  the result-screen item for each — mirrors ResultViewModel.kt's loadFromAttempt poll
 *  block: live tally regardless of open/closed status (no more "wait for the poll to
 *  close" gate on this screen), and "my vote" matched by voterKey (this account's own
 *  id, always known to itself) rather than participantId (which is nulled out for an
 *  anonymous poll to hide it from OTHER voters/the owner) — so a voter's own choice is
 *  always visible to them even on an anonymous poll. */
async function buildResultPollItems(quiz, user) {
  const pollQuestions = quiz.questions.filter((q) => q.type === "POLL");
  if (pollQuestions.length === 0) return [];
  const [results, states] = await Promise.all([
    Promise.all(pollQuestions.map((q) => SC.fetchPollVotes(q.id).catch(() => []))),
    // Open/closed is only a label on the review card ("Poll Closed" / "Poll Open") — a
    // failed fetch just leaves it as a plain "Poll", never blocks the result.
    SC.fetchPollStates(pollQuestions.map((q) => q.id)).catch(() => ({})),
  ]);
  return pollQuestions.map((q, i) => {
    const votes = results[i] || [];
    const myVote = user ? votes.find((v) => v.voterKey === user.id) || null : null;
    // Null when the owner didn't share results — buildPollReviewCard shows a note instead.
    const distribution = PL.pollResultsVisibleToVoters(q.pollSettings)
      ? PL.computePollDistribution(q.options || [], votes)
      : null;
    const status = states && states[q.id] ? states[q.id].status : null;
    return { question: q, distribution, myVote, status };
  });
}

const expandedPollReviews = new Set();

/** Mirrors ResultScreen.kt's PollReviewCard — same review-card shell buildReviewCard
 *  uses (accent bar, Q# pill, expand/collapse), swapping the body for the live vote
 *  distribution instead of correct/incorrect. */
function buildPollReviewCard(item, index) {
  const q = item.question;
  const expanded = expandedPollReviews.has(q.id);
  const typeLabel = item.status === "CLOSED" ? S.TYPE_POLL_CLOSED : item.status === "OPEN" ? S.TYPE_POLL_OPEN : S.TYPE_POLL;

  const header = buildReviewHeader({
    stateClass: "poll",
    index,
    typeLabel,
    timeSec: null,
    text: q.text,
    right: [],
    expanded,
    onToggle: () => { expandedPollReviews.has(q.id) ? expandedPollReviews.delete(q.id) : expandedPollReviews.add(q.id); render(); },
  });
  const card = el("div", { class: "review-card poll" + (expanded ? " open" : "") }, [header]);

  if (expanded) {
    const dist = item.distribution;
    // Owner kept the results private — this page is only ever a voter's view, so there's
    // nothing to show but a note (matches ResultScreen.kt's PollReviewCard).
    if (!dist) {
      card.appendChild(el("div", { class: "review-body" }, [
        el("p", { class: "poll-note" }, [S.POLL_RESULTS_NOT_SHARED]),
      ]));
      return card;
    }
    const consensus = PL.computePollConsensus(dist);
    const myVoteIndices = new Set(item.myVote?.selectedOptionIndices || []);
    const bodyEl = el("div", { class: "review-body" }, []);
    if (consensus) bodyEl.appendChild(el("div", { class: "poll-consensus" }, [consensusText(consensus)]));
    dist.options.forEach((opt) => {
      bodyEl.appendChild(buildPollResultRow(opt, myVoteIndices.has(opt.optionIndex)));
    });
    if (dist.other.count > 0) {
      bodyEl.appendChild(buildPollResultRow(dist.other, myVoteIndices.has(PL.POLL_OTHER_INDEX), dist.otherEntries));
    }
    bodyEl.appendChild(el("div", { class: "poll-footer" }, [
      el("span", {}, [S.pollRespondents(dist.voterCount)]),
      el("span", { class: "poll-unscored" }, [S.POLL_UNSCORED]),
    ]));
    card.appendChild(bodyEl);
  }
  return card;
}

function buildPollResultRow(opt, mine, otherEntries) {
  // poll.js labels the Other bucket with an internal English placeholder — it has no
  // access to the string table — and documents that the UI must substitute its own
  // text by keying off POLL_OTHER_INDEX rather than rendering that literal.
  const label = opt.optionIndex === PL.POLL_OTHER_INDEX ? S.POLL_OTHER : opt.label;
  const labelChildren = [el("span", { class: "label" }, [label])];
  if (mine) labelChildren.push(el("span", { class: "your-vote-tag" }, [S.RESULT_YOUR_VOTE]));
  const children = [
    el("div", { class: "top" }, [
      el("span", { class: "label-wrap" }, labelChildren),
      el("span", { class: "pct" }, [S.pollPctVotes(opt.percent, opt.count)]),
    ]),
    el("div", { class: "poll-result-bar" }, [el("div", { class: "poll-result-bar-fill", style: `width:${opt.percent}%` })]),
  ];
  // "Other" free-text entries — what people actually typed, grouped and counted by
  // computePollDistribution's otherEntries (only ever present when the owner allowed
  // "Other" on this poll).
  if (otherEntries && otherEntries.length > 0) {
    children.push(
      el("ul", { class: "poll-other-entries" }, otherEntries.map((entry) =>
        el("li", {}, [S.otherEntry(entry.text, entry.count)])
      ))
    );
  }
  // Per-voter "why" text — only collected when the owner turned on Ask Reason.
  if (opt.reasons && opt.reasons.length > 0) {
    children.push(
      el("ul", { class: "poll-reasons" }, opt.reasons.map((reason) => el("li", {}, [S.quotedReason(reason)])))
    );
  }
  return el("div", { class: "poll-result-row" + (mine ? " mine" : "") }, children);
}

function consensusText(c) {
  if (c.type === "strong") return S.consensusStrong(c.percent, c.option);
  if (c.type === "divided") return S.consensusDivided(c.optionA, c.optionB);
  return S.consensusLeading(c.option, c.percent);
}

/** Shared review-card header — left accent bar, Q# pill, type badge, time, question
 *  text, right-side badges (marks etc.) and the expand chevron. */
function buildReviewHeader({ stateClass, index, typeLabel, timeSec, text, right, expanded, onToggle }) {
  const meta = el("div", { class: "review-meta" }, [
    el("span", { class: "q-pill " + stateClass }, [S.questionPill(index + 1)]),
    el("span", { class: "type-badge " + stateClass }, [typeLabel]),
  ]);
  if (timeSec != null) {
    meta.appendChild(el("span", { class: "review-time" }, [html(CLOCK_SMALL_SVG), S.timeTaken(timeSec)]));
  }
  const rightEl = el("div", { class: "review-right" }, right || []);
  rightEl.appendChild(html(expanded ? CHEVRON_UP_SVG : CHEVRON_DOWN_SVG));
  return el("div", { class: "review-header", onclick: onToggle }, [
    el("div", { class: "review-accent " + stateClass }, []),
    el("div", { class: "review-main" }, [meta, el("div", { class: "review-question" }, [stripMarkdownText(text)])]),
    rightEl,
  ]);
}

const CLOCK_SMALL_SVG = `<svg viewBox="0 0 16 16" fill="none" width="12" height="12"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3l2 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEVRON_UP_SVG = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M4 10l4-4 4 4" stroke="#BBBACC" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

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

  return el("div", { class: "sentence-card" }, [
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
  const placeholder = S.BLANK_PLACEHOLDER;

  const mirror = el("span", { class: "fb-blank-mirror" }, [value || placeholder]);
  const input = el("input", {
    type: "text",
    class: "fb-blank-input" + (value.trim() ? " filled" : ""),
    value,
    maxlength: String(RESPONSE_MAX_CHARS),
    placeholder,
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    enterkeyhint: isLast ? "done" : "next",
    oninput: (e) => {
      const v = e.target.value;
      state.fillBlankDraft[orderIndex] = v;
      scheduleLastQuestionAutoFinish();
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
/** True while an answer is still waiting on the owner's manual mark — shared by
 *  computeScoreBreakdown, the headline score recompute in renderResult, and the review
 *  card's own pending styling, so all three always agree on what "not graded yet" means. */
function isPendingAnswer(a) {
  return a.needsManualMarking === true && a.awardedPoints == null;
}

function computeScoreBreakdown(answers) {
  const marksTrack = answers.filter((a) => a.maxPoints > 0);
  const correctnessTrack = answers.filter((a) => !(a.maxPoints > 0));

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
    right.push(el("div", { class: "score-section-percent" }, [S.percent(percent)]));
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
// No accuracy%/progress bar here anymore — the score itself (and the Marks/
// Correctness sections below, for a graded quiz) already say everything a
// percentage would, without implying a pass/fail-style judgment on top of it.
/**
 * @param marks Optional { awarded, total, percent } — when a marks-carrying quiz is fully
 *   graded (never while anything in that track is still pending), its percent fills the
 *   empty right side of the numbers row instead of leaving it blank (this row used to be a
 *   two-sided layout back when it also showed an overall accuracy% — see accuracy-num/
 *   accuracy-label in style.css, reused here rather than adding a whole new section that
 *   would just make the card taller).
 */
function buildScoreCard(score, total, marks) {
  const badge = el("div", { class: "badge" }, []);
  badge.appendChild(html(TROPHY_SVG));

  const labelColumn = [el("div", { class: "label" }, [S.RESULT_YOUR_SCORE])];
  if (score === 0) {
    labelColumn.push(el("div", { class: "status" }, [S.RESULT_FAILED]));
  }

  const numbersRow = [
    el("div", {}, [
      el("div", { style: "display:flex;align-items:flex-end" }, [
        el("span", { class: "score-big" }, [String(score)]),
        el("span", { class: "score-total" }, [S.outOf(total)]),
      ]),
      el("div", { class: "score-caption" }, [S.RESULT_QUESTIONS_CORRECT]),
    ]),
  ];
  if (marks) {
    numbersRow.push(
      el("div", {}, [
        el("div", { class: "accuracy-num" }, [S.percent(marks.percent)]),
        el("div", { class: "accuracy-label" }, [S.marksLine(marks.awarded, marks.total)]),
      ])
    );
  }

  return el("div", { class: "score-card" }, [
    el("div", { class: "row-top" }, [
      badge,
      el("div", {}, labelColumn),
    ]),
    el("div", { class: "numbers" }, numbersRow),
  ]);
}

/**
 * "Waiting to be marked" — mirrors ResultScreen.kt's PendingReviewCard.
 *
 * Doubles as the partial-marking banner: when some questions WERE app-checked
 * ([gradedCount] > 0) it renders under the score card and reports that part too, since
 * withholding it entirely would mean the taker learns nothing from this screen.
 */
function buildPendingCard(pending, score, gradedCount) {
  const body = gradedCount > 0 ? S.pendingPartial(score, gradedCount, pending) : S.RESULT_PENDING_BODY;

  return el("div", { class: "pending-card" }, [
    el("div", { class: "pending-title" }, [S.RESULT_PENDING_TITLE]),
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

  const right = [];
  // Per-row marks badge ("X/Y") for a points-carrying question (ResultScreen.kt's badge).
  if (answer.maxPoints > 0) {
    right.push(el("span", { class: "marks-badge " + stateClass }, [S.marksFraction(answer.awardedPoints ?? 0, answer.maxPoints)]));
  }
  if (isPending) right.push(el("span", { class: "pending-tag" }, [S.RESULT_AWAITING_MARKING]));
  if (answer.usedHint) right.push(el("span", { class: "hint-used-tag" }, [S.HINT]));

  const header = buildReviewHeader({
    stateClass,
    index,
    typeLabel: questionTypeLabel(q),
    timeSec: answer.timeTakenSec,
    text: q.text,
    right,
    expanded,
    onToggle: () => { expandedReviews.has(q.id) ? expandedReviews.delete(q.id) : expandedReviews.add(q.id); render(); },
  });

  const card = el("div", { class: "review-card " + stateClass + (expanded ? " open" : "") }, [header]);

  if (expanded) {
    const bodyEl = el("div", { class: "review-body" }, []);
    if (q.type === "WRITTEN") {
      bodyEl.appendChild(buildWrittenReview(q, answer, isPending, isCorrect));
    } else if (q.type === "FILL_BLANK") {
      bodyEl.appendChild(buildFillBlankReview(q, answer, isPending, isCorrect));
    } else if (q.type === "TRUE_FALSE") {
      bodyEl.appendChild(buildTrueFalseReview(q, answer, isPending));
    } else {
      bodyEl.appendChild(buildChoiceReview(q, answer, isPending));
    }
    // Creator-written explanation — only when one exists, and never while the answer is
    // still waiting to be marked (it would reveal the reference before the judgment).
    if (!isPending && q.reason && q.reason.trim()) {
      bodyEl.appendChild(el("div", { class: "reason-box" }, [
        el("strong", {}, [S.RESULT_EXPLANATION]),
        " " + q.reason.trim(),
      ]));
    }
    card.appendChild(bodyEl);
  }
  return card;
}

function questionTypeLabel(q) {
  switch (q.type) {
    case "WRITTEN": return S.TYPE_WRITTEN;
    case "MULTIPLE_CORRECT": return S.TYPE_MULTI;
    case "FILL_BLANK": return S.TYPE_FILL;
    case "TRUE_FALSE": return S.TYPE_TF;
    case "POLL": return S.TYPE_POLL;
    default: return S.TYPE_SINGLE;
  }
}

/** "Your Typed Answer" box (red/green/amber) + "Accepted Answers" box (hidden while
 *  pending — it's the owner's marking reference). The verdict chip comes from the
 *  evaluator's status when this result was just graded in this tab; a result reloaded
 *  later only has isCorrect, so it degrades to Match / Mismatch. */
function buildWrittenReview(q, answer, isPending, isCorrect) {
  const given = (answer.givenAnswers || [])[0] || "";
  const evalResult = answer.evaluationResult;
  const mineChip = isPending
    ? S.RESULT_AWAITING_MARKING
    : evalResult && WRITTEN_STATUS_LABELS[evalResult.status] && evalResult.status !== "EXACT_MATCH" && evalResult.status !== "INCORRECT"
      ? WRITTEN_STATUS_LABELS[evalResult.status]
      : isCorrect ? S.RESULT_MATCH : S.RESULT_MISMATCH;
  const mineState = isPending ? "pending" : isCorrect ? "correct" : "wrong";
  const wrap = el("div", { class: "written-review" }, [
    el("div", { class: "answer-box " + mineState }, [
      el("div", { class: "answer-box-head" }, [
        el("span", { class: "answer-box-label" }, [html(mineState === "wrong" ? BAR_SVG : TICK_SVG), S.RESULT_YOUR_TYPED]),
        el("span", { class: "answer-chip " + mineState }, [mineChip]),
      ]),
      el("div", { class: "answer-box-text mono" }, [given || S.RESULT_NO_ANSWER]),
    ]),
  ]);
  if (!isPending) {
    const acceptedHead = [el("span", { class: "answer-box-label" }, [html(TICK_SVG), S.RESULT_ACCEPTED])];
    if (evalResult && WRITTEN_STATUS_LABELS[evalResult.status]) {
      acceptedHead.push(el("span", { class: "answer-chip correct" }, [WRITTEN_STATUS_LABELS[evalResult.status]]));
    }
    const acceptedChildren = [
      el("div", { class: "answer-box-head" }, acceptedHead),
      el("div", { class: "answer-box-text mono strong" }, [q.writtenAnswer || ""]),
    ];
    if (evalResult) {
      acceptedChildren.push(buildWrittenEvalDetail(evalResult, answer.awardedPoints, answer.maxPoints));
    }
    wrap.appendChild(el("div", { class: "answer-box correct" }, acceptedChildren));
  }
  return wrap;
}

/** The sentence with each blank rendered as the taker's own text — green when it
 *  matched, red (with the accepted answer chip right after it) when it didn't; amber
 *  and unrevealed for manual marking. */
function buildFillBlankReview(q, answer, isPending, isCorrect) {
  const content = q.fillBlankContent;
  if (!content) return el("div", {}, []);
  const segments = FB.parseFillBlankTemplate(content.template, content.blanks);
  const given = answer.givenAnswers || [];
  const children = segments.map((seg) => {
    if (seg.type === "text") return el("span", { class: "fb-word" }, [seg.text]);
    const givenText = given[seg.orderIndex] || "";
    if (answer.needsManualMarking) {
      const cls = isPending ? "pending" : isCorrect ? "correct" : "wrong";
      return el("span", { class: "fb-review-chip " + cls }, [givenText || S.RESULT_NO_ANSWER]);
    }
    const ok = FB.fillBlankIsCorrect(seg.blank, givenText, content.checking);
    const frag = document.createDocumentFragment();
    frag.appendChild(el("span", { class: "fb-review-chip " + (ok ? "correct" : "wrong") }, [givenText || S.RESULT_NO_ANSWER]));
    if (!ok) {
      const correctText = (seg.blank.acceptedAnswers || []).find((a) => a && a.trim()) || "";
      if (correctText) frag.appendChild(el("span", { class: "fb-review-chip correct answer" }, [correctText]));
    }
    return frag;
  });
  return el("div", { class: "fb-review-sentence" }, children);
}

/** TRUE / FALSE as two tiles — the picked one carries the verdict, the other reads
 *  "Not Selected" (or "Correct Answer" when it was the right one). */
function buildTrueFalseReview(q, answer, isPending) {
  const given = answer.givenAnswers || [];
  const correct = q.correctAnswers || [];
  const tiles = (q.options || []).map((opt) => {
    const wasGiven = given.includes(opt);
    const isCorrectOpt = correct.includes(opt);
    let cls = "";
    let sub = S.RESULT_TAG_NOT_SELECTED;
    if (wasGiven) {
      cls = isPending ? "pending" : isCorrectOpt ? "correct" : "wrong";
      sub = isPending ? S.RESULT_TF_YOUR_PENDING : isCorrectOpt ? S.RESULT_TF_YOUR_CORRECT : S.RESULT_TF_YOUR_WRONG;
    } else if (!isPending && isCorrectOpt) {
      cls = "answer";
      sub = S.RESULT_TAG_CORRECT_ANSWER;
    }
    return el("div", { class: "tf-tile " + cls }, [
      el("div", { class: "tf-tile-label" }, [opt.toUpperCase()]),
      el("div", { class: "tf-tile-sub" }, [sub]),
    ]);
  });
  return el("div", { class: "tf-tiles" }, tiles);
}

/** Single / multiple choice — every option as a row with a radio/checkbox marker and a
 *  right-aligned tag saying what it was to this taker. Pending: only what they picked. */
function buildChoiceReview(q, answer, isPending) {
  const given = answer.givenAnswers || [];
  const correct = q.correctAnswers || [];
  const multi = q.type === "MULTIPLE_CORRECT";
  const rows = (q.options || []).map((opt) => {
    const wasGiven = given.includes(opt);
    const isCorrectOpt = correct.includes(opt);
    let cls = "";
    let tag = "";
    if (isPending) {
      if (wasGiven) { cls = "pending"; tag = S.RESULT_TAG_YOUR_CHOICE; }
    } else if (wasGiven && isCorrectOpt) { cls = "correct"; tag = S.RESULT_TAG_YOUR_CORRECT; }
    else if (wasGiven) { cls = "wrong"; tag = S.RESULT_TAG_YOUR_CHOICE; }
    else if (isCorrectOpt) { cls = "answer"; tag = S.RESULT_TAG_CORRECT_ANSWER; }
    const children = [
      el("span", { class: "choice-marker" + (multi ? " square" : "") }, wasGiven ? [html(TICK_SVG)] : []),
      el("span", { class: "choice-text" }, [opt]),
    ];
    if (tag) children.push(el("span", { class: "choice-tag" }, [tag]));
    return el("div", { class: "choice-row " + cls }, children);
  });
  return el("div", { class: "choice-rows" }, rows);
}

const BAR_SVG = `<svg viewBox="0 0 16 16" fill="none" width="12" height="12"><rect x="6" y="2" width="4" height="12" rx="1.5" fill="currentColor"/></svg>`;

const WRITTEN_STATUS_LABELS = {
  EXACT_MATCH: S.RESULT_CORRECT,
  ACCEPTED_WITH_TYPO: S.EVAL_LABEL_TYPO,
  PARTIAL_MATCH: S.EVAL_LABEL_PARTIAL,
  INCORRECT: S.EVAL_LABEL_INCORRECT,
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
      el("span", { class: "written-eval-points" }, [S.pointsFraction(awardedPoints ?? 0, maxPoints)]),
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
  const { answers } = state.result;
  const total = answers.length;

  // Recomputed fresh from the current answers, NOT state.result.score — that field can
  // come straight from the attempts.score column (goToExistingResult, viewing a result
  // some time after it was graded), which pushGrades() DOES update, but only when
  // grading actually recomputed AnswerResult.isCorrect correctly, and every write here
  // is best-effort with no guaranteed consistency check. Answers, by contrast, are
  // fetched fresh every time and are what the Marks/Correctness sections below are
  // already computed from — deriving the headline from the same source they use keeps
  // the top of the screen from ever contradicting its own breakdown (e.g. showing
  // "Failed, 0/2" while Marks says "11/20"). Mirrors ResultViewModel.kt's own
  // score = gradedReviews.count { it.answer.isCorrect } — recomputed from re-evaluated
  // answers, not trusted from a stored field, for exactly this reason.
  const score = answers.filter((a) => !isPendingAnswer(a) && a.isCorrect).length;

  const pending = answers.filter(isPendingAnswer).length;
  const gradedCount = answers.length - pending;

  // Marks vs plain correctness — two different currencies (see computeScoreBreakdown's
  // doc). Computed before the score card so a fully-graded marks track can be folded
  // straight into it below instead of only ever living in its own separate card.
  const breakdown = computeScoreBreakdown(answers);
  // Only once nothing in that track is still pending — a percentage that could still
  // move (or a 0/40 line while everything's unmarked) belongs in the plain white
  // section below, same as before, not baked into the headline card.
  const marksForScoreCard = breakdown.hasMarks && breakdown.marksPending === 0
    ? { awarded: breakdown.marksAwarded, total: breakdown.marksTotal, percent: breakdown.marksPercent }
    : null;

  const pollItems = state.result.pollItems || [];
  const pollCount = pollItems.length;

  const content = el("div", { class: "screen result-screen" }, [
    el("h1", { class: "quiz-title centered" }, [quiz.title]),
    el("div", { class: "candidate-line" }, [
      html(USER_OUTLINE_SVG),
      S.RESULT_CANDIDATE,
      el("strong", {}, [SC.resolveDisplayName(state.user)]),
    ]),
    el("span", { class: "meta-chip plain count-chip" }, [S.resultCount(total + pollCount, total, pollCount)]),
    // Nothing marked yet means there is no score — not a zero, not a partial one — so the
    // score card is replaced outright rather than showing 0/N (mirrors PendingReviewCard).
    pending > 0 && gradedCount === 0
      ? buildPendingCard(pending, 0, 0)
      : buildScoreCard(score, total, marksForScoreCard),
  ]);

  // Correct / Incorrect / Total Time / Hints Used — pending answers count under neither
  // verdict (the pending banner above already accounts for them).
  const incorrect = answers.filter((a) => !isPendingAnswer(a) && !a.isCorrect).length;
  const totalTime = answers.reduce((sum, a) => sum + (a.timeTakenSec || 0), 0);
  const hints = answers.filter((a) => a.usedHint).length;
  content.appendChild(el("div", { class: "stat-grid" }, [
    buildStatTile("correct", CHECK_STAT_SVG, S.RESULT_STAT_CORRECT, S.qsCount(score)),
    buildStatTile("wrong", BAR_SVG, S.RESULT_STAT_INCORRECT, S.qsCount(incorrect)),
    buildStatTile("time", CLOCK_SMALL_SVG, S.RESULT_STAT_TIME, S.secondsShort(totalTime)),
    buildStatTile("hint", BULB_SVG, S.RESULT_STAT_HINTS, S.hintsUsed(hints)),
  ]));

  if (pending > 0 && gradedCount > 0) {
    // Some questions were app-checked and some weren't: the score above is real but not
    // final, and saying so is the difference between trusting it and being surprised.
    content.appendChild(buildPendingCard(pending, score, gradedCount));
  }

  // Shown separately only when it wasn't already folded into the score card above
  // (still pending, or the score card itself was replaced by the pending card).
  if (breakdown.hasMarks && !marksForScoreCard) {
    content.appendChild(buildScoreSectionCard(
      S.RESULT_MARKS,
      S.RESULT_MARKS_BLURB,
      `${breakdown.marksAwarded} / ${breakdown.marksTotal}`,
      breakdown.marksPercent,
      breakdown.marksPending
    ));
  }
  if (breakdown.hasCorrectness) {
    content.appendChild(buildScoreSectionCard(
      S.RESULT_CORRECT_ANSWERS,
      S.RESULT_CORRECTNESS_BLURB,
      `${breakdown.correctCount} / ${breakdown.correctnessTotal}`,
      breakdown.correctnessPercent,
      breakdown.correctnessPending
    ));
  }

  if (!quiz.showResult) {
    content.appendChild(el("p", { class: "muted", style: "text-align:center" }, [S.RESULT_HIDDEN]));
  } else {
    content.appendChild(el("div", { class: "review-head" }, [
      el("div", { class: "review-head-title" }, [S.RESULT_ANSWER_REVIEW]),
      el("div", { class: "review-head-sub" }, [S.RESULT_REVIEW_SUBTITLE]),
    ]));

    // Filter tabs — All / Incorrect / Correct / Poll (Poll only when there is one).
    const filter = state.resultFilter || "all";
    const tabs = [
      ["all", S.tabAll(total + pollCount)],
      ["incorrect", S.tabIncorrect(incorrect)],
      ["correct", S.tabCorrect(score)],
    ];
    if (pollCount > 0) tabs.push(["poll", S.tabPoll(pollCount)]);
    content.appendChild(el("div", { class: "filter-tabs" }, tabs.map(([key, label]) =>
      el("button", {
        class: "filter-tab " + key + (filter === key ? " active" : ""),
        onclick: () => { state.resultFilter = key; render(); },
      }, [label])
    )));

    // Poll questions interleaved at their original position in the quiz, same as
    // ResultScreen.kt's resultItems (Scored + PollItem, sortedBy index) — a poll
    // sitting between two scored questions shows up between them here too, not
    // dumped at the end.
    const answerByQid = new Map(answers.map((a) => [a.questionId, a]));
    const pollByQid = new Map(pollItems.map((p) => [p.question.id, p]));
    const list = el("div", { class: "review-list" }, []);
    quiz.questions.forEach((q, idx) => {
      if (q.type === "POLL") {
        if (filter !== "all" && filter !== "poll") return;
        const item = pollByQid.get(q.id);
        if (item) list.appendChild(buildPollReviewCard(item, idx));
      } else {
        const a = answerByQid.get(q.id);
        if (!a) return;
        const pendingA = isPendingAnswer(a);
        if (filter === "poll") return;
        if (filter === "correct" && (pendingA || !a.isCorrect)) return;
        if (filter === "incorrect" && (pendingA || a.isCorrect)) return;
        const card = buildReviewCard(a, idx);
        if (card) list.appendChild(card);
      }
    });
    content.appendChild(list);
  }

  // Retake only when the creator allows it and the quiz is still open; PDF is the
  // browser's own print → Save as PDF (see the @media print rules in style.css).
  const actions = el("div", { class: "result-actions" }, []);
  if (quiz.allowRetake && SC.effectiveStatus(quiz) === "ACTIVE") {
    actions.appendChild(el("button", { class: "primary", onclick: retakeQuizAction }, [
      html(REFRESH_SVG), state.joining ? S.JOINING : S.RESULT_RETAKE,
    ]));
    if (state.joinError) actions.appendChild(el("p", { class: "muted", style: "color:var(--error);text-align:center" }, [state.joinError]));
  }
  actions.appendChild(el("button", { class: "outline-btn", onclick: printResult }, [html(PDF_SVG), S.RESULT_PDF]));
  actions.appendChild(el("button", { class: "text-link", onclick: () => leaveQuiz(S.CLOSED_THANKS) }, [S.DONE]));
  content.appendChild(actions);

  main.appendChild(content);
}

function buildStatTile(kind, iconSvg, label, value) {
  return el("div", { class: "stat-tile" }, [
    el("span", { class: "stat-icon " + kind }, [html(iconSvg)]),
    el("div", { class: "stat-text" }, [
      el("span", { class: "stat-label" }, [label]),
      el("span", { class: "stat-value" }, [value]),
    ]),
  ]);
}

/** Print → Save as PDF. While printing, every card is expanded and the filter ignored
 *  (the `printing` class on <body> drives that in CSS), then restored afterwards. */
function printResult() {
  const savedFilter = state.resultFilter;
  const savedReviews = new Set(expandedReviews);
  const savedPolls = new Set(expandedPollReviews);
  state.resultFilter = "all";
  state.quiz.questions.forEach((q) => { expandedReviews.add(q.id); expandedPollReviews.add(q.id); });
  document.body.classList.add("printing");
  render();
  const restore = () => {
    document.body.classList.remove("printing");
    state.resultFilter = savedFilter;
    expandedReviews.clear(); savedReviews.forEach((id) => expandedReviews.add(id));
    expandedPollReviews.clear(); savedPolls.forEach((id) => expandedPollReviews.add(id));
    window.removeEventListener("afterprint", restore);
    render();
  };
  window.addEventListener("afterprint", restore);
  // Deferred a frame so the expanded DOM is painted before the print dialog snapshots it.
  requestAnimationFrame(() => setTimeout(() => window.print(), 50));
}

const USER_OUTLINE_SVG = `<svg viewBox="0 0 24 24" fill="none" width="15" height="15"><circle cx="12" cy="8.5" r="3.5" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 19c.8-3.2 3.3-4.8 6.5-4.8s5.7 1.6 6.5 4.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const CHECK_STAT_SVG = `<svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const REFRESH_SVG = `<svg viewBox="0 0 20 20" fill="none" width="16" height="16"><path d="M16 10a6 6 0 01-10.5 4M4 10a6 6 0 0110.5-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M14.5 3v3.5H11M5.5 17v-3.5H9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const PDF_SVG = `<svg viewBox="0 0 20 20" fill="none" width="16" height="16"><path d="M5 3h7l4 4v10H5V3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 3v4h4M7.5 11h5M7.5 14h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  try {
    if (!shareCode) {
      state.screen = "enterCode";
      render();
      // Fetched after the first paint so a slow/offline flags call never delays showing
      // the code-entry boxes — the screen just re-renders once it lands (fail-open default
      // in the meantime, same as everywhere else this is read).
      state.flags = await SC.fetchFeatureFlags();
      render();
      return;
    }

    render(); // loading

    // Runs alongside the quiz fetch rather than after it — a paused join should be known
    // by the time the enter-code/landing screen first paints, not flicker in a beat later.
    const [quiz, flags] = await Promise.all([
      SC.fetchQuizByShareCode(shareCode),
      SC.fetchFeatureFlags(),
    ]);
    state.flags = flags;
    if (!quiz) {
      // Same entry screen as "no code", with the bad code left in the boxes to fix.
      state.enterCodeDraft = extractCode(shareCode);
      state.enterCodeError = S.ERR_QUIZ_NOT_FOUND;
      state.screen = "enterCode";
      render();
      return;
    }
    state.quiz = quiz;
    state.user = await SC.getCurrentUser();
    if (state.user) {
      window.Analytics.identify(state.user.id, { email: state.user.email });
      state.existingAttempt = await SC.fetchExistingAttempt(quiz.id, state.user.id);
      // With no existingAttempt, a non-null stamp means this account started the quiz
      // (here or in the app) and left without submitting — Retake, or locked when the
      // creator does not allow retakes. Mirrors JoinedQuizItem.hasAbandonedStart.
      state.lastStartedAt = await SC.fetchLastStartedAt(quiz.id, state.user.id);
      // Started before means membership already exists — no separate Join step needed.
      if (state.lastStartedAt) state.hasJoined = true;
    }

    // No retake and already completed: land straight on the real result screen (score
    // breakdown, review cards) instead of a one-line "you've already completed this"
    // blurb with no way to actually see it — mirrors what re-opening a finished attempt
    // in the Android app shows. Only auto-redirects when there's genuinely nothing left
    // to do here (retake off); when retake IS allowed, the landing screen offers both
    // "See Result" and "Retake Exam" instead (see renderLanding).
    if (state.user && state.existingAttempt && quiz.allowRetake === false) {
      await goToExistingResult();
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
