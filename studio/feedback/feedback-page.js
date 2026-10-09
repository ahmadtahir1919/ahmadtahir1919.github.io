// /feedback/ — Send feedback, a port of the app's ui/feedback/FeedbackScreen.kt +
// FeedbackViewModel.kt against the same feedback table (so the team's inbox and replies are
// shared). Differences from the app, on purpose: no Play Store hand-off (every rating is written
// to us), a note that Quizoma is free and honest feedback keeps the team going, and a thank-you /
// cooldown card instead of a locked form.
//   • rating is optional (0 = a plain suggestion), category and a message of 5+ characters are required;
//   • one submission per 24h (the server's policy is the real gate; the page shows the time left);
//   • below the form: your past feedback with the team's replies, filterable by rating.
//   • ?category=FEATURE_REQUEST (any FEEDBACK_CATEGORIES value) starts the form on that category —
//     the public site's "Request a feature" button links here that way.

import { cooldownRemaining, filterHistory, formatCooldown, listMyFeedback, submitFeedback, validateFeedback, FeedbackCooldownError, FEEDBACK_CATEGORIES } from "../core/feedback.js";
import { requireUser } from "../core/auth.js";
import { fetchLimits } from "../core/limits.js";
import { route } from "../core/paths.js";
import { S } from "../core/strings.js";
import { el, errorBlock, loadingBlock, renderSignInGate, renderSpinner, swap } from "../ui/components.js";
import { stagger } from "../ui/motion.js";
import { mountShell } from "../ui/shell.js";
import * as V from "./feedback-views.js";

const root = document.getElementById("root");
const startCategory = new URLSearchParams(location.search).get("category");

const state = {
  user: null,
  history: [],
  maxChars: 500,
  rating: 0,
  category: FEEDBACK_CATEGORIES.includes(startCategory) ? startCategory : null,
  message: "",
  /** null | "category" | "message" | "send" — what the form is complaining about. */
  error: null,
  sending: false,
  /** True right after a successful send, until the user leaves the page. */
  sent: false,
  /** null = every rating, 0 = suggestions, 1-5 = that rating. */
  filter: null,
};

let shell = null;
let composeRegion = null;
let historyRegion = null;
let ticker = 0;

const handlers = {
  dashboardHref: route(""),
  onRating(value, focusKey) {
    state.rating = value;
    state.error = null;
    renderCompose(focusKey);
  },
  onCategory(category) {
    state.category = category;
    if (state.error === "category") state.error = null;
    renderCompose();
  },
  onMessage(text) {
    state.message = text;
    if (state.error === "message" && text.trim().length >= 5) {
      state.error = null;
      renderCompose();
    }
  },
  onFilter(value) {
    state.filter = state.filter === value ? null : value;
    renderHistory();
  },
  onSend: send,
};

// ── Start ───────────────────────────────────────────────────────────────────

async function start() {
  renderSpinner(root);
  state.user = await requireUser();
  if (!state.user) {
    renderSignInGate(root);
    return;
  }
  shell = mountShell(root, {
    user: state.user,
    active: "feedback",
    title: S.FB_TITLE,
    crumbs: [{ label: S.NAV_DASHBOARD, href: route("") }, { label: S.FB_TITLE }],
    width: "wide",
  });
  shell.content.classList.add("fb-page");
  shell.content.replaceChildren(loadingBlock());
  await load();
}

async function load() {
  try {
    const [limits, history] = await Promise.all([fetchLimits(), listMyFeedback(state.user.id)]);
    state.maxChars = limits.maxFreeTextChars;
    state.history = history;
    paint();
  } catch (error) {
    console.error(error);
    shell.content.replaceChildren(errorBlock(S.ERR_LOAD_FAILED, load));
  }
}

// ── Render ──────────────────────────────────────────────────────────────────

/** First paint: the three regions are created once and then updated in place. */
function paint() {
  composeRegion = el("div", { class: "fb-compose" });
  historyRegion = el("div", { class: "fb-history-region" });
  shell.content.replaceChildren(V.header(), composeRegion, historyRegion);
  renderCompose();
  renderHistory();
  stagger(shell.content);
}

function renderCompose(focusKey) {
  const left = cooldownRemaining(state.history);
  clearInterval(ticker);
  if (state.sent) swap(composeRegion, V.thanks(handlers));
  else if (left > 0) {
    swap(composeRegion, V.cooldown(formatCooldown(left), handlers));
    // The time left counts down; when it reaches zero the form comes back by itself.
    ticker = setInterval(() => renderCompose(), 30000);
  } else swap(composeRegion, V.form(state, handlers));
  if (focusKey) composeRegion.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}

function renderHistory() {
  swap(historyRegion, V.history(state, filterHistory(state.history, state.filter), handlers));
}

// ── Send ────────────────────────────────────────────────────────────────────

async function send() {
  if (state.sending) return;
  const problem = validateFeedback(state);
  if (problem) {
    state.error = problem;
    renderCompose(problem === "category" ? "fb-cat-BUG" : "fb-msg");
    return;
  }
  state.sending = true;
  state.error = null;
  renderCompose("fb-send");
  try {
    await submitFeedback(state.user.id, state);
    state.rating = 0;
    state.category = null;
    state.message = "";
    state.sent = true;
    await refreshHistory();
  } catch (error) {
    if (!(error instanceof FeedbackCooldownError)) {
      console.error(error);
      state.error = "send";
    } else {
      // The server says the 24h window is still open (sent from the app, or another tab).
      await refreshHistory();
    }
  } finally {
    state.sending = false;
    renderCompose();
  }
}

/** Re-reads the history so the new message and the cooldown show; a failed read keeps what we have. */
async function refreshHistory() {
  try {
    state.history = await listMyFeedback(state.user.id);
  } catch (error) {
    console.error(error);
  }
  renderHistory();
}

start();
