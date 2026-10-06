// The Question Bank: a personal library of reusable questions that belong to no quiz. A port of
// the app's data/repository/QuestionBankRepository.kt and the rules in
// ui/bank/QuestionBankViewModel.kt, against the same bank_questions table — so an entry saved
// here shows up in the app after its next sync, and the other way round.
//
// A bank entry and a quiz question are never the same row: copying one into a quiz writes a
// fresh id, so editing or deleting either one afterwards leaves the other untouched.
//
// Reads and writes live here and go through core/backend/; the pure rules are in
// ./bank-rules.js (re-exported below, so pages import everything from this one file).

import * as backend from "./backend/index.js";
import { asEntry, copyForQuiz, orderQuestions } from "./bank-rules.js";
import { newId, newQuiz } from "./models.js";
import { generateUniqueShareCode, isLockedForEditing, listMyQuizzes, loadQuestions, loadQuiz, questionCounts, saveQuiz } from "./quizzes.js";
import { QUIZ_STATUS, quizCardStatus } from "./status.js";

export * from "./bank-rules.js";

/** Why a quiz can't take a question right now (QuizIneligibility). null = it can. */
export const INELIGIBLE = { ARCHIVED: "ARCHIVED", LOCKED: "LOCKED", AT_CAP: "AT_CAP" };

// ── Reads ───────────────────────────────────────────────────────────────────

