// Dashboard — the signed-in owner's quizzes. Two states, both ports of design-reference/:
//   • no quizzes at all (drafts and archived count) → empty-view.js (dashboard-welcome.html)
//   • one or more                                   → populated-view.js (dashboard.html)
// A skeleton holds the page until the data is in, so the welcome screen never flashes.
//
// Data: one query for quizzes (+ limits), then in parallel one each for questions, attempt
// stats, pending marking, participants and graded scores across all quiz ids — never one
// request per quiz. Two follow-ups only when needed: poll votes for poll-only quizzes, and
// "x of y marked" for the quiz the Next step spotlight is about.

import { displayNameOf, requireUser } from "../core/auth.js";
import { dedupeForBank, listMyBank, saveAllToBank } from "../core/bank.js";
import { fetchLimits } from "../core/limits.js";
import { deleteQuiz, duplicateQuiz, listMyQuizzes, loadQuestions, publishQuiz, questionsFor, setArchived } from "../core/quizzes.js";
import { QUESTION_TYPES, joinLink } from "../core/models.js";
import { attemptStats, gradedStats, loadPollVotes, manualMarkingProgress, participantIds, pendingMarking } from "../core/results.js";
import { QUIZ_STATUS, quizCardStatus } from "../core/status.js";
import { S, t } from "../core/strings.js";
import { validateQuiz } from "../core/validate.js";
import { confirmDialog, copyText, el, errorBlock, renderSignInGate, renderSpinner, toast } from "../ui/components.js";
import { openAnnounceFlow } from "../ui/announce-flow.js";
import { confetti } from "../ui/motion.js";
import { mountShell } from "../ui/shell.js";
import { route } from "../core/paths.js";
import { track } from "../core/analytics.js";
import { footer } from "./dash-util.js";
import { renderEmpty } from "./empty-view.js";
import { pickNextStep } from "./next-step.js";
import { renderPopulated } from "./populated-view.js";

// The dashboard's own page background (ui/dashboard.css); dark mode is every page's — ui/tokens.css.
document.documentElement.dataset.page = "dashboard";

const root = document.getElementById("root");

const state = {
  user: null,
  limits: null,
  // { quiz, bucket, questionCount, pollOnly, pollCount, votes, submitted, avgPct, pending,
  //   ready, answersSet, missing }
  items: [],
  students: { count: 0, quizzes: 0 },
  graded: { graded: 0, avgPct: null },
  markProgress: null,
  filter: "all",
  error: false,
};

let shell = null;
let cleanup = () => {};

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
    title: S.NAV_DASHBOARD,
    fetchPending: false,
    hideTopbar: true,
    width: "dash",
  });
  shell.content.replaceChildren(skeleton());
  await load();
}

/** The populated page's shapes, pulsing — shown until the data arrives. */
function skeleton() {
  const block = (cls) => el("div", { class: `dv-skel ${cls}`, "aria-hidden": "true" });
  return el("div", { class: "dv dv-pop dv-loading", role: "status", "aria-label": S.LOADING }, [
    block("dv-skel-date"),
    block("dv-skel-head"),
    el("div", { class: "dv-topgrid" }, [block("dv-skel-spot"), block("dv-skel-tile"), block("dv-skel-tile"), block("dv-skel-tile")]),
    el("div", { class: "dv-grid dv-skel-cards" }, [block("dv-skel-card"), block("dv-skel-card")]),
  ]);
}

/** Status → the list's filter bucket. Live covers open-and-untaken and in-progress. */
function bucketOf(status) {
  switch (status) {
    case QUIZ_STATUS.ARCHIVED:
      return "archived";
    case QUIZ_STATUS.DRAFT:
      return "draft";
    case QUIZ_STATUS.SCHEDULED:
      return "sched";
    case QUIZ_STATUS.ENDED:
      return "ended";
    default:
      return "live";
  }
}

