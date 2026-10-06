// Quiz + question reads and writes for the creator pages. Ports the write paths of
// data/repository/QuizRepository.kt and data/sync/SupabaseSyncRepository.kt.
//
// The rules live here; every read and write goes through core/backend/.

import * as backend from "./backend/index.js";
import { newId, randomShareCode } from "./models.js";
import { duplicateDraft } from "./release.js";

export { loadQuiz, loadQuestions, questionsFor, questionCounts, deleteQuiz } from "./backend/index.js";

/** The signed-in user's own quizzes, newest first. */
export async function listMyQuizzes(userId) {
  return backend.listQuizzes(userId);
}

/** A published quiz can't change once anyone has joined or taken it (QuizRepository.kt:868):
 *  results already given would otherwise be graded against different questions. Drafts are
 *  never locked. The owner's own preview runs don't count. */
export async function isLockedForEditing(quiz) {
  if (!quiz || quiz.isDraft) return false;
  return backend.hasParticipants(quiz.id);
}

/** A share code nobody else is using. */
export async function generateUniqueShareCode(excludeQuizId = null) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomShareCode();
    if (!(await backend.shareCodeExists(code, excludeQuizId))) return code;
  }
  throw new Error("share_code_exists kept reporting collisions");
}

/** Raised when a save is refused because people have taken the quiz since it was opened. */
export class QuizLockedError extends Error {
  constructor() {
    super("quiz is locked for editing");
    this.name = "QuizLockedError";
  }
}

/** Writes a quiz and its questions, in editor order. Re-checks the edit lock on the server
 *  copy right before writing. */
export async function saveQuiz(quiz, questions, ownerId, { checkLock = true } = {}) {
  if (checkLock) {
    const stored = await backend.loadQuiz(quiz.id);
    if (stored && (await isLockedForEditing(stored))) throw new QuizLockedError();
  }

  await backend.upsertQuiz(quiz, ownerId);
  await backend.replaceQuestions(
    quiz.id,
    questions.map((question, index) => ({ ...question, orderIndex: index }))
  );
}

/** Draft → published only. Once published a quiz never goes back to draft — its share code
 *  would stop working for everyone who already joined (HomeViewModel.kt:1252). */
export async function publishQuiz(quizId) {
  return backend.publishQuiz(quizId);
}

/** Archive hides a quiz from the main list; the share code keeps working either way. */
export async function setArchived(quizId, isArchived) {
  return backend.setArchived(quizId, isArchived);
}

/** Closes a quiz right now (QuizRepository.endQuizNow): end_at = now, and a start time still
 *  in the future is cleared so the quiz doesn't stay "Scheduled". */
export async function endQuizNow(quiz) {
  const now = Date.now();
  const startAt = quiz.startAt != null && quiz.startAt <= now ? quiz.startAt : null;
  await backend.setSchedule(quiz.id, startAt, now);
  return { ...quiz, startAt, endAt: now };
}

/** The owner's Announce / Hide (set_results_release). false = refused; nothing was written. */
export async function setResultsRelease(quizId, mode, releasedAt) {
  return backend.setResultsRelease(quizId, mode, releasedAt);
}

/** QuizRepository.duplicateQuiz: a fresh draft with a new id and share code, " (Copy)" fitted
 *  inside the title cap, not archived, and no schedule. Questions get new ids. The results-release MODE is
 *  copied, the announcement never is (core/release.js). */
export async function duplicateQuiz(quizId, ownerId, { suffix, maxTitleChars }) {
  const original = await backend.loadQuiz(quizId);
  if (!original) throw new Error("not found");
  const questions = await backend.loadQuestions(quizId);
  const base = (original.title ?? "").slice(0, Math.max(0, maxTitleChars - suffix.length));
  const copy = duplicateDraft(original, {
    id: newId(),
    ownerId,
    title: `${base}${suffix}`,
    shareCode: await generateUniqueShareCode(),
    createdAt: Date.now(),
  });
  const copiedQuestions = questions.map((question) => ({ ...question, id: newId() }));
  await saveQuiz(copy, copiedQuestions, ownerId, { checkLock: false });
  return copy;
}
