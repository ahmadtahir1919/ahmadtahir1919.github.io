// One quiz in the "Your quizzes" grid — the .qc card from design-reference/dashboard.html:
// a header band in the quiz's theme colour with its status pill and initials, the title and a
// meta line, a row of readiness / status chips, and a footer with one primary action, at most
// one secondary, and a ⋮ menu for everything else.
//
// item: { quiz, bucket, questionCount, pollOnly, pollCount, votes, submitted, avgPct, pending,
//         ready, answersSet, missing }
// actions: { publish, closePoll, share, duplicate, archive, remove }

import { joinLink, themeColor } from "../core/models.js";
import { route } from "../core/paths.js";
import { S, t } from "../core/strings.js";
import { copyText, el, openMenu, withLoading } from "../ui/components.js";
import { copyWithTip, initialsOf, plural, relativeDay, timeOrDate } from "./dash-util.js";

/** Cards past this one enter without a stagger delay. */
const STAGGER_CAP = 8;

const editHref = (quiz) => route(`create/?id=${encodeURIComponent(quiz.id)}`);
const resultsHref = (quiz) => route(`results/?id=${encodeURIComponent(quiz.id)}`);
const gradeHref = (quiz) => route(`grading/?quiz=${encodeURIComponent(quiz.id)}`);

/** Where the card itself goes: a draft opens the builder, anything else its results. */
export const openHref = (quiz) => (quiz.isDraft ? editHref(quiz) : resultsHref(quiz));

/** "Missing" hints, in the order they need doing. */
export const MISSING_HINT = { title: () => S.HINT_ADD_TITLE, questions: () => S.HINT_ADD_QUESTIONS, answers: () => S.HINT_SET_ANSWERS };

export function quizCard(item, index, actions, { startIndex = 6 } = {}) {
  const { quiz, bucket } = item;
  const title = quiz.title?.trim() || S.UNTITLED_QUIZ;
  const href = openHref(quiz);
  // There is no "colour not chosen" field (theme_color_name defaults to Indigo), so a draft
  // nobody has named yet is the one that reads as unstyled, like the reference's.
  const colour = quiz.isDraft && !quiz.title?.trim() ? "var(--draft)" : themeColor(quiz.themeColorName);

  const more = el("button", { type: "button", class: "dv-more", "aria-label": S.MORE_ACTIONS, title: S.MORE_ACTIONS, "aria-haspopup": "menu", "aria-expanded": "false", text: S.MORE_GLYPH });
  more.addEventListener("click", () => {
    if (more.getAttribute("aria-expanded") === "true") return;
    openMenu(more, menuItems(item, actions).filter(Boolean));
  });

  const card = el(
    "article",
    { class: "dv-qc dv-rise", "data-s": bucket, "data-fk": `card-${quiz.id}`, vars: { i: String(Math.min(index, STAGGER_CAP) + startIndex), c: colour } },
    [
      el("div", { class: "dv-hd" }, [statusPill(bucket), el("div", { class: "dv-ini", "aria-hidden": "true", text: initialsOf(title) })]),
      el("div", { class: "dv-bd" }, [
        el("a", { class: "dv-qtitle", href, dir: "auto", text: title }),
        el("div", { class: "dv-m", text: metaLine(item) }),
        el("div", { class: "dv-check" }, chips(item)),
      ]),
      el("div", { class: "dv-ft" }, [...footerActions(item, actions), more]),
    ]
  );
  if (index >= STAGGER_CAP) card.style.animationDelay = "0ms";
  card.addEventListener("click", (e) => {
    if (e.target.closest("a, button")) return;
    window.location.href = href;
  });
  return card;
}

function statusPill(bucket) {
  switch (bucket) {
    case "live":
      return el("span", { class: "dv-qst live" }, [el("i"), S.CARD_LIVE]);
    case "sched":
      return el("span", { class: "dv-qst", text: S.STATUS_SCHEDULED });
    case "ended":
      return el("span", { class: "dv-qst", text: S.STATUS_ENDED });
    case "archived":
      return el("span", { class: "dv-qst", text: S.STATUS_ARCHIVED });
    default:
      return el("span", { class: "dv-qst", text: S.STATUS_DRAFT });
  }
}

