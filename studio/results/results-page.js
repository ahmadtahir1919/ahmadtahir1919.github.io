// Results (/results/?id=): summary, charts, poll tallies, the participants list, CSV export,
// and quiz actions (copy link, grade, end now). Owner only.

import { QUESTION_TYPES, joinLink, themeColor } from "../core/models.js";
import { endQuizNow, loadQuestions, loadQuiz } from "../core/quizzes.js";
import { displayNames, groupByAttempt, loadAnswersFor, loadAttemptsFor, loadJoinedUsers, loadPollVotes, removeParticipant } from "../core/results.js";
import { pendingMarkingCount, questionStats, scoreBreakdown } from "../core/scoring.js";
import { QUIZ_STATUS, quizCardStatus } from "../core/status.js";
import { S, t } from "../core/strings.js";
import { requireUser } from "../core/supabase.js";
import {
  button,
  codeChip,
  confirmDialog,
  copyText,
  el,
  emptyState,
  errorBlock,
  formatDuration,
  loadingBlock,
  menuButton,
  renderSignInGate,
  renderSpinner,
  swap,
  toast,
} from "../ui/components.js";
import { icon } from "../ui/icons.js";
import { stagger } from "../ui/motion.js";
import { mountShell } from "../ui/shell.js";
import { statusPill } from "../dashboard/quiz-card.js";
import { accuracyBars, pollBars, scoreDistribution } from "./charts.js";
import { buildCsv, downloadCsv, plainQuestionText, pollTally } from "./csv.js";
import { BUCKET, participantsSection } from "./participants-table.js";
import { route } from "../core/paths.js";

const root = document.getElementById("root");
const quizId = new URLSearchParams(window.location.search).get("id");

const state = { user: null, quiz: null, questions: [], rows: [], submitted: [], pollVotes: new Map(), filter: "ALL", search: "", sort: "NEWEST" };
let shell = null;
let peopleRegion = null;

async function start() {
  renderSpinner(root);
  state.user = await requireUser();
  if (!state.user) {
    renderSignInGate(root);
    return;
  }
  shell = mountShell(root, { user: state.user, active: "dashboard", title: S.RESULTS, crumbs: [{ label: S.MY_QUIZZES, href: route("") }, { label: S.RESULTS }], backHref: route(""), width: "wide" });
  await load();
}

async function load() {
  shell.content.replaceChildren(loadingBlock());
  try {
    const quiz = quizId ? await loadQuiz(quizId) : null;
    if (!quiz || quiz.ownerId !== state.user.id) {
      shell.content.replaceChildren(
        el("div", { class: "card" }, [emptyState({ art: "quizzes", title: S.ERR_NOT_FOUND, body: S.ERR_NOT_FOUND_BODY, actions: [button({ label: S.BACK_TO_QUIZZES, icon: "arrow-left", href: route("") })] })])
      );
      return;
    }
    state.quiz = quiz;
    const [questions, attempts, joined] = await Promise.all([loadQuestions(quiz.id), loadAttemptsFor([quiz.id]), loadJoinedUsers(quiz.id)]);
    state.questions = questions;
    const pollIds = questions.filter((q) => q.type === QUESTION_TYPES.POLL).map((q) => q.id);
    const [answers, names, pollVotes] = await Promise.all([
      loadAnswersFor(attempts.map((a) => a.id)),
      displayNames([...attempts.map((a) => a.user_id), ...joined.map((j) => j.user_id)]),
      loadPollVotes(pollIds).catch((error) => {
        console.error(error);
        return new Map();
      }),
    ]);
    state.pollVotes = pollVotes;
    const byAttempt = groupByAttempt(answers);

    state.submitted = attempts.map((attempt) => {
      const list = byAttempt.get(attempt.id) ?? [];
      const breakdown = scoreBreakdown(list);
      const pending = pendingMarkingCount(list);
      return {
        kind: "submitted",
        userId: attempt.user_id,
        name: names.get(attempt.user_id) || S.ANONYMOUS,
        attempt,
        answers: list,
        breakdown,
        pending,
        timeSec: list.reduce((s, a) => s + (a.time_taken_sec ?? 0), 0),
        bucket: pending > 0 ? BUCKET.TO_MARK : BUCKET.GRADED,
        sortDate: attempt.finished_at,
        percent: breakdown.marksPercent ?? breakdown.correctnessPercent,
        isOwner: attempt.user_id === quiz.ownerId,
      };
    });
    const submittedIds = new Set(attempts.map((a) => a.user_id));
    const joinedOnly = joined
      .filter((j) => !submittedIds.has(j.user_id))
      .map((j) => ({
        kind: "joined",
        userId: j.user_id,
        name: names.get(j.user_id) || S.ANONYMOUS,
        joinedAt: j.joined_at,
        bucket: BUCKET.NOT_STARTED,
        sortDate: j.joined_at,
        percent: null,
        isOwner: j.user_id === quiz.ownerId,
      }));
    state.rows = [...state.submitted, ...joinedOnly];
    render();
  } catch (error) {
    console.error(error);
    shell.content.replaceChildren(errorBlock(S.ERR_LOAD_FAILED, load));
  }
}

