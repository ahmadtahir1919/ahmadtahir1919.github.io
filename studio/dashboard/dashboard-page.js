// Dashboard — the signed-in user's quizzes: stats, filters, search, sort, and the quiz grid.
//
// Data: one query for quizzes, then (in parallel) one each for question counts, participant
// counts and pending-marking counts across all quiz ids — never one request per quiz.

import { fetchLimits, requireUser } from "../core/supabase.js";
import {
  deleteQuiz,
  duplicateQuiz,
  listMyQuizzes,
  loadQuestions,
  publishQuiz,
  questionCounts,
  setArchived,
} from "../core/quizzes.js";
import { participantCounts, pendingMarking } from "../core/results.js";
import { QUIZ_STATUS, quizCardStatus, statusFilterOf } from "../core/status.js";
import { S, t } from "../core/strings.js";
import { validateQuiz } from "../core/validate.js";
import { displayNameOf } from "../core/supabase.js";
import {
  button,
  confirmDialog,
  el,
  emptyState,
  errorBlock,
  renderSignInGate,
  renderSpinner,
  segmented,
  skeletonCards,
  swap,
  toast,
} from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { confetti, stagger } from "../ui/motion.js";
import { mountShell } from "../ui/shell.js";
import { quizCard } from "./quiz-card.js";
import { route } from "../core/paths.js";

const root = document.getElementById("root");

const SORTS = {
  NEWEST: (a, b) => (b.quiz.createdAt ?? 0) - (a.quiz.createdAt ?? 0),
  OLDEST: (a, b) => (a.quiz.createdAt ?? 0) - (b.quiz.createdAt ?? 0),
  DRAFTS_FIRST: (a, b) => Number(b.quiz.isDraft) - Number(a.quiz.isDraft) || (b.quiz.createdAt ?? 0) - (a.quiz.createdAt ?? 0),
  MOST_QUESTIONS: (a, b) => b.questionCount - a.questionCount,
  LEAST_QUESTIONS: (a, b) => a.questionCount - b.questionCount,
};

const state = {
  user: null,
  limits: null,
  items: [], // { quiz, status, questionCount, participants, pending }
  filter: "ALL",
  search: "",
  sort: "NEWEST",
  loaded: false,
  error: false,
};

let shell = null;
let statsRegion;
let toolbarRegion;
let gridRegion;

async function start() {
  renderSpinner(root);
  state.user = await requireUser();
  if (!state.user) {
    renderSignInGate(root);
    return;
  }
  shell = mountShell(root, {
    user: state.user,
    active: "dashboard",
    title: S.MY_QUIZZES,
    fetchPending: false,
    actions: [button({ label: S.NEW_QUIZ, icon: "plus", variant: "primary", href: route("create/"), cls: "hide-phone" })],
  });

  statsRegion = el("section", { class: "stat-strip", "aria-label": S.OVERVIEW });
  toolbarRegion = el("div", { class: "dash-toolbar" });
  gridRegion = el("section", { class: "quiz-grid", "aria-live": "polite" });

  shell.content.replaceChildren(
    el("div", { class: "dash-hello" }, [
      el("div", {}, [
        el("h2", { dir: "auto", text: greeting(displayNameOf(state.user)) }),
        el("p", { class: "muted", text: S.DASH_SUBTITLE }),
      ]),
    ]),
    statsRegion,
    toolbarRegion,
    gridRegion
  );
  gridRegion.replaceChildren(...skeletonCards(6));
  await load();
}

function greeting(name) {
  const hour = new Date().getHours();
  const first = String(name ?? "").trim().split(/\s+/)[0] || "";
  const base = hour < 12 ? S.GOOD_MORNING : hour < 17 ? S.GOOD_AFTERNOON : S.GOOD_EVENING;
  return first ? `${base}, ${first}` : base;
}

async function load() {
  state.error = false;
  try {
    const [quizzes, limits] = await Promise.all([listMyQuizzes(state.user.id), fetchLimits()]);
    state.limits = limits;
    const ids = quizzes.map((q) => q.id);
    const publishedIds = quizzes.filter((q) => !q.isDraft).map((q) => q.id);
    const [counts, participants, pending] = await Promise.all([
      questionCounts(ids),
      participantCounts(publishedIds),
      pendingMarking(publishedIds),
    ]);
    const now = Date.now();
    state.items = quizzes.map((quiz) => {
      const people = participants.get(quiz.id) ?? 0;
      return {
        quiz,
        status: quizCardStatus(quiz, people > 0, now),
        questionCount: counts.get(quiz.id) ?? 0,
        participants: people,
        pending: pending.get(quiz.id)?.answers ?? 0,
      };
    });
    state.loaded = true;
  } catch (error) {
    console.error(error);
    state.error = true;
  }
  render();
}

