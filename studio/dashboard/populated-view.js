// The dashboard once the owner has at least one quiz — design-reference/dashboard.html:
// date + greeting, a top row with the one "Next step" spotlight and three overview tiles
// (always rendered, with helpful zero states), the filterable card grid, the "New quiz" strip
// and the footer.
//
// renderPopulated(container, ctx) → cleanup()

import { track } from "../core/analytics.js";
import { S, t } from "../core/strings.js";
import { route } from "../core/paths.js";
import { el, withLoading } from "../ui/components.js";
import { prefersReducedMotion } from "../ui/motion.js";
import { copyWithTip, countUp, firstNameOf, footer, plural, svg, timeOrDate } from "./dash-util.js";
import { quizCard } from "./quiz-card.js";

const FILTERS = [
  ["all", () => S.FILTER_ALL],
  ["live", () => S.FILTER_LIVE],
  ["sched", () => S.FILTER_SCHEDULED],
  ["ended", () => S.FILTER_ENDED],
  ["draft", () => S.FILTER_DRAFTS],
  ["archived", () => S.FILTER_ARCHIVED],
];

/** "All" is everything except archived, which only shows under its own chip. */
const inFilter = (bucket, filter) => (filter === "all" ? bucket !== "archived" : bucket === filter);

/** Newest first, whatever the status — the app's Home default (SortMode.NEWEST). The chips filter by status. */
function compareItems(a, b) {
  return (b.quiz.createdAt ?? 0) - (a.quiz.createdAt ?? 0);
}

// Icons, drawn exactly as in the reference.
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const GRID = '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>';
const PEOPLE = '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.5c1.7.8 2.7 2.6 3 5.5"/>';
const BARS = '<path d="M4 19V9m6 10V5m6 14v-7m4 7H2"/>';

/**
 * ctx: { userName, items, step: pickNextStep(), markProgress: { total, pending } | null,
 *        students: { count, quizzes }, graded: { graded, avgPct }, limits,
 *        filter, onFilter(filter), actions: { publish, closePoll, share, duplicate, archive, remove } }
 */
export function renderPopulated(container, ctx) {
  const first = firstNameOf(ctx.userName);
  const greeting = greetingText();
  const date = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }).toUpperCase();

  const header = el("header", { class: "dv-head dv-rise", vars: { i: "0" } }, [
    el("div", { class: "dv-date", text: date }),
    el("h1", {}, first ? [t(S.GREETING_LEAD, { greeting }), el("span", { dir: "auto", text: first })] : [greeting]),
  ]);

  const quizzes = quizzesSection(ctx);
  const top = el("div", { class: "dv-topgrid" }, [spotlight(ctx, quizzes), quizzesTile(ctx.items), studentsTile(ctx.students), averageTile(ctx.graded)]);

  container.replaceChildren(el("div", { class: "dv dv-pop" }, [header, top, quizzes, footer()]));
  countUp(container, { delay: 400, duration: 700 });
  return () => {};
}

function greetingText() {
  const hour = new Date().getHours();
  return hour < 12 ? S.GOOD_MORNING : hour < 17 ? S.GOOD_AFTERNOON : S.GOOD_EVENING;
}

// ── Next step ───────────────────────────────────────────────────────────────

