// Client-side validation and normalisation for the builder.
//
// This is a MIRROR of the server's rules, never a replacement for them: the real limits are
// enforced by RLS (quizzes_insert_own's title cap, questions_insert_owner's shape and text
// caps) and by question_text_within_limits(). Doing it here too means a creator finds out
// before they lose work, with a sentence they can act on instead of a PostgREST error code.
//
// The structural rules port ui/create/QuestionFormLogic.kt (validateQuestionForm,
// validateFillBlankForm, buildQuestionFromForm) — a question the app would refuse to save
// must not be saveable here, and a saved question must carry exactly what the app's would.

import { FILL_BLANK_CHECKING, QUESTION_TYPES, fillBlankPlainText, templateBlankIds } from "./models.js";
import { S, t } from "./strings.js";

const CHOICE_TYPES = new Set([
  QUESTION_TYPES.SINGLE_CHOICE,
  QUESTION_TYPES.MULTIPLE_CORRECT,
  QUESTION_TYPES.TRUE_FALSE,
]);

const clean = (value) => String(value ?? "").trim();

/** Returns { quiz: [messages], questions: Map(questionId -> [messages]), ok } so the page
 *  can show each problem next to the thing that has it. */
export function validateQuiz(quiz, questions, limits) {
  const quizErrors = [];
  const questionErrors = new Map();

  const title = clean(quiz.title);
  if (!title) quizErrors.push(S.ERR_TITLE_REQUIRED);
  else if (title.length > limits.maxQuizTitleChars) {
    quizErrors.push(t(S.ERR_TITLE_TOO_LONG, { n: limits.maxQuizTitleChars }));
  }

  if (!questions.length) quizErrors.push(S.ERR_NO_QUESTIONS);
  else if (questions.length > limits.maxQuestions) {
    quizErrors.push(t(S.ERR_TOO_MANY_QUESTIONS, { n: limits.maxQuestions }));
  }

  for (const question of questions) {
    const errors = validateQuestion(question, limits, quiz);
    if (errors.length) questionErrors.set(question.id, errors);
  }

  return {
    quiz: quizErrors,
    questions: questionErrors,
    ok: quizErrors.length === 0 && questionErrors.size === 0,
  };
}

/** [quiz] is needed for one rule: on a manual-marking quiz the owner decides correctness while
 *  grading, so no correct answer is required (skipCorrectnessCheck in the app). */
export function validateQuestion(question, limits, quiz = null) {
  const errors = [];
  const skipCorrectness = quiz?.manualMarkingDefault === true;

  if (question.type === QUESTION_TYPES.FILL_BLANK) {
    validateFillBlank(question, limits, skipCorrectness, errors);
  } else {
    const text = clean(question.text);
    if (!text) errors.push(S.ERR_QUESTION_TEXT_REQUIRED);
    else if (text.length > limits.maxQuestionTextChars) {
      errors.push(t(S.ERR_QUESTION_TEXT_TOO_LONG, { n: limits.maxQuestionTextChars }));
    }
  }

  if (CHOICE_TYPES.has(question.type) || question.type === QUESTION_TYPES.POLL) {
    // Blank option rows are dropped on save (buildQuestionFromForm), so only filled ones count.
    const filled = (question.options ?? []).map(clean).filter(Boolean);
    if (filled.length < 2) errors.push(S.ERR_NEED_TWO_OPTIONS);
    if (filled.length > limits.maxOptions) errors.push(t(S.ERR_TOO_MANY_OPTIONS, { n: limits.maxOptions }));
    if (filled.some((option) => option.length > limits.maxOptionTextChars)) {
      errors.push(t(S.ERR_OPTION_TOO_LONG, { n: limits.maxOptionTextChars }));
    }
    // Correctness is stored by option TEXT, so two equal options would both read as correct.
    if (new Set(filled).size !== filled.length) errors.push(S.ERR_DUPLICATE_OPTIONS);
    if (CHOICE_TYPES.has(question.type) && !skipCorrectness) {
      const correct = (question.correct ?? []).map(clean).filter((c) => c && filled.includes(c));
      if (!correct.length) errors.push(S.ERR_NO_CORRECT);
      // A "multiple answers" question with one correct answer is a Single choice in disguise.
      else if (question.type === QUESTION_TYPES.MULTIPLE_CORRECT && correct.length < 2) errors.push(S.ERR_NEED_TWO_CORRECT);
    }
  }

  if (question.type === QUESTION_TYPES.WRITTEN) {
    const answer = clean(question.writtenAnswer);
    // A keyless written question marks itself: any non-blank answer gets full marks.
    if (!answer && !skipCorrectness) errors.push(S.ERR_WRITTEN_ANSWER_REQUIRED);
    else if (answer.length > limits.maxAnswerTextChars) {
      errors.push(t(S.ERR_ANSWER_TOO_LONG, { n: limits.maxAnswerTextChars }));
    }
  }

  if (question.type !== QUESTION_TYPES.POLL) {
    if (clean(question.hint).length > limits.maxHintChars) {
      errors.push(t(S.ERR_HINT_TOO_LONG, { n: limits.maxHintChars }));
    }
    if (clean(question.reason).length > limits.maxReasonChars) {
      errors.push(t(S.ERR_REASON_TOO_LONG, { n: limits.maxReasonChars }));
    }
  }

  return errors;
}