function render() {
  if (state.error) {
    statsRegion.replaceChildren();
    toolbarRegion.replaceChildren();
    gridRegion.replaceChildren(errorBlock(S.ERR_LOAD_FAILED, load));
    return;
  }
  renderStats();
  renderToolbar();
  renderGrid();
}

function stat({ label, value, sub, iconName, tone = "", href }) {
  const body = [
    el("span", { class: `stat-icon ${tone ? `stat-icon-${tone}` : ""}` }, [icon(iconName)]),
    el("div", { class: "stat-text" }, [
      el("span", { class: "stat-label", text: label }),
      el("span", { class: "stat-value" }, [String(value), sub ? el("span", { class: "stat-sub", text: sub }) : null]),
    ]),
  ];
  return href ? el("a", { class: "card stat stat-link", href }, body) : el("div", { class: "card stat" }, body);
}

function renderStats() {
  const owned = state.items.length;
  const live = state.items.filter((i) => statusFilterOf(i.status) === "LIVE").length;
  const people = state.items.reduce((sum, i) => sum + i.participants, 0);
  const toMark = state.items.reduce((sum, i) => sum + i.pending, 0);
  shell.setPendingCount(toMark);
  statsRegion.replaceChildren(
    stat({ label: S.STAT_QUIZZES, value: owned, sub: state.limits ? `/ ${state.limits.maxQuizzes}` : "", iconName: "grid" }),
    stat({ label: S.STAT_LIVE, value: live, iconName: "bolt", tone: "live" }),
    stat({ label: S.STAT_PARTICIPANTS, value: people, iconName: "users", tone: "info" }),
    stat({ label: S.STAT_TO_MARK, value: toMark, iconName: "marking", tone: toMark ? "warn" : "", href: route("grading/") })
  );
}

const FILTERS = [
  ["ALL", () => S.FILTER_ALL],
  ["LIVE", () => S.FILTER_LIVE],
  [QUIZ_STATUS.DRAFT, () => S.FILTER_DRAFTS],
  [QUIZ_STATUS.SCHEDULED, () => S.FILTER_SCHEDULED],
  [QUIZ_STATUS.ENDED, () => S.FILTER_ENDED],
  [QUIZ_STATUS.ARCHIVED, () => S.FILTER_ARCHIVED],
];

/** "All" shows everything except archived quizzes, which have their own tab — like the app. */
function matchesFilter(item, filter) {
  if (filter === "ALL") return item.status !== QUIZ_STATUS.ARCHIVED;
  return statusFilterOf(item.status) === filter;
}

function renderToolbar() {
  const options = FILTERS.map(([value, label]) => ({
    value,
    label: label(),
    count: state.items.filter((i) => matchesFilter(i, value)).length,
  })).filter((o) => o.value === "ALL" || o.count > 0 || o.value === state.filter);

  const search = el("input", {
    class: "input",
    type: "search",
    placeholder: S.SEARCH_QUIZZES,
    "aria-label": S.SEARCH_QUIZZES,
    value: state.search,
    "data-fk": "dash-search",
  });
  search.addEventListener("input", () => {
    state.search = search.value;
    renderGrid();
  });

  const sort = el(
    "select",
    { class: "select dash-sort", "aria-label": S.SORT_BY, "data-fk": "dash-sort" },
    [
      ["NEWEST", S.SORT_NEWEST],
      ["OLDEST", S.SORT_OLDEST],
      ["DRAFTS_FIRST", S.SORT_DRAFTS_FIRST],
      ["MOST_QUESTIONS", S.SORT_MOST_QUESTIONS],
      ["LEAST_QUESTIONS", S.SORT_LEAST_QUESTIONS],
    ].map(([value, label]) => el("option", { value, text: label, selected: value === state.sort }))
  );
  sort.addEventListener("change", () => {
    state.sort = sort.value;
    renderGrid();
  });

  swap(
    toolbarRegion,
    segmented({
      options,
      value: state.filter,
      label: "quiz-filter",
      onChange: (value) => {
        state.filter = value;
        renderToolbar();
        renderGrid();
      },
    }),
    el("div", { class: "row dash-tools" }, [el("div", { class: "search grow" }, [icon("search"), search]), sort])
  );
}