function render() {
  const quiz = state.quiz;
  const title = quiz.title?.trim() || S.UNTITLED_QUIZ;
  shell.setTitle(title);
  shell.setCrumbs([{ label: S.MY_QUIZZES, href: route("") }, { label: title }]);
  shell.content.style.setProperty("--accent", themeColor(quiz.themeColorName));

  const status = quizCardStatus(quiz, state.submitted.length > 0);
  const pendingTotal = state.submitted.reduce((s, r) => s + r.pending, 0);
  const scoredQuestions = state.questions.filter((q) => q.type !== QUESTION_TYPES.POLL);
  const pollOnly = state.questions.length > 0 && !scoredQuestions.length;

  shell.setActions([
    pendingTotal
      ? button({ label: t(S.MARK_N, { n: pendingTotal }), icon: "marking", variant: "primary", href: route(`grading/?quiz=${encodeURIComponent(quiz.id)}`) })
      : null,
    button({ label: S.EXPORT_CSV, icon: "download", variant: "secondary", cls: "hide-phone", disabled: pollOnly || !state.submitted.length, title: pollOnly ? S.CSV_POLL_ONLY : undefined, onClick: exportCsv }),
    menuButton(() => [
      !quiz.isDraft ? { label: S.COPY_LINK, iconName: "link", onSelect: () => copyText(joinLink(quiz.shareCode), S.LINK_COPIED) } : null,
      { label: S.EDIT_QUIZ, iconName: "pencil", onSelect: () => (window.location.href = route(`create/?id=${encodeURIComponent(quiz.id)}`)) },
      { label: S.EXPORT_CSV, iconName: "download", disabled: pollOnly || !state.submitted.length, onSelect: exportCsv },
      !quiz.isDraft && status !== QUIZ_STATUS.ENDED && status !== QUIZ_STATUS.ARCHIVED ? "sep" : null,
      !quiz.isDraft && status !== QUIZ_STATUS.ENDED && status !== QUIZ_STATUS.ARCHIVED
        ? { label: S.END_QUIZ_NOW, iconName: "stop", danger: true, onSelect: endNow }
        : null,
    ], { size: "md" }),
  ]);

  const header = el("section", { class: "card results-head" }, [
    el("div", { class: "results-accent" }),
    el("div", { class: "row row-wrap results-head-row" }, [
      statusPill(status, quiz),
      quiz.isDraft ? null : codeChip(quiz.shareCode),
      quiz.groupName ? el("span", { class: "chip chip-static", dir: "auto" }, [icon("users", "icon icon-sm"), quiz.groupName]) : null,
      el("span", { class: "grow" }),
      el("span", { class: "small muted", text: t(scoredQuestions.length === 1 ? S.QUESTION_COUNT_ONE : S.QUESTION_COUNT_MANY, { n: scoredQuestions.length }) }),
    ]),
  ]);

  const graded = state.submitted.filter((r) => r.pending === 0);
  const percents = graded.map((r) => r.percent).filter((p) => p != null);
  const avg = percents.length ? Math.round(percents.reduce((a, b) => a + b, 0) / percents.length) : null;
  const avgTime = state.submitted.length ? state.submitted.reduce((s, r) => s + r.timeSec, 0) / state.submitted.length : 0;
  const web = state.submitted.filter((r) => r.attempt.source === "WEB").length;
  const android = state.submitted.filter((r) => r.attempt.source === "ANDROID").length;
  const notStarted = state.rows.filter((r) => r.bucket === BUCKET.NOT_STARTED).length;

  const stats = el("section", { class: "stat-strip results-stats" }, [
    stat(S.STAT_SUBMITTED, state.submitted.length, notStarted ? t(S.N_NOT_STARTED, { n: notStarted }) : null, "users", "info"),
    stat(S.STAT_AVERAGE, avg == null ? "—" : `${avg}%`, graded.length !== state.submitted.length ? S.AVERAGE_MARKED_ONLY : null, "chart", "live"),
    quiz.showTimers ? stat(S.STAT_AVG_TIME, state.submitted.length ? formatDuration(avgTime) : "—", null, "clock", "") : null,
    stat(S.STAT_TO_MARK, pendingTotal, null, "marking", pendingTotal ? "warn" : "", pendingTotal ? route(`grading/?quiz=${encodeURIComponent(quiz.id)}`) : null),
    stat(S.STAT_SOURCES, `${web} / ${android}`, S.WEB_ANDROID, "globe", ""),
  ]);

  const stats2 = questionStats(state.submitted.flatMap((r) => r.answers));
  const accuracy = scoredQuestions.map((q) => {
    const st = stats2.get(q.id) ?? { correctCount: 0, totalCount: 0, pendingCount: 0 };
    return { label: plainQuestionText(q), correct: st.correctCount, total: st.totalCount, pending: st.pendingCount };
  });

  const charts = state.submitted.length && scoredQuestions.length
    ? el("div", { class: "results-charts" }, [
        el("section", { class: "card card-pad" }, [el("h3", { class: "chart-title", text: S.CHART_DISTRIBUTION }), scoreDistribution(percents)]),
        el("section", { class: "card card-pad" }, [el("h3", { class: "chart-title", text: S.CHART_ACCURACY }), accuracyBars(accuracy)]),
      ])
    : null;

  const polls = state.questions.filter((q) => q.type === QUESTION_TYPES.POLL);
  const pollSection = polls.length
    ? el("section", { class: "card card-pad stack" }, [
        el("h3", { class: "chart-title", text: S.POLL_RESULTS }),
        ...polls.map((q) => el("div", { class: "stack-sm poll-block" }, [el("div", { class: "strong", dir: "auto", text: plainQuestionText(q) }), pollBars(pollTally(q, state.pollVotes.get(q.id) ?? []))])),
      ])
    : null;

  peopleRegion = el("div");
  renderPeople();

  const content = state.rows.length
    ? [header, stats, charts, pollSection, peopleRegion]
    : [
        header,
        el("div", { class: "card" }, [
          emptyState({
            art: "people",
            title: quiz.isDraft ? S.DRAFT_NO_RESULTS_TITLE : S.NO_ATTEMPTS_TITLE,
            body: quiz.isDraft ? S.DRAFT_NO_RESULTS_BODY : S.NO_ATTEMPTS_BODY,
            actions: quiz.isDraft
              ? [button({ label: S.EDIT_QUIZ, icon: "pencil", variant: "primary", href: route(`create/?id=${encodeURIComponent(quiz.id)}`) })]
              : [button({ label: S.COPY_LINK, icon: "link", variant: "primary", onClick: () => copyText(joinLink(quiz.shareCode), S.LINK_COPIED) })],
          }),
        ]),
      ];
  shell.content.classList.add("results-page");
  shell.content.replaceChildren(...content.filter(Boolean));
  stagger(shell.content);
}

