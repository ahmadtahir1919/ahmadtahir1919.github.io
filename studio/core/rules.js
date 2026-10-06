// Studio's port of the app's quiz-rule logic, pure and I/O-free: presets (data/model/QuizPreset.kt), the
// preset summary sentence (ui/create/QuizPresetUi.kt presetSummary), which rules are greyed out and why
// (data/model/RuleBlocks.kt, C-3), the risky-combination notices (data/model/RuleConflicts.kt, C-2) and the
// setup review (data/model/QuizSetupReview.kt). The Android tests and webtest/rules-parity.test.mjs run the
// SAME tables (webtest/fixtures/presets.json, summary.json, blocked-reasons.json, conflicts.json,
// question-facts.json, setup-review.json), so the two cannot drift apart.
//
// Quiz fields are the camelCase page model (core/models.js); questions are the page's question objects.

import { QUESTION_TYPES as T } from "./models.js";

// ── Question facts (QuizSetupSummary.kt / Models.kt) ──────────────────────────────────────────────

/** The facts about a quiz's questions every rule below needs; all false for a quiz with no questions. */
export function questionFacts(questions) {
  const answerable = questions.filter((q) => q.type !== T.POLL);
  return {
    onlyPolls: questions.length > 0 && questions.every((q) => q.type === T.POLL),
    onlyUntimed: answerable.length > 0 && answerable.every((q) => !(q.timeSec > 0)),
    noMultiple: questions.length > 0 && !questions.some((q) => q.type === T.MULTIPLE_CORRECT),
    hasOpenAnswers: questions.some((q) => q.type === T.WRITTEN || q.type === T.FILL_BLANK),
  };
}

// ── Presets (QuizPreset.kt) ───────────────────────────────────────────────────────────────────────

export const PRESETS = ["CLASS_TEST", "PRACTICE", "SPEED_DRILL"];

const RULES = {
  CLASS_TEST: { numbered: true, timer: true, previewSec: 5, instantFlash: false, allowBack: false, showScore: false, retake: false, partialCredit: false, rapidBonus: false },
  PRACTICE: { numbered: true, timer: false, previewSec: 0, instantFlash: false, allowBack: true, showScore: true, retake: true, partialCredit: true, rapidBonus: false },
  SPEED_DRILL: { numbered: true, timer: true, previewSec: 5, instantFlash: true, allowBack: false, showScore: true, retake: true, partialCredit: true, rapidBonus: true },
};

/** The quiz with only the preset's nine rule fields replaced. Manual Review is never touched; with it on,
 *  Instant Flash, Partial Credit and Rapid Bonus stay stored OFF. Class test is the one preset that also
 *  sets "Show results" (to AUTO); the others leave the mode as the owner set it. */
export function applyPreset(preset, quiz) {
  const r = RULES[preset];
  const manual = quiz.manualMarkingDefault === true;
  return {
    ...quiz,
    resultsReleaseMode: preset === "CLASS_TEST" ? "AUTO" : quiz.resultsReleaseMode,
    showQuestionNumbers: r.numbered,
    showTimers: r.timer,
    questionPreviewSec: r.previewSec,
    showCorrectnessInstantly: r.instantFlash && !manual,
    allowBack: r.allowBack,
    showResult: r.showScore,
    showAnswers: r.showScore,
    allowRetake: r.retake,
    splitPointsAcrossChoices: r.partialCredit && !manual,
    timeWeightageEnabled: r.rapidBonus && !manual,
  };
}

/** How many of the nine rules differ from [preset]; Manual Review is not compared, and while it is on the
 *  three rules it switches off are never counted. Show Score counts once. */
export function changedRulesFrom(quiz, preset) {
  const r = RULES[preset];
  const manual = quiz.manualMarkingDefault === true;
  const answers = quiz.showAnswers ?? quiz.showResult;
  return [
    quiz.showQuestionNumbers !== r.numbered,
    quiz.showTimers !== r.timer,
    quiz.questionPreviewSec !== r.previewSec,
    !manual && quiz.showCorrectnessInstantly !== r.instantFlash,
    quiz.allowBack !== r.allowBack,
    quiz.showResult !== r.showScore || answers !== r.showScore,
    quiz.allowRetake !== r.retake,
    !manual && quiz.splitPointsAcrossChoices !== r.partialCredit,
    !manual && quiz.timeWeightageEnabled !== r.rapidBonus,
  ].filter(Boolean).length;
}

