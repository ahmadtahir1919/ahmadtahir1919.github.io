// Quiz and question rows <-> the camelCase models in core/models.js.
//
// snake_case on the wire, camelCase in the pages. Kept in one place so a column rename has
// exactly one site to update. The columns are supabase/schema.sql's quizzes and questions.

import { DEFAULT_PREVIEW_SEC, QUESTION_TYPES, QUIZ_THEMES, normalizePreviewSec } from "../../models.js";

export function quizFromRow(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    groupName: row.group_name ?? "",
    shareCode: row.share_code,
    defaultTimeSec: row.default_time_sec,
    isDraft: row.is_draft === true,
    isArchived: row.is_archived === true,
    sortOrder: row.sort_order,
    allowRetake: row.allow_retake === true,
    allowBack: row.allow_back === true,
    showResult: row.show_result !== false,
    showAnswers: row.show_answers !== false,
    themeColorName: row.theme_color_name || QUIZ_THEMES[0].name,
    createdAt: row.created_at,
    startAt: row.start_at ?? null,
    endAt: row.end_at ?? null,
    manualMarkingDefault: row.manual_marking_default === true,
    showCorrectnessInstantly: row.show_correctness_instantly === true,
    showQuestionNumbers: row.show_question_numbers !== false,
    showTimers: row.show_timers !== false,
    splitPointsAcrossChoices: row.split_points_across_choices === true,
    timeWeightageEnabled: row.time_weightage_enabled === true,
    questionPreviewSec: normalizePreviewSec(row.question_preview_sec ?? DEFAULT_PREVIEW_SEC),
    // When students see their result while Show Score is off (Quiz.resultsReleaseMode / resultsReleasedAt
    // in the app). The mode is also written by quizToRow; the announcement never is, so a Studio save
    // cannot undo one — the app (its RPC) is the only writer of results_released_at.
    resultsReleaseMode: row.results_release_mode === "MANUAL" ? "MANUAL" : "AUTO",
    resultsReleasedAt: row.results_released_at ?? null,
  };
}

// results_release_mode IS written (like the app's pushQuiz: it is a rule saved with the quiz); results_released_at
// is deliberately NOT — an announcement is state, written only by the app's set_results_release RPC, so a Studio
// save can never undo one. An unknown or missing mode is written as AUTO, the column's default.
export function quizToRow(quiz, ownerId) {
  return {
    id: quiz.id,
    owner_id: ownerId,
    title: (quiz.title ?? "").trim(),
    group_name: (quiz.groupName ?? "").trim(),
    share_code: quiz.shareCode,
    default_time_sec: quiz.defaultTimeSec,
    is_draft: quiz.isDraft,
    is_archived: quiz.isArchived,
    sort_order: quiz.sortOrder,
    allow_retake: quiz.allowRetake,
    allow_back: quiz.allowBack,
    show_result: quiz.showResult,
    // Merged into Show score & result in the app (QuizDraftFactory.kt:131).
    show_answers: quiz.showResult,
    theme_color_name: quiz.themeColorName || QUIZ_THEMES[0].name,
    created_at: quiz.createdAt,
    start_at: quiz.startAt,
    end_at: quiz.endAt,
    manual_marking_default: quiz.manualMarkingDefault,
    // Forced off with manual marking (CreateQuizViewModel.kt:244-257) — enforced on write too,
    // so a stale value can never ride along.
    show_correctness_instantly: quiz.manualMarkingDefault ? false : quiz.showCorrectnessInstantly,
    show_question_numbers: quiz.showQuestionNumbers,
    show_timers: quiz.showTimers,
    split_points_across_choices: quiz.manualMarkingDefault ? false : quiz.splitPointsAcrossChoices,
    time_weightage_enabled: quiz.manualMarkingDefault ? false : quiz.timeWeightageEnabled,
    question_preview_sec: normalizePreviewSec(quiz.questionPreviewSec),
    results_release_mode: quiz.resultsReleaseMode === "MANUAL" ? "MANUAL" : "AUTO",
  };
}

export function questionFromRow(row) {
  return {
    id: row.id,
    quizId: row.quiz_id,
    type: row.type,
    text: row.text,
    options: row.options ?? null,
    correct: row.correct ?? null,
    writtenAnswer: row.written_answer ?? null,
    timeSec: row.time_sec,
    points: row.points,
    orderIndex: row.order_index,
    hint: row.hint ?? null,
    reason: row.reason ?? null,
    answerRule: row.answer_rule ?? null,
    pollSettings: row.poll_settings ?? null,
    fillBlank: row.fill_blank ?? null,
    acceptAnyCorrect: row.accept_any_correct === true,
    rapidBonus: row.rapid_bonus ?? null,
  };
}

/** A bank_questions row: the same content columns as questions, but owned by user_id and
 *  belonging to no quiz — no quiz_id, order_index or rapid_bonus (EntityMappings.kt's
 *  BankQuestionEntity). */
export function bankQuestionFromRow(row) {
  const { quizId, orderIndex, rapidBonus, ...question } = questionFromRow({ ...row, quiz_id: null, order_index: 0 });
  return { ...question, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function bankQuestionToRow(entry, userId) {
  const { quiz_id, order_index, rapid_bonus, ...row } = questionToRow({ ...entry, orderIndex: 0 }, null);
  return { ...row, user_id: userId, created_at: entry.createdAt, updated_at: entry.updatedAt };
}

export function questionToRow(question, quizId) {
  return {
    id: question.id,
    quiz_id: quizId,
    type: question.type,
    text: question.text,
    options: question.options,
    correct: question.correct,
    written_answer: question.writtenAnswer,
    time_sec: question.timeSec,
    points: question.points,
    order_index: question.orderIndex,
    hint: question.hint,
    reason: question.reason,
    answer_rule: question.answerRule,
    poll_settings: question.pollSettings,
    fill_blank: question.fillBlank,
    accept_any_correct: question.acceptAnyCorrect,
    // questions.manual_marking is vestigial in the app (Models.kt:226) — never written here.
    rapid_bonus: question.type === QUESTION_TYPES.POLL ? null : question.rapidBonus ?? null,
  };
}

/** A feedback row -> the page model (core/backend/contract.js Feedback). */
export function feedbackFromRow(row) {
  return {
    id: row.id,
    rating: row.rating ?? 0,
    category: row.category ?? null,
    message: row.message ?? "",
    createdAt: row.created_at,
    adminReply: row.admin_reply || null,
    adminReplyAt: row.admin_reply_at ?? null,
  };
}
