// ============================================================================
// JS port of the Android app's Fill-in-the-Blank template parser + grader —
// mirrors data/model/FillBlankModels.kt exactly (marker syntax, blank order,
// grading rules) so a Fill Blank question grades identically whether taken in
// the app or here. If you change this in the Kotlin source, mirror it here too.
// ============================================================================

const BLANK_MARKER = /\[\[([^\[\]]*)\]\]/g;

/** Splits [template] into ordered text/blank segments — mirrors
 *  parseFillBlankTemplate() in FillBlankModels.kt. A marker whose id has no
 *  matching blank renders back out as plain text rather than disappearing,
 *  same as the Kotlin version. */
function parseFillBlankTemplate(template, blanks) {
  const blanksById = new Map((blanks || []).map((b) => [b.id, b]));
  const segments = [];
  let lastEnd = 0;
  let orderIndex = 0;
  BLANK_MARKER.lastIndex = 0;
  let match;
  while ((match = BLANK_MARKER.exec(template)) !== null) {
    if (match.index > lastEnd) segments.push({ type: "text", text: template.slice(lastEnd, match.index) });
    const blank = blanksById.get(match[1]);
    if (blank) {
      segments.push({ type: "blank", blank, orderIndex });
      orderIndex++;
    } else {
      segments.push({ type: "text", text: match[0] });
    }
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd < template.length) segments.push({ type: "text", text: template.slice(lastEnd) });
  return segments;
}

/** Ordered list of blanks as they actually appear in the template — the order
 *  answers are collected in. Mirrors FillBlankContent.orderedBlanks(). */
function orderedBlanks(content) {
  return parseFillBlankTemplate(content.template, content.blanks)
    .filter((s) => s.type === "blank")
    .map((s) => s.blank);
}

/** Grades one blank — mirrors FillBlankGrader.isCorrect(). FLEXIBLE checking
 *  uses STRICT_EXACT (case/punctuation-insensitive normalize, still an exact
 *  match after normalizing — same naming quirk as the Kotlin source); STRICT
 *  checking uses CASE_SENSITIVE_EXACT. */
function fillBlankIsCorrect(blank, given, checking) {
  if (!given || !given.trim()) return false;
  const rule = checking === "STRICT"
    ? { matchModeList: ["CASE_SENSITIVE_EXACT"] }
    : { matchModeList: ["STRICT_EXACT"] };
  const { evaluate } = window.Evaluator;
  return (blank.acceptedAnswers || []).some(
    (accepted) => accepted && accepted.trim() && evaluate(given, accepted, rule).status !== "INCORRECT"
  );
}

/** Whole-question correctness — every blank must be right, matching every
 *  other question type's all-or-nothing scoring. Mirrors
 *  FillBlankGrader.isQuestionCorrect(). */
function fillBlankIsQuestionCorrect(content, givenAnswers) {
  const ordered = orderedBlanks(content);
  if (ordered.length === 0) return false;
  return ordered.every((blank, i) => fillBlankIsCorrect(blank, (givenAnswers || [])[i] || "", content.checking));
}

/** Per-blank correctness array — powers the inline chips' correct/wrong color
 *  once instant feedback kicks in. */
function fillBlankCorrectness(content, givenAnswers) {
  return orderedBlanks(content).map((blank, i) =>
    fillBlankIsCorrect(blank, (givenAnswers || [])[i] || "", content.checking)
  );
}

window.FillBlank = {
  parseFillBlankTemplate,
  orderedBlanks,
  fillBlankIsCorrect,
  fillBlankIsQuestionCorrect,
  fillBlankCorrectness,
};
