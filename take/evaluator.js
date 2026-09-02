// ============================================================================
// JS port of the Android app's answer-grading engine — kept in exact lockstep
// with app/src/main/java/.../data/model/{TextNormalizer,NumberWordConverter,
// SimilarityAlgorithms,AnswerEvaluator,AnswerModels}.kt so a WRITTEN or
// FILL_BLANK question grades identically whether taken in the app or here.
// If you change scoring behavior in the Kotlin source, mirror it here too.
// ============================================================================

// ── TextNormalizer.kt ────────────────────────────────────────────────────
const TextNormalizer = {
  // \p{L}/\p{N} need the 'u' flag in JS regex to behave like Kotlin's \p{L}/\p{N}.
  _punct: /[^\p{L}\p{N} ]/gu,
  _space: /\s+/g,

  /** Shared cleaning pipeline. The collapse-strip-collapse ordering is deliberate and
   *  both collapses are load-bearing:
   *   - Collapsing FIRST turns tabs/newlines into plain spaces. _punct whitelists only
   *     a literal space, so stripping first would delete a tab outright and glue the
   *     words on either side of it together.
   *   - Collapsing AGAIN afterwards stops a space-surrounded mark leaving a double
   *     space: "New York , USA" would normalize to "new york  usa" and never equal
   *     "New York, USA" -> "new york usa". evaluateExact compares these strings
   *     directly, so an identical answer was being marked wrong. */
  _clean(input, dropPunctuation) {
    const collapsed = input.replace(this._space, " ");
    const stripped = dropPunctuation
      ? collapsed.replace(this._punct, "").replace(this._space, " ")
      : collapsed;
    return stripped.trim();
  },

  normalize(input) {
    return this._clean(input.toLowerCase(), true);
  },

  /** Case-sensitive mode preserves punctuation too — that is the documented contract
   *  of MatchMode.CASE_SENSITIVE_EXACT ("punctuation is kept") and the entire point of
   *  FillBlankChecking.STRICT. Stripping it here quietly reduced Strict to a case-only
   *  check, accepting "dont" for "don't". */
  normalizeForExact(input, caseSensitive) {
    return caseSensitive ? this._clean(input, false) : this._clean(input.toLowerCase(), true);
  },

  tokenize(input) {
    return this.normalize(input).split(" ").filter((t) => t.length > 0);
  },
};

// ── NumberWordConverter.kt ───────────────────────────────────────────────
const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

function wordToNumber(input) {
  // Split on any non-letter run so "twenty-three", "twenty three" and "twenty three."
  // all tokenize identically.
  const tokens = input.toLowerCase().replace(/[^a-z]+/g, " ").trim().split(" ").filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  let total = 0;
  let current = 0;
  // Guards the multiplier words: a bare "hundred" used to multiply a current of 0 and
  // yield 0, so it compared equal to "0" and was marked correct. A multiplier is only a
  // number when something precedes it to multiply.
  let sawValue = false;
  for (const token of tokens) {
    if (token in ONES) { current += ONES[token]; sawValue = true; }
    else if (token in TENS) { current += TENS[token]; sawValue = true; }
    else if (token === "hundred") { if (current === 0) return null; current *= 100; }
    else if (token === "thousand") { if (current === 0) return null; current *= 1000; total += current; current = 0; }
    else if (token === "million") { if (current === 0) return null; current *= 1000000; total += current; current = 0; }
    else return null; // unrecognised word
  }
  if (!sawValue) return null;
  return total + current;
}

// ── SimilarityAlgorithms.kt ──────────────────────────────────────────────
function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length, n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function levenshteinSimilarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function wordLevelMatch(inputTokens, expectedTokens, threshold) {
  const remaining = inputTokens.slice();
  return expectedTokens.map((expWord) => {
    if (remaining.length === 0) {
      return { expectedWord: expWord, matchedWord: null, similarity: 0, matched: false };
    }
    let bestIdx = -1, bestSim = -1;
    remaining.forEach((token, idx) => {
      const sim = levenshteinSimilarity(token, expWord);
      if (sim > bestSim) { bestSim = sim; bestIdx = idx; }
    });
    const matched = bestSim >= threshold;
    const matchedWord = remaining[bestIdx];
    remaining.splice(bestIdx, 1);
    return { expectedWord: expWord, matchedWord, similarity: bestSim, matched };
  });
}

