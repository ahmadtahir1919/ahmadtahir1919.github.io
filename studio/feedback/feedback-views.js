// The Send feedback page's pieces: the header with the "free, be honest" note, the star rating,
// category chips, the message form, the thank-you and cooldown cards, and the history list.
// Ports of the composables in ui/feedback/FeedbackScreen.kt. Pure builders: they take state +
// handlers and return nodes.

import { FEEDBACK_CATEGORIES, ratingsPresent } from "../core/feedback.js";
import { S, t } from "../core/strings.js";
import { banner, button, counter, el, timeAgo, updateCounter } from "../ui/components.js";
import { icon } from "../ui/icons.js";

const categoryLabel = (category) => S[`FB_CAT_${category}`] ?? category;
const ratingLabel = (rating) => S[`FB_RATING_${rating}`];

/** What to ask for, by what the message is about. */
function placeholderFor(category) {
  if (category === "BUG" || category === "CRASH" || category === "SYNC" || category === "PERFORMANCE") return S.FB_PH_BUG;
  if (category === "FEATURE_REQUEST") return S.FB_PH_FEATURE;
  if (category === "REPORT_CONTENT") return S.FB_PH_REPORT;
  return S.FB_PH_DEFAULT;
}

/** Title + the note that this is free and honest feedback is what keeps the team going. */
export function header() {
  return el("div", { class: "fb-head" }, [
    el("section", { class: "fb-hero" }, [
      el("span", { class: "fb-hero-mark" }, [icon("feedback")]),
      el("div", { class: "fb-hero-text" }, [el("h2", { text: S.FB_HERO_TITLE }), el("p", { text: S.FB_HERO_SUB })]),
    ]),
    banner(S.FB_NOTE_BODY, { tone: "info", title: S.FB_NOTE_TITLE, iconName: "star" }),
  ]);
}

/** Five stars as a radio group (arrow keys move it), with what the pick means underneath. A second
 *  tap on the chosen star, or "Clear rating", goes back to a plain suggestion (rating 0). */
function stars(state, h) {
  const buttons = [1, 2, 3, 4, 5].map((n) => {
    const on = n <= state.rating;
    return el(
      "button",
      {
        type: "button",
        role: "radio",
        class: `fb-star ${on ? "is-on" : ""}`,
        "aria-checked": state.rating === n ? "true" : "false",
        "aria-label": n === 1 ? S.FB_STAR_ONE : t(S.FB_STAR_MANY, { n }),
        title: ratingLabel(n),
        tabindex: n === (state.rating || 1) ? "0" : "-1",
        "data-fk": `fb-star-${n}`,
        onclick: () => h.onRating(state.rating === n ? 0 : n),
        onkeydown: (e) => {
          const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          const next = Math.min(5, Math.max(1, (state.rating || (step > 0 ? 0 : 6)) + step));
          h.onRating(next, `fb-star-${next}`);
        },
      },
      [icon("star", "icon")]
    );
  });
  return el("div", { class: "fb-rating" }, [
    el("span", { class: "label", text: S.FB_RATING_LABEL }),
    el("div", { class: "fb-stars-row" }, [
      el("div", { class: "fb-stars", role: "radiogroup", "aria-label": S.FB_RATING_LABEL }, buttons),
      el("span", { class: `fb-rating-text ${state.rating ? "is-set" : ""}`, "aria-live": "polite", text: state.rating ? ratingLabel(state.rating) : S.FB_RATING_NONE }),
      state.rating
        ? el("button", { type: "button", class: "link-btn", text: S.FB_CLEAR_RATING, "data-fk": "fb-clear", onclick: () => h.onRating(0) })
        : null,
    ]),
  ]);
}

function chips(state, h) {
  return el("div", { class: "fb-field" }, [
    el("span", { class: "label", text: S.FB_CATEGORY_LABEL }),
    el(
      "div",
      { class: "fb-chips", role: "group", "aria-label": S.FB_CATEGORY_LABEL },
      FEEDBACK_CATEGORIES.map((category) =>
        el("button", {
          type: "button",
          class: `fb-chip ${state.category === category ? "is-on" : ""}`,
          "aria-pressed": state.category === category ? "true" : "false",
          "data-fk": `fb-cat-${category}`,
          text: categoryLabel(category),
          onclick: () => h.onCategory(category),
        })
      )
    ),
  ]);
}

/** The write-to-us form: rating, category, message, Send. Typing never re-renders it (the counter is
 *  updated in place), so the textarea keeps focus and its caret. */
