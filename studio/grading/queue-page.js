// Marking (/grading/): a port of the app's Grading screen (GradingQueueViewModel.kt +
// GradingQueueScreen.kt). Every published quiz you own that has at least one real submission
// is listed — poll-only quizzes are left out — in two sections: PENDING GRADING (answers still
// waiting for a mark) and COMPLETED & GRADED QUIZZES. Filter pills All / Pending / Auto-graded /
// Hand-graded and the app's three sorts.
//
// /grading/?quiz=<id> opens one quiz's submissions (the app's participants hub): everyone who
// submitted, pending first, each opening "mark one person" — so marks can be adjusted on graded
// quizzes too, not only on ones with work waiting.

import { QUESTION_TYPES, themeColor } from "../core/models.js";
import { listMyQuizzes, questionsFor } from "../core/quizzes.js";
import { displayNames, groupByAttempt, loadAnswersFor, loadAttemptsFor, participantCounts, pendingMarking } from "../core/results.js";
import { pendingMarkingCount } from "../core/scoring.js";
import { S, t } from "../core/strings.js";
import {
  avatar,
  button,
  el,
  emptyState,
  errorBlock,
  formatDate,
  loadingBlock,
  pill,
  progressBar,
  segmented,
  timeAgo,
} from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { confetti, stagger } from "../ui/motion.js";
import { route } from "../core/paths.js";
import { TYPED } from "./data.js";

const SEEN_WORK_KEY = "quizoma.studio.queueHadWork";
const MAX_QUESTION_CHIPS = 6;
const view = { filter: "ALL", sort: "PENDING_FIRST" };

export async function renderQueue(shell, user) {
  const quizId = new URLSearchParams(window.location.search).get("quiz");
  shell.content.replaceChildren(loadingBlock());
  try {
    if (quizId) await renderQuizHub(shell, user, quizId);
    else await renderQuizList(shell, user);
  } catch (error) {
    console.error(error);
    shell.content.replaceChildren(errorBlock(S.ERR_LOAD_FAILED, () => renderQueue(shell, user)));
  }
}

// ── All quizzes (app parity) ────────────────────────────────────────────────

/** The kinds of question a quiz has, in the app's MCQ / Written / Poll order. */
function kindsOf(questions) {
  const kinds = new Set();
  for (const q of questions) {
    if (q.type === QUESTION_TYPES.POLL) kinds.add(2);
    else if (TYPED.has(q.type)) kinds.add(1);
    else kinds.add(0);
  }
  return [...kinds].sort().map((k) => [S.KIND_MCQ, S.KIND_WRITTEN, S.KIND_POLL][k]);
}

/** buildGradingQueueRows: quizzes nobody submitted to and poll-only quizzes are left out;
 *  waiting answers first (most first, then title), the rest by title. */
function buildRows(quizzes, questionsByQuiz, pending, submissions) {
  const rows = [];
  for (const quiz of quizzes) {
    const questions = questionsByQuiz.get(quiz.id) ?? [];
    if (questions.length && questions.every((q) => q.type === QUESTION_TYPES.POLL)) continue;
    const total = submissions.get(quiz.id) ?? 0;
    if (!total) continue;
    const waiting = pending.get(quiz.id);
    const answers = waiting?.answers ?? 0;
    const questionNumbers = waiting ? questions.map((q, i) => (waiting.questionIds.has(q.id) ? i + 1 : null)).filter(Boolean) : [];
    rows.push({
      quiz,
      submissions: total,
      answers,
      questionNumbers,
      isManual: quiz.manualMarkingDefault,
      questionCount: questions.length,
      kinds: kindsOf(questions),
      hasTyped: questions.some((q) => TYPED.has(q.type)),
      category: answers > 0 ? "PENDING" : quiz.manualMarkingDefault ? "HAND" : "AUTO",
    });
  }
  const title = (r) => (r.quiz.title ?? "").toLowerCase();
  return rows.sort((a, b) => b.answers - a.answers || title(a).localeCompare(title(b)));
}

function sortRows(rows, sort) {
  if (sort === "NEWEST") return [...rows].sort((a, b) => (b.quiz.createdAt ?? 0) - (a.quiz.createdAt ?? 0));
  if (sort === "NAME") return [...rows].sort((a, b) => (a.quiz.title ?? "").toLowerCase().localeCompare((b.quiz.title ?? "").toLowerCase()));
  return rows;
}

