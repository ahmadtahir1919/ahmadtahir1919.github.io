// Attempts, answers, participants, poll votes and the grade write, against Supabase.
//
// Every list read is batched with .in() in chunks — never one request per attempt — the
// same way SupabaseSyncRepository.kt reads them. RLS limits every row to the quiz owner.
// Rows come back as the tables store them (snake_case); that IS the contract for these
// shapes — see core/backend/contract.js.

import { db } from "./client.js";

/** Ids per .in() filter: keeps the request URL short. Same idea as IN_FILTER_CHUNK. */
const IN_CHUNK = 100;

function chunks(list, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function selectIn(table, column, ids, build = (q) => q, columns = "*") {
  if (!ids.length) return [];
  const parts = await Promise.all(
    chunks([...new Set(ids)]).map(async (chunk) => {
      const { data, error } = await build(db.from(table).select(columns).in(column, chunk));
      if (error) throw error;
      return data ?? [];
    })
  );
  return parts.flat();
}

/** Real (non-preview) attempts on these quizzes, in no particular order. */
export async function loadAttempts(quizIds) {
  return selectIn("attempts", "quiz_id", quizIds, (q) => q.eq("is_preview", false));
}

export async function loadAnswers(attemptIds) {
  return selectIn("attempt_answers", "attempt_id", attemptIds);
}

export async function loadAttempt(attemptId) {
  const { data, error } = await db.from("attempts").select("*").eq("id", attemptId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Readable by the owner via joined_quizzes_select_quiz_owner. */
export async function loadJoinedUsers(quizId) {
  const { data, error } = await db.from("joined_quizzes").select("*").eq("quiz_id", quizId);
  if (error) throw error;
  return data ?? [];
}

/** Map(quizId -> real attempt count). fetchParticipantCounts. */
export async function participantCounts(quizIds) {
  const rows = await selectIn("attempts", "quiz_id", quizIds, (q) => q.eq("is_preview", false), "quiz_id");
  const counts = new Map();
  for (const row of rows) counts.set(row.quiz_id, (counts.get(row.quiz_id) ?? 0) + 1);
  return counts;
}

/** Map(quizId -> { submitted, avgPct }) over real attempts: avgPct is the mean of score/total
 *  as a whole percent, or null when no attempt has a total to divide by. */
export async function attemptStats(quizIds) {
  const rows = await selectIn("attempts", "quiz_id", quizIds, (q) => q.eq("is_preview", false), "quiz_id,score,total");
  const acc = new Map();
  for (const row of rows) {
    const entry = acc.get(row.quiz_id) ?? { submitted: 0, pctSum: 0, scored: 0 };
    entry.submitted++;
    if (row.total > 0) {
      entry.pctSum += (row.score / row.total) * 100;
      entry.scored++;
    }
    acc.set(row.quiz_id, entry);
  }
  const stats = new Map();
  for (const [id, e] of acc) stats.set(id, { submitted: e.submitted, avgPct: e.scored ? Math.round(e.pctSum / e.scored) : null });
  return stats;
}

/** { total, pending } hand-marked answers on one quiz. */
export async function manualMarkingProgress(quizId) {
  const attempts = await selectIn("attempts", "quiz_id", [quizId], (q) => q.eq("is_preview", false), "id");
  const rows = await selectIn(
    "attempt_answers",
    "attempt_id",
    attempts.map((a) => a.id),
    (q) => q.eq("needs_manual_marking", true),
    "awarded_points"
  );
  return { total: rows.length, pending: rows.filter((r) => r.awarded_points == null).length };
}

/** Map(quizId -> { answers, questionIds:Set }) for answers still waiting on the owner.
 *  fetchPendingMarking: only ids and a few small columns travel, filtered on the server. */
export async function pendingMarking(quizIds) {
  const attempts = await selectIn("attempts", "quiz_id", quizIds, (q) => q.eq("is_preview", false), "id,quiz_id");
  if (!attempts.length) return new Map();
  const quizByAttempt = new Map(attempts.map((a) => [a.id, a.quiz_id]));
  const pending = await selectIn(
    "attempt_answers",
    "attempt_id",
    attempts.map((a) => a.id),
    (q) => q.eq("needs_manual_marking", true).is("awarded_points", null),
    "attempt_id,question_id"
  );
  const result = new Map();
  for (const row of pending) {
    const quizId = quizByAttempt.get(row.attempt_id);
    if (!quizId) continue;
    const entry = result.get(quizId) ?? { answers: 0, questionIds: new Set() };
    entry.answers++;
    entry.questionIds.add(row.question_id);
    result.set(quizId, entry);
  }
  return result;
}

/** Everyone who joined or submitted a real attempt on these quizzes, each id once. */
export async function participantIds(quizIds) {
  const [joined, attempts] = await Promise.all([
    selectIn("joined_quizzes", "quiz_id", quizIds, (q) => q, "user_id,quiz_id"),
    selectIn("attempts", "quiz_id", quizIds, (q) => q.eq("is_preview", false), "user_id,quiz_id"),
  ]);
  const byQuiz = new Map();
  for (const row of [...joined, ...attempts]) {
    if (!row.user_id) continue;
    if (!byQuiz.has(row.quiz_id)) byQuiz.set(row.quiz_id, new Set());
    byQuiz.get(row.quiz_id).add(row.user_id);
  }
  return byQuiz;
}

/** { graded, avgPct } over real attempts that are fully marked and have a total: the mean of
 *  score/total as a whole percent, or null when there are none. Attempts with an answer still
 *  waiting for a mark are left out, so an unmarked answer never reads as wrong; poll-only
 *  attempts (total 0) are left out too. */
export async function gradedStats(quizIds) {
  const attempts = await selectIn("attempts", "quiz_id", quizIds, (q) => q.eq("is_preview", false), "id,score,total");
  const scored = attempts.filter((a) => a.total > 0);
  const waiting = await selectIn(
    "attempt_answers",
    "attempt_id",
    scored.map((a) => a.id),
    (q) => q.eq("needs_manual_marking", true).is("awarded_points", null),
    "attempt_id"
  );
  const unfinished = new Set(waiting.map((row) => row.attempt_id));
  const graded = scored.filter((a) => !unfinished.has(a.id));
  if (!graded.length) return { graded: 0, avgPct: null };
  const sum = graded.reduce((acc, a) => acc + (a.score / a.total) * 100, 0);
  return { graded: graded.length, avgPct: Math.round(sum / graded.length) };
}

/** Map(id -> name) for the ids that have a non-blank name. profiles isn't directly readable
 *  for other people, so this goes through get_display_names. */
export async function displayNames(userIds) {
  const names = new Map();
  const unique = [...new Set(userIds)].filter(Boolean);
  if (!unique.length) return names;
  const { data, error } = await db.rpc("get_display_names", { p_user_ids: unique });
  if (error) throw error;
  for (const row of data ?? []) if (row.display_name?.trim()) names.set(row.id, row.display_name);
  return names;
}

/** One atomic write of an attempt's marks (save_grades RPC). Returns false when the server
 *  refused — the taker retook, or the caller isn't the owner — and nothing was written. */
export async function saveGradesRows({ attemptId, score, total, overallFeedback, gradedAt, rows, notify = true }) {
  const { data, error } = await db.rpc("save_grades", {
    p_attempt_id: attemptId,
    p_score: score,
    p_total: total,
    p_overall_feedback: overallFeedback,
    p_graded_at: gradedAt,
    p_answers: rows,
    p_notify: notify,
  });
  if (error) throw error;
  return data === true;
}

/** Deletes their attempt and their membership. The server refuses the owner's own row. */
export async function removeParticipant(quizId, userId) {
  const { error } = await db.rpc("remove_participant", { p_quiz_id: quizId, p_user_id: userId });
  if (error) throw error;
}

/** Map(questionId -> [vote]). If RLS hides them, the page just shows no tallies. */
export async function loadPollVotes(questionIds) {
  const rows = await selectIn("poll_votes", "question_id", questionIds);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.question_id)) map.set(row.question_id, []);
    map.get(row.question_id).push(row);
  }
  return map;
}
