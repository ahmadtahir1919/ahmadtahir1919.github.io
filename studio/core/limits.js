// Server-enforced caps (app_limits, optionally overridden per user). Read so the UI can
// disable a button before the user hits a raw RLS rejection; the server stays the real
// enforcer either way.

import * as backend from "./backend/index.js";

/** Defaults match app_limits' own column defaults, and are used if the call fails so a
 *  network blip degrades to "the UI lets you try and the server decides" rather than
 *  blocking creation outright.
 *
 *  createQuizEnabled is the admin maintenance switch that quizzes_insert_own also checks
 *  server-side (schema.sql:596) — when it is off, saving will be rejected, so the UI says
 *  so up front instead of letting someone build a whole quiz that cannot be saved. */
export async function fetchLimits() {
  const fallback = {
    maxQuizzes: 10,
    maxQuestions: 20,
    maxOptions: 30,
    maxFillBlanks: 20,
    maxFillBlankAnswers: 10,
    maxQuizTitleChars: 50,
    maxQuestionTextChars: 250,
    maxHintChars: 250,
    maxReasonChars: 250,
    maxOptionTextChars: 100,
    maxAnswerTextChars: 250,
    maxBankQuestions: 100,
    createQuizEnabled: true,
  };
  try {
    const limits = await backend.loadLimits();
    if (!limits) return fallback;
    const merged = {};
    for (const key of Object.keys(fallback)) merged[key] = limits[key] ?? fallback[key];
    merged.createQuizEnabled = limits.createQuizEnabled !== false;
    return merged;
  } catch {
    return fallback;
  }
}
