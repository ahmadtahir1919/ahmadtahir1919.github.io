// ============================================================================
// Per-question grading at submit time — the web half of gradeQuestion() in
// data/model/Grading.kt, which is the source of truth. finishQuiz calls it, and
// the server's shadow grader (supabase/functions/grade) runs a byte-identical copy.
// webtest/fixtures/grading-cases.json pins all of them to the Android rule
// (webtest/grading-cases.test.mjs here, GradingCasesFixtureTest on Android).
// A plain browser script like evaluator.js: nothing touches the DOM, its public
// surface is assigned onto window.
// ============================================================================

/** Mirrors Grading.kt's requiresManualMarking: all-or-nothing at the quiz level, no
 *  per-question override. Polls are never hand-marked — nothing to be right about. */
function requiresManualMarking(q, quiz) {
  return q.type !== "POLL" && quiz.manualMarkingDefault === true;
}

/** Whether this question's own rapid bonus choice (Question.rapidBonus) or, failing one, the
 *  quiz-wide toggle switches the bonus on. Mirrors Models.kt's rapidBonusApplies. */
function rapidBonusApplies(q, quiz) {
  return q.rapidBonus ?? quiz.timeWeightageEnabled === true;
}

/** A WRITTEN question's answer rule with every field it leaves out taken from the defaults —
 *  mirrors Android's `answerRuleJson.toAnswerRuleOrNull() ?: AnswerRule()`, which decodes a stored
 *  rule into a data class with defaults. The app stores rules WITHOUT their default-valued fields
 *  (an untouched rule is `{}`), so using the stored object as-is lost FUZZY_TYPO_TOLERANT and the
 *  0.85 threshold and graded strict-exact instead: "photosynthesys" was right in the app and wrong
 *  here. Shared by gradeQuestion and app.js's instant feedback so the two can't disagree. */
function answerRuleFor(q) {
  return window.Evaluator.defaultAnswerRule(q.answerRule);
}

/** Grades one scored question. [rawKeys] is what the taker entered: option positions for the
 *  choice types, the text for WRITTEN and FILL_BLANK (one entry per blank). [quiz] supplies
 *  the scoring rules (manualMarkingDefault, splitPointsAcrossChoices, timeWeightageEnabled,
 *  showTimers). */
function gradeQuestion(q, quiz, rawKeys, timeTakenSec) {
  const evaluator = window.Evaluator;
  let given;
  if (q.type === "WRITTEN" || q.type === "FILL_BLANK") given = rawKeys;
  else given = rawKeys.map((k) => (q.options || [])[Number(k)]).filter((v) => v !== undefined);

  // Hand-marked questions skip evaluation entirely and submit as pending, exactly as
  // QuizPreviewViewModel.finishPreview does. Grading them here would hand the taker a
  // verdict the owner never gave — and one the owner's marking would then overwrite.
  const isManual = requiresManualMarking(q, quiz);

  let isCorrect = false;
  // rawPoints mirrors exactly what awardedPoints was before split-points/time-weightage
  // existed for every type except a split-points-enabled MULTIPLE_CORRECT — see
  // gradeQuestion's identical comment on the Android side.
  let rawPoints = 0;
  // Populated only for an auto-graded WRITTEN answer with something on both sides to
  // actually compare — mirrors Android's evalResult, which is likewise null for the
  // trivial blank-input/blank-expected-answer cases. Used by the review card to show
  // the same status label/points/word-by-word detail Android's WrittenEvalRow does,
  // instead of a flat correct/wrong line with no explanation of *why*.
  let evaluationResult = null;
  if (!isManual) {
    if (q.type === "WRITTEN") {
      const userInput = given[0] || "";
      const expected = q.writtenAnswer || "";
      if (!userInput.trim()) {
        isCorrect = false;
        rawPoints = 0;
      } else if (!expected.trim()) {
        // No expected answer was ever set — any attempt counts as correct, for full marks.
        isCorrect = true;
        rawPoints = q.points;
      } else {
        const rule = answerRuleFor(q);
        evaluationResult = evaluator.evaluate(userInput, expected, rule);
        // G-01: the award IS computeScore's partial credit rounded to a whole mark, and the
        // verdict comes from that same number — mirrors gradeQuestion via gradeWritten.
        const grade = evaluator.gradeWritten(evaluationResult, q.points, rule);
        isCorrect = grade.isCorrect;
        rawPoints = grade.awardedPoints;
      }
    } else if (q.type === "FILL_BLANK") {
      isCorrect = q.fillBlankContent ? window.FillBlank.fillBlankIsQuestionCorrect(q.fillBlankContent, given) : false;
      rawPoints = isCorrect ? q.points : 0;
    } else if (q.type === "MULTIPLE_CORRECT") {
      // By option position, same as buildInstantFeedback — both verdicts come from
      // evaluator.isMultipleCorrectAnswer (mirrors Android's gradeQuestion).
      const options = q.options || [];
      const correctIdx = options.map((_, i) => i).filter((i) => (q.correctAnswers || []).includes(options[i]));
      const pickedIdx = new Set(rawKeys.map(Number).filter((n) => !Number.isNaN(n)));
      const acceptAny = !!q.acceptAnyCorrect;
      if (quiz.splitPointsAcrossChoices) {
        // Correctness is a set comparison inside scoreSplitMultipleCorrect, not
        // "rawPoints === q.points" as it used to be — see that function's doc in
        // evaluator.js for the two ways that comparison marked wrong answers correct.
        const scored = evaluator.scoreSplitMultipleCorrect(correctIdx, pickedIdx, q.points, acceptAny);
        rawPoints = scored.rawPoints;
        isCorrect = scored.isCorrect;
      } else {
        isCorrect = evaluator.isMultipleCorrectAnswer(new Set(correctIdx), pickedIdx, acceptAny);
        rawPoints = isCorrect ? q.points : 0;
      }
    } else {
      const a = new Set(given), b = new Set(q.correctAnswers || []);
      // Non-empty: a skipped question must never match a keyless one (empty == empty).
      isCorrect = a.size > 0 && a.size === b.size && [...a].every((x) => b.has(x));
      rawPoints = isCorrect ? q.points : 0;
    }
  }

  // Uniform across every scored type — no-op when the toggle is off, when the creator opted
  // this question out of it, or when it has no active timer (see applyTimeWeightage's doc
  // in evaluator.js).
  const effectiveTimeLimitSec = quiz.showTimers ? q.timeSec : 0;
  const finalPoints = evaluator.applyTimeWeightage(rawPoints, timeTakenSec, effectiveTimeLimitSec, rapidBonusApplies(q, quiz));

  return {
    given,
    isCorrect,
    needsManualMarking: isManual,
    // null on a manual answer is what marks it pending — a blank answer included, so the
    // owner's queue counts every question. Mirrors QuizPreviewViewModel.finishPreview.
    awardedPoints: isManual ? null : finalPoints,
    evaluationResult,
  };
}

window.Grade = { gradeQuestion, answerRuleFor, requiresManualMarking, rapidBonusApplies };