/** The reference's spotlight markup; only the text and the actions change per rule. */
function spotlight(ctx, quizzesNode) {
  const { step, actions } = ctx;
  const quiz = step.item?.quiz;
  const name = quiz?.title?.trim() || S.UNTITLED_QUIZ;
  const link = (cls, label, href) => el("a", { class: cls, href, text: label });
  const act = (cls, label, run) => {
    const btn = el("button", { type: "button", class: cls, text: label });
    btn.addEventListener("click", () => withLoading(btn, run));
    return btn;
  };
  const enc = (id) => encodeURIComponent(id);

  let title;
  let body;
  let buttons;
  switch (step.kind) {
    case "mark": {
      const total = ctx.markProgress?.total ?? step.item.pending;
      const done = Math.max(0, total - (ctx.markProgress?.pending ?? step.item.pending));
      title = plural(step.totalPending, S.NS_MARK_TITLE_ONE, S.NS_MARK_TITLE_MANY);
      body = t(S.NS_MARK_BODY, { quiz: name, done, total });
      buttons = [link("dv-b1", S.NS_MARK_GO, route(`grading/?quiz=${enc(quiz.id)}`)), link("dv-b2", S.NS_MARK_ALL, route("grading/"))];
      break;
    }
    case "poll":
      title = t(S.NS_POLL_TITLE, { quiz: name });
      body = plural(step.item.votes, S.NS_POLL_BODY_ONE, S.NS_POLL_BODY_MANY);
      buttons = [link("dv-b1", S.NS_POLL_GO, route(`results/?id=${enc(quiz.id)}`))];
      break;
    case "soon": {
      title = t(S.NS_SOON_TITLE, { quiz: name, time: timeOrDate(quiz.startAt) });
      body = S.NS_SOON_BODY;
      const copy = el("button", { type: "button", class: "dv-b1", text: t(S.NS_SOON_COPY, { code: quiz.shareCode }) });
      copy.addEventListener("click", () => {
        track("quiz_shared", { quiz_id: quiz.id, method: "code_copied", from: "dashboard_next_step" });
        copyWithTip(copy, quiz.shareCode);
      });
      buttons = [copy, act("dv-b2", S.ACT_SHARE, () => actions.share(quiz))];
      break;
    }
    case "ready":
      title = t(S.NS_READY_TITLE, { quiz: name });
      body = plural(step.item.questionCount, S.NS_READY_BODY_ONE, S.NS_READY_BODY_MANY);
      // Studio has no preview screen; the builder is where the quiz can be looked over.
      buttons = [act("dv-b1", S.NS_READY_GO, () => actions.publish(quiz)), link("dv-b2", S.NS_READY_PREVIEW, route(`create/?id=${enc(quiz.id)}`))];
      break;
    case "finish": {
      const missing = { title: S.NS_MISSING_TITLE, questions: S.NS_MISSING_QUESTIONS, answers: S.NS_MISSING_ANSWERS }[step.item.missing] ?? S.NS_MISSING_ANSWERS;
      title = t(S.NS_FINISH_TITLE, { quiz: name });
      body = t(S.NS_FINISH_BODY, { missing });
      buttons = [link("dv-b1", S.CONTINUE_EDITING, route(`create/?id=${enc(quiz.id)}`))];
      break;
    }
    case "live": {
      const submitted = step.items.reduce((sum, i) => sum + i.submitted, 0);
      title = plural(step.items.length, S.NS_LIVE_TITLE_ONE, S.NS_LIVE_TITLE_MANY);
      body = plural(submitted, S.NS_LIVE_BODY_ONE, S.NS_LIVE_BODY_MANY);
      buttons = [act("dv-b1", S.NS_LIVE_GO, () => actions.share(quiz))];
      break;
    }
    default: {
      title = S.NS_DONE_TITLE;
      body = S.NS_DONE_BODY;
      // Every card's ⋮ menu has Duplicate, so this takes the owner to them.
      const dup = el("button", { type: "button", class: "dv-b2", text: S.NS_DONE_DUPLICATE });
      dup.addEventListener("click", () => quizzesNode.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" }));
      buttons = [link("dv-b1", S.NEW_QUIZ, route("create/")), dup];
    }
  }

  return el("div", { class: "dv-spot dv-rise", vars: { i: "1" }, "data-step": step.kind }, [
    el("div", { class: "dv-k", text: S.NEXT_STEP }),
    el("h2", { dir: "auto", text: title }),
    el("p", { dir: "auto", text: body }),
    el("div", { class: "dv-srow" }, buttons),
  ]);
}

// ── Overview tiles ──────────────────────────────────────────────────────────

function tile(cls, i, iconPaths, label, children) {
  return el("div", { class: `dv-tile ${cls} dv-rise`, vars: { i: String(i) } }, [
    el("div", { class: "dv-k" }, [el("span", { class: "dv-ic" }, [svg(iconPaths, { size: 15 })]), label]),
    ...children,
  ]);
}

/** Owned quizzes, split Drafts / Live / Scheduled / Ended. Archived quizzes count in the
 *  number but not in the bar. */
function quizzesTile(items) {
  const n = (bucket) => items.filter((i) => i.bucket === bucket).length;
  const parts = [
    ["draft", n("draft"), "var(--draft)", plural(n("draft"), S.LEG_DRAFTS_ONE, S.LEG_DRAFTS_MANY), true],
    ["live", n("live"), "var(--live)", t(S.LEG_LIVE, { n: n("live") }), true],
    ["sched", n("sched"), "var(--sched)", t(S.LEG_SCHEDULED, { n: n("sched") }), true],
    ["ended", n("ended"), "color-mix(in srgb, var(--fg) 40%, transparent)", t(S.LEG_ENDED, { n: n("ended") }), n("ended") > 0],
  ];
  const total = parts.reduce((sum, p) => sum + p[1], 0);
  return tile("dv-t1", 2, GRID, S.TILE_QUIZZES, [
    el("div", { class: "dv-v" }, [el("span", { "data-count": String(items.length), text: "0" }), " ", el("small", { text: S.TILE_MADE })]),
    el(
      "div",
      { class: "dv-seg", "aria-hidden": "true" },
      parts.filter((p) => p[1] > 0).map(([key, count, colour]) => el("i", { "data-seg": key, style: `width:${(count / total) * 100}%;background:${colour}` }))
    ),
    el("div", { class: "dv-legend" }, parts.filter((p) => p[4]).map(([, , colour, label]) => el("span", { vars: { c: colour }, text: label }))),
  ]);
}

function studentsTile(students) {
  if (!students.count) {
    return tile("dv-t2", 3, PEOPLE, S.TILE_STUDENTS, [
      el("div", { class: "dv-v dv-none", text: S.STUDENTS_EMPTY }),
      el("div", { class: "dv-h", text: S.STUDENTS_EMPTY_HINT }),
    ]);
  }
  return tile("dv-t2", 3, PEOPLE, S.TILE_STUDENTS, [
    el("div", { class: "dv-v" }, [el("span", { "data-count": String(students.count), text: "0" })]),
    el("div", { class: "dv-h", text: plural(students.quizzes, S.STUDENTS_ACROSS_ONE, S.STUDENTS_ACROSS_MANY) }),
  ]);
}

function averageTile(graded) {
  if (graded.avgPct == null) {
    return tile("dv-t3", 4, BARS, S.TILE_AVERAGE, [
      el("div", { class: "dv-v dv-none", text: S.AVERAGE_EMPTY }),
      el("div", { class: "dv-h", text: S.AVERAGE_EMPTY_HINT }),
    ]);
  }
  return tile("dv-t3", 4, BARS, S.TILE_AVERAGE, [
    el("div", { class: "dv-v" }, [el("span", { "data-count": String(graded.avgPct), text: "0" }), S.PERCENT]),
    el("div", { class: "dv-h", text: plural(graded.graded, S.AVERAGE_FROM_ONE, S.AVERAGE_FROM_MANY) }),
  ]);
}

// ── Your quizzes ────────────────────────────────────────────────────────────

function quizzesSection(ctx) {
  const items = [...ctx.items].sort(compareItems);
  const count = (key) => items.filter((i) => inFilter(i.bucket, key)).length;
  const hasArchived = items.some((i) => i.bucket === "archived");
  let filter = ctx.filter === "archived" && !hasArchived ? "all" : ctx.filter;

  const cards = items.map((item, index) => {
    const card = quizCard(item, index, ctx.actions);
    card.hidden = !inFilter(item.bucket, filter);
    return card;
  });

  const chips = FILTERS.filter(([key]) => key !== "archived" || hasArchived).map(([key, label]) => {
    const n = count(key);
    return el("button", { type: "button", class: `dv-chip ${key === filter ? "on" : ""} ${n === 0 ? "zero" : ""}`, "data-f": key, "aria-pressed": String(key === filter) }, [
      label(),
      el("em", { text: String(n) }),
    ]);
  });
  const chipBar = el("div", { class: "dv-filters", role: "group", "aria-label": S.QUIZZES_TITLE }, chips);

  // Cards leaving fade and shrink out (.out) and hide after 250ms; cards coming in lose their
  // entrance animation and fade back.
  const reduce = prefersReducedMotion();
  chipBar.addEventListener("click", (e) => {
    const chip = e.target.closest(".dv-chip");
    if (!chip) return;
    filter = chip.dataset.f;
    ctx.onFilter(filter);
    chips.forEach((c) => {
      c.classList.toggle("on", c === chip);
      c.setAttribute("aria-pressed", String(c === chip));
    });
    cards.forEach((card) => {
      if (inFilter(card.dataset.s, filter)) {
        card.hidden = false;
        card.classList.remove("dv-rise");
        requestAnimationFrame(() => card.classList.remove("out"));
      } else {
        card.classList.add("out");
        setTimeout(() => {
          if (card.classList.contains("out")) card.hidden = true;
        }, reduce ? 0 : 250);
      }
    });
  });

  return el("section", { class: "dv-sec", id: "your-quizzes" }, [
    el("div", { class: "dv-sh dv-rise", vars: { i: "5" } }, [el("h2", { text: S.QUIZZES_TITLE }), chipBar]),
    el("div", { class: "dv-grid", "aria-live": "polite" }, cards),
    addStrip(items.length, ctx.limits.maxQuizzes, Math.min(items.length, 8) + 6),
  ]);
}

/** The dashed "New quiz" strip, or — at the quota — the same strip saying why it can't. */
function addStrip(used, limit, i) {
  const plus = el("span", { class: "dv-plus" }, [svg(PLUS, { size: 18, stroke: "2.5" })]);
  if (used >= limit) {
    return el("div", { class: "dv-add full dv-rise", vars: { i: String(i) }, role: "note" }, [
      plus,
      el("span", { class: "dv-tx" }, [el("small", { text: t(S.QUIZ_LIMIT_FULL, { n: limit }) })]),
    ]);
  }
  return el("a", { class: "dv-add dv-rise", vars: { i: String(i) }, href: route("create/") }, [
    plus,
    el("span", { class: "dv-tx" }, [el("b", { text: S.NEW_QUIZ }), el("small", { text: S.ADD_QUIZ_SUB })]),
  ]);
}
