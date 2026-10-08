// The backend contract: every function a Studio backend must export, and the shapes they
// take and return. core/backend/supabase/ is the only implementation today; a future REST
// API adapter exports the same names with the same shapes, and nothing above core/backend/
// changes. dev/backend-contract.test.mjs fails if an adapter misses one.
//
// Two shape families, on purpose:
//  • Quiz and Question are camelCase — the page models in core/models.js. An adapter maps
//    its own wire format to and from them (supabase/rows.js does this for Postgres rows).
//  • Attempt, Answer, JoinedUser and PollVote keep the snake_case field names the tables
//    and the Android app use. scoring.js, the grading pages and webtest/grading-parity
//    read these names directly, so an API returns them exactly like this.
//
// All times are epoch MILLISECONDS (numbers), never ISO strings. Ids are strings (UUIDs).
// Every function is async and throws on a transport or permission error, except where noted.

/** Every function an adapter must export. Grouped the way the adapter files are split. */
export const BACKEND_FUNCTIONS = {
  auth: ["getUser", "signInWithGoogle", "signInWithIdToken", "signOut"],
  limits: ["loadLimits"],
  bank: ["listBank", "loadBankQuestion", "countBank", "upsertBankQuestions", "deleteBankQuestions"],
  feedback: ["listMyFeedback", "insertFeedback"],
  quizzes: [
    "listQuizzes",
    "loadQuiz",
    "loadQuestions",
    "questionsFor",
    "questionCounts",
    "hasParticipants",
    "shareCodeExists",
    "saveQuizChecked",
    "publishQuiz",
    "setArchived",
    "setSchedule",
    "setResultsRelease",
    "saveTitleAndTheme",
    "deleteQuiz",
  ],
  preview: ["previewQuizRow", "previewQuestionRow"],
  results: [
    "loadAttempts",
    "loadAnswers",
    "loadAttempt",
    "loadJoinedUsers",
    "participantCounts",
    "attemptStats",
    "manualMarkingProgress",
    "pendingMarking",
    "participantIds",
    "gradedStats",
    "displayNames",
    "saveGradesRows",
    "removeParticipant",
    "loadPollVotes",
  ],
};

// ── Shapes ──────────────────────────────────────────────────────────────────

/**
 * @typedef {object} User  The signed-in person. Only these fields are read.
 * @property {string} id
 * @property {string} [email]
 * @property {{ full_name?: string, name?: string }} [user_metadata]
 */

/**
 * @typedef {object} Limits  Partial is fine: a missing or null field falls back to
 *   core/limits.js's defaults, and createQuizEnabled is only "off" when exactly false.
 * @property {number} maxQuizzes
 * @property {number} maxQuestions
 * @property {number} maxOptions
 * @property {number} maxFillBlanks
 * @property {number} maxFillBlankAnswers
 * @property {number} maxQuizTitleChars
 * @property {number} maxQuestionTextChars
 * @property {number} maxHintChars
 * @property {number} maxReasonChars
 * @property {number} maxOptionTextChars
 * @property {number} maxAnswerTextChars
 * @property {number} maxBankQuestions       Question Bank cap, per user
 * @property {number} maxFreeTextChars       free-text cap (feedback message, grader notes)
 * @property {boolean} createQuizEnabled
 */

/** @typedef {ReturnType<typeof import("../models.js").newQuiz>} Quiz  core/models.js newQuiz() */
/** @typedef {ReturnType<typeof import("../models.js").newQuestion> & { quizId?: string }} Question
 *  core/models.js newQuestion(); answerRule / pollSettings / fillBlank are the JSONB objects as is. */

/** @typedef {Omit<Question, "quizId" | "orderIndex" | "rapidBonus"> & { createdAt: number, updatedAt: number }} BankQuestion
 *  One Question Bank entry: a Question that belongs to no quiz, owned by the user directly. */

/**
 * @typedef {object} Feedback  One piece of the user's own feedback (the app's data/repository/FeedbackRepository.kt).
 * @property {string} id
 * @property {number} rating          0 = a plain suggestion (no stars), 1-5 otherwise
 * @property {string|null} category   BUG | CRASH | SYNC | UI_UX | PERFORMANCE | FEATURE_REQUEST | REPORT_CONTENT | OTHER
 * @property {string} message
 * @property {number} createdAt
 * @property {string|null} adminReply     the team's one-way reply; a user can never write it
 * @property {number|null} adminReplyAt
 */

/**
 * @typedef {object} Attempt  One submission. Previews (is_preview) are never returned.
 * @property {string} id
 * @property {string} quiz_id
 * @property {string} user_id
 * @property {number} score
 * @property {number} total
 * @property {number} finished_at
 * @property {number|null} first_finished_at
 * @property {number} retake_count
 * @property {string|null} overall_feedback
 * @property {number|null} graded_at
 */

/**
 * @typedef {object} Answer  One answer inside an attempt.
 * @property {string} id
 * @property {string} attempt_id
 * @property {string} question_id
 * @property {boolean} is_correct
 * @property {*} given_answer          JSONB exactly as the app wrote it
 * @property {number} time_taken_sec
 * @property {boolean} used_hint
 * @property {boolean} needs_manual_marking
 * @property {number|null} awarded_points  null = not marked yet
 * @property {number} max_points
 * @property {number|null} graded_at
 * @property {string|null} feedback
 */

