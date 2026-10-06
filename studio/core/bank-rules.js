// The Question Bank's pure rules — no I/O, so they run under node for dev/bank.test.mjs.
// core/bank.js re-exports all of these alongside the reads and writes; pages import from there.
// Ports of QuestionBankViewModel.kt's helpers and QuestionBankRepository.orderQuestions.

import { QUESTION_TYPES, QUESTION_TYPE_ORDER, fillBlankPlainText, newId } from "./models.js";

/** The app stores light markup (**bold**, _italic_…); lists and search read the plain text.
 *  A run of underscores is a blank ("The capital is _____."), never emphasis. */
export function stripMarkdown(text) {
  return String(text ?? "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__([^_\s](?:.*?[^_\s])?)__/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1");
}

/** What a person recognises the question by: a fill-blank's heading, or its sentence with the
 *  blanks shown as rules; the text for everything else. */
export function plainText(question) {
  if (question.type === QUESTION_TYPES.FILL_BLANK && question.fillBlank) {
    const title = question.fillBlank.title?.trim();
    return stripMarkdown(title || fillBlankPlainText(question.fillBlank.template));
  }
  return stripMarkdown(question.text);
}

/** The plain-text, case-insensitive key that spots a question already in the bank. */
export function normalizedText(question) {
  return plainText(question).trim().toLowerCase();
}

/** Search text AND type pill (BankQuestion.matches): plain text, case-insensitive. */
export function filterBank(all, { query = "", type = null } = {}) {
  const needle = query.trim().toLowerCase();
  return all.filter((entry) => (!type || entry.type === type) && (!needle || plainText(entry).toLowerCase().includes(needle)));
}

/** "All" first, then one pill per type that actually has questions, in the fixed type order so
 *  the pills don't reshuffle as counts change (buildFilters). [] for an empty bank. */
export function typeFilters(all) {
  if (!all.length) return [];
  const counts = new Map();
  for (const entry of all) counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
  return [{ type: null, count: all.length }, ...QUESTION_TYPE_ORDER.filter((type) => counts.has(type)).map((type) => ({ type, count: counts.get(type) }))];
}

/** The one-line answer under a collapsed card (getCollapsedAnswerSummary). null = no correct
 *  answer set yet — allowed in the bank, and worth pointing out. */
export function answerSummary(entry) {
  switch (entry.type) {
    case QUESTION_TYPES.WRITTEN:
      return { kind: "written" };
    case QUESTION_TYPES.POLL:
      return { kind: "poll", count: (entry.options ?? []).length };
    case QUESTION_TYPES.FILL_BLANK: {
      const first = entry.fillBlank?.blanks?.[0]?.acceptedAnswers?.[0];
      return first ? { kind: "answer", text: first } : { kind: "fill" };
    }
    default: {
      const correct = entry.correct ?? [];
      if (!correct.length) return null;
      return { kind: "answer", text: correct[0], more: correct.length - 1 };
    }
  }
}

/**
 * Picks which of [questions] (from the chosen quizzes) to copy into the bank: anything whose
 * text already matches an existing entry — or an earlier question in the same batch — is
 * skipped, otherwise re-running this on the same quiz would duplicate its questions every time.
 * Returns { toImport, skippedTexts }.
 */
export function dedupeForBank(bank, questions) {
  const seen = new Set(bank.map(normalizedText));
  const toImport = [];
  const skippedTexts = [];
  for (const q of questions) {
    const key = normalizedText(q);
    if (seen.has(key)) skippedTexts.push(plainText(q));
    else {
      seen.add(key);
      toImport.push(q);
    }
  }
  return { toImport, skippedTexts };
}

/** A question as a bank entry: no quiz, no order, no per-quiz bonus. */
export function asEntry(question, createdAt, updatedAt) {
  const { quizId, orderIndex, rapidBonus, createdAt: _created, updatedAt: _updated, ...content } = question;
  return { ...content, createdAt, updatedAt };
}

/** A bank entry as a new question of [quizId]. Points and time carry over unchanged. */
export function copyForQuiz(entry, quizId, { id = newId(), orderIndex = 0 } = {}) {
  const { createdAt, updatedAt, ...content } = entry;
  return { ...content, id, quizId, orderIndex, rapidBonus: null };
}

/**
 * Applies the order chosen in the Position step and re-indexes orderIndex. Ids that no longer
 * exist are skipped and questions missing from [orderedIds] are appended in their existing
 * order, so a stale ordering degrades sensibly instead of dropping questions (orderQuestions).
 */
export function orderQuestions(questions, orderedIds) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const picked = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  const pickedIds = new Set(picked.map((q) => q.id));
  const leftovers = questions.filter((q) => !pickedIds.has(q.id));
  return [...picked, ...leftovers].map((q, index) => ({ ...q, orderIndex: index }));
}
