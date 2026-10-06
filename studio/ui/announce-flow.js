// The announce flow — Studio's copy of the app's ui/announce (ResultsAnnounceFlow + ResultsAnnounceHost),
// same states, same sheet options, same dialogs, same words (webtest/text-parity.test.mjs keeps the texts
// in step, webtest/announce-parity.test.mjs the rules). ONE implementation for every Studio entry point:
// the results page menu and card, and the dashboard menu / close-poll.
//
// Every write goes through core/quizzes.js (setResultsRelease = the app's set_results_release RPC,
// endQuizNow). Studio has no offline outbox: a failed call shows an error and the owner retries; if
// "End quiz and announce" ends the quiz but the announce fails, the message says exactly that.

import { ANNOUNCE_STATE, announceCardKind, announceMenuKey, announceState, announceStep } from "../core/announce.js";
import { endQuizNow, loadQuestions, loadQuiz, setResultsRelease } from "../core/quizzes.js";
import { S, t } from "../core/strings.js";
import { button, confirmDialog, el, openDialog, toast } from "./components.js";

let busy = false;

/**
 * Opens whatever fits this quiz right now (nothing when there is nothing to offer). Reads the quiz fresh,
 * so a stale page can't pick the wrong dialog.
 *
 *   pendingCount — papers still waiting for the owner's marks, or null when the caller has no count.
 *   poll         — closing a poll-only quiz: its plain confirm keeps the poll wording ("Close this poll?") —
 *                  there are no scores to announce; every other step is the same as for a quiz.
 *   onMarkFirst  — "Mark first": send the owner to marking.
 *   onDone       — called after anything was written, so the page can reload.
 */
export async function openAnnounceFlow({ quizId, pendingCount = null, poll = false, onMarkFirst, onDone }) {
  if (busy) return;
  busy = true;
  try {
    const [quiz, questions] = await Promise.all([loadQuiz(quizId), loadQuestions(quizId)]);
    if (!quiz) return;
    const step = announceStep(quiz, questions, Date.now(), pendingCount);
    const done = () => onDone?.();

    switch (step.kind) {
      case "NOTHING":
        return;
      case "CONFIRM_END": {
        if (poll) {
          const ok = await confirmDialog({ title: S.CONFIRM_CLOSE_POLL_TITLE, body: S.CONFIRM_CLOSE_POLL_BODY, confirmLabel: S.ACT_CLOSE_POLL });
          if (ok) await act("END_ONLY", quiz, done, S.POLL_CLOSED);
          return;
        }
        const body = step.plain ? S.END_QUIZ_BODY : step.handMarked ? S.ANNOUNCE_CONFIRM_END_AUTO_MARKED : S.ANNOUNCE_CONFIRM_END_AUTO;
        if (await confirmDialog({ title: S.END_QUIZ_TITLE, body, confirmLabel: S.END_QUIZ_NOW })) await act("END_ONLY", quiz, done);
        return;
      }
      case "CHOICE": {
        const action = await choiceSheet(step);
        if (action) await act(action, quiz, done);
        return;
      }
      case "CONFIRM_ANNOUNCE": {
        if (step.pendingCount == null) {
          const ok = await confirmDialog({
            badge: S.ANNOUNCE_BADGE,
            title: S.ANNOUNCE_CONFIRM_TITLE,
            body: S.ANNOUNCE_UNKNOWN_UNMARKED_BODY,
            confirmLabel: S.ANNOUNCE_CONFIRM_ANNOUNCE,
            danger: false,
          });
          if (ok) await act("ANNOUNCE", quiz, done);
          return;
        }
        const choice = await markOrAnnounce(step.pendingCount);
        if (choice === "MARK_FIRST") onMarkFirst?.(quiz);
        else if (choice === "ANNOUNCE") await act("ANNOUNCE", quiz, done);
        return;
      }
      case "CONFIRM_ANNOUNCE_ALL": {
        const ok = await confirmDialog({
          badge: S.ANNOUNCE_BADGE,
          title: S.ANNOUNCE_CONFIRM_TITLE,
          body: t(S.ANNOUNCE_CONFIRM_ALL_BODY, { title: quiz.title?.trim() || S.UNTITLED_QUIZ }),
          confirmLabel: S.ANNOUNCE_CONFIRM_ANNOUNCE,
          danger: false,
        });
        if (ok) await act("ANNOUNCE", quiz, done);
        return;
      }
      case "CONFIRM_HIDE": {
        const ok = await confirmDialog({
          badge: S.ANNOUNCE_BADGE,
          title: S.ANNOUNCE_HIDE_TITLE,
          body: step.wasAuto ? S.ANNOUNCE_HIDE_BODY_AUTO : S.ANNOUNCE_HIDE_BODY,
          confirmLabel: S.ANNOUNCE_HIDE_CONFIRM,
          danger: false,
        });
        if (ok) await act("HIDE", quiz, done);
        return;
      }
    }
  } catch (error) {
    console.error(error);
    toast(S.ANNOUNCE_FAILED, { tone: "error" });
  } finally {
    busy = false;
  }
}

