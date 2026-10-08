// Attempts, answers, participants and hand-marking for quizzes the signed-in user owns.
//
// Reads go through core/backend/; the scoring that decides what a save writes lives here.

import * as backend from "./backend/index.js";
import * as analytics from "./analytics.js";
import { GRADE_FEEDBACK_MAX_CHARS, scoreBreakdown, withAutoVerdict, withManualMark } from "./scoring.js";

export {
  attemptStats,
  gradedStats,
  loadAttempt,
  loadJoinedUsers,
  loadPollVotes,
  manualMarkingProgress,
  participantCounts,
  participantIds,
  pendingMarking,
  removeParticipant,
} from "./backend/index.js";

/** Real (non-preview) attempts on these quizzes, newest first. */
export async function loadAttemptsFor(quizIds) {
  const rows = await backend.loadAttempts(quizIds);
  return rows.sort((a, b) => (b.finished_at ?? 0) - (a.finished_at ?? 0));
}

/** Every answer row for these attempts. */
export async function loadAnswersFor(attemptIds) {
  return backend.loadAnswers(attemptIds);
}

/** Answers grouped as Map(attemptId -> rows). */
export function groupByAttempt(answers) {
  const map = new Map();
  for (const a of answers) {
    if (!map.has(a.attempt_id)) map.set(a.attempt_id, []);
    map.get(a.attempt_id).push(a);
  }
  return map;
}

/** Display names for a set of user ids, as Map(id -> name). Blank names are left out and
 *  shown as "Anonymous" in the pages, like the app. */
export async function displayNames(userIds) {
  return backend.displayNames(userIds);
}

/** Raised when save_grades returns false: the taker retook (their answer sheet changed) or
 *  you are not the owner. Nothing was written. */
export class GradesNotSavedError extends Error {
  constructor() {
    super("save_grades returned false");
    this.name = "GradesNotSavedError";
  }
}

/**
 * Saves the owner's marks for one attempt. A port of AttemptRepository.saveGrades +
 * SupabaseSyncRepository.pushGrades:
 *
 *  - re-reads the attempt and its answers first, never trusting the page's copy, then applies
 *    only what the owner touched, keyed by QUESTION id (survives a retake re-keying answer ids);
 *  - marks:            Map(questionId -> { mark, maxPoints })   mark null = clear to pending
 *  - questionFeedback: Map(questionId -> note|null)              notes the owner changed
 *  - restore:          Map(questionId -> autoVerdict)            Undo of an auto-answer override
 *  - sends a row only for hand-marked answers, owner-adjusted ones and restored ones; an
 *    untouched auto answer that only gained a note goes as feedback_only so its verdict is
 *    never re-stamped;
 *  - attempts.score = totalCorrect, total stays what it was, graded_at = now.
 *
 * Returns { attempt, answers, breakdown } as saved. Throws GradesNotSavedError on a false.
 */
export async function saveGrades(
  attemptId,
  { marks = new Map(), overallFeedback, questionFeedback = new Map(), restore = new Map() } = {}
) {
  const attempt = await backend.loadAttempt(attemptId);
  if (!attempt) throw new GradesNotSavedError();
  const current = await backend.loadAnswers([attemptId]);
  const write = buildGradeWrite(attempt, current, { marks, overallFeedback, questionFeedback, restore }, Date.now());
  const saved = await backend.saveGradesRows(write.payload);
  if (!saved) throw new GradesNotSavedError();
  analytics.track("grades_saved", { quiz_id: attempt.quizId, attempt_count: 1 });
  return write.result;
}

/**
 * saveGrades for many attempts of one quiz at once (the grading suite's save queue): one read
 * of the quiz's attempts and one of their answers, then one save_grades call per attempt —
 * each attempt's write is atomic on its own, exactly as in saveGrades.
 *
 *   entries: [{ attemptId, marks, overallFeedback, questionFeedback, restore }]
 *   notify:  false = submitted quietly, no notification (save_grades p_notify)
 *   returns: [{ attemptId, ok: true, attempt, answers } | { attemptId, ok: false, error }]
 * A false from the server comes back as error = GradesNotSavedError; a network failure as
 * the thrown error, so the caller can tell "retry later" from "this sheet changed".
 */
