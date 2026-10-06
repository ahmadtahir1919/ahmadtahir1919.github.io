// Quiz + question reads and writes against Supabase. Pure I/O: the rules (edit lock,
// share-code retries, duplicate, end-now) live in core/quizzes.js.

import { db } from "./client.js";
import { questionFromRow, questionToRow, quizFromRow, quizToRow } from "./rows.js";

export async function listQuizzes(ownerId) {
  const { data, error } = await db
    .from("quizzes")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(quizFromRow);
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

/** Question counts for many quizzes, as Map(quizId -> count). Only the quiz_id column travels. */
export async function questionCounts(quizIds) {
  const counts = new Map(quizIds.map((id) => [id, 0]));
  if (!quizIds.length) return counts;
  const { data, error } = await db.from("questions").select("quiz_id").in("quiz_id", quizIds);
  if (error) throw error;
  for (const row of data ?? []) counts.set(row.quiz_id, (counts.get(row.quiz_id) ?? 0) + 1);
  return counts;
}

/** Has anyone joined this quiz or submitted a real (non-preview) attempt? Counts only. */
export async function hasParticipants(quizId) {
  const [joined, attempts] = await Promise.all([
    db.from("joined_quizzes").select("quiz_id", { count: "exact", head: true }).eq("quiz_id", quizId),
    db
      .from("attempts")
      .select("id", { count: "exact", head: true })
      .eq("quiz_id", quizId)
      .eq("is_preview", false),
  ]);
  if (joined.error) throw joined.error;
  if (attempts.error) throw attempts.error;
  return (joined.count ?? 0) > 0 || (attempts.count ?? 0) > 0;
}

export async function shareCodeExists(code, excludeQuizId = null) {
  const args = { p_code: code };
  if (excludeQuizId) args.p_exclude_quiz_id = excludeQuizId;
  const { data, error } = await db.rpc("share_code_exists", args);
  if (error) throw error;
  return data === true;
}

/**
 * Writes the quiz and makes its questions exactly [questions], in one transaction, through the
 * save_quiz_checked RPC (the same one the app uses). [expected] is the server_updated_at the caller
 * loaded (null = a new quiz). Resolves to { ok: true, serverUpdatedAt } or { ok: false, conflict }:
 * "stale" (changed elsewhere since), "deleted" (gone elsewhere) or "has_answers" (a removed question
 * was already answered). Nothing is written when ok is false.
 */
export async function saveQuizChecked(quiz, questions, ownerId, expected) {
  const { data, error } = await db.rpc("save_quiz_checked", {
    p_quiz: quizToRow(quiz, ownerId),
    p_questions: questions.map((question) => questionToRow(question, quiz.id)),
    p_expected: expected ?? null,
  });
  if (error?.hint === "question_has_answers") return { ok: false, conflict: "has_answers" };
  if (error) throw error;
  if (data?.ok === true) return { ok: true, serverUpdatedAt: data.server_updated_at };
  return { ok: false, conflict: data?.conflict ?? "stale" };
}

/** Draft → published; a no-op on a quiz that is already published. */
export async function publishQuiz(quizId) {
  const { error } = await db.from("quizzes").update({ is_draft: false }).eq("id", quizId).eq("is_draft", true);
  if (error) throw error;
}

export async function setArchived(quizId, isArchived) {
  const { error } = await db.from("quizzes").update({ is_archived: isArchived }).eq("id", quizId);
  if (error) throw error;
}

/** Epoch millis or null for either end. */
export async function setSchedule(quizId, startAt, endAt) {
  const { error } = await db.from("quizzes").update({ start_at: startAt, end_at: endAt }).eq("id", quizId);
  if (error) throw error;
}

/**
 * The owner's Announce / Hide, through the set_results_release RPC (the same one the app calls): writes only
 * results_release_mode and results_released_at (null = not announced). Resolves to the RPC's answer —
 * false means "not the owner, or the quiz isn't on the server" and nothing was written.
 */
export async function setResultsRelease(quizId, mode, releasedAt) {
  if (mode !== "AUTO" && mode !== "MANUAL") throw new Error("unknown results release mode");
  const { data, error } = await db.rpc("set_results_release", { p_quiz_id: quizId, p_mode: mode, p_released_at: releasedAt });
  if (error) throw error;
  return data === true;
}

/** A locked quiz keeps its rules; only the title and the theme may change — nothing else is written. */
export async function saveTitleAndTheme(quizId, title, themeColorName) {
  const { error } = await db.from("quizzes").update({ title, theme_color_name: themeColorName }).eq("id", quizId);
  if (error) throw error;
}

export async function deleteQuiz(quizId) {
  const { error } = await db.from("quizzes").delete().eq("id", quizId);
  if (error) throw error;
}