function validateFillBlank(question, limits, skipCorrectness, errors) {
  const content = question.fillBlank ?? { template: "", blanks: [] };
  const template = clean(content.template);
  if (!template) {
    errors.push(S.ERR_FILL_SENTENCE_REQUIRED);
    return;
  }
  if (fillBlankPlainText(template).length > limits.maxQuestionTextChars) {
    errors.push(t(S.ERR_QUESTION_TEXT_TOO_LONG, { n: limits.maxQuestionTextChars }));
  }
  if (clean(content.title).length > limits.maxQuestionTextChars) {
    errors.push(t(S.ERR_QUESTION_TEXT_TOO_LONG, { n: limits.maxQuestionTextChars }));
  }
  const ids = templateBlankIds(template);
  if (!ids.length) errors.push(S.ERR_NO_BLANKS);
  if (ids.length > limits.maxFillBlanks) errors.push(t(S.ERR_TOO_MANY_BLANKS, { n: limits.maxFillBlanks }));

  const blanksById = new Map((content.blanks ?? []).map((blank) => [blank.id, blank]));
  for (const id of ids) {
    const answers = (blanksById.get(id)?.acceptedAnswers ?? []).map(clean).filter(Boolean);
    if (!answers.length && !skipCorrectness) {
      errors.push(S.ERR_BLANK_ANSWER_REQUIRED);
      break;
    }
    if (answers.length > limits.maxFillBlankAnswers) {
      errors.push(t(S.ERR_TOO_MANY_BLANK_ANSWERS, { n: limits.maxFillBlankAnswers }));
      break;
    }
    if (answers.some((a) => a.length > limits.maxAnswerTextChars)) {
      errors.push(t(S.ERR_ANSWER_TOO_LONG, { n: limits.maxAnswerTextChars }));
      break;
    }
  }
}

/** The question exactly as it gets persisted — a port of buildQuestionFromForm. Strips the
 *  payloads its type doesn't use, trims every text, drops blank options and answers. */
export function normalizeQuestion(question) {
  const next = { ...question };
  const type = next.type;
  const isChoice = CHOICE_TYPES.has(type);
  const isPoll = type === QUESTION_TYPES.POLL;
  const blankToNull = (value) => clean(value) || null;

  next.text = clean(next.text);

  if (isChoice || isPoll) {
    next.options = (next.options ?? []).map(clean).filter(Boolean);
  } else {
    next.options = null;
  }

  if (isChoice) {
    const offered = new Set(next.options);
    next.correct = (next.correct ?? []).map(clean).filter((c) => c && offered.has(c));
  } else {
    next.correct = null;
  }

  // Only meaningful with two or more correct options to choose between.
  next.acceptAnyCorrect =
    next.acceptAnyCorrect === true &&
    type === QUESTION_TYPES.MULTIPLE_CORRECT &&
    (next.correct ?? []).length >= 2;

  if (type === QUESTION_TYPES.WRITTEN) {
    next.writtenAnswer = blankToNull(next.writtenAnswer);
  } else {
    next.writtenAnswer = null;
    next.answerRule = null;
  }

  if (isPoll) {
    next.points = 0;
    next.hint = null;
    next.reason = null;
    next.rapidBonus = null;
  } else {
    next.hint = blankToNull(next.hint);
    next.reason = blankToNull(next.reason);
    next.pollSettings = null;
  }

  if (type === QUESTION_TYPES.FILL_BLANK && next.fillBlank) {
    // Keep the blanks array in step with the template (marker order), keep any keys the app
    // may have added, and move the heading into fill_blank.title: questions.text is the
    // sentence with its blanks shown as rules.
    const template = clean(next.fillBlank.template);
    const ids = templateBlankIds(template);
    const byId = new Map((next.fillBlank.blanks ?? []).map((blank) => [blank.id, blank]));
    next.fillBlank = {
      ...next.fillBlank,
      template,
      blanks: ids.map((id) => {
        const blank = byId.get(id) ?? { id, acceptedAnswers: [], points: null };
        return { ...blank, acceptedAnswers: (blank.acceptedAnswers ?? []).map(clean).filter(Boolean) };
      }),
      checking: next.fillBlank.checking ?? FILL_BLANK_CHECKING.FLEXIBLE,
      title: blankToNull(next.fillBlank.title),
    };
    next.text = fillBlankPlainText(template);
  } else {
    next.fillBlank = null;
  }

  return next;
}

/** True if saving would be rejected by the server's caps (RLS) — the only thing that blocks a
 *  draft's autosave. Unfinished questions (no options yet, no correct answer) are fine in a
 *  draft; only Publish and saving a published quiz need validateQuiz to pass. */
export function exceedsLimits(quiz, questions, limits) {
  const len = (value) => String(value ?? "").trim().length;
  if (len(quiz.title) > limits.maxQuizTitleChars) return true;
  if (questions.length > limits.maxQuestions) return true;
  for (const q of questions) {
    if (len(q.text) > limits.maxQuestionTextChars) return true;
    if (len(q.hint) > limits.maxHintChars || len(q.reason) > limits.maxReasonChars) return true;
    if (len(q.writtenAnswer) > limits.maxAnswerTextChars) return true;
    const options = q.options ?? [];
    if (options.length > limits.maxOptions) return true;
    if (options.some((o) => len(o) > limits.maxOptionTextChars)) return true;
    if (q.fillBlank) {
      const blanks = q.fillBlank.blanks ?? [];
      if (blanks.length > limits.maxFillBlanks) return true;
      if (fillBlankPlainText(q.fillBlank.template).replace(/_____/g, "").length > limits.maxQuestionTextChars) return true;
      if (len(q.fillBlank.title) > limits.maxQuestionTextChars) return true;
      for (const blank of blanks) {
        const answers = blank.acceptedAnswers ?? [];
        if (answers.length > limits.maxFillBlankAnswers) return true;
        if (answers.some((a) => len(a) > limits.maxAnswerTextChars)) return true;
      }
    }
  }
  return false;
}