export function form(state, h) {
  const area = el("textarea", {
    class: `textarea fb-msg ${state.error === "message" ? "is-invalid" : ""}`,
    id: "fb-msg",
    rows: "6",
    maxlength: String(state.maxChars),
    value: state.message,
    placeholder: placeholderFor(state.category),
    "aria-label": S.FB_MSG_LABEL,
    "data-fk": "fb-msg",
    oninput: (e) => {
      h.onMessage(e.target.value);
      updateCounter(count, e.target.value.length, state.maxChars);
    },
  });
  const count = counter(state.message.length, state.maxChars);
  const errorText = state.error === "category" ? S.FB_ERR_PICK_CATEGORY : state.error === "message" ? S.FB_ERR_MORE_DETAIL : state.error === "send" ? S.FB_ERR_SEND_FAILED : null;
  const send = button({
    label: S.FB_SEND,
    icon: "send",
    variant: "primary",
    size: "lg",
    cls: `fb-send ${state.sending ? "is-loading" : ""}`,
    disabled: state.sending,
    attrs: { "data-fk": "fb-send" },
    onClick: h.onSend,
  });
  return el("section", { class: "fb-card fb-form" }, [
    stars(state, h),
    chips(state, h),
    el("div", { class: "fb-field" }, [
      el("div", { class: "label-row" }, [el("label", { class: "label", for: "fb-msg", text: S.FB_MSG_LABEL }), count]),
      area,
    ]),
    errorText ? el("p", { class: "field-error", role: "alert", text: errorText }) : null,
    el("div", { class: "fb-actions" }, [send]),
  ]);
}

/** Shown right after a successful send. Stays until the user leaves; nothing auto-dismisses. */
export function thanks(h) {
  return el("section", { class: "fb-card fb-done", role: "status" }, [
    el("span", { class: "fb-done-mark" }, [icon("check")]),
    el("h3", { text: S.FB_THANKS_TITLE }),
    el("p", { text: S.FB_THANKS_BODY }),
    button({ label: S.FB_BACK_DASH, icon: "arrow-left", variant: "secondary", href: h.dashboardHref }),
  ]);
}

/** The 24h window: a calm card instead of a locked form. */
export function cooldown(timeLeft, h) {
  return el("section", { class: "fb-card fb-done", role: "status" }, [
    el("span", { class: "fb-done-mark is-clock" }, [icon("clock")]),
    el("h3", { text: S.FB_COOLDOWN_TITLE }),
    el("p", { text: t(S.FB_COOLDOWN_BODY, { time: timeLeft }) }),
    button({ label: S.FB_BACK_DASH, icon: "arrow-left", variant: "secondary", href: h.dashboardHref }),
  ]);
}

// ── History ─────────────────────────────────────────────────────────────────

function starRow(rating) {
  return el(
    "span",
    { class: "fb-mini-stars", role: "img", "aria-label": rating === 1 ? S.FB_STAR_ONE : t(S.FB_STAR_MANY, { n: rating }) },
    [1, 2, 3, 4, 5].map((n) => el("span", { class: `fb-mini ${n <= rating ? "is-on" : ""}` }, [icon("star", "icon")]))
  );
}

function historyCard(entry) {
  return el("article", { class: "fb-item", "data-fk": `fb-item-${entry.id}` }, [
    el("div", { class: "fb-item-top" }, [
      entry.rating === 0 ? el("span", { class: "fb-badge", text: S.FB_SUGGESTION_BADGE }) : starRow(entry.rating),
      el("span", { class: "fb-when", text: timeAgo(entry.createdAt) }),
    ]),
    entry.category ? el("span", { class: "fb-tag", text: categoryLabel(entry.category) }) : null,
    entry.message ? el("p", { class: "fb-msg-text", text: entry.message }) : null,
    entry.adminReply
      ? el("div", { class: "fb-reply" }, [
          el("div", { class: "fb-reply-top" }, [
            el("b", { text: S.FB_TEAM_REPLY }),
            entry.adminReplyAt ? el("span", { text: timeAgo(entry.adminReplyAt) }) : null,
          ]),
          el("p", { text: entry.adminReply }),
        ])
      : null,
  ]);
}

/** "All · 5★ … 1★ · Suggestions" — only the ratings that have something, so there are no dead pills. */
function filterPills(state, h) {
  const present = ratingsPresent(state.history);
  const pill = (value, label, key) =>
    el("button", {
      type: "button",
      class: `fb-pill ${state.filter === value ? "is-on" : ""}`,
      "aria-pressed": state.filter === value ? "true" : "false",
      "data-fk": `fb-filter-${key}`,
      text: label,
      onclick: () => h.onFilter(value),
    });
  return el("div", { class: "fb-pills", role: "group", "aria-label": S.FB_FILTER_LABEL }, [
    pill(null, S.FB_FILTER_ALL, "all"),
    ...[5, 4, 3, 2, 1].filter((n) => present.has(n)).map((n) => pill(n, `${n}★`, String(n))),
    present.has(0) ? pill(0, S.FB_FILTER_SUGGESTIONS, "0") : null,
  ]);
}

/** Your past feedback and the team's replies. `shown` is already filtered. */
export function history(state, shown, h) {
  const empty =
    !state.history.length
      ? S.FB_EMPTY
      : !shown.length
        ? state.filter === 0
          ? S.FB_EMPTY_SUGGESTIONS
          : t(S.FB_EMPTY_FILTERED, { n: state.filter })
        : null;
  return el("section", { class: "fb-history" }, [
    el("h3", { text: S.FB_HISTORY_TITLE }),
    state.history.length ? filterPills(state, h) : null,
    empty ? el("p", { class: "fb-empty", text: empty }) : el("div", { class: "fb-list" }, shown.map(historyCard)),
  ]);
}
