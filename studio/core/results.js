// Attempts, answers, participants and hand-marking for quizzes the signed-in user owns.
//
// Every list read is batched with .in() in chunks — never one request per attempt — the
// same way SupabaseSyncRepository.kt reads them. RLS limits every row to the quiz owner.

import { db } from "./supabase.js";
import { GRADE_FEEDBACK_MAX_CHARS, scoreBreakdown, withAutoVerdict, withManualMark } from "./scoring.js";

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

/** Real (non-preview) attempts on these quizzes, newest first. */
export async function loadAttemptsFor(quizIds) {
  const rows = await selectIn("attempts", "quiz_id", quizIds, (q) => q.eq("is_preview", false));
  return rows.sort((a, b) => (b.finished_at ?? 0) - (a.finished_at ?? 0));
}

/** Every answer row for these attempts. */
export async function loadAnswersFor(attemptIds) {
  return selectIn("attempt_answers", "attempt_id", attemptIds);
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

export async function loadAttempt(attemptId) {
  const { data, error } = await db.from("attempts").select("*").eq("id", attemptId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Everyone who joined this quiz by share code, including people who never submitted.
 *  Readable by the owner via joined_quizzes_select_quiz_owner. */
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

/** Display names for a set of user ids, as Map(id -> name). profiles isn't directly
 *  readable for other people, so this goes through get_display_names. Blank names come back
 *  as "Anonymous" in the pages, like the app. */
export async function displayNames(userIds) {
  const names = new Map();
  const unique = [...new Set(userIds)].filter(Boolean);
  if (!unique.length) return names;
  const { data, error } = await db.rpc("get_display_names", { p_user_ids: unique });
  if (error) throw error;
  for (const row of data ?? []) if (row.display_name?.trim()) names.set(row.id, row.display_name);
  return names;
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
  const attempt = await loadAttempt(attemptId);
  if (!attempt) throw new GradesNotSavedError();
  const current = await loadAnswersFor([attemptId]);
  const now = Date.now();

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
  const { data, error } = await db.rpc("save_grades", {
    p_attempt_id: attemptId,
    p_score: breakdown.totalCorrect,
    p_total: attempt.total,
    p_overall_feedback: note && String(note).trim() ? String(note).slice(0, GRADE_FEEDBACK_MAX_CHARS) : null,
    p_graded_at: now,
    p_answers: rows,
  });
  if (error) throw error;
  if (data !== true) throw new GradesNotSavedError();

  return {
    attempt: { ...attempt, score: breakdown.totalCorrect, overall_feedback: note || null, graded_at: now },
    answers: graded,
    breakdown,
  };
}

/** Removes someone from a quiz: deletes their attempt and their membership. The server
 *  refuses the owner's own row. */
export async function removeParticipant(quizId, userId) {
  const { error } = await db.rpc("remove_participant", { p_quiz_id: quizId, p_user_id: userId });
  if (error) throw error;
}

/** Poll votes for these questions, as Map(questionId -> [vote]). The owner can read votes on
 *  their own quiz's polls; if RLS hides them, the page just shows no tallies. */
export async function loadPollVotes(questionIds) {
  const rows = await selectIn("poll_votes", "question_id", questionIds);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.question_id)) map.set(row.question_id, []);
    map.get(row.question_id).push(row);
  }
  return map;
}