/** A draft's readiness from the builder's own validation: ready = it would publish as it is;
 *  otherwise the first thing missing — a title, questions, then answers (any question the
 *  builder would flag, most often a missing correct answer). */
function readiness(quiz, questions, limits) {
  const check = validateQuiz(quiz, questions, limits);
  const answersSet = questions.length > 0 && check.questions.size === 0;
  if (check.ok) return { ready: true, answersSet, missing: null };
  const missing = !quiz.title?.trim() ? "title" : !questions.length ? "questions" : !answersSet ? "answers" : "title";
  return { ready: false, answersSet, missing };
}

async function load() {
  state.error = false;
  try {
    const [quizzes, limits] = await Promise.all([listMyQuizzes(state.user.id), fetchLimits()]);
    state.limits = limits;
    const ids = quizzes.map((q) => q.id);
    const publishedIds = quizzes.filter((q) => !q.isDraft).map((q) => q.id);
    const [questions, stats, pending, people, graded] = await Promise.all([
      questionsFor(ids),
      attemptStats(publishedIds),
      pendingMarking(publishedIds),
      participantIds(publishedIds),
      gradedStats(publishedIds),
    ]);

    const now = Date.now();
    state.items = quizzes.map((quiz) => {
      const list = questions.get(quiz.id) ?? [];
      const polls = list.filter((q) => q.type === QUESTION_TYPES.POLL);
      const submitted = stats.get(quiz.id)?.submitted ?? 0;
      return {
        quiz,
        bucket: bucketOf(quizCardStatus(quiz, submitted > 0, now)),
        questionCount: list.length,
        pollOnly: list.length > 0 && polls.length === list.length,
        pollCount: polls.length,
        pollIds: polls.map((q) => q.id),
        votes: 0,
        submitted,
        avgPct: stats.get(quiz.id)?.avgPct ?? null,
        pending: pending.get(quiz.id)?.answers ?? 0,
        ...(quiz.isDraft ? readiness(quiz, list, limits) : { ready: false, answersSet: true, missing: null }),
      };
    });

    // Students reached: everyone who joined or submitted, once, never the owner.
    const everyone = new Set();
    let reachedQuizzes = 0;
    for (const set of people.values()) {
      set.delete(state.user.id);
      if (set.size) reachedQuizzes++;
      for (const id of set) everyone.add(id);
    }
    state.students = { count: everyone.size, quizzes: reachedQuizzes };
    state.graded = graded;

    // Votes = people who voted, for published poll-only quizzes.
    const pollItems = state.items.filter((i) => i.pollOnly && !i.quiz.isDraft);
    if (pollItems.length) {
      const votes = await loadPollVotes(pollItems.flatMap((i) => i.pollIds));
      for (const item of pollItems) {
        const voters = new Set();
        for (const id of item.pollIds) for (const vote of votes.get(id) ?? []) voters.add(vote.voter_key);
        item.votes = voters.size;
      }
    }

    const step = pickNextStep(state.items, now);
    state.markProgress = step.kind === "mark" ? await manualMarkingProgress(step.item.quiz.id) : null;
  } catch (error) {
    console.error(error);
    state.error = true;
  }
  render();
}

let refreshTimer = null;

/** One timer, at the soonest end time among open quizzes, so a chip ("Results at ...") and its Announce button
 *  change the moment a quiz ends — no polling. A delay a browser timer cannot hold is skipped. */
function scheduleRefresh(items) {
  clearTimeout(refreshTimer);
  refreshTimer = null;
  const now = Date.now();
  const next = items
    .filter((i) => !i.quiz.isDraft && !i.quiz.isArchived && i.quiz.endAt != null && i.quiz.endAt > now)
    .map((i) => i.quiz.endAt - now)
    .sort((a, b) => a - b)[0];
  if (next == null || next > 2147483647) return;
  refreshTimer = setTimeout(load, next + 500);
}

