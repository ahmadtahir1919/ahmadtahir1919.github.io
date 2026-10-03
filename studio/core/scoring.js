// Manual marking and score maths — a literal port of data/model/Grading.kt.
//
// Everything here is derived from the stored per-answer facts (needs_manual_marking,
// awarded_points, max_points, graded_at), exactly as the app derives it. Do not add rules
// that the Kotlin doesn't have: the web and the app read the same rows, so any extra rule
// here makes the two show different results for the same person.
//
// Answers are raw attempt_answers rows (snake_case), as returned by PostgREST.

/** Ceiling on how many marks the owner can put on one question while hand-marking.
 *  Grading.kt MAX_MANUAL_MARKS. */
export const MAX_MANUAL_MARKS = 200;

/** Longest per-question note the owner can leave. GradeSubmissionViewModel.kt. */
export const GRADE_FEEDBACK_MAX_CHARS = 500;

/** True while the owner still owes this answer a mark. Grading.kt:26. */
export function isPendingMarking(answer) {
  return answer.needs_manual_marking === true && answer.awarded_points == null;
}

/** Nothing was entered. Read it after isPendingMarking wherever both apply. Grading.kt:43. */
export function isSkipped(answer) {
  const given = answer.given_answer ?? [];
  const list = Array.isArray(given) ? given : [given];
  return list.every((item) => !String(item ?? "").trim());
}

/** An auto-graded answer whose verdict the owner overrode. graded_at is written ONLY by an
 *  owner's marking save, so a non-manual answer carrying one was touched by hand. Grading.kt:54. */
export function isOwnerAdjusted(answer) {
  return answer.needs_manual_marking !== true && answer.graded_at != null;
}

export const GRADING_STATUS = {
  NOT_REQUIRED: "NOT_REQUIRED",
  PENDING: "PENDING",
  PARTIALLY_GRADED: "PARTIALLY_GRADED",
  GRADED: "GRADED",
};

/** Grading.kt:78. */
export function gradingStatus(answers = []) {
  const manual = answers.filter((a) => a.needs_manual_marking === true);
  if (!manual.length) return GRADING_STATUS.NOT_REQUIRED;
  const marked = manual.filter((a) => a.awarded_points != null).length;
  if (marked === 0) return GRADING_STATUS.PENDING;
  if (marked === manual.length) return GRADING_STATUS.GRADED;
  return GRADING_STATUS.PARTIALLY_GRADED;
}

/** Drives the "N to mark" pills. Grading.kt:90. */
export function pendingMarkingCount(answers = []) {
  return answers.filter(isPendingMarking).length;
}

/**
 * An attempt's score, split into the two tracks the app shows separately (Grading.kt:104-165):
 * questions with points (max_points > 0) are scored as marks; questions without are plain
 * correct/wrong. totalCorrect is what attempts.score holds.
 */
export function scoreBreakdown(answers = []) {
  const marksTrack = answers.filter((a) => (a.max_points ?? 0) > 0);
  const correctnessTrack = answers.filter((a) => !((a.max_points ?? 0) > 0));
  const graded = (a) => !isPendingMarking(a);
  const right = (a) => a.is_correct === true;

  const marksAwarded = marksTrack.reduce((sum, a) => sum + (a.awarded_points ?? 0), 0);
  const marksTotal = marksTrack.reduce((sum, a) => sum + (a.max_points ?? 0), 0);
  const marksQuestionCount = marksTrack.length;
  const marksPending = marksTrack.filter(isPendingMarking).length;
  const marksCorrect = marksTrack.filter((a) => graded(a) && right(a)).length;
  const marksWrong = marksTrack.filter((a) => graded(a) && !right(a)).length;
  const correctCount = correctnessTrack.filter((a) => graded(a) && right(a)).length;
  const correctnessQuestionCount = correctnessTrack.length;
  const correctnessPending = correctnessTrack.filter(isPendingMarking).length;

  const pendingCount = marksPending + correctnessPending;
  const questionCount = marksQuestionCount + correctnessQuestionCount;
  return {
    marksAwarded,
    marksTotal,
    marksQuestionCount,
    marksPending,
    marksCorrect,
    marksWrong,
    correctCount,
    correctnessQuestionCount,
    correctnessPending,
    hasMarks: marksQuestionCount > 0,
    hasCorrectness: correctnessQuestionCount > 0,
    pendingCount,
    questionCount,
    gradedQuestionCount: questionCount - pendingCount,
    // Integer division, rounded down, like the Kotlin Int maths.
    marksPercent: marksTotal > 0 ? Math.floor((marksAwarded * 100) / marksTotal) : null,
    correctnessPercent:
      correctnessQuestionCount > 0
        ? Math.floor((correctCount * 100) / correctnessQuestionCount)
        : null,
    totalCorrect: correctCount + marksCorrect,
    totalWrong: correctnessQuestionCount - correctnessPending - correctCount + marksWrong,
  };
}