/** The meta line formats from the spec, one per state. */
function metaLine({ quiz, bucket, questionCount, pollOnly, pollCount, votes, submitted, avgPct }) {
  const questions = plural(questionCount, S.QUESTION_COUNT_ONE, S.QUESTION_COUNT_MANY);
  if (pollOnly && bucket === "live") {
    return [plural(pollCount, S.POLL_COUNT_ONE, S.POLL_COUNT_MANY), plural(votes, S.VOTE_COUNT_ONE, S.VOTE_COUNT_MANY)].join(S.DOT_SEP);
  }
  const parts = [questions];
  if (bucket === "draft") parts.push(t(S.META_CREATED, { when: relativeDay(quiz.createdAt) }));
  else if (bucket === "sched") parts.push(t(S.META_STARTS, { when: timeOrDate(quiz.startAt) }));
  else {
    parts.push(t(S.META_SUBMITTED, { n: submitted }));
    if (bucket === "live") parts.push(quiz.endAt ? t(S.META_CLOSES, { when: timeOrDate(quiz.endAt) }) : S.META_NO_END);
    else if (avgPct != null) parts.push(t(S.META_AVG, { p: avgPct }));
  }
  return parts.join(S.DOT_SEP);
}

/** Readiness for drafts, marking / submissions for open and ended quizzes, the code for scheduled. */
function chips({ quiz, bucket, questionCount, ready, missing, pending, submitted }) {
  const ok = (text) => el("span", { class: "ok", text });
  const plain = (text) => el("span", { text });
  if (bucket === "draft") {
    if (ready) {
      return [ok(S.CHK_QUESTIONS), ok(S.CHK_ANSWERS), quiz.defaultTimeSec > 0 ? plain(t(S.CHK_TIMER, { n: quiz.defaultTimeSec })) : null];
    }
    // What to do next, then what is already there — as the reference's untitled card shows it.
    return [
      missing ? plain(MISSING_HINT[missing]()) : null,
      questionCount ? ok(plural(questionCount, S.CHK_QUESTION_COUNT_ONE, S.CHK_QUESTION_COUNT_MANY)) : null,
    ];
  }
  if (bucket === "sched") {
    const code = el("button", { type: "button", class: "dv-code", "aria-label": t(S.COPY_CODE_LABEL, { code: quiz.shareCode }), text: quiz.shareCode });
    code.addEventListener("click", () => copyWithTip(code, quiz.shareCode));
    return [code];
  }
  if (pending > 0) return [el("span", { class: "warn", text: t(S.N_TO_MARK, { n: pending }) })];
  return [plain(t(S.META_SUBMITTED, { n: submitted }))];
}

/** One primary action and at most one secondary, per the spec's table. */
function footerActions(item, actions) {
  const { quiz, bucket, pending, ready } = item;
  const link = (label, href, pri = false) => el("a", { class: `dv-btn ${pri ? "pri" : ""}`, href, text: label });
  const act = (label, run, pri = false) => {
    const btn = el("button", { type: "button", class: `dv-btn ${pri ? "pri" : ""}`, text: label });
    btn.addEventListener("click", () => withLoading(btn, () => run(quiz)));
    return btn;
  };
  if (bucket === "draft") {
    return ready ? [act(S.PUBLISH, actions.publish, true), link(S.EDIT, editHref(quiz))] : [link(S.CONTINUE_EDITING, editHref(quiz), true)];
  }
  if (bucket === "sched") return [act(S.ACT_SHARE, actions.share, true), link(S.EDIT, editHref(quiz))];
  if (pending > 0) return [link(S.ACT_GRADE, gradeHref(quiz), true), link(S.VIEW_RESULTS, resultsHref(quiz))];
  if (bucket === "live") return [act(S.ACT_SHARE, actions.share, true), link(S.VIEW_RESULTS, resultsHref(quiz))];
  return [link(S.VIEW_RESULTS, resultsHref(quiz), true)];
}

function menuItems({ quiz, bucket, pollOnly, questionCount }, actions) {
  return [
    { label: S.EDIT, iconName: "pencil", onSelect: () => (window.location.href = editHref(quiz)) },
    !quiz.isDraft ? { label: S.VIEW_RESULTS, iconName: "chart", onSelect: () => (window.location.href = resultsHref(quiz)) } : null,
    !quiz.isDraft ? { label: S.COPY_LINK, iconName: "link", onSelect: () => copyText(joinLink(quiz.shareCode), S.LINK_COPIED) } : null,
    bucket === "live" && pollOnly ? { label: S.ACT_CLOSE_POLL, iconName: "stop", onSelect: () => actions.closePoll(quiz) } : null,
    { label: S.DUPLICATE, iconName: "copy", onSelect: () => actions.duplicate(quiz) },
    questionCount > 0 ? { label: S.BANK_SAVE_QUIZ, iconName: "book", onSelect: () => actions.saveToBank(quiz) } : null,
    !quiz.isDraft
      ? quiz.isArchived
        ? { label: S.UNARCHIVE, iconName: "unarchive", onSelect: () => actions.archive(quiz, false) }
        : { label: S.ARCHIVE, iconName: "archive", onSelect: () => actions.archive(quiz, true) }
      : null,
    "sep",
    { label: S.DELETE, iconName: "trash", danger: true, onSelect: () => actions.remove(quiz) },
  ];
}