/** Runs the owner's choice. Announcing is always MANUAL + now; hiding is MANUAL + null (so an AUTO quiz that
 *  was showing results because it ended stays hidden) — exactly the app's announceNow / hideNow. */
async function act(action, quiz, done, endedMessage = S.QUIZ_ENDED) {
  let ended = false;
  try {
    if (action === "END_ONLY" || action === "END_AND_ANNOUNCE") {
      await endQuizNow(quiz);
      ended = true;
      if (action === "END_ONLY") {
        toast(endedMessage, { tone: "success" });
        done();
        return;
      }
    }
    if (action === "HIDE") {
      if (!(await setResultsRelease(quiz.id, "MANUAL", null))) throw new Error("refused");
      done();
      return;
    }
    if (!(await setResultsRelease(quiz.id, "MANUAL", Date.now()))) throw new Error("refused");
    done();
    toast(S.ANNOUNCE_SNACKBAR_ANNOUNCED, {
      tone: "success",
      action: { label: S.ANNOUNCE_SNACKBAR_HIDE, onClick: () => undo(quiz.id, done) },
    });
  } catch (error) {
    console.error(error);
    // The quiz did end, so the page must show that even though the announce did not land.
    if (ended) done();
    toast(ended && action === "END_AND_ANNOUNCE" ? S.ANNOUNCE_ENDED_NOT_ANNOUNCED : S.ANNOUNCE_FAILED, { tone: "error" });
  }
}

/** The toast's Hide: takes the announcement back at once, no second dialog (the app's undoAnnounce). */
async function undo(quizId, done) {
  try {
    if (!(await setResultsRelease(quizId, "MANUAL", null))) throw new Error("refused");
    done();
  } catch (error) {
    console.error(error);
    toast(S.ANNOUNCE_FAILED, { tone: "error" });
  }
}

const block = { style: "width:100%;justify-content:center" };

/** "End quiz / Announce": the choice sheet. Resolves with the action, or null for Cancel. */
function choiceSheet(step) {
  return new Promise((resolve) => {
    let result = null;
    const pick = (action) => () => {
      result = action;
      dlg.close("pick");
    };
    const options = step.alreadyAnnounced
      ? [
          button({ label: S.ANNOUNCE_CHOICE_END_ONLY, variant: "primary", onClick: pick("END_ONLY"), attrs: block }),
          button({ label: S.ANNOUNCE_CHOICE_HIDE, variant: "secondary", onClick: pick("HIDE"), attrs: block }),
        ]
      : [
          button({ label: S.ANNOUNCE_CHOICE_END_AND_ANNOUNCE, variant: "primary", onClick: pick("END_AND_ANNOUNCE"), attrs: block }),
          button({ label: S.ANNOUNCE_CHOICE_END_ONLY, variant: "secondary", onClick: pick("END_ONLY"), attrs: block }),
          // Not offered before the quiz has started: there is nothing open to keep open.
          step.scheduledNotStarted
            ? null
            : button({ label: S.ANNOUNCE_CHOICE_KEEP_OPEN, variant: "secondary", onClick: pick("ANNOUNCE_KEEP_OPEN"), attrs: block }),
          step.scheduledNotStarted ? null : el("p", { class: "small muted", text: S.ANNOUNCE_CHOICE_KEEP_OPEN_HELPER }),
        ];
    const dlg = openDialog({
      badge: S.ANNOUNCE_BADGE,
      title: S.ANNOUNCE_CHOICE_TITLE,
      content: [
        el("div", { class: "stack-sm" }, [
          ...options.filter(Boolean),
          step.handMarked ? el("p", { class: "small muted", text: S.ANNOUNCE_HAND_MARKED_NOTE }) : null,
        ].filter(Boolean)),
      ],
      actions: [button({ label: S.CANCEL, variant: "secondary", onClick: () => dlg.close("cancel") })],
      onClose: () => resolve(result),
    });
  });
}

