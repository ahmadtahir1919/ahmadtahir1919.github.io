// The rows the take page's preview reads (/take/?preview=1): the very rows saveQuiz would write, built by the
// same mappers. Lives in the adapter so nothing outside core/backend/ imports its row format.

import { questionToRow, quizToRow } from "./rows.js";

export function previewQuizRow(quiz, ownerId) {
  return quizToRow(quiz, ownerId);
}

export function previewQuestionRow(question, quizId) {
  return questionToRow(question, quizId);
}