function wordLevelSimilarity(inputTokens, expectedTokens, threshold) {
  if (expectedTokens.length === 0) return 1;
  const details = wordLevelMatch(inputTokens, expectedTokens, threshold);
  const wordScore = details.reduce((sum, d) => sum + d.similarity, 0) / expectedTokens.length;
  const expectedN = expectedTokens.length;
  const inputN = inputTokens.length;
  const lengthPenalty = expectedN / Math.max(expectedN, inputN);
  return clamp(wordScore * lengthPenalty, 0, 1);
}

function keywordCoverage(input, keywords) {
  if (keywords.length === 0) return 1;
  const inputTokens = TextNormalizer.tokenize(input);
  let matched = 0;
  for (const kw of keywords) {
    const normKw = TextNormalizer.normalize(kw);
    const found = inputTokens.some((token) => levenshteinSimilarity(token, normKw) >= 0.8);
    if (found) matched++;
  }
  return matched / keywords.length;
}

/** Everything that can't be part of a written number. This KEEPS "." and "-":
 *  running normalize() here instead stripped the decimal point and turned "3.14" into
 *  "314", which then compared equal to a literal 314. */
const NON_NUMERIC = /[^0-9.\-]/g;

/** [text] must NOT be pre-normalized — it needs its decimal point intact. Currency
 *  symbols, thousands separators and stray punctuation are dropped here instead, so
 *  "$1,000.50" still parses. */
function parseNumeric(text) {
  const digits = text.replace(NON_NUMERIC, "");
  // Requiring an actual digit stops a lone "-" or "." being considered. Number() only
  // ever sees this cleaned form, so it can't accept JS-only spellings like "0x10".
  if (/[0-9]/.test(digits)) {
    const asNum = Number(digits);
    if (!Number.isNaN(asNum)) return asNum;
  }
  return wordToNumber(text);
}