async function renderQuizList(shell, user) {
  shell.setTitle(S.GRADING_TITLE);
  shell.setCrumbs([{ label: S.NAV_GRADING }]);
  shell.setActions([]);

  // Drafts have no submissions; listMyQuizzes is already owner-only.
  const quizzes = (await listMyQuizzes(user.id)).filter((q) => !q.isDraft);
  const ids = quizzes.map((q) => q.id);
  const [questionsByQuiz, submissions, pending] = await Promise.all([questionsFor(ids), participantCounts(ids), pendingMarking(ids)]);
  const rows = buildRows(quizzes, questionsByQuiz, pending, submissions);
  const anyPending = rows.some((r) => r.answers > 0);
  shell.setPendingCount(rows.reduce((s, r) => s + r.answers, 0));

  if (anyPending) sessionStorage.setItem(SEEN_WORK_KEY, "1");
  else if (sessionStorage.getItem(SEEN_WORK_KEY) === "1") {
    sessionStorage.removeItem(SEEN_WORK_KEY);
    confetti();
  }

  const draw = () => {
    if (!rows.length) {
      shell.content.replaceChildren(
        el("div", { class: "card" }, [
          emptyState({ art: "people", title: S.GQ_EMPTY_TITLE, body: S.GQ_EMPTY_BODY, actions: [button({ label: S.BACK_TO_QUIZZES, icon: "grid", href: route("") })] }),
        ])
      );
      return;
    }
    const matches = (r) => view.filter === "ALL" || r.category === view.filter;
    const sorted = sortRows(rows, view.sort);
    const toMark = sorted.filter((r) => r.answers > 0 && matches(r));
    const graded = sorted.filter((r) => r.answers === 0 && matches(r));
    const count = (f) => rows.filter((r) => f === "ALL" || r.category === f).length;

    const sort = el(
      "select",
      { class: "select dash-sort", "aria-label": S.SORT_BY },
      [
        ["PENDING_FIRST", S.GQ_SORT_PENDING],
        ["NEWEST", S.SORT_NEWEST],
        ["NAME", S.SORT_NAME],
      ].map(([value, label]) => el("option", { value, text: label, selected: view.sort === value }))
    );
    sort.addEventListener("change", () => {
      view.sort = sort.value;
      draw();
    });

    const showCaughtUp = !anyPending && (view.filter === "ALL" || view.filter === "PENDING");
    const sections = [];
    if (showCaughtUp) {
      sections.push(el("div", { class: "banner banner-success gq-caught-up" }, [icon("check-circle"), el("span", { text: S.GQ_CAUGHT_UP })]));
    }
    if (toMark.length) sections.push(section(S.GQ_SECTION_PENDING, toMark));
    if (graded.length) {
      const title = view.filter === "AUTO" ? S.GQ_SECTION_AUTO : view.filter === "HAND" ? S.GQ_SECTION_HAND : S.GQ_SECTION_COMPLETED;
      sections.push(section(title, graded));
    }
    if (!toMark.length && !graded.length && !showCaughtUp) {
      sections.push(
        el("div", { class: "card card-pad stack-sm gq-filter-empty" }, [
          el("p", { class: "muted", text: S.GQ_FILTER_EMPTY }),
          el("div", {}, [button({ label: S.GQ_SHOW_ALL, variant: "ghost", onClick: () => ((view.filter = "ALL"), draw()) })]),
        ])
      );
    }

    shell.content.replaceChildren(
      el("div", { class: "dash-toolbar" }, [
        segmented({
          label: "gq-filter",
          value: view.filter,
          onChange: (value) => {
            view.filter = value;
            draw();
          },
          options: [
            { value: "ALL", label: S.FILTER_ALL, count: count("ALL") },
            { value: "PENDING", label: S.GQ_FILTER_PENDING, count: count("PENDING") },
            { value: "AUTO", label: S.GQ_FILTER_AUTO, count: count("AUTO") },
            { value: "HAND", label: S.GQ_FILTER_HAND, count: count("HAND") },
          ],
        }),
        sort,
      ]),
      el("div", { class: "stack-lg" }, sections)
    );
  };
  draw();
}