/** The preset whose nine rules all equal this quiz's, or null ("Your own settings"). */
export function matchingPreset(quiz) {
  return PRESETS.find((preset) => changedRulesFrom(quiz, preset) === 0) ?? null;
}

/** Which summary sentence the strip shows (QuizPresetUi.kt presetSummary). */
export function presetSummary(selected, manualOn, onlyPolls) {
  if (selected == null) return "CUSTOM";
  if (onlyPolls) return "ONLY_POLLS";
  if (selected === "CLASS_TEST") return "CLASS_TEST";
  if (selected === "PRACTICE") return manualOn ? "PRACTICE_MANUAL" : "PRACTICE";
  return manualOn ? "SPEED_DRILL_MANUAL" : "SPEED_DRILL";
}

// ── Chips (QuizPresetUi.kt) ───────────────────────────────────────────────────────────────────────

/** Instant Flash as it really behaves: nothing flashes on a hand-marked quiz or a quiz of only polls. */
export const effectiveFlash = (flashOn, manualOn, onlyPolls) => flashOn && !manualOn && !onlyPolls;
/** The timer as it really behaves: a quiz with no timed question has no running timer. */
export const effectiveTimer = (timerOn, onlyUntimed) => timerOn && !onlyUntimed;

export function answersChip(quiz, facts) {
  if (effectiveFlash(quiz.showCorrectnessInstantly, quiz.manualMarkingDefault, facts.onlyPolls)) return "INSTANT";
  return quiz.showResult ? "SHOWN" : "HIDDEN";
}
export const timerChip = (quiz, facts) => (effectiveTimer(quiz.showTimers, facts.onlyUntimed) ? "TIMED" : "NO_TIMER");
export const triesChip = (quiz) => (quiz.allowRetake ? "RETAKES" : "ONE_TRY");

// ── Greyed-out rules (RuleBlocks.kt) ──────────────────────────────────────────────────────────────

/** One reason (or null = usable) per rule, in the order the rows check them:
 *  ONLY_POLLS, MANUAL_REVIEW, NO_TIMED_QUESTION, TIMER_OFF, NO_MULTIPLE_CORRECT. */
export function ruleBlockedReasons({ manual, showTimers, onlyPolls, onlyUntimed, noMultiple }) {
  return {
    timer: onlyUntimed ? "NO_TIMED_QUESTION" : null,
    preview: onlyUntimed ? "NO_TIMED_QUESTION" : !showTimers ? "TIMER_OFF" : null,
    flash: onlyPolls ? "ONLY_POLLS" : manual ? "MANUAL_REVIEW" : null,
    partial: onlyPolls ? "ONLY_POLLS" : manual ? "MANUAL_REVIEW" : noMultiple ? "NO_MULTIPLE_CORRECT" : null,
    rapid: onlyPolls ? "ONLY_POLLS" : manual ? "MANUAL_REVIEW" : onlyUntimed ? "NO_TIMED_QUESTION" : !showTimers ? "TIMER_OFF" : null,
    manual: onlyPolls ? "ONLY_POLLS" : null,
  };
}

/** The blocks for a quiz and its question facts. */
export const blocksFor = (quiz, facts) =>
  ruleBlockedReasons({
    manual: quiz.manualMarkingDefault === true,
    showTimers: quiz.showTimers,
    onlyPolls: facts.onlyPolls,
    onlyUntimed: facts.onlyUntimed,
    noMultiple: facts.noMultiple,
  });

// ── Conflict notices (RuleConflicts.kt) ───────────────────────────────────────────────────────────

/** The risky combinations true right now, in display order, using effective values. */
export function ruleConflicts(rules, ctx) {
  const out = [];
  const flash = effectiveFlash(rules.flashOn, rules.manualOn, ctx.onlyPolls);
  if (rules.retake && (rules.showScore || flash) && !ctx.onlyPolls) out.push("RETAKE_WITH_ANSWERS");
  if (rules.backOn && effectiveTimer(rules.timerOn, ctx.hasOnlyUntimedQuestions)) out.push("BACK_ON_TIMED");
  if (!rules.manualOn && ctx.hasOpenAnswerQuestions) out.push("MANUAL_OFF_OPEN_ANSWERS");
  return out;
}