function numericEquivalent(a, b) {
  const na = parseNumeric(a);
  const nb = parseNumeric(b);
  if (na === null || nb === null) return false;
  return na === nb;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ── AnswerModels.kt — AnswerRule defaults + computeScore ─────────────────

/** Same shape/defaults as Kotlin's AnswerRule data class. */
function defaultAnswerRule(overrides) {
  return Object.assign(
    {
      matchModeList: ["FUZZY_TYPO_TOLERANT"],
      aliasPairs: [],
      minSimilarity: 0.85,
      keywords: [],
      keywordCoverage: "ALL", // ALL=1.0, MOST=0.75, HALF=0.50
      partialCreditEnabled: false,
      marksPattern: "WEIGHTED_BY_SIMILARITY",
    },
    overrides || {}
  );
}

const KEYWORD_COVERAGE_THRESHOLD = { ALL: 1.0, MOST: 0.75, HALF: 0.5 };

/** Mirrors computeScore() in AnswerModels.kt exactly, including the
 *  HALF_FOR_PARTIAL/ALL_OR_NOTHING branches being identical (a latent
 *  duplication in the Kotlin source, replicated here on purpose for parity —
 *  not something this task was asked to fix). */
function computeScore(result, points, rule) {
  if (result.status === "INCORRECT") return 0;
  let raw;
  if (rule.marksPattern === "WEIGHTED_BY_SIMILARITY") {
    raw = points * clamp(result.similarityScore, 0, 1);
  } else {
    // HALF_FOR_PARTIAL and ALL_OR_NOTHING share this same body in the Kotlin source.
    if (result.status === "EXACT_MATCH" || result.status === "ACCEPTED_WITH_TYPO") raw = points * 1;
    else if (result.status === "PARTIAL_MATCH") raw = rule.partialCreditEnabled ? points * 0.5 : 0;
    else raw = 0;
  }
  return Math.trunc(raw * 100) / 100; // truncate to 2dp, matches (raw*100).toLong()/100f
}

// ── Grading.kt's splitCorrectOptionPoints / applyTimeWeightage ─────────────
// Mirrors the Kotlin functions of the same name exactly — see Grading.kt for the
// full rationale (largest-remainder split, 50%-floor linear time factor).

function splitCorrectOptionPoints(totalPoints, correctCount) {
  if (correctCount <= 0) return [];
  const base = Math.floor(totalPoints / correctCount);
  const remainder = totalPoints - base * correctCount;
  return Array.from({ length: correctCount }, (_, i) => (i < remainder ? base + 1 : base));
}

/** Scores a MULTIPLE_CORRECT question when splitPointsAcrossChoices is on — mirrors
 *  scoreSplitMultipleCorrect() in Grading.kt. Correctness is a SET COMPARISON, never a
 *  comparison of points earned against the question total: on a no-marks question
 *  (totalPoints 0) every award is 0, so "earned === total" was trivially true and
 *  marked EVERY taker correct, including one who selected nothing. It also wrongly
 *  passed a taker who picked every correct option plus a wrong one. */
function scoreSplitMultipleCorrect(correctIndices, pickedIndices, totalPoints) {
  const shares = splitCorrectOptionPoints(totalPoints, correctIndices.length);
  const rawPoints = correctIndices.reduce(
    (sum, idx, i) => sum + (pickedIndices.has(idx) ? shares[i] : 0),
    0
  );
  const isCorrect =
    correctIndices.length > 0 &&
    pickedIndices.size === correctIndices.length &&
    correctIndices.every((idx) => pickedIndices.has(idx));
  return { isCorrect, rawPoints };
}

const TIME_WEIGHTAGE_GRACE_SEC = 5;

function timeWeightageFactor(elapsedSec, timeLimitSec) {
  if (timeLimitSec <= TIME_WEIGHTAGE_GRACE_SEC) return 1.0;
  if (elapsedSec <= TIME_WEIGHTAGE_GRACE_SEC) return 1.0;
  const scalableWindow = timeLimitSec - TIME_WEIGHTAGE_GRACE_SEC;
  const elapsedInWindow = clamp(elapsedSec - TIME_WEIGHTAGE_GRACE_SEC, 0, scalableWindow);
  const remaining = scalableWindow - elapsedInWindow;
  const fraction = remaining / scalableWindow;
  return clamp(0.5 + 0.5 * fraction, 0.5, 1.0);
}

function applyTimeWeightage(rawPoints, elapsedSec, timeLimitSec, enabled) {
  if (!enabled || timeLimitSec <= 0) return rawPoints;
  const factor = timeWeightageFactor(elapsedSec, timeLimitSec);
  return clamp(Math.round(rawPoints * factor), 0, rawPoints);
}

// ── AnswerEvaluator.kt ────────────────────────────────────────────────────

function applyAliasPairs(input, pairs) {
  if (!pairs || pairs.length === 0) return input;
  let result = input;
  for (const pair of pairs) {
    if (!pair.acceptedWord?.trim() || !pair.answerWord?.trim()) continue;
    const tokens = result.split(" ").map((token) =>
      token.trim().toLowerCase() === pair.acceptedWord.trim().toLowerCase() ? pair.answerWord : token
    );
    result = tokens.join(" ");
  }
  return result;
}

function buildWordDetails(normInput, normCandidate, threshold) {
  const inputTokens = TextNormalizer.tokenize(normInput);
  const expectedTokens = TextNormalizer.tokenize(normCandidate);
  if (expectedTokens.length <= 1) return [];
  return wordLevelMatch(inputTokens, expectedTokens, threshold);
}

function evaluateExact(normInput, normCandidate, rawCandidate) {
  if (normInput === normCandidate) {
    return {
      status: "EXACT_MATCH", similarityScore: 1, matchedAgainst: rawCandidate,
      feedbackMessage: window.S.EVAL_CORRECT, wordDetails: buildWordDetails(normInput, normCandidate, 1),
    };
  }
  return {
    status: "INCORRECT", similarityScore: 0, matchedAgainst: rawCandidate,
    feedbackMessage: window.S.EVAL_INCORRECT, wordDetails: buildWordDetails(normInput, normCandidate, 1),
  };
}

function evaluateFuzzy(normInput, normCandidate, rawCandidate, rule) {
  if (normInput === normCandidate) {
    return {
      status: "EXACT_MATCH", similarityScore: 1, matchedAgainst: rawCandidate, feedbackMessage: window.S.EVAL_CORRECT,
      wordDetails: buildWordDetails(normInput, normCandidate, rule.minSimilarity),
    };
  }
  if (normCandidate.length <= 3) {
    return {
      status: "INCORRECT",
      similarityScore: levenshteinSimilarity(normInput, normCandidate),
      matchedAgainst: rawCandidate, feedbackMessage: window.S.EVAL_INCORRECT, wordDetails: [],
    };
  }
  const inputTokens = TextNormalizer.tokenize(normInput);
  const expectedTokens = TextNormalizer.tokenize(normCandidate);
  const details = wordLevelMatch(inputTokens, expectedTokens, rule.minSimilarity);
  const similarity = wordLevelSimilarity(inputTokens, expectedTokens, rule.minSimilarity);
  if (similarity >= rule.minSimilarity) {
    return { status: "ACCEPTED_WITH_TYPO", similarityScore: similarity, matchedAgainst: rawCandidate, feedbackMessage: window.S.EVAL_TYPO, wordDetails: details };
  }
  if (similarity >= 0.4) {
    return { status: "PARTIAL_MATCH", similarityScore: similarity, matchedAgainst: rawCandidate, feedbackMessage: window.S.EVAL_PARTIAL, wordDetails: details };
  }
  return { status: "INCORRECT", similarityScore: similarity, matchedAgainst: rawCandidate, feedbackMessage: window.S.EVAL_INCORRECT, wordDetails: details };
}

function evaluateKeywords(normInput, rawCandidate, rule) {
  if (!rule.keywords || rule.keywords.length === 0) {
    return evaluateExact(normInput, TextNormalizer.normalize(rawCandidate), rawCandidate);
  }
  const coverage = keywordCoverage(normInput, rule.keywords);
  const threshold = KEYWORD_COVERAGE_THRESHOLD[rule.keywordCoverage] ?? 1.0;
  if (coverage >= 1.0) return { status: "EXACT_MATCH", similarityScore: 1, matchedAgainst: rawCandidate, feedbackMessage: window.S.EVAL_KEYWORDS_ALL, wordDetails: [] };
  if (coverage >= threshold) return { status: "ACCEPTED_WITH_TYPO", similarityScore: coverage, matchedAgainst: rawCandidate, feedbackMessage: window.S.evalKeywordsAccepted(Math.trunc(coverage * 100)), wordDetails: [] };
  if (coverage >= 0.3) return { status: "PARTIAL_MATCH", similarityScore: coverage, matchedAgainst: rawCandidate, feedbackMessage: window.S.evalKeywordsPartial(Math.trunc(coverage * 100)), wordDetails: [] };
  return { status: "INCORRECT", similarityScore: coverage, matchedAgainst: rawCandidate, feedbackMessage: window.S.EVAL_KEYWORDS_MISSING, wordDetails: [] };
}

function evaluateNumeric(normInput, normCandidate, rawCandidate) {
  if (numericEquivalent(normInput, normCandidate)) {
    return { status: "EXACT_MATCH", similarityScore: 1, matchedAgainst: rawCandidate, feedbackMessage: window.S.EVAL_CORRECT, wordDetails: [] };
  }
  return { status: "INCORRECT", similarityScore: 0, matchedAgainst: rawCandidate, feedbackMessage: window.S.EVAL_INCORRECT_NUMBER, wordDetails: [] };
}

function evaluateAgainstCandidateWithMode(userInput, candidate, mode, rule) {
  switch (mode) {
    case "STRICT_EXACT":
      return evaluateExact(TextNormalizer.normalize(userInput), TextNormalizer.normalize(candidate), candidate);
    case "CASE_SENSITIVE_EXACT":
      return evaluateExact(TextNormalizer.normalizeForExact(userInput, true), TextNormalizer.normalizeForExact(candidate, true), candidate);
    case "FUZZY_TYPO_TOLERANT":
      return evaluateFuzzy(TextNormalizer.normalize(userInput), TextNormalizer.normalize(candidate), candidate, rule);
    case "KEYWORD_MATCH":
      return evaluateKeywords(TextNormalizer.normalize(userInput), candidate, rule);
    case "NUMERIC_EQUIVALENT":
      // Raw, deliberately un-normalized: normalize() strips the decimal point as
      // punctuation, which turned "7.0" into "70" (so the tip's own promised example
      // failed to match "7") and made "314" equal "3.14". parseNumeric does its own
      // numeric-safe cleaning instead.
      return evaluateNumeric(userInput, candidate, candidate);
    default:
      return evaluateExact(TextNormalizer.normalize(userInput), TextNormalizer.normalize(candidate), candidate);
  }
}

/** Mirrors AnswerEvaluator.evaluate() exactly — see the Kotlin doc comment for
 *  the algorithm; alias substitution, first EXACT/TYPO wins across all active
 *  modes, else best PARTIAL, else best INCORRECT, else a generic INCORRECT. */
function evaluate(userInput, expected, rule) {
  rule = rule || defaultAnswerRule();
  if (!userInput || userInput.trim() === "") {
    return { status: "INCORRECT", similarityScore: 0, matchedAgainst: expected, feedbackMessage: window.S.EVAL_NO_ANSWER, wordDetails: [] };
  }

  const substitutedInput = applyAliasPairs(userInput, rule.aliasPairs);
  const aliasApplied = substitutedInput !== userInput;

  let bestPartial = null;
  let bestIncorrect = null;

  const modes = rule.matchModeList && rule.matchModeList.length > 0 ? rule.matchModeList : ["STRICT_EXACT"];
  const candidates = aliasApplied ? [substitutedInput, userInput] : [substitutedInput];

  for (const mode of modes) {
    for (const input of candidates) {
      const wasSubstituted = input === substitutedInput && aliasApplied;
      const result = evaluateAgainstCandidateWithMode(input, expected, mode, rule);
      if (result.status === "EXACT_MATCH" || result.status === "ACCEPTED_WITH_TYPO") {
        if (wasSubstituted) {
          const aliasNote = (rule.aliasPairs || [])
            .filter((pair) => userInput.split(" ").some((w) => w.toLowerCase() === pair.acceptedWord?.toLowerCase()))
            .map((pair) => `${pair.acceptedWord} → ${pair.answerWord}`)
            .join(", ");
          if (aliasNote) result.feedbackMessage = `${result.feedbackMessage} (${aliasNote})`;
        }
        return result;
      }
      if (result.status === "PARTIAL_MATCH") {
        if (!bestPartial || result.similarityScore > bestPartial.similarityScore) bestPartial = result;
      } else if (result.status === "INCORRECT") {
        if (!bestIncorrect || result.similarityScore > bestIncorrect.similarityScore) bestIncorrect = result;
      }
    }
  }

  return bestPartial || bestIncorrect || { status: "INCORRECT", similarityScore: 0, matchedAgainst: expected, feedbackMessage: window.S.EVAL_INCORRECT, wordDetails: [] };
}

// Public API — mirrors the Kotlin package's exported surface.
window.Evaluator = {
  evaluate,
  computeScore,
  defaultAnswerRule,
  TextNormalizer,
  splitCorrectOptionPoints,
  scoreSplitMultipleCorrect,
  timeWeightageFactor,
  applyTimeWeightage,
};
