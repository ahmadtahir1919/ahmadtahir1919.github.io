// What a quiz owner can do about announcing results — a port of data/model/ResultsAnnounce.kt
// (announceState, hasHandMarkedQuestions, announceCheck, announceStep, homeResultsChipKind,
// showsHomeAnnounceButton, announceCardKind) and ResultsVisibility.kt (resultsReleased,
// resultsHiddenReason). Pure — no I/O. The Android tests and webtest/announce-parity.test.mjs run the
// SAME tables (webtest/fixtures/announce-steps.json, hidden-reason.json), so the two cannot drift.
//
// Quiz fields are the camelCase page model: showResult, resultsReleaseMode ("AUTO"|"MANUAL"),
// resultsReleasedAt, isDraft, isArchived, startAt, endAt, manualMarkingDefault.

import { QUESTION_TYPES as T } from "./models.js";
import { QUIZ_STATUS, effectiveStatus } from "./status.js";

export const ANNOUNCE_STATE = {
  NOT_APPLICABLE: "NOT_APPLICABLE",
  PLAIN_END: "PLAIN_END",
  LIVE_AUTO: "LIVE_AUTO",
  LIVE_MANUAL: "LIVE_MANUAL",
  LIVE_ANNOUNCED: "LIVE_ANNOUNCED",
  ENDED_NOT_ANNOUNCED: "ENDED_NOT_ANNOUNCED",
  ANNOUNCED: "ANNOUNCED",
};

const isManual = (quiz) => quiz.resultsReleaseMode === "MANUAL";

/** ResultsVisibility.kt resultsReleased: Show Score on, or AUTO and ended, or announced. */
export function resultsReleased(quiz, now) {
  return (
    quiz.showResult === true ||
    (!isManual(quiz) && effectiveStatus(quiz, now) === QUIZ_STATUS.ENDED) ||
    quiz.resultsReleasedAt != null
  );
}

/** ResultsVisibility.kt resultsHiddenReason: why a participant's result is not out yet, or null. */
export function resultsHiddenReason(quiz, now) {
  if (resultsReleased(quiz, now)) return null;
  if (isManual(quiz)) return "MANUAL_NOT_ANNOUNCED";
  return quiz.endAt != null ? "AUTO_WITH_END" : "AUTO_NO_END";
}

/** ResultsAnnounce.kt announceState. */
export function announceState(quiz, now) {
  if (quiz.isDraft) return ANNOUNCE_STATE.NOT_APPLICABLE;
  const ended = effectiveStatus(quiz, now) === QUIZ_STATUS.ENDED;
  if (quiz.showResult) return ended ? ANNOUNCE_STATE.NOT_APPLICABLE : ANNOUNCE_STATE.PLAIN_END;
  const manual = isManual(quiz);
  if (!ended && !manual) return ANNOUNCE_STATE.LIVE_AUTO;
  if (!ended && quiz.resultsReleasedAt != null) return ANNOUNCE_STATE.LIVE_ANNOUNCED;
  if (!ended) return ANNOUNCE_STATE.LIVE_MANUAL;
  return resultsReleased(quiz, now) ? ANNOUNCE_STATE.ANNOUNCED : ANNOUNCE_STATE.ENDED_NOT_ANNOUNCED;
}

/** Written / fill-in answers, or every scored question while Manual Review is on. */
export function hasHandMarkedQuestions(quiz, questions) {
  const scored = questions.some((q) => q.type !== T.POLL);
  return scored && (quiz.manualMarkingDefault === true || questions.some((q) => q.type === T.WRITTEN || q.type === T.FILL_BLANK));
}

/** ANNOUNCE_NOW | ASK_WITH_COUNT | ASK_WITHOUT_COUNT. pendingCount null = this screen has no count. */
export function announceCheck(quiz, questions, pendingCount) {
  if (pendingCount == null) return hasHandMarkedQuestions(quiz, questions) ? "ASK_WITHOUT_COUNT" : "ANNOUNCE_NOW";
  return pendingCount > 0 ? "ASK_WITH_COUNT" : "ANNOUNCE_NOW";
}