/** The conflicts for a quiz and its question facts. */
export const conflictsFor = (quiz, facts) =>
  ruleConflicts(
    {
      retake: quiz.allowRetake === true,
      showScore: quiz.showResult === true,
      flashOn: quiz.showCorrectnessInstantly === true,
      manualOn: quiz.manualMarkingDefault === true,
      backOn: quiz.allowBack === true,
      timerOn: quiz.showTimers === true,
    },
    { onlyPolls: facts.onlyPolls, hasOnlyUntimedQuestions: facts.onlyUntimed, hasOpenAnswerQuestions: facts.hasOpenAnswers }
  );

// ── Setup review (QuizSetupReview.kt) ─────────────────────────────────────────────────────────────

/** The settings that change how already-written questions behave. */
export const setupSettings = (quiz) => ({
  manualMarking: quiz.manualMarkingDefault === true,
  showResult: quiz.showResult === true,
  showTimers: quiz.showTimers === true,
  rapidScoring: quiz.timeWeightageEnabled === true,
});

/** Whether the question carries what auto-checking needs. A poll never misses one; a Written question needs
 *  its expected answer (a keyless one would mark everybody right). */
export function hasCorrectAnswer(q) {
  const filled = (list) => (list ?? []).some((x) => String(x ?? "").trim() !== "");
  switch (q.type) {
    case T.POLL:
      return true;
    case T.WRITTEN:
      return String(q.writtenAnswer ?? "").trim() !== "";
    case T.FILL_BLANK: {
      const blanks = q.fillBlank?.blanks;
      return Array.isArray(blanks) && blanks.length > 0 && blanks.every((b) => filled(b.acceptedAnswers));
    }
    default:
      return filled(q.correct);
  }
}

/**
 * What to tell the author about [settings] applied to [questions]. Findings: { kind, ids?, count?, mustResolve }
 * with kind NO_QUESTIONS | MISSING_ANSWERS | MANUAL_MARKING | RESULT_WITHOUT_ANSWERS | TIMERS_OFF |
 * RAPID_HAS_NO_EFFECT. [previous] = the settings the questions were last saved under, or null for a new quiz;
 * informational findings only fire when the setting behind them changed. [forPublishing]: where this decides
 * whether people can take the quiz (publish, or settings on a published quiz).
 */
export function reviewQuizSetup(settings, questions, previous = null, forPublishing = false) {
  if (forPublishing && questions.length === 0) return [{ kind: "NO_QUESTIONS", mustResolve: true }];
  const changed = (pick) => previous == null || pick(previous) !== pick(settings);
  const scored = questions.filter((q) => q.type !== T.POLL);
  const unanswered = scored.filter((q) => !hasCorrectAnswer(q)).map((q) => q.id);
  const findings = [];

  if (!settings.manualMarking) {
    if (forPublishing && unanswered.length) findings.push({ kind: "MISSING_ANSWERS", ids: unanswered, mustResolve: true });
  } else {
    if (scored.length && changed((s) => s.manualMarking)) findings.push({ kind: "MANUAL_MARKING", mustResolve: false });
    if (settings.showResult && unanswered.length && (changed((s) => s.manualMarking) || changed((s) => s.showResult))) {
      findings.push({ kind: "RESULT_WITHOUT_ANSWERS", ids: unanswered, mustResolve: false });
    }
  }

  if (!settings.showTimers && changed((s) => s.showTimers)) {
    const timed = questions.filter((q) => q.timeSec > 0 && q.pollSettings?.noTimeLimit !== true).length;
    if (timed > 0) findings.push({ kind: "TIMERS_OFF", count: timed, mustResolve: false });
  }

  if (settings.rapidScoring && !settings.manualMarking && scored.length && (changed((s) => s.rapidScoring) || changed((s) => s.showTimers))) {
    // Only questions the bonus actually applies to count: the question's own choice, else the quiz's.
    const anyTimed = settings.showTimers && scored.some((q) => (q.rapidBonus ?? settings.rapidScoring) && q.timeSec > 0);
    if (!anyTimed) findings.push({ kind: "RAPID_HAS_NO_EFFECT", mustResolve: false });
  }
  return findings;
}