function renderGrid() {
  if (!state.items.length) {
    gridRegion.replaceChildren(
      el("div", { class: "card grid-span" }, [
        emptyState({
          art: "quizzes",
          title: S.EMPTY_TITLE,
          body: S.EMPTY_BODY,
          actions: [button({ label: S.CREATE_FIRST_QUIZ, icon: "plus", variant: "primary", href: route("create/") })],
        }),
      ])
    );
    return;
  }

  const query = state.search.trim().toLowerCase();
  const visible = state.items
    .filter((item) => matchesFilter(item, state.filter))
    .filter((item) => !query || `${item.quiz.title} ${item.quiz.groupName} ${item.quiz.shareCode}`.toLowerCase().includes(query))
    .sort(SORTS[state.sort]);

  if (!visible.length) {
    gridRegion.replaceChildren(
      el("div", { class: "card grid-span" }, [
        emptyState({ art: "quizzes", title: S.NO_MATCHES_TITLE, body: S.NO_MATCHES_BODY }),
      ])
    );
    return;
  }

  gridRegion.replaceChildren(
    ...visible.map((item) =>
      quizCard(item, { onPublish: publish, onDuplicate: duplicate, onArchive: archive, onDelete: remove })
    )
  );
  stagger(gridRegion);
}

// ── Actions ─────────────────────────────────────────────────────────────────

/** Draft → published only. A quiz with no questions, or one the builder would refuse, opens
 *  in the builder instead (HomeViewModel.onToggleDraftClicked sends it to Quiz details). */
async function publish(quiz) {
  try {
    const questions = await loadQuestions(quiz.id);
    if (!questions.length) {
      toast(S.PUBLISH_NEEDS_QUESTIONS, { tone: "error" });
      return;
    }
    if (!validateQuiz(quiz, questions, state.limits).ok) {
      toast(S.PUBLISH_NEEDS_FIXES, { tone: "info" });
      window.location.href = route(`create/?id=${encodeURIComponent(quiz.id)}&check=1`);
      return;
    }
    const ok = await confirmDialog({
      title: S.CONFIRM_PUBLISH_TITLE,
      body: S.CONFIRM_PUBLISH_BODY,
      confirmLabel: S.PUBLISH,
      danger: false,
    });
    if (!ok) return;
    await publishQuiz(quiz.id);
    toast(S.QUIZ_PUBLISHED, { tone: "success" });
    confetti();
    await load();
  } catch (error) {
    console.error(error);
    toast(S.ERR_SAVE_FAILED, { tone: "error" });
  }
}

async function duplicate(quiz) {
  if (state.items.length >= state.limits.maxQuizzes) {
    toast(t(S.LIMIT_REACHED_QUIZZES, { n: state.limits.maxQuizzes }), { tone: "error" });
    return;
  }
  try {
    await duplicateQuiz(quiz.id, state.user.id, { suffix: S.COPY_SUFFIX, maxTitleChars: state.limits.maxQuizTitleChars });
    toast(S.QUIZ_DUPLICATED, { tone: "success" });
    await load();
  } catch (error) {
    console.error(error);
    toast(S.ERR_SAVE_FAILED, { tone: "error" });
  }
}

async function archive(quiz, archived) {
  try {
    await setArchived(quiz.id, archived);
    toast(archived ? S.QUIZ_ARCHIVED : S.QUIZ_UNARCHIVED, {
      tone: "success",
      action: { label: S.UNDO, onClick: () => archive(quiz, !archived) },
    });
    await load();
  } catch (error) {
    console.error(error);
    toast(S.ERR_SAVE_FAILED, { tone: "error" });
  }
}

async function remove(quiz) {
  const ok = await confirmDialog({
    title: S.CONFIRM_DELETE_TITLE,
    body: t(S.CONFIRM_DELETE_BODY_NAMED, { title: quiz.title?.trim() || S.UNTITLED_QUIZ }),
  });
  if (!ok) return;
  try {
    await deleteQuiz(quiz.id);
    toast(S.QUIZ_DELETED, { tone: "success" });
    await load();
  } catch (error) {
    console.error(error);
    toast(S.ERR_SAVE_FAILED, { tone: "error" });
  }
}

start();