/**
 * Which sheet or dialog to open. kind: NOTHING | CONFIRM_END | CHOICE | CONFIRM_HIDE |
 * CONFIRM_ANNOUNCE_ALL | CONFIRM_ANNOUNCE — with the same flags as AnnounceStep in the app.
 */
export function announceStep(quiz, questions, now, pendingCount) {
  const handMarked = hasHandMarkedQuestions(quiz, questions);
  const notStarted = effectiveStatus(quiz, now) === QUIZ_STATUS.SCHEDULED;
  switch (announceState(quiz, now)) {
    case ANNOUNCE_STATE.NOT_APPLICABLE:
      return { kind: "NOTHING" };
    case ANNOUNCE_STATE.PLAIN_END:
      return { kind: "CONFIRM_END", plain: true, handMarked: false };
    case ANNOUNCE_STATE.LIVE_AUTO:
      return { kind: "CONFIRM_END", plain: false, handMarked };
    case ANNOUNCE_STATE.LIVE_MANUAL:
      return { kind: "CHOICE", scheduledNotStarted: notStarted, handMarked, alreadyAnnounced: false };
    case ANNOUNCE_STATE.LIVE_ANNOUNCED:
      return { kind: "CHOICE", scheduledNotStarted: notStarted, handMarked, alreadyAnnounced: true };
    case ANNOUNCE_STATE.ANNOUNCED:
      return { kind: "CONFIRM_HIDE", wasAuto: !isManual(quiz) };
    default:
      switch (announceCheck(quiz, questions, pendingCount)) {
        case "ANNOUNCE_NOW":
          return { kind: "CONFIRM_ANNOUNCE_ALL" };
        case "ASK_WITH_COUNT":
          return { kind: "CONFIRM_ANNOUNCE", pendingCount };
        default:
          return { kind: "CONFIRM_ANNOUNCE", pendingCount: null };
      }
  }
}

/** The menu item's label key for a state, or null for "don't show the item" (announceMenuLabel). */
export function announceMenuKey(state) {
  switch (state) {
    case ANNOUNCE_STATE.PLAIN_END:
    case ANNOUNCE_STATE.LIVE_AUTO:
      return "END_QUIZ";
    case ANNOUNCE_STATE.LIVE_MANUAL:
      return "END_OR_ANNOUNCE";
    case ANNOUNCE_STATE.LIVE_ANNOUNCED:
      return "END_OR_HIDE";
    case ANNOUNCE_STATE.ENDED_NOT_ANNOUNCED:
      return "ANNOUNCE";
    case ANNOUNCE_STATE.ANNOUNCED:
      return "HIDE";
    default:
      return null;
  }
}

/** AUTO_WITH_END | AUTO_NO_END | MANUAL_NOT_ANNOUNCED | ANNOUNCED | null (announceCardKind). */
export function announceCardKind(state, endAt) {
  switch (state) {
    case ANNOUNCE_STATE.LIVE_AUTO:
      return endAt != null ? "AUTO_WITH_END" : "AUTO_NO_END";
    case ANNOUNCE_STATE.LIVE_MANUAL:
    case ANNOUNCE_STATE.ENDED_NOT_ANNOUNCED:
      return "MANUAL_NOT_ANNOUNCED";
    case ANNOUNCE_STATE.LIVE_ANNOUNCED:
    case ANNOUNCE_STATE.ANNOUNCED:
      return "ANNOUNCED";
    default:
      return null;
  }
}

/** The Home-row / dashboard-card chip kind; none for an archived quiz. */
export function homeResultsChipKind(quiz, now) {
  return quiz.isArchived ? null : announceCardKind(announceState(quiz, now), quiz.endAt);
}

/** The small Announce button: a finished MANUAL quiz that has not been announced. */
export function showsHomeAnnounceButton(quiz, now) {
  return !quiz.isArchived && announceState(quiz, now) === ANNOUNCE_STATE.ENDED_NOT_ANNOUNCED;
}