/**
 * @typedef {object} JoinedUser  Someone who joined by share code (may never have submitted).
 * @property {string} user_id
 * @property {string} quiz_id
 * @property {number} joined_at
 */

/**
 * @typedef {object} PollVote
 * @property {string} question_id
 * @property {string} voter_key
 * @property {string[]} selected
 * @property {string|null} other_text
 * @property {string|null} reason
 * @property {string|null} participant_id
 */

/**
 * @typedef {object} GradeRow  One answer in a grade write. feedback_only rows change only the
 *   note and must never touch the verdict.
 * @property {string} id                 Answer id
 * @property {boolean} feedback_only
 * @property {boolean} [is_correct]
 * @property {number|null} [awarded_points]
 * @property {number} [max_points]
 * @property {number|null} [graded_at]
 * @property {string|null} feedback
 */

// ── Functions ───────────────────────────────────────────────────────────────
//
// auth
//   getUser(): User|null                          null when signed out; never throws for that
//   signInWithGoogle(redirectTo: string)          redirect flow (local dev)
//   signInWithIdToken(credential, rawNonce)       Google ID token from GIS; nonce UNHASHED
//   signOut()
//
// limits
//   loadLimits(): Limits|null                     null (or a throw) = use the defaults
//
// bank — the signed-in user's own entries only; BankQuestion in, BankQuestion out
//   listBank(userId): BankQuestion[]              newest createdAt first
//   loadBankQuestion(id): BankQuestion|null
//   countBank(userId): number
//   upsertBankQuestions(userId, entries)          insert or replace by id; createdAt/updatedAt
//                                                 are written as given
//   deleteBankQuestions(ids)
//
// feedback — the signed-in user's own only; Feedback out
//   listMyFeedback(userId): Feedback[]            newest createdAt first
//   insertFeedback(userId, {rating, category, message, createdAt})
//                                                 throws when the server refuses (one per 24h → a
//                                                 Postgres 42501 / "row-level security" error)
//
// quizzes — Quiz / Question in, Quiz / Question out
//   listQuizzes(ownerId): Quiz[]                  newest createdAt first
//   loadQuiz(quizId): Quiz|null
//   loadQuestions(quizId): Question[]             by orderIndex
//   questionsFor(quizIds): Map<quizId, Question[]>  every id present, by orderIndex
//   questionCounts(quizIds): Map<quizId, number>  every id present
//   hasParticipants(quizId): boolean              anyone joined, or any non-preview attempt
//   shareCodeExists(code, excludeQuizId?): boolean
//   saveQuizChecked(quiz, questions, ownerId, expected|null)
//     -> {ok:true, serverUpdatedAt} | {ok:false, conflict:"stale"|"deleted"|"has_answers"}
//                                                 one transaction; afterwards the quiz has exactly
//                                                 these questions. expected = the quiz's
//                                                 serverUpdatedAt as loaded (null = new); refused,
//                                                 writing nothing, when the server's differs
//   publishQuiz(quizId)                           draft → published; no-op if published
//   setArchived(quizId, isArchived)
//   setSchedule(quizId, startAt|null, endAt|null)
//   setResultsRelease(quizId, "AUTO"|"MANUAL", releasedAt|null) -> boolean  (the owner's Announce / Hide; false = refused)
//   saveTitleAndTheme(quizId, title, themeColorName)   writes only title and theme_color_name (a locked quiz)
//   deleteQuiz(quizId)                            questions, attempts and votes go with it
//
// results — owner's view; snake_case rows as typed above
//   loadAttempts(quizIds): Attempt[]              non-preview, any order
//   loadAnswers(attemptIds): Answer[]
//   loadAttempt(attemptId): Attempt|null
//   loadJoinedUsers(quizId): JoinedUser[]
//   participantCounts(quizIds): Map<quizId, number>          quizzes with none are absent
//   attemptStats(quizIds): Map<quizId, {submitted, avgPct|null}>  avgPct = mean of
//                                                 score/total as a whole percent
//   manualMarkingProgress(quizId): {total, pending}   hand-marked answers; pending = unmarked
//   pendingMarking(quizIds): Map<quizId, {answers, questionIds: Set}>  unmarked only
//   participantIds(quizIds): Map<quizId, Set<userId>>  joined or submitted (non-preview);
//                                                 quizzes with nobody are absent
//   gradedStats(quizIds): {graded, avgPct|null}   over attempts with total > 0 and no answer
//                                                 still waiting for a mark; avgPct = mean of
//                                                 score/total as a whole percent
//   displayNames(userIds): Map<userId, string>    blank names left out
//   saveGradesRows({attemptId, score, total, overallFeedback, gradedAt, rows: GradeRow[], notify?}):
//                                                 boolean — atomic; false = refused (retake
//                                                 since read, or not the owner), nothing written
//   removeParticipant(quizId, userId)             their attempt + membership; never the owner
//   loadPollVotes(questionIds): Map<questionId, PollVote[]>