/** Per-question accuracy across many answers; pending answers are left out of both counts
 *  so an unmarked question doesn't read as a hard one. Grading.kt:176. */
export function questionStats(answers = []) {
  const byQuestion = new Map();
  for (const a of answers) {
    const stat = byQuestion.get(a.question_id) ?? {
      questionId: a.question_id,
      correctCount: 0,
      totalCount: 0,
      pendingCount: 0,
    };
    if (isPendingMarking(a)) stat.pendingCount++;
    else {
      stat.totalCount++;
      if (a.is_correct === true) stat.correctCount++;
    }
    byQuestion.set(a.question_id, stat);
  }
  return byQuestion;
}

/** The verdict an untouched auto-graded answer was given at submit time, or null if the
 *  answer is hand-marked or was already adjusted. What Undo puts back. Grading.kt:202. */
export function untouchedAutoVerdict(answer) {
  if (answer.needs_manual_marking === true || answer.graded_at != null) return null;
  return {
    is_correct: answer.is_correct === true,
    awarded_points: answer.awarded_points ?? null,
    max_points: answer.max_points ?? 0,
  };
}

/** Puts an auto verdict back and clears graded_at, so it is no longer owner-adjusted. */
export function withAutoVerdict(answer, verdict) {
  return { ...answer, ...verdict, graded_at: null };
}

/**
 * Applies one hand-entered mark (Grading.kt:228). mark is clamped into 0..maxPoints;
 * "correct" means any marks at all (> 0). For maxPoints 0 the caller passes 1 or 0.
 * null clears the mark back to pending. Marks are whole numbers — the RPC casts to int,
 * so a fractional value would fail the whole save.
 */
export function withManualMark(answer, mark, maxPoints = answer.max_points ?? 0, now = Date.now()) {
  const cappedMax = clampInt(maxPoints, 0, MAX_MANUAL_MARKS);
  if (mark === null || mark === undefined || mark === "" || Number.isNaN(Number(mark))) {
    return { ...answer, max_points: cappedMax, awarded_points: null, is_correct: false, graded_at: null };
  }
  const value = Math.round(Number(mark));
  if (cappedMax > 0) {
    const clamped = clampInt(value, 0, cappedMax);
    return { ...answer, max_points: cappedMax, awarded_points: clamped, is_correct: clamped > 0, graded_at: now };
  }
  const correct = value > 0;
  return { ...answer, max_points: 0, awarded_points: correct ? 1 : 0, is_correct: correct, graded_at: now };
}

export const VERDICT = { CORRECT: "CORRECT", PARTIAL: "PARTIAL", INCORRECT: "INCORRECT" };

/** The marks a verdict button means: full (or 1 on a no-marks question), half rounded up
 *  (only when max >= 2), or 0. Null = Partial isn't offered. GradeByQuestionViewModel.kt:131. */
export function verdictMark(verdict, maxPoints) {
  if (verdict === VERDICT.CORRECT) return maxPoints > 0 ? maxPoints : 1;
  if (verdict === VERDICT.PARTIAL) return maxPoints >= 2 ? Math.floor((maxPoints + 1) / 2) : null;
  return 0;
}

/** The verdict a mark reads as. GradeSubmissionViewModel.kt GradeItem.verdict. */
export function verdictOf(mark, maxPoints) {
  if (mark == null) return null;
  if (maxPoints <= 0) return mark > 0 ? VERDICT.CORRECT : VERDICT.INCORRECT;
  if (mark >= maxPoints) return VERDICT.CORRECT;
  if (mark <= 0) return VERDICT.INCORRECT;
  return VERDICT.PARTIAL;
}

/** The mark an answer holds now, by the rules the app's grading screens load with
 *  (GradeSubmissionViewModel.kt:262). Null = still pending. */
export function currentMark(answer) {
  if (isPendingMarking(answer)) return null;
  const max = Math.max(0, answer.max_points ?? 0);
  if (max === 0) return answer.is_correct === true ? 1 : 0;
  const raw = answer.awarded_points ?? (answer.is_correct === true ? max : 0);
  return clampInt(raw, 0, max);
}

/** A group mark applied to one member, clamped to that member's own max. */
export function memberMarkFor(mark, maxPoints) {
  if (maxPoints > 0) return clampInt(mark, 0, maxPoints);
  return mark > 0 ? 1 : 0;
}

function clampInt(value, lo, hi) {
  const n = Math.round(Number(value) || 0);
  return Math.max(lo, Math.min(n, hi));
}