export async function saveGradesBatch(quizId, entries, { notify = true } = {}) {
  const ids = entries.map((e) => e.attemptId);
  const [attempts, answers] = await Promise.all([backend.loadAttempts([quizId]), backend.loadAnswers(ids)]);
  const attemptById = new Map(attempts.map((a) => [a.id, a]));
  const answersBy = groupByAttempt(answers);
  const now = Date.now();
  const results = await Promise.all(
    entries.map(async (entry) => {
      const attempt = attemptById.get(entry.attemptId);
      if (!attempt) return { attemptId: entry.attemptId, ok: false, error: new GradesNotSavedError() };
      try {
        const write = buildGradeWrite(attempt, answersBy.get(entry.attemptId) ?? [], entry, now);
        const saved = await backend.saveGradesRows({ ...write.payload, notify });
        if (!saved) return { attemptId: entry.attemptId, ok: false, error: new GradesNotSavedError() };
        return { attemptId: entry.attemptId, ok: true, ...write.result };
      } catch (error) {
        return { attemptId: entry.attemptId, ok: false, error };
      }
    })
  );
  const savedCount = results.filter((r) => r.ok).length;
  if (savedCount > 0) analytics.track("grades_saved", { quiz_id: quizId, attempt_count: savedCount });
  return results;
}

/** The save_grades payload for one attempt, from the server's current rows plus only what the
 *  owner touched (see saveGrades). Pure: no reads, no writes. */
function buildGradeWrite(attempt, current, { marks = new Map(), overallFeedback, questionFeedback = new Map(), restore = new Map() }, now) {
  const attemptId = attempt.id;
  const graded = current.map((answer) => {
    const r = restore.get(answer.question_id);
    const m = marks.get(answer.question_id);
    let next = answer;
    if (r) next = withAutoVerdict(answer, r);
    else if (m) next = withManualMark(answer, m.mark, m.maxPoints ?? answer.max_points, now);
    if (questionFeedback.has(answer.question_id)) {
      const note = String(questionFeedback.get(answer.question_id) ?? "")
        .trim()
        .slice(0, GRADE_FEEDBACK_MAX_CHARS);
      next = { ...next, feedback: note || null };
    }
    return next;
  });

  const rows = [];
  for (const answer of graded) {
    const isMarked =
      answer.needs_manual_marking === true || answer.graded_at != null || restore.has(answer.question_id);
    if (isMarked) {
      rows.push({
        id: answer.id,
        feedback_only: false,
        is_correct: answer.is_correct === true,
        awarded_points: answer.awarded_points ?? null,
        max_points: answer.max_points ?? 0,
        graded_at: answer.graded_at ?? null,
        feedback: answer.feedback ?? null,
      });
    } else if (questionFeedback.has(answer.question_id)) {
      rows.push({ id: answer.id, feedback_only: true, feedback: answer.feedback ?? null });
    }
  }

  const breakdown = scoreBreakdown(graded);
  // overallFeedback undefined = leave the stored note as it is.
  const note = overallFeedback === undefined ? attempt.overall_feedback : overallFeedback;
  return {
    payload: {
      attemptId,
      score: breakdown.totalCorrect,
      total: attempt.total,
      overallFeedback: note && String(note).trim() ? String(note).slice(0, GRADE_FEEDBACK_MAX_CHARS) : null,
      gradedAt: now,
      rows,
    },
    result: {
      attempt: { ...attempt, score: breakdown.totalCorrect, overall_feedback: note || null, graded_at: now },
      answers: graded,
      breakdown,
    },
  };
}
