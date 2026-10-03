// Quiz + question reads and writes for the creator pages. Ports the write paths of
// data/repository/QuizRepository.kt and data/sync/SupabaseSyncRepository.kt.

import { db } from "./supabase.js";
import {
  newId,
  questionFromRow,
  questionToRow,
  quizFromRow,
  quizToRow,
  randomShareCode,
} from "./models.js";

/** The signed-in user's own quizzes, newest first. */
export async function listMyQuizzes(userId) {
  const { data, error } = await db
    .from("quizzes")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(quizFromRow);
}

/** Questions for many quizzes in one query, as Map(quizId -> [question]) in order. */
export async function questionsFor(quizIds) {
  const byQuiz = new Map(quizIds.map((id) => [id, []]));
  if (!quizIds.length) return byQuiz;
  const { data, error } = await db
    .from("questions")
    .select("*")
    .in("quiz_id", quizIds)
    .order("order_index", { ascending: true });
  if (error) throw error;
  for (const row of data ?? []) byQuiz.get(row.quiz_id)?.push(questionFromRow(row));
  return byQuiz;
}

export async function loadQuiz(quizId) {
  const { data, error } = await db.from("quizzes").select("*").eq("id", quizId).maybeSingle();
  if (error) throw error;
  return data ? quizFromRow(data) : null;
}

export async function loadQuestions(quizId) {
  const { data, error } = await db
    .from("questions")
    .select("*")
    .eq("quiz_id", quizId)
    .order("order_index", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(questionFromRow);
}

/** A published quiz can't change once anyone has joined or taken it (QuizRepository.kt:868):
 *  results already given would otherwise be graded against different questions. Drafts are
 *  never locked. The owner's own preview runs don't count. */
export async function isLockedForEditing(quiz) {
  if (!quiz || quiz.isDraft) return false;
  const [joined, attempts] = await Promise.all([
    db.from("joined_quizzes").select("quiz_id", { count: "exact", head: true }).eq("quiz_id", quiz.id),
    db
      .from("attempts")
      .select("id", { count: "exact", head: true })
      .eq("quiz_id", quiz.id)
      .eq("is_preview", false),
  ]);
  if (joined.error) throw joined.error;
  if (attempts.error) throw attempts.error;
  return (joined.count ?? 0) > 0 || (attempts.count ?? 0) > 0;
}

/** A share code nobody else is using. */
export async function generateUniqueShareCode(excludeQuizId = null) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomShareCode();
    const args = { p_code: code };
    if (excludeQuizId) args.p_exclude_quiz_id = excludeQuizId;
    const { data, error } = await db.rpc("share_code_exists", args);
    if (error) throw error;
    if (data !== true) return code;
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

/** Writes a quiz and its questions. Questions removed in the editor are deleted FIRST:
 *  questions_insert_owner counts existing rows against the per-quiz cap, so at the cap
 *  "delete one, add one" would otherwise be rejected (SupabaseSyncRepository.kt:161-188).
 *  Re-checks the edit lock on the server copy right before writing. */
export async function saveQuiz(quiz, questions, ownerId, { checkLock = true } = {}) {
  if (checkLock) {
    const stored = await loadQuiz(quiz.id);
    if (stored && (await isLockedForEditing(stored))) throw new QuizLockedError();
  }

  const { error: quizError } = await db.from("quizzes").upsert(quizToRow(quiz, ownerId));
  if (quizError) throw quizError;

  const rows = questions.map((question, index) => questionToRow({ ...question, orderIndex: index }, quiz.id));

  const keepIds = rows.map((row) => row.id);
  let deleteQuery = db.from("questions").delete().eq("quiz_id", quiz.id);
  if (keepIds.length) deleteQuery = deleteQuery.not("id", "in", `(${keepIds.join(",")})`);
  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw deleteError;

  if (rows.length) {
    const { error: questionError } = await db.from("questions").upsert(rows);
    if (questionError) throw questionError;
  }
}

/** Draft → published only. Once published a quiz never goes back to draft — its share code
 *  would stop working for everyone who already joined (HomeViewModel.kt:1252). */
export async function publishQuiz(quizId) {
  const { error } = await db.from("quizzes").update({ is_draft: false }).eq("id", quizId).eq("is_draft", true);
  if (error) throw error;
}

/** Archive hides a quiz from the main list; the share code keeps working either way. */
export async function setArchived(quizId, isArchived) {
  const { error } = await db.from("quizzes").update({ is_archived: isArchived }).eq("id", quizId);
  if (error) throw error;
}

/** Closes a quiz right now (QuizRepository.endQuizNow): end_at = now, and a start time still
 *  in the future is cleared so the quiz doesn't stay "Scheduled". */
export async function endQuizNow(quiz) {
  const now = Date.now();
  const startAt = quiz.startAt != null && quiz.startAt <= now ? quiz.startAt : null;
  const { error } = await db.from("quizzes").update({ start_at: startAt, end_at: now }).eq("id", quiz.id);
  if (error) throw error;
  return { ...quiz, startAt, endAt: now };
}

export async function deleteQuiz(quizId) {
  const { error } = await db.from("quizzes").delete().eq("id", quizId);
  if (error) throw error;
}

/** QuizRepository.duplicateQuiz: a fresh draft with a new id and share code, " (Copy)" fitted
 *  inside the title cap, not archived, and no schedule. Questions get new ids. */
export async function duplicateQuiz(quizId, ownerId, { suffix, maxTitleChars }) {
  const original = await loadQuiz(quizId);
  if (!original) throw new Error("not found");
  const questions = await loadQuestions(quizId);
  const base = (original.title ?? "").slice(0, Math.max(0, maxTitleChars - suffix.length));
  const copy = {
    ...original,
    id: newId(),
    ownerId,
    title: `${base}${suffix}`,
    shareCode: await generateUniqueShareCode(),
    isDraft: true,
    isArchived: false,
    startAt: null,
    endAt: null,
    createdAt: Date.now(),
  };
  const copiedQuestions = questions.map((question) => ({ ...question, id: newId() }));
  await saveQuiz(copy, copiedQuestions, ownerId, { checkLock: false });
  return copy;
}

/** Question counts for many quizzes, as Map(quizId -> count). Only the quiz_id column travels. */
export async function questionCounts(quizIds) {
  const counts = new Map(quizIds.map((id) => [id, 0]));
  if (!quizIds.length) return counts;
  const { data, error } = await db.from("questions").select("quiz_id").in("quiz_id", quizIds);
  if (error) throw error;
  for (const row of data ?? []) counts.set(row.quiz_id, (counts.get(row.quiz_id) ?? 0) + 1);
  return counts;
}