/** The user's bank, newest first. */
export async function listMyBank(userId) {
  return backend.listBank(userId);
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Creates or updates one entry (QuestionBankRepository.save). The cap applies to creation
 * only — an edit is never blocked, however full the bank is — and an edit keeps its createdAt,
 * so it holds its place in the newest-first list. Returns { saved: true } or { atCap: limit }.
 */
export async function saveBankQuestion(userId, question, limits) {
  const existing = await backend.loadBankQuestion(question.id);
  if (!existing && (await backend.countBank(userId)) >= limits.maxBankQuestions) {
    return { atCap: limits.maxBankQuestions };
  }
  const now = Date.now();
  await backend.upsertBankQuestions(userId, [asEntry(question, existing?.createdAt ?? now, now)]);
  return { saved: true };
}

/**
 * Bulk save — file import, "import from quizzes", "save quiz questions to bank". All or
 * nothing against the cap. Every question gets a fresh id (reusing a quiz question's id would
 * make a second save overwrite the first and leave a bank entry sharing an id with a live quiz
 * question), and createdAt is spread by index exactly like QuestionBankRepository.saveAll: the
 * batch's last question is the newest, on top under the newest-first sort — so a batch saved here
 * and one saved on the phone line up the same way. Returns { saved: count } or { atCap: limit }.
 */
export async function saveAllToBank(userId, questions, limits) {
  if (!questions.length) return { saved: 0 };
  if ((await backend.countBank(userId)) + questions.length > limits.maxBankQuestions) {
    return { atCap: limits.maxBankQuestions };
  }
  const now = Date.now();
  const entries = questions.map((q, i) => asEntry({ ...q, id: newId() }, now + i, now + i));
  await backend.upsertBankQuestions(userId, entries);
  return { saved: entries.length };
}

export async function deleteFromBank(ids) {
  return backend.deleteBankQuestions(ids);
}

// ── Into a quiz ─────────────────────────────────────────────────────────────

/**
 * Every quiz this account owns as a row for the Add-to-Quiz picker, each with the reason it
 * can't take a question, if any. Ended quizzes are over and left out entirely. The lock check
 * is a network call per published quiz, so they run together — and it fails open, like every
 * other use of it (a dimmed row is re-checked on insert anyway).
 *
 * Row: { quiz, status, questionCount, cap, ineligible: INELIGIBLE.*|null }
 */
export async function selectableQuizzes(userId, limits) {
  const quizzes = (await listMyQuizzes(userId)).filter((quiz) => quizCardStatus(quiz, false) !== QUIZ_STATUS.ENDED);
  const counts = await questionCounts(quizzes.map((q) => q.id));
  const cap = limits.maxQuestions;
  return Promise.all(
    quizzes.map(async (quiz) => {
      const questionCount = counts.get(quiz.id) ?? 0;
      let ineligible = null;
      if (quiz.isArchived) ineligible = INELIGIBLE.ARCHIVED;
      else if (await isLockedForEditing(quiz).catch(() => false)) ineligible = INELIGIBLE.LOCKED;
      else if (questionCount >= cap) ineligible = INELIGIBLE.AT_CAP;
      return { quiz, status: quizCardStatus(quiz, false), questionCount, cap, ineligible };
    })
  );
}

/**
 * Copies one bank entry into [quizId] under [questionId], saving the quiz with [orderedIds]
 * as its final order (insertIntoQuiz). Every condition is re-checked right before the write —
 * the picker may have sat open while someone joined or the quiz was archived elsewhere.
 * orderedIds null = append at the end. Returns { ok: true, quiz } or { ineligible }.
 */
export async function insertIntoQuiz({ userId, entry, quizId, questionId, orderedIds, limits }) {
  const quiz = await loadQuiz(quizId);
  // Gone or not ours: "locked" is the closest honest thing to say — it can't be written to.
  if (!quiz || quiz.ownerId !== userId) return { ineligible: INELIGIBLE.LOCKED };
  if (quiz.isArchived) return { ineligible: INELIGIBLE.ARCHIVED };
  const questions = await loadQuestions(quizId);
  if (questions.length >= limits.maxQuestions) return { ineligible: INELIGIBLE.AT_CAP };
  if (await isLockedForEditing(quiz)) return { ineligible: INELIGIBLE.LOCKED };

  const copy = copyForQuiz(entry, quizId, { id: questionId });
  const ordered = orderQuestions([...questions, copy], orderedIds ?? [...questions.map((q) => q.id), copy.id]);
  await saveQuiz(quiz, ordered, userId, { checkLock: false });
  return { ok: true, quiz };
}

/**
 * Bulk "Add to Quiz": appends each entry to the end of the quiz in selection order, one at a
 * time, re-checking before every insert exactly as one-by-one "Use in Quiz" would — so a quiz
 * that fills up halfway stops there. onProgress(n) after each landed insert.
 * Returns { added, ineligible: INELIGIBLE.*|null, quiz }.
 */
export async function appendManyToQuiz({ userId, entries, quizId, limits, onProgress }) {
  let added = 0;
  let quiz = null;
  for (const entry of entries) {
    const result = await insertIntoQuiz({ userId, entry, quizId, questionId: newId(), orderedIds: null, limits });
    if (!result.ok) return { added, ineligible: result.ineligible, quiz };
    quiz = result.quiz;
    added++;
    onProgress?.(added);
  }
  return { added, ineligible: null, quiz };
}

/**
 * "Create New Quiz" from the Add-to-Quiz picker (createQuizFromBank): a brand-new untitled
 * draft with the same defaults as any new quiz, the entries attached in order, saved once.
 * Returns { ok: true, quiz } | { disabled: true } | { quizLimit: n } | { atCap: n }.
 */
export async function createQuizFromBank({ userId, entries, limits }) {
  if (!limits.createQuizEnabled) return { disabled: true };
  // Selecting in the bank is unlimited, but a quiz holds at most the per-quiz cap.
  if (entries.length > limits.maxQuestions) return { atCap: limits.maxQuestions };
  if ((await listMyQuizzes(userId)).length >= limits.maxQuizzes) return { quizLimit: limits.maxQuizzes };
  const quiz = { ...newQuiz(), ownerId: userId };
  quiz.shareCode = await generateUniqueShareCode(quiz.id);
  const questions = entries.map((entry, index) => copyForQuiz(entry, quiz.id, { orderIndex: index }));
  await saveQuiz(quiz, questions, userId, { checkLock: false });
  return { ok: true, quiz };
}
