// Quick-start templates: sample quizzes the dashboard offers when an account has none.
// The dashboard links to create/?template=<id>; the builder fills a NEW, unsaved quiz with
// buildTemplate(id), and the normal autosave writes it like any other draft.
//
// Questions come from newQuestion(), so every JSONB payload is the app's own default shape —
// only text, options and the correct answers are filled in. Every template must pass
// validateQuiz as-is (publishable without edits).

import { QUESTION_TYPES, newQuestion } from "../core/models.js";
import { S } from "../core/strings.js";

const { SINGLE_CHOICE, MULTIPLE_CORRECT, TRUE_FALSE, WRITTEN, POLL } = QUESTION_TYPES;

function q(type, text, { options, correct, writtenAnswer, falseIsCorrect = false } = {}) {
  const question = newQuestion(type);
  question.text = text;
  if (options) question.options = options;
  if (correct) question.correct = correct;
  if (type === TRUE_FALSE && falseIsCorrect) question.correct = ["False"];
  if (writtenAnswer != null) question.writtenAnswer = writtenAnswer;
  return question;
}

const BUILDERS = {
  math: () => [
    q(SINGLE_CHOICE, "What is 7 × 8?", { options: ["54", "56", "63", "64"], correct: ["56"] }),
    q(SINGLE_CHOICE, "What is 25% of 80?", { options: ["15", "20", "25", "40"], correct: ["20"] }),
    q(SINGLE_CHOICE, "Solve for x: 3x + 5 = 20", { options: ["3", "5", "7", "15"], correct: ["5"] }),
    q(TRUE_FALSE, "Every square is also a rectangle."),
    q(WRITTEN, "What is the next prime number after 7?", { writtenAnswer: "11" }),
  ],
  history: () => [
    q(SINGLE_CHOICE, "In which year did World War II end?", { options: ["1918", "1939", "1945", "1950"], correct: ["1945"] }),
    q(SINGLE_CHOICE, "Which civilisation built Machu Picchu?", { options: ["Aztec", "Maya", "Inca", "Olmec"], correct: ["Inca"] }),
    q(MULTIPLE_CORRECT, "Which of these were ancient wonders of the world?", {
      options: ["Great Pyramid of Giza", "Hanging Gardens of Babylon", "Eiffel Tower", "Colossus of Rhodes"],
      correct: ["Great Pyramid of Giza", "Hanging Gardens of Babylon", "Colossus of Rhodes"],
    }),
    q(TRUE_FALSE, "The Great Wall of China is easily visible from the Moon with the naked eye.", { falseIsCorrect: true }),
  ],
  checkin: () => [
    q(POLL, "How are you feeling about today's topic?", {
      options: ["Confident", "Mostly fine", "A bit lost", "Totally lost"],
    }),
    q(POLL, "How was the pace of today's session?", { options: ["Too slow", "Just right", "Too fast"] }),
    q(POLL, "What would help you most next time?", {
      options: ["More examples", "More practice time", "Group work", "A quick recap"],
    }),
  ],
};

/** Cards for the dashboard. Labels are functions so they read the current strings; swatch
 *  colour and glyph are the ones in design-reference/dashboard-welcome.html. */
export const TEMPLATES = [
  { id: "math", swatch: "#0f766e", glyph: "#", title: () => S.TPL_MATH_TITLE, body: () => S.TPL_MATH_BODY, group: () => S.TPL_MATH_GROUP },
  { id: "history", swatch: "#d97706", glyph: "H", title: () => S.TPL_HISTORY_TITLE, body: () => S.TPL_HISTORY_BODY, group: () => S.TPL_HISTORY_GROUP },
  { id: "checkin", swatch: "#0d9488", glyph: "✓", title: () => S.TPL_CHECKIN_TITLE, body: () => S.TPL_CHECKIN_BODY, group: () => S.TPL_CHECKIN_GROUP },
];

/** { questions, polls } — how many questions the template has, and how many are polls. */
export function templateCounts(id) {
  const questions = BUILDERS[id]?.() ?? [];
  return { questions: questions.length, polls: questions.filter((q) => q.type === POLL).length };
}

/** { title, groupName, questions } for [id] with fresh ids, or null for an unknown id. */
export function buildTemplate(id) {
  const meta = TEMPLATES.find((tpl) => tpl.id === id);
  if (!meta) return null;
  const questions = BUILDERS[id]().map((question, index) => ({ ...question, orderIndex: index }));
  return { title: meta.title(), groupName: meta.group(), questions };
}
