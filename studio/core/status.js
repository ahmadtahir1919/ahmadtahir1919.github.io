// A quiz's card status — port of quizCardStatusOf (ui/home/QuizStatusUi.kt:61) and
// Quiz.effectiveStatus (Models.kt:123). Archived and draft win over anything time-derived.

export const QUIZ_STATUS = {
  ARCHIVED: "ARCHIVED",
  DRAFT: "DRAFT",
  SCHEDULED: "SCHEDULED",
  ENDED: "ENDED",
  /** Open, nobody has taken it yet. */
  ACTIVE: "ACTIVE",
  /** Open and people have taken it. */
  IN_PROGRESS: "IN_PROGRESS",
};

/** SCHEDULED / ACTIVE / ENDED from start_at / end_at (epoch ms). */
export function effectiveStatus(quiz, now = Date.now()) {
  if (quiz.startAt != null && now < quiz.startAt) return QUIZ_STATUS.SCHEDULED;
  if (quiz.endAt != null && now >= quiz.endAt) return QUIZ_STATUS.ENDED;
  return QUIZ_STATUS.ACTIVE;
}

export function quizCardStatus(quiz, hasParticipants, now = Date.now()) {
  if (quiz.isArchived) return QUIZ_STATUS.ARCHIVED;
  if (quiz.isDraft) return QUIZ_STATUS.DRAFT;
  const live = effectiveStatus(quiz, now);
  if (live === QUIZ_STATUS.ACTIVE) return hasParticipants ? QUIZ_STATUS.IN_PROGRESS : QUIZ_STATUS.ACTIVE;
  return live;
}

/** Dashboard filter bucket for a status: Live covers both open states. */
export function statusFilterOf(status) {
  if (status === QUIZ_STATUS.ACTIVE || status === QUIZ_STATUS.IN_PROGRESS) return "LIVE";
  return status;
}