function stat(label, value, sub, iconName, tone, href) {
  const body = [
    el("span", { class: `stat-icon ${tone ? `stat-icon-${tone}` : ""}` }, [icon(iconName)]),
    el("div", { class: "stat-text" }, [
      el("span", { class: "stat-label", text: label }),
      el("span", { class: "stat-value", text: String(value) }),
      sub ? el("span", { class: "stat-sub-line", text: sub }) : null,
    ]),
  ];
  return href ? el("a", { class: "card stat stat-link", href }, body) : el("div", { class: "card stat" }, body);
}

function renderPeople() {
  swap(
    peopleRegion,
    participantsSection(state.rows, {
      filter: state.filter,
      search: state.search,
      sort: state.sort,
      showTimers: state.quiz.showTimers,
      onFilter: (value) => {
        state.filter = value;
        renderPeople();
      },
      onSearch: (value) => {
        state.search = value;
        renderPeople();
      },
      onSort: (value) => {
        state.sort = value;
        renderPeople();
      },
      onRemove: removeRow,
    })
  );
}

async function removeRow(row) {
  const ok = await confirmDialog({ title: S.CONFIRM_REMOVE_TITLE, body: t(S.CONFIRM_REMOVE_BODY_NAMED, { name: row.name }), confirmLabel: S.REMOVE });
  if (!ok) return;
  try {
    await removeParticipant(state.quiz.id, row.userId);
    toast(S.PARTICIPANT_REMOVED, { tone: "success" });
    await load();
  } catch (error) {
    console.error(error);
    toast(S.ERR_SAVE_FAILED, { tone: "error" });
  }
}

async function endNow() {
  const ok = await confirmDialog({ title: S.END_QUIZ_TITLE, body: S.END_QUIZ_BODY, confirmLabel: S.END_QUIZ_NOW });
  if (!ok) return;
  try {
    state.quiz = await endQuizNow(state.quiz);
    toast(S.QUIZ_ENDED, { tone: "success" });
    render();
  } catch (error) {
    console.error(error);
    toast(S.ERR_SAVE_FAILED, { tone: "error" });
  }
}

function exportCsv() {
  const text = buildCsv({ quiz: state.quiz, questions: state.questions, rows: state.submitted, pollVotes: state.pollVotes });
  const safe = (state.quiz.title || "quiz").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 40);
  downloadCsv(`${safe}_results.csv`, text);
  toast(S.CSV_DOWNLOADED, { tone: "success" });
}

start();
