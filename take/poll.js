// ============================================================================
// JS port of the Android app's Poll aggregation/shuffle logic — mirrors
// data/model/PollModels.kt's computePollDistribution/computePollConsensus
// exactly (same percent-of-voters-not-selections rule, same consensus
// thresholds). pollShuffledOrder here is a *stable-per-voter* seeded shuffle,
// not a bit-exact port of Kotlin's Random(seed) — the requirement is only
// "this voter sees the same order every time," not cross-platform identical
// ordering, so a simpler seeded PRNG is used instead of reimplementing Java's
// LCG algorithm.
// ============================================================================

const POLL_OTHER_INDEX = -1;

/** Aggregates votes into a static distribution — mirrors computePollDistribution().
 *  With allowMultiple, percentages are based on the number of VOTERS, not the
 *  total number of selections (one voter picking 3 options still counts once). */
function computePollDistribution(options, votes) {
  const perVoter = Array.from(new Map((votes || []).map((v) => [v.voterKey, v])).values());
  const voterCount = perVoter.length;
  const percentOf = (count) => (voterCount === 0 ? 0 : Math.round((count * 100.0) / voterCount));

  const optionResults = (options || []).map((label, idx) => {
    const voters = perVoter.filter((v) => (v.selectedOptionIndices || []).includes(idx));
    return {
      optionIndex: idx,
      label,
      count: voters.length,
      percent: percentOf(voters.length),
      reasons: voters.map((v) => v.reason).filter((r) => r && r.trim()),
    };
  });

  const otherVoters = perVoter.filter((v) => (v.selectedOptionIndices || []).includes(POLL_OTHER_INDEX));
  const otherCounts = new Map();
  otherVoters.forEach((v) => {
    const text = (v.otherText || "").trim();
    if (text) otherCounts.set(text, (otherCounts.get(text) || 0) + 1);
  });
  const otherEntries = Array.from(otherCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([text, count]) => ({ text, count }));

  const other = {
    optionIndex: POLL_OTHER_INDEX,
    label: "Other",
    count: otherVoters.length,
    percent: percentOf(otherVoters.length),
    reasons: otherVoters.map((v) => v.reason).filter((r) => r && r.trim()),
  };

  return { voterCount, options: optionResults, other, otherEntries };
}

const CONSENSUS_STRONG_MIN_PERCENT = 70;
const CONSENSUS_DIVIDED_MAX_GAP = 5;

/** Returns null when there are no votes (no consensus line shown) — mirrors
 *  computePollConsensus(). */
function computePollConsensus(distribution) {
  if (distribution.voterCount === 0) return null;
  const candidates = [...distribution.options, distribution.other]
    .filter((o) => o.count > 0)
    .sort((a, b) => b.count - a.count);
  const top = candidates[0];
  if (!top) return null;

  if (top.percent >= CONSENSUS_STRONG_MIN_PERCENT) {
    return { type: "strong", percent: top.percent, optionIndex: top.optionIndex, option: top.label };
  }
  const second = candidates[1];
  if (second && Math.abs(top.percent - second.percent) <= CONSENSUS_DIVIDED_MAX_GAP) {
    return { type: "divided", indexA: top.optionIndex, optionA: top.label, indexB: second.optionIndex, optionB: second.label };
  }
  return { type: "leading", percent: top.percent, optionIndex: top.optionIndex, option: top.label };
}

/** Deterministic per-(voter, question) shuffle, stable across visits — the
 *  "Other" row is never part of this order; it's always rendered last. */
function pollShuffledOrder(voterKey, questionId, optionCount) {
  let seed = 0;
  const str = `${voterKey}:${questionId}`;
  for (let i = 0; i < str.length; i++) {
    seed = (seed * 31 + str.charCodeAt(i)) | 0;
  }
  // mulberry32 — small, fast, deterministic seeded PRNG.
  let a = seed >>> 0;
  function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const order = Array.from({ length: optionCount }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

window.Poll = {
  POLL_OTHER_INDEX,
  computePollDistribution,
  computePollConsensus,
  pollShuffledOrder,
};