/** "N papers not marked. Announce anyway?" — Mark first (the safe way) or Announce anyway. */
function markOrAnnounce(count) {
  return new Promise((resolve) => {
    let result = null;
    const pick = (value) => () => {
      result = value;
      dlg.close("pick");
    };
    const markBtn = button({ label: S.ANNOUNCE_MARK_FIRST, variant: "primary", onClick: pick("MARK_FIRST") });
    const dlg = openDialog({
      badge: S.ANNOUNCE_BADGE,
      title: S.ANNOUNCE_CONFIRM_TITLE,
      content: [el("p", { class: "dialog-body", text: t(count === 1 ? S.ANNOUNCE_UNMARKED_ONE : S.ANNOUNCE_UNMARKED_MANY, { n: count }) })],
      actions: [
        button({ label: S.CANCEL, variant: "secondary", onClick: () => dlg.close("cancel") }),
        button({ label: S.ANNOUNCE_ANYWAY, variant: "secondary", onClick: pick("ANNOUNCE") }),
        markBtn,
      ],
      initialFocus: () => markBtn,
      onClose: () => resolve(result),
    });
  });
}

// ── Wording shared by the menu, the results card and the dashboard chip ──────────────────────────

const when = (ms) =>
  new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The menu item for a quiz in [state]: { label, iconName }, or null for "don't show it". Show Score on keeps
 *  Studio's old "End quiz now"; everything else is the app's wording (announceMenuLabel). */
export function announceMenuItem(state) {
  switch (announceMenuKey(state)) {
    case null:
      return null;
    case "END_QUIZ":
      return { label: state === ANNOUNCE_STATE.PLAIN_END ? S.END_QUIZ_NOW : S.ANNOUNCE_MENU_END_QUIZ, iconName: "stop" };
    case "END_OR_ANNOUNCE":
      return { label: S.ANNOUNCE_MENU_END_OR_ANNOUNCE, iconName: "stop" };
    case "END_OR_HIDE":
      return { label: S.ANNOUNCE_MENU_END_OR_HIDE, iconName: "stop" };
    case "ANNOUNCE":
      return { label: S.ANNOUNCE_MENU_ANNOUNCE, iconName: "chart" };
    default:
      return { label: S.ANNOUNCE_MENU_HIDE, iconName: "chart" };
  }
}

/** The dashboard chip text (the app's Home row): "Results at <time>", "Not announced", … */
export function chipText(kind, endAt) {
  switch (kind) {
    case "AUTO_WITH_END":
      return t(S.HOME_RESULTS_CHIP_AUTO_WITH_END, { when: when(endAt) });
    case "AUTO_NO_END":
      return S.HOME_RESULTS_CHIP_AUTO_NO_END;
    case "MANUAL_NOT_ANNOUNCED":
      return S.HOME_RESULTS_CHIP_NOT_ANNOUNCED;
    default:
      return S.HOME_RESULTS_CHIP_ANNOUNCED;
  }
}

/** The "Student results" card of the results page (the app's Participants card). null = no card. */
export function announceCard({ quiz, now, pendingPapers, onAction }) {
  const kind = announceCardKind(announceState(quiz, now), quiz.endAt);
  if (!kind || quiz.isArchived) return null;
  const line = {
    AUTO_WITH_END: () => t(S.ANNOUNCE_CARD_AUTO_WITH_END, { when: when(quiz.endAt) }),
    AUTO_NO_END: () => S.ANNOUNCE_CARD_AUTO_NO_END,
    MANUAL_NOT_ANNOUNCED: () => S.ANNOUNCE_CARD_MANUAL,
    ANNOUNCED: () => S.ANNOUNCE_CARD_ANNOUNCED,
  }[kind]();
  const label =
    kind === "ANNOUNCED" ? S.ANNOUNCE_MENU_HIDE : kind === "MANUAL_NOT_ANNOUNCED" ? S.ANNOUNCE_MENU_ANNOUNCE : S.ANNOUNCE_CARD_END_NOW;
  return el("section", { class: "card card-pad stack-sm announce-card" }, [
    el("h3", { class: "chart-title", text: S.ANNOUNCE_CARD_TITLE }),
    el("p", { class: "muted", text: line }),
    kind === "ANNOUNCED" && pendingPapers > 0
      ? el("p", { class: "small warn", text: t(pendingPapers === 1 ? S.ANNOUNCE_CARD_PENDING_ONE : S.ANNOUNCE_CARD_PENDING_MANY, { n: pendingPapers }) })
      : null,
    el("div", {}, [button({ label, variant: kind === "ANNOUNCED" ? "secondary" : "primary", onClick: onAction })]),
  ].filter(Boolean));
}
