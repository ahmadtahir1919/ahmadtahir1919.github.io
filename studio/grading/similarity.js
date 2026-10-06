// "Close to expected" — UI hint only. Never sets a mark.
//
// The app's real matching maths, ported unchanged from deploy/take/evaluator.js (itself a
// lockstep port of TextNormalizer.kt + SimilarityAlgorithms.kt): normalise both sides the way
// the auto-marker does, then Levenshtein similarity. Shown as a percentage bar in Rapid Grade.

const PUNCT = /[^\p{L}\p{N}\p{M} ]/gu;
const DIGIT = /\p{N}/u;
// Arabic/Urdu diacritics only — TextNormalizer.kt's arabicHarakatRegex.
const HARAKAT = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ࣓-ࣣ࣡-ࣿ]/g;
const SPACE = /\s+/g;

/** A decimal point between digits and a minus that starts a number survive the strip. */
function keepsNumericMark(ch, i, str) {
  const next = str[i + 1] || "";
  if (ch === ".") return DIGIT.test(str[i - 1] || "") && DIGIT.test(next);
  if (ch === "-") return (i === 0 || str[i - 1] === " ") && DIGIT.test(next);
  return false;
}

/** TextNormalizer.normalize: lower-case, collapse, strip punctuation and harakat, collapse. */
export function normalize(input) {
  return String(input ?? "")
    .toLowerCase()
    .replace(SPACE, " ")
    .replace(PUNCT, (ch, i, str) => (keepsNumericMark(ch, i, str) ? ch : ""))
    .replace(HARAKAT, "")
    .replace(SPACE, " ")
    .trim();
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
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

/** 0–100, or null when either side is blank. */
export function closeness(given, expected) {
  const a = normalize(given);
  const b = normalize(expected);
  if (!a || !b) return null;
  return Math.round(levenshteinSimilarity(a, b) * 100);
}
