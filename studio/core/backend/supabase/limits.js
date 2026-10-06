// The caller's effective caps: my_limits RPC (schema.sql:384), one row of max_* columns
// plus the admin kill switches. Missing columns come back null; core/limits.js fills them.

import { db } from "./client.js";

export async function loadLimits() {
  const { data, error } = await db.rpc("my_limits");
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return null;
  return {
    maxQuizzes: row.max_quizzes_per_user,
    maxQuestions: row.max_questions_per_quiz,
    maxOptions: row.max_options_per_question,
    maxFillBlanks: row.max_fill_blanks_per_question,
    maxFillBlankAnswers: row.max_fill_blank_answers_per_blank,
    maxQuizTitleChars: row.max_quiz_title_chars,
    maxQuestionTextChars: row.max_question_text_chars,
    maxHintChars: row.max_hint_chars,
    maxReasonChars: row.max_reason_chars,
    maxOptionTextChars: row.max_option_text_chars,
    maxAnswerTextChars: row.max_answer_text_chars,
    maxBankQuestions: row.max_bank_questions_per_user,
    maxFreeTextChars: row.max_free_text_chars,
    createQuizEnabled: row.create_quiz_enabled,
  };
}