function section(title, rows) {
  const grid = el("div", { class: "gq-grid" }, rows.map(quizRow));
  stagger(grid);
  return el("section", { class: "stack" }, [
    el("h3", { class: "section-label gq-section-title" }, [title, el("span", { class: "seg-count", text: String(rows.length) })]),
    grid,
  ]);
}

function metaLine(row) {
  const parts = [];
  if (row.questionCount) parts.push(row.questionCount === 1 ? S.QUESTION_COUNT_ONE : t(S.QUESTION_COUNT_MANY, { n: row.questionCount }));
  if (row.kinds.length === 1) parts.push(row.kinds[0]);
  else if (row.kinds.length === 2) parts.push(`${row.kinds[0]} & ${row.kinds[1]}`);
  else if (row.kinds.length === 3) parts.push(`${row.kinds[0]}, ${row.kinds[1]} & ${row.kinds[2]}`);
  if (row.quiz.createdAt) parts.push(formatDate(row.quiz.createdAt));
  return parts.join(" • ");
}

function quizRow(row) {
  const quiz = row.quiz;
  const hubHref = route(`grading/?quiz=${encodeURIComponent(quiz.id)}`);
  const resultsHref = route(`results/?id=${encodeURIComponent(quiz.id)}`);
  const pending = row.answers > 0;

  const tags = [
    pending
      ? pill(t(S.N_TO_MARK, { n: row.answers }), "warn", { iconName: "marking" })
      : row.isManual
        ? pill(S.GQ_HAND_GRADED, "scheduled", { iconName: "pencil" })
        : pill(S.GQ_AUTO_GRADED, "success", { iconName: "bolt" }),
    pill(row.submissions === 1 ? S.GQ_SUBMISSION_ONE : t(S.GQ_SUBMISSIONS, { n: row.submissions }), "info", { iconName: "users" }),
    ...row.questionNumbers.slice(0, MAX_QUESTION_CHIPS).map((n) => el("span", { class: "q-chip", text: `Q${n}` })),
    row.questionNumbers.length > MAX_QUESTION_CHIPS ? el("span", { class: "q-chip", text: `+${row.questionNumbers.length - MAX_QUESTION_CHIPS}` }) : null,
  ];

  // Pending: View Result | Grade Now. Graded: Adjust Marks | View Result. (GradingQueueScreen.kt)
  const actions = pending
    ? [
        button({ label: S.GQ_VIEW_RESULT, icon: "chart", variant: "secondary", size: "sm", href: resultsHref }),
        button({ label: S.GQ_GRADE_NOW, icon: "marking", variant: "primary", size: "sm", href: hubHref }),
      ]
    : [
        button({ label: S.GQ_ADJUST_MARKS, icon: "pencil", variant: "secondary", size: "sm", href: hubHref }),
        button({ label: S.GQ_VIEW_RESULT, icon: "chart", variant: "primary", size: "sm", href: resultsHref }),
      ];

  return el("article", { class: "card gq-card", vars: { accent: themeColor(quiz.themeColorName) } }, [
    el("a", { class: "gq-head", href: hubHref }, [
      el("span", { class: "gq-icon" }, [icon(pending ? "marking" : "check-circle")]),
      el("div", { class: "grow" }, [
        el("div", { class: "gq-title clamp-2", dir: "auto", text: quiz.title?.trim() || S.UNTITLED_QUIZ }),
        el("div", { class: "small muted ellipsis", text: metaLine(row) }),
      ]),
      icon("chevron-right", "icon faint"),
    ]),
    el("div", { class: "row row-wrap gq-tags" }, tags),
    el("div", { class: "gq-actions" }, actions),
  ]);
}

// ── One quiz: its submissions (the app's participants hub) ──────────────────

