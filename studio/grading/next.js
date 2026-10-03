// "Next person": the newest other attempt in the same quiz that still has answers to mark.

import { groupByAttempt, loadAnswersFor, loadAttemptsFor } from "../core/results.js";
import { pendingMarkingCount } from "../core/scoring.js";

export async function nextAttemptToMark(quizId, excludeAttemptId) {
  const attempts = (await loadAttemptsFor([quizId])).filter((a) => a.id !== excludeAttemptId);
  if (!attempts.length) return null;
  const byAttempt = groupByAttempt(await loadAnswersFor(attempts.map((a) => a.id)));
  return attempts.find((a) => pendingMarkingCount(byAttempt.get(a.id) ?? []) > 0)?.id ?? null;
}
