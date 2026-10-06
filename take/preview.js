// ============================================================================
// Creator preview (/take/?preview=1) — the Studio quiz builder frames this page so its
// Preview shows exactly what a taker sees. app.js swaps window.SupabaseClient for the
// in-memory client below: same functions, but nothing is read from or written to
// Supabase — no join, no start stamp, no attempt, no poll vote. (analytics.js skips
// loading PostHog on its own when ?preview=1.)
//
// The quiz itself arrives from the parent page by postMessage (see app.js's
// bootPreview); this file only stands in for the network.
// ============================================================================

const isPreview = new URLSearchParams(window.location.search).get("preview") === "1";

if (isPreview) {
  const real = window.SupabaseClient || {};
  const votes = new Map(); // questionId -> [vote], this preview only
  const user = { id: "preview", email: "", user_metadata: { full_name: "" } };

  window.PreviewClient = {
    initError: null,
    user,
    quizFromRow: real.quizFromRow,
    questionFromRow: real.questionFromRow,
    resolveDisplayName: real.resolveDisplayName,
    countdownUntil: real.countdownUntil,
    // A scheduled or already-ended quiz still previews.
    effectiveStatus: () => "ACTIVE",
    getCurrentUser: async () => user,
    fetchNameConfirmed: async () => true,
    confirmDisplayName: async () => {},
    fetchFeatureFlags: async () => ({ joinQuizEnabled: true }),
    signOut: async () => {},
    signInWithGoogle: async () => {},
    signInWithIdToken: async () => {},
    joinQuiz: async () => {},
    markQuizStarted: async () => {},
    fetchLastStartedAt: async () => null,
    fetchExistingAttempt: async () => null,
    fetchAttemptAnswers: async () => [],
    // null = "couldn't check", which finishQuiz treats as "carry on with what's in memory".
    fetchQuizStatus: async () => null,
    // A preview has no live quiz row to re-read; null = keep the quiz as built.
    fetchQuizSettings: async () => null,
    isJoined: async () => null,
    submitAttempt: async () => "preview",
    ensurePollOpen: async () => ({ status: "OPEN", opened_at: Date.now(), closes_at: null }),
    fetchPollStates: async () => ({}),
    fetchPollVotes: async (questionId) => (votes.get(questionId) || []).slice(),
    castPollVote: async (vote) => {
      const list = (votes.get(vote.questionId) || []).filter((v) => v.voterKey !== vote.voterKey);
      list.push({ ...vote, updatedAt: Date.now() });
      votes.set(vote.questionId, list);
    },
  };
}