async function renderQuizHub(shell, user, quizId) {
  const quizzes = await listMyQuizzes(user.id);
  const quiz = quizzes.find((q) => q.id === quizId);
  if (!quiz) {
    shell.content.replaceChildren(
      el("div", { class: "card" }, [emptyState({ art: "quizzes", title: S.ERR_NOT_FOUND, body: S.ERR_NOT_FOUND_BODY, actions: [button({ label: S.BACK_TO_QUEUE, href: route("grading/") })] })])
    );
    return;
  }
  const title = quiz.title?.trim() || S.UNTITLED_QUIZ;
  shell.setTitle(title);
  shell.setCrumbs([{ label: S.NAV_GRADING, href: route("grading/") }, { label: title }]);

  const [questionsByQuiz, attempts] = await Promise.all([questionsFor([quizId]), loadAttemptsFor([quizId])]);
  const questions = questionsByQuiz.get(quizId) ?? [];
  const [answers, names] = await Promise.all([loadAnswersFor(attempts.map((a) => a.id)), displayNames(attempts.map((a) => a.user_id))]);
  const byAttempt = groupByAttempt(answers);

  const rows = attempts
    .map((attempt) => {
      const list = byAttempt.get(attempt.id) ?? [];
      const manual = list.filter((a) => a.needs_manual_marking === true).length;
      const left = pendingMarkingCount(list);
      return { attempt, manual, left, adjusted: attempt.graded_at != null, name: names.get(attempt.user_id) || S.ANONYMOUS };
    })
    .sort((a, b) => Number(b.left > 0) - Number(a.left > 0) || b.attempt.finished_at - a.attempt.finished_at);
  const totalLeft = rows.reduce((s, r) => s + r.left, 0);
  const hasTyped = questions.some((q) => TYPED.has(q.type));

  shell.setActions([
    totalLeft || hasTyped
      ? button({ label: S.MARK_BY_QUESTION, icon: "layers", variant: "soft", cls: "hide-phone", href: route(`grading/?quiz=${encodeURIComponent(quizId)}&by=question`) })
      : null,
    button({ label: S.GQ_VIEW_RESULT, icon: "chart", variant: "secondary", href: route(`results/?id=${encodeURIComponent(quizId)}`) }),
  ]);

  if (!rows.length) {
    shell.content.replaceChildren(el("div", { class: "card" }, [emptyState({ art: "people", title: S.GQ_EMPTY_TITLE, body: S.NO_ATTEMPTS_BODY })]));
    return;
  }

  const list = el(
    "ul",
    { class: "queue-list" },
    rows.map((row) =>
      el("li", {}, [
        el("a", { class: "queue-row", href: route(`grading/?attempt=${encodeURIComponent(row.attempt.id)}`) }, [
          avatar(row.name),
          el("div", { class: "grow" }, [
            el("div", { class: "strong ellipsis", dir: "auto", text: row.name }),
            el("div", { class: "small muted", text: t(S.SUBMITTED_WHEN, { when: timeAgo(row.attempt.finished_at) }) }),
          ]),
          row.manual
            ? el("div", { class: "queue-progress hide-phone" }, [
                progressBar(row.manual - row.left, row.manual, { label: S.MARKING_PROGRESS }),
                el("span", { class: "small faint", text: t(S.MARKED_OF, { done: row.manual - row.left, total: row.manual }) }),
              ])
            : null,
          row.left
            ? pill(t(S.N_TO_MARK, { n: row.left }), "warn")
            : row.adjusted
              ? pill(S.MARKS_EDITED, "primary", { iconName: "pencil" })
              : pill(row.manual ? S.MARKED : S.GQ_AUTO_GRADED, "success", { iconName: "check" }),
          icon("chevron-right", "icon faint"),
        ]),
      ])
    )
  );
  stagger(list);

  shell.content.replaceChildren(
    el("div", { class: "queue-toolbar" }, [
      button({ label: S.GQ_ALL_QUIZZES, icon: "arrow-left", variant: "ghost", href: route("grading/") }),
      el("span", { class: "grow" }),
      totalLeft ? pill(t(S.N_ANSWERS_WAITING, { n: totalLeft }), "warn", { iconName: "marking" }) : pill(S.GQ_ALL_MARKED, "success", { iconName: "check" }),
    ]),
    el("section", { class: "card queue-group" }, [
      el("header", { class: "card-head" }, [
        el("div", { class: "grow" }, [
          el("h3", { class: "ellipsis", dir: "auto", text: title }),
          el("p", { class: "small muted", text: rows.length === 1 ? S.GQ_SUBMISSION_ONE : t(S.GQ_SUBMISSIONS, { n: rows.length }) }),
        ]),
      ]),
      list,
    ])
  );
}