function render() {
  cleanup();
  cleanup = () => {};
  if (state.error) {
    shell.content.replaceChildren(el("div", { class: "dv" }, [el("div", { class: "dv-sec" }, [errorBlock(S.ERR_LOAD_FAILED, load)])]));
    return;
  }
  const items = state.items;
  shell.setPendingCount(items.reduce((sum, i) => sum + i.pending, 0));
  shell.setQuota({ used: items.length, limit: state.limits.maxQuizzes, maxQuestions: state.limits.maxQuestions });

  const userName = displayNameOf(state.user);
  if (!items.length) {
    cleanup = renderEmpty(shell.content, { userName });
    shell.content.querySelector(".dv-wrap")?.append(footer());
    return;
  }
  cleanup = renderPopulated(shell.content, {
    userName,
    items,
    step: pickNextStep(items),
    markProgress: state.markProgress,
    students: state.students,
    graded: state.graded,
    limits: state.limits,
    filter: state.filter,
    onFilter: (filter) => (state.filter = filter),
    actions: { publish, closePoll, announce, share, duplicate, archive, remove, saveToBank },
  });
  scheduleRefresh(items);
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

/** End quiz / Announce / Hide / Close poll: the one shared flow (ui/announce-flow.js), the same as the app's Home menu.
 *  The dashboard has no count of unmarked papers (like the app's Home), so it passes none. */
function announce(quiz) {
  return openAnnounceFlow({
    quizId: quiz.id,
    onMarkFirst: (q) => (window.location.href = route(`grading/?quiz=${encodeURIComponent(q.id)}`)),
    onDone: load,
  });
}

/** Close poll: the same flow, with the poll's own wording for the plain confirm. */
function closePoll(quiz) {
  return openAnnounceFlow({ quizId: quiz.id, poll: true, onDone: load });
}

/** The system share sheet where there is one, otherwise the join link on the clipboard. */
async function share(quiz) {
  const url = joinLink(quiz.shareCode);
  if (navigator.share) {
    try {
      await navigator.share({ title: quiz.title?.trim() || S.UNTITLED_QUIZ, url });
      track("quiz_shared", { quiz_id: quiz.id, method: "share_sheet", from: "dashboard" });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  track("quiz_shared", { quiz_id: quiz.id, method: "link_copied", from: "dashboard" });
  await copyText(url, S.LINK_COPIED);
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

/** Copies the quiz's questions into the Question Bank (HomeViewModel.saveQuizQuestionsToBank):
 *  fresh ids, detached from the quiz, all or nothing against the bank's cap. */
let savingToBank = false;

async function saveToBank(quiz) {
  if (savingToBank) return;
  savingToBank = true;
  const done = toast(S.BANK_SAVING_QUIZ, { tone: "info", duration: 60000 });
  try {
    const questions = await loadQuestions(quiz.id);
    if (!questions.length) {
      done();
      toast(S.BANK_QUIZ_HAS_NO_QUESTIONS, { tone: "info" });
      return;
    }
    // Questions already in the bank are left out, as on every bulk save (the app's HomeViewModel too).
    const { toImport, skippedTexts } = dedupeForBank(await listMyBank(state.user.id), questions);
    const result = await saveAllToBank(state.user.id, toImport, state.limits);
    done();
    if (result.atCap) {
      toast(t(S.BANK_FULL_IMPORT_BODY, { n: result.atCap }), { tone: "error", duration: 6000 });
      return;
    }
    const message = skippedTexts.length
      ? t(S.BANK_SAVED_FROM_QUIZ_SKIPPED, { n: result.saved, m: skippedTexts.length })
      : result.saved === 1 ? S.BANK_SAVED_FROM_QUIZ_ONE : t(S.BANK_SAVED_FROM_QUIZ, { n: result.saved });
    toast(message, {
      tone: "success",
      duration: 6000,
      action: { label: S.BANK_VIEW, onClick: () => (window.location.href = route("bank/")) },
    });
  } catch (error) {
    console.error(error);
    done();
    toast(S.ERR_SAVE_FAILED, { tone: "error" });
  } finally {
    savingToBank = false;
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
