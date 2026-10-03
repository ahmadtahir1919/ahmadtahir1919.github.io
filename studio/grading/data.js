// Loading for the grading views. Batched: one query per table, never one per attempt.

import { QUESTION_TYPES } from "../core/models.js";
import { loadQuestions, loadQuiz } from "../core/quizzes.js";
import { displayNames, groupByAttempt, loadAnswersFor, loadAttempt, loadAttemptsFor } from "../core/results.js";
import { currentMark, isPendingMarking, untouchedAutoVerdict } from "../core/scoring.js";

export const TYPED = new Set([QUESTION_TYPES.WRITTEN, QUESTION_TYPES.FILL_BLANK]);

export class NotOwnerError extends Error {}

/** A quiz the signed-in user owns, with its questions in order. */
export async function loadOwnedQuiz(quizId, user) {
  const quiz = await loadQuiz(quizId);
  if (!quiz || quiz.ownerId !== user.id) throw new NotOwnerError();
  const questions = await loadQuestions(quizId);
  return { quiz, questions };
}

/** Every real attempt on a quiz, with answers and names. */
export async function loadQuizAttempts(quizId) {
  const attempts = await loadAttemptsFor([quizId]);
  const [answers, names] = await Promise.all([
    loadAnswersFor(attempts.map((a) => a.id)),
    displayNames(attempts.map((a) => a.user_id)),
  ]);
  return { attempts, answersByAttempt: groupByAttempt(answers), names };
}

/** One attempt for marking: the attempt, its quiz + questions, its answers and the name. */
export async function loadAttemptForMarking(attemptId, user) {
  const attempt = await loadAttempt(attemptId);
  if (!attempt) throw new NotOwnerError();
  const { quiz, questions } = await loadOwnedQuiz(attempt.quiz_id, user);
  const [answers, names] = await Promise.all([loadAnswersFor([attemptId]), displayNames([attempt.user_id])]);
  return { attempt, quiz, questions, answers, name: names.get(attempt.user_id) ?? null };
}

/**
 * One gradable item per scored question the person answered, in quiz order — every scored
 * question, hand-marked AND auto-graded, so the owner can override any of them
 * (GradeSubmissionViewModel.load). Polls are outside scoring.
 */
export function buildItems(questions, answers) {
  const byQuestion = new Map(answers.map((a) => [a.question_id, a]));
  const items = [];
  questions.forEach((question, index) => {
    if (question.type === QUESTION_TYPES.POLL) return;
    const answer = byQuestion.get(question.id);
    if (!answer) return;
    items.push(itemFor(question, answer, index + 1));
  });
  return items;
}

export function itemFor(question, answer, number) {
  const max = Math.max(0, answer.max_points ?? 0);
  const mark = currentMark(answer);
  const feedback = answer.feedback ?? "";
  return {
    number,
    question,
    answer,
    max,
    mark,
    savedMark: mark,
    feedback,
    savedFeedback: feedback,
    needsMarking: answer.needs_manual_marking === true,
    pending: isPendingMarking(answer),
    ownerReviewed: answer.graded_at != null,
    autoVerdict: untouchedAutoVerdict(answer),
    typed: TYPED.has(question.type),
  };
}

export const itemChanged = (item) => item.mark !== item.savedMark || item.feedback.trim() !== item.savedFeedback.trim();

/** The taker's answer as display text. given_answer is a JSON array of strings. */
export function givenList(answer) {
  const given = answer?.given_answer ?? [];
  return (Array.isArray(given) ? given : [given]).map((v) => String(v ?? ""));
}

/** GradeByQuestionViewModel.normalizeAnswerKey: join, trim, lowercase, collapse spaces. */
export function normalizeAnswerKey(given) {
  return given.join(" ").trim().toLowerCase().replace(/\s+/g, " ");
}
