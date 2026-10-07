// Whether a taker may see their result — the one definition on the web. Mirrors
// data/model/ResultsVisibility.kt rule for rule; webtest/results-visibility-parity.test.mjs and the
// Android ResultsVisibilityFixtureTest both run webtest/fixtures/results-visibility.json, so the
// two cannot drift apart.
//
// Show Score ON is the existing behaviour, untouched: the score shows (a hand-marked attempt
// shows what is marked so far, with a banner saying it may still change).
//
// Show Score OFF is the release path: the result stays hidden until it is released — AUTO mode
// once the quiz has ended (end time passed, or the owner ended it; worked out here from
// endAt, not by a server job), MANUAL mode once the owner has announced it (resultsReleasedAt) —
// and even then not while this attempt still has answers waiting for the owner, which show the
// pending state instead of a partial score.
//
// A plain browser script like the grading ones: no imports, nothing touching the DOM at load
// time, its public surface assigned onto window (so webtest can load it under Node).

/** Same ENDED rule as effectiveStatus() in supabase-client.js / Quiz.effectiveStatus(): a quiz
 *  that hasn't started yet is not ended, whatever its end time says. */
function resultsQuizHasEnded(quiz, now) {
  if (quiz.startAt != null && now < quiz.startAt) return false;
  return quiz.endAt != null && now >= quiz.endAt;
}

/** Whether the quiz's results are out for everyone, before looking at any one attempt. */
function resultsReleased(quiz, now) {
  now = now ?? Date.now();
  if (quiz.showResult) return true;
  // A row from before the column existed has no mode: AUTO, like the database default.
  const auto = (quiz.resultsReleaseMode ?? "AUTO") === "AUTO";
  return (auto && resultsQuizHasEnded(quiz, now)) || quiz.resultsReleasedAt != null;
}

/** [needsMarking]: the attempt still has hand-marked answers the owner hasn't marked (none or
 *  only some). Show Score ON ignores it — that is today's partial score + banner. */
function resultsVisible(quiz, needsMarking, now) {
  if (quiz.showResult) return true;
  return resultsReleased(quiz, now) && !needsMarking;
}

/** Why results are held back, for choosing the sentence — mirrors resultsHiddenReason() in
 *  ResultsVisibility.kt. null when they are out. */
function resultsHiddenReason(quiz, now) {
  if (resultsReleased(quiz, now)) return null;
  if ((quiz.resultsReleaseMode ?? "AUTO") === "MANUAL") return "MANUAL_NOT_ANNOUNCED";
  return quiz.endAt != null ? "AUTO_WITH_END" : "AUTO_NO_END";
}

/** The largest delay setTimeout can hold: it stores the delay as a signed 32-bit number, so a
 *  longer one (about 24.8 days) overflows and fires at once — in a loop, if it re-arms. */
const RESULTS_MAX_TIMER_MS = 2147483647;

/** How long until a hidden result should be looked at again — the moment an AUTO quiz ends, with
 *  no polling in between. Null = don't schedule: results are out already, the owner announces them
 *  (MANUAL — that arrives with the next fresh read, not a clock), there is no end time, it is
 *  already past, or it is further away than a timer can hold (the screen is re-read on the next
 *  visit instead). Mirrors resultsRecheckDelayMs() in ResultsVisibility.kt, minus that one's cap —
 *  Kotlin's delay takes any Long. */
function resultsRecheckDelay(quiz, now) {
  now = now ?? Date.now();
  if (resultsReleased(quiz, now)) return null;
  if ((quiz.resultsReleaseMode ?? "AUTO") !== "AUTO") return null;
  if (quiz.endAt == null) return null;
  const delay = quiz.endAt - now;
  if (!(delay > 0) || delay > RESULTS_MAX_TIMER_MS) return null;
  return delay;
}

/** The attempt's answers include one still waiting for the owner's mark. */
function answersNeedMarking(answers) {
  return (answers || []).some((a) => a.needsManualMarking === true && a.awardedPoints == null);
}

/** Submitted from a keyless (exam-mode) copy and not graded by the server yet: an auto-graded answer
 *  with no awarded points — every answer the server grades gets a number. No score to show yet,
 *  only "Submitted". Mirrors AnswerResult.isAwaitingServerGrade in Grading.kt. */
function answersAwaitingServerGrade(answers) {
  return (answers || []).some((a) => a.needsManualMarking !== true && a.awardedPoints == null);
}

window.ResultsVisibility = {
  resultsReleased, resultsVisible, resultsHiddenReason, resultsRecheckDelay, answersNeedMarking, answersAwaitingServerGrade,
  MAX_TIMER_MS: RESULTS_MAX_TIMER_MS,
};
